// scripts/verif-autorisation-dispatcher.mjs — Clé CRON_SECRET_BASE réservée au
// dispatcher.
//
// Contexte : les 7 jobs pg_cron des notifications sur téléphone appellent
// /api/cron-dispatcher avec une clé lue dans Supabase Vault. Cette clé est
// CRON_SECRET_BASE, distincte de CRON_SECRET. Le dispatcher accepte l'une ou
// l'autre ; toutes les autres routes n'acceptent que CRON_SECRET.
//
// Couvre (données fictives, aucun réseau, aucune base) :
//   1. verifierAppelServeur avec une liste de secrets (garde partagée) ;
//   2. le dispatcher : CRON_SECRET accepté, CRON_SECRET_BASE accepté, jeton
//      faux refusé, aucun secret → route fermée ;
//   3. les autres routes (snapshots, encours fournisseurs, relevés journaliers,
//      send-email) : CRON_SECRET_BASE refusé ;
//   4. contrôles statiques : CRON_SECRET_BASE n'est lu que par le dispatcher,
//      et les appels sortants (enTetesAppelServeur) utilisent CRON_SECRET,
//      jamais le jeton reçu.
//
// Usage : node scripts/verif-autorisation-dispatcher.mjs   (après npm ci)

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => readFileSync(join(RACINE, p), "utf8");

// ── Harnais ─────────────────────────────────────────────────────────────────
let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(titre) { console.log(`\n${titre}\n${"─".repeat(titre.length)}`); }

function fauxReq({ method = "GET", auth = null, body = {}, query = {} } = {}) {
  const headers = {};
  if (auth) headers.authorization = auth;
  return { method, headers, body, query };
}
function fauxRes() {
  const r = { statusCode: 200, corps: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.corps = b; return r; };
  r.end = () => r;
  r.setHeader = () => {};
  return r;
}

// Valeurs fictives (jamais de vrai secret dans ce script).
const SECRET = "secret-fictif-cron-0123456789";
const SECRET_BASE = "secret-fictif-base-9876543210";

// Environnement contrôlé : aucune variable Supabase / Resend, donc aucun appel
// réseau possible. fetch est remplacé par un piège qui compte les appels.
for (const v of [
  "CRON_SECRET", "CRON_SECRET_BASE", "VITE_SUPABASE_URL", "SUPABASE_URL",
  "VITE_SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_KEY",
]) delete process.env[v];
let appelsReseau = 0;
globalThis.fetch = async () => { appelsReseau++; throw new Error("réseau interdit dans la vérification"); };

function avecEnv(env, fn) {
  return async () => {
    delete process.env.CRON_SECRET;
    delete process.env.CRON_SECRET_BASE;
    Object.assign(process.env, env);
    try { return await fn(); }
    finally { delete process.env.CRON_SECRET; delete process.env.CRON_SECRET_BASE; }
  };
}

async function appeler(handler, reqOpts) {
  const res = fauxRes();
  await handler(fauxReq(reqOpts), res);
  return res;
}

const serveur = require("../api/_lib/autorisationServeur.js");

// ════════════════════════════════════════════════════════════════════════════
section("1. Garde partagée — liste de secrets");
{
  const v = (auth, secrets) => serveur.verifierAppelServeur(fauxReq({ auth }), secrets);
  verifie("liste : premier secret accepté", v(`Bearer ${SECRET}`, [SECRET, SECRET_BASE]).ok === true);
  verifie("liste : second secret accepté", v(`Bearer ${SECRET_BASE}`, [SECRET, SECRET_BASE]).ok === true);
  verifie("liste : jeton faux → 401", v("Bearer faux", [SECRET, SECRET_BASE]).status === 401);
  verifie("liste : sans en-tête → 401", v(null, [SECRET, SECRET_BASE]).status === 401);
  verifie("liste : préfixe d'un secret → refusé", v(`Bearer ${SECRET_BASE.slice(0, 10)}`, [SECRET, SECRET_BASE]).ok === false);
  verifie("liste : un secret absent est ignoré, l'autre fonctionne",
    v(`Bearer ${SECRET_BASE}`, [undefined, SECRET_BASE]).ok === true);
  verifie("liste : secret vide ignoré — « Bearer » vide ne passe pas",
    v("Bearer ", ["", SECRET_BASE]).ok === false);
  verifie("liste : secrets tous absents ou vides → route fermée (500)",
    v("Bearer x", [undefined, "", null]).status === 500);
  verifie("liste vide → route fermée (500)", v("Bearer x", []).status === 500);
  verifie("liste : « Bearer undefined » avec secrets absents → fermée",
    v("Bearer undefined", [undefined, undefined]).ok === false);
  verifie("chaîne seule (comportement historique) : bon secret accepté", v(`Bearer ${SECRET}`, SECRET).ok === true);
  verifie("chaîne seule : l'autre clé refusée", v(`Bearer ${SECRET_BASE}`, SECRET).status === 401);
  verifie("chaîne seule absente → fermée (500)", v(`Bearer ${SECRET}`, undefined).status === 500);
}
await avecEnv({ CRON_SECRET: SECRET, CRON_SECRET_BASE: SECRET_BASE }, async () => {
  verifie("défaut (sans 2e argument) : lit CRON_SECRET seul — CRON_SECRET_BASE refusé",
    serveur.verifierAppelServeur(fauxReq({ auth: `Bearer ${SECRET_BASE}` })).status === 401);
  verifie("défaut : CRON_SECRET accepté",
    serveur.verifierAppelServeur(fauxReq({ auth: `Bearer ${SECRET}` })).ok === true);
  verifie("enTetesAppelServeur : utilise CRON_SECRET, pas CRON_SECRET_BASE",
    serveur.enTetesAppelServeur("cron").Authorization === `Bearer ${SECRET}`);
})();

