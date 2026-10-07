// scripts/verif-mission-offre2.mjs — intérieur d'une mission Offre 2 (sept onglets, frise, offre, acquisition, financement, travaux, transmission).
// Tous les exemples sont des fixtures de test : données FICTIVES, aucun vrai client.
// Usage : node scripts/verif-mission-offre2.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as O from "../src/Invest/dossiers/offre2Vue.mjs";
import { construireFiche } from "../src/Invest/dossiers/ficheDossierVue.mjs";
import { nettoyerConditions } from "../src/Invest/dossiers/calculAcquisition.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AUJ = "2026-10-07";
const CLE = ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites", "financement", "structuration", "acquisition", "suivi"];
const cas = [];
const test = (n, f) => cas.push([n, f]);

// Mission fictive : `statuts` = statuts des étapes (par défaut « à venir »), le reste en paramètres.
function mission({ statuts = {}, principale, propositions = [], acquisitions = [], banques = [], financement = null, suivi, dossier = {}, collecte = {}, checklist = {}, taches = [], etapesExtra = {} } = {}) {
  const etapes = CLE.map((c) => ({ id: `e-${c}`, dossier_id: "d1", etape: c, operation_id: null, statut: statuts[c] || "a_venir", balle: c === principale ? "profero" : "profero",
    prochaine_action: etapesExtra[c]?.prochaine_action ?? null, echeance: etapesExtra[c]?.echeance ?? null, updated_at: "2026-10-01T00:00:00Z" }));
  const d = { id: "d1", client_id: "c1", reference: "INV-T-0001", libelle: "Projet fictif", type_mission: "accompagnement_acquisition", statut: "actif", conseiller_id: "u1", date_ouverture: "2026-06-01",
    questionnaire_data: {}, questionnaire_statut: "brouillon", ...(suivi !== undefined ? { suivi_offre2: suivi } : {}), ...dossier };
  const utilisateurs = [{ id: "u1", nom: "Conseiller Test", email: "c@test.fr", actif: true }];
  const client = { id: "c1", nom: "Client", prenom: "Test" };
  const donnees = { etapes, taches, evenements: [], collecte };
  const fiche = construireFiche({ client, dossiers: [d], idChoisi: "d1", etapes, evenements: [], taches, utilisateurs, collecte, aujourdhui: AUJ });
  const extra = { propositions, acquisitions, financement, banques, strategie: null, scenarios: [], hypotheses: {}, notes: [] };
  return { fiche, m: O.construireModeleMission({ extra, donnees, fiche, strategieClient: { documents_checklist: checklist }, aujourdhui: AUJ }), d };
}
const bien = (id, extra = {}) => ({ id, adresse: `${id} rue Test`, ville: "Ville", prix_vente: 150000, visite_data: {}, ...extra });
const prop = (id, statut, b = bien(id), date = "2026-09-20") => ({ id: `p-${id}`, bien_id: b.id, statut, date_proposition: date, created_at: `${date}T10:00:00Z`, commentaire: "", bien: b });
const FINI = { signature: "terminee", collecte: "terminee", documents: "terminee", analyse: "terminee", strategie: "terminee" };
const etat = (m, cle) => m.frise.jalons.find((j) => j.cle === cle).etat;

