#!/usr/bin/env node
// Vérifie les notifications C4 / C5 / D1 « alertes chantiers » (projet
// docs/projets/notifications-push.md, tâche 6). Exemples issus des tests,
// données fictives.
//
//   1. la chaîne de la page Alertes est sortie dans alertesEcranV1.mjs SANS
//      changer le résultat (comparaison avec l'ancien calcul inline) ; l'écran
//      importe ce module ; le serveur aussi ;
//   2. les décisions (alertesChantiersPushV1.mjs) : aggravation notifiée, état
//      qui dure → rien, amélioration puis rechute → notifiée, premier passage
//      → 0 envoi, marge inconnue → rien, regroupement par type ;
//   3. le job serveur (api/_cron/cron-alertes-chantiers.js) avec un faux
//      Supabase et un faux send-push : premier passage, interrupteur coupé,
//      doublon du jour, simulation, relevé absent, lecture en échec ;
//   4. branchements : dispatcher, créneau GitHub, workflow de vérification.
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-alertes-chantiers.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as E from "../src/Renovation/alertesEcranV1.mjs";
import * as P from "../src/Renovation/alertesChantiersPushV1.mjs";
import { alertesV1, NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER } from "../src/Renovation/alertesV1.mjs";
import { alertesMargesV2 } from "../src/Renovation/alertesMargesV2.mjs";
import { preparerSemainesRelevesJournaliersV2, dimancheSemaineISOV2 } from "../src/Renovation/pointsAttentionDonneesV1.mjs";
import { estChantierActif } from "../src/Renovation/chantierActif.mjs";
import { validerContenu } from "../supabase/functions/_partage/notificationsPushV1.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Données fictives ─────────────────────────────────────────────────────────
// Relevés journaliers inventés : semaine 2026-W45 (02/11 → 08/11) et la
// précédente 2026-W44.
const releve = (id, date, o = {}) => ({
  id: `${id}-${date}`, chantier_id: id, chantier_nom: o.nom || `CHANTIER FICTIF ${id}`,
  week_id: o.week || null, date_releve: date,
  avancement: o.avancement ?? 40, vendu_ht: 100000, heures_vendues: 500, heures_reelles: o.heures ?? 200,
  production_cumulee: 40000, marge_avancement: 5000, marge_probable: o.margeProbable ?? 10000,
  marge_terminaison: o.margeTerminaison === undefined ? 10000 : o.margeTerminaison,
  budget_restant: 20000, heures_sans_lot: 0, pct_sans_lot: 0, chantier_repris: o.repris === true,
  lots: [], warnings: o.warnings || [], statut_completude: "complet",
});
const lignesFictives = () => [
  releve("A", "2026-10-30"), releve("A", "2026-11-05", { margeTerminaison: -3000 }), // devient critique + D1
  releve("B", "2026-10-30"), releve("B", "2026-11-05"),                              // sans alerte
  releve("C", "2026-10-30"), releve("C", "2026-11-05", { margeTerminaison: null }),  // marge inconnue
  releve("D", "2026-11-05", { nom: "DÉPOT", margeTerminaison: -50 }),                // exclu
  releve("E", "2026-11-05", { margeTerminaison: -800 }),                             // chantier « perdu » : filtré
  releve("F", "2026-11-05", { margeTerminaison: -900, repris: true }),               // repris : jamais d'alerte
];
const referentiel = [
  { id: "A", nom: "CHANTIER FICTIF A", statut: "en_cours" },
  { id: "B", nom: "CHANTIER FICTIF B", statut: "en_cours" },
  { id: "E", nom: "CHANTIER FICTIF E", statut: "perdu" },
];

