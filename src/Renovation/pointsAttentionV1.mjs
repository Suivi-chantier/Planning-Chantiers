// ─────────────────────────────────────────────────────────────────────────────
// Points d'attention du Bilan Semaine (Chantier 07, dernier livrable).
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord, aucune écriture. Les données arrivent en paramètre.
// Extension .mjs = parsable ESM par Node sans build (tests, crons /api via
// `await import()`). Le front importe la façade src/Renovation/pointsAttentionV1.js.
//
// CE QU'IL DÉTECTE : un chantier qui CONSOMME sans AVANCER. La combinaison
// « avancement stable + heures ajoutées + marge qui recule » est le signal le
// plus fiable d'une dérive en cours, et c'est celui qu'un bilan transmis à la
// hiérarchie doit faire remonter tout seul.
//
// ⚠️ MÊME CHIFFRE = MÊME SERVICE + MÊME EXPLICATION.
// Ce module ne RECALCULE rien. Avancement, heures réelles et marge sont lus
// tels quels dans les colonnes `avancement`, `heures_reelles` et `marge` de
// chantier_snapshots_hebdo — les valeurs que le cron hebdomadaire y a écrites
// depuis computeChantierFinance (formules Phasage V2). Aucun calcul parallèle :
// un chiffre affiché ici est le même que partout ailleurs dans l'application,
// et l'explication qui l'accompagne décrit exactement l'écart entre les deux
// snapshots comparés.
//
// Conventions :
//  - comparaison semaine N ↔ semaine N-1, appariée par chantier_id ;
//  - null = donnée indisponible → le chantier est IGNORÉ, jamais compté à 0 ;
//  - une entrée vide ou malformée ne casse rien : elle produit `lignes: []`.
// ─────────────────────────────────────────────────────────────────────────────

export const POINTS_ATTENTION_VERSION = "v1";

/**
 * Seuils par défaut. Paramétrables via l'argument `seuils`.
 *  - avancementStableMaxPts : au-delà, le chantier a réellement avancé.
 *  - heuresAjouteesMin      : en deçà, la consommation n'est pas significative.
 *  - margePerdueMinEuros    : en deçà, l'écart relève du bruit de calcul.
 */
export const SEUILS_POINTS_ATTENTION_V1 = Object.freeze({
  avancementStableMaxPts: 1,
  heuresAjouteesMin: 2,
  margePerdueMinEuros: 50,
  // Motif « perte_de_marge » : au-delà de ce montant perdu en une semaine, le
  // chantier remonte QUEL QUE SOIT son avancement. Vérifié sur la base en
  // semaine 2026-W38 : ce seuil ne retient que 4 chantiers sur 25. Il est
  // sélectif — ne pas le baisser sans arbitrage explicite.
  margePerdueGraveMinEuros: 500,
});

// Les deux formes de dérive. Un chantier peut porter les deux à la fois.
export const MOTIF_CONSOMMATION_SANS_AVANCEMENT = "consommation_sans_avancement";
export const MOTIF_PERTE_DE_MARGE = "perte_de_marge";

const str = v => (v == null ? "" : String(v).trim());
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const listeSure = v => (Array.isArray(v) ? v : []);

// null, undefined, "" et NaN sont des données INDISPONIBLES, pas des zéros :
// un chantier dont la marge est inconnue ne doit pas apparaître comme ayant
// perdu sa marge entière.
const nombreOuNull = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Formatage (pur, sans ICU) ───────────────────────────────────────────────
// On n'utilise pas toLocaleString : son séparateur de milliers dépend de la
// version d'ICU de la machine, ce qui rendrait les libellés non déterministes.
const MOINS = "−"; // vrai signe moins typographique, pas un trait d'union

