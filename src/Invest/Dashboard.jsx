import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, Users, Building2, BarChart3, Plus, Trash2,
  Search, RefreshCw, Save, Download, X, Check, Phone, Calendar,
  MessageSquare, FileText, Home, TrendingUp, Wallet, Euro, Filter,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Sparkles, Sun,
  LayoutGrid, Send, Handshake, Bell, Briefcase, Copy, Pencil, ExternalLink,
} from "lucide-react";

import {
  THEMES_INV, SU, WA, DA, ETAPES_CLIENT,
  isoDate, getWeekRange, normTxt, KPICard,
  fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween,
  getClientName, getBienLabel, getBienScore, isBienFicheComplete,
  hasSimulateurBien, isGeolocBien, DashboardPanel, DashboardAlertList,
  HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT,
} from "./_shared";

// ─────────────────────────────────────────────────────────────
// TABLEAU DE BORD V7.1 — Dashboard Pilotage Quotidien Profero Invest
// Objectif : suivi strict des urgences, prospects, clients et stock de biens.
// Version calibrée selon les réponses métier Matthieu : uniquement les éléments
// qui nécessitent une décision, clients sous contrôle visibles séparément,
// score prospect, relances automatiques J+1/J+3/J+7/J+14/J+30, actions créées.
// Rappel mail volontairement exclu de cette version.
// V7 : cockpit à 3 niveaux — bandeau critique 10 secondes, onglets métier prospects/clients/biens/équipe, fiche liée au clic et notifications collaborateurs liées aux actions créées.
// ─────────────────────────────────────────────────────────────

const V6_TABS = [
  { key:"dashboard", label:"Pilotage quotidien", icon:LayoutDashboard },
  { key:"plan", label:"Plan d’action", icon:Send },
  { key:"suivi", label:"Suivi dossiers", icon:LayoutGrid },
  { key:"historique", label:"Historique", icon:FileText },
  { key:"mensuel", label:"Vue mensuelle", icon:BarChart3 },
];

const V6_STEPS = [
  { key:"prospects", label:"Prospects", icon:Phone, help:"Prospects rouges, orange, chauds, relances et échéances." },
  { key:"clients", label:"Clients", icon:Briefcase, help:"Clients actifs classés par étape, alertes en haut et dossiers sous contrôle en lecture." },
  { key:"biens", label:"Stock de biens", icon:Home, help:"Tout le cycle du bien, avec tâches et relances en haut." },
  { key:"collaborateurs", label:"Équipe", icon:Users, help:"Consignes et actions assignées à Matthieu, Tom, Benjamin, Camille ou autres." },
  { key:"priorites", label:"3 priorités du jour", icon:Sparkles, help:"Priorités définies après la revue métier." },
  { key:"synthese", label:"Synthèse", icon:Send, help:"Plan d’action PDF par responsable avec commentaires détaillés." },
  { key:"validation", label:"Validation finale", icon:Check, help:"Finalisation stricte ou validation forcée avec motif." },
];

const V6_BASE_COLLABORATORS = ["Tom", "Benjamin", "Camille", "Matthieu"];
const V6_RESPONSABLES = ["Matthieu", "Tom", "Benjamin", "Camille", "Autre"];
const V6_URGENCIES = ["Faible", "Normal", "Élevé"];
const V6_RELANCE_SEQUENCE = [1, 3, 7, 14, 30];
const V6_CLIENT_STEPS = ["Contrat signé", "Documents reçus", "Stratégie définie", "Recherche de biens", "Visites", "Présentation opportunité", "Offre d’achat", "Offre acceptée", "Financement", "Compromis", "Travaux", "Mise en location", "Terminé"];
const V6_BIEN_STATUTS = ["Nouveau", "À trier", "À analyser", "Analyse en cours", "À visiter", "Visite programmée", "Visité", "À matcher", "Proposé à client", "Offre à faire", "Offre envoyée", "Offre acceptée", "Refusé", "Archivé", "En travaux", "Terminé"];

const V6_DECISIONS = {
  urgence:["Traiter moi-même", "Assigner", "Reporter", "Bloquer", "Arbitrage Matthieu", "Clôturer / ne plus suivre"],
  collaborateur:["Rien à signaler", "Demander retour", "Donner consigne", "Réassigner", "Bloquer pour arbitrage", "Créer tâche"],
  prospect:["Appeler", "Envoyer WhatsApp", "Envoyer mail", "Programmer RDV", "Créer tâche", "Assigner", "Reporter", "Passer froid", "Passer perdu", "Archiver"],
  client:["Faire avancer", "Relancer client", "Relancer banque", "Relancer notaire", "Relancer assurance", "Demander document", "Assigner à Tom", "Assigner à Benjamin", "Assigner à Camille", "Arbitrage Matthieu", "Mettre en pause", "Clôturer"],
  bien:["Analyser", "Demander visite terrain", "Proposer à un client", "Matcher avec client", "Relancer agent / vendeur", "Faire offre", "Revoir le prix", "Archiver", "Mettre en attente", "Créer tâche travaux", "Créer tâche analyse"],
};

const V6_CHECKLISTS = {
  urgences:[
    { id:"late_tasks", label:"Tâches en retard vérifiées", required:true },
    { id:"red_alerts", label:"Chaque urgence rouge a une décision", required:true },
    { id:"owner_set", label:"Responsable défini sur chaque urgence", required:true },
    { id:"comments_done", label:"Commentaires saisis pour chaque décision", required:true },
  ],
  priorites:[
    { id:"p1", label:"Priorité n°1 remplie", required:true },
    { id:"p2", label:"Priorité n°2 remplie", required:true },
    { id:"p3", label:"Priorité n°3 remplie", required:true },
  ],
  collaborateurs:[
    { id:"assigned", label:"Les actions assignées à l’équipe sont contrôlées", required:false },
    { id:"clear", label:"Les consignes importantes sont présentes dans le plan d’action", required:false },
  ],
  prospects:[
    { id:"classified", label:"Prospects classés par niveau", required:true },
    { id:"critical", label:"Prospects critiques traités individuellement", required:true },
    { id:"next_action", label:"Prochaine action + date + responsable + commentaire", required:true },
  ],
  clients:[
    { id:"stages", label:"Étapes clients vérifiées", required:true },
    { id:"blocked", label:"Documents manquants / étapes non renseignées traités", required:true },
    { id:"owner", label:"Responsable et action future définis", required:true },
  ],
  biens:[
    { id:"decisions", label:"Chaque bien a une décision", required:true },
    { id:"score", label:"Score Profero vérifié", required:false },
    { id:"owner", label:"Responsable + action à prévoir définis", required:true },
  ],
  synthese:[
    { id:"summary", label:"Plan d’action court vérifié", required:true },
    { id:"owners", label:"Actions regroupées par responsable", required:true },
  ],
  validation:[
    { id:"final", label:"Routine validée ou forcée avec motif", required:true },
  ],
};

function todayIso() {
  return isoDate(new Date());
}

function isFutureDate(value) {
  const d = toDate(value);
  const t = toDate(new Date());
  if (!d || !t) return false;
  return d > t;
}

function isDueTodayOrPast(value) {
  const d = toDate(value);
  const t = toDate(new Date());
  if (!d || !t) return false;
  return d <= t;
}

function readOnlyReasonFromDate(value) {
  return isFutureDate(value) ? `Échéance à venir le ${safeDate(value)} — lecture seule aujourd’hui` : "";
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysSince(value) {
  const d = toDate(value);
  if (!d) return null;
  const t = toDate(new Date());
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}

function isWithin(value, start, end) {
  const d = toDate(value);
  const s = toDate(start);
  const e = toDate(end);
  if (!d || !s || !e) return false;
  return d >= s && d <= e;
}

function monthKey(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR", { month:"short" }).replace(".", "");
}

function lastClientActivity(c={}) {
  return c.updated_at || c.date_prochaine_action || c.date_signature || c.date_premier_contact || c.created_at || null;
}

function actionTitle(a={}) {
  return String(a.action_title || a.title || a.titre || a.nom || "Action").trim();
}

function actionOwner(a={}) {
  return String(a.responsable || a.owner || a.assignee || a.assigned_to || "").trim();
}

function isOpenAction(a={}) {
  const s = normTxt(a.status || a.statut || "");
  return !s || ["a_faire", "en_cours", "bloque", "bloqué", "a_valider", "todo", "open", "pending"].includes(s);
}

function isDoneAction(a={}) {
  const s = normTxt(a.status || a.statut || "");
  return ["termine", "terminé", "fait", "done", "completed", "valide", "validé"].includes(s);
}

function isBlockedAction(a={}) {
  const s = normTxt(a.status || a.statut || "");
  return s.includes("bloque") || s.includes("bloqué");
}

function isPartnerAction(a={}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""}`);
  return txt.includes("banque") || txt.includes("notaire") || txt.includes("assurance") || txt.includes("courtier") || txt.includes("partenaire");
}

function isDocumentAction(a={}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""}`);
  return txt.includes("document") || txt.includes("piece") || txt.includes("pièce") || txt.includes("justificatif") || txt.includes("dossier manquant");
}

function prospectScore(c={}) {
  const txt = normTxt(`${c.etape || ""} ${c.prochaine_action || ""} ${c.source || ""} ${c.commentaire || ""} ${c.motivation || ""} ${c.projet || ""} ${c.urgence || ""}`);
  let score = 0;
  // Délai / urgence projet
  if (txt.includes("urgent") || txt.includes("rapid") || txt.includes("court terme") || txt.includes("3 mois")) score += 20;
  else if (txt.includes("6 mois") || txt.includes("moyen terme")) score += 12;
  else score += 6;
  // Capacité financière approximée par budget renseigné
  const budget = Number(c.budget) || 0;
  if (budget >= 200000) score += 20;
  else if (budget >= 150000) score += 16;
  else if (budget >= 100000) score += 10;
  else if (budget > 0) score += 6;
  // Motivation claire
  if (txt.includes("motivé") || txt.includes("motive") || txt.includes("très intéressé") || txt.includes("interessé") || txt.includes("intéressé")) score += 20;
  else if (txt.includes("rdv") || txt.includes("appel") || txt.includes("proposition")) score += 14;
  else score += 5;
  // Qualité / maturité du contact
  if (txt.includes("rdv fait") || txt.includes("proposition envoy") || txt.includes("qualifié") || txt.includes("qualifie")) score += 20;
  else if (txt.includes("rdv fixé") || txt.includes("analyse")) score += 12;
  else score += 5;
  // Source
  if (txt.includes("recommand") || txt.includes("parrain") || txt.includes("réseau") || txt.includes("reseau")) score += 20;
  else if (txt.includes("site") || txt.includes("formulaire") || txt.includes("linkedin")) score += 12;
  else score += 7;
  return Math.max(0, Math.min(100, score));
}

function nextRelanceDateFromCount(count=0) {
  const idx = Math.min(Math.max(Number(count) || 0, 0), V6_RELANCE_SEQUENCE.length - 1);
  const d = new Date();
  d.setDate(d.getDate() + V6_RELANCE_SEQUENCE[idx]);
  return isoDate(d);
}

