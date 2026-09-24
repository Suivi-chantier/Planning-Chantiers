// ─────────────────────────────────────────────────────────────────────────────
// Échantillon de cadences (Chantier 08 — Analyse & apprentissage, livrable 1).
//
// CE QUE CE MODULE FAIT : pour chaque type d'ouvrage de la bibliothèque, il
// compte combien d'ouvrages RÉELLEMENT TERMINÉS on possède, sur combien de
// chantiers, et il qualifie cet échantillon : insuffisant / indicatif / fiable.
//
// CE QU'IL NE FAIT PAS, ET NE FERA PAS DANS CETTE VERSION :
//   • il ne calcule AUCUNE cadence corrigée ;
//   • il ne propose AUCUNE modification de bibliotheque_ratios ;
//   • il n'écrit rien, nulle part.
// La raison est mesurée, pas théorique (constats du 24/09/2026 sur la base) :
//   – 204 ouvrages de phasage entièrement terminés, dont 51 seulement sont
//     comparables (bibliotheque_id + heures vendues + heures pointées) ;
//   – ces 51 couvrent 33 types : 22 types n'ont qu'UN ouvrage. AUCUN type
//     n'atteint 5 ouvrages sur 3 chantiers ;
//   – le même jeu de données donne +39 % par tâche et −12 % par ouvrage :
//     deux découpages, deux signes OPPOSÉS. Tant que ce désaccord n'est pas
//     tranché, aucun chiffre d'écart ne peut servir à corriger une cadence.
// Corriger une cadence sur un ou deux ouvrages reviendrait à graver une
// coïncidence dans le référentiel de prix. Le module dit donc, le plus
// souvent, « pas encore assez » — et c'est le résultat attendu.
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord. Les données arrivent en paramètre. Extension .mjs = parsable
// ESM par Node sans build ; le front importe la façade echantillonCadencesV1.js.
//
// ⚠️ MÊME CHIFFRE = MÊME SERVICE + MÊME EXPLICATION.
// Les heures ne sont PAS recalculées ici. Le rapprochement pointage → tâche
// est celui de src/chantierFinance.mjs (indexPointagesParTache / tachePointages
// / sumHeures / tacheHeuresVendues), c'est-à-dire exactement la règle qui
// produit les heures réelles affichées dans le Phasage et dans le Bilan
// Semaine. Aucun rapprochement parallèle n'est écrit dans ce fichier.
//
// RAPPROCHEMENT : les heures réelles vivent dans la table `pointages`, jamais
// dans le phasage. On apparie par (chantier_id, tache_id) — un tache_id seul ne
// suffit pas, il n'est unique qu'à l'intérieur d'un chantier. Sont exclus :
//   – les pointages type_pointage='indirect' (547 en base, sans tâche, et
//     c'est légitime : ils ne se rattachent à aucun ouvrage) ;
//   – les pointages type 'tache' sans tache_id (96 en base, 191 h) : ces heures
//     ont bien été faites, mais on ignore sur quel ouvrage. Les imputer serait
//     inventer ; les compter à zéro aussi. Elles sortent de l'échantillon.
//
// DONNÉE MANQUANTE = ÉCARTÉE, JAMAIS COMPTÉE À ZÉRO. Un ouvrage dont on ne
// peut pas établir qu'il est terminé n'est pas « en cours » : il est inconnu,
// donc hors échantillon.
// ─────────────────────────────────────────────────────────────────────────────

import {
  indexPointagesParTache,
  tachePointages,
  sumHeures,
  tacheHeuresVendues,
} from "../chantierFinance.mjs";

export const ECHANTILLON_CADENCES_VERSION = "v1";

/**
 * Seuils par défaut — PARAMÉTRABLES via l'argument `seuils` de la fonction.
 *
 *  - ouvragesMinIndicatif : en deçà, on ne dit rien du tout d'un écart.
 *      Deux ouvrages qui se ressemblent ne sont pas une tendance.
 *  - ouvragesMinFiable / chantiersMinFiable : « fiable » exige les DEUX.
 *      Cinq ouvrages sur un seul chantier ne mesurent pas la cadence d'un
 *      ouvrage : ils mesurent l'équipe et le bâtiment de ce chantier-là.
 *      C'est le sens de la double condition, et pourquoi elle ne se relâche
 *      pas en « 5 ouvrages OU 3 chantiers ».
 */
export const SEUILS_ECHANTILLON_CADENCES_V1 = Object.freeze({
  ouvragesMinIndicatif: 3,
  ouvragesMinFiable: 5,
  chantiersMinFiable: 3,
});

// Les trois qualités d'échantillon. L'ordre est celui de la confiance.
export const NIVEAU_INSUFFISANT = "insuffisant";
export const NIVEAU_INDICATIF = "indicatif";
export const NIVEAU_FIABLE = "fiable";
export const NIVEAUX_ECHANTILLON = Object.freeze([
  NIVEAU_INSUFFISANT, NIVEAU_INDICATIF, NIVEAU_FIABLE,
]);

