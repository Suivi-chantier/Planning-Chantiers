// ─────────────────────────────────────────────────────────────────────────────
// Chiffres clés du Bilan d'une période — assemblage partagé entre la page
// « Bilan de semaine » (BilanPeriode.jsx) et le bloc du tableau de bord
// « Bilan de la semaine passée » (projet docs/projets/organisation-par-jour.md,
// tâche 6, règle 9 : aucun calcul réécrit).
//
// Ce module ne CALCULE rien de nouveau : il regroupe, à l'identique, les
// appels que la page faisait elle-même (bilanPeriodeV3, alertesMargesV2) —
// bornes de comparaison, relevés complets à relire, présélection des
// chantiers, synthèse, avertissements, bandeau — et les libellés des tuiles du
// bandeau. MÊME CHIFFRE = MÊME SERVICE : la page et le bloc appellent ces mêmes
// fonctions, sur les mêmes données (chargées par bilanSemaineDonnees.js).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// Les données arrivent en paramètre.
// ─────────────────────────────────────────────────────────────────────────────

import { estChantierActif } from "./chantierActif.mjs";
import { alertesMargesV2 } from "./alertesMargesV2.mjs";
import {
  ajouterJoursV3, semaineIsoV3, periodeSemaineV3, bornesComparaisonV3, indexerRelevesV3, releveAuPlusTardV3,
  activiteChantiersV3, preselectionChantiersV3, syntheseChantiersV3, avertissementsExportV3, bandeauV3, nbChantiersV3,
} from "./bilanPeriodeV3.mjs";

/** Chantiers jamais repris dans le Bilan. */
export const CHANTIERS_EXCLUS_BILAN_PERIODE = Object.freeze(["DÉPOT"]);

