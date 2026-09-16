#!/usr/bin/env node
// Vérifie l'ÉCRAN « Chantiers ProGBat associés » :
//   1. les règles pures src/Renovation/progbatYardsEcran.mjs (identification
//      code visible / yardId, liste proposée, recherche, états) ;
//   2. par analyse statique, ce que le composant ChantierYardsProgbat.jsx
//      écrit en base et ce qu'il ne doit SURTOUT pas faire (rapprochement
//      automatique, cree_par forcé, localStorage) ;
//   3. le branchement dans FacturationChantier.jsx et la conservation du
//      repli par devis.
//
// LE PIÈGE DE CET ÉCRAN : ProGBat affiche « #80 TROTIER - T3 - RDC » là où son
// API renvoie businessId 80, id 83 et label « T3 - RDC ». Le 80 est le seul
// numéro que l'utilisateur voit ; le 83 est le seul que portent les factures.
// Confondre les deux, c'est soit un écran introuvable, soit un rattachement
// faux. Une bonne partie des contrôles ci-dessous ne vérifie que ça.
//
// Aucun appel réseau, aucune base, aucune Edge Function : tout est local.
//   node scripts/verif-progbat-yards-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  codeAffiche, libelleYard, libelleLien, optionYard, normaliserRecherche,
  rattachementsDuChantier, yardsPrisAilleurs, yardsProposables, yardIntrouvable,
} from "../src/Renovation/progbatYardsEcran.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Jeu d'essai. TROTIER est le cas réel rapporté par l'utilisateur ; les deux
// autres couvrent un yard sans code visible et un yard sans rien du tout.
const TROTIER = { id: 83, businessId: 80, label: "T3 - RDC", publicYardNumber: null };
const YARDS = [
  { id: 12, businessId: 11, label: "Résidence Les Tilleuls — bât. A", publicYardNumber: null },
  { id: 34, businessId: null, label: "Villa Marceau", publicYardNumber: "Y-2026-034" },
  TROTIER,
];
const lien = (chantier, yardId, label = null, numero = null) => ({
  id: `lien-${chantier}-${yardId}`,
  chantier_id: chantier,
  progbat_yard_id: yardId,
  progbat_yard_label: label,
  progbat_public_yard_number: numero,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. RÈGLES PURES
// ═══════════════════════════════════════════════════════════════════════════

test("identification : le code visible et le sous-libellé, jamais un nom inventé", () => {
  assert.equal(codeAffiche(80), "Code ProGBat #80");
  assert.equal(libelleYard(TROTIER), "Code ProGBat #80 · T3 - RDC");
  assert.equal(libelleYard({ id: 34, businessId: null, label: "Villa Marceau" }), "Villa Marceau");
  assert.equal(libelleYard({ id: 56, businessId: 12, label: null }), "Code ProGBat #12");
  assert.equal(libelleYard({ id: 56, businessId: null, label: "   " }), "Chantier ProGBat sans libellé");
});

test("code visible : entier strictement positif, sinon aucun code affiché", () => {
  for (const mauvais of [0, -1, 1.5, "abc", "", null, undefined, {}, NaN]) {
    assert.equal(codeAffiche(mauvais), null, `businessId ${JSON.stringify(mauvais)} ne doit pas s'afficher`);
  }
  assert.equal(codeAffiche("80"), "Code ProGBat #80");   // texte numérique accepté
});

test("option du select : « Code ProGBat #80 · T3 - RDC — yard n°83 »", () => {
  assert.equal(optionYard(TROTIER), "Code ProGBat #80 · T3 - RDC — yard n°83");
  // Sans code visible, le libellé seul — mais le yardId reste NOMMÉ « yard ».
  assert.equal(optionYard({ id: 34, businessId: null, label: "Villa Marceau" }), "Villa Marceau — yard n°34");
  // Le yardId n'est jamais présenté comme « le » numéro ProGBat : c'est
  // exactement la confusion qui rendait l'écran illisible.
  assert.doesNotMatch(optionYard(TROTIER), /ProGBat n°83/);
});

test("recherche « 80 » : retrouve le chantier par son code visible", () => {
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "80" });
  assert.deepEqual(p.map((y) => y.id), [83]);
  assert.equal(p[0].businessId, 80);
  // Et « #80 » tel qu'affiché par ProGBat marche aussi.
  assert.deepEqual(
    yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "#80" }).map((y) => y.id),
    [83],
  );
});

