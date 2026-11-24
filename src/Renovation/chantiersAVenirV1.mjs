// ─────────────────────────────────────────────────────────────────────────────
// chantiersAVenirV1 — bloc « Chantiers à venir » du tableau de bord du jour
// (projet docs/projets/organisation-par-jour.md, tâche 8).
//
// Aucune règle nouvelle, aucun calcul réécrit (règle 9) : ce module ne fait
// qu'assembler les règles déjà appliquées par la FICHE CHANTIER.
//
//   « Pas encore démarré » : statut du chantier tel que l'affiche la fiche
//     chantier = statutChantier(chantier, phasage) (factureAEmettre.mjs, ex
//     getStatut de PageChantiers) égal à « planifie » (« Planifié » : devis
//     signé, travaux pas commencés ; un chantier « À l'étude » passe en
//     « Planifié » à la signature, statutsChantier.decisionBasculeSignature).
//     Le phasage du chantier est celui de la fiche : trouverPhasage
//     (factureAEmettre.mjs). Chantier archivé : jamais (estChantierArchive).
//   « Avancement de la Préparation » / « ce qui manque » : étapes de la phase
//     « Préparation » du cycle de vie (CYCLE_VIE_PHASES, cycleVie.mjs), chacune
//     évaluée par evaluerEtape avec le MÊME contexte que la fiche pour ces
//     étapes : états enregistrés (etatsCycleVie : table chantier_cycle_vie,
//     sinon reprise de l'ancien cycle du phasage) et etatPhasageMateriaux
//     (étape automatique « Phasage créé »).
//
// Règle 10 : chargement, erreur, « aucun chantier à venir » explicites ; une
// Préparation dont aucune étape n'est renseignée affiche « Préparation non
// renseignée », jamais « 0 % ».
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Façade front : chantiersAVenirV1.js. Vérifié par
// scripts/verif-bloc-chantiers-a-venir.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { getPhase, etatsCycleVie, evaluerEtape, etatPhasageMateriaux } from "./cycleVie.mjs";
import { statutChantier, trouverPhasage } from "./factureAEmettre.mjs";
import { estChantierArchive } from "./chantierActif.mjs";

/** Phase du cycle de vie suivie par le bloc. */
export const PHASE_PREPARATION = "cv_preparation";
/** Statut (fiche chantier) d'un chantier signé, pas encore démarré. */
export const STATUT_A_VENIR = "planifie";
/** Étapes manquantes listées par chantier (les suivantes : « et N autres »). */
export const NB_ETAPES_MANQUANTES_APERCU = 3;
/** Repérage : de quoi appliquer trouverPhasage à tous les chantiers. */
export const COLONNES_PHASAGES_REPERAGE = "id, chantier_id, chantier_nom";
/** Phasages des chantiers à venir : ouvrages (« Phasage créé ») et meta (ancien cycle). */
export const COLONNES_PHASAGES_PREPARATION = "id, chantier_id, chantier_nom, ouvrages, plan_travaux";

const s = (n) => (n > 1 ? "s" : "");

/** Le chantier est-il « à venir » (statut de la fiche = Planifié, non archivé) ? */
export function estChantierAVenir(chantier, phasage) {
  if (!chantier || typeof chantier !== "object") return false;
  if (chantier.id == null || String(chantier.id).trim() === "") return false;
  if (estChantierArchive(chantier)) return false;
  return statutChantier(chantier, phasage) === STATUT_A_VENIR;
}

/**
 * Chantiers à venir, dans l'ordre reçu, avec le phasage que leur attribue la
 * fiche (trouverPhasage sur la même liste de phasages).
 * → [{ chantier, phasageId }]
 */
export function reperageChantiersAVenir(chantiers, phasages) {
  const liste = Array.isArray(phasages) ? phasages : [];
  return (Array.isArray(chantiers) ? chantiers : []).flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const ph = trouverPhasage(liste, c);
    return estChantierAVenir(c, ph) ? [{ chantier: c, phasageId: ph?.id ?? null }] : [];
  });
}

/**
 * Préparation d'UN chantier, telle que la fiche évalue ses étapes.
 *   phasage : phasage du chantier (ouvrages + plan_travaux) ou null
 *   lignes  : lignes chantier_cycle_vie de ce chantier
 * → { total, faits, renseignee, texte, etapes: [{ id, nom, fait, raison }],
 *     manquantes: [{ id, nom, raison }] }
 * renseignee = au moins une étape faite ou dont un état est enregistré.
 */
export function preparationChantierV1({ phasage = null, lignes = [] } = {}) {
  const phase = getPhase(PHASE_PREPARATION);
  const meta = phasage?.plan_travaux?.meta || null;
  const { etats } = etatsCycleVie({ meta, lignes: Array.isArray(lignes) ? lignes : [] });
  const ctx = { etatsEtapes: etats, phasage: etatPhasageMateriaux(phasage || null) };
  const etapes = phase.etapes.map((e) => {
    const ev = evaluerEtape(e, ctx);
    return { id: e.id, nom: e.nom, fait: !!ev.fait, raison: ev.raison || "" };
  });
  const total = etapes.length;
  const faits = etapes.filter((e) => e.fait).length;
  const renseignee = etapes.some((e) => e.fait || !!etats[e.id]);
  const texte = !renseignee ? "Préparation non renseignée"
    : faits === total ? `Préparation complète (${faits}/${total} étapes)`
    : `${faits}/${total} étapes faites`;
  return {
    total, faits, renseignee, texte, etapes,
    manquantes: etapes.filter((e) => !e.fait).map(({ id, nom, raison }) => ({ id, nom, raison })),
  };
}

/**
 * Liste du bloc.
 *   chantiers         : chantiers du tableau de bord
 *   phasagesReperage  : TOUS les phasages (COLONNES_PHASAGES_REPERAGE)
 *   phasagesComplets  : phasages des chantiers à venir (COLONNES_PHASAGES_PREPARATION)
 *   lignesCycleVie    : lignes chantier_cycle_vie de ces chantiers
 * → [{ id, nom, couleur, statut, phasageId, preparation }]
 * Un phasage repéré mais absent des phasages complets n'est jamais traité
 * comme « sans phasage » : preparation = null et erreur explicite.
 */
export function chantiersAVenirV1({ chantiers = [], phasagesReperage = [], phasagesComplets = [], lignesCycleVie = [] } = {}) {
  const complets = new Map((Array.isArray(phasagesComplets) ? phasagesComplets : []).filter(Boolean).map((p) => [String(p.id), p]));
  const lignes = Array.isArray(lignesCycleVie) ? lignesCycleVie : [];
  return reperageChantiersAVenir(chantiers, phasagesReperage).map(({ chantier, phasageId }) => {
    const phasage = phasageId != null ? complets.get(String(phasageId)) || null : null;
    const base = { id: chantier.id, nom: chantier.nom || String(chantier.id), couleur: chantier.couleur || null, statut: STATUT_A_VENIR, phasageId };
    if (phasageId != null && !phasage) {
      return { ...base, preparation: null, erreur: "phasage du chantier illisible" };
    }
    return { ...base, erreur: null, preparation: preparationChantierV1({ phasage, lignes: lignes.filter((l) => l && String(l.chantier_id) === String(chantier.id)) }) };
  });
}

/**
 * État affiché par le bloc (règle 10).
 *   chargement, erreur : lecture des phasages / du cycle de vie
 *   liste              : chantiersAVenirV1(…)
 * → { etat: "chargement"|"erreur"|"vide"|"liste", metrique, message,
 *     chantiers: [{ id, nom, couleur, avancement, renseignee, complete,
 *                   manquantes: [nom], reste, erreur }] }
 */
export function etatBlocChantiersAVenirV1({ chargement = false, erreur = null, liste = null, nbApercu = NB_ETAPES_MANQUANTES_APERCU } = {}) {
  if (erreur) {
    return { etat: "erreur", metrique: "illisible", chantiers: [],
      message: `Chantiers à venir illisibles pour le moment (${erreur}). Le nombre de chantiers à venir n'est pas connu.` };
  }
  if (chargement || !Array.isArray(liste)) {
    return { etat: "chargement", metrique: "…", chantiers: [], message: "Chargement des chantiers à venir…" };
  }
  if (liste.length === 0) {
    return { etat: "vide", metrique: "aucun", chantiers: [],
      message: "Aucun chantier à venir : aucun chantier au statut « Planifié » (devis signé, travaux pas encore commencés)." };
  }
  const chantiers = liste.map((c) => {
    if (!c.preparation) {
      return { id: c.id, nom: c.nom, couleur: c.couleur, avancement: `Préparation illisible (${c.erreur || "donnée absente"})`,
        renseignee: false, complete: false, manquantes: [], reste: 0, erreur: c.erreur || "donnée absente" };
    }
    const p = c.preparation;
    const manquantes = p.manquantes.slice(0, nbApercu).map((e) => e.nom);
    return { id: c.id, nom: c.nom, couleur: c.couleur, avancement: p.texte, renseignee: p.renseignee,
      complete: p.manquantes.length === 0, manquantes, reste: Math.max(0, p.manquantes.length - manquantes.length), erreur: null };
  });
  return { etat: "liste", metrique: `${liste.length} à venir`, chantiers, message: null,
    libelleNombre: `${liste.length} chantier${s(liste.length)} à venir` };
}
