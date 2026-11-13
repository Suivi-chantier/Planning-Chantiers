#!/usr/bin/env node
// Vérifie les notifications F2, D2, D3 et D4 (projet
// docs/projets/notifications-push.md, tâche 8). Exemples issus des tests,
// données fictives.
//
//   1. F2 : le calcul de l'encours est sorti du mail dans
//      encoursFournisseursV1.mjs SANS changer le résultat (comparaison avec
//      une copie de l'ancien calcul) ; le mail l'importe ; le push part APRÈS
//      le mail, avec le même total ; simulation = ni mail ni push ;
//   2. D2 : « Devis signé » lu comme la fiche (table, sinon ancien cycle),
//      premier passage silencieux, un chantier notifié une seule fois,
//      regroupement ; le job avec un faux Supabase et un faux send-push ;
//   3. D3 : bandeau du Bilan produit par les fonctions de l'écran ; relevé
//      absent → « relevé pas encore disponible », jamais un chiffre ;
//   4. D4 : boîte seule (statut boite_seule, même en plage de silence), rien
//      quand l'écart vaut 0, une notification sinon ;
//   5. créneaux : workflows, heure d'été / d'hiver, plage de silence,
//      dispatcher (tous les jobs conservés).
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-notifications-direction.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Module from "node:module";
import * as E from "../src/Renovation/encoursFournisseursV1.mjs";
import * as D from "../src/Renovation/notificationsDirectionV1.mjs";
import * as B from "../src/Renovation/bilanPeriodeV3.mjs";
import {
  validerContenu, typeDuCatalogue, statutPush, estEnSilence, parisVersUtcMs, partiesParis, SILENCE_DEFAUT, lienVersNavigation,
} from "../supabase/functions/_partage/notificationsPushV1.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Les handlers api/ chargent @supabase/supabase-js au démarrage ; ce script
// n'en a pas besoin (faux Supabase) et ne dépend d'aucune installation.
const fauxPaquet = join(mkdtempSync(join(tmpdir(), "verif-dir-")), "faux-supabase.cjs");
writeFileSync(fauxPaquet, "module.exports = { createClient() { throw new Error('createClient non disponible dans la vérification'); } };\n");
const resoudre = Module._resolveFilename;
Module._resolveFilename = function (demande, ...reste) {
  if (demande === "@supabase/supabase-js") return fauxPaquet;
  return resoudre.call(this, demande, ...reste);
};

// ── Faux Supabase et faux réseau ────────────────────────────────────────────
function fauxSupabase(tables, { config = {} } = {}) {
  const ecritures = [];
  return {
    ecritures,
    rpc: async (nom) => (tables._rpc ? tables._rpc(nom) : { data: null, error: { message: "rpc absente" } }),
    from(table) {
      const q = {
        _filtres: [],
        select() { return q; },
        eq(col, v) { q._filtres.push((l) => l[col] === v); return q; },
        in(col, vs) { q._filtres.push((l) => vs.includes(l[col])); return q; },
        is() { return q; }, neq() { return q; }, limit() { return q; }, order() { return q; },
        gte() { return q; }, lte() { return q; },
        _lire() {
          let lignes = tables[table] || [];
          for (const f of q._filtres) lignes = lignes.filter(f);
          return { data: lignes, error: null };
        },
        range(a) { const r = q._lire(); return Promise.resolve({ data: a === 0 ? r.data : [], error: null }); },
        then(ok, ko) { return Promise.resolve(q._lire()).then(ok, ko); },
        maybeSingle() {
          const cle = q._cle;
          return Promise.resolve({ data: table === "planning_config" && cle in config ? { value: config[cle] } : null, error: null });
        },
        upsert(lignes, options) {
          ecritures.push([table, lignes, options]);
          const t = (tables[table] ??= []);
          for (const l of Array.isArray(lignes) ? lignes : [lignes]) {
            const i = t.findIndex((x) => x.type === l.type && x.cle_objet === l.cle_objet);
            if (i >= 0) { if (!options?.ignoreDuplicates) t[i] = { ...t[i], ...l }; } else t.push(l);
          }
          return Promise.resolve({ error: null });
        },
      };
      const eqOrig = q.eq;
      q.eq = (col, v) => { if (col === "key") q._cle = v; return eqOrig(col, v); };
      return q;
    },
  };
}

