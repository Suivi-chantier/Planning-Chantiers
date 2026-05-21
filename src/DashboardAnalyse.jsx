// src/DashboardAnalyse.jsx — Dashboard d'analyse pour la direction.
//
// Adaptation de l'ébauche HTML envoyée par le gérant
// (public/ProferoDashboard_analyse_gerant_v4.html), reproduite ici en
// composant React intégré à l'application Profero Rénovation :
//   - 6 onglets : Chantiers, Pipeline, Point financier, Primes, Analyses, Trésorerie
//   - KPIs en tête (CA total, marge réelle, alertes, ratio MO, pipeline pondéré)
//   - 3 modales : nouveau chantier, mise à jour chantier, opportunité pipeline
//
// V1 : entièrement alimenté par des données mockées. Le branchement aux
// vraies tables Supabase (phasages, profero_projets, etc.) sera fait dans
// une PR suivante après validation visuelle par le gérant.
//
// Esthétique : adaptée au thème Profero (palette sombre + accent jaune
// #FFC200, polices Barlow Condensed / DM Mono) pour s'intégrer parfaitement
// dans l'application existante. La structure marine/dorée d'origine a été
// remplacée par les variables du theme T.

import React, { useState, useMemo, useEffect } from "react";
import { FONT, RADIUS, getBranchAccent } from "./constants";

// ─── DONNÉES STATIQUES ───────────────────────────────────────────────────────
const PHASES = ['Démolition', 'Gros œuvre', 'Électricité', 'Plomberie', 'Isolation', 'Cloisons', 'Sol', 'Peinture', 'Livraison'];

const PIPE_COLS = [
  { key: 'prospect', label: '🔵 Prospect' },
  { key: 'devis',    label: '🟡 Devis envoyé' },
  { key: 'nego',     label: '🟠 Négociation' },
  { key: 'signe',    label: '🟢 Signé' },
];

const INIT_CHANTIERS = [
  { id: 1, nom: "Rénovation complète — M. Dupont",   debut: "2025-02-10", livraisonInit: "2025-05-20", livraisonPrev: "2025-05-25", avR: 82, avP: 85, phase: 7, budMO: 18000, moC: 15400, budMat: 22000, matC: 20100, ca: 65000,  mv: 28, mr: 27.2, prime: 300, seuil: 25, comp: ["Steven", "Samad"], cr: true,  note: "",                     lastUpdated: "2025-05-21" },
  { id: 2, nom: "Division immeuble — SCI Leblanc",   debut: "2025-03-01", livraisonInit: "2025-06-30", livraisonPrev: "2025-07-15", avR: 45, avP: 52, phase: 3, budMO: 32000, moC: 17200, budMat: 38000, matC: 19500, ca: 112000, mv: 30, mr: 24.5, prime: 400, seuil: 27, comp: ["Mady", "Reza"],     cr: true,  note: "Retard menuiseries",   lastUpdated: "2025-05-19" },
  { id: 3, nom: "Réhabilitation T3 — Mme Moreau",    debut: "2025-04-01", livraisonInit: "2025-06-01", livraisonPrev: "2025-06-01", avR: 68, avP: 65, phase: 5, budMO: 12000, moC: 8100,  budMat: 14000, matC: 9200,  ca: 42000,  mv: 26, mr: 28.1, prime: 250, seuil: 25, comp: ["Jean-Philippe"],    cr: false, note: "",                     lastUpdated: "2025-05-21" },
  { id: 4, nom: "Passoire → T2 BBC — Invest49",      debut: "2025-03-15", livraisonInit: "2025-05-30", livraisonPrev: "2025-06-15", avR: 90, avP: 95, phase: 7, budMO: 9500,  moC: 9200,  budMat: 11000, matC: 11400, ca: 34000,  mv: 25, mr: 22.3, prime: 200, seuil: 23, comp: ["Steven"],           cr: true,  note: "Sol dépassé",          lastUpdated: "2025-05-16" },
  { id: 5, nom: "Colocation 5 ch — M. Guérin",       debut: "2025-04-10", livraisonInit: "2025-07-31", livraisonPrev: "2025-07-31", avR: 28, avP: 25, phase: 2, budMO: 24000, moC: 6500,  budMat: 29000, matC: 7800,  ca: 88000,  mv: 32, mr: 31.5, prime: 350, seuil: 28, comp: ["Samad", "Mady"],    cr: true,  note: "",                     lastUpdated: null         },
];

const INIT_ARCHIVES = [
  { id: 100, nom: "Appartement T2 — M. Petit", ca: 38000, mv: 27, mr: 29.2, seuil: 25, debut: "2024-10-01", livraisonInit: "2024-12-15", livraisonPrev: "2024-12-22", archivedAt: "2025-01-08" },
];

const INIT_PIPELINE = [
  { id: 1, nom: "Maison — Famille Renard",     ca: 95000,  proba: 70, statut: "nego",  date: "2025-06-15", note: "Accord de principe" },
  { id: 2, nom: "Immeuble 6 lots — SCI Martin", ca: 180000, proba: 40, statut: "devis", date: "2025-07-01", note: "Devis envoyé le 10 mai" },
  { id: 3, nom: "Rénovation — Mme Blanc",       ca: 55000,  proba: 90, statut: "signe", date: "2025-06-01", note: "Signature le 28 mai" },
];

