#!/usr/bin/env node
// Vérifie le bloc du jour « Chantiers à venir » (projet
// docs/projets/organisation-par-jour.md, tâche 8) :
//
//   1. « pas encore démarré » = statut de la fiche chantier (statutChantier)
//      égal à « Planifié », phasage trouvé comme la fiche (trouverPhasage),
//      chantier archivé exclu ;
//   2. Préparation : chaque étape évaluée exactement comme sur la fiche
//      (evaluerEtape, même contexte pour ces étapes), reprise de l'ancien
//      cycle, « Phasage créé » automatique, « Préparation non renseignée »
//      plutôt que 0 ;
//   3. états du bloc (règle 10) : chargement, erreur, aucun chantier à venir,
//      liste, 3 étapes manquantes + « et N autres », phasage illisible ;
//   4. statique : module pur, façade, lectures en lecture seule, fiche
//      chantier toujours sur les mêmes fonctions, registre et lien branchés.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-chantiers-a-venir.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as V from "../src/Renovation/chantiersAVenirV1.mjs";
import { CYCLE_VIE_PHASES, evaluerEtape, etatsCycleVie, etatPhasageMateriaux, etatAcompteChantier } from "../src/Renovation/cycleVie.mjs";
import { statutChantier, trouverPhasage } from "../src/Renovation/factureAEmettre.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const PREPA = CYCLE_VIE_PHASES.find((p) => p.id === "cv_preparation");
const OUV_MAT = { libelle: "Ouvrage fictif", materiaux_liens: [{ materiau_id: "m1" }] };
const OUV_SANS = { libelle: "Ouvrage fictif sans matériau", cout_materiaux: 0 };
const ligne = (chantier_id, etape_id, etat) => ({ chantier_id, etape_id, etat, maj_par: "Fictif", updated_at: "2026-11-20T08:00:00Z" });
const fait = (date = "2026-11-18") => ({ fait: true, date, auteur: "Conducteur fictif" });

test("1. « pas encore démarré » : statut de la fiche chantier = Planifié", () => {
  assert.equal(V.STATUT_A_VENIR, "planifie");
  const ph = { id: "ph1", chantier_id: "a" };
  const attendu = (c, p) => statutChantier(c, p) === "planifie";
  const jeux = [
    [{ id: "a", statut: "planifie" }, null, true],
    [{ id: "a", statut: "planifie" }, ph, true],
    [{ id: "a" }, null, true],                     // sans statut ni phasage : la fiche affiche « Planifié »
    [{ id: "a", statut: "" }, null, true],
    [{ id: "a" }, ph, false],                      // sans statut avec phasage : la fiche affiche « En cours »
    [{ id: "a", statut: "a_l_etude" }, null, false],
    [{ id: "a", statut: "en_cours" }, null, false],
    [{ id: "a", statut: "en_pause" }, null, false],
    [{ id: "a", statut: "termine" }, null, false],
    [{ id: "a", statut: "perdu" }, null, false],
  ];
  for (const [c, p, oui] of jeux) {
    assert.equal(V.estChantierAVenir(c, p), oui, JSON.stringify([c, p]));
    assert.equal(V.estChantierAVenir(c, p), attendu(c, p), "même règle que la fiche");
  }
  assert.equal(V.estChantierAVenir({ id: "a", statut: "planifie", archive_le: "2026-11-01" }, null), false, "archivé");
  assert.equal(V.estChantierAVenir({ statut: "planifie" }, null), false, "sans identifiant");
  assert.equal(V.estChantierAVenir(null, null), false);
});

test("2. repérage : phasage trouvé comme la fiche (identifiant puis nom), ordre conservé", () => {
  const chantiers = [
    { id: "x1", nom: "VILLA FICTIVE", statut: "planifie" },
    { id: "x2", nom: "MAISON FICTIVE" },                 // un phasage au même nom → « En cours »
    { id: "x3", nom: "LOFT FICTIF" },                    // aucun phasage → « Planifié »
    { id: "x4", nom: "ATELIER FICTIF", statut: "en_cours" },
    null, "pas un chantier",
  ];
  const phasages = [{ id: "p1", chantier_id: "x1" }, { id: "p2", chantier_id: "autre", chantier_nom: "Maison fictive" }];
  const r = V.reperageChantiersAVenir(chantiers, phasages);
  assert.deepEqual(r.map((x) => [x.chantier.id, x.phasageId]), [["x1", "p1"], ["x3", null]]);
  assert.equal(trouverPhasage(phasages, chantiers[1]).id, "p2", "rapprochement par nom de la fiche");
  assert.deepEqual(V.reperageChantiersAVenir(null, null), []);
  assert.deepEqual(V.reperageChantiersAVenir([{ id: "z" }], null).map((x) => x.chantier.id), ["z"]);
});

