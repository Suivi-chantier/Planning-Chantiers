#!/usr/bin/env node
// Vérifie le module pur src/Renovation/organisationJour.mjs (projet
// docs/projets/organisation-par-jour.md, étape 1 — aucun écran modifié).
//
//   1. ancien format (liste d'identifiants) et null : ordre identique, cas par
//      cas, à une copie de l'algorithme historique de la barre latérale
//      (Navigation.jsx, Sidebar, fonction `nav`), sur des listes réalistes ;
//   2. nouveau format : objet sans `jours`, samedi / dimanche, page non
//      autorisée dans `devant` et `accueil`, page inconnue, doublons, blocs
//      hors catalogue, valeurs invalides tolérées ;
//   3. mode « Ordre habituel aujourd'hui » : actif le jour même, expiré le
//      lendemain, thème et rendez-vous toujours lisibles ;
//   4. écriture : `ordre` mis à jour sans effacer `jours` ; sans organisation,
//      contenu en base identique à aujourd'hui (liste simple ou null) ;
//   5. modèle « Conducteur de travaux » : toutes ses pages existent, tous ses
//      blocs sont au catalogue ;
//   6. aucune page ne disparaît ; module pur (ni Supabase, ni horloge) ;
//   7. navigation (étape 2) : barre du bas inchangée sans organisation active,
//      même ordre que la barre latérale sinon ; Navigation.jsx branché sur le
//      module ; date du jour unique (dateDuJour.js, ?date_simulee=).
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-organisation-jour.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as O from "../src/Renovation/organisationJour.mjs";
import { estPageDuMenu } from "../src/Renovation/navigationOperations.mjs";

const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Pages réelles, lues dans les sources (sans importer access.js / React) ──
const navSrc = lire("src/Renovation/Navigation.jsx");
const blocAllNav = navSrc.slice(navSrc.indexOf("const allNav = ["), navSrc.indexOf("const LABELS_PAGES"));
const ALL_NAV = [...blocAllNav.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]);
const accSrc = lire("src/access.js");
const blocPages = accSrc.slice(accSrc.indexOf("export const PAGES_RENOVATION"), accSrc.indexOf("export const PAGES_INVEST"));
const PAGES_RENOVATION = [...blocPages.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
const blocRoles = accSrc.slice(accSrc.indexOf("export const ROLE_PAGES_DEFAULT_RENOVATION"));
const blocRolesFin = blocRoles.slice(0, blocRoles.indexOf("\n};"));
const ROLES = Object.fromEntries([...blocRolesFin.matchAll(/^\s{2}(\w+):\s*\[([\s\S]*?)\]/gm)]
  .map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1])]));
// Pages du menu autorisées pour un rôle, dans l'ordre par défaut (comme `allowedNav`).
const menuDuRole = (role) => ALL_NAV.filter((id) => ROLES[role].includes(id) && estPageDuMenu(id));

// ── Copie de l'algorithme ACTUEL de la barre latérale (oracle) ──────────────
function ancienNav(allowedNav, customOrder) {
  if (!customOrder) return allowedNav;
  const byId = new Map(allowedNav.map((id) => [id, id]));
  const seen = new Set();
  const result = [];
  customOrder.forEach((id) => {
    if (byId.has(id) && !seen.has(id)) { result.push(byId.get(id)); seen.add(id); }
  });
  allowedNav.forEach((id) => { if (!seen.has(id)) result.push(id); });
  return result;
}

// Dates de la semaine du 23/11/2026 (lundi) au 29/11/2026 (dimanche).
const LUNDI = "2026-11-23", MARDI = "2026-11-24", MERCREDI = "2026-11-25",
  JEUDI = "2026-11-26", VENDREDI = "2026-11-27", SAMEDI = "2026-11-28", DIMANCHE = "2026-11-29";
const SEMAINE = [LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE];

const LISTES_REALISTES = [
  null,
  [],
  ["planning", "dashboard", "operations"],
  ["alertes", "alertes", "planning", "page-supprimee", "commandes", "dashboard"],
  ["admin", "journal-maj", "operations", "dashboard", "chantiers"],
  ["etats-financiers", "rapprochement", "dashboard"],
  [...ALL_NAV].reverse(),
  ["capture-cmd", 42, null, "plans", "bilan-semaine"],
];

