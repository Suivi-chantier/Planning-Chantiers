// Vérification du détail des KPI de la fiche Opération (clic sur une carte) :
// regroupements « toute l'opération » (MO par ouvrier, vendu par lot, heures
// par phase) et rapprochement exact avec le chiffre de la carte.
//
// Exemple issu des tests, données fictives : logements, ouvriers, phases et
// montants sont inventés pour le calcul.
import assert from "node:assert/strict";
import { computeChantierFinance, statsGroupeChrono } from "../src/chantierFinance.mjs";
import { agregerOperation } from "../src/Renovation/operationExportModele.mjs";
import {
  detailKpiOperation, carteDeriveOperation, KPI_OPERATION, texteRatio,
} from "../src/Renovation/operationKpiDetail.mjs";

const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`);
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Données fictives ────────────────────────────────────────────────────────
const lots = [{ id: "elec", label: "Électricité" }, { id: "plomb", label: "Plomberie" }];
const phasageA = {
  chantier_id: "A",
  ouvrages: [
    { id: "o1", libelle: "Réseau élec A", lot_id: "elec", prix_ht: 10000, heures_devis: 20,
      taches: [{ id: "t1", chrono_groupe_id: "gA1", heures_vendues: 20, avancement: 50 }] },
    { id: "o2", libelle: "Plomberie A", lot_id: "plomb", prix_ht: 5000, heures_devis: 10,
      taches: [
        { id: "t2", chrono_groupe_id: "gA2", heures_vendues: 10, avancement: 100 },
        { id: "t3", chrono_groupe_id: "gA2", heures_vendues: 0, avancement: 0, hors_devis: true },
      ] },
  ],
  plan_travaux: { meta: { fg_taux_horaire: 5, chrono_groupes: [
    { id: "gA2", nom: "Plomberie", groupe_type_id: "gt_plomb", ordre: 20 },
    { id: "gA1", nom: "Passage réseau élec", groupe_type_id: "gt_reseau_elec", ordre: 10 },
  ] } },
};
const pointagesA = [
  { chantier_id: "A", tache_id: "t1", ouvrier: "Ouvrier A", heures: 12, taux_horaire: 30, date: "2026-10-01" },
  { chantier_id: "A", tache_id: "t2", ouvrier: "Ouvrier B", heures: 8, taux_horaire: 25, date: "2026-10-02" },
  { chantier_id: "A", tache_id: "t3", ouvrier: "Ouvrier A", heures: 2, taux_horaire: 30, date: "2026-10-03" },
  { chantier_id: "A", tache_id: null, type_pointage: "indirect", motif_indirect: "Trajet", ouvrier: "Ouvrier A", heures: 1, taux_horaire: 30, date: "2026-10-03" },
];
// Logement B : une phase du même type sous un autre nom, et une tâche sans phase.
// Ses tâches portent 20 h vendues pour 16 h sur l'ouvrage (écart attendu : − 4 h).
const phasageB = {
  chantier_id: "B",
  ouvrages: [
    { id: "o3", libelle: "Réseau élec B", lot_id: "elec", prix_ht: 8000, heures_devis: 16,
      taches: [
        { id: "t4", chrono_groupe_id: "gB1", heures_vendues: 16, avancement: 25 },
        { id: "t5", heures_vendues: 4, avancement: 0 },
      ] },
  ],
  plan_travaux: { meta: { fg_taux_horaire: 5, chrono_groupes: [
    { id: "gB1", nom: "Réseau électrique", groupe_type_id: "gt_reseau_elec", ordre: 1 },
  ] } },
};
const pointagesB = [
  { chantier_id: "B", tache_id: "t4", ouvrier: "Ouvrier A", heures: 6, taux_horaire: 30, date: "2026-10-04" },
  { chantier_id: "B", tache_id: "t5", ouvrier: "Ouvrier C", heures: 1, taux_horaire: 20, date: "2026-10-05" },
];

const fin = (phasage, pointages) => ({ finance: computeChantierFinance({ phasage, pointages, commandeLignes: [], lots }) });
const finParChantier = { A: fin(phasageA, pointagesA), B: fin(phasageB, pointagesB) };
const chantiersOp = [
  { id: "A", nom: "Logement A", statut: "en_cours" },
  { id: "B", nom: "Logement B", statut: "en_cours" },
  { id: "C", nom: "Logement C (sans phasage)", statut: "planifie" },
];
const agg = agregerOperation(chantiersOp, finParChantier, ["en_cours", "planifie"]);
const ctx = { chantiersOp, finParChantier, agg, lots };

// ── Cas ─────────────────────────────────────────────────────────────────────
test("les lignes du Phasage s'affichent à l'identique (champs ajoutés seulement)", () => {
  const mo = finParChantier.A.finance.moReel.ventilation;
  assert.equal(mo[0].main, "Ouvrier A");
  assert.equal(mo[0].right, "420 €");
  assert.equal(mo[0].sub, "14h × 30 €/h");
  assert.equal(finParChantier.A.finance.venduHT.ventilation[0].right, "10 000 €");
});

test("statsGroupeChrono inchangé après extraction de statsTachesChrono", () => {
  assert.deepEqual(statsGroupeChrono("gA2", phasageA.ouvrages), { count: 2, avancement: 100, termine: true });
});

test("coût MO : par ouvrier sur toute l'opération, total = la carte", () => {
  const d = detailKpiOperation("mo", ctx);
  proche(d.total, agg.moReel, "total = agg.moReel");
  const a = d.consolide.lignes.find((l) => l.main === "Ouvrier A");
  proche(a.valeur, 14 * 30 + 6 * 30, "Ouvrier A, deux logements");
  assert.match(a.sub, /20h × 30 €\/h · 2 logements/);
  const somme = d.consolide.lignes.reduce((s, l) => s + (l.valeur || 0), 0);
  proche(somme, agg.moReel, "les lignes regroupées retombent sur le total");
  assert.ok(d.consolide.lignes.some((l) => l.main === "Trajets"));
  assert.ok(!d.consolide.lignes.some((l) => l.main === "Non ventilé"), "aucun écart ici");
});

test("par logement : la Donnee du chantier, et le logement sans phasage est nommé", () => {
  const d = detailKpiOperation("mo", ctx);
  assert.deepEqual(d.parLogement.map((l) => l.nom), ["Logement A", "Logement B"]);
  assert.equal(d.parLogement[0].valeurTexte, finParChantier.A.finance.moReel.valeurTexte);
  assert.equal(d.parLogement[0].lignes, finParChantier.A.finance.moReel.ventilation);
  assert.deepEqual(d.sansPhasage, ["Logement C (sans phasage)"]);
  assert.match(d.sousTitre, /2 logements chiffrés · 1 sans phasage, hors chiffres/);
});

test("vendu : par lot, tous logements confondus", () => {
  const d = detailKpiOperation("vendu", ctx);
  proche(d.total, 23000, "total vendu");
  assert.equal(d.consolide.lignes[0].main, "Électricité");
  assert.equal(d.consolide.lignes[0].right, "18 000 €");
  assert.match(d.consolide.lignes[0].sub, /2 ouvrages · 2 logements/);
});

test("marges : les postes viennent d'agregerOperation", () => {
  const d = detailKpiOperation("marge", ctx);
  assert.equal(d.totalTexte, `${agg.marge >= 0 ? "+" : ""}${Math.round(agg.marge).toLocaleString("fr-FR")} €`);
  assert.equal(d.consolide.lignes.length, 4);
  assert.equal(detailKpiOperation("marge_prev", ctx).consolide.lignes.length, 3);
});

test("dérive : phases regroupées par type, dans l'ordre du phasage", () => {
  const d = detailKpiOperation("derive", ctx);
  const l = d.consolide.lignes;
  // Même type gt_reseau_elec sous deux noms : une seule ligne, nom du premier vu.
  assert.equal(l[0].main, "Passage réseau élec");
  // 18 h réelles / 36 h vendues ; avancement (50×20 + 25×16) / 36 = 38,9 → 39 %.
  assert.match(l[0].sub, /^18h \/ 36h vendues · 39% avancé · 2 logements$/);
  assert.equal(l[0].right, texteRatio((18 / 36) / 0.39));
  assert.equal(l[0].rightColor, "#e15a5a", "au-delà de ×1,15 : rouge");
  // Plomberie : la tâche hors devis est à part, jamais comparée.
  assert.equal(l[1].main, "Plomberie");
  assert.match(l[1].sub, /8h \/ 10h vendues · 100% avancé · \+ 2h hors devis · 1 logement/);
  assert.equal(l[1].right, "×0.80");
  // Sans phase en dernier, non calculable à 0 % (jamais affiché comme ×0).
  assert.equal(l[2].main, "Sans phase (à organiser)");
  assert.equal(l[2].right, "—");
  assert.match(l[2].sub, /non calculable : avancement à 0 %/);
});

test("dérive : heures hors phase et écart de vendu ont leur ligne", () => {
  const l = detailKpiOperation("derive", ctx).consolide.lignes;
  const hp = l.find((x) => x.main.startsWith("Trajets"));
  assert.match(hp.sub, /^1h réelles/);
  const ec = l.find((x) => x.main.startsWith("Écart de vendu"));
  assert.equal(ec.right, "− 4h");
  assert.match(ec.sub, /46h vendues sur les ouvrages, 50h réparties sur les tâches/);
});

test("dérive : la carte = formule des lots sur les sommes de l'opération", () => {
  const b = (id) => finParChantier[id].finance.brut;
  const hComp = b("A").heuresComparablesChantier + b("B").heuresComparablesChantier;
  proche(agg.hComparables, hComp, "heures comparées");
  proche(agg.derive, (hComp / 46) / (agg.avancement / 100), "dérive opération");
  const carte = carteDeriveOperation(agg);
  assert.equal(carte.valeurTexte, texteRatio(agg.derive));
  const d = detailKpiOperation("derive", ctx);
  assert.equal(d.totalTexte, carte.valeurTexte, "même chiffre sur la carte et dans le détail");
  // Par logement : la dérive du chantier, et ses phases.
  assert.equal(d.parLogement[1].valeurTexte, texteRatio(b("B").deriveChantier));
  assert.equal(d.parLogement[1].lignes.length, 2);
});

test("dérive non calculable : affichée comme telle, jamais 0", () => {
  const vide = agregerOperation([{ id: "X", statut: "en_cours" }], {}, ["en_cours"]);
  assert.equal(vide.derive, null);
  const carte = carteDeriveOperation(vide);
  assert.equal(carte.valeurTexte, "—");
  assert.equal(carte.sousLabel, "non calculable : aucune heure vendue");
  const d = detailKpiOperation("derive", { chantiersOp: [{ id: "X", nom: "X" }], finParChantier: {}, agg: vide });
  assert.equal(d.vide, "Aucun logement de l'opération n'a de phasage chiffré.");
  assert.equal(d.totalTexte, "—");
});

test("clé inconnue → null ; toutes les cartes ont une définition", () => {
  assert.equal(detailKpiOperation("inconnu", ctx), null);
  ["vendu", "mo", "derive", "mat", "fg", "marge", "marge_prev"].forEach((k) => assert.ok(KPI_OPERATION[k], k));
});

let ko = 0;
for (const [nom, fn] of cas) {
  try { fn(); console.log(`✓ ${nom}`); } catch (e) { ko++; console.error(`✗ ${nom}\n  ${e.message}`); }
}
console.log(`\n${cas.length - ko}/${cas.length} vérifications passées (données fictives).`);
if (ko > 0) process.exit(1);
