// scripts/verif-send-email.mjs — Vérification du Chantier 1.0 (sécurité).
//
// Couvre :
//   1. la garde serveur (CRON_SECRET) — fermée par défaut ;
//   2. l'autorisation de /api/send-email — les trois profils d'appelant ;
//   3. le handler de bout en bout contre un FAUX Resend et un FAUX Supabase :
//      aucun réseau, aucun mail réellement expédié ;
//   4. le mode observation — rien n'est bloqué, les refus sont journalisés,
//      et le journal ne contient aucun contenu de mail ;
//   5. les routes cron — fermées quand le secret manque ;
//   6. des contrôles statiques qui empêchent de rouvrir la porte en silence :
//      un `fetch("/api/send-email")` direct, un cron sans en-tête, une
//      fonction Vercel de trop, la liste blanche recopiée ;
//   7. la liste d'exclusion du service worker (PWA).
//
// Usage :  node scripts/verif-send-email.mjs
//          (après `npm run build` pour que la section 7 lise dist/sw.js)

import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => readFileSync(join(RACINE, p), "utf8");

const serveur = require("../api/_lib/autorisationServeur.js");
const email = require("../api/_lib/autorisationEmail.js");
const { creerHandler } = require("../api/send-email.js");

// ── Petit harnais d'assertions ──────────────────────────────────────────────
let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(titre) { console.log(`\n${titre}\n${"─".repeat(titre.length)}`); }

// ── Faux objets req / res ───────────────────────────────────────────────────
function fauxReq({ method = "POST", auth = null, body = {}, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) h.authorization = auth;
  return { method, headers: h, body };
}
function fauxRes() {
  const r = { statusCode: 200, corps: null, entetes: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.corps = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.entetes[k.toLowerCase()] = v; };
  return r;
}

// ── Faux environnement du handler ───────────────────────────────────────────
const SECRET = "secret-de-test-0123456789";
const COMPTES = {
  "jwt-collab":   { email: "camille@groupe-profero.com" },
  "jwt-ouvrier":  { email: "ouvrier@profero.local" },
  "jwt-orphelin": { email: "inconnu@gmail.com" },
  "jwt-inactif":  { email: "ancien@groupe-profero.com" },
};
const PROFILS = {
  "camille@groupe-profero.com": { role: "admin", actif: true },
  "ouvrier@profero.local":      { role: "ouvrier", actif: true },
  "ancien@groupe-profero.com":  { role: "commercial", actif: false },
};

function environnement(surcharges = {}) {
  const envois = [];
  const journal = [];
  const deps = {
    cronSecret: SECRET,
    jwtVerifiable: true,
    verifierJeton: async (jwt) => COMPTES[jwt] || null,
    chargerProfil: async (e) => PROFILS[e] || null,
    resendKey: "re_test",
    expediteur: "Profero <noreply@groupe-profero.com>",
    mode: "strict",
    fetch: async (url, init) => {
      envois.push({ url, corps: JSON.parse(init.body), entetes: init.headers });
      return { ok: true, status: 200, json: async () => ({ id: "email_test" }) };
    },
    journaliser: (e) => journal.push(e),
    ...surcharges,
  };
  return { handler: creerHandler(deps), envois, journal };
}

async function appel(env, reqOpts) {
  const res = fauxRes();
  await env.handler(fauxReq(reqOpts), res);
  return res;
}

const RAPPORT_OK = {
  to: ["suivi.chantier@groupe-profero.com", "loris.bessonneau@groupe-profero.com"],
  subject: "CR Kevin — Chantier Dupont — 2026-09-29",
  html: "<p>Compte rendu</p>",
};
const EXTERNE = { to: "victime@exemple.fr", subject: "Votre dossier Profero", html: "<a href='x'>Cliquez</a>" };

// ════════════════════════════════════════════════════════════════════════════
section("1. Garde serveur — fermée par défaut");

verifie("secret absent → route fermée (500)",
  serveur.verifierAppelServeur(fauxReq({ auth: "Bearer x" }), undefined).status === 500);
