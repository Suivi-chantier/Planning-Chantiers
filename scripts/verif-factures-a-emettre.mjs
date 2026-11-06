#!/usr/bin/env node
// Vérifie la notification F1 « facture à émettre » (projet
// docs/projets/notifications-push.md, tâche 7).
//
//   1. module pur src/Renovation/factureAEmettre.mjs — exécuté sur des
//      données FICTIVES : détection identique à l'ancienne fiche (statut,
//      phasage retenu, avancement V2 et V1, échéancier, drapeau du mail),
//      décision du push F1, clé de regroupement stable ;
//   2. la fiche chantier importe le module, garde son mail et son drapeau ;
//   3. le job serveur (api/_cron/cron-factures-a-emettre.js) utilise le même
//      module et le même drapeau, n'envoie que le push, n'écrit jamais le
//      drapeau du mail ni aucun phasage, et respecte simulation et pas_avant ;
//   4. branchements : dispatcher, créneau GitHub (été / hiver), workflow.
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-factures-a-emettre.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as F from "../src/Renovation/factureAEmettre.mjs";
import { validerContenu } from "../supabase/functions/_partage/notificationsPushV1.mjs";
import { ECHEANCIER_DEFAUT } from "../src/Renovation/facturationClient.mjs";
import { calcAvancementPondere } from "../src/avancementPondere.mjs";
import { PHASES_DEFAUT } from "../src/phasesDefaut.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Données fictives ─────────────────────────────────────────────────────────
// Un chantier V2 à 50 % (deux ouvrages de 10 000 € HT, l'un fini, l'autre pas
// commencé), devis signé dans l'ancien cycle du phasage.
const ouvrageFini = { id: "o1", prix_ht: 10000, taches: [{ id: "t1", avancement: 100, heures_estimees: 10 }] };
const ouvrageNeuf = { id: "o2", prix_ht: 10000, taches: [{ id: "t2", avancement: 0, heures_estimees: 10 }] };
const phasageV2 = (meta = {}) => ({
  id: "ph-fictif-1", chantier_id: "ch-fictif-1", chantier_nom: "Chantier fictif",
  ouvrages: [ouvrageFini, ouvrageNeuf],
  plan_travaux: { meta: { cycle_vie_etapes: { devis_signe: { fait: true } }, ...meta } },
});
const chantier = (statut = "en_cours") => ({ id: "ch-fictif-1", nom: "CHANTIER FICTIF", statut });
const etatPour = (ph, factures = []) => F.etatFacturationChantier({
  meta: ph.plan_travaux.meta, echeancierDefaut: ECHEANCIER_DEFAUT,
  prixVendu: F.prixVenduPhasage(ph), factures, avancement: F.avancementPhasage(ph),
  etatsEtapes: { devis_signe: { fait: true } },
}).etatFact;

// ── 1. Module pur ────────────────────────────────────────────────────────────
test("1. drapeau du mail : même clé plate qu'avant (facture_mail_<échéance>)", () => {
  assert.equal(F.PREFIXE_DRAPEAU_MAIL, "facture_mail_");
  assert.equal(F.cleDrapeauMail("situation_1"), "facture_mail_situation_1");
});

test("2. statut du chantier : même règle que l'ancien getStatut", () => {
  assert.equal(F.statutChantier({ statut: "termine" }, {}), "termine");
  assert.equal(F.statutChantier({}, { statut: "en_pause" }), "en_pause");
  assert.equal(F.statutChantier({}, { id: "p" }), "en_cours");
  assert.equal(F.statutChantier({}, null), "planifie");
});

