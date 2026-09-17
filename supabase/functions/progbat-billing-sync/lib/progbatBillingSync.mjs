// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatBillingSync.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// SYNCHRONISATION RÉELLE DE LA FACTURATION ProGBat — logique serveur PURE.
//
// C'est le lot qui ÉCRIT. Il n'invente pourtant aucune règle : il applique,
// une par une, les lignes que le moteur du diagnostic a déjà calculées.
//
//   progbatBillingDryRun.mjs → preparerSynchronisation()
//        lit tout (2 listes ProGBat paginées + 5 tables locales),
//        classe tout, et produit un PLAN.
//   ce module               → exécute ce plan, et compte ce qu'il a fait.
//
// Conséquence directe, et c'est le point : ce qui a été prévisualisé est
// exactement ce qui est écrit. Il n'existe pas deux versions des règles, pas
// deux façons de résoudre un chantier, pas deux idées de ce qu'est une
// transaction active. Le diagnostic et la synchronisation ne diffèrent que par
// la dernière étape.
//
// TOUT EST LU AVANT LA PREMIÈRE ÉCRITURE. Si la liste des factures est
// incomplète — erreur de page ou garde de 40 pages — on abandonne AVANT d'avoir
// touché quoi que ce soit : mieux vaut zéro écriture qu'un registre à moitié
// rempli à partir d'une lecture partielle.
//
// L'ORDRE COMPTE : factures d'abord, puis RELECTURE des identifiants réels
// (chantier_factures_client.id est un uuid généré par la base, pas le bill.id),
// puis règlements. Un règlement ne peut pas être écrit avant de connaître
// l'uuid de sa facture, et une facture dont la création a échoué ne reçoit
// aucun règlement : elle disparaît de l'index, et ses lettrages retombent en
// « facture introuvable ».
//
// AUCUNE ÉCRITURE ProGBat, jamais : la synchronisation est unidirectionnelle.
// Tous les appels distants sont des GET, hérités du moteur du diagnostic.
//
// Copié dans supabase/functions/progbat-billing-sync/lib/ par
// scripts/sync-progbat-edge-lib.mjs (ne pas éditer la copie). Testé dans Node
// avec des doublures par scripts/verif-progbat-billing-sync.mjs : aucun test ne
// touche l'API réelle ni une base réelle.
// ─────────────────────────────────────────────────────────────────────────────

import { idProgbat } from "./progbatFacturation.mjs";
import {
  CHAMPS_COMPARES_FACTURE,
  CHAMPS_COMPARES_REGLEMENT,
  LECTURES,
  MAX_EXEMPLES,
  MAX_PAGES,
  PAGE_SIZE,
  analyserReglements,
  creerDepotLecture,
  nettoyerMotif,
  preparerSynchronisation,
  resumePagination,
} from "./progbatBillingDryRun.mjs";

export { MAX_PAGES, PAGE_SIZE };

// Le mot de passe du geste, pas de l'utilisateur : il n'authentifie personne
// (l'authentification Supabase, elle, est déjà faite), il empêche un appel
// accidentel d'écrire dans le registre. Comparé à l'identique, sans
// normalisation : « synchroniser_progbat » n'est pas la confirmation.
export const CONFIRMATION_ATTENDUE = "SYNCHRONISER_PROGBAT";

/** @returns { ok: true } | { ok: false, erreur } */
export function verifierConfirmation(body) {
  const v = body === null || body === undefined ? undefined : body.confirmation;
  if (typeof v !== "string" || v !== CONFIRMATION_ATTENDUE) {
    return {
      ok: false,
      erreur: `Confirmation absente ou incorrecte : cette fonction écrit dans le registre et exige un corps { "confirmation": "${CONFIRMATION_ATTENDUE}" }.`,
    };
  }
  return { ok: true };
}

// ── Ce qui est ÉCRIT, champ par champ ───────────────────────────────────────
// Liste blanche, et pas un « tout sauf » : une colonne ajoutée demain à la
// table ne peut pas se retrouver écrite par accident.
//
// Ce sont les champs COMPARÉS (ceux qui décident d'une mise à jour) plus
// l'horodatage de synchronisation. Ce qui n'y est PAS est, par construction,
// intouchable par la synchronisation :
//   • commentaire, extraction, confiance, document_path, document_nom,
//     pct_du_marche, phasage_id, date_encaissement, montant_encaisse — ils ne
//     sont même pas lus ;
//   • ligne_id_modifie_par / ligne_id_modifie_le — la trace de la correction
//     humaine, qui doit survivre à toutes les synchronisations.
// Quant à ligne_id, ligne_nom, rapprochement et raison, ils sont dans la liste
// mais c'est fusionnerFactureProgbat qui décide de leur valeur : verrouillés,
// ils repartent inchangés.
export const CHAMPS_ECRITS_FACTURE = Object.freeze([...CHAMPS_COMPARES_FACTURE, "progbat_synced_at"]);

// Pour un règlement, les champs comparés SONT les champs écrits — `annule`
// compris, c'est lui qui rallume une ligne dont la transaction est redevenue
// active. facture_id s'y ajoute à la création seulement : il n'est pas une
// donnée ProGBat mais le lien local, et il ne change jamais ensuite.
export const CHAMPS_ECRITS_REGLEMENT = Object.freeze([...CHAMPS_COMPARES_REGLEMENT]);

export const COMPTEURS_FACTURE = Object.freeze(["creation", "mise_a_jour", "inchangee", "ignoree", "echec"]);
export const COMPTEURS_REGLEMENT = Object.freeze([
  "creation", "mise_a_jour", "inchange", "annulation", "deja_annule", "ignore", "echec",
]);

/** Projection sur une liste blanche. Une clé absente est OMISE, jamais nullée. */
export function projeterEcriture(ligne, champs) {
  const out = {};
  for (const c of champs) {
    if (ligne && ligne[c] !== undefined) out[c] = ligne[c];
  }
  return out;
}

// ── Dépôt : les lectures du diagnostic, plus les écritures ──────────────────
/**
 * @param client  client de type Supabase (service_role côté Edge Function).
 *
 * Les lectures viennent telles quelles de creerDepotLecture : mêmes tables,
 * mêmes colonnes, même filtre « devis réellement créés ». Les écritures sont
 * ajoutées ici, et elles sont les SEULES du dépôt — il n'existe aucun delete.
 * Chacune renvoie { ok } ou { ok: false, erreur } : une écriture ratée est une
 * VALEUR, pas une exception, pour que la boucle puisse continuer et compter.
 */
