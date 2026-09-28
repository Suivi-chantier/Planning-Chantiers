// Vérification : import Google Sheets de la bibliothèque matériaux,
// noms rendus uniques avant l'« upsert par nom ».
//
// Le cas qui l'a provoquée (28/09/2026) : le catalogue SIDER (22 510 lignes)
// porte 266 noms partagés par 544 articles différents. L'import s'arrêtait au
// 2e lot sur « ON CONFLICT DO UPDATE command cannot affect row a second time ».
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rendreNomsUniquesV1,
  IMPORT_NOMS_UNIQUES_VERSION,
} from "../src/Renovation/importNomsUniquesV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const lire = async f => readFile(resolve(here, f), "utf8");

const l = (nom, reference, _line, extra = {}) => ({ nom, reference, _line, ...extra });
const noms = r => r.lignes.map(x => x.nom);

// 1. Aucun doublon : rien ne change, les noms existants restent intacts.
{
  const r = rendreNomsUniquesV1([l("VIS A", "1", 2), l("VIS B", "2", 3)]);
  assert.deepEqual(noms(r), ["VIS A", "VIS B"]);
  assert.equal(r.renommes.length, 0);
  assert.equal(r.fusionnes.length, 0);
  assert.equal(r.nomsEnDouble, 0);
}

// 2. Même nom, références différentes : TOUS les articles gardés, référence en suffixe.
{
  const r = rendreNomsUniquesV1([
    l("TETE 18X150", "900", 2, { prix_unitaire: "3.34" }),
    l("VIS A", "1", 3),
    l("TETE 18X150", "901", 4, { prix_unitaire: "2.90" }),
    l("TETE 18X150", "902", 5),
  ]);
  assert.deepEqual(noms(r), ["TETE 18X150 (réf 900)", "VIS A", "TETE 18X150 (réf 901)", "TETE 18X150 (réf 902)"]);
  assert.equal(r.lignes.length, 4, "aucun article perdu");
  assert.equal(r.nomsEnDouble, 1);
  assert.equal(r.renommes.length, 3);
  assert.equal(r.lignes[0].prix_unitaire, "3.34", "les autres colonnes sont conservées");
  assert.equal(r.lignes[0].reference, "900");
}

// 3. Doublon exact (même nom, même référence) : une seule ligne, la dernière, signalée.
{
  const r = rendreNomsUniquesV1([l("VIS A", "1", 2, { prix_unitaire: "1" }), l("VIS A", "1", 3, { prix_unitaire: "2" })]);
  assert.deepEqual(noms(r), ["VIS A"], "pas de suffixe : il ne reste qu'un article");
  assert.equal(r.lignes[0].prix_unitaire, "2");
  assert.deepEqual(r.fusionnes, [{ ligne: 2, nom: "VIS A", gardee: 3 }]);
}

// 4. Sans référence : le numéro de ligne départage.
{
  const r = rendreNomsUniquesV1([l("VIS A", "", 2), l("VIS A", "7", 3)]);
  assert.deepEqual(noms(r), ["VIS A (ligne 2)", "VIS A (réf 7)"]);
}

// 5. Filet : le nom suffixé tombe sur un nom déjà présent dans le tableur.
{
  const r = rendreNomsUniquesV1([l("VIS A (réf 1)", "9", 2), l("VIS A", "1", 3), l("VIS A", "2", 4)]);
  assert.equal(new Set(noms(r)).size, 3);
  assert.equal(noms(r)[1], "VIS A (réf 1) (ligne 3)");
}

// 6. Garantie centrale : la sortie n'a jamais deux fois le même nom.
{
  const entree = [];
  for (let i = 0; i < 300; i++) entree.push(l(`ART ${i % 37}`, String(i % 91), i + 2));
  const r = rendreNomsUniquesV1(entree);
  assert.equal(new Set(noms(r)).size, r.lignes.length);
  assert.equal(r.lignes.length + r.fusionnes.length, entree.length, "chaque ligne est gardée ou signalée");
}

// 7. Stable d'un import à l'autre (même tableur ⇒ mêmes noms ⇒ l'upsert met à jour).
{
  const entree = [l("X", "1", 2), l("X", "2", 3)];
  assert.deepEqual(noms(rendreNomsUniquesV1(entree)), noms(rendreNomsUniquesV1(entree)));
}

// 8. Pureté + branchement.
{
  const source = await lire("../src/Renovation/importNomsUniquesV1.mjs");
  const facade = await lire("../src/Renovation/importNomsUniquesV1.js");
  const ecran = await lire("../src/Renovation/PageBibliothequeMateriaux.jsx");
  assert.doesNotMatch(source, /supabase|Date\.now|new Date|fetch\(/);
  assert.match(facade, /export \* from "\.\/importNomsUniquesV1\.mjs"/);
  assert.match(ecran, /rendreNomsUniquesV1\(/, "l'écran d'import passe par le module");
  assert.match(ecran, /setPreview\(uniques\.lignes\)/, "l'aperçu montre les noms qui seront écrits");
  assert.equal(IMPORT_NOMS_UNIQUES_VERSION, "v1");
}

console.log("verif-import-noms-uniques : OK");
