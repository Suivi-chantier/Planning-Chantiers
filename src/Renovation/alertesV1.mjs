// ─────────────────────────────────────────────────────────────────────────────
// Alertes (Chantier 09) — le MOTEUR. L'écran qui l'affiche est provisoire ;
// ce module est le livrable, et il est fait pour être réutilisé tel quel par
// le futur tableau de bord et par les notifications.
//
// CE QU'IL FAIT, ET SURTOUT CE QU'IL NE FAIT PAS.
// Il ne détecte RIEN de nouveau : il TRIE. Le constat qui l'a rendu nécessaire
// (relevé 2026-W38, mesuré en base le 24/09/2026) :
//   – les 25 chantiers sur 25 portent au moins un warning, TOUS en gravité
//     « alerte ». Quand tout est en alerte, plus rien ne l'est ;
//   – codes présents : ouvrages_sans_prix (21 chantiers), fg_non_regle (14),
//     derive_lot (10), marge_sous_seuil_prime (5) ;
//   – 14 chantiers ont fg = 0 : leur marge est SURESTIMÉE. Ils portent tous
//     un motif « Donnée manquante » ET le drapeau de fiabilité ;
//   – 6 chantiers ont une marge à terminaison négative.
// Le travail est donc de séparer ce qui demande une décision cette semaine de
// ce qui est du bruit de fond ou un fait déjà acquis.
//
// ⚠️ AUCUNE RÉIMPLÉMENTATION DES DÉRIVES.
// La détection « consommation sans avancement » et « perte de marge » vit dans
// pointsAttentionV1, avec ses seuils. Ce module l'IMPORTE et l'APPELLE. Il ne
// recopie ni ses règles ni ses seuils : deux détections parallèles finiraient
// par diverger, et l'application afficherait deux vérités.
//
// ⚠️ AUCUN MONTANT DE CORRECTION DES FRAIS GÉNÉRAUX.
// Quand fg n'est pas renseigné, la marge est surestimée — c'est un FAIT, et on
// le dit. De combien, on l'ignore : supposer un taux de frais généraux
// produirait un chiffre inventé présenté comme une mesure. Le module pose un
// drapeau, jamais une correction.
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord. Les données arrivent en paramètre. Le front importe la façade
// alertesV1.js.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pointsAttentionV1,
  etatPointsAttentionV1,
  MOTIF_CONSOMMATION_SANS_AVANCEMENT,
  MOTIF_PERTE_DE_MARGE,
  formaterEurosV1,
  ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES,
} from "./pointsAttentionV1.mjs";

export const ALERTES_VERSION = "v1";

// Les trois niveaux, du plus urgent au moins urgent. L'ordre de ce tableau EST
// l'ordre de tri.
export const NIVEAU_CRITIQUE = "critique";
export const NIVEAU_A_SURVEILLER = "a_surveiller";
export const NIVEAU_INFO = "info";
export const NIVEAUX_ALERTE = Object.freeze([NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO]);

// Codes de warning écrits par chantierFinance dans chantier_snapshots_hebdo.
export const CODE_FG_NON_REGLE = "fg_non_regle";
export const CODE_DERIVE_LOT = "derive_lot";
export const CODE_OUVRAGES_SANS_PRIX = "ouvrages_sans_prix";
export const CODE_MARGE_SOUS_SEUIL_PRIME = "marge_sous_seuil_prime";

// Motif propre au moteur d'alertes : la marge à terminaison est négative alors
// que le chantier n'est pas fini. C'est la seule chose qu'on puisse encore
// infléchir, d'où le niveau critique.
export const MOTIF_MARGE_TERMINAISON_NEGATIVE = "marge_terminaison_negative";
// Le même fait, mais sur un chantier terminé : il n'y a plus rien à piloter.
export const MOTIF_TERMINE_EN_PERTE = "termine_en_perte";

/** Phrase du drapeau de fiabilité. Un constat, jamais un montant. */
export const MESSAGE_MARGE_SURESTIMEE =
  "Marge surestimée : frais généraux non renseignés";

