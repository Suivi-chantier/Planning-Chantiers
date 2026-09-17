#!/usr/bin/env node
// Vérifie les règles d'affichage de la préparation ouvrière
// (src/Renovation/preparationChantier.mjs). Fonctions pures : aucun réseau,
// aucune base, aucune écriture.
//   node scripts/verif-preparation-chantier.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  phasesVisibles, phaseParDefaut, compterTaches, etatOuvrage, etatTache,
  avancementAffichable, formaterQuantite, ecranModele, clesFinancieres,
  ETAT_OUVRAGE, ETAT_TACHE, PHASE_A_ORGANISER,
} = await import(new URL("../src/Renovation/preparationChantier.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const tache = (id, av) => ({ id, nom: `T${id}`, ordre: 1, avancement: av });
const ouvrage = (id, taches, materiaux = []) => ({
  id, code_ouvrage: null, libelle: `O${id}`, quantite: 10, unite: "m²",
  taches, materiaux, materiaux_portee: "ouvrage_complet",
});
const phase = (id, nom, ordre, ouvrages, synthetique = false) =>
  ({ id, nom, ordre, couleur: "#111", synthetique, ouvrages });

// Payload de référence : une phase vide, une phase en cours, une phase
// terminée, et « À organiser » portant un ouvrage sans tâche.
const PAYLOAD = {
  chantier_id: "c1", chantier_nom: "Test", phasage_id: "p1", modele: "v2",
  phases: [
    phase("g1", "Vide", 10, []),
    phase("g2", "Terminee", 20, [ouvrage("o1", [tache("a", 100), tache("b", 100)])]),
    phase("g3", "En cours", 30, [ouvrage("o2", [tache("c", 100), tache("d", 40)])]),
    phase(PHASE_A_ORGANISER, "À organiser", 999999, [ouvrage("o3", [])], true),
  ],
  compteurs: { phases: 4, ouvrages_uniques: 3, taches: 4, taches_a_organiser: 0 },
};

test("1. phase vide masquée", () => {
  const v = phasesVisibles(PAYLOAD);
  assert.ok(!v.some(p => p.id === "g1"), "une phase sans ouvrage ne s'affiche pas");
  assert.equal(v.length, 3);
  assert.equal(PAYLOAD.phases.length, 4, "le payload d'origine n'est pas modifié");
  assert.deepEqual(phasesVisibles({ phases: [] }), []);
  assert.deepEqual(phasesVisibles(null), []);
});

test("2. « À organiser » conservée quand elle contient un ouvrage", () => {
  const v = phasesVisibles(PAYLOAD);
  const ao = v.find(p => p.id === PHASE_A_ORGANISER);
  assert.ok(ao, "À organiser reste visible");
  assert.equal(ao.synthetique, true);
  assert.equal(v[v.length - 1].id, PHASE_A_ORGANISER, "et reste en dernier");
  // Vide, elle disparaît comme n'importe quelle phase.
  const sansContenu = { phases: [phase(PHASE_A_ORGANISER, "À organiser", 999999, [], true)] };
  assert.deepEqual(phasesVisibles(sansContenu), []);
});

test("3. première phase incomplète ouverte par défaut", () => {
  // g2 est visible mais entièrement terminée : on doit ouvrir g3.
  assert.equal(phaseParDefaut(PAYLOAD), "g3");
});

test("4. toutes les tâches terminées → première phase visible", () => {
  const p = { phases: [
    phase("g1", "Vide", 10, []),
    phase("g2", "Finie", 20, [ouvrage("o1", [tache("a", 100)])]),
    phase("g3", "Finie aussi", 30, [ouvrage("o2", [tache("b", 100)])]),
  ] };
  assert.equal(phaseParDefaut(p), "g2", "pas de phase en retard : on ouvre la première visible");
  // Un ouvrage SANS tâche compte comme non terminé : il reste à organiser.
  const q = { phases: [phase("g1", "X", 10, [ouvrage("o1", [])])] };
  assert.equal(phaseParDefaut(q), "g1");
  assert.equal(phaseParDefaut({ phases: [] }), null, "aucune phase visible → null");
  assert.equal(phaseParDefaut(null), null);
});

test("5. état ouvrage À faire", () => {
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 0), tache("b", null)])).cle, "a_faire");
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", undefined)])).cle, "a_faire");
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", "pas un nombre")])).cle, "a_faire");
});

