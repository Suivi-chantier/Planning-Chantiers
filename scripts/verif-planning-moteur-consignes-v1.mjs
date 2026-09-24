#!/usr/bin/env node
// ─── MOTEUR DE PLANNING : CONSIGNES VISIBLES (chantier 10, préparation étape 2) ──
// Toutes les données de ce script sont FICTIVES (exemple issu des tests,
// données fictives). « Steven » et « Kev » ne sont que des étiquettes de test :
// aucune ligne ne vient de la base.
//
// Blocs :
//  1. Kev hors équipe : placé + marqueur d'exception.
//  2. Kev hors équipe mais absent / introuvable / portée trop large : non planifié + raison.
//  3. Allocation verrouillée un vendredi à 0 h : conservée + avertissement.
//  4. Consigne datée hors période : sans effet.
//  5. Consigne souhaitée : préférence SOFT, violable avec explication ; consignes
//     que le moteur ne sait pas appliquer : rejetées avec avertissement.
//  6. Aucune tâche non planifiée sans raison (garde).
//  7. Sorties identiques avant / après optimisation (référence figée af75749).
//  8. Temps mesuré avant / après.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { planifierPropositionV1 } from "../src/Renovation/planningEngineV1.js";
import { preparerSimulationPlanningGlobalV1 } from "../src/Renovation/planningEngineAdapterV1.js";
import { preparerSimulationReplanningV1 } from "../src/Renovation/planningReplanningAdapterV1.js";
import { planifierReplanningIncrementalV1 } from "../src/Renovation/planningReplanningIncrementalV1.js";
import { appliquerStabiliteDatesForecastV1 } from "../src/Renovation/planningReplanningDateStabilityV1.js";
import { raisonContrainteSansEffetMoteur } from "../src/Renovation/planningConstraintModelV1.js";
import { planifierPropositionV1 as moteurReference } from "./_reference-moteur-af75749/planningEngineV1.mjs";
import { premierEcart, projeterSortieVersReference } from "./_comparaison-moteur/projection.mjs";
import { construireJeuCalibreMoteurV1 } from "./_jeu-calibre-moteur.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const racine = resolve(here, "..");
const sourceMoteur = readFileSync(resolve(racine, "src/Renovation/planningEngineV1.js"), "utf8");
const sourceContraintes = readFileSync(resolve(racine, "src/Renovation/planningConstraintModelV1.js"), "utf8");
const sourceAdaptateur = readFileSync(resolve(racine, "src/Renovation/planningEngineAdapterV1.js"), "utf8");

// 0. Modules purs : aucun accès Supabase, aucune écriture.
for (const [nom, src] of [["moteur", sourceMoteur], ["contraintes", sourceContraintes], ["adaptateur", sourceAdaptateur]]) {
  assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(src), false, `${nom} : aucun import Supabase`);
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/.test(src), false, `${nom} : aucune écriture`);
}

// ── Données fictives communes ────────────────────────────────────────────────
// 28/09/2026 = lundi S40 (semaine paire, 5 jours : lun→jeu 7 h, ven 6 h).
const DEBUT = "2026-09-28";
const res = (id, nom, extra = {}) => ({ id, nom, nom_planning: nom, kind: "personne", actif: true, capacite_facteur: 1, ...extra });
const STEVEN = res("R-STEVEN", "Steven");
const KEV = res("R-KEV", "Kev");
const travail = (id, heures, extra = {}) => ({
  id, tache_id: id, chantier_id: "C1", groupe_type_id: "gt_placo", texte: id,
  heures_mo_restantes: heures, crew_size: 1, candidate_resource_ids: ["R-STEVEN"], ...extra,
});
const kevImpose = (extra = {}) => ({
  id: "C-KEV", type: "resource_required", scope: "groupe", chantier_id: "C1", groupe_type_id: "gt_placo",
  hard: true, config: { resource_ids: ["R-KEV"] }, actif: true, ...extra,
});
const absenceKev = (debut = DEBUT, fin = "2026-12-31") => ({
  id: "ABS-KEV", resource_id: "R-KEV", type: "absence", date_debut: debut, date_fin: fin, toute_journee: true, actif: true,
});
const moteur = overrides => planifierPropositionV1({
  travaux: [travail("T-OSS", 10)],
  ressources: [STEVEN, KEV],
  startDate: DEBUT,
  horizonDays: 14,
  ...overrides,
});