function grouperMilliers(entier) {
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 1117 → "1 117 €" · -1166 → "−1 166 €" */
export function formaterEurosV1(valeur) {
  const n = nombreOuNull(valeur);
  if (n == null) return "—";
  const arrondi = Math.round(n);
  return `${arrondi < 0 ? MOINS : ""}${grouperMilliers(Math.abs(arrondi))} €`;
}

/** 30 → "30 h" · 7.5 → "7,5 h" */
export function formaterHeuresV1(valeur) {
  const n = nombreOuNull(valeur);
  if (n == null) return "—";
  const arrondi = Math.round((Math.abs(n) + Number.EPSILON) * 10) / 10;
  const texte = Number.isInteger(arrondi) ? String(arrondi) : String(arrondi).replace(".", ",");
  return `${n < 0 ? MOINS : ""}${texte} h`;
}

const formaterPoints = n => {
  const arrondi = Math.round((Math.abs(n) + Number.EPSILON) * 10) / 10;
  const texte = Number.isInteger(arrondi) ? String(arrondi) : String(arrondi).replace(".", ",");
  return `${texte} pt${arrondi > 1 ? "s" : ""}`;
};

const formaterAvancement = n => {
  const arrondi = Math.round((Number(n) + Number.EPSILON) * 10) / 10;
  return `${Number.isInteger(arrondi) ? arrondi : String(arrondi).replace(".", ",")} %`;
};

/**
 * Une semaine est RELEVÉE si elle porte au moins une ligne de snapshot
 * identifiable.
 *
 * Le cron d'alimentation tourne le VENDREDI en fin de journée : avant ce
 * moment, la semaine en cours n'a aucune ligne. Un tableau vide ne veut donc
 * pas dire « aucune dérive », il veut dire « on ne sait pas encore ». Les deux
 * ne doivent jamais s'afficher pareil.
 */
export function releveExploitableV1(lignes) {
  return listeSure(lignes).some(l => l && typeof l === "object" && str(l.chantier_id));
}

// ── Appariement des snapshots ───────────────────────────────────────────────
// La table autorise plusieurs snapshots par chantier dans une même semaine
// (unicité sur chantier_id + date_snapshot). On retient le PLUS RÉCENT : c'est
// l'état de fin de semaine, celui que le bilan décrit.
function indexerParChantier(lignes) {
  const map = new Map();
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const id = str(l.chantier_id);
    if (!id) continue;
    const prec = map.get(id);
    if (!prec) { map.set(id, l); continue; }
    const dNouv = str(l.date_snapshot);
    const dPrec = str(prec.date_snapshot);
    if (dNouv >= dPrec) map.set(id, l);
  }
  return map;
}

function normaliserSeuils(seuils) {
  const s = seuils && typeof seuils === "object" ? seuils : {};
  const prendre = (cle) => {
    const n = nombreOuNull(s[cle]);
    return n == null ? SEUILS_POINTS_ATTENTION_V1[cle] : n;
  };
  return {
    avancementStableMaxPts: prendre("avancementStableMaxPts"),
    heuresAjouteesMin: prendre("heuresAjouteesMin"),
    margePerdueMinEuros: prendre("margePerdueMinEuros"),
    margePerdueGraveMinEuros: prendre("margePerdueGraveMinEuros"),
  };
}

/**
 * Détecte les chantiers qui consomment sans avancer, entre deux semaines.
 *
 * Un chantier est retenu si les TROIS conditions sont vraies :
 *   1. |avancement N − avancement N-1| <= avancementStableMaxPts
 *   2. heures_reelles N − heures_reelles N-1 >= heuresAjouteesMin
 *   3. marge N-1 − marge N                  >= margePerdueMinEuros
 *
 * @param {object} args
 * @param {Array} args.snapshotsCourants     lignes chantier_snapshots_hebdo de la semaine N
 * @param {Array} args.snapshotsPrecedents   lignes chantier_snapshots_hebdo de la semaine N-1
 * @param {object} [args.seuils]             surcharge de SEUILS_POINTS_ATTENTION_V1
 * @returns {{ version:string, seuils:object, lignes:Array,
 *   releveDisponible:boolean, relevePrecedentDisponible:boolean, comparaisonPossible:boolean }}
 *
 * ⚠️ `lignes: []` ne suffit PAS à conclure « aucune dérive » : il faut aussi
 * `releveDisponible`. Passer par etatPointsAttentionV1() plutôt que de tester
 * la longueur du tableau.
 */
