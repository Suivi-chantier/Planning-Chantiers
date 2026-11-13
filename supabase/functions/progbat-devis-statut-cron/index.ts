import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { synchroniserStatutsDevis } from "./lib/progbatStatutDevis.mjs"
import { diagnostiquer, diagnostiquerRemplissageClients } from "./lib/progbatDiagnosticLot4.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-devis-statut-cron — Refonte Opérations, lot 4.
// Lecture du STATUT des devis ProGBat (0 étude/brouillon, 1 accepté, 2 refusé,
// 6 en attente) pour chaque chiffrage qui a un devis, par tâche planifiée
// (pg_cron « progbat-devis-statut », toutes les heures de 6 h à 19 h UTC).
// Pas de webhook ProGBat.
//
// UN SEUL VERBE SORTANT VERS ProGBat : GET. La seule écriture est dans la base
// Profero (profero_projets.progbat_devis_statut / _le / _lu_le).
//
// Porte : en-tête x-progbat-cron-secret = PROGBAT_BILLING_CRON_SECRET (le même
// secret serveur que progbat-billing-sync-cron, porté par le cron depuis le
// coffre « progbat_billing_cron_secret »). Aucun autre accès.
// Déploiement : verify_jwt = false (la porte est le secret, comme
// progbat-billing-sync-cron).
//
// Actions (corps JSON) :
//   { action: "statuts" }      (défaut) lecture des statuts, mise à jour de la base
//   { action: "diagnostic" }   vérifications du lot 4 (GET uniquement, formes et
//                              valeurs techniques, jamais les coordonnées d'un client)
//   { action: "remplissage_clients" }  taux de remplissage des champs des
//                              clients ProGBat (liste + détail de chacun), GET
//                              uniquement, jamais une valeur (demande du 07/11)
//   { action: "docs", urls }   lecture de la documentation PUBLIQUE ProGBat
//                              (progbat.readme.io, aucun jeton envoyé)
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 15_000
const nettoyerMessage = (raw: unknown) => (typeof raw === "string" ? raw : "").replace(/bearer\s+\S+/gi, "[masqué]").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim().slice(0, 240)
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "Content-Type": "application/json" } })

async function egal(a: string, b: string) {
  if (!a || !b) return false
  const e = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", e.encode(a)), crypto.subtle.digest("SHA-256", e.encode(b))])
  const u = new Uint8Array(x), v = new Uint8Array(y)
  let d = 0
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]
  return d === 0
}

