#!/usr/bin/env node
// Vérifie les règles d'édition des matériaux d'un ouvrage de phasage
// (src/Renovation/materiauxLiens.mjs). Fonctions pures : aucun réseau,
// aucune base, aucune écriture.
//   node scripts/verif-materiaux-liens.mjs
import assert from "node:assert/strict";

const {
  normaliserQuantite, ajouterLien, modifierQuantiteLien, retirerLien,
  quantiteTotale, lienExiste, memeMateriau, liensUtilisables,
} = await import(new URL("../src/Renovation/materiauxLiens.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Jeu d'essai : un lien ordinaire, un lien déjà commandé portant un champ
// inconnu, un lien dont le matériau n'existe plus en bibliothèque.
const LIENS = [
  { materiau_id: "m1", quantite: 2 },
  { materiau_id: "m2", quantite: 1.05, commande_le: "2026-09-10", note_interne: "à confirmer" },
  { materiau_id: "m-disparu", quantite: 3 },
];

test("1. saisie « 1,5 » → 1.5", () => {
  assert.equal(normaliserQuantite("1,5"), 1.5);
  assert.equal(normaliserQuantite("1.5"), 1.5);
  assert.equal(normaliserQuantite(1.5), 1.5);
  assert.equal(normaliserQuantite("0,25"), 0.25);
  assert.equal(normaliserQuantite(" 2,75 "), 2.75, "les espaces autour ne gênent pas");
});

test("2. valeur négative refusée", () => {
  assert.equal(normaliserQuantite("-1"), null);
  assert.equal(normaliserQuantite(-0.5), null);
  assert.equal(normaliserQuantite("-2,5"), null);
  assert.equal(normaliserQuantite(0), 0, "zéro n'est pas négatif : accepté");
});

test("3. valeur vide ou non numérique refusée, jamais de NaN", () => {
  for (const v of ["", "   ", "abc", "1,2,3", "1 2", ".", "-", null, undefined, NaN, Infinity, -Infinity, true, {}, []]) {
    const r = normaliserQuantite(v);
    assert.equal(r, null, `${JSON.stringify(String(v))} doit être refusé`);
  }
  // Garde-fou explicite : aucune sortie ne peut être NaN.
  const sorties = ["1,5", "abc", "", -3, 7].map(normaliserQuantite);
  assert.ok(sorties.every(v => v === null || Number.isFinite(v)), "aucune sortie NaN");
});

test("4. ajout sans doublon", () => {
  const next = ajouterLien(LIENS, "m3", "1,25");
  assert.equal(next.length, 4);
  assert.deepEqual(next[3], { materiau_id: "m3", quantite: 1.25 });
  assert.ok(!("commande_le" in next[3]), "une ligne neuve ne porte pas commande_le");
  assert.equal(LIENS.length, 3, "le tableau d'origine n'est pas muté");
  assert.deepEqual(ajouterLien([], "m1", 1), [{ materiau_id: "m1", quantite: 1 }]);
  assert.deepEqual(ajouterLien(undefined, "m1", 1), [{ materiau_id: "m1", quantite: 1 }]);
});

test("5. tentative de doublon refusée", () => {
  assert.equal(ajouterLien(LIENS, "m1", 5), null, "materiau_id déjà lié");
  assert.equal(ajouterLien(LIENS, "m2", 5), null);
  assert.equal(ajouterLien(LIENS, "m3", "abc"), null, "quantité inexploitable");
  assert.equal(ajouterLien(LIENS, "m3", -1), null, "quantité négative");
  assert.equal(ajouterLien(LIENS, "", 1), null, "identifiant vide");
  assert.equal(ajouterLien(LIENS, null, 1), null);
  assert.ok(lienExiste(LIENS, "m1") && !lienExiste(LIENS, "zzz"));
});

test("6. modification conservant commande_le et les champs inconnus", () => {
  const next = modifierQuantiteLien(LIENS, "m2", "3,5");
  const l = next.find(x => x.materiau_id === "m2");
  assert.equal(l.quantite, 3.5);
  assert.equal(l.commande_le, "2026-09-10", "commande_le conservé");
  assert.equal(l.note_interne, "à confirmer", "champ inconnu conservé");
  assert.equal(next.length, 3, "aucun autre lien touché");
  assert.deepEqual(next.find(x => x.materiau_id === "m1"), LIENS[0]);
  assert.equal(modifierQuantiteLien(LIENS, "m2", "abc"), null, "quantité invalide → refus");
  assert.equal(modifierQuantiteLien(LIENS, "inconnu", 1), null, "lien absent → refus");
  assert.equal(LIENS[1].quantite, 1.05, "le tableau d'origine n'est pas muté");
});

test("7. suppression d'un seul lien", () => {
  const next = retirerLien(LIENS, "m2");
  assert.deepEqual(next.map(l => l.materiau_id), ["m1", "m-disparu"]);
  assert.deepEqual(next[0], LIENS[0], "les liens restants sont intacts");
  assert.equal(LIENS.length, 3, "le tableau d'origine n'est pas muté");
  assert.deepEqual(retirerLien(LIENS, "zzz").map(l => l.materiau_id),
    ["m1", "m2", "m-disparu"], "retirer un lien absent ne retire rien");
});

test("8. quantité totale correcte", () => {
  // Le produit reste BRUT : 24 × 1,05 vaut 25.200000000000003 en flottant, et
  // c'est l'affichage qui arrondit (toFixed(2)), exactement comme avant
  // l'éditeur. Arrondir dans le module ferait perdre les petites quantités.
  const proche = (a, b, msg) =>
    assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} attendu ~${b}, reçu ${a}`);
  proche(quantiteTotale(24, 1.05), 25.2);
  proche(quantiteTotale("24", "1,05"), 25.2, "accepte le texte et la virgule :");
  assert.equal(quantiteTotale(10, 0), 0);
  assert.equal(quantiteTotale(2.5, 4), 10);
  proche(quantiteTotale(0.5, 0.3), 0.15, "petites quantités :");
});

test("9. quantité d'ouvrage absente ou nulle → résultat non affichable", () => {
  assert.equal(quantiteTotale(null, 2), null);
  assert.equal(quantiteTotale(undefined, 2), null);
  assert.equal(quantiteTotale("", 2), null);
  assert.equal(quantiteTotale(0, 2), null, "zéro ouvrage : « — », pas « 0 »");
  assert.equal(quantiteTotale("abc", 2), null);
  assert.equal(quantiteTotale(-5, 2), null);
  assert.equal(quantiteTotale(24, "abc"), null, "quantité par unité inexploitable");
});

test("10. matériau introuvable conservé", () => {
  // Il n'existe plus en bibliothèque, mais reste une donnée du chantier.
  const liste = liensUtilisables(LIENS);
  assert.ok(liste.some(l => l.materiau_id === "m-disparu"),
    "un lien dont le matériau a disparu n'est jamais retiré en silence");
  // Il survit à toute opération portant sur un autre lien.
  assert.ok(retirerLien(LIENS, "m1").some(l => l.materiau_id === "m-disparu"));
  assert.ok(modifierQuantiteLien(LIENS, "m1", 9).some(l => l.materiau_id === "m-disparu"));
  assert.ok(ajouterLien(LIENS, "m9", 1).some(l => l.materiau_id === "m-disparu"));
  // Sa quantité est intacte, et il reste supprimable explicitement.
  assert.equal(LIENS.find(l => l.materiau_id === "m-disparu").quantite, 3);
  assert.ok(!retirerLien(LIENS, "m-disparu").some(l => l.materiau_id === "m-disparu"));
  // liensUtilisables n'écarte que les entrées vraiment inutilisables.
  assert.deepEqual(
    liensUtilisables([null, { quantite: 1 }, { materiau_id: "ok", quantite: 1 }]),
    [{ materiau_id: "ok", quantite: 1 }]);
});

test("bonus — comparaison d'identifiants tolérante au type", () => {
  assert.ok(memeMateriau("7", 7));
  assert.ok(!memeMateriau(null, null), "deux absences ne sont pas une égalité");
  assert.ok(lienExiste([{ materiau_id: 7, quantite: 1 }], "7"));
});

test("bonus — le module ne copie aucune donnée de bibliothèque", () => {
  // Garde-fou : un lien ne doit porter qu'un identifiant et une quantité.
  const cree = ajouterLien([], "m1", 2)[0];
  assert.deepEqual(Object.keys(cree).sort(), ["materiau_id", "quantite"]);
  const modifie = modifierQuantiteLien([{ materiau_id: "m1", quantite: 1 }], "m1", 2)[0];
  assert.deepEqual(Object.keys(modifie).sort(), ["materiau_id", "quantite"],
    "aucun nom, prix, unité, référence ni fournisseur recopié");
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
console.log(`\nverif-materiaux-liens : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
