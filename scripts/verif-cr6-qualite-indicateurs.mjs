#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Vérification — CR-6E : trois indicateurs de la page « Qualité des comptes
// rendus » (module qualiteComptesRendusV1) :
//   1. états déclarés identiques au prévu (fiabilité du planning) ;
//   2. écarts « avancement incohérent » par ouvrier (même fonction que la
//      Validation, avancementIncoherentV1) ;
//   3. lignes du planning liées au phasage (même fonction que le Planning,
//      liaisonPlanningV1).
// DONNÉES FICTIVES DE TEST : ouvriers « Alice », « Bruno », chantiers « chA »
// (avec phasage) / « chZ » (sans phasage), tâches « t1 »… — rien ne vient de
// la base.
//
//   node scripts/verif-cr6-qualite-indicateurs.mjs
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  comparaisonPrevu, faitsComptesRendus, agreger, tendance, part, INDICATEURS_QUALITE, DEBUT_MESURE_PREVU,
  ecartsAvancementIncoherentPeriode, cellulesDeLOuvrier, liaisonPlanningParSemaine,
} from "../src/Renovation/qualiteComptesRendusV1.mjs";
import {
  ecartsAvancementIncoherentRapport, donneesTachesIncoherence, heuresJourParTache, avancementsQuantiteRapport,
  normaliserSeuilsAvancementIncoherent,
} from "../src/Renovation/avancementIncoherentV1.mjs";
import { tauxLiaisonPlanning, EXPLICATION_TAUX_LIAISON } from "../src/Renovation/liaisonPlanningV1.mjs";