test("recherche « T3 RDC » : retrouve le libellé malgré la ponctuation", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("T3 RDC"), [83]);     // le libellé réel est « T3 - RDC »
  assert.deepEqual(cherche("t3-rdc"), [83]);
  assert.deepEqual(cherche("T3 - RDC"), [83]);
  assert.equal(normaliserRecherche("T3 - RDC"), "t3 rdc");
});

test("recherche : libellé sans casse ni accents, yardId et numéro public", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("tilleuls"), [12]);
  assert.deepEqual(cherche("RESIDENCE"), [12]);
  assert.deepEqual(cherche("  marceau  "), [34]);
  assert.deepEqual(cherche("83"), [83]);          // yardId, pour qui le connaît
  assert.deepEqual(cherche("y-2026"), [34]);      // numéro public
  assert.deepEqual(cherche("zzz"), []);
  assert.deepEqual(cherche(""), [12, 34, 83]);
});

test("chantier sans aucun rattachement : rien d'affiché, tout proposé", () => {
  assert.deepEqual(rattachementsDuChantier([], "dupont"), []);
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont" });
  assert.equal(p.length, 3);
  assert.ok(p.every((y) => y.pris === null));
});

test("plusieurs chantiers ProGBat sur le même chantier Profero", () => {
  const liens = [
    lien("dupont", 12, "Code ProGBat #11 · Résidence Les Tilleuls — bât. A"),
    lien("dupont", 83, "Code ProGBat #80 · T3 - RDC"),
  ];
  const r = rattachementsDuChantier(liens, "dupont");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((l) => l.progbat_yard_id), [12, 83]);  // tri par libellé (#11 avant #80)
  // Et ces deux-là ne sont plus proposés.
  assert.deepEqual(yardsProposables({ yards: YARDS, liens, chantierId: "dupont" }).map((y) => y.id), [34]);
});

test("chantier ProGBat pris ailleurs : visible, marqué, jamais masqué", () => {
  const liens = [lien("martin", 83, "Code ProGBat #80 · T3 - RDC")];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont" });
  assert.deepEqual(p.map((y) => y.id), [12, 34, 83]);
  assert.equal(p.find((y) => y.id === 83).pris, "martin");
  assert.equal(p.find((y) => y.id === 12).pris, null);
  // La map sert au refus AVANT écriture, côté composant. Elle est indexée par
  // le yardId technique, jamais par le code visible.
  assert.equal(yardsPrisAilleurs(liens, "dupont").get("83"), "martin");
  assert.equal(yardsPrisAilleurs(liens, "dupont").get("80"), undefined);
  assert.equal(yardsPrisAilleurs(liens, "martin").size, 0);
});

test("identifiants : bigint texte en base, number côté ProGBat — même chantier", () => {
  // La base renvoie volontiers "83" là où ProGBat renvoie 83 : sans
  // normalisation, le yard serait proposé ET déjà rattaché.
  const liens = [lien("dupont", "83", "Code ProGBat #80 · T3 - RDC")];
  assert.deepEqual(yardsProposables({ yards: YARDS, liens, chantierId: "dupont" }).map((y) => y.id), [12, 34]);
});

test("rattachement affiché : état ACTUEL si connu, libellé figé sinon", () => {
  const l = lien("dupont", 83, "Code ProGBat #80 · T3 - RDC");
  // Le code a changé chez ProGBat : c'est la valeur actuelle qui s'affiche.
  assert.equal(libelleLien(l, { id: 83, businessId: 81, label: "T3 - RDC" }), "Code ProGBat #81 · T3 - RDC");
  // API muette : le libellé enregistré prend le relais, code compris.
  assert.equal(libelleLien(l, null), "Code ProGBat #80 · T3 - RDC");
  // Lien ancien, enregistré avant que le code soit connu : rien n'est inventé.
  assert.equal(libelleLien(lien("dupont", 83, null), null), "Chantier ProGBat sans libellé");
});

