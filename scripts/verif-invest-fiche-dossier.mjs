#!/usr/bin/env node
// Vérifie la fiche Dossier Invest V1 (Chantier 1.2) : src/Invest/dossiers/ficheDossierVue.mjs
// (construction de la Vue d'ensemble à partir des moteurs existants) et
// l'intégration de FicheDossier.jsx.
//
// Jeu de données : exemple issu des tests, données fictives. Il reproduit la
// forme du dossier étalon RECETTE-T2A relevée le 30/09/2026 (étapes, tâches,
// situation patrimoniale, questionnaire), sans lire la base.
//   node scripts/verif-invest-fiche-dossier.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
const VUE = lire("src/Invest/dossiers/ficheDossierVue.mjs");
const CRM = lire("src/Invest/CRM.jsx");

const AUJ = "2026-10-05";
const U = [{ id: "u-m", nom: "Matthieu Fumoleau", email: "m@test.fr", actif: true }];
const CLIENT = { id: "c1", nom: "RECETTE-T2A", prenom: "NE PAS UTILISER", statut: "Actif" };
const DOSSIER = { id: "d1", client_id: "c1", reference: "INV-T-0023", libelle: "Dossier RECETTE", statut: "ouvert", conseiller_id: "u-m",
  lettre_mission_statut: "a_emettre", date_ouverture: "2026-09-30", created_at: "2026-09-30T16:15:00Z",
  questionnaire_statut: "valide", questionnaire_data: {
    objectifs__objectif_principal: { valeur: "patrimoine", verification: "verifiee" }, objectifs__horizon: { valeur: "plus_15", verification: "verifiee" },
    objectifs__budget: { valeur: 250000, verification: "non_verifiee" }, objectifs__apport_souhaite: { valeur: 30000, verification: "non_verifiee" },
    objectifs__zones: { valeur: "Angers (RECETTE)", verification: "verifiee" } } };
const ANCIEN = { ...DOSSIER, id: "d0", reference: "INV-T-0001", libelle: "Ancien", statut: "clos", motif_cloture: "Fin", date_cloture: "2026-01-01", created_at: "2025-01-01T00:00:00Z", questionnaire_data: {} };
const E = (etape, statut, x = {}) => ({ id: `e-${etape}`, dossier_id: "d1", operation_id: null, etape, statut, balle: null, balle_utilisateur_id: null,
  balle_tiers_libelle: null, prochaine_action: null, echeance: null, blocage_motif: null, bloquee_depuis: null, reprise_a_confirmer: false, updated_at: "2026-10-01T10:00:00Z", ...x });
