// Vérification de l'étape 2 (refonte des marges) : les nouvelles alertes,
// calculées sur les relevés journaliers, qui remplacent « perte de marge ».
//
// Exemple issu des tests, données fictives : chantiers, lots et montants sont
// inventés pour le calcul.
//
//   node scripts/verif-alertes-marges.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alertesMargesV2 } from "../src/Renovation/alertesMargesV2.mjs";
import {
  libellePointAttentionV1, etatPointsAttentionV1, ETAT_DERIVES, ETAT_RELEVE_ABSENT,
  MOTIF_MARGE_PROBABLE_EN_BAISSE, MOTIF_LOT_EN_DERIVE, MOTIF_HEURES_SANS_LOT,
  MOTIF_PRODUCTION_HEURE_ABERRANTE, MOTIF_DEPASSEMENT_ENVELOPPE, MOTIF_CONSOMMATION_SANS_AVANCEMENT,
  MOTIF_PERTE_DE_MARGE,
} from "../src/Renovation/pointsAttentionV1.mjs";
import { suiviPointsAttentionV1 } from "../src/Renovation/suiviPointsAttentionV1.mjs";
import { alertesV1, NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER } from "../src/Renovation/alertesV1.mjs";
import { preparerSemainesRelevesJournaliersV2, dimancheSemaineISOV2 } from "../src/Renovation/pointsAttentionDonneesV1.mjs";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Un relevé journalier fictif : vendu 20 000 €, 200 h vendues (100 €/h au devis).
const lot = (id, v = {}) => ({ id, label: `Lot ${id}`, avancementExact: 50, ratioDeriveExact: 1, ecartHeures: 0, ecartEuros: 0,
  heuresRestantesPrevues: 50, heuresRestantesProbables: 50, ecartProbableEuros: 0, ...v });
const releve = (date, v = {}) => ({
  chantier_id: "C1", chantier_nom: "CHANTIER FICTIF", date_releve: date, week_id: "x",
  vendu_ht: 20000, heures_vendues: 200, avancement: 40, heures_reelles: 80, production_cumulee: 8000,
  marge_avancement: 1500, marge_probable: 3000, pct_sans_lot: 5, heures_sans_lot: 4, chantier_repris: false,
  lots: [lot("cloisons"), lot("peinture")], warnings: [], ...v,
});
const alertes = (avant, apres, seuils) => alertesMargesV2({ snapshotsCourants: [apres], snapshotsPrecedents: [avant], seuils });
const motifs = (r) => r.lignes[0]?.motifs || [];
// Une semaine d'activité ordinaire (10 h, 1 000 € produits, 100 €/h comme au devis).
const ACTIF = { heures_reelles: 90, production_cumulee: 9000 };

// 1. Une semaine où le chantier progresse et gagne de l'argent : aucune alerte.
{
  // +2 000 € produits pour 20 h (100 €/h, comme le devis), budget restant en baisse,
  // marge à l'avancement et marge probable en hausse.
  const r = alertes(releve("2026-10-18"), releve("2026-10-25", { heures_reelles: 100, production_cumulee: 10000, marge_avancement: 2100, marge_probable: 3200 }));
  ok(r.lignes.length === 0, "chantier qui progresse et gagne de l'argent : aucune alerte");
  ok(!JSON.stringify(r).includes(MOTIF_PERTE_DE_MARGE), "plus de « perte de marge »");
}

// 2. Marge probable en baisse de plus de 500 €, lot responsable cité en heures et en euros.
{
  const avant = releve("2026-10-18");
  const apres = releve("2026-10-25", { heures_reelles: 100, production_cumulee: 9000, marge_probable: 2100,
    lots: [lot("cloisons", { heuresRestantesProbables: 80, ecartProbableEuros: 900, ecartHeures: 20, ecartEuros: 800, ratioDeriveExact: 1.2 }), lot("peinture")] });
  const r = alertes(avant, apres);
  ok(motifs(r).includes(MOTIF_MARGE_PROBABLE_EN_BAISSE), "baisse de 900 € de la marge probable : alerte");
  const texte = libellePointAttentionV1(r.lignes[0]);
  ok(/Lot cloisons/.test(texte) && /\+30 h restantes probables/.test(texte) && /900 €/.test(texte), `lot responsable en heures et en euros : ${texte}`);
  ok(r.lignes[0].explication === null, "plus de phrase grise qui répète la ligne principale");
  ok(r.lignes[0].margePerdue === 900, "montant en jeu = baisse de la marge probable");
  const petit = alertes(avant, releve("2026-10-25", { marge_probable: 2600 }));
  ok(!motifs(petit).includes(MOTIF_MARGE_PROBABLE_EN_BAISSE), "baisse de 400 € : sous le seuil de 500 €");
  ok(motifs(alertes(avant, releve("2026-10-25", { marge_probable: 2600 }), { alerteBaisseMargeProbableEuros: 300 })).includes(MOTIF_MARGE_PROBABLE_EN_BAISSE), "seuil réglable dans Admin");
}

