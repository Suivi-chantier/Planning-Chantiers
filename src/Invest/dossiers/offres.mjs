// src/Invest/dossiers/offres.mjs — Missions Offre 2 / Offre 3 (Invest V2, chantier 9).
//
// Les deux offres réellement vendues, lues sur le type de mission :
//   Offre 2 (accompagnement_acquisition) : Projet → Documents → Recherche →
//     Opportunités → Financement → Acquisition.
//   Offre 3 (audit_patrimonial) : phase Patrimoine (Collecte → Analyse →
//     Stratégie → Rapport & restitution), puis phase Investissement (Cadrage
//     facultatif, puis les jalons de l'Offre 2). L'Offre 3 contient l'Offre 2.
// Les 11 étapes internes ne changent pas : un jalon n'est qu'un regroupement.
// Honoraires : forfait de mission dû à la signature ; accompagnement = 50 % de
// la remise obtenue, par acquisition (calcul avec les Opérations, plus tard).
//
// La base applique les mêmes règles (supabase/migrations/20261001100000_invest_missions_offres.sql) ;
// ce module prépare les modifications et ne remplace jamais le contrôle serveur.
// Module PUR : données en paramètre, date du jour en paramètre.

import { ETAPES_PARCOURS, TYPES_MISSION, STATUTS_LETTRE_MISSION, STATUTS_DOSSIER_NON_CLOS } from "./parcours.mjs";

export const OFFRES = Object.freeze({
  accompagnement_acquisition: { code: "offre2", court: "Offre 2", libelle: "Accompagnement à l'investissement" },
  audit_patrimonial: { code: "offre3", court: "Offre 3", libelle: "Accompagnement patrimonial global" },
});

// `special` : jalon porté par la mission elle-même, pas par une étape.
const JALONS_INVESTISSEMENT = [
  { cle: "documents", libelle: "Documents", etapes: ["documents"] },
  { cle: "recherche", libelle: "Recherche", etapes: ["recherche"] },
  { cle: "opportunites", libelle: "Opportunités", etapes: ["opportunites"] },
  { cle: "financement", libelle: "Financement", etapes: ["financement"] },
  { cle: "acquisition", libelle: "Acquisition", etapes: ["structuration", "acquisition", "suivi"] },
];

export const PHASES_OFFRE = Object.freeze({
  offre2: [
    { cle: "investissement", libelle: "Investissement", jalons: [
      { cle: "projet", libelle: "Projet", etapes: ["signature", "collecte", "analyse", "strategie"] },
      ...JALONS_INVESTISSEMENT] },
  ],
  offre3: [
    { cle: "patrimoine", libelle: "Patrimoine", jalons: [
      { cle: "collecte", libelle: "Collecte", etapes: ["signature", "collecte"] },
      { cle: "analyse", libelle: "Analyse", etapes: ["analyse"] },
      { cle: "strategie", libelle: "Stratégie", etapes: ["strategie"] },
      { cle: "restitution", libelle: "Rapport & restitution", etapes: [], special: "restitution" }] },
    { cle: "investissement", libelle: "Investissement", jalons: [
      { cle: "cadrage", libelle: "Cadrage", etapes: [], special: "cadrage" },
      ...JALONS_INVESTISSEMENT] },
  ],
});

/** Jalons à plat par offre (lecture des 11 étapes). */
export const JALONS_OFFRE = Object.freeze(Object.fromEntries(
  Object.entries(PHASES_OFFRE).map(([k, phases]) => [k, phases.flatMap((p) => p.jalons)])));

export const ETATS_JALON = Object.freeze({
  a_venir: "À venir",
  a_faire: "À faire",
  en_cours: "En cours",
  bloque: "Bloqué",
  termine: "Terminé",
  sans_objet: "Non nécessaire",
  absent: "Étapes absentes",
});

export const STATUTS_CADRAGE = Object.freeze({ fait: "Fait", non_necessaire: "Non nécessaire" });

export const REGLE_ACCOMPAGNEMENT = "50 % de la remise obtenue (prix affiché − prix d'achat), par acquisition";

const jour = (v) => (v ? String(v).slice(0, 10) : null);
const dateFr = (iso) => (iso ? iso.split("-").reverse().join("/") : null);
const libelleEtape = (cle) => ETAPES_PARCOURS.find((e) => e.cle === cle)?.libelle ?? null;
const estDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const enCours = (d) => STATUTS_DOSSIER_NON_CLOS.includes(d?.statut);
const estOffre3 = (d) => d?.type_mission === "audit_patrimonial";

export function offreDe(typeMission) {
  const o = OFFRES[typeMission];
  if (o) return { ...o, type: typeMission };
  return { code: null, court: null, libelle: TYPES_MISSION[typeMission] ?? "Type de mission non précisé", type: typeMission ?? null };
}

/** Jalon visible d'une étape selon l'offre ; à défaut, le libellé de l'étape. */
export function jalonDe(typeMission, cleEtape) {
  if (!cleEtape) return null;
  const jalons = JALONS_OFFRE[OFFRES[typeMission]?.code] || [];
  return jalons.find((j) => j.etapes.includes(cleEtape))?.libelle ?? libelleEtape(cleEtape);
}