verifie("secret absent + « Bearer undefined » → toujours fermée",
  serveur.verifierAppelServeur(fauxReq({ auth: "Bearer undefined" }), undefined).ok === false);
verifie("secret vide → route fermée",
  serveur.verifierAppelServeur(fauxReq({ auth: "Bearer " }), "").ok === false);
verifie("mauvais secret → 401",
  serveur.verifierAppelServeur(fauxReq({ auth: "Bearer faux" }), SECRET).status === 401);
verifie("sans en-tête → 401",
  serveur.verifierAppelServeur(fauxReq(), SECRET).status === 401);
verifie("bon secret → autorisé",
  serveur.verifierAppelServeur(fauxReq({ auth: `Bearer ${SECRET}` }), SECRET).ok === true);
verifie("préfixe du secret seul → refusé",
  serveur.verifierAppelServeur(fauxReq({ auth: `Bearer ${SECRET.slice(0, 10)}` }), SECRET).ok === false);
verifie("en-têtes d'appel serveur : Authorization posé si secret",
  serveur.enTetesAppelServeur("cron", SECRET).Authorization === `Bearer ${SECRET}`);
verifie("en-têtes d'appel serveur : aucun Authorization sans secret",
  !("Authorization" in serveur.enTetesAppelServeur("cron", undefined)));

// ════════════════════════════════════════════════════════════════════════════
section("2. Mode d'autorisation");

verifie("variable absente → strict", email.modeAutorisation(undefined) === "strict");
verifie("valeur inconnue → strict", email.modeAutorisation("off") === "strict");
verifie("« observer » → observer", email.modeAutorisation("observer") === "observer");
verifie("« OBSERVER  » → observer", email.modeAutorisation("OBSERVER  ") === "observer");

// ════════════════════════════════════════════════════════════════════════════
section("3. Liste blanche du compte rendu public");

verifie("exactement les 3 adresses validées", JSON.stringify(email.DESTINATAIRES_RAPPORT) === JSON.stringify([
  "suivi.chantier@groupe-profero.com",
  "loris.bessonneau@groupe-profero.com",
  "matthieu.fumoleau@groupe-profero.com",
]));
verifie("liste figée (non modifiable à l'exécution)", Object.isFrozen(email.DESTINATAIRES_RAPPORT));
{
  // Les destinataires que RapportMobile envoie réellement doivent être dans
  // la liste, sinon le compte rendu public casserait en mode strict.
  const src = lire("src/Renovation/RapportMobile.jsx");
  const m = /to:\s*\[([^\]]+)\]/.exec(src);
  const adresses = m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1].toLowerCase()) : [];
  verifie("RapportMobile envoie exactement aux 3 adresses de la liste blanche",
    JSON.stringify([...adresses].sort()) === JSON.stringify([...email.DESTINATAIRES_RAPPORT].sort()),
    `trouvées : ${adresses.join(", ")}`);
}
{
  // L'exception du compte rendu public ne doit ouvrir AUCUN autre destinataire.
  const sujet = "CR Kevin — Chantier — 2026-09-29";
  const tous = [...email.DESTINATAIRES_RAPPORT];
  const ok = (to, appelant = { type: "anonyme" }) => email.evaluerEnvoi(appelant, { to, subject: sujet, html: "<p>x</p>" }).autorise;
  verifie("compte rendu public vers les 3 adresses : autorisé", ok(tous));
  verifie("… et vers chacune séparément", tous.every(a => ok([a])));
  const deguisements = [
    "matthieu.fumoleau@groupe-profero.com.evil.fr",
    "matthieu.fumoleau@groupe-profero.co",
    "Matthieu Fumoleau <pirate@evil.fr>",
    "matthieu.fumoleau@groupe-profero.com, pirate@evil.fr",
    "matthieu.fumoleau+x@groupe-profero.com",
    "pirate@groupe-profero.com",
    "suivi.chantier@groupe-profero.com\npirate@evil.fr",
  ];
  for (const d of deguisements) {
    verifie(`refus : « ${d.replace(/\n/g, "\\n")} »`, !ok([d]) && !ok([...tous, d]));
  }
  verifie("les 3 adresses + une externe : refusé", !ok([...tous, "pirate@evil.fr"]));
  verifie("même règle pour un ouvrier connecté", !ok(["pirate@evil.fr"], { type: "ouvrier" }) && ok(tous, { type: "ouvrier" }));
}

