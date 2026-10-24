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

// ── Relevés JOURNALIERS (étape 2 des marges, 24/10/2026) ────────────────────
// Le Bilan et la page Alertes comparent désormais des relevés journaliers
// (chantier_releves_journaliers). L'état d'un chantier en fin de semaine est
// son relevé le plus récent daté au plus tard du dimanche de cette semaine :
// un relevé décrit l'état cumulé en fin de journée, donc un jour sans
// mouvement (week-end, chantier à l'arrêt) garde l'état du dernier jour
// travaillé. Un chantier sans aucun relevé avant cette date est ABSENT de la
// semaine (jamais un relevé inventé).

/** Dimanche (AAAA-MM-JJ) de la semaine ISO « AAAA-Www », ou null. */
export function dimancheSemaineISOV2(weekId) {
  const m = /^(\d{4})-W(\d{2})$/.exec(str(weekId));
  if (!m) return null;
  const annee = Number(m[1]), semaine = Number(m[2]);
  // Le 4 janvier est toujours dans la semaine 1.
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const lundiS1 = new Date(j4);
  lundiS1.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() + 6) % 7));
  const dimanche = new Date(lundiS1);
  dimanche.setUTCDate(lundiS1.getUTCDate() + (semaine - 1) * 7 + 6);
  return dimanche.toISOString().slice(0, 10);
}

/**
 * Un tableau par semaine demandée (même ordre que `weekIds`), contenant pour
 * chaque chantier son relevé journalier le plus récent au plus tard le
 * dimanche de la semaine.
 * @param {object} args
 * @param {Array} args.lignes   lignes de chantier_releves_journaliers
 * @param {Array} args.weekIds  « AAAA-Www », de la plus récente à la plus ancienne
 */
export function preparerSemainesRelevesJournaliersV2({ lignes, weekIds } = {}) {
  const parChantier = new Map();
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const id = str(l.chantier_id);
    const d = str(l.date_releve).slice(0, 10);
    if (!id || !d) continue;
    if (!parChantier.has(id)) parChantier.set(id, []);
    parChantier.get(id).push(l);
  }
  parChantier.forEach(liste => liste.sort((a, b) => str(a.date_releve).localeCompare(str(b.date_releve))));
  return listeSure(weekIds).map(w => {
    const fin = dimancheSemaineISOV2(w);
    if (!fin) return [];
    const out = [];
    parChantier.forEach(liste => {
      let retenu = null;
      for (const l of liste) { if (str(l.date_releve).slice(0, 10) <= fin) retenu = l; else break; }
      if (retenu) out.push(retenu);
    });
    return out;
  });
}

// Colonnes des relevés journaliers lues par les alertes des marges.
export const COLONNES_RELEVES_ALERTES_V2 =
  "chantier_id, chantier_nom, week_id, date_releve, avancement, vendu_ht, heures_vendues, heures_reelles, "
  + "production_cumulee, marge_avancement, marge_probable, marge_terminaison, budget_restant, "
  + "heures_sans_lot, pct_sans_lot, chantier_repris, lots, warnings, statut_completude";
