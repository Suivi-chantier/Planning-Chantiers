#!/usr/bin/env node
// Vérifie les règles pures du traitement conducteur des suggestions
// (src/Renovation/suggestionsConducteur.mjs). Aucun réseau, aucune base.
//   node scripts/verif-suggestions-conducteur.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  quantiteOuvrageUtilisable, quantiteParUnite, preremplissageParUnite,
  totalDepuisParUnite, validerQuantitePositive, lienExistant,
  resultatAcceptation, filtreValide, estTraitable,
  LIBELLES_STATUT, FILTRES, ACTIONS_EXISTANT, QUANTITE_MAX,
} = await import(new URL("../src/Renovation/suggestionsConducteur.mjs", import.meta.url).href);
const { reponseObsolete } =
  await import(new URL("../src/Renovation/suggestionsMateriaux.mjs", import.meta.url).href);
const { clesFinancieres } =
  await import(new URL("../src/Renovation/preparationChantier.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} attendu ~${b}, reçu ${a}`);

const OUVRAGE = {
  id: "o1", code: "MU-001", libelle: "Cloison", quantite: 10, unite: "m²",
  materiaux_liens: [{ materiau_id: "m1", quantite: 0.5 }, { materiau_id: "m2", quantite: 2 }],
};
const SUGGESTION = {
  id: "s1", statut: "en_attente", cree_le: "2026-09-17T08:00:00Z",
  chantier_id: "c1", chantier_nom: "FOURMOND 001", phasage_id: "p1",
  ouvrage: OUVRAGE, auteur: { id: "u1", nom: "JP" },
  materiau: { id: "m9", nom: "Vis", reference: "R", unite: "U", fournisseur: "F" },
  designation_libre: null, unite: "U", quantite_totale: 24, precision: "au 1er",
  traitement: null,
};

test("1. conversion total → quantité par unité", () => {
  proche(quantiteParUnite(24, 10), 2.4);
  proche(quantiteParUnite("24", "10"), 2.4, "accepte le texte :");
  proche(quantiteParUnite("6,5", "2"), 3.25, "accepte la virgule :");
  assert.equal(preremplissageParUnite(24, 10), 2.4);
  // Division non exacte : le préremplissage arrondit, mais le total obtenu
  // est recalculé pour que l'écart reste visible.
  const p = preremplissageParUnite(5, 3);
  assert.equal(p, 1.6667, "arrondi à 4 décimales");
  proche(totalDepuisParUnite(p, 3), 5.0001, "l'écart n'est pas masqué :");
});

test("2. quantité d'ouvrage invalide → aucune division", () => {
  for (const q of [null, undefined, 0, "0", -5, "abc", "", NaN, Infinity, {}, true]) {
    assert.equal(quantiteOuvrageUtilisable(q), false, `${String(q)} inutilisable`);
    assert.equal(quantiteParUnite(24, q), null, `${String(q)} : pas de division`);
    assert.equal(preremplissageParUnite(24, q), null);
    assert.equal(totalDepuisParUnite(2, q), null);
  }
  assert.equal(quantiteOuvrageUtilisable(10), true);
  assert.equal(quantiteOuvrageUtilisable("0,5"), true);
});

test("3. validation des valeurs finies et positives", () => {
  assert.equal(validerQuantitePositive("2,5").valeur, 2.5);
  for (const v of ["", "  ", "abc", null, undefined, NaN, Infinity, -Infinity, 0, "0", -1, true, {}]) {
    assert.equal(validerQuantitePositive(v).ok, false, `${String(v)} refusé`);
  }
  assert.equal(validerQuantitePositive(QUANTITE_MAX + 1).ok, false, "au-delà de la borne SQL");
  // Aucune sortie ne peut être NaN.
  assert.ok(["1,5", "x", -2].map(validerQuantitePositive)
    .every(r => !r.ok || Number.isFinite(r.valeur)));
});

test("4. matériau absent de l'ouvrage", () => {
  assert.equal(lienExistant(OUVRAGE, "m9"), null, "m9 n'est pas lié");
  assert.equal(lienExistant(OUVRAGE, null), null);
  assert.equal(lienExistant({ materiaux_liens: [] }, "m1"), null);
  assert.equal(lienExistant({}, "m1"), null, "ouvrage sans liens");
  const r = resultatAcceptation({ existant: null, action: null, quantiteParUnite: 2.4 });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "nouveau");
  proche(r.finale, 2.4);
});

test("5. ajout à une quantité existante", () => {
  const ex = lienExistant(OUVRAGE, "m1");
  assert.equal(ex.quantite, 0.5, "quantité déjà prévue lue");
  const r = resultatAcceptation({ existant: ex, action: "ajouter", quantiteParUnite: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "ajouter");
  proche(r.finale, 2.5, "0,5 + 2 =");
  // Tolérant à la casse et aux espaces.
  proche(resultatAcceptation({ existant: ex, action: " AJOUTER ", quantiteParUnite: 2 }).finale, 2.5);
});

test("6. remplacement d'une quantité existante", () => {
  const ex = lienExistant(OUVRAGE, "m2");
  assert.equal(ex.quantite, 2);
  const r = resultatAcceptation({ existant: ex, action: "remplacer", quantiteParUnite: 7.5 });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "remplacer");
  proche(r.finale, 7.5, "la valeur saisie remplace l'ancienne :");
});

test("7. obligation de choisir une action sur un lien existant", () => {
  const ex = lienExistant(OUVRAGE, "m1");
  for (const a of [null, undefined, "", "   ", "nouveau", "autre chose"]) {
    const r = resultatAcceptation({ existant: ex, action: a, quantiteParUnite: 2 });
    assert.equal(r.ok, false, `action « ${String(a)} » doit être refusée`);
    assert.equal(r.actionRequise, true);
    assert.match(r.erreur, /Choisis/);
  }
  // Une quantité invalide est signalée AVANT l'action.
  assert.equal(resultatAcceptation({ existant: ex, action: "ajouter", quantiteParUnite: 0 }).ok, false);
});

test("8. libellés des statuts", () => {
  assert.equal(LIBELLES_STATUT.en_attente, "En attente");
  assert.equal(LIBELLES_STATUT.acceptee, "Acceptée");
  assert.equal(LIBELLES_STATUT.refusee, "Refusée");
  assert.equal(ACTIONS_EXISTANT.ajouter, "Ajouter la quantité suggérée à l'existant");
  assert.equal(ACTIONS_EXISTANT.remplacer, "Remplacer la quantité prévue");
  assert.equal(estTraitable(SUGGESTION), true);
  assert.equal(estTraitable({ statut: "acceptee" }), false);
  assert.equal(estTraitable({ statut: "refusee" }), false);
  assert.equal(estTraitable(null), false);
});

test("9. filtres", () => {
  assert.deepEqual(FILTRES.map(f => f.cle), ["en_attente", "acceptee", "refusee"]);
  assert.equal(filtreValide("acceptee"), "acceptee");
  assert.equal(filtreValide("refusee"), "refusee");
  for (const mauvais of ["zzz", "", null, undefined, "EN_ATTENTE"]) {
    assert.equal(filtreValide(mauvais), "en_attente", `${String(mauvais)} → repli`);
  }
});

test("10. protection contre les réponses obsolètes", () => {
  assert.equal(reponseObsolete(4, 4), false, "réponse courante acceptée");
  assert.equal(reponseObsolete(3, 4), true, "réponse d'une requête précédente ignorée");
});

test("11. aucune clé financière dans les données de rendu", () => {
  assert.deepEqual(clesFinancieres(SUGGESTION), [], "la suggestion rendue est propre");
  assert.deepEqual(clesFinancieres(OUVRAGE), [], "l'ouvrage rendu est propre");
  assert.deepEqual(clesFinancieres(resultatAcceptation({ existant: null, quantiteParUnite: 2 })), []);
  // Le détecteur fonctionne bien.
  assert.ok(clesFinancieres({ o: { prix_unitaire: 1 } }).includes("prix_unitaire"));
  // Le module n'introduit aucun libellé financier.
  const source = readFileSync(new URL("../src/Renovation/suggestionsConducteur.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter(l => !l.trim().startsWith("//")).join("\n").toLowerCase();
  for (const mot of ["€", "prix", "coût", "cout_", "marge", "tarif", "montant", "coefficient"]) {
    assert.ok(!code.includes(mot), `le mot « ${mot} » ne doit pas apparaître dans le code du module`);
  }
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
console.log(`\nverif-suggestions-conducteur : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