async function avecFetch(faux, fn) {
  const avant = globalThis.fetch;
  const env = { url: process.env.VITE_SUPABASE_URL, cle: process.env.SUPABASE_SERVICE_ROLE_KEY, secret: process.env.CRON_SECRET };
  globalThis.fetch = faux;
  process.env.VITE_SUPABASE_URL = "https://exemple.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-fictive";
  process.env.CRON_SECRET = "secret-fictif";
  try { return await fn(); } finally {
    globalThis.fetch = avant;
    for (const [k, v] of [["VITE_SUPABASE_URL", env.url], ["SUPABASE_SERVICE_ROLE_KEY", env.cle], ["CRON_SECRET", env.secret]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}
const reponse = (corps) => ({ ok: true, status: 200, json: async () => corps });
const corpsDe = (o) => JSON.parse(o.body);

// ═══ 1. F2 — Encours fournisseurs ═══════════════════════════════════════════
// Copie de l'ANCIEN calcul du mail (api/cron-encours-fournisseurs.js avant la
// tâche 8), gardée ici comme référence.
function ancienCalcul(fournQ, cmdQ, factQ) {
  const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  function echeanceISO(docISO, mode) {
    if (!docISO) return docISO || "";
    const d = new Date(docISO + "T00:00:00");
    if (isNaN(d.getTime())) return docISO;
    if (mode === "30j") { d.setDate(d.getDate() + 30); }
    else if (mode === "echeance") {
      const fdm = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      fdm.setDate(fdm.getDate() + 30);
      return fdm.toISOString().slice(0, 10);
    } else { return docISO; }
    return d.toISOString().slice(0, 10);
  }
  const modeById = {}, modeByNom = {};
  (fournQ.data || []).forEach(f => { modeById[f.id] = f.mode_paiement || ""; if (f.nom) modeByNom[normNom(f.nom)] = f.mode_paiement || ""; });
  const modeOf = (id, nom) => modeById[id] || modeByNom[normNom(nom)] || "";
  const moisMap = new Map();
  const add = (mois, fournisseur, champ, montant) => {
    const m = mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, new Map());
    const pfMap = moisMap.get(m);
    if (!pfMap.has(fournisseur)) pfMap.set(fournisseur, { nom: fournisseur, saisi: 0, facture: 0, paye: 0 });
    pfMap.get(fournisseur)[champ] += montant;
  };
  (cmdQ.data || []).forEach(c => {
    if (c.source === "migration") return;
    const montant = c.montant_ht != null ? Number(c.montant_ht) : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
    if (!montant) return;
    const docISO = c.date_doc || (c.created_at || "").slice(0, 10);
    const paye = c.statut_facturation === "facture";
    const dueISO = paye ? docISO : echeanceISO(docISO, modeOf(c.fournisseur_id, c.fournisseur_nom));
    add((dueISO || "").slice(0, 7), c.fournisseur_nom || "Sans fournisseur", paye ? "paye" : "saisi", montant);
  });
  (factQ.data || []).forEach(f => {
    const montant = Number(f.montant_ht) || 0;
    if (!montant) return;
    const docISO = f.date_facture || (f.created_at || "").slice(0, 10);
    const dueISO = echeanceISO(docISO, modeOf(f.fournisseur_id, f.fournisseur_nom));
    add((dueISO || "").slice(0, 7), f.fournisseur_nom || "Sans fournisseur", "facture", montant);
  });
  const aPayerOf = (pf) => (pf.facture > 0 ? pf.facture : pf.saisi);
  const mois = [...moisMap.entries()]
    .map(([m, pfMap]) => {
      const fourns = [...pfMap.values()].sort((a, b) => aPayerOf(b) - aPayerOf(a));
      const aPayer = fourns.reduce((s, pf) => s + aPayerOf(pf), 0);
      return { mois: m, fourns, aPayer };
    })
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .slice(0, 6);
  return { mois, totalAPayer: mois.reduce((s, g) => s + g.aPayer, 0) };
}

// Fournisseurs et pièces fictifs : trois modes de paiement, un nom accentué
// rapproché par le nom, une commande de migration (ignorée), une commande
// payée, une commande sans montant (somme des lignes), sept mois d'échéance.
const fournisseursFictifs = [
  { id: "f1", nom: "Négoce Fictif", mode_paiement: "30j" },
  { id: "f2", nom: "Bois Exemple", mode_paiement: "echeance" },
  { id: "f3", nom: "Comptant SA", mode_paiement: "" },
];
const commandesFictives = [
  { fournisseur_id: "f1", fournisseur_nom: "Négoce Fictif", montant_ht: 1200.5, date_doc: "2026-10-12", statut_facturation: null, source: null },
  { fournisseur_id: null, fournisseur_nom: "NEGOCE FICTIF", montant_ht: 300, date_doc: "2026-10-30", statut_facturation: null, source: null },
  { fournisseur_id: "f2", fournisseur_nom: "Bois Exemple", montant_ht: null, date_doc: "2026-09-15", statut_facturation: null, source: null, lignes: [{ prix_total: 400 }, { prix_total: 99.9 }] },
  { fournisseur_id: "f2", fournisseur_nom: "Bois Exemple", montant_ht: 800, date_doc: "2026-08-01", statut_facturation: "facture", source: null },
  { fournisseur_id: "f3", fournisseur_nom: "Comptant SA", montant_ht: 50, date_doc: null, created_at: "2026-05-03T10:00:00Z", statut_facturation: null, source: null },
  { fournisseur_id: "f3", fournisseur_nom: "Comptant SA", montant_ht: 9999, date_doc: "2026-11-01", source: "migration" },
  { fournisseur_id: "f1", fournisseur_nom: "Négoce Fictif", montant_ht: 0, date_doc: "2026-11-01", source: null },
  { fournisseur_id: "f3", fournisseur_nom: "Comptant SA", montant_ht: 75, date_doc: "2026-04-20", source: null },
  { fournisseur_id: "f3", fournisseur_nom: "Comptant SA", montant_ht: 60, date_doc: "2026-06-20", source: null },
  { fournisseur_id: "f3", fournisseur_nom: "Comptant SA", montant_ht: 40, date_doc: "2026-03-10", source: null },
];
const facturesFictives = [
  { fournisseur_id: "f1", fournisseur_nom: "Négoce Fictif", montant_ht: 1250, date_facture: "2026-10-12", statut: "a_payer" },
  { fournisseur_id: "f2", fournisseur_nom: "Bois Exemple", montant_ht: 510, date_facture: "2026-09-15", statut: "a_payer" },
];

test("1. encours : le module rend EXACTEMENT l'ancien calcul du mail (mois, fournisseurs, totaux)", () => {
  const ancien = ancienCalcul({ data: fournisseursFictifs }, { data: commandesFictives }, { data: facturesFictives });
  const nouveau = E.calculerEncoursFournisseursV1({ fournisseurs: fournisseursFictifs, commandes: commandesFictives, factures: facturesFictives });
  assert.deepEqual(nouveau, ancien);
  assert.equal(nouveau.mois.length, 6, "6 mois les plus récents, comme le mail");
  assert.ok(nouveau.totalAPayer > 0);
  assert.equal(E.echeanceISO("2026-07-01", "echeance"), "2026-08-30", "30 j fin de mois : exemple du commentaire d'origine");
  assert.equal(E.moisLabel("2026-11"), "novembre 2026");
  assert.equal(E.moisLabel("____"), "Sans date");
});

test("2. le mail importe le module et ne garde aucune copie du calcul ; le module est pur", () => {
  const mail = sansCommentaires(lire("api/cron-encours-fournisseurs.js"));
  assert.match(mail, /import\("\.\.\/src\/Renovation\/encoursFournisseursV1\.mjs"\)/);
  assert.match(mail, /calculerEncoursFournisseursV1\(/);
  for (const ancien of ["function echeanceISO", "const normNom", "moisMap", "function eur(", "MOIS_FR"]) {
    assert.ok(!mail.includes(ancien), `copie du calcul retirée du mail : ${ancien}`);
  }
  const mod = sansCommentaires(lire("src/Renovation/encoursFournisseursV1.mjs"));
  assert.ok(!/supabase|Date\.now|new Date\(\)|fetch\(/.test(mod), "aucun accès Supabase, aucune horloge, aucun réseau");
  // Mêmes sujet et destinataires qu'avant.
  assert.match(mail, /Encours fournisseurs du \$\{t\.dateFr\}/);
  assert.match(mail, /encours_mail_destinataires/);
  assert.match(mail, /\.in\("role", \["admin", "comptable"\]\)/);
});

function tablesEncours() {
  return {
    fournisseurs: fournisseursFictifs, commandes: commandesFictives, factures: facturesFictives,
    utilisateurs: [{ email: "direction@exemple.invalid", role: "admin", actif: true }],
  };
}
const T_VENDREDI = { dateFr: "06/11/2026", dateIso: "2026-11-06", hour: 18 };
const reqMail = (query = {}) => ({ headers: { host: "exemple.invalid" }, query });
const { runEncoursFournisseurs } = require("../api/cron-encours-fournisseurs.js");

test("3. job du vendredi : le mail part (même total, mêmes mois), PUIS un seul push F2 avec le même total et le lien vers l'encours", async () => {
  const appels = [];
  const r = await avecFetch(async (url, o) => {
    appels.push([String(url), corpsDe(o)]);
    return reponse(String(url).includes("send-push") ? { ok: true, ecrites_en_boite: 1, envoyes: 1, resume: {} } : { ok: true });
  }, () => runEncoursFournisseurs(reqMail(), fauxSupabase(tablesEncours()), T_VENDREDI));
  const ref = ancienCalcul({ data: fournisseursFictifs }, { data: commandesFictives }, { data: facturesFictives });
  assert.equal(appels.length, 2);
  assert.match(appels[0][0], /\/api\/send-email$/, "le mail d'abord");
  assert.match(appels[1][0], /\/functions\/v1\/send-push$/, "le push ensuite");
  const html = appels[0][1].html;
  assert.ok(html.includes(`${E.eurEncours(ref.totalAPayer)} € HT`), "total du mail = ancien calcul");
  for (const g of ref.mois) assert.ok(html.includes(`${E.eurEncours(g.aPayer)} € à payer`), `mois ${g.mois} dans le mail`);
  assert.equal(r.sent, true);
  assert.equal(r.total_a_payer, ref.totalAPayer);
  const push = appels[1][1];
  assert.equal(push.mode, "serveur");
  assert.equal(push.type, "F2");
  assert.ok(push.titre.includes(E.eurEncours(ref.totalAPayer)), "même total dans le push");
  assert.equal(push.lien, "/?page=encours-fournisseurs");
  assert.deepEqual(lienVersNavigation(push.lien), { page: "encours-fournisseurs", chantier: null });
  assert.equal(push.cle_regroupement, "F2-2026-11-06");
  assert.ok(validerContenu(push).ok);
  assert.equal(r.push_f2.notifications, 1);
});

test("4. F2 : simulation = ni mail ni push ; déjà envoyé aujourd'hui = rien ; push en échec = le mail reste envoyé", async () => {
  let appels = 0;
  const sim = await avecFetch(async () => { appels++; return reponse({}); },
    () => runEncoursFournisseurs(reqMail({ simulation: "1" }), fauxSupabase(tablesEncours()), T_VENDREDI));
  assert.equal(appels, 0);
  assert.equal(sim.simulation, true);
  assert.equal(sim.notification_f2.type, "F2");

  appels = 0;
  const deja = await avecFetch(async () => { appels++; return reponse({}); },
    () => runEncoursFournisseurs(reqMail(), fauxSupabase(tablesEncours(), { config: { encours_mail_state: { date: "06/11/2026" } } }), T_VENDREDI));
  assert.equal(appels, 0);
  assert.equal(deja.skipped, "already_sent_today");

  const r = await avecFetch(async (url) => (String(url).includes("send-push")
    ? { ok: false, status: 500, json: async () => ({ error: "panne fictive" }) } : reponse({ ok: true })),
  () => runEncoursFournisseurs(reqMail(), fauxSupabase(tablesEncours()), T_VENDREDI));
  assert.equal(r.sent, true);
  assert.equal(r.error, null, "le résultat du mail ne porte pas l'erreur du push");
  assert.match(r.push_f2.erreur, /panne fictive/);
  assert.ok(!("error" in r.push_f2), "clé « erreur », pas « error »");

  assert.equal(D.contenuPushF2V1({ mois: [], totalAPayer: 0, dateParis: "2026-11-06" }), null, "encours vide : rien, comme le mail");
});

// ═══ 2. D2 — Nouveau chantier signé ═════════════════════════════════════════
const chantiersFictifs = [
  { id: "ch-a", nom: "CHANTIER A", statut: "en_cours", archive_le: null },
  { id: "ch-b", nom: "CHANTIER B", statut: null, archive_le: null },
  { id: "ch-c", nom: "CHANTIER C", statut: "a_l_etude", archive_le: null },
  { id: "ch-perdu", nom: "PERDU", statut: "perdu", archive_le: null },
  { id: "ch-archive", nom: "ARCHIVÉ", statut: null, archive_le: "2026-10-01" },
];
const signe = (date) => ({ fait: true, date, donnees: {} });
const phasagesFictifs = [
  // Ancien cycle (phasage) repris ; le phasage le plus récent fait foi.
  { chantier_id: "ch-a", updated_at: "2026-09-01", plan_travaux: { meta: { cycle_vie_etapes: { devis_signe: signe("2026-08-10T10:00:00Z") } } } },
  { chantier_id: "ch-b", updated_at: "2026-01-01", plan_travaux: { meta: { cycle_vie_etapes: { devis_signe: signe("2026-01-01T10:00:00Z") } } } },
  { chantier_id: "ch-b", updated_at: "2026-10-01", plan_travaux: { meta: { cycle_vie_etapes: {} } } },
  // « Réponse client » (ancienne étape sans équivalent) n'est pas une signature.
  { chantier_id: "ch-c", updated_at: "2026-10-01", plan_travaux: { meta: { cycle_vie_etapes: { reponse_client: { fait: true } } } } },
  { chantier_id: "ch-perdu", updated_at: "2026-10-01", plan_travaux: { meta: { cycle_vie_etapes: { devis_signe: signe("2026-10-01T10:00:00Z") } } } },
  { chantier_id: "ch-archive", updated_at: "2026-10-01", plan_travaux: { meta: { cycle_vie_etapes: { devis_signe: signe("2026-10-01T10:00:00Z") } } } },
];

test("5. D2 : « Devis signé » lu comme la fiche (table d'abord, sinon ancien cycle du phasage le plus récent) ; perdus et archivés exclus", () => {
  const s0 = D.chantiersSignesV1({ chantiers: chantiersFictifs, lignesCycleVie: [], phasages: phasagesFictifs });
  assert.deepEqual(s0.map((s) => s.chantierId), ["ch-a"]);
  assert.equal(s0[0].dateSignature, "2026-08-10");
  // Validation dans la table du nouveau cycle, avec la date de signature saisie.
  const lignes = [{ chantier_id: "ch-c", etape_id: "devis_signe", etat: { fait: true, date: "2026-11-05T09:00:00Z", donnees: { date: "2026-11-04" } } },
    { chantier_id: "ch-a", etape_id: "devis_signe", etat: { fait: false } }];
  const s1 = D.chantiersSignesV1({ chantiers: chantiersFictifs, lignesCycleVie: lignes, phasages: phasagesFictifs });
  assert.deepEqual(s1.map((s) => [s.chantierId, s.dateSignature]), [["ch-c", "2026-11-04"]], "la table prime sur l'ancien cycle (ch-a dé-validé)");
  const src = sansCommentaires(lire("src/Renovation/notificationsDirectionV1.mjs"));
  assert.match(src, /etatsCycleVie\(/, "même lecture que la fiche (cycleVie.etatsCycleVie)");
  assert.match(src, /ETAPE_SIGNATURE/, "même étape que la bascule « Planifié »");
});

test("6. D2 : premier passage SILENCIEUX (référence + chantiers déjà signés), puis une notification par nouveau chantier, une seule fois", () => {
  const signes = [{ chantierId: "ch-a", nom: "CHANTIER A", dateSignature: "2026-08-10" }];
  const p1 = D.planD2V1({ signes, etatsStockes: [], dateParis: "2026-11-09" });
  assert.equal(p1.premierPassage, true);
  assert.equal(p1.notification, null);
  assert.deepEqual(p1.ecritures.map((e) => e.cle_objet), [D.CLE_REFERENCE_D2, "ch-a"]);
  // Premier passage sans aucun chantier signé : la référence suffit à le marquer.
  const vide = D.planD2V1({ signes: [], etatsStockes: [], dateParis: "2026-11-09" });
  assert.deepEqual(vide.ecritures.map((e) => e.cle_objet), [D.CLE_REFERENCE_D2]);
  const apresVide = D.planD2V1({ signes, etatsStockes: vide.ecritures, dateParis: "2026-11-10" });
  assert.equal(apresVide.premierPassage, false);
  assert.equal(apresVide.notification.titre, "Nouveau chantier signé : CHANTIER A");

  const p2 = D.planD2V1({ signes, etatsStockes: p1.ecritures, dateParis: "2026-11-10" });
  assert.equal(p2.notification, null, "déjà vu : rien");
  const deux = [...signes, { chantierId: "ch-b", nom: "CHANTIER B", dateSignature: "2026-11-09" }, { chantierId: "ch-c", nom: "CHANTIER C", dateSignature: null }];
  const p3 = D.planD2V1({ signes: deux, etatsStockes: p1.ecritures, dateParis: "2026-11-10" });
  assert.equal(p3.notification.titre, "2 nouveaux chantiers signés");
  assert.equal(p3.notification.texte, "CHANTIER B (signé le 09/11), CHANTIER C.");
  assert.equal(p3.notification.lien, "/?page=operations");
  assert.equal(p3.notification.cle_regroupement, "D2-2026-11-10");
  assert.ok(validerContenu(p3.notification).ok);
  const un = D.contenuPushD2V1({ nouveaux: [deux[1]], dateParis: "2026-11-10" });
  assert.deepEqual(lienVersNavigation(un.lien), { page: "chantiers", chantier: "ch-b" });
  // Beaucoup de chantiers : texte borné.
  const beaucoup = Array.from({ length: 30 }, (_, i) => ({ chantierId: `x${i}`, nom: `CHANTIER FICTIF ${i}`, dateSignature: "2026-11-09" }));
  const n = D.contenuPushD2V1({ nouveaux: beaucoup, dateParis: "2026-11-10" });
  assert.match(n.texte, /et 22 autres\.$/);
  assert.ok(validerContenu(n).ok);
});

const { runNouveauxChantiers, runSyntheseSemaine, notifierEcartJournal } = require("../api/_cron/cron-notifications-direction.js");
const tablesD2 = () => ({ chantiers: chantiersFictifs.map((c) => ({ ...c })), chantier_cycle_vie: [], phasages: phasagesFictifs, notifications_etat: [] });
const T_MATIN = { hour: 8, dateIso: "2026-11-09" };

test("7. job D2 : premier passage = 0 appel à send-push, état enregistré ; passage suivant = UNE notification ; rejouer = rien", async () => {
  const tables = tablesD2();
  const sb = fauxSupabase(tables);
  let appels = [];
  const fetchFaux = async (url, o) => { appels.push(corpsDe(o)); return reponse({ ok: true, ecrites_en_boite: 2, envoyes: 1, resume: {} }); };
  const r1 = await avecFetch(fetchFaux, () => runNouveauxChantiers({ query: {} }, sb, T_MATIN));
  assert.equal(appels.length, 0);
  assert.equal(r1.premier_passage, true);
  assert.equal(r1.etats_enregistres, 2, "référence + CHANTIER A");
  // Un chantier vient d'être signé (nouveau cycle).
  tables.chantier_cycle_vie.push({ chantier_id: "ch-b", etape_id: "devis_signe", etat: { fait: true, date: "2026-11-09T07:00:00Z", donnees: {} } });
  const r2 = await avecFetch(fetchFaux, () => runNouveauxChantiers({ query: {} }, sb, { hour: 8, dateIso: "2026-11-10" }));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].type, "D2");
  assert.equal(appels[0].titre, "Nouveau chantier signé : CHANTIER B");
  assert.deepEqual(r2.nouveaux, ["CHANTIER B"]);
  assert.equal(r2.etats_enregistres, 1);
  const r3 = await avecFetch(fetchFaux, () => runNouveauxChantiers({ query: {} }, sb, { hour: 9, dateIso: "2026-11-10" }));
  assert.equal(appels.length, 1, "second créneau du jour : rien de nouveau");
  assert.equal(r3.notifications, 0);
});

test("8. job D2 : interrupteur coupé → vu et enregistré (pas d'arriéré à l'activation) ; send-push en erreur ou doublon du jour → gardé pour le passage suivant", async () => {
  const base = () => {
    const t = tablesD2();
    t.notifications_etat = [{ type: "D2", cle_objet: D.CLE_REFERENCE_D2 }];
    return t;
  };
  let t = base();
  let r = await avecFetch(async () => reponse({ ok: true, ecrites_en_boite: 0, resume: { bloque_par: "interrupteur_coupe" } }),
    () => runNouveauxChantiers({ query: {} }, fauxSupabase(t), T_MATIN));
  assert.equal(r.envoi.bloque_par, "interrupteur_coupe");
  assert.equal(r.etats_enregistres, 1);
  assert.ok(t.notifications_etat.some((e) => e.cle_objet === "ch-a"));

  t = base();
  r = await avecFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: "indisponible" }) }),
    () => runNouveauxChantiers({ query: {} }, fauxSupabase(t), T_MATIN));
  assert.equal(r.etats_enregistres, 0);
  assert.match(r.error, /send-push/);
  assert.ok(!t.notifications_etat.some((e) => e.cle_objet === "ch-a"));

  t = base();
  r = await avecFetch(async () => reponse({ ok: true, ecrites_en_boite: 0, resume: { doublons: 4 } }),
    () => runNouveauxChantiers({ query: {} }, fauxSupabase(t), T_MATIN));
  assert.equal(r.etats_enregistres, 0);
  assert.equal(r.envoi.reporte, true);
});

