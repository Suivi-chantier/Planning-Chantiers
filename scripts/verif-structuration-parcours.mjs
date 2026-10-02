#!/usr/bin/env node
// Vérifie le parcours de structuration (src/Invest/structurationParcours.mjs).
// Jeu de données : exemple issu des tests, données fictives. Aucune lecture de la base.
import assert from "node:assert/strict";
import * as P from "../src/Invest/structurationParcours.mjs";

const cas = [];
const test = (n, f) => cas.push([n, f]);

test("1. un dossier vide : sept étapes, aucune faite, la première est la courante", () => {
  const r = P.calculerParcours({});
  assert.equal(r.etapes.length, 7);
  assert.ok(r.etapes.every((e) => e.etat === "a_faire"));
  assert.equal(r.courante.cle, "cadrage");
  assert.equal(r.pourcentage, 0);
  assert.equal(r.prochainPoint.libelle, "Document d'entrée en relation remis au client");
});
test("2. le cadrage n'est fait que lorsque les six points le sont", () => {
  const data = { collecte: { qualification: { consentement_rgpd: "Obtenu le 02/10" } }, conformite: { der_remis_le: "2026-10-01", lettre_statut: "Signée", lettre_signee_le: "2026-10-02", identite_verifiee: true, origine_fonds_verifiee: true, remuneration_expliquee: false } };
  const e = P.calculerParcours(data).etapes[0];
  assert.equal(e.etat, "en_cours"); assert.equal(e.faits, 5);
  data.conformite.remuneration_expliquee = true;
  assert.equal(P.calculerParcours(data).etapes[0].etat, "fait");
});
test("3. « À obtenir » (valeur par défaut du RGPD) ne compte pas comme obtenu", () => {
  const r = P.calculerParcours({ collecte: { qualification: { consentement_rgpd: "À obtenir" } } });
  assert.equal(r.etapes[0].points[2].ok, false);
});
test("4. lettre « Signée » sans date de signature : point non validé", () => {
  const r = P.calculerParcours({ conformite: { lettre_statut: "Signée" } });
  assert.equal(r.etapes[0].points[1].ok, false);
});
test("5. pièces obligatoires : reçues ou validées comptent, non applicables sont exclues", () => {
  const docs = [
    { required: true, statut: "Reçu" }, { required: true, statut: "Validé" },
    { required: true, statut: "Non applicable" }, { required: false, statut: "À demander" },
  ];
  const pt = P.calculerParcours({ collecte: { documents: docs } }).etapes[1].points[5];
  assert.equal(pt.ok, true); assert.equal(pt.detail, "2 / 2");
  docs.push({ required: true, statut: "À demander" });
  assert.equal(P.calculerParcours({ collecte: { documents: docs } }).etapes[1].points[5].ok, false);
});
test("6. stratégies : deux scénarios sortis de « À étudier » sont nécessaires", () => {
  const sc = [{ statut: "À étudier" }, { statut: "Recommandé" }, { statut: "À écarter" }];
  const e = P.calculerParcours({ analyse: { scenarios: sc } }).etapes[3];
  assert.equal(e.points[0].ok, true);
  assert.equal(P.calculerParcours({ analyse: { scenarios: sc.slice(0, 2) } }).etapes[3].points[0].ok, false);
});
test("7. préconisation : une préconisation sans action ne compte pas", () => {
  const r1 = P.calculerParcours({ analyse: { preconisations: [{ titre: "Créer une SCI IS", action: "" }] } });
  assert.equal(r1.etapes[4].points[0].ok, false);
  const reco = [{ titre: "Créer une SCI IS", action: "Rédiger les statuts" }];
  assert.equal(P.calculerParcours({ analyse: { preconisations: reco } }).etapes[4].points[0].ok, false, "modèles de départ sans stratégie rédigée");
  assert.equal(P.calculerParcours({ analyse: { preconisations: reco, strategie_recommandee: "SCI IS + donation de parts" } }).etapes[4].points[0].ok, true);
});
test("8. mise en œuvre : toutes les actions doivent être faites, et il en faut au moins une", () => {
  const moe = { intervenants: [{ role: "Notaire" }], actions: [{ statut: "Fait" }, { statut: "En cours" }] };
  const e = P.calculerParcours({ mise_en_oeuvre: moe }).etapes[5];
  assert.equal(e.etat, "en_cours"); assert.equal(e.points[2].detail, "1 / 2");
  moe.actions[1].statut = "Fait";
  assert.equal(P.calculerParcours({ mise_en_oeuvre: moe }).etapes[5].etat, "fait");
  assert.equal(P.calculerParcours({}).etapes[5].points[2].ok, false, "aucune action = pas « toutes réalisées »");
});
test("9. les valeurs par défaut des nouveaux blocs sont vides et distinctes à chaque appel", () => {
  assert.notEqual(P.miseEnOeuvreVide().actions, P.miseEnOeuvreVide().actions);
  assert.equal(P.conformiteVide().lettre_statut, "À envoyer");
});
test("10. les onglets visés par chaque point existent dans l'écran", () => {
  const surfaces = new Set(["cadrage", "audit", "profil", "patrimoine", "documents", "analyse", "mise_en_oeuvre"]);
  for (const e of P.calculerParcours({}).etapes) { assert.ok(surfaces.has(e.onglet)); e.points.forEach((x) => assert.ok(surfaces.has(x.onglet), x.libelle)); }
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