// ════════════════════════════════════════════════════════════════════════════
section("2. Dispatcher — CRON_SECRET ou CRON_SECRET_BASE");
{
  const dispatcher = require("../api/cron-dispatcher.js");
  // Auth passée = le handler va plus loin et s'arrête sur l'absence de
  // variables Supabase (500 « Supabase env vars missing ») : aucune tâche ne
  // tourne, aucun appel réseau.
  const authPassee = (r) => r.statusCode === 500 && r.corps?.error === "Supabase env vars missing";
  const appel = (auth) => appeler(dispatcher, { auth, query: { job: "push_reportes" } });

  await avecEnv({ CRON_SECRET: SECRET, CRON_SECRET_BASE: SECRET_BASE }, async () => {
    verifie("CRON_SECRET accepté", authPassee(await appel(`Bearer ${SECRET}`)));
    verifie("CRON_SECRET_BASE accepté", authPassee(await appel(`Bearer ${SECRET_BASE}`)));
    verifie("jeton faux refusé (401)", (await appel("Bearer faux")).statusCode === 401);
    verifie("sans en-tête refusé (401)", (await appel(null)).statusCode === 401);
  })();
  await avecEnv({ CRON_SECRET_BASE: SECRET_BASE }, async () => {
    verifie("seul CRON_SECRET_BASE configuré : accepté", authPassee(await appel(`Bearer ${SECRET_BASE}`)));
    verifie("seul CRON_SECRET_BASE configuré : « Bearer undefined » refusé",
      (await appel("Bearer undefined")).statusCode === 401);
  })();
  await avecEnv({ CRON_SECRET: SECRET }, async () => {
    verifie("seul CRON_SECRET configuré : accepté", authPassee(await appel(`Bearer ${SECRET}`)));
    verifie("seul CRON_SECRET configuré : l'ancienne valeur de BASE refusée",
      (await appel(`Bearer ${SECRET_BASE}`)).statusCode === 401);
  })();
  await avecEnv({}, async () => {
    const r = await appel(`Bearer ${SECRET}`);
    verifie("aucun secret configuré → route fermée (500)", r.statusCode === 500 && r.corps?.error !== "Supabase env vars missing");
  })();
  await avecEnv({ CRON_SECRET: "", CRON_SECRET_BASE: "" }, async () => {
    verifie("secrets vides → route fermée (500), « Bearer » vide refusé",
      (await appel("Bearer ")).statusCode === 500);
  })();
}