test("6. état ouvrage En cours", () => {
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 1)])).cle, "en_cours");
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 99)])).cle, "en_cours");
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 0), tache("b", 40)])).cle, "en_cours");
  // Mélange 0 / 100 sans tâche en cours : le travail a commencé.
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 0), tache("b", 100)])).cle, "en_cours");
});

test("7. état ouvrage Terminé", () => {
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 100), tache("b", 100)])).cle, "termine");
  assert.equal(etatOuvrage(ouvrage("o", [tache("a", 150)])).cle, "termine", "au-delà de 100 reste terminé");
});

test("8. ouvrage sans tâche → À organiser", () => {
  assert.equal(etatOuvrage(ouvrage("o", [])).cle, "a_organiser");
  assert.equal(etatOuvrage({ id: "o" }).cle, "a_organiser", "taches absent");
  assert.equal(etatOuvrage(null).cle, "a_organiser");
  assert.equal(ETAT_OUVRAGE.a_organiser.label, "À organiser");
});

test("9. quantité totale null et formatage sans NaN ni Infinity", () => {
  assert.equal(formaterQuantite(null), null, "null → l'écran dira « à définir »");
  assert.equal(formaterQuantite(undefined), null);
  assert.equal(formaterQuantite(NaN), null);
  assert.equal(formaterQuantite(Infinity), null);
  assert.equal(formaterQuantite(-Infinity), null);
  assert.equal(formaterQuantite("abc"), null);
  assert.equal(formaterQuantite(true), null);
  assert.equal(formaterQuantite(25.2), "25,2");
  assert.equal(formaterQuantite(25.200000000000003), "25,2", "le flottant est arrondi à l'affichage");
  assert.equal(formaterQuantite(12), "12");
  assert.equal(formaterQuantite("1,05"), "1,05");
  assert.equal(formaterQuantite(0), "0");
  // Garde-fou : aucune sortie ne contient jamais NaN ou Infinity.
  for (const v of [NaN, Infinity, -Infinity, "x", {}, []]) {
    const r = formaterQuantite(v);
    assert.ok(r === null || !/NaN|Infinity/.test(r), `sortie suspecte pour ${String(v)}`);
  }
});

test("10. ouvrage multi-phase : matériaux répétés, jamais additionnés", () => {
  const mats = [{ materiau_id: "m1", nom: "Vis", quantite_par_unite: 0.5, quantite_totale: 5,
                  commande_le: null, introuvable: false, reference: "R1", unite: "U", fournisseur: "F" }];
  const o = ouvrage("o1", [tache("a", 50)], mats);
  const p = { phases: [phase("g1", "P1", 10, [o]), phase("g2", "P2", 20, [{ ...o, taches: [tache("b", 0)] }])] };
  const visibles = phasesVisibles(p);
  assert.equal(visibles.length, 2, "l'ouvrage apparaît dans les deux phases");
  // Le module n'expose AUCUNE fonction de somme de matériaux : rien ne peut
  // additionner deux fois la même quantité.
  const source = readFileSync(new URL("../src/Renovation/preparationChantier.mjs", import.meta.url), "utf8");
  assert.ok(!/quantite_totale\s*[+]|sommeMateriaux|totalMateriaux|reduce\([^)]*quantite/i.test(source),
    "aucune agrégation de quantités de matériaux dans le module");
  // Et la portée est bien portée par la donnée, pas recalculée.
  assert.equal(o.materiaux_portee, "ouvrage_complet");
});

