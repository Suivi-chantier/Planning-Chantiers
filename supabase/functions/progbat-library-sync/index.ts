import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { rapprocherBibliotheque } from "./lib/progbatInventaire.mjs"
import { construirePlanSynchronisation, donneesPourHash, etatOuvragePourSync, listerFamillesOuvrages, restreindrePlan } from "./lib/progbatLibrarySync.mjs"

// Synchronisation CONSERVATRICE Profero → ProGBat.
// Actions : prepare (aucune écriture), sync (confirmation + hash), status.
// Le corps accepte un périmètre optionnel `ouvrageIds` : le plan est alors
// restreint à ces ouvrages (envoi depuis la fiche d'un ouvrage de la
// bibliothèque). Sans périmètre, le plan porte sur toute la bibliothèque.
// Cette fonction peut uniquement :
//   1. enregistrer dans Profero une correspondance de code métier unique ;
//   2. créer une nouvelle structure ProGBat dans une famille d'ouvrages
//      EXISTANTE, désignée par `familleId` (aucune famille par défaut, aucune
//      famille créée : la liste des familles utilisables est renvoyée à l'écran).
// Elle ne PATCH/PUT/DELETE jamais ProGBat et ne crée aucun élément/composant.

const PROGBAT_API = "https://api.progbat.com/v2"
const PAGE_LIMIT = 50
const MAX_PAGES = 80
const GET_TIMEOUT_MS = 15_000
const POST_TIMEOUT_MS = 25_000
const STATUTS_BLOQUANTS = ["linking", "creating", "uncertain"]
const MAX_PERIMETRE = 50

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
})
const nettoyer = (v: unknown) => String(v ?? "").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim().slice(0, 200)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const parseRange = (h: string | null) => { const m = (h || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/); return m ? { end: Number(m[2]), count: Number(m[3]) } : null }

type ApiResult = { ok: true; status: number; data: unknown; range?: { end: number; count: number } | null }
  | { ok: false; status: number; message: string; incertain?: boolean }

async function progbatFetch(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<ApiResult> {
  const ctrl = new AbortController()
  const timeout = method === "POST" ? POST_TIMEOUT_MS : GET_TIMEOUT_MS
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = nettoyer((data as Record<string, unknown> | null)?.message ?? (data as Record<string, unknown> | null)?.error ?? "")
      return {
        ok: false,
        status: res.status,
        message: `ProGBat a répondu HTTP ${res.status}${detail ? ` (${detail})` : ""}.`,
        // Un 5xx/408 après un POST ne prouve pas que l'écriture n'a pas eu lieu.
        incertain: method === "POST" && (res.status === 408 || res.status >= 500),
      }
    }
    return { ok: true, status: res.status, data, range: parseRange(res.headers.get("Range")) }
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error)?.name === "AbortError" ? `Délai ProGBat dépassé (${timeout / 1000} s).` : "Connexion à ProGBat interrompue.", incertain: method === "POST" }
  } finally { clearTimeout(timer) }
}

async function getAll(path: string, token: string) {
  const items: unknown[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT
    const sep = path.includes("?") ? "&" : "?"
    const r = await progbatFetch("GET", `${path}${sep}limit=${PAGE_LIMIT}&offset=${offset}`, token)
    if (!r.ok) return { ok: false as const, status: r.status, message: r.message, items }
    const batch = Array.isArray(r.data) ? r.data : []
    items.push(...batch)
    if (r.range && r.range.end + 1 >= r.range.count) break
    if (!r.range && batch.length < PAGE_LIMIT) break
  }
  return { ok: true as const, status: 200, items }
}

