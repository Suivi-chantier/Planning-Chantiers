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

const DASH_CLIENT_STATUS_CONFIG = [
  { statut:"Prospect", label:"Prospects", color:"#4db8ff", icon:Users },
  { statut:"Actif", label:"Clients actifs", color:SU, icon:Check },
  { statut:"Inactif", label:"Clients inactifs", color:WA, icon:Bell },
  { statut:"Terminé", label:"Terminés", color:"rgba(255,255,255,0.38)", icon:Lock },
];
const DASH_STAT_KEY = { Prospect:"prospects", Actif:"actifs", Inactif:"inactifs", Terminé:"termines" };

function ClientsStatutsBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenStatus }) {
  const [dragOverStatut, setDragOverStatut] = useState("");
  const fmtBudgetClient = (v) => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(v) + " €" : "—";
  const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "—";
  const clientsParStatut = DASH_CLIENT_STATUS_CONFIG.reduce((acc, cfg) => {
    acc[cfg.statut] = clients.filter(c => (c.statut || "Prospect") === cfg.statut)
      .sort((a,b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr", { sensitivity:"base" }));
    return acc;
  }, {});

  return (
    <div className="inv-card" style={{ marginBottom:SPACING.xxl-2 }}>
      <div className="inv-card-hd blue" style={{ alignItems:"center" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          <Icon as={LayoutGrid} size={13} strokeWidth={2.2}/>
          Statuts clients — pilotage rapide
        </span>
        <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:600 }}>
          Glisser-déposer un client pour changer son statut
        </span>
      </div>
      <div className="inv-card-bd">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(230px,1fr))", gap:SPACING.md, overflowX:"auto", paddingBottom:2 }}>
          {DASH_CLIENT_STATUS_CONFIG.map(cfg => {
            const list = clientsParStatut[cfg.statut] || [];
            const isOver = dragOverStatut === cfg.statut;
            const IconComp = cfg.icon;
            return (
              <div key={cfg.statut}
                onDragOver={e=>{ e.preventDefault(); setDragOverStatut(cfg.statut); }}
                onDragLeave={()=>setDragOverStatut("")}
                onDrop={e=>{
                  e.preventDefault();
                  const clientId = e.dataTransfer.getData("text/plain");
                  setDragOverStatut("");
                  if (clientId) onMoveClient?.(clientId, cfg.statut);
                }}
                style={{
                  minHeight:150, borderRadius:RADIUS.lg,
                  border:`1.5px solid ${isOver ? cfg.color : T.border}`,
                  background:isOver ? `${cfg.color}12` : T.input,
                  padding:SPACING.sm+2,
                  transition:"all .15s",
                }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:SPACING.sm+2 }}>
                  <button type="button" onClick={()=>onOpenStatus?.(cfg.statut)}
                    style={{
                      border:"none", background:"transparent", padding:0, cursor:"pointer",
                      display:"inline-flex", alignItems:"center", gap:7, color:cfg.color,
                      fontFamily:"inherit", fontSize:FONT.sm.size+1, fontWeight:800,
                    }}
                    title={`Voir les ${cfg.label.toLowerCase()} dans le CRM`}>
                    <span style={{
                      width:24, height:24, borderRadius:RADIUS.sm+1,
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      background:`${cfg.color}18`, color:cfg.color,
                    }}><Icon as={IconComp} size={13} strokeWidth={2.2}/></span>
                    {cfg.label}
                  </button>
                  <span style={{
                    minWidth:24, height:24, borderRadius:RADIUS.pill,
                    background:`${cfg.color}18`, color:cfg.color, border:`1px solid ${cfg.color}33`,
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    fontSize:FONT.xs.size, fontWeight:800, fontFamily:"'DM Mono',monospace",
                  }}>{list.length}</span>
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {list.length === 0 ? (
                    <div style={{
                      border:`1px dashed ${T.border}`, borderRadius:RADIUS.md,
                      padding:`${SPACING.md}px ${SPACING.sm}px`, textAlign:"center",
                      color:T.textMuted, fontSize:FONT.xs.size+1, fontStyle:"italic",
                    }}>
                      Glisser un client ici
                    </div>
                  ) : list.map(c => {
                    const isMoving = movingClientId === c.id;
                    return (
                      <div key={c.id}
                        draggable
                        onDragStart={e=>{
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.id);
                        }}
                        onDragEnd={()=>setDragOverStatut("")}
                        style={{
                          padding:`${SPACING.sm}px ${SPACING.sm+2}px`,
                          borderRadius:RADIUS.md, background:T.card, border:`1px solid ${T.border}`,
                          cursor:isMoving ? "wait" : "grab", opacity:isMoving ? .55 : 1,
                          boxShadow:T.shadowSm, transition:"all .12s",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=cfg.color; e.currentTarget.style.transform="translateY(-1px)";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.transform="none";}}
                        title="Glisser vers une autre colonne pour modifier le statut">
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:FONT.sm.size+1, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {c.prenom} {c.nom}
                            </div>
                            <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, display:"flex", gap:6, flexWrap:"wrap" }}>
                              <span>{fmtBudgetClient(c.budget)}</span>
                              {c.date_prochaine_action && <span>· Action {fmtDateShort(c.date_prochaine_action)}</span>}
                            </div>
                          </div>
                          <span style={{ color:T.textMuted, fontSize:15, lineHeight:1 }}>↔</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function DossiersRelanceDashboard({ clients=[], biens=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const today = isoDate(new Date());
  const items = [];
  clients.filter(c => c.statut !== "Terminé" && !c.prochaine_action).slice(0,4).forEach(c => items.push({title:`${getClientName(c)} — aucune prochaine action`, sub:`${c.etape || c.statut || "À qualifier"}`, badge:"Client", color:DA, icon:Users, onClick:()=>onNavigate?.("crm", { type:"sans_action" })}));
  biens.filter(b => b.date_relance && b.date_relance <= today).slice(0,4).forEach(b => items.push({title:`${b.adresse || b.ville || "Bien"} — relance à faire`, sub:`${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell, onClick:()=>onNavigate?.("biens", { type:"a_relancer" })}));
  biens.filter(b => ["Offre envoyée"].includes(b.statut) && !(b.date_relance && b.date_relance > today)).slice(0,3).forEach(b => items.push({title:`Offre sans relance — ${b.adresse || b.ville || "Bien"}`, sub:`Offre ${fmtDashboardEur(b.montant_offre)} · programmer une relance`, badge:"Offre", color:T.accent, icon:Send, onClick:()=>onNavigate?.("biens", { type:"statut", value:"Offre envoyée" })}));
  propositions.filter(p => p.statut === "proposé" || p.statut === "en analyse").slice(0,3).forEach(p => items.push({title:`Proposition à suivre`, sub:`Client / bien à relancer · ${safeDate(p.date_proposition || p.created_at)}`, badge:"Prop.", color:"#c084fc", icon:Handshake}));
  return <DashboardPanel title="Dossiers à relancer" icon={Bell} subtitle="Clients, biens, offres et propositions à ne pas laisser dormir" T={T}><DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucun dossier à relancer" /></DashboardPanel>;
}

const HONORAIRE_BASE_CONTRAT_HT = 1583;
const HONORAIRE_CONSEIL_MOYEN_HT = 7500;

function DirectionPilotageDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const items = [
    ["Honoraires signés", fmtDashboardEur(stats.baseHonorairesSignes), SU, "Base 1 583 € HT / client signé"],
    ["Honoraires pipeline", fmtDashboardEur(stats.baseHonorairesPipeline), "#FFC200", "Clients en cours + prospects"],
    ["Conseil estimé", fmtDashboardEur(stats.estimationHonoraireConseil), "#c084fc", "Moy. 7 500 € HT / offre active"],
    ["Taux transformation", `${stats.tauxTransformation || 0}%`, T.accent, "Clients réels / contacts"],
    ["Acceptation offres", `${stats.tauxAcceptationOffres || 0}%`, SU, "Offres acceptées / envoyées"],
    ["Délai signature", stats.delaiMoyenSignature !== null ? `${stats.delaiMoyenSignature} j` : "—", WA, "Premier contact → signature"],
    ["Qualité stock", `${stats.tauxFichesCompletes || 0}%`, T.accent, "Fiches biens complètes"],
  ];
  return (
    <DashboardPanel title="Direction / pilotage" icon={BarChart3} subtitle="Vision dirigeant : CA, conversion, délai et qualité du stock" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
        {items.map(([label,value,color,sub])=>(
          <div key={label} className="inv-kpi" style={{padding:12,borderLeft:`3px solid ${color}`}}>
            <div className="inv-kpi-lbl">{label}</div>
            <div className="inv-kpi-val" style={{fontSize:FONT.xl.size,color}}>{value}</div>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3}}>{sub}</div>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}


function ActionsPrioritairesDashboard({ clients=[], biens=[], planning=[], T=THEMES_INV.dark, onNavigate }) {
  const { today, endWeek } = getWeekRange();
  const items = [];
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action < today)
    .sort((a,b)=>String(a.date_prochaine_action).localeCompare(String(b.date_prochaine_action))).slice(0,4)
    .forEach(c => items.push({
      title:`${getClientName(c)} — action en retard`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Retard", color:DA, icon:AlertTriangle,
      onClick:()=>onNavigate?.("crm", { type:"actions_week_or_late" })
    }));
  biens.filter(b => b.date_relance && b.date_relance <= today)
    .sort((a,b)=>String(a.date_relance).localeCompare(String(b.date_relance))).slice(0,3)
    .forEach(b => items.push({
      title:`Relancer le bien — ${b.adresse || b.ville || "sans adresse"}`, sub:`Relance prévue le ${safeDate(b.date_relance)} · ${b.statut || "statut non renseigné"}`, badge:"Bien", color:WA, icon:Bell,
      onClick:()=>onNavigate?.("biens", { type:"a_relancer" })
    }));
  planning.filter(e => e.date_rdv === today).slice(0,3).forEach(e => items.push({
    title:`Aujourd'hui — ${e.titre}`, sub:`${e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"} · ${e.type || "RDV"}`, badge:"Aujourd'hui", color:SU, icon:Calendar,
  }));
  clients.filter(c => c.prochaine_action && c.date_prochaine_action && c.date_prochaine_action >= today && c.date_prochaine_action <= endWeek)
    .sort((a,b)=>String(a.date_prochaine_action).localeCompare(String(b.date_prochaine_action))).slice(0,3)
    .forEach(c => items.push({
      title:`${getClientName(c)} — action cette semaine`, sub:`${safeDate(c.date_prochaine_action)} · ${c.prochaine_action}`, badge:"Semaine", color:T.accent, icon:Calendar,
      onClick:()=>onNavigate?.("crm", { type:"actions_week_or_late" })
    }));
  return (
    <DashboardPanel title="À faire en priorité" icon={AlertTriangle} subtitle="Actions, relances et RDV les plus urgents" T={T}>
      <DashboardAlertList items={items.slice(0,10)} T={T} empty="Aucune action prioritaire cette semaine" />
    </DashboardPanel>
  );
}

function OpportunitesChaudesDashboard({ biens=[], T=THEMES_INV.dark, onNavigate }) {
  const hot = [...biens]
    .map(b => ({ ...b, _score:getBienScore(b) }))
    .filter(b => b._score > 0 || ["Visite programmée", "Visité", "À analyser", "A analyser", "Offre à faire", "Offre envoyée", "Offre acceptée"].includes(b.statut))
    .sort((a,b)=>b._score-a._score)
    .slice(0,6);
  return (
    <DashboardPanel title="Opportunités chaudes" icon={Sparkles} subtitle="Biens qui méritent une décision rapide" T={T}>
      {hot.length === 0 ? (
        <div style={{padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center", fontSize:FONT.sm.size+1, fontStyle:"italic"}}>Aucune opportunité chaude détectée</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:SPACING.md}}>
          {hot.map(b => {
            const v = b.visite_data || {};
            const recom = v?.conclusion?.recommandation || b.statut || "À analyser";
            return (
              <button key={b.id} type="button" onClick={()=>onNavigate?.("biens", { type:"all" })}
                style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:SPACING.md,textAlign:"left",fontFamily:"inherit",cursor:"pointer",transition:"all .12s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent; e.currentTarget.style.transform="translateY(-1px)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.transform="none";}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:8}}>
                  <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text,lineHeight:1.25,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{getBienLabel(b)}</div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:T.accent,background:T.accentBg,border:`1px solid ${T.accentBorder}`,borderRadius:RADIUS.pill,padding:"3px 7px"}}>Score {b._score}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Rendement<br/><strong style={{fontSize:FONT.sm.size+1,color:SU}}>{b.rendement_brut ? fmtDashboardPct(b.rendement_brut) : "—"}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Cash-flow<br/><strong style={{fontSize:FONT.sm.size+1,color:Number(b.cashflow_estime)>0?SU:WA}}>{fmtDashboardEur(b.cashflow_estime)}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Offre<br/><strong style={{fontSize:FONT.sm.size+1,color:T.accent}}>{fmtDashboardEur(b.montant_offre)}</strong></div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Travaux<br/><strong style={{fontSize:FONT.sm.size+1,color:T.textSub}}>{fmtDashboardEur(b.prix_travaux)}</strong></div>
                </div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,display:"flex",justifyContent:"space-between",gap:8}}>
                  <span>{recom}</span><span>{b.statut || "—"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </DashboardPanel>
  );
}

function StockPilotageDashboard({ stats, T=THEMES_INV.dark, onNavigate }) {
  if (!stats) return null;
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.lg }}>
        <KPICard icon={Home} label="Biens en stock" value={stats.biensTotaux} color="#4db8ff" onClick={()=>onNavigate?.("biens", { type:"all" })}/>
        <KPICard icon={Sparkles} label="Top opportunités" value={stats.topOpportunites} color="#c084fc" sub="Score Profero élevé" onClick={()=>onNavigate?.("biens", { type:"all" })}/>
        <KPICard icon={Bell} label="À relancer" value={stats.biensARelancer} color={DA} onClick={()=>onNavigate?.("biens", { type:"a_relancer" })}/>
        <KPICard icon={Send} label="Offres envoyées" value={stats.offreEnvoyees} color="#FFC200" onClick={()=>onNavigate?.("biens", { type:"statut", value:"Offre envoyée" })}/>
        <KPICard icon={Check} label="Offres acceptées" value={stats.offresAcceptees} color={SU} onClick={()=>onNavigate?.("biens", { type:"statut", value:"Offre acceptée" })}/>
        <KPICard icon={AlertTriangle} label="Fiches incomplètes" value={stats.biensIncomplets} color={WA} sub={`${stats.tauxFichesCompletes}% complètes`}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:SPACING.md,marginBottom:SPACING.xxl-2}}>
        {[
          ["Fiches complètes", stats.tauxFichesCompletes, SU],
          ["Biens géolocalisés", stats.tauxGeoloc, T.accent],
          ["Simulateurs remplis", stats.tauxSimulateur, "#c084fc"],
          ["Offres / stock", stats.tauxOffresStock, "#FFC200"],
        ].map(([label,pct,color]) => (
          <div key={label} className="inv-card" style={{padding:SPACING.md,borderLeft:`3px solid ${color}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="inv-kpi-lbl">{label}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color}}>{pct}%</div>
            </div>
            <div style={{height:7,background:T.input,borderRadius:RADIUS.pill,overflow:"hidden",border:`1px solid ${T.border}`}}>
              <div style={{height:"100%",width:`${Math.max(0,Math.min(100,pct))}%`,background:color,borderRadius:RADIUS.pill}}/>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PipelineEtapesBoard({ clients=[], T=THEMES_INV.dark, movingClientId, onMoveClient, onOpenEtape }) {
  const [dragOverEtape, setDragOverEtape] = useState("");
  const clientsByEtape = ETAPES_CLIENT.reduce((acc, etape) => {
    acc[etape] = clients.filter(c => (c.etape || "") === etape)
      .sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""), "fr", { sensitivity:"base" }));
    return acc;
  }, {});
  const noStage = clients.filter(c => !c.etape);
  const columns = [{etape:"", label:"Étape non définie", color:DA, list:noStage}, ...ETAPES_CLIENT.map((etape,i)=>({ etape, label:etape, color:DASH_STAGE_COLORS[i % DASH_STAGE_COLORS.length], list:clientsByEtape[etape] || [] }))];
  return (
    <DashboardPanel title="Pipeline clients par étape" icon={TrendingUp} subtitle="Glisser-déposer pour changer l’étape du client" T={T}>
      <div style={{display:"flex",gap:SPACING.md,overflowX:"auto",paddingBottom:4}}>
        {columns.map(col => {
          const isOver = dragOverEtape === col.etape;
          const budget = col.list.reduce((s,c)=>s+(Number(c.budget)||0),0);
          return (
            <div key={col.label}
              onDragOver={e=>{e.preventDefault();setDragOverEtape(col.etape);}}
              onDragLeave={()=>setDragOverEtape("")}
              onDrop={e=>{e.preventDefault(); const clientId=e.dataTransfer.getData("text/plain"); setDragOverEtape(""); if(clientId) onMoveClient?.(clientId, col.etape);}}
              style={{minWidth:235,maxWidth:250,background:isOver?`${col.color}12`:T.input,border:`1.5px solid ${isOver?col.color:T.border}`,borderRadius:RADIUS.lg,padding:SPACING.sm+2,transition:"all .15s"}}>
              <button type="button" onClick={()=>onOpenEtape?.(col.etape)} style={{border:"none",background:"transparent",padding:0,cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5}}>
                  <div style={{fontSize:FONT.xs.size+1,fontWeight:900,color:col.color,lineHeight:1.2,textTransform:"uppercase",letterSpacing:.6}}>{col.label}</div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:col.color,background:`${col.color}18`,border:`1px solid ${col.color}33`,borderRadius:RADIUS.pill,padding:"2px 7px"}}>{col.list.length}</span>
                </div>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginBottom:9}}>Budget cumulé : <strong style={{color:T.textSub}}>{fmtDashboardEur(budget)}</strong></div>
              </button>
              <div style={{display:"flex",flexDirection:"column",gap:7,minHeight:72}}>
                {col.list.length === 0 ? <div style={{border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,padding:SPACING.sm,textAlign:"center",fontSize:FONT.xs.size,color:T.textMuted,fontStyle:"italic"}}>Déposer ici</div> : col.list.slice(0,8).map(c => (
                  <div key={c.id} draggable onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",c.id);}}
                    style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:`${SPACING.sm-1}px ${SPACING.sm}px`,cursor:movingClientId===c.id?"wait":"grab",opacity:movingClientId===c.id ? .55 : 1}}>
                    <div style={{fontSize:FONT.sm.size,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{getClientName(c)}</div>
                    <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"flex",justifyContent:"space-between",gap:8}}><span>{fmtDashboardEur(c.budget)}</span><span>{safeDate(c.date_prochaine_action)}</span></div>
                  </div>
                ))}
                {col.list.length > 8 && <div style={{fontSize:FONT.xs.size,color:T.textMuted,textAlign:"center"}}>+ {col.list.length - 8} autre{col.list.length - 8 > 1 ? "s" : ""}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardPanel>
  );
}

function ClientsARisqueDashboard({ clients=[], propositions=[], T=THEMES_INV.dark, onNavigate }) {
  const propByClient = propositions.reduce((acc,p)=>{ if(p.client_id) acc[p.client_id]=(acc[p.client_id]||0)+1; return acc; }, {});
  const risks = [];
  clients.filter(c => c.statut !== "Prospect").forEach(c => {
    if (!c.prochaine_action && !c.date_prochaine_action) risks.push({title:`${getClientName(c)} — aucune prochaine action`, sub:`Statut : ${c.statut || "—"} · Étape : ${c.etape || "non définie"}`, color:DA, icon:AlertTriangle, onClick:()=>onNavigate?.("crm", { type:"sans_action" })});
    if ((c.statut === "Actif" || c.date_signature) && !propByClient[c.id]) risks.push({title:`${getClientName(c)} — aucun bien proposé`, sub:`Budget : ${fmtDashboardEur(c.budget)} · Contrat signé`, color:WA, icon:Home, onClick:()=>onNavigate?.("crm", { type:"signes" })});
    if (!c.etape) risks.push({title:`${getClientName(c)} — étape non définie`, sub:`Le parcours client n’est pas pilotable`, color:"#c084fc", icon:TrendingUp, onClick:()=>onNavigate?.("crm", { type:"all" })});
  });
  return (
    <DashboardPanel title="Clients à risque" icon={AlertTriangle} subtitle="Situations qui peuvent créer une perte de suivi" T={T}>
      <DashboardAlertList items={risks.slice(0,8)} T={T} empty="Aucun client à risque détecté" />
    </DashboardPanel>
  );
}

function PerformanceCommercialeDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  const cards = [
    ["Transformation contacts → clients", `${stats.tauxTransformation}%`, "Clients hors prospects / total contacts", SU, Handshake],
    ["Biens proposés / client actif", stats.biensParClientActif.toFixed(1).replace(".", ","), "Propositions / clients actifs", T.accent, Building2],
    ["Offres acceptées / envoyées", `${stats.tauxAcceptationOffres}%`, "Offres acceptées / offres actives", "#FFC200", Check],
    ["Délai moyen signature", stats.delaiMoyenSignature ? `${stats.delaiMoyenSignature} j` : "—", "Premier contact → signature", "#c084fc", Calendar],
  ];
  return (
    <DashboardPanel title="Performance commerciale" icon={BarChart3} subtitle="Ratios de conversion et rythme commercial" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:SPACING.md}}>
        {cards.map(([label,value,sub,color,IconComp]) => <KPICard key={label} label={label} value={value} sub={sub} color={color} icon={IconComp}/>) }
      </div>
    </DashboardPanel>
  );
}

function ValeurBusinessDashboard({ stats, T=THEMES_INV.dark }) {
  if (!stats) return null;
  return (
    <DashboardPanel title="Valeur business potentielle" icon={Wallet} subtitle="Vision financière du pipeline" T={T}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:SPACING.md}}>
        <KPICard icon={Wallet} label="Budget clients actifs" value={fmtDashboardEur(stats.budgetClientsActifs)} color={T.accent} sub="Prospects exclus"/>
        <KPICard icon={Send} label="Montant offres en cours" value={fmtDashboardEur(stats.montantOffresCours)} color="#FFC200" sub="Offres renseignées sur les biens/projets"/>
        <KPICard icon={Handshake} label="Base honoraires signés" value={fmtDashboardEur(stats.baseHonorairesSignes)} color={SU} sub="1 583 € HT / client signé"/>
        <KPICard icon={TrendingUp} label="Base honoraires pipeline" value={fmtDashboardEur(stats.baseHonorairesPipeline)} color="#c084fc" sub="Clients en cours + prospects"/>
        <KPICard icon={Briefcase} label="Estimation honoraire conseil" value={fmtDashboardEur(stats.estimationHonoraireConseil)} color="#4db8ff" sub="7 500 € HT / offre active"/>
      </div>
    </DashboardPanel>
  );
}



function PlanningSemaine({ profil, T=THEMES_INV.dark }) {
  const { startWeek, endWeek, today } = getWeekRange();
  const [events, setEvents] = useState([]);
  const [clients, setClients] = useState([]);
  const [biens, setBiens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"",
    client_id:"", bien_id:"", lieu:"", commentaire:"",
  });

  const charger = async () => {
    setLoading(true); setError("");
    const [planningRes, clientsRes, biensRes] = await Promise.all([
      supabase.from("invest_planning").select("*, client:invest_clients(id,nom,prenom), bien:invest_biens(id,adresse,ville)").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }),
      supabase.from("invest_clients").select("id,nom,prenom").order("nom"),
      supabase.from("invest_biens").select("id,adresse,ville").order("adresse"),
    ]);
    let planningData = planningRes.data || [];
    if (planningRes.error) {
      const fallback = await supabase.from("invest_planning").select("*").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true });
      if (fallback.error) {
        setError("La table invest_planning n'existe pas encore. Lancez la migration SQL fournie avec le fichier.");
        planningData = [];
      } else {
        planningData = fallback.data || [];
      }
    }
    setEvents(planningData);
    setClients(clientsRes.data || []);
    setBiens(biensRes.data || []);
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const ajouter = async () => {
    if (!form.titre.trim() || !form.date_rdv) return;
    setSaving(true);
    const payload = {
      titre: form.titre.trim(), type: form.type, date_rdv: form.date_rdv,
      heure_debut: form.heure_debut || null, heure_fin: form.heure_fin || null,
      client_id: form.client_id || null, bien_id: form.bien_id || null,
      lieu: form.lieu.trim() || null, commentaire: form.commentaire.trim() || null,
      created_by: profil?.email || profil?.nom || null,
    };
    const { error } = await supabase.from("invest_planning").insert(payload);
    setSaving(false);
    if (error) {
      console.error("Erreur insert invest_planning:", error);
      setError(`Impossible d'ajouter le RDV : ${error.message || "vérifiez les droits RLS et la table invest_planning."}`);
      return;
    }
    setForm({ titre:"", type:"Visite de bien", date_rdv:today, heure_debut:"", heure_fin:"", client_id:"", bien_id:"", lieu:"", commentaire:"" });
    charger();
  };

  const supprimer = async (id) => {
    if (!window.confirm("Supprimer ce rendez-vous ?")) return;
    await supabase.from("invest_planning").delete().eq("id", id);
    charger();
  };

  const jours = Array.from({length:7}, (_,i)=>{
    const d = new Date(startWeek); d.setDate(d.getDate()+i);
    return { iso: isoDate(d), label: d.toLocaleDateString("fr-FR", { weekday:"short", day:"2-digit", month:"short" }) };
  });

  return (
    <div className="inv-card" style={{marginBottom:SPACING.xxl-2}}>
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Calendar} size={13} strokeWidth={2.2}/>Planning commercial de la semaine</span></div>
      <div className="inv-card-bd">
        {error && <div style={{marginBottom:12, padding:"9px 11px", borderRadius:RADIUS.md, background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:WA, fontSize:FONT.sm.size}}>{error}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1.2fr 150px 130px 90px 90px 1fr 1fr auto",gap:8,alignItems:"center",marginBottom:14}}>
          <input className="inv-inp" value={form.titre} placeholder="Titre du RDV" onChange={e=>setForm({...form,titre:e.target.value})} style={{width:"100%", textAlign:"left"}}/>
          <select className="inv-sel" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{TYPES_PLANNING_INVEST.map(t=><option key={t}>{t}</option>)}</select>
          <input className="inv-inp" type="date" value={form.date_rdv} onChange={e=>setForm({...form,date_rdv:e.target.value})} style={{width:"100%"}}/>
          <input className="inv-inp" type="time" value={form.heure_debut} onChange={e=>setForm({...form,heure_debut:e.target.value})} style={{width:"100%"}}/>
          <input className="inv-inp" type="time" value={form.heure_fin} onChange={e=>setForm({...form,heure_fin:e.target.value})} style={{width:"100%"}}/>
          <select className="inv-sel" value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})}><option value="">Client lié</option>{clients.map(c=><option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}</select>
          <select className="inv-sel" value={form.bien_id} onChange={e=>setForm({...form,bien_id:e.target.value})}><option value="">Bien lié</option>{biens.map(b=><option key={b.id} value={b.id}>{b.adresse}{b.ville ? ` — ${b.ville}` : ""}</option>)}</select>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={ajouter} disabled={saving || !form.titre.trim()}><Icon as={Plus} size={12} strokeWidth={2.2}/> Ajouter</button>
        </div>

        {loading ? (
          <div style={{textAlign:"center", color:T.textMuted, padding:18}}>Chargement…</div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,overflowX:"auto"}}>
            {jours.map(j => {
              const evts = events.filter(e => e.date_rdv === j.iso);
              return (
                <div key={j.iso} style={{minWidth:145, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, overflow:"hidden", background:T.input}}>
                  <div style={{padding:"7px 9px", background:j.iso===today?T.accentBg:T.sectionHd, color:j.iso===today?T.accent:T.textSub, fontSize:FONT.xs.size, fontWeight:800, textTransform:"uppercase", letterSpacing:.8}}>{j.label}</div>
                  <div style={{padding:8, display:"flex", flexDirection:"column", gap:6, minHeight:92}}>
                    {evts.length === 0 ? <div style={{fontSize:FONT.xs.size, color:T.textMuted, fontStyle:"italic"}}>Aucun RDV</div> : evts.map(e => (
                      <div key={e.id} style={{padding:"7px 8px", borderRadius:RADIUS.sm+1, background:T.card, border:`1px solid ${T.border}`}}>
                        <div style={{display:"flex", justifyContent:"space-between", gap:5}}>
                          <div style={{fontSize:FONT.sm.size, fontWeight:800, color:T.text, lineHeight:1.2}}>{e.titre}</div>
                          <button onClick={()=>supprimer(e.id)} style={{background:"transparent",border:"none",color:T.textMuted,cursor:"pointer",fontSize:13}}>×</button>
                        </div>
                        <div style={{fontSize:FONT.xs.size, color:T.accent, marginTop:3, fontWeight:700}}>{e.heure_debut ? e.heure_debut.slice(0,5) : "Horaire libre"}{e.heure_fin ? ` - ${e.heure_fin.slice(0,5)}` : ""}</div>
                        <div style={{fontSize:FONT.xs.size, color:T.textMuted, marginTop:2}}>{e.type}</div>
                      </div>
                    ))}
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

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [clientsDash, setClientsDash] = useState([]);
  const [biensDash, setBiensDash] = useState([]);
  const [propsDash, setPropsDash] = useState([]);
  const [planningDash, setPlanningDash] = useState([]);
  const [movingClientId, setMovingClientId] = useState(null);
  const [movingEtapeClientId, setMovingEtapeClientId] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loading, setLoading] = useState(true);

  const chargerDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError("");
    const { today, startWeek, endWeek } = getWeekRange();
    const [clientsRes, biensRes, propsRes, planningRes] = await Promise.all([
      supabase.from("invest_clients").select("id,nom,prenom,statut,budget,date_signature,date_premier_contact,prochaine_action,date_prochaine_action,created_at,etape,source,conseiller"),
      supabase.from("invest_biens").select("id,adresse,ville,statut,date_relance,date_visite,rendement_brut,cashflow_estime,prix_vente,prix_travaux,cout_total,montant_offre,visite_data,latitude,longitude,reference_interne,conseiller_profero,created_at"),
      supabase.from("invest_propositions").select("id,client_id,bien_id,statut,created_at,date_proposition,bien:invest_biens(id,montant_offre,prix_vente,statut)"),
      supabase.from("invest_planning").select("id,titre,type,date_rdv,heure_debut,heure_fin,client_id,bien_id,lieu,commentaire").gte("date_rdv", startWeek).lte("date_rdv", endWeek).order("date_rdv", { ascending:true }).order("heure_debut", { ascending:true }),
    ]);

    const c = clientsRes.data || [];
    const b = biensRes.data || [];
    const p = propsRes.data || [];
    const planning = planningRes.error ? [] : (planningRes.data || []);
    setClientsDash(c);
    setBiensDash(b);
    setPropsDash(p);
    setPlanningDash(planning);

    const actionsRetard = c.filter(x => x.prochaine_action && x.date_prochaine_action && x.date_prochaine_action < today);
    const actionsSemaine = c.filter(x => x.prochaine_action && x.date_prochaine_action && x.date_prochaine_action >= today && x.date_prochaine_action <= endWeek);
    const prospects = c.filter(x => x.statut === "Prospect");
    const clientsReels = c.filter(x => x.statut !== "Prospect");
    const clientsPipeline = c.filter(x => x.statut !== "Terminé");
    const clientsSignes = clientsReels.filter(x => x.date_signature);
    const clientsActifs = c.filter(x => x.statut === "Actif");
    const clientsSansAction = clientsReels.filter(x => !x.prochaine_action && !x.date_prochaine_action);
    const offresEnv = b.filter(x => x.statut === "Offre envoyée");
    const offresAcc = b.filter(x => x.statut === "Offre acceptée");
    const offresActivesMap = new Map();
    const addOffreActive = (key, amount) => {
      const n = Number(amount) || 0;
      if (!key || n <= 0) return;
      offresActivesMap.set(key, n);
    };
    b.forEach(x => {
      const statut = x.statut || "";
      const hasOffre = Number(x.montant_offre) > 0;
      if (hasOffre && !["Abandonné", "Offre refusée"].includes(statut)) addOffreActive(`bien-${x.id}`, x.montant_offre);
    });
    p.forEach(prop => {
      if (!["offre en cours", "proposé", "intéressé", "en analyse"].includes(prop.statut)) return;
      addOffreActive(`prop-${prop.bien_id || prop.id}`, prop.bien?.montant_offre || prop.bien?.prix_vente);
    });
    const montantOffresCours = Array.from(offresActivesMap.values()).reduce((s,x)=>s+x,0);
    const nbOffresActives = offresActivesMap.size;
    const delaisSignature = clientsSignes
      .filter(x => x.date_signature)
      .map(x => daysBetween(x.date_premier_contact || x.created_at, new Date(x.date_signature)))
      .filter(v => Number.isFinite(v) && v >= 0);
    const fichesCompletes = b.filter(isBienFicheComplete).length;
    const geoloc = b.filter(isGeolocBien).length;
    const simulateurs = b.filter(hasSimulateurBien).length;
    const topOpps = b.filter(x => getBienScore(x) >= 45).length;
    const offresStock = nbOffresActives;

    setStats({
      prospects:       prospects.length,
      actifs:          clientsActifs.length,
      inactifs:        c.filter(x => x.statut === "Inactif").length,
      termines:        c.filter(x => x.statut === "Terminé").length,
      totalSignes:     clientsSignes.length,
      sommeBudgets:    clientsSignes.reduce((s, x) => s + (x.budget || 0), 0),
      biensTotaux:     b.length,
      biensARelancer:  b.filter(x => x.date_relance && x.date_relance <= today).length,
      visitesProg:     b.filter(x => x.statut === "Visite programmée").length,
      offreEnvoyees:   offresEnv.length,
      offresAcceptees: offresAcc.length,
      sansProchaineAction: clientsSansAction.length,
      prospectsSansAction: prospects.filter(x => !x.prochaine_action && !x.date_prochaine_action).length,
      nbPropositions:  p.length,
      actionsRetard:   actionsRetard.length,
      actionsSemaine:  actionsSemaine.length,
      actionsATraiter: actionsRetard.length + actionsSemaine.length,
      rdvSemaine:      planning.length,
      visitesSemaine:  planning.filter(e => e.type === "Visite de bien").length,
      topOpportunites: topOpps,
      biensIncomplets: Math.max(0, b.length - fichesCompletes),
      tauxFichesCompletes: b.length ? Math.round((fichesCompletes / b.length) * 100) : 0,
      tauxGeoloc: b.length ? Math.round((geoloc / b.length) * 100) : 0,
      tauxSimulateur: b.length ? Math.round((simulateurs / b.length) * 100) : 0,
      tauxOffresStock: b.length ? Math.round((offresStock / b.length) * 100) : 0,
      tauxTransformation: c.length ? Math.round((clientsReels.length / c.length) * 100) : 0,
      biensParClientActif: clientsActifs.length ? p.length / clientsActifs.length : 0,
      tauxAcceptationOffres: offresEnv.length + offresAcc.length ? Math.round((offresAcc.length / (offresEnv.length + offresAcc.length)) * 100) : 0,
      delaiMoyenSignature: delaisSignature.length ? Math.round(delaisSignature.reduce((s,x)=>s+x,0) / delaisSignature.length) : null,
      budgetClientsActifs: clientsActifs.reduce((s,x)=>s+(Number(x.budget)||0),0),
      montantOffresCours,
      nbOffresActives,
      baseHonorairesSignes: clientsSignes.length * HONORAIRE_BASE_CONTRAT_HT,
      baseHonorairesPipeline: clientsPipeline.length * HONORAIRE_BASE_CONTRAT_HT,
      estimationHonoraireConseil: nbOffresActives * HONORAIRE_CONSEIL_MOYEN_HT,
    });
    setLoading(false);
  }, []);

  useEffect(() => { chargerDashboard(); }, [chargerDashboard]);

  const fmt = v => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
  const go = (target, filter) => { if (onNavigate) onNavigate(target, filter); };

  const changerStatutClient = async (clientId, nouveauStatut) => {
    const client = clientsDash.find(c => c.id === clientId);
    if (!client || !nouveauStatut || client.statut === nouveauStatut) return;
    const ancienStatut = client.statut || "Prospect";
    setMovingClientId(clientId);
    setDashboardError("");

    setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:nouveauStatut } : c));
    setStats(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      const oldKey = DASH_STAT_KEY[ancienStatut];
      const newKey = DASH_STAT_KEY[nouveauStatut];
      if (oldKey) next[oldKey] = Math.max(0, (next[oldKey] || 0) - 1);
      if (newKey) next[newKey] = (next[newKey] || 0) + 1;
      return next;
    });

    const { error } = await supabase.from("invest_clients").update({ statut:nouveauStatut }).eq("id", clientId);
    setMovingClientId(null);
    if (error) {
      console.error("Erreur changement statut client:", error);
      setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, statut:ancienStatut } : c));
      setStats(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        const oldKey = DASH_STAT_KEY[ancienStatut];
        const newKey = DASH_STAT_KEY[nouveauStatut];
        if (newKey) next[newKey] = Math.max(0, (next[newKey] || 0) - 1);
        if (oldKey) next[oldKey] = (next[oldKey] || 0) + 1;
        return next;
      });
      setDashboardError(`Impossible de modifier le statut de ${client.prenom || ""} ${client.nom || ""} : ${error.message || "erreur Supabase"}`);
    }
  };

  const changerEtapeClient = async (clientId, nouvelleEtape) => {
    const client = clientsDash.find(c => c.id === clientId);
    if (!client || (client.etape || "") === (nouvelleEtape || "")) return;
    const ancienneEtape = client.etape || "";
    setMovingEtapeClientId(clientId);
    setDashboardError("");
    setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:nouvelleEtape || null } : c));
    const { error } = await supabase.from("invest_clients").update({ etape:nouvelleEtape || null }).eq("id", clientId);
    setMovingEtapeClientId(null);
    if (error) {
      console.error("Erreur changement étape client:", error);
      setClientsDash(prev => prev.map(c => c.id === clientId ? { ...c, etape:ancienneEtape || null } : c));
      setDashboardError(`Impossible de modifier l'étape de ${getClientName(client)} : ${error.message || "erreur Supabase"}`);
    }
  };

  const sectionTitle = (icon, label, sub) => (
    <div style={{
      fontSize:FONT.xs.size, fontWeight:700, color:T.textMuted, textTransform:"uppercase",
      letterSpacing:1.8, marginBottom:SPACING.md, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm-2,
    }}>
      <span style={{display:"inline-flex",alignItems:"center",gap:SPACING.sm-2}}><Icon as={icon} size={13} strokeWidth={2}/>{label}</span>
      {sub && <span style={{textTransform:"none",letterSpacing:0,fontWeight:600,color:T.textMuted}}>{sub}</span>}
    </div>
  );

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1380, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:48, height:48, borderRadius:RADIUS.lg, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={LayoutDashboard} size={24} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Tableau de bord</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Cockpit de pilotage quotidien Profero Invest</div>
          </div>
        </div>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={chargerDashboard}>
          <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Actualiser
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : stats && (
        <>
          <PlanningSemaine profil={profil} T={T} />

          {sectionTitle(AlertTriangle, "Pilotage immédiat", `${stats.actionsRetard} retard · ${stats.actionsSemaine} cette semaine · ${stats.visitesSemaine} visites`)}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:SPACING.md, marginBottom:SPACING.xxl-2 }}>
            <KPICard icon={AlertTriangle} label="Actions en retard" value={stats.actionsRetard} color={stats.actionsRetard > 0 ? DA : SU} onClick={()=>go("crm", { type:"actions_week_or_late" })}/>
            <KPICard icon={Calendar} label="Actions cette semaine" value={stats.actionsSemaine} color={WA} onClick={()=>go("crm", { type:"actions_week_or_late" })}/>
            <KPICard icon={Home} label="Visites prévues" value={stats.visitesSemaine} color={T.accent}/>
            <KPICard icon={Users} label="Clients sans action" value={stats.sansProchaineAction} color={DA} sub="Prospects exclus" onClick={()=>go("crm", { type:"sans_action" })}/>
            <KPICard icon={Sparkles} label="Top opportunités" value={stats.topOpportunites} color="#c084fc" onClick={()=>go("biens", { type:"all" })}/>
            <KPICard icon={Wallet} label="Honoraires pipeline" value={fmtDashboardEur(stats.baseHonorairesPipeline)} color="#FFC200" sub="Base 1 583 € HT"/>
          </div>

          <ActionsPrioritairesDashboard clients={clientsDash} biens={biensDash} planning={planningDash} T={T} onNavigate={go} />
          <MissionActionsCollaborateursDashboard T={T} onNavigate={go} />
          <OpportunitesChaudesDashboard biens={biensDash} T={T} onNavigate={go} />
          <DossiersRelanceDashboard clients={clientsDash} biens={biensDash} propositions={propsDash} T={T} onNavigate={go} />

          {sectionTitle(Building2, "Stock de biens", "Opportunités, relances et qualité des fiches")}
          <StockPilotageDashboard stats={stats} T={T} onNavigate={go} />

          {dashboardError && (
            <div style={{ marginBottom:SPACING.md, padding:`${SPACING.sm+2}px ${SPACING.md}px`, borderRadius:RADIUS.md, background:SEMANTIC.danger.bg, border:`1px solid ${SEMANTIC.danger.border}`, color:DA, fontSize:FONT.sm.size+1 }}>
              {dashboardError}
            </div>
          )}

          <ClientsStatutsBoard
            clients={clientsDash}
            T={T}
            movingClientId={movingClientId}
            onMoveClient={changerStatutClient}
            onOpenStatus={(statut)=>go("crm", { type:"statut", value:statut })}
          />

          <PipelineEtapesBoard
            clients={clientsDash}
            T={T}
            movingClientId={movingEtapeClientId}
            onMoveClient={changerEtapeClient}
            onOpenEtape={(etape)=>go("crm", etape ? { type:"etape", value:etape } : { type:"all" })}
          />

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.05fr) minmax(0,.95fr)",gap:SPACING.md,alignItems:"start"}}>
            <ClientsARisqueDashboard clients={clientsDash} propositions={propsDash} T={T} onNavigate={go} />
            <div>
              <PerformanceCommercialeDashboard stats={stats} T={T} />
              <ValeurBusinessDashboard stats={stats} T={T} />
              <DirectionPilotageDashboard stats={stats} T={T} />
            </div>
          </div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── CRM CLIENTS ──────────────────────────────────────────────────────────────

