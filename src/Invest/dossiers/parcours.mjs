// src/Invest/dossiers/parcours.mjs — Catalogue du parcours Dossier Invest (V1).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// Référence unique des clés du parcours ; la migration
// supabase/migrations/20260930190000_invest_dossiers_tranche1.sql reprend les
// mêmes clés dans ses contraintes, et scripts/verif-invest-dossiers-t1.mjs
// vérifie que les deux listes sont identiques.
//
// Façade front : ./parcours.js (export * from "./parcours.mjs").

// ── Les 11 étapes, dans l'ordre du parcours ────────────────────────────────
export const ETAPES_PARCOURS = Object.freeze([
  { cle: "signature",     libelle: "Signature",     numero: 1,  portee: "dossier" },
  { cle: "collecte",      libelle: "Collecte",      numero: 2,  portee: "dossier" },
  { cle: "documents",     libelle: "Documents",     numero: 3,  portee: "dossier" },
  { cle: "analyse",       libelle: "Analyse",       numero: 4,  portee: "dossier" },
  { cle: "strategie",     libelle: "Stratégie",     numero: 5,  portee: "dossier" },
  { cle: "recherche",     libelle: "Recherche",     numero: 6,  portee: "dossier" },
  { cle: "opportunites",  libelle: "Opportunités",  numero: 7,  portee: "dossier" },
  // 8 à 11 : portée « opération » à partir de la Tranche 5 (D1) ; en Tranche 1
  // elles existent au niveau du dossier, à titre transitoire.
  { cle: "financement",   libelle: "Financement",   numero: 8,  portee: "operation" },
  { cle: "structuration", libelle: "Structuration", numero: 9,  portee: "operation" },
  { cle: "acquisition",   libelle: "Acquisition",   numero: 10, portee: "operation" },
  { cle: "suivi",         libelle: "Suivi",         numero: 11, portee: "operation" },
]);
export const CLES_ETAPES = Object.freeze(ETAPES_PARCOURS.map((e) => e.cle));

export const STATUTS_ETAPE = Object.freeze({
  a_venir:        "À venir",
  en_cours:       "En cours",
  en_attente:     "En attente",
  bloquee:        "Bloquée",
  terminee:       "Terminée",
  non_applicable: "Non applicable",
});
// Statuts où quelqu'un doit agir : la balle est alors obligatoire (A14).
export const STATUTS_AVEC_BALLE = Object.freeze(["en_cours", "en_attente", "bloquee"]);

export const BALLES = Object.freeze({
  client:  "Client",
  profero: "Profero",
  banque:  "Banque",
  notaire: "Notaire",
  tiers:   "Tiers",
});

export const STATUTS_DOSSIER = Object.freeze({
  ouvert:    "Ouvert",
  actif:     "Actif",
  suspendu:  "Suspendu",
  clos:      "Clos",
  abandonne: "Abandonné",
});
export const STATUTS_DOSSIER_NON_CLOS = Object.freeze(["ouvert", "actif", "suspendu"]);

export const TYPES_MISSION = Object.freeze({
  accompagnement_acquisition: "Accompagnement à l'acquisition",
  audit_patrimonial:          "Audit patrimonial",
  conseil:                    "Conseil",
  autre:                      "Autre",
});

// « inconnu » : utilisé par la reprise quand rien ne permet de savoir si la
// lettre de mission existe. Une absence d'information ne doit jamais se lire
// « à émettre » (invariant : une impossibilité reste visible).
export const STATUTS_LETTRE_MISSION = Object.freeze({
  a_emettre:      "À émettre",
  envoyee:        "Envoyée",
  signee:         "Signée",
  non_applicable: "Non applicable",
  inconnu:        "Inconnu (reprise)",
});

export const ORIGINES_DOSSIER = Object.freeze({
  creation_crm:        "Création depuis le CRM",
  conversion_prospect: "Conversion d'un prospect",
  reprise_existant:    "Reprise de l'existant",
});

