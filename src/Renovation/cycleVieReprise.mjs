// ─────────────────────────────────────────────────────────────────────────────
// cycleVieReprise — reprise À LA LECTURE de l'ancien cycle de vie (6 phases)
// sur le nouveau (5 phases). Refonte Opérations, lot 3.
//
// Module PUR : aucun accès Supabase, aucune horloge. Façade : cycleVieReprise.js.
//
// OÙ VIVENT LES ÉTATS
//   - Ancien cycle : phasages.plan_travaux.meta.cycle_vie_etapes (un objet par
//     étape) et meta.cycle_vie_phase_declaree. JAMAIS réécrits par le lot 3 :
//     ils restent en base tels quels (retour arrière = ancien code).
//   - Nouveau cycle : table chantier_cycle_vie, une ligne par chantier et par
//     étape (etape_id, etat). Le chantier n'a plus besoin d'un phasage pour
//     avancer dans « Étude » et « Contrat ».
//
// RÈGLE DE LECTURE (etatsEtapesRepris) : pour chaque étape du nouveau cycle,
//   1. la ligne de la table si elle existe ;
//   2. sinon l'état de l'ancienne étape ÉQUIVALENTE dans le phasage
//      (CORRESPONDANCE_ANCIENNES_ETAPES), marqué `reprise` pour l'affichage.
// Les anciennes étapes SANS équivalent sont rendues à part (nonReprises) :
// elles ne sont plus affichées dans le cycle ; seules leurs pièces jointes
// restent consultables (aucun document ne disparaît de l'écran).
// À la première modification d'une étape reprise, son état (pièces jointes
// comprises) est écrit dans la table : l'ancien état n'est pas touché.
// ─────────────────────────────────────────────────────────────────────────────

/** Ancien identifiant d'étape → nouvel identifiant (null = sans équivalent). */
export const CORRESPONDANCE_ANCIENNES_ETAPES = Object.freeze({
  // Phase « Devis » → « Étude »
  metres: "visite_chiffrage",            // relevé sur site = visite avant chiffrage + Imapper
  chiffrage_realise: "chiffrage_realise",
  devis_envoye: "devis_envoye",
  reponse_client: null,                   // remplacé par « Devis signé » (pièce à l'appui)
  // « Contrat »
  devis_signe: "devis_signe",
  acompte_encaisse: "acompte_encaisse",
  retractation_purgee: null,
  // « Préparation »
  plans_execution: "plans_techniques",
  commandes_appros: null,
  equipes_affectees: null,
  installation_chantier: null,
  // « Réception »
  visite_reception: "reception_pv",       // PV + date de réception
  levee_reserves: "levee_reserves",
  remise_cles_doe: null,
  // « Garanties / SAV » (phase supprimée)
  parfait_achevement: null,
  interventions_sav: null,
  fin_garantie: null,
});

/** Noms des anciennes étapes (affichage des pièces jointes conservées). */
export const NOMS_ANCIENNES_ETAPES = Object.freeze({
  metres: "Métrés",
  chiffrage_realise: "Chiffrage réalisé",
  devis_envoye: "Devis envoyé",
  reponse_client: "Réponse client",
  devis_signe: "Devis signé",
  acompte_encaisse: "Acompte encaissé",
  retractation_purgee: "Délai de rétractation purgé",
  plans_execution: "Plans d'exécution",
  commandes_appros: "Commandes & approvisionnements",
  equipes_affectees: "Équipes affectées",
  installation_chantier: "Installation de chantier",
  visite_reception: "Visite de réception",
  levee_reserves: "Levée des réserves",
  remise_cles_doe: "Remise des clés & DOE",
  parfait_achevement: "Parfait achèvement (1 an)",
  interventions_sav: "Interventions SAV",
  fin_garantie: "Fin de garantie",
});

/** Ancienne phase déclarée → nouvelle phase. */
export const CORRESPONDANCE_ANCIENNES_PHASES = Object.freeze({
  cv_devis: "cv_etude",
  cv_contrat: "cv_contrat",
  cv_preparation: "cv_preparation",
  cv_travaux: "cv_travaux",
  cv_reception: "cv_reception",
  cv_garanties: "cv_reception",
});

/** Pseudo-étape de la table qui porte la phase déclarée à la main. */
export const ETAPE_PHASE_DECLAREE = "_phase_declaree";

const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Ancien état brut du phasage (meta.cycle_vie_etapes), tolérant. */
export function etatsAnciens(meta) {
  const brut = estObjet(meta) ? meta.cycle_vie_etapes : null;
  if (!estObjet(brut)) return {};
  const out = {};
  for (const [id, etat] of Object.entries(brut)) if (estObjet(etat)) out[id] = etat;
  return out;
}

