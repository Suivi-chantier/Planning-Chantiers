// scripts/verif-composants-internes.mjs — Composants déclarés dans un composant.
//
// Pourquoi ce script : un composant React déclaré à l'intérieur d'un autre est
// RECRÉÉ à chaque rendu du parent. React compare les types par identité de
// fonction : un type différent signifie « autre composant », donc démontage du
// sous-arbre et remontage à neuf. Le DOM est détruit et recréé.
//
// Symptôme vécu le 2026-08-21, onglet Urbanisme, pièces à joindre : chaque
// lettre tapée dans le champ Commentaire déclenchait setD, qui re-rendait
// OngletPieces, qui recréait la fonction Ligne. Le champ était détruit à chaque
// frappe et le focus perdu — il fallait recliquer entre chaque lettre.
//
// Le `key` ne protège pas : il départage des éléments de MÊME type. Ici c'est le
// type qui change.
//
// Sans champ de saisie à l'intérieur, le bug est invisible mais bien présent :
// remontage complet du sous-arbre à chaque rendu, état interne perdu, effets
// rejoués. C'est pour cela qu'on les signale tous.
//
// Un composant est reconnu à deux signes : nom en majuscule initiale, et
// production de JSX. Une fonction utilitaire locale qui renvoie une valeur
// n'est pas concernée.
//
// Usage :  node scripts/verif-composants-internes.mjs [fichier…]
//          sans argument : tout src/, récursivement.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverseMod = require("@babel/traverse");
const traverse = traverseMod.default || traverseMod;

function parcourir(dossier) {
  const out = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) out.push(...parcourir(chemin));
    else if (/\.(jsx|js|mjs)$/.test(e.name)) out.push(chemin);
  }
  return out.sort();
}

const cibles = process.argv.slice(2).length ? process.argv.slice(2) : parcourir("src");
const estNomComposant = (n) => typeof n === "string" && /^[A-Z]/.test(n);

let problemes = 0, analyses = 0;

for (const chemin of cibles) {
  let ast;
  try {
    ast = parser.parse(readFileSync(chemin, "utf8"), {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "logicalAssignment"],
      errorRecovery: true,
    });
  } catch { continue; }
  analyses++;

  traverse(ast, {
    Function(voie) {
      // Nom de la fonction porteuse, quelle que soit sa forme d'écriture.
      const nomDe = (v) => {
        if (v.node.id?.name) return v.node.id.name;
        const parent = v.parentPath;
        if (parent?.isVariableDeclarator() && parent.node.id?.name) return parent.node.id.name;
        return null;
      };

      const nom = nomDe(voie);
      if (!estNomComposant(nom)) return;

      // Produit-elle du JSX ? Sinon c'est un utilitaire, pas un composant.
      // `this` n'est pas le contexte de traversée dans une fonction fléchée
      // abrégée : on se contente du drapeau, sans arrêt anticipé.
      let produitJSX = false;
      voie.traverse({
        JSXElement() { produitJSX = true; },
        JSXFragment() { produitJSX = true; },
      });
      if (!produitJSX) return;

      // Une fonction englobante qui soit elle-même un composant ?
      let englobante = voie.parentPath;
      while (englobante) {
        if (englobante.isFunction?.()) {
          const nomEng = nomDe(englobante);
          if (estNomComposant(nomEng)) {
            console.log(`  ✗ ${chemin}:${voie.node.loc?.start.line ?? 0}`);
            console.log(`      « ${nom} » est déclaré dans « ${nomEng} » — recréé à chaque rendu`);
            problemes++;
            return;
          }
          // Fonction englobante non-composant (callback, map…) : on continue de
          // remonter, la déclaration peut tout de même être dans un composant.
        }
        englobante = englobante.parentPath;
      }
    },
  });
}

console.log("\n" + "═".repeat(66));
console.log(problemes === 0
  ? `✓ ${analyses} fichiers analysés, aucun composant déclaré dans un autre.`
  : `✗ ${problemes} composant(s) recréé(s) à chaque rendu du parent.`);
process.exit(problemes === 0 ? 0 : 1);
