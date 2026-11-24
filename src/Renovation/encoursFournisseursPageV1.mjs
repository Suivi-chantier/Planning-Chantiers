// ─────────────────────────────────────────────────────────────────────────────
// encoursFournisseursPageV1 — calcul de la page « Encours fournisseurs »
// (PageEncoursFournisseurs.jsx, vue « Par échéance de paiement »), DÉPLACÉ À
// L'IDENTIQUE de la page pour être partagé avec le bloc du jour
// « Administratif fournisseurs » (projet docs/projets/organisation-par-jour.md,
// tâche 9). Même chiffre = même service : la page et le bloc appellent ces
// fonctions, aucun calcul réécrit.
//
// ATTENTION — ce n'est PAS encoursFournisseursV1.mjs (mail du vendredi et
// notification F2). Les deux calculs existaient déjà séparément et diffèrent
// (échéance « 30 j fin de mois », date d'échéance saisie sur la facture, BL
// rapprochés, limite à 6 mois). Ils ne sont PAS harmonisés ici : décision à
// prendre par Loris (voir le compte rendu de la tâche 9).
//
// Règles (celles de la page, inchangées) :
//  - factures (facture fournisseur mensuelle) non archivées — « à payer » ;
//  - commandes NON rattachées à une facture (facture_id vide), hors anciennes
//    saisies (source « migration ») et hors commandes déjà liées à un BL d'une
//    facture (facture_bl.commande_id) ;
//  - « payé » = commande réglée comptant (statut_facturation = « facture ») ;
//  - regroupement par mois d'échéance de paiement selon le mode du fournisseur ;
//  - « à payer » d'un fournisseur pour un mois = le facturé s'il existe, sinon
//    le saisi.
//
// Module PUR : aucun accès Supabase, aucune horloge (la date du jour arrive en
// paramètre), aucun effet de bord. Façade front : encoursFournisseursPageV1.js.
// Vérifié par scripts/verif-bloc-administratif-fournisseurs.mjs.
// ─────────────────────────────────────────────────────────────────────────────

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-11 » → « novembre 2026 » ; sans date → « Sans date ». */
export const moisLabel = (ym) => {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
};

/** Montant au format de la page : « 12 450,00 » (suivi de « € » à l'affichage). */
export const eur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Sous-titre de la page (vue « Par échéance de paiement »). */
export const EXPLICATION_ENCOURS = "Montants regroupés par mois d'échéance de paiement (selon le mode de chaque fournisseur)";

// Date d'échéance de paiement selon le mode du fournisseur.
//  comptant / inconnu -> le jour même (mois du document)
//  30j                 -> date + 30 jours
//  echeance (30j FDM)  -> date + 31 jours, PUIS fin de ce mois-là
//     (ex. facture du 01/07 -> +31 j = 01/08 -> fin de mois = 31/08, payable en août)
// Renvoie "AAAA-MM-JJ" (heure locale, pas de décalage de fuseau).
export function echeanceISO(docISO, mode) {
  if (!docISO) return docISO || "";
  const d = new Date(docISO + "T00:00:00");
  if (isNaN(d.getTime())) return docISO;
  if (mode === "30j") { d.setDate(d.getDate() + 30); }
  else if (mode === "echeance") {
    d.setDate(d.getDate() + 31);
    const fdm = new Date(d.getFullYear(), d.getMonth() + 1, 0); // dernier jour du mois atteint
    return fdm.toLocaleDateString("sv-SE");
  } else { return docISO; }
  return d.toLocaleDateString("sv-SE");
}

/**
 * Éléments de l'encours (un par commande ou facture retenue), tels que la page
 * les construisait à la lecture.
 * @param {{ fournisseurs?: Array, commandes?: Array, factures?: Array, facturesBl?: Array }} p
 *   lectures de encoursFournisseursDonnees.js (déjà ramenées à des tableaux)
 * @returns {Array<{ kind: "cmd"|"fact", mois: string, fournisseur: string, montant: number, paye: boolean, doc: object }>}
 */