// ── Formats de l'écran du Bilan (déplacés de BilanPeriode.jsx, à l'identique)
export const fmtEurBilan = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`);
export const fmtEurSigneBilan = v => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")} €`);
export const fmtHBilan = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`);
// Pourcentage d'une part (marge / vendu) : « — » si inconnu, jamais 0 %.
export const fmtPctSurBilan = v => {
  if (v == null) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR")} %`;
};
export const fmtEurHBilan = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €/h`);
export const flecheBilan = v => (v == null || Math.abs(v) < 1 ? "=" : v < 0 ? "▼" : "▲");

/** Chantiers en cours proposés au Bilan (hors DÉPOT), triés par nom. */
export function chantiersEnCoursBilanV1(chantiers) {
  return (chantiers || [])
    .filter(c => estChantierActif(c) && !CHANTIERS_EXCLUS_BILAN_PERIODE.includes(c.nom))
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"));
}

// ── Assemblage des données chargées ─────────────────────────────────────────
/** Bornes de comparaison à partir des pointages chargés (jour travaillé = heures > 0). */
export function bornesDonneesPeriodeV1(periode, pointages) {
  const joursTravailles = (pointages || []).filter(p => Number(p.heures) > 0).map(p => p.date);
  return bornesComparaisonV3(periode, joursTravailles);
}

/**
 * Relevés complets à relire (lots, avertissements) pour les deux jours
 * comparés : [[date, [chantier_id…]], …], dans l'ordre de première rencontre.
 */
export function relevesCompletsAChargerV1(relevesLegers, bornes) {
  const idx = indexerRelevesV3(relevesLegers || []);
  const besoins = new Map();
  idx.forEach((liste, id) => {
    for (const d of [bornes.dateFin, bornes.dateDepart]) {
      const r = releveAuPlusTardV3(liste, d);
      if (!r) continue;
      const date = String(r.date_releve).slice(0, 10);
      if (!besoins.has(date)) besoins.set(date, new Set());
      besoins.get(date).add(id);
    }
  });
  return [...besoins.entries()].map(([date, ids]) => [date, [...ids]]);
}

/** Relevés légers dont ceux des jours comparés sont remplacés par leur version complète. */
export function fusionnerRelevesCompletsV1(relevesLegers, complets) {
  const cle = r => `${r.chantier_id}|${String(r.date_releve).slice(0, 10)}`;
  const parCle = new Map((complets || []).map(r => [cle(r), r]));
  return (relevesLegers || []).map(r => parCle.get(cle(r)) || r);
}

/** Lignes de commande (avec leur commande jointe) → { chantier_id, date }. */
export function commandesDePeriodeV1(lignes) {
  return (lignes || []).map(l => ({ chantier_id: l.chantier_id, date: l.commandes?.date_doc }));
}

// ── Calcul de base du Bilan d'une période (déplacé de BilanPeriode.jsx) ─────
/**
 * Activité, présélection, alertes, synthèse par chantier, avertissements et
 * bandeau — exactement la chaîne de la page.
 * @param {object} p
 * @param {object} p.periode     periodeSemaineV3 / periodeMoisV3 / periodeLibreV3
 * @param {object} p.donnees     { bornes, releves, pointages, rapports, journal, commandes }
 * @param {Array}  p.enCours     chantiersEnCoursBilanV1(chantiers)
 * @param {object} [p.choix]     cases cochées / décochées à la main ({} = présélection)
 * @param {object} [p.reglages]  useReglagesMarges() : { seuilsMarges, baremeFG }
 */
export function calculBilanPeriodeBaseV1({ periode, donnees, enCours, choix = {}, reglages = {} }) {
  const { bornes, releves, pointages, rapports, journal, commandes } = donnees;
  const activite = activiteChantiersV3({ periode, pointages, rapports, journal, commandes });
  const preselection = preselectionChantiersV3({ chantiers: enCours, activite, choix });
  const retenus = preselection.filter(p => p.coche).map(p => ({ id: p.chantierId, nom: p.nom }));
  const idx = indexerRelevesV3(releves);
  const pick = d => retenus.map(c => releveAuPlusTardV3(idx.get(c.id), d)).filter(Boolean);
  const alertes = alertesMargesV2({ snapshotsCourants: pick(bornes.dateFin), snapshotsPrecedents: pick(bornes.dateDepart), seuils: reglages?.seuilsMarges });
  const alertesParChantier = Object.fromEntries(alertes.lignes.map(l => [l.chantier_id, l.alertes.map(a => ({ ...a, motif: a.motif }))]));
  const synthese = syntheseChantiersV3({ releves: idx, chantiers: retenus, bornes, periode, alertesParChantier,
    seuilBaisse: reglages?.seuilsMarges?.alerteBaisseMargeProbableEuros ?? 500, baremeFG: reglages?.baremeFG, seuils: reglages?.seuilsMarges });
  const noms = Object.fromEntries((enCours || []).map(c => [c.id, c.nom]));
  const avertissements = avertissementsExportV3({ periode, chantierIds: retenus.map(c => c.id), rapports, relevesLignes: releves, noms });
  const bandeau = bandeauV3({ synthese, nbComptesRendusNonValides: avertissements.nbNonValides });
  return { activite, preselection, retenus, idx, alertes, synthese, avertissements, bandeau };
}

/**
 * Tuiles du bandeau du Bilan (libellé, valeur, lignes d'explication) — les
 * mêmes à l'écran de la page et dans le bloc du tableau de bord.
 * `ton` : "neutre" (couleur du texte), "signe" (rouge / vert selon `signe`),
 * "alerte" (rouge). La tuile « Comptes rendus non validés » n'existe que s'il
 * y en a.
 */
export function tuilesBandeauBilanV1(b) {
  return [
    { cle: "production", libelle: "Production de la période", valeur: fmtEurBilan(b.production), ton: "neutre", sous: [] },
    { cle: "marge_periode", libelle: "Marge de la période", valeur: fmtEurSigneBilan(b.margePeriode), ton: "signe", signe: b.margePeriode,
      sous: [`${fmtPctSurBilan(b.margePeriodePct)} de la production`] },
    { cle: "marge_probable",
      libelle: b.nbChantiersHorsComparaison > 0 ? `Marge probable (${nbChantiersV3(b.nbChantiersComparables)})` : "Marge probable, tous chantiers",
      valeur: fmtEurSigneBilan(b.margeProbableTotale), ton: "signe", signe: b.margeProbableTotale, sous: [
        `${fmtPctSurBilan(b.margeProbableTotalePct)} du vendu · devis ${fmtEurSigneBilan(b.margeDevisTotale)} (${fmtPctSurBilan(b.margeDevisTotalePct)})`,
        b.evolutionMargeProbable == null ? "évolution sur la période : —" : `${flecheBilan(b.evolutionMargeProbable)} ${fmtEurSigneBilan(b.evolutionMargeProbable)} sur la période, tous chantiers`,
        ...(b.nbChantiersHorsComparaison > 0 ? [`${b.nbChantiersHorsComparaison} chantier(s) hors total : marge devis inconnue ou sans matériaux prévus`] : [])] },
    { cle: "heures", libelle: "Heures validées", valeur: fmtHBilan(b.heuresValidees), ton: "neutre",
      sous: [`${fmtEurHBilan(b.eurParHeure)} produits · devis ${fmtEurHBilan(b.eurParHeureDevis)}`] },
    ...(b.nbComptesRendusNonValides ? [{ cle: "comptes_rendus", libelle: "Comptes rendus non validés", valeur: String(b.nbComptesRendusNonValides), ton: "alerte", sous: [] }] : []),
  ];
}

// ── Bloc « Bilan de la semaine passée » (tableau de bord du jour) ───────────
/** Semaine ISO précédant la date du jour (« AAAA-Www »), même calcul que la page. */
export function semainePasseeV1(dateIso) {
  const d = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return semaineIsoV3(ajouterJoursV3(d, -7));
}
const numeroSemaine = weekId => Number(/W(\d+)/.exec(String(weekId || ""))?.[1]) || weekId;

/**
 * État affiché par le bloc (règle 10 : une impossibilité reste visible).
 * @param {object} p
 * @param {string} p.weekId          semaine affichée (semainePasseeV1)
 * @param {boolean} [p.chargement]   données encore en chargement
 * @param {string|null} [p.erreur]   message d'erreur de chargement
 * @param {object|null} [p.base]     calculBilanPeriodeBaseV1(...)
 * @returns {{ etat: "chargement"|"erreur"|"aucune_donnee"|"releve_absent"|"ok",
 *   metrique: string, message: string|null, tuiles: Array, note: string|null, libelleSemaine: string|null }}
 */
export function etatBlocBilanSemaineV1({ weekId, chargement = false, erreur = null, base = null }) {
  const n = numeroSemaine(weekId);
  const periode = periodeSemaineV3(weekId);
  const libelleSemaine = periode ? periode.libelle : null;
  const vide = { tuiles: [], note: null, libelleSemaine };
  if (!periode) return { ...vide, etat: "erreur", metrique: "erreur", message: `Semaine illisible : ${weekId || "—"}.` };
  if (erreur) return { ...vide, etat: "erreur", metrique: "erreur",
    message: `Le bilan de la semaine ${n} n'a pas pu être chargé (${erreur}). Ouvrez la page Bilan de semaine ou rechargez.` };
  if (chargement || !base) return { ...vide, etat: "chargement", metrique: "chargement…", message: "Chargement…" };
  const synthese = base.synthese || [];
  if (synthese.length === 0) {
    return { ...vide, etat: "aucune_donnee", metrique: "aucune donnée",
      message: `Aucune donnée de bilan pour la semaine ${n} : aucun chantier en cours n'a eu d'activité (heures, comptes rendus, avancement ou commandes).` };
  }
  const tuiles = tuilesBandeauBilanV1(base.bandeau);
  const nbIndispo = synthese.filter(s => !s.disponible).length;
  if (nbIndispo === synthese.length) {
    return { ...vide, tuiles, etat: "releve_absent", metrique: "relevé à venir",
      message: `Relevé pas encore disponible pour la semaine ${n} : chiffres inconnus (${nbChantiersV3(synthese.length)} avec activité).` };
  }
  const heures = tuiles.find(t => t.cle === "heures");
  return {
    ...vide, tuiles, etat: "ok", metrique: heures.valeur, message: null,
    note: [
      `${nbChantiersV3(synthese.length)} avec activité`,
      nbIndispo > 0 ? `relevé pas encore disponible pour ${nbChantiersV3(nbIndispo)}` : null,
      base.bandeau.nbComptesRendusNonValides ? null : "aucun compte rendu non validé",
    ].filter(Boolean).join(" · "),
  };
}
