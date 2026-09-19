#!/usr/bin/env node
// Vérifie le gabarit PDF « Dossier d'opération » (src/Renovation/operationDoc.js)
// et le socle partagé (src/Renovation/preparationDocCommun.mjs).
// Aucun réseau, aucune base : le module est alimenté par des payloads de RPC
// en dur et on inspecte le HTML produit.
//   node scripts/verif-operation-doc.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const { buildOperationDocHTML } =
  await chargerModuleSource("../src/Renovation/operationDoc.js", import.meta.url);
const { resumePreparation, totauxOperation, phasesOrdonnees, escDoc, escCssDoc } =
  await chargerModuleSource("../src/Renovation/preparationDocCommun.mjs", import.meta.url);
const { PHASE_A_ORGANISER } =
  await chargerModuleSource("../src/Renovation/preparationChantier.mjs", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const pos = (h, s) => h.indexOf(s);
const compte = (h, s) => h.split(s).length - 1;
// Position du bandeau d'un logement dans la section Préparation. Le nom du
// chantier apparaît aussi dans le tableau financier : il faut l'ancre exacte.
const posFiche = (h, nom) => h.indexOf(`class="op-ch-nom bc">${nom}<`);
// Position d'une ligne de phase (elles se ressemblent d'un chantier à l'autre).
const posPhase = (h, nom, depuis = 0) => h.indexOf(`class="op-ph-nom">${nom}`, depuis);

// ─── FIXTURES ────────────────────────────────────────────────────────────────
const AGG = {
  nbChantiers: 5, nbAvecPhasage: 4,
  vendu: 420000, moReel: 118000, mat: 74000, fg: 12000, marge: 216000, margePct: 51.4,
  moPrev: 110000, matPrev: 70000, fgPrev: 11000, margePrev: 229000, margePrevPct: 54.5,
  hVendues: 2100, hReelles: 1980, avancement: 62,
};
const OP = { nom: "ÎLOT SAINT-SERGE", adresse: '12 rue "des Lilas", 49100 Angers', couleur: "#5b8af5" };

const tache = (i, av) => ({ id: `t${i}`, nom: `Tâche ${i}`, ordre: i, avancement: av });
const ouvrage = (id, taches, nbMat = 2) => ({
  id, code_ouvrage: `OUV-${id}`, libelle: `Ouvrage ${id}`, quantite: 12, unite: "m²",
  taches,
  materiaux: Array.from({ length: nbMat }, (_, k) => ({
    materiau_id: `m${id}${k}`, nom: `Matériau secret ${id}-${k}`, reference: `R${k}`,
    unite: "m²", fournisseur: "Point P", quantite_par_unite: 1, quantite_totale: 10,
    commande_le: null, introuvable: false,
  })),
  materiaux_portee: "ouvrage_complet",
});
const phase = (id, nom, ordre, ouvrages, synthetique = false) =>
  ({ id, nom, ordre, couleur: "#e0a800", synthetique, ouvrages });

// Chantier 1 : correctement préparé, phases données DANS LE DÉSORDRE.
const PREP_OK = {
  chantier_id: "c1", chantier_nom: "LOT A", phasage_id: "p1", modele: "v2",
  phases: [
    phase("g2", "Doublages", 20, [ouvrage("b", [tache(3, 0)])]),
    phase("g1", "Démolition", 10, [ouvrage("a", [tache(1, 100), tache(2, 45)])]),
    phase("g3", "Phase vide", 30, []),
  ],
  compteurs: { phases: 3, ouvrages_uniques: 2, taches: 3, taches_a_organiser: 0 },
};
// Chantier 2 : préparé mais avec des tâches « À organiser », donnée EN TÊTE
// et avec un ordre volontairement petit (elle doit finir dernière).
const PREP_AO = {
  chantier_id: "c2", chantier_nom: "LOT B", phasage_id: "p2", modele: "v2",
  phases: [
    phase(PHASE_A_ORGANISER, "À organiser", 1, [ouvrage("z", [tache(9, null)])], true),
    phase("g1", "Démolition", 10, [ouvrage("c", [tache(4, 10)])]),
  ],
  compteurs: { phases: 2, ouvrages_uniques: 2, taches: 2, taches_a_organiser: 1 },
};
const PREP_ABSENT = {
  chantier_id: "c3", chantier_nom: "LOT C", phasage_id: null, modele: "absent",
  phases: [], compteurs: { phases: 0, ouvrages_uniques: 0, taches: 0, taches_a_organiser: 0 },
};
const PREP_LEGACY = {
  chantier_id: "c4", chantier_nom: "LOT D", phasage_id: "p4", modele: "legacy_v1",
  phases: [], compteurs: { phases: 0, ouvrages_uniques: 0, taches: 42, taches_a_organiser: 0 },
};

const fiche = (nom, couleur, statutLabel, statutColor, adresse, debut, fin, equipes, payload, erreur = "") => ({
  chantier: { id: nom, nom, couleur },
  statutLabel, statutColor, adresse,
  planning: { debut, fin }, equipes,
  resume: resumePreparation(payload, erreur),
});

// 5 logements : préparé · à compléter · sans phasage · ancien modèle · échec.
const PREPARATIONS = [
  fiche("LOT A", "#5b8af5", "En cours", "#FFC300", "1 rue A", "01/09/2026", "30/10/2026", ["Équipe Nord"], PREP_OK),
  fiche("LOT B", "#c084fc", "En cours", "#FFC300", "", "05/09/2026", "", ["Équipe Sud", "Équipe Nord"], PREP_AO),
  fiche("LOT C", "#22c55e", "Planifié", "#3b82f6", "3 rue C", "", "", [], PREP_ABSENT),
  fiche("LOT D", "#f97316", "En pause", "#f97316", "", "", "", [], PREP_LEGACY),
  fiche("LOT E", "#94a3b8", "En cours", "#FFC300", "5 rue E", "", "", [], null, "Failed to fetch"),
];
const TOTAUX = totauxOperation(PREPARATIONS.map(p => p.resume));

const HTML = buildOperationDocHTML({
  op: OP, agg: AGG,
  lignes: PREPARATIONS.map(p => ({
    nom: p.chantier.nom, couleur: p.chantier.couleur,
    statutLabel: p.statutLabel, statutColor: p.statutColor, b: null,
  })),
  preparations: PREPARATIONS, totaux: TOTAUX,
  logoUrl: "/logos/profero-reno-h.png", dateGen: "17 septembre 2026 à 15:40",
});

// ─── 1. HÉRO OPÉRATION ───────────────────────────────────────────────────────
test("1. héros « Dossier d'opération » complet", () => {
  assert.ok(HTML.startsWith("<!DOCTYPE html>"), "document complet");
  assert.ok(HTML.includes(">Dossier d&#39;opération<") || HTML.includes(">Dossier d'opération<"),
    "eyebrow « Dossier d'opération »");
  assert.ok(HTML.includes("ÎLOT SAINT-SERGE"), "nom de l'opération");
  assert.ok(HTML.includes("12 rue &quot;des Lilas&quot;, 49100 Angers"), "adresse (échappée)");
  assert.ok(HTML.includes("Généré le 17 septembre 2026 à 15:40"), "date ET heure de génération");
  assert.ok(HTML.includes("Usage interne"), "le document reste marqué interne");
  // Les six indicateurs de préparation, en chips.
  assert.ok(HTML.includes("5 logements"), "nombre de chantiers");
  assert.ok(HTML.includes("2/5 préparés"), "chantiers dont la préparation est exploitable");
  assert.ok(HTML.includes("4 phases"), "total des phases visibles");
  assert.ok(HTML.includes("4 ouvrages"), "total des ouvrages");
  assert.ok(HTML.includes("5 tâches"), "total des tâches");
  assert.ok(HTML.includes("1 à organiser"), "total des tâches à organiser");
});

// ─── 2. SECTIONS EXISTANTES PRÉSERVÉES ───────────────────────────────────────
test("2. la fiche financière historique est intacte", () => {
  ["Chiffres clés", "Prévisionnel vs réel", "Détail par logement"].forEach(t =>
    assert.ok(HTML.includes(t), `section « ${t} » conservée`));
  assert.ok(HTML.includes("Marge nette à date"), "badge de marge conservé");
  assert.ok(HTML.includes("Marge prévisionnelle"), "tuile marge prévisionnelle conservée");
  assert.ok(HTML.includes("Total opération"), "ligne de total du tableau conservée");
  assert.ok(HTML.includes("ne pas diffuser au client"), "mention de confidentialité conservée");
  assert.ok(HTML.includes("Main-d&#39;œuvre") || HTML.includes("Main-d'œuvre"), "ligne MO conservée");
  // Sans préparations, le document doit rester EXACTEMENT l'ancienne fiche.
  const sansPrep = buildOperationDocHTML({ op: OP, agg: AGG, lignes: [], logoUrl: "/l.png", dateGen: "17 septembre 2026" });
  // On cherche l'ÉLÉMENT rendu, pas le nom de classe : la feuille de style
  // du document déclare toujours ces classes, même inutilisées.
  assert.equal(compte(sansPrep, 'class="op-ch-band"'), 0, "aucune fiche de chantier sans préparations");
  assert.equal(compte(sansPrep, 'class="op-pc-tuiles"'), 0, "aucune tuile de préparation sans préparations");
  assert.ok(!sansPrep.includes("2/5 préparés"), "aucun compteur de préparation inventé");
});

// ─── 3. NOMBRE DE CHANTIERS ──────────────────────────────────────────────────
test("3. une fiche par chantier, ni plus ni moins", () => {
  assert.equal(compte(HTML, 'class="op-ch-band"'), 5, "5 bandeaux de logement");
  ["LOT A", "LOT B", "LOT C", "LOT D", "LOT E"].forEach(n =>
    assert.ok(posFiche(HTML, n) > -1, `fiche de ${n} présente`));
  assert.equal(compte(HTML, "Préparation par logement"), 1, "une seule section de détail");
});

// ─── 4. COMPTEURS GLOBAUX ────────────────────────────────────────────────────
test("4. les totaux sont la somme exacte des chantiers exploitables", () => {
  // LOT A : 2 phases visibles (la vide est masquée), 2 ouvrages, 3 tâches.
  // LOT B : 2 phases, 2 ouvrages, 2 tâches, 1 à organiser.
  // LOT C/D/E : non exploitables → 0 partout.
  assert.equal(TOTAUX.nbChantiers, 5);
  assert.equal(TOTAUX.nbPrepares, 2, "seuls les phasages V2 exploitables comptent comme préparés");
  assert.equal(TOTAUX.nbSansPreparation, 3);
  assert.equal(TOTAUX.nbEnErreur, 1);
  assert.equal(TOTAUX.nbPhases, 4);
  assert.equal(TOTAUX.nbOuvrages, 4);
  assert.equal(TOTAUX.nbTaches, 5);
  assert.equal(TOTAUX.nbAOrganiser, 1);
  // Un legacy_v1 annonce 42 tâches dans ses compteurs : elles ne doivent PAS
  // entrer dans les totaux, le modèle n'étant pas exploitable.
  assert.ok(!HTML.includes("42 tâches"), "les tâches d'un modèle non exploitable sont écartées");
  assert.ok(HTML.includes("4 logements à reprendre avant démarrage"),
    "B (tâches à organiser), C (absent), D (ancien modèle) et E (échec) sont listés");
});

// ─── 5. ORDRE DES CHANTIERS ──────────────────────────────────────────────────
test("5. les chantiers gardent l'ordre reçu de la page", () => {
  const p = ["LOT A", "LOT B", "LOT C", "LOT D", "LOT E"].map(n => posFiche(HTML, n));
  p.forEach((x, i) => assert.ok(x > -1, `LOT ${i} présent`));
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1] < p[i], `ordre respecté en position ${i}`);
  // Rangs imprimés 01..05.
  ["01", "02", "03", "04", "05"].forEach(r =>
    assert.ok(HTML.includes(`class="op-ch-rang bc">${r}<`), `rang ${r} imprimé`));
});

