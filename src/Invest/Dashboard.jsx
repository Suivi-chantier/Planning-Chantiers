import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, LayoutGrid, Users, Building2, BarChart3, RefreshCw, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Home, Euro, Filter,
  AlertTriangle, Eye, Sparkles, Send, Handshake, Bell, Briefcase,
  ExternalLink, Clock, UserCheck, ClipboardCheck, ListChecks, ShieldCheck,
} from "lucide-react";

import {
  THEMES_INV, SU, WA, DA,
  KPICard,
  fmtDashboardPct,
  HONORAIRE_BASE_CONTRAT_HT,
  NAV,
  useAnnuaireInvest, responsablesInvest, estUtilisateurCourant,
} from "./_shared";
import { creerNotificationInvest } from "./notifications";
import { champsNouvelleTache } from "./dossiers/dossierVue";
import { resumePilotage, actionDuJour, alertesPilotage } from "./dossiers/pilotage";

// ─────────────────────────────────────────────────────────────
// TABLEAU DE BORD V9 — Pilotage par dossier consolidé
// Objectif : pilotage quotidien à distance sans doublons.
// Principe : 1 prospect / 1 client / 1 bien = 1 carte consolidée.
// Les alertes sont agrégées dans la même carte, puis classées en :
// À décider maintenant / À surveiller / Délégué / Traité aujourd'hui.
//
// La consolidation elle-même ne vit plus ici : elle est dans
// ./tableauBord.mjs, parce que la veille du matin
// (api/_cron/cron-invest-tableau-bord.js) doit produire EXACTEMENT le même
// classement pour l'envoyer par mail. Ce fichier ne garde que l'affichage.
// ─────────────────────────────────────────────────────────────

import {
  V9_COLONNES, V9_DECISIONS,
  isoDate, normTxt, safeDate, fmtDashboardEur,
  todayIso, safeArr, isFuture, joinNonEmpty, levelLabel,
  entityKey, emptyRoutine, decisionKey, routineDepuisLignes, isResolvedToday,
  defaultDecision, missingDecisionFields, priorityComplete,
  consolidateData, filterDossiers, sortDossiers, repartirEnColonnes,
  planFromRoutine, chargerTableauBord,
} from "./tableauBord.mjs";

// Repli seulement : la liste réelle vient de l'annuaire (table utilisateurs),
// via responsablesInvest(). Sert tant que l'annuaire n'est pas chargé, pour
// qu'un sélecteur ne soit jamais vide.
const V9_RESPONSABLES_FALLBACK = ["Matthieu", "Tom", "Benjamin", "Camille", "Autre"];
const V9_ENTITY_FILTERS = [
  { key:"all", label:"Tous", icon:LayoutDashboard },
  { key:"prospect", label:"Prospects", icon:Phone },
  { key:"client", label:"Clients", icon:Briefcase },
  { key:"bien", label:"Biens", icon:Home },
  { key:"team", label:"Équipe", icon:Users },
];
// Habillage des colonnes partagées : clés, libellés et explications viennent du
// module, les icônes et couleurs restent une affaire d'écran.
const V9_COLUMN_STYLE = {
  decision:  { icon:AlertTriangle, color:DA },
  watch:     { icon:Eye,           color:WA },
  delegated: { icon:UserCheck,     color:"#4db8ff" },
  done:      { icon:ShieldCheck,   color:SU },
};
const V9_COLUMNS = V9_COLONNES.map(c => ({ ...c, ...V9_COLUMN_STYLE[c.key] }));

function levelColor(level, T) { return level === "danger" ? DA : level === "warning" ? WA : level === "success" ? SU : T.accent; }

