#!/usr/bin/env node
// ─── ÉQUIPES RÉUNIES + RESPONSABLE QUI ENCADRE (chantier 10, 29/09/2026) ─────
// TOUTES les données de ce script sont FICTIVES (exemple issu des tests,
// données fictives) : « Davy », « Selman », « Kev », « Paul » ne sont que des
// étiquettes, les chantiers et tâches sont inventés.
//
// Ce que le script prouve :
//  A. le moteur essaie les tâches à plusieurs personnes AVANT les tâches à
//     1 personne : l'équipe est réunie dès le matin, sans heure perdue, et une
//     tâche à plusieurs impossible ne bloque rien ;
//  R. le réglage d'équipe « le responsable travaille avec l'équipe »
//     (responsable_travaille) : absent = comportement historique ; false =
//     responsable exclu du moteur et du Phasage, mais toujours affiché.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";
import { membresEquipeDisponibles, nomsEquipeProposablesV1, normaliserEquipeLegacy } from "../src/Renovation/planningResourceModelV1.js";
import { preparerSimulationPlanningGlobalV1 } from "../src/Renovation/planningEngineAdapterV1.js";
import { capaciteBasePlanningPourDate } from "../src/Renovation/planningResourceCapacityV1.js";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = rel => readFileSync(path.join(RACINE, rel), "utf8");

let ok = 0;
const blocs = [];
const exemples = [];
function bloc(titre, fn) {
  try { fn(); blocs.push(`■ ${titre}\n    ✓`); } catch (e) { blocs.push(`■ ${titre}\n    ✗ ${e.message}`); process.exitCode = 1; }
}
const verifier = (cond, libelle) => { assert.ok(cond, libelle); ok++; };

const res = id => ({ id, nom: id, nom_planning: id, kind: "personne", actif: true, capacite_facteur: 1 });
const DAVY = "Davy", SELMAN = "Selman", KEV = "Kev";
const tache = (id, heures, extra = {}) => ({
  id, tache_id: id, chantier_id: "CH-X", site_id: "SITE-X", groupe_type_id: "gt_placo", texte: id,
  heures_mo_restantes: heures, crew_size: 1, candidate_resource_ids: [DAVY, SELMAN], preferred_resource_ids: [DAVY, SELMAN], ...extra,
});
// Lundi 31/08/2026 (semaine paire : 5 jours travaillés).
const LUNDI = "2026-08-31";
const moteur = (travaux, extra = {}) => planifierPropositionV1({
  travaux, ressources: [res(DAVY), res(SELMAN), res(KEV)], startDate: LUNDI, horizonDays: 5, continuiteMultiJours: true, ...extra,
});
const du = (p, id) => p.allocations_proposees.filter(a => a.travail_id === id);

// Aucune heure perdue : chaque personne-jour a des heures, jamais au-delà de sa capacité.
function sansHeurePerdue(p) {
  const charge = new Map();
  for (const a of p.allocations_proposees) {
    if (!(a.duree > 0)) return false;
    for (const r of a.resource_ids) charge.set(`${r}|${a.date}`, (charge.get(`${r}|${a.date}`) || 0) + a.duree);
  }
  return [...charge].every(([k, h]) => h > 0 && h <= capaciteBasePlanningPourDate(k.split("|")[1]) + 1e-6);
}

bloc("A1. Une tâche à 2 réserve sa journée avant une tâche à 1 personne mieux notée", () => {
  const p = moteur([
    // Tâche à 1 personne, très prioritaire, sur un AUTRE site.
    tache("T-SOLO", 20, { chantier_id: "CH-Y", site_id: "SITE-Y", priority: 500 }),
    // Tâche à 2 personnes (Davy + Selman) sur le site X.
    tache("T-DUO", 6, { crew_size: 2 }),
  ]);
  const duo = du(p, "T-DUO");
  verifier(duo.length && duo[0].date === LUNDI && duo[0].resource_ids.slice().sort().join("+") === "Davy+Selman", `la tâche à 2 est placée lundi, Davy + Selman ensemble (${JSON.stringify(duo.map(a => [a.date, a.resource_ids]))})`);
  verifier(!du(p, "T-SOLO").some(a => a.date === LUNDI), "la tâche à 1 personne sur l'autre site attend : l'équipe est déjà réunie sur le site X");
  verifier(du(p, "T-SOLO").length > 0, "la tâche à 1 personne est bien placée ensuite");
  verifier(sansHeurePerdue(p), "aucune heure perdue, aucune journée au-delà de la capacité");
  exemples.push(`■ Tâche à 2 d'abord (exemple issu des tests, données fictives)\n   ${duo.map(a => `${a.date} ${a.resource_ids.join(" + ")} ${a.duree} h (${a.texte})`).join(" | ")} ; T-SOLO à partir du ${du(p, "T-SOLO")[0]?.date}`);
});

