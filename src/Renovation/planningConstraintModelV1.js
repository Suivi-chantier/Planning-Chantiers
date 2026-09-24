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

const TYPES_PERSONNE = new Set([CONSTRAINT_TYPES.RESOURCE_REQUIRED, CONSTRAINT_TYPES.RESOURCE_FORBIDDEN]);

export function estContraintePersonne(c) {
  return TYPES_PERSONNE.has(c?.type);
}

// Période d'une consigne de personne (resource_required / resource_forbidden) :
// bornes incluses, chacune optionnelle. Les autres types ont leur propre
// lecture des dates (not_before, fixed_date, deadline) et ne sont pas concernés.
export function contraintePersonneActiveLe(c, dateISO) {
  if (!estContraintePersonne(c)) return true;
  const d = date(dateISO);
  if (!d) return true;
  if (c.date_debut && d < c.date_debut) return false;
  if (c.date_fin && d > c.date_fin) return false;
  return true;
}

// Portée assez précise pour qu'une ressource imposée puisse être placée HORS
// de l'équipe du lot : une tâche, ou un lot (groupe_type_id) sur UN chantier.
// Une portée plus large (globale, chantier entier, lot sur tous les chantiers)
// ne fait que restreindre l'équipe, jamais l'élargir.
export function porteePreciseRessourceImposee(c) {
  if (c?.type !== CONSTRAINT_TYPES.RESOURCE_REQUIRED || c.hard !== true) return false;
  if (c.scope === CONSTRAINT_SCOPES.TACHE) return !!c.tache_id;
  if (c.scope === CONSTRAINT_SCOPES.GROUPE) return !!c.groupe_type_id && !!c.chantier_id;
  return false;
}

// Consignes que le moteur NE SAIT PAS appliquer. Elles sont rejetées
// explicitement (code + explication), jamais ignorées en silence. Renvoie null
// si la consigne est prise en compte par le moteur.
export function raisonContrainteSansEffetMoteur(value) {
  const c = normaliserContraintePlanning(value);
  if (!c.actif) return null;
  const m = maturiteContraintePlanning(c);
  if (!m.valide) {
    return {
      code: "contrainte_invalide",
      explication: `Consigne invalide (${m.erreurs.join(" ; ")}) : elle est rejetée et n'a aucun effet sur le planning.`,
    };
  }
  if (c.type === CONSTRAINT_TYPES.ALLOCATION_LOCK) {
    return {
      code: "verrou_hors_adaptateur",
      explication: "Un verrou d'allocation fige une allocation existante avant le calcul ; transmis directement au moteur, il n'a aucun effet.",
    };
  }
  if (c.scope === CONSTRAINT_SCOPES.ALLOCATION) {
    return {
      code: "portee_allocation_non_prise_en_charge",
      explication: "La portée « allocation » n'est prise en charge que pour un verrou : cette consigne est rejetée et n'a aucun effet.",
    };
  }
  if (!c.hard && (c.type === CONSTRAINT_TYPES.NOT_BEFORE || c.type === CONSTRAINT_TYPES.FIXED_DATE)) {
    return {
      code: "date_souhaitee_non_prise_en_charge",
      explication: "Consigne de date « souhaitée » (non obligatoire) : le moteur ne sait pas l'arbitrer, elle est rejetée et n'a aucun effet. La rendre obligatoire ou la retirer.",
    };
  }
  if (c.type === CONSTRAINT_TYPES.PRIORITY && (c.date_debut || c.date_fin)) {
    return {
      code: "priorite_datee_non_prise_en_charge",
      explication: "Priorité limitée à une période : le moteur ne sait pas borner une priorité dans le temps, elle est rejetée et n'a aucun effet. Retirer les dates pour l'appliquer à tout l'horizon.",
    };
  }
  return null;
}

export function contrainteSapplique(value, context = {}) {
  return contrainteNormaliseeSapplique(normaliserContraintePlanning(value), context);
}

// Même règle de portée que contrainteSapplique, sur une contrainte DÉJÀ passée
// par normaliserContraintePlanning (la normalisation est idempotente) : évite
// de re-normaliser dans les boucles du moteur.
export function contrainteNormaliseeSapplique(c, context = {}) {
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
  const applicables = contraintesApplicablesPlanning(
    (Array.isArray(contraintes) ? contraintes : []).map(normaliserContraintePlanning),
    context,
  );
  return evaluerContraintesApplicablesPlanning({ applicables, dateISO, resourceId });
}

// Filtre de portée sur des contraintes DÉJÀ normalisées. Le moteur l'appelle une
// seule fois par travail : la portée ne dépend que du chantier, du groupe et de
// la tâche, jamais de la date ni de la ressource.
export function contraintesApplicablesPlanning(contraintesNormalisees = [], context = {}) {
  return (Array.isArray(contraintesNormalisees) ? contraintesNormalisees : [])
    .filter(c => contrainteNormaliseeSapplique(c, context));
}

// Cœur de evaluerContraintesPlanning, sur des contraintes déjà normalisées ET
// déjà filtrées par portée (contraintesApplicablesPlanning). Résultat identique.
export function evaluerContraintesApplicablesPlanning({ applicables = [], dateISO = null, resourceId = null } = {}) {
  const d = date(dateISO);
  const rid = str(resourceId) || null;
  // Une consigne de personne datée ne vaut qu'entre date_debut et date_fin :
  // hors de cette période, elle n'est ni bloquante ni listée comme appliquée.
  const applicable = (Array.isArray(applicables) ? applicables : [])
    .filter(c => contraintePersonneActiveLe(c, d));

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
