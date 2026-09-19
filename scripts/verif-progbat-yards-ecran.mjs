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
// LE PIÈGE DE CET ÉCRAN : ProGBat affiche « #83 TROTTIER - T2 - R+2 » là où son
// API donne à ce chantier l'id 86 et le libellé « T2 - R+2 ». Ce code est le
// seul nom que l'utilisateur reconnaît ; le 86 est le seul numéro que portent
// les factures. Confondre les deux, c'est soit un écran introuvable, soit un
// rattachement faux — et recomposer le code, c'est se tromper dès la première
// exception de format (« #103 TROTTIER ENEDIS »). Une bonne partie des
// contrôles ci-dessous ne vérifie que ça.
//
// Aucun appel réseau, aucune base, aucune Edge Function : tout est local.
//   node scripts/verif-progbat-yards-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  libelleYard, libelleLien, optionYard, normaliserRecherche,
  rattachementsDuChantier, yardsPrisAilleurs, yardsProposables, yardIntrouvable,
} from "../src/Renovation/progbatYardsEcran.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Jeu d'essai : les chantiers RÉELS de l'écran ProGBat, tels que
// progbat-yards-list les renvoie (code = champ `code` de l'affaire, repris tel
// quel ; id = yardId technique ; label = sous-libellé du chantier).
const TROTTIER_T2 = { id: 86, code: "#83 TROTTIER - T2 - R+2", label: "T2 - R+2", publicYardNumber: null };
const YARDS = [
  { id: 83, code: "#80 TROTTIER - T3 - RDC", label: "T3 - RDC", publicYardNumber: null },
  TROTTIER_T2,
  { id: 120, code: "#103 TROTTIER ENEDIS", label: "ENEDIS", publicYardNumber: null },
  // Chantier dont l'affaire n'a pas de code : repli attendu.
  { id: 44, code: null, label: "Villa Marceau", publicYardNumber: "Y-2026-034" },
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

test("affichage : le code de ProGBat, exactement — rien avant, rien après", () => {
  assert.equal(libelleYard(TROTTIER_T2), "#83 TROTTIER - T2 - R+2");
  assert.equal(optionYard(TROTTIER_T2), "#83 TROTTIER - T2 - R+2");
  assert.equal(optionYard(YARDS[2]), "#103 TROTTIER ENEDIS");
  // Aucune trace de l'identifiant technique ni d'un préfixe fabriqué.
  assert.doesNotMatch(optionYard(TROTTIER_T2), /86|yard n°|Code ProGBat|·/);
});

test("affichage : le code n'est jamais recomposé à partir des autres champs", () => {
  // Même entrées, codes stockés différents : la sortie SUIT le code, elle ne le
  // déduit pas. « #103 TROTTIER ENEDIS » ne suit pas le motif des autres.
  assert.equal(libelleYard({ id: 120, code: "#103 TROTTIER ENEDIS", label: "ENEDIS" }), "#103 TROTTIER ENEDIS");
  assert.equal(libelleYard({ id: 120, code: "AFFAIRE 2026-07 (avenant)", label: "ENEDIS" }), "AFFAIRE 2026-07 (avenant)");
  // Un code qui ne contient ni le libellé ni aucun numéro reste intact.
  assert.equal(libelleYard({ id: 9, code: "ZZ", label: "Lot 3" }), "ZZ");
});

test("affichage : sans code, repli lisible avec le libellé et l'identifiant", () => {
  assert.equal(libelleYard({ id: 44, code: null, label: "Villa Marceau" }), "Villa Marceau — chantier ProGBat n°44");
  assert.equal(libelleYard({ id: 86, code: "   ", label: "T2 - R+2" }), "T2 - R+2 — chantier ProGBat n°86");
  assert.equal(libelleYard({ id: 44, code: null, label: null }), "Chantier ProGBat n°44");
});

test("recherche « 83 » : retrouve le chantier par le numéro de son code", () => {
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "83" });
  // Le chantier cherché est bien là, trouvé par son code « #83 … ».
  const cible = p.find((y) => y.id === 86);
  assert.ok(cible, "le chantier #83 TROTTIER - T2 - R+2 doit être proposé");
  assert.equal(cible.code, "#83 TROTTIER - T2 - R+2");
  // Le chantier dont l'identifiant TECHNIQUE vaut 83 sort aussi : la recherche
  // porte sur les deux, et rien ne permet de deviner lequel est voulu. Les
  // codes étant affichés en clair, l'utilisateur tranche d'un coup d'œil.
  assert.deepEqual(p.map((y) => y.id), [83, 86]);
  // « #83 » tel qu'affiché par ProGBat donne le même résultat : le croisillon
  // n'est pas un caractère significatif pour la recherche.
  assert.deepEqual(
    yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "#83" }).map((y) => y.id),
    [83, 86],
  );
});

