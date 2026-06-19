// src/DashboardAnalyse.jsx — Dashboard d'analyse pour la direction.
//
// Adaptation de l'ébauche HTML envoyée par le gérant
// (public/ProferoDashboard_analyse_gerant_v4.html), reproduite ici en
// composant React intégré à l'application Profero Rénovation :
//   - 6 onglets : Chantiers, Pipeline, Point financier, Primes, Analyses, Trésorerie
//   - KPIs en tête (CA total, marge réelle, alertes, ratio MO, pipeline pondéré)
//   - 3 modales : nouveau chantier, mise à jour chantier, opportunité pipeline
//
// Données : la majorité du dashboard est branchée sur Supabase.
//   - Chantiers / Primes / KPIs : 100 % réels (phasages, pointages,
//     commande_lignes, cr_comptes_rendus, chantiers).
//   - Point financier : lignes "MO Travaux" (pointages) et "Matières premières
//     directes" (factures) auto-calculées en direct par mois ; les autres
//     lignes comptables sont saisies manuellement (persistées planning_config).
//   - Trésorerie : pré-remplie depuis le réel (matériaux factures, primes
//     chantiers, CA produit = CA × avancement), puis ajustable / persistée.
//   - Pipeline : saisie manuelle persistée (pas de source prospects en base).
// Plus aucune donnée factice : les anciens seeds mockés ont été retirés.
//
// Esthétique : adaptée au thème Profero (palette sombre + accent jaune
// #FFC200, polices Barlow Condensed / DM Mono) pour s'intégrer parfaitement
// dans l'application existante. La structure marine/dorée d'origine a été
// remplacée par les variables du theme T.

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, loadPhases } from "../constants";
import { indexPointagesParTache, coutMOEff, sumLibreEtIndirect } from "../pointages";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend,
} from "recharts";

// ─── DONNÉES STATIQUES ───────────────────────────────────────────────────────
// Labels de phase utilisés pour le PhaseTrack visuel (rétro-compatibilité).
// Le mapping vers les phases réelles de l'app se fait via phasesConfig (chargées
// au mount depuis Admin → Phases).
const PHASES_FALLBACK_LABELS = ['Démolition', 'Gros œuvre', 'Électricité', 'Plomberie', 'Isolation', 'Cloisons', 'Sol', 'Peinture', 'Livraison'];

const PIPE_COLS = [
  { key: 'prospect', label: '🔵 Prospect' },
  { key: 'devis',    label: '🟡 Devis envoyé' },
  { key: 'nego',     label: '🟠 Négociation' },
  { key: 'signe',    label: '🟢 Signé' },
];

// Chantiers et archives sont désormais lus depuis Supabase (table phasages).
// Les anciens INIT_CHANTIERS / INIT_ARCHIVES (données mockées) ont été retirés
// dans PR2. Voir phasageToChantier() pour le mapping.

// Pipeline : aucune source en base pour les prospects rénovation. On démarre
// vide ; les opportunités saisies sont persistées dans planning_config
// (dashboard_pipeline). Les anciennes données factices ont été retirées.
const INIT_PIPELINE = [];

const INIT_FINANCES = {
  caObj: 0, caReal: 0, caEnc: 0, caYtd: 0, caAnn: 0,
  solde: 0, dettes: 0,
  sal: 0, loyer: 0, assur: 0, compta: 0, veh: 0, outil: 0, div: 0,
  mat: 0, st: 0, primes: 0,
};

const MONTH_PREV_LABEL = 'Mars 2026';
const MONTH_CURR_LABEL = 'Avril 2026';

// Structure du compte de résultat. Toutes les valeurs démarrent à 0 : les
// chiffres factices d'origine ont été retirés. Les lignes « MO Travaux » et
// « Matières premières directes » sont AUTO-CALCULÉES en direct depuis la base
// (pointages / factures) — voir DERIVED_CR_LABELS et SocieteFinanceTab. Les
// autres lignes sont saisies manuellement (données du comptable).
const INIT_CR_ROWS = [
  { section: 'ACTIVITÉ', label: 'Travaux', prev: 0, curr: 0 },
  { section: 'ACTIVITÉ', label: 'Avancement de chantiers', prev: 0, curr: 0 },
  { section: 'ACTIVITÉ', label: 'Variation stock travaux en cours', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Matières premières directes', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Variation de stock', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: "Achats d'études et prestations de services", prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Sous-traitance', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Sous-traitance études', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Carburant', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Locations mobilières', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Entretien matériel et outillage', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Frais de chantier repas', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Compte prorata chantiers', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Voyages et déplacements', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Personnel intérimaire', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES FIXES', label: 'MO Travaux', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES FIXES', label: 'Outillage', prev: 0, curr: 0 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Pharmacie', prev: 0, curr: 0 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Médecine du travail', prev: 0, curr: 0 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Frais généraux', prev: 0, curr: 0 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Appointements et CS "MO indirecte"', prev: 0, curr: 0 },
  { section: 'DOTATIONS', label: 'Dotations aux amortissements', prev: 0, curr: 0 },
];

// Lignes du compte de résultat alimentées automatiquement depuis la base
// (lecture seule). Clé = libellé exact de la ligne, valeur = type de données.
//   - 'mo'  : MO Travaux pointée (Σ heures × taux du registre `pointages`)
//   - 'mat' : Matières premières (Σ montant_ht des `factures` fournisseurs)
const DERIVED_CR_LABELS = { 'MO Travaux': 'mo', 'Matières premières directes': 'mat' };

// Frais généraux détaillés par compte comptable. Valeurs à 0 (saisie manuelle
// par le comptable) : les chiffres factices d'origine ont été retirés.
const INIT_FG_ROWS = [
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606630', label: 'Eau', prev: 0, curr: 0 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606100-631-632', label: 'Électricité - gaz - Air liquide', prev: 0, curr: 0 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606400', label: 'Fournitures administratives', prev: 0, curr: 0 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606300', label: 'Vêtements de travail', prev: 0, curr: 0 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606310', label: 'Déchets - ordures', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613200', label: 'Locations immobilières', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613210', label: 'Location Box', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613510', label: 'Location véhicules', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '614000', label: 'Charges locatives', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615200', label: 'Entretien local', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615500', label: 'Entretien vêtements de travail', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615532', label: 'Entretien matériel de transport', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615600', label: 'Maintenance', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615610', label: 'Abonnements logiciels', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '616100', label: 'Assurances', prev: 0, curr: 0 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '622', label: "Personnel extérieur à l'entreprise", prev: 0, curr: 0 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '622600', label: 'Honoraires', prev: 0, curr: 0 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '623400', label: 'Dons, pourboires, cadeaux', prev: 0, curr: 0 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '625700', label: 'Réceptions', prev: 0, curr: 0 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '626200', label: 'Téléphone', prev: 0, curr: 0 },
  { section: '63 - IMPÔTS ET TAXES', code: '631200', label: "Taxe d'apprentissage", prev: 0, curr: 0 },
  { section: '63 - IMPÔTS ET TAXES', code: '633300', label: 'Formation organismes', prev: 0, curr: 0 },
  { section: '63 - IMPÔTS ET TAXES', code: '635111', label: 'Cotisation foncière des entreprises', prev: 0, curr: 0 },
];

const ANALYSE_TODO_GROUPS = [
  { key: 'daily', title: 'Analyses quotidiennes', icon: '☀️', items: [
    { id: 'daily-treso',     label: 'Contrôler le solde bancaire, encaissements et décaissements du jour' },
    { id: 'daily-mo',        label: 'Vérifier la MO consommée à date sur chaque chantier actif' },
    { id: 'daily-alertes',   label: 'Traiter les alertes rouges : retard, marge, ratio MO, CR manquant' },
    { id: 'daily-priorites', label: 'Valider les 3 priorités opérationnelles du lendemain' },
  ] },
  { key: 'weekly', title: 'Analyses hebdomadaires', icon: '📅', items: [
    { id: 'weekly-marge',       label: 'Comparer marge vendue, marge réelle et seuil prime par chantier' },
    { id: 'weekly-planning',    label: 'Contrôler les dates de livraison prévisionnelles et les glissements' },
    { id: 'weekly-pipeline',    label: 'Mettre à jour le pipeline : devis, probabilité, signatures attendues' },
    { id: 'weekly-facturation', label: 'Lister les situations à facturer et les relances clients à effectuer' },
  ] },
  { key: 'monthly', title: 'Analyses mensuelles', icon: '🧭', items: [
    { id: 'monthly-point-financier', label: 'Finaliser le point financier mensuel : CA, FG, MO, matériaux, résultat' },
    { id: 'monthly-fg',              label: 'Analyser les frais généraux par compte et isoler les dérives' },
    { id: 'monthly-primes',          label: 'Arbitrer les primes chantier déclenchables selon les seuils de marge' },
    { id: 'monthly-action',          label: "Définir le plan d'action du mois suivant avec 3 décisions prioritaires" },
  ] },
];

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt = (v, d = 0) => (isNaN(v) || v == null) ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(v) + ' €';
const fmtPct = (v, d = 1) => isNaN(v) ? '—' : v.toFixed(d) + ' %';
const daysDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const dfr = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';
const todayISO = () => new Date().toISOString().slice(0, 10);
const nv = v => parseFloat(v) || 0;
const moRestanteReelle = c => nv(c.budMO) - nv(c.moC);
const moRestanteTheorique = c => Math.max(0, nv(c.budMO) * Math.max(0, (100 - nv(c.avR)) / 100));
const moPctConsomme = c => nv(c.budMO) > 0 ? (nv(c.moC) / nv(c.budMO)) * 100 : 0;
const ratioMO = c => {
  const theo = moRestanteTheorique(c);
  const reel = moRestanteReelle(c);
  if (theo <= 0) return reel >= 0 ? 1 : 0;
  return reel / theo;
};
const ratioMOStatus = c => {
  const r = ratioMO(c);
  if (r > 1.0001) return 'green';
  if (r >= 0.9999) return 'orange';
  return 'red';
};
const ratioMOLabel = c => {
  const r = ratioMO(c);
  if (r > 1.0001) return 'En avance';
  if (r >= 0.9999) return 'Dans les clous';
  return 'Surconsommation';
};
const avSt = c => { const d = c.avR - c.avP; return d >= -3 ? 'green' : d >= -10 ? 'orange' : 'red'; };
const mrSt = c => c.mr >= c.mv * 0.95 ? 'green' : c.mr >= c.seuil ? 'orange' : 'red';
const gSt = c => {
  const a = avSt(c), m = mrSt(c), r = ratioMOStatus(c);
  if (a === 'red' || m === 'red' || r === 'red') return 'red';
  if (a === 'orange' || m === 'orange' || r === 'orange') return 'orange';
  return 'green';
};
const stCol = s => s === 'green' ? '#34d188' : s === 'orange' ? '#ff9a4d' : '#ff625f';

// ─── MAPPING SUPABASE → STRUCTURE DASHBOARD ──────────────────────────────────
// phasageToChantier(phasage, chantier, tauxHoraires, phasesConfig) renvoie la
// structure attendue par les composants dashboard (avancement, MO, matériaux,
// marge, CR, etc.) calculée à partir des vraies données Supabase.
//
// Champs non-encore-modélisés dans le schéma (mv cible, prime, seuil prime) :
// valeurs par défaut sensibles, à remplacer par un stockage dédié plus tard.
const TAUX_DEFAUT = 20;

function calcAvancementReel(plan, phasesConfig) {
  const allTaches = phasesConfig.flatMap(ph => (plan?.[ph.id] || []));
  if (allTaches.length === 0) return 0;
  const totalHV = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  if (totalHV > 0) {
    return Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHV);
  }
  return Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / allTaches.length);
}

// Avancement théorique : combien du chantier devrait être fait à aujourd'hui,
// en fonction des dates_prevues des tâches. Linéaire entre 1ère et dernière date.
function calcAvancementTheorique(plan, phasesConfig) {
  const allTaches = phasesConfig.flatMap(ph => (plan?.[ph.id] || []));
  const dates = allTaches.map(t => t.date_prevue).filter(Boolean).sort();
  if (dates.length < 2) return 0;
  const debut = new Date(dates[0]).getTime();
  const fin   = new Date(dates[dates.length - 1]).getTime();
  const today = Date.now();
  if (today <= debut) return 0;
  if (today >= fin) return 100;
  return Math.round(((today - debut) / (fin - debut)) * 100);
}

// Phase courante : la plus avancée parmi les phases qui ont des tâches avec
// avancement > 0 et < 100. Si toutes sont à 100, retourne la dernière phase.
function calcPhaseCourante(plan, phasesConfig) {
  let lastWithTaches = -1;
  let firstUnfinished = -1;
  phasesConfig.forEach((ph, i) => {
    const taches = plan?.[ph.id] || [];
    if (taches.length === 0) return;
    lastWithTaches = i;
    const allDone = taches.every(t => (parseFloat(t.avancement) || 0) >= 100);
    if (!allDone && firstUnfinished === -1) firstUnfinished = i;
  });
  return firstUnfinished !== -1 ? firstUnfinished : Math.max(0, lastWithTaches);
}

function calcBudgetMO(plan, phasesConfig, tauxHoraires = {}) {
  const allTaches = phasesConfig.flatMap(ph => (plan?.[ph.id] || []));
  let sumPond = 0, sumPoids = 0;
  allTaches.forEach(t => {
    const hV = parseFloat(t.heures_vendues) || 0;
    if (hV <= 0) return;
    const pO = (t.ouvriers || [])[0] || "";
    const taux = pO ? (parseFloat(tauxHoraires?.[pO]) || TAUX_DEFAUT) : TAUX_DEFAUT;
    sumPond  += hV * taux;
    sumPoids += hV;
  });
  return sumPoids * (sumPoids > 0 ? sumPond / sumPoids : 0);
}

