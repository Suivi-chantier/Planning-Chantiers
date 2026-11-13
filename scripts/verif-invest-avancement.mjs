#!/usr/bin/env node
// Vérifie la Synthèse clients et l'Avancement des dossiers du CRM (refonte du 13/11/2026) :
// src/Invest/crm/avancementVue.mjs et le câblage dans CrmV2 / CrmSynthese / CrmAvancement / CrmEtapePanneau.
//
// Jeu de données : exemple issu des tests, données fictives. Aucune lecture de la base.
//   node scripts/verif-invest-avancement.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../src/Invest/crm/avancementVue.mjs";
import { ETAPES_PARCOURS } from "../src/Invest/dossiers/parcours.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
let n = 0;
const test = (nom, f) => { f(); n += 1; console.log(`ok ${n} — ${nom}`); };

const AUJ = "2026-11-13";
const U = [{ id: "u1", nom: "Conseiller A", email: "a@test.fr", actif: true }, { id: "u2", nom: "Conseiller B", email: "b@test.fr", actif: true }];
const CLIENTS = [
  { id: "c1", nom: "DUPONT", prenom: "Jean", statut: "Actif", conseiller: "Conseiller A", budget: 200000, strategie_data: { objectif: "Cash-flow", budget_max: 300000, zones: "Nantes", apport: 40000 } },
  { id: "c2", nom: "MARTIN", prenom: "Claire", statut: "Actif", conseiller: "Conseiller B", budget: 250000, strategie_data: {} },
  { id: "c3", nom: "LEROY", prenom: "Paul", statut: "En attente", conseiller: null, budget: null, strategie_data: null },
  { id: "c4", nom: "DURAND", prenom: "Eve", statut: "Actif", conseiller: "Conseiller A", budget: 400000, strategie_data: { zones: "Lyon" } },
];
const D = (id, client_id, x = {}) => ({ id, client_id, reference: `INV-T-${id}`, libelle: `Projet ${id}`, statut: "actif", conseiller_id: "u1", ...x });
const DOSSIERS = [
  D("d1", "c1", { statut: "clos", libelle: "Angers", motif_cloture: "acte signé" }),       // projet n°1 terminé
  D("d2", "c1", { libelle: "Nantes" }),                                                      // projet n°2 en recherche (plusieurs dossiers par client)
  D("d3", "c2", { conseiller_id: "u2" }),                                                    // en réalisation (Financement)
  D("d4", "c3", { statut: "ouvert" }),                                                       // en préparation
  D("d5", "c4", { statut: "actif" }),                                                        // bloqué, étapes incomplètes
  D("d6", "c4", { statut: "abandonne", motif_cloture: "client renonce" }),
];
const E = (dossier_id, etape, statut, x = {}) => ({ id: `e-${dossier_id}-${etape}`, dossier_id, operation_id: null, etape, statut,
  balle: ["en_cours", "en_attente", "bloquee"].includes(statut) ? "profero" : null, balle_utilisateur_id: null, prochaine_action: null, echeance: null,
  date_debut: null, date_fin: null, commentaire: null, modifie_par_id: null, blocage_motif: statut === "bloquee" ? "pièce manquante" : null,
  bloquee_depuis: statut === "bloquee" ? "2026-11-01" : null, reprise_a_confirmer: false, updated_at: "2026-11-10T10:00:00Z", ...x });
const toutes = (id, statuts, extra = {}) => ETAPES_PARCOURS.map((e, i) => E(id, e.cle, statuts[i] ?? "a_venir", extra[e.cle] || {}));
const T11 = (k) => Array.from({ length: 11 }, (_, i) => (i < k ? "terminee" : "a_venir"));
const ETAPES = [
  ...toutes("d1", T11(11)),
  ...toutes("d2", [...T11(5).slice(0, 5), "en_cours"], { recherche: { commentaire: "12/11/2026 · Démarrer : 2 biens à analyser\nRecherche d'un immeuble de rapport", prochaine_action: "Présenter 2 simulations", echeance: "2026-11-16", date_debut: "2026-11-05", modifie_par_id: "u1", updated_at: "2026-11-12T09:00:00Z" } }),
  ...toutes("d3", [...T11(7).slice(0, 7), "en_cours"], { financement: { prochaine_action: "Relancer la banque", echeance: "2026-11-10" } }),
  ...toutes("d4", ["en_cours"], { signature: { prochaine_action: "Envoyer la lettre de mission", echeance: "2026-11-20" } }),
  // d5 : seulement 3 étapes enregistrées (dossier historique incomplet), la 3e bloquée
  E("d5", "signature", "terminee", { updated_at: "2026-09-01T10:00:00Z" }), E("d5", "collecte", "terminee", { updated_at: "2026-09-01T10:00:00Z" }), E("d5", "documents", "bloquee", { updated_at: "2026-09-01T10:00:00Z" }),
];
const TACHES = [
  { id: "t1", client_id: "c3", dossier_id: "d4", etape: "signature", action_title: "Envoyer la lettre de mission", status: "a_faire", due_date: "2026-11-20", responsable: "Conseiller A" },
];
const NOTES = [
  { id: "n1", client_id: "c1", type: "appel", date: "2026-11-12", created_at: "2026-11-12T10:00:00Z", contenu: "Appel : budget confirmé à 300 k€", auteur: "Conseiller A" },
  { id: "n2", client_id: "c2", type: "commentaire", date: "2026-08-01", created_at: "2026-08-01T10:00:00Z", contenu: "Note interne", auteur: "Conseiller B" },
];
const donnees = { dossiers: DOSSIERS, clients: CLIENTS, etapes: ETAPES, taches: TACHES, utilisateurs: U, aujourdhui: AUJ };
const lignes = A.lignesAvancement(donnees);
const L = (id) => lignes.find((l) => l.dossierId === id);
const syn = A.syntheseClients({ clients: CLIENTS, lignes, notes: NOTES, aujourdhui: AUJ });
const S = (id) => syn.find((s) => s.id === id);