test("recherche « TROTTIER » : retrouve les trois chantiers de l'affaire", () => {
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "TROTTIER" });
  assert.deepEqual(p.map((y) => y.id), [83, 86, 120]);
  assert.deepEqual(
    yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: "trottier" }).map((y) => y.id),
    [83, 86, 120],
  );
});

test("recherche « R+2 » : retrouve le chantier malgré la ponctuation", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("R+2"), [86]);
  assert.deepEqual(cherche("T2 R2"), [86]);
  assert.deepEqual(cherche("t2 - r+2"), [86]);
  assert.equal(normaliserRecherche("#83 TROTTIER - T2 - R+2"), "83 trottier t2 r 2");
});

test("recherche : libellé, identifiant technique et numéro public", () => {
  const cherche = (q) => yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont", recherche: q })
    .map((y) => y.id);
  assert.deepEqual(cherche("marceau"), [44]);       // libellé, chantier sans code
  assert.deepEqual(cherche("120"), [120]);          // identifiant technique
  assert.deepEqual(cherche("y-2026"), [44]);        // numéro public
  assert.deepEqual(cherche("zzz"), []);
  assert.deepEqual(cherche(""), [83, 86, 120, 44]);
});

test("chantier sans aucun rattachement : rien d'affiché, tout proposé", () => {
  assert.deepEqual(rattachementsDuChantier([], "dupont"), []);
  const p = yardsProposables({ yards: YARDS, liens: [], chantierId: "dupont" });
  assert.equal(p.length, 4);
  assert.ok(p.every((y) => y.pris === null));
});

test("plusieurs chantiers ProGBat sur le même chantier Profero", () => {
  const liens = [
    lien("dupont", 83, "#80 TROTTIER - T3 - RDC"),
    lien("dupont", 86, "#83 TROTTIER - T2 - R+2"),
  ];
  const r = rattachementsDuChantier(liens, "dupont");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((l) => l.progbat_yard_id), [83, 86]);   // tri sur le code enregistré
  assert.deepEqual(yardsProposables({ yards: YARDS, liens, chantierId: "dupont" }).map((y) => y.id), [120, 44]);
});

test("chantier ProGBat pris ailleurs : visible, marqué, jamais masqué", () => {
  const liens = [lien("martin", 86, "#83 TROTTIER - T2 - R+2")];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "dupont" });
  assert.deepEqual(p.map((y) => y.id), [83, 86, 120, 44]);
  assert.equal(p.find((y) => y.id === 86).pris, "martin");
  assert.equal(p.find((y) => y.id === 83).pris, null);
  // La map est indexée par le yardId technique, jamais par le numéro du code :
  // le « 83 » de « #83 TROTTIER » est aussi l'id d'un AUTRE chantier.
  assert.equal(yardsPrisAilleurs(liens, "dupont").get("86"), "martin");
  assert.equal(yardsPrisAilleurs(liens, "dupont").get("83"), undefined);
  assert.equal(yardsPrisAilleurs(liens, "martin").size, 0);
});

test("identifiants : bigint texte en base, number côté ProGBat — même chantier", () => {
  const liens = [lien("dupont", "86", "#83 TROTTIER - T2 - R+2")];
  assert.deepEqual(yardsProposables({ yards: YARDS, liens, chantierId: "dupont" }).map((y) => y.id), [83, 120, 44]);
});

