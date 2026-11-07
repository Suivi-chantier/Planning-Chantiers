import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { traiterRequeteAutomatisation, nettoyerMessage, CLE_MANAGERS } from "./lib/progbatAutomatisation.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-operations — Refonte Opérations, lot 4.
// Client ProGBat → chantier ProGBat → (devis : progbat-quote) ; facture
// d'acompte à la signature ; statut d'un devis.
//
// Toute la logique est dans lib/progbatAutomatisation.mjs (pur, testé dans
// Node par scripts/verif-refonte-lot4.mjs avec un faux client HTTP). Ce fichier
// n'est que l'adaptateur Deno / Supabase / fetch.
//
// ÉCRITURES ProGBat (trois POST, jamais rejoués automatiquement) :
//   POST /company/thirds                          scope thirds.write   (action creer_client)
//   POST /company/business                        scope business.write (action creer_chantier)
//   POST /company/quotes/{quoteId}/advance-bill   scope bills.write    (action creer_acompte)
// Chacun exige : utilisateur du bureau, confirmed: true, empreinte de l'aperçu
// identique, réservation préalable dans progbat_ecritures (index unique).
// Clients ProGBat existants (fiche Opération) : lister_clients_progbat,
// importer_client_progbat, relire_client_progbat (07/11 : complète les champs
// vides d'une fiche reliée) — LECTURE ProGBat seulement.
// LECTURES (GET) : /company/thirds?type=2|4, /company/thirds/{id},
//   /company/business/{id}/yards, /company/quotes/{id}, /company/bills.
//
// Jetons : PROGBAT_PRIVATE_ACCESS_TOKEN (celui des devis) pour les écritures et
// les lectures ; PROGBAT_BILLING_ACCESS_TOKEN en repli de LECTURE seulement
// (business.read, bills.read). Jamais renvoyés ni journalisés.
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif, rôle ≠ ouvrier.
// Déploiement : verify_jwt = true.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_GET_MS = 12_000
const TIMEOUT_POST_MS = 25_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

type Rep =
  | { ok: true; status: number; data: unknown; range: string | null }
  | { ok: false; status: number; message: string; timeout?: boolean; reseau?: boolean }

async function appel(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<Rep> {
  const ctrl = new AbortController()
  const ms = method === "GET" ? TIMEOUT_GET_MS : TIMEOUT_POST_MS
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = ""
      try {
        const b = await res.json()
        detail = nettoyerMessage(b?.message ?? b?.error_description ?? b?.error ?? "")
      } catch { /* corps non JSON */ }
      return { ok: false, status: res.status, message: detail }
    }
    return { ok: true, status: res.status, data: await res.json().catch(() => null), range: res.headers.get("content-range") || res.headers.get("range") }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return { ok: false, status: 0, message: `délai de ${ms / 1000} s dépassé`, timeout: true }
    return { ok: false, status: 0, message: "réseau", reseau: true }
  } finally {
    clearTimeout(timer)
  }
}

// Liste paginée (GET), 30 pages de 100 au plus. Une page en erreur = erreur.
async function tout(path: string, token: string): Promise<{ ok: true; items: Record<string, unknown>[] } | { ok: false; status: number; message: string }> {
  const items: Record<string, unknown>[] = []
  for (let p = 0; p < 30; p++) {
    const sep = path.includes("?") ? "&" : "?"
    const r = await appel("GET", `${path}${sep}limit=100&offset=${p * 100}`, token)
    if (!r.ok) return { ok: false, status: r.status, message: r.message }
    const lot = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : []
    items.push(...lot)
    const m = String(r.range || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/)
    if (m && items.length >= Number(m[3])) return { ok: true, items }
    if (lot.length < 100) return { ok: true, items }
  }
  return { ok: false, status: 0, message: "liste trop longue (plus de 30 pages)" }
}

