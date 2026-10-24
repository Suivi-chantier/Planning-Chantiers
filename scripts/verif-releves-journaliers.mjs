// Vérification de l'étape 1D (refonte du Bilan semaine) : relevés journaliers.
//
// Exemple issu des tests, données fictives : chantier, ouvriers, absences,
// comptes rendus et montants sont inventés pour le calcul.
//
//   1. module pur (src/Renovation/releveJournalier.mjs) : comptes rendus
//      attendus (planning, absences, jours non travaillés), statut de
//      complétude, état du chantier en fin de journée, jours à recalculer ;
//   2. calcul serveur de bout en bout (api/_partage/relevesJournaliers.js) sur
//      une base simulée en mémoire : recalcul après écriture, cascade,
//      rattrapage de nuit idempotent ;
//   3. migration, horaires des crons, gardes sur le code.
//
//   node scripts/verif-releves-journaliers.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as rj from "../src/Renovation/releveJournalier.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const require = createRequire(import.meta.url);
let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(a != null && Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`); nb++; };

// ── 1. MODULE ───────────────────────────────────────────────────────────────
// Semaine du 19/10/2026 (W43) : 4 jours de 9h45, vendredi non travaillé.
ok(JSON.stringify(rj.semaineEtJour("2026-10-20")) === JSON.stringify({ weekId: "2026-W43", jour: "Mardi" }), "mardi 20/10 = W43, Mardi");
ok(rj.semaineEtJour("2026-10-24").jour === null, "samedi : pas de jour de planning");
ok(rj.dateRapportISO("20/10/2026") === "2026-10-20" && rj.dateRapportISO("2026-10-20") === "2026-10-20", "deux formats de date de rapport");

const CELLULES = [
  { week_id: "2026-W43", jour: "Mardi", chantier_id: "C1", ouvriers: ["Ouvrier A", "Ouvrier B", "Ouvrier C", "Ouvrier D"] },
  { week_id: "2026-W43", jour: "Vendredi", chantier_id: "C1", ouvriers: ["Ouvrier A"] },
  { week_id: "2026-W43", jour: "Mardi", chantier_id: "C2", ouvriers: ["Ouvrier E"] },
];
const ABSENCES = {
  ok: true, exceptions: {},
  ressources: [{ id: "rA", nom_planning: "Ouvrier A" }, { id: "rB", nom_planning: "Ouvrier B" }, { id: "rC", nom_planning: "Ouvrier C" }, { id: "rD", nom_planning: "Ouvrier D" }],
  evenements: [
    { id: "e1", resource_id: "rC", type: "absence", date_debut: "2026-10-20", date_fin: "2026-10-20", toute_journee: true, heures_indisponibles: null, actif: true },
    { id: "e2", resource_id: "rD", type: "absence", date_debut: "2026-10-20", date_fin: "2026-10-20", toute_journee: false, heures_indisponibles: 4, actif: true },
  ],
};
const RAPPORTS = [
  { ouvrier: "Ouvrier A", chantier_id: "C1", date_rapport: "20/10/2026", statut: "valide" },
  { ouvrier: "ouvrier b", chantier_id: "C1", date_rapport: "2026-10-20", statut: "en_attente" },
];

// 1a. Une journée avec un compte rendu manquant → incomplete.
{
  const c = rj.comptesRendusAttendus({ chantierId: "C1", dateISO: "2026-10-20", cellules: CELLULES, rapports: RAPPORTS, absences: ABSENCES });
  ok(c.statut === "incomplete", "compte rendu manquant : incomplete");
  const st = Object.fromEntries(c.attendus.map(a => [a.ouvrier, a.statut]));
  ok(st["Ouvrier A"] === "valide", "A : validé");
  ok(st["Ouvrier B"] === "non_valide", "B : présent mais pas validé (nom insensible à la casse)");
  ok(!("Ouvrier C" in st) && c.exclus.some(x => x.ouvrier === "Ouvrier C"), "C absent toute la journée : non attendu");
  ok(st["Ouvrier D"] === "manquant", "D absent une demi-journée : attendu, et manquant");
  ok(c.manquants.length === 2, "B et D dans la liste des manquants");
}
// 1b. Tout validé → complete.
{
  const tous = [...RAPPORTS.slice(0, 1), { ouvrier: "Ouvrier B", chantier_id: "C1", date_rapport: "20/10/2026", statut: "valide" },
    { ouvrier: "Ouvrier D", chantier_id: "C1", date_rapport: "20/10/2026", statut: "valide" }];
  ok(rj.comptesRendusAttendus({ chantierId: "C1", dateISO: "2026-10-20", cellules: CELLULES, rapports: tous, absences: ABSENCES }).statut === "complete", "tous validés : complete");
}
// 1c. Vendredi non travaillé (semaine de 4 jours) : personne n'est attendu.
{
  const c = rj.comptesRendusAttendus({ chantierId: "C1", dateISO: "2026-10-23", cellules: CELLULES, rapports: [], absences: ABSENCES });
  ok(c.attendus.length === 0 && c.statut === "complete" && c.exclus.length === 1, "vendredi à 0 h : aucun attendu, l'exclusion est tracée");
}
// 1d. Personne de planifié : complet, mais 0 attendu (un jour vide ≠ un jour vérifié).
{
  const c = rj.comptesRendusAttendus({ chantierId: "C9", dateISO: "2026-10-20", cellules: CELLULES, rapports: [], absences: ABSENCES });
  ok(c.statut === "complete" && c.attendus.length === 0, "rien de planifié : 0 attendu");
}

// 1e. État en fin de journée D : pointages, commandes et avancement arrêtés à D.
const PHASAGE = {
  id: "ph1", chantier_id: "C1", chantier_nom: "Chantier fictif", plan_travaux: { meta: {} },
  ouvrages: [{ id: "o1", lot_id: "l1", prix_ht: 20000, cout_materiaux: 2000, heures_devis: 40,
    taches: [{ id: "t1", avancement: 60, heures_estimees: 40 }] }],
};
const JOURNAL = [
  { tache_id: "t1", avancement_avant: null, avancement_apres: 10, date_realisation: "2026-10-12", created_at: "2026-10-12T20:00:00Z" },
  { tache_id: "t1", avancement_avant: 10, avancement_apres: 40, date_realisation: "2026-10-20", created_at: "2026-10-22T17:00:00Z" },
  { tache_id: "t1", avancement_avant: 40, avancement_apres: 60, date_realisation: "2026-10-22", created_at: "2026-10-22T18:00:00Z" },
];
const INPUTS = {
  phasage: PHASAGE,
  pointages: [
    { date: "2026-10-20", heures: 8, taux_horaire: 30, tache_id: "t1", ouvrier: "Ouvrier A" },
    { date: "2026-10-22", heures: 8, taux_horaire: 30, tache_id: "t1", ouvrier: "Ouvrier A" },
  ],
  commandeLignes: [
    { prix_total: 500, lot_id: "l1", created_at: "2026-10-25T09:00:00Z", commande: { date_doc: "2026-10-19" } },
    { prix_total: 300, lot_id: "l1", created_at: "2026-10-21T09:00:00Z" },
  ],
  tauxHoraires: {}, tauxMOPrev: 25, lots: [{ id: "l1", label: "Lot fictif" }],
  tauxFG: [{ depuis: "2026-01-01", taux: 10 }],
};
{
  const ligne = rj.ligneReleve({ inputs: INPUTS, journal: JOURNAL, dateISO: "2026-10-20",
    completude: rj.comptesRendusAttendus({ chantierId: "C1", dateISO: "2026-10-20", cellules: CELLULES, rapports: RAPPORTS, absences: ABSENCES }),
    calculeLe: "2026-10-22T18:30:00Z" });
  ok(ligne.avancement === 40, "avancement en fin de journée du 20/10 = 40 % (journal)");
  proche(ligne.mo_reel, 240, "main-d'œuvre arrêtée au 20/10 (le pointage du 22 n'y est pas)");
  proche(ligne.mat_reel, 500, "matériaux imputés au 20/10 (document du 19 compté, saisie du 21 non)");
  proche(ligne.fg, 80, "frais généraux des heures ≤ 20/10");
  proche(ligne.reste_a_commander, 1500, "reste à commander à cette date (enveloppe 2 000 − 500)");
  ok(ligne.statut_completude === "incomplete" && ligne.cr_manquants.length === 2, "complétude et manquants enregistrés");
  ok(ligne.week_id === "2026-W43" && ligne.date_releve === "2026-10-20" && ligne.calcule_le === "2026-10-22T18:30:00Z", "semaine, date, heure de calcul");
  // Avant le début du journal : avancement INCONNU, jamais un chiffre faux.
  const journalInitial = [{ tache_id: "t1", avancement_avant: null, avancement_apres: 60, date_realisation: "2026-10-26", created_at: "2026-10-26T08:00:00Z", source: "initial" }];
  const avant = rj.ligneReleve({ inputs: INPUTS, journal: journalInitial, dateISO: "2026-10-15", completude: { statut: "complete", attendus: [], manquants: [] } });
  ok(avant.avancement === null && avant.marge_terminaison === null && avant.warnings.some(w => w.code === "avancement_inconnu"), "jour antérieur au journal : avancement inconnu, dit");
  // Mêmes colonnes que le relevé hebdomadaire.
  const sqlHebdo = lire("sql/chantier_snapshots_hebdo.sql");
  const colsHebdo = [...sqlHebdo.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|date|numeric|jsonb|timestamptz)/gm)].map(m => m[1])
    .filter(c => !["id", "created_at", "date_snapshot"].includes(c));
  const manque = colsHebdo.filter(c => !(c in ligne));
  ok(colsHebdo.length >= 20 && manque.length === 0, `toutes les colonnes du relevé hebdomadaire (manquantes : ${manque.join(", ")})`);
}
// 1f. Jours à recalculer : le jour touché + les relevés suivants déjà écrits.
ok(rj.joursARecalculer({ dateChangee: "2026-10-20", joursExistants: ["2026-10-19", "2026-10-21", "2026-10-22", "2026-10-30"], aujourdhui: "2026-10-22" }).join()
  === "2026-10-20,2026-10-21,2026-10-22", "cascade : 20 (touché), 21 et 22 (dépendants), pas le 19 ni le futur");
ok(rj.dateMinMouvements({ jour: "2026-10-22", journal: JOURNAL, pointages: [], commandeLignes: [] }) === "2026-10-20",
  "mouvements du jour : le compte rendu du mardi validé jeudi fait repartir du mardi");

// ── 2. SERVEUR DE BOUT EN BOUT (base simulée) ───────────────────────────────
function baseSimulee(tables) {
  const enregistrees = tables;
  return {
    tables: enregistrees,
    from(nom) {
      const lignes = () => enregistrees[nom] || [];
      const filtres = [];
      let debut = 0, fin = Infinity, unique = false;
      const q = {
        select() { return q; },
        eq(col, v) { if (!col.includes(".")) filtres.push(r => String(r[col]) === String(v)); return q; },
        order() { return q; },
        range(a, b) { debut = a; fin = b; return q; },
        maybeSingle() { unique = true; return q; },
        upsert(rows, { onConflict }) {
          const cles = onConflict.split(",");
          const t = (enregistrees[nom] ||= []);
          rows.forEach(r => {
            const i = t.findIndex(x => cles.every(k => String(x[k]) === String(r[k])));
            if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ id: `id-${t.length + 1}`, ...r });
          });
          return Promise.resolve({ error: null });
        },
        then(resolve) {
          const data = lignes().filter(r => filtres.every(f => f(r)));
          if (unique) return resolve({ data: data[0] || null, error: null });
          return resolve({ data: data.slice(debut, fin === Infinity ? undefined : fin + 1), error: null });
        },
      };
      return q;
    },
  };
}
{
  const { recalculerApresEcriture, rattrapageDeNuit } = require("../api/_partage/relevesJournaliers.js");
  const tables = {
    phasages: [PHASAGE],
    pointages: INPUTS.pointages.map((p, i) => ({ id: `p${i}`, chantier_id: "C1", created_at: `${p.date}T19:00:00Z`, ...p })),
    commande_lignes: INPUTS.commandeLignes.map((l, i) => ({ id: `l${i}`, chantier_id: "C1", ...l })),
    facture_couts_chantiers: [], avoirs_fournisseurs_imputations: [], materiaux_bibliotheque: [], achats_lots_termines: [],
    planning_config: [{ key: "fg_taux_horaires", value: INPUTS.tauxFG }, { key: "taux_mo_previsionnel", value: 25 }, { key: "lots_travaux", value: { items: [{ id: "l1", label: "Lot fictif" }] } }],
    avancement_journal: JOURNAL.map((l, i) => ({ id: `j${i}`, chantier_id: "C1", ...l })),
    planning_cells: CELLULES, rapports: RAPPORTS.map((r, i) => ({ id: `r${i}`, ...r })),
    planning_resources: ABSENCES.ressources, planning_resource_events: ABSENCES.evenements,
    chantier_releves_journaliers: [{ id: "x1", chantier_id: "C1", date_releve: "2026-10-21" }],
  };
  // planning_config : maybeSingle par clé.
  const base = baseSimulee(tables);
  const fromOrig = base.from.bind(base);
  base.from = (nom) => {
    if (nom !== "planning_config") return fromOrig(nom);
    const q = fromOrig(nom); const eqOrig = q.eq;
    q.eq = (col, v) => eqOrig(col, v);
    return q;
  };
  const maintenant = new Date("2026-10-22T17:30:00Z"); // jeudi 19h30 Paris
  const r = await recalculerApresEcriture(base, rj, { chantierId: "C1", date: "2026-10-20", maintenant });
  ok(r.ecrits === 2 && r.jours.join() === "2026-10-20,2026-10-21", `jour touché + relevé suivant déjà enregistré (${r.jours})`);
  const rel = (d) => tables.chantier_releves_journaliers.find(x => x.date_releve === d);
  ok(rel("2026-10-20").avancement === 40 && rel("2026-10-21").avancement === 40, "chaque jour a SON avancement de fin de journée (le 60 % est daté du 22)");
  ok(!rel("2026-10-22"), "le relevé d'aujourd'hui n'est pas créé ici (rattrapage de nuit)");
  ok(rel("2026-10-20").statut_completude === "incomplete", "mardi : incomplet (compte rendu manquant)");
  ok(tables.chantier_releves_journaliers.filter(x => x.date_releve === "2026-10-21").length === 1, "upsert : pas de doublon sur (chantier, jour)");
  // Sans date : le serveur repart de la plus ancienne date écrite récemment au journal.
  const r2 = await recalculerApresEcriture(base, rj, { chantierId: "C1", maintenant: new Date("2026-10-22T18:10:00Z") });
  ok(r2.jours[0] === "2026-10-22", `sans date : jours des changements écrits ces 30 dernières minutes (${r2.jours})`);
  // Rattrapage de nuit : idempotent.
  const n1 = await rattrapageDeNuit(base, rj, { maintenant: new Date("2026-10-22T21:45:00Z") });
  const avantN2 = JSON.stringify(tables.chantier_releves_journaliers.map(x => ({ ...x, calcule_le: null })));
  const n2 = await rattrapageDeNuit(base, rj, { maintenant: new Date("2026-10-22T21:45:00Z") });
  ok(n1.chantiers === 1 && n2.relevesEcrits === n1.relevesEcrits, "rattrapage : le chantier qui a bougé aujourd'hui");
  ok(JSON.stringify(tables.chantier_releves_journaliers.map(x => ({ ...x, calcule_le: null }))) === avantN2, "rattrapage idempotent : mêmes relevés");
}

// ── 3. MIGRATION, HORAIRES, GARDES ──────────────────────────────────────────
{
  const mig = lire("supabase/migrations/20261024140000_releves_journaliers.sql");
  ok(/unique \(chantier_id, date_releve\)/.test(mig), "un relevé par chantier et par jour");
  ok(/statut_completude\s+text not null check \(statut_completude in \('complete', 'incomplete'\)\)/.test(mig), "statut de complétude");
  ok(/cr_attendus/.test(mig) && /cr_manquants/.test(mig), "liste des comptes rendus attendus et manquants");
  ok(/profero_collaborateurs_seulement/.test(mig) && /grant select on public\.chantier_releves_journaliers to authenticated/.test(mig), "lecture bureau, écriture serveur");
  // Horaires : tardifs à Paris en été (UTC+2) comme en hiver (UTC+1).
  const heureUTC = (fichier) => { const m = /cron: '(\d+) (\d+) /.exec(lire(fichier)); return Number(m[2]) + Number(m[1]) / 60; };
  const nuit = heureUTC(".github/workflows/cron-releves-journaliers.yml");
  ok(nuit + 1 >= 22 && nuit + 2 < 24, `rattrapage de nuit : ${nuit + 1} h en hiver, ${nuit + 2} h en été, même jour`);
  ok(nuit > heureUTC(".github/workflows/cron-journal-avancement.yml"), "après le contrôle du journal");
  // Relevés du vendredi ARRÊTÉS (option A de Loris, 24/10/2026) : plus de
  // déclenchement automatique, lancement manuel conservé, tables gardées.
  for (const f of [".github/workflows/cron-snapshot-avancement.yml", ".github/workflows/cron-snapshot-hebdo.yml"]) {
    const y = lire(f);
    ok(!/^\s*schedule:/m.test(y) && /^\s*workflow_dispatch:/m.test(y), `${f} : arrêté (pas de schedule), relançable à la main`);
  }
  // Fonctions serveur : plan Hobby, 12 au plus.
  const fonctions = readdirSync(join(racine, "api")).filter(f => f.endsWith(".js"));
  ok(fonctions.length <= 12 && fonctions.includes("releves-journaliers.js"), `${fonctions.length} fonctions serveur (≤ 12)`);
  ok(/"api\/releves-journaliers\.js": \{ "maxDuration": 60 \}/.test(lire("vercel.json")), "durée maximale réglée");
  const handler = lire("api/releves-journaliers.js");
  ok(/estSecretServeur/.test(handler) && /profil\.role === "ouvrier"/.test(handler) && /mode === "nuit"/.test(handler), "route : cron ou bureau, jamais un ouvrier");
  // Appels après écriture.
  const val = lire("src/Renovation/Validation.jsx");
  ok((val.match(/demanderRecalculReleve\(/g) || []).length >= 2, "validation ET « Corriger » demandent le recalcul");
  ok(/planifierRecalculReleve\(chantierId\)/.test(lire("src/Renovation/PhasageV2.jsx")), "phasage : recalcul après un changement d'avancement");
  // Le Bilan n'est pas branché sur les relevés journaliers à cette étape.
  // Étape 2 des marges : le Bilan lit les relevés journaliers pour ses alertes.
  ok(/chantier_releves_journaliers/.test(lire("src/Renovation/BilanSemaine.jsx")), "Bilan : alertes sur les relevés journaliers (étape 2)");
  // Module pur.
  const mod = lire("src/Renovation/releveJournalier.mjs");
  ok(!/supabase|new Date\(\)|Date\.now/.test(mod), "module sans base ni horloge");
}

console.log(`verif-releves-journaliers : ${nb} contrôles OK (données fictives)`);
