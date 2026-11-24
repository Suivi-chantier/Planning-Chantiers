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
//   8. page d'arrivée et bouton « Ordre habituel aujourd'hui » (tâche 3) ;
//   9. écran « Mon organisation » (tâche 4) : ecrireJours, supprimerOrganisation
//      (retour exact à la valeur d'avant), modèle filtré par rôle, aucune
//      nouvelle écriture vers utilisateurs.
//  10. tableau de bord du jour (tâche 5) : bandeau (jour, thématique,
//      rendez-vous triés, bouton), absent sans organisation et le week-end ;
//      blocs au-dessus des widgets actuels, tous conservés ; registre des
//      blocs complet ; liens limités aux pages autorisées ; aucun bloc vide.
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
  // Les deux écritures historiques restent (inventaire figé par
  // verif-utilisateurs-champs-sensibles) ; `ids` vient désormais du module.
  assert.match(nav, /const persistOrder = \(ordre\) => sauvegarderNavOrder\(ecrireOrdre\(navOrder, ordre\)\)/, "sauvegarde = ecrireOrdre");
  assert.match(nav, /const ids = reinitialiserOrdre\(navOrder\);\s*if \(ids !== null\) \{ sauvegarderNavOrder\(ids\); return; \}/, "réinit. avec organisation : jours gardés");
  assert.equal((nav.match(/from\("utilisateurs"\)/g) || []).length, 2, "deux écritures vers utilisateurs, pas plus");
  assert.match(sansCommentaires(lire("src/App.jsx")), /<BottomNav[^>]*profil=\{profil\}/, "App.jsx passe profil à BottomNav");
  const date = sansCommentaires(lire("src/Renovation/dateDuJour.js"));
  assert.match(date, /export function dateDuJour\(/);
  assert.match(date, /date_simulee/);
  assert.match(date, /estDateIso\(/, "date simulée validée");
  assert.match(date, /getFullYear\(\)[\s\S]*getMonth\(\)[\s\S]*getDate\(\)/, "date locale de l'appareil");
});

// ═══ 8. Page d'arrivée et bouton « Ordre habituel aujourd'hui » (tâche 3) ═══
test("16. page d'arrivée à l'ouverture : une fois, jamais sur une demande explicite ni après navigation", () => {
  const menu = menuDuRole("conducteur");
  const no = { ordre: ["planning", "dashboard"], jours: O.copieModeleConducteurTravaux() };
  const base = { pagesAutorisees: menu, navOrder: no };
  assert.deepEqual([LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI].map((dateIso) => O.pageAOuvrirAuDemarrage({ ...base, dateIso })),
    ["bilan-semaine", "operations", "plans", "alertes", "planning"]);
  for (const d of [SAMEDI, DIMANCHE]) assert.equal(O.pageAOuvrirAuDemarrage({ ...base, dateIso: d }), null, `week-end ${d}`);
  assert.equal(O.pageAOuvrirAuDemarrage({ ...base, dateIso: LUNDI, dejaDecide: true }), null, "jamais une seconde fois");
  assert.equal(O.pageAOuvrirAuDemarrage({ ...base, dateIso: LUNDI, demandeExplicite: true }), null, "lien ?page= / notification prioritaire");
  assert.equal(O.pageAOuvrirAuDemarrage({ ...base, dateIso: LUNDI, dejaNavigue: true }), null, "l'utilisateur a déjà navigué");
  assert.equal(O.pageAOuvrirAuDemarrage({ ...base, navOrder: O.activerOrdreHabituel(no, LUNDI), dateIso: LUNDI }), null, "mode ordre habituel");
  // Sans organisation : jamais de page d'arrivée (règle 1).
  for (const l of LISTES_REALISTES) for (const d of SEMAINE) {
    assert.equal(O.pageAOuvrirAuDemarrage({ pagesAutorisees: menu, navOrder: l, dateIso: d }), null, `${JSON.stringify(l)} ${d}`);
  }
  // Page non autorisée pour le rôle : ignorée (règle 2).
  assert.equal(O.pageAOuvrirAuDemarrage({ pagesAutorisees: menuDuRole("commercial"), navOrder: no, dateIso: LUNDI }), null, "bilan-semaine non autorisé au commercial");
  assert.equal(O.pageAOuvrirAuDemarrage({ pagesAutorisees: menuDuRole("commercial"), navOrder: no, dateIso: MARDI }), "operations");
  assert.equal(O.pageAOuvrirAuDemarrage(), null, "sans paramètre : rien");
});

test("17. bouton « Ordre habituel aujourd'hui » : visible seulement avec une organisation du jour, bascule aller-retour", () => {
  const no = { ordre: ["planning", "dashboard"], jours: O.copieModeleConducteurTravaux() };
  const menu = menuDuRole("conducteur");
  for (const l of LISTES_REALISTES) for (const d of SEMAINE) {
    assert.equal(O.boutonOrdreHabituel(l, d), null, "sans organisation : pas de bouton");
    assert.deepEqual(O.basculerOrdreHabituel(l, d), l ?? null, "sans organisation : rien d'écrit");
  }
  for (const d of [SAMEDI, DIMANCHE]) assert.equal(O.boutonOrdreHabituel(no, d), null, `week-end ${d}`);
  assert.equal(O.boutonOrdreHabituel(ORG, MERCREDI), null, "jour mal configuré : pas de bouton");
  assert.deepEqual(O.boutonOrdreHabituel(no, JEUDI), { actif: false, libelle: "Ordre habituel aujourd'hui" });
  const actif = O.basculerOrdreHabituel(no, JEUDI);
  assert.equal(actif.ordre_habituel_le, JEUDI);
  assert.deepEqual(actif.jours, no.jours, "jours conservés");
  assert.deepEqual(actif.ordre, no.ordre, "ordre habituel conservé");
  assert.deepEqual(O.boutonOrdreHabituel(actif, JEUDI), { actif: true, libelle: "Revenir à l'organisation du jour" });
  assert.deepEqual(O.ordreDesPages(menu, actif, JEUDI), O.ordreHabituel(menu, no.ordre), "menu : ordre habituel");
  assert.equal(O.pageDArrivee(menu, actif, JEUDI), null);
  assert.deepEqual(O.blocsDuJour(actif, JEUDI), []);
  assert.equal(O.etatDuJour(menu, actif, JEUDI).organisation.theme, "Tournée des chantiers et anticipation", "bandeau toujours lisible");
  // Le lendemain, le mode a expiré tout seul ; le bouton repropose « Ordre habituel aujourd'hui ».
  assert.deepEqual(O.boutonOrdreHabituel(actif, VENDREDI), { actif: false, libelle: "Ordre habituel aujourd'hui" });
  assert.deepEqual(O.ordreDesPages(menu, actif, VENDREDI), O.ordreDesPages(menu, no, VENDREDI));
  // Retour à l'organisation du jour : valeur identique à celle d'avant le clic.
  assert.deepEqual(O.basculerOrdreHabituel(actif, JEUDI), no);
  assert.deepEqual(O.ordreDesPages(menu, O.basculerOrdreHabituel(actif, JEUDI), JEUDI), O.ordreDesPages(menu, no, JEUDI));
});

test("18. App.jsx et Navigation.jsx : page d'arrivée et bouton branchés, aucune nouvelle écriture", () => {
  const nav = sansCommentaires(navSrc);
  const app = sansCommentaires(lire("src/App.jsx"));
  assert.equal((nav.match(/from\("utilisateurs"\)/g) || []).length, 2, "Navigation.jsx : toujours deux écritures");
  assert.ok(!/from\(\s*["'`]utilisateurs["'`]\s*\)\s*\.(update|insert|upsert|delete)/.test(app), "App.jsx n'écrit pas dans utilisateurs");
  assert.match(nav, /function useOrganisationDuJour\(profil\)/, "hook partagé (bandeau du tableau de bord, tâche 5)");
  assert.match(nav, /activerOrdreHabituel: \(\) => enregistrer\(activerOrdreHabituel\(navOrder, date\)\)/);
  assert.match(nav, /desactiverOrdreHabituel: \(\) => enregistrer\(desactiverOrdreHabituel\(navOrder\)\)/);
  assert.match(nav, /const enregistrer = \(valeur\) => \{ if \(valeur !== navOrder\) sauvegarderNavOrder\(valeur\); \}/, "même écriture que le glisser-déposer");
  assert.match(nav, /boutonOrdreHabituel\(navOrder, date\)/);
  assert.match(nav, /\{orgJour\.bouton && !editOrder && \(/, "barre latérale");
  assert.match(nav, /boutonOrdreHabituel=\{orgJour\.bouton\}/, "téléphone : feuille « Plus »");
  assert.match(nav, /const idsMenu = idsPagesDuMenu\(role, rolePages\);/);
  assert.match(nav, /export \{[^}]*idsPagesDuMenu[^}]*useOrganisationDuJour[^}]*\}/);
  assert.match(app, /pageAOuvrirAuDemarrage\(\{/);
  assert.match(app, /pagesAutorisees: idsPagesDuMenu\(role, rolePages\)/, "mêmes pages que la barre latérale");
  assert.match(app, /if \(pageDArriveeDecidee \|\| !accesCharge \|\| !profil \|\| role==="ouvrier"\) return;\s*pageDArriveeDecidee = true;/, "une seule fois, config d'accès en base chargée");
  assert.match(app, /if \(cible && canAccess\(role, cible\) && cible !== page\) setPage\(cible\);/);
  assert.match(app, /has\("page"\)/, "lien ?page= = demande explicite");
  // Espace ouvrier et Invest : aucune page d'arrivée du jour.
  const blocMain = app.slice(app.indexOf("function MainApp("), app.indexOf("export default function"));
  assert.ok(blocMain.includes("pageAOuvrirAuDemarrage("), "seulement dans l'application Rénovation (MainApp)");
  assert.equal((app.match(/pageAOuvrirAuDemarrage\(/g) || []).length, 1);
});

// ═══ 9. Écran « Mon organisation » (tâche 4) ══════════════════════════════
test("19. ecrireJours : objet { ordre, jours } ; ordre et « ordre habituel aujourd'hui » conservés", () => {
  const modele = O.copieModeleConducteurTravaux();
  // Ancienne liste : devient `ordre`.
  const liste = ["planning", "dashboard", "operations"];
  const v1 = O.ecrireJours(liste, modele);
  assert.deepEqual(v1.ordre, liste);
  assert.deepEqual(Object.keys(v1.jours), ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]);
  assert.deepEqual(v1.jours.lundi, O.lireNavOrder({ jours: { lundi: modele.lundi } }).jours.lundi);
  // null : pas de clé `ordre` inventée.
  const v2 = O.ecrireJours(null, modele);
  assert.ok(!("ordre" in v2));
  assert.equal(O.lireNavOrder(v2).ordre, null);
  // Objet existant : ordre et ordre_habituel_le gardés, jours remplacés.
  const existant = { ordre: ["plans", "dashboard"], ordre_habituel_le: "2026-11-23", jours: { mardi: { theme: "Ancien" } } };
  const v3 = O.ecrireJours(existant, { jeudi: { theme: "Tournée", devant: ["alertes"] } });
  assert.deepEqual(v3.ordre, ["plans", "dashboard"]);
  assert.equal(v3.ordre_habituel_le, "2026-11-23");
  assert.deepEqual(Object.keys(v3.jours), ["jeudi"], "mardi remplacé (retiré du formulaire)");
  assert.deepEqual(existant.jours, { mardi: { theme: "Ancien" } }, "entrée non modifiée");
  // L'ordre du jour suit l'organisation enregistrée.
  const menu = menuDuRole("conducteur");
  assert.deepEqual(O.ordreDesPages(menu, v1, LUNDI).slice(0, 3), ["bilan-semaine", "commandes", "capture-cmd"]);
  assert.equal(O.pageDArrivee(menu, v1, JEUDI), "alertes");
});

test("20. ecrireJours : saisie du formulaire normalisée, jours vides retirés, rien de rempli = suppression", () => {
  const form = {
    lundi: { theme: "  Bilan  ", accueil: "", devant: ["bilan-semaine", "bilan-semaine"], rendez_vous: [{ heure: "", libelle: "Réunion" }, { heure: "09:30", libelle: "  " }, { heure: "9h", libelle: "Point" }], blocs: ["inconnu", "bilan_semaine_passee"] },
    mardi: { theme: "", accueil: "", devant: [], rendez_vous: [{ heure: "10:00", libelle: "" }], blocs: [] },
    samedi: { theme: "Interdit" },
  };
  const v = O.ecrireJours(["dashboard"], form);
  assert.deepEqual(Object.keys(v.jours), ["lundi"], "mardi vide et samedi ignorés");
  assert.deepEqual(v.jours.lundi, {
    theme: "Bilan", accueil: null, devant: ["bilan-semaine"],
    rendez_vous: [{ heure: null, libelle: "Réunion" }, { heure: null, libelle: "Point" }],
    blocs: ["bilan_semaine_passee"],
  });
  const vide = { lundi: { theme: "", accueil: "", devant: [], rendez_vous: [], blocs: [] } };
  assert.deepEqual(O.ecrireJours(["dashboard", "planning"], vide), ["dashboard", "planning"]);
  assert.equal(O.ecrireJours(null, vide), null);
  assert.equal(O.ecrireJours(null, {}), null);
});

test("21. supprimerOrganisation : retour EXACT à la valeur d'avant le modèle", () => {
  const modele = O.copieModeleConducteurTravaux();
  for (const avant of [null, ["planning", "dashboard", "operations"], []]) {
    const apres = O.ecrireJours(avant, modele);
    assert.ok(O.lireNavOrder(apres).aOrganisation);
    assert.deepEqual(O.supprimerOrganisation(apres), avant, `avant = ${JSON.stringify(avant)}`);
    // Même chemin après le bouton « Ordre habituel aujourd'hui ».
    assert.deepEqual(O.supprimerOrganisation(O.activerOrdreHabituel(apres, LUNDI)), avant);
    // Et après un glisser-déposer : on garde le nouvel ordre habituel, en liste simple.
    assert.deepEqual(O.supprimerOrganisation(O.ecrireOrdre(apres, ["plans"])), ["plans"]);
  }
  assert.equal(O.supprimerOrganisation(undefined), null);
  assert.equal(O.supprimerOrganisation({ jours: {} }), null);
  // Sans organisation, l'ordre de chaque rôle est celui d'avant.
  const menu = menuDuRole("conducteur");
  const avant = ["planning", "dashboard"];
  const retour = O.supprimerOrganisation(O.ecrireJours(avant, modele));
  for (const d of [LUNDI, JEUDI, VENDREDI]) assert.deepEqual(O.ordreDesPages(menu, retour, d), ancienNav(menu, avant));
});

test("22. modèle filtré par rôle : pages non autorisées retirées et signalées ; libellés des blocs", () => {
  const modele = O.copieModeleConducteurTravaux();
  const conducteur = O.filtrerPagesAutorisees(modele, menuDuRole("conducteur"));
  assert.deepEqual(conducteur.retirees, [], "tout le modèle est autorisé au conducteur");
  assert.deepEqual(conducteur.jours, modele);
  const commercial = O.filtrerPagesAutorisees(modele, menuDuRole("commercial"));
  assert.ok(commercial.retirees.length > 0);
  assert.ok(commercial.retirees.some((r) => r.jour === "lundi" && r.champ === "accueil" && r.id === "bilan-semaine"));
  assert.equal(commercial.jours.lundi.accueil, null);
  for (const j of O.JOURS_ORGANISATION) {
    assert.ok(commercial.jours[j].devant.every((id) => menuDuRole("commercial").includes(id)));
    assert.equal(commercial.jours[j].theme, modele[j].theme, "thème et rendez-vous gardés");
    assert.deepEqual(commercial.jours[j].rendez_vous, modele[j].rendez_vous);
  }
  assert.deepEqual(O.MODELE_CONDUCTEUR_TRAVAUX, O.copieModeleConducteurTravaux(), "modèle figé intact");
  for (const b of O.CATALOGUE_BLOCS) assert.ok(typeof O.LIBELLES_BLOCS[b] === "string" && O.LIBELLES_BLOCS[b].length > 0, b);
  assert.deepEqual(Object.keys(O.LIBELLES_BLOCS).sort(), [...O.CATALOGUE_BLOCS].sort());
});

test("23. écran « Mon organisation » : dans le profil, enregistrement par les écritures existantes", () => {
  const nav = sansCommentaires(navSrc);
  const ecran = sansCommentaires(lire("src/Renovation/MonOrganisation.jsx"));
  const profilSrc = sansCommentaires(lire("src/Renovation/ProfilNotifications.jsx"));
  const app = sansCommentaires(lire("src/App.jsx"));
  // Aucune écriture directe vers utilisateurs hors Navigation.jsx (2 écritures).
  for (const [nom, src] of [["MonOrganisation.jsx", ecran], ["ProfilNotifications.jsx", profilSrc]]) {
    assert.ok(!/from\(\s*["'`]utilisateurs["'`]\s*\)/.test(src), `${nom} n'accède pas à utilisateurs`);
  }
  assert.equal((nav.match(/from\("utilisateurs"\)/g) || []).length, 2);
  assert.match(nav, /from\("utilisateurs"\)\.update\(\{ nav_order: ids \}\)/);
  assert.match(nav, /from\("utilisateurs"\)\.update\(\{ nav_order: null \}\)/);
  assert.match(nav, /const enregistrerNavOrder = \(valeur\) =>/);
  assert.match(nav, /export \{[^}]*useNavOrder[^}]*\}/);
  // Profil d'App relu après enregistrement (composants montés plus tard).
  assert.match(nav, /valeursDeLaSession\.set\(cle, valeur\)/);
  assert.match(nav, /if \(valeursDeLaSession\.has\(cle\)\) return valeursDeLaSession\.get\(cle\);/);
  // L'écran passe par le hook et le module.
  assert.match(ecran, /useNavOrder\(profil\)/);
  assert.match(ecran, /enregistrerNavOrder\(valeur\)/);
  assert.match(ecran, /const valeur = ecrireJours\(navOrder, form\)/);
  assert.match(ecran, /enregistrerNavOrder\(supprimerOrganisation\(navOrder\)\)/);
  assert.match(ecran, /filtrerPagesAutorisees\(copieModeleConducteurTravaux\(\), pages\)/, "modèle : pages du rôle seulement");
  assert.match(ecran, /idsPagesDuMenu\(role, rolePages\)/, "pages proposées = menu du rôle");
  assert.ok(!/supabase/i.test(ecran), "l'écran n'appelle pas Supabase lui-même");
  const blocModele = ecran.slice(ecran.indexOf("const appliquerModele"), ecran.indexOf("const enregistrer = async"));
  assert.ok(!/enregistrerNavOrder|ecrireJours/.test(blocModele), "le modèle pré-remplit sans enregistrer");
  // Branché dans le panneau « Mon profil », pas dans le menu ni access.js.
  assert.match(profilSrc, /import MonOrganisation from "\.\/MonOrganisation"/);
  assert.match(profilSrc, /<MonOrganisation profil=\{profil\} role=\{role\} rolePages=\{rolePages\}/);
  assert.match(app, /<PanneauProfil profil=\{profil\} role=\{role\} rolePages=\{rolePages\}/);
  assert.ok(!/mon-organisation|MonOrganisation/.test(lire("src/access.js")), "pas une page du menu");
  // Rénovation seulement (MainApp), jamais pour un ouvrier ; rien dans Invest.
  const blocMain = app.slice(app.indexOf("function MainApp("), app.indexOf("export default function"));
  assert.equal((app.match(/<PanneauProfil /g) || []).length, 1);
  assert.ok(blocMain.includes("{profilOuvert&&role!==\"ouvrier\"&&<PanneauProfil "), "panneau Rénovation, pas pour un ouvrier");
  assert.match(profilSrc, /if \(!roleConcerne\(role\)\) return null;/);
});

// ═══ 10. Tableau de bord du jour (tâche 5) ═════════════════════════════════
test("24. rendez-vous du bandeau : heures croissantes, puis sans heure dans l'ordre saisi", () => {
  const rdv = [
    { heure: null, libelle: "Sans heure A" },
    { heure: "14:00", libelle: "Après-midi" },
    { heure: "09:30", libelle: "Matin 1" },
    { heure: "9h", libelle: "Heure invalide = sans heure" },
    { heure: "09:30", libelle: "Matin 2 (même heure, saisi après)" },
    { libelle: "" },
    "n'importe quoi",
    { heure: "08:00", libelle: "Tôt" },
  ];
  assert.deepEqual(O.trierRendezVous(rdv).map((r) => r.libelle),
    ["Tôt", "Matin 1", "Matin 2 (même heure, saisi après)", "Après-midi", "Sans heure A", "Heure invalide = sans heure"]);
  assert.deepEqual(O.trierRendezVous(null), []);
  assert.deepEqual(O.trierRendezVous([]), []);
  assert.equal(O.libelleDateDuJour(LUNDI), "Lundi 23 novembre");
  assert.equal(O.libelleDateDuJour(SAMEDI), "Samedi 28 novembre");
  assert.equal(O.libelleDateDuJour("2026-02-30"), null);
});

test("25. bandeau du jour : seulement avec une organisation ce jour-là ; reste en mode « ordre habituel » sans les blocs", () => {
  const nav = { ordre: ["planning"], jours: O.copieModeleConducteurTravaux() };
  // Sans organisation, ancien format, week-end : aucun bandeau (règle 1).
  for (const v of [null, [], ["planning", "dashboard"], { ordre: ["planning"] }, "texte", 42]) {
    for (const d of SEMAINE) assert.equal(O.bandeauDuJour(v, d), null, `${JSON.stringify(v)} ${d}`);
  }
  assert.equal(O.bandeauDuJour(nav, SAMEDI), null);
  assert.equal(O.bandeauDuJour(nav, DIMANCHE), null);
  assert.equal(O.bandeauDuJour(ORG, SAMEDI), null, "samedi configuré à tort : ignoré");
  assert.equal(O.bandeauDuJour(ORG, MERCREDI), null, "jour invalide : pas de bandeau");
  // Modèle Conducteur de travaux, chaque jour ouvré.
  const attendus = {
    [LUNDI]: ["Bilan, réunion et commandes", ["bilan_semaine_passee", "commandes_a_saisir"], 1],
    [MARDI]: ["Chantiers à venir", ["chantiers_a_venir"], 0],
    [MERCREDI]: ["Application, plans et administratif", ["administratif_fournisseurs"], 1],
    [JEUDI]: ["Tournée des chantiers et anticipation", ["tournee_chantiers"], 0],
    [VENDREDI]: ["Planning et commandes S+1", ["planning_semaine_suivante", "materiaux_a_commander"], 0],
  };
  for (const [d, [theme, blocs, nbRdv]] of Object.entries(attendus)) {
    const b = O.bandeauDuJour(nav, d);
    assert.equal(b.theme, theme);
    assert.deepEqual(b.blocs, blocs, `blocs ${d}`);
    assert.deepEqual(b.blocs, O.blocsDuJour(nav, d), "mêmes blocs que blocsDuJour");
    assert.equal(b.rendezVous.length, nbRdv);
    assert.equal(b.ordreHabituel, false);
    assert.deepEqual(b.bouton, { actif: false, libelle: O.LIBELLE_ORDRE_HABITUEL });
  }
  assert.deepEqual(O.bandeauDuJour(nav, MERCREDI).rendezVous, [{ heure: "09:30", libelle: "Réunion appli et IA avec Matthieu" }]);
  assert.equal(O.bandeauDuJour(nav, LUNDI).libelleDate, "Lundi 23 novembre");
  // Mode « ordre habituel aujourd'hui » : bandeau visible (règle 7), plus de blocs.
  const habituel = O.basculerOrdreHabituel(nav, MARDI);
  const b = O.bandeauDuJour(habituel, MARDI);
  assert.equal(b.ordreHabituel, true);
  assert.deepEqual(b.blocs, []);
  assert.equal(b.theme, "Chantiers à venir");
  assert.deepEqual(b.bouton, { actif: true, libelle: O.LIBELLE_RETOUR_ORGANISATION });
  // Le lendemain : expiré, blocs revenus.
  assert.deepEqual(O.bandeauDuJour(habituel, MERCREDI).blocs, ["administratif_fournisseurs"]);
  // Jour avec seulement des blocs (ni thème ni rendez-vous) : bandeau quand même.
  const seulBlocs = O.bandeauDuJour({ jours: { jeudi: { blocs: ["tournee_chantiers"] } } }, JEUDI);
  assert.equal(seulBlocs.theme, null);
  assert.deepEqual(seulBlocs.rendezVous, []);
});

test("26. liens des blocs : catalogue complet, pages existantes, filtrés par rôle", () => {
  assert.deepEqual(Object.keys(O.LIENS_BLOCS).sort(), [...O.CATALOGUE_BLOCS].sort());
  for (const [bloc, liens] of Object.entries(O.LIENS_BLOCS)) {
    assert.ok(liens.length > 0, `${bloc} : au moins un lien`);
    for (const id of liens) assert.ok(PAGES_RENOVATION.includes(id) && ALL_NAV.includes(id), `${bloc} → ${id} existe`);
  }
  assert.deepEqual(O.liensDuBloc("administratif_fournisseurs", () => true), ["rapprochement", "encours-fournisseurs"]);
  assert.deepEqual(O.liensDuBloc("tournee_chantiers", (id) => id === "alertes"), ["alertes"]);
  assert.deepEqual(O.liensDuBloc("bilan_semaine_passee", () => false), [], "page non autorisée : pas de lien");
  assert.deepEqual(O.liensDuBloc("bilan_semaine_passee", null), []);
  assert.deepEqual(O.liensDuBloc("bloc_inconnu", () => true), []);
  assert.deepEqual(O.liensDuBloc("toString", () => true), []);
  // Rôle commercial (liste par défaut) : pas de lien vers le Bilan de semaine.
  const commercial = (id) => ROLES.commercial.includes(id);
  assert.deepEqual(O.liensDuBloc("bilan_semaine_passee", commercial),
    ROLES.commercial.includes("bilan-semaine") ? ["bilan-semaine"] : []);
});

test("27. tableau de bord : bandeau et blocs AU-DESSUS des widgets actuels, tous conservés ; registre complet", () => {
  const dash = sansCommentaires(lire("src/Renovation/Dashboard.jsx"));
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  const cadre = sansCommentaires(lire("src/Renovation/blocsDuJour/CadreBloc.jsx"));
  const bandeauSrc = sansCommentaires(lire("src/Renovation/blocsDuJour/BandeauDuJour.jsx"));
  const app = sansCommentaires(lire("src/App.jsx"));
  // Une seule source : le hook partagé et le module (date via dateDuJour dans le hook).
  assert.match(dash, /const orgJour = useOrganisationDuJour\(profil\);/);
  assert.match(dash, /const bandeau = bandeauDuJour\(orgJour\.navOrder, orgJour\.date\);/);
  assert.match(dash, /const blocsJour = bandeau \? bandeau\.blocs : \[\];/);
  assert.ok(!/from\(\s*["'`]utilisateurs["'`]\s*\)\s*\.(update|insert|upsert|delete)/.test(dash), "Dashboard.jsx n'écrit pas dans utilisateurs");
  assert.ok(!/supabase/.test(registre + cadre + bandeauSrc), "blocs et bandeau : aucun accès direct à la base dans le socle");
  assert.match(dash, /onBasculer=\{orgJour\.basculerOrdreHabituel\}/, "bouton = action du hook");
  // Bureau et téléphone : bandeau puis blocs, avant les KPI et tous les widgets actuels.
  const mobile = dash.slice(dash.indexOf("if (isMobile) {"), dash.indexOf("className=\"page-padding dashboard-page\" style={{ flex:1, overflowY:\"auto\", padding:\"28px 32px\" }}"));
  const bureau = dash.slice(dash.indexOf("padding:\"28px 32px\""));
  const ordre = (src, marques) => marques.map((m) => { const i = src.indexOf(m); assert.ok(i >= 0, `présent : ${m}`); return i; });
  const im = ordre(mobile, ["<MobileHero", "<BandeauDuJour", "<BlocsDuJour", "gridTemplateColumns:\"1fr 1fr\"", "title=\"Chantiers du jour\"", "title=\"Activité équipe\"", "title=\"Mes tâches\"", "title={`Météo", "<AgendaWidget"]);
  const ib = ordre(bureau, ["<MobileHero", "<BandeauDuJour", "<BlocsDuJour", "stats.map(", "title=\"Chantiers aujourd'hui\"", "title=\"Activité équipe\"", "title=\"Mes tâches\"", "title={`Météo", "<AgendaWidget"]);
  for (const ix of [im, ib]) assert.deepEqual([...ix].sort((a, b) => a - b), ix, "ordre : hero, bandeau, blocs, puis widgets actuels");
  assert.equal((dash.match(/<BandeauDuJour /g) || []).length, 2);
  assert.equal((dash.match(/<BlocsDuJour /g) || []).length, 2);
  // Registre : une entrée par bloc du catalogue ; bloc non livré = message explicite (règle 10).
  const ids = [...registre.matchAll(/^\s{2}(\w+):\s*\{\s*icone:/gm)].map((m) => m[1]);
  assert.deepEqual([...ids].sort(), [...O.CATALOGUE_BLOCS].sort(), "registre complet");
  // Blocs livrés (tâche 6 et suivantes) : leur composant remplace « à venir ».
  assert.match(registre, /bilan_semaine_passee:\s*\{[^\n]*Composant: BlocBilanSemainePassee \}/, "tâche 6 : bloc Bilan de la semaine passée livré");
  assert.match(cadre, /export const MESSAGE_BLOC_A_VENIR = "Contenu de ce bloc : à venir dans une prochaine mise à jour\.";/);
  assert.match(cadre, /<MobileSection /, "téléphone : modèle MobileSection");
  assert.match(cadre, /summary=\{metrique\}/, "téléphone : métrique dans l'en-tête");
  assert.match(registre, /titre=\{LIBELLES_BLOCS\[id\]\}/, "titres métier");
  assert.match(registre, /liens=\{liensDuBloc\(id, pageAutorisee\)\}/, "liens filtrés par rôle");
  assert.match(bandeauSrc, /Ordre habituel aujourd'hui : menu et tableau de bord sans l'organisation du jour, jusqu'à demain\./, "mention du mode");
  assert.match(app, /<PageDashboard [^>]*pageAutorisee=\{\(id\)=>canAccess\(role,id\)\} onOuvrirPage=\{setPage\}\/>/, "liens : pages autorisées du rôle");
  // Écran « Mon organisation » : plus d'annonce « prochaine mise à jour » pour le bandeau.
  const ecran = lire("src/Renovation/MonOrganisation.jsx");
  assert.ok(!/s'afficheront en haut du tableau de bord lors d'une prochaine mise à jour/.test(ecran));
  assert.match(ecran, /La thématique et les rendez-vous du jour s'affichent en haut du tableau de bord/);
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Tableau de bord : bandeau du jour et blocs du jour en tête"/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
