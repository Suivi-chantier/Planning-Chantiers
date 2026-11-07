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
//   5. choix des articles annoncés (commandesAPasserPushV1.mjs, réponse « a ») :
//      date de besoin entre J et J+6, sans date = jamais, chaque article une
//      seule fois ; arriéré (en retard) enregistré sans envoi au premier
//      passage (ligne « _reference »), même interrupteur coupé ; articles de
//      la fenêtre inscrits seulement après une écriture en boîte ; une lecture
//      ou une écriture d'état en échec est une erreur, rien n'est envoyé ;
//   6. garde-fous : module pur, façade, lien au format lienPage.
//
// Données fictives uniquement. Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-commandes-a-passer.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as C from "../src/Renovation/commandesAPasserV1.mjs";
import * as P from "../src/Renovation/commandesAPasserPushV1.mjs";
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
  assert.deepEqual(new Set(P.clesCommandesAPasser(sans)), new Set(P.clesCommandesAPasser(avec)));
});

test("4. clés : une par ligne, occurrence numérotée pour un matériau lié deux fois", () => {
  const l = C.lignesACommander(C.modeleCommandesAPasser(entrees()));
  const cles = P.clesCommandesAPasser(l);
  assert.deepEqual(cles, ["p1|o2|m4", "p1|o1|m1", "p1|o1|m1#2", "p2|o4|m4"]);
  assert.equal(new Set(cles).size, l.length);
});

test("5. fenêtre J..J+6 : en retard, dans la fenêtre, plus tard, sans date, déjà vu", () => {
  const L = (id, dateISO) => ({ phasageId: "p", ouvrageId: id, materiau_id: "m", dateISO, chantierNom: "CH FICTIF", ouvrageLibelle: "Ouvrage " + id, libelle: "Mat " + id });
  const lignes = [L("retard", "2026-11-06"), L("j6", "2026-11-15"), L("j", "2026-11-09"), L("j7", "2026-11-16"), L("sansdate", null), L("vu", "2026-11-10")];
  const plan = P.planC3({ lignes, dejaVues: ["p|vu|m"], dateIso: "2026-11-09" });
  assert.equal(plan.premierPassage, true, "pas de ligne de référence : premier passage");
  assert.equal(plan.debut, "2026-11-09");
  assert.equal(plan.fin, "2026-11-15");
  assert.deepEqual(plan.aNotifier.map((x) => x.ouvrageId), ["j", "j6"], "J et J+6 inclus, triés par date");
  assert.deepEqual(plan.enregistrerSansEnvoi.map((x) => x.cleObjet), ["p|retard|m"]);
  assert.equal(plan.plusTard, 1, "J+7 : plus tard");
  assert.equal(plan.sansDate, 1, "sans date de besoin : jamais annoncé");
  assert.equal(plan.dejaVues, 1);
  assert.equal(P.planC3({ lignes, dejaVues: [P.CLE_REFERENCE_C3], dateIso: "2026-11-09" }).premierPassage, false);
  assert.equal(P.ajouterJours("2026-12-28", 6), "2027-01-03", "changement d'année");
  assert.equal(P.ajouterJours("2027-03-26", 6), "2027-04-01", "changement d'heure sans effet");
  assert.throws(() => P.planC3({ lignes, dateIso: "" }), /AAAA-MM-JJ/);
});

