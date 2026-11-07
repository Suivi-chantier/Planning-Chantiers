#!/usr/bin/env node
// Vérifie le calcul « matériaux prévisionnels à commander » (date butoir
// atteinte) et la notification C3 (projet docs/projets/notifications-push.md,
// tâche 5).
//
//   1. src/Renovation/materiauxACommanderV1.mjs — exécuté sur des données
//      fictives, comparé à une copie de l'ANCIEN calcul du récap commandes
//      (tel qu'il était dans api/_cron/cron-recap-commandes.js avant
//      l'extraction) : même résultat attendu, cas par cas ;
//   2. le récap du vendredi importe bien le module et n'a plus sa propre copie
//      du calcul ; exécuté avec une base et un envoi de mail simulés ;
//   3. le job ?job=push_materiaux ne passe plus par ce module (tâche 10 : il
//      suit la page « Commandes à passer », voir verif-commandes-a-passer.mjs) ;
//   4. garde-fous : dispatcher, créneaux été / hiver, aucune fonction Vercel
//      ajoutée, module pur (ni Supabase, ni horloge).
//
// Données fictives uniquement. Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-materiaux-a-commander.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as M from "../src/Renovation/materiauxACommanderV1.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Copie de l'ANCIEN calcul (cron-recap-commandes.js avant la tâche 5) ──────
// Sert d'oracle : le module doit rendre exactement la même chose.
function ancienCalcul({ phasages, cfg, dateIso }) {
  const chantiers   = Array.isArray(cfg.chantiers) ? cfg.chantiers : [];
  const phasesArr   = (cfg.phases_travaux && Array.isArray(cfg.phases_travaux.items))
                        ? cfg.phases_travaux.items : [];
  const phasesById  = phasesArr.reduce((acc, ph) => { acc[ph.id] = ph; return acc; }, {});
  const chantById   = chantiers.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
  const commandesPrevues = [];
  for (const p of phasages) {
    const plan = p.plan_travaux || {};
    for (const key of Object.keys(plan)) {
      if (!key.endsWith("__materiaux_prevus")) continue;
      const mats = plan[key];
      if (!Array.isArray(mats) || mats.length === 0) continue;
      const phaseId  = key.slice(0, -"__materiaux_prevus".length);
      const dateCmd  = plan[phaseId + "__date_commande"];
      if (!dateCmd || dateCmd !== dateIso) continue;
      const dejaCommande = (parseFloat(plan[phaseId + "__cout_commandes"]) || 0) > 0;
      if (dejaCommande) continue;
      const phaseInfo = phasesById[phaseId] || { label: phaseId, emoji: "", couleur: "#888" };
      const chantInfo = chantById[p.chantier_id] || null;
      const materiauxFmt = mats.map(m => ({
        libelle: m.libelle || "", quantite: m.quantite || 0, unite: m.unite || "",
        prix_ht: parseFloat(m.prix_ht) || 0, fournisseur_nom: m.fournisseur_nom || "",
        total: (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0),
      }));
      const totalHt = materiauxFmt.reduce((s, m) => s + m.total, 0);
      commandesPrevues.push({
        phasageId: p.id, chantierId: p.chantier_id,
        chantierNom: chantInfo?.nom || p.chantier_nom || "(sans chantier)",
        chantierCouleur: chantInfo?.couleur || phaseInfo.couleur,
        phaseId, phaseLabel: phaseInfo.label || phaseId, phaseEmoji: phaseInfo.emoji || "",
        materiaux: materiauxFmt, totalHt,
      });
    }
  }
  return commandesPrevues;
}

