#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Vérification — « Retours du terrain » (page bureau) et « À replanifier »
// (bandeau du planning). Données FICTIVES de test.
//
//   node scripts/verif-retours-terrain.mjs
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { retoursTerrain, isoDepuisDateRapport, indexTachesPhasages } from "../src/Renovation/retoursTerrainV1.mjs";
import { tachesAReplanifier, dateDeCellule, celluleDeDate, semainesEntre, avancementsDesPhasages } from "../src/Renovation/replanificationV1.mjs";

let nbOk = 0;
const ok = (c, m) => { assert.ok(c, m); nbOk++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };

// ── Dates ───────────────────────────────────────────────────────────────────
eq([isoDepuisDateRapport("12/10/2026"), isoDepuisDateRapport("2026-10-12T18:00"), isoDepuisDateRapport("5/1/2026"), isoDepuisDateRapport("hier")],
  ["2026-10-12", "2026-10-12", "2026-01-05", null], "date de rapport : écriture française ou ISO");
eq([dateDeCellule("2026-W41", "Lundi"), dateDeCellule("2026-W41", "Vendredi"), dateDeCellule("2026-W01", "Lundi"), dateDeCellule("x", "Lundi")],
  ["2026-10-05", "2026-10-09", "2025-12-29", null], "case du planning → date (semaine ISO)");
eq([celluleDeDate("2026-10-05"), celluleDeDate("2026-10-11"), celluleDeDate("2025-12-29"), celluleDeDate("2027-01-01")],
  [{ weekId: "2026-W41", jour: "Lundi" }, { weekId: "2026-W41", jour: "Dimanche" }, { weekId: "2026-W01", jour: "Lundi" }, { weekId: "2026-W53", jour: "Vendredi" }],
  "date → case (y compris semaine 53 de 2026)");
eq(semainesEntre("2026-10-01", "2026-10-20"), ["2026-W40", "2026-W41", "2026-W42", "2026-W43"], "semaines couvertes");

// ── Retours du terrain ──────────────────────────────────────────────────────
const PHASAGES = [{ chantier_id: "chA", ouvrages: [
  { libelle: "Doublage BA13", taches: [{ id: "t1", nom: "Plaques" }, { id: "nt-r2-1", nom: "Niche", hors_devis: true }] },
  { libelle: "Peinture", taches: [{ id: "t2", nom: "Peinture palier" }] },
] }];
eq(indexTachesPhasages(PHASAGES).get("t2").ouvrage, "Peinture", "tâche → ouvrage");
const RAPPORTS = [
  { id: "r1", ouvrier: "Paul", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "12/10/2026", statut: "valide", formulaire_version: "v2", taches: [
    { planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 4, motif_depassement: "devis_sous_estime", remarque: "plus long",
      depassement: { heures_vendues: 10, heures_avant: 8, heures_jour: 4 } },
    { planifie: "Peinture palier", tache_id: "t2", statut: "non_faite", motif: "attente_sechage", remarque: "pas sec" },
  ] },
  { id: "r2", ouvrier: "Kev", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "2026-10-13", statut: "valide", formulaire_version: "v2", taches: [
    { planifie: "Plaques", tache_id: "t1", statut: "faite", heures_reelles: 2, motif_depassement: "devis_sous_estime" },
    { planifie: "Niche", tache_id: null, origine: "nouvelle", proposition: { ouvrage_libelle: "Doublage BA13", nature: "demande_client", demandeur: "Mme X" } },
    { planifie: "Seuil", tache_id: "t9", statut: "en_cours", bloque: true, motif: "attente_materiel" },
  ] },
  { id: "r3", ouvrier: "Hamed", chantier_id: "chB", chantier_nom: "Chantier B", date_rapport: "14/10/2026", statut: "en_attente", formulaire_version: null, taches: [
    { planifie: "Dépose", tache_id: "x1", statut: "non_faite", remarque: "client absent" },
    { planifie: "Placard", tache_id: null, origine: "nouvelle", proposition: { ouvrage_libelle: "", nature: "imprevu" } },
  ] },
  { id: "r4", ouvrier: "Paul", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "20/10/2026", statut: "valide", formulaire_version: "v2", taches: [
    { planifie: "Plaques", tache_id: "t1", motif_depassement: "reprise" },
  ] },
];
const res = retoursTerrain({ rapports: RAPPORTS, phasages: PHASAGES, debut: "2026-10-12", fin: "2026-10-18" });
eq(res.depassements.map(d => [d.rapport_id, d.motif_label, d.ouvrage, d.releve]),
  [["r2", "Devis sous-estimé", "Doublage BA13", null], ["r1", "Devis sous-estimé", "Doublage BA13", "12 h sur 10 h prévues"]],
  "dépassements de la semaine (plus récent d'abord), ouvrage retrouvé, relevé figé à la saisie");
ok(!res.depassements.some(d => d.rapport_id === "r4"), "hors de la semaine : ignoré");
eq(res.depassementsParMotif, [{ cle: "devis_sous_estime", label: "Devis sous-estimé", nb: 2 }], "cumul par motif");
eq(res.depassementsParOuvrage, [{ cle: "Chantier A › Doublage BA13", label: "Chantier A › Doublage BA13", nb: 2 }], "signalé plusieurs fois sur le même ouvrage");
eq(res.nonFaites.map(n => [n.tache, n.statut_label, n.motif_label, n.precision, n.valide]),
  [["Dépose", "Non faite", "Ancien formulaire (pas de motif)", "client absent", false],
   ["Seuil", "Bloqué", "Attente de matériel", "", true],
   ["Peinture palier", "Pas commencé", "Attente de séchage", "pas sec", true]],
  "pas commencé / bloqué (nouveau formulaire) et non faite (ancien), avec motif et précision");
eq(res.nouvelles.map(n => [n.tache, n.nature_label, n.demandeur, n.devenir, n.devenir_label]),
  [["Placard", "Imprévu", null, "en_attente", "En attente de validation"],
   ["Niche", "Demande du client", "Mme X", "creee", "Créée (hors devis)"]],
  "nouvelles tâches et leur devenir (créée retrouvée par son identifiant nt-…)");
eq(retoursTerrain({ rapports: RAPPORTS, phasages: PHASAGES, debut: "2026-10-12", fin: "2026-10-18", chantierId: "chB" }).depassements, [],
  "filtre par chantier");
const sansPhasage = retoursTerrain({ rapports: RAPPORTS, phasages: [], debut: "2026-10-12", fin: "2026-10-18" });
eq([sansPhasage.depassements[0].ouvrage, sansPhasage.nouvelles[1].devenir], [null, "rattachee"], "sans phasage : ouvrage inconnu (vide), jamais inventé");