test("6. notification : « N commandes à passer cette semaine », jj/mm · ouvrage / matériau · chantier, tronquée", () => {
  const L = (i, d) => ({ dateBesoin: d, ouvrageLibelle: "Ouvrage fictif", libelle: "Mat " + i, chantierNom: "CH FICTIF" });
  const n = P.notificationC3({ aNotifier: [L(1, "2026-11-09"), L(2, "2026-11-12")], dateIso: "2026-11-09" });
  assert.equal(n.type, "C3");
  assert.equal(n.titre, "2 commandes à passer cette semaine");
  assert.equal(n.texte, "09/11 · Ouvrage fictif / Mat 1 · CH FICTIF\n12/11 · Ouvrage fictif / Mat 2 · CH FICTIF");
  assert.equal(n.lien, "/?page=planning-commandes");
  assert.equal(n.lien, lienPage("planning-commandes"));
  assert.equal(n.cle_regroupement, "C3-2026-11-09");
  assert.equal(P.notificationC3({ aNotifier: [L(1, "2026-11-09")], dateIso: "2026-11-09" }).titre, "1 commande à passer cette semaine");
  assert.equal(P.notificationC3({ aNotifier: [], dateIso: "2026-11-09" }), null);
  assert.equal(P.notificationC3({ aNotifier: undefined, dateIso: "2026-11-09" }), null);
  const longue = Array.from({ length: 300 }, (_, i) => ({ dateBesoin: "2026-11-10", ouvrageLibelle: "Ouvrage fictif au libellé très long ".repeat(4) + i, libelle: "Matériau " + i, chantierNom: "CH FICTIF" }));
  const nl = P.notificationC3({ aNotifier: longue, dateIso: "2026-11-09" });
  assert.equal(nl.titre, "300 commandes à passer cette semaine");
  assert.ok(nl.texte.length <= 1000, `texte ${nl.texte.length} caractères`);
  const lignes = nl.texte.split("\n");
  assert.equal(lignes.at(-1), `… et ${300 - (lignes.length - 1)} autres`);
  assert.ok(lignes[0].startsWith("10/11 · ") && lignes[0].includes("…"), "date jj/mm et libellé raccourci");
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
// demande à la bibliothèque que des uuid). Jour simulé : lundi 09/11/2026,
// fenêtre du 09/11 au 15/11.
//   o1 (besoin 12/11) : U1 à commander (U2 déjà commandé)  → fenêtre
//   o2 (sans date)    : U4                                → jamais
//   o4 (besoin 09/11) : U4                                → fenêtre
//   o5 (besoin 02/11) : U1                                → en retard
//   o6 (besoin 01/12) : U4                                → plus tard
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const PHASAGES_JOB = structuredClone(PHASAGES);
PHASAGES_JOB[0].ouvrages[0].materiaux_liens = [{ materiau_id: U(1), quantite: 3 }, { materiau_id: U(2) }];
PHASAGES_JOB[0].ouvrages[1].materiaux_liens = [{ materiau_id: U(4) }];
PHASAGES_JOB[1].ouvrages[0].materiaux_liens = [{ materiau_id: U(4), quantite: 2 }];
PHASAGES_JOB[1].ouvrages.push(
  { id: "o5", libelle: "Ouvrage en retard", taches: [{ date_prevue: "2026-11-02" }], materiaux_liens: [{ materiau_id: U(1) }] },
  { id: "o6", libelle: "Ouvrage lointain", taches: [{ date_prevue: "2026-12-01" }], materiaux_liens: [{ materiau_id: U(4) }] },
);
const LIGNES_JOB = structuredClone(LIGNES_CMD);
LIGNES_JOB[0].materiau_id = U(2);
const BIBLIO = [{ id: U(1), nom: "Tube fictif" }, { id: U(2), nom: "Raccord fictif" }, { id: U(4), nom: "Plaque fictive" }];

function baseJob({ panne = null, panneEcriture = false } = {}) {
  const etat = [];
  const tables = {
    phasages: PHASAGES_JOB, commande_lignes: LIGNES_JOB,
    chantiers: [{ id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#123456" }],
    achats_lots_termines: [], materiaux_bibliotheque: BIBLIO, notifications_etat: etat,
  };
  return {
    etat,
    from(table) {
      let lignes = (tables[table] || []).slice();
      let debut = 0, fin = Infinity;
      const q = {
        select: () => q, order: () => q,
        eq: (c, v) => { lignes = lignes.filter((l) => l[c] === v); return q; },
        in: (c, vs) => { lignes = lignes.filter((l) => vs.includes(String(l[c]))); return q; },
        range: (a, b) => { debut = a; fin = b; return q; },
        upsert: async (rows) => {
          if (panneEcriture) return { error: { message: "écriture impossible (fictif)" } };
          rows.forEach((r) => { if (!etat.some((e) => e.type === r.type && e.cle_objet === r.cle_objet)) etat.push(r); });
          return { error: null };
        },
        then: (ok, ko) => Promise.resolve(table === panne
          ? { data: null, error: { message: "panne fictive" } }
          : { data: lignes.slice(debut, fin + 1), error: null }).then(ok, ko),
      };
      return q;
    },
  };
}
const etats = (b) => b.etat.map((e) => `${e.etat}:${e.cle_objet}`).sort();

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

test("9. premier passage : arriéré enregistré sans envoi, UNE notification pour la fenêtre", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  const r = await runPushMateriaux(REQ(), b, t(8));
  assert.equal(appels.length, 1);
  const c = appels[0].corps;
  assert.equal(appels[0].url, "https://exemple.invalid/functions/v1/send-push");
  assert.equal(c.mode, "serveur");
  assert.equal(c.type, "C3");
  assert.equal(c.simulation, false);
  assert.equal(c.titre, "2 commandes à passer cette semaine");
  assert.equal(c.texte, "09/11 · Ouvrage B / Plaque fictive · CHANTIER FICTIF B\n12/11 · Ouvrage plomberie fictif / Tube fictif · CHANTIER FICTIF A");
  assert.equal(c.cle_regroupement, "C3-2026-11-09");
  assert.equal(c.lien, "/?page=planning-commandes");
  assert.equal(r.premier_passage, true);
  assert.equal(r.retard_enregistre_sans_envoi, 1);
  assert.equal(r.sans_date_de_besoin, 1);
  assert.equal(r.plus_tard, 1);
  assert.equal(r.inscrites, 2);
  assert.deepEqual(etats(b), [
    `notifiee:p1|o1|${U(1)}`, `notifiee:p2|o4|${U(4)}`,
    "reference:_reference", `vu_sans_envoi:p2|o5|${U(1)}`,
  ]);
});

test("10. jours suivants : rien qui dure ; retard arrivé sans annonce = enregistré ; entrée dans la fenêtre = annoncé", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  await runPushMateriaux(REQ(), b, t(8));
  appels = [];
  const r2 = await runPushMateriaux(REQ(), b, t(8, "2026-11-10"));
  assert.equal(appels.length, 0, "état qui dure : aucun envoi");
  assert.equal(r2.premier_passage, false);
  assert.equal(r2.a_annoncer, 0);
  // Article ajouté déjà en retard : enregistré sans envoi.
  PHASAGES_JOB[1].ouvrages[1].materiaux_liens.push({ materiau_id: U(4) });
  try {
    const r3 = await runPushMateriaux(REQ(), b, t(8, "2026-11-11"));
    assert.equal(appels.length, 0);
    assert.equal(r3.retard_enregistre_sans_envoi, 1);
    assert.ok(etats(b).includes(`vu_sans_envoi:p2|o5|${U(4)}`));
  } finally { PHASAGES_JOB[1].ouvrages[1].materiaux_liens.pop(); }
  // 25/11 : o6 (besoin 01/12) entre dans la fenêtre 25/11 → 01/12.
  const r4 = await runPushMateriaux(REQ(), b, t(8, "2026-11-25"));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].corps.titre, "1 commande à passer cette semaine");
  assert.equal(appels[0].corps.texte, "01/12 · Ouvrage lointain / Plaque fictive · CHANTIER FICTIF B");
  assert.equal(r4.inscrites, 1);
  appels = [];
  await runPushMateriaux(REQ(), b, t(8, "2026-11-26"));
  assert.equal(appels.length, 0, "annoncé une seule fois");
});

