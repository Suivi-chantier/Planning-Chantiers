// Vérifie le lot 5 de la Refonte Opérations : Opérations devient la porte
// d'entrée (onglets par statut calculé, « Sans chantier » visible), la liste
// Chantiers sort du menu, tous les liens « ouvrir le chantier » passent par un
// seul chemin et gardent l'accès à la fiche, fil d'Ariane Opération › Chantier,
// accès par rôle (« operations » partout où « chantiers »), espace ouvrier
// inchangé. Aucun réseau, aucune base : données fictives construites ici
// (exemple issu des tests, données fictives), plus lecture des sources.
//   node scripts/verif-refonte-lot5.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONGLETS_OPERATIONS, ONGLET_OPERATIONS_DEFAUT, repartirOperationsParOnglet, ongletInitialOperations,
  PAGES_HORS_MENU, estPageDuMenu, pageDestination, filArianeChantier, ajouterOperationsAuxRoles,
} from "../src/Renovation/navigationOperations.mjs";
import { STATUTS_OPERATION } from "../src/Renovation/statutsChantier.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ─── 1. Module pur ──────────────────────────────────────────────────────────
test("1. module pur (ni Supabase, ni horloge, ni navigateur) et façade .js", () => {
  const s = sansCommentaires(lire("src/Renovation/navigationOperations.mjs"));
  assert.ok(!/supabase/i.test(s), "aucun accès Supabase");
  assert.ok(!/Date\.now\s*\(|new Date\(/.test(s), "aucune horloge");
  assert.ok(!/localStorage|window\.|document\./.test(s), "aucun effet de bord navigateur");
  assert.match(lire("src/Renovation/navigationOperations.js"), /export \* from "\.\/navigationOperations\.mjs"/);
});

// ─── 2. Onglets par statut calculé ──────────────────────────────────────────
test("2. onglets À l'étude · En cours · Terminées · Perdues · Sans chantier, un par statut calculé", () => {
  assert.deepEqual(ONGLETS_OPERATIONS.map((o) => o.label), ["À l'étude", "En cours", "Terminées", "Perdues", "Sans chantier"]);
  // Chaque statut que statutOperation() peut rendre a son onglet : aucune opération ne peut disparaître.
  assert.deepEqual(ONGLETS_OPERATIONS.map((o) => o.id).sort(), Object.keys(STATUTS_OPERATION).sort());
  assert.equal(ONGLET_OPERATIONS_DEFAUT, "en_cours");
});

test("3. répartition : chaque opération dans un seul onglet, cas mixtes du lot 2, archivés ignorés", () => {
  // exemple issu des tests, données fictives
  const ops = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id, nom: `OP ${id}` }));
  const ch = [
    { id: "a1", operation_id: "A", statut: "a_l_etude" }, { id: "a2", operation_id: "A", statut: "perdu" },
    { id: "b1", operation_id: "B", statut: "a_l_etude" }, { id: "b2", operation_id: "B", statut: "en_cours" },
    { id: "c1", operation_id: "C", statut: "termine" },   { id: "c2", operation_id: "C", statut: "perdu" },
    { id: "d1", operation_id: "D", statut: "perdu" },
    // E : aucun chantier ; F : seulement un chantier archivé → « Sans chantier »
    { id: "f1", operation_id: "F", statut: "en_cours", archive_le: "2026-11-01" },
    { id: "g1", operation_id: "G", statut: null },          // sans statut = actif
  ];
  const r = repartirOperationsParOnglet(ops, ch);
  const ids = (k) => r.parOnglet[k].map((o) => o.id);
  assert.deepEqual(ids("a_l_etude"), ["A"]);
  assert.deepEqual(ids("en_cours"), ["B", "G"]);
  assert.deepEqual(ids("terminee"), ["C"]);
  assert.deepEqual(ids("perdue"), ["D"]);
  assert.deepEqual(ids("vide"), ["E", "F"]);
  const total = Object.values(r.compteurs).reduce((s, x) => s + x, 0);
  assert.equal(total, ops.length, "aucune opération perdue ni comptée deux fois");
  assert.deepEqual(repartirOperationsParOnglet(null, null).compteurs, { a_l_etude: 0, en_cours: 0, terminee: 0, perdue: 0, vide: 0 });
});

