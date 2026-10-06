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
// Seule écriture permise sur invest_clients depuis la page Client : le statut des pièces demandées
// (strategie_data.documents_checklist), même emplacement que l'ancienne vue CRM.
const sansSuiviDocuments = (src) => src.replace(/from\("invest_clients"\)\.update\(\{ strategie_data: strat \}\)/g, "");
const CRMV2 = lire("src/Invest/crm/CrmV2.jsx") + lire("src/Invest/crm/CrmCartes.jsx");
const FICHE = lire("src/Invest/crm/FicheClientV2.jsx");
const VUE = lire("src/Invest/crm/crmV2Vue.mjs");
const SHARED = lire("src/Invest/_shared.jsx");
const PAGEINVEST = lire("src/Invest/PageInvest.jsx");
const ACCESS = lire("src/access.js");
const STRUCT = lire("src/Invest/Structuration.jsx");
const CASE = lire("src/Invest/crm/SujetStructuration.jsx");

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
  assert.match(FICHE, /<FicheDossier client=\{client\} T=\{T\} profil=\{profil\} dossierIdInitial=\{missionOuverte\}/, "la mission s'ouvre dans l'onglet Missions");
  assert.ok(!/from\("invest_clients"\)\.(update|insert|delete|upsert)/.test(sansSuiviDocuments(CRMV2 + FICHE)), "la V2 ne modifie pas la fiche client, hors suivi des pièces");
  assert.ok(!/from\("invest_dossiers"\)\.(update|insert|delete|upsert)|from\("invest_dossier_etapes"\)\.(update|insert|delete|upsert)/.test(CRMV2 + FICHE));
  assert.ok(!/supabase|Date\.now|new Date\(\)/.test(VUE.replace(/^\/\/.*$/gm, "")), "module pur : ni base ni horloge");
  for (const imp of ["pilotageDossier", "actionDuJour", "calculerSituation"]) assert.match(VUE, new RegExp(`\\b${imp}\\b`));
});