export function pointsAttentionV1({ snapshotsCourants, snapshotsPrecedents, seuils } = {}) {
  const seuilsUtilises = normaliserSeuils(seuils);
  const courants = indexerParChantier(snapshotsCourants);
  const precedents = indexerParChantier(snapshotsPrecedents);
  const lignes = [];

  for (const [chantierId, courant] of courants) {
    const precedent = precedents.get(chantierId);
    // Chantier nouveau cette semaine : aucune comparaison possible. On ne le
    // signale pas — on ne peut pas prouver une dérive sans point de départ.
    if (!precedent) continue;

    const avancement = nombreOuNull(courant.avancement);
    const avancementAvant = nombreOuNull(precedent.avancement);
    const heures = nombreOuNull(courant.heures_reelles);
    const heuresAvant = nombreOuNull(precedent.heures_reelles);
    const margeApres = nombreOuNull(courant.marge);
    const margeAvant = nombreOuNull(precedent.marge);
    // Une seule donnée manquante suffit à rendre la comparaison non démontrable.
    if ([avancement, avancementAvant, heures, heuresAvant, margeApres, margeAvant].some(v => v == null)) continue;

    const avancementDelta = round2(avancement - avancementAvant);
    const heuresAjoutees = round2(heures - heuresAvant);
    const margePerdue = round2(margeAvant - margeApres);

    // MOTIF 1 — « ça n'avance pas et ça consomme » (règle d'origine, inchangée).
    const consommationSansAvancement =
      Math.abs(avancementDelta) <= seuilsUtilises.avancementStableMaxPts &&
      heuresAjoutees >= seuilsUtilises.heuresAjouteesMin &&
      margePerdue >= seuilsUtilises.margePerdueMinEuros;

    // MOTIF 2 — « ça avance, mais ça coûte beaucoup plus cher que vendu ».
    // Indépendant de l'avancement : un chantier qui progresse de 9 points en
    // brûlant 2 000 € de marge est une dérive, pas une bonne semaine. C'est
    // précisément ce que la règle d'origine laissait passer.
    const perteDeMarge = margePerdue >= seuilsUtilises.margePerdueGraveMinEuros;

    if (!consommationSansAvancement && !perteDeMarge) continue;

    // Un chantier qui déclenche les deux n'apparaît QU'UNE FOIS, avec ses deux
    // motifs : la liste compte des chantiers, pas des règles.
    const motifs = [];
    if (consommationSansAvancement) motifs.push(MOTIF_CONSOMMATION_SANS_AVANCEMENT);
    if (perteDeMarge) motifs.push(MOTIF_PERTE_DE_MARGE);

    const nom = str(courant.chantier_nom) || str(precedent.chantier_nom) || chantierId;
    lignes.push({
      motifs,
      chantier_id: chantierId,
      nom,
      avancement: round2(avancement),
      avancementAvant: round2(avancementAvant),
      avancementDelta,
      heuresAjoutees,
      heuresAvant: round2(heuresAvant),
      heures: round2(heures),
      margeAvant: round2(margeAvant),
      margeApres: round2(margeApres),
      margePerdue,
      explication: explicationDe({ motifs, avancement, avancementAvant, avancementDelta, heuresAjoutees, margePerdue }),
    });
  }

  // Le pire écart financier en premier. L'identifiant départage à égalité :
  // le classement reste identique d'un calcul à l'autre.
  lignes.sort((a, b) => b.margePerdue - a.margePerdue || a.chantier_id.localeCompare(b.chantier_id));

  return {
    version: POINTS_ATTENTION_VERSION,
    seuils: seuilsUtilises,
    // Sans ces trois drapeaux, une liste vide serait ambiguë : « rien à
    // signaler » et « on n'a pas encore les données » se ressembleraient.
    releveDisponible: releveExploitableV1(snapshotsCourants),
    relevePrecedentDisponible: releveExploitableV1(snapshotsPrecedents),
    comparaisonPossible: releveExploitableV1(snapshotsCourants) && releveExploitableV1(snapshotsPrecedents),
    lignes,
  };
}

