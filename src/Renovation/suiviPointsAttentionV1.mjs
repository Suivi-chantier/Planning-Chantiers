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
import { pointsAttentionV1, releveExploitableV1, formaterEurosV1 } from "./pointsAttentionV1.mjs";

export const SUIVI_POINTS_ATTENTION_VERSION = "v1";

export const STATUT_NOUVEAU = "nouveau";
export const STATUT_PERSISTANT = "persistant";
// Pas « resolu » : un chantier qui sort de la liste n'a rien récupéré, il a
// seulement cessé de déraper. Le mot compte, y compris en interne — il finit
// tôt ou tard par être affiché quelque part.
export const STATUT_DERIVE_ARRETEE = "derive_arretee";

// Nombre de semaines consécutives qu'on peut PROUVER avec trois snapshots :
// une dérive présente en N et en N-1 dure au moins deux semaines. On n'affirme
// pas au-delà de ce que les données montrent.
const SEMAINES_CONSECUTIVES_PERSISTANT = 2;
const SEMAINES_CONSECUTIVES_NOUVEAU = 1;

const listeSure = v => (Array.isArray(v) ? v : []);


/**
 * Compare les points d'attention de la semaine N à ceux de la semaine N-1, et
 * chiffre ce qui a déjà été perdu sur les semaines consécutives signées.
 *
 * @param {object} args
 * @param {Array} args.snapshotsN   lignes chantier_snapshots_hebdo — semaine du bilan
 * @param {Array} args.snapshotsN1  lignes chantier_snapshots_hebdo — semaine précédente
 * @param {Array} args.snapshotsN2  lignes chantier_snapshots_hebdo — deux semaines avant
 * @param {Array} [args.historiqueAnterieur]  semaines N-3, N-4… (du plus récent au
 *   plus ancien), chacune étant un tableau de lignes. Sert UNIQUEMENT à chiffrer
 *   le cumul perdu : sans elle, le cumul s'arrête à ce qu'on peut prouver.
 * @param {object} [args.seuils]    mêmes seuils que pointsAttentionV1
 */
export function suiviPointsAttentionV1({ snapshotsN, snapshotsN1, snapshotsN2, historiqueAnterieur, seuils } = {}) {
  const semaines = [snapshotsN, snapshotsN1, snapshotsN2, ...listeSure(historiqueAnterieur)];

  // Une détection par couple de semaines consécutives, de la plus récente à la
  // plus ancienne. On s'arrête au premier couple non exploitable : au-delà, on
  // ne sait rien, et on ne l'inventera pas.
  const detections = [];
  for (let i = 0; i + 1 < semaines.length; i++) {
    if (!releveExploitableV1(semaines[i]) || !releveExploitableV1(semaines[i + 1])) break;
    detections.push(pointsAttentionV1({
      snapshotsCourants: semaines[i], snapshotsPrecedents: semaines[i + 1], seuils,
    }));
  }

  const courant = detections[0] || pointsAttentionV1({
    snapshotsCourants: snapshotsN, snapshotsPrecedents: snapshotsN1, seuils,
  });

  // Moins de trois semaines de snapshots : on rend les points d'attention tels
  // quels, sans statut, et on le dit.
  // Il faut TROIS semaines relevées d'affilée, celle du bilan comprise. Sans
  // relevé pour la semaine courante, on ne peut ni étiqueter ni déclarer qu'une
  // dérive s'est arrêtée — on ne sait simplement pas encore.
  if (detections.length < 2 || !releveExploitableV1(snapshotsN) ||
      !releveExploitableV1(snapshotsN1) || !releveExploitableV1(snapshotsN2)) {
    return {
      version: SUIVI_POINTS_ATTENTION_VERSION,
      seuils: courant.seuils,
      suiviDisponible: false,
      // Report des drapeaux : « pas de suivi » et « pas de relevé » sont deux
      // manques différents, l'écran doit pouvoir les distinguer.
      releveDisponible: courant.releveDisponible,
      relevePrecedentDisponible: courant.relevePrecedentDisponible,
      comparaisonPossible: courant.comparaisonPossible,
      actifs: courant.lignes,
      resolus: [],
    };
  }

  const precedent = detections[1];  // garanti par le garde ci-dessus
  const idsPrecedent = new Map(precedent.lignes.map(l => [l.chantier_id, l]));
  const idsCourant = new Set(courant.lignes.map(l => l.chantier_id));

  // L'ordre de pointsAttentionV1 (marge perdue décroissante) est conservé :
  // on ne fait qu'ajouter des champs à chaque ligne.
  const actifs = courant.lignes.map(l => {
    const persistant = idsPrecedent.has(l.chantier_id);
    return {
      ...l,
      statut: persistant ? STATUT_PERSISTANT : STATUT_NOUVEAU,
      semainesConsecutives: persistant ? SEMAINES_CONSECUTIVES_PERSISTANT : SEMAINES_CONSECUTIVES_NOUVEAU,
      ...cumulPourChantier(detections, 0, l.chantier_id),
    };
  });

  // Dérives ARRÊTÉES : signées la semaine dernière, plus cette semaine. Elles
  // ne sont pas « résolues » — l'argent perdu ne revient pas. On chiffre donc
  // le cumul des semaines consécutives où le chantier a été signé.
  const resolus = precedent.lignes
    .filter(l => !idsCourant.has(l.chantier_id))
    .map(l => ({
      ...l,
      statut: STATUT_DERIVE_ARRETEE,
      margePerdueDerniere: l.margePerdue,
      ...cumulPourChantier(detections, 1, l.chantier_id),
    }));

  return {
    version: SUIVI_POINTS_ATTENTION_VERSION,
    seuils: courant.seuils,
    suiviDisponible: true,
    releveDisponible: courant.releveDisponible,
    relevePrecedentDisponible: courant.relevePrecedentDisponible,
    comparaisonPossible: courant.comparaisonPossible,
    semainesComparees: detections.length,
    actifs,
    resolus,
  };
}

/**
 * Cumul de marge perdue sur les semaines CONSÉCUTIVES où le chantier a été
 * signé, en partant de `depuis` et en remontant le temps.
 *
 * `cumulComplet: false` signifie que la série touche le bord de l'historique
 * disponible : la dérive a peut-être commencé avant, on n'en sait rien. Le
 * montant est alors un MINIMUM, et l'affichage doit dire « au moins ».
 */
function cumulPourChantier(detections, depuis, chantierId) {
  let total = 0;
  let semaines = 0;
  let i = depuis;
  for (; i < detections.length; i++) {
    const ligne = detections[i].lignes.find(l => l.chantier_id === chantierId);
    if (!ligne) break;
    total += Number(ligne.margePerdue) || 0;
    semaines += 1;
  }
  return {
    cumulMargePerdue: Math.round((total + Number.EPSILON) * 100) / 100,
    cumulSemaines: semaines,
    cumulComplet: i < detections.length,
  };
}

/**
 * Étiquette affichée à côté d'une ligne. Renvoie null quand la ligne n'a pas
 * de statut — c'est le cas hors suivi disponible, et l'écran ne doit alors
 * rien afficher plutôt qu'une étiquette inventée.
 */
export function libelleSuiviV1(ligne) {
  if (!ligne || typeof ligne !== "object") return null;
  if (ligne.statut === STATUT_DERIVE_ARRETEE) return "ne dérive plus cette semaine";
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

/**
 * Phrase des dérives ARRÊTÉES, identique à l'écran, dans le PDF et dans l'e-mail.
 *
 * Le mot « résolu » est proscrit : un chantier qui sort de la liste n'a pas
 * récupéré son argent, il a seulement cessé de déraper cette semaine. Écrire
 * « résolu » dans un document transmis à la hiérarchie dirait le contraire de
 * la réalité. Chaque chantier porte donc le montant déjà perdu.
 *
 * @returns {string} "" si la liste est vide (aucune rubrique à afficher).
 */
export function libelleDerivesArreteesV1(resolus) {
  const liste = listeSure(resolus).filter(l => l && typeof l === "object");
  if (!liste.length) return "";
  const details = liste.map(l => {
    const nom = String(l.nom || l.chantier_id || "Chantier").trim();
    const semaines = Number(l.cumulSemaines) || 0;
    if (!semaines) return nom;
    // Cumul incomplet = la série touche le bord de l'historique : on dit « au
    // moins », jamais un total qu'on ne peut pas prouver.
    const prefixe = l.cumulComplet === false ? "au moins " : "";
    return `${nom} — ${prefixe}${formaterEurosV1(l.cumulMargePerdue)} perdus sur ${semaines} semaine${semaines > 1 ? "s" : ""} signée${semaines > 1 ? "s" : ""}`;
  });
  return `La dérive signalée la semaine dernière s'est arrêtée (la marge perdue n'est pas récupérée) : ${details.join(" ; ")}.`;
}
