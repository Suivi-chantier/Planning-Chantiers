#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Vérification — quantités posées et photo « après » (étape 4 du nouveau
// compte rendu). Données FICTIVES de test.
//
//   1. Mode de suivi : m² / « m2 » / ml / m³ / U ≥ 2 en quantité ; quantité ≤ 1,
//      hors devis, Divers, « Suivi en % » en pourcentage ; quantité de tâche.
//   2. Calculs : point de départ, cumul, avancement, « terminée » qui prime,
//      conversion d'un % de l'ancien formulaire, jamais de quantité négative.
//   3. Carte de l'ouvrier : posé aujourd'hui, Terminé prérempli, dépassement
//      autorisé, Pas commencé / Bloqué à 0 h sans quantité.
//   4. Photo « après » : obligatoire sur Terminé ; hors connexion et bouton
//      enregistrés séparément ; jamais d'envoi bloqué.
//   5. Validation → pointages → avancement : tâche neuve, tâche déjà avancée,
//      deux ouvriers le même jour, dépassement, dévalidation puis
//      revalidation, terminée puis reprise, coexistence ancien formulaire.
//   6. Lignes et pointages en pourcentage STRICTEMENT inchangés.
//   7. SQL : colonnes et contrainte (>= 0) dans PGlite, migration rejouable.
//
//   node scripts/verif-quantites-posees.mjs
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  MODE_QUANTITE, MODE_POURCENT, normaliserUnite, quantitePrevue, modeSuivi, pointDeDepart, avancementQuantite,
  conversionPourcent, quantiteValide, ecartTerminee, etatSuivi, fmtQuantite, libelleQuantite, sommesParTache,
  avancementRecalcule,
} from "../src/Renovation/suiviQuantite.mjs";
import {
  suiviDepuisInfo, changerQuantiteJour, appliquerChoixSuivi, apresMinutesSuivi, totalAvecJour, problemesLigne,
  etatEnvoi, finaliserLignesV2, serialiserLigneV2, brouillonV2VersV1, majPhotosApres, majPhotosAutres,
  photosAutres, photosApres, signalerPhotoImpossible, changerMinutes, appliquerChoix,
} from "../src/Renovation/compteRenduV2.mjs";
import { serialiserLigneV1 } from "../src/Renovation/compteRenduEnvoi.mjs";
import {
  lignesDepuisRapport, taskLinesPourPointages, suiviPourValidation, decisionQuantite, quantiteEffective,
  apresValidation, majTachesQuantite, majTachesApresDevalidation, appliquerPatches, decouperLigne, ligneBasculee,
} from "../src/Renovation/lignesValidation.mjs";
import { buildPointagesRapport, reporterQuantites } from "../src/pointagesRapport.mjs";

let nbOk = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); nbOk++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };

// ── 1. Mode de suivi ────────────────────────────────────────────────────────
const O = (unite, quantite, libelle = "Doublage") => ({ unite, quantite, libelle });
const mode = (t, o) => modeSuivi(t, o).mode;
eq([normaliserUnite("m2"), normaliserUnite(" M² "), normaliserUnite("m3"), normaliserUnite("ML"), normaliserUnite("u"), normaliserUnite("ens"), normaliserUnite("")],
  ["m²", "m²", "m³", "ml", "U", null, null], "unités normalisées à la lecture (m2 = m², m3 → m³)");
eq([mode({}, O("m²", 85)), mode({}, O("m2", 85)), mode({}, O("ml", 12)), mode({}, O("m3", 3)), mode({}, O("U", 2))],
  [MODE_QUANTITE, MODE_QUANTITE, MODE_QUANTITE, MODE_QUANTITE, MODE_QUANTITE], "m², m2, ml, m³, U ≥ 2 : en quantité");
eq([mode({}, O("U", 1)), mode({}, O("m²", 1)), mode({}, O("m²", 0.5)), mode({}, O("m²", null)), mode({}, O("m²", "")), mode({}, O("ens", 10))],
  [MODE_POURCENT, MODE_POURCENT, MODE_POURCENT, MODE_POURCENT, MODE_POURCENT, MODE_POURCENT], "quantité ≤ 1 (même en m²), absente, unité inconnue : en %");
eq([modeSuivi({ hors_devis: true }, O("m²", 85)).raison, modeSuivi({}, O("m²", 85, " Divers / HORS devis ")).raison, modeSuivi({ suivi_pourcent: true }, O("m²", 85)).raison],
  ["hors_devis", "divers", "force"], "hors devis, Divers, « Suivi en % » : en %");
eq([quantitePrevue({ quantite: 60 }, O("m²", 85)), quantitePrevue({}, O("m²", "85,5")), quantitePrevue({ quantite: 0 }, O("m²", 85))], [60, 85.5, 85],
  "quantité de la tâche prioritaire (0 ou vide : celle de l'ouvrage)");
eq(mode({ quantite: 1 }, O("m²", 85)), MODE_POURCENT, "quantité de tâche ≤ 1 : en %");

// ── 2. Calculs ──────────────────────────────────────────────────────────────
eq(pointDeDepart({ avancement: 40 }, 85), 34, "point de départ provisoire : 40 % × 85 = 34");
eq(pointDeDepart({ avancement: 40, quantite_reprise: 12 }, 85), 12, "point de départ figé : prioritaire");
eq([avancementQuantite({ cumul: 51, quantite: 85 }), avancementQuantite({ cumul: 120, quantite: 85 }), avancementQuantite({ cumul: 10, quantite: 85, terminee: true })],
  [60, 100, 100], "avancement = cumul / quantité, plafonné à 100 ; « terminée » prime");
eq(ecartTerminee({ terminee: true, cumul: 70, quantite: 85, unite: "m²" }), "terminée à 70 / 85 m²", "écart lisible");
eq(ecartTerminee({ terminee: true, cumul: 90, quantite: 85, unite: "m²" }), "", "pas d'écart si le cumul atteint la quantité");
eq([conversionPourcent({ pourcent: 60, quantite: 85, cumulAvant: 42 }), conversionPourcent({ pourcent: 40, quantite: 85, cumulAvant: 51 })],
  [9, 0], "conversion % → quantité : 60 % de 85 = 51, soit + 9 ; jamais négative");
eq([quantiteValide(-5), quantiteValide("12,456"), quantiteValide("")], [0, 12.46, 0], "quantité validée jamais négative, au centième");
eq([fmtQuantite(51.5), libelleQuantite(51, 85, "m²")], ["51,5", "51 / 85 m²"], "affichage");
eq(sommesParTache([{ tache_id: "a", quantite_validee: 2 }, { tache_id: "a", quantite_validee: "3,5" }, { tache_id: "b", quantite_validee: null }]), { a: 5.5 },
  "sommes par tâche (nulles ignorées)");
eq(avancementRecalcule({ quantite_reprise: 10, quantite: 50 }, O("m²", 85), 15), 50, "Phasage V2 : tâche allumée, quantité changée → recalcul (25 / 50)");
eq(avancementRecalcule({ avancement: 30 }, O("m²", 85), 0), null, "Phasage V2 : tâche pas allumée → l'avancement reste saisi en %");