function prospectClass(c={}) {
  const last = daysSince(lastClientActivity(c));
  const score = prospectScore(c);
  const hasNoAction = !c.prochaine_action || !c.date_prochaine_action;
  const hasNoOwner = !c.conseiller;
  const hasFutureAction = Boolean(c.date_prochaine_action && isFutureDate(c.date_prochaine_action));
  const badges = [];
  if (score >= 70) badges.push({ label:"Chaud", level:"success" });
  if (c.date_prochaine_action === todayIso()) badges.push({ label:"Relance du jour", level:"warning" });
  if (hasFutureAction) badges.push({ label:"Échéance à venir", level:"info" });
  if (!hasFutureAction && last !== null && last >= 10) badges.push({ label:"Rouge +10j", level:"danger" });
  else if (!hasFutureAction && last !== null && last >= 7) badges.push({ label:"Orange +7j", level:"warning" });
  if (hasNoAction) badges.push({ label:"Sans action", level:"danger" });
  if (hasNoOwner) badges.push({ label:"Sans responsable", level:"danger" });

  const hasBlockingAlert = hasNoAction || hasNoOwner || (!hasFutureAction && last !== null && last >= 7) || c.date_prochaine_action === todayIso();
  const scheduledReadOnly = hasFutureAction && !hasNoAction && !hasNoOwner && !hasBlockingAlert;

  if (scheduledReadOnly) {
    return {
      label:score >= 70 ? "Chaud programmé" : "Échéance à venir",
      level:"info",
      reason:`${readOnlyReasonFromDate(c.date_prochaine_action)}${score >= 70 ? ` · Prospect chaud — score ${score}/100` : ""}`,
      score,
      badges,
      readOnly:true,
      scheduledFuture:true,
    };
  }

  const main = badges.find(b => b.level === "danger") || badges.find(b => b.level === "warning") || badges.find(b => b.level === "success") || { label:"Suivi", level:"info" };
  const reason = hasNoAction ? "Prospect sans prochaine action datée" : hasNoOwner ? "Prospect sans responsable" : last !== null && last >= 10 ? `Sans action depuis ${last} jours` : last !== null && last >= 7 ? `Sans action depuis ${last} jours` : score >= 70 ? `Prospect chaud — score ${score}/100` : "Prospect à maintenir actif";
  return { label:main.label, level:main.level, reason, score, badges, readOnly:false, scheduledFuture:false };
}

function bienClass(b={}) {
  const statutRaw = b.statut || "";
  const statut = normTxt(statutRaw);
  const score = getBienScore(b);
  const hasNoStatus = !String(statutRaw || "").trim();
  const hasFutureRelance = Boolean(b.date_relance && isFutureDate(b.date_relance));
  const hasNoAction = !b.date_relance && !statut.includes("termine") && !statut.includes("archiv") && !statut.includes("refus");
  const isOffer = statut.includes("offre envoy") || statut.includes("offre à faire") || statut.includes("offre a faire") || statut.includes("offre accept");

  if (hasFutureRelance) {
    return {
      label:"Échéance à venir",
      level:"info",
      reason:readOnlyReasonFromDate(b.date_relance),
      score,
      readOnly:true,
      scheduledFuture:true,
    };
  }

  if (hasNoStatus) return { label:"Sans statut", level:"danger", reason:"Bien sans statut", score, readOnly:false, scheduledFuture:false };
  if (b.date_relance && isDueTodayOrPast(b.date_relance)) return { label:"Relance arrivée", level:"danger", reason:`Relance prévue le ${safeDate(b.date_relance)}`, score, readOnly:false, scheduledFuture:false };
  if (hasNoAction && !statut.includes("termine") && !statut.includes("archiv")) return { label:"Sans action", level:"danger", reason:"Bien sans prochaine action / relance", score, readOnly:false, scheduledFuture:false };
  if (isOffer) return { label:"Offre en cours", level:"warning", reason:"Offre à suivre", score, readOnly:false, scheduledFuture:false };
  if (statut.includes("nouveau") || statut.includes("trier")) return { label:"Nouvelle annonce", level:"warning", reason:"Annonce à classer", score, readOnly:false, scheduledFuture:false };
  if (statut.includes("analyse") || statut.includes("analyser")) return { label:"À analyser", level:"warning", reason:"Analyse à finaliser", score, readOnly:false, scheduledFuture:false };
  if (statut.includes("visite") || statut.includes("matcher") || statut.includes("proposé")) return { label:"Tâche à effectuer", level:"warning", reason:"Action à effectuer sur le bien", score, readOnly:false, scheduledFuture:false };
  if (!isBienFicheComplete(b)) return { label:"Fiche incomplète", level:"warning", reason:"Fiche bien incomplète", score, readOnly:false, scheduledFuture:false };
  if (score >= 70) return { label:"Prioritaire", level:"success", reason:"Score Profero prioritaire", score, readOnly:false, scheduledFuture:false };
  return { label:"Sous contrôle", level:"info", reason:"Bien sans décision urgente", score, readOnly:true, scheduledFuture:false };
}

function levelColor(level, T) {
  if (level === "danger") return DA;
  if (level === "warning") return WA;
  if (level === "success") return SU;
  return T.accent;
}

function emptyRoutineState() {
  return {
    status:"not_started",
    started_at:null,
    completed_at:null,
    force_completed:false,
    force_reason:"",
    priorities:[0,1,2].map(() => ({ title:"", responsable:"Matthieu", due_date:todayIso(), comment:"", urgency:"Élevé" })),
    collaborators:{},
    extraCollaborators:[],
    checklist:{},
    decisions:{},
    resolvedUrgencies:{},
    stepNotes:{},
    savedRoutineId:null,
  };
}

function storageKeyFor(date=todayIso()) {
  return `profero_invest_dashboard_v7_1_${date}`;
}

function decisionKey(item) {
  return `${item.type}:${item.id}`;
}

function routineEntityKey(item) {
  if (!item) return "";
  const type = item.originalType || item.type || "item";
  const id = item.raw?.id || item.sourceId || item.id || item.label || "unknown";
  return `${type}:${id}`;
}

function isResolvedToday(routine, item) {
  const resolved = routine?.resolvedUrgencies || {};
  return Boolean(resolved[decisionKey(item)] || resolved[routineEntityKey(item)]);
}

function uniqueItemsByDecisionKey(items=[]) {
  const map = new Map();
  safeArr(items).forEach(item => {
    const key = decisionKey(item);
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
}

function defaultDecision(item) {
  return {
    decision:"",
    comment:"",
    responsable:item.responsable || "Matthieu",
    next_action:item.defaultAction || "",
    due_date:item.requiresDate ? (item.suggestedDueDate || todayIso()) : "",
    force_validated:false,
    force_reason:"",
    create_task:true,
  };
}

function isDecisionComplete(item, decision) {
  if (!item) return true;
  const d = decision || defaultDecision(item);
  if (d.force_validated) return Boolean(String(d.force_reason || "").trim());
  if (!String(d.decision || "").trim()) return false;
  if (!String(d.comment || "").trim()) return false;
  if (!String(d.responsable || "").trim()) return false;
  if (item.requiresNextAction && !String(d.next_action || "").trim()) return false;
  if (item.requiresDate && !String(d.due_date || "").trim()) return false;
  return true;
}


function missingDecisionFields(item, d = {}) {
  const missing = [];
  if (!String(d.decision || "").trim()) missing.push("décision");
  if (!String(d.comment || "").trim()) missing.push("commentaire");
  if (!String(d.responsable || "").trim()) missing.push("responsable");
  if (item.requiresNextAction && !String(d.next_action || "").trim()) missing.push("action future");
  if (item.requiresDate && !String(d.due_date || "").trim()) missing.push("échéance");
  if (d.force_validated && !String(d.force_reason || "").trim()) missing.push("motif de validation forcée");
  return missing;
}

function isPriorityComplete(p) {
  return Boolean(String(p?.title || "").trim() && String(p?.responsable || "").trim() && String(p?.comment || "").trim() && String(p?.urgency || "").trim());
}

function isCollaboratorComplete(c) {
  return Boolean(String(c?.mission || "").trim() && String(c?.objectif || "").trim() && String(c?.consigne || "").trim() && String(c?.decision || "").trim() && String(c?.urgency || "").trim());
}

function AlertBadge({ level="info", children, icon=null, T=THEMES_INV.dark }) {
  const color = levelColor(level, T);
  const bg = level === "danger" ? SEMANTIC?.danger?.bg : level === "warning" ? SEMANTIC?.warning?.bg : level === "success" ? SEMANTIC?.success?.bg : T.accentBg;
  const border = level === "danger" ? SEMANTIC?.danger?.border : level === "warning" ? SEMANTIC?.warning?.border : level === "success" ? SEMANTIC?.success?.border : T.accentBorder;
  const IconComp = icon || (level === "danger" || level === "warning" ? AlertTriangle : Check);
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 8px", borderRadius:RADIUS.pill, border:`1px solid ${border || color + "33"}`, background:bg || color + "12", color, fontSize:FONT.xs.size, fontWeight:900, whiteSpace:"nowrap" }}><Icon as={IconComp} size={11}/>{children}</span>;
}

function TextInput({ label, value, onChange, placeholder="", required=false, type="text", T=THEMES_INV.dark }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:5, fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800 }}>
      <span>{label}{required && <span style={{ color:DA }}> *</span>}</span>
      <input type={type} value={value || ""} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="inv-inp" style={{ width:"100%", textAlign:"left" }}/>
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder="", required=false, T=THEMES_INV.dark }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:5, fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800 }}>
      <span>{label}{required && <span style={{ color:DA }}> *</span>}</span>
      <textarea value={value || ""} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="inv-inp" rows={3} style={{ width:"100%", textAlign:"left", resize:"vertical", minHeight:74 }}/>
    </label>
  );
}

function SelectInput({ label, value, onChange, options=[], required=false, T=THEMES_INV.dark }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:5, fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800 }}>
      <span>{label}{required && <span style={{ color:DA }}> *</span>}</span>
      <select value={value || ""} onChange={e => onChange(e.target.value)} className="inv-sel" style={{ width:"100%" }}>
        <option value="">Sélectionner</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function SectionCard({ title, icon, subtitle, children, T=THEMES_INV.dark, action=null }) {
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.md }}>
      <div className="inv-card-hd blue" style={{ justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={icon || LayoutDashboard} size={13}/>{title}</span>
        {action || (subtitle && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:700 }}>{subtitle}</span>)}
      </div>
      <div className="inv-card-bd">{children}</div>
    </div>
  );
}

function RoutineDecisionCard({ item, decision, onChange, onResolve=null, onOpen=null, T=THEMES_INV.dark, compact=false, readOnly=false }) {
  const d = decision || defaultDecision(item);
  const type = item.type || "urgence";
  const options = V6_DECISIONS[type] || V6_DECISIONS.urgence;
  const color = levelColor(item.level, T);
  const complete = isDecisionComplete(item, d);
  const detailGrid = compact ? "1fr" : "repeat(auto-fit,minmax(190px,1fr))";
  const patch = (changes) => onChange({ ...d, ...changes });
  return (
    <div style={{ border:`1px solid ${complete ? T.border : color}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, boxShadow:T.shadowSm }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", marginBottom:SPACING.sm }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap", marginBottom:4 }}>
            {safeArr(item.badges).length ? safeArr(item.badges).map((b, idx) => <AlertBadge key={`${b.label}-${idx}`} level={b.level} T={T}>{b.label}</AlertBadge>) : <AlertBadge level={item.level} T={T}>{item.badge || item.category || item.type}</AlertBadge>}
            {item.meta && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:700 }}>{item.meta}</span>}
          </div>
          <div style={{ fontSize:FONT.lg.size - 1, fontWeight:900, color:T.text, lineHeight:1.25 }}>{item.label}</div>
          <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:3 }}>{item.reason}</div>
          {item.details && !compact && <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:6 }}>{item.details}</div>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {onOpen && (
            <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen(item)} title="Ouvrir la fiche liée">
              <Icon as={ExternalLink} size={12}/> Fiche
            </button>
          )}
          {readOnly || item.readOnly ? <AlertBadge level="info" T={T}>Lecture seule</AlertBadge> : complete ? <AlertBadge level="success" T={T}>Complet</AlertBadge> : <AlertBadge level="danger" T={T}>À compléter</AlertBadge>}
        </div>
      </div>

      {(readOnly || item.readOnly) && (
        <div style={{ marginTop:SPACING.sm, padding:SPACING.md, borderRadius:RADIUS.md, border:`1px solid ${T.border}`, background:T.card, color:T.textSub, fontSize:FONT.sm.size, fontWeight:800 }}>
          Échéance non passée : cette ligne reste visible pour information, sans décision obligatoire aujourd’hui.
        </div>
      )}

      {!(readOnly || item.readOnly) && <>
      <div style={{ display:"grid", gridTemplateColumns:detailGrid, gap:SPACING.sm, marginTop:SPACING.sm }}>
        <SelectInput label="Décision" required value={d.decision} onChange={v => patch({ decision:v })} options={options} T={T}/>
        <SelectInput label="Responsable" required value={d.responsable} onChange={v => patch({ responsable:v })} options={V6_RESPONSABLES} T={T}/>
        <TextInput label="Action future" required={item.requiresNextAction} value={d.next_action} onChange={v => patch({ next_action:v })} placeholder="Ex : appeler, relancer, analyser…" T={T}/>
        <TextInput label="Échéance" required={item.requiresDate} type="date" value={d.due_date} onChange={v => patch({ due_date:v })} T={T}/>
      </div>

      <div style={{ marginTop:SPACING.sm }}>
        <TextArea label="Commentaire de suivi" required value={d.comment} onChange={v => patch({ comment:v })} placeholder="Pourquoi cette décision ? Que faut-il retenir ?" T={T}/>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm, marginTop:SPACING.sm, flexWrap:"wrap" }}>
        <label style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:FONT.sm.size, color:T.textSub, fontWeight:800 }}>
          <input type="checkbox" checked={Boolean(d.create_task)} onChange={e => patch({ create_task:e.target.checked })}/>
          Créer / mettre à jour l’action liée
        </label>
        <label style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:FONT.sm.size, color:DA, fontWeight:800 }}>
          <input type="checkbox" checked={Boolean(d.force_validated)} onChange={e => patch({ force_validated:e.target.checked })}/>
          Forcer la validation
        </label>
      </div>
      {d.force_validated && <div style={{ marginTop:SPACING.sm }}><TextArea label="Motif de validation forcée" required value={d.force_reason} onChange={v => patch({ force_reason:v })} placeholder="Motif obligatoire si tu forces la validation." T={T}/></div>}
      </>}

      {onResolve && !(readOnly || item.readOnly) && (() => {
        const missing = missingDecisionFields(item, d);
        const canResolve = missing.length === 0;
        const disabledTitle = canResolve ? "Valider cette urgence pour aujourd’hui" : `Compléter avant validation : ${missing.join(", ")}`;
        const disabledStyle = canResolve ? {} : { opacity:.45, cursor:"not-allowed", filter:"grayscale(.35)" };
        const safeResolve = (label) => {
          if (!canResolve) return;
          onResolve(item, label);
        };
        return (
          <div style={{ marginTop:SPACING.sm, paddingTop:SPACING.sm, borderTop:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm, flexWrap:"wrap" }}>
            <div style={{ fontSize:FONT.xs.size + 1, color:canResolve ? T.textMuted : DA, fontWeight:800 }}>
              {canResolve
                ? "Validation autorisée : l’urgence disparaîtra de la routine du jour sans supprimer le dossier."
                : `Validation bloquée : complète ${missing.join(", ")}.`}
            </div>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
              <button type="button" className="inv-btn inv-btn-sm" disabled={!canResolve} title={disabledTitle} style={{ background:canResolve ? SU : T.textMuted, color:"white", ...disabledStyle }} onClick={() => safeResolve("Traiter moi-même")}><Icon as={Check} size={12}/> Traité</button>
              <button type="button" className="inv-btn inv-btn-out inv-btn-sm" disabled={!canResolve} title={disabledTitle} style={disabledStyle} onClick={() => safeResolve("Reporter")}><Icon as={Calendar} size={12}/> Reporter</button>
              <button type="button" className="inv-btn inv-btn-out inv-btn-sm" disabled={!canResolve} title={disabledTitle} style={disabledStyle} onClick={() => safeResolve("Assigner")}><Icon as={Users} size={12}/> Assigner</button>
              <button type="button" className="inv-btn inv-btn-sm" disabled={!canResolve} title={disabledTitle} style={{ background:canResolve ? DA : T.textMuted, color:"white", ...disabledStyle }} onClick={() => safeResolve("Bloquer")}><Icon as={AlertTriangle} size={12}/> Bloquer</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function PriorityEditor({ priorities, onChange, T=THEMES_INV.dark }) {
  const update = (idx, patch) => onChange(priorities.map((p, i) => i === idx ? { ...p, ...patch } : p));
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>
      {priorities.map((p, idx) => {
        const complete = isPriorityComplete(p);
        return (
          <div key={idx} style={{ border:`1px solid ${complete ? T.border : DA}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:SPACING.sm }}>
              <div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text }}>Priorité n°{idx + 1}</div>
              <AlertBadge level={complete ? "success" : "danger"} T={T}>{complete ? "OK" : "Obligatoire"}</AlertBadge>
            </div>
            <div style={{ display:"grid", gap:SPACING.sm }}>
              <TextInput label="Titre de la priorité" required value={p.title} onChange={v => update(idx, { title:v })} placeholder="Ex : relancer les prospects rouges" T={T}/>
              <SelectInput label="Responsable" required value={p.responsable} onChange={v => update(idx, { responsable:v })} options={V6_RESPONSABLES} T={T}/>
              <SelectInput label="Niveau d’urgence" required value={p.urgency} onChange={v => update(idx, { urgency:v })} options={V6_URGENCIES} T={T}/>
              <TextInput label="Échéance" type="date" value={p.due_date} onChange={v => update(idx, { due_date:v })} T={T}/>
              <TextArea label="Commentaire / résultat attendu" required value={p.comment} onChange={v => update(idx, { comment:v })} T={T}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CollaboratorEditor({ names, values, onChange, onAdd, T=THEMES_INV.dark, statsByName={} }) {
  const update = (name, patch) => onChange({ ...values, [name]:{ ...(values[name] || {}), ...patch } });
  const [newName, setNewName] = useState("");
  return (
    <div style={{ display:"grid", gap:SPACING.md }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <input className="inv-inp" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ajouter un collaborateur" style={{ width:240, textAlign:"left" }}/>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => { if (newName.trim()) { onAdd(newName.trim()); setNewName(""); } }}><Icon as={Plus} size={12}/>Ajouter</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:SPACING.md }}>
        {names.map(name => {
          const v = values[name] || {};
          const s = statsByName[name] || {};
          const complete = isCollaboratorComplete(v);
          const risk = Number(s.late || 0) > 0 || Number(s.open || 0) === 0 || Number(s.blocked || 0) > 0;
          return (
            <div key={name} style={{ border:`1px solid ${complete ? (risk ? WA : T.border) : DA}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start", marginBottom:SPACING.sm }}>
                <div><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text }}>{name}</div><div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:5 }}><AlertBadge level={risk ? "warning" : "success"} T={T}>{risk ? "À risque" : "OK"}</AlertBadge><AlertBadge level={s.late ? "danger" : "info"} T={T}>{s.late || 0} retard</AlertBadge><AlertBadge level="info" T={T}>{s.open || 0} ouvertes</AlertBadge></div></div>
                <AlertBadge level={complete ? "success" : "danger"} T={T}>{complete ? "Complet" : "À remplir"}</AlertBadge>
              </div>
              <div style={{ display:"grid", gap:SPACING.sm }}>
                <TextInput label="Mission prioritaire du jour" required value={v.mission} onChange={val => update(name, { mission:val })} T={T}/>
                <TextInput label="Objectif du jour" required value={v.objectif} onChange={val => update(name, { objectif:val })} T={T}/>
                <TextInput label="Blocage éventuel" value={v.blocage} onChange={val => update(name, { blocage:val })} T={T}/>
                <TextArea label="Message / consigne à envoyer" required value={v.consigne} onChange={val => update(name, { consigne:val })} T={T}/>
                <SelectInput label="Décision" required value={v.decision} onChange={val => update(name, { decision:val })} options={V6_DECISIONS.collaborateur} T={T}/>
                <SelectInput label="Niveau d’urgence" required value={v.urgency} onChange={val => update(name, { urgency:val })} options={V6_URGENCIES} T={T}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConsignesCollaborateursView({ plan=[], T=THEMES_INV.dark }) {
  const names = ["Matthieu", "Tom", "Benjamin", "Camille"];
  const assigned = plan.filter(p => p.responsable && p.responsable !== "Matthieu");
  if (!assigned.length) {
    return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucune consigne collaborateur pour le moment. Les consignes apparaîtront ici dès qu’une décision sera assignée à Tom, Benjamin, Camille ou un autre responsable.</div>;
  }
  const responsables = Array.from(new Set([...names, ...assigned.map(p => p.responsable)])).filter(r => assigned.some(p => p.responsable === r));
  return <div style={{ display:"grid", gap:SPACING.md }}>{responsables.map(r => <div key={r} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text }}>{r}</div><AlertBadge level="info" T={T}>{assigned.filter(p => p.responsable === r).length} consigne(s)</AlertBadge></div>{assigned.filter(p => p.responsable === r).map((p, i) => <div key={i} style={{ padding:"8px 0", borderTop:i ? `1px solid ${T.border}` : "none" }}><div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text }}>{p.title}</div><div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:2 }}>Échéance : {safeDate(p.due_date)} · Source : {p.source || "—"}</div>{p.comment && <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:4 }}>{p.comment}</div>}</div>)}</div>)}</div>;
}

function RoutineInfoList({ items=[], empty="Aucun dossier sous contrôle", T=THEMES_INV.dark, onOpen=null }) {
  if (!items.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>{empty}</div>;
  return (
    <div style={{ display:"grid", gap:8 }}>
      {items.map(item => (
        <div key={decisionKey(item)} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"9px 10px", display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.label}</div>
            <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>{item.reason} · {item.meta}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {item.scheduledFuture && <AlertBadge level="info" T={T}>Échéance à venir</AlertBadge>}
            <AlertBadge level={item.level || "info"} T={T}>{item.category || "Info"}</AlertBadge>
            {onOpen && <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen(item)}><Icon as={ExternalLink} size={12}/> Fiche</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResolvedUrgenciesView({ routine, data, onUndo, onOpen=null, T=THEMES_INV.dark }) {
  const resolved = routine?.resolvedUrgencies || {};
  const allItems = uniqueItemsByDecisionKey([...data.urgencyItems, ...data.prospectItems, ...data.clientItems, ...data.bienItems]);
  const seen = new Set();
  const rows = Object.entries(resolved).map(([key, info]) => {
    const item = allItems.find(i => decisionKey(i) === key || routineEntityKey(i) === key);
    return { key, info, item };
  }).filter(row => {
    if (!row.info) return false;
    const uniq = row.info.entity_key || row.key;
    if (seen.has(uniq)) return false;
    seen.add(uniq);
    return true;
  });
  if (!rows.length) return null;
  return (
    <SectionCard title="Urgences validées aujourd’hui" icon={Check} subtitle="Elles ne sont plus affichées dans la routine du jour" T={T}>
      <div style={{ display:"grid", gap:8 }}>
        {rows.map(({ key, info, item }) => (
          <div key={key} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"9px 10px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {info.label || item?.label || key}
              </div>
              <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>
                {info.decision || "Validé"} · {info.resolved_at ? new Date(info.resolved_at).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" }) : "aujourd’hui"}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              {onOpen && item && <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen(item)}><Icon as={ExternalLink} size={12}/> Fiche</button>}
              <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onUndo?.(key)}><Icon as={X} size={12}/> Réafficher</button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function MiniMonthlyChart({ data=[], T=THEMES_INV.dark }) {
  const max = Math.max(1, ...data.flatMap(m => [m.prospects || 0, m.rdv || 0, m.signatures || 0]));
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input, padding:SPACING.md, overflowX:"auto" }}>
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${data.length}, minmax(54px,1fr))`, alignItems:"end", gap:9, minHeight:160 }}>
        {data.map(m => <div key={m.key} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
          <div style={{ height:120, display:"flex", alignItems:"end", gap:3 }}>
            <div title={`Prospects ${m.prospects}`} style={{ width:9, height:Math.max(4, (m.prospects / max) * 115), background:"#4db8ff", borderRadius:"6px 6px 0 0" }}/>
            <div title={`RDV ${m.rdv}`} style={{ width:9, height:Math.max(4, (m.rdv / max) * 115), background:"#FFC200", borderRadius:"6px 6px 0 0" }}/>
            <div title={`Signatures ${m.signatures}`} style={{ width:9, height:Math.max(4, (m.signatures / max) * 115), background:SU, borderRadius:"6px 6px 0 0" }}/>
          </div>
          <div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800 }}>{m.label}</div>
        </div>)}
      </div>
    </div>
  );
}

function buildV6Data({ clients=[], biens=[], propositions=[], planning=[], actions=[] }) {
  const today = todayIso();
  const { startWeek, endWeek } = getWeekRange();
  const prospects = clients.filter(c => (c.statut || "Prospect") === "Prospect");
  const clientsMetier = clients.filter(c => (c.statut || "") !== "Prospect" && (c.statut || "") !== "Terminé");
  const openActions = actions.filter(isOpenAction);
  const doneActions = actions.filter(isDoneAction);
  const lateActions = openActions.filter(a => a.due_date && isDueTodayOrPast(a.due_date));
  const blockedActions = openActions.filter(isBlockedAction);
  const partnerActions = openActions.filter(isPartnerAction);
  const docActions = openActions.filter(isDocumentAction);

  const collaboratorNames = V6_BASE_COLLABORATORS;
  const collaboratorStats = collaboratorNames.reduce((acc, name) => {
    const list = actions.filter(a => normTxt(actionOwner(a)).includes(normTxt(name)));
    acc[name] = { open:list.filter(isOpenAction).length, late:list.filter(a => isOpenAction(a) && a.due_date && isDueTodayOrPast(a.due_date)).length, blocked:list.filter(isBlockedAction).length, doneToday:list.filter(a => isDoneAction(a) && isWithin(a.updated_at || a.completed_at || a.done_at, today, today)).length };
    return acc;
  }, {});

  const prospectItems = prospects.map(c => {
    const pc = prospectClass(c);
    const relanceCount = Number(c.relance_count || c.nb_relances || 0) || 0;
    return {
      type:"prospect", id:c.id, source:"invest_clients", label:getClientName(c), category:pc.label, level:pc.level,
      badges:pc.badges, reason:pc.reason, responsable:c.conseiller || "Matthieu", defaultAction:c.prochaine_action || "Définir la prochaine action prospect",
      requiresNextAction:true, requiresDate:true, readOnly:Boolean(pc.readOnly), scheduledFuture:Boolean(pc.scheduledFuture), critical:!pc.readOnly && (pc.level !== "info" || pc.score >= 70),
      suggestedDueDate:nextRelanceDateFromCount(relanceCount), score:pc.score,
      meta:`Score ${pc.score}/100 · Budget ${fmtDashboardEur(c.budget)} · ${c.etape || "Étape non renseignée"}`,
      details:`Source : ${c.source || "—"} · Prochaine action : ${c.prochaine_action || "—"} · Relance : ${safeDate(c.date_prochaine_action)} · Relance proposée : ${safeDate(nextRelanceDateFromCount(relanceCount))}`,
      raw:c,
    };
  }).sort((a,b) => ({ danger:0, warning:1, success:2, info:3 }[a.level] - { danger:0, warning:1, success:2, info:3 }[b.level] || (b.score || 0) - (a.score || 0)));

  const clientItems = clientsMetier.map(c => {
    const noStage = !c.etape;
    const noOwner = !c.conseiller;
    const noNextAction = !c.prochaine_action || !c.date_prochaine_action;
    const last = daysSince(lastClientActivity(c));
    const hasDoc = docActions.some(a => a.client_id === c.id);
    const hasFutureAction = Boolean(c.date_prochaine_action && isFutureDate(c.date_prochaine_action));
    const blockedAction = blockedActions.some(a => a.client_id === c.id);
    const blocked = noStage || noOwner || noNextAction || hasDoc || blockedAction;
    const scheduledReadOnly = hasFutureAction && !noStage && !noOwner && !noNextAction && !hasDoc && !blockedAction;
    const level = scheduledReadOnly ? "info" : noStage || noOwner || noNextAction || (last !== null && last >= 10) ? "danger" : hasDoc || (last !== null && last >= 7) ? "warning" : "info";
    const reason = scheduledReadOnly ? readOnlyReasonFromDate(c.date_prochaine_action) : noStage ? "Étape non renseignée" : noOwner ? "Client sans responsable" : noNextAction ? "Client sans prochaine action datée" : last !== null && last >= 10 ? `Sans avancée depuis ${last} jours` : hasDoc ? "Document manquant / à contrôler" : last !== null && last >= 7 ? `Sans avancée depuis ${last} jours` : "Sous contrôle";
    return {
      type:"client", id:c.id, source:"invest_clients", label:getClientName(c), category:c.etape || "Étape non renseignée", level,
      reason, responsable:c.conseiller || "Matthieu", defaultAction:c.prochaine_action || "Définir l’action future du dossier",
      requiresNextAction:true, requiresDate:true, readOnly:Boolean(scheduledReadOnly), scheduledFuture:Boolean(scheduledReadOnly), critical:!scheduledReadOnly && (blocked || level !== "info"),
      meta:`Statut ${c.statut || "—"} · Budget ${fmtDashboardEur(c.budget)}`,
      details:`Étape : ${c.etape || "—"} · Prochaine action : ${c.prochaine_action || "—"} · Date : ${safeDate(c.date_prochaine_action)} · Responsable : ${c.conseiller || "—"}`,
      raw:c,
    };
  }).sort((a,b) => ({ danger:0, warning:1, info:2, success:3 }[a.level] - { danger:0, warning:1, info:2, success:3 }[b.level]));

  const biensActifs = biens.filter(b => !["archivé", "archive", "terminé", "termine", "refusé", "refuse"].some(s => normTxt(b.statut || "").includes(s)));
  const bienItems = biensActifs.map(b => {
    const bc = bienClass(b);
    return {
      type:"bien", id:b.id, source:"invest_biens", label:getBienLabel(b), category:bc.label, level:bc.level,
      reason:bc.reason, responsable:b.conseiller_profero || "Benjamin", defaultAction:"Prévoir l’action suivante sur le bien",
      requiresNextAction:true, requiresDate:true, readOnly:Boolean(bc.readOnly), scheduledFuture:Boolean(bc.scheduledFuture), critical:!bc.readOnly && bc.level !== "info",
      meta:`${b.statut || "Statut non renseigné"}`,
      details:`Prix ${fmtDashboardEur(b.prix_vente)} · Travaux ${fmtDashboardEur(b.prix_travaux)} · Coût total ${fmtDashboardEur(b.cout_total)} · Rendement ${b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "—"} · Cash-flow ${fmtDashboardEur(b.cashflow_estime)} · Score ${bc.score}`,
      raw:b,
    };
  }).sort((a,b) => ({ danger:0, warning:1, success:2, info:3 }[a.level] - { danger:0, warning:1, success:2, info:3 }[b.level]));

  const urgencyItems = [
    ...lateActions.map(a => ({ type:"urgence", id:`action-${a.id}`, source:"invest_mission_actions", sourceId:a.id, label:actionTitle(a), category:(a.due_date === today ? "Tâche du jour" : "Tâche en retard"), level:"danger", reason:`Échéance ${safeDate(a.due_date)} · ${a.client ? getClientName(a.client) : ""}`, responsable:actionOwner(a) || "Matthieu", defaultAction:actionTitle(a), requiresNextAction:true, requiresDate:true, critical:true, raw:a })),
    ...prospectItems.filter(i => i.level === "danger").slice(0, 20).map(i => ({ ...i, type:"urgence", id:`prospect-${i.id}`, originalType:"prospect" })),
    ...clientItems.filter(i => i.level === "danger").slice(0, 20).map(i => ({ ...i, type:"urgence", id:`client-${i.id}`, originalType:"client" })),
    ...bienItems.filter(i => i.level === "danger").slice(0, 20).map(i => ({ ...i, type:"urgence", id:`bien-${i.id}`, originalType:"bien" })),
  ];

  const monthSeries = Array.from({ length:12 }, (_, idx) => {
    const d = toDate(new Date());
    d.setDate(1); d.setMonth(d.getMonth() - (11 - idx));
    const key = monthKey(d);
    return { key, label:monthLabel(d), prospects:prospects.filter(c => monthKey(c.created_at) === key).length, rdv:planning.filter(p => monthKey(p.date_rdv) === key).length, signatures:clients.filter(c => monthKey(c.date_signature) === key).length };
  });

  const signedThisMonth = clients.filter(c => monthKey(c.date_signature) === monthKey(new Date())).length;
  const rdvThisMonth = planning.filter(p => monthKey(p.date_rdv) === monthKey(new Date())).length;
  const prospectsThisMonth = prospects.filter(p => monthKey(p.created_at) === monthKey(new Date())).length;

  return {
    today, startWeek, endWeek, prospects, clientsMetier, biens:biensActifs, propositions, planning, actions,
    prospectItems, clientItems, bienItems, urgencyItems, collaboratorStats,
    stats:{
      lateActions:lateActions.length, blockedActions:blockedActions.length, prospectsRed:prospectItems.filter(i => i.level === "danger").length, prospectsOrange:prospectItems.filter(i => i.level === "warning").length,
      clientsBlocked:clientItems.filter(i => i.level === "danger").length, biensToAct: bienItems.filter(i => i.critical).length, actionsCreated:0,
      prospects:prospects.length, clients:clientsMetier.length, biens:biens.length, rdvToday:planning.filter(p => p.date_rdv === today).length,
      caBaseMonth:signedThisMonth * HONORAIRE_BASE_CONTRAT_HT, rdvThisMonth, prospectsThisMonth, signedThisMonth,
    },
    monthSeries,
    partnerActions, docActions, openActions, doneActions,
  };
}

function actionPlanFromRoutine(routine, data) {
  const lines = [];
  safeArr(routine.priorities).forEach((p, idx) => {
    if (isPriorityComplete(p)) lines.push({ responsable:p.responsable, title:`Priorité ${idx + 1} — ${p.title}`, due_date:p.due_date, comment:p.comment, source:"Priorité" });
  });
  Object.entries(routine.collaborators || {}).forEach(([name, c]) => {
    if (isCollaboratorComplete(c)) lines.push({ responsable:name, title:c.mission, due_date:todayIso(), comment:c.consigne, source:"Collaborateur" });
  });
  const allItems = [...data.urgencyItems, ...data.prospectItems, ...data.clientItems, ...data.bienItems];
  Object.entries(routine.decisions || {}).forEach(([key, d]) => {
    if (!d || !String(d.next_action || "").trim()) return;
    const item = allItems.find(i => decisionKey(i) === key);
    lines.push({ responsable:d.responsable || "Matthieu", title:d.next_action, due_date:d.due_date || "", comment:d.comment || "", source:item?.label || key, decision:d.decision || "" });
  });
  return lines;
}

function printActionPlanPDF(routine, data) {
  const lines = actionPlanFromRoutine(routine, data);
  const grouped = V6_RESPONSABLES.reduce((acc, r) => ({ ...acc, [r]:lines.filter(l => (l.responsable || "") === r) }), {});
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan d'action ${todayIso()}</title><style>body{font-family:Arial,sans-serif;color:#0D2E5C;margin:32px}h1{font-size:24px;margin:0 0 6px}h2{margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#667085}.item{margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:8px}.title{font-weight:700}.meta{font-size:12px;color:#667085;margin-top:4px}</style></head><body><h1>Plan d'action du jour — Profero Invest</h1><div class="muted">Routine du ${todayIso()}</div>${Object.entries(grouped).map(([r,list]) => list.length ? `<h2>${r}</h2>${list.map(l => `<div class="item"><div class="title">${l.title || "Action"}</div><div class="meta">Échéance : ${l.due_date || "—"} · Source : ${l.source || "—"} · Décision : ${l.decision || "—"}</div><div>${l.comment || ""}</div></div>`).join("")}` : "").join("")}<h2>Points bloquants</h2>${Object.entries(routine.decisions || {}).filter(([,d]) => normTxt(d.decision || "").includes("bloquer") || normTxt(d.decision || "").includes("arbitrage")).map(([k,d]) => `<div class="item"><div class="title">${k}</div><div>${d.comment || d.force_reason || ""}</div></div>`).join("") || "<div class='muted'>Aucun point bloquant saisi.</div>"}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}


function isDueWithinDays(value, days=7) {
  const d = toDate(value);
  const t = toDate(new Date());
  if (!d || !t) return false;
  const end = new Date(t);
  end.setDate(end.getDate() + days);
  return d >= t && d <= end;
}

function getLooseAmount(row={}) {
  const keys = ["montant_attente", "montant_restant", "reste_a_payer", "montant_ttc", "ttc", "montant_ht", "ht", "amount", "montant", "total_ttc", "total", "honoraire", "honoraires", "value"];
  for (const key of keys) {
    const raw = row?.[key];
    const n = typeof raw === "number" ? raw : Number(String(raw || "").replace(/[^0-9,.-]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function isPaidLike(row={}) {
  const txt = normTxt(`${row.statut || ""} ${row.status || ""} ${row.paiement_statut || ""} ${row.reglement || ""} ${row.regle || ""} ${row.paid || ""} ${row.encaisse || ""} ${row.encaissement || ""}`);
  return txt.includes("regle") || txt.includes("régl") || txt.includes("paye") || txt.includes("payé") || txt.includes("paid") || txt.includes("encaiss");
}

function isIncomeLike(row={}) {
  const txt = normTxt(`${row.type || ""} ${row.categorie || ""} ${row.category || ""} ${row.libelle || ""} ${row.label || ""} ${row.description || ""} ${row.source || ""}`);
  return txt.includes("encaisse") || txt.includes("honoraire") || txt.includes("forfait") || txt.includes("client") || txt.includes("vente") || txt.includes("facture") || txt.includes("commission");
}

function computeCoverageEncaissement(financeRows=[], fallbackAmount=0) {
  const rows = safeArr(financeRows);
  const total = rows.reduce((sum, row) => {
    if (isPaidLike(row)) return sum;
    if (!isIncomeLike(row) && !getLooseAmount(row)) return sum;
    return sum + getLooseAmount(row);
  }, 0);
  return total > 0 ? total : fallbackAmount;
}

function coverageCount(v) { return safeArr(v).length; }

function computeCriticalBarStats(data, clients=[], biens=[], actions=[]) {
  const relancesProspects = safeArr(data.prospectItems).filter(i => i.level === "danger" && !i.readOnly).length;
  const relancesClients = safeArr(data.clientItems).filter(i => i.level === "danger" && !i.readOnly).length;
  const relancesBiens = safeArr(data.bienItems).filter(i => i.level === "danger" && !i.readOnly).length;
  const relancesRetard = relancesProspects + relancesClients + relancesBiens;

  const tachesBloquees = safeArr(actions).filter(a => isBlockedAction(a) || (isOpenAction(a) && a.due_date && isDueTodayOrPast(a.due_date))).length;

  const echeances7J = [
    ...safeArr(actions).filter(a => isPartnerAction(a) && isDueWithinDays(a.due_date, 7)),
    ...safeArr(clients).filter(c => isDueWithinDays(c.date_prochaine_action, 7) && normTxt(`${c.prochaine_action || ""} ${c.etape || ""}`).match(/notaire|financement|banque|compromis|document/)),
    ...safeArr(biens).filter(b => isDueWithinDays(b.date_relance, 7) && normTxt(b.statut || "").includes("offre")),
  ].length;

  const encaissementAttente = safeArr(clients).filter(c => {
    const signed = Boolean(c.date_signature) || normTxt(c.statut || "").includes("actif");
    const paiementTxt = normTxt(`${c.statut_paiement || ""} ${c.paiement_statut || ""} ${c.honoraire_regle || ""} ${c.reglement || ""} ${c.paid || ""}`);
    const paid = paiementTxt.includes("regle") || paiementTxt.includes("régl") || paiementTxt.includes("pay") || paiementTxt.includes("encaiss");
    return signed && !paid;
  }).length * HONORAIRE_BASE_CONTRAT_HT;

  return { relancesRetard, tachesBloquees, echeances7J, encaissementAttente };
}

function CriticalBar({ stats, T=THEMES_INV.dark, onSelect }) {
  const cards = [
    { key:"relances", label:"Relances en retard", value:stats.relancesRetard, icon:Phone, color:stats.relancesRetard ? DA : SU, hint:"Prospects + clients + biens" },
    { key:"equipe", label:"Tâches bloquées", value:stats.tachesBloquees, icon:AlertTriangle, color:stats.tachesBloquees ? DA : SU, hint:"Équipe / actions" },
    { key:"echeances", label:"Échéances < 7 jours", value:stats.echeances7J, icon:Calendar, color:stats.echeances7J ? WA : SU, hint:"Notaire / financement / offres" },
    { key:"encaissements", label:"Encaissements attente", value:fmtDashboardEur(stats.encaissementAttente), icon:Euro, color:stats.encaissementAttente ? WA : SU, hint:"Forfaits signés non payés" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.xl }}>
      {cards.map(c => <button key={c.key} type="button" onClick={() => onSelect?.(c.key)} style={{ border:`1px solid ${c.color}55`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, textAlign:"left", cursor:"pointer", fontFamily:"inherit", boxShadow:T.shadowSm }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <span style={{ width:34, height:34, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", color:c.color, background:`${c.color}14` }}><Icon as={c.icon} size={17}/></span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xl.size, fontWeight:900, color:c.color }}>{c.value}</span>
        </div>
        <div style={{ fontSize:FONT.sm.size+1, fontWeight:900, color:T.text, marginTop:9 }}>{c.label}</div>
        <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{c.hint}</div>
      </button>)}
    </div>
  );
}

function NotificationsCollaborateurs({ notifications=[], T=THEMES_INV.dark, onOpen }) {
  const unread = safeArr(notifications).filter(n => !n.read_at && n.status !== "read");
  return (
    <SectionCard title="Notifications collaborateurs" icon={Bell} subtitle="Actions créées depuis le dashboard et retours équipe" T={T}>
      {unread.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted }}>Aucune notification collaborateur à traiter.</div> : <div style={{ display:"grid", gap:8 }}>
        {unread.slice(0,12).map(n => <button key={n.id} type="button" onClick={() => onOpen?.({ type:n.linked_entity_type || n.item_type, id:n.linked_entity_id || n.item_id, source:n.source_module })} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:SPACING.md, textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><div style={{ fontWeight:900, color:T.text }}>{n.title || "Notification action"}</div><AlertBadge level={n.priority === "high" ? "danger" : "info"} T={T}>{n.recipient || "Équipe"}</AlertBadge></div>
          <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:4 }}>{n.message || n.comment || "Action liée au dashboard quotidien"}</div>
          <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:4 }}>Lien : {n.linked_entity_type || "—"} · {n.linked_entity_id || "—"}</div>
        </button>)}
      </div>}
    </SectionCard>
  );
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeStep, setActiveStep] = useState("prospects");
  const [quickMode, setQuickMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [optionalErrors, setOptionalErrors] = useState([]);
  const [clients, setClients] = useState([]);
  const [biens, setBiens] = useState([]);
  const [propositions, setPropositions] = useState([]);
  const [planning, setPlanning] = useState([]);
  const [actions, setActions] = useState([]);
  const [history, setHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [coverageData, setCoverageData] = useState({
    documents:[], finance:[], structuration:[], routineItems:[], recurrences:[], actionLinks:[], notifications:[], planning:[], propositions:[]
  });
  const [routine, setRoutine] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKeyFor());
      return saved ? { ...emptyRoutineState(), ...JSON.parse(saved) } : emptyRoutineState();
    } catch { return emptyRoutineState(); }
  });

  const loadDashboard = useCallback(async () => {
    setLoading(true); setError(""); setOptionalErrors([]);

    // Les tables principales doivent être disponibles.
    // Les tables secondaires restent silencieuses si elles ne sont pas encore installées
    // afin de ne pas afficher un bandeau d'alerte inutile dans la routine.
    const safeQuery = async (label, query, options = {}) => {
      const { required = false, silent = false } = options;
      try {
        const { data, error } = await query;
        if (error) {
          console.warn(`[Dashboard V7.1] ${label} non disponible :`, error);
          if (required) setError(`Impossible de charger ${label}. Vérifie la table Supabase ou les droits RLS.`);
          else if (!silent) setOptionalErrors(prev => [...prev, `${label} : ${error.message || "non disponible"}`]);
          return [];
        }
        return data || [];
      } catch (e) {
        console.warn(`[Dashboard V7.1] ${label} non disponible :`, e);
        if (required) setError(`Impossible de charger ${label}. Vérifie la connexion Supabase.`);
        else if (!silent) setOptionalErrors(prev => [...prev, `${label} : non disponible`]);
        return [];
      }
    };

    const [
      c,b,p,pl,a,h,n,
      docsMain, docsClients, docsBiens, driveLinks,
      financeMain, financeAlt, suiviFinancier,
      structuration, routineItems, recurrences, actionLinks
    ] = await Promise.all([
      safeQuery("les clients", supabase.from("invest_clients").select("*").order("created_at", { ascending:false }), { required:true }),
      safeQuery("les biens", supabase.from("invest_biens").select("*").order("created_at", { ascending:false }), { required:true }),
      safeQuery("Propositions", supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition,bien:invest_biens(id,montant_offre,prix_vente,statut)"), { silent:true }),
      safeQuery("Planning", supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire,created_at,updated_at").order("date_rdv", { ascending:false }).limit(300), { silent:true }),
      safeQuery("Actions", supabase.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").order("due_date", { ascending:true, nullsFirst:false }).limit(500), { silent:true }),
      safeQuery("Historique routines", supabase.from("invest_morning_routines").select("*").order("routine_date", { ascending:false }).limit(30), { silent:true }),
      safeQuery("Notifications actions", supabase.from("invest_action_notifications").select("*").order("created_at", { ascending:false }).limit(80), { silent:true }),

      // Couverture des autres onglets/modules : ces tables restent optionnelles.
      // Si une table n'existe pas encore, la routine continue sans bandeau d'erreur.
      safeQuery("Documents", supabase.from("invest_documents").select("*").limit(500), { silent:true }),
      safeQuery("Documents clients", supabase.from("invest_client_documents").select("*").limit(500), { silent:true }),
      safeQuery("Documents biens", supabase.from("invest_bien_documents").select("*").limit(500), { silent:true }),
      safeQuery("Liens Google Drive", supabase.from("invest_google_drive_links").select("*").limit(500), { silent:true }),
      safeQuery("Suivi financier", supabase.from("invest_suivi_financier").select("*").limit(700), { silent:true }),
      safeQuery("Finance", supabase.from("invest_finance").select("*").limit(700), { silent:true }),
      safeQuery("Encaissements", supabase.from("invest_encaissements").select("*").limit(700), { silent:true }),
      safeQuery("Structuration patrimoniale", supabase.from("invest_structuration_patrimoniale").select("*").limit(300), { silent:true }),
      safeQuery("Décisions routines", supabase.from("invest_morning_routine_items").select("*").order("created_at", { ascending:false }).limit(300), { silent:true }),
      safeQuery("Reports récurrents", supabase.from("invest_morning_routine_recurrences").select("*").order("updated_at", { ascending:false }).limit(300), { silent:true }),
      safeQuery("Liens actions dashboard", supabase.from("invest_dashboard_action_links").select("*").order("created_at", { ascending:false }).limit(300), { silent:true }),
    ]);
    const documents = [...safeArr(docsMain), ...safeArr(docsClients), ...safeArr(docsBiens), ...safeArr(driveLinks)];
    const finance = [...safeArr(financeMain), ...safeArr(financeAlt), ...safeArr(suiviFinancier)];
    setClients(c); setBiens(b); setPropositions(p); setPlanning(pl); setActions(a); setHistory(h); setNotifications(n);
    setCoverageData({ documents, finance, structuration, routineItems, recurrences, actionLinks, notifications:n, planning:pl, propositions:p });
    setLoading(false);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { try { window.localStorage.setItem(storageKeyFor(), JSON.stringify(routine)); } catch {} }, [routine]);

  const data = useMemo(() => buildV6Data({ clients, biens, propositions, planning, actions }), [clients, biens, propositions, planning, actions]);
  const collaborators = useMemo(() => ["Matthieu", "Tom", "Benjamin", "Camille"], []);
  const unresolvedUrgencyItems = useMemo(() => data.urgencyItems.filter(item => !isResolvedToday(routine, item)), [data.urgencyItems, routine]);
  const visibleProspects = (quickMode ? data.prospectItems.filter(i => !i.readOnly && (i.level === "danger" || i.score >= 70)) : data.prospectItems.filter(i => i.critical || i.readOnly)).filter(item => !isResolvedToday(routine, item));
  const visibleClients = (quickMode ? data.clientItems.filter(i => i.level === "danger") : data.clientItems).filter(item => !isResolvedToday(routine, item));
  const visibleBiens = (quickMode ? data.bienItems.filter(i => !i.readOnly && (i.level === "danger" || normTxt(i.category).includes("offre"))) : data.bienItems.filter(i => i.critical || i.readOnly)).filter(item => !isResolvedToday(routine, item));
  const clientDecisionItems = data.clientItems.filter(i => i.critical && !i.readOnly && !isResolvedToday(routine, i));
  const allRequiredItems = useMemo(() => uniqueItemsByDecisionKey([
    ...data.prospectItems.filter(i => i.critical && !i.readOnly && !isResolvedToday(routine, i)),
    ...clientDecisionItems.filter(i => !i.readOnly),
    ...data.bienItems.filter(i => i.critical && !i.readOnly && !isResolvedToday(routine, i)),
  ]), [data, routine, clientDecisionItems]);
  const allItemsForSave = useMemo(() => uniqueItemsByDecisionKey([...data.prospectItems, ...data.clientItems, ...data.bienItems]), [data]);
  const incompleteItems = allRequiredItems.filter(item => !isDecisionComplete(item, routine.decisions[decisionKey(item)]));
  const incompleteCollaborators = [];
  const prioritiesOk = safeArr(routine.priorities).every(isPriorityComplete);
  const finalOk = prioritiesOk && incompleteCollaborators.length === 0 && incompleteItems.length === 0;
  const plan = useMemo(() => actionPlanFromRoutine(routine, data), [routine, data]);
  const criticalBarStats = useMemo(() => {
    const base = computeCriticalBarStats(data, clients, biens, actions);
    return { ...base, encaissementAttente:computeCoverageEncaissement(coverageData.finance, base.encaissementAttente) };
  }, [data, clients, biens, actions, coverageData.finance]);

  const updateDecision = (item, value) => setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(item)]:value } }));

  const resolveUrgencyForToday = (item, decisionLabel="Traiter moi-même") => {
    ensureStarted();
    const key = decisionKey(item);
    const currentBeforeResolve = routine.decisions?.[key] || defaultDecision(item);
    if (!isDecisionComplete(item, currentBeforeResolve)) {
      setError(`Validation impossible : complète d’abord ${missingDecisionFields(item, currentBeforeResolve).join(", ")}.`);
      return;
    }
    const entityKey = routineEntityKey(item);
    setRoutine(prev => {
      const current = prev.decisions?.[key] || defaultDecision(item);
      const nextDecision = {
        ...current,
        decision:current.decision || decisionLabel,
        comment:current.comment || `Urgence validée dans la morning routine du ${todayIso()}.`,
        responsable:current.responsable || item.responsable || "Matthieu",
        next_action:current.next_action || item.defaultAction || `Suivi ${item.label}`,
        due_date:current.due_date || todayIso(),
        create_task:decisionLabel === "Traiter moi-même" ? false : true,
        resolved_at:new Date().toISOString(),
      };
      const info = {
        resolved_at:new Date().toISOString(),
        decision:nextDecision.decision,
        label:item.label,
        entity_key:entityKey,
      };
      return {
        ...prev,
        decisions:{ ...prev.decisions, [key]:nextDecision },
        resolvedUrgencies:{ ...(prev.resolvedUrgencies || {}), [key]:info, [entityKey]:info },
      };
    });
  };

  const undoResolvedUrgency = (resolvedKey) => {
    setRoutine(prev => {
      const next = { ...(prev.resolvedUrgencies || {}) };
      const info = next[resolvedKey];
      delete next[resolvedKey];
      if (info?.entity_key) delete next[info.entity_key];
      Object.entries(next).forEach(([k, v]) => {
        if (v?.entity_key === resolvedKey || v?.entity_key === info?.entity_key) delete next[k];
      });
      return { ...prev, resolvedUrgencies:next };
    });
  };

  const updateChecklist = (step, id, checked) => setRoutine(prev => ({ ...prev, checklist:{ ...prev.checklist, [step]:{ ...(prev.checklist[step] || {}), [id]:checked } } }));
  const updateStepNote = (step, value) => setRoutine(prev => ({ ...prev, stepNotes:{ ...prev.stepNotes, [step]:value } }));

  const ensureStarted = () => setRoutine(prev => prev.status === "not_started" ? { ...prev, status:"in_progress", started_at:new Date().toISOString() } : prev);

  const createActionNotification = async ({ actionId, responsable, title, message, linked_entity_type=null, linked_entity_id=null, priority="normal" }) => {
    if (!responsable || responsable === "Matthieu") return;
    try {
      await supabase.from("invest_action_notifications").insert({
        action_id:actionId || null,
        recipient:responsable,
        title:title || "Nouvelle action assignée",
        message:message || "Action créée depuis le Dashboard Pilotage Quotidien.",
        linked_entity_type:linked_entity_type || null,
        linked_entity_id:linked_entity_id ? String(linked_entity_id) : null,
        priority,
        status:"unread",
        source_module:"dashboard_v7_1",
        created_by:profil?.email || profil?.nom || "Matthieu",
      });
    } catch (e) {
      console.warn("Notification collaborateur non bloquante", e);
    }
  };

  const createMissionAction = async ({ responsable, title, due_date, client_id=null, step_label="Dashboard V7.1", comment="", linked_entity_type=null, linked_entity_id=null, priority="normal" }) => {
    if (!responsable || !title) return null;
    const basePayload = { responsable, action_title:title, due_date:due_date || null, status:"a_faire", step_label, client_id };
    const linkedPayload = {
      ...basePayload,
      linked_entity_type:linked_entity_type || null,
      linked_entity_id:linked_entity_id ? String(linked_entity_id) : null,
      source_module:"dashboard_v7_1",
      source_context:{ comment, created_from:"dashboard_pilotage_quotidien", routine_date:todayIso() },
    };
    let created = null;
    let insertError = null;
    const first = await supabase.from("invest_mission_actions").insert(linkedPayload).select("id").single();
    if (first.error) {
      insertError = first.error;
      const fallback = await supabase.from("invest_mission_actions").insert(basePayload).select("id").single();
      if (fallback.error) throw fallback.error;
      created = fallback.data;
    } else {
      created = first.data;
    }
    const actionId = created?.id || null;
    await createActionNotification({ actionId, responsable, title, message:comment, linked_entity_type, linked_entity_id, priority });
    if (insertError) console.warn("Action créée sans colonnes de liaison V7. Exécute la migration V7 pour activer les relations complètes.", insertError);
    return actionId;
  };

  const applyDecision = async (item, d) => {
    if (!item || !d || !d.create_task) return null;
    const baseTitle = d.next_action || `${d.decision} — ${item.label}`;
    let createdTaskId = null;
    if (item.originalType === "prospect" || item.type === "prospect") {
      await supabase.from("invest_clients").update({ prochaine_action:d.next_action || null, date_prochaine_action:d.due_date || null, conseiller:d.responsable || null, statut:normTxt(d.decision).includes("perdu") || normTxt(d.decision).includes("archiver") ? "Inactif" : item.raw?.statut }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date, client_id:item.raw?.id || item.id, step_label:"Dashboard V7.1 — Prospect", comment:d.comment, linked_entity_type:"prospect", linked_entity_id:item.raw?.id || item.id, priority:item.level === "danger" ? "high" : "normal" });
    } else if (item.originalType === "client" || item.type === "client") {
      await supabase.from("invest_clients").update({ prochaine_action:d.next_action || null, date_prochaine_action:d.due_date || item.raw?.date_prochaine_action || null, conseiller:d.responsable || null }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date || null, client_id:item.raw?.id || item.id, step_label:"Dashboard V7.1 — Client", comment:d.comment, linked_entity_type:"client", linked_entity_id:item.raw?.id || item.id, priority:item.level === "danger" ? "high" : "normal" });
    } else if (item.originalType === "bien" || item.type === "bien") {
      const decisionNorm = normTxt(d.decision);
      const nextStatut = decisionNorm.includes("archiver") ? "Archivé" : decisionNorm.includes("visite") ? "À visiter" : decisionNorm.includes("proposer") ? "Proposé à client" : decisionNorm.includes("matcher") ? "À matcher" : decisionNorm.includes("offre") ? "Offre à faire" : decisionNorm.includes("relancer") ? "À relancer" : decisionNorm.includes("prix") ? "Analyse en cours" : decisionNorm.includes("travaux") ? "En travaux" : decisionNorm.includes("attente") ? "À trier" : decisionNorm.includes("analyser") ? "À analyser" : item.raw?.statut;
      await supabase.from("invest_biens").update({ statut:nextStatut, date_relance:d.due_date || item.raw?.date_relance || null, conseiller_profero:d.responsable || null }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:`${baseTitle} — ${item.label}`, due_date:d.due_date || null, step_label:"Dashboard V7.1 — Bien", comment:d.comment, linked_entity_type:"bien", linked_entity_id:item.raw?.id || item.id, priority:item.level === "danger" ? "high" : "normal" });
    } else {
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date || todayIso(), step_label:"Dashboard V7.1 — Urgence", comment:d.comment, linked_entity_type:item.originalType || item.type || "action", linked_entity_id:item.raw?.id || item.sourceId || item.id, priority:item.level === "danger" ? "high" : "normal" });
    }
    return createdTaskId;
  };

  const saveRoutine = async ({ complete=false, forced=false }={}) => {
    setSaving(true); setError("");
    try {
      const routinePayload = { routine_date:todayIso(), status:complete ? "completed" : "in_progress", started_at:routine.started_at || new Date().toISOString(), completed_at:complete ? new Date().toISOString() : null, created_by:profil?.email || profil?.nom || "Matthieu", completion_forced:forced, force_reason:routine.force_reason || null, priorite_1:routine.priorities?.[0]?.title || null, priorite_2:routine.priorities?.[1]?.title || null, priorite_3:routine.priorities?.[2]?.title || null, summary:JSON.stringify({ plan, collaborators:routine.collaborators, stepNotes:routine.stepNotes, resolvedUrgencies:routine.resolvedUrgencies || {} }) };
      let routineId = routine.savedRoutineId;
      if (!routineId) {
        const { data:created, error:insertError } = await supabase.from("invest_morning_routines").insert(routinePayload).select("id").single();
        if (insertError) throw insertError;
        routineId = created?.id;
      } else {
        const { error:updateError } = await supabase.from("invest_morning_routines").update(routinePayload).eq("id", routineId);
        if (updateError) throw updateError;
      }
      const itemRows = [];
      for (const item of allItemsForSave) {
        const d = routine.decisions[decisionKey(item)] || defaultDecision(item);
        if (!String(d.decision || "").trim() && !d.force_validated) continue;
        let createdTaskId = null;
        try { createdTaskId = await applyDecision(item, d); } catch (e) { console.warn("Application décision non bloquante", e); }
        itemRows.push({ routine_id:routineId, routine_date:todayIso(), step_key:item.type, item_type:item.originalType || item.type, item_id:String(item.raw?.id || item.sourceId || item.id || ""), item_label:item.label, alert_level:item.level, decision:d.decision || null, comment:d.comment || null, responsable:d.responsable || null, next_action:d.next_action || null, due_date:d.due_date || null, force_validated:Boolean(d.force_validated), force_reason:d.force_reason || null, status:isDecisionComplete(item,d) ? "validated" : "draft", created_task_id:createdTaskId } );
      }
      if (itemRows.length) await supabase.from("invest_morning_routine_items").insert(itemRows);
      setRoutine(prev => ({ ...prev, savedRoutineId:routineId, status:complete ? "completed" : "in_progress", completed_at:complete ? new Date().toISOString() : prev.completed_at, force_completed:forced }));
      await loadDashboard();
    } catch (e) {
      setError(e?.message || "Impossible d’enregistrer la routine. Vérifie la migration Supabase V7.");
    } finally { setSaving(false); }
  };

  const forceCompleteAllowed = Boolean(String(routine.force_reason || "").trim());

  const openLinkedRecord = (item) => {
    const itemType = item?.originalType || item?.type || "";
    const raw = item?.raw || {};
    const id = raw.id || item?.sourceId || item?.id;
    if (!onNavigate) return;

    if (itemType === "bien" || item?.source === "invest_biens") {
      onNavigate("biens", { type:"open_bien", id, bien_id:id, bienId:id, source:"morning_routine" });
      return;
    }

    if (itemType === "prospect" || itemType === "client" || item?.source === "invest_clients") {
      onNavigate("crm", { type:"open_client", id, client_id:id, clientId:id, statut:raw.statut, source:"morning_routine" });
      return;
    }

    if (item?.source === "invest_mission_actions" && raw.client_id) {
      onNavigate("crm", { type:"open_client", id:raw.client_id, client_id:raw.client_id, clientId:raw.client_id, source:"morning_routine_action" });
      return;
    }

    onNavigate("crm", { type:"actions_week_or_late", source:"morning_routine" });
  };

  const renderChecklist = (stepKey) => {
    const list = V6_CHECKLISTS[stepKey] || [];
    return <div style={{ display:"grid", gap:6 }}>{list.map(ch => <label key={ch.id} style={{ display:"flex", alignItems:"center", gap:8, color:T.textSub, fontSize:FONT.sm.size, fontWeight:800 }}><input type="checkbox" checked={Boolean(routine.checklist?.[stepKey]?.[ch.id])} onChange={e => updateChecklist(stepKey, ch.id, e.target.checked)}/>{ch.label}{ch.required && <span style={{ color:DA }}>*</span>}</label>)}<TextArea label="Note libre de l’étape" value={routine.stepNotes?.[stepKey] || ""} onChange={v => updateStepNote(stepKey, v)} T={T}/></div>;
  };

  const renderItems = (items, empty, compact=false, allowResolve=false, readOnly=false) => {
    if (!items.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>{empty}</div>;
    return (
      <div style={{ display:"grid", gap:SPACING.md }}>
        {items.map(item => (
          <RoutineDecisionCard
            key={decisionKey(item)}
            item={item}
            decision={routine.decisions[decisionKey(item)] || defaultDecision(item)}
            onChange={v => updateDecision(item, v)}
            onResolve={allowResolve ? resolveUrgencyForToday : null}
            T={T}
            compact={compact}
            readOnly={readOnly || item.readOnly}
            onOpen={openLinkedRecord}
          />
        ))}
      </div>
    );
  };

  const renderStep = () => {
    if (activeStep === "urgences") return (
      <>
        <SectionCard title="Urgences à traiter" icon={AlertTriangle} subtitle="Valide chaque urgence pour la faire disparaître de la routine du jour" T={T}>
          {renderItems(unresolvedUrgencyItems, "Aucune urgence critique détectée", quickMode, true)}
        </SectionCard>
        <ResolvedUrgenciesView routine={routine} data={data} onUndo={undoResolvedUrgency} onOpen={openLinkedRecord} T={T}/>
        <SectionCard title="Checklist Urgences" icon={Check} T={T}>{renderChecklist("urgences")}</SectionCard>
      </>
    );
    if (activeStep === "priorites") return <><SectionCard title="3 priorités obligatoires du jour" icon={Sparkles} subtitle="Impossible de terminer la routine sans ces 3 priorités" T={T}><PriorityEditor priorities={routine.priorities} onChange={priorities => setRoutine(prev => ({ ...prev, priorities }))} T={T}/></SectionCard><SectionCard title="Checklist Priorités" icon={Check} T={T}>{renderChecklist("priorites")}</SectionCard></>;
    if (activeStep === "collaborateurs") return <><NotificationsCollaborateurs notifications={notifications} T={T} onOpen={(payload) => { if (!onNavigate) return; if (payload?.type === "bien") onNavigate("biens", { type:"open_bien", id:payload.id, bien_id:payload.id, source:"notification_collaborateur" }); else onNavigate("crm", { type:"open_client", id:payload.id, client_id:payload.id, source:"notification_collaborateur" }); }}/><SectionCard title="Consignes collaborateurs" icon={Users} subtitle="Générées automatiquement à partir des décisions assignées" T={T}><ConsignesCollaborateursView plan={plan} T={T}/></SectionCard><SectionCard title="Checklist Consignes" icon={Check} T={T}>{renderChecklist("collaborateurs")}</SectionCard></>;
    if (activeStep === "prospects") {
      const prospectsDecision = visibleProspects.filter(i => !i.readOnly);
      const prospectsInfo = quickMode ? [] : data.prospectItems.filter(i => i.readOnly && !isResolvedToday(routine, i));
      return <>
        <SectionCard title="Prospects à décider" icon={Phone} subtitle={quickMode ? "Mode rapide : prospects rouges / chauds arrivés à échéance" : "Les échéances futures restent en lecture seule plus bas"} T={T}>{renderItems(prospectsDecision, "Aucun prospect à traiter aujourd’hui", quickMode, true)}</SectionCard>
        {!quickMode && <SectionCard title="Prospects — lecture seule" icon={Eye} subtitle="Échéance non passée : information visible sans décision obligatoire" T={T}><RoutineInfoList items={prospectsInfo} T={T} onOpen={openLinkedRecord}/></SectionCard>}
        <SectionCard title="Checklist Prospects" icon={Check} T={T}>{renderChecklist("prospects")}</SectionCard>
      </>;
    }
    if (activeStep === "clients") {
      const clientsAlertes = visibleClients.filter(i => i.critical && !i.readOnly);
      const clientsOk = quickMode ? [] : visibleClients.filter(i => !i.critical || i.readOnly);
      return <>
        <SectionCard title="Clients à décider" icon={Briefcase} subtitle={quickMode ? "Mode rapide : clients rouges arrivés à échéance" : "Alertes en premier : sans action, sans étape, sans responsable ou sans avancée"} T={T}>{renderItems(clientsAlertes, "Aucun client à traiter aujourd’hui", quickMode, true)}</SectionCard>
        {!quickMode && <SectionCard title="Clients sous contrôle / lecture seule" icon={Check} subtitle="Échéance non passée ou dossier sous contrôle : visible sans décision obligatoire" T={T}><RoutineInfoList items={clientsOk} T={T} onOpen={openLinkedRecord}/></SectionCard>}
        <SectionCard title="Checklist Clients" icon={Check} T={T}>{renderChecklist("clients")}</SectionCard>
      </>;
    }
    if (activeStep === "biens") {
      const biensDecision = visibleBiens.filter(i => !i.readOnly);
      const biensInfo = quickMode ? [] : data.bienItems.filter(i => i.readOnly && !isResolvedToday(routine, i));
      return <>
        <SectionCard title="Stock de biens à décider" icon={Home} subtitle={quickMode ? "Mode rapide : biens rouges / offres arrivées à échéance" : "Biens nécessitant une tâche, une relance ou une décision"} T={T}>{renderItems(biensDecision, "Aucun bien à traiter aujourd’hui", quickMode, true)}</SectionCard>
        {!quickMode && <SectionCard title="Stock de biens — lecture seule" icon={Eye} subtitle="Échéance non passée : information visible sans décision obligatoire" T={T}><RoutineInfoList items={biensInfo} T={T} onOpen={openLinkedRecord}/></SectionCard>}
        <SectionCard title="Checklist Biens" icon={Check} T={T}>{renderChecklist("biens")}</SectionCard>
      </>;
    }
    if (activeStep === "synthese") return <><SectionCard title="Plan d’action court" icon={Send} subtitle="Regroupé par responsable" T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>Plan d’action PDF</button>}><ActionPlanView plan={plan} T={T}/></SectionCard><SectionCard title="Checklist Synthèse" icon={Check} T={T}>{renderChecklist("synthese")}</SectionCard></>;
    return <SectionCard title="Validation finale" icon={Check} T={T}><div style={{ display:"grid", gap:SPACING.md }}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md }}><KPICard icon={Sparkles} label="Priorités complètes" value={prioritiesOk ? "Oui" : "Non"} color={prioritiesOk ? SU : DA}/><KPICard icon={Users} label="Consignes équipe" value={plan.filter(p => p.responsable && p.responsable !== "Matthieu").length} color={T.accent}/><KPICard icon={AlertTriangle} label="Décisions manquantes" value={incompleteItems.length} color={incompleteItems.length ? DA : SU}/><KPICard icon={Send} label="Actions au plan" value={plan.length} color="#FFC200"/></div>{!finalOk && <div style={{ padding:SPACING.md, borderRadius:RADIUS.md, background:SEMANTIC?.danger?.bg || "#fff1f2", border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, color:DA, fontWeight:800 }}>Routine non finalisable : {incompleteItems.length} décision(s) manquante(s), priorités {prioritiesOk ? "OK" : "incomplètes"}.</div>}<TextArea label="Motif de validation forcée" value={routine.force_reason} onChange={v => setRoutine(prev => ({ ...prev, force_reason:v }))} placeholder="Obligatoire si tu veux terminer malgré des éléments incomplets." T={T}/><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className="inv-btn inv-btn-out inv-btn-sm" disabled={saving} onClick={() => saveRoutine({ complete:false })}><Icon as={Save} size={12}/>Enregistrer brouillon</button><button className="inv-btn inv-btn-gold inv-btn-sm" disabled={saving || !finalOk} onClick={() => saveRoutine({ complete:true, forced:false })}><Icon as={Check} size={12}/>Terminer la routine</button><button className="inv-btn inv-btn-sm" style={{ background:DA, color:"white" }} disabled={saving || finalOk || !forceCompleteAllowed} onClick={() => saveRoutine({ complete:true, forced:true })}><Icon as={AlertTriangle} size={12}/>Forcer avec motif</button></div></div></SectionCard>;
  };

  const renderTab = () => {
    if (activeTab === "dashboard") return <div style={{ display:"grid", gridTemplateColumns:"290px minmax(0,1fr)", gap:SPACING.md, alignItems:"start" }} className="inv-v6-routine-layout"><div className="inv-card" style={{ position:"sticky", top:12 }}><div className="inv-card-hd blue">Routine — revue métier</div><div className="inv-card-bd" style={{ display:"grid", gap:7 }}>{V6_STEPS.map(step => { const IconComp = step.icon; const active = activeStep === step.key; const missing = step.key === "priorites" ? (prioritiesOk ? 0 : 1) : step.key === "collaborateurs" ? incompleteCollaborators.length : step.key === "prospects" ? visibleProspects.filter(i => !i.readOnly && (i.critical || !quickMode) && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : step.key === "clients" ? visibleClients.filter(i => i.critical && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : step.key === "biens" ? visibleBiens.filter(i => !i.readOnly && (i.critical || !quickMode) && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : 0; return <button key={step.key} onClick={() => { ensureStarted(); setActiveStep(step.key); }} style={{ border:`1px solid ${active ? T.accentBorder : T.border}`, background:active ? T.accentBg : T.input, color:active ? T.accent : T.textSub, borderRadius:RADIUS.md, padding:"10px 11px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><span style={{ display:"inline-flex", alignItems:"center", gap:8, fontWeight:900 }}><Icon as={IconComp} size={14}/>{step.label}</span>{missing > 0 ? <AlertBadge level="danger" T={T}>{missing}</AlertBadge> : <AlertBadge level="success" T={T}>OK</AlertBadge>}</button> })}</div></div><div>{renderStep()}</div></div>;
    if (activeTab === "plan") return <SectionCard title="Plan d’action du jour" icon={Send} T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>PDF</button>}><ActionPlanView plan={plan} T={T}/></SectionCard>;
    if (activeTab === "suivi") return <SuiviDossiers data={data} coverageData={coverageData} T={T} onNavigate={onNavigate}/>;
    if (activeTab === "historique") return <HistoriqueRoutines history={history} T={T}/>;
    return <VueMensuelle data={data} T={T}/>;
  };

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth:1460, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:SPACING.md, alignItems:"flex-start", flexWrap:"wrap", marginBottom:SPACING.xl }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}><div style={{ width:50, height:50, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={LayoutDashboard} size={24}/></div><div><div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Dashboard Pilotage Quotidien Profero Invest V7.1</div><div style={{ fontSize:FONT.sm.size + 1, color:T.textSub, marginTop:2 }}>Vue 10 secondes, onglets métier, fiche liée au clic et notifications collaborateurs liées aux actions.</div><div style={{ display:"flex", gap:7, flexWrap:"wrap", marginTop:8 }}><AlertBadge level={incompleteItems.length ? "danger" : "success"} T={T}>{incompleteItems.length} décision(s) manquante(s)</AlertBadge><AlertBadge level="info" T={T}>{quickMode ? "Mode rapide" : "Mode strict"}</AlertBadge><AlertBadge level="info" T={T}>{plan.length} action(s) au plan</AlertBadge></div></div></div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setQuickMode(v => !v)}><Icon as={Filter} size={12}/>{quickMode ? "Mode strict" : "Mode rapide"}</button><button className="inv-btn inv-btn-out inv-btn-sm" onClick={loadDashboard}><Icon as={RefreshCw} size={12}/>Actualiser</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>Plan d’action PDF</button></div>
      </div>

      {!loading && <CriticalBar stats={criticalBarStats} T={T} onSelect={(key) => { if (key === "relances") { setActiveTab("dashboard"); setActiveStep("prospects"); } else if (key === "equipe") { setActiveTab("dashboard"); setActiveStep("collaborateurs"); } else if (key === "echeances") { setActiveTab("dashboard"); setActiveStep("clients"); } else if (key === "encaissements") { setActiveTab("mensuel"); } }} />}

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:SPACING.xl }}>{V6_TABS.map(tab => { const active = activeTab === tab.key; return <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ border:`1px solid ${active ? T.accentBorder : T.border}`, background:active ? T.accentBg : T.input, color:active ? T.accent : T.textSub, borderRadius:RADIUS.pill, padding:"9px 13px", display:"inline-flex", alignItems:"center", gap:7, cursor:"pointer", fontFamily:"inherit", fontWeight:900 }}><Icon as={tab.icon} size={14}/>{tab.label}</button> })}</div>
      {error && <div style={{ marginBottom:SPACING.md, padding:SPACING.md, border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, background:SEMANTIC?.danger?.bg || "#fff1f2", borderRadius:RADIUS.md, color:DA }}>{error}</div>}
      {loading ? <div style={{ padding:SPACING.xxxl, textAlign:"center", color:T.textMuted }}><Icon as={RefreshCw} size={15} style={{ animation:"spin 1s linear infinite" }}/> Chargement…</div> : renderTab()}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @media(max-width:980px){.inv-v6-routine-layout{grid-template-columns:1fr!important}.inv-card[style*="sticky"]{position:relative!important;top:auto!important}}`}</style>
    </div>
  );
}

function ActionPlanView({ plan=[], T=THEMES_INV.dark }) {
  if (!plan.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucune action générée pour le moment. Complète la routine pour construire le plan d’action.</div>;
  const responsables = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  return <div style={{ display:"grid", gap:SPACING.md }}>{responsables.map(r => <div key={r} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text, marginBottom:8 }}>{r}</div>{plan.filter(p => (p.responsable || "À définir") === r).map((p, i) => <div key={i} style={{ padding:"8px 0", borderTop:i ? `1px solid ${T.border}` : "none" }}><div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text }}>{p.title}</div><div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:2 }}>Échéance : {safeDate(p.due_date)} · Source : {p.source || "—"}</div>{p.comment && <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:4 }}>{p.comment}</div>}</div>)}</div>)}</div>;
}

function DataCoveragePanel({ data, coverageData={}, T=THEMES_INV.dark }) {
  const biens = safeArr(data?.biens);
  const modules = [
    { label:"CRM prospects", value:data?.stats?.prospects || 0, detail:"Score, relances, responsable, prochaine action", level:(data?.stats?.prospectsRed || 0) ? "danger" : "success", icon:Phone },
    { label:"CRM clients", value:data?.stats?.clients || 0, detail:"Étapes, prochaine action, documents, responsables", level:(data?.stats?.clientsBlocked || 0) ? "danger" : "success", icon:Briefcase },
    { label:"Stock de biens", value:data?.stats?.biens || 0, detail:"Statuts, relances, offres, analyse, visite terrain", level:(data?.stats?.biensToAct || 0) ? "warning" : "success", icon:Home },
    { label:"Propositions / matching", value:coverageCount(coverageData.propositions), detail:"Biens proposés aux clients et offres actives", level:coverageCount(coverageData.propositions) ? "info" : "warning", icon:Handshake },
    { label:"Planning / échéances", value:coverageCount(coverageData.planning), detail:"RDV, visites, notaire, financement, relances", level:coverageCount(coverageData.planning) ? "info" : "warning", icon:Calendar },
    { label:"Actions équipe", value:coverageCount(data?.openActions), detail:"Actions assignées, bloquées, en retard, notifications", level:(data?.stats?.blockedActions || 0) ? "danger" : "success", icon:Users },
    { label:"Documents / Drive", value:coverageCount(coverageData.documents), detail:"Contrats, fiches patrimoine, pièces, documents biens", level:coverageCount(coverageData.documents) ? "success" : "warning", icon:FileText },
    { label:"Simulateur / analyse", value:biens.filter(hasSimulateurBien).length, detail:"Rentabilité, cash-flow, travaux, lots, analyse financière du bien", level:biens.filter(hasSimulateurBien).length ? "success" : "warning", icon:BarChart3 },
    { label:"Visite terrain", value:biens.filter(b => Boolean(b.visite_data)).length, detail:"Données de visite terrain rattachées au bien", level:biens.filter(b => Boolean(b.visite_data)).length ? "success" : "warning", icon:Eye },
    { label:"Encaissements / financier", value:coverageCount(coverageData.finance), detail:"Forfaits signés non payés, honoraires, suivi financier", level:coverageCount(coverageData.finance) ? "success" : "warning", icon:Euro },
    { label:"Structuration patrimoniale", value:coverageCount(coverageData.structuration), detail:"Profils, collecte, stratégie et documents patrimoniaux", level:coverageCount(coverageData.structuration) ? "success" : "warning", icon:Wallet },
    { label:"Historique routine", value:coverageCount(coverageData.routineItems) + coverageCount(coverageData.recurrences), detail:"Décisions, reports, alertes récurrentes", level:coverageCount(coverageData.routineItems) ? "success" : "warning", icon:FileText },
  ];
  return (
    <SectionCard title="Couverture des données par onglet" icon={LayoutGrid} subtitle="Contrôle que le dashboard exploite bien les données utiles de l’application" T={T}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:SPACING.md }}>
        {modules.map(m => {
          const color = levelColor(m.level, T);
          return (
            <div key={m.label} style={{ border:`1px solid ${color}44`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:900, color:T.text }}><Icon as={m.icon} size={15}/>{m.label}</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontWeight:900, color }}>{m.value}</span>
              </div>
              <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:6, lineHeight:1.35 }}>{m.detail}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop:SPACING.md, padding:SPACING.md, border:`1px solid ${T.border}`, background:T.card, borderRadius:RADIUS.md, fontSize:FONT.sm.size, color:T.textSub }}>
        Les modules en orange ne bloquent pas le dashboard : cela signifie simplement que la table dédiée n’est pas encore présente ou pas encore alimentée. Le dashboard utilise alors les données principales existantes, notamment clients, biens, actions et planning.
      </div>
    </SectionCard>
  );
}

function SuiviDossiers({ data, coverageData={}, T=THEMES_INV.dark, onNavigate }) {
  return <div style={{ display:"grid", gap:SPACING.md }}>
    <DataCoveragePanel data={data} coverageData={coverageData} T={T}/>
    <SectionCard title="Prospects" icon={Phone} T={T}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>
        <KPICard icon={Phone} label="Total prospects" value={data.stats.prospects} color="#4db8ff"/>
        <KPICard icon={AlertTriangle} label="Rouges" value={data.stats.prospectsRed} color={DA}/>
        <KPICard icon={Bell} label="Orange" value={data.stats.prospectsOrange} color={WA}/>
      </div>
    </SectionCard>
    <SectionCard title="Clients" icon={Briefcase} T={T}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>
        <KPICard icon={Users} label="Clients suivis" value={data.stats.clients} color="#4db8ff"/>
        <KPICard icon={AlertTriangle} label="Bloqués" value={data.stats.clientsBlocked} color={DA}/>
        <KPICard icon={FileText} label="Documents / partenaires" value={data.docActions.length + data.partnerActions.length + coverageCount(coverageData.documents)} color={WA}/>
      </div>
    </SectionCard>
    <SectionCard title="Biens" icon={Home} T={T}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>
        <KPICard icon={Home} label="Biens en stock" value={data.stats.biens} color="#4db8ff"/>
        <KPICard icon={Sparkles} label="À traiter" value={data.stats.biensToAct} color={WA}/>
        <KPICard icon={BarChart3} label="Simulateurs" value={safeArr(data.biens).filter(hasSimulateurBien).length} color="#c084fc"/>
        <KPICard icon={Eye} label="Visites terrain" value={safeArr(data.biens).filter(b => Boolean(b.visite_data)).length} color="#FFC200"/>
      </div>
    </SectionCard>
  </div>;
}

function HistoriqueRoutines({ history=[], T=THEMES_INV.dark }) {
  return <SectionCard title="Historique des routines" icon={FileText} subtitle="Après migration Supabase V7" T={T}>{history.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted }}>Aucune routine enregistrée pour le moment.</div> : <div style={{ display:"grid", gap:8 }}>{history.map(r => <div key={r.id} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:SPACING.md, display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><div><div style={{ fontWeight:900, color:T.text }}>{safeDate(r.routine_date)}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{r.status} · {r.completion_forced ? "forcée" : "standard"}</div></div><AlertBadge level={r.status === "completed" ? "success" : "warning"} T={T}>{r.status}</AlertBadge></div>)}</div>}</SectionCard>;
}

function VueMensuelle({ data, T=THEMES_INV.dark }) {
  return <div style={{ display:"grid", gap:SPACING.md }}><SectionCard title="Vue mensuelle" icon={BarChart3} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Users} label="Prospects entrants" value={data.stats.prospectsThisMonth} color="#4db8ff"/><KPICard icon={Calendar} label="RDV réalisés" value={data.stats.rdvThisMonth} color="#FFC200"/><KPICard icon={Handshake} label="Signatures" value={data.stats.signedThisMonth} color={SU}/><KPICard icon={Euro} label="CA base signé" value={fmtDashboardEur(data.stats.caBaseMonth)} color="#c084fc"/></div></SectionCard><SectionCard title="12 derniers mois" icon={TrendingUp} T={T}><MiniMonthlyChart data={data.monthSeries} T={T}/></SectionCard></div>;
}

export default TableauBord;
export { TableauBord, AlertBadge, RoutineDecisionCard, PriorityEditor, CollaboratorEditor, ActionPlanView };
