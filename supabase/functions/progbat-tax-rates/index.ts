import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-tax-rates
// Taux de TVA ProGBat, STRICTEMENT EN LECTURE SEULE : un seul appel GET, aucune
// écriture ni dans ProGBat ni dans Supabase.
//
// Sert à la page Chiffrage (aperçu du devis ProGBat) pour convertir un taux
// (10 %, 20 %…) en `taxRateId` ProGBat. Les identifiants viennent toujours de
// cette réponse : ils ne sont jamais fixés en dur dans l'application.
//
// Endpoint ProGBat (OpenAPI officielle https://progbat.readme.io/reference/taxes.md,
// serveur https://api.progbat.com/v2) :
//   GET /company/taxes   scope `tax-rates` ou `tax-rates.read`
//   → tableau TaxResponse { id, rate, label, saleDefault, purchaseDefault, legalText }
//
// Secret : PROGBAT_PRIVATE_ACCESS_TOKEN (Authorization: Bearer), jamais renvoyé,
// jamais journalisé, jamais transmis au navigateur. Les corps de réponse ne
// sont pas journalisés ; seuls le code HTTP et le nombre de taux le sont.
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif et rôle
// ≠ `ouvrier` (même règle que progbat-test-connection et progbat-library-inventory).
//
// Appel : supabase.functions.invoke("progbat-tax-rates")
// Réponse : { ok, lecture_seule: true, aucune_ecriture: true, recupere_le,
//             taux: [{ id, rate, label, saleDefault, purchaseDefault }] }
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 10_000

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
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis (tax-rates.read)." + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type ProgbatResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; message: string }

// GET en lecture seule, délai maximal. Ne journalise ni en-têtes ni corps ;
// ne renvoie jamais le corps brut en erreur.
async function progbatGet(path: string, token: string): Promise<ProgbatResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = ""
      try {
        const body = await res.json()
        detail = nettoyerMessage(body?.message ?? body?.error_description ?? body?.error ?? "")
      } catch { /* corps non JSON : ignoré */ }
      return { ok: false, status: res.status, message: messagePourStatus(res.status, detail) }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, data }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, status: 0, message: `ProGBat n'a pas répondu en ${TIMEOUT_MS / 1000} s (délai dépassé).` }
    }
    return { ok: false, status: 0, message: "Connexion à ProGBat impossible (réseau ou DNS)." }
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
      return json({ ok: false, error: "Lecture réservée aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Secret ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    if (!token) {
      console.warn("[progbat-tax-rates] secret PROGBAT_PRIVATE_ACCESS_TOKEN absent")
      return json({ ok: false, progbat_status: null, error: "Secret PROGBAT_PRIVATE_ACCESS_TOKEN non configuré dans Supabase." }, 500)
    }

    // ── 3. GET /company/taxes (lecture seule) ───────────────────────────────
    const r = await progbatGet("/company/taxes", token)
    if (!r.ok) {
      console.warn(`[progbat-tax-rates] appelant=${caller.id} /company/taxes → HTTP ${r.status} (${Date.now() - t0} ms)`)
      return json({ ok: false, progbat_status: r.status, error: r.message }, 200)
    }
    const liste = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : []
    const taux = liste
      .map((t) => ({
        id: Number.isInteger(t.id) ? t.id as number : (typeof t.id === "string" && /^\d+$/.test(t.id) ? Number(t.id) : null),
        rate: num(t.rate),
        label: typeof t.label === "string" ? t.label : "",
        saleDefault: t.saleDefault === true,
        purchaseDefault: t.purchaseDefault === true,
      }))
      .filter((t) => t.id != null && t.rate != null)
      .sort((a, b) => (a.rate as number) - (b.rate as number))

    console.log(`[progbat-tax-rates] appelant=${caller.id} /company/taxes → ${r.status}, ${taux.length} taux (${Date.now() - t0} ms)`)

    return json({
      ok: true,
      lecture_seule: true,
      aucune_ecriture: true,
      progbat_status: r.status,
      recupere_le: new Date().toISOString(),
      nb_ignores: liste.length - taux.length,
      taux,
    })
  } catch (err) {
    console.error(`[progbat-tax-rates] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne de la lecture des taux de TVA." }, 500)
  }
})