/** Lignes de la table chantier_cycle_vie → { etapeId: etat } (hors pseudo-étapes). */
export function etatsDepuisLignes(lignes) {
  const out = {};
  (Array.isArray(lignes) ? lignes : []).forEach((l) => {
    if (!l || !l.etape_id || String(l.etape_id).startsWith("_") || !estObjet(l.etat)) return;
    out[l.etape_id] = l.etat;
  });
  return out;
}

/** Nom affichable d'un identifiant d'étape, ancien ou nouveau. */
export function nomAncienneEtape(id) {
  return NOMS_ANCIENNES_ETAPES[id] || null;
}

/**
 * États du nouveau cycle pour UN chantier.
 *   meta   : phasages.plan_travaux.meta du chantier (ou null s'il n'a pas de phasage)
 *   lignes : lignes de chantier_cycle_vie du chantier
 * → {
 *     etats      : { nouvelEtapeId: etat } — etat.reprise = { depuis, nom }
 *                  quand il vient de l'ancien cycle ;
 *     nonReprises: [{ id, nom, etat }] — anciennes étapes sans équivalent
 *                  (ou éclipsées par une ligne de la table), non affichées
 *                  dans le cycle ;
 *   }
 */
export function etatsEtapesRepris({ meta = null, lignes = [] } = {}) {
  const table = etatsDepuisLignes(lignes);
  const anciens = etatsAnciens(meta);
  const etats = { ...table };
  const nonReprises = [];
  for (const [ancienId, etat] of Object.entries(anciens)) {
    const nouvelId = Object.prototype.hasOwnProperty.call(CORRESPONDANCE_ANCIENNES_ETAPES, ancienId)
      ? CORRESPONDANCE_ANCIENNES_ETAPES[ancienId]
      : null;
    if (nouvelId && !etats[nouvelId]) {
      etats[nouvelId] = { ...etat, reprise: { depuis: ancienId, nom: NOMS_ANCIENNES_ETAPES[ancienId] || ancienId } };
    } else if (!nouvelId) {
      nonReprises.push({ id: ancienId, nom: NOMS_ANCIENNES_ETAPES[ancienId] || ancienId, etat });
    }
  }
  return { etats, nonReprises };
}

/** État prêt à écrire dans la table : sans les marques de lecture. */
export function etatPourEcriture(etat) {
  if (!estObjet(etat)) return {};
  const { reprise, ...reste } = etat;
  return reste;
}

/**
 * Phase déclarée à la main : la ligne « _phase_declaree » de la table d'abord,
 * sinon l'ancienne déclaration du phasage, traduite. null si aucune ou si la
 * ligne de la table la RETIRE (etat.phaseId = null : retour à l'automatique).
 * `phasesValides` = identifiants du nouveau cycle (évite une dépendance
 * circulaire avec cycleVie.mjs).
 */
export function phaseDeclareeReprise({ meta = null, lignes = [], phasesValides = [] } = {}) {
  const ligne = (Array.isArray(lignes) ? lignes : []).find((l) => l && l.etape_id === ETAPE_PHASE_DECLAREE);
  const valide = (id) => phasesValides.includes(id);
  if (ligne && estObjet(ligne.etat)) {
    const id = ligne.etat.phaseId;
    if (!id || !valide(id)) return null;
    return { phaseId: id, auteur: String(ligne.etat.auteur || ""), date: String(ligne.etat.date || ""), source: "table" };
  }
  const brut = estObjet(meta) ? meta.cycle_vie_phase_declaree : null;
  if (!estObjet(brut)) return null;
  const id = CORRESPONDANCE_ANCIENNES_PHASES[brut.phaseId] || null;
  if (!id || !valide(id)) return null;
  return {
    phaseId: id,
    auteur: typeof brut.auteur === "string" ? brut.auteur : "",
    date: typeof brut.date === "string" ? brut.date : "",
    source: "phasage",
    ...(id !== brut.phaseId ? { repriseDepuis: brut.phaseId } : {}),
  };
}

/**
 * Bilan de reprise sur un ensemble de phasages (compte rendu, script de
 * vérification) : pour chaque ancienne étape, combien d'états et combien de
 * validées, et ce qu'elles deviennent.
 * → [{ ancienId, nom, total, validees, avecPieces, devient }]
 */
export function bilanReprise(metas) {
  const parId = new Map();
  (Array.isArray(metas) ? metas : []).forEach((meta) => {
    for (const [id, etat] of Object.entries(etatsAnciens(meta))) {
      const b = parId.get(id) || { ancienId: id, nom: NOMS_ANCIENNES_ETAPES[id] || id, total: 0, validees: 0, avecPieces: 0 };
      b.total++;
      if (etat.fait === true) b.validees++;
      if (Array.isArray(etat.pieces_jointes) && etat.pieces_jointes.length) b.avecPieces++;
      parId.set(id, b);
    }
  });
  return [...parId.values()]
    .map((b) => ({ ...b, devient: CORRESPONDANCE_ANCIENNES_ETAPES[b.ancienId] || null }))
    .sort((a, b) => a.ancienId.localeCompare(b.ancienId));
}
