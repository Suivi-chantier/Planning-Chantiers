// ─── CHANTIER 05 — PLAN D'APPLICATION SÛR V1 ────────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Transforme une proposition de replanification en intentions de mutation de
// `planning_cells`. Ce module NE SAUVE RIEN. Il produit pour chaque cellule un
// `expected_before` exact et un `after` afin que l'application future puisse
// faire un compare-before-write atomique dans UNE transaction DB.
//
// Règles :
// - seules les allocations classées `allocations_recalculables` sont retirées ;
// - allocations manuelles / verrouillées / hors scope conservées octet-logique ;
// - allocation_uid existant réutilisé autant que possible pour la même tâche ;
// - les nouvelles allocations reçoivent un uid déterministe ;
// - `reel` et `vehicules` ne sont jamais recalculés ;
// - une ligne préservée sans `ouvriers` conserve le fallback `cell.ouvriers` ;
// - aucun upsert parallèle / aucune écriture n'existe dans ce fichier.

export const PLANNING_REPLANNING_APPLY_PLAN_VERSION = 1;

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
const EPS = 0.005;
const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];
const dateOnly = v => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function deepClone(v) {
  if (v == null) return v;
  return JSON.parse(JSON.stringify(v));
}

function stableValue(v) {
  if (Array.isArray(v)) return v.map(stableValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, stableValue(v[k])]));
  }
  return v;
}

export function serialiserStableV1(v) {
  return JSON.stringify(stableValue(v));
}

// Empreinte de confort UI / logs seulement. La garde d'écriture future doit
// comparer `expected_before` exactement, jamais faire confiance à ce hash.
export function empreinteStableV1(v) {
  const s = serialiserStableV1(v);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * prime);
  }
  return h.toString(16).padStart(16, "0");
}

export function weekJourDepuisDateV1(dateISO) {
  const iso = dateOnly(dateISO);
  if (!iso) throw new Error(`Date ISO invalide : ${dateISO}`);
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) throw new Error(`Date non planifiable le week-end : ${iso}`);
  const jour = JOURS[day - 1];

  // ISO week : semaine de l'année contenant le jeudi courant.
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + (4 - (day || 7)));
  const weekYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(weekYear, 0, 4, 12));
  const jan4Day = jan4.getUTCDay() || 7;
  const firstThursday = new Date(jan4);
  firstThursday.setUTCDate(jan4.getUTCDate() + (4 - jan4Day));
  const week = 1 + Math.round((thursday - firstThursday) / 604800000);
  return {
    week_id: `${weekYear}-W${String(week).padStart(2, "0")}`,
    jour,
    date: iso,
  };
}

export function cleCellulePlanningV1(weekId, chantierId, jour) {
  const w = txt(weekId), c = txt(chantierId), j = txt(jour);
  if (!w || !c || !j) return null;
  return `${w}::${c}::${j}`;
}

function payloadCellule(cell = {}) {
  return {
    week_id: txt(cell?.week_id),
    chantier_id: txt(cell?.chantier_id),
    jour: txt(cell?.jour),
    planifie: String(cell?.planifie ?? ""),
    reel: String(cell?.reel ?? ""),
    ouvriers: uniq(cell?.ouvriers),
    taches: deepClone(Array.isArray(cell?.taches) ? cell.taches : []),
    vehicules: deepClone(Array.isArray(cell?.vehicules) ? cell.vehicules : []),
  };
}

function expectedCell(cell) {
  if (!cell) return { exists: false, id: null, payload: null };
  return {
    exists: true,
    id: txt(cell?.id) || null,
    payload: payloadCellule(cell),
  };
}

function ownWorkers(line) {
  return Array.isArray(line?.ouvriers) ? uniq(line.ouvriers) : [];
}

function workKey(chantierId, tacheId) {
  const c = txt(chantierId), t = txt(tacheId);
  return c && t ? `${c}::${t}` : null;
}

function construireIndexRessources(ressources = []) {
  const map = new Map();
  for (const r of Array.isArray(ressources) ? ressources : []) {
    const id = txt(r?.id || r?.resource_id);
    const nom = txt(r?.nom_planning || r?.nom);
    if (id && nom && !map.has(id)) map.set(id, nom);
  }
  return map;
}

