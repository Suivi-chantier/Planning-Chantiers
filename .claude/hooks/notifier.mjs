// Notifications Windows — décision de Loris du 24/10/2026.
//   node notifier.mjs stop          → « Claude t'attend » (ou « Projet terminé »)
//   node notifier.mjs notification  → « Claude demande une autorisation »
// Ne bloque jamais Claude : toute erreur est ignorée.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function lireEntree() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(s)); } catch { resolve({}); }
    });
  });
}

function dernierMessage(entree) {
  if (typeof entree.last_assistant_message === "string") return entree.last_assistant_message;
  try {
    const lignes = readFileSync(entree.transcript_path, "utf8").trim().split("\n");
    for (let i = lignes.length - 1; i >= 0; i--) {
      const l = JSON.parse(lignes[i]);
      if (l.type !== "assistant") continue;
      const texte = (l.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      if (texte) return texte;
    }
  } catch { /* transcription illisible : message générique */ }
  return "";
}

function texteSimple(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function couper(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function xml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function afficher(titre, corps, origine) {
  if (process.platform !== "win32") return;
  const toast =
    `<toast><visual><binding template="ToastGeneric">` +
    `<text>${xml(titre)}</text><text>${xml(corps)}</text>` +
    `<text placement="attribution">${xml(origine)}</text>` +
    `</binding></visual></toast>`;
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml('${toast.replace(/'/g, "''")}')
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
`;
  const encode = Buffer.from(ps, "utf16le").toString("base64");
  const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encode], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  enfant.unref();
}

try {
  const mode = process.argv[2];
  const entree = await lireEntree();
  const origine = "Profero · " + path.basename(entree.cwd || process.cwd());
  if (mode === "stop") {
    const texte = texteSimple(dernierMessage(entree));
    const termine = /^projet termin[ée]/i.test(texte);
    afficher(termine ? "Projet terminé" : "Claude t'attend", couper(texte || "Réponse prête.", 200), origine);
  } else if (mode === "notification") {
    // Le rappel « en attente depuis 60 s » doublerait la notification de fin de réponse.
    if (entree.notification_type === "idle_prompt" || /waiting for your input/i.test(entree.message || "")) process.exit(0);
    afficher("Claude demande une autorisation", couper(entree.message || "Une autorisation est nécessaire.", 200), origine);
  }
} catch { /* une notification ratée ne doit jamais bloquer Claude */ }
process.exit(0);
