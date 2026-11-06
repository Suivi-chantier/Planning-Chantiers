// Garde SQL (PreToolUse) — décisions de Loris du 24/10/2026 et du 06/11/2026.
// Requête directe sur la base (MCP execute_sql, `supabase db query`, psql) :
//   - lecture et écriture      → autorisées sans demander (décision du 06/11/2026,
//                                pour laisser Claude travailler en autonomie) ;
//   - suppression (DROP, TRUNCATE, DELETE) → refusée : passer par une migration vérifiée ;
//   - sauf essai dans une transaction annulée (BEGIN … ROLLBACK, sans COMMIT) :
//     autorisé, rien n'est écrit (c'est l'essai que CLAUDE.md exige avant une
//     migration qui supprime).
// Les migrations (apply_migration) ne passent pas ici : CLAUDE.md décide.
//
// Le connecteur Supabase porte un nom différent selon l'endroit où tourne
// Claude Code (mcp__claude_ai_Supabase__… sur le PC, mcp__Supabase__… dans
// l'application / le web) : on reconnaît l'outil par la fin de son nom.

const SUPPRESSION = /\b(drop|truncate|delete)\b/;
// Ce qui ferait sortir de la transaction annulée ou écrire hors d'elle.
const SORTIE_TRANSACTION = /^(commit|end|prepare\s+transaction|commit\s+prepared)\b/;
const HORS_TRANSACTION = /\b(dblink\w*|vacuum|concurrently)\b/;

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

function instructions(texte) {
  return texte.split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

// BEGIN … ROLLBACK : la première instruction ouvre la transaction, la dernière
// l'annule entièrement (pas « rollback to savepoint »), aucune ne la valide.
function transactionAnnulee(liste) {
  if (liste.length < 2) return false;
  const premiere = liste[0];
  const derniere = liste[liste.length - 1];
  if (!/^(begin|start transaction)\b/.test(premiere)) return false;
  if (!/^(rollback|abort)( work| transaction)?$/.test(derniere)) return false;
  return !liste.some((s) => SORTIE_TRANSACTION.test(s) || HORS_TRANSACTION.test(s));
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
let sqlSeul = false;
if (/supabase__execute_sql$/i.test(outil)) {
  texte = nettoyerSql(String(entree.tool_input?.query ?? ""));
  sqlSeul = true;
} else if (outil === "Bash" || outil === "PowerShell") {
  const cmd = String(entree.tool_input?.command ?? "");
  if (!/supabase\s+db\s+query|\bpsql\b/i.test(cmd)) process.exit(0);
  // Le SQL est dans des guillemets shell : on lit la commande telle quelle.
  texte = cmd.toLowerCase();
} else {
  process.exit(0);
}

if (sqlSeul && transactionAnnulee(instructions(texte))) {
  decider("allow", "Essai dans une transaction annulée (BEGIN … ROLLBACK) : rien n'est écrit.");
}
if (SUPPRESSION.test(texte)) {
  decider("deny",
    "Suppression de données ou de tables hors migration : interdite (réglage du 24/10/2026). Passer par une migration vérifiée selon CLAUDE.md, ou l'essayer dans BEGIN … ROLLBACK.");
}
decider("allow", "Requête directe sans suppression : autorisée (réglage du 06/11/2026).");
