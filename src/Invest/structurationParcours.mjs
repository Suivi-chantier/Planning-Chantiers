// src/Invest/structurationParcours.mjs — Le parcours d'une mission de structuration patrimoniale,
// dans l'ordre où les conseillers en gestion de patrimoine la conduisent.
//
// Module pur (aucune base, aucune horloge) : les données du dossier arrivent en paramètre.
//
// Les sept étapes reprennent la démarche de conseil patrimonial usuelle (entrée en relation et
// conformité, recueil, diagnostic, étude de stratégies, préconisation et restitution, mise en
// œuvre, suivi). Voir docs/project/STRUCTURATION-METHODE.md pour les sources et les choix.
//
// Une étape n'est « faite » que si TOUS ses points le sont. Un point dont la donnée manque est
// « à faire », jamais « fait par défaut ».

import { avancementCollecte, documentsPertinents, estPertinent } from "./structurationCollecte.mjs";
import { operationComplete } from "./structurationProjection.mjs";

const plein = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const nb = (arr) => (Array.isArray(arr) ? arr : []);

export const ETAPES_STRUCTURATION = Object.freeze([
  { cle: "cadrage", numero: 1, libelle: "Cadrage & conformité", onglet: "cadrage", aide: "Entrée en relation : document remis au client, lettre de mission signée, vérification d'identité et origine des fonds." },
  { cle: "collecte", numero: 2, libelle: "Recueil", onglet: "collecte", aide: "Situation familiale, revenus, patrimoine, dettes, objectifs et pièces justificatives." },
  { cle: "diagnostic", numero: 3, libelle: "Diagnostic", onglet: "analyse", aide: "Bilan patrimonial : performance, endettement, fiscalité, détention, transmission, risques." },
  { cle: "strategies", numero: 4, libelle: "Stratégies comparées", onglet: "analyse", aide: "Au moins deux scénarios chiffrés et comparés (conserver, arbitrer, structurer en société…)." },
  { cle: "preconisation", numero: 5, libelle: "Préconisation & restitution", onglet: "analyse", aide: "Préconisations argumentées, rapport remis au client, rendez-vous de restitution." },
  { cle: "mise_en_oeuvre", numero: 6, libelle: "Mise en œuvre", onglet: "mise_en_oeuvre", aide: "Coordination des intervenants (notaire, expert-comptable, banque) et suivi des actes." },
  { cle: "suivi", numero: 7, libelle: "Suivi", onglet: "mise_en_oeuvre", aide: "Revue périodique du patrimoine et adaptation aux évolutions du client." },
]);

export const INTERVENANTS_TYPES = Object.freeze(["Notaire", "Expert-comptable", "Banque / courtier", "Avocat fiscaliste", "Autre"]);
export const STATUTS_INTERVENANT = Object.freeze(["À contacter", "Contacté", "Mandaté", "Terminé"]);
export const STATUTS_ACTION = Object.freeze(["À faire", "En cours", "Fait"]);
export const STATUTS_LETTRE = Object.freeze(["À envoyer", "Envoyée", "Signée"]);

export function conformiteVide() {
  return { der_remis_le: "", lettre_statut: "À envoyer", lettre_signee_le: "", identite_verifiee: false, origine_fonds_verifiee: false, remuneration_expliquee: false, adequation_remise_le: "" };
}
export function miseEnOeuvreVide() {
  return { intervenants: [], actions: [], rapport_remis_le: "", prochaine_revue_le: "" };
}

function docsRequisRecus(data) {
  const pertinents = documentsPertinents(data);
  const requis = nb(data?.collecte?.documents).filter((d) => d.required && d.statut !== "Non applicable" && estPertinent(pertinents, d));
  const recus = requis.filter((d) => d.statut === "Reçu" || d.statut === "Validé");
  return { requis: requis.length, recus: recus.length };
}

/**
 * Calcule le parcours : pour chaque étape, ses points (fait ou non, avec l'onglet où le traiter),
 * son état (a_faire | en_cours | fait) et la prochaine chose à faire.
 */