test("11. interrupteur coupé au premier passage : arriéré enregistré quand même, fenêtre NON inscrite", async () => {
  appels = []; ecritesEnBoite = 0;
  const b = baseJob();
  const r = await runPushMateriaux(REQ(), b, t(8));
  assert.equal(appels.length, 1);
  assert.equal(r.inscrites, 0);
  assert.deepEqual(etats(b), ["reference:_reference", `vu_sans_envoi:p2|o5|${U(1)}`]);
  // Le lendemain, interrupteur activé : o4 (09/11) est passé en retard sans
  // annonce → enregistré sans envoi ; o1 (12/11) part.
  appels = []; ecritesEnBoite = 1;
  const r2 = await runPushMateriaux(REQ(), b, t(8, "2026-11-10"));
  assert.equal(r2.premier_passage, false);
  assert.equal(r2.retard_enregistre_sans_envoi, 1);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].corps.titre, "1 commande à passer cette semaine");
  assert.ok(etats(b).includes(`vu_sans_envoi:p2|o4|${U(4)}`));
  assert.ok(etats(b).includes(`notifiee:p1|o1|${U(1)}`));
});

test("12. simulation : aucune écriture, même au premier passage ; avant 8h : rien", async () => {
  appels = []; ecritesEnBoite = 1;
  const b = baseJob();
  const r = await runPushMateriaux(REQ({ simulation: "1", date: "2026-11-12" }), b, t(3));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].corps.simulation, true);
  assert.equal(appels[0].corps.cle_regroupement, "C3-2026-11-12");
  assert.equal(b.etat.length, 0);
  assert.equal(r.fenetre.du, "2026-11-12");
  assert.equal(r.fenetre.au, "2026-11-18");
  assert.deepEqual(r.detail.map((d) => d.date_besoin), ["2026-11-12"], "12/11 → 18/11 : o1 seul (o4 est en retard)");
  appels = [];
  const r2 = await runPushMateriaux(REQ(), b, t(7));
  assert.equal(r2.skipped, "avant_8h");
  assert.equal(appels.length, 0);
  await assert.rejects(() => runPushMateriaux(REQ({ date: "2026-11-13" }), b, t(9)), /simulation/);
});