const sansDoublon = (l) => new Set(l).size === l.length;
const memeEnsemble = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// Organisation fictive (exemple issu des tests, données fictives).
const ORG = {
  ordre: ["planning", "dashboard", "operations", "commandes"],
  jours: {
    lundi: {
      theme: "Bilan",
      accueil: "bilan-semaine",
      devant: ["bilan-semaine", "commandes", "commandes", "page-inconnue", "capture-cmd"],
      rendez_vous: [{ heure: null, libelle: "Réunion" }, { heure: "9h", libelle: "Heure invalide" }, { libelle: "" }],
      blocs: ["bilan_semaine_passee", "bloc_inconnu", "bilan_semaine_passee", "commandes_a_saisir"],
    },
    mardi: { theme: "Admin", accueil: "admin", devant: ["admin", "etats-financiers", "operations"], blocs: [] },
    mercredi: "n'importe quoi",
    samedi: { theme: "Week-end", accueil: "plans", devant: ["plans"], blocs: ["tournee_chantiers"] },
    dimanche: { theme: "Week-end", accueil: "plans", devant: ["plans"] },
  },
};

// ═══ 0. Sources lues ═══════════════════════════════════════════════════════
test("0. pages lues dans Navigation.jsx et access.js", () => {
  assert.ok(ALL_NAV.length >= 25, `allNav : ${ALL_NAV.length} pages`);
  assert.ok(PAGES_RENOVATION.length >= 25, `PAGES_RENOVATION : ${PAGES_RENOVATION.length} pages`);
  for (const r of ["admin", "conducteur", "commercial", "comptable", "charge_affaires"]) {
    assert.ok(Array.isArray(ROLES[r]) && ROLES[r].length > 0, `rôle ${r} lu`);
  }
});

// ═══ 1. Ancien format ══════════════════════════════════════════════════════
test("1. ancien format liste / null : même ordre que l'algorithme actuel, tous rôles, tous jours", () => {
  for (const role of ["admin", "conducteur", "commercial", "comptable", "charge_affaires"]) {
    const menu = menuDuRole(role);
    for (const liste of LISTES_REALISTES) {
      const attendu = ancienNav(menu, liste);
      assert.deepEqual(O.ordreHabituel(menu, O.lireNavOrder(liste).ordre), attendu, `${role} ${JSON.stringify(liste)}`);
      for (const d of SEMAINE) {
        assert.deepEqual(O.ordreDesPages(menu, liste, d), attendu, `${role} ${d} ${JSON.stringify(liste)}`);
        assert.equal(O.pageDArrivee(menu, liste, d), null);
        assert.deepEqual(O.blocsDuJour(liste, d), []);
        assert.equal(O.organisationDuJour(liste, d), null);
      }
    }
  }
});

test("2. lecture tolérante : valeurs invalides, objet sans `jours`", () => {
  for (const v of [undefined, null, 12, "texte", true, {}, { jours: null }, { jours: [] }, { ordre: "x" }]) {
    const n = O.lireNavOrder(v);
    assert.equal(n.aOrganisation, false, JSON.stringify(v));
    assert.deepEqual(n.jours, {});
  }
  const sansJours = { ordre: ["planning", "dashboard"] };
  const menu = menuDuRole("conducteur");
  assert.deepEqual(O.lireNavOrder(sansJours).ordre, ["planning", "dashboard"]);
  for (const d of SEMAINE) {
    assert.deepEqual(O.ordreDesPages(menu, sansJours, d), ancienNav(menu, ["planning", "dashboard"]));
    assert.equal(O.pageDArrivee(menu, sansJours, d), null);
  }
  assert.deepEqual(O.ordreDesPages(menu, { ordre: "x" }, LUNDI), menu, "ordre invalide = ordre par défaut");
});

// ═══ 2. Jours ══════════════════════════════════════════════════════════════
test("3. jour de la semaine calculé sur la chaîne (pas de fuseau)", () => {
  assert.deepEqual(SEMAINE.map(O.jourDeLaSemaine),
    ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]);
  assert.equal(O.jourDeLaSemaine("2026-03-29"), "dimanche", "passage à l'heure d'été");
  assert.equal(O.jourDeLaSemaine("2026-10-25"), "dimanche", "passage à l'heure d'hiver");
  assert.equal(O.jourDeLaSemaine("2028-02-29"), "mardi", "29 février bissextile");
  for (const v of ["2026-02-30", "2026-13-01", "26-11-24", "2026-11-24T10:00", "", null, 20261124]) {
    assert.equal(O.jourDeLaSemaine(v), null, String(v));
  }
});

