#!/usr/bin/env node
// Vérifie le CRM V2 et la fiche Client V2 (Chantier V2-01) :
// src/Invest/crm/crmV2Vue.mjs (À traiter, Clients, Actions & planning, page
// Client) et l'intégration dans CRM.jsx (ancienne vue séparée).
//
// Jeu de données : exemple issu des tests, données fictives. Aucune lecture
// de la base.
//   node scripts/verif-invest-crm-v2.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "../src/Invest/crm/crmV2Vue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const CRM = lire("src/Invest/CRM.jsx");
const CRMV2 = lire("src/Invest/crm/CrmV2.jsx");
const FICHE = lire("src/Invest/crm/FicheClientV2.jsx");
const VUE = lire("src/Invest/crm/crmV2Vue.mjs");
const SHARED = lire("src/Invest/_shared.jsx");

const AUJ = "2026-10-05";
const U = [{ id: "u1", nom: "Conseiller A", email: "a@test.fr", actif: true }, { id: "u2", nom: "Conseiller B", email: "b@test.fr", actif: true }];
const CLIENTS = [
  { id: "c1", nom: "ALPHA", prenom: "Test", email: "alpha@test.fr", telephone: "0600000001", statut: "Actif", conseiller: "Conseiller A" },
  { id: "c2", nom: "BETA", prenom: "Test", email: null, telephone: "0600000002", statut: "Actif", conseiller: "Conseiller B" },
  { id: "c3", nom: "GAMMA", prenom: "", email: "gamma@test.fr", telephone: null, statut: "Prospect", conseiller: null },
];
const D = (id, client_id, x = {}) => ({ id, client_id, reference: `INV-T-${id}`, libelle: `Mission ${id}`, statut: "actif", type_mission: "accompagnement_acquisition",
  conseiller_id: "u1", date_ouverture: "2026-09-01", created_at: "2026-09-01T10:00:00Z", ...x });
const DOSSIERS = [
  D("d1", "c1"), // en retard
  D("d2", "c1", { type_mission: "audit_patrimonial", conseiller_id: "u2" }), // 2e mission du même client (modèle V2)
  D("d3", "c2"), // attente client, rien d'urgent
  D("d4", "c2", { statut: "clos", motif_cloture: "Acquisition réalisée", date_cloture: "2026-06-30" }),
];
const E = (dossier_id, etape, statut, x = {}) => ({ id: `${dossier_id}-${etape}`, dossier_id, operation_id: null, etape, statut, balle: null, balle_utilisateur_id: null,
  balle_tiers_libelle: null, prochaine_action: null, echeance: null, blocage_motif: null, bloquee_depuis: null, reprise_a_confirmer: false, updated_at: "2026-10-01T10:00:00Z", ...x });
const ETAPES = [
  E("d1", "financement", "en_cours", { balle: "profero", balle_utilisateur_id: "u1", prochaine_action: "Relancer la banque", echeance: "2026-10-01" }),
  E("d1", "recherche", "en_cours", { balle: "profero", balle_utilisateur_id: "u1", prochaine_action: "Visiter", echeance: "2026-10-20" }),
  E("d2", "analyse", "bloquee", { balle: "client", blocage_motif: "Avis d'imposition manquant", bloquee_depuis: "2026-10-02" }),
  E("d3", "collecte", "en_attente", { balle: "client", prochaine_action: "Attendre les pièces", echeance: "2026-11-15" }),
  E("d4", "suivi", "terminee"),
];
const TACHES = [
  { id: "t1", client_id: "c1", dossier_id: "d1", etape: "financement", status: "a_faire", due_date: "2026-10-03", action_title: "Envoyer le dossier banque", responsable: "Conseiller A" },
  { id: "t2", client_id: "c1", dossier_id: "d1", etape: "recherche", status: "a_faire", due_date: AUJ, action_title: "Appeler l'agence", responsable: "Conseiller A" },
  { id: "t3", client_id: "c2", dossier_id: "d3", etape: "collecte", status: "en_cours", due_date: "2026-10-10", action_title: "Préparer la liste", responsable: "Conseiller A" },
  { id: "t4", client_id: "c2", dossier_id: "d3", etape: "collecte", status: "a_faire", due_date: "2026-10-30", action_title: "Point mensuel", responsable: "Conseiller A" },
  { id: "t5", client_id: "c2", dossier_id: null, etape: null, status: "a_faire", due_date: "2026-12-31", action_title: "Hors mission lointaine", responsable: null },
  { id: "t6", client_id: "c3", dossier_id: null, etape: null, status: "a_faire", due_date: null, action_title: "Sans échéance", responsable: null },
  { id: "t7", client_id: "c1", dossier_id: "d1", etape: "financement", status: "fait", due_date: "2026-09-01", action_title: "Terminée", responsable: "Conseiller A" },
];
const NOTES = [
  { id: "n1", client_id: "c1", type: "appel", date: "2026-10-02T09:00:00Z", contenu: "Appel client", auteur: "Conseiller A" },
  { id: "n2", client_id: "c1", type: "commentaire", date: "2026-10-04T09:00:00Z", contenu: "Note interne", auteur: "Conseiller A" },
  { id: "n3", client_id: "c2", type: "rendez-vous", date: "2026-09-20T09:00:00Z", contenu: "RDV", auteur: "Conseiller B" },
];
const donnees = { clients: CLIENTS, dossiers: DOSSIERS, etapes: ETAPES, taches: TACHES, utilisateurs: U, aujourdhui: AUJ };

