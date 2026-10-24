// Garde SQL (PreToolUse) — décision de Loris du 24/10/2026.
// Requête directe sur la base (MCP execute_sql, `supabase db query`, psql) :
//   - lecture seule            → autorisée sans demander ;
//   - suppression (DROP, TRUNCATE, DELETE) → refusée : passer par une migration vérifiée ;
//   - toute autre écriture     → demandée à Loris.
// Les migrations (apply_migration) ne passent pas ici : CLAUDE.md décide.

const SUPPRESSION = /\b(drop|truncate|delete)\b/;
const ECRITURE =
  /\b(insert|update|upsert|merge|alter|create|grant|revoke|comment|copy|call|do|vacuum|reindex|cluster|refresh|lock|set|reset|execute|perform|security\s+label)\b/;

function lireEntree() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(s)); } catch { resolve({}); }
    });
  });
}

// Retire commentaires, chaînes et blocs $$…$$ : seuls les mots-clés comptent.
function nettoyerSql(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .toLowerCase();
}

function decider(decision, raison) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: raison,
    },
  }));
  process.exit(0);
}

const entree = await lireEntree();
const outil = entree.tool_name || "";
let texte;
if (outil.endsWith("__execute_sql")) {
  texte = nettoyerSql(String(entree.tool_input?.query ?? ""));
} else if (outil === "Bash" || outil === "PowerShell") {
  const cmd = String(entree.tool_input?.command ?? "");
  if (!/supabase\s+db\s+query|\bpsql\b/i.test(cmd)) process.exit(0);
  // Le SQL est dans des guillemets shell : on lit la commande telle quelle.
  texte = cmd.toLowerCase();
} else {
  process.exit(0);
}

if (SUPPRESSION.test(texte)) {
  decider("deny",
    "Suppression de données ou de tables hors migration : interdite (réglage du 24/10/2026). Passer par une migration vérifiée selon CLAUDE.md.");
}
if (ECRITURE.test(texte)) {
  decider("ask", "Requête directe qui écrit dans la base : accord de Loris nécessaire.");
}
decider("allow", "Requête en lecture seule.");