// Phrase d'avertissement attachée à tout écart non « fiable ». Elle accompagne
// le chiffre PARTOUT où il est affiché : un écart indicatif sorti de son
// avertissement redevient un ordre de correction.
export const AVERTISSEMENT_INDICATIF =
  "indicatif — ne pas corriger la cadence sur cette base";

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());

// null, undefined, "" et NaN sont des données INDISPONIBLES, pas des zéros.
const nombreOuNull = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round1 = v => Math.round((Number(v) + Number.EPSILON) * 10) / 10;

/**
 * Un ouvrage est-il ENTIÈREMENT terminé ?
 * Exige au moins une tâche, et un avancement LISIBLE et égal à 100 sur
 * chacune. Un avancement absent ou illisible ne vaut pas « terminé » : on ne
 * sait pas, et on ne devine pas.
 */
export function ouvrageEntierementTermineV1(ouvrage) {
  const taches = listeSure(ouvrage?.taches);
  if (taches.length === 0) return false;
  return taches.every(t => nombreOuNull(t?.avancement) === 100);
}

/**
 * Construit l'index des pointages d'UN chantier, par tache_id.
 * Le filtre type_pointage==='tache' est explicite ici, en plus de l'exclusion
 * des 'indirect' faite par indexPointagesParTache : si un troisième type de
 * pointage apparaît un jour en base, il n'entrera pas dans l'échantillon sans
 * décision. Le reste de la règle (tache_id obligatoire) reste celui de
 * chantierFinance, non redit.
 */
function indexerPointagesTacheParChantier(pointages) {
  const parChantier = new Map();
  listeSure(pointages).forEach(p => {
    if (str(p?.type_pointage) !== "tache") return;
    const c = str(p?.chantier_id);
    if (!c) return; // sans chantier, aucun rapprochement possible
    if (!parChantier.has(c)) parChantier.set(c, []);
    parChantier.get(c).push(p);
  });
  const index = new Map();
  parChantier.forEach((pts, chantierId) => index.set(chantierId, indexPointagesParTache(pts)));
  return index;
}

/**
 * Les ouvrages RETENUS dans l'échantillon, à plat.
 * Un ouvrage entre si, et seulement si :
 *   – toutes ses tâches sont à 100 % ;
 *   – bibliotheque_id est renseigné (sans lui, on ne sait pas quel type
 *     d'ouvrage il documente) ;
 *   – la somme des heures vendues de ses tâches est > 0 ;
 *   – les heures pointées sur ses tâches sont > 0.
 *
 * @param {Array} phasages  [{ chantier_id, ouvrages: [{ bibliotheque_id, taches: [...] }] }]
 * @param {Array} pointages lignes de la table `pointages`
 */
export function ouvragesComparablesV1(phasages, pointages) {
  const indexParChantier = indexerPointagesTacheParChantier(pointages);
  const retenus = [];

  listeSure(phasages).forEach(ph => {
    const chantierId = str(ph?.chantier_id);
    if (!chantierId) return;
    const ppt = indexParChantier.get(chantierId) || {};

    listeSure(ph?.ouvrages).forEach(o => {
      const bibliothequeId = str(o?.bibliotheque_id);
      if (!bibliothequeId) return;
      if (!ouvrageEntierementTermineV1(o)) return;

      const taches = listeSure(o.taches);
      // Heures vendues et heures réelles : primitives de chantierFinance, pas
      // de formule locale. tachePointages + sumHeures = le registre SEUL,
      // sans le repli legacy sur taches[].heures_reelles — ce champ du phasage
      // n'est pas la source des heures réelles.
      const heuresVendues = taches.reduce((s, t) => s + tacheHeuresVendues(t), 0);
      const heuresReelles = taches.reduce((s, t) => s + sumHeures(tachePointages(t, ppt)), 0);
      if (!(heuresVendues > 0) || !(heuresReelles > 0)) return;

      retenus.push({
        bibliothequeId,
        chantierId,
        ouvrageId: str(o?.id) || null,
        libelle: str(o?.libelle) || null,
        heuresVendues: round1(heuresVendues),
        heuresReelles: round1(heuresReelles),
      });
    });
  });

  return retenus;
}

/** Qualifie un échantillon. Voir SEUILS_ECHANTILLON_CADENCES_V1 pour le pourquoi. */
export function niveauEchantillonV1(nOuvrages, nChantiers, seuils = SEUILS_ECHANTILLON_CADENCES_V1) {
  const s = { ...SEUILS_ECHANTILLON_CADENCES_V1, ...(seuils || {}) };
  if (nOuvrages < s.ouvragesMinIndicatif) return NIVEAU_INSUFFISANT;
  if (nOuvrages >= s.ouvragesMinFiable && nChantiers >= s.chantiersMinFiable) return NIVEAU_FIABLE;
  return NIVEAU_INDICATIF;
}