export function itemsEncoursFournisseurs({ fournisseurs = [], commandes = [], factures = [], facturesBl = [] } = {}) {
  // BL rapprochés par facture
  const blByFacture = {};
  (facturesBl || []).forEach(b => { (blByFacture[b.facture_id] = blByFacture[b.facture_id] || []).push(b); });
  const linkedIds = new Set((facturesBl || []).filter(b => b.commande_id).map(b => b.commande_id));
  // mode de paiement par fournisseur (par id et par nom normalisé)
  const modeById = {}, modeByNom = {};
  (fournisseurs || []).forEach(f => { modeById[f.id] = f.mode_paiement || ""; if (f.nom) modeByNom[normNom(f.nom)] = f.mode_paiement || ""; });
  const modeOf = (id, nom) => modeById[id] || modeByNom[normNom(nom)] || "";

  const arr = [];
  (commandes || []).forEach(c => {
    if (c.source === "migration" || linkedIds.has(c.id)) return; // anciennes saisies (avant la refonte) : non comptées
    const montant = c.montant_ht != null ? Number(c.montant_ht)
      : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
    if (!montant) return;
    const docISO = c.date_doc || (c.created_at || "").slice(0, 10);
    const paye = c.statut_facturation === "facture";
    // payé (comptant) -> le mois du document ; sinon -> mois d'échéance selon le mode
    const dueISO = paye ? docISO : echeanceISO(docISO, modeOf(c.fournisseur_id, c.fournisseur_nom));
    arr.push({
      kind: "cmd", mois: (dueISO || "").slice(0, 7), fournisseur: c.fournisseur_nom || "Sans fournisseur", montant, paye,
      doc: { kind: "cmd", type: c.doc_type, numero: c.doc_numero, date: docISO, montant, paye },
    });
  });
  (factures || []).forEach(f => {
    const montant = Number(f.montant_ht) || 0;
    if (!montant) return;
    const docISO = f.date_facture || (f.created_at || "").slice(0, 10);
    const dueISO = f.date_echeance || echeanceISO(docISO, modeOf(f.fournisseur_id, f.fournisseur_nom));
    arr.push({
      kind: "fact", mois: (dueISO || "").slice(0, 7), fournisseur: f.fournisseur_nom || "Sans fournisseur", montant, paye: false,
      doc: { kind: "fact", numero: f.numero, date: docISO, montant, bls: blByFacture[f.id] || [] },
    });
  });
  return arr;
}

/** « À payer » d'un fournisseur pour un mois : la facture si on en a une, sinon le saisi. */
export const aPayerOf = (pf) => (pf.facture > 0 ? pf.facture : pf.saisi);

/**
 * Agrégation mois -> fournisseur : saisi (nos commandes), facturé (factures
 * reçues), payé (comptant déjà réglé). Mois triés du plus récent au plus ancien.
 * @returns {{ moisMap: Map<string, { mois, parFourn: Map, aPayer, paye, total }>, moisList: Array }}
 */
export function regrouperEncoursParMois(items) {
  const moisMap = new Map();
  for (const it of (items || [])) {
    const m = it.mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, { mois: m, parFourn: new Map() });
    const g = moisMap.get(m);
    if (!g.parFourn.has(it.fournisseur)) g.parFourn.set(it.fournisseur, { nom: it.fournisseur, saisi: 0, facture: 0, paye: 0, docs: [] });
    const pf = g.parFourn.get(it.fournisseur);
    if (it.kind === "fact") pf.facture += it.montant;
    else if (it.paye) pf.paye += it.montant;
    else pf.saisi += it.montant;
    if (it.doc) pf.docs.push(it.doc);
  }
  for (const g of moisMap.values()) {
    const list = [...g.parFourn.values()];
    g.aPayer = list.reduce((s, pf) => s + aPayerOf(pf), 0);
    g.paye = list.reduce((s, pf) => s + pf.paye, 0);
    g.total = g.aPayer + g.paye;
  }
  const moisList = [...moisMap.values()].sort((a, b) => b.mois.localeCompare(a.mois));
  return { moisMap, moisList };
}

/** Fournisseurs d'un mois, du plus gros « à payer » au plus petit (ordre de la page). */
export const fournisseursTriesDuMois = (g) => [...(g?.parFourn?.values() || [])].sort((a, b) => aPayerOf(b) - aPayerOf(a));

/** Mois calendaire en cours « AAAA-MM » de la date donnée (heure locale), comme les cartes de la page. */
export const cleMoisCourant = (date) => date.toLocaleDateString("sv-SE").slice(0, 7);

/**
 * Cartes « ce mois » de la page : uniquement l'échéance / le paiement du mois
 * calendaire en cours.
 */
export function chiffresMoisCourant(moisMap, moisCourantKey) {
  return {
    cle: moisCourantKey,
    libelle: moisLabel(moisCourantKey),
    aPayer: moisMap.get(moisCourantKey)?.aPayer || 0,
    paye: moisMap.get(moisCourantKey)?.paye || 0,
  };
}