/** Libellés des motifs, pour les étiquettes de l'écran. */
export const LIBELLES_MOTIFS_ALERTE = Object.freeze({
  [MOTIF_MARGE_TERMINAISON_NEGATIVE]: "marge à terminaison négative",
  [MOTIF_TERMINE_EN_PERTE]: "terminé en perte",
  [MOTIF_PERTE_DE_MARGE]: "perte de marge",
  [MOTIF_CONSOMMATION_SANS_AVANCEMENT]: "consommation sans avancement",
  [CODE_DERIVE_LOT]: "dérive sur un lot",
  [CODE_OUVRAGES_SANS_PRIX]: "ouvrages sans prix",
  [CODE_MARGE_SOUS_SEUIL_PRIME]: "marge sous le seuil de prime",
  [CODE_FG_NON_REGLE]: "Donnée manquante : frais généraux non renseignés",
});

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// null, undefined, "" et NaN sont des données INDISPONIBLES, pas des zéros.
const nombreOuNull = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalise un identifiant ou un nom de chantier pour la comparaison
 * d'exclusion : accents retirés, casse ignorée, espaces réduits. « DÉPOT »,
 * « depot » et « Dépôt » désignent le même stock interne.
 */
function normaliserCle(v) {
  return str(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * Le chantier est-il exclu ? La liste est un PARAMÈTRE : aucun nom de chantier
 * n'est écrit en dur dans la logique — « DÉPOT » est une donnée de l'entreprise,
 * pas une règle métier du moteur.
 */
export function estExcluV1(snapshot, exclusions) {
  const cles = new Set(listeSure(exclusions).map(normaliserCle).filter(Boolean));
  if (cles.size === 0) return false;
  return cles.has(normaliserCle(snapshot?.chantier_id)) || cles.has(normaliserCle(snapshot?.chantier_nom));
}

/** Les codes de warning d'un snapshot, dédoublonnés et dans l'ordre reçu. */
export function codesWarningsV1(snapshot) {
  const codes = [];
  for (const w of listeSure(snapshot?.warnings)) {
    const code = str(w?.code);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Le drapeau de fiabilité, ou null. Aucun montant : voir l'en-tête du module. */
export function fiabiliteV1(snapshot) {
  if (!codesWarningsV1(snapshot).includes(CODE_FG_NON_REGLE)) return null;
  return Object.freeze({ margeSurestimee: true, message: MESSAGE_MARGE_SURESTIMEE });
}

/** L'explication, en français lisible par un conducteur de travaux. */
function explicationDe({ motifs, avancement, margeTerminaison, margePerdue, explicationDerive }) {
  const bouts = [];
  if (motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE)) {
    bouts.push(`Marge à terminaison ${formaterEurosV1(margeTerminaison)} alors que le chantier est à ${avancement} % : la perte est encore évitable.`);
  }
  if (motifs.includes(MOTIF_TERMINE_EN_PERTE)) {
    bouts.push(`Chantier terminé avec une marge de ${formaterEurosV1(margeTerminaison)} : le résultat est acquis, il n'y a plus rien à piloter dessus.`);
  }
  // L'explication des dérives vient de pointsAttentionV1 : on la reprend telle
  // quelle plutôt que d'en rédiger une seconde, qui finirait par diverger.
  if (explicationDerive) bouts.push(explicationDerive);
  else if (motifs.includes(MOTIF_PERTE_DE_MARGE) && margePerdue != null) {
    bouts.push(`Marge en baisse de ${formaterEurosV1(margePerdue)} sur la semaine.`);
  }
  if (bouts.length === 0) {
    bouts.push("Signalé par le relevé hebdomadaire : à regarder quand vous aurez le temps, rien d'urgent.");
  }
  return bouts.join(" ");
}

/**
 * Le moteur.
 *
 * @param {object} p
 * @param {Array}  p.snapshotsCourants     relevés de la semaine, DÉJÀ dédoublonnés
 *                                         (dedoublonnerSnapshotsV1 de pointsAttentionDonneesV1).
 * @param {Array}  p.snapshotsPrecedents   relevés de la semaine précédente, idem.
 * @param {object} [p.pointsAttention]     résultat DÉJÀ calculé de pointsAttentionV1.
 *                                         Omis, le module l'appelle lui-même. Dans les
 *                                         deux cas la détection vient de LÀ, jamais d'ici.
 * @param {Array}  [p.exclusions]          ids ou noms de chantiers à ne jamais afficher.
 * @param {object} [p.seuils]              transmis tels quels à pointsAttentionV1.
 */
export function alertesV1({ snapshotsCourants, snapshotsPrecedents, pointsAttention, exclusions, seuils } = {}) {
  const courants = listeSure(snapshotsCourants);
  const precedents = listeSure(snapshotsPrecedents);

  // La détection des dérives est DÉLÉGUÉE. Si l'appelant l'a déjà calculée, on
  // la réutilise pour ne pas la refaire deux fois — jamais pour la refaire
  // autrement.
  const pa = (pointsAttention && typeof pointsAttention === "object")
    ? pointsAttention
    : pointsAttentionV1({ snapshotsCourants: courants, snapshotsPrecedents: precedents, seuils });

  const derivesParChantier = new Map();
  for (const ligne of listeSure(pa.lignes)) {
    const id = str(ligne?.chantier_id);
    if (id) derivesParChantier.set(id, ligne);
  }

  const alertes = [];
  const exclus = [];
  // Chantiers dont la marge est surestimée, QU'ILS PRODUISENT UNE CARTE OU NON.
  // Le drapeau n'étant pas un motif, un chantier dont le seul warning est
  // fg_non_regle n'apparaît nulle part — et le fait deviendrait invisible.
  // Mesuré en W38 : 13 chantiers concernés hors DÉPOT, dont 11 seulement
  // portent une alerte. Les 2 autres (8 RUE SAINT BLAISE - ENEDIS et
  // PASSAGE CÂBLE) n'ont que ce warning. On les compte ici pour que l'écran
  // puisse le dire, sans les faire remonter en alerte.
  const margeSurestimee = [];

  for (const snap of courants) {
    if (!snap || typeof snap !== "object") continue;
    const chantierId = str(snap.chantier_id);
    if (!chantierId) continue;

    if (estExcluV1(snap, exclusions)) {
      exclus.push(str(snap.chantier_nom) || chantierId);
      continue;
    }

    if (fiabiliteV1(snap)) margeSurestimee.push(str(snap.chantier_nom) || chantierId);

    const avancement = nombreOuNull(snap.avancement);
    const margeTerminaison = nombreOuNull(snap.marge_terminaison);
    const derive = derivesParChantier.get(chantierId) || null;
    const motifsDerive = listeSure(derive?.motifs);
    const codes = codesWarningsV1(snap);

    const motifs = [];
    // ── Motifs CRITIQUES ────────────────────────────────────────────────────
    // Une marge à terminaison négative sur un chantier NON TERMINÉ : la perte
    // est annoncée mais pas encore consommée. C'est là qu'une décision change
    // quelque chose.
    const margeTerminaisonNegative =
      margeTerminaison != null && margeTerminaison < 0 &&
      avancement != null && avancement < 100;
    if (margeTerminaisonNegative) motifs.push(MOTIF_MARGE_TERMINAISON_NEGATIVE);
    if (motifsDerive.includes(MOTIF_PERTE_DE_MARGE)) motifs.push(MOTIF_PERTE_DE_MARGE);

    // ── Motif À SURVEILLER ──────────────────────────────────────────────────
    if (motifsDerive.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT)) {
      motifs.push(MOTIF_CONSOMMATION_SANS_AVANCEMENT);
    }

    // ── Motifs INFO ─────────────────────────────────────────────────────────
    // Le chantier est fini et il est en perte : c'est un fait acquis. Le
    // remonter en critique ferait clignoter une ligne sur laquelle plus aucune
    // décision n'est possible.
    const termineEnPerte =
      margeTerminaison != null && margeTerminaison < 0 &&
      avancement != null && avancement >= 100;
    if (termineEnPerte) motifs.push(MOTIF_TERMINE_EN_PERTE);
    // fg_non_regle compte comme un motif à part entière, de niveau « info ».
    // La première version en faisait UNIQUEMENT un drapeau : conséquence, un
    // chantier dont c'était le seul signal n'avait aucun motif, donc aucune
    // carte, et le fait disparaissait de l'écran. Mesuré en W38 : 2 chantiers
    // sur 13 étaient ainsi invisibles (8 RUE SAINT BLAISE - ENEDIS et
    // PASSAGE CÂBLE). Une donnée manquante doit rester VISIBLE : c'est un
    // invariant du projet, pas un détail d'affichage.
    // Le drapeau de fiabilité reste posé EN PLUS sur tous ces chantiers.
    for (const code of codes) motifs.push(code);

    if (motifs.length === 0) continue;

    const estCritique = motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE) || motifs.includes(MOTIF_PERTE_DE_MARGE);
    const estASurveiller = !estCritique && motifs.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT);
    const niveau = estCritique ? NIVEAU_CRITIQUE : (estASurveiller ? NIVEAU_A_SURVEILLER : NIVEAU_INFO);

    // ── Impact € ────────────────────────────────────────────────────────────
    // Le montant en jeu, quand il est connu. null = inconnu, JAMAIS 0 : un
    // impact à zéro se lirait « sans conséquence », ce qui serait faux.
    const impacts = [];
    if (margeTerminaisonNegative || termineEnPerte) impacts.push(Math.abs(margeTerminaison));
    const margePerdue = nombreOuNull(derive?.margePerdue);
    if (motifs.includes(MOTIF_PERTE_DE_MARGE) && margePerdue != null) impacts.push(Math.abs(margePerdue));
    const impactEuros = impacts.length ? round2(Math.max(...impacts)) : null;

    alertes.push({
      chantierId,
      nom: str(snap.chantier_nom) || chantierId,
      niveau,
      motifs,
      impactEuros,
      avancement,
      margeTerminaison,
      margePerdue: motifs.includes(MOTIF_PERTE_DE_MARGE) ? margePerdue : null,
      fiabilite: fiabiliteV1(snap),
      explication: explicationDe({
        motifs, avancement, margeTerminaison, margePerdue,
        explicationDerive: derive?.explication || null,
      }),
    });
  }

  // Tri : niveau d'abord, puis impact DÉCROISSANT, impact inconnu en dernier.
  // Un impact inconnu ne vaut pas 0 : il ne doit ni remonter ni descendre le
  // chantier par accident, seulement se ranger après ce qui est chiffré.
  const rangNiveau = n => NIVEAUX_ALERTE.indexOf(n);
  alertes.sort((a, b) => {
    const dn = rangNiveau(a.niveau) - rangNiveau(b.niveau);
    if (dn !== 0) return dn;
    const ai = a.impactEuros, bi = b.impactEuros;
    if (ai == null && bi == null) return a.chantierId.localeCompare(b.chantierId);
    if (ai == null) return 1;
    if (bi == null) return -1;
    return (bi - ai) || a.chantierId.localeCompare(b.chantierId);
  });

  const compter = n => alertes.filter(a => a.niveau === n).length;

  return {
    version: ALERTES_VERSION,
    releveDisponible: pa.releveDisponible,
    relevePrecedentDisponible: pa.relevePrecedentDisponible,
    alertes,
    totaux: {
      critique: compter(NIVEAU_CRITIQUE),
      aSurveiller: compter(NIVEAU_A_SURVEILLER),
      info: compter(NIVEAU_INFO),
      total: alertes.length,
    },
    // Ce qui a été volontairement écarté, pour que l'écran puisse le dire.
    exclus,
    // Nombre d'ALERTES portant le drapeau (11 en W38).
    fiabiliteDouteuse: alertes.filter(a => a.fiabilite).length,
    // Tous les chantiers à marge surestimée, alerte ou non (13 en W38).
    // Les deux nombres diffèrent, et c'est normal : le second est le fait
    // comptable, le premier ce qui remonte à l'écran.
    margeSurestimee,
  };
}