// ── 3. Carte de l'ouvrier ───────────────────────────────────────────────────
const INFO = (extra = {}) => ({
  id: "t1", avancement: 0, heures_vendues: 0, hors_devis: false, hors_devis_marque: false,
  ouvrage_unite: "m2", ouvrage_quantite: 85, ouvrage_libelle: "Doublage",
  quantite: null, suivi_pourcent: false, quantite_reprise: null, quantite_terminee: false,
  quantite_validee: 0, quantite_en_attente: 0, ...extra,
});
eq(suiviDepuisInfo({ ...INFO(), quantite_validee: undefined }), null, "RPC d'avant l'étape 4 : en %, comme avant");
eq(suiviDepuisInfo(INFO({ suivi_pourcent: true })), null, "suivi forcé en % : pas de quantité");
const sq = suiviDepuisInfo(INFO());
eq([sq.unite, sq.quantite, sq.cumul], ["m²", 85, 0], "tâche neuve en m² (« m2 » lu « m² »)");
const L0 = { planifie: "Plaques", tache_id: "t1", statut: null, heures_reelles: "", avancement: "0", photos: [], remarque: "" };
const infos = (info) => ({ t1: info });
let c = changerMinutes(appliquerChoixSuivi(L0, "en_cours", sq), 240);
eq(problemesLigne(c, infos(INFO())), ["quantite"], "En cours : la quantité est demandée, pas le pourcentage");
c = changerQuantiteJour(c, "12,5", sq);
eq([c.quantite_jour, c.unite, c.avancement], ["12,5", "m²", "15"], "posé 12,5 m² → 15 % (12,5 / 85)");
eq(problemesLigne(c, infos(INFO())), [], "carte en quantité complète");
eq(changerQuantiteJour(c, "-3a.2", sq).quantite_jour, "3,2", "jamais de signe moins ni de lettre");
const sqAvance = suiviDepuisInfo(INFO({ avancement: 40, quantite_validee: 0, quantite_en_attente: 5 }));
eq([sqAvance.depart, sqAvance.cumul, totalAvecJour(sqAvance, { quantite_jour: "12" })], [34, 34, 51], "total = départ (40 % × 85) + en attente + aujourd'hui = 51");
const t = changerMinutes(appliquerChoixSuivi(L0, "termine", sqAvance), 120);
eq([t.quantite_jour, t.avancement, t.statut], ["46", "100", "faite"], "Terminé : préremplit le reste à poser (85 − 34 − 5 = 46), 100 %");
const trop = changerQuantiteJour(changerMinutes(appliquerChoixSuivi(L0, "en_cours", sq), 60), "100", sq);
eq([trop.avancement, problemesLigne(trop, infos(INFO()))], ["100", []], "dépassement (100 / 85 m²) : autorisé, plafonné à 100 %, rien ne bloque");
const pc = appliquerChoixSuivi(c, "pas_commence", sq);
ok(!("quantite_jour" in pc) && !("unite" in pc), "Pas commencé : la quantité est retirée");
const bloque0 = appliquerChoixSuivi({ ...L0, heures_reelles: "" }, "bloque", sq);
ok(!("quantite_jour" in bloque0) && !problemesLigne({ ...bloque0, motif: "attente_materiel" }, infos(INFO())).includes("quantite"), "Bloqué à 0 h : pas de quantité");
const bloqueH = changerMinutes(appliquerChoixSuivi(L0, "bloque", sq), 60);
ok(problemesLigne({ ...apresMinutesSuivi(bloqueH, sq), motif: "attente_materiel" }, infos(INFO())).includes("quantite"), "Bloqué avec heures : quantité demandée");
ok(!("quantite_jour" in apresMinutesSuivi(changerMinutes(changerQuantiteJour(bloqueH, "4", sq), 0), sq)), "Bloqué qui retombe à 0 h : quantité retirée");
eq(problemesLigne({ ...L0, statut: "en_cours", heures_reelles: "1", avancement: "" }, infos(INFO({ suivi_pourcent: true }))), ["avancement"],
  "tâche forcée en % : l'avancement en % reste demandé (inchangé)");

// ── 4. Photo « après » ──────────────────────────────────────────────────────
const term = changerMinutes(appliquerChoix({ ...L0, photos: ["p-avant.jpg"] }, "termine"), 60);
eq(problemesLigne(term, {}), ["photo_apres"], "Terminé sans photo « après » : bloqué");
eq(problemesLigne(term, {}, { horsConnexion: true }), [], "hors connexion : non exigée");
eq(problemesLigne(signalerPhotoImpossible(term), {}), [], "bouton « Je ne peux pas envoyer la photo » : non exigée");
const avecApres = majPhotosApres(term, ["p-apres.jpg"]);
eq([avecApres.photos, photosApres(avecApres), photosAutres(avecApres)], [["p-avant.jpg", "p-apres.jpg"], ["p-apres.jpg"], ["p-avant.jpg"]],
  "photo « après » : ajoutée à photos (rien ne casse) et désignée dans photos_apres");