// Cache de la liste des clients ProGBat (lecture) : 5 minutes par instance de
// la fonction. Vidé après toute création de client.
const CACHE_TIERS_MS = 5 * 60 * 1000
const cacheTiers = new Map<number, { t: number; r: { ok: true; items: Record<string, unknown>[] } }>()

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  const t0 = Date.now()
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } })
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    let appelant: { id: string; email: string; role: string | null; actif: boolean | null } | null = null
    if (jwt) {
      const { data: { user }, error } = await admin.auth.getUser(jwt)
      if (!error && user?.email) {
        const { data: profil } = await admin.from("utilisateurs").select("role, actif").eq("email", user.email.toLowerCase()).maybeSingle()
        appelant = { id: user.id, email: user.email, role: profil?.role ?? null, actif: profil ? profil.actif !== false : false }
      }
    }
    let requete: Record<string, unknown> = {}
    try { requete = await req.json() } catch { requete = {} }

    const jeton = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    const jetonLecture = Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || ""
    // GET avec repli sur le jeton de lecture quand le jeton principal n'a pas le droit (403).
    const lire = async (path: string) => {
      const r = await appel("GET", path, jeton)
      if (!r.ok && r.status === 403 && jetonLecture) return await appel("GET", path, jetonLecture)
      return r
    }
    const lireTout = async (path: string) => {
      const r = await tout(path, jeton)
      if (!r.ok && r.status === 403 && jetonLecture) return await tout(path, jetonLecture)
      return r
    }

    const depot = {
      async chargerContexte(projectId: string) {
        const { data: projet, error } = await admin.from("profero_projets").select("*").eq("id", projectId).maybeSingle()
        if (error) throw new Error("Lecture du chiffrage impossible : " + nettoyerMessage(error.message))
        if (!projet) return null
        const { data: lien } = await admin.from("chantier_projets").select("chantier_id").eq("projet_id", projectId).maybeSingle()
        let chantier = null, operation = null, client = null, projetsChantier = [projet]
        if (lien?.chantier_id) {
          const { data: ch } = await admin.from("chantiers").select("id, nom, operation_id, client_id, charge_affaires_id, charge_affaires_nom, progbat_business_id, progbat_yard_id, progbat_business_code").eq("id", lien.chantier_id).maybeSingle()
          chantier = ch
          if (ch?.operation_id) {
            const { data: op } = await admin.from("operations").select("id, nom, client_id, charge_affaires_id, charge_affaires_nom").eq("id", ch.operation_id).maybeSingle()
            operation = op
          }
          const clientId = ch?.client_id || operation?.client_id || null
          if (clientId) {
            const { data: cl } = await admin.from("clients").select("*").eq("id", clientId).maybeSingle()
            client = cl
          }
          const { data: liens } = await admin.from("chantier_projets").select("projet_id").eq("chantier_id", lien.chantier_id)
          const ids = (liens || []).map((l: Record<string, unknown>) => l.projet_id)
          if (ids.length) {
            const { data: ps } = await admin.from("profero_projets").select("id, progbat_devis_id, progbat_client_id, progbat_business_id, progbat_yard_id").in("id", ids)
            projetsChantier = ps || [projet]
          }
        }
        return { projet, chantier, operation, client, projetsChantier }
      },
      async dernieresEcritures(cles: Record<string, string | null>) {
        const out: Record<string, unknown> = {}
        for (const [cible, cle] of Object.entries(cles)) {
          if (!cle) { out[cible] = null; continue }
          const { data } = await admin.from("progbat_ecritures").select("*").eq("cible", cible).eq("cle", cle).order("started_at", { ascending: false }).limit(1).maybeSingle()
          out[cible] = data ?? null
        }
        return out
      },
      async lireManagers() {
        const { data } = await admin.from("planning_config").select("value").eq("key", CLE_MANAGERS).maybeSingle()
        const v = (data?.value ?? null) as Record<string, unknown> | null
        return (v && typeof v.correspondances === "object" && v.correspondances) ? v.correspondances : {}
      },
      async reserverEcriture(ligne: Record<string, unknown>) {
        const { data, error } = await admin.from("progbat_ecritures").insert(ligne).select("id").single()
        if (error) return error.code === "23505" ? { ok: false, conflit: true } : { ok: false, erreur: error.message }
        return { ok: true, id: data.id }
      },
      async majEcriture(id: string, patch: Record<string, unknown>) {
        const { error } = await admin.from("progbat_ecritures").update(patch).eq("id", id)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async lierClient(clientId: string, thirdId: number) {
        const { error } = await admin.from("clients").update({ progbat_client_id: String(thirdId) }).eq("id", clientId)
        if (error?.code === "23505") return { ok: false, erreur: `le client ProGBat ${thirdId} est déjà relié à une autre fiche client de l'application (choisir cette fiche-là)` }
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async clientParProgbatId(thirdId: number) {
        const { data } = await admin.from("clients").select("*").eq("progbat_client_id", String(thirdId)).order("created_at").limit(1).maybeSingle()
        return data ?? null
      },
      async clientParId(id: string) {
        const { data } = await admin.from("clients").select("*").eq("id", id).maybeSingle()
        return data ?? null
      },
      // Relecture ProGBat (07/11) : le patch ne contient QUE des champs vides de la fiche.
      async completerClient(id: string, patch: Record<string, unknown>) {
        const { data, error } = await admin.from("clients").update(patch).eq("id", id).select("*").single()
        return error ? { ok: false, erreur: error.message } : { ok: true, client: data }
      },
      async creerClientLocal(fiche: Record<string, unknown>) {
        const { data, error } = await admin.from("clients").insert(fiche).select("*").single()
        if (error) return error.code === "23505" ? { ok: false, conflit: true } : { ok: false, erreur: error.message }
        return { ok: true, client: data }
      },
      async lierChantier(chantierId: string, { businessId, yardId, code }: { businessId: number; yardId: number | null; code: string | null }) {
        const { error } = await admin.from("chantiers").update({ progbat_business_id: businessId, progbat_yard_id: yardId, progbat_business_code: code }).eq("id", chantierId)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async enregistrerYard(chantierId: string, y: { yardId: number; label?: string; numero?: string | null }) {
        const { error } = await admin.from("chantier_progbat_yards").upsert(
          { chantier_id: chantierId, progbat_yard_id: y.yardId, progbat_yard_label: y.label || null, progbat_public_yard_number: y.numero || null },
          { onConflict: "progbat_yard_id", ignoreDuplicates: true },
        )
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async majProjets(liste: { id: string; patch: Record<string, unknown> }[]) {
        for (const x of liste) {
          const { error } = await admin.from("profero_projets").update(x.patch).eq("id", x.id).is("progbat_devis_id", null)
          if (error) return { ok: false, erreur: error.message }
        }
        return { ok: true }
      },
      async majProjet(projectId: string, patch: Record<string, unknown>) {
        const { error } = await admin.from("profero_projets").update(patch).eq("id", projectId)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async cycleVieChantier(chantierId: string) {
        const [{ data: lignes }, { data: ph }] = await Promise.all([
          admin.from("chantier_cycle_vie").select("chantier_id, etape_id, etat").eq("chantier_id", chantierId),
          admin.from("phasages").select("plan_travaux").eq("chantier_id", chantierId).limit(1).maybeSingle(),
        ])
        return { lignes: lignes || [], meta: (ph?.plan_travaux as Record<string, unknown> | null)?.meta ?? null }
      },
      async facturesAcompteConnues(quoteId: number) {
        const { data } = await admin.from("chantier_factures_client").select("progbat_bill_id, numero, progbat_type").eq("progbat_quote_id", quoteId)
        return (data || []).filter((f: Record<string, unknown>) => String(f.progbat_type || "") === "advance")
      },
    }

    const progbat = {
      jetonPresent: !!jeton,
      async lireTiers(type: number) {
        const c = cacheTiers.get(type)
        if (c && Date.now() - c.t < CACHE_TIERS_MS) return c.r
        const r = await tout(`/company/thirds?type=${type}`, jeton)
        if (r.ok) cacheTiers.set(type, { t: Date.now(), r })
        return r
      },
      async lireTiersUn(id: number) { return await appel("GET", `/company/thirds/${encodeURIComponent(String(id))}`, jeton) },
      async creerTiers(corps: unknown) { cacheTiers.clear(); return await appel("POST", "/company/thirds", jeton, corps) },
      async creerAffaire(corps: unknown) { return await appel("POST", "/company/business", jeton, corps) },
      async lireYards(businessId: number) { return await lireTout(`/company/business/${encodeURIComponent(String(businessId))}/yards`) },
      async lireDevis(quoteId: number) { return await lire(`/company/quotes/${encodeURIComponent(String(quoteId))}`) },
      async facturesDuDevis(quoteId: number) {
        const filtre = encodeURIComponent(JSON.stringify({ quoteId }))
        let r = await lireTout(`/company/bills?filter=${filtre}`)
        if (!r.ok && (r.status === 400 || r.status === 422)) r = await lireTout("/company/bills")
        return r
      },
      async creerAcompte(quoteId: number, corps: unknown) { return await appel("POST", `/company/quotes/${encodeURIComponent(String(quoteId))}/advance-bill`, jeton, corps) },
    }

    const res = await traiterRequeteAutomatisation(requete, { appelant, depot, progbat, maintenant: new Date() })
    console.log(`[progbat-operations] appelant=${appelant?.id ?? "anonyme"} ${JSON.stringify((res as { journal?: unknown }).journal ?? { action: requete.action, http: res.http })} (${Date.now() - t0} ms)`)
    return json(res.body, res.http)
  } catch (err) {
    console.error(`[progbat-operations] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, code: "erreur_interne", error: "Erreur interne : " + nettoyerMessage((err as Error)?.message) }, 500)
  }
})