/**
 * Jalon où en est la mission (`cleEtape` : étape principale du pilotage, ou
 * null ; `etapes` : étapes de la mission). En Offre 3 sans restitution : une
 * fois la Stratégie finie, ou si la phase Investissement a déjà démarré, la
 * mission est au jalon « Rapport & restitution ». Après la restitution, sans
 * étape active ni cadrage décidé : « Cadrage ».
 */
export function jalonActuel(dossier, cleEtape, etapes = []) {
  if (estOffre3(dossier)) {
    const phase1 = PHASES_OFFRE.offre3[0].jalons.flatMap((j) => j.etapes);
    if (!dossier.restitution_le) {
      if (cleEtape && phase1.includes(cleEtape)) return jalonDe(dossier.type_mission, cleEtape);
      const strategie = etapes.find((e) => e.etape === "strategie" && !e.operation_id && (!e.dossier_id || e.dossier_id === dossier.id));
      if (cleEtape || ["terminee", "non_applicable"].includes(strategie?.statut)) return "Rapport & restitution";
      return null;
    }
    if (!dossier.cadrage_statut && !cleEtape) return "Cadrage";
  }
  return jalonDe(dossier?.type_mission, cleEtape);
}

function etatDepuisEtapes(lignes) {
  const presentes = lignes.filter((e) => e?.present);
  if (presentes.length === 0) return "absent";
  if (presentes.some((e) => e.statut === "bloquee")) return "bloque";
  if (presentes.some((e) => e.active)) return "en_cours";
  const finies = presentes.filter((e) => ["terminee", "non_applicable"].includes(e.statut));
  if (finies.length === presentes.length) return presentes.every((e) => e.statut === "non_applicable") ? "sans_objet" : "termine";
  return presentes.some((e) => e.statut === "terminee") ? "en_cours" : "a_venir";
}

/**
 * Parcours de la mission par phases et jalons.
 * @param dossier ligne invest_dossiers ; @param ruban sortie de dossierVue.ruban()
 * @returns null si le type de mission n'a pas de parcours d'offre (conseil, autre).
 */
export function parcoursOffre(dossier, ruban = []) {
  const offre = offreDe(dossier?.type_mission);
  const phases = PHASES_OFFRE[offre.code];
  if (!phases) return null;
  const parCle = new Map(ruban.map((e) => [e.cle, e]));
  const strategieFinie = ["terminee", "non_applicable"].includes(parCle.get("strategie")?.statut);
  const restitution = jour(dossier.restitution_le);
  const alertes = [];

  const lirePhases = phases.map((ph) => {
    const jalons = ph.jalons.map((j) => {
      let etat, detail = null;
      if (j.special === "restitution") {
        etat = restitution ? "termine" : strategieFinie ? "a_faire" : "a_venir";
        detail = restitution ? `Rapport remis et restitué le ${dateFr(restitution)}` : null;
      } else if (j.special === "cadrage") {
        if (dossier.cadrage_statut === "fait") { etat = "termine"; detail = `Fait le ${dateFr(jour(dossier.cadrage_le))}`; }
        else if (dossier.cadrage_statut === "non_necessaire") etat = "sans_objet";
        else etat = restitution ? "a_faire" : "a_venir";
      } else {
        etat = etatDepuisEtapes(j.etapes.map((c) => parCle.get(c)));
      }
      return { cle: j.cle, libelle: j.libelle, special: j.special ?? null, etapes: j.etapes, etat, etatLibelle: ETATS_JALON[etat], detail };
    });
    return { cle: ph.cle, libelle: ph.libelle, jalons };
  });

  if (offre.code === "offre3" && !restitution) {
    const inv = lirePhases.find((p) => p.cle === "investissement");
    const commencee = inv.jalons.some((j) => ["en_cours", "bloque", "termine"].includes(j.etat));
    inv.nonCommencee = !commencee;
    if (commencee) alertes.push({ code: "restitution_non_enregistree", niveau: "warning",
      libelle: "La phase Investissement a commencé alors que la restitution n'est pas enregistrée." });
  }
  for (const p of lirePhases) {
    if (p.nonCommencee === undefined) p.nonCommencee = false;
    p.etatLibelle = p.nonCommencee ? "Pas encore commencée"
      : p.jalons.every((j) => ["termine", "sans_objet"].includes(j.etat)) ? "Terminée"
      : p.jalons.some((j) => j.etat !== "a_venir") ? "En cours" : "À venir";
  }
  if (offre.code === "offre3" && strategieFinie && !restitution) {
    alertes.push({ code: "restitution_a_faire", niveau: "info", libelle: "Stratégie terminée : rapport et restitution à enregistrer." });
  }
  return { offre, phases: lirePhases, alertes };
}