test("11. refonte : alertes d'une mission, de la plus grave à la moins grave, sans règle de pilotage nouvelle", () => {
  const m = V.missionsAPiloter(donnees);
  const d1 = m.find((x) => x.reference === "INV-T-d1"), d2 = m.find((x) => x.reference === "INV-T-d2"), d3 = m.find((x) => x.reference === "INV-T-d3");
  assert.deepEqual(V.alertesMission(d1, AUJ).map((a) => a.code), ["retard", "aujourdhui"], "retard d'abord, puis ce qui est dû aujourd'hui");
  assert.equal(V.alertesMission(d1, AUJ)[0].code, "retard"); assert.equal(V.alertesMission(d1, AUJ)[0].ton, "rouge");
  assert.equal(V.alertesMission(d2, AUJ)[0].code, "bloquee"); assert.match(V.alertesMission(d2, AUJ)[0].detail, /Avis d'imposition manquant/);
  assert.deepEqual(V.alertesMission(d3, AUJ).map((a) => [a.code, a.ton]), [["attente_client", "violet"]], "attente client : une couleur distincte, rien d'autre");
  const proche = { ...d3, signaux: { ...d3.signaux, attenteClient: false }, echeance: "2026-10-07" };
  assert.deepEqual(V.alertesMission(proche, AUJ).map((a) => a.code), ["proche"], "échéance dans 2 jours");
  const loin = { ...d3, signaux: { ...d3.signaux, attenteClient: false }, echeance: "2026-10-20" };
  assert.deepEqual(V.alertesMission(loin, AUJ), [], "rien à signaler : aucune alerte inventée");
  assert.equal(JSON.stringify(m.map((x) => [x.reference, x.priorite, x.urgent, x.retardJours])), JSON.stringify(V.missionsAPiloter(donnees).map((x) => [x.reference, x.priorite, x.urgent, x.retardJours])), "calcul de pilotage inchangé");
});

test("12. refonte : échéance lisible (retard rouge, proche orange) et filtres de la liste Clients", () => {
  assert.deepEqual(V.echeanceCourte("2026-10-01", AUJ), { texte: "01/10 · 4 j de retard", ton: "rouge" });
  assert.deepEqual(V.echeanceCourte(AUJ, AUJ), { texte: "Aujourd'hui", ton: "orange" });
  assert.deepEqual(V.echeanceCourte("2026-10-07", AUJ), { texte: "07/10 · dans 2 j", ton: "orange" });
  assert.equal(V.echeanceCourte("2026-10-20", AUJ).ton, "neutre");
  assert.equal(V.echeanceCourte("2027-02-03", AUJ).texte, "03/02/2027");
  assert.equal(V.echeanceCourte(null, AUJ).vide, true);
  const lignes = V.portefeuille({ clients: CLIENTS, dossiers: DOSSIERS, missions: V.missionsAPiloter(donnees), notes: NOTES });
  const ids = (f) => V.filtrerPortefeuille(lignes, f).map((l) => l.id).sort();
  assert.deepEqual(ids({}), ["c1", "c2", "c3"]);
  assert.deepEqual(ids({ mission: "avec" }), ["c1", "c2"]);
  assert.deepEqual(ids({ mission: "sans" }), ["c3"]);
  assert.deepEqual(ids({ q: "alpha" }), ["c1"]);
  assert.deepEqual(ids({ q: "0600000002" }), ["c2"], "la recherche couvre le téléphone même s'il n'est plus affiché");
  assert.deepEqual(ids({ statut: "Prospect" }), ["c3"]);
  assert.deepEqual(ids({ conseiller: "Conseiller A" }), ["c1", "c2"], "le conseiller affiché est celui de la mission en cours");
  assert.deepEqual(ids({ conseiller: "Conseiller B" }), [], "aucune mission en cours chez B pour ces clients");
  const offreC1 = lignes.find((l) => l.id === "c1").missions[0].offre;
  assert.ok(ids({ offre: offreC1 }).includes("c1") && !ids({ offre: offreC1 }).includes("c3"));
  assert.deepEqual(ids({ offre: "Offre inexistante" }), []);
});

test("13. refonte : planning — statut par action, liste sans échéance, comptes d'origine inchangés", () => {
  const p = V.planningActions(donnees);
  assert.equal(p.enRetard[0].statut, "À faire"); assert.equal(p.semaine[0].statut, "En cours");
  assert.deepEqual(p.sansEcheanceListe.map((x) => x.id), ["t6"]);
  assert.equal(p.sansEcheance, p.sansEcheanceListe.length);
});

test("14. refonte : écran CRM — trois vues compactes, aucune écriture, pilotage seulement par le moteur Dossier", () => {
  assert.match(CRMV2, /alertesMission, echeanceCourte, filtrerPortefeuille/);
  assert.ok(!/etape_num|invest_clients\.etape|\.etape_num|c\.etape\b/.test(CRMV2), "aucun retour aux anciennes étapes client");
  assert.ok(!/\.(update|insert|delete|upsert)\(/.test(CRMV2), "le CRM ne modifie rien");
  assert.ok(!/maxWidth: 1320/.test(CRMV2), "l'espace horizontal est utilisé");
  for (const vue of ["a_traiter", "clients", "planning"]) assert.match(CRMV2, new RegExp(`vue === "${vue}"`));
  assert.match(CRMV2, /onMission\(m\.clientId, m\.dossierId\)/, "ligne À traiter -> mission");
  assert.match(CRMV2, /onClient\(m\.clientId\)/, "nom du client -> page Client");
  assert.match(CRMV2, /onClient\(l\.id\)/, "ligne Clients -> page Client");
  assert.ok(!/Missions qui suivent leur cours|Ce que l'équipe doit traiter, les clients suivis/.test(CRMV2), "blocs et textes explicatifs supprimés");
});

test("15. structuration : l'onglet n'existe que pour les clients cochés, juste après Patrimoine", () => {
  assert.deepEqual(V.ongletsClient({ sujet_structuration: false }).map((o) => o.cle), V.ONGLETS_CLIENT.map((o) => o.cle));
  assert.deepEqual(V.ongletsClient(null).map((o) => o.cle), V.ONGLETS_CLIENT.map((o) => o.cle));
  assert.deepEqual(V.ongletsClient({ sujet_structuration: "true" }).map((o) => o.cle), V.ONGLETS_CLIENT.map((o) => o.cle), "seul true compte");
  const avec = V.ongletsClient({ sujet_structuration: true }).map((o) => o.cle);
  assert.deepEqual(avec, ["ensemble", "missions", "patrimoine", "structuration", "operations", "documents", "historique"]);
});

test("16. structuration : liste Clients — marqueur et filtre « avec sujet » / « recherche seule »", () => {
  const clients = CLIENTS.map((c) => (c.id === "c2" ? { ...c, sujet_structuration: true } : c));
  const lignes = V.portefeuille({ clients, dossiers: DOSSIERS, missions: V.missionsAPiloter({ ...donnees, clients }), notes: NOTES });
  assert.deepEqual(lignes.filter((l) => l.structuration).map((l) => l.id), ["c2"]);
  const ids = (f) => V.filtrerPortefeuille(lignes, f).map((l) => l.id).sort();
  assert.deepEqual(ids({ structuration: "oui" }), ["c2"]);
  assert.deepEqual(ids({ structuration: "non" }), ["c1", "c3"]);
  assert.deepEqual(ids({ structuration: "" }), ["c1", "c2", "c3"]);
  assert.deepEqual(ids({ structuration: "oui", mission: "sans" }), [], "les filtres se cumulent");
});

test("17. structuration : plus de page dans le menu, anciens liens redirigés vers la fiche client, rien d'auto-créé", () => {
  assert.ok(!/id: "structuration"/.test(PAGEINVEST + ACCESS + SHARED), "plus d'entrée de menu ni de page injectée");
  assert.ok(!/"structuration",?\s*$/m.test(ACCESS), "retirée des droits par défaut");
  assert.ok(!/<StructurationPatrimoniale|from "\.\/Structuration"/.test(PAGEINVEST), "PageInvest n'affiche plus l'ancien écran");
  assert.match(PAGEINVEST, /cible\?\.tab === "structuration"\) cible = \{ \.\.\.cible, tab: "crm"/);
  assert.match(PAGEINVEST, /setCrmInitialFilter\(\{ tab: "crm", action: "open", id: clientId, onglet: "structuration" \}\)/);
  assert.match(CRMV2, /onglet: initialFilter\?\.onglet/);
  // mode intégré : un seul client, aucune création automatique
  assert.match(STRUCT, /filter\(d => !clientIdFixe \|\| d\.client_id === clientIdFixe\)/);
  assert.match(STRUCT, /if \(clientIdFixe \|\| !initialClientId \|\| initialHandledRef\.current \|\| loading\) return;/);
  assert.match(STRUCT, /onClick=\{\(\) => creerDossier\(clientIdFixe\)\}>Créer le dossier de structuration/);
  assert.match(FICHE, /<StructurationPatrimoniale key=\{client\.id\} profil=\{profil\} T=\{T\} clientIdFixe=\{client\.id\} \/>/);
});

test("18. structuration : la case n'écrit que invest_clients.sujet_structuration, et les blocs du menu sont posés", () => {
  assert.match(CASE, /\.update\(\{ sujet_structuration: !actif \}\)\.eq\("id", client\.id\)/);
  assert.ok(!/\.(insert|delete|upsert)\(/.test(CASE));
  assert.ok(!/from\("invest_clients"\)\.(update|insert|delete|upsert)/.test(sansSuiviDocuments(CRMV2 + FICHE)), "l'écriture reste hors du CRM et de la page Client, hors suivi des pièces");
  for (const [id, g] of [["dashboard", "Pilotage"], ["crm", "Pilotage"], ["biens", "Biens"], ["urbanisme", "Biens"], ["simulateur", "Finance"], ["suivi_financier", "Finance"]])
    assert.match(PAGEINVEST, new RegExp(`${id}: "${g}"`));
  for (const id of ["simulateur", "finance", "suivi_financier", "sourcing", "biens", "etat_des_lieux", "urbanisme", "admin"]) assert.match(PAGEINVEST, new RegExp(`\\{ id: "${id}",`), `${id} toujours dans le menu`);
});

test("19. refonte fiche Client : l'action d'une mission n'est plus répétée dans la liste d'actions", () => {
  assert.match(FICHE, /const autres = vue\.aFaire\.filter\(\(a\) => !String\(a\.id\)\.startsWith\("m-"\)\);/);
  assert.match(FICHE, /titre="Autres actions à venir"/);
  const ensemble = FICHE.slice(FICHE.indexOf("function VueEnsemble"), FICHE.indexOf("function LigneMission"));
  assert.ok(ensemble.length > 500 && !/titre="Opérations"/.test(ensemble), "bloc vide « Opérations » retiré de la vue d'ensemble");
  assert.match(FICHE, /onglet === "operations"/, "l'onglet Opérations, lui, reste");
  // les données ne changent pas : le modèle de la page Client produit toujours les mêmes actions
  const m = V.construireClient({ client: CLIENTS[0], dossiers: DOSSIERS, etapes: ETAPES, taches: TACHES, utilisateurs: U, aujourdhui: AUJ });
  assert.ok(m.aFaire.some((a) => String(a.id).startsWith("m-")) && m.aFaire.some((a) => !String(a.id).startsWith("m-")));
});

let echecs = 0;
for (const [n, f] of cas) {
  try { await f(); console.log(`  ✓ ${n}`); }
  catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