function calcMOConsommee(plan, phasesConfig, tauxHoraires = {}, pointagesIndexes = {}, extraStats = {}) {
  // P9 : coût MO réel dérivé du registre de pointage. Repli legacy par tâche
  // si aucun pointage. Les coûts "libres" et "indirects" (au niveau chantier)
  // sont ajoutés via extraStats.
  const allTaches = phasesConfig.flatMap(ph => (plan?.[ph.id] || []));
  const coutTaches = allTaches.reduce((s, t) => s + coutMOEff(t, pointagesIndexes, tauxHoraires), 0);
  return coutTaches + (extraStats.coutLibre || 0) + (extraStats.coutIndirect || 0);
}

function calcBudgetMat(plan, phasesConfig) {
  return phasesConfig.reduce((sTotal, ph) => {
    const mats = plan?.[ph.id + "__materiaux_prevus"] || [];
    return sTotal + mats.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
  }, 0);
}

// Matériaux consommés = coût matériel saisi sur les tâches (V1) + coût réel des
// commandes. V2 : le coût des commandes vient désormais de la table
// `commande_lignes` (somme prix_total du chantier, passée via commandeCost),
// et non plus de l'accumulateur dénormalisé plan["<phase>__cout_commandes"].
function calcMatConsomme(plan, phasesConfig, commandeCost = 0) {
  const coutMatTaches = phasesConfig.reduce((sTotal, ph) => {
    const taches = plan?.[ph.id] || [];
    return sTotal + taches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
  }, 0);
  return coutMatTaches + commandeCost;
}

function extractCompagnons(plan, phasesConfig) {
  const set = new Set();
  phasesConfig.flatMap(ph => (plan?.[ph.id] || [])).forEach(t => {
    (t.ouvriers || []).forEach(o => o && set.add(o));
  });
  return Array.from(set);
}

function premiereDate(plan, phasesConfig) {
  const dates = phasesConfig.flatMap(ph => (plan?.[ph.id] || []))
    .map(t => t.date_prevue).filter(Boolean).sort();
  return dates[0] || null;
}
function derniereDate(plan, phasesConfig) {
  const dates = phasesConfig.flatMap(ph => (plan?.[ph.id] || []))
    .map(t => t.date_prevue).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

// ── Statut CR hebdo ──────────────────────────────────────────────────────────
// Calcule la semaine ISO d'une date (YYYY-W##).
function semaineISO(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const wD = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = wD.getUTCDay() || 7;
  wD.setUTCDate(wD.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(wD.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((wD - yearStart) / 86400000) + 1) / 7);
  return { year: wD.getUTCFullYear(), week: weekNum, label: `S${weekNum}` };
}

// Calcule un statut CR pour un chantier à partir de la date du dernier CR reçu.
// - "valide"   : CR en semaine courante      → vert
// - "a_valider": CR en semaine précédente    → orange
// - "retard"   : CR > 2 semaines / aucun CR  → rouge
function calcCRStatut(lastCRDate) {
  if (!lastCRDate) return { status: 'retard', label: 'Aucun CR', date: null, semaine: null };
  const semCR  = semaineISO(lastCRDate);
  const semNow = semaineISO(new Date());
  if (!semCR || !semNow) return { status: 'retard', label: 'Date inconnue', date: lastCRDate, semaine: null };
  const dCR  = semCR.year * 53 + semCR.week;
  const dNow = semNow.year * 53 + semNow.week;
  const diff = dNow - dCR;
  if (diff <= 0) return { status: 'valide',    label: `Validé ${semCR.label}`,   date: lastCRDate, semaine: semCR.label };
  if (diff === 1) return { status: 'a_valider', label: `À valider`,               date: lastCRDate, semaine: semCR.label };
  return                  { status: 'retard',   label: `En retard (${semCR.label})`, date: lastCRDate, semaine: semCR.label };
}

// ─── Avancement V2 (depuis ouvrages) ──────────────────────────────────────
// Même pondération que la page Phasage V2 : avancement d'un ouvrage pondéré
// par heures_estimees de ses tâches ; avancement chantier pondéré par prix_ht.
function avancementOuvrageV2(o) {
  const taches = o?.taches || [];
  if (!taches.length) return 0;
  const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHE > 0) return taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0), 0) / totalHE;
  return taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length;
}
function avancementReelV2(ouvrages) {
  const list = Array.isArray(ouvrages) ? ouvrages : [];
  if (!list.length) return 0;
  const totalPrix = list.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  if (totalPrix > 0) return Math.round(list.reduce((s, o) => s + avancementOuvrageV2(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix);
  return Math.round(list.reduce((s, o) => s + avancementOuvrageV2(o), 0) / list.length);
}

function phasageToChantier(phasage, chantier, tauxHoraires, phasesConfig, lastCRByChantier = {}, pointagesParChantier = {}, commandeCostByChantier = {}) {
  const plan = phasage?.plan_travaux || {};
  const meta = plan.meta || {};
  // Avancement réel : depuis les ouvrages V2 si présents, sinon repli plan_travaux (V1).
  const avR  = (Array.isArray(phasage?.ouvrages) && phasage.ouvrages.length)
    ? avancementReelV2(phasage.ouvrages)
    : calcAvancementReel(plan, phasesConfig);
  const avP  = calcAvancementTheorique(plan, phasesConfig);
  const phase = calcPhaseCourante(plan, phasesConfig);
  const budMO = calcBudgetMO(plan, phasesConfig, tauxHoraires);
  // P9 : index local des pointages de ce chantier + extras libres/indirects
  const ptsCh   = pointagesParChantier[phasage?.chantier_id] || [];
  const ptsIdx  = indexPointagesParTache(ptsCh);
  const extras  = sumLibreEtIndirect(ptsCh);
  // MO consommée = somme de TOUS les pointages du chantier (tâche + indirect +
  // trajet), au taux figé. Robuste au schéma d'id (V2 : pointages liés aux
  // tâches d'ouvrages). Repli legacy (plan_travaux) si aucun pointage.
  const moC   = ptsCh.length > 0
    ? ptsCh.reduce((s, p) => s + (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0), 0)
    : calcMOConsommee(plan, phasesConfig, tauxHoraires, ptsIdx, extras);
  const budMat = calcBudgetMat(plan, phasesConfig);
  const commandeCost = commandeCostByChantier[phasage?.chantier_id] || 0;
  const matC   = calcMatConsomme(plan, phasesConfig, commandeCost);
  // prix_vendu stocké dans plan_travaux.meta (pas une colonne phasages).
  const ca = parseFloat(meta?.prix_vendu) || 0;
  // Marge réelle estimée : (ca - moC - matC) / ca × 100
  const margeBrute = ca - moC - matC;
  const mr = ca > 0 ? +(margeBrute / ca * 100).toFixed(1) : 0;
  // Marge vendue cible (mv), seuil prime, prime : valeurs par défaut tant qu'on
  // ne les stocke pas explicitement par chantier. Override possible via meta.
  const mv     = parseFloat(meta?.marge_vendue_cible) || 30;
  const seuil  = parseFloat(meta?.seuil_prime) || 25;
  const prime  = parseFloat(meta?.prime) || 300;
  // Dates depuis les tâches (1ère / dernière date_prevue), ou meta si fourni
  const debut         = meta?.date_demarrage || premiereDate(plan, phasesConfig);
  const livraisonInit = meta?.livraison_init || derniereDate(plan, phasesConfig);
  const livraisonPrev = meta?.livraison_prev || livraisonInit;
  // CR hebdo : lecture de la table cr_comptes_rendus (lastCRByChantier).
  // Statut calculé par semaine ISO : "Validé S{X}" / "À valider" / "En retard".
  const lastUpdated = phasage?.updated_at?.slice(0, 10) || null;
  const lastCREntry = lastCRByChantier[phasage?.chantier_id] || null;
  const lastCR     = lastCREntry?.date || null;
  const crValidateur = lastCREntry?.validateur || null;
  const crInfo = calcCRStatut(lastCR);
  const cr = crInfo.status === 'valide';
  return {
    id:           phasage?.id,
    chantierId:   phasage?.chantier_id,
    nom:          chantier?.nom || phasage?.chantier_nom || '(sans chantier)',
    couleur:      chantier?.couleur || '#FFC200',
    debut, livraisonInit, livraisonPrev,
    avR, avP, phase,
    budMO: +budMO.toFixed(0), moC: +moC.toFixed(0),
    budMat: +budMat.toFixed(0), matC: +matC.toFixed(0),
    ca: +ca.toFixed(0),
    mv, mr, prime, seuil,
    comp: extractCompagnons(plan, phasesConfig),
    cr,
    crStatus: crInfo.status,         // 'valide' | 'a_valider' | 'retard'
    crLabel:  crInfo.label,           // ex: "Validé S21" / "À valider" / "En retard (S19)"
    crDate:   crInfo.date,            // date du dernier CR ou null
    crSemaine: crInfo.semaine,        // ex: "S21" ou null
    crValidateur,                     // nom de la personne qui a validé le dernier CR (peut être null)
    note: meta?.note || '',
    lastUpdated,
  };
}

// ─── COMPOSANTS PRIMITIFS ────────────────────────────────────────────────────
const BG = {
  green:  { background: 'rgba(52,209,136,.13)', color: '#34d188', border: '1px solid rgba(52,209,136,.30)' },
  orange: { background: 'rgba(255,154,77,.13)', color: '#ff9a4d', border: '1px solid rgba(255,154,77,.30)' },
  red:    { background: 'rgba(255,98,95,.13)',  color: '#ff625f', border: '1px solid rgba(255,98,95,.30)' },
  blue:   { background: 'rgba(91,156,246,.18)', color: '#5b9cf6', border: '1px solid rgba(91,156,246,.25)' },
  gold:   { background: 'rgba(255,194,0,.13)',  color: '#FFC200', border: '1px solid rgba(255,194,0,.30)' },
  muted:  { background: 'rgba(154,165,192,.10)',color: '#9aa5c0', border: '1px solid rgba(154,165,192,.20)' },
  arch:   { background: 'rgba(52,209,136,.06)', color: '#5aaa80', border: '1px solid rgba(52,209,136,.20)' },
};

const Badge = ({ c = 'muted', children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', ...(BG[c] || BG.muted) }}>{children}</span>
);

const Dot = ({ s }) => {
  const col = stCol(s);
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0, ...(s === 'red' ? { animation: 'da-pulse .9s ease-in-out infinite' } : {}), ...(s === 'orange' ? { boxShadow: `0 0 6px ${col}` } : {}) }}/>;
};

const UpdBadge = ({ d, T }) => {
  const stylesBase = { padding: '3px 8px', borderRadius: 999, fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap', border: '1px solid' };
  if (!d) return <span style={{ ...stylesBase, ...BG.muted }}>Jamais analysé</span>;
  const days = daysDiff(d, todayISO());
  if (days <= 0) return <span style={{ ...stylesBase, ...BG.green }}>Aujourd'hui</span>;
  if (days === 1) return <span style={{ ...stylesBase, ...BG.green }}>Hier</span>;
  if (days <= 3) return <span style={{ ...stylesBase, ...BG.orange }}>Il y a {days}j</span>;
  return <span style={{ ...stylesBase, ...BG.red }}>Il y a {days}j ⚠️</span>;
};

const PhaseTrack = ({ phase, phasesLabels = PHASES_FALLBACK_LABELS, T }) => (
  <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
    {phasesLabels.map((p, i) => (
      <div key={i} title={p} style={{
        width: 10, height: 10, borderRadius: 3, flexShrink: 0,
        ...(i < phase
          ? { background: 'linear-gradient(135deg,#34d188,#1a8d59)' }
          : i === phase
            ? { background: 'linear-gradient(135deg,#FFD740,#FFC200)', animation: 'da-pulse 1.5s ease-in-out infinite' }
            : { background: 'rgba(154,165,192,.10)', border: `1px solid ${T?.border || 'rgba(255,255,255,0.08)'}` }),
      }}/>
    ))}
  </div>
);

const Btn = ({ onClick, children, color = 'ghost', sm, style: bs = {}, T, acc, disabled }) => {
  const C = {
    gold:  { background: acc?.accent || '#FFC200', color: acc?.onAccent || '#1a1a1a', border: '1px solid rgba(255,255,255,.10)' },
    ghost: { background: 'rgba(255,255,255,.03)', border: `1px solid ${T?.border || 'rgba(255,255,255,0.08)'}`, color: T?.textSub || '#9aa5c0' },
    green: { background: 'rgba(52,209,136,.10)', border: '1px solid rgba(52,209,136,.25)', color: '#34d188' },
    blue:  { background: 'rgba(91,156,246,.10)', border: '1px solid rgba(91,156,246,.25)', color: '#5b9cf6' },
    red:   { background: 'rgba(255,98,95,.10)',  border: '1px solid rgba(255,98,95,.25)',  color: '#ff625f' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: sm ? '6px 10px' : '8px 15px', borderRadius: 999,
      fontSize: sm ? 10 : 11, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '.02em', opacity: disabled ? .5 : 1,
      ...(C[color] || C.ghost), ...bs,
    }}>{children}</button>
  );
};

const Card = ({ children, style: cs = {}, T }) => (
  <div style={{
    background: T?.surface || '#262a32',
    border: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
    borderRadius: RADIUS.lg, overflow: 'hidden', ...cs,
  }}>{children}</div>
);

const CardHdr = ({ title, right, T, acc }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '13px 18px',
    borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
    background: 'rgba(255,194,0,0.05)',
  }}>
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: acc?.accent || '#FFC200', display: 'flex', alignItems: 'center', gap: 8 }}>{title}</div>
    {right}
  </div>
);

const FSec = ({ children, T, acc }) => (
  <div style={{
    background: 'rgba(255,194,0,0.07)',
    padding: '9px 16px',
    borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
    fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', color: acc?.accent || '#FFC200',
  }}>{children}</div>
);

