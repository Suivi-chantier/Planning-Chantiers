import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { choisirJeton } from "./lib/progbatYards.mjs"
import { MAX_PAGES, PAGE_SIZE, creerDepotLecture, executerDryRun, nettoyerMotif } from "./lib/progbatBillingDryRun.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-billing-dry-run
// DIAGNOSTIC DE PRÉ-SYNCHRONISATION, STRICTEMENT EN LECTURE SEULE.
//
// Ce que la fonction répond : ce que la future synchronisation des factures et
// des règlements ProGBat CRÉERAIT ou MODIFIERAIT — combien de créations,
// combien de mises à jour, combien de lignes déjà à jour, et tout ce qui
// n'aboutit pas (brouillons, chantiers non rattachés, conflits).
//
// Ce qu'elle ne fait pas, et ne doit jamais faire :
//   • aucune écriture Supabase — uniquement des SELECT (aucun .insert,
//     .update, .upsert, .delete, .rpc dans ce fichier) ;
//   • aucune écriture ProGBat — uniquement des GET ;
//   • aucun téléchargement de PDF ;
//   • aucun cron : elle ne s'exécute que sur appel authentifié.
//
// Endpoints ProGBat (lecture seule) :
//   GET /company/bills?limit&offset[&sort]        scope `bills.read`
//   GET /company/transactions?limit&offset[&sort] scope `transactions.read`
// Pagination : limit = 100, offset croissant, arrêt sur une page de moins de
// 100 éléments, garde à 40 pages, déduplication par id entre les pages.
// L'arrêt ne dépend JAMAIS de Content-Range, en-tête non garanti ici.
//
// Les règles vivent dans les modules purs, copiés dans lib/ par
// scripts/sync-progbat-edge-lib.mjs (ne pas éditer les copies) :
//   progbatFacturation.mjs (normalisation et fusion des factures et règlements),
//   progbatLiaison.mjs     (facture → chantier : yard prioritaire, devis en repli),
//   progbatYards.mjs       (choix du jeton, pagination),
//   progbatBillingDryRun.mjs (orchestration, catégories, bornage de la sortie).
// Elles sont testées dans Node par scripts/verif-progbat-billing-dry-run.mjs.
//
// Secrets : PROGBAT_BILLING_ACCESS_TOKEN en priorité (il porte bills.read et
// transactions.read), PROGBAT_PRIVATE_ACCESS_TOKEN seulement si le secret
// dédié est ABSENT — jamais parce que le dédié a échoué : rejouer avec l'autre
// jeton après un 403 masquerait le scope manquant. Le jeton n'est ni renvoyé,
// ni journalisé.
//
// Rien de nominatif ne sort : les exemples sont reconstruits champ par champ
// sur une liste blanche (ni client, ni adresse, ni e-mail, ni téléphone, ni
// content[], ni thirdId, ni bankAccountId, ni IBAN, ni paymentNumber, ni
// payload brut), et au maximum 20 par catégorie — les comptages, eux, sont
// complets.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 20_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

// Message lisible selon le code HTTP. Seul un 403 permet de conclure au scope.
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

// UN SEUL VERBE : GET. Ni corps, ni en-tête de mutation. Ne journalise ni les
// en-têtes, ni le corps ; ne renvoie jamais le corps brut en erreur.
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
        const body = await res.json()
        detail = nettoyerMotif(body?.message ?? body?.error_description ?? body?.error ?? "")
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
    // ── 1. Appelant : utilisateur Supabase authentifié, actif, du bureau ────
    // Exactement la vérification de progbat-test-connection et progbat-yards-list.
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

    // ── 2. Jeton ProGBat (jamais renvoyé ni journalisé) ─────────────────────
    const { token, source } = choisirJeton({
      billing: Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || "",
      legacy: Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || "",
    })
    if (!token) {
      console.warn("[progbat-billing-dry-run] aucun secret ProGBat configuré")
      return json({ ok: false, error: "Connexion ProGBat non configurée (PROGBAT_BILLING_ACCESS_TOKEN)." }, 500)
    }

    // ── 3. Le diagnostic lui-même (module pur, doublures branchées ici) ─────
    const progbat = {
      lirePage: (args: { ressource: string; limit: number; offset: number; tri: string | null }) =>
        lirePage(token, args),
    }
    // Les cinq lectures — tables, colonnes et filtres — vivent dans le module
    // pur : ce sont des règles (dont « seuls les devis réellement créés
    // servent au repli »), et elles y sont vérifiées avec un client doublé.
    // progbat_quote_exports n'expose que project_id et progbat_quote_id :
    // payload_hash, created_by, created_by_email et error_message ne sont
    // jamais sélectionnés.
    const depot = creerDepotLecture(admin)

    const maintenant = new Date().toISOString()
    const r = await executerDryRun({
      depot, progbat, maintenant,
      debutMs: t0, finMs: Date.now(),
      pageSize: PAGE_SIZE, maxPages: MAX_PAGES,
    })
    // executerDryRun fige la durée avant l'analyse : on la recale sur la vraie
    // fin d'exécution, la seule que l'appelant puisse interpréter.
    if (!r.ok) {
      console.warn(`[progbat-billing-dry-run] appelant=${caller.id} jeton=${source} → échec ProGBat ${r.status} (${Date.now() - t0} ms)`)
      const statutHttp = r.status === 401 || r.status === 403 || r.status === 429 ? r.status : 502
      return json({ ok: false, error: r.erreur, progbat_status: r.status || null }, statutHttp)
    }

    const rapport = { ...r.rapport, duree_ms: Date.now() - t0 }
    const f = rapport.factures.categories
    const g = rapport.reglements.categories
    console.log(
      `[progbat-billing-dry-run] appelant=${caller.id} jeton=${source} ` +
      `factures=${rapport.factures.recues} (créations ${f.creation}, maj ${f.mise_a_jour}, inchangées ${f.inchangee}, ` +
      `brouillons ${f.brouillon_ignore}, non résolues ${f.non_resolue}) ` +
      `règlements=${rapport.reglements.lettrages_retenus} (créations ${g.creation}, maj ${g.mise_a_jour}) ` +
      `(${rapport.duree_ms} ms)`,
    )
    return json({ ok: true, ...rapport })
  } catch (e) {
    console.error(`[progbat-billing-dry-run] erreur=${nettoyerMotif((e as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne lors du diagnostic de facturation ProGBat." }, 500)
  }
})
