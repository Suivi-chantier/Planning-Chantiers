#!/usr/bin/env node
// Vérifie les tâches HORS DEVIS (étape 3b, livraison 1 : les calculs).
//
// 1. NON-RÉGRESSION sur un instantané RÉEL ANONYMISÉ de 8 chantiers
//    (scripts/fixtures/hors-devis-instantane.json : 128 ouvrages, 1 231 tâches,
//    1 183 pointages, 863 lignes de commande ; noms remplacés, montants × 0,83,
//    taux horaires fictifs). Tous les calculs touchés (finances du chantier,
//    lots, dérive, avancement, phases, indice de délai, export d'opération,
//    cadences, onglet Phases) doivent redonner EXACTEMENT la référence
//    calculée avec le code d'avant (scripts/fixtures/hors-devis-reference.json,
//    main au 06/10/2026). Aucune tâche existante ne porte hors_devis : aucun
//    chiffre ne doit bouger. Le code peut AJOUTER des champs, jamais en changer.
// 2. TÂCHES MARQUÉES : sur le même instantané, quelques tâches passent hors
//    devis ; elles sortent des dérives, dépassements, % consommés et
//    avancements, et restent dans le coût réel.
//
//   node scripts/verif-hors-devis.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculerTout } from "./verif-hors-devis-calculs.mjs";
import * as CF from "../src/chantierFinance.mjs";
import { qcdDepuisFinance, computeQCD } from "../src/Renovation/qcd.mjs";
import { ouvragesComparablesV1 } from "../src/Renovation/echantillonCadencesV1.mjs";
import { agregerOuvrage } from "../src/Renovation/mesPhasesV1.mjs";
import { normaliserChantier } from "../src/Renovation/operationExportModele.mjs";
import { repartirHeures, repartirHeuresVendues } from "../src/Renovation/repartitionHeuresVendues.mjs";
import { pointsAttentionV1, libellePointAttentionV1 } from "../src/Renovation/pointsAttentionV1.mjs";

const lire = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const FX = lire("./fixtures/hors-devis-instantane.json");
const REF = lire("./fixtures/hors-devis-reference.json");

let nbOk = 0;
const ok = (c, msg) => { assert.ok(c, msg); nbOk++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };

// Toute valeur de la référence doit se retrouver à l'identique (le nouveau
// code peut seulement ajouter des clés). Renvoie le nombre de valeurs comparées.
function inclus(ref, nouv, chemin) {
  if (Array.isArray(ref)) {
    assert.ok(Array.isArray(nouv), `${chemin} : tableau attendu`);
    assert.equal(nouv.length, ref.length, `${chemin} : longueur`);
    return ref.reduce((n, v, i) => n + inclus(v, nouv[i], `${chemin}[${i}]`), 0);
  }
  if (ref && typeof ref === "object") {
    assert.ok(nouv && typeof nouv === "object", `${chemin} : objet attendu`);
    return Object.keys(ref).reduce((n, k) => n + inclus(ref[k], nouv[k], `${chemin}.${k}`), 0);
  }
  assert.deepEqual(nouv, ref, `${chemin} : ${JSON.stringify(nouv)} au lieu de ${JSON.stringify(ref)}`);
  return 1;
}

// ── 1. NON-RÉGRESSION ───────────────────────────────────────────────────────
const NOUV = calculerTout(FX);
const { _source, ...refCalculs } = REF;
const nbValeurs = inclus(refCalculs, NOUV, "reference");
ok(nbValeurs > 20000, `référence riche (${nbValeurs} valeurs comparées)`);
ok(FX.phasages.every(ph => ph.ouvrages.every(o => o.taches.every(t => !("hors_devis" in t)))), "instantané : aucune tâche marquée hors devis");
console.log(`  non-régression : ${nbValeurs} valeurs identiques à la référence (8 chantiers réels anonymisés)`);

// ── 2. TÂCHES MARQUÉES HORS DEVIS (sur le même instantané) ──────────────────
// Chantier C1 : ouvrage Électricité « kvftsmsvuto » (30 h vendues) — une tâche
// terminée de 4 h et une tâche à 0 % passent hors devis ; ouvrage Menuiserie
// « 6si40ctyies » — sa tâche à 0 % passe hors devis.
const MARQUEES = new Set([
  "cec2d48f-a40b-4dd4-a905-ec89f4144f13", // 4 h pointées, 100 %
  "95e3f6c6-7fbc-423b-b414-6347161b23a0", // 0 h, 0 %
  "f4ad2bee-c8b5-4bf7-b3c4-e714f35b89a6", // 0 h, 0 %
]);
const marquer = (fx) => {
  const c = JSON.parse(JSON.stringify(fx));
  c.phasages.forEach(ph => ph.ouvrages.forEach(o => o.taches.forEach(t => { if (MARQUEES.has(t.id)) t.hors_devis = true; })));
  return c;
};
// Le même phasage SANS les tâches marquées : calcul d'avant (aucun indicateur).
const sansMarquees = (ph) => ({ ...ph, ouvrages: ph.ouvrages.map(o => ({ ...o, taches: o.taches.filter(t => !MARQUEES.has(t.id)) })) });