// ─── 6. ORDRE RÉEL DES PHASES ────────────────────────────────────────────────
test("6. les phases suivent chrono_groupes.ordre, pas l'ordre du payload", () => {
  const debutA = posFiche(HTML, "LOT A"), debutB = posFiche(HTML, "LOT B");
  const demo = posPhase(HTML, "Démolition", debutA);
  const doub = posPhase(HTML, "Doublages", debutA);
  assert.ok(demo > -1 && doub > -1, "les deux phases du LOT A sont rendues");
  assert.ok(demo < doub, "ordre 10 avant ordre 20, malgré l'ordre d'arrivée inverse");
  assert.ok(demo < debutB, "et elles restent dans la fiche du LOT A");
  assert.ok(!HTML.includes("Phase vide"), "une phase sans ouvrage n'est pas imprimée");
  // Contrôle direct de la règle partagée.
  const ordre = phasesOrdonnees(PREP_OK).map(p => p.nom);
  assert.deepEqual(ordre, ["Démolition", "Doublages"]);
});

// ─── 7. « À ORGANISER » EN DERNIER ───────────────────────────────────────────
test("7. « À organiser » ferme la liste des phases du chantier", () => {
  const debutB = posFiche(HTML, "LOT B"), debutC = posFiche(HTML, "LOT C");
  const demo = posPhase(HTML, "Démolition", debutB);
  const ao = posPhase(HTML, "À organiser", debutB);
  assert.ok(ao > -1 && demo > -1, "les deux phases du LOT B sont rendues");
  assert.ok(demo < ao, "« À organiser » passe après, malgré son ordre = 1");
  assert.ok(ao < debutC, "et reste dans la fiche du LOT B");
  assert.ok(HTML.includes("Hors planning"), "elle est signalée");
  assert.ok(HTML.includes("1 tâche sans phase"), "la conséquence est dite en clair");
  assert.deepEqual(phasesOrdonnees(PREP_AO).map(p => p.nom), ["Démolition", "À organiser"]);
});