// ════════════════════════════════════════════════════════════════════════════
section("4. Handler — mode strict");

{
  const env = environnement();
  let r = await appel(env, { body: EXTERNE });
  verifie("anonyme → destinataire externe : refusé (401)", r.statusCode === 401);
  verifie("… et Resend n'est PAS appelé", env.envois.length === 0);
  verifie("… et la raison est dite", r.corps?.raison === "destinataire_hors_liste");
}
{
  const env = environnement();
  const r = await appel(env, { body: RAPPORT_OK, headers: { "x-profero-source": "rapport" } });
  verifie("anonyme → compte rendu vers la liste blanche : envoyé (200)", r.statusCode === 200 && env.envois.length === 1);
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, to: [...RAPPORT_OK.to, "pirate@exemple.fr"] } });
  verifie("anonyme → liste blanche + une adresse externe : refusé", r.statusCode === 401 && env.envois.length === 0);
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, cc: "pirate@exemple.fr" } });
  verifie("anonyme → copie (cc) : refusé", r.statusCode === 401 && r.corps?.raison === "copie_interdite");
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, bcc: ["pirate@exemple.fr"] } });
  verifie("anonyme → copie cachée (bcc) : refusé", r.statusCode === 401 && env.envois.length === 0);
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, attachments: [{ filename: "x.pdf", content: "AAA" }] } });
  verifie("anonyme → pièce jointe : refusée", r.statusCode === 401 && r.corps?.raison === "piece_jointe_interdite");
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, subject: "Votre facture" } });
  verifie("anonyme → sujet qui n'est pas un compte rendu : refusé", r.statusCode === 401 && r.corps?.raison === "sujet_non_rapport");
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, html: "x".repeat(email.HTML_MAX_RAPPORT + 1) } });
  verifie("anonyme → contenu démesuré : refusé", r.statusCode === 401 && r.corps?.raison === "contenu_trop_volumineux");
}
{
  const env = environnement();
  const r = await appel(env, { body: { ...RAPPORT_OK, to: ["SUIVI.CHANTIER@groupe-profero.com"] } });
  verifie("liste blanche insensible à la casse", r.statusCode === 200);
}
{
  const env = environnement();
  const r = await appel(env, { auth: `Bearer ${SECRET}`, body: EXTERNE });
  verifie("serveur (CRON_SECRET) → externe : envoyé", r.statusCode === 200 && env.envois.length === 1);
}
{
  const env = environnement({ cronSecret: undefined, verifierJeton: async () => null });
  const r = await appel(env, { auth: "Bearer undefined", body: EXTERNE });
  verifie("secret non configuré + « Bearer undefined » : refusé", r.statusCode === 401 && env.envois.length === 0);
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer n-importe-quoi", body: EXTERNE });
  verifie("faux jeton → 401", r.statusCode === 401 && r.corps?.raison === "jeton_invalide");
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer jwt-orphelin", body: EXTERNE });
  verifie("compte Auth absent de utilisateurs (inscription sauvage) → 403",
    r.statusCode === 403 && r.corps?.raison === "compte_hors_utilisateurs" && env.envois.length === 0);
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer jwt-inactif", body: EXTERNE });
  verifie("compte désactivé → 403", r.statusCode === 403 && r.corps?.raison === "compte_inactif");
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer jwt-collab", body: { ...EXTERNE, attachments: [{ filename: "b.pdf", content: "QUJD" }] } });
  verifie("collaborateur actif → externe + pièce jointe : envoyé",
    r.statusCode === 200 && env.envois[0]?.corps.attachments?.[0]?.filename === "b.pdf");
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer jwt-ouvrier", body: EXTERNE });
  verifie("ouvrier connecté → externe : refusé (règle du compte rendu)", r.statusCode === 403 && env.envois.length === 0);
  const r2 = await appel(env, { auth: "Bearer jwt-ouvrier", body: RAPPORT_OK });
  verifie("ouvrier connecté → compte rendu (Espace ouvrier) : envoyé", r2.statusCode === 200);
}
{
  const env = environnement({ jwtVerifiable: false });
  const r = await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE });
  verifie("clé service_role absente → JWT invérifiable : refusé (fermé par défaut)",
    r.statusCode === 403 && r.corps?.raison === "config_serveur_incomplete");
}
{
  const env = environnement({ verifierJeton: async () => { throw new Error("réseau"); } });
  const r = await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE });
  verifie("vérification du jeton en échec → refusé, pas autorisé", r.statusCode === 401 && env.envois.length === 0);
}
{
  const env = environnement();
  await appel(env, { auth: "Bearer jwt-collab", body: { ...EXTERNE, from: "PDG <pdg@banque.fr>" } });
  verifie("le `from` fourni par l'appelant est ignoré", env.envois[0]?.corps.from === "Profero <noreply@groupe-profero.com>");
}
{
  const env = environnement();
  const r = await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE });
  verifie("plus d'en-tête CORS « * »", !("access-control-allow-origin" in r.entetes));
  const o = await appel(env, { method: "OPTIONS" });
  verifie("OPTIONS → 204", o.statusCode === 204);
  const g = await appel(env, { method: "GET" });
  verifie("GET → 405", g.statusCode === 405);
}
{
  const env = environnement({ resendKey: undefined });
  const r = await appel(env, { auth: `Bearer ${SECRET}`, body: EXTERNE });
  verifie("RESEND_KEY absente → 500, rien n'est envoyé", r.statusCode === 500 && env.envois.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
section("5. Handler — mode observation");

{
  const env = environnement({ mode: "observer" });
  const r = await appel(env, {
    body: { ...EXTERNE, attachments: [{ filename: "secret.pdf", content: "Q09OVEVOVQ==" }] },
    headers: { referer: "https://planning-chantiers.vercel.app/?invest_urbanisme=42#x" },
  });
  verifie("un envoi qui serait refusé passe (aucun comportement bloqué)", r.statusCode === 200 && env.envois.length === 1);
  const e = env.journal[0] || {};
  verifie("… et il est journalisé « aurait_refuse »", e.decision === "aurait_refuse" && e.raison === "destinataire_hors_liste");
  verifie("… avec son origine (chemin seul, sans requête ni fragment)", e.origine === "/");
  verifie("… et sans étiquette de source (ancien bundle repérable)", e.source === null);
  const brut = JSON.stringify(env.journal);
  verifie("le journal ne contient ni le sujet ni le corps", !brut.includes(EXTERNE.subject) && !brut.includes("Cliquez"));
  verifie("le journal ne contient ni la pièce jointe ni son nom", !brut.includes("Q09OVEVOVQ==") && !brut.includes("secret.pdf"));
  verifie("le journal ne contient pas l'adresse du destinataire, seulement son domaine",
    !brut.includes("victime@") && (e.domaines || []).includes("exemple.fr"));
}
{
  const env = environnement({ mode: "observer" });
  await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE, headers: { "x-profero-source": "todo" } });
  const e = env.journal[0] || {};
  verifie("un envoi légitime est journalisé « autorise » avec sa source", e.decision === "autorise" && e.source === "todo");
  verifie("le rôle du collaborateur est journalisé, pas son adresse",
    e.appelant_role === "admin" && !JSON.stringify(env.journal).includes("camille@"));
}
{
  const env = environnement({ mode: "observer" });
  await appel(env, { body: RAPPORT_OK });
  verifie("un anonyme n'a ni adresse ni rôle journalisé",
    env.journal[0]?.appelant_role === null && !JSON.stringify(env.journal).includes("suivi.chantier@"));
}
{
  const env = environnement({ journaliser: () => { throw new Error("journal cassé"); } });
  const r = await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE });
  verifie("un journal en panne ne bloque pas un envoi légitime", r.statusCode === 200);
}
{
  const env = environnement({ journaliser: async () => { throw new Error("table absente"); } });
  const r = await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE });
  verifie("un journal asynchrone en échec (table absente) ne bloque pas l'envoi", r.statusCode === 200);
}
{
  // L'écriture du journal doit être terminée AVANT la réponse : une fonction
  // Vercel peut être gelée dès la réponse envoyée.
  let fini = false;
  const env = environnement({ journaliser: () => new Promise(ok => setTimeout(() => { fini = true; ok(); }, 20)) });
  const res = fauxRes();
  const promesse = env.handler(fauxReq({ auth: "Bearer jwt-collab", body: EXTERNE }), res);
  await promesse;
  verifie("le journal est écrit avant la fin du handler", fini === true);
}