test("3. phasage retenu : par identifiant d'abord, sinon par nom", () => {
  const p1 = { id: "a", chantier_id: "x", chantier_nom: "Résidence Église" };
  const p2 = { id: "b", chantier_id: "y", chantier_nom: "Autre" };
  assert.equal(F.trouverPhasage([p1, p2], { id: "y", nom: "Résidence Église" }).id, "b");
  assert.equal(F.trouverPhasage([p1, p2], { id: "z", nom: "RESIDENCE eglise" }).id, "a");
  assert.equal(F.trouverPhasage([p1, p2], { id: "z", nom: "zz" }), null);
  assert.equal(F.trouverPhasage([p1], null), null);
});

test("4. avancement et prix vendu : V2 par les ouvrages, V1 par les phases", () => {
  const ph = phasageV2();
  assert.equal(F.avancementPhasage(ph), 50);
  assert.equal(F.prixVenduPhasage(ph), 20000);
  const v1 = { id: "v1", ouvrages: [], plan_travaux: { demolition: [{ avancement: 100 }, { avancement: 0 }], meta: { prix_vendu: "12000" } } };
  assert.equal(F.avancementPhasage(v1), calcAvancementPondere([], v1.plan_travaux.demolition));
  assert.equal(F.avancementPhasage(v1), 50);
  assert.equal(F.avancementPhasage(v1, ["cuisine"]), 0, "seules les phases connues comptent");
  assert.equal(F.prixVenduPhasage(v1), 12000);
  assert.equal(F.prixVenduPhasage({ ouvrages: [] }), 0);
  assert.ok(PHASES_DEFAUT.some((p) => p.id === "demolition"));
});

test("5. détection : échéances prêtes, pas encore prévenues", () => {
  const ph = phasageV2();
  const etat = etatPour(ph);
  const ids = F.echeancesAPrevenir({ chantier: chantier(), phasage: ph, etatFact: etat }).map((l) => l.id);
  // 50 % : acompte (signature), démarrage (1 %), situation 1 (40 %) ; pas la 2 (70 %) ni le solde.
  assert.deepEqual(ids, ["acompte", "demarrage", "situation_1"]);
  const acompte = etat.lignes.find((l) => l.id === "acompte");
  assert.equal(acompte.montantAttendu, 10000);
});

test("6. détection : drapeau posé → plus rien pour cette échéance", () => {
  const ph = phasageV2({ facture_mail_acompte: "2026-10-01T08:00:00.000Z" });
  const ids = F.echeancesAPrevenir({ chantier: chantier(), phasage: ph, etatFact: etatPour(ph) }).map((l) => l.id);
  assert.deepEqual(ids, ["demarrage", "situation_1"]);
});

test("7. détection : chantier terminé, sans phasage ou facture déjà émise → rien", () => {
  const ph = phasageV2();
  assert.deepEqual(F.echeancesAPrevenir({ chantier: chantier("termine"), phasage: ph, etatFact: etatPour(ph) }), []);
  assert.deepEqual(F.echeancesAPrevenir({ chantier: chantier(), phasage: null, etatFact: etatPour(ph) }), []);
  const factures = [{ id: "f1", ligne_id: "acompte", statut: "emise", montant_ht: 10000, date_facture: "2026-10-01" }];
  const ids = F.echeancesAPrevenir({ chantier: chantier(), phasage: ph, etatFact: etatPour(ph, factures) }).map((l) => l.id);
  assert.ok(!ids.includes("acompte"), "une facture émise sort l'échéance");
});

test("8. push F1 : nouvelle → oui ; mail parti depuis la mise en service → oui ; avant → non", () => {
  assert.deepEqual(F.decisionPushF1({ drapeauMail: null }), { pousser: true, raison: "nouvelle" });
  assert.equal(F.decisionPushF1({ drapeauMail: F.F1_MISE_EN_SERVICE }).pousser, true);
  assert.equal(F.decisionPushF1({ drapeauMail: "2026-12-01T08:00:00.000Z" }).raison, "mail_deja_parti_depuis_la_fiche");
  assert.deepEqual(F.decisionPushF1({ drapeauMail: "2026-09-17T05:00:00.000Z" }), { pousser: false, raison: "deja_notifiee_avant_mise_en_service" });
});

