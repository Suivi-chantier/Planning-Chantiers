// ─────────────────────────────────────────────────────────────────────────────
// Bilans FIGÉS et RECTIFICATIONS (refonte du Bilan, étape 3.5).
//
// Chaque export est archivé (table bilans_exports) avec les chiffres affichés
// par chantier. Un bilan exporté ne change plus. Quand une donnée datée d'une
// période déjà exportée est ajoutée ou modifiée APRÈS l'export (compte rendu
// validé en retard, avancement modifié depuis le phasage, commande saisie en
// retard), le bilan suivant affiche une ligne « Rectifications » : chantier,
// période concernée, montant, cause.
//
// Le montant d'une rectification = marge de la période recalculée AUJOURD'HUI
// sur les mêmes bornes (mêmes relevés journaliers) − marge de la période
// archivée. Pour chaque période, c'est le DERNIER export qui fait foi.
//
// Prévu / réalisé : l'archive garde, par chantier, les heures prévues par le
// moteur de planning pour la semaine suivante ; le bilan de cette semaine-là
// les compare aux heures réalisées.
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────
import { releveAuPlusTardV3 } from "./bilanPeriodeV3.mjs";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const jour = v => str(v).slice(0, 10);

/** Ligne à insérer dans bilans_exports (chiffres affichés, figés). */
export function ligneArchiveV3({ periode, bornes, synthese, version, documentHtml = null, exportePar = null, prevuSemaineSuivante = {} }) {
  return {
    periode_cle: periode.cle, periode_libelle: periode.libelle, periode_debut: periode.debut, periode_fin: periode.fin,
    date_depart: bornes.dateDepart, date_fin: bornes.dateFin,
    version: version === "detaillee" ? "detaillee" : "direction",
    chantier_ids: listeSure(synthese).map(s => s.chantierId),
    chiffres: {
      chantiers: listeSure(synthese).map(s => ({
        chantierId: s.chantierId, nom: s.nom, production: s.production, margePeriode: s.margePeriode,
        heuresPeriode: s.heuresPeriode, margeAvancement: s.margeAvancement, margeProbable: s.margeProbable,
        avancement: s.avancement,
        heuresPrevuesSemaineSuivante: num(prevuSemaineSuivante[s.chantierId]),
      })),
    },
    document_html: documentHtml,
    exporte_par: exportePar,
  };
}

/** Dernier export de chaque période (celui qui fait foi). */
export function derniersExportsParPeriodeV3(archives) {
  const m = new Map();
  for (const a of listeSure(archives)) {
    const cle = str(a.periode_cle);
    if (!cle) continue;
    const prec = m.get(cle);
    if (!prec || str(a.exporte_le) > str(prec.exporte_le)) m.set(cle, a);
  }
  return [...m.values()].sort((a, b) => jour(a.periode_fin).localeCompare(jour(b.periode_fin)));
}

const CAUSES = {
  heures: "heures validées ou saisies après l'export",
  avancement: "avancement modifié après l'export",
  commande: "commande saisie après l'export",
};

/**
 * Rectifications des bilans déjà exportés dont la période est terminée avant
 * la période courante.
 * @param {object} args
 * @param {Array}  args.archives   lignes de bilans_exports
 * @param {Map}    args.releves    indexerRelevesV3(lignes) — relevés actuels
 * @param {object} args.periode    période du bilan en cours ({ debut })
 * @param {Array}  [args.pointages]  { chantier_id, date, created_at }
 * @param {Array}  [args.journal]    { chantier_id, date_realisation, created_at, source }
 * @param {Array}  [args.commandes]  { chantier_id, date, created_at }
 * @param {number} [args.seuilEuros=1]
 */
export function rectificationsV3({ archives, releves, periode, pointages = [], journal = [], commandes = [], seuilEuros = 1 }) {
  const out = [];
  for (const a of derniersExportsParPeriodeV3(archives)) {
    if (!(jour(a.periode_fin) < periode.debut)) continue;
    const depart = jour(a.date_depart), fin = jour(a.date_fin), exporte = str(a.exporte_le);
    const dans = d => d && d > depart && d <= fin;
    for (const c of listeSure(a.chiffres?.chantiers)) {
      const liste = releves?.get(str(c.chantierId)) || [];
      const rf = releveAuPlusTardV3(liste, fin), rd = releveAuPlusTardV3(liste, depart);
      const mf = num(rf?.marge_avancement), md = rd ? num(rd.marge_avancement) : 0;
      if (mf == null || md == null || c.margePeriode == null) continue;
      const margeAujourdhui = round2(mf - md);
      const montant = round2(margeAujourdhui - num(c.margePeriode));
      if (Math.abs(montant) < seuilEuros) continue;
      const tard = (lignes, champDate) => listeSure(lignes).some(l => str(l.chantier_id) === str(c.chantierId)
        && dans(jour(l[champDate])) && str(l.created_at) > exporte && !["initial", "reconstitution"].includes(str(l.source)));
      const causes = [
        tard(pointages, "date") ? CAUSES.heures : null,
        tard(journal, "date_realisation") ? CAUSES.avancement : null,
        tard(commandes, "date") ? CAUSES.commande : null,
      ].filter(Boolean);
      out.push({ chantierId: str(c.chantierId), nom: c.nom, periode: str(a.periode_libelle) || str(a.periode_cle), periodeCle: str(a.periode_cle),
        montant, margeArchivee: num(c.margePeriode), margeAujourdhui,
        cause: causes.length ? causes.join(", ") : "données recalculées après l'export" });
    }
  }
  return out;
}

/**
 * Prévu / réalisé : heures prévues par le moteur pour cette période (gardées
 * dans le dernier export de la période PRÉCÉDENTE) face aux heures réalisées.
 */
export function prevuRealiseV3({ archives, periode, synthese }) {
  const prec = derniersExportsParPeriodeV3(archives).filter(a => jour(a.periode_fin) < periode.debut).pop();
  if (!prec) return { disponible: false, raison: "aucun bilan exporté pour la période précédente : pas de prévu à comparer", lignes: [] };
  const prevus = new Map(listeSure(prec.chiffres?.chantiers).map(c => [str(c.chantierId), num(c.heuresPrevuesSemaineSuivante)]));
  const lignes = listeSure(synthese).map(s => {
    const prevu = prevus.has(s.chantierId) ? prevus.get(s.chantierId) : null;
    return { chantierId: s.chantierId, nom: s.nom, heuresPrevues: prevu, heuresRealisees: s.heuresPeriode,
      ecart: prevu != null && s.heuresPeriode != null ? round2(s.heuresPeriode - prevu) : null };
  }).filter(l => l.heuresPrevues != null || (l.heuresRealisees || 0) > 0);
  return { disponible: true, reference: str(prec.periode_libelle), lignes };
}
