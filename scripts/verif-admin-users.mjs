#!/usr/bin/env node
// Vérifie que la fonction admin-users est fermée par défaut.
//
// Deux parties :
//   1. les décisions de supabase/functions/admin-users/autorisation.mjs,
//      exécutées pour de vrai (module pur, importé tel quel) ;
//   2. l'analyse statique de index.ts : l'appelant est contrôlé AVANT toute
//      action, aucune suppression de compte, aucun secret par défaut.
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-admin-users.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACTIONS_AUTORISEES, decisionAppelant, extraireJeton, validerDemande,
} from "../supabase/functions/admin-users/autorisation.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const INDEX = lire("supabase/functions/admin-users/index.ts");
const CONFIG = lire("supabase/config.toml");
const sansCommentaires = (src) => src.split("\n")
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
  .join("\n");
const CODE = sansCommentaires(INDEX);

// ═══════════════════════════════════════════════════════════════════════════
// 1. DÉCISIONS — exécutées
// ═══════════════════════════════════════════════════════════════════════════

test("1. jeton : seul « Bearer <jeton> » est reconnu", () => {
  assert.equal(extraireJeton("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extraireJeton("bearer abc"), "abc");
  assert.equal(extraireJeton(null), null);
  assert.equal(extraireJeton(""), null);
  assert.equal(extraireJeton("Bearer "), null);
  assert.equal(extraireJeton("Bearer undefined x"), null, "deux mots : refusé");
  assert.equal(extraireJeton("abc"), null, "sans Bearer : refusé");
});

test("2. appelant inconnu (clé publique, jeton invalide) : 401", () => {
  for (const appelant of [null, undefined, {}, { email: "" }, { email: "  " }]) {
    const d = decisionAppelant({ appelant, profil: { role: "admin", actif: true } });
    assert.equal(d.autorise, false);
    assert.equal(d.statut, 401);
  }
  assert.equal(decisionAppelant().statut, 401, "aucun paramètre : refusé");
});

test("3. appelant réel non admin, sans profil ou désactivé : 403", () => {
  const appelant = { email: "x@exemple.fr" };
  for (const profil of [
    null,
    {},
    { role: "commercial", actif: true },
    { role: "comptable", actif: true },
    { role: "ouvrier", actif: true },
    { role: "super_admin", actif: true },
    { role: "Admin", actif: true },
    { role: "admin", actif: false },
  ]) {
    const d = decisionAppelant({ appelant, profil });
    assert.equal(d.autorise, false, JSON.stringify(profil));
    assert.equal(d.statut, 403);
  }
});

test("4. admin actif : autorisé (actif absent = actif, comme admin-users-local)", () => {
  const appelant = { email: "x@exemple.fr" };
  assert.equal(decisionAppelant({ appelant, profil: { role: "admin", actif: true } }).autorise, true);
  assert.equal(decisionAppelant({ appelant, profil: { role: "admin" } }).autorise, true);
});

test("5. demandes : seules invite et reset_password, email valide", () => {
  assert.deepEqual([...ACTIONS_AUTORISEES], ["invite", "reset_password"]);
  for (const action of ["delete", "DELETE", "create_local", "set_password", "", undefined]) {
    const r = validerDemande({ action, email: "a@b.fr", userId: "u" });
    assert.equal(r.ok, false, String(action));
    assert.equal(r.statut, 400);
  }
  assert.equal(validerDemande(null).ok, false);
  assert.equal(validerDemande({ action: "invite" }).ok, false, "email manquant");
  assert.equal(validerDemande({ action: "invite", email: "pas-un-email" }).ok, false);
  assert.equal(validerDemande({ action: "invite", email: "jean@profero.local" }).ok, false,
    "comptes sans email : réservés à admin-users-local");
  assert.deepEqual(validerDemande({ action: "invite", email: "  Jean@Exemple.FR " }),
    { ok: true, action: "invite", email: "jean@exemple.fr" });
  assert.equal(validerDemande({ action: "reset_password", email: "a@b.fr" }).ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. index.ts — analyse statique
// ═══════════════════════════════════════════════════════════════════════════

test("6. aucune suppression de compte possible", () => {
  assert.ok(!/deleteUser/.test(CODE), "deleteUser absent");
  assert.ok(!/["']delete["']/.test(CODE), "action delete absente");
  assert.ok(!/userId/.test(CODE), "plus aucun identifiant de compte lu dans la demande");
});

test("7. l'appelant est contrôlé AVANT de lire la demande et d'agir", () => {
  const iJeton = CODE.indexOf("extraireJeton(");
  const iUser = CODE.indexOf("auth.getUser(");
  const iDecision = CODE.indexOf("decisionAppelant(");
  const iRefus = CODE.indexOf("if (!decision.autorise)");
  const iCorps = CODE.indexOf("req.json(");
  const iInvite = CODE.indexOf("inviteUserByEmail(");
  const iLien = CODE.indexOf("generateLink(");
  for (const [nom, i] of Object.entries({ iJeton, iUser, iDecision, iRefus, iCorps, iInvite, iLien })) {
    assert.ok(i > 0, `${nom} présent`);
  }
  assert.ok(iJeton < iUser && iUser < iDecision && iDecision < iRefus, "ordre du contrôle");
  assert.ok(iRefus < iCorps, "corps lu seulement après autorisation");
  assert.ok(iRefus < iInvite && iRefus < iLien, "actions seulement après autorisation");
  assert.equal(CODE.match(/req\.json\(/g).length, 1, "une seule lecture du corps");
});

test("8. le profil est lu dans utilisateurs, par l'email de l'appelant", () => {
  assert.match(CODE, /\.from\("utilisateurs"\)\s*\.select\("role, actif"\)\s*\.eq\("email", appelant\.email\.toLowerCase\(\)\)/);
  assert.match(CODE, /from "\.\/autorisation\.mjs"/, "décisions importées du module testé");
});

test("9. secrets absents : 500, jamais d'ouverture ; Verify JWT déclaré", () => {
  assert.ok(!/Deno\.env\.get\([^)]*\)!/.test(CODE), "aucune assertion non nulle sur un secret");
  assert.match(CODE, /if \(!url \|\| !cle\) return json\([^)]*\}, 500\)/);
  assert.match(CONFIG, /\[functions\.admin-users\]\s*\nverify_jwt = true/);
});

test("10. la réponse d'invitation ne renvoie plus l'objet utilisateur complet", () => {
  assert.ok(!/user: data\.user\b/.test(CODE));
  assert.match(CODE, /json\(\{ ok: true, user_id: data\.user\?\.id \}\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
