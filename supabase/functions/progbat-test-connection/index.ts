import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-test-connection
// Test de connexion STRICTEMENT EN LECTURE SEULE à l'API ProGBat.
//
// Objectif : vérifier que le jeton d'accès privé ProGBat fonctionne et qu'il
// correspond bien au compte Profero Rénovation, AVANT toute synchronisation
// (bibliothèque, devis…). Aucune écriture, ni dans ProGBat, ni dans Supabase.
//
// Endpoints ProGBat utilisés (documentation officielle, OpenAPI
// https://progbat.readme.io/reference/me.md et .../my-company.md) :
//   GET https://api.progbat.com/v2/me          scope `profile` ou `profile.read`
//       → profil de l'utilisateur porteur du jeton (id, firstname, lastname, email…)
//   GET https://api.progbat.com/v2/clients/me  scope `profile` ou `company-accounts.read`
//       → tableau des sociétés du compte (id, legalName, businessName, siren…)
//
// Secret Supabase utilisé : PROGBAT_PRIVATE_ACCESS_TOKEN (jeton privé, envoyé
// en `Authorization: Bearer`). PROGBAT_CLIENT_ID / PROGBAT_CLIENT_SECRET ne sont
// volontairement PAS utilisés ici (réservés au futur flux OAuth).
// Le jeton n'est jamais renvoyé, ni journalisé, ni inclus dans un message.
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif et
// rôle « bureau » (tout rôle sauf `ouvrier`) — même règle que le routeur de
// l'application (App.jsx → destForProfil) et que admin-users-local.
//
// Appel (POST ou GET, corps vide) :
//   supabase.functions.invoke("progbat-test-connection")
// Réponse (jamais de donnée sensible) :
//   { ok, progbat_status, message, utilisateur: { prenom, nom, email },
//     entreprise: { id, nom } | null, entreprises: [{ id, nom }], entreprise_status }
//
// Déploiement :
//   npx supabase functions deploy progbat-test-connection --project-ref <ref>
//   (« Verify JWT » activé)
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

// Nettoie un message d'erreur venant de ProGBat avant de le renvoyer :
// texte court, sans séquence ressemblant à un jeton ou une clé.
const nettoyerMessage = (raw: unknown): string => {
  let s = typeof raw === "string" ? raw : ""
  s = s.replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim()
  return s.slice(0, 200)
}

// Message lisible selon le code HTTP ProGBat.
const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis (profile.read)." + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type ProgbatResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; message: string }

// GET en lecture seule sur l'API ProGBat, avec délai maximal.
// Ne journalise jamais les en-têtes ni le corps ; ne renvoie jamais le corps brut en erreur.
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
    // Même règle que l'application : compte actif et rôle bureau (≠ ouvrier).
    if (!profil || profil.actif === false || profil.role === "ouvrier") {
      return json({ ok: false, error: "Test réservé aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Secret ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const token = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    if (!token) {
      console.warn("[progbat-test-connection] secret PROGBAT_PRIVATE_ACCESS_TOKEN absent")
      return json({ ok: false, progbat_status: null, error: "Secret PROGBAT_PRIVATE_ACCESS_TOKEN non configuré dans Supabase." }, 500)
    }

    // ── 3. GET /me : valide le jeton et le scope profile.read ────────────────
    const me = await progbatGet("/me", token)
    if (!me.ok) {
      console.warn(`[progbat-test-connection] appelant=${caller.id} /me → HTTP ${me.status} (${Date.now() - t0} ms)`)
      return json({ ok: false, progbat_status: me.status, error: me.message }, 200)
    }
    const m = (me.data ?? {}) as Record<string, unknown>
    const utilisateur = {
      prenom: typeof m.firstname === "string" ? m.firstname : "",
      nom: typeof m.lastname === "string" ? m.lastname : "",
      email: typeof m.email === "string" ? m.email : "",
    }

    // ── 4. GET /clients/me : nom de l'entreprise (scope profile) ─────────────
    // Facultatif : si le jeton n'a que profile.read, ProGBat peut répondre 403 ;
    // le test du jeton reste alors réussi, l'entreprise est simplement inconnue.
    const co = await progbatGet("/clients/me", token)
    let entreprises: { id: number | string | null; nom: string }[] = []
    let entrepriseMessage = ""
    if (co.ok) {
      const liste = Array.isArray(co.data) ? co.data : (co.data ? [co.data] : [])
      entreprises = liste.map((c: Record<string, unknown>) => ({
        id: (typeof c.id === "number" || typeof c.id === "string") ? c.id : null,
        nom: String(c.businessName || c.legalName || "").trim(),
      }))
    } else {
      entrepriseMessage = co.message
    }

    console.log(`[progbat-test-connection] appelant=${caller.id} /me → ${me.status}, /clients/me → ${co.status} (${Date.now() - t0} ms)`)

    return json({
      ok: true,
      progbat_status: me.status,
      message: "Connexion ProGBat réussie : le jeton privé est valide.",
      utilisateur,
      entreprise: entreprises[0] ?? null,
      entreprises,
      entreprise_status: co.status,
      ...(entrepriseMessage ? { entreprise_message: entrepriseMessage } : {}),
    })
  } catch (err) {
    console.error(`[progbat-test-connection] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne du test de connexion." }, 500)
  }
})