eq(problemesLigne(avecApres, {}), [], "avec la photo « après » : complète");
eq(majPhotosAutres(avecApres, []).photos, ["p-apres.jpg"], "retirer les autres photos garde la photo « après »");
eq(photosApres(majPhotosApres(avecApres, [])), [], "retirer la photo « après » la retire des deux listes");
const [fHors] = finaliserLignesV2([term], {}, { horsConnexion: true });
const [fBouton] = finaliserLignesV2([signalerPhotoImpossible(term)], {}, { horsConnexion: false });
const [fOk] = finaliserLignesV2([avecApres], {});
eq([fHors.photo_apres_manquante, fHors.photo_apres_hors_connexion, fHors.photo_apres_bouton], [true, true, undefined], "hors connexion : part, marquée « hors connexion »");
eq([fBouton.photo_apres_manquante, fBouton.photo_apres_hors_connexion, fBouton.photo_apres_bouton], [true, undefined, true], "bouton : part, marqué « bouton » (champ distinct)");
eq([fOk.photo_apres_manquante, fOk.photo_apres_bouton], [undefined, undefined], "avec photo : aucun marqueur");
const enCoursAvecBouton = finaliserLignesV2([{ ...signalerPhotoImpossible(term), statut: "en_cours" }], {})[0];
ok(!enCoursAvecBouton.photo_apres_bouton && !enCoursAvecBouton.photo_apres_manquante, "plus Terminé : marqueurs retirés");
const env = etatEnvoi({ taches: [term], trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 1, horsConnexion: true });
ok(env.peutEnvoyer, "hors connexion : l'envoi n'est jamais bloqué par la photo");
const sOk = serialiserLigneV2(fOk), sHors = serialiserLigneV2(fHors);
eq([sOk.photos_apres, sHors.photo_apres_manquante, sHors.photo_apres_hors_connexion], [["p-apres.jpg"], true, true], "envoyés sur la ligne");

// ── Envoi d'une ligne en quantité ; brouillon relu par l'ancien formulaire ──
const envoyee = serialiserLigneV2(finaliserLignesV2([c], infos(INFO()))[0]);
eq([envoyee.quantite_jour, envoyee.unite, envoyee.avancement, envoyee.heures_reelles], [12.5, "m²", 15, 4], "ligne envoyée : quantité (nombre), unité, avancement calculé");
const ligneV1 = serialiserLigneV2(finaliserLignesV2([{ ...L0, statut: "en_cours", heures_reelles: "2", avancement: "50" }], {})[0]);
eq(Object.keys(ligneV1).sort(), Object.keys(serialiserLigneV1({ ...L0, statut: "en_cours", heures_reelles: "2", avancement: "50" })).sort(),
  "ligne en % : AUCUN champ de plus que le format historique");
const [br] = brouillonV2VersV1([{ ...c, remarque: "côté fenêtre", photos_apres: [] }]);
ok(!("quantite_jour" in br) && !("unite" in br) && !("photos_apres" in br), "ancien formulaire : champs de l'étape 4 retirés");
eq([br.remarque, br.avancement], ["Posé : 12,5 m² — côté fenêtre", "15"], "la quantité passe en texte, l'avancement en % reste");