test("11. les cinq valeurs de modele ont chacune leur écran", () => {
  assert.equal(ecranModele({ modele: "v2" }), null, "v2 : on affiche la préparation");
  for (const [m, titre] of [
    ["legacy_v1", "Préparation indisponible"],
    ["vide",      "Préparation non renseignée"],
    ["absent",    "Aucun phasage trouvé"],
    ["ambigu",    "Chantier à vérifier"],
  ]) {
    const e = ecranModele({ modele: m });
    assert.ok(e && e.titre === titre, `${m} → « ${titre} »`);
    assert.ok(e.texte && e.texte.length > 20, `${m} doit expliquer quoi faire`);
  }
  assert.equal(ecranModele({ modele: "ambigu" }).ton, "alerte");
  // Un modèle inconnu ou absent ne doit jamais passer en silence.
  assert.ok(ecranModele({ modele: "zzz" }), "modèle inconnu → écran d'anomalie");
  assert.ok(ecranModele({}), "modèle absent → écran d'anomalie");
  assert.ok(ecranModele(null), "payload nul → écran d'anomalie");
});

test("12. aucune clé ni libellé financier dans ce qui part au rendu", () => {
  assert.deepEqual(clesFinancieres(PAYLOAD), [], "le payload de référence est propre");
  // Le détecteur fonctionne : on lui donne volontairement de quoi trouver.
  const sale = { phases: [{ ouvrages: [{ prix_ht: 10, materiaux: [{ prix_unitaire: 2 }] }] }] };
  const trouvees = clesFinancieres(sale);
  assert.ok(trouvees.includes("prix_ht") && trouvees.includes("prix_unitaire"), "les clés sales sont vues");
  // Le module lui-même n'affiche aucun libellé financier. On exclut du scan
  // les commentaires ET la ligne qui DÉFINIT le détecteur : elle contient
  // forcément les mots qu'elle traque, c'est son objet.
  const source = readFileSync(new URL("../src/Renovation/preparationChantier.mjs", import.meta.url), "utf8");
  const code = source.split("\n")
    .filter(l => !l.trim().startsWith("//") && !l.includes("MOTIF_FINANCIER ="))
    .join("\n").toLowerCase();
  for (const mot of ["€", "prix", "coût", "cout", "marge", "tarif", "heures vendues", "montant"]) {
    assert.ok(!code.includes(mot.toLowerCase()),
      `le mot « ${mot} » ne doit pas apparaître dans le code du module`);
  }
});

test("bonus — comptage des tâches d'une phase", () => {
  const p = phase("g", "P", 10, [
    ouvrage("o1", [tache("a", 100), tache("b", 50)]),
    ouvrage("o2", [tache("c", 100)]),
    ouvrage("o3", []),
  ]);
  assert.deepEqual(compterTaches(p), { total: 3, terminees: 2 });
  assert.deepEqual(compterTaches({ ouvrages: [] }), { total: 0, terminees: 0 });
  assert.deepEqual(compterTaches(null), { total: 0, terminees: 0 });
});

test("bonus — état et avancement affichable d'une tâche", () => {
  assert.equal(etatTache(tache("a", null)).label, "À faire");
  assert.equal(etatTache(tache("a", 0)).label, "À faire");
  assert.equal(etatTache(tache("a", 45)).label, "En cours");
  assert.equal(etatTache(tache("a", 100)).label, "Terminée");
  assert.equal(ETAT_TACHE.terminee.label, "Terminée");
  // Le chiffre ne s'affiche qu'entre 1 et 99.
  assert.equal(avancementAffichable(tache("a", 0)), null);
  assert.equal(avancementAffichable(tache("a", 100)), null);
  assert.equal(avancementAffichable(tache("a", null)), null);
  assert.equal(avancementAffichable(tache("a", 45)), 45);
  assert.equal(avancementAffichable(tache("a", 45.6)), 46, "arrondi à l'entier");
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
console.log(`\nverif-preparation-chantier : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