const FRow = ({ label, note, children, T }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}` }}>
    <div>
      <div style={{ fontSize: 12, color: T?.textSub || '#9aa5c0' }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a', marginTop: 2 }}>{note}</div>}
    </div>
    <div>{children}</div>
  </div>
);

const FCalc = ({ v, color }) => (
  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 700, ...(color ? { color } : {}) }}>{v}</span>
);

const FG = ({ label, children, T }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: T?.textMuted || '#5b6a8a' }}>{label}</div>
    {children}
  </div>
);
const FR2 = ({ children }) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
const MSec = ({ children, T }) => (
  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: T?.textMuted || '#5b6a8a', margin: '14px 0 8px', paddingBottom: 6, borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}` }}>{children}</div>
);

const inpCls = (T) => ({
  fontFamily: "'DM Mono',monospace", fontSize: 13,
  background: 'rgba(255,255,255,0.04)', border: `1px solid ${T?.border || 'rgba(255,255,255,0.10)'}`,
  borderRadius: 10, padding: '9px 12px', color: T?.text || '#f0f0f0',
  outline: 'none', width: '100%', boxSizing: 'border-box',
});
const edtCls = (T) => ({
  fontFamily: "'DM Mono',monospace", fontSize: 13,
  background: 'rgba(255,255,255,0.025)', border: 'none',
  borderBottom: `1px dashed ${T?.border || 'rgba(255,255,255,0.20)'}`,
  color: T?.text || '#f0f0f0', textAlign: 'right',
  outline: 'none', padding: '3px 7px', minWidth: 68, borderRadius: '6px 6px 0 0',
});

// Modal réutilisable
function Modal({ open, onClose, title, children, footer, T, acc }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1000, alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || T?.surface || '#262a32',
        border: `1px solid ${T?.border || 'rgba(255,255,255,0.10)'}`,
        borderRadius: RADIUS.xl, padding: 26, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 28px 70px rgba(0,0,0,.65)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: acc?.accent || '#FFC200', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>{title}</div>
        {children}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}` }}>{footer}</div>
      </div>
    </div>
  );
}

const ENum = ({ v, onChange, ph = '0', T, style: es = {} }) => (
  <input type="number" value={v || ''} onChange={e => onChange(nv(e.target.value))} placeholder={ph} style={{ ...edtCls(T), ...es }}/>
);

// ─── MODALE PIPELINE ─────────────────────────────────────────────────────────
// Note PR2 : les modales "Nouveau chantier" et "Mise à jour chantier" ont été
// retirées du dashboard. Les chantiers sont désormais lus en lecture seule
// depuis Supabase (table phasages). Pour modifier un chantier, l'utilisateur
// doit passer par la fiche chantier de l'application (page Chantiers).
function PipelineModal({ open, item, onClose, onSave, onDelete, T, acc }) {
  const blank = { nom: '', ca: 0, proba: 50, statut: 'prospect', date: '', note: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { setF(item ? { ...item } : { ...blank }); }, [item, open]);
  const u = k => v => setF(p => ({ ...p, [k]: v }));
  const isNew = !item;
  return (
    <Modal open={open} onClose={onClose} T={T} acc={acc} title={isNew ? '🔖 Nouvelle Opportunité' : `📝 ${f.nom}`} footer={
      <>
        <Btn onClick={onClose} color="ghost" T={T} acc={acc}>Annuler</Btn>
        {!isNew && (
          <Btn onClick={() => { if (window.confirm(`Supprimer l'opportunité "${f.nom}" ?`)) onDelete?.(item.id); }} color="red" T={T} acc={acc}>🗑 Supprimer</Btn>
        )}
        <Btn onClick={() => onSave(f)} color="gold" T={T} acc={acc}>💾 Enregistrer</Btn>
      </>
    }>
      <FG label="Client / Projet" T={T}><input type="text" value={f.nom} onChange={e => u('nom')(e.target.value)} placeholder="M. Dupont — Division T4 en 3 lots" style={inpCls(T)}/></FG>
      <FR2>
        <FG label="CA estimé (€)" T={T}><input type="number" value={f.ca || ''} onChange={e => u('ca')(nv(e.target.value))} placeholder="80000" style={inpCls(T)}/></FG>
        <FG label="Probabilité (%)" T={T}><input type="number" value={f.proba || ''} onChange={e => u('proba')(nv(e.target.value))} min="0" max="100" placeholder="70" style={inpCls(T)}/></FG>
      </FR2>
      <FR2>
        <FG label="Statut" T={T}>
          <select value={f.statut} onChange={e => u('statut')(e.target.value)} style={{ ...inpCls(T), cursor: 'pointer' }}>
            {PIPE_COLS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </FG>
        <FG label="Date décision estimée" T={T}><input type="date" value={f.date || ''} onChange={e => u('date')(e.target.value)} style={inpCls(T)}/></FG>
      </FR2>
      <FG label="Note commerciale" T={T}><input type="text" value={f.note || ''} onChange={e => u('note')(e.target.value)} placeholder="Ex : Démarrage souhaité en septembre" style={inpCls(T)}/></FG>
    </Modal>
  );
}

// ─── ONGLET CHANTIERS ────────────────────────────────────────────────────────
function ChantiersTab({ chantiers, archives, onRestore, onOpenChantier, loading = false, phasesLabels = PHASES_FALLBACK_LABELS, T, acc }) {
  const [archOpen, setArchOpen] = useState(false);
  const alerts = chantiers.filter(c => gSt(c) !== 'green');
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: T?.textMuted || '#5b6a8a' }}>Chargement des chantiers…</div>;
  }
  if (chantiers.length === 0) {
    return (
      <Card T={T}>
        <div style={{ padding: 40, textAlign: 'center', color: T?.textMuted || '#5b6a8a' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T?.text || '#f0f0f0', marginBottom: 6 }}>Aucun chantier actif</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 420, margin: '0 auto' }}>
            Crée un chantier depuis l'onglet « Chantiers » de l'application — il apparaîtra automatiquement ici dès qu'un phasage lui sera associé.
          </div>
        </div>
      </Card>
    );
  }
  return (
    <div>
      {alerts.length > 0 && (
        <div style={{ background: 'rgba(255,98,95,0.10)', border: '1px solid rgba(255,98,95,0.30)', borderRadius: RADIUS.md, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#ff625f', marginBottom: 8 }}>⚠️ Points d'attention immédiats</div>
          {alerts.map(c => {
            const r2 = [];
            if (avSt(c) !== 'green') r2.push(`avancement ${c.avR - c.avP}pts`);
            if (mrSt(c) !== 'green') r2.push(`marge ${fmtPct(c.mr)}`);
            if (ratioMOStatus(c) !== 'green') r2.push(`ratio MO ${ratioMO(c).toFixed(2)} — ${ratioMOLabel(c)}`);
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T?.textSub || '#9aa5c0', padding: '3px 0' }}>
                <Dot s={gSt(c)}/>
                <strong style={{ color: T?.text || '#f0f0f0' }}>{c.nom}</strong> — {r2.join(' · ')}
              </div>
            );
          })}
        </div>
      )}

      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📋 Chantiers actifs" right={<span style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>● OK  ● Attention  ● Alerte</span>}/>
        <div style={{ overflowX: 'auto' }}>
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ width: 10 }}></th>
                <th>Chantier</th>
                <th>Avancement &amp; Phases</th>
                <th title="MO consommée à date / Budget MO total">MO chantier</th>
                <th title="(Budget MO total — MO consommée à date) ÷ MO restante théorique selon avancement">Ratio MO ⓘ</th>
                <th>Matériaux</th>
                <th>Marge réelle</th>
                <th>Prime chantier</th>
                <th>Livraison</th>
                <th>CR</th>
                <th>Dernière analyse</th>
              </tr>
            </thead>
            <tbody>
              {chantiers.map(c => {
                const r = ratioMO(c), gs = gSt(c), avD = c.avR - c.avP;
                const avColor = avSt(c) === 'green' ? '#34d188' : avSt(c) === 'orange' ? '#ff9a4d' : '#ff625f';
                const mrColor = mrSt(c) === 'green' ? '#34d188' : mrSt(c) === 'orange' ? '#ff9a4d' : '#ff625f';
                const moTheo = c.budMO * (c.avR / 100);
                const moEcart = c.moC - moTheo;
                const moPct = moPctConsomme(c);
                const moRest = moRestanteReelle(c);
                const moRestTheo = moRestanteTheorique(c);
                const primeOK = c.mr >= c.seuil;
                const matTheo = c.budMat * (c.avR / 100);
                const matE = matTheo > 0 ? (c.matC - matTheo) / c.budMat * 100 : 0;
                const retardJ = daysDiff(c.livraisonInit, c.livraisonPrev);
                const ratioC = ratioMOStatus(c);
                const ratioIcon = ratioC === 'green' ? '✅' : ratioC === 'orange' ? '⚠️' : '🔴';
                return (
                  <tr key={c.id}
                    onClick={() => onOpenChantier?.(c.chantierId)}
                    title="Cliquer pour ouvrir la fiche chantier"
                    style={{ cursor: onOpenChantier ? 'pointer' : 'default' }}
                  >
                    <td><Dot s={gs}/></td>
                    <td>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T?.text || '#f0f0f0', marginBottom: 2 }}>{c.nom}</div>
                      <div style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>
                        CA : {fmt(c.ca)} · Début : {dfr(c.debut)}
                        {c.note && <em style={{ color: '#ff9a4d' }}> · {c.note}</em>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, position: 'relative', minWidth: 70 }}>
                          <div style={{ height: '100%', width: `${c.avR}%`, background: avColor, borderRadius: 3, transition: 'width .4s' }}/>
                          <div style={{ position: 'absolute', top: -3, left: `${Math.min(c.avP, 100)}%`, width: 2, height: 11, background: T?.textMuted || '#5b6a8a', borderRadius: 1 }}/>
                        </div>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: avColor, minWidth: 30 }}>{c.avR}%</span>
                      </div>
                      <PhaseTrack phase={c.phase || 0} phasesLabels={phasesLabels} T={T}/>
                      <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 3 }}>
                        Phase : {phasesLabels[c.phase] || '—'} <span style={{ color: avColor }}>({avD >= 0 ? '+' : ''}{avD}pts)</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: T?.text || '#f0f0f0', fontWeight: 700 }}>{fmt(c.moC)} / {fmt(c.budMO)}</div>
                      <div style={{ fontSize: 9, color: moPct <= c.avR + 5 ? '#34d188' : '#ff9a4d', marginTop: 2 }}>{moPct.toFixed(1)}% consommé</div>
                      <div style={{ fontSize: 9, color: T?.textSub || '#9aa5c0' }}>MO théorique : {fmt(moTheo)}</div>
                      <div style={{ fontSize: 9, color: moEcart <= 0 ? '#34d188' : '#ff9a4d' }}>Écart : {moEcart > 0 ? '+' : ''}{fmt(moEcart)}</div>
                    </td>
                    <td>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, color: stCol(ratioC), fontWeight: 800 }}>{ratioIcon} {r.toFixed(2)}</div>
                      <Badge c={ratioC}>{ratioMOLabel(c)}</Badge>
                      <div style={{ fontSize: 9, color: T?.textSub || '#9aa5c0', marginTop: 4 }}>Reste réel : {fmt(moRest)}</div>
                      <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a' }}>Reste théorique : {fmt(moRestTheo)}</div>
                    </td>
                    <td>
                      {/* Jauge matériaux : barre de progression colorée selon le % consommé du budget */}
                      {(() => {
                        const pctMat = c.budMat > 0 ? (c.matC / c.budMat) * 100 : 0;
                        const matColor = pctMat > 100 ? '#ff625f' : pctMat >= 80 ? '#ff9a4d' : '#34d188';
                        const reste = Math.max(0, c.budMat - c.matC);
                        const depasse = c.matC - c.budMat;
                        return (
                          <div style={{ minWidth: 130 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: matColor, fontWeight: 700 }}>{pctMat.toFixed(0)}%</span>
                              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>{fmt(c.matC)} / {fmt(c.budMat)}</span>
                            </div>
                            <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', width: `${Math.min(100, pctMat)}%`,
                                background: matColor, borderRadius: 3, transition: 'width .4s',
                              }}/>
                              {pctMat > 100 && (
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,98,95,.35) 4px, rgba(255,98,95,.35) 8px)' }}/>
                              )}
                            </div>
                            <div style={{ fontSize: 9, color: pctMat > 100 ? '#ff625f' : T?.textMuted || '#5b6a8a', marginTop: 3, fontWeight: pctMat > 100 ? 700 : 400 }}>
                              {pctMat > 100
                                ? <>Dépassement : <span style={{ fontFamily: "'DM Mono',monospace" }}>+{fmt(depasse)}</span></>
                                : <>Reste : <span style={{ fontFamily: "'DM Mono',monospace" }}>{fmt(reste)}</span></>}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 600, color: mrColor }}>{fmtPct(c.mr)}</div>
                      <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a' }}>vendu {fmtPct(c.mv)}</div>
                    </td>
                    <td>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: acc?.accent || '#FFC200', fontWeight: 700 }}>{fmt(c.prime)}</div>
                      <div style={{ fontSize: 9, color: T?.textSub || '#9aa5c0', marginTop: 2 }}>Seuil : {fmtPct(c.seuil)}</div>
                      <Badge c={primeOK ? 'green' : 'orange'}>{primeOK ? '✅ Déclenchable' : '⚠️ Non acquise'}</Badge>
                    </td>
                    <td>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: T?.text || '#f0f0f0' }}>{dfr(c.livraisonPrev)}</div>
                      <div style={{ fontSize: 9, color: retardJ > 5 ? '#ff9a4d' : '#34d188' }}>{retardJ > 5 ? `+${retardJ}j glissement` : 'Dans les délais'}</div>
                    </td>
                    <td>
                      {(() => {
                        const crColor = c.crStatus === 'valide' ? 'green' : c.crStatus === 'a_valider' ? 'orange' : 'red';
                        const crIcon  = c.crStatus === 'valide' ? '✅' : c.crStatus === 'a_valider' ? '⏳' : '🔴';
                        return (
                          <div>
                            <Badge c={crColor}>{crIcon} {c.crLabel}</Badge>
                            {c.crDate && (
                              <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 3 }}>
                                Dernier : {dfr(c.crDate)}
                              </div>
                            )}
                            {c.crValidateur && (
                              <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 1, fontStyle: 'italic' }}>
                                Par : {c.crValidateur}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td><UpdBadge d={c.lastUpdated} T={T}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div onClick={() => setArchOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ flex: 1, height: 1, background: T?.border || 'rgba(255,255,255,0.07)' }}/>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: T?.textMuted || '#5b6a8a', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            {archOpen ? '▼' : '▶'} 📦 Chantiers archivés ({archives.length})
          </div>
          <div style={{ flex: 1, height: 1, background: T?.border || 'rgba(255,255,255,0.07)' }}/>
        </div>

        {archOpen && (
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th></th><th>Chantier</th><th>Archivé le</th><th>CA</th><th>Marge finale</th><th>Durée</th><th></th>
              </tr>
            </thead>
            <tbody>
              {archives.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: T?.textMuted || '#5b6a8a' }}>Aucun chantier archivé</td></tr>}
              {archives.map(a => {
                const duree = a.debut && a.livraisonPrev ? daysDiff(a.debut, a.livraisonPrev) : null;
                const ecart = a.livraisonInit && a.livraisonPrev ? daysDiff(a.livraisonInit, a.livraisonPrev) : 0;
                return (
                  <tr key={a.id} style={{ opacity: .68 }}>
                    <td><Badge c="arch">📦 Archivé</Badge></td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: T?.textSub || '#9aa5c0' }}>{a.nom}</td>
                    <td><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{dfr(a.archivedAt)}</span></td>
                    <td><span style={{ fontFamily: "'DM Mono',monospace" }}>{fmt(a.ca)}</span></td>
                    <td><span style={{ fontFamily: "'DM Mono',monospace", color: a.mr >= a.mv * 0.95 ? '#34d188' : a.mr >= a.seuil ? '#ff9a4d' : '#ff625f' }}>{fmtPct(a.mr)}</span></td>
                    <td style={{ fontSize: 11, color: T?.textSub || '#9aa5c0' }}>{duree ? `${duree}j` : ''} <span style={{ color: ecart > 0 ? '#ff9a4d' : '#34d188' }}>{ecart > 0 ? `(+${ecart}j)` : '(à temps)'}</span></td>
                    <td><Btn onClick={() => onRestore(a.id)} sm color="blue" T={T} acc={acc}>↩ Restaurer</Btn></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={{ padding: '7px 16px', borderTop: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, fontSize: 10, color: T?.textMuted || '#5b6a8a', textAlign: 'right' }}>
          Rechargé le {new Date().toLocaleString('fr-FR')}
        </div>
      </Card>
    </div>
  );
}

// ─── ONGLET PIPELINE ─────────────────────────────────────────────────────────
function PipelineTab({ pipeline, onAdd, onEdit, T, acc }) {
  const prospCA = pipeline.filter(p => ['prospect', 'devis'].includes(p.statut)).reduce((s, p) => s + p.ca, 0);
  const negoCA  = pipeline.filter(p => p.statut === 'nego').reduce((s, p) => s + p.ca, 0);
  const signeCA = pipeline.filter(p => p.statut === 'signe').reduce((s, p) => s + p.ca, 0);
  const totPondere = pipeline.reduce((s, p) => s + p.ca * (p.proba / 100), 0);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 14, marginBottom: 14 }}>
        {[
          { label: '🔵 Prospects & Devis',     v: prospCA, c: '#5b9cf6' },
          { label: '🟠 En négociation',         v: negoCA,  c: '#ff9a4d' },
          { label: '🟢 Signés non démarrés',    v: signeCA, c: '#34d188' },
        ].map(({ label, v, c }) => (
          <Card key={label} T={T} style={{ borderColor: c + '55' }}>
            <CardHdr T={T} acc={acc} title={<span style={{ color: c }}>{label}</span>}/>
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 28, color: c, fontWeight: 700 }}>{fmt(v)}</div>
              <div style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a', marginTop: 4 }}>CA potentiel</div>
            </div>
          </Card>
        ))}
      </div>
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="🔖 Pipeline Commercial" right={<Btn onClick={onAdd} color="gold" sm T={T} acc={acc}>＋ Opportunité</Btn>}/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12, padding: 14 }}>
          {PIPE_COLS.map(col => {
            const items = pipeline.filter(p => p.statut === col.key);
            return (
              <div key={col.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: T?.textMuted || '#5b6a8a', marginBottom: 8 }}>
                  <span>{col.label}</span><span style={{ fontFamily: "'DM Mono',monospace" }}>{items.length}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: RADIUS.md, padding: 10, minHeight: 100 }}>
                  {items.length === 0 && <div style={{ textAlign: 'center', color: T?.textMuted || '#5b6a8a', fontSize: 12, padding: '8px 0' }}>—</div>}
                  {items.map(p => (
                    <div key={p.id} onClick={() => onEdit(p)} style={{
                      background: T?.surface || '#262a32', border: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
                      borderRadius: RADIUS.md, padding: '11px 12px', marginBottom: 8, cursor: 'pointer', transition: 'all .15s',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T?.text || '#f0f0f0', marginBottom: 3 }}>{p.nom}</div>
                      <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>{p.note}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: acc?.accent || '#FFC200', marginTop: 4 }}>{fmt(p.ca)}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>Probabilité</span>
                        <Badge c={p.proba >= 70 ? 'green' : p.proba >= 40 ? 'orange' : 'muted'}>{p.proba}%</Badge>
                      </div>
                      {p.date && <div style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a', marginTop: 4 }}>Décision : {dfr(p.date)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, background: 'rgba(255,194,0,0.04)' }}>
          <div style={{ fontSize: 11, color: T?.textSub || '#9aa5c0' }}>CA pipeline total pondéré (probabilités)</div>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: acc?.accent || '#FFC200' }}>{fmt(totPondere)}</span>
        </div>
      </Card>
    </div>
  );
}

