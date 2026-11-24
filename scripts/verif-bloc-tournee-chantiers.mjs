#!/usr/bin/env node
// Vérifie le bloc du jour « Tournée des chantiers » (projet
// docs/projets/organisation-par-jour.md, tâche 10) et les extractions faites
// pour lui :
//
//   1. niveau d'alerte : MÊME calcul que la page Alertes
//      (calculerAlertesEcranV1), mêmes libellés et couleurs
//      (PRESENTATION_NIVEAUX_ALERTE_V1, partagée avec la page), relevé absent
//      → « relevé pas encore disponible », chantier en cours sans relevé
//      signalé, aucun chantier en alerte, erreur ;
//   2. retours du terrain : MÊME calcul que la page (retoursTerrain), bloqué
//      puis pas commencé puis dépassements, 5 lignes et « et N autres »,
//      aucun compte rendu, aucun retour, erreur, phasages illisibles ;
//   3. tâches de phasage en retard : règle existante etatReelTacheV1
//      (en_retard : date prévue passée, avancement < 100 %), date du jour en
//      paramètre, tâche sans date jamais en retard, chantiers terminés
//      exclus, jours de retard, aucune tâche en retard, erreur, date inconnue ;
//   4. erreur d'une partie : les autres restent affichées ;
//   5. statique : page Alertes, page Retours du terrain et bloc utilisent les
//      mêmes lectures (alertesChantiersDonnees.js, retoursTerrainDonnees.js) et
//      les mêmes fonctions ; correction de la semaine de la page Alertes ;
//      modules purs ; registre branché ; référentiel de la page Alertes
//      transmis au tableau de bord.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-tournee-chantiers.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../src/Renovation/alertesEcranV1.mjs";
import * as A from "../src/Renovation/alertesV1.mjs";
import * as RT from "../src/Renovation/retoursTerrainV1.mjs";
import * as B from "../src/Renovation/tourneeChantiersV1.mjs";
import { etatReelTacheV1 } from "../src/Renovation/planningReplanningStateV1.js";
import { getISOWeek } from "../src/rythmeSemaine.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const SEMAINES = ["2026-W48", "2026-W47"];
const releve = (id, date, o = {}) => ({
  id: `${id}-${date}`, chantier_id: id, chantier_nom: o.nom || `CHANTIER FICTIF ${id}`,
  week_id: null, date_releve: date,
  avancement: o.avancement ?? 40, vendu_ht: 100000, heures_vendues: 500, heures_reelles: o.heures ?? 200,
  production_cumulee: 40000, marge_avancement: 5000, marge_probable: o.margeProbable ?? 10000,
  marge_terminaison: o.margeTerminaison === undefined ? 10000 : o.margeTerminaison,
  budget_restant: 20000, heures_sans_lot: 0, pct_sans_lot: 0, chantier_repris: false,
  lots: [], warnings: o.warnings || [], statut_completude: "complet",
});
const RELEVES = [
  releve("A", "2026-11-19"), releve("A", "2026-11-24", { margeTerminaison: -3000 }),             // critique
  releve("B", "2026-11-19"), releve("B", "2026-11-24", { warnings: [{ code: "fg_non_regle" }] }), // information
  releve("C", "2026-11-19"), releve("C", "2026-11-24"),                                          // sans alerte
  releve("D", "2026-11-24", { nom: "DÉPOT", margeTerminaison: -50 }),                            // exclu
  releve("T", "2026-11-19", { avancement: 100, margeTerminaison: -500 }), releve("T", "2026-11-24", { avancement: 100, margeTerminaison: -500 }), // terminé en perte : information
];
const REFERENTIEL = [
  { id: "A", nom: "CHANTIER FICTIF A", statut: "en_cours" },
  { id: "B", nom: "CHANTIER FICTIF B" },
  { id: "C", nom: "CHANTIER FICTIF C", statut: "en_cours" },
  { id: "D", nom: "DÉPOT", statut: "en_cours" },
  { id: "S", nom: "CHANTIER FICTIF SANS RELEVÉ", statut: "en_cours" },
  { id: "T", nom: "CHANTIER FICTIF TERMINÉ", statut: "termine" },
  { id: "P", nom: "AFFAIRE FICTIVE PERDUE", statut: "perdu" },
  { id: "X", nom: "CHANTIER FICTIF ARCHIVÉ", statut: "en_cours", archive_le: "2026-10-01" },
];
const ALERTES = { lignes: RELEVES, semaines: SEMAINES, seuilsMarges: null, referentielChantiers: REFERENTIEL };

