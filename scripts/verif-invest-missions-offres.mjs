#!/usr/bin/env node
// Vérifie le chantier 9 (Invest V2) : Missions Offre 2 / Offre 3.
// Module pur src/Invest/dossiers/offres.mjs et son intégration dans la fiche
// Dossier (ficheDossierVue.mjs) et le CRM V2 (crmV2Vue.mjs).
// Données fictives, aucun réseau. Les règles en base sont vérifiées par
// scripts/verif-invest-dossiers-t1.mjs (cas 64 à 68).
//   node scripts/verif-invest-missions-offres.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as O from "../src/Invest/dossiers/offres.mjs";
import { ruban } from "../src/Invest/dossiers/dossierVue.mjs";
import { construireFiche } from "../src/Invest/dossiers/ficheDossierVue.mjs";
import * as V from "../src/Invest/crm/crmV2Vue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const AUJ = "2026-10-01";

const D = (x = {}) => ({ id: "d1", client_id: "c1", reference: "INV-T-1", libelle: "Mission test", statut: "actif",
  type_mission: "audit_patrimonial", lettre_mission_statut: "a_emettre", lettre_mission_signee_le: null, honoraires_prevus_ht: null,
  restitution_le: null, cadrage_statut: null, cadrage_le: null, date_ouverture: "2026-09-01", ...x });
const E = (statuts) => Object.entries(statuts).map(([etape, statut]) => ({ id: `e-${etape}`, dossier_id: "d1", etape, statut, balle: statut === "en_cours" ? "profero" : null }));
const TOUTES_A_VENIR = { signature: "a_venir", collecte: "a_venir", documents: "a_venir", analyse: "a_venir", strategie: "a_venir", recherche: "a_venir",
  opportunites: "a_venir", financement: "a_venir", structuration: "a_venir", acquisition: "a_venir", suivi: "a_venir" };
const etats = (p) => Object.fromEntries(p.phases.flatMap((ph) => ph.jalons.map((j) => [j.cle, j.etat])));

const cas = [];
const test = (n, f) => cas.push([n, f]);

test("1. définition validée : Offre 2 = 6 jalons ; Offre 3 = phase Patrimoine (4 jalons) puis toute l'Offre 2 (Cadrage au lieu de Projet)", () => {
  assert.deepEqual(O.PHASES_OFFRE.offre2.map((p) => p.jalons.map((j) => j.libelle)),
    [["Projet", "Documents", "Recherche", "Opportunités", "Financement", "Acquisition"]]);
  assert.deepEqual(O.PHASES_OFFRE.offre3.map((p) => [p.libelle, p.jalons.map((j) => j.libelle)]), [
    ["Patrimoine", ["Collecte", "Analyse", "Stratégie", "Rapport & restitution"]],
    ["Investissement", ["Cadrage", "Documents", "Recherche", "Opportunités", "Financement", "Acquisition"]]]);
  // Chaque étape interne appartient à un seul jalon par offre ; les 11 sont couvertes.
  for (const code of ["offre2", "offre3"]) {
    const toutes = O.JALONS_OFFRE[code].flatMap((j) => j.etapes);
    assert.equal(new Set(toutes).size, toutes.length, `${code} : pas de doublon`);
    assert.equal(toutes.length, 11, `${code} : 11 étapes`);
  }
  assert.equal(O.offreDe("audit_patrimonial").libelle, "Accompagnement patrimonial global");
  assert.equal(O.parcoursOffre(D({ type_mission: "conseil" }), []), null, "pas de parcours d'offre inventé");
});

test("2. Offre 3 sans restitution : phase Investissement « pas encore commencée », jamais en retard", () => {
  const p = O.parcoursOffre(D(), ruban(E({ ...TOUTES_A_VENIR, signature: "terminee", collecte: "en_cours" })));
  assert.deepEqual(p.phases.map((x) => x.etatLibelle), ["En cours", "Pas encore commencée"]);
  assert.equal(etats(p).collecte, "en_cours");
  assert.equal(etats(p).restitution, "a_venir");
  assert.equal(etats(p).cadrage, "a_venir");
  assert.deepEqual(p.alertes, []);
});

