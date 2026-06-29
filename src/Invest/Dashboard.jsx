import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, Users, Building2, BarChart3, Plus, Trash2,
  Search, RefreshCw, Check, Phone, Calendar, FileText, Home,
  TrendingUp, Wallet, Euro, Lock, AlertTriangle, Eye,
  Sparkles, Sun, LayoutGrid, Send, Handshake, Bell, Briefcase,
} from "lucide-react";

import {
  THEMES_INV, SU, WA, DA, ETAPES_CLIENT, TYPES_PLANNING_INVEST,
  isoDate, getWeekRange, normTxt, KPICard, DASH_STAGE_COLORS,
  fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween,
  getClientName, getBienLabel, getBienScore, isBienFicheComplete,
  hasSimulateurBien, isGeolocBien, DashboardPanel, DashboardAlertList,
  MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT,
  HONORAIRE_CONSEIL_MOYEN_HT,
} from "./_shared";

// ─────────────────────────────────────────────────────────────
// TABLEAU DE BORD V3 — Morning Routine stricte Profero Invest
// À copier-coller en remplacement du fichier / bloc Tableau de bord actuel.
// Cette version renforce la liaison données + les décisions par élément critique en gardant le code couleur existant via T, SU, WA, DA.
// ─────────────────────────────────────────────────────────────

const DASH_CLIENT_STATUS_CONFIG = [
  { statut:"Prospect", label:"Prospects", color:"#4db8ff", icon:Users },
  { statut:"Actif", label:"Clients actifs", color:SU, icon:Check },
  { statut:"Inactif", label:"Clients inactifs", color:WA, icon:Bell },
  { statut:"Terminé", label:"Terminés", color:"rgba(255,255,255,0.38)", icon:Lock },
];

const DASH_TABS = [
  { key:"routine", label:"Morning Routine", icon:LayoutDashboard },
  { key:"today", label:"Aujourd’hui", icon:Sun },
  { key:"week", label:"Cette semaine", icon:Calendar },
  { key:"month", label:"Ce mois", icon:BarChart3 },
];

const DASH_PROSPECT_STAGES = [
  "Nouveau", "Qualifié", "RDV fixé", "RDV fait", "Proposition envoyée", "Signé", "Perdu",
];

const DASH_PROSPECT_STAGE_COLORS = ["#4db8ff", "#0D2E5C", "#7dd3fc", "#c084fc", "#FFC200", SU, DA];

const DASH_OBJECTIVES = [
  { key:"rdv", label:"RDV réalisés", target:10, icon:Calendar },
  { key:"signatures", label:"Signatures clients", target:2, icon:Handshake },
  { key:"prospects", label:"Prospects entrants", target:20, icon:Users },
  { key:"biens", label:"Biens présentés", target:5, icon:Home },
];

const DASH_MORNING_STEPS = [
  { key:"global", label:"Vue globale", time:"8h30 – 8h40", duration:"10 min", icon:LayoutDashboard },
  { key:"collaborateurs", label:"Collaborateurs", time:"8h40 – 9h05", duration:"25 min", icon:Users },
  { key:"prospects", label:"Prospects", time:"9h05 – 9h30", duration:"25 min", icon:Phone },
  { key:"clients", label:"Clients actifs", time:"9h30 – 10h00", duration:"30 min", icon:Briefcase },
  { key:"biens", label:"Biens identifiés", time:"10h00 – 10h20", duration:"20 min", icon:Home },
  { key:"synthese", label:"Synthèse", time:"10h20 – 10h30", duration:"10 min", icon:Send },
];

const DASH_MOCK_COLLABORATEURS = [
  { name:"Tom", status:"Présent", open:6, late:2, doneToday:1, doneWeek:4, doneMonth:15, validation:2, lastNewsHours:5, keyMissions:["Relances prospects", "Suivi offres", "Qualification entrants"] },
  { name:"Benjamin", status:"Télétravail", open:4, late:1, doneToday:2, doneWeek:5, doneMonth:18, validation:1, lastNewsHours:8, keyMissions:["Analyse biens", "Matching clients", "Préparation visites"] },
];

function dashSemantic(type, fallback) {
  return SEMANTIC?.[type] || fallback;
}

function dashDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function dashIso(value = new Date()) {
  const d = dashDate(value) || new Date();
  return isoDate(d);
}

function dashAddDays(value, days) {
  const d = dashDate(value) || new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function dashStartOfMonth(value = new Date()) {
  const d = dashDate(value) || new Date();
  d.setDate(1);
  return d;
}

function dashEndOfMonth(value = new Date()) {
  const d = dashStartOfMonth(value);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d;
}

function dashWithin(value, start, end) {
  const d = dashDate(value);
  const s = dashDate(start);
  const e = dashDate(end);
  if (!d || !s || !e) return false;
  return d >= s && d <= e;
}

function dashDaysSince(value) {
  const d = dashDate(value);
  if (!d) return null;
  const today = dashDate(new Date());
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

function dashMonthKey(value) {
  const d = dashDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dashMonthLabel(value) {
  const d = dashDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR", { month:"short" }).replace(".", "");
}

function dashDelta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!p && !c) return { value:0, pct:0, label:"stable" };
  if (!p && c) return { value:c, pct:100, label:"+100%" };
  const diff = c - p;
  const pct = Math.round((diff / p) * 100);
  return { value:diff, pct, label:`${diff >= 0 ? "+" : ""}${diff} / ${pct >= 0 ? "+" : ""}${pct}%` };
}

function dashLastActivityClient(c = {}) {
  return c.updated_at || c.date_prochaine_action || c.date_signature || c.date_premier_contact || c.created_at || null;
}

function dashActionTitle(a = {}) {
  return String(a.action_title || a.title || a.titre || a.nom || "").trim();
}

function dashActionOwner(a = {}) {
  return String(a.responsable || a.owner || a.assignee || a.assigned_to || "").trim();
}

function dashIsOpenAction(a = {}) {
  const s = normTxt(String(a.status || a.statut || ""));
  if (!s) return true;
  return ["a_faire", "en_cours", "bloque", "bloqué", "a_valider", "open", "todo", "pending"].includes(s);
}

function dashIsDoneAction(a = {}) {
  const s = normTxt(String(a.status || a.statut || ""));
  return ["termine", "terminé", "done", "completed", "fait", "valide", "validé"].includes(s);
}

function dashIsBlockedAction(a = {}) {
  const s = normTxt(String(a.status || a.statut || ""));
  return s === "bloque" || s === "bloqué";
}

function dashIsValidationAction(a = {}) {
  const txt = normTxt(`${dashActionTitle(a)} ${a.step_label || ""} ${a.status || ""}`);
  return txt.includes("validation") || txt.includes("valider") || txt.includes("matthieu");
}

function dashIsPartnerAction(a = {}) {
  const txt = normTxt(`${dashActionTitle(a)} ${a.step_label || ""}`);
  return txt.includes("banque") || txt.includes("notaire") || txt.includes("assurance") || txt.includes("courtier");
}

function dashIsDocumentAction(a = {}) {
  const txt = normTxt(`${dashActionTitle(a)} ${a.step_label || ""}`);
  return txt.includes("document") || txt.includes("piece") || txt.includes("pièce") || txt.includes("justificatif");
}

function dashStageForProspect(c = {}) {
  const raw = normTxt(`${c.etape || ""} ${c.statut || ""} ${c.prochaine_action || ""}`);
  if (raw.includes("perdu")) return "Perdu";
  if (raw.includes("signe") || raw.includes("signé") || c.date_signature) return "Signé";
  if (raw.includes("proposition") || raw.includes("presentation") || raw.includes("présentation")) return "Proposition envoyée";
  if (raw.includes("rdv fait") || raw.includes("rendez-vous fait") || raw.includes("decouverte faite")) return "RDV fait";
  if (raw.includes("rdv") || raw.includes("rendez-vous")) return "RDV fixé";
  if (raw.includes("qualifie") || raw.includes("qualifié") || raw.includes("analyse")) return "Qualifié";
  return "Nouveau";
}

function dashBienIsNewToSort(b = {}, today, yesterday) {
  const statut = normTxt(b.statut || "");
  return statut.includes("nouveau") || statut.includes("a trier") || statut.includes("à trier") || dashWithin(b.created_at, yesterday, today);
}

function dashBienInAnalysis(b = {}) {
  const statut = normTxt(b.statut || "");
  return statut.includes("analyse") || statut.includes("analyser") || statut.includes("visite") || statut.includes("étude") || statut.includes("etude");
}

function dashBienArchived(b = {}) {
  const statut = normTxt(b.statut || "");
  return statut.includes("archive") || statut.includes("archivé") || statut.includes("ecarte") || statut.includes("écarté") || statut.includes("abandon");
}

function AlertBadge({ level="info", children, icon=null, T=THEMES_INV.dark }) {
  const success = dashSemantic("success", { bg:"#ecfdf5", border:"#bbf7d0" });
  const warning = dashSemantic("warning", { bg:"#fffbeb", border:"#fde68a" });
  const danger = dashSemantic("danger", { bg:"#fff1f2", border:"#fecdd3" });
  const cfg = {
    info:{ color:T.accent, bg:T.accentBg, border:T.accentBorder, icon:Bell },
    success:{ color:SU, bg:success.bg, border:success.border, icon:Check },
    warning:{ color:WA, bg:warning.bg, border:warning.border, icon:AlertTriangle },
    danger:{ color:DA, bg:danger.bg, border:danger.border, icon:AlertTriangle },
  }[level] || {};
  const IconComp = icon || cfg.icon;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 8px", borderRadius:RADIUS.pill, border:`1px solid ${cfg.border}`, background:cfg.bg, color:cfg.color, fontSize:FONT.xs.size, fontWeight:900, lineHeight:1, whiteSpace:"nowrap" }}>
      {IconComp && <Icon as={IconComp} size={11} strokeWidth={2.4}/>} {children}
    </span>
  );
}

function DashboardSection({ title, subtitle, icon, action, children, T=THEMES_INV.dark, compact=false }) {
  return (
    <div className="inv-card" style={{ marginBottom:compact ? SPACING.md : SPACING.xxl - 2 }}>
      <div className="inv-card-hd blue" style={{ alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={icon || LayoutDashboard} size={13} strokeWidth={2.2}/>{title}</span>
        {action || (subtitle && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:700 }}>{subtitle}</span>)}
      </div>
      <div className="inv-card-bd">{children}</div>
    </div>
  );
}

function PipelineBar({ stages=[], T=THEMES_INV.dark, onStageClick }) {
  const total = stages.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const max = Math.max(1, ...stages.map(x => Number(x.value) || 0));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", height:12, overflow:"hidden", borderRadius:RADIUS.pill, border:`1px solid ${T.border}`, background:T.input }}>
        {stages.map((s, i) => {
          const value = Number(s.value) || 0;
          const pct = total ? Math.max(4, (value / total) * 100) : 100 / Math.max(1, stages.length);
          return <button key={s.label} type="button" onClick={() => onStageClick?.(s)} title={`${s.label} : ${value}`} style={{ width:`${pct}%`, minWidth:value ? 18 : 8, border:"none", background:s.color || DASH_PROSPECT_STAGE_COLORS[i % DASH_PROSPECT_STAGE_COLORS.length], cursor:"pointer", opacity:value ? 1 : .35 }}/>;
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:8 }}>
        {stages.map((s, i) => {
          const value = Number(s.value) || 0;
          const pct = total ? Math.round((value / total) * 100) : 0;
          const color = s.color || DASH_PROSPECT_STAGE_COLORS[i % DASH_PROSPECT_STAGE_COLORS.length];
          return (
            <button key={s.label} type="button" onClick={() => onStageClick?.(s)} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"8px 9px", textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:7, minWidth:0 }}>
                  <span style={{ width:8, height:8, borderRadius:RADIUS.pill, background:color, flexShrink:0 }}/>
                  <span style={{ fontSize:FONT.sm.size, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.label}</span>
                </span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, fontWeight:900, color:T.accent }}>{value}</span>
              </div>
              <div style={{ height:6, marginTop:7, borderRadius:RADIUS.pill, background:T.card, overflow:"hidden", border:`1px solid ${T.border}` }}>
                <div style={{ height:"100%", width:`${Math.max(0, Math.min(100, (value / max) * 100))}%`, background:color }}/>
              </div>
              <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:5 }}>{pct}% du pipeline</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ObjectiveProgress({ label, value=0, target=1, icon, T=THEMES_INV.dark }) {
  const pct = target ? Math.round((Number(value || 0) / Number(target || 1)) * 100) : 0;
  const color = pct >= 100 ? SU : pct >= 60 ? WA : DA;
  return (
    <div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:8, minWidth:0 }}>
          <span style={{ width:28, height:28, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", color, background:`${color}15`, flexShrink:0 }}><Icon as={icon || BarChart3} size={14} strokeWidth={2.2}/></span>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
            <div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{value} / {target}</div>
          </div>
        </div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size, fontWeight:900, color }}>{pct}%</div>
      </div>
      <div style={{ height:8, borderRadius:RADIUS.pill, background:T.card, border:`1px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.max(0, Math.min(100, pct))}%`, background:color, borderRadius:RADIUS.pill }}/>
      </div>
    </div>
  );
}

