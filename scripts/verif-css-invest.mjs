// scripts/verif-css-invest.mjs — Sélecteurs CSS qui ne peuvent rien atteindre.
//
// Pourquoi ce script : tout le CSS mobile d'Invest était MORT sans que rien ne
// le signale. Il ciblait `.inv > div:first-child` pour atteindre la barre
// latérale — or le premier enfant de `.inv` est une balise <style>, pas un div.
// Le sélecteur ne correspondait à aucun élément.
//
// Effet observé sur téléphone : `.inv` passait bien en colonne, mais la barre
// latérale gardait son `height:100%` en ligne. Elle occupait tout l'écran en
// hauteur, le contenu était poussé dessous, et `overflow:hidden` le masquait.
// On voyait les onglets, et rien d'autre — pendant des mois, sans erreur, sans
// avertissement de build.
//
// Deux vérifications, correspondant aux deux façons de se tromper :
//
//   1. CLASSE ORPHELINE — une classe ciblée par le CSS mais posée nulle part
//      dans le JSX. Le style ne s'appliquera jamais.
//   2. SÉLECTEUR POSITIONNEL FRAGILE — un `:first-child` / `:last-child` /
//      `:nth-child` dans le CSS Invest. Ils cassent au moindre élément inséré,
//      et c'est exactement ce qui s'est produit. On les signale pour qu'ils
//      soient remplacés par des classes.
//
// Usage :  node scripts/verif-css-invest.mjs
//
// Aucune dépendance.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOSSIER = "src/Invest";
const fichiers = readdirSync(DOSSIER).filter(f => f.endsWith(".jsx") || f.endsWith(".js"));
const sources = Object.fromEntries(
  fichiers.map(f => [f, readFileSync(join(DOSSIER, f), "utf8")]));

// ── Classes réellement posées dans le JSX ──────────────────────────────────
// Deux formes : className="a b" et className={`a${x?" b":""}`}. La seconde est
// courante pour les états actifs, et une regex naïve la manquerait — ce qui
// produirait de faux positifs plus bruyants que le bug cherché.
const posees = new Set();
for (const src of Object.values(sources)) {
  for (const m of src.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    const brut = m[1] || m[2] || m[3] || "";
    // Dans un template, on ne garde que les fragments littéraux.
    for (const mot of brut.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      const c = mot.trim();
      if (c) posees.add(c);
    }
  }
}

// ── Classes ciblées par le CSS Invest ──────────────────────────────────────
// Le CSS vit dans des littéraux de gabarit de _shared.jsx (getCSS). On ratisse
// tous les fichiers : certains modules embarquent leur propre <style>.
function sansCommentaires(src) {
  // Les commentaires contiennent des noms de tables (« public.invest_prospects »)
  // que la regex prendrait pour des sélecteurs. On les retire d'abord.
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const ciblees = new Map();   // classe -> fichiers qui la ciblent
for (const [f, brut] of Object.entries(sources)) {
  const src = sansCommentaires(brut);
  // Un sélecteur CSS est suivi d'une accolade, d'une virgule, d'un
  // combinateur ou d'un pseudo — pas d'une parenthèse ni d'un guillemet.
  for (const m of src.matchAll(/\.(inv-[A-Za-z0-9_-]*)\s*(?=[{,:.\s>+~])/g)) {
    const c = m[1];
    if (!ciblees.has(c)) ciblees.set(c, new Set());
    ciblees.get(c).add(f);
  }
}

// ── Sélecteurs positionnels dans les blocs CSS ─────────────────────────────
const positionnels = [];
for (const [f, brut] of Object.entries(sources)) {
  // Même précaution que pour les classes : la prose des commentaires CSS
  // (/* … */) cite des sélecteurs sans en être.
  sansCommentaires(brut).split("\n").forEach((ligne, i) => {
    const t = ligne.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (!/\.inv/.test(t)) return;

    // Distinction essentielle, sinon le contrôle devient du bruit :
    //
    //   .inv-row:last-child{...}        LÉGITIME — style le dernier d'une
    //                                   liste, la classe fait l'identification.
    //   .inv > div:first-child{...}     FRAGILE — c'est le pseudo qui identifie
    //                                   l'élément, et il casse au moindre
    //                                   enfant inséré. C'est le bug vécu.
    //
    // On ne signale donc que les pseudos précédés d'un type d'élément nu, d'un
    // astérisque, ou d'un combinateur.
    const fragile = /(?:^|[\s>+~])(?:\*|[a-z]+)\s*:(?:first|last|nth)-child/.test(t);
    if (!fragile) return;
    positionnels.push({ f, ligne: i + 1, texte: t.slice(0, 110) });
  });
}

let problemes = 0;

console.log("Sélecteurs CSS Invest");
console.log("═".repeat(64));

const orphelines = [...ciblees.keys()].filter(c => !posees.has(c)).sort();
if (orphelines.length) {
  console.log("\nClasses ciblées par le CSS mais posées nulle part :");
  for (const c of orphelines) {
    console.log(`  ✗ .${c}  (ciblée dans ${[...ciblees.get(c)].join(", ")})`);
    problemes++;
  }
} else {
  console.log(`\n✓ ${ciblees.size} classes ciblées, toutes posées dans le JSX.`);
}

if (positionnels.length) {
  console.log("\nSélecteurs positionnels — fragiles, à remplacer par des classes :");
  for (const p of positionnels) {
    console.log(`  ⚠ ${DOSSIER}/${p.f}:${p.ligne}`);
    console.log(`      ${p.texte}`);
    problemes++;
  }
} else {
  console.log("✓ aucun sélecteur positionnel sur .inv.");
}

console.log("\n" + "═".repeat(64));
console.log(problemes === 0
  ? `✓ ${fichiers.length} fichiers, aucun sélecteur mort ni fragile.`
  : `✗ ${problemes} point(s) à corriger.`);
process.exit(problemes === 0 ? 0 : 1);
