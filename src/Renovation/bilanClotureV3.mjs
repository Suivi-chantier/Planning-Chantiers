// ─────────────────────────────────────────────────────────────────────────────
// Bilan de CLÔTURE d'un chantier (refonte du Bilan, étape 3.7).
//
// Quand un chantier est à 100 % : devis / réel lot par lot et ouvrage par
// ouvrage (heures, matériaux, marge finale), et la PROPOSITION de mise à jour
// des cadences de la bibliothèque : cadence constatée = heures réelles de
// l'ouvrage ÷ quantité, face à la cadence prévue (heures prévues ÷ quantité).
// Rien n'est écrit dans la bibliothèque : c'est une proposition à relire
// (le report sur les chantiers se fait par reportRatiosBibliotheque).
// Pas de bilan de clôture pour un chantier repris (données d'origine non
// fiables).
//
// Les montants du chantier sont LUS dans le relevé de fin (même service).
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────
const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** Le chantier relève-t-il d'un bilan de clôture ? */
export function clotureApplicableV3(releveFin) {
  if (!releveFin) return { applicable: false, raison: "relevé pas encore disponible" };
  if (releveFin.chantier_repris === true) return { applicable: false, raison: "chantier repris : pas de bilan de clôture (données d'origine non fiables)" };
  if (!(num(releveFin.avancement) >= 100)) return { applicable: false, raison: "chantier pas encore à 100 %" };
  return { applicable: true, raison: null };
}

/**
 * @param {object} args
 * @param {object} args.releveFin  relevé journalier le plus récent (lots, montants)
 * @param {Array}  args.ouvrages   ouvrages du phasage ({ id, libelle, lot_id, quantite, unite, heures_estimees, prix_ht, bibliotheque_id, taches })
 * @param {Array}  args.pointages  pointages du chantier ({ tache_id, phase_id, heures })
 * @param {number} [args.ecartCadenceMinPct=15]  écart à partir duquel une cadence est proposée
 */
export function bilanClotureV3({ releveFin, ouvrages, pointages, ecartCadenceMinPct = 15 }) {
  const app = clotureApplicableV3(releveFin);
  if (!app.applicable) return { applicable: false, raison: app.raison };
  const heuresParTache = new Map();
  for (const p of listeSure(pointages)) {
    const id = str(p.tache_id);
    if (!id || !(num(p.heures) > 0)) continue;
    heuresParTache.set(id, (heuresParTache.get(id) || 0) + num(p.heures));
  }
  const labelsLots = Object.fromEntries(listeSure(releveFin.lots).map(l => [l.id, l.label]));
  const lignesOuvrages = listeSure(ouvrages).map(o => {
    const reel = listeSure(o.taches).reduce((s, t) => s + (heuresParTache.get(str(t.id)) || 0), 0);
    const prevues = num(o.heures_estimees);
    const quantite = num(o.quantite);
    const cadencePrevue = prevues != null && quantite > 0 ? round2(prevues / quantite) : null;
    const cadenceConstatee = reel > 0 && quantite > 0 ? round2(reel / quantite) : null;
    const ecartPct = cadencePrevue > 0 && cadenceConstatee != null ? round2((cadenceConstatee / cadencePrevue - 1) * 100) : null;
    return {
      id: str(o.id), libelle: str(o.libelle) || "Ouvrage", lot: labelsLots[str(o.lot_id)] || str(o.lot_id) || "Sans lot",
      quantite, unite: str(o.unite), prixHT: num(o.prix_ht),
      heuresPrevues: prevues, heuresReelles: round2(reel), ecartHeures: prevues != null ? round2(reel - prevues) : null,
      cadencePrevue, cadenceConstatee, ecartCadencePct: ecartPct, bibliothequeId: str(o.bibliotheque_id) || null,
    };
  }).sort((a, b) => a.lot.localeCompare(b.lot, "fr") || a.libelle.localeCompare(b.libelle, "fr"));
  const propositions = lignesOuvrages
    .filter(o => o.bibliothequeId && o.cadenceConstatee != null && o.ecartCadencePct != null && Math.abs(o.ecartCadencePct) >= ecartCadenceMinPct)
    .map(o => ({ bibliothequeId: o.bibliothequeId, libelle: o.libelle, unite: o.unite, cadencePrevue: o.cadencePrevue, cadenceProposee: o.cadenceConstatee, ecartPct: o.ecartCadencePct }));
  const v = k => num(releveFin[k]);
  return {
    applicable: true,
    totaux: {
      vendu: v("vendu_ht"), heuresPrevues: v("heures_vendues"), heuresReelles: v("heures_reelles"),
      mainOeuvre: v("mo_reel"), materiaux: v("mat_reel"), materiauxPrevus: v("mat_prev"), fraisGeneraux: v("fg"),
      margeFinale: v("marge_avancement"),
      margeFinalePct: v("vendu_ht") > 0 && v("marge_avancement") != null ? round2(v("marge_avancement") / v("vendu_ht") * 100) : null,
    },
    lots: listeSure(releveFin.lots).map(l => ({ id: l.id, label: l.id === "_orphans" ? "Sans lot" : l.label,
      heuresPrevues: num(l.heuresVendues), heuresReelles: num(l.heuresReelles), ecartHeures: num(l.ecartHeures), ecartEuros: num(l.ecartEuros) })),
    ouvrages: lignesOuvrages,
    propositions,
  };
}