const nouveau = ({ phasages, cfg, dateIso }) => M.materiauxACommander({
  phasages,
  chantiers: Array.isArray(cfg.chantiers) ? cfg.chantiers : [],
  phases: (cfg.phases_travaux && Array.isArray(cfg.phases_travaux.items)) ? cfg.phases_travaux.items : [],
  dateIso,
});

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const CFG = {
  chantiers: [
    { id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#123456" },
    { id: "ch-b", nom: "CHANTIER FICTIF B" },
  ],
  phases_travaux: { items: [
    { id: "plomberie", label: "Plomberie", emoji: "🔧", couleur: "#0000ff" },
    { id: "elec", label: "Électricité", emoji: "", couleur: "#ffaa00" },
  ] },
};
const JOUR = "2026-11-06";
const PHASAGES = [
  { id: "p1", chantier_id: "ch-a", chantier_nom: "ancien nom A", plan_travaux: {
    plomberie__materiaux_prevus: [
      { libelle: "Tube cuivre", quantite: 3, unite: "m", prix_ht: "12.5", fournisseur_nom: "Fournisseur X" },
      { libelle: "Raccord", quantite: "4", prix_ht: 2 },
    ],
    plomberie__date_commande: JOUR,
    elec__materiaux_prevus: [{ libelle: "Câble", quantite: 10, prix_ht: 1 }],
    elec__date_commande: JOUR,
    elec__cout_commandes: "45",                 // déjà commandée → écartée
  } },
  { id: "p2", chantier_id: "ch-b", chantier_nom: "B", plan_travaux: {
    elec__materiaux_prevus: [{ libelle: "Prise", quantite: 2, prix_ht: "abc" }],
    elec__date_commande: JOUR,
    inconnue__materiaux_prevus: [{ libelle: "Divers" }],   // phase hors référentiel
    inconnue__date_commande: JOUR,
    cuisine__materiaux_prevus: [],                          // vide → écartée
    cuisine__date_commande: JOUR,
  } },
  { id: "p3", chantier_id: "ch-inconnu", chantier_nom: null, plan_travaux: {
    plomberie__materiaux_prevus: [{ libelle: "Siphon", quantite: 1, prix_ht: 8 }],
    plomberie__date_commande: "2026-11-13",                 // autre jour
  } },
  { id: "p4", chantier_id: "ch-inconnu", chantier_nom: null, plan_travaux: {
    plomberie__materiaux_prevus: [{ libelle: "Joint", quantite: 1, prix_ht: 1 }],
    plomberie__date_commande: JOUR,                         // chantier hors config
  } },
  { id: "p5", chantier_id: "ch-a", plan_travaux: null },
  { id: "p6", chantier_id: "ch-a", plan_travaux: { plomberie__materiaux_prevus: "pas un tableau", plomberie__date_commande: JOUR } },
];

// ═══ 1. Le module rend exactement ce que rendait l'ancien calcul ═══════════
test("1. jeu fictif : même liste que l'ancien calcul du récap, au jour près", () => {
  for (const dateIso of [JOUR, "2026-11-13", "2026-11-20", ""]) {
    assert.deepEqual(nouveau({ phasages: PHASAGES, cfg: CFG, dateIso }), ancienCalcul({ phasages: PHASAGES, cfg: CFG, dateIso }), dateIso);
  }
});

test("2. règle inchangée : date butoir exacte, déjà commandé écarté, liste vide écartée", () => {
  const r = nouveau({ phasages: PHASAGES, cfg: CFG, dateIso: JOUR });
  assert.deepEqual(r.map((p) => `${p.phasageId}/${p.phaseId}`), ["p1/plomberie", "p2/elec", "p2/inconnue", "p4/plomberie"]);
  const plomb = r[0];
  assert.equal(plomb.chantierNom, "CHANTIER FICTIF A");
  assert.equal(plomb.chantierCouleur, "#123456");
  assert.equal(plomb.phaseLabel, "Plomberie");
  assert.equal(plomb.totalHt, 3 * 12.5 + 4 * 2);
  assert.equal(r[1].chantierCouleur, "#ffaa00", "couleur de phase si le chantier n'en a pas");
  assert.equal(r[1].totalHt, 0, "prix illisible = 0");
  assert.equal(r[2].phaseLabel, "inconnue");
  assert.equal(r[3].chantierNom, "(sans chantier)");
  assert.deepEqual(nouveau({ phasages: PHASAGES, cfg: CFG, dateIso: "2026-11-13" }).map((p) => p.phasageId), ["p3"]);
});

test("3. données absentes : aucune erreur, liste vide", () => {
  assert.deepEqual(M.materiauxACommander({ phasages: [], chantiers: [], phases: [], dateIso: JOUR }), []);
  assert.deepEqual(M.materiauxACommander({ phasages: undefined, chantiers: null, phases: null, dateIso: JOUR }), []);
  assert.deepEqual(nouveau({ phasages: PHASAGES, cfg: {}, dateIso: JOUR }), ancienCalcul({ phasages: PHASAGES, cfg: {}, dateIso: JOUR }));
});

// ═══ 2. Notification C3 ═════════════════════════════════════════════════════
test("4. notification : une seule, regroupée, titre au pluriel, lien interne, clé C3-<date>", () => {
  const liste = nouveau({ phasages: PHASAGES, cfg: CFG, dateIso: JOUR });
  const n = M.notificationMateriauxACommander({ commandesPrevues: liste, dateIso: JOUR });
  assert.equal(n.type, "C3");
  assert.equal(n.titre, "5 matériaux à commander aujourd'hui");
  assert.equal(n.cle_regroupement, "C3-2026-11-06");
  assert.equal(n.lien, "/#planning-commandes");
  assert.match(n.lien, /^\/(?!\/)[^\s]*$/, "lien interne accepté par send-push");
  assert.match(n.texte, /CHANTIER FICTIF A, CHANTIER FICTIF B, \(sans chantier\)/);
  assert.match(n.texte, /46,50 € HT/);
  assert.ok(n.titre.length <= 120 && n.texte.length <= 1000);
});

test("5. notification : singulier, et liste vide = aucune notification", () => {
  const un = M.notificationMateriauxACommander({
    commandesPrevues: [{ chantierNom: "X", materiaux: [{}], totalHt: 1234.5 }], dateIso: JOUR });
  assert.equal(un.titre, "1 matériau à commander aujourd'hui");
  assert.match(un.texte, /^Chantier : X\. Total prévu : 1 234,50 € HT\./);
  assert.equal(M.notificationMateriauxACommander({ commandesPrevues: [], dateIso: JOUR }), null);
  assert.equal(M.notificationMateriauxACommander({ commandesPrevues: undefined, dateIso: JOUR }), null);
});

test("6. notification : au-delà de 3 chantiers, « et N autres »", () => {
  const liste = ["A", "B", "C", "D", "E"].map((c) => ({ chantierNom: c, materiaux: [{}], totalHt: 0 }));
  const n = M.notificationMateriauxACommander({ commandesPrevues: liste, dateIso: JOUR });
  assert.match(n.texte, /^Chantiers : A, B, C et 2 autres\./);
});

// ═══ Base et réseau simulés (pour exécuter les vrais handlers) ═════════════
function fausseBase(tables) {
  const ecrits = [];
  const from = (table) => {
    let lignes = (tables[table] || []).slice();
    const q = {
      select: () => q,
      eq: (col, val) => { lignes = lignes.filter((l) => l[col] === val); return q; },
      in: (col, vals) => { lignes = lignes.filter((l) => vals.includes(l[col])); return q; },
      maybeSingle: async () => ({ data: lignes[0] || null, error: null }),
      upsert: async (ligne) => { ecrits.push({ table, ligne }); return { error: null }; },
      then: (ok, ko) => Promise.resolve({ data: lignes, error: null }).then(ok, ko),
    };
    return q;
  };
  return { from, ecrits };
}
const BASE = () => fausseBase({
  phasages: PHASAGES,
  planning_config: [{ key: "chantiers", value: CFG.chantiers }, { key: "phases_travaux", value: CFG.phases_travaux }],
  besoins: [],
  utilisateurs: [{ id: "u1", email: "fictif@example.test", nom: "Fictif", role: "conducteur", actif: true }],
});
let appels = [];
globalThis.fetch = async (url, init) => {
  appels.push({ url: String(url), corps: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, simulation: !!JSON.parse(init.body).simulation }) };
};
process.env.CRON_SECRET = "secret-fictif";
process.env.VITE_SUPABASE_URL = "https://exemple.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-fictive";
const t = (hour, dateIso = JOUR) => ({ weekday: "Vendredi", dateFr: dateIso.split("-").reverse().join("/"), dateIso, hour, minute: 5 });
const REQ = (query = {}) => ({ query, headers: { host: "exemple.invalid", "x-forwarded-proto": "https" } });