function comparerSets(a = [], b = []) {
  const aa = uniq(a).sort();
  const bb = uniq(b).sort();
  return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
}

function allocationCouranteSemantique(a) {
  return {
    date: dateOnly(a?.date),
    duree: round2(Math.max(0, num(a?.duree, 0))),
    resource_ids: uniq(a?.resource_ids).sort(),
  };
}

function allocationProposeeSemantique(a) {
  return {
    date: dateOnly(a?.date),
    duree: round2(Math.max(0, num(a?.duree, 0))),
    resource_ids: uniq(a?.resource_ids).sort(),
  };
}

function memeAllocationSemantique(a, b) {
  const aa = allocationCouranteSemantique(a);
  const bb = allocationProposeeSemantique(b);
  return aa.date === bb.date
    && Math.abs(aa.duree - bb.duree) <= EPS
    && comparerSets(aa.resource_ids, bb.resource_ids);
}

function safeToken(v) {
  return encodeURIComponent(txt(v)).replace(/%/g, "_");
}

function nouvelUidDeterministe({ travailId, date, ordinal, used }) {
  const base = `replan_v1_${safeToken(travailId)}_${date}_${ordinal}`;
  let uid = base;
  let suffix = 1;
  while (used.has(uid)) uid = `${base}_${suffix++}`;
  used.add(uid);
  return uid;
}

