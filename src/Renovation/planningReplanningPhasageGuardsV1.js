// ─── CHANTIER 05 — GARDES PHASAGES POUR APPLICATION V1 ─────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// La sécurité d'application calcule le plan et les éventuels patchs date_prevue.
// Cette couche ajoute une garde de concurrence pour TOUS les phasages contenant
// une tâche liée présente dans une cellule touchée, même si date_prevue ne change
// pas. Un avancement réel modifié après simulation invalide donc l'application.

export const PLANNING_REPLANNING_PHASAGE_GUARDS_VERSION = 1;
const txt = v => String(v ?? "").trim();

function chantierIdsTouches(planApplication = {}) {
  const ids = new Set();
  for (const op of Array.isArray(planApplication?.operations) ? planApplication.operations : []) {
    for (const cell of [op?.expected_before?.payload, op?.after]) {
      const chantierId = txt(cell?.chantier_id);
      if (!chantierId) continue;
      const hasLinked = (Array.isArray(cell?.taches) ? cell.taches : []).some(t => txt(t?.tache_id));
      if (hasLinked) ids.add(chantierId);
    }
  }
  return [...ids].sort();
}

function blocker(code, label, details = null) {
  return { code, label, details };
}

export function completerGardesPhasagesApplicationV1({
  securiteApplication = {},
  planApplication = {},
  phasages = [],
} = {}) {
  const touched = chantierIdsTouches(planApplication);
  const byChantier = new Map();
  const duplicates = new Set();
  for (const ph of Array.isArray(phasages) ? phasages : []) {
    const chantierId = txt(ph?.chantier_id);
    if (!chantierId) continue;
    if (byChantier.has(chantierId)) duplicates.add(chantierId);
    else byChantier.set(chantierId, ph);
  }

  const extraBlockers = [];
  const guards = [];
  for (const chantierId of touched) {
    if (duplicates.has(chantierId)) {
      extraBlockers.push(blocker(
        "phasage_duplique_pour_chantier",
        `Plusieurs phasages existent pour le chantier ${chantierId} : verrouillage transactionnel ambigu.`,
        { chantier_id:chantierId }
      ));
      continue;
    }
    const ph = byChantier.get(chantierId);
    if (!ph) {
      extraBlockers.push(blocker(
        "phasage_garde_introuvable",
        `Aucun phasage n'est disponible pour verrouiller le chantier ${chantierId}.`,
        { chantier_id:chantierId }
      ));
      continue;
    }
    const phasageId = txt(ph?.id);
    const updatedAt = txt(ph?.updated_at);
    if (!phasageId || !updatedAt) {
      extraBlockers.push(blocker(
        "phasage_garde_version_absente",
        `Le phasage du chantier ${chantierId} n'a pas d'identité/version exploitable pour un compare-before-write.`,
        { chantier_id:chantierId, phasage_id:phasageId || null, expected_updated_at:updatedAt || null }
      ));
      continue;
    }
    guards.push({
      phasage_id:phasageId,
      chantier_id:chantierId,
      expected_updated_at:updatedAt,
    });
  }

  const updateIds = new Set((Array.isArray(securiteApplication?.phasage_updates) ? securiteApplication.phasage_updates : [])
    .map(x => txt(x?.phasage_id)).filter(Boolean));
  const guardIds = new Set(guards.map(g => g.phasage_id));
  const updatesSansGarde = [...updateIds].filter(id => !guardIds.has(id));
  if (updatesSansGarde.length) {
    extraBlockers.push(blocker(
      "phasage_update_sans_garde",
      `${updatesSansGarde.length} mise(s) à jour date_prevue n'ont pas de garde phasage correspondante.`,
      { phasage_ids:updatesSansGarde.sort() }
    ));
  }

  const blockers = [...(Array.isArray(securiteApplication?.blockers) ? securiteApplication.blockers : []), ...extraBlockers];
  const operations = Array.isArray(planApplication?.operations) ? planApplication.operations.length : 0;
  return {
    ...securiteApplication,
    application_autorisable: securiteApplication?.application_autorisable === true && extraBlockers.length === 0,
    blockers,
    phasage_guard_version: PLANNING_REPLANNING_PHASAGE_GUARDS_VERSION,
    phasage_guards: guards,
    resume: {
      ...(securiteApplication?.resume || {}),
      phasages_a_verrouiller: guards.length,
      phasage_guard_blockers: extraBlockers.length,
    },
    preconditions_transaction: {
      ...(securiteApplication?.preconditions_transaction || {}),
      tous_phasages_touches_compare_updated_at: true,
      phasage_guardes_independantes_des_modifications_date_prevue: true,
    },
    invariants: {
      ...(securiteApplication?.invariants || {}),
      tout_phasage_touche_possede_garde_version: extraBlockers.length === 0 || operations === 0,
      changement_avancement_apres_simulation_invalide_application: true,
    },
  };
}