const FXM = marquer(FX);
const phM = FXM.phasages.find(p => p.chantier_id === "C1");
const ph0 = FX.phasages.find(p => p.chantier_id === "C1");
const pts = FX.pointages.filter(p => p.chantier_id === "C1");
const ppt = CF.indexPointagesParTache(pts);
const cl = FX.commandeLignes.filter(l => l.chantier_id === "C1");
const entree = (phasage) => ({ phasage, pointages: pts, commandeLignes: cl, tauxHoraires: {}, tauxMOPrev: FX.tauxMOPrev, lots: FX.lots, pctFacture: 0.3, materiauxById: {} });
const finM = CF.computeChantierFinance(entree(phM));
const fin0 = CF.computeChantierFinance(entree(ph0));
const finSans = CF.computeChantierFinance(entree(sansMarquees(ph0)));
const oElec = phM.ouvrages.find(o => o.id === "kvftsmsvuto");
const oMenu = phM.ouvrages.find(o => o.id === "6si40ctyies");
const hMarquees = [...MARQUEES].reduce((s, id) => s + CF.tacheHeuresReelles(oElec.taches.concat(oMenu.taches).find(t => t.id === id), ppt), 0);
eq(hMarquees, 4, "les tâches marquées portent 4 h pointées");

// Coûts : rien ne bouge (c'est un coût réel).
for (const k of ["heuresReellesTotalChantier", "heuresReellesChantier", "coutMOChantier", "coutMOTotalChantier", "fgChantier", "margeChantier", "margePctChantier", "coutMatChantier"]) {
  eq(finM.brut[k], fin0.brut[k], `coût / total inchangé : ${k}`);
}
eq(finM.moReel.valeur, fin0.moReel.valeur, "coût MO réel inchangé");
// Heures hors devis à part, comparables = total − hors devis.
eq(finM.brut.heuresHorsDevisChantier, 4, "4 h hors devis au niveau du chantier");
eq(finM.brut.heuresComparablesChantier, fin0.brut.heuresReellesTotalChantier - 4, "heures comparables = total − hors devis");
eq(fin0.brut.heuresHorsDevisChantier, 0, "sans marque : 0 h hors devis");
// « Heures totales » : valeur inchangée, % sur les comparables, mention « dont ».
eq(finM.heuresReelles.valeurTexte, fin0.heuresReelles.valeurTexte, "« Heures totales » : valeur affichée inchangée");
eq(finM.heuresReelles.sousLabel,
  `${Math.round((finM.brut.heuresComparablesChantier / finM.brut.heuresVenduesChantier) * 100)}% consommées · dont 4h hors devis`,
  "% consommées sur les heures comparables + « dont 4 h hors devis »");
