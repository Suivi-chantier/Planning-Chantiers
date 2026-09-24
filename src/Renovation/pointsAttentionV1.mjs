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
});

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
 * @returns {{ version:string, seuils:object, lignes:Array }}
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

    if (Math.abs(avancementDelta) > seuilsUtilises.avancementStableMaxPts) continue;
    if (heuresAjoutees < seuilsUtilises.heuresAjouteesMin) continue;
    if (margePerdue < seuilsUtilises.margePerdueMinEuros) continue;

    const nom = str(courant.chantier_nom) || str(precedent.chantier_nom) || chantierId;
    lignes.push({
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
      explication: explicationDe({ avancement, avancementAvant, avancementDelta, heuresAjoutees, margePerdue }),
    });
  }

  // Le pire écart financier en premier. L'identifiant départage à égalité :
  // le classement reste identique d'un calcul à l'autre.
  lignes.sort((a, b) => b.margePerdue - a.margePerdue || a.chantier_id.localeCompare(b.chantier_id));

  return { version: POINTS_ATTENTION_VERSION, seuils: seuilsUtilises, lignes };
}

// Phrase d'explication : décrit l'écart réellement constaté entre les deux
// snapshots, sans interprétation ni cause inventée.
function explicationDe({ avancement, avancementAvant, avancementDelta, heuresAjoutees, margePerdue }) {
  const mouvement = avancementDelta === 0
    ? `L'avancement n'a pas bougé (${formaterAvancement(avancementAvant)})`
    : `L'avancement n'a quasiment pas bougé (${formaterAvancement(avancementAvant)} → ${formaterAvancement(avancement)}, ${avancementDelta > 0 ? "+" : MOINS}${formaterPoints(avancementDelta)})`;
  return `${mouvement} alors que ${formaterHeuresV1(heuresAjoutees)} ont été consommées ; la marge recule de ${formaterEurosV1(margePerdue)} sur la semaine.`;
}

/**
 * Phrase affichée à l'écran et dans le PDF, par exemple :
 * « TOM & CAMILLE R+2 — 97 % d'avancement inchangé, +30 h consommées,
 *   marge en baisse de 1 117 € (−1 166 € → −2 283 €). »
 */
export function libellePointAttentionV1(ligne) {
  if (!ligne || typeof ligne !== "object") return "—";
  const nom = str(ligne.nom) || str(ligne.chantier_id) || "Chantier";
  const delta = Number(ligne.avancementDelta) || 0;
  const avancement = delta === 0
    ? `${formaterAvancement(ligne.avancement)} d'avancement inchangé`
    : `${formaterAvancement(ligne.avancement)} d'avancement (${delta > 0 ? "+" : MOINS}${formaterPoints(delta)} seulement)`;
  const heures = `+${formaterHeuresV1(ligne.heuresAjoutees)} consommées`;
  const marge = `marge en baisse de ${formaterEurosV1(ligne.margePerdue)} (${formaterEurosV1(ligne.margeAvant)} → ${formaterEurosV1(ligne.margeApres)})`;
  return `${nom} — ${avancement}, ${heures}, ${marge}.`;
}
