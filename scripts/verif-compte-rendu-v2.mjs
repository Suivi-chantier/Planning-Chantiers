#!/usr/bin/env node
// Vérifie la bêta « Nouveau compte rendu » (cr_v2, étape 2) — données FICTIVES
// écrites ici (chantiers A et B, tâches t1…t8, ouvrier « Paul »), aucune donnée
// de production. Tout passe par le VRAI code de l'application :
//   src/Renovation/compteRenduEnvoi.mjs  (socle d'envoi commun aux deux formulaires)
//   src/Renovation/compteRenduV2.mjs     (règles du formulaire v2)
//   src/Renovation/lignesValidation.mjs  (lignes de la Validation)
//   src/pointagesRapport.mjs             (pointages, validation + outil Admin)
//   src/Renovation/motifsCompteRendu.mjs (motifs)
//
// Contrôles :
//   1. NON-RÉGRESSION : l'ancien formulaire écrit exactement les mêmes rapports
//      qu'avant l'extraction (comparaison avec une copie FIGÉE de l'ancien code
//      de RapportMobile.soumettre) ; la Validation lit les lignes comme avant.
//   2. ÉQUIVALENCE : une même journée saisie en v1 et en v2 donne les mêmes
//      pointages (rapport → lignes de validation → buildPointagesRapport).
//   3. CAS LIMITES : plusieurs chantiers, rattrapage, bloquée à 0 h, bloquée
//      après 2 h, dépassement sur une tâche hors devis, brouillon v2 relu par
//      l'ancien formulaire (case décochée en cours de journée).
//   4. QUART D'HEURE (A) : quels que soient les trajets, la cible est toujours
//      atteignable (bouton « Mettre les X min restantes ici »).
//   5. VALIDATION (B) : le relevé de dépassement disparaît dès que la ligne est
//      réaffectée, découpée ou corrigée ; le motif de l'ouvrier reste.
//   6. MESURE (C) : heures_prevues est gardé sur chaque ligne v2.
//   7. « J'AI FAIT AUTRE CHOSE » (étape 3a) : une tâche choisie dans le phasage
//      donne les mêmes pointages qu'une tâche planifiée ; pas de doublon ;
//      retrait ; 2e chantier ; hors devis ; terminée ; repli texte libre ;
//      brouillon repris et relu par l'ancien formulaire ; recherche.
//
//   node scripts/verif-compte-rendu-v2.mjs
import assert from "node:assert/strict";
import {
  construireRapports, serialiserLigneV1, totalJournee, filtrerTachesRemplies, aReprendreIntacte,
  filtrerIndirectesInvalides,
} from "../src/Renovation/compteRenduEnvoi.mjs";
import {
  appliquerChoix, changerMinutes, minutesDe, serialiserLigneV2, finaliserLignesV2, etatEnvoi,
  problemesLigne, motifDepassementRequis, resteJournee, ajustementPossible, poserReste,
  brouillonV2VersV1, preremplirDurees, colonnesRapportV2, choixDeLigne, fmtMinutes, PAS_MINUTES,
  ligneDepuisPhasage, ajouterDepuisPhasage, tacheDejaDansJournee, carteRetirable, ORIGINE_PHASAGE, ORIGINE_LIBRE,
} from "../src/Renovation/compteRenduV2.mjs";
import { construireMesPhases, rechercherDansPhases } from "../src/Renovation/mesPhasesV1.mjs";
import {
  lignesDepuisRapport, taskLinesPourPointages, depassementAffichable, decouperLigne, ligneBasculee,
} from "../src/Renovation/lignesValidation.mjs";
import { buildPointagesRapport, heuresDeclareesRapport, rangRapportDuJour } from "../src/pointagesRapport.mjs";
import {
  MOTIFS_STATUT, MOTIFS_DEPASSEMENT, explicationLigne, libelleMotifStatut, libelleStatutChoisi,
} from "../src/Renovation/motifsCompteRendu.mjs";