// ─── 8 & 9. PAS DE DÉTAIL TÂCHES / MATÉRIAUX ─────────────────────────────────
test("8. aucune tâche n'est listée une par une", () => {
  for (let i = 1; i <= 9; i++) assert.ok(!HTML.includes(`Tâche ${i}`), `la tâche ${i} n'est pas listée`);
  assert.ok(!HTML.includes("pc-col-case"), "aucune case à cocher de tâche (c'est le dossier chantier)");
  // Seuls les COMPTAGES par phase apparaissent (Démolition : 2, Doublages : 1).
  assert.ok(HTML.includes("2 tâches") && HTML.includes("1 tâche<"),
    "les tâches d'une phase sont comptées, jamais listées");
  assert.ok(HTML.includes("1 ouvrage"), "les ouvrages d'une phase sont comptés, jamais listés");
});

test("9. aucun matériau n'est listé", () => {
  assert.ok(!HTML.includes("Matériau secret"), "aucun nom de matériau");
  assert.ok(!HTML.includes("Point P"), "aucun fournisseur");
  assert.ok(!HTML.includes("ne pas additionner avec les autres phases"),
    "la mention de portée des matériaux appartient au dossier chantier");
  assert.ok(!HTML.includes("Quantité totale"), "aucune quantité de matériau");
  // Les ouvrages ne sont que comptés, jamais détaillés.
  assert.ok(!HTML.includes("OUV-a") && !HTML.includes("Ouvrage a"), "aucun libellé d'ouvrage");
});