function AlertBadge({ level="info", children, T=THEMES_INV.dark, icon=null }) {
  const color = levelColor(level, T);
  const IconComp = icon || (level === "danger" ? AlertTriangle : level === "success" ? Check : Bell);
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 8px", borderRadius:RADIUS.pill, background:`${color}14`, border:`1px solid ${color}38`, color, fontSize:FONT.xs.size, fontWeight:900, whiteSpace:"nowrap" }}><Icon as={IconComp} size={11}/>{children}</span>;
}
function SectionCard({ title, icon, subtitle, children, T=THEMES_INV.dark, action=null }) {
  return <section className="inv-card" style={{ marginBottom:SPACING.md }}><div className="inv-card-hd blue" style={{ alignItems:"center", justifyContent:"space-between" }}><span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={icon || LayoutDashboard} size={14}/>{title}</span>{action || (subtitle && <span style={{ color:T.textMuted, fontSize:FONT.xs.size, letterSpacing:0, textTransform:"none" }}>{subtitle}</span>)}</div><div className="inv-card-bd">{children}</div></section>;
}
function StateBar({ data, doneCount=0, T=THEMES_INV.dark, onSelect }) {
  const cards = [
    { key:"decision", label:"À décider", value:data.stats.decision, icon:AlertTriangle, color:data.stats.decision ? DA : SU, hint:"Dossiers à arbitrer aujourd'hui" },
    { key:"blocked", label:"Bloqués", value:data.stats.blocked, icon:ShieldCheck, color:data.stats.blocked ? DA : SU, hint:"Points compliqués / bloquants" },
    { key:"relances", label:"Relances retard", value:data.stats.relancesLate, icon:Bell, color:data.stats.relancesLate ? DA : SU, hint:"Prospects, clients, biens" },
    { key:"delegated", label:"Délégué", value:data.stats.delegated, icon:UserCheck, color:data.stats.delegated ? "#4db8ff" : SU, hint:"Actions à suivre à distance" },
    { key:"done", label:"Traité aujourd'hui", value:doneCount, icon:Check, color:SU, hint:"Dossiers sortis du flux" },
  ];
  return <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md, marginBottom:SPACING.xl }}>{cards.map(c => <button key={c.key} type="button" onClick={() => onSelect?.(c.key)} style={{ border:`1px solid ${c.color}55`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, textAlign:"left", cursor:"pointer", fontFamily:"inherit", boxShadow:T.shadowSm }}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}><span style={{ width:34, height:34, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", color:c.color, background:`${c.color}14` }}><Icon as={c.icon} size={17}/></span><span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xl.size, fontWeight:900, color:c.color }}>{c.value}</span></div><div style={{ fontSize:FONT.sm.size+1, fontWeight:900, color:T.text, marginTop:9 }}>{c.label}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{c.hint}</div></button>)}</div>;
}
function DossierCard({ item, T=THEMES_INV.dark, onOpen, onDecide, compact=false }) {
  const color = levelColor(item.level, T);
  return <article style={{ border:`1px solid ${color}40`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, boxShadow:T.shadowSm }}>
    <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
      <div style={{ minWidth:0 }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:7 }}><AlertBadge level={item.level} T={T}>{levelLabel(item.level)}</AlertBadge><AlertBadge level="info" T={T}>{item.type === "bien" ? "Bien" : item.type === "client" ? "Client" : item.type === "prospect" ? "Prospect" : "Équipe"}</AlertBadge>{item.readOnly && <AlertBadge level="warning" T={T} icon={Clock}>Lecture seule</AlertBadge>}</div>
        <div style={{ fontSize:FONT.lg.size, color:T.text, fontWeight:900, lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis" }}>{item.label}</div>
        <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:4 }}>{item.subtitle || "—"}</div>
      </div>
      <div style={{ display:"flex", gap:6, flexShrink:0 }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen?.(item)}><Icon as={Eye} size={12}/>Fiche</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => onDecide?.(item)} disabled={item.readOnly}><Icon as={ClipboardCheck} size={12}/>Décider</button></div>
    </div>
    <div style={{ display:"grid", gap:6, marginTop:SPACING.sm }}>{safeArr(item.alerts).slice(0, compact ? 2 : 4).map(a => <div key={a.code} style={{ display:"flex", justifyContent:"space-between", gap:8, border:`1px solid ${levelColor(a.level, T)}30`, background:T.card, borderRadius:RADIUS.md, padding:"7px 8px" }}><span style={{ fontSize:FONT.xs.size + 1, color:T.textSub, fontWeight:800 }}>{a.label}</span>{a.due_date && <span style={{ color:levelColor(a.level, T), fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size }}>{safeDate(a.due_date)}</span>}</div>)}</div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:SPACING.sm, fontSize:FONT.xs.size + 1, color:T.textMuted }}><div><strong style={{ color:T.textSub }}>Resp.</strong> {item.responsable || "—"}</div><div><strong style={{ color:T.textSub }}>Échéance</strong> {safeDate(item.due_date)}</div><div style={{ gridColumn:"1 / -1" }}><strong style={{ color:T.textSub }}>Action</strong> {item.next_action || "—"}</div></div>
  </article>;
}
function BoardColumn({ column, items=[], T=THEMES_INV.dark, onOpen, onDecide }) {
  return <section style={{ minWidth:0, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, overflow:"hidden" }}><div style={{ padding:SPACING.md, borderBottom:`1px solid ${T.border}`, background:T.sectionHd }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><div style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:900, color:column.color }}><Icon as={column.icon} size={15}/>{column.label}</div><span style={{ fontFamily:"'DM Mono',monospace", color:column.color, fontWeight:900 }}>{items.length}</span></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:4 }}>{column.help}</div></div><div style={{ padding:SPACING.md, display:"grid", gap:SPACING.md }}>{items.length ? items.map(item => <DossierCard key={item.key} item={item} T={T} onOpen={onOpen} onDecide={onDecide} compact />) : <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted, fontSize:FONT.sm.size }}>Aucun dossier dans cette colonne.</div>}</div></section>;
}
function PrioritiesPanel({ routine, setRoutine, responsables, T=THEMES_INV.dark }) {
  const update = (idx, patch) => setRoutine(prev => { const list = [...safeArr(prev.priorities)]; list[idx] = { ...(list[idx] || {}), ...patch }; return { ...prev, priorities:list }; });
  return <SectionCard title="3 priorités du jour" icon={Sparkles} subtitle="À définir après lecture des dossiers à piloter" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:SPACING.md }}>{[0,1,2].map(idx => { const p = routine.priorities?.[idx] || {}; return <div key={idx} style={{ border:`1px solid ${priorityComplete(p) ? SU : WA}44`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Priorité n°{idx + 1}</div><input className="inv-inp" placeholder="Titre de la priorité" value={p.title || ""} onChange={e => update(idx, { title:e.target.value })} style={{ width:"100%", textAlign:"left", marginBottom:8 }}/><select className="inv-sel" value={p.responsable || ""} onChange={e => update(idx, { responsable:e.target.value })} style={{ width:"100%", marginBottom:8 }}><option value="">Responsable</option>{(responsables || V9_RESPONSABLES_FALLBACK).map(r => <option key={r}>{r}</option>)}</select><input className="inv-inp" type="date" value={p.due_date || ""} onChange={e => update(idx, { due_date:e.target.value })} style={{ width:"100%", marginBottom:8 }}/><textarea className="inv-inp" placeholder="Commentaire / objectif précis" value={p.comment || ""} onChange={e => update(idx, { comment:e.target.value })} style={{ width:"100%", minHeight:70, textAlign:"left" }}/></div> })}</div></SectionCard>;
}
function ActionPlanPDF({ plan=[], T=THEMES_INV.dark, onPrint }) {
  const owners = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  return <SectionCard title="Plan d’action du jour" icon={Send} subtitle="Généré à partir des décisions validées" T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={onPrint}><Icon as={Download} size={12}/>PDF</button>}>
    {plan.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucune action validée pour le moment.</div> : <div style={{ display:"grid", gap:SPACING.md }}>{owners.map(owner => <div key={owner} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text, marginBottom:8 }}>{owner}</div>{plan.filter(p => (p.responsable || "À définir") === owner).map((p,i) => <div key={i} style={{ padding:"8px 0", borderTop:i ? `1px solid ${T.border}` : "none" }}><div style={{ fontWeight:900, color:T.text }}>{p.title}</div><div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>Échéance : {safeDate(p.due_date)} · Source : {p.source || "—"} · {p.type || ""}</div>{p.comment && <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:3 }}>{p.comment}</div>}</div>)}</div>)}</div>}
  </SectionCard>;
}
function DetailField({ label, value, T=THEMES_INV.dark, mono=false }) {
  return <div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"8px 9px" }}><div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:900, textTransform:"uppercase", letterSpacing:.5 }}>{label}</div><div style={{ fontSize:FONT.sm.size + 1, color:T.text, fontWeight:800, marginTop:3, fontFamily:mono ? "'DM Mono',monospace" : "inherit" }}>{value || "—"}</div></div>;
}
function DecisionDrawer({ item, decision, setDecision, responsables, T=THEMES_INV.dark, onClose, onSave, onOpenFull, saving=false }) {
  if (!item) return null;
  const d = decision || defaultDecision(item);
  const missing = missingDecisionFields(item, d);
  const set = patch => setDecision?.({ ...d, ...patch });
  const decisions = V9_DECISIONS[item.type] || V9_DECISIONS.team;
  const fieldGrid = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:8 };
  const isBien = item.type === "bien";
  return <div style={{ position:"fixed", inset:0, zIndex:80, background:"rgba(15,23,42,.32)", display:"flex", justifyContent:"flex-end" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}><aside style={{ width:"min(560px,100%)", height:"100%", background:T.card, borderLeft:`1px solid ${T.border}`, boxShadow:"-12px 0 30px rgba(15,23,42,.18)", display:"flex", flexDirection:"column" }}><div style={{ padding:SPACING.lg, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", gap:12 }}><div><div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:7 }}><AlertBadge level={item.level} T={T}>{levelLabel(item.level)}</AlertBadge><AlertBadge level="info" T={T}>{item.type}</AlertBadge></div><div style={{ fontSize:FONT.xl.size, fontWeight:900, color:T.text }}>{item.label}</div><div style={{ fontSize:FONT.sm.size, color:T.textMuted, marginTop:3 }}>{item.subtitle}</div></div><button className="inv-btn inv-btn-out inv-btn-sm" onClick={onClose}><Icon as={X} size={13}/>Fermer</button></div><div style={{ padding:SPACING.lg, overflowY:"auto", display:"grid", gap:SPACING.md }}><section style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Alertes consolidées</div><div style={{ display:"grid", gap:6 }}>{safeArr(item.alerts).length ? item.alerts.map(a => <div key={a.code} style={{ display:"flex", justifyContent:"space-between", gap:8, border:`1px solid ${levelColor(a.level, T)}35`, background:T.input, borderRadius:RADIUS.md, padding:"7px 8px" }}><span style={{ color:T.textSub, fontWeight:800 }}>{a.label}</span>{a.due_date && <span style={{ fontFamily:"'DM Mono',monospace", color:levelColor(a.level, T) }}>{safeDate(a.due_date)}</span>}</div>) : <div style={{ color:T.textMuted }}>Aucune alerte.</div>}</div></section><section style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Lecture rapide</div><div style={fieldGrid}>{item.type === "prospect" && <><DetailField label="Score" value={`${item.score || 0}/100`} T={T} mono/><DetailField label="Budget" value={fmtDashboardEur(item.meta?.budget)} T={T}/><DetailField label="Capacité" value={fmtDashboardEur(item.meta?.capacity)} T={T}/><DetailField label="Téléphone" value={item.meta?.phone} T={T}/><DetailField label="Email" value={item.meta?.email} T={T}/><DetailField label="Source" value={item.meta?.source} T={T}/><DetailField label="Objectif" value={item.meta?.goal} T={T}/><DetailField label="Dernier contact" value={safeDate(item.meta?.lastContact)} T={T}/></>}{item.type === "client" && <><DetailField label="Étape" value={item.meta?.step} T={T}/><DetailField label="Statut" value={item.meta?.status} T={T}/><DetailField label="Budget" value={fmtDashboardEur(item.meta?.budget)} T={T}/><DetailField label="Dernière activité" value={safeDate(item.meta?.lastActivity)} T={T}/></>}{item.type === "bien" && <><DetailField label="Statut" value={item.meta?.statut} T={T}/><DetailField label="Prix" value={fmtDashboardEur(item.meta?.prix)} T={T}/><DetailField label="Travaux" value={fmtDashboardEur(item.meta?.travaux)} T={T}/><DetailField label="Rendement" value={item.meta?.rendement ? fmtDashboardPct(item.meta.rendement) : "—"} T={T}/><DetailField label="Cash-flow" value={fmtDashboardEur(item.meta?.cashflow)} T={T}/><DetailField label="Score" value={item.meta?.score} T={T} mono/></>}{item.type === "team" && <><DetailField label="Responsable" value={item.responsable} T={T}/><DetailField label="Statut" value={item.meta?.status} T={T}/><DetailField label="Échéance" value={safeDate(item.due_date)} T={T}/></>}</div><button className="inv-btn inv-btn-out inv-btn-sm" style={{ marginTop:SPACING.sm }} onClick={() => onOpenFull?.(item)}><Icon as={ExternalLink} size={12}/>Ouvrir la fiche complète</button></section><section style={{ border:`1px solid ${missing.length ? WA : SU}55`, borderRadius:RADIUS.lg, background:T.input, padding:SPACING.md }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:SPACING.sm }}><div style={{ fontWeight:900, color:T.text }}>Décision du jour</div>{missing.length ? <AlertBadge level="warning" T={T}>{missing.length} champ(s) manquant(s)</AlertBadge> : <AlertBadge level="success" T={T}>Complet</AlertBadge>}</div><div style={{ display:"grid", gap:8 }}><select className="inv-sel" value={d.decision || ""} onChange={e => set({ decision:e.target.value })}><option value="">Décision</option>{decisions.map(x => <option key={x}>{x}</option>)}</select><select className="inv-sel" value={d.responsable || ""} onChange={e => set({ responsable:e.target.value })}><option value="">Responsable</option>{(responsables || V9_RESPONSABLES_FALLBACK).map(r => <option key={r}>{r}</option>)}</select><input className="inv-inp" value={d.next_action || ""} onChange={e => set({ next_action:e.target.value })} placeholder="Action future" style={{ width:"100%", textAlign:"left" }}/><input className="inv-inp" type="date" value={d.due_date || ""} onChange={e => set({ due_date:e.target.value })} style={{ width:"100%" }}/>{isBien && (normTxt(d.decision).includes("proposer") || normTxt(d.decision).includes("matcher")) && <input className="inv-inp" value={d.client_id || ""} onChange={e => set({ client_id:e.target.value })} placeholder="Client à matcher / proposer" style={{ width:"100%", textAlign:"left" }}/>} {isBien && normTxt(d.decision).includes("offre") && <input className="inv-inp" value={d.offer_amount || ""} onChange={e => set({ offer_amount:e.target.value })} placeholder="Montant de l’offre" style={{ width:"100%", textAlign:"left" }}/>}<textarea className="inv-inp" value={d.comment || ""} onChange={e => set({ comment:e.target.value })} placeholder="Commentaire obligatoire" style={{ minHeight:92, width:"100%", textAlign:"left" }}/><label style={{ display:"flex", alignItems:"center", gap:7, fontSize:FONT.sm.size, color:T.textSub }}><input type="checkbox" checked={Boolean(d.force_validated)} onChange={e => set({ force_validated:e.target.checked })}/> Validation forcée</label>{d.force_validated && <textarea className="inv-inp" value={d.force_reason || ""} onChange={e => set({ force_reason:e.target.value })} placeholder="Motif obligatoire du forçage" style={{ minHeight:70, width:"100%", textAlign:"left" }}/>}<button className="inv-btn inv-btn-gold" disabled={saving || missing.length > 0} onClick={() => onSave?.(item, d)}><Icon as={Check} size={14}/>{saving ? "Validation…" : "Valider le suivi du jour"}</button>{missing.length > 0 && <div style={{ color:WA, fontSize:FONT.xs.size + 1 }}>Complète : {missing.join(", ")}</div>}</div></section></div></aside></div>;
}
function printPlan(plan=[]) {
  const owners = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan d'action ${todayIso()}</title><style>body{font-family:Arial,sans-serif;color:#0D2E5C;margin:32px}h1{font-size:24px;margin:0 0 6px}h2{margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#667085}.item{margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:8px}.title{font-weight:700}.meta{font-size:12px;color:#667085;margin-top:4px}</style></head><body><h1>Plan d'action du jour — Profero Invest</h1><div class="muted">Dashboard V9 — ${todayIso()}</div>${owners.map(o => `<h2>${o}</h2>${plan.filter(p => (p.responsable || "À définir") === o).map(p => `<div class="item"><div class="title">${p.title || "Action"}</div><div class="meta">Échéance : ${safeDate(p.due_date)} · Source : ${p.source || "—"} · Décision : ${p.decision || "—"}</div><div>${p.comment || ""}</div></div>`).join("")}`).join("")}</body></html>`;
  const w = window.open("", "_blank"); if (!w) return; w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// Tranche 2b : suivi des Dossiers Invest (source de vérité). Chaque ligne mène
// à la fiche client, où la carte Dossier Invest porte le pilotage.
function SuiviDossiersInvest({ data, nomsClients, T=THEMES_INV.dark, onOpenClient }) {
  if (data.avancementInconnu) return <SectionCard title="Suivi des Dossiers Invest" icon={Briefcase} T={T}><div style={{ padding:SPACING.md, border:`1px solid ${WA}55`, borderRadius:RADIUS.md, color:WA, fontWeight:800 }}>Avancement indisponible : les Dossiers Invest n'ont pas pu être chargés. Aucun chiffre n'est affiché plutôt qu'un chiffre faux.</div></SectionCard>;
  const s = data.suiviInvest || {};
  const balles = s.balles || {};
  const tuiles = [
    { label:"Dossiers actifs", value:s.dossiers ?? 0, color:T.accent },
    { label:"Étapes actives", value:s.etapesActives ?? 0, color:T.accent, hint:`${s.dossiersPlusieursEtapes ?? 0} dossier(s) sur plusieurs étapes` },
    { label:"Balle Profero", value:balles.profero ?? 0, color:WA, hint:`Client ${balles.client ?? 0} · Banque ${balles.banque ?? 0} · Notaire ${balles.notaire ?? 0} · Tiers ${balles.tiers ?? 0}` },
    { label:"Bloqués", value:s.bloques ?? 0, color:(s.bloques ? DA : SU) },
    { label:"Échéances dépassées", value:s.echeancesDepassees ?? 0, color:(s.echeancesDepassees ? DA : SU), hint:`${s.echeancesProches ?? 0} sous 7 jours` },
    { label:"Tâches en retard", value:s.tachesEnRetard ?? 0, color:(s.tachesEnRetard ? DA : SU) },
    { label:"Sans prochaine action", value:s.sansProchaineAction ?? 0, color:(s.sansProchaineAction ? WA : SU), hint:`${s.prochainesActions ?? 0} prochaine(s) action(s) définie(s)` },
  ];
  const rang = (p) => { const a = alertesPilotage(p); return a.some(x => x.level === "danger") ? 0 : a.some(x => x.level === "warning") ? 1 : 2; };
  const lignes = [...safeArr(data.pilotages)].sort((a, b) => rang(a) - rang(b) || String(a.prochaineEcheance || "9999").localeCompare(String(b.prochaineEcheance || "9999")));
  return <SectionCard title="Suivi des Dossiers Invest" icon={Briefcase} subtitle="Étapes actives, balle, prochaine action, échéance" T={T}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:SPACING.sm, marginBottom:SPACING.md }}>{tuiles.map(t => <div key={t.label} style={{ border:`1px solid ${t.color}44`, background:T.input, borderRadius:RADIUS.md, padding:"8px 10px" }}><div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.lg.size, fontWeight:900, color:t.color }}>{t.value}</div><div style={{ fontSize:FONT.xs.size + 1, fontWeight:900, color:T.text }}>{t.label}</div>{t.hint && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2 }}>{t.hint}</div>}</div>)}</div>
    {lignes.length === 0 ? <div style={{ padding:SPACING.md, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucun Dossier Invest en cours.</div> :
    <div style={{ display:"grid", gap:6 }}>{lignes.map(p => { const al = alertesPilotage(p); const niveau = al.some(x => x.level === "danger") ? "danger" : al.some(x => x.level === "warning") ? "warning" : "info"; const ajd = actionDuJour(p); return <button key={p.dossierId} type="button" onClick={() => onOpenClient?.(p.clientId)} style={{ textAlign:"left", border:`1px solid ${levelColor(niveau, T)}40`, borderLeft:`4px solid ${levelColor(niveau, T)}`, background:T.input, borderRadius:RADIUS.md, padding:"8px 10px", cursor:"pointer", fontFamily:"inherit", display:"grid", gridTemplateColumns:"minmax(160px,1fr) minmax(220px,2fr) minmax(140px,1fr)", gap:8, alignItems:"center" }}>
      <div style={{ minWidth:0 }}><div style={{ fontWeight:900, color:T.text, fontSize:FONT.sm.size + 1 }}>{nomsClients.get(p.clientId) || "Client"}</div><div style={{ color:T.textMuted, fontSize:FONT.xs.size }}>{p.reference}{p.actives.length > 1 ? ` · ${p.actives.length} étapes actives : ${p.actives.map(a => a.libelle).join(", ")}` : ""}</div></div>
      <div style={{ color:T.textSub, fontSize:FONT.xs.size + 1 }}>{resumePilotage(p)}{al[0] && <div style={{ color:levelColor(al[0].level, T), fontWeight:800, marginTop:2 }}>{al[0].label}{al.length > 1 ? ` (+${al.length - 1})` : ""}</div>}</div>
      <div style={{ color:T.textMuted, fontSize:FONT.xs.size }}><strong style={{ color:T.textSub }}>Qui agit :</strong> {ajd.responsable || "—"}{ajd.echeance && <div>avant le {safeDate(ajd.echeance)}</div>}</div>
    </button>; })}</div>}
  </SectionCard>;
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeView, setActiveView] = useState("pilotage");
  const [selected, setSelected] = useState(null);
  const [decisionItem, setDecisionItem] = useState(null);
  const [clients, setClients] = useState([]);
  const [crmProspects, setCrmProspects] = useState([]);
  const [biens, setBiens] = useState([]);
  const [propositions, setPropositions] = useState([]);
  const [planning, setPlanning] = useState([]);
  const [actions, setActions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [finance, setFinance] = useState([]);
  // Tranche 2b : Dossier Invest (dossiers non clos, étapes, annuaire).
  // null = pas encore chargé ou illisible (avancement inconnu, signalé comme tel).
  const [dossiersInvest, setDossiersInvest] = useState(null);
  const [etapesInvest, setEtapesInvest] = useState(null);
  const [utilisateursInvest, setUtilisateursInvest] = useState([]);
  // La routine du jour est chargée depuis la base par loadDashboard : elle doit
  // suivre l'utilisateur d'un appareil à l'autre, pas rester dans un navigateur.
  const [routine, setRoutine] = useState(() => emptyRoutine());
  const [routineChargee, setRoutineChargee] = useState(false);

  // Annuaire : la liste des responsables assignables vient de la table
  // utilisateurs, plus les rôles extérieurs (Client, Notaire, Agence…) qui
  // n'ont pas de compte. Remplace un tableau de cinq prénoms codé en dur.
  const annuaire = useAnnuaireInvest();
  const responsables = useMemo(() => responsablesInvest(annuaire), [annuaire]);
  // Nom d'affichage de qui pilote : sert de responsable par défaut aux
  // dossiers non assignés, à la place du prénom codé en dur.
  const pilote = profil?.nom || profil?.prenom || String(profil?.email || "").split("@")[0] || "";

  // Persistance des 3 priorités du jour.
  //
  // Elles se saisissent au clavier : on ne peut pas écrire à chaque frappe.
  // Un délai d'inactivité, puis remplacement des lignes du jour — supprimer
  // avant d'insérer évite d'avoir à supposer une contrainte d'unicité sur une
  // table dont le schéma n'est pas versionné dans le dépôt.
  //
  // On n'écrit qu'après le premier chargement : sans cette garde, le state
  // initial vide effacerait les priorités déjà saisies ailleurs.
  const prioritesTimer = useRef(null);
  useEffect(() => {
    if (!routineChargee) return;
    if (prioritesTimer.current) clearTimeout(prioritesTimer.current);
    prioritesTimer.current = setTimeout(async () => {
      const lignes = safeArr(routine.priorities)
        .map((p, idx) => ({ p: p || {}, idx }))
        .filter(({ p }) => String(p.title || "").trim())
        .map(({ p, idx }) => ({
          routine_date: todayIso(),
          step_key: "priorite",
          item_type: "priorite",
          item_id: String(idx),
          item_label: p.title || "",
          next_action: p.title || "",
          responsable: p.responsable || null,
          due_date: p.due_date || null,
          comment: p.comment || "",
          status: "validated",
        }));
      try {
        await supabase.from("invest_morning_routine_items")
          .delete().eq("routine_date", todayIso()).eq("step_key", "priorite");
        if (lignes.length) await supabase.from("invest_morning_routine_items").insert(lignes);
      } catch (e) {
        console.warn("[Dashboard] priorités non enregistrées", e);
      }
    }, 1200);
    return () => { if (prioritesTimer.current) clearTimeout(prioritesTimer.current); };
  }, [routine.priorities, routineChargee]);

  // Le chargement passe par chargerTableauBord (./tableauBord.mjs) : la liste
  // des tables lues est la même que celle de la veille du matin. Une requête
  // ajoutée ici sans l'être là-bas produirait un mail incomplet, sans erreur.
  const loadDashboard = useCallback(async () => {
    setLoading(true); setError("");
    const d = await chargerTableauBord(supabase, {
      jour: todayIso(),
      onErreur: (label, err, requis) => {
        console.warn(`[Dashboard V9] ${label}`, err);
        if (requis) setError(`Impossible de charger ${label}. Vérifie Supabase / RLS.`);
      },
    });
    setClients(d.clients); setBiens(d.biens); setPropositions(d.propositions);
    setPlanning(d.planning); setActions(d.actions); setNotifications(d.notifications);
    setFinance(d.finance); setCrmProspects(d.crmProspects);
    setDossiersInvest(d.dossiersInvest); setEtapesInvest(d.etapesInvest); setUtilisateursInvest(d.utilisateurs);
    setRoutine(routineDepuisLignes(d.routineRows));
    setRoutineChargee(true);
    setLoading(false);
  }, []);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const data = useMemo(() => consolidateData({ clients, crmProspects, biens, propositions, planning, actions,
    dossiersInvest, etapesInvest, utilisateurs:utilisateursInvest, jour:todayIso(), profil, pilote }),
    [clients, crmProspects, biens, propositions, planning, actions, dossiersInvest, etapesInvest, utilisateursInvest, profil, pilote]);
  const nomsClients = useMemo(() => new Map(safeArr(clients).map(c => [c.id, `${c.prenom || ""} ${c.nom || ""}`.trim() || c.nom || "Client"])), [clients]);
  const doneItems = useMemo(() => safeArr(data.allDossiers).filter(d => isResolvedToday(routine, d)), [data.allDossiers, routine]);
  // Même répartition que celle du mail du matin, au même endroit du code.
  const byColumn = useMemo(
    () => repartirEnColonnes({ dossiers:data.allDossiers, routine, filtre:filter }),
    [data.allDossiers, routine, filter]);
  const plan = useMemo(() => planFromRoutine(routine, data.allDossiers), [routine, data.allDossiers]);
  const currentDecision = decisionItem ? (routine.decisions?.[decisionKey(decisionItem)] || defaultDecision(decisionItem)) : null;
  const openDetail = item => setSelected(item);
  const openDecision = item => { setDecisionItem(item); setSelected(null); };
  const updateDecision = value => { if (!decisionItem) return; setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(decisionItem)]:value } })); };

  // Ouvre la fiche complète du dossier consolidé.
  //
  // Un prospect issu de `invest_clients` (converti, ou saisi directement au CRM)
  // n'existe pas dans la table prospection : le renvoyer là-bas afficherait une
  // fiche vide. On le route vers le CRM, qui est sa vraie fiche.
  const openFullRecord = item => {
    if (!item) return;
    if (item.type === "prospect") {
      if (item.sourceTable === "invest_clients") onNavigate?.("crm", NAV.ficheClient(item.id));
      else onNavigate?.("prospection", NAV.ficheProspect(item.id, item.sourceTable));
    }
    else if (item.type === "client") onNavigate?.("crm", NAV.ficheClient(item.id));
    else if (item.type === "bien")   onNavigate?.("biens", NAV.ficheBien(item.id));
    else onNavigate?.("crm", NAV.actionsClient(item.raw?.client_id || item.client_id, item.id));
  };
  // La création passe par creerNotificationInvest : même point d'entrée que le
  // CRM, et la règle « on ne se notifie pas soi-même » n'existe qu'à un seul
  // endroit.
  const createNotification = ({ actionId, responsable, title, message, item }) =>
    creerNotificationInvest({
      destinataire: responsable,
      titre: title || "Nouvelle action assignée",
      message: message || "Action créée depuis le tableau de bord.",
      entiteType: item?.type || null,
      entiteId: item?.id || null,
      actionId,
      priorite: item?.level === "danger" ? "high" : "normal",
      source: "dashboard_v9",
      profil,
    });
  // Tranche 2b : une tâche créée depuis la routine appartient au Dossier Invest
  // du client (dossier + étape à agir). Sans dossier en cours, aucune tâche
  // n'est créée (règle 2a) ; la notification au responsable part quand même.
  const createMissionAction = async (item, d) => {
    if (!d?.create_task || !d?.responsable || !d?.next_action) return null;
    // Idem : pas de tâche déléguée à soi-même.
    if (estUtilisateurCourant(d.responsable, profil)) return null;
    const pil = item.type === "client" ? item.meta?.dossier : null;
    let created = null;
    if (pil) {
      const etape = item.meta?.etapeAction?.etape || pil.principale?.etape || pil.actives?.[0]?.etape || "suivi";
      const { data: ins, error: errIns } = await supabase.from("invest_mission_actions").insert({
        client_id:item.id, ...champsNouvelleTache(pil.dossierId, etape), sort_order:999,
        responsable:d.responsable, action_title:d.next_action, due_date:d.due_date || null, status:"a_faire",
        linked_entity_type:item.type, linked_entity_id:String(item.id), source_module:"dashboard_v9",
        source_context:{ comment:d.comment, decision:d.decision, routine_date:todayIso() },
      }).select("id").single();
      if (errIns) throw new Error(`Tâche non créée : ${errIns.message}`);
      created = ins;
    }
    await createNotification({ actionId:created?.id, responsable:d.responsable, title:d.next_action, message:d.comment, item });
    return created?.id || null;
  };
  const applyEntityUpdate = async (item, d) => {
    if (item.type === "prospect") {
      const table = item.sourceTable || "invest_clients";
      const payload = { prochaine_action:d.next_action, date_prochaine_action:d.due_date };
      if (table === "invest_clients") payload.conseiller = d.responsable;
      if (normTxt(d.decision).includes("perdu")) payload.statut = "Perdu";
      if (normTxt(d.decision).includes("archiver")) payload.statut = "Archivé";
      await supabase.from(table).update(payload).eq("id", item.id);
    } else if (item.type === "client") {
      // Tranche 2b : la décision devient la prochaine action et l’échéance de
      // l'étape à agir du Dossier Invest (geste journalisé). L'ancienne
      // prochaine action du client n'est plus écrite.
      // Étape visée par l'action du jour (plusieurs étapes peuvent être actives).
      const cible = item.meta?.etapeAction || item.meta?.dossier?.principale;
      if (cible?.id) {
        const { data: maj, error: errMaj } = await supabase.from("invest_dossier_etapes")
          .update({ prochaine_action:d.next_action || null, echeance:d.due_date || null }).eq("id", cible.id).select("id");
        if (errMaj || !maj?.length) throw new Error(`Étape ${cible.libelle} non mise à jour : ${errMaj?.message || "droits insuffisants"}`);
      }
    } else if (item.type === "bien") {
      const dn = normTxt(d.decision);
      const statut = dn.includes("archiver") ? "Archivé" : dn.includes("visite") ? "À visiter" : dn.includes("proposer") ? "Proposé à client" : dn.includes("matcher") ? "À matcher" : dn.includes("offre") ? "Offre à faire" : dn.includes("attente") ? "À trier" : dn.includes("analyser") ? "À analyser" : item.raw?.statut;
      await supabase.from("invest_biens").update({ statut, date_relance:d.due_date, conseiller_profero:d.responsable }).eq("id", item.id);
    }
  };
  const saveDecision = async (item, d) => {
    const miss = missingDecisionFields(item, d);
    if (miss.length) { setError(`Validation impossible : complète ${miss.join(", ")}.`); return; }
    setSaving(true); setError("");
    try {
      await applyEntityUpdate(item, d);
      const taskId = await createMissionAction(item, d);
      try { await supabase.from("invest_morning_routine_items").insert({ routine_date:todayIso(), step_key:"pilotage_dossier", item_type:item.type, item_id:String(item.id), item_label:item.label, alert_level:item.level, decision:d.decision, comment:d.comment, responsable:d.responsable, next_action:d.next_action, due_date:d.due_date || null, status:"validated", created_task_id:taskId ? String(taskId) : null }); } catch(e) { console.warn("Historique routine non bloquant", e); }
      setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(item)]:{ ...d, created_task_id:taskId || null, resolved_at:new Date().toISOString() } }, resolved:{ ...prev.resolved, [decisionKey(item)]:{ resolved_at:new Date().toISOString(), label:item.label, type:item.type } } }));
      setDecisionItem(null); await loadDashboard();
    } catch(e) { console.error(e); setError(e.message || "Impossible de valider le dossier."); }
    setSaving(false);
  };
  const printPdf = () => printPlan(plan);

  const renderPilotage = () => <>
    <SuiviDossiersInvest data={data} nomsClients={nomsClients} T={T} onOpenClient={(id) => onNavigate?.("crm", NAV.ficheClient(id))}/>
    <StateBar data={data} doneCount={doneItems.length} T={T} onSelect={(k) => { if (k === "done") setActiveView("plan"); }} />
    <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", marginBottom:SPACING.md }}><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>{V9_ENTITY_FILTERS.map(f => { const active = filter === f.key; return <button key={f.key} className={`inv-btn ${active ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setFilter(f.key)}><Icon as={f.icon} size={12}/>{f.label}</button> })}</div><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={loadDashboard}><Icon as={RefreshCw} size={12}/>Actualiser</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={printPdf}><Icon as={Download} size={12}/>Plan PDF</button></div></div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md, alignItems:"start" }} className="v9-board-grid"><BoardColumn column={V9_COLUMNS[0]} items={byColumn.decision} T={T} onOpen={openDetail} onDecide={openDecision}/><BoardColumn column={V9_COLUMNS[1]} items={byColumn.watch} T={T} onOpen={openDetail} onDecide={openDecision}/><BoardColumn column={V9_COLUMNS[2]} items={byColumn.delegated} T={T} onOpen={openDetail} onDecide={openDecision}/></div>
    <SectionCard title="Traité aujourd’hui" icon={Check} subtitle="Dossiers consolidés validés dans la journée" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{byColumn.done.length ? byColumn.done.map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact/>) : <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted }}>Aucun dossier traité aujourd'hui.</div>}</div></SectionCard>
    <PrioritiesPanel routine={routine} setRoutine={setRoutine} responsables={responsables} T={T}/>
    <ActionPlanPDF plan={plan} T={T} onPrint={printPdf}/>
  </>;
  const renderMetier = () => <div style={{ display:"grid", gap:SPACING.md }}><SectionCard title="Prospects actifs" icon={Phone} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(filterDossiers(data.prospectDossiers, "all")).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard><SectionCard title="Clients actifs" icon={Briefcase} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(data.clientDossiers).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard><SectionCard title="Stock de biens" icon={Home} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(data.bienDossiers).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard></div>;
  // Notifications non lues, PAR destinataire.
  //
  // Cette ligne affichait un total unique, calculé sur toutes les
  // notifications de tout le monde — et comme rien ne renseignait jamais
  // read_at, il ne pouvait que croître. Il mesurait l'historique, pas un reste
  // à traiter. Le marquage lu existe maintenant (cloche), et le total ventilé
  // dit quelque chose d'actionnable : qui n'a pas encore vu ce qu'on lui a
  // assigné.
  const notifsParDestinataire = useMemo(() => {
    const parQui = {};
    for (const n of notifications) {
      if (n.read_at || n.status === "read") continue;
      const qui = n.recipient || "—";
      parQui[qui] = (parQui[qui] || 0) + 1;
    }
    return Object.entries(parQui).sort((a, b) => b[1] - a[1]);
  }, [notifications]);

  const renderEquipe = () => <SectionCard title="Pilotage équipe à distance" icon={Users} subtitle="Actions déléguées et notifications collaborateurs" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:SPACING.md }}>{(responsables || V9_RESPONSABLES_FALLBACK).map(r => { const list = data.allDossiers.filter(d => d.responsable === r && (d.category === "delegated" || d.type === "team")); return <div key={r} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:8 }}><strong style={{ color:T.text }}>{r}</strong><AlertBadge level={list.some(x => x.level === "danger") ? "danger" : "info"} T={T}>{list.length}</AlertBadge></div>{list.slice(0,8).map(item => <button key={item.key} onClick={() => openDetail(item)} style={{ width:"100%", textAlign:"left", border:"none", background:"transparent", padding:"7px 0", borderTop:`1px solid ${T.border}`, cursor:"pointer", fontFamily:"inherit" }}><div style={{ color:T.text, fontWeight:800, fontSize:FONT.sm.size }}>{item.next_action || item.label}</div><div style={{ color:T.textMuted, fontSize:FONT.xs.size }}>{item.label} · {safeDate(item.due_date)}</div></button>)}</div> })}</div>{notifsParDestinataire.length > 0 && <div style={{ marginTop:SPACING.md, paddingTop:SPACING.sm, borderTop:`1px solid ${T.border}`, color:T.textMuted, fontSize:FONT.sm.size, display:"flex", gap:SPACING.md, flexWrap:"wrap" }}>{notifsParDestinataire.map(([qui, n]) => <span key={qui}><strong style={{ color:T.textSub }}>{qui}</strong> : {n} non lue{n > 1 ? "s" : ""}</span>)}</div>}</SectionCard>;

  return <div style={{ padding:`${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth:1500, margin:"0 auto" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:SPACING.md, flexWrap:"wrap", marginBottom:SPACING.xl }}><div style={{ display:"flex", gap:SPACING.md, alignItems:"center" }}><div style={{ width:50, height:50, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={LayoutDashboard} size={24}/></div><div><div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Dashboard pilotage quotidien</div><div style={{ fontSize:FONT.sm.size + 1, color:T.textSub }}>V9 — 1 dossier = 1 carte consolidée. Pilotable à distance, sans doublons.</div></div></div><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className={`inv-btn ${activeView === "pilotage" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("pilotage")}><Icon as={LayoutGrid} size={12}/>Pilotage</button><button className={`inv-btn ${activeView === "metier" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("metier")}><Icon as={ListChecks} size={12}/>Vue métier</button><button className={`inv-btn ${activeView === "equipe" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("equipe")}><Icon as={Users} size={12}/>Équipe</button></div></div>
    {error && <div style={{ marginBottom:SPACING.md, padding:SPACING.md, border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, background:SEMANTIC?.danger?.bg || "#fff1f2", borderRadius:RADIUS.md, color:DA }}>{error}</div>}
    {loading ? <div style={{ padding:SPACING.xxxl, textAlign:"center", color:T.textMuted }}><Icon as={RefreshCw} size={15} style={{ animation:"spin 1s linear infinite" }}/> Chargement du pilotage consolidé…</div> : activeView === "pilotage" ? renderPilotage() : activeView === "metier" ? renderMetier() : renderEquipe()}
    <DecisionDrawer item={decisionItem || selected} decision={decisionItem ? currentDecision : null} setDecision={decisionItem ? updateDecision : null} responsables={responsables} T={T} onClose={() => { setDecisionItem(null); setSelected(null); }} onSave={decisionItem ? saveDecision : null} onOpenFull={openFullRecord} saving={saving}/>
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @media(max-width:1180px){.v9-board-grid{grid-template-columns:1fr!important}}`}</style>
  </div>;
}

export default TableauBord;
export { TableauBord };
