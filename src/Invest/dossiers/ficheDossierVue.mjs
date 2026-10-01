// src/Invest/dossiers/ficheDossierVue.mjs — Fiche Dossier Invest V1 (Chantier 1.2).
//
// Construit ce qu'affiche la fiche : en-tête, pilotage, « À faire maintenant »,
// parcours des 11 étapes, synthèses Projet (2d) et Situation patrimoniale (2c),
// alertes utiles, activité récente, tâches.
//
// AUCUNE règle nouvelle : tout vient des moteurs existants —
//   pilotage.mjs (étapes actives, étape à agir, balle, échéances, alertes),
//   dossierVue.mjs (choix du dossier, ruban, journal, en-tête),
//   situationPatrimoniale.mjs (calculs 2c), questionnaireDossier.mjs (2d),
//   offres.mjs (phases et jalons Offre 2 / Offre 3, honoraires — chantier 9).
// Module PUR : données en paramètre, date du jour en paramètre.

import { ETAPES_PARCOURS, STATUTS_DOSSIER_NON_CLOS } from "./parcours.mjs";
import { choisirDossier, listeDossiers, ruban, journal, entete, libelleBalle } from "./dossierVue.mjs";
import { pilotageDossier, alertesPilotage, actionDuJour, resumePilotage } from "./pilotage.mjs";
import { calculerSituation, SECTIONS as SECTIONS_2C } from "./situationPatrimoniale.mjs";
import { syntheseObjectifs, progression, STATUTS_QUESTIONNAIRE } from "./questionnaireDossier.mjs";
import { parcoursOffre, honorairesMission, offreCible, offreDe } from "./offres.mjs";

/** Navigation de la fiche. `etapes` : étapes du parcours auxquelles l'onglet se rattache. */
export const ONGLETS_FICHE = Object.freeze([
  { cle: "ensemble", libelle: "Vue d'ensemble" },
  { cle: "projet", libelle: "Projet", etapes: ["collecte"] },
  { cle: "situation", libelle: "Situation patrimoniale", etapes: ["collecte"] },
  { cle: "documents", libelle: "Documents", etapes: ["documents"], enPreparation: true },
  { cle: "analyse", libelle: "Analyse", etapes: ["analyse"], enPreparation: true },
  { cle: "strategie", libelle: "Stratégie", etapes: ["strategie"], enPreparation: true },
  { cle: "opportunites", libelle: "Opportunités", etapes: ["recherche", "opportunites"] },
  { cle: "financement", libelle: "Financement", etapes: ["financement"], enPreparation: true },
  { cle: "acquisition", libelle: "Acquisition", etapes: ["structuration", "acquisition", "suivi"], enPreparation: true },
]);

const TACHE_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);
const jour = (v) => (v ? String(v).slice(0, 10) : null);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const libelleEtape = (cle) => ETAPES_PARCOURS.find((e) => e.cle === cle)?.libelle ?? null;
const nomClient = (c) => [c?.prenom, c?.nom].filter(Boolean).join(" ").trim() || c?.nom || "Client";
const actifs = (rows = []) => rows.filter((r) => r && !r.archive_le);

/** Tâches du dossier : en retard, à faire, terminées (avec étape, responsable, échéance). */
export function tachesFiche(taches = [], dossierId, aujourdhui) {
  const du = taches.filter((t) => t.dossier_id === dossierId);
  const vue = (t) => ({ id: t.id, titre: t.action_title || "Tâche", etape: libelleEtape(t.etape) ?? "À classer",
    responsable: t.responsable || null, echeance: jour(t.due_date), statut: t.status,
    // Portail client : seul `true` montre la tâche au client (absent / null = non).
    visibleClient: t.visible_client === true });
  const ouvertes = du.filter((t) => TACHE_OUVERTE.has(t.status));
  const retard = ouvertes.filter((t) => jour(t.due_date) && jour(t.due_date) < aujourdhui);
  const parDate = (a, b) => String(a.echeance || "9999").localeCompare(String(b.echeance || "9999"));
  return {
    enRetard: retard.map(vue).sort(parDate),
    aFaire: ouvertes.filter((t) => !retard.includes(t)).map(vue).sort(parDate),
    terminees: du.filter((t) => t.status === "fait").map(vue).sort((a, b) => String(b.echeance || "").localeCompare(String(a.echeance || ""))),
  };
}