export const NATURES_ACTION = Object.freeze({
  tache:                "Tâche",
  echeance:             "Échéance",
  condition_suspensive: "Condition suspensive",
});

export const TYPES_EVENEMENT = Object.freeze({
  dossier_cree:                  "Dossier créé",
  dossier_statut_change:         "Statut du dossier modifié",
  dossier_modifie:               "Dossier modifié",
  lettre_mission_change:         "Lettre de mission modifiée",
  conseiller_change:             "Conseiller modifié",
  etape_statut_change:           "Statut d'étape modifié",
  etape_balle_change:            "Responsable de balle modifié",
  etape_echeance_change:         "Échéance modifiée",
  etape_prochaine_action_change: "Prochaine action modifiée",
  etape_bloquee:                 "Étape bloquée",
  etape_debloquee:               "Étape débloquée",
  reprise_importee:              "Reprise de l'existant",
});

// ── Correspondance des anciennes étapes de mission (step_key) ──────────────
// Une clé absente (urbanisme, ou toute clé inconnue comme « priorite ») ne
// reçoit AUCUNE étape : elle reste « à classer » (A4).
export const STEP_KEY_VERS_ETAPE = Object.freeze({
  signature:            "signature",
  lancement:            "collecte",
  recherche:            "recherche",
  presentation_bien:    "opportunites",
  financement:          "financement",
  acquisition:          "acquisition",
  signature_definitive: "acquisition",
  enedis:               "suivi",
  travaux:              "suivi",
  apres_travaux:        "suivi",
});

/** Étape canonique d'une ancienne step_key, ou null (« à classer »). */
export function etapeDepuisStepKey(stepKey) {
  const cle = String(stepKey ?? "").trim();
  return Object.prototype.hasOwnProperty.call(STEP_KEY_VERS_ETAPE, cle) ? STEP_KEY_VERS_ETAPE[cle] : null;
}