test("1. une ligne par dossier ; les 11 étapes du Dossier Invest dans leur ordre réel", () => {
  assert.equal(lignes.length, DOSSIERS.length);
  for (const l of lignes) assert.deepEqual(l.cellules.map((c) => c.etape), ETAPES_PARCOURS.map((e) => e.cle));
  assert.deepEqual(L("d2").cellules.map((c) => c.numero), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(ETAPES_PARCOURS.length, 11);
});

test("2. états de cellule : terminée, en cours, bloquée, non commencée ; étape actuelle repérée", () => {
  const d2 = L("d2");
  assert.deepEqual(d2.cellules.slice(0, 7).map((c) => c.etat.cle), ["terminee", "terminee", "terminee", "terminee", "terminee", "en_cours", "a_venir"]);
  assert.equal(d2.etapeActuelle.cle, "recherche"); assert.equal(d2.cellules[5].actuelle, true); assert.equal(d2.cellules[4].actuelle, false);
  assert.deepEqual(d2.cellules.map((c) => c.etat.ton).slice(4, 7), ["vert", "bleu", "gris"]);
  assert.equal(L("d5").cellules[2].etat.cle, "bloquee"); assert.equal(L("d5").cellules[2].blocage, "pièce manquante");
  assert.deepEqual(L("d5").blocages, [{ etape: "Documents", motif: "pièce manquante" }]);
});

test("3. dates, dernier commentaire, dernier intervenant d'une étape", () => {
  const c = L("d2").cellules[5];
  assert.equal(c.dateDebut, "2026-11-05"); assert.equal(c.dateFin, null);
  assert.equal(c.dernierCommentaire, "Recherche d'un immeuble de rapport"); assert.match(c.commentaire, /Démarrer : 2 biens/);
  assert.equal(c.modifiePar, "Conseiller A");
  assert.deepEqual(L("d2").dernierCommentaire, { texte: "Recherche d'un immeuble de rapport", etape: "Recherche", quand: "2026-11-12" });
  assert.equal(A.derniereLigne(null), null); assert.equal(A.derniereLigne("a\n\n b \n"), "b");
});

test("4. dossier historique incomplet : l'étape absente est « non renseignée », jamais « non commencée » ni « terminée »", () => {
  const d5 = L("d5");
  assert.equal(d5.cellules[3].etat.cle, "absente"); assert.equal(d5.cellules[3].id, null); assert.equal(d5.cellules[3].etat.libelle, "Non renseignée");
  assert.equal(d5.applicables, 3); assert.equal(d5.terminees, 2); assert.equal(d5.progressionPct, 67);
  const vide = A.lignesAvancement({ ...donnees, etapes: [] });
  assert.ok(vide.every((l) => l.cellules.every((c) => c.etat.cle === "absente") && l.progressionPct === null && l.etapeActuelle === null));
});

test("5. statut du projet : préparation, recherche, réalisation, terminé, abandonné", () => {
  assert.deepEqual(["d4", "d2", "d3", "d1", "d6"].map((id) => L(id).statutProjet.cle), ["preparation", "recherche", "realisation", "termine", "abandonne"]);
  assert.deepEqual(["d4", "d2", "d3", "d1", "d6"].map((id) => L(id).statutProjet.libelle), ["En préparation", "En recherche", "En cours de réalisation", "Terminé", "Abandonné"]);
  assert.equal(A.statutProjet({ id: "x", statut: "suspendu" }, []).libelle, "Suspendu");
  assert.equal(L("d1").progressionPct, 100);
});

test("6. un client avec plusieurs dossiers : projet terminé + projet en cours, client toujours actif", () => {
  const s = S("c1");
  assert.deepEqual([s.nbProjetsEnCours, s.nbProjetsTermines, s.projets.length], [1, 1, 2]);
  assert.equal(s.statutClient, "Actif"); assert.equal(s.statutRecherche, "En recherche");
  assert.equal(s.etapeActuelle.libelle, "Recherche"); assert.equal(s.signaux.pretNouvelInvestissement, false);
  assert.deepEqual(s.projets.map((p) => p.statutProjet.cle).sort(), ["recherche", "termine"]);
});

test("7. besoin du client : budget, objectif, secteur facultatifs (« non renseigné » = null, jamais 0)", () => {
  assert.deepEqual([S("c1").budget, S("c1").objectif, S("c1").secteur, S("c1").apport], [300000, "Cash-flow", "Nantes", 40000]);
  assert.deepEqual([S("c2").budget, S("c2").objectif, S("c2").secteur], [250000, null, null]);
  assert.deepEqual([S("c3").budget, S("c3").objectif, S("c3").secteur], [null, null, null]);
});

test("8. dernier échange et dernier commentaire ; prochaine action et échéance", () => {
  assert.equal(S("c1").dernierEchange, "2026-11-12"); assert.match(S("c1").dernierCommentaire.texte, /Recherche d'un immeuble|budget confirmé/);
  assert.equal(S("c2").dernierEchange, null, "une note simple n'est pas un échange");
  assert.equal(S("c2").prochaineAction, "Relancer la banque"); assert.equal(S("c2").echeance, "2026-11-10");
  assert.equal(S("c3").prochaineAction, "Envoyer la lettre de mission");
  const illisible = A.syntheseClients({ clients: CLIENTS, lignes, notes: NOTES, aujourdhui: AUJ, pilotageLisible: false });
  assert.ok(illisible.every((s) => s.prochaineAction === null && s.actionIndisponible === true && s.signaux.sansAction === false), "pilotage illisible ≠ aucune action");
});

test("9. alertes : retard, blocage, sans action, inactivité (seuil configurable)", () => {
  assert.equal(S("c2").signaux.enRetard, true); assert.equal(L("d3").signaux.enRetard, true);
  assert.equal(S("c4").signaux.bloquee, true);
  assert.equal(S("c4").signaux.inactif, true, "aucune évolution depuis le 01/09 (> 21 jours)");
  assert.equal(S("c1").signaux.inactif, false);
  const strict = A.syntheseClients({ clients: CLIENTS, lignes: A.lignesAvancement({ ...donnees, seuilInactivite: 1 }), notes: NOTES, aujourdhui: AUJ, seuilInactivite: 1 });
  assert.equal(strict.find((s) => s.id === "c1").signaux.inactif, true, "seuil de 1 jour : 1 jour sans échange");
  assert.deepEqual(A.attentionRequise(S("c4").signaux).map((m) => m.code).sort(), ["bloquee", "inactif", "sans_action"]);
});

test("10. client dont tous les projets sont terminés : prêt pour un nouvel investissement", () => {
  const seul = A.syntheseClients({ clients: [CLIENTS[0]], lignes: lignes.filter((l) => l.dossierId === "d1"), notes: [], aujourdhui: AUJ })[0];
  assert.equal(seul.signaux.pretNouvelInvestissement, true); assert.equal(seul.statutRecherche, "Aucun projet en cours");
});

test("11. indicateurs du bandeau calculés sur les vraies lignes, et cliquables (filtre kpi)", () => {
  const c = A.compteursSynthese(syn);
  assert.deepEqual(c, { tous: 4, actifs: 3, recherche: 2, attente: 1, termines: 1, retard: 1 });
  assert.deepEqual(A.filtrerSynthese(syn, { kpi: "retard" }).map((s) => s.id), ["c2"]);
  assert.deepEqual(A.filtrerSynthese(syn, { kpi: "attente" }).map((s) => s.id), ["c3"]);
  assert.deepEqual(A.KPI_SYNTHESE.map((k) => k.libelle), ["Clients", "Actifs", "En recherche", "En attente / pause", "Dossiers terminés", "Actions en retard"]);
});

test("12. filtres combinables de la Synthèse : conseiller, statut, étape, budget, recherche, alertes, nom", () => {
  assert.deepEqual(A.filtrerSynthese(syn, { conseiller: "Conseiller A" }).map((s) => s.id).sort(), ["c1", "c3", "c4"]);
  assert.deepEqual(A.filtrerSynthese(syn, { statutClient: "En attente" }).map((s) => s.id), ["c3"]);
  assert.deepEqual(A.filtrerSynthese(syn, { etape: "financement" }).map((s) => s.id), ["c2"]);
  assert.deepEqual(A.filtrerSynthese(syn, { budgetMin: 280000, budgetMax: 350000 }).map((s) => s.id), ["c1"]);
  assert.deepEqual(A.filtrerSynthese(syn, { recherche: "active" }).map((s) => s.id).sort(), ["c1", "c4"]);
  assert.deepEqual(A.filtrerSynthese(syn, { alerte: "bloque" }).map((s) => s.id), ["c4"]);
  assert.deepEqual(A.filtrerSynthese(syn, { q: "dupont", conseiller: "Conseiller A", kpi: "actifs" }).map((s) => s.id), ["c1"], "filtres cumulés, recherche sans accent ni casse");
  assert.deepEqual(A.filtrerSynthese(syn, { q: "nantes" }).map((s) => s.id), ["c1"], "recherche par secteur");
  assert.equal(A.filtrerSynthese(syn, { budgetMin: 1 }).some((s) => s.id === "c3"), false, "un budget absent ne passe pas un filtre de budget");
});

test("13. filtres de l'Avancement : étape actuelle, statut du projet, alertes, projets en cours seulement", () => {
  assert.deepEqual(A.filtrerAvancement(lignes, { enCoursSeulement: true }).map((l) => l.dossierId).sort(), ["d2", "d3", "d4", "d5"]);
  assert.deepEqual(A.filtrerAvancement(lignes, { statutProjet: "termine" }).map((l) => l.dossierId), ["d1"]);
  assert.deepEqual(A.filtrerAvancement(lignes, { etape: "recherche" }).map((l) => l.dossierId), ["d2"]);
  assert.deepEqual(A.filtrerAvancement(lignes, { alerte: "sans_action" }).map((l) => l.dossierId).sort(), ["d5"]);
  assert.deepEqual(A.filtrerAvancement(lignes, { conseiller: "Conseiller B" }).map((l) => l.dossierId), ["d3"]);
  assert.deepEqual(A.filtrerAvancement(lignes, { q: "INV-T-d4" }).map((l) => l.dossierId), ["d4"]);
});

test("14. module pur : ni base, ni horloge, ni écriture", () => {
  const src = lire("src/Invest/crm/avancementVue.mjs").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/supabase|Date\.now|new Date\(\)|\.update\(|\.insert\(/.test(src));
  assert.match(lire("src/Invest/crm/avancementVue.js"), /export \* from "\.\/avancementVue\.mjs"/);
  for (const imp of ["missionPilotee", "pilotageDossier", "etapeCourante"]) assert.match(src, new RegExp(`\\b${imp}\\b`), "aucune règle de pilotage dupliquée");
});

test("15. câblage : Synthèse par défaut, les trois vues partagent les mêmes lignes, seule l'édition d'étape écrit", () => {
  const V2 = lire("src/Invest/crm/CrmV2.jsx"), SY = lire("src/Invest/crm/CrmSynthese.jsx"), AV = lire("src/Invest/crm/CrmAvancement.jsx"), PA = lire("src/Invest/crm/CrmEtapePanneau.jsx");
  assert.match(V2, /useState\("synthese"\)/);
  assert.match(V2, /lignesAvancement\(/); assert.match(V2, /syntheseClients\(/); assert.match(V2, /<CrmSynthese /); assert.match(V2, /<CrmAvancement /);
  assert.match(V2, /<CrmEtapePanneau /); assert.match(V2, /charger\(\)/, "toute modification recharge les données partagées");
  assert.ok(!/\.(update|insert|delete|upsert)\(/.test(V2 + SY + AV), "tableaux en lecture seule");
  assert.match(PA, /PanneauEtape/, "même panneau que la fiche Dossier");
  assert.ok(!/from\("invest_dossiers"\)\.(update|insert|delete|upsert)|from\("invest_clients"\)\.(update|insert|delete|upsert)|delete\(/.test(PA), "le panneau ne touche ni dossiers, ni clients, ni ne supprime");
  assert.match(PA, /from\("invest_dossier_etapes"\)\.update\(\{ date_debut: debut \|\| null, date_fin: fin \|\| null \}\)/, "seules les dates sont écrites en direct");
  assert.match(AV, /position: "sticky"/); assert.match(AV, /top: 0/); assert.match(AV, /ETAPES_PARCOURS\.map/);
  assert.ok(!/etape_num|invest_clients\.etape/.test(V2 + SY + AV + PA + lire("src/Invest/crm/avancementVue.mjs")), "aucun retour aux 13 anciennes étapes");
});

test("16. la page Prospection n'est pas touchée par cette refonte", () => {
  const P = lire("src/Invest/Prospection.jsx");
  assert.ok(!/avancementVue|CrmSynthese|CrmAvancement|CrmEtapePanneau/.test(P));
});

console.log(`\n${n} contrôles passés.`);