ok(finM.heuresReelles.ventilation.some(r => / \+ 4h hors devis$/.test(r.right)), "détail par ouvrage : « + 4 h hors devis » à part");
// Lot Électricité : heures comparées sans la tâche hors devis ; avancement sans les tâches hors devis.
const lotM = finM.lots.find(l => l.id === "electricite"), lot0 = fin0.lots.find(l => l.id === "electricite"), lotSans = finSans.lots.find(l => l.id === "electricite");
eq(lotM.heuresReelles, lot0.heuresReelles - 4, "lot : heures comparées sans les 4 h hors devis");
eq(lotM.heuresHorsDevis, 4, "lot : 4 h hors devis à part");
eq(lotM.heuresVendues, lot0.heuresVendues, "lot : heures vendues inchangées");
eq(lotM.avancement, lotSans.avancement, "lot : avancement calculé sans les tâches hors devis");
eq(lotM.ratioDerive, (lotM.heuresReelles / lotM.heuresVendues) / (lotM.avancement / 100), "lot : dérive sur les heures comparables");
ok(lotM.avancement > lot0.avancement, `lot : l'avancement ne baisse plus à cause d'une tâche hors devis à 0 % (${lot0.avancement} → ${lotM.avancement} %)`);
const autresLots = (w) => w.code === "derive_lot" && w.lotId !== "electricite" && w.lotId !== "menuiserie";
eq(finM.warnings.filter(autresLots), fin0.warnings.filter(autresLots), "alertes des lots sans tâche marquée : inchangées");
eq(finM.lots.filter(l => l.id !== "electricite" && l.id !== "menuiserie"), fin0.lots.filter(l => l.id !== "electricite" && l.id !== "menuiserie"), "lots sans tâche marquée : chiffres inchangés");
// Lot Menuiserie : la tâche hors devis à 0 % ne tire plus l'avancement vers le bas.
const menuM = finM.lots.find(l => l.id === "menuiserie"), menu0 = fin0.lots.find(l => l.id === "menuiserie");
eq([menu0.avancement, menu0.ratioDerive, menuM.avancement, menuM.ratioDerive], [80, 2.5, 100, 2], "lot Menuiserie : 80 % / ×2,50 → 100 % / ×2,00");
const wElec = finM.warnings.find(w => w.code === "derive_lot" && w.lotId === "electricite");
if (wElec) ok(/\+ 4h hors devis non comptées/.test(wElec.message), "alerte de dérive : les heures hors devis sont citées");
// Lot « Sans lot » (où vit « Divers / hors devis ») : inchangé — option A.
eq(finM.lots.find(l => l.id === "_orphans"), fin0.lots.find(l => l.id === "_orphans"), "« Divers / hors devis » non marqué : compté comme avant");
// Avancement d'ouvrage, de chantier, de groupe chrono.
eq(CF.avancementOuvrage(oElec), CF.avancementOuvrage(sansMarquees(ph0).ouvrages.find(o => o.id === "kvftsmsvuto")), "avancement d'ouvrage sans les tâches hors devis");
eq(CF.avancementOuvrage(oMenu), 100, "ouvrage Menuiserie : 100 % (la tâche hors devis à 0 % ne compte plus)");
eq(finM.brut.avancementChantier, finSans.brut.avancementChantier, "avancement du chantier sans les tâches hors devis");
const gM = CF.statsGroupeChrono("eydp1h8c", phM.ouvrages), gSans = CF.statsGroupeChrono("eydp1h8c", sansMarquees(ph0).ouvrages), g0 = CF.statsGroupeChrono("eydp1h8c", ph0.ouvrages);
eq([gM.avancement, gM.termine], [gSans.avancement, gSans.termine], "phase chrono : avancement et « terminé » sans les tâches hors devis");
eq(gM.count, g0.count, "phase chrono : le nombre de tâches compte toujours les tâches hors devis");
const toutes = { taches: [{ hors_devis: true, avancement: 40 }, { hors_devis: true, avancement: 60 }] };
eq(CF.avancementOuvrage(toutes), 50, "ouvrage 100 % hors devis : garde son propre avancement");
// Indice de délai (bandeau Qualité / Coût / Délai) : heures comparables.
eq(qcdDepuisFinance(finM.brut).delai, computeQCD({
  heuresReelles: finM.brut.heuresComparablesChantier, heuresVendues: finM.brut.heuresVenduesChantier,
  avancement: finM.brut.avancementChantier / 100,
}).delai, "indice de délai sur les heures comparables");
// Export d'opération.
const exM = normaliserChantier({ chantier: { id: "C1", nom: "Chantier 1" }, phasage: phM, pointages: pts, finance: finM, lots: FX.lots, tauxHoraires: {}, materiauxById: {}, ratiosById: {}, equipeParGroupeType: {}, sources: {}, aujourdhui: "2026-10-06" });
const exO = (exM.ouvrages || []).find(o => o.id === "kvftsmsvuto");
const ex0 = (normaliserChantier({ chantier: { id: "C1", nom: "Chantier 1" }, phasage: ph0, pointages: pts, finance: fin0, lots: FX.lots, tauxHoraires: {}, materiauxById: {}, ratiosById: {}, equipeParGroupeType: {}, sources: {}, aujourdhui: "2026-10-06" }).ouvrages || []).find(o => o.id === "kvftsmsvuto");
eq([exO.heuresReelles, exO.heuresHorsDevis, exO.coutMOReel], [ex0.heuresReelles - 4, 4, ex0.coutMOReel], "export : heures comparables, hors devis à part, coût MO inchangé");
ok(exO.taches.find(t => t.id === "cec2d48f-a40b-4dd4-a905-ec89f4144f13").horsDevis === true, "export : tâche marquée « hors devis »");
// Cadences : la tâche hors devis ne fausse ni « terminé » ni les heures.
const cadM = ouvragesComparablesV1(FXM.phasages, FXM.pointages).find(o => o.ouvrageId === "kvftsmsvuto");
const cad0 = ouvragesComparablesV1(FX.phasages, FX.pointages).find(o => o.ouvrageId === "kvftsmsvuto");
eq(cad0, undefined, "cadences, avant : ouvrage non terminé (une tâche à 0 %) → écarté");
// Les cadences lisent le registre SEUL (sans repli legacy) : même règle ici.
const oElecSans = sansMarquees(ph0).ouvrages.find(o => o.id === "kvftsmsvuto");
const registreSans = oElecSans.taches.reduce((s, t) => s + CF.sumHeures(CF.tachePointages(t, ppt)), 0);
const venduesSans = oElecSans.taches.reduce((s, t) => s + CF.tacheHeuresVendues(t), 0);
eq(cadM && [cadM.heuresVendues, cadM.heuresReelles], [Math.round(venduesSans * 10) / 10, Math.round(registreSans * 10) / 10],
  "cadences, après : ouvrage terminé hors tâches hors devis, sans leurs heures vendues ni réelles");
