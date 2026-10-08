// Vérifie « Planifier une opération entière » (planningOperationV1.mjs).
// Exemple issu des tests, données fictives : chantiers C1/C2 (opération OP1),
// chantier X hors opération, ouvriers R1 (réseaux) et R2 (placo).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORIGINE_LIGNE_OPERATION,
  appliquerOrdreLotsV1,
  construirePlanEcritureOperationV1,
  construirePlanRetraitOperationV1,
  dateDepuisCelluleV1,
  datesPrevuesApresPlacementV1,
  lignesPoseesParOperationV1,
  lotsParChantierV1,
  occupationAutresChantiersV1,
  premierJourOuvreV1,
  resumerSimulationOperationV1,
  semainesSimulationV1,
  tachesParChantierV1,
  simulerOperationJusquAuBoutV1,
  simulerOperationV1,
  verifierCellulesAvantEcritureV1,
} from "../src/Renovation/planningOperationV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningOperationV1.mjs"), "utf8");
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "module pur : aucun import Supabase");
assert.equal(/Date\.now\s*\(|new Date\(\s*\)/.test(source), false, "module pur : aucune horloge");
assert.equal(/\.from\s*\(\s*["']|\.rpc\s*\(|\.insert\s*\(|\.upsert\s*\(/.test(source), false, "module pur : aucune écriture");
const facade = await readFile(resolve(here, "../src/Renovation/planningOperationV1.js"), "utf8");
assert.match(facade, /export \* from "\.\/planningOperationV1\.mjs"/, "façade .js pour le front");

const res = (id) => ({ id, nom: id, nom_planning: id, kind: "personne", actif: true, capacite_facteur: 1 });
const tache = (id, groupe, heures, extra = {}) => ({
  id, nom: `Tâche ${id}`, heures_vendues: heures, avancement: 0,
  chrono_groupe_id: groupe, chrono_ordre: 0, ouvriers: [], predecesseurs: [], ...extra,
});
const GROUPES = [
  { id: "G_DEM", ordre: 10, groupe_type_id: "gt_demolition" },
  { id: "G_ELEC", ordre: 70, groupe_type_id: "gt_reseau_elec" },
  { id: "G_PLACO", ordre: 80, groupe_type_id: "gt_laine_placo" },
  { id: "G_PEINT", ordre: 90, groupe_type_id: "gt_peinture" },
  { id: "G_APP", ordre: 110, groupe_type_id: "gt_appareillage_elec" },
];
const phasage = (chantier, taches) => ({
  id: `PH-${chantier}`, chantier_id: chantier, revision: 3,
  ouvrages: [{ id: `O-${chantier}`, code_ouvrage: "X-001", taches }],
  plan_travaux: { meta: { chrono_groupes: GROUPES } },
});
const ligne = (uid, tacheId, duree, ouvriers, extra = {}) => ({ id: `L-${uid}`, allocation_uid: uid, tache_id: tacheId, text: tacheId || "Réunion", duree, ouvriers, ...extra });
const cellule = (week, jour, chantier, lignes, extra = {}) => ({
  id: `CELL-${week}-${jour}-${chantier}`, week_id: week, chantier_id: chantier, jour,
  planifie: lignes.map(l => l.text).join("\n"), reel: "", ouvriers: [...new Set(lignes.flatMap(l => l.ouvriers || []))], vehicules: [], taches: lignes, ...extra,
});

// 2026-09-07 = lundi (semaine 2026-W37).
const START = "2026-09-07";
const snapshot = (over = {}) => ({
  phasages: [
    phasage("C1", [
      tache("dem", "G_DEM", 4),
      tache("elec", "G_ELEC", 6),
      tache("placo", "G_PLACO", 20),
      tache("app", "G_APP", 3),
    ]),
    phasage("C2", [tache("elec2", "G_ELEC", 3)]),
    phasage("X", [tache("x1", "G_ELEC", 50)]),
  ],
  chantiers: [
    { id: "C1", nom: "Logement 1", operation_id: "OP1" },
    { id: "C2", nom: "Logement 2", operation_id: "OP1" },
    { id: "C3", nom: "Logement terminé", operation_id: "OP1", statut: "termine" },
    { id: "X", nom: "Autre chantier" },
  ],
  cellules: [
    // R1 est déjà pris toute la journée du lundi sur le chantier X.
    cellule("2026-W37", "Lundi", "X", [ligne("X-A", "x1", 8, ["R1"])]),
  ],
  ressources: [res("R1"), res("R2")],
  evenementsRessources: [],
  contraintes: [],
  groupesTypes: [
    { id: "gt_demolition", nom: "Démolition", ordre: 10, equipe_id: "EQ_EXT" },
    { id: "gt_reseau_elec", nom: "Passage réseau élec", ordre: 70, equipe_id: "EQ_RES" },
    { id: "gt_laine_placo", nom: "Laine / Placo", ordre: 80, equipe_id: "EQ_PLACO" },
    { id: "gt_peinture", nom: "Peinture", ordre: 90, equipe_id: "EQ_PLACO" },
    { id: "gt_appareillage_elec", nom: "Appareillage élec", ordre: 110, equipe_id: "EQ_RES" },
  ],
  equipes: [
    { id: "EQ_EXT", nom: "Externe", externe: true, membres: [] },
    { id: "EQ_RES", nom: "Réseaux", responsable: "R1", membres: [] },
    { id: "EQ_PLACO", nom: "Placo", responsable: "R2", membres: [] },
  ],
  ...over,
});

// 1. Dates utilitaires.
assert.equal(dateDepuisCelluleV1("2026-W37", "Lundi"), "2026-09-07");
assert.equal(dateDepuisCelluleV1("2026-W37", "Vendredi"), "2026-09-11");
assert.equal(dateDepuisCelluleV1("2027-W01", "Lundi"), "2027-01-04");
assert.equal(premierJourOuvreV1("2026-09-12"), "2026-09-14", "samedi → lundi suivant");
assert.equal(premierJourOuvreV1("2026-09-09"), "2026-09-09");

// 2. Simulation : seuls les chantiers de l'opération (non terminés).
const sim = simulerOperationV1({ snapshot: snapshot(), operationId: "OP1", startDate: START, horizonDays: 42 });
assert.deepEqual(sim.chantiers.map(c => c.id), ["C1", "C2"]);
const allocs = sim.proposition.allocations_proposees;
assert.ok(allocs.length > 0);
assert.ok(allocs.every(a => a.chantier_id === "C1" || a.chantier_id === "C2"), "aucune allocation hors opération");
assert.ok(!allocs.some(a => a.travail_id?.startsWith("X::")), "le chantier X n'est jamais replanifié");

// 3. Temps déjà pris ailleurs : R1 n'est pas utilisé le lundi sur l'opération.
assert.ok(!allocs.some(a => a.date === "2026-09-07" && a.resource_ids.includes("R1")), "R1 occupé sur X le lundi");
const occ = occupationAutresChantiersV1({ cellules: snapshot().cellules, idsOperation: ["C1", "C2"], ressources: snapshot().ressources, chantiers: snapshot().chantiers, startDate: START });
assert.equal(occ.audit.lignes_comptees, 1);
assert.equal(occ.audit.heures_reservees, 8);
const occAvant = occupationAutresChantiersV1({ cellules: snapshot().cellules, idsOperation: ["C1", "C2"], ressources: snapshot().ressources, chantiers: snapshot().chantiers, startDate: "2026-09-08" });
assert.equal(occAvant.audit.lignes_comptees, 0, "une ligne avant la date de démarrage ne compte pas");

// 4. Ordre des lots : placo après réseaux, appareillage après placo, dans le même logement.
const jours = id => allocs.filter(a => a.tache_id === id).map(a => a.date).sort();
const fin = id => jours(id).at(-1);
const debut = id => jours(id)[0];
assert.ok(debut("placo") >= fin("elec"), "placo au plus tôt le jour où les réseaux finissent (moteur à la journée)");
assert.ok(debut("app") >= fin("placo"), "appareillage au plus tôt le jour où le placo finit");
// Sans ordre des lots, les prédécesseurs vides du phasage laissent l'appareillage partir tôt.
const libre = simulerOperationV1({ snapshot: snapshot(), operationId: "OP1", startDate: START, horizonDays: 42, ordreLots: null });
const debutLibre = libre.proposition.allocations_proposees.filter(a => a.tache_id === "app").map(a => a.date).sort()[0];
const finPlacoLibre = libre.proposition.allocations_proposees.filter(a => a.tache_id === "placo").map(a => a.date).sort().at(-1);
assert.ok(debutLibre <= finPlacoLibre, "sans la règle, rien n'impose l'ordre (preuve que la règle agit)");
assert.equal(sim.ordre_lots.actif, true);
assert.equal(libre.ordre_lots.actif, false);
// La règle ne traverse pas les logements : elec2 (C2) n'attend rien de C1.
{
  const out = appliquerOrdreLotsV1([
    { id: "C1::a", chantier_id: "C1", groupe_type_id: "gt_reseau_elec", predecesseur_ids: [] },
    { id: "C2::b", chantier_id: "C2", groupe_type_id: "gt_laine_placo", predecesseur_ids: [] },
    { id: "C2::c", chantier_id: "C2", groupe_type_id: "gt_appareillage_elec", predecesseur_ids: ["C2::z"] },
  ]);
  assert.deepEqual(out.travaux[1].predecesseur_ids, [], "pas de lien entre logements");
  assert.deepEqual(out.travaux[2].predecesseur_ids, ["C2::z", "C2::b"], "transitif via peinture absente, prédécesseurs du phasage gardés");
}

// 5. La démolition externe est écartée, visible, et ne bloque pas.
const resume = resumerSimulationOperationV1(sim);
assert.equal(resume.ecartees.length, 1);
assert.equal(resume.ecartees[0].nom, "Tâche dem");
assert.equal(resume.non_places.length, 0);
const c1 = resume.chantiers.find(c => c.chantier_id === "C1");
assert.equal(c1.complet, false, "une tâche écartée = fin complète inconnue");
assert.equal(c1.fin, null, "jamais une fin qui n'en est pas une");
assert.equal(c1.travail_moteur_place, true);
assert.equal(c1.dernier_jour_place, fin("app"));
const c2 = resume.chantiers.find(c => c.chantier_id === "C2");
assert.equal(c2.complet, true);
assert.equal(c2.fin, fin("elec2"));
assert.equal(resume.fin, null);
assert.equal(resume.heures_placees, resume.heures_a_placer);
const lots = lotsParChantierV1(sim, snapshot().groupesTypes);
assert.deepEqual(lots.C1.map(l => l.nom), ["Passage réseau élec", "Laine / Placo", "Appareillage élec"]);

// 5 bis. Aperçus avant écriture : mêmes allocations, rien d'inventé.
{
  const tp = tachesParChantierV1(sim, snapshot().groupesTypes);
  assert.deepEqual(tp.C1.map(t => t.tache_id), ["elec", "placo", "app"], "ordre des lots, puis premier jour");
  assert.ok(tp.C1.every(t => t.placee && t.dates.length === t.jours && t.debut === t.dates[0] && t.fin === t.dates.at(-1)));
  assert.equal(tp.C1[0].ouvrage, "X-001");
  assert.equal(tp.C1.find(t => t.tache_id === "placo").heures_placees, 20);
  const sem = semainesSimulationV1(sim);
  assert.equal(sem[0].week_id, "2026-W37");
  assert.deepEqual(sem[0].jours.map(j => j.date), ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
  const lignes = sem.flatMap(w => Object.values(w.cellules).flatMap(c => Object.values(c).flat()));
  assert.equal(lignes.length, allocs.length, "une ligne d'aperçu par allocation");
  assert.equal(Math.round(lignes.reduce((t, l) => t + l.duree, 0) * 100), Math.round(allocs.reduce((t, a) => t + a.duree, 0) * 100));
}

// 6. Tâche impossible : reste « au-delà de l'horizon », jamais une date.
{
  const s = snapshot();
  s.phasages[1] = phasage("C2", [tache("long", "G_ELEC", 400)]);
  const court = simulerOperationV1({ snapshot: s, operationId: "OP1", startDate: START, horizonDays: 7 });
  const r = resumerSimulationOperationV1(court);
  const ch = r.chantiers.find(c => c.chantier_id === "C2");
  assert.equal(ch.fin, null);
  assert.equal(ch.travail_moteur_place, false);
  assert.ok(r.non_places.some(n => n.nom === "Tâche long" && n.liee_a_la_periode));
  // Allongement automatique de la période.
  const auto = simulerOperationJusquAuBoutV1({ snapshot: s, operationId: "OP1", startDate: START, horizons: [7, 120] });
  assert.equal(auto.horizon_days, 120);
}

// 7. Plan d'écriture : uniquement l'opération, lignes marquées, identifiants présents.
const cellulesOp = [
  // Ligne manuelle et ligne posée AVANT le démarrage : conservées.
  cellule("2026-W36", "Vendredi", "C1", [ligne("OLD", "elec", 1, ["R1"])]),
  cellule("2026-W37", "Mardi", "C1", [ligne("MAN", null, 2, ["R2"])]),
];
const s7 = snapshot({ cellules: [...snapshot().cellules, ...cellulesOp] });
const sim7 = simulerOperationV1({ snapshot: s7, operationId: "OP1", startDate: START, horizonDays: 42 });
const plan = construirePlanEcritureOperationV1({ sim: sim7, cellulesOperationToutes: cellulesOp, placeLe: "2026-09-01" });
assert.equal(plan.ok, true, JSON.stringify(plan.blocages));
assert.ok(plan.operations.every(o => ["C1", "C2"].includes(o.after.chantier_id)), "aucune journée hors opération");
const posees = plan.operations.flatMap(o => o.after.taches.filter(l => l.origine === ORIGINE_LIGNE_OPERATION));
assert.equal(posees.length, plan.resume.lignes_posees);
assert.ok(posees.every(l => l.id && l.allocation_uid && l.place_le === "2026-09-01" && l.ouvriers.length));
const mardi = plan.operations.find(o => o.cell_key === "2026-W37::C1::Mardi");
assert.ok(mardi, "la journée qui porte une ligne manuelle est complétée");
assert.equal(mardi.type, "update");
assert.ok(mardi.after.taches.some(l => l.allocation_uid === "MAN"), "ligne manuelle conservée");
assert.ok(!plan.operations.some(o => o.cell_key.startsWith("2026-W36")), "rien avant la date de démarrage");

// 8. Une ligne non verrouillée posée après le démarrage est remplacée, et comptée.
{
  const cOp = [cellule("2026-W38", "Lundi", "C2", [ligne("ANC", "elec2", 3, ["R1"])])];
  const s8 = snapshot({ cellules: [...snapshot().cellules, ...cOp] });
  const sim8 = simulerOperationV1({ snapshot: s8, operationId: "OP1", startDate: START, horizonDays: 42 });
  const p8 = construirePlanEcritureOperationV1({ sim: sim8, cellulesOperationToutes: cOp });
  assert.equal(p8.ok, true);
  const uidsApres = p8.operations.flatMap(o => o.after.taches.map(l => l.allocation_uid));
  const total = p8.operations.flatMap(o => o.after.taches).filter(l => l.tache_id === "elec2").reduce((s, l) => s + l.duree, 0);
  assert.equal(total, 3, "pas de doublon : la tâche est posée une seule fois");
  assert.ok(uidsApres.length > 0);
}

// 9. Ligne de l'opération posée APRÈS la période : blocage visible, rien d'écrit.
{
  const cOp = [cellule("2027-W30", "Lundi", "C1", [ligne("TARD", "elec", 1, ["R1"])])];
  const p9 = construirePlanEcritureOperationV1({ sim, cellulesOperationToutes: cOp });
  assert.equal(p9.ok, false);
  assert.equal(p9.blocages[0].code, "lignes_apres_periode");
}

// 9 bis. Lignes à venir AVANT la date de démarrage : seraient posées en double.
{
  const cOp = [cellule("2026-W37", "Lundi", "C1", [ligne("AV", "elec", 2, ["R1"])])];
  const tard = simulerOperationV1({ snapshot: snapshot(), operationId: "OP1", startDate: "2026-09-14", horizonDays: 42 });
  const bloque = construirePlanEcritureOperationV1({ sim: tard, cellulesOperationToutes: cOp, aujourdhui: "2026-09-01" });
  assert.equal(bloque.ok, false);
  assert.equal(bloque.blocages[0].code, "lignes_avant_demarrage");
  // Les mêmes lignes dans le passé sont du travail fait : pas de blocage.
  const passe = construirePlanEcritureOperationV1({ sim: tard, cellulesOperationToutes: cOp, aujourdhui: "2026-09-10" });
  assert.equal(passe.ok, true, JSON.stringify(passe.blocages));
}

// 9 ter. Re-simuler après placement : même résultat, rien à écrire.
{
  const posees = plan.operations.map(o => ({ ...o.after, id: `CELL-${o.cell_key}` }));
  const s9 = snapshot({ cellules: [...snapshot().cellules, ...cellulesOp.filter(c => !plan.operations.some(o => o.cell_key === `${c.week_id}::${c.chantier_id}::${c.jour}`)), ...posees] });
  const re = simulerOperationV1({ snapshot: s9, operationId: "OP1", startDate: START, horizonDays: 42 });
  const p = construirePlanEcritureOperationV1({ sim: re, cellulesOperationToutes: s9.cellules.filter(c => c.chantier_id !== "X"), aujourdhui: "2026-09-07" });
  assert.equal(p.ok, true, JSON.stringify(p.blocages));
  assert.equal(p.operations.length, 0, "placement idempotent");
}

// 10. Garde avant écriture : identique → ok ; une journée modifiée → refus.
{
  const ok = verifierCellulesAvantEcritureV1(plan.operations, cellulesOp);
  assert.equal(ok.ok, true, JSON.stringify(ok.conflits));
  const modifiee = cellulesOp.map(c => c.jour === "Mardi" ? { ...c, reel: "fait" } : c);
  assert.deepEqual(verifierCellulesAvantEcritureV1(plan.operations, modifiee).conflits, ["2026-W37::C1::Mardi"]);
  const insertion = plan.operations.find(o => o.type === "insert");
  const [w, ch, j] = insertion.cell_key.split("::");
  const apparue = [...cellulesOp, cellule(w, j, ch, [])];
  assert.deepEqual(verifierCellulesAvantEcritureV1(plan.operations, apparue).conflits, [insertion.cell_key], "journée apparue entre-temps = refus");
}

// 11. Dates prévues = premier jour posé (y compris avant le démarrage).
const apres = [...cellulesOp.filter(c => !plan.operations.some(o => o.cell_key === `${c.week_id}::${c.chantier_id}::${c.jour}`)), ...plan.operations.map(o => o.after)];
{
  const ph = s7.phasages.find(p => p.chantier_id === "C1");
  const out = datesPrevuesApresPlacementV1({ phasage: ph, cellulesChantierApres: apres, lignesRetirees: [] });
  const t = new Map(out.ouvrages[0].taches.map(x => [x.id, x.date_prevue]));
  assert.equal(t.get("elec"), "2026-09-04", "la ligne d'avant le démarrage reste la première");
  assert.equal(t.get("placo"), sim7.proposition.allocations_proposees.filter(a => a.tache_id === "placo").map(a => a.date).sort()[0]);
  assert.equal(t.get("dem"), undefined, "tâche non posée : pas de date inventée");
  // Retirée et non reposée : la date n'est effacée que si elle venait de la ligne retirée.
  const ph2 = { ...ph, ouvrages: [{ ...ph.ouvrages[0], taches: ph.ouvrages[0].taches.map(x => x.id === "dem" ? { ...x, date_prevue: "2026-09-08" } : x.id === "app" ? { ...x, date_prevue: "2026-01-01" } : x) }] };
  const out2 = datesPrevuesApresPlacementV1({ phasage: ph2, cellulesChantierApres: [], lignesRetirees: [{ chantier_id: "C1", tache_id: "dem", date: "2026-09-08" }] });
  const t2 = new Map(out2.ouvrages[0].taches.map(x => [x.id, x.date_prevue]));
  assert.equal(t2.get("dem"), "");
  assert.equal(t2.get("app"), "2026-01-01", "date posée autrement : conservée");
}

// 12. Retrait : seules les lignes marquées partent, le reste est intact.
{
  const posees2 = lignesPoseesParOperationV1(apres, ["C1", "C2"]);
  assert.equal(posees2.lignes, plan.resume.lignes_posees);
  const r = construirePlanRetraitOperationV1({ cellulesOperationToutes: apres, idsChantiers: ["C1", "C2"] });
  const restantes = r.operations.flatMap(o => o.after.taches);
  assert.ok(restantes.every(l => l.origine !== ORIGINE_LIGNE_OPERATION));
  assert.equal(r.lignes_retirees.length, plan.resume.lignes_posees);
  const mardiApres = r.operations.find(o => o.cell_key === "2026-W37::C1::Mardi");
  assert.deepEqual(mardiApres.after.taches.map(l => l.allocation_uid), ["MAN"]);
  assert.deepEqual(mardiApres.after.ouvriers, ["R2"]);
  assert.ok(verifierCellulesAvantEcritureV1(r.operations, apres).ok);
  const rien = construirePlanRetraitOperationV1({ cellulesOperationToutes: cellulesOp, idsChantiers: ["C1", "C2"] });
  assert.equal(rien.operations.length, 0, "rien à retirer sans ligne marquée");
}

// 13. Déterminisme : mêmes données, même résultat.
{
  const a = simulerOperationV1({ snapshot: snapshot(), operationId: "OP1", startDate: START, horizonDays: 42 });
  assert.deepEqual(a.proposition.allocations_proposees, sim.proposition.allocations_proposees);
}

// 14. Opération sans chantier en cours : erreur explicite.
assert.throws(() => simulerOperationV1({ snapshot: snapshot(), operationId: "OP_VIDE", startDate: START }), /aucun chantier/);
assert.throws(() => simulerOperationV1({ snapshot: snapshot(), operationId: "OP1", startDate: "demain" }), /Date de démarrage/);

console.log("verif-planning-operation-v1 : OK");