test("1. navigation : sept onglets, anciennes entrées redirigées sans rien perdre", () => {
  assert.deepEqual(O.NAV_OFFRE2.map((o) => o.libelle), ["Vue d'ensemble", "Projet", "Recherche & biens", "Offre & acquisition", "Financement", "Travaux", "Transmission"]);
  assert.deepEqual(["situation", "documents", "analyse", "strategie", "opportunites", "acquisition", "financement", "inconnu"].map(O.ongletMissionValide),
    ["projet", "ensemble", "projet", "projet", "biens", "offre", "financement", "ensemble"]);
  assert.deepEqual(O.JALONS_MISSION.map((j) => j.libelle), ["Projet", "Recherche", "Bien", "Offre", "Acquisition", "Financement", "Travaux", "Transmission"]);
});
test("2. cas 1 — mission en phase Projet : l'étape actuelle est Projet", () => {
  const { m } = mission({ statuts: { signature: "terminee", collecte: "en_cours" }, principale: "collecte" });
  assert.equal(m.frise.courante, "projet"); assert.equal(etat(m, "projet"), "cours"); assert.equal(etat(m, "recherche"), "avenir");
});
test("3. cas 2 et 16 — Recherche en cours, ancien parcours : l'étape historique « recherche » donne Recherche (aucune donnée n'est réécrite)", () => {
  const { m } = mission({ statuts: { ...FINI, recherche: "en_cours" }, principale: "recherche" });
  assert.equal(m.frise.courante, "recherche"); assert.equal(m.frise.libelleCourant, "Recherche"); assert.equal(etat(m, "projet"), "termine");
  for (const [legacy, jalon] of Object.entries({ signature: "projet", collecte: "projet", analyse: "projet", strategie: "projet", documents: "projet", recherche: "recherche", opportunites: "bien", financement: "financement", acquisition: "acquisition" })) assert.equal(O.ETAPE_VERS_JALON[legacy], jalon, legacy);
  assert.equal(O.ETAPE_VERS_JALON.suivi, "suivi", "« Suivi » se résout selon les données (travaux ou transmission)");
  const { m: m2 } = mission({ statuts: { ...FINI, recherche: "terminee", opportunites: "terminee", financement: "terminee", acquisition: "terminee", suivi: "en_cours" }, principale: "suivi" });
  assert.equal(m2.frise.courante, "transmission", "Suivi sans travaux connus : Transmission");
  const { m: m3 } = mission({ statuts: { ...FINI, suivi: "en_cours" }, principale: "suivi", acquisitions: [{ id: "a", bien_id: "b", acte_signe_le: "2026-09-01", compromis_signe_le: "2026-08-01", travaux_debut_le: "2026-09-10" }], propositions: [prop("b", "retenu")] });
  assert.equal(m3.frise.courante, "travaux", "Suivi avec travaux démarrés : Travaux");
});
test("4. cas 3, 4, 18 — plusieurs biens étudiés, bien retenu, aucun bien", () => {
  const { m } = mission({ propositions: [prop("a", "en analyse"), prop("b", "proposé"), prop("c", "refusé"), prop("d", "refusé"), prop("e", "visité"), prop("f", "visite prévue"), prop("g", "retenu")] });
  assert.deepEqual([m.synthR.etudies, m.synthR.aAnalyser, m.synthR.ecartes, m.synthR.visites, m.synthR.retenus], [7, 2, 2, 1, 1]);
  assert.equal(m.synthR.retenu.bienId, "g"); assert.equal(etat(m, "bien"), "termine"); assert.equal(etat(m, "offre"), "cours"); assert.equal(m.frise.courante, "offre");
  assert.equal(m.lignes.length, 7, "aucun bien n'est perdu quand un autre est retenu");
  const vide = mission().m;
  assert.deepEqual([vide.synthR.etudies, vide.synthR.retenu], [0, null]); assert.equal(etat(vide, "bien"), "avenir");
  assert.equal(O.statutBien("valeur inconnue"), "propose", "une valeur inconnue reste visible");
  assert.equal(O.statutBien("offre en cours"), "retenu"); assert.equal(O.statutBien("intéressé"), "propose");
  assert.ok(mission({ propositions: [prop("a", "retenu"), prop("b", "retenu")] }).m.anomalies.some((a) => a.code === "plusieurs_retenus"), "un seul bien principal");
});
test("5. cas 5 et 6 — offre en négociation puis acceptée", () => {
  const b = (statut) => bien("o", { montant_offre: 140000, visite_data: { offre_achat: { statut, prix_recommande: 142000, arguments: "Négociation interne" } } });
  const neg = mission({ propositions: [prop("o", "retenu", b("En négociation"))] }).m;
  assert.equal(neg.offre.statut, "En négociation"); assert.deepEqual([neg.offre.prixAffiche, neg.offre.prixConseille, neg.offre.prixPropose], [150000, 142000, 140000]); assert.equal(etat(neg, "offre"), "cours");
  const ok = mission({ propositions: [prop("o", "retenu", b("Acceptée"))], statuts: { ...FINI, recherche: "terminee", opportunites: "terminee", acquisition: "en_cours" }, principale: "acquisition" }).m;
  assert.equal(etat(ok, "offre"), "termine"); assert.equal(ok.frise.courante, "acquisition"); assert.equal(O.offreAcceptee(ok.offre.statut), true);
  assert.equal(mission({ propositions: [prop("o", "retenu", b("Refusée"))] }).m.frise.jalons.find((j) => j.cle === "offre").etat, "bloque");
  assert.ok(mission({ propositions: [prop("o", "retenu", b("Abandonnée"))] }).m.anomalies.some((a) => a.code === "offre_refusee"));
  assert.equal(mission({ propositions: [prop("o", "retenu", bien("o"))] }).m.offre.vide, true, "bien sans offre : offre vide, pas d'offre inventée");
});
test("6. offre : écriture sur la fiche du bien — le reste de la fiche est conservé, statut hérité jamais écrasé, 0 ≠ vide", () => {
  const b = bien("o", { visite_data: { general: { surface_totale: 80 }, offre_achat: { statut: "À envoyer", arguments: "ancien" } }, montant_offre: 100 });
  const p = O.patchOffre(b, { statut: "À envoyer", prixConseille: "", prixPropose: "0", dateOffre: "2026-10-01", dateLimite: "", negociation: "ancien" });
  assert.equal(p.montant_offre, 0, "0 € reste 0"); assert.equal(p.visite_data.general.surface_totale, 80); assert.equal(p.visite_data.offre_achat.statut, "À envoyer");
  assert.equal(O.patchOffre(b, { statut: "Envoyée", prixPropose: "", prixConseille: "" }).montant_offre, null, "vide = non renseigné");
  assert.throws(() => O.patchOffre(b, { statut: "Inventé", prixPropose: "" }), /inconnu/); assert.throws(() => O.patchOffre(b, { statut: "Envoyée", prixPropose: "abc" }), /invalide/); assert.throws(() => O.patchOffre(b, { statut: "Envoyée", prixPropose: "-5" }), /négatif/);
  assert.ok(O.statutsOffreProposes("À envoyer").includes("À envoyer") && !O.statutsOffreProposes("Envoyée").includes("À envoyer"));
  assert.deepEqual(O.STATUTS_OFFRE, ["À préparer", "Envoyée", "En négociation", "Contre-offre", "Acceptée", "Refusée", "Abandonnée"]);
});
test("7. cas 7 — compromis signé : progression offre → compromis → conditions → acte", () => {
  const A = (x) => ({ id: "a", bien_id: "b", libelle: "Bien", offre_acceptee_le: "2026-08-01", ...x });
  const P = (a) => O.progressionAcquisition({ acquisition: a });
  assert.deepEqual(P(A({})).etapes.map((e) => e.etat), ["termine", "cours", "avenir", "avenir"]);
  const cs = P(A({ compromis_signe_le: "2026-08-20", conditions_suspensives: [{ libelle: "Prêt", levee_le: "", type: "Financement" }, { libelle: "Urbanisme", statut: "levee", levee_le: "2026-09-01" }] }));
  assert.deepEqual(cs.etapes.map((e) => e.etat), ["termine", "termine", "cours", "avenir"]); assert.equal(cs.courante, "Conditions suspensives"); assert.equal(cs.conditionsOuvertes, 1);
  const pret = P(A({ compromis_signe_le: "2026-08-20", conditions_suspensives: [{ libelle: "Prêt", statut: "levee", levee_le: "2026-09-01" }, { libelle: "Division", statut: "na" }] }));
  assert.deepEqual(pret.etapes.map((e) => e.etat), ["termine", "termine", "termine", "cours"]);
  assert.deepEqual(P(A({ compromis_signe_le: "2026-08-20", acte_signe_le: "2026-09-30" })).etapes.map((e) => e.etat), ["termine", "termine", "termine", "termine"]);
  assert.equal(P(A({ compromis_signe_le: "2026-08-20" })).aucuneCondition, true);
  assert.deepEqual(P(null).etapes.map((e) => e.etat), ["avenir", "avenir", "avenir", "avenir"], "sans acquisition : rien d'inventé");
  assert.equal(O.statutCondition({ libelle: "x", levee_le: "2026-01-01" }), "levee", "ancienne condition levée : lue comme levée"); assert.equal(O.statutCondition({ libelle: "x" }), "a_verifier");
  assert.deepEqual(Object.keys(O.STATUTS_CONDITION), ["a_verifier", "en_cours", "levee", "non_realisee", "na"]);
  const net = nettoyerConditions([{ libelle: " Prêt ", echeance: "2026-09-01", levee_le: "", statut: "en_cours", type: "Financement" }, { libelle: "A", echeance: "", levee_le: "" }]);
  assert.deepEqual(net[0], { libelle: "Prêt", echeance: "2026-09-01", levee_le: null, statut: "en_cours", type: "Financement" }); assert.deepEqual(net[1], { libelle: "A", echeance: null, levee_le: null }, "ancien format inchangé");
});
test("8. cas 8, 9, 19 — financement en cours, accepté, absent", () => {
  assert.equal(O.statutFinancement({}).libelle, "À constituer"); assert.equal(O.statutFinancement({}).demarre, false);
  const sans = mission().m; assert.equal(etat(sans, "financement"), "avenir");
  const cours = mission({ financement: { dossier_statut: "transmis" }, banques: [{ id: 1, banque: "B1", statut: "dossier_depose" }] }).m;
  assert.equal(cours.finance.libelle, "Étude banque"); assert.equal(etat(cours, "financement"), "cours");
  assert.equal(O.statutFinancement({ financement: { dossier_statut: "transmis" } }).libelle, "Transmis");
  assert.equal(O.statutFinancement({ financement: { dossier_statut: "pret" } }).libelle, "Complet");
  assert.equal(O.statutFinancement({ banques: [{ statut: "accord_principe" }] }).libelle, "Accord"); assert.equal(O.statutFinancement({ banques: [{ statut: "offre_recue" }] }).libelle, "Offre de prêt");
  const ok = mission({ banques: [{ id: 1, statut: "offre_acceptee", retenue: true, montant_accorde: 120000 }] }).m;
  assert.equal(ok.finance.acceptee, true); assert.equal(etat(ok, "financement"), "termine");
  assert.equal(etat(mission({ banques: [{ statut: "refus" }, { statut: "abandon" }] }).m, "financement"), "bloque");
  assert.deepEqual(O.PIPELINE_FINANCEMENT, ["À constituer", "Complet", "Transmis", "Étude banque", "Accord", "Offre de prêt", "Acceptée"]);
});
test("9. cas 10, 11 — travaux Profero Rénovation, travaux non applicables, non renseignés", () => {
  const A = { id: "a", bien_id: "b", acte_signe_le: "2026-09-01", compromis_signe_le: "2026-08-01", travaux_debut_le: "2026-09-10", budget_travaux: 30000 };
  const profero = O.lireTravaux({ acquisition: A, suivi: { travaux: { mode: "profero", chantier: "Chantier fictif" } } });
  assert.deepEqual([profero.mode, profero.etat, profero.budget, profero.chantier], ["profero", "cours", 30000, "Chantier fictif"]);
  assert.equal(O.lireTravaux({ acquisition: { ...A, travaux_fin_le: "2026-10-01" } }).etat, "termine");
  assert.equal(O.lireTravaux({ acquisition: { budget_travaux: 0 } }).etat, "na", "budget 0 € saisi = pas de travaux");
  assert.equal(O.lireTravaux({ suivi: { travaux: { mode: "aucun" } } }).etat, "na");
  const inconnu = O.lireTravaux({ acquisition: { budget_travaux: null } });
  assert.deepEqual([inconnu.etat, inconnu.budget, inconnu.mode], ["inconnu", null, null], "non renseigné ≠ 0 €");
  assert.equal(etat(mission({ suivi: { travaux: { mode: "aucun" } }, acquisitions: [A], propositions: [prop("b", "retenu")] }).m, "travaux"), "na");
});
test("10. cas 12, 13 — mission prête à transmettre, puis terminée", () => {
  const A = { id: "a", bien_id: "b", acte_signe_le: "2026-09-01", compromis_signe_le: "2026-08-01", budget_travaux: 0 };
  const docs = { total: 5, recus: 5 };
  const F = { acceptee: true };
  const sans = O.checklistTransmission({ acquisition: A, finance: F, travaux: O.lireTravaux({ acquisition: A }), transmission: O.lireTransmission(null), documents: docs });
  assert.deepEqual(sans.manquants.map((i) => i.cle), ["transmis"]); assert.equal(sans.terminable, false);
  assert.equal(sans.items.find((i) => i.cle === "travaux").etat, "na");
  const pret = O.checklistTransmission({ acquisition: A, finance: F, travaux: O.lireTravaux({ acquisition: A }), transmission: O.lireTransmission({ transmission: { date: "2026-10-05", destinataire: "Gestionnaire fictif", documents: ["Acte", ""] } }), documents: docs });
  assert.equal(pret.terminable, true); assert.deepEqual(O.lireTransmission({ transmission: { documents: ["Acte", ""] } }).documents, ["Acte"]);
  assert.equal(O.checklistTransmission({ acquisition: A, finance: F, travaux: { etat: "na" }, transmission: { date: "x" }, documents: docs, clos: true }).terminable, false, "une mission close ne se termine pas deux fois");
  assert.equal(O.checklistTransmission({ acquisition: null, finance: {}, travaux: { etat: "inconnu" }, transmission: {}, documents: { total: 0, recus: 0 } }).manquants.length, 5);
  const close = mission({ dossier: { statut: "clos" }, statuts: { ...FINI, suivi: "terminee" } }).m;
  assert.equal(etat(close, "transmission"), "termine");
  const s = O.syntheseOperation({ acquisition: { prix_signe: 150000, budget_travaux: 20000, acte_signe_le: "2026-09-01" }, bien: { loyers: 900, rendement: 6.5 }, banques: [{ retenue: true, montant_accorde: 140000 }], apport: 0, transmission: { date: "2026-10-05" } });
  assert.deepEqual([s.prixAchat, s.travaux, s.coutGlobal, s.financement, s.apport, s.loyerCible], [150000, 20000, 170000, 140000, 0, 900]); assert.equal(s.frais, null, "frais non renseignés : null, pas 0");
  const vide = O.syntheseOperation({}); assert.deepEqual([vide.prixAchat, vide.coutGlobal, vide.financement, vide.apport], [null, null, null, null]);
});
test("11. cas 14, 15, 17 — patrimoine vide, documents incomplets, aucune prochaine action", () => {
  const { m, fiche } = mission({ statuts: { ...FINI, recherche: "en_cours" }, principale: "recherche" });
  const codes = m.anomalies.map((a) => a.code);
  assert.ok(codes.includes("sans_action") && codes.includes("patrimoine") && codes.includes("documents") && codes.includes("capacite"), codes.join());
  assert.equal(fiche.aFaire.sansAction, true); assert.equal(m.patrimoine.vide, true);
  assert.match(m.anomalies.find((a) => a.code === "sans_action").libelle, /Aucune prochaine action définie alors que Profero a la balle/);
  assert.equal(m.capaciteEvaluee, false, "revenus non renseignés : capacité non évaluée, jamais 0 €");
  assert.equal(m.actions.tout[0].id, "definir"); assert.deepEqual(m.actions.tout[0].boutons, ["definir"]);
  const avec = mission({ statuts: { ...FINI, recherche: "en_cours" }, principale: "recherche", etapesExtra: { recherche: { prochaine_action: "Appeler l'agence", echeance: "2026-10-30" } } });
  assert.equal(avec.fiche.aFaire.sansAction, false); assert.ok(!avec.m.anomalies.some((a) => a.code === "sans_action"));
  assert.ok(avec.m.actions.tout.some((a) => a.source === "mission" && a.titre === "Appeler l'agence" && a.boutons[0] === "ouvrir_etape"));
  const tout = mission({ checklist: { identite: "recu", solvabilite: "valide", avis_imposition: "recu", releves_bancaires: "recu", strategie: "recu", accord_mandat: "recu" }, collecte: { invest_personnes: [{ id: 1 }], invest_postes_financiers: [{ famille: "revenu" }, { famille: "actif_financier" }], invest_engagements: [{ id: 2 }], invest_actifs_patrimoniaux: [{ id: 3 }] } }).m;
  assert.equal(tout.docs.recus, tout.docs.total); assert.equal(tout.patrimoine.pourcentage, 100); assert.ok(!tout.anomalies.some((a) => ["patrimoine", "documents"].includes(a.code)));
  const blocage = mission({ statuts: { recherche: "bloquee" }, principale: "recherche" }).m;
  assert.ok(blocage.actions.tout.some((a) => a.source === "blocage" && a.priorite === "Urgente")); assert.equal(etat(blocage, "recherche"), "bloque");
});
test("12. projet : objectifs et critères lus dans le questionnaire ; absent = null, 0 = 0 ; capacité jamais convertie en 0", () => {
  const q = (cle, valeur) => ({ [cle]: { valeur } });
  const c = O.criteresProjet({ ...q("objectifs__budget", 200000), ...q("objectifs__apport_souhaite", 0), ...q("objectifs__zones", "Zone fictive"), ...q("objectifs__typologies", ["immeuble"]), ...q("objectifs__travaux", "renovation"), ...q("objectifs__rendement_minimum", 7) });
  const o = Object.fromEntries(c.objectifs.map((x) => [x.cle, x.valeur])), k = Object.fromEntries(c.criteres.map((x) => [x.cle, x.valeur]));
  assert.deepEqual([o.budget, o.apport, o.zones, o.typologies], [200000, 0, "Zone fictive", "Immeuble"]); assert.deepEqual([k.travaux, k.rendement, k.autofinancement], ["Rénovation", 7, null]);
  const rien = O.criteresProjet({}); assert.ok([...rien.objectifs, ...rien.criteres].every((x) => x.valeur === null));
  assert.equal(O.nombreOuNull(0), 0); assert.equal(O.nombreOuNull(""), null); assert.equal(O.nombreOuNull(undefined), null); assert.equal(O.nombreOuNull("1 250,5 €"), 1250.5);
});
test("13. aucun état ne plante : entrées vides, colonnes absentes, données partielles", () => {
  assert.doesNotThrow(() => O.friseMission({})); assert.doesNotThrow(() => O.lireOffre(null)); assert.doesNotThrow(() => O.lignesRecherche(undefined)); assert.doesNotThrow(() => O.activiteMission({}));
  assert.doesNotThrow(() => O.anomaliesMission({})); assert.doesNotThrow(() => O.syntheseRecherche()); assert.doesNotThrow(() => O.etapeADefinir({}));
  const m = mission({ propositions: [{ id: "x", bien_id: null, statut: null, bien: null }], acquisitions: [{ id: "a" }], banques: [{ id: "b" }], financement: {} }).m;
  assert.equal(m.suiviDisponible, false, "colonne suivi_offre2 absente : lecture seule explicite, pas d'erreur");
  assert.equal(mission({ suivi: null }).m.suiviDisponible, true); assert.equal(mission({ suivi: { travaux: { mode: "aucun" } } }).m.travaux.mode, "aucun");
  assert.equal(m.frise.jalons.length, 8);
  assert.deepEqual(O.majSuivi({ travaux: { mode: "aucun" } }, "transmission", { date: "2026-10-01" }), { travaux: { mode: "aucun" }, transmission: { date: "2026-10-01" } });
  assert.throws(() => O.majSuivi({}, "autre", {}), /inconnue/);
  const ev = O.activiteMission({ evenements: [{ id: 1, type: "etape_balle_change", resume: "technique", survenu_le: "2026-10-01T10:00:00Z" }, { id: 2, type: "etape_statut_change", resume: "Étape terminée", survenu_le: "2026-10-02T10:00:00Z" }],
    notes: [{ id: 3, type: "appel", contenu: "Appel test", date: "2026-10-03" }], lignes: O.lignesRecherche([prop("z", "refusé", bien("z"), "2026-10-04")]) });
  assert.deepEqual(ev.map((e) => e.genre), ["Bien", "Appel", "Mission"], "journal technique exclu, tri du plus récent au plus ancien");
});
test("14. câblage : Offre 2 seulement, onglets Situation/Documents/Analyse/Stratégie/Opportunités retirés de la navigation, aucune écriture hors périmètre", () => {
  const FD = sansCommentaires(lire("src/Invest/dossiers/FicheDossier.jsx"));
  assert.match(FD, /if \(fiche\.dossier\.type_mission === "accompagnement_acquisition"\) \{\s*return \(\s*<div id="fiche-dossier"[\s\S]*?<MissionOffre2 /, "seule l'Offre 2 utilise la nouvelle mission");
  assert.match(FD, /\{onglet === "situation" &&/, "l'ancienne fiche (Offre 3 et autres) reste inchangée");
  const fichiers = readdirSync(join(racine, "src/Invest/dossiers")).filter((n) => /^Mission(Offre2|Ensemble|Projet|Biens|OffreAcquisition|Financement|Travaux|Transmission|Ui)\.jsx$/.test(n));
  assert.equal(fichiers.length, 9);
  const tout = fichiers.map((n) => sansCommentaires(lire(`src/Invest/dossiers/${n}`))).join("\n");
  assert.ok(!/\.delete\(/.test(tout), "aucune suppression : ni bien, ni banque, ni acquisition");
  assert.ok(!/from\("invest_dossier_etapes"\)\.(update|insert|delete|upsert)/.test(tout), "le parcours à 11 étapes n'est jamais réécrit");
  assert.ok(!/from\("invest_clients"\)\.(update|insert|delete|upsert)/.test(tout), "le client n'est pas modifié depuis la mission");
  assert.ok(!/invest_personnes|invest_postes_financiers|invest_engagements|invest_actifs_patrimoniaux/.test(tout.replace(/collecte/g, "")), "aucune seconde situation patrimoniale");
  assert.ok(/window\.confirm\([^)]*Terminer la mission/.test(tout) && /statut: "clos"/.test(tout), "la clôture demande confirmation");
  assert.ok(!/lucide/.test(tout), "aucune icône Lucide");
  assert.ok(!/marius|cgp49|jules|landais/i.test(tout + sansCommentaires(lire("src/Invest/dossiers/offre2Vue.mjs"))), "aucune donnée client en dur");
  assert.ok(!/supabase|Date\.now|new Date\(\)/.test(sansCommentaires(lire("src/Invest/dossiers/offre2Vue.mjs"))), "module de calcul pur : ni base ni horloge");
  assert.ok(/<StrategieMission /.test(tout) && /<AnalyseMission /.test(tout) && /<ProjetSituationCard /.test(tout) && /<FinancementMission /.test(tout) && /<AcquisitionMission /.test(tout), "les écrans existants restent accessibles : aucune donnée ni fonction perdue");
});
test("15. portail client : rien de la mission interne n'est exposé", () => {
  const portail = readdirSync(join(racine, "src/Portail")).filter((n) => /\.(jsx|mjs|js)$/.test(n)).map((n) => lire(`src/Portail/${n}`)).join("\n");
  assert.ok(!/offre2Vue|MissionOffre2|visite_data|offre_achat|invest_propositions|invest_dossier_banques|invest_dossier_acquisitions|suivi_offre2/.test(portail), "pas de négociation, de banque, d'acquisition ni de suivi interne côté client");
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message.split("\n").slice(0, 10).join("\n      ")}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
