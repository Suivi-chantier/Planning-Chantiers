import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { construirePlanClassement, donneesClassementPourHash, trouverFamilleMetier } from "./lib/progbatCategoryDispatch.mjs"

// Classement confirmé des ouvrages déjà liés. Les seules écritures ProGBat sont :
//   POST /company/library/families (famille métier absente)
//   PATCH /company/library/structures/{id} avec { families: [id] }
// Aucun prix, libellé, code, composant ou ouvrage n'est créé/supprimé ici.

const PROGBAT_API = "https://api.progbat.com/v2"
const PAGE_LIMIT = 50
const MAX_PAGES = 80
const GET_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 25_000
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
const nettoyer = (v: unknown) => String(v ?? "").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim().slice(0, 200)
const entier = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
const parseRange = (h: string | null) => { const m = (h || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/); return m ? { end: Number(m[2]), count: Number(m[3]) } : null }

type Methode = "GET" | "POST" | "PATCH"
type ApiResult = { ok: true; status: number; data: unknown; range?: { end: number; count: number } | null }
  | { ok: false; status: number; message: string; incertain?: boolean }

async function progbatFetch(method: Methode, path: string, token: string, body?: unknown): Promise<ApiResult> {
  const ctrl = new AbortController()
  const timeout = method === "GET" ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = nettoyer((data as Record<string, unknown> | null)?.message ?? (data as Record<string, unknown> | null)?.error ?? "")
      return { ok: false, status: res.status, message: `ProGBat a répondu HTTP ${res.status}${detail ? ` (${detail})` : ""}.`, incertain: method !== "GET" && (res.status === 408 || res.status >= 500) }
    }
    return { ok: true, status: res.status, data, range: parseRange(res.headers.get("Range")) }
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error)?.name === "AbortError" ? `Délai ProGBat dépassé (${timeout / 1000} s).` : "Connexion à ProGBat interrompue.", incertain: method !== "GET" }
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
    if (!['prepare', 'sync', 'status'].includes(action)) return json({ ok: false, error: "Action inconnue." }, 400)
    if (action === "status") {
      const { data, error } = await admin.from("progbat_library_category_sync_items")
        .select("id,progbat_structure_id,family_label,progbat_family_id,statut,started_at,finished_at,http_status,error_message")
        .order("started_at", { ascending: false }).limit(200)
      return error ? json({ ok: false, error: "Lecture du suivi impossible." }, 500) : json({ ok: true, items: data || [] })
    }

    const [ouvrages, lotsCfg, structures, familles, hist, histFam] = await Promise.all([
      admin.from("bibliotheque_ratios").select("id,libelle,progbat_id").not("progbat_id", "is", null),
      admin.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
      getAll("/company/library/structures", token),
      getAll("/company/library/families", token),
      admin.from("progbat_library_category_sync_items").select("progbat_structure_id,progbat_family_id,family_label,statut,started_at").order("started_at", { ascending: false }),
      admin.from("progbat_library_family_sync_items").select("family_label,progbat_family_id,statut,started_at").order("started_at", { ascending: false }),
    ])
    if (ouvrages.error || lotsCfg.error || hist.error || histFam.error) return json({ ok: false, error: "Lecture des données Profero impossible." }, 500)
    if (!structures.ok) return json({ ok: false, error: structures.message, etape: "structures", progbat_status: structures.status }, 200)
    if (!familles.ok) return json({ ok: false, error: familles.message, etape: "familles", progbat_status: familles.status }, 200)
    const lots = Array.isArray((lotsCfg.data?.value as Record<string, unknown> | null)?.items) ? (lotsCfg.data?.value as Record<string, unknown>).items : []
    const plan = construirePlanClassement({
      ouvrages: ouvrages.data || [], structures: structures.items, familles: familles.items,
      lots, historique: hist.data || [], historiqueFamilles: histFam.data || [],
    })
    const planHash = await hashSha256(donneesClassementPourHash(plan))
    if (action === "prepare") {
      console.log(`[progbat-library-categories] appelant=${user.id} action=prepare classement=${plan.compteurs.a_classer} familles=${plan.compteurs.familles_a_creer} exclus=${plan.compteurs.exclus} (${Date.now() - started} ms)`)
      return json({ ok: true, action, planHash, plan, aucune_ecriture: true })
    }
    if (body.confirmed !== true) return json({ ok: false, error: "Confirmation explicite requise.", code: "confirmation_requise" }, 400)
    if (String(body.expectedPlanHash || "") !== planHash) return json({ ok: false, error: "Le classement a changé depuis l’aperçu. Relancer la préparation.", code: "plan_modifie", planHash }, 409)
    if (!plan.actions.length) return json({ ok: false, error: "Aucun ouvrage sûr à classer.", code: "plan_vide" }, 400)

    const idsFamilles = new Map<string, number>()
    for (const f of familles.items as Record<string, unknown>[]) {
      const id = entier(f?.id)
      if (id) idsFamilles.set(String(f.label || "").trim().toLocaleLowerCase("fr"), id)
    }
    const resultatsFamilles: Record<string, unknown>[] = []
    let interrompu = false
    for (const cible of plan.famillesACreer) {
      if (interrompu) break
      const { data: reservation, error: reserveError } = await admin.from("progbat_library_family_sync_items").insert({
        family_label: cible.label, plan_hash: planHash, statut: "creating", created_by: user.id, created_by_email: user.email,
      }).select("id").single()
      if (reserveError) { resultatsFamilles.push({ label: cible.label, statut: "conflit" }); interrompu = true; break }
      const finir = (patch: Record<string, unknown>) => admin.from("progbat_library_family_sync_items").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", reservation.id)
      const rep = await progbatFetch("POST", "/company/library/families", token, cible.payload)
      if (!rep.ok) {
        const statut = rep.incertain ? "uncertain" : "failed"
        await finir({ statut, http_status: rep.status || null, error_message: rep.message })
        resultatsFamilles.push({ label: cible.label, statut, error: rep.message }); interrompu = true; break
      }
      let familyId = entier((rep.data as Record<string, unknown> | null)?.id)
      if (!familyId) {
        const relues = await getAll("/company/library/families", token)
        if (relues.ok) familyId = trouverFamilleMetier(relues.items, cible.label).id
      }
      if (!familyId) {
        await finir({ statut: "uncertain", http_status: rep.status, error_message: "Famille créée sans identifiant vérifiable" })
        resultatsFamilles.push({ label: cible.label, statut: "uncertain" }); interrompu = true; break
      }
      idsFamilles.set(cible.label.trim().toLocaleLowerCase("fr"), familyId)
      await finir({ statut: "created", progbat_family_id: familyId, http_status: rep.status })
      resultatsFamilles.push({ label: cible.label, statut: "created", familyId })
    }

    const resultats: Record<string, unknown>[] = []
    for (const item of plan.actions) {
      if (interrompu) { resultats.push({ structureId: item.structureId, codes: item.codes, statut: "non_execute" }); continue }
      const familyId = item.familleId || idsFamilles.get(item.familleLabel.trim().toLocaleLowerCase("fr"))
      if (!familyId) { resultats.push({ structureId: item.structureId, codes: item.codes, statut: "failed", error: "Famille cible introuvable." }); interrompu = true; continue }
      const { data: reservation, error: reserveError } = await admin.from("progbat_library_category_sync_items").insert({
        ouvrage_id: item.ouvrageId, ouvrage_ids: item.ouvrageIds, progbat_structure_id: item.structureId,
        family_label: item.familleLabel, progbat_family_id: familyId,
        previous_family_ids: item.anciennesFamilles?.ids || [], plan_hash: planHash,
        statut: "categorizing", created_by: user.id, created_by_email: user.email,
      }).select("id").single()
      if (reserveError) { resultats.push({ structureId: item.structureId, codes: item.codes, statut: "conflit" }); continue }
      const finir = (patch: Record<string, unknown>) => admin.from("progbat_library_category_sync_items").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", reservation.id)
      const rep = await progbatFetch("PATCH", `/company/library/structures/${item.structureId}`, token, { families: [familyId] })
      if (!rep.ok) {
        const statut = rep.incertain ? "uncertain" : "failed"
        await finir({ statut, http_status: rep.status || null, error_message: rep.message })
        resultats.push({ structureId: item.structureId, codes: item.codes, familleLabel: item.familleLabel, statut, error: rep.message })
        if (rep.incertain || [401, 403, 429].includes(rep.status)) interrompu = true
        continue
      }
      await finir({ statut: "categorized", http_status: rep.status })
      resultats.push({ structureId: item.structureId, codes: item.codes, familleLabel: item.familleLabel, familyId, statut: "categorized" })
    }

    const compteurs = Object.fromEntries(["categorized", "failed", "uncertain", "conflit", "non_execute"].map((s) => [s, resultats.filter((r) => r.statut === s).length]))
    const famillesCreees = resultatsFamilles.filter((r) => r.statut === "created").length
    const ok = !interrompu && compteurs.failed === 0 && compteurs.uncertain === 0 && compteurs.conflit === 0
    console.log(`[progbat-library-categories] appelant=${user.id} action=sync familles=${famillesCreees} ${JSON.stringify(compteurs)} (${Date.now() - started} ms)`)
    return json({ ok, action, planHash, familles_creees: famillesCreees, compteurs, resultats, resultats_familles: resultatsFamilles, verification_manuelle: compteurs.uncertain > 0 || resultatsFamilles.some((r) => r.statut === "uncertain") })
  } catch (e) {
    console.error(`[progbat-library-categories] erreur=${nettoyer((e as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne de classement." }, 500)
  }
})
