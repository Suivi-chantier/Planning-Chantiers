#!/usr/bin/env node
// Vérifie la liste « Commandes à passer » et la notification C3 qui la suit
// (projet docs/projets/notifications-push.md, tâche 10).
//
//   1. src/Renovation/commandesAPasserV1.mjs sur données fictives : à
//      commander, marqué commandé, déjà commandé, inconnu de la bibliothèque,
//      liste plate, bandeau ;
//   2. la page « Commandes à passer » importe le module et n'a plus sa copie ;
//   3. le job ?job=push_materiaux utilise le module (plus le calcul par phase) ;
//   4. le mail récap du vendredi garde son ancien calcul (materiauxACommanderV1) ;
//   5. anti-répétition (règle 2) : une commande n'est notifiée qu'une fois,
//      inscrite seulement après une écriture en boîte ; pas de premier passage
//      silencieux ; une lecture en échec est une erreur, pas une liste vide ;
//   6. garde-fous : module pur, façade, lien au format lienPage.
//
// Données fictives uniquement. Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-commandes-a-passer.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as C from "../src/Renovation/commandesAPasserV1.mjs";
import { lienPage } from "../supabase/functions/_partage/notificationsPushV1.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const MATERIAUX = [
  { id: "m1", nom: "Tube fictif", unite: "m", prix_unitaire: "10", fournisseur: "Fournisseur X", fournisseur_id: "f1" },
  { id: "m2", nom: "Raccord fictif", prix_unitaire: 2 },
  { id: "m3", nom: "Câble fictif", unite: "ml", prix_unitaire: 1 },
  { id: "m4", nom: "Plaque fictive", prix_unitaire: 5 },
];
const LOTS = [{ id: "plomb", label: "Plomberie", couleur: "#00f" }, { id: "elec", label: "Électricité", couleur: "#ff0" }];
const CHANTIERS = [{ id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#123456" }];
const PHASAGES = [
  { id: "p1", chantier_id: "ch-a", chantier_nom: "ancien nom", ouvrages: [
    { id: "o1", libelle: "Ouvrage plomberie fictif", lot_id: "plomb", cout_materiaux: 100,
      taches: [{ date_prevue: "2026-11-20" }, { date_prevue: "2026-11-12T08:00:00" }],
      materiaux_liens: [
        { materiau_id: "m1", quantite: 3 },                      // à commander
        { materiau_id: "m2" },                                   // ligne saisie → déjà commandé
        { materiau_id: "m3", commande_le: "2026-11-01" },        // marqué commandé
        { materiau_id: "m9" },                                   // inconnu de la bibliothèque
        { materiau_id: "m1", quantite: 1 },                      // même matériau deux fois → 2 lignes
      ] },
    { id: "o2", libelle: "Ouvrage élec fictif", libelle_perso: "Élec perso", lot_id: "elec", cout_materiaux: 50,
      taches: [], materiaux_liens: [{ materiau_id: "m4" }] },
    { id: "o3", libelle: "Ouvrage sans matériau", cout_materiaux: 0 },
  ] },
  { id: "p2", chantier_id: "ch-b", chantier_nom: "CHANTIER FICTIF B", ouvrages: [
    { id: "o4", libelle: "Ouvrage B", lot_id: "plomb", taches: [{ date_prevue: "2026-11-09" }], materiaux_liens: [{ materiau_id: "m4", quantite: 2 }] },
  ] },
  { id: "p3", chantier_id: "ch-c", chantier_nom: "C", ouvrages: [] },
];
const LIGNES_CMD = [{ id: "l1", ouvrage_id: "o1", materiau_id: "m2", chantier_id: "ch-a", nature: "materiaux", prix_total: 20, lot_id: "plomb" }];
const entrees = () => ({
  phasages: PHASAGES, chantiers: CHANTIERS,
  matById: C.indexMateriaux(MATERIAUX), lotById: C.indexLots(LOTS),
  lignesCmd: LIGNES_CMD, lots: LOTS, achatsParCh: {},
});

// ═══ 1. Le module ═══════════════════════════════════════════════════════════
test("1. modèle : à commander, marqué commandé, déjà commandé, inconnu écarté", () => {
  const m = C.modeleCommandesAPasser(entrees());
  assert.deepEqual(m.map((c) => c.chantierNom), ["CHANTIER FICTIF A", "CHANTIER FICTIF B"], "phasage sans ouvrage ignoré");
  const a = m[0];
  assert.equal(a.chantierCouleur, "#123456");
  assert.deepEqual(a.ouvrages.map((o) => o.libelle), ["Élec perso", "Ouvrage plomberie fictif"], "tri par lot puis libellé, libellé perso");
  const o1 = a.ouvrages[1];
  assert.deepEqual(o1.aCommander.map((x) => x.materiau_id), ["m1", "m1"]);
  assert.deepEqual(o1.marques.map((x) => x.materiau_id), ["m3"]);
  assert.equal(o1.lignesCmd.length, 1);
  assert.equal(o1.prevus.length, 4, "m9 inconnu de la bibliothèque : pas prévu");
  assert.equal(o1.dateISO, "2026-11-12", "date de besoin = la plus proche");
  assert.deepEqual(o1.aCommander[0], { materiau_id: "m1", libelle: "Tube fictif", quantite: 3, unite: "m", prix_ht: 10,
    fournisseur_id: "f1", fournisseur_nom: "Fournisseur X", commande_le: null });
  assert.equal(o1.aCommander[1].quantite, 1);
  assert.equal(a.ouvrages[0].aCommander[0].quantite, 1, "quantité absente → 1");
  assert.equal(a.ouvrages[0].aCommander[0].unite, "U");
  assert.equal(m[1].chantierNom, "CHANTIER FICTIF B", "chantier hors liste : nom du phasage");
  assert.equal(m[1].ouvrages[0].dateObj instanceof Date, true);
});

test("2. liste plate et bandeau", () => {
  const m = C.modeleCommandesAPasser(entrees());
  const l = C.lignesACommander(m);
  assert.deepEqual(l.map((x) => `${x.chantierNom}/${x.ouvrageLibelle}/${x.libelle}`), [
    "CHANTIER FICTIF A/Élec perso/Plaque fictive",
    "CHANTIER FICTIF A/Ouvrage plomberie fictif/Tube fictif",
    "CHANTIER FICTIF A/Ouvrage plomberie fictif/Tube fictif",
    "CHANTIER FICTIF B/Ouvrage B/Plaque fictive",
  ]);
  assert.equal(l[1].phasageId, "p1");
  assert.equal(l[1].ouvrageId, "o1");
  assert.equal(l[1].lotLabel, "Plomberie");
  const s = C.statsCommandesAPasser(m);
  assert.equal(s.nbChantiers, 2);
  assert.equal(s.nbACommander, 4);
  assert.deepEqual(C.modeleCommandesAPasser({}), [], "aucune donnée : liste vide, aucune erreur");
});

test("3. les lots ne changent pas QUELS articles sont à commander (job serveur sans lots)", () => {
  const avec = C.lignesACommander(C.modeleCommandesAPasser(entrees()));
  const sans = C.lignesACommander(C.modeleCommandesAPasser({ ...entrees(), lots: [], lotById: {} }));
  assert.deepEqual(new Set(C.clesCommandesAPasser(sans)), new Set(C.clesCommandesAPasser(avec)));
});

test("4. clés : une par ligne, occurrence numérotée pour un matériau lié deux fois", () => {
  const l = C.lignesACommander(C.modeleCommandesAPasser(entrees()));
  const cles = C.clesCommandesAPasser(l);
  assert.deepEqual(cles, ["p1|o2|m4", "p1|o1|m1", "p1|o1|m1#2", "p2|o4|m4"]);
  assert.equal(new Set(cles).size, l.length);
  const n = C.commandesNouvellementAPasser({ lignes: l, dejaNotifiees: ["p1|o1|m1", "p2|o4|m4"] });
  assert.deepEqual(n.map((x) => x.cleObjet), ["p1|o2|m4", "p1|o1|m1#2"]);
});

test("5. notification : une seule, « N commandes à passer », liste, lien, clé C3-<date>", () => {
  const l = C.commandesNouvellementAPasser({ lignes: C.lignesACommander(C.modeleCommandesAPasser(entrees())), dejaNotifiees: [] });
  const n = C.notificationCommandesAPasser({ nouvelles: l, dateIso: "2026-11-09" });
  assert.equal(n.type, "C3");
  assert.equal(n.titre, "4 commandes à passer");
  assert.equal(n.cle_regroupement, "C3-2026-11-09");
  assert.equal(n.lien, "/?page=planning-commandes");
  assert.equal(n.lien, lienPage("planning-commandes"));
  assert.equal(n.texte.split("\n")[0], "Élec perso / Plaque fictive · CHANTIER FICTIF A");
  assert.equal(n.texte.split("\n").length, 4);
  const un = C.notificationCommandesAPasser({ nouvelles: l.slice(0, 1), dateIso: "2026-11-09" });
  assert.equal(un.titre, "1 commande à passer");
  assert.equal(C.notificationCommandesAPasser({ nouvelles: [], dateIso: "2026-11-09" }), null);
  assert.equal(C.notificationCommandesAPasser({ nouvelles: undefined, dateIso: "2026-11-09" }), null);
});

test("6. notification : longue liste tronquée à 1 000 caractères, « … et N autres »", () => {
  const longue = Array.from({ length: 300 }, (_, i) => ({ ouvrageLibelle: "Ouvrage fictif au libellé très long ".repeat(4) + i, libelle: "Matériau " + i, chantierNom: "CH FICTIF" }));
  const n = C.notificationCommandesAPasser({ nouvelles: longue, dateIso: "2026-11-09" });
  assert.equal(n.titre, "300 commandes à passer");
  assert.ok(n.texte.length <= 1000, `texte ${n.texte.length} caractères`);
  const lignes = n.texte.split("\n");
  const montrees = lignes.length - 1;
  assert.equal(lignes.at(-1), `… et ${300 - montrees} autres`);
  assert.ok(lignes[0].includes("…"), "libellé d'ouvrage raccourci");
});

// ═══ 2-4. Qui utilise quoi ══════════════════════════════════════════════════
test("7. la page « Commandes à passer » importe le module et n'a plus sa copie", () => {
  const page = sansCommentaires(lire("src/Renovation/PagePlanningCommandes.jsx"));
  assert.match(page, /from "\.\/commandesAPasserV1\.js"/);
  assert.match(page, /modeleCommandesAPasser\(\{ phasages, chantiers, matById, lotById, lignesCmd, lots, achatsParCh \}\)/);
  assert.match(page, /lignesACommander\(modele\)/);
  assert.match(page, /statsCommandesAPasser\(modele\)/);
  assert.ok(!/etatMateriauxOuvrageV1\(|resteACommanderEnveloppes\(/.test(page), "plus de calcul en double dans la page");
  assert.match(lire("src/Renovation/commandesAPasserV1.js"), /export \* from "\.\/commandesAPasserV1\.mjs"/);
});

test("8. le job C3 utilise le module ; le récap du vendredi garde l'ancien calcul", () => {
  const job = sansCommentaires(lire("api/_cron/cron-push-materiaux.js"));
  assert.match(job, /import\("\.\.\/\.\.\/src\/Renovation\/commandesAPasserV1\.mjs"\)/);
  assert.ok(!/materiauxACommanderV1/.test(job));
  const recap = sansCommentaires(lire("api/_cron/cron-recap-commandes.js"));
  assert.match(recap, /materiauxACommanderV1\.mjs/);
  assert.ok(!/commandesAPasserV1/.test(recap), "le récap du vendredi n'est pas rebranché (règle 8)");
});

// ═══ 5. Job et anti-répétition (base et réseau simulés) ═════════════════════
// Jeu du job : copie du jeu fictif, matériaux à identifiants uuid (le job ne
// demande à la bibliothèque que des uuid).
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const PHASAGES_JOB = structuredClone(PHASAGES);
PHASAGES_JOB[0].ouvrages[0].materiaux_liens = [{ materiau_id: U(1), quantite: 3 }, { materiau_id: U(2) }];
PHASAGES_JOB[0].ouvrages[1].materiaux_liens = [{ materiau_id: U(4) }];
PHASAGES_JOB[1].ouvrages[0].materiaux_liens = [{ materiau_id: U(4), quantite: 2 }];
const LIGNES_JOB = structuredClone(LIGNES_CMD);
LIGNES_JOB[0].materiau_id = U(2);
function fausseBase({ panne = null } = {}) {
  const etat = [];
  const tables = {
    phasages: PHASAGES_JOB, commande_lignes: LIGNES_JOB,
    chantiers: [{ id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#123456" }],
    achats_lots_termines: [], materiaux_bibliotheque: [], notifications_etat: etat,
  };
  const base = {
    etat,
    from(table) {
      let lignes = (tables[table] || []).slice();
      let debut = 0, fin = Infinity;
      const q = {
        select: () => q, order: () => q,
        eq: (c, v) => { lignes = lignes.filter((l) => l[c] === v); return q; },
        in: (c, vs) => { lignes = lignes.filter((l) => vs.includes(String(l[c]))); return q; },
        range: (a, b) => { debut = a; fin = b; return q; },
        upsert: async (rows) => { rows.forEach((r) => { if (!etat.some((e) => e.type === r.type && e.cle_objet === r.cle_objet)) etat.push(r); }); return { error: null }; },
        then: (ok, ko) => Promise.resolve(table === panne
          ? { data: null, error: { message: "panne fictive" } }
          : { data: lignes.slice(debut, fin + 1), error: null }).then(ok, ko),
      };
      return q;
    },
  };
  return base;
}
const BIBLIO = [{ id: U(1), nom: "Tube fictif" }, { id: U(2), nom: "Raccord fictif" }, { id: U(4), nom: "Plaque fictive" }];
const baseJob = (opts) => {
  const b = fausseBase(opts);
  const from = b.from;
  b.from = (t) => (t === "materiaux_bibliotheque" && opts?.panne !== t
    ? (() => { const q = from(t); const tout = BIBLIO; let ids = null;
        q.in = (c, vs) => { ids = vs; return q; };
        q.then = (ok, ko) => Promise.resolve({ data: tout.filter((m) => !ids || ids.includes(m.id)), error: null }).then(ok, ko);
        return q; })()
    : from(t));
  return b;
};

let appels = [];
let ecritesEnBoite = 1;
globalThis.fetch = async (url, init) => {
  const corps = JSON.parse(init.body);
  appels.push({ url: String(url), corps });
  return { ok: true, status: 200, json: async () => ({ ok: true, ecrites_en_boite: corps.simulation ? 0 : ecritesEnBoite, envoyes: 0, echecs: 0 }) };
};
process.env.VITE_SUPABASE_URL = "https://exemple.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-fictive";
const { runPushMateriaux } = require("../api/_cron/cron-push-materiaux.js");
const t = (hour, dateIso = "2026-11-09") => ({ dateIso, hour, minute: 5 });
const REQ = (query = {}) => ({ query });

test("9. premier passage : UNE notification avec toutes les commandes (pas de passage silencieux)", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  const r = await runPushMateriaux(REQ(), b, t(8));
  assert.equal(appels.length, 1);
  const c = appels[0].corps;
  assert.equal(appels[0].url, "https://exemple.invalid/functions/v1/send-push");
  assert.equal(c.mode, "serveur");
  assert.equal(c.type, "C3");
  assert.equal(c.simulation, false);
  assert.equal(c.titre, "3 commandes à passer");
  assert.equal(c.cle_regroupement, "C3-2026-11-09");
  assert.equal(c.lien, "/?page=planning-commandes");
  assert.equal(r.commandes_a_passer, 3);
  assert.equal(r.inscrites, 3);
  assert.deepEqual(b.etat.map((e) => `${e.type}:${e.cle_objet}`).sort(),
    [`C3:p1|o1|${U(1)}`, `C3:p1|o2|${U(4)}`, `C3:p2|o4|${U(4)}`]);
});

test("10. passage suivant : une commande qui reste à passer ne renvoie rien ; une nouvelle, seule", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  await runPushMateriaux(REQ(), b, t(8));
  appels = [];
  const r2 = await runPushMateriaux(REQ(), b, t(8, "2026-11-10"));
  assert.equal(appels.length, 0, "état qui dure : aucun envoi");
  assert.equal(r2.nouvelles, 0);
  assert.equal(r2.deja_notifiees, 3);
  PHASAGES_JOB[1].ouvrages[0].materiaux_liens.push({ materiau_id: U(1) });
  try {
    const r3 = await runPushMateriaux(REQ(), b, t(8, "2026-11-11"));
    assert.equal(appels.length, 1);
    assert.equal(appels[0].corps.titre, "1 commande à passer");
    assert.equal(appels[0].corps.texte, "Ouvrage B / Tube fictif · CHANTIER FICTIF B");
    assert.equal(r3.inscrites, 1);
  } finally { PHASAGES_JOB[1].ouvrages[0].materiaux_liens.pop(); }
});

test("11. rien d'écrit en boîte (interrupteur coupé…) : rien d'inscrit, repris au passage suivant", async () => {
  appels = []; ecritesEnBoite = 0;
  const b = baseJob();
  const r = await runPushMateriaux(REQ(), b, t(8));
  assert.equal(appels.length, 1);
  assert.equal(r.inscrites, 0);
  assert.equal(b.etat.length, 0);
  ecritesEnBoite = 1;
  const r2 = await runPushMateriaux(REQ(), b, t(8, "2026-11-10"));
  assert.equal(r2.nouvelles, 3);
  assert.equal(r2.inscrites, 3);
});

test("12. simulation : send-push en simulation, aucune inscription ; avant 8h : rien", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  const r = await runPushMateriaux(REQ({ simulation: "1", date: "2026-11-13" }), b, t(3));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].corps.simulation, true);
  assert.equal(appels[0].corps.cle_regroupement, "C3-2026-11-13");
  assert.equal(b.etat.length, 0);
  assert.equal(r.detail.length, 3);
  appels = [];
  const r2 = await runPushMateriaux(REQ(), b, t(7));
  assert.equal(r2.skipped, "avant_8h");
  assert.equal(appels.length, 0);
  await assert.rejects(() => runPushMateriaux(REQ({ date: "2026-11-13" }), b, t(9)), /simulation/);
});

test("13. une lecture en échec est une erreur, jamais une liste vide", async () => {
  for (const panne of ["phasages", "commande_lignes", "chantiers", "achats_lots_termines", "materiaux_bibliotheque", "notifications_etat"]) {
    appels = [];
    await assert.rejects(() => runPushMateriaux(REQ(), baseJob({ panne }), t(9)), new RegExp(panne), panne);
    assert.equal(appels.length, 0, `${panne} : aucun envoi`);
  }
});

// ═══ 6. Garde-fous ══════════════════════════════════════════════════════════
test("14. module pur : ni Supabase, ni horloge, ni réseau", () => {
  const code = sansCommentaires(lire("src/Renovation/commandesAPasserV1.mjs"));
  assert.ok(!/supabase\.|createClient|Date\.now|new Date\(\s*\)|fetch\(|process\.env|require\(|window\.|localStorage/.test(code));
  const job = lire("api/_cron/cron-push-materiaux.js");
  assert.ok(!/VITE_SUPABASE_KEY/.test(job), "jamais la clé anon");
  assert.match(job, /\.from\(TABLE_ETAT\)\.upsert\(/);
  assert.match(lire(".github/workflows/cron-push-materiaux.yml"), /job=push_materiaux/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (données fictives)`);
process.exit(echecs ? 1 : 0);