/** Les alertes d'un niveau donné, dans l'ordre de tri. */
export function alertesDuNiveauV1(resultat, niveau) {
  return listeSure(resultat?.alertes).filter(a => a.niveau === niveau);
}

/**
 * Qualifie le résultat pour l'affichage — MÊMES TROIS ÉTATS que le chantier 07.
 *
 * Le cas « relevé absent » est DÉLÉGUÉ à etatPointsAttentionV1 : c'est la même
 * situation et elle doit produire exactement le même ton et le même message
 * partout dans l'application. On ne le réécrit pas ici. Seul le message du cas
 * « il y a quelque chose » est propre aux alertes.
 */
export function etatAlertesV1(resultat) {
  const r = resultat && typeof resultat === "object" ? resultat : {};
  const base = etatPointsAttentionV1({
    releveDisponible: r.releveDisponible,
    relevePrecedentDisponible: r.relevePrecedentDisponible,
    lignes: listeSure(r.alertes),
  });
  if (base.statut === ETAT_RELEVE_ABSENT) return base;

  const nbCritique = r.totaux?.critique || 0;
  const nb = listeSure(r.alertes).length;
  if (nb === 0) {
    return { statut: ETAT_AUCUNE_DERIVE, ton: "ok", nb: 0, message: "Aucune alerte sur le relevé de cette semaine." };
  }
  return {
    statut: ETAT_DERIVES,
    ton: nbCritique > 0 ? "alerte" : "neutre",
    nb,
    message: nbCritique > 0
      ? `${nbCritique} chantier${nbCritique > 1 ? "s" : ""} à traiter en priorité.`
      : "Aucun chantier critique cette semaine.",
  };
}

/** Le libellé d'un motif, pour une étiquette. Un code inconnu s'affiche tel quel. */
export function libelleMotifAlerteV1(motif) {
  return LIBELLES_MOTIFS_ALERTE[motif] || str(motif) || "motif inconnu";
}

export { ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES };
