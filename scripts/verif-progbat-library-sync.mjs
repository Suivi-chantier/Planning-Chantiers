#!/usr/bin/env node
import assert from "node:assert/strict";
import { construirePlanSynchronisation, construirePayloadStructure, trouverFamilleCible, trouverTva, donneesPourHash, restreindrePlan, etatOuvragePourSync } from "../src/Renovation/progbatLibrarySync.mjs";

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

const familleOk = trouverFamilleCible(familles);
assert.equal(familleOk.ok, true);
assert.equal(familleOk.id, 10);
assert.equal(familleOk.erreur, null);
assert.deepEqual(familleOk.candidats, [{ id: 10, label: "Ouvrages V2", structureFamily: true }]);

// Les trois causes d'échec sont distinguées : elles ne se corrigent pas pareil.
const absente = trouverFamilleCible([{ id: 3, label: "Plâtrerie", structureFamily: true }], "Ouvrages V2");
assert.equal(absente.ok, false);
assert.deepEqual(absente.homonymes, []);
assert.match(absente.erreur, /introuvable/);
assert.deepEqual(absente.disponibles, ["Plâtrerie"], "les familles d'ouvrages utilisables sont listées");

const mauvaisType = trouverFamilleCible([{ id: 4, label: "Ouvrages V2", structureFamily: false }]);
assert.equal(mauvaisType.ok, false);
assert.equal(mauvaisType.homonymes.length, 1, "l'homonyme est rendu même s'il n'est pas une famille d'ouvrages");
assert.equal(mauvaisType.homonymes[0].structureFamily, false);
assert.equal(mauvaisType.candidats.length, 0);
assert.match(mauvaisType.erreur, /n'est pas une famille d'ouvrages/);

const plusieurs = trouverFamilleCible([{ id: 1, label: "Ouvrages V2" }, { id: 2, label: "ouvrages v2" }]);
assert.equal(plusieurs.ok, false);
assert.match(plusieurs.erreur, /Plusieurs/);

// La cause exacte remonte jusqu'aux exclusions du plan, pas un message générique.
assert.deepEqual(
  construirePayloadStructure(base, { familleId: null, unites, taxe: taxes[0], familleErreur: absente.erreur }).erreurs,
  [absente.erreur],
);
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
assert.ok(sansFamille.exclus.some((x) => x.raisons.includes(sansFamille.famille.erreur)), "l'exclusion porte la cause exacte");
assert.match(sansFamille.famille.erreur, /introuvable/);

const sansTva = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: null });
assert.equal(sansTva.compteurs.a_lier, 1);
assert.equal(sansTva.compteurs.a_creer, 0);

// ─── Périmètre restreint (envoi d'un ouvrage depuis sa fiche) ───────────────
assert.equal(restreindrePlan(plan, []), plan, "sans périmètre, le plan est rendu tel quel");
assert.equal(restreindrePlan(plan, null), plan);

const unSeul = restreindrePlan(plan, ["p2"]);
assert.deepEqual(unSeul.compteurs, { a_lier: 0, a_creer: 1, exclus: 0, total: 1 });
assert.equal(unSeul.actions[0].ouvrageId, "p2");
assert.deepEqual(unSeul.hors_plan, [], "p2 est bien dans le plan");
assert.deepEqual(unSeul.perimetre, { ouvrageIds: ["p2"] });
assert.deepEqual(unSeul.garanties, plan.garanties, "les garanties suivent le plan restreint");

const bloque = restreindrePlan(plan, ["p4"]);
assert.deepEqual(bloque.compteurs, { a_lier: 0, a_creer: 0, exclus: 1, total: 0 });
assert.deepEqual(bloque.exclus[0].raisons, ["Prix absent"]);

const dejaLie = restreindrePlan(plan, ["p5"]);
assert.equal(dejaLie.compteurs.total, 0, "un ouvrage déjà lié n'a aucune action");
assert.deepEqual(dejaLie.hors_plan, ["p5"], "ni action ni exclusion : signalé hors plan");

const inconnu = restreindrePlan(plan, ["zz"]);
assert.deepEqual(inconnu.hors_plan, ["zz"]);
assert.equal(inconnu.compteurs.total, 0);

// L'empreinte dépend du périmètre : un aperçu d'un ouvrage ne peut pas
// confirmer une synchronisation globale, même à actions identiques.
assert.notDeepEqual(donneesPourHash(unSeul), donneesPourHash(plan));
assert.deepEqual(donneesPourHash(restreindrePlan(plan, ["p2", "p1"])).perimetre, ["p1", "p2"], "périmètre trié, ordre d'appel sans effet");
assert.equal(donneesPourHash(plan).perimetre, null);

const etat = etatOuvragePourSync(inventaire, "p4");
assert.equal(etat.statut, "nouveau_a_creer");
assert.equal(etat.synchronisable, false);
assert.deepEqual(etat.blocages, ["Prix absent"]);
assert.equal(etatOuvragePourSync(inventaire, "p1").progbatId, 501, "code identique : l'id candidat est rendu");
assert.equal(etatOuvragePourSync(inventaire, "zz"), null);

console.log("verif-progbat-library-sync : OK (liaison, création, dossier V2, unité, TVA, exclusions, garanties, périmètre par ouvrage, diagnostic de famille)");
