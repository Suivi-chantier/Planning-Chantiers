// Vérification de l'étape 2 (refonte des marges) : les trois marges, la marge
// probable et la dérive des lots en heures et en euros.
//
// Exemple issu des tests, données fictives : chantiers, lots, prix, heures et
// commandes sont inventés pour le calcul.
//
//   - matériaux imputés à l'avancement : achat anticipé dans l'enveloppe
//     (différé), dépassement d'enveloppe (imputé tout de suite), lot terminé ;
//   - marge probable : lot à 10 % avec une dérive de ×3 (pas appliquée,
//     historique utilisé), lot à 40 % avec une dérive de ×2 (appliquée),
//     dérive neutralisée, historique avec moins de 2 chantiers (×1),
//     chantier repris exclu de l'historique, plafond ×5 ;
//   - dérive en heures et en euros ;
//   - marge de la période = différence de deux marges à l'avancement ;
//   - relevé journalier : nouvelles colonnes, ancienne « marge nette » plus écrite.
//
//   node scripts/verif-trois-marges.mjs
import assert from "node:assert/strict";
import {
  computeChantierFinance, margeReelleSemaine, margeAvancementALaDate, METHODE_CALCUL,
  materiauxImputesALAvancement, coefficientMargeProbable, derivesHistoriquesParLot,
  normaliserSeuilsMarges, SEUILS_MARGES_DEFAUT, chantierRepris, neutralisationsDerive,
  avancementLotExact, productionCumulee, CLE_CONFIG_SEUILS_MARGES, CLE_CONFIG_DERIVES_HISTORIQUES,
} from "../src/chantierFinance.mjs";
import { ligneReleve } from "../src/Renovation/releveJournalier.mjs";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(a != null && Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`); nb++; };

const LOTS = [{ id: "cloisons", label: "Cloisons" }, { id: "peinture", label: "Peinture" }];
const FG = [{ depuis: "2026-01-01", taux: 10 }];
// Un ouvrage, une tâche : prix, heures prévues (= estimées), avancement, enveloppe matériaux.
const ouvrage = (id, lot, { prix = 10000, heures = 100, av = 0, mat = 0 } = {}) => ({
  id, libelle: `Ouvrage ${id}`, lot_id: lot, prix_ht: prix, heures_devis: heures, cout_materiaux: mat,
  taches: [{ id: `t-${id}`, nom: `Tâche ${id}`, avancement: av, heures_estimees: heures, heures_vendues: heures }],
});
const pointage = (tache, heures, date = "2026-10-20", taux = 30) => ({ tache_id: tache, heures, taux_horaire: taux, date, type_pointage: "tache", ouvrier: "Ouvrier fictif" });
const commande = (montant, lot, { nature = "materiaux", date = "2026-10-15" } = {}) => ({ prix_total: montant, lot_id: lot, nature, created_at: `${date}T10:00:00Z` });
const fin = (ouvrages, extra = {}) => computeChantierFinance({
  phasage: { ouvrages, plan_travaux: { meta: extra.meta || {} } },
  pointages: extra.pointages || [], commandeLignes: extra.commandes || [],
  lots: LOTS, tauxMOPrev: 20, tauxFG: FG, aujourdhui: "2026-10-24",
  derivesHistoriques: extra.historique || null, seuilsMarges: extra.seuils || null,
});
const lot = (f, id) => f.lots.find(l => l.id === id);

// ── 1. Matériaux imputés à l'avancement ─────────────────────────────────────
{
  // Achat anticipé DANS l'enveloppe : 1 500 € commandés, enveloppe 2 000 €, lot à 25 %.
  const f = fin([ouvrage("a", "cloisons", { av: 25, mat: 2000 })], { commandes: [commande(1500, "cloisons")] });
  proche(f.brut.materiauxImputes, 500, "achat anticipé : seul le consommé théorique (25 % × 2 000 €) est imputé");
  proche(f.brut.materiauxEnAvance, 1000, "achat anticipé : 1 000 € en avance sur chantier");
  proche(f.brut.productionCumulee, 2500, "production cumulée = 25 % × 10 000 €");
  proche(f.brut.margeAvancement, 2000, "marge à l'avancement = 2 500 − 500");
  ok(f.margeAvancement.cle === "margeAvancement" && f.materiauxEnAvance.valeur === f.brut.materiauxEnAvance, "Donnee exposées");
}
{
  // Dépassement : 3 000 € commandés pour une enveloppe de 2 000 €, lot à 25 %.
  const m = materiauxImputesALAvancement({ ouvrages: [ouvrage("a", "cloisons", { av: 25, mat: 2000 })], commandeLignes: [commande(3000, "cloisons")], lots: LOTS });
  proche(m.enAvance, 1500, "dépassement : en avance plafonné au reste de l'enveloppe (2 000 × 75 %)");
  proche(m.impute, 1500, "dépassement : consommé (500) + dépassement (1 000) imputés tout de suite");
}
{
  // Lot terminé : tout est imputé, même sous l'enveloppe.
  const m = materiauxImputesALAvancement({ ouvrages: [ouvrage("a", "cloisons", { av: 100, mat: 2000 })], commandeLignes: [commande(1500, "cloisons")], lots: LOTS });
  proche(m.enAvance, 0, "lot terminé : rien en avance");
  proche(m.impute, 1500, "lot terminé : toutes les commandes imputées");
}
{
  // Sans lot et autres natures : imputés directement.
  const m = materiauxImputesALAvancement({ ouvrages: [ouvrage("a", "cloisons", { av: 0, mat: 2000 })],
    commandeLignes: [commande(400, null), commande(700, "cloisons", { nature: "sous_traitance" }), commande(300, "cloisons")], lots: LOTS });
  proche(m.impute, 400 + 700, "sans lot et sous-traitance imputés ; achat anticipé du lot différé");
  proche(m.enAvance, 300, "achat du lot à 0 % : entièrement en avance");
}

// ── 2. Marge probable : coefficients par lot ────────────────────────────────
const HIST = { cloisons: { coef: 1.2, nbChantiers: 3 }, peinture: { coef: 1.5, nbChantiers: 1 } };
{
  // Lot à 10 % avec une dérive de ×3 : pas appliquée (sous 25 %), historique ×1,2.
  const f = fin([ouvrage("a", "cloisons", { av: 10 })], { pointages: [pointage("t-a", 30)], historique: HIST });
  const l = lot(f, "cloisons");
  proche(l.ratioDeriveExact, 3, "lot à 10 % : dérive constatée ×3");
  ok(l.provenanceCoefficient === "historique", `lot à 10 % : historique utilisé (${l.provenanceCoefficient})`);
  proche(l.coefficient, 1.2, "coefficient historique ×1,2");
  proche(l.heuresRestantesPrevues, 90, "90 h restantes prévues");
  proche(l.heuresRestantesProbables, 108, "108 h restantes probables");
  proche(l.ecartProbableEuros, 18 * (20 + 10), "écart = 18 h × (taux MO prév. 20 + FG 10)");
  proche(f.brut.margeProbable, f.brut.margeATerminaison - 540, "marge probable = marge à terminaison − écart");
}
{
  // Lot à 40 % avec une dérive de ×2 : appliquée.
  const f = fin([ouvrage("a", "cloisons", { av: 40 })], { pointages: [pointage("t-a", 80)], historique: HIST });
  const l = lot(f, "cloisons");
  ok(l.provenanceCoefficient === "constatee", "lot à 40 % : dérive constatée appliquée");
  proche(l.coefficient, 2, "coefficient ×2");
  proche(l.heuresRestantesProbables, 120, "60 h restantes → 120 h probables");
  proche(f.brut.margeProbable, f.brut.margeATerminaison - 60 * 30, "marge probable = marge à terminaison − 60 h × 30 €");
  // Dérive en heures et en euros : 80 h réelles pour 40 h attendues.
  proche(l.heuresAttendues, 40, "heures attendues = 100 h × 40 %");
  proche(l.ecartHeures, 40, "écart de 40 h");
  proche(l.ecartEuros, 40 * (30 + 10), "écart en euros = 40 h × (coût horaire réel 30 + FG 10)");
}
{
  // Dérive neutralisée par le conducteur (commentaire obligatoire).
  const meta = { neutralisations_derive: { cloisons: { commentaire: "Reprise demandée par le client", par: "Loris", le: "2026-10-24" } } };
  const f = fin([ouvrage("a", "cloisons", { av: 40 })], { pointages: [pointage("t-a", 80)], meta });
  const l = lot(f, "cloisons");
  ok(l.provenanceCoefficient === "neutralisee" && l.coefficient === 1, "dérive neutralisée → ×1");
  ok(l.neutralisation?.commentaire === "Reprise demandée par le client", "neutralisation visible (commentaire)");
  proche(f.brut.margeProbable, f.brut.margeATerminaison, "neutralisée : marge probable = marge à terminaison");
  ok(Object.keys(neutralisationsDerive({ plan_travaux: { meta: { neutralisations_derive: { cloisons: { commentaire: "  " } } } } })).length === 0,
    "sans commentaire, la neutralisation ne compte pas");
}
{
  // Historique avec moins de 2 chantiers : ×1.
  const f = fin([ouvrage("p", "peinture", { av: 10 })], { pointages: [pointage("t-p", 30)], historique: HIST });
  const l = lot(f, "peinture");
  ok(l.provenanceCoefficient === "aucune" && l.coefficient === 1, "historique sur 1 seul chantier → ×1");
  // Plafond ×5.
  const g = fin([ouvrage("a", "cloisons", { av: 30 })], { pointages: [pointage("t-a", 300)] });
  proche(lot(g, "cloisons").coefficient, 5, "dérive ×10 plafonnée à ×5");
  ok(lot(g, "cloisons").coefficientPlafonne === true, "plafond signalé");
  // Seuil réglable dans Admin.
  const h = fin([ouvrage("a", "cloisons", { av: 20 })], { pointages: [pointage("t-a", 40)], seuils: { deriveSeuilAvancementPct: 15 } });
  ok(lot(h, "cloisons").provenanceCoefficient === "constatee", "seuil réglé à 15 % : dérive d'un lot à 20 % appliquée");
}
{
  // Dérives historiques : moyenne pondérée par les heures, chantier repris exclu.
  const termine = (nom, hr, repris = false) => ({ chantierId: nom, chantierNom: nom, repris,
    lots: lot(fin([ouvrage("a", "cloisons", { av: 100 })], { pointages: [pointage("t-a", hr)] }), "cloisons") ? fin([ouvrage("a", "cloisons", { av: 100 })], { pointages: [pointage("t-a", hr)] }).lots : [] });
  const r = derivesHistoriquesParLot([termine("A", 120), termine("B", 140), termine("TOM & CAMILLE", 500, true)]);
  proche(r.lots.cloisons.coef, 1.3, "historique = (120 + 140) ÷ (100 + 100)");
  ok(r.lots.cloisons.nbChantiers === 2 && r.lots.cloisons.retenu === true, "2 chantiers : historique retenu");
  ok(r.exclusRepris.includes("TOM & CAMILLE") && !r.lots.cloisons.chantiers.includes("TOM & CAMILLE"), "chantier repris exclu de l'historique");
  const seul = derivesHistoriquesParLot([termine("A", 120)]);
  ok(seul.lots.cloisons.retenu === false, "un seul chantier : historique non retenu");
  ok(coefficientMargeProbable({ lotId: "cloisons", avancementExact: 0, ratioDerive: null, historique: seul.lots }).provenance === "aucune", "→ ×1");
}
{
  // Chantier repris : mention, chiffres toujours calculés.
  const meta = { chantier_repris: { le: "2026-10-24", par: "Loris" } };
  const f = fin([ouvrage("a", "cloisons", { av: 40 })], { pointages: [pointage("t-a", 80)], meta });
  ok(f.repris?.par === "Loris" && f.brut.repris === true, "chantier repris lu dans le phasage");
  ok(/chantier repris/.test(f.margeAvancement.sousLabel), "mention « chantier repris » à côté de la marge");
  ok(chantierRepris({ plan_travaux: { meta: { chantier_repris: { actif: false } } } }) === null, "case décochée : plus repris");
}

// ── 3. Budget restant (ancienne « marge nette ») ────────────────────────────
{
  // Chantier à 0 % : l'ancienne « marge nette » affichait 100 % de marge.
  const f = fin([ouvrage("a", "cloisons", { av: 0 })]);
  proche(f.brut.budgetRestant, 10000, "budget restant = vendu − coûts engagés");
  ok(f.budgetRestant.label === "Budget restant" && /pas une marge/.test(f.budgetRestant.sousLabel), "libellé explicite");
  proche(f.brut.margeAvancement, 0, "marge à l'avancement d'un chantier à 0 % sans coût : 0");
}

// ── 4. Marge de la période = différence de deux marges à l'avancement ───────
{
  const L = (t, avant, apres, date) => ({ tache_id: t, avancement_avant: avant, avancement_apres: apres, date_realisation: date, created_at: `${date}T20:00:00Z` });
  const ouvrages = [ouvrage("a", "cloisons", { av: 50, mat: 2000 })];
  const phasage = { ouvrages, plan_travaux: { meta: {} } };
  const journal = [L("t-a", 0, 20, "2026-10-12"), L("t-a", 20, 50, "2026-10-20")];
  const pointages = [pointage("t-a", 10, "2026-10-12"), pointage("t-a", 16, "2026-10-20")];
  const commandeLignes = [commande(1500, "cloisons", { date: "2026-10-11" })];
  const base = { phasage, pointages, commandeLignes, lots: LOTS, tauxMOPrev: 20, tauxFG: FG, journal };
  const s1 = margeReelleSemaine({ ...base, du: null, au: "2026-10-16" });
  const s2 = margeReelleSemaine({ ...base, du: "2026-10-16", au: "2026-10-23" });
  const cumul = margeAvancementALaDate({ ...base, date: "2026-10-23" });
  ok(s1.calculable && s2.calculable, "les deux semaines sont calculables");
  proche(s1.marge + s2.marge, cumul.marge, "Σ marges des semaines = marge à l'avancement");
  proche(s2.cumul.marge, cumul.marge, "marge cumulée de la semaine = marge à l'avancement en fin de période");
  // Semaine 1 : 2 000 € produits, 400 € de matériaux imputés (20 % × 2 000), 10 h × (30 + 10).
  proche(s1.marge, 2000 - 400 - 400, "semaine 1 : production − matériaux imputés − MO − FG");
  // Semaine 2 : +3 000 €, +600 € de matériaux imputés, 16 h × 40 €.
  proche(s2.marge, 3000 - 600 - 640, "semaine 2 : l'achat anticipé est imputé quand le lot avance");
  ok(s2.semaine.label === "Marge de la période", "libellé « Marge de la période »");
  ok(METHODE_CALCUL.some(m => m.cle === "margeSemaine" && /Marge à l'avancement en fin de période − marge à l'avancement en début de période/.test(m.formule)), "méthode : marge de la période");
}

// ── 5. Méthode de calcul ────────────────────────────────────────────────────
{
  const cles = METHODE_CALCUL.map(m => m.cle);
  ["margeAvancement", "materiauxEnAvance", "margeProbable", "deriveLotHeuresEuros", "budgetRestant", "heuresSansLot"]
    .forEach(c => ok(cles.includes(c), `méthode de calcul : ${c}`));
  ok(/pas une marge/i.test(METHODE_CALCUL.find(m => m.cle === "budgetRestant").formule), "budget restant : ce n'est pas une marge");
  ok(CLE_CONFIG_SEUILS_MARGES === "seuils_marges" && CLE_CONFIG_DERIVES_HISTORIQUES === "derives_historiques_lots", "clés de réglage");
  const s = normaliserSeuilsMarges({ deriveSeuilAvancementPct: "30", derivePlafond: "abc" });
  ok(s.deriveSeuilAvancementPct === 30 && s.derivePlafond === SEUILS_MARGES_DEFAUT.derivePlafond, "réglages : valeur illisible → défaut");
  ok(SEUILS_MARGES_DEFAUT.alerteBaisseMargeProbableEuros === 500 && SEUILS_MARGES_DEFAUT.alerteDeriveLotRatio === 1.3
    && SEUILS_MARGES_DEFAUT.alerteSansLotPct === 10 && SEUILS_MARGES_DEFAUT.alerteProductionHeureFacteur === 2, "seuils d'alerte par défaut");
}

// ── 6. Avancement exact et production ───────────────────────────────────────
{
  const ouvrages = [ouvrage("a", "cloisons", { prix: 3000, av: 33.3 }), ouvrage("b", "cloisons", { prix: 1000, av: 100 })];
  proche(avancementLotExact(ouvrages, LOTS, "cloisons"), (33.3 * 3000 + 100 * 1000) / 4000, "avancement exact du lot, pondéré par le prix, sans arrondi");
  proche(productionCumulee(ouvrages), 999 + 1000, "production cumulée sans arrondi");
}

// ── 7. Relevé journalier : nouvelles colonnes ───────────────────────────────
{
  const inputs = { phasage: { chantier_id: "c1", ouvrages: [ouvrage("a", "cloisons", { av: 40, mat: 2000 })], plan_travaux: { meta: {} } },
    pointages: [pointage("t-a", 80, "2026-10-20")], commandeLignes: [commande(3000, "cloisons")], lots: LOTS, tauxMOPrev: 20, tauxFG: FG };
  const r = ligneReleve({ inputs, journal: [], dateISO: "2026-10-24", completude: { statut: "complete", attendus: [], manquants: [] } });
  ok(r.marge === null && r.marge_pct === null, "ancienne « marge nette » plus écrite");
  ok(r.marge_avancement != null && r.marge_probable != null && r.budget_restant != null && r.production_cumulee === 4000, "trois marges écrites");
  ok(r.lots[0].coefficient === 2 && r.lots[0].provenanceCoefficient === "constatee", "lot : coefficient et provenance");
  ok(r.warnings.some(w => w.code === "depassement_enveloppe" && w.euros === 1000), "dépassement d'enveloppe chiffré dans le relevé");
  ok(r.chantier_repris === false, "chantier non repris");
}

// ── 8. Chantier repris exclu des statistiques de cadences ───────────────────
{
  const { echantillonCadencesV1 } = await import("../src/Renovation/echantillonCadencesV1.mjs");
  const ph = (id, repris) => ({ chantier_id: id, plan_travaux: { meta: repris ? { chantier_repris: { le: "2026-10-24", par: "Loris" } } : {} },
    ouvrages: [{ id: `o-${id}`, bibliotheque_id: "b1", taches: [{ id: `t-${id}`, avancement: 100, heures_vendues: 10 }] }] });
  const pts = ["A", "B"].map(id => ({ chantier_id: id, tache_id: `t-${id}`, heures: 12, type_pointage: "tache" }));
  const avec = echantillonCadencesV1({ phasages: [ph("A", false), ph("B", false)], pointages: pts });
  const sans = echantillonCadencesV1({ phasages: [ph("A", false), ph("B", true)], pointages: pts });
  const nbOuvrages = (r) => JSON.stringify(r).match(/"chantierId":"[AB]"/g)?.length ?? 0;
  ok(nbOuvrages(sans) < nbOuvrages(avec) || JSON.stringify(sans) !== JSON.stringify(avec), "chantier repris : retiré de l'échantillon de cadences");
}

// ── 9. Plus aucune « marge nette » présentée comme une marge ────────────────
{
  const f = fin([ouvrage("a", "cloisons", { av: 40 })], { pointages: [pointage("t-a", 80)] });
  ok(f.marge.label === "Budget restant" && f.marge === f.budgetRestant, "l'ancienne Donnee « marge » est le budget restant");
  ok(!METHODE_CALCUL.some(m => /marge nette/i.test(m.label)), "méthode de calcul : plus d'entrée « Marge nette »");
  ok(!METHODE_CALCUL.some(m => m.cle === "margePct"), "méthode de calcul : « Marge % » sur le vendu a disparu");
  // Seuil de prime comparé à la marge probable.
  const g = fin([ouvrage("a", "cloisons", { av: 40 })], { pointages: [pointage("t-a", 80)], meta: { seuil_prime: 90 } });
  ok(g.warnings.some(w => w.code === "marge_sous_seuil_prime" && /Marge probable/.test(w.message)), "seuil de prime : comparé à la marge probable");
}

console.log(`verif-trois-marges : OK (${nb} contrôles)`);