test("4. samedi et dimanche : pas d'organisation, ordre habituel", () => {
  const menu = menuDuRole("admin");
  for (const d of [SAMEDI, DIMANCHE]) {
    assert.equal(O.organisationDuJour(ORG, d), null);
    assert.deepEqual(O.ordreDesPages(menu, ORG, d), ancienNav(menu, ORG.ordre));
    assert.equal(O.pageDArrivee(menu, ORG, d), null);
    assert.deepEqual(O.blocsDuJour(ORG, d), []);
  }
  assert.ok(!("samedi" in O.lireNavOrder(ORG).jours));
});

test("5. organisation du jour : normalisation (doublons, rendez-vous, blocs inconnus)", () => {
  const org = O.organisationDuJour(ORG, LUNDI);
  assert.equal(org.jour, "lundi");
  assert.equal(org.theme, "Bilan");
  assert.deepEqual(org.devant, ["bilan-semaine", "commandes", "page-inconnue", "capture-cmd"]);
  assert.deepEqual(org.rendez_vous, [{ heure: null, libelle: "Réunion" }, { heure: null, libelle: "Heure invalide" }]);
  assert.deepEqual(org.blocs, ["bilan_semaine_passee", "commandes_a_saisir"]);
  assert.deepEqual(O.blocsDuJour(ORG, LUNDI), ["bilan_semaine_passee", "commandes_a_saisir"]);
  assert.equal(O.organisationDuJour(ORG, MERCREDI), null, "jour mal formé ignoré");
  assert.equal(O.organisationDuJour(ORG, JEUDI), null, "jour non configuré");
});

test("6. ordre du jour : `devant` en tête, le reste dans l'ordre habituel, page inconnue ignorée", () => {
  const menu = menuDuRole("conducteur");
  const habituel = ancienNav(menu, ORG.ordre);
  const pages = O.ordreDesPages(menu, ORG, LUNDI);
  assert.deepEqual(pages.slice(0, 3), ["bilan-semaine", "commandes", "capture-cmd"]);
  assert.deepEqual(pages.slice(3), habituel.filter((id) => !["bilan-semaine", "commandes", "capture-cmd"].includes(id)));
  assert.ok(!pages.includes("page-inconnue"));
  assert.equal(O.pageDArrivee(menu, ORG, LUNDI), "bilan-semaine");
});

test("7. page non autorisée dans `devant` et dans `accueil` : ignorée sans erreur", () => {
  // Mardi : accueil « admin », devant admin + etats-financiers (non autorisés au conducteur).
  const menu = menuDuRole("conducteur");
  assert.ok(!menu.includes("admin") && !menu.includes("etats-financiers"));
  const pages = O.ordreDesPages(menu, ORG, MARDI);
  assert.equal(pages[0], "operations");
  assert.ok(!pages.includes("admin") && !pages.includes("etats-financiers"));
  assert.equal(O.pageDArrivee(menu, ORG, MARDI), null);
  // Lundi pour un chargé d'affaires : aucune page de `devant` autorisée.
  const ca = menuDuRole("charge_affaires");
  assert.deepEqual(O.ordreDesPages(ca, ORG, LUNDI), ancienNav(ca, ORG.ordre));
  assert.equal(O.pageDArrivee(ca, ORG, LUNDI), null);
  // Admin : la page devient autorisée, elle s'applique.
  assert.equal(O.pageDArrivee(menuDuRole("admin"), ORG, MARDI), "admin");
});

test("8. aucune page ne disparaît, aucune n'apparaît, aucun doublon", () => {
  const orgs = [ORG, { jours: O.copieModeleConducteurTravaux() }, null, ["planning"]];
  for (const role of Object.keys(ROLES)) {
    const menu = ROLES[role].filter(estPageDuMenu);
    for (const no of orgs) for (const d of SEMAINE) {
      const pages = O.ordreDesPages(menu, no, d);
      assert.ok(memeEnsemble(pages, menu), `${role} ${d}`);
      assert.ok(sansDoublon(pages), `${role} ${d}`);
    }
  }
});

