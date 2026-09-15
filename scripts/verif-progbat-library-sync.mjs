#!/usr/bin/env node
import assert from "node:assert/strict";
import { construirePlanSynchronisation, construirePayloadStructure, trouverFamilleCible, trouverTva, donneesPourHash } from "../src/Renovation/progbatLibrarySync.mjs";

const structures = [
  { id: 501, code: "D-001", label: "D-001 : Dépose" },
];
const familles = [{ id: 10, label: "Ouvrages V2", structureFamily: true }];
const unites = [{ id: 1, code: "m²" }, { id: 2, code: "U" }];
const taxes = [{ id: 5, rate: 10, label: "10 %" }];
const base = {
  profero: { id: "p1", code: "D-001", libelle_court: "Dépose", unite: "m2" },
  prix: { cout_total_ht: 100, prix_vente_ht: 150 }, synchronisable: true, blocages: [],
};

assert.deepEqual(trouverFamilleCible(familles), { ok: true, id: 10, libelle: "Ouvrages V2", candidats: [{ id: 10, label: "Ouvrages V2" }], erreur: null });
assert.equal(trouverFamilleCible([], "Ouvrages V2").ok, false);
assert.equal(trouverFamilleCible([{ id: 1, label: "Ouvrages V2" }, { id: 2, label: "ouvrages v2" }]).ok, false);
assert.equal(trouverTva(taxes, 10).id, 5);
assert.equal(trouverTva([{ id: 6, rate: .1 }], 10).id, 6);

const payload = construirePayloadStructure(base, { familleId: 10, unites, taxe: taxes[0] });
assert.equal(payload.ok, true);
assert.deepEqual(payload.payload, {
  code: "D-001", label: "D-001 : Dépose", unitCode: "m²", families: [10],
  purchaseNetUnitPrice: 100, edge: 50, saleNetUnitPrice: 150, taxRate: 10,
  active: true, fixedPrice: true, technicalCom: "D-001 : Dépose",
});
assert.equal(construirePayloadStructure(base, { familleId: null, unites, taxe: taxes[0] }).ok, false);
assert.equal(construirePayloadStructure(base, { familleId: 10, unites: [], taxe: taxes[0] }).ok, false);

const inventaire = { rapprochements: [
  { ...base, statut: "correspondance_code_a_confirmer", correspondance: { id: 501, label: "Dépose existante" } },
  { ...base, profero: { ...base.profero, id: "p2", code: "E-001", libelle_court: "Prise" }, statut: "nouveau_a_creer" },
  { ...base, profero: { ...base.profero, id: "p3", code: "E-002" }, statut: "ambigu", synchronisable: true },
  { ...base, profero: { ...base.profero, id: "p4", code: "E-003" }, statut: "nouveau_a_creer", synchronisable: false, blocages: ["Prix absent"] },
  { ...base, profero: { ...base.profero, id: "p5", code: "E-004" }, statut: "deja_lie" },
] };
const plan = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: 10 });
assert.deepEqual(plan.compteurs, { a_lier: 1, a_creer: 1, exclus: 2, total: 2 });
assert.equal(plan.actions[0].type, "link");
assert.equal(plan.actions[1].type, "create");
assert.deepEqual(plan.actions[1].payload.families, [10]);
assert.deepEqual(plan.garanties, { modifie_existants_progbat: false, supprime_progbat: false, cree_elements: false });
assert.equal(donneesPourHash(plan).actions.length, 2);

const sansFamille = construirePlanSynchronisation({ inventaire, familles: [], unites, taxes, tvaDefaut: 10 });
assert.equal(sansFamille.compteurs.a_lier, 1, "les liaisons restent possibles sans famille cible");
assert.equal(sansFamille.compteurs.a_creer, 0, "aucune création sans famille cible unique");
assert.ok(sansFamille.exclus.some((x) => x.raisons.some((r) => /famille/i.test(r))));

const sansTva = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: null });
assert.equal(sansTva.compteurs.a_lier, 1);
assert.equal(sansTva.compteurs.a_creer, 0);

console.log("verif-progbat-library-sync : OK (liaison, création, dossier V2, unité, TVA, exclusions, garanties)");