// ── 5. Validation → pointages → avancement ──────────────────────────────────
const OUVRAGES = () => [{ id: "o1", libelle: "Doublage", unite: "m2", quantite: 85, taches: [
  { id: "t1", nom: "Plaques", avancement: 0 },                 // neuve
  { id: "t2", nom: "Bandes", avancement: 40 },                 // déjà avancée, pas allumée
  { id: "t3", nom: "Enduit", avancement: 0, quantite: 60 },    // quantité de tâche ≠ ouvrage
  { id: "t4", nom: "Protection", avancement: 0, suivi_pourcent: true }, // forcée en %
] }];
const rapport = (id, ouvrier, lignes) => ({ id, ouvrier, chantier_id: "ch", taches: lignes });
const LQ = (tache_id, q, extra = {}) => ({ planifie: tache_id, tache_id, phase_id: null, statut: "en_cours", heures_reelles: 2, avancement: 0, photos: [], remarque: "", quantite_jour: q, unite: "m2", ...extra });
// Simule une validation : décision par défaut, pointages, cumul relu, patch.
let registre = [];
function valider(ouvrages, r, retouches = {}) {
  const sommesAvant = sommesParTache(registre.filter(p => p.rapport_id !== r.id));
  const lignes = lignesDepuisRapport(r).map(li => ({ ...li, qte_edit: retouches[li.tache_id] }));
  const avecQte = lignes.map(li => ({ ...li, qte: quantiteEffective(li, suiviPourValidation(ouvrages, li.tache_id, sommesAvant[li.tache_id] || 0)) }));
  const pts = buildPointagesRapport({ chantier_id: "ch", ouvrier: r.ouvrier, dateISO: "2026-10-06", taux: 30, rapport_id: r.id, taskLines: taskLinesPourPointages(avecQte) });
  registre = [...registre.filter(p => p.rapport_id !== r.id), ...pts];
  const patches = majTachesQuantite({ ouvrages, lignes: avecQte, sommes: sommesParTache(registre), rapportId: r.id, le: "2026-10-06" });
  return { ouvrages: appliquerPatches(ouvrages, patches), pts, avecQte, patches };
}
const tache = (ouv, id) => ouv[0].taches.find(x => x.id === id);

// Tâche neuve.
let ouv = OUVRAGES();
let v = valider(ouv, rapport("r1", "Paul", [LQ("t1", 12)]));
eq([v.pts[0].quantite_declaree, v.pts[0].quantite_validee, v.pts[0].quantite_unite], [12, 12, "m²"], "tâche neuve : pointage avec quantité déclarée / validée / unité figée");
eq([tache(v.ouvrages, "t1").quantite_reprise, tache(v.ouvrages, "t1").avancement], [0, 14], "tâche neuve : point de départ 0 posé, avancement 12 / 85 = 14 %");
ouv = v.ouvrages;
// Tâche déjà avancée (40 %) : point de départ 34, figé une seule fois.
v = valider(ouv, rapport("r2", "Paul", [LQ("t2", 12)]));
eq([tache(v.ouvrages, "t2").quantite_reprise, tache(v.ouvrages, "t2").avancement], [34, 54], "tâche déjà avancée : départ 34 (40 % × 85) + 12 = 46 → 54 %");
ouv = v.ouvrages;
// Deux ouvriers le même jour : chacun sa ligne, le cumul additionne.
v = valider(ouv, rapport("r3", "Davy", [LQ("t2", 5)]));
eq([v.pts.length, tache(v.ouvrages, "t2").quantite_reprise, tache(v.ouvrages, "t2").avancement], [1, 34, 60], "deuxième ouvrier : départ inchangé, 34 + 12 + 5 = 51 → 60 %");
eq(registre.filter(p => p.tache_id === "t2").map(p => [p.ouvrier, p.quantite_validee]), [["Paul", 12], ["Davy", 5]], "un pointage par ouvrier");
ouv = v.ouvrages;
// Quantité retouchée par le conducteur (jamais négative).
v = valider(ouv, rapport("r3", "Davy", [LQ("t2", 5)]), { t2: { validee: -4 } });
eq([v.pts[0].quantite_declaree, v.pts[0].quantite_validee, tache(v.ouvrages, "t2").avancement], [5, 0, 54], "retouche négative → 0 (déclaré 5 conservé), cumul 46 → 54 %");
v = valider(ouv, rapport("r3", "Davy", [LQ("t2", 5)]));
ouv = v.ouvrages;
// Dépassement de la quantité prévue.
v = valider(ouv, rapport("r4", "Paul", [LQ("t1", 90)]));
eq(tache(v.ouvrages, "t1").avancement, 100, "dépassement (102 / 85 m²) : plafonné à 100 %");
ok(apresValidation(suiviPourValidation(ouv, "t1", 12), 90, false).cumul > 85, "dépassement signalé en Validation (cumul > quantité prévue)");
// Dévalidation puis revalidation : cumul juste.
registre = registre.filter(p => p.rapport_id !== "r4");
const pDev = majTachesApresDevalidation({ ouvrages: v.ouvrages, tacheIds: ["t1"], sommes: sommesParTache(registre), rapportId: "r4" });
eq(pDev.t1.avancement, 14, "dévalidation : cumul redescend à 12 → 14 %");
const reval = valider(appliquerPatches(v.ouvrages, pDev), rapport("r4", "Paul", [LQ("t1", 90)]));
eq([tache(reval.ouvrages, "t1").avancement, tache(reval.ouvrages, "t1").quantite_reprise], [100, 0], "revalidation : même résultat, point de départ inchangé");
eq(registre.filter(p => p.tache_id === "t1").length, 2, "aucun pointage en double");
ouv = appliquerPatches(v.ouvrages, pDev);
registre = registre.filter(p => p.rapport_id !== "r4");
// Quantité de tâche différente de l'ouvrage.
v = valider(ouv, rapport("r5", "Hamed", [LQ("t3", 30)]));
eq(tache(v.ouvrages, "t3").avancement, 50, "quantité de tâche 60 (ouvrage 85) : 30 / 60 = 50 %");
ouv = v.ouvrages;
// Suivi forcé en % : aucune quantité, pointage inchangé.
v = valider(ouv, rapport("r6", "Hamed", [LQ("t4", 10, { avancement: 30 })]));
ok(!("quantite_validee" in v.pts[0]) && v.patches.t4 === undefined, "suivi forcé en % : quantité déclarée ignorée, aucun champ de quantité");
// « Terminée » : marqueur, écart lisible, puis reprise sans repasser sous 100.
v = valider(ouv, rapport("r7", "Paul", [LQ("t2", 19, { statut: "faite" })]));
const t2T = tache(v.ouvrages, "t2");
eq([t2T.avancement, t2T.quantite_terminee, etatSuivi(t2T, v.ouvrages[0], { validee: sommesParTache(registre).t2 }).ecart],
  [100, { rapport_id: "r7", le: "2026-10-06" }, "terminée à 70 / 85 m²"], "Terminé à 70 / 85 m² : 100 %, marqueur posé par r7, écart lisible");