bloc("A2. Une tâche à plusieurs impossible ne bloque rien : les tâches à 1 personne passent", () => {
  const absent = [{ id: "E1", resource_id: KEV, type: "absence", date_debut: LUNDI, date_fin: "2026-09-04", toute_journee: true, actif: true }];
  const p = moteur([
    tache("T-DUO-KEV", 4, { crew_size: 2, candidate_resource_ids: [DAVY, KEV], preferred_resource_ids: [DAVY, KEV] }),
    tache("T-SOLO", 5),
  ], { evenementsRessources: absent });
  verifier(p.non_planifies.some(n => n.travail_id === "T-DUO-KEV"), "la tâche avec Kev absent reste non planifiée, avec sa raison");
  verifier(du(p, "T-SOLO").some(a => a.date === LUNDI), "Davy ou Selman travaille quand même dès lundi sur la tâche à 1 personne");
  verifier(sansHeurePerdue(p), "aucune heure perdue");
});

bloc("A3. Binôme réuni si possible, sans rien bloquer : Selman absent lundi → Davy seul lundi, binôme mardi", () => {
  const absent = [{ id: "E2", resource_id: SELMAN, type: "absence", date_debut: LUNDI, date_fin: LUNDI, toute_journee: true, actif: true }];
  const p = moteur([tache("T-DUO", 6, { crew_size: 2 }), tache("T-SOLO", 10)], { evenementsRessources: absent });
  const duo = du(p, "T-DUO");
  verifier(duo.length && duo[0].date === "2026-09-01" && duo[0].resource_ids.length === 2, `la tâche à 2 attend le retour de Selman (mardi) : ${duo[0]?.date}`);
  verifier(du(p, "T-SOLO").some(a => a.date === LUNDI && a.resource_ids.join() === DAVY), "lundi, Davy n'attend pas : il avance la tâche à 1 personne");
  verifier(sansHeurePerdue(p), "aucune heure perdue");
});

