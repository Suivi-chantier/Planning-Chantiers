import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import { choisirJeton } from "./lib/progbatYards.mjs"
import { MAX_PAGES, PAGE_SIZE, nettoyerMotif } from "./lib/progbatBillingDryRun.mjs"
import { creerDepotSynchronisation } from "./lib/progbatBillingSync.mjs"
import { EN_TETE_SECRET, VARIABLE_SECRET, traiterAppelCron } from "./lib/progbatBillingCron.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-billing-sync-cron
// La MÊME synchronisation que progbat-billing-sync, déclenchée par une horloge.
//
// Le moteur est partagé à l'identique : preparerSynchronisation() puis
// executerSynchronisation(), mêmes règles de normalisation, de résolution, de
// fusion et de réconciliation. Seule la PORTE change, parce qu'un cron n'est
// personne : il n'a ni session Supabase, ni rôle bureau, ni confirmation à
// saisir. La fonction manuelle, elle, garde ses trois verrous et n'est pas
// touchée par ce fichier.
//
// LA SEULE PREUVE ACCEPTÉE : un secret serveur.
//   • méthode ≠ POST                                  → 405
//   • PROGBAT_BILLING_CRON_SECRET absent du serveur    → 500
//   • en-tête x-progbat-cron-secret absent ou faux     → 401
// Aucun repli : ni une session utilisateur, ni le jeton anon/publishable, ni le
// service_role ne valent autorisation ici. La comparaison passe par les
// condensats SHA-256 (Web Crypto), donc sans sortie anticipée dépendante du
// premier caractère différent.
//
// LES REFUS PRÉCÈDENT TOUT. `ouvrirContexte` est une fonction passée au module
// pur : elle n'est appelée qu'une fois la porte franchie. Tant qu'elle ne l'est
// pas, aucun client Supabase n'est construit, le jeton ProGBat n'est pas lu, et
// pas un octet n'est parti vers ProGBat.
//
// LE SECRET NE SORT JAMAIS : ni dans la réponse, ni dans une erreur, ni dans
// une ligne de journal. Le service_role reste côté serveur — il n'apparaît ni
// dans le corps de la requête, ni dans le futur SQL du cron, qui n'aura à
// porter que l'en-tête ci-dessus.
//
// CONCURRENCE avec un lancement manuel : aucun verrou, la base en tient lieu.
// L'unicité de progbat_bill_id et du couple (progbat_transaction_id,
// facture_id) refuse toute seconde écriture ; le conflit est compté en `echec`,
// la réponse part en ok:false / partiel:true, et la passe horaire suivante
// relit l'état réel et converge sans doublon.
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 20_000

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } })

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

// UN SEUL VERBE SORTANT : GET. Identique à celui des deux autres fonctions de
// facturation — la lecture ne change pas parce que l'appelant est une horloge.
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
  const t0 = Date.now()
  try {
    const r = await traiterAppelCron({
      methode: req.method,
      enTeteSecret: req.headers.get(EN_TETE_SECRET),
      secretServeur: Deno.env.get(VARIABLE_SECRET) || "",
      // N'est appelée qu'APRÈS les trois contrôles. Tout ce qui touche à
      // Supabase ou à ProGBat vit ici, et nulle part avant.
      ouvrirContexte: async () => {
        const { token, source } = choisirJeton({
          billing: Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || "",
          legacy: Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || "",
        })
        if (!token) {
          console.warn("[progbat-billing-sync-cron] aucun secret ProGBat configuré")
          return { ok: false, status: 500, erreur: "Connexion ProGBat non configurée (PROGBAT_BILLING_ACCESS_TOKEN)." }
        }
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        )
        return {
          ok: true,
          source,
          depot: creerDepotSynchronisation(admin),
          progbat: {
            lirePage: (args: { ressource: string; limit: number; offset: number; tri: string | null }) =>
              lirePage(token, args),
          },
        }
      },
      maintenant: new Date().toISOString(),
      debutMs: t0,
      finMs: Date.now(),
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
    })

    const corps = r.corps && typeof r.corps === "object" && "duree_ms" in r.corps
      ? { ...r.corps, duree_ms: Date.now() - t0 }
      : r.corps
    // `journal` ne porte jamais le secret : le module ne lui donne que la
    // provenance du jeton ProGBat et les compteurs.
    console.log(`${r.journal} (${Date.now() - t0} ms)`)
    return json(corps, r.status)
  } catch (e) {
    console.error(`[progbat-billing-sync-cron] erreur=${nettoyerMotif((e as Error)?.message)}`)
    return json({ ok: false, declencheur: "cron", error: "Erreur interne lors de la synchronisation horaire ProGBat." }, 500)
  }
})
