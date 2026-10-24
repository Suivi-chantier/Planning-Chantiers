// Garde des clés secrètes (PreToolUse) — décision de Loris du 24/10/2026.
// Le dépôt est public : refuse d'écrire une clé secrète dans un fichier, et
// refuse un enregistrement (git commit) dont les lignes ajoutées en contiennent.
// La clé « anon » de Supabase est publique par conception : elle passe.

import { execFileSync } from "node:child_process";
import path from "node:path";

const MOTIFS = [
  ["clé secrète Supabase", /\bsb_secret_[\w-]{10,}/],
  ["clé Anthropic", /\bsk-ant-[\w-]{20,}/],
  ["jeton GitHub", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["clé privée", new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----")],
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["clé Stripe", /\b[sr]k_live_[0-9a-zA-Z]{20,}/],
  ["jeton Slack", /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ["mot de passe de base dans une adresse", /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{6,}@/],
];

function lireEntree() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(s)); } catch { resolve({}); }
    });
  });
}

// Un JWT n'est secret que si son rôle n'est pas « anon » (service_role, jeton d'utilisateur…).
function jwtSecret(texte) {
  for (const m of texte.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{10,}/g)) {
    try {
      const charge = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (charge.role !== "anon") return `jeton Supabase (rôle ${charge.role ?? "inconnu"})`;
    } catch { /* pas un JWT lisible */ }
  }
  return null;
}

function trouverSecret(texte) {
  for (const [nom, motif] of MOTIFS) if (motif.test(texte)) return nom;
  return jwtSecret(texte);
}

function refuser(raison) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: raison,
    },
  }));
  process.exit(0);
}

const entree = await lireEntree();
const outil = entree.tool_name || "";
const input = entree.tool_input || {};

if (outil === "Write" || outil === "Edit") {
  const fichier = path.basename(String(input.file_path || ""));
  // Les fichiers .env et les réglages personnels ne sont pas versionnés.
  if (/^\.env/.test(fichier) || fichier === "settings.local.json") process.exit(0);
  const trouve = trouverSecret(String(input.content ?? input.new_string ?? ""));
  if (trouve) refuser(`Écriture refusée : ${trouve} détecté(e) dans ${fichier}. Le dépôt est public ; garder les secrets dans .env ou les secrets Supabase/Vercel.`);
  process.exit(0);
}

if (outil === "Bash" || outil === "PowerShell") {
  const cmd = String(input.command || "");
  if (!/\bgit\b[^\n]*\bcommit\b/.test(cmd)) process.exit(0);
  // Dossier de l'enregistrement : `git -C <dossier>` ou `cd <dossier> &&`, sinon le dossier courant.
  const m = cmd.match(/git\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/) || cmd.match(/\bcd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)/);
  const brut = m ? (m[2] || m[3] || m[4]) : (entree.cwd || process.cwd());
  // Git Bash écrit /c/Users/… ; git.exe attend C:/Users/…
  const dossier = brut.replace(/^\/([a-zA-Z])\//, "$1:/");
  let diff = "";
  try {
    diff = execFileSync("git", ["-C", dossier, "diff", "--cached", "-U0", "--no-color"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch { process.exit(0); }
  const ajouts = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
  const trouve = trouverSecret(ajouts);
  if (trouve) refuser(`Enregistrement refusé : ${trouve} dans les modifications préparées. Le dépôt est public ; retirer la clé avant d'enregistrer.`);
}
process.exit(0);
