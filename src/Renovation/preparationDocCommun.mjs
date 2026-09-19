// preparationDocCommun — le strict minimum partagé entre les deux documents
// qui impriment une préparation de chantier :
//   • preparationChantierDoc.js — le dossier DÉTAILLÉ d'un chantier (terrain)
//   • operationDoc.js           — le dossier d'OPÉRATION (bureau), qui n'en
//                                 garde qu'une synthèse par chantier
//
// Extraction volontairement étroite. On n'y met que ce dont la DIVERGENCE
// serait un bug :
//   1. l'échappement (HTML, attribut, chaîne CSS) — deux implémentations,
//      c'est une faille qui n'est corrigée que d'un côté ;
//   2. l'ordre réel des phases — « À organiser » en dernier est une règle
//      métier, pas une préférence de mise en page ;
//   3. le comptage d'une préparation — les totaux de l'opération doivent être
//      la somme exacte de ce que chaque dossier de chantier affiche.
// Tout le reste (styles, tuiles, tableaux, cases à cocher) reste propre à
// chaque document : ce sont deux publics et deux mises en page.
//
// Module PUR : aucun réseau, aucun React, aucune horloge. Il s'appuie sur
// preparationChantier.mjs — les mêmes règles que l'espace ouvrier.
// Couvert par scripts/verif-operation-doc.mjs.
import { phasesVisibles, compterTaches, ecranModele, PHASE_A_ORGANISER } from "./preparationChantier.mjs";

// ─── ÉCHAPPEMENT ─────────────────────────────────────────────────────────────

// Texte et attributs HTML. Même jeu de caractères que tous les gabarits
// Profero (previsionnelDoc, operationDoc, chiffrageDoc) : &, <, >, ".
// L'apostrophe n'y est volontairement PAS échappée — ces documents écrivent
// tous leurs attributs entre guillemets doubles, une apostrophe n'y ferme
// donc rien, et le texte français en est truffé (« l'ensemble de l'ouvrage »).
// ⚠ Cette garantie tient tant qu'aucun attribut n'est écrit en style='…'.
export const escDoc = (s) => (s ?? "").toString()
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Chaîne destinée à un `content:` CSS (pied de page @page). Le backslash et le
// guillemet double casseraient la chaîne ; `<` et `>` casseraient le <style>
// qui la contient — un nom valant « </style><script>… » s'exécuterait. Les
// quatre sont réécrits en échappements CSS hexadécimaux, que le moteur
// réaffiche tels quels.
export const escCssDoc = (s) => (s ?? "").toString()
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/</g, "\\3c ")
  .replace(/>/g, "\\3e ");

// ─── ORDRE RÉEL DES PHASES ───────────────────────────────────────────────────
// La RPC ouvrier_preparation_chantier trie déjà (order by ordre, rang_source)
// et « À organiser » porte ordre = 999999. On ne RECONSTRUIT rien : on re-trie
// défensivement le tableau reçu, de façon stable, pour que l'ordre imprimé ne
// dépende pas d'un éventuel changement de tri côté serveur.
//   1. la phase synthétique « À organiser » toujours en dernier
//   2. puis `ordre` croissant
//   3. à égalité, l'ordre d'arrivée du payload
export const estPhaseAOrganiser = (p) => p?.synthetique === true || p?.id === PHASE_A_ORGANISER;

export function phasesOrdonnees(payload) {
  const rang = (p) => {
    const n = typeof p?.ordre === "number" ? p.ordre : parseFloat(String(p?.ordre ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  return phasesVisibles(payload)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sa = estPhaseAOrganiser(a.p) ? 1 : 0, sb = estPhaseAOrganiser(b.p) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      const ra = rang(a.p), rb = rang(b.p);
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    })
    .map(x => x.p);
}

// ─── COMPTAGE D'UNE PRÉPARATION ──────────────────────────────────────────────
// Entier sûr : une valeur absente, non numérique ou infinie vaut 0 — jamais
// « NaN » ni « undefined » à l'impression.
export const entier = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// Synthèse d'UNE préparation, telle qu'elle sera imprimée.
//   payload : réponse de la RPC, ou null (RPC muette / non appelée)
//   erreur  : message d'échec de chargement, "" sinon
// Retour :
//   exploitable : true seulement si le modèle est v2 ET qu'il reste quelque
//                 chose à montrer. Un chantier sans phasage V2 n'est JAMAIS
//                 présenté comme préparé.
//   ecran       : { titre, texte, ton } quand la préparation n'est pas
//                 exploitable, null sinon (règle ecranModele, partagée avec
//                 l'espace ouvrier).
//   phases      : les phases visibles, dans l'ordre réel
export function resumePreparation(payload, erreur = "") {
  if (erreur) {
    return {
      exploitable: false, erreur: String(erreur), ecran: null, modele: null,
      phases: [], nbPhases: 0, nbOuvrages: 0, nbTaches: 0, nbAOrganiser: 0,
    };
  }
  const ecran = ecranModele(payload); // null ⟺ modèle v2
  const phases = ecran ? [] : phasesOrdonnees(payload);
  const c = payload?.compteurs || {};
  return {
    exploitable: !ecran && phases.length > 0,
    erreur: "",
    ecran,
    modele: payload?.modele ?? null,
    phases,
    nbPhases: phases.length,
    nbOuvrages: ecran ? 0 : entier(c.ouvrages_uniques),
    nbTaches: ecran ? 0 : entier(c.taches),
    nbAOrganiser: ecran ? 0 : entier(c.taches_a_organiser),
  };
}

// Nombre d'ouvrages et de tâches d'UNE phase, tels qu'affichés.
// Les tâches passent par compterTaches (règle partagée avec l'écran ouvrier) ;
// les ouvrages sont ceux que la phase porte réellement.
export function compteursPhase(phase) {
  return {
    nbOuvrages: Array.isArray(phase?.ouvrages) ? phase.ouvrages.length : 0,
    nbTaches: compterTaches(phase).total,
  };
}

// Totaux d'une opération : la somme EXACTE des synthèses de ses chantiers.
// Les chantiers non exploitables comptent pour 0 partout sauf dans leur
// propre décompte — jamais d'invention de chiffres.
export function totauxOperation(resumes = []) {
  const t = {
    nbChantiers: resumes.length, nbPrepares: 0, nbSansPreparation: 0, nbEnErreur: 0,
    nbPhases: 0, nbOuvrages: 0, nbTaches: 0, nbAOrganiser: 0,
  };
  resumes.forEach((r) => {
    if (r?.erreur) t.nbEnErreur += 1;
    if (r?.exploitable) {
      t.nbPrepares += 1;
      t.nbPhases += entier(r.nbPhases);
      t.nbOuvrages += entier(r.nbOuvrages);
      t.nbTaches += entier(r.nbTaches);
      t.nbAOrganiser += entier(r.nbAOrganiser);
    } else {
      t.nbSansPreparation += 1;
    }
  });
  return t;
}
