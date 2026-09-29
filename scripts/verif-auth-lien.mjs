// scripts/verif-auth-lien.mjs — Liens d'invitation et de réinitialisation.
//
// Rejoue le flux avec le VRAI supabase-js installé (node_modules), dans un
// navigateur simulé : fausse URL, faux localStorage, faux serveur Auth (fetch).
// Aucun réseau, aucun compte réel.
//
// Ce que le script établit :
//   1. la cause racine : supabase-js efface le fragment d'URL AVANT de
//      prévenir l'application (d'où l'écran de mot de passe jamais affiché) ;
//   2. la correction : le lien relevé avant createClient + la session réelle
//      suffisent à ouvrir l'écran, pour une invitation et une réinitialisation ;
//   3. la sécurité : `type=invite` / `type=recovery` dans l'URL ne suffisent
//      jamais — lien forgé, expiré ou sans jeton : pas d'écran, et surtout pas
//      pour la session d'un administrateur déjà connecté ;
//   4. le navigateur déjà connecté : la session du lien remplace celle de
//      l'administrateur, et l'identité proposée est celle de l'invité ;
//   5. des contrôles statiques sur src/supabase.js et src/App.jsx.
//
// Usage :  node scripts/verif-auth-lien.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  lireLienAuth, sessionIssueDuLien, modeMotDePasse,
  capturerLienAuth, lienAuthInitial, consommerLienAuth,
} from "../src/authLien.mjs";

// Chaque scénario crée son propre client sur la même clé de stockage : c'est
// voulu (un démarrage d'application par scénario), l'avertissement est du bruit.
const warnOrigine = console.warn;
console.warn = (...a) => { if (!String(a[0]).includes("Multiple GoTrueClient")) warnOrigine(...a); };

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => readFileSync(join(RACINE, p), "utf8");

let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(titre) { console.log(`\n${titre}\n${"─".repeat(titre.length)}`); }

// ── Navigateur simulé ───────────────────────────────────────────────────────
const SUPA_URL = "https://testref.supabase.co";
const CLE_STOCKAGE = "sb-testref-auth-token";
const APP = "https://planning-chantiers.vercel.app/";