// 3. Lot qui dérive au-delà de ×1,3 avec au moins 25 % d'avancement.
{
  const r = alertes(releve("2026-10-18"), releve("2026-10-25", { ...ACTIF, lots: [lot("cloisons", { ratioDeriveExact: 1.6, avancementExact: 40, ecartHeures: 24, ecartEuros: 960 })] }));
  ok(motifs(r).includes(MOTIF_LOT_EN_DERIVE) && /×1,6 à 40 %/.test(libellePointAttentionV1(r.lignes[0])), "lot à 40 % en dérive ×1,6 : alerte");
  const tot = alertes(releve("2026-10-18"), releve("2026-10-25", { ...ACTIF, lots: [lot("cloisons", { ratioDeriveExact: 3, avancementExact: 10 })] }));
  ok(!motifs(tot).includes(MOTIF_LOT_EN_DERIVE), "lot à 10 % : pas d'alerte de dérive");
}

// 4. Heures sans lot au-delà de 10 %.
ok(motifs(alertes(releve("2026-10-18"), releve("2026-10-25", { ...ACTIF, pct_sans_lot: 18, heures_sans_lot: 20 }))).includes(MOTIF_HEURES_SANS_LOT), "18 % d'heures sans lot : alerte");

// 5. Production par heure aberrante : 6 000 € produits pour 10 h (600 €/h > 2 × 100 €/h).
{
  const r = alertes(releve("2026-10-18"), releve("2026-10-25", { heures_reelles: 90, production_cumulee: 14000, marge_avancement: 7000, marge_probable: 3000 }));
  ok(motifs(r).includes(MOTIF_PRODUCTION_HEURE_ABERRANTE), "production par heure aberrante : alerte");
  const sansHeure = alertes(releve("2026-10-18"), releve("2026-10-25", { production_cumulee: 9000, marge_probable: 3000 }));
  ok(motifs(sansHeure).includes(MOTIF_PRODUCTION_HEURE_ABERRANTE), "production sans aucune heure pointée : alerte (au moins 1 h comptée)");
}

// 6. Dépassement d'enveloppe matériaux d'un lot.
ok(motifs(alertes(releve("2026-10-18"), releve("2026-10-25", { ...ACTIF, warnings: [{ code: "depassement_enveloppe", lotId: "cloisons", label: "Cloisons", euros: 1000, pct: 50 }] })))
  .includes(MOTIF_DEPASSEMENT_ENVELOPPE), "dépassement d'enveloppe : alerte");

// 6 bis. Chantier sans activité sur la période (terminé, à l'arrêt) : pas d'alerte d'état répétée.
ok(alertes(releve("2026-10-18"), releve("2026-10-25", { pct_sans_lot: 40, lots: [lot("cloisons", { ratioDeriveExact: 2, avancementExact: 100 })] })).lignes.length === 0,
  "chantier sans heure ni production sur la période : pas d'alerte d'état");
ok(!motifs(alertes(releve("2026-10-18"), releve("2026-10-25", { ...ACTIF, warnings: [{ code: "depassement_enveloppe", lotId: "c", label: "C", euros: 40 }] }))).includes(MOTIF_DEPASSEMENT_ENVELOPPE),
  "dépassement de 40 € : sous le seuil (100 € par défaut)");

// 7. Consommation sans avancement (production exacte).
{
  const r = alertes(releve("2026-10-18"), releve("2026-10-25", { heures_reelles: 100, production_cumulee: 8100, marge_avancement: 700, marge_probable: 2900 }));
  ok(motifs(r).includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT), "20 h pour 100 € produits : consommation sans avancement");
}

