#!/usr/bin/env node
// Vérifie le registre d'écriture versionnée partagé par Planning commandes,
// Validation et les helpers planning (src/Renovation/phasageEcriture.mjs).
// Fonctions pures : aucun réseau. Contrôle aussi, par lecture des sources,
// qu'aucune réécriture inconditionnelle de ouvrages / plan_travaux ne subsiste.
//   node scripts/verif-phasage-ecriture.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const {
  creerRegistre, noterRevision, noterRevisions, revisionDe,
  debuterEcriture, terminerEcriture, echecEcriture, conflitEcriture,
  ecritureEnCours,
} = await import(new URL("../src/Renovation/phasageRegistre.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const lire = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");

test("1. la révision est chargée avec chaque phasage", () => {
  let reg = creerRegistre();
  reg = noterRevisions(reg, [{ id: "p1", revision: 4 }, { id: "p2", revision: 9 }]);
  assert.equal(revisionDe(reg, "p1"), 4);
  assert.equal(revisionDe(reg, "p2"), 9);
  assert.equal(revisionDe(reg, "inconnu"), null, "phasage jamais chargé");
  // Une révision 0 est une vraie valeur, pas une absence.
  assert.equal(revisionDe(noterRevision(creerRegistre(), "p3", 0), "p3"), 0);
});

test("2. plusieurs phasages gardent chacun leur révision", () => {
  let reg = noterRevisions(creerRegistre(), [{ id: "p1", revision: 1 }, { id: "p2", revision: 7 }]);
  const a = debuterEcriture(reg, "p1"); reg = a.reg;
  reg = terminerEcriture(reg, "p1", a.jeton, 2);
  assert.equal(revisionDe(reg, "p1"), 2, "p1 avance");
  assert.equal(revisionDe(reg, "p2"), 7, "p2 n'a pas bougé");
});

test("3. la nouvelle révision est conservée après un succès", () => {
  let reg = noterRevision(creerRegistre(), "p1", 3);
  const d = debuterEcriture(reg, "p1"); reg = d.reg;
  assert.equal(revisionDe(reg, "p1"), 3, "inchangée tant que la réponse n'est pas là");
  reg = terminerEcriture(reg, "p1", d.jeton, 4);
  assert.equal(revisionDe(reg, "p1"), 4);
  assert.equal(ecritureEnCours(reg, "p1"), false);
});

test("4. double clic bloqué pendant l'écriture", () => {
  let reg = noterRevision(creerRegistre(), "p1", 1);
  const un = debuterEcriture(reg, "p1"); reg = un.reg;
  assert.equal(un.ok, true);
  const deux = debuterEcriture(reg, "p1");
  assert.equal(deux.ok, false, "le second clic ne part pas");
  assert.equal(deux.jeton, null);
  assert.equal(ecritureEnCours(reg, "p1"), true);
  // Un autre phasage reste libre : le verrou est par ligne.
  reg = noterRevision(reg, "p2", 1);
  assert.equal(debuterEcriture(reg, "p2").ok, true);
});

test("5. aucune écriture sans révision connue", () => {
  const reg = creerRegistre();
  assert.equal(debuterEcriture(reg, "jamais-charge").ok, false);
  assert.equal(debuterEcriture(reg, "").ok, false);
  assert.equal(debuterEcriture(reg, null).ok, false);
});

test("6. conflit : pas de nouvelle tentative automatique", () => {
  let reg = noterRevision(creerRegistre(), "p1", 3);
  const d = debuterEcriture(reg, "p1"); reg = d.reg;
  reg = conflitEcriture(reg, "p1", d.jeton);
  assert.equal(ecritureEnCours(reg, "p1"), false, "le verrou est rendu");
  assert.equal(revisionDe(reg, "p1"), null,
    "la révision est invalidée : impossible de rejouer la même écriture avec la version fraîche");
  assert.equal(debuterEcriture(reg, "p1").ok, false, "aucune écriture ne repart tant qu'on n'a pas rechargé");
});

test("7. rechargement de la version récente : l'écriture redevient possible", () => {
  let reg = noterRevision(creerRegistre(), "p1", 3);
  const d = debuterEcriture(reg, "p1"); reg = conflitEcriture(d.reg, "p1", d.jeton);
  reg = noterRevision(reg, "p1", 8);          // ce que fait le rechargement
  assert.equal(revisionDe(reg, "p1"), 8);
  assert.equal(debuterEcriture(reg, "p1").ok, true);
});

test("8. erreur réseau : réessayable, et ce n'est pas un conflit", () => {
  let reg = noterRevision(creerRegistre(), "p1", 3);
  const d = debuterEcriture(reg, "p1"); reg = d.reg;
  reg = echecEcriture(reg, "p1", d.jeton);
  assert.equal(ecritureEnCours(reg, "p1"), false);
  assert.equal(revisionDe(reg, "p1"), 3, "la révision est conservée : rien n'a changé en base");
  assert.equal(debuterEcriture(reg, "p1").ok, true, "on peut réessayer");
});

test("9. une réponse obsolète ne remplace pas une révision plus récente", () => {
  let reg = noterRevision(creerRegistre(), "p1", 1);
  const un = debuterEcriture(reg, "p1"); reg = terminerEcriture(un.reg, "p1", un.jeton, 2);
  const deux = debuterEcriture(reg, "p1"); reg = deux.reg;
  assert.equal(revisionDe(reg, "p1"), 2, "la première écriture a bien avancé la révision");
  // La réponse de la PREMIÈRE écriture arrive en retard, avec une révision
  // fantaisiste : elle ne doit rien changer.
  const tardif = terminerEcriture(reg, "p1", un.jeton, 99);
  assert.equal(revisionDe(tardif, "p1"), 2, "la révision n'est pas écrasée par une réponse périmée");
  assert.equal(ecritureEnCours(tardif, "p1"), true, "l'écriture en cours n'est pas annulée");
  // Idem pour un conflit et un échec périmés.
  assert.equal(revisionDe(conflitEcriture(reg, "p1", un.jeton), "p1"), 2,
    "un conflit périmé n'invalide pas la révision courante");
  assert.equal(ecritureEnCours(echecEcriture(reg, "p1", un.jeton), "p1"), true);
});

test("10. aucune réécriture inconditionnelle de ouvrages / plan_travaux", () => {
  // Contrôle sur les SOURCES : toute mise à jour cliente de ces deux colonnes
  // doit passer par les RPC versionnées.
  const fichiers = [
    "src/Renovation/PagePlanningCommandes.jsx",
    "src/Renovation/Validation.jsx",
    "src/Renovation/phasagePlanning.js",
    "src/Renovation/PhasageV2.jsx",
  ];
  for (const f of fichiers) {
    const src = lire(f);
    assert.ok(!/from\(\s*["']phasages["']\s*\)\s*\.\s*update/.test(src),
      `${f} : il reste un .update() direct sur phasages`);
    assert.ok(!/from\(\s*["']phasages["']\s*\)\s*\.\s*upsert/.test(src),
      `${f} : un upsert pourrait remplacer une ligne existante`);
  }
  // Et les écrans concernés appellent bien le service versionné.
  for (const f of fichiers.slice(0, 3)) {
    assert.ok(/phasageEcriture/.test(lire(f)), `${f} doit utiliser le service versionné`);
  }
  assert.ok(/conducteur_sauvegarder_phasage_v2/.test(lire("src/Renovation/PhasageV2.jsx")),
    "PhasageV2 garde sa propre file versionnée");
});

test("11. balayage de TOUT src : aucun update client de ouvrages / plan_travaux", () => {
  // Le contrôle 10 ne regarde que quatre fichiers connus : c'est ainsi que
  // deux écritures de plan_travaux dans PageChantiers ont pu passer. Ici on
  // balaie l'arborescence entière, y compris les fichiers ajoutés plus tard.
  const racine = new URL("../src/", import.meta.url);
  const fichiers = [];
  (function marcher(dir, prefixe) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) marcher(new URL(e.name + "/", dir), prefixe + e.name + "/");
      else if (/\.(js|jsx|mjs)$/.test(e.name)) fichiers.push([prefixe + e.name, new URL(e.name, dir)]);
    }
  })(racine, "src/");
  assert.ok(fichiers.length > 20, "le balayage doit trouver les sources");

  // Un .update({ ... }) qui pose l'une des deux colonnes protégées — mais
  // seulement sur la table `phasages` : d'autres tables ont une colonne
  // `ouvrages` (profero_categories_ouvrages, la bibliothèque de chiffrage),
  // et elles ne sont pas concernées.
  const TABLE = /from\(\s*["'`]phasages["'`]\s*\)/g;
  const INTERDIT = /^[\s\S]{0,400}?\.\s*(update|upsert)\s*\(\s*\{[^}]*\b(ouvrages|plan_travaux)\s*:/;
  const fautifs = [];
  for (const [nom, url] of fichiers) {
    const src = readFileSync(url, "utf8");
    TABLE.lastIndex = 0;
    let m;
    while ((m = TABLE.exec(src))) {
      // On ne regarde que ce qui suit immédiatement l'accès à la table :
      // au-delà, on est déjà dans une autre requête.
      if (INTERDIT.test(src.slice(m.index + m[0].length))) { fautifs.push(nom); break; }
    }
  }
  assert.deepEqual(fautifs, [],
    `ces fichiers réécrivent ouvrages/plan_travaux sans passer par une RPC versionnée : ${fautifs.join(", ")}`);
});

test("bonus — la fiche chantier écrit ses meta avec la révision relue", () => {
  const src = lire("src/Renovation/PageChantiers.jsx");
  assert.ok(/select\("revision, plan_travaux"\)/.test(src),
    "la révision est lue dans le MÊME select que le contenu");
  assert.ok(/sauvegarderPhasage\(/.test(src), "l'écriture passe par la RPC versionnée");
  assert.ok(!/fetchErr\.message|error\.message/.test(src.split("ecrireMetaPhasage")[1] || ""),
    "aucun détail technique n'est affiché à l'utilisateur");
});

test("bonus — le lot transmet bien une révision par phasage", () => {
  // Forme attendue par conducteur_sauvegarder_phasages_lot : chaque entrée
  // porte SA révision, sinon le tout-ou-rien n'a aucun sens.
  const src = lire("src/Renovation/PagePlanningCommandes.jsx");
  assert.ok(/revision_attendue:\s*frais\.revision/.test(src),
    "chaque entrée du lot porte la révision relue pour CE phasage");
  assert.ok(/sauvegarderPhasagesLot\(lot\)/.test(src), "une seule écriture pour toute l'action");
  assert.ok(/select\("revision, ouvrages"\)/.test(src), "la révision est lue avec le contenu");
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
console.log(`\nverif-phasage-ecriture : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
