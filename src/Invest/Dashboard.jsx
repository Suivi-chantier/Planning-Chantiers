import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, Users, Building2, BarChart3, Plus, Trash2,
  Search, RefreshCw, Save, Download, X, Check, Phone, Calendar,
  MessageSquare, FileText, Home, TrendingUp, Wallet, Euro, Filter,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Sparkles, Sun,
  LayoutGrid, Send, Handshake, Bell, Briefcase, Copy, Pencil,
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
// TABLEAU DE BORD V5 — Morning Routine ultra cadrée Profero Invest
// Objectif : maîtriser chaque dossier chaque matin avec décisions, commentaires,
// responsables, actions créées, mise à jour CRM / biens, historique Supabase et PDF.
// Rappel mail volontairement exclu de cette version.
// ─────────────────────────────────────────────────────────────

const V5_TABS = [
  { key:"routine", label:"Morning Routine", icon:LayoutDashboard },
  { key:"plan", label:"Plan d’action", icon:Send },
  { key:"suivi", label:"Suivi dossiers", icon:Briefcase },
  { key:"historique", label:"Historique", icon:FileText },
  { key:"mensuel", label:"Vue mensuelle", icon:BarChart3 },
];

const V5_STEPS = [
  { key:"urgences", label:"Urgences", icon:AlertTriangle, help:"Tâches en retard et points bloquants à arbitrer en premier." },
  { key:"priorites", label:"3 priorités", icon:Sparkles, help:"Les 3 priorités absolues du jour sont obligatoires." },
  { key:"collaborateurs", label:"Collaborateurs", icon:Users, help:"Tom, Benjamin, Camille, Matthieu et collaborateurs ajoutés." },
  { key:"prospects", label:"Prospects", icon:Phone, help:"Tous les prospects classés selon leur niveau de transformation." },
  { key:"clients", label:"Clients actifs", icon:Briefcase, help:"Tous les clients selon leur étape, blocages et actions futures." },
  { key:"biens", label:"Biens", icon:Home, help:"Tous les biens nécessitant une décision, une action ou un responsable." },
  { key:"synthese", label:"Synthèse", icon:Send, help:"Plan d’action court par responsable." },
  { key:"validation", label:"Validation finale", icon:Check, help:"Finalisation stricte ou validation forcée avec motif." },
];

const V5_BASE_COLLABORATORS = ["Tom", "Benjamin", "Camille", "Matthieu"];
const V5_RESPONSABLES = ["Matthieu", "Tom", "Benjamin", "Camille", "Autre"];
const V5_URGENCIES = ["Faible", "Normal", "Élevé"];

const V5_DECISIONS = {
  urgence:["Traiter moi-même", "Assigner", "Reporter", "Bloquer", "Arbitrage Matthieu", "Clôturer / ne plus suivre"],
  collaborateur:["Rien à signaler", "Demander retour", "Donner consigne", "Réassigner", "Bloquer pour arbitrage", "Créer tâche"],
  prospect:["Appeler", "Envoyer message", "Créer tâche", "Reporter", "Passer perdu", "Archiver", "Assigner à Tom", "Assigner à Benjamin"],
  client:["Faire avancer", "Assigner", "Arbitrer", "Demander document", "Relancer client", "Relancer partenaire", "Mettre en surveillance", "Mettre en pause avec motif", "Urgence dirigeant", "Clôturer dossier"],
  bien:["Analyser", "Proposer à un client", "Relancer agent / vendeur", "Faire offre", "Archiver", "Demander visite terrain", "Matcher avec client"],
};

const V5_CHECKLISTS = {
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
    { id:"missions", label:"Chaque collaborateur a une mission prioritaire", required:true },
    { id:"objectifs", label:"Chaque collaborateur a un objectif du jour", required:true },
    { id:"consignes", label:"Consignes du jour formulées", required:true },
    { id:"risques", label:"Tâches en retard / blocages contrôlés", required:true },
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

function prospectClass(c={}) {
  const last = daysSince(lastClientActivity(c));
  const raw = normTxt(`${c.etape || ""} ${c.prochaine_action || ""} ${c.source || ""}`);
  const budget = Number(c.budget) || 0;
  const hasNoAction = !c.prochaine_action && !c.date_prochaine_action;
  const isHot = raw.includes("rdv fait") || raw.includes("proposition") || raw.includes("qualifie") || raw.includes("qualifié") || budget >= 150000;
  if (hasNoAction || (last !== null && last >= 10)) return { label:"Rouge", level:"danger", reason:hasNoAction ? "Sans prochaine action" : `Sans action depuis ${last} jours` };
  if (last !== null && last >= 7) return { label:"Orange", level:"warning", reason:`Sans action depuis ${last} jours` };
  if (isHot) return { label:"Chaud", level:"success", reason:"Facilement transformable" };
  if (c.date_prochaine_action === todayIso()) return { label:"Relance du jour", level:"warning", reason:"Relance prévue aujourd’hui" };
  return { label:"Suivi", level:"info", reason:"Prospect à maintenir actif" };
}

function bienClass(b={}) {
  const statut = normTxt(b.statut || "");
  const score = getBienScore(b);
  if (b.date_relance && b.date_relance <= todayIso()) return { label:"À relancer", level:"danger", reason:`Relance prévue le ${safeDate(b.date_relance)}` };
  if (statut.includes("nouveau") || statut.includes("trier")) return { label:"Nouvelle annonce", level:"warning", reason:"Annonce à classer" };
  if (statut.includes("analyse") || statut.includes("analyser")) return { label:"À analyser", level:"warning", reason:"Analyse à finaliser" };
  if (statut.includes("offre envoy")) return { label:"Offre envoyée", level:"warning", reason:"Suivi offre à faire" };
  if (!isBienFicheComplete(b)) return { label:"Fiche incomplète", level:"warning", reason:"Fiche bien à compléter" };
  if (score >= 45) return { label:"Opportunité", level:"success", reason:`Score Profero ${score}` };
  return { label:"Stock", level:"info", reason:"Bien à suivre" };
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
    stepNotes:{},
    savedRoutineId:null,
  };
}