// 8. Chantier repris : aucune alerte.
{
  const r = alertes(releve("2026-10-18", { chantier_repris: true }), releve("2026-10-25", { chantier_repris: true, pct_sans_lot: 40, marge_probable: -5000 }));
  ok(r.lignes.length === 0 && r.reprisIgnores.includes("CHANTIER FICTIF"), "chantier repris : aucune alerte");
  const a = alertesV1({ snapshotsCourants: [releve("2026-10-25", { chantier_repris: true, marge_terminaison: -3000, avancement: 50 })], snapshotsPrecedents: [], pointsAttention: r });
  ok(a.alertes.length === 0, "chantier repris : absent de la page Alertes");
}

// 9. Une donnée absente rend la règle muette (jamais 0).
ok(alertes(releve("2026-10-18", { marge_probable: null, production_cumulee: null }), releve("2026-10-25", { marge_probable: 0, production_cumulee: 30000 })).lignes.length === 0,
  "relevé de comparaison sans marge probable ni production : aucune alerte inventée");

// 10. Moteur d'alertes : baisse de marge probable = critique ; état journalier.
{
  const avant = releve("2026-10-18");
  const apres = releve("2026-10-25", { marge_probable: 1000, marge_terminaison: 2000 });
  const pa = alertes(avant, apres);
  const a = alertesV1({ snapshotsCourants: [apres], snapshotsPrecedents: [avant], pointsAttention: pa });
  ok(a.alertes[0].niveau === NIVEAU_CRITIQUE && a.alertes[0].impactEuros === 2000, "page Alertes : critique, impact 2 000 €");
  const etat = etatPointsAttentionV1(pa);
  ok(etat.statut === ETAT_DERIVES && /à regarder/.test(etat.message), "état : chantiers à regarder");
  const absent = etatPointsAttentionV1(alertesMargesV2({ snapshotsCourants: [], snapshotsPrecedents: [] }));
  ok(absent.statut === ETAT_RELEVE_ABSENT && /journalier/.test(absent.message), "relevé absent dit comme tel, jamais « aucune alerte »");
  const etatSeul = alertesV1({ snapshotsCourants: [releve("2026-10-25", { ...ACTIF, pct_sans_lot: 20 })], snapshotsPrecedents: [avant],
    pointsAttention: alertes(avant, releve("2026-10-25", { ...ACTIF, pct_sans_lot: 20 })) });
  ok(etatSeul.alertes[0].niveau === NIVEAU_A_SURVEILLER, "heures sans lot : à surveiller");
}

// 11. Fin de semaine = dernier relevé au plus tard le dimanche ; suivi sur trois semaines.
{
  ok(dimancheSemaineISOV2("2026-W43") === "2026-10-25" && dimancheSemaineISOV2("2027-W01") === "2027-01-10", "dimanche de la semaine ISO");
  const lignes = [releve("2026-10-09"), releve("2026-10-16", { marge_probable: 2900 }), releve("2026-10-22", { marge_probable: 1000 })];
  const [w43, w42, w41] = preparerSemainesRelevesJournaliersV2({ lignes, weekIds: ["2026-W43", "2026-W42", "2026-W41"] });
  ok(w43[0].date_releve === "2026-10-22" && w42[0].date_releve === "2026-10-16" && w41[0].date_releve === "2026-10-09", "dernier relevé de chaque semaine");
  const [vide] = preparerSemainesRelevesJournaliersV2({ lignes, weekIds: ["2026-W40"] });
  ok(vide.length === 0, "aucun relevé avant la semaine : chantier absent, pas inventé");
  const s = suiviPointsAttentionV1({ snapshotsN: w43, snapshotsN1: w42, snapshotsN2: w41, detecter: alertesMargesV2 });
  ok(s.actifs.length === 1 && s.actifs[0].motifs.includes(MOTIF_MARGE_PROBABLE_EN_BAISSE) && s.source === "releves_journaliers", "suivi branché sur les alertes des marges");
}

// 12. Les écrans passent par les relevés journaliers et les nouvelles règles.
{
  const bilan = lire("src/Renovation/BilanSemaine.jsx");
  ok(/chantier_releves_journaliers/.test(bilan) && /detecter: alertesMargesV2/.test(bilan) && !/chantier_snapshots_hebdo"\)/.test(bilan), "Bilan : relevés journaliers + alertes des marges");
  const page = lire("src/Renovation/PageAlertes.jsx");
  ok(/chantier_releves_journaliers/.test(page) && /alertesMargesV2\(/.test(page), "page Alertes : relevés journaliers + alertes des marges");
  ok(/alertesMargesV2\(/.test(lire("api/_ia/renovation/outils.js")), "assistant IA : nouvelles règles");
}

console.log(`verif-alertes-marges : OK (${nb} contrôles)`);
