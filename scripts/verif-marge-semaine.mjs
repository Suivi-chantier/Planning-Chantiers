// Vérification de la marge RÉELLE de la semaine (Bilan semaine, décision du
// 13/10/2026) : production − main-d'œuvre − matériaux − frais généraux, sur la
// période entre deux relevés d'avancement.
//
// Exemple issu des tests, données fictives : chantier, ouvriers, fournisseurs
// et montants sont inventés pour le calcul.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  margeReelleSemaine, dateImputationLigne, libellePeriodeMarge,
  computeChantierFinance, METHODE_CALCUL,
} from "../src/chantierFinance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`);

// ── Données fictives ────────────────────────────────────────────────────────
const phasage = {
  ouvrages: [
    { id: "o1", prix_ht: 30000, heures_devis: 200, taches: [{ id: "t1", avancement: 40, heures_estimees: 100 }] },
    { id: "o2", prix_ht: 10000, heures_devis: 80, taches: [{ id: "t2", avancement: 20, heures_estimees: 50 }] },
  ],
  plan_travaux: { meta: { fg_taux_horaire: 10 } },
};
// Relevé de début le 02/10 (exclu), relevé de fin le 09/10 (inclus).
const DU = "2026-10-02", AU = "2026-10-09";
const pt = (date, heures, taux, extra = {}) => ({ date, heures, taux_horaire: taux, ouvrier: "Ouvrier A", tache_id: "t1", ...extra });
const pointages = [
  pt("2026-09-30", 8, 30),                                   // avant la période
  pt(DU, 8, 30),                                             // jour du relevé de début : EXCLU
  pt("2026-10-05", 8, 30),                                   // dans la période
  pt("2026-10-06", 7, 25, { ouvrier: "Ouvrier B", tache_id: "t2" }),
  pt("2026-10-07", 1, 30, { tache_id: null, type_pointage: "indirect" }), // trajet : compté
  pt("2026-10-08", 2, 30, { tache_id: null }),               // heure libre : comptée
  pt("2026-10-08", 3, 30, { tache_id: "tache-supprimee" }),  // tâche hors phasage : non comptée
  pt(AU, 8, 30),                                             // jour du relevé de fin : INCLUS
  pt("2026-10-10", 8, 30),                                   // après la période
];
const ligne = (prix_total, { date_doc = null, created_at = "2026-10-12T09:00:00Z", fournisseur = "Fournisseur X" } = {}) =>
  ({ prix_total, created_at, commande: { fournisseur_nom: fournisseur, date_doc } });
const commandeLignes = [
  ligne(500, { date_doc: "2026-10-06" }),                          // document dans la période, saisi après : compté
  ligne(300, { date_doc: "2026-09-15", created_at: "2026-10-06T10:00:00Z" }), // saisi dans la période, document avant : NON compté
  ligne(200, { created_at: "2026-10-07T10:00:00Z", fournisseur: "Fournisseur Y" }), // sans date de document : date de saisie
  ligne(1000, { date_doc: "2026-10-20" }),                         // après la période
];
const base = { phasage, pointages, commandeLignes, prixVendu: 40000 };

// ── 1. Date d'imputation d'un achat ─────────────────────────────────────────
assert.equal(dateImputationLigne({ created_at: "2026-10-12T09:00:00Z", commande: { date_doc: "2026-10-06" } }), "2026-10-06");
assert.equal(dateImputationLigne({ created_at: "2026-10-07T10:00:00Z", commande: { date_doc: null } }), "2026-10-07");
assert.equal(dateImputationLigne({}), null);

