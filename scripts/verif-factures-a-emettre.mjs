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

test("8. push F1 : nouvelle → oui ; mail parti depuis la mise en service → oui ; avant → non ; déjà notifiée → non", () => {
  assert.deepEqual(F.decisionPushF1({ drapeauMail: null }), { pousser: true, raison: "nouvelle" });
  assert.equal(F.decisionPushF1({ drapeauMail: F.F1_MISE_EN_SERVICE }).pousser, true);
  assert.equal(F.decisionPushF1({ drapeauMail: "2026-12-01T08:00:00.000Z" }).raison, "mail_deja_parti_depuis_la_fiche");
  assert.deepEqual(F.decisionPushF1({ drapeauMail: "2026-09-17T05:00:00.000Z" }), { pousser: false, raison: "deja_notifiee_avant_mise_en_service" });
  assert.deepEqual(F.decisionPushF1({ drapeauMail: null, dejaNotifiee: true }), { pousser: false, raison: "deja_notifiee_par_push" });
});

const elt = (chantierId, chantierNom, nom, montant) => ({ chantierId, chantierNom, ligne: { nom }, montant });

test("9. regroupement : UNE notification par jour, « N factures à émettre », accepté par send-push", () => {
  assert.equal(F.contenuPushRegroupeF1({ lignes: [], dateParis: "2026-11-09" }), null, "rien à notifier → aucune notification");
  const un = F.contenuPushRegroupeF1({ lignes: [elt("ch fictif/1", "CHANTIER FICTIF", "Facture de situation n° 1", 3000)], dateParis: "2026-11-09" });
  assert.equal(un.titre, "1 facture à émettre");
  assert.equal(un.lien, "/?page=chantiers&chantier=ch%20fictif%2F1", "une seule échéance : lien vers sa fiche");
  assert.match(un.texte, /^CHANTIER FICTIF · Facture de situation n° 1 · 3[\s  ]000 € HT$/);
  assert.equal(un.cle_regroupement, "F1-2026-11-09");
  const deux = F.contenuPushRegroupeF1({ lignes: [elt("a", "A", "Démarrage", 100), elt("b", "B", "Solde", 200)], dateParis: "2026-11-09" });
  assert.equal(deux.titre, "2 factures à émettre");
  assert.equal(deux.lien, "/?page=chantiers", "plusieurs chantiers : la page Chantiers");
  assert.equal(deux.texte.split("\n").length, 2);
  for (const c of [un, deux]) {
    const v = validerContenu({ mode: "serveur", type: "F1", ...c });
    assert.equal(v.ok, true, v.erreur);
  }
});

test("10. regroupement : texte long tronqué proprement (lignes entières + « … et K autres »)", () => {
  const lignes = Array.from({ length: 80 }, (_, i) => elt(`c${i}`, `CHANTIER FICTIF NUMÉRO ${i}`, "Facture de situation n° 1", 12345));
  const c = F.contenuPushRegroupeF1({ lignes, dateParis: "2026-11-09" });
  assert.equal(c.titre, "80 factures à émettre");
  assert.ok(c.texte.length <= 1000);
  const morceaux = c.texte.split("\n");
  const fin = morceaux.at(-1);
  assert.match(fin, /^… et \d+ autres$/);
  assert.equal(morceaux.length - 1 + Number(fin.match(/\d+/)[0]), 80, "aucune échéance perdue dans le compte");
  assert.ok(morceaux.slice(0, -1).every((l) => /€ HT$/.test(l)), "aucune ligne coupée au milieu");
  assert.equal(validerContenu({ mode: "serveur", type: "F1", ...c }).ok, true);
});