function MonthlyActivityChart({ data=[], T=THEMES_INV.dark }) {
  const max = Math.max(1, ...data.flatMap(m => [Number(m.prospects) || 0, Number(m.rdv) || 0, Number(m.signatures) || 0]));
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input, padding:SPACING.md, overflowX:"auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:SPACING.md, flexWrap:"wrap" }}>
        {[["Prospects", "#4db8ff"], ["RDV", "#FFC200"], ["Signatures", SU]].map(([label, color]) => <span key={label} style={{ display:"inline-flex", alignItems:"center", gap:6, color:T.textSub, fontSize:FONT.xs.size, fontWeight:800 }}><span style={{ width:9, height:9, borderRadius:RADIUS.pill, background:color }}/>{label}</span>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${data.length || 12}, minmax(54px, 1fr))`, alignItems:"end", gap:9, minHeight:190 }}>
        {data.map(m => <div key={m.key} style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", gap:6, height:170 }}>
          <div style={{ display:"flex", alignItems:"end", justifyContent:"center", gap:3, height:125, width:"100%" }}>
            <div title={`Prospects : ${m.prospects}`} style={{ width:9, height:`${Math.max(4, ((m.prospects || 0) / max) * 120)}px`, background:"#4db8ff", borderRadius:"6px 6px 0 0" }}/>
            <div title={`RDV : ${m.rdv}`} style={{ width:9, height:`${Math.max(4, ((m.rdv || 0) / max) * 120)}px`, background:"#FFC200", borderRadius:"6px 6px 0 0" }}/>
            <div title={`Signatures : ${m.signatures}`} style={{ width:9, height:`${Math.max(4, ((m.signatures || 0) / max) * 120)}px`, background:SU, borderRadius:"6px 6px 0 0" }}/>
          </div>
          <div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"capitalize" }}>{m.label}</div>
        </div>)}
      </div>
    </div>
  );
}

function MiniList({ items=[], empty="Aucun élément", T=THEMES_INV.dark, onNavigate }) {
  if (!items.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center", fontSize:FONT.sm.size + 1, fontStyle:"italic" }}>{empty}</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {items.map((item, i) => {
        const IconComp = item.icon || Bell;
        return (
          <button key={`${item.title}-${i}`} type="button" onClick={() => item.onClick ? item.onClick() : item.onClickTarget && onNavigate?.(item.onClickTarget, item.onClickFilter)} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"9px 10px", cursor:item.onClick || item.onClickTarget ? "pointer" : "default", fontFamily:"inherit", textAlign:"left" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:9, minWidth:0 }}>
                <span style={{ width:26, height:26, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", background:`${item.color || T.accent}16`, color:item.color || T.accent, flexShrink:0 }}><Icon as={IconComp} size={13} strokeWidth={2.3}/></span>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                  <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.sub}</div>
                </div>
              </div>
              {item.badge && <span style={{ flexShrink:0, fontSize:FONT.xs.size, fontWeight:900, color:item.color || T.accent, background:`${item.color || T.accent}14`, border:`1px solid ${item.color || T.accent}30`, borderRadius:RADIUS.pill, padding:"3px 7px" }}>{item.badge}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function buildCollaborateurStats(actions = [], todayIso, startWeekIso, endWeekIso, startMonthIso, endMonthIso) {
  return ["Tom", "Benjamin"].map((name, idx) => {
    const list = actions.filter(a => normTxt(dashActionOwner(a)).includes(normTxt(name)));
    if (!list.length) return DASH_MOCK_COLLABORATEURS[idx];
    const open = list.filter(dashIsOpenAction);
    const late = open.filter(a => a.due_date && a.due_date < todayIso);
    const doneToday = list.filter(a => dashIsDoneAction(a) && dashWithin(a.completed_at || a.done_at || a.updated_at, todayIso, todayIso));
    const doneWeek = list.filter(a => dashIsDoneAction(a) && dashWithin(a.completed_at || a.done_at || a.updated_at, startWeekIso, endWeekIso));
    const doneMonth = list.filter(a => dashIsDoneAction(a) && dashWithin(a.completed_at || a.done_at || a.updated_at, startMonthIso, endMonthIso));
    const validation = open.filter(dashIsValidationAction);
    const lastDate = list.map(a => a.updated_at || a.completed_at || a.done_at || a.due_date || a.created_at).filter(Boolean).sort().at(-1);
    const lastNewsHours = lastDate ? Math.round((new Date().getTime() - new Date(lastDate).getTime()) / 3600000) : 999;
    return { name, status:"Non renseigné", open:open.length, late:late.length, doneToday:doneToday.length, doneWeek:doneWeek.length, doneMonth:doneMonth.length, validation:validation.length, lastNewsHours, keyMissions:list.slice(0, 3).map(a => dashActionTitle(a)).filter(Boolean) };
  });
}

function buildDashboardStats({ clients = [], biens = [], propositions = [], planning = [], actions = [] }) {
  const today = dashDate(new Date());
  const todayIso = dashIso(today);
  const yesterday = dashAddDays(today, -1);
  const yesterdayIso = dashIso(yesterday);
  const { startWeek, endWeek } = getWeekRange();
  const startWeekIso = dashIso(startWeek);
  const endWeekIso = dashIso(endWeek);
  const prevWeekStart = dashAddDays(startWeek, -7);
  const prevWeekEnd = dashAddDays(startWeek, -1);
  const startMonth = dashStartOfMonth(today);
  const endMonth = dashEndOfMonth(today);
  const startMonthIso = dashIso(startMonth);
  const endMonthIso = dashIso(endMonth);

  const prospects = clients.filter(c => (c.statut || "Prospect") === "Prospect");
  const clientsActifs = clients.filter(c => c.statut === "Actif");
  const clientsReels = clients.filter(c => c.statut !== "Prospect");
  const clientsPipeline = clients.filter(c => c.statut !== "Terminé");
  const clientsSignes = clientsReels.filter(c => c.date_signature);
  const openActions = actions.filter(dashIsOpenAction);
  const doneActions = actions.filter(dashIsDoneAction);
  const blockedActions = openActions.filter(dashIsBlockedAction);

  const prospectsRelanceToday = prospects.filter(c => c.date_prochaine_action === todayIso);
  const prospectsNewSinceYesterday = prospects.filter(c => dashWithin(c.created_at, yesterdayIso, todayIso));
  const prospectsNewWeek = prospects.filter(c => dashWithin(c.created_at, startWeekIso, endWeekIso));
  const prospectsNewPrevWeek = prospects.filter(c => dashWithin(c.created_at, prevWeekStart, prevWeekEnd));
  const prospectsNewMonth = prospects.filter(c => dashWithin(c.created_at, startMonthIso, endMonthIso));
  const prospectsStagnants = prospects.filter(c => { const d = dashDaysSince(dashLastActivityClient(c)); return d !== null && d > 7; });
  const prospectsSansAction = prospects.filter(c => !c.prochaine_action && !c.date_prochaine_action);

  const rdvToday = planning.filter(e => e.date_rdv === todayIso);
  const rdvWeek = planning.filter(e => dashWithin(e.date_rdv, startWeekIso, endWeekIso));
  const rdvPrevWeek = planning.filter(e => dashWithin(e.date_rdv, prevWeekStart, prevWeekEnd));
  const rdvMonth = planning.filter(e => dashWithin(e.date_rdv, startMonthIso, endMonthIso));
  const visitesWeek = rdvWeek.filter(e => normTxt(e.type || "").includes("visite"));

  const clientsBlocked = clientsActifs.filter(c => { const d = dashDaysSince(dashLastActivityClient(c)); return d !== null && d > 5; });
  const partnerRelances = openActions.filter(a => dashIsPartnerAction(a) && (!a.due_date || dashDaysSince(a.due_date) > 3));
  const documentsWaiting = openActions.filter(dashIsDocumentAction);
  const clientsSansAction = clientsActifs.filter(c => !c.prochaine_action && !c.date_prochaine_action);
  const actionsLate = openActions.filter(a => a.due_date && a.due_date < todayIso);
  const actionsWeek = openActions.filter(a => a.due_date && dashWithin(a.due_date, startWeekIso, endWeekIso));
  const actionsDoneWeek = doneActions.filter(a => dashWithin(a.completed_at || a.done_at || a.updated_at, startWeekIso, endWeekIso));
  const actionsDoneMonth = doneActions.filter(a => dashWithin(a.completed_at || a.done_at || a.updated_at, startMonthIso, endMonthIso));

  const biensNewToSort = biens.filter(b => dashBienIsNewToSort(b, todayIso, yesterdayIso));
  const biensInAnalysis = biens.filter(dashBienInAnalysis);
  const biensToRelance = biens.filter(b => b.date_relance && b.date_relance <= todayIso);
  const biensArchivedWeek = biens.filter(b => dashBienArchived(b) && dashWithin(b.updated_at || b.created_at, startWeekIso, endWeekIso));
  const biensAnalyzedWeek = biens.filter(b => dashBienInAnalysis(b) && dashWithin(b.updated_at || b.created_at, startWeekIso, endWeekIso));
  const biensAnalyzedMonth = biens.filter(b => dashBienInAnalysis(b) && dashWithin(b.updated_at || b.created_at, startMonthIso, endMonthIso));
  const propsWeek = propositions.filter(p => dashWithin(p.date_proposition || p.created_at, startWeekIso, endWeekIso));
  const propsMonth = propositions.filter(p => dashWithin(p.date_proposition || p.created_at, startMonthIso, endMonthIso));
  const proposedBienIds = new Set(propositions.map(p => p.bien_id).filter(Boolean));
  const biensToMatch = biens.filter(b => !proposedBienIds.has(b.id) && (getBienScore(b) >= 35 || dashBienInAnalysis(b)));

  const offresEnvoyees = biens.filter(b => b.statut === "Offre envoyée");
  const offresAcceptees = biens.filter(b => b.statut === "Offre acceptée");
  const offresWeek = biens.filter(b => Number(b.montant_offre) > 0 && dashWithin(b.updated_at || b.created_at, startWeekIso, endWeekIso));
  const offresMonth = biens.filter(b => Number(b.montant_offre) > 0 && dashWithin(b.updated_at || b.created_at, startMonthIso, endMonthIso));

  const fichesCompletes = biens.filter(isBienFicheComplete).length;
  const geoloc = biens.filter(isGeolocBien).length;
  const simulateurs = biens.filter(hasSimulateurBien).length;
  const topOpps = biens.filter(b => getBienScore(b) >= 45).length;
  const signaturesWeek = clientsSignes.filter(c => dashWithin(c.date_signature, startWeekIso, endWeekIso));
  const signaturesPrevWeek = clientsSignes.filter(c => dashWithin(c.date_signature, prevWeekStart, prevWeekEnd));
  const signaturesMonth = clientsSignes.filter(c => dashWithin(c.date_signature, startMonthIso, endMonthIso));

  const offresActivesMap = new Map();
  const addOffreActive = (key, amount) => { const n = Number(amount) || 0; if (key && n > 0) offresActivesMap.set(key, n); };
  biens.forEach(b => { if (Number(b.montant_offre) > 0 && !["Abandonné", "Offre refusée"].includes(b.statut || "")) addOffreActive(`bien-${b.id}`, b.montant_offre); });
  propositions.forEach(p => { const s = normTxt(p.statut || ""); if (["offre en cours", "proposé", "interessé", "intéressé", "en analyse"].includes(s)) addOffreActive(`prop-${p.bien_id || p.id}`, p.bien?.montant_offre || p.bien?.prix_vente); });
  const montantOffresCours = Array.from(offresActivesMap.values()).reduce((s, x) => s + x, 0);
  const nbOffresActives = offresActivesMap.size;

  const delaisSignature = clientsSignes.filter(c => c.date_signature).map(c => daysBetween(c.date_premier_contact || c.created_at, new Date(c.date_signature))).filter(v => Number.isFinite(v) && v >= 0);
  const stageCounts = DASH_PROSPECT_STAGES.map((stage, i) => ({ label:stage, value:stage === "Signé" ? clientsSignes.length : stage === "Perdu" ? clients.filter(c => normTxt(c.statut || "").includes("perdu") || normTxt(c.etape || "").includes("perdu")).length : prospects.filter(c => dashStageForProspect(c) === stage).length, color:DASH_PROSPECT_STAGE_COLORS[i % DASH_PROSPECT_STAGE_COLORS.length] }));
  const clientsByEtape = ETAPES_CLIENT.map((etape, i) => ({ label:etape, value:clientsActifs.filter(c => (c.etape || "") === etape).length, color:DASH_STAGE_COLORS[i % DASH_STAGE_COLORS.length] })).filter(x => x.value > 0);
  const monthSeries = Array.from({ length:12 }, (_, index) => { const d = dashStartOfMonth(today); d.setMonth(d.getMonth() - (11 - index)); const key = dashMonthKey(d); return { key, label:dashMonthLabel(d), prospects:prospects.filter(c => dashMonthKey(c.created_at) === key).length, rdv:planning.filter(e => dashMonthKey(e.date_rdv) === key).length, signatures:clientsSignes.filter(c => dashMonthKey(c.date_signature) === key).length }; });
  const collaborateurs = buildCollaborateurStats(actions, todayIso, startWeekIso, endWeekIso, startMonthIso, endMonthIso);

  return {
    today:todayIso, startWeek:startWeekIso, endWeek:endWeekIso, startMonth:startMonthIso, endMonth:endMonthIso,
    prospects:prospects.length, actifs:clientsActifs.length, inactifs:clients.filter(c => c.statut === "Inactif").length, termines:clients.filter(c => c.statut === "Terminé").length,
    totalSignes:clientsSignes.length, sommeBudgets:clientsSignes.reduce((s, c) => s + (Number(c.budget) || 0), 0),
    biensTotaux:biens.length, biensARelancer:biensToRelance.length, visitesProg:biens.filter(b => b.statut === "Visite programmée").length, offreEnvoyees:offresEnvoyees.length, offresAcceptees:offresAcceptees.length, sansProchaineAction:clientsSansAction.length, prospectsSansAction:prospectsSansAction.length, nbPropositions:propositions.length,
    actionsRetard:actionsLate.length, actionsSemaine:actionsWeek.length, actionsATraiter:actionsLate.length + actionsWeek.length, rdvToday:rdvToday.length, rdvSemaine:rdvWeek.length, visitesSemaine:visitesWeek.length, topOpportunites:topOpps, biensIncomplets:Math.max(0, biens.length - fichesCompletes),
    tauxFichesCompletes:biens.length ? Math.round((fichesCompletes / biens.length) * 100) : 0, tauxGeoloc:biens.length ? Math.round((geoloc / biens.length) * 100) : 0, tauxSimulateur:biens.length ? Math.round((simulateurs / biens.length) * 100) : 0, tauxOffresStock:biens.length ? Math.round((nbOffresActives / biens.length) * 100) : 0,
    tauxTransformation:clients.length ? Math.round((clientsReels.length / clients.length) * 100) : 0, biensParClientActif:clientsActifs.length ? propositions.length / clientsActifs.length : 0, tauxAcceptationOffres:offresEnvoyees.length + offresAcceptees.length ? Math.round((offresAcceptees.length / (offresEnvoyees.length + offresAcceptees.length)) * 100) : 0, delaiMoyenSignature:delaisSignature.length ? Math.round(delaisSignature.reduce((s, x) => s + x, 0) / delaisSignature.length) : null,
    budgetClientsActifs:clientsActifs.reduce((s, c) => s + (Number(c.budget) || 0), 0), montantOffresCours, nbOffresActives, baseHonorairesSignes:clientsSignes.length * HONORAIRE_BASE_CONTRAT_HT, baseHonorairesPipeline:clientsPipeline.length * HONORAIRE_BASE_CONTRAT_HT, estimationHonoraireConseil:nbOffresActives * HONORAIRE_CONSEIL_MOYEN_HT,
    todayProspects:{ relances:prospectsRelanceToday.length, entrants:prospectsNewSinceYesterday.length, rdv:rdvToday.length, stagnants:prospectsStagnants.length, sansAction:prospectsSansAction.length },
    todayClients:{ actifs:clientsActifs.length, partnerRelances:partnerRelances.length, documentsWaiting:documentsWaiting.length, blocked:clientsBlocked.length + blockedActions.length, sansAction:clientsSansAction.length, byEtape:clientsByEtape },
    todayBiens:{ newToSort:biensNewToSort.length, inAnalysis:biensInAnalysis.length, toRelance:biensToRelance.length, toMatch:biensToMatch.length, topOpps, incomplets:Math.max(0, biens.length - fichesCompletes) },
    week:{ prospectsContactes:prospectsNewWeek.length, rdvRealises:rdvWeek.length, offresFaites:offresWeek.length + propsWeek.length, dossiersAvances:actionsDoneWeek.length, visites:visitesWeek.length, actionsCompleted:actionsDoneWeek.length, biensAnalyses:biensAnalyzedWeek.length, biensPresentes:propsWeek.length, biensArchives:biensArchivedWeek.length, deltaProspects:dashDelta(prospectsNewWeek.length, prospectsNewPrevWeek.length), deltaRdv:dashDelta(rdvWeek.length, rdvPrevWeek.length), deltaSignatures:dashDelta(signaturesWeek.length, signaturesPrevWeek.length) },
    month:{ prospectsEntrants:prospectsNewMonth.length, rdvRealises:rdvMonth.length, tauxConversion:prospectsNewMonth.length ? Math.round((signaturesMonth.length / prospectsNewMonth.length) * 100) : 0, biensPresentes:propsMonth.length, actesSignes:signaturesMonth.length, caEncaisse:signaturesMonth.length * HONORAIRE_BASE_CONTRAT_HT, honorairesForfaitaires:signaturesMonth.length * HONORAIRE_BASE_CONTRAT_HT, commissionsEstimees:offresMonth.length * HONORAIRE_CONSEIL_MOYEN_HT, actionsCompleted:actionsDoneMonth.length, biensAnalyses:biensAnalyzedMonth.length },
    pipelineStages:stageCounts, monthSeries, collaborateurs, monthlyValues:{ rdv:rdvMonth.length, signatures:signaturesMonth.length, prospects:prospectsNewMonth.length, biens:propsMonth.length },
    priorityItems:[
      ...actionsLate.slice(0, 4).map(a => ({ title:dashActionTitle(a) || "Action en retard", sub:`${a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client"} · échéance ${safeDate(a.due_date)}`, badge:"Retard", color:DA, icon:AlertTriangle, onClickTarget:"crm", onClickFilter:{ type:"actions_week_or_late" } })),
      ...prospectsRelanceToday.slice(0, 3).map(c => ({ title:`${getClientName(c)} — relance prospect`, sub:c.prochaine_action || "Relance prévue aujourd’hui", badge:"Prospect", color:WA, icon:Phone, onClickTarget:"crm", onClickFilter:{ type:"relance_today" } })),
      ...rdvToday.slice(0, 3).map(e => ({ title:e.titre || "RDV du jour", sub:`${e.heure_debut ? e.heure_debut.slice(0, 5) : "Horaire libre"} · ${e.type || "RDV"}`, badge:"RDV", color:SU, icon:Calendar, onClickTarget:"planning", onClickFilter:{ type:"today" } })),
      ...biensToRelance.slice(0, 3).map(b => ({ title:`${getBienLabel(b)} — relance bien`, sub:`Relance prévue le ${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Home, onClickTarget:"biens", onClickFilter:{ type:"a_relancer" } })),
    ].slice(0, 10),
  };
}

function CollaborateurCard({ c, period="today", T=THEMES_INV.dark, onClick }) {
  const noNews = Number(c.lastNewsHours) > 24;
  const doneValue = period === "month" ? c.doneMonth : period === "week" ? c.doneWeek : c.doneToday;
  return (
    <button type="button" onClick={onClick} style={{ background:T.input, border:`1px solid ${c.late ? dashSemantic("danger", { border:"#fecdd3" }).border : noNews ? dashSemantic("warning", { border:"#fde68a" }).border : T.border}`, borderRadius:RADIUS.lg, padding:SPACING.md, textAlign:"left", cursor:"pointer", fontFamily:"inherit", boxShadow:T.shadowSm }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:10 }}>
        <div><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text }}>{c.name}</div><div style={{ marginTop:4 }}><AlertBadge level={noNews ? "warning" : "info"} T={T} icon={Users}>{c.status || "Non renseigné"}</AlertBadge></div></div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>{c.late > 0 && <AlertBadge level="danger" T={T}>{c.late} retard</AlertBadge>}{c.validation > 0 && <AlertBadge level="warning" T={T}>{c.validation} à valider</AlertBadge>}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:10 }}>
        <div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>Ouvertes</div><div style={{ fontSize:FONT.xl.size, fontWeight:900, color:T.text }}>{c.open || 0}</div></div>
        <div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>Faites</div><div style={{ fontSize:FONT.xl.size, fontWeight:900, color:SU }}>{doneValue || 0}</div></div>
        <div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>Dernière news</div><div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:noNews ? WA : T.text }}>{c.lastNewsHours >= 999 ? "—" : `${c.lastNewsHours}h`}</div></div>
      </div>
      {Array.isArray(c.keyMissions) && c.keyMissions.length > 0 && <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{c.keyMissions.slice(0, 3).map((m, i) => <span key={`${c.name}-${i}`} style={{ fontSize:FONT.xs.size, color:T.textSub, background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.pill, padding:"4px 7px", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m}</span>)}</div>}
    </button>
  );
}


function routineDecisionLabel(decision) {
  return {
    done:"Traité",
    report:"Reporté",
    assign:"Assigné",
    block:"Bloqué",
  }[decision] || "À décider";
}

function routineDecisionLevel(decision) {
  return decision === "done" ? "success" : decision === "block" ? "danger" : decision ? "warning" : "info";
}

function RoutineDecisionRow({ item, decision, onDecision, T=THEMES_INV.dark, onNavigate }) {
  const color = item.color || (item.level === "danger" ? DA : item.level === "warning" ? WA : T.accent);
  const IconComp = item.icon || Bell;
  return (
    <div style={{ border:`1px solid ${decision ? T.border : item.required ? `${color}55` : T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"10px 11px" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
        <button type="button" onClick={() => item.onClickTarget && onNavigate?.(item.onClickTarget, item.onClickFilter)} style={{ display:"flex", alignItems:"flex-start", gap:9, minWidth:0, flex:1, border:"none", background:"transparent", padding:0, textAlign:"left", cursor:item.onClickTarget ? "pointer" : "default", fontFamily:"inherit" }}>
          <span style={{ width:28, height:28, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", color, background:`${color}16`, flexShrink:0 }}><Icon as={IconComp} size={14} strokeWidth={2.3}/></span>
          <span style={{ minWidth:0 }}>
            <span style={{ display:"block", fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</span>
            <span style={{ display:"block", fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.sub}</span>
          </span>
        </button>
        <AlertBadge level={routineDecisionLevel(decision)} T={T}>{routineDecisionLabel(decision)}</AlertBadge>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginTop:10 }}>
        {[
          ["done", "Traité", SU],
          ["report", "Reporter", WA],
          ["assign", "Assigner", T.accent],
          ["block", "Bloquer", DA],
        ].map(([key, label, btnColor]) => (
          <button key={key} type="button" onClick={() => onDecision?.(item.id, key)} style={{ border:`1px solid ${decision === key ? btnColor : T.border}`, background:decision === key ? `${btnColor}16` : T.card, color:decision === key ? btnColor : T.textSub, borderRadius:RADIUS.pill, padding:"5px 9px", fontFamily:"inherit", fontSize:FONT.xs.size, fontWeight:900, cursor:"pointer" }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoutineStepCard({ step, isActive, isDone, canComplete, unresolved=0, onOpen, onComplete, children, T=THEMES_INV.dark }) {
  const IconComp = step.icon || LayoutDashboard;
  const border = isDone ? SU : isActive ? T.accent : T.border;
  return (
    <div style={{ border:`1.5px solid ${border}`, background:isActive ? T.card : T.input, borderRadius:RADIUS.lg, overflow:"hidden", boxShadow:isActive ? T.shadowSm : "none" }}>
      <button type="button" onClick={onOpen} style={{ width:"100%", border:"none", background:isActive ? T.accentBg : T.sectionHd, padding:SPACING.md, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
        <span style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          <span style={{ width:34, height:34, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", background:isDone ? `${SU}16` : isActive ? T.accentBg : T.input, color:isDone ? SU : isActive ? T.accent : T.textSub, flexShrink:0 }}><Icon as={isDone ? Check : IconComp} size={16} strokeWidth={2.4}/></span>
          <span style={{ minWidth:0 }}>
            <span style={{ display:"block", color:T.text, fontSize:FONT.lg.size, fontWeight:900 }}>{step.label}</span>
            <span style={{ display:"block", color:T.textMuted, fontSize:FONT.xs.size, marginTop:2 }}>{step.time} · {step.duration}</span>
          </span>
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
          {unresolved > 0 && <AlertBadge level="danger" T={T}>{unresolved} décision{unresolved > 1 ? "s" : ""}</AlertBadge>}
          {isDone ? <AlertBadge level="success" T={T}>Validé</AlertBadge> : isActive ? <AlertBadge level="info" T={T}>En cours</AlertBadge> : <AlertBadge level="info" T={T}>À faire</AlertBadge>}
        </span>
      </button>
      {isActive && (
        <div style={{ padding:SPACING.md }}>
          {children}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:SPACING.md }}>
            <button type="button" className={canComplete ? "inv-btn inv-btn-gold inv-btn-sm" : "inv-btn inv-btn-out inv-btn-sm"} onClick={onComplete} disabled={!canComplete} title={!canComplete ? "Décision obligatoire sur les éléments rouges/oranges avant validation" : "Valider cette étape"}>
              <Icon as={Check} size={12} strokeWidth={2.2}/> Valider l’étape
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MorningRoutineDashboard({ stats, clients=[], biens=[], propositions=[], planning=[], actions=[], compact=false, T=THEMES_INV.dark, onNavigate }) {
  const storageKey = `profero_morning_routine_v3_${stats?.today || dashIso(new Date())}`;
  const [started, setStarted] = useState(false);
  const [activeStep, setActiveStep] = useState("global");
  const [completedSteps, setCompletedSteps] = useState({});
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      setStarted(!!saved.started);
      setActiveStep(saved.activeStep || "global");
      setCompletedSteps(saved.completedSteps || {});
      setDecisions(saved.decisions || {});
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify({ started, activeStep, completedSteps, decisions })); } catch {}
  }, [storageKey, started, activeStep, completedSteps, decisions]);

  const routine = useMemo(() => {
    const todayIso = stats.today || dashIso(new Date());
    const prospects = clients.filter(c => (c.statut || "Prospect") === "Prospect");
    const clientsActifs = clients.filter(c => c.statut === "Actif");
    const openActions = actions.filter(dashIsOpenAction);
    const lateActions = openActions.filter(a => a.due_date && a.due_date < todayIso);
    const blockedActions = openActions.filter(dashIsBlockedAction);
    const rdvToday = planning.filter(e => e.date_rdv === todayIso);

    const prospectsRelanceToday = prospects.filter(c => c.date_prochaine_action === todayIso);
    const prospectsSansAction = prospects.filter(c => !c.prochaine_action && !c.date_prochaine_action);
    const prospectsStagnants = prospects.filter(c => {
      const d = dashDaysSince(dashLastActivityClient(c));
      return d !== null && d > 7;
    });
    const prospectsEntrants = prospects.filter(c => dashWithin(c.created_at, stats.yesterday || dashAddDays(new Date(), -1), todayIso));

    const clientsSansAction = clientsActifs.filter(c => !c.prochaine_action && !c.date_prochaine_action);
    const clientsBloques = clientsActifs.filter(c => {
      const d = dashDaysSince(dashLastActivityClient(c));
      return d !== null && d > 5;
    });
    const partnerActions = openActions.filter(a => dashIsPartnerAction(a) && (!a.due_date || dashDaysSince(a.due_date) > 3));
    const documentActions = openActions.filter(dashIsDocumentAction);

    const biensRelance = biens.filter(b => b.date_relance && b.date_relance <= todayIso);
    const biensNouveaux = biens.filter(b => dashBienIsNewToSort(b, todayIso, stats.yesterday || dashAddDays(new Date(), -1)));
    const biensAnalyse = biens.filter(dashBienInAnalysis);
    const proposedBienIds = new Set(propositions.map(p => p.bien_id).filter(Boolean));
    const biensToMatch = biens.filter(b => !proposedBienIds.has(b.id) && (getBienScore(b) >= 35 || dashBienInAnalysis(b)));

    const requiredRows = [];
    const makeId = (prefix, value, fallback) => `${prefix}-${value || fallback}`;
    const shortClient = c => `${getClientName(c)}${c.etape ? ` · ${c.etape}` : ""}${c.date_prochaine_action ? ` · prochaine action ${safeDate(c.date_prochaine_action)}` : ""}`;
    const shortBien = b => `${b.ville || "Ville non renseignée"}${b.statut ? ` · ${b.statut}` : ""}${b.date_relance ? ` · relance ${safeDate(b.date_relance)}` : ""}`;

    const addRequired = (arr, item) => {
      requiredRows.push(item.id);
      arr.push({ ...item, required:true });
    };

    const globalItems = [];
    lateActions.forEach((a, i) => addRequired(globalItems, {
      id:makeId("global-action-retard", a.id, i),
      title:dashActionTitle(a) || "Action en retard",
      sub:`${a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client non lié"} · échéance ${safeDate(a.due_date)}`,
      level:"danger", color:DA, icon:AlertTriangle, onClickTarget:"crm", onClickFilter:{ type:"actions_week_or_late" },
    }));
    clientsBloques.forEach((c, i) => addRequired(globalItems, {
      id:makeId("global-client-bloque", c.id, i),
      title:`${getClientName(c)} — dossier bloqué +5 jours`,
      sub:shortClient(c),
      level:"danger", color:DA, icon:Briefcase, onClickTarget:"crm", onClickFilter:{ type:"blocked", client_id:c.id },
    }));
    biensRelance.forEach((b, i) => addRequired(globalItems, {
      id:makeId("global-bien-relance", b.id, i),
      title:`${getBienLabel(b)} — bien à relancer`,
      sub:shortBien(b),
      level:"warning", color:WA, icon:Home, onClickTarget:"biens", onClickFilter:{ type:"a_relancer", bien_id:b.id },
    }));
    rdvToday.forEach((e, i) => globalItems.push({
      id:makeId("global-rdv", e.id, i),
      title:e.titre || "RDV du jour",
      sub:`${e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"} · ${e.type || "RDV"}`,
      level:"info", color:T.accent, icon:Calendar, required:false, onClickTarget:"planning", onClickFilter:{ type:"today", rdv_id:e.id },
    }));
    if (!globalItems.length) globalItems.push({ id:"global-ok", title:"Aucune urgence rouge détectée", sub:"La journée démarre sans blocage prioritaire", level:"success", color:SU, icon:Check, required:false });

    const collaborateurItems = stats.collaborateurs.map(c => ({
      id:`collab-${c.name}`,
      title:`${c.name} — ${c.open || 0} tâche(s) ouverte(s), ${c.late || 0} retard`,
      sub:`${c.validation || 0} validation(s) Matthieu · dernière activité ${c.lastNewsHours >= 999 ? "non renseignée" : `il y a ${c.lastNewsHours}h`}`,
      level:c.late > 0 || c.validation > 0 || c.lastNewsHours > 24 ? "warning" : "success",
      color:c.late > 0 ? DA : c.validation > 0 || c.lastNewsHours > 24 ? WA : SU,
      icon:Users,
      required:c.late > 0 || c.validation > 0 || c.lastNewsHours > 24,
      onClickTarget:"crm",
      onClickFilter:{ type:"collaborateur", value:c.name },
    }));

    const prospectItems = [];
    prospectsRelanceToday.forEach((c, i) => addRequired(prospectItems, {
      id:makeId("prospect-relance", c.id, i),
      title:`${getClientName(c)} — relance prévue aujourd’hui`,
      sub:c.prochaine_action || shortClient(c),
      level:"warning", color:WA, icon:Phone, onClickTarget:"crm", onClickFilter:{ type:"relance_today", client_id:c.id },
    }));
    prospectsSansAction.forEach((c, i) => addRequired(prospectItems, {
      id:makeId("prospect-sans-action", c.id, i),
      title:`${getClientName(c)} — aucune prochaine action`,
      sub:"Règle stricte : dater une prochaine action ou sortir le prospect du pipeline",
      level:"danger", color:DA, icon:Bell, onClickTarget:"crm", onClickFilter:{ type:"sans_action", client_id:c.id },
    }));
    prospectsStagnants.forEach((c, i) => {
      if (prospectItems.some(x => x.id === makeId("prospect-sans-action", c.id, i))) return;
      addRequired(prospectItems, {
        id:makeId("prospect-stagnant", c.id, i),
        title:`${getClientName(c)} — stagnant +7 jours`,
        sub:shortClient(c),
        level:"warning", color:WA, icon:AlertTriangle, onClickTarget:"crm", onClickFilter:{ type:"stagnants", client_id:c.id },
      });
    });
    prospectsEntrants.forEach((c, i) => prospectItems.push({
      id:makeId("prospect-entrant", c.id, i),
      title:`${getClientName(c)} — nouveau prospect entrant`,
      sub:"À qualifier ou assigner dans la journée",
      level:"info", color:T.accent, icon:Users, required:false, onClickTarget:"crm", onClickFilter:{ type:"new_since_yesterday", client_id:c.id },
    }));
    if (!prospectItems.length) prospectItems.push({ id:"prospects-ok", title:"Aucun prospect critique ce matin", sub:"Relances et prochaines actions sous contrôle", level:"success", color:SU, icon:Check, required:false });

    const clientItems = [];
    clientsBloques.forEach((c, i) => addRequired(clientItems, {
      id:makeId("client-bloque", c.id, i),
      title:`${getClientName(c)} — dossier bloqué`,
      sub:shortClient(c),
      level:"danger", color:DA, icon:AlertTriangle, onClickTarget:"crm", onClickFilter:{ type:"blocked", client_id:c.id },
    }));
    clientsSansAction.forEach((c, i) => addRequired(clientItems, {
      id:makeId("client-sans-action", c.id, i),
      title:`${getClientName(c)} — client actif sans prochaine action`,
      sub:"Règle stricte : aucun client actif sans prochaine action claire",
      level:"danger", color:DA, icon:Bell, onClickTarget:"crm", onClickFilter:{ type:"sans_action", client_id:c.id },
    }));
    documentActions.forEach((a, i) => addRequired(clientItems, {
      id:makeId("client-document", a.id, i),
      title:dashActionTitle(a) || "Document client en attente",
      sub:`${a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client"} · ${a.step_label || "document"}`,
      level:"warning", color:WA, icon:FileText, onClickTarget:"crm", onClickFilter:{ type:"documents_waiting" },
    }));
    partnerActions.forEach((a, i) => addRequired(clientItems, {
      id:makeId("client-partenaire", a.id, i),
      title:dashActionTitle(a) || "Relance partenaire",
      sub:`${a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client"} · ${a.step_label || "banque / notaire / assurance"}`,
      level:"warning", color:WA, icon:Briefcase, onClickTarget:"crm", onClickFilter:{ type:"partner_relance" },
    }));
    if (!clientItems.length) clientItems.push({ id:"clients-ok", title:"Aucun client actif critique ce matin", sub:"Pas de blocage, document ou relance partenaire prioritaire", level:"success", color:SU, icon:Check, required:false });

    const bienItems = [];
    biensNouveaux.forEach((b, i) => addRequired(bienItems, {
      id:makeId("bien-trier", b.id, i),
      title:`${getBienLabel(b)} — nouvelle annonce à trier`,
      sub:"Décider : analyser, proposer, relancer ou archiver",
      level:"warning", color:WA, icon:Search, onClickTarget:"biens", onClickFilter:{ type:"new_to_sort", bien_id:b.id },
    }));
    biensToMatch.forEach((b, i) => addRequired(bienItems, {
      id:makeId("bien-match", b.id, i),
      title:`${getBienLabel(b)} — à matcher avec un client`,
      sub:`Score ${getBienScore(b)} · ${shortBien(b)}`,
      level:"warning", color:WA, icon:Handshake, onClickTarget:"biens", onClickFilter:{ type:"to_match", bien_id:b.id },
    }));
    biensRelance.forEach((b, i) => addRequired(bienItems, {
      id:makeId("bien-relance", b.id, i),
      title:`${getBienLabel(b)} — relance bien`,
      sub:shortBien(b),
      level:"danger", color:DA, icon:Bell, onClickTarget:"biens", onClickFilter:{ type:"a_relancer", bien_id:b.id },
    }));
    biensAnalyse.slice(0, 8).forEach((b, i) => bienItems.push({
      id:makeId("bien-analyse", b.id, i),
      title:`${getBienLabel(b)} — en analyse`,
      sub:`Score ${getBienScore(b)} · ${shortBien(b)}`,
      level:"info", color:T.accent, icon:Home, required:false, onClickTarget:"biens", onClickFilter:{ type:"analyse", bien_id:b.id },
    }));
    if (!bienItems.length) bienItems.push({ id:"biens-ok", title:"Aucun bien critique ce matin", sub:"Pas de relance ou décision urgente sur le stock", level:"success", color:SU, icon:Check, required:false });

    const allItems = [globalItems, collaborateurItems, prospectItems, clientItems, bienItems].flat();
    const criticalCount = allItems.filter(item => item.required).length;
    const plan = [
      ...lateActions.slice(0, 5).map(a => `Matthieu — décider l’action en retard : ${dashActionTitle(a) || "action sans titre"}`),
      ...clientsBloques.slice(0, 5).map(c => `Matthieu — débloquer le dossier ${getClientName(c)}`),
      ...prospectsRelanceToday.slice(0, 5).map(c => `Tom — relancer ${getClientName(c)} aujourd’hui`),
      ...prospectsSansAction.slice(0, 5).map(c => `Tom — créer une prochaine action datée pour ${getClientName(c)}`),
      ...documentActions.slice(0, 5).map(a => `Benjamin — relancer/documenter : ${dashActionTitle(a) || "document client"}`),
      ...partnerActions.slice(0, 5).map(a => `Matthieu/Benjamin — relancer partenaire : ${dashActionTitle(a) || "partenaire"}`),
      ...biensToMatch.slice(0, 5).map(b => `Benjamin — matcher ${getBienLabel(b)} avec un profil client`),
      ...biensRelance.slice(0, 5).map(b => `Matthieu/Benjamin — relancer ou archiver ${getBienLabel(b)}`),
      ...rdvToday.slice(0, 3).map(e => `Matthieu — préparer le RDV : ${e.titre || "RDV du jour"}`),
    ];

    return {
      criticalCount,
      steps:{
        global:{ intro:"Objectif : savoir immédiatement si la journée est normale ou critique.", items:globalItems },
        collaborateurs:{ intro:"Objectif : aucun collaborateur ne doit rester sans mission prioritaire claire.", items:collaborateurItems },
        prospects:{ intro:"Objectif : aucun prospect chaud sans prochaine action datée.", items:prospectItems },
        clients:{ intro:"Objectif : aucun client actif sans prochaine action claire.", items:clientItems },
        biens:{ intro:"Objectif : chaque nouveau bien doit finir dans une décision : analyser, proposer, relancer ou archiver.", items:bienItems },
        synthese:{ intro:"Objectif : transformer la routine en plan d’action concret pour la journée.", items:[], plan },
      },
    };
  }, [stats, clients, biens, propositions, planning, actions, T]);

  const completedCount = DASH_MORNING_STEPS.filter(s => completedSteps[s.key]).length;
  const progress = Math.round((completedCount / DASH_MORNING_STEPS.length) * 100);
  const currentIndex = DASH_MORNING_STEPS.findIndex(s => s.key === activeStep);
  const nextStep = DASH_MORNING_STEPS[currentIndex + 1]?.key || "synthese";
  const routineDone = completedCount === DASH_MORNING_STEPS.length;

  const setDecision = (id, value) => setDecisions(prev => ({ ...prev, [id]:value }));
  const resetRoutine = () => { setStarted(false); setActiveStep("global"); setCompletedSteps({}); setDecisions({}); };
  const completeStep = (stepKey) => {
    setCompletedSteps(prev => ({ ...prev, [stepKey]:true }));
    const idx = DASH_MORNING_STEPS.findIndex(s => s.key === stepKey);
    const next = DASH_MORNING_STEPS[idx + 1]?.key;
    if (next) setActiveStep(next);
  };

  const summaryText = [
    `Morning Routine Profero Invest — ${new Date().toLocaleDateString("fr-FR")}`,
    `Progression : ${progress}%`,
    `Actions en retard : ${stats.actionsRetard}`,
    `Prospects à relancer : ${stats.todayProspects.relances}`,
    `Clients bloqués : ${stats.todayClients.blocked}`,
    `Biens à relancer : ${stats.todayBiens.toRelance}`,
    "",
    "Plan d’action du jour :",
    ...(routine.steps.synthese.plan.length ? routine.steps.synthese.plan.map((x, i) => `${i + 1}. ${x}`) : ["1. Aucun point critique détecté — maintenir le suivi courant."]),
  ].join("\n");

  const copySummary = async () => {
    try { await navigator.clipboard.writeText(summaryText); } catch {}
  };

  return (
    <>
      <div className="inv-card" style={{ marginBottom:SPACING.xxl - 2, overflow:"hidden" }}>
        <div className="inv-card-hd blue" style={{ justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={LayoutDashboard} size={14} strokeWidth={2.3}/> Morning Routine — cadre strict 8h30 à 10h30</span>
          <span style={{ display:"inline-flex", gap:7, alignItems:"center" }}>
            <AlertBadge level={routineDone ? "success" : routine.criticalCount > 0 ? "danger" : "info"} T={T}>{progress}% complété</AlertBadge>
          </span>
        </div>
        <div className="inv-card-bd">
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) auto", gap:SPACING.md, alignItems:"center" }}>
            <div>
              <div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text, lineHeight:1.1 }}>Routine de pilotage du matin</div>
              <div style={{ fontSize:FONT.sm.size + 1, color:T.textSub, marginTop:5 }}>Suivre les étapes dans l’ordre. Les éléments rouges/oranges doivent recevoir une décision avant validation.</div>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
              {!started ? <button type="button" className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setStarted(true)}><Icon as={Sun} size={12}/> Démarrer la routine</button> : <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={resetRoutine}><Icon as={RefreshCw} size={12}/> Réinitialiser</button>}
              <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={copySummary}><Icon as={FileText} size={12}/> Copier synthèse</button>
            </div>
          </div>

          <div style={{ marginTop:SPACING.md, height:10, borderRadius:RADIUS.pill, background:T.input, border:`1px solid ${T.border}`, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${progress}%`, background:routineDone ? SU : T.accent, borderRadius:RADIUS.pill }}/>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginTop:SPACING.md }}>
            <KPICard icon={AlertTriangle} label="Urgences" value={(stats.actionsRetard || 0) + (stats.todayClients.blocked || 0)} color={(stats.actionsRetard || 0) + (stats.todayClients.blocked || 0) ? DA : SU}/>
            <KPICard icon={Phone} label="Prospects à traiter" value={(stats.todayProspects.relances || 0) + (stats.todayProspects.sansAction || 0)} color={(stats.todayProspects.relances || 0) + (stats.todayProspects.sansAction || 0) ? WA : SU}/>
            <KPICard icon={Briefcase} label="Clients à sécuriser" value={(stats.todayClients.documentsWaiting || 0) + (stats.todayClients.partnerRelances || 0)} color={(stats.todayClients.documentsWaiting || 0) + (stats.todayClients.partnerRelances || 0) ? WA : SU}/>
            <KPICard icon={Home} label="Biens à décider" value={(stats.todayBiens.newToSort || 0) + (stats.todayBiens.toMatch || 0) + (stats.todayBiens.toRelance || 0)} color={(stats.todayBiens.toRelance || 0) ? DA : WA}/>
          </div>
        </div>
      </div>

      {!started && (
        <div style={{ marginBottom:SPACING.xxl - 2, padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.lg, color:T.textMuted, background:T.input, textAlign:"center", fontSize:FONT.sm.size + 1 }}>
          Clique sur <strong style={{ color:T.text }}>Démarrer la routine</strong> pour dérouler le cadre strict. Tu peux déjà consulter les autres onglets, mais la routine ne sera pas considérée comme lancée.
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"minmax(240px,.32fr) minmax(0,1fr)", gap:SPACING.md, alignItems:"start", marginBottom:SPACING.xxl - 2 }}>
        <div className="inv-card" style={{ position:"sticky", top:12 }}>
          <div className="inv-card-hd blue"><span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={Check} size={13}/> Séquence obligatoire</span></div>
          <div className="inv-card-bd" style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {DASH_MORNING_STEPS.map((s, i) => {
              const active = activeStep === s.key;
              const done = !!completedSteps[s.key];
              return (
                <button key={s.key} type="button" onClick={() => setActiveStep(s.key)} style={{ border:`1px solid ${active ? T.accentBorder : done ? `${SU}55` : T.border}`, background:active ? T.accentBg : done ? `${SU}10` : T.input, color:active ? T.accent : T.text, borderRadius:RADIUS.md, padding:"9px 10px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, fontFamily:"inherit", cursor:"pointer", textAlign:"left" }}>
                  <span style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}><span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:done ? SU : active ? T.accent : T.textMuted }}>{String(i + 1).padStart(2, "0")}</span><span style={{ fontSize:FONT.sm.size, fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.label}</span></span>
                  {done ? <Icon as={Check} size={13} color={SU}/> : active ? <Icon as={Bell} size={13} color={T.accent}/> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          {DASH_MORNING_STEPS.map((step, idx) => {
            const data = routine.steps[step.key] || { items:[], intro:"" };
            const unresolved = (data.items || []).filter(item => item.required && !decisions[item.id]).length;
            const previousDone = idx === 0 || DASH_MORNING_STEPS.slice(0, idx).every(s => completedSteps[s.key]);
            const stepRulesOk = step.key === "synthese" ? Object.keys(completedSteps).length >= DASH_MORNING_STEPS.length - 1 : unresolved === 0;
            const canComplete = started && previousDone && stepRulesOk;
            const isActive = activeStep === step.key;
            return (
              <RoutineStepCard key={step.key} step={step} isActive={isActive} isDone={!!completedSteps[step.key]} unresolved={unresolved} canComplete={canComplete} onOpen={() => setActiveStep(step.key)} onComplete={() => completeStep(step.key)} T={T}>
                <div style={{ color:T.textSub, fontSize:FONT.sm.size + 1, marginBottom:SPACING.md }}>{data.intro}</div>
                {step.key !== "synthese" ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {(data.items || []).map(item => <RoutineDecisionRow key={item.id} item={item} decision={decisions[item.id]} onDecision={setDecision} T={T} onNavigate={onNavigate}/>) }
                    {(data.items || []).length === 0 && <MiniList items={[]} T={T} empty="Aucun point à traiter dans cette étape"/>}
                  </div>
                ) : (
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:SPACING.md, marginBottom:SPACING.md }}>
                      <KPICard icon={Check} label="Étapes validées" value={`${completedCount}/${DASH_MORNING_STEPS.length}`} color={routineDone ? SU : T.accent}/>
                      <KPICard icon={Send} label="Actions du plan" value={data.plan.length || 1} color="#FFC200"/>
                      <KPICard icon={AlertTriangle} label="Décisions prises" value={Object.keys(decisions).length} color={Object.keys(decisions).length ? SU : WA}/>
                    </div>
                    <div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
                      <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, marginBottom:8 }}>Plan d’action du jour</div>
                      <ol style={{ margin:0, paddingLeft:20, color:T.textSub, fontSize:FONT.sm.size + 1, lineHeight:1.7 }}>
                        {(data.plan.length ? data.plan : ["Aucun point critique détecté — maintenir le suivi courant."]).map((x, i) => <li key={i}>{x}</li>)}
                      </ol>
                    </div>
                  </div>
                )}
              </RoutineStepCard>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TodayDashboard({ stats, clients=[], biens=[], propositions=[], compact=false, T=THEMES_INV.dark, onNavigate }) {
  const go = (target, filter) => onNavigate?.(target, filter);
  const prospectCards = [
    { icon:Phone, label:"Relances aujourd’hui", value:stats.todayProspects.relances, color:stats.todayProspects.relances ? WA : SU, onClick:() => go("crm", { type:"relance_today" }) },
    { icon:Users, label:"Nouveaux entrants", value:stats.todayProspects.entrants, color:"#4db8ff", sub:"Depuis hier" },
    { icon:Calendar, label:"RDV du jour", value:stats.todayProspects.rdv, color:T.accent },
    { icon:AlertTriangle, label:"Stagnants +7 jours", value:stats.todayProspects.stagnants, color:stats.todayProspects.stagnants ? WA : SU },
    { icon:Bell, label:"Prospects sans action", value:stats.todayProspects.sansAction, color:stats.todayProspects.sansAction ? DA : SU },
  ];
  const clientCards = [
    { icon:Users, label:"Clients actifs", value:stats.todayClients.actifs, color:T.accent, onClick:() => go("crm", { type:"statut", value:"Actif" }) },
    { icon:Briefcase, label:"Relances partenaires", value:stats.todayClients.partnerRelances, color:stats.todayClients.partnerRelances ? WA : SU },
    { icon:FileText, label:"Documents en attente", value:stats.todayClients.documentsWaiting, color:stats.todayClients.documentsWaiting ? WA : SU },
    { icon:AlertTriangle, label:"Dossiers bloqués", value:stats.todayClients.blocked, color:stats.todayClients.blocked ? DA : SU },
    { icon:Bell, label:"Clients sans action", value:stats.todayClients.sansAction, color:stats.todayClients.sansAction ? DA : SU, onClick:() => go("crm", { type:"sans_action" }) },
  ];
  const bienCards = [
    { icon:Home, label:"Annonces à trier", value:stats.todayBiens.newToSort, color:stats.todayBiens.newToSort ? WA : SU },
    { icon:Search, label:"En analyse", value:stats.todayBiens.inAnalysis, color:T.accent },
    { icon:Bell, label:"Biens à relancer", value:stats.todayBiens.toRelance, color:stats.todayBiens.toRelance ? DA : SU, onClick:() => go("biens", { type:"a_relancer" }) },
    { icon:Handshake, label:"À matcher client", value:stats.todayBiens.toMatch, color:"#c084fc" },
    { icon:Sparkles, label:"Top opportunités", value:stats.todayBiens.topOpps, color:"#c084fc" },
    { icon:AlertTriangle, label:"Fiches incomplètes", value:stats.todayBiens.incomplets, color:stats.todayBiens.incomplets ? WA : SU },
  ];
  return (
    <>
      <DashboardSection title="Priorités du jour" subtitle="Routine matin 8h30–10h30" icon={AlertTriangle} T={T}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.md }}>
          <KPICard icon={AlertTriangle} label="Actions en retard" value={stats.actionsRetard} color={stats.actionsRetard ? DA : SU} onClick={() => go("crm", { type:"actions_week_or_late" })}/>
          <KPICard icon={Calendar} label="RDV aujourd’hui" value={stats.rdvToday} color={T.accent}/>
          <KPICard icon={Phone} label="Relances prospects" value={stats.todayProspects.relances} color={stats.todayProspects.relances ? WA : SU}/>
          <KPICard icon={Home} label="Biens à relancer" value={stats.todayBiens.toRelance} color={stats.todayBiens.toRelance ? DA : SU} onClick={() => go("biens", { type:"a_relancer" })}/>
          <KPICard icon={FileText} label="Documents en attente" value={stats.todayClients.documentsWaiting} color={stats.todayClients.documentsWaiting ? WA : SU}/>
        </div>
        {!compact && <MiniList items={stats.priorityItems} T={T} onNavigate={onNavigate} empty="Aucune priorité urgente pour aujourd’hui" />}
      </DashboardSection>
      <DashboardSection title="Collaborateurs" subtitle="Tom & Benjamin" icon={Users} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))", gap:SPACING.md }}>{stats.collaborateurs.map(c => <CollaborateurCard key={c.name} c={c} period="today" T={T} onClick={() => go("crm", { type:"collaborateur", value:c.name })}/>)}</div></DashboardSection>
      <DashboardSection title="Prospects" subtitle="Entrants, relances et prospects qui stagnent" icon={Users} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>{prospectCards.map(card => <KPICard key={card.label} {...card}/>)}</div></DashboardSection>
      <DashboardSection title="Clients actifs" subtitle="Dossiers en cours, documents, partenaires et blocages" icon={Briefcase} T={T}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md, marginBottom:compact ? 0 : SPACING.md }}>{clientCards.map(card => <KPICard key={card.label} {...card}/>)}</div>
        {!compact && stats.todayClients.byEtape.length > 0 && <PipelineBar stages={stats.todayClients.byEtape} T={T} onStageClick={(stage) => go("crm", { type:"etape", value:stage.label })}/>}        
      </DashboardSection>
      <DashboardSection title="Biens identifiés" subtitle="Stock, analyse, relances et matching clients" icon={Home} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>{bienCards.map(card => <KPICard key={card.label} {...card}/>)}</div></DashboardSection>
      {!compact && <><MissionActionsCollaborateursDashboard T={T} onNavigate={go}/><OpportunitesChaudesDashboard biens={biens} T={T} onNavigate={go}/><DossiersRelanceDashboard clients={clients} biens={biens} propositions={propositions} T={T} onNavigate={go}/></>}
    </>
  );
}

function WeekDashboard({ stats, clients=[], compact=false, T=THEMES_INV.dark, onNavigate, profil, onMoveEtape }) {
  const go = (target, filter) => onNavigate?.(target, filter);
  const weekCards = [
    { icon:Users, label:"Prospects contactés", value:stats.week.prospectsContactes, color:"#4db8ff", sub:stats.week.deltaProspects.label },
    { icon:Calendar, label:"RDV réalisés", value:stats.week.rdvRealises, color:T.accent, sub:stats.week.deltaRdv.label },
    { icon:Send, label:"Offres faites", value:stats.week.offresFaites, color:"#FFC200" },
    { icon:TrendingUp, label:"Dossiers avancés", value:stats.week.dossiersAvances, color:SU },
    { icon:Home, label:"Visites biens", value:stats.week.visites, color:"#c084fc" },
    { icon:Check, label:"Tâches complétées", value:stats.week.actionsCompleted, color:SU },
  ];
  return (
    <>
      <DashboardSection title="KPIs de la semaine" subtitle="Vision hebdomadaire pour ajuster les priorités" icon={Calendar} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>{weekCards.map(card => <KPICard key={card.label} {...card}/>)}</div></DashboardSection>
      <DashboardSection title="Pipeline prospects — semaine" subtitle="Répartition des prospects par étape commerciale" icon={TrendingUp} T={T}><PipelineBar stages={stats.pipelineStages} T={T} onStageClick={(stage) => go("crm", { type:"pipeline_prospect", value:stage.label })}/></DashboardSection>
      <DashboardSection title="Activité collaborateurs — semaine" subtitle="Tâches complétées, ouvertes et en retard" icon={Users} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))", gap:SPACING.md }}>{stats.collaborateurs.map(c => <CollaborateurCard key={c.name} c={c} period="week" T={T} onClick={() => go("crm", { type:"collaborateur", value:c.name })}/>)}</div></DashboardSection>
      <DashboardSection title="Biens — semaine" subtitle="Analyse, offres et décisions sur les opportunités" icon={Building2} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Search} label="Biens analysés" value={stats.week.biensAnalyses} color={T.accent}/><KPICard icon={Handshake} label="Présentés clients" value={stats.week.biensPresentes} color="#c084fc"/><KPICard icon={Send} label="Offres faites" value={stats.week.offresFaites} color="#FFC200"/><KPICard icon={Trash2} label="Écartés / archivés" value={stats.week.biensArchives} color={WA}/><KPICard icon={Bell} label="À relancer" value={stats.biensARelancer} color={stats.biensARelancer ? DA : SU} onClick={() => go("biens", { type:"a_relancer" })}/></div></DashboardSection>
      {!compact && <><PlanningSemaine profil={profil} T={T}/><PipelineEtapesBoard clients={clients} T={T} onMoveClient={onMoveEtape} onOpenEtape={(etape) => go("crm", etape ? { type:"etape", value:etape } : { type:"all" })}/><StockPilotageDashboard stats={stats} T={T} onNavigate={go}/></>}
    </>
  );
}

function MonthDashboard({ stats, compact=false, T=THEMES_INV.dark, onNavigate }) {
  const monthlyCards = [
    { icon:Users, label:"Prospects entrants", value:stats.month.prospectsEntrants, color:"#4db8ff" },
    { icon:Calendar, label:"RDV réalisés", value:stats.month.rdvRealises, color:T.accent },
    { icon:TrendingUp, label:"Conversion", value:`${stats.month.tauxConversion}%`, color:stats.month.tauxConversion >= 20 ? SU : WA, sub:"Prospect → client signé" },
    { icon:Home, label:"Biens présentés", value:stats.month.biensPresentes, color:"#c084fc" },
    { icon:Handshake, label:"Actes / signatures", value:stats.month.actesSignes, color:SU },
    { icon:Euro, label:"CA encaissé", value:fmtDashboardEur(stats.month.caEncaisse), color:"#FFC200", sub:"Honoraires forfaitaires" },
  ];
  return (
    <>
      <DashboardSection title="KPIs du mois" subtitle="Pilotage stratégique mensuel" icon={BarChart3} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}>{monthlyCards.map(card => <KPICard key={card.label} {...card}/>)}</div></DashboardSection>
      <DashboardSection title="Graphique d’activité mensuelle" subtitle="Évolution sur les 12 derniers mois glissants" icon={BarChart3} T={T}><MonthlyActivityChart data={stats.monthSeries} T={T}/></DashboardSection>
      <DashboardSection title="Suivi des objectifs mensuels" subtitle="Progression par rapport aux objectifs Profero Invest" icon={BarChart3} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:SPACING.md }}>{DASH_OBJECTIVES.map(obj => <ObjectiveProgress key={obj.key} label={obj.label} value={stats.monthlyValues[obj.key] || 0} target={obj.target} icon={obj.icon} T={T}/>)}</div></DashboardSection>
      <DashboardSection title="Récapitulatif collaborateurs" subtitle="Volume de tâches complétées et points à valider" icon={Users} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))", gap:SPACING.md }}>{stats.collaborateurs.map(c => <CollaborateurCard key={c.name} c={c} period="month" T={T} onClick={() => onNavigate?.("crm", { type:"collaborateur", value:c.name })}/>)}</div></DashboardSection>
      {!compact && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:SPACING.md, alignItems:"start" }}><ValeurBusinessDashboard stats={stats} T={T}/><DirectionPilotageDashboard stats={stats} T={T}/></div>}
    </>
  );
}

function ClientsStatutsBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenStatus }) {
  const [dragOverStatut, setDragOverStatut] = useState("");
  const fmtBudgetClient = (v) => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(v) + " €" : "—";
  const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const clientsParStatut = DASH_CLIENT_STATUS_CONFIG.reduce((acc, cfg) => { acc[cfg.statut] = clients.filter(c => (c.statut || "Prospect") === cfg.statut).sort((a,b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity:"base" })); return acc; }, {});
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.xxl-2 }}>
      <div className="inv-card-hd blue" style={{ alignItems:"center" }}><span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><Icon as={LayoutGrid} size={13} strokeWidth={2.2}/>Statuts clients — pilotage rapide</span><span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:600 }}>Glisser-déposer un client pour changer son statut</span></div>
      <div className="inv-card-bd"><div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(230px,1fr))", gap:SPACING.md, overflowX:"auto", paddingBottom:2 }}>
        {DASH_CLIENT_STATUS_CONFIG.map(cfg => { const list = clientsParStatut[cfg.statut] || []; const isOver = dragOverStatut === cfg.statut; const IconComp = cfg.icon; return (
          <div key={cfg.statut} onDragOver={e => { e.preventDefault(); setDragOverStatut(cfg.statut); }} onDragLeave={() => setDragOverStatut("")} onDrop={e => { e.preventDefault(); const clientId = e.dataTransfer.getData("text/plain"); setDragOverStatut(""); if (clientId) onMoveClient?.(clientId, cfg.statut); }} style={{ minHeight:150, borderRadius:RADIUS.lg, border:`1.5px solid ${isOver ? cfg.color : T.border}`, background:isOver ? `${cfg.color}12` : T.input, padding:SPACING.sm + 2, transition:"all .15s" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:SPACING.sm + 2 }}><button type="button" onClick={() => onOpenStatus?.(cfg.statut)} style={{ border:"none", background:"transparent", padding:0, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:7, color:cfg.color, fontFamily:"inherit", fontSize:FONT.sm.size + 1, fontWeight:800 }} title={`Voir les ${cfg.label.toLowerCase()} dans le CRM`}><span style={{ width:24, height:24, borderRadius:RADIUS.sm + 1, display:"inline-flex", alignItems:"center", justifyContent:"center", background:`${cfg.color}18`, color:cfg.color }}><Icon as={IconComp} size={13} strokeWidth={2.2}/></span>{cfg.label}</button><span style={{ minWidth:24, height:24, borderRadius:RADIUS.pill, background:`${cfg.color}18`, color:cfg.color, border:`1px solid ${cfg.color}33`, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:FONT.xs.size, fontWeight:800, fontFamily:"'DM Mono',monospace" }}>{list.length}</span></div>
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>{list.length === 0 ? <div style={{ border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, padding:`${SPACING.md}px ${SPACING.sm}px`, textAlign:"center", color:T.textMuted, fontSize:FONT.xs.size + 1, fontStyle:"italic" }}>Glisser un client ici</div> : list.map(c => { const isMoving = movingClientId === c.id; return <div key={c.id} draggable onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }} onDragEnd={() => setDragOverStatut("")} style={{ padding:`${SPACING.sm}px ${SPACING.sm + 2}px`, borderRadius:RADIUS.md, background:T.card, border:`1px solid ${T.border}`, cursor:isMoving ? "wait" : "grab", opacity:isMoving ? .55 : 1, boxShadow:T.shadowSm, transition:"all .12s" }}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}><div style={{ minWidth:0 }}><div style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.prenom} {c.nom}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, display:"flex", gap:6, flexWrap:"wrap" }}><span>{fmtBudgetClient(c.budget)}</span>{c.date_prochaine_action && <span>· Action {fmtDateShort(c.date_prochaine_action)}</span>}</div></div><span style={{ color:T.textMuted, fontSize:15, lineHeight:1 }}>↔</span></div></div>; })}</div>
          </div>
        ); })}
      </div></div>
    </div>
  );
}

function DossiersRelanceDashboard({ clients=[], biens=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const today = isoDate(new Date());
  const items = [];
  clients.filter(c => c.statut !== "Terminé" && !c.prochaine_action).slice(0,4).forEach(c => items.push({ title:`${getClientName(c)} — aucune prochaine action`, sub:`${c.etape || c.statut || "À qualifier"}`, badge:"Client", color:DA, icon:Users, onClick:() => onNavigate?.("crm", { type:"sans_action" }) }));
  biens.filter(b => b.date_relance && b.date_relance <= today).slice(0,4).forEach(b => items.push({ title:`${b.adresse || b.ville || "Bien"} — relance à faire`, sub:`${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell, onClick:() => onNavigate?.("biens", { type:"a_relancer" }) }));
  biens.filter(b => ["Offre envoyée"].includes(b.statut) && !(b.date_relance && b.date_relance > today)).slice(0,3).forEach(b => items.push({ title:`Offre sans relance — ${b.adresse || b.ville || "Bien"}`, sub:`Offre ${fmtDashboardEur(b.montant_offre)} · programmer une relance`, badge:"Offre", color:T.accent, icon:Send, onClick:() => onNavigate?.("biens", { type:"statut", value:"Offre envoyée" }) }));
  propositions.filter(p => p.statut === "proposé" || p.statut === "en analyse").slice(0,3).forEach(p => items.push({ title:"Proposition à suivre", sub:`Client / bien à relancer · ${safeDate(p.date_proposition || p.created_at)}`, badge:"Prop.", color:"#c084fc", icon:Handshake }));
  return <DashboardPanel title="Dossiers à relancer" icon={Bell} subtitle="Clients, biens, offres et propositions à ne pas laisser dormir" T={T}><DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucun dossier à relancer" /></DashboardPanel>;
}

function DirectionPilotageDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const items = [["Honoraires signés", fmtDashboardEur(stats.baseHonorairesSignes), SU, "Base 1 583 € HT / client signé"], ["Honoraires pipeline", fmtDashboardEur(stats.baseHonorairesPipeline), "#FFC200", "Clients en cours + prospects"], ["Conseil estimé", fmtDashboardEur(stats.estimationHonoraireConseil), "#c084fc", "Moy. 7 500 € HT / offre active"], ["Taux transformation", `${stats.tauxTransformation || 0}%`, T.accent, "Clients réels / contacts"], ["Acceptation offres", `${stats.tauxAcceptationOffres || 0}%`, SU, "Offres acceptées / envoyées"], ["Délai signature", stats.delaiMoyenSignature !== null ? `${stats.delaiMoyenSignature} j` : "—", WA, "Premier contact → signature"], ["Qualité stock", `${stats.tauxFichesCompletes || 0}%`, T.accent, "Fiches biens complètes"]];
  return <DashboardPanel title="Direction / pilotage" icon={BarChart3} subtitle="Vision dirigeant : CA, conversion, délai et qualité du stock" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>{items.map(([label,value,color,sub]) => <div key={label} className="inv-kpi" style={{ padding:12, borderLeft:`3px solid ${color}` }}><div className="inv-kpi-lbl">{label}</div><div className="inv-kpi-val" style={{ fontSize:FONT.xl.size, color }}>{value}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{sub}</div></div>)}</div></DashboardPanel>;
}

function ActionsPrioritairesDashboard({ clients=[], biens=[], planning=[], T=THEMES_INV.dark, onNavigate }) {
  const { today, endWeek } = getWeekRange();
  const items = [];
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action < today).slice(0,4).forEach(c => items.push({ title:`${getClientName(c)} — action en retard`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Retard", color:DA, icon:AlertTriangle, onClick:() => onNavigate?.("crm", { type:"actions_week_or_late" }) }));
  biens.filter(b => b.date_relance && b.date_relance <= today).slice(0,3).forEach(b => items.push({ title:`Relancer le bien — ${b.adresse || b.ville || "sans adresse"}`, sub:`Relance prévue le ${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell, onClick:() => onNavigate?.("biens", { type:"a_relancer" }) }));
  planning.filter(e => e.date_rdv === today).slice(0,3).forEach(e => items.push({ title:`Aujourd'hui — ${e.titre}`, sub:`${e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"} · ${e.type || "RDV"}`, badge:"Aujourd'hui", color:SU, icon:Calendar }));
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action >= today && c.date_prochaine_action <= endWeek).slice(0,3).forEach(c => items.push({ title:`${getClientName(c)} — action cette semaine`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Semaine", color:T.accent, icon:Calendar, onClick:() => onNavigate?.("crm", { type:"actions_week_or_late" }) }));
  return <DashboardPanel title="À faire en priorité" icon={AlertTriangle} subtitle="Actions, relances et RDV les plus urgents" T={T}><DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucune action prioritaire cette semaine" /></DashboardPanel>;
}

function OpportunitesChaudesDashboard({ biens=[], T=THEMES_INV.dark, onNavigate }) {
  const hot = [...biens].map(b => ({ ...b, _score:getBienScore(b) })).filter(b => b._score > 0 || ["Visite programmée", "Visité", "À analyser", "A analyser", "Offre à faire", "Offre envoyée", "Offre acceptée"].includes(b.statut)).sort((a,b) => b._score - a._score).slice(0,6);
  return <DashboardPanel title="Opportunités chaudes" icon={Sparkles} subtitle="Biens qui méritent une décision rapide" T={T}>{hot.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center", fontSize:FONT.sm.size + 1, fontStyle:"italic" }}>Aucune opportunité chaude détectée</div> : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:SPACING.md }}>{hot.map(b => <button key={b.id} type="button" onClick={() => onNavigate?.("biens", { type:"all" })} style={{ background:T.input, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:SPACING.md, textAlign:"left", fontFamily:"inherit", cursor:"pointer" }}><div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:8 }}><div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text, lineHeight:1.25, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{getBienLabel(b)}</div><span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, fontWeight:900, color:T.accent, background:T.accentBg, border:`1px solid ${T.accentBorder}`, borderRadius:RADIUS.pill, padding:"3px 7px" }}>Score {b._score}</span></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Rendement<br/><strong style={{ fontSize:FONT.sm.size + 1, color:SU }}>{b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "—"}</strong></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Cash-flow<br/><strong style={{ fontSize:FONT.sm.size + 1, color:Number(b.cashflow_estime) > 0 ? SU : WA }}>{fmtDashboardEur(b.cashflow_estime)}</strong></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Offre<br/><strong style={{ fontSize:FONT.sm.size + 1, color:T.accent }}>{fmtDashboardEur(b.montant_offre)}</strong></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Travaux<br/><strong style={{ fontSize:FONT.sm.size + 1, color:T.textSub }}>{fmtDashboardEur(b.prix_travaux)}</strong></div></div><div style={{ fontSize:FONT.xs.size + 1, color:T.textSub, display:"flex", justifyContent:"space-between", gap:8 }}><span>{b.visite_data?.conclusion?.recommandation || b.statut || "À analyser"}</span><span>{b.statut || "—"}</span></div></button>)}</div>}</DashboardPanel>;
}

function StockPilotageDashboard({ stats, T=THEMES_INV.dark, onNavigate }) {
  if (!stats) return null;
  return <><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.lg }}><KPICard icon={Home} label="Biens en stock" value={stats.biensTotaux} color="#4db8ff" onClick={() => onNavigate?.("biens", { type:"all" })}/><KPICard icon={Sparkles} label="Top opportunités" value={stats.topOpportunites} color="#c084fc" sub="Score Profero élevé" onClick={() => onNavigate?.("biens", { type:"all" })}/><KPICard icon={Bell} label="À relancer" value={stats.biensARelancer} color={DA} onClick={() => onNavigate?.("biens", { type:"a_relancer" })}/><KPICard icon={Send} label="Offres envoyées" value={stats.offreEnvoyees} color="#FFC200" onClick={() => onNavigate?.("biens", { type:"statut", value:"Offre envoyée" })}/><KPICard icon={Check} label="Offres acceptées" value={stats.offresAcceptees} color={SU} onClick={() => onNavigate?.("biens", { type:"statut", value:"Offre acceptée" })}/><KPICard icon={AlertTriangle} label="Fiches incomplètes" value={stats.biensIncomplets} color={WA} sub={`${stats.tauxFichesCompletes}% complètes`}/></div><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:SPACING.md, marginBottom:SPACING.xxl - 2 }}>{[["Fiches complètes", stats.tauxFichesCompletes, SU], ["Biens géolocalisés", stats.tauxGeoloc, T.accent], ["Simulateurs remplis", stats.tauxSimulateur, "#c084fc"], ["Offres / stock", stats.tauxOffresStock, "#FFC200"]].map(([label,pct,color]) => <div key={label} className="inv-card" style={{ padding:SPACING.md, borderLeft:`3px solid ${color}` }}><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}><div className="inv-kpi-lbl">{label}</div><div style={{ fontFamily:"'DM Mono',monospace", fontWeight:900, color }}>{pct}%</div></div><div style={{ height:7, background:T.input, borderRadius:RADIUS.pill, overflow:"hidden", border:`1px solid ${T.border}` }}><div style={{ height:"100%", width:`${Math.max(0, Math.min(100, pct))}%`, background:color, borderRadius:RADIUS.pill }}/></div></div>)}</div></>;
}

function PipelineEtapesBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenEtape }) {
  const [dragOverEtape, setDragOverEtape] = useState("");
  const clientsByEtape = ETAPES_CLIENT.reduce((acc, etape) => { acc[etape] = clients.filter(c => (c.etape || "") === etape).sort((a,b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity:"base" })); return acc; }, {});
  const columns = [{ etape:"", label:"Étape non définie", color:DA, list:clients.filter(c => !c.etape) }, ...ETAPES_CLIENT.map((etape,i) => ({ etape, label:etape, color:DASH_STAGE_COLORS[i % DASH_STAGE_COLORS.length], list:clientsByEtape[etape] || [] }))];
  return <DashboardPanel title="Pipeline clients par étape" icon={TrendingUp} subtitle="Glisser-déposer pour changer l’étape du client" T={T}><div style={{ display:"flex", gap:SPACING.md, overflowX:"auto", paddingBottom:4 }}>{columns.map(col => { const isOver = dragOverEtape === col.etape; const budget = col.list.reduce((s,c) => s + (Number(c.budget) || 0), 0); return <div key={col.label} onDragOver={e => { e.preventDefault(); setDragOverEtape(col.etape); }} onDragLeave={() => setDragOverEtape("")} onDrop={e => { e.preventDefault(); const clientId = e.dataTransfer.getData("text/plain"); setDragOverEtape(""); if (clientId) onMoveClient?.(clientId, col.etape); }} style={{ minWidth:235, maxWidth:250, background:isOver ? `${col.color}12` : T.input, border:`1.5px solid ${isOver ? col.color : T.border}`, borderRadius:RADIUS.lg, padding:SPACING.sm + 2, transition:"all .15s" }}><button type="button" onClick={() => onOpenEtape?.(col.etape)} style={{ border:"none", background:"transparent", padding:0, cursor:"pointer", fontFamily:"inherit", textAlign:"left", width:"100%" }}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:5 }}><div style={{ fontSize:FONT.xs.size + 1, fontWeight:900, color:col.color, lineHeight:1.2, textTransform:"uppercase", letterSpacing:.6 }}>{col.label}</div><span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, fontWeight:900, color:col.color, background:`${col.color}18`, border:`1px solid ${col.color}33`, borderRadius:RADIUS.pill, padding:"2px 7px" }}>{col.list.length}</span></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginBottom:9 }}>Budget cumulé : <strong style={{ color:T.textSub }}>{fmtDashboardEur(budget)}</strong></div></button><div style={{ display:"flex", flexDirection:"column", gap:7, minHeight:72 }}>{col.list.length === 0 ? <div style={{ border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, padding:SPACING.sm, textAlign:"center", fontSize:FONT.xs.size, color:T.textMuted, fontStyle:"italic" }}>Déposer ici</div> : col.list.slice(0,8).map(c => <div key={c.id} draggable onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:`${SPACING.sm - 1}px ${SPACING.sm}px`, cursor:movingClientId === c.id ? "wait" : "grab", opacity:movingClientId === c.id ? .55 : 1 }}><div style={{ fontSize:FONT.sm.size, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getClientName(c)}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, display:"flex", justifyContent:"space-between", gap:8 }}><span>{fmtDashboardEur(c.budget)}</span><span>{safeDate(c.date_prochaine_action)}</span></div></div>)}</div></div>; })}</div></DashboardPanel>;
}

function ClientsARisqueDashboard({ clients=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const propByClient = propositions.reduce((acc,p) => { if (p.client_id) acc[p.client_id] = (acc[p.client_id] || 0) + 1; return acc; }, {});
  const risks = [];
  clients.filter(c => c.statut !== "Prospect").forEach(c => { if (!c.prochaine_action && !c.date_prochaine_action) risks.push({ title:`${getClientName(c)} — aucune prochaine action`, sub:`Statut : ${c.statut || "—"} · Étape : ${c.etape || "non définie"}`, color:DA, icon:AlertTriangle, onClick:() => onNavigate?.("crm", { type:"sans_action" }) }); if ((c.statut === "Actif" || c.date_signature) && !propByClient[c.id]) risks.push({ title:`${getClientName(c)} — aucun bien proposé`, sub:`Budget : ${fmtDashboardEur(c.budget)} · Contrat signé`, color:WA, icon:Home, onClick:() => onNavigate?.("crm", { type:"signes" }) }); if (!c.etape) risks.push({ title:`${getClientName(c)} — étape non définie`, sub:"Le parcours client n’est pas pilotable", color:"#c084fc", icon:TrendingUp, onClick:() => onNavigate?.("crm", { type:"all" }) }); });
  return <DashboardPanel title="Clients à risque" icon={AlertTriangle} subtitle="Situations qui peuvent créer une perte de suivi" T={T}><DashboardAlertList items={risks.slice(0,8)} T={T} empty="Aucun client à risque détecté" /></DashboardPanel>;
}

function PerformanceCommercialeDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const cards = [["Transformation contacts → clients", `${stats.tauxTransformation}%`, "Clients hors prospects / total contacts", SU, Handshake], ["Biens proposés / client actif", stats.biensParClientActif.toFixed(1).replace(".", ","), "Propositions / clients actifs", T.accent, Building2], ["Offres acceptées / envoyées", `${stats.tauxAcceptationOffres}%`, "Offres acceptées / offres actives", "#FFC200", Check], ["Délai moyen signature", stats.delaiMoyenSignature ? `${stats.delaiMoyenSignature} j` : "—", "Premier contact → signature", "#c084fc", Calendar]];
  return <DashboardPanel title="Performance commerciale" icon={BarChart3} subtitle="Ratios de conversion et rythme commercial" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md }}>{cards.map(([label,value,sub,color,IconComp]) => <KPICard key={label} label={label} value={value} sub={sub} color={color} icon={IconComp}/>)}</div></DashboardPanel>;
}

function ValeurBusinessDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  return <DashboardPanel title="Valeur business potentielle" icon={Wallet} subtitle="Vision financière du pipeline" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md }}><KPICard icon={Wallet} label="Budget clients actifs" value={fmtDashboardEur(stats.budgetClientsActifs)} color={T.accent} sub="Prospects exclus"/><KPICard icon={Send} label="Montant offres en cours" value={fmtDashboardEur(stats.montantOffresCours)} color="#FFC200" sub="Offres renseignées sur les biens/projets"/><KPICard icon={Handshake} label="Base honoraires signés" value={fmtDashboardEur(stats.baseHonorairesSignes)} color={SU} sub="1 583 € HT / client signé"/><KPICard icon={TrendingUp} label="Base honoraires pipeline" value={fmtDashboardEur(stats.baseHonorairesPipeline)} color="#c084fc" sub="Clients en cours + prospects"/><KPICard icon={Briefcase} label="Estimation honoraire conseil" value={fmtDashboardEur(stats.estimationHonoraireConseil)} color="#4db8ff" sub="7 500 € HT / offre active"/></div></DashboardPanel>;
}

