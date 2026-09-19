#!/usr/bin/env node
// Vérifie les règles pures du formulaire « Suggérer un matériau »
// (src/Renovation/suggestionsMateriaux.mjs). Aucun réseau, aucune base.
//   node scripts/verif-suggestions-materiaux.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  normaliserNombre, validerQuantite, validerChoixMateriau,
  grouperParOuvrage, doublonLocal, reponseObsolete, PRECISION_MAX, QUANTITE_MAX,
} = await import(new URL("../src/Renovation/suggestionsMateriaux.mjs", import.meta.url).href);
const { clesFinancieres } =
  await import(new URL("../src/Renovation/preparationChantier.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const MAT = { id: "m1", nom: "Vis 4x45", reference: "R-1", unite: "U", fournisseur: "Point P" };
const SUGGESTIONS = [
  { id: "s1", ouvrage_id: "o1", designation: "Vis 4x45", reference: "R-1",
    quantite_totale: 12, unite: "U", precision: null, statut: "en_attente", cree_le: "2026-09-17T08:00:00Z" },
  { id: "s2", ouvrage_id: "o1", designation: "Colle spéciale", reference: null,
    quantite_totale: 2, unite: "sac", precision: "pour la trémie", statut: "en_attente", cree_le: "2026-09-17T09:00:00Z" },
  { id: "s3", ouvrage_id: "o2", designation: "Bande à joint", reference: null,
    quantite_totale: 5, unite: "rouleau", precision: null, statut: "en_attente", cree_le: "2026-09-17T10:00:00Z" },
];

test("1. « 1,5 » devient 1.5", () => {
  assert.equal(normaliserNombre("1,5"), 1.5);
  assert.equal(normaliserNombre("1.5"), 1.5);
  assert.equal(normaliserNombre(" 12,25 "), 12.25);
  assert.equal(validerQuantite("1,5").valeur, 1.5);
});

test("2. zéro refusé", () => {
  const r = validerQuantite("0");
  assert.equal(r.ok, false);
  assert.match(r.erreur, /supérieure à zéro/);
  assert.equal(validerQuantite(0).ok, false);
  assert.equal(validerQuantite("0,0").ok, false);
});

test("3. négatif refusé", () => {
  assert.equal(validerQuantite("-1").ok, false);
  assert.equal(validerQuantite(-0.5).ok, false);
  assert.equal(validerQuantite("-2,5").ok, false);
});

test("4. vide et non numérique refusés, jamais de NaN ni d'Infinity", () => {
  for (const v of ["", "   ", "abc", "1,2,3", ".", "-", null, undefined, NaN, Infinity, -Infinity, true, {}, []]) {
    assert.equal(validerQuantite(v).ok, false, `${String(v)} doit être refusé`);
    const n = normaliserNombre(v);
    assert.ok(n === null || Number.isFinite(n), "jamais NaN ni Infinity en sortie");
  }
  assert.equal(validerQuantite(QUANTITE_MAX + 1).ok, false, "quantité aberrante refusée");
});

test("5. bibliothèque seule : valide", () => {
  const r = validerChoixMateriau({ materiau: MAT, designation: "", unite: "" });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "bibliotheque");
  assert.equal(r.materiau_id, "m1");
  assert.equal(r.unite, "U", "l'unité vient de la bibliothèque");
  assert.ok(!("designation_libre" in r), "aucune désignation libre envoyée");
});

test("6. texte libre avec unité : valide", () => {
  const r = validerChoixMateriau({ materiau: null, designation: "  Colle spéciale  ", unite: " sac " });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "libre");
  assert.equal(r.designation_libre, "Colle spéciale", "trimé");
  assert.equal(r.unite, "sac");
  assert.ok(!("materiau_id" in r));
});

test("7. bibliothèque ET texte libre simultanés : refusés", () => {
  const r = validerChoixMateriau({ materiau: MAT, designation: "Autre chose", unite: "U" });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /soit.*soit/i);
});

test("8. aucun des deux : refusé", () => {
  assert.equal(validerChoixMateriau({}).ok, false);
  assert.equal(validerChoixMateriau({ materiau: null, designation: "   ", unite: "U" }).ok, false);
  assert.match(validerChoixMateriau({}).erreur, /Choisis un matériau/);
});

test("9. saisie libre sans unité : refusée", () => {
  const r = validerChoixMateriau({ materiau: null, designation: "Colle", unite: "  " });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /unité/);
});

test("10. regroupement par ouvrage", () => {
  const g = grouperParOuvrage(SUGGESTIONS);
  assert.deepEqual(Object.keys(g).sort(), ["o1", "o2"]);
  assert.equal(g.o1.length, 2);
  assert.equal(g.o2.length, 1);
  assert.deepEqual(g.o1.map(s => s.id), ["s1", "s2"], "ordre reçu conservé");
  assert.deepEqual(grouperParOuvrage([]), {});
  assert.deepEqual(grouperParOuvrage(null), {});
  assert.deepEqual(grouperParOuvrage([null, { id: "x" }]), {}, "sans ouvrage_id : ignoré");
});

test("11. doublon de matériau détecté", () => {
  const g = grouperParOuvrage(SUGGESTIONS);
  assert.equal(doublonLocal(g.o1, { materiau: MAT }), true);
  assert.equal(doublonLocal(g.o2, { materiau: MAT }), false, "autre ouvrage : pas un doublon");
  assert.equal(doublonLocal(g.o1, { materiau: { id: "m9", nom: "Autre vis" } }), false);
});

test("12. doublon de texte libre, casse et espaces ignorés", () => {
  const g = grouperParOuvrage(SUGGESTIONS);
  assert.equal(doublonLocal(g.o1, { designation: "COLLE SPÉCIALE" }), true);
  assert.equal(doublonLocal(g.o1, { designation: "  colle spéciale  " }), true);
  assert.equal(doublonLocal(g.o1, { designation: "Colle spéciale renforcée" }), false,
    "aucune ressemblance approximative : deux textes proches restent deux demandes");
  // Une suggestion déjà traitée ne bloque plus.
  assert.equal(doublonLocal([{ designation: "Colle spéciale", statut: "refusee" }], { designation: "Colle spéciale" }), false);
  assert.equal(doublonLocal([], { designation: "x" }), false);
});

test("13. aucun champ financier dans les données de rendu", () => {
  assert.deepEqual(clesFinancieres(SUGGESTIONS), [], "les suggestions rendues sont propres");
  assert.deepEqual(clesFinancieres(validerChoixMateriau({ materiau: MAT })), []);
  // Le module lui-même n'introduit aucun libellé financier.
  const source = readFileSync(new URL("../src/Renovation/suggestionsMateriaux.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter(l => !l.trim().startsWith("//")).join("\n").toLowerCase();
  for (const mot of ["€", "prix", "coût", "cout_", "marge", "tarif", "montant"]) {
    assert.ok(!code.includes(mot), `le mot « ${mot} » ne doit pas apparaître dans le code du module`);
  }
});

test("bonus — garde anti-réponse obsolète", () => {
  assert.equal(reponseObsolete(3, 3), false, "réponse de la recherche courante : acceptée");
  assert.equal(reponseObsolete(2, 3), true, "réponse d'une frappe précédente : ignorée");
  assert.equal(PRECISION_MAX, 500, "même borne que la contrainte SQL");
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
console.log(`\nverif-suggestions-materiaux : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
