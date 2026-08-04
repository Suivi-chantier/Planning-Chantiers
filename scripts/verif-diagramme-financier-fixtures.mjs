// scripts/verif-diagramme-financier-fixtures.mjs — Banc de test Point 5 / Prompt 1
//
// Valide src/Renovation/diagrammeFinancier.mjs sur des données synthétiques
// couvrant tous les pièges de l'audit : cohérence AU CENTIME avec
// chantierFinance, reprise/legacy/pointages sans date, lignes de commande à
// date_doc / repli created_at / non datables, période "-corrige" prioritaire,
// période à id uuid non datable, fractions tolérantes ("70" → 0,70),
// agrégation multi-lots par nom, report des valeurs manquantes, non-apparié.
//
// Usage :  node scripts/verif-diagramme-financier-fixtures.mjs
// Aucun réseau, aucune dépendance.

import { computeChantierFinance } from "../src/chantierFinance.mjs";
import {
  seriesReellesChantier, seriesEtatsFinanciers, periodesMensuelles,
  moisDePeriode, parseFraction, normNomChantier,
  seriesPrevuesChantier, resolutionAcomptePct, dateSignatureChantier,
  recapReference,
} from "../src/Renovation/diagrammeFinancier.mjs";

let ok = 0, ko = 0;
const EPS = 0.005;
function check(label, actual, expected) {
  const pass = (actual == null && expected == null) ||
    (typeof expected === "number"
      ? Math.abs((actual ?? NaN) - expected) <= EPS
      : actual === expected);
  if (pass) { ok++; console.log(`  OK  ${label}`); }
  else { ko++; console.log(`  KO  ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
}

// ── Fixture chantier ─────────────────────────────────────────────────────────
const tauxHoraires = { Alice: 30, Bob: 20 };
const phasage = {
  chantier_id: "test", chantier_nom: "TEST - LOT 1",
  plan_travaux: { meta: { reprise_heures: 10, reprise_taux: 20 } }, // reprise 200 €
  ouvrages: [{
    id: "o1", libelle: "Ouvrage 1", prix_ht: 10000, heures_devis: 100,
    taches: [
      { id: "t1", nom: "Pointée", heures_estimees: 50, avancement: 50 },
      // Legacy : pas de pointage → 8 h × (30 + 20) = 400 €, sans date.
      { id: "t2", nom: "Legacy", heures_estimees: 50, avancement: 0, heures_reelles: 8, ouvriers: ["Alice", "Bob"] },
    ],
  }],
};
const pointages = [
  { tache_id: "t1", type_pointage: "tache", ouvrier: "Alice", date: "2026-05-10", heures: 10, taux_horaire: 30 }, // 300 (mai)
  { tache_id: "t1", type_pointage: "tache", ouvrier: "Bob", date: "2026-06-02", heures: 5, taux_horaire: 20 },    // 100 (juin)
  { tache_id: null, type_pointage: "tache", ouvrier: "Alice", date: "2026-06-15", heures: 2, taux_horaire: 30 },  // libre 60 (juin)
  { type_pointage: "indirect", motif_indirect: "Trajet", ouvrier: "Bob", date: "2026-05-12", heures: 1, taux_horaire: 20 }, // 20 (mai)
  { tache_id: "t1", type_pointage: "tache", ouvrier: "Alice", date: "", heures: 3, taux_horaire: 30 },            // 90, SANS date
];
const commandeLignes = [
  { id: "l1", libelle: "Placo", prix_total: 500, commande: { date_doc: "2026-05-20" } },                      // 500 (mai, date_doc)
  { id: "l2", libelle: "Visserie", prix_unitaire: 10, quantite: 3, commande: { created_at: "2026-06-05T10:00:00Z" } }, // 30 (juin, repli)
  { id: "l3", libelle: "Divers", prix_total: 100 },                                                            // 100, SANS date
];

const finance = computeChantierFinance({ phasage, pointages, commandeLignes, tauxHoraires, tauxMOPrev: 25, lots: [] });

// ── Fixture États financiers ─────────────────────────────────────────────────
const etatsFinanciers = {
  avancement: {
    periods: [ // du plus récent au plus ancien, corrigée AVANT la brute (convention appli)
      { id: "2026-06-30", label: "30/06/26" },
      { id: "2026-05-31-corrige", label: "31/05/26 corrigé" },
      { id: "2026-05-31", label: "31/05/26" },
      { id: "periode_abc123", label: "brouillon" }, // non datable
      { id: "2026-04-30", label: "30/04/26" },
    ],
    rows: [
      { id: "r1", devis: "D-1", chantier: "TEST - LOT 1", values: {
        "2026-04-30": { chantier: "TEST - LOT 1", montantHT: "10000", pctFacture: "0,3", avancementReel: "0.4", acompteMois: "0,1" },
        "2026-05-31": { chantier: "TEST - LOT 1", montantHT: 10000, pctFacture: 0.5, avancementReel: 0.6 }, // brute : doit être IGNORÉE
        "2026-05-31-corrige": { chantier: "TEST - LOT 1", montantHT: 10000, pctFacture: 0.45, avancementReel: 0.55 },
        "2026-06-30": { chantier: "TEST - LOT 1", montantHT: 10000, pctFacture: "70", avancementReel: "0,8" }, // "70" → 0,70
      } },
      // 2e devis du MÊME chantier (agrégation), nom avec casse différente,
      // pas de valeur en juin → report du cumul de mai.
      { id: "r2", devis: "D-2", chantier: "Test - Lot 1", values: {
        "2026-05-31-corrige": { chantier: "Test - Lot 1", montantHT: 5000, pctFacture: 0.2, avancementReel: 0.3 },
      } },
      { id: "r3", devis: "D-3", chantier: "AUTRE CHANTIER", values: {
        "2026-06-30": { chantier: "AUTRE CHANTIER", montantHT: 8000, pctFacture: 0.9, avancementReel: 1 },
      } },
    ],
  },
};

// ── Tests unitaires de parsing ───────────────────────────────────────────────
console.log("Parsing :");
check("moisDePeriode id ISO", moisDePeriode({ id: "2026-04-30" }), "2026-04");
check("moisDePeriode id suffixé", moisDePeriode({ id: "2026-04-30-corrige" }), "2026-04");
check("moisDePeriode uuid + label date", moisDePeriode({ id: "periode_x", label: "31/05/26" }), "2026-05");
check("moisDePeriode non datable", moisDePeriode({ id: "periode_x", label: "brouillon" }), null);
check("parseFraction '0,82'", parseFraction("0,82"), 0.82);
check("parseFraction '82'", parseFraction("82"), 0.82);
check("parseFraction vide", parseFraction(""), null);
check("normNom accents/espaces", normNomChantier("  Érceau   LOU "), "erceau lou");

const pm = periodesMensuelles(etatsFinanciers.avancement);
check("périodes : 3 mois datables", pm.mois.length, 3);
check("périodes : 1 non datable", pm.nonDatables.length, 1);
check("périodes : mai = la corrigée", pm.mois.find(m => m.mois === "2026-05")?.periodId, "2026-05-31-corrige");
check("périodes : ordre chronologique", pm.mois.map(m => m.mois).join(","), "2026-04,2026-05,2026-06");

// ── Les 3 séries réelles ─────────────────────────────────────────────────────
console.log("\nSéries réelles :");
const series = seriesReellesChantier({
  finance, pointages, commandeLignes, etatsFinanciers, chantierNom: "TEST - LOT 1",
});

// Dépenses. Attendu : mai = MO 320 + sans-date MO (200 reprise + 400 legacy +
// 90 pointage non daté) + mat 500 + 100 sans date = 1610 ; juin = 160 + 30.
const dep = series.depenses;
check("dépenses renseignées", dep.renseigne, true);
check("dépenses : 2 mois", dep.points.length, 2);
check("dépenses : mois 1 = 2026-05", dep.points[0]?.mois, "2026-05");
check("dépenses : cumul mai", dep.points[0]?.cumul, 1610);
check("dépenses : cumul final", dep.points[1]?.cumul, 1800);
check("sansDate.reprise", dep.sansDate.reprise, 200);
check("sansDate.moLegacy", dep.sansDate.moLegacy, 400);
check("sansDate.pointagesNonDates", dep.sansDate.pointagesNonDates, 90);
check("sansDate.materiauxNonDates", dep.sansDate.materiauxNonDates, 100);
check("sources dates : date_doc", dep.sourcesDates.date_doc, 1);
check("sources dates : repli created_at", dep.sourcesDates.commande_created_at, 1);
check("sources dates : sans date", dep.sourcesDates.sans_date, 1);

// LE critère d'acceptation : cumul final == totaux chantierFinance AU CENTIME.
check("CONTRÔLE AU CENTIME : ok", dep.controle.ok, true);
check("CONTRÔLE : MO série = module", dep.controle.moSerie, finance.brut.coutMOTotalChantier);
check("CONTRÔLE : mat série = module", dep.controle.matSerie, finance.brut.coutMatChantier);
check("CONTRÔLE : cumul final = MO + mat module", dep.points[1]?.cumul,
  finance.brut.coutMOTotalChantier + finance.brut.coutMatChantier);

// Recettes : avril 3000 ; mai (corrigée) 4500 + 1000 = 5500 ; juin 7000 + report 1000 = 8000.
const rec = series.recettes;
check("recettes renseignées", rec.renseigne, true);
check("recettes : 2 lignes agrégées", series.appariement.lignes.length, 2);
check("recettes : avril", rec.points.find(p => p.mois === "2026-04")?.cumul, 3000);
check("recettes : mai (corrigée, pas la brute)", rec.points.find(p => p.mois === "2026-05")?.cumul, 5500);
check("recettes : juin ('70' toléré + report lot 2)", rec.points.find(p => p.mois === "2026-06")?.cumul, 8000);

// Valeur générée : avril 4000 ; mai 5500 + 1500 = 7000 ; juin 8000 + 1500 = 9500.
const val = series.valeurGeneree;
check("valeur générée : avril", val.points.find(p => p.mois === "2026-04")?.cumul, 4000);
check("valeur générée : mai", val.points.find(p => p.mois === "2026-05")?.cumul, 7000);
check("valeur générée : juin", val.points.find(p => p.mois === "2026-06")?.cumul, 9500);

// Acompte : informatif, jamais sommé (0,1 × 10 000, seul r1 en a un).
check("acompte : montant informatif", series.acompte?.montant, 1000);
check("acompte : non intégré", series.acompte?.integreALaRecette, false);
check("warning acompte présent", series.warnings.some(w => w.code === "acompte_non_integre"), true);

// ── Non-apparié : signalé, jamais des zéros ──────────────────────────────────
console.log("\nNon-apparié :");
const inconnu = seriesEtatsFinanciers({ etatsFinanciers, chantierNom: "CHANTIER INCONNU" });
check("statut non_apparie", inconnu.appariement.statut, "non_apparie");
check("recettes non renseignées (pas 0)", inconnu.recettes.renseigne, false);
check("valeur non renseignée (pas 0)", inconnu.valeurGeneree.renseigne, false);
const sansEtats = seriesEtatsFinanciers({ etatsFinanciers: null, chantierNom: "TEST - LOT 1" });
check("aucun état : statut aucun_etat", sansEtats.appariement.statut, "aucun_etat");

// ── Sans-date NON replacé au premier mois (option) ──────────────────────────
console.log("\nOption placerSansDateAuPremierMois=false :");
const series2 = seriesReellesChantier({
  finance, pointages, commandeLignes, etatsFinanciers, chantierNom: "TEST - LOT 1",
  placerSansDateAuPremierMois: false,
});
check("cumul final hors sans-date", series2.depenses.points[1]?.cumul, 320 + 500 + 160 + 30);
check("contrôle toujours ok (sans-date compté à part)", series2.depenses.controle.ok, true);

// ═════════════════════════════════════════════════════════════════════════════
// SÉRIES PRÉVUES (Prompt 2)
// ═════════════════════════════════════════════════════════════════════════════
// vendu 15 000 €, 150 h vendues (140 réparties + 10 non réparties), taux 25 €/h
// → moPrev 3 750 €, matPrev 3 000 €. Signature au 2026-04-02 (cycle de vie).
const phasagePrev = {
  chantier_id: "test", chantier_nom: "TEST - LOT 1",
  plan_travaux: { meta: {
    cycle_vie_etapes: { devis_signe: { fait: true, date: "2026-04-05T09:00:00Z", donnees: { date: "2026-04-02" } } },
  } },
  ouvrages: [
    { id: "o1", libelle: "Ouvrage 1", prix_ht: 10000, heures_devis: 100, cout_materiaux: 2000, taches: [
      { id: "t1", nom: "Mai", heures_vendues: 40, date_prevue: "2026-05-10" },
      { id: "t2", nom: "Juin", heures_vendues: 40, date_prevue: "2026-06-20" },
      { id: "t3", nom: "Sans date", heures_vendues: 10, date_prevue: "" },
    ] },
    { id: "o2", libelle: "Ouvrage 2", prix_ht: 5000, heures_devis: 50, cout_materiaux: 1000, taches: [
      { id: "t4", nom: "Juin bis", heures_vendues: 50, date_prevue: "2026-06-05" },
    ] },
  ],
};
const financePrev = computeChantierFinance({ phasage: phasagePrev, pointages: [], commandeLignes: [], tauxHoraires, tauxMOPrev: 25, lots: [] });

console.log("\nSéries prévues :");
const prev = seriesPrevuesChantier({ finance: financePrev, phasage: phasagePrev, acomptePctDefaut: 30 });

// Dépenses prévues : mai = MO 1 000 (40 h) + mat o1 2 000 ; juin = MO 2 250
// (90 h) + mat o2 1 000. Non plaçable : t3 (250 €) + 10 h non réparties (250 €).
const dp = prev.depenses;
check("dépenses prévues renseignées", dp.renseigne, true);
check("dépenses prévues : cumul mai", dp.points.find(p => p.mois === "2026-05")?.cumul, 3000);
check("dépenses prévues : cumul final", dp.points.at(-1)?.cumul, 6250);
check("dépenses prévues : mat au démarrage de l'ouvrage", dp.points.find(p => p.mois === "2026-05")?.materiaux, 2000);
check("nonPlace : tâches non datées (250 €)", dp.nonPlace.moTachesNonDatees, 250);
check("nonPlace : heures non réparties (10 h)", dp.nonPlace.heuresNonReparties, 10);
check("CONTRÔLE PRÉVU : ok", dp.controle.ok, true);
check("CONTRÔLE PRÉVU : MO daté + non placé = moPrev", dp.controle.moSerie + dp.controle.moNonPlace, financePrev.brut.moPrevChantier);
check("CONTRÔLE PRÉVU : mat = matPrev", dp.controle.matSerie + dp.controle.matNonPlace, financePrev.brut.commandesPrevChantier);
check("tâches non datées listées à part", prev.tachesNonDatees.length, 1);
check("warning tâches non datées", prev.warnings.some(w => w.code === "taches_non_datees"), true);

// Valeur générée prévue : mai 40/150 × 15 000 = 4 000 ; juin 130/150 = 13 000.
const vp = prev.valeurGeneree;
check("valeur prévue : mai", vp.points.find(p => p.mois === "2026-05")?.cumul, 4000);
check("valeur prévue : juin", vp.points.find(p => p.mois === "2026-06")?.cumul, 13000);
check("valeur prévue : avancement final 130/150", vp.avancementPrevuFinal, 130 / 150);

// Recettes prévues : acompte 30 % (Admin) = 4 500 € au mois de SIGNATURE
// (avril), puis situations — mai clampé (4 000 < 4 500 déjà facturés), juin
// rattrape à 13 000 (formule situationAFacturerVal réutilisée).
const rp = prev.recettes;
check("recettes prévues renseignées", rp.renseigne, true);
check("recettes prévues : acompte au mois de signature", rp.points[0]?.mois, "2026-04");
check("recettes prévues : avril = acompte 4 500", rp.points.find(p => p.mois === "2026-04")?.cumul, 4500);
check("recettes prévues : mai clampé (pas de facture négative)", rp.points.find(p => p.mois === "2026-05")?.cumul, 4500);
check("recettes prévues : juin = 13 000", rp.points.find(p => p.mois === "2026-06")?.cumul, 13000);
check("acompte : source admin", rp.acompte?.source, "admin");
check("acompte : fraction 30 % tolérée", rp.acompte?.fraction, 0.3);
check("signature : date du cycle de vie", rp.acompte?.dateSignature, "2026-04-02");

// Priorité du % d'acompte : États financiers (0,1 sur TEST - LOT 1) > Admin.
const acEtats = resolutionAcomptePct({ etatsFinanciers, chantierNom: "TEST - LOT 1", meta: {}, acomptePctDefaut: 30 });
check("acompte : États financiers prioritaires", acEtats.fraction, 0.1);
check("acompte : source etats_financiers", acEtats.source, "etats_financiers");
const acChantier = resolutionAcomptePct({ etatsFinanciers: null, chantierNom: "X", meta: { acompte_pct: "0,25" }, acomptePctDefaut: 30 });
check("acompte : surcharge chantier > Admin", acChantier.fraction, 0.25);

// Sans date de signature : acompte posé au PREMIER mois planifié + signalé.
const phasageSansSign = { ...phasagePrev, plan_travaux: { meta: {} } };
const prevSansSign = seriesPrevuesChantier({
  finance: computeChantierFinance({ phasage: phasageSansSign, pointages: [], commandeLignes: [], tauxHoraires, tauxMOPrev: 25, lots: [] }),
  phasage: phasageSansSign, acomptePctDefaut: 30,
});
check("signature absente : acompte au 1er mois planifié", prevSansSign.recettes.points[0]?.mois, "2026-05");
check("signature absente : signalé", prevSansSign.recettes.acompte?.placeAuPremierMoisFauteDeSignature, true);
check("signature absente : warning", prevSansSign.warnings.some(w => w.code === "signature_absente"), true);
check("dateSignatureChantier : null si rien", dateSignatureChantier({}), null);

// ═════════════════════════════════════════════════════════════════════════════
// RÉCAPITULATIF DE PRISE DE RÉFÉRENCE (Prompt 3)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\nRécapitulatif de référence :");
const recap = recapReference(prev, financePrev);
check("recap : vendu HT", recap.venduHT, 15000);
check("recap : dépenses placées", recap.depensesPrevuesPlacees, 6250);
check("recap : dépenses non plaçables (250 + 250)", recap.depensesNonPlacees, 500);
check("recap : recettes finales", recap.recettesFinales, 13000);
check("recap : valeur générée finale", recap.valeurGenereeFinale, 13000);
check("recap : période avril → juin", `${recap.periode?.debut}→${recap.periode?.fin}`, "2026-04→2026-06");
check("recap : 1 tâche non datée signalée", recap.nbTachesNonDatees, 1);
check("recap : heures non datées", recap.heuresNonDatees, 10);
check("recap : référence marquée incomplète", recap.complete, false);

// Chantier entièrement daté et réparti → référence complète.
const phasageComplet = {
  chantier_id: "ok", chantier_nom: "OK",
  plan_travaux: { meta: {} },
  ouvrages: [{ id: "o1", libelle: "O", prix_ht: 1000, heures_devis: 10, cout_materiaux: 0, taches: [
    { id: "t1", nom: "T", heures_vendues: 10, date_prevue: "2026-05-04" },
  ] }],
};
const recapComplet = recapReference(
  seriesPrevuesChantier({
    finance: computeChantierFinance({ phasage: phasageComplet, pointages: [], commandeLignes: [], tauxHoraires, tauxMOPrev: 25, lots: [] }),
    phasage: phasageComplet, acomptePctDefaut: null,
  }),
  computeChantierFinance({ phasage: phasageComplet, pointages: [], commandeLignes: [], tauxHoraires, tauxMOPrev: 25, lots: [] }),
);
check("recap complet : aucune tâche non datée", recapComplet.nbTachesNonDatees, 0);
check("recap complet : complete = true", recapComplet.complete, true);
check("recap complet : avancement prévu final 100 %", recapComplet.avancementPrevuFinal, 1);

console.log(`\nRésultat : ${ok} OK, ${ko} KO.`);
process.exit(ko > 0 ? 1 : 0);