bloc("A4. Le critère est dans le tri du moteur, commenté", () => {
  const src = lire("src/Renovation/planningEngineV1.js");
  verifier(/eligible\.sort\(\(a, b\) =>\s*\(Number\(b\.travail\.crew_size > 1\) - Number\(a\.travail\.crew_size > 1\)\)\s*\|\| \(b\.score - a\.score\)/.test(src), "tâches à plusieurs d'abord, puis le score");
  verifier(src.includes("Les tâches à plusieurs personnes réservent leur journée d'abord"), "commentaire explicatif présent");
});

const ressources = [res(DAVY), res(SELMAN), res(KEV), res("Paul")];
bloc("R1. Équipe sans le champ : comportement identique (responsable compté)", () => {
  const eq = { id: "EQ-F", nom: "Finitions", responsable: DAVY, membres: [{ ouvrier: KEV }], externe: false };
  const n = normaliserEquipeLegacy(eq, ressources);
  verifier(n.resource_ids.join() === "Davy,Kev" && n.responsable_travaille === true, `effectif moteur : responsable + membres (${n.resource_ids.join()})`);
  verifier(membresEquipeDisponibles(eq, LUNDI, ressources).map(r => r.id).join() === "Davy,Kev", "disponibles : responsable inclus");
  verifier(nomsEquipeProposablesV1(eq, LUNDI).join() === "Davy,Kev", "Phasage : responsable proposé (règle historique)");
  const multi = { ...eq, responsables: [DAVY, "Paul"] };
  verifier(nomsEquipeProposablesV1(multi, LUNDI).join() === "Davy,Paul,Kev", "multi-chefs : tous les responsables proposés");
});

bloc("R2. Champ à false : responsable exclu du moteur et du Phasage, toujours affiché", () => {
  const eq = { id: "EQ-F", nom: "Finitions", responsable: DAVY, responsables: [DAVY, "Paul"], membres: [{ ouvrier: KEV }], externe: false, responsable_travaille: false };
  const n = normaliserEquipeLegacy(eq, ressources);
  verifier(n.resource_ids.join() === "Kev" && n.responsable_travaille === false, `effectif moteur sans le responsable (${n.resource_ids.join()})`);
  verifier(n.responsable_resource_id === DAVY && n.responsable_nom_planning === DAVY, "il reste le responsable affiché");
  verifier(membresEquipeDisponibles(eq, LUNDI, ressources).map(r => r.id).join() === "Kev", "disponibles : responsable exclu");
  verifier(nomsEquipeProposablesV1(eq, LUNDI).join() === "Kev", "Phasage : ni Davy ni Paul proposés");
  const aussiMembre = { ...eq, membres: [{ ouvrier: KEV }, { ouvrier: DAVY }] };
  verifier(normaliserEquipeLegacy(aussiMembre, ressources).resource_ids.join() === "Kev,Davy" && nomsEquipeProposablesV1(aussiMembre, LUNDI).join() === "Kev,Davy", "un responsable AUSSI inscrit comme membre reste dans l'effectif");
});

bloc("R3. Adaptateur du moteur : le responsable qui encadre n'est plus candidat des tâches du groupe", () => {
  const phasage = {
    id: "PH-X", chantier_id: "CH-X", revision: 1,
    ouvrages: [{ id: "O-X", code_ouvrage: "P-001", taches: [{ id: "T-PEINT", nom: "Peinture fictive", heures_vendues: 8, heures_estimees: 8, avancement: 0, chrono_groupe_id: "CG", chrono_ordre: 0, ouvriers: [], predecesseurs: [] }] }],
    plan_travaux: { meta: { chrono_groupes: [{ id: "CG", ordre: 10, groupe_type_id: "gt_fin" }] } },
  };
  const base = { phasages: [phasage], chantiers: [{ id: "CH-X", nom: "CHANTIER FICTIF X", statut: "en_cours" }], cellules: [], ressources, evenementsRessources: [], contraintes: [], groupesTypes: [{ id: "gt_fin", nom: "Finitions", ordre: 10, equipe_id: "EQ-F", ouvriers_prio: [] }], startDate: LUNDI, horizonDays: 5 };
  const eq = { id: "EQ-F", nom: "Finitions", responsable: DAVY, membres: [{ ouvrier: KEV }], externe: false };
  const avant = preparerSimulationPlanningGlobalV1({ ...base, equipes: [eq] }).engineInput.travaux[0];
  const apres = preparerSimulationPlanningGlobalV1({ ...base, equipes: [{ ...eq, responsable_travaille: false }] }).engineInput.travaux[0];
  verifier(avant.candidate_resource_ids.slice().sort().join() === "Davy,Kev", "champ absent : Davy et Kev candidats");
  verifier(apres.candidate_resource_ids.join() === "Kev", `champ à false : Kev seul candidat (${apres.candidate_resource_ids.join()})`);
});

bloc("R4. Réglages → Équipes : la case existe, le champ est conservé au chargement, le Phasage suit la règle", () => {
  const admin = lire("src/Renovation/Admin.jsx");
  verifier(admin.includes("checked={eq.responsable_travaille !== false}") && admin.includes("updEquipe(i, { responsable_travaille: e.target.checked })"), "case « Le responsable travaille avec l'équipe » (cochée par défaut)");
  verifier(admin.includes('"Les responsables travaillent avec l\'équipe" : "Le responsable travaille avec l\'équipe"'), "libellé au pluriel pour les multi-chefs");
  verifier(/accentColor:T\.accent/.test(admin), "couleur de la case tirée du thème (T), dark et light");
  verifier(lire("src/constants.js").includes("...(e.responsable_travaille === false ? { responsable_travaille: false } : {})"), "loadEquipes garde le champ quand il est décoché");
  verifier(lire("src/Renovation/PhasageV2.jsx").includes("const membresEquipe = (eq) => nomsEquipeProposablesV1(eq, new Date().toISOString().slice(0, 10));"), "le Phasage utilise la règle testée");
});

console.log(blocs.join("\n"));
console.log("\n" + exemples.join("\n"));
console.log(`\n${ok} contrôles OK${process.exitCode ? ", des échecs ci-dessus" : ", 0 en échec"}.`);