let nbOk = 0;
const ok = (c, m) => { assert.ok(c, m); nbOk++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ind = (code) => INDICATEURS_QUALITE.find(i => i.code === code);

// ══ 1. États déclarés identiques au prévu ═══════════════════════════════════
const PT = { etat: "termine", avancement: 100, repere: "termine" };
const PC = (avancement, repere) => ({ etat: "en_cours", avancement, repere });
eq(comparaisonPrevu({ statut: "faite", prevu: PT }), { prevu: "termine", declare: "termine", identique: true, memeRepere: null },
  "terminée prévue, déclarée terminée : identique");
eq(comparaisonPrevu({ statut: "en_cours", avancement: "50", prevu: PC(48, "moitie") }),
  { prevu: "en_cours", declare: "en_cours", identique: true, memeRepere: true }, "en cours prévue « à moitié », déclarée à moitié : identique, même repère");
eq(comparaisonPrevu({ statut: "en_cours", avancement: "75", prevu: PC(30, "commence") }),
  { prevu: "en_cours", declare: "en_cours", identique: true, memeRepere: false }, "en cours prévue « commencé », déclarée presque finie : identique (même état), repère différent");
eq(comparaisonPrevu({ statut: "en_cours", avancement: "50", prevu: PT }).identique, false, "terminée prévue, déclarée en cours : différent");
eq(comparaisonPrevu({ statut: "non_faite", heures_reelles: 0, prevu: PC(50, "moitie") }),
  { prevu: "en_cours", declare: "pas_commence", identique: false, memeRepere: null }, "« Pas commencé » face à un prévu : différent");
eq(comparaisonPrevu({ statut: "en_cours", bloque: true, prevu: PT }).declare, "bloque", "« Bloqué » face à un prévu : différent");
eq(comparaisonPrevu({ statut: "faite" }), null, "ligne sans prévu (compte rendu antérieur au 26/10/2026) : exclue");
eq(comparaisonPrevu({ statut: "faite", prevu: { etat: "inconnu", avancement: null, repere: null } }), null, "prévu inconnu : exclu");
eq(comparaisonPrevu({ statut: null, prevu: PT }), null, "ligne sans état : exclue");
eq(DEBUT_MESURE_PREVU, "2026-10-26", "mesuré depuis le parcours unique du 26/10/2026");

const L = (o) => ({ planifie: "Tâche", heures_reelles: 1, ...o });
const R_PREVU = [
  { id: "p1", ouvrier: "Alice", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "2026-10-27", statut: "en_attente", formulaire_version: "v2",
    taches: [
      L({ tache_id: "x1", statut: "faite", avancement: 100, prevu: PT }),
      L({ tache_id: "x2", statut: "en_cours", avancement: "50", prevu: PC(50, "moitie") }),
      L({ tache_id: "x3", statut: "en_cours", avancement: "75", prevu: PC(25, "commence") }),
      L({ tache_id: "x4", statut: "en_cours", avancement: "50", prevu: PT }),
      L({ tache_id: "x5", statut: "non_faite", heures_reelles: 0, prevu: PC(40, "moitie") }),
      L({ tache_id: "x6", statut: "en_cours", bloque: true, prevu: PT }),
      L({ tache_id: "x7", statut: "faite", origine: "phasage" }),
      L({ tache_id: null, statut: "faite", prevu: { etat: "inconnu", avancement: null, repere: null } }),
    ] },
  { id: "p2", ouvrier: "Bruno", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "27/10/2026", statut: "en_attente", formulaire_version: "v2",
    taches: [L({ tache_id: "x1", statut: "faite", avancement: 100, prevu: PT }), L({ tache_id: "x8", statut: null, heures_reelles: 0, prevu: PT })] },
  // Compte rendu d'avant le parcours unique : aucune ligne mesurable.
  { id: "p0", ouvrier: "Alice", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "20/10/2026", statut: "valide",
    taches: [L({ tache_id: "x1", statut: "faite", avancement: 100 })] },
];
{
  const f = faitsComptesRendus({ rapports: R_PREVU, debut: "2026-10-26", fin: "2026-11-01" });
  const T = agreger(f);
  eq([T.prevuIdentique.n, T.prevuIdentique.d], [4, 7], "total : 4 identiques sur 7 lignes mesurables (sans prévu, prévu inconnu, sans état : exclues)");
  eq(T.prevuIdentique.detail, {
    termine: { termine: 2, en_cours: 1, pas_commence: 0, bloque: 1 },
    en_cours: { termine: 0, en_cours: 2, pas_commence: 1, bloque: 0 },
  }, "détail : terminée prévue → déclarée en cours / bloquée ; en cours prévue → pas commencée");
  eq([T.prevuIdentique.memeRepere.n, T.prevuIdentique.memeRepere.d], [1, 2], "en cours / en cours : même repère 1 fois sur 2");
  eq(ind("prevuIdentique").valeur(T), 57.1, "valeur : 57,1 %");
  eq([agreger(f, { ouvrier: "Alice" }).prevuIdentique.n, agreger(f, { ouvrier: "Alice" }).prevuIdentique.d], [3, 6], "Alice : 3 sur 6");
  eq([agreger(f, { ouvrier: "Bruno" }).prevuIdentique.n, agreger(f, { ouvrier: "Bruno" }).prevuIdentique.d], [1, 1], "Bruno : 1 sur 1");
  const avant = agreger(faitsComptesRendus({ rapports: R_PREVU, debut: "2026-10-19", fin: "2026-10-25" }));
  eq(avant.rapports, 1, "période d'avant : un compte rendu…");
  eq(avant.prevuIdentique.taux, null, "… sans prévu mémorisé : taux null (« — »)");
  ok(ind("prevuIdentique").valeur(avant) === null, "période sans ligne mesurable : valeur null, jamais 0");
  ok(ind("prevuIdentique").valeur(agreger(faitsComptesRendus({ rapports: [] }))) === null, "aucun compte rendu : valeur null, jamais 0");
}

// ══ 2. Écarts « avancement incohérent » ════════════════════════════════════
const ouvrages = [{ id: "o1", taches: [
  { id: "t1", nom: "Bandes chambre", heures_vendues: 10, avancement: 100 },
  { id: "t2", nom: "Enduit séjour", heures_vendues: 10, avancement: 75 },
  { id: "t3", nom: "Faïence douche", heures_vendues: 10, avancement: 60 },
] }];
const PHASAGES = [{ chantier_id: "chA", ouvrages }, { chantier_id: "chZ", ouvrages: [] }];
const JOURNAL = [
  { chantier_id: "chA", tache_id: "t1", avancement_avant: 0, avancement_apres: 30, date_realisation: "2026-10-19", created_at: "2026-10-19T18:00:00Z" },
  { chantier_id: "chA", tache_id: "t2", avancement_avant: 0, avancement_apres: 50, date_realisation: "2026-10-20", created_at: "2026-10-20T18:00:00Z" },
  { chantier_id: "chA", tache_id: "t3", avancement_avant: 60, avancement_apres: 100, date_realisation: "2026-10-18", created_at: "2026-10-18T18:00:00Z" },
];
const POINTAGES = [
  { chantier_id: "chA", tache_id: "t2", heures: 5, type_pointage: "tache", date: "2026-10-20" },
  { chantier_id: "chA", tache_id: "t3", heures: 12, type_pointage: "tache", date: "2026-10-18" },
];
const J = "2026-10-21";
const rA = { id: "rA", ouvrier: "Alice", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: J, statut: "en_attente",
  taches: [{ tache_id: "t1", planifie: "Bandes chambre", statut: "faite", avancement: 100, heures_reelles: 2 }] };
const rB = { id: "rB", ouvrier: "Bruno", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "21/10/2026", statut: "valide",
  taches: [
    { tache_id: "t2", planifie: "Enduit séjour", statut: "en_cours", avancement: 75, heures_reelles: 0 },
    { tache_id: "t3", planifie: "Faïence douche", statut: "en_cours", avancement: 60, heures_reelles: 3 },
  ] };
const rZ = { id: "rZ", ouvrier: "Alice", chantier_id: "chZ", chantier_nom: "Chantier Z", date_rapport: J, statut: "en_attente",
  taches: [{ tache_id: "z1", planifie: "Démolition", statut: "faite", avancement: 100, heures_reelles: 5 }] };
const rP = { id: "rP", ouvrier: "Alice", chantier_id: "chA", chantier_nom: "Chantier A", date_rapport: "2026-10-14", statut: "valide",
  taches: [{ tache_id: "t2", planifie: "Enduit séjour", statut: "en_cours", avancement: 20, heures_reelles: 2 }] };
const RAPPORTS = [rA, rB, rZ, rP];

// Ce que la Validation calcule pour un compte rendu (Validation.jsx : mêmes sources).
const commeLaValidation = (r, seuils = null) => {
  const date = r.date_rapport.includes("/") ? r.date_rapport.split("/").reverse().join("-") : r.date_rapport;
  const pointagesAvant = POINTAGES.filter(p => p.chantier_id === r.chantier_id && p.date < date);
  const duJour = RAPPORTS.filter(x => x.chantier_id === r.chantier_id
    && (x.date_rapport.includes("/") ? x.date_rapport.split("/").reverse().join("-") : x.date_rapport) === date);
  return ecartsAvancementIncoherentRapport(r, {
    seuils: normaliserSeuilsAvancementIncoherent(seuils),
    donneesParTache: donneesTachesIncoherence({ ouvrages, date, journal: JOURNAL.filter(l => l.chantier_id === r.chantier_id), pointagesAvant }),
    heuresJourParTache: heuresJourParTache(duJour),
    avancementDeclareParTache: avancementsQuantiteRapport({ rapport: r, ouvrages, pointagesAvant, date }),
  });
};
{
  const periode = ecartsAvancementIncoherentPeriode({ rapports: RAPPORTS, phasages: PHASAGES, pointages: POINTAGES, journal: JOURNAL });
  eq(periode.parRapport.rA, commeLaValidation(rA), "rA : même résultat que la fonction de la Validation appelée directement");
  eq(periode.parRapport.rB, commeLaValidation(rB), "rB : même résultat que la fonction de la Validation appelée directement");
  eq(periode.parRapport.rP, commeLaValidation(rP), "rP : même résultat que la fonction de la Validation appelée directement");
  eq(periode.parRapport.rA.map(e => e.cas), [[1]], "cas 1 : « Bandes chambre » terminée avec 2 h pour 10 h prévues");
  eq(periode.parRapport.rB.map(e => e.cas), [[2], [3]], "cas 2 (+25 points sans heure) et cas 3 (terminée qui revient en cours)");
  eq(periode.parRapport.rP, [], "rP : contrôlé, aucun écart");
  ok(!("rZ" in periode.parRapport), "chantier sans phasage : compte rendu non contrôlé (comme à la Validation)");
  eq(periode.seuils, normaliserSeuilsAvancementIncoherent(null), "seuils jamais réglés : valeurs par défaut");

  const f = faitsComptesRendus({ rapports: RAPPORTS, avancementIncoherent: periode, debut: "2026-10-19", fin: "2026-10-25" });
  const T = agreger(f);
  eq([T.avancementIncoherent.n, T.avancementIncoherent.rapportsControles, T.avancementIncoherent.rapportsNonControles, T.avancementIncoherent.rapportsAvecEcart],
    [3, 2, 1, 2], "total : 3 écarts sur 2 comptes rendus contrôlés, 1 non contrôlable");
  eq(T.avancementIncoherent.parCas, { 1: 1, 2: 1, 3: 1 }, "détail par cas");
  eq(T.avancementIncoherent.liste.map(e => e.texte), [...commeLaValidation(rA), ...commeLaValidation(rB)].map(e => e.texte),
    "liste : les textes de la Validation, mot pour mot");
  eq(T.avancementIncoherent.liste.map(e => [e.date, e.ouvrier, e.chantierNom]),
    [[J, "Alice", "Chantier A"], [J, "Bruno", "Chantier A"], [J, "Bruno", "Chantier A"]], "liste : date, ouvrier, chantier");
  const A = agreger(f, { ouvrier: "Alice" }), B = agreger(f, { ouvrier: "Bruno" });
  eq([A.avancementIncoherent.n, A.avancementIncoherent.parCas], [1, { 1: 1, 2: 0, 3: 0 }], "Alice : 1 écart (cas 1)");
  eq([B.avancementIncoherent.n, B.avancementIncoherent.parCas], [2, { 1: 0, 2: 1, 3: 1 }], "Bruno : 2 écarts (cas 2 et 3)");
  eq([ind("avancementIncoherent").valeur(T), ind("avancementIncoherent").valeur(A), ind("avancementIncoherent").valeur(B)], [3, 1, 2], "valeurs du catalogue");

  const prec = agreger(faitsComptesRendus({ rapports: RAPPORTS, avancementIncoherent: periode, debut: "2026-10-12", fin: "2026-10-18" }));
  eq([prec.avancementIncoherent.n, prec.avancementIncoherent.rapportsControles], [0, 1], "période d'avant : 1 compte rendu contrôlé, 0 écart");
  eq(ind("avancementIncoherent").valeur(prec), 0, "0 écart sur des comptes rendus contrôlés : 0 (une vraie mesure)");
  eq(tendance("avancementIncoherent", T, prec), { courant: 3, precedent: 0, delta: 3, sens: "moins_bien" }, "tendance : plus d'écarts = moins bien");
  eq(tendance("avancementIncoherent", prec, T).sens, "mieux", "tendance : moins d'écarts = mieux");

  const vide = agreger(faitsComptesRendus({ rapports: RAPPORTS, avancementIncoherent: periode, debut: "2026-11-02", fin: "2026-11-08" }));
  ok(ind("avancementIncoherent").valeur(vide) === null, "période sans compte rendu : valeur null (« — »), jamais 0");
  const seulZ = agreger(faitsComptesRendus({ rapports: [rZ], avancementIncoherent: ecartsAvancementIncoherentPeriode({ rapports: [rZ], phasages: PHASAGES, pointages: POINTAGES, journal: JOURNAL }) }));
  eq([seulZ.avancementIncoherent.rapportsControles, ind("avancementIncoherent").valeur(seulZ)], [0, null], "seulement des chantiers sans phasage : rien de contrôlé, valeur null");

  // Seuils réglés dans Admin : respectés (même normalisation que la Validation).
  const reglee = ecartsAvancementIncoherentPeriode({ rapports: RAPPORTS, phasages: PHASAGES, pointages: POINTAGES, journal: JOURNAL, seuils: { ratioHeuresMin: 0.1 } });
  eq(reglee.parRapport.rA, commeLaValidation(rA, { ratioHeuresMin: 0.1 }), "seuils réglés : même résultat que la Validation");
  eq(reglee.parRapport.rA, [], "rapport 0,2 au-dessus d'un seuil réglé à 0,1 : plus d'écart");

  // Source illisible : indisponible, jamais 0.
  for (const k of ["phasages", "pointages", "journal"]) {
    eq(ecartsAvancementIncoherentPeriode({ rapports: RAPPORTS, phasages: PHASAGES, pointages: POINTAGES, journal: JOURNAL, [k]: null }), null, `${k} illisibles : pas de calcul`);
  }
  const sans = agreger(faitsComptesRendus({ rapports: RAPPORTS, debut: "2026-10-19", fin: "2026-10-25" }));
  ok(typeof sans.avancementIncoherent.indisponible === "string" && sans.avancementIncoherent.indisponible.length > 0, "sans calcul : « indisponible » avec sa raison");
  ok(ind("avancementIncoherent").valeur(sans) === null, "indisponible : valeur null, jamais 0");
}

// ══ 3. Lignes du planning liées au phasage ═════════════════════════════════
const CELLULES = [
  { week_id: "2026-W42", jour: "Lundi", chantier_id: "chA", ouvriers: ["Alice"], taches: [{ text: "Enduit séjour", tache_id: "t2", ouvriers: ["Alice"] }] },
  { week_id: "2026-W43", jour: "Lundi", chantier_id: "chA", ouvriers: ["Alice", "Bruno"], taches: [
    { text: "Bandes chambre", tache_id: "t1", ouvriers: ["Alice"] },
    { text: "Enduit cuisine", ouvriers: ["Bruno"] },
    { text: "Congé", ouvriers: ["Bruno"] },
  ] },
  { week_id: "2026-W43", jour: "Mardi", chantier_id: "chB", ouvriers: ["Alice"], taches: [], planifie: "Ponçage\nPeinture" },
  { week_id: "2026-W44", jour: "Lundi", chantier_id: "chA", ouvriers: ["Bruno"], taches: [{ text: "Faïence douche", tache_id: "t3" }] },
];
const sansParSemaine = ({ parSemaine, ouvrier, ...x }) => x;
{
  const f = faitsComptesRendus({ rapports: R_PREVU, cellulesPlanning: CELLULES, debut: "2026-10-19", fin: "2026-10-25" });
  const T = agreger(f);
  const attendu = tauxLiaisonPlanning(CELLULES.filter(c => c.week_id === "2026-W43"));
  eq(sansParSemaine(T.liaisonPlanning), attendu, "total : même résultat que tauxLiaisonPlanning sur les semaines de la période");
  eq([T.liaisonPlanning.pourcent, T.liaisonPlanning.liees, T.liaisonPlanning.comptees, T.liaisonPlanning.libres], [25, 1, 4, 1],
    "1 liée sur 4 (la ligne « Congé » libre n'est pas comptée)");
  eq(ind("liaisonPlanning").valeur(T), 25, "valeur : 25 %");
  eq(T.liaisonPlanning.parSemaine.map(s => [s.weekId, s.pourcent]), [["2026-W43", 25]], "détail par semaine");

  // Par ouvrier : les lignes où il est prévu (équipe de la ligne, sinon de la case).
  const A = agreger(f, { ouvrier: "Alice" }), B = agreger(f, { ouvrier: "Bruno" });
  eq(sansParSemaine(A.liaisonPlanning), tauxLiaisonPlanning([
    { ...CELLULES[1], taches: [CELLULES[1].taches[0]], planifie: "" },
    { ...CELLULES[2], taches: [{ text: "Ponçage" }, { text: "Peinture" }], planifie: "" },
  ]), "Alice : même résultat que tauxLiaisonPlanning sur ses lignes (équipe de la case pour l'ancien texte)");
  eq([A.liaisonPlanning.liees, A.liaisonPlanning.comptees], [1, 3], "Alice : 1 liée sur 3");
  eq([B.liaisonPlanning.liees, B.liaisonPlanning.comptees, B.liaisonPlanning.libres], [0, 1, 1], "Bruno : 0 liée sur 1, son congé non compté");
  eq(cellulesDeLOuvrier(CELLULES, "alice").length, cellulesDeLOuvrier(CELLULES, "Alice").length, "nom comparé sans la casse");

  // Deux semaines.
  const deux = agreger(faitsComptesRendus({ rapports: [], cellulesPlanning: CELLULES, debut: "2026-10-19", fin: "2026-11-01" }));
  eq(sansParSemaine(deux.liaisonPlanning), tauxLiaisonPlanning(CELLULES.filter(c => c.week_id >= "2026-W43")), "deux semaines : toutes les lignes des deux");
  eq(deux.liaisonPlanning.parSemaine.map(s => [s.weekId, s.pourcent]), [["2026-W43", 25], ["2026-W44", 100]], "détail : une ligne par semaine");
  eq(liaisonPlanningParSemaine(CELLULES, ["2026-W44"]).map(s => s.pourcent), [100], "semaines demandées seulement");

  // Semaine sans ligne : « aucune ligne », jamais 0 % ni 100 %.
  const rien = agreger(faitsComptesRendus({ rapports: [], cellulesPlanning: CELLULES, debut: "2026-11-02", fin: "2026-11-08" }));
  eq([rien.liaisonPlanning.pourcent, rien.liaisonPlanning.libelle], [null, "aucune ligne"], "semaine sans ligne : « aucune ligne »");
  ok(ind("liaisonPlanning").valeur(rien) === null, "semaine sans ligne : valeur null, jamais 0");
  eq(rien.liaisonPlanning.parSemaine.map(s => [s.weekId, s.pourcent]), [["2026-W45", null]], "la semaine vide apparaît quand même");

  // Planning illisible : indisponible.
  const sans = agreger(faitsComptesRendus({ rapports: R_PREVU, debut: "2026-10-19", fin: "2026-10-25" }));
  ok(typeof sans.liaisonPlanning.indisponible === "string" && sans.liaisonPlanning.indisponible.length > 0, "planning non lu : « indisponible » avec sa raison");
  ok(ind("liaisonPlanning").valeur(sans) === null, "planning non lu : valeur null, jamais 0");

  // Tendance.
  const prec = agreger(faitsComptesRendus({ rapports: [], cellulesPlanning: CELLULES, debut: "2026-10-12", fin: "2026-10-18" }));
  eq(tendance("liaisonPlanning", T, prec), { courant: 25, precedent: 100, delta: -75, sens: "moins_bien" }, "tendance : moins de lignes liées = moins bien");
  eq(tendance("liaisonPlanning", prec, T).sens, "mieux", "tendance : plus de lignes liées = mieux");
  eq(tendance("liaisonPlanning", rien, T).delta, null, "tendance : pas de mesure, pas de flèche");
}

// ══ Tendance de la part identique au prévu ═════════════════════════════════
eq(tendance("prevuIdentique", { prevuIdentique: part(3, 4) }, { prevuIdentique: part(1, 2) }), { courant: 75, precedent: 50, delta: 25, sens: "mieux" },
  "plus d'états identiques au prévu = planning plus fiable");
eq(tendance("prevuIdentique", { prevuIdentique: part(1, 2) }, { prevuIdentique: part(3, 4) }).sens, "moins_bien", "moins d'états identiques = moins bien");
eq(tendance("prevuIdentique", { prevuIdentique: part(1, 2) }, { prevuIdentique: part(0, 0) }).delta, null, "période précédente sans mesure : pas de flèche");

// ══ Catalogue : même libellé, même explication partout ═════════════════════
for (const code of ["prevuIdentique", "avancementIncoherent", "liaisonPlanning"]) {
  const i = ind(code);
  ok(i && i.libelle && i.explication && typeof i.valeur === "function", `${code} : au catalogue, avec libellé, explication et valeur`);
}
eq(ind("liaisonPlanning").explication, EXPLICATION_TAUX_LIAISON, "explication du taux du planning : celle du Planning, mot pour mot");
ok(/planning/i.test(ind("prevuIdentique").explication) && /pas le travail de l'ouvrier/.test(ind("prevuIdentique").explication),
  "part identique au prévu : expliquée comme un indicateur du planning, pas une faute de l'ouvrier");
ok(ind("prevuIdentique").explication.includes("26/10/2026"), "part identique au prévu : « mesuré depuis le parcours unique du 26/10/2026 »");
ok(/même règle et les mêmes seuils/.test(ind("avancementIncoherent").explication), "écarts : même règle et mêmes seuils que la Validation");
eq(new Set(INDICATEURS_QUALITE.map(i => i.libelle)).size, INDICATEURS_QUALITE.length, "libellés uniques");
eq(new Set(INDICATEURS_QUALITE.map(i => i.explication)).size, INDICATEURS_QUALITE.length, "explications uniques");
eq(new Set(INDICATEURS_QUALITE.map(i => i.code)).size, INDICATEURS_QUALITE.length, "codes uniques");

console.log(`verif-cr6-qualite-indicateurs : ${nbOk} contrôles OK (données fictives)`);
