import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { MAX_PAGES, PAGE_SIZE, choisirJeton, parcourirYards } from "./lib/progbatYards.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-yards-list
// Liste COMPLÈTE des chantiers ProGBat (« yards »), en LECTURE SEULE.
//
// À quoi ça sert : rattacher un chantier ProGBat à un chantier Profero
// (table chantier_progbat_yards). Une facture ProGBat porte `yardId` ; c'est le
// rattachement stable, là où `quoteId` change à chaque avenant. L'écran de
// rattachement a donc besoin de la liste des yards — et de rien d'autre.
//
// UN SEUL endpoint, une seule méthode :
//   GET https://api.progbat.com/v2/company/yards?limit&offset   scope `business.read`
// Aucun POST, PATCH ou DELETE vers ProGBat. Aucune écriture en base non plus :
// cette fonction ne fait que lire et projeter.
//
// Différence assumée avec progbat-test-connection : le diagnostic s'arrêtait
// dès qu'il avait retrouvé les quelques yardId cherchés. Ici la liste doit être
// COMPLÈTE (110 chantiers aujourd'hui), donc on pagine jusqu'à la vraie fin.
// L'arrêt ne dépend PAS de Content-Range, en-tête non garanti sur cette
// ressource : il repose sur la taille des pages reçues.
//
// Les règles pures (choix du jeton, pagination, liste blanche, tri) vivent dans
// lib/progbatYards.mjs — copie de src/Renovation/progbatYards.mjs, testée par
// scripts/verif-progbat-yards.mjs.
//
// Secrets : PROGBAT_BILLING_ACCESS_TOKEN en priorité (il porte bills.read,
// transactions.read et business.read), PROGBAT_PRIVATE_ACCESS_TOKEN seulement
// si le secret dédié est ABSENT. Jamais de second essai après un 403 : un 403
// dit « scope business.read manquant », et rejouer l'appel avec l'autre jeton
// masquerait le diagnostic au lieu de le donner.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 15_000
const SCOPE_ATTENDU = "business.read"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

// Nettoie un message avant de le renvoyer : court, et sans séquence pouvant
// ressembler à un jeton ou une clé.
const nettoyerMessage = (raw: unknown): string =>
  String(typeof raw === "string" ? raw : "")
    .replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)

// Message lisible selon le code HTTP. Seul un 403 permet de conclure au scope.
const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return `Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis (${SCOPE_ATTENDU}) pour lire les chantiers.` + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type Page = { ok: true; data: unknown } | { ok: false; status: number; message: string }

// GET unique sur /company/yards, avec délai maximal. Ne journalise ni les
// en-têtes, ni le corps ; ne renvoie jamais le corps brut en erreur.
async function lireUnePage(token: string, limit: number, offset: number): Promise<Page> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}/company/yards?limit=${limit}&offset=${offset}`, {
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
    return { ok: true, data: await res.json().catch(() => null) }
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
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  const t0 = Date.now()
  try {
    // ── 1. Appelant : utilisateur Supabase authentifié, du bureau ───────────
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !caller?.email) return json({ ok: false, error: "Non authentifié." }, 401)
    const { data: profil } = await admin
      .from("utilisateurs")
      .select("role,actif")
      .eq("email", caller.email.toLowerCase())
      .maybeSingle()
    // Même règle que l'application : compte actif et rôle bureau (≠ ouvrier).
    if (!profil || profil.actif === false || profil.role === "ouvrier") {
      return json({ ok: false, error: "Accès réservé aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Jeton ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const { token, source } = choisirJeton({
      billing: Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || "",
      legacy: Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || "",
    })
    if (!token) {
      console.warn("[progbat-yards-list] aucun secret ProGBat configuré")
      return json({ ok: false, error: "Connexion ProGBat non configurée (PROGBAT_BILLING_ACCESS_TOKEN)." }, 500)
    }

    // ── 3. GET /company/yards, paginé jusqu'à la fin réelle ─────────────────
    const lu = await parcourirYards(
      ({ limit, offset }: { limit: number; offset: number }) => lireUnePage(token, limit, offset),
      { pageSize: PAGE_SIZE, maxPages: MAX_PAGES },
    )

    if (!lu.ok) {
      console.warn(`[progbat-yards-list] appelant=${caller.id} jeton=${source} pages=${lu.pages} → HTTP ${lu.status} (${Date.now() - t0} ms)`)
      // Code HTTP utile côté client : 403 reste un 403, une panne réseau devient 502.
      const statutHttp = lu.status === 401 || lu.status === 403 || lu.status === 429 ? lu.status : 502
      return json({ ok: false, error: lu.message, progbat_status: lu.status || null }, statutHttp)
    }

    if (lu.garde_atteinte) {
      // Liste potentiellement tronquée : on le DIT plutôt que de renvoyer une
      // liste incomplète présentée comme complète.
      console.warn(`[progbat-yards-list] appelant=${caller.id} garde de ${MAX_PAGES} pages atteinte`)
      return json({ ok: false, error: `Liste des chantiers ProGBat trop longue (garde de ${MAX_PAGES} pages atteinte) : lecture interrompue.` }, 502)
    }

    console.log(`[progbat-yards-list] appelant=${caller.id} jeton=${source} pages=${lu.pages} yards=${lu.yards.length} (${Date.now() - t0} ms)`)
    // Réponse minimale. Les yards sortent déjà projetés sur CHAMPS_YARD
    // (id, label, publicYardNumber) par le module pur : ni adresse, ni client,
    // ni e-mail, ni téléphone, ni managerId, ni businessId, ni payload brut.
    return json({ ok: true, nombre: lu.yards.length, yards: lu.yards })
  } catch (e) {
    console.error(`[progbat-yards-list] erreur=${nettoyerMessage((e as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne lors de la lecture des chantiers ProGBat." }, 500)
  }
})