// ════════════════════════════════════════════════════════════════════════════
section("5 bis. Ligne de journal_envois_email");

{
  const env = environnement({ mode: "observer" });
  await appel(env, { auth: `Bearer ${SECRET}`, body: { ...EXTERNE, cc: "copie@exemple.fr",
    attachments: [{ filename: "releve-bancaire.pdf", content: "UERGLUNPTlRFTlU=" }] },
    headers: { "x-vercel-id": "cdg1::abc123", "x-profero-source": "cron" } });
  await appel(env, { auth: "Bearer jwt-collab", body: EXTERNE, headers: { "x-profero-source": "todo" } });
  await appel(env, { auth: "Bearer jwt-orphelin", body: EXTERNE });
  await appel(env, { body: RAPPORT_OK, headers: { referer: "https://x.vercel.app/rapport?nom=kevin@x.fr" } });
  const lignes = env.journal.map(email.ligneJournal);
  verifie("colonnes exactement celles de la table",
    lignes.every(l => JSON.stringify(Object.keys(l).sort()) === JSON.stringify([...email.COLONNES_JOURNAL].sort())));
  const brut = JSON.stringify(lignes);
  verifie("aucune ligne ne contient d'« @ » (aucune adresse)", !brut.includes("@"));
  verifie("ni secret serveur ni JWT dans le journal", !brut.includes(SECRET) && !brut.includes("jwt-"));
  verifie("ni sujet, ni corps, ni nom ou contenu de pièce jointe",
    !brut.includes(EXTERNE.subject) && !brut.includes("Cliquez") && !brut.includes("releve-bancaire") && !brut.includes("UERGLUNPTlRFTlU="));
  verifie("identifiant technique de requête conservé", lignes[0].requete_id === "cdg1::abc123");
  verifie("nombre de destinataires (to + cc) et de pièces jointes", lignes[0].nb_destinataires === 2 && lignes[0].pieces_jointes === 1);
  verifie("origine = chemin seul (requête retirée)", lignes[3].origine === "/rapport");
  verifie("un compte orphelin est tracé comme tel", lignes[2].raison === "compte_hors_utilisateurs" && lignes[2].appelant === "invalide");
  const l = email.ligneJournal({ mode: "observer", decision: "autorise", appelant: "anonyme",
    source: "x".repeat(500) + "@", origine: "/a@b", domaines: Array(80).fill("d.fr") });
  verifie("textes bornés comme les CHECK de la table", l.source.length <= 60 && !l.source.includes("@") && l.domaines.length === 50);
}
{
  // Les colonnes du SQL et celles du code ne doivent pas diverger : une colonne
  // envoyée sans exister en base ferait échouer TOUTES les insertions.
  const sql = lire("sql/202609_journal_envois_email.sql");
  const bloc = /CREATE TABLE IF NOT EXISTS public\.journal_envois_email \(([\s\S]*?)\n\);/.exec(sql)?.[1] || "";
  const colonnesSql = [...bloc.matchAll(/^\s{2}([a-z_]+)\s+(?:bigint|timestamptz|text|smallint|boolean)/gm)]
    .map(m => m[1]).filter(c => c !== "id" && c !== "cree_le");
  verifie("colonnes du SQL = colonnes écrites par le code",
    JSON.stringify(colonnesSql.sort()) === JSON.stringify([...email.COLONNES_JOURNAL].sort()),
    `SQL : ${colonnesSql.join(", ")}`);
  verifie("SQL : RLS activée", /ENABLE ROW LEVEL SECURITY/.test(sql));
  verifie("SQL : aucune policy créée", !/CREATE POLICY/i.test(sql));
  verifie("SQL : privilèges retirés à anon et authenticated", /REVOKE ALL ON TABLE public\.journal_envois_email FROM PUBLIC, anon, authenticated/.test(sql));
  verifie("SQL : migration additive (aucun DROP / ALTER d'objet existant / UPDATE / DELETE hors purge)",
    !/\bDROP\b/i.test(sql) && !/ALTER TABLE (?!public\.journal_envois_email)/i.test(sql) && !/\bUPDATE\b/i.test(sql)
      && (sql.match(/DELETE FROM/gi) || []).length === 1);
  verifie("rollback fourni", existsSync(join(RACINE, "sql", "202609_journal_envois_email_rollback.sql")));
  // Fonction de purge : verrouillée par construction, pas seulement par REVOKE.
  const fn = /CREATE OR REPLACE FUNCTION public\.purger_journal_envois_email[\s\S]*?\$\$;/.exec(sql)?.[0] || "";
  const sqlSansCommentaires = sql.replace(/--.*$/gm, "");
  verifie("purge : SECURITY INVOKER (droits de l'appelant), aucun SECURITY DEFINER exécutable",
    /SECURITY INVOKER/.test(fn) && !/SECURITY DEFINER/.test(sqlSansCommentaires));
  verifie("purge : search_path vide", /SET search_path = ''/.test(fn));
  verifie("purge : conservation par défaut 90 jours, minimum 7, NULL refusé",
    /DEFAULT interval '90 days'/.test(fn) && /conservation IS NULL OR conservation < interval '7 days'/.test(fn));
  verifie("purge : EXECUTE retiré à PUBLIC, anon, authenticated",
    /REVOKE EXECUTE ON FUNCTION public\.purger_journal_envois_email\(interval\) FROM PUBLIC, anon, authenticated;/.test(sql));
  const grants = [...sql.matchAll(/^GRANT\s+(.+?)\s+ON\s+(?:TABLE|FUNCTION)\s+\S+\s+TO\s+([a-z_, ]+);/gim)].map(m => m[2].trim());
  verifie("seul service_role reçoit des droits (table et fonction)",
    grants.length === 2 && grants.every(g => g === "service_role"), grants.join(" | "));
  const tables = [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\S+)/gi)].map(m => m[1]);
  verifie("une seule table créée : journal_envois_email", JSON.stringify(tables) === JSON.stringify(["public.journal_envois_email"]));
}