const rapport = (id, date, chantier, taches, o = {}) => ({
  id, ouvrier: "Ouvrier fictif", chantier_id: chantier, chantier_nom: `CHANTIER FICTIF ${chantier}`,
  date_rapport: date, statut: o.statut || "valide", formulaire_version: o.v1 ? null : "v2", taches,
});
const RAPPORTS = [
  rapport("r1", "23/11/2026", "A", [
    { tache_id: "t1", planifie: "Saignées fictives", statut: "en_cours", bloque: true, motif: "attente_materiel" },
    { tache_id: "t2", planifie: "Ponçage fictif", statut: "non_faite", motif: "meteo" },
    { tache_id: "t3", planifie: "Pose fictive", statut: "faite", motif_depassement: "devis_sous_estime", depassement: { heures_avant: 5, heures_jour: 3, heures_vendues: 6 } },
  ]),
  rapport("r2", "2026-11-25", "C", [
    { planifie: "Enduit fictif", statut: "non_faite" },
    { planifie: "Peinture fictive", statut: "faite", motif_depassement: "imprevu" },
    { planifie: "Plinthes fictives", statut: "faite", motif_depassement: "reprise" },
    { planifie: "Nettoyage fictif", statut: "faite", origine: "nouvelle", proposition: { nature: "imprevu" } },
  ]),
  rapport("r3", "16/11/2026", "A", [{ planifie: "Hors semaine", statut: "non_faite" }]),             // semaine précédente : ignoré
];
const PHASAGES_RETOURS = [{ chantier_id: "A", ouvrages: [{ libelle: "Ouvrage fictif", taches: [{ id: "t1", nom: "Saignées fictives" }] }] }];
const RETOURS = { rapports: RAPPORTS, phasages: PHASAGES_RETOURS, debut: "2026-11-23", fin: "2026-11-29" };

const tache = (id, nom, date, avancement, o = {}) => ({ id, nom, date_prevue: date, avancement, heures_vendues: 10, heures_estimees: 8, ...o });
const PHASAGES = [
  { chantier_id: "A", ouvrages: [{ libelle: "O1", taches: [
    tache("a1", "Tâche fictive en retard", "2026-11-20", 40),
    tache("a2", "Tâche fictive terminée", "2026-11-10", 100),
    tache("a3", "Tâche fictive du jour", "2026-11-26", 0),
    tache("a4", "Tâche fictive sans date", "", 0),
    tache("a5", "Nom devis fictif", "2026-11-02T00:00:00", 99, { nom_perso: "Nom personnalisé fictif" }),
  ] }] },
  { chantier_id: "C", ouvrages: [{ libelle: "O2", taches: [tache("c1", "Tâche fictive future", "2026-12-01", 0)] }] },
  { chantier_id: "T", ouvrages: [{ libelle: "O3", taches: [tache("t1", "Tâche fictive d'un chantier terminé", "2026-10-01", 10)] }] },
];
const EN_COURS = B.chantiersEnCoursTourneeV1(REFERENTIEL);
const PHASAGE = { phasages: PHASAGES, chantiers: EN_COURS, dateIso: "2026-11-26" };