// Chaîne réelle complète (phasage → adaptateurs → moteur chantier 05), en mémoire.
const phasage = (chantierId, taches) => ({
  id: `PH-${chantierId}`, chantier_id: chantierId, revision: 1, updated_at: "2026-09-20T18:00:00Z",
  ouvrages: [{ id: `O-${chantierId}`, code_ouvrage: "P-001", taches }],
  plan_travaux: { meta: { chrono_groupes: [{ id: `CG-${chantierId}`, ordre: 10, groupe_type_id: "gt_placo" }] } },
});
const tachePhasage = (id, heures, extra = {}) => ({
  id, nom: `Ossature placo ${id}`, heures_vendues: heures, heures_estimees: heures, avancement: 0,
  chrono_groupe_id: extra.chrono_groupe_id, chrono_ordre: 0, ouvriers: [], predecesseurs: [], ...extra,
});
const baseChaine = ({ contraintes = [], evenementsRessources = [], cellules = [], startDate = DEBUT } = {}) => ({
  phasages: [
    phasage("C1", [tachePhasage("T-OSS", 16, { chrono_groupe_id: "CG-C1" })]),
    phasage("C2", [tachePhasage("T-OSS2", 4, { chrono_groupe_id: "CG-C2" })]),
  ],
  chantiers: [{ id: "C1", nom: "Chantier fictif 1", statut: "en_cours" }, { id: "C2", nom: "Chantier fictif 2", statut: "en_cours" }],
  cellules,
  ressources: [STEVEN, KEV],
  evenementsRessources,
  contraintes,
  groupesTypes: [
    { id: "gt_placo", ordre: 10, equipe_id: "EQ-PLACO", ouvriers_prio: [] },
    { id: "gt_elec", ordre: 20, equipe_id: "EQ-ELEC", ouvriers_prio: [] },
  ],
  equipes: [
    { id: "EQ-PLACO", nom: "Placo", responsable: "Steven", membres: [], externe: false },
    { id: "EQ-ELEC", nom: "Électricité", responsable: "Kev", membres: [], externe: false },
  ],
  startDate,
  horizonDays: 28,
});
const chaine = options => {
  const prep = preparerSimulationReplanningV1(baseChaine(options));
  const proposition = planifierReplanningIncrementalV1({
    engineInput: prep.engineInput,
    forecast: prep.forecastCourant.allocations_recalculables,
    trigger: null,
  });
  return { prep, proposition };
};
const allocs = (out, travailId) => out.allocations_proposees.filter(a => a.travail_id === travailId);

const blocs = [];
const bloc = (titre, lignes) => blocs.push(`■ ${titre}\n${lignes.map(l => `   ${l}`).join("\n")}`);

