// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatBillingCron.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// DÉCLENCHEMENT HORAIRE DE LA SYNCHRONISATION ProGBat — logique PURE.
//
// La synchronisation manuelle (progbat-billing-sync) exige une session
// Supabase, un utilisateur du bureau et la confirmation « SYNCHRONISER_PROGBAT ».
// Un cron n'a rien de tout cela : il n'est personne. Il lui faut donc sa propre
// porte, et cette porte n'accepte QU'UNE seule preuve — un secret serveur.
//
// CE MODULE NE DÉCIDE RIEN DE MÉTIER. Le moteur reste celui de la
// synchronisation manuelle : preparerSynchronisation() puis
// executerSynchronisation(), mêmes règles, même plan, même rapport. Il n'existe
// pas deux façons de normaliser une facture, de résoudre un chantier ou de
// réconcilier un règlement — et ce lot n'en crée pas une troisième.
//
// L'ORDRE DES REFUS EST LE CŒUR DE CE FICHIER
// ───────────────────────────────────────────
//   1. méthode ≠ POST                      → 405
//   2. secret serveur absent               → 500
//   3. en-tête absent ou différent         → 401
//   4. seulement ensuite : ouvrirContexte()
// `ouvrirContexte` est une FONCTION, pas un objet déjà construit. C'est
// délibéré : tant qu'elle n'est pas appelée, aucun client Supabase n'existe,
// aucun jeton ProGBat n'a été lu, aucun octet n'est parti vers ProGBat. Un
// appel non autorisé ne peut donc rien déclencher, et le harnais le prouve en
// comptant les appels à cette fonction.
//
// LE SECRET NE SORT JAMAIS. Ni dans une réponse, ni dans un message d'erreur,
// ni dans une ligne de journal : les messages parlent de sa PRÉSENCE, jamais de
// sa valeur.
//
// CONCURRENCE AVEC LA SYNCHRONISATION MANUELLE — aucun verrou ici, et c'est
// assumé : la base en tient lieu. Une facture est unique par progbat_bill_id,
// un règlement par (progbat_transaction_id, facture_id). Si les deux passes se
// chevauchent, la seconde insertion est refusée par l'index unique, comptée en
// `echec`, et la réponse part en ok:false / partiel:true — jamais un doublon.
// La passe horaire suivante relit l'état réel et converge sans rien dupliquer.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_PAGES, PAGE_SIZE } from "./progbatBillingDryRun.mjs";
import { executerSynchronisation } from "./progbatBillingSync.mjs";

export { MAX_PAGES, PAGE_SIZE };

/** Le seul en-tête qui autorise cet appel. */
export const EN_TETE_SECRET = "x-progbat-cron-secret";
/** La variable d'environnement qui porte le secret, côté serveur uniquement. */
export const VARIABLE_SECRET = "PROGBAT_BILLING_CRON_SECRET";
/** Marque le rapport : même moteur, déclencheur différent. */
export const DECLENCHEUR = "cron";

const encodeur = new TextEncoder();

const condensat = async (valeur) => {
  const brut = await globalThis.crypto.subtle.digest("SHA-256", encodeur.encode(String(valeur)));
  return new Uint8Array(brut);
};

/**
 * Comparaison de secrets SANS sortie anticipée.
 *
 * On compare les CONDENSATS SHA-256, pas les chaînes : ils font toujours
 * 32 octets, si bien que ni la longueur du secret ni la position du premier
 * caractère différent ne se lisent dans le temps de réponse. La boucle
 * parcourt les 32 octets dans tous les cas.
 */
