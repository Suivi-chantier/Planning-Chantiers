// src/Invest/dossiers/situationPatrimoniale.mjs — Situation patrimoniale du
// foyer (Chantier 1.1, Tranche 2c) : collecte FACTUELLE.
//
// Catalogues (mêmes clés que la migration 20260930230000), calculs agrégés,
// préremplissage prudent de la personne principale, avertissements.
// Pas de capacité d'emprunt ni de recommandation : c'est l'Analyse.
//
// Module PUR : données en paramètre, aucun accès Supabase, aucune horloge.
// Façade front : ./situationPatrimoniale.js.

export const LIENS = Object.freeze({ principal: "Personne principale", conjoint: "Conjoint·e", enfant: "Enfant", ascendant: "Ascendant", autre: "Autre" });
export const CIVILITES = Object.freeze({ m: "M.", mme: "Mme", autre: "Autre" });
export const STATUTS_PRO = Object.freeze({ salarie_cdi: "Salarié CDI", salarie_cdd: "Salarié CDD", fonctionnaire: "Fonctionnaire",
  tns: "Travailleur non salarié", dirigeant: "Dirigeant", retraite: "Retraité", sans_activite: "Sans activité", etudiant: "Étudiant", autre: "Autre" });

export const FAMILLES = Object.freeze({ revenu: "Revenu", charge: "Charge", actif_financier: "Actif financier" });
export const CATEGORIES = Object.freeze({
  revenu: { salaire: "Salaire", tns: "Revenu TNS", dividendes: "Dividendes", retraite: "Retraite", allocation: "Allocation", pension_recue: "Pension reçue", autre: "Autre revenu" },
  charge: { charge_fixe: "Charge fixe", loyer_residence: "Loyer de la résidence", impot: "Impôt", autre: "Autre charge" },
  actif_financier: { epargne_disponible: "Épargne disponible", assurance_vie: "Assurance-vie", pea: "PEA", cto: "Compte-titres", per: "PER",
    epargne_salariale: "Épargne salariale", scpi: "SCPI", crypto: "Crypto-actifs", autre: "Autre actif financier" },
});
export const PERIODICITES = Object.freeze({ mensuelle: "par mois", annuelle: "par an" });
export const BASES_REVENU = Object.freeze({ net_avant_impot: "Net avant impôt", net_apres_impot: "Net après impôt", non_precisee: "Base non précisée" });

export const TYPES_ENGAGEMENT = Object.freeze({ credit_immobilier: "Crédit immobilier", credit_consommation: "Crédit à la consommation",
  pret_personnel: "Prêt personnel", revolving: "Crédit renouvelable", pret_familial: "Prêt familial", pension_versee: "Pension versée",
  caution: "Caution", hors_bilan_autre: "Autre engagement hors bilan" });
export const TYPES_CREDIT = Object.freeze(["credit_immobilier", "credit_consommation", "pret_personnel", "revolving", "pret_familial"]);
export const TYPES_TAUX = Object.freeze({ fixe: "Fixe", variable: "Variable", capee: "Variable capé", zero: "Taux zéro", autre: "Autre" });

export const USAGES = Object.freeze({ residence_principale: "Résidence principale", residence_secondaire: "Résidence secondaire", locatif: "Locatif",
  professionnel: "Professionnel", terrain: "Terrain", autre: "Autre" });
export const TYPOLOGIES = Object.freeze({ appartement: "Appartement", maison: "Maison", immeuble: "Immeuble", local: "Local", terrain: "Terrain", parking: "Parking", autre: "Autre" });
export const SOURCES_VALORISATION = Object.freeze({ estimation_client: "Estimation du client", estimation_profero: "Estimation Profero",
  expertise: "Expertise", avis_valeur: "Avis de valeur", prix_acquisition: "Prix d'acquisition", autre: "Autre" });
export const REGIMES_FISCAUX_BIEN = Object.freeze({ micro_foncier: "Micro-foncier", reel_foncier: "Réel foncier", lmnp_micro: "LMNP micro-BIC",
  lmnp_reel: "LMNP réel", lmp: "LMP", sci_ir: "SCI à l'IR", sci_is: "SCI à l'IS", aucun: "Aucun", autre: "Autre" });
export const MODES_DETENTION = Object.freeze({ propre: "En propre", communaute: "Communauté", indivision: "Indivision", structure: "Via une structure",
  demembrement: "Démembrement", autre: "Autre" });