test("4. onglet initial : demandé si valide, sinon En cours s'il est rempli, sinon le premier non vide", () => {
  assert.equal(ongletInitialOperations({ en_cours: 3, perdue: 1 }, "perdue"), "perdue");
  assert.equal(ongletInitialOperations({ en_cours: 3 }, "inconnu"), "en_cours");
  assert.equal(ongletInitialOperations({ en_cours: 0, terminee: 2, vide: 1 }), "terminee");
  assert.equal(ongletInitialOperations({}), "en_cours", "rien du tout : onglet En cours, qui écrit lui-même « Aucune opération en cours »");
  assert.ok(ONGLETS_OPERATIONS.every((o) => /^Aucune opération/.test(o.vide)), "un onglet vide le dit");
});

// ─── 3. Menu sans « Chantiers » ─────────────────────────────────────────────
test("5. menu : la liste Chantiers est retirée (bureau et mobile), Opérations reste", () => {
  assert.deepEqual([...PAGES_HORS_MENU], ["chantiers"]);
  assert.equal(estPageDuMenu("chantiers"), false);
  assert.equal(estPageDuMenu("operations"), true);
  const nav = lire("src/Renovation/Navigation.jsx");
  assert.match(nav, /import \{ estPageDuMenu \} from "\.\/navigationOperations\.js"/);
  assert.match(nav, /const allowedItems = ALL_NAV_ITEMS\.filter\(n => allowed\.includes\(n\.id\) && estPageDuMenu\(n\.id\)\)/, "barre mobile");
  assert.match(nav, /const allowedNav = allNav\.filter\(n => allowed\.includes\(n\.id\) && estPageDuMenu\(n\.id\)\)/, "menu latéral");
  // Opérations juste après le tableau de bord dans les deux listes.
  for (const liste of ["ALL_NAV_ITEMS", "allNav"]) {
    const bloc = nav.match(new RegExp(`const ${liste} = \\[([\\s\\S]*?)\\n\\];`))[1];
    const ids = [...bloc.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids.slice(0, 2), ["dashboard", "operations"], `${liste} : Opérations en 2e position`);
    assert.ok(ids.includes("chantiers"), `${liste} : libellé de l'onglet de la fiche conservé`);
  }
  const app = lire("src/App.jsx");
  assert.match(app, /PAGES_RENOVATION\.map\(p => p\.id\)\.filter\(estPageDuMenu\)\.find/, "jamais la liste Chantiers comme page d'arrivée");
  assert.match(app, /onOuvrirPage=\{\(id\)=>setPage\(pageDestination\(id,\(p\)=>canAccess\(role,p\)\)\)\}/, "journal des MAJ : « Chantiers » mène à Opérations");
  assert.equal(pageDestination("chantiers", () => true), "operations");
  assert.equal(pageDestination("chantiers", (p) => p !== "operations"), "chantiers", "sans accès à Opérations : on ne perd pas ses chantiers");
  assert.equal(pageDestination("planning", () => true), "planning");
});

// ─── 4. Liens d'ouverture de la fiche ───────────────────────────────────────
test("6. liens « ouvrir le chantier » : un seul chemin, la fiche reste servie sous « chantiers »", () => {
  const app = sansCommentaires(lire("src/App.jsx"));
  const ouvertures = app.match(/setPage\("chantiers"\)/g) || [];
  assert.equal(ouvertures.length, 1, "setPage(\"chantiers\") seulement dans ouvrirFicheChantier");
  assert.match(app, /const ouvrirFicheChantier = \(chantierId\) => \{\s*setChantierToOpen\(chantierId\);\s*setPage\("chantiers"\);\s*\};/);
  assert.match(app, /<PageNotesOuvriers [^>]*onOuvrirChantier=\{\(id\)=>ouvrirFicheChantier\(id\)\}/, "Notes des ouvriers");
  assert.match(app, /<PageAlertes [^>]*onOuvrirChantier=\{\(a\)=>ouvrirFicheChantier\(a\.chantierId\)\}/, "Alertes");
  assert.match(app, /<PageOperations [^>]*onOpenChantier=\{canAccess\(role,"chantiers"\) \? ouvrirFicheChantier : null\}/, "Opérations");
  assert.match(app, /\{p==="chantiers"\s+&& \(canAccess\(role,"chantiers"\)\s+\? <PageChantiers [^\n]*initialSelectedId=\{actif\?chantierToOpen:null\}[^\n]*onOuvrirOperation=\{canAccess\(role,"operations"\) \? ouvrirOperation : null\}/, "fiche chantier toujours servie");
  // Aucun autre écran ne navigue seul vers « chantiers ».
  for (const f of ["src/Renovation/PageOperations.jsx", "src/Renovation/PageAlertes.jsx", "src/Renovation/PageNotesOuvriers.jsx", "src/Renovation/SyntheseCycleVieOperation.jsx"]) {
    assert.ok(!/setPage\(\s*["']chantiers["']\s*\)/.test(lire(f)), f);
  }
});

test("7. fiche Opération : liste des chantiers avec mini-frise, clic = fiche chantier", () => {
  const ops = lire("src/Renovation/PageOperations.jsx");
  assert.match(ops, /<SyntheseCycleVieOperation [^>]*onOpenChantier=\{onOpenChantier\}/);
  assert.match(ops, /ONGLETS_OPERATIONS\.map/, "onglets affichés");
  assert.match(ops, /repartition\.statutParOperation\[op\.id\]\?\.statut \|\| "vide"\) === ongletActif/, "grille filtrée par onglet");
  for (const onglet of ['"synthese"', '"chemin-de-fer"', '"planifier"']) assert.ok(ops.includes(onglet), `onglet actuel ${onglet} conservé`);
  assert.match(ops, /<OperationCommercial /, "en-tête client / chargé d'affaires conservé");
  const syn = lire("src/Renovation/SyntheseCycleVieOperation.jsx");
  assert.match(syn, /onClick=\{onOpenChantier \? \(\) => onOpenChantier\(c\.id\) : undefined\}/);
  assert.match(syn, /resumeCycleVieChantier\(/, "mini-frise = module du lot 3");
  assert.match(syn, /frise indisponible/, "étapes illisibles : la liste reste, la frise le dit");
});

test("8. fil d'Ariane Opérations › Opération › Chantier, retour à l'opération", () => {
  // exemple issu des tests, données fictives
  const f = filArianeChantier({ id: "c1", nom: "T2 - R+1", operation_id: "op1" }, [{ id: "op1", nom: "IMMEUBLE TEST" }]);
  assert.deepEqual(f, { operationId: "op1", operationNom: "IMMEUBLE TEST", operationConnue: true, chantierNom: "T2 - R+1", texte: "Opérations › IMMEUBLE TEST › T2 - R+1" });
  assert.equal(filArianeChantier({ id: "c1", nom: "X", operation_id: "op9" }, []).operationNom, "Opération introuvable", "impossibilité visible");
  assert.equal(filArianeChantier({ id: "c1", nom: "X" }, []).operationNom, "Sans opération");
  const page = lire("src/Renovation/PageChantiers.jsx");
  assert.match(page, /filArianeChantier\(selectedChantier, cvD\.operations \|\| \[\]\)/);
  assert.match(page, /aria-label="Fil d'Ariane"/);
  assert.match(page, /if \(onOuvrirOperation && selectedChantier\?\.operation_id\) \{ onOuvrirOperation\(selectedChantier\.operation_id\); return; \}/, "Retour → l'opération");
  const app = lire("src/App.jsx");
  assert.match(app, /setOperationToOpen\(\{ id: operationId \|\| null \}\);\s*setPage\("operations"\);/);
  assert.match(app, /operationDemandee=\{actif\?operationToOpen:null\} onOperationConsumed=\{\(\)=>setOperationToOpen\(null\)\}/);
});

// ─── 5. Accès par rôle ──────────────────────────────────────────────────────
test("9. accès par défaut (src/access.js) : tout rôle qui a « chantiers » a « operations »", () => {
  const src = lire("src/access.js");
  const bloc = src.match(/export const ROLE_PAGES_DEFAULT_RENOVATION = \{([\s\S]*?)\n\};/)[1];
  const roles = {};
  for (const m of bloc.matchAll(/(\w+): \[([\s\S]*?)\]/g)) roles[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(Object.keys(roles).sort(), ["admin", "commercial", "comptable", "conducteur", "ouvrier"]);
  for (const [role, pages] of Object.entries(roles)) {
    if (pages.includes("chantiers")) assert.ok(pages.includes("operations"), `${role} : operations`);
  }
  assert.ok(roles.admin.includes("chantiers") && roles.admin.includes("operations"), "admin : fiche + Opérations (auto-grant)");
  assert.deepEqual(roles.ouvrier, ["ouvrier-dashboard", "ouvrier-planning", "ouvrier-chantiers", "ouvrier-compte-rendu", "ouvrier-demande-commande", "ouvrier-notes"], "ouvrier inchangé");
  assert.match(src, /\{ id: "chantiers",\s+label: "Fiche chantier \(via Opérations\)" \}/, "identifiant « chantiers » gardé pour la fiche");
  // L'attribution automatique admin est toujours en fin de loadAccessConfig.
  assert.match(src, /const adminMissing = adminDefault\.filter\(\(p\) => !adminSaved\.includes\(p\)\);/);
  const nav = lire("src/Renovation/Navigation.jsx");
  const repli = nav.match(/const ROLE_PAGES = \{([\s\S]*?)\n\};/)[1];
  for (const m of repli.matchAll(/(\w+): \[([\s\S]*?)\]/g)) {
    if (m[2].includes('"chantiers"')) assert.ok(m[2].includes('"operations"'), `repli du menu ${m[1]} : operations`);
  }
});

test("10. configuration en base : ajout de « operations » sans rien retirer (forme du 06/11/2026)", () => {
  // exemple issu des tests, données fictives : forme de planning_config.access_pages_renovation
  // (rôles réels, listes raccourcies). La vraie ligne avant / après est dans le compte rendu.
  const avant = {
    admin: ["dashboard", "chantiers", "admin"], super_admin: ["dashboard", "chantiers"],
    conducteur: ["chantiers", "planning"], comptable: ["chantiers", "etats-financiers"],
    commercial: ["dashboard", "chantiers"], ouvrier: [], role_sans_chantiers: ["planning"], deja: ["chantiers", "operations"],
  };
  const { apres, ajouts } = ajouterOperationsAuxRoles(avant);
  assert.deepEqual(ajouts.sort(), ["admin", "commercial", "comptable", "conducteur", "super_admin"]);
  for (const [role, pages] of Object.entries(avant)) {
    assert.deepEqual(apres[role].slice(0, pages.length), pages, `${role} : rien retiré, ordre gardé`);
    assert.ok(apres[role].length - pages.length <= 1);
  }
  assert.deepEqual(apres.ouvrier, []);
  assert.deepEqual(apres.role_sans_chantiers, ["planning"]);
  assert.deepEqual(apres.deja, ["chantiers", "operations"]);
  assert.deepEqual(avant.admin, ["dashboard", "chantiers", "admin"], "entrée non modifiée");
  assert.deepEqual(ajouterOperationsAuxRoles(apres).ajouts, [], "idempotent");
});

test("11. scripts SQL : sauvegarde datée, aucune suppression, retour arrière ciblé", () => {
  const sql = lire("sql/202611_refonte_operations_lot5_acces.sql").replace(/--[^\n]*/g, "").toLowerCase();
  assert.match(sql, /insert into public\.planning_config_sauvegarde_refonte/);
  assert.ok(sql.indexOf("insert into public.planning_config_sauvegarde_refonte") < sql.indexOf("update public.planning_config "), "sauvegarde avant modification");
  assert.match(sql, /where pc\.key = 'access_pages_renovation'/);
  assert.match(sql, /r\.pages \|\| '\["operations"\]'::jsonb/);
  const retour = lire("sql/202611_refonte_operations_lot5_acces_rollback.sql").replace(/--[^\n]*/g, "").toLowerCase();
  assert.match(retour, /r\.pages - 'operations'/);
  for (const s of [sql, retour]) {
    assert.ok(!/\bdelete\s+from\b|\bdrop\s+|\btruncate\b|\bcreate\s+policy\b|\balter\s+policy\b|security\s+definer|\bgrant\b|\brevoke\b/.test(s), "ni suppression, ni policy, ni fonction, ni droit");
  }
});

// ─── 6. Espace ouvrier ──────────────────────────────────────────────────────
test("12. espace ouvrier : accès direct à ses chantiers, inchangé", () => {
  const app = lire("src/App.jsx");
  assert.match(app, /if \(p\?\.role === "ouvrier"\) return "ouvrier";/, "un ouvrier est routé vers son espace");
  assert.match(app, /<EspaceOuvrier user=\{user\} profil=\{profil\} onLogout=\{handleLogout\} \/>/);
  const eo = lire("src/Renovation/EspaceOuvrier.jsx");
  assert.match(eo, /\{ id: "chantiers",\s+label: "Opérations", icon: Layers,\s+titre: "Les opérations" \}/, "onglet chantiers de l'espace ouvrier");
  assert.match(eo, /tab === "chantiers"\s+&& <OuvrierChantiers /);
  assert.ok(!/navigationOperations/.test(eo), "l'espace ouvrier n'utilise pas la navigation bureau");
});

console.log(`\n${n} vérifications « Refonte Opérations, lot 5 » réussies.`);
