#!/usr/bin/env node
// Vérifie l'ÉCRAN « Chantiers ProGBat associés » :
//   1. les règles pures src/Renovation/progbatYardsEcran.mjs (liste proposée,
//      recherche, états « déjà rattaché », « non retrouvé ») ;
//   2. par analyse statique, ce que le composant ChantierYardsProgbat.jsx
//      écrit en base et ce qu'il ne doit SURTOUT pas faire (rapprochement
//      automatique, cree_par forcé, localStorage) ;
//   3. le branchement dans FacturationChantier.jsx et la conservation du
//      repli par devis.
//
// Aucun appel réseau, aucune base, aucune Edge Function : tout est local.
//   node scripts/verif-progbat-yards-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  libelleYard, normaliserRecherche, rattachementsDuChantier,
  yardsPrisAilleurs, yardsProposables, yardIntrouvable,
} from "../src/Renovation/progbatYardsEcran.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Jeu d'essai : trois chantiers ProGBat, dont un sans libellé.
const YARDS = [
  { id: 12, label: "Résidence Les Tilleuls — bât. A", publicYardNumber: null },
  { id: 34, label: "Villa Marceau", publicYardNumber: "Y-2026-034" },
  { id: 56, label: null, publicYardNumber: null },
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

test("libellé : celui de ProGBat, sinon le numéro — jamais un nom inventé", () => {
  assert.equal(libelleYard("Villa Marceau", 34), "Villa Marceau");
  assert.equal(libelleYard("", 56), "Chantier ProGBat n°56");
  assert.equal(libelleYard(null, 56), "Chantier ProGBat n°56");
  assert.equal(libelleYard("   ", 56), "Chantier ProGBat n°56");
});

test("chantier sans aucun rattachement : rien d'affiché, tout proposé", () => {
  assert.deepEqual(rattachementsDuChantier([], "dupont"), []);
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont" });
  assert.equal(p.length, 3);
  assert.ok(p.every((y) => y.pris === null));
});

test("plusieurs chantiers ProGBat sur le même chantier Profero", () => {
  const liens = [lien("dupont", 12, "Résidence Les Tilleuls — bât. A"), lien("dupont", 56)];
  const r = rattachementsDuChantier(liens, "dupont");
  assert.equal(r.length, 2);
  // Tri par libellé : « Chantier ProGBat n°56 » avant « Résidence… ».
  assert.deepEqual(r.map((l) => l.progbat_yard_id), [56, 12]);
  // Et ces deux-là ne sont plus proposés.
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont" });
  assert.deepEqual(p.map((y) => y.id), [34]);
});

test("chantier ProGBat pris ailleurs : visible, marqué, jamais masqué", () => {
  const liens = [lien("martin", 34, "Villa Marceau")];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont" });
  assert.deepEqual(p.map((y) => y.id), [12, 34, 56]);
  assert.equal(p.find((y) => y.id === 34).pris, "martin");
  assert.equal(p.find((y) => y.id === 12).pris, null);
  // La map sert au refus AVANT écriture, côté composant.
  assert.equal(yardsPrisAilleurs(liens, "dupont").get("34"), "martin");
  assert.equal(yardsPrisAilleurs(liens, "martin").size, 0);
});

test("identifiants : bigint texte en base, number côté ProGBat — même chantier", () => {
  // La base renvoie volontiers "34" là où ProGBat renvoie 34 : sans
  // normalisation, le yard serait proposé ET déjà rattaché.
  const liens = [{ ...lien("dupont", "34", "Villa Marceau") }];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont" });
  assert.deepEqual(p.map((y) => y.id), [12, 56]);
});

test("recherche par libellé : sans casse ni accents", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("tilleuls"), [12]);
  assert.deepEqual(cherche("RESIDENCE"), [12]);
  assert.deepEqual(cherche("  marceau  "), [34]);
  assert.deepEqual(cherche("zzz"), []);
  assert.deepEqual(cherche(""), [12, 34, 56]);
});

test("recherche par identifiant et par numéro public", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("56"), [56]);
  assert.deepEqual(cherche("34"), [34]);          // id ET numéro public "Y-2026-034"
  assert.deepEqual(cherche("y-2026"), [34]);
  assert.equal(normaliserRecherche("Résidence"), "residence");
});

test("recherche : un chantier pris ailleurs reste trouvable et reste marqué", () => {
  const liens = [lien("martin", 34, "Villa Marceau")];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont", recherche: "marceau" });
  assert.deepEqual(p.map((y) => y.id), [34]);
  assert.equal(p[0].pris, "martin");
});

test("ProGBat indisponible : les rattachements enregistrés restent affichés", () => {
  const liens = [lien("dupont", 12, "Résidence Les Tilleuls — bât. A"), lien("dupont", 99, "Ancien chantier")];
  // yards vide = liste non lue : on affiche tout, et on ne prétend PAS savoir
  // ce qui existe encore chez ProGBat.
  assert.equal(rattachementsDuChantier(liens, "dupont").length, 2);
  assert.equal(yardIntrouvable(liens[1], [], false), false);
  assert.equal(yardIntrouvable(liens[1], [], true), false);
});

test("« Non retrouvé actuellement dans ProGBat » : seulement si la liste a été lue", () => {
  const l = lien("dupont", 99, "Ancien chantier");
  assert.equal(yardIntrouvable(l, YARDS, true), true);
  assert.equal(yardIntrouvable(l, YARDS, false), false);          // erreur de lecture
  assert.equal(yardIntrouvable(lien("dupont", 12), YARDS, true), false);
  assert.equal(yardIntrouvable(lien("dupont", "12"), YARDS, true), false); // id texte
});

test("aucun rapprochement automatique par ressemblance de libellé", () => {
  // Un chantier Profero nommé exactement comme un yard ProGBat ne crée RIEN.
  const liens = [];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "villa-marceau" });
  assert.equal(p.length, 3);
  assert.ok(p.every((y) => y.pris === null));
  assert.deepEqual(rattachementsDuChantier(liens, "villa-marceau"), []);
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

test("composant : insert sans cree_par (la base applique default auth.uid())", () => {
  const insert = JSX.slice(JSX.indexOf(".insert({"), JSX.indexOf(".insert({") + 400);
  assert.match(insert, /chantier_id:/);
  assert.match(insert, /progbat_yard_id: yard\.id/);
  assert.match(insert, /progbat_yard_label:/);
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