const INIT_FINANCES = {
  caObj: 0, caReal: 0, caEnc: 0, caYtd: 0, caAnn: 0,
  solde: 0, dettes: 0,
  sal: 0, loyer: 0, assur: 0, compta: 0, veh: 0, outil: 0, div: 0,
  mat: 0, st: 0, primes: 0,
};

const MONTH_PREV_LABEL = 'Mars 2026';
const MONTH_CURR_LABEL = 'Avril 2026';

const INIT_CR_ROWS = [
  { section: 'ACTIVITÉ', label: 'Travaux', prev: 209090.78, curr: 165006.27 },
  { section: 'ACTIVITÉ', label: 'Avancement de chantiers', prev: -22471.42, curr: 4122.01 },
  { section: 'ACTIVITÉ', label: 'Variation stock travaux en cours', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Matières premières directes', prev: 42321.71, curr: 57246.22 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Variation de stock', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: "Achats d'études et prestations de services", prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Sous-traitance', prev: 4740.00, curr: 10006.90 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Sous-traitance études', prev: 0, curr: 5731.07 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Carburant', prev: 3242.56, curr: 4915.36 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Locations mobilières', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Entretien matériel et outillage', prev: 73.78, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Frais de chantier repas', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Compte prorata chantiers', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Voyages et déplacements', prev: 270.45, curr: 528.55 },
  { section: 'CHARGES DIRECTES VARIABLES', label: 'Personnel intérimaire', prev: 0, curr: 0 },
  { section: 'CHARGES DIRECTES FIXES', label: 'MO Travaux', prev: 54199.68, curr: 72114.27 },
  { section: 'CHARGES DIRECTES FIXES', label: 'Outillage', prev: 169.03, curr: 672.37 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Pharmacie', prev: 0, curr: 0 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Médecine du travail', prev: 289.14, curr: 289.14 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Frais généraux', prev: 28361.29, curr: 34682.14 },
  { section: 'FRAIS GÉNÉRAUX', label: 'Appointements et CS "MO indirecte"', prev: 27557.55, curr: 37805.37 },
  { section: 'DOTATIONS', label: 'Dotations aux amortissements', prev: 0, curr: 0 },
];

const INIT_FG_ROWS = [
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606630', label: 'Eau', prev: 0, curr: 0 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606100-631-632', label: 'Électricité - gaz - Air liquide', prev: 603.97, curr: 756.79 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606400', label: 'Fournitures administratives', prev: 181.46, curr: 181.46 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606300', label: 'Vêtements de travail', prev: 0, curr: 12.46 },
  { section: '60 - ACHATS MATIÈRES ET FOURNITURES', code: '606310', label: 'Déchets - ordures', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613200', label: 'Locations immobilières', prev: 8240.00, curr: 9920.00 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613210', label: 'Location Box', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '613510', label: 'Location véhicules', prev: 3210.62, curr: 4494.35 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '614000', label: 'Charges locatives', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615200', label: 'Entretien local', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615500', label: 'Entretien vêtements de travail', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615532', label: 'Entretien matériel de transport', prev: 0, curr: 0 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615600', label: 'Maintenance', prev: 475.00, curr: 475.00 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '615610', label: 'Abonnements logiciels', prev: 1213.89, curr: 1600.05 },
  { section: '61 - SERVICES EXTÉRIEURS', code: '616100', label: 'Assurances', prev: 3514.68, curr: 5667.77 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '622', label: "Personnel extérieur à l'entreprise", prev: 5888.75, curr: 6396.25 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '622600', label: 'Honoraires', prev: 3579.96, curr: 3154.96 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '623400', label: 'Dons, pourboires, cadeaux', prev: 18.36, curr: 18.36 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '625700', label: 'Réceptions', prev: 161.73, curr: 200.90 },
  { section: '62 - AUTRES SERVICES EXTÉRIEURS', code: '626200', label: 'Téléphone', prev: 107.49, curr: 143.32 },
  { section: '63 - IMPÔTS ET TAXES', code: '631200', label: "Taxe d'apprentissage", prev: 269.59, curr: 393.88 },
  { section: '63 - IMPÔTS ET TAXES', code: '633300', label: 'Formation organismes', prev: 679.79, curr: 978.59 },
  { section: '63 - IMPÔTS ET TAXES', code: '635111', label: 'Cotisation foncière des entreprises', prev: 216.00, curr: 288.00 },
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

const PhaseTrack = ({ phase, T }) => (
  <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
    {PHASES.map((p, i) => (
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

// ─── MODALES ─────────────────────────────────────────────────────────────────
const BLANK_CHANTIER = { nom: '', debut: '', livraisonInit: '', livraisonPrev: '', avR: 0, avP: 0, phase: 0, budMO: 0, moC: 0, budMat: 0, matC: 0, ca: 0, mv: 0, mr: 0, prime: 300, seuil: 25, comp: [], cr: false, note: '', lastUpdated: null };

function NewChantierModal({ open, onClose, onSave, T, acc }) {
  const [f, setF] = useState({ ...BLANK_CHANTIER, compStr: '' });
  const u = k => v => setF(p => ({ ...p, [k]: v }));
  const save = () => {
    if (!f.nom.trim()) { alert('Nom requis'); return; }
    onSave({ ...f, comp: f.compStr.split(',').map(s => s.trim()).filter(Boolean), lastUpdated: todayISO() });
    setF({ ...BLANK_CHANTIER, compStr: '' });
  };
  return (
    <Modal open={open} onClose={onClose} T={T} acc={acc} title="🏗️ Nouveau Chantier" footer={
      <>
        <Btn onClick={onClose} color="ghost" T={T} acc={acc}>Annuler</Btn>
        <Btn onClick={save} color="gold" T={T} acc={acc}>✅ Créer le chantier</Btn>
      </>
    }>
      <FG label="Nom du chantier / client" T={T}>
        <input type="text" value={f.nom} onChange={e => setF(p => ({ ...p, nom: e.target.value }))} placeholder="Ex : Rénovation complète — M. Martin" style={inpCls(T)}/>
      </FG>
      <FR2>
        <FG label="Date démarrage" T={T}><input type="date" value={f.debut} onChange={e => u('debut')(e.target.value)} style={inpCls(T)}/></FG>
        <FG label="Date livraison" T={T}><input type="date" value={f.livraisonInit} onChange={e => setF(p => ({ ...p, livraisonInit: e.target.value, livraisonPrev: e.target.value }))} style={inpCls(T)}/></FG>
      </FR2>
      <FR2>
        <FG label="CA vendu TTC (€)" T={T}><input type="number" value={f.ca || ''} onChange={e => u('ca')(nv(e.target.value))} placeholder="60000" style={inpCls(T)}/></FG>
        <FG label="Marge vendue (%)" T={T}><input type="number" value={f.mv || ''} onChange={e => u('mv')(nv(e.target.value))} placeholder="28" style={inpCls(T)}/></FG>
      </FR2>
      <FR2>
        <FG label="Budget MO prévu (€)" T={T}><input type="number" value={f.budMO || ''} onChange={e => u('budMO')(nv(e.target.value))} style={inpCls(T)}/></FG>
        <FG label="Budget matériaux prévu (€)" T={T}><input type="number" value={f.budMat || ''} onChange={e => u('budMat')(nv(e.target.value))} style={inpCls(T)}/></FG>
      </FR2>
      <FR2>
        <FG label="Prime chantier prévue (€)" T={T}><input type="number" value={f.prime || ''} onChange={e => u('prime')(nv(e.target.value))} placeholder="300" style={inpCls(T)}/></FG>
        <FG label="Seuil prime — marge min (%)" T={T}><input type="number" value={f.seuil || ''} onChange={e => u('seuil')(nv(e.target.value))} placeholder="25" style={inpCls(T)}/></FG>
      </FR2>
      <FG label="Responsable / note MO chantier (facultatif)" T={T}>
        <input type="text" value={f.compStr} onChange={e => setF(p => ({ ...p, compStr: e.target.value }))} placeholder="Ex : Loris / point MO à suivre" style={inpCls(T)}/>
      </FG>
    </Modal>
  );
}

function UpdateModal({ open, chantier, onClose, onSave, onArchive, T, acc }) {
  const [f, setF] = useState({});
  useEffect(() => { if (chantier) setF({ ...chantier, compStr: (chantier.comp || []).join(', ') }); }, [chantier]);
  if (!open || !chantier) return null;
  const u = k => v => setF(p => ({ ...p, [k]: v }));
  const save = () => { onSave({ ...f, comp: (f.compStr || '').split(',').map(s => s.trim()).filter(Boolean), lastUpdated: todayISO() }); };
  const title = chantier.nom.split('—')[0].trim();
  return (
    <Modal open={open} onClose={onClose} T={T} acc={acc} title={`📝 ${title}`} footer={
      <>
        <Btn onClick={onClose} color="ghost" T={T} acc={acc}>Annuler</Btn>
        <Btn onClick={() => onArchive(chantier.id)} color="green" T={T} acc={acc}>📦 Archiver</Btn>
        <Btn onClick={save} color="gold" T={T} acc={acc}>💾 Enregistrer</Btn>
      </>
    }>
      <MSec T={T}>📊 Avancement & Jalons</MSec>
      <FR2>
        <FG label="Avancement réel (%)" T={T}><input type="number" value={f.avR || 0} onChange={e => u('avR')(nv(e.target.value))} min="0" max="100" style={inpCls(T)}/></FG>
        <FG label="Avancement prévu (%)" T={T}><input type="number" value={f.avP || 0} onChange={e => u('avP')(nv(e.target.value))} min="0" max="100" style={inpCls(T)}/></FG>
      </FR2>
      <FG label="Phase en cours" T={T}>
        <select value={f.phase || 0} onChange={e => u('phase')(parseInt(e.target.value))} style={{ ...inpCls(T), cursor: 'pointer' }}>
          {PHASES.map((p, i) => <option key={i} value={i}>{i} — {p}</option>)}
        </select>
      </FG>
      <MSec T={T}>💰 Finances chantier</MSec>
      <FR2>
        <FG label="MO consommée à date (€)" T={T}><input type="number" value={f.moC || ''} onChange={e => u('moC')(nv(e.target.value))} style={inpCls(T)}/></FG>
        <FG label="Matériaux consommés (€)" T={T}><input type="number" value={f.matC || ''} onChange={e => u('matC')(nv(e.target.value))} style={inpCls(T)}/></FG>
      </FR2>
      <FR2>
        <FG label="Marge réelle estimée (%)" T={T}><input type="number" step="0.1" value={f.mr || ''} onChange={e => u('mr')(nv(e.target.value))} style={inpCls(T)}/></FG>
        <FG label="CA vendu TTC (€)" T={T}><input type="number" value={f.ca || ''} onChange={e => u('ca')(nv(e.target.value))} style={inpCls(T)}/></FG>
      </FR2>
      <MSec T={T}>📅 Planning & suivi</MSec>
      <FR2>
        <FG label="Date livraison prévisionnelle" T={T}><input type="date" value={f.livraisonPrev || ''} onChange={e => u('livraisonPrev')(e.target.value)} style={inpCls(T)}/></FG>
        <FG label="CR reçu ?" T={T}>
          <select value={f.cr ? '1' : '0'} onChange={e => u('cr')(e.target.value === '1')} style={{ ...inpCls(T), cursor: 'pointer' }}>
            <option value="1">✅ Oui — reçu</option>
            <option value="0">⏳ Non — manquant</option>
          </select>
        </FG>
      </FR2>
      <FG label="Responsable / note MO chantier" T={T}><input type="text" value={f.compStr || ''} onChange={e => setF(p => ({ ...p, compStr: e.target.value }))} placeholder="Ex : Loris / point MO à suivre" style={inpCls(T)}/></FG>
      <FG label="Note / observation" T={T}><input type="text" value={f.note || ''} onChange={e => u('note')(e.target.value)} placeholder="Ex : En attente livraison carrelage…" style={inpCls(T)}/></FG>
    </Modal>
  );
}

function PipelineModal({ open, item, onClose, onSave, T, acc }) {
  const blank = { nom: '', ca: 0, proba: 50, statut: 'prospect', date: '', note: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { setF(item ? { ...item } : { ...blank }); }, [item, open]);
  const u = k => v => setF(p => ({ ...p, [k]: v }));
  const isNew = !item;
  return (
    <Modal open={open} onClose={onClose} T={T} acc={acc} title={isNew ? '🔖 Nouvelle Opportunité' : `📝 ${f.nom}`} footer={
      <>
        <Btn onClick={onClose} color="ghost" T={T} acc={acc}>Annuler</Btn>
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
function ChantiersTab({ chantiers, archives, onUpdate, onArchive, onRestore, T, acc }) {
  const [archOpen, setArchOpen] = useState(false);
  const alerts = chantiers.filter(c => gSt(c) !== 'green');
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
                <th></th>
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
                  <tr key={c.id}>
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
                      <PhaseTrack phase={c.phase || 0} T={T}/>
                      <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 3 }}>
                        Phase : {PHASES[c.phase] || '—'} <span style={{ color: avColor }}>({avD >= 0 ? '+' : ''}{avD}pts)</span>
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
                      <Badge c={matE > 10 ? 'red' : matE > 4 ? 'orange' : 'green'}>{matE > 0 ? '+' : ''}{matE.toFixed(1)}%</Badge>
                      <div style={{ fontSize: 9, color: T?.textMuted || '#5b6a8a', marginTop: 2 }}>{fmt(c.matC)} / {fmt(c.budMat)}</div>
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
                    <td><Badge c={c.cr ? 'green' : 'red'}>{c.cr ? '✅ Reçu' : '⏳ Manquant'}</Badge></td>
                    <td><UpdBadge d={c.lastUpdated} T={T}/></td>
                    <td><Btn onClick={() => onUpdate(c)} sm color="ghost" T={T} acc={acc}>📝 MAJ</Btn></td>
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

// ─── ONGLET ANALYSES (TODO) ──────────────────────────────────────────────────
function AnalysisTodoTab({ T, acc }) {
  const storageKey = 'profero-dashboard-analyse-todo-v1';
  const [done, setDone] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); }
    catch (_e) { return {}; }
  });
  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(done)); } catch (_e) {} }, [done]);
  const toggle = id => setDone(p => ({ ...p, [id]: !p[id] }));
  const total = ANALYSE_TODO_GROUPS.reduce((s, g) => s + g.items.length, 0);
  const complete = ANALYSE_TODO_GROUPS.reduce((s, g) => s + g.items.filter(i => done[i.id]).length, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="✅ Todo des analyses" right={<Badge c={complete === total ? 'green' : complete > 0 ? 'orange' : 'muted'}>{complete}/{total} stickés</Badge>}/>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 14 }}>
          {ANALYSE_TODO_GROUPS.map(group => {
            const groupDone = group.items.filter(i => done[i.id]).length;
            return (
              <div key={group.key} style={{ border: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, borderRadius: RADIUS.lg, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T?.border || 'rgba(255,255,255,0.07)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 800, color: acc?.accent || '#FFC200', fontSize: 12 }}>{group.icon} {group.title}</div>
                  <Badge c={groupDone === group.items.length ? 'green' : 'muted'}>{groupDone}/{group.items.length}</Badge>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.items.map(item => (
                    <button key={item.id} onClick={() => toggle(item.id)} style={{
                      cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${done[item.id] ? 'rgba(52,209,136,.35)' : (T?.border || 'rgba(255,255,255,0.07)')}`,
                      borderRadius: RADIUS.md, padding: '10px 11px',
                      background: done[item.id] ? 'rgba(52,209,136,.10)' : 'rgba(255,255,255,.025)',
                      color: done[item.id] ? (T?.text || '#f0f0f0') : (T?.textSub || '#9aa5c0'),
                      display: 'flex', alignItems: 'flex-start', gap: 9, transition: 'all .18s', fontFamily: 'inherit',
                    }}>
                      <span style={{ fontSize: 15, lineHeight: 1.1 }}>{done[item.id] ? '✅' : '⬜'}</span>
                      <span style={{ flex: 1, fontSize: 11, lineHeight: 1.35 }}>{item.label}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: done[item.id] ? '#34d188' : (T?.textMuted || '#5b6a8a'), whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{done[item.id] ? 'Stické' : 'À faire'}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card T={T}>
        <CardHdr T={T} acc={acc} title="🎯 Règle d'usage" right={<span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Stickers mémorisés dans le navigateur</span>}/>
        <div style={{ padding: 16, color: T?.textSub || '#9aa5c0', fontSize: 12, lineHeight: 1.6 }}>
          Chaque analyse peut être stickée une fois réalisée. L'objectif est d'avoir une lecture simple : quotidien pour la maîtrise opérationnelle, hebdomadaire pour le pilotage chantier / trésorerie, mensuel pour la décision de direction.
        </div>
      </Card>
    </div>
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
const FINANCE_MONTHS = [
  { key: 'jan', label: 'Janvier 2026' },
  { key: 'feb', label: 'Février 2026' },
  { key: 'mar', label: MONTH_PREV_LABEL },
  { key: 'apr', label: MONTH_CURR_LABEL },
  { key: 'may', label: 'Mai 2026' },
];
const initMonthlyRows = rows => rows.map(r => ({ ...r, monthly: { jan: 0, feb: 0, mar: nv(r.prev), apr: nv(r.curr), may: 0 } }));
const monthValue = (row, key) => nv(row.monthly?.[key]);
const pctCA = (value, ca) => ca ? (value / ca) * 100 : 0;

function SocieteFinanceTab({ T, acc }) {
  const [crRows, setCrRows] = useState(() => initMonthlyRows(INIT_CR_ROWS));
  const [fgRows, setFgRows] = useState(() => initMonthlyRows(INIT_FG_ROWS));
  const [selectedMonth, setSelectedMonth] = useState('apr');
  const selectedIdx = Math.max(FINANCE_MONTHS.findIndex(m => m.key === selectedMonth), 0);
  const visibleMonths = FINANCE_MONTHS.slice(0, selectedIdx + 1);
  const previousMonth = FINANCE_MONTHS[selectedIdx - 1];
  const currentMonth = FINANCE_MONTHS[selectedIdx];
  const updCR = (idx, key, val) => setCrRows(rows => rows.map((r, i) => i === idx ? { ...r, monthly: { ...r.monthly, [key]: val } } : r));
  const updFG = (idx, key, val) => setFgRows(rows => rows.map((r, i) => i === idx ? { ...r, monthly: { ...r.monthly, [key]: val } } : r));
  const sectionsCR = ['ACTIVITÉ', 'CHARGES DIRECTES VARIABLES', 'CHARGES DIRECTES FIXES', 'FRAIS GÉNÉRAUX', 'DOTATIONS'];
  const sectionsFG = [...new Set(fgRows.map(r => r.section))];
  const rowBySection = (rows, section) => rows.map((r, i) => ({ ...r, idx: i })).filter(r => r.section === section);
  const sectionTotal = (rows, section, key) => rows.filter(r => r.section === section).reduce((s, r) => s + monthValue(r, key), 0);
  const rowLabelTotal = (labels, key) => crRows.filter(r => labels.includes(r.label)).reduce((s, r) => s + monthValue(r, key), 0);
  const totals = key => {
    const activite = sectionTotal(crRows, 'ACTIVITÉ', key);
    const cdv = sectionTotal(crRows, 'CHARGES DIRECTES VARIABLES', key);
    const margeVariable = activite - cdv;
    const cdf = sectionTotal(crRows, 'CHARGES DIRECTES FIXES', key);
    const margeDirecte = margeVariable - cdf;
    const fg = sectionTotal(crRows, 'FRAIS GÉNÉRAUX', key);
    const dot = sectionTotal(crRows, 'DOTATIONS', key);
    const resultat = margeDirecte - fg - dot;
    const mo = rowLabelTotal(['MO Travaux', 'Personnel intérimaire', 'Appointements et CS "MO indirecte"'], key);
    const materiaux = rowLabelTotal(['Matières premières directes', 'Variation de stock'], key);
    return { activite, cdv, margeVariable, cdf, margeDirecte, fg, dot, resultat, mo, materiaux };
  };
  const ytd = visibleMonths.reduce((acc, m) => {
    const t = totals(m.key);
    Object.keys(t).forEach(k => acc[k] = (acc[k] || 0) + t[k]);
    return acc;
  }, {});
  const current = totals(currentMonth.key);
  const prev = previousMonth ? totals(previousMonth.key) : null;
  const monthDelta = key => current[key] - (prev ? prev[key] : 0);
  const fgYtdDetailed = visibleMonths.reduce((s, m) => s + fgRows.reduce((ss, r) => ss + monthValue(r, m.key), 0), 0);
  const fgCurrentDetailed = fgRows.reduce((s, r) => s + monthValue(r, currentMonth.key), 0);
  const fgPrevDetailed = previousMonth ? fgRows.reduce((s, r) => s + monthValue(r, previousMonth.key), 0) : 0;

  const SummaryCard = ({ label, value, sub, color }) => (
    <Card T={T}>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: T?.textMuted || '#5b6a8a', marginBottom: 8 }}>{label}</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: T?.textSub || '#9aa5c0', marginTop: 5 }}>{sub}</div>}
      </div>
    </Card>
  );
  const evoText = (key, inverse = false) => {
    const d = monthDelta(key);
    const good = inverse ? d <= 0 : d >= 0;
    return <span style={{ color: good ? '#34d188' : '#ff625f' }}>Évolution {previousMonth ? `${currentMonth.label} vs ${previousMonth.label}` : currentMonth.label} : {d > 0 ? '+' : ''}{fmt(d, 2)}</span>;
  };
  const ytdRowTotal = row => visibleMonths.reduce((s, m) => s + monthValue(row, m.key), 0);

  const sectionStyle = { background: 'rgba(255,194,0,0.10)', color: acc?.accent || '#FFC200', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10 };
  const totalStyle = { background: 'rgba(255,194,0,0.13)', fontWeight: 900, color: T?.text || '#f0f0f0' };
  const resultStyle = { background: 'rgba(255,194,0,0.18)', fontWeight: 900 };

  const TotalLine = ({ label, calc, strong, color }) => (
    <tr style={strong ? resultStyle : totalStyle}>
      <td style={{ fontWeight: 900 }}>{label}</td>
      {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color }}>{fmt(calc(m.key), 2)}</td>)}
      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color, fontWeight: 900 }}>{fmt(visibleMonths.reduce((s, m) => s + calc(m.key), 0), 2)}</td>
    </tr>
  );
  const PctLine = ({ label, numCalc, denomCalc }) => (
    <tr style={totalStyle}>
      <td>{label}</td>
      {visibleMonths.map(m => <td key={m.key} style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right' }}>{fmtPct(pctCA(numCalc(m.key), denomCalc(m.key)), 2)}</td>)}
      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right' }}>{fmtPct(pctCA(visibleMonths.reduce((s, m) => s + numCalc(m.key), 0), visibleMonths.reduce((s, m) => s + denomCalc(m.key), 0)), 2)}</td>
    </tr>
  );
  const MonthInputs = ({ row, onChange }) => visibleMonths.map(m => (
    <td key={m.key} style={{ textAlign: 'right' }}>
      <input type="number" value={Number.isFinite(monthValue(row, m.key)) ? monthValue(row, m.key) : ''} onChange={e => onChange(row.idx, m.key, nv(e.target.value))} style={{ ...edtCls(T), width: 92 }}/>
    </td>
  ));
  const monthHeader = visibleMonths.map(m => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14 }}>
        <SummaryCard label="CA depuis début d'année" value={fmt(ytd.activite || 0, 2)} color={acc?.accent || '#FFC200'} sub={evoText('activite')}/>
        <SummaryCard label="Frais généraux YTD" value={fmt(ytd.fg || 0, 2)} color="#ff9a4d" sub={evoText('fg', true)}/>
        <SummaryCard label="MO YTD" value={fmt(ytd.mo || 0, 2)} color="#5b9cf6" sub={evoText('mo', true)}/>
        <SummaryCard label="Matériaux YTD" value={fmt(ytd.materiaux || 0, 2)} color="#FFD740" sub={evoText('materiaux', true)}/>
        <SummaryCard label="Résultat d'exploitation YTD" value={fmt(ytd.resultat || 0, 2)} color={(ytd.resultat || 0) >= 0 ? '#34d188' : '#ff625f'} sub={evoText('resultat')}/>
      </div>

      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📊 Point financier" right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Classement par mois</span>
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ ...inpCls(T), width: 160, padding: '7px 10px', cursor: 'pointer' }}>
              {FINANCE_MONTHS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
        }/>
        <div style={{ overflowX: 'auto' }}>
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Compte de résultat</th>
                {monthHeader}
                <th style={{ textAlign: 'right' }}>Total YTD</th>
              </tr>
            </thead>
            <tbody>
              {sectionsCR.map(section => (
                <React.Fragment key={section}>
                  <tr style={sectionStyle}>
                    <td colSpan={visibleMonths.length + 2}>{section}</td>
                  </tr>
                  {rowBySection(crRows, section).map(row => (
                    <tr key={row.idx}>
                      <td style={{ fontSize: 12, color: T?.text || '#f0f0f0' }}>{row.label}</td>
                      <MonthInputs row={row} onChange={updCR}/>
                      <td style={{ fontFamily: "'DM Mono',monospace", textAlign: 'right', color: T?.textSub || '#9aa5c0' }}>{fmt(ytdRowTotal(row), 2)}</td>
                    </tr>
                  ))}
                  {section === 'ACTIVITÉ' && <TotalLine label="TOTAL ACTIVITÉ" calc={key => totals(key).activite} color={acc?.accent || '#FFC200'}/>}
                  {section === 'CHARGES DIRECTES VARIABLES' && (
                    <>
                      <TotalLine label="TOTAL CDV" calc={key => totals(key).cdv} color="#ff9a4d"/>
                      <TotalLine label="MARGE SUR COÛT VARIABLE" calc={key => totals(key).margeVariable} color={acc?.accent || '#FFC200'}/>
                      <PctLine label="% DU CA" numCalc={key => totals(key).margeVariable} denomCalc={key => totals(key).activite}/>
                    </>
                  )}
                  {section === 'CHARGES DIRECTES FIXES' && (
                    <>
                      <TotalLine label="TOTAL CDF" calc={key => totals(key).cdf} color="#ff9a4d"/>
                      <TotalLine label="MARGE SUR COÛT DIRECT" calc={key => totals(key).margeDirecte} color={acc?.accent || '#FFC200'}/>
                      <PctLine label="% DU CA" numCalc={key => totals(key).margeDirecte} denomCalc={key => totals(key).activite}/>
                    </>
                  )}
                  {section === 'FRAIS GÉNÉRAUX' && (
                    <>
                      <TotalLine label="TOTAL FG" calc={key => totals(key).fg} color="#ff9a4d"/>
                      <PctLine label="% DU CA" numCalc={key => totals(key).fg} denomCalc={key => totals(key).activite}/>
                    </>
                  )}
                  {section === 'DOTATIONS' && <TotalLine label="RÉSULTAT D'EXPLOITATION" calc={key => totals(key).resultat} strong color={(ytd.resultat || 0) >= 0 ? '#34d188' : '#ff625f'}/>}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card T={T}>
        <CardHdr T={T} acc={acc} title="📒 Frais généraux détaillés par mois" right={<span style={{ fontSize: 10, color: T?.textSub || '#9aa5c0' }}>Lecture par comptes comptables</span>}/>
        <div style={{ overflowX: 'auto' }}>
          <table className="da-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>N°</th>
                <th>Libellé</th>
                {monthHeader}
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
                    <tr key={row.idx}>
                      <td style={{ fontFamily: "'DM Mono',monospace", color: T?.textMuted || '#5b6a8a' }}>{row.code}</td>
                      <td style={{ fontSize: 12, color: T?.text || '#f0f0f0' }}>{row.label}</td>
                      <MonthInputs row={row} onChange={updFG}/>
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
        <SummaryCard label="Mois sélectionné" value={currentMonth.label} color={acc?.accent || '#FFC200'} sub={`Résultat mensuel : ${fmt(current.resultat, 2)}`}/>
        <SummaryCard label="FG détaillés mois" value={fmt(fgCurrentDetailed, 2)} color="#ff9a4d" sub={`Évolution : ${fgCurrentDetailed - fgPrevDetailed > 0 ? '+' : ''}${fmt(fgCurrentDetailed - fgPrevDetailed, 2)}`}/>
        <SummaryCard label="Poids FG / CA YTD" value={fmtPct(pctCA(ytd.fg || 0, ytd.activite || 0), 2)} color="#5b9cf6" sub="Lecture depuis le 1er janvier"/>
      </div>
    </div>
  );
}

// ─── PAGE ROOT ───────────────────────────────────────────────────────────────
const TABS = [
  { key: 'chantiers',      label: '🏗️ Chantiers' },
  { key: 'pipeline',       label: '🔖 Pipeline' },
  { key: 'analyseSociete', label: '📊 Point financier' },
  { key: 'primes',         label: '🎯 Primes' },
  { key: 'todoAnalyses',   label: '✅ Analyses' },
  { key: 'finances',       label: '💰 Trésorerie' },
];

export default function DashboardAnalyse({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [chantiers, setChantiers] = useState(INIT_CHANTIERS);
  const [archives, setArchives] = useState(INIT_ARCHIVES);
  const [pipeline, setPipeline] = useState(INIT_PIPELINE);
  const [finances, setFinances] = useState(INIT_FINANCES);
  const [activeTab, setActiveTab] = useState('chantiers');
  const [newModal, setNewModal] = useState(false);
  const [updateModal, setUpdateModal] = useState({ open: false, chantier: null });
  const [pipeModal, setPipeModal] = useState({ open: false, item: null });

  const totalCA      = useMemo(() => chantiers.reduce((s, c) => s + c.ca, 0), [chantiers]);
  const avgMV        = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + c.mv, 0) / chantiers.length : 0, [chantiers]);
  const avgMR        = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + c.mr, 0) / chantiers.length : 0, [chantiers]);
  const alertCount   = useMemo(() => chantiers.filter(c => gSt(c) !== 'green').length, [chantiers]);
  const globalRatio  = useMemo(() => chantiers.length ? chantiers.reduce((s, c) => s + ratioMO(c), 0) / chantiers.length : 0, [chantiers]);
  const pipeTotal    = useMemo(() => pipeline.reduce((s, p) => s + p.ca * (p.proba / 100), 0), [pipeline]);
  const health = alertCount === 0 ? 'good' : alertCount <= 2 ? 'warn' : 'bad';

  const addChantier = f => {
    setChantiers(p => [...p, { ...f, id: Math.max(...p.map(c => c.id), 0) + 1 }]);
    setNewModal(false);
  };
  const updateChantier = f => {
    setChantiers(p => p.map(c => c.id === f.id ? f : c));
    setUpdateModal({ open: false, chantier: null });
  };
  const archiveChantier = id => {
    const c = chantiers.find(ch => ch.id === id);
    if (!c || !window.confirm(`Archiver "${c.nom.split('—')[0].trim()}" ?`)) return;
    setArchives(p => [{ ...c, archivedAt: todayISO() }, ...p]);
    setChantiers(p => p.filter(ch => ch.id !== id));
    setUpdateModal({ open: false, chantier: null });
  };
  const restoreChantier = id => {
    const a = archives.find(x => x.id === id);
    if (!a || !window.confirm(`Restaurer "${a.nom.split('—')[0].trim()}" ?`)) return;
    setChantiers(p => [...p, { ...a, archivedAt: undefined }]);
    setArchives(p => p.filter(x => x.id !== id));
  };
  const savePipeline = f => {
    if (!f.nom.trim()) return;
    setPipeline(p => f.id && p.find(x => x.id === f.id) ? p.map(x => x.id === f.id ? f : x) : [...p, { ...f, id: Date.now() }]);
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
        .da-table thead th { padding: 10px 12px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${T?.textMuted || '#5b6a8a'}; background: rgba(255,255,255,0.025); border-bottom: 1px solid ${T?.border || 'rgba(255,255,255,0.07)'}; text-align: left; white-space: nowrap; }
        .da-table tbody td { padding: 11px 12px; border-bottom: 1px solid ${T?.border || 'rgba(255,255,255,0.05)'}; vertical-align: middle; }
        .da-table tbody tr:last-child td { border-bottom: none; }
        .da-table tbody tr:hover td { background: rgba(255,194,0,0.03); }
      `}</style>

      <NewChantierModal open={newModal} onClose={() => setNewModal(false)} onSave={addChantier} T={T} acc={acc}/>
      <UpdateModal open={updateModal.open} chantier={updateModal.chantier} onClose={() => setUpdateModal({ open: false, chantier: null })} onSave={updateChantier} onArchive={archiveChantier} T={T} acc={acc}/>
      <PipelineModal open={pipeModal.open} item={pipeModal.item} onClose={() => setPipeModal({ open: false, item: null })} onSave={savePipeline} T={T} acc={acc}/>

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
        <Btn onClick={() => setNewModal(true)} color="gold" T={T} acc={acc}>＋ Chantier</Btn>
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
          { label: 'Pipeline CA pondéré',    v: fmt(pipeTotal),       c: acc.accent, sub: `${pipeline.length} opportunité${pipeline.length > 1 ? 's' : ''} en cours` },
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
        {activeTab === 'chantiers'      && <ChantiersTab     chantiers={chantiers} archives={archives} onUpdate={c => setUpdateModal({ open: true, chantier: c })} onArchive={archiveChantier} onRestore={restoreChantier} T={T} acc={acc}/>}
        {activeTab === 'pipeline'       && <PipelineTab      pipeline={pipeline} onAdd={() => setPipeModal({ open: true, item: null })} onEdit={item => setPipeModal({ open: true, item })} T={T} acc={acc}/>}
        {activeTab === 'analyseSociete' && <SocieteFinanceTab T={T} acc={acc}/>}
        {activeTab === 'primes'         && <PrimesTab        chantiers={chantiers} T={T} acc={acc}/>}
        {activeTab === 'todoAnalyses'   && <AnalysisTodoTab  T={T} acc={acc}/>}
        {activeTab === 'finances'       && <FinancesTab      fin={finances} setFin={setFinances} T={T} acc={acc}/>}
      </div>
    </div>
  );
}
