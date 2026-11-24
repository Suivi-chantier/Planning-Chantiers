// src/Renovation/bilanSemaineDonnees.js — chargement Supabase des données de
// base du Bilan d'une période : relevés journaliers (légers, puis complets
// pour les deux jours comparés), pointages, comptes rendus, journal
// d'avancement et lignes de commande de la période.
//
// Partagé par la page « Bilan de semaine » (BilanPeriode.jsx) et le bloc du
// tableau de bord « Bilan de la semaine passée » (projet
// docs/projets/organisation-par-jour.md, tâche 6) : MÊME CHIFFRE = MÊME
// SERVICE. Déplacé de BilanPeriode.jsx à l'identique (mêmes requêtes, mêmes
// colonnes) ; l'assemblage pur est dans bilanSemaineChiffresV1.mjs.
import { supabase } from "../supabase";
import { lireToutParTranches } from "./lectureParTranches";
import { COLONNES_RELEVES_ALERTES_V2 } from "./pointsAttentionDonneesV1.js";
import { ajouterJoursV3, semaineIsoV3 } from "./bilanPeriodeV3.js";
import { bornesDonneesPeriodeV1, relevesCompletsAChargerV1, fusionnerRelevesCompletsV1, commandesDePeriodeV1 } from "./bilanSemaineChiffresV1.js";

export const COLONNES_LEGERES = "chantier_id, chantier_nom, date_releve, avancement, vendu_ht, heures_vendues, heures_reelles, "
  + "production_cumulee, marge_avancement, marge_terminaison, marge_probable, budget_restant, materiaux_en_avance, "
  + "heures_sans_lot, pct_sans_lot, chantier_repris, statut_completude, cr_manquants";
// Relevés complets des deux jours comparés. mo_prev (main-d'œuvre prévue) sert
// à la marge prévue au devis (margePrevueDevisReleve) ; reste_a_faire_h à la
// cascade « du devis au probable » des fiches (cascadeMargeDevisReleve). Sans
// elles, « marge devis inconnue » partout (corrigé le 06/11/2026). Contrôle :
// scripts/verif-bilan-periode.mjs (colonnes lues par ces deux fonctions).
export const COLONNES_COMPLETES = `${COLONNES_RELEVES_ALERTES_V2}, materiaux_en_avance, materiaux_imputes, mat_reel, mat_prev, mo_prev, mo_reel, fg, reste_a_faire_h, reste_a_commander, couts_par_nature, cr_manquants`;

/** Semaines ISO couvrant [debut, fin]. */
export function semainesCouvrant(debut, fin) {
  const out = new Set();
  for (let d = debut; d <= fin; d = ajouterJoursV3(d, 1)) out.add(semaineIsoV3(d));
  return [...out];
}

/**
 * Données de base d'une période.
 * @param {object} periode  periodeSemaineV3 / periodeMoisV3 / periodeLibreV3
 * @param {{ estAnnule?: () => boolean }} [opts]
 * @returns {Promise<null | { erreur: string|null, bornes, releves, pointages, rapports, journal, commandes }>}
 *   null si le chargement a été annulé en route.
 */
export async function chargerDonneesBilanPeriode(periode, { estAnnule = () => false } = {}) {
  const avant = ajouterJoursV3(periode.debut, -21);
  const [rel, pts, rap, jou, cmd] = await Promise.all([
    lireToutParTranches((a, b) => supabase.from("chantier_releves_journaliers").select(COLONNES_LEGERES)
      .lte("date_releve", periode.fin).order("id").range(a, b)),
    lireToutParTranches((a, b) => supabase.from("pointages").select("chantier_id, date, heures, ouvrier")
      .gte("date", avant).lte("date", periode.fin).order("id").range(a, b)),
    lireToutParTranches((a, b) => supabase.from("rapports").select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, semaine")
      .in("semaine", semainesCouvrant(periode.debut, periode.fin)).order("id").range(a, b)),
    lireToutParTranches((a, b) => supabase.from("avancement_journal").select("chantier_id, tache_id, ouvrage_id, source, avancement_avant, avancement_apres, date_realisation, created_at")
      .gte("date_realisation", periode.debut).lte("date_realisation", periode.fin).order("id").range(a, b)),
    lireToutParTranches((a, b) => supabase.from("commande_lignes").select("chantier_id, commandes!inner(date_doc)")
      .gte("commandes.date_doc", periode.debut).lte("commandes.date_doc", periode.fin).order("id").range(a, b)),
  ]);
  const erreur = [rel, pts, rap, jou, cmd].map(r => r.error?.message).filter(Boolean)[0] || null;
  if (erreur) console.warn("Bilan période :", erreur);
  if (estAnnule()) return null;
  const bornes = bornesDonneesPeriodeV1(periode, pts.data || []);
  // Relevés complets (lots, avertissements) des deux jours comparés.
  const besoins = relevesCompletsAChargerV1(rel.data || [], bornes);
  const complets = (await Promise.all(besoins.map(([date, ids]) =>
    supabase.from("chantier_releves_journaliers").select(COLONNES_COMPLETES)
      .eq("date_releve", date).in("chantier_id", ids).then(r => r.data || [])))).flat();
  if (estAnnule()) return null;
  return {
    erreur, bornes, releves: fusionnerRelevesCompletsV1(rel.data || [], complets),
    pointages: pts.data || [], rapports: rap.data || [], journal: jou.data || [],
    commandes: commandesDePeriodeV1(cmd.data),
  };
}
