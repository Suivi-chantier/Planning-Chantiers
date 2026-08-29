// ─── DIFF FORECAST COURANT ↔ PROPOSITION MOTEUR V1 ───────────────────────────
// Pur et explicable. On compare par tâche de chantier, pas par allocation_uid :
// une replanification peut légitimement recréer/séparer/regrouper les créneaux.

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(txt).filter(Boolean))];

export function cleDiffPlanningV1(chantierId, tacheId) {
  return `${txt(chantierId)}::${txt(tacheId)}`;
}

function dateDiffDays(a, b) {
  if (!a || !b) return null;
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((da - db) / 86400000);
}

function heuresMoAllocationCourante(a) {
  const ressources = uniq(a?.resource_ids);
  const noms = uniq(a?.ouvriers_noms);
  const taille = ressources.length || noms.length;
  return taille > 0 ? round2(Math.max(0, num(a?.duree, 0)) * taille) : 0;
}

function resumerAllocations(list, { proposition = false } = {}) {
  const rows = (Array.isArray(list) ? list : []).filter(Boolean);
  const dates = rows.map(a => txt(a?.date).slice(0, 10)).filter(Boolean).sort();
  const resources = uniq(rows.flatMap(a => a?.resource_ids || [])).sort();
  const heuresMo = round2(rows.reduce((s, a) => s + (proposition ? Math.max(0, num(a?.heures_mo, 0)) : heuresMoAllocationCourante(a)), 0));
  return {
    allocations: rows.length,
    debut: dates[0] || null,
    fin: dates.at(-1) || null,
    heures_mo: heuresMo,
    resource_ids: resources,
  };
}

function indexerCourant(allocations = []) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const chantier = txt(a?.chantier_id);
    const tache = txt(a?.tache_id);
    if (!chantier || !tache) continue;
    const key = cleDiffPlanningV1(chantier, tache);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  return map;
}

function indexerProposition(allocations = []) {
  const map = new Map();
  for (const a of Array.isArray(allocations) ? allocations : []) {
    const key = txt(a?.travail_id) || cleDiffPlanningV1(a?.chantier_id, a?.tache_id);
    if (!txt(a?.chantier_id) || !txt(a?.tache_id)) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  return map;
}

function memeListe(a = [], b = []) {
  const aa = uniq(a).sort();
  const bb = uniq(b).sort();
  return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
}

export function diffForecastPropositionV1({ forecast = [], proposition = [] } = {}) {
  const cur = indexerCourant(forecast);
  const prop = indexerProposition(proposition);
  const keys = [...new Set([...cur.keys(), ...prop.keys()])].sort();
  const changements = [];

  for (const key of keys) {
    const currentRows = cur.get(key) || [];
    const proposedRows = prop.get(key) || [];
    const current = resumerAllocations(currentRows);
    const proposed = resumerAllocations(proposedRows, { proposition: true });
    const sample = proposedRows[0] || currentRows[0] || {};

    let statut = "inchangé";
    if (!currentRows.length && proposedRows.length) statut = "nouveau";
    else if (currentRows.length && !proposedRows.length) statut = "non_replanifié";
    else if (
      current.debut !== proposed.debut
      || current.fin !== proposed.fin
      || current.allocations !== proposed.allocations
      || Math.abs(current.heures_mo - proposed.heures_mo) > 0.01
      || !memeListe(current.resource_ids, proposed.resource_ids)
    ) statut = "modifié";

    const details = [];
    if (current.debut !== proposed.debut) details.push("debut");
    if (current.fin !== proposed.fin) details.push("fin");
    if (current.allocations !== proposed.allocations) details.push("fractionnement");
    if (Math.abs(current.heures_mo - proposed.heures_mo) > 0.01) details.push("heures_mo");
    if (!memeListe(current.resource_ids, proposed.resource_ids)) details.push("ressources");

    changements.push({
      travail_id: key,
      chantier_id: txt(sample.chantier_id) || key.split("::")[0] || null,
      tache_id: txt(sample.tache_id) || key.split("::").slice(1).join("::") || null,
      texte: txt(sample.texte) || txt(sample.text) || null,
      statut,
      details,
      courant: current,
      propose: proposed,
      impact: {
        decalage_debut_jours: dateDiffDays(proposed.debut, current.debut),
        decalage_fin_jours: dateDiffDays(proposed.fin, current.fin),
      },
    });
  }

  const chantierIds = uniq(changements.map(c => c.chantier_id)).sort();
  const parChantier = chantierIds.map(chantierId => {
    const cc = changements.filter(c => c.chantier_id === chantierId);
    const currentEnds = cc.map(c => c.courant.fin).filter(Boolean).sort();
    const proposedEnds = cc.map(c => c.propose.fin).filter(Boolean).sort();
    const finCourante = currentEnds.at(-1) || null;
    const finProposee = proposedEnds.at(-1) || null;
    return {
      chantier_id: chantierId,
      taches: cc.length,
      taches_modifiees: cc.filter(c => c.statut === "modifié").length,
      nouvelles: cc.filter(c => c.statut === "nouveau").length,
      non_replanifiees: cc.filter(c => c.statut === "non_replanifié").length,
      fin_courante: finCourante,
      fin_proposee: finProposee,
      decalage_fin_jours: dateDiffDays(finProposee, finCourante),
    };
  });

  return {
    changements,
    par_chantier: parChantier,
    resume: {
      taches_comparees: changements.length,
      inchangees: changements.filter(c => c.statut === "inchangé").length,
      modifiees: changements.filter(c => c.statut === "modifié").length,
      nouvelles: changements.filter(c => c.statut === "nouveau").length,
      non_replanifiees: changements.filter(c => c.statut === "non_replanifié").length,
      debut_avance: changements.filter(c => (c.impact.decalage_debut_jours ?? 0) < 0).length,
      debut_retarde: changements.filter(c => (c.impact.decalage_debut_jours ?? 0) > 0).length,
      fin_avancee: changements.filter(c => (c.impact.decalage_fin_jours ?? 0) < 0).length,
      fin_retardee: changements.filter(c => (c.impact.decalage_fin_jours ?? 0) > 0).length,
      ressources_changees: changements.filter(c => c.details.includes("ressources")).length,
      fractionnement_change: changements.filter(c => c.details.includes("fractionnement")).length,
    },
    explication: {
      unite_comparaison: "tâche de chantier (chantier_id + tache_id)",
      raison: "Les allocation_uid de proposition sont nouveaux par construction ; le diff compare donc le résultat métier, pas l'identité technique des créneaux.",
      convention_decalage: "valeur positive = proposition plus tardive ; valeur négative = proposition plus tôt",
    },
  };
}