test("9. push F1 : contenu accepté par send-push, lien interne", () => {
  const ph = phasageV2();
  const ligne = etatPour(ph).lignes.find((l) => l.id === "situation_1");
  const c = F.contenuPushF1({ chantierNom: "CHANTIER FICTIF", ligne });
  const v = validerContenu({ mode: "serveur", type: "F1", ...c, cle_regroupement: F.cleRegroupementF1(ph.id, ligne.id) });
  assert.equal(v.ok, true, v.erreur);
  assert.match(c.texte, /Facture de situation n° 1/);
  assert.match(c.texte, /3[\s  ]000 € HT/);
});

test("10. plan du job : une ligne par échéance prête, clé stable d'un passage à l'autre", () => {
  const ph = phasageV2({ facture_mail_acompte: "2026-09-17T05:00:00.000Z", facture_mail_demarrage: "2026-12-01T08:00:00.000Z" });
  const donnees = { chantiers: [chantier()], phasages: [ph], lignesCycleVie: [], factures: [], echeancierDefaut: ECHEANCIER_DEFAUT };
  const plan = F.planFacturesAEmettre(donnees);
  const parId = Object.fromEntries(plan.map((p) => [p.ligne.id, p]));
  assert.deepEqual(Object.keys(parId).sort(), ["acompte", "demarrage", "situation_1"]);
  assert.equal(parId.acompte.pousser, false, "mail parti avant la mise en service : pas de push");
  assert.equal(parId.demarrage.pousser, true, "la fiche a vu l'échéance la première : le job la pousse");
  assert.equal(parId.situation_1.pousser, true, "nouvelle");
  assert.equal(parId.situation_1.aPrevenirParMail, true, "même détection que la fiche");
  assert.equal(parId.demarrage.aPrevenirParMail, false);
  assert.equal(parId.situation_1.cle, "F1-ph-fictif-1-situation_1");
  // Deuxième passage, après le mail de la fiche : même clé → send-push ne
  // renvoie rien (index unique personne × type × clé).
  const ph2 = { ...ph, plan_travaux: { meta: { ...ph.plan_travaux.meta, facture_mail_situation_1: "2026-12-02T08:00:00.000Z" } } };
  const plan2 = F.planFacturesAEmettre({ ...donnees, phasages: [ph2] });
  assert.equal(plan2.find((p) => p.ligne.id === "situation_1").cle, parId.situation_1.cle);
});

test("11. plan du job : chantier terminé → aucune ligne à pousser", () => {
  const plan = F.planFacturesAEmettre({ chantiers: [chantier("termine")], phasages: [phasageV2()], echeancierDefaut: ECHEANCIER_DEFAUT });
  assert.ok(plan.length > 0 && plan.every((p) => !p.pousser && p.raison === "chantier_termine"));
});