function storageKeyFor(date=todayIso()) {
  return `profero_invest_morning_routine_v5_${date}`;
}

function decisionKey(item) {
  return `${item.type}:${item.id}`;
}

function defaultDecision(item) {
  return {
    decision:"",
    comment:"",
    responsable:item.responsable || "Matthieu",
    next_action:item.defaultAction || "",
    due_date:item.requiresDate ? todayIso() : "",
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

function RoutineDecisionCard({ item, decision, onChange, T=THEMES_INV.dark, compact=false }) {
  const d = decision || defaultDecision(item);
  const type = item.type || "urgence";
  const options = V5_DECISIONS[type] || V5_DECISIONS.urgence;
  const color = levelColor(item.level, T);
  const complete = isDecisionComplete(item, d);
  const detailGrid = compact ? "1fr" : "repeat(auto-fit,minmax(190px,1fr))";
  const patch = (changes) => onChange({ ...d, ...changes });
  return (
    <div style={{ border:`1px solid ${complete ? T.border : color}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, boxShadow:T.shadowSm }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", marginBottom:SPACING.sm }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap", marginBottom:4 }}>
            <AlertBadge level={item.level} T={T}>{item.badge || item.category || item.type}</AlertBadge>
            {item.meta && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:700 }}>{item.meta}</span>}
          </div>
          <div style={{ fontSize:FONT.lg.size - 1, fontWeight:900, color:T.text, lineHeight:1.25 }}>{item.label}</div>
          <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:3 }}>{item.reason}</div>
          {item.details && !compact && <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:6 }}>{item.details}</div>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          {complete ? <AlertBadge level="success" T={T}>Complet</AlertBadge> : <AlertBadge level="danger" T={T}>À compléter</AlertBadge>}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:detailGrid, gap:SPACING.sm, marginTop:SPACING.sm }}>
        <SelectInput label="Décision" required value={d.decision} onChange={v => patch({ decision:v })} options={options} T={T}/>
        <SelectInput label="Responsable" required value={d.responsable} onChange={v => patch({ responsable:v })} options={V5_RESPONSABLES} T={T}/>
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
              <SelectInput label="Responsable" required value={p.responsable} onChange={v => update(idx, { responsable:v })} options={V5_RESPONSABLES} T={T}/>
              <SelectInput label="Niveau d’urgence" required value={p.urgency} onChange={v => update(idx, { urgency:v })} options={V5_URGENCIES} T={T}/>
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
                <SelectInput label="Décision" required value={v.decision} onChange={val => update(name, { decision:val })} options={V5_DECISIONS.collaborateur} T={T}/>
                <SelectInput label="Niveau d’urgence" required value={v.urgency} onChange={val => update(name, { urgency:val })} options={V5_URGENCIES} T={T}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

function buildV5Data({ clients=[], biens=[], propositions=[], planning=[], actions=[] }) {
  const today = todayIso();
  const { startWeek, endWeek } = getWeekRange();
  const prospects = clients.filter(c => (c.statut || "Prospect") === "Prospect");
  const clientsMetier = clients.filter(c => (c.statut || "") !== "Prospect" && (c.statut || "") !== "Terminé");
  const openActions = actions.filter(isOpenAction);
  const doneActions = actions.filter(isDoneAction);
  const lateActions = openActions.filter(a => a.due_date && a.due_date < today);
  const blockedActions = openActions.filter(isBlockedAction);
  const partnerActions = openActions.filter(isPartnerAction);
  const docActions = openActions.filter(isDocumentAction);

  const collaboratorNames = V5_BASE_COLLABORATORS;
  const collaboratorStats = collaboratorNames.reduce((acc, name) => {
    const list = actions.filter(a => normTxt(actionOwner(a)).includes(normTxt(name)));
    acc[name] = { open:list.filter(isOpenAction).length, late:list.filter(a => isOpenAction(a) && a.due_date && a.due_date < today).length, blocked:list.filter(isBlockedAction).length, doneToday:list.filter(a => isDoneAction(a) && isWithin(a.updated_at || a.completed_at || a.done_at, today, today)).length };
    return acc;
  }, {});

  const prospectItems = prospects.map(c => {
    const pc = prospectClass(c);
    return {
      type:"prospect", id:c.id, source:"invest_clients", label:getClientName(c), category:pc.label, level:pc.level,
      reason:pc.reason, responsable:c.conseiller || "Matthieu", defaultAction:c.prochaine_action || "Définir la prochaine action prospect",
      requiresNextAction:true, requiresDate:true, critical:pc.level !== "info" || pc.label === "Chaud",
      meta:`Budget ${fmtDashboardEur(c.budget)} · ${c.etape || "Étape non renseignée"}`,
      details:`Source : ${c.source || "—"} · Prochaine action : ${c.prochaine_action || "—"} · Relance : ${safeDate(c.date_prochaine_action)}`,
      raw:c,
    };
  }).sort((a,b) => ({ danger:0, warning:1, success:2, info:3 }[a.level] - { danger:0, warning:1, success:2, info:3 }[b.level]));

  const clientItems = clientsMetier.map(c => {
    const noStage = !c.etape;
    const noOwner = !c.conseiller;
    const hasDoc = docActions.some(a => a.client_id === c.id);
    const blocked = noStage || hasDoc || blockedActions.some(a => a.client_id === c.id);
    return {
      type:"client", id:c.id, source:"invest_clients", label:getClientName(c), category:c.etape || "Étape non renseignée", level:blocked ? "danger" : noOwner ? "warning" : "info",
      reason:blocked ? (noStage ? "Étape non renseignée" : hasDoc ? "Document manquant / à contrôler" : "Action bloquée") : "Client à piloter par étape",
      responsable:c.conseiller || "Matthieu", defaultAction:c.prochaine_action || "Définir l’action future du dossier",
      requiresNextAction:true, requiresDate:false, critical:blocked || noOwner || !c.prochaine_action,
      meta:`Statut ${c.statut || "—"} · Budget ${fmtDashboardEur(c.budget)}`,
      details:`Prochaine action : ${c.prochaine_action || "—"} · Date : ${safeDate(c.date_prochaine_action)} · Responsable : ${c.conseiller || "—"}`,
      raw:c,
    };
  });

  const bienItems = biens.map(b => {
    const bc = bienClass(b);
    const score = getBienScore(b);
    return {
      type:"bien", id:b.id, source:"invest_biens", label:getBienLabel(b), category:bc.label, level:bc.level,
      reason:bc.reason, responsable:b.conseiller_profero || "Benjamin", defaultAction:"Prévoir l’action suivante sur le bien",
      requiresNextAction:true, requiresDate:false, critical:bc.level !== "info",
      meta:`Score ${score} · ${b.statut || "Statut non renseigné"}`,
      details:`Prix ${fmtDashboardEur(b.prix_vente)} · Travaux ${fmtDashboardEur(b.prix_travaux)} · Rendement ${b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "—"} · Cash-flow ${fmtDashboardEur(b.cashflow_estime)}`,
      raw:b,
    };
  }).sort((a,b) => ({ danger:0, warning:1, success:2, info:3 }[a.level] - { danger:0, warning:1, success:2, info:3 }[b.level]));

  const urgencyItems = [
    ...lateActions.map(a => ({ type:"urgence", id:`action-${a.id}`, source:"invest_mission_actions", sourceId:a.id, label:actionTitle(a), category:"Tâche en retard", level:"danger", reason:`Échéance ${safeDate(a.due_date)} · ${a.client ? getClientName(a.client) : ""}`, responsable:actionOwner(a) || "Matthieu", defaultAction:actionTitle(a), requiresNextAction:true, requiresDate:true, critical:true, raw:a })),
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
    today, startWeek, endWeek, prospects, clientsMetier, biens, propositions, planning, actions,
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
  const grouped = V5_RESPONSABLES.reduce((acc, r) => ({ ...acc, [r]:lines.filter(l => (l.responsable || "") === r) }), {});
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan d'action ${todayIso()}</title><style>body{font-family:Arial,sans-serif;color:#0D2E5C;margin:32px}h1{font-size:24px;margin:0 0 6px}h2{margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#667085}.item{margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:8px}.title{font-weight:700}.meta{font-size:12px;color:#667085;margin-top:4px}</style></head><body><h1>Plan d'action du jour — Profero Invest</h1><div class="muted">Routine du ${todayIso()}</div>${Object.entries(grouped).map(([r,list]) => list.length ? `<h2>${r}</h2>${list.map(l => `<div class="item"><div class="title">${l.title || "Action"}</div><div class="meta">Échéance : ${l.due_date || "—"} · Source : ${l.source || "—"} · Décision : ${l.decision || "—"}</div><div>${l.comment || ""}</div></div>`).join("")}` : "").join("")}<h2>Points bloquants</h2>${Object.entries(routine.decisions || {}).filter(([,d]) => normTxt(d.decision || "").includes("bloquer") || normTxt(d.decision || "").includes("arbitrage")).map(([k,d]) => `<div class="item"><div class="title">${k}</div><div>${d.comment || d.force_reason || ""}</div></div>`).join("") || "<div class='muted'>Aucun point bloquant saisi.</div>"}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [activeTab, setActiveTab] = useState("routine");
  const [activeStep, setActiveStep] = useState("urgences");
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
  const [routine, setRoutine] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKeyFor());
      return saved ? { ...emptyRoutineState(), ...JSON.parse(saved) } : emptyRoutineState();
    } catch { return emptyRoutineState(); }
  });

  const loadDashboard = useCallback(async () => {
    setLoading(true); setError(""); setOptionalErrors([]);
    const safeQuery = async (label, query) => {
      try {
        const { data, error } = await query;
        if (error) { setOptionalErrors(prev => [...prev, `${label} : ${error.message}`]); return []; }
        return data || [];
      } catch (e) { setOptionalErrors(prev => [...prev, `${label} : non disponible`]); return []; }
    };
    const [c,b,p,pl,a,h] = await Promise.all([
      safeQuery("Clients", supabase.from("invest_clients").select("id,nom,prenom,statut,budget,date_signature,date_premier_contact,prochaine_action,date_prochaine_action,created_at,updated_at,etape,source,conseiller").order("created_at", { ascending:false })),
      safeQuery("Biens", supabase.from("invest_biens").select("id,adresse,ville,statut,date_relance,date_visite,rendement_brut,cashflow_estime,prix_vente,prix_travaux,cout_total,montant_offre,visite_data,latitude,longitude,reference_interne,conseiller_profero,created_at,updated_at").order("created_at", { ascending:false })),
      safeQuery("Propositions", supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition,bien:invest_biens(id,montant_offre,prix_vente,statut)")),
      safeQuery("Planning", supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire,created_at,updated_at").order("date_rdv", { ascending:false }).limit(300)),
      safeQuery("Actions", supabase.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").order("due_date", { ascending:true, nullsFirst:false }).limit(500)),
      safeQuery("Historique routines", supabase.from("invest_morning_routines").select("*").order("routine_date", { ascending:false }).limit(30)),
    ]);
    setClients(c); setBiens(b); setPropositions(p); setPlanning(pl); setActions(a); setHistory(h);
    setLoading(false);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { try { window.localStorage.setItem(storageKeyFor(), JSON.stringify(routine)); } catch {} }, [routine]);

  const data = useMemo(() => buildV5Data({ clients, biens, propositions, planning, actions }), [clients, biens, propositions, planning, actions]);
  const collaborators = useMemo(() => [...V5_BASE_COLLABORATORS, ...safeArr(routine.extraCollaborators).filter(Boolean)], [routine.extraCollaborators]);
  const visibleProspects = quickMode ? data.prospectItems.filter(i => i.critical) : data.prospectItems;
  const visibleClients = quickMode ? data.clientItems.filter(i => i.critical) : data.clientItems;
  const visibleBiens = quickMode ? data.bienItems.filter(i => i.critical) : data.bienItems;
  const allRequiredItems = useMemo(() => [...data.urgencyItems, ...visibleProspects.filter(i => i.critical || !quickMode), ...visibleClients.filter(i => i.critical || !quickMode), ...visibleBiens.filter(i => i.critical || !quickMode)], [data, visibleProspects, visibleClients, visibleBiens, quickMode]);
  const incompleteItems = allRequiredItems.filter(item => !isDecisionComplete(item, routine.decisions[decisionKey(item)]));
  const incompleteCollaborators = collaborators.filter(name => !isCollaboratorComplete(routine.collaborators[name]));
  const prioritiesOk = safeArr(routine.priorities).every(isPriorityComplete);
  const finalOk = prioritiesOk && incompleteCollaborators.length === 0 && incompleteItems.length === 0;
  const plan = useMemo(() => actionPlanFromRoutine(routine, data), [routine, data]);

  const updateDecision = (item, value) => setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(item)]:value } }));
  const updateChecklist = (step, id, checked) => setRoutine(prev => ({ ...prev, checklist:{ ...prev.checklist, [step]:{ ...(prev.checklist[step] || {}), [id]:checked } } }));
  const updateStepNote = (step, value) => setRoutine(prev => ({ ...prev, stepNotes:{ ...prev.stepNotes, [step]:value } }));

  const ensureStarted = () => setRoutine(prev => prev.status === "not_started" ? { ...prev, status:"in_progress", started_at:new Date().toISOString() } : prev);

  const createMissionAction = async ({ responsable, title, due_date, client_id=null, step_label="Morning Routine", comment="" }) => {
    if (!responsable || !title) return null;
    const payload = { responsable, action_title:title, due_date:due_date || null, status:"a_faire", step_label, client_id };
    const { data:created, error:insertError } = await supabase.from("invest_mission_actions").insert(payload).select("id").single();
    if (insertError) throw insertError;
    return created?.id || null;
  };

  const applyDecision = async (item, d) => {
    if (!item || !d || !d.create_task) return null;
    const baseTitle = d.next_action || `${d.decision} — ${item.label}`;
    let createdTaskId = null;
    if (item.originalType === "prospect" || item.type === "prospect") {
      await supabase.from("invest_clients").update({ prochaine_action:d.next_action || null, date_prochaine_action:d.due_date || null, conseiller:d.responsable || null, statut:normTxt(d.decision).includes("perdu") || normTxt(d.decision).includes("archiver") ? "Inactif" : item.raw?.statut }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date, client_id:item.raw?.id || item.id, step_label:"Morning Routine — Prospect", comment:d.comment });
    } else if (item.originalType === "client" || item.type === "client") {
      await supabase.from("invest_clients").update({ prochaine_action:d.next_action || null, date_prochaine_action:d.due_date || item.raw?.date_prochaine_action || null, conseiller:d.responsable || null }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date || null, client_id:item.raw?.id || item.id, step_label:"Morning Routine — Client", comment:d.comment });
    } else if (item.originalType === "bien" || item.type === "bien") {
      const decisionNorm = normTxt(d.decision);
      const nextStatut = decisionNorm.includes("archiver") ? "Archivé" : decisionNorm.includes("offre") ? "Offre à faire" : decisionNorm.includes("relancer") ? "À relancer" : decisionNorm.includes("analyser") ? "À analyser" : item.raw?.statut;
      await supabase.from("invest_biens").update({ statut:nextStatut, date_relance:d.due_date || item.raw?.date_relance || null, conseiller_profero:d.responsable || null }).eq("id", item.raw?.id || item.id);
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:`${baseTitle} — ${item.label}`, due_date:d.due_date || null, step_label:"Morning Routine — Bien", comment:d.comment });
    } else {
      createdTaskId = await createMissionAction({ responsable:d.responsable, title:baseTitle, due_date:d.due_date || todayIso(), step_label:"Morning Routine — Urgence", comment:d.comment });
    }
    return createdTaskId;
  };

  const saveRoutine = async ({ complete=false, forced=false }={}) => {
    setSaving(true); setError("");
    try {
      const routinePayload = { routine_date:todayIso(), status:complete ? "completed" : "in_progress", started_at:routine.started_at || new Date().toISOString(), completed_at:complete ? new Date().toISOString() : null, created_by:profil?.email || profil?.nom || "Matthieu", completion_forced:forced, force_reason:routine.force_reason || null, priorite_1:routine.priorities?.[0]?.title || null, priorite_2:routine.priorities?.[1]?.title || null, priorite_3:routine.priorities?.[2]?.title || null, summary:JSON.stringify({ plan, collaborators:routine.collaborators, stepNotes:routine.stepNotes }) };
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
      for (const item of allRequiredItems) {
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
      setError(e?.message || "Impossible d’enregistrer la routine. Vérifie la migration Supabase V5.");
    } finally { setSaving(false); }
  };

  const forceCompleteAllowed = Boolean(String(routine.force_reason || "").trim());

  const renderChecklist = (stepKey) => {
    const list = V5_CHECKLISTS[stepKey] || [];
    return <div style={{ display:"grid", gap:6 }}>{list.map(ch => <label key={ch.id} style={{ display:"flex", alignItems:"center", gap:8, color:T.textSub, fontSize:FONT.sm.size, fontWeight:800 }}><input type="checkbox" checked={Boolean(routine.checklist?.[stepKey]?.[ch.id])} onChange={e => updateChecklist(stepKey, ch.id, e.target.checked)}/>{ch.label}{ch.required && <span style={{ color:DA }}>*</span>}</label>)}<TextArea label="Note libre de l’étape" value={routine.stepNotes?.[stepKey] || ""} onChange={v => updateStepNote(stepKey, v)} T={T}/></div>;
  };

  const renderItems = (items, empty, compact=false) => {
    if (!items.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>{empty}</div>;
    return <div style={{ display:"grid", gap:SPACING.md }}>{items.map(item => <RoutineDecisionCard key={decisionKey(item)} item={item} decision={routine.decisions[decisionKey(item)] || defaultDecision(item)} onChange={v => updateDecision(item, v)} T={T} compact={compact}/>)}</div>;
  };

  const renderStep = () => {
    if (activeStep === "urgences") return <><SectionCard title="Urgences à traiter" icon={AlertTriangle} subtitle="Les tâches en retard sont affichées en premier" T={T}>{renderItems(data.urgencyItems, "Aucune urgence critique détectée", quickMode)}</SectionCard><SectionCard title="Checklist Urgences" icon={Check} T={T}>{renderChecklist("urgences")}</SectionCard></>;
    if (activeStep === "priorites") return <><SectionCard title="3 priorités obligatoires du jour" icon={Sparkles} subtitle="Impossible de terminer la routine sans ces 3 priorités" T={T}><PriorityEditor priorities={routine.priorities} onChange={priorities => setRoutine(prev => ({ ...prev, priorities }))} T={T}/></SectionCard><SectionCard title="Checklist Priorités" icon={Check} T={T}>{renderChecklist("priorites")}</SectionCard></>;
    if (activeStep === "collaborateurs") return <><SectionCard title="Collaborateurs" icon={Users} subtitle="Chaque personne doit avoir une mission, un objectif et une consigne" T={T}><CollaboratorEditor names={collaborators} values={routine.collaborators || {}} onChange={collaborators => setRoutine(prev => ({ ...prev, collaborators }))} onAdd={name => setRoutine(prev => ({ ...prev, extraCollaborators:[...safeArr(prev.extraCollaborators), name] }))} T={T} statsByName={data.collaboratorStats}/></SectionCard><SectionCard title="Checklist Collaborateurs" icon={Check} T={T}>{renderChecklist("collaborateurs")}</SectionCard></>;
    if (activeStep === "prospects") return <><SectionCard title="Prospects classés" icon={Phone} subtitle={quickMode ? "Mode rapide : prospects critiques uniquement" : "Mode strict : tous les prospects"} T={T}>{renderItems(visibleProspects, "Aucun prospect à afficher", quickMode)}</SectionCard><SectionCard title="Checklist Prospects" icon={Check} T={T}>{renderChecklist("prospects")}</SectionCard></>;
    if (activeStep === "clients") return <><SectionCard title="Clients par étape" icon={Briefcase} subtitle={quickMode ? "Mode rapide : clients critiques uniquement" : "Tous les clients actifs / signés / en cours"} T={T}>{renderItems(visibleClients, "Aucun client à afficher", quickMode)}</SectionCard><SectionCard title="Checklist Clients" icon={Check} T={T}>{renderChecklist("clients")}</SectionCard></>;
    if (activeStep === "biens") return <><SectionCard title="Biens identifiés" icon={Home} subtitle={quickMode ? "Mode rapide : biens critiques uniquement" : "Tous les biens avec score et décision"} T={T}>{renderItems(visibleBiens, "Aucun bien à afficher", quickMode)}</SectionCard><SectionCard title="Checklist Biens" icon={Check} T={T}>{renderChecklist("biens")}</SectionCard></>;
    if (activeStep === "synthese") return <><SectionCard title="Plan d’action court" icon={Send} subtitle="Regroupé par responsable" T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>Plan d’action PDF</button>}><ActionPlanView plan={plan} T={T}/></SectionCard><SectionCard title="Checklist Synthèse" icon={Check} T={T}>{renderChecklist("synthese")}</SectionCard></>;
    return <SectionCard title="Validation finale" icon={Check} T={T}><div style={{ display:"grid", gap:SPACING.md }}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:SPACING.md }}><KPICard icon={Sparkles} label="Priorités complètes" value={prioritiesOk ? "Oui" : "Non"} color={prioritiesOk ? SU : DA}/><KPICard icon={Users} label="Collaborateurs incomplets" value={incompleteCollaborators.length} color={incompleteCollaborators.length ? DA : SU}/><KPICard icon={AlertTriangle} label="Décisions manquantes" value={incompleteItems.length} color={incompleteItems.length ? DA : SU}/><KPICard icon={Send} label="Actions au plan" value={plan.length} color="#FFC200"/></div>{!finalOk && <div style={{ padding:SPACING.md, borderRadius:RADIUS.md, background:SEMANTIC?.danger?.bg || "#fff1f2", border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, color:DA, fontWeight:800 }}>Routine non finalisable : {incompleteItems.length} décision(s) manquante(s), {incompleteCollaborators.length} collaborateur(s) incomplet(s), priorités {prioritiesOk ? "OK" : "incomplètes"}.</div>}<TextArea label="Motif de validation forcée" value={routine.force_reason} onChange={v => setRoutine(prev => ({ ...prev, force_reason:v }))} placeholder="Obligatoire si tu veux terminer malgré des éléments incomplets." T={T}/><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className="inv-btn inv-btn-out inv-btn-sm" disabled={saving} onClick={() => saveRoutine({ complete:false })}><Icon as={Save} size={12}/>Enregistrer brouillon</button><button className="inv-btn inv-btn-gold inv-btn-sm" disabled={saving || !finalOk} onClick={() => saveRoutine({ complete:true, forced:false })}><Icon as={Check} size={12}/>Terminer la routine</button><button className="inv-btn inv-btn-sm" style={{ background:DA, color:"white" }} disabled={saving || finalOk || !forceCompleteAllowed} onClick={() => saveRoutine({ complete:true, forced:true })}><Icon as={AlertTriangle} size={12}/>Forcer avec motif</button></div></div></SectionCard>;
  };

  const renderTab = () => {
    if (activeTab === "routine") return <div style={{ display:"grid", gridTemplateColumns:"290px minmax(0,1fr)", gap:SPACING.md, alignItems:"start" }} className="inv-v5-routine-layout"><div className="inv-card" style={{ position:"sticky", top:12 }}><div className="inv-card-hd blue">Étapes de la routine</div><div className="inv-card-bd" style={{ display:"grid", gap:7 }}>{V5_STEPS.map(step => { const IconComp = step.icon; const active = activeStep === step.key; const missing = step.key === "priorites" ? (prioritiesOk ? 0 : 1) : step.key === "collaborateurs" ? incompleteCollaborators.length : step.key === "urgences" ? data.urgencyItems.filter(i => !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : step.key === "prospects" ? visibleProspects.filter(i => (i.critical || !quickMode) && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : step.key === "clients" ? visibleClients.filter(i => (i.critical || !quickMode) && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : step.key === "biens" ? visibleBiens.filter(i => (i.critical || !quickMode) && !isDecisionComplete(i, routine.decisions[decisionKey(i)])).length : 0; return <button key={step.key} onClick={() => { ensureStarted(); setActiveStep(step.key); }} style={{ border:`1px solid ${active ? T.accentBorder : T.border}`, background:active ? T.accentBg : T.input, color:active ? T.accent : T.textSub, borderRadius:RADIUS.md, padding:"10px 11px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><span style={{ display:"inline-flex", alignItems:"center", gap:8, fontWeight:900 }}><Icon as={IconComp} size={14}/>{step.label}</span>{missing > 0 ? <AlertBadge level="danger" T={T}>{missing}</AlertBadge> : <AlertBadge level="success" T={T}>OK</AlertBadge>}</button> })}</div></div><div>{renderStep()}</div></div>;
    if (activeTab === "plan") return <SectionCard title="Plan d’action du jour" icon={Send} T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>PDF</button>}><ActionPlanView plan={plan} T={T}/></SectionCard>;
    if (activeTab === "suivi") return <SuiviDossiers data={data} T={T} onNavigate={onNavigate}/>;
    if (activeTab === "historique") return <HistoriqueRoutines history={history} T={T}/>;
    return <VueMensuelle data={data} T={T}/>;
  };

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth:1460, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:SPACING.md, alignItems:"flex-start", flexWrap:"wrap", marginBottom:SPACING.xl }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}><div style={{ width:50, height:50, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={LayoutDashboard} size={24}/></div><div><div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Morning Routine Profero Invest</div><div style={{ fontSize:FONT.sm.size + 1, color:T.textSub, marginTop:2 }}>Maîtriser chaque dossier : contrôler, décider, déléguer, relancer.</div><div style={{ display:"flex", gap:7, flexWrap:"wrap", marginTop:8 }}><AlertBadge level={incompleteItems.length ? "danger" : "success"} T={T}>{incompleteItems.length} décision(s) manquante(s)</AlertBadge><AlertBadge level={incompleteCollaborators.length ? "warning" : "success"} T={T}>{incompleteCollaborators.length} collaborateur(s) incomplet(s)</AlertBadge><AlertBadge level="info" T={T}>{plan.length} action(s) au plan</AlertBadge></div></div></div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setQuickMode(v => !v)}><Icon as={Filter} size={12}/>{quickMode ? "Mode strict" : "Mode rapide"}</button><button className="inv-btn inv-btn-out inv-btn-sm" onClick={loadDashboard}><Icon as={RefreshCw} size={12}/>Actualiser</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => printActionPlanPDF(routine, data)}><Icon as={Download} size={12}/>Plan d’action PDF</button></div>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:SPACING.xl }}>{V5_TABS.map(tab => { const active = activeTab === tab.key; return <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ border:`1px solid ${active ? T.accentBorder : T.border}`, background:active ? T.accentBg : T.input, color:active ? T.accent : T.textSub, borderRadius:RADIUS.pill, padding:"9px 13px", display:"inline-flex", alignItems:"center", gap:7, cursor:"pointer", fontFamily:"inherit", fontWeight:900 }}><Icon as={tab.icon} size={14}/>{tab.label}</button> })}</div>
      {optionalErrors.length > 0 && <div style={{ marginBottom:SPACING.md, padding:SPACING.md, border:`1px solid ${SEMANTIC?.warning?.border || "#fde68a"}`, background:SEMANTIC?.warning?.bg || "#fffbeb", borderRadius:RADIUS.md, color:WA }}>Certaines données optionnelles ne sont pas disponibles. La page reste utilisable.</div>}
      {error && <div style={{ marginBottom:SPACING.md, padding:SPACING.md, border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, background:SEMANTIC?.danger?.bg || "#fff1f2", borderRadius:RADIUS.md, color:DA }}>{error}</div>}
      {loading ? <div style={{ padding:SPACING.xxxl, textAlign:"center", color:T.textMuted }}><Icon as={RefreshCw} size={15} style={{ animation:"spin 1s linear infinite" }}/> Chargement…</div> : renderTab()}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @media(max-width:980px){.inv-v5-routine-layout{grid-template-columns:1fr!important}.inv-card[style*="sticky"]{position:relative!important;top:auto!important}}`}</style>
    </div>
  );
}

function ActionPlanView({ plan=[], T=THEMES_INV.dark }) {
  if (!plan.length) return <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucune action générée pour le moment. Complète la routine pour construire le plan d’action.</div>;
  const responsables = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  return <div style={{ display:"grid", gap:SPACING.md }}>{responsables.map(r => <div key={r} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text, marginBottom:8 }}>{r}</div>{plan.filter(p => (p.responsable || "À définir") === r).map((p, i) => <div key={i} style={{ padding:"8px 0", borderTop:i ? `1px solid ${T.border}` : "none" }}><div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:T.text }}>{p.title}</div><div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:2 }}>Échéance : {safeDate(p.due_date)} · Source : {p.source || "—"}</div>{p.comment && <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:4 }}>{p.comment}</div>}</div>)}</div>)}</div>;
}

