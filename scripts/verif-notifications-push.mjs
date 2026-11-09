#!/usr/bin/env node
// Vérifie la plomberie des notifications sur téléphone (projet
// docs/projets/notifications-push.md, tâche 1).
//
//   1. src/notificationsPush.mjs (état affiché dans le profil) — exécuté ;
//   2. supabase/functions/_partage/pushRegles.mjs (décisions des Edge
//      Functions) — exécuté ;
//   3. garde-fous statiques : service worker (push-sw.js importé, toujours
//      generateSW, jamais skipWaiting), migration (seule la policy
//      restrictive profero_collaborateurs_seulement, aucune autre, aucune
//      fonction SECURITY DEFINER), rien dans l'espace ouvrier, aucune demande
//      d'autorisation au chargement, aucune clé privée dans le dépôt.
//
//   4. tâche 2 : moteur des envois (réglages, destinataires sans ouvrier,
//      préférences, plage de silence et report, changement d'heure,
//      regroupement), migration de la boîte, Edge Function de la boîte,
//      job de rattrapage. Données fictives.
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-notifications-push.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as N from "../src/notificationsPush.mjs";
import * as R from "../supabase/functions/_partage/pushRegles.mjs";
import * as V from "../supabase/functions/_partage/notificationsPushV1.mjs";

const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
// Lignes de commentaire seulement (vite.config.js contient « **/*.{js,…} »,
// qu'un retrait des blocs /* */ prendrait pour un commentaire).
const sansLignesCommentaires = (src) => src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const sansCommentairesSql = (src) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// Base d'un navigateur capable, état entièrement connu.
const BASE = Object.freeze({
  role: "conducteur", apercuVercel: false,
  supporteServiceWorker: true, supportePush: true, supporteNotification: true,
  ios: false, android: true, standalone: true,
  serviceWorkerActif: true, permission: "granted", serveur: "configure",
  abonnementLocal: true, appareilEnregistre: true,
});
const etat = (surcharges) => N.etatNotifications({ ...BASE, ...surcharges });

// ═══════════════════════════════════════════════════════════════════════════
// 1. État affiché dans le profil — exécuté
// ═══════════════════════════════════════════════════════════════════════════

test("1. ouvrier : jamais concerné, quel que soit l'état du navigateur", () => {
  assert.equal(N.roleConcerne("ouvrier"), false);
  assert.equal(N.roleConcerne(" Ouvrier "), false);
  assert.equal(N.roleConcerne(""), false);
  assert.equal(N.roleConcerne(null), false);
  for (const r of ["admin", "conducteur", "commercial", "comptable"]) assert.equal(N.roleConcerne(r), true, r);
  const e = etat({ role: "ouvrier" });
  assert.equal(e.code, "non_concerne");
  assert.deepEqual(e.actions, { activer: false, tester: false, desactiver: false });
});

test("2. activées seulement si permission + abonnement local + serveur confirmé", () => {
  assert.equal(etat({}).code, "activees");
  assert.equal(etat({}).ton, "ok");
  assert.deepEqual(etat({}).actions, { activer: false, tester: true, desactiver: true });
  assert.equal(etat({ appareilEnregistre: false }).code, "a_reenregistrer");
  assert.equal(etat({ appareilEnregistre: null }).code, "verification");
  assert.equal(etat({ abonnementLocal: false }).code, "non_activees");
  assert.equal(etat({ permission: "default", abonnementLocal: false, appareilEnregistre: null }).code, "non_activees");
  assert.equal(etat({ permission: "default" }).code, "non_activees", "permission non accordée : jamais « activées »");
});

test("3. un état inconnu ne ressemble jamais à « activées »", () => {
  const inconnus = [
    { serveur: "inconnu" }, { serveur: "injoignable" }, { serviceWorkerActif: null },
    { abonnementLocal: null }, { appareilEnregistre: null }, { serveur: "non_configure" },
  ];
  for (const s of inconnus) {
    const e = etat(s);
    assert.notEqual(e.code, "activees", JSON.stringify(s));
    assert.notEqual(e.ton, "ok", JSON.stringify(s));
    assert.equal(e.actions.tester, false, `pas de test proposé : ${JSON.stringify(s)}`);
  }
  // Seul l'état « activées » porte le ton « ok ».
  const tous = [
    {}, { apercuVercel: true }, { ios: true, standalone: false }, { supportePush: false },
    { permission: "denied" }, { serviceWorkerActif: false }, { serveur: "non_configure" },
    { serveur: "injoignable" }, { serveur: "inconnu" }, { appareilEnregistre: false }, { abonnementLocal: false },
  ];
  for (const s of tous) {
    const e = etat(s);
    assert.equal(e.ton === "ok", e.code === "activees", `${e.code} / ${e.ton}`);
  }
});

test("4. chaque impossibilité a son état distinct (règle 9)", () => {
  const codes = {
    apercu_vercel: etat({ apercuVercel: true }),
    ios_installer: etat({ ios: true, android: false, standalone: false, supportePush: false }),
    non_pris_en_charge: etat({ supportePush: false }),
    refusees: etat({ permission: "denied" }),
    sans_service_worker: etat({ serviceWorkerActif: false }),
    serveur_non_configure: etat({ serveur: "non_configure" }),
    serveur_injoignable: etat({ serveur: "injoignable" }),
  };
  for (const [code, e] of Object.entries(codes)) {
    assert.equal(e.code, code);
    assert.equal(e.actions.tester, false, code);
  }
  assert.match(codes.ios_installer.detail, /Partager › Sur l'écran d'accueil/);
  assert.match(codes.ios_installer.detail, /iOS 16\.4 minimum/);
  assert.match(codes.apercu_vercel.detail, /service worker/);
  assert.match(codes.serveur_non_configure.detail, /pas encore configurées sur le serveur/);
  assert.match(codes.refusees.detail, /Paramètres|Réglages|cadenas/);
  assert.match(etat({ permission: "denied", ios: true, standalone: true }).detail, /Réglages › Notifications/);
  // iPhone installé et capable : parcours normal.
  assert.equal(etat({ ios: true, android: false, standalone: true }).code, "activees");
});

test("5. phrase d'explication selon le rôle", () => {
  assert.match(N.phraseRole("conducteur"), /18h30/);
  assert.match(N.phraseRole("comptable"), /factures/);
  assert.match(N.phraseRole("comptable"), /encours fournisseurs/);
  assert.match(N.phraseRole("admin"), /rentabilité/);
  assert.match(N.phraseRole("admin"), /nouveaux chantiers/);
  assert.ok(N.phraseRole("commercial").length > 20);
});