const cas = [];
const test = (n, f) => cas.push([n, f]);

test("1. offre et jalon : lecture du type de mission et des 11 étapes, sans nouvelle donnée", () => {
  assert.equal(V.offreDe("accompagnement_acquisition").court, "Offre 2");
  assert.equal(V.offreDe("audit_patrimonial").court, "Offre 3");
  assert.deepEqual([V.offreDe("conseil").court, V.offreDe("conseil").libelle], [null, "Conseil"]);
  assert.equal(V.offreDe(null).libelle, "Type de mission non précisé", "absence visible, jamais une offre inventée");
  assert.equal(V.jalonDe("accompagnement_acquisition", "collecte"), "Projet");
  assert.equal(V.jalonDe("accompagnement_acquisition", "suivi"), "Acquisition");
  // Chantier 9 : l'Offre 3 contient l'Offre 2 (Documents relève de la phase Investissement).
  assert.equal(V.jalonDe("audit_patrimonial", "documents"), "Documents");
  assert.equal(V.jalonDe("audit_patrimonial", "collecte"), "Collecte");
  assert.equal(V.jalonDe("audit_patrimonial", "suivi"), "Acquisition");
  assert.equal(V.jalonDe("conseil", "analyse"), "Analyse", "sans jalons : libellé de l'étape");
  assert.ok(!JSON.stringify(V.JALONS_OFFRE.offre3).includes("Plan d'action"), "le plan d'action n'est pas une étape");
});

test("2. À traiter : une ligne par mission (deux missions ouvertes du même client = deux lignes), triées par urgence", () => {
  const m = V.missionsAPiloter(donnees);
  assert.deepEqual(m.map((x) => x.reference), ["INV-T-d1", "INV-T-d2", "INV-T-d3"], "mission close exclue");
  const [d1, d2, d3] = m;
  assert.deepEqual({ retard: d1.retardJours, action: d1.action, etape: d1.etape, balle: d1.balle, echeance: d1.echeance, conseiller: d1.conseiller, offre: d1.offre.court, jalon: d1.jalon },
    { retard: 4, action: "Relancer la banque", etape: "Financement", balle: "Profero (Conseiller A)", echeance: "2026-10-01", conseiller: "Conseiller A", offre: "Offre 2", jalon: "Financement" });
  assert.equal(d1.signaux.aujourdhui, true, "tâche du jour");
  assert.deepEqual(d2.blocages, [{ etape: "Analyse", motif: "Avis d'imposition manquant" }]);
  assert.equal(d2.offre.court, "Offre 3"); assert.equal(d2.conseiller, "Conseiller B"); assert.equal(d2.jalon, "Analyse");
  assert.equal(d3.signaux.attenteClient, true); assert.equal(d3.urgent, false, "attente client sans échéance proche : suit son cours");
});

test("3. compteurs et filtres du haut de « À traiter »", () => {
  const m = V.missionsAPiloter(donnees);
  assert.deepEqual(V.compteursATraiter(m), { enRetard: 1, bloquees: 1, aujourdhui: 1, attenteClient: 1 }, "une mission bloquée compte dans Bloquées, pas en attente client");
  assert.deepEqual(V.filtrerMissions(m, "bloquees").map((x) => x.reference), ["INV-T-d2"]);
  assert.deepEqual(V.filtrerMissions(m, "attenteClient").map((x) => x.reference), ["INV-T-d3"]);
  assert.deepEqual(Object.values(V.FILTRES_A_TRAITER), ["En retard", "Bloquées", "À faire aujourd'hui", "En attente client"]);
});