export const STATUTS_ACTIF = Object.freeze({ detenu: "Détenu", en_vente: "En vente", vendu: "Vendu" });

export const TYPES_STRUCTURE = Object.freeze({ sci: "SCI", holding: "Holding", societe_exploitation: "Société d'exploitation", sarl_famille: "SARL de famille", autre: "Autre" });
export const REGIMES_STRUCTURE = Object.freeze({ ir: "IR", is: "IS" });
export const STATUTS_STRUCTURE = Object.freeze({ existante: "Existante", en_creation: "En création", dissoute: "Dissoute" });

export const SOURCES = Object.freeze({ client: "Saisi par le client", profero: "Saisi par Profero", reprise: "Reprise" });
export const VERIFICATIONS = Object.freeze({ non_verifiee: "Non vérifiée", verifiee: "Vérifiée", a_corriger: "À corriger" });

export const SECTIONS = Object.freeze([
  { cle: "foyer", table: "invest_personnes", libelle: "Foyer" },
  { cle: "flux", table: "invest_postes_financiers", libelle: "Revenus, charges & épargne" },
  { cle: "engagements", table: "invest_engagements", libelle: "Crédits & engagements" },
  { cle: "immobilier", table: "invest_actifs_patrimoniaux", libelle: "Patrimoine immobilier" },
  { cle: "structures", table: "invest_structures", libelle: "Structures" },
]);

const nombre = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const actifs = (rows = []) => rows.filter((r) => r && !r.archive_le);
const arrondi = (n) => Math.round(n * 100) / 100;

/** Montant ramené au mois (flux). Un stock n'a pas de mensualisation. */
export function mensualiser(montant, periodicite) {
  if (periodicite === "mensuelle") return nombre(montant);
  if (periodicite === "annuelle") return nombre(montant) / 12;
  return null;
}

/**
 * Agrégats de la situation patrimoniale (hors archivés). Toute valeur
 * manquante est COMPTÉE à part (incomplets) : un total partiel n'est jamais
 * présenté comme complet.
 */
export function calculerSituation({ postes = [], engagements = [], actifsImmo = [] } = {}) {
  const p = actifs(postes), e = actifs(engagements).filter((x) => !x.solde), a = actifs(actifsImmo).filter((x) => x.statut !== "vendu");
  const flux = (famille) => p.filter((x) => x.famille === famille).reduce((s, x) => s + (mensualiser(x.montant, x.periodicite) ?? 0), 0);
  const revenus = p.filter((x) => x.famille === "revenu");
  const credits = e.filter((x) => TYPES_CREDIT.includes(x.type));
  const pensions = e.filter((x) => x.type === "pension_versee");
  const immo = e.filter((x) => x.type === "credit_immobilier");
  const stocks = p.filter((x) => x.famille === "actif_financier");
  const valeurImmo = a.reduce((s, x) => s + nombre(x.valeur_estimee), 0);
  const detteImmo = immo.reduce((s, x) => s + nombre(x.capital_restant_du), 0);
  const detteTotale = credits.reduce((s, x) => s + nombre(x.capital_restant_du), 0);
  const actifsFinanciers = stocks.reduce((s, x) => s + nombre(x.montant), 0);
  return {
    revenusMensuels: arrondi(flux("revenu")),
    revenusParBase: Object.fromEntries(Object.keys(BASES_REVENU).map((b) => [b, arrondi(revenus.filter((x) => x.base_revenu === b)
      .reduce((s, x) => s + (mensualiser(x.montant, x.periodicite) ?? 0), 0))])),
    // Charges : postes « charge » + pensions versées (engagement).
    chargesMensuelles: arrondi(flux("charge") + pensions.reduce((s, x) => s + nombre(x.mensualite), 0)),
    mensualitesCredits: arrondi(credits.reduce((s, x) => s + nombre(x.mensualite), 0)),
    assuranceCredits: arrondi(credits.reduce((s, x) => s + nombre(x.assurance_mensuelle), 0)),
    epargneDisponible: arrondi(stocks.filter((x) => x.categorie === "epargne_disponible").reduce((s, x) => s + nombre(x.montant), 0)),
    actifsFinanciers: arrondi(actifsFinanciers),
    valeurImmobiliereBrute: arrondi(valeurImmo),
    detteImmobiliereRestante: arrondi(detteImmo),
    patrimoineImmobilierNet: arrondi(valeurImmo - detteImmo),
    // Simplifié : actifs financiers + immobilier à 100 % (même détenu en partie : indivision, SCI) − capital
    // restant dû des crédits. Ce n'est PAS la quote-part patrimoniale personnelle (future Analyse patrimoniale).
    patrimoineNetSimplifie: arrondi(actifsFinanciers + valeurImmo - detteTotale),
    incomplets: {
      actifsSansValeur: a.filter((x) => x.valeur_estimee == null).length,
      creditsSansCrd: credits.filter((x) => x.capital_restant_du == null).length,
      creditsSansMensualite: credits.filter((x) => x.mensualite == null).length,
      revenusBaseNonPrecisee: revenus.filter((x) => x.base_revenu === "non_precisee").length,
    },
  };
}

const COUPLE = /\s(et|&|\+|\/)\s|,|\bet\b/i;
/**
 * Personne principale proposée à partir de la fiche client — seulement ce qui
 * est fiable. Un nom de foyer (« TOM ET CAMILLE », « LEO et LEA ») n'est JAMAIS
 * découpé : prénom et nom restent vides, à saisir par le collaborateur.
 */
export function personnePrincipaleProposee(client = {}) {
  const prenom = String(client.prenom || "").trim(), nom = String(client.nom || "").trim();
  const foyer = COUPLE.test(` ${prenom} `) || COUPLE.test(` ${nom} `);
  return {
    lien: "principal",
    prenom: foyer ? "" : prenom,
    nom: foyer ? "" : nom,
    email: String(client.email || "").trim(),
    telephone: String(client.telephone || "").trim(),
    avertissement: foyer ? `« ${[prenom, nom].filter(Boolean).join(" ")} » désigne un foyer : saisissez le prénom et le nom de la personne principale.` : null,
  };
}

/** Avertissements non bloquants d'une ligne (l'écran les affiche, la base ne bloque pas). */
export function avertissements(table, r = {}) {
  const out = [];
  if (table === "invest_structures") {
    const total = (r.associes || []).reduce((s, x) => s + nombre(x.pourcentage), 0);
    if ((r.associes || []).length && Math.abs(total - 100) > 0.001) out.push(`Associés : ${arrondi(total)} % renseignés sur 100 %.`);
    if (!(r.associes || []).length) out.push("Associés non renseignés.");
  }
  if (table === "invest_actifs_patrimoniaux") {
    if (r.valeur_estimee == null) out.push("Valeur estimée manquante.");
    else if (!r.date_valeur) out.push("Date de la valeur manquante.");
    if (r.mode_detention === "structure" && !r.structure_id) out.push("Détenu via une structure : structure à préciser.");
    const qp = (r.detenteurs || []).reduce((s, x) => s + nombre(x.quote_part), 0);
    if ((r.detenteurs || []).length && Math.abs(qp - 100) > 0.001) out.push(`Détenteurs : ${arrondi(qp)} % renseignés sur 100 %.`);
  }
  if (table === "invest_engagements" && TYPES_CREDIT.includes(r.type)) {
    if (r.capital_restant_du == null) out.push("Capital restant dû manquant.");
    else if (!r.crd_date) out.push("Date du capital restant dû manquante.");
  }
  if (table === "invest_postes_financiers" && r.famille === "revenu" && r.base_revenu === "non_precisee") out.push("Base du revenu non précisée (net avant ou après impôt ?).");
  return out;
}

/** Libellé court d'une ligne pour les cartes. */
export function titreLigne(table, r = {}) {
  switch (table) {
    case "invest_personnes": return [CIVILITES[r.civilite], r.prenom, r.nom].filter(Boolean).join(" ") || "Personne";
    case "invest_postes_financiers": return r.libelle || CATEGORIES[r.famille]?.[r.categorie] || "Poste";
    case "invest_engagements": return [TYPES_ENGAGEMENT[r.type], r.preteur_beneficiaire].filter(Boolean).join(" · ") || "Engagement";
    case "invest_actifs_patrimoniaux": return r.libelle || [USAGES[r.usage], TYPOLOGIES[r.typologie]].filter(Boolean).join(" · ") || "Bien détenu";
    case "invest_structures": return r.denomination || "Structure";
    default: return "—";
  }
}