// ═══ 1. Niveau d'alerte ════════════════════════════════════════════════════
test("1. niveau d'alerte : même calcul que la page Alertes, même ordre, mêmes libellés et couleurs", () => {
  const page = E.calculerAlertesEcranV1({ ...ALERTES, exclusions: ["DÉPOT"] }).resultat;
  const p = B.partieAlertesTourneeV1(ALERTES);
  assert.equal(p.etat, "liste");
  assert.deepEqual(p.chantiers.map((c) => [c.id, c.niveau]), page.alertes.map((a) => [a.chantierId, a.niveau]));
  assert.deepEqual(p.chantiers.map((c) => c.id), ["A", "T", "B"], "critique d'abord, puis information (impact chiffré avant inconnu) ; DÉPOT exclu ; C sans alerte");
  assert.deepEqual(p.chantiers.map((c) => c.libelle), ["Critique", "Information", "Information"]);
  assert.equal(p.chantiers[0].couleur, "#e15a5a");
  assert.deepEqual(p.totaux, page.totaux);
  assert.equal(p.nbEnAlerte, 1, "en alerte = critiques + à surveiller");
  assert.equal(p.message, A.etatAlertesV1(page).message);
  assert.deepEqual(Object.keys(E.PRESENTATION_NIVEAUX_ALERTE_V1), [A.NIVEAU_CRITIQUE, A.NIVEAU_A_SURVEILLER, A.NIVEAU_INFO]);
  assert.deepEqual(Object.values(E.PRESENTATION_NIVEAUX_ALERTE_V1).map((x) => x.label), ["Critique", "À surveiller", "Information"]);
});

test("2. niveau d'alerte : chantier en cours sans relevé → « relevé pas encore disponible » (jamais « sans alerte »)", () => {
  const p = B.partieAlertesTourneeV1(ALERTES);
  assert.deepEqual(p.sansReleve.map((c) => c.id), ["S"], "ni terminé, ni perdu, ni archivé, ni DÉPOT");
});

test("3. niveau d'alerte : relevé de la semaine absent → message de la page, aucun niveau affiché", () => {
  const page = A.etatAlertesV1(E.calculerAlertesEcranV1({ ...ALERTES, lignes: [], exclusions: ["DÉPOT"] }).resultat);
  assert.equal(page.statut, A.ETAT_RELEVE_ABSENT);
  const vide = B.partieAlertesTourneeV1({ ...ALERTES, lignes: [] });
  assert.equal(vide.etat, "releve_absent");
  assert.match(vide.message, /pas encore disponible/);
  assert.deepEqual(vide.chantiers, []);
  assert.equal(B.etatBlocTourneeChantiersV1({ alertes: { ...ALERTES, lignes: [] } }).metrique, "relevé pas encore disponible");
});

