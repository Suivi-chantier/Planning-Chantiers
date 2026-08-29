// ─── CHANTIER 05 — REPLANIFICATION INCRÉMENTALE V1 ──────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le moteur global reste disponible. Lorsqu'un trigger ciblé est fourni, cette
// couche préserve les allocations forecast objectivement compatibles et ne
// libère que le périmètre d'impact + son aval de dépendances.

import { identifierImpactReplanningV1 } from "./planningReplanningImpactV1.js";
import { planifierReplanningPropositionV1 } from "./planningReplanningEngineV1.js";

export const PLANNING_REPLANNING_INCREMENTAL_VERSION = 1;
const EPS = 0.01;

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

function workIdAllocation(a) {
  const c = txt(a?.chantier_id), t = txt(a?.tache_id);
  return c && t ? `${c}::${t}` : null;
}

function moAllocation(a) {
  const ids = uniq(a?.resource_ids);
  return ids.length ? round2(Math.max(0, num(a?.duree, 0)) * ids.length) : 0;
}

function maxDate(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(a => txt(a?.date).slice(0, 10)).filter(Boolean).sort().at(-1) || null;
}

function indexer(list = [], keyFn) {
  const map = new Map();
  for (const value of Array.isArray(list) ? list : []) {
    const key = keyFn(value);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function contraintesDependancesPreservees({ travaux = [], preserveesParTravail = new Map() } = {}) {
  const out = [];
  for (const t of Array.isArray(travaux) ? travaux : []) {
    const tid = txt(t?.id);
    if (!tid || preserveesParTravail.has(tid)) continue;
    for (const predId of uniq(t?.predecesseur_ids)) {
      const rows = preserveesParTravail.get(predId) || null;
      if (!rows?.length) continue;
      const fin = maxDate(rows);
      if (!fin) continue;
      out.push({
        id: `ephemeral_preserved_predecessor::${predId}::${tid}`,
        type: "not_before",
        scope: "tache",
        chantier_id: txt(t?.chantier_id) || null,
        tache_id: txt(t?.tache_id) || null,
        hard: true,
        priority: 0,
        date_debut: fin,
        date_fin: null,
        config: {
          ephemeral: true,
          incremental_scope: true,
          predecessor_preserved: predId,
        },
        label: "Dépendance sur tâche préservée du forecast",
        source: "systeme",
        actif: true,
      });
    }
  }
  return out;
}

function allocationPreserveeVersProposition(a, travail) {
  const ids = uniq(a?.resource_ids);
  return {
    ...a,
    allocation_uid: txt(a?.allocation_uid) || `preserved_${txt(travail?.id)}_${txt(a?.date)}`,
    proposal: false,
    preserved: true,
    travail_id: txt(travail?.id) || workIdAllocation(a),
    site_id: txt(travail?.site_id || travail?.chantier_id) || null,
    groupe_type_id: txt(travail?.groupe_type_id) || null,
    texte: txt(travail?.texte || a?.texte) || null,
    resource_ids: ids,
    heures_mo: moAllocation(a),
    explication: {
      preservee_depuis_forecast: true,
      raison: "Allocation non touchée par le trigger et forecast complet/compatible avec le reste réel.",
      contrainte_hard_metier: false,
      gel_ephemere_pour_recalcul_incremental: true,
    },
  };
}

export function planifierReplanningIncrementalV1({
  engineInput = {},
  forecast = [],
  trigger,
} = {}) {
  if (!trigger || txt(trigger?.type) === "full_recalc") {
    const proposition = planifierReplanningPropositionV1(engineInput);
    return {
      ...proposition,
      replanning: {
        ...(proposition.replanning || {}),
        incremental: {
          version: PLANNING_REPLANNING_INCREMENTAL_VERSION,
          mode: "full_recalc",
          trigger: trigger || { type: "full_recalc" },
          allocations_preservees: 0,
          allocations_recalculees: proposition.allocations_proposees.length,
        },
      },
    };
  }

  const travaux = Array.isArray(engineInput?.travaux) ? engineInput.travaux : [];
  const travauxParId = new Map(travaux.filter(t => txt(t?.id)).map(t => [txt(t.id), t]));
  const impact = identifierImpactReplanningV1({
    travaux,
    forecast,
    completedTaskIds: engineInput?.completedTaskIds || [],
    trigger,
  });

  const preserveesParTravail = indexer(impact.allocations_preservables, workIdAllocation);
  const moPreserveeParTravail = new Map();
  for (const [id, rows] of preserveesParTravail) {
    moPreserveeParTravail.set(id, round2(rows.reduce((s, a) => s + moAllocation(a), 0)));
  }

  // Sécurité interne : le module d'impact n'autorise la préservation que si le
  // forecast couvre exactement le reste. Si cette promesse diverge, on échoue
  // plutôt que de produire un double compte silencieux.
  for (const [id, mo] of moPreserveeParTravail) {
    const travail = travauxParId.get(id);
    const reste = round2(Math.max(0, num(travail?.heures_mo_restantes, 0)));
    if (!travail || Math.abs(mo - reste) > EPS) {
      throw new Error(`Préservation incrémentale incohérente ${id} : forecast=${mo}h, reste=${reste}h`);
    }
  }

  const travauxAjustes = travaux.map(t => {
    const id = txt(t?.id);
    if (!preserveesParTravail.has(id)) return { ...t };
    return {
      ...t,
      heures_mo_restantes: 0,
      provenance: {
        ...(t.provenance || {}),
        replanning_incremental: {
          preserved: true,
          heures_mo_preservees: moPreserveeParTravail.get(id) || 0,
        },
      },
    };
  });

  const allocationsPreserveesExistantes = impact.allocations_preservables.map(a => {
    const t = travauxParId.get(workIdAllocation(a));
    return {
      ...a,
      site_id: txt(t?.site_id || t?.chantier_id || a?.chantier_id) || null,
      locked: false,
      incremental_preserved: true,
    };
  });

  const dependencyConstraints = contraintesDependancesPreservees({ travaux, preserveesParTravail });
  const inputIncremental = {
    ...engineInput,
    travaux: travauxAjustes,
    allocationsExistantes: [
      ...(Array.isArray(engineInput?.allocationsExistantes) ? engineInput.allocationsExistantes : []),
      ...allocationsPreserveesExistantes,
    ],
    contraintes: [
      ...(Array.isArray(engineInput?.contraintes) ? engineInput.contraintes : []),
      ...dependencyConstraints,
    ],
  };

  const recalcul = planifierReplanningPropositionV1(inputIncremental);
  const preserveesProposal = impact.allocations_preservables.map(a => allocationPreserveeVersProposition(a, travauxParId.get(workIdAllocation(a))));
  const allocationsCombinees = [...preserveesProposal, ...recalcul.allocations_proposees]
    .sort((a, b) => `${a.date || ""}|${a.chantier_id || ""}|${a.travail_id || ""}|${a.allocation_uid || ""}`
      .localeCompare(`${b.date || ""}|${b.chantier_id || ""}|${b.travail_id || ""}|${b.allocation_uid || ""}`));

  const moPreservee = round2(preserveesProposal.reduce((s, a) => s + num(a?.heures_mo, 0), 0));
  const moRecalculee = round2(recalcul.allocations_proposees.reduce((s, a) => s + num(a?.heures_mo, 0), 0));
  const moTotale = round2(moPreservee + moRecalculee);
  const moDemandee = round2(travaux.reduce((s, t) => s + Math.max(0, num(t?.heures_mo_restantes, 0)), 0));

  return {
    ...recalcul,
    allocations_proposees: allocationsCombinees,
    resume: {
      ...recalcul.resume,
      allocations_proposees: allocationsCombinees.length,
      heures_mo_proposees: moTotale,
      heures_mo_non_planifiees: round2(Math.max(0, moDemandee - moTotale)),
      allocations_preservees: preserveesProposal.length,
      allocations_recalculees: recalcul.allocations_proposees.length,
      heures_mo_preservees: moPreservee,
      heures_mo_recalculees: moRecalculee,
      heures_mo_proposees_total: moTotale,
    },
    replanning: {
      ...(recalcul.replanning || {}),
      incremental: {
        version: PLANNING_REPLANNING_INCREMENTAL_VERSION,
        mode: impact.mode,
        trigger,
        impact_audit: impact.audit,
        travail_ids_impactes: impact.travail_ids_impactes,
        raisons_par_travail: impact.raisons_par_travail,
        allocations_preservees: preserveesProposal.length,
        allocations_liberees: impact.allocations_liberees.length,
        contraintes_dependances_preservees: dependencyConstraints.length,
      },
    },
    invariants: {
      ...(recalcul.invariants || {}),
      allocations_non_impactees_preservees: true,
      forecast_incomplet_jamais_gele: true,
      preservation_ephemere_non_persistante: true,
      dependances_des_taches_preservees_respectees_par_date: true,
      resume_inclut_allocations_preservees_et_recalculees: true,
    },
  };
}
