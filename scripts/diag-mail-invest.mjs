// scripts/diag-mail-invest.mjs — Diagnostic du canal d'envoi Profero Invest.
//
// Appelle la VRAIE Edge Function `send-mission-email` avec le payload exact de
// la veille quotidienne, et rapporte ce qui se passe.
//
// Pourquoi ce script : la fonction n'est pas dans le dépôt, seulement déployée.
// Son contrat est inféré des appelants du CRM. Deux inconnues restent, et
// aucune ne se voit avant l'envoi réel :
//
//   1. La veille omet `actionId` et `clientId` — une ligne d'échéance ne se
//      rattache pas à une action unique. Si la fonction les exige, l'envoi
//      échoue.
//   2. Le cron s'authentifie avec la clé de service, pas avec une session
//      utilisateur. Si la fonction attend un JWT d'utilisateur, elle refuse.
//
// Découvrir ça à 4h du matin, c'est découvrir « aucun mail » — indiscernable
// de « rien à signaler ». D'où ce script, à lancer AVANT de compter dessus.
//
// Usage :
//   node scripts/diag-mail-invest.mjs                  → test à blanc (payload seul)
//   node scripts/diag-mail-invest.mjs vous@exemple.fr  → envoi réel à cette adresse
//
// ⚠ Avec une adresse en argument, un VRAI e-mail part. Sans argument, rien
//   n'est envoyé : le script se contente d'afficher ce qu'il enverrait.
//
// Lit VITE_SUPABASE_URL et la clé dans .env / ID.env, comme les autres scripts
// verif-*. Préfère SUPABASE_SERVICE_ROLE_KEY si présente : c'est elle que le
// cron utilisera en production, donc c'est elle qu'il faut éprouver.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function lireEnv() {
  const env = {};
  for (const f of ["../.env", "../ID.env"]) {
    try {
      for (const ligne of readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/)) {
        const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* fichier absent : on continue */ }
  }
  return { ...env, ...process.env };
}

const env = lireEnv();
const url = env.VITE_SUPABASE_URL;
const cleService = env.SUPABASE_SERVICE_ROLE_KEY;
const cleAnon = env.VITE_SUPABASE_KEY;
const cle = cleService || cleAnon;

console.log("Diagnostic du canal d'envoi Invest");
console.log("═".repeat(52));

if (!url || !cle) {
  console.log("✗ VITE_SUPABASE_URL ou clé absente de .env / ID.env.");
  process.exit(1);
}

console.log(`  projet Supabase : ${url}`);
console.log(`  clé utilisée    : ${cleService ? "service_role (comme le cron)" : "anon (⚠ le cron utilisera service_role)"}`);

const destinataire = process.argv[2] || null;
const APP_URL = "https://planning-chantiers.vercel.app";

// Exactement le payload de la veille (cron-invest-echeances.js).
const payload = {
  to: destinataire || "test@exemple.invalid",
  subject: "[Profero Invest] Diagnostic du canal d'envoi",
  body: "Ceci est un test du canal d'envoi de la veille quotidienne.\n\nSi vous lisez ce message, la veille pourra délivrer ses alertes.",
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
    <div style="background:#12151b;padding:20px;border-radius:8px 8px 0 0;border-bottom:3px solid #4070e8">
      <div style="color:#7ba4f7;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">Profero Invest · Diagnostic</div>
      <div style="color:#fff;font-size:18px;font-weight:800;margin-top:6px">Canal d'envoi opérationnel</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 8px 8px;padding:20px;color:#1a1f2e">
      <p style="margin:0;font-size:14px">Si vous lisez ce message, la veille quotidienne pourra délivrer ses alertes d'échéance.</p>
    </div>
  </div>`,
  responsable: "",
  clientName: "Veille Profero Invest",
  senderEmail: "og@groupe-profero.com",
  fromEmail: "og@groupe-profero.com",
  actionUrl: APP_URL,
  notificationType: "invest_veille_echeances",
};

console.log("\nPayload (identique à celui de la veille)");
console.log("─".repeat(52));
for (const [k, v] of Object.entries(payload)) {
  const apercu = typeof v === "string" && v.length > 60 ? v.slice(0, 57) + "…" : v;
  console.log(`  ${k.padEnd(16)} ${JSON.stringify(apercu)}`);
}
console.log("\n  Champs volontairement ABSENTS : actionId, clientId");
console.log("  (une ligne de veille ne se rattache pas à une action unique)");

if (!destinataire) {
  console.log("\n" + "═".repeat(52));
  console.log("Test à blanc : aucun e-mail envoyé.");
  console.log("Pour éprouver le canal pour de bon :");
  console.log("  node scripts/diag-mail-invest.mjs votre.adresse@groupe-profero.com");
  process.exit(0);
}

console.log("\nAppel de send-mission-email…");
console.log("─".repeat(52));

const supabase = createClient(url, cle, { auth: { persistSession: false } });
const { data, error } = await supabase.functions.invoke("send-mission-email", { body: payload });

// Le message utile d'une Edge Function est dans le corps de la réponse, pas
// dans error.message qui dit seulement « non-2xx status code ».
async function detail(err) {
  if (err?.context && typeof err.context.text === "function") {
    try {
      const brut = await err.context.text();
      if (brut) {
        try { const p = JSON.parse(brut); return p?.error || p?.message || p?.hint || brut; }
        catch { return brut; }
      }
    } catch { /* corps illisible */ }
  }
  return err?.message || String(err);
}

if (error || data?.error) {
  const msg = (await detail(error)) || data?.error;
  console.log(`  ✗ ÉCHEC : ${msg}`);
  console.log("\n" + "═".repeat(52));
  console.log("La veille ne pourra pas délivrer ses alertes en l'état.");
  console.log("\nCauses les plus probables, dans l'ordre :");
  console.log("  • la fonction exige actionId / clientId, que la veille n'a pas");
  console.log("  • elle attend un JWT d'utilisateur, pas la clé de service");
  console.log("  • le compte Gmail d'automatisation a perdu son autorisation");
  console.log("\nLe message ci-dessus vient de la fonction elle-même : il tranche.");
  process.exit(1);
}

console.log("  ✓ Acceptée par la fonction.");
console.log(`  réponse : ${JSON.stringify(data)}`);
console.log("\n" + "═".repeat(52));
console.log(`✓ Canal opérationnel. Vérifiez la réception sur ${destinataire}.`);
console.log("  La veille quotidienne pourra délivrer ses alertes.");
