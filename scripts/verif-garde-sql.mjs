// Vérifie la garde SQL de Claude Code (.claude/hooks/garde-sql.mjs) et son
// branchement dans .claude/settings.json. Aucun réseau, aucune base :
// on envoie au hook des requêtes fictives et on lit sa décision.
//   node scripts/verif-garde-sql.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../.claude/hooks/garde-sql.mjs", import.meta.url));
const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));

function decision(tool_name, tool_input) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return "aucune";
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

const NOMS = ["mcp__claude_ai_Supabase__execute_sql", "mcp__Supabase__execute_sql"];
const sql = (query) => NOMS.map((outil) => decision(outil, { project_id: "x", query }));

test("1. lecture autorisée sous les deux noms du connecteur", () => {
  assert.deepEqual(sql("select id, nom from chantiers"), ["allow", "allow"]);
});
test("2. colonne « comment » : pas de faux blocage", () => {
  assert.deepEqual(sql("select comment from t where comment is not null"), ["allow", "allow"]);
});
test("3. écriture directe autorisée (décision du 06/11/2026)", () => {
  assert.deepEqual(sql("update chantiers set nom = 'x' where id = 1"), ["allow", "allow"]);
  assert.deepEqual(sql("insert into t(a) values (1)"), ["allow", "allow"]);
});
test("4. suppression hors migration refusée", () => {
  assert.deepEqual(sql("delete from chantiers where id = 1"), ["deny", "deny"]);
  assert.deepEqual(sql("drop table t"), ["deny", "deny"]);
  assert.deepEqual(sql("truncate t"), ["deny", "deny"]);
});
test("5. essai de suppression dans une transaction annulée autorisé", () => {
  assert.deepEqual(sql("begin; delete from t where id = 1; select count(*) from t; rollback;"), ["allow", "allow"]);
});
test("6. transaction validée ou incomplète : la suppression reste refusée", () => {
  assert.deepEqual(sql("begin; delete from t; commit;"), ["deny", "deny"]);
  assert.deepEqual(sql("begin; delete from t; end;"), ["deny", "deny"]);
  assert.deepEqual(sql("begin; delete from t; commit; begin; rollback;"), ["deny", "deny"]);
  assert.deepEqual(sql("begin; savepoint s; delete from t; rollback to savepoint s;"), ["deny", "deny"]);
  assert.deepEqual(sql("delete from t; rollback;"), ["deny", "deny"]);
  assert.deepEqual(sql("begin; select dblink_exec('x'); delete from t; rollback;"), ["deny", "deny"]);
});
test("7. mots cachés dans chaînes et commentaires ignorés", () => {
  assert.deepEqual(sql("select 'drop table' as a -- delete\n from t"), ["allow", "allow"]);
});
test("8. psql / supabase db query en ligne de commande", () => {
  assert.equal(decision("Bash", { command: "psql -c 'drop table t'" }), "deny");
  assert.equal(decision("PowerShell", { command: "supabase db query \"select 1\"" }), "allow");
  assert.equal(decision("Bash", { command: "ls -la" }), "aucune");
});
test("9. branchement : le hook couvre les deux noms du connecteur", () => {
  const m = settings.hooks.PreToolUse.find((h) => h.hooks.some((c) => c.command.includes("garde-sql.mjs")));
  assert.ok(m, "hook garde-sql branché");
  for (const nom of NOMS) assert.ok(new RegExp(`^(?:${m.matcher})$`).test(nom), `matcher couvre ${nom}`);
});
test("10. autorisations et interdictions présentes sous les deux noms", () => {
  const { allow, deny } = settings.permissions;
  for (const liste of [allow, deny]) {
    for (const r of liste.filter((x) => x.startsWith("mcp__claude_ai_Supabase__"))) {
      assert.ok(liste.includes(r.replace("mcp__claude_ai_Supabase__", "mcp__Supabase__")), `jumeau de ${r}`);
    }
  }
  assert.ok(deny.includes("mcp__Supabase__pause_project"));
});
console.log(`${n} tests passés`);
