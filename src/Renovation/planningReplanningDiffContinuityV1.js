// ─── CHANTIER 05 — ENRICHISSEMENT DIFF CONTINUITÉ MULTI-JOURS V1 ─────────────
// Module PUR. Complète le diff explicable avec une cause produite directement
// par le moteur : ressource conservée sur le même site que le jour ouvré
// précédent. Aucune cause n'est inférée si la trace moteur n'existe pas.

import { diffReplanningV1 } from "./planningReplanningDiffV1.js";

export const PLANNING_REPLANNING_DIFF_CONTINUITY_VERSION = 1;

const txt = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

function indexAllocations(allocations = []) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const id = txt(a?.travail_id);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(a);
  }
  return map;
}

function resumeRaisons(changements = []) {
  const counts = new Map();
  for (const c of changements) {
    for (const r of c.raisons || []) counts.set(r.code, (counts.get(r.code) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function diffReplanningAvecContinuiteV1({ forecast = [], proposition = {}, travaux = [] } = {}) {
  const base = diffReplanningV1({ forecast, proposition, travaux });
  const allocationsParTravail = indexAllocations(proposition?.allocations_proposees || []);

  const changements = base.changements.map(c => {
    if (c.statut === "inchangé") return c;
    const rows = allocationsParTravail.get(c.travail_id) || [];
    const resourceIds = uniq(rows.flatMap(a => a?.explication?.continuite_site_jour_precedent || []));
    const joursPrecedents = uniq(rows.map(a => a?.explication?.jour_planifiable_precedent).filter(Boolean));
    if (!resourceIds.length) return c;
    const raisons = [...(c.raisons || [])];
    if (!raisons.some(r => r.code === "continuite_site_jour_precedent")) {
      raisons.push({
        code: "continuite_site_jour_precedent",
        label: "La proposition favorise une ressource déjà présente sur le même site le jour ouvré précédent.",
        details: { resource_ids: resourceIds, jours_precedents: joursPrecedents },
        niveau: "info",
      });
    }
    return {
      ...c,
      raisons,
      qualite_explication: "explique",
      changement_a_verifier: false,
    };
  });

  const travauxAVerifier = changements.filter(c => c.changement_a_verifier).map(c => c.travail_id);
  return {
    ...base,
    changements,
    resume: {
      ...base.resume,
      changements_expliques: changements.filter(c => c.statut !== "inchangé" && c.qualite_explication === "explique").length,
      changements_a_verifier: travauxAVerifier.length,
    },
    raisons_resume: resumeRaisons(changements),
    travaux_a_verifier: travauxAVerifier,
    invariants: {
      ...(base.invariants || {}),
      continuite_multi_jours_expliquee_uniquement_depuis_trace_moteur: true,
    },
  };
}
