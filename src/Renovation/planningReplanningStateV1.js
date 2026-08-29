// ─── CHANTIER 05 — ÉTAT RÉEL / RESTE À FAIRE V1 ─────────────────────────────
// Module PUR : aucune lecture/écriture Supabase.
//
// Le phasage reste la source de vérité métier de l'avancement. Les pointages et
// heures_reelles servent à l'historique / audit mais ne réduisent jamais le
// reste à faire à eux seuls. Une ancienne date de forecast ne termine jamais
// implicitement une tâche.

export const PLANNING_REPLANNING_STATE_VERSION = 1;

const EPS = 0.005;
const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, num(v, min)));
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dateOnly = v => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export function cleEtatReelTacheV1(chantierId, tacheId) {
  return `${txt(chantierId)}::${txt(tacheId)}`;
}

export function heuresReferenceTacheV1(tache) {
  const vendues = Math.max(0, num(tache?.heures_vendues, 0));
  const estimees = Math.max(0, num(tache?.heures_estimees, 0));
  return round2(vendues > EPS ? vendues : estimees);
}

export function normaliserAvancementTacheV1(tache) {
  return round2(clamp(tache?.avancement, 0, 100));
}

export function resteAFaireTacheV1(tache) {
  const total = heuresReferenceTacheV1(tache);
  const avancement = normaliserAvancementTacheV1(tache);
  return round2(total * (1 - avancement / 100));
}

export function etatReelTacheV1({
  chantierId,
  tache,
  today,
  phasageUpdatedAt = null,
} = {}) {
  const tacheId = txt(tache?.id);
  const chantier = txt(chantierId);
  const total = heuresReferenceTacheV1(tache);
  const avancement = normaliserAvancementTacheV1(tache);
  const reste = resteAFaireTacheV1(tache);
  const datePrevue = dateOnly(tache?.date_prevue);
  const dateReference = dateOnly(today);
  const terminee = avancement >= 100 - EPS || reste <= EPS || total <= EPS;
  const statutReel = terminee ? "terminee" : avancement > EPS ? "en_cours" : "a_faire";
  const enRetard = Boolean(!terminee && datePrevue && dateReference && datePrevue < dateReference);

  return {
    schema_version: 1,
    id: cleEtatReelTacheV1(chantier, tacheId),
    chantier_id: chantier || null,
    tache_id: tacheId || null,
    nom: txt(tache?.nom) || null,
    statut_reel: statutReel,
    avancement,
    heures_reference: total,
    reste_a_faire_heures: terminee ? 0 : reste,
    date_prevue: datePrevue,
    en_retard: enRetard,
    planifiable: !terminee && reste > EPS && Boolean(chantier && tacheId),
    provenance: {
      source_verite: "phasage",
      calcul_reste: "heures_reference_x_avancement_physique",
      heures_reference: num(tache?.heures_vendues, 0) > EPS ? "heures_vendues" : "heures_estimees",
      dernier_avancement_connu_le: tache?.avancement_updated_at || phasageUpdatedAt || null,
    },
    audit: {
      heures_reelles_observees: tache?.heures_reelles == null ? null : round2(Math.max(0, num(tache.heures_reelles, 0))),
      heures_reelles_utilisees_pour_reste: false,
      date_prevue_utilisee_pour_statut_termine: false,
    },
  };
}

export function construireEtatReelPhasagesV1(phasages = [], { today } = {}) {
  const travaux = [];
  const warnings = [];
  const seen = new Set();

  for (const ph of Array.isArray(phasages) ? phasages : []) {
    const chantierId = txt(ph?.chantier_id);
    const ouvrages = Array.isArray(ph?.ouvrages) ? ph.ouvrages : [];
    for (const ouvrage of ouvrages) {
      for (const tache of Array.isArray(ouvrage?.taches) ? ouvrage.taches : []) {
        const etat = etatReelTacheV1({
          chantierId,
          tache,
          today,
          phasageUpdatedAt: ph?.updated_at || null,
        });
        if (!etat.tache_id || !etat.chantier_id) {
          warnings.push({
            type: "tache_sans_identite_stable",
            chantier_id: chantierId || null,
            tache_id: etat.tache_id,
            explication: "Tâche exclue de l'état réel car chantier_id ou tache_id est absent.",
          });
          continue;
        }
        if (seen.has(etat.id)) {
          warnings.push({
            type: "tache_identite_dupliquee",
            chantier_id: etat.chantier_id,
            tache_id: etat.tache_id,
            explication: "Même identité chantier::tâche rencontrée plusieurs fois ; aucune nouvelle identité n'est créée.",
          });
          continue;
        }
        seen.add(etat.id);
        travaux.push(etat);
      }
    }
  }

  travaux.sort((a, b) => a.id.localeCompare(b.id));
  warnings.sort((a, b) => `${a.type}|${a.chantier_id}|${a.tache_id}`.localeCompare(`${b.type}|${b.chantier_id}|${b.tache_id}`));

  return {
    schema_version: 1,
    travaux,
    warnings,
    audit: {
      taches_total: travaux.length,
      taches_planifiables: travaux.filter(t => t.planifiable).length,
      taches_terminees: travaux.filter(t => t.statut_reel === "terminee").length,
      taches_en_cours: travaux.filter(t => t.statut_reel === "en_cours").length,
      taches_en_retard: travaux.filter(t => t.en_retard).length,
      reste_a_faire_heures: round2(travaux.reduce((s, t) => s + t.reste_a_faire_heures, 0)),
    },
    invariants: {
      phasage_source_de_verite: true,
      date_passee_ne_termine_pas_tache: true,
      heures_reelles_ne_reduisent_pas_le_reste: true,
      identite_tache_preservee: true,
    },
  };
}