/**
 * L'échantillon par type de bibliothèque.
 *
 * @returns {{ version, seuils, parBibliotheque: Array, totaux: object }}
 *   parBibliotheque[] = { bibliothequeId, nOuvrages, nChantiers, heuresVendues,
 *                         heuresReelles, ecartPct, niveau }
 *
 * ecartPct vaut null en « insuffisant ». Ce n'est pas une omission d'affichage :
 * un écart calculé sur un ou deux ouvrages n'est pas une information, et un
 * chiffre affiché finit toujours par être lu comme une mesure.
 */
export function echantillonCadencesV1({ phasages, pointages, seuils } = {}) {
  const seuilsAppliques = Object.freeze({ ...SEUILS_ECHANTILLON_CADENCES_V1, ...(seuils || {}) });
  const retenus = ouvragesComparablesV1(phasages, pointages);

  const parId = new Map();
  retenus.forEach(r => {
    if (!parId.has(r.bibliothequeId)) {
      parId.set(r.bibliothequeId, {
        bibliothequeId: r.bibliothequeId,
        nOuvrages: 0,
        chantiers: new Set(),
        heuresVendues: 0,
        heuresReelles: 0,
      });
    }
    const a = parId.get(r.bibliothequeId);
    a.nOuvrages += 1;
    a.chantiers.add(r.chantierId);
    a.heuresVendues += r.heuresVendues;
    a.heuresReelles += r.heuresReelles;
  });

  const parBibliotheque = [...parId.values()]
    .map(a => {
      const nChantiers = a.chantiers.size;
      const niveau = niveauEchantillonV1(a.nOuvrages, nChantiers, seuilsAppliques);
      const heuresVendues = round1(a.heuresVendues);
      const heuresReelles = round1(a.heuresReelles);
      return {
        bibliothequeId: a.bibliothequeId,
        nOuvrages: a.nOuvrages,
        nChantiers,
        heuresVendues,
        heuresReelles,
        ecartPct: niveau === NIVEAU_INSUFFISANT
          ? null
          : round1(((heuresReelles - heuresVendues) / heuresVendues) * 100),
        niveau,
      };
    })
    .sort((a, b) => (b.nOuvrages - a.nOuvrages) || a.bibliothequeId.localeCompare(b.bibliothequeId));

  const compter = n => parBibliotheque.filter(e => e.niveau === n).length;

  return {
    version: ECHANTILLON_CADENCES_VERSION,
    seuils: seuilsAppliques,
    parBibliotheque,
    totaux: {
      nTypes: parBibliotheque.length,
      nOuvragesRetenus: retenus.length,
      insuffisant: compter(NIVEAU_INSUFFISANT),
      indicatif: compter(NIVEAU_INDICATIF),
      fiable: compter(NIVEAU_FIABLE),
    },
  };
}

/** Index { bibliotheque_id → entrée } pour un affichage ligne à ligne. */
export function indexEchantillonParBibliothequeV1(resultat) {
  const index = {};
  listeSure(resultat?.parBibliotheque).forEach(e => { index[e.bibliothequeId] = e; });
  return index;
}

// ── Libellés (purs, sans ICU) ───────────────────────────────────────────────
// Pas de toLocaleString : son séparateur dépend de la version d'ICU de la
// machine, ce qui rendrait les libellés non déterministes entre le navigateur
// d'un poste et le Node d'un script de vérification.
const MOINS = "−"; // vrai signe moins typographique
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** 12.5 → "+12,5 %" · -8 → "−8 %" · null → "—" */
export function formaterEcartPctV1(valeur) {
  const n = nombreOuNull(valeur);
  if (n == null) return "—";
  const arrondi = round1(n);
  const abs = Math.abs(arrondi);
  const texte = String(abs).replace(".", ",");
  return `${arrondi < 0 ? MOINS : "+"}${texte} %`;
}

/**
 * La phrase d'échantillon, telle qu'elle s'affiche.
 * Une entrée absente n'est PAS un échantillon vide : c'est un type pour lequel
 * aucun ouvrage terminé n'a été trouvé. Les deux se disent différemment.
 */
export function libelleEchantillonV1(entree) {
  if (!entree) return "Échantillon : aucun ouvrage terminé comparable";
  const { nOuvrages, nChantiers, niveau } = entree;
  return `Échantillon : ${pluriel(nOuvrages, "ouvrage")} ${nOuvrages > 1 ? "terminés" : "terminé"} sur ${pluriel(nChantiers, "chantier")} — ${niveau}`;
}

/**
 * La phrase d'écart, ou null quand il n'y a rien à dire.
 * Elle porte son avertissement tant que le niveau n'est pas « fiable » :
 * le chiffre et sa mise en garde ne se séparent jamais.
 */
export function libelleEcartEchantillonV1(entree) {
  if (!entree || entree.ecartPct == null) return null;
  const sens = entree.ecartPct >= 0 ? "de plus que vendu" : "de moins que vendu";
  const base = `Réel ${formaterEcartPctV1(entree.ecartPct)} ${sens}`;
  return entree.niveau === NIVEAU_FIABLE ? base : `${base} (${AVERTISSEMENT_INDICATIF})`;
}