export function creerDepotSynchronisation(client) {
  const lecture = creerDepotLecture(client);
  const executer = async (requete, contexte) => {
    try {
      const { error } = await requete;
      if (error) return { ok: false, erreur: `${contexte} : ${error.message}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, erreur: `${contexte} : ${e?.message || "erreur inconnue"}` };
    }
  };
  const tF = LECTURES.factures.table;
  const tR = LECTURES.reglements.table;
  return {
    ...lecture,
    // Relecture MINIMALE après l'écriture des factures : l'uuid et le bill.id,
    // rien d'autre. C'est ce qui donne aux règlements leur facture_id réel.
    chargerIdsFactures: async () => {
      const { data, error } = await client.from(tF).select("id,progbat_bill_id").eq("source", "progbat");
      if (error) throw new Error(`${tF} : ${error.message}`);
      return data ?? [];
    },
    insererFacture: (ligne) => executer(client.from(tF).insert(ligne), "création de facture"),
    majFacture: (id, patch) => executer(client.from(tF).update(patch).eq("id", id), "mise à jour de facture"),
    insererReglement: (ligne) => executer(client.from(tR).insert(ligne), "création de règlement"),
    majReglement: (id, patch) => executer(client.from(tR).update(patch).eq("id", id), "mise à jour de règlement"),
    // La seule « suppression » possible est un drapeau : on n'efface jamais un
    // règlement, on l'éteint.
    annulerReglement: (id) => executer(client.from(tR).update({ annule: true }).eq("id", id), "annulation de règlement"),
  };
}

// ── Journal d'exécution : comptages complets, erreurs bornées ───────────────
export function creerJournalEcriture(max = MAX_EXEMPLES) {
  const erreurs = [];
  return {
    ecritures: 0,
    erreurs_total: 0,
    erreurs,
    factures: Object.fromEntries(COMPTEURS_FACTURE.map((c) => [c, 0])),
    reglements: Object.fromEntries(COMPTEURS_REGLEMENT.map((c) => [c, 0])),
    // `reference` est toujours un identifiant ProGBat ou un uuid local : jamais
    // un nom, une adresse ni un montant.
    erreur(portee, reference, message) {
      this.erreurs_total++;
      if (erreurs.length < max) {
        erreurs.push({ portee, reference: reference ?? null, message: nettoyerMotif(message || "Écriture refusée par la base.") });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNCHRONISATION
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param depot     creerDepotSynchronisation(client)
 * @param progbat   { lirePage } — GET uniquement, hérité du diagnostic
 * @param maintenant horodatage ISO injecté (progbat_synced_at)
 *
 * @returns { ok: true|false, rapport } | { ok: false, status, erreur }
 *
 * Deux formes d'échec, et il ne faut pas les confondre :
 *   • { ok: false, status, erreur } SANS rapport → rien n'a été lu ni écrit
 *     (ProGBat inaccessible, liste des factures incomplète). Abandon propre.
 *   • { ok: false, rapport } AVEC rapport → des écritures ont eu lieu et
 *     certaines ont échoué. `partiel` le dit, les compteurs disent combien.
 * Jamais d'écriture ratée masquée derrière ok:true.
 */
export async function executerSynchronisation({
  depot = /** @type {any} */ (null),
  progbat = /** @type {any} */ (null),
  maintenant = /** @type {string | null} */ (null),
  debutMs = 0,
  finMs = 0,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
} = {}) {
  // ── 1. TOUT LIRE, TOUT CLASSER — avant la moindre écriture ──────────────
  const prep = await preparerSynchronisation({ depot, progbat, maintenant, pageSize, maxPages });
  if (!prep.ok) return { ok: false, status: prep.status, erreur: prep.erreur };
  const { factures, transactions, transactionsCompletes, anaF, reglementsLocaux } = prep;

  const journal = creerJournalEcriture();

  // ── 2. FACTURES ─────────────────────────────────────────────────────────
  // Ce que l'analyse n'a pas mis au plan n'est pas écrit, et c'est délibéré :
  // brouillons (validated ≠ 1), documents illisibles, factures non résolues
  // (yard non rattaché, devis inconnu) et conflits yard/devis. Tous comptés.
  const catF = anaF.journal.categories;
  journal.factures.ignoree =
    catF.brouillon_ignore + catF.normalisation_refusee + catF.non_resolue + catF.fusion_refusee;

  for (const item of anaF.plan) {
    if (item.action === "inchangee") {
      // Rien à écrire. C'est CE cas qui rend la deuxième exécution gratuite.
      journal.factures.inchangee++;
      continue;
    }
    const ligne = projeterEcriture(item.ligne, CHAMPS_ECRITS_FACTURE);
    const r = item.action === "creation"
      ? await depot.insererFacture(ligne)
      : await depot.majFacture(item.facture_id, ligne);
    if (r?.ok) {
      journal.factures[item.action]++;
      journal.ecritures++;
    } else {
      journal.factures.echec++;
      journal.erreur("facture", item.bill_id, r?.erreur);
    }
  }

  // ── 3. LES VRAIS uuid ───────────────────────────────────────────────────
  // Obligatoire entre les deux phases : une facture qui vient d'être créée n'a
  // d'uuid que depuis la base. Une facture dont la création a échoué n'apparaît
  // pas ici — ses règlements retomberont donc en « facture introuvable »
  // plutôt que d'être rattachés à côté.
  const idsParBill = new Map();
  try {
    for (const f of await depot.chargerIdsFactures()) {
      const b = idProgbat(f?.progbat_bill_id);
      if (b !== null && f?.id) idsParBill.set(b, String(f.id));
    }
  } catch (e) {
    // Sans cet index, aucun règlement ne peut être écrit sans risque de le
    // rattacher à la mauvaise facture : la phase est abandonnée, pas devinée.
    journal.erreur("reglements", null, `Relecture des identifiants de factures impossible, phase des règlements abandonnée : ${e?.message || "erreur inconnue"}`);
    return { ok: false, rapport: composerRapport({ journal, prep, maintenant, debutMs, finMs, reglementsTraites: false }) };
  }

  // ── 4. RÈGLEMENTS ───────────────────────────────────────────────────────
  // L'analyse est REJOUÉE — même fonction, mêmes règles — sur un index où
  // chaque facture porte son uuid réel. C'est la seule différence avec la passe
  // du diagnostic, et elle ne change aucune décision : seulement leur cible.
  const parBillIdReel = new Map();
  for (const [billId, cible] of anaF.parBillId) {
    const id = idsParBill.get(billId);
    if (id) parBillIdReel.set(billId, { ...cible, facture_id: id });
  }
  const anaR = analyserReglements({
    elements: transactions.elements,
    parBillId: parBillIdReel,
    existants: reglementsLocaux,
    paginationComplete: transactionsCompletes,
  });

  const catR = anaR.journal.categories;
  journal.reglements.ignore =
    catR.lettrage_ignore + catR.facture_introuvable + catR.transaction_inactive_ou_inconnue;

  for (const item of anaR.plan) {
    if (item.action === "inchange") {
      journal.reglements.inchange++;
      continue;
    }
    if (!item.facture_id) {
      // Garde-fou : après la relecture, une cible sans uuid ne devrait plus
      // exister (elle a été retirée de l'index). Si elle survenait, on ne
      // devine pas — on compte et on passe.
      journal.reglements.ignore++;
      continue;
    }
    const patch = projeterEcriture(item.ligne, CHAMPS_ECRITS_REGLEMENT);
    const r = item.action === "creation"
      ? await depot.insererReglement({ ...patch, facture_id: item.facture_id })
      : await depot.majReglement(item.local_id, patch);
    if (r?.ok) {
      journal.reglements[item.action]++;
      journal.ecritures++;
    } else {
      journal.reglements.echec++;
      journal.erreur("reglement", item.progbat_transaction_id, r?.erreur);
    }
  }

  // ── 5. ANNULATIONS PAR ABSENCE ──────────────────────────────────────────
  // `anaR.absences` est VIDE dès que la lecture des transactions est
  // incomplète : la boucle ne peut donc rien annuler à tort — il n'y a pas de
  // condition à oublier ici, l'impossibilité est en amont.
  for (const a of anaR.absences) {
    if (a.deja_annule) {
      journal.reglements.deja_annule++;   // déjà dans l'état attendu : zéro écriture
      continue;
    }
    if (!a.local_id) { journal.reglements.ignore++; continue; }
    const r = await depot.annulerReglement(a.local_id);
    if (r?.ok) {
      journal.reglements.annulation++;
      journal.ecritures++;
    } else {
      journal.reglements.echec++;
      journal.erreur("annulation", a.progbat_transaction_id, r?.erreur);
    }
  }

  const rapport = composerRapport({ journal, prep, anaR, maintenant, debutMs, finMs, reglementsTraites: true });
  return { ok: rapport.ok, rapport };
}

/**
 * Rapport BORNÉ : des comptages complets, au plus 20 erreurs nettoyées, et
 * aucune donnée nominative — ni client, ni adresse, ni coordonnées bancaires,
 * ni payload brut. Les références sont des identifiants, et rien d'autre.
 */
export function composerRapport({ journal, prep, anaR = null, maintenant, debutMs = 0, finMs = 0, reglementsTraites = true }) {
  // Une seule erreur enregistrée suffit à faire tomber ok : ni un échec
  // d'écriture, ni une phase abandonnée ne doivent se cacher derrière ok:true.
  const echecs = journal.factures.echec + journal.reglements.echec;
  const ok = journal.erreurs_total === 0;
  return {
    ok,
    dry_run: false,
    // `partiel` = des écritures ont abouti ET d'autres ont échoué. Un échec
    // total (rien d'écrit) n'est pas « partiel » : il est simplement raté, et
    // ok:false le dit déjà.
    partiel: !ok && journal.ecritures > 0,
    genere_le: maintenant,
    duree_ms: Math.max(0, finMs - debutMs),
    // Le total RÉEL : une écriture comptée ici a été acceptée par la base.
    // Côté ProGBat, c'est zéro par construction — la fonction ne fait que des GET.
    ecritures: { supabase: journal.ecritures, progbat: 0 },
    pagination: {
      bills: resumePagination(prep.factures),
      transactions: resumePagination(prep.transactions),
    },
    reconciliation_absence_autorisee: prep.transactionsCompletes === true,
    factures: {
      recues: prep.anaF.recues,
      categories: journal.factures,
    },
    reglements: {
      traites: reglementsTraites,
      transactions_recues: anaR?.transactions_recues ?? 0,
      transactions_actives: anaR?.transactions_actives ?? 0,
      lettrages_retenus: anaR?.lettrages_retenus ?? 0,
      categories: journal.reglements,
    },
    erreurs_total: journal.erreurs_total,
    erreurs: journal.erreurs,
    echecs,
  };
}