// Phrase d'explication : décrit l'écart réellement constaté entre les deux
// snapshots, sans interprétation ni cause inventée.
function explicationDe({ motifs, avancement, avancementAvant, avancementDelta, heuresAjoutees, margePerdue }) {
  const liste = Array.isArray(motifs) ? motifs : [];
  const marche = formaterMarcheHeures(heuresAjoutees);

  // « Ça avance, mais ça coûte » : l'explication doit dire que la progression
  // ne rachète pas la perte, sinon le lecteur conclut que tout va bien.
  if (liste.includes(MOTIF_PERTE_DE_MARGE) && !liste.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT)) {
    const mouvement = avancementDelta > 0
      ? `Le chantier a progressé de ${formaterPoints(avancementDelta)} (${formaterAvancement(avancementAvant)} → ${formaterAvancement(avancement)})`
      : avancementDelta < 0
        ? `Le chantier a reculé de ${formaterPoints(avancementDelta)} (${formaterAvancement(avancementAvant)} → ${formaterAvancement(avancement)})`
        : `L'avancement n'a pas bougé (${formaterAvancement(avancementAvant)})`;
    return `${mouvement}, ${marche}, et la marge recule de ${formaterEurosV1(margePerdue)} sur la semaine : ce qui a été produit a coûté nettement plus cher que ce qu'il rapporte.`;
  }

  const mouvement = avancementDelta === 0
    ? `L'avancement n'a pas bougé (${formaterAvancement(avancementAvant)})`
    : `L'avancement n'a quasiment pas bougé (${formaterAvancement(avancementAvant)} → ${formaterAvancement(avancement)}, ${avancementDelta > 0 ? "+" : MOINS}${formaterPoints(avancementDelta)})`;
  const aggravation = liste.includes(MOTIF_PERTE_DE_MARGE)
    ? " La perte dépasse à elle seule le seuil d'alerte financière."
    : "";
  return `${mouvement} alors que ${formaterHeuresV1(heuresAjoutees)} ont été consommées ; la marge recule de ${formaterEurosV1(margePerdue)} sur la semaine.${aggravation}`;
}

// Les heures ajoutées ne sont pas toujours positives : le motif perte_de_marge
// ne les exige pas. On dit ce qui s'est réellement passé plutôt que d'annoncer
// des heures consommées qui n'existent pas.
function formaterMarcheHeures(heuresAjoutees) {
  const h = Number(heuresAjoutees) || 0;
  if (h > 0) return `${formaterHeuresV1(h)} consommées`;
  if (h === 0) return "sans aucune heure ajoutée";
  return `avec ${formaterHeuresV1(Math.abs(h))} retirées des pointages`;
}

/**
 * Phrase affichée à l'écran, dans le PDF et dans l'e-mail.
 *
 * Elle doit dire CE QUI S'EST PASSÉ, pas seulement porter un chiffre. Pour le
 * motif perte_de_marge, le « mais » est essentiel : c'est lui qui explique
 * pourquoi un chantier qui progresse remonte quand même.
 *
 *   « TOM & CAMILLE R+2 — 97 % d'avancement inchangé, +30 h consommées,
 *     marge en baisse de 1 117 € (−1 166 € → −2 283 €). »
 *   « TOM & CAMILLE R+1 — avancement +9 pts mais 53 h consommées,
 *     marge en baisse de 2 021 € (3 694 € → 1 673 €). »
 */