// Répartition des heures vendues (Phasage V2) : jamais sur une tâche hors devis.
const tachesRep = [{ ratio: 1 }, { ratio: 1, hors_devis: true, heures_vendues: null }, { ratio: 2 }];
eq(repartirHeuresVendues(30, tachesRep), [10, null, 20], "répartition : la tâche hors devis ne reçoit rien");
const sansMarque = [{ ratio: 1 }, { ratio: 1 }, { ratio: 2 }];
eq(repartirHeuresVendues(30, sansMarque), repartirHeures(30, sansMarque), "répartition sans tâche hors devis : identique à avant");
// Onglet Phases : seul l'indicateur EXPLICITE retire des totaux.
const ouvPhases = (marque) => agregerOuvrage({ id: "o", libelle: "O", heures_vendues_ouvrage: 10, ouvrage_complet: true, taches: [
  { id: "a", nom: "A", avancement: 50, heures_vendues: 6, heures_validees: 4, heures_en_attente: 1, heures_estimees: 6 },
  { id: "b", nom: "B", avancement: 0, heures_vendues: 4, heures_validees: 3, heures_en_attente: 0, heures_estimees: 4, hors_devis: true, ...(marque ? { hors_devis_marque: true } : {}) },
] });
const pDevine = ouvPhases(false), pMarque = ouvPhases(true);
eq([pDevine.validees, pDevine.attente, pDevine.heuresHorsDevis, pDevine.avancement], [7, 1, 0, 30], "Phases : « hors devis » deviné (Divers) → totaux et avancement comme avant");
eq([pMarque.validees, pMarque.attente, pMarque.heuresHorsDevis, pMarque.avancement], [4, 1, 3, 50], "Phases : tâche marquée → hors des totaux comparés et de l'avancement, 3 h à part");
// Alerte « consommation sans avancement » : « dont X h hors devis ».
const snap = (av, h, marge, lots) => ({ chantier_id: "C1", chantier_nom: "Chantier 1", avancement: av, heures_reelles: h, marge, date_snapshot: "2026-10-02", ...(lots ? { lots } : {}) });
const pa = (lotsCourants) => pointsAttentionV1({ snapshotsCourants: [snap(50, 140, 1000, lotsCourants)], snapshotsPrecedents: [snap(50, 100, 3000, [{ id: "electricite", heuresReelles: 10 }])] }).lignes[0];
const sansHD = pa([{ id: "electricite", heuresReelles: 20 }]);
const avecHD = pa([{ id: "electricite", heuresReelles: 20, heuresHorsDevis: 12 }]);
ok(sansHD && avecHD, "alerte déclenchée dans les deux cas (toutes les heures comptent)");
eq([sansHD.heuresAjoutees, avecHD.heuresAjoutees], [40, 40], "la consommation compte toutes les heures, hors devis comprises");
ok(!/hors devis/.test(sansHD.explication) && !("heuresHorsDevisAjoutees" in sansHD), "sans heures hors devis : texte inchangé");
ok(/\(dont 12 h hors devis\)/.test(avecHD.explication) && /\(dont 12 h hors devis\)/.test(libellePointAttentionV1(avecHD)), "avec : « dont 12 h hors devis » dans l'explication et le libellé");

console.log(`verif-hors-devis : ${nbOk} contrôles OK`);