async function get(path: string, token: string) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: ctrl.signal })
    const range = res.headers.get("content-range") || res.headers.get("range")
    let body: unknown = null
    try { body = await res.json() } catch { body = null }
    if (!res.ok) {
      const b = body as Record<string, unknown> | null
      return { ok: false, status: res.status, message: nettoyerMessage(String(b?.message ?? b?.error_description ?? b?.error ?? "")), range }
    }
    return { ok: true, status: res.status, data: body, range }
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error)?.name === "AbortError" ? "délai dépassé" : "réseau" }
  } finally { clearTimeout(t) }
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  const secret = Deno.env.get("PROGBAT_BILLING_CRON_SECRET") || ""
  if (!secret) return json({ ok: false, error: "Déclencheur non configuré : secret serveur PROGBAT_BILLING_CRON_SECRET absent." }, 500)
  if (!(await egal(req.headers.get("x-progbat-cron-secret") || "", secret))) return json({ ok: false, error: "Appel non autorisé : en-tête x-progbat-cron-secret absent ou invalide." }, 401)
  let corps: Record<string, unknown> = {}
  try { corps = await req.json() } catch { corps = {} }
  const action = typeof corps.action === "string" ? corps.action : "statuts"

  const jetons: Record<string, string> = {
    devis: Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || "",
    facturation: Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || "",
  }

  if (action === "docs") {
    const urls = (Array.isArray(corps.urls) ? corps.urls : []).filter((u: unknown) => typeof u === "string" && (u as string).startsWith("https://progbat.readme.io/")).slice(0, 6)
    const docs: Record<string, unknown> = {}
    for (const u of urls as string[]) {
      try {
        const r = await fetch(u, { method: "GET" })
        docs[u] = { status: r.status, texte: (await r.text()).slice(0, Number(corps.max) || 40000) }
      } catch (e) { docs[u] = { status: 0, erreur: String((e as Error)?.message || e) } }
    }
    return json({ ok: true, docs })
  }

  if (action === "remplissage_clients") {
    if (!jetons.devis) return json({ ok: false, error: "Jeton ProGBat PROGBAT_PRIVATE_ACCESS_TOKEN non configuré." }, 500)
    const lireListe = async (chemin: string) => {
      const tout: unknown[] = []
      for (let p = 0; p < 10; p++) {
        const r = await get(`${chemin}${chemin.includes("?") ? "&" : "?"}limit=100&offset=${p * 100}`, jetons.devis)
        if (!r.ok) return p === 0 ? r : { ok: true, status: 200, data: tout }
        const lot = Array.isArray(r.data) ? r.data : []
        tout.push(...lot)
        if (lot.length < 100) break
      }
      return { ok: true, status: 200, data: tout }
    }
    const rapport = await diagnostiquerRemplissageClients({
      max: Number(corps.max) || 150,
      lire: async (chemin: string, { liste }: { liste: boolean }) => (liste ? await lireListe(chemin) : await get(chemin, jetons.devis)),
    })
    return json({ ok: true, rapport })
  }

  if (action === "diagnostic") {
    const rapport = await diagnostiquer({
      cles: Array.isArray(corps.cles) ? corps.cles as string[] : null,
      jetonsDisponibles: { devis: !!jetons.devis, facturation: !!jetons.facturation },
      lire: async (chemin: string, j: string, { liste }: { liste: boolean }) => {
        const token = jetons[j]
        if (!liste) return await get(chemin, token)
        const tout: unknown[] = []
        let total: number | null = null
        for (let p = 0; p < 10; p++) {
          const r = await get(`${chemin}${chemin.includes("?") ? "&" : "?"}limit=100&offset=${p * 100}`, token)
          if (!r.ok) return p === 0 ? r : { ok: true, status: 200, data: tout, total }
          const lot = Array.isArray(r.data) ? r.data : []
          tout.push(...lot)
          const m = String(r.range || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/)
          if (m) total = Number(m[3])
          if (lot.length < 100 || (total != null && tout.length >= total)) break
        }
        return { ok: true, status: 200, data: tout, total: total ?? tout.length }
      },
    })
    return json({ ok: true, jetons: { devis: !!jetons.devis, facturation: !!jetons.facturation }, rapport })
  }

  if (action !== "statuts") return json({ ok: false, error: "Action inconnue." }, 400)
  if (!jetons.devis) return json({ ok: false, error: "Jeton ProGBat PROGBAT_PRIVATE_ACCESS_TOKEN non configuré." }, 500)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } })
  const t0 = Date.now()
  const rapport = await synchroniserStatutsDevis({
    maintenant: new Date(),
    depot: {
      async devisASuivre() {
        const { data, error } = await admin.from("profero_projets").select("id, progbat_devis_id, progbat_devis_statut").not("progbat_devis_id", "is", null).order("progbat_devis_statut_lu_le", { ascending: true, nullsFirst: true }).limit(150)
        if (error) throw new Error(nettoyerMessage(error.message))
        return data || []
      },
      async majProjet(id: string, patch: Record<string, unknown>) {
        const { error } = await admin.from("profero_projets").update(patch).eq("id", id)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
    },
    progbat: {
      async lireDevis(quoteId: number) {
        const r = await get(`/company/quotes/${encodeURIComponent(String(quoteId))}`, jetons.devis)
        if (!r.ok && r.status === 403 && jetons.facturation) return await get(`/company/quotes/${encodeURIComponent(String(quoteId))}`, jetons.facturation)
        return r
      },
    },
  })
  console.log(`[progbat-devis-statut-cron] lus=${rapport.lus} introuvables=${rapport.introuvables} changés=${rapport.changes} acceptés=${rapport.acceptes} refusés=${rapport.refuses} erreurs=${rapport.erreurs} (${Date.now() - t0} ms)`)
  return json({ ok: rapport.erreurs === 0, ...rapport }, rapport.erreurs && !rapport.lus ? 502 : 200)
})