function installerNavigateur(href, stockageInitial = {}) {
  const store = new Map(Object.entries(stockageInitial));
  let courant = new URL(href);
  const location = {
    get href() { return courant.toString(); },
    get hash() { return courant.hash; },
    set hash(v) { courant.hash = v; },
    get pathname() { return courant.pathname; },
    get search() { return courant.search; },
    get origin() { return courant.origin; },
    get hostname() { return courant.hostname; },
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  globalThis.window = {
    location, localStorage,
    history: { state: null, replaceState: (_s, _t, u) => { courant = new URL(u, courant); } },
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = localStorage;
  return { store, location };
}

// Faux serveur Auth : GET /auth/v1/user répond selon le jeton.
const UTILISATEURS = {
  "tok-invite-camille":  { id: "u-camille", email: "camille.test@groupe-profero.com" },
  "tok-recovery-camille": { id: "u-camille", email: "camille.test@groupe-profero.com" },
  "tok-admin":           { id: "u-admin", email: "admin.test@groupe-profero.com" },
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) {
    const jeton = String((init.headers && (init.headers.Authorization || init.headers.authorization)) || "").replace(/^Bearer\s+/i, "");
    const user = UTILISATEURS[jeton];
    return new Response(JSON.stringify(user ? { ...user, aud: "authenticated", role: "authenticated" } : { code: 401, msg: "invalid JWT" }),
      { status: user ? 200 : 401, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ msg: "non simulé" }), { status: 404, headers: { "Content-Type": "application/json" } });
};

const maintenant = () => Math.floor(Date.now() / 1000);
function hashLien(type, jeton) {
  return `#access_token=${jeton}&expires_at=${maintenant() + 3600}&expires_in=3600&refresh_token=r-${jeton}&token_type=bearer&type=${type}`;
}
function sessionAdminStockee() {
  return JSON.stringify({
    access_token: "tok-admin", refresh_token: "r-admin", token_type: "bearer",
    expires_in: 3600, expires_at: maintenant() + 3600, user: { id: "u-admin", email: "admin.test@groupe-profero.com" },
  });
}

// Rejoue le démarrage de l'application : capture (src/supabase.js), création du
// client, écouteur d'événements et checkSession (src/App.jsx).
async function demarrer(href, stockage = {}) {
  const nav = installerNavigateur(href, stockage);
  capturerLienAuth(window.location.href);                     // src/supabase.js
  const client = createClient(SUPA_URL, "cle-anon-test", { auth: { autoRefreshToken: false } });
  const evenements = [];
  const decisions = [];
  client.auth.onAuthStateChange((event, session) => {         // src/App.jsx
    evenements.push(event);
    if (session?.user && ["SIGNED_IN", "PASSWORD_RECOVERY", "INITIAL_SESSION"].includes(event)) {
      decisions.push({ via: event, mode: modeMotDePasse(lienAuthInitial(), session, event), email: session.user.email });
    }
  });
  const hashAvantInit = nav.location.hash;
  const { data: { session } } = await client.auth.getSession(); // checkSession
  decisions.push({ via: "checkSession", mode: modeMotDePasse(lienAuthInitial(), session), email: session?.user?.email || null });
  await new Promise(r => setTimeout(r, 30));                   // laisse partir les événements différés
  return { client, session, evenements, decisions, hashApres: nav.location.hash, hashAvantInit, store: nav.store };
}
const modes = (d) => [...new Set(d.decisions.map(x => x.mode))];

// ════════════════════════════════════════════════════════════════════════════
section("1. Lecture du lien (fonctions pures)");

{
  const l = lireLienAuth(APP + hashLien("invite", "abc"));
  verifie("invitation : type et jeton relevés", l.type === "invite" && l.jeton === "abc");
  verifie("réinitialisation : type relevé", lireLienAuth(APP + hashLien("recovery", "x")).type === "recovery");
  verifie("type inconnu ignoré (magiclink, signup…)", lireLienAuth(APP + hashLien("signup", "x")).type === null);
  verifie("URL sans fragment : rien", lireLienAuth(APP).type === null);
  verifie("URL invalide : rien, sans exception", lireLienAuth("pas une url").type === null);
  const e = lireLienAuth(APP + "#error=access_denied&error_code=otp_expired&error_description=expired");
  verifie("lien expiré : erreur relevée, aucun type", e.type === null && e.erreur === "otp_expired");
  verifie("`type=invite` sans jeton : pas de mode", modeMotDePasse(lireLienAuth(APP + "#type=invite"), { access_token: "x", user: {} }) === null);
  verifie("jeton différent de la session : pas de mode",
    modeMotDePasse(lireLienAuth(APP + hashLien("invite", "abc")), { access_token: "autre", user: {} }) === null);
  verifie("pas de session : pas de mode", modeMotDePasse(lireLienAuth(APP + hashLien("invite", "abc")), null) === null);
  verifie("session du lien : mode invite", modeMotDePasse(lireLienAuth(APP + hashLien("invite", "abc")), { access_token: "abc", user: {} }) === "invite");
  verifie("PASSWORD_RECOVERY confirme la réinitialisation",
    modeMotDePasse(lireLienAuth(APP + hashLien("recovery", "abc")), { access_token: "abc" }, "PASSWORD_RECOVERY") === "recovery");
  capturerLienAuth(APP + hashLien("invite", "abc"));
  consommerLienAuth();
  verifie("lien consommé : plus de mode, jeton oublié",
    modeMotDePasse(lienAuthInitial(), { access_token: "abc" }) === null && lienAuthInitial().jeton === null);
  verifie("sessionIssueDuLien exige type + jeton + égalité",
    !sessionIssueDuLien({ type: "invite", jeton: null }, { access_token: null }) && sessionIssueDuLien({ type: "invite", jeton: "a" }, { access_token: "a" }));
}

// ════════════════════════════════════════════════════════════════════════════
section("2. Cause racine — comportement réel de supabase-js");

{
  const r = await demarrer(APP + hashLien("invite", "tok-invite-camille"));
  verifie("supabase-js efface le fragment d'URL (l'ancienne détection ne pouvait rien lire)",
    r.hashApres === "" && r.hashAvantInit !== "" , `hash après : « ${r.hashApres} »`);
  verifie("… et la session de l'invité est bien ouverte", r.session?.user?.email === "camille.test@groupe-profero.com");
}

// ════════════════════════════════════════════════════════════════════════════
section("3. Invitation — navigateur vierge (fenêtre privée)");

{
  const r = await demarrer(APP + hashLien("invite", "tok-invite-camille"));
  verifie("écran « Créer votre mot de passe » proposé", modes(r).includes("invite"), JSON.stringify(r.decisions));
  verifie("aucune décision contradictoire (toutes « invite »)", modes(r).every(m => m === "invite"), JSON.stringify(r.decisions));
  verifie("identité proposée = l'invité", r.decisions.every(d => d.email === "camille.test@groupe-profero.com"));
}

// ════════════════════════════════════════════════════════════════════════════
section("4. Réinitialisation");

{
  const r = await demarrer(APP + hashLien("recovery", "tok-recovery-camille"));
  verifie("supabase-js émet PASSWORD_RECOVERY", r.evenements.includes("PASSWORD_RECOVERY"), r.evenements.join(", "));
  verifie("écran « nouveau mot de passe » proposé (mode recovery)", modes(r).includes("recovery") && modes(r).every(m => m === "recovery"),
    JSON.stringify(r.decisions));
}

// ════════════════════════════════════════════════════════════════════════════
section("5. Sécurité — l'URL ne suffit jamais");

{
  // Lien forgé : type=invite + un jeton que Supabase ne reconnaît pas, dans un
  // navigateur où un administrateur est déjà connecté.
  const r = await demarrer(APP + hashLien("invite", "tok-forge"), { [CLE_STOCKAGE]: sessionAdminStockee() });
  verifie("lien forgé : supabase-js conserve la session admin", r.session?.user?.email === "admin.test@groupe-profero.com");
  verifie("… et l'écran de mot de passe n'est PAS proposé à l'admin", modes(r).every(m => m === null), JSON.stringify(r.decisions));
}
{
  const r = await demarrer(APP + "#type=recovery", { [CLE_STOCKAGE]: sessionAdminStockee() });
  verifie("`#type=recovery` seul (sans jeton), admin connecté : aucun écran", modes(r).every(m => m === null), JSON.stringify(r.decisions));
}
{
  const r = await demarrer(APP + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", { [CLE_STOCKAGE]: sessionAdminStockee() });
  verifie("lien expiré, admin connecté : aucun écran, session admin intacte",
    modes(r).every(m => m === null) && r.session?.user?.email === "admin.test@groupe-profero.com");
}
{
  const r = await demarrer(APP + hashLien("recovery", "tok-forge"));
  verifie("lien forgé, navigateur vierge : aucune session, aucun écran", !r.session && modes(r).every(m => m === null));
}
{
  const r = await demarrer(APP, { [CLE_STOCKAGE]: sessionAdminStockee() });
  verifie("connexion normale (session existante, sans lien) : aucun écran", modes(r).every(m => m === null));
}

// ════════════════════════════════════════════════════════════════════════════
section("6. Lien ouvert dans un navigateur déjà connecté (admin)");

{
  const r = await demarrer(APP + hashLien("invite", "tok-invite-camille"), { [CLE_STOCKAGE]: sessionAdminStockee() });
  verifie("la session de l'invité remplace celle de l'admin", r.session?.user?.email === "camille.test@groupe-profero.com");
  const stockee = JSON.parse(r.store.get(CLE_STOCKAGE) || "{}");
  verifie("le stockage ne contient plus la session admin (pas de retour automatique)",
    stockee.access_token === "tok-invite-camille" && stockee.user?.id === "u-camille");
  verifie("écran proposé pour l'invité, jamais pour l'admin",
    modes(r).every(m => m === "invite") && r.decisions.every(d => d.email === "camille.test@groupe-profero.com"), JSON.stringify(r.decisions));
}

// ════════════════════════════════════════════════════════════════════════════
section("7. Contrôles statiques");

{
  const s = lire("src/supabase.js");
  const iCapture = s.indexOf("capturerLienAuth()");
  const iClient = s.indexOf("createClient(SUPABASE_URL");
  verifie("src/supabase.js relève le lien AVANT createClient", iCapture > 0 && iClient > iCapture);
  const a = lire("src/App.jsx");
  verifie("App.jsx ne cherche plus `type=invite` dans window.location.hash",
    !/window\.location\.hash[\s\S]{0,200}invite/.test(a) && !/params\.get\("type"\) === "invite"/.test(a));
  verifie("App.jsx décide via modeMotDePasse (session réelle)", a.includes("modeMotDePasse(lienAuthInitial(), session"));
  verifie("App.jsx traite PASSWORD_RECOVERY", a.includes('"PASSWORD_RECOVERY"'));
  verifie("PageCreerMotDePasse revérifie la session avant updateUser",
    /getSession\(\)[\s\S]{0,300}session\.user\?\.id !== user\.id[\s\S]{0,400}updateUser\(\{ password \}\)/.test(a));
  verifie("PageCreerMotDePasse affiche le compte de la session active", a.includes("Compte : <strong"));
  verifie("un seul client Supabase côté navigateur", (() => {
    const src = ["src/App.jsx", "src/main.jsx", "src/supabase.js"].map(lire).join("\n");
    return (src.match(/createClient\(/g) || []).length === 1;
  })());
  const r = lire("src/Renovation/RapportMobile.jsx");
  verifie("aucun fichier Rénovation n'importe authLien (correction transverse isolée)", !r.includes("authLien"));
}

console.log(`\n${"═".repeat(56)}`);
if (echecs) { console.log(`✗ ${echecs} échec(s), ${passes} réussite(s).`); process.exit(1); }
console.log(`✓ ${passes} vérifications passées.`);
process.exit(0);