// ═══ 3. Ordre habituel aujourd'hui ═════════════════════════════════════════
test("9. « Ordre habituel aujourd'hui » : actif le jour même, expiré le lendemain", () => {
  const menu = menuDuRole("conducteur");
  const actif = O.activerOrdreHabituel(ORG, LUNDI);
  assert.equal(actif.ordre_habituel_le, LUNDI);
  assert.deepEqual(actif.jours, ORG.jours, "jours conservés");
  assert.equal(O.ordreHabituelActif(actif, LUNDI), true);
  assert.deepEqual(O.ordreDesPages(menu, actif, LUNDI), ancienNav(menu, ORG.ordre));
  assert.equal(O.pageDArrivee(menu, actif, LUNDI), null);
  assert.deepEqual(O.blocsDuJour(actif, LUNDI), []);
  const org = O.organisationDuJour(actif, LUNDI);
  assert.equal(org.theme, "Bilan", "bandeau : thème lisible");
  assert.equal(org.rendez_vous.length, 2, "bandeau : rendez-vous lisibles");
  const etat = O.etatDuJour(menu, actif, LUNDI);
  assert.equal(etat.ordreHabituel, true);
  assert.equal(etat.organisation.theme, "Bilan");
  // Le lendemain (mardi) : expiré, l'organisation du mardi s'applique.
  assert.equal(O.ordreHabituelActif(actif, MARDI), false);
  assert.equal(O.ordreDesPages(menu, actif, MARDI)[0], "operations");
  // Lundi suivant : toujours expiré.
  assert.equal(O.ordreHabituelActif(actif, "2026-11-30"), false);
  assert.equal(O.pageDArrivee(menu, actif, "2026-11-30"), "bilan-semaine");
  // Désactivation.
  const desactive = O.desactiverOrdreHabituel(actif);
  assert.ok(!("ordre_habituel_le" in desactive));
  assert.deepEqual(desactive, ORG);
  assert.equal(O.pageDArrivee(menu, desactive, LUNDI), "bilan-semaine");
  // Date invalide stockée : ignorée.
  assert.equal(O.ordreHabituelActif({ ...ORG, ordre_habituel_le: "demain" }, LUNDI), false);
  // Sans organisation : rien n'est écrit, le contenu reste celui d'aujourd'hui.
  assert.equal(O.activerOrdreHabituel(null, LUNDI), null);
  assert.deepEqual(O.activerOrdreHabituel(["planning"], LUNDI), ["planning"]);
});

// ═══ 4. Écriture ═══════════════════════════════════════════════════════════
test("10. écriture de `ordre` : préserve `jours` ; sans organisation, liste simple", () => {
  const nouvel = ["commandes", "planning"];
  const ecrit = O.ecrireOrdre(ORG, nouvel);
  assert.deepEqual(ecrit.ordre, nouvel);
  assert.deepEqual(ecrit.jours, ORG.jours);
  const avecMode = O.ecrireOrdre(O.activerOrdreHabituel(ORG, LUNDI), nouvel);
  assert.equal(avecMode.ordre_habituel_le, LUNDI, "mode conservé");
  assert.deepEqual(ORG.ordre, ["planning", "dashboard", "operations", "commandes"], "entrée non modifiée");
  // Utilisateurs sans organisation : exactement le même contenu qu'aujourd'hui.
  assert.deepEqual(O.ecrireOrdre(null, nouvel), nouvel);
  assert.deepEqual(O.ecrireOrdre(["dashboard"], nouvel), nouvel);
  assert.deepEqual(O.ecrireOrdre({ ordre: ["x"] }, nouvel), nouvel);
  assert.deepEqual(O.ecrireOrdre({ ordre: ["x"], jours: {} }, nouvel), nouvel);
  // Réinitialisation : null sans organisation (comme aujourd'hui), jours gardés sinon.
  assert.equal(O.reinitialiserOrdre(["dashboard"]), null);
  assert.equal(O.reinitialiserOrdre(null), null);
  const reinit = O.reinitialiserOrdre(ORG);
  assert.ok(!("ordre" in reinit));
  assert.deepEqual(reinit.jours, ORG.jours);
  const menu = menuDuRole("conducteur");
  assert.deepEqual(O.ordreDesPages(menu, reinit, JEUDI), menu, "ordre par défaut après réinitialisation");
  // Aller-retour lecture / écriture : l'ordre relu est celui écrit.
  assert.deepEqual(O.lireNavOrder(ecrit).ordre, nouvel);
});