// ─── 10. CHANTIER SANS PRÉPARATION ───────────────────────────────────────────
test("10. absent / vide / legacy / ambigu : encadré dédié, jamais « préparé »", () => {
  assert.ok(HTML.includes("Aucun phasage trouvé"), "LOT C : modèle absent");
  assert.ok(HTML.includes("Préparation indisponible"), "LOT D : ancien modèle");
  assert.ok(HTML.includes("À préparer"), "badge d'état explicite");
  // Aucun de ces chantiers ne porte un badge « Préparé ».
  const debutC = posFiche(HTML, "LOT C"), debutD = posFiche(HTML, "LOT D");
  const bandeauD = HTML.slice(debutD, debutD + 900);
  assert.ok(!bandeauD.includes(">Préparé<"), "un chantier sans phasage V2 n'est jamais dit préparé");
  assert.ok(HTML.slice(debutC, debutD).includes("op-ch-alerte"), "encadré présent sur LOT C");
  // Les quatre états du modèle, contrôlés sur le module commun.
  [["absent", "Aucun phasage trouvé"], ["vide", "Préparation non renseignée"],
   ["legacy_v1", "Préparation indisponible"], ["ambigu", "Chantier à vérifier"]].forEach(([m, titre]) => {
    const r = resumePreparation({ modele: m, phases: [], compteurs: {} });
    assert.equal(r.exploitable, false, `${m} n'est pas exploitable`);
    assert.equal(r.ecran.titre, titre, `${m} → « ${titre} »`);
  });
  // Modèle inconnu et payload nul : traités comme anomalies, jamais ignorés.
  assert.equal(resumePreparation({ modele: "martien" }).ecran.titre, "Préparation indisponible");
  assert.equal(resumePreparation(null).exploitable, false, "payload nul géré");
});