// ── 2. Cas nominal : chaque poste, bornes de période comprises ──────────────
{
  const r = margeReelleSemaine({ ...base, avancementDebut: 30, avancementFin: 35, du: DU, au: AU });
  assert.equal(r.calculable, true);
  assert.equal(r.points, 5);
  assert.equal(r.produit, 2000, "production = 40 000 € × 5 pts");
  // 8 h (05/10) + 7 h (06/10, ouvrier B) + 1 h trajet + 2 h libres + 8 h (09/10) = 26 h
  proche(r.heures, 26, "heures de la période");
  proche(r.mo, 8 * 30 + 7 * 25 + 1 * 30 + 2 * 30 + 8 * 30, "main-d'œuvre");
  proche(r.materiaux, 700, "matériaux : 500 (document) + 200 (saisie)");
  proche(r.fg, 260, "frais généraux = 10 €/h × 26 h");
  proche(r.marge, 2000 - 745 - 700 - 260, "marge de la semaine");
  assert.equal(r.nbLignesMateriaux, 2);
  proche(r.heuresHorsPlan, 3, "heures sur une tâche supprimée");
  assert.ok(r.warnings.some(w => w.code === "heures_hors_plan"), "les heures non comptées sont signalées");
  // La fiche explicative porte la formule, le détail et la période.
  assert.equal(r.semaine.cle, "margeSemaine");
  assert.equal(r.semaine.renseigne, true);
  assert.match(r.semaine.calculDetaille, /2\s000 € produits − 745 € main-d'œuvre − 700 € matériaux − 260 € frais généraux = \+295 €/);
  assert.equal(r.semaine.sousTitre, "Après le relevé du 02/10/2026, jusqu'au relevé du 09/10/2026");
  assert.ok(r.semaine.ventilation.some(v => v.main === "↳ Fournisseur Y" && v.sub === "commande du 07/10/2026"));
  assert.ok(r.semaine.ventilation.some(v => v.main === "↳ Ouvrier B"));
}

// ── 3. Une semaine qui coûte sans avancer donne une marge négative ──────────
{
  const r = margeReelleSemaine({ ...base, avancementDebut: 35, avancementFin: 35, du: DU, au: AU });
  assert.equal(r.calculable, true);
  assert.equal(r.produit, 0);
  proche(r.marge, -(745 + 700 + 260), "coûts sans production");
}

// ── 4. Impossibilités visibles : jamais un zéro inventé ─────────────────────
{
  const sansFin = margeReelleSemaine({ ...base, avancementDebut: 30, avancementFin: null, du: DU, au: AU });
  assert.equal(sansFin.calculable, false);
  assert.equal(sansFin.marge, null);
  assert.equal(sansFin.produit, null);
  assert.equal(sansFin.cumul, null);
  assert.match(sansFin.raison, /Relevé d'avancement de fin de semaine absent/);
  assert.equal(sansFin.semaine.valeurTexte, "non calculable");
  assert.equal(sansFin.semaine.warnings[0].code, "marge_non_calculable");
  proche(sansFin.couts, 745 + 700 + 260, "les coûts restent connus");

  const sansPrix = margeReelleSemaine({ ...base, prixVendu: 0, avancementDebut: 30, avancementFin: 35, du: DU, au: AU });
  assert.equal(sansPrix.calculable, false);
  assert.match(sansPrix.raison, /sans prix de vente/);

  const sansFG = margeReelleSemaine({ ...base, phasage: { ...phasage, plan_travaux: { meta: {} } }, avancementDebut: 30, avancementFin: 35, du: DU, au: AU });
  assert.equal(sansFG.fg, 0);
  assert.ok(sansFG.warnings.some(w => w.code === "fg_non_regle"), "frais généraux non réglés : signalé");
}

// ── 5. Production : même arrondi que le « Généré » du bilan ─────────────────
{
  const r = margeReelleSemaine({ ...base, prixVendu: 33333, avancementDebut: 10, avancementFin: 13, du: DU, au: AU });
  assert.equal(r.produit, Math.round(33333 * 3 / 100));
}

// ── 6. Depuis le début : mêmes coûts que la marge nette du module ───────────
{
  const r = margeReelleSemaine({ ...base, avancementDebut: 30, avancementFin: 35, du: DU, au: null });
  const fin = computeChantierFinance({ phasage, pointages, commandeLignes });
  const attendu = Math.round(40000 * 35 / 100) - fin.brut.coutMOTotalChantier - fin.brut.coutMatChantier - fin.brut.fgChantier;
  proche(r.cumul.marge, attendu, "marge depuis le début, sans date de fin");
  assert.equal(r.cumulee.cle, "margeCumulee");
}

// ── 7. Cohérence : depuis le début (fin) − depuis le début (début) = semaine ─
{
  const semaine = margeReelleSemaine({ ...base, avancementDebut: 30, avancementFin: 35, du: DU, au: AU });
  const avant = margeReelleSemaine({ ...base, avancementDebut: 0, avancementFin: 30, du: null, au: DU });
  proche(semaine.cumul.marge - avant.cumul.marge, semaine.marge, "les semaines s'additionnent");
  // Depuis le début du chantier (chantier nouveau) : la période n'a pas de borne basse.
  const nouveau = margeReelleSemaine({ ...base, avancementDebut: 0, avancementFin: 35, du: null, au: AU });
  proche(nouveau.marge, nouveau.cumul.marge, "chantier nouveau : semaine = depuis le début");
  assert.equal(libellePeriodeMarge(null, null), "depuis le début du chantier, jusqu'à aujourd'hui");
}

// ── 8. Méthode de calcul et page : l'ancienne formule a disparu ─────────────
{
  const cles = METHODE_CALCUL.map(m => m.cle);
  assert.ok(cles.includes("margeSemaine") && cles.includes("margeCumulee"));
  assert.equal(cles.includes("margeGeneree"), false, "plus de « marge générée » (part de la marge à terminaison)");
  const page = await readFile(resolve(here, "../src/Renovation/BilanSemaine.jsx"), "utf8");
  assert.match(page, /margeReelleSemaine\(/, "la page passe par le module");
  assert.equal(/margesGenerees|margeATerminaison \* p\.delta|m \* p\.delta/.test(page), false, "aucun recalcul parallèle de la marge");
  // Module pur : le calcul ajouté ne lit aucune horloge.
  const source = await readFile(resolve(here, "../src/chantierFinance.mjs"), "utf8");
  const bloc = source.slice(source.indexOf("export function margeReelleSemaine"));
  assert.equal(/new Date\s*\(|Date\.now\s*\(/.test(bloc), false, "aucune horloge dans le calcul");
}

console.log("verif-marge-semaine : OK");