// ── 1. Kev hors équipe : placé + marqueur ────────────────────────────────────
{
  // Sans consigne : l'équipe Placo (Steven) fait l'ossature.
  const sans = moteur({});
  assert.deepEqual([...new Set(allocs(sans, "T-OSS").flatMap(a => a.resource_ids))], ["R-STEVEN"]);
  assert.equal(allocs(sans, "T-OSS").some(a => a.exception), false);

  // Consigne obligatoire, portée lot + chantier : Kev est placé bien qu'hors équipe.
  const out = moteur({ contraintes: [kevImpose()] });
  const lignes = allocs(out, "T-OSS");
  assert.ok(lignes.length > 0, "la tâche doit être placée");
  assert.deepEqual([...new Set(lignes.flatMap(a => a.resource_ids))], ["R-KEV"]);
  for (const a of lignes) {
    assert.equal(a.exception?.type, "resource_required");
    assert.deepEqual(a.exception.constraint_ids, ["C-KEV"]);
    assert.deepEqual(a.exception.resource_ids_hors_equipe, ["R-KEV"]);
    assert.match(a.exception.explication, /Kev placé\(e\)\(s\) hors de l'équipe du lot/);
  }
  assert.equal(out.non_planifies.length, 0);

  // Même chose par la chaîne complète (phasage + équipes + adaptateurs) : le
  // marqueur survit, et l'autre chantier du même lot n'est PAS touché.
  const { proposition } = chaine({ contraintes: [kevImpose()] });
  const c1 = allocs(proposition, "C1::T-OSS");
  const c2 = allocs(proposition, "C1::T-OSS2").concat(allocs(proposition, "C2::T-OSS2"));
  assert.ok(c1.length > 0 && c1.every(a => a.resource_ids.join() === "R-KEV" && a.exception?.constraint_ids?.includes("C-KEV")));
  assert.ok(c2.length > 0 && c2.every(a => a.resource_ids.join() === "R-STEVEN" && !a.exception), "portée exacte : le lot sur C2 garde son équipe");
  assert.equal(proposition.invariants.equipe_elargie_uniquement_par_ressource_imposee_ciblee, true);

  // Portée tâche : même exception.
  const tache = moteur({ contraintes: [kevImpose({ scope: "tache", tache_id: "T-OSS", groupe_type_id: null })] });
  assert.ok(allocs(tache, "T-OSS").every(a => a.resource_ids.join() === "R-KEV" && a.exception));

  // Kev déjà DANS l'équipe : aucune exception à signaler.
  const dansEquipe = moteur({ travaux: [travail("T-OSS", 10, { candidate_resource_ids: ["R-STEVEN", "R-KEV"] })], contraintes: [kevImpose()] });
  assert.ok(allocs(dansEquipe, "T-OSS").every(a => a.resource_ids.join() === "R-KEV" && !a.exception));

  bloc("1. Kev hors équipe — placé + marqueur (exemple issu des tests, données fictives)", [
    ...c1.map(a => `${a.date} ${a.travail_id} → ${a.resource_ids.join(", ")} ${a.duree} h — exception ${a.exception.type} / ${a.exception.constraint_ids.join(", ")}`),
    ...c2.map(a => `${a.date} ${a.travail_id} → ${a.resource_ids.join(", ")} ${a.duree} h — aucune exception (autre chantier, même lot)`),
  ]);
}

// ── 2. Kev hors équipe mais absent : non planifié + raison lisible ───────────
{
  const out = moteur({ contraintes: [kevImpose()], evenementsRessources: [absenceKev()] });
  assert.equal(allocs(out, "T-OSS").length, 0, "Steven ne doit PAS remplacer Kev en silence");
  const np = out.non_planifies.find(x => x.travail_id === "T-OSS");
  assert.equal(np.raison_code, "ressource_imposee_indisponible");
  assert.match(np.raison, /Consigne C-KEV : Kev imposé\(e\)\(s\) mais indisponible\(s\) sur les 9 jours travaillés examinés \(absente ou indisponible : 9 j\)/);
  assert.deepEqual(np.consigne_bloquante.constraint_ids, ["C-KEV"]);
  assert.deepEqual(np.consigne_bloquante.resource_ids, ["R-KEV"]);

  // Absent une partie de la période seulement : placé dès son retour.
  const retour = moteur({ contraintes: [kevImpose()], evenementsRessources: [absenceKev(DEBUT, "2026-09-29")] });
  assert.equal(allocs(retour, "T-OSS")[0].date, "2026-09-30");
  assert.equal(allocs(retour, "T-OSS")[0].exception.type, "resource_required");

  // Capacité pleine / autre chantier : le motif est dit.
  const occupe = moteur({
    horizonDays: 1,
    contraintes: [kevImpose()],
    allocationsExistantes: [{ allocation_uid: "EX-KEV", chantier_id: "C9", site_id: "C9", tache_id: "X", date: DEBUT, duree: 3, resource_ids: ["R-KEV"] }],
  });
  const npOccupe = occupe.non_planifies.find(x => x.travail_id === "T-OSS");
  assert.equal(npOccupe.raison_code, "ressource_imposee_indisponible");
  assert.match(npOccupe.raison, /déjà sur un autre chantier : 1 j/);

  // Ressource imposée inconnue / inactive.
  const inconnu = moteur({ ressources: [STEVEN, res("R-KEV", "Kev", { actif: false })], contraintes: [kevImpose()] });
  const npInconnu = inconnu.non_planifies.find(x => x.travail_id === "T-OSS");
  assert.equal(npInconnu.raison_code, "ressource_imposee_introuvable");
  assert.ok(inconnu.warnings.some(w => w.type === "consigne_ressource_introuvable" && w.constraint_id === "C-KEV"));

  // Portée trop large (lot sur TOUS les chantiers) : l'équipe n'est pas élargie,
  // et c'est dit — avertissement + raison.
  const large = moteur({ contraintes: [kevImpose({ chantier_id: null })] });
  assert.equal(allocs(large, "T-OSS").length, 0);
  const npLarge = large.non_planifies.find(x => x.travail_id === "T-OSS");
  assert.equal(npLarge.raison_code, "ressource_imposee_hors_equipe");
  assert.match(npLarge.raison, /portée de la consigne est trop large/);
  assert.ok(large.warnings.some(w => w.type === "consigne_ressource_hors_equipe_non_elargie" && w.travail_id === "T-OSS"));

  // Par la chaîne complète : même raison, même libellé.
  const { proposition } = chaine({ contraintes: [kevImpose()], evenementsRessources: [absenceKev()] });
  const npChaine = proposition.non_planifies.find(x => x.travail_id === "C1::T-OSS");
  assert.equal(npChaine.raison_code, "ressource_imposee_indisponible");

  bloc("2. Kev hors équipe mais absent — non planifié + raison (exemple issu des tests, données fictives)", [
    `${np.travail_id} : ${np.heures_mo_restantes} h non planifiées — [${np.raison_code}] ${np.raison}`,
    `capacité pleine : [${npOccupe.raison_code}] ${npOccupe.raison}`,
    `inactif : [${npInconnu.raison_code}] ${npInconnu.raison}`,
    `portée trop large : [${npLarge.raison_code}] ${npLarge.raison}`,
  ]);
}

// ── 3. Allocation verrouillée un vendredi à 0 h : conservée + avertissement ──
{
  // 25/09/2026 = vendredi S39 (semaine impaire, 4 jours) : capacité 0 h.
  const cellule = (jour, weekId, uid, duree = 8) => ({
    id: `CELL-${uid}`, week_id: weekId, chantier_id: "C1", jour, planifie: true, reel: false, ouvriers: ["Steven"], vehicules: [],
    taches: [{ allocation_uid: uid, tache_id: "T-OSS", text: "Ossature", duree, ouvriers: ["Steven"] }],
  });
  const verrou = uid => ({ id: `L-${uid}`, type: "allocation_lock", scope: "allocation", allocation_id: uid, chantier_id: "C1", hard: true, actif: true });
  const { prep, proposition } = chaine({
    startDate: "2026-09-21",
    cellules: [cellule("Vendredi", "2026-W39", "U-FRI")],
    contraintes: [verrou("U-FRI")],
  });
  const fixe = prep.forecastCourant.allocations_fixes.find(a => a.allocation_uid === "U-FRI");
  assert.equal(fixe.date, "2026-09-25");
  assert.equal(fixe.locked, true, "le verrou est conservé (décision humaine)");
  const avert = prep.warnings.find(w => w.type === "allocation_verrouillee_jour_non_travaille");
  assert.ok(avert, "un verrou sur un jour à 0 h ne passe jamais en silence");
  assert.equal(avert.allocation_uid, "U-FRI");
  assert.equal(avert.exception_conservee, true);
  assert.match(avert.explication, /^Intervention hors jours travaillés \(vendredi 0 h\) — exception conservée/);
  // Les 8 h verrouillées restent déduites (16 − 8 = 8 h à planifier), et le
  // moteur ne place rien d'autre ce vendredi-là.
  assert.equal(prep.engineInput.travaux.find(t => t.id === "C1::T-OSS").heures_mo_restantes, 8);
  assert.equal(allocs(proposition, "C1::T-OSS").some(a => a.date === "2026-09-25"), false);

  // Même verrou un jeudi normal : aucun avertissement.
  const jeudi = preparerSimulationPlanningGlobalV1({ ...baseChaine({ startDate: "2026-09-21", cellules: [cellule("Jeudi", "2026-W39", "U-JEU")], contraintes: [verrou("U-JEU")] }) });
  assert.equal(jeudi.warnings.some(w => w.type.startsWith("allocation_verrouillee_")), false);

  // Vendredi à 0 h MAIS capacité exceptionnelle déclarée pour Steven : c'est voulu, pas d'avertissement.
  const override = preparerSimulationPlanningGlobalV1({ ...baseChaine({
    startDate: "2026-09-21",
    cellules: [cellule("Vendredi", "2026-W39", "U-FRI")],
    contraintes: [verrou("U-FRI")],
    evenementsRessources: [{ id: "OV", resource_id: "R-STEVEN", type: "capacite_override", date_debut: "2026-09-25", date_fin: "2026-09-25", capacite_heures: 8, actif: true }],
  }) });
  assert.equal(override.warnings.some(w => w.type.startsWith("allocation_verrouillee_")), false);

  // Jour travaillé mais Steven absent : conservé + avertissement dédié.
  const absent = preparerSimulationPlanningGlobalV1({ ...baseChaine({
    startDate: "2026-09-21",
    cellules: [cellule("Jeudi", "2026-W39", "U-JEU")],
    contraintes: [verrou("U-JEU")],
    evenementsRessources: [{ id: "ABS", resource_id: "R-STEVEN", type: "absence", date_debut: "2026-09-24", date_fin: "2026-09-24", toute_journee: true, actif: true }],
  }) });
  const avertAbsent = absent.warnings.find(w => w.type === "allocation_verrouillee_ressource_indisponible");
  assert.match(avertAbsent.explication, /Steven est indisponible .* — exception conservée/);
  assert.equal(absent.forecastCourant.allocations_fixes.find(a => a.allocation_uid === "U-JEU").locked, true);

  bloc("3. Vendredi verrouillé — conservé + avertissement (exemple issu des tests, données fictives)", [
    `allocation fixe : ${fixe.allocation_uid} ${fixe.date} ${fixe.duree} h locked=${fixe.locked}`,
    `avertissement : [${avert.type}] ${avert.explication}`,
    `reste envoyé au moteur : ${prep.engineInput.travaux.find(t => t.id === "C1::T-OSS").heures_mo_restantes} h ; aucune proposition le 2026-09-25`,
    `absence un jour travaillé : [${avertAbsent.type}] ${avertAbsent.explication}`,
  ]);
}

// ── 4. Consigne datée hors période : sans effet ──────────────────────────────
{
  const periode = { date_debut: "2026-10-12", date_fin: "2026-10-16" };
  const out = moteur({ travaux: [travail("T-OSS", 2)], contraintes: [kevImpose(periode)] });
  const [a] = allocs(out, "T-OSS");
  assert.equal(a.date, DEBUT);
  assert.deepEqual(a.resource_ids, ["R-STEVEN"], "hors de sa période, la consigne ne s'applique pas");
  assert.equal(a.exception, undefined);
  assert.equal(a.explication.contraintes_appliquees.includes("C-KEV"), false);
  const sansConsigne = moteur({ travaux: [travail("T-OSS", 2)] });
  for (const cle of ["allocations_proposees", "non_planifies", "warnings", "contraintes_sans_effet"]) {
    assert.deepEqual(out[cle], sansConsigne[cle], `hors période, ${cle} identique à l'absence de consigne`);
  }

  // Dans sa période, elle s'applique : la tâche démarrée plus tard passe à Kev.
  const dedans = moteur({ travaux: [travail("T-OSS", 2)], startDate: "2026-10-12", contraintes: [kevImpose(periode)] });
  assert.deepEqual(allocs(dedans, "T-OSS")[0].resource_ids, ["R-KEV"]);
  assert.equal(allocs(dedans, "T-OSS")[0].exception.type, "resource_required");

  // Fin de période au milieu d'une tâche longue : Kev pendant la période, l'équipe ensuite.
  const chevauche = moteur({ travaux: [travail("T-OSS", 20)], contraintes: [kevImpose({ date_debut: DEBUT, date_fin: "2026-09-29" })] });
  const parJour = allocs(chevauche, "T-OSS").map(x => `${x.date}:${x.resource_ids.join()}`);
  assert.deepEqual(parJour, ["2026-09-28:R-KEV", "2026-09-29:R-KEV", "2026-09-30:R-STEVEN"]);

  // Interdiction datée : Steven interdit les 28 et 29/09 seulement.
  const interdit = moteur({
    travaux: [travail("T-OSS", 2)],
    contraintes: [{ id: "C-NO-STEVEN", type: "resource_forbidden", scope: "tache", tache_id: "T-OSS", hard: true, config: { resource_ids: ["R-STEVEN"] }, date_debut: DEBUT, date_fin: "2026-09-29", actif: true }],
  });
  assert.equal(allocs(interdit, "T-OSS")[0].date, "2026-09-30");

  bloc("4. Consigne datée hors période — sans effet (exemple issu des tests, données fictives)", [
    `C-KEV valable du ${periode.date_debut} au ${periode.date_fin} ; tâche de 2 h au ${DEBUT} → ${a.resource_ids.join()} ${a.date}, aucune exception, sortie identique à « sans consigne »`,
    `même consigne, tâche démarrant le 2026-10-12 → ${allocs(dedans, "T-OSS")[0].resource_ids.join()} (exception)`,
    `consigne du 28 au 29/09 sur 20 h : ${parJour.join(" ; ")}`,
  ]);
}

// ── 5. Consigne souhaitée (SOFT, violable avec explication) + rejets ─────────
{
  const souhaite = (extra = {}) => ({ ...kevImpose(extra), id: "C-KEV-SOUHAIT", hard: false });
  const equipeMixte = [travail("T-OSS", 2, { candidate_resource_ids: ["R-STEVEN", "R-KEV"], preferred_resource_ids: ["R-STEVEN"] })];

  // Sans consigne : la préférence de l'équipe place Steven.
  assert.deepEqual(allocs(moteur({ travaux: equipeMixte }), "T-OSS")[0].resource_ids, ["R-STEVEN"]);
  // Kev souhaité et disponible : Kev, consigne respectée.
  const ok = moteur({ travaux: equipeMixte, contraintes: [souhaite()] });
  const aOk = allocs(ok, "T-OSS")[0];
  assert.deepEqual(aOk.resource_ids, ["R-KEV"]);
  assert.equal(aOk.explication.consignes_souhaitees[0].respectee, true);
  assert.equal(ok.warnings.some(w => w.type === "consigne_souhaitee_non_respectee"), false);

  // Kev souhaité mais absent : la tâche n'attend pas, Steven est placé, et c'est expliqué.
  const viole = moteur({ travaux: equipeMixte, contraintes: [souhaite()], evenementsRessources: [absenceKev()] });
  const aViole = allocs(viole, "T-OSS")[0];
  assert.deepEqual(aViole.resource_ids, ["R-STEVEN"]);
  assert.equal(aViole.date, DEBUT);
  assert.equal(aViole.explication.consignes_souhaitees[0].respectee, false);
  assert.match(aViole.explication.consignes_souhaitees[0].explication, /Kev indisponible ce jour.* Steven placé\(e\)\(s\) à la place/);
  const w = viole.warnings.find(x => x.type === "consigne_souhaitee_non_respectee");
  assert.deepEqual(w.dates, [DEBUT]);
  assert.equal(w.constraint_id, "C-KEV-SOUHAIT");

  // Kev souhaité mais hors équipe : une consigne souhaitée n'élargit JAMAIS l'équipe.
  const horsEquipe = moteur({ travaux: [travail("T-OSS", 2)], contraintes: [souhaite()] });
  const aHors = allocs(horsEquipe, "T-OSS")[0];
  assert.deepEqual(aHors.resource_ids, ["R-STEVEN"]);
  assert.equal(aHors.exception, undefined);
  assert.match(aHors.explication.consignes_souhaitees[0].explication, /hors de l'équipe du lot \(une consigne souhaitée n'élargit jamais l'équipe/);

  // Steven « de préférence pas » : Kev placé ; si Kev est absent, Steven quand même, expliqué.
  const pasSteven = { id: "C-PAS-STEVEN", type: "resource_forbidden", scope: "tache", tache_id: "T-OSS", hard: false, config: { resource_ids: ["R-STEVEN"] }, actif: true };
  assert.deepEqual(allocs(moteur({ travaux: equipeMixte, contraintes: [pasSteven] }), "T-OSS")[0].resource_ids, ["R-KEV"]);
  const pasStevenViole = moteur({ travaux: equipeMixte, contraintes: [pasSteven], evenementsRessources: [absenceKev()] });
  assert.deepEqual(allocs(pasStevenViole, "T-OSS")[0].resource_ids, ["R-STEVEN"]);
  assert.match(allocs(pasStevenViole, "T-OSS")[0].explication.consignes_souhaitees[0].explication, /Steven utilisé\(e\)\(s\) faute d'autre ressource/);

  // Consignes que le moteur ne sait pas appliquer : rejetées, jamais ignorées en silence.
  const rejets = [
    [{ id: "R-DATE-SOFT", type: "not_before", scope: "tache", tache_id: "T-OSS", date_debut: "2026-10-01", hard: false, actif: true }, "date_souhaitee_non_prise_en_charge"],
    [{ id: "R-FIX-SOFT", type: "fixed_date", scope: "tache", tache_id: "T-OSS", date_debut: "2026-10-01", hard: false, actif: true }, "date_souhaitee_non_prise_en_charge"],
    [{ id: "R-PRIO-DATEE", type: "priority", scope: "tache", tache_id: "T-OSS", priority: 50, date_debut: "2026-10-01", actif: true }, "priorite_datee_non_prise_en_charge"],
    [{ id: "R-VIDE", type: "resource_required", scope: "tache", tache_id: "T-OSS", config: { resource_ids: [] }, hard: true, actif: true }, "contrainte_invalide"],
    [{ id: "R-ALLOC", type: "resource_forbidden", scope: "allocation", allocation_id: "A1", config: { resource_ids: ["R-STEVEN"] }, actif: true }, "portee_allocation_non_prise_en_charge"],
    [{ id: "R-LOCK", type: "allocation_lock", scope: "allocation", allocation_id: "A1", actif: true }, "verrou_hors_adaptateur"],
    [{ id: "R-TYPE", type: "inconnu", scope: "tache", tache_id: "T-OSS", actif: true }, "contrainte_invalide"],
  ];
  const sansConsigne = moteur({ travaux: [travail("T-OSS", 2)] });
  for (const [contrainte, code] of rejets) {
    assert.equal(raisonContrainteSansEffetMoteur(contrainte)?.code, code, contrainte.id);
    const out = moteur({ travaux: [travail("T-OSS", 2)], contraintes: [contrainte] });
    assert.deepEqual(out.contraintes_sans_effet.map(x => [x.constraint_id, x.code]), [[contrainte.id, code]]);
    assert.ok(out.warnings.some(x => x.type === "consigne_sans_effet" && x.constraint_id === contrainte.id && x.explication));
    assert.deepEqual(out.allocations_proposees, sansConsigne.allocations_proposees, `${contrainte.id} : rejetée = aucun effet`);
  }
  // Une consigne inactive n'est ni appliquée ni signalée (désactivée volontairement).
  assert.deepEqual(moteur({ contraintes: [kevImpose({ actif: false })] }).contraintes_sans_effet, []);

  bloc("5. Consigne souhaitée — préférence, violable avec explication (exemple issu des tests, données fictives)", [
    `Kev souhaité, disponible → ${aOk.resource_ids.join()} : ${aOk.explication.consignes_souhaitees[0].explication}`,
    `Kev souhaité, absent → ${aViole.resource_ids.join()} le ${aViole.date} : ${aViole.explication.consignes_souhaitees[0].explication}`,
    `Kev souhaité, hors équipe → ${aHors.resource_ids.join()} : ${aHors.explication.consignes_souhaitees[0].explication}`,
    ...rejets.slice(0, 3).map(([c, code]) => `rejet ${c.id} : [${code}] ${raisonContrainteSansEffetMoteur(c).explication}`),
  ]);
}

// ── 6. Aucune tâche non planifiée sans raison ────────────────────────────────
{
  const garde = (out, contexte) => {
    for (const np of out.non_planifies) {
      assert.ok(String(np.raison || "").trim(), `${contexte} : ${np.travail_id} sans libellé de raison`);
      assert.ok(String(np.raison_code || "").trim(), `${contexte} : ${np.travail_id} sans code de raison`);
    }
    assert.equal(out.invariants.toute_tache_non_planifiee_a_une_raison, true, contexte);
  };
  const codes = new Set();
  const scenarios = {
    predecesseur_introuvable: { travaux: [travail("B", 2, { predecesseur_ids: ["INCONNU"] })] },
    predecesseur_non_termine: { travaux: [travail("A", 200), travail("B", 2, { predecesseur_ids: ["A"] })] },
    delai_technique_hors_horizon: { horizonDays: 2, travaux: [travail("A", 1), travail("B", 1, { predecesseur_ids: ["A"], delais_predecesseurs: [{ predecesseur_id: "A", delai_jours_calendaires: 30 }] })] },
    contrainte_date_hors_horizon: { contraintes: [{ id: "NB", type: "not_before", scope: "tache", tache_id: "T-OSS", date_debut: "2027-01-04", hard: true, actif: true }] },
    ressource_imposee_indisponible: { contraintes: [kevImpose()], evenementsRessources: [absenceKev()] },
    ressource_imposee_introuvable: { ressources: [STEVEN], contraintes: [kevImpose()] },
    ressource_imposee_equipe_incomplete: { travaux: [travail("T-OSS", 10, { crew_size: 2 })], contraintes: [kevImpose()] },
    ressource_imposee_hors_equipe: { contraintes: [kevImpose({ chantier_id: null })] },
    capacite_ou_contraintes_horizon: { horizonDays: 1, travaux: [travail("T-OSS", 100)] },
  };
  for (const [code, overrides] of Object.entries(scenarios)) {
    const out = moteur(overrides);
    garde(out, code);
    assert.ok(out.non_planifies.some(np => np.raison_code === code), `code ${code} attendu`);
    out.non_planifies.forEach(np => codes.add(np.raison_code));
  }
  assert.deepEqual([...codes].sort(), Object.keys(scenarios).sort());

  // Garde de code : non_planifies n'est construit QU'à travers raisonNonPlanifie,
  // qui renvoie un code et un libellé sur chacune de ses branches.
  const debutRaison = sourceMoteur.indexOf("function raisonNonPlanifie(");
  const finRaison = sourceMoteur.indexOf("export function planifierPropositionV1(");
  assert.ok(debutRaison > 0 && finRaison > debutRaison, "raisonNonPlanifie introuvable");
  const corps = sourceMoteur.slice(debutRaison, finRaison);
  const retours = corps.match(/\breturn\s*\{\s*code:\s*"[a-z_]+"/g) || [];
  const tousRetours = corps.match(/\breturn\b/g) || [];
  assert.equal(retours.length, tousRetours.length, "chaque branche de raisonNonPlanifie renvoie un code");
  assert.match(sourceMoteur, /raison: raison\.libelle,\s*raison_code: raison\.code,/);

  // Chaîne complète sur le jeu calibré fictif : aucune ligne sans raison, aucune
  // exclusion sans type ni explication.
  const jeu = construireJeuCalibreMoteurV1({ horizonDays: 42 });
  const prep = preparerSimulationReplanningV1(jeu);
  const prop = planifierReplanningIncrementalV1({ engineInput: prep.engineInput, forecast: prep.forecastCourant.allocations_recalculables, trigger: null });
  garde(prop, "jeu calibré");
  prep.travaux_exclus.forEach(x => assert.ok(x.type && x.explication, "exclusion sans raison"));

  // Adaptateur : une tâche sans identifiant ne disparaît plus en silence.
  const sansId = preparerSimulationPlanningGlobalV1({ ...baseChaine(), phasages: [phasage("C1", [tachePhasage(undefined, 5, { chrono_groupe_id: "CG-C1" })])] });
  assert.deepEqual(sansId.travaux_exclus.map(x => x.type), ["tache_sans_identifiant"]);

  const parCode = {};
  prop.non_planifies.forEach(np => { parCode[np.raison_code] = (parCode[np.raison_code] || 0) + 1; });
  bloc("6. Aucune tâche non planifiée sans raison (exemple issu des tests, données fictives)", [
    `${Object.keys(scenarios).length} codes couverts : ${Object.keys(scenarios).join(", ")}`,
    `jeu calibré 42 j : ${prop.non_planifies.length} non planifiés, tous avec code + libellé — ${Object.entries(parCode).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `adaptateur : tâche sans identifiant → exclusion « tache_sans_identifiant »`,
  ]);
}

// ── 7 & 8. Sorties identiques avant / après + temps mesuré ───────────────────
{
  // a) Jeu calibré fictif, horizon 42 j, contraintes éphémères de stabilité
  //    incluses (exactement l'entrée que la chaîne chantier 05 donne au moteur).
  const jeu = construireJeuCalibreMoteurV1({ horizonDays: 42 });
  const prep = preparerSimulationReplanningV1(jeu);
  const ei = prep.engineInput;
  const stab = appliquerStabiliteDatesForecastV1({ travaux: ei.travaux, contraintes: ei.contraintes, startDate: ei.startDate });
  const entree = { ...ei, contraintes: stab.contraintes, continuiteMultiJours: true };

  let t0 = performance.now();
  const avant = moteurReference(structuredClone(entree));
  const msAvant = performance.now() - t0;
  t0 = performance.now();
  const apres = planifierPropositionV1(structuredClone(entree));
  const msApres = performance.now() - t0;
  const projete = projeterSortieVersReference(apres);
  assert.ok(isDeepStrictEqual(projete, avant), `jeu calibré : ${premierEcart(projete, avant)}`);
  // Aucun champ ajouté ne doit avoir de contenu sur un jeu sans consigne.
  assert.deepEqual(apres.contraintes_sans_effet, []);
  assert.equal(apres.allocations_proposees.some(a => a.exception || a.explication.consignes_souhaitees), false);
  const ratio = msAvant / msApres;
  assert.ok(ratio >= 3, `temps divisé par ${ratio.toFixed(1)} seulement (objectif ≥ 3)`);

  // b) Tous les jeux de test existants du planning, rejoués : chaque appel au
  //    moteur est comparé à la référence figée (crochet de chargement).
  const dossier = mkdtempSync(join(tmpdir(), "comparaison-moteur-"));
  const sortie = join(dossier, "bilan.jsonl");
  const scripts = readdirSync(here)
    .filter(f => /^verif-planning-.*\.mjs$/.test(f) && f !== "verif-planning-moteur-consignes-v1.mjs")
    .sort();
  const rouges = [];
  for (const f of scripts) {
    const r = spawnSync(process.execPath, ["--import", "./scripts/_comparaison-moteur/crochet.mjs", join("scripts", f)], {
      cwd: racine,
      env: { ...process.env, COMPARAISON_MOTEUR_SORTIE: sortie },
      encoding: "utf8",
    });
    if (r.status !== 0) rouges.push(`${f} : ${(r.stderr || "").split("\n").filter(l => !/Warning|Reparsing|type": "module|trace-warnings/.test(l)).slice(0, 4).join(" | ")}`);
  }
  const bilans = readFileSync(sortie, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  rmSync(dossier, { recursive: true, force: true });
  assert.deepEqual(rouges, [], "les jeux de test existants doivent rester verts sous le crochet");
  const appels = bilans.reduce((s, b) => s + b.appels, 0);
  const identiques = bilans.reduce((s, b) => s + b.identiques + b.erreurs_identiques, 0);
  const differents = bilans.flatMap(b => b.differents.map(d => `${b.script.split(/[\\/]/).pop()} appel ${d.appel} : ${d.ecart}`));
  assert.deepEqual(differents, [], "sorties différentes de la référence");
  assert.ok(appels >= 61, `au moins 61 appels du moteur attendus dans les jeux existants (${appels})`);
  assert.equal(identiques, appels);

  bloc("7. Sorties identiques avant / après optimisation (exemple issu des tests, données fictives)", [
    `jeu calibré 42 j (${ei.travaux.length} travaux, ${stab.contraintes.length} contraintes) : ${apres.allocations_proposees.length} allocations, ${apres.non_planifies.length} non planifiés — identique à la référence af75749`,
    `jeux de test existants : ${scripts.length} scripts rejoués, ${bilans.length} appellent le moteur, ${appels} appels, ${identiques} identiques, 0 différent`,
  ]);
  bloc("8. Temps mesuré avant / après (exemple issu des tests, données fictives)", [
    `avant (référence af75749) : ${Math.round(msAvant)} ms`,
    `après                     : ${Math.round(msApres)} ms`,
    `temps divisé par ${ratio.toFixed(1)} (objectif ≥ 3)`,
  ]);
}

console.log(blocs.join("\n\n"));
console.log("\n✓ Moteur de planning — consignes visibles : 8 blocs validés");
