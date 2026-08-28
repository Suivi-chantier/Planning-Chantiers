// ─── RÈGLES GLOBALES PROFERO — PLANNING V1 ───────────────────────────────────
// Référentiel versionné du moteur de planification.
// Ces règles décrivent le fonctionnement NORMAL de Profero ; les ouvrages V2
// et les contraintes chantier peuvent les préciser ou les surcharger.
//
// IMPORTANT : `equipe_id` et `ouvriers_prio` vivent déjà dans `groupes_types`
// (planning_config) et restent des PRÉFÉRENCES, jamais des compétences hard.

export const PLANNING_RULES_VERSION = 1;

export const CONTINUITE = Object.freeze({
  FAIBLE: "faible",
  MOYENNE: "moyenne",
  FORTE: "forte",
});

export const GROUPE_RULES_V1 = Object.freeze({
  gt_demolition: {
    ordre: 10,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.MOYENNE,
    notes: "À réaliser tôt par préférence. Les dépendances sont principalement propres aux ouvrages concernés.",
  },
  gt_1785154120513: {
    ordre: 20,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Maçonnerie. Peut comporter des délais techniques de prise/séchage. Équipe actuelle à confirmer avant usage moteur.",
  },
  gt_menuiserie_ext: {
    ordre: 30,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "À favoriser tôt. Peut devenir bloquante lorsqu'une mise hors d'air est nécessaire.",
  },
  gt_couverture_ext: {
    ordre: 40,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Souvent intervention externe. Peut devenir bloquante lorsqu'une mise hors d'eau est nécessaire.",
  },
  gt_reseau_plomberie: {
    ordre: 50,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Peut travailler en parallèle du réseau électrique. Doit précéder la fermeture des supports concernés.",
  },
  gt_ossature_placo: {
    ordre: 60,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Les ossatures nécessaires aux réseaux doivent être disponibles avant leur passage. Peut progresser par zone.",
  },
  gt_reseau_elec: {
    ordre: 70,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Tableau/GTL inclus dans cette phase. Peut travailler en parallèle de la plomberie. Doit précéder la fermeture.",
  },
  gt_laine_placo: {
    ordre: 80,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Fermeture après réseaux. Inclut opérations susceptibles d'imposer des temps de séchage.",
  },
  gt_peinture: {
    ordre: 90,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FORTE,
    notes: "Supports finis et secs. Les temps de séchage entre couches sont des contraintes calendrier, pas des heures de MO.",
  },
  gt_sols: {
    ordre: 100,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.MOYENNE,
    notes: "Après peinture par préférence, pas comme interdiction absolue. Éviter les micro-interventions dispersées.",
  },
  gt_appareillage_elec: {
    ordre: 110,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.MOYENNE,
    notes: "Appareillage final, luminaires, radiateurs et mise en service. Réseaux préalables terminés.",
  },
  gt_appareillage_plomberie: {
    ordre: 120,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.MOYENNE,
    notes: "Sanitaires, douche, chauffe-eau, cuisine et raccordements finaux. Dépendances principalement portées par les ouvrages V2.",
  },
  gt_finition_generale: {
    ordre: 130,
    fractionnable_default: true,
    continuite_priorite: CONTINUITE.FAIBLE,
    notes: "À positionner tard par préférence. Regrouper les petites interventions pour éviter les déplacements inutiles.",
  },
});

// Relations globales minimales. On garde volontairement peu de HARD afin de
// ne pas bloquer artificiellement tout un chantier pour une tâche sans rapport.
// `scope: "supports_concernes"` rappelle qu'à terme la zone/pièce pourra
// affiner la règle ; en V1, le moteur devra appliquer ces portes avec prudence.
export const GROUPE_DEPENDENCIES_V1 = Object.freeze([
  {
    id: "rule_reseau_plomberie_avant_fermeture",
    predecesseur_groupe_type_id: "gt_reseau_plomberie",
    successeur_groupe_type_id: "gt_laine_placo",
    contrainte: "hard",
    relation: "finish_to_start",
    scope: "supports_concernes",
    explication: "Les réseaux plomberie doivent être passés et contrôlés avant fermeture des supports concernés.",
  },
  {
    id: "rule_reseau_elec_avant_fermeture",
    predecesseur_groupe_type_id: "gt_reseau_elec",
    successeur_groupe_type_id: "gt_laine_placo",
    contrainte: "hard",
    relation: "finish_to_start",
    scope: "supports_concernes",
    explication: "Les réseaux électriques doivent être passés et contrôlés avant fermeture des supports concernés.",
  },
  {
    id: "rule_placo_avant_peinture",
    predecesseur_groupe_type_id: "gt_laine_placo",
    successeur_groupe_type_id: "gt_peinture",
    contrainte: "hard",
    relation: "finish_to_start",
    scope: "supports_concernes",
    explication: "Les supports placo/enduits concernés doivent être terminés et suffisamment secs avant peinture.",
  },
  {
    id: "rule_peinture_avant_appareillage_elec",
    predecesseur_groupe_type_id: "gt_peinture",
    successeur_groupe_type_id: "gt_appareillage_elec",
    contrainte: "hard",
    relation: "finish_to_start",
    scope: "supports_concernes",
    explication: "L'appareillage électrique final est posé sur des supports finis ; les exceptions restent possibles au niveau ouvrage/chantier.",
  },
  {
    id: "pref_peinture_avant_sols",
    predecesseur_groupe_type_id: "gt_peinture",
    successeur_groupe_type_id: "gt_sols",
    contrainte: "soft",
    relation: "finish_to_start",
    scope: "chantier",
    explication: "Profero préfère terminer la peinture avant les sols, sans en faire une interdiction technique absolue.",
  },
  {
    id: "pref_sols_avant_finitions",
    predecesseur_groupe_type_id: "gt_sols",
    successeur_groupe_type_id: "gt_finition_generale",
    contrainte: "soft",
    relation: "finish_to_start",
    scope: "chantier",
    explication: "Les finitions générales sont préférées après les sols afin de regrouper les dernières interventions.",
  },
]);

export function regleGroupe(groupeTypeId) {
  return GROUPE_RULES_V1[String(groupeTypeId || "")] || null;
}

export function dependancesGlobalesPourSuccesseur(groupeTypeId) {
  const id = String(groupeTypeId || "");
  return GROUPE_DEPENDENCIES_V1.filter(r => r.successeur_groupe_type_id === id);
}