function mapperUidsProposition({ forecastRecalculable, proposition, usedUids }) {
  const currentByWork = new Map();
  for (const a of Array.isArray(forecastRecalculable) ? forecastRecalculable : []) {
    const key = workKey(a?.chantier_id, a?.tache_id);
    if (!key || !txt(a?.allocation_uid)) continue;
    if (!currentByWork.has(key)) currentByWork.set(key, []);
    currentByWork.get(key).push(a);
  }
  for (const list of currentByWork.values()) {
    list.sort((a, b) => `${a.date || ""}|${a.allocation_uid}`.localeCompare(`${b.date || ""}|${b.allocation_uid}`));
  }

  const proposedByWork = new Map();
  (Array.isArray(proposition) ? proposition : []).forEach((a, index) => {
    const key = txt(a?.travail_id) || workKey(a?.chantier_id, a?.tache_id);
    if (!key) throw new Error("Allocation proposée sans identité travail/tâche");
    if (!proposedByWork.has(key)) proposedByWork.set(key, []);
    proposedByWork.get(key).push({ allocation: a, index });
  });

  const uidByProposalIndex = new Map();
  let reused = 0;
  let created = 0;

  for (const [key, proposedRows] of [...proposedByWork.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const currentRows = [...(currentByWork.get(key) || [])];
    const available = new Set(currentRows.map(a => txt(a.allocation_uid)).filter(Boolean));

    // 1. Correspondance exacte : date + durée + ressources.
    for (const p of proposedRows) {
      const exact = currentRows.find(a => available.has(txt(a.allocation_uid)) && memeAllocationSemantique(a, p.allocation));
      if (!exact) continue;
      const uid = txt(exact.allocation_uid);
      available.delete(uid);
      uidByProposalIndex.set(p.index, uid);
      reused++;
    }

    // 2. Même tâche mais créneau modifié : réutiliser les anciens UID restants
    // dans un ordre déterministe, afin qu'un déplacement ne crée pas une nouvelle
    // identité technique sans nécessité.
    const leftoversCurrent = currentRows.filter(a => available.has(txt(a.allocation_uid)));
    let ci = 0;
    for (const p of proposedRows.filter(x => !uidByProposalIndex.has(x.index))) {
      if (ci < leftoversCurrent.length) {
        const uid = txt(leftoversCurrent[ci++].allocation_uid);
        available.delete(uid);
        uidByProposalIndex.set(p.index, uid);
        reused++;
      }
    }

    // 3. Fractionnement réellement nouveau : UID déterministe.
    let ordinal = 1;
    for (const p of proposedRows.filter(x => !uidByProposalIndex.has(x.index))) {
      const date = dateOnly(p.allocation?.date);
      const uid = nouvelUidDeterministe({ travailId: key, date: date || "date_invalide", ordinal: ordinal++, used: usedUids });
      uidByProposalIndex.set(p.index, uid);
      created++;
    }
  }

  return { uidByProposalIndex, reused, created };
}

function fieldsChanged(beforePayload, afterPayload) {
  if (!beforePayload) return Object.keys(afterPayload);
  return Object.keys(afterPayload).filter(k => serialiserStableV1(beforePayload[k]) !== serialiserStableV1(afterPayload[k]));
}

function lignesParUid(cellules = []) {
  const map = new Map();
  for (const cell of Array.isArray(cellules) ? cellules : []) {
    const key = cleCellulePlanningV1(cell?.week_id, cell?.chantier_id, cell?.jour);
    if (!key) throw new Error("Cellule planning sans clé week_id/chantier_id/jour");
    for (const line of Array.isArray(cell?.taches) ? cell.taches : []) {
      const uid = txt(line?.allocation_uid);
      if (!uid) throw new Error(`Allocation sans allocation_uid dans ${key}`);
      if (map.has(uid)) throw new Error(`allocation_uid dupliqué dans le snapshot courant : ${uid}`);
      map.set(uid, { cellKey: key, cell, line });
    }
  }
  return map;
}

function construireLigneProposee({ allocation, uid, nomParRessource, reusedRawLine = null }) {
  const resourceIds = uniq(allocation?.resource_ids);
  const ouvriers = resourceIds.map(id => {
    const nom = nomParRessource.get(id);
    if (!nom) throw new Error(`Ressource ${id} sans nom_planning : application impossible`);
    return nom;
  });
  const tacheId = txt(allocation?.tache_id);
  const texte = txt(allocation?.texte || allocation?.text);
  const duree = round2(Math.max(0, num(allocation?.duree, 0)));
  if (!tacheId) throw new Error(`Allocation proposée ${uid} sans tache_id`);
  if (duree <= EPS) throw new Error(`Allocation proposée ${uid} avec durée nulle`);
  if (!ouvriers.length) throw new Error(`Allocation proposée ${uid} sans ressource`);

  return {
    ...(reusedRawLine ? deepClone(reusedRawLine) : {}),
    allocation_uid: uid,
    tache_id: tacheId,
    text: texte || txt(reusedRawLine?.text) || tacheId,
    duree,
    ouvriers,
  };
}

function planifieDepuisTaches(taches = []) {
  return (Array.isArray(taches) ? taches : [])
    .map(t => txt(t?.text))
    .filter(Boolean)
    .join("\n");
}

function ouvriersCelluleApres({ beforeCell, preservedLines, afterLines }) {
  const explicit = uniq(afterLines.flatMap(ownWorkers));
  // Une ligne préservée sans équipe propre signifie « tous les ouvriers de la
  // cellule ». Son sens dépend donc du fallback courant : on ne le supprime pas.
  const preservedNeedsFallback = preservedLines.some(line => ownWorkers(line).length === 0);
  return uniq([
    ...(preservedNeedsFallback ? uniq(beforeCell?.ouvriers) : []),
    ...explicit,
  ]);
}

function validerHorizon(date, start, end) {
  if (!date || date < start || date > end) {
    throw new Error(`Allocation proposée hors horizon d'application : ${date || "date absente"} (${start} → ${end})`);
  }
}

export function construirePlanApplicationReplanningV1({
  cellules = [],
  forecastCourant = {},
  proposition = {},
  ressources = [],
  startDate,
  horizonDays = 42,
} = {}) {
  const start = dateOnly(startDate);
  if (!start) throw new Error("startDate ISO requis pour construire le plan d'application");
  const horizon = Math.max(1, Math.min(366, Math.round(num(horizonDays, 42))));
  const end = addDays(start, horizon - 1);
  const currentCells = Array.isArray(cellules) ? cellules : [];
  const recalc = Array.isArray(forecastCourant?.allocations_recalculables) ? forecastCourant.allocations_recalculables : [];
  const fixed = Array.isArray(forecastCourant?.allocations_fixes) ? forecastCourant.allocations_fixes : [];
  const proposed = Array.isArray(proposition?.allocations_proposees) ? proposition.allocations_proposees : [];

  const rawByUid = lignesParUid(currentCells);
  const recalcUids = new Set(recalc.map(a => txt(a?.allocation_uid)).filter(Boolean));
  const fixedUids = new Set(fixed.map(a => txt(a?.allocation_uid)).filter(Boolean));
  for (const uid of recalcUids) {
    if (fixedUids.has(uid)) throw new Error(`Allocation ${uid} classée à la fois fixe et recalculable`);
    if (!rawByUid.has(uid)) throw new Error(`Allocation recalculable ${uid} absente des cellules courantes`);
  }

  const usedUids = new Set(rawByUid.keys());
  const uidMapping = mapperUidsProposition({ forecastRecalculable: recalc, proposition: proposed, usedUids });
  const nomParRessource = construireIndexRessources(ressources);

  const beforeByKey = new Map();
  const working = new Map();
  for (const cell of currentCells) {
    const key = cleCellulePlanningV1(cell.week_id, cell.chantier_id, cell.jour);
    if (!key) throw new Error("Cellule planning sans clé stable");
    if (beforeByKey.has(key)) throw new Error(`Cellule dupliquée dans le snapshot : ${key}`);
    beforeByKey.set(key, cell);
    const preserved = (Array.isArray(cell.taches) ? cell.taches : []).filter(line => !recalcUids.has(txt(line?.allocation_uid)));
    working.set(key, {
      beforeCell: cell,
      preservedLines: deepClone(preserved),
      proposedLines: [],
    });
  }

  proposed.forEach((allocation, index) => {
    const date = dateOnly(allocation?.date);
    validerHorizon(date, start, end);
    const { week_id, jour } = weekJourDepuisDateV1(date);
    const chantierId = txt(allocation?.chantier_id);
    if (!chantierId) throw new Error("Allocation proposée sans chantier_id");
    const cellKey = cleCellulePlanningV1(week_id, chantierId, jour);
    if (!working.has(cellKey)) {
      working.set(cellKey, { beforeCell: null, preservedLines: [], proposedLines: [] });
    }
    const uid = uidMapping.uidByProposalIndex.get(index);
    if (!uid) throw new Error(`UID d'application introuvable pour proposition #${index + 1}`);
    const reusedRawLine = rawByUid.get(uid)?.line || null;
    const line = construireLigneProposee({ allocation, uid, nomParRessource, reusedRawLine });
    working.get(cellKey).proposedLines.push({ line, proposalIndex: index, travail_id: txt(allocation?.travail_id) || workKey(chantierId, allocation?.tache_id) });
  });

  const operations = [];
  const afterUidGlobal = new Set();
  let allocationsPreservees = 0;
  let allocationsRecalculablesRetirees = 0;

  for (const [cellKey, work] of [...working.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const before = work.beforeCell;
    const beforePayload = before ? payloadCellule(before) : null;
    const preservedLines = work.preservedLines;
    const proposalLines = work.proposedLines
      .sort((a, b) => a.proposalIndex - b.proposalIndex)
      .map(x => x.line);
    const afterLines = [...preservedLines, ...proposalLines];

    for (const line of afterLines) {
      const uid = txt(line?.allocation_uid);
      if (!uid) throw new Error(`Allocation sans UID dans l'état après : ${cellKey}`);
      if (afterUidGlobal.has(uid)) throw new Error(`allocation_uid dupliqué dans l'état après : ${uid}`);
      afterUidGlobal.add(uid);
    }

    allocationsPreservees += preservedLines.length;
    if (before) allocationsRecalculablesRetirees += (before.taches || []).filter(line => recalcUids.has(txt(line?.allocation_uid))).length;

    const base = before || {
      week_id: cellKey.split("::")[0],
      chantier_id: cellKey.split("::")[1],
      jour: cellKey.split("::").slice(2).join("::"),
      planifie: "",
      reel: "",
      ouvriers: [],
      taches: [],
      vehicules: [],
    };
    const afterPayload = {
      week_id: txt(base.week_id),
      chantier_id: txt(base.chantier_id),
      jour: txt(base.jour),
      planifie: planifieDepuisTaches(afterLines),
      reel: String(base.reel ?? ""),
      ouvriers: ouvriersCelluleApres({ beforeCell: before, preservedLines, afterLines }),
      taches: deepClone(afterLines),
      vehicules: deepClone(Array.isArray(base.vehicules) ? base.vehicules : []),
    };
    const changed = fieldsChanged(beforePayload, afterPayload);
    if (!changed.length) continue;

    const beforeRecalc = before
      ? (before.taches || []).filter(line => recalcUids.has(txt(line?.allocation_uid))).map(line => txt(line.allocation_uid))
      : [];
    const afterProposal = proposalLines.map(line => txt(line.allocation_uid));

    operations.push({
      cell_key: cellKey,
      type: before ? "update" : "insert",
      expected_before: expectedCell(before),
      after: afterPayload,
      before_fingerprint: empreinteStableV1(expectedCell(before)),
      after_fingerprint: empreinteStableV1(afterPayload),
      changed_fields: changed,
      allocation_uids_recalculables_retires_de_cette_cellule: beforeRecalc,
      allocation_uids_proposes_dans_cette_cellule: afterProposal,
    });
  }

  // Toutes les allocations fixes présentes dans le snapshot doivent encore être
  // présentes après. Si une donnée d'entrée incohérente les ferait disparaître,
  // l'application est bloquée ici avant toute écriture.
  const fixedMissing = [...fixedUids].filter(uid => rawByUid.has(uid) && !afterUidGlobal.has(uid));
  if (fixedMissing.length) throw new Error(`Allocation(s) fixe(s) perdue(s) par le plan : ${fixedMissing.join(", ")}`);

  // Toute allocation recalculable courante doit être remplacée par la proposition
  // ou disparaître explicitement si la tâche devient non planifiée. Aucune autre
  // ligne courante n'est autorisée à disparaître.
  const currentNonRecalc = [...rawByUid.keys()].filter(uid => !recalcUids.has(uid));
  const lostNonRecalc = currentNonRecalc.filter(uid => !afterUidGlobal.has(uid));
  if (lostNonRecalc.length) throw new Error(`Allocation(s) hors scope perdue(s) : ${lostNonRecalc.join(", ")}`);

  const impactedKeys = new Set(operations.map(o => o.cell_key));
  const touchedExistingIds = operations
    .filter(o => o.expected_before.exists && o.expected_before.id)
    .map(o => o.expected_before.id);

  return {
    schema_version: 1,
    apply_plan_version: PLANNING_REPLANNING_APPLY_PLAN_VERSION,
    start_date: start,
    horizon_end: end,
    operations,
    resume: {
      cellules_impactees: operations.length,
      cellules_mises_a_jour: operations.filter(o => o.type === "update").length,
      cellules_a_creer: operations.filter(o => o.type === "insert").length,
      allocations_proposees: proposed.length,
      allocations_uid_reutilises: uidMapping.reused,
      allocations_uid_nouveaux: uidMapping.created,
      allocations_recalculables_courantes: recalcUids.size,
      allocations_recalculables_retires_des_cellules_sources: allocationsRecalculablesRetirees,
      allocations_hors_scope_preservees: allocationsPreservees,
      cellules_non_impactees: Math.max(0, currentCells.length - [...impactedKeys].filter(k => beforeByKey.has(k)).length),
    },
    preconditions_application: {
      transaction_unique_obligatoire: true,
      compare_before_write_exact_obligatoire: true,
      expected_existing_cell_ids: touchedExistingIds.sort(),
      interdiction_upserts_paralleles_independants: true,
      recharger_et_resimuler_si_snapshot_obsolete: true,
    },
    invariants: {
      aucune_ecriture_persistante: true,
      seules_allocations_recalculables_remplacees: true,
      allocations_manuelles_et_verrouillees_preservees: true,
      allocation_uid_reutilise_pour_meme_tache_si_possible: true,
      nouvelles_identites_deterministes: true,
      reel_preserve: true,
      vehicules_preserves: true,
      fallback_ouvriers_des_lignes_legacy_preserve: true,
      expected_before_est_source_autoritative_de_concurrence: true,
      fingerprint_est_informatif_uniquement: true,
    },
  };
}