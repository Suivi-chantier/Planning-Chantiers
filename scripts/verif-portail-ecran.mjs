#!/usr/bin/env node
// Vérifie l'écran client /espace-client : logique pure + règles de sécurité du code.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-portail-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { populationDuJeton, bonjour, etapesTriees, tachesClient, etatSection, libelleEtape, statutEtape, dateFr } from "../src/Portail/portailVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const JSX = lire("src/Portail/PortailClient.jsx");
const MAIN = lire("src/main.jsx");
const VITE = lire("vite.config.js");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const jwt = (charge) => `e30.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.sig`;

test("1. population lue dans le jeton ; jeton illisible ou sans claim = null (donc refusé)", () => {
  assert.equal(populationDuJeton(jwt({ profero_population: "client_invest" })), "client_invest");
  assert.equal(populationDuJeton(jwt({ profero_population: "collaborateur" })), "collaborateur");
  assert.equal(populationDuJeton(jwt({ sub: "x" })), null);
  for (const mauvais of ["", null, undefined, "abc", "a.b", "a.%%%.c"]) assert.equal(populationDuJeton(mauvais), null);
});
test("2. message d'accueil : prénom, sinon nom, sinon « Bonjour » seul", () => {
  assert.equal(bonjour({ prenom: "Alice", nom: "Martin" }), "Bonjour Alice");
  assert.equal(bonjour({ prenom: " ", nom: "Laurent Martin" }), "Bonjour Laurent Martin");
  assert.equal(bonjour({ prenom: null, nom: null }), "Bonjour");
  assert.equal(bonjour(null), "Bonjour");
});
test("3. étapes dans l'ordre du parcours, vocabulaire client, « bloquée » jamais affichée", () => {
  const e = etapesTriees([{ id: 3, etape: "acquisition", statut: "a_venir" }, { id: 1, etape: "signature", statut: "terminee" },
    { id: 2, etape: "recherche", statut: "bloquee" }, { id: 4, etape: "inconnue_x", statut: "zzz" }]);
  assert.deepEqual(e.map((x) => x.cle), ["signature", "recherche", "acquisition", "inconnue_x"]);
  assert.equal(e[1].statut, "En attente");
  assert.ok(!JSON.stringify(e).toLowerCase().includes("bloqu"));
  assert.equal(libelleEtape("recherche"), "Recherche de biens");
  assert.equal(e[3].titre, "inconnue x", "clé inconnue lisible, jamais vide");
  assert.deepEqual(statutEtape("zzz"), ["zzz", "neutre"], "statut inconnu jamais présenté comme terminé");
});
test("4. tâches : à faire d'abord par échéance, sans échéance en dernier ; terminées à part ; « non concerné » écarté", () => {
  const r = tachesClient([
    { id: "a", action_title: "A", status: "a_faire", due_date: "2026-12-01" }, { id: "b", action_title: "B", status: "a_faire", due_date: "2026-09-01" },
    { id: "c", action_title: "C", status: "a_faire", due_date: null }, { id: "d", action_title: "D", status: "fait", due_date: "2026-01-01" },
    { id: "e", action_title: "E", status: "non_concerne", due_date: null }], "2026-10-01");
  assert.deepEqual(r.aFaire.map((t) => t.id), ["b", "a", "c"]);
  assert.deepEqual(r.terminees.map((t) => t.id), ["d"]);
  assert.equal(r.aFaire[0].enRetard, true);
  assert.equal(r.aFaire[1].enRetard, false);
  assert.equal(r.aFaire[2].enRetard, false, "sans échéance : jamais en retard");
});
test("5. une erreur n'est JAMAIS présentée comme « vide »", () => {
  assert.equal(etatSection({ data: [], error: { message: "x" } }).etat, "erreur");
  assert.equal(etatSection({ data: null, error: { message: "x" } }).etat, "erreur");
  assert.equal(etatSection(undefined).etat, "erreur");
  assert.equal(etatSection({ data: [], error: null }).etat, "vide");
  assert.equal(etatSection({ data: [{ id: 1 }], error: null }).etat, "ok");
  assert.equal(dateFr("2026-10-01T10:00:00Z"), "01/10/2026");
  assert.equal(dateFr(null), "");
});
test("6. l'écran ne lit QUE les vues portail_* : aucune table de base, aucune écriture, aucun rpc", () => {
  const lectures = [...JSX.matchAll(/lire\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lectures.sort(), ["portail_client", "portail_documents", "portail_dossier", "portail_etapes", "portail_evenements", "portail_taches"]);
  assert.ok(!/\.from\("(?!portail_)/.test(JSX), "aucun .from() hors vues portail_");
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(JSX), "lecture seule");
  assert.ok(!/service_role|SERVICE_ROLE/.test(JSX));
});
test("7. le téléchargement passe uniquement par la fonction portail-document-url (jamais le stockage)", () => {
  assert.match(JSX, /functions\.invoke\("portail-document-url"/);
  assert.ok(!/storage\.from|createSignedUrl|invest-documents/.test(JSX));
});
test("8. aucun module du bureau n'est importé par le portail", () => {
  const imports = [...(JSX + lire("src/Portail/portailVue.mjs")).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports.filter((i) => i.startsWith(".")).sort(), ["../supabase", "./portailVue"]);
  assert.ok(!/Invest|Renovation|App\.jsx|constants/.test(imports.join(" ")));
});
test("9. main.jsx : /espace-client charge le portail, le reste le bureau ; PWA bureau non enregistrée sur le portail", () => {
  assert.match(MAIN, /\/\^\\\/espace-client\(\\\/\|\$\)\/\.test\(window\.location\.pathname\)/);
  assert.match(MAIN, /import\('\.\/Portail\/PortailClient\.jsx'\)/);
  assert.match(MAIN, /import\('\.\/App\.jsx'\)/);
  assert.match(MAIN, /if \(!estPortailClient\) initPWA\(\)/);
  assert.match(VITE, /navigateFallbackDenylist: \[\/\^\\\/espace-client\//, "le service worker n'intercepte pas le portail");
});
test("10. refus des comptes non clients ; message d'accès refusé du hook compris ; aucun mot « balle »/« bloquée » à l'écran", () => {
  assert.match(JSX, /populationDuJeton\(session\.access_token\) === POPULATION_CLIENT/);
  assert.match(JSX, /Accès Profero refusé/);
  assert.ok(!/balle|bloqu/i.test(JSX.replace(/\/\/.*$/gm, "")));
  assert.ok(!/signOut\(\)[\s\S]{0,40}refuse/.test(JSX), "un collaborateur connecté n'est pas déconnecté d'office");
});

console.log(`\n${n}/${total} contrôles conformes`);