// ─── 11. ÉCHEC PARTIEL ───────────────────────────────────────────────────────
test("11. un chantier en échec n'empêche pas d'imprimer les autres", () => {
  assert.ok(HTML.includes("Préparation non chargée"), "l'échec du LOT E est annoncé");
  assert.ok(HTML.includes("Failed to fetch"), "avec sa cause technique");
  assert.ok(HTML.includes("Les autres chantiers de l&#39;opération sont imprimés normalement")
    || HTML.includes("Les autres chantiers de l'opération sont imprimés normalement"), "et sa portée");
  assert.ok(HTML.includes("Chargement en échec"), "badge d'état dédié");
  // Les fiches suivantes et précédentes existent toujours.
  assert.equal(compte(HTML, 'class="op-ch-band"'), 5, "les 5 fiches sont là malgré l'échec");
  const r = resumePreparation(null, "boom");
  assert.equal(r.exploitable, false);
  assert.equal(r.erreur, "boom");
  assert.equal(r.nbTaches, 0, "un échec ne fabrique aucun compteur");
});

// ─── 12 & 13. ÉCHAPPEMENT HTML ET CSS ────────────────────────────────────────
test("12. échappement HTML de tout le contenu interpolé", () => {
  const mechant = "<script>alert(1)</script>";
  const html = buildOperationDocHTML({
    op: { nom: mechant, adresse: '<img src=x onerror="alert(1)">' },
    agg: AGG,
    lignes: [{ nom: "<b>ligne</b>", couleur: '"><b>', statutLabel: "<i>st</i>", statutColor: '"><u>', b: null }],
    preparations: [fiche(mechant, '"><b>', "<i>statut</i>", '";background:url(x)', "<em>adr</em>",
      "<u>d</u>", "", ["<b>eq</b>"], {
        chantier_id: "c", chantier_nom: "c", phasage_id: "p", modele: "v2",
        phases: [phase("g1", "<script>phase</script>", 10, [ouvrage("a", [tache(1, 50)])])],
        compteurs: { phases: 1, ouvrages_uniques: 1, taches: 1, taches_a_organiser: 0 },
      })],
    logoUrl: "/l.png", dateGen: "17 septembre 2026",
  });
  assert.ok(!/<script/i.test(html), "aucune balise script exécutable");
  assert.ok(!/<img[^>]*onerror/i.test(html), "aucun gestionnaire d'événement sur une balise réelle");
  // Le document contient des <b> LÉGITIMES (légende du vendu). On vérifie donc
  // que les balises INJECTÉES par les données ne ressortent pas, une par une.
  ["<b>ligne</b>", "<i>st</i>", "<i>statut</i>", "<em>adr</em>", "<u>d</u>", "<b>eq</b>"]
    .forEach(t => assert.ok(!html.includes(t), `la balise injectée ${t} est neutralisée`));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "rendu en texte inerte");
  assert.ok(!html.includes('border-left-color:"><b>'), "une couleur ne peut pas casser l'attribut");
  assert.equal(escDoc('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.equal(escDoc(null), "", "null devient une chaîne vide");
  assert.equal(escDoc(0), "0", "un zéro reste affiché");
});

test("13. échappement CSS : impossible de sortir du <style> ou de @page", () => {
  const html = buildOperationDocHTML({
    op: { nom: '</style><script>alert(1)</script>', adresse: "" },
    agg: AGG, lignes: [], preparations: [], logoUrl: "/l.png", dateGen: "17 septembre 2026",
  });
  assert.ok(!html.includes("</style><script>"), "le <style> ne peut pas être fermé");
  assert.ok(!/<script/i.test(html), "aucune balise script");
  assert.ok(html.includes("\\3c "), "les chevrons passent en échappement CSS hexadécimal");
  assert.equal(escCssDoc('a"b\\c<d>e'), 'a\\"b\\\\c\\3c d\\3e e');
  // Le pied @page est bien présent dans ce document (et seulement ici).
  assert.ok(html.includes('counter(page) " / " counter(pages)'), "numérotation de page");
});

// ─── 14. AUCUN undefined / null / NaN ────────────────────────────────────────
test("14. jamais « undefined », « null », « NaN » ni ponctuation orpheline", () => {
  // Fixture la plus pauvre possible : tous les champs facultatifs manquants.
  const minimal = buildOperationDocHTML({
    op: { nom: "OP" }, agg: { ...AGG, vendu: 0, marge: 0, margePct: null, margePrevPct: null },
    lignes: [{ nom: "L", couleur: null, statutLabel: "", statutColor: null, b: null }],
    preparations: [{
      chantier: { nom: "SEUL" }, resume: resumePreparation({
        chantier_id: "c", chantier_nom: "c", phasage_id: "p", modele: "v2",
        phases: [phase("g1", "P", 10, [ouvrage("a", [tache(1, 0)])])],
        compteurs: {},
      }),
    }],
    logoUrl: "/l.png", dateGen: "",
  });
  [HTML, minimal].forEach((h, i) => {
    assert.ok(!/\bundefined\b/.test(h), `document ${i} : aucun « undefined »`);
    assert.ok(!/\bNaN\b/.test(h), `document ${i} : aucun « NaN »`);
    assert.ok(!/>\s*null\s*</.test(h), `document ${i} : aucun « null » affiché`);
    // Ponctuation orpheline : un séparateur en début/fin de méta, ou doublé.
    assert.ok(!/class="op-ch-meta">\s*·/.test(h), `document ${i} : pas de « · » en tête de méta`);
    assert.ok(!/·\s*<\/span>/.test(h), `document ${i} : pas de « · » en fin de méta`);
  });
  // Le LOT B n'a ni adresse ni date de fin : la méta reste propre.
  const b = HTML.slice(posFiche(HTML, "LOT B"), posFiche(HTML, "LOT B") + 600);
  assert.ok(b.includes("Travaux 05/09/2026"), "une seule borne de date s'affiche seule");
  assert.ok(!b.includes("→"), "pas de flèche sans date de fin");
  assert.ok(b.includes("Équipe Sud, Équipe Nord"), "les équipes connues sont listées");
  assert.ok(!b.includes("Équipes Équipe"), "pas de préfixe « Équipe » redondant");
  // Le LOT C n'a ni dates ni équipes : aucune mention vide.
  const c = HTML.slice(posFiche(HTML, "LOT C"), posFiche(HTML, "LOT C") + 600);
  assert.ok(!c.includes("Travaux"), "aucune ligne de travaux sans date");
  assert.ok(!c.includes("Équipe"), "aucune mention d'équipe sans équipe");
});

// ─── 15. RENVOI AU DOSSIER DÉTAILLÉ ──────────────────────────────────────────
test("15. chaque chantier préparé renvoie à son dossier détaillé", () => {
  const mention = "Préparation PDF";
  assert.ok(HTML.includes(mention), "la mention existe");
  // Une par chantier exploitable (2), là où le détail a du sens.
  assert.equal(compte(HTML, 'class="op-ch-renvoi"'), 2, "une mention par chantier préparé");
  assert.ok(HTML.includes("s&#39;imprime depuis sa fiche") || HTML.includes("s'imprime depuis sa fiche"),
    "elle dit où l'imprimer");
  assert.ok(HTML.includes("Les tâches et les matériaux restent dans le dossier propre à chaque chantier"),
    "l'intro le rappelle aussi");
});

// ─── 16. MISE EN PAGE ────────────────────────────────────────────────────────
test("16. règles d'impression A4 portrait", () => {
  assert.ok(HTML.includes("size:A4"), "A4");
  assert.ok(!HTML.includes("landscape"), "portrait");
  assert.ok(HTML.includes('@bottom-left  { content:"ÎLOT SAINT-SERGE"'), "nom de l'opération en pied");
  // Une fiche de chantier peut se couper ; son en-tête, non.
  assert.ok(/\.op-ch\{[^}]*\}/.test(HTML), "classe de fiche présente");
  assert.ok(!/\.op-ch\{[^}]*break-inside:avoid/.test(HTML),
    "une fiche entière n'est jamais insécable (sinon grandes zones vides)");
  assert.ok(/\.op-ch-head\{[^}]*page-break-after:avoid/.test(HTML), "en-tête solidaire de la suite");
  assert.ok(/\.op-ph-row\{[^}]*page-break-inside:avoid/.test(HTML), "lignes de phase protégées");
  // Vérifié visuellement : un saut de page forcé avant le détail laissait une
  // page remplie à 22 %. Le document s'enchaîne donc, sans coupure imposée.
  assert.ok(!/\.op-pc-detail\{[^}]*page-break-before/.test(HTML),
    "aucun saut de page forcé avant le détail (il créait une page presque vide)");
  assert.ok(!/page-break-before:always/.test(HTML), "aucune coupure forcée dans tout le document");
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-operation-doc : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