export function libellePointAttentionV1(ligne) {
  if (!ligne || typeof ligne !== "object") return "—";
  const nom = str(ligne.nom) || str(ligne.chantier_id) || "Chantier";
  const delta = Number(ligne.avancementDelta) || 0;
  const motifs = Array.isArray(ligne.motifs) ? ligne.motifs : [];
  const marge = `marge en baisse de ${formaterEurosV1(ligne.margePerdue)} (${formaterEurosV1(ligne.margeAvant)} → ${formaterEurosV1(ligne.margeApres)})`;

  // Perte de marge SEULE : le chantier a bougé, et c'est justement le piège.
  if (motifs.includes(MOTIF_PERTE_DE_MARGE) && !motifs.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT)) {
    const marche = formaterMarcheHeures(ligne.heuresAjoutees);
    const avance = delta > 0
      ? `avancement +${formaterPoints(delta)} mais ${marche}`
      : delta < 0
        ? `avancement en recul de ${formaterPoints(delta)}, ${marche}`
        : `avancement inchangé mais ${marche}`;
    return `${nom} — ${avance}, ${marge}.`;
  }

  // Consommation sans avancement (seule, ou cumulée avec la perte de marge).
  const avancement = delta === 0
    ? `${formaterAvancement(ligne.avancement)} d'avancement inchangé`
    : `${formaterAvancement(ligne.avancement)} d'avancement (${delta > 0 ? "+" : MOINS}${formaterPoints(delta)} seulement)`;
  const heures = `+${formaterHeuresV1(ligne.heuresAjoutees)} consommées`;
  return `${nom} — ${avancement}, ${heures}, ${marge}.`;
}

// Étiquettes de motif, affichées à côté de la phrase (écran, PDF, e-mail).
// La phrase dit les faits ; ces étiquettes disent QUELLE règle a déclenché.
export const LIBELLES_MOTIFS_V1 = Object.freeze({
  [MOTIF_CONSOMMATION_SANS_AVANCEMENT]: "consommation sans avancement",
  [MOTIF_PERTE_DE_MARGE]: "perte de marge",
});

/** "consommation sans avancement + perte de marge" · "" si aucun motif connu. */
export function libelleMotifsV1(ligne) {
  const motifs = Array.isArray(ligne?.motifs) ? ligne.motifs : [];
  return motifs.map(m => LIBELLES_MOTIFS_V1[m]).filter(Boolean).join(" + ");
}

// ── Les TROIS états de la section, en un seul endroit ───────────────────────
// Écran, PDF et e-mail lisent tous cette fonction : impossible qu'un support
// annonce « aucune dérive » pendant qu'un autre dit « pas encore de relevé ».
export const ETAT_RELEVE_ABSENT = "releve_absent";
export const ETAT_AUCUNE_DERIVE = "aucune_derive";
export const ETAT_DERIVES = "derives";

/**
 * Qualifie le résultat de pointsAttentionV1 pour l'affichage.
 *
 * @returns {{ statut:string, ton:"neutre"|"ok"|"alerte", message:string, nb:number }}
 *  - releve_absent : le relevé hebdomadaire n'existe pas encore → ton NEUTRE.
 *    Surtout pas vert : on ne sait pas, ce n'est pas une bonne nouvelle.
 *  - aucune_derive : relevé présent, rien à signaler → ton ok.
 *  - derives       : relevé présent, liste non vide → ton alerte.
 */
export function etatPointsAttentionV1(resultat) {
  const r = resultat && typeof resultat === "object" ? resultat : {};
  const lignes = Array.isArray(r.lignes) ? r.lignes : [];

  if (r.releveDisponible === false) {
    return {
      statut: ETAT_RELEVE_ABSENT,
      ton: "neutre",
      nb: 0,
      message: "Relevé hebdomadaire pas encore disponible pour cette semaine (il est produit le vendredi en fin de journée). Aucune comparaison possible.",
    };
  }
  if (r.relevePrecedentDisponible === false) {
    return {
      statut: ETAT_RELEVE_ABSENT,
      ton: "neutre",
      nb: 0,
      message: "Relevé de la semaine précédente indisponible : aucune comparaison possible sur cette semaine.",
    };
  }
  if (!lignes.length) {
    return {
      statut: ETAT_AUCUNE_DERIVE,
      ton: "ok",
      nb: 0,
      message: "Aucun point d'attention détecté cette semaine.",
    };
  }
  return {
    statut: ETAT_DERIVES,
    ton: "alerte",
    nb: lignes.length,
    message: `${lignes.length} chantier${lignes.length > 1 ? "s" : ""} consomme${lignes.length > 1 ? "nt" : ""} des heures sans avancer.`,
  };
}
