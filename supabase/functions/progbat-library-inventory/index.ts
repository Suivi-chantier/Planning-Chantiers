import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { rapprocherBibliotheque, motifsBlocage } from "./lib/progbatInventaire.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-library-inventory
// Inventaire et SIMULATION de synchronisation de la bibliothèque d'ouvrages,
// STRICTEMENT EN LECTURE SEULE : aucune écriture dans ProGBat (GET uniquement)
// ni dans Supabase (SELECT uniquement). Aucun progbat_id n'est enregistré.
//
// Endpoints ProGBat utilisés (OpenAPI officielle https://progbat.readme.io,
// serveur https://api.progbat.com/v2) :
//   GET /me                          scope profile / profile.read      compte utilisé
//   GET /company/library/structures  scope structures / structures.read   ouvrages (paginé)
//   GET /company/library/elements    scope elements / elements.read       éléments (paginé)
//   GET /company/library/units       scope elements / elements.read       unités (paginé)
//   GET /company/taxes               scope tax-rates / tax-rates.read     taux de TVA actifs
// Pagination : `limit` (défaut 50) + `offset`, total dans l'en-tête
// `Range: {start} - {end} / {count}` (voir reference/list-pagination).
//
// Données Supabase lues : bibliotheque_ratios, materiaux_bibliotheque,
// planning_config (taux_mo_previsionnel, chiffrage_tva_defaut).
//
// Règles de rapprochement et de complétude : lib/progbatInventaire.mjs (copie
// de src/Renovation/progbatInventaire.mjs, régénérée par
// scripts/sync-progbat-edge-lib.mjs — ne pas éditer la copie).
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif et rôle
// ≠ `ouvrier` (même règle que App.jsx → destForProfil et progbat-test-connection).
// Secret : PROGBAT_PRIVATE_ACCESS_TOKEN uniquement, jamais renvoyé ni journalisé.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 15_000
const PAGE_LIMIT = 50      // = défaut documenté : un plafond ProGBat plus bas ne peut pas tromper la boucle
const MAX_PAGES = 80       // 4 000 lignes par liste au maximum, garde-fou contre une boucle infinie

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const nettoyerMessage = (raw: unknown): string => {
  let s = typeof raw === "string" ? raw : ""
  s = s.replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim()
  return s.slice(0, 200)
}

const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis." + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type ProgbatResult =
  | { ok: true; status: number; data: unknown; range: { start: number; end: number; count: number } | null }
  | { ok: false; status: number; message: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Analyse `Range: 0 - 49 / 120` → { start: 0, end: 49, count: 120 }
const parseRange = (h: string | null) => {
  const m = (h || "").match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/)
  return m ? { start: Number(m[1]), end: Number(m[2]), count: Number(m[3]) } : null
}

// GET en lecture seule, délai maximal, une relance après 429. Ne journalise ni
// en-têtes ni corps ; ne renvoie jamais le corps brut en erreur.
async function progbatGet(pathAndQuery: string, token: string, retries = 1): Promise<ProgbatResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}${pathAndQuery}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    })
    if (res.status === 429 && retries > 0) {
      clearTimeout(timer)
      const ra = Number(res.headers.get("Retry-After"))
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000, 5000))
      return progbatGet(pathAndQuery, token, retries - 1)
    }
    if (!res.ok) {
      let detail = ""
      try {
        const body = await res.json()
        detail = nettoyerMessage(body?.message ?? body?.error_description ?? body?.error ?? "")
      } catch { /* corps non JSON : ignoré */ }
      return { ok: false, status: res.status, message: messagePourStatus(res.status, detail) }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, data, range: parseRange(res.headers.get("Range")) }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, status: 0, message: `ProGBat n'a pas répondu en ${TIMEOUT_MS / 1000} s (délai dépassé).` }
    }
    return { ok: false, status: 0, message: "Connexion à ProGBat impossible (réseau ou DNS)." }
  } finally {
    clearTimeout(timer)
  }
}