test("3. Préparation : mêmes étapes, même évaluation que la fiche chantier", () => {
  assert.deepEqual(PREPA.etapes.map((e) => e.id),
    ["visite_conducteur_ca", "plans_techniques", "phasage_cree", "planning_previsionnel", "visite_conducteur_chef", "preparation_finalisee"]);
  const phasage = { id: "p", ouvrages: [OUV_MAT, OUV_SANS], plan_travaux: { meta: { cycle_vie_etapes: { plans_execution: fait("2026-10-01") } } } };
  const lignes = [ligne("c", "visite_conducteur_ca", fait()), ligne("c", "planning_previsionnel", { fait: false })];
  const p = V.preparationChantierV1({ phasage, lignes });
  // Contexte COMPLET de la fiche (avec les autres signaux) : les étapes de
  // Préparation n'en dépendent pas, le résultat est le même.
  const etats = etatsCycleVie({ meta: phasage.plan_travaux.meta, lignes }).etats;
  const ctxFiche = { etatsEtapes: etats, chiffrage: true, acompte: etatAcompteChantier({}), phasage: etatPhasageMateriaux(phasage),
    phasageExiste: true, groupes: [], controles: [], facturation: null, relances: null, autorisation: null, todayISO: "2026-11-24" };
  assert.deepEqual(p.etapes.map((e) => [e.id, e.fait]), PREPA.etapes.map((e) => [e.id, !!evaluerEtape(e, ctxFiche).fait]));
  assert.deepEqual(p.etapes.map((e) => e.fait), [true, true, true, false, false, false], "table, reprise de l'ancien cycle, phasage avec matériaux");
  assert.match(p.etapes[1].raison, /reprise de l'ancienne étape « Plans d'exécution »/);
  assert.equal(p.total, 6);
  assert.equal(p.faits, 3);
  assert.equal(p.renseignee, true);
  assert.equal(p.texte, "3/6 étapes faites");
  assert.deepEqual(p.manquantes.map((e) => e.nom), ["Planning prévisionnel", "Visite conducteur + chef de chantier", "Finalisation de la préparation"]);
});

test("4. Préparation non renseignée : jamais « 0 % »", () => {
  for (const args of [{}, { phasage: null, lignes: null }, { phasage: { id: "p", ouvrages: [OUV_SANS] } }]) {
    const p = V.preparationChantierV1(args);
    assert.equal(p.renseignee, false);
    assert.equal(p.texte, "Préparation non renseignée");
    assert.equal(p.faits, 0);
    assert.equal(p.manquantes.length, 6);
    assert.ok(!/0\s*%|0\/6/.test(p.texte));
  }
  const phasageSansMat = V.preparationChantierV1({ phasage: { id: "p", ouvrages: [OUV_SANS] } });
  assert.match(phasageSansMat.manquantes.find((e) => e.id === "phasage_cree").raison, /aucun matériau prévu/);
  // Un état enregistré mais dé-validé : la Préparation est renseignée, 0 étape faite.
  const devalide = V.preparationChantierV1({ lignes: [ligne("c", "plans_techniques", { fait: false, pieces_jointes: [] })] });
  assert.equal(devalide.renseignee, true);
  assert.equal(devalide.texte, "0/6 étapes faites");
  // Tout fait.
  const toutes = PREPA.etapes.filter((e) => e.id !== "phasage_cree").map((e) => ligne("c", e.id, fait()));
  const complete = V.preparationChantierV1({ phasage: { id: "p", ouvrages: [OUV_MAT] }, lignes: toutes });
  assert.equal(complete.texte, "Préparation complète (6/6 étapes)");
  assert.equal(complete.manquantes.length, 0);
});