// ════════════════════════════════════════════════════════════════════════════
section("6. Routes cron — fermées par défaut");

{
  const routes = [
    "api/cron-dispatcher.js", "api/cron-encours-fournisseurs.js",
    "api/cron-snapshot-avancement.js", "api/cron-snapshot-hebdo.js",
    "api/_cron/cron-rappel-rapport.js", "api/_cron/cron-recap-commandes.js",
  ];
  const avant = process.env.CRON_SECRET;
  for (const f of routes) {
    const handler = require(join(RACINE, f));
    delete process.env.CRON_SECRET;
    let res = fauxRes();
    await handler(fauxReq({ method: "GET" }), res);
    verifie(`${f} — secret absent → 500`, res.statusCode === 500);
    process.env.CRON_SECRET = SECRET;
    res = fauxRes();
    await handler(fauxReq({ method: "GET", auth: "Bearer faux" }), res);
    verifie(`${f} — mauvais secret → 401`, res.statusCode === 401);
  }
  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
}

// ════════════════════════════════════════════════════════════════════════════
section("7. Contrôles statiques");

function fichiers(dossier, filtre) {
  const out = [];
  for (const n of readdirSync(join(RACINE, dossier))) {
    const rel = join(dossier, n);
    if (statSync(join(RACINE, rel)).isDirectory()) out.push(...fichiers(rel, filtre));
    else if (filtre(rel)) out.push(rel);
  }
  return out;
}
{
  const src = fichiers("src", (p) => /\.(jsx?|mjs)$/.test(p));
  const directs = src.filter(p => p !== join("src", "emailApi.js") && /fetch\(\s*["'`]\/api\/send-email/.test(lire(p)));
  verifie("aucun fetch direct de /api/send-email dans src/ (tout passe par emailApi.js)",
    directs.length === 0, directs.join(", "));
  const utilisateurs = src.filter(p => lire(p).includes("envoyerEmailApi("));
  verifie("les 6 fichiers appelants utilisent envoyerEmailApi", utilisateurs.length >= 6,
    utilisateurs.join(", "));
}
{
  const api = fichiers("api", (p) => p.endsWith(".js"));
  const appelants = api.filter(p => /\/api\/send-email`/.test(lire(p)) && /fetch\(url/.test(lire(p)));
  const sansEntete = appelants.filter(p => !lire(p).includes("enTetesAppelServeur("));
  verifie("chaque envoyerMail serveur s'authentifie", appelants.length >= 3 && sansEntete.length === 0,
    `appelants : ${appelants.join(", ")} ; sans en-tête : ${sansEntete.join(", ")}`);
  const ouverts = api.filter(p => /if \(expected\)/.test(lire(p)));
  verifie("plus aucune garde « if (expected) » ouverte par défaut", ouverts.length === 0, ouverts.join(", "));
  verifie("send-email.js ne pose plus de CORS « * »", !lire("api/send-email.js").includes("Access-Control-Allow-Origin"));
}
{
  const exposees = readdirSync(join(RACINE, "api"))
    .filter(n => !n.startsWith("_") && !n.startsWith(".") && /\.(js|mjs|cjs|ts)$/.test(n));
  verifie(`fonctions Vercel exposées : ${exposees.length} (plafond Hobby 12)`, exposees.length === 10, exposees.join(", "));
  verifie("gmail-draft.js supprimé", !existsSync(join(RACINE, "api", "gmail-draft.js")));
}
{
  const api = fichiers("api", (p) => p.endsWith(".js"));
  const definitions = api.filter(p => /DESTINATAIRES_RAPPORT\s*=/.test(lire(p)));
  verifie("liste blanche définie à un seul endroit", definitions.length === 1 && definitions[0].endsWith("autorisationEmail.js"),
    definitions.join(", "));
}

// ════════════════════════════════════════════════════════════════════════════
section("8. PWA — navigations exclues du service worker");

{
  const cfg = lire("vite.config.js");
  verifie("vite.config.js déclare la liste d'exclusion",
    cfg.includes("navigateFallbackDenylist: [/^\\/espace-client/, /^\\/api\\//]"));
  const exclues = [/^\/espace-client/, /^\/api\//];
  const exclu = (chemin) => exclues.some(r => r.test(chemin));
  for (const c of ["/", "/index.html", "/rapport", "/rapport/", "/?rapport=1", "/?invest_urbanisme=42"]) {
    verifie(`« ${c} » reste servi par l'app (non exclu)`, !exclu(c));
  }
  for (const c of ["/espace-client", "/espace-client/", "/espace-client/accueil", "/api/send-email"]) {
    verifie(`« ${c} » est exclu du repli index.html`, exclu(c));
  }
  const sw = join(RACINE, "dist", "sw.js");
  if (existsSync(sw)) {
    const code = readFileSync(sw, "utf8");
    verifie("dist/sw.js (build) contient la liste d'exclusion",
      /denylist:\[\/\^\\\/espace-client\/,\/\^\\\/api\\\/\/\]/.test(code), "relancer npm run build");
    verifie("dist/sw.js garde le repli index.html pour le reste",
      code.includes('"index.html"') || code.includes("'index.html'") || code.includes("index.html"));
  } else {
    verifie("dist/sw.js présent (lancer npm run build avant ce script)", false);
  }
  const manifeste = lire("vite.config.js");
  verifie("manifeste PWA inchangé : start_url « / » et scope « / »",
    manifeste.includes("start_url: '/'") && manifeste.includes("scope: '/'"));
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(56)}`);
if (echecs) { console.log(`✗ ${echecs} échec(s), ${passes} réussite(s).`); process.exit(1); }
console.log(`✓ ${passes} vérifications passées.`);