// ═══ 5. Modèle Conducteur de travaux ═══════════════════════════════════════
test("11. modèle « Conducteur de travaux » valide", () => {
  const M = O.MODELE_CONDUCTEUR_TRAVAUX;
  assert.deepEqual(Object.keys(M), [...O.JOURS_ORGANISATION]);
  for (const [jour, conf] of Object.entries(M)) {
    assert.ok(conf.theme, jour);
    assert.ok(PAGES_RENOVATION.includes(conf.accueil) && ALL_NAV.includes(conf.accueil), `${jour} accueil ${conf.accueil}`);
    assert.ok(estPageDuMenu(conf.accueil));
    assert.ok(conf.devant.includes(conf.accueil), `${jour} : l'accueil fait partie des pages en tête`);
    for (const p of conf.devant) {
      assert.ok(PAGES_RENOVATION.includes(p) && ALL_NAV.includes(p) && estPageDuMenu(p), `${jour} page ${p}`);
      assert.ok(ROLES.conducteur.includes(p), `${jour} page ${p} autorisée au conducteur par défaut`);
    }
    assert.ok(sansDoublon(conf.devant));
    for (const b of conf.blocs) assert.ok(O.CATALOGUE_BLOCS.includes(b), `${jour} bloc ${b}`);
    // Relu par le module à l'identique (rien n'est filtré).
    assert.deepEqual(O.lireNavOrder({ jours: M }).jours[jour], JSON.parse(JSON.stringify(conf)));
  }
  assert.deepEqual(M.mercredi.rendez_vous, [{ heure: "09:30", libelle: "Réunion appli et IA avec Matthieu" }]);
  assert.deepEqual(M.lundi.rendez_vous, [{ heure: null, libelle: "Réunion sur la semaine passée" }]);
  assert.ok(Object.isFrozen(M) && Object.isFrozen(M.lundi.devant), "constante figée");
  const copie = O.copieModeleConducteurTravaux();
  copie.lundi.devant.push("plans");
  assert.equal(M.lundi.devant.length, 3, "la copie est indépendante");
  // Tous les blocs du catalogue sont utilisés par le modèle.
  const utilises = new Set(Object.values(M).flatMap((c) => c.blocs));
  assert.deepEqual([...utilises].sort(), [...O.CATALOGUE_BLOCS].sort());
  // Appliqué au conducteur : arrivée et première page de chaque jour.
  const menu = menuDuRole("conducteur");
  const no = { ordre: null, jours: M };
  assert.deepEqual([LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI].map((d) => O.pageDArrivee(menu, no, d)),
    ["bilan-semaine", "operations", "plans", "alertes", "planning"]);
  assert.deepEqual(O.ordreDesPages(menu, no, JEUDI).slice(0, 4), ["alertes", "retours-terrain", "phasage-v2", "planning"]);
});

// ═══ 6. Pureté ═════════════════════════════════════════════════════════════
test("12. module pur : ni Supabase, ni horloge, façade .js", () => {
  const src = sansCommentaires(lire("src/Renovation/organisationJour.mjs"));
  assert.ok(!/supabase/i.test(src), "aucun accès Supabase");
  assert.ok(!/^\s*import\s/m.test(src), "aucun import");
  assert.ok(!/new Date\(\s*\)/.test(src), "pas de new Date() sans argument");
  assert.ok(!/Date\.now|performance\.now|localStorage|window\.|document\./.test(src), "aucune horloge ni effet de bord");
  assert.match(lire("src/Renovation/organisationJour.js"), /export \* from "\.\/organisationJour\.mjs";/);
});

// ═══ 7. Navigation (étape 2, tâche 2) ═════════════════════════════════════
// Ordre par défaut de la barre du bas (ALL_NAV_ITEMS), lu dans la source.
const blocBas = navSrc.slice(navSrc.indexOf("const ALL_NAV_ITEMS = ["), navSrc.indexOf("function BottomNav"));
const ALL_NAV_ITEMS = [...blocBas.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]);
const basDuRole = (role) => ALL_NAV_ITEMS.filter((id) => ROLES[role].includes(id) && estPageDuMenu(id));