test("6. détection iPhone / iPad", () => {
  assert.equal(N.estAppareilIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), true);
  assert.equal(N.estAppareilIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true);
  assert.equal(N.estAppareilIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }), false);
  assert.equal(N.estAppareilIOS({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" }), false);
  assert.equal(N.estAndroid({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" }), true);
});

test("7. clé publique : variable Vercel d'abord, serveur sinon, serveur si elles diffèrent", () => {
  assert.deepEqual(N.choisirClePublique({ cleEnv: "A", cleServeur: "" }), { cle: "A", source: "env", incoherence: false });
  assert.deepEqual(N.choisirClePublique({ cleEnv: "", cleServeur: "B" }), { cle: "B", source: "serveur", incoherence: false });
  assert.deepEqual(N.choisirClePublique({ cleEnv: "A", cleServeur: "A" }), { cle: "A", source: "env", incoherence: false });
  assert.deepEqual(N.choisirClePublique({ cleEnv: "A", cleServeur: "B" }), { cle: "B", source: "serveur", incoherence: true });
  assert.deepEqual(N.choisirClePublique({}), { cle: null, source: null, incoherence: false });
});

test("8. conversion base64url → octets (clé P-256 de 65 octets)", () => {
  const octets = new Uint8Array(65).map((_, i) => (i * 37 + 4) % 256);
  octets[0] = 4;
  const b64url = Buffer.from(octets).toString("base64url");
  assert.deepEqual(Array.from(N.base64UrlVersOctets(b64url)), Array.from(octets));
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Décisions des Edge Functions — exécutées
// ═══════════════════════════════════════════════════════════════════════════

test("9. appelant : refus par défaut, ouvrier refusé, bureau accepté", () => {
  const ok = { appelant: { id: "u1" }, profil: { role: "conducteur", actif: true }, collaborateurActif: true };
  assert.deepEqual(R.decisionAppelantPush(ok), { autorise: true });
  assert.equal(R.decisionAppelantPush({}).statut, 401);
  assert.equal(R.decisionAppelantPush({ ...ok, appelant: null }).statut, 401);
  assert.equal(R.decisionAppelantPush({ ...ok, collaborateurActif: false }).statut, 403);
  assert.equal(R.decisionAppelantPush({ ...ok, collaborateurActif: undefined }).statut, 403);
  assert.equal(R.decisionAppelantPush({ ...ok, profil: null }).statut, 403);
  assert.equal(R.decisionAppelantPush({ ...ok, profil: { role: "admin", actif: false } }).statut, 403);
  assert.equal(R.decisionAppelantPush({ ...ok, profil: { role: "ouvrier", actif: true } }).statut, 403);
  assert.equal(R.decisionAppelantPush({ ...ok, profil: { role: "", actif: true } }).statut, 403);
  for (const r of ["admin", "conducteur", "commercial", "comptable"]) {
    assert.equal(R.decisionAppelantPush({ ...ok, profil: { role: r, actif: true } }).autorise, true, r);
  }
  assert.equal(R.extraireJeton("Bearer a.b.c"), "a.b.c");
  assert.equal(R.extraireJeton("Bearer a b"), null);
  assert.equal(R.extraireJeton(null), null);
});

test("10. clés VAPID absentes : 503 explicite, jamais d'envoi muet", () => {
  const r = R.clesVapid({});
  assert.equal(r.ok, false);
  assert.equal(r.statut, 503);
  assert.equal(r.code, "serveur_non_configure");
  assert.match(r.erreur, /non configurées sur le serveur/);
  assert.deepEqual(r.manquantes, ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
  assert.deepEqual(R.clesVapid({ publique: "p", privee: "k", sujet: "" }).manquantes, ["VAPID_SUBJECT"]);
  assert.deepEqual(R.clesVapid({ publique: " p ", privee: "k", sujet: "mailto:x@y.fr" }),
    { ok: true, publique: "p", privee: "k", sujet: "mailto:x@y.fr" });
});

test("11. abonnement envoyé par le navigateur : validé", () => {
  const p256dh = Buffer.alloc(65, 7).toString("base64url");
  const auth = Buffer.alloc(16, 3).toString("base64url");
  const bon = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh, auth } };
  assert.deepEqual(R.validerAbonnement({ subscription: bon }), { ok: true, endpoint: bon.endpoint, p256dh, auth });
  assert.equal(R.validerAbonnement(bon).ok, true);
  assert.equal(R.validerAbonnement({ ...bon, endpoint: "http://non-chiffre" }).ok, false);
  assert.equal(R.validerAbonnement({ ...bon, keys: { p256dh: "court", auth } }).ok, false);
  assert.equal(R.validerAbonnement({ ...bon, keys: { p256dh, auth: "" } }).ok, false);
  assert.equal(R.validerAbonnement(null).ok, false);
});

test("12. réponse du service push : 404/410 → suppression, 2xx → date d'utilisation", () => {
  assert.equal(R.suiteReponseService(404), "supprimer");
  assert.equal(R.suiteReponseService(410), "supprimer");
  assert.equal(R.suiteReponseService(201), "marquer_utilise");
  assert.equal(R.suiteReponseService(200), "marquer_utilise");
  for (const s of [400, 403, 413, 429, 500, 503, null, undefined]) assert.equal(R.suiteReponseService(s), "garder", String(s));
  assert.deepEqual(R.resumerEnvoi([
    { ok: true, suite: "marquer_utilise" }, { ok: false, suite: "supprimer" }, { ok: false, suite: "garder" },
  ]), { appareils: 3, envoyes: 1, supprimes: 1, echecs: 1 });
});

test("13. send-push : test ouvert aux collaborateurs, serveur et rattrapage réservés au secret serveur", () => {
  assert.deepEqual(R.validerDemandeSendPush({ mode: "test" }), { ok: true, mode: "test", serveur: false });
  assert.deepEqual(R.validerDemandeSendPush({}), { ok: true, mode: "test", serveur: false });
  assert.deepEqual(R.validerDemandeSendPush({ mode: "serveur" }), { ok: true, mode: "serveur", serveur: true });
  assert.deepEqual(R.validerDemandeSendPush({ mode: "reportes" }), { ok: true, mode: "reportes", serveur: true });
  assert.equal(R.validerDemandeSendPush({ mode: "tout_le_monde" }).statut, 400);
  // Clé serveur : fermé par défaut.
  assert.equal(R.estCleServeur("abc", "abc"), true);
  assert.equal(R.estCleServeur("abd", "abc"), false);
  assert.equal(R.estCleServeur("ab", "abc"), false);
  assert.equal(R.estCleServeur("abcd", "abc"), false);
  assert.equal(R.estCleServeur("", ""), false, "clé absente du serveur : refus");
  assert.equal(R.estCleServeur(null, "abc"), false);
  assert.equal(R.estCleServeur("abc", undefined), false);
  // Appel serveur (09/11/2026 : clé de Vercel ≠ clé injectée dans la fonction).
  // Exemple issu des tests, données fictives : aucune vraie clé.
  const jwt = (charge) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.signature-fictive`;
  const cleService = jwt({ iss: "supabase", role: "service_role", iat: 1 });
  const autreService = jwt({ iss: "supabase", role: "service_role", iat: 2 });
  const anon = jwt({ iss: "supabase", role: "anon", iat: 1 });
  const utilisateur = jwt({ sub: "u-fictif", role: "authenticated" });
  const secretes = R.lireDictionnaireCles(JSON.stringify({ default: "sb_secret_fictif_1", vercel: "sb_secret_fictif_2" }));
  const env = { cleService, clesSecretes: secretes, clesPubliques: [anon, "sb_publishable_fictif"] };
  assert.deepEqual(secretes, ["sb_secret_fictif_1", "sb_secret_fictif_2"]);
  assert.deepEqual(R.lireDictionnaireCles("pas du json"), []);
  assert.deepEqual(R.lireDictionnaireCles(undefined), []);
  assert.deepEqual(R.lireDictionnaireCles('["sb_secret_x"]'), [], "tableau : refusé");
  assert.equal(R.decisionCleServeur({ jeton: cleService, ...env }), "accepte", "jeton = clé service role");
  assert.equal(R.decisionCleServeur({ jeton: "sb_secret_fictif_2", ...env }), "accepte", "jeton dans SUPABASE_SECRET_KEYS");
  assert.equal(R.decisionCleServeur({ jeton: "sb_secret_fictif_2", clesSecretes: secretes }), "accepte", "sans clé service role");
  assert.equal(R.decisionCleServeur({ jeton: anon, ...env }), "refuse", "clé anon");
  assert.equal(R.decisionCleServeur({ jeton: anon }), "refuse", "JWT anon même inconnu");
  assert.equal(R.decisionCleServeur({ jeton: "sb_publishable_fictif", ...env }), "refuse", "clé publishable");
  assert.equal(R.decisionCleServeur({ jeton: utilisateur, ...env }), "refuse", "jeton utilisateur");
  assert.equal(R.decisionCleServeur({ jeton: "", ...env }), "refuse", "jeton vide");
  assert.equal(R.decisionCleServeur({ jeton: null, ...env }), "refuse", "jeton absent");
  assert.equal(R.decisionCleServeur({ jeton: "", cleService: "" }), "refuse", "tout vide");
  assert.equal(R.decisionCleServeur({ jeton: "n-importe-quoi", ...env }), "refuse", "format inconnu");
  assert.equal(R.decisionCleServeur({ jeton: "a.b.c", ...env }), "refuse", "faux JWT");
  // Clé secrète d'apparence valide mais inconnue de la fonction : Supabase Auth tranche.
  assert.equal(R.decisionCleServeur({ jeton: autreService, ...env }), "a_verifier");
  assert.equal(R.decisionCleServeur({ jeton: "sb_secret_inconnue", ...env }), "a_verifier");
  assert.equal(R.roleDuJeton(utilisateur), "authenticated");
  assert.equal(R.roleDuJeton("sb_secret_x"), null);
  assert.equal(R.formeCle(cleService), "jwt:service_role");
  assert.equal(R.formeCle("sb_secret_fictif_1"), "sb_secret");
  assert.equal(R.formeCle(""), "absente");
  const t = R.chargeUtileTest();
  assert.equal(t.url, "/");
  assert.ok(t.title && t.body);
});

test("14. modules purs : aucun accès Supabase, aucune horloge", () => {
  for (const f of ["src/notificationsPush.mjs", "supabase/functions/_partage/pushRegles.mjs", "supabase/functions/_partage/notificationsPushV1.mjs"]) {
    const code = sansCommentaires(lire(f));
    assert.ok(!/supabase/i.test(code.replace(/supabase\/functions/g, "")), `${f} : pas de Supabase`);
    assert.ok(!/Date\.now|new Date|Math\.random|fetch\(|setTimeout/.test(code), `${f} : pas d'horloge ni d'effet`);
    assert.ok(!/^import /m.test(code), `${f} : aucune dépendance`);
  }
  assert.match(lire("src/notificationsPush.js"), /export \* from "\.\/notificationsPush\.mjs"/);
  assert.match(lire("src/notificationsPushV1.js"), /export \* from "\.\.\/supabase\/functions\/_partage\/notificationsPushV1\.mjs"/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Garde-fous statiques
// ═══════════════════════════════════════════════════════════════════════════

test("15. service worker : push-sw.js importé, generateSW, jamais skipWaiting", () => {
  assert.ok(existsSync(chemin("public/push-sw.js")), "public/push-sw.js présent");
  const vite = sansLignesCommentaires(lire("vite.config.js"));
  assert.match(vite, /importScripts:\s*\[\s*['"]push-sw\.js['"]\s*\]/);
  assert.match(vite, /skipWaiting:\s*false/);
  assert.ok(!/skipWaiting:\s*true/.test(vite));
  assert.ok(!/injectManifest/.test(vite), "on reste en generateSW");
  assert.match(vite, /registerType:\s*'prompt'/);
  const sw = sansCommentaires(lire("public/push-sw.js"));
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /showNotification\(/);
  assert.match(sw, /openWindow\(/);
  assert.match(sw, /\.focus\(\)/);
  assert.ok(!/skipWaiting|clients\.claim|caches\.|addEventListener\('fetch'/.test(sw),
    "push-sw.js ne touche ni à la mise à jour, ni au cache, ni aux requêtes");
  assert.ok(!/\.navigate\(/.test(sw), "un onglet ouvert n'est jamais rechargé de force (saisie en cours)");
});

test("16. previews Vercel inchangées : le service worker y est toujours désinscrit", () => {
  const pwa = sansLignesCommentaires(lire("src/pwa.js"));
  assert.match(pwa, /if \(isVercelPreviewHost\(\)\) \{\s*void disablePreviewPWA\(\)\s*return\s*\}/);
  assert.match(pwa, /reg\.unregister\(\)/);
});

const MIGRATIONS = readdirSync(chemin("supabase/migrations")).filter((f) => /_push_subscriptions\.sql$/.test(f));

test("17. migration : une seule, seule la policy restrictive, aucune SECURITY DEFINER", () => {
  assert.equal(MIGRATIONS.length, 1, "une migration push_subscriptions");
  const sql = sansCommentairesSql(lire(`supabase/migrations/${MIGRATIONS[0]}`)).toLowerCase();
  assert.match(sql, /create table if not exists public\.push_subscriptions/);
  assert.match(sql, /references auth\.users\(id\)/);
  assert.match(sql, /endpoint\s+text not null unique/);
  assert.match(sql, /alter table public\.push_subscriptions enable row level security/);
  const policies = sql.match(/create policy\s+\w+/g) || [];
  assert.deepEqual(policies.map((p) => p.split(/\s+/).pop()), ["profero_collaborateurs_seulement"],
    "aucune autre policy que profero_collaborateurs_seulement (journal du 06/11/2026)");
  assert.match(sql, /as restrictive for all to authenticated/);
  assert.match(sql, /using \(\(select public\.est_collaborateur_actif\(\)\)\) with check \(\(select public\.est_collaborateur_actif\(\)\)\)/);
  assert.ok(!/security definer/.test(sql), "aucune fonction SECURITY DEFINER");
  assert.ok(!/create (or replace )?function/.test(sql), "aucune fonction");
  assert.ok(!/grant [^;]* to authenticated/.test(sql), "aucun droit direct pour le navigateur");
  assert.ok(!/\b(drop table|delete from|update |alter table (?!public\.push_subscriptions))/.test(sql), "purement additive");
});

test("18. espace ouvrier : aucun bloc notifications, aucune demande d'autorisation", () => {
  const dossier = "src/Renovation";
  const fichiersOuvrier = readdirSync(chemin(dossier))
    .filter((f) => /ouvrier/i.test(f) && /\.(jsx?|mjs)$/.test(f) && f !== "PageNotesOuvriers.jsx");
  assert.ok(fichiersOuvrier.includes("EspaceOuvrier.jsx"));
  for (const f of fichiersOuvrier) {
    const code = lire(`${dossier}/${f}`);
    assert.ok(!/ProfilNotifications|BlocNotificationsTelephone|PanneauProfil|ClocheNotifications|BoutonCloche|PanneauBoite|notifications-boite/.test(code), `${f} : pas de bloc notifications ni de cloche`);
    assert.ok(!/requestPermission|pushManager|push-abonnement|send-push/.test(code), `${f} : aucune demande de notification`);
  }
});

test("19. profil : demande d'autorisation au clic seulement, jamais au chargement", () => {
  const code = sansCommentaires(lire("src/Renovation/ProfilNotifications.jsx"));
  const appels = code.match(/requestPermission\(/g) || [];
  assert.equal(appels.length, 1, "une seule demande d'autorisation");
  const iActiver = code.indexOf("const activer = async");
  const iDemande = code.indexOf("requestPermission(");
  const iTester = code.indexOf("const tester = async");
  assert.ok(iActiver > 0 && iActiver < iDemande && iDemande < iTester, "dans le gestionnaire du bouton « Activer »");
  assert.match(code, /onClick=\{activer\}/);
  assert.match(code, /Activer les notifications/);
  assert.match(code, /Envoyer une notification de test/);
  assert.match(code, /if \(!concerne\) return null;/);
  assert.match(code, /if \(!roleConcerne\(role\)\) return null;/);
  assert.ok(!/from\(["']push_subscriptions["']\)/.test(code), "le navigateur ne lit jamais la table");
});

test("20. le panneau profil n'est rendu que pour un rôle bureau", () => {
  const app = lire("src/App.jsx");
  assert.match(app, /\{profilOuvert&&role!=="ouvrier"&&<PanneauProfil /);
  assert.match(app, /onOuvrirProfil=\{role!=="ouvrier"\?/);
  // Le panneau n'est pas une page : src/access.js n'est pas modifié pour lui.
  assert.ok(!/profil|notifications-telephone/i.test(lire("src/access.js").match(/ROLE_PAGES_DEFAULT_RENOVATION = \{[\s\S]*?\n\};/)?.[0] || ""));
});

test("21. Edge Functions : JWT exigé, appelant contrôlé avant toute écriture", () => {
  const config = lire("supabase/config.toml");
  assert.match(config, /\[functions\.push-abonnement\]\s*\nverify_jwt = true/);
  assert.match(config, /\[functions\.send-push\]\s*\nverify_jwt = true/);
  assert.match(config, /\[functions\.notifications-boite\]\s*\nverify_jwt = true/);
  const abo = sansCommentaires(lire("supabase/functions/push-abonnement/index.ts"));
  for (const methode of ["POST", "DELETE"]) {
    const bloc = abo.slice(abo.indexOf(`req.method === "${methode}"`));
    const iQui = bloc.indexOf("identifierAppelant(req)");
    const iRefus = bloc.indexOf("if (!qui.ok) return qui.reponse");
    const iTable = bloc.indexOf('from("push_subscriptions")');
    assert.ok(iQui > 0 && iQui < iRefus && iRefus < iTable, `${methode} : contrôle avant écriture`);
  }
  assert.match(abo, /\.eq\("user_id", qui\.userId\)/);
  const envoi = sansCommentaires(lire("supabase/functions/send-push/index.ts"));
  const blocTest = envoi.slice(envoi.indexOf("async function modeTest"));
  const iQui = blocTest.indexOf("identifierAppelant(req)");
  const iLecture = blocTest.indexOf('.from("push_subscriptions")');
  assert.ok(iQui > 0 && iQui < iLecture, "send-push : appelant contrôlé avant lecture des appareils");
  assert.match(blocTest, /\.eq\("user_id", qui\.userId\)/, "test : seulement SES appareils");
  assert.match(envoi, /suiteReponseService\(statut\)/);
  // Modes serveur : secret vérifié avant toute lecture.
  const porte = envoi.slice(envoi.indexOf("Deno.serve("));
  const iSecret = porte.indexOf("if (!(await estAppelServeur(req))) return");
  const iClient = porte.indexOf("clientServeur()");
  assert.ok(iSecret > 0 && iSecret < iClient, "send-push serveur : secret contrôlé avant tout accès");
  const serveur = sansCommentaires(lire("supabase/functions/_partage/pushServeur.ts"));
  const blocAppel = serveur.slice(serveur.indexOf("export async function estAppelServeur"));
  assert.match(blocAppel, /decisionCleServeur\(\{/, "décision pure testée ci-dessus");
  assert.match(blocAppel, /cleService: Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(blocAppel, /lireDictionnaireCles\(Deno\.env\.get\("SUPABASE_SECRET_KEYS"\)\)/);
  assert.match(blocAppel, /if \(decision === "refuse" \|\| !jeton\) return false/, "refus sans appel réseau");
  assert.match(serveur, /\/auth\/v1\/admin\/users\?per_page=1/, "dernier recours : Supabase Auth");
  assert.match(serveur, /ok = rep\.status === 200/, "seul un 200 accepte");
  assert.ok(!/create_edge_function_secret|console\.log\(.*jeton/.test(serveur), "aucun secret créé ni affiché");
  assert.match(serveur, /rpc\("est_collaborateur_actif"\)/);
  assert.match(serveur, /Deno\.env\.get\("VAPID_PRIVATE_KEY"\)/);
});

test("22. aucune clé privée VAPID écrite dans le dépôt", () => {
  const fichiers = [
    "supabase/functions/_partage/pushServeur.ts", "supabase/functions/_partage/pushRegles.mjs",
    "supabase/functions/send-push/index.ts", "supabase/functions/push-abonnement/index.ts",
    "src/notificationsPush.mjs", "src/Renovation/ProfilNotifications.jsx", "public/push-sw.js",
    "vite.config.js", "docs/projets/notifications-push.md",
    "supabase/functions/_partage/notificationsPushV1.mjs", "supabase/functions/notifications-boite/index.ts",
    "api/_cron/cron-push-reportes.js", ".github/workflows/cron-push-reportes.yml",
    "supabase/functions/notifications-pilotage/index.ts", "supabase/functions/_partage/utilisateursPush.ts",
    "src/Renovation/ClocheNotifications.jsx", "src/Renovation/ReglagesNotificationsAdmin.jsx",
  ];
  for (const f of fichiers) {
    const code = lire(f);
    assert.ok(!/VAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{40,}/.test(code), `${f} : pas de clé privée`);
    assert.ok(!/privateKey:\s*["'][A-Za-z0-9_-]{40,}["']/.test(code), `${f} : pas de clé privée en dur`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Moteur des envois (tâche 2) — exécuté, données fictives
// ═══════════════════════════════════════════════════════════════════════════

const ms = (iso) => Date.parse(iso);
const iso = (n) => (n == null ? null : new Date(n).toISOString());
const S = V.SILENCE_DEFAUT;
// Utilisateurs fictifs (aucune donnée réelle).
const UTILISATEURS = [
  { auth_id: "a1", nom: "Admin Un", role: "admin", actif: true, branches: ["renovation", "invest"] },
  { auth_id: "a2", nom: "Admin Deux", role: "admin", actif: true, branches: ["renovation"] },
  { auth_id: "c1", nom: "Conducteur Un", role: "conducteur", actif: true, branches: ["renovation"] },
  { auth_id: "k1", nom: "Comptable", role: "comptable", actif: true, branches: ["renovation"] },
  { auth_id: "o1", nom: "Ouvrier Un", role: "ouvrier", actif: true, branches: ["renovation"] },
  { auth_id: "o2", nom: "Ouvrier Deux", role: "Ouvrier", actif: true, branches: ["renovation"] },
  { auth_id: "x1", nom: "Ancien admin", role: "admin", actif: false, branches: ["renovation"] },
  { auth_id: null, nom: "Admin sans compte", role: "admin", actif: true, branches: ["renovation"] },
  { auth_id: "i1", nom: "Commercial Invest", role: "commercial", actif: true, branches: ["invest"] },
];
const ALLUME = (surcharges = {}) => V.normaliserReglages({ actif: true, ...surcharges });
const MARDI_10H = ms("2026-11-10T09:00:00Z"); // mardi 10h00 Paris (heure d'hiver)
const plan = (p) => V.planifierEnvoi({
  reglages: ALLUME(), type: "D2", utilisateurs: UTILISATEURS,
  appareils: { a1: 1, a2: 2, c1: 1, k1: 1, o1: 1, o2: 1, i1: 1 },
  maintenantMs: MARDI_10H, vapidConfiguree: true, ...p,
});

test("23. réglages : absents → défauts, interrupteur général COUPÉ, catalogue C1…D4", () => {
  const r = V.normaliserReglages(null);
  assert.equal(r.actif, false, "livré coupé");
  assert.equal(r.source, "defaut");
  assert.deepEqual(Object.keys(r.types), ["C1", "C2", "C3", "C4", "C5", "F1", "F2", "D1", "D2", "D3", "D4"]);
  // Décision de Loris du 06/11/2026 (aucun compte conducteur) : conducteur + admin.
  for (const c of ["C1", "C2", "C3", "C4", "C5"]) assert.deepEqual(r.types[c].roles, ["conducteur", "admin"], c);
  for (const c of ["F1", "F2"]) assert.deepEqual(r.types[c].roles, ["comptable"], c);
  for (const c of ["D1", "D3", "D4"]) assert.deepEqual(r.types[c].roles, ["admin"], c);
  assert.deepEqual(r.types.D2.roles, ["admin", "conducteur"]);
  assert.ok(Object.values(r.types).every((t) => t.actif === true));
  assert.deepEqual(r.silence, { debut: "20:00", fin: "07:00", jours: ["samedi", "dimanche"] });
  assert.equal(V.typeDuCatalogue("D4").push, false, "D4 : boîte seulement");
  assert.equal(V.normaliserReglages({ actif: "oui" }).actif, false, "seul true allume");
  assert.equal(V.CLE_REGLAGES, "notifications_push");
  // Le réglage mail « facture à émettre » est une autre clé, non lue ici.
  assert.notEqual(V.CLE_REGLAGES, "echeancier_facturation");
  // Aucun rôle ouvrier dans le catalogue.
  for (const t of V.CATALOGUE) assert.ok(!t.roles.includes("ouvrier"), t.code);
});

test("24. ouvrier : jamais destinataire, même coché à la main en base", () => {
  const r = V.normaliserReglages({ actif: true, types: { D2: { actif: true, roles: ["admin", "ouvrier", " OUVRIER "] } } });
  assert.deepEqual(r.types.D2.roles, ["admin"]);
  assert.ok(r.avertissements.some((a) => /ouvrier/.test(a)));
  // Même si des réglages bruts (non normalisés) contiennent « ouvrier ».
  const brut = { actif: true, types: { D2: { actif: true, roles: ["ouvrier", "admin"] } }, silence: S };
  const d = V.destinataires({ reglages: brut, type: "D2", utilisateurs: UTILISATEURS });
  assert.ok(d.liste.every((u) => u.role !== "ouvrier"));
  assert.equal(d.ignores.ouvrier, 2);
  const p = plan({ reglages: brut });
  assert.ok(p.lignes.every((l) => !["o1", "o2"].includes(l.user_id)));
});

test("25. destinataires : actifs des rôles cochés, avec compte, rattachés à la Rénovation", () => {
  const p = plan({});
  assert.deepEqual(p.lignes.map((l) => l.user_id).sort(), ["a1", "a2", "c1"]);
  assert.deepEqual(p.resume.destinataires_par_role, { admin: 2, conducteur: 1 });
  assert.deepEqual(p.resume.ignores, { ouvrier: 0, inactif: 1, sans_compte: 1, hors_renovation: 0, doublon: 0 });
  assert.equal(p.resume.a_envoyer, 3);
  assert.equal(p.resume.envoi_reel, true);
  const commercial = V.planifierEnvoi({
    reglages: ALLUME({ types: { F2: { actif: true, roles: ["commercial"] } } }), type: "F2",
    utilisateurs: UTILISATEURS, maintenantMs: MARDI_10H, vapidConfiguree: true,
  });
  assert.equal(commercial.lignes.length, 0);
  assert.equal(commercial.resume.ignores.hors_renovation, 1, "un compte Invest seul n'est pas destinataire");
});

test("26. aucun rôle coché : zéro destinataire, rien n'est écrit", () => {
  const p = plan({ reglages: ALLUME({ types: { D2: { actif: true, roles: [] } } }) });
  assert.equal(p.resume.bloque_par, "aucun_role");
  assert.equal(p.lignes.length, 0);
  assert.equal(p.resume.destinataires, 0);
});

test("27. type désactivé : rien n'est envoyé ni écrit", () => {
  const p = plan({ reglages: ALLUME({ types: { D2: { actif: false, roles: ["admin"] } } }) });
  assert.equal(p.resume.bloque_par, "type_desactive");
  assert.equal(p.lignes.length, 0);
  assert.equal(p.resume.envoi_reel, false);
});

test("28. interrupteur général coupé : rien (ni push ni boîte) ; la simulation calcule quand même", () => {
  const coupe = V.normaliserReglages(null);
  const p = plan({ reglages: coupe });
  assert.equal(p.resume.bloque_par, "interrupteur_coupe");
  assert.equal(p.lignes.length, 0);
  assert.equal(p.resume.envoi_reel, false);
  const sim = plan({ reglages: coupe, simulation: true });
  assert.equal(sim.resume.bloque_par, "interrupteur_coupe", "la simulation dit que l'envoi réel serait bloqué");
  assert.equal(sim.resume.envoi_reel, false);
  assert.deepEqual(sim.resume.destinataires_par_role, { admin: 2, conducteur: 1 });
  // Le test demandé à la main passe malgré l'interrupteur coupé et la plage de silence.
  assert.deepEqual(V.planifierTest({ nbAppareils: 1, vapidConfiguree: true }), { push_statut: "a_envoyer", push_prevu_le: null });
  const envoi = sansCommentaires(lire("supabase/functions/send-push/index.ts"));
  const blocTest = envoi.slice(envoi.indexOf("async function modeTest"), envoi.indexOf("Deno.serve("));
  assert.ok(!/lireReglages|planifierEnvoi|estEnSilence/.test(blocTest), "le test ne lit ni l'interrupteur ni la plage de silence");
  assert.match(blocTest, /from\("notifications"\)\.insert\(/, "le test est écrit dans la boîte");
});

test("29. préférence coupée : pas de push, la notification reste en boîte", () => {
  const p = plan({ preferences: { a1: { D2: false }, a2: { C1: false } } });
  const parId = Object.fromEntries(p.lignes.map((l) => [l.user_id, l.push_statut]));
  assert.equal(parId.a1, "desactive");
  assert.equal(parId.a2, "a_envoyer", "couper C1 ne coupe pas D2");
  assert.equal(p.resume.desactives, 1);
  assert.equal(V.preferenceActive(undefined, "D2"), true, "activé par défaut");
  assert.equal(V.preferenceActive({ D2: true }, "D2"), true);
  assert.equal(V.validerPreferences({ types: { C1: false, D2: true } }).ok, true);
  assert.equal(V.validerPreferences({ types: { Z9: false } }).ok, false);
  assert.equal(V.validerPreferences({ types: { C1: "non" } }).ok, false);
  assert.equal(V.validerPreferences({}).ok, false);
});

test("30. impossibilités visibles : aucun appareil, serveur non configuré, D4 boîte seule", () => {
  const p = plan({ appareils: {}, vapidConfiguree: true });
  assert.ok(p.lignes.every((l) => l.push_statut === "aucun_appareil"));
  const q = plan({ vapidConfiguree: false });
  assert.ok(q.lignes.every((l) => l.push_statut === "serveur_non_configure"), "écrit en boîte avec statut explicite");
  assert.equal(q.resume.serveur_non_configure, 3);
  const d4 = V.planifierEnvoi({ reglages: ALLUME(), type: "D4", utilisateurs: UTILISATEURS, appareils: { a1: 1 }, maintenantMs: MARDI_10H, vapidConfiguree: true });
  assert.ok(d4.lignes.every((l) => l.push_statut === "boite_seule"));
  assert.deepEqual(V.planifierTest({ nbAppareils: 0, vapidConfiguree: false }).push_statut, "serveur_non_configure");
  assert.deepEqual(V.planifierTest({ nbAppareils: 0, vapidConfiguree: true }).push_statut, "aucun_appareil");
  for (const l of [...p.lignes, ...q.lignes, ...d4.lignes]) assert.ok(V.PUSH_STATUTS.includes(l.push_statut));
  assert.equal(V.statutApresEnvoi([{ ok: false, suite: "garder" }, { ok: true, suite: "marquer_utilise" }]), "envoye");
  assert.equal(V.statutApresEnvoi([{ ok: false, suite: "garder" }]), "echec");
  assert.equal(V.statutApresEnvoi([{ ok: false, suite: "supprimer" }]), "aucun_appareil");
  assert.equal(V.statutApresEnvoi([]), "aucun_appareil");
});

test("31. plage de silence : vendredi 19h59 / 20h00, dimanche, matin 6h59 / 7h00", () => {
  // Vendredi 06/11/2026, heure d'hiver (UTC+1).
  assert.equal(V.estEnSilence(ms("2026-11-06T18:59:00Z"), S), false, "vendredi 19h59");
  assert.equal(V.estEnSilence(ms("2026-11-06T19:00:00Z"), S), true, "vendredi 20h00");
  assert.equal(V.estEnSilence(ms("2026-11-08T11:00:00Z"), S), true, "dimanche midi");
  assert.equal(V.estEnSilence(ms("2026-11-07T09:00:00Z"), S), true, "samedi 10h");
  assert.equal(V.estEnSilence(ms("2026-11-09T05:59:00Z"), S), true, "lundi 6h59");
  assert.equal(V.estEnSilence(ms("2026-11-09T06:00:00Z"), S), false, "lundi 7h00");
  // Heure d'été (UTC+2) : 7h00 Paris = 5h00 UTC.
  assert.equal(V.estEnSilence(ms("2026-07-01T04:59:00Z"), S), true, "mercredi 6h59 (été)");
  assert.equal(V.estEnSilence(ms("2026-07-01T05:00:00Z"), S), false, "mercredi 7h00 (été)");
  assert.equal(V.estEnSilence(ms("2026-07-01T17:59:00Z"), S), false, "mercredi 19h59 (été)");
  assert.equal(V.estEnSilence(ms("2026-07-01T18:00:00Z"), S), true, "mercredi 20h00 (été)");
  // Plage réglée autrement.
  const midi = { debut: "12:00", fin: "14:00", jours: [] };
  assert.equal(V.estEnSilence(ms("2026-11-10T11:30:00Z"), midi), true);
  assert.equal(V.estEnSilence(ms("2026-11-10T13:00:00Z"), midi), false);
  assert.equal(V.estEnSilence(ms("2026-11-08T11:00:00Z"), { debut: "20:00", fin: "20:00", jours: [] }), false);
});

test("32. prochain créneau : lundi 7h, changement d'heure compris", () => {
  assert.equal(iso(V.prochainCreneau(ms("2026-11-06T18:59:00Z"), S)), "2026-11-06T18:59:00.000Z", "autorisé : maintenant");
  assert.equal(iso(V.prochainCreneau(ms("2026-11-06T19:00:00Z"), S)), "2026-11-09T06:00:00.000Z", "vendredi 20h → lundi 7h");
  assert.equal(iso(V.prochainCreneau(ms("2026-11-08T11:00:00Z"), S)), "2026-11-09T06:00:00.000Z", "dimanche → lundi 7h");
  assert.equal(iso(V.prochainCreneau(ms("2026-11-10T22:30:00Z"), S)), "2026-11-11T06:00:00.000Z", "mardi 23h30 → mercredi 7h");
  assert.equal(iso(V.prochainCreneau(ms("2026-11-11T02:00:00Z"), S)), "2026-11-11T06:00:00.000Z", "mercredi 3h → mercredi 7h");
  // Passage à l'heure d'été : dimanche 28/03/2027 (2h → 3h).
  assert.equal(iso(V.prochainCreneau(ms("2027-03-26T20:00:00Z"), S)), "2027-03-29T05:00:00.000Z", "vendredi 21h CET → lundi 7h CEST");
  assert.equal(iso(V.prochainCreneau(ms("2027-03-27T20:00:00Z"), S)), "2027-03-29T05:00:00.000Z", "samedi soir → lundi 7h CEST");
  assert.equal(iso(V.prochainCreneau(ms("2027-03-28T01:30:00Z"), S)), "2027-03-29T05:00:00.000Z", "dimanche 3h30 CEST → lundi 7h");
  // Passage à l'heure d'hiver : dimanche 25/10/2026 (3h → 2h).
  assert.equal(iso(V.prochainCreneau(ms("2026-10-23T18:30:00Z"), S)), "2026-10-26T06:00:00.000Z", "vendredi 20h30 CEST → lundi 7h CET");
  assert.equal(iso(V.prochainCreneau(ms("2026-10-25T00:30:00Z"), S)), "2026-10-26T06:00:00.000Z", "dimanche 2h30 → lundi 7h CET");
  assert.equal(V.parisVersUtcMs(2027, 3, 29, 7, 0), ms("2027-03-29T05:00:00Z"));
  assert.equal(V.parisVersUtcMs(2026, 10, 26, 7, 0), ms("2026-10-26T06:00:00Z"));
  assert.equal(V.partiesParis(ms("2026-10-25T00:30:00Z")).heure, 2);
  assert.equal(V.partiesParis(ms("2026-10-25T01:30:00Z")).heure, 2, "2h30 existe deux fois");
  // Tous les jours bloqués : aucun créneau, et c'est dit.
  const jamais = { debut: "20:00", fin: "07:00", jours: [...V.JOURS] };
  assert.equal(V.prochainCreneau(ms("2026-11-10T09:00:00Z"), jamais), null);
});

test("33. envoi pendant la plage de silence : écrit en boîte, push reporté au prochain créneau", () => {
  const vendredi21h = ms("2026-11-06T20:00:00Z");
  const p = plan({ maintenantMs: vendredi21h });
  assert.ok(p.lignes.length === 3);
  assert.ok(p.lignes.every((l) => l.push_statut === "reporte"));
  assert.ok(p.lignes.every((l) => iso(l.push_prevu_le) === "2026-11-09T06:00:00.000Z"));
  assert.equal(p.resume.reportes, 3);
  assert.equal(iso(p.resume.prochain_creneau), "2026-11-09T06:00:00.000Z");
  // Préférence coupée l'emporte sur le report ; D4 reste en boîte seule.
  const q = plan({ maintenantMs: vendredi21h, preferences: { a1: { D2: false } } });
  assert.equal(q.lignes.find((l) => l.user_id === "a1").push_statut, "desactive");
  const jamais = V.normaliserReglages({ actif: true, silence: { debut: "20:00", fin: "07:00", jours: [...V.JOURS] } });
  assert.ok(plan({ reglages: jamais }).lignes.every((l) => l.push_statut === "aucun_creneau"));
});

test("34. rattrapage à 7h05 : revérifie interrupteur, type, préférence, silence", () => {
  const lundi7h05 = ms("2026-11-09T06:05:00Z");
  const base = { reglages: ALLUME(), type: "D2", prefActive: true, nbAppareils: 1, vapidConfiguree: true, maintenantMs: lundi7h05 };
  assert.equal(V.decisionRattrapage(base).push_statut, "a_envoyer");
  assert.equal(V.decisionRattrapage({ ...base, reglages: V.normaliserReglages(null) }).push_statut, "annule", "interrupteur coupé entre-temps");
  assert.equal(V.decisionRattrapage({ ...base, reglages: ALLUME({ types: { D2: { actif: false } } }) }).push_statut, "annule");
  assert.equal(V.decisionRattrapage({ ...base, prefActive: false }).push_statut, "desactive");
  assert.equal(V.decisionRattrapage({ ...base, nbAppareils: 0 }).push_statut, "aucun_appareil");
  assert.equal(V.decisionRattrapage({ ...base, vapidConfiguree: false }).push_statut, "serveur_non_configure");
  const tot = V.decisionRattrapage({ ...base, maintenantMs: ms("2026-11-09T05:05:00Z") });
  assert.equal(tot.push_statut, "reporte", "6h05 en hiver : encore en silence");
  assert.equal(iso(tot.push_prevu_le), "2026-11-09T06:00:00.000Z");
});

test("35. regroupement idempotent : une notification par type et par créneau", () => {
  const premier = plan({});
  assert.equal(premier.cle, "D2:2026-11-10", "clé par défaut : type + jour de Paris");
  const second = plan({ dejaNotifies: premier.lignes.map((l) => l.user_id) });
  assert.equal(second.lignes.length, 0, "rejouer le job ne crée aucun doublon");
  assert.equal(second.resume.doublons, 3);
  const partiel = plan({ dejaNotifies: ["a1"] });
  assert.deepEqual(partiel.lignes.map((l) => l.user_id).sort(), ["a2", "c1"]);
  assert.equal(plan({ cle: "D2:chantier-42" }).cle, "D2:chantier-42", "clé fournie par l'appelant");
  assert.equal(V.cleRegroupementParDefaut("C1", ms("2026-11-06T23:30:00Z")), "C1:2026-11-07", "jour de Paris, pas d'UTC");
  // La base garantit l'unicité même si deux passages se croisent.
  const sql = sansCommentairesSql(lire(`supabase/migrations/${MIGRATION_BOITE}`)).toLowerCase();
  assert.match(sql, /create unique index if not exists notifications_regroupement_uniq\s+on public\.notifications \(user_id, type, cle_regroupement\)/);
  const envoi = sansCommentaires(lire("supabase/functions/send-push/index.ts"));
  assert.match(envoi, /onConflict: "user_id,type,cle_regroupement", ignoreDuplicates: true/);
});

test("36. contenu d'un envoi serveur : type du catalogue, lien interne seulement", () => {
  const ok = V.validerContenu({ type: "D2", titre: "Nouveau chantier", texte: "X", lien: "/chantiers/42", cle_regroupement: "D2:42" });
  assert.equal(ok.ok, true);
  assert.equal(ok.simulation, false);
  assert.equal(V.validerContenu({ type: "D2", titre: "t", simulation: true }).simulation, true);
  assert.equal(V.validerContenu({ type: "D2", titre: "t" }).lien, "/");
  assert.equal(V.validerContenu({ type: "Z1", titre: "t" }).ok, false);
  assert.equal(V.validerContenu({ type: "test", titre: "t" }).ok, false, "le test ne passe pas par le mode serveur");
  assert.equal(V.validerContenu({ type: "D2", titre: "" }).ok, false);
  for (const lien of ["https://ailleurs.fr", "//ailleurs.fr", "javascript:alert(1)", "chantiers"]) {
    assert.equal(V.validerContenu({ type: "D2", titre: "t", lien }).ok, false, lien);
  }
  assert.deepEqual(V.chargeUtile({ type: "D2", titre: "T", texte: "B", lien: "/x" }),
    { title: "T", body: "B", url: "/x", tag: "profero-D2", icon: "/pwa-192.png" });
});

const MIGRATION_BOITE = readdirSync(chemin("supabase/migrations")).find((f) => /_notifications_boite\.sql$/.test(f));

test("37. migration boîte : deux tables, seule la policy restrictive, aucune fonction", () => {
  assert.ok(MIGRATION_BOITE, "migration *_notifications_boite.sql présente");
  const sql = sansCommentairesSql(lire(`supabase/migrations/${MIGRATION_BOITE}`)).toLowerCase();
  const tables = (sql.match(/create table if not exists public\.\w+/g) || []).map((t) => t.split(".").pop());
  assert.deepEqual(tables, ["notifications", "notifications_preferences"]);
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from authenticated`));
    assert.match(sql, new RegExp(`create policy profero_collaborateurs_seulement on public\\.${t}\\s+as restrictive for all to authenticated\\s+using \\(\\(select public\\.est_collaborateur_actif\\(\\)\\)\\) with check \\(\\(select public\\.est_collaborateur_actif\\(\\)\\)\\)`));
  }
  const policies = sql.match(/create policy\s+\w+/g) || [];
  assert.deepEqual(policies.map((p) => p.split(/\s+/).pop()), ["profero_collaborateurs_seulement", "profero_collaborateurs_seulement"],
    "aucune autre policy (journal du 06/11/2026)");
  assert.ok(!/as permissive/.test(sql));
  assert.ok(!/security definer/.test(sql), "aucune fonction SECURITY DEFINER");
  assert.ok(!/create (or replace )?function/.test(sql), "aucune fonction");
  assert.ok(!/grant [^;]* to (authenticated|anon)/.test(sql), "aucun droit direct pour le navigateur");
  assert.ok(!/\b(drop table|delete from|update |truncate|insert into)/.test(sql), "purement additive");
  assert.ok(!/alter table (?!public\.notifications(_preferences)? enable row level security)/.test(sql), "aucune table existante modifiée");
  assert.ok(!/planning_config/.test(sql), "les réglages ne sont pas écrits par la migration (absents = interrupteur coupé)");
  for (const s of V.PUSH_STATUTS) assert.match(sql, new RegExp(`'${s}'`), `statut ${s} accepté par la base`);
  for (const c of [...V.CODES_TYPES, "test"]) assert.match(sql, new RegExp(`'${c.toLowerCase()}'`), `type ${c} accepté par la base (SQL comparé en minuscules)`);
});

test("38. boîte de réception : appelant identifié, toujours limitée à ses propres lignes", () => {
  const code = sansCommentaires(lire("supabase/functions/notifications-boite/index.ts"));
  const iQui = code.indexOf("identifierAppelant(req)");
  const iRefus = code.indexOf("if (!qui.ok) return qui.reponse");
  const iTable = code.indexOf('.from("notifications');
  assert.ok(iQui > 0 && iQui < iRefus && iRefus < iTable, "identification avant toute lecture");
  const toutes = code.split(/admin\.from\(/).slice(1);
  // Seule exception (tâche 3) : le réglage COMMUN planning_config.notifications_push,
  // lu pour savoir quels types le rôle reçoit. Jamais d'écriture dessus ici.
  const reglage = toutes.filter((r) => r.startsWith('"planning_config"'));
  assert.equal(reglage.length, 1, "une seule lecture du réglage commun");
  assert.match(reglage[0].slice(0, 200), /^"planning_config"\)\s*\.select\("value"\)\.eq\("key", CLE_REGLAGES\)/);
  const requetes = toutes.filter((r) => !r.startsWith('"planning_config"'));
  assert.ok(requetes.length >= 6);
  for (const r of requetes) {
    assert.match(r.slice(0, 400), /user_id(", userId\)|: userId)/, `requête limitée à l'appelant : ${r.slice(0, 60)}`);
  }
  assert.match(code, /action === "marquer_lu"/);
  assert.match(code, /action === "tout_marquer_lu"/);
  assert.match(code, /action === "preferences"/);
  assert.match(code, /vue === "compteur"/);
});

test("39. rattrapage : job ?job=push_reportes, créneau pg_cron 7h05 Paris (été / hiver), aucune fonction Vercel ajoutée", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /push_reportes: \{\s*fenetre: null,/);
  assert.match(disp, /require\("\.\/_cron\/cron-push-reportes\.js"\)/);
  const job = lire("api/_cron/cron-push-reportes.js");
  assert.match(job, /mode: "reportes"/);
  assert.match(job, /Authorization: `Bearer \$\{cle\}`/);
  assert.match(job, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(!/VITE_SUPABASE_KEY/.test(job), "jamais la clé anon");
  const wf = lire(".github/workflows/cron-push-reportes.yml");
  // Créneau tenu par la base (pg_cron), plus par GitHub — détail : verif-cron-notifications.mjs.
  assert.ok(!/^\s*schedule:/m.test(wf), "plus de schedule GitHub");
  const migr = lire("supabase/migrations/20261109140000_cron_notifications_push.sql");
  assert.match(migr, /'profero_push_reportes',\s*'5 5,6 \* \* 1-5'/);
  assert.match(migr, /cron-dispatcher\?job=push_reportes'/);
  assert.match(wf, /job=push_reportes/);
  // Plafond des 12 fonctions Vercel : rien de nouveau à la racine de api/.
  const fonctions = readdirSync(chemin("api")).filter((f) => !f.startsWith("_"));
  assert.ok(fonctions.length <= 12, `${fonctions.length} fonctions Vercel`);
  assert.ok(!fonctions.some((f) => /push|notif/i.test(f)), "aucune fonction Vercel pour les notifications");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Écrans (tâche 3) : cloche, préférences, Réglages › Notifications.
//    Données fictives.
// ═══════════════════════════════════════════════════════════════════════════

// Copie fictive de la forme de ROLES_DEFAULT_RENOVATION (src/access.js importe
// le client Supabase : non chargeable ici). Le test 44 vérifie que l'écran
// passe bien la vraie liste par rolesProposables.
const ROLES_FICTIFS = [
  { id: "admin", label: "Administrateur" }, { id: "conducteur", label: "Conducteur" },
  { id: "commercial", label: "Commercial" }, { id: "comptable", label: "Comptable" },
  { id: "ouvrier", label: "Ouvrier" }, { id: " Ouvrier ", label: "Ouvrier (casse)" },
];

test("40. rôle ouvrier : jamais proposé dans les réglages, jamais enregistré, jamais destinataire", () => {
  const proposes = V.rolesProposables(ROLES_FICTIFS).map((r) => r.id);
  assert.deepEqual(proposes, ["admin", "conducteur", "commercial", "comptable"]);
  // Écriture : « ouvrier » retiré même s'il arrivait de l'écran.
  const brut = V.reglagesParDefaut();
  brut.types.C1.roles = ["admin", "ouvrier"];
  const ecrit = V.reglagesAEnregistrer(brut);
  assert.deepEqual(ecrit.types.C1.roles, ["admin"]);
  assert.deepEqual(Object.keys(ecrit).sort(), ["actif", "silence", "types"], "aucun champ de lecture écrit en base");
  assert.equal(ecrit.actif, false, "l'interrupteur général reste coupé tant qu'on ne l'allume pas");
  for (const t of Object.values(ecrit.types)) assert.ok(!t.roles.includes("ouvrier"));
  // Préférences : rien à proposer à un ouvrier.
  const tout = V.normaliserReglages({ actif: true, types: Object.fromEntries(V.CODES_TYPES.map((c) => [c, { actif: true, roles: ["admin", "conducteur", "comptable", "commercial", "ouvrier"] }])) });
  assert.deepEqual(V.typesRecevables({ reglages: tout, role: "ouvrier" }), []);
  assert.deepEqual(V.typesRecevables({ reglages: tout, role: " OUVRIER " }), []);
  // Envoi : tous les types, tous les rôles cochés → aucun ouvrier.
  for (const type of V.CODES_TYPES) {
    const p = V.planifierEnvoi({ reglages: tout, type, utilisateurs: UTILISATEURS, maintenantMs: MARDI_10H, vapidConfiguree: true });
    assert.ok(p.lignes.every((l) => !["o1", "o2"].includes(l.user_id) && l.role !== "ouvrier"), type);
  }
  // Appareils par rôle : la ligne « ouvrier » n'existe jamais.
  const parRole = V.appareilsParRole({ utilisateurs: UTILISATEURS, idsAvecAppareil: ["o1", "o2", "a1"] });
  assert.ok(!("ouvrier" in parRole));
});

test("41. valeurs par défaut C1 à C5 : conducteur + admin (décision de Loris du 06/11)", () => {
  const def = V.normaliserReglages(null);
  for (const t of V.CATALOGUE.filter((x) => /^C[1-5]$/.test(x.code))) {
    assert.deepEqual([...t.roles], ["conducteur", "admin"], t.code);
    assert.deepEqual(def.types[t.code].roles, ["conducteur", "admin"], t.code);
  }
  // Les autres types ne bougent pas.
  assert.deepEqual(def.types.F1.roles, ["comptable"]);
  assert.deepEqual(def.types.D2.roles, ["admin", "conducteur"]);
  // Un admin (seul « conducteur » réel aujourd'hui) reçoit C1 une fois allumé.
  const p = V.planifierEnvoi({ reglages: ALLUME(), type: "C1", utilisateurs: UTILISATEURS, maintenantMs: MARDI_10H, vapidConfiguree: true });
  assert.deepEqual(p.lignes.map((l) => l.user_id).sort(), ["a1", "a2", "c1"]);
  assert.deepEqual(p.resume.destinataires_par_role, { admin: 2, conducteur: 1 });
  // Préférences proposées par rôle, avec les défauts.
  const allume = ALLUME();
  assert.deepEqual(V.typesRecevables({ reglages: allume, role: "admin" }), ["C1", "C2", "C3", "C4", "C5", "D1", "D2", "D3", "D4"]);
  assert.deepEqual(V.typesRecevables({ reglages: allume, role: "conducteur" }), ["C1", "C2", "C3", "C4", "C5", "D2"]);
  assert.deepEqual(V.typesRecevables({ reglages: allume, role: "comptable" }), ["F1", "F2"]);
  assert.deepEqual(V.typesRecevables({ reglages: allume, role: "commercial" }), []);
  // Un type coupé dans les Réglages disparaît des préférences.
  assert.ok(!V.typesRecevables({ reglages: ALLUME({ types: { C3: { actif: false, roles: ["admin"] } } }), role: "admin" }).includes("C3"));
  // Décocher un rôle : il ne reçoit plus le type au prochain envoi.
  const sansAdmin = ALLUME({ types: { C1: { actif: true, roles: ["conducteur"] } } });
  const p2 = V.planifierEnvoi({ reglages: sansAdmin, type: "C1", utilisateurs: UTILISATEURS, maintenantMs: MARDI_10H, vapidConfiguree: true });
  assert.deepEqual(p2.lignes.map((l) => l.user_id), ["c1"]);
  // La phrase du profil d'un admin annonce aussi ce qui vient des conducteurs.
  assert.match(N.phraseRole("admin"), /18h30/);
});

test("42. une personne ne reçoit jamais deux fois la même notification", () => {
  // Même compte de connexion sur deux fiches (même e-mail), rôles différents
  // tous deux cochés : une seule ligne.
  const doubles = [
    ...UTILISATEURS,
    { auth_id: "a1", nom: "Admin Un (seconde fiche)", role: "conducteur", actif: true, branches: ["renovation"] },
    { auth_id: "c1", nom: "Conducteur Un (doublon)", role: "conducteur", actif: true, branches: ["renovation"] },
  ];
  const d = V.destinataires({ reglages: ALLUME(), type: "C1", utilisateurs: doubles });
  const ids = d.liste.map((u) => u.user_id);
  assert.equal(new Set(ids).size, ids.length, "aucun doublon");
  assert.deepEqual(ids.sort(), ["a1", "a2", "c1"]);
  assert.equal(d.ignores.doublon, 2);
  const p = V.planifierEnvoi({ reglages: ALLUME(), type: "C1", utilisateurs: doubles, maintenantMs: MARDI_10H, vapidConfiguree: true });
  assert.equal(p.lignes.length, 3);
  assert.equal(new Set(p.lignes.map((l) => l.user_id)).size, 3);
  // Second passage du même créneau : personne ne la reçoit une seconde fois.
  const p2 = V.planifierEnvoi({
    reglages: ALLUME(), type: "C1", utilisateurs: doubles, maintenantMs: MARDI_10H + 3_600_000,
    vapidConfiguree: true, dejaNotifies: p.lignes.map((l) => l.user_id),
  });
  assert.equal(p2.lignes.length, 0);
  assert.equal(p2.resume.doublons, 3);
  // Appareils par rôle : une personne compte une fois.
  const parRole = V.appareilsParRole({ utilisateurs: doubles, idsAvecAppareil: ["a1", "a1", "c1"] });
  assert.deepEqual(parRole.admin, { utilisateurs: 2, avec_appareil: 1 });
  assert.deepEqual(parRole.conducteur, { utilisateurs: 1, avec_appareil: 1 });
  assert.deepEqual(parRole.comptable, { utilisateurs: 1, avec_appareil: 0 });
  assert.ok(!("commercial" in parRole), "compte Invest seul non compté");
  // send-push s'appuie sur ce plan, et l'index unique (personne, type, clé) reste le dernier garde-fou.
  assert.match(lire("supabase/functions/send-push/index.ts"), /onConflict: "user_id,type,cle_regroupement", ignoreDuplicates: true/);
});

test("43. suivi d'un envoi : jamais envoyé ≠ zéro destinataire", () => {
  assert.equal(V.resumeEnvoi([]), null);
  assert.equal(V.resumeEnvoi(null), null);
  const r = V.resumeEnvoi([
    { user_id: "a1", created_at: "2026-11-10T17:30:00Z", push_statut: "envoye" },
    { user_id: "a2", created_at: "2026-11-10T17:30:01Z", push_statut: "aucun_appareil" },
    { user_id: "c1", created_at: "2026-11-10T17:30:01Z", push_statut: "reporte" },
  ]);
  assert.deepEqual(r, { date: "2026-11-10T17:30:01Z", destinataires: 3, push_envoyes: 1, reportes: 1 });
});

test("44. liens des notifications : vers une page de l'application, jamais ailleurs", () => {
  assert.deepEqual(V.lienVersNavigation("/"), { page: null, chantier: null });
  assert.deepEqual(V.lienVersNavigation("/?page=alertes"), { page: "alertes", chantier: null });
  assert.deepEqual(V.lienVersNavigation("/alertes"), { page: "alertes", chantier: null });
  assert.deepEqual(V.lienVersNavigation("https://exemple.invalid/?page=admin"), { page: null, chantier: null });
  assert.deepEqual(V.lienVersNavigation("//exemple.invalid/?page=admin"), { page: null, chantier: null });
  assert.deepEqual(V.lienVersNavigation("/?page=<script>"), { page: null, chantier: null });
  assert.deepEqual(V.lienVersNavigation(null), { page: null, chantier: null });
  // Identifiant de chantier fictif avec accents et caractères spéciaux : aller-retour exact.
  const lien = V.lienPage("chantiers", { chantier: "Villa (Été) & Co+" });
  assert.match(lien, /^\/\?page=chantiers&chantier=/);
  assert.ok(!/\s/.test(lien), "accepté par validerContenu (pas d'espace)");
  assert.equal(V.validerContenu({ type: "C4", titre: "x", lien }).ok, true);
  assert.deepEqual(V.lienVersNavigation(lien), { page: "chantiers", chantier: "Villa (Été) & Co+" });
  assert.equal(V.lienPage(""), "/");
  // Les liens d'une page ne contiennent jamais « rapport » (App.jsx l'envoie vers le rapport mobile).
  assert.ok(!/rapport/i.test(V.lienPage("qualite-cr")));
});

test("45. cloche : navigation bureau seulement, erreur visible, sans rechargement ni Realtime", () => {
  const app = lire("src/App.jsx");
  assert.match(app, /useBoiteNotifications\(role!=="ouvrier"\)/);
  assert.match(app, /cloche=\{role!=="ouvrier"\?<BoutonCloche /, "barre latérale (ordinateur)");
  assert.match(app, /\{role!=="ouvrier"&&<BoutonCloche boite=\{boite\} variante="haut"/, "barre du haut (téléphone)");
  assert.match(app, /\{boiteOuverte&&role!=="ouvrier"&&<PanneauBoite /);
  assert.match(lire("src/Renovation/Navigation.jsx"), /\{cloche\}/);
  // Message du service worker : navigation interne, jamais de rechargement.
  assert.match(app, /ev\?\.data\?\.type !== "profero-notification"/);
  assert.match(app, /lienVersNavigation\(lien\)/);
  const blocNav = app.slice(app.indexOf("const naviguerVersLien"), app.indexOf("const naviguerRef"));
  assert.match(blocNav, /canAccess\(role, cible\)/, "page non autorisée pour le rôle : on ne bouge pas");
  // Forme « /#page » (lien C3 de la tâche 5 : « /#planning-commandes ») aussi comprise.
  assert.match(app, /const cibleDuLien = \(lien\) =>/);
  assert.match(blocNav, /cibleDuLien\(lien\)/);
  assert.equal(V.lienVersNavigation("/planning-commandes").page, "planning-commandes");
  const cloche = sansCommentaires(lire("src/Renovation/ClocheNotifications.jsx"));
  for (const code of [cloche, blocNav]) {
    assert.ok(!/location\.reload|location\.href\s*=|location\.assign|window\.open/.test(code), "jamais de rechargement");
  }
  assert.ok(!/\.channel\(|postgres_changes/.test(cloche), "pas de Realtime : tables fermées au navigateur");
  assert.ok(!/from\(["'](notifications|push_subscriptions)/.test(cloche), "le navigateur ne lit jamais les tables");
  assert.match(cloche, /notifications-boite/);
  assert.match(cloche, /PERIODE_MS = 60_000/, "rafraîchi toutes les minutes");
  assert.match(cloche, /visibilitychange/, "et au retour au premier plan");
  // Erreur ≠ « aucune notification » : pastille « ! » et message dédié.
  assert.match(cloche, /enErreur \? \(\s*<span[^>]*>!<\/span>/);
  assert.match(cloche, /La boîte de réception ne répond pas\./);
  assert.match(cloche, /liste && liste\.length === 0 && !enErreur/, "« aucune notification » seulement sans erreur");
  assert.match(cloche, /Tout marquer comme lu/);
  assert.match(cloche, /action: "marquer_lu"/);
  assert.match(cloche, /action: "tout_marquer_lu"/);
  // Service worker : l'onglet ouvert reçoit l'adresse, sans être rechargé.
  const sw = sansCommentaires(lire("public/push-sw.js"));
  assert.match(sw, /postMessage\(\{ type: 'profero-notification'/);
  assert.ok(!/navigate\(|location\.reload/.test(sw));
});

test("46. préférences du profil : types du rôle seulement, via notifications-boite, erreur visible", () => {
  const profil = sansCommentaires(lire("src/Renovation/ProfilNotifications.jsx"));
  assert.match(profil, /<BlocPreferencesNotifications role=\{role\} T=\{T\}\/>/);
  assert.match(profil, /\$\{FONCTION_BOITE\}\?vue=preferences/);
  assert.match(profil, /action: "preferences"/);
  assert.match(profil, /donnees\.recevables/);
  assert.match(profil, /Préférences illisibles pour l'instant\./);
  assert.ok(!/from\(["']notifications_preferences/.test(profil), "le navigateur ne lit jamais la table");
  const boite = sansCommentaires(lire("supabase/functions/notifications-boite/index.ts"));
  assert.match(boite, /recevables: typesRecevables\(\{ reglages, role \}\)/);
  assert.match(boite, /const \{ admin, userId, role \} = qui/);
});

test("47. Réglages › Notifications : admin seulement, planning_config par saveConfig, rôles sans ouvrier", () => {
  const admin = lire("src/Renovation/Admin.jsx");
  assert.match(admin, /\.\.\.\(isAdmin \? \[\["notifications", "Notifications", Bell\]\] : \[\]\)/);
  assert.match(admin, /\{adminTab==="notifications" && isAdmin && \(\s*<ReglagesNotificationsAdmin T=\{T\} saveConfig=\{saveConfig\}\/>/);
  const ecran = sansCommentaires(lire("src/Renovation/ReglagesNotificationsAdmin.jsx"));
  assert.match(ecran, /const ROLES = rolesProposables\(ROLES_DEFAULT_RENOVATION\);/);
  assert.ok(!/ROLES_DEFAULT_RENOVATION\.map/.test(ecran), "jamais la liste brute (elle contient ouvrier)");
  assert.match(ecran, /saveConfig\(CLE_REGLAGES, propre\)/);
  assert.match(ecran, /reglagesAEnregistrer\(next\)/);
  assert.ok(!/echeancier_facturation/.test(ecran), "le réglage mail « facture à émettre » reste séparé");
  assert.ok(!/\.(upsert|insert|update|delete)\(/.test(ecran), "aucune écriture directe hors saveConfig");
  assert.match(ecran, /Aucun rôle coché : cette notification ne sera envoyée à personne/);
  assert.match(ecran, /type="time"/);
  assert.match(ecran, /JOURS_AFFICHES\.map/);
  assert.match(ecran, /notifications-pilotage/);
  assert.match(ecran, /Jamais envoyée/);
  assert.match(ecran, /Suivi des envois indisponible/, "une lecture impossible ne ressemble pas à « jamais envoyé »");
  assert.match(ecran, /window\.confirm\("Activer les envois automatiques/, "allumer demande confirmation");
  // Aucune migration n'écrit le réglage : la clé reste absente (interrupteur coupé).
  for (const f of readdirSync(chemin("supabase/migrations"))) {
    if (!/notification|push/i.test(f)) continue;
    assert.ok(!/notifications_push/.test(sansCommentairesSql(lire(`supabase/migrations/${f}`))), f);
  }
});

test("48. notifications-pilotage : JWT, admin vérifié avant toute lecture, lecture seule, des comptes seulement", () => {
  assert.match(lire("supabase/config.toml"), /\[functions\.notifications-pilotage\]\s*\nverify_jwt = true/);
  const code = sansCommentaires(lire("supabase/functions/notifications-pilotage/index.ts"));
  const iQui = code.indexOf("identifierAppelant(req)");
  const iRefus = code.indexOf("if (!qui.ok) return qui.reponse");
  const iAdmin = code.indexOf('!== "admin"');
  const i403 = code.indexOf("403");
  const iTable = code.indexOf(".from(");
  assert.ok(iQui > 0 && iQui < iRefus && iRefus < iAdmin && iAdmin < i403 && i403 < iTable, "admin vérifié avant toute lecture");
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(code), "lecture seule");
  assert.ok(!/webpush|send-push|sendNotification/.test(code), "aucun envoi");
  assert.ok(!/endpoint|p256dh|\btexte\b|\btitre\b/.test(code), "ni appareil ni contenu renvoyé");
  assert.match(code, /req\.method !== "GET"/);
  // Même lecture des utilisateurs que send-push.
  assert.match(code, /from "\.\.\/_partage\/utilisateursPush\.ts"/);
  assert.match(lire("supabase/functions/send-push/index.ts"), /import \{ lireUtilisateurs \} from "\.\.\/_partage\/utilisateursPush\.ts"/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
