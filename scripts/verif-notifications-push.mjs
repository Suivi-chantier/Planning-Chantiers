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
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-notifications-push.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as N from "../src/notificationsPush.mjs";
import * as R from "../supabase/functions/_partage/pushRegles.mjs";

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

test("13. send-push : seul le test est ouvert, les envois serveur attendent la tâche 2", () => {
  assert.deepEqual(R.validerDemandeSendPush({ mode: "test" }), { ok: true, mode: "test" });
  assert.deepEqual(R.validerDemandeSendPush({}), { ok: true, mode: "test" });
  assert.equal(R.validerDemandeSendPush({ mode: "serveur" }).statut, 501);
  assert.equal(R.validerDemandeSendPush({ mode: "tout_le_monde" }).statut, 400);
  const t = R.chargeUtileTest();
  assert.equal(t.url, "/");
  assert.ok(t.title && t.body);
});

test("14. modules purs : aucun accès Supabase, aucune horloge", () => {
  for (const f of ["src/notificationsPush.mjs", "supabase/functions/_partage/pushRegles.mjs"]) {
    const code = sansCommentaires(lire(f));
    assert.ok(!/supabase/i.test(code.replace(/supabase\/functions/g, "")), `${f} : pas de Supabase`);
    assert.ok(!/Date\.now|new Date|Math\.random|fetch\(|setTimeout/.test(code), `${f} : pas d'horloge ni d'effet`);
    assert.ok(!/^import /m.test(code), `${f} : aucune dépendance`);
  }
  assert.match(lire("src/notificationsPush.js"), /export \* from "\.\/notificationsPush\.mjs"/);
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
    assert.ok(!/ProfilNotifications|BlocNotificationsTelephone|PanneauProfil/.test(code), `${f} : pas de bloc notifications`);
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
  const iQui = envoi.indexOf("identifierAppelant(req)");
  const iLecture = envoi.indexOf('.from("push_subscriptions")\n      .select');
  assert.ok(iQui > 0 && iQui < iLecture, "send-push : appelant contrôlé avant lecture des appareils");
  assert.match(envoi, /\.eq\("user_id", qui\.userId\)/, "test : seulement SES appareils");
  assert.match(envoi, /suiteReponseService\(statut\)/);
  const serveur = sansCommentaires(lire("supabase/functions/_partage/pushServeur.ts"));
  assert.match(serveur, /rpc\("est_collaborateur_actif"\)/);
  assert.match(serveur, /Deno\.env\.get\("VAPID_PRIVATE_KEY"\)/);
});

test("22. aucune clé privée VAPID écrite dans le dépôt", () => {
  const fichiers = [
    "supabase/functions/_partage/pushServeur.ts", "supabase/functions/_partage/pushRegles.mjs",
    "supabase/functions/send-push/index.ts", "supabase/functions/push-abonnement/index.ts",
    "src/notificationsPush.mjs", "src/Renovation/ProfilNotifications.jsx", "public/push-sw.js",
    "vite.config.js", "docs/projets/notifications-push.md",
  ];
  for (const f of fichiers) {
    const code = lire(f);
    assert.ok(!/VAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{40,}/.test(code), `${f} : pas de clé privée`);
    assert.ok(!/privateKey:\s*["'][A-Za-z0-9_-]{40,}["']/.test(code), `${f} : pas de clé privée en dur`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
