import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection
} from "./_shared";

function getProjetSimFinance(p = {}) {
  const d = p?.donnees || {};
  const inputs = d.inputs || {};
  const selects = d.selects || {};
  const lots = Array.isArray(d.lots) ? d.lots.filter(l => l && l.type && l.type !== "Sélectionner") : [];
  const prixNegocie = Number(inputs.prixNegocie || 0);
  const tauxNotaire = Number(inputs.tauxNotaire ?? 0.08);
  const fraisNotaire = prixNegocie * tauxNotaire;
  const budgetTravaux = Number(inputs.budgetTravaux || 0);
  const honoraires = Number(inputs.honoraires || 0);
  const enedis = Number(inputs.enedis || 0);
  const coutTotal = prixNegocie + fraisNotaire + budgetTravaux + honoraires + enedis;
  const loyersMensuels = lots.reduce((s, l) => s + (Number(l.loyer) || 0), 0);
  const loyersAnnuels = loyersMensuels * 12;
  const gestionActive = !!selects.gestionActive;
  const gestionAnnuelle = gestionActive
    ? lots.reduce((s, l) => s + (GESTION_PRICES[l.type] || 0), 0) * 12
    : 0;
  const charges = Number(inputs.taxeFonciere || 0)
    + Number(inputs.assurance || 0)
    + Number(inputs.compta || 0)
    + Number(inputs.provisions || 0)
    + gestionAnnuelle;
  const mensualite = pmt(
    Math.max(0, coutTotal - (Number(inputs.apport1) || 0)),
    Number(inputs.taux1 || 0),
    Number(inputs.duree1 || 0)
  );
  const rendementBrut = coutTotal > 0 ? (loyersAnnuels / coutTotal) * 100 : 0;
  const rendementNet = coutTotal > 0 ? ((loyersAnnuels - charges) / coutTotal) * 100 : 0;
  const cashflowMensuel = loyersMensuels ? ((loyersAnnuels - charges) / 12) - mensualite : 0;
  return { coutTotal, loyersMensuels, loyersAnnuels, rendementBrut, rendementNet, cashflowMensuel, nbLots:lots.length };
}


const FINANCE_CLIENT_PROB_DEFAULTS = {
  prospect: 0.20,
  actif: 0.75,
  inactif: 0.15,
  termine: 1,
};