// ─── ONGLET PRIMES ───────────────────────────────────────────────────────────
function PrimesTab({ chantiers, T, acc }) {
  const total = chantiers.filter(c => c.mr >= c.seuil).reduce((s, c) => s + c.prime, 0);
  return (
    <Card T={T}>
      <CardHdr T={T} acc={acc} title="🎯 Primes par chantier" right={<span style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>Lecture : prime déclenchable selon marge finale</span>}/>
      <div style={{ overflowX: 'auto' }}>
        <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Chantier</th><th>Marge vendue</th><th>Marge réelle</th><th>Seuil prime</th><th>Prime chantier</th><th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {chantiers.map(c => {
              const atteint = c.mr >= c.seuil, bonus = c.mr >= c.mv;
              const mrColor = mrSt(c) === 'green' ? '#34d188' : mrSt(c) === 'orange' ? '#ff9a4d' : '#ff625f';
              return (
                <tr key={c.id}>
                  <td style={{ fontSize: 12, fontWeight: 600, color: T?.text || '#f0f0f0' }}>{c.nom}</td>
                  <td><span style={{ fontFamily: "'DM Mono',monospace" }}>{fmtPct(c.mv)}</span></td>
                  <td><span style={{ fontFamily: "'DM Mono',monospace", color: mrColor, fontWeight: 600 }}>{fmtPct(c.mr)}</span></td>
                  <td><span style={{ fontFamily: "'DM Mono',monospace" }}>{fmtPct(c.seuil)}</span></td>
                  <td><span style={{ fontFamily: "'DM Mono',monospace", color: atteint ? '#34d188' : (acc?.accent || '#FFC200'), fontWeight: 600 }}>{fmt(c.prime)}</span></td>
                  <td><Badge c={atteint ? 'green' : 'orange'}>{atteint ? (bonus ? '✅ Prime + Bonus' : '✅ Prime atteinte') : '⚠️ Sous le seuil'}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, background: 'rgba(255,194,0,0.04)' }}>
        <div style={{ fontSize: 11, color: T?.textSub || '#9aa5c0' }}>Total primes chantier si objectifs atteints</div>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: acc?.accent || '#FFC200' }}>{fmt(total)}</span>
      </div>
    </Card>
  );
}

