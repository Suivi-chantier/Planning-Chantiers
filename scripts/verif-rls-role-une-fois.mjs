// Vérifie la migration 20261109165323 (règles « réservé au bureau » : rôle
// vérifié une fois par requête, plus une fois par ligne) et garde la règle
// pour l'avenir.
//
// Contrôles sur les FICHIERS du dépôt (aucune base, aucune donnée) :
//   1. la migration ne fait QUE réécrire des règles existantes (ALTER POLICY),
//      toutes vers `(select not public.est_ouvrier())` — aucune création,
//      suppression, droit accordé ou retiré, ni fonction ;
//   2. le retour arrière touche exactement les mêmes règles ;
//   3. aucune migration POSTÉRIEURE ne réintroduit `not est_ouvrier()` nu
//      dans un `using (...)` ou `with check (...)` (recalculé à chaque ligne).
//
// La preuve sur les vraies données (60 tables × 5 rôles, 0 différence de
// lignes visibles) a été faite sur la base avant application, dans une
// transaction annulée : voir l'en-tête de la migration.
//
//   node scripts/verif-rls-role-une-fois.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };

const VERSION = "20261109165323";
const MIGRATION = `supabase/migrations/${VERSION}_rls_bureau_role_verifie_une_fois.sql`;
const ROLLBACK = "sql/202611_rls_bureau_role_verifie_une_fois_rollback.sql";
const sansCommentaires = (s) => s.split("\n").filter(l => !l.trim().startsWith("--") && l.trim()).join("\n");
const RE_ALTER = /^alter policy ("[^"]+"|[a-z_][a-z0-9_]*) on public\.([a-z_][a-z0-9_]*)( using \((.+?)\))?( with check \((.+?)\))?;$/;

const lignes = (fichier) => sansCommentaires(lire(fichier)).split("\n");
const cle = (l) => { const m = RE_ALTER.exec(l); return m && `${m[1]}|${m[2]}|${m[3] ? "U" : ""}${m[5] ? "W" : ""}`; };

// 1. Migration : uniquement des ALTER POLICY vers la forme « une fois ».
{
  const L = lignes(MIGRATION);
  ok(L.length === 71, `71 règles réécrites (trouvé ${L.length})`);
  L.forEach(l => {
    const m = RE_ALTER.exec(l);
    ok(!!m, `instruction attendue : alter policy … (${l.slice(0, 80)})`);
    ok(!!(m[3] || m[5]), `using ou with check présent (${l.slice(0, 80)})`);
    if (m[3]) ok(m[4] === "(select not public.est_ouvrier())", `using une fois par requête (${m[2]})`);
    if (m[5]) ok(m[6] === "(select not public.est_ouvrier())", `with check une fois par requête (${m[2]})`);
  });
  const texte = sansCommentaires(lire(MIGRATION)).toLowerCase();
  ["create ", "drop ", "grant ", "revoke ", "security definer", "profero_collaborateurs_seulement", "delete ", "update ", "insert "]
    .forEach(mot => ok(!texte.includes(mot), `migration sans « ${mot.trim()} »`));
  ok(new Set(L.map(l => RE_ALTER.exec(l)[2])).size === 60, "60 tables concernées");
}

// 2. Retour arrière : mêmes règles, écriture d'origine.
{
  const M = lignes(MIGRATION).map(cle).sort();
  const R = lignes(ROLLBACK);
  ok(JSON.stringify(R.map(cle).sort()) === JSON.stringify(M), "retour arrière : exactement les mêmes règles");
  R.forEach(l => {
    const m = RE_ALTER.exec(l);
    if (m[3]) ok(m[4] === "not public.est_ouvrier()", `retour arrière : using d'origine (${m[2]})`);
    if (m[5]) ok(m[6] === "not public.est_ouvrier()", `retour arrière : with check d'origine (${m[2]})`);
  });
}

// 3. Garde : pas de `not est_ouvrier()` nu dans les migrations suivantes.
{
  const nu = /(using|check)\s*\(\s*not\s+(public\.)?est_ouvrier\s*\(\s*\)\s*\)/i;
  readdirSync(join(racine, "supabase/migrations"))
    .filter(f => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) > VERSION)
    .forEach(f => ok(!nu.test(sansCommentaires(lire(`supabase/migrations/${f}`))),
      `${f} : écrire (select not public.est_ouvrier()), pas not est_ouvrier() (recalculé à chaque ligne)`));
}

console.log(`verif-rls-role-une-fois : OK (${nb} contrôles)`);