function numFinance(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function firstPositive(obj, keys=[]) {
  for (const k of keys) {
    const n = numFinance(obj?.[k]);
    if (n > 0) return n;
  }
  return 0;
}

function includesAny(v, words=[]) {
  const n = normTxt(v || "");
  return words.some(w => n.includes(normTxt(w)));
}

function getClientPipelineProbability(c={}) {
  if (c.date_signature) return 1;
  if (includesAny(c.etape, ["signature contrat"])) return 0.85;
  if (includesAny(c.etape, ["envoi des documents", "stratégie", "strategie"])) return 0.65;
  if (includesAny(c.etape, ["recherche", "visites", "analyse", "présentation", "presentation"])) return 0.55;
  if (includesAny(c.etape, ["offre", "compromis", "financement", "notaire"])) return 0.90;
  if (c.statut === "Actif") return FINANCE_CLIENT_PROB_DEFAULTS.actif;
  if (c.statut === "Inactif") return FINANCE_CLIENT_PROB_DEFAULTS.inactif;
  if (c.statut === "Terminé") return FINANCE_CLIENT_PROB_DEFAULTS.termine;
  return FINANCE_CLIENT_PROB_DEFAULTS.prospect;
}

function getOffreProbability(statut="") {
  if (includesAny(statut, ["compromis", "notaire", "financement", "conditions suspensives"])) return 1;
  if (includesAny(statut, ["acceptée", "acceptee", "accepté", "accepte"])) return 0.80;
  if (includesAny(statut, ["envoyée", "envoyee", "en cours", "proposé", "propose", "intéressé", "interesse"])) return 0.50;
  if (includesAny(statut, ["à faire", "a faire", "possible", "visité", "visite", "à analyser", "a analyser"])) return 0.25;
  if (includesAny(statut, ["refus", "aband", "perdu"])) return 0;
  return 0.35;
}

function getClientEncaisse(c={}) {
  return firstPositive(c, [
    "ca_encaisse_ht", "ca_encaisse", "honoraires_encaisse_ht", "honoraires_encaisse",
    "honoraires_fixes_encaisse_ht", "montant_encaisse", "paiement_recu", "honoraires_payes",
    "acompte_encaisse", "acompte_ht"
  ]);
}

function getStageDefaultDays(c={}) {
  if (c.date_signature) return 15;
  if (includesAny(c.etape, ["signature contrat"])) return 15;
  if (c.statut === "Actif") return 30;
  if (c.statut === "Prospect") return 60;
  return 90;
}

function getDueDateOrDefault(dateValue, days=30) {
  if (dateValue) {
    const d = new Date(dateValue);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function addToForecastBuckets(buckets, amount, dueDate) {
  const n = numFinance(amount);
  if (n <= 0) return;
  const days = daysBetween(new Date(), dueDate);
  if (!Number.isFinite(days)) { buckets.d90 += n; return; }
  if (days <= 30) buckets.d30 += n;
  if (days <= 60) buckets.d60 += n;
  if (days <= 90) buckets.d90 += n;
}

function getClientFirstProjectDate(clientId, propositions=[], projets=[]) {
  const dates = [];
  propositions.filter(p => p.client_id === clientId).forEach(p => { if (p.date_proposition || p.created_at) dates.push(new Date(p.date_proposition || p.created_at)); });
  projets.filter(p => p.client_id === clientId).forEach(p => { if (p.created_at || p.updated_at) dates.push(new Date(p.created_at || p.updated_at)); });
  const valid = dates.filter(d => !Number.isNaN(d.getTime())).sort((a,b)=>a-b);
  return valid[0] || null;
}

function getBienFinanceFromVisite(b={}) {
  const v = b.visite_data || {};
  const fin = v.finance || {};
  return {
    travaux: numFinance(b.prix_travaux || fin.budget_travaux_ttc),
    rendement: numFinance(b.rendement_brut || fin.rendement_brut_calcule || fin.rendement_brut),
    cashflow: numFinance(b.cashflow_estime || fin.cashflow_mensuel || fin.cashflow_mensuel_estime),
    coutTotal: numFinance(b.cout_total || fin.cout_total_operation),
  };
}

function buildFinancePilotageStats({ clients=[], biens=[], propositions=[], projets=[] }) {
  const clientsReels = clients.filter(c => c.statut !== "Prospect");
  const prospects = clients.filter(c => c.statut === "Prospect");
  const clientsActifs = clients.filter(c => c.statut === "Actif");
  const clientsSignes = clientsReels.filter(c => !!c.date_signature);
  const clientsPipeline = clients.filter(c => c.statut !== "Terminé");
  const clientsSansAction = clientsReels.filter(c => !c.prochaine_action && !c.date_prochaine_action);
  const prospectsSansAction = prospects.filter(c => !c.prochaine_action && !c.date_prochaine_action);
  const propByClient = propositions.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const projectByClient = projets.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const clientsAvecProjet = clientsSignes.filter(c => propByClient[c.id] || projectByClient[c.id]);
  const clientsActifsSansProp = clientsActifs.filter(c => !propByClient[c.id] && !projectByClient[c.id]);
  const clientsSignesSansProjet = clientsSignes.filter(c => !propByClient[c.id] && !projectByClient[c.id]);
  const clientsSignesSansBudget = clientsSignes.filter(c => !numFinance(c.budget));
  const clientsSansStrategie = clientsReels.filter(c => !c.etape || includesAny(c.etape, ["signature contrat"]));

  const offresEnvoyees = biens.filter(b => includesAny(b.statut, ["Offre envoyée", "Offre en cours"]));
  const offresAcceptees = biens.filter(b => includesAny(b.statut, ["Offre acceptée", "Compromis", "Financement", "Notaire"]));
  const offresActivesMap = new Map();
  const addOffreActive = (key, amount, source, label, statut, dateRef) => {
    const n = Number(amount) || 0;
    if (!key || n <= 0) return;
    const prob = getOffreProbability(statut);
    if (prob <= 0) return;
    offresActivesMap.set(key, { amount:n, source, label, statut, probability:prob, dateRef });
  };
  biens.forEach(b => {
    const statut = b.statut || "";
    if (Number(b.montant_offre) > 0 && !includesAny(statut, ["Abandonné", "Offre refusée", "Refus"])) {
      addOffreActive(`bien-${b.id}`, b.montant_offre, "Stock", getBienLabel(b), statut || "Offre renseignée", b.date_relance || b.created_at);
    }
  });
  propositions.forEach(p => {
    if (!includesAny(p.statut, ["offre", "proposé", "propose", "intéressé", "interesse", "analyse", "accept"])) return;
    addOffreActive(
      `prop-${p.bien_id || p.id}`,
      p.bien?.montant_offre || p.bien?.prix_vente,
      "Proposition",
      p.bien?.adresse || p.bien?.ville || "Bien proposé",
      p.statut || "Proposition",
      p.date_proposition || p.created_at
    );
  });
  const offresActives = Array.from(offresActivesMap.values());
  const montantOffresCours = offresActives.reduce((s, x) => s + x.amount, 0);
  const montantOffresPondere = offresActives.reduce((s, x) => s + x.amount * x.probability, 0);
  const honorairesConseilBrut = offresActives.length * HONORAIRE_CONSEIL_MOYEN_HT;
  const honorairesConseilPondere = offresActives.reduce((s, x) => s + HONORAIRE_CONSEIL_MOYEN_HT * x.probability, 0);
  const honorairesConseilSignes = offresActives.filter(x => x.probability >= 0.8).length * HONORAIRE_CONSEIL_MOYEN_HT;

  const baseHonorairesSignes = clientsSignes.length * HONORAIRE_BASE_CONTRAT_HT;
  const baseHonorairesPipelineBrut = clientsPipeline.length * HONORAIRE_BASE_CONTRAT_HT;
  const baseHonorairesPipelinePondere = clientsPipeline.reduce((s,c)=>s + HONORAIRE_BASE_CONTRAT_HT * getClientPipelineProbability(c), 0);
  const caSigneTheorique = baseHonorairesSignes + honorairesConseilSignes;
  const caEncaisseDeclare = clients.reduce((s,c)=>s + getClientEncaisse(c), 0);
  const caRestantAEncaisser = Math.max(0, caSigneTheorique - caEncaisseDeclare);
  const caPipelineBrut = baseHonorairesPipelineBrut + honorairesConseilBrut;
  const caPipelinePondere = baseHonorairesPipelinePondere + honorairesConseilPondere;
  const caPotentielTotal = caPipelineBrut;
  const caPotentielRestant = Math.max(0, caPotentielTotal - caSigneTheorique);

  const delaisSignature = clientsSignes
    .map(x => daysBetween(x.date_premier_contact || x.created_at, new Date(x.date_signature)))
    .filter(v => Number.isFinite(v) && v >= 0);
  const delaisSignatureProjet = clientsSignes
    .map(c => {
      const firstProjectDate = getClientFirstProjectDate(c.id, propositions, projets);
      return firstProjectDate ? daysBetween(c.date_signature, firstProjectDate) : null;
    })
    .filter(v => Number.isFinite(v) && v >= 0);
  const delaisOffreRelance = offresActives
    .map(o => o.dateRef ? daysBetween(o.dateRef, new Date()) : null)
    .filter(v => Number.isFinite(v) && v >= 0);

  const simMetrics = projets.map(getProjetSimFinance);
  const simulationsAvecCout = simMetrics.filter(m => m.coutTotal > 0);
  const totalCoutSimule = simMetrics.reduce((s,m)=>s+m.coutTotal,0);
  const totalLoyersAnnuelsSimules = simMetrics.reduce((s,m)=>s+m.loyersAnnuels,0);
  const totalCashflowMensuelSimule = simMetrics.reduce((s,m)=>s+m.cashflowMensuel,0);
  const rendementBrutMoyen = simulationsAvecCout.length
    ? simulationsAvecCout.reduce((s,m)=>s+m.rendementBrut,0) / simulationsAvecCout.length
    : 0;
  const rendementNetMoyen = simulationsAvecCout.length
    ? simulationsAvecCout.reduce((s,m)=>s+m.rendementNet,0) / simulationsAvecCout.length
    : 0;
  const projetsRentables = simMetrics.filter(m => m.coutTotal > 0 && (m.rendementBrut >= 8 || m.cashflowMensuel > 0)).length;
  const projetsNonRentables = simMetrics.filter(m => m.coutTotal > 0 && m.rendementBrut < 8 && m.cashflowMensuel <= 0).length;
  const biensAbandonnes = biens.filter(b => includesAny(b.statut, ["aband", "refus", "perdu"])).length;
  const biensSansTravaux = biens.filter(b => !getBienFinanceFromVisite(b).travaux).length;
  const biensCashflowNegatif = biens.filter(b => getBienFinanceFromVisite(b).cashflow < 0).length;
  const biensRendementFaible = biens.filter(b => {
    const f = getBienFinanceFromVisite(b);
    return f.rendement > 0 && f.rendement < 8;
  }).length;
  const biensSansSimulateur = biens.filter(b => !b.visite_data?.simulateur && !b.visite_data?.finance?.cout_total_operation).length;

  const forecast = { d30:0, d60:0, d90:0 };
  clientsPipeline.forEach(c => {
    const amount = HONORAIRE_BASE_CONTRAT_HT * getClientPipelineProbability(c);
    addToForecastBuckets(forecast, amount, getDueDateOrDefault(c.date_prochaine_action || c.date_signature, getStageDefaultDays(c)));
  });
  offresActives.forEach(o => {
    const amount = HONORAIRE_CONSEIL_MOYEN_HT * o.probability;
    addToForecastBuckets(forecast, amount, getDueDateOrDefault(o.dateRef, o.probability >= .8 ? 30 : 60));
  });

  const offresEnvoyeesEtAcceptees = offresEnvoyees.length + offresAcceptees.length;
  const tauxProjetPresente = clientsSignes.length ? Math.round((clientsAvecProjet.length / clientsSignes.length) * 100) : 0;
  const tauxProjetOffre = propositions.length ? Math.round((offresActives.length / propositions.length) * 100) : 0;
  const tauxAcceptationOffres = offresEnvoyeesEtAcceptees ? Math.round((offresAcceptees.length / offresEnvoyeesEtAcceptees) * 100) : 0;

  const alertesFinancieres = [];
  const addAlert = (title, sub, color=WA, icon=AlertTriangle) => alertesFinancieres.push({ title, sub, color, icon });
  if (clientsSignesSansBudget.length) addAlert("Clients signés sans budget", `${clientsSignesSansBudget.length} dossier${clientsSignesSansBudget.length>1?"s":""} à compléter`, DA, Wallet);
  if (clientsSignesSansProjet.length) addAlert("Clients signés sans projet présenté", `${clientsSignesSansProjet.length} client${clientsSignesSansProjet.length>1?"s":""} à traiter`, WA, Home);
  if (clientsSansAction.length) addAlert("Clients sans prochaine action", `${clientsSansAction.length} client${clientsSansAction.length>1?"s":""} hors prospects`, DA, Calendar);
  if (clientsSansStrategie.length) addAlert("Stratégie client incomplète", `${clientsSansStrategie.length} dossier${clientsSansStrategie.length>1?"s":""} peu pilotable${clientsSansStrategie.length>1?"s":""}`, "#c084fc", Users);
  if (biensCashflowNegatif.length) addAlert("Cash-flow négatif", `${biensCashflowNegatif.length} bien${biensCashflowNegatif.length>1?"s":""} à arbitrer`, DA, Euro);
  if (biensRendementFaible.length) addAlert("Rendement sous objectif", `${biensRendementFaible.length} bien${biensRendementFaible.length>1?"s":""} sous 8 %`, WA, BarChart3);
  if (biensSansTravaux.length) addAlert("Budget travaux manquant", `${biensSansTravaux.length} bien${biensSansTravaux.length>1?"s":""} sans budget travaux`, WA, Hammer);
  if (offresActives.length && !delaisOffreRelance.length) addAlert("Offres sans date de pilotage", "Ajoutez une date de relance sur les offres en cours", WA, Bell);

  return {
    totalContacts: clients.length,
    prospects: prospects.length,
    clientsReels: clientsReels.length,
    clientsActifs: clientsActifs.length,
    clientsSignes: clientsSignes.length,
    clientsSansAction: clientsSansAction.length,
    prospectsSansAction: prospectsSansAction.length,
    clientsActifsSansProp: clientsActifsSansProp.length,
    clientsSignesSansProjet: clientsSignesSansProjet.length,
    clientsSignesSansBudget: clientsSignesSansBudget.length,
    clientsSansStrategie: clientsSansStrategie.length,
    budgetClientsActifs: clientsActifs.reduce((s,x)=>s+(Number(x.budget)||0),0),
    tauxTransformation: clients.length ? Math.round((clientsReels.length / clients.length) * 100) : 0,
    tauxSignature: clients.length ? Math.round((clientsSignes.length / clients.length) * 100) : 0,
    tauxProspectClient: clients.length ? Math.round((clientsSignes.length / clients.length) * 100) : 0,
    tauxClientProjet: tauxProjetPresente,
    tauxProjetOffre,
    biensProposesParClientActif: clientsActifs.length ? propositions.length / clientsActifs.length : 0,
    offresEnvoyees: offresEnvoyees.length,
    offresAcceptees: offresAcceptees.length,
    tauxAcceptationOffres,
    delaiMoyenSignature: delaisSignature.length ? Math.round(delaisSignature.reduce((s,x)=>s+x,0) / delaisSignature.length) : null,
    delaiMoyenSignatureProjet: delaisSignatureProjet.length ? Math.round(delaisSignatureProjet.reduce((s,x)=>s+x,0) / delaisSignatureProjet.length) : null,
    delaiMoyenOffreRelance: delaisOffreRelance.length ? Math.round(delaisOffreRelance.reduce((s,x)=>s+x,0) / delaisOffreRelance.length) : null,
    montantOffresCours,
    montantOffresPondere,
    nbOffresActives: offresActives.length,
    offresActives,
    baseHonorairesSignes,
    baseHonorairesPipeline: baseHonorairesPipelineBrut,
    baseHonorairesPipelineBrut,
    baseHonorairesPipelinePondere,
    estimationHonoraireConseil: honorairesConseilBrut,
    honorairesConseilBrut,
    honorairesConseilPondere,
    honorairesConseilSignes,
    caSigneTheorique,
    caEncaisseDeclare,
    caRestantAEncaisser,
    caPipelineBrut,
    caPipelinePondere,
    caPotentielTotal,
    caPotentielRestant,
    forecast30: Math.round(forecast.d30),
    forecast60: Math.round(forecast.d60),
    forecast90: Math.round(forecast.d90),
    simulations: projets.length,
    simulationsAvecCout: simulationsAvecCout.length,
    totalCoutSimule,
    totalLoyersAnnuelsSimules,
    totalCashflowMensuelSimule,
    rendementBrutMoyen,
    rendementNetMoyen,
    projetsRentables,
    projetsNonRentables,
    biensAbandonnes,
    biensSansTravaux,
    biensCashflowNegatif,
    biensRendementFaible,
    biensSansSimulateur,
    alertesFinancieres,
  };
}

function FinanceMetricRow({ label, value, sub, color, icon: IconComp, T=THEMES_INV.dark }) {
  return (
    <div className="inv-kpi" style={{padding:14,borderLeft:`3px solid ${color || T.accent}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {IconComp && <span style={{width:32,height:32,borderRadius:RADIUS.md,background:`${color || T.accent}18`,color:color || T.accent,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon as={IconComp} size={16}/></span>}
        <div style={{minWidth:0}}>
          <div className="inv-kpi-lbl">{label}</div>
          <div className="inv-kpi-val" style={{fontSize:FONT.xl.size+2,color:color || T.text}}>{value}</div>
          {sub && <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3,lineHeight:1.35}}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function FinanceBar({ label, value, max, color, T=THEMES_INV.dark, displayValue }) {
  const pct = max > 0 ? Math.min(100, Math.round((Number(value || 0) / max) * 100)) : 0;
  return (
    <div style={{display:"grid",gridTemplateColumns:"170px 1fr 110px",gap:10,alignItems:"center",fontSize:FONT.sm.size+1,color:T.textSub}}>
      <div style={{fontWeight:700,color:T.text}}>{label}</div>
      <div style={{height:10,borderRadius:RADIUS.pill,background:T.input,border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color || T.accent,borderRadius:RADIUS.pill}}/>
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,color:color || T.accent,textAlign:"right"}}>{displayValue || `${pct}%`}</div>
    </div>
  );
}

function FinanceMiniTable({ rows=[], T=THEMES_INV.dark }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7}}>
      {rows.map((r, i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
          <div>
            <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text}}>{r.label}</div>
            {r.sub && <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{r.sub}</div>}
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color:r.color || T.accent,textAlign:"right",whiteSpace:"nowrap"}}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function DashboardFinancier({ profil, T=THEMES_INV.dark }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [raw, setRaw] = useState({ clients:[], biens:[], propositions:[], projets:[] });

  const charger = useCallback(async () => {
    setLoading(true);
    setError("");
    const [clientsRes, biensRes, propsRes, projetsRes] = await Promise.all([
      supabase.from("invest_clients").select("*"),
      supabase.from("invest_biens").select("*"),
      supabase.from("invest_propositions").select("*, bien:invest_biens(*)"),
      supabase.from("invest_projets").select("*"),
    ]);
    const firstError = clientsRes.error || biensRes.error || propsRes.error || projetsRes.error;
    if (firstError) {
      console.error("Erreur Dashboard Financier:", firstError);
      setError(firstError.message || "Impossible de charger les données financières.");
    }
    const data = {
      clients: clientsRes.data || [],
      biens: biensRes.data || [],
      propositions: propsRes.data || [],
      projets: projetsRes.data || [],
    };
    setRaw(data);
    setStats(buildFinancePilotageStats(data));
    setLoading(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const maxPerf = 100;
  const maxBusiness = Math.max(1, stats?.caPipelineBrut || 0, stats?.montantOffresCours || 0, stats?.budgetClientsActifs || 0);
  const maxForecast = Math.max(1, stats?.forecast30 || 0, stats?.forecast60 || 0, stats?.forecast90 || 0);
  const pointsPilotage = stats ? [
    { title:"Clients réels sans prochaine action", value:stats.clientsSansAction, sub:"À traiter pour éviter la perte de suivi", color:stats.clientsSansAction > 0 ? DA : SU, icon:AlertTriangle },
    { title:"Prospects sans prochaine action", value:stats.prospectsSansAction, sub:"À convertir ou nettoyer du pipeline", color:stats.prospectsSansAction > 0 ? WA : SU, icon:Users },
    { title:"Clients actifs sans bien proposé", value:stats.clientsActifsSansProp, sub:"Potentiel commercial non exploité", color:stats.clientsActifsSansProp > 0 ? WA : SU, icon:Building2 },
    { title:"Offres actives à piloter", value:stats.nbOffresActives, sub:fmtDashboardEur(stats.montantOffresCours), color:T.accent, icon:Send },
  ] : [];

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1480, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{ width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon as={Euro} size={24} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Dashboard Financier</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>CA signé, pipeline pondéré, offres, délais, alertes et qualité des projets</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>
          <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Actualiser
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : error ? (
        <div style={{padding:SPACING.lg,borderRadius:RADIUS.lg,background:SEMANTIC.danger.bg,border:`1px solid ${SEMANTIC.danger.border}`,color:DA}}>{error}</div>
      ) : stats && (
        <>
          <DashboardPanel title="Synthèse financière" icon={Wallet} subtitle="Ce qui est signé, encaissé, restant dû et probable" T={T}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(215px,1fr))",gap:SPACING.md}}>
              <FinanceMetricRow T={T} icon={Handshake} label="CA signé HT théorique" value={fmtDashboardEur(stats.caSigneTheorique)} color={SU} sub={`${fmtDashboardEur(stats.baseHonorairesSignes)} fixes + ${fmtDashboardEur(stats.honorairesConseilSignes)} conseil probable`}/>
              <FinanceMetricRow T={T} icon={Euro} label="CA encaissé déclaré" value={fmtDashboardEur(stats.caEncaisseDeclare)} color={stats.caEncaisseDeclare > 0 ? SU : WA} sub={stats.caEncaisseDeclare > 0 ? "D'après les champs d'encaissement renseignés" : "À renseigner si tu veux piloter la trésorerie réelle"}/>
              <FinanceMetricRow T={T} icon={Wallet} label="CA restant à encaisser" value={fmtDashboardEur(stats.caRestantAEncaisser)} color={stats.caRestantAEncaisser > 0 ? WA : SU} sub="CA signé théorique - encaissé déclaré"/>
              <FinanceMetricRow T={T} icon={TrendingUp} label="Pipeline brut" value={fmtDashboardEur(stats.caPipelineBrut)} color="#FFC200" sub="Contrats potentiels + conseil brut"/>
              <FinanceMetricRow T={T} icon={Sparkles} label="Pipeline pondéré" value={fmtDashboardEur(stats.caPipelinePondere)} color="#c084fc" sub="Vision réaliste selon les probabilités"/>
              <FinanceMetricRow T={T} icon={Send} label="Offres en cours" value={fmtDashboardEur(stats.montantOffresCours)} color="#4db8ff" sub={`Pondéré : ${fmtDashboardEur(stats.montantOffresPondere)}`}/>
            </div>
          </DashboardPanel>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Pipeline pondéré 30 / 60 / 90 jours" icon={Calendar} subtitle="Prévision HT probable selon les étapes, actions et offres" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 30 jours" value={fmtDashboardEur(stats.forecast30)} color={SU} sub="Court terme"/>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 60 jours" value={fmtDashboardEur(stats.forecast60)} color="#FFC200" sub="Court / moyen terme"/>
                <FinanceMetricRow T={T} icon={Calendar} label="Prévision 90 jours" value={fmtDashboardEur(stats.forecast90)} color="#c084fc" sub="Potentiel trimestre"/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <FinanceBar T={T} label="30 jours" value={stats.forecast30} max={maxForecast} color={SU} displayValue={fmtDashboardEur(stats.forecast30)}/>
                <FinanceBar T={T} label="60 jours" value={stats.forecast60} max={maxForecast} color="#FFC200" displayValue={fmtDashboardEur(stats.forecast60)}/>
                <FinanceBar T={T} label="90 jours" value={stats.forecast90} max={maxForecast} color="#c084fc" displayValue={fmtDashboardEur(stats.forecast90)}/>
              </div>
            </DashboardPanel>

            <DashboardPanel title="Honoraires & offres" icon={Briefcase} subtitle="Base fixe, conseil négociation et volume d'acquisition" T={T}>
              <FinanceMiniTable T={T} rows={[
                {label:"Honoraires fixes signés", value:fmtDashboardEur(stats.baseHonorairesSignes), sub:`${stats.clientsSignes} client${stats.clientsSignes>1?"s":""} signé${stats.clientsSignes>1?"s":""} · 1 583 € HT`, color:SU},
                {label:"Honoraires fixes pipeline brut", value:fmtDashboardEur(stats.baseHonorairesPipelineBrut), sub:"Prospects + clients en cours", color:"#FFC200"},
                {label:"Honoraires fixes pipeline pondéré", value:fmtDashboardEur(stats.baseHonorairesPipelinePondere), sub:"Selon maturité client", color:"#c084fc"},
                {label:"Honoraires conseil brut", value:fmtDashboardEur(stats.honorairesConseilBrut), sub:"7 500 € HT / offre active", color:"#4db8ff"},
                {label:"Honoraires conseil pondéré", value:fmtDashboardEur(stats.honorairesConseilPondere), sub:"Selon statut des offres", color:T.accent},
              ]}/>
            </DashboardPanel>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Performance commerciale" icon={BarChart3} subtitle="Conversion, rythme et efficacité commerciale" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
                <FinanceMetricRow T={T} icon={Users} label="Contacts" value={stats.totalContacts} color={T.accent} sub={`${stats.prospects} prospects · ${stats.clientsReels} clients réels`}/>
                <FinanceMetricRow T={T} icon={Handshake} label="Prospect → client signé" value={`${stats.tauxProspectClient}%`} color={SU} sub="Clients signés / contacts"/>
                <FinanceMetricRow T={T} icon={Home} label="Signé → projet présenté" value={`${stats.tauxClientProjet}%`} color="#FFC200" sub="Clients signés avec proposition/projet"/>
                <FinanceMetricRow T={T} icon={Send} label="Projet → offre" value={`${stats.tauxProjetOffre}%`} color="#4db8ff" sub="Offres actives / propositions"/>
                <FinanceMetricRow T={T} icon={Check} label="Offre → acceptée" value={`${stats.tauxAcceptationOffres}%`} color="#c084fc" sub="Offres acceptées / offres envoyées"/>
                <FinanceMetricRow T={T} icon={Building2} label="Biens / client actif" value={stats.biensProposesParClientActif.toFixed(1).replace(".", ",")} color={T.accent} sub="Propositions / clients actifs"/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <FinanceBar T={T} label="Contact → signé" value={stats.tauxProspectClient} max={maxPerf} color={SU}/>
                <FinanceBar T={T} label="Signé → projet" value={stats.tauxClientProjet} max={maxPerf} color="#FFC200"/>
                <FinanceBar T={T} label="Projet → offre" value={stats.tauxProjetOffre} max={maxPerf} color="#4db8ff"/>
                <FinanceBar T={T} label="Offre → acceptée" value={stats.tauxAcceptationOffres} max={maxPerf} color="#c084fc"/>
              </div>
            </DashboardPanel>

            <DashboardPanel title="Délais moyens" icon={Calendar} subtitle="Repérer les ralentissements dans le parcours" T={T}>
              <FinanceMiniTable T={T} rows={[
                {label:"Premier contact → signature", value:stats.delaiMoyenSignature !== null ? `${stats.delaiMoyenSignature} j` : "—", sub:"Objectif : réduire le délai de décision", color:T.accent},
                {label:"Signature → premier projet", value:stats.delaiMoyenSignatureProjet !== null ? `${stats.delaiMoyenSignatureProjet} j` : "—", sub:"Objectif : présenter vite les premières opportunités", color:stats.delaiMoyenSignatureProjet && stats.delaiMoyenSignatureProjet > 15 ? WA : SU},
                {label:"Offre → relance / suivi", value:stats.delaiMoyenOffreRelance !== null ? `${stats.delaiMoyenOffreRelance} j` : "—", sub:"À fiabiliser avec les dates de relance", color:stats.delaiMoyenOffreRelance && stats.delaiMoyenOffreRelance > 7 ? WA : T.accent},
              ]}/>
            </DashboardPanel>
          </div>

          <DashboardPanel title="Portefeuille simulateurs & qualité des projets" icon={BarChart3} subtitle="Rentabilité, cash-flow, travaux et arbitrages" T={T}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:SPACING.md,marginBottom:SPACING.lg}}>
              <FinanceMetricRow T={T} icon={FileText} label="Simulations" value={stats.simulations} color={T.accent} sub={`${stats.simulationsAvecCout} avec coût total renseigné`}/>
              <FinanceMetricRow T={T} icon={Wallet} label="Coût total simulé" value={fmtDashboardEur(stats.totalCoutSimule)} color="#FFC200" sub="Somme des opérations simulées"/>
              <FinanceMetricRow T={T} icon={TrendingUp} label="Loyers annuels simulés" value={fmtDashboardEur(stats.totalLoyersAnnuelsSimules)} color={SU} sub="Total loyers bruts annuels"/>
              <FinanceMetricRow T={T} icon={BarChart3} label="Rendement brut moyen" value={fmtDashboardPct(stats.rendementBrutMoyen)} color="#c084fc" sub={`Rendement net moyen : ${fmtDashboardPct(stats.rendementNetMoyen)}`}/>
              <FinanceMetricRow T={T} icon={Euro} label="Cash-flow mensuel simulé" value={fmtDashboardEur(stats.totalCashflowMensuelSimule)} color={stats.totalCashflowMensuelSimule >= 0 ? SU : DA} sub="Somme des cash-flows mensuels S1"/>
              <FinanceMetricRow T={T} icon={Check} label="Projets rentables" value={stats.projetsRentables} color={SU} sub={`${stats.projetsNonRentables} non rentables · ${stats.biensAbandonnes} abandonnés`}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:SPACING.sm+2}}>
              <FinanceMetricRow T={T} icon={Hammer} label="Travaux manquants" value={stats.biensSansTravaux} color={stats.biensSansTravaux > 0 ? WA : SU} sub="Biens sans budget travaux"/>
              <FinanceMetricRow T={T} icon={AlertTriangle} label="Cash-flow négatif" value={stats.biensCashflowNegatif} color={stats.biensCashflowNegatif > 0 ? DA : SU} sub="Biens à arbitrer"/>
              <FinanceMetricRow T={T} icon={BarChart3} label="Rendement faible" value={stats.biensRendementFaible} color={stats.biensRendementFaible > 0 ? WA : SU} sub="Sous 8 % brut"/>
              <FinanceMetricRow T={T} icon={FileText} label="Sans simulateur" value={stats.biensSansSimulateur} color={stats.biensSansSimulateur > 0 ? WA : SU} sub="Fiches biens à compléter"/>
            </div>
          </DashboardPanel>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,.95fr) minmax(0,1.05fr)",gap:SPACING.md,alignItems:"start"}}>
            <DashboardPanel title="Pilotage à surveiller" icon={AlertTriangle} subtitle="Points financiers et commerciaux à traiter" T={T}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:SPACING.sm+2,marginBottom:SPACING.md}}>
                {pointsPilotage.map(p => <FinanceMetricRow key={p.title} T={T} icon={p.icon} label={p.title} value={p.value} color={p.color} sub={p.sub}/>) }
              </div>
              <DashboardAlertList items={stats.alertesFinancieres.slice(0,8)} T={T} empty="Aucune alerte financière" />
            </DashboardPanel>

            <DashboardPanel title="Offres en cours" icon={Send} subtitle="Montants à suivre dans les négociations" T={T}>
              {stats.offresActives.length === 0 ? (
                <div style={{padding:SPACING.lg,border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,color:T.textMuted,textAlign:"center",fontStyle:"italic"}}>Aucune offre active renseignée</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:420,overflowY:"auto"}}>
                  {stats.offresActives.slice(0,14).map((o,idx)=>(
                    <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 120px 105px",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.label}</div>
                        <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{o.source} · {o.statut || "—"}</div>
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,color:T.accent,textAlign:"right"}}>{fmtDashboardEur(o.amount)}</div>
                      <div style={{fontSize:FONT.xs.size,fontWeight:800,color:o.probability >= .8 ? SU : T.accent,background:`${o.probability >= .8 ? SU : T.accent}18`,border:`1px solid ${o.probability >= .8 ? SU : T.accent}33`,borderRadius:RADIUS.pill,padding:"4px 8px",textAlign:"center"}}>{Math.round(o.probability*100)} %</div>
                    </div>
                  ))}
                </div>
              )}
            </DashboardPanel>
          </div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


export default DashboardFinancier;
export { DashboardFinancier };