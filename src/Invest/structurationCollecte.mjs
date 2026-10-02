// src/Invest/structurationCollecte.mjs — Une collecte d'information SIMPLE : l'essentiel d'abord, le reste selon la situation.
//
// Constat : la saisie comptait plus de 130 champs répartis sur trois onglets, demandés à tout le monde, dont beaucoup
// ne servent qu'à un client sur dix (expatriation, sociétés, divorce…). Résultat : on ne sait plus quoi remplir en
// premier ni quand on a « assez » pour lancer le diagnostic.
//
// Principe retenu :
//   1. UN socle de quatorze questions, celles dont les calculs du dossier ont réellement besoin ;
//   2. des MODULES (dirigeant, étranger, société en place, meublé, famille recomposée, IFI) qu'on active seulement s'ils
//      concernent le client : ils ouvrent les questions et les pièces correspondantes ;
//   3. les pièces demandées se limitent à celles qui ont un sens pour CE client ; les autres restent consultables.
// Rien n'est supprimé : les champs détaillés existent toujours (saisie détaillée), au même endroit dans le dossier.
//
// Module pur : aucune base, aucune horloge.

import { analyserBien, analyserObjectifs, num } from "./structurationDonnees.mjs";

const plein = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const arr = (a) => (Array.isArray(a) ? a : []);

export const MODULES = Object.freeze([
  { cle: "dirigeant", libelle: "Dirigeant, indépendant ou profession libérale", aide: "Sociétés détenues, rémunération, dividendes, comptes courants, cautions." },
  { cle: "expatrie", libelle: "Revenus ou résidence fiscale à l'étranger", aide: "Calendrier France / étranger, impact sur le financement bancaire." },
  { cle: "structure_existante", libelle: "SCI, société ou holding déjà en place", aide: "Statuts, associés, régime, biens détenus, résultat." },
  { cle: "meuble", libelle: "Location meublée déjà pratiquée (LMNP / LMP)", aide: "Régime, amortissements, liasse fiscale." },
  { cle: "recompose", libelle: "Divorce, famille recomposée ou donations passées", aide: "Protection du conjoint, testament, donations déjà réalisées." },
  { cle: "ifi", libelle: "Patrimoine proche ou au-dessus du seuil de l'IFI", aide: "Déclaration IFI, éléments d'assiette." },
]);

export const modulesActifs = (data) => MODULES.filter((m) => data?.collecte?.modules?.[m.cle] === true).map((m) => m.cle);

const estCouple = (profil = {}) => /mari|pacs/i.test(String(profil.situation_familiale || ""));
const aDesBiens = (c) => arr(c.patrimoine?.lots).some((l) => plein(l.valeur) || plein(l.adresse));

/** Les quatorze questions du socle. `ok` est vrai quand la réponse est donnée (ou sans objet). */
export const QUESTIONS_SOCLE = Object.freeze([
  { cle: "situation", etape: "foyer", libelle: "Situation familiale", ok: (c) => plein(c.profil?.situation_familiale) },
  { cle: "regime", etape: "foyer", libelle: "Régime matrimonial", ok: (c) => !estCouple(c.profil) || plein(c.profil?.regime_matrimonial) },
  { cle: "statut", etape: "foyer", libelle: "Activité professionnelle", ok: (c) => plein(c.profil?.statut_pro) || plein(c.profil?.profession) },
  { cle: "tmi", etape: "foyer", libelle: "Tranche d'imposition (TMI)", ok: (c) => plein(c.profil?.tmi) && !/v[ée]rifier/i.test(c.profil.tmi) },
  { cle: "revenus", etape: "flux", libelle: "Revenus du foyer", ok: (c) => plein(c.profil?.revenus_nets_mois) },
  { cle: "charges", etape: "flux", libelle: "Charges du foyer", ok: (c) => ["logement", "courantes"].some((k) => num(c.charges?.[k]) !== null) },
  { cle: "epargne", etape: "flux", libelle: "Épargne réellement mise de côté", ok: (c) => num(c.charges?.epargne_reelle_mois) !== null },
  { cle: "biens", etape: "patrimoine", libelle: "Biens immobiliers (ou « aucun bien »)", ok: (c) => aDesBiens(c) || c.patrimoine?.aucun_bien === true },
  { cle: "biens_complets", etape: "patrimoine", libelle: "Valeur, loyer, mensualité et capital restant dû de chaque bien",
    ok: (c) => c.patrimoine?.aucun_bien === true && !aDesBiens(c) ? true : aDesBiens(c) && arr(c.patrimoine?.lots).every((l) => !analyserBien(l).manquants.some((m) => m !== "prix d'acquisition")) },
  { cle: "residence", etape: "patrimoine", libelle: "Résidence principale (propriétaire ou non)", ok: (c) => plein(c.patrimoine?.residence_principale_statut) },
  { cle: "liquidites", etape: "patrimoine", libelle: "Liquidités et placements", ok: (c) => plein(c.patrimoine_financier?.liquidites) },
  { cle: "dettes", etape: "dettes", libelle: "Autres dettes (ou « aucune »)", ok: (c) => arr(c.dettes).length > 0 || c.patrimoine?.aucune_autre_dette === true },
  { cle: "objectifs", etape: "objectifs", libelle: "Au moins un objectif chiffré, tous complets", ok: (c) => { const o = analyserObjectifs(c.objectifs_mesures); return o.exploitables >= 1 && o.incomplets === 0; } },
  { cle: "profil", etape: "objectifs", libelle: "Profil investisseur : les quatre critères clés", ok: (c) => ["tolerance_endettement", "cashflow_negatif_max", "appetence_travaux", "appetence_gestion"].every((k) => plein(c.profil_immo?.[k])) },
]);