/** Honoraires de la mission : forfait (dû à la signature) et règle d'accompagnement. */
export function honorairesMission(dossier) {
  const brut = dossier?.honoraires_prevus_ht;
  const montant = brut === null || brut === undefined || brut === "" ? null : Number(brut);
  const statut = dossier?.lettre_mission_statut;
  const signee = jour(dossier?.lettre_mission_signee_le);
  let exigibilite, etat;
  if (statut === "signee" && signee) { etat = "du"; exigibilite = `Dû depuis la signature du ${dateFr(signee)}`; }
  else if (statut === "signee") { etat = "date_inconnue"; exigibilite = "Lettre signée, date de signature inconnue"; }
  else if (statut === "inconnu") { etat = "lettre_inconnue"; exigibilite = "Lettre de mission : statut inconnu"; }
  else if (statut === "non_applicable") { etat = "sans_lettre"; exigibilite = "Lettre de mission non applicable"; }
  else { etat = "lettre_non_signee"; exigibilite = `Dû à la signature (lettre ${(STATUTS_LETTRE_MISSION[statut] ?? "non renseignée").toLowerCase()})`; }
  return {
    forfait: { montant, renseigne: montant !== null, etat, exigibilite },
    accompagnement: { regle: REGLE_ACCOMPAGNEMENT, calcul: "Calculé pour chaque acquisition avec les Opérations (à venir)" },
  };
}

// ── Gestes : préparent la modification, refusent ce que la base refuserait ──

function exigerModifiable(dossier) {
  if (!dossier) throw new Error("Mission introuvable.");
  if (!enCours(dossier)) throw new Error("Mission close : consultation seule.");
}
function exigerDate(v, aujourdhui, quoi) {
  if (!estDate(v)) throw new Error(`Indiquez la date ${quoi}.`);
  if (aujourdhui && v > aujourdhui) throw new Error(`La date ${quoi} ne peut pas être dans le futur.`);
}

/** Offre vers laquelle la mission peut passer (null si aucune). */
export function offreCible(dossier) {
  if (!dossier || !enCours(dossier)) return null;
  if (dossier.type_mission === "accompagnement_acquisition") return "audit_patrimonial";
  if (estOffre3(dossier)) return "accompagnement_acquisition";
  return null;
}

export function patchOffre(dossier, vers) {
  exigerModifiable(dossier);
  if (!OFFRES[vers]) throw new Error("Offre inconnue.");
  if (vers === dossier.type_mission) throw new Error("La mission est déjà sur cette offre.");
  if (estOffre3(dossier) && (dossier.restitution_le || dossier.cadrage_statut)) {
    throw new Error("Retour en Offre 2 impossible : retirez d'abord la date de restitution et le cadrage.");
  }
  return { type_mission: vers };
}

export function patchRestitution(dossier, date, aujourdhui) {
  exigerModifiable(dossier);
  if (!estOffre3(dossier)) throw new Error("Le rapport et la restitution n'existent qu'en Offre 3.");
  if (date === null || date === "") {
    if (dossier.cadrage_statut) throw new Error("Retirez d'abord le cadrage, qui suit la restitution.");
    return { restitution_le: null };
  }
  exigerDate(date, aujourdhui, "de restitution");
  if (dossier.cadrage_le && date > jour(dossier.cadrage_le)) throw new Error("La restitution ne peut pas être postérieure au cadrage.");
  return { restitution_le: date };
}

export function patchCadrage(dossier, statut, date, aujourdhui) {
  exigerModifiable(dossier);
  if (!estOffre3(dossier)) throw new Error("Le cadrage n'existe qu'en Offre 3.");
  if (statut === null || statut === "") return { cadrage_statut: null, cadrage_le: null };
  if (!STATUTS_CADRAGE[statut]) throw new Error("État de cadrage inconnu.");
  if (!dossier.restitution_le) throw new Error("Le cadrage suit la restitution : enregistrez d'abord la restitution.");
  if (statut === "non_necessaire") return { cadrage_statut: statut, cadrage_le: null };
  exigerDate(date, aujourdhui, "du cadrage");
  if (date < jour(dossier.restitution_le)) throw new Error("Le cadrage ne peut pas précéder la restitution.");
  return { cadrage_statut: statut, cadrage_le: date };
}

/** Montant saisi (« 3 000 », « 1234,50 ») → nombre ; vide → null (non renseigné). */
export function lireMontant(saisie) {
  const t = String(saisie ?? "").replace(/[\s  €]/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error("Montant invalide (exemple : 3 000 ou 2 500,50).");
  return Number(t);
}

export function patchForfait(dossier, saisie) {
  exigerModifiable(dossier);
  return { honoraires_prevus_ht: lireMontant(saisie) };
}

export function patchLettre(dossier, statut, date, aujourdhui) {
  exigerModifiable(dossier);
  if (!STATUTS_LETTRE_MISSION[statut] || statut === "inconnu") throw new Error("Statut de lettre de mission inconnu.");
  if (statut !== "signee") return { lettre_mission_statut: statut, lettre_mission_signee_le: null };
  exigerDate(date, aujourdhui, "de signature");
  return { lettre_mission_statut: statut, lettre_mission_signee_le: date };
}
