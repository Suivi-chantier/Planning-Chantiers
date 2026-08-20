// scripts/diag-mail-invest.mjs — Diagnostic des canaux d'envoi Profero Invest.
//
// Éprouve les DEUX canaux du projet et dit lequel convient à quoi :
//
//   • /api/send-email (Resend) — utilisé par tous les crons : récap commandes,
//     rappel rapport, encours fournisseurs, et la veille d'échéances Invest.
//     C'est le canal des envois périodiques, qui ne se rattachent à aucune
//     ligne métier.
//
//   • Edge Function `send-mission-email` (Gmail, og@groupe-profero.com) —
//     le bouton « Mail » du CRM. Elle EXIGE un actionId : c'est une
//     notification attachée à une action de mission précise.
//
// Ce script existe parce que j'ai supposé, deux fois de suite et sans vérifier,
// que ces canaux étaient interchangeables. Ils ne le sont pas.
//
// L'Edge Function n'est pas dans le dépôt, seulement déployée : son contrat ne
// peut être qu'éprouvé, pas lu. Et un cron qui échoue tourne à 4h du matin sans
// témoin — « aucun mail » y est indiscernable de « rien à signaler ».
//
// Usage :
//   node scripts/diag-mail-invest.mjs                  → test à blanc (payloads seuls)
//   node scripts/diag-mail-invest.mjs vous@exemple.fr  → envoi réel sur les deux canaux
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

// ── Canal 1 : /api/send-email (Resend) — celui de la veille ───────────────
console.log("\n1 · /api/send-email (Resend) — canal des crons");
console.log("─".repeat(52));

const APP = "https://planning-chantiers.vercel.app";
let resendOk = false;
try {
  const resp = await fetch(`${APP}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: destinataire,
      subject: "[Profero Invest] Diagnostic — canal Resend",
      html: payload.htmlBody,
    }),
  });
  const corps = await resp.json().catch(() => ({}));
  if (resp.ok && corps?.ok) {
    resendOk = true;
    console.log(`  ✓ accepté (id ${corps.id})`);
  } else {
    console.log(`  ✗ ÉCHEC ${resp.status} : ${corps?.error || JSON.stringify(corps)}`);
    if (corps?.details) console.log(`    détail : ${JSON.stringify(corps.details)}`);
  }
} catch (e) {
  console.log(`  ✗ ÉCHEC réseau : ${e.message}`);
}

// ── Canal 2 : Edge Function send-mission-email — celui du CRM ─────────────
console.log("\n2 · send-mission-email (Gmail) — canal du CRM");
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

let edgeOk = false;
if (error || data?.error) {
  const msg = (await detail(error)) || data?.error;
  console.log(`  ✗ REFUSÉ : ${msg}`);
  if (/actionid/i.test(String(msg))) {
    console.log("    → attendu : cette fonction notifie UNE action de mission,");
    console.log("      qu'elle relit en base. Elle ne convient pas à un envoi");
    console.log("      périodique dont les lignes viennent de cinq tables.");
  }
} else {
  edgeOk = true;
  console.log(`  ✓ accepté : ${JSON.stringify(data)}`);
}

// ── Verdict ───────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(52));
if (resendOk) {
  console.log(`✓ La veille quotidienne peut délivrer ses alertes.`);
  console.log(`  Vérifiez la réception sur ${destinataire}.`);
  if (!edgeOk) {
    console.log("\n  L'Edge Function refuse le payload de la veille : c'est le");
    console.log("  comportement attendu, elle sert les notifications d'action");
    console.log("  du CRM. Les deux canaux ne sont pas interchangeables.");
  }
  process.exit(0);
}
console.log("✗ Le canal de la veille est HORS SERVICE.");
console.log("  Les alertes d'échéance ne partiront pas. Vérifier RESEND_KEY");
console.log("  et RESEND_FROM dans les variables d'environnement Vercel.");
process.exit(1);
