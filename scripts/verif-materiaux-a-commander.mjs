#!/usr/bin/env node
// Vérifie le calcul « matériaux prévisionnels à commander » (date butoir
// atteinte) et la notification C3 (projet docs/projets/notifications-push.md,
// tâche 5).
//
//   1. src/Renovation/materiauxACommanderV1.mjs — exécuté sur des données
//      fictives, comparé à une copie de l'ANCIEN calcul du récap commandes
//      (tel qu'il était dans api/_cron/cron-recap-commandes.js avant
//      l'extraction) : même résultat attendu, cas par cas ;
//   2. le récap du vendredi : depuis la tâche 15 du projet
//      docs/projets/organisation-par-jour.md (décision de Loris, « corrige
//      aussi le mail »), sa partie matériaux suit l'onglet « Semaine
//      prochaine » de la page « Commandes à passer » (lectures partagées
//      commandesAPasserLecture.mjs, commandesAPasserV1, commandesParSemaineV1)
//      et n'utilise plus ce module (sans données : 0 phasage sur 49) ;
//      exécuté avec une base et un envoi de mail simulés (liste, aucun
//      article, lecture en échec). Les anciens contrôles « le récap importe
//      ce module » sont REMPLACÉS par les mêmes contrôles sur le nouveau
//      branchement ;
//   3. le job ?job=push_materiaux ne passe plus par ce module (tâche 10 : il
//      suit la page « Commandes à passer », voir verif-commandes-a-passer.mjs).
//      Ce module n'a donc plus aucun utilisateur (conservé, non modifié) ;
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
// Lit .select / .eq / .in / .order / .range (tranches) / .maybeSingle comme
// supabase-js ; `erreurs` : { table: message } pour simuler une lecture en échec.
function fausseBase(tables, erreurs = {}) {
  const ecrits = [];
  const from = (table) => {
    let lignes = (tables[table] || []).slice();
    let plage = null;
    const q = {
      select: () => q,
      eq: (col, val) => { lignes = lignes.filter((l) => l[col] === val); return q; },
      in: (col, vals) => { lignes = lignes.filter((l) => vals.includes(l[col])); return q; },
      order: () => q,
      range: (a, b) => { plage = [a, b]; return q; },
      maybeSingle: async () => ({ data: lignes[0] || null, error: null }),
      upsert: async (ligne) => { ecrits.push({ table, ligne }); return { error: null }; },
      then: (ok, ko) => Promise.resolve(erreurs[table]
        ? { data: null, error: { message: erreurs[table] } }
        : { data: plage ? lignes.slice(plage[0], plage[1] + 1) : lignes, error: null }).then(ok, ko),
    };
    return q;
  };
  return { from, ecrits };
}
// Jeu fictif « par ouvrage » (données inventées), vendredi 06/11/2026 :
// semaine suivante S46 = du 09/11 au 15/11.
//   o1 (besoin 10/11, CHANTIER FICTIF A) : Tube cuivre, Raccord   → dans le mail
//   o2 (besoin 20/11, A)                 : Siphon                 → semaine d'après : absent
//   o3 (besoin 12/11, CHANTIER FICTIF B) : Câble marqué commandé  → absent ; Prise → dans le mail
const TABLES_OUVRAGES = () => ({
  chantiers: [
    { id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#123456", statut: "en_cours", ordre: 0, donnees: {}, archive_le: null },
    { id: "ch-b", nom: "CHANTIER FICTIF B", couleur: "#654321", statut: null, ordre: 1, donnees: {}, archive_le: null },
  ],
  phasages: [
    { id: "p1", chantier_id: "ch-a", chantier_nom: "A", ouvrages: [
      { id: "o1", libelle: "Ouvrage fictif 1", lot_id: "plomberie", taches: [{ date_prevue: "2026-11-10", avancement: 0 }, { date_prevue: "2026-11-13", avancement: 0 }],
        materiaux_liens: [{ materiau_id: "m1", quantite: 3 }, { materiau_id: "m2" }] },
      { id: "o2", libelle: "Ouvrage fictif 2", lot_id: "plomberie", taches: [{ date_prevue: "2026-11-20", avancement: 0 }], materiaux_liens: [{ materiau_id: "m3" }] },
    ] },
    { id: "p2", chantier_id: "ch-b", chantier_nom: "B", ouvrages: [
      { id: "o3", libelle: "Ouvrage fictif 3", lot_id: "electricite", taches: [{ date_prevue: "2026-11-12", avancement: 0 }],
        materiaux_liens: [{ materiau_id: "m5", commande_le: "2026-11-01" }, { materiau_id: "m4", quantite: 2 }] },
    ] },
  ],
  materiaux_bibliotheque: [
    { id: "m1", nom: "Tube cuivre", unite: "m", prix_unitaire: 12.5 }, { id: "m2", nom: "Raccord", unite: "U", prix_unitaire: 2 },
    { id: "m3", nom: "Siphon", unite: "U", prix_unitaire: 8 }, { id: "m4", nom: "Prise", unite: "U", prix_unitaire: 3 },
    { id: "m5", nom: "Câble", unite: "m", prix_unitaire: 1 },
  ],
  commande_lignes: [], achats_lots_termines: [],
  planning_config: [{ key: "chantiers", value: [{ id: "ch-a", nom: "CHANTIER FICTIF A" }] }],
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

// ═══ 3. Le récap du vendredi suit la page « Commandes à passer » (tâche 15) ═
// Remplace l'ancien contrôle « le récap importe materiauxACommanderV1 » : même
// vérification (import du calcul partagé, pas de copie locale, mail inchangé
// ailleurs) sur le nouveau branchement.
test("7. récap : lectures de la page + commandesAPasserV1 + onglet « Semaine prochaine », plus l'ancien calcul", () => {
  const code = sansCommentaires(lire("api/_cron/cron-recap-commandes.js"));
  assert.match(code, /import\("\.\.\/\.\.\/src\/Renovation\/commandesAPasserLecture\.mjs"\)/);
  assert.match(code, /import\("\.\.\/\.\.\/src\/Renovation\/commandesAPasserV1\.mjs"\)/);
  assert.match(code, /import\("\.\.\/\.\.\/src\/Renovation\/commandesParSemaineV1\.mjs"\)/);
  assert.match(code, /L\.lireDonneesCommandesAPasser\(supabase\), L\.lireChantiersCommandesAvec\(supabase\)/);
  assert.match(code, /W\.partieMailMateriauxACommanderV1\(\{ dateIso, erreur, lignes \}\)/);
  assert.match(code, /partieMateriauxSemaineProchaine\(supabase, t\.dateIso\)/, "date du jour à Paris passée explicitement");
  assert.ok(!/materiauxACommanderV1|materiauxACommander\(/.test(code), "plus l'ancien calcul sans données");
  assert.ok(!/__materiaux_prevus|__date_commande|__cout_commandes|plan_travaux/.test(code), "plus de calcul en double dans le récap");
  assert.ok(!/new Date\(\)/.test(code.slice(code.indexOf("async function partieMateriauxSemaineProchaine"))), "aucune horloge dans le calcul de la partie");
  // Le reste du mail n'a pas bougé : sujet, demandes ouvriers, destinataires.
  assert.match(code, /function buildRecapHtml\(/);
  assert.match(code, /Récap commandes du \$\{t\.dateFr\}/);
  assert.match(code, /Demandes des ouvriers en attente/);
  assert.match(code, /\.in\("role", \["admin", "conducteur"\]\)/);
  assert.ok(!/Aucun matériau prévisionnel à commander aujourd'hui/.test(code), "plus l'ancien message toujours affiché");
});

test("8. récap exécuté (base et mail simulés) : le mail liste l'onglet « Semaine prochaine », rien d'autre", async () => {
  appels = [];
  const { runRecapCommandes } = require("../api/_cron/cron-recap-commandes.js");
  const r = await runRecapCommandes(REQ(), fausseBase(TABLES_OUVRAGES()), t(7));
  assert.equal(r.sent, true);
  assert.equal(r.materiaux_semaine_prochaine, 3);
  assert.equal(r.materiaux_etat, "liste");
  assert.equal(appels.length, 1);
  assert.match(appels[0].url, /\/api\/send-email$/);
  assert.equal(appels[0].corps.subject, "🛒 Profero Planning · Récap commandes du 06/11/2026");
  const html = appels[0].corps.html;
  assert.ok(html.includes("Matériaux à commander · semaine prochaine (S46, du 09/11 au 15/11)"), "titre explicite");
  assert.ok(html.includes("3 articles à commander · 2 chantiers"), "total");
  assert.ok(html.includes("3 articles à commander la semaine prochaine"), "en-tête");
  for (const lib of ["Tube cuivre", "Raccord", "Prise", "CHANTIER FICTIF A", "CHANTIER FICTIF B", "Ouvrage fictif 1", "dès le 10/11/2026", "dès le 12/11/2026", "Date de besoin"]) assert.ok(html.includes(lib), lib);
  assert.ok(!html.includes("Siphon"), "semaine d'après : absent");
  assert.ok(!html.includes("Câble"), "marqué commandé : absent");
  assert.ok(!html.includes("Aucun matériau"), "pas de message vide");
});

test("8b. récap : même liste que la page (onglet « Semaine prochaine ») et que le bloc, au fuseau du serveur", async () => {
  const { partieMateriauxSemaineProchaine } = require("../api/_cron/cron-recap-commandes.js");
  const C = await import("../src/Renovation/commandesAPasserV1.mjs");
  const W = await import("../src/Renovation/commandesParSemaineV1.mjs");
  const tb = TABLES_OUVRAGES();
  const lignes = C.lignesACommander(C.modeleCommandesAPasser({ phasages: tb.phasages, chantiers: [], matById: C.indexMateriaux(tb.materiaux_bibliotheque), lotById: {}, lignesCmd: [], lots: [], achatsParCh: {} }));
  const page = W.semaineProchaineCommandesV1({ lignes, aujourdhui: W.dateLocaleV1(JOUR) }).lignes.map((l) => l.libelle).sort();
  const { partie } = await partieMateriauxSemaineProchaine(fausseBase(tb), JOUR);
  assert.deepEqual(partie.articles.map((a) => a.libelle).sort(), page);
  const bloc = W.etatBlocMateriauxACommanderV1({ dateIso: JOUR, lignes, max: 100 });
  assert.deepEqual(partie.chantiers.map((c) => [c.nom, c.nb, c.dateBesoin]), [["CHANTIER FICTIF A", 2, "2026-11-10"], ["CHANTIER FICTIF B", 1, "2026-11-12"]]);
  assert.deepEqual(partie.chantiers.map((c) => [c.nb, c.dateBesoin]), bloc.chantiers.map((c) => [c.nb, c.dateBesoin]));
  assert.deepEqual(partie.articles.map((a) => a.libelle), bloc.articles.map((a) => a.libelle), "même ordre que le bloc");
});

test("8c. récap : aucun article la semaine suivante et aucune demande → pas d'envoi ; aucun article mais une demande → « Aucun matériau à commander pour la semaine 48 »", async () => {
  const { runRecapCommandes } = require("../api/_cron/cron-recap-commandes.js");
  appels = [];
  const r = await runRecapCommandes(REQ(), fausseBase(TABLES_OUVRAGES()), t(7, "2026-12-04"));
  assert.equal(r.skipped, "no_content");
  assert.equal(appels.length, 0);
  const tb = TABLES_OUVRAGES();
  tb.besoins = [{ id: "b1", article: "Article fictif", quantite: "1", ouvrier_demandeur: "Ouvrier fictif", statut: "en_attente", chantier_id: "ch-a" }];
  const r2 = await runRecapCommandes(REQ(), fausseBase(tb), t(7, "2026-11-20"));
  assert.equal(r2.sent, true);
  assert.equal(r2.materiaux_etat, "aucun");
  const html = appels[0].corps.html;
  assert.ok(html.includes("Aucun matériau à commander pour la semaine 48 : aucun article non commandé n&#39;a de date de besoin du 23/11 au 29/11."));
  assert.ok(html.includes("0 article à commander la semaine prochaine"));
  assert.ok(html.includes("Article fictif"), "demandes ouvriers inchangées");
});

test("8d. récap : lecture en échec → la partie le dit (jamais « aucun »), le mail part quand même", async () => {
  const { runRecapCommandes } = require("../api/_cron/cron-recap-commandes.js");
  for (const table of ["phasages", "commande_lignes", "materiaux_bibliotheque", "achats_lots_termines", "chantiers"]) {
    appels = [];
    const r = await runRecapCommandes(REQ(), fausseBase(TABLES_OUVRAGES(), { [table]: "délai dépassé" }), t(7));
    assert.equal(r.sent, true, table);
    assert.equal(r.materiaux_etat, "erreur", table);
    assert.match(r.materiaux_erreur, /^Les articles à commander n'ont pas pu être lus : .*délai dépassé/, table);
    const html = appels[0].corps.html;
    assert.ok(html.includes("n&#39;ont pas pu être lus"), table);
    assert.ok(html.includes("matériaux de la semaine prochaine : lecture impossible"), table);
    assert.ok(!/Aucun matériau|0 article/.test(html), `${table} : jamais « aucun »`);
  }
});

// ═══ 4. Job ?job=push_materiaux ═════════════════════════════════════════════
// Tâche 10 : la notification C3 suit désormais la page « Commandes à passer »
// (commandesAPasserV1.mjs, vérifiée par scripts/verif-commandes-a-passer.mjs).
// Tâche 15 (organisation-par-jour) : le récap du vendredi aussi. Ce module n'a
// plus aucun utilisateur ; il est conservé tel quel (contrôle remplacé :
// « le récap du vendredi l'utilise » → « personne ne l'importe »).
test("9. job C3 et récap du vendredi : n'utilisent plus ce module ; aucun autre code ne l'importe", () => {
  const job = sansCommentaires(lire("api/_cron/cron-push-materiaux.js"));
  assert.ok(!/materiauxACommanderV1/.test(job), "le job C3 ne lit plus le calcul par phase");
  assert.match(job, /commandesAPasserV1\.mjs/);
  assert.ok(!/materiauxACommanderV1/.test(sansCommentaires(lire("api/_cron/cron-recap-commandes.js"))));
  const importeurs = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(chemin(dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules") parcourir(rel); continue; }
      if (!/\.(m?js|jsx)$/.test(e.name) || /materiauxACommanderV1\.m?js$/.test(e.name)) continue;
      if (/materiauxACommanderV1/.test(sansCommentaires(lire(rel)))) importeurs.push(rel);
    }
  };
  parcourir("src"); parcourir("api");
  assert.deepEqual(importeurs, [], "materiauxACommanderV1 n'a plus d'utilisateur (conservé, non modifié)");
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
  // Créneau tenu par la base (pg_cron), plus par GitHub — détail : verif-cron-notifications.mjs.
  assert.ok(!/^\s*schedule:/m.test(wf), "plus de schedule GitHub");
  const migr = lire("supabase/migrations/20261109134233_cron_notifications_push.sql");
  assert.match(migr, /'profero_push_materiaux',\s*'5 6,7 \* \* 1-5'/);
  assert.match(migr, /cron-dispatcher\?job=push_materiaux'/);
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