const ETAPES = [
  E("signature", "en_cours", { balle: "profero", balle_utilisateur_id: "u-m" }),
  E("collecte", "en_cours", { balle: "profero", balle_utilisateur_id: "u-m", prochaine_action: "Relancer le client pour la pièce", echeance: "2026-10-31" }),
  E("documents", "terminee", { prochaine_action: "Historique", echeance: "2026-09-01" }),
  E("analyse", "en_cours", { balle: "client" }),
  E("strategie", "a_venir", { reprise_a_confirmer: true }),
  E("structuration", "non_applicable"),
  ...["recherche", "opportunites", "financement", "acquisition", "suivi"].map((k) => E(k, "a_venir")),
];
const TACHES = [
  { id: "t1", dossier_id: "d1", etape: "collecte", status: "a_faire", due_date: null, action_title: "Reste ouverte", responsable: "Matthieu" },
  { id: "t2", dossier_id: "d1", etape: "collecte", status: "fait", due_date: "2026-09-30", action_title: "Faite", responsable: "Matthieu" },
  { id: "t3", dossier_id: "d1", etape: "documents", status: "non_concerne", due_date: null, action_title: "Non concernée", responsable: "Matthieu" },
  { id: "t4", dossier_id: "d0", etape: "suivi", status: "a_faire", due_date: "2025-01-01", action_title: "Ancien dossier", responsable: "X" },
];
const COLLECTE = {
  invest_personnes: [{ id: "p1", lien: "principal", verification_statut: "non_verifiee" }, { id: "p2", lien: "conjoint", verification_statut: "non_verifiee" },
    { id: "p3", lien: "enfant", verification_statut: "a_corriger" }],
  invest_postes_financiers: [
    { famille: "revenu", categorie: "salaire", montant: 4000, periodicite: "mensuelle", base_revenu: "net_avant_impot", verification_statut: "non_verifiee" },
    { famille: "revenu", categorie: "salaire", montant: 2500, periodicite: "mensuelle", base_revenu: "net_avant_impot", verification_statut: "non_verifiee" },
    { famille: "actif_financier", categorie: "epargne_disponible", montant: 50000, verification_statut: "non_verifiee" },
    { famille: "actif_financier", categorie: "assurance_vie", montant: 30000, verification_statut: "non_verifiee" }],
  invest_engagements: [{ type: "credit_immobilier", mensualite: 1000, assurance_mensuelle: 50, capital_restant_du: 180000, verification_statut: "non_verifiee" }],
  invest_actifs_patrimoniaux: [{ usage: "residence_principale", statut: "detenu", valeur_estimee: 300000, verification_statut: "non_verifiee" }],
  invest_structures: [{ type: "sci", denomination: "SCI RECETTE", verification_statut: "non_verifiee" }],
};
const EVENEMENTS = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, dossier_id: "d1", ordre: 100 + i, survenu_le: `2026-10-0${1 + (i % 3)}T1${i % 10}:00:00Z`, type: "questionnaire_modifie", resume: `Événement ${i}`, auteur_libelle: "Matthieu Fumoleau" }));
const fiche = (x = {}) => F.construireFiche({ client: CLIENT, dossiers: [DOSSIER, ANCIEN], etapes: ETAPES, evenements: EVENEMENTS, taches: TACHES,
  utilisateurs: U, collecte: COLLECTE, aujourdhui: AUJ, ...x });

const cas = [];
const test = (n, f) => cas.push([n, f]);

test("1. sélection du dossier : le dossier en cours d'abord, un ancien consultable ; aucun dossier = état vide", () => {
  const f = fiche();
  assert.equal(f.dossier.id, "d1"); assert.equal(f.dossierEnCours.id, "d1"); assert.equal(f.dossiers.length, 2);
  const ancien = fiche({ idChoisi: "d0" });
  assert.equal(ancien.dossier.id, "d0"); assert.equal(ancien.dossierEnCours.id, "d1", "le dossier en cours reste la cible des modifications");
  assert.equal(ancien.modifiable, false); assert.equal(ancien.pilotage, null); assert.equal(ancien.aFaire, null, "dossier clos : aucune action en cours");
  assert.equal(F.construireFiche({ client: CLIENT, dossiers: [], aujourdhui: AUJ }).vide, true);
  assert.equal(fiche().entete.dateOuverture, "2026-09-30"); assert.equal(fiche().entete.conseiller, "Matthieu Fumoleau");
});

test("2. étapes simultanément actives, étape principale, prochaine action sur l'étape où agir", () => {
  const f = fiche();
  assert.deepEqual(f.pilotage.actives.map((a) => a.libelle), ["Signature", "Collecte", "Analyse"]);
  assert.equal(f.pilotage.principale.libelle, "Analyse"); assert.equal(f.pilotage.principale.balle, "Client");
  assert.deepEqual({ action: f.aFaire.action, etape: f.aFaire.etape, balle: f.aFaire.balle, echeance: f.aFaire.echeance, qui: f.aFaire.responsable, retard: f.aFaire.retardJours },
    { action: "Relancer le client pour la pièce", etape: "Collecte", balle: "Profero (Matthieu Fumoleau)", echeance: "2026-10-31", qui: "Matthieu Fumoleau", retard: 0 });
  assert.equal(f.parcours.length, 11); assert.equal(f.parcours.filter((e) => e.active).length, 3);
  assert.equal(f.parcours.find((e) => e.cle === "strategie").aConfirmer, true);
});