test("4. Clients : missions en cours, prochaine action, dernier contact (appel, rendez-vous, relance)", () => {
  const m = V.missionsAPiloter(donnees);
  const p = V.portefeuille({ clients: CLIENTS, dossiers: DOSSIERS, missions: m, notes: NOTES });
  const [a, b, g] = ["c1", "c2", "c3"].map((id) => p.find((x) => x.id === id));
  assert.deepEqual(a.missions.map((x) => x.reference), ["INV-T-d1", "INV-T-d2"]);
  assert.equal(a.prochaineAction, "Relancer la banque"); assert.equal(a.dernierContact, "2026-10-02", "une note interne n'est pas un contact");
  assert.equal(b.missionsTerminees, 1); assert.equal(b.email, null);
  assert.deepEqual([g.missions.length, g.prochaineAction, g.dernierContact], [0, null, null]);
  const inconnu = V.portefeuille({ clients: CLIENTS, dossiers: DOSSIERS, missions: null, notes: NOTES });
  assert.equal(inconnu[0].prochaineAction, "Avancement indisponible", "pilotage illisible ≠ aucune mission");
});

test("5. Actions & planning : En retard / Aujourd'hui / 7 jours / 30 jours, depuis les actions de mission uniquement", () => {
  const p = V.planningActions(donnees);
  assert.deepEqual(p.enRetard.map((x) => x.id), ["t1"]);
  assert.deepEqual(p.aujourdhui.map((x) => x.id), ["t2"]);
  assert.deepEqual(p.semaine.map((x) => x.id), ["t3"]);
  assert.deepEqual(p.mois.map((x) => x.id), ["t4"]);
  assert.deepEqual([p.auDela, p.sansEcheance], [1, 1], "ce qui sort des colonnes reste compté");
  assert.equal(p.enRetard[0].mission, "INV-T-d1"); assert.equal(p.enRetard[0].etape, "Financement");
  const hors = V.planningActions({ ...donnees, filtres: { dossierId: "sans" } });
  assert.equal(hors.auDela + hors.sansEcheance, 2);
  assert.equal(V.planningActions({ ...donnees, filtres: { conseiller: "Conseiller B" } }).enRetard.length, 0);
  assert.deepEqual(V.planningActions({ ...donnees, filtres: { clientId: "c2" } }).semaine.map((x) => x.id), ["t3"]);
});

test("6. Nouvelle mission : la règle actuelle d'une mission en cours est expliquée, pas contournée", () => {
  assert.equal(V.nouvelleMissionPossible([]).possible, true);
  assert.equal(V.nouvelleMissionPossible([DOSSIERS[3]]).possible, true, "une mission close ne bloque pas");
  const r = V.nouvelleMissionPossible([DOSSIERS[2]]);
  assert.equal(r.possible, false); assert.match(r.raison, /INV-T-d3 est en cours/);
});

test("7. Historique : notes et événements de mission regroupés, du plus récent au plus ancien", () => {
  const h = V.historiqueClient({ notes: NOTES.filter((n) => n.client_id === "c1"), dossiers: DOSSIERS,
    evenements: [{ id: "v1", dossier_id: "d1", ordre: 5, survenu_le: "2026-10-03T10:00:00Z", resume: "Étape Financement démarrée", auteur_libelle: "Conseiller A" }] });
  assert.deepEqual(h.map((x) => [x.genre, x.type, x.mission]), [["note", "Note", null], ["mission", "Mission", "INV-T-d1"], ["note", "Appel", null]]);
});