test("13. barre du bas : sans organisation active, ordre par défaut inchangé (glisser-déposer ignoré, comme avant)", () => {
  assert.ok(memeEnsemble(ALL_NAV_ITEMS, ALL_NAV), "barre du bas et barre latérale listent les mêmes pages");
  for (const role of Object.keys(ROLES)) {
    const bas = basDuRole(role), menu = menuDuRole(role);
    for (const no of [...LISTES_REALISTES, { ordre: ["planning", "alertes"] }]) {
      for (const d of SEMAINE) assert.deepEqual(O.ordreBarreDuBas(bas, menu, no, d), bas, `${role} ${d} ${JSON.stringify(no)}`);
    }
    // Organisation présente mais pas active : week-end, mode « ordre habituel », aucune page `devant` autorisée.
    for (const d of [SAMEDI, DIMANCHE, JEUDI]) assert.deepEqual(O.ordreBarreDuBas(bas, menu, ORG, d), bas, `${role} ${d}`);
    assert.deepEqual(O.ordreBarreDuBas(bas, menu, O.activerOrdreHabituel(ORG, LUNDI), LUNDI), bas, `${role} ordre habituel`);
  }
  assert.equal(O.ordreDuJourActif(menuDuRole("charge_affaires"), ORG, LUNDI), false, "aucune page en tête autorisée");
  assert.deepEqual(O.ordreBarreDuBas(basDuRole("charge_affaires"), menuDuRole("charge_affaires"), ORG, LUNDI), basDuRole("charge_affaires"));
});

test("14. barre du bas : organisation du jour active = exactement l'ordre de la barre latérale", () => {
  const no = { ordre: ["planning", "dashboard"], jours: O.copieModeleConducteurTravaux() };
  for (const role of ["admin", "conducteur"]) {
    const bas = basDuRole(role), menu = menuDuRole(role);
    for (const d of [LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI]) {
      assert.equal(O.ordreDuJourActif(menu, no, d), true, `${role} ${d}`);
      const pages = O.ordreBarreDuBas(bas, menu, no, d);
      assert.deepEqual(pages, O.ordreDesPages(menu, no, d), `${role} ${d}`);
      assert.deepEqual(pages, O.etatDuJour(menu, no, d).pages);
      assert.ok(memeEnsemble(pages, bas), "aucune page ne disparaît");
    }
  }
  // Raccourcis du jeudi pour le conducteur (4 premiers).
  assert.deepEqual(O.ordreBarreDuBas(basDuRole("conducteur"), menuDuRole("conducteur"), no, JEUDI).slice(0, 4),
    ["alertes", "retours-terrain", "phasage-v2", "planning"]);
});

test("15. Navigation.jsx et App.jsx branchés sur le module ; date du jour unique", () => {
  const nav = sansCommentaires(navSrc);
  assert.ok(!/Array\.isArray\(\s*profil\?\.nav_order\s*\)/.test(nav), "plus de lecture « liste seulement » de nav_order");
  assert.match(nav, /from "\.\/organisationJour\.js"/);
  assert.match(nav, /ecrireOrdre\(/, "glisser-déposer via ecrireOrdre");
  assert.match(nav, /reinitialiserOrdre\(/, "réinitialisation via reinitialiserOrdre");
  assert.match(nav, /etatDuJour\(/, "barre latérale : ordre du jour");
  assert.match(nav, /ordreBarreDuBas\(/, "barre du bas : même module");
  assert.match(nav, /ordreHabituel\(/, "édition : ordre habituel");
  assert.match(nav, /dateDuJour\(\)/);
  assert.ok(!/nav_order:\s*ids\b/.test(nav) && !/nav_order:\s*null\b/.test(nav), "plus d'écriture directe de nav_order");
  assert.match(sansCommentaires(lire("src/App.jsx")), /<BottomNav[^>]*profil=\{profil\}/, "App.jsx passe profil à BottomNav");
  const date = sansCommentaires(lire("src/Renovation/dateDuJour.js"));
  assert.match(date, /export function dateDuJour\(/);
  assert.match(date, /date_simulee/);
  assert.match(date, /estDateIso\(/, "date simulée validée");
  assert.match(date, /getFullYear\(\)[\s\S]*getMonth\(\)[\s\S]*getDate\(\)/, "date locale de l'appareil");
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