test("3. Stratégie finie : restitution « à faire » + alerte d'information ; une fois datée, Cadrage « à faire »", () => {
  const es = ruban(E({ ...TOUTES_A_VENIR, signature: "terminee", collecte: "terminee", analyse: "terminee", strategie: "terminee" }));
  const p = O.parcoursOffre(D(), es);
  assert.equal(etats(p).restitution, "a_faire");
  assert.deepEqual(p.alertes.map((a) => a.code), ["restitution_a_faire"]);
  const q = O.parcoursOffre(D({ restitution_le: "2026-09-15" }), es);
  const r = q.phases[0].jalons.find((j) => j.cle === "restitution");
  assert.deepEqual([r.etat, r.detail], ["termine", "Rapport remis et restitué le 15/09/2026"]);
  assert.equal(q.phases[0].etatLibelle, "Terminée");
  assert.equal(etats(q).cadrage, "a_faire");
  assert.equal(q.phases[1].nonCommencee, false);
  assert.equal(etats(O.parcoursOffre(D({ restitution_le: "2026-09-15", cadrage_statut: "non_necessaire" }), es)).cadrage, "sans_objet");
  const f = O.parcoursOffre(D({ restitution_le: "2026-09-15", cadrage_statut: "fait", cadrage_le: "2026-09-20" }), es);
  assert.equal(f.phases[1].jalons[0].detail, "Fait le 20/09/2026");
});

test("4. incohérence visible : phase Investissement commencée sans restitution (ex. mission passée d'Offre 2 à Offre 3)", () => {
  const p = O.parcoursOffre(D(), ruban(E({ ...TOUTES_A_VENIR, signature: "terminee", collecte: "terminee", recherche: "en_cours" })));
  assert.equal(p.phases[1].nonCommencee, false);
  assert.equal(p.phases[1].etatLibelle, "En cours");
  assert.deepEqual(p.alertes.map((a) => a.code), ["restitution_non_enregistree"]);
});

test("5. état d'un jalon lu sur ses étapes : bloqué prioritaire, non applicable, étapes absentes", () => {
  const p = O.parcoursOffre(D({ type_mission: "accompagnement_acquisition" }),
    ruban(E({ ...TOUTES_A_VENIR, signature: "terminee", collecte: "bloquee", structuration: "non_applicable", acquisition: "terminee", suivi: "terminee" })));
  assert.equal(etats(p).projet, "bloque");
  assert.equal(etats(p).acquisition, "termine");
  assert.equal(etats(O.parcoursOffre(D({ type_mission: "accompagnement_acquisition" }), [])).projet, "absent", "jamais « à venir » par défaut");
});

test("6. jalon actuel (CRM) : Offre 3 à l'ouverture, après stratégie, après restitution", () => {
  assert.equal(O.jalonActuel(D(), "collecte"), "Collecte");
  assert.equal(O.jalonActuel(D(), null, E(TOUTES_A_VENIR)), null, "mission qui démarre : pas de restitution annoncée");
  assert.equal(O.jalonActuel(D(), null, E({ strategie: "terminee" })), "Rapport & restitution");
  assert.equal(O.jalonActuel(D(), "recherche"), "Rapport & restitution", "phase 2 démarrée sans restitution");
  assert.equal(O.jalonActuel(D({ restitution_le: "2026-09-15" }), null), "Cadrage");
  assert.equal(O.jalonActuel(D({ restitution_le: "2026-09-15" }), "recherche"), "Recherche");
  assert.equal(O.jalonActuel(D({ type_mission: "accompagnement_acquisition" }), "collecte"), "Projet");
});

test("7. honoraires : forfait non renseigné ≠ 0 €, exigible à la signature, règle d'accompagnement sans calcul", () => {
  const h = O.honorairesMission(D());
  assert.deepEqual([h.forfait.montant, h.forfait.renseigne, h.forfait.exigibilite], [null, false, "Dû à la signature (lettre à émettre)"]);
  assert.equal(O.honorairesMission(D({ honoraires_prevus_ht: 0 })).forfait.renseigne, true, "0 saisi = 0, pas « non renseigné »");
  const s = O.honorairesMission(D({ honoraires_prevus_ht: "3000.00", lettre_mission_statut: "signee", lettre_mission_signee_le: "2026-09-01" }));
  assert.deepEqual([s.forfait.montant, s.forfait.etat, s.forfait.exigibilite], [3000, "du", "Dû depuis la signature du 01/09/2026"]);
  assert.equal(O.honorairesMission(D({ lettre_mission_statut: "signee" })).forfait.etat, "date_inconnue");
  assert.equal(O.honorairesMission(D({ lettre_mission_statut: "inconnu" })).forfait.exigibilite, "Lettre de mission : statut inconnu");
  assert.equal(h.accompagnement.regle, "50 % de la remise obtenue (prix affiché − prix d'achat), par acquisition");
});