type ListeResult = {
  ok: boolean
  status: number
  items: unknown[]
  pages: number
  total: number | null
  tronque: boolean
  message?: string
}

// Récupère TOUTES les pages d'une liste (limit/offset + en-tête Range).
async function progbatGetAll(path: string, token: string): Promise<ListeResult> {
  const items: unknown[] = []
  let offset = 0
  let total: number | null = null
  let pages = 0
  let status = 0
  while (pages < MAX_PAGES) {
    const r = await progbatGet(`${path}?limit=${PAGE_LIMIT}&offset=${offset}`, token)
    if (!r.ok) return { ok: false, status: r.status, items, pages, total, tronque: false, message: r.message }
    status = r.status
    pages++
    const arr = Array.isArray(r.data) ? r.data : []
    items.push(...arr)
    if (r.range && Number.isFinite(r.range.count)) total = r.range.count
    offset += arr.length
    if (arr.length === 0) break
    if (total != null && offset >= total) break
    if (total == null && arr.length < PAGE_LIMIT) break
  }
  const tronque = pages >= MAX_PAGES && (total == null || offset < total)
  return { ok: true, status, items, pages, total: total ?? items.length, tronque }
}

const resumeListe = (r: ListeResult) => ({
  ok: r.ok,
  status: r.status,
  nb: r.items.length,
  total_annonce: r.total,
  pages: r.pages,
  tronque: r.tronque,
  ...(r.message ? { erreur: r.message } : {}),
})

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
  return Number.isFinite(n) ? n : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405)

  const t0 = Date.now()
  try {
    // ── 1. Appelant : utilisateur Supabase authentifié, profil bureau actif ──
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ ok: false, error: "Non authentifié." }, 401)
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller?.email) return json({ ok: false, error: "Non authentifié." }, 401)

    const { data: profil } = await admin
      .from("utilisateurs")
      .select("role, actif")
      .eq("email", caller.email.toLowerCase())
      .maybeSingle()
    if (!profil || profil.actif === false || profil.role === "ouvrier") {
      return json({ ok: false, error: "Analyse réservée aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Secret ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    if (!token) {
      console.warn("[progbat-library-inventory] secret PROGBAT_PRIVATE_ACCESS_TOKEN absent")
      return json({ ok: false, error: "Secret PROGBAT_PRIVATE_ACCESS_TOKEN non configuré dans Supabase." }, 500)
    }

    // ── 3. Données Profero (SELECT uniquement) ───────────────────────────────
    const [ouvRes, matRes, cfgRes] = await Promise.all([
      admin.from("bibliotheque_ratios")
        .select("id, libelle, unite, cadence, materiaux_liens, taux_marge_pct, coef_vente, main_oeuvre_seule, cout_direct_unitaire, progbat_id")
        .order("libelle"),
      admin.from("materiaux_bibliotheque").select("id, nom, unite, prix_unitaire"),
      admin.from("planning_config").select("key, value").in("key", ["taux_mo_previsionnel", "chiffrage_tva_defaut"]),
    ])
    if (ouvRes.error) return json({ ok: false, error: "Lecture de la bibliothèque impossible : " + nettoyerMessage(ouvRes.error.message) }, 500)
    if (matRes.error) return json({ ok: false, error: "Lecture des matériaux impossible : " + nettoyerMessage(matRes.error.message) }, 500)
    const cfg = (cfgRes.data || []) as { key: string; value: unknown }[]
    const coutHoraire = num(cfg.find((r) => r.key === "taux_mo_previsionnel")?.value)
    const tvaDefaut = num(cfg.find((r) => r.key === "chiffrage_tva_defaut")?.value)

    // ── 4. ProGBat : compte, structures, éléments, unités, TVA (GET) ─────────
    const me = await progbatGet("/me", token)
    if (!me.ok) {
      console.warn(`[progbat-library-inventory] appelant=${caller.id} /me → HTTP ${me.status}`)
      return json({ ok: false, etape: "me", progbat_status: me.status, error: me.message }, 200)
    }
    const m = (me.data ?? {}) as Record<string, unknown>
    const compte = {
      prenom: typeof m.firstname === "string" ? m.firstname : "",
      nom: typeof m.lastname === "string" ? m.lastname : "",
      email: typeof m.email === "string" ? m.email : "",
    }

    const [structures, elements, unites] = await Promise.all([
      progbatGetAll("/company/library/structures", token),
      progbatGetAll("/company/library/elements", token),
      progbatGetAll("/company/library/units", token),
    ])
    const taxesRes = await progbatGet("/company/taxes", token)
    const taxes = taxesRes.ok && Array.isArray(taxesRes.data) ? taxesRes.data as Record<string, unknown>[] : []

    const progbat = {
      structures: resumeListe(structures),
      elements: resumeListe(elements),
      unites: resumeListe(unites),
      taxes: { ok: taxesRes.ok, status: taxesRes.status, nb: taxes.length, ...(taxesRes.ok ? {} : { erreur: taxesRes.message }) },
    }
    console.log(
      `[progbat-library-inventory] appelant=${caller.id} structures=${structures.status}/${structures.items.length} ` +
      `elements=${elements.status}/${elements.items.length} unites=${unites.status}/${unites.items.length} taxes=${taxesRes.status} (${Date.now() - t0} ms)`,
    )

    // Sans les structures, aucune comparaison n'est possible.
    if (!structures.ok) {
      return json({
        ok: false, etape: "structures", progbat_status: structures.status, error: structures.message,
        compte_progbat: compte, progbat, aucune_ecriture: true,
      }, 200)
    }

    // ── 5. Rapprochement (module pur) ────────────────────────────────────────
    const resultat = rapprocherBibliotheque({
      ouvrages: ouvRes.data || [],
      structures: structures.items,
      materiaux: matRes.data || [],
      coutHoraire,
      tvaDefaut,
      taxes: taxesRes.ok ? taxes : null,
      unites: unites.ok ? unites.items : null,
    })

    const taux_tva = taxes.map((t) => ({
      id: t.id ?? null,
      rate: num(t.rate),
      label: typeof t.label === "string" ? t.label : "",
      saleDefault: t.saleDefault === true,
    }))

    return json({
      ok: true,
      lecture_seule: true,
      aucune_ecriture: true,
      message: "Simulation en lecture seule — aucune donnée ProGBat ou Profero n'a été modifiée.",
      analyse_le: new Date().toISOString(),
      duree_ms: Date.now() - t0,
      compte_progbat: compte,
      progbat,
      taux_tva,
      unites_progbat: unites.ok ? (unites.items as Record<string, unknown>[]).map((u) => String(u.code ?? "")).filter(Boolean) : [],
      profero: {
        nb_ouvrages: (ouvRes.data || []).length,
        nb_materiaux: (matRes.data || []).length,
        cout_horaire: coutHoraire,
        tva_defaut: tvaDefaut,
      },
      // Diagnostic : noms des champs réellement renvoyés par l'API pour les structures
      // (le schéma OpenAPI des listes ne documente pas le descriptif). Noms seulement, jamais les valeurs.
      champs_structure: [...new Set((structures.items as Record<string, unknown>[]).slice(0, 200).flatMap((s) => Object.keys(s || {})))].sort(),
      nb_ouvrages_profero: resultat.nb_ouvrages_profero,
      nb_structures_progbat: resultat.nb_structures_progbat,
      nb_elements_progbat: elements.items.length,
      compteurs: resultat.compteurs,
      sources_codes: resultat.sources_codes,   // structures ProGBat : code lu dans le champ API / le libellé / aucun
      nb_synchronisables: resultat.nb_synchronisables,
      nb_prets_a_creer: resultat.nb_prets_a_creer,
      motifs_blocage: motifsBlocage(resultat.rapprochements),
      rapprochements: resultat.rapprochements,
      ambiguites: resultat.ambiguites,
      bloques: resultat.bloques,
      progbat_non_lies: resultat.progbat_non_lies,
    })
  } catch (err) {
    console.error(`[progbat-library-inventory] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne de l'inventaire." }, 500)
  }
})
