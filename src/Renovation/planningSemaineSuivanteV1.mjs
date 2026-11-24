// ─────────────────────────────────────────────────────────────────────────────
// « La semaine qui vient » — assemblage partagé entre la page « Bilan de
// semaine » (BilanPeriode.jsx, carte « La semaine qui vient ») et le bloc du
// tableau de bord « Planning de la semaine suivante » (projet
// docs/projets/organisation-par-jour.md, tâche 11, règle 9 : aucun calcul
// réécrit).
//
// Ce module ne CALCULE rien de nouveau : il regroupe, à l'identique, ce que la
// page faisait elle-même après l'appel du moteur de planning
// (simulerPlanningGlobalV1, chargé par semaineQuiVientDonnees.js) :
//   - fenêtre : fenetreSemaineProchaineV1(semaineIsoV3(date)) ;
//   - découpe : bilanSemaineProchaineV1({ resultatMoteur, fenetre }) ;
//   - fin prévisionnelle par chantier : finPrevisionnelleParChantierV1 ;
//   - noms : chantier de la liste de la page, sinon du référentiel du moteur ;
//     personne : nom_planning, sinon nom, sinon identifiant.
// Le bloc ajoute seulement sa présentation (6 lignes max, « et N autres »,
// ligne « Montant prévisionnel : fonctionnalité à venir »).
//
// MÊME CHIFFRE = MÊME SERVICE : la page et le bloc appellent ces fonctions.
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

import { semaineIsoV3, fmtJourV3 } from "./bilanPeriodeV3.mjs";
import { bilanSemaineProchaineV1, fenetreSemaineProchaineV1 } from "./bilanSemaineProchaineV1.mjs";
import { finPrevisionnelleParChantierV1 } from "./planningFinPrevisionnelleV1.mjs";

/** Horizon du moteur lancé pour la semaine qui vient (valeur de la page). */
export const HORIZON_SEMAINE_QUI_VIENT_JOURS = 42;

/** Ligne fixe du bloc (règle 10) : le calcul des euros est un projet à part. */
export const MESSAGE_MONTANT_PREVISIONNEL = "Montant prévisionnel : fonctionnalité à venir";

/** Nombre maximal de lignes par liste dans le bloc. */
export const LIGNES_MAX_PLANNING_SEMAINE_SUIVANTE = 6;

const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Fenêtre des 7 jours de la semaine qui SUIT celle de `dateIso`
 * (page : dernier jour de la période affichée ; bloc : date du jour).
 * @returns {{ debut:string, fin:string, jours:string[] }|null}
 */
export function fenetreSemaineSuivanteV1(dateIso) {
  const d = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return fenetreSemaineProchaineV1(semaineIsoV3(d));
}

/**
 * Résultat du moteur → ce que la page garde en mémoire (à l'identique de
 * l'ancien code de BilanPeriode.jsx).
 * @returns {{ decoupe: object, referentiel: object|null, fins: Map }}
 */
export function assemblerSemaineQuiVientV1({ resultatMoteur, fenetre }) {
  return {
    decoupe: bilanSemaineProchaineV1({ resultatMoteur, fenetre }),
    referentiel: resultatMoteur?.referentiel || null,
    // Fin prévisionnelle par chantier (même module que la semaine qui vient).
    fins: new Map(finPrevisionnelleParChantierV1(resultatMoteur).chantiers.map(c => [c.chantier_id, c])),
  };
}

/**
 * Noms affichés, tels que la page les résout.
 * @param {{ chantiers?: Array, referentiel?: object|null }} p
 */
export function nomsSemaineQuiVientV1({ chantiers = [], referentiel = null } = {}) {
  const ref = referentiel;
  const nomChantier = id => (chantiers || []).find(c => c.id === id)?.nom || (ref?.chantiers || []).find(c => c.id === id)?.nom || id;
  const nomRessource = id => { const r = (ref?.ressources || []).find(x => x.id === id); return r?.nom_planning || r?.nom || id; };
  return { nomChantier, nomRessource };
}

/** Heures arrondies à l'heure, comme les lignes « La semaine qui vient » de la page. */
export const fmtHeuresSemaineQuiVient = h => `${Math.round(num(h) || 0)} h`;

const numeroSemaine = fenetre => {
  const m = /W(\d+)/.exec(fenetre?.debut ? semaineIsoV3(fenetre.debut) : "");
  return m ? Number(m[1]) : null;
};

function tronquer(liste, max) {
  return { lignes: liste.slice(0, max), autres: Math.max(0, liste.length - max) };
}

/**
 * État affiché par le bloc (règle 10 : une impossibilité reste visible).
 * @param {object} p
 * @param {object|null} p.fenetre        fenetreSemaineSuivanteV1(date du jour)
 * @param {boolean} [p.chargement]
 * @param {string|null} [p.erreur]       message d'erreur du moteur / de la lecture
 * @param {object|null} [p.decoupe]      bilanSemaineProchaineV1(...)
 * @param {Function} [p.nomChantier]     nomsSemaineQuiVientV1(...).nomChantier
 * @param {Function} [p.nomRessource]    nomsSemaineQuiVientV1(...).nomRessource
 * @param {number} [p.max]
 */
export function etatBlocPlanningSemaineSuivanteV1({
  fenetre, chargement = false, erreur = null, decoupe = null,
  nomChantier = id => id, nomRessource = id => id, max = LIGNES_MAX_PLANNING_SEMAINE_SUIVANTE,
} = {}) {
  const n = numeroSemaine(fenetre);
  const libelleSemaine = fenetre ? `Semaine ${n} · du ${fmtJourV3(fenetre.debut)} au ${fmtJourV3(fenetre.fin)}` : null;
  const explication = fenetre
    ? `Ce que le moteur placerait du ${fmtJourV3(fenetre.debut)} au ${fmtJourV3(fenetre.fin)} — rien n'est enregistré, rien n'est appliqué.`
    : null;
  const base = {
    libelleSemaine, explication, total: null, chantiers: [], autresChantiers: 0, personnes: [], autresPersonnes: 0,
    auDelaHorizon: [], montant: MESSAGE_MONTANT_PREVISIONNEL,
  };
  if (!fenetre) return { ...base, etat: "erreur", metrique: "erreur", message: "Semaine illisible : la semaine suivante ne peut pas être déterminée." };
  if (erreur) return { ...base, etat: "erreur", metrique: "erreur", message: `La semaine qui vient n'a pas pu être calculée : ${erreur}` };
  if (chargement || !decoupe) return { ...base, etat: "chargement", metrique: "calcul…", message: "La semaine qui vient : calcul en cours." };

  const auDelaHorizon = listeSure(decoupe.chantiers_au_dela_horizon).map(c => nomChantier(c.chantier_id || c));
  const parChantier = listeSure(decoupe.par_chantier);
  if (parChantier.length === 0) {
    return { ...base, auDelaHorizon, etat: "aucune_heure", metrique: "aucune heure",
      message: `Aucune heure prévue la semaine ${n}. Le moteur ne propose aucune intervention sur ces 7 jours. Ce n'est pas une erreur : soit il n'y a plus de travail à placer, soit rien n'est éligible sur cette période.` };
  }
  const chantiers = parChantier
    .map(c => ({ id: c.chantier_id, nom: nomChantier(c.chantier_id), heures: num(c.heures_mo), texte: fmtHeuresSemaineQuiVient(c.heures_mo),
      jours: listeSure(c.jours).length }))
    .sort((a, b) => b.heures - a.heures || String(a.nom).localeCompare(String(b.nom), "fr"));
  // Déjà triées par heures décroissantes par bilanSemaineProchaineV1.
  const personnes = listeSure(decoupe.par_personne)
    .map(p => ({ id: p.resource_id, nom: nomRessource(p.resource_id), heures: num(p.heures_mo), texte: fmtHeuresSemaineQuiVient(p.heures_mo),
      nbChantiers: num(p.nb_chantiers) }));
  const tc = tronquer(chantiers, max);
  const tp = tronquer(personnes, max);
  const totalH = num(decoupe.resume?.heures_mo);
  const nbC = parChantier.length, nbP = personnes.length;
  return {
    ...base, etat: "ok", message: null, auDelaHorizon,
    metrique: fmtHeuresSemaineQuiVient(totalH),
    total: `${fmtHeuresSemaineQuiVient(totalH)} de main-d'œuvre prévues · ${nbC} chantier${nbC > 1 ? "s" : ""} · ${nbP} personne${nbP > 1 ? "s" : ""}`,
    chantiers: tc.lignes, autresChantiers: tc.autres, personnes: tp.lignes, autresPersonnes: tp.autres,
  };
}
