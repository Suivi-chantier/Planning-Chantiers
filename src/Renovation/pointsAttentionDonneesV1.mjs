// ─────────────────────────────────────────────────────────────────────────────
// Préparation des relevés hebdomadaires pour les points d'attention (Chantier 07).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// Il ne détecte rien et ne calcule aucune finance — il met seulement les lignes
// brutes de chantier_snapshots_hebdo dans l'état que les modules de calcul
// attendent. Le front importe la façade src/Renovation/pointsAttentionDonneesV1.js.
//
// POURQUOI CE MODULE EXISTE — les doublons de relevé.
// Le cron d'alimentation a tourné DEUX FOIS en semaine 2026-W31 : cette semaine
// porte 36 lignes pour 19 chantiers, soit 17 doublons (seule semaine concernée
// sur les 20 relevées). Un même chantier y apparaît avec deux états différents
// (par exemple 58 % / 11 856 € et 42 % / 13 781 €). Sans dédoublonnage, un
// rapprochement par chantier_id produit soit une ligne en double dans les points
// d'attention, soit une valeur arbitraire selon l'ordre de lecture.
//
// Ce n'est pas un cas de bord : le suivi remonte huit semaines d'historique pour
// chiffrer les cumuls, et huit semaines avant W38 tombe exactement sur W31.
//
// ⚠️ LE DÉDOUBLONNAGE SE FAIT ICI, UNE SEULE FOIS.
// Les modules de calcul (pointsAttentionV1, suiviPointsAttentionV1) reçoivent
// des données déjà propres et restent purs. On ne recopie pas cette règle chez
// eux : une seule définition de « la bonne ligne d'un chantier pour une semaine ».
//
// ⚠️ LECTURE SEULE. Rien n'est supprimé en base : les doublons restent, on
// choisit simplement lequel fait foi à l'affichage.
// ─────────────────────────────────────────────────────────────────────────────

export const POINTS_ATTENTION_DONNEES_VERSION = "v1";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);

/**
 * Compare deux lignes du même couple (chantier_id, week_id) et dit si la
 * candidate doit remplacer celle déjà retenue.
 *
 * Critère principal : `created_at`, l'instant d'écriture — c'est le seul champ
 * qui dit quelle exécution du cron est la plus récente. `date_snapshot` sert de
 * recours quand created_at manque (lignes reconstituées par backfill). À égalité
 * parfaite, la PREMIÈRE ligne rencontrée gagne : le résultat reste identique
 * d'un chargement à l'autre pour une même entrée.
 */
function plusRecente(candidate, retenue) {
  const cCreated = str(candidate.created_at);
  const rCreated = str(retenue.created_at);
  if (cCreated !== rCreated) {
    // Une ligne horodatée l'emporte toujours sur une ligne qui ne l'est pas.
    if (!rCreated) return true;
    if (!cCreated) return false;
    return cCreated > rCreated;
  }
  const cSnap = str(candidate.date_snapshot);
  const rSnap = str(retenue.date_snapshot);
  if (cSnap !== rSnap) return cSnap > rSnap;
  return false;
}

/**
 * Une seule ligne par (chantier_id, week_id) : la plus récemment écrite.
 *
 * Les lignes sans chantier_id sont écartées (elles n'appartiennent à aucun
 * chantier). L'ordre de sortie suit l'ordre d'entrée des lignes retenues.
 *
 * @param {Array} lignes  lignes brutes de chantier_snapshots_hebdo
 * @returns {Array}
 */
export function dedoublonnerSnapshotsV1(lignes) {
  const retenues = new Map();
  const ordre = [];
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const chantierId = str(l.chantier_id);
    if (!chantierId) continue;
    const cle = `${chantierId}::${str(l.week_id)}`;
    const dejaLa = retenues.get(cle);
    if (!dejaLa) {
      retenues.set(cle, l);
      ordre.push(cle);
      continue;
    }
    if (plusRecente(l, dejaLa)) retenues.set(cle, l);
  }
  return ordre.map(cle => retenues.get(cle));
}

/**
 * Découpe les lignes par semaine, dans l'ordre des week_id demandés, après
 * dédoublonnage. C'est la forme attendue par suiviPointsAttentionV1 :
 * index 0 = semaine du bilan, 1 = précédente, etc.
 *
 * Une semaine sans aucune ligne rend un tableau vide — et pas une absence :
 * c'est ce qui permet aux modules de dire « relevé pas encore disponible »
 * plutôt que « aucune dérive ».
 *
 * @param {object} args
 * @param {Array} args.lignes    lignes brutes, toutes semaines mélangées
 * @param {Array} args.weekIds   week_id dans l'ordre voulu
 * @returns {Array<Array>}
 */
export function preparerSemainesAttentionV1({ lignes, weekIds } = {}) {
  const propres = dedoublonnerSnapshotsV1(lignes);
  return listeSure(weekIds).map(w => propres.filter(l => str(l.week_id) === str(w)));
}

/**
 * Compte les doublons écartés, par semaine. Sert à documenter ce qui a été
 * ignoré plutôt qu'à le masquer : une anomalie de relevé doit rester
 * observable, même quand on sait la contourner.
 *
 * @returns {{ total:number, parSemaine:Array<{week_id:string, doublons:number}> }}
 */
export function auditDoublonsSnapshotsV1(lignes) {
  const vues = new Map();
  const parSemaine = new Map();
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const chantierId = str(l.chantier_id);
    if (!chantierId) continue;
    const week = str(l.week_id);
    const cle = `${chantierId}::${week}`;
    if (vues.has(cle)) parSemaine.set(week, (parSemaine.get(week) || 0) + 1);
    else vues.set(cle, true);
  }
  const lignesAudit = [...parSemaine.entries()]
    .map(([week_id, doublons]) => ({ week_id, doublons }))
    .sort((a, b) => a.week_id.localeCompare(b.week_id));
  return {
    total: lignesAudit.reduce((s, x) => s + x.doublons, 0),
    parSemaine: lignesAudit,
  };
}