test("8. page Client : missions en cours, terminées, à faire (5 max), synthèse patrimoniale 2c, activité (5 max)", () => {
  const collecte = {
    invest_postes_financiers: [
      { famille: "revenu", categorie: "salaire", montant: 4000, periodicite: "mensuelle", base_revenu: "net_avant_impot", verification_statut: "verifiee" },
      { famille: "actif_financier", categorie: "epargne_disponible", montant: 50000, verification_statut: "non_verifiee" }],
    invest_engagements: [{ type: "credit_immobilier", mensualite: 1000, capital_restant_du: 180000, verification_statut: "a_corriger" }],
    invest_actifs_patrimoniaux: [{ usage: "residence_principale", statut: "detenu", valeur_estimee: 300000, verification_statut: "non_verifiee" },
      { usage: "locatif", statut: "detenu", valeur_estimee: 999999, verification_statut: "verifiee", archive_le: "2026-09-01" }],
  };
  const evenements = Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, dossier_id: "d1", ordre: i, survenu_le: `2026-09-2${i}T10:00:00Z`, resume: `Évt ${i}` }));
  const c = V.construireClient({ client: CLIENTS[1], ...donnees, collecte, notes: NOTES.filter((n) => n.client_id === "c2"), evenements });
  assert.deepEqual(c.missionsEnCours.map((m) => m.reference), ["INV-T-d3"]);
  assert.deepEqual(c.missionsTerminees.map((m) => [m.reference, m.motif]), [["INV-T-d4", "Acquisition réalisée"]]);
  assert.equal(c.nouvelleMission.possible, false);
  assert.ok(c.aFaire.length <= 5); assert.equal(c.aFaire[0].titre, "Attendre les pièces");
  assert.deepEqual([c.patrimoine.revenusMensuels, c.patrimoine.epargneDisponible, c.patrimoine.patrimoineNetSimplifie], [4000, 50000, 170000], "300 000 − 180 000 + 50 000 d'actifs financiers, calcul 2c");
  assert.deepEqual([c.patrimoine.total, c.patrimoine.verifiees, c.patrimoine.aCorriger], [4, 1, 1], "éléments archivés exclus");
  assert.equal(c.activite.length, 5); assert.equal(c.historique.length, 10);
  const vide = V.construireClient({ client: CLIENTS[2], ...donnees, collecte: {}, notes: [], evenements: [] });
  assert.equal(vide.patrimoine.vide, true); assert.equal(vide.missionsEnCours.length, 0); assert.equal(vide.entete.conseiller, null);
});

test("9. navigation : 3 vues CRM, 6 onglets Client ; pas de frise V20.4 dans la V2", () => {
  assert.deepEqual(V.VUES_CRM.map((v) => v.libelle), ["À traiter", "Clients", "Actions & planning"]);
  assert.deepEqual(V.ONGLETS_CLIENT.map((o) => o.libelle), ["Vue d'ensemble", "Missions", "Patrimoine", "Opérations", "Documents", "Historique"]);
  assert.ok(!/Frise d'avancement|renderCrmTimeline/.test(CRMV2 + FICHE));
});

test("10. intégration : V2 par défaut, ancienne vue séparée, aucun ancien composant supprimé, aucune logique dupliquée", () => {
  assert.match(CRM, /function CRM\(props\)[\s\S]*<CrmV2 [\s\S]*function CRMAncien\(/);
  assert.match(CRM, /Ancienne vue CRM/); assert.match(CRMV2, /Ancienne vue CRM/);
  assert.match(CRM, /export \{ CRM, FormulaireClient, FicheClient, MissionParcoursClientCard \}/);
  assert.match(FICHE, /<SituationPatrimonialeCard client=\{client\} T=\{T\} dossierEnCoursId=\{dossierEnCours\?\.id \?\? null\} dossierReference=\{dossierEnCours\?\.reference \?\? null\} integre \/>/);
  assert.match(FICHE, /<DocumentsSection folder=\{`clients\/\$\{client\.id\}`\} T=\{T\} lectureSeule \/>/);
  assert.match(SHARED, /\{!lectureSeule && <button\s+onClick=\{\(\) => supprimer/);
  assert.match(CRMV2, /<FicheDossier client=\{client\} T=\{T\} profil=\{profil\} dossierIdInitial=\{dossierId\}/);
  assert.ok(!/from\("invest_clients"\)\.(update|insert|delete|upsert)/.test(CRMV2 + FICHE), "la V2 ne modifie pas la fiche client");
  assert.ok(!/from\("invest_dossiers"\)\.(update|insert|delete|upsert)|from\("invest_dossier_etapes"\)\.(update|insert|delete|upsert)/.test(CRMV2 + FICHE));
  assert.ok(!/supabase|Date\.now|new Date\(\)/.test(VUE.replace(/^\/\/.*$/gm, "")), "module pur : ni base ni horloge");
  for (const imp of ["pilotageDossier", "actionDuJour", "calculerSituation"]) assert.match(VUE, new RegExp(`\\b${imp}\\b`));
});

let echecs = 0;
for (const [n, f] of cas) {
  try { await f(); console.log(`  ✓ ${n}`); }
  catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