export async function comparerSecretConstant(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a === "" || b === "") return false;
  const [x, y] = await Promise.all([condensat(a), condensat(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

/**
 * La porte. Aucun repli : ni session utilisateur, ni jeton anon/publishable, ni
 * service_role ne valent autorisation ici — seul le secret serveur compte.
 *
 * @returns { ok: true } | { ok: false, status, erreur }
 */
export async function verifierAppelCron({ methode = "", enTeteSecret = /** @type {string | null} */ (null), secretServeur = "" } = {}) {
  if (String(methode).toUpperCase() !== "POST") {
    return { ok: false, status: 405, erreur: "Method not allowed" };
  }
  // Mal configuré ≠ non autorisé : on le dit, sans jamais dire ce qui manque
  // comme valeur.
  if (typeof secretServeur !== "string" || secretServeur.trim() === "") {
    return {
      ok: false,
      status: 500,
      erreur: `Déclencheur horaire non configuré : le secret serveur ${VARIABLE_SECRET} est absent de cette fonction.`,
    };
  }
  const fourni = typeof enTeteSecret === "string" ? enTeteSecret : "";
  // Message identique qu'il manque ou qu'il soit faux : un appelant non
  // autorisé n'apprend rien de la configuration.
  if (!(await comparerSecretConstant(fourni, secretServeur))) {
    return { ok: false, status: 401, erreur: `Appel non autorisé : en-tête ${EN_TETE_SECRET} absent ou invalide.` };
  }
  return { ok: true };
}

/**
 * L'appel horaire, de bout en bout.
 *
 * @param ouvrirContexte async () → { ok: true, depot, progbat, source }
 *                                | { ok: false, status, erreur }
 *        APPELÉE UNIQUEMENT si la porte s'ouvre. C'est elle qui construit le
 *        client Supabase (service_role, côté serveur seulement) et lit le jeton
 *        ProGBat : rien de tout cela n'existe avant.
 *
 * @returns { status, corps, journal }
 *          `journal` est la ligne à écrire dans les logs — elle ne contient
 *          jamais le secret, ni le jeton ProGBat, seulement la provenance.
 */
export async function traiterAppelCron({
  methode = "",
  // Les casts ne changent RIEN à l'exécution : ils décrivent l'en-tête (une
  // chaîne ou son absence), la fabrique de contexte et l'horodatage ISO, pour
  // que `deno check` accepte l'appel depuis index.ts.
  enTeteSecret = /** @type {string | null} */ (null),
  secretServeur = "",
  ouvrirContexte = /** @type {any} */ (null),
  maintenant = /** @type {string | null} */ (null),
  debutMs = 0,
  finMs = 0,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
} = {}) {
  const porte = await verifierAppelCron({ methode, enTeteSecret, secretServeur });
  if (!porte.ok) {
    return {
      status: porte.status,
      corps: { ok: false, declencheur: DECLENCHEUR, error: porte.erreur },
      journal: `[progbat-billing-sync-cron] refus ${porte.status} avant tout traitement`,
    };
  }

  const contexte = typeof ouvrirContexte === "function" ? await ouvrirContexte() : null;
  if (!contexte?.ok) {
    return {
      status: contexte?.status ?? 500,
      corps: { ok: false, declencheur: DECLENCHEUR, error: contexte?.erreur || "Contexte de synchronisation indisponible." },
      journal: `[progbat-billing-sync-cron] contexte indisponible (${contexte?.status ?? 500})`,
    };
  }

  const r = await executerSynchronisation({
    depot: contexte.depot,
    progbat: contexte.progbat,
    maintenant, debutMs, finMs, pageSize, maxPages,
  });

  // Abandon AVANT toute écriture : ProGBat inaccessible, ou liste des factures
  // incomplète. Aucun rapport, parce qu'il n'y a rien à rapporter.
  if (!r.rapport) {
    const statutHttp = r.status === 401 || r.status === 403 || r.status === 429 ? r.status : 502;
    return {
      status: statutHttp,
      corps: {
        ok: false, declencheur: DECLENCHEUR, dry_run: false, partiel: false,
        ecritures: { supabase: 0, progbat: 0 },
        error: r.erreur, progbat_status: r.status || null,
      },
      journal: `[progbat-billing-sync-cron] jeton=${contexte.source} → abandon avant écriture, ProGBat ${r.status}`,
    };
  }

  const rapport = { ...r.rapport, declencheur: DECLENCHEUR, duree_ms: Math.max(0, finMs - debutMs) };
  const f = rapport.factures.categories;
  const g = rapport.reglements.categories;
  return {
    // Un échec d'écriture ne devient JAMAIS un 200 ok:true.
    status: rapport.ok ? 200 : 207,
    corps: rapport,
    journal:
      `[progbat-billing-sync-cron] jeton=${contexte.source} ok=${rapport.ok} partiel=${rapport.partiel} `
      + `écritures=${rapport.ecritures.supabase} · factures(créées ${f.creation}, maj ${f.mise_a_jour}, `
      + `inchangées ${f.inchangee}, ignorées ${f.ignoree}, échecs ${f.echec}) `
      + `· règlements(créés ${g.creation}, maj ${g.mise_a_jour}, inchangés ${g.inchange}, `
      + `annulés ${g.annulation}, déjà annulés ${g.deja_annule}, ignorés ${g.ignore}, échecs ${g.echec})`,
  };
}
