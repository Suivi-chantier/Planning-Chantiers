// ─── PLANNING MODEL V1 ───────────────────────────────────────────────────────
// Référentiel métier du futur planificateur Profero.
// Fonctions PURES : aucune lecture/écriture Supabase.
//
// Périmètre : uniquement les ouvrages dont `identifiant` commence par
// `ouvrages_v2_`. Les ouvrages historiques restent lisibles par l'application
// mais ne sont ni enrichis ni utilisés comme référence d'apprentissage.

export const PLANNING_MODEL_VERSION = 1;
export const OUVRAGE_V2_PREFIX = "ouvrages_v2_";

export const DEPENDANCE_MODES = Object.freeze({
  SEQUENCE: "sequence",
  PARALLEL: "parallel",
  EXPLICIT: "explicit",
});

export const DEPENDANCE_FORCES = Object.freeze({
  HARD: "hard",
  SOFT: "soft",
});

export const DEPENDANCE_RELATIONS = Object.freeze({
  FINISH_TO_START: "finish_to_start",
});

const str = v => String(v ?? "").trim();
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function estOuvrageV2(ouvrage) {
  return str(ouvrage?.identifiant).startsWith(OUVRAGE_V2_PREFIX);
}

export function codeOuvrageDepuisLibelle(libelle) {
  const s = str(libelle);
  const m = s.match(/^([A-Z]{1,3})[\s\-._]?(\d{1,5}(?:\.\d+)?)\b/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

export function nouvelIdSousTache() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `st_${crypto.randomUUID()}`;
  }
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nouvelIdDependance() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dep_${crypto.randomUUID()}`;
  }
  return `dep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Compatibilité descendante : on conserve lotId, mais on sait relire phaseId
// des anciennes sous-tâches. L'appelant décide s'il veut réellement persister
// l'enrichissement (`assignIds: true`) ou seulement inspecter les données.
// IMPORTANT : l'absence de dépendance connue ne doit jamais être interprétée
// comme « suit obligatoirement la ligne précédente ». Le défaut est donc
// PARALLEL (= aucune dépendance dure interne connue). L'ordre reste une
// préférence de planification via groupe/chrono.
export function normaliserSousTacheV2(st, { assignIds = false } = {}) {
  const source = st && typeof st === "object" ? st : {};
  const id = str(source.id) || (assignIds ? nouvelIdSousTache() : null);
  const lotId = str(source.lotId ?? source.phaseId) || "";
  const groupeTypeId = str(source.groupe_type_id) || null;
  const mode = Object.values(DEPENDANCE_MODES).includes(source.dependance_mode)
    ? source.dependance_mode
    : DEPENDANCE_MODES.PARALLEL;
  const preds = Array.isArray(source.predecesseur_ids)
    ? [...new Set(source.predecesseur_ids.map(str).filter(Boolean))]
    : [];

  return {
    ...source,
    ...(id ? { id } : {}),
    lotId,
    groupe_type_id: groupeTypeId,
    dependance_mode: mode,
    predecesseur_ids: preds,
  };
}

export function normaliserOuvrageV2(ouvrage, { assignIds = false } = {}) {
  if (!ouvrage || typeof ouvrage !== "object") return ouvrage;
  if (!estOuvrageV2(ouvrage)) return ouvrage;
  const sousTaches = Array.isArray(ouvrage.sous_taches) ? ouvrage.sous_taches : [];
  return {
    ...ouvrage,
    code_ouvrage: str(ouvrage.code_ouvrage) || codeOuvrageDepuisLibelle(ouvrage.libelle),
    planning_model_version: PLANNING_MODEL_VERSION,
    sous_taches: sousTaches.map(st => normaliserSousTacheV2(st, { assignIds })),
  };
}

// Duplique un jeu de sous-tâches V2 sans réutiliser leurs identifiants stables.
// Les dépendances explicites sont remappées vers les nouveaux ids.
export function dupliquerSousTachesV2(sousTaches = []) {
  const source = (Array.isArray(sousTaches) ? sousTaches : []).map(st => normaliserSousTacheV2(st, { assignIds: true }));
  const remap = new Map(source.map(st => [str(st.id), nouvelIdSousTache()]));
  return source.map(st => ({
    ...st,
    id: remap.get(str(st.id)),
    predecesseur_ids: (st.predecesseur_ids || []).map(id => remap.get(str(id))).filter(Boolean),
  }));
}

export function dependancesInternesOuvrage(ouvrage) {
  const o = normaliserOuvrageV2(ouvrage);
  const sts = Array.isArray(o?.sous_taches) ? o.sous_taches : [];
  const ids = new Set(sts.map(st => str(st.id)).filter(Boolean));
  const deps = [];

  sts.forEach((st, idx) => {
    const successeurId = str(st.id);
    if (!successeurId) return;
    const mode = st.dependance_mode || DEPENDANCE_MODES.PARALLEL;
    let predIds = [];
    if (mode === DEPENDANCE_MODES.SEQUENCE && idx > 0) {
      const p = str(sts[idx - 1]?.id);
      if (p) predIds = [p];
    } else if (mode === DEPENDANCE_MODES.EXPLICIT) {
      predIds = Array.isArray(st.predecesseur_ids) ? st.predecesseur_ids.map(str).filter(Boolean) : [];
    }

    predIds.forEach(predecesseurId => {
      deps.push({
        id: nouvelIdDependance(),
        predecesseur_id: predecesseurId,
        successeur_id: successeurId,
        contrainte: DEPENDANCE_FORCES.HARD,
        relation: DEPENDANCE_RELATIONS.FINISH_TO_START,
        delai_min_calendaire: num(st.delai_min_calendaire) || 0,
        unite_delai: str(st.unite_delai) || "heures",
        origine: "ouvrage_v2",
        origine_ref: str(o.code_ouvrage) || str(o.id) || null,
        valide: ids.has(predecesseurId),
      });
    });
  });
  return deps;
}

// Retourne un diagnostic explicable, utilisé par l'UI et les scripts de
// migration. `planifiable` reste strict : pas de tâche vide, ratio total 100,
// id stable et groupe d'exécution sur chaque sous-tâche.
export function maturiteOuvrageV2(ouvrage) {
  if (!estOuvrageV2(ouvrage)) {
    return { v2: false, planifiable: false, apprenable: false, erreurs: ["Ouvrage hors périmètre Ouvrages_V2"], warnings: [] };
  }
  const o = normaliserOuvrageV2(ouvrage);
  const sts = Array.isArray(o.sous_taches) ? o.sous_taches : [];
  const erreurs = [];
  const warnings = [];
  if (!str(o.code_ouvrage)) warnings.push("Code ouvrage non détecté dans le libellé");
  if (sts.length === 0) erreurs.push("Aucune sous-tâche de production");

  const seen = new Set();
  let ratioTotal = 0;
  sts.forEach((st, i) => {
    const n = i + 1;
    if (!str(st.nom)) erreurs.push(`Sous-tâche ${n} sans nom`);
    if (!str(st.id)) erreurs.push(`Sous-tâche ${n} sans identifiant stable`);
    else if (seen.has(str(st.id))) erreurs.push(`Identifiant de sous-tâche dupliqué : ${st.id}`);
    else seen.add(str(st.id));
    if (!str(st.groupe_type_id)) erreurs.push(`Sous-tâche ${n} sans groupe d'exécution`);
    const r = num(st.ratio);
    if (r != null) ratioTotal += r;
  });
  if (sts.length > 0 && Math.abs(ratioTotal - 100) > 0.001) erreurs.push(`Somme des ratios = ${ratioTotal}% au lieu de 100%`);

  const deps = dependancesInternesOuvrage(o);
  deps.filter(d => !d.valide).forEach(d => erreurs.push(`Prédécesseur introuvable : ${d.predecesseur_id}`));

  const planifiable = erreurs.length === 0;
  return {
    v2: true,
    planifiable,
    apprenable: planifiable,
    erreurs,
    warnings,
    stats: { sous_taches: sts.length, ratio_total: ratioTotal, dependances: deps.length },
  };
}

// Copie figée d'une sous-tâche bibliothèque vers une tâche de phasage.
// `resolveChronoGroupId` reçoit le groupe_type_id et retourne l'id du groupe
// concret du chantier. Les prédécesseurs sont résolus dans un second passage
// car les ids des tâches chantier n'existent qu'après création de toutes les
// tâches.
export function construireTachesDepuisOuvrageV2(ouvrage, {
  makeTaskId,
  resolveChronoGroupId = () => null,
  heuresTotales = null,
} = {}) {
  const o = normaliserOuvrageV2(ouvrage);
  const sts = Array.isArray(o?.sous_taches) ? o.sous_taches : [];
  if (typeof makeTaskId !== "function") throw new Error("makeTaskId est requis");

  const total = num(heuresTotales);
  const bySource = new Map();
  const taches = sts.map((st, idx) => {
    const sourceId = str(st.id) || null;
    const id = String(makeTaskId());
    if (sourceId) bySource.set(sourceId, id);
    const ratio = num(st.ratio);
    const h = total != null && ratio != null ? Number((total * ratio / 100).toFixed(2)) : null;
    return {
      id,
      source_sous_tache_id: sourceId,
      nom: str(st.nom),
      lot_id: str(st.lotId) || null,
      groupe_type_id: str(st.groupe_type_id) || null,
      chrono_groupe_id: st.groupe_type_id ? resolveChronoGroupId(st.groupe_type_id) : null,
      chrono_ordre: idx,
      ratio,
      avancement: 0,
      heures_estimees: h,
      dependance_mode_source: st.dependance_mode || DEPENDANCE_MODES.PARALLEL,
      dependances: [],
    };
  });

  const deps = dependancesInternesOuvrage(o);
  const parTache = new Map(taches.map(t => [t.source_sous_tache_id, t]));
  deps.forEach(dep => {
    const succ = parTache.get(dep.successeur_id);
    if (!succ) return;
    const predTaskId = bySource.get(dep.predecesseur_id);
    const riche = {
      ...dep,
      predecesseur_source_id: dep.predecesseur_id,
      successeur_source_id: dep.successeur_id,
      predecesseur_id: predTaskId || dep.predecesseur_id,
      successeur_id: succ.id,
    };
    succ.dependances.push(riche);
  });

  // Compatibilité avec rang.js : pour une tâche issue d'un ouvrage V2,
  // `predecesseurs` est TOUJOURS explicite. [] signifie réellement « libre ».
  // Cela empêche rang.js de retomber sur son ancien chaînage global par défaut
  // entre groupes / ouvrages. Les anciens phasages sans ce champ sont inchangés.
  taches.forEach(t => {
    const hard = (t.dependances || [])
      .filter(d => d.contrainte === DEPENDANCE_FORCES.HARD)
      .map(d => String(d.predecesseur_id));
    t.predecesseurs = [...new Set(hard)];
  });

  return taches;
}