test("5. liste : lignes du cycle de vie par chantier, phasage illisible signalé", () => {
  const chantiers = [
    { id: "c1", nom: "CHANTIER FICTIF 1", couleur: "#123456", statut: "planifie" },
    { id: "c2", nom: "CHANTIER FICTIF 2", statut: "planifie" },
    { id: "c3", nom: "CHANTIER FICTIF 3", statut: "en_cours" },
    { id: "c4", nom: "CHANTIER FICTIF 4", statut: "planifie" },
  ];
  const phasagesReperage = [{ id: "p1", chantier_id: "c1" }, { id: "p4", chantier_id: "c4" }, { id: "p3", chantier_id: "c3" }];
  const phasagesComplets = [{ id: "p1", chantier_id: "c1", ouvrages: [OUV_MAT], plan_travaux: { meta: {} } }];
  const lignesCycleVie = [ligne("c1", "visite_conducteur_ca", fait()), ligne("c2", "plans_techniques", fait()), ligne("c3", "plans_techniques", fait())];
  const l = V.chantiersAVenirV1({ chantiers, phasagesReperage, phasagesComplets, lignesCycleVie });
  assert.deepEqual(l.map((c) => c.id), ["c1", "c2", "c4"]);
  assert.equal(l[0].preparation.texte, "2/6 étapes faites", "visite + phasage avec matériaux");
  assert.equal(l[0].couleur, "#123456");
  assert.equal(l[1].preparation.texte, "1/6 étapes faites", "seulement ses propres lignes");
  assert.equal(l[1].phasageId, null);
  assert.equal(l[2].preparation, null, "phasage repéré mais non lu : jamais « sans phasage »");
  assert.equal(l[2].erreur, "phasage du chantier illisible");
  assert.deepEqual(V.chantiersAVenirV1({}), []);
});

test("6. états du bloc (règle 10)", () => {
  const ch = V.etatBlocChantiersAVenirV1({ chargement: true });
  assert.equal(ch.etat, "chargement"); assert.equal(ch.metrique, "…"); assert.equal(ch.message, "Chargement des chantiers à venir…");
  assert.equal(V.etatBlocChantiersAVenirV1({ liste: null }).etat, "chargement", "liste absente = pas encore chargée");
  const er = V.etatBlocChantiersAVenirV1({ erreur: "phasages : réseau coupé", liste: [] });
  assert.equal(er.etat, "erreur"); assert.equal(er.metrique, "illisible");
  assert.match(er.message, /illisibles pour le moment \(phasages : réseau coupé\)\. Le nombre de chantiers à venir n'est pas connu\./);
  assert.deepEqual(er.chantiers, []);
  const vide = V.etatBlocChantiersAVenirV1({ liste: [] });
  assert.equal(vide.etat, "vide"); assert.equal(vide.metrique, "aucun");
  assert.equal(vide.message, "Aucun chantier à venir : aucun chantier au statut « Planifié » (devis signé, travaux pas encore commencés).");

  const liste = V.chantiersAVenirV1({
    chantiers: [{ id: "a", nom: "FICTIF A", statut: "planifie" }, { id: "b", nom: "FICTIF B", statut: "planifie" }, { id: "c", nom: "FICTIF C", statut: "planifie" }],
    phasagesReperage: [{ id: "pc", chantier_id: "c" }], phasagesComplets: [],
    lignesCycleVie: [ligne("b", "visite_conducteur_ca", fait()), ligne("b", "plans_techniques", fait()), ligne("b", "planning_previsionnel", fait()), ligne("b", "visite_conducteur_chef", fait())],
  });
  const e = V.etatBlocChantiersAVenirV1({ liste });
  assert.equal(e.etat, "liste"); assert.equal(e.metrique, "3 à venir"); assert.equal(e.libelleNombre, "3 chantiers à venir");
  assert.deepEqual(e.chantiers[0], { id: "a", nom: "FICTIF A", couleur: null, avancement: "Préparation non renseignée", renseignee: false, complete: false,
    manquantes: ["Visite conducteur + chargé d'affaires", "Plans techniques", "Phasage créé"], reste: 3, erreur: null });
  assert.equal(e.chantiers[1].avancement, "4/6 étapes faites");
  assert.deepEqual(e.chantiers[1].manquantes, ["Phasage créé", "Finalisation de la préparation"]);
  assert.equal(e.chantiers[1].reste, 0);
  assert.equal(e.chantiers[2].avancement, "Préparation illisible (phasage du chantier illisible)");
  assert.equal(V.etatBlocChantiersAVenirV1({ liste: liste.slice(0, 1) }).metrique, "1 à venir");
  assert.equal(V.etatBlocChantiersAVenirV1({ liste: liste.slice(0, 1) }).libelleNombre, "1 chantier à venir");
});

test("7. lectures du bloc : phasages et cycle de vie, en lecture seule", () => {
  const donnees = sansCommentaires(lire("src/Renovation/chantiersAVenirDonnees.js"));
  assert.match(donnees, /from\("phasages"\)\.select\(COLONNES_PHASAGES_REPERAGE\);/, "tous les phasages, sans tri, comme la fiche");
  assert.match(donnees, /from\("phasages"\)\.select\(COLONNES_PHASAGES_PREPARATION\)\.in\("id", idsPhasages\)/);
  assert.match(donnees, /chargerCycleVie\(reperes\.map\(\(r\) => r\.chantier\.id\)\)/, "même lecture du cycle de vie que la fiche et Opérations");
  assert.match(donnees, /reperageChantiersAVenir\(chantiers, phasagesReperage\)/);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(donnees), "lecture seule");
  assert.match(V.COLONNES_PHASAGES_PREPARATION, /\bouvrages\b/);
  assert.match(V.COLONNES_PHASAGES_PREPARATION, /\bplan_travaux\b/);
});

test("8. la fiche chantier applique toujours les mêmes fonctions", () => {
  // Source brute : la fiche contient des chaînes « image/* » qui fausseraient
  // le retrait des commentaires /* … */.
  const fiche = lire("src/Renovation/PageChantiers.jsx");
  const m = (re) => assert.ok(re.test(fiche), `fiche chantier : ${re}`);
  m(/const getStatut = statutChantier;/);
  m(/const selectedPhasage\s+= trouverPhasage\(phasages, selectedChantier\);/);
  m(/supabase\.from\("phasages"\)\.select\("\*"\);/);
  m(/etatsCycleVie\(\{ meta: metaSelected, lignes: cvD\.lignes \|\| \[\] \}\)/);
  m(/chargerCycleVie\(\[cvCleChantier\]\)/);
  m(/phasage: etatPhasageMateriaux\(selectedPhasage \|\| null\),/);
  m(/evaluerEtape\(e, cvCtx\)/);
  m(/statutChantier: getStatut\(selectedChantier, selectedPhasage\)/);
  // Préparation : aucune étape partagée ni dépendante d'un autre signal que le phasage.
  for (const e of PREPA.etapes) assert.ok(!e.partagee && (e.nature !== "auto" || e.signal === "phasage_materiaux"), e.id);
});

test("9. module pur, façade, bloc, registre, lien vers la fiche", () => {
  const mod = sansCommentaires(lire("src/Renovation/chantiersAVenirV1.mjs"));
  assert.ok(!/supabase/i.test(mod), "aucun accès Supabase");
  assert.ok(!/new Date\(|Date\.now\(/.test(mod), "aucune horloge");
  assert.ok(!/from\s+"[^"]+\.js"/.test(mod), "n'importe que des .mjs");
  assert.ok(!/["']termine["']|["']en_cours["']|\.archive\b/.test(mod), "aucun statut refiltré à la main");
  assert.match(mod, /statutChantier\(chantier, phasage\) === STATUT_A_VENIR/);
  assert.match(mod, /evaluerEtape\(e, ctx\)/);
  assert.match(lire("src/Renovation/chantiersAVenirV1.js"), /export \* from "\.\/chantiersAVenirV1\.mjs";/);
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocChantiersAVenir.jsx"));
  assert.ok(!/supabase/.test(bloc), "bloc : aucun accès direct à la base");
  for (const f of ["chargerDonneesChantiersAVenir(chantiers)", "chantiersAVenirV1({ chantiers, ...donnees.valeur })", "etatBlocChantiersAVenirV1({"]) assert.ok(bloc.includes(f), `bloc : ${f}`);
  assert.ok(!/evaluerEtape|\.filter\(\(e\) => e\.fait\)|\.reduce\(/.test(bloc), "bloc : aucun calcul réécrit");
  assert.match(bloc, /onOuvrirChantier \? \(\) => onOuvrirChantier\(c\.id\) : null/, "lien seulement si fourni");
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /import BlocChantiersAVenir from "\.\/BlocChantiersAVenir";/);
  assert.match(registre, /chantiers_a_venir:\s*\{ icone: HardHat,\s*accent: "#22c55e", Composant: BlocChantiersAVenir \}/);
  const app = sansCommentaires(lire("src/App.jsx"));
  assert.match(app, /onOuvrirChantier=\{canAccess\(role,"operations"\)&&canAccess\(role,"chantiers"\) \? ouvrirFicheChantier : null\}/,
    "fiche ouverte comme depuis Opérations, seulement si Opérations et Chantiers sont autorisées");
  assert.match(app, /const ouvrirFicheChantier = \(chantierId\) => \{\s*setChantierToOpen\(chantierId\);\s*setPage\("chantiers"\);/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