test("11. plan du job : une ligne par échéance prête ; déjà inscrite ou chantier terminé → exclue", () => {
  const ph = phasageV2({ facture_mail_acompte: "2026-09-17T05:00:00.000Z", facture_mail_demarrage: "2026-12-01T08:00:00.000Z" });
  const donnees = { chantiers: [chantier()], phasages: [ph], lignesCycleVie: [], factures: [], echeancierDefaut: ECHEANCIER_DEFAUT };
  const plan = F.planFacturesAEmettre(donnees);
  const parId = Object.fromEntries(plan.map((p) => [p.ligne.id, p]));
  assert.deepEqual(Object.keys(parId).sort(), ["acompte", "demarrage", "situation_1"]);
  assert.equal(parId.acompte.pousser, false, "mail parti avant la mise en service : pas de push");
  assert.equal(parId.demarrage.pousser, true, "la fiche a vu l'échéance la première : le job la reprend");
  assert.equal(parId.situation_1.pousser, true, "nouvelle");
  assert.equal(parId.situation_1.aPrevenirParMail, true, "même détection que la fiche");
  assert.equal(parId.demarrage.aPrevenirParMail, false);
  assert.equal(parId.situation_1.cleObjet, "ph-fictif-1-situation_1");
  // Passage suivant : les échéances notifiées sont inscrites → plus rien.
  const plan2 = F.planFacturesAEmettre({ ...donnees, dejaNotifiees: ["ph-fictif-1-demarrage", "ph-fictif-1-situation_1"] });
  assert.equal(plan2.filter((p) => p.pousser).length, 0);
  const plan3 = F.planFacturesAEmettre({ ...donnees, chantiers: [chantier("termine")] });
  assert.ok(plan3.length > 0 && plan3.every((p) => !p.pousser && p.raison === "chantier_termine"));
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
test("15. le job : même module, même drapeau, push seulement ; seule écriture = notifications_etat", () => {
  const job = sansCommentaires(lire("api/_cron/cron-factures-a-emettre.js"));
  assert.match(job, /import\("\.\.\/\.\.\/src\/Renovation\/factureAEmettre\.mjs"\)/);
  assert.match(job, /M\.planFacturesAEmettre\(/);
  assert.match(job, /M\.contenuPushRegroupeF1\(/);
  assert.match(job, /type: "F1"/);
  assert.ok(!/facture_mail_/.test(job), "le drapeau n'est lu qu'à travers le module");
  assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.rpc\(/.test(job), "aucune autre écriture");
  const upserts = job.match(/\.from\([^)]*\)\.upsert\(/g) || [];
  assert.deepEqual(upserts, [".from(TABLE_ETAT).upsert("], "une seule écriture : la table d'état");
  assert.match(job, /const TABLE_ETAT = "notifications_etat"/);
  assert.match(job, /if \(ecrites <= 0\)/, "rien d'écrit en boîte → rien d'inscrit");
  assert.ok(!/envoyerMail|send-email|envoyerEmailApi/.test(job), "le job n'envoie pas de mail");
});

// Faux client Supabase : données fictives, écritures enregistrées.
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
        update() { ecritures.push([table, "update"]); return q; },
        insert() { ecritures.push([table, "insert"]); return q; },
        upsert(lignes, options) {
          ecritures.push([table, "upsert", lignes, options]);
          (tables[table] ??= []).push(...lignes);
          return Promise.resolve({ error: null });
        },
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
  notifications_etat: [],
});
const T = { hour: 8, dateIso: "2026-11-09" };

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
const reponse = (corps) => ({ ok: true, json: async () => corps });

test("16. simulation=1 : liste échéance par échéance + la notification du jour, sans envoi ni écriture", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const sb = fauxSupabase(tablesFictives());
  let appels = 0;
  const r = await avecFetch(async () => { appels++; return reponse({}); },
    () => runFacturesAEmettre({ query: { simulation: "1" } }, sb, { hour: 6, dateIso: "2026-11-09" }));
  assert.equal(appels, 0);
  assert.deepEqual(sb.ecritures, []);
  assert.equal(r.simulation, true);
  // La facture ProGBat (source ≠ manuel) n'entre pas dans le calcul, comme sur la fiche.
  assert.deepEqual(r.detail.map((d) => [d.echeance, d.dans_la_notification]), [
    ["Facture d'acompte", "non"], ["Facture de démarrage", "oui"], ["Facture de situation n° 1", "oui"],
  ]);
  assert.equal(r.notifications, 1);
  assert.equal(r.echeances_a_notifier, 2);
  assert.equal(r.notification.titre, "2 factures à émettre");
});

test("17. envoi : UN appel send-push pour la journée, puis les échéances sont inscrites ; passage suivant : 0", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const tables = tablesFictives();
  const sb = fauxSupabase(tables);
  const corps = [];
  const r = await avecFetch(async (url, init) => {
    assert.match(String(url), /\/functions\/v1\/send-push$/);
    corps.push(JSON.parse(init.body));
    return reponse({ ok: true, ecrites_en_boite: 1, envoyes: 1, echecs: 0 });
  }, () => runFacturesAEmettre({ query: {} }, sb, T));
  assert.equal(corps.length, 1, "une seule notification");
  assert.deepEqual([corps[0].mode, corps[0].type, corps[0].cle_regroupement, corps[0].titre],
    ["serveur", "F1", "F1-2026-11-09", "2 factures à émettre"]);
  assert.equal(corps[0].lien, "/?page=chantiers&chantier=ch-fictif-1", "un seul chantier : sa fiche");
  assert.equal(r.inscrites, 2);
  assert.deepEqual(sb.ecritures.map((e) => [e[0], e[1]]), [["notifications_etat", "upsert"]]);
  assert.deepEqual(sb.ecritures[0][2].map((l) => [l.type, l.cle_objet]),
    [["F1", "ph-fictif-1-demarrage"], ["F1", "ph-fictif-1-situation_1"]]);
  assert.deepEqual(sb.ecritures[0][3], { onConflict: "type,cle_objet", ignoreDuplicates: true });
  // Passage suivant (même un autre jour) : tout est inscrit → aucun appel.
  let appels = 0;
  const r2 = await avecFetch(async () => { appels++; return reponse({}); },
    () => runFacturesAEmettre({ query: {} }, fauxSupabase(tables), { hour: 8, dateIso: "2026-11-10" }));
  assert.equal(appels, 0);
  assert.equal(r2.notifications, 0);
});