test("3. retard et blocage visibles dans « À faire maintenant » et l'en-tête", () => {
  const etapes = ETAPES.map((e) => e.etape === "collecte" ? { ...e, echeance: "2026-10-01" } : e.etape === "analyse" ? { ...e, statut: "bloquee", blocage_motif: "Avis d'imposition manquant", bloquee_depuis: "2026-10-02" } : e);
  const f = fiche({ etapes });
  assert.equal(f.aFaire.retardJours, 4); assert.equal(f.aFaire.etape, "Collecte", "échéance dépassée prioritaire");
  assert.deepEqual(f.pilotage.blocages, [{ etape: "Analyse", motif: "Avis d'imposition manquant", depuis: "2026-10-02" }]);
});

test("4. synthèse Projet (2d)", () => {
  const p = fiche().projet;
  assert.deepEqual({ objectif: p.objectif, horizon: p.horizon, budget: p.budget, apport: p.apport, zones: p.zones, statut: p.statutLibelle },
    { objectif: "Constitution de patrimoine", horizon: "Plus de 15 ans", budget: 250000, apport: 30000, zones: "Angers (RECETTE)", statut: "Validé" });
  assert.equal(fiche({ dossiers: [{ ...DOSSIER, questionnaire_data: {} }] }).projet.budget, null, "non renseigné : vide, jamais inventé");
});

test("5. synthèse Situation patrimoniale (2c), libellé du patrimoine net imposé", () => {
  const s = fiche().situation;
  assert.deepEqual([s.revenusMensuels, s.chargesMensuelles, s.mensualitesCredits, s.epargneDisponible, s.actifsFinanciers, s.valeurImmobiliereBrute, s.detteImmobiliereRestante, s.patrimoineNetSimplifie],
    [6500, 0, 1000, 50000, 80000, 300000, 180000, 200000]);
  assert.deepEqual(s.lignes, { foyer: 3, flux: 4, engagements: 1, immobilier: 1, structures: 1 });
  assert.match(FICHE, /Patrimoine net simplifié \(biens à 100 %\)/);
});

test("6. alertes : seulement les utiles, issues des moteurs existants", () => {
  let codes = fiche().alertes.map((a) => a.code);
  assert.deepEqual(codes, ["situation_a_corriger"], "attente client / à faire : pas des alertes");
  const etapes = ETAPES.map((e) => e.etape === "collecte" ? { ...e, echeance: "2026-10-01" } : e.etape === "analyse" ? { ...e, statut: "bloquee", blocage_motif: "Pièce", bloquee_depuis: "2026-10-02" } : e);
  const taches = [...TACHES, { id: "t9", dossier_id: "d1", etape: "collecte", status: "a_faire", due_date: "2026-09-20", action_title: "En retard" }];
  const dossiers = [{ ...DOSSIER, questionnaire_statut: "a_verifier", questionnaire_data: { ...DOSSIER.questionnaire_data, objectifs__zones: { valeur: "Angers", verification: "a_corriger" } } }];
  codes = fiche({ etapes, taches, dossiers }).alertes.map((a) => a.code);
  assert.deepEqual(codes, ["echeance_depassee_collecte", "bloquee_analyse", "tache_retard_t9", "situation_a_corriger", "projet_a_corriger", "projet_a_verifier"]);
  const al = fiche({ etapes, taches, dossiers }).alertes;
  assert.equal(al.find((a) => a.code === "situation_a_corriger").libelle, "Situation patrimoniale : 1 élément à corriger");
  assert.equal(al.find((a) => a.code === "projet_a_verifier").onglet, "projet");
  assert.match(VUE, /alertesPilotage\(pilotage\)/, "pas de moteur d'alerte parallèle");
});

test("7. activité récente : 8 derniers événements du dossier, du plus récent au plus ancien", () => {
  const a = fiche().activite;
  assert.equal(a.length, 8);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].quand >= a[i].quand);
  assert.ok(!fiche({ evenements: [...EVENEMENTS, { id: "x", dossier_id: "d0", ordre: 999, survenu_le: "2027-01-01T00:00:00Z", resume: "Autre dossier" }] }).activite.some((e) => e.resume === "Autre dossier"));
});