test("ProGBat indisponible : les rattachements enregistrés restent affichés", () => {
  const liens = [lien("dupont", 83, "Code ProGBat #80 · T3 - RDC"), lien("dupont", 99, "Code ProGBat #4 · Ancien")];
  // yards vide = liste non lue : on affiche tout, et on ne prétend PAS savoir
  // ce qui existe encore chez ProGBat.
  assert.equal(rattachementsDuChantier(liens, "dupont").length, 2);
  assert.equal(yardIntrouvable(liens[1], [], false), false);
  assert.equal(yardIntrouvable(liens[1], [], true), false);
});

test("« Non retrouvé actuellement dans ProGBat » : seulement si la liste a été lue", () => {
  const l = lien("dupont", 99, "Code ProGBat #4 · Ancien");
  assert.equal(yardIntrouvable(l, YARDS, true), true);
  assert.equal(yardIntrouvable(l, YARDS, false), false);              // erreur de lecture
  assert.equal(yardIntrouvable(lien("dupont", 83), YARDS, true), false);
  assert.equal(yardIntrouvable(lien("dupont", "83"), YARDS, true), false); // id texte
  // Le code visible ne vaut PAS identifiant : un lien vers le yard 80 (qui
  // n'existe pas) reste introuvable, même si 80 est le code du yard 83.
  assert.equal(yardIntrouvable(lien("dupont", 80), YARDS, true), true);
});

test("aucun rapprochement automatique par ressemblance de libellé", () => {
  // Un chantier Profero nommé exactement comme un yard ProGBat ne crée RIEN.
  const liens = [];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "trotier-t3-rdc" });
  assert.equal(p.length, 3);
  assert.ok(p.every((y) => y.pris === null));
  assert.deepEqual(rattachementsDuChantier(liens, "trotier-t3-rdc"), []);
  // Aucune de ces fonctions ne fabrique de lien : elles lisent, elles ne posent
  // rien. Le seul rattachement possible est l'insert explicite du composant.
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. COMPOSANT — analyse statique
// ═══════════════════════════════════════════════════════════════════════════
const JSX = lire("src/Renovation/ChantierYardsProgbat.jsx");

test("composant : la liste ProGBat vient de l'Edge Function, les liens de la table", () => {
  assert.match(JSX, /functions\.invoke\("progbat-yards-list"\)/);
  assert.match(JSX, /from\("chantier_progbat_yards"\)/);
  // Une seule fonction appelée, aucune autre table de rattachement touchée.
  const appels = JSX.match(/functions\.invoke\("([^"]+)"\)/g) || [];
  assert.deepEqual([...new Set(appels)], ['functions.invoke("progbat-yards-list")']);
  assert.doesNotMatch(JSX, /chantier_factures_client/);
});

test("composant : c'est yard.id qui est enregistré, jamais businessId", () => {
  const insert = JSX.slice(JSX.indexOf(".insert({"), JSX.indexOf(".insert({") + 600);
  assert.match(insert, /progbat_yard_id: yard\.id/);
  assert.doesNotMatch(insert, /businessId/);
  // Le libellé enregistré, lui, PORTE le code visible : c'est ce qui reste
  // lisible quand l'API ne répond plus.
  assert.match(insert, /progbat_yard_label: libelleYard\(yard\)/);
  assert.match(JSX, /Code ProGBat/);
});

test("composant : insert sans cree_par (la base applique default auth.uid())", () => {
  const insert = JSX.slice(JSX.indexOf(".insert({"), JSX.indexOf(".insert({") + 600);
  assert.match(insert, /chantier_id:/);
  assert.match(insert, /progbat_public_yard_number:/);
  assert.doesNotMatch(insert, /cree_par/);
});