test("18. interrupteur coupé (rien écrit en boîte) → RIEN inscrit ; pas_avant=8 avant 8h → rien", async () => {
  const { runFacturesAEmettre } = require("../api/_cron/cron-factures-a-emettre.js");
  const sb = fauxSupabase(tablesFictives());
  // Réponse de send-push quand l'interrupteur général est coupé : aucune ligne écrite.
  const r = await avecFetch(async () => reponse({ ok: true, simulation: false, envoyes: 0, echecs: 0 }),
    () => runFacturesAEmettre({ query: {} }, sb, T));
  assert.equal(r.inscrites, 0);
  assert.deepEqual(sb.ecritures, [], "aucune échéance « consommée » sans avoir été notifiée");
  // Notification du jour déjà écrite (2e passage du même jour) : idem.
  const r2 = await avecFetch(async () => reponse({ ok: true, ecrites_en_boite: 0, doublons_evites: 1, envoyes: 0, echecs: 0 }),
    () => runFacturesAEmettre({ query: {} }, sb, T));
  assert.equal(r2.inscrites, 0);
  assert.deepEqual(sb.ecritures, []);
  let appels = 0;
  const r3 = await avecFetch(async () => { appels++; return reponse({}); },
    () => runFacturesAEmettre({ query: { pas_avant: "8" } }, sb, { hour: 7, dateIso: "2026-11-09" }));
  assert.equal(appels, 0);
  assert.ok(r3.ignore);
});

test("20. migration notifications_etat : création seule, policy restrictive seulement, aucune fonction", () => {
  const sql = lire("supabase/migrations/20261106084227_notifications_etat.sql")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  assert.match(sql, /create table if not exists public\.notifications_etat/);
  assert.match(sql, /primary key \(type, cle_objet\)/);
  assert.match(sql, /alter table public\.notifications_etat enable row level security/);
  assert.match(sql, /revoke all on public\.notifications_etat from anon/);
  assert.match(sql, /revoke all on public\.notifications_etat from authenticated/);
  assert.match(sql, /grant all on public\.notifications_etat to service_role/);
  const policies = [...sql.matchAll(/create policy (\w+) on ([\w.]+)\s+as (\w+)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(policies, [["profero_collaborateurs_seulement", "public.notifications_etat", "restrictive"]]);
  assert.match(sql, /using \(\(select public\.est_collaborateur_actif\(\)\)\) with check \(\(select public\.est_collaborateur_actif\(\)\)\)/);
  assert.ok(!/create (or replace )?function|security definer|\bdrop table\b|\bdelete\b|\bupdate\b|\binsert\b|alter table [\w.]+ (drop|rename)|truncate/i.test(sql),
    "purement additive : aucune fonction, aucune donnée touchée");
  const tables = [...sql.matchAll(/create table if not exists ([\w.]+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["public.notifications_etat"]);
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