// ── Anciennes étapes client (invest_clients.etape, 13 étapes) ──────────────
// Pour chaque position : étapes terminées et étapes en cours ; le reste est à
// venir. « approximatif » signale une correspondance à confirmer en priorité.
export const POSITIONS_ETAPES_CLIENT = Object.freeze({
  1:  { libelle: "Signature contrat",                           terminees: [], en_cours: ["signature"] },
  2:  { libelle: "Envoi des documents d'analyse",               terminees: ["signature"], en_cours: ["collecte", "documents"] },
  3:  { libelle: "Définition de la stratégie d'investissement", terminees: ["signature", "collecte", "documents", "analyse"], en_cours: ["strategie"] },
  4:  { libelle: "Recherche du projet (visites et analyse)",    terminees: ["signature", "collecte", "documents", "analyse", "strategie"], en_cours: ["recherche"] },
  5:  { libelle: "Présentation des projets",                    terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche"], en_cours: ["opportunites"] },
  6:  { libelle: "Offre d'achat",                               terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites"], en_cours: ["acquisition"] },
  7:  { libelle: "Réalisation des devis précis",                terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites"], en_cours: ["acquisition"], approximatif: true },
  8:  { libelle: "Signature du compromis",                      terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites"], en_cours: ["acquisition"] },
  9:  { libelle: "Réalisation du dossier bancaire",             terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites"], en_cours: ["financement", "acquisition"] },
  10: { libelle: "Obtention du financement",                    terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites"], en_cours: ["financement", "acquisition"] },
  11: { libelle: "Réalisation des dossiers d'urbanismes",       terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites", "financement"], en_cours: ["acquisition"], approximatif: true },
  12: { libelle: "Validation des conditions suspensives d'achat", terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites", "financement"], en_cours: ["acquisition"] },
  13: { libelle: "Signature Notaire",                           terminees: ["signature", "collecte", "documents", "analyse", "strategie", "recherche", "opportunites", "financement"], en_cours: ["acquisition"] },
});

/**
 * Lit invest_clients.etape (« 13 Signature Notaire », « 1. Signature contrat »,
 * « Finalisé »…). Renvoie { position: 1..13 } | { finalise: true } | null.
 */
export function lireEtapeClient(texte) {
  const t = String(texte ?? "").trim();
  if (!t) return null;
  if (/^finalis/i.test(t)) return { finalise: true };
  const m = /^(\d{1,2})\s*[.)-]?\s*/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return POSITIONS_ETAPES_CLIENT[n] ? { position: n } : null;
}

// ── Lecture du parcours (dérivations, jamais enregistrées) ─────────────────

const ordre = (cle) => CLES_ETAPES.indexOf(cle);
const STATUTS_ACTION_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);

/**
 * Étape courante et responsable de balle d'un dossier, dérivés de ses étapes.
 * Priorité : bloquée > en cours > en attente ; à égalité, la plus avancée.
 * Renvoie null si aucune étape n'est active (dossier à démarrer ou terminé).
 */
export function etapeCourante(etapes = []) {
  const poids = { bloquee: 3, en_cours: 2, en_attente: 1 };
  const actives = etapes
    .filter((e) => e && !e.operation_id && poids[e.statut])
    .sort((a, b) => poids[b.statut] - poids[a.statut] || ordre(b.etape) - ordre(a.etape));
  const e = actives[0];
  if (!e) return null;
  return {
    etape: e.etape,
    libelle: ETAPES_PARCOURS[ordre(e.etape)]?.libelle ?? e.etape,
    statut: e.statut,
    balle: e.balle ?? null,
    balle_utilisateur_id: e.balle_utilisateur_id ?? null,
    balle_tiers_libelle: e.balle_tiers_libelle ?? null,
    prochaine_action: e.prochaine_action ?? null,
    echeance: e.echeance ?? null,
  };
}

/**
 * Suggestions de changement de statut à partir des tâches (A6) : proposées à
 * Profero, JAMAIS appliquées. Une étape « à venir » avec des tâches ouvertes
 * est suggérée « en cours » ; une étape en cours dont toutes les tâches sont
 * faites est suggérée « terminée ».
 */
export function suggestionsDepuisActions(etapes = [], actions = []) {
  const parEtape = new Map();
  for (const a of actions) {
    if (!a?.etape) continue;
    const s = parEtape.get(a.etape) ?? { ouvertes: 0, faites: 0 };
    if (STATUTS_ACTION_OUVERTE.has(a.status)) s.ouvertes += 1;
    else if (a.status === "fait") s.faites += 1;
    parEtape.set(a.etape, s);
  }
  const suggestions = [];
  for (const e of etapes) {
    if (!e || e.operation_id) continue;
    const s = parEtape.get(e.etape);
    if (!s) continue;
    if (e.statut === "a_venir" && s.ouvertes > 0) {
      suggestions.push({ etape: e.etape, statut_actuel: e.statut, statut_suggere: "en_cours",
        raison: `${s.ouvertes} tâche(s) ouverte(s)` });
    } else if (e.statut === "en_cours" && s.ouvertes === 0 && s.faites > 0) {
      suggestions.push({ etape: e.etape, statut_actuel: e.statut, statut_suggere: "terminee",
        raison: `${s.faites} tâche(s) faite(s), aucune ouverte` });
    }
  }
  return suggestions;
}

/** Message affiché quand la suppression d'un client est refusée. */
export function messageSuppressionClient(error, supprimees) {
  // 23001 : ON DELETE RESTRICT (invest_dossiers.client_id) ; 23503 : clé
  // étrangère sans action. Les deux signifient « des données en dépendent ».
  const code = String(error?.code ?? "");
  if (code === "23001" || code === "23503") {
    return "Ce client possède un Dossier Invest : il ne peut pas être supprimé. "
      + "Passez-le en « Inactif » (ou clôturez son dossier) pour l'archiver.";
  }
  if (error) return `Suppression impossible : ${error.message || "erreur inconnue"}.`;
  if (supprimees === 0) return "Suppression impossible : ce client n'a pas été supprimé (droits insuffisants ou déjà supprimé).";
  return null;
}