// ═══ 3. Le récap du vendredi passe par le module ═══════════════════════════
test("7. récap : importe le module, n'a plus sa propre copie du calcul", () => {
  const code = sansCommentaires(lire("api/_cron/cron-recap-commandes.js"));
  assert.match(code, /import\("\.\.\/\.\.\/src\/Renovation\/materiauxACommanderV1\.mjs"\)/);
  assert.match(code, /materiauxACommander\(\{\s*phasages, chantiers, phases: phasesArr, dateIso: t\.dateIso,?\s*\}\)/);
  assert.ok(!/__materiaux_prevus|__date_commande|__cout_commandes/.test(code), "plus de calcul en double dans le récap");
  // Le mail lui-même n'a pas bougé.
  assert.match(code, /function buildRecapHtml\(/);
  assert.match(code, /Récap commandes du \$\{t\.dateFr\}/);
});

test("8. récap exécuté (base et mail simulés) : le mail contient la liste du module", async () => {
  appels = [];
  const { runRecapCommandes } = require("../api/_cron/cron-recap-commandes.js");
  const base = BASE();
  const r = await runRecapCommandes(REQ(), base, t(7));
  assert.equal(r.sent, true);
  assert.equal(r.commandes_prevues, 4);
  assert.equal(appels.length, 1);
  assert.match(appels[0].url, /\/api\/send-email$/);
  const html = appels[0].corps.html;
  for (const lib of ["Tube cuivre", "Raccord", "Prise", "Divers", "Joint"]) assert.ok(html.includes(lib), lib);
  assert.ok(!html.includes("Câble"), "phase déjà commandée absente");
  assert.ok(!html.includes("Siphon"), "autre jour absent");
});

// ═══ 4. Job ?job=push_materiaux ═════════════════════════════════════════════
// Tâche 10 : la notification C3 suit désormais la page « Commandes à passer »
// (commandesAPasserV1.mjs, vérifiée par scripts/verif-commandes-a-passer.mjs).
// Ce module ne sert plus qu'au récap du vendredi, qui garde son calcul (règle 8).
test("9. job C3 : n'utilise plus ce module, le récap du vendredi si", () => {
  const job = sansCommentaires(lire("api/_cron/cron-push-materiaux.js"));
  assert.ok(!/materiauxACommanderV1/.test(job), "le job C3 ne lit plus le calcul par phase");
  assert.match(job, /commandesAPasserV1\.mjs/);
  assert.match(sansCommentaires(lire("api/_cron/cron-recap-commandes.js")), /materiauxACommanderV1\.mjs/);
});

// ═══ 5. Garde-fous ══════════════════════════════════════════════════════════
test("14. module pur : ni Supabase, ni horloge, ni réseau ; façade front", () => {
  const code = sansCommentaires(lire("src/Renovation/materiauxACommanderV1.mjs"));
  assert.ok(!/supabase|Date\.now|new Date|fetch\(|process\.env|require\(/i.test(code));
  assert.match(lire("src/Renovation/materiauxACommanderV1.js"), /export \* from "\.\/materiauxACommanderV1\.mjs"/);
});

test("15. dispatcher et créneaux : ?job=push_materiaux, 8h05 Paris été / hiver, jours ouvrés", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /push_materiaux: \{\s*fenetre: null,/);
  assert.match(disp, /require\("\.\/_cron\/cron-push-materiaux\.js"\)/);
  for (const job of ["recap_commandes", "push_reportes", "push_simulation"]) assert.match(disp, new RegExp(`${job}: \\{`));
  const wf = lire(".github/workflows/cron-push-materiaux.yml");
  assert.match(wf, /cron: '5 6 \* \* 1-5'/);
  assert.match(wf, /cron: '5 7 \* \* 1-5'/);
  assert.match(wf, /job=push_materiaux/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /simulation=1/);
  const job = lire("api/_cron/cron-push-materiaux.js");
  assert.ok(!/VITE_SUPABASE_KEY/.test(job), "jamais la clé anon");
  const fonctions = readdirSync(chemin("api")).filter((f) => !f.startsWith("_"));
  assert.ok(fonctions.length <= 12, `${fonctions.length} fonctions Vercel`);
  assert.ok(!fonctions.some((f) => /push|notif|materiau/i.test(f)), "aucune fonction Vercel ajoutée");
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
