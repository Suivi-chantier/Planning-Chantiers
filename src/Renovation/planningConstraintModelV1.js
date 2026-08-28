// ─── PLANNING CONSTRAINT MODEL V1 ────────────────────────────────────────────
// Contraintes persistantes compréhensibles par le moteur déterministe.
// Une contrainte de planning est distincte d'un fait de calendrier ressource :
// « Steven absent » vit dans planning_resource_events ; « Steven requis sur
// cette tâche » vit ici.

export const CONSTRAINT_MODEL_VERSION = 1;

export const CONSTRAINT_TYPES = Object.freeze({
  NOT_BEFORE: "not_before",
  DEADLINE: "deadline",
  FIXED_DATE: "fixed_date",
  RESOURCE_REQUIRED: "resource_required",
  RESOURCE_FORBIDDEN: "resource_forbidden",
  ALLOCATION_LOCK: "allocation_lock",
  PRIORITY: "priority",
});

export const CONSTRAINT_SCOPES = Object.freeze({
  GLOBAL: "global",
  CHANTIER: "chantier",
  GROUPE: "groupe",
  TACHE: "tache",
  ALLOCATION: "allocation",
});

export const CONSTRAINT_SOURCES = Object.freeze({
  MANUEL: "manuel",
  ASSISTANT: "assistant",
  SYSTEME: "systeme",
  IMPORT: "import",
});

const str = v => String(v ?? "").trim();
const num = v => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = v => str(v).slice(0, 10) || null;

const HARD_DEFAULT = new Set([
  CONSTRAINT_TYPES.NOT_BEFORE,
  CONSTRAINT_TYPES.DEADLINE,
  CONSTRAINT_TYPES.FIXED_DATE,
  CONSTRAINT_TYPES.RESOURCE_REQUIRED,
  CONSTRAINT_TYPES.RESOURCE_FORBIDDEN,
  CONSTRAINT_TYPES.ALLOCATION_LOCK,
]);

export function normaliserContraintePlanning(value) {
  const c = value && typeof value === "object" ? value : {};
  const type = Object.values(CONSTRAINT_TYPES).includes(c.type) ? c.type : null;
  const scope = Object.values(CONSTRAINT_SCOPES).includes(c.scope) ? c.scope : CONSTRAINT_SCOPES.CHANTIER;
  const config = c.config && typeof c.config === "object" && !Array.isArray(c.config) ? { ...c.config } : {};
  const resourceIds = Array.isArray(config.resource_ids)
    ? [...new Set(config.resource_ids.map(str).filter(Boolean))]
    : [];
  return {
    ...c,
    id: str(c.id) || null,
    type,
    scope,
    chantier_id: str(c.chantier_id) || null,
    groupe_type_id: str(c.groupe_type_id) || null,
    tache_id: str(c.tache_id) || null,
    allocation_id: str(c.allocation_id) || null,
    hard: typeof c.hard === "boolean" ? c.hard : HARD_DEFAULT.has(type),
    priority: num(c.priority) ?? 0,
    date_debut: date(c.date_debut),
    date_fin: date(c.date_fin),
    config: { ...config, resource_ids: resourceIds },
    label: str(c.label) || null,
    source: Object.values(CONSTRAINT_SOURCES).includes(c.source) ? c.source : CONSTRAINT_SOURCES.MANUEL,
    actif: c.actif !== false,
  };
}

export function maturiteContraintePlanning(value) {
  const c = normaliserContraintePlanning(value);
  const erreurs = [];
  const warnings = [];
  if (!c.type) erreurs.push("Type de contrainte invalide");
  if (c.scope === CONSTRAINT_SCOPES.CHANTIER && !c.chantier_id) erreurs.push("chantier_id requis pour le scope chantier");
  if (c.scope === CONSTRAINT_SCOPES.GROUPE && !c.groupe_type_id) erreurs.push("groupe_type_id requis pour le scope groupe");
  if (c.scope === CONSTRAINT_SCOPES.TACHE && !c.tache_id) erreurs.push("tache_id requis pour le scope tâche");
  if (c.scope === CONSTRAINT_SCOPES.ALLOCATION && !c.allocation_id) erreurs.push("allocation_id requis pour le scope allocation");

  if (c.type === CONSTRAINT_TYPES.NOT_BEFORE && !c.date_debut) erreurs.push("date_debut requise pour not_before");
  if (c.type === CONSTRAINT_TYPES.DEADLINE && !c.date_fin) erreurs.push("date_fin requise pour deadline");
  if (c.type === CONSTRAINT_TYPES.FIXED_DATE && !c.date_debut) erreurs.push("date_debut requise pour fixed_date");
  if ([CONSTRAINT_TYPES.RESOURCE_REQUIRED, CONSTRAINT_TYPES.RESOURCE_FORBIDDEN].includes(c.type)
      && c.config.resource_ids.length === 0) {
    erreurs.push("Au moins un resource_id est requis");
  }
  if (c.type === CONSTRAINT_TYPES.ALLOCATION_LOCK && !c.allocation_id) erreurs.push("allocation_id requise pour allocation_lock");
  if (c.type === CONSTRAINT_TYPES.PRIORITY && c.priority === 0) warnings.push("Priorité nulle : la contrainte n'a aucun effet");
  if (c.date_debut && c.date_fin && c.date_fin < c.date_debut) erreurs.push("date_fin antérieure à date_debut");
  if (c.type === CONSTRAINT_TYPES.DEADLINE && c.hard) {
    warnings.push("Une deadline hard produit une violation après échéance mais ne bloque jamais définitivement la planification");
  }
  return { valide: erreurs.length === 0, erreurs, warnings, constraint: c };
}

export function contrainteSapplique(value, context = {}) {
  const c = normaliserContraintePlanning(value);
  if (!c.actif) return false;
  switch (c.scope) {
    case CONSTRAINT_SCOPES.GLOBAL:
      return true;
    case CONSTRAINT_SCOPES.CHANTIER:
      return !!c.chantier_id && c.chantier_id === str(context.chantier_id);
    case CONSTRAINT_SCOPES.GROUPE:
      return !!c.groupe_type_id
        && c.groupe_type_id === str(context.groupe_type_id)
        && (!c.chantier_id || c.chantier_id === str(context.chantier_id));
    case CONSTRAINT_SCOPES.TACHE:
      return !!c.tache_id
        && c.tache_id === str(context.tache_id)
        && (!c.chantier_id || c.chantier_id === str(context.chantier_id));
    case CONSTRAINT_SCOPES.ALLOCATION:
      return !!c.allocation_id && c.allocation_id === str(context.allocation_id);
    default:
      return false;
  }
}

// Évalue les contraintes applicables pour une tâche / allocation à une date et,
// optionnellement, pour une ressource candidate. Une deadline dépassée devient
// une VIOLATION, jamais un blocage : le moteur doit continuer à planifier.
export function evaluerContraintesPlanning({ contraintes = [], context = {}, dateISO = null, resourceId = null } = {}) {
  const d = date(dateISO);
  const rid = str(resourceId) || null;
  const applicable = (Array.isArray(contraintes) ? contraintes : [])
    .map(normaliserContraintePlanning)
    .filter(c => contrainteSapplique(c, context));

  const blocks = [];
  const violations = [];
  const preferences = [];
  let locked = false;
  let score = 0;

  for (const c of applicable) {
    switch (c.type) {
      case CONSTRAINT_TYPES.NOT_BEFORE: {
        if (d && c.date_debut && d < c.date_debut) {
          const info = { constraint_id: c.id, type: c.type, explication: `Ne peut pas démarrer avant le ${c.date_debut}` };
          if (c.hard) blocks.push(info); else preferences.push({ ...info, respectee: false });
        }
        break;
      }
      case CONSTRAINT_TYPES.DEADLINE: {
        if (d && c.date_fin && d > c.date_fin) {
          violations.push({ constraint_id: c.id, type: c.type, explication: `Deadline dépassée depuis le ${c.date_fin}` });
        }
        break;
      }
      case CONSTRAINT_TYPES.FIXED_DATE: {
        if (!d || !c.date_debut) break;
        const fin = c.date_fin || c.date_debut;
        if (d < c.date_debut || d > fin) {
          const info = { constraint_id: c.id, type: c.type, explication: `Intervention fixée entre le ${c.date_debut} et le ${fin}` };
          if (c.hard) blocks.push(info); else preferences.push({ ...info, respectee: false });
          if (d > fin) violations.push({ ...info, explication: `Fenêtre fixe dépassée depuis le ${fin}` });
        }
        break;
      }
      case CONSTRAINT_TYPES.RESOURCE_REQUIRED: {
        if (rid && !c.config.resource_ids.includes(rid)) {
          const info = { constraint_id: c.id, type: c.type, resource_id: rid, explication: "Ressource non autorisée : une autre ressource est requise" };
          if (c.hard) blocks.push(info); else preferences.push({ ...info, respectee: false });
        }
        break;
      }
      case CONSTRAINT_TYPES.RESOURCE_FORBIDDEN: {
        if (rid && c.config.resource_ids.includes(rid)) {
          const info = { constraint_id: c.id, type: c.type, resource_id: rid, explication: "Ressource explicitement interdite pour ce travail" };
          if (c.hard) blocks.push(info); else preferences.push({ ...info, respectee: false });
        }
        break;
      }
      case CONSTRAINT_TYPES.ALLOCATION_LOCK:
        locked = true;
        break;
      case CONSTRAINT_TYPES.PRIORITY:
        score += c.priority;
        preferences.push({ constraint_id: c.id, type: c.type, score: c.priority, respectee: true, explication: `Priorité ${c.priority >= 0 ? '+' : ''}${c.priority}` });
        break;
      default:
        break;
    }
  }

  return {
    eligible: blocks.length === 0,
    locked,
    score,
    blocks,
    violations,
    preferences,
    applied_constraint_ids: applicable.map(c => c.id).filter(Boolean),
    explication: {
      regle: "Les contraintes hard peuvent bloquer une date ou une ressource ; les deadlines dépassées restent planifiables mais génèrent une violation ; les priorités modifient seulement le score.",
      nb_appliquees: applicable.length,
    },
  };
}