ouv = v.ouvrages;
v = valider(ouv, rapport("r8", "Davy", [LQ("t2", 3, { statut: "en_cours" })]));
eq([tache(v.ouvrages, "t2").avancement, tache(v.ouvrages, "t2").quantite_terminee.rapport_id], [100, "r7"], "reprise sur une tâche terminée : reste à 100 %, marqueur inchangé");
ouv = v.ouvrages;
registre = registre.filter(p => p.rapport_id !== "r8");
// Dévalidation du rapport qui a marqué « terminée » : marqueur retiré.
registre = registre.filter(p => p.rapport_id !== "r7");
const pDevT = majTachesApresDevalidation({ ouvrages: ouv, tacheIds: ["t2"], sommes: sommesParTache(registre), rapportId: "r7" });
eq(pDevT.t2, { quantite_terminee: null, avancement: 60 }, "dévalidation de r7 : marqueur retiré, 51 / 85 → 60 %");
eq(majTachesApresDevalidation({ ouvrages: ouv, tacheIds: ["t2"], sommes: sommesParTache(registre), rapportId: "autre" }).t2.avancement, 100,
  "dévalidation d'un autre rapport : marqueur gardé, 100 %");
ouv = appliquerPatches(ouv, pDevT);
ok(!("quantite_terminee" in tache(ouv, "t2")), "marqueur retiré du phasage");

// Ligne à 0 h (heures retirées par le conducteur) : pas de pointage, donc ni
// quantité ni marqueur « terminée » (qu'aucune dévalidation ne saurait retirer).
const zero = majTachesQuantite({ ouvrages: OUVRAGES(), lignes: [{ tache_id: "t1", heures: 0, qte: { validee: 5, terminee: true, unite: "m²" } }],
  sommes: {}, rapportId: "rz", le: "x" });
eq(zero, {}, "ligne à 0 h : aucune tâche touchée (pas de marqueur sans pointage)");

// Coexistence avec l'ancien formulaire (tâche t2 allumée, cumul 51).
const v1Ligne = { planifie: "Bandes", tache_id: "t2", phase_id: null, statut: "en_cours", heures_reelles: 3, avancement: 70, photos: [], remarque: "" };
const sT2 = suiviPourValidation(ouv, "t2", sommesParTache(registre).t2);
eq(sT2.cumul, 51, "cumul avant : 34 + 12 + 5 = 51");
const d1 = decisionQuantite(lignesDepuisRapport(rapport("r9", "Kev", [v1Ligne]))[0], sT2);
eq([d1.source, d1.validee, d1.declaree, d1.pourcent], ["pourcent", 8.5, null, 70], "ancien formulaire 70 % : 59,5 au total → + 8,5 m² préremplis");
v = valider(ouv, rapport("r9", "Kev", [v1Ligne]));
eq([v.pts[0].quantite_declaree, v.pts[0].quantite_validee, v.pts[0].avancement_declare, tache(v.ouvrages, "t2").avancement],
  [null, 8.5, 70, 70], "pointage : quantité validée sans déclarée, % déclaré gardé ; avancement = cumul (59,5 / 85 = 70 %)");
const dBas = decisionQuantite(lignesDepuisRapport(rapport("r10", "Kev", [{ ...v1Ligne, avancement: 30 }]))[0], sT2);
eq(dBas.validee, 0, "ancien formulaire en dessous du cumul : rien n'est ajouté (jamais négatif)");
eq(decisionQuantite(lignesDepuisRapport(rapport("r11", "Kev", [{ ...v1Ligne, tache_id: "t3", avancement: 70 }]))[0],
  suiviPourValidation(OUVRAGES(), "t3", 0)), null, "tâche pas encore allumée : la ligne en % reste en % (comme avant)");
// Unité déclarée « m2 » = tâche « m² » ; autre unité : signalée, préremplie à 0.
const lM2 = lignesDepuisRapport(rapport("r12", "Paul", [LQ("t1", 4, { unite: "m2" })]))[0];
eq([lM2.unite_declaree, decisionQuantite(lM2, suiviPourValidation(OUVRAGES(), "t1", 0)).validee], ["m²", 4], "« m2 » déclaré = « m² » de la tâche");
const lMl = lignesDepuisRapport(rapport("r13", "Paul", [LQ("t1", 4, { unite: "ml" })]))[0];
eq([decisionQuantite(lMl, suiviPourValidation(OUVRAGES(), "t1", 0)).uniteDifferente, decisionQuantite(lMl, suiviPourValidation(OUVRAGES(), "t1", 0)).validee],
  [true, 0], "autre unité : signalée, préremplie à 0");
// Deux lignes de la même tâche dans un rapport : fusion des quantités.
const fus = buildPointagesRapport({ chantier_id: "ch", ouvrier: "Paul", dateISO: "2026-10-06", rapport_id: "rf", taskLines: [
  { tache_id: "t1", heures: 1, quantite_declaree: 2, quantite_validee: 2, quantite_unite: "m²" },
  { tache_id: "t1", heures: 2, quantite_declaree: 3.5, quantite_validee: 3, quantite_unite: "m²" },
] });
eq([fus.length, fus[0].heures, fus[0].quantite_declaree, fus[0].quantite_validee], [1, 3, 5.5, 5], "même tâche deux fois : heures et quantités additionnées");
// Découpage et bascule.
const [m1, m2] = decouperLigne({ ...lM2, heures: 2 }, "s1");
eq([m1.quantite_declaree, m2.quantite_declaree, m1.heures, m2.heures], [2, 2, 1, 1], "découpage : quantité coupée en deux comme les heures");
eq(ligneBasculee({ ...lM2, remarque: "r" }, { heures: 1, rapport: { id: "x", chantier_id: "c" }, valideur: "B", le: "l" }).remarque, "Posé : 4 m² — r",
  "bascule : la quantité passe en texte");
