import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { choisirJeton } from "./lib/progbatYards.mjs"
import { MAX_PAGES, PAGE_SIZE, nettoyerMotif } from "./lib/progbatBillingDryRun.mjs"
import { creerDepotSynchronisation, executerSynchronisation, verifierConfirmation } from "./lib/progbatBillingSync.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-billing-sync
// SYNCHRONISATION RÉELLE des factures et règlements ProGBat → Supabase.
//
// C'est la fonction qui ÉCRIT. Sa jumelle progbat-billing-dry-run calcule la
// même chose et n'écrit rien : les deux partagent le MÊME moteur
// (lib/progbatBillingDryRun.mjs → preparerSynchronisation), si bien que ce qui
// a été prévisualisé est exactement ce qui est appliqué ici.
//
// CE QU'ELLE ÉCRIT : chantier_factures_client (source='progbat') et
// chantier_factures_reglements. Rien d'autre. Aucun DELETE nulle part : une
// annulation est un drapeau (annule = true), jamais une suppression.
//
// CE QU'ELLE N'ÉCRIT JAMAIS :
//   • ProGBat — tous les appels distants sont des GET, la synchronisation est
//     unidirectionnelle ;
//   • les factures saisies à la main (source='manuel'), refusées par
//     fusionnerFactureProgbat ;
//   • le travail humain sur une facture ProGBat : échéance verrouillée,
//     commentaire, trace de correction. Ces colonnes ne sont même pas
//     sélectionnées (CHAMPS_ECRITS_FACTURE est une liste blanche).
//
// DEUX VERROUS AVANT D'ÉCRIRE :
//   1. l'appelant — utilisateur Supabase authentifié, actif, du bureau, comme
//      progbat-test-connection et progbat-billing-dry-run ; les ouvriers sont
//      refusés ;
//   2. la confirmation — un corps { "confirmation": "SYNCHRONISER_PROGBAT" }
//      exact. Sans lui : HTTP 400, aucun appel ProGBat, aucune écriture. Ce
//      n'est pas une authentification (elle est déjà faite), c'est ce qui
//      empêche un appel accidentel de remplir le registre.
//
// IDEMPOTENCE : l'identité d'une facture est progbat_bill_id (index unique
// global), celle d'un règlement le couple (progbat_transaction_id, facture_id).
// Une seconde exécution identique ne produit ni création ni mise à jour : tout
// ressort « inchangé ». C'est vérifié par scripts/verif-progbat-billing-sync.mjs.
//
// REPRISE APRÈS ÉCHEC : les écritures sont indépendantes les unes des autres.
// Une ligne refusée par la base est comptée, son message est nettoyé et joint
// au rapport ; les suivantes sont quand même tentées. La réponse porte alors
// ok:false et partiel:true — jamais un ok:true qui masquerait un échec. Relancer
// la fonction rattrape ce qui manque, sans créer de doublon.
//
// Secrets : PROGBAT_BILLING_ACCESS_TOKEN en priorité, PROGBAT_PRIVATE_ACCESS_TOKEN
// seulement s'il est ABSENT. Le jeton n'est ni renvoyé ni journalisé, et aucune
// donnée client, adresse, coordonnée ou bancaire ne transite par la réponse.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 20_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const messagePourStatus = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return "Accès refusé par ProGBat (403) : le jeton n'a pas les scopes requis (bills.read, transactions.read)." + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type Page = { ok: true; data: unknown } | { ok: false; status: number; message: string }

// UN SEUL VERBE SORTANT : GET. Ni corps, ni en-tête de mutation. Identique à
// celui de progbat-billing-dry-run : la lecture ne change pas parce qu'on écrit
// ensuite.
async function lirePage(
  token: string,
  { ressource, limit, offset, tri }: { ressource: string; limit: number; offset: number; tri: string | null },
): Promise<Page> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const suffixeTri = tri ? `&sort=${encodeURIComponent(tri)}` : ""
  try {
    const res = await fetch(`${PROGBAT_API}/company/${ressource}?limit=${limit}&offset=${offset}${suffixeTri}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = ""
      try {
        const corps = await res.json()
        detail = nettoyerMotif(corps?.message ?? corps?.error_description ?? corps?.error ?? "")
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
    // ── 1. Appelant : authentifié, actif, du bureau ─────────────────────────
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
    if (!profil || profil.actif === false || profil.role === "ouvrier") {
      return json({ ok: false, error: "Accès réservé aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Confirmation explicite — AVANT tout appel ProGBat ────────────────
    let corps: unknown = null
    try { corps = await req.json() } catch { corps = null }
    const confirmation = verifierConfirmation(corps)
    if (!confirmation.ok) {
      console.warn(`[progbat-billing-sync] appelant=${caller.id} refus : confirmation absente ou incorrecte`)
      return json({ ok: false, error: confirmation.erreur }, 400)
    }

    // ── 3. Jeton ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const { token, source } = choisirJeton({
      billing: Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || "",
      legacy: Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || "",
    })
    if (!token) {
      console.warn("[progbat-billing-sync] aucun secret ProGBat configuré")
      return json({ ok: false, error: "Connexion ProGBat non configurée (PROGBAT_BILLING_ACCESS_TOKEN)." }, 500)
    }

    // ── 4. Lecture complète, puis écritures ────────────────────────────────
    const progbat = {
      lirePage: (args: { ressource: string; limit: number; offset: number; tri: string | null }) =>
        lirePage(token, args),
    }
    const depot = creerDepotSynchronisation(admin)
    const maintenant = new Date().toISOString()
    const r = await executerSynchronisation({
      depot, progbat, maintenant,
      debutMs: t0, finMs: Date.now(),
      pageSize: PAGE_SIZE, maxPages: MAX_PAGES,
    })

    // Abandon AVANT toute écriture : ProGBat inaccessible, ou liste des
    // factures incomplète. Aucun rapport, parce qu'il n'y a rien à rapporter.
    if (!r.rapport) {
      console.warn(`[progbat-billing-sync] appelant=${caller.id} jeton=${source} → abandon avant écriture, ProGBat ${r.status} (${Date.now() - t0} ms)`)
      const statutHttp = r.status === 401 || r.status === 403 || r.status === 429 ? r.status : 502
      return json({ ok: false, dry_run: false, partiel: false, ecritures: { supabase: 0, progbat: 0 }, error: r.erreur, progbat_status: r.status || null }, statutHttp)
    }

    const rapport = { ...r.rapport, duree_ms: Date.now() - t0 }
    const f = rapport.factures.categories
    const g = rapport.reglements.categories
    console.log(
      `[progbat-billing-sync] appelant=${caller.id} jeton=${source} ok=${rapport.ok} partiel=${rapport.partiel} ` +
      `écritures=${rapport.ecritures.supabase} · factures(créées ${f.creation}, maj ${f.mise_a_jour}, inchangées ${f.inchangee}, ignorées ${f.ignoree}, échecs ${f.echec}) ` +
      `· règlements(créés ${g.creation}, maj ${g.mise_a_jour}, inchangés ${g.inchange}, annulés ${g.annulation}, déjà annulés ${g.deja_annule}, ignorés ${g.ignore}, échecs ${g.echec}) ` +
      `(${rapport.duree_ms} ms)`,
    )
    // Un échec d'écriture ne devient JAMAIS un 200 ok:true : le rapport part
    // avec ok:false et le détail des compteurs.
    return json(rapport, rapport.ok ? 200 : 207)
  } catch (e) {
    console.error(`[progbat-billing-sync] erreur=${nettoyerMotif((e as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne lors de la synchronisation de la facturation ProGBat." }, 500)
  }
})
