// ─────────────────────────────────────────────────────────────────────────────
// Suivi des points d'attention d'une semaine à l'autre (Chantier 07).
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord, aucune écriture. Les données arrivent en paramètre.
// Le front importe la façade src/Renovation/suiviPointsAttentionV1.js.
//
// CE QU'IL AJOUTE : la hiérarchie qui lit le PDF chaque vendredi n'a pas besoin
// d'une liste de dérives, elle a besoin de savoir LESQUELLES SONT NOUVELLES,
// lesquelles traînent, et lesquelles ont été réglées. C'est la seule chose qui
// distingue un rapport qu'on lit d'un rapport qu'on classe.
//
// MÉTHODE : on appelle pointsAttentionV1 DEUX fois — (N vs N-1) puis
// (N-1 vs N-2) — et on compare les deux listes par chantier_id. La détection
// n'est pas réimplémentée : mêmes seuils, mêmes colonnes, mêmes chiffres que
// la section « Points d'attention » de l'écran et du PDF.
//
// ⚠️ SANS TROISIÈME SEMAINE, AUCUNE ÉTIQUETTE.
// Avec seulement deux semaines de snapshots, on ne peut pas savoir si une
// dérive est nouvelle : tout paraîtrait « nouveau ». Dans ce cas le module
// renvoie `suiviDisponible: false`, des lignes SANS champ `statut`, et
// `resolus: []` — l'écran affiche alors les points d'attention nus plutôt que
// de les étiqueter à tort. Une information qu'on ne peut pas prouver ne
// s'affiche pas.
// ─────────────────────────────────────────────────────────────────────────────
import { pointsAttentionV1 } from "./pointsAttentionV1.mjs";

export const SUIVI_POINTS_ATTENTION_VERSION = "v1";

export const STATUT_NOUVEAU = "nouveau";
export const STATUT_PERSISTANT = "persistant";
export const STATUT_RESOLU = "resolu";

// Nombre de semaines consécutives qu'on peut PROUVER avec trois snapshots :
// une dérive présente en N et en N-1 dure au moins deux semaines. On n'affirme
// pas au-delà de ce que les données montrent.
const SEMAINES_CONSECUTIVES_PERSISTANT = 2;
const SEMAINES_CONSECUTIVES_NOUVEAU = 1;

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());

// Une semaine est exploitable si elle contient au moins une ligne de snapshot
// identifiable. Un tableau vide (cron qui n'a pas tourné, semaine antérieure à
// la mise en place) rend la comparaison impossible, pas fausse.
const semaineExploitable = lignes =>
  listeSure(lignes).some(l => l && typeof l === "object" && str(l.chantier_id));

/**
 * Compare les points d'attention de la semaine N à ceux de la semaine N-1.
 *
 * @param {object} args
 * @param {Array} args.snapshotsN   lignes chantier_snapshots_hebdo — semaine du bilan
 * @param {Array} args.snapshotsN1  lignes chantier_snapshots_hebdo — semaine précédente
 * @param {Array} args.snapshotsN2  lignes chantier_snapshots_hebdo — deux semaines avant
 * @param {object} [args.seuils]    mêmes seuils que pointsAttentionV1
 * @returns {{
 *   version: string,
 *   seuils: object,
 *   suiviDisponible: boolean,
 *   actifs: Array,   // points d'attention de N, étiquetés si suiviDisponible
 *   resolus: Array,  // présents en N-1, absents en N
 * }}
 */
export function suiviPointsAttentionV1({ snapshotsN, snapshotsN1, snapshotsN2, seuils } = {}) {
  const courant = pointsAttentionV1({
    snapshotsCourants: snapshotsN,
    snapshotsPrecedents: snapshotsN1,
    seuils,
  });

  // Moins de trois semaines de snapshots : on rend les points d'attention tels
  // quels, sans statut, et on le dit.
  if (!semaineExploitable(snapshotsN2) || !semaineExploitable(snapshotsN1)) {
    return {
      version: SUIVI_POINTS_ATTENTION_VERSION,
      seuils: courant.seuils,
      suiviDisponible: false,
      actifs: courant.lignes,
      resolus: [],
    };
  }

  const precedent = pointsAttentionV1({
    snapshotsCourants: snapshotsN1,
    snapshotsPrecedents: snapshotsN2,
    seuils,
  });
  const idsPrecedent = new Map(precedent.lignes.map(l => [l.chantier_id, l]));
  const idsCourant = new Set(courant.lignes.map(l => l.chantier_id));

  // L'ordre de pointsAttentionV1 (marge perdue décroissante) est conservé :
  // on ne fait qu'ajouter deux champs à chaque ligne.
  const actifs = courant.lignes.map(l => {
    const persistant = idsPrecedent.has(l.chantier_id);
    return {
      ...l,
      statut: persistant ? STATUT_PERSISTANT : STATUT_NOUVEAU,
      semainesConsecutives: persistant ? SEMAINES_CONSECUTIVES_PERSISTANT : SEMAINES_CONSECUTIVES_NOUVEAU,
    };
  });

  // Résolus : détectés la semaine dernière, plus détectés cette semaine. On
  // garde leur DERNIÈRE marge perdue connue — celle de la semaine N-1, la
  // seule qu'on ait mesurée pour eux.
  const resolus = precedent.lignes
    .filter(l => !idsCourant.has(l.chantier_id))
    .map(l => ({ ...l, statut: STATUT_RESOLU, margePerdueDerniere: l.margePerdue }));

  return {
    version: SUIVI_POINTS_ATTENTION_VERSION,
    seuils: courant.seuils,
    suiviDisponible: true,
    actifs,
    resolus,
  };
}

/**
 * Étiquette affichée à côté d'une ligne. Renvoie null quand la ligne n'a pas
 * de statut — c'est le cas hors suivi disponible, et l'écran ne doit alors
 * rien afficher plutôt qu'une étiquette inventée.
 */
export function libelleSuiviV1(ligne) {
  if (!ligne || typeof ligne !== "object") return null;
  if (ligne.statut === STATUT_RESOLU) return "ne dérive plus cette semaine";
  if (ligne.statut === STATUT_NOUVEAU) return "nouveau cette semaine";
  if (ligne.statut === STATUT_PERSISTANT) {
    const n = Number(ligne.semainesConsecutives);
    const semaines = Number.isFinite(n) && n >= SEMAINES_CONSECUTIVES_PERSISTANT
      ? n
      : SEMAINES_CONSECUTIVES_PERSISTANT;
    return `${semaines}e semaine consécutive`;
  }
  return null;
}
