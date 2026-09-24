// ─────────────────────────────────────────────────────────────────────────────
// Usage d'un ouvrage de bibliothèque dans les phasages.
//
// À QUOI CE MODULE SERT : répondre, AVANT toute suppression, à la question
// « cet ouvrage de bibliothèque est-il déjà utilisé sur des chantiers ? ».
// Si oui, la suppression est refusée : elle effacerait l'historique réel qui
// permet de juger la cadence (cf. echantillonCadencesV1).
//
// CE QUE ÇA RÉPARE (mesuré en base le 24/09/2026) :
//   – 167 bibliotheque_id distincts sont référencés par des ouvrages de
//     phasage ; 63 n'existent plus dans bibliotheque_ratios, soit 38 % ;
//   – 153 ouvrages de chantier, sur 20 chantiers, pointent vers un
//     identifiant disparu ;
//   – aucun n'est récupérable : ni par bibliotheque_ref, ni par code_ouvrage,
//     ni par libellé. Le lien est perdu DÉFINITIVEMENT.
// Le seul chemin de suppression du code est le bouton « Supprimer » de la
// page Bibliothèque, qui faisait un delete() sans la moindre vérification
// d'usage. L'import ProGBat, lui, ne fait que des update : il n'y est pour rien.
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord. Les phasages arrivent en paramètre. Le front importe la
// façade usageBibliothequeV1.js.
//
// PRINCIPE DIRECTEUR : DANS LE DOUTE, ON NE DÉTRUIT PAS.
// Une donnée manquante ou illisible ne vaut jamais « aucun usage ». Toute
// incertitude sur l'entrée produit un état qui INTERDIT la suppression — voir
// `usageIndetermineV1`. C'est volontairement asymétrique : se tromper en
// bloquant coûte un clic, se tromper en supprimant coûte un historique.
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_BIBLIOTHEQUE_VERSION = "v1";

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());

/**
 * État « on ne sait pas » : ni un usage, ni une absence d'usage.
 * `determine: false` est la seule chose que l'appelant doit regarder pour
 * décider s'il a le droit de supprimer.
 */
export function usageIndetermineV1(raison) {
  return Object.freeze({
    determine: false,
    raison: str(raison) || "usage indéterminé",
    nOuvrages: null,
    nChantiers: null,
    chantiers: [],
  });
}

/**
 * Compte les ouvrages de phasage qui référencent `bibliothequeId`.
 *
 * @param {Array} phasages [{ chantier_id, chantier_nom, ouvrages: [{ bibliotheque_id }] }]
 * @param {string} bibliothequeId l'ouvrage de bibliothèque dont on cherche l'usage
 * @returns {{ determine, raison, nOuvrages, nChantiers, chantiers }}
 *
 * Retourne un état INDÉTERMINÉ si `phasages` n'est pas une liste, ou si
 * `bibliothequeId` est vide : dans les deux cas on ne peut rien affirmer, et
 * répondre « 0 usage » autoriserait une suppression sur une non-réponse.
 * Une liste VIDE, en revanche, est une réponse légitime seulement si
 * l'appelant a pu établir qu'il n'y a réellement aucun phasage — c'est à lui
 * de le savoir (voir `lectureExploitableV1`).
 */
export function usageOuvrageBibliothequeV1(phasages, bibliothequeId) {
  const cible = str(bibliothequeId);
  if (!cible) return usageIndetermineV1("identifiant d'ouvrage manquant");
  if (!Array.isArray(phasages)) return usageIndetermineV1("phasages illisibles");

  let nOuvrages = 0;
  const chantiers = [];
  const vus = new Set();

  for (const ph of phasages) {
    // Une entrée de phasage malformée n'est pas « un phasage sans usage » :
    // on ne peut pas affirmer qu'elle ne référence pas l'ouvrage.
    if (!ph || typeof ph !== "object") return usageIndetermineV1("entrée de phasage illisible");
    if (!Array.isArray(ph.ouvrages)) return usageIndetermineV1("liste d'ouvrages illisible sur un phasage");

    let utilisePar = 0;
    for (const o of ph.ouvrages) {
      if (!o || typeof o !== "object") continue; // un élément vide ne référence rien
      if (str(o.bibliotheque_id) === cible) utilisePar += 1;
    }
    if (utilisePar === 0) continue;

    nOuvrages += utilisePar;
    // Le chantier est identifié par son id ; son nom n'est qu'un libellé
    // d'affichage, et peut manquer sans rendre le comptage faux.
    const cle = str(ph.chantier_id) || `sans-id:${chantiers.length}`;
    if (!vus.has(cle)) {
      vus.add(cle);
      chantiers.push(str(ph.chantier_nom) || str(ph.chantier_id) || "chantier sans nom");
    }
  }

  return Object.freeze({
    determine: true,
    raison: null,
    nOuvrages,
    nChantiers: chantiers.length,
    chantiers: Object.freeze([...chantiers]),
  });
}

/** L'ouvrage peut-il être supprimé ? Seul un usage DÉTERMINÉ et NUL l'autorise. */
export function suppressionAutoriseeV1(usage) {
  return !!usage && usage.determine === true && usage.nOuvrages === 0;
}

/**
 * La lecture des phasages est-elle exploitable ?
 *
 * Une lecture Supabase bloquée par RLS renvoie une liste VIDE **sans erreur** —
 * c'est exactement ce qui a permis à la page de réinsérer la bibliothèque
 * initiale sur une base pleine. Zéro phasage n'est donc pas une information
 * fiable : l'application n'a de sens que s'il en existe. On refuse d'y voir
 * « aucun usage ».
 *
 * @param {*} erreur  l'erreur remontée par la lecture (null si aucune)
 * @param {*} lignes  les lignes reçues
 */
export function lectureExploitableV1(erreur, lignes) {
  if (erreur) return { exploitable: false, raison: "la lecture des chantiers a échoué" };
  if (!Array.isArray(lignes)) return { exploitable: false, raison: "réponse inattendue à la lecture des chantiers" };
  if (lignes.length === 0) {
    return { exploitable: false, raison: "aucun chantier reçu, alors qu'il en existe forcément" };
  }
  return { exploitable: true, raison: null };
}

// ── Libellés (purs, sans ICU) ───────────────────────────────────────────────
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Le message de refus, tel qu'il s'affiche.
 * Il dit ce qui serait détruit (l'historique qui sert à juger la cadence) et
 * ce qu'il faut faire à la place — sans quoi l'utilisateur contournera le
 * blocage en recréant l'ouvrage, ce qui reproduit exactement le problème.
 */
export function messageUsageBloquantV1(usage) {
  if (!usage || !usage.determine) return null;
  return `Cet ouvrage est utilisé par ${pluriel(usage.nOuvrages, "ouvrage")} sur ${pluriel(usage.nChantiers, "chantier")}. `
    + "Le supprimer effacerait son historique réel, qui sert à juger sa cadence. "
    + "Pour une variante, utilisez « Dupliquer ». "
    + "Pour le corriger, modifiez-le plutôt que de le recréer.";
}
