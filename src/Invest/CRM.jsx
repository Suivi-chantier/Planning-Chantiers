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
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar
} from "./_shared";
import Simulateur from "./Simulateur";

function ClientStrategyCard({ client, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => clientStrategy(client));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { setData(clientStrategy(client)); }, [client?.id]);
  const update = (k, v) => setData(prev => ({...prev, [k]:v}));
  const save = async () => {
    setSaving(true); setMsg("");
    const payload = { strategie_data:data, budget:getNumberLoose(data.budget_max || client.budget) };
    const { error } = await supabase.from("invest_clients").update(payload).eq("id", client.id);
    setSaving(false);
    if (error) setMsg(`Erreur sauvegarde stratégie : ${error.message}`);
    else { setMsg("Stratégie sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const field = (label, key, options, type="text") => (
    <div>
      <label style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:4}}>{label}</label>
      {options ? (
        <select className="inv-sel" value={data[key] || ""} onChange={e=>update(key,e.target.value)} style={{width:"100%"}}>{options.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select>
      ) : (
        <input className="inv-inp" type={type} value={data[key] || ""} onChange={e=>update(key,e.target.value)} style={{width:"100%", textAlign:type==="number"?"right":"left"}} />
      )}
    </div>
  );
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13} strokeWidth={2.2}/>Dossier investisseur</span>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={save} disabled={saving}><Icon as={Save} size={12}/> {saving?"Sync…":"Sauvegarder"}</button>
      </div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1, color:msg.startsWith("Erreur")?DA:SU, marginBottom:8, fontWeight:800}}>{msg}</div>}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          {field("Objectif", "objectif", CLIENT_STRATEGIES_INVEST)}
          {field("Budget max (€)", "budget_max", null, "number")}
          {field("Apport disponible (€)", "apport", null, "number")}
          {field("Rendement min (%)", "rendement_min", null, "number")}
          {field("Zones recherchées", "zones")}
          {field("Travaux acceptés", "travaux_acceptes", CLIENT_TRAVAUX_ACCEPTES)}
          {field("Urgence", "urgence", CLIENT_URGENCE_INVEST)}
          {field("Fiscalité cible", "fiscalite", CLIENT_FISCALITES_INVEST)}
        </div>
        <div style={{marginTop:10}}>
          <label style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:4}}>Freins / remarques</label>
          <textarea className="inv-textarea" rows={3} value={data.remarques || ""} onChange={e=>update("remarques", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function MatchingBiensClientCard({ client, biens=[], propositions=[], T=THEMES_INV.dark, onProposer }) {
  const proposed = new Set((propositions || []).map(p => p.bien_id || p.bien?.id).filter(Boolean));
  const ranked = biens.map(b => ({ b, ...computeClientBienMatch(client, b) })).filter(x => !proposed.has(x.b.id)).sort((a,b)=>b.score-a.score).slice(0,6);
  return (
    <div className="inv-card">
      <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Handshake} size={13} strokeWidth={2.2}/>Matching biens compatibles</span></div>
      <div className="inv-card-bd">
        {ranked.length === 0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"16px 0"}}>Aucun bien compatible non proposé</div> : ranked.map(({b, score, reasons}) => (
          <div key={b.id} style={{padding:"10px 0", borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8}}>
              <div style={{fontWeight:800, color:T.text, fontSize:FONT.sm.size+1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{b.adresse || b.ville || "Bien sans adresse"}</div>
              <span style={{fontFamily:"'DM Mono',monospace", color:score>=75?SU:score>=55?WA:DA, fontWeight:900}}>{score}%</span>
            </div>
            <div style={{fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:3}}>{fmtDashboardEur(bienTotalCost(b))} · {b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "rendement —"} · {reasons.slice(0,2).join(" · ") || "matching général"}</div>
            {onProposer && <button className="inv-btn inv-btn-blue inv-btn-sm" style={{marginTop:8}} onClick={()=>onProposer(b.id)}>Proposer à ce client</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistDocumentsClientCard({ client, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => clientStrategy(client));
  useEffect(() => { setData(clientStrategy(client)); }, [client?.id]);
  const setStatus = async (key, status) => {
    const next = { ...data, documents_checklist:{ ...(data.documents_checklist || {}), [key]:status } };
    setData(next);
    const { error } = await supabase.from("invest_clients").update({ strategie_data:next }).eq("id", client.id);
    if (!error) onSaved?.();
  };
  const pct = checklistPct(data.documents_checklist, CLIENT_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Documents manquants client</span><span style={{fontFamily:"'DM Mono',monospace", color:T.accent}}>{pct}%</span></div>
      <div className="inv-card-bd">
        <CompletionBar label="Complétude documentaire" value={pct} color={pct>=80?SU:WA} T={T}/>
        {CLIENT_DOCUMENT_CHECKLIST.map(([k,label]) => (
          <div key={k} className="inv-row"><span className="inv-lbl">{label}</span><select className="inv-sel" value={data.documents_checklist?.[k] || ""} onChange={e=>setStatus(k,e.target.value)}><option value="">À demander</option><option value="recu">Reçu</option><option value="na">Non applicable</option></select></div>
        ))}
      </div>
    </div>
  );
}


function computeClientPriorityScore(client = {}, propositions = [], biens = []) {
  const strat = clientStrategy(client);
  const proposed = propositions.filter(p => p.client_id === client.id);
  const budget = getNumberLoose(strat.budget_max || client.budget);
  let score = 30;
  const reasons = [];
  if (client.statut === "Actif") { score += 18; reasons.push("client actif"); }
  if (client.date_signature) { score += 14; reasons.push("contrat signé"); }
  if (budget > 0) { score += 12; reasons.push("budget renseigné"); }
  if (strat.strategie) { score += 10; reasons.push("stratégie définie"); }
  if (strat.zones) { score += 8; reasons.push("zone ciblée"); }
  if (strat.urgence === "Immédiate" || strat.urgence === "1 à 3 mois") { score += 10; reasons.push("urgence forte"); }
  if (proposed.length > 0) { score += Math.min(12, proposed.length * 4); reasons.push(`${proposed.length} bien${proposed.length>1?"s":""} proposé${proposed.length>1?"s":""}`); }
  if (!client.prochaine_action && client.statut !== "Terminé") { score -= 16; reasons.push("prochaine action manquante"); }
  const days = daysBetween(client.date_prochaine_action || client.updated_at || client.created_at);
  if (days !== null && days > 14 && client.statut !== "Terminé") { score -= 10; reasons.push("suivi à relancer"); }
  const bestMatch = biens.map(b => computeClientBienMatch(client, b).score).sort((a,b)=>b-a)[0] || 0;
  if (bestMatch >= 75) { score += 10; reasons.push("bien compatible disponible"); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, bestMatch };
}

function ClientScoreCard({ client, propositions=[], biens=[], T=THEMES_INV.dark }) {
  const { score, reasons, bestMatch } = computeClientPriorityScore(client, propositions, biens);
  const color = score >= 75 ? SU : score >= 50 ? WA : DA;
  const strat = clientStrategy(client);
  const docs = checklistPct(strat.documents_checklist, CLIENT_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Score maturité client</span></div>
      <div className="inv-card-bd">
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:12}}>
          <div style={{width:72,height:72,borderRadius:"50%",border:`5px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:900,color,fontSize:18}}>{score}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:FONT.md.size,fontWeight:900,color:T.text}}>{score>=75?"Client prioritaire":score>=50?"Client à faire avancer":"Client à qualifier"}</div>
            <div style={{fontSize:FONT.sm.size,color:T.textMuted,marginTop:3}}>Budget, stratégie, urgence, suivi et compatibilité avec le stock</div>
          </div>
        </div>
        <CompletionBar label="Dossier investisseur" value={(strat.strategie?25:0)+(strat.budget_max||client.budget?25:0)+(strat.zones?20:0)+(strat.urgence?15:0)+(strat.fiscalite?15:0)} color={T.accent} T={T}/>
        <CompletionBar label="Documents client" value={docs} color={docs>=80?SU:WA} T={T}/>
        <CompletionBar label="Meilleur matching disponible" value={bestMatch} color={bestMatch>=75?SU:bestMatch>=50?WA:DA} T={T}/>
        <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8,lineHeight:1.5}}>{reasons.slice(0,4).join(" · ") || "Compléter la stratégie pour fiabiliser le score"}</div>
      </div>
    </div>
  );
}


const STATUTS_CLIENT  = ["Prospect","Actif","Inactif","Terminé"];
const SOURCES_CLIENT  = ["Fluidify","Réseau personnel","Cold calling","Autre"];
const TYPES_NOTE      = ["appel","rendez-vous","relance","commentaire","document","autre"];

function CRMStatusPill({ statut, T }) {
  const meta = clientStatutMeta(statut);
  const IconStatus = meta.icon || Users;
  return (
    <span
      style={{
        display:"inline-flex",
        alignItems:"center",
        gap:5,
        background:`${meta.color}18`,
        color:meta.color,
        border:`1px solid ${meta.color}35`,
        borderRadius:RADIUS.pill,
        padding:`${SPACING.xs-2}px ${SPACING.sm+2}px`,
        fontSize:FONT.xs.size,
        fontWeight:800,
        whiteSpace:"nowrap",
      }}
    >
      <Icon as={IconStatus} size={11} strokeWidth={2.4}/>
      {statut || "—"}
    </span>
  );
}

function CRMViewButton({ active, icon, title, helper, onClick, T }) {
  const I = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border:`1px solid ${active ? T.accent : T.border}`,
        background: active ? `linear-gradient(135deg, ${T.accentBg}, rgba(255,255,255,.045))` : T.card,
        color: active ? T.accent : T.textSub,
        borderRadius:18,
        padding:"12px 13px",
        cursor:"pointer",
        textAlign:"left",
        display:"flex",
        alignItems:"center",
        gap:10,
        boxShadow: active ? `0 16px 36px ${T.accent}14` : "none",
        transition:"all .12s ease",
      }}
    >
      <span
        style={{
          width:34,
          height:34,
          borderRadius:13,
          display:"grid",
          placeItems:"center",
          background: active ? `${T.accent}20` : "rgba(255,255,255,.055)",
          color: active ? T.accent : T.textMuted,
          flexShrink:0,
        }}
      >
        <Icon as={I} size={16} strokeWidth={2.2}/>
      </span>
      <span style={{minWidth:0}}>
        <span style={{display:"block", fontSize:13, fontWeight:950, color:active ? T.text : T.textSub}}>{title}</span>
        <span style={{display:"block", marginTop:2, fontSize:11, color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{helper}</span>
      </span>
    </button>
  );
}

function CRMKpi({ icon, label, value, helper, color, T }) {
  const I = icon;
  return (
    <div className="inv-card" style={{ padding:14, background:"linear-gradient(135deg, rgba(255,255,255,.055), rgba(255,255,255,.025))" }}>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10}}>
        <div>
          <div style={{color:T.textMuted, fontSize:10.5, fontWeight:850, textTransform:"uppercase", letterSpacing:".08em"}}>{label}</div>
          <div style={{color:T.text, fontWeight:950, fontSize:24, marginTop:4, lineHeight:1.05}}>{value}</div>
        </div>
        <div
          style={{
            width:38,
            height:38,
            borderRadius:14,
            display:"grid",
            placeItems:"center",
            background:`${color}18`,
            color,
            border:`1px solid ${color}35`,
            flexShrink:0,
          }}
        >
          <Icon as={I} size={18} strokeWidth={2.2}/>
        </div>
      </div>
      {helper && <div style={{color:T.textMuted, fontSize:11, marginTop:8}}>{helper}</div>}
    </div>
  );
}

function CRMClientCard({ client, T, today, onOpen }) {
  const initials = `${client.prenom?.[0]||""}${client.nom?.[0]||""}`.toUpperCase() || "C";
  const enRetard = client.date_prochaine_action && client.date_prochaine_action < today;
  const meta = clientStatutMeta(client.statut);
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const fmtBudget = v => Number(v || 0) > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(Number(v)) + " €" : "—";

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        width:"100%",
        textAlign:"left",
        border:`1px solid ${T.border}`,
        background:"rgba(255,255,255,.035)",
        borderRadius:18,
        padding:12,
        cursor:"pointer",
        transition:"all .12s ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.cardHover; e.currentTarget.style.borderColor = `${meta.color}66`; }}
      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.035)"; e.currentTarget.style.borderColor = T.border; }}
    >
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <div
          style={{
            width:38,
            height:38,
            borderRadius:"50%",
            background:`${meta.color}1D`,
            border:`1px solid ${meta.color}40`,
            color:meta.color,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            fontSize:FONT.sm.size+1,
            fontWeight:900,
            flexShrink:0,
          }}
        >
          {initials}
        </div>
        <div style={{minWidth:0, flex:1}}>
          <div style={{fontWeight:900, color:T.text, fontSize:FONT.base.size, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
            {client.prenom} {client.nom}
          </div>
          <div style={{fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
            {client.email || client.telephone || "Coordonnées à compléter"}
          </div>
        </div>
        <Icon as={ChevronRight} size={15} color={T.textMuted} strokeWidth={2.3}/>
      </div>

      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginTop:11, flexWrap:"wrap"}}>
        <CRMStatusPill statut={client.statut} T={T}/>
        <span style={{fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:850, color:T.accent}}>{fmtBudget(client.budget)}</span>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10, fontSize:11.5, color:T.textMuted}}>
        <div>
          <span style={{display:"block", textTransform:"uppercase", letterSpacing:".07em", fontSize:10, color:T.textMuted}}>Étape</span>
          <span style={{display:"block", color:T.textSub, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{client.etape || "—"}</span>
        </div>
        <div>
          <span style={{display:"block", textTransform:"uppercase", letterSpacing:".07em", fontSize:10, color:T.textMuted}}>Action</span>
          <span style={{display:"block", color: enRetard ? DA : T.textSub, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
            {enRetard && <Icon as={AlertTriangle} size={10} style={{verticalAlign:-1, marginRight:3}}/>}
            {fmtDate(client.date_prochaine_action)}
          </span>
        </div>
      </div>
    </button>
  );
}

const CRM_STATUT_META = {
  Prospect: { label:"Prospect", color:"#60A5FA", icon:Users, tone:"Nouveau client" },
  Actif: { label:"Actif", color:SU, icon:Check, tone:"Mission en cours" },
  Inactif: { label:"Inactif", color:WA, icon:Bell, tone:"À réactiver" },
  Terminé: { label:"Terminé", color:"#94A3B8", icon:Check, tone:"Mission finalisée" },
};

function clientStatutMeta(statut) {
  return CRM_STATUT_META[statut] || { label:statut || "—", color:"#94A3B8", icon:Users, tone:"Suivi client" };
}

function CRM({ profil, T=THEMES_INV.dark, onOuvrirSimulation, onOpenStructuration, onOpenBien, initialFilter }) {
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [ficheId, setFicheId]     = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [viewMode, setViewMode]   = useState("planning");
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreConseiller, setFiltreConseiller] = useState("");
  const [filtreSource, setFiltreSource] = useState("");
  const [specialFilter, setSpecialFilter] = useState("");
  const [search, setSearch]       = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key:"created_at", direction:"desc" });
  const [missionDeepLink, setMissionDeepLink] = useState({ clientId:"", actionId:"", stepKey:"" });

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  useEffect(() => {
    if (!initialFilter) return;
    setFiltreStatut(""); setFiltreConseiller(""); setFiltreSource(""); setSpecialFilter(""); setColumnFilters({}); setSearch("");
    if (initialFilter.type === "statut") setFiltreStatut(initialFilter.value || "");
    if (initialFilter.type === "etape") setColumnFilters({ etape: initialFilter.value || "" });
    if (["sans_action", "actions_week_or_late", "signes", "with_propositions"].includes(initialFilter.type)) setSpecialFilter(initialFilter.type);
  }, [initialFilter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    const clientId = params.get("crm_client") || params.get("client_id") || "";
    const actionId = params.get("mission_action") || "";
    const stepKey = params.get("mission_step") || "";
    if (!clientId) return;
    setMissionDeepLink({ clientId, actionId, stepKey });
    setFicheId(clientId);
  }, []);

  const conseillers = [...new Set(clients.map(c => c.conseiller).filter(Boolean))];
  const sources = [...new Set([...SOURCES_CLIENT, ...clients.map(c => c.source).filter(Boolean)])];
  const today = new Date().toISOString().slice(0,10);
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0,10);
  };

  const updateColumnFilter = (key, value) => setColumnFilters(prev => ({ ...prev, [key]: value }));
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  const valueForColumn = (c, key) => {
    if (key === "contact") return `${c.prenom||""} ${c.nom||""} ${c.email||""} ${c.telephone||""}`;
    if (key === "action") return `${c.date_prochaine_action||""} ${c.prochaine_action||""}`;
    return c[key];
  };

  let filtered = clients.filter(c => {
    if (filtreStatut && c.statut !== filtreStatut) return false;
    if (filtreConseiller && c.conseiller !== filtreConseiller) return false;
    if (filtreSource && c.source !== filtreSource) return false;
    if (specialFilter === "sans_action" && (c.prochaine_action || c.date_prochaine_action)) return false;
    if (specialFilter === "actions_week_or_late" && !isActionLateOrThisWeek(c)) return false;
    if (specialFilter === "signes" && !c.date_signature) return false;
    if (search && !normTxt(`${c.nom} ${c.prenom} ${c.email} ${c.telephone} ${c.conseiller} ${c.source} ${c.etape} ${c.prochaine_action}`).includes(normTxt(search))) return false;
    return Object.entries(columnFilters).every(([key, value]) => {
      if (!value) return true;
      return normTxt(valueForColumn(c, key)).includes(normTxt(value));
    });
  });

  filtered = [...filtered].sort((a,b) => compareValues(valueForColumn(a, sortConfig.key), valueForColumn(b, sortConfig.key), sortConfig.direction));

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const fmtBudget = v => Number(v || 0) > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(Number(v)) + " €" : "—";
  const gridCols = "1.55fr .85fr .85fr .9fr .85fr .95fr 1.35fr 1.25fr 75px";

  const stats = useMemo(() => {
    const active = clients.filter(c => !["Terminé", "Inactif"].includes(c.statut));
    const due = clients.filter(c => c.date_prochaine_action && c.date_prochaine_action <= today && !["Terminé"].includes(c.statut));
    const late = clients.filter(c => c.date_prochaine_action && c.date_prochaine_action < today && !["Terminé"].includes(c.statut));
    const signed = clients.filter(c => c.date_signature || c.statut === "Actif" || c.statut === "Terminé");
    const potential = active.reduce((s, c) => s + (Number(c.budget || 0) || 0), 0);
    const noAction = active.filter(c => !c.prochaine_action && !c.date_prochaine_action).length;
    return { total:clients.length, active:active.length, due:due.length, late:late.length, signed:signed.length, potential, noAction };
  }, [clients, today]);

  const byStatus = useMemo(() => {
    const grouped = {};
    STATUTS_CLIENT.forEach(s => grouped[s] = []);
    filtered.forEach(c => {
      const key = STATUTS_CLIENT.includes(c.statut) ? c.statut : "Prospect";
      grouped[key].push(c);
    });
    return grouped;
  }, [filtered]);

  const planningBuckets = useMemo(() => {
    const day7 = addDays(7);
    const day30 = addDays(30);
    const actionable = filtered
      .filter(c => c.statut !== "Terminé")
      .slice()
      .sort((a,b) => compareValues(a.date_prochaine_action || "9999-99-99", b.date_prochaine_action || "9999-99-99", "asc"));

    return [
      { id:"late", title:"En retard", helper:"Actions passées", color:DA, icon:AlertTriangle, items: actionable.filter(c => c.date_prochaine_action && c.date_prochaine_action < today) },
      { id:"today", title:"Aujourd'hui", helper:"À traiter maintenant", color:WA, icon:Bell, items: actionable.filter(c => c.date_prochaine_action === today) },
      { id:"week", title:"7 jours", helper:"Actions à venir", color:T.accent, icon:Calendar, items: actionable.filter(c => c.date_prochaine_action && c.date_prochaine_action > today && c.date_prochaine_action <= day7) },
      { id:"month", title:"30 jours", helper:"Suivi à anticiper", color:"#8B5CF6", icon:Calendar, items: actionable.filter(c => c.date_prochaine_action && c.date_prochaine_action > day7 && c.date_prochaine_action <= day30) },
      { id:"none", title:"Sans action", helper:"À replanifier", color:"#94A3B8", icon:Filter, items: actionable.filter(c => !c.date_prochaine_action && !c.prochaine_action) },
    ];
  }, [filtered, today, T.accent]);

  const analysis = useMemo(() => {
    const bySource = new Map();
    const byConseiller = new Map();
    const byEtape = new Map();
    filtered.forEach(c => {
      const src = c.source || "Non renseigné";
      const con = c.conseiller || "Non affecté";
      const et = c.etape || "Étape non renseignée";
      const budget = Number(c.budget || 0) || 0;
      const add = (map, key) => {
        const prev = map.get(key) || { count:0, budget:0, signed:0, late:0 };
        prev.count += 1;
        prev.budget += budget;
        if (c.date_signature || c.statut === "Actif" || c.statut === "Terminé") prev.signed += 1;
        if (c.date_prochaine_action && c.date_prochaine_action < today) prev.late += 1;
        map.set(key, prev);
      };
      add(bySource, src);
      add(byConseiller, con);
      add(byEtape, et);
    });
    const rows = (map) => Array.from(map.entries()).map(([label, v]) => ({ label, ...v })).sort((a,b) => b.count - a.count).slice(0,8);
    return { sources:rows(bySource), conseillers:rows(byConseiller), etapes:rows(byEtape) };
  }, [filtered, today]);

  const resetFilters = () => {
    setFiltreStatut("");
    setFiltreConseiller("");
    setFiltreSource("");
    setSpecialFilter("");
    setSearch("");
    setColumnFilters({});
  };

  const openClient = (id) => setFicheId(id);

  const renderListe = () => (
    loading ? (
      <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
        <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
        Chargement…
      </div>
    ) : (
      <div style={{ background:T.card, borderRadius:22, border:`1px solid ${T.border}`, overflowX:"auto", boxShadow:T.shadowSm }}>
        <div style={{ minWidth:1280 }}>
          <div style={{
            display:"grid", gridTemplateColumns:gridCols,
            padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
            borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:800,
            color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8, gap:10,
          }}>
            <SortableHeader label="Contact" sortKey="contact" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Date contact" sortKey="date_premier_contact" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Source" sortKey="source" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Budget" sortKey="budget" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Conseiller" sortKey="conseiller" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Étape" sortKey="etape" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <SortableHeader label="Prochaine action" sortKey="action" sortConfig={sortConfig} onSort={handleSort} T={T}/>
            <div/>
          </div>
          <div style={{
            display:"grid", gridTemplateColumns:gridCols, gap:10, padding:`${SPACING.sm}px ${SPACING.lg}px`,
            background:T.input, borderBottom:`1px solid ${T.border}`,
          }}>
            {["contact","date_premier_contact","statut","source","budget","conseiller","etape","action"].map(k => (
              <input key={k} className="inv-inp" value={columnFilters[k]||""} placeholder="Filtrer…" onChange={e=>updateColumnFilter(k,e.target.value)} style={{width:"100%", textAlign:"left", fontSize:FONT.xs.size+1, padding:"5px 7px"}}/>
            ))}
            <div/>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, fontSize:FONT.base.size, fontStyle:"italic" }}>Aucun contact trouvé</div>
          ) : filtered.map(c => {
            const initials = `${c.prenom?.[0]||""}${c.nom?.[0]||""}`.toUpperCase();
            const enRetard = c.date_prochaine_action && c.date_prochaine_action < today;
            const meta = clientStatutMeta(c.statut);
            return (
              <div key={c.id} style={{
                display:"grid", gridTemplateColumns:gridCols, gap:10,
                padding:`${SPACING.md+2}px ${SPACING.lg}px`,
                borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center",
                cursor:"pointer", transition:"background .12s",
              }}
                onMouseEnter={e=>e.currentTarget.style.background=T.cardHover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                onClick={() => openClient(c.id)}>
                <div style={{display:"flex", alignItems:"center", gap:SPACING.sm+2, minWidth:0}}>
                  <div style={{
                    width:36, height:36, borderRadius:"50%", flexShrink:0,
                    background:`${meta.color}1D`, color:meta.color, border:`1px solid ${meta.color}40`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:FONT.sm.size+1, fontWeight:900,
                  }}>{initials || "C"}</div>
                  <div style={{minWidth:0}}>
                    <div style={{ fontWeight:800, color:T.text, fontSize:FONT.base.size, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.prenom} {c.nom}</div>
                    <div style={{ fontSize:FONT.xs.size, color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.email || c.telephone || "—"}</div>
                  </div>
                </div>
                <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{fmtDate(c.date_premier_contact)}</div>
                <div><CRMStatusPill statut={c.statut} T={T}/></div>
                <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{c.source||"—"}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size+1, fontWeight:700, color:T.accent }}>{fmtBudget(c.budget)}</div>
                <div style={{ fontSize:FONT.sm.size+1, color:T.textSub }}>{c.conseiller||"—"}</div>
                <div style={{ fontSize:FONT.sm.size, color:T.textSub }}>{c.etape||"—"}</div>
                <div style={{ fontSize:FONT.sm.size, color: enRetard ? DA : T.textMuted }}>
                  {enRetard && <Icon as={AlertTriangle} size={11} strokeWidth={2.2} style={{marginRight:3, verticalAlign:-1}}/>}
                  {fmtDate(c.date_prochaine_action)}
                  {c.prochaine_action && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:1, opacity:0.7 }}>{c.prochaine_action.slice(0,42)}</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:FONT.sm.size, color:T.accent, fontWeight:800, display:"inline-flex", alignItems:"center", gap:3 }}>
                    Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )
  );

  const renderPipeline = () => (
    <div className="inv-crm-kanban" style={{display:"grid", gridTemplateColumns:`repeat(${STATUTS_CLIENT.length}, minmax(290px, 1fr))`, gap:12, overflowX:"auto", padding:"2px 2px 12px"}}>
      {STATUTS_CLIENT.map(statut => {
        const meta = clientStatutMeta(statut);
        const items = byStatus[statut] || [];
        return (
          <div key={statut} style={{border:`1px solid ${T.border}`, borderTop:`3px solid ${meta.color}`, borderRadius:22, background:"rgba(255,255,255,.03)", minHeight:520, padding:10}}>
            <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:12, padding:"10px 10px 11px", borderRadius:16, background:`linear-gradient(135deg, ${meta.color}1F, rgba(255,255,255,.035))`, border:`1px solid ${meta.color}35`}}>
              <div style={{display:"flex", alignItems:"center", gap:9, minWidth:0}}>
                <div style={{width:32, height:32, borderRadius:12, display:"grid", placeItems:"center", background:`${meta.color}20`, color:meta.color, border:`1px solid ${meta.color}45`, flexShrink:0}}>
                  <Icon as={meta.icon} size={15} strokeWidth={2.2}/>
                </div>
                <div style={{minWidth:0}}>
                  <div style={{color:T.text, fontSize:13, fontWeight:950, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{meta.label}</div>
                  <div style={{color:T.textMuted, fontSize:10.5, marginTop:1}}>{meta.tone}</div>
                </div>
              </div>
              <div style={{textAlign:"right", flexShrink:0}}>
                <div style={{color:T.text, fontSize:15, fontWeight:950, lineHeight:1}}>{items.length}</div>
                <div style={{color:T.textMuted, fontSize:10, marginTop:3}}>client(s)</div>
              </div>
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {items.length === 0 ? (
                <div style={{padding:"34px 8px", textAlign:"center", color:T.textMuted, fontSize:12, fontStyle:"italic", background:"rgba(255,255,255,.02)", borderRadius:16}}>Aucun client</div>
              ) : items.map(c => <CRMClientCard key={c.id} client={c} T={T} today={today} onOpen={() => openClient(c.id)}/>) }
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderPlanning = () => (
    <div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(230px, 1fr))", gap:10}}>
        {planningBuckets.map(bucket => (
          <div key={bucket.id} className="inv-card" style={{padding:0, overflow:"hidden"}}>
            <div style={{padding:12, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:`linear-gradient(135deg, ${bucket.color}16, rgba(255,255,255,.03))`}}>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <span style={{width:30, height:30, borderRadius:12, display:"grid", placeItems:"center", background:`${bucket.color}18`, color:bucket.color, border:`1px solid ${bucket.color}35`}}>
                  <Icon as={bucket.icon} size={14} strokeWidth={2.2}/>
                </span>
                <div>
                  <div style={{color:T.text, fontWeight:950, fontSize:13}}>{bucket.title}</div>
                  <div style={{color:T.textMuted, fontSize:10.5}}>{bucket.helper}</div>
                </div>
              </div>
              <div style={{color:T.text, fontWeight:950, fontSize:18}}>{bucket.items.length}</div>
            </div>
            <div style={{padding:10, display:"flex", flexDirection:"column", gap:8, maxHeight:520, overflowY:"auto"}}>
              {bucket.items.length === 0 ? (
                <div style={{padding:"18px 8px", textAlign:"center", color:T.textMuted, fontSize:12, fontStyle:"italic"}}>Aucun client</div>
              ) : bucket.items.map(c => <CRMClientCard key={c.id} client={c} T={T} today={today} onOpen={() => openClient(c.id)}/>) }
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const BarRow = ({ label, count, budget, signed, late, max }) => {
    const pct = max ? Math.round((count / max) * 100) : 0;
    return (
      <div style={{padding:"10px 0", borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", marginBottom:6}}>
          <div style={{color:T.text, fontWeight:850, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{label}</div>
          <div style={{display:"flex", gap:10, alignItems:"center", color:T.textMuted, fontSize:11, flexShrink:0}}>
            <span>{count} client(s)</span>
            <span>{fmtBudget(budget)}</span>
            {signed > 0 && <span style={{color:SU}}>{signed} signé(s)</span>}
            {late > 0 && <span style={{color:DA}}>{late} retard</span>}
          </div>
        </div>
        <div style={{height:8, background:"rgba(255,255,255,.065)", borderRadius:999, overflow:"hidden"}}>
          <div style={{height:"100%", width:`${pct}%`, background:`linear-gradient(90deg, ${T.accent}, #60A5FA)`, borderRadius:999}}/>
        </div>
      </div>
    );
  };

  const renderAnalyse = () => {
    const maxSource = Math.max(1, ...analysis.sources.map(r => r.count));
    const maxConseiller = Math.max(1, ...analysis.conseillers.map(r => r.count));
    const maxEtape = Math.max(1, ...analysis.etapes.map(r => r.count));
    const alerts = [
      stats.late > 0 ? `${stats.late} client(s) avec une action en retard` : null,
      stats.noAction > 0 ? `${stats.noAction} client(s) actifs sans prochaine action` : null,
      clients.filter(c => !c.email && !c.telephone).length > 0 ? `${clients.filter(c => !c.email && !c.telephone).length} fiche(s) sans coordonnées` : null,
      clients.filter(c => !c.budget).length > 0 ? `${clients.filter(c => !c.budget).length} fiche(s) sans budget renseigné` : null,
    ].filter(Boolean);

    return (
      <div style={{display:"grid", gridTemplateColumns:"1.15fr .85fr", gap:12}}>
        <div style={{display:"grid", gap:12}}>
          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex", alignItems:"center", gap:6}}><Icon as={BarChart3} size={13}/>Répartition par source</span></div>
            <div className="inv-card-bd">
              {analysis.sources.length === 0 ? <div style={{color:T.textMuted, fontSize:13}}>Aucune donnée</div> : analysis.sources.map(r => <BarRow key={r.label} {...r} max={maxSource}/>) }
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd mid"><span style={{display:"inline-flex", alignItems:"center", gap:6}}><Icon as={Users} size={13}/>Répartition par conseiller</span></div>
            <div className="inv-card-bd">
              {analysis.conseillers.length === 0 ? <div style={{color:T.textMuted, fontSize:13}}>Aucune donnée</div> : analysis.conseillers.map(r => <BarRow key={r.label} {...r} max={maxConseiller}/>) }
            </div>
          </div>
        </div>

        <div style={{display:"grid", gap:12}}>
          <div className="inv-card">
            <div className="inv-card-hd"><span style={{display:"inline-flex", alignItems:"center", gap:6}}><Icon as={TrendingUp} size={13}/>Étapes commerciales</span></div>
            <div className="inv-card-bd">
              {analysis.etapes.length === 0 ? <div style={{color:T.textMuted, fontSize:13}}>Aucune donnée</div> : analysis.etapes.map(r => <BarRow key={r.label} {...r} max={maxEtape}/>) }
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd orange"><span style={{display:"inline-flex", alignItems:"center", gap:6}}><Icon as={AlertTriangle} size={13}/>Points d'attention</span></div>
            <div className="inv-card-bd" style={{display:"grid", gap:8}}>
              {alerts.length === 0 ? (
                <div style={{color:SU, fontSize:13, fontWeight:850}}>Aucune alerte prioritaire sur les clients filtrés.</div>
              ) : alerts.map((a, i) => (
                <div key={i} style={{padding:10, borderRadius:14, border:`1px solid ${WA}35`, background:`${WA}10`, color:T.textSub, fontSize:13, display:"flex", gap:8}}>
                  <Icon as={AlertTriangle} size={14} color={WA} style={{flexShrink:0, marginTop:1}}/>
                  <span>{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1680, margin:"0 auto" }}>
      <style>{`
        .inv-crm-kanban::-webkit-scrollbar { height: 10px; }
        .inv-crm-kanban::-webkit-scrollbar-thumb { background: rgba(201,163,74,.35); border-radius: 999px; }
        .inv-crm-kanban::-webkit-scrollbar-track { background: rgba(255,255,255,.04); border-radius: 999px; }
      `}</style>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:SPACING.sm+2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:46, height:46, borderRadius:16, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:`0 14px 35px ${T.accent}14`,
          }}>
            <Icon as={Users} size={22} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text, letterSpacing:-0.3 }}>CRM Clients</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Suivi des clients signés, actifs et dossiers à faire avancer</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau client
        </button>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:12}}>
        <CRMKpi icon={Users} label="Clients total" value={stats.total} helper={`${filtered.length} affiché(s)`} color="#60A5FA" T={T}/>
        <CRMKpi icon={Check} label="Clients actifs" value={stats.active} helper="Missions en cours / à suivre" color={SU} T={T}/>
        <CRMKpi icon={Bell} label="À traiter" value={stats.due} helper={`${stats.late} en retard`} color={stats.due > 0 ? WA : SU} T={T}/>
        <CRMKpi icon={Euro} label="Budgets suivis" value={fmtBudget(stats.potential)} helper="Budgets clients actifs" color={T.accent} T={T}/>
      </div>

      <div className="inv-card" style={{ padding:12, marginBottom:12, background:"linear-gradient(135deg, rgba(255,255,255,.055), rgba(255,255,255,.025))" }}>
        <div style={{ display:"flex", gap:SPACING.sm+2, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{position:"relative", width:290, maxWidth:"100%"}}>
            <Icon as={Search} size={13} color={T.textMuted} style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
            <input className="inv-inp" placeholder="Rechercher un client…" value={search} onChange={e=>setSearch(e.target.value)} style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
          </div>
          <select className="inv-sel" value={filtreStatut} onChange={e=>{setFiltreStatut(e.target.value); setSpecialFilter("");}}>
            <option value="">Tous statuts</option>
            {STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}
          </select>
          <select className="inv-sel" value={filtreConseiller} onChange={e=>setFiltreConseiller(e.target.value)}>
            <option value="">Tous conseillers</option>
            {conseillers.map(c=><option key={c}>{c}</option>)}
          </select>
          <select className="inv-sel" value={filtreSource} onChange={e=>setFiltreSource(e.target.value)}>
            <option value="">Toutes sources</option>
            {sources.map(s=><option key={s}>{s}</option>)}
          </select>
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={resetFilters}>
            <Icon as={X} size={12} strokeWidth={2.2}/> Réinitialiser
          </button>
          {specialFilter && <span style={{fontSize:FONT.sm.size, color:T.accent, fontWeight:800, display:"inline-flex", alignItems:"center"}}>Filtre dashboard actif</span>}
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(210px, 1fr))", gap:8, marginBottom:12}}>
        <CRMViewButton active={viewMode === "pipeline"} icon={LayoutGrid} title="Pipeline" helper="Clients par statut" onClick={() => setViewMode("pipeline")} T={T}/>
        <CRMViewButton active={viewMode === "liste"} icon={Users} title="Liste" helper="Vue complète filtrable" onClick={() => setViewMode("liste")} T={T}/>
        <CRMViewButton active={viewMode === "planning"} icon={Calendar} title="Planning" helper="Actions et relances" onClick={() => setViewMode("planning")} T={T}/>
        <CRMViewButton active={viewMode === "analyse"} icon={BarChart3} title="Analyse" helper="Sources, conseillers, alertes" onClick={() => setViewMode("analyse")} T={T}/>
      </div>

      {viewMode === "pipeline" && renderPipeline()}
      {viewMode === "liste" && renderListe()}
      {viewMode === "planning" && renderPlanning()}
      {viewMode === "analyse" && renderAnalyse()}

      {ficheId && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setFicheId(null);
              charger();
            }
          }}
          style={{
            position:"fixed",
            inset:0,
            zIndex:9999,
            background:"rgba(2,6,23,.72)",
            backdropFilter:"blur(6px)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:18,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width:"min(1480px, 96vw)",
              maxHeight:"92vh",
              overflowY:"auto",
              borderRadius:24,
              boxShadow:"0 30px 90px rgba(0,0,0,.45)",
              background:T.bg,
              border:`1px solid ${T.border}`,
            }}
          >
            <FicheClient id={ficheId} profil={profil} T={T} initialMissionStep={missionDeepLink?.clientId === ficheId ? missionDeepLink.stepKey : ""} initialMissionActionId={missionDeepLink?.clientId === ficheId ? missionDeepLink.actionId : ""} onRetour={() => { setFicheId(null); charger(); }} onOuvrirSimulation={onOuvrirSimulation} onOpenStructuration={onOpenStructuration} onOpenBien={onOpenBien} />
          </div>
        </div>
      )}

      {showForm && <FormulaireClient profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function FormulaireClient({ client, profil, onSave, onClose, T=THEMES_INV.dark }) {
  const isEdit = !!client;
  const [form, setForm] = useState({
    nom: client?.nom||"", prenom: client?.prenom||"",
    email: client?.email||"", telephone: client?.telephone||"",
    conseiller: client?.conseiller || profil?.nom||"",
    source: client?.source||"Autre", statut: client?.statut||"Prospect",
    budget: client?.budget||0, etape: client?.etape||"",
    date_premier_contact: client?.date_premier_contact||"",
    prochaine_action: client?.prochaine_action||"",
    date_prochaine_action: client?.date_prochaine_action||"",
    notes_rapides: client?.notes_rapides||"",
  });
  const [saving, setSaving] = useState(false);

  const sauvegarder = async () => {
    if (!form.nom.trim()) return;
    setSaving(true);
    // Seuls les champs existants dans la table sont envoyés
    const payload = {
      nom:                   form.nom.trim(),
      prenom:                form.prenom.trim() || null,
      email:                 form.email.trim() || null,
      telephone:             form.telephone.trim() || null,
      conseiller:            form.conseiller.trim() || null,
      source:                form.source || "Autre",
      statut:                form.statut || "Prospect",
      budget:                parseFloat(form.budget) || 0,
      etape:                 form.etape || null,
      date_premier_contact:  form.date_premier_contact || null,
      prochaine_action:      form.prochaine_action.trim() || null,
      date_prochaine_action: form.date_prochaine_action || null,
      notes_rapides:         form.notes_rapides.trim() || null,
    };
    Object.keys(payload).forEach(k => { if (payload[k] === "") payload[k] = null; });
    const write = async (p) => isEdit
      ? await supabase.from("invest_clients").update(p).eq("id", client.id)
      : await supabase.from("invest_clients").insert(p);
    let { error } = await write(payload);
    if (error && (error.code === "42703" || error.code === "PGRST204" || String(error.message||"").includes("date_premier_contact"))) {
      const { date_premier_contact, ...fallbackPayload } = payload;
      const retry = await write(fallbackPayload);
      error = retry.error;
      if (!error) console.warn("Colonne date_premier_contact absente. Lancez la migration SQL pour activer cette donnée.");
    }
    if (error) { console.error("Erreur sauvegarde client:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:640, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le contact" : "Nouveau contact"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Nom *</label><input className="inv-inp" value={form.nom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,nom:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Prénom</label><input className="inv-inp" value={form.prenom} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prenom:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Email</label><input className="inv-inp" type="email" value={form.email} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,email:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Téléphone</label><input className="inv-inp" value={form.telephone} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,telephone:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Conseiller référent</label><input className="inv-inp" value={form.conseiller} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,conseiller:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Source</label>
            <select className="inv-sel" value={form.source} style={{ width:"100%" }} onChange={e=>setForm({...form,source:e.target.value})}>
              {SOURCES_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Statut</label>
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_CLIENT.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Budget (€)</label><input className="inv-inp" type="number" value={form.budget} style={{ width:"100%" }} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div style={{ marginBottom:14, gridColumn:"1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Étape en cours</label>
            <select className="inv-sel" value={form.etape} style={{ width:"100%" }} onChange={e=>setForm({...form,etape:e.target.value})}>
              <option value="">Sélectionner une étape…</option>
              {ETAPES_CLIENT.map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Date avant contact</label><input className="inv-inp" type="date" value={form.date_premier_contact} style={{ width:"100%" }} onChange={e=>setForm({...form,date_premier_contact:e.target.value})}/></div>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Date prochaine action</label><input className="inv-inp" type="date" value={form.date_prochaine_action} style={{ width:"100%" }} onChange={e=>setForm({...form,date_prochaine_action:e.target.value})}/></div>
        </div>
        <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Prochaine action</label><input className="inv-inp" value={form.prochaine_action} style={{ width:"100%", textAlign:"left" }} onChange={e=>setForm({...form,prochaine_action:e.target.value})}/></div>
        <div style={{ marginBottom:14 }}><label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Notes rapides</label><textarea className="inv-textarea" rows={3} value={form.notes_rapides} onChange={e=>setForm({...form,notes_rapides:e.target.value})}/></div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── DOCUMENTS// ─── DOCUMENTS (Supabase Storage) ────────────────────────────────────────────
// Bucket requis : "invest-documents" (public: false, RLS: authenticated)
// Chemin des fichiers : clients/{client_id}/{filename} ou biens/{bien_id}/{filename}


const MISSION_AUTOMATION_ACCOUNT_EMAIL = "og@groupe-profero.com";
const MISSION_COMPLETION_NOTIFICATION_EMAIL = "matthieu.fumoleau@groupe-profero.com";
const missionEscapeHtml = (value = "") => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const missionBuildActionUrl = (clientId, actionId, stepKey = "") => {
  try {
    if (typeof window === "undefined" || !clientId) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("page", "crm");
    url.searchParams.set("crm_client", String(clientId));
    if (actionId) url.searchParams.set("mission_action", String(actionId));
    if (stepKey) url.searchParams.set("mission_step", String(stepKey));
    url.searchParams.set("crm_focus", "mission");
    url.hash = actionId ? `mission-action-${actionId}` : "mission-parcours";
    return url.toString();
  } catch {
    return "";
  }
};
const MISSION_COLLABORATEURS_EMAILS = {
  Matthieu: "matthieu.fumoleau@groupe-profero.com",
  Tom: "tom.fourmond@groupe-profero.com",
  Camille: "camille.landais@groupe-profero.com",
  // Les emails de Quentin, Loris et François pourront être ajoutés ici après validation.
};
const MISSION_EMAILS_STORAGE_KEY = "profero_mission_collaborateurs_emails_v1";
const missionStoredEmails = () => {
  try {
    if (typeof window === "undefined") return {};
    return JSON.parse(window.localStorage.getItem(MISSION_EMAILS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};
const missionRememberOwnerEmail = (owner, email) => {
  const cleanOwner = String(owner || "").trim();
  const cleanEmail = String(email || "").trim();
  if (!cleanOwner || !cleanEmail) return;
  try {
    const current = missionStoredEmails();
    window.localStorage.setItem(MISSION_EMAILS_STORAGE_KEY, JSON.stringify({ ...current, [cleanOwner]: cleanEmail }));
  } catch {}
};
const missionLooksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const missionEmailForOwner = (owner, client = {}) => {
  const cleanOwner = String(owner || "").trim();
  if (!cleanOwner) return "";
  if (cleanOwner === "Client") return String(client?.email || "").trim();
  const stored = missionStoredEmails();
  // Priorité aux emails officiels codés en dur : cela évite qu'une ancienne adresse
  // mémorisée dans le navigateur continue de bloquer les actions Mail / Agenda.
  return MISSION_COLLABORATEURS_EMAILS[cleanOwner] || stored[cleanOwner] || "";
};
const missionClientDisplayName = (client = {}) => `${client?.prenom || ""} ${client?.nom || ""}`.trim() || client?.email || "Client";
const missionBuildNotificationEmail = (action = {}, client = {}) => {
  const clientName = missionClientDisplayName(client);
  const due = action?.due_date ? new Date(action.due_date).toLocaleDateString("fr-FR") : "à définir";
  const actionUrl = missionBuildActionUrl(client?.id, action?.id, action?.step_key);
  const subject = `[Profero Invest] Action à traiter — ${action?.action_title || "Mission client"}`;
  const body = [
    `Bonjour ${action?.responsable || ""},`,
    "",
    `Une action t'est attribuée dans le Parcours Mission Profero Invest.`,
    "",
    `Client : ${clientName}`,
    `Étape : ${action?.step_label || "—"}`,
    `Action : ${action?.action_title || "—"}`,
    `Date échéance : ${due}`,
    action?.relance_rule ? `Relance prévue : ${action.relance_rule}` : null,
    action?.document_drive_attendu ? `Document / Drive : une pièce est attendue ou doit être archivée.` : null,
    actionUrl ? `Ouvrir directement la tâche : ${actionUrl}` : null,
    "",
    "Merci de traiter cette action ou de mettre à jour son statut dans l'application Profero.",
    "",
    "Bonne journée,",
    "Profero Invest",
  ].filter(Boolean).join("\n");

  const safeClient = missionEscapeHtml(clientName);
  const safeStep = missionEscapeHtml(action?.step_label || "—");
  const safeAction = missionEscapeHtml(action?.action_title || "—");
  const safeDue = missionEscapeHtml(due);
  const safeResponsable = missionEscapeHtml(action?.responsable || "");
  const safeRelance = action?.relance_rule ? missionEscapeHtml(action.relance_rule) : "";
  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:#111827;color:#ffffff;padding:18px 22px;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9a34a;font-weight:700;">Profero Invest</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px;">Action à traiter</div>
        </div>
        <div style="padding:22px;">
          <p style="margin:0 0 14px;">Bonjour ${safeResponsable},</p>
          <p style="margin:0 0 18px;">Une action t'est attribuée dans le Parcours Mission Profero Invest.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
            <tr><td style="padding:8px 0;color:#64748b;width:135px;">Client</td><td style="padding:8px 0;font-weight:700;">${safeClient}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Étape</td><td style="padding:8px 0;font-weight:700;">${safeStep}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Action</td><td style="padding:8px 0;font-weight:700;">${safeAction}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;">Échéance</td><td style="padding:8px 0;font-weight:700;color:#dc2626;">${safeDue}</td></tr>
            ${safeRelance ? `<tr><td style="padding:8px 0;color:#64748b;">Relance</td><td style="padding:8px 0;">${safeRelance}</td></tr>` : ""}
          </table>
          ${actionUrl ? `<a href="${missionEscapeHtml(actionUrl)}" style="display:inline-block;background:#c9a34a;color:#111827;text-decoration:none;font-weight:800;border-radius:999px;padding:12px 18px;">Ouvrir la tâche</a>` : ""}
          <p style="margin:22px 0 0;color:#64748b;font-size:13px;">Si le bouton ne fonctionne pas, copie le lien présent dans la version texte de l'email.</p>
        </div>
      </div>
    </div>
  `;
  return { subject, body, htmlBody, actionUrl };
};
const MISSION_CALENDAR_TIMEZONE = "Europe/Paris";
const MISSION_CALENDAR_DEFAULT_DURATION_MINUTES = 60;
const missionCalendarAddOneDay = (isoDate = "") => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return "";
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
};
const missionLooksLikeIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
const missionLooksLikeHour = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "").trim());
const missionCalendarEndTime = (date, hour, durationMinutes = MISSION_CALENDAR_DEFAULT_DURATION_MINUTES) => {
  if (!missionLooksLikeIsoDate(date) || !missionLooksLikeHour(hour)) return "";
  const d = new Date(`${date}T${hour}:00`);
  d.setMinutes(d.getMinutes() + Number(durationMinutes || MISSION_CALENDAR_DEFAULT_DURATION_MINUTES));
  return d.toTimeString().slice(0,5);
};
const missionFormatCalendarDateFr = (date, hour = "") => {
  const d = missionFormatDateFr(date);
  return hour ? `${d} à ${hour}` : `${d} · journée entière`;
};
const missionBuildCalendarEvent = (action = {}, client = {}, options = {}) => {
  const clientName = missionClientDisplayName(client);
  const missionLabel = action?.step_label || action?.mission_label || "Mission client";
  const calendarDate = options.calendarDate || action?.calendar_date || action?.due_date || new Date().toISOString().slice(0,10);
  const calendarTime = String(options.calendarTime || action?.calendar_time || "").trim();
  const hasTime = !!calendarTime;
  const endDate = missionCalendarAddOneDay(calendarDate) || calendarDate;
  const endTime = hasTime ? missionCalendarEndTime(calendarDate, calendarTime) : "";
  const summary = `[Profero Invest] ${clientName} — ${missionLabel} — ${action?.action_title || "Action"}`;
  const description = [
    `Client concerné : ${clientName}`,
    `Mission : ${missionLabel}`,
    `Action : ${action?.action_title || "—"}`,
    `Responsable : ${action?.responsable || "—"}`,
    `Créneau agenda : ${missionFormatCalendarDateFr(calendarDate, calendarTime)}`,
    action?.due_date ? `Date d'échéance initiale : ${missionFormatDateFr(action.due_date)}` : null,
    action?.relance_rule ? `Relance : ${action.relance_rule}` : null,
    action?.document_drive_attendu ? `Pièce / Drive attendu : oui` : null,
    "",
    "Événement créé depuis le Parcours Mission Profero Invest.",
  ].filter(Boolean).join("\n");
  return {
    summary,
    description,
    dueDate: calendarDate,
    endDate,
    calendarDate,
    calendarTime,
    startTime: hasTime ? `${calendarDate}T${calendarTime}:00` : "",
    endTime: hasTime ? `${calendarDate}T${endTime}:00` : "",
    hasTime,
    timeZone: MISSION_CALENDAR_TIMEZONE,
  };
};
const MISSION_STATUTS_ACTION = [
  { key:"a_faire", label:"À faire", color:"#f59e0b" },
  { key:"en_cours", label:"En cours", color:"#2563eb" },
  { key:"fait", label:"Fait", color:"#16a34a" },
  { key:"bloque", label:"Bloqué", color:"#dc2626" },
  { key:"non_concerne", label:"N/C", color:"#64748b" },
];
const missionStatusMeta = (status) => MISSION_STATUTS_ACTION.find(s => s.key === status) || MISSION_STATUTS_ACTION[0];
const missionActionDone = (a) => ["fait", "non_concerne"].includes(a?.status);
const missionAddDaysIso = (days=2) => {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0,10);
};
const missionFormatDateFr = (value) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const missionExtractDriveIdFromUrl = (url = "") => {
  const clean = String(url || "").trim();
  if (!clean) return "";
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const found = clean.match(pattern);
    if (found?.[1]) return found[1];
  }
  return "";
};
const missionIsDriveFolderUrl = (url = "") => String(url || "").includes("/folders/");
const MISSION_LOCAL_JUSTIFICATIF_BUCKET = "invest-documents";
const MISSION_LOCAL_JUSTIFICATIF_PREFIX = "supabase-storage://";
const missionSafeFileName = (name = "piece") => {
  const clean = String(name || "piece").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 90);
  return clean || "piece";
};
const missionStorageUrlFromPath = (bucket, path) => `${MISSION_LOCAL_JUSTIFICATIF_PREFIX}${bucket}/${path}`;
const missionParseStorageUrl = (url = "") => {
  const clean = String(url || "");
  if (!clean.startsWith(MISSION_LOCAL_JUSTIFICATIF_PREFIX)) return null;
  const rest = clean.slice(MISSION_LOCAL_JUSTIFICATIF_PREFIX.length);
  const firstSlash = rest.indexOf("/");
  if (firstSlash <= 0) return null;
  return { bucket: rest.slice(0, firstSlash), path: rest.slice(firstSlash + 1) };
};
const missionIsLocalStorageUrl = (url = "") => !!missionParseStorageUrl(url);
const MISSION_STEPS_INVEST = [
  {
    key:"signature", label:"Signature", crmHints:["signature contrat", "signature"], owner:"Camille",
    objectif:"Transformer le prospect en client opérationnel et créer une base documentaire propre.",
    actions:[
      { title:"Archiver le contrat signé dans le Drive", owner:"Camille", due:1, drive:true, relance:"J+1 si contrat absent du Drive" },
      { title:"Envoyer la facture d'honoraires", owner:"Camille", due:1, relance:"J+2 si facture non envoyée" },
      { title:"Demander la CNI", owner:"Camille", due:2, drive:true, relance:"J+2 puis J+5 si non reçue" },
      { title:"Demander la fiche patrimoniale", owner:"Camille", due:2, drive:true, relance:"J+2 puis J+5 si non reçue" },
      { title:"Demander les justificatifs financiers", owner:"Camille", due:2, drive:true, relance:"J+2 puis J+5 si non reçus" },
      { title:"Classer les documents dans le Drive", owner:"Camille", due:3, drive:true, relance:"Alerte si documents reçus non classés" },
    ],
  },
  {
    key:"lancement", label:"Lancement mission", crmHints:["envoi des documents", "stratégie", "définition"], owner:"Matthieu",
    objectif:"Valider que le dossier est complet et que le cahier des charges de recherche est exploitable.",
    actions:[
      { title:"Vérifier la complétude du dossier", owner:"Camille", due:2, relance:"Alerte si pièce essentielle manquante" },
      { title:"Vérifier la réception des fonds", owner:"Camille", due:2, relance:"J+3 si règlement absent" },
      { title:"Valider le cahier des charges de recherche", owner:"Matthieu", due:3, relance:"Relance conseiller si stratégie non validée" },
      { title:"Lancer officiellement les recherches", owner:"Tom", due:4, relance:"Alerte si aucune action recherche après lancement" },
    ],
  },
  {
    key:"recherche", label:"Recherche & suivi", crmHints:["recherche", "visites", "analyse"], owner:"Tom",
    objectif:"Rendre visible le travail de recherche et maintenir un suivi régulier du client.",
    actions:[
      { title:"Mettre en place les alertes immobilières", owner:"Tom", due:1, relance:"J+2 si aucune alerte créée" },
      { title:"Créer les actions de prospection", owner:"Tom", due:2, relance:"Alerte si aucune prospection active" },
      { title:"Suivre les biens identifiés", owner:"Tom", due:7, relance:"Hebdomadaire" },
      { title:"Suivre les visites réalisées", owner:"Tom", due:7, relance:"Hebdomadaire" },
      { title:"Suivre les offres effectuées", owner:"Matthieu", due:7, relance:"Hebdomadaire" },
      { title:"Rédiger le compte-rendu des actions menées", owner:"Tom", due:7, relance:"Chaque semaine si aucun bien présenté" },
    ],
  },
  {
    key:"presentation_bien", label:"Présentation bien", crmHints:["présentation", "projets"], owner:"Matthieu",
    objectif:"Présenter une opportunité claire au client avec rentabilité, risques et contraintes.",
    actions:[
      { title:"Réaliser l'analyse de rentabilité", owner:"Matthieu", due:1, relance:"Avant envoi dossier client" },
      { title:"Analyser les risques et contraintes", owner:"Matthieu", due:1, relance:"Avant décision client" },
      { title:"Envoyer le dossier de présentation", owner:"Matthieu", due:1, drive:true, relance:"Relance client J+2" },
      { title:"Réaliser les plans iMapper si client intéressé", owner:"François", due:3, drive:true, relance:"J+3 si plans non réalisés" },
      { title:"Réaliser les plans HomeByMe si nécessaire", owner:"François", due:4, drive:true, relance:"J+4 si plans non réalisés" },
      { title:"Obtenir un devis travaux réel", owner:"François", due:5, drive:true, relance:"Alerte si devis non reçu" },
      { title:"Valider la stratégie du projet", owner:"Matthieu", due:5, relance:"Avant offre / compromis" },
      { title:"Planifier une visite client sur place si nécessaire", owner:"Tom", due:3, relance:"J+3 si visite à organiser" },
    ],
  },
  {
    key:"acquisition", label:"Acquisition", crmHints:["offre", "compromis"], owner:"Matthieu",
    objectif:"Sécuriser le passage offre / compromis et anticiper travaux et gestion.",
    actions:[
      { title:"Suivre la signature du compromis", owner:"Matthieu", due:3, relance:"J+3 si compromis non signé" },
      { title:"Archiver le compromis dans le Drive", owner:"Camille", due:1, drive:true, relance:"Dès réception du compromis" },
      { title:"Vérifier les conditions suspensives", owner:"Matthieu", due:2, relance:"Alerte avant échéance" },
      { title:"Informer François du futur chantier à prévoir", owner:"François", due:2, relance:"Alerte planning travaux" },
      { title:"Informer Loris du futur chantier et de la relation commerciale rénovation", owner:"Loris", due:2, relance:"Alerte passation rénovation" },
      { title:"Informer la gestion locative à anticiper", owner:"Gestion locative", due:3, relance:"Alerte mise en location" },
    ],
  },
  {
    key:"financement", label:"Financement", crmHints:["dossier bancaire", "financement"], owner:"Camille",
    objectif:"Constituer, transmettre et relancer le dossier bancaire jusqu'à obtention du financement.",
    actions:[
      { title:"Mettre à jour les informations financières dans l'application", owner:"Camille", due:1, relance:"Avant transmission bancaire" },
      { title:"Constituer le dossier bancaire", owner:"Camille", due:3, drive:true, relance:"J+3 si incomplet" },
      { title:"Transmettre le dossier au client / courtier / banque", owner:"Camille", due:4, relance:"J+5 si aucun retour" },
      { title:"Suivre l'avancement du financement", owner:"Camille", due:7, relance:"J+5 / J+10 / J+15" },
      { title:"Relancer les interlocuteurs si nécessaire", owner:"Camille", due:10, relance:"Selon statut bancaire" },
    ],
  },
  {
    key:"urbanisme", label:"Urbanisme & administratif", crmHints:["urbanisme", "conditions suspensives", "d'urbanisme"], owner:"François",
    objectif:"Cadrer les demandes administratives et suivre l'instruction jusqu'à accord.",
    actions:[
      { title:"Définir les Velux : dimensions et emplacements", owner:"François", due:3, relance:"Avant dépôt urbanisme" },
      { title:"Définir le stationnement / dérogation", owner:"François", due:3, relance:"Avant dépôt urbanisme" },
      { title:"Définir les modifications de menuiseries", owner:"François", due:3, relance:"Avant dépôt urbanisme" },
      { title:"Vérifier le changement de destination", owner:"François", due:3, relance:"Avant stratégie projet" },
      { title:"Calculer surface de plancher et emprise au sol créées", owner:"François", due:4, relance:"Avant dépôt urbanisme" },
      { title:"Créer le dossier et les plans d'urbanisme", owner:"François", due:7, drive:true, relance:"J+7 si plans absents" },
      { title:"Déposer la demande d'urbanisme", owner:"Camille", due:8, drive:true, relance:"J+8 si non déposé" },
      { title:"Suivre l'instruction", owner:"Camille", due:15, relance:"Relance mairie selon délai" },
      { title:"Archiver l'accord d'urbanisme", owner:"Camille", due:30, drive:true, relance:"Dès réception accord" },
    ],
  },
  {
    key:"enedis", label:"Raccordement Enedis", crmHints:["enedis", "raccordement"], owner:"Camille",
    objectif:"Piloter le mandat, la demande de raccordement et le devis Enedis.",
    actions:[
      { title:"Envoyer le mandat de représentation au client", owner:"Camille", due:1, drive:true, relance:"J+3 si mandat non signé" },
      { title:"Suivre la signature du mandat", owner:"Camille", due:3, relance:"J+3 si mandat absent" },
      { title:"Déposer la demande de raccordement", owner:"Camille", due:4, relance:"J+7 si demande non déposée" },
      { title:"Planifier le RDV Enedis", owner:"Camille", due:10, relance:"J+10 si pas de RDV" },
      { title:"Faire valider le devis Enedis", owner:"Matthieu", due:15, drive:true, relance:"Alerte devis à valider" },
      { title:"Préparer les plans techniques Enedis", owner:"François", due:15, drive:true, relance:"Après validation devis" },
    ],
  },
  {
    key:"signature_definitive", label:"Signature définitive", crmHints:["obtention du financement", "signature notaire", "notaire"], owner:"Matthieu",
    objectif:"Finaliser l'acquisition et sécuriser la facturation des honoraires.",
    actions:[
      { title:"Suivre la signature chez le notaire", owner:"Matthieu", due:2, relance:"Avant date acte" },
      { title:"Archiver l'acte / attestation de propriété", owner:"Camille", due:1, drive:true, relance:"Dès réception acte" },
      { title:"Envoyer la facture d'honoraires", owner:"Camille", due:1, relance:"Dès signature définitive" },
      { title:"Vérifier l'encaissement des honoraires", owner:"Camille", due:5, relance:"J+5 si non réglé" },
    ],
  },
  {
    key:"travaux", label:"Travaux", crmHints:["réalisation", "travaux"], owner:"Loris",
    objectif:"Passer proprement le relais à Profero Rénovation et lancer le chantier.",
    actions:[
      { title:"Envoyer la facture d'acompte travaux", owner:"Camille", due:1, relance:"Avant démarrage chantier" },
      { title:"Transmettre le dossier complet à Loris", owner:"Loris", due:2, drive:true, relance:"Avant réunion passation" },
      { title:"Organiser la réunion de passation", owner:"Loris", due:3, relance:"J+3 si réunion non calée" },
      { title:"Archiver le compte-rendu de passation", owner:"Loris", due:4, drive:true, relance:"Après réunion" },
      { title:"Basculer le suivi travaux vers Loris", owner:"Loris", due:4, relance:"Après passation validée" },
    ],
  },
  {
    key:"apres_travaux", label:"Après travaux", crmHints:["terminé", "après travaux"], owner:"Matthieu",
    objectif:"Fidéliser le client, ouvrir un nouveau projet ou déclencher du parrainage.",
    actions:[
      { title:"Programmer le message de suivi à 2 mois", owner:"Tom", due:60, relance:"J+60 après fin travaux" },
      { title:"Demander le retour d'expérience client", owner:"Tom", due:60, relance:"Après livraison" },
      { title:"Proposer un nouveau projet", owner:"Matthieu", due:65, relance:"Selon satisfaction client" },
      { title:"Proposer le parrainage", owner:"Tom", due:65, relance:"Après retour positif" },
      { title:"Identifier opportunité gestion / revente / structuration", owner:"Matthieu", due:70, relance:"Revue post-projet" },
    ],
  },
];
function missionDetectStepKey(client = {}) {
  const etape = String(client?.etape || "").toLowerCase();
  const statut = String(client?.statut || "").toLowerCase();
  const found = MISSION_STEPS_INVEST.find(s => (s.crmHints || []).some(h => etape.includes(String(h).toLowerCase())));
  if (found) return found.key;
  if (statut.includes("termin")) return "apres_travaux";
  return "signature";
}
function missionStepIndex(key) {
  return Math.max(0, MISSION_STEPS_INVEST.findIndex(s => s.key === key));
}
function missionCurrentStepKeyFromActions(actions = [], client = {}) {
  const safeActions = Array.isArray(actions) ? actions : [];
  if (!safeActions.length) return missionDetectStepKey(client);
  for (const step of MISSION_STEPS_INVEST) {
    const list = safeActions.filter(a => a.step_key === step.key);
    if (list.length && !list.every(missionActionDone)) return step.key;
  }
  const withActions = MISSION_STEPS_INVEST.filter(step => safeActions.some(a => a.step_key === step.key));
  return withActions.length ? withActions[withActions.length - 1].key : missionDetectStepKey(client);
}
function missionCurrentStepLabelFromActions(actions = [], client = {}) {
  const key = missionCurrentStepKeyFromActions(actions, client);
  return MISSION_STEPS_INVEST.find(s => s.key === key)?.label || client?.etape || "—";
}
function MissionParcoursClientCard({ client, T=THEMES_INV.dark, profil, onClientUpdated, onMissionStageChange, initialStepKey="", initialActionId="" }) {
  const [actions, setActions] = useState([]);
  const [selectedStep, setSelectedStep] = useState(initialStepKey || missionDetectStepKey(client));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("a_traiter");
  const [responsableFilter, setResponsableFilter] = useState("");
  const missionJustificatifFileRef = useRef(null);
  const missionJustificatifActionIdRef = useRef(null);
  const missionHighlightedActionRef = useRef(null);
  const today = new Date().toISOString().slice(0,10);
  const charger = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true); setError("");
    const { data, error } = await supabase
      .from("invest_mission_actions")
      .select("*")
      .eq("client_id", client.id)
      .order("step_index", { ascending:true })
      .order("sort_order", { ascending:true })
      .order("due_date", { ascending:true });
    if (error) {
      console.warn("invest_mission_actions:", error);
      setError(error.code === "42P01" ? "Table invest_mission_actions absente : lance la migration SQL Parcours Mission." : error.message);
      setActions([]);
    } else {
      setActions(data || []);
    }
    setLoading(false);
  }, [client?.id]);
  useEffect(() => { setSelectedStep(initialStepKey || missionDetectStepKey(client)); }, [client?.id, client?.etape, client?.statut, initialStepKey]);
  useEffect(() => { charger(); }, [charger]);

  const selected = MISSION_STEPS_INVEST.find(s => s.key === selectedStep) || MISSION_STEPS_INVEST[0];
  const stats = useMemo(() => {
    const total = actions.length;
    const done = actions.filter(missionActionDone).length;
    const late = actions.filter(a => !missionActionDone(a) && a.due_date && a.due_date < today).length;
    const weekLimit = missionAddDaysIso(7);
    const week = actions.filter(a => !missionActionDone(a) && a.due_date && a.due_date >= today && a.due_date <= weekLimit).length;
    const next = actions.filter(a => !missionActionDone(a)).sort((a,b)=>String(a.due_date||"9999").localeCompare(String(b.due_date||"9999")))[0] || null;
    return { total, done, late, week, progress:total ? Math.round(done/total*100) : 0, next };
  }, [actions, today]);
  useEffect(() => {
    onMissionStageChange?.({
      key: missionCurrentStepKeyFromActions(actions, client),
      label: missionCurrentStepLabelFromActions(actions, client),
    });
  }, [actions, client?.id, client?.etape, client?.statut, onMissionStageChange]);

  useEffect(() => {
    if (!initialActionId || loading) return;
    const timer = setTimeout(() => {
      missionHighlightedActionRef.current?.scrollIntoView?.({ behavior:"smooth", block:"center" });
    }, 250);
    return () => clearTimeout(timer);
  }, [initialActionId, loading, actions.length]);

  const stepProgress = (key) => {
    const list = actions.filter(a => a.step_key === key);
    return { total:list.length, done:list.filter(missionActionDone).length, pct:list.length ? Math.round(list.filter(missionActionDone).length/list.length*100) : 0 };
  };
  const actionsStep = actions.filter(a => a.step_key === selected.key);
  const responsablesStep = [...new Set(actionsStep.map(a => a.responsable).filter(Boolean))];
  const actionsStepTodo = actionsStep.filter(a => !missionActionDone(a));
  const actionsStepLate = actionsStepTodo.filter(a => a.due_date && a.due_date < today);
  const actionsStepWithoutPiece = actionsStepTodo.filter(a => a.document_drive_attendu && !a.justificatif_drive_url);
  const actionsStepFiltered = actionsStep
    .filter(a => {
      if (responsableFilter && a.responsable !== responsableFilter) return false;
      if (actionFilter === "a_traiter" && missionActionDone(a)) return false;
      if (actionFilter === "retard" && !(a.due_date && a.due_date < today && !missionActionDone(a))) return false;
      if (actionFilter === "pieces" && !(a.document_drive_attendu && !a.justificatif_drive_url && !missionActionDone(a))) return false;
      if (actionFilter === "fait" && !missionActionDone(a)) return false;
      return true;
    })
    .sort((a,b) => {
      const aDone = missionActionDone(a) ? 1 : 0;
      const bDone = missionActionDone(b) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return String(a.due_date || "9999-99-99").localeCompare(String(b.due_date || "9999-99-99"));
    });

  const genererActions = async (stepKey = selected.key) => {
    const step = MISSION_STEPS_INVEST.find(s => s.key === stepKey);
    if (!step || !client?.id) return;
    setSaving(true); setError("");
    const existing = new Set(actions.filter(a => a.step_key === step.key).map(a => a.action_title));
    const payload = step.actions
      .filter(a => !existing.has(a.title))
      .map((a, idx) => ({
        client_id: client.id,
        step_key: step.key,
        step_label: step.label,
        step_index: missionStepIndex(step.key) + 1,
        sort_order: idx + 1,
        action_title: a.title,
        responsable: a.owner || step.owner || null,
        responsable_email: missionEmailForOwner(a.owner || step.owner, client) || null,
        status: "a_faire",
        due_date: missionAddDaysIso(a.due || 2),
        relance_rule: a.relance || null,
        document_drive_attendu: !!a.drive,
        due_reminder_enabled: true,
        drive_folder: `clients/${client.id}`,
        created_by: profil?.email || profil?.nom || null,
        metadata: { objectif: step.objectif || "" },
      }));
    if (!payload.length) { setSaving(false); return; }
    const { error } = await supabase.from("invest_mission_actions").insert(payload);
    setSaving(false);
    if (error) { setError(error.message); return; }
    charger();
  };
  const genererTout = async () => {
    setSaving(true); setError("");
    const existingKeys = new Set(actions.map(a => `${a.step_key}|||${a.action_title}`));
    const payload = [];
    MISSION_STEPS_INVEST.forEach(step => {
      step.actions.forEach((a, idx) => {
        const k = `${step.key}|||${a.title}`;
        if (!existingKeys.has(k)) payload.push({
          client_id: client.id,
          step_key: step.key,
          step_label: step.label,
          step_index: missionStepIndex(step.key) + 1,
          sort_order: idx + 1,
          action_title: a.title,
          responsable: a.owner || step.owner || null,
          responsable_email: missionEmailForOwner(a.owner || step.owner, client) || null,
          status: "a_faire",
          due_date: missionAddDaysIso(a.due || 2),
          relance_rule: a.relance || null,
          document_drive_attendu: !!a.drive,
          due_reminder_enabled: true,
          drive_folder: `clients/${client.id}`,
          created_by: profil?.email || profil?.nom || null,
          metadata: { objectif: step.objectif || "" },
        });
      });
    });
    if (!payload.length) { setSaving(false); return; }
    const { error } = await supabase.from("invest_mission_actions").insert(payload);
    setSaving(false);
    if (error) { setError(error.message); return; }
    charger();
  };
  const notifyActionCompletionToMatthieu = async (action) => {
    if (!action?.id) return;
    const completedAt = action.completed_at ? new Date(action.completed_at).toLocaleString("fr-FR") : new Date().toLocaleString("fr-FR");
    const actionUrl = missionBuildActionUrl(client?.id, action?.id, action?.step_key);
    const subject = `[Profero Invest] Tâche complétée — ${action?.action_title || "Mission client"}`;
    const body = [
      "Bonjour Matthieu,",
      "",
      "Une tâche vient d'être marquée comme complétée dans le Parcours Mission Profero Invest.",
      "",
      `Client : ${missionClientDisplayName(client)}`,
      `Étape : ${action?.step_label || "—"}`,
      `Action : ${action?.action_title || "—"}`,
      `Responsable : ${action?.responsable || "—"}`,
      `Complétée le : ${completedAt}`,
      actionUrl ? `Ouvrir directement la tâche : ${actionUrl}` : null,
      "",
      "Notification automatique Profero Invest",
    ].filter(Boolean).join("\n");
    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <div style="background:#111827;color:#ffffff;padding:18px 22px;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9a34a;font-weight:700;">Profero Invest</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px;">Tâche complétée</div>
          </div>
          <div style="padding:22px;">
            <p style="margin:0 0 16px;">Une tâche vient d'être marquée comme complétée.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#64748b;width:135px;">Client</td><td style="padding:8px 0;font-weight:700;">${missionEscapeHtml(missionClientDisplayName(client))}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Étape</td><td style="padding:8px 0;font-weight:700;">${missionEscapeHtml(action?.step_label || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Action</td><td style="padding:8px 0;font-weight:700;">${missionEscapeHtml(action?.action_title || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Responsable</td><td style="padding:8px 0;">${missionEscapeHtml(action?.responsable || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Complétée le</td><td style="padding:8px 0;color:#16a34a;font-weight:800;">${missionEscapeHtml(completedAt)}</td></tr>
            </table>
            ${actionUrl ? `<a href="${missionEscapeHtml(actionUrl)}" style="display:inline-block;background:#c9a34a;color:#111827;text-decoration:none;font-weight:800;border-radius:999px;padding:12px 18px;">Ouvrir la tâche</a>` : ""}
          </div>
        </div>
      </div>
    `;
    const { data, error } = await supabase.functions.invoke("send-mission-email", {
      body: {
        actionId: action.id,
        clientId: client.id,
        to: MISSION_COMPLETION_NOTIFICATION_EMAIL,
        subject,
        body,
        htmlBody,
        actionUrl,
        responsable: action.responsable || "",
        clientName: missionClientDisplayName(client),
        senderEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
        fromEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
        notificationType: "mission_action_completed",
      },
    });
    if (error || data?.error) {
      console.warn("Notification tâche complétée non envoyée:", data?.error || error?.message || error);
    }
  };

  const updateAction = async (action, patch) => {
    const nowIso = new Date().toISOString();
    const cleanPatch = { ...patch };

    // La date saisie dans la tâche reste la DATE D'ÉCHÉANCE.
    // Quand la tâche est validée, on enregistre automatiquement la date du jour.
    if (Object.prototype.hasOwnProperty.call(cleanPatch, "status")) {
      if (cleanPatch.status === "fait") cleanPatch.completed_at = nowIso;
      else if (action.status === "fait") cleanPatch.completed_at = null;
    }

    const optimistic = { ...action, ...cleanPatch };
    setActions(prev => prev.map(a => a.id === action.id ? optimistic : a));

    const { error } = await supabase
      .from("invest_mission_actions")
      .update({ ...cleanPatch, updated_at:nowIso })
      .eq("id", action.id);

    if (error) {
      setError(error.message);
      charger();
      return;
    }

    if (cleanPatch.status === "fait" && action.status !== "fait") {
      notifyActionCompletionToMatthieu(optimistic);
    }
  };

  const openMissionJustificatif = async (action) => {
    const url = action?.justificatif_drive_url;
    if (!url) return;
    const local = missionParseStorageUrl(url);
    if (local?.bucket && local?.path) {
      const { data, error } = await supabase.storage.from(local.bucket).createSignedUrl(local.path, 600);
      if (error || !data?.signedUrl) {
        setError(error?.message || "Impossible d'ouvrir la pièce justificative stockée dans l'application.");
        return;
      }
      window.open(data.signedUrl, "_blank");
      return;
    }
    window.open(url, "_blank");
  };

  const saveMissionJustificatif = async (action, patch, driveLinkRow = null) => {
    if (!action?.id) return;
    const finalPatch = { ...patch, document_drive_attendu:true, updated_at:new Date().toISOString() };
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...finalPatch } : a));

    const { error } = await supabase.from("invest_mission_actions").update(finalPatch).eq("id", action.id);
    if (error) { setError(error.message); charger(); return; }

    if (driveLinkRow) {
      try {
        await supabase.from("invest_drive_links").upsert(driveLinkRow, { onConflict:"folder,file_id" });
      } catch {}
    }
  };

  const addMissionJustificatifFromDrive = async (action) => {
    if (!action?.id) return;
    setError("");
    const url = window.prompt("Colle le lien Google Drive de la pièce justificative :", action.justificatif_drive_url && !missionIsLocalStorageUrl(action.justificatif_drive_url) ? action.justificatif_drive_url : "");
    if (!url) return;
    const cleanUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setError("Lien invalide. Colle un lien Google Drive complet commençant par https://");
      return;
    }
    const defaultName = action.justificatif_drive_name || action.action_title || "Pièce justificative";
    const name = window.prompt("Nom de la pièce justificative :", defaultName) || defaultName;
    const nowIso = new Date().toISOString();
    const driveId = missionExtractDriveIdFromUrl(cleanUrl) || `mission-${action.id}-${Date.now()}`;
    const mimeType = missionIsDriveFolderUrl(cleanUrl) ? GOOGLE_DRIVE_FOLDER_MIME : "application/vnd.google-apps.unknown";
    const patch = {
      justificatif_drive_file_id: driveId,
      justificatif_drive_name: String(name || "Pièce justificative").trim(),
      justificatif_drive_url: cleanUrl,
      justificatif_drive_mime_type: mimeType,
      justificatif_drive_linked_at: nowIso,
    };
    await saveMissionJustificatif(action, patch, {
      folder: `clients/${client.id}/mission/${action.id}`,
      file_id: driveId,
      name: patch.justificatif_drive_name,
      mime_type: mimeType,
      url: cleanUrl,
      created_by: profil?.email || profil?.nom || null,
      metadata: {
        source: "mission_action_justificatif_drive",
        kind: mimeType === GOOGLE_DRIVE_FOLDER_MIME ? "folder" : "file",
        action_id: action.id,
        client_id: client.id,
        step_key: action.step_key,
        action_title: action.action_title,
      },
    });
  };

  const chooseMissionJustificatifFromComputer = (action) => {
    if (!action?.id) return;
    setError("");
    missionJustificatifActionIdRef.current = action.id;
    if (missionJustificatifFileRef.current) missionJustificatifFileRef.current.value = "";
    missionJustificatifFileRef.current?.click();
  };

  const handleMissionJustificatifComputerFile = async (event) => {
    const file = event?.target?.files?.[0];
    const actionId = missionJustificatifActionIdRef.current;
    if (!file || !actionId) return;
    const action = actions.find(a => a.id === actionId);
    if (!action) return;
    setError("");
    if (file.size > 50 * 1024 * 1024) {
      setError(`${file.name} dépasse 50 Mo.`);
      return;
    }
    const nowIso = new Date().toISOString();
    const safeName = missionSafeFileName(file.name || "piece_justificative");
    const path = `clients/${client.id}/mission/${action.id}/justificatifs/${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(MISSION_LOCAL_JUSTIFICATIF_BUCKET)
      .upload(path, file, { upsert:false, contentType:file.type || undefined });
    if (uploadError) {
      setError(uploadError.message || "Impossible d'ajouter la pièce depuis l'ordinateur.");
      return;
    }
    const storageUrl = missionStorageUrlFromPath(MISSION_LOCAL_JUSTIFICATIF_BUCKET, path);
    const fileId = `storage:${path}`;
    const patch = {
      justificatif_drive_file_id: fileId,
      justificatif_drive_name: file.name || "Pièce justificative",
      justificatif_drive_url: storageUrl,
      justificatif_drive_mime_type: file.type || "application/octet-stream",
      justificatif_drive_linked_at: nowIso,
    };
    await saveMissionJustificatif(action, patch, {
      folder: `clients/${client.id}/mission/${action.id}`,
      file_id: fileId,
      name: patch.justificatif_drive_name,
      mime_type: patch.justificatif_drive_mime_type,
      url: storageUrl,
      size_bytes: file.size || null,
      created_by: profil?.email || profil?.nom || null,
      metadata: {
        source: "mission_action_justificatif_upload_local",
        kind: "storage_file",
        bucket: MISSION_LOCAL_JUSTIFICATIF_BUCKET,
        path,
        action_id: action.id,
        client_id: client.id,
        step_key: action.step_key,
        action_title: action.action_title,
      },
    });
  };


  const removeMissionJustificatif = async (action) => {
    if (!action?.id || !action.justificatif_drive_url) return;
    if (!window.confirm("Supprimer la pièce justificative liée à cette tâche ?\n\nLe fichier restera dans Google Drive. Seul le lien dans l’application sera supprimé.")) return;
    setError("");
    const nowIso = new Date().toISOString();
    const previousFileId = action.justificatif_drive_file_id;
    const previousUrl = action.justificatif_drive_url;
    const previousLocal = missionParseStorageUrl(previousUrl);
    const patch = {
      justificatif_drive_file_id: null,
      justificatif_drive_name: null,
      justificatif_drive_url: null,
      justificatif_drive_mime_type: null,
      justificatif_drive_linked_at: null,
      updated_at: nowIso,
    };

    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...patch } : a));

    const { error } = await supabase
      .from("invest_mission_actions")
      .update(patch)
      .eq("id", action.id);

    if (error) { setError(error.message); charger(); return; }

    // On retire aussi le lien de la table Drive de l'application.
    // Le fichier Google Drive lui-même n'est pas supprimé.
    if (previousFileId) {
      try {
        await supabase
          .from("invest_drive_links")
          .delete()
          .eq("folder", `clients/${client.id}/mission/${action.id}`)
          .eq("file_id", previousFileId);
      } catch {}
    }
    // Si la pièce vient de l'ordinateur, on supprime aussi le fichier stocké dans Supabase Storage.
    // Si elle vient de Google Drive, le fichier Drive n'est jamais supprimé.
    if (previousLocal?.bucket && previousLocal?.path) {
      try { await supabase.storage.from(previousLocal.bucket).remove([previousLocal.path]); } catch {}
    }
  };

  const notifyActionByEmail = async (action) => {
    if (!action) return;
    setError("");
    let email = action.responsable_email || missionEmailForOwner(action.responsable, client);
    if (!email && action.responsable) {
      const asked = window.prompt(`Aucun email n’est renseigné pour ${action.responsable}.\nIndique l’email à utiliser pour cet envoi :`, "");
      if (!asked) return;
      if (!missionLooksLikeEmail(asked)) {
        setError("Email invalide. Vérifie le format de l’adresse email.");
        return;
      }
      email = asked.trim();
      missionRememberOwnerEmail(action.responsable, email);
      await supabase
        .from("invest_mission_actions")
        .update({ responsable_email: email, updated_at:new Date().toISOString() })
        .eq("client_id", client.id)
        .eq("responsable", action.responsable);
      setActions(prev => prev.map(a => a.responsable === action.responsable ? { ...a, responsable_email: email } : a));
    }
    const { subject, body, htmlBody, actionUrl } = missionBuildNotificationEmail({ ...action, responsable_email: email }, client);
    const preparingPatch = {
      responsable_email: email || action.responsable_email || null,
      notification_status: email ? "envoi_en_cours" : "bloque_sans_email",
      notification_subject: subject,
      notification_body: body,
      notification_prepared_at: new Date().toISOString(),
      notification_count: Number(action.notification_count || 0) + 1,
      notification_error: email ? null : "Aucun email renseigné pour le responsable",
      updated_at: new Date().toISOString(),
    };
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...preparingPatch } : a));

    if (!email) {
      await supabase.from("invest_mission_actions").update(preparingPatch).eq("id", action.id);
      setError("Aucun email n'est renseigné pour ce responsable.");
      return;
    }

    const { data, error } = await supabase.functions.invoke("send-mission-email", {
      body: {
        actionId: action.id,
        clientId: client.id,
        to: email,
        subject,
        body,
        responsable: action.responsable || "",
        clientName: missionClientDisplayName(client),
        senderEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
        fromEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
        htmlBody,
        actionUrl,
      },
    });

    let edgeDetail = "";
    if (error?.context) {
      try {
        const txt = await error.context.text();
        if (txt) {
          try {
            const parsed = JSON.parse(txt);
            edgeDetail = parsed?.error || parsed?.message || parsed?.hint || txt;
          } catch {
            edgeDetail = txt;
          }
        }
      } catch {}
    }

    if (error || data?.error) {
      const msg = data?.error || edgeDetail || error?.message || "Erreur inconnue lors de l'envoi Gmail";
      const failPatch = {
        responsable_email: email,
        notification_status: "erreur_envoi",
        notification_error: msg,
        updated_at: new Date().toISOString(),
      };
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...failPatch } : a));
      await supabase.from("invest_mission_actions").update(failPatch).eq("id", action.id);
      setError(msg);
      return;
    }

    const sentPatch = {
      responsable_email: email,
      notification_status: "envoyee",
      notification_subject: subject,
      notification_body: body,
      notification_prepared_at: preparingPatch.notification_prepared_at,
      notification_sent_at: data?.sentAt || new Date().toISOString(),
      notification_error: null,
      gmail_message_id: data?.gmailMessageId || null,
      updated_at: new Date().toISOString(),
    };
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...sentPatch } : a));
  };
  const addActionToAgenda = async (action) => {
    if (!action) return;
    setError("");
    let email = action.responsable_email || missionEmailForOwner(action.responsable, client);
    if (!email && action.responsable) {
      const asked = window.prompt(`Aucun email n’est renseigné pour ${action.responsable}.
Indique l’email Google Agenda à utiliser :`, "");
      if (!asked) return;
      if (!missionLooksLikeEmail(asked)) {
        setError("Email invalide. Vérifie le format de l’adresse email Google Agenda.");
        return;
      }
      email = asked.trim();
      missionRememberOwnerEmail(action.responsable, email);
      await supabase
        .from("invest_mission_actions")
        .update({ responsable_email: email, updated_at:new Date().toISOString() })
        .eq("client_id", client.id)
        .eq("responsable", action.responsable);
      setActions(prev => prev.map(a => a.responsable === action.responsable ? { ...a, responsable_email: email } : a));
    }

    if (!email) {
      setError("Aucun email Google Agenda n'est renseigné pour ce responsable.");
      return;
    }

    const defaultDate = action.calendar_date || action.due_date || today;
    const askedDate = window.prompt(
      `Jour à ajouter à l'agenda pour :
${missionClientDisplayName(client)} — ${action.step_label || "Mission"}
${action.action_title || "Action"}

Format attendu : AAAA-MM-JJ`,
      defaultDate,
    );
    if (!askedDate) return;
    const calendarDate = askedDate.trim();
    if (!missionLooksLikeIsoDate(calendarDate)) {
      setError("Date invalide. Utilise le format AAAA-MM-JJ, par exemple 2026-06-12.");
      return;
    }

    const askedTime = window.prompt(
      `Heure facultative au format HH:MM.
Laisse vide pour créer un événement en journée entière.`,
      action.calendar_time || "",
    );
    if (askedTime === null) return;
    const calendarTime = String(askedTime || "").trim();
    if (calendarTime && !missionLooksLikeHour(calendarTime)) {
      setError("Heure invalide. Utilise le format HH:MM, par exemple 09:30, ou laisse vide pour une journée entière.");
      return;
    }

    const calendarEvent = missionBuildCalendarEvent({ ...action, responsable_email:email }, client, { calendarDate, calendarTime });
    const preparingPatch = {
      responsable_email: email,
      due_date: action.due_date || calendarDate,
      calendar_date: calendarDate,
      calendar_time: calendarTime || null,
      calendar_status: "creation_en_cours",
      calendar_error: null,
      calendar_prepared_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...preparingPatch } : a));
    const { error: prepareError } = await supabase.from("invest_mission_actions").update(preparingPatch).eq("id", action.id);
    if (prepareError) {
      setError(prepareError.message);
      charger();
      return;
    }

    const { data, error } = await supabase.functions.invoke("create-mission-calendar-event", {
      body: {
        actionId: action.id,
        clientId: client.id,
        calendarEmail: email,
        responsable: action.responsable || "",
        clientName: missionClientDisplayName(client),
        missionLabel: action.step_label || "Mission client",
        actionTitle: action.action_title || "Action mission",
        summary: calendarEvent.summary,
        description: calendarEvent.description,
        dueDate: calendarEvent.dueDate,
        endDate: calendarEvent.endDate,
        calendarDate: calendarEvent.calendarDate,
        calendarTime: calendarEvent.calendarTime,
        startTime: calendarEvent.startTime,
        endTime: calendarEvent.endTime,
        hasTime: calendarEvent.hasTime,
        timeZone: calendarEvent.timeZone,
        sourceEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
        automationEmail: MISSION_AUTOMATION_ACCOUNT_EMAIL,
      },
    });

    let edgeDetail = "";
    if (error?.context) {
      try {
        const txt = await error.context.text();
        if (txt) {
          try {
            const parsed = JSON.parse(txt);
            edgeDetail = parsed?.error || parsed?.message || parsed?.hint || txt;
          } catch {
            edgeDetail = txt;
          }
        }
      } catch {}
    }

    if (error || data?.error) {
      const msg = data?.error || edgeDetail || error?.message || "Erreur inconnue lors de la création Google Agenda";
      const failPatch = {
        calendar_status: "erreur_creation",
        calendar_error: msg,
        updated_at: new Date().toISOString(),
      };
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...failPatch } : a));
      await supabase.from("invest_mission_actions").update(failPatch).eq("id", action.id);
      setError(msg);
      return;
    }

    const donePatch = {
      calendar_status: "cree",
      calendar_date: data?.calendarDate || calendarDate,
      calendar_time: data?.calendarTime || calendarTime || null,
      calendar_event_id: data?.eventId || null,
      calendar_html_link: data?.htmlLink || null,
      calendar_created_at: data?.createdAt || new Date().toISOString(),
      calendar_error: null,
      updated_at: new Date().toISOString(),
    };
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, ...donePatch } : a));
    await supabase.from("invest_mission_actions").update(donePatch).eq("id", action.id);
    if (donePatch.calendar_html_link) window.open(donePatch.calendar_html_link, "_blank");
  };

  const syncNextAction = async () => {
    const next = actions.filter(a => !missionActionDone(a)).sort((a,b)=>String(a.due_date||"9999").localeCompare(String(b.due_date||"9999")))[0];
    if (!next) return;
    const { error } = await supabase.from("invest_clients").update({ prochaine_action: next.action_title, date_prochaine_action: next.due_date || null }).eq("id", client.id);
    if (error) setError(error.message); else onClientUpdated?.();
  };

  return (
    <div className="inv-card">
      <input
        ref={missionJustificatifFileRef}
        type="file"
        style={{ display:"none" }}
        onChange={handleMissionJustificatifComputerFile}
      />
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13} strokeWidth={2.2}/>Parcours Mission & automatisations <span style={{fontSize:10,fontWeight:900,letterSpacing:.6,background:"rgba(37,99,235,.12)",color:"#2563eb",border:"1px solid rgba(37,99,235,.25)",borderRadius:99,padding:"2px 6px"}}>V12.15 validation action CRM + historique prospect</span></span>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button className="inv-btn inv-btn-sm" style={{background:"rgba(255,255,255,.65)",color:"black",border:`1px solid ${T.border}`}} onClick={() => genererActions(selected.key)} disabled={saving}>＋ Générer étape</button>
          <button className="inv-btn inv-btn-sm" style={{background:"rgba(255,255,255,.65)",color:"black",border:`1px solid ${T.border}`}} onClick={genererTout} disabled={saving}>Tout générer</button>
        </div>
      </div>
      <div className="inv-card-bd">
        {error && <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,background:"#fff1f2",border:"1px solid #fecdd3",color:"#be123c",fontSize:12}}>⚠ {error}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          {[ ["Progression", `${stats.progress}%`], ["Actions", `${stats.done}/${stats.total}`], ["En retard", stats.late], ["Cette semaine", stats.week] ].map(([l,v]) => (
            <div key={l} style={{border:`1px solid ${T.border}`,background:T.input,borderRadius:10,padding:"8px 10px"}}>
              <div style={{fontSize:10,color:T.textMuted,fontWeight:800,textTransform:"uppercase",letterSpacing:.8}}>{l}</div>
              <div style={{fontSize:16,color:l==="En retard" && Number(v)>0 ? "#dc2626" : T.text,fontWeight:900,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1.1fr .9fr",gap:10,marginBottom:12}}>
          <div style={{padding:"9px 10px",borderRadius:10,background:"#f8fafc",border:"1px solid #e5e7eb"}}>
            <div style={{fontSize:10,color:T.textMuted,fontWeight:800,textTransform:"uppercase",letterSpacing:.8,marginBottom:3}}>Prochaine action mission</div>
            <div style={{fontSize:13,color:T.text,fontWeight:800}}>{stats.next?.action_title || "Aucune action en attente"}</div>
            {stats.next && <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{stats.next.responsable || "—"} · échéance {stats.next.due_date ? new Date(stats.next.due_date).toLocaleDateString("fr-FR") : "—"}</div>}
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,flexWrap:"wrap",padding:"9px 10px",borderRadius:10,background:"#f8fafc",border:"1px solid #e5e7eb"}}>
            <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={syncNextAction} disabled={!stats.next}>Synchroniser prochaine action</button>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:6,paddingBottom:8,marginBottom:8,maxWidth:"100%"}}>
          {MISSION_STEPS_INVEST.map((s, idx) => {
            const p = stepProgress(s.key);
            const active = selected.key === s.key;
            const notGenerated = p.total === 0;
            const remaining = Math.max(0, p.total - p.done);
            const isComplete = p.total > 0 && remaining === 0;
            const hasPendingTasks = p.total > 0 && remaining > 0;
            const stepBorder = active ? T.accent : T.border;
            const stepBg = active ? T.accentBg : T.input;
            const stepNumberColor = active ? T.accent : T.textMuted;
            const labelColor = hasPendingTasks ? "#dc2626" : active ? T.accent : T.text;
            const badgeColor = hasPendingTasks ? "#dc2626" : isComplete ? "#16a34a" : T.textMuted;
            const progressColor = isComplete ? "#16a34a" : hasPendingTasks ? "#dc2626" : T.textMuted;
            return (
              <button key={s.key} onClick={() => setSelectedStep(s.key)} style={{
                minWidth:0,padding:"8px 9px",borderRadius:10,cursor:"pointer",
                border:`1px solid ${stepBorder}`,
                background:stepBg,color:T.text,
                textAlign:"left",
                boxShadow:"none",
              }}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                  <div style={{fontSize:10,fontWeight:950,color:stepNumberColor}}>#{idx+1}</div>
                  <div style={{fontSize:9.5,fontWeight:950,color:badgeColor,border:`1px solid ${badgeColor}33`,background:"#fff",borderRadius:999,padding:"1px 6px",whiteSpace:"nowrap"}}>
                    {isComplete ? "OK" : notGenerated ? "à générer" : `${remaining} tâche${remaining > 1 ? "s" : ""}`}
                  </div>
                </div>
                <div style={{fontSize:11,fontWeight:950,color:labelColor,whiteSpace:"normal",overflow:"visible",textOverflow:"clip",lineHeight:1.2,minHeight:26,marginTop:3}}>{s.label}</div>
                <div style={{height:4,borderRadius:999,background:"rgba(0,0,0,.08)",overflow:"hidden",marginTop:6}}><div style={{height:"100%",width:`${p.pct}%`,background:progressColor}}/></div>
              </button>
            );
          })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,.95fr) minmax(360px,1.35fr)",gap:10,marginBottom:10,alignItems:"stretch"}}>
          <div style={{padding:"12px 13px",borderRadius:14,background:T.input,border:`1px solid ${T.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:15,fontWeight:950,color:T.text,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                  <span>{selected.label}</span>
                  {actionsStepLate.length > 0 && <span style={{fontSize:10,fontWeight:950,color:"#dc2626",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:999,padding:"2px 7px"}}>{actionsStepLate.length} retard</span>}
                </div>
                <div style={{fontSize:11,color:T.textMuted,lineHeight:1.55,marginTop:4}}>{selected.objectif}</div>
              </div>
              <span style={{fontSize:11,fontWeight:950,color:actionsStepTodo.length ? "#dc2626" : "#16a34a",background:actionsStepTodo.length ? "#fff1f2" : "#dcfce7",border:`1px solid ${actionsStepTodo.length ? "#fecdd3" : "#86efac"}`,borderRadius:999,padding:"4px 9px",whiteSpace:"nowrap"}}>
                {actionsStepTodo.length ? `${actionsStepTodo.length} à faire` : actionsStep.length ? "Étape OK" : "À générer"}
              </span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:10}}>
              <div style={{border:`1px solid ${T.border}`,background:"#fff",borderRadius:12,padding:"8px 9px"}}>
                <div style={{fontSize:9.5,color:T.textMuted,fontWeight:900,textTransform:"uppercase",letterSpacing:.7}}>Fait</div>
                <div style={{fontSize:15,fontWeight:950,color:"#16a34a",marginTop:2}}>{actionsStep.filter(missionActionDone).length}/{actionsStep.length || selected.actions.length}</div>
              </div>
              <div style={{border:`1px solid ${T.border}`,background:"#fff",borderRadius:12,padding:"8px 9px"}}>
                <div style={{fontSize:9.5,color:T.textMuted,fontWeight:900,textTransform:"uppercase",letterSpacing:.7}}>Restant</div>
                <div style={{fontSize:15,fontWeight:950,color:actionsStepTodo.length ? "#dc2626" : "#16a34a",marginTop:2}}>{actionsStepTodo.length}</div>
              </div>
              <div style={{border:`1px solid ${T.border}`,background:"#fff",borderRadius:12,padding:"8px 9px"}}>
                <div style={{fontSize:9.5,color:T.textMuted,fontWeight:900,textTransform:"uppercase",letterSpacing:.7}}>Pièces</div>
                <div style={{fontSize:15,fontWeight:950,color:actionsStepWithoutPiece.length ? "#f59e0b" : T.text,marginTop:2}}>{actionsStepWithoutPiece.length}</div>
              </div>
            </div>
          </div>

          <div style={{padding:"12px 13px",borderRadius:14,background:"#f8fafc",border:"1px solid #e5e7eb",display:"flex",flexDirection:"column",gap:8,justifyContent:"center"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,fontWeight:950,color:T.text}}>Lecture rapide des actions</div>
                <div style={{fontSize:10.5,color:T.textMuted,marginTop:2}}>Filtrer l'étape pour voir uniquement ce qui reste à traiter.</div>
              </div>
              <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={syncNextAction} disabled={!stats.next}>Synchroniser prochaine action</button>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              {[
                ["a_traiter", `À traiter (${actionsStepTodo.length})`],
                ["retard", `Retard (${actionsStepLate.length})`],
                ["pieces", `Pièces (${actionsStepWithoutPiece.length})`],
                ["fait", `Fait (${actionsStep.filter(missionActionDone).length})`],
                ["tous", `Tous (${actionsStep.length})`],
              ].map(([key,label]) => (
                <button key={key} type="button" onClick={() => setActionFilter(key)} style={{border:`1px solid ${actionFilter === key ? T.accent : T.border}`,background:actionFilter === key ? T.accentBg : "#fff",color:actionFilter === key ? T.accent : T.textSub,borderRadius:999,padding:"5px 9px",fontSize:11,fontWeight:900,cursor:"pointer"}}>{label}</button>
              ))}
              <select className="inv-sel" value={responsableFilter} onChange={e => setResponsableFilter(e.target.value)} style={{fontSize:11,padding:"5px 8px",marginLeft:"auto"}}>
                <option value="">Tous responsables</option>
                {responsablesStep.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {loading ? <div style={{padding:16,textAlign:"center",color:T.textMuted}}>Chargement du parcours…</div> : actionsStep.length === 0 ? (
          <div style={{padding:18,textAlign:"center",border:`1px dashed ${T.border}`,borderRadius:14,color:T.textMuted,fontSize:13,background:"#f8fafc"}}>
            Aucune action générée pour cette étape. Clique sur “Générer étape” pour lancer le suivi.
          </div>
        ) : actionsStepFiltered.length === 0 ? (
          <div style={{padding:18,textAlign:"center",border:`1px dashed ${T.border}`,borderRadius:14,color:T.textMuted,fontSize:13,background:"#f8fafc"}}>
            Aucune tâche ne correspond au filtre sélectionné.
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:9,maxHeight:560,overflowY:"auto",paddingRight:2}}>
            {actionsStepFiltered.map(a => {
              const meta = missionStatusMeta(a.status);
              const isDone = missionActionDone(a);
              const isLate = !isDone && a.due_date && a.due_date < today;
              const needsPiece = !isDone && a.document_drive_attendu && !a.justificatif_drive_url;
              const isDeepLinkedAction = initialActionId && String(a.id) === String(initialActionId);
              return (
                <div
                  key={a.id}
                  ref={isDeepLinkedAction ? missionHighlightedActionRef : null}
                  id={`mission-action-${a.id}`}
                  style={{border:`1px solid ${isDeepLinkedAction ? T.accent : isLate ? "#fecdd3" : needsPiece ? "#fed7aa" : T.border}`,background:isDeepLinkedAction ? T.accentBg : isLate ? "#fff1f2" : "#fff",boxShadow:isDeepLinkedAction ? `0 0 0 3px ${T.accent}22` : "none",borderRadius:14,padding:"10px 11px",display:"flex",flexDirection:"column",gap:9}}
                >
                  <div style={{display:"flex",alignItems:"flex-start",gap:9}}>
                    <button onClick={() => updateAction(a, { status:a.status === "fait" ? "a_faire" : "fait" })} title="Marquer fait" style={{width:24,height:24,borderRadius:8,border:`1px solid ${meta.color}55`,background:a.status === "fait" ? "#dcfce7" : "#fff",color:meta.color,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:950,flexShrink:0}}>{a.status === "fait" ? "✓" : ""}</button>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                        <div style={{fontSize:13,fontWeight:950,color:isDone ? "#16a34a" : isLate ? "#dc2626" : T.text,lineHeight:1.35}}>{a.action_title}</div>
                        <span style={{fontSize:10,fontWeight:950,color:meta.color,background:`${meta.color}14`,border:`1px solid ${meta.color}35`,borderRadius:999,padding:"2px 7px",whiteSpace:"nowrap"}}>{meta.label}</span>
                        {isLate && <span style={{fontSize:10,fontWeight:950,color:"#dc2626",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:999,padding:"2px 7px"}}>En retard</span>}
                        {needsPiece && <span style={{fontSize:10,fontWeight:950,color:"#c2410c",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:999,padding:"2px 7px"}}>Pièce attendue</span>}
                      </div>
                      <div style={{fontSize:10.5,color:T.textMuted,marginTop:4,display:"flex",gap:8,flexWrap:"wrap",lineHeight:1.45}}>
                        <span>👤 {a.responsable || "Responsable à définir"}</span>
                        <span>📅 Échéance {a.due_date ? missionFormatDateFr(a.due_date) : "—"}</span>
                        {a.relance_rule && <span>🔔 {a.relance_rule}</span>}
                        {a.due_reminder_enabled !== false && !isDone && <span>⏱ Relance quotidienne</span>}
                        {a.last_reminder_sent_at && <span style={{color:"#2563eb",fontWeight:850}}>🔁 relancé le {missionFormatDateFr(a.last_reminder_sent_at)}</span>}
                        {a.completed_at && <span style={{color:"#16a34a",fontWeight:950}}>✅ fait le {missionFormatDateFr(a.completed_at)}</span>}
                        {a.justificatif_drive_url && <span style={{color:T.accent,fontWeight:850}}>📎 {a.justificatif_drive_name || "justificatif"}</span>}
                        {a.notification_prepared_at && <span style={{color:"#16a34a",fontWeight:850}}>✉️ {a.notification_sent_at ? `envoyé ${new Date(a.notification_sent_at).toLocaleDateString("fr-FR")}` : `préparé ${new Date(a.notification_prepared_at).toLocaleDateString("fr-FR")}`}</span>}
                        {a.calendar_created_at && <span style={{color:"#7c3aed",fontWeight:850}}>📅 agenda {missionFormatCalendarDateFr(a.calendar_date || a.due_date, a.calendar_time || "")}</span>}
                        {a.calendar_status === "erreur_creation" && <span style={{color:"#dc2626",fontWeight:850}}>📅 agenda erreur</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:7,alignItems:"center",paddingTop:8,borderTop:"1px solid rgba(15,23,42,.08)"}}>
                    <select className="inv-sel" value={a.status || "a_faire"} onChange={e => updateAction(a, { status:e.target.value })} style={{fontSize:11,padding:"6px 7px"}}>{MISSION_STATUTS_ACTION.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                    <select className="inv-sel" value={a.responsable || ""} onChange={e => updateAction(a, { responsable:e.target.value || null, responsable_email:missionEmailForOwner(e.target.value, client) || null })} style={{fontSize:11,padding:"6px 7px"}}><option value="">Responsable</option>{MISSION_COLLABORATEURS.map(o => <option key={o}>{o}</option>)}</select>
                    <input className="inv-inp" type="date" title="Date échéance de la tâche" value={a.due_date || ""} onChange={e => updateAction(a, { due_date:e.target.value || null })} style={{fontSize:11,padding:"6px 7px",width:"100%"}}/>
                    {a.document_drive_attendu ? (
                      a.justificatif_drive_url ? (
                        <div style={{display:"flex",gap:5,alignItems:"center",justifyContent:"flex-start",flexWrap:"wrap",minWidth:0}}>
                          <button className="inv-btn inv-btn-sm" onClick={() => openMissionJustificatif(a)} title="Ouvrir la pièce justificative liée" style={{fontSize:11,padding:"6px 8px",background:"#dcfce7",border:"1px solid #86efac",color:"black",justifyContent:"center",minWidth:0}}><Icon as={ExternalLink} size={12}/> Ouvrir</button>
                          <button className="inv-btn inv-btn-sm" onClick={() => removeMissionJustificatif(a)} title="Supprimer le lien de la pièce justificative" style={{fontSize:11,padding:"6px 8px",background:"#fff1f2",border:"1px solid #fecdd3",color:"black",justifyContent:"center",minWidth:0}}><Icon as={Trash2} size={12}/> Supprimer</button>
                        </div>
                      ) : (
                        <div style={{display:"flex",gap:5,alignItems:"center",justifyContent:"flex-start",flexWrap:"wrap",minWidth:0}}>
                          <button className="inv-btn inv-btn-sm" onClick={() => chooseMissionJustificatifFromComputer(a)} title="Ajouter une pièce justificative depuis l’ordinateur" style={{fontSize:11,padding:"6px 8px",background:"#fff7ed",border:"1px solid #fed7aa",color:"black",justifyContent:"center",minWidth:0}}><Icon as={Upload} size={12}/> Ordinateur</button>
                          <button className="inv-btn inv-btn-sm" onClick={() => addMissionJustificatifFromDrive(a)} title="Ajouter une pièce justificative depuis Google Drive" style={{fontSize:11,padding:"6px 8px",background:"#eff6ff",border:"1px solid #bfdbfe",color:"black",justifyContent:"center",minWidth:0}}>Drive</button>
                        </div>
                      )
                    ) : <span style={{fontSize:11,color:T.textMuted}}>Aucune pièce attendue</span>}
                    <div style={{display:"flex",gap:5,alignItems:"center",justifyContent:"flex-start",flexWrap:"wrap",minWidth:0}}>
                      <button className="inv-btn inv-btn-sm" onClick={() => notifyActionByEmail(a)} title={a.responsable_email || missionEmailForOwner(a.responsable, client) ? `Envoyer un email automatique à ${a.responsable_email || missionEmailForOwner(a.responsable, client)}` : "Impossible d’envoyer : aucun email responsable"} style={{fontSize:11,padding:"6px 8px",background:a.notification_sent_at ? "#dcfce7" : a.notification_status === "envoi_en_cours" ? "#dbeafe" : "#fff",border:`1px solid ${a.notification_sent_at ? "#86efac" : a.notification_status === "envoi_en_cours" ? "#93c5fd" : T.border}`,color:"black",justifyContent:"center",minWidth:0}}><Icon as={Mail} size={12}/> Mail</button>
                      <button className="inv-btn inv-btn-sm" onClick={() => addActionToAgenda(a)} title={a.responsable_email || missionEmailForOwner(a.responsable, client) ? `Choisir le jour / l’heure et ajouter cette action à l’agenda Google de ${a.responsable_email || missionEmailForOwner(a.responsable, client)}` : "Impossible d’ajouter à l’agenda : aucun email responsable"} style={{fontSize:11,padding:"6px 8px",background:a.calendar_created_at ? "#ede9fe" : a.calendar_status === "creation_en_cours" ? "#fef3c7" : "#fff",border:`1px solid ${a.calendar_created_at ? "#c4b5fd" : a.calendar_status === "creation_en_cours" ? "#fcd34d" : T.border}`,color:"black",justifyContent:"center",minWidth:0}}><Icon as={Calendar} size={12}/> Agenda</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


function FicheClient({ id, profil, onRetour, T=THEMES_INV.dark, onOuvrirSimulation, onOpenStructuration, onOpenBien, initialMissionStep="", initialMissionActionId="" }) {
  const [client, setClient]   = useState(null);
  const [notes, setNotes]     = useState([]);
  const [props, setProps]     = useState([]);
  const [biens, setBiens]     = useState([]); // liste des biens du stock pour la modale "Proposer un bien"
  const [simulations, setSimulations] = useState([]); // simulations liées à ce client
  const [showEdit, setShowEdit] = useState(false);
  const [newNote, setNewNote] = useState({ type:"commentaire", contenu:"" });
  const [noteFilter, setNoteFilter] = useState("tous");
  const [savingNote, setSavingNote] = useState(false);
  const [savingCrmAction, setSavingCrmAction] = useState(false);
  const [crmPointEtape, setCrmPointEtape] = useState({ label:"", date:"" });
  const [collaboratorTask, setCollaboratorTask] = useState({ title:"", owner:"", email:"", due_date:"" });
  const [assigningCollaboratorTask, setAssigningCollaboratorTask] = useState(false);
  const [showProp, setShowProp] = useState(false);
  const [newProp, setNewProp] = useState({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
  const [savingProp, setSavingProp] = useState(false);
  const [missionStageInfo, setMissionStageInfo] = useState({ key:"", label:"" });

  const charger = async () => {
    const [{ data: c }, { data: n }, { data: p }, { data: b }] = await Promise.all([
      supabase.from("invest_clients").select("*").eq("id", id).single(),
      supabase.from("invest_notes").select("*").eq("client_id", id).order("date", { ascending: false }),
      supabase.from("invest_propositions").select("*, bien:invest_biens(id,adresse,ville,statut)").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("invest_biens").select("id,adresse,ville,code_postal,statut,prix_vente,prix_travaux,cout_total,montant_offre,rendement_brut,cashflow_estime,visite_data").order("adresse"),
    ]);
    setClient(c); setNotes(n||[]); setProps(p||[]); setBiens(b||[]);
    const strat = clientStrategy(c || {});
    setCrmPointEtape({
      label: strat.crm_next_stage_label || strat.crm_next_stage || "",
      date: strat.crm_next_stage_date || "",
    });

    // Charge les simulations liées à ce client. Tente avec client_id ; si la
    // colonne n'existe pas (42703), on désactive la section silencieusement.
    const sRes = await supabase.from("invest_projets")
      .select("id,nom,created_by,created_at,updated_at,donnees,client_id")
      .eq("client_id", id)
      .order("updated_at", { ascending:false });
    if (sRes.error?.code === "42703") {
      setSimulations([]); // colonne pas encore créée — on cache la section
    } else {
      setSimulations(sRes.data || []);
    }
  };
  useEffect(() => { charger(); setMissionStageInfo({ key:"", label:"" }); }, [id]);

  const updateClientPatch = async (patch) => {
    setClient(prev => prev ? { ...prev, ...patch } : prev);
    const { error } = await supabase.from("invest_clients").update(patch).eq("id", id);
    if (error) { alert("Impossible d'enregistrer : " + error.message); charger(); }
  };

  const saveCrmPointEtape = async (patch = {}) => {
    const nextPoint = { ...crmPointEtape, ...patch };
    setCrmPointEtape(nextPoint);
    const nextData = {
      ...clientStrategy(client),
      crm_next_stage_label: String(nextPoint.label || "").trim(),
      crm_next_stage_date: nextPoint.date || null,
    };
    setClient(prev => prev ? { ...prev, strategie_data:nextData } : prev);
    const { error } = await supabase.from("invest_clients").update({ strategie_data:nextData }).eq("id", id);
    if (error) { alert("Impossible d'enregistrer le point d'étape : " + error.message); charger(); }
  };

  const setCrmActionQuick = async (label, days = 2) => {
    const due = missionAddDaysIso(days);
    await updateClientPatch({ prochaine_action:label, date_prochaine_action:due });
  };

  const setCrmActionDueQuick = async (days = 0) => {
    await updateClientPatch({ date_prochaine_action:missionAddDaysIso(days) });
  };

  const assignerTacheCollaborateur = async () => {
    const title = String(collaboratorTask.title || "").trim();
    const owner = String(collaboratorTask.owner || "").trim();
    const email = String(collaboratorTask.email || "").trim();
    const due = String(collaboratorTask.due_date || "").trim();
    if (!title) { alert("Indique l'objet de la tâche collaborateur."); return; }
    if (!email || !missionLooksLikeEmail(email)) { alert("Indique un email collaborateur valide."); return; }
    setAssigningCollaboratorTask(true);
    const auteur = profil?.nom || profil?.email || "Profero";
    const clientUrl = (() => {
      try {
        if (typeof window === "undefined") return "";
        const url = new URL(window.location.href);
        url.searchParams.set("page", "crm");
        url.searchParams.set("crm_client", String(id));
        url.searchParams.set("crm_focus", "suivi_actions");
        url.hash = "suivi-actions";
        return url.toString();
      } catch { return ""; }
    })();
    const subject = `[Profero Invest] Tâche client — ${title}`;
    const body = [
      `Bonjour ${owner || ""},`,
      "",
      "Une tâche client t'est assignée depuis la fiche CRM Profero Invest.",
      "",
      `Client : ${clientFullName}`,
      `Tâche : ${title}`,
      due ? `Échéance : ${fmtDate(due)}` : null,
      clientUrl ? `Ouvrir la fiche client : ${clientUrl}` : null,
      "",
      "Merci de traiter cette tâche ou de faire un retour dans l'application.",
      "",
      "Profero Invest",
    ].filter(Boolean).join("\n");
    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <div style="background:#111827;color:#ffffff;padding:18px 22px;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9a34a;font-weight:700;">Profero Invest</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px;">Tâche client assignée</div>
          </div>
          <div style="padding:22px;">
            <p style="margin:0 0 14px;">Bonjour ${missionEscapeHtml(owner || "")},</p>
            <p style="margin:0 0 18px;">Une tâche client t'est assignée depuis la fiche CRM Profero Invest.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#64748b;width:135px;">Client</td><td style="padding:8px 0;font-weight:700;">${missionEscapeHtml(clientFullName)}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Tâche</td><td style="padding:8px 0;font-weight:700;">${missionEscapeHtml(title)}</td></tr>
              ${due ? `<tr><td style="padding:8px 0;color:#64748b;">Échéance</td><td style="padding:8px 0;font-weight:700;color:#dc2626;">${missionEscapeHtml(fmtDate(due))}</td></tr>` : ""}
            </table>
            ${clientUrl ? `<a href="${missionEscapeHtml(clientUrl)}" style="display:inline-block;background:#c9a34a;color:#111827;text-decoration:none;font-weight:800;border-radius:999px;padding:12px 18px;">Ouvrir la fiche client</a>` : ""}
          </div>
        </div>
      </div>
    `;

    const { data, error } = await supabase.functions.invoke("send-mission-email", {
      body: {
        clientId:id,
        to:email,
        subject,
        body,
        htmlBody,
        actionUrl:clientUrl,
        responsable:owner,
        clientName:clientFullName,
        senderEmail:MISSION_AUTOMATION_ACCOUNT_EMAIL,
        fromEmail:MISSION_AUTOMATION_ACCOUNT_EMAIL,
        notificationType:"crm_collaborator_task",
      },
    });

    if (error || data?.error) {
      setAssigningCollaboratorTask(false);
      alert("Impossible d'envoyer le mail collaborateur : " + (data?.error || error?.message || "erreur inconnue"));
      return;
    }

    await supabase.from("invest_notes").insert({
      client_id:id,
      auteur,
      type:"relance",
      contenu:[
        `📌 Tâche collaborateur assignée : ${title}`,
        owner ? `Collaborateur : ${owner}` : null,
        `Email : ${email}`,
        due ? `Échéance : ${fmtDate(due)}` : null,
        "Mail automatique envoyé au collaborateur.",
      ].filter(Boolean).join("\n"),
    });

    if (owner) missionRememberOwnerEmail(owner, email);
    setAssigningCollaboratorTask(false);
    setCollaboratorTask({ title:"", owner:"", email:"", due_date:"" });
    setNoteFilter("tous");
    charger();
  };

  const ajouterNote = async () => {
    if (!newNote.contenu.trim()) return;
    setSavingNote(true);
    await supabase.from("invest_notes").insert({ client_id: id, auteur: profil?.nom||"", type: newNote.type, contenu: newNote.contenu });
    setNewNote({ type:"commentaire", contenu:"" });
    setSavingNote(false);
    charger();
  };

  const ajouterProp = async () => {
    if (!newProp.bien_id) return;
    setSavingProp(true);
    await supabase.from("invest_propositions").insert({
      client_id: id,
      ...newProp,
      date_proposition: new Date().toISOString().slice(0,10),
    });
    setNewProp({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
    setSavingProp(false);
    setShowProp(false);
    charger();
  };

  const proposerBienDirect = async (bienId) => {
    if (!bienId) return;
    const { error } = await supabase.from("invest_propositions").insert({
      client_id: id,
      bien_id: bienId,
      statut: "proposé",
      commentaire: "Proposé depuis le matching automatique",
      lien_dossier: "",
      date_proposition: new Date().toISOString().slice(0,10),
    });
    if (error) alert("Impossible de proposer ce bien : " + error.message);
    else charger();
  };

  // Biens déjà proposés à ce client : on les marque pour les retirer/distinguer dans la modale
  const idsDejaProposes = new Set(props.map(p => p.bien?.id || p.bien_id).filter(Boolean));
  const biensDispo = biens.filter(b => !idsDejaProposes.has(b.id));

  const STATUT_COLORS = { Prospect:"#4db8ff", Actif:"#50c878", Inactif:"#FFC200", Terminé:"rgba(255,255,255,0.3)" };
  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" }) : "—";
  const fmtBudget = v => v > 0 ? new Intl.NumberFormat("fr-FR").format(v)+" €" : "—";
  const NOTE_ICONS = { appel:"📞", "rendez-vous":"🤝", relance:"🔔", commentaire:"💬", document:"📄", autre:"📝" };
  const NOTE_TONES = {
    appel: { label:"Appel", color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe", icon:"📞" },
    "rendez-vous": { label:"Rendez-vous", color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0", icon:"🤝" },
    relance: { label:"Relance", color:"#f59e0b", bg:"#fffbeb", border:"#fde68a", icon:"🔔" },
    commentaire: { label:"Commentaire", color:"#64748b", bg:"#f8fafc", border:"#e2e8f0", icon:"💬" },
    document: { label:"Document", color:T.accent, bg:T.accentBg || "#f8fafc", border:T.accentBorder || `${T.accent}33`, icon:"📄" },
    autre: { label:"Autre", color:"#7c3aed", bg:"#f5f3ff", border:"#ddd6fe", icon:"📝" },
  };
  const noteTone = (type) => NOTE_TONES[type] || NOTE_TONES.autre;

  const validerProchaineActionCrm = async () => {
    const action = String(client?.prochaine_action || "").trim();
    if (!action || savingCrmAction) return;
    setSavingCrmAction(true);
    const due = String(client?.date_prochaine_action || "").slice(0,10);
    const auteur = profil?.nom || profil?.email || "Profero";
    const contenu = [
      `✅ Action CRM validée : ${action}`,
      due ? `Échéance initiale : ${fmtDate(due)}` : null,
    ].filter(Boolean).join("\n");

    const [{ error: noteError }, { error: clientError }] = await Promise.all([
      supabase.from("invest_notes").insert({ client_id:id, auteur, type:"relance", contenu }),
      supabase.from("invest_clients").update({ prochaine_action:null, date_prochaine_action:null }).eq("id", id),
    ]);

    setSavingCrmAction(false);
    if (noteError || clientError) {
      alert("Impossible de valider l'action CRM : " + (noteError?.message || clientError?.message));
      charger();
      return;
    }
    setClient(prev => prev ? { ...prev, prochaine_action:null, date_prochaine_action:null } : prev);
    setNoteFilter("tous");
    charger();
  };

  if (!client) return <div style={{ textAlign:"center", padding:"60px", color:T.textMuted }}>Chargement…</div>;

  const ficheToday = new Date().toISOString().slice(0,10);
  const clientFullName = `${client.prenom || ""} ${client.nom || ""}`.trim() || "Client";
  const notesAffichees = noteFilter === "tous" ? notes : notes.filter(n => n.type === noteFilter);
  const derniereNote = notes[0] || null;
  const prochaineActionLate = client.date_prochaine_action && client.date_prochaine_action < ficheToday;
  const prochaineActionToday = client.date_prochaine_action && client.date_prochaine_action === ficheToday;
  const clientContact = [client.email, client.telephone].filter(Boolean).join(" · ") || "Coordonnées à compléter";

  return (
    <div style={{ padding:"24px 28px", maxWidth:1280, margin:"0 auto", width:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>← CRM</button>
        <div style={{ flex:"1 1 260px", minWidth:0 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text }}>{client.prenom} {client.nom}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>{client.email} {client.telephone ? `· ${client.telephone}` : ""}</div>
        </div>
        <span style={{ background:`${STATUT_COLORS[client.statut]}18`, color:STATUT_COLORS[client.statut], border:`1px solid ${STATUT_COLORS[client.statut]}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{client.statut}</span>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>
          <Icon as={Pencil} size={12} strokeWidth={2.2}/> Modifier
        </button>
        {onOpenStructuration && (
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOpenStructuration(client.id)}>
            <Icon as={Briefcase} size={12} strokeWidth={2.2}/> Structuration
          </button>
        )}
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ${client.prenom} ${client.nom} ? Cette action est irréversible.`)) return;
          await supabase.from("invest_notes").delete().eq("client_id", id);
          await supabase.from("invest_propositions").delete().eq("client_id", id);
          await supabase.from("invest_clients").delete().eq("id", id);
          onRetour();
        }}><Icon as={Trash2} size={12} strokeWidth={2.2}/> Supprimer</button>
      </div>

      <div className="inv-page-safe" style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:"100%", overflowX:"hidden" }}>
        {/* Synthèse client */}
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12,maxWidth:"100%"}}>
          <div className="inv-card" style={{overflow:"hidden"}}>
            <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>Synthèse client</span>
              <span style={{fontSize:10,fontWeight:900,color:T.accent,background:T.accentBg,border:`1px solid ${T.accent}33`,borderRadius:999,padding:"2px 7px"}}>{missionStageInfo.label || missionCurrentStepLabelFromActions([], client)}</span>
            </div>
            <div className="inv-card-bd">
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8,marginBottom:10}}>
                {[
                  ["Conseiller", client.conseiller || "—"],
                  ["Source", client.source || "—"],
                  ["Budget", fmtBudget(client.budget)],
                  ["Statut", client.statut || "—"],
                ].map(([label,value]) => (
                  <div key={label} style={{border:`1px solid ${T.border}`,background:"#f8fafc",borderRadius:12,padding:"9px 10px",minWidth:0}}>
                    <div style={{fontSize:9.5,color:T.textMuted,fontWeight:900,textTransform:"uppercase",letterSpacing:.8}}>{label}</div>
                    <div style={{fontSize:13,color:T.text,fontWeight:900,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:"0 18px",maxWidth:"100%"}}>
                <div className="inv-row"><span className="inv-lbl">Coordonnées</span><span className="inv-val" style={{textAlign:"right"}}>{clientContact}</span></div>
                <div className="inv-row" style={{alignItems:"center",gap:10}}>
                  <span className="inv-lbl">Date signature contrat</span>
                  <input
                    className="inv-inp"
                    type="date"
                    value={String(client.date_signature || "").slice(0,10)}
                    onChange={e => updateClientPatch({ date_signature:e.target.value || null })}
                    style={{maxWidth:180,textAlign:"left",padding:"6px 8px",fontSize:12}}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Parcours Mission en pleine largeur */}
        <MissionParcoursClientCard client={client} T={T} profil={profil} onClientUpdated={charger} onMissionStageChange={setMissionStageInfo} initialStepKey={initialMissionStep} initialActionId={initialMissionActionId} />

        {/* Suivi des actions CRM sous le parcours mission */}
          <div id="suivi-actions" className="inv-card" style={{overflow:"hidden",border:"1px solid #e5e7eb",boxShadow:"0 18px 42px rgba(15,23,42,.06)",background:"linear-gradient(135deg,#ffffff,#f8fafc)"}}>
            <div style={{padding:"14px 16px 0",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:9,minWidth:0}}>
                <span style={{width:28,height:28,borderRadius:12,display:"grid",placeItems:"center",background:"#fff7ed",color:"#d97706",border:"1px solid #fed7aa",flexShrink:0}}><Icon as={Bell} size={14} strokeWidth={2.2}/></span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:950,color:T.text,lineHeight:1.1}}>Suivi des actions</div>
                  <div style={{fontSize:10.5,color:T.textMuted,fontWeight:700,marginTop:3}}>Lecture horizontale : action commerciale, point d'étape et tâche collaborateur au même endroit.</div>
                </div>
              </div>
              <span style={{fontSize:10,fontWeight:950,color:prochaineActionLate ? "#dc2626" : prochaineActionToday ? "#d97706" : T.textMuted,background:prochaineActionLate ? "#fff1f2" : prochaineActionToday ? "#fffbeb" : "#f8fafc",border:`1px solid ${prochaineActionLate ? "#fecdd3" : prochaineActionToday ? "#fde68a" : T.border}`,borderRadius:999,padding:"3px 8px"}}>
                {prochaineActionLate ? "Action CRM en retard" : prochaineActionToday ? "Action CRM aujourd'hui" : "Suivi CRM"}
              </span>
            </div>

            <div className="inv-card-bd" style={{paddingTop:12}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(280px,1fr))",gap:12,overflowX:"auto",paddingBottom:2}}>
                <div style={{border:"1px solid #fed7aa",borderRadius:16,padding:12,background:"linear-gradient(135deg,#fff7ed,#ffffff)",minWidth:220}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
                    <Icon as={Bell} size={13} color="#92400e" strokeWidth={2.3}/>
                    <div style={{fontSize:13,fontWeight:950,color:T.text}}>Prochaine action</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 132px",gap:8,alignItems:"end"}}>
                    <div>
                      <label style={{fontSize:9.5,fontWeight:950,color:T.textMuted,textTransform:"uppercase",letterSpacing:.8,display:"block",marginBottom:5}}>Action à réaliser</label>
                      <input
                        className="inv-inp"
                        value={client.prochaine_action || ""}
                        placeholder="Écris librement l'action…"
                        onChange={e => setClient(prev => prev ? { ...prev, prochaine_action:e.target.value } : prev)}
                        onBlur={e => updateClientPatch({ prochaine_action:e.target.value || null })}
                        style={{width:"100%",textAlign:"left",fontSize:12.5,background:"#fff"}}
                      />
                    </div>
                    <div>
                      <label style={{fontSize:9.5,fontWeight:950,color:T.textMuted,textTransform:"uppercase",letterSpacing:.8,display:"block",marginBottom:5}}>Date</label>
                      <input
                        className="inv-inp"
                        type="date"
                        value={String(client.date_prochaine_action || "").slice(0,10)}
                        onChange={e => updateClientPatch({ date_prochaine_action:e.target.value || null })}
                        style={{width:"100%",fontSize:12,background:"#fff"}}
                      />
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:9}}>
                    {[
                      ["Appeler", "Appeler le client", 0],
                      ["Envoyer un message", "Envoyer un message au client", 0],
                      ["Programmer un RDV", "Programmer un rendez-vous client", 2],
                      ["Envoyer une proposition", "Envoyer une proposition au client", 2],
                      ["Relancer la proposition", "Relancer la proposition envoyée", 2],
                    ].map(([label, value, days]) => (
                      <button key={label} type="button" onClick={() => setCrmActionQuick(value, days)} style={{border:"1px solid #e5e7eb",background:"#fff",color:T.textSub,borderRadius:8,padding:"6px 8px",fontSize:10.5,fontWeight:950,cursor:"pointer"}}>{label}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginTop:9,flexWrap:"wrap"}}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {[["J",0],["J+2",2],["J+7",7],["J+15",15]].map(([label, days]) => (
                        <button key={label} type="button" onClick={() => setCrmActionDueQuick(days)} style={{border:"1px solid #d1d5db",background:"#fff",color:T.textSub,borderRadius:8,padding:"6px 9px",fontSize:10.5,fontWeight:950,cursor:"pointer"}}>{label}</button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="inv-btn inv-btn-blue inv-btn-sm"
                      onClick={validerProchaineActionCrm}
                      disabled={savingCrmAction || !String(client.prochaine_action || "").trim()}
                      style={{color:"black",whiteSpace:"nowrap",padding:"6px 10px"}}
                    >
                      <Icon as={Check} size={12} strokeWidth={2.3}/> {savingCrmAction ? "Validation…" : "Valider"}
                    </button>
                  </div>
                </div>

                <div style={{border:"1px solid #c4b5fd",borderRadius:16,padding:12,background:"linear-gradient(135deg,#f5f3ff,#ffffff)",minWidth:220}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
                    <Icon as={Calendar} size={13} color="#7c3aed" strokeWidth={2.3}/>
                    <div style={{fontSize:13,fontWeight:950,color:T.text}}>Prochain point d'étape</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 132px",gap:8,alignItems:"end"}}>
                    <div>
                      <label style={{fontSize:9.5,fontWeight:950,color:T.textMuted,textTransform:"uppercase",letterSpacing:.8,display:"block",marginBottom:5}}>Point d'étape client / prospect</label>
                      <input
                        className="inv-inp"
                        value={crmPointEtape.label || ""}
                        placeholder="Ex : décision, validation, offre…"
                        onChange={e => setCrmPointEtape(prev => ({...prev,label:e.target.value}))}
                        onBlur={e => saveCrmPointEtape({ label:e.target.value })}
                        style={{width:"100%",textAlign:"left",fontSize:12.5,background:"#fff"}}
                      />
                    </div>
                    <div>
                      <label style={{fontSize:9.5,fontWeight:950,color:T.textMuted,textTransform:"uppercase",letterSpacing:.8,display:"block",marginBottom:5}}>Date</label>
                      <input
                        className="inv-inp"
                        type="date"
                        value={crmPointEtape.date || ""}
                        onChange={e => saveCrmPointEtape({ date:e.target.value || "" })}
                        style={{width:"100%",fontSize:12,background:"#fff"}}
                      />
                    </div>
                  </div>
                  <div style={{fontSize:10.5,color:T.textMuted,lineHeight:1.45,marginTop:9}}>Sert à identifier le prochain vrai jalon de suivi, différent de la simple action à réaliser.</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                    {[
                      ["Décision client", 2],
                      ["Validation stratégie", 2],
                      ["Offre à faire", 3],
                      ["Financement", 7],
                      ["Signature", 15],
                    ].map(([label, days]) => (
                      <button key={label} type="button" onClick={() => saveCrmPointEtape({ label, date:missionAddDaysIso(days) })} style={{border:"1px solid #ddd6fe",background:"#fff",color:"#6d28d9",borderRadius:8,padding:"6px 8px",fontSize:10.5,fontWeight:950,cursor:"pointer"}}>{label}</button>
                    ))}
                  </div>
                </div>

                <div style={{border:"1px solid #bfdbfe",borderRadius:16,padding:12,background:"linear-gradient(135deg,#eff6ff,#ffffff)",minWidth:220}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
                    <Icon as={Send} size={13} color="#2563eb" strokeWidth={2.3}/>
                    <div style={{fontSize:13,fontWeight:950,color:T.text}}>Tâche collaborateur</div>
                  </div>
                  <div style={{display:"grid",gap:8}}>
                    <input
                      className="inv-inp"
                      value={collaboratorTask.title || ""}
                      placeholder="Objet de la tâche : ex : préparer les plans"
                      onChange={e => setCollaboratorTask(prev => ({...prev,title:e.target.value}))}
                      style={{width:"100%",textAlign:"left",fontSize:12.5,background:"#fff"}}
                    />
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <select
                        className="inv-sel"
                        value={collaboratorTask.owner || ""}
                        onChange={e => {
                          const owner = e.target.value;
                          setCollaboratorTask(prev => ({...prev,owner,email:missionEmailForOwner(owner, client) || prev.email || ""}));
                        }}
                        style={{width:"100%",fontSize:12,background:"#fff"}}
                      >
                        <option value="">Collaborateur</option>
                        {MISSION_COLLABORATEURS.map(o => <option key={o}>{o}</option>)}
                      </select>
                      <input
                        className="inv-inp"
                        value={collaboratorTask.email || ""}
                        placeholder="Email"
                        onChange={e => setCollaboratorTask(prev => ({...prev,email:e.target.value}))}
                        style={{width:"100%",textAlign:"left",fontSize:12,background:"#fff"}}
                      />
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"}}>
                      <input
                        className="inv-inp"
                        type="date"
                        value={collaboratorTask.due_date || ""}
                        onChange={e => setCollaboratorTask(prev => ({...prev,due_date:e.target.value}))}
                        style={{width:"100%",fontSize:12,background:"#fff"}}
                      />
                      <button className="inv-btn inv-btn-blue inv-btn-sm" type="button" onClick={assignerTacheCollaborateur} disabled={assigningCollaboratorTask} style={{color:"black",padding:"7px 11px"}}>
                        {assigningCollaboratorTask ? "Envoi…" : "Assigner"}
                      </button>
                    </div>
                    <div style={{fontSize:10.5,color:T.textMuted,lineHeight:1.45}}>Mail envoyé au collaborateur à la validation, puis ajout automatique dans l'historique.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:16, maxWidth:"100%", overflowX:"hidden" }}>
          {/* Colonne gauche */}
          <div className="inv-grid-safe" style={{ display:"flex", flexDirection:"column", gap:16, minWidth:0 }}>
            <ClientStrategyCard client={client} T={T} onSaved={charger} />

            {/* Propositions */}
            <div className="inv-card">
              <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>Biens proposés ({props.length})</span>
                <button className="inv-btn inv-btn-sm" style={{ background:T.accentBg, color:"black", border:`1px solid ${T.accentBorder}` }} onClick={() => setShowProp(true)}>＋ Proposer</button>
              </div>
              <div className="inv-card-bd">
                {props.length === 0 ? (
                  <div style={{ fontSize:13, color:"#9aa0b0", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>Aucun bien proposé</div>
                ) : props.map(p => {
                  const bienId = p.bien_id || p.bien?.id;
                  return (
                    <div key={p.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                      <button
                        type="button"
                        onClick={() => bienId && onOpenBien?.(bienId)}
                        disabled={!bienId || !onOpenBien}
                        title={bienId && onOpenBien ? "Ouvrir la fiche du bien" : "Fiche du bien indisponible"}
                        style={{
                          border:0,
                          background:"transparent",
                          padding:0,
                          margin:0,
                          fontWeight:700,
                          fontSize:13,
                          color:bienId && onOpenBien ? T.accent : T.text,
                          textAlign:"left",
                          cursor:bienId && onOpenBien ? "pointer" : "default",
                          display:"inline-flex",
                          alignItems:"center",
                          gap:5,
                        }}
                      >
                        <span>{p.bien?.adresse||"Bien"} {p.bien?.ville ? `— ${p.bien.ville}` : ""}</span>
                        {bienId && onOpenBien && <Icon as={ExternalLink} size={10} strokeWidth={2.2}/>} 
                      </button>
                      <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
                        {new Date(p.date_proposition).toLocaleDateString("fr-FR")} · <span style={{ fontWeight:600, color:T.accent }}>{p.statut}</span>
                        {p.commentaire && ` · ${p.commentaire}`}
                      </div>
                      {p.lien_dossier && <a href={p.lien_dossier} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent, display:"inline-flex", alignItems:"center", gap:3 }}><Icon as={FileText} size={10} strokeWidth={2.2}/> Dossier présenté <Icon as={ExternalLink} size={9}/></a>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Colonne droite : Documents puis Notes */}
          <div className="inv-grid-safe" style={{ display:"flex", flexDirection:"column", gap:16, minWidth:0 }}>
            <DocumentsSection folder={`clients/${id}`} T={T} />

            <div className="inv-card" style={{overflow:"hidden",border:`1px solid ${T.border}`,boxShadow:"0 18px 45px rgba(15,23,42,.06)"}}>
              <div className="inv-card-hd" style={{justifyContent:"space-between",gap:10,alignItems:"center",background:"linear-gradient(135deg,#ffffff,#f8fafc)",borderBottom:`1px solid ${T.border}`}}>
                <div style={{minWidth:0}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13} strokeWidth={2.2}/>Historique client ({notes.length})</span>
                  <div style={{fontSize:10.5,color:T.textMuted,fontWeight:700,marginTop:2,textTransform:"none",letterSpacing:0}}>Timeline des échanges, relances et actions validées</div>
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  {["tous", ...TYPES_NOTE].map(t => {
                    const active = noteFilter === t;
                    const tone = t === "tous" ? { label:"Tout", color:T.accent, bg:T.accentBg, border:T.accentBorder } : noteTone(t);
                    const count = t === "tous" ? notes.length : notes.filter(n => n.type === t).length;
                    return (
                      <button key={t} type="button" onClick={() => setNoteFilter(t)} style={{border:`1px solid ${active ? tone.color : T.border}`,background:active ? tone.bg : "#fff",color:active ? tone.color : T.textMuted,borderRadius:999,padding:"4px 8px",fontSize:10.5,fontWeight:950,cursor:"pointer",boxShadow:active ? `0 8px 18px ${tone.color}12` : "none"}}>
                        {tone.label || t} {count > 0 ? count : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="inv-card-bd" style={{background:"#f8fafc"}}>
                <div style={{marginBottom:14,padding:"13px 14px",background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",boxShadow:"0 10px 24px rgba(15,23,42,.04)"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,marginBottom:9,flexWrap:"wrap"}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:950,color:T.text,display:"flex",alignItems:"center",gap:7}}><span style={{width:24,height:24,borderRadius:9,display:"grid",placeItems:"center",background:T.accentBg,color:T.accent}}>＋</span> Ajouter un échange</div>
                      <div style={{fontSize:10.5,color:T.textMuted,marginTop:3}}>Même logique que la fiche prospect : une action claire, datée, rangée dans le journal.</div>
                    </div>
                    <select className="inv-sel" value={newNote.type} onChange={e=>setNewNote({...newNote,type:e.target.value})} style={{fontSize:12,padding:"6px 8px",background:noteTone(newNote.type).bg,border:`1px solid ${noteTone(newNote.type).border}`,color:noteTone(newNote.type).color,fontWeight:900}}>
                      {TYPES_NOTE.map(t=><option key={t}>{noteTone(t).label || t}</option>)}
                    </select>
                  </div>
                  <textarea className="inv-textarea" rows={3} placeholder={`Note pour ${clientFullName}…`} value={newNote.contenu}
                    onChange={e=>setNewNote({...newNote,contenu:e.target.value})} style={{background:"#fff"}}/>
                  <div style={{marginTop:8,display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {["appel", "relance", "rendez-vous", "document"].map(type => {
                        const tone = noteTone(type);
                        const active = newNote.type === type;
                        return (
                          <button key={type} type="button" onClick={() => setNewNote(prev => ({...prev, type}))} style={{border:`1px solid ${active ? tone.color : tone.border}`,background:active ? tone.bg : "#fff",color:active ? tone.color : T.textMuted,borderRadius:999,padding:"5px 9px",fontSize:11,fontWeight:950,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5}}>{tone.icon} {tone.label}</button>
                        );
                      })}
                    </div>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" style={{color:"black"}} onClick={ajouterNote} disabled={savingNote || !newNote.contenu.trim()}>
                      {savingNote ? "…" : "＋ Ajouter à l'historique"}
                    </button>
                  </div>
                </div>

                <div style={{position:"relative",maxHeight:560,overflowY:"auto",padding:"2px 2px 2px 0"}}>
                  {notesAffichees.length === 0 ? (
                    <div style={{fontSize:13,color:"#9aa0b0",fontStyle:"italic",textAlign:"center",padding:"28px 0",border:`1px dashed ${T.border}`,borderRadius:16,background:"#fff"}}>
                      Aucun échange dans ce filtre.
                    </div>
                  ) : notesAffichees.map((n, idx) => {
                    const tone = noteTone(n.type);
                    const isCrmValidation = String(n.contenu || "").includes("Action CRM validée");
                    return (
                      <div key={n.id} style={{position:"relative",display:"grid",gridTemplateColumns:"36px 1fr",gap:10,paddingBottom:idx === notesAffichees.length - 1 ? 0 : 12}}>
                        <div style={{position:"relative",display:"flex",justifyContent:"center"}}>
                          {idx !== notesAffichees.length - 1 && <div style={{position:"absolute",top:34,bottom:-12,width:2,background:"#e5e7eb",borderRadius:99}}/>}
                          <div style={{width:32,height:32,borderRadius:12,background:tone.bg,border:`1px solid ${tone.border}`,color:tone.color,display:"grid",placeItems:"center",fontSize:15,fontWeight:950,zIndex:1,boxShadow:"0 8px 20px rgba(15,23,42,.06)"}}>{isCrmValidation ? "✅" : tone.icon}</div>
                        </div>
                        <div style={{border:`1px solid ${isCrmValidation ? "#bbf7d0" : T.border}`,borderLeft:`4px solid ${isCrmValidation ? "#16a34a" : tone.color}`,background:"#fff",borderRadius:16,padding:"11px 12px",boxShadow:"0 10px 24px rgba(15,23,42,.045)"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                            <span style={{fontSize:10.5,fontWeight:950,color:isCrmValidation ? "#16a34a" : tone.color,textTransform:"uppercase",letterSpacing:.7,background:isCrmValidation ? "#f0fdf4" : tone.bg,border:`1px solid ${isCrmValidation ? "#bbf7d0" : tone.border}`,borderRadius:999,padding:"2px 8px"}}>{isCrmValidation ? "Action validée" : tone.label}</span>
                            <span style={{fontSize:11,color:T.textMuted,marginLeft:"auto",fontWeight:750}}>
                              {new Date(n.date).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})} · {n.auteur||"—"}
                            </span>
                          </div>
                          <div style={{fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.contenu}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>          </div>
        </div>
      </div>

      {showEdit && <FormulaireClient client={client} profil={profil} T={T} onSave={() => { setShowEdit(false); charger(); }} onClose={() => setShowEdit(false)} />}

      {showProp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"24px 26px", width:"90%", maxWidth:440 }}>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:16 }}>Proposer un bien à {client.prenom} {client.nom}</div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Bien</label>
              <select className="inv-sel" value={newProp.bien_id} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,bien_id:e.target.value})}>
                <option value="">Sélectionner un bien…</option>
                {biensDispo.length === 0 && (
                  <option value="" disabled>Tous les biens ont déjà été proposés</option>
                )}
                {biensDispo.map(b=>(
                  <option key={b.id} value={b.id}>
                    {b.adresse || "(sans adresse)"}{b.ville ? ` — ${b.ville}` : ""}{b.statut ? ` · ${b.statut}` : ""}
                  </option>
                ))}
              </select>
              {biens.length === 0 && (
                <div style={{ fontSize:11, color:T.textMuted, marginTop:6, fontStyle:"italic" }}>
                  Aucun bien dans le stock. Ajoute d'abord un bien depuis l'onglet « Stock de biens ».
                </div>
              )}
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Statut</label>
              <select className="inv-sel" value={newProp.statut} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,statut:e.target.value})}>
                {STATUTS_PROP.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Commentaire</label>
              <textarea className="inv-textarea" rows={2} value={newProp.commentaire} onChange={e=>setNewProp({...newProp,commentaire:e.target.value})}/>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Lien dossier présenté</label>
              <input className="inv-inp" value={newProp.lien_dossier} style={{ width:"100%", textAlign:"left" }} onChange={e=>setNewProp({...newProp,lien_dossier:e.target.value})} placeholder="https://…"/>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button className="inv-btn inv-btn-out" onClick={() => { setShowProp(false); setNewProp({ bien_id:"", statut:"proposé", commentaire:"", lien_dossier:"" }); }}>Annuler</button>
              <button className="inv-btn inv-btn-blue" onClick={ajouterProp} disabled={savingProp||!newProp.bien_id}>{savingProp?"…":"Proposer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STOCK DE BIENS ───────────────────────────────────────────────────────────

export default CRM;
export { CRM, FormulaireClient, FicheClient, MissionParcoursClientCard };