test("8. tâches : en retard / à faire / terminées, avec étape, responsable et échéance ; seulement ce dossier", () => {
  const t = F.tachesFiche([...TACHES, { id: "t5", dossier_id: "d1", etape: null, status: "a_faire", due_date: "2026-10-01", action_title: "Sans étape" }], "d1", AUJ);
  assert.deepEqual(t.enRetard.map((x) => [x.titre, x.etape]), [["Sans étape", "À classer"]]);
  assert.deepEqual(t.aFaire.map((x) => [x.titre, x.etape, x.responsable, x.echeance]), [["Reste ouverte", "Collecte", "Matthieu", null]]);
  assert.deepEqual(t.terminees.map((x) => x.titre), ["Faite"]);
  assert.ok(![...t.enRetard, ...t.aFaire, ...t.terminees].some((x) => x.titre === "Ancien dossier"));
});

test("9. navigation : 9 onglets ; modules non développés « en préparation », sans faux contenu", () => {
  assert.deepEqual(F.ONGLETS_FICHE.map((o) => o.libelle), ["Vue d'ensemble", "Projet", "Situation patrimoniale", "Documents", "Analyse", "Stratégie", "Opportunités", "Financement", "Acquisition"]);
  assert.deepEqual(F.ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), ["documents", "analyse", "strategie", "financement", "acquisition"]);
  assert.match(FICHE, /Module en préparation/);
});

test("10. intégration : cartes 2c/2d et panneau 2a réutilisés, pas de doublon métier ; action rattachée au dossier et à l'étape ; aucune donnée technique affichée", () => {
  assert.match(FICHE, /<ProjetSituationCard T=\{T\} dossierId=\{fiche\.dossier\.id\}/);
  assert.match(FICHE, /<SituationPatrimonialeCard client=\{client\}/);
  assert.match(FICHE, /<PanneauEtape /);
  assert.match(FICHE, /champsNouvelleTache\(fiche\.dossierEnCours\?\.id, form\.etape\)/);
  assert.match(CRM, /<FicheDossier client=\{client\} T=\{T\} profil=\{profil\} onDossierChange=\{setDossierInfo\}/);
  assert.ok(!/>\s*\{[a-zA-Z.?]*\.id\}\s*</.test(FICHE), "aucun identifiant affiché");
  assert.ok(!/invest_[a-z_]+<\/|"invest_[a-z_]+" \}|>invest_/.test(FICHE), "aucun nom de table affiché");
  for (const imp of ["pilotageDossier", "alertesPilotage", "actionDuJour", "calculerSituation", "syntheseObjectifs", "progression", "ruban", "choisirDossier"]) assert.match(VUE, new RegExp(`\\b${imp}\\b`));
});

test("11. refonte : la situation de la mission est affichée UNE fois (bandeau), alertes cliquables, parcours conservé", () => {
  assert.ok(!/titre="À faire maintenant"|titre="Alertes"/.test(FICHE), "plus de cartes qui répètent le bandeau");
  for (const libelle of ["Étape principale", "Prochaine action", "Échéance", "Balle"]) assert.equal((FICHE.match(new RegExp(`libelle="${libelle}"`, "g")) || []).length, 1, `${libelle} : un seul emplacement`);
  assert.match(FICHE, /fiche\.alertes\.map\(\(al\) => \(\s*<button key=\{al\.code\} onClick=\{\(\) => setOnglet\(al\.onglet\)\}/, "les alertes restent cliquables");
  assert.match(FICHE, /p\.blocages\.map\(\(b\) => <Badge/, "les blocages restent visibles");
  assert.match(FICHE, /valeur=\{aFaire\?\.balle \|\| aFaire\?\.responsable \|\| "Personne"\}/, "balle sans répéter le responsable");
  assert.match(FICHE, /<ParcoursOffre T=\{T\} offre=\{fiche\.offre\}/, "le parcours reste, cliquable");
  assert.match(FICHE, /onClick=\{\(\) => e\.present && onOuvrir\(cle\)\}/, "les étapes ouvrent toujours leur panneau");
  assert.match(FICHE, /ONGLETS_FICHE\.map\(\(o\) =>/, "tous les onglets de la fiche restent");
});

let echecs = 0;
for (const [n, f] of cas) {
  try { await f(); console.log(`  ✓ ${n}`); }
  catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
