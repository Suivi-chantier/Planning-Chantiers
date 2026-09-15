import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { traiterRequeteDevis, composerLotsOrdre, nettoyerMessage } from "./lib/progbatQuoteServeur.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-quote
// Création d'UN devis BROUILLON ProGBat à partir d'un logement Profero
// (profero_projets) entièrement valide. Trois actions :
//   • prepare : reconstruction serveur du payload + contrôles + hash — aucun POST
//   • create  : reconstruction, contrôles, comparaison du hash confirmé,
//               réservation anti-doublon puis POST officiel
//   • status  : statut connu du devis pour le logement — aucune écriture externe
//
// Le navigateur n'envoie que { action, projectId, expectedPayloadHash, confirmed } :
// prix, quantités, coordonnées et identifiants sont TOUJOURS rechargés depuis
// Supabase et reconstruits ici avec le générateur partagé (lib/progbatQuotePayload.mjs,
// copie de src/Renovation, régénérée par scripts/sync-progbat-edge-lib.mjs).
// Toute la logique métier est dans lib/progbatQuoteServeur.mjs (pur, testé dans
// Node avec des doublures) ; ce fichier n'est que l'adaptateur Deno/Supabase/fetch.
//
// Endpoints ProGBat (OpenAPI officielle https://progbat.readme.io, serveur https://api.progbat.com/v2) :
//   GET  /company/taxes              scope tax-rates.read   taux de TVA → taxRateId
//   POST /company/quotes             scope quotes           création d'un brouillon (201 → QuoteResponse { id, code, … })
//   GET  /company/quotes/{quoteId}   scope quotes.read      relecture de vérification après un POST réussi (jamais de second POST)
// La fonction ne finalise, n'envoie, n'accepte ni ne supprime jamais un devis.
//
// Secret : PROGBAT_PRIVATE_ACCESS_TOKEN (Authorization: Bearer) — jamais renvoyé,
// jamais journalisé. Journal autorisé : id Supabase de l'appelant, projectId,
// action, endpoint, code HTTP, identifiant du devis, statut interne, durée.
// Jamais de payload, de réponse brute ni de données personnelles.
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif, rôle ≠ ouvrier.
// Table de suivi : progbat_quote_exports (sql/202609_progbat_quote_exports.sql),
// accessible uniquement au service_role.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_GET_MS = 10_000
const TIMEOUT_POST_MS = 25_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 400 || status === 422) return `ProGBat a rejeté le contenu du devis (${status}).` + suffix
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis." + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type Resultat =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; message: string; timeout?: boolean; reseau?: boolean }

