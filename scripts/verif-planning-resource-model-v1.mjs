#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadModel() {
  const url = new URL("../src/Renovation/planningResourceModelV1.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(dataUrl);
}

const m = await loadModel();

const ressources = [
  { id: "res_davy", nom: "Davy", nom_planning: "Davy", utilisateur_id: "user_davy", actif: true },
  { id: "res_selman", nom: "Selman", nom_planning: "Selman", utilisateur_id: "user_selman", actif: true },
  { id: "res_keita", nom: "Mohamed", nom_planning: "Mohamed", utilisateur_id: "user_keita", actif: true },
];

// Identité : un compte utilisateur est facultatif, l'id ressource ne l'est pas.
const sansCompte = m.maturiteRessource({ id: "res_jp", nom: "JP", nom_planning: "JP" });
assert.equal(sansCompte.valide, true);
assert.ok(sansCompte.warnings.some(w => w.includes("Aucun compte utilisateur")));
const sansId = m.maturiteRessource({ nom: "JP", nom_planning: "JP" });
assert.equal(sansId.valide, false);

// Jointure legacy par prenom_planning normalisé.
const match = m.trouverUtilisateurPourNomPlanning("  dÁVY  ", [
  { id: "user_davy", prenom_planning: "Davy", actif: true },
]);
assert.equal(match.utilisateur.id, "user_davy");

const audit = m.auditerRessourcesLegacy({
  ouvriers: ["Davy", "JP", "Externe"],
  utilisateurs: [{ id: "user_davy", prenom_planning: "Davy", actif: true }],
  equipes: [{ id: "eq_ext", nom: "Externe", externe: true, membres: [] }],
});
assert.equal(audit.rows.find(r => r.nom_planning === "Davy").utilisateur_id, "user_davy");
assert.equal(audit.rows.find(r => r.nom_planning === "JP").utilisateur_id, null);
assert.equal(audit.rows.find(r => r.nom_planning === "Externe").proposition_kind, "prestataire");

// Équipe : le responsable fait partie de l'effectif, même s'il n'est pas dans membres.
const equipe = {
  id: "eq_second",
  nom: "Second oeuvre",
  responsable: "Davy",
  membres: [
    { ouvrier: "Selman" },
    { ouvrier: "Mohamed", date_dispo: "2026-09-01" },
  ],
  externe: false,
};
const eq = m.normaliserEquipeLegacy(equipe, ressources);
assert.deepEqual(eq.resource_ids.sort(), ["res_davy", "res_keita", "res_selman"].sort());
assert.deepEqual(m.membresEquipeDisponibles(equipe, "2026-08-28", ressources).map(r => r.id).sort(), ["res_davy", "res_selman"]);
assert.deepEqual(m.membresEquipeDisponibles(equipe, "2026-09-02", ressources).map(r => r.id).sort(), ["res_davy", "res_keita", "res_selman"].sort());

// Priorités : si elles existent, elles filtrent l'équipe disponible ; sinon toute l'équipe.
const prio = m.ressourcesPrefereesPourGroupe({
  groupeType: { ouvriers_prio: ["Davy"] },
  equipe,
  dateISO: "2026-08-28",
  ressources,
});
assert.deepEqual(prio.map(r => r.id), ["res_davy"]);
const sansPrio = m.ressourcesPrefereesPourGroupe({
  groupeType: { ouvriers_prio: [] },
  equipe,
  dateISO: "2026-08-28",
  ressources,
});
assert.deepEqual(sansPrio.map(r => r.id).sort(), ["res_davy", "res_selman"]);

// Capacité : 7 h de base, 2 h d'absence partielle, 1 h déjà allouée => 4 h disponibles.
const partiel = m.calculerCapaciteRessource({
  resource: ressources[0],
  dateISO: "2026-08-28",
  capaciteBase: 7,
  evenements: [{
    id: "evt_partial",
    resource_id: "res_davy",
    type: "absence",
    date_debut: "2026-08-28",
    date_fin: "2026-08-28",
    toute_journee: false,
    heures_indisponibles: 2,
    motif: "Rendez-vous",
  }],
  heuresDejaAllouees: 1,
});
assert.equal(partiel.capacite_base, 7);
assert.equal(partiel.capacite_apres_exceptions, 5);
assert.equal(partiel.capacite_disponible, 4);
assert.equal(partiel.indisponible, false);

// Absence journée entière = hard indisponible.
const absent = m.calculerCapaciteRessource({
  resource: ressources[1],
  dateISO: "2026-08-28",
  capaciteBase: 7,
  evenements: [{ id: "evt_abs", resource_id: "res_selman", type: "absence", date: "2026-08-28", motif: "Congé" }],
});
assert.equal(absent.capacite_apres_exceptions, 0);
assert.equal(absent.capacite_disponible, 0);
assert.equal(absent.indisponible, true);

// Override absolu, puis allocation.
const exceptionnel = m.calculerCapaciteRessource({
  resource: ressources[0],
  dateISO: "2026-08-29",
  capaciteBase: 0,
  evenements: [{ id: "evt_override", resource_id: "res_davy", type: "capacite_override", date: "2026-08-29", capacite_heures: 5 }],
  heuresDejaAllouees: 2,
});
assert.equal(exceptionnel.capacite_apres_exceptions, 5);
assert.equal(exceptionnel.capacite_disponible, 3);

// Surcharge visible et explicable.
const surcharge = m.calculerCapaciteRessource({
  resource: ressources[0], dateISO: "2026-08-28", capaciteBase: 7, heuresDejaAllouees: 8,
});
assert.equal(surcharge.capacite_disponible, 0);
assert.ok(surcharge.warnings.some(w => w.includes("Surcharge")));
assert.equal(surcharge.explication.source_capacite_base, "rythmeSemaine");

console.log("planningResourceModelV1 fixtures: OK");
