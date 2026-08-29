// ─── CHANTIER 05 — STABILITÉ DES DATES FORECAST V1 ──────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Une date du forecast courant est une préférence SOFT. Pour la faire respecter
// par le moteur V1 sans modifier son noyau, on résout d'abord cette préférence :
// si aucun fait métier ne justifie de l'avancer, on génère une contrainte
// NOT_BEFORE éphémère. Cette contrainte n'est jamais persistée et disparaît au
// recalcul suivant. Retard réel, priorité explicite, deadline ou date fixe
// incompatible cassent la préférence.

import {
  CONSTRAINT_SCOPES,
  CONSTRAINT_SOURCES,
  CONSTRAINT_TYPES,
  contrainteSapplique,
  normaliserContraintePlanning,
} from "./planningConstraintModelV1.js";

export const PLANNING_REPLANNING_DATE_STABILITY_VERSION = 1;

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const dateOnly = v => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function contexte(travail) {
  return {
    chantier_id: txt(travail?.chantier_id) || null,
    groupe_type_id: txt(travail?.groupe_type_id) || null,
    tache_id: txt(travail?.tache_id) || null,
  };
}

function contraintesApplicables(contraintes, travail) {
  return (Array.isArray(contraintes) ? contraintes : [])
    .map(normaliserContraintePlanning)
    .filter(c => contrainteSapplique(c, contexte(travail)));
}

function dateAncrageForecast(travail, startDate) {
  const debut = dateOnly(startDate);
  const dates = (Array.isArray(travail?.stability_forecast?.dates) ? travail.stability_forecast.dates : [])
    .map(dateOnly).filter(Boolean).sort();
  return dates.find(d => !debut || d >= debut) || null;
}

function analyserPreferenceDate({ travail, contraintes, startDate }) {
  const anchor = dateAncrageForecast(travail, startDate);
  if (!anchor) return { appliquer: false, anchor: null, raison: "aucune_date_forecast" };
  const debut = dateOnly(startDate);
  if (debut && anchor <= debut) return { appliquer: false, anchor, raison: "date_forecast_deja_atteinte" };

  const etat = travail?.provenance?.etat_reel || {};
  if (etat.en_retard === true) return { appliquer: false, anchor, raison: "retard_reel_prioritaire" };
  if (num(travail?.priority, 0) > 0) return { appliquer: false, anchor, raison: "priorite_travail_explicitement_positive" };

  const applicable = contraintesApplicables(contraintes, travail);
  const priorite = applicable
    .filter(c => c.type === CONSTRAINT_TYPES.PRIORITY)
    .reduce((s, c) => s + num(c.priority, 0), 0);
  if (priorite > 0) return { appliquer: false, anchor, raison: "priorite_contrainte_explicitement_positive" };

  const deadline = applicable
    .filter(c => c.type === CONSTRAINT_TYPES.DEADLINE && c.date_fin)
    .map(c => c.date_fin).sort()[0] || null;
  if (deadline && deadline < anchor) {
    return { appliquer: false, anchor, raison: "deadline_avant_forecast", deadline };
  }

  const fixedAvant = applicable.find(c =>
    c.type === CONSTRAINT_TYPES.FIXED_DATE
    && c.date_debut
    && (c.date_fin || c.date_debut) < anchor
  );
  if (fixedAvant) {
    return { appliquer: false, anchor, raison: "date_fixe_explicitement_avant_forecast", constraint_id: fixedAvant.id };
  }

  const dejaCouvert = applicable.find(c =>
    c.type === CONSTRAINT_TYPES.NOT_BEFORE
    && c.hard
    && c.date_debut
    && c.date_debut >= anchor
  );
  if (dejaCouvert) {
    return { appliquer: false, anchor, raison: "deja_couvert_par_not_before", constraint_id: dejaCouvert.id };
  }

  return { appliquer: true, anchor, raison: "forecast_compatible_conserve" };
}

export function appliquerStabiliteDatesForecastV1({ travaux = [], contraintes = [], startDate } = {}) {
  const generated = [];
  const decisions = [];

  for (const travail of Array.isArray(travaux) ? travaux : []) {
    const decision = analyserPreferenceDate({ travail, contraintes, startDate });
    decisions.push({
      travail_id: txt(travail?.id) || null,
      chantier_id: txt(travail?.chantier_id) || null,
      tache_id: txt(travail?.tache_id) || null,
      date_ancrage: decision.anchor,
      preference_appliquee: decision.appliquer,
      raison: decision.raison,
      deadline: decision.deadline || null,
      constraint_id: decision.constraint_id || null,
    });
    if (!decision.appliquer) continue;

    generated.push({
      id: `ephemeral_forecast_not_before::${txt(travail.id)}`,
      type: CONSTRAINT_TYPES.NOT_BEFORE,
      scope: CONSTRAINT_SCOPES.TACHE,
      chantier_id: txt(travail.chantier_id) || null,
      tache_id: txt(travail.tache_id) || null,
      hard: true,
      priority: 0,
      date_debut: decision.anchor,
      date_fin: null,
      config: {
        ephemeral: true,
        soft_origin: true,
        policy: "conserver_date_forecast_si_compatible",
      },
      label: "Stabilité forecast — ne pas avancer sans raison métier",
      source: CONSTRAINT_SOURCES.SYSTEME,
      actif: true,
    });
  }

  return {
    contraintes: [...(Array.isArray(contraintes) ? contraintes : []), ...generated],
    contraintes_ephemeres: generated,
    decisions,
    audit: {
      travaux_evalues: decisions.length,
      travaux_avec_date_forecast: decisions.filter(d => d.date_ancrage).length,
      dates_forecast_conservees: generated.length,
      dates_forecast_liberees_retard: decisions.filter(d => d.raison === "retard_reel_prioritaire").length,
      dates_forecast_liberees_priorite: decisions.filter(d => d.raison?.startsWith("priorite_")).length,
      dates_forecast_liberees_deadline: decisions.filter(d => d.raison === "deadline_avant_forecast").length,
      dates_forecast_liberees_date_fixe: decisions.filter(d => d.raison === "date_fixe_explicitement_avant_forecast").length,
    },
    invariants: {
      aucune_persistance: true,
      forecast_reste_une_preference_soft: true,
      contrainte_ephemere_generee_seulement_apres_resolution_metier: true,
      retard_reel_peut_avancer_le_forecast: true,
      priorite_explicite_peut_avancer_le_forecast: true,
      deadline_peut_avancer_le_forecast: true,
    },
  };
}
