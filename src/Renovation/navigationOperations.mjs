// ─────────────────────────────────────────────────────────────────────────────
// Navigation « Opérations porte d'entrée » (Refonte Opérations, lot 5).
//
// Module PUR : aucune base, aucune horloge, aucun effet de bord. Les données
// arrivent en paramètre. Façade front : navigationOperations.js.
//
//   - onglets de la page Opérations (À l'étude · En cours · Terminées ·
//     Perdues · Sans chantier), à partir du statut CALCULÉ de l'opération
//     (statutOperation, statutsChantier.mjs — jamais saisi) ;
//   - pages retirées du menu (la liste Chantiers) tout en restant ouvrables
//     par lien (la fiche chantier garde l'identifiant de page « chantiers ») ;
//   - fil d'Ariane « Opérations › Opération › Chantier » de la fiche chantier ;
//   - règle d'ajout de la page « operations » aux rôles qui voyaient
//     « chantiers » (configuration d'accès en base, sans rien retirer).
// ─────────────────────────────────────────────────────────────────────────────
import { statutOperation } from "./statutsChantier.mjs";

// ─── Onglets de la page Opérations ──────────────────────────────────────────
// `statut` = valeur renvoyée par statutOperation(). « Sans chantier » (vide)
// a son propre onglet, toujours affiché : une opération vide n'est ni « À
// l'étude » ni « Terminée », et elle ne doit pas disparaître de l'écran.
export const ONGLETS_OPERATIONS = Object.freeze([
  Object.freeze({ id: "a_l_etude", label: "À l'étude",     vide: "Aucune opération à l'étude." }),
  Object.freeze({ id: "en_cours",  label: "En cours",      vide: "Aucune opération en cours." }),
  Object.freeze({ id: "terminee",  label: "Terminées",     vide: "Aucune opération terminée." }),
  Object.freeze({ id: "perdue",    label: "Perdues",       vide: "Aucune opération perdue." }),
  Object.freeze({ id: "vide",      label: "Sans chantier", vide: "Aucune opération sans chantier." }),
]);

export const ONGLET_OPERATIONS_DEFAUT = "en_cours";

const IDS_ONGLETS = new Set(ONGLETS_OPERATIONS.map((o) => o.id));

export function estOngletOperations(id) {
  return IDS_ONGLETS.has(id);
}

/**
 * Répartit les opérations dans les onglets.
 * operations : [{ id, … }] ; chantiers : [{ id, operation_id, statut, … }]
 * → { parOnglet: { a_l_etude: [op…], … }, compteurs: { a_l_etude: n, … },
 *     statutParOperation: { [opId]: statutOperation(…) } }
 * Chaque opération est dans UN et un seul onglet.
 */
export function repartirOperationsParOnglet(operations = [], chantiers = []) {
  const parOnglet = Object.fromEntries(ONGLETS_OPERATIONS.map((o) => [o.id, []]));
  const statutParOperation = {};
  const liste = Array.isArray(chantiers) ? chantiers : [];
  (Array.isArray(operations) ? operations : []).forEach((op) => {
    if (!op || !op.id) return;
    const so = statutOperation(liste.filter((c) => c && c.operation_id === op.id));
    statutParOperation[op.id] = so;
    (parOnglet[so.statut] || parOnglet.vide).push(op);
  });
  const compteurs = Object.fromEntries(Object.entries(parOnglet).map(([k, v]) => [k, v.length]));
  return { parOnglet, compteurs, statutParOperation };
}

/**
 * Onglet à afficher : celui demandé s'il existe ; sinon « En cours » s'il
 * contient quelque chose ; sinon le premier onglet non vide ; sinon « En
 * cours » (l'onglet vide l'écrit lui-même : jamais de page blanche).
 */
export function ongletInitialOperations(compteurs = {}, demande = null) {
  if (demande && IDS_ONGLETS.has(demande)) return demande;
  if ((compteurs[ONGLET_OPERATIONS_DEFAUT] || 0) > 0) return ONGLET_OPERATIONS_DEFAUT;
  const premier = ONGLETS_OPERATIONS.find((o) => (compteurs[o.id] || 0) > 0);
  return premier ? premier.id : ONGLET_OPERATIONS_DEFAUT;
}

// ─── Menu ───────────────────────────────────────────────────────────────────
// Pages qui gardent leur identifiant (droit d'accès, liens « ouvrir le
// chantier ») mais ne figurent plus dans le menu. « chantiers » = la fiche
// chantier, ouverte depuis une opération ou un lien.
export const PAGES_HORS_MENU = Object.freeze(["chantiers"]);

export function estPageDuMenu(pageId) {
  return !PAGES_HORS_MENU.includes(pageId);
}

/**
 * Page réellement ouverte quand on demande `pageId` par un lien générique
 * (journal des mises à jour, page d'arrivée) : la liste Chantiers n'est plus
 * une destination ; on va dans Opérations si le rôle y a accès. Sinon on
 * garde « chantiers » : le repli le plus prudent est de ne jamais perdre
 * l'accès à ses chantiers.
 */
export function pageDestination(pageId, peutOuvrir = () => true) {
  if (pageId === "chantiers" && peutOuvrir("operations")) return "operations";
  return pageId;
}

// ─── Fil d'Ariane de la fiche chantier ──────────────────────────────────────
/**
 * chantier : { id, nom, operation_id } ; operations : [{ id, nom }]
 * → { operationId, operationNom, operationConnue, chantierNom, texte }
 * Une opération introuvable s'écrit « opération introuvable », jamais un vide.
 */
export function filArianeChantier(chantier, operations = []) {
  const opId = chantier?.operation_id || null;
  const op = opId ? (Array.isArray(operations) ? operations : []).find((o) => o && o.id === opId) : null;
  const chantierNom = chantier?.nom || chantier?.id || "Chantier";
  const operationNom = op?.nom || (opId ? "Opération introuvable" : "Sans opération");
  return {
    operationId: opId,
    operationNom,
    operationConnue: !!op,
    chantierNom,
    texte: `Opérations › ${operationNom} › ${chantierNom}`,
  };
}

// ─── Configuration d'accès : ajout de « operations » ────────────────────────
/**
 * rolePages : { [roleId]: [pageId…] } (planning_config.access_pages_renovation)
 * → { apres, ajouts: [roleId…] } : « operations » ajouté à chaque rôle qui
 * a « chantiers » et ne l'a pas encore. Rien n'est retiré, l'ordre des pages
 * existantes est conservé, les autres rôles sont recopiés tels quels.
 */
export function ajouterOperationsAuxRoles(rolePages = {}) {
  const apres = {};
  const ajouts = [];
  Object.entries(rolePages && typeof rolePages === "object" ? rolePages : {}).forEach(([role, pages]) => {
    const liste = Array.isArray(pages) ? [...pages] : pages;
    if (Array.isArray(liste) && liste.includes("chantiers") && !liste.includes("operations")) {
      liste.push("operations");
      ajouts.push(role);
    }
    apres[role] = liste;
  });
  return { apres, ajouts };
}