// Appel ProGBat avec délai maximal. Ne journalise ni en-têtes ni corps ; ne
// renvoie jamais le corps brut. `timeout` / `reseau` = issue INCONNUE côté ProGBat.
async function progbatFetch(method: "GET" | "POST", path: string, token: string, body?: unknown, timeoutMs = TIMEOUT_GET_MS): Promise<Resultat> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = ""
      try {
        const b = await res.json()
        detail = nettoyerMessage(b?.message ?? b?.error_description ?? b?.error ?? (Array.isArray(b?.errors) ? b.errors.map((e: unknown) => typeof e === "string" ? e : (e as Record<string, unknown>)?.message ?? "").join(" ; ") : ""))
      } catch { /* corps non JSON : ignoré */ }
      return { ok: false, status: res.status, message: messagePourStatus(res.status, detail) }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, data }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, status: 0, message: `ProGBat n'a pas répondu en ${timeoutMs / 1000} s (délai dépassé).`, timeout: true }
    }
    return { ok: false, status: 0, message: "Connexion à ProGBat interrompue (réseau ou DNS).", reseau: true }
  } finally {
    clearTimeout(timer)
  }
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
  return Number.isFinite(n) ? n : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)

  const t0 = Date.now()
  try {
    // ── 1. Appelant ─────────────────────────────────────────────────────────
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    let appelant: { id: string; email: string; role: string | null; actif: boolean | null } | null = null
    if (jwt) {
      const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt)
      if (!callerErr && caller?.email) {
        const { data: profil } = await admin
          .from("utilisateurs")
          .select("role, actif")
          .eq("email", caller.email.toLowerCase())
          .maybeSingle()
        appelant = { id: caller.id, email: caller.email, role: profil?.role ?? null, actif: profil ? profil.actif !== false : false }
      }
    }

    // ── 2. Requête ──────────────────────────────────────────────────────────
    let requete: Record<string, unknown> = {}
    try { requete = await req.json() } catch { requete = {} }

    // ── 3. Secret ProGBat (jamais renvoyé ni journalisé) ────────────────────
    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    if (!token) {
      console.warn("[progbat-quote] secret PROGBAT_PRIVATE_ACCESS_TOKEN absent")
      return json({ ok: false, code: "secret_absent", error: "Secret PROGBAT_PRIVATE_ACCESS_TOKEN non configuré dans Supabase." }, 500)
    }

    // ── 4. Adaptateurs injectés dans la logique pure ────────────────────────
    const depot = {
      async chargerProjet(projectId: string) {
        const { data, error } = await admin.from("profero_projets").select("*").eq("id", projectId).maybeSingle()
        if (error) throw new Error("Lecture du projet impossible : " + nettoyerMessage(error.message))
        return data
      },
      async chargerLignes(projectId: string) {
        const { data, error } = await admin.from("profero_ouvrages_selectionnes").select("*").eq("projet_id", projectId)
        if (error) throw new Error("Lecture des lignes impossible : " + nettoyerMessage(error.message))
        return data || []
      },
      async chargerLotsOrdre() {
        const [cfg, cats] = await Promise.all([
          admin.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
          admin.from("profero_categories_ouvrages").select("nom, ordre").order("ordre"),
        ])
        const items = (cfg.data?.value as Record<string, unknown> | null)?.items
        return composerLotsOrdre(items, (cats.data || []).map((c: Record<string, unknown>) => c.nom))
      },
      async dernierExport(projectId: string) {
        const { data, error } = await admin.from("progbat_quote_exports").select("*").eq("project_id", projectId).order("started_at", { ascending: false }).limit(1).maybeSingle()
        if (error) throw new Error("Lecture du suivi ProGBat impossible : " + nettoyerMessage(error.message))
        return data
      },
      async reserverExport(ligne: Record<string, unknown>) {
        const { data, error } = await admin.from("progbat_quote_exports").insert(ligne).select("id").single()
        if (error) {
          if (error.code === "23505") return { ok: false, conflit: true }          // index unique partiel : réservation concurrente
          return { ok: false, erreur: error.message }
        }
        return { ok: true, id: data.id }
      },
      async majExport(id: string, patch: Record<string, unknown>) {
        const { error } = await admin.from("progbat_quote_exports").update(patch).eq("id", id)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
      async majProjetDevis(projectId: string, patch: Record<string, unknown>) {
        const { error } = await admin.from("profero_projets").update(patch).eq("id", projectId)
        return error ? { ok: false, erreur: error.message } : { ok: true }
      },
    }

    const progbat = {
      jetonPresent: true,
      async lireTaux() {
        const r = await progbatFetch("GET", "/company/taxes", token)
        if (!r.ok) return { ok: false, status: r.status, message: r.message }
        const liste = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : []
        return {
          ok: true,
          taux: liste.map((t) => ({
            id: Number.isInteger(t.id) ? t.id : (typeof t.id === "string" && /^\d+$/.test(t.id) ? Number(t.id) : null),
            rate: num(t.rate),
            label: typeof t.label === "string" ? t.label : "",
            saleDefault: t.saleDefault === true,
          })).filter((t) => t.id != null && t.rate != null),
        }
      },
      async creerDevis(payload: unknown) {
        // Le SEUL appel d'écriture de cette fonction : un POST, jamais rejoué.
        return await progbatFetch("POST", "/company/quotes", token, payload, TIMEOUT_POST_MS)
      },
      async lireDevis(quoteId: number) {
        // Lecture de confirmation (GET officiel) ; son échec n'entraîne aucun nouveau POST.
        return await progbatFetch("GET", `/company/quotes/${encodeURIComponent(String(quoteId))}`, token)
      },
    }

    // ── 5. Logique pure ─────────────────────────────────────────────────────
    const res = await traiterRequeteDevis(requete, { appelant, depot, progbat, maintenant: new Date() })
    const j = (res as { journal?: Record<string, unknown> }).journal
    console.log(`[progbat-quote] appelant=${appelant?.id ?? "anonyme"} ${JSON.stringify(j ?? { action: requete.action, http: res.http })} (${Date.now() - t0} ms)`)
    return json(res.body, res.http)
  } catch (err) {
    console.error(`[progbat-quote] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, code: "erreur_interne", error: "Erreur interne : " + nettoyerMessage((err as Error)?.message) }, 500)
  }
})