export const ETAPES_COLLECTE = Object.freeze([
  { cle: "foyer", libelle: "Le foyer" }, { cle: "flux", libelle: "Revenus et charges" }, { cle: "patrimoine", libelle: "Patrimoine" },
  { cle: "dettes", libelle: "Dettes" }, { cle: "objectifs", libelle: "Objectifs et profil" },
]);

/** Les questions sans lesquelles le diagnostic chiffré n'a pas de sens (il afficherait des zéros). */
export const QUESTIONS_DIAGNOSTIC = Object.freeze(["revenus", "charges", "epargne", "biens", "biens_complets", "residence", "liquidites", "dettes"]);

/** Avancement du socle : combien de questions répondues, lesquelles manquent, par étape. */
export function avancementCollecte(data) {
  const c = data?.collecte || {};
  const questions = QUESTIONS_SOCLE.map((q) => ({ cle: q.cle, etape: q.etape, libelle: q.libelle, ok: !!q.ok(c) }));
  const faites = questions.filter((q) => q.ok).length;
  return {
    questions, faites, total: questions.length, pourcentage: Math.round((faites / questions.length) * 100),
    manquantes: questions.filter((q) => !q.ok),
    parEtape: ETAPES_COLLECTE.map((e) => { const qs = questions.filter((q) => q.etape === e.cle); return { ...e, faites: qs.filter((q) => q.ok).length, total: qs.length }; }),
    pretPourDiagnostic: faites === questions.length,
    diagnosticPossible: QUESTIONS_DIAGNOSTIC.every((k) => questions.find((q) => q.cle === k)?.ok),
    manquantesDiagnostic: questions.filter((q) => QUESTIONS_DIAGNOSTIC.includes(q.cle) && !q.ok),
  };
}

// ── Pièces ──────────────────────────────────────────────────────────────────────────────────────

const SOCLE_DOCS = ["piece_identite", "justificatif_domicile", "situation_familiale", "avis_imposition", "releves_bancaires", "epargne_disponible", "releves_placements", "contrat_mission", "consentement_rgpd"];
const PAR_MODULE = {
  dirigeant: ["bilans_entreprise", "liasse_fiscale", "remuneration_dividendes", "urssaf", "kbis_statuts_pro"],
  expatrie: ["declarations_etrangeres"],
  structure_existante: ["statuts_societes", "kbis_sci", "bilans_sci", "organigramme_detention"],
  meuble: ["declarations_locatives"],
  recompose: ["contrat_mariage", "donations_anterieures"],
  ifi: ["declaration_ifi"],
};

/** Identifiants des pièces à demander à CE client. Les autres sont « complémentaires ». */
export function documentsPertinents(data) {
  const c = data?.collecte || {};
  const ids = new Set(SOCLE_DOCS);
  const ajoute = (...l) => l.forEach((x) => ids.add(x));
  if (estCouple(c.profil)) ajoute("contrat_mariage");
  const dettes = arr(c.dettes).length > 0 || num(c.patrimoine?.rp_crd) > 0 || arr(c.patrimoine?.lots).some((l) => num(l.crd) > 0);
  if (dettes) ajoute("credits_en_cours", "tableau_credits");
  if (aDesBiens(c)) ajoute("actes_notaries", "amortissements_immo", "baux", "taxes_foncieres");
  const dirigeant = data?.collecte?.modules?.dirigeant === true;
  if (!dirigeant && (!plein(c.profil?.statut_pro) || /salari|cdi|cdd|fonction/i.test(c.profil.statut_pro))) ajoute("bulletins_salaire", "contrat_travail");
  for (const m of modulesActifs(data)) ajoute(...(PAR_MODULE[m] || []));
  const fin = c.patrimoine_financier || {};
  if (plein(fin.assurance_vie)) ajoute("assurance_vie");
  if (plein(fin.pea_cto)) ajoute("pea_cto");
  if (plein(fin.per)) ajoute("per_retraite");
  if (plein(c.profil?.dispositifs_fiscaux)) ajoute("produits_defiscalisants", "deficits_reportables");
  return ids;
}

/** Une pièce sans identifiant (donnée ancienne ou de test) est toujours considérée pertinente. */
export const estPertinent = (pertinents, doc) => !doc?.id || pertinents.has(doc.id);