/** Alertes utiles : celles du moteur de pilotage + éléments à corriger (2c) et à revérifier (2d). */
export function alertesFiche({ pilotage = null, collecte = {}, questionnaire = null, offre = null }) {
  const utiles = /^(echeance_depassee_|echeance_jour_|bloquee_|tache_retard_|sans_prochaine_action|aucune_etape_active)/;
  const out = alertesPilotage(pilotage).filter((a) => utiles.test(a.code))
    .map((a) => ({ code: a.code, libelle: a.label, niveau: a.level, echeance: a.due_date || null, onglet: "ensemble" }));
  for (const a of offre?.alertes || []) out.push({ ...a, onglet: "ensemble" });
  const aCorriger2c = SECTIONS_2C.reduce((n, s) => n + actifs(collecte[s.table]).filter((r) => r.verification_statut === "a_corriger").length, 0);
  if (aCorriger2c) out.push({ code: "situation_a_corriger", libelle: `Situation patrimoniale : ${aCorriger2c} élément${aCorriger2c > 1 ? "s" : ""} à corriger`, niveau: "warning", onglet: "situation" });
  if (questionnaire) {
    const p = progression(questionnaire.data || {});
    if (p.aCorriger) out.push({ code: "projet_a_corriger", libelle: `Projet : ${p.aCorriger} réponse${p.aCorriger > 1 ? "s" : ""} à corriger`, niveau: "warning", onglet: "projet" });
    if (questionnaire.statut === "a_verifier") out.push({ code: "projet_a_verifier", libelle: "Projet : modifié après validation, à revérifier", niveau: "warning", onglet: "projet" });
  }
  const rang = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => (rang[a.niveau] ?? 3) - (rang[b.niveau] ?? 3));
}

/**
 * Modèle complet de la fiche.
 * @param donnees { client, dossiers, idChoisi, etapes, evenements, taches, utilisateurs,
 *                  collecte: { invest_personnes, invest_postes_financiers, invest_engagements,
 *                              invest_actifs_patrimoniaux, invest_structures }, aujourdhui }
 */
export function construireFiche({ client, dossiers = [], idChoisi = null, etapes = [], evenements = [], taches = [],
  utilisateurs = [], collecte = {}, aujourdhui }) {
  const dossier = choisirDossier(dossiers, idChoisi);
  const dossierEnCours = choisirDossier(dossiers.filter((d) => STATUTS_DOSSIER_NON_CLOS.includes(d.statut)));
  const base = { client: { nom: nomClient(client), statut: client?.statut ?? null }, dossier, dossierEnCours,
    dossiers: listeDossiers(dossiers, dossier) };
  if (!dossier) return { ...base, vide: true };

  const siennes = etapes.filter((e) => e.dossier_id === dossier.id);
  const ent = entete(dossier, utilisateurs);
  const p = pilotageDossier({ dossier, etapes: siennes, taches, utilisateurs, aujourdhui });
  const ajd = actionDuJour(p);
  const etapeAgir = ajd.etape;
  const questionnaire = { data: dossier.questionnaire_data || {}, statut: dossier.questionnaire_statut || "brouillon" };
  const prog = progression(questionnaire.data);
  const t = tachesFiche(taches, dossier.id, aujourdhui);
  const parcours = ruban(siennes, utilisateurs);
  const offre = parcoursOffre(dossier, parcours);

  return {
    ...base,
    vide: false,
    modifiable: !ent.clos,
    entete: { ...ent, dateOuverture: jour(dossier.date_ouverture), offre: offreDe(dossier.type_mission) },
    offre,
    offreCible: offreCible(dossier),
    honoraires: honorairesMission(dossier),
    pilotage: p ? {
      principale: p.principale ? { cle: p.principale.etape, libelle: p.principale.libelle, statut: p.principale.statutLibelle, balle: p.principale.balle.libelle, balleType: p.principale.balle.type } : null,
      actives: p.actives.map((a) => ({ cle: a.etape, libelle: a.libelle, statut: a.statutLibelle, balle: a.balle.libelle, balleType: a.balle.type })),
      resume: resumePilotage(p),
      blocages: p.actives.filter((a) => a.blocage).map((a) => ({ etape: a.libelle, motif: a.blocage.motif, depuis: a.blocage.depuis })),
    } : null,
    aFaire: p ? {
      action: ajd.action,
      responsable: ajd.responsable,
      etape: etapeAgir?.libelle ?? null,
      balle: etapeAgir?.balle.libelle ?? null,
      balleType: etapeAgir?.balle.type ?? null,
      echeance: ajd.echeance,
      retardJours: ajd.echeance && ajd.echeance < aujourdhui ? joursEntre(ajd.echeance, aujourdhui) : 0,
      blocage: etapeAgir?.blocage ? etapeAgir.blocage.motif : null,
    } : null,
    parcours,
    projet: { ...syntheseObjectifs(questionnaire.data), statut: questionnaire.statut, statutLibelle: STATUTS_QUESTIONNAIRE[questionnaire.statut],
      pourcentage: prog.pourcentage, repondues: prog.repondues, visibles: prog.visibles, aCorriger: prog.aCorriger },
    situation: {
      ...calculerSituation({ postes: collecte.invest_postes_financiers, engagements: collecte.invest_engagements, actifsImmo: collecte.invest_actifs_patrimoniaux }),
      lignes: Object.fromEntries(SECTIONS_2C.map((s) => [s.cle, actifs(collecte[s.table]).length])),
    },
    alertes: alertesFiche({ pilotage: p, collecte, questionnaire, offre }),
    activite: journal(evenements.filter((e) => e.dossier_id === undefined || e.dossier_id === dossier.id)).slice(0, 8),
    taches: t,
    etapesParCle: Object.fromEntries(siennes.map((e) => [e.etape, { ...e, balleLibelle: libelleBalle(e, utilisateurs) }])),
  };
}