test("composant : écritures uniquement sur clic — jamais dans un effet", () => {
  // Un insert/delete déclenché par useEffect rattacherait sans que personne
  // n'ait cliqué. Les deux écritures vivent dans rattacher() et detacher().
  const effets = JSX.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) || [];
  assert.equal(effets.length, 1);
  assert.doesNotMatch(effets[0], /insert|delete|upsert|update/);
  assert.equal((JSX.match(/\.insert\(/g) || []).length, 1);
  assert.equal((JSX.match(/\.delete\(/g) || []).length, 1);
  assert.match(JSX, /\.delete\(\)\.eq\("id", lien\.id\)/);          // une seule ligne, par son id
});

test("composant : le yardId affiché est nommé « yard », pas « ProGBat n° »", () => {
  assert.match(JSX, /yard n°\{l\.progbat_yard_id\}/);
  // Plus aucun « ProGBat n°<id technique> » : c'est ce libellé qui laissait
  // croire que 83 était le code affiché par ProGBat.
  assert.doesNotMatch(JSX, /ProGBat n°/);
});

test("composant : 23505 expliqué, détachement confirmé, erreur rattrapable", () => {
  assert.match(JSX, /error\.code === "23505"/);
  assert.match(JSX, /window\.confirm\(/);
  assert.match(JSX, /Ses futures factures ne seront plus reconnues automatiquement sur ce chantier/);
  assert.match(JSX, /Réessayer/);
  assert.match(JSX, /Non retrouvé actuellement dans ProGBat/);
});

test("composant : cache mémoire court, jamais de localStorage", () => {
  // Sur le CODE seul : « jamais de localStorage » écrit en commentaire ne
  // prouve rien, et ne doit pas non plus faire échouer le contrôle.
  const CODE = JSX.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(CODE, /localStorage|sessionStorage/);
  const ttl = JSX.match(/const TTL_MS = ([^;]+);/);
  assert.ok(ttl, "TTL absent");
  // Promesse partagée : deux composants montés en même temps n'appellent pas
  // deux fois l'Edge Function.
  assert.match(JSX, /cacheYards\.promise/);
  assert.ok(eval(ttl[1]) <= 5 * 60 * 1000, "TTL supérieur à 5 minutes");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. BRANCHEMENT ET REPLI PAR DEVIS
// ═══════════════════════════════════════════════════════════════════════════
const FACT = lire("src/Renovation/FacturationChantier.jsx");
const DEVIS = lire("src/Renovation/ChantierProjetsProgbat.jsx");

test("facturation : le nouveau bloc d'abord, le repli replié après", () => {
  assert.match(FACT, /import ChantierYardsProgbat from "\.\/ChantierYardsProgbat"/);
  assert.match(FACT, /import ChantierProjetsProgbat from "\.\/ChantierProjetsProgbat"/);
  const posYards = FACT.indexOf("<ChantierYardsProgbat");
  const posDetails = FACT.indexOf("<details");
  const posDevis = FACT.indexOf("<ChantierProjetsProgbat");
  assert.ok(posYards > 0 && posDetails > posYards && posDevis > posDetails,
    "ordre attendu : ChantierYardsProgbat, puis <details>, puis ChantierProjetsProgbat");
  // <details> sans `open` = replié par défaut.
  assert.doesNotMatch(FACT.slice(posDetails, posDetails + 40), /\sopen[\s>]/);
  assert.match(FACT, /Rattachement de secours par devis/);
  assert.match(FACT, /ne possédant pas de chantier \(yardId absent\)/);
});

test("repli par devis : toujours branché, renommé, fonctionnement intact", () => {
  assert.match(DEVIS, /Rattachement de secours par devis/);
  assert.doesNotMatch(DEVIS, /> Logements \/ devis ProGBat/);
  // Ce qui fait marcher le repli n'a pas bougé.
  assert.match(DEVIS, /progbat_devis_exportables/);
  assert.match(DEVIS, /from\("chantier_projets"\)/);
  assert.match(DEVIS, /error\.code === "23505"/);
});

// ═══════════════════════════════════════════════════════════════════════════
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
console.log(`\nverif-progbat-yards-ecran : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
