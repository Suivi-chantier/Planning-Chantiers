import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { traiterRequeteCadences, nettoyerMessage } from "./lib/progbatCadencesServeur.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-library-cadences
// Import PONCTUEL des cadences ProGBat → bibliotheque_ratios.cadence.
//   • analyser  : GET ProGBat uniquement, aucune écriture métier ; plan figé côté
//                 serveur (progbat_cadence_import_plans) + hash SHA-256.
//   • confirmer : { planId, planHash, confirmed: true } — le serveur recharge le
//                 plan et délègue l'écriture à la fonction SQL
//                 progbat_cadences_appliquer (transaction unique, verrou,
//                 revalidation de chaque liaison et cadence, audit). Tout ou rien.
//   • status    : dernier import appliqué (aucune lecture ProGBat).
// Après l'import, Profero est la source de vérité : aucune tâche planifiée,
// aucune synchronisation récurrente ; toute relance repasse par analyse + confirmation.
//
// Endpoints ProGBat (OpenAPI officielle https://progbat.readme.io, serveur https://api.progbat.com/v2) :
//   GET /company/library/structures                      scope structures.read  existence + unité de chaque ouvrage lié (paginé)
//   GET /company/jobs                                     scope elements.read    jobs horaires (type 2, unité H)
//   GET /company/structures/{id}/composition?exploded=true scope structures.read composants (quantité en heures des jobs)
// AUCUN POST / PATCH / PUT / DELETE vers ProGBat. GET relancés raisonnablement
// (429 avec Retry-After, un essai supplémentaire sur 5xx / délai / réseau).
//
// Secret : PROGBAT_PRIVATE_ACCESS_TOKEN (Authorization: Bearer) — jamais renvoyé ni journalisé.
// Accès : JWT Supabase valide, profil `utilisateurs` actif, rôle ∈ ROLES_AUTORISES (admin, conducteur).
// Toute la logique métier est dans lib/progbatCadencesServeur.mjs + lib/progbatCadences.mjs
// (copies de src/Renovation, régénérées par scripts/sync-progbat-edge-lib.mjs).
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 15_000
const PAGE_LIMIT = 50
const MAX_PAGES = 80

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const parseRange = (h: string | null) => { const m = (h || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/); return m ? { end: Number(m[2]), count: Number(m[3]) } : null }

const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis." + suffix
  if (status === 404) return "Ressource ProGBat introuvable (404)." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type GetResult =
  | { ok: true; status: number; data: unknown; range: { end: number; count: number } | null }
  | { ok: false; status: number; message: string }

// GET strictement en lecture seule. Une relance sur 429 (Retry-After borné) et une
// sur 5xx / délai / réseau. Ne journalise ni en-têtes ni corps ; ne renvoie jamais le corps brut.
async function progbatGet(pathAndQuery: string, token: string, retries = 1): Promise<GetResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}${pathAndQuery}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    })
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      clearTimeout(timer)
      const ra = Number(res.headers.get("Retry-After"))
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500, 5000))
      return progbatGet(pathAndQuery, token, retries - 1)
    }
    if (!res.ok) {
      let detail = ""
      try { const b = await res.json(); detail = nettoyerMessage(b?.message ?? b?.error_description ?? b?.error ?? "") } catch { /* corps non JSON */ }
      return { ok: false, status: res.status, message: messagePourStatus(res.status, detail) }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, data, range: parseRange(res.headers.get("Range")) }
  } catch (err) {
    if (retries > 0) { clearTimeout(timer); await sleep(1000); return progbatGet(pathAndQuery, token, retries - 1) }
    if ((err as Error)?.name === "AbortError") return { ok: false, status: 0, message: `ProGBat n'a pas répondu en ${TIMEOUT_MS / 1000} s (délai dépassé).` }
    return { ok: false, status: 0, message: "Connexion à ProGBat impossible (réseau ou DNS)." }
  } finally { clearTimeout(timer) }
}

