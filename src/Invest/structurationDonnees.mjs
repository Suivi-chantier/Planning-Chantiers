// src/Invest/structurationDonnees.mjs — Calculs du dossier de structuration à partir des données saisies
// UNE SEULE FOIS : chaque bien, les charges du foyer, les dettes, les objectifs, le profil investisseur.
//
// Module pur (aucune base, aucune horloge). Règles de la maison :
//  • une donnée manquante n'est jamais un zéro : l'indicateur vaut `null` et le bien liste ce qui manque ;
//  • tout est AVANT IMPÔT. La fiscalité (SCI IR / IS, LMNP…) vient dans un lot ultérieur, avec des règles
//    sourcées ; ces chiffres ne sont donc ni un résultat fiscal ni une promesse de rendement.
//  • les prêts immobiliers se saisissent sur le bien, les AUTRES dettes dans la liste des dettes : jamais deux fois.

export const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const n0 = (v) => num(v) ?? 0;
const arr = (a) => (Array.isArray(a) ? a : []);
const ratio = (a, b) => (a === null || b === null || b === 0 ? null : a / b);

/** Un bien : rendements, cash-flow et valeur nette. Tout est avant impôt. */
export function analyserBien(lot = {}) {
  const valeur = num(lot.valeur), prix = num(lot.valeur_acquisition), loyer = num(lot.loyer_mois);
  const vacance = Math.min(100, Math.max(0, n0(lot.vacance_pct))) / 100;
  const loyersAnnuels = loyer === null ? null : loyer * 12;
  const loyersEncaisses = loyersAnnuels === null ? null : loyersAnnuels * (1 - vacance);
  const gestion = loyersEncaisses === null ? 0 : loyersEncaisses * (Math.max(0, n0(lot.gestion_pct)) / 100);
  const charges = n0(lot.charges_annuelles) + n0(lot.taxe_fonciere) + n0(lot.assurance_pno) + n0(lot.entretien_annuel) + gestion;
  const resultatAnnuel = loyersEncaisses === null ? null : loyersEncaisses - charges;
  const mensualite = num(lot.mensualite);
  const cashflowMois = resultatAnnuel === null || mensualite === null ? null : resultatAnnuel / 12 - mensualite;
  const crd = num(lot.crd);
  const apport = num(lot.apport_initial);
  const manquants = [];
  if (valeur === null) manquants.push("valeur actuelle");
  if (prix === null) manquants.push("prix d'acquisition");
  if (loyer === null) manquants.push("loyer");
  if (mensualite === null) manquants.push("mensualité");
  if (crd === null) manquants.push("capital restant dû");
  return {
    rendementBrut: ratio(loyersAnnuels, prix),
    rendementNet: ratio(resultatAnnuel, prix),
    cashflowMois,
    cashflowAnnee: cashflowMois === null ? null : cashflowMois * 12,
    rentabiliteFondsPropres: cashflowMois === null ? null : ratio(cashflowMois * 12, apport),
    valeurNette: valeur === null || crd === null ? null : valeur - crd,
    plusValueLatente: valeur === null || prix === null ? null : valeur - prix,
    effortEpargneMois: cashflowMois === null ? null : Math.max(0, -cashflowMois),
    chargesAnnuelles: charges,
    manquants,
  };
}

export const CATEGORIES_CHARGES = Object.freeze([
  ["logement", "Logement (loyer ou mensualité de la résidence principale)"],
  ["assurances", "Assurances"],
  ["vehicules", "Véhicules"],
  ["scolarite", "Enfants, scolarité, garde"],
  ["abonnements", "Abonnements"],
  ["courantes", "Dépenses courantes"],
  ["loisirs", "Loisirs et voyages"],
  ["autres", "Autres charges fixes"],
]);

/** Dettes hors immobilier locatif (celui-ci est saisi sur chaque bien). */
export function analyserDettes(dettes) {
  const liste = arr(dettes);
  return {
    capitalRestant: liste.reduce((s, d) => s + n0(d.capital_restant), 0),
    mensualites: liste.reduce((s, d) => s + n0(d.mensualite), 0),
    nombre: liste.length,
    incompletes: liste.filter((d) => num(d.capital_restant) === null || num(d.mensualite) === null).length,
  };
}

/**
 * Train de vie et capacité d'épargne.
 *   capacité théorique = revenus récurrents du foyer + résultat des biens après leurs mensualités
 *                        − charges du foyer − mensualités des autres dettes
 * comparée à l'épargne réellement constatée. Les revenus exceptionnels sont exclus.
 */