test("8. gestes : préparent exactement le patch attendu, refusent ce que la base refuserait", () => {
  assert.deepEqual(O.patchOffre(D({ type_mission: "accompagnement_acquisition" }), "audit_patrimonial"), { type_mission: "audit_patrimonial" });
  assert.throws(() => O.patchOffre(D({ restitution_le: "2026-09-15" }), "accompagnement_acquisition"), /retirez d'abord/);
  assert.throws(() => O.patchOffre(D({ statut: "clos" }), "accompagnement_acquisition"), /consultation seule/);
  assert.equal(O.offreCible(D({ statut: "clos" })), null);
  assert.deepEqual(O.patchRestitution(D(), "2026-09-15", AUJ), { restitution_le: "2026-09-15" });
  assert.throws(() => O.patchRestitution(D(), "2026-10-02", AUJ), /futur/);
  assert.throws(() => O.patchRestitution(D({ type_mission: "accompagnement_acquisition" }), "2026-09-15", AUJ), /qu'en Offre 3/);
  assert.throws(() => O.patchRestitution(D({ restitution_le: "2026-09-15", cadrage_statut: "non_necessaire" }), null, AUJ), /Retirez d'abord le cadrage/);
  assert.throws(() => O.patchCadrage(D(), "fait", "2026-09-20", AUJ), /enregistrez d'abord la restitution/);
  assert.throws(() => O.patchCadrage(D({ restitution_le: "2026-09-15" }), "fait", "2026-09-10", AUJ), /précéder la restitution/);
  assert.deepEqual(O.patchCadrage(D({ restitution_le: "2026-09-15" }), "fait", "2026-09-20", AUJ), { cadrage_statut: "fait", cadrage_le: "2026-09-20" });
  assert.deepEqual(O.patchCadrage(D({ restitution_le: "2026-09-15" }), "non_necessaire", "2026-09-20", AUJ), { cadrage_statut: "non_necessaire", cadrage_le: null });
  assert.deepEqual(O.patchCadrage(D({ restitution_le: "2026-09-15", cadrage_statut: "fait", cadrage_le: "2026-09-20" }), null, null, AUJ), { cadrage_statut: null, cadrage_le: null });
  assert.deepEqual([O.lireMontant("3 000"), O.lireMontant("2 500,50 €"), O.lireMontant(""), O.lireMontant("0")], [3000, 2500.5, null, 0]);
  assert.throws(() => O.lireMontant("trois mille"), /Montant invalide/);
  assert.throws(() => O.lireMontant("-5"), /Montant invalide/);
  assert.deepEqual(O.patchLettre(D(), "signee", "2026-09-01", AUJ), { lettre_mission_statut: "signee", lettre_mission_signee_le: "2026-09-01" });
  assert.deepEqual(O.patchLettre(D(), "envoyee", "2026-09-01", AUJ), { lettre_mission_statut: "envoyee", lettre_mission_signee_le: null });
  assert.throws(() => O.patchLettre(D(), "inconnu", null, AUJ), /inconnu/, "on ne peut pas choisir « inconnu »");
});

test("9. fiche Dossier : offre, parcours par phases, honoraires et alertes de l'offre", () => {
  const f = construireFiche({ client: { id: "c1", nom: "TEST", prenom: "Client" }, dossiers: [D()], aujourdhui: AUJ,
    etapes: E({ ...TOUTES_A_VENIR, signature: "terminee", collecte: "terminee", analyse: "terminee", strategie: "terminee" }) });
  assert.equal(f.entete.offre.court, "Offre 3");
  assert.deepEqual(f.offre.phases.map((p) => p.cle), ["patrimoine", "investissement"]);
  assert.equal(f.offreCible, "accompagnement_acquisition");
  assert.equal(f.honoraires.forfait.renseigne, false);
  assert.ok(f.alertes.some((a) => a.code === "restitution_a_faire"));
});

test("10. source unique : le CRM V2 relit offres.mjs, aucune définition parallèle", () => {
  assert.equal(V.OFFRES, O.OFFRES);
  assert.equal(V.JALONS_OFFRE, O.JALONS_OFFRE);
  assert.equal(V.offreDe, O.offreDe);
  const crm = lire("src/Invest/crm/crmV2Vue.mjs");
  assert.ok(!/offre3:\s*\[/.test(crm), "plus de jalons définis dans le CRM");
  assert.match(crm, /jalonActuel\(dossier, p\.principale\?\.etape \?\? null, etapes\)/);
  const m = V.missionPilotee({ dossier: D(), etapes: E({ ...TOUTES_A_VENIR, strategie: "terminee" }), aujourdhui: AUJ });
  assert.equal(m.jalon, "Rapport & restitution");
  const src = lire("src/Invest/dossiers/offres.mjs");
  assert.ok(!/from\s+["'][^"']*supabase|Date\.now|new Date\(\)/.test(src), "module pur : ni Supabase ni horloge");
  assert.equal(lire("src/Invest/dossiers/offres.js").trim(), 'export * from "./offres.mjs";');
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