// ════════════════════════════════════════════════════════════════════════════
section("3. Autres routes — CRON_SECRET_BASE refusé");
{
  const routes = [
    "api/cron-snapshot-hebdo.js", "api/cron-snapshot-avancement.js",
    "api/cron-encours-fournisseurs.js",
    "api/_cron/cron-rappel-rapport.js", "api/_cron/cron-recap-commandes.js",
  ];
  // releves-journaliers : la voie « cron » passe par estSecretServeur(jeton),
  // qui lit CRON_SECRET seul (la voie collaborateur exige un JWT Supabase).
  await avecEnv({ CRON_SECRET: SECRET, CRON_SECRET_BASE: SECRET_BASE }, async () => {
    verifie("api/releves-journaliers.js — voie cron : CRON_SECRET_BASE non reconnu",
      serveur.estSecretServeur(SECRET_BASE) === false && serveur.estSecretServeur(SECRET) === true);
  })();
  verifie("api/releves-journaliers.js — garde = estSecretServeur(jeton), sans liste",
    /estSecretServeur\(jeton\)/.test(lire("api/releves-journaliers.js")));
  for (const f of routes) {
    const handler = require(join(RACINE, f));
    await avecEnv({ CRON_SECRET: SECRET, CRON_SECRET_BASE: SECRET_BASE }, async () => {
      const r = await appeler(handler, { method: "GET", auth: `Bearer ${SECRET_BASE}` });
      verifie(`${f} — CRON_SECRET_BASE refusé (401)`, r.statusCode === 401, `statut ${r.statusCode}`);
    })();
    await avecEnv({ CRON_SECRET_BASE: SECRET_BASE }, async () => {
      const r = await appeler(handler, { method: "GET", auth: `Bearer ${SECRET_BASE}` });
      verifie(`${f} — seul CRON_SECRET_BASE configuré : route fermée (500)`, r.statusCode === 500, `statut ${r.statusCode}`);
    })();
  }

  // send-email : la clé BASE n'est pas reconnue comme appel serveur. Sans
  // Supabase configuré, elle ne peut pas non plus passer pour un JWT : refus,
  // et aucun mail ne part (fetch piégé).
  // Le secret serveur n'est PAS surchargé : le handler lit process.env.CRON_SECRET
  // comme en production. Seuls Resend et le journal sont simulés.
  const { creerHandler } = require("../api/send-email.js");
  delete process.env.EMAIL_AUTH_MODE;
  const envois = [];
  const sendEmail = creerHandler({
    resendKey: "re_fictif", mode: "strict", journaliser: () => {},
    fetch: async (url, init) => { envois.push(url); return { ok: true, status: 200, json: async () => ({ id: "fictif" }) }; },
  });
  const MAIL = { to: "destinataire@exemple.fr", subject: "Test", html: "<p>x</p>" };
  await avecEnv({ CRON_SECRET: SECRET, CRON_SECRET_BASE: SECRET_BASE }, async () => {
    const r = await appeler(sendEmail, { method: "POST", auth: `Bearer ${SECRET_BASE}`, body: MAIL });
    verifie("api/send-email.js — CRON_SECRET_BASE refusé (401/403), aucun envoi",
      (r.statusCode === 401 || r.statusCode === 403) && envois.length === 0, `statut ${r.statusCode}`);
    const ok = await appeler(sendEmail, { method: "POST", auth: `Bearer ${SECRET}`, body: MAIL });
    verifie("api/send-email.js — CRON_SECRET toujours accepté (envoi simulé)",
      ok.statusCode === 200 && envois.length === 1, `statut ${ok.statusCode}`);
  })();
  const email = require("../api/_lib/autorisationEmail.js");
  const deps = { cronSecret: SECRET, jwtVerifiable: true, verifierJeton: async () => null, chargerProfil: async () => null };
  const appelant = await email.identifierAppelant(fauxReq({ auth: `Bearer ${SECRET_BASE}` }), deps);
  verifie("send-email : CRON_SECRET_BASE n'est jamais identifié comme « serveur »", appelant.type !== "serveur");
  const appelantOk = await email.identifierAppelant(fauxReq({ auth: `Bearer ${SECRET}` }), deps);
  verifie("send-email : CRON_SECRET reste identifié comme « serveur »", appelantOk.type === "serveur");
}

// ════════════════════════════════════════════════════════════════════════════
section("4. Contrôles statiques");
{
  function fichiers(dossier) {
    const out = [];
    for (const n of readdirSync(join(RACINE, dossier))) {
      const p = join(dossier, n);
      if (statSync(join(RACINE, p)).isDirectory()) out.push(...fichiers(p));
      else if (/\.(c?js|mjs|ts)$/.test(n)) out.push(p);
    }
    return out;
  }
  // Lecture effective de la variable (les commentaires peuvent la nommer).
  const lecteurs = fichiers("api").filter((f) => /process\.env\s*(\.\s*CRON_SECRET_BASE|\[\s*["']CRON_SECRET_BASE["']\s*\])/.test(lire(f)));
  verifie("CRON_SECRET_BASE n'est lu que par api/cron-dispatcher.js",
    lecteurs.length === 1 && lecteurs[0].replace(/\\/g, "/") === "api/cron-dispatcher.js",
    lecteurs.join(", "));

  const dispatcher = lire("api/cron-dispatcher.js");
  verifie("dispatcher : verifierAppelServeur reçoit CRON_SECRET et CRON_SECRET_BASE",
    /verifierAppelServeur\(req,\s*\[process\.env\.CRON_SECRET,\s*process\.env\.CRON_SECRET_BASE\]\)/.test(dispatcher));

  // Aucun handler de job ne relit l'en-tête Authorization entrant pour le
  // renvoyer ailleurs : le jeton reçu ne sert qu'à la garde.
  const jobs = fichiers("api/_cron").concat(["api/cron-dispatcher.js"]);
  const relais = jobs.filter((f) => /headers\s*(\.\s*authorization|\[\s*["']authorization["']\s*\])|jetonBearer\s*\(/i.test(lire(f)));
  verifie("aucun job ne relit le jeton Authorization reçu", relais.length === 0, relais.join(", "));
  const enTetes = lire("api/_lib/autorisationServeur.js");
  verifie("enTetesAppelServeur : secret par défaut = process.env.CRON_SECRET",
    /function enTetesAppelServeur\(source, secret = process\.env\.CRON_SECRET\)/.test(enTetes));
}

verifie("aucun appel réseau pendant toute la vérification", appelsReseau === 0, `${appelsReseau} appel(s)`);

console.log(`\n${passes} vérification(s) réussie(s), ${echecs} échec(s).`);
if (echecs > 0) process.exit(1);