test("9. job D2 : simulation = aucune écriture, send-push seulement en simulation ; avant 8h (créneau planifié) = ignoré", async () => {
  const t = tablesD2();
  t.notifications_etat = [{ type: "D2", cle_objet: D.CLE_REFERENCE_D2 }];
  const sb = fauxSupabase(t);
  const appels = [];
  const r = await avecFetch(async (url, o) => { appels.push(corpsDe(o)); return reponse({ ok: true, resume: { destinataires: 4 } }); },
    () => runNouveauxChantiers({ query: { simulation: "1" } }, sb, T_MATIN));
  assert.equal(sb.ecritures.length, 0);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].simulation, true);
  assert.equal(r.notification.type, "D2");
  const ign = await runNouveauxChantiers({ query: { pas_avant: "8" } }, fauxSupabase(tablesD2()), { hour: 7, dateIso: "2026-11-09" });
  assert.match(ign.ignore, /7h/);
});

// ═══ 3. D3 — Synthèse de la semaine ═════════════════════════════════════════
// Semaine fictive 2026-W45 (02/11 → 08/11), deux chantiers actifs, relevés
// du jeudi 29/10 (départ) et du vendredi 06/11 (fin).
const rel = (chantier_id, date_releve, production_cumulee, marge_avancement, heures_reelles) => ({
  chantier_id, chantier_nom: chantier_id.toUpperCase(), date_releve, avancement: 40, production_cumulee, marge_avancement, heures_reelles,
  marge_probable: 1000, vendu_ht: 20000, marge_terminaison: 900,
});
const donneesD3 = () => ({
  weekId: "2026-W45",
  chantiers: [{ id: "c1", nom: "CHANTIER UN" }, { id: "c2", nom: "CHANTIER DEUX" }, { id: "c3", nom: "DÉPOT" }, { id: "c4", nom: "ÉTUDE", statut: "a_l_etude" }],
  releves: [rel("c1", "2026-10-29", 10000, 1000, 100), rel("c2", "2026-10-29", 5000, 500, 50),
    rel("c1", "2026-11-06", 14000, 1500, 140), rel("c2", "2026-11-06", 6000, 300, 70)],
  pointages: [{ chantier_id: "c1", date: "2026-10-29", heures: 7 }, { chantier_id: "c1", date: "2026-11-06", heures: 8 }, { chantier_id: "c2", date: "2026-11-05", heures: 4 }],
  rapports: [], journal: [], commandes: [],
});