export function analyserFlux(collecte = {}) {
  const profil = collecte.profil || {};
  const charges = collecte.charges || {};
  const lots = arr(collecte.patrimoine?.lots);
  const dettes = analyserDettes(collecte.dettes);
  const revenusMois = n0(profil.revenus_nets_mois) + n0(profil.revenus_conjoint_mois) + (n0(profil.dividendes_an) + n0(profil.autres_revenus_an)) / 12;
  const biens = lots.map(analyserBien);
  const cashflowBiens = biens.reduce((s, b) => s + (b.cashflowMois ?? 0), 0);
  const biensIncomplets = biens.filter((b) => b.cashflowMois === null).length;
  const chargesFoyer = CATEGORIES_CHARGES.reduce((s, [k]) => s + n0(charges[k]), 0);
  const chargesSaisies = CATEGORIES_CHARGES.some(([k]) => num(charges[k]) !== null);
  const capaciteTheorique = revenusMois > 0 && chargesSaisies ? revenusMois + cashflowBiens - chargesFoyer - dettes.mensualites : null;
  const epargneReelle = num(charges.epargne_reelle_mois);
  return {
    revenusRecurrentsMois: revenusMois,
    revenusExceptionnelsAn: n0(profil.revenus_exceptionnels_an),
    chargesFoyerMois: chargesFoyer,
    cashflowBiensMois: cashflowBiens,
    biensIncomplets,
    mensualitesAutresDettes: dettes.mensualites,
    capaciteEpargneTheorique: capaciteTheorique,
    epargneReelle,
    ecart: capaciteTheorique === null || epargneReelle === null ? null : epargneReelle - capaciteTheorique,
  };
}

export const TYPES_OBJECTIF = Object.freeze([
  "Créer du patrimoine", "Revenus complémentaires", "Indépendance financière", "Retraite", "Résidence principale",
  "Études des enfants", "Protéger le conjoint", "Transmettre", "Réduire la fiscalité", "Diversifier",
  "Expatriation", "Préparer la cession d'une entreprise", "Autre",
]);
export const FLEXIBILITES = Object.freeze(["Fixe", "Souple", "Très souple"]);

/** Un objectif est exploitable s'il a un montant, une échéance et une priorité. */
export function analyserObjectifs(objectifs) {
  const liste = arr(objectifs);
  const exploitables = liste.filter((o) => num(o.montant) !== null && String(o.echeance || "").trim() !== "" && String(o.priorite || "").trim() !== "");
  return {
    total: liste.length,
    exploitables: exploitables.length,
    incomplets: liste.length - exploitables.length,
    parPriorite: [...liste].sort((a, b) => (num(a.priorite) ?? 9) - (num(b.priorite) ?? 9) || String(a.echeance || "9999").localeCompare(String(b.echeance || "9999"))),
  };
}

export const DIMENSIONS_PROFIL_IMMO = Object.freeze([
  ["tolerance_endettement", "Tolérance à l'endettement", ["Faible", "Moyenne", "Élevée"]],
  ["cashflow_negatif_max", "Cash-flow négatif acceptable (€/mois)", null],
  ["besoin_liquidite", "Besoin de liquidité", ["Faible", "Moyen", "Fort"]],
  ["horizon_detention", "Horizon de détention", ["< 5 ans", "5 à 10 ans", "10 à 20 ans", "> 20 ans"]],
  ["appetence_travaux", "Appétence pour les travaux", ["Aucune", "Limitée", "Forte"]],
  ["appetence_gestion", "Appétence pour la gestion locative", ["Délègue tout", "Partage", "Gère lui-même"]],
  ["risque_locatif", "Risque locatif acceptable", ["Faible", "Moyen", "Élevé"]],
  ["risque_geographique", "Risque géographique acceptable", ["Une seule ville", "Région", "Plusieurs régions"]],
  ["complexite_juridique", "Complexité juridique acceptable", ["Simple", "Intermédiaire", "Avancée"]],
  ["temps_disponible", "Temps disponible", ["Très peu", "Quelques heures par mois", "Beaucoup"]],
  ["experience_immobiliere", "Expérience immobilière", ["Aucune", "1 à 3 biens", "4 biens ou plus"]],
  ["connaissances_fiscales", "Connaissances fiscales", ["Faibles", "Moyennes", "Bonnes"]],
  ["capacite_imprevu", "Capacité à absorber un imprévu", ["Faible", "Moyenne", "Forte"]],
]);

export function analyserProfilImmo(profilImmo = {}) {
  const renseignees = DIMENSIONS_PROFIL_IMMO.filter(([k]) => String(profilImmo?.[k] ?? "").trim() !== "").length;
  return { renseignees, total: DIMENSIONS_PROFIL_IMMO.length, complet: renseignees === DIMENSIONS_PROFIL_IMMO.length };
}