test("4. niveau d'alerte : aucun chantier en alerte, chargement, erreur (jamais « aucune alerte » sur une erreur)", () => {
  const sains = [releve("C", "2026-11-19"), releve("C", "2026-11-24")];
  const p = B.partieAlertesTourneeV1({ ...ALERTES, lignes: sains });
  assert.equal(p.etat, "vide");
  assert.equal(p.message, "Aucun chantier en alerte sur le relevé de cette semaine.");
  assert.equal(B.etatBlocTourneeChantiersV1({ alertes: { ...ALERTES, lignes: sains } }).metrique, "aucun chantier en alerte");
  assert.equal(B.partieAlertesTourneeV1({ chargement: true }).etat, "chargement");
  const err = B.partieAlertesTourneeV1({ erreur: "réseau coupé" });
  assert.equal(err.etat, "erreur");
  assert.match(err.message, /ce n'est pas « aucune alerte »/);
  assert.equal(err.nbEnAlerte, null);
  assert.equal(B.etatBlocTourneeChantiersV1({ alertes: { erreur: "x" } }).metrique, "alertes illisibles");
  assert.equal(B.etatBlocTourneeChantiersV1({ alertes: ALERTES }).metrique, "1 chantier en alerte");
});

// ═══ 2. Retours du terrain ═════════════════════════════════════════════════
test("5. retours : même calcul que la page (retoursTerrain), bloqué puis pas commencé puis dépassements", () => {
  const page = RT.retoursTerrain({ ...RETOURS, chantierId: null });
  const p = B.partieRetoursTourneeV1(RETOURS);
  assert.equal(p.etat, "liste");
  assert.equal(p.nbBloque, page.nonFaites.filter((x) => x.bloque).length);
  assert.equal(p.nbPasCommence, page.nonFaites.filter((x) => !x.bloque).length);
  assert.equal(p.nbDepassements, page.depassements.length);
  assert.deepEqual([p.nbBloque, p.nbPasCommence, p.nbDepassements], [1, 2, 3]);
  assert.deepEqual(p.lignes.map((l) => l.etiquette), ["Bloqué", "Pas commencé", "Pas commencé", "Dépassement", "Dépassement"]);
  assert.equal(p.reste, 1, "6 retours : 5 lignes et « et 1 autre »");
  assert.equal(B.etNAutres(p.reste), "et 1 autre");
  assert.equal(B.etNAutres(3), "et 3 autres");
  assert.ok(p.lignes.every((l) => !("ouvrier" in l)), "le bloc n'affiche pas les noms d'ouvriers");
  assert.ok(!p.lignes.some((l) => l.tache === "Hors semaine"), "semaine de la page uniquement");
  assert.equal(p.nbRapports, 3);
});

test("6. retours : aucun compte rendu, aucun retour bloqué, erreur, phasages illisibles", () => {
  const rien = B.partieRetoursTourneeV1({ ...RETOURS, rapports: [] });
  assert.equal(rien.etat, "aucun_compte_rendu");
  assert.equal(rien.message, "Aucun compte rendu pour cette semaine : il n'y a rien à lire.");
  const calme = B.partieRetoursTourneeV1({ ...RETOURS, rapports: [rapport("r9", "24/11/2026", "A", [{ planifie: "Fictif", statut: "faite" }])] });
  assert.equal(calme.etat, "vide");
  assert.deepEqual(calme.messagesVides, ["Aucun retour bloqué ou pas commencé cette semaine.", "Aucun dépassement signalé cette semaine."]);
  const err = B.partieRetoursTourneeV1({ erreur: "délai dépassé" });
  assert.equal(err.etat, "erreur");
  assert.match(err.message, /Ce n'est pas « aucun retour »/);
  assert.equal(err.nbBloque, null);
  assert.equal(B.partieRetoursTourneeV1({ chargement: true }).etat, "chargement");
  assert.equal(B.partieRetoursTourneeV1({ ...RETOURS, phasages: null }).phasagesIllisibles, true);
});

// ═══ 3. Tâches de phasage en retard ════════════════════════════════════════
test("7. phasage : règle existante etatReelTacheV1 (date prévue passée et avancement < 100 %)", () => {
  const liste = B.tachesPhasageEnRetardV1(PHASAGE);
  assert.deepEqual(liste.map((t) => t.cle), ["A::a5", "A::a1"], "plus en retard d'abord ; ni terminée, ni du jour, ni sans date, ni future, ni chantier terminé");
  assert.deepEqual(liste.map((t) => t.joursRetard), [24, 6]);
  assert.equal(liste[0].tache, "Nom personnalisé fictif", "nom affiché du phasage");
  assert.equal(liste[0].chantier, "CHANTIER FICTIF A");
  // Même verdict que la règle existante, tâche par tâche.
  for (const t of PHASAGES[0].ouvrages[0].taches) {
    assert.equal(liste.some((x) => x.cle === `A::${t.id}`), etatReelTacheV1({ chantierId: "A", tache: t, today: "2026-11-26" }).en_retard, t.id);
  }
  // La date du jour est un paramètre (aucune horloge) : la veille, la tâche du 26 n'est pas en retard non plus.
  assert.deepEqual(B.tachesPhasageEnRetardV1({ ...PHASAGE, dateIso: "2026-11-27" }).map((t) => t.cle), ["A::a5", "A::a1", "A::a3"]);
  assert.deepEqual(B.tachesPhasageEnRetardV1({ ...PHASAGE, dateIso: "2026-11-01" }), []);
});

test("8. phasage : 5 lignes + « et N autres », par chantier, aucune tâche en retard, erreur, date inconnue", () => {
  const beaucoup = [{ chantier_id: "C", ouvrages: [{ taches: Array.from({ length: 7 }, (_, i) => tache(`c${i}`, `Tâche fictive ${i}`, `2026-11-0${i + 1}`, 0)) }] }, ...PHASAGES];
  const p = B.partiePhasageTourneeV1({ ...PHASAGE, phasages: beaucoup });
  assert.equal(p.etat, "liste");
  assert.equal(p.nombre, 9);
  assert.equal(p.lignes.length, 5);
  assert.equal(p.reste, 4);
  assert.equal(p.lignes[0].date, "01/11/2026");
  assert.deepEqual(p.parChantier.map((c) => [c.chantierId, c.nombre]), [["C", 7], ["A", 2]]);
  const rien = B.partiePhasageTourneeV1({ ...PHASAGE, dateIso: "2026-11-01" });
  assert.equal(rien.etat, "vide");
  assert.equal(rien.message, "Aucune tâche de phasage en retard.");
  const err = B.partiePhasageTourneeV1({ erreur: "lecture impossible", dateIso: "2026-11-26" });
  assert.equal(err.etat, "erreur");
  assert.equal(err.nombre, null);
  assert.equal(B.partiePhasageTourneeV1({ ...PHASAGE, dateIso: null }).etat, "erreur");
  assert.equal(B.partiePhasageTourneeV1({ chargement: true, dateIso: "2026-11-26" }).etat, "chargement");
  assert.deepEqual(EN_COURS.map((c) => c.id), ["A", "B", "C", "S"], "chantiers en cours : ni DÉPOT, ni terminé, ni perdu, ni archivé");
});

// ═══ 4. Une partie en erreur n'empêche pas les autres ══════════════════════
test("9. erreur d'une partie : les deux autres restent calculées", () => {
  const e1 = B.etatBlocTourneeChantiersV1({ alertes: { erreur: "x" }, retours: RETOURS, phasage: PHASAGE });
  assert.deepEqual([e1.alertes.etat, e1.retours.etat, e1.phasage.etat], ["erreur", "liste", "liste"]);
  const e2 = B.etatBlocTourneeChantiersV1({ alertes: ALERTES, retours: { erreur: "x" }, phasage: PHASAGE });
  assert.deepEqual([e2.alertes.etat, e2.retours.etat, e2.phasage.etat], ["liste", "erreur", "liste"]);
  const e3 = B.etatBlocTourneeChantiersV1({ alertes: ALERTES, retours: RETOURS, phasage: { erreur: "x", dateIso: "2026-11-26" } });
  assert.deepEqual([e3.alertes.etat, e3.retours.etat, e3.phasage.etat], ["liste", "liste", "erreur"]);
  assert.equal(e3.metrique, "1 chantier en alerte");
});

// ═══ 5. Statique ═══════════════════════════════════════════════════════════
test("10. page Alertes : semaine courante corrigée, même lecture et même calcul que le bloc", () => {
  const donnees = sansCommentaires(lire("src/Renovation/alertesChantiersDonnees.js"));
  assert.match(donnees, /const \{ year, week \} = getCurrentWeek\(\);\s*return semainesAlertesV1\(getWeekId\(year, week\)\);/);
  assert.match(donnees, /const \{ debut, fin \} = periodeRelevesAlertesV1\(semaines\);\s*return chargerRelevesRetenusV2\(\{ debut, fin, weekIds: semaines \}\);/);
  const page = sansCommentaires(lire("src/Renovation/PageAlertes.jsx"));
  assert.ok(!/getCurrentWeek\(\)\)/.test(page), "plus d'objet { year, week } passé comme numéro de semaine");
  assert.match(page, /const semaines = useMemo\(\(\) => semainesAlertesCourantes\(\), \[\]\);/);
  assert.match(page, /await chargerRelevesAlertesSemaines\(semaines\)/);
  assert.match(page, /calculerAlertesEcranV1\(\{/);
  assert.match(page, /PRESENTATION_NIVEAUX_ALERTE_V1\[NIVEAU_CRITIQUE\]/);
  // L'ancienne expression donnait une semaine illisible (exemple issu des tests).
  const { year, week } = getISOWeek(new Date(2026, 10, 26));
  const ancienne = `${2026}-W${String({ year, week }).padStart(2, "0")}`;
  assert.deepEqual(E.periodeRelevesAlertesV1(E.semainesAlertesV1(ancienne)), { debut: null, fin: null });
  assert.deepEqual(E.semainesAlertesV1(`${year}-W${String(week).padStart(2, "0")}`), ["2026-W48", "2026-W47"]);
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocTourneeChantiers.jsx"));
  assert.match(bloc, /useState\(\(\) => semainesAlertesCourantes\(\)\)/);
  assert.match(bloc, /chargerRelevesAlertesSemaines\(semaines\)/);
  assert.match(bloc, /useReglagesMarges\(\)/);
  assert.match(bloc, /seuilsMarges: reglagesMarges\.seuilsMarges, referentielChantiers: referentiel/);
  const mod = sansCommentaires(lire("src/Renovation/tourneeChantiersV1.mjs"));
  assert.match(mod, /calculerAlertesEcranV1\(\{ lignes, semaines, seuilsMarges, referentielChantiers, exclusions \}\)/);
  assert.deepEqual([...E.CHANTIERS_EXCLUS_ALERTES_V1], ["DÉPOT"]);
});

test("11. page Retours du terrain : mêmes lectures et même semaine que le bloc", () => {
  const donnees = sansCommentaires(lire("src/Renovation/retoursTerrainDonnees.js"));
  assert.match(donnees, /\.select\("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, taches, formulaire_version"\)\s*\.in\("date_rapport", jours\.flatMap\(ecrituresDate\)\)/);
  assert.match(donnees, /from\("phasages"\)\.select\("chantier_id, ouvrages"\)\.in\("chantier_id", ids\)/);
  assert.match(donnees, /phasages = e2 \? null : \(ph \|\| \[\]\);/);
  const page = sansCommentaires(lire("src/Renovation/RetoursTerrain.jsx"));
  assert.ok(!/supabase/.test(page), "la page ne lit plus la base elle-même");
  assert.match(page, /await chargerRetoursTerrainSemaine\(lundi\)/);
  assert.match(page, /useState\(\(\) => semaineCouranteRetoursTerrain\(\)\)/);
  assert.match(page, /retoursTerrain\(\{/);
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocTourneeChantiers.jsx"));
  assert.match(bloc, /useState\(\(\) => semaineCouranteRetoursTerrain\(\)\)/);
  assert.match(bloc, /chargerRetoursTerrainSemaine\(lundi\)/);
  const mod = sansCommentaires(lire("src/Renovation/tourneeChantiersV1.mjs"));
  assert.match(mod, /retoursTerrain\(\{ rapports, phasages: phasages \|\| \[\], debut, fin, chantierId: null \}\)/);
});

test("12. modules purs, façade, registre, référentiel, bloc sans accès direct à la base", () => {
  const mod = sansCommentaires(lire("src/Renovation/tourneeChantiersV1.mjs"));
  assert.ok(!/supabase|fetch\(|Date\.now|new Date\(|process\.|localStorage/.test(mod), "tourneeChantiersV1.mjs : pur");
  assert.match(mod, /construireEtatReelPhasagesV1\(retenus, \{ today: dateIso \}\)/, "règle existante du phasage");
  assert.match(mod, /\.filter\(\(t\) => t\.en_retard\)/);
  const ecran = sansCommentaires(lire("src/Renovation/alertesEcranV1.mjs"));
  assert.ok(!/supabase|fetch\(|Date\.now|new Date\(|process\./.test(ecran), "alertesEcranV1.mjs : toujours pur");
  assert.equal(lire("src/Renovation/tourneeChantiersV1.js").includes('export * from "./tourneeChantiersV1.mjs"'), true);
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocTourneeChantiers.jsx"));
  assert.ok(!/supabase/.test(bloc), "le bloc passe par les modules de lecture");
  assert.match(bloc, /lirePhasagesChantiers\(enCours\.map\(\(c\) => c\.id\)\)/);
  assert.match(bloc, /chantiers: enCours, dateIso \}/, "date du jour du tableau de bord pour les retards");
  assert.match(bloc, /onOuvrirChantier && chantierId \? \(\) => onOuvrirChantier\(chantierId\) : null/, "fiche chantier seulement si autorisée");
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /tournee_chantiers:\s*\{[^\n]*Composant: BlocTourneeChantiers \}/);
  assert.match(sansCommentaires(lire("src/App.jsx")), /<PageDashboard chantiers=\{chantiersExploitation\} referentielChantiers=\{chantiers\} /);
  assert.match(sansCommentaires(lire("src/App.jsx")), /<PageAlertes T=\{T\} referentielChantiers=\{chantiers\} /);
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Page Alertes : les alertes de la semaine s'affichent de nouveau"/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
