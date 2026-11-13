// ─────────────────────────────────────────────────────────────────────────────
// roleChargeAffaires — rôle « Chargé d'affaires » (Refonte Opérations, lot 6 :
// docs/projets/refonte-operations.md).
//
// Le chargé d'affaires crée les opérations, les chantiers et les clients, fait
// le chiffrage, crée les devis et valide les étapes des phases ÉTUDE et
// CONTRAT du cycle de vie. Les autres phases (Préparation, Travaux, Réception)
// lui sont en LECTURE SEULE, et il ne déclare pas la phase en cours à la main.
// Il n'a accès ni aux pages financières globales ni à l'administration.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Le
// front importe la façade roleChargeAffaires.js ; testé par
// scripts/verif-refonte-lot6.mjs.
//
// La base applique la même règle sur la table chantier_cycle_vie (policy
// restrictive « cycle vie charge affaires etude contrat », migration
// supabase/migrations/20261106140000_refonte_operations_lot6.sql) : la liste
// ETAPES_VALIDABLES_CHARGE_AFFAIRES ci-dessous et celle de la migration sont
// comparées par le script de vérification.
// ─────────────────────────────────────────────────────────────────────────────

import { CYCLE_VIE_PHASES, phaseDeEtape } from "./cycleVie.mjs";

/** Identifiant technique du rôle (colonne utilisateurs.role). */
export const ROLE_CHARGE_AFFAIRES = "charge_affaires";
export const LIBELLE_CHARGE_AFFAIRES = "Chargé d'affaires";
export const COULEUR_CHARGE_AFFAIRES = "#14b8a6";

/**
 * Pages bureau du chargé d'affaires : Opérations (porte d'entrée), la fiche
 * chantier (identifiant « chantiers »), le Chiffrage (« info-client ») et le
 * Journal des MAJ (nouveautés de l'application, sans donnée).
 */
export const PAGES_CHARGE_AFFAIRES = Object.freeze(["operations", "chantiers", "info-client", "journal-maj"]);

/**
 * Pages qu'il ne doit JAMAIS avoir : finances globales et administration.
 * (« dashboard-analyse » est un ancien identifiant encore présent en base.)
 */
export const PAGES_INTERDITES_CHARGE_AFFAIRES = Object.freeze([
  "etats-financiers", "bilan-semaine", "encours-fournisseurs", "rapprochement",
  "heures-salaries", "dashboard-analyse", "admin",
]);

/** Phases du cycle de vie dont il peut valider les étapes. */
export const PHASES_VALIDABLES_CHARGE_AFFAIRES = Object.freeze(["cv_etude", "cv_contrat"]);

/**
 * Rôles dont la validation des étapes est limitée à certaines phases.
 * Un rôle absent de cette table garde le comportement d'avant le lot 6.
 */
export const PHASES_VALIDABLES_PAR_ROLE = Object.freeze({
  [ROLE_CHARGE_AFFAIRES]: PHASES_VALIDABLES_CHARGE_AFFAIRES,
});

/** Étapes (identifiants) des phases Étude et Contrat, dans l'ordre du cycle. */
export const ETAPES_VALIDABLES_CHARGE_AFFAIRES = Object.freeze(
  CYCLE_VIE_PHASES
    .filter((ph) => PHASES_VALIDABLES_CHARGE_AFFAIRES.includes(ph.id))
    .flatMap((ph) => ph.etapes.map((e) => e.id)),
);

const normaliserRole = (role) => String(role || "").trim().toLowerCase();

/** Le rôle est-il limité à certaines phases du cycle de vie ? */
export function estRoleCycleVieRestreint(role) {
  return Object.prototype.hasOwnProperty.call(PHASES_VALIDABLES_PAR_ROLE, normaliserRole(role));
}

/**
 * Le rôle peut-il valider (cocher, importer, dé-valider, joindre une pièce)
 * l'étape `etapeId` ? `phaseId` = phase dans laquelle l'étape est affichée ;
 * à défaut, déduite de l'étape. Une étape dont la phase est inconnue (groupe
 * d'exécution, échéance de facturation…) n'est validable que par un rôle non
 * restreint : en cas de doute, lecture seule.
 * L'ouvrier ne valide rien depuis la fiche bureau (il n'y a pas accès).
 */
export function peutValiderEtape({ role, etapeId = null, phaseId = null } = {}) {
  const r = normaliserRole(role);
  if (!r || r === "ouvrier") return false;
  const phases = PHASES_VALIDABLES_PAR_ROLE[r];
  if (!phases) return true;
  const phase = phaseId || phaseDeEtape(etapeId)?.id || null;
  return !!phase && phases.includes(phase);
}

/** Peut-il valider les étapes d'une phase entière ? */
export function peutValiderPhase({ role, phaseId } = {}) {
  return peutValiderEtape({ role, phaseId });
}

/**
 * Peut-il déclarer la phase en cours à la main (« Déclarer comme phase en
 * cours », « Revenir à l'automatique ») ? Non pour un rôle restreint : ce
 * choix pilote toute la frise, y compris les phases qui lui sont fermées.
 */
export function peutDeclarerPhase(role) {
  const r = normaliserRole(role);
  return !!r && r !== "ouvrier" && !estRoleCycleVieRestreint(r);
}

/** Phrase affichée sur une phase en lecture seule pour ce rôle (null sinon). */
export function messageLectureSeule({ role, phaseId } = {}) {
  if (!estRoleCycleVieRestreint(role) || peutValiderPhase({ role, phaseId })) return null;
  const noms = CYCLE_VIE_PHASES
    .filter((ph) => PHASES_VALIDABLES_PAR_ROLE[normaliserRole(role)].includes(ph.id))
    .map((ph) => ph.nom);
  return `Lecture seule : en tant que ${LIBELLE_CHARGE_AFFAIRES.toLowerCase()}, vous validez les étapes des phases ${noms.join(" et ")}. Les autres phases sont validées par le conducteur de travaux ou un administrateur.`;
}

/**
 * Collaborateur proposé comme chargé d'affaires d'une opération ou d'un
 * chantier (lot 2) : compte actif, hors ouvriers. Le rôle chargé d'affaires y
 * est donc inclus, comme admin, conducteur, commercial, comptable.
 */
export function estCollaborateurProposable(u) {
  return !!u && u.actif !== false && normaliserRole(u.role) !== "ouvrier";
}

/**
 * Ajoute le rôle à la configuration d'accès enregistrée en base
 * (planning_config.access_pages_renovation) SANS rien retirer aux autres
 * rôles. Si le rôle existe déjà, il n'est pas modifié (idempotent).
 * Renvoie { apres, ajoute }.
 */
export function ajouterRoleChargeAffaires(rolePages) {
  const avant = rolePages && typeof rolePages === "object" && !Array.isArray(rolePages) ? rolePages : {};
  if (Array.isArray(avant[ROLE_CHARGE_AFFAIRES])) return { apres: { ...avant }, ajoute: false };
  return { apres: { ...avant, [ROLE_CHARGE_AFFAIRES]: [...PAGES_CHARGE_AFFAIRES] }, ajoute: true };
}

/** Même chose pour la liste des rôles (planning_config.access_roles_renovation). */
export function ajouterRoleAListe(items) {
  const liste = Array.isArray(items) ? items : [];
  if (liste.some((r) => r?.id === ROLE_CHARGE_AFFAIRES)) return { apres: [...liste], ajoute: false };
  return {
    apres: [...liste, { id: ROLE_CHARGE_AFFAIRES, label: LIBELLE_CHARGE_AFFAIRES, color: COULEUR_CHARGE_AFFAIRES }],
    ajoute: true,
  };
}