function PlanningSemaine({ profil, T=THEMES_INV.dark }) {
  const { startWeek, endWeek, today } = getWeekRange();
  const [events, setEvents] = useState([]);
  const [clients, setClients] = useState([]);
  const [biens, setBiens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"", client_id:"", bien_id:"", lieu:"", commentaire:"" });
  const charger = async () => { setLoading(true); setError(""); const [planningRes, clientsRes, biensRes] = await Promise.all([supabase.from("invest_planning").select("*, client:invest_clients(id,nom,prenom), bien:invest_biens(id,adresse,ville)").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }), supabase.from("invest_clients").select("id,nom,prenom").order("nom"), supabase.from("invest_biens").select("id,adresse,ville").order("adresse")]); let planningData = planningRes.data || []; if (planningRes.error) { const fallback = await supabase.from("invest_planning").select("*").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }); if (fallback.error) { setError("La table invest_planning n'existe pas encore. Lancez la migration SQL fournie avec le fichier."); planningData = []; } else planningData = fallback.data || []; } setEvents(planningData); setClients(clientsRes.data || []); setBiens(biensRes.data || []); setLoading(false); };
  useEffect(() => { charger(); }, []);
  const ajouter = async () => { if (!form.titre.trim() || !form.date_rdv) return; setSaving(true); const payload = { titre:form.titre.trim(), type:form.type, date_rdv:form.date_rdv, heure_debut:form.heure_debut || null, heure_fin:form.heure_fin || null, client_id:form.client_id || null, bien_id:form.bien_id || null, lieu:form.lieu.trim() || null, commentaire:form.commentaire.trim() || null, created_by:profil?.email || profil?.nom || null }; const { error } = await supabase.from("invest_planning").insert(payload); setSaving(false); if (error) { console.error("Erreur insert invest_planning:", error); setError(`Impossible d'ajouter le RDV : ${error.message || "vérifiez les droits RLS et la table invest_planning."}`); return; } setForm({ titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"", client_id:"", bien_id:"", lieu:"", commentaire:"" }); charger(); };
  const supprimer = async (id) => { if (!window.confirm("Supprimer ce rendez-vous ?")) return; await supabase.from("invest_planning").delete().eq("id", id); charger(); };
  const jours = Array.from({ length:7 }, (_, i) => { const d = new Date(startWeek); d.setDate(d.getDate() + i); return { iso:isoDate(d), label:d.toLocaleDateString("fr-FR", { weekday:"short", day:"2-digit", month:"short" }) }; });
  return <div className="inv-card" style={{ marginBottom:SPACING.xxl - 2 }}><div className="inv-card-hd blue"><span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><Icon as={Calendar} size={13} strokeWidth={2.2}/>Planning commercial de la semaine</span></div><div className="inv-card-bd">{error && <div style={{ marginBottom:12, padding:"9px 11px", borderRadius:RADIUS.md, background:dashSemantic("warning", { bg:"#fffbeb", border:"#fde68a" }).bg, border:`1px solid ${dashSemantic("warning", { bg:"#fffbeb", border:"#fde68a" }).border}`, color:WA, fontSize:FONT.sm.size }}>{error}</div>}<div style={{ display:"grid", gridTemplateColumns:"1.2fr 150px 130px 90px 90px 1fr 1fr auto", gap:8, alignItems:"center", marginBottom:14, overflowX:"auto" }}><input className="inv-inp" value={form.titre} placeholder="Titre du RDV" onChange={e => setForm({ ...form, titre:e.target.value })} style={{ width:"100%", textAlign:"left" }}/><select className="inv-sel" value={form.type} onChange={e => setForm({ ...form, type:e.target.value })}>{TYPES_PLANNING_INVEST.map(t => <option key={t}>{t}</option>)}</select><input className="inv-inp" type="date" value={form.date_rdv} onChange={e => setForm({ ...form, date_rdv:e.target.value })} style={{ width:"100%" }}/><input className="inv-inp" type="time" value={form.heure_debut} onChange={e => setForm({ ...form, heure_debut:e.target.value })} style={{ width:"100%" }}/><input className="inv-inp" type="time" value={form.heure_fin} onChange={e => setForm({ ...form, heure_fin:e.target.value })} style={{ width:"100%" }}/><select className="inv-sel" value={form.client_id} onChange={e => setForm({ ...form, client_id:e.target.value })}><option value="">Client lié</option>{clients.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}</select><select className="inv-sel" value={form.bien_id} onChange={e => setForm({ ...form, bien_id:e.target.value })}><option value="">Bien lié</option>{biens.map(b => <option key={b.id} value={b.id}>{b.adresse}{b.ville ? ` — ${b.ville}` : ""}</option>)}</select><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={ajouter} disabled={saving || !form.titre.trim()}><Icon as={Plus} size={12} strokeWidth={2.2}/>Ajouter</button></div>{loading ? <div style={{ textAlign:"center", color:T.textMuted, padding:18 }}>Chargement…</div> : <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8, overflowX:"auto" }}>{jours.map(j => { const evts = events.filter(e => e.date_rdv === j.iso); return <div key={j.iso} style={{ minWidth:145, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, overflow:"hidden", background:T.input }}><div style={{ padding:"7px 9px", background:j.iso === today ? T.accentBg : T.sectionHd, color:j.iso === today ? T.accent : T.textSub, fontSize:FONT.xs.size, fontWeight:800, textTransform:"uppercase", letterSpacing:.8 }}>{j.label}</div><div style={{ padding:8, display:"flex", flexDirection:"column", gap:6, minHeight:92 }}>{evts.length === 0 ? <div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontStyle:"italic" }}>Aucun RDV</div> : evts.map(e => <div key={e.id} style={{ padding:"7px 8px", borderRadius:RADIUS.sm + 1, background:T.card, border:`1px solid ${T.border}` }}><div style={{ display:"flex", justifyContent:"space-between", gap:5 }}><div style={{ fontSize:FONT.sm.size, fontWeight:800, color:T.text, lineHeight:1.2 }}>{e.titre}</div><button onClick={() => supprimer(e.id)} style={{ background:"transparent", border:"none", color:T.textMuted, cursor:"pointer", fontSize:13 }}>×</button></div><div style={{ fontSize:FONT.xs.size, color:T.accent, marginTop:3, fontWeight:700 }}>{e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"}{e.heure_fin ? ` - ${e.heure_fin.slice(0,5)}` : ""}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2 }}>{e.type}</div></div>)}</div></div>; })}</div>}</div></div>;
}

function MissionActionsCollaborateursDashboard({ T=THEMES_INV.dark, onNavigate }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reminderStatus, setReminderStatus] = useState("");
  const today = new Date().toISOString().slice(0,10);
  const charger = useCallback(async () => { setLoading(true); setError(""); const { data, error } = await supabase.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").in("status", ["a_faire", "en_cours", "bloque"]).order("due_date", { ascending:true, nullsFirst:false }).limit(80); if (error) { if (error.code !== "42P01") setError(error.message); setActions([]); } else setActions(data || []); setLoading(false); }, []);
  const lancerRelancesDuJour = useCallback(async (manual=false) => { const storageKey = `profero_mission_daily_reminders_${today}`; if (!manual) { try { if (window.localStorage.getItem(storageKey) === "done") return; } catch {} } if (manual) setReminderStatus("Envoi des relances du jour…"); const { data, error } = await supabase.functions.invoke("send-mission-daily-reminders", { body:{ source:manual ? "manual" : "app_daily", date:today } }); if (error || data?.error) { const msg = data?.error || error?.message || "Relances quotidiennes non disponibles"; if (manual) setReminderStatus(`⚠ ${msg}`); return; } try { window.localStorage.setItem(storageKey, "done"); } catch {} if (manual) { setReminderStatus(`✅ ${data?.sent || 0} relance(s) envoyée(s), ${data?.skipped || 0} ignorée(s)`); charger(); } }, [today, charger]);
  useEffect(() => { charger(); lancerRelancesDuJour(false); }, [charger, lancerRelancesDuJour]);
  const grouped = MISSION_COLLABORATEURS.reduce((acc, name) => ({ ...acc, [name]:actions.filter(a => (a.responsable || "") === name) }), {});
  const late = actions.filter(a => a.due_date && a.due_date < today).length;
  if (!loading && !actions.length && !error) return null;
  return <div className="inv-card" style={{ marginBottom:SPACING.xxl - 2 }}><div className="inv-card-hd" style={{ justifyContent:"space-between" }}><span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><Icon as={Bell} size={13} strokeWidth={2.2}/>Actions automatisées collaborateurs</span><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,.65)", color:"black", border:`1px solid ${T.border}` }} onClick={() => lancerRelancesDuJour(true)}><Icon as={Send} size={12}/>Relances du jour</button><button className="inv-btn inv-btn-sm" style={{ background:"rgba(255,255,255,.65)", color:"black", border:`1px solid ${T.border}` }} onClick={charger}><Icon as={RefreshCw} size={12}/>Actualiser</button></div></div><div className="inv-card-bd">{error && <div style={{ padding:"8px 10px", borderRadius:8, background:"#fff1f2", border:"1px solid #fecdd3", color:"#be123c", fontSize:12 }}>⚠ {error}</div>}{reminderStatus && <div style={{ padding:"8px 10px", borderRadius:8, background:"#eff6ff", border:"1px solid #bfdbfe", color:"#1d4ed8", fontSize:12, marginBottom:8 }}>{reminderStatus}</div>}{loading ? <div style={{ padding:14, textAlign:"center", color:T.textMuted }}>Chargement…</div> : <><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:8, marginBottom:12 }}><div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:10, padding:"9px 11px" }}><div style={{ fontSize:10, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>Actions ouvertes</div><div style={{ fontSize:18, fontWeight:900, color:T.text }}>{actions.length}</div></div><div style={{ border:`1px solid ${late ? "#fecdd3" : T.border}`, background:late ? "#fff1f2" : T.input, borderRadius:10, padding:"9px 11px" }}><div style={{ fontSize:10, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>En retard</div><div style={{ fontSize:18, fontWeight:900, color:late ? "#dc2626" : T.text }}>{late}</div></div><div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:10, padding:"9px 11px" }}><div style={{ fontSize:10, color:T.textMuted, fontWeight:800, textTransform:"uppercase" }}>Bloquées</div><div style={{ fontSize:18, fontWeight:900, color:"#dc2626" }}>{actions.filter(a => a.status === "bloque").length}</div></div></div><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:8 }}>{Object.entries(grouped).filter(([,list]) => list.length).slice(0,8).map(([owner,list]) => <div key={owner} style={{ border:`1px solid ${T.border}`, background:"#fff", borderRadius:10, padding:"9px 10px" }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", marginBottom:6 }}><div style={{ fontSize:13, fontWeight:900, color:T.text }}>{owner}</div><span style={{ fontSize:11, fontWeight:900, color:T.accent, background:T.accentBg, borderRadius:99, padding:"2px 7px" }}>{list.length}</span></div>{list.slice(0,4).map(a => <div key={a.id} style={{ padding:"6px 0", borderTop:`1px solid ${T.border}` }}><div style={{ fontSize:11, fontWeight:800, color:a.due_date && a.due_date < today ? "#dc2626" : T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.action_title}</div><div style={{ fontSize:10, color:T.textMuted, marginTop:1 }}>{a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client"} · {a.step_label} · {a.due_date ? new Date(a.due_date).toLocaleDateString("fr-FR") : "—"}</div></div>)}</div>)}</div></>}</div></div>;
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [activeTab, setActiveTab] = useState("routine");
  const [compact, setCompact] = useState(false);
  const [clientsDash, setClientsDash] = useState([]);
  const [biensDash, setBiensDash] = useState([]);
  const [propsDash, setPropsDash] = useState([]);
  const [planningDash, setPlanningDash] = useState([]);
  const [actionsDash, setActionsDash] = useState([]);
  const [movingClientId, setMovingClientId] = useState(null);
  const [movingEtapeClientId, setMovingEtapeClientId] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loading, setLoading] = useState(true);
  const [optionalErrors, setOptionalErrors] = useState([]);

  const chargerDashboard = useCallback(async () => {
    setLoading(true); setDashboardError(""); setOptionalErrors([]);
    const today = dashDate(new Date());
    const endMonth = dashEndOfMonth(today);
    const previousYear = dashAddDays(today, -370);
    const runQuery = async (label, primaryQuery, fallbackQuery=null) => {
      const execute = async (query) => {
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      };
      try {
        return await execute(primaryQuery);
      } catch (primaryError) {
        if (fallbackQuery) {
          try {
            console.warn(`[TableauBord] ${label} : requête principale indisponible, fallback utilisé`, primaryError);
            return await execute(fallbackQuery);
          } catch (fallbackError) {
            console.warn(`[TableauBord] ${label}:`, fallbackError);
            setOptionalErrors(prev => [...prev, `${label} : ${fallbackError.message || "non disponible"}`]);
            return [];
          }
        }
        console.warn(`[TableauBord] ${label}:`, primaryError);
        setOptionalErrors(prev => [...prev, `${label} : ${primaryError.message || "non disponible"}`]);
        return [];
      }
    };

    const [clients, biens, propositions, planning, actions] = await Promise.all([
      runQuery(
        "Clients",
        supabase.from("invest_clients").select("id,nom,prenom,statut,budget,date_signature,date_premier_contact,prochaine_action,date_prochaine_action,created_at,updated_at,etape,source,conseiller"),
        supabase.from("invest_clients").select("id,nom,prenom,statut,budget,date_signature,date_premier_contact,prochaine_action,date_prochaine_action,created_at,etape,source,conseiller")
      ),
      runQuery(
        "Biens",
        supabase.from("invest_biens").select("id,adresse,ville,statut,date_relance,date_visite,rendement_brut,cashflow_estime,prix_vente,prix_travaux,cout_total,montant_offre,visite_data,latitude,longitude,reference_interne,conseiller_profero,created_at,updated_at"),
        supabase.from("invest_biens").select("id,adresse,ville,statut,date_relance,date_visite,rendement_brut,cashflow_estime,prix_vente,prix_travaux,cout_total,montant_offre,visite_data,latitude,longitude,reference_interne,conseiller_profero,created_at")
      ),
      runQuery(
        "Propositions",
        supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition,bien:invest_biens(id,montant_offre,prix_vente,statut)"),
        supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition")
      ),
      runQuery(
        "Planning",
        supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire,created_at,updated_at").gte("date_rdv", dashIso(previousYear)).lte("date_rdv", dashIso(endMonth)).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }),
        supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire,created_at").gte("date_rdv", dashIso(previousYear)).lte("date_rdv", dashIso(endMonth)).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true })
      ),
      runQuery(
        "Actions mission",
        supabase.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").order("due_date", { ascending:true, nullsFirst:false }).limit(300),
        supabase.from("invest_mission_actions").select("*").order("due_date", { ascending:true, nullsFirst:false }).limit(300)
      ),
    ]);
    setClientsDash(clients); setBiensDash(biens); setPropsDash(propositions); setPlanningDash(planning); setActionsDash(actions); setLoading(false);
  }, []);

  useEffect(() => { chargerDashboard(); }, [chargerDashboard]);

  const stats = useMemo(() => buildDashboardStats({ clients:clientsDash, biens:biensDash, propositions:propsDash, planning:planningDash, actions:actionsDash }), [clientsDash, biensDash, propsDash, planningDash, actionsDash]);
  const go = (target, filter) => { if (onNavigate) onNavigate(target, filter); };

  const changerStatutClient = async (clientId, nouveauStatut) => { const client = clientsDash.find(c => c.id === clientId); if (!client || !nouveauStatut || client.statut === nouveauStatut) return; const ancienStatut = client.statut || "Prospect"; setMovingClientId(clientId); setDashboardError(""); setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:nouveauStatut } : c)); const { error } = await supabase.from("invest_clients").update({ statut:nouveauStatut }).eq("id", clientId); setMovingClientId(null); if (error) { console.error("Erreur changement statut client:", error); setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:ancienStatut } : c)); setDashboardError(`Impossible de modifier le statut de ${client.prenom || ""} ${client.nom || ""} : ${error.message || "erreur Supabase"}`); } };
  const changerEtapeClient = async (clientId, nouvelleEtape) => { const client = clientsDash.find(c => c.id === clientId); if (!client || (client.etape || "") === (nouvelleEtape || "")) return; const ancienneEtape = client.etape || ""; setMovingEtapeClientId(clientId); setDashboardError(""); setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:nouvelleEtape || null } : c)); const { error } = await supabase.from("invest_clients").update({ etape:nouvelleEtape || null }).eq("id", clientId); setMovingEtapeClientId(null); if (error) { console.error("Erreur changement étape client:", error); setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:ancienneEtape || null } : c)); setDashboardError(`Impossible de modifier l'étape de ${getClientName(client)} : ${error.message || "erreur Supabase"}`); } };

  const renderTabButton = (tab) => { const active = activeTab === tab.key; const IconComp = tab.icon; return <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} style={{ border:`1px solid ${active ? T.accentBorder : T.border}`, background:active ? T.accentBg : T.input, color:active ? T.accent : T.textSub, borderRadius:RADIUS.pill, padding:"9px 13px", display:"inline-flex", alignItems:"center", gap:7, cursor:"pointer", fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:900, boxShadow:active ? T.shadowSm : "none" }}><Icon as={IconComp} size={14} strokeWidth={2.3}/>{tab.label}</button>; };

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth:1420, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:SPACING.md, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}><div style={{ width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={LayoutDashboard} size={24} strokeWidth={2}/></div><div><div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Tableau de bord</div><div style={{ fontSize:FONT.sm.size + 1, color:T.textSub, marginTop:2 }}>Morning Routine stricte + cockpit Profero Invest</div>{stats && <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginTop:9 }}>{stats.actionsRetard > 0 && <AlertBadge level="danger" T={T}>{stats.actionsRetard} action{stats.actionsRetard > 1 ? "s" : ""} en retard</AlertBadge>}{stats.todayProspects.stagnants > 0 && <AlertBadge level="warning" T={T}>{stats.todayProspects.stagnants} prospect{stats.todayProspects.stagnants > 1 ? "s" : ""} stagnant{stats.todayProspects.stagnants > 1 ? "s" : ""}</AlertBadge>}{stats.todayClients.blocked > 0 && <AlertBadge level="danger" T={T}>{stats.todayClients.blocked} dossier{stats.todayClients.blocked > 1 ? "s" : ""} bloqué{stats.todayClients.blocked > 1 ? "s" : ""}</AlertBadge>}{stats.actionsRetard === 0 && stats.todayProspects.stagnants === 0 && stats.todayClients.blocked === 0 && <AlertBadge level="success" T={T}>Pilotage sain</AlertBadge>}</div>}</div></div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}><button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setCompact(v => !v)} title="Basculer entre affichage condensé et détaillé"><Icon as={compact ? Eye : LayoutGrid} size={12} strokeWidth={2.2}/>{compact ? "Mode détaillé" : "Mode condensé"}</button><button className="inv-btn inv-btn-out inv-btn-sm" onClick={chargerDashboard}><Icon as={RefreshCw} size={12} strokeWidth={2.2}/>Actualiser</button></div>
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, marginBottom:SPACING.xl, flexWrap:"wrap" }}><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>{DASH_TABS.map(renderTabButton)}</div>{stats && <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}><AlertBadge level="info" T={T} icon={Users}>{stats.prospects} prospects</AlertBadge><AlertBadge level="info" T={T} icon={Briefcase}>{stats.actifs} clients actifs</AlertBadge><AlertBadge level="info" T={T} icon={Home}>{stats.biensTotaux} biens</AlertBadge><AlertBadge level="success" T={T} icon={Euro}>{fmtDashboardEur(stats.baseHonorairesPipeline)} pipeline</AlertBadge></div>}</div>
      {optionalErrors.length > 0 && <div style={{ marginBottom:SPACING.md, padding:`${SPACING.sm + 2}px ${SPACING.md}px`, borderRadius:RADIUS.md, background:dashSemantic("warning", { bg:"#fffbeb", border:"#fde68a" }).bg, border:`1px solid ${dashSemantic("warning", { bg:"#fffbeb", border:"#fde68a" }).border}`, color:WA, fontSize:FONT.sm.size }}>Certaines données optionnelles ne sont pas disponibles. Le tableau reste utilisable avec les données existantes.</div>}
      {dashboardError && <div style={{ marginBottom:SPACING.md, padding:`${SPACING.sm + 2}px ${SPACING.md}px`, borderRadius:RADIUS.md, background:dashSemantic("danger", { bg:"#fff1f2", border:"#fecdd3" }).bg, border:`1px solid ${dashSemantic("danger", { bg:"#fff1f2", border:"#fecdd3" }).border}`, color:DA, fontSize:FONT.sm.size + 1 }}>{dashboardError}</div>}
      {loading ? <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}><Icon as={RefreshCw} size={14} style={{ animation:"spin 1s linear infinite" }}/>Chargement du cockpit…</div> : stats && <>{activeTab === "routine" && <MorningRoutineDashboard stats={stats} clients={clientsDash} biens={biensDash} propositions={propsDash} planning={planningDash} actions={actionsDash} compact={compact} T={T} onNavigate={go}/>} {activeTab === "today" && <TodayDashboard stats={stats} clients={clientsDash} biens={biensDash} propositions={propsDash} compact={compact} T={T} onNavigate={go}/>} {activeTab === "week" && <WeekDashboard stats={stats} clients={clientsDash} compact={compact} T={T} onNavigate={go} profil={profil} onMoveEtape={changerEtapeClient}/>} {activeTab === "month" && <MonthDashboard stats={stats} compact={compact} T={T} onNavigate={go}/>} {!compact && <><ClientsStatutsBoard clients={clientsDash} T={T} movingClientId={movingClientId} onMoveClient={changerStatutClient} onOpenStatus={(statut) => go("crm", { type:"statut", value:statut })}/><PipelineEtapesBoard clients={clientsDash} T={T} movingClientId={movingEtapeClientId} onMoveClient={changerEtapeClient} onOpenEtape={(etape) => go("crm", etape ? { type:"etape", value:etape } : { type:"all" })}/><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:SPACING.md, alignItems:"start" }}><ClientsARisqueDashboard clients={clientsDash} propositions={propsDash} T={T} onNavigate={go}/><div><PerformanceCommercialeDashboard stats={stats} T={T}/><ValeurBusinessDashboard stats={stats} T={T}/><DirectionPilotageDashboard stats={stats} T={T}/></div></div></>}</>}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default TableauBord;
export {
  TableauBord,
  PlanningSemaine,
  ClientsStatutsBoard,
  DossiersRelanceDashboard,
  DirectionPilotageDashboard,
  ActionsPrioritairesDashboard,
  OpportunitesChaudesDashboard,
  StockPilotageDashboard,
  PipelineEtapesBoard,
  ClientsARisqueDashboard,
  PerformanceCommercialeDashboard,
  ValeurBusinessDashboard,
  MissionActionsCollaborateursDashboard,
  MorningRoutineDashboard,
  RoutineDecisionRow,
  RoutineStepCard,
  AlertBadge,
  PipelineBar,
  DashboardSection,
  MonthlyActivityChart,
  ObjectiveProgress,
};