function SuiviDossiers({ data, T=THEMES_INV.dark, onNavigate }) {
  return <div style={{ display:"grid", gap:SPACING.md }}><SectionCard title="Prospects" icon={Phone} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Phone} label="Total prospects" value={data.stats.prospects} color="#4db8ff"/><KPICard icon={AlertTriangle} label="Rouges" value={data.stats.prospectsRed} color={DA}/><KPICard icon={Bell} label="Orange" value={data.stats.prospectsOrange} color={WA}/></div></SectionCard><SectionCard title="Clients" icon={Briefcase} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Users} label="Clients suivis" value={data.stats.clients} color="#4db8ff"/><KPICard icon={AlertTriangle} label="Bloqués" value={data.stats.clientsBlocked} color={DA}/><KPICard icon={FileText} label="Documents / partenaires" value={data.docActions.length + data.partnerActions.length} color={WA}/></div></SectionCard><SectionCard title="Biens" icon={Home} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Home} label="Biens en stock" value={data.stats.biens} color="#4db8ff"/><KPICard icon={Sparkles} label="À traiter" value={data.stats.biensToAct} color={WA}/></div></SectionCard></div>;
}

function HistoriqueRoutines({ history=[], T=THEMES_INV.dark }) {
  return <SectionCard title="Historique des routines" icon={FileText} subtitle="Après migration Supabase V5" T={T}>{history.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted }}>Aucune routine enregistrée pour le moment.</div> : <div style={{ display:"grid", gap:8 }}>{history.map(r => <div key={r.id} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:SPACING.md, display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><div><div style={{ fontWeight:900, color:T.text }}>{safeDate(r.routine_date)}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{r.status} · {r.completion_forced ? "forcée" : "standard"}</div></div><AlertBadge level={r.status === "completed" ? "success" : "warning"} T={T}>{r.status}</AlertBadge></div>)}</div>}</SectionCard>;
}

function VueMensuelle({ data, T=THEMES_INV.dark }) {
  return <div style={{ display:"grid", gap:SPACING.md }}><SectionCard title="Vue mensuelle" icon={BarChart3} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md }}><KPICard icon={Users} label="Prospects entrants" value={data.stats.prospectsThisMonth} color="#4db8ff"/><KPICard icon={Calendar} label="RDV réalisés" value={data.stats.rdvThisMonth} color="#FFC200"/><KPICard icon={Handshake} label="Signatures" value={data.stats.signedThisMonth} color={SU}/><KPICard icon={Euro} label="CA base signé" value={fmtDashboardEur(data.stats.caBaseMonth)} color="#c084fc"/></div></SectionCard><SectionCard title="12 derniers mois" icon={TrendingUp} T={T}><MiniMonthlyChart data={data.monthSeries} T={T}/></SectionCard></div>;
}

export default TableauBord;
export { TableauBord, AlertBadge, RoutineDecisionCard, PriorityEditor, CollaboratorEditor, ActionPlanView };