// L'ANCIEN calcul de PageAlertes.jsx, recopié ici tel qu'il était avant la
// tâche 6, pour prouver que le module partagé rend exactement le même résultat.
function ancienCalculEcran({ lignes, semaines, seuilsMarges, referentielChantiers, exclusions }) {
  const [courantsBruts, precedentsBruts] = preparerSemainesRelevesJournaliersV2({ lignes, weekIds: semaines });
  const parId = new Map((referentielChantiers || []).map(c => [String(c?.id), c]));
  const garder = (s) => { const c = parId.get(String(s?.chantier_id)); return !c || estChantierActif(c, { inclureTermines: true }); };
  const courants = (courantsBruts || []).filter(garder);
  const precedents = (precedentsBruts || []).filter(garder);
  const pointsAttention = alertesMargesV2({ snapshotsCourants: courants || [], snapshotsPrecedents: precedents || [], seuils: seuilsMarges });
  return alertesV1({ snapshotsCourants: courants || [], snapshotsPrecedents: precedents || [], pointsAttention, exclusions });
}
const ancienDebut = (semaines) => {
  const d = new Date(`${dimancheSemaineISOV2(semaines[semaines.length - 1])}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 27);
  return d.toISOString().slice(0, 10);
};

// ── 1. L'écran et le module partagé ──────────────────────────────────────────
test("1. semaines comparées et fenêtre de lecture : identiques à l'ancien calcul de l'écran", () => {
  assert.deepEqual(E.semainesAlertesV1("2026-W45"), ["2026-W45", "2026-W44"]);
  assert.deepEqual(E.semainesAlertesV1("2026-W01"), ["2026-W01", "2025-W52"]);
  assert.deepEqual(E.semainesAlertesV1("2021-W01"), ["2021-W01", "2020-W53"]);
  assert.equal(E.semaineDeLaDateV1("2026-11-06"), "2026-W45");
  assert.equal(E.semaineDeLaDateV1("2027-01-01"), "2026-W53");
  for (const w of ["2026-W45", "2026-W01", "2021-W01", "2026-W14"]) {
    const s = E.semainesAlertesV1(w);
    assert.deepEqual(E.periodeRelevesAlertesV1(s), { debut: ancienDebut(s), fin: dimancheSemaineISOV2(s[0]) }, w);
  }
});

test("2. calculerAlertesEcranV1 = l'ancien calcul inline de PageAlertes.jsx (même résultat, au caractère près)", () => {
  const semaines = E.semainesAlertesV1("2026-W45");
  for (const seuils of [null, { alerteBaisseMargeProbableEuros: 100 }]) {
    for (const ref of [referentiel, null]) {
      const p = { lignes: lignesFictives(), semaines, seuilsMarges: seuils, referentielChantiers: ref, exclusions: ["DÉPOT"] };
      assert.equal(JSON.stringify(E.calculerAlertesEcranV1(p).resultat), JSON.stringify(ancienCalculEcran(p)));
    }
  }
  const r = E.calculerAlertesEcranV1({ lignes: lignesFictives(), semaines, referentielChantiers: referentiel }).resultat;
  assert.deepEqual(r.alertes.map((a) => [a.chantierId, a.niveau]), [["A", NIVEAU_CRITIQUE]]);
});

test("3. l'écran Alertes importe le même module ; mêmes exclusions ; le serveur aussi", () => {
  const page = lire("src/Renovation/PageAlertes.jsx");
  const code = sansCommentaires(page);
  assert.match(code, /from "\.\/alertesEcranV1\.js"/);
  assert.match(code, /calculerAlertesEcranV1\(\{/);
  assert.match(code, /semainesAlertesV1\(/);
  assert.match(code, /periodeRelevesAlertesV1\(semaines\)/);
  assert.ok(!/preparerSemainesRelevesJournaliersV2\(|alertesMargesV2\(|alertesV1\(\{|estChantierActif\(/.test(code),
    "l'écran ne refait plus la chaîne lui-même");
  const m = /const CHANTIERS_EXCLUS\s*=\s*(\[[^\]]*\])/.exec(page);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]), [...E.CHANTIERS_EXCLUS_ALERTES_V1]);
  assert.equal(lire("src/Renovation/alertesEcranV1.js").includes('export * from "./alertesEcranV1.mjs"'), true);
  const job = sansCommentaires(lire("api/_cron/cron-alertes-chantiers.js"));
  assert.match(job, /import\("\.\.\/\.\.\/src\/Renovation\/alertesEcranV1\.mjs"\)/);
  assert.match(job, /M\.ecran\.calculerAlertesEcranV1\(/);
  assert.match(job, /M\.ecran\.CHANTIERS_EXCLUS_ALERTES_V1/);
  assert.match(job, /M\.donnees\.idsRelevesRetenusV2\(/, "même lecture allégée que l'écran");
  assert.match(job, /M\.tables\.depuisLigneChantier/, "même référentiel de chantiers que l'écran");
});

test("4. modules purs : ni Supabase, ni horloge, ni effet de bord", () => {
  for (const f of ["src/Renovation/alertesEcranV1.mjs", "src/Renovation/alertesChantiersPushV1.mjs"]) {
    const c = sansCommentaires(lire(f));
    assert.ok(!/supabase|fetch\(|Date\.now|new Date\(|process\./.test(c.replace(/supabase\/functions\/_partage/g, "")), f);
  }
});

// ── 2. Les décisions ─────────────────────────────────────────────────────────
const etat = (id, niveau, marge = 5000, nom = `CHANTIER FICTIF ${id}`) => ({
  chantierId: id, nom, niveau, marge: P.signeMargeV1(marge), margeTerminaison: marge, avancement: 50, dateReleve: "2026-11-05",
});
const stock = (lignes) => lignes.map(([type, cle_objet, e]) => ({ type, cle_objet, etat: e }));
const DATE = "2026-11-09";

test("5. aggravations notifiées : aucun → à surveiller (C5), à surveiller → critique (C4), aucun → critique (C4 seul), marge ≥ 0 → < 0 (D1)", () => {
  const p = P.planAlertesChantiersV1({
    etats: [etat("A", NIVEAU_A_SURVEILLER), etat("B", NIVEAU_CRITIQUE), etat("C", NIVEAU_CRITIQUE), etat("D", "aucun", -1200)],
    etatsStockes: stock([["C4", "A", "aucun"], ["C4", "B", "a_surveiller"], ["C4", "C", "aucun"], ["C4", "D", "aucun"],
      ["D1", "A", "positive"], ["D1", "B", "positive"], ["D1", "C", "positive"], ["D1", "D", "positive"]]),
    dateParis: DATE,
  });
  assert.equal(p.premierPassage, false);
  assert.deepEqual(p.aggravations.C5.map((e) => e.chantierId), ["A"]);
  assert.deepEqual(p.aggravations.C4.map((e) => e.chantierId), ["B", "C"]);
  assert.deepEqual(p.aggravations.D1.map((e) => e.chantierId), ["D"]);
  assert.deepEqual(p.notifications.map((n) => n.type), ["C4", "C5", "D1"]);
  for (const n of p.notifications) assert.equal(validerContenu({ ...n }).ok, true, "accepté par send-push");
  assert.deepEqual(p.ecritures.filter((w) => w.notifiePar).map((w) => [w.type, w.cle_objet, w.etat, w.notifiePar]), [
    ["C4", "A", "a_surveiller", "C5"], ["C4", "B", "critique", "C4"], ["C4", "C", "critique", "C4"], ["D1", "D", "negative", "D1"],
  ]);
});

test("6. un état qui dure ne renvoie rien, et rien n'est réécrit", () => {
  const p = P.planAlertesChantiersV1({
    etats: [etat("A", NIVEAU_CRITIQUE, -100), etat("B", NIVEAU_A_SURVEILLER)],
    etatsStockes: stock([["C4", "A", "critique"], ["D1", "A", "negative"], ["C4", "B", "a_surveiller"], ["D1", "B", "positive"]]),
    dateParis: DATE,
  });
  assert.deepEqual(p.notifications, []);
  assert.deepEqual(p.ecritures, []);
});

test("7. amélioration : rien n'est envoyé, l'état est mis à jour ; rechute ensuite : notifiée", () => {
  let stocke = stock([["C4", "A", "critique"], ["D1", "A", "negative"]]);
  const p1 = P.planAlertesChantiersV1({ etats: [etat("A", "aucun", 2000)], etatsStockes: stocke, dateParis: DATE });
  assert.deepEqual(p1.notifications, []);
  assert.equal(p1.comptes.ameliorations, 2);
  assert.deepEqual(p1.ecritures.map((w) => [w.type, w.etat, w.notifiePar]), [["C4", "aucun", null], ["D1", "positive", null]]);
  stocke = stock(p1.ecritures.map((w) => [w.type, w.cle_objet, w.etat]));
  const p2 = P.planAlertesChantiersV1({ etats: [etat("A", NIVEAU_CRITIQUE, -10)], etatsStockes: stocke, dateParis: "2026-11-10" });
  assert.deepEqual(p2.notifications.map((n) => n.type), ["C4", "D1"]);
  // Critique → à surveiller → critique : la rechute repart aussi.
  const p3 = P.planAlertesChantiersV1({ etats: [etat("A", NIVEAU_A_SURVEILLER)], etatsStockes: stock([["C4", "A", "critique"]]), dateParis: DATE });
  assert.deepEqual(p3.notifications, [], "critique → à surveiller est une amélioration");
  const p4 = P.planAlertesChantiersV1({ etats: [etat("A", NIVEAU_CRITIQUE)], etatsStockes: stock([["C4", "A", "a_surveiller"]]), dateParis: DATE });
  assert.deepEqual(p4.notifications.map((n) => n.type), ["C4"]);
});

test("8. premier passage (aucune ligne C4/C5/D1) : 0 envoi, l'état de tous les chantiers est enregistré", () => {
  const etats = [etat("A", NIVEAU_CRITIQUE, -100), etat("B", NIVEAU_A_SURVEILLER), etat("C", "aucun", null)];
  // Une ligne F1 (tâche 7) ne compte pas : seules C4/C5/D1 font la référence.
  const p = P.planAlertesChantiersV1({ etats, etatsStockes: stock([["F1", "ph-1-acompte", "notifiee"]]), dateParis: DATE });
  assert.equal(p.premierPassage, true);
  assert.deepEqual(p.notifications, []);
  assert.deepEqual(p.ecritures.map((w) => [w.type, w.cle_objet, w.etat, w.notifiePar]), [
    ["C4", "A", "critique", null], ["D1", "A", "negative", null],
    ["C4", "B", "a_surveiller", null], ["D1", "B", "positive", null],
    ["C4", "C", "aucun", null],
  ]);
  // Hors premier passage, un chantier jamais vu est enregistré sans notification.
  const p2 = P.planAlertesChantiersV1({ etats: [etat("Z", NIVEAU_CRITIQUE, -5)], etatsStockes: stock([["C4", "A", "critique"]]), dateParis: DATE });
  assert.deepEqual(p2.notifications, []);
  assert.equal(p2.comptes.nouveaux, 1);
});

test("9. marge inconnue : ni oui ni non — rien n'est envoyé, le dernier signe connu n'est pas écrasé, elle est comptée « inconnue »", () => {
  assert.equal(P.signeMargeV1(null), P.MARGE_INCONNUE);
  assert.equal(P.signeMargeV1(""), P.MARGE_INCONNUE);
  assert.equal(P.signeMargeV1("abc"), P.MARGE_INCONNUE);
  assert.equal(P.signeMargeV1(0), P.MARGE_POSITIVE);
  assert.equal(P.signeMargeV1(-0.01), P.MARGE_NEGATIVE);
  const p = P.planAlertesChantiersV1({ etats: [etat("A", "aucun", null)], etatsStockes: stock([["C4", "A", "aucun"], ["D1", "A", "positive"]]), dateParis: DATE });
  assert.deepEqual(p.notifications, []);
  assert.deepEqual(p.ecritures, []);
  assert.equal(p.comptes.marges.inconnue, 1);
  // positive → inconnue → négative : la dernière valeur connue était positive, D1 part.
  const p2 = P.planAlertesChantiersV1({ etats: [etat("A", "aucun", -40)], etatsStockes: stock([["C4", "A", "aucun"], ["D1", "A", "positive"]]), dateParis: DATE });
  assert.deepEqual(p2.notifications.map((n) => n.type), ["D1"]);
  // Jamais connue puis négative : pas de référence, rien ne part.
  const p3 = P.planAlertesChantiersV1({ etats: [etat("A", "aucun", -40)], etatsStockes: stock([["C4", "A", "aucun"]]), dateParis: DATE });
  assert.deepEqual(p3.notifications, []);
});

test("10. regroupement : une notification par type et par passage ; 1 chantier → sa fiche, plusieurs → page Alertes / Bilan semaine", () => {
  const p = P.planAlertesChantiersV1({
    etats: [etat("X", NIVEAU_CRITIQUE, -10, "VILLA FICTIVE X"), etat("Y", NIVEAU_CRITIQUE, -20, "MAISON FICTIVE Y"), etat("Z", NIVEAU_A_SURVEILLER, 10, "LOFT FICTIF Z")],
    etatsStockes: stock([["C4", "X", "aucun"], ["C4", "Y", "a_surveiller"], ["C4", "Z", "aucun"], ["D1", "X", "positive"], ["D1", "Y", "positive"], ["D1", "Z", "positive"]]),
    dateParis: DATE,
  });
  const [c4, c5, d1] = p.notifications;
  assert.equal(p.notifications.length, 3);
  assert.equal(c4.titre, "2 chantiers passent en critique");
  assert.equal(c4.texte, "VILLA FICTIVE X\nMAISON FICTIVE Y");
  assert.equal(c4.lien, "/?page=alertes");
  assert.equal(c4.cle_regroupement, "C4-2026-11-09");
  assert.equal(c5.titre, "Chantier à surveiller : LOFT FICTIF Z");
  assert.equal(c5.lien, "/?page=chantiers&chantier=Z");
  assert.equal(c5.cle_regroupement, "C5-2026-11-09");
  assert.equal(d1.titre, "2 chantiers passent en marge à terminaison négative");
  assert.equal(d1.lien, "/?page=bilan-semaine");
  assert.equal(d1.cle_regroupement, "D1-2026-11-09");
  assert.match(d1.texte, /VILLA FICTIVE X · marge à terminaison −10 € · avancement 50 %/);
  // Beaucoup de chantiers : texte tronqué proprement (send-push refuse > 1000 caractères).
  const beaucoup = Array.from({ length: 80 }, (_, i) => etat(`K${i}`, NIVEAU_CRITIQUE, 5, `CHANTIER FICTIF AU NOM TRÈS LONG NUMÉRO ${i}`));
  const n = P.contenuNotificationAlertesV1("C4", beaucoup, DATE);
  assert.ok(n.texte.length <= 1000);
  assert.match(n.texte, /… et \d+ autres$/);
  assert.equal(validerContenu({ ...n }).ok, true);
});

test("11. états : niveau « info » = aucun ; DÉPOT et chantier repris n'ont pas d'état", () => {
  const semaines = E.semainesAlertesV1("2026-W45");
  const { resultat, courants } = E.calculerAlertesEcranV1({ lignes: lignesFictives(), semaines, referentielChantiers: referentiel });
  const etats = P.etatsChantiersV1({ resultat, courants, exclusions: E.CHANTIERS_EXCLUS_ALERTES_V1 });
  assert.deepEqual(etats.map((e) => [e.chantierId, e.niveau, e.marge]), [
    ["A", "critique", "negative"], ["B", "aucun", "positive"], ["C", "aucun", "inconnue"],
  ]);
  assert.equal(P.niveauNotificationV1({ niveau: "info" }), "aucun");
  assert.equal(P.niveauNotificationV1(null), "aucun");
});

// ── 3. Le job serveur ────────────────────────────────────────────────────────
function fauxSupabase(tables, { erreurSur = null } = {}) {
  const ecritures = [];
  return {
    ecritures,
    from(table) {
      const q = {
        _filtres: [],
        select() { return q; },
        eq(col, v) { q._filtres.push((l) => l[col] === v); return q; },
        in(col, vs) { q._filtres.push((l) => vs.includes(l[col])); return q; },
        gte(col, v) { q._filtres.push((l) => String(l[col]) >= v); return q; },
        lte(col, v) { q._filtres.push((l) => String(l[col]) <= v); return q; },
        order() { return q; },
        _lire() {
          if (erreurSur === table) return { data: null, error: { message: "lecture impossible (fictif)" } };
          let lignes = tables[table] || [];
          for (const f of q._filtres) lignes = lignes.filter(f);
          return { data: lignes, error: null };
        },
        range(a) { const r = q._lire(); return Promise.resolve(r.error ? r : { data: a === 0 ? r.data : [], error: null }); },
        then(ok, ko) { return Promise.resolve(q._lire()).then(ok, ko); },
        maybeSingle() { return Promise.resolve({ data: null, error: erreurSur === table ? { message: "x" } : null }); },
        upsert(lignes, options) {
          ecritures.push([table, lignes, options]);
          const t = (tables[table] ??= []);
          for (const l of lignes) {
            const i = t.findIndex((x) => x.type === l.type && x.cle_objet === l.cle_objet);
            if (i >= 0) t[i] = { ...t[i], ...l }; else t.push(l);
          }
          return Promise.resolve({ error: null });
        },
        update() { ecritures.push([table, "update"]); return q; },
        insert() { ecritures.push([table, "insert"]); return q; },
        delete() { ecritures.push([table, "delete"]); return q; },
      };
      return q;
    },
  };
}
const tablesFictives = () => ({
  chantier_releves_journaliers: lignesFictives(),
  chantiers: referentiel.map((c) => ({ ...c, archive_le: null, donnees: {} })),
  notifications_etat: [],
});
const T = { hour: 9, dateIso: "2026-11-06" };

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
const { runAlertesChantiers } = require("../api/_cron/cron-alertes-chantiers.js");

test("12. job, premier passage : 0 envoi (send-push jamais appelé), l'état de tous les chantiers est enregistré", async () => {
  const tables = tablesFictives();
  const sb = fauxSupabase(tables);
  let appels = 0;
  const r = await avecFetch(async () => { appels++; return reponse({}); }, () => runAlertesChantiers({ query: {} }, sb, T));
  assert.equal(appels, 0);
  assert.equal(r.premier_passage, true);
  assert.equal(r.notifications, 0);
  assert.equal(r.etats_enregistres, 5);
  assert.match(r.message, /Premier passage : 0 envoi, 5 états/);
  assert.deepEqual(tables.notifications_etat.map((l) => [l.type, l.cle_objet, l.etat]), [
    ["C4", "A", "critique"], ["D1", "A", "negative"], ["C4", "B", "aucun"], ["D1", "B", "positive"], ["C4", "C", "aucun"],
  ]);
  assert.ok(sb.ecritures.every(([t, , o]) => t === "notifications_etat" && o.onConflict === "type,cle_objet"));
  assert.ok(tables.notifications_etat.every((l) => !("notifie_le" in l)), "rien n'a été notifié");
});

test("13. job, interrupteur coupé : rien n'est envoyé, mais ce qui a été VU est enregistré (pas d'arriéré à l'activation)", async () => {
  const tables = tablesFictives();
  tables.notifications_etat = [
    { type: "C4", cle_objet: "A", etat: "aucun" }, { type: "D1", cle_objet: "A", etat: "positive" },
    { type: "C4", cle_objet: "B", etat: "aucun" }, { type: "D1", cle_objet: "B", etat: "positive" },
  ];
  const corps = [];
  const r = await avecFetch(async (url, init) => {
    corps.push(JSON.parse(init.body));
    return reponse({ ok: true, simulation: false, resume: { bloque_par: "interrupteur_coupe", doublons: 0 }, envoyes: 0, echecs: 0 });
  }, () => runAlertesChantiers({ query: {} }, fauxSupabase(tables), T));
  assert.deepEqual(corps.map((c) => [c.mode, c.type, c.cle_regroupement, c.lien]), [
    ["serveur", "C4", "C4-2026-11-06", "/?page=chantiers&chantier=A"],
    ["serveur", "D1", "D1-2026-11-06", "/?page=chantiers&chantier=A"],
  ]);
  assert.deepEqual(r.envois.map((e) => e.bloque_par), ["interrupteur_coupe", "interrupteur_coupe"]);
  const a = tables.notifications_etat.filter((l) => l.cle_objet === "A").map((l) => [l.type, l.etat, "notifie_le" in l]);
  assert.deepEqual(a, [["C4", "critique", false], ["D1", "negative", false]]);
  // Passage suivant, interrupteur allumé : l'aggravation déjà vue ne repart pas.
  let appels = 0;
  const r2 = await avecFetch(async () => { appels++; return reponse({}); }, () => runAlertesChantiers({ query: {} }, fauxSupabase(tables), { hour: 9, dateIso: "2026-11-09" }));
  assert.equal(appels, 0);
  assert.equal(r2.notifications, 0);
});

test("14. job, envoi réel : notifie_le posé ; doublon du jour ou erreur send-push → ancien état gardé (repart au passage suivant)", async () => {
  const depart = () => {
    const t = tablesFictives();
    t.notifications_etat = [{ type: "C4", cle_objet: "A", etat: "aucun" }, { type: "D1", cle_objet: "A", etat: "positive" }];
    return t;
  };
  let tables = depart();
  await avecFetch(async () => reponse({ ok: true, resume: { bloque_par: null, doublons: 0 }, ecrites_en_boite: 2, envoyes: 1, echecs: 0 }),
    () => runAlertesChantiers({ query: {} }, fauxSupabase(tables), T));
  assert.deepEqual(tables.notifications_etat.filter((l) => l.cle_objet === "A").map((l) => [l.type, l.etat, typeof l.notifie_le]),
    [["C4", "critique", "string"], ["D1", "negative", "string"]]);

  tables = depart();
  const r = await avecFetch(async () => reponse({ ok: true, resume: { bloque_par: null, doublons: 2 }, ecrites_en_boite: 0, envoyes: 0, echecs: 0 }),
    () => runAlertesChantiers({ query: {} }, fauxSupabase(tables), T));
  assert.deepEqual(r.envois.map((e) => e.reporte), [true, true]);
  assert.deepEqual(tables.notifications_etat.filter((l) => l.cle_objet === "A").map((l) => l.etat), ["aucun", "positive"]);

  tables = depart();
  const r2 = await avecFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: "panne fictive" }) }),
    () => runAlertesChantiers({ query: {} }, fauxSupabase(tables), T));
  assert.match(r2.error, /send-push a répondu 500/);
  assert.deepEqual(tables.notifications_etat.filter((l) => l.cle_objet === "A").map((l) => l.etat), ["aucun", "positive"]);
});

test("15. simulation=1 : n'écrit ni n'envoie rien, renvoie ce qui serait fait (send-push en simulation seulement)", async () => {
  const tables = tablesFictives();
  tables.notifications_etat = [{ type: "C4", cle_objet: "A", etat: "aucun" }, { type: "D1", cle_objet: "A", etat: "positive" }];
  const sb = fauxSupabase(tables);
  const corps = [];
  const r = await avecFetch(async (url, init) => { corps.push(JSON.parse(init.body)); return reponse({ ok: true, simulation: true, resume: { destinataires: 2 } }); },
    () => runAlertesChantiers({ query: { simulation: "1" } }, sb, { hour: 6, dateIso: "2026-11-06" }));
  assert.deepEqual(sb.ecritures, []);
  assert.ok(corps.every((c) => c.simulation === true), "send-push appelé en simulation seulement");
  assert.equal(r.simulation, true);
  assert.deepEqual(r.aggravations, { C4: ["CHANTIER FICTIF A"], C5: [], D1: ["CHANTIER FICTIF A"] });
  assert.deepEqual(r.detail_notifications.map((n) => [n.type, n.destinataires.destinataires]), [["C4", 2], ["D1", 2]]);
  assert.deepEqual(r.marges_a_terminaison, { negative: 1, positive: 1, inconnue: 1 });
  assert.equal(r.detail_chantiers.find((c) => c.chantier_id === "C").marge_terminaison, "inconnue");
});

test("16. relevé absent : rien d'écrit ni d'envoyé, « pas encore disponible » ; lecture en échec : erreur, jamais « aucune alerte » ; pas_avant", async () => {
  const tables = tablesFictives();
  tables.chantier_releves_journaliers = [];
  const sb = fauxSupabase(tables);
  const r = await avecFetch(async () => { throw new Error("ne doit pas être appelé"); }, () => runAlertesChantiers({ query: {} }, sb, T));
  assert.equal(r.releve_disponible, false);
  assert.match(r.message, /pas encore disponible/);
  assert.deepEqual(sb.ecritures, []);
  for (const table of ["chantier_releves_journaliers", "chantiers", "notifications_etat", "planning_config"]) {
    await assert.rejects(() => runAlertesChantiers({ query: {} }, fauxSupabase(tablesFictives(), { erreurSur: table }), T), undefined, table);
  }
  const r3 = await runAlertesChantiers({ query: { pas_avant: "9" } }, fauxSupabase(tablesFictives()), { hour: 8, dateIso: "2026-11-06" });
  assert.ok(r3.ignore);
});

test("17. le job n'écrit que dans notifications_etat, n'envoie aucun mail", () => {
  const job = sansCommentaires(lire("api/_cron/cron-alertes-chantiers.js"));
  assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.rpc\(/.test(job));
  assert.deepEqual(job.match(/\.from\([^)]*\)\.upsert\(/g), [".from(TABLE_ETAT).upsert("]);
  assert.match(job, /const TABLE_ETAT = "notifications_etat"/);
  assert.ok(!/envoyerMail|send-email/.test(job));
});

// ── 4. Branchements ──────────────────────────────────────────────────────────
test("18. dispatcher, créneau pg_cron 9h05 Paris (été / hiver), simulation à la main sur GitHub, workflow de vérification", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /require\("\.\/_cron\/cron-alertes-chantiers\.js"\)/);
  assert.match(disp, /alertes_chantiers:\s*\{\s*fenetre:\s*null/);
  for (const job of ["recap_commandes", "rappel_rapport", "push_reportes", "push_simulation", "factures_a_emettre", "push_materiaux"]) {
    assert.match(disp, new RegExp(`${job}:\\s*\\{`), `job ${job} conservé`);
  }
  const wf = lire(".github/workflows/cron-alertes-chantiers.yml");
  // Créneau tenu par la base (pg_cron), plus par GitHub — détail : verif-cron-notifications.mjs.
  assert.ok(!/^\s*schedule:/m.test(wf), "plus de schedule GitHub");
  const migr = lire("supabase/migrations/20261109134233_cron_notifications_push.sql");
  assert.match(migr, /'profero_push_alertes_chantiers',\s*'5 7,8 \* \* 1-5'/);
  assert.match(migr, /cron-dispatcher\?job=alertes_chantiers&pas_avant=9'/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /default: true/);
  assert.match(wf, /job="alertes_chantiers&simulation=1"/);
  assert.match(lire(".github/workflows/verify-alertes-chantiers.yml"), /node scripts\/verif-alertes-chantiers\.mjs/);
  assert.match(lire("src/Renovation/journalMaj.js"), /passe en alerte/);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`ok   ${nom}`); }
  catch (e) { echecs++; console.error(`ÉCHEC ${nom}\n     ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications passées.`);
if (echecs) process.exit(1);
