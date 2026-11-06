// Vérifie le lot 6 de la Refonte Opérations : rôle « Chargé d'affaires »
// (charge_affaires). Pages du rôle (Opérations, fiche chantier, Chiffrage,
// Journal des MAJ), absence des pages financières globales et de
// l'administration, étapes du cycle de vie validables (Étude et Contrat
// seulement, à l'écran ET en base), rôle reconnu collaborateur et jamais
// traité comme un ouvrier, libellé dans les écrans, scripts SQL avec
// sauvegarde et retour arrière. Aucun réseau, aucune base : lecture des
// sources et données fictives construites ici (exemple issu des tests,
// données fictives).
//   node scripts/verif-refonte-lot6.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROLE_CHARGE_AFFAIRES, LIBELLE_CHARGE_AFFAIRES, PAGES_CHARGE_AFFAIRES, PAGES_INTERDITES_CHARGE_AFFAIRES,
  PHASES_VALIDABLES_CHARGE_AFFAIRES, ETAPES_VALIDABLES_CHARGE_AFFAIRES,
  peutValiderEtape, peutValiderPhase, peutDeclarerPhase, messageLectureSeule, estRoleCycleVieRestreint,
  estCollaborateurProposable, ajouterRoleChargeAffaires, ajouterRoleAListe,
} from "../src/Renovation/roleChargeAffaires.mjs";
import { CYCLE_VIE_PHASES, CYCLE_VIE_ETAPES } from "../src/Renovation/cycleVie.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const sansCommentairesSql = (s) => s.replace(/--[^\n]*/g, "");
const listeJs = (texte) => [...texte.matchAll(/"([^"]+)"/g)].map((x) => x[1]);

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

const PAGES_ATTENDUES = ["operations", "chantiers", "info-client", "journal-maj"];
const PAGES_FINANCE_ADMIN = ["etats-financiers", "bilan-semaine", "encours-fournisseurs", "rapprochement", "heures-salaries", "dashboard-analyse", "admin"];