test("10. D3 : bandeau = fonctions de l'écran du Bilan (même présélection, même synthèse, même bandeau) ; texte avec ses chiffres", () => {
  const d = donneesD3();
  const s = D.syntheseSemaineD3V1(d);
  // Référence : la chaîne de BilanPeriode.jsx appelée directement.
  const periode = B.periodeSemaineV3("2026-W45");
  const bornes = B.bornesComparaisonV3(periode, d.pointages.map((p) => p.date));
  const activite = B.activiteChantiersV3({ periode, pointages: d.pointages, rapports: [], journal: [], commandes: [] });
  const retenus = B.preselectionChantiersV3({ chantiers: d.chantiers.filter((c) => c.nom !== "DÉPOT" && c.statut !== "a_l_etude"), activite })
    .filter((p) => p.coche).map((p) => ({ id: p.chantierId, nom: p.nom }));
  const ref = B.bandeauV3({ synthese: B.syntheseChantiersV3({ releves: B.indexerRelevesV3(d.releves), chantiers: retenus, bornes, periode }) });
  assert.deepEqual(s.bandeau, ref);
  assert.equal(s.releveDisponible, true);
  assert.equal(s.retenus, 2);
  assert.equal(ref.production, 5000);
  assert.equal(ref.margePeriode, 300);
  assert.equal(ref.heuresValidees, 60);
  const n = D.contenuPushD3V1(s);
  assert.equal(n.titre, "Synthèse de la semaine 45");
  assert.ok(n.texte.includes(`${(5000).toLocaleString("fr-FR")} €`), n.texte);
  assert.ok(n.texte.includes("+300 €"));
  assert.ok(n.texte.includes("6 % de la production"));
  assert.ok(n.texte.includes("60 h validées"));
  assert.equal(n.lien, "/?page=bilan-semaine");
  assert.equal(n.cle_regroupement, "D3-2026-W45");
  assert.ok(validerContenu(n).ok);
  const src = sansCommentaires(lire("src/Renovation/notificationsDirectionV1.mjs"));
  assert.match(src, /bandeauV3\(/);
  assert.match(src, /syntheseChantiersV3\(/);
  assert.ok(!/production_cumulee|marge_avancement/.test(src), "aucune colonne relue à la main : tout passe par la synthèse du Bilan");
});

test("11. D3 : relevé absent → « relevé pas encore disponible », jamais un chiffre (ni « 0 € »)", () => {
  const d = donneesD3();
  d.releves = d.releves.filter((r) => r.date_releve !== "2026-11-06");
  const s = D.syntheseSemaineD3V1(d);
  assert.equal(s.releveDisponible, false);
  const n = D.contenuPushD3V1(s);
  assert.match(n.texte, /Relevé pas encore disponible/);
  assert.ok(!/\d\s?€/.test(n.texte), "aucun montant");
  const sansTravail = D.syntheseSemaineD3V1({ ...donneesD3(), pointages: [] });
  assert.equal(sansTravail.releveDisponible, false, "semaine sans jour travaillé : pas de chiffre");
  assert.match(D.contenuPushD3V1({ ok: false }).texte, /Relevé pas encore disponible/);
  assert.equal(D.semaineEcouleeV1("2026-11-09"), "2026-W45", "lundi 09/11 → semaine 45");
  assert.equal(D.semaineEcouleeV1("2027-01-04"), "2026-W53");
});

test("12. job D3 : simulation sans envoi ; envoi = un seul appel send-push D3 ; avant 8h = ignoré", async () => {
  const d = donneesD3();
  const tables = {
    chantiers: d.chantiers.map((c) => ({ ...c, archive_le: null, donnees: {} })),
    chantier_releves_journaliers: d.releves, pointages: d.pointages, rapports: [], avancement_journal: [], commande_lignes: [],
  };
  const appels = [];
  const fetchFaux = async (url, o) => { appels.push(corpsDe(o)); return reponse({ ok: true, ecrites_en_boite: 4, resume: {} }); };
  const sim = await avecFetch(fetchFaux, () => runSyntheseSemaine({ query: { simulation: "1" } }, fauxSupabase(tables), { hour: 8, dateIso: "2026-11-09" }));
  assert.equal(sim.semaine, "2026-W45");
  assert.equal(sim.releve_disponible, true);
  assert.equal(sim.bandeau.production, 5000);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].simulation, true);
  const r = await avecFetch(fetchFaux, () => runSyntheseSemaine({ query: {} }, fauxSupabase(tables), { hour: 8, dateIso: "2026-11-09" }));
  assert.equal(appels.length, 2);
  assert.equal(appels[1].type, "D3");
  assert.notEqual(appels[1].simulation, true);
  assert.equal(r.ecrites_en_boite, 4);
  const ign = await runSyntheseSemaine({ query: { pas_avant: "8" } }, fauxSupabase(tables), { hour: 7, dateIso: "2026-11-09" });
  assert.ok(ign.ignore);
});