// ── À replanifier ───────────────────────────────────────────────────────────
const AUJ = "2026-10-14";
const R = (id, ouvrier, date, statut, lignes) => ({ id, ouvrier, chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: date, statut, taches: lignes });
const L = (tache_id, extra) => ({ planifie: `Tâche ${tache_id}`, tache_id, heures_reelles: 0, ...extra });
const rapportsR = [
  R("a", "Paul", "12/10/2026", "valide", [
    L("p1", { statut: "non_faite", motif: "priorite_changee", remarque: "urgence ailleurs" }),   // sans suite → à replanifier
    L("p2", { statut: "non_faite", motif: "priorite_changee" }),                                 // replanifiée à venir
    L("p3", { statut: "non_faite", motif: "manque_de_temps" }),                                  // faite après (heures)
    L("p4", { statut: "non_faite", motif: "fait_par_collegue" }),                                 // fait par un collègue
    L("p5", { statut: "en_cours", bloque: true, heures_reelles: 2, motif: "attente_materiel" }),  // bloqué (avec heures ce jour-là)
    L("p6", { statut: "non_faite", motif: "attente_sechage" }),                                  // replanifiée… mais date passée
  ]),
  R("b", "Kev", "12/10/2026", "valide", [L("p1", { statut: "non_faite" })]),                     // même tâche, même jour : ouvriers fusionnés
  R("c", "Kev", "13/10/2026", "valide", [L("p3", { statut: "faite", heures_reelles: 3 })]),
  R("d", "Hamed", "13/10/2026", "en_attente", [L("p7", { statut: "non_faite", motif: "priorite_changee" })]), // rapport pas validé : pas de signalement
  R("e", "Paul", "2026-09-01", "valide", [L("p8", { statut: "non_faite" })]),                    // trop ancien
];
const cellulesR = [
  { week_id: "2026-W42", jour: "Lundi", chantier_id: "chA", taches: [{ tache_id: "p1" }, { tache_id: "p2" }, { tache_id: "p6" }] },  // jour du signalement
  { week_id: "2026-W42", jour: "Jeudi", chantier_id: "chA", taches: [{ tache_id: "p2" }] },     // 15/10 : à venir → replanifiée
  { week_id: "2026-W42", jour: "Mardi", chantier_id: "chA", taches: [{ tache_id: "p6" }] },     // 13/10 : passée → toujours à replanifier
];
const items = tachesAReplanifier({ rapports: rapportsR, cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-09-23" });
eq(items.map(i => i.tache_id).sort(), ["p1", "p5", "p6"], "à replanifier : sans suite (p1), bloquée même avec des heures ce jour-là (p5), nouvelle date déjà passée (p6)");
const p1 = items.find(i => i.tache_id === "p1");
eq([p1.ouvriers, p1.statut_label, p1.motifs.map(m => m.label), p1.weekId, p1.jour], [["Paul", "Kev"], "Pas commencé", ["Priorité changée"], "2026-W42", "Lundi"],
  "même tâche signalée par deux ouvriers le même jour : une seule ligne ; case du planning pour y aller");
ok(!items.some(i => i.tache_id === "p2"), "replanifiée à une date à venir : réglée");
ok(!items.some(i => i.tache_id === "p3"), "des heures déclarées après : réglée");
ok(!items.some(i => i.tache_id === "p4"), "« Fait par un collègue » : rien à replanifier");
ok(!items.some(i => i.tache_id === "p7"), "rapport pas encore validé : pas de signalement");
ok(!items.some(i => i.tache_id === "p8"), "signalement trop ancien : ignoré");
eq(items.find(i => i.tache_id === "p5").statut_label, "Bloqué", "bloqué signalé comme tel");
eq(tachesAReplanifier({ rapports: rapportsR, cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-09-23" }).map(i => i.date),
  ["2026-10-12", "2026-10-12", "2026-10-12"], "triées de la plus ancienne à la plus récente");
// Un signalement plus récent remplace l'ancien.
const plusRecent = tachesAReplanifier({ rapports: [...rapportsR, R("f", "Paul", "14/10/2026", "valide", [L("p1", { statut: "non_faite", motif: "info_manquante" })])],
  cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-09-23" }).find(i => i.tache_id === "p1");
eq([plusRecent.date, plusRecent.motifs.map(m => m.label), plusRecent.ouvriers], ["2026-10-14", ["Information manquante"], ["Paul"]], "dernier signalement retenu");
eq(tachesAReplanifier({ rapports: [], cellules: [], aujourdhuiISO: AUJ }), [], "rien de signalé : liste vide");
// Semaine affichée : seuls ses signalements ; les heures déclarées APRÈS
// la semaine règlent toujours la tâche.
const semaine = tachesAReplanifier({ rapports: [...rapportsR, R("g", "Paul", "06/10/2026", "valide", [L("p9", { statut: "non_faite" })])],
  cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-10-05", jusquaISO: "2026-10-11" });
eq(semaine.map(i => i.tache_id), ["p9"], "semaine du 05/10 : seulement la tâche signalée cette semaine-là");
eq(tachesAReplanifier({ rapports: [...rapportsR, R("h", "Paul", "06/10/2026", "valide", [L("p3", { statut: "non_faite" })])],
  cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-10-05", jusquaISO: "2026-10-11" }).map(i => i.tache_id), [],
  "signalée la semaine du 05/10 puis faite le 13/10 : réglée");

// Tâche terminée depuis dans le phasage (100 %) : plus à replanifier.
const avs = avancementsDesPhasages([{ ouvrages: [{ taches: [{ id: "p1", avancement: 100 }, { id: "p6", avancement: "40" }] }] }]);
eq(avs, { p1: 100, p6: 40 }, "avancements lus dans le phasage");
eq(tachesAReplanifier({ rapports: rapportsR, cellules: cellulesR, aujourdhuiISO: AUJ, depuisISO: "2026-09-23", avancements: avs }).map(i => i.tache_id).sort(),
  ["p5", "p6"], "tâche à 100 % au phasage : retirée (p1) ; à 40 % : gardée (p6)");

console.log(`verif-retours-terrain : ${nbOk} contrôles OK`);