function MissionActionsCollaborateursDashboard({ T=THEMES_INV.dark, onNavigate }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reminderStatus, setReminderStatus] = useState("");
  const today = new Date().toISOString().slice(0,10);
  const charger = useCallback(async () => {
    setLoading(true); setError("");
    const { data, error } = await supabase
      .from("invest_mission_actions")
      .select("*, client:invest_clients(id,nom,prenom,statut,etape)")
      .in("status", ["a_faire", "en_cours", "bloque"])
      .order("due_date", { ascending:true, nullsFirst:false })
      .limit(80);
    if (error) {
      if (error.code !== "42P01") setError(error.message);
      setActions([]);
    } else setActions(data || []);
    setLoading(false);
  }, []);
  const lancerRelancesDuJour = useCallback(async (manual=false) => {
    const storageKey = `profero_mission_daily_reminders_${today}`;
    if (!manual) {
      try {
        if (window.localStorage.getItem(storageKey) === "done") return;
      } catch {}
    }
    if (manual) setReminderStatus("Envoi des relances du jour…");
    const { data, error } = await supabase.functions.invoke("send-mission-daily-reminders", {
      body: { source: manual ? "manual" : "app_daily", date: today },
    });
    if (error || data?.error) {
      const msg = data?.error || error?.message || "Relances quotidiennes non disponibles";
      if (manual) setReminderStatus(`⚠ ${msg}`);
      return;
    }
    try { window.localStorage.setItem(storageKey, "done"); } catch {}
    if (manual) {
      setReminderStatus(`✅ ${data?.sent || 0} relance(s) envoyée(s), ${data?.skipped || 0} ignorée(s)`);
      charger();
    }
  }, [today, charger]);
  useEffect(() => { charger(); lancerRelancesDuJour(false); }, [charger, lancerRelancesDuJour]);
  const grouped = MISSION_COLLABORATEURS.reduce((acc, name) => ({ ...acc, [name]: actions.filter(a => (a.responsable || "") === name) }), {});
  const late = actions.filter(a => a.due_date && a.due_date < today).length;
  if (!loading && !actions.length && !error) return null;
  return (
    <div className="inv-card" style={{marginBottom:SPACING.xxl-2}}>
      <div className="inv-card-hd" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Bell} size={13} strokeWidth={2.2}/>Actions automatisées collaborateurs</span>
        <button className="inv-btn inv-btn-sm" style={{background:"rgba(255,255,255,.65)",color:"black",border:`1px solid ${T.border}`}} onClick={() => lancerRelancesDuJour(true)}><Icon as={Send} size={12}/> Relances du jour</button>
        <button className="inv-btn inv-btn-sm" style={{background:"rgba(255,255,255,.65)",color:"black",border:`1px solid ${T.border}`}} onClick={charger}><Icon as={RefreshCw} size={12}/> Actualiser</button>
      </div>
      <div className="inv-card-bd">
        {error && <div style={{padding:"8px 10px",borderRadius:8,background:"#fff1f2",border:"1px solid #fecdd3",color:"#be123c",fontSize:12}}>⚠ {error}</div>}
        {reminderStatus && <div style={{padding:"8px 10px",borderRadius:8,background:"#eff6ff",border:"1px solid #bfdbfe",color:"#1d4ed8",fontSize:12,marginBottom:8}}>{reminderStatus}</div>}
        {loading ? <div style={{padding:14,textAlign:"center",color:T.textMuted}}>Chargement…</div> : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:12}}>
              <div style={{border:`1px solid ${T.border}`,background:T.input,borderRadius:10,padding:"9px 11px"}}><div style={{fontSize:10,color:T.textMuted,fontWeight:800,textTransform:"uppercase"}}>Actions ouvertes</div><div style={{fontSize:18,fontWeight:900,color:T.text}}>{actions.length}</div></div>
              <div style={{border:`1px solid ${late ? "#fecdd3" : T.border}`,background:late ? "#fff1f2" : T.input,borderRadius:10,padding:"9px 11px"}}><div style={{fontSize:10,color:T.textMuted,fontWeight:800,textTransform:"uppercase"}}>En retard</div><div style={{fontSize:18,fontWeight:900,color:late ? "#dc2626" : T.text}}>{late}</div></div>
              <div style={{border:`1px solid ${T.border}`,background:T.input,borderRadius:10,padding:"9px 11px"}}><div style={{fontSize:10,color:T.textMuted,fontWeight:800,textTransform:"uppercase"}}>Bloquées</div><div style={{fontSize:18,fontWeight:900,color:"#dc2626"}}>{actions.filter(a=>a.status==="bloque").length}</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:8}}>
              {Object.entries(grouped).filter(([,list]) => list.length).slice(0,8).map(([owner,list]) => (
                <div key={owner} style={{border:`1px solid ${T.border}`,background:"#fff",borderRadius:10,padding:"9px 10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:6}}><div style={{fontSize:13,fontWeight:900,color:T.text}}>{owner}</div><span style={{fontSize:11,fontWeight:900,color:T.accent,background:T.accentBg,borderRadius:99,padding:"2px 7px"}}>{list.length}</span></div>
                  {list.slice(0,4).map(a => (
                    <div key={a.id} style={{padding:"6px 0",borderTop:`1px solid ${T.border}`}}>
                      <div style={{fontSize:11,fontWeight:800,color:a.due_date && a.due_date < today ? "#dc2626" : T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.action_title}</div>
                      <div style={{fontSize:10,color:T.textMuted,marginTop:1}}>{a.client ? `${a.client.prenom || ""} ${a.client.nom || ""}`.trim() : "Client"} · {a.step_label} · {a.due_date ? new Date(a.due_date).toLocaleDateString("fr-FR") : "—"}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


export default TableauBord;
export {
  TableauBord, PlanningSemaine, ClientsStatutsBoard,
  DossiersRelanceDashboard, DirectionPilotageDashboard,
  ActionsPrioritairesDashboard, OpportunitesChaudesDashboard, StockPilotageDashboard,
  PipelineEtapesBoard, ClientsARisqueDashboard,
  PerformanceCommercialeDashboard, ValeurBusinessDashboard,
  MissionActionsCollaborateursDashboard,
};