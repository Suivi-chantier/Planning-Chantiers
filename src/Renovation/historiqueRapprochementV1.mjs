// ─────────────────────────────────────────────────────────────────────────────
// historiqueRapprochementV1 — historique de la page « Rapprochement factures »
// (RapprochementFactures.jsx, écran d'accueil) : construction de la liste
// factures + reçus et statut affiché de chaque document, DÉPLACÉS À
// L'IDENTIQUE de la page pour être partagés avec le bloc du jour
// « Administratif fournisseurs » (projet docs/projets/organisation-par-jour.md,
// tâche 9). La page et le bloc appellent ces fonctions : même filtre « À
// rapprocher », même nombre, mêmes montants.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Façade front : historiqueRapprochementV1.js. Lectures :
// rapprochementDonnees.js. Vérifié par
// scripts/verif-bloc-administratif-fournisseurs.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** Libellé du badge d'une facture pas encore rapprochée ni archivée (page). */
export const LIBELLE_A_RAPPROCHER = "À rapprocher";

/**
 * Fournisseurs en mode "30j" (facturés directement : une facture par achat,
 * payée à 30 jours). Leurs saisies valent facture -> affichées dans l'historique.
 */
export const idsFournisseurs30j = (fournisseurs) => (fournisseurs || []).filter(f => f.mode_paiement === "30j").map(f => f.id);

/**
 * Historique complet = factures + achats payés comptant (ou facture directe
 * d'un fournisseur 30j), du plus récent au plus ancien (date du document).
 * @param {{ fournisseurs?: Array, factures?: Array, commandes?: Array }} p lectures de rapprochementDonnees.js
 */
export function construireHistoriqueRapprochement({ fournisseurs = [], factures = [], commandes = [] } = {}) {
  const set30j = new Set(idsFournisseurs30j(fournisseurs));
  const lignesFactures = (factures || []).map(f => ({
    key: `f_${f.id}`, kind: "facture", id: f.id,
    fournisseur: f.fournisseur_nom || "", numero: f.numero || "",
    montant: f.montant_ht, statut: f.statut,
    dateISO: f.date_facture || (f.created_at || "").slice(0, 10),
    raw: f,
  }));
  const recus = (commandes || []).map(c => {
    const is30j = set30j.has(c.fournisseur_id);
    return {
      key: `c_${c.id}`, kind: "recu", id: c.id,
      fournisseur: c.fournisseur_nom || "", numero: c.doc_numero || "",
      montant: c.montant_ht,
      statut: is30j ? "facture30j" : "comptant",
      paye: c.statut_facturation === "facture",
      dateISO: c.date_doc || (c.created_at || "").slice(0, 10),
      raw: c,
    };
  });
  return [...lignesFactures, ...recus].sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""));
}

/**
 * Badge d'un document de l'historique : libellé et ton (clé de SEMANTIC :
 * success, info, warning), exactement ceux de la page.
 */
export function statutHistorique(it) {
  if (it.kind === "recu") {
    if (it.statut === "facture30j") return { label: it.paye ? "Facture 30j · payée" : "Facture 30j", ton: it.paye ? "success" : "info" };
    return { label: "Payé comptant", ton: "success" };
  }
  if (it.statut === "rapprochee") return { label: "Rapprochée", ton: "success" };
  if (it.statut === "archivee") return { label: "Archivée", ton: "info" };
  return { label: LIBELLE_A_RAPPROCHER, ton: "warning" };
}

/** Vrai pour un document que la page affiche « À rapprocher ». */
export const estARapprocher = (it) => statutHistorique(it).label === LIBELLE_A_RAPPROCHER;

/** Montant au format de la liste de la page : « 1 235 » (sans décimales, suivi de « € HT »). */
export const fmtEur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

/**
 * Factures « À rapprocher » de l'historique, de la plus ancienne à la plus
 * récente (date du document ; ordre de l'historique conservé à date égale).
 */
export function facturesARapprocherV1(historique) {
  return (historique || []).filter(estARapprocher).slice().reverse()
    .sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
}