test("rattachement affiché : code ACTUEL si connu, code figé sinon", () => {
  const l = lien("dupont", 86, "#83 TROTTIER - T2 - R+2");
  // Le code a été corrigé chez ProGBat : c'est la valeur actuelle qui s'affiche.
  assert.equal(libelleLien(l, { id: 86, code: "#83 TROTTIER - T2 - R+2 (tranche 2)", label: "T2 - R+2" }),
    "#83 TROTTIER - T2 - R+2 (tranche 2)");
  // API muette : le code enregistré prend le relais — d'où l'intérêt de
  // l'enregistrer plutôt que le seul sous-libellé « T2 - R+2 ».
  assert.equal(libelleLien(l, null), "#83 TROTTIER - T2 - R+2");
  // Lien enregistré sans libellé : l'identifiant technique, faute de mieux.
  assert.equal(libelleLien(lien("dupont", 86, null), null), "Chantier ProGBat n°86");
});

test("ProGBat indisponible : les rattachements enregistrés restent affichés", () => {
  const liens = [lien("dupont", 86, "#83 TROTTIER - T2 - R+2"), lien("dupont", 99, "#4 ANCIEN")];
  assert.equal(rattachementsDuChantier(liens, "dupont").length, 2);
  assert.equal(yardIntrouvable(liens[1], [], false), false);
  assert.equal(yardIntrouvable(liens[1], [], true), false);
});

test("« Non retrouvé actuellement dans ProGBat » : seulement si la liste a été lue", () => {
  const l = lien("dupont", 99, "#4 ANCIEN");
  assert.equal(yardIntrouvable(l, YARDS, true), true);
  assert.equal(yardIntrouvable(l, YARDS, false), false);                  // erreur de lecture
  assert.equal(yardIntrouvable(lien("dupont", 86), YARDS, true), false);
  assert.equal(yardIntrouvable(lien("dupont", "86"), YARDS, true), false); // id texte
  // Le numéro lu dans un code ne vaut PAS identifiant : un lien vers le yard 103
  // (qui n'existe pas) reste introuvable, même si « #103 » figure dans un code.
  assert.equal(yardIntrouvable(lien("dupont", 103), YARDS, true), true);
});

test("aucun rapprochement automatique par ressemblance", () => {
  // Un chantier Profero nommé comme un chantier ProGBat ne crée RIEN.
  const liens = [];
  const p = yardsProposables({ yards: YARDS, liens, chantierId: "trottier-t2-r2" });
  assert.equal(p.length, 4);
  assert.ok(p.every((y) => y.pris === null));
  assert.deepEqual(rattachementsDuChantier(liens, "trottier-t2-r2"), []);
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

test("composant : c'est yard.id qui est enregistré, et le code qui est figé", () => {
  // L'objet inséré, et lui seul : ce qui suit (gestion du 23505) parle aussi de
  // `code`, mais ce n'est pas ce qui est écrit en base.
  const debut = JSX.indexOf(".insert({");
  const insert = JSX.slice(debut, JSX.indexOf("});", debut));
  assert.match(insert, /progbat_yard_id: yard\.id/);
  assert.doesNotMatch(insert, /businessId|yard\.code/);
  // Le libellé enregistré, c'est le code EXACT (libelleYard renvoie yard.code
  // tel quel) : c'est ce qui reste lisible quand l'API ne répond plus.
  assert.match(insert, /progbat_yard_label: libelleYard\(yard\)/);
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

test("composant : l'identifiant technique est secondaire, jamais le titre", () => {
  // Le titre d'un rattachement est libelleLien (donc le code) ; l'identifiant
  // technique est une mention grise, nommée comme telle.
  assert.match(JSX, /identifiant technique : \{l\.progbat_yard_id\}/);
  assert.doesNotMatch(JSX, /yard n°/);
  // Et rien n'est accolé au code dans les options du select.
  assert.doesNotMatch(JSX, /\{optionYard\(y\)\}\s*\n\s*\{y\.publicYardNumber/);
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