// ═══ 4. D4 — Écart du journal d'avancement (boîte seule) ════════════════════
test("13. D4 est « boîte seule » : catalogue push=false, statut boite_seule même en pleine nuit (contrôle à 23h30)", () => {
  assert.equal(typeDuCatalogue("D4").push, false);
  assert.deepEqual(typeDuCatalogue("D4").roles, ["admin"]);
  const nuit = parisVersUtcMs(2026, 11, 6, 23, 30);
  assert.equal(estEnSilence(nuit, SILENCE_DEFAUT), true);
  assert.deepEqual(statutPush({ type: "D4", prefActive: true, nbAppareils: 2, vapidConfiguree: true, maintenantMs: nuit, silence: SILENCE_DEFAUT }),
    { push_statut: "boite_seule", push_prevu_le: null });
  assert.match(lire("supabase/functions/send-push/index.ts"), /push_statut !== "a_envoyer"/, "send-push n'envoie que les « a_envoyer »");
});

test("14. D4 : écart 0 → rien ; écart ≠ 0 → une notification (boîte des admins) ; contenu", async () => {
  assert.equal(D.contenuPushD4V1({ resultat: { ok: true, nb_taches: 3000, nb_ecarts: 0 }, dateParis: "2026-11-06" }), null);
  assert.equal(D.contenuPushD4V1({ resultat: { ok: false, code: "reponse_vide" } }), null);
  const n = D.contenuPushD4V1({ resultat: { ok: true, nb_taches: 3188, nb_ecarts: 3 }, dateParis: "2026-11-06" });
  assert.equal(n.type, "D4");
  assert.match(n.titre, /3 écarts/);
  assert.match(n.texte, /sur 3188/);
  assert.equal(n.lien, "/?page=admin");
  assert.equal(n.cle_regroupement, "D4-2026-11-06");
  assert.ok(validerContenu(n).ok);

  const { runJournalAvancement } = require("../api/_cron/cron-journal-avancement.js");
  const appels = [];
  const fetchFaux = async (url, o) => { appels.push(corpsDe(o)); return reponse({ ok: true, ecrites_en_boite: 4, resume: { boite_seule: 4 } }); };
  const T_NUIT = { hour: 23, dateIso: "2026-11-06" };
  const zero = await avecFetch(fetchFaux, () => runJournalAvancement({ query: {} },
    fauxSupabase({ _rpc: () => ({ data: { ok: true, nb_taches: 10, nb_ecarts: 0 }, error: null }) }), T_NUIT));
  assert.equal(appels.length, 0);
  assert.equal(zero.nb_ecarts, 0, "la réponse du contrôle est conservée");
  assert.equal(zero.notification_d4.notifications, 0);
  const deux = await avecFetch(fetchFaux, () => runJournalAvancement({ query: {} },
    fauxSupabase({ _rpc: () => ({ data: { ok: true, nb_taches: 10, nb_ecarts: 2 }, error: null }) }), T_NUIT));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].type, "D4");
  assert.equal(appels[0].mode, "serveur");
  assert.equal(deux.notification_d4.boite_seule, 4);
  // send-push indisponible : le contrôle n'est pas marqué en échec.
  const panne = await avecFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }),
    () => notifierEcartJournal({ ok: true, nb_ecarts: 1 }, T_NUIT));
  assert.equal(panne.notifications, 0);
  assert.ok(panne.erreur);
  assert.ok(!("error" in panne));
});