// ─── BULLE FLOTTANTE "ANALYSES" (FAB + DRAWER) ───────────────────────────────
// Accessible depuis tous les onglets du dashboard. Remplace l'ancien onglet
// "Analyses". Persistance par période : un sticker quotidien expire le
// lendemain, un hebdo à la semaine suivante (ISO), un mensuel au mois suivant.
function periodKeys() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  // ISO week number
  const wD = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = wD.getUTCDay() || 7;
  wD.setUTCDate(wD.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(wD.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((wD - yearStart) / 86400000) + 1) / 7);
  const week = `${wD.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { daily: day, weekly: week, monthly: month };
}

function AnalysesBulle({ T, acc }) {
  const [open, setOpen] = useState(false);
  const periods = useMemo(periodKeys, []);
  const storageKey = 'profero-dashboard-analyse-stickers-v2';
  const positionKey = 'profero-dashboard-analyse-fab-pos';
  const [done, setDone] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); }
    catch (_e) { return {}; }
  });
  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(done)); } catch (_e) {} }, [done]);

  // ── Bulle déplaçable : position en bas-droite par défaut, persistée en localStorage.
  //    Coordonnées stockées en (right, bottom) — pratique pour les écrans qui changent de taille.
  const [pos, setPos] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(positionKey) || 'null');
      if (stored && typeof stored.right === 'number' && typeof stored.bottom === 'number') return stored;
    } catch (_e) {}
    return { right: 24, bottom: 24 };
  });
  const dragState = React.useRef({ dragging: false, moved: false, startX: 0, startY: 0, startPos: null });

  const onPointerDown = (e) => {
    // Évite le drag si on clique sur le badge interne (chiffres)
    dragState.current = {
      dragging: true,
      moved: false,
      startX: e.clientX, startY: e.clientY,
      startPos: { ...pos },
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (!dragState.current.moved && Math.hypot(dx, dy) > 4) dragState.current.moved = true;
    if (!dragState.current.moved) return;
    const right  = Math.max(8, dragState.current.startPos.right  - dx);
    const bottom = Math.max(8, dragState.current.startPos.bottom - dy);
    setPos({ right, bottom });
  };
  const onPointerUp = (e) => {
    const wasMoved = dragState.current.moved;
    dragState.current.dragging = false;
    if (wasMoved) {
      try { window.localStorage.setItem(positionKey, JSON.stringify(pos)); } catch (_e) {}
    } else {
      // Pas de drag → c'était un clic, on ouvre
      setOpen(true);
    }
    dragState.current.moved = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const periodOf = (groupKey) => periods[groupKey] || periods.daily;
  const itemKey = (groupKey, itemId) => `${periodOf(groupKey)}::${itemId}`;
  const isDone = (groupKey, itemId) => !!done[itemKey(groupKey, itemId)];
  const toggle = (groupKey, itemId) => {
    const k = itemKey(groupKey, itemId);
    setDone(p => ({ ...p, [k]: !p[k] }));
  };

  const totalAll = ANALYSE_TODO_GROUPS.reduce((s, g) => s + g.items.length, 0);
  const doneAll  = ANALYSE_TODO_GROUPS.reduce((s, g) => s + g.items.filter(i => isDone(g.key, i.id)).length, 0);
  const allDone  = doneAll === totalAll;

  return (
    <>
      {/* FAB déplaçable — position persistée en localStorage */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Ouvrir les analyses (déplaçable)"
        title="Glisse pour déplacer · Clique pour ouvrir"
        style={{
          position: 'fixed', bottom: pos.bottom, right: pos.right, zIndex: 900,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 18px', borderRadius: 999,
          background: acc?.accent || '#FFC200', color: acc?.onAccent || '#1a1a1a',
          border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 800,
          boxShadow: '0 14px 32px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,194,0,0.15)',
          cursor: 'grab', userSelect: 'none', touchAction: 'none',
          transition: 'box-shadow .15s',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1, pointerEvents: 'none' }}>✅</span>
        <span style={{ pointerEvents: 'none' }}>Analyses</span>
        <span style={{
          fontSize: 11, fontWeight: 800, pointerEvents: 'none',
          background: allDone ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)',
          color: allDone ? '#1a1a1a' : '#1a1a1a',
          padding: '2px 8px', borderRadius: 999,
        }}>{doneAll}/{totalAll}</span>
      </button>

      {/* Drawer latéral droit */}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          zIndex: 950, display: 'flex', justifyContent: 'flex-end',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 460, height: '100%',
            background: T?.surface || '#262a32',
            borderLeft: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-20px 0 60px rgba(0,0,0,0.45)',
            animation: 'da-slide-in .22s ease-out',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: (acc?.accent || '#FFC200') + '22', color: acc?.accent || '#FFC200',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>✅</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T?.text || '#f0f0f0', letterSpacing: -0.2 }}>Todo des analyses</div>
                <div style={{ fontSize: 11, color: T?.textMuted || '#5b6a8a', marginTop: 2 }}>{doneAll}/{totalAll} stickés · les coches expirent à la période suivante</div>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T?.textMuted || '#5b6a8a', padding: 6, display: 'flex', fontSize: 22, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Contenu (scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {ANALYSE_TODO_GROUPS.map(group => {
                const groupDone = group.items.filter(i => isDone(group.key, i.id)).length;
                const periodLabel = group.key === 'daily' ? periods.daily
                                  : group.key === 'weekly' ? `Semaine ${periods.weekly}`
                                  : `Mois ${periods.monthly}`;
                return (
                  <div key={group.key} style={{
                    border: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
                    borderRadius: RADIUS.lg, background: 'rgba(255,255,255,0.02)', overflow: 'hidden',
                  }}>
                    <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 800, color: acc?.accent || '#FFC200', fontSize: 12 }}>{group.icon} {group.title}</div>
                        <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 2, fontFamily: "'DM Mono',monospace", letterSpacing: .3 }}>{periodLabel}</div>
                      </div>
                      <Badge c={groupDone === group.items.length ? 'green' : groupDone > 0 ? 'orange' : 'muted'}>{groupDone}/{group.items.length}</Badge>
                    </div>
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {group.items.map(item => {
                        const d = isDone(group.key, item.id);
                        return (
                          <button key={item.id} onClick={() => toggle(group.key, item.id)} style={{
                            cursor: 'pointer', textAlign: 'left',
                            border: `1px solid ${d ? 'rgba(52,209,136,.40)' : (T?.border || 'rgba(255,255,255,0.07)')}`,
                            borderRadius: RADIUS.md, padding: '10px 11px',
                            background: d ? 'rgba(52,209,136,.10)' : 'rgba(255,255,255,.025)',
                            color: d ? (T?.text || '#f0f0f0') : (T?.textSub || '#9aa5c0'),
                            display: 'flex', alignItems: 'flex-start', gap: 9, transition: 'all .15s', fontFamily: 'inherit',
                          }}>
                            <span style={{ fontSize: 15, lineHeight: 1.1 }}>{d ? '✅' : '⬜'}</span>
                            <span style={{ flex: 1, fontSize: 11, lineHeight: 1.35 }}>{item.label}</span>
                            <span style={{ fontSize: 9, fontWeight: 800, color: d ? '#34d188' : (T?.textMuted || '#5b6a8a'), whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{d ? 'Stické' : 'À faire'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: T?.textMuted || '#5b6a8a', lineHeight: 1.5, fontStyle: 'italic', padding: '0 4px' }}>
                Les coches sont mémorisées dans le navigateur. Une analyse cochée aujourd'hui restera marquée jusqu'à la fin de sa période (jour / semaine / mois) puis sera remise à zéro automatiquement.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── ONGLET TRÉSORERIE ───────────────────────────────────────────────────────
function FinancesTab({ fin, setFin, T, acc }) {
  const u = k => v => setFin(p => ({ ...p, [k]: v }));
  const totFix = fin.sal + fin.loyer + fin.assur + fin.compta + fin.veh + fin.outil + fin.div;
  const totVar = fin.mat + fin.st + fin.primes;
  const totC = totFix + totVar;
  const res = fin.caReal - totC;
  const enc = fin.caReal - fin.caEnc;
  const trsoN = fin.solde - fin.dettes;
  const jours = totC > 0 ? Math.round(trsoN / (totC / 30)) : 0;
  const pct = fin.caObj > 0 ? Math.min((fin.caReal / fin.caObj) * 100, 100) : 0;
  const tauxRes = fin.caReal > 0 ? (res / fin.caReal) * 100 : 0;
  const resColor = res >= 0 ? '#34d188' : '#ff625f';
  const trColor = trsoN > totC ? '#34d188' : trsoN > 0 ? '#ff9a4d' : '#ff625f';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', marginBottom: 14, borderRadius: RADIUS.md, background: 'rgba(52,209,136,.08)', border: '1px solid rgba(52,209,136,.25)', fontSize: 11, lineHeight: 1.5, color: T?.textSub || '#9aa5c0' }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>🟢</span>
        <span><strong style={{ color: '#34d188' }}>Pré-rempli depuis les données réelles</strong> : « CA réalisé » (production = CA chantiers × avancement), « Achats matériaux » (factures du mois) et « Primes » (chantiers déclenchables). Ce sont des estimations de départ — ajuste-les librement, tes saisies sont conservées. Le solde bancaire et les dettes restent à saisir manuellement.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 14, marginBottom: 14 }}>
        <Card T={T} style={{ borderColor: (acc?.accent || '#FFC200') + '55' }}>
          <CardHdr T={T} acc={acc} title={<span style={{ color: acc?.accent || '#FFC200' }}>💰 CA Mensuel</span>}/>
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 30, color: acc?.accent || '#FFC200', fontWeight: 700 }}>{fmt(fin.caReal)}</div>
            <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', marginTop: 4 }}>réalisé ce mois</div>
            <div style={{ margin: '10px 0 2px', height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: pct >= 100 ? '#34d188' : pct >= 70 ? (acc?.accent || '#FFC200') : '#ff9a4d', transition: 'width .4s' }}/>
            </div>
            <div style={{ fontSize: 10, color: T?.textMuted || '#5b6a8a' }}>{pct.toFixed(0)}% objectif · Obj. {fmt(fin.caObj)}</div>
          </div>
        </Card>
        <Card T={T} style={{ borderColor: 'rgba(52,209,136,.30)' }}>
          <CardHdr T={T} acc={acc} title={<span style={{ color: '#34d188' }}>📊 Résultat Mensuel</span>}/>
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 30, color: resColor, fontWeight: 700 }}>{fmt(res)}</div>
            <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', marginTop: 4 }}>CA − toutes charges</div>
            <div style={{ marginTop: 8, fontSize: 11, color: T?.textMuted || '#5b6a8a' }}>Taux résultat : <span style={{ fontFamily: "'DM Mono',monospace" }}>{fmtPct(tauxRes)}</span></div>
          </div>
        </Card>
        <Card T={T}>
          <CardHdr T={T} acc={acc} title="🏦 Trésorerie Nette"/>
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 30, color: trColor, fontWeight: 700 }}>{fmt(trsoN)}</div>
            <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', marginTop: 4 }}>solde − dettes fournisseurs</div>
            <div style={{ marginTop: 8, fontSize: 11, color: T?.textMuted || '#5b6a8a' }}>Encours clients : <span style={{ fontFamily: "'DM Mono',monospace" }}>{fmt(enc)}</span></div>
          </div>
        </Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px,1fr))', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card T={T}>
            <FSec T={T} acc={acc}>📈 Chiffre d'Affaires</FSec>
            <FRow T={T} label="Objectif CA mensuel (€)"><ENum v={fin.caObj} onChange={u('caObj')} ph="90000" T={T}/> €</FRow>
            <FRow T={T} label="CA réalisé ce mois (€)" note="Montant facturé émis"><ENum v={fin.caReal} onChange={u('caReal')} T={T}/> €</FRow>
            <FRow T={T} label="CA encaissé ce mois (€)" note="Règlements effectivement reçus"><ENum v={fin.caEnc} onChange={u('caEnc')} T={T}/> €</FRow>
            <FRow T={T} label="Encours clients (€ à recevoir)"><FCalc v={fmt(enc)} color={enc > 0 ? '#ff9a4d' : '#34d188'}/></FRow>
            <FRow T={T} label="CA annuel YTD (€)" note="Depuis le 1er janvier"><ENum v={fin.caYtd} onChange={u('caYtd')} T={T}/> €</FRow>
            <FRow T={T} label="Objectif annuel (€)"><ENum v={fin.caAnn} onChange={u('caAnn')} ph="1080000" T={T}/> €</FRow>
          </Card>
          <Card T={T}>
            <FSec T={T} acc={acc}>🏦 Trésorerie</FSec>
            <FRow T={T} label="Solde bancaire (€)"><ENum v={fin.solde} onChange={u('solde')} T={T}/> €</FRow>
            <FRow T={T} label="Dettes fournisseurs (€)" note="Factures non réglées"><ENum v={fin.dettes} onChange={u('dettes')} T={T}/> €</FRow>
            <FRow T={T} label="Trésorerie nette"><FCalc v={fmt(trsoN)} color={trColor}/></FRow>
            <FRow T={T} label="Jours de fonctionnement" note="Tréso nette ÷ charges/jour"><FCalc v={jours > 0 ? `${jours} jours` : '—'} color={jours > 30 ? '#34d188' : jours > 15 ? '#ff9a4d' : '#ff625f'}/></FRow>
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card T={T}>
            <FSec T={T} acc={acc}>🔒 Charges Fixes Mensuelles</FSec>
            <FRow T={T} label="Masse salariale nette (€)" note="Salaires nets + charges patronales"><ENum v={fin.sal} onChange={u('sal')} T={T}/> €</FRow>
            <FRow T={T} label="Loyer / locaux (€)"><ENum v={fin.loyer} onChange={u('loyer')} T={T}/> €</FRow>
            <FRow T={T} label="Assurances (€)"><ENum v={fin.assur} onChange={u('assur')} T={T}/> €</FRow>
            <FRow T={T} label="Comptabilité / gestion (€)"><ENum v={fin.compta} onChange={u('compta')} T={T}/> €</FRow>
            <FRow T={T} label="Frais véhicules (€)" note="Carburant, entretien, leasing"><ENum v={fin.veh} onChange={u('veh')} T={T}/> €</FRow>
            <FRow T={T} label="Outillage / consommables (€)"><ENum v={fin.outil} onChange={u('outil')} T={T}/> €</FRow>
            <FRow T={T} label="Frais divers (€)" note="Téléphonie, abonnements, formation"><ENum v={fin.div} onChange={u('div')} T={T}/> €</FRow>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', background: 'rgba(255,255,255,0.025)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T?.text || '#f0f0f0' }}>Total charges fixes</div>
              <FCalc v={fmt(totFix)} color="#ff625f"/>
            </div>
          </Card>
          <Card T={T}>
            <FSec T={T} acc={acc}>⚙️ Charges Variables Mensuelles</FSec>
            <FRow T={T} label="Achats matériaux (€)" note="Commandes réglées ce mois"><ENum v={fin.mat} onChange={u('mat')} T={T}/> €</FRow>
            <FRow T={T} label="Sous-traitance (€)"><ENum v={fin.st} onChange={u('st')} T={T}/> €</FRow>
            <FRow T={T} label="Primes versées (€)" note="Primes compagnons du mois"><ENum v={fin.primes} onChange={u('primes')} T={T}/> €</FRow>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', background: 'rgba(255,255,255,0.025)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T?.text || '#f0f0f0' }}>Total charges variables</div>
              <FCalc v={fmt(totVar)} color="#ff9a4d"/>
            </div>
          </Card>
        </div>
      </div>
      <Card T={T} style={{ marginTop: 14 }}>
        <FSec T={T} acc={acc}>📊 Résultat Mensuel</FSec>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}` }}>
          {[
            { label: 'CA Réalisé',         v: fmt(fin.caReal), c: acc?.accent || '#FFC200' },
            { label: 'Charges Fixes',      v: fmt(totFix),     c: '#ff625f' },
            { label: 'Charges Variables',  v: fmt(totVar),     c: '#ff9a4d' },
            { label: "Point d'Équilibre",  v: fmt(totC),       c: fin.caReal >= totC ? '#34d188' : '#ff625f', sub: fin.caReal >= totC ? '✅ Seuil atteint' : '⚠️ CA insuffisant' },
          ].map(({ label, v, c, sub }, i) => (
            <div key={i} style={{ padding: '14px 16px', borderRight: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}` }}>
              <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 20, color: c, fontWeight: 700 }}>{v}</div>
              {sub && <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 4 }}>{sub}</div>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'rgba(255,194,0,0.05)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T?.text || '#f0f0f0' }}>RÉSULTAT MENSUEL BRUT</div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700, color: resColor }}>{fmt(res)}</div>
        </div>
      </Card>
    </div>
  );
}

// ─── ONGLET POINT FINANCIER ──────────────────────────────────────────────────
// ─── ONGLET POINT FINANCIER ──────────────────────────────────────────────────
// Liste initiale de mois. Les anciens "jan/feb/mar/apr/may" deviennent des keys
// stables "YYYY-MM" (anti-collision quand on ajoute des mois). On garde la
// rétro-compat avec INIT_CR_ROWS.prev/curr en les insérant sur 2026-03/04.
const DEFAULT_FINANCE_MONTHS = [
  { key: '2026-01', label: 'Janvier 2026' },
  { key: '2026-02', label: 'Février 2026' },
  { key: '2026-03', label: MONTH_PREV_LABEL },
  { key: '2026-04', label: MONTH_CURR_LABEL },
  { key: '2026-05', label: 'Mai 2026' },
];

const initMonthlyRows = (rows, months) => rows.map(r => {
  const monthly = {};
  months.forEach(m => { monthly[m.key] = 0; });
  // Bootstrap : prev → 2026-03, curr → 2026-04 (compatibilité avec INIT_CR_ROWS).
  if ('2026-03' in monthly) monthly['2026-03'] = nv(r.prev);
  if ('2026-04' in monthly) monthly['2026-04'] = nv(r.curr);
  return { ...r, monthly };
});

const monthValue = (row, key) => nv(row.monthly?.[key]);
const pctCA = (value, ca) => ca ? (value / ca) * 100 : 0;

// Tri chronologique des mois par leur key "YYYY-MM".
const sortMonths = (months) => [...months].sort((a, b) => a.key.localeCompare(b.key));

// Construit le label "Mois Année" en français à partir d'une key "YYYY-MM".
function labelFromKey(key) {
  const [y, m] = key.split('-');
  const names = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  return `${names[parseInt(m, 10) - 1] || m} ${y}`;
}

function SocieteFinanceTab({ derivedFinance = { moByMonth: {}, matByMonth: {} }, T, acc }) {
  const [months, setMonths] = useState(DEFAULT_FINANCE_MONTHS);
  const [crRows, setCrRows] = useState(() => initMonthlyRows(INIT_CR_ROWS, DEFAULT_FINANCE_MONTHS));
  const [fgRows, setFgRows] = useState(() => initMonthlyRows(INIT_FG_ROWS, DEFAULT_FINANCE_MONTHS));
  const [selectedMonth, setSelectedMonth] = useState('2026-04');
  // hasLoaded : on bloque la sauvegarde auto tant que le chargement initial n'a
  // pas eu lieu (sinon on écraserait les données Supabase avec les defaults).
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // État du formulaire "Ajouter un mois"
  const [addMonthOpen, setAddMonthOpen] = useState(false);
  const today = new Date();
  const [newMonthYear, setNewMonthYear] = useState(today.getFullYear());
  const [newMonthMonth, setNewMonthMonth] = useState(String(today.getMonth() + 1).padStart(2, '0'));

  // ── Chargement initial depuis planning_config (1 seule fois au mount)
  // Clés : dashboard_finance_months / dashboard_finance_cr_rows / dashboard_finance_fg_rows
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("planning_config")
        .select("key,value")
        .in("key", ["dashboard_finance_months", "dashboard_finance_cr_rows", "dashboard_finance_fg_rows"]);
      if (cancelled) return;
      const cfg = {}; (data || []).forEach(r => { cfg[r.key] = r.value; });
      if (Array.isArray(cfg.dashboard_finance_months) && cfg.dashboard_finance_months.length > 0) {
        setMonths(cfg.dashboard_finance_months);
        // ajuster le mois sélectionné si nécessaire
        if (!cfg.dashboard_finance_months.some(m => m.key === selectedMonth)) {
          const lastWithData = [...cfg.dashboard_finance_months].reverse().find(m => true);
          if (lastWithData) setSelectedMonth(lastWithData.key);
        }
      }
      if (Array.isArray(cfg.dashboard_finance_cr_rows) && cfg.dashboard_finance_cr_rows.length > 0) {
        setCrRows(cfg.dashboard_finance_cr_rows);
      }
      if (Array.isArray(cfg.dashboard_finance_fg_rows) && cfg.dashboard_finance_fg_rows.length > 0) {
        setFgRows(cfg.dashboard_finance_fg_rows);
      }
      setHasLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sauvegarde debouncée (1.2s après dernière modif)
  const saveTimer = React.useRef(null);
  useEffect(() => {
    if (!hasLoaded) return;
    setSaving(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await Promise.all([
        supabase.from("planning_config").upsert({ key: "dashboard_finance_months",  value: months  }, { onConflict: "key" }),
        supabase.from("planning_config").upsert({ key: "dashboard_finance_cr_rows", value: crRows  }, { onConflict: "key" }),
        supabase.from("planning_config").upsert({ key: "dashboard_finance_fg_rows", value: fgRows  }, { onConflict: "key" }),
      ]);
      setSaving(false);
      setSavedAt(new Date());
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [months, crRows, fgRows, hasLoaded]);

  const selectedIdx = Math.max(months.findIndex(m => m.key === selectedMonth), 0);
  const visibleMonths = months.slice(0, selectedIdx + 1);
  const previousMonth = months[selectedIdx - 1];
  const currentMonth  = months[selectedIdx] || months[0] || { key: '', label: '—' };

  // Vue calculée du compte de résultat : on superpose aux lignes auto-calculées
  // (MO Travaux, Matières premières directes) les agrégats mensuels réels issus
  // de la base. crRows reste l'état éditable (lignes manuelles uniquement) ;
  // crRowsView sert à tous les affichages, totaux, %, YTD et graphiques.
  const crRowsView = useMemo(() => crRows.map(r => {
    const kind = DERIVED_CR_LABELS[r.label];
    if (!kind) return r;
    const src = kind === 'mo' ? (derivedFinance?.moByMonth || {}) : (derivedFinance?.matByMonth || {});
    const monthly = { ...r.monthly };
    Object.keys(src).forEach(k => { monthly[k] = Math.round(src[k]); });
    return { ...r, monthly, _derived: kind };
  }), [crRows, derivedFinance]);

  // updCR / updFG : on identifie les rows par index dans le tableau d'origine
  // (pas dans le tableau filtré par section), donc on passe l'idx complet.
  const updCR = useCallback((idx, key, val) => setCrRows(rows => rows.map((r, i) => i === idx ? { ...r, monthly: { ...r.monthly, [key]: val } } : r)), []);
  const updFG = useCallback((idx, key, val) => setFgRows(rows => rows.map((r, i) => i === idx ? { ...r, monthly: { ...r.monthly, [key]: val } } : r)), []);

  const ajouterMois = () => {
    const key = `${newMonthYear}-${newMonthMonth}`;
    if (months.some(m => m.key === key)) {
      alert("Ce mois est déjà présent dans le tableau.");
      return;
    }
    const next = sortMonths([...months, { key, label: labelFromKey(key) }]);
    setMonths(next);
    setCrRows(rows => rows.map(r => ({ ...r, monthly: { ...r.monthly, [key]: 0 } })));
    setFgRows(rows => rows.map(r => ({ ...r, monthly: { ...r.monthly, [key]: 0 } })));
    setAddMonthOpen(false);
    setSelectedMonth(key); // jump direct sur le nouveau mois
  };

  const sectionsCR = ['ACTIVITÉ', 'CHARGES DIRECTES VARIABLES', 'CHARGES DIRECTES FIXES', 'FRAIS GÉNÉRAUX', 'DOTATIONS'];
  const sectionsFG = [...new Set(fgRows.map(r => r.section))];
  const rowBySection = (rows, section) => rows.map((r, i) => ({ ...r, idx: i })).filter(r => r.section === section);
  const sectionTotal = (rows, section, key) => rows.filter(r => r.section === section).reduce((s, r) => s + monthValue(r, key), 0);
  const rowLabelTotal = (labels, key) => crRowsView.filter(r => labels.includes(r.label)).reduce((s, r) => s + monthValue(r, key), 0);
  const totals = key => {
    const activite = sectionTotal(crRowsView, 'ACTIVITÉ', key);
    const cdv = sectionTotal(crRowsView, 'CHARGES DIRECTES VARIABLES', key);
    const margeVariable = activite - cdv;
    const cdf = sectionTotal(crRowsView, 'CHARGES DIRECTES FIXES', key);
    const margeDirecte = margeVariable - cdf;
    const fg = sectionTotal(crRowsView, 'FRAIS GÉNÉRAUX', key);
    const dot = sectionTotal(crRowsView, 'DOTATIONS', key);
    const resultat = margeDirecte - fg - dot;
    const mo = rowLabelTotal(['MO Travaux', 'Personnel intérimaire', 'Appointements et CS "MO indirecte"'], key);
    const materiaux = rowLabelTotal(['Matières premières directes', 'Variation de stock'], key);
    return { activite, cdv, margeVariable, cdf, margeDirecte, fg, dot, resultat, mo, materiaux };
  };
  const ytd = visibleMonths.reduce((accObj, m) => {
    const t = totals(m.key);
    Object.keys(t).forEach(k => accObj[k] = (accObj[k] || 0) + t[k]);
    return accObj;
  }, {});
  const current = totals(currentMonth.key);
  const prev = previousMonth ? totals(previousMonth.key) : null;
  const monthDelta = key => current[key] - (prev ? prev[key] : 0);
  const fgYtdDetailed = visibleMonths.reduce((s, m) => s + fgRows.reduce((ss, r) => ss + monthValue(r, m.key), 0), 0);
  const fgCurrentDetailed = fgRows.reduce((s, r) => s + monthValue(r, currentMonth.key), 0);
  const fgPrevDetailed = previousMonth ? fgRows.reduce((s, r) => s + monthValue(r, previousMonth.key), 0) : 0;

  const evoText = (key, inverse = false) => {
    const d = monthDelta(key);
    const good = inverse ? d <= 0 : d >= 0;
    return <span style={{ color: good ? '#34d188' : '#ff625f' }}>Évolution {previousMonth ? `${currentMonth.label} vs ${previousMonth.label}` : currentMonth.label} : {d > 0 ? '+' : ''}{fmt(d, 2)}</span>;
  };
  const ytdRowTotal = row => visibleMonths.reduce((s, m) => s + monthValue(row, m.key), 0);

  const sectionStyle = { background: 'rgba(255,194,0,0.10)', color: acc?.accent || '#FFC200', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10 };
  const totalStyle = { background: 'rgba(255,194,0,0.13)', fontWeight: 900, color: T?.text || '#f0f0f0' };
  const resultStyle = { background: 'rgba(255,194,0,0.18)', fontWeight: 900 };

  // Données pour les graphiques : un point par mois visible
  const chartData = useMemo(() => visibleMonths.map(m => {
    const t = totals(m.key);
    return {
      mois:      m.label.replace(/ 20\d\d$/, ''), // raccourci sans année si possible
      moisLong:  m.label,
      key:       m.key,
      CA:        +t.activite.toFixed(0),
      FG:        +t.fg.toFixed(0),
      MO:        +t.mo.toFixed(0),
      Materiaux: +t.materiaux.toFixed(0),
      Resultat:  +t.resultat.toFixed(0),
    };
  }), [visibleMonths, crRowsView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Données cumulées (YTD) pour le graphique d'évolution cumulée
  const chartCumulData = useMemo(() => {
    let cumCA = 0, cumFG = 0, cumMO = 0, cumMat = 0, cumRes = 0;
    return visibleMonths.map(m => {
      const t = totals(m.key);
      cumCA  += t.activite;
      cumFG  += t.fg;
      cumMO  += t.mo;
      cumMat += t.materiaux;
      cumRes += t.resultat;
      return {
        mois:      m.label.replace(/ 20\d\d$/, ''),
        key:       m.key,
        CA:        +cumCA.toFixed(0),
        FG:        +cumFG.toFixed(0),
        MO:        +cumMO.toFixed(0),
        Materiaux: +cumMat.toFixed(0),
        Resultat:  +cumRes.toFixed(0),
      };
    });
  }, [visibleMonths, crRowsView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tooltip recharts : forçage couleurs lisibles sur fond sombre
  const tooltipStyle = {
    background: T?.surface || '#262a32',
    border: `1px solid ${T?.border || 'rgba(255,255,255,0.10)'}`,
    borderRadius: 8, padding: '8px 12px', fontSize: 12,
  };
  const fmtEuro = (v) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v)} €`;

  // Sélecteur mois disponibles pour le formulaire "Ajouter un mois"
  const monthOptions = [
    ['01','Janvier'],['02','Février'],['03','Mars'],['04','Avril'],['05','Mai'],['06','Juin'],
    ['07','Juillet'],['08','Août'],['09','Septembre'],['10','Octobre'],['11','Novembre'],['12','Décembre'],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI YTD */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14 }}>
        <SummaryCardFin T={T} label="CA YTD"                      value={fmt(ytd.activite || 0, 2)}  color={acc?.accent || '#FFC200'} sub={evoText('activite')}/>
        <SummaryCardFin T={T} label="Frais généraux YTD"          value={fmt(ytd.fg || 0, 2)}        color="#ff9a4d"                  sub={evoText('fg', true)}/>
        <SummaryCardFin T={T} label="MO YTD"                      value={fmt(ytd.mo || 0, 2)}        color="#5b9cf6"                  sub={evoText('mo', true)}/>
        <SummaryCardFin T={T} label="Matériaux YTD"               value={fmt(ytd.materiaux || 0, 2)} color="#FFD740"                  sub={evoText('materiaux', true)}/>
        <SummaryCardFin T={T} label="Résultat d'exploitation YTD" value={fmt(ytd.resultat || 0, 2)}  color={(ytd.resultat || 0) >= 0 ? '#34d188' : '#ff625f'} sub={evoText('resultat')}/>
      </div>

      {/* Graphiques */}
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📈 Évolution mensuelle" right={<span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>{visibleMonths.length} mois affichés</span>}/>
        <div style={{ padding: '18px 16px 8px', height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T?.border || 'rgba(255,255,255,0.08)'}/>
              <XAxis dataKey="mois" tick={{ fill: T?.textSub || '#9aa5c0', fontSize: 11 }} stroke={T?.border || 'rgba(255,255,255,0.10)'}/>
              <YAxis tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fill: T?.textSub || '#9aa5c0', fontSize: 11 }} stroke={T?.border || 'rgba(255,255,255,0.10)'}/>
              <RTooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: T?.text || '#f0f0f0' }}
                labelStyle={{ color: T?.text || '#f0f0f0', fontWeight: 700, marginBottom: 4 }}
                formatter={(value) => fmtEuro(value)}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }}/>
              <Bar dataKey="CA"        fill={acc?.accent || '#FFC200'} name="CA" radius={[4,4,0,0]}/>
              <Bar dataKey="FG"        fill="#ff9a4d"                   name="Frais généraux" radius={[4,4,0,0]}/>
              <Bar dataKey="MO"        fill="#5b9cf6"                   name="Main d'œuvre" radius={[4,4,0,0]}/>
              <Bar dataKey="Materiaux" fill="#FFD740"                   name="Matériaux" radius={[4,4,0,0]}/>
              <Line type="monotone" dataKey="Resultat" stroke="#34d188" strokeWidth={2.5} name="Résultat d'exploitation" dot={{ r: 4, fill: '#34d188' }}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Évolution cumulée sur l'année — recommandé par le cahier gérant */}
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📉 Évolution cumulée (YTD)" right={<span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Cumul depuis le 1er janvier</span>}/>
        <div style={{ padding: '18px 16px 8px', height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartCumulData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T?.border || 'rgba(255,255,255,0.08)'}/>
              <XAxis dataKey="mois" tick={{ fill: T?.textSub || '#9aa5c0', fontSize: 11 }} stroke={T?.border || 'rgba(255,255,255,0.10)'}/>
              <YAxis tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fill: T?.textSub || '#9aa5c0', fontSize: 11 }} stroke={T?.border || 'rgba(255,255,255,0.10)'}/>
              <RTooltip contentStyle={tooltipStyle} itemStyle={{ color: T?.text || '#f0f0f0' }} labelStyle={{ color: T?.text || '#f0f0f0', fontWeight: 700, marginBottom: 4 }} formatter={(value) => fmtEuro(value)}/>
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }}/>
              <Line type="monotone" dataKey="CA"        stroke={acc?.accent || '#FFC200'} strokeWidth={2.5} name="CA cumulé"            dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="FG"        stroke="#ff9a4d"                   strokeWidth={2}   name="FG cumulés"           dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="MO"        stroke="#5b9cf6"                   strokeWidth={2}   name="MO cumulée"           dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="Materiaux" stroke="#FFD740"                   strokeWidth={2}   name="Matériaux cumulés"    dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="Resultat"  stroke="#34d188"                   strokeWidth={2.5} name="Résultat cumulé"      dot={{ r: 4 }}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Tableau compte de résultat */}
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📊 Point financier" right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', fontStyle: 'italic' }}>
              {saving ? 'Enregistrement…' : savedAt ? `Sauvegardé ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
            <span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Mois actif</span>
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ ...inpCls(T), width: 160, padding: '7px 10px', cursor: 'pointer' }}>
              {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <Btn onClick={() => setAddMonthOpen(true)} sm color="gold" T={T} acc={acc}>＋ Ajouter un mois</Btn>
          </div>
        }/>
        {addMonthOpen && (
          <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
            background: 'rgba(255,194,0,0.04)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T?.textSub || '#9aa5c0', textTransform: 'uppercase', letterSpacing: '.08em' }}>Nouveau mois</span>
            <select value={newMonthMonth} onChange={e => setNewMonthMonth(e.target.value)} style={{ ...inpCls(T), width: 130, padding: '7px 10px', cursor: 'pointer' }}>
              {monthOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="number" value={newMonthYear} onChange={e => setNewMonthYear(parseInt(e.target.value) || today.getFullYear())} style={{ ...inpCls(T), width: 100, padding: '7px 10px' }} min="2020" max="2099"/>
            <Btn onClick={ajouterMois} sm color="gold" T={T} acc={acc}>Confirmer</Btn>
            <Btn onClick={() => setAddMonthOpen(false)} sm color="ghost" T={T} acc={acc}>Annuler</Btn>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Compte de résultat</th>
                {visibleMonths.map(m => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>)}
                <th style={{ textAlign: 'right' }}>Total YTD</th>
              </tr>
            </thead>
            <tbody>
              {sectionsCR.map(section => (
                <React.Fragment key={section}>
                  <tr style={sectionStyle}>
                    <td colSpan={visibleMonths.length + 2}>{section}</td>
                  </tr>
                  {rowBySection(crRowsView, section).map(row => (
                    <tr key={`${section}::${row.label}`}>
                      <td style={{ fontSize: 12, color: T?.text || '#f0f0f0' }}>
                        {row.label}
                        {row._derived && (
                          <span title="Calculé automatiquement depuis la base (pointages / factures) — non modifiable" style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, letterSpacing: '.06em', color: '#34d188', border: '1px solid rgba(52,209,136,.4)', borderRadius: 5, padding: '1px 4px', verticalAlign: 'middle' }}>AUTO</span>
                        )}
                      </td>
                      {visibleMonths.map(m => (
                        <td key={m.key} style={{ textAlign: 'right' }}>
                          {row._derived ? (
                            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#34d188', paddingRight: 7 }}>{fmt(monthValue(row, m.key), 0)}</span>
                          ) : (
                            <input
                              type="number"
                              value={Number.isFinite(monthValue(row, m.key)) ? monthValue(row, m.key) : ''}
                              onChange={e => updCR(row.idx, m.key, nv(e.target.value))}
                              style={{ ...edtCls(T), width: 92 }}
                            />
                          )}
                        </td>
                      ))}
                      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: T?.textSub || '#9aa5c0' }}>{fmt(ytdRowTotal(row), 2)}</td>
                    </tr>
                  ))}
                  {section === 'ACTIVITÉ' && <FinTotalLine label="TOTAL ACTIVITÉ" calc={key => totals(key).activite} color={acc?.accent || '#FFC200'} visibleMonths={visibleMonths} style={totalStyle}/>}
                  {section === 'CHARGES DIRECTES VARIABLES' && (
                    <>
                      <FinTotalLine label="TOTAL CDV" calc={key => totals(key).cdv} color="#ff9a4d" visibleMonths={visibleMonths} style={totalStyle}/>
                      <FinTotalLine label="MARGE SUR COÛT VARIABLE" calc={key => totals(key).margeVariable} color={acc?.accent || '#FFC200'} visibleMonths={visibleMonths} style={totalStyle}/>
                      <FinPctLine label="% DU CA" numCalc={key => totals(key).margeVariable} denomCalc={key => totals(key).activite} visibleMonths={visibleMonths} style={totalStyle}/>
                    </>
                  )}
                  {section === 'CHARGES DIRECTES FIXES' && (
                    <>
                      <FinTotalLine label="TOTAL CDF" calc={key => totals(key).cdf} color="#ff9a4d" visibleMonths={visibleMonths} style={totalStyle}/>
                      <FinTotalLine label="MARGE SUR COÛT DIRECT" calc={key => totals(key).margeDirecte} color={acc?.accent || '#FFC200'} visibleMonths={visibleMonths} style={totalStyle}/>
                      <FinPctLine label="% DU CA" numCalc={key => totals(key).margeDirecte} denomCalc={key => totals(key).activite} visibleMonths={visibleMonths} style={totalStyle}/>
                    </>
                  )}
                  {section === 'FRAIS GÉNÉRAUX' && (
                    <>
                      <FinTotalLine label="TOTAL FG" calc={key => totals(key).fg} color="#ff9a4d" visibleMonths={visibleMonths} style={totalStyle}/>
                      <FinPctLine label="% DU CA" numCalc={key => totals(key).fg} denomCalc={key => totals(key).activite} visibleMonths={visibleMonths} style={totalStyle}/>
                    </>
                  )}
                  {section === 'DOTATIONS' && <FinTotalLine label="RÉSULTAT D'EXPLOITATION" calc={key => totals(key).resultat} color={(ytd.resultat || 0) >= 0 ? '#34d188' : '#ff625f'} visibleMonths={visibleMonths} style={resultStyle}/>}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Tableau frais généraux détaillés */}
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📒 Frais généraux détaillés par mois" right={<span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Lecture par comptes comptables</span>}/>
        <div style={{ overflowX: 'auto' }}>
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>N°</th>
                <th>Libellé</th>
                {visibleMonths.map(m => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>)}
                <th style={{ textAlign: 'right' }}>Total YTD</th>
              </tr>
            </thead>
            <tbody>
              {sectionsFG.map(section => (
                <React.Fragment key={section}>
                  <tr style={sectionStyle}>
                    <td colSpan={visibleMonths.length + 3}>{section}</td>
                  </tr>
                  {fgRows.map((row, idx) => ({ ...row, idx })).filter(r => r.section === section).map(row => (
                    <tr key={`${section}::${row.code}::${row.label}`}>
                      <td style={{ fontFamily: "'DM Mono',monospace", color: T?.textMuted || '#5b6a8a' }}>{row.code}</td>
                      <td style={{ fontSize: 12, color: T?.text || '#f0f0f0' }}>{row.label}</td>
                      {visibleMonths.map(m => (
                        <td key={m.key} style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            value={Number.isFinite(monthValue(row, m.key)) ? monthValue(row, m.key) : ''}
                            onChange={e => updFG(row.idx, m.key, nv(e.target.value))}
                            style={{ ...edtCls(T), width: 92 }}
                          />
                        </td>
                      ))}
                      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: T?.textSub || '#9aa5c0' }}>{fmt(ytdRowTotal(row), 2)}</td>
                    </tr>
                  ))}
                  <tr style={totalStyle}>
                    <td colSpan={2}>TOTAL {section.split(' - ')[0]}</td>
                    {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: acc?.accent || '#FFC200' }}>{fmt(sectionTotal(fgRows, section, m.key), 2)}</td>)}
                    <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: acc?.accent || '#FFC200', fontWeight: 900 }}>{fmt(visibleMonths.reduce((s, m) => s + sectionTotal(fgRows, section, m.key), 0), 2)}</td>
                  </tr>
                </React.Fragment>
              ))}
              <tr style={resultStyle}>
                <td colSpan={2}>TOTAL GÉNÉRAL</td>
                {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: acc?.accent || '#FFC200' }}>{fmt(fgRows.reduce((s, r) => s + monthValue(r, m.key), 0), 2)}</td>)}
                <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: acc?.accent || '#FFC200', fontWeight: 900 }}>{fmt(fgYtdDetailed, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 14 }}>
        <SummaryCardFin T={T} label="Mois sélectionné"   value={currentMonth.label} color={acc?.accent || '#FFC200'} sub={`Résultat mensuel : ${fmt(current.resultat, 2)}`}/>
        <SummaryCardFin T={T} label="FG détaillés mois"  value={fmt(fgCurrentDetailed, 2)} color="#ff9a4d" sub={`Évolution : ${fgCurrentDetailed - fgPrevDetailed > 0 ? '+' : ''}${fmt(fgCurrentDetailed - fgPrevDetailed, 2)}`}/>
        <SummaryCardFin T={T} label="Poids FG / CA YTD"  value={fmtPct(pctCA(ytd.fg || 0, ytd.activite || 0), 2)} color="#5b9cf6"/>
      </div>
    </div>
  );
}

// Composants stables (définis hors SocieteFinanceTab pour éviter le démontage
// et la perte de focus des inputs à chaque render).
function SummaryCardFin({ T, label, value, sub, color }) {
  return (
    <Card T={T}>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: T?.textMuted || '#5b6a8a', marginBottom: 8 }}>{label}</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', marginTop: 5 }}>{sub}</div>}
      </div>
    </Card>
  );
}

function FinTotalLine({ label, calc, color, visibleMonths, style }) {
  return (
    <tr style={style}>
      <td style={{ fontWeight: 900 }}>{label}</td>
      {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color }}>{fmt(calc(m.key), 2)}</td>)}
      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color, fontWeight: 900 }}>{fmt(visibleMonths.reduce((s, m) => s + calc(m.key), 0), 2)}</td>
    </tr>
  );
}

function FinPctLine({ label, numCalc, denomCalc, visibleMonths, style }) {
  return (
    <tr style={style}>
      <td>{label}</td>
      {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right' }}>{fmtPct(pctCA(numCalc(m.key), denomCalc(m.key)), 2)}</td>)}
      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right' }}>{fmtPct(pctCA(visibleMonths.reduce((s, m) => s + numCalc(m.key), 0), visibleMonths.reduce((s, m) => s + denomCalc(m.key), 0)), 2)}</td>
    </tr>
  );
}

// ─── PAGE ROOT ───────────────────────────────────────────────────────────────
const TABS = [
  { key: 'chantiers',      label: '🏗️ Chantiers' },
  { key: 'pipeline',       label: '🔖 Pipeline' },
  { key: 'analyseSociete', label: '📊 Point financier' },
  { key: 'primes',         label: '🎯 Primes' },
  { key: 'finances',       label: '💰 Trésorerie' },
];

export default function DashboardAnalyse({ T, branch = "renovation", onOpenChantier }) {
  const acc = getBranchAccent(branch);
  // Sources de données réelles (Supabase) chargées au mount.
  const [phasesConfig, setPhasesConfig] = useState(PHASES_DEFAUT);
  const [phasagesRaw, setPhasagesRaw] = useState([]);
  const [chantiersRaw, setChantiersRaw] = useState([]);
  const [tauxHoraires, setTauxHoraires] = useState({});
  // P9 : pointages tous chantiers, regroupés en map { chantier_id: [pointages] }
  // pour dériver le coût MO réel dans calcMOConsommee.
  const [pointagesByChantier, setPointagesByChantier] = useState({});
  const [commandeCostByChantier, setCommandeCostByChantier] = useState({});
  // Agrégats mensuels réels pour les lignes auto-calculées du Point financier :
  //   moByMonth["YYYY-MM"]  = Σ heures × taux (pointages du mois)
  //   matByMonth["YYYY-MM"] = Σ montant_ht (factures fournisseurs du mois)
  const [derivedFinance, setDerivedFinance] = useState({ moByMonth: {}, matByMonth: {} });
  // Date du dernier CR (cr_comptes_rendus) par chantier_id, pour calcul statut hebdo
  const [lastCRByChantier, setLastCRByChantier] = useState({});
  const [loading, setLoading] = useState(true);
  // Pipeline et Trésorerie persistés dans planning_config (PR6).
  const [pipeline, setPipeline]   = useState(INIT_PIPELINE);
  const [finances, setFinances]   = useState(INIT_FINANCES);
  const [pipeLoaded, setPipeLoaded] = useState(false);
  const [finLoaded, setFinLoaded]   = useState(false);
  // tresoHadSaved : vrai si une Trésorerie a déjà été sauvegardée en base. Sinon,
  // on pré-remplit une fois les champs dérivables (matériaux, primes, CA produit).
  const [tresoHadSaved, setTresoHadSaved] = useState(false);
  const tresoSeededRef = React.useRef(false);
  const [activeTab, setActiveTab] = useState('chantiers');
  const [pipeModal, setPipeModal] = useState({ open: false, item: null });

  // Chargement initial Pipeline + Trésorerie depuis planning_config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("planning_config")
        .select("key,value").in("key", ["dashboard_pipeline", "dashboard_treso"]);
      if (cancelled) return;
      const cfg = {}; (data || []).forEach(r => { cfg[r.key] = r.value; });
      if (Array.isArray(cfg.dashboard_pipeline)) setPipeline(cfg.dashboard_pipeline);
      const hasTreso = cfg.dashboard_treso && typeof cfg.dashboard_treso === 'object';
      if (hasTreso) setFinances({ ...INIT_FINANCES, ...cfg.dashboard_treso });
      setTresoHadSaved(!!hasTreso);
      setPipeLoaded(true);
      setFinLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Sauvegarde debouncée Pipeline / Trésorerie
  const savePipeTimer = React.useRef(null);
  useEffect(() => {
    if (!pipeLoaded) return;
    clearTimeout(savePipeTimer.current);
    savePipeTimer.current = setTimeout(() => {
      supabase.from("planning_config").upsert({ key: "dashboard_pipeline", value: pipeline }, { onConflict: "key" });
    }, 1200);
    return () => clearTimeout(savePipeTimer.current);
  }, [pipeline, pipeLoaded]);

  const saveFinTimer = React.useRef(null);
  useEffect(() => {
    if (!finLoaded) return;
    clearTimeout(saveFinTimer.current);
    saveFinTimer.current = setTimeout(() => {
      supabase.from("planning_config").upsert({ key: "dashboard_treso", value: finances }, { onConflict: "key" });
    }, 1200);
    return () => clearTimeout(saveFinTimer.current);
  }, [finances, finLoaded]);

  // Chargement initial : phases, phasages, chantiers, taux horaires.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [pCfg, phQ, cfgQ, crQ, ptsQ, cmdQ, facQ] = await Promise.all([
        loadPhases(),
        supabase.from("phasages").select("id, chantier_id, chantier_nom, plan_travaux, ouvrages, updated_at"),
        supabase.from("planning_config").select("key,value").in("key", ["chantiers", "taux_horaires"]),
        // CR : on prend les 200 derniers, on extrait le plus récent par chantier_id.
        // On essaie d'inclure `validateur` ; si la colonne n'existe pas (42703),
        // on retombe sur le select sans validateur (fallback gracieux).
        supabase.from("cr_comptes_rendus").select("chantier_id, date_visite, validateur").order("date_visite", { ascending: false }).limit(200),
        // P9 : pointages tous chantiers. `date` sert au regroupement par mois pour
        // la ligne "MO Travaux" auto-calculée du Point financier.
        supabase.from("pointages").select("chantier_id,tache_id,heures,taux_horaire,type_pointage,motif_indirect,date"),
        // V2 : coût réel des commandes, source unique = commande_lignes (lié au lot).
        supabase.from("commande_lignes").select("chantier_id, lot_id, prix_total"),
        // Factures fournisseurs : montant_ht + date_facture → ligne "Matières
        // premières directes" auto-calculée par mois du Point financier.
        supabase.from("factures").select("montant_ht, date_facture"),
      ]);
      // Regroupement par chantier_id (repli vide si erreur)
      const byCh = {};
      if (!ptsQ?.error) (ptsQ.data || []).forEach(p => {
        const k = p.chantier_id;
        if (!byCh[k]) byCh[k] = [];
        byCh[k].push(p);
      });
      // Coût commandes par chantier (somme prix_total). Remplace l'accumulateur
      // V1 plan["<phase>__cout_commandes"] dans le calcul des matériaux consommés.
      const cmdByCh = {};
      if (!cmdQ?.error) (cmdQ.data || []).forEach(l => {
        const k = l.chantier_id;
        if (!k) return;
        cmdByCh[k] = (cmdByCh[k] || 0) + (parseFloat(l.prix_total) || 0);
      });
      // Agrégats mensuels pour le Point financier (clé "YYYY-MM").
      const moByMonth = {};
      if (!ptsQ?.error) (ptsQ.data || []).forEach(p => {
        const m = (p.date || "").slice(0, 7);
        if (m.length !== 7) return;
        moByMonth[m] = (moByMonth[m] || 0) + (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0);
      });
      const matByMonth = {};
      if (!facQ?.error) (facQ.data || []).forEach(f => {
        const m = (f.date_facture || "").slice(0, 7);
        if (m.length !== 7) return;
        matByMonth[m] = (matByMonth[m] || 0) + (parseFloat(f.montant_ht) || 0);
      });
      if (cancelled) return;
      // Fallback : si la colonne validateur n'existe pas en base, on retente sans
      let crRows = crQ.data;
      if (crQ.error?.code === "42703") {
        const retry = await supabase.from("cr_comptes_rendus").select("chantier_id, date_visite").order("date_visite", { ascending: false }).limit(200);
        crRows = retry.data;
      }
      setPhasesConfig(Array.isArray(pCfg) && pCfg.length > 0 ? pCfg : PHASES_DEFAUT);
      setPhasagesRaw(phQ.data || []);
      const cfg = {}; (cfgQ.data || []).forEach(r => { cfg[r.key] = r.value; });
      setChantiersRaw(Array.isArray(cfg.chantiers) ? cfg.chantiers : []);
      setTauxHoraires(cfg.taux_horaires || {});
      // Map { chantier_id: { date_visite, validateur } } du CR le plus récent
      const crMap = {};
      (crRows || []).forEach(r => {
        if (!r.chantier_id || !r.date_visite) return;
        if (!crMap[r.chantier_id] || r.date_visite > crMap[r.chantier_id].date) {
          crMap[r.chantier_id] = { date: r.date_visite, validateur: r.validateur || null };
        }
      });
      setLastCRByChantier(crMap);
      setPointagesByChantier(byCh);
      setCommandeCostByChantier(cmdByCh);
      setDerivedFinance({ moByMonth, matByMonth });
      setLoading(false);
    })();
    // Channel realtime : recharger les phasages dès qu'un est mis à jour
    const ch = supabase.channel("dashboard-phasages")
      .on("postgres_changes", { event: "*", schema: "public", table: "phasages" },
          async () => {
            const { data } = await supabase.from("phasages").select("id, chantier_id, chantier_nom, plan_travaux, updated_at");
            if (!cancelled) setPhasagesRaw(data || []);
          })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  // Mapping Supabase → structure dashboard. Mémoïsé pour ne pas recalculer
  // à chaque rendu si les sources ne bougent pas.
  const chantiers = useMemo(() => {
    if (!phasagesRaw.length) return [];
    const byChantier = Object.fromEntries(chantiersRaw.map(c => [c.id, c]));
    return phasagesRaw.map(ph => phasageToChantier(ph, byChantier[ph.chantier_id], tauxHoraires, phasesConfig, lastCRByChantier, pointagesByChantier, commandeCostByChantier));
  }, [phasagesRaw, chantiersRaw, tauxHoraires, phasesConfig, lastCRByChantier, pointagesByChantier, commandeCostByChantier]);

  // Valeurs Trésorerie dérivables des vraies données (servent de pré-remplissage
  // une seule fois quand aucune Trésorerie n'a encore été saisie) :
  //   mat    = achats matériaux du mois courant (factures fournisseurs)
  //   primes = primes des chantiers déclenchables (marge réelle ≥ seuil)
  //   caReal = production estimée à date (Σ CA chantier × avancement %)
  //   st     = sous-traitance : pas de source fiable → laissé à 0 (manuel)
  const tresoDerived = useMemo(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const mat = Math.round(derivedFinance.matByMonth?.[curMonth] || 0);
    const primes = Math.round(chantiers.filter(c => c.mr >= c.seuil).reduce((s, c) => s + (c.prime || 0), 0));
    const caReal = Math.round(chantiers.reduce((s, c) => s + (c.ca || 0) * (c.avR || 0) / 100, 0));
    return { mat, primes, caReal };
  }, [chantiers, derivedFinance]);

  // Pré-remplissage unique de la Trésorerie : seulement si rien n'a été sauvegardé
  // et une fois les données réelles disponibles. L'utilisateur peut ensuite tout
  // modifier ; ses saisies sont persistées et priment aux chargements suivants.
  useEffect(() => {
    if (!finLoaded || tresoHadSaved || tresoSeededRef.current) return;
    const ready = chantiers.length > 0 || Object.keys(derivedFinance.matByMonth || {}).length > 0;
    if (!ready) return;
    tresoSeededRef.current = true;
    setFinances(prev => ({ ...prev, ...tresoDerived }));
  }, [finLoaded, tresoHadSaved, chantiers, derivedFinance, tresoDerived]);

  // Archives : pour l'instant on n'a pas de notion d'archivage des phasages,
  // donc on laisse vide. PR3+ : pourrait lire un flag phasage.archive.
  const archives = [];

  // Labels des phases (pour PhaseTrack + colonne phase)
  const phasesLabels = useMemo(() => phasesConfig.map(p => p.label), [phasesConfig]);

  const totalCA      = useMemo(() => chantiers.reduce((s, c) => s + c.ca, 0), [chantiers]);
  const avgMV        = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + c.mv, 0) / chantiers.length : 0, [chantiers]);
  const avgMR        = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + c.mr, 0) / chantiers.length : 0, [chantiers]);
  const alertCount   = useMemo(() => chantiers.filter(c => gSt(c) !== 'green').length, [chantiers]);
  const globalRatio  = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + ratioMO(c), 0) / chantiers.length : 0, [chantiers]);
  const pipeTotal    = useMemo(() => pipeline.reduce((s, p) => s + p.ca * (p.proba / 100), 0), [pipeline]);
  const health = alertCount === 0 ? 'good' : alertCount <= 2 ? 'warn' : 'bad';

  // Restore chantier : pas applicable tant qu'on n'a pas d'archives en base.
  const restoreChantier = () => {};
  const savePipeline = f => {
    if (!f.nom.trim()) return;
    setPipeline(p => f.id && p.find(x => x.id === f.id) ? p.map(x => x.id === f.id ? f : x) : [...p, { ...f, id: Date.now() }]);
    setPipeModal({ open: false, item: null });
  };
  const deletePipelineItem = (id) => {
    setPipeline(p => p.filter(x => x.id !== id));
    setPipeModal({ open: false, item: null });
  };

  const today = new Date();
  const dateLabel = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][today.getDay()] + ' ' + today.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const healthStyles = {
    good: { bg: 'rgba(52,209,136,.13)', color: '#34d188', border: '1px solid rgba(52,209,136,.35)', label: 'Santé globale : BONNE' },
    warn: { bg: 'rgba(255,154,77,.13)', color: '#ff9a4d', border: '1px solid rgba(255,154,77,.35)', label: 'Santé globale : ATTENTION' },
    bad:  { bg: 'rgba(255,98,95,.13)',  color: '#ff625f', border: '1px solid rgba(255,98,95,.35)',  label: 'Santé globale : ALERTE' },
  };
  const mrColor    = avgMR >= avgMV * 0.95 ? '#34d188' : avgMR >= avgMV * 0.85 ? '#ff9a4d' : '#ff625f';
  const ratioColor = globalRatio > 1.0001 ? '#34d188' : globalRatio >= 0.9999 ? '#ff9a4d' : '#ff625f';
  const alertColor = alertCount === 0 ? '#34d188' : alertCount <= 2 ? '#ff9a4d' : '#ff625f';

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: T?.bg || '#1e2128' }}>
      <style>{`
        @keyframes da-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.82)} }
        @keyframes da-slide-in { from { transform: translateX(100%); } to { transform: none; } }
        .da-table thead th { padding: 10px 12px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${T?.textMuted || '#5b6a8a'}; background: rgba(255,255,255,0.025); border-bottom: 1px solid ${T?.border || 'rgba(255,255,255,0.07)'}; text-align: left; white-space: nowrap; }
        .da-table tbody td { padding: 11px 12px; border-bottom: 1px solid ${T?.border || 'rgba(255,255,255,0.05)'}; vertical-align: middle; }
        .da-table tbody tr:last-child td { border-bottom: none; }
        .da-table tbody tr:hover td { background: rgba(255,194,0,0.03); }
      `}</style>

      <PipelineModal open={pipeModal.open} item={pipeModal.item} onClose={() => setPipeModal({ open: false, item: null })} onSave={savePipeline} onDelete={deletePipelineItem} T={T} acc={acc}/>

      {/* HEADER */}
      <div style={{
        padding: '20px 28px', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
        background: T?.surface || '#262a32',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ width: 8, height: 36, borderRadius: 999, background: acc.accent }}/>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T?.text || '#f0f0f0', letterSpacing: -0.3, lineHeight: 1 }}>Dashboard Analyse</div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T?.textMuted || '#5b6a8a', marginTop: 4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Pilotage opérationnel · Direction</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, ...healthStyles[health], fontSize: 11, fontWeight: 800 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: healthStyles[health].color, animation: 'da-pulse 1.4s ease-in-out infinite' }}/>
          {healthStyles[health].label}
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: T?.textSub || '#9aa5c0', padding: '7px 12px', border: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, borderRadius: 999 }}>{dateLabel}</div>
        {loading && <span style={{ fontSize: 11, color: T?.textMuted || '#5b6a8a', fontStyle: 'italic' }}>Chargement…</span>}
      </div>

      {/* KPIs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))',
        borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, background: T?.bg || '#1e2128',
      }}>
        {[
          { label: 'CA chantiers en cours',  v: fmt(totalCA),         c: acc.accent, sub: `${chantiers.length} chantier${chantiers.length > 1 ? 's' : ''} actif${chantiers.length > 1 ? 's' : ''}` },
          { label: 'Marge réelle moy.',      v: fmtPct(avgMR),        c: mrColor,    sub: `vs objectif ${fmtPct(avgMV)}` },
          { label: 'Alertes actives',        v: alertCount,           c: alertColor, sub: 'chantiers à surveiller' },
          { label: 'Ratio MO global',        v: globalRatio.toFixed(2), c: ratioColor, sub: 'budget restant / reste théorique' },
        ].map(({ label, v, c, sub }) => (
          <div key={label} style={{
            padding: '18px 22px',
            borderRight: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
            display: 'flex', flexDirection: 'column', gap: 5,
          }}>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: T?.textMuted || '#5b6a8a' }}>{label}</div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 24, fontWeight: 700, color: c, lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{
        background: T?.surface || '#262a32',
        borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`,
        padding: '10px 28px', display: 'flex', gap: 8, overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const a = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '8px 16px', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
              background: a ? acc.bg10 : 'transparent',
              border: `1px solid ${a ? acc.accent + '55' : (T?.border || 'rgba(255,255,255,0.07)')}`,
              borderRadius: 999, color: a ? acc.accent : (T?.textSub || '#9aa5c0'),
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* CONTENU */}
      <div style={{ padding: '24px 28px', maxWidth: 1540, margin: '0 auto' }}>
        {activeTab === 'chantiers'      && <ChantiersTab     chantiers={chantiers} archives={archives} onRestore={restoreChantier} onOpenChantier={onOpenChantier} loading={loading} phasesLabels={phasesLabels} T={T} acc={acc}/>}
        {activeTab === 'pipeline'       && <PipelineTab      pipeline={pipeline} onAdd={() => setPipeModal({ open: true, item: null })} onEdit={item => setPipeModal({ open: true, item })} T={T} acc={acc}/>}
        {activeTab === 'analyseSociete' && <SocieteFinanceTab derivedFinance={derivedFinance} T={T} acc={acc}/>}
        {activeTab === 'primes'         && <PrimesTab        chantiers={chantiers} T={T} acc={acc}/>}
        {activeTab === 'finances'       && <FinancesTab      fin={finances} setFin={setFinances} T={T} acc={acc}/>}
      </div>

      {/* Bulle flottante "Analyses" (FAB + drawer) accessible depuis tous les onglets */}
      <AnalysesBulle T={T} acc={acc}/>
    </div>
  );
}