// ─── 1. Module pur ──────────────────────────────────────────────────────────
test("1. module pur (ni Supabase, ni horloge, ni navigateur) et façade .js", () => {
  const s = sansCommentaires(lire("src/Renovation/roleChargeAffaires.mjs"));
  assert.ok(!/supabase/i.test(s), "aucun accès Supabase");
  assert.ok(!/Date\.now\s*\(|new Date\(/.test(s), "aucune horloge");
  assert.ok(!/localStorage|window\.|document\./.test(s), "aucun effet de bord navigateur");
  assert.match(lire("src/Renovation/roleChargeAffaires.js"), /export \* from "\.\/roleChargeAffaires\.mjs"/);
  assert.equal(ROLE_CHARGE_AFFAIRES, "charge_affaires");
  assert.notEqual(ROLE_CHARGE_AFFAIRES, "chantiers", "identifiant de rôle distinct de l'identifiant de page");
  assert.equal(LIBELLE_CHARGE_AFFAIRES, "Chargé d'affaires");
});

// ─── 2. Pages du rôle ───────────────────────────────────────────────────────
test("2. pages du rôle : Opérations, fiche chantier, Chiffrage, Journal des MAJ — rien d'autre", () => {
  assert.deepEqual([...PAGES_CHARGE_AFFAIRES], PAGES_ATTENDUES);
  const src = lire("src/access.js");
  const bloc = src.match(/export const ROLE_PAGES_DEFAULT_RENOVATION = \{([\s\S]*?)\n\};/)[1];
  const m = bloc.match(/charge_affaires: \[([\s\S]*?)\]/);
  assert.ok(m, "charge_affaires dans ROLE_PAGES_DEFAULT_RENOVATION");
  assert.deepEqual(listeJs(m[1]), PAGES_ATTENDUES, "liste par défaut = module");
  // Chaque page existe dans PAGES_RENOVATION.
  const pagesConnues = listeJs(src.match(/export const PAGES_RENOVATION = \[([\s\S]*?)\n\];/)[1].replace(/label:\s*"[^"]*"/g, ""));
  for (const p of PAGES_ATTENDUES) assert.ok(pagesConnues.includes(p), `page connue : ${p}`);
  // Repli du menu (Navigation.jsx) : sans entrée, le menu retomberait sur celui de l'admin.
  const nav = lire("src/Renovation/Navigation.jsx");
  const repli = nav.match(/const ROLE_PAGES = \{([\s\S]*?)\n\};/)[1].match(/charge_affaires: \[([\s\S]*?)\]/);
  assert.ok(repli, "charge_affaires dans le repli ROLE_PAGES du menu");
  assert.deepEqual(listeJs(repli[1]), PAGES_ATTENDUES, "repli du menu = module");
  // Configuration en base : le script ajoute exactement cette liste.
  const sql = sansCommentairesSql(lire("sql/202611_refonte_operations_lot6_acces.sql"));
  const enBase = sql.match(/'\{"charge_affaires": \[([^\]]*)\]\}'::jsonb/);
  assert.ok(enBase, "pages ajoutées en base");
  assert.deepEqual(listeJs(enBase[1]), PAGES_ATTENDUES, "liste en base = module");
});

test("3. aucune page financière globale ni d'administration", () => {
  for (const p of PAGES_FINANCE_ADMIN) {
    assert.ok(PAGES_INTERDITES_CHARGE_AFFAIRES.includes(p), `interdite : ${p}`);
    assert.ok(!PAGES_CHARGE_AFFAIRES.includes(p), `absente : ${p}`);
  }
  // Ni tableau de bord, ni planning, ni bibliothèques (modifiables pour tous).
  for (const p of ["dashboard", "planning", "bibliotheque", "biblio-materiaux", "phasage-v2", "commandes", "validation"]) {
    assert.ok(!PAGES_CHARGE_AFFAIRES.includes(p), `absente : ${p}`);
  }
  // Le bouton « Ouvrir les Réglages » de la page Opérations n'est donné qu'à qui a « admin ».
  assert.match(lire("src/App.jsx"), /onOuvrirAdmin=\{canAccess\(role,"admin"\) \? \(\)=>setPage\("admin"\) : null\}/);
});

// ─── 3. Rôle déclaré et affiché ─────────────────────────────────────────────
test("4. rôle déclaré (Réglages → Utilisateurs / Accès) avec le libellé « Chargé d'affaires »", () => {
  const src = lire("src/access.js");
  const roles = src.match(/export const ROLES_DEFAULT_RENOVATION = \[([\s\S]*?)\n\];/)[1];
  assert.match(roles, /\{ id: "charge_affaires", label: "Chargé d'affaires",\s+color: "#14b8a6" \}/);
  assert.match(roles, /id: "ouvrier"/, "ouvrier toujours déclaré");
  const app = lire("src/App.jsx");
  assert.equal((app.match(/charge_affaires:\s*"Chargé d'affaires"/g) || []).length, 2, "libellé (portail + barre du haut)");
  assert.match(lire("src/Renovation/Navigation.jsx"), /charge_affaires:"Chargé d'affaires"/);
  const admin = lire("src/Renovation/Admin.jsx");
  assert.match(admin, /\{ value:"charge_affaires", label:"Chargé d'affaires" \}/, "proposé avant chargement de la liste");
  assert.ok((admin.match(/charge_affaires:"Chargé d'affaires"/g) || []).length >= 2, "libellés de l'écran Utilisateurs");
  // Liste des rôles en base : ajout en fin de liste, rien retiré.
  const { apres, ajoute } = ajouterRoleAListe([{ id: "admin" }, { id: "ouvrier" }]);
  assert.ok(ajoute);
  assert.deepEqual(apres.map((r) => r.id), ["admin", "ouvrier", "charge_affaires"]);
  assert.equal(apres[2].label, "Chargé d'affaires");
  assert.equal(ajouterRoleAListe(apres).ajoute, false, "idempotent");
});

test("5. configuration en base : ajout du rôle sans rien retirer aux autres (forme du 06/11/2026)", () => {
  // exemple issu des tests, données fictives : forme de planning_config.access_pages_renovation
  // (rôles réels, listes raccourcies). La vraie ligne avant / après est dans le compte rendu.
  const avant = {
    admin: ["dashboard", "chantiers", "admin", "operations"], super_admin: ["dashboard", "chantiers", "operations"],
    conducteur: ["chantiers", "planning", "operations"], comptable: ["chantiers", "etats-financiers", "operations"],
    commercial: ["dashboard", "chantiers", "operations"], ouvrier: [],
  };
  const { apres, ajoute } = ajouterRoleChargeAffaires(avant);
  assert.ok(ajoute);
  for (const [role, pages] of Object.entries(avant)) assert.deepEqual(apres[role], pages, `${role} inchangé`);
  assert.deepEqual(apres.charge_affaires, PAGES_ATTENDUES);
  assert.deepEqual(Object.keys(apres).sort(), [...Object.keys(avant), "charge_affaires"].sort());
  assert.equal(ajouterRoleChargeAffaires(apres).ajoute, false, "idempotent");
  assert.ok(!("charge_affaires" in avant), "entrée non modifiée");
});

// ─── 4. Étapes du cycle de vie ──────────────────────────────────────────────
test("6. étapes validables : Étude et Contrat seulement pour le chargé d'affaires", () => {
  assert.deepEqual([...PHASES_VALIDABLES_CHARGE_AFFAIRES], ["cv_etude", "cv_contrat"]);
  const attendues = CYCLE_VIE_ETAPES.filter((e) => ["cv_etude", "cv_contrat"].includes(e.phaseId)).map((e) => e.id);
  assert.deepEqual([...ETAPES_VALIDABLES_CHARGE_AFFAIRES], attendues);
  for (const e of CYCLE_VIE_ETAPES) {
    const ok = ["cv_etude", "cv_contrat"].includes(e.phaseId);
    assert.equal(peutValiderEtape({ role: "charge_affaires", etapeId: e.id }), ok, `${e.id} (${e.phaseId})`);
    assert.equal(peutValiderEtape({ role: "charge_affaires", etapeId: e.id, phaseId: e.phaseId }), ok, `${e.id} avec phase`);
    for (const r of ["admin", "super_admin", "conducteur", "commercial", "comptable"]) {
      assert.equal(peutValiderEtape({ role: r, etapeId: e.id }), true, `${r} : ${e.id} inchangé`);
    }
    assert.equal(peutValiderEtape({ role: "ouvrier", etapeId: e.id }), false, `ouvrier : ${e.id}`);
  }
  for (const ph of CYCLE_VIE_PHASES) {
    assert.equal(peutValiderPhase({ role: "charge_affaires", phaseId: ph.id }), ["cv_etude", "cv_contrat"].includes(ph.id), ph.id);
  }
  // Groupe d'exécution (phase Travaux, identifiant dynamique) ou étape inconnue : lecture seule.
  assert.equal(peutValiderEtape({ role: "charge_affaires", etapeId: "grp_123" }), false);
  assert.equal(peutValiderEtape({ role: "charge_affaires", etapeId: "grp_123", phaseId: "cv_travaux" }), false);
  assert.equal(peutValiderEtape({ role: "charge_affaires" }), false);
  assert.equal(peutValiderEtape({ role: "Charge_Affaires ", etapeId: "devis_signe" }), true, "rôle normalisé");
  assert.equal(peutValiderEtape({ role: "", etapeId: "devis_signe" }), false, "sans rôle : rien");
  // Déclarer la phase à la main : fermé au chargé d'affaires.
  assert.equal(peutDeclarerPhase("charge_affaires"), false);
  for (const r of ["admin", "conducteur", "commercial", "comptable"]) assert.equal(peutDeclarerPhase(r), true, r);
  assert.equal(peutDeclarerPhase("ouvrier"), false);
  // Message de lecture seule : présent sur Préparation, absent sur Étude / pour les autres rôles.
  assert.match(messageLectureSeule({ role: "charge_affaires", phaseId: "cv_preparation" }), /Lecture seule .* Étude et Contrat/);
  assert.equal(messageLectureSeule({ role: "charge_affaires", phaseId: "cv_etude" }), null);
  assert.equal(messageLectureSeule({ role: "conducteur", phaseId: "cv_preparation" }), null);
  assert.ok(estRoleCycleVieRestreint("charge_affaires") && !estRoleCycleVieRestreint("commercial"));
});

test("7. fiche chantier : la frise applique la règle (boutons d'étape et déclaration de phase)", () => {
  const page = sansCommentaires(lire("src/Renovation/PageChantiers.jsx"));
  assert.match(page, /import \{ peutValiderPhase, peutDeclarerPhase, messageLectureSeule \} from "\.\/roleChargeAffaires";/);
  assert.match(page, /const peutModifier = !!peutModifierBase && peutDeclarerPhase\(role\);/);
  assert.match(page, /const peutModifierEtapes = !!peutModifierBase && peutValiderPhase\(\{ role, phaseId: phaseVueId \}\);/);
  assert.match(page, /<EtapeCycleVie key=\{e\.id\} etape=\{e\} peutModifier=\{peutModifierEtapes\}/);
  assert.match(page, /role=\{profil\?\.role \|\| "commercial"\} onDeclarer=\{declarerPhaseCV\}/, "même rôle par défaut que App.jsx");
  assert.match(lire("src/App.jsx"), /const role=profil\?\.role\|\|"commercial";/);
});

test("8. base : policies restrictives limitées aux étapes Étude et Contrat, retour arrière", () => {
  const fichiers = readdirSync(join(racine, "supabase/migrations")).filter((f) => /_refonte_operations_lot6\.sql$/.test(f));
  assert.equal(fichiers.length, 1, "une migration lot 6");
  const sql = sansCommentairesSql(lire(`supabase/migrations/${fichiers[0]}`)).toLowerCase();
  assert.equal((sql.match(/create policy/g) || []).length, 2);
  assert.equal((sql.match(/as restrictive/g) || []).length, 2, "restrictives (ET avec l'existant)");
  assert.equal((sql.match(/on public\.chantier_cycle_vie/g) || []).length, 2);
  assert.match(sql, /for insert/);
  assert.match(sql, /for update/);
  assert.ok(!/for all|for select|for delete/.test(sql), "lecture non touchée");
  assert.ok(!/\bdrop\b|\bdelete\b|\btruncate\b|\balter\b|\bgrant\b|\brevoke\b|security\s+definer|create\s+(or\s+replace\s+)?function|\bupdate\s+public\./.test(sql),
    "ni suppression, ni fonction, ni droit, ni donnée");
  assert.equal((sql.match(/\(select public\.mon_role\(\)\) is distinct from 'charge_affaires'/g) || []).length, 3, "insert + using + with check");
  // Chaque liste d'étapes de la migration ⊆ Étude + Contrat (sinon : droit de trop → échec).
  const listes = [...sql.matchAll(/etape_id = any \(array\[([\s\S]*?)\]::text\[\]\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.equal(listes.length, 3);
  for (const l of listes) {
    for (const id of l) assert.ok(ETAPES_VALIDABLES_CHARGE_AFFAIRES.includes(id), `étape hors Étude/Contrat en base : ${id}`);
    assert.ok(!l.includes("_phase_declaree"), "déclaration de phase fermée");
    const manquantes = ETAPES_VALIDABLES_CHARGE_AFFAIRES.filter((id) => !l.includes(id));
    // Étape ajoutée à Étude/Contrat dans cycleVie.mjs sans mise à jour de la policy :
    // le chargé d'affaires verrait un refus d'enregistrement (visible), jamais un droit de trop.
    if (manquantes.length) console.warn(`  ATTENTION : étapes Étude/Contrat absentes de la policy (à ajouter par migration) : ${manquantes.join(", ")}`);
  }
  const retour = sansCommentairesSql(lire("sql/202611_refonte_operations_lot6_rollback.sql")).toLowerCase();
  assert.match(retour, /drop policy if exists "cycle vie charge affaires etude contrat ajout" on public\.chantier_cycle_vie/);
  assert.match(retour, /drop policy if exists "cycle vie charge affaires etude contrat modification" on public\.chantier_cycle_vie/);
  assert.equal((retour.match(/drop /g) || []).length, 2, "ne retire que ces deux policies");
  assert.ok(!/\bdelete\b|\btruncate\b|\bupdate\b/.test(retour));
});

// ─── 5. Collaborateur, jamais ouvrier ───────────────────────────────────────
test("9. collaborateur actif, jamais traité comme un ouvrier", () => {
  // est_collaborateur_actif() ne regarde pas le rôle : fiche active suffit.
  const m = lire("supabase/migrations/20261001150000_profero_collaborateurs_seulement.sql")
    .match(/create or replace function public\.est_collaborateur_actif\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/);
  assert.ok(m, "définition trouvée");
  assert.ok(!/\brole\b/.test(m[1]), "aucune condition sur le rôle");
  // est_ouvrier() = rôle exactement « ouvrier » (définition versionnée).
  const o = lire("sql/202609_helpers_role_faille_profil_absent.sql").match(/create or replace function public\.est_ouvrier\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/);
  assert.ok(o && /= 'ouvrier'/.test(o[1]), "est_ouvrier compare à 'ouvrier'");
  // Aucune migration du lot 6 ne modifie ces fonctions.
  for (const f of readdirSync(join(racine, "supabase/migrations")).filter((x) => /lot6/.test(x))) {
    assert.ok(!/est_collaborateur_actif|est_ouvrier|invest_dossier_etapes/.test(sansCommentairesSql(lire(`supabase/migrations/${f}`))), f);
  }
  // Liste des chargés d'affaires proposés (lot 2) : actifs hors ouvriers, ce rôle compris.
  assert.equal(estCollaborateurProposable({ role: "charge_affaires", actif: true }), true);
  assert.equal(estCollaborateurProposable({ role: "commercial", actif: true }), true);
  assert.equal(estCollaborateurProposable({ role: "ouvrier", actif: true }), false);
  assert.equal(estCollaborateurProposable({ role: "charge_affaires", actif: false }), false);
  assert.equal(estCollaborateurProposable(null), false);
  assert.match(lire("src/Renovation/clientsDonnees.js"), /\.filter\(estCollaborateurProposable\)/);
  // L'espace ouvrier n'est routé que pour le rôle « ouvrier ».
  assert.match(lire("src/App.jsx"), /if \(p\?\.role === "ouvrier"\) return "ouvrier";/);
});

test("10. scripts SQL d'accès : sauvegarde avant modification, rien retiré, retour arrière ciblé", () => {
  const sql = sansCommentairesSql(lire("sql/202611_refonte_operations_lot6_acces.sql")).toLowerCase();
  const iSauv = sql.indexOf("insert into public.planning_config_sauvegarde_refonte");
  assert.ok(iSauv >= 0, "sauvegarde");
  assert.ok(iSauv < sql.indexOf("update public.planning_config "), "sauvegarde avant modification");
  assert.match(sql, /'lot6 : avant ajout du rôle charge_affaires \(06\/11\/2026\)'/);
  assert.match(sql, /pc\.value \|\| '\{"charge_affaires"/, "ajout d'une clé, les autres rôles intacts");
  assert.match(sql, /and not \(pc\.value \? 'charge_affaires'\)/, "idempotent");
  const retour = sansCommentairesSql(lire("sql/202611_refonte_operations_lot6_acces_rollback.sql")).toLowerCase();
  assert.match(retour, /set value = value - 'charge_affaires'/);
  assert.match(retour, /is distinct from 'charge_affaires'/);
  for (const s of [sql, retour]) {
    assert.ok(!/\bdelete\s+from\b|\bdrop\s+|\btruncate\b|\bcreate\s+policy\b|\balter\s+policy\b|security\s+definer|\bgrant\b|\brevoke\b/.test(s), "ni suppression, ni policy, ni fonction, ni droit");
    assert.ok(!/update public\.utilisateurs/.test(s), "aucun rôle attribué à un utilisateur");
  }
});

test("11. journal des MAJ : entrée du lot 6", () => {
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Nouveau rôle « Chargé d'affaires »/);
});

console.log(`\n${n} tests OK`);