// ═══ 5. Créneaux et branchements ════════════════════════════════════════════
/** Heure de Paris d'un cron UTC (« m h ») à une date donnée. */
const heureParis = (date, h, m) => {
  const [a, mo, j] = date.split("-").map(Number);
  const p = partiesParis(Date.UTC(a, mo - 1, j, h, m));
  return p.heure * 60 + p.minute;
};

test("15. créneaux : D2 8h45 et D3 lundi 8h30 Paris, été comme hiver (pg_cron, deux passages UTC + garde heure de Paris + pas_avant=8), hors plage de silence ; F2 avant 20h", () => {
  const d2 = lire(".github/workflows/cron-push-nouveaux-chantiers.yml");
  // Créneaux tenus par la base (pg_cron), plus par GitHub : deux passages UTC,
  // la commande n'appelle que si l'heure de Paris vaut 8h. Détail (trois ans
  // simulés jour par jour) : verif-cron-notifications.mjs.
  assert.ok(!/^\s*schedule:/m.test(d2), "D2 : plus de schedule GitHub");
  assert.match(d2, /job="nouveaux_chantiers&simulation=1"/);
  const d3 = lire(".github/workflows/cron-push-synthese-semaine.yml");
  assert.ok(!/^\s*schedule:/m.test(d3), "D3 : plus de schedule GitHub");
  assert.match(d3, /job="synthese_semaine&simulation=1"/);
  const migr = lire("supabase/migrations/20261109134233_cron_notifications_push.sql");
  assert.match(migr, /'profero_push_nouveaux_chantiers',\s*'45 6,7 \* \* 1-5'/);
  assert.match(migr, /cron-dispatcher\?job=nouveaux_chantiers&pas_avant=8'/);
  assert.match(migr, /'profero_push_synthese_semaine',\s*'30 6,7 \* \* 1'/);
  assert.match(migr, /cron-dispatcher\?job=synthese_semaine&pas_avant=8'/);
  for (const [date, saison] of [["2026-07-13", "été"], ["2026-11-09", "hiver"]]) {
    const passeD2 = [[6, 45], [7, 45]].map(([h, m]) => heureParis(date, h, m)).filter((x) => Math.floor(x / 60) === 8);
    assert.deepEqual(passeD2, [8 * 60 + 45], `D2 : un seul appel, à 8h45 Paris (${saison})`);
    const passeD3 = [[6, 30], [7, 30]].map(([h, m]) => heureParis(date, h, m)).filter((x) => Math.floor(x / 60) === 8);
    assert.deepEqual(passeD3, [8 * 60 + 30], `D3 : un seul appel, à 8h30 Paris (${saison})`);
    const [a, mo, j] = date.split("-").map(Number);
    assert.equal(estEnSilence(parisVersUtcMs(a, mo, j, 8, 30), SILENCE_DEFAUT), false);
  }
  // F2 : créneau du mail inchangé (vendredi 17h UTC), 18h ou 19h Paris, avant 20h.
  const f2 = lire(".github/workflows/cron-encours-fournisseurs.yml");
  assert.match(f2, /cron: '0 17 \* \* 5'/);
  for (const vendredi of ["2026-07-17", "2026-11-06"]) {
    const [a, mo, j] = vendredi.split("-").map(Number);
    assert.equal(estEnSilence(Date.UTC(a, mo - 1, j, 17, 0), SILENCE_DEFAUT), false, `F2 hors silence (${vendredi})`);
  }
  // D4 : créneau du contrôle inchangé (tous les jours 21h30 UTC).
  assert.match(lire(".github/workflows/cron-journal-avancement.yml"), /cron: '30 21 \* \* \*'/);
});

test("16. dispatcher (nouveaux jobs, tous les anciens conservés), aucune fonction Vercel ajoutée, workflow de vérification, Journal des MAJ", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /require\("\.\/_cron\/cron-notifications-direction\.js"\)/);
  assert.match(disp, /nouveaux_chantiers:\s*\{\s*fenetre:\s*null/);
  assert.match(disp, /synthese_semaine:\s*\{\s*fenetre:\s*null/);
  assert.match(disp, /runJournalAvancement\(req, supabase, t\)/);
  for (const job of ["recap_commandes", "rappel_rapport", "invest_echeances", "invest_tableau_bord", "journal_avancement", "relances_cycle_vie",
    "push_reportes", "push_simulation", "factures_a_emettre", "push_materiaux", "point_conducteurs", "alertes_chantiers"]) {
    assert.match(disp, new RegExp(`${job}:\\s*\\{`), `job ${job} conservé`);
  }
  assert.match(lire(".github/workflows/verify-notifications-direction.yml"), /node scripts\/verif-notifications-direction\.mjs/);
  assert.match(lire("src/Renovation/journalMaj.js"), /Encours fournisseurs : X € HT à payer/);
  const dir = sansCommentaires(lire("src/Renovation/notificationsDirectionV1.mjs"));
  assert.ok(!/supabase\.from|Date\.now|new Date\(\)|fetch\(/.test(dir), "module pur");
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`ok   ${nom}`); }
  catch (e) { echecs++; console.error(`ÉCHEC ${nom}\n     ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications passées (données fictives).`);
if (echecs) process.exit(1);