test("13. une lecture ou une écriture d'état en échec : erreur, rien n'est envoyé", async () => {
  for (const panne of ["phasages", "commande_lignes", "chantiers", "achats_lots_termines", "materiaux_bibliotheque", "notifications_etat"]) {
    appels = [];
    await assert.rejects(() => runPushMateriaux(REQ(), baseJob({ panne }), t(9)), new RegExp(panne), panne);
    assert.equal(appels.length, 0, `${panne} : aucun envoi`);
  }
  appels = [];
  await assert.rejects(() => runPushMateriaux(REQ(), baseJob({ panneEcriture: true }), t(9)), /arriéré non enregistré/);
  assert.equal(appels.length, 0, "arriéré non enregistré : aucun envoi");
});

// ═══ 6. Garde-fous ══════════════════════════════════════════════════════════
test("14. modules purs : ni Supabase, ni horloge, ni réseau ; façades", () => {
  for (const f of ["src/Renovation/commandesAPasserV1.mjs", "src/Renovation/commandesAPasserPushV1.mjs"]) {
    const code = sansCommentaires(lire(f));
    assert.ok(!/supabase\.|createClient|Date\.now|new Date\(\s*\)|fetch\(|process\.env|require\(|window\.|localStorage/.test(code), f);
  }
  assert.match(lire("src/Renovation/commandesAPasserPushV1.js"), /export \* from "\.\/commandesAPasserPushV1\.mjs"/);
  const job = lire("api/_cron/cron-push-materiaux.js");
  assert.match(job, /commandesAPasserPushV1\.mjs/);
  assert.ok(!/VITE_SUPABASE_KEY/.test(job), "jamais la clé anon");
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