// Ré-génération Admin : les quantités VALIDÉES sont reprises.
const regen = reporterQuantites(
  [{ tache_id: "t2", heures: 2 }, { tache_id: null, heures: 1 }],
  [{ tache_id: "t2", quantite_declaree: 5, quantite_validee: 3, quantite_unite: "m²" }]);
eq([regen[0].quantite_validee, regen[0].quantite_declaree, "quantite_validee" in regen[1]], [3, 5, false], "ré-génération : quantité validée reprise, rien sur les autres lignes");

// ── 6. Pourcentage strictement inchangé ─────────────────────────────────────
const ancien = rapport("rv1", "Paul", [
  { planifie: "Ossature", tache_id: "t1", phase_id: null, statut: "faite", heures_reelles: 3, avancement: 100, photos: [], remarque: "" },
  { planifie: "Libre", tache_id: null, phase_id: null, statut: "en_cours", heures_reelles: 2, avancement: 20, photos: [], remarque: "x" },
]);
const lAnc = lignesDepuisRapport(ancien);
ok(lAnc.every(l => !("quantite_declaree" in l) && !("photos_apres" in l) && !("photo_apres_manquante" in l)), "rapport existant : lignes identiques à avant");
const ptsAnc = buildPointagesRapport({ chantier_id: "ch", ouvrier: "Paul", dateISO: "2026-10-06", taux: 30, rapport_id: "rv1", taskLines: taskLinesPourPointages(lAnc) });
ok(ptsAnc.every(p => !Object.keys(p).some(k => k.startsWith("quantite"))), "pointages en % : aucun champ de quantité");
eq(Object.keys(ptsAnc[0]).sort(), ["avancement_declare", "chantier_id", "date", "heures", "ouvrier", "phase_id", "phasage_id", "rapport_id", "tache_id", "taux_horaire", "type_pointage", "valide_par"].sort(),
  "pointage en % : exactement les colonnes d'avant");
eq(majTachesQuantite({ ouvrages: OUVRAGES(), lignes: lAnc, sommes: {}, rapportId: "rv1", le: "x" }), {}, "rapport en % : aucune tâche recalculée");

// ── 7. SQL dans PGlite ──────────────────────────────────────────────────────
const racine = fileURLToPath(new URL("..", import.meta.url));
const SQL = readFileSync(join(racine, "sql/202610_quantites_posees.sql"), "utf8");
ok(!/\bupdate\s+public\.|\bdelete\s+from|\binsert\s+into|create\s+policy|drop\s+policy/i.test(SQL), "SQL : aucune donnée modifiée, aucune policy touchée");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create table public.pointages (id serial primary key, tache_id text, heures numeric, avancement_declare integer);
  insert into public.pointages (tache_id, heures, avancement_declare) values ('t1', 2, 50);`);
await db.exec(SQL);
await db.exec(SQL);
nbOk++;
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'pointages' and column_name like 'quantite%' order by 1`)).rows.map(r => r.column_name);
eq(cols, ["quantite_declaree", "quantite_unite", "quantite_validee"], "trois colonnes ajoutées (migration rejouable)");
eq((await db.query(`select quantite_validee, heures, avancement_declare from public.pointages`)).rows, [{ quantite_validee: null, heures: "2", avancement_declare: 50 }],
  "pointage existant intact, colonnes vides");
let refuse = false;
try { await db.query(`insert into public.pointages (tache_id, heures, quantite_validee) values ('t1', 1, -1)`); } catch { refuse = true; }
ok(refuse, "quantité validée négative refusée par la base");
await db.query(`insert into public.pointages (tache_id, heures, quantite_declaree, quantite_validee, quantite_unite) values ('t1', 1, 4, 3.5, 'm²')`);
nbOk++;

console.log(`verif-quantites-posees : ${nbOk} contrôles OK`);