export function calculerParcours(data) {
  const c = data?.collecte || {};
  const a = data?.analyse || {};
  const conf = { ...conformiteVide(), ...(data?.conformite || {}) };
  const moe = { ...miseEnOeuvreVide(), ...(data?.mise_en_oeuvre || {}) };
  const p = c.profil || {};
  const docs = docsRequisRecus(data);
  const socle = avancementCollecte(data);
  const analyses = ["analyse_performance", "analyse_bancaire", "analyse_fiscale", "analyse_structure", "analyse_transmission", "analyse_risques"].filter((k) => plein(a[k])).length;
  const scenariosTraites = nb(a.scenarios).filter((s) => s.statut && s.statut !== "À étudier").length;
  const recos = nb(a.preconisations).filter((r) => plein(r.titre) && plein(r.action));
  const actions = nb(moe.actions);
  const actionsFaites = actions.filter((x) => x.statut === "Fait").length;

  const pt = (libelle, ok, onglet, detail = null) => ({ libelle, ok: !!ok, onglet, detail });
  const points = {
    cadrage: [
      pt("Document d'entrée en relation remis au client", plein(conf.der_remis_le), "cadrage"),
      pt("Lettre de mission signée", conf.lettre_statut === "Signée" && plein(conf.lettre_signee_le), "cadrage"),
      pt("Consentement RGPD obtenu", plein(c.qualification?.consentement_rgpd) && c.qualification.consentement_rgpd !== "À obtenir", "cadrage"),
      pt("Identité vérifiée", conf.identite_verifiee, "cadrage"),
      pt("Origine des fonds vérifiée", conf.origine_fonds_verifiee, "cadrage"),
      pt("Rémunération expliquée au client", conf.remuneration_expliquee, "cadrage"),
    ],
    // Le socle de quatorze questions (voir structurationCollecte.mjs) puis les pièces obligatoires du client.
    collecte: [
      ...socle.questions.map((q) => pt(q.libelle, q.ok, "collecte")),
      pt("Pièces obligatoires reçues", docs.requis > 0 && docs.recus === docs.requis, "documents", docs.requis ? `${docs.recus} / ${docs.requis}` : null),
    ],
    diagnostic: [
      pt("Analyses rédigées (performance, bancaire, fiscale, structure, transmission, risques)", analyses >= 4, "analyse", `${analyses} / 6`),
      pt("Diagnostic de synthèse", plein(a.diagnostic), "analyse"),
    ],
    strategies: [
      pt("Au moins deux scénarios étudiés", scenariosTraites >= 2, "analyse", `${scenariosTraites} étudié(s)`),
      pt("Stratégie recommandée", plein(a.strategie_recommandee), "analyse"),
      pt("Au moins un scénario chiffré (opérations, projection, tests de résistance)", nb(data?.scenarios_chiffres).some((s) => nb(s.operations).some(operationComplete)), "analyse"),
    ],
    preconisation: [
      // Les trois préconisations modèles d'un nouveau dossier portent déjà une action : sans stratégie
      // recommandée rédigée, elles ne comptent pas.
      pt("Préconisations avec action associée", recos.length >= 1 && plein(a.strategie_recommandee), "analyse", `${recos.length}`),
      pt("Scénario retenu désigné", plein(data?.scenario_retenu_id) && nb(data?.scenarios_chiffres).some((x) => x.id === data.scenario_retenu_id), "mise_en_oeuvre"),
      pt("Rapport remis au client", plein(moe.rapport_remis_le), "mise_en_oeuvre"),
      pt("Déclaration d'adéquation remise", plein(conf.adequation_remise_le), "cadrage"),
      pt("Rendez-vous de restitution tenu", plein(c.rdv?.date_r2), "audit"),
    ],
    mise_en_oeuvre: [
      pt("Intervenants identifiés", nb(moe.intervenants).length >= 1, "mise_en_oeuvre"),
      pt("Actions de mise en œuvre planifiées", actions.length >= 1, "mise_en_oeuvre"),
      pt("Toutes les actions réalisées", actions.length >= 1 && actionsFaites === actions.length, "mise_en_oeuvre", actions.length ? `${actionsFaites} / ${actions.length}` : null),
    ],
    suivi: [
      pt("Prochaine revue patrimoniale fixée", plein(moe.prochaine_revue_le), "mise_en_oeuvre"),
    ],
  };

  const etapes = ETAPES_STRUCTURATION.map((e) => {
    const liste = points[e.cle];
    const faits = liste.filter((x) => x.ok).length;
    const etat = faits === liste.length ? "fait" : faits === 0 ? "a_faire" : "en_cours";
    return { ...e, points: liste, faits, total: liste.length, etat };
  });
  const courante = etapes.find((e) => e.etat !== "fait") || null;
  const prochainPoint = courante ? courante.points.find((x) => !x.ok) : null;
  const totalPoints = etapes.reduce((s, e) => s + e.total, 0);
  const pointsFaits = etapes.reduce((s, e) => s + e.faits, 0);
  return { etapes, courante, prochainPoint, pourcentage: Math.round((pointsFaits / totalPoints) * 100) };
}