const hashSha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  const started = Date.now()
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } })
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: { user }, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !user?.email) return json({ ok: false, error: "Non authentifié." }, 401)
    const { data: profil } = await admin.from("utilisateurs").select("role,actif").eq("email", user.email.toLowerCase()).maybeSingle()
    if (!profil || profil.actif === false || profil.role === "ouvrier") return json({ ok: false, error: "Accès refusé." }, 403)

    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    if (!token) return json({ ok: false, error: "Connexion ProGBat non configurée." }, 500)
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { body = {} }
    const action = String(body.action || "prepare")
    if (!["prepare", "sync", "status"].includes(action)) return json({ ok: false, error: "Action inconnue." }, 400)
    // Périmètre optionnel : uniquement ces ouvrages Profero.
    const ouvrageIds = Array.isArray(body.ouvrageIds)
      ? [...new Set(body.ouvrageIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean))]
      : []
    if (ouvrageIds.length > MAX_PERIMETRE) return json({ ok: false, error: `Périmètre limité à ${MAX_PERIMETRE} ouvrages.` }, 400)
    // Famille ProGBat de destination : choisie par l'utilisateur parmi les
    // familles existantes. Sa validité est revérifiée ici contre ProGBat.
    const familleId = body.familleId == null ? null : Number(body.familleId)
    if (familleId != null && (!Number.isInteger(familleId) || familleId <= 0)) return json({ ok: false, error: "Famille ProGBat invalide." }, 400)

    if (action === "status") {
      let requete = admin.from("progbat_library_sync_items")
        .select("id,ouvrage_id,action,statut,progbat_target_id,progbat_code,started_at,finished_at,http_status,error_message")
      if (ouvrageIds.length) requete = requete.in("ouvrage_id", ouvrageIds)
      const { data, error } = await requete.order("started_at", { ascending: false }).limit(200)
      if (error) return json({ ok: false, error: "Lecture du suivi impossible." }, 500)
      return json({ ok: true, action, items: data || [] })
    }

    const [ouv, mats, cfg, tauxH, coefV, structures, familles, unites, taxes] = await Promise.all([
      admin.from("bibliotheque_ratios").select("*"),
      admin.from("materiaux_bibliotheque").select("id,nom,reference,unite,prix_unitaire,fournisseur,categorie"),
      admin.from("planning_config").select("key,value").in("key", ["taux_mo_previsionnel", "chiffrage_tva_defaut"]),
      // Taux horaires de VENTE : le prix synchronisé = matériaux × coef + cadence × taux de l'ouvrage
      admin.from("taux_horaires_vente").select("id,libelle,taux_ht,actif,est_defaut"),
      // Coefficients de VENTE : prix matériaux = coût × coefficient de l'ouvrage
      admin.from("coefficients_vente").select("id,libelle,valeur,actif,est_defaut"),
      getAll("/company/library/structures", token),
      getAll("/company/library/families", token),
      getAll("/company/library/units", token),
      progbatFetch("GET", "/company/taxes", token),
    ])
    if (ouv.error || mats.error || cfg.error || tauxH.error || coefV.error) return json({ ok: false, error: "Lecture de la bibliothèque Profero impossible." }, 500)
    if (!structures.ok) return json({ ok: false, error: structures.message, etape: "structures", progbat_status: structures.status }, 200)
    if (!familles.ok) return json({ ok: false, error: familles.message, etape: "familles", progbat_status: familles.status }, 200)
    if (!unites.ok) return json({ ok: false, error: unites.message, etape: "unites", progbat_status: unites.status }, 200)
    if (!taxes.ok) return json({ ok: false, error: taxes.message, etape: "taxes", progbat_status: taxes.status }, 200)
    const cfgMap = Object.fromEntries((cfg.data || []).map((x: Record<string, unknown>) => [x.key, x.value]))
    const taxesData = Array.isArray(taxes.data) ? taxes.data as Record<string, unknown>[] : []
    const inventaire = rapprocherBibliotheque({
      ouvrages: ouv.data || [], structures: structures.items, materiaux: mats.data || [],
      coutHoraire: num(cfgMap.taux_mo_previsionnel), tauxHoraires: tauxH.data || [], coefficientsVente: coefV.data || [], tvaDefaut: num(cfgMap.chiffrage_tva_defaut),
      taxes: taxesData, unites: unites.items,
    })
    let plan = restreindrePlan(construirePlanSynchronisation({
      inventaire, familles: familles.items, unites: unites.items, taxes: taxesData,
      tvaDefaut: num(cfgMap.chiffrage_tva_defaut),
      familleId,
    }), ouvrageIds)
    // Périmètre restreint : l'état vu par l'inventaire explique sur la fiche
    // pourquoi un ouvrage n'a rien à faire (déjà lié) ou reste bloqué.
    const etats = ouvrageIds.map((id) => etatOuvragePourSync(inventaire, id)).filter(Boolean)
    // Toujours renvoyé : c'est ce qui alimente la liste de choix des écrans.
    const famillesDisponibles = listerFamillesOuvrages(familles.items)

    // Un état incertain/en cours reste bloquant même si l'inventaire le repropose.
    const ids = plan.actions.map((x: Record<string, unknown>) => x.ouvrageId)
    if (ids.length) {
      const { data: actifs } = await admin.from("progbat_library_sync_items").select("ouvrage_id,statut,error_message").in("ouvrage_id", ids).in("statut", STATUTS_BLOQUANTS)
      const parId = new Map((actifs || []).map((x: Record<string, unknown>) => [String(x.ouvrage_id), x]))
      const gardees = [], bloquees = []
      for (const x of plan.actions) {
        const b = parId.get(String(x.ouvrageId))
        if (b) bloquees.push({ ouvrageId: x.ouvrageId, code: x.code, libelle: x.libelle, raisons: [`Synchronisation ${b.statut} : vérification manuelle requise`] })
        else gardees.push(x)
      }
      plan = { ...plan, actions: gardees, exclus: [...plan.exclus, ...bloquees], compteurs: {
        a_lier: gardees.filter((x: Record<string, unknown>) => x.type === "link").length,
        a_creer: gardees.filter((x: Record<string, unknown>) => x.type === "create").length,
        exclus: plan.exclus.length + bloquees.length, total: gardees.length,
      } }
    }
    const planHash = await hashSha256(donneesPourHash(plan))

    if (action === "prepare") {
      console.log(`[progbat-library-sync] appelant=${user.id} action=prepare perimetre=${ouvrageIds.length || "global"} liens=${plan.compteurs.a_lier} creations=${plan.compteurs.a_creer} exclus=${plan.compteurs.exclus} (${Date.now() - started} ms)`)
      return json({ ok: true, action, planHash, plan, etats, famillesDisponibles, aucune_suppression: true, aucune_modification_progbat: true })
    }
    if (body.confirmed !== true) return json({ ok: false, error: "Confirmation explicite requise.", code: "confirmation_requise" }, 400)
    if (String(body.expectedPlanHash || "") !== planHash) return json({ ok: false, error: "La bibliothèque a changé depuis l’aperçu. Relancer la préparation.", code: "plan_modifie", planHash }, 409)
    if (!plan.actions.length) return json({ ok: false, error: "Aucune liaison ou création sûre à effectuer.", code: "plan_vide", etats, famillesDisponibles }, 400)

    const resultats: Record<string, unknown>[] = []
    let interrompu = false
    for (const item of plan.actions) {
      if (interrompu) { resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "non_execute" }); continue }
      const statutInitial = item.type === "link" ? "linking" : "creating"
      const { data: reservation, error: reserveError } = await admin.from("progbat_library_sync_items").insert({
        ouvrage_id: item.ouvrageId, action: item.type, plan_hash: planHash, statut: statutInitial,
        progbat_target_id: item.type === "link" ? item.progbatId : null,
        progbat_code: item.code, created_by: user.id, created_by_email: user.email,
      }).select("id").single()
      if (reserveError) {
        resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "conflit", error: reserveError.code === "23505" ? "Synchronisation déjà en cours ou incertaine." : "Réservation impossible." })
        continue
      }
      const finir = async (patch: Record<string, unknown>) => admin.from("progbat_library_sync_items").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", reservation.id)

      if (item.type === "link") {
        const { data: lie, error } = await admin.from("bibliotheque_ratios").update({ progbat_id: String(item.progbatId), progbat_sync_at: new Date().toISOString() }).eq("id", item.ouvrageId).is("progbat_id", null).select("id").maybeSingle()
        if (error || !lie) {
          const { data: actuel } = await admin.from("bibliotheque_ratios").select("progbat_id").eq("id", item.ouvrageId).maybeSingle()
          if (String(actuel?.progbat_id || "") !== String(item.progbatId)) {
            await finir({ statut: "failed", error_message: "Liaison Profero non enregistrée" })
            resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "failed", error: "Liaison non enregistrée." })
            continue
          }
        }
        await finir({ statut: "linked", progbat_target_id: item.progbatId })
        resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "linked", progbatId: item.progbatId })
        continue
      }

      const rep = await progbatFetch("POST", "/company/library/structures", token, item.payload)
      if (!rep.ok) {
        const statut = rep.incertain ? "uncertain" : "failed"
        await finir({ statut, http_status: rep.status || null, error_message: rep.message })
        resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut, progbat_status: rep.status, error: rep.message })
        if (rep.incertain || [401, 403, 429].includes(rep.status)) interrompu = true
        continue
      }
      const reponse = (rep.data || {}) as Record<string, unknown>
      const progbatId = Number(reponse.id)
      if (!Number.isInteger(progbatId)) {
        await finir({ statut: "uncertain", http_status: rep.status, error_message: "Réponse sans identifiant" })
        resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "uncertain", error: "ProGBat a répondu sans identifiant : vérifier manuellement." })
        interrompu = true
        continue
      }
      const { data: maj, error: majError } = await admin.from("bibliotheque_ratios").update({ progbat_id: String(progbatId), progbat_sync_at: new Date().toISOString() }).eq("id", item.ouvrageId).is("progbat_id", null).select("id").maybeSingle()
      if (majError || !maj) {
        await finir({ statut: "uncertain", progbat_target_id: progbatId, http_status: rep.status, error_message: "Ouvrage créé mais liaison Profero incomplète" })
        resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "uncertain", progbatId, error: "Ouvrage créé, mais liaison locale incomplète." })
        interrompu = true
        continue
      }
      await finir({ statut: "created", progbat_target_id: progbatId, http_status: rep.status })
      resultats.push({ ouvrageId: item.ouvrageId, code: item.code, type: item.type, statut: "created", progbatId })
    }

    const compteurs = Object.fromEntries(["linked", "created", "failed", "uncertain", "conflit", "non_execute"].map((s) => [s, resultats.filter((r) => r.statut === s).length]))
    console.log(`[progbat-library-sync] appelant=${user.id} action=sync perimetre=${ouvrageIds.length || "global"} ${JSON.stringify(compteurs)} (${Date.now() - started} ms)`)
    return json({ ok: compteurs.failed === 0 && compteurs.uncertain === 0 && compteurs.conflit === 0, action, planHash, compteurs, resultats, aucune_suppression: true, aucune_modification_progbat: true })
  } catch (e) {
    console.error(`[progbat-library-sync] erreur=${nettoyer((e as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne de synchronisation." }, 500)
  }
})