test("12. module pur : aucun accès base, aucune horloge", () => {
  const src = sansCommentaires(lire("src/Renovation/factureAEmettre.mjs"));
  assert.ok(!/supabase|fetch\(|Date\.now|new Date\(/.test(src));
  assert.match(lire("src/Renovation/factureAEmettre.js"), /export \* from "\.\/factureAEmettre\.mjs"/);
});

// ── 2. La fiche chantier ─────────────────────────────────────────────────────
test("13. la fiche importe le module et garde son mail et son drapeau", () => {
  const page = sansCommentaires(lire("src/Renovation/PageChantiers.jsx"));
  assert.match(page, /from "\.\/factureAEmettre"/);
  assert.match(page, /echeancesAPrevenir\(\{ chantier: selectedChantier, phasage: selectedPhasage, etatFact \}\)/);
  assert.match(page, /saveMetaPhasage\(\{ \[cleDrapeauMail\(ligne\.id\)\]: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(page, /source: "facture-situation"/, "le mail part toujours de la fiche");
  assert.match(page, /\.in\("role", rolesSituations\)/, "mêmes destinataires (rôles du réglage Facturation)");
  assert.ok(!/facture_mail_\$\{/.test(page), "plus de clé de drapeau écrite à la main");
  assert.ok(!/function trouverPhasage|function calcAvancementPondere/.test(page), "plus de copie locale");
  assert.match(page, /const getStatut = statutChantier/);
  assert.match(page, /avancementPhasage\(phasage, PHASES\.map\(ph => ph\.id\)\)/);
  assert.match(page, /etatFacturationChantier\(\{/);
  // La fiche n'appelle pas send-push (secret serveur).
  assert.ok(!/send-push/.test(page));
});

test("14. constants.js réexporte les briques déplacées, sans copie", () => {
  const c = lire("src/constants.js");
  assert.match(c, /export \{ calcAvancementPondere \} from "\.\/avancementPondere\.mjs"/);
  assert.match(c, /import \{ PHASES_DEFAUT \} from "\.\/phasesDefaut\.mjs"/);
  assert.match(c, /export \{ PHASES_DEFAUT \}/);
  assert.ok(!/function calcAvancementPondere/.test(c) && !/const PHASES_DEFAUT\s*=/.test(c));
});

// ── 3. Le job serveur ────────────────────────────────────────────────────────
test("15. le job : même module, même drapeau, push seulement, aucune écriture", () => {
  const job = sansCommentaires(lire("api/_cron/cron-factures-a-emettre.js"));
  assert.match(job, /import\("\.\.\/\.\.\/src\/Renovation\/factureAEmettre\.mjs"\)/);
  assert.match(job, /M\.planFacturesAEmettre\(/);
  assert.match(job, /type: "F1"/);
  assert.match(job, /cle_regroupement: p\.cle/);
  assert.ok(!/facture_mail_/.test(job), "le drapeau n'est lu qu'à travers le module");
  assert.ok(!/\.update\(|\.upsert\(|\.insert\(|\.delete\(|\.rpc\(/.test(job), "le job n'écrit rien en base");
  assert.ok(!/envoyerMail|send-email|envoyerEmailApi/.test(job), "le job n'envoie pas de mail");
});

// Faux client Supabase : lecture seule, données fictives.
function fauxSupabase(tables, config = {}) {
  const ecritures = [];
  return {
    ecritures,
    from(table) {
      const q = {
        _filtres: [],
        select() { return q; },
        eq(col, v) { q._filtres.push([col, v]); return q; },
        range(a) {
          let lignes = tables[table] || [];
          for (const [c, v] of q._filtres) lignes = lignes.filter((l) => l[c] === v);
          return Promise.resolve({ data: a === 0 ? lignes : [], error: null });
        },
        maybeSingle() {
          const cle = q._filtres.find(([c]) => c === "key")?.[1];
          return Promise.resolve({ data: config[cle] ? { value: config[cle] } : null, error: null });
        },
        update() { ecritures.push(table); return q; },
        upsert() { ecritures.push(table); return q; },
        insert() { ecritures.push(table); return q; },
      };
      return q;
    },
  };
}

const tablesFictives = () => ({
  chantiers: [chantier()],
  phasages: [phasageV2({ facture_mail_acompte: "2026-09-17T05:00:00.000Z" })],
  chantier_cycle_vie: [],
  chantier_factures_client: [
    { id: "pg", chantier_id: "ch-fictif-1", ligne_id: "demarrage", statut: "emise", source: "progbat", montant_ht: null },
  ],
});

async function avecFetch(faux, fn) {
  const avant = globalThis.fetch;
  const env = { url: process.env.VITE_SUPABASE_URL, cle: process.env.SUPABASE_SERVICE_ROLE_KEY };
  globalThis.fetch = faux;
  process.env.VITE_SUPABASE_URL = "https://exemple.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-fictive";
  try { return await fn(); } finally {
    globalThis.fetch = avant;
    if (env.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = env.url;
    if (env.cle === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.cle;
  }
}

test("16. simulation=1 : liste échéance par échéance, n'appelle pas send-push, n'écrit rien", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const sb = fauxSupabase(tablesFictives());
  let appels = 0;
  const r = await avecFetch(async () => { appels++; return { ok: true, json: async () => ({}) }; },
    () => runFacturesAEmettre({ query: { simulation: "1" } }, sb, { hour: 6 }));
  assert.equal(appels, 0);
  assert.deepEqual(sb.ecritures, []);
  assert.equal(r.simulation, true);
  // La facture ProGBat (source ≠ manuel) n'entre pas dans le calcul, comme sur la fiche.
  assert.deepEqual(r.detail.map((d) => [d.echeance, d.push]), [
    ["Facture d'acompte", "non"], ["Facture de démarrage", "oui"], ["Facture de situation n° 1", "oui"],
  ]);
  assert.equal(r.a_pousser, 2);
});

test("17. envoi : un appel send-push F1 par échéance à pousser, avec sa clé ; rien écrit par le job", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const sb = fauxSupabase(tablesFictives());
  const corps = [];
  const r = await avecFetch(async (url, init) => {
    assert.match(String(url), /\/functions\/v1\/send-push$/);
    corps.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, ecrites_en_boite: 1, envoyes: 1, echecs: 0 }) };
  }, () => runFacturesAEmettre({ query: {} }, sb, { hour: 8 }));
  assert.deepEqual(sb.ecritures, []);
  assert.deepEqual(corps.map((c) => [c.mode, c.type, c.cle_regroupement]), [
    ["serveur", "F1", "F1-ph-fictif-1-demarrage"], ["serveur", "F1", "F1-ph-fictif-1-situation_1"],
  ]);
  assert.equal(r.appels, 2);
  assert.equal(r.envoyes, 2);
  assert.ok(!r.error);
});

test("18. pas_avant=8 : un appel avant 8h Paris ne fait rien", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const sb = fauxSupabase(tablesFictives());
  let appels = 0;
  const r = await avecFetch(async () => { appels++; return { ok: true, json: async () => ({}) }; },
    () => runFacturesAEmettre({ query: { pas_avant: "8" } }, sb, { hour: 7 }));
  assert.equal(appels, 0);
  assert.ok(r.ignore);
});

// ── 4. Branchements ──────────────────────────────────────────────────────────
test("19. dispatcher et créneau GitHub (été / hiver, simulation à la main)", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /require\("\.\/_cron\/cron-factures-a-emettre\.js"\)/);
  assert.match(disp, /factures_a_emettre:\s*\{\s*fenetre:\s*null/);
  for (const job of ["recap_commandes", "rappel_rapport", "invest_echeances", "invest_tableau_bord", "journal_avancement", "relances_cycle_vie", "push_reportes", "push_simulation", "push_materiaux"]) {
    assert.match(disp, new RegExp(`${job}:\\s*\\{`), `job ${job} conservé`);
  }
  const wf = lire(".github/workflows/cron-factures-a-emettre.yml");
  assert.match(wf, /cron: '15 6 \* \* 1-5'/);
  assert.match(wf, /cron: '15 7 \* \* 1-5'/);
  assert.match(wf, /job="factures_a_emettre&pas_avant=8"/, "le créneau planifié ignore les appels avant 8h");
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /job="factures_a_emettre&simulation=1"/, "lancement à la main : simulation");
  assert.match(wf, /cron-dispatcher\?job=\$job/);
  const verif = lire(".github/workflows/verify-factures-a-emettre.yml");
  assert.match(verif, /node scripts\/verif-factures-a-emettre\.mjs/);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`ok   ${nom}`); }
  catch (e) { echecs++; console.error(`ÉCHEC ${nom}\n     ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications passées.`);
if (echecs) process.exit(1);