let nbOk = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };
const ok = (c, msg) => { assert.ok(c, msg); nbOk++; };
const proche = (a, b, msg, tol = 1e-9) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (obtenu ${a}, attendu ${b})`); nbOk++; };

// ─────────────────────────────────────────────────────────────────────────────
// COPIES FIGÉES de l'ancien code (RapportMobile.jsx et Validation.jsx au
// 06/10/2026, avant extraction). NE PAS MODIFIER : elles servent de référence.
// ─────────────────────────────────────────────────────────────────────────────
const ANCIEN_aReprendreIntacte = (t) => t.aReprendre && !t.statut
  && !String(t.heures_reelles ?? "").trim() && !t.remarque?.trim()
  && (t.avancement === undefined || t.avancement === null || t.avancement === "");
function ANCIEN_envoi({ taches, heuresIndirectes, planData, ouvrier, dateKey, weekId, remarque, photosChantier, trajetMatin, trajetSoir }) {
  const tachesRemplies = taches.filter(t => t.planifie.trim() && !ANCIEN_aReprendreIntacte(t));
  const indirectesRemplies = (heuresIndirectes || []).filter(h =>
    (h.motif || "").trim() && (parseFloat(h.heures) || 0) > 0
  );
  const totalTachesHSubmit  = tachesRemplies.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const totalIndirectesH    = indirectesRemplies.reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);
  const trajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
  const totalSubmit = totalTachesHSubmit + trajetMin / 60 + totalIndirectesH;
  const parChantier = {};
  tachesRemplies.forEach(t => {
    const k = t.chantier_id || "divers";
    if (!parChantier[k]) parChantier[k] = { chantier_id:t.chantier_id, chantier_nom:t.chantier_nom||"Divers", taches:[], heures_indirectes:[] };
    parChantier[k].taches.push({
      planifie:t.planifie,
      tache_id: t.tache_id || null,
      phase_id: t.phase_id || null,
      statut:t.statut||"non_faite",
      remarque:t.remarque,
      heures_reelles:parseFloat(t.heures_reelles)||0,
      avancement:parseInt(t.avancement)||0,
      photos: t.photos || [],
    });
  });
  indirectesRemplies.forEach(h => {
    const k = h.chantier_id || "divers";
    if (!parChantier[k]) {
      const ch = planData?.chantiersData?.find(c => c.id === h.chantier_id);
      parChantier[k] = { chantier_id: h.chantier_id, chantier_nom: ch?.nom || h.chantier_id || "Divers", taches: [], heures_indirectes: [] };
    }
    parChantier[k].heures_indirectes.push({
      motif: (h.motif || "").trim(),
      heures: parseFloat(h.heures) || 0,
    });
  });
  const rapports = Object.keys(parChantier).map(k => {
    const grp = parChantier[k];
    const photosCh = photosChantier[grp.chantier_id] || [];
    return {
      ouvrier: ouvrier.trim(),
      chantier_id: grp.chantier_id,
      chantier_nom: grp.chantier_nom,
      date_rapport: dateKey,
      semaine: weekId,
      taches: grp.taches,
      heures_indirectes: grp.heures_indirectes || [],
      remarque,
      photos_chantier: photosCh,
      trajet_matin_min: parseInt(trajetMatin) || 0,
      trajet_soir_min: parseInt(trajetSoir) || 0,
    };
  });
  return { rapports, totalSubmit };
}
const ANCIEN_initValidation = (rapport) => (rapport.taches || []).map((t, i) => ({
  rowId: `o${i}`, origineIdx: i, _origine: true,
  tache_id: t.tache_id || null, phase_id: t.phase_id || null, planifie: t.planifie || "",
  heures: parseFloat(t.heures_reelles) || 0, heures_origine: parseFloat(t.heures_reelles) || 0,
  statut: t.statut || null,
  avancement_declare: t.avancement != null ? parseInt(t.avancement) : null,
  avancement_arbitre: t.avancement != null ? parseInt(t.avancement) : "",
  remarque: t.remarque || "", photos: t.photos || [],
  bascules: Array.isArray(t.bascules) ? t.bascules : [], bascule_depuis: t.bascule_depuis || null,
  _autoMatched: false,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Données fictives
// ─────────────────────────────────────────────────────────────────────────────
const CH_A = { chantier_id: "chA", chantier_nom: "Chantier A", chantier_couleur: "#f00" };
const CH_B = { chantier_id: "chB", chantier_nom: "Chantier B", chantier_couleur: "#0f0" };
const planData = { chantiersData: [{ id: "chA", nom: "Chantier A" }, { id: "chB", nom: "Chantier B" }, { id: "chC", nom: "Chantier C" }] };
const base = { ouvrier: " Paul ", dateKey: "06/10/2026", weekId: "2026-W41", remarque: "RAS", photosChantier: { chA: ["p1.jpg"] } };

// ── 1. NON-RÉGRESSION de l'ancien formulaire ─────────────────────────────────
const journeesV1 = [
  { // plusieurs chantiers, indirectes sur un 3e chantier, tâche libre, À reprendre intacte
    taches: [
      { ...CH_A, planifie: "Pose ossature", tache_id: "t1", statut: "faite", heures_reelles: "3", avancement: "100", remarque: "", photos: ["a.jpg"] },
      { ...CH_A, planifie: "Plaques", tache_id: "t2", phase_id: "ph1", statut: "en_cours", heures_reelles: "2.5", avancement: "50", remarque: " reste un pan " },
      { ...CH_B, planifie: "Bandes", tache_id: "t3", statut: "non_faite", heures_reelles: "", avancement: "0", remarque: "Pas de plâtre" },
      { ...CH_B, planifie: "Retouche", tache_id: null, statut: "faite", heures_reelles: "1", avancement: "", remarque: "" , libre: true },
      { ...CH_A, planifie: "Ancienne tâche", tache_id: "t9", aReprendre: true, statut: null, heures_reelles: "", remarque: "", avancement: "" },
      { chantier_id: "", chantier_nom: "", planifie: "  ", statut: null, remarque: "" },
    ],
    heuresIndirectes: [{ motif: " Intempéries ", heures: "1", chantier_id: "chC" }, { motif: "", heures: "", chantier_id: "chA" }],
    trajetMatin: "30", trajetSoir: "", },
  { // un seul chantier, avancement non renseigné, photos absentes
    taches: [{ ...CH_A, planifie: "Pose", tache_id: "t5", statut: "en_cours", heures_reelles: 8.5, avancement: undefined, remarque: "x" }],
    heuresIndirectes: [], trajetMatin: 15, trajetSoir: "15" },
];
for (const j of journeesV1) {
  const ancien = ANCIEN_envoi({ ...base, ...j, planData });
  const nouveau = construireRapports({ ...base, ...j, planData, serialiser: serialiserLigneV1, extra: {} });
  eq(nouveau, ancien.rapports, "ancien formulaire : mêmes rapports qu'avant l'extraction (champ par champ)");
  proche(totalJournee(j).totalH, ancien.totalSubmit, "total contrôlé à l'envoi identique");
  for (const r of ancien.rapports) {
    const lignesNouv = lignesDepuisRapport(r).map(({ bloque, motif, motif_depassement, heures_prevues, depassement, origine, ...rest }) => rest);
    eq(lignesNouv, ANCIEN_initValidation(r), "Validation : lignes d'un rapport de l'ancien formulaire inchangées");
    ok(lignesDepuisRapport(r).every(l => l.bloque === false && l.motif === null), "ligne v1 : ni Bloqué ni motif");
  }
  ok(ancien.rapports.every(r => !("formulaire_version" in r) && !("saisie_debut_le" in r)), "ancien formulaire : aucune colonne v2 envoyée");
}
// Correction du compteur (point e) : le compteur affiché = total contrôlé à l'envoi, heures indirectes comprises.
proche(totalJournee(journeesV1[0]).totalH, 3 + 2.5 + 1 + 0.5 + 1, "compteur : tâches + trajet + heures indirectes");
eq(filtrerIndirectesInvalides([{ motif: "x", heures: "", chantier_id: "a" }]).length, 1, "heure indirecte incomplète refusée");

// ── 2. ÉQUIVALENCE v1 / v2 : mêmes pointages ────────────────────────────────
const INFOS = {
  t1: { heures_vendues: 14, heures_validees: 10, heures_en_attente: 0, avancement: 60, hors_devis: false },
  t2: { heures_vendues: 16, heures_validees: 2, heures_en_attente: 0, avancement: 40, hors_devis: false },
  t3: { heures_vendues: 6, heures_validees: 0, heures_en_attente: 0, avancement: 40, hors_devis: false },
  t4: { heures_vendues: 8, heures_validees: 7, heures_en_attente: 0.5, avancement: 70, hors_devis: false, dernier_motif_depassement: { code: "imprevu", date: "2026-10-03" } },
  t6: { heures_vendues: 0, heures_validees: 5, heures_en_attente: 0, avancement: 0, hors_devis: true },
};
// Journée chargée depuis le planning (v2 : durée prévue préremplie).
const planning = () => preremplirDurees([
  { ...CH_A, planifie: "Pose ossature", tache_id: "t1", statut: null, remarque: "", heures_prevues: 3 },
  { ...CH_A, planifie: "Plaques", tache_id: "t2", statut: null, remarque: "", heures_prevues: 2 },
  { ...CH_B, planifie: "Bandes", tache_id: "t3", statut: null, remarque: "" },
  { ...CH_B, planifie: "Saignées", tache_id: "t4", statut: null, remarque: "", heures_prevues: 2 },
  { ...CH_B, planifie: "Divers", tache_id: "t6", statut: null, remarque: "" },
]);
const maj = (arr, i, f) => arr.map((x, k) => (k === i ? f(x) : x));
let v2 = planning();
eq(v2.map(t => t.heures_reelles), [String(3), String(2), undefined, String(2), undefined], "durée prévue préremplie quand elle existe");
v2 = maj(v2, 0, t => appliquerChoix(t, "termine", { avancementActuel: 60 }));                     // Terminé 3 h
v2 = maj(v2, 1, t => ({ ...appliquerChoix(t, "en_cours", { avancementActuel: 40 }), avancement: "50" })); // En cours 2 h, 50 %
v2 = maj(v2, 2, t => ({ ...appliquerChoix(t, "pas_commence", { avancementActuel: 40 }), motif: "attente_materiel" })); // Pas commencé
v2 = maj(v2, 3, t => ({ ...appliquerChoix(t, "bloque", { avancementActuel: 70 }), motif: "acces_impossible" })); // Bloqué après 2 h
v2 = maj(v2, 4, t => changerMinutes(appliquerChoix(t, "en_cours", {}), 60));                      // hors devis : 1 h…
v2 = maj(v2, 4, t => ({ ...t, avancement: "25" }));
// Même journée dans l'ancien formulaire (ce que l'ouvrier y aurait saisi).
const v1 = [
  { ...CH_A, planifie: "Pose ossature", tache_id: "t1", statut: "faite", heures_reelles: "3", avancement: "100", remarque: "" },
  { ...CH_A, planifie: "Plaques", tache_id: "t2", statut: "en_cours", heures_reelles: "2", avancement: "50", remarque: "en cours" },
  { ...CH_B, planifie: "Bandes", tache_id: "t3", statut: "non_faite", heures_reelles: "", avancement: "0", remarque: "Attente de matériel" },
  { ...CH_B, planifie: "Saignées", tache_id: "t4", statut: "en_cours", heures_reelles: "2", avancement: "70", remarque: "Accès impossible" },
  { ...CH_B, planifie: "Divers", tache_id: "t6", statut: "en_cours", heures_reelles: "1", avancement: "25", remarque: "x" },
];
const jour = { trajetMatin: "40", trajetSoir: "20", heuresIndirectes: [{ motif: "Nettoyage", heures: "1", chantier_id: "chA" }], cibleHeures: 10 };
// Dépassement : t4 a 7 + 0,5 h avant + 2 h aujourd'hui > 8 h vendues → motif requis, repris du dernier.
ok(motifDepassementRequis(INFOS.t4, v2[3]), "t4 : 9,5 h sur 8 h vendues → motif de dépassement demandé");
eq(problemesLigne(v2[3], INFOS), ["motif_depassement"], "t4 : seul le motif de dépassement manque");
v2 = maj(v2, 3, t => ({ ...t, motif_depassement: INFOS.t4.dernier_motif_depassement.code, motif_depassement_repris: true }));
ok(!motifDepassementRequis(INFOS.t6, v2[4]), "hors devis : aucun motif de dépassement, même avec des heures");
eq(problemesLigne(v2[4], INFOS), [], "hors devis : ligne complète sans motif");
const e2 = etatEnvoi({ taches: v2, ...jour, infosParTache: INFOS });
eq([e2.resteMin, e2.peutEnvoyer], [0, true], "journée v2 complète et exacte : envoi possible");

const fin2 = finaliserLignesV2(v2, INFOS);
const rapportsV2 = construireRapports({ ...base, ...jour, taches: fin2, planData, serialiser: serialiserLigneV2, extra: colonnesRapportV2("2026-10-06T16:02:00.000Z") });
const rapportsV1 = construireRapports({ ...base, ...jour, taches: v1, planData, serialiser: serialiserLigneV1, extra: {} });

function pointagesJournee(rapports) {
  const avecId = rapports.map((r, i) => ({ ...r, id: `r${i}` }));
  return avecId.flatMap(r => buildPointagesRapport({
    chantier_id: r.chantier_id, ouvrier: r.ouvrier, dateISO: "2026-10-06", taux: 30, rapport_id: "X",
    taskLines: taskLinesPourPointages(lignesDepuisRapport(r)),
    indirectLines: r.heures_indirectes,
    trajetMinTotal: r.trajet_matin_min + r.trajet_soir_min,
    nbChantiersDuJour: avecId.length,
    rangRapport: rangRapportDuJour(r, avecId),
    heuresParRapportDuJour: [...avecId].sort((a, b) => a.id.localeCompare(b.id)).map(heuresDeclareesRapport),
  }));
}
eq(pointagesJournee(rapportsV2), pointagesJournee(rapportsV1), "ÉQUIVALENCE : mêmes pointages en v1 et en v2 (2 chantiers, trajet réparti)");
ok(pointagesJournee(rapportsV2).length === 7, "4 tâches avec heures + 1 indirecte + 2 quotes-parts de trajet");
const sommeP = pointagesJournee(rapportsV2).reduce((s, p) => s + p.heures, 0);
proche(sommeP, 10, "pointages = 10 h exactement", 0.01);

// Ce qui diffère (voulu) : Pas commencé garde l'avancement du phasage.
const lV2 = rapportsV2.flatMap(lignesDepuisRapport), lV1 = rapportsV1.flatMap(lignesDepuisRapport);
eq([lV2.find(l => l.tache_id === "t3").avancement_arbitre, lV1.find(l => l.tache_id === "t3").avancement_arbitre], [40, 0],
  "Pas commencé : la Validation propose 40 % (inchangé) au lieu de 0 % — aucun pointage dans les deux cas");
// Format des lignes v2
const ligneT4 = rapportsV2.flatMap(r => r.taches).find(l => l.tache_id === "t4");
eq([ligneT4.statut, ligneT4.bloque, ligneT4.motif, ligneT4.motif_depassement], ["en_cours", true, "acces_impossible", "imprevu"], "Bloqué après 2 h → en_cours + bloque + motifs");
eq(ligneT4.depassement, { tache_id: "t4", heures_vendues: 8, heures_avant: 7.5, heures_jour: 2 }, "relevé de dépassement figé sur la ligne");
const ligneT3 = rapportsV2.flatMap(r => r.taches).find(l => l.tache_id === "t3");
eq([ligneT3.statut, ligneT3.heures_reelles, ligneT3.avancement, ligneT3.motif, "bloque" in ligneT3], ["non_faite", 0, 40, "attente_materiel", false], "Pas commencé → non_faite, 0 h, avancement inchangé, motif");
ok(!("motif_depassement" in rapportsV2.flatMap(r => r.taches).find(l => l.tache_id === "t6")), "hors devis : aucun motif de dépassement envoyé");
ok(rapportsV2.every(r => r.formulaire_version === "v2" && r.saisie_debut_le === "2026-10-06T16:02:00.000Z"), "rapports v2 : version + heure de première saisie");
// (C) heures_prevues gardé — mesure « envoyé avec exactement la durée prévue »
const lignesV2 = rapportsV2.flatMap(r => r.taches);
eq(lignesV2.map(l => l.heures_prevues ?? null), [3, 2, null, 2, null], "heures_prevues gardé sur chaque ligne v2 qui en a une");
eq(lignesV2.filter(l => l.heures_prevues != null && l.heures_prevues === l.heures_reelles).length, 3, "mesure : 3 lignes envoyées avec exactement la durée prévue (t1, t2, t4)");
eq(explicationLigne(lignesV2[2]), "Attente de matériel", "explication : libellé du motif quand la remarque est vide");
eq(libelleStatutChoisi(ligneT4), "Bloqué", "statut choisi lisible par la Validation");

// ── 3. CAS LIMITES ──────────────────────────────────────────────────────────
// Bloquée à 0 h
let b0 = appliquerChoix({ ...CH_A, planifie: "X", tache_id: "t3", statut: null, remarque: "" }, "bloque", { avancementActuel: 30 });
eq([b0.statut, b0.bloque, b0.avancement], ["non_faite", true, "30"], "Bloqué à 0 h → non_faite, avancement prérempli");
eq(problemesLigne(b0, {}), ["motif"], "Bloqué : motif obligatoire");
b0 = { ...b0, motif: "autre" };
eq(problemesLigne(b0, {}), ["precision"], "motif « autre » : précision obligatoire");
b0 = { ...b0, remarque: "voisin absent" };
eq(problemesLigne(b0, {}), [], "Bloqué à 0 h complet");
eq(pointagesJournee(construireRapports({ ...base, taches: [b0], heuresIndirectes: [], trajetMatin: 0, trajetSoir: 0, planData, serialiser: serialiserLigneV2 })), [], "Bloqué à 0 h : aucun pointage");
// Bloqué puis ajout d'heures → en_cours ; retrait → non_faite
let b2 = changerMinutes(b0, 120);
eq([b2.statut, b2.bloque], ["en_cours", true], "Bloqué + 2 h → en_cours");
eq([changerMinutes(b2, 0).statut], ["non_faite"], "Bloqué remis à 0 h → non_faite");
// En cours / Terminé exigent du temps ; Pas commencé n'en a pas
eq(problemesLigne(appliquerChoix({ planifie: "Y", heures_reelles: "", statut: null }, "termine"), {}), ["temps"], "Terminé sans temps : refusé");
const pc = changerMinutes(appliquerChoix({ planifie: "Y", heures_reelles: "2", statut: null }, "pas_commence", {}), 30);
eq([pc.statut, minutesDe(pc)], ["en_cours", 30], "temps ajouté à un Pas commencé → En cours");
eq(appliquerChoix({ planifie: "Y", statut: null }, "pas_commence", {}).avancement, "0", "Pas commencé sans tâche du phasage → 0 (comme avant)");
// Dépassement : données indisponibles → rien de demandé, envoi possible
ok(!motifDepassementRequis(null, v2[3]), "infos indisponibles : pas de motif de dépassement exigé");
// Rattrapage : date et semaine du jour rattrapé sur chaque rapport
const ratt = construireRapports({ ...base, dateKey: "02/10/2026", weekId: "2026-W40", taches: fin2, heuresIndirectes: [], trajetMatin: 0, trajetSoir: 0, planData, serialiser: serialiserLigneV2, extra: colonnesRapportV2(null) });
ok(ratt.every(r => r.date_rapport === "02/10/2026" && r.semaine === "2026-W40"), "rattrapage : date et semaine du jour rattrapé");
// Case décochée en cours de journée : brouillon v2 relu par l'ancien formulaire
const relu = brouillonV2VersV1(v2.map(t => (t.tache_id === "t3" ? { ...t, remarque: "chez le fournisseur" } : t)));
eq(relu[2].remarque, "Attente de matériel — chez le fournisseur", "brouillon v2 → v1 : motif recopié en texte, rien de perdu");
eq(relu[3].remarque, "Accès impossible", "brouillon v2 → v1 : motif seul recopié");
ok(relu.every(t => !("motif" in t) && !("bloque" in t) && !("depassement" in t)), "brouillon v2 → v1 : champs v2 retirés");
// Les lignes qui avaient un motif arrivent avec leur remarque remplie. Une
// ligne « En cours » sans motif (rien d'obligatoire en v2) n'en a pas :
// l'ancien formulaire la demandera avec son message habituel — pas de perte.
ok(v2.filter(t => t.motif).every(t => String(relu[v2.indexOf(t)].remarque || "").trim()),
  "brouillon v2 → v1 : toute ligne qui avait un motif a sa remarque remplie");
eq(relu.filter(t => (t.statut === "en_cours" || t.statut === "non_faite") && !String(t.remarque || "").trim()).map(t => t.planifie),
  ["Plaques", "Divers"], "brouillon v2 → v1 : l'ancien formulaire demandera une remarque pour les « En cours » sans motif");
eq(construireRapports({ ...base, ...jour, taches: relu, planData, serialiser: serialiserLigneV1 }).flatMap(r => r.taches).map(l => [l.statut, l.heures_reelles]),
  rapportsV2.flatMap(r => r.taches).map(l => [l.statut, l.heures_reelles]), "brouillon relu par l'ancien formulaire : mêmes statuts et heures");
ok(!aReprendreIntacte({ aReprendre: true, statut: null, bloque: true }), "À reprendre touchée en v2 (Bloqué) : gardée");
eq(filtrerTachesRemplies([{ planifie: "a", aReprendre: true, motif: "autre" }]).length, 1, "À reprendre avec motif : envoyée");

// ── 4. QUART D'HEURE : la cible est toujours atteignable (A) ────────────────
function remplir(trajetMin, cible) {
  // Deux tâches En cours, l'ouvrier n'a que les boutons − / + (15 min) et le
  // bouton « Mettre les X min restantes ici ».
  let ts = [
    { ...CH_A, planifie: "T1", tache_id: "t1", statut: "en_cours", avancement: "50", heures_reelles: "", remarque: "" },
    { ...CH_A, planifie: "T2", tache_id: "t2", statut: "en_cours", avancement: "50", heures_reelles: "", remarque: "" },
  ];
  const j = { trajetMatin: String(trajetMin), trajetSoir: "0", heuresIndirectes: [], cibleHeures: cible };
  for (let garde = 0; garde < 200; garde++) {
    const r = resteJournee({ taches: ts, ...j });
    if (r.resteMin >= PAS_MINUTES) ts = maj(ts, garde % 2, t => changerMinutes(t, minutesDe(t) + PAS_MINUTES));
    else if (r.resteMin <= -PAS_MINUTES) ts = maj(ts, garde % 2, t => changerMinutes(t, Math.max(0, minutesDe(t) - PAS_MINUTES)));
    else if (ajustementPossible(r.resteMin)) ts = maj(ts, 0, t => poserReste(t, r.resteMin));
    else break;
  }
  return { ts, j };
}
let essais = 0;
for (const cible of [7, 8, 9, 10]) for (let trajet = 0; trajet <= 130; trajet += 1) {
  const { ts, j } = remplir(trajet, cible);
  const e = etatEnvoi({ taches: ts, ...j });
  assert.ok(e.peutEnvoyer, `cible ${cible} h, trajet ${trajet} min : cible atteinte`);
  const pts = pointagesJournee(construireRapports({ ...base, ...j, taches: ts, planData, serialiser: serialiserLigneV2 }));
  const somme = pts.reduce((s, p) => s + Math.round(p.heures * 100) / 100, 0); // numeric(6,2)
  assert.ok(Math.abs(somme - cible) <= 0.011, `cible ${cible} h, trajet ${trajet} min : pointages arrondis au centième = ${somme}`);
  essais++;
}
nbOk += essais;
// Exemple de la demande : 9 h − 40 min de trajet = 8 h 20 de tâches.
{
  let ts = [{ ...CH_A, planifie: "T", tache_id: "t1", statut: "en_cours", avancement: "50", heures_reelles: String(8.25), remarque: "" }];
  const j = { trajetMatin: "40", trajetSoir: "0", heuresIndirectes: [], cibleHeures: 9 };
  const r = resteJournee({ taches: ts, ...j });
  eq([r.resteMin, ajustementPossible(r.resteMin)], [5, true], "8 h 15 + 40 min sur 9 h : reste 5 min, bouton proposé");
  ts = maj(ts, 0, t => poserReste(t, r.resteMin));
  eq(fmtMinutes(minutesDe(ts[0])), "8 h 20", "« Mettre les 5 min restantes ici » → 8 h 20");
  ok(etatEnvoi({ taches: ts, ...j }).peutEnvoyer, "cible atteinte");
  const trop = resteJournee({ taches: [{ ...ts[0], heures_reelles: String(8.5) }], ...j });
  eq([trop.resteMin, ajustementPossible(trop.resteMin)], [-10, true], "10 min de trop : bouton « Retirer les 10 min en trop ici »");
  eq(etatEnvoi({ taches: [{ ...ts[0], heures_reelles: String(8.5) }], ...j }).phrase, "Tu dépasses de 10 min", "phrase du bouton grisé");
  eq(etatEnvoi({ taches: [{ ...ts[0], heures_reelles: String(7) }], ...j }).phrase, "Place encore 1 h 20 pour envoyer", "phrase du bouton grisé");
}

// ── 5. VALIDATION : relevé de dépassement jamais faux (B) ───────────────────
const rT4 = rapportsV2.find(r => r.taches.some(l => l.tache_id === "t4"));
const lT4 = lignesDepuisRapport(rT4).find(l => l.tache_id === "t4");
eq(depassementAffichable(lT4), { tache_id: "t4", heures_vendues: 8, heures_avant: 7.5, heures_jour: 2 }, "ligne intacte : relevé affiché");
eq(depassementAffichable({ ...lT4, tache_id: "t1" }), null, "ligne réaffectée à une autre tâche : relevé masqué");
eq({ ...lT4, tache_id: "t1" }.motif_depassement, "imprevu", "… le motif de l'ouvrier est conservé");
const [m1, m2] = decouperLigne(lT4, "s1");
eq([depassementAffichable(m1), depassementAffichable(m2), m1.motif_depassement, m2.motif_depassement], [null, null, "imprevu", "imprevu"], "ligne découpée : relevé retiré des deux moitiés, motif conservé");
eq([m1.heures, m2.heures], [1, 1], "découpage : moitié des heures chacune");
eq(depassementAffichable({ ...lT4, _origine: false }), null, "ligne ajoutée par la Validation (pas d'origine ouvrier) : jamais de relevé");
eq(depassementAffichable({ ...lT4, heures: 1.5 }), null, "heures corrigées par le conducteur : relevé masqué");
const bascule = ligneBasculee(lT4, { heures: 1, rapport: { id: "r", chantier_id: "chB" }, valideur: "Loris", le: "x" });
eq([bascule.bloque, bascule.motif, bascule.motif_depassement, "depassement" in bascule], [true, "acces_impossible", "imprevu", false], "bascule : motifs suivis, relevé retiré");

// ── 6. MOTIFS : liste unique, codes stables ─────────────────────────────────
eq(MOTIFS_STATUT.map(m => m.code), ["attente_materiel", "autre_corps_etat", "acces_impossible", "info_manquante", "decision_client", "manque_de_temps", "priorite_changee", "autre"], "codes des motifs de statut (stables)");
eq(MOTIFS_DEPASSEMENT.map(m => m.code), ["imprevu", "demande_client", "support_degrade", "reprise", "devis_sous_estime", "autre"], "codes des motifs de dépassement (stables)");
eq(libelleMotifStatut("code_inconnu"), "Motif « code_inconnu »", "code inconnu : reste visible");
eq(explicationLigne({ remarque: "texte libre" }), "texte libre", "ligne de l'ancien formulaire : la remarque, inchangée");
eq(choixDeLigne({ statut: "non_faite", bloque: true }), "bloque", "choix relu depuis les champs stockés");

// ── 7. « J'AI FAIT AUTRE CHOSE » (étape 3a) ───────────────────────────────
{
  // Phasage fictif tel que le renvoie ouvrier_mes_phases.
  const PAYLOAD = { modele: "v2", prenom: "Paul", phases: [
    { id: "g1", nom: "Cloisons & doublage", ordre: 10, couleur: "#f59e0b", synthetique: false, ouvrages: [
      { id: "o1", libelle: "Doublage murs", heures_vendues_ouvrage: 22, ouvrage_complet: true, taches: [
        { id: "t2", nom: "Plaques", avancement: 40, heures_vendues: 16, heures_validees: 2, heures_en_attente: 0, ouvriers: ["Paul"], est_mienne: true, mes_heures: 0, hors_devis: false },
        { id: "t9", nom: "Ossature terminée", avancement: 100, heures_vendues: 6, heures_validees: 6, heures_en_attente: 0, ouvriers: [], est_mienne: false, mes_heures: 0, hors_devis: false },
      ] },
      { id: "o2", libelle: "Électricité générale", heures_vendues_ouvrage: 8, ouvrage_complet: true, taches: [
        { id: "t4", nom: "Saignées", avancement: 70, heures_vendues: 8, heures_validees: 7, heures_en_attente: 0.5, ouvriers: [], est_mienne: false, mes_heures: 0, hors_devis: false },
      ] },
    ] },
    { id: "_a_organiser", nom: "À organiser", ordre: 999999, couleur: "#94a3b8", synthetique: true, ouvrages: [
      { id: "o3", libelle: "Divers / hors devis", heures_vendues_ouvrage: 0, ouvrage_complet: true, taches: [
        { id: "t6", nom: "Reprise imprévue", avancement: 0, heures_vendues: 0, heures_validees: 5, heures_en_attente: 0, ouvriers: [], est_mienne: false, mes_heures: 0, hors_devis: true },
      ] },
    ] },
  ] };
  const phasesP = construireMesPhases(PAYLOAD).phases;
  const tacheP = (id) => phasesP.flatMap(p => p.ouvrages.flatMap(o => o.taches)).find(t => t.id === id);
  const idsDe = (phases) => phases.flatMap(p => p.ouvrages.flatMap(o => o.taches.map(t => t.id)));
  const chA = { id: "chA", nom: "Chantier A", couleur: "#f00" }, chB = { id: "chB", nom: "Chantier B", couleur: "#0f0" };

  // Recherche (accents et casse ignorés ; ouvrage trouvé = toutes ses tâches)
  eq(idsDe(rechercherDansPhases(phasesP, "plaq")), ["t2"], "recherche par nom de tâche");
  eq(idsDe(rechercherDansPhases(phasesP, "ELECTRICITE")), ["t4"], "recherche par ouvrage, sans accent");
  eq(idsDe(rechercherDansPhases(phasesP, "doublage")), ["t2", "t9"], "ouvrage trouvé : toutes ses tâches");
  eq(rechercherDansPhases(phasesP, "zzz"), [], "aucun résultat");
  eq(rechercherDansPhases(phasesP, "  ").length, phasesP.length, "recherche vide : tout");

  // Carte créée = tâche planifiée + origine
  const lig = ligneDepuisPhasage(tacheP("t2"), chA);
  eq(lig, { chantier_id: "chA", chantier_nom: "Chantier A", chantier_couleur: "#f00", planifie: "Plaques", tache_id: "t2",
    phase_id: null, statut: null, remarque: "", heures_reelles: "", avancement: "40", photos: [], origine: ORIGINE_PHASAGE },
    "carte ajoutée : tache_id, phase_id vide (comme le planning), 0 h, aucun statut, avancement du phasage, origine");
  eq(problemesLigne(lig, {}), ["statut"], "carte ajoutée : l'ouvrier doit choisir le statut");

  // Mêmes pointages qu'une tâche planifiée avec les mêmes heures
  const jourA = { trajetMatin: "30", trajetSoir: "30", heuresIndirectes: [] };
  const remplir = (t) => ({ ...changerMinutes(appliquerChoix(t, "en_cours", { avancementActuel: 40 }), 180), avancement: "50" });
  const planifiee = remplir({ ...CH_A, planifie: "Plaques", tache_id: "t2", phase_id: null, statut: null, remarque: "" });
  const ajoutee = remplir(ajouterDepuisPhasage([], tacheP("t2"), chA)[0]);
  const autre = { ...CH_A, planifie: "Pose", tache_id: "t1", statut: "faite", heures_reelles: "6", avancement: "100", remarque: "" };
  const ptsPlan = pointagesJournee(construireRapports({ ...base, ...jourA, taches: [autre, planifiee], planData, serialiser: serialiserLigneV2 }));
  const ptsAjout = pointagesJournee(construireRapports({ ...base, ...jourA, taches: [autre, ajoutee], planData, serialiser: serialiserLigneV2 }));
  eq(ptsAjout, ptsPlan, "tâche ajoutée depuis le phasage : mêmes pointages qu'une tâche planifiée");
  const serAjout = serialiserLigneV2(ajoutee);
  eq([serAjout.origine, "origine" in serialiserLigneV2(planifiee)], [ORIGINE_PHASAGE, false], "origine écrite sur la ligne ajoutée seulement");
  ok(!("origine" in serialiserLigneV1(ajoutee)), "ancien formulaire : aucune origine écrite (rapports v1 inchangés)");
  eq(lignesDepuisRapport({ taches: [serAjout] })[0].origine, ORIGINE_PHASAGE, "Validation : repère « Ajoutée par l'ouvrier »");
  eq(lignesDepuisRapport({ taches: [serAjout] })[0].tache_id, "t2", "Validation : ligne rattachée à sa tâche");

  // Pas de doublon
  let jourT = [planifiee];
  ok(tacheDejaDansJournee(jourT, "t2"), "tâche planifiée : « Déjà dans ta journée »");
  eq(ajouterDepuisPhasage(jourT, tacheP("t2"), chA), jourT, "ajout d'une tâche déjà planifiée : refusé");
  jourT = ajouterDepuisPhasage(jourT, tacheP("t4"), chA);
  eq(ajouterDepuisPhasage(jourT, tacheP("t4"), chA).length, 2, "deuxième ajout de la même tâche : refusé");
  // Retrait
  eq([carteRetirable(jourT[0]), carteRetirable(jourT[1]), carteRetirable({ libre: true })], [false, true, true], "seules les cartes ajoutées sont retirables");
  // Deuxième chantier du jour
  const surB = ajouterDepuisPhasage([planifiee], tacheP("t4"), chB);
  const surBRemplie = [surB[0], { ...changerMinutes(appliquerChoix(surB[1], "en_cours", {}), 60), avancement: "75" }];
  const rapB = construireRapports({ ...base, ...jourA, taches: surBRemplie, planData, serialiser: serialiserLigneV2 });
  eq(rapB.map(r => [r.chantier_id, r.taches.map(l => l.tache_id)]), [["chA", ["t2"]], ["chB", ["t4"]]], "ajout sur un 2e chantier : un rapport de plus");
  // Hors devis : ajoutable, ni jauge ni motif de dépassement
  const hd = changerMinutes(appliquerChoix(ajouterDepuisPhasage([], tacheP("t6"), chA)[0], "en_cours", {}), 120);
  ok(!motifDepassementRequis(tacheP("t6"), hd), "tâche hors devis ajoutée : aucun motif de dépassement");
  // Terminée : ajoutable, avancement 100 prérempli
  const term = ajouterDepuisPhasage([], tacheP("t9"), chA);
  eq([term.length, term[0].avancement, tacheP("t9").statut], [1, "100", "terminee"], "tâche terminée : ajoutable, mention « Terminée »");
  // Dépassement sur une tâche ajoutée : même règle que les tâches planifiées
  const t4aj = changerMinutes(appliquerChoix(ajouterDepuisPhasage([], tacheP("t4"), chA)[0], "en_cours", {}), 120);
  ok(motifDepassementRequis(tacheP("t4"), t4aj), "tâche ajoutée en dépassement : motif demandé");
  // Repli en texte libre (fonction indisponible)
  const libreL = { chantier_id: "chA", chantier_nom: "Chantier A", planifie: "Nettoyage du garage", statut: "faite", heures_reelles: "1", avancement: "100", remarque: "", libre: true, origine: ORIGINE_LIBRE };
  eq(serialiserLigneV2(libreL).origine, ORIGINE_LIBRE, "texte libre : origine « libre »");
  eq(serialiserLigneV2({ ...libreL, origine: undefined }).origine, ORIGINE_LIBRE, "carte libre d'un brouillon plus ancien : origine « libre »");
  // Brouillon : repris tel quel (stockage JSON), puis relu par l'ancien formulaire
  const brouillon = JSON.parse(JSON.stringify({ version: "v2", taches: [planifiee, ajoutee] }));
  eq(brouillon.taches[1], ajoutee, "brouillon v2 : la carte ajoutée est reprise à l'identique");
  const enV1 = brouillonV2VersV1(brouillon.taches);
  eq([enV1[1].libre, enV1[1].tache_id, "origine" in enV1[1]], [true, "t2", false], "case décochée : la carte ajoutée devient une tâche ajoutée de l'ancien formulaire (retirable, rattachée)");
  const cles = "avancement,heures_reelles,phase_id,photos,planifie,remarque,statut,tache_id";
  eq(construireRapports({ ...base, ...jourA, taches: enV1, planData, serialiser: serialiserLigneV1 }).flatMap(r => r.taches).map(l => Object.keys(l).sort().join(",")),
    [cles, cles], "ancien formulaire : lignes au format v1 strict, aucun champ v2");
}

console.log(`verif-compte-rendu-v2 : ${nbOk} contrôles OK (dont ${essais} journées « quart d'heure »)`);
