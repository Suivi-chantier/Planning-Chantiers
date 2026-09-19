#!/usr/bin/env node
import assert from "node:assert/strict";
import { construirePlanClassement, donneesClassementPourHash, extraireIdsFamilles, normaliserLots, trouverFamilleMetier } from "../src/Renovation/progbatCategoryDispatch.mjs";

const lots = [
  { id: "demolition", label: "Démolition", code_prefixe: "D" },
  { id: "electricite", label: "Électricité", code_prefixe: "E" },
];
const familles = [{ id: 10, label: "Ouvrages V2", structureFamily: true }, { id: 20, label: "Démolition", structureFamily: true }];
const structures = [{ id: 501, label: "D-001", families: [10] }, { id: 502, label: "E-001" }, { id: 503, label: "COUV-001", families: [{ id: 10 }] }];
const ouvrages = [
  { id: "p1", libelle: "D-001 : Dépose", progbat_id: "501" },
  { id: "p2", libelle: "E-001 : Prise", progbat_id: "502" },
  { id: "p3", libelle: "COUV-001 : Couverture", progbat_id: "503" },
];

assert.deepEqual(normaliserLots(lots).map((x) => x.prefixe), ["D", "E"]);
assert.deepEqual(extraireIdsFamilles(structures[0]), { connu: true, ids: [10] });
assert.deepEqual(extraireIdsFamilles(structures[1]), { connu: false, ids: [] });
assert.deepEqual(extraireIdsFamilles({ families: [{ id: 20 }, 10, 20] }), { connu: true, ids: [10, 20] });
assert.equal(trouverFamilleMetier(familles, "demolition").id, 20);
assert.equal(trouverFamilleMetier(familles, "Électricité").absente, true);

const plan = construirePlanClassement({ ouvrages, structures, familles, lots });
assert.deepEqual(plan.compteurs, { a_classer: 2, familles_a_activer: 0, familles_a_creer: 1, deja_classes: 0, exclus: 1 });
assert.equal(plan.actions.find((x) => x.structureId === 501).familleId, 20);
assert.equal(plan.actions.find((x) => x.structureId === 502).familleLabel, "Électricité");
assert.equal(plan.exclus[0].code, "COUV-001");
assert.match(plan.exclus[0].raison, /sans lot configuré/);
assert.deepEqual(plan.famillesACreer[0].payload, { label: "Électricité", elementFamily: false, structureFamily: true, craftFamily: false });
assert.deepEqual(plan.famillesAActiver, []);
assert.deepEqual(plan.garanties.champs_modifies, ["families"]);
assert.equal(donneesClassementPourHash(plan).actions.length, 2);

const deja = construirePlanClassement({ ouvrages: [ouvrages[0]], structures: [{ id: 501, families: [20] }], familles, lots });
assert.equal(deja.compteurs.deja_classes, 1);
assert.equal(deja.compteurs.a_classer, 0);

const suivi = construirePlanClassement({
  ouvrages: [ouvrages[1]], structures: [{ id: 502 }], familles: [...familles, { id: 21, label: "Électricité", structureFamily: true }], lots,
  historique: [{ progbat_structure_id: 502, progbat_family_id: 21, family_label: "Électricité", statut: "categorized" }],
});
assert.equal(suivi.compteurs.deja_classes, 1, "le suivi évite un PATCH répété si l'API ne renvoie pas families");

const doublonMeme = construirePlanClassement({ ouvrages: [ouvrages[0], { ...ouvrages[0], id: "p1bis" }], structures, familles, lots });
assert.equal(doublonMeme.compteurs.a_classer, 1, "une structure partagée n'est PATCHée qu'une fois");
assert.equal(doublonMeme.actions[0].ouvrageIds.length, 2);

const conflit = construirePlanClassement({ ouvrages: [ouvrages[0], { id: "p4", libelle: "E-009 : Spot", progbat_id: "501" }], structures, familles, lots });
assert.equal(conflit.compteurs.a_classer, 0);
assert.equal(conflit.compteurs.exclus, 2);

const ambigu = construirePlanClassement({ ouvrages: [ouvrages[0]], structures, familles: [...familles, { id: 22, label: "demolition", structureFamily: true }], lots });
assert.equal(ambigu.compteurs.a_classer, 0);
assert.match(ambigu.exclus[0].raison, /Plusieurs familles/);

const familleElementsExistante = construirePlanClassement({
  ouvrages: [ouvrages[0]], structures, lots,
  familles: [{ id: 10, label: "Ouvrages V2", structureFamily: true }, { id: 20, label: "Démolition", elementFamily: true, structureFamily: false }],
});
assert.equal(familleElementsExistante.compteurs.a_classer, 1);
assert.equal(familleElementsExistante.compteurs.familles_a_creer, 0, "une famille existante ne doit jamais être recréée");
assert.equal(familleElementsExistante.compteurs.familles_a_activer, 1);
assert.deepEqual(familleElementsExistante.famillesAActiver[0], { id: 20, label: "Démolition", payload: { structureFamily: true } });

const familleIncertaine = construirePlanClassement({
  ouvrages: [ouvrages[1]], structures, familles, lots,
  historiqueFamilles: [{ family_label: "Électricité", statut: "uncertain" }],
});
assert.equal(familleIncertaine.compteurs.a_classer, 0);
assert.match(familleIncertaine.exclus[0].raison, /incertaine/);

const familleRetablie = construirePlanClassement({
  ouvrages: [ouvrages[1]], structures, familles, lots,
  historiqueFamilles: [
    { family_label: "Électricité", statut: "created" },
    { family_label: "Électricité", statut: "uncertain" },
  ],
});
assert.equal(familleRetablie.compteurs.a_classer, 1, "le dernier état confirmé lève un ancien état incertain");

console.log("verif-progbat-category-dispatch : OK (lots, familles, dédoublonnage, exclusions, garde-fous)");
