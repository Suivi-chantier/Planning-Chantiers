// ─────────────────────────────────────────────────────────────────────────────
// encoursFournisseursV1 — calcul de l'encours fournisseurs du mail du vendredi
// (api/cron-encours-fournisseurs.js), sorti tel quel du job pour être partagé
// avec la notification F2 (projet docs/projets/notifications-push.md, tâche 8).
//
// DÉPLACÉ SANS RÉÉCRITURE : mêmes règles qu'avant dans le mail —
//   - échéance selon le mode du fournisseur (30 j, 30 j fin de mois, comptant) ;
//   - commandes non rattachées (hors migration), payées = « payé » ;
//   - factures reçues = « facturé » ; à payer = facturé s'il existe, sinon saisi ;
//   - regroupement par mois d'échéance, 6 mois les plus récents.
// Le mail et le push lisent donc le MÊME total (règle 3 du projet, invariant
// « même chiffre = même service »).
//
// Module PUR : aucun accès Supabase, aucune horloge (les dates des documents
// arrivent en paramètre), aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

export const NB_MOIS_ENCOURS = 6;

/** Montant au format du mail : « 12 450,00 ». */
export function eurEncours(n) {
  return (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « 2026-11 » → « novembre 2026 » ; sans date → « Sans date ». */
export function moisLabel(ym) {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
}

export const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Date d'échéance (AAAA-MM-JJ) selon le mode du fournisseur. */
export function echeanceISO(docISO, mode) {
  if (!docISO) return docISO || "";
  const d = new Date(docISO + "T00:00:00");
  if (isNaN(d.getTime())) return docISO;
  if (mode === "30j") { d.setDate(d.getDate() + 30); }
  else if (mode === "echeance") {
    // 30j fin de mois : fin du mois de la facture, PUIS + 30 jours
    // (facture du 01/07 -> 31/07 -> + 30 j = 30/08, payable en août).
    const fdm = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    fdm.setDate(fdm.getDate() + 30);
    return fdm.toISOString().slice(0, 10);
  } else { return docISO; }
  return d.toISOString().slice(0, 10);
}

/** À payer pour un fournisseur d'un mois : facturé s'il existe, sinon saisi. */
export const aPayerOf = (pf) => (pf.facture > 0 ? pf.facture : pf.saisi);

/**
 * Encours par mois d'échéance.
 * @param {{ fournisseurs: Array<{id, nom, mode_paiement}>,
 *           commandes: Array<object>,  // non rattachées (facture_id null), avec lignes:[{prix_total}]
 *           factures: Array<object> }} p // non archivées
 * @returns {{ mois: Array<{ mois: string, fourns: Array<{nom, saisi, facture, paye}>, aPayer: number }>,
 *             totalAPayer: number }}
 */
export function calculerEncoursFournisseursV1({ fournisseurs = [], commandes = [], factures = [] } = {}) {
  const modeById = {}, modeByNom = {};
  (fournisseurs || []).forEach(f => { modeById[f.id] = f.mode_paiement || ""; if (f.nom) modeByNom[normNom(f.nom)] = f.mode_paiement || ""; });
  const modeOf = (id, nom) => modeById[id] || modeByNom[normNom(nom)] || "";

  // mois -> fournisseur -> { saisi, facture, paye }
  const moisMap = new Map();
  const add = (mois, fournisseur, champ, montant) => {
    const m = mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, new Map());
    const pfMap = moisMap.get(m);
    if (!pfMap.has(fournisseur)) pfMap.set(fournisseur, { nom: fournisseur, saisi: 0, facture: 0, paye: 0 });
    pfMap.get(fournisseur)[champ] += montant;
  };

  (commandes || []).forEach(c => {
    if (c.source === "migration") return;
    const montant = c.montant_ht != null ? Number(c.montant_ht)
      : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
    if (!montant) return;
    const docISO = c.date_doc || (c.created_at || "").slice(0, 10);
    const paye = c.statut_facturation === "facture";
    const dueISO = paye ? docISO : echeanceISO(docISO, modeOf(c.fournisseur_id, c.fournisseur_nom));
    add((dueISO || "").slice(0, 7), c.fournisseur_nom || "Sans fournisseur", paye ? "paye" : "saisi", montant);
  });
  (factures || []).forEach(f => {
    const montant = Number(f.montant_ht) || 0;
    if (!montant) return;
    const docISO = f.date_facture || (f.created_at || "").slice(0, 10);
    const dueISO = echeanceISO(docISO, modeOf(f.fournisseur_id, f.fournisseur_nom));
    add((dueISO || "").slice(0, 7), f.fournisseur_nom || "Sans fournisseur", "facture", montant);
  });

  const mois = [...moisMap.entries()]
    .map(([m, pfMap]) => {
      const fourns = [...pfMap.values()].sort((a, b) => aPayerOf(b) - aPayerOf(a));
      const aPayer = fourns.reduce((s, pf) => s + aPayerOf(pf), 0);
      return { mois: m, fourns, aPayer };
    })
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .slice(0, NB_MOIS_ENCOURS); // 6 mois les plus récents
  const totalAPayer = mois.reduce((s, g) => s + g.aPayer, 0);
  return { mois, totalAPayer };
}