async function progbatGetAll(path: string, token: string) {
  const items: unknown[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const r = await progbatGet(`${path}${sep}limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}`, token)
    if (!r.ok) return { ok: false as const, status: r.status, message: r.message, items }
    const batch = Array.isArray(r.data) ? r.data : []
    items.push(...batch)
    if (batch.length === 0) break
    if (r.range && r.range.end + 1 >= r.range.count) break
    if (!r.range && batch.length < PAGE_LIMIT) break
  }
  return { ok: true as const, status: 200, items }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  const t0 = Date.now()
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } })

    // ── 1. Appelant ─────────────────────────────────────────────────────────
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    let appelant: { id: string; email: string; role: string | null; actif: boolean } | null = null
    if (jwt) {
      const { data: { user }, error } = await admin.auth.getUser(jwt)
      if (!error && user?.email) {
        const { data: profil } = await admin.from("utilisateurs").select("role, actif").eq("email", user.email.toLowerCase()).maybeSingle()
        appelant = { id: user.id, email: user.email, role: profil?.role ?? null, actif: profil ? profil.actif !== false : false }
      }
    }

    let requete: Record<string, unknown> = {}
    try { requete = await req.json() } catch { requete = {} }

    // ── 2. Secret ProGBat (jamais renvoyé ni journalisé) ────────────────────
    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""

    // ── 3. Adaptateurs injectés ─────────────────────────────────────────────
    const depot = {
      async chargerOuvrages() {
        const { data, error } = await admin.from("bibliotheque_ratios").select("id, libelle, unite, cadence, progbat_id").order("libelle")
        if (error) throw new Error("Lecture de la bibliothèque impossible : " + nettoyerMessage(error.message))
        return data || []
      },
      async enregistrerPlan(ligne: Record<string, unknown>) {
        const { data, error } = await admin.from("progbat_cadence_import_plans").insert(ligne).select("id").single()
        return error ? { ok: false, erreur: error.message } : { ok: true, id: data.id }
      },
      async chargerPlan(planId: string) {
        const { data, error } = await admin.from("progbat_cadence_import_plans").select("*").eq("id", planId).maybeSingle()
        if (error) throw new Error("Lecture du plan impossible : " + nettoyerMessage(error.message))
        return data
      },
      async appliquerPlan({ planId, planHash, userId, userEmail }: { planId: string; planHash: string; userId: string | null; userEmail: string }) {
        const { data, error } = await admin.rpc("progbat_cadences_appliquer", { p_plan_id: planId, p_plan_hash: planHash, p_user_id: userId, p_user_email: userEmail })
        if (error) return { ok: false, code: error.code ?? null, message: error.message ?? "" }
        const r = (data ?? {}) as Record<string, unknown>
        return { ok: r.ok === true, run_id: r.run_id ?? null, nb_modifies: Number(r.nb_modifies ?? 0), message: r.ok === true ? "" : "Réponse inattendue de la procédure" }
      },
      async enregistrerEchec({ planId, planHash, userId, userEmail, code, message }: { planId: string; planHash: string; userId: string | null; userEmail: string; code: string; message: string }) {
        await admin.from("progbat_cadence_import_runs").insert({ plan_id: planId, plan_hash: planHash, statut: "failed", created_by: userId, created_by_email: userEmail, finished_at: new Date().toISOString(), error_code: code, error_message: message })
        await admin.from("progbat_cadence_import_plans").update({ statut: "rejected", error_code: code, error_message: message }).eq("id", planId).eq("statut", "prepared")
        return { ok: true }
      },
      async dernierImport() {
        const { data } = await admin.from("progbat_cadence_import_runs").select("*").eq("statut", "applied").order("finished_at", { ascending: false }).limit(1).maybeSingle()
        return data
      },
    }

    const progbat = {
      jetonPresent: !!token,
      async listerStructures() { return await progbatGetAll("/company/library/structures", token) },
      async listerJobs() { return await progbatGetAll("/company/jobs", token) },
      async lireComposition(id: number) {
        const r = await progbatGet(`/company/structures/${encodeURIComponent(String(id))}/composition?exploded=true`, token)
        return r.ok ? { ok: true, data: r.data } : { ok: false, status: r.status, message: r.message }
      },
    }

    // ── 4. Logique pure ─────────────────────────────────────────────────────
    const res = await traiterRequeteCadences(requete, { appelant, depot, progbat, maintenant: new Date() })
    console.log(`[progbat-library-cadences] appelant=${appelant?.id ?? "anonyme"} ${JSON.stringify(res.journal ?? { action: requete.action, http: res.http })} (${Date.now() - t0} ms)`)
    return json(res.body, res.http)
  } catch (err) {
    console.error(`[progbat-library-cadences] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, code: "erreur_interne", error: "Erreur interne de l'import des cadences." }, 500)
  }
})
