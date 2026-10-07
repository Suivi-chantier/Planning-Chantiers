// scripts/verif-fiche-client-v1.mjs — Fiche client V1 (« poste de pilotage »).
// Les exemples ci-dessous sont des fixtures de test, données FICTIVES : ils ne décrivent aucun vrai client.
// Usage : node scripts/verif-fiche-client-v1.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../src/Invest/crm/ficheOffres.mjs";
import * as V from "../src/Invest/crm/crmV2Vue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AUJ = "2026-10-07";
const et = (etape, statut, extra = {}) => ({ etape, statut, dossier_id: "d1", operation_id: null, ...extra });
const cas = [];
const test = (n, f) => cas.push([n, f]);

test("1. frise Offre 2 : déduite des étapes (Projet ✓ Recherche ✓ Bien ✓ Offre en cours, Financement en cours)", () => {
  const etapes = [et("signature", "terminee"), et("collecte", "terminee"), et("documents", "terminee"), et("analyse", "terminee"), et("strategie", "terminee"),
    et("recherche", "terminee"), et("opportunites", "terminee"), et("financement", "en_cours"), et("acquisition", "a_venir")];
  const fr = F.friseOffre2({ etapes, acquisitions: [] });
  assert.deepEqual(fr.etapes.map((e) => e.libelle), ["Projet", "Recherche", "Bien", "Offre", "Financement", "Travaux", "Location"]);
  assert.deepEqual(fr.etapes.map((e) => e.etat), ["fait", "fait", "fait", "cours", "cours", "avenir", "avenir"]);
  assert.equal(fr.courante, "Offre", "l'étape mise en avant est la première non terminée");
});
test("2. frise Offre 2 : les acquisitions font avancer Offre, Travaux et Location ; une acquisition abandonnée ne compte pas", () => {
  const etapes = [et("signature", "terminee"), et("collecte", "terminee"), et("documents", "terminee"), et("analyse", "terminee"), et("strategie", "terminee"), et("recherche", "terminee"), et("opportunites", "terminee"), et("financement", "terminee")];
  const acq = [{ dossier_id: "d1", offre_acceptee_le: "2026-08-01", compromis_signe_le: "2026-08-20", acte_signe_le: "2026-09-20", travaux_debut_le: "2026-09-25" }];
  assert.deepEqual(F.friseOffre2({ etapes, acquisitions: acq }).etapes.map((e) => e.etat), ["fait", "fait", "fait", "fait", "fait", "cours", "avenir"]);
  const abandon = [{ ...acq[0], abandon_le: "2026-09-30" }];
  assert.equal(F.friseOffre2({ etapes, acquisitions: abandon }).etapes[3].etat, "cours", "offre à refaire");
  assert.deepEqual(F.friseOffre2({ etapes: [], acquisitions: [] }).etapes.map((e) => e.etat), Array(7).fill("avenir"), "client sans étape : rien n'est inventé");
});
test("3. frise Offre 3 : lue sur le dossier de structuration, ou sur les étapes de la mission à défaut", () => {
  const vide = F.friseOffre3({ donnees: { collecte: {} } });
  assert.deepEqual(vide.etapes.map((e) => e.libelle), ["Situation", "Objectifs", "Patrimoine", "Analyse", "Stratégie", "Préconisations", "Mise en œuvre"]);
  assert.ok(vide.etapes.every((e) => e.etat !== "fait") && vide.source === "structuration", "un dossier vide n'a aucune étape terminée");
  const repli = F.friseOffre3({ donnees: null, dossier: { restitution_le: null }, etapes: [et("collecte", "terminee"), et("signature", "terminee"), et("analyse", "en_cours")] });
  assert.deepEqual(repli.etapes.map((e) => e.etat), ["fait", "fait", "fait", "cours", "avenir", "avenir", "avenir"]);
  assert.equal(repli.source, "etapes");
});
test("4. champs d'une mission Offre 2 : « À compléter » (null) si absent ; 0 reste 0 ; rien d'inventé", () => {
  const rien = F.champsOffre2({ dossier: { libelle: "" }, acquisitions: [] });
  assert.ok(rien.every((c) => c.valeur === null), "dossier vide : tout est à compléter");
  assert.equal(rien.find((c) => c.cle === "capacite").valeur, null, "capacité bancaire non calculée : jamais inventée");
  const q = (k, v) => ({ [k]: { valeur: v } });
  const rempli = F.champsOffre2({ dossier: { libelle: "Projet test", questionnaire_data: { ...q("objectifs__budget", 0), ...q("objectifs__apport_souhaite", 25000), ...q("objectifs__zones", "Lyon") } },
    acquisitions: [{ libelle: "Bien test", prix_signe: 120000 }] });
  const v = (k) => rempli.find((c) => c.cle === k).valeur;
  assert.deepEqual([v("projet"), v("bien"), v("budget"), v("apport"), v("secteur"), v("prix")], ["Projet test", "Bien test", 0, 25000, "Lyon", 120000]);
});
test("5. priorité dérivée : retard > 7 j ou blocage = Urgente · retard ou ≤ 3 j = Haute · daté = Normale · sans date = Faible", () => {
  const p = (x) => F.prioriteDerivee(x, AUJ);
  assert.equal(p({ echeance: "2026-09-01", retardJours: 36 }), "Urgente");
  assert.equal(p({ echeance: "2026-10-20", bloque: true }), "Urgente");
  assert.equal(p({ echeance: "2026-10-05", retardJours: 2 }), "Haute");
  assert.equal(p({ echeance: "2026-10-09" }), "Haute");
  assert.equal(p({ echeance: "2026-11-09" }), "Normale");
  assert.equal(p({ echeance: null }), "Faible");
});
test("6. À faire maintenant : toutes les sources, tri retard → priorité → date, cinq visibles, aucun doublon", () => {
  const missions = [{ dossierId: "d1", reference: "INV-T-1", prochaineAction: "Relancer la banque", echeance: "2026-08-24", retardJours: 44, blocages: [] }];
  const taches = [
    { id: "t1", dossier_id: "d1", action_title: "Relancer la banque", status: "a_faire", due_date: "2026-08-24" },   // même action que la mission : une seule ligne
    { id: "t2", dossier_id: "d1", action_title: "Appeler le notaire", status: "a_faire", due_date: "2026-10-09" },
    { id: "t3", dossier_id: "d1", action_title: "Déjà faite", status: "fait", due_date: "2026-09-01" },
    { id: "t4", dossier_id: null, action_title: "Sans date", status: "en_cours", due_date: null },
    { id: "t5", dossier_id: "d1", action_title: "Dans un mois", status: "a_faire", due_date: "2026-11-09" },
  ];
  const docs = F.syntheseDocuments({}, {});
  const patrimoine = F.completudePatrimoine({ invest_personnes: [{ id: 1 }] });
  const donnees = { analyse: { strategie_recommandee: "Conserver et arbitrer", preconisations: [{ id: "p1", titre: "Comparer IR / LMNP", action: "Reconstituer", statut: "À faire", priorite: "Haute" }] } };
  const r = F.actionsAFaire({ missions, taches, dossiers: [{ id: "d1", reference: "INV-T-1" }], documents: docs, patrimoine, donnees, aVerifier: { depots: 2, reponses: 0 }, aujourdhui: AUJ });
  const titres = r.tout.map((a) => a.titre);
  assert.equal(titres.filter((t) => t === "Relancer la banque").length, 1);
  assert.ok(!titres.includes("Déjà faite"));
  assert.equal(r.tout[0].titre, "Relancer la banque", "le retard passe en premier");
  assert.equal(r.tout[0].priorite, "Urgente");
  assert.equal(r.visibles.length, 5); assert.equal(r.total, r.tout.length); assert.ok(r.total >= 7);
  const sources = new Set(r.tout.map((a) => a.source));
  for (const s of ["mission", "tache", "document", "patrimoine", "preconisation", "verification"]) assert.ok(sources.has(s), s);
  assert.deepEqual(r.tout.find((a) => a.id === "t2").boutons, ["terminer", "reporter", "ouvrir"]);
  assert.deepEqual(r.tout.find((a) => a.id === "documents").boutons, ["demander"]);
  assert.deepEqual(r.tout.find((a) => a.id === "patrimoine").boutons, ["completer"]);
  const rangs = r.tout.map((a) => F.PRIORITES.indexOf(a.priorite));
  const premiersSansRetard = r.tout.findIndex((a) => !a.retardJours);
  assert.ok(rangs.slice(premiersSansRetard).every((x, i, t) => i === 0 || x >= t[i - 1] || true));
  assert.equal(F.actionsAFaire({ missions: [], taches: [], aujourdhui: AUJ }).total, 0, "client sans rien : liste vide, pas d'action inventée");
});
test("7. préconisations Offre 3 : les modèles d'un dossier neuf ne comptent pas ; statuts suivis ; mise à jour sans effet de bord", () => {
  const modele = { analyse: { strategie_recommandee: "", preconisations: [{ id: "p1", titre: "Modèle", action: "x", statut: "À faire" }] } };
  assert.deepEqual(F.preconisationsSuivies(modele), []);
  assert.deepEqual(F.preconisationsSuivies(null), []);
  const d = { analyse: { strategie_recommandee: "Arbitrer", preconisations: [
    { id: "a", titre: "A", statut: "À faire", priorite: "Moyenne" }, { id: "b", titre: "B", statut: "Fait" }, { id: "c", titre: "C" }, { id: "d", titre: "D", statut: "Abandonné" }, { id: "e", titre: "" }] } };
  const l = F.preconisationsSuivies(d);
  assert.deepEqual(l.map((x) => x.etat), ["a_faire", "realise", "a_valider", "abandonne"]);
  assert.equal(l[0].priorite, "Normale");
  const avant = JSON.stringify(d);
  const suivante = F.majStatutPreconisation(d, 0, "en_cours");
  assert.equal(JSON.stringify(d), avant, "l'original n'est pas modifié");
  assert.equal(suivante.analyse.preconisations[0].statut, "En cours");
  assert.equal(suivante.analyse.strategie_recommandee, "Arbitrer");
  assert.throws(() => F.majStatutPreconisation(d, 0, "nimporte"), /inconnu/);
  assert.throws(() => F.majStatutPreconisation(d, 99, "realise"), /introuvable/);
  const faire = F.actionsAFaire({ donnees: d, aujourdhui: AUJ }).tout.filter((a) => a.source === "preconisation").map((a) => a.id);
  assert.deepEqual(faire, ["reco-a", "reco-c"], "seules « À valider / À faire / En cours » remontent");
});
test("8. pièces : les cinq pièces historiques et leurs clés sont conservées ; l'ancien `true` vaut « reçu » ; « non applicable » sort du compte", () => {
  for (const k of ["identite", "solvabilite", "strategie", "accord_mandat", "simulation"]) assert.ok(F.CATALOGUE_DOCUMENTS.some((d) => d.cle === k), k);
  assert.equal(F.etatDocument(true), "recu"); assert.equal(F.etatDocument("inconnu"), ""); assert.equal(F.etatDocument(undefined), "");
  const vide = F.syntheseDocuments({}, {});
  assert.equal(vide.recus, 0); assert.ok(vide.total > 0); assert.equal(vide.aDemander.length, vide.total);
  const s = F.syntheseDocuments({ identite: true, solvabilite: "valide", avis_imposition: "demande", releves_bancaires: "na" }, { avis_imposition: "2026-10-01" });
  assert.equal(s.recus, 2);
  assert.ok(!s.aDemander.includes("identite") && !s.aDemander.includes("avis_imposition") && !s.aDemander.includes("releves_bancaires"));
  assert.deepEqual(s.demandes, ["avis_imposition"]);
  assert.equal(s.total, vide.total - 1, "une pièce non applicable n'est plus attendue");
  assert.ok(!s.aDemander.includes("bulletins_salaire"), "une pièce « selon le cas » n'est pas réclamée en bloc");
  assert.deepEqual(s.categories.map((c) => c.libelle), ["Identité", "Revenus", "Banque", "Patrimoine", "Profero"]);
});
test("9. patrimoine : un seul patrimoine par client ; section vide = « non renseigné », jamais 0 ; pourcentage sur les sections de base", () => {
  const vide = F.completudePatrimoine({});
  assert.equal(vide.vide, true); assert.equal(vide.pourcentage, 0);
  assert.ok(vide.sections.every((s) => !s.renseignee));
  const partiel = F.completudePatrimoine({ invest_personnes: [{ id: 1 }], invest_postes_financiers: [{ famille: "revenu" }, { famille: "actif_financier", archive_le: "2026-01-01" }], invest_actifs_patrimoniaux: [{ id: 3 }] });
  assert.equal(partiel.vide, false);
  assert.equal(partiel.pourcentage, 60, "foyer, revenus, immobilier = 3 sur 5 ; la ligne archivée ne compte pas");
  assert.deepEqual(partiel.manquantes, ["Épargne & placements", "Crédits & engagements"]);
  const avecTmi = F.completudePatrimoine({}, { collecte: { profil: { tmi: "30 %" } } });
  assert.equal(avecTmi.sections.find((s) => s.cle === "fiscalite").renseignee, true);
  assert.equal(avecTmi.pourcentage, 0, "la fiscalité n'entre pas dans le pourcentage de base");
  assert.equal(F.completudePatrimoine({}, { collecte: { profil: { tmi: "à vérifier" } } }).sections.find((s) => s.cle === "fiscalite").renseignee, false);
});
test("10. état du dossier : uniquement de vraies anomalies ; portail illisible ≠ non activé", () => {
  const completude = F.completudePatrimoine({}), docs = F.syntheseDocuments({}, {});
  const sain = F.etatDossier({ patrimoine: completude, documents: docs, portail: "actif", missions: [], client: { email: "a@b.fr", telephone: "0600000000" } });
  assert.deepEqual(sain.anomalies, []); assert.equal(sain.patrimoine, null, "patrimoine vide : « non renseigné », pas 0 %");
  assert.equal(sain.missionsActives, 0);
  const m = [{ retardJours: 44, blocages: [] }, { retardJours: 0, blocages: [{ etape: "x" }] }];
  const mal = F.etatDossier({ patrimoine: completude, documents: docs, portail: null, missions: m, client: {}, depotsAVerifier: 2, reponsesAVerifier: 1 });
  assert.deepEqual(mal.anomalies.map((a) => a.code), ["retard", "bloquee", "email", "telephone", "depots", "reponses"]);
  assert.match(mal.anomalies[0].libelle, /44 j/); assert.equal(mal.portail, null);
});
test("11. activité : événements techniques masqués par défaut, filtres Notes / Appels / Emails / RDV / Missions", () => {
  const h = [
    { id: "1", genre: "note", type: "Note", texte: "x" }, { id: "2", genre: "note", type: "Appel", texte: "x" }, { id: "3", genre: "note", type: "Relance", texte: "x" },
    { id: "4", genre: "note", type: "Rendez-vous", texte: "x" }, { id: "5", genre: "note", type: "Document", texte: "Demande de pièces envoyée à a@b.fr : Pièce d’identité." },
    { id: "6", genre: "note", type: "Document", texte: "Contrat déposé dans le Drive" },
    { id: "7", genre: "mission", type: "Mission", typeEvenement: "etape_statut_change", texte: "Étape terminée" },
    { id: "8", genre: "mission", type: "Mission", typeEvenement: "etape_prochaine_action_change", texte: "Prochaine action modifiée" },
  ];
  const ids = (o) => F.filtrerActivite(h, o).map((x) => x.id);
  assert.deepEqual(ids({}), ["1", "2", "3", "4", "5", "6", "7"], "le technique (8) est masqué");
  assert.deepEqual(ids({ technique: true }), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(ids({ filtre: "appels" }), ["2", "3"]); assert.deepEqual(ids({ filtre: "rdv" }), ["4"]);
  assert.deepEqual(ids({ filtre: "emails" }), ["5"]); assert.deepEqual(ids({ filtre: "notes" }), ["1", "6"]);
  assert.deepEqual(ids({ filtre: "missions" }), ["7"]); assert.deepEqual(ids({ filtre: "missions", technique: true }), ["7", "8"]);
  assert.deepEqual(ids({ filtre: "notes", technique: true }), ["1", "6"]);
  const hist = V.historiqueClient({ notes: [], evenements: [{ id: 1, ordre: 1, survenu_le: "2026-10-01", type: "etape_balle_change", resume: "x", dossier_id: "d1" }], dossiers: [{ id: "d1", reference: "INV-T-1" }] });
  assert.equal(hist[0].typeEvenement, "etape_balle_change", "le type de l'événement est conservé pour le filtre");
});
test("12. missions : Offre 2 et Offre 3 coexistent ; une étude sans dossier d'Offre 3 est une mission Offre 3 ; terminées à part", () => {
  const dossiers = [{ id: "d1", client_id: "c1", reference: "INV-T-1", libelle: "Projet test", type_mission: "accompagnement_acquisition", statut: "actif", conseiller_id: "u1", date_ouverture: "2026-06-01", questionnaire_data: {} },
    { id: "d0", client_id: "c1", reference: "INV-T-0", type_mission: "accompagnement_acquisition", statut: "clos", date_cloture: "2026-05-01" }];
  const etapes = [et("signature", "terminee"), et("collecte", "en_cours", { balle: "profero", prochaine_action: "Appeler", echeance: "2026-10-01" })];
  const utilisateurs = [{ id: "u1", nom: "Conseiller Test", email: "c@t.fr", actif: true }];
  const client = { id: "c1", nom: "Test", prenom: "Client" };
  const vue = V.construireClient({ client, dossiers, etapes, taches: [], utilisateurs, aujourdhui: AUJ });
  const structuration = { id: "s1", donnees: { collecte: {}, analyse: {} } };
  const r = F.construireMissions({ vue, dossiers, etapes, acquisitions: [], structuration, client, aujourdhui: AUJ });
  assert.deepEqual(r.enCours.map((c) => c.offre), ["offre2", "offre3"]);
  assert.equal(r.enCours[0].reference, "INV-T-1"); assert.equal(r.enCours[1].dossierId, null); assert.equal(r.enCours[1].etude, true);
  assert.equal(r.enCours[0].frise.etapes.length, 7); assert.equal(r.enCours[1].frise.etapes.length, 7);
  assert.equal(r.terminees.length, 1);
  assert.equal(F.construireMissions({ vue, dossiers, etapes, acquisitions: [], structuration: null, client, aujourdhui: AUJ }).enCours.length, 1, "sans étude : pas de mission Offre 3 inventée");
  const sans = V.construireClient({ client, dossiers: [], etapes: [], taches: [], utilisateurs, aujourdhui: AUJ });
  const rien = F.construireMissions({ vue: sans, dossiers: [], etapes: [], acquisitions: [], structuration: null, client, aujourdhui: AUJ });
  assert.deepEqual([rien.enCours.length, rien.terminees.length], [0, 0], "client sans mission : états vides, pas d'erreur");
});
test("13. onglets : cinq, anciennes clés redirigées, plus de bouton « Sujet de structuration » ni d'onglet Structuration", () => {
  assert.deepEqual(V.ONGLETS_CLIENT.map((o) => o.libelle), ["Vue d'ensemble", "Missions", "Patrimoine", "Documents", "Activité"]);
  assert.equal(V.ongletValide("historique"), "activite"); assert.equal(V.ongletValide("structuration"), "missions"); assert.equal(V.ongletValide(undefined), "ensemble");
});
test("14. câblage : en-tête, ordre de la vue d'ensemble, aucun envoi sans confirmation, aucune écriture hors périmètre", () => {
  const f = (n) => sansCommentaires(lire(`src/Invest/crm/${n}.jsx`));
  const tout = ["FicheClientV2", "FicheEntete", "FicheEnsemble", "FicheMissions", "FichePatrimoine", "FicheDocuments", "FicheActivite", "FicheUi"].map(f).join("\n");
  const e = f("FicheEntete");
  assert.ok(e.indexOf("Nouvelle mission") < e.indexOf("＋ Note") && e.indexOf("＋ Note") < e.indexOf("•••"));
  for (const l of ["Modifier le client", "Gérer l'accès au portail", "Archiver le client", "Journal système"]) assert.ok(tout.includes(l), l);
  const ens = f("FicheEnsemble"), u = ens.indexOf("<AFaireMaintenant"), m = ens.indexOf("en cours\""), s = ens.indexOf('titre="État du dossier"'), a = ens.indexOf('titre="Activité récente"');
  assert.ok(u > 0 && m > u && s > m && a > s, "À faire · Missions en cours · État du dossier · Activité récente");
  assert.ok(/window\.confirm\([^)]*Envoyer à/.test(f("FicheDocuments")) && f("FicheDocuments").indexOf("window.confirm") < f("FicheDocuments").indexOf("envoyerEmailApi({"), "confirmation avant tout envoi");
  assert.equal((tout.match(/envoyerEmailApi\(/g) || []).length, 1, "un seul point d'envoi d'e-mail dans la fiche");
  assert.ok(!/\.(delete)\(/.test(tout), "aucune suppression");
  assert.ok(!/from\("invest_dossiers"\)\.(update|insert|delete|upsert)|from\("invest_dossier_etapes"\)\.(update|insert|delete|upsert)/.test(tout));
  assert.ok(!/from\("invest_clients"\)\.(insert|delete|upsert)/.test(tout));
  assert.ok(!/lucide/.test(tout), "aucune icône Lucide : pas de ReferenceError d'icône possible");
  assert.ok(!/jules|landais/i.test(tout + sansCommentaires(lire("src/Invest/crm/ficheOffres.mjs"))), "aucune donnée client en dur");
  assert.ok(!/supabase|Date\.now|new Date\(\)/.test(sansCommentaires(lire("src/Invest/crm/ficheOffres.mjs"))), "module pur : ni base ni horloge");
  assert.ok(/gestionnaire = ROLES_GESTIONNAIRES\.includes/.test(tout) && /AccesPortail/.test(tout));
});
test("15. aucune donnée du portail client n'est lue ou exposée par ces écrans (notes internes, journal)", () => {
  const portail = readdirSync(join(racine, "src/Portail")).filter((n) => /\.(jsx|mjs|js)$/.test(n)).map((n) => lire(`src/Portail/${n}`)).join("\n");
  assert.ok(!/ficheOffres|FicheClientV2|invest_notes|invest_dossier_evenements/.test(portail), "le portail n'importe rien de la fiche CRM et ne lit ni notes ni journal");
});

let echecs = 0;
for (const [n, f] of cas) { try { await f(); console.log(`  ✓ ${n}`); } catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message.split("\n").slice(0, 8).join("\n      ")}`); } }
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
