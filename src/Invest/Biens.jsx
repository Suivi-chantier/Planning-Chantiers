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

function AutoScoreBienCard({ bien, T=THEMES_INV.dark }) {
  const score = computeAutoBienScore(bien);
  const v = bien.visite_data || {};
  const rendement = getNumberLoose(bien.rendement_brut || v.finance?.rendement_brut_calcule || v.finance?.rendement_brut);
  const cash = getNumberLoose(bien.cashflow_estime || v.finance?.cashflow_mensuel || v.finance?.cashflow_mensuel_estime);
  const docs = checklistPct(v.documents_checklist || {}, BIEN_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Score Profero automatique</span></div>
      <div className="inv-card-bd">
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:12}}>
          <div style={{width:72,height:72,borderRadius:"50%",border:`5px solid ${score>=75?SU:score>=50?WA:DA}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:900,color:score>=75?SU:score>=50?WA:DA,fontSize:18}}>{score}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:FONT.md.size,fontWeight:900,color:T.text}}>{score>=75?"Très intéressant":score>=50?"À approfondir":"Risque / à challenger"}</div>
            <div style={{fontSize:FONT.sm.size,color:T.textMuted,marginTop:3}}>Score basé sur rentabilité, cash-flow, conclusion, complétude et risques renseignés</div>
          </div>
        </div>
        <CompletionBar label="Rendement" value={Math.min(100, rendement*8)} color={SU} T={T}/>
        <CompletionBar label="Cash-flow" value={cash>0?Math.min(100, cash/4):20} color={cash>0?SU:WA} T={T}/>
        <CompletionBar label="Documents" value={docs} color={T.accent} T={T}/>
      </div>
    </div>
  );
}

function MatchingClientsBienCard({ bien, clients=[], propositions=[], T=THEMES_INV.dark, onAssociate }) {
  const associated = new Set((propositions||[]).map(p => p.client_id).filter(Boolean));
  const ranked = clients.map(c => ({ c, ...computeClientBienMatch(c, bien) })).sort((a,b)=>b.score-a.score).slice(0,8);
  return (
    <div className="inv-card">
      <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Handshake} size={13}/>Matching clients ↔ bien</span></div>
      <div className="inv-card-bd">
        {ranked.length===0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"16px 0"}}>Aucun client à matcher</div> : ranked.map(({c, score, reasons}) => (
          <div key={c.id} style={{padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text}}>{getClientName(c)}</div>
              <span style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color:score>=75?SU:score>=55?WA:DA}}>{score}%</span>
            </div>
            <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:3}}>{fmtDashboardEur(c.budget || c.strategie_data?.budget_max)} · {c.strategie_data?.strategie || "stratégie à compléter"} · {reasons.slice(0,2).join(" · ") || "compatibilité générale"}</div>
            {onAssociate && !associated.has(c.id) && <button className="inv-btn inv-btn-blue inv-btn-sm" style={{marginTop:7}} onClick={()=>onAssociate(c.id)}>Associer / proposer</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function OffreAchatBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const initial = bien?.visite_data?.offre_achat || {};
  const [data, setData] = useState({ prix_recommande:bien.montant_offre || initial.prix_recommande || "", marge_negociation:initial.marge_negociation || "", statut:initial.statut || "À préparer", arguments:initial.arguments || "", conditions:initial.conditions || "", date_relance:initial.date_relance || bien.date_relance || "" });
  const [msg, setMsg] = useState("");
  useEffect(()=>{ const i=bien?.visite_data?.offre_achat || {}; setData({ prix_recommande:bien.montant_offre || i.prix_recommande || "", marge_negociation:i.marge_negociation || "", statut:i.statut || "À préparer", arguments:i.arguments || "", conditions:i.conditions || "", date_relance:i.date_relance || bien.date_relance || "" }); }, [bien?.id]);
  const upd = (k,v)=>setData(prev=>({...prev,[k]:v}));
  const save = async () => {
    const visite_data = { ...(bien.visite_data || {}), offre_achat:data };
    const payload = { visite_data, montant_offre:getNumberLoose(data.prix_recommande) || null, date_relance:data.date_relance || null };
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Offre sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const genMail = () => {
    const body = `Bonjour,\n\nSuite à l’analyse du bien situé ${[bien.adresse,bien.code_postal,bien.ville].filter(Boolean).join(" ")}, nous souhaiterions transmettre une offre à ${fmtDashboardEur(data.prix_recommande)}.\n\nArguments principaux :\n${data.arguments || "- À compléter"}\n\nConditions souhaitées :\n${data.conditions || "- À compléter"}\n\nBien cordialement,\nProfero Invest`;
    navigator.clipboard?.writeText(body); setMsg("Texte d’offre copié"); setTimeout(()=>setMsg(""),2200);
  };
  return (
    <div className="inv-card">
      <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Send} size={13}/>Module offre d’achat</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label className="inv-kpi-lbl">Prix d’offre recommandé</label><input className="inv-inp" type="number" value={data.prix_recommande} onChange={e=>upd("prix_recommande",e.target.value)} style={{width:"100%"}}/></div>
          <div><label className="inv-kpi-lbl">Marge de négociation</label><input className="inv-inp" value={data.marge_negociation} onChange={e=>upd("marge_negociation",e.target.value)} style={{width:"100%",textAlign:"left"}}/></div>
          <div><label className="inv-kpi-lbl">Statut offre</label><select className="inv-sel" value={data.statut} onChange={e=>upd("statut",e.target.value)} style={{width:"100%"}}>{OFFRE_STATUTS_INVEST.map(o=><option key={o}>{o}</option>)}</select></div>
          <div><label className="inv-kpi-lbl">Date de relance</label><input className="inv-inp" type="date" value={data.date_relance} onChange={e=>upd("date_relance",e.target.value)} style={{width:"100%"}}/></div>
        </div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Arguments de négociation</label><textarea className="inv-textarea" rows={3} value={data.arguments} onChange={e=>upd("arguments",e.target.value)} /></div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Conditions suspensives à prévoir</label><textarea className="inv-textarea" rows={2} value={data.conditions} onChange={e=>upd("conditions",e.target.value)} /></div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:10}}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={genMail}>Copier texte offre</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={save}><Icon as={Save} size={12}/> Enregistrer offre</button></div>
      </div>
    </div>
  );
}

function ChecklistDocumentsBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const [checklist, setChecklist] = useState(() => bien?.visite_data?.documents_checklist || {});
  useEffect(()=>setChecklist(bien?.visite_data?.documents_checklist || {}), [bien?.id]);
  const setStatus = async (key, status) => {
    const next = { ...checklist, [key]:status };
    setChecklist(next);
    const visite_data = { ...(bien.visite_data || {}), documents_checklist:next };
    const { error } = await supabase.from("invest_biens").update({ visite_data }).eq("id", bien.id);
    if (!error) onSaved?.();
  };
  const pct = checklistPct(checklist, BIEN_DOCUMENT_CHECKLIST);
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Checklist documents du bien</span><span style={{fontFamily:"'DM Mono',monospace",color:T.accent}}>{pct}%</span></div>
      <div className="inv-card-bd">
        <CompletionBar label="Documents reçus" value={pct} color={pct>=80?SU:WA} T={T}/>
        {BIEN_DOCUMENT_CHECKLIST.map(([k,label]) => (
          <div key={k} className="inv-row"><span className="inv-lbl">{label}</span><select className="inv-sel" value={checklist?.[k] || ""} onChange={e=>setStatus(k,e.target.value)}><option value="">À demander</option><option value="recu">Reçu</option><option value="na">Non applicable</option><option value="verifier">À vérifier</option></select></div>
        ))}
      </div>
    </div>
  );
}

function HistoriqueBienCard({ bien, propositions=[], T=THEMES_INV.dark }) {
  const events = [];
  if (bien.created_at) events.push([bien.created_at, "Création du bien", bien.created_by || "Stock de biens"]);
  if (bien.updated_at) events.push([bien.updated_at, "Dernière mise à jour", bien.statut || "Fiche bien"]);
  if (bien.date_visite) events.push([bien.date_visite, "Visite du bien", bien.conseiller_profero || "Conseiller"]);
  if (bien.visite_data?.simulateur_updated_at) events.push([bien.visite_data.simulateur_updated_at, "Simulation mise à jour", "Simulateur intégré"]);
  propositions.forEach(p => events.push([p.created_at || p.date_proposition, `Bien proposé à ${p.client?.prenom || ""} ${p.client?.nom || ""}`.trim(), p.statut || "proposé"]));
  events.sort((a,b)=>new Date(b[0])-new Date(a[0]));
  return (
    <div className="inv-card">
      <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13}/>Historique activité</span></div>
      <div className="inv-card-bd">
        {events.length===0 ? <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic",textAlign:"center",padding:"14px 0"}}>Aucun historique</div> : events.slice(0,8).map((e,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"86px 1fr",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>{safeDate(e[0])}</div><div><div style={{fontWeight:800,color:T.text,fontSize:FONT.sm.size+1}}>{e[1]}</div><div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{e[2]}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}



function buildQuickBienAnalysis(bien = {}) {
  const v = bien.visite_data || {};
  const surface = getNumberLoose(v.general?.surface_totale || bien.surface || v.finance?.surface_totale);
  const prix = getNumberLoose(bien.prix_vente || v.general?.prix_affiche);
  const travaux = getNumberLoose(bien.prix_travaux || v.finance?.budget_travaux_ttc);
  const offre = getNumberLoose(bien.montant_offre || v.conclusion?.prix_offre_recommande || v.finance?.prix_acquisition_negocie);
  const total = getNumberLoose(bien.cout_total) || (offre || prix) + travaux;
  const loyers = getNumberLoose(v.configuration?.total_loyers_mensuels || v.finance?.loyers_bruts_mensuels);
  const rendement = getNumberLoose(bien.rendement_brut) || (total > 0 && loyers > 0 ? (loyers*12/total)*100 : 0);
  const cash = getNumberLoose(bien.cashflow_estime || v.finance?.cashflow_mensuel_estime);
  const prixM2 = surface > 0 && prix > 0 ? prix / surface : 0;
  const totalM2 = surface > 0 && total > 0 ? total / surface : 0;
  const score = computeAutoBienScore(bien);
  const recommendation = score >= 75 || rendement >= 10 ? "À prioriser" : score >= 50 || rendement >= 8 ? "À approfondir" : "À challenger";
  const alerts = [];
  if (!surface) alerts.push("surface manquante");
  if (!loyers) alerts.push("loyers cibles manquants");
  if (!travaux) alerts.push("travaux à estimer");
  if (!offre) alerts.push("offre à définir");
  return { surface, prix, travaux, offre, total, loyers, rendement, cash, prixM2, totalM2, score, recommendation, alerts };
}

function AnalyseRapideBienCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const a = buildQuickBienAnalysis(bien);
  const [msg, setMsg] = useState("");
  const save = async () => {
    const visite_data = { ...(bien.visite_data || {}), analyse_rapide:{ ...a, saved_at:new Date().toISOString() } };
    const payload = { visite_data };
    if (a.total > 0) payload.cout_total = Math.round(a.total);
    if (a.rendement > 0) payload.rendement_brut = Number(a.rendement.toFixed(2));
    if (Number.isFinite(a.cash) && a.cash !== 0) payload.cashflow_estime = Math.round(a.cash);
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Analyse rapide sauvegardée"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  return (
    <div className="inv-card">
      <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={TrendingUp} size={13}/>Analyse rapide du bien</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Prix / m²", a.prixM2 ? `${Math.round(a.prixM2).toLocaleString("fr-FR")} €/m²` : "—"],["Coût total / m²", a.totalM2 ? `${Math.round(a.totalM2).toLocaleString("fr-FR")} €/m²` : "—"],["Coût total", fmtDashboardEur(a.total)],["Loyers mensuels", fmtDashboardEur(a.loyers)],["Rendement brut", a.rendement ? fmtDashboardPct(a.rendement) : "—"],["Cash-flow", a.cash ? `${fmtDashboardEur(a.cash)}/mois` : "—"]].map(([l,v])=>(
            <div key={l} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 10px"}}>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,textTransform:"uppercase",fontWeight:800,letterSpacing:.7}}>{l}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size+1,fontWeight:900,color:T.text,marginTop:3}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:10,padding:"10px 12px",borderRadius:RADIUS.md,background:a.recommendation==="À prioriser"?SEMANTIC.success.bg:a.recommendation==="À approfondir"?SEMANTIC.warning.bg:SEMANTIC.danger.bg,border:`1px solid ${a.recommendation==="À prioriser"?SEMANTIC.success.border:a.recommendation==="À approfondir"?SEMANTIC.warning.border:SEMANTIC.danger.border}`,color:a.recommendation==="À prioriser"?SU:a.recommendation==="À approfondir"?WA:DA,fontWeight:900,fontSize:FONT.sm.size+1}}>
          Décision rapide : {a.recommendation}
        </div>
        {a.alerts.length > 0 && <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8}}>À compléter : {a.alerts.join(" · ")}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={save}><Icon as={Save} size={12}/> Sauvegarder l’analyse</button></div>
      </div>
    </div>
  );
}

const MODE_VISITE_TERRAIN_OPTIONS = ["", "OK", "À vérifier", "Problème", "Non vu"];
const MODE_VISITE_CONCLUSIONS = ["", "À creuser", "Offre possible", "Contre-visite", "Abandonner"];
function ModeVisiteTerrainCard({ bien, T=THEMES_INV.dark, onSaved }) {
  const initial = bien?.visite_data?.mode_visite_terrain || {};
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(()=>setData(bien?.visite_data?.mode_visite_terrain || {}), [bien?.id]);
  const upd = (k,v)=>setData(prev=>({...prev,[k]:v}));
  const save = async () => {
    setSaving(true); setMsg("");
    const visite_data = { ...(bien.visite_data || {}), mode_visite_terrain:{ ...data, updated_at:new Date().toISOString(), conseiller:data.conseiller || bien.conseiller_profero || "" } };
    const payload = { visite_data };
    if (data.date_visite) payload.date_visite = data.date_visite;
    if (data.prochaine_action_date) payload.date_relance = data.prochaine_action_date;
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    setSaving(false);
    if (error) setMsg(`Erreur : ${error.message}`); else { setMsg("Mode visite sauvegardé"); onSaved?.(); setTimeout(()=>setMsg(""),2200); }
  };
  const quickField = (label, key) => (
    <div>
      <label className="inv-kpi-lbl">{label}</label>
      <select className="inv-sel" value={data[key] || ""} onChange={e=>upd(key,e.target.value)} style={{width:"100%"}}>{MODE_VISITE_TERRAIN_OPTIONS.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select>
    </div>
  );
  return (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Mode visite terrain</span></div>
      <div className="inv-card-bd">
        {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label className="inv-kpi-lbl">Date de visite</label><input className="inv-inp" type="date" value={data.date_visite || bien.date_visite || ""} onChange={e=>upd("date_visite",e.target.value)} style={{width:"100%"}}/></div>
          <div><label className="inv-kpi-lbl">Conclusion rapide</label><select className="inv-sel" value={data.conclusion || ""} onChange={e=>upd("conclusion",e.target.value)} style={{width:"100%"}}>{MODE_VISITE_CONCLUSIONS.map(o=><option key={o} value={o}>{o || "—"}</option>)}</select></div>
          {quickField("État général", "etat_general")}
          {quickField("Toiture / façade", "toiture_facade")}
          {quickField("Humidité", "humidite")}
          {quickField("Électricité", "electricite")}
          {quickField("Plomberie", "plomberie")}
          {quickField("Découpe possible", "decoupe")}
        </div>
        <div style={{marginTop:10}}><label className="inv-kpi-lbl">Risques immédiats / notes terrain</label><textarea className="inv-textarea" rows={3} value={data.commentaire || ""} onChange={e=>upd("commentaire", e.target.value)} placeholder="Dictée vocale possible sur mobile : toiture, humidité, réseaux, accès, potentiel…"/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 140px",gap:10,marginTop:10}}>
          <div><label className="inv-kpi-lbl">Prochaine action</label><input className="inv-inp" value={data.prochaine_action || ""} onChange={e=>upd("prochaine_action", e.target.value)} style={{width:"100%",textAlign:"left"}} placeholder="Ex : demander DDT, rappeler agent, faire offre…"/></div>
          <div><label className="inv-kpi-lbl">Date relance</label><input className="inv-inp" type="date" value={data.prochaine_action_date || bien.date_relance || ""} onChange={e=>upd("prochaine_action_date", e.target.value)} style={{width:"100%"}}/></div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={save} disabled={saving}><Icon as={Save} size={12}/> {saving?"Sync…":"Enregistrer visite"}</button></div>
      </div>
    </div>
  );
}



const VISITE_TERRAIN_STATUS_OPTIONS = ["", "OK", "À vérifier", "Problème", "Non vu", "Non applicable"];
const VISITE_TERRAIN_DECISIONS = ["À creuser", "Offre possible", "Contre-visite", "Abandonner"];
const VISITE_TERRAIN_INTERETS = ["Très intéressant", "Intéressant", "Moyen", "Faible", "Non pertinent"];
const VISITE_TERRAIN_POTENTIELS = ["Oui", "Non", "À vérifier"];
const VISITE_TERRAIN_TEMPS = ["15 min", "30 min", "45 min", "1 h", "+1 h"];
const VISITE_TERRAIN_ACTIONS_RAPIDES = ["Faire offre", "Demander DDT", "Faire devis travaux", "Contacter urbanisme", "Programmer contre-visite", "Abandonner"];
const VISITE_TERRAIN_STATUS_META = {
  "OK": { label:"OK", short:"OK", color:SU, bg:SEMANTIC.success.bg, border:SEMANTIC.success.border },
  "À vérifier": { label:"À vérifier", short:"?", color:WA, bg:SEMANTIC.warning.bg, border:SEMANTIC.warning.border },
  "Problème": { label:"Problème", short:"!", color:DA, bg:SEMANTIC.danger.bg, border:SEMANTIC.danger.border },
  "Non vu": { label:"Non vu", short:"—", color:"#8b93a7", bg:"rgba(139,147,167,.12)", border:"rgba(139,147,167,.28)" },
  "Non applicable": { label:"N/A", short:"N/A", color:"#8b93a7", bg:"rgba(139,147,167,.08)", border:"rgba(139,147,167,.22)" },
};
const VISITE_TERRAIN_POINTS = [
  { group:"Extérieur & structure", hint:"Ce qui peut bloquer ou coûter cher", items:[
    ["toiture", "Toiture"], ["charpente", "Charpente"], ["facade", "Façade"], ["fissures", "Fissures"], ["humidite", "Humidité"],
  ]},
  { group:"Réseaux & équipements", hint:"État des réseaux et individualisation possible", items:[
    ["electricite", "Électricité"], ["plomberie", "Plomberie"], ["chauffage", "Chauffage"], ["vmc", "VMC"], ["compteurs", "Compteurs"],
  ]},
  { group:"Découpe & exploitation", hint:"Potentiel de création de lots et facilité d’exploitation", items:[
    ["acces", "Accès indépendants"], ["escaliers", "Circulation / escaliers"], ["stationnement", "Stationnement"], ["configuration", "Configuration lots"], ["marche_locatif", "Marché locatif"],
  ]},
  { group:"Réglementaire", hint:"Points à valider avant offre ou travaux", items:[
    ["copro", "Copropriété"], ["urbanisme", "Urbanisme / division"], ["dpe", "DPE / énergie"], ["documents", "Documents disponibles"],
  ]},
];
const VISITE_TERRAIN_DOCS = [
  ["photos", "Photos prises"], ["diagnostics", "Diagnostics / DDT"], ["plans", "Plans"], ["taxe_fonciere", "Taxe foncière"], ["devis", "Devis travaux"], ["copro", "Docs copropriété"], ["baux", "Baux existants"],
];

function normaliseModeVisiteTerrain(bien = {}) {
  const raw = bien?.visite_data?.mode_visite_terrain || {};
  const points = { ...(raw.points || {}) };
  VISITE_TERRAIN_POINTS.flatMap(g => g.items).forEach(([key]) => {
    points[key] = { statut:"", commentaire:"", ...(points[key] || {}) };
  });
  const docs = { ...(raw.docs || {}) };
  VISITE_TERRAIN_DOCS.forEach(([key]) => { if (docs[key] === undefined) docs[key] = false; });
  return {
    date_visite: raw.date_visite || bien.date_visite || new Date().toISOString().slice(0,10),
    conseiller: raw.conseiller || bien.conseiller_profero || "",
    temps_visite: raw.temps_visite || "",
    interet: raw.interet || "",
    conclusion: raw.conclusion || "",
    potentiel_decoupe: raw.potentiel_decoupe || "",
    offre_possible: raw.offre_possible || "",
    nombre_lots_possible: raw.nombre_lots_possible || "",
    budget_travaux_ressenti: raw.budget_travaux_ressenti || "",
    points,
    docs,
    photos_commentaire: raw.photos_commentaire || "",
    points_forts: raw.points_forts || "",
    points_blocants: raw.points_blocants || "",
    questions_agent: raw.questions_agent || "",
    prochaine_action: raw.prochaine_action || "",
    prochaine_action_date: raw.prochaine_action_date || bien.date_relance || "",
    commentaire: raw.commentaire || "",
    updated_at: raw.updated_at || null,
  };
}

function ModeVisiteTerrainOnglet({ bien, profil, T=THEMES_INV.dark, onSaved }) {
  const [data, setData] = useState(() => normaliseModeVisiteTerrain(bien));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const autoSaveRef = useRef(null);
  const bootRef = useRef(true);
  const latestRef = useRef(data);

  useEffect(() => {
    const next = normaliseModeVisiteTerrain(bien);
    setData(next);
    latestRef.current = next;
    bootRef.current = true;
  }, [bien?.id]);

  const updateData = (patch) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      latestRef.current = next;
      return next;
    });
  };
  const updatePoint = (key, patch) => {
    setData(prev => {
      const next = { ...prev, points:{ ...prev.points, [key]:{ ...(prev.points?.[key] || {}), ...patch } } };
      latestRef.current = next;
      return next;
    });
  };
  const updateDoc = (key, value) => {
    setData(prev => {
      const next = { ...prev, docs:{ ...prev.docs, [key]: value } };
      latestRef.current = next;
      return next;
    });
  };
  const setGroupStatus = (items, statut) => {
    setData(prev => {
      const nextPoints = { ...prev.points };
      items.forEach(([key]) => { nextPoints[key] = { ...(nextPoints[key] || {}), statut }; });
      const next = { ...prev, points:nextPoints };
      latestRef.current = next;
      return next;
    });
  };

  const pointLabels = VISITE_TERRAIN_POINTS.flatMap(g => g.items);
  const statusDone = pointLabels.filter(([key]) => !!latestRef.current.points?.[key]?.statut).length;
  const decisionDone = ["date_visite", "interet", "conclusion", "potentiel_decoupe", "prochaine_action"].filter(k => String(latestRef.current[k] || "").trim()).length;
  const docsDone = VISITE_TERRAIN_DOCS.filter(([key]) => !!latestRef.current.docs?.[key]).length;
  const total = pointLabels.length + 5 + VISITE_TERRAIN_DOCS.length;
  const done = statusDone + decisionDone + docsDone;
  const pct = Math.min(100, Math.round((done / Math.max(total, 1)) * 100));
  const missing = [
    ...(!data.date_visite ? ["Date de visite"] : []),
    ...(!data.interet ? ["Intérêt du bien"] : []),
    ...(!data.conclusion ? ["Décision rapide"] : []),
    ...(!data.potentiel_decoupe ? ["Potentiel de découpe"] : []),
    ...(!data.prochaine_action ? ["Prochaine action"] : []),
    ...pointLabels.filter(([key]) => !data.points?.[key]?.statut).map(([,label]) => label),
    ...VISITE_TERRAIN_DOCS.filter(([key]) => !data.docs?.[key]).map(([,label]) => label),
  ];
  const problemes = pointLabels.filter(([key]) => data.points?.[key]?.statut === "Problème").map(([,label]) => label);
  const aVerifier = pointLabels.filter(([key]) => data.points?.[key]?.statut === "À vérifier").map(([,label]) => label);
  const docsChecked = VISITE_TERRAIN_DOCS.filter(([key]) => !!data.docs?.[key]).length;

  const getSuggestedStatut = (d) => {
    if (d.conclusion === "Offre possible") return "Offre à faire";
    if (d.conclusion === "Abandonner") return "Abandonné";
    if (d.conclusion === "Contre-visite") return "À relancer";
    if (d.conclusion === "À creuser") return "Visité";
    return bien.statut || "Visité";
  };

  const save = async ({ silent=false } = {}) => {
    if (!bien?.id) return;
    const d = latestRef.current;
    setSaving(true);
    setMsg("");
    const mode_visite_terrain = {
      ...d,
      conseiller: d.conseiller || profil?.nom || bien.conseiller_profero || "",
      completion_pct: pct,
      updated_at: new Date().toISOString(),
    };
    const visite_data = {
      ...(bien.visite_data || {}),
      mode_visite_terrain,
      conclusion: {
        ...(bien.visite_data?.conclusion || {}),
        recommandation: d.conclusion === "Offre possible" ? "Passer à l'offre" : d.conclusion === "Abandonner" ? "Abandonner" : (bien.visite_data?.conclusion?.recommandation || ""),
        prochaine_etape: d.prochaine_action || bien.visite_data?.conclusion?.prochaine_etape || "",
        commentaire_conseiller: d.commentaire || bien.visite_data?.conclusion?.commentaire_conseiller || "",
      },
    };
    const payload = {
      visite_data,
      date_visite: d.date_visite || bien.date_visite || null,
      date_relance: d.prochaine_action_date || bien.date_relance || null,
      statut: getSuggestedStatut(d),
      statut_relance: d.prochaine_action || bien.statut_relance || null,
    };
    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    setSaving(false);
    if (error) {
      setMsg(`Erreur sauvegarde : ${error.message}`);
      if (!silent) alert("Erreur sauvegarde visite terrain : " + error.message);
      return;
    }
    setSaved(true);
    if (!silent) setMsg("Visite terrain sauvegardée");
    setTimeout(() => { setSaved(false); if (!silent) setMsg(""); }, 2200);
    onSaved?.();
  };

  useEffect(() => {
    if (bootRef.current) { bootRef.current = false; return; }
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => save({ silent:true }), 700);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const getStatusMeta = (st) => VISITE_TERRAIN_STATUS_META[st] || { color:T.textMuted, bg:T.input, border:T.border, label:st || "—", short:"—" };
  const quickBtnBase = {
    borderRadius:RADIUS.md,
    fontFamily:"inherit",
    cursor:"pointer",
    transition:"all .12s",
    fontWeight:900,
    border:`1px solid ${T.border}`,
    background:T.input,
    color:T.textSub,
  };

  const ChoiceButton = ({ value, activeValue, onClick, tone="blue", children, style }) => {
    const active = activeValue === value;
    const isDanger = value === "Abandonner" || tone === "danger";
    const isSuccess = value === "Offre possible" || value === "Oui" || tone === "success";
    const activeColor = isDanger ? DA : isSuccess ? SU : tone === "warning" ? WA : T.accent;
    const activeBg = isDanger ? SEMANTIC.danger.bg : isSuccess ? SEMANTIC.success.bg : tone === "warning" ? SEMANTIC.warning.bg : T.accentBg;
    const activeBorder = isDanger ? SEMANTIC.danger.border : isSuccess ? SEMANTIC.success.border : tone === "warning" ? SEMANTIC.warning.border : T.accentBorder;
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...quickBtnBase,
          background:active ? activeBg : T.input,
          border:`1px solid ${active ? activeBorder : T.border}`,
          color:active ? activeColor : T.textSub,
          padding:"9px 10px",
          minHeight:38,
          ...style,
        }}
      >{children || value}</button>
    );
  };

  const StatusButtons = ({ itemKey, row }) => (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
      {["OK", "À vérifier", "Problème", "Non vu"].map(st => {
        const meta = getStatusMeta(st);
        const active = row.statut === st;
        return (
          <button
            key={st}
            type="button"
            onClick={() => updatePoint(itemKey, { statut:st })}
            title={meta.label}
            style={{
              ...quickBtnBase,
              padding:"7px 5px",
              minHeight:34,
              fontSize:FONT.xs.size+1,
              background:active ? meta.bg : T.card,
              border:`1px solid ${active ? meta.border : T.border}`,
              color:active ? meta.color : T.textMuted,
            }}
          >{st === "À vérifier" ? "À vérif." : st}</button>
        );
      })}
    </div>
  );

  const DocTile = ({ itemKey, label }) => {
    const active = !!data.docs?.[itemKey];
    return (
      <button
        type="button"
        onClick={() => updateDoc(itemKey, !active)}
        style={{
          display:"flex",
          alignItems:"center",
          gap:8,
          textAlign:"left",
          fontFamily:"inherit",
          cursor:"pointer",
          borderRadius:RADIUS.md,
          padding:"9px 10px",
          border:`1px solid ${active ? SEMANTIC.success.border : T.border}`,
          background:active ? SEMANTIC.success.bg : T.input,
          color:active ? SU : T.textSub,
          fontWeight:800,
        }}
      >
        <span style={{width:20,height:20,borderRadius:6,border:`1px solid ${active ? SU : T.border}`,display:"flex",alignItems:"center",justifyContent:"center",background:active ? SU : T.card,color:active ? "white" : T.textMuted,fontSize:12,fontWeight:900}}>{active ? "✓" : ""}</span>
        <span>{label}</span>
      </button>
    );
  };

  const QuickInput = ({ label, value, onChange, placeholder="", type="text" }) => (
    <div>
      <label className="inv-kpi-lbl">{label}</label>
      <input className="inv-inp" type={type} value={value || ""} onChange={e=>onChange(e.target.value)} style={{width:"100%",textAlign:type==="number"?"right":"left"}} placeholder={placeholder}/>
    </div>
  );

  const QuickTextarea = ({ label, value, onChange, placeholder="", rows=2 }) => (
    <div>
      <label className="inv-kpi-lbl">{label}</label>
      <textarea className="inv-textarea" rows={rows} value={value || ""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );

  return (
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16,alignItems:"start"}}>
      <div style={{position:"sticky",top:14,display:"flex",flexDirection:"column",gap:12}}>
        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Visite terrain rapide</span></div>
          <div className="inv-card-bd">
            {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
              <div>
                <div className="inv-kpi-lbl">Complétion terrain</div>
                <div style={{fontSize:FONT.h2.size,fontWeight:900,color:T.text,lineHeight:1}}>{pct}%</div>
              </div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,textAlign:"right"}}>{done}/{total}<br/>réponses</div>
            </div>
            <div style={{height:8,borderRadius:RADIUS.pill,background:T.input,overflow:"hidden",border:`1px solid ${T.border}`}}>
              <div style={{height:"100%",width:`${pct}%`,background:pct>=80?SU:pct>=45?WA:DA,transition:"width .2s"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
              <div style={{padding:8,borderRadius:RADIUS.md,background:SEMANTIC.danger.bg,border:`1px solid ${SEMANTIC.danger.border}`,color:DA,fontWeight:800,fontSize:FONT.sm.size}}>⚠ {problemes.length} problème{problemes.length>1?"s":""}</div>
              <div style={{padding:8,borderRadius:RADIUS.md,background:SEMANTIC.warning.bg,border:`1px solid ${SEMANTIC.warning.border}`,color:WA,fontWeight:800,fontSize:FONT.sm.size}}>⏳ {aVerifier.length} à vérifier</div>
            </div>
            <div style={{marginTop:10,padding:10,borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
              <div className="inv-kpi-lbl">Décision actuelle</div>
              <div style={{fontSize:FONT.md.size,fontWeight:900,color:data.conclusion === "Abandonner" ? DA : data.conclusion === "Offre possible" ? SU : T.accent,marginTop:3}}>{data.conclusion || "À choisir"}</div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3}}>Action : {data.prochaine_action || "à compléter"}</div>
            </div>
            <button className="inv-btn inv-btn-blue" onClick={() => save({ silent:false })} disabled={saving} style={{width:"100%",justifyContent:"center",marginTop:12}}>
              <Icon as={saving ? RefreshCw : Save} size={13} style={saving ? {animation:"spin 1s linear infinite"} : undefined}/>
              {saving ? "Sauvegarde…" : saved ? "Sauvegardé" : "Enregistrer la visite"}
            </button>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:8,lineHeight:1.45}}>Autosave actif. Les boutons sont pensés pour une saisie rapide sur téléphone ou tablette.</div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd"><span>À compléter</span></div>
          <div className="inv-card-bd" style={{maxHeight:270,overflowY:"auto"}}>
            {missing.length === 0 ? (
              <div style={{fontSize:FONT.sm.size,color:SU,fontWeight:800}}>Toutes les réponses terrain sont complétées.</div>
            ) : missing.slice(0,18).map(m => (
              <div key={m} style={{fontSize:FONT.xs.size+1,color:T.textSub,padding:"4px 0",borderBottom:`1px solid ${T.rowBorder}`}}>• {m}</div>
            ))}
            {missing.length > 18 && <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:6}}>+ {missing.length-18} autres éléments</div>}
          </div>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div className="inv-card">
          <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Décision en 30 secondes</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:14}}>
              {VISITE_TERRAIN_DECISIONS.map(v => <ChoiceButton key={v} value={v} activeValue={data.conclusion} onClick={() => updateData({ conclusion:v })}>{v}</ChoiceButton>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12}}>
              <div>
                <label className="inv-kpi-lbl">Intérêt du bien</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>{VISITE_TERRAIN_INTERETS.map(v => <ChoiceButton key={v} value={v} activeValue={data.interet} onClick={() => updateData({ interet:v })} style={{fontSize:FONT.xs.size+1}}>{v}</ChoiceButton>)}</div>
              </div>
              <div>
                <label className="inv-kpi-lbl">Potentiel découpe</label>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>{VISITE_TERRAIN_POTENTIELS.map(v => <ChoiceButton key={v} value={v} activeValue={data.potentiel_decoupe} onClick={() => updateData({ potentiel_decoupe:v })} style={{fontSize:FONT.xs.size+1}}>{v}</ChoiceButton>)}</div>
              </div>
              <div>
                <label className="inv-kpi-lbl">Offre possible</label>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>{VISITE_TERRAIN_POTENTIELS.map(v => <ChoiceButton key={v} value={v} activeValue={data.offre_possible} onClick={() => updateData({ offre_possible:v })} style={{fontSize:FONT.xs.size+1}}>{v}</ChoiceButton>)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Calendar} size={13}/>Infos de visite</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
              <QuickInput label="Date visite" type="date" value={data.date_visite} onChange={v=>updateData({date_visite:v})}/>
              <QuickInput label="Conseiller" value={data.conseiller} onChange={v=>updateData({conseiller:v})} placeholder={profil?.nom||"Conseiller"}/>
              <div>
                <label className="inv-kpi-lbl">Temps de visite</label>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>{VISITE_TERRAIN_TEMPS.map(v => <ChoiceButton key={v} value={v} activeValue={data.temps_visite} onClick={() => updateData({ temps_visite:v })} style={{padding:"7px 4px",fontSize:FONT.xs.size}}>{v}</ChoiceButton>)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Check} size={13}/>Checklist terrain à cocher</span></div>
          <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:14}}>
            {VISITE_TERRAIN_POINTS.map(group => (
              <div key={group.group} style={{border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,background:T.card,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",background:T.sectionHd,borderBottom:`1px solid ${T.border}`}}>
                  <div>
                    <div style={{fontSize:FONT.xs.size,fontWeight:900,color:T.accent,textTransform:"uppercase",letterSpacing:1.2}}>{group.group}</div>
                    <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2}}>{group.hint}</div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setGroupStatus(group.items, "OK")}>Tout OK</button>
                    <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setGroupStatus(group.items, "Non vu")}>Non vu</button>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8,padding:10}}>
                  {group.items.map(([key,label]) => {
                    const row = data.points?.[key] || {};
                    const meta = getStatusMeta(row.statut);
                    const needsComment = row.statut === "À vérifier" || row.statut === "Problème";
                    return (
                      <div key={key} style={{border:`1px solid ${row.statut ? meta.border : T.border}`,borderRadius:RADIUS.md,background:row.statut ? meta.bg : T.input,padding:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text}}>{label}</div>
                          <span style={{fontSize:FONT.xs.size,fontWeight:900,color:row.statut ? meta.color : T.textMuted}}>{row.statut || "À cocher"}</span>
                        </div>
                        <StatusButtons itemKey={key} row={row}/>
                        {(needsComment || row.commentaire) && (
                          <input className="inv-inp" value={row.commentaire || ""} onChange={e=>updatePoint(key,{commentaire:e.target.value})} style={{width:"100%",textAlign:"left",fontSize:FONT.xs.size+1,marginTop:8}} placeholder={needsComment ? "Pourquoi ? détail rapide…" : "Commentaire rapide…"}/>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div className="inv-card">
            <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13}/>Potentiel & chiffres à chaud</span></div>
            <div className="inv-card-bd">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <QuickInput label="Lots possibles" value={data.nombre_lots_possible} onChange={v=>updateData({nombre_lots_possible:v})} placeholder="Ex : 4"/>
                <QuickInput label="Travaux ressentis" value={data.budget_travaux_ressenti} onChange={v=>updateData({budget_travaux_ressenti:v})} placeholder="Ex : 140 000"/>
              </div>
              <QuickTextarea label="Points forts" rows={2} value={data.points_forts} onChange={v=>updateData({points_forts:v})} placeholder="Emplacement, volumes, accès, luminosité…"/>
              <div style={{height:10}}/>
              <QuickTextarea label="Points bloquants" rows={2} value={data.points_blocants} onChange={v=>updateData({points_blocants:v})} placeholder="Structure, humidité, copropriété, DPE…"/>
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Documents & photos</span><span style={{fontFamily:"'DM Mono',monospace",color:T.accent}}>{docsChecked}/{VISITE_TERRAIN_DOCS.length}</span></div>
            <div className="inv-card-bd">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {VISITE_TERRAIN_DOCS.map(([key,label]) => <DocTile key={key} itemKey={key} label={label}/>) }
              </div>
              <QuickTextarea label="Note documents / photos" rows={3} value={data.photos_commentaire} onChange={v=>updateData({photos_commentaire:v})} placeholder="Photos manquantes, documents à demander, pièces bloquantes…"/>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13}/>Suite à donner</span></div>
          <div className="inv-card-bd">
            <div style={{marginBottom:10}}>
              <label className="inv-kpi-lbl">Action rapide</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:7}}>
                {VISITE_TERRAIN_ACTIONS_RAPIDES.map(v => <ChoiceButton key={v} value={v} activeValue={data.prochaine_action} onClick={() => updateData({prochaine_action:v})} tone={v === "Abandonner" ? "danger" : v === "Faire offre" ? "success" : "blue"} style={{fontSize:FONT.xs.size+1}}>{v}</ChoiceButton>)}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 160px",gap:10,marginBottom:10}}>
              <QuickInput label="Prochaine action personnalisée" value={data.prochaine_action} onChange={v=>updateData({prochaine_action:v})} placeholder="Ex : rappeler agent, demander plans…"/>
              <QuickInput label="Date relance" type="date" value={data.prochaine_action_date} onChange={v=>updateData({prochaine_action_date:v})}/>
            </div>
            <QuickTextarea label="Questions à poser / notes libres" rows={3} value={data.questions_agent} onChange={v=>updateData({questions_agent:v})} placeholder="Questions à l’agent, mairie, Profero Rénovation…"/>
            <div style={{height:10}}/>
            <QuickTextarea label="Commentaire final terrain" rows={3} value={data.commentaire} onChange={v=>updateData({commentaire:v})} placeholder="Conclusion terrain rapide : pourquoi on poursuit ou pourquoi on abandonne…"/>
          </div>
        </div>
      </div>
    </div>
  );
}


const STATUTS_BIEN = ["À analyser","Agent contacté","Visite programmée","Visité","À relancer","Offre à faire","Offre envoyée","Offre refusée","Offre acceptée","Abandonné","Proposé à un client","En cours d'acquisition"];
const STATUT_BIEN_COLORS = {
  "À analyser":"#9aa0b0","Agent contacté":"#1f4ea1","Visite programmée":"#6b3a8a",
  "Visité":"#1a7a4a","À relancer":"#c0392b","Offre à faire":"#c9a84c",
  "Offre envoyée":"#d4610a","Offre refusée":"#c0392b","Offre acceptée":"#1a7a4a",
  "Abandonné":"#5a6070","Proposé à un client":"#1f4ea1","En cours d'acquisition":"#1a7a4a",
};


const GOOGLE_MAPS_API_KEY = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  || (typeof process !== "undefined" && process.env && process.env.REACT_APP_GOOGLE_MAPS_API_KEY)
  || "AIzaSyB9LLndlvqmpaxGg4zZoZzu5lzQYs4QQRg"
);
const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js-api-profero-invest";

function getGoogleMapsApiKey() {
  return (GOOGLE_MAPS_API_KEY || "").trim();
}

function getBienGoogleAddress(b) {
  return [b.adresse, b.code_postal, b.ville].filter(Boolean).join(", ").trim();
}

function googleMapsSearchUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function getBienMapQuery(bien = {}) {
  const lat = parseFloat(bien.latitude ?? bien.visite_data?.identification?.latitude);
  const lng = parseFloat(bien.longitude ?? bien.visite_data?.identification?.longitude);

  if (isValidLatLng(lat, lng)) return `${lat},${lng}`;

  return getBienGoogleAddress(bien);
}

function googleMapsEmbedUrl(query) {
  const clean = String(query || "").trim();
  if (!clean) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(clean)}&output=embed`;
}

function googleMapsEmbedUrlForBien(bien = {}) {
  return googleMapsEmbedUrl(getBienMapQuery(bien));
}

function getBienFullAddress(bien = {}) {
  return [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(" ").trim();
}

function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function loadGoogleMapsApi(apiKey) {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps doit être chargé côté navigateur."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE_API_GOOGLE_MAPS") {
    return Promise.reject(new Error("Clé API Google Maps manquante."));
  }
  if (window.__proferoGoogleMapsPromise) return window.__proferoGoogleMapsPromise;

  window.__proferoGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps), { once:true });
      existing.addEventListener("error", () => reject(new Error("Chargement Google Maps impossible.")), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&language=fr&region=FR`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Chargement Google Maps impossible. Vérifiez la clé API et les restrictions de domaine."));
    document.head.appendChild(script);
  });
  return window.__proferoGoogleMapsPromise;
}

function readGeocodeCache() {
  try { return JSON.parse(localStorage.getItem("profero_invest_geocode_cache_v1") || "{}"); }
  catch { return {}; }
}

function writeGeocodeCache(cache) {
  try { localStorage.setItem("profero_invest_geocode_cache_v1", JSON.stringify(cache || {})); }
  catch {}
}

async function geocodeAddressWithApiAdresse(address) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) return { error:"Adresse manquante" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cleanAddress)}&limit=1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return { error:`API Adresse indisponible (${response.status})` };

    const json = await response.json();
    const feature = json?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return { error:"Adresse introuvable" };

    const lng = parseFloat(coords[0]);
    const lat = parseFloat(coords[1]);
    if (!isValidLatLng(lat, lng)) return { error:"Coordonnées invalides" };

    return {
      lat,
      lng,
      formatted_address: feature?.properties?.label || cleanAddress,
      status:"OK",
      source:"api-adresse",
    };
  } catch (e) {
    return { error: e?.name === "AbortError" ? "API Adresse trop lente" : (e?.message || "Géocodage API Adresse impossible") };
  }
}

function geocodeAddress(geocoder, address) {
  return new Promise(resolve => {
    geocoder.geocode({ address, region:"FR" }, async (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          formatted_address: results[0].formatted_address || address,
          status,
          source:"google",
        });
        return;
      }

      // Fallback France : si Google refuse le géocodage (REQUEST_DENIED) ou ne trouve pas,
      // on utilise l'API Adresse nationale pour créer latitude/longitude à partir de l'adresse.
      const fallback = await geocodeAddressWithApiAdresse(address);
      if (fallback?.lat && fallback?.lng && isValidLatLng(fallback.lat, fallback.lng)) {
        resolve({ ...fallback, google_status: status || "UNKNOWN_ERROR" });
      } else {
        resolve({ error: status || fallback?.error || "UNKNOWN_ERROR" });
      }
    });
  });
}

async function saveBienCoordinatesIfPossible(bienId, lat, lng) {
  try {
    await supabase.from("invest_biens").update({ latitude: lat, longitude: lng }).eq("id", bienId);
  } catch (e) {
    // La carte continue à fonctionner même si les colonnes ou les droits d'écriture ne sont pas disponibles.
  }
}

async function getCoordinatesFromAddress(address) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) return { lat:null, lng:null, error:"Adresse manquante" };

  const cache = readGeocodeCache();
  if (cache[cleanAddress] && isValidLatLng(cache[cleanAddress].lat, cache[cleanAddress].lng)) {
    return { ...cache[cleanAddress], source:"cache" };
  }

  // 1) Priorité à l'adresse française : génère latitude/longitude sans dépendre
  // du statut REQUEST_DENIED de Google Geocoding.
  const adresseNationale = await geocodeAddressWithApiAdresse(cleanAddress);
  if (adresseNationale?.lat && adresseNationale?.lng && isValidLatLng(adresseNationale.lat, adresseNationale.lng)) {
    const coords = {
      lat: adresseNationale.lat,
      lng: adresseNationale.lng,
      formatted_address: adresseNationale.formatted_address || cleanAddress,
      source:"api-adresse",
    };
    cache[cleanAddress] = coords;
    writeGeocodeCache(cache);
    return coords;
  }

  // 2) Fallback Google si l'adresse n'est pas reconnue par l'API Adresse.
  try {
    const maps = await loadGoogleMapsApi(getGoogleMapsApiKey());
    const geocoder = new maps.Geocoder();
    const geo = await geocodeAddress(geocoder, cleanAddress);

    if (geo?.lat && geo?.lng && isValidLatLng(geo.lat, geo.lng)) {
      const coords = {
        lat: geo.lat,
        lng: geo.lng,
        formatted_address: geo.formatted_address || cleanAddress,
        source: geo.source || "google",
      };
      cache[cleanAddress] = coords;
      writeGeocodeCache(cache);
      return coords;
    }

    return { lat:null, lng:null, error: geo?.error || adresseNationale?.error || "Adresse introuvable" };
  } catch (e) {
    return { lat:null, lng:null, error: adresseNationale?.error || e?.message || "Géocodage impossible" };
  }
}

function resolveCoordinatesFromGeocode(geocoded, fallbackBien, address, previousAddress) {
  if (geocoded && isValidLatLng(parseFloat(geocoded.lat), parseFloat(geocoded.lng))) {
    return { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
  }

  const oldLat = parseFloat(fallbackBien?.latitude);
  const oldLng = parseFloat(fallbackBien?.longitude);
  const sameAddress = String(address || "").trim() === String(previousAddress || "").trim();
  if (sameAddress && isValidLatLng(oldLat, oldLng)) {
    return { lat: oldLat, lng: oldLng };
  }

  return { lat:null, lng:null };
}

function CarteBiens({ biens, T=THEMES_INV.dark, onOpenBien }) {
  const [selectedId, setSelectedId] = useState(null);
  const [points, setPoints] = useState([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [mapError, setMapError] = useState("");
  const mapElRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const geocodeCacheRef = useRef(readGeocodeCache());

  const biensAvecAdresse = biens.filter(b => getBienGoogleAddress(b));
  const addressKey = biensAvecAdresse.map(b => `${b.id}:${getBienGoogleAddress(b)}:${b.latitude||""}:${b.longitude||""}`).join("|");
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";
  const apiKey = getGoogleMapsApiKey();

  useEffect(() => {
    if (biensAvecAdresse.length === 0) {
      setSelectedId(null);
      setPoints([]);
      return;
    }
    if (!selectedId || !biensAvecAdresse.some(b => b.id === selectedId)) {
      setSelectedId(biensAvecAdresse[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setMapError("");
      if (biensAvecAdresse.length === 0) { setPoints([]); return; }
      setLoadingMap(true);
      try {
        const maps = await loadGoogleMapsApi(apiKey);
        if (cancelled) return;
        if (!mapInstanceRef.current && mapElRef.current) {
          mapInstanceRef.current = new maps.Map(mapElRef.current, {
            center: { lat: 47.4784, lng: -0.5632 },
            zoom: 11,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          infoWindowRef.current = new maps.InfoWindow();
        }

        const geocoder = new maps.Geocoder();
        const cache = geocodeCacheRef.current || {};
        const resolved = [];

        for (const b of biensAvecAdresse) {
          const address = getBienGoogleAddress(b);
          const dbLat = parseFloat(b.latitude);
          const dbLng = parseFloat(b.longitude);

          if (isValidLatLng(dbLat, dbLng)) {
            resolved.push({ b, address, lat: dbLat, lng: dbLng, formatted_address: address, source:"database" });
            continue;
          }

          if (cache[address] && isValidLatLng(cache[address].lat, cache[address].lng)) {
            resolved.push({ b, address, ...cache[address], source:"cache" });
            continue;
          }

          const geo = await geocodeAddress(geocoder, address);
          if (cancelled) return;
          if (geo?.lat && geo?.lng) {
            const coords = { lat: geo.lat, lng: geo.lng, formatted_address: geo.formatted_address || address, source: geo.source || "google" };
            cache[address] = coords;
            resolved.push({ b, address, ...coords, source: coords.source });
            saveBienCoordinatesIfPossible(b.id, geo.lat, geo.lng);
          } else {
            resolved.push({ b, address, error: geo.error || "Adresse introuvable" });
          }
          await new Promise(r => setTimeout(r, 120));
        }

        geocodeCacheRef.current = cache;
        writeGeocodeCache(cache);
        setPoints(resolved.filter(p => isValidLatLng(p.lat, p.lng)));

        const failed = resolved.filter(p => p.error).length;
        setMapError(failed > 0 ? `${failed} adresse${failed>1?"s":""} non géocodée${failed>1?"s":""}. Vérifier l'adresse dans la fiche bien.` : "");
      } catch (e) {
        if (!cancelled) {
          setMapError(e?.message || "Impossible de charger Google Maps.");
          setPoints([]);
        }
      } finally {
        if (!cancelled) setLoadingMap(false);
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, apiKey]);

  const openPointInfo = useCallback((point, marker) => {
    if (!point || !infoWindowRef.current) return;
    const b = point.b;
    const address = point.formatted_address || point.address;
    const html = `
      <div style="font-family:Arial,sans-serif;min-width:230px;max-width:310px;color:#1a1f2e">
        <div style="font-size:14px;font-weight:800;margin-bottom:4px">${escapeHtml(b.adresse || b.ville || "Bien")}</div>
        <div style="font-size:12px;color:#4a5568;line-height:1.45;margin-bottom:8px">${escapeHtml(address)}</div>
        <div style="font-size:12px;line-height:1.7">
          <div><strong>Statut :</strong> ${escapeHtml(b.statut || "—")}</div>
          <div><strong>Prix :</strong> ${escapeHtml(fmtEur(b.prix_vente))}</div>
          <div><strong>Offre :</strong> ${escapeHtml(fmtEur(b.montant_offre))}</div>
          <div><strong>Travaux :</strong> ${escapeHtml(fmtEur(b.prix_travaux))}</div>
          <div><strong>Rendement :</strong> ${b.rendement_brut ? `${Number(b.rendement_brut).toFixed(1)} %` : "—"}</div>
          <div><strong>Cash-flow :</strong> ${escapeHtml(fmtEur(b.cashflow_estime))}</div>
        </div>
        <a href="${googleMapsSearchUrl(point.address)}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:9px;color:#4070e8;text-decoration:none;font-weight:700;font-size:12px">Ouvrir dans Google Maps →</a>
      </div>`;
    infoWindowRef.current.setContent(html);
    if (marker) infoWindowRef.current.open({ anchor: marker, map: mapInstanceRef.current, shouldFocus: false });
  }, [fmtEur]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapInstanceRef.current;
    if (!maps || !map) return;

    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    if (points.length === 0) return;

    const bounds = new maps.LatLngBounds();
    points.forEach((point, idx) => {
      const color = STATUT_BIEN_COLORS[point.b.statut] || "#4070e8";
      const marker = new maps.Marker({
        position: { lat: point.lat, lng: point.lng },
        map,
        title: point.address,
        label: { text: String(idx + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => {
        setSelectedId(point.b.id);
        openPointInfo(point, marker);
      });
      markersRef.current.push(marker);
      bounds.extend({ lat: point.lat, lng: point.lng });
    });

    if (points.length === 1) {
      map.setCenter({ lat: points[0].lat, lng: points[0].lng });
      map.setZoom(14);
    } else {
      map.fitBounds(bounds, 54);
    }
  }, [points, openPointInfo]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapInstanceRef.current;
    if (!maps || !map || !selectedId) return;
    const idx = points.findIndex(p => p.b.id === selectedId);
    if (idx < 0) return;
    const point = points[idx];
    const marker = markersRef.current[idx];
    map.panTo({ lat: point.lat, lng: point.lng });
    if ((map.getZoom?.() || 0) < 12) map.setZoom(13);
    openPointInfo(point, marker);
  }, [selectedId, points, openPointInfo]);

  const selectedPoint = points.find(p => p.b.id === selectedId) || points[0] || null;

  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <Icon as={MapPin} size={13} strokeWidth={2.2}/>
          Google Maps — biens en stock
        </span>
        <span style={{fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0}}>
          {points.length}/{biensAvecAdresse.length} bien{biensAvecAdresse.length>1?"s":""} positionné{points.length>1?"s":""}
        </span>
      </div>
      <div className="inv-card-bd">
        {biensAvecAdresse.length === 0 ? (
          <div style={{padding:20, textAlign:"center", color:T.textMuted, border:`1px dashed ${T.border}`, borderRadius:RADIUS.lg, background:T.input}}>
            Aucun bien avec une adresse exploitable pour Google Maps. Renseignez au minimum une adresse ou une ville dans la fiche bien.
          </div>
        ) : !apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE_API_GOOGLE_MAPS" ? (
          <div style={{padding:20, border:`1px dashed ${T.accentBorder}`, borderRadius:RADIUS.lg, background:T.accentBg, color:T.textSub, lineHeight:1.6}}>
            <div style={{fontWeight:800, color:T.accent, marginBottom:6}}>Clé API Google Maps à ajouter</div>
            Dans le fichier <strong>PageInvest.jsx</strong>, remplacez la valeur de <strong>GOOGLE_MAPS_API_KEY</strong> par votre clé Google Maps, puis activez les API <strong>Maps JavaScript API</strong> et <strong>Geocoding API</strong> dans Google Cloud.
          </div>
        ) : (
          <div style={{display:"grid", gridTemplateColumns:"2.1fr 1fr", gap:SPACING.md, alignItems:"stretch"}}>
            <div style={{border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, overflow:"hidden", background:T.input, minHeight:450, position:"relative"}}>
              <div ref={mapElRef} style={{height:390, width:"100%"}} />
              {loadingMap && (
                <div style={{position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.28)", color:"white", fontWeight:800, gap:8}}>
                  <Icon as={RefreshCw} size={15} style={{animation:"spin 1s linear infinite"}}/> Chargement Google Maps…
                </div>
              )}
              <div style={{
                padding:`${SPACING.sm+2}px ${SPACING.lg}px`, borderTop:`1px solid ${T.border}`,
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm, flexWrap:"wrap",
                background:T.card,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                    {selectedPoint?.b?.adresse || selectedPoint?.b?.ville || "Sélectionnez un bien"}
                  </div>
                  <div style={{fontSize:FONT.xs.size+1, color:mapError ? DA : T.textSub, marginTop:2}}>
                    {mapError || selectedPoint?.formatted_address || selectedPoint?.address || "Carte Google Maps"}
                  </div>
                </div>
                {selectedPoint && (
                  <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>onOpenBien?.(selectedPoint.b.id)}>
                      Ouvrir la fiche
                    </button>
                    <a
                      className="inv-btn inv-btn-out inv-btn-sm"
                      href={googleMapsSearchUrl(selectedPoint.address)}
                      target="_blank"
                      rel="noreferrer"
                      style={{textDecoration:"none"}}
                    >
                      Google Maps <Icon as={ExternalLink} size={11}/>
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div style={{
              border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, background:T.input,
              minHeight:450, maxHeight:450, overflowY:"auto",
            }}>
              <div style={{padding:`${SPACING.sm+2}px ${SPACING.md}px`, borderBottom:`1px solid ${T.border}`, background:T.sectionHd}}>
                <div style={{fontSize:FONT.xs.size, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2}}>
                  Biens géolocalisés
                </div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:6, padding:SPACING.sm}}>
                {biensAvecAdresse.map((b, idx) => {
                  const addr = getBienGoogleAddress(b);
                  const point = points.find(p => p.b.id === b.id);
                  const active = selectedId === b.id;
                  const color = STATUT_BIEN_COLORS[b.statut] || T.accent;
                  return (
                    <button
                      key={b.id}
                      onClick={() => point && setSelectedId(b.id)}
                      disabled={!point}
                      style={{
                        width:"100%", textAlign:"left", cursor:point ? "pointer" : "not-allowed", fontFamily:"inherit",
                        padding:`${SPACING.sm+1}px ${SPACING.md}px`, borderRadius:RADIUS.md,
                        border:`1px solid ${active ? T.accentBorder : T.border}`,
                        background: active ? T.accentBg : T.card,
                        transition:"all .12s", opacity:point ? 1 : .55,
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderHover;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=active ? T.accentBorder : T.border;}}
                    >
                      <div style={{display:"flex", alignItems:"flex-start", gap:8}}>
                        <span style={{
                          width:22, height:22, borderRadius:"50%", background:color, color:"white",
                          flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:FONT.xs.size-1, fontWeight:800, marginTop:1,
                          boxShadow:`0 0 0 3px ${color}22`,
                        }}>{idx+1}</span>
                        <div style={{minWidth:0, flex:1}}>
                          <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:active ? T.accent : T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                            {b.adresse || b.ville || "Bien sans adresse"}
                          </div>
                          <div style={{fontSize:FONT.xs.size+1, color:T.textSub, marginTop:2, lineHeight:1.35}}>
                            {point?.formatted_address || addr}
                          </div>
                          <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:6, fontSize:FONT.xs.size, color:T.textMuted}}>
                            {b.statut && <span style={{color, fontWeight:700}}>{b.statut}</span>}
                            {b.prix_vente > 0 && <span>· {fmtEur(b.prix_vente)}</span>}
                            {b.rendement_brut > 0 && <span>· {Number(b.rendement_brut).toFixed(1)} %</span>}
                            {!point && <span style={{color:DA}}>· non positionné</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BienGoogleMapCard({ bien, T = THEMES_INV.dark, title = "Localisation du bien" }) {
  const address = getBienFullAddress(bien);
  const mapQuery = getBienMapQuery(bien);
  const embedUrl = googleMapsEmbedUrl(mapQuery);
  const searchUrl = googleMapsSearchUrl(mapQuery || address);

  return (
    <div className="inv-card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="inv-card-hd blue" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={MapPin} size={13} strokeWidth={2.2} />
          {title}
        </span>

        {mapQuery && (
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="inv-btn inv-btn-out inv-btn-sm"
            style={{ textDecoration: "none" }}
          >
            <Icon as={ExternalLink} size={12} strokeWidth={2.2} />
            Ouvrir Maps
          </a>
        )}
      </div>

      <div className="inv-card-bd" style={{ padding: 0 }}>
        {!mapQuery ? (
          <div style={{ padding: 16, color: T.textMuted, fontSize: 13 }}>
            Adresse non renseignée. Complétez l’adresse du bien pour afficher la carte.
          </div>
        ) : (
          <>
            <iframe
              title={`Carte du bien ${bien?.reference_interne || address || ""}`}
              src={embedUrl}
              style={{ width: "100%", height: 320, border: 0, display: "block", filter: T.bg === THEMES_INV.dark.bg ? "saturate(.9) contrast(.95)" : "none" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, color: T.textSub, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span>{address || mapQuery}</span>
              {isValidLatLng(parseFloat(bien.latitude), parseFloat(bien.longitude)) && (
                <span style={{ color: T.textMuted, fontFamily: "'DM Mono', monospace" }}>
                  {parseFloat(bien.latitude).toFixed(6)}, {parseFloat(bien.longitude).toFixed(6)}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function StockBiens({ profil, T=THEMES_INV.dark, initialFilter }) {
  const [biens, setBiens]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ficheId, setFicheId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreVille, setFiltreVille]   = useState("");
  const [filtreAgentImmobilier, setFiltreAgentImmobilier] = useState("");
  const [specialFilter, setSpecialFilter] = useState("");
  const [search, setSearch]     = useState("");
  const [compareIds, setCompareIds] = useState([]);
  const [showComparateur, setShowComparateur] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key:"created_at", direction:"desc" });

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_biens").select("*").order("created_at", { ascending: false });
    setBiens(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  useEffect(() => {
    if (!initialFilter) return;
    setFiltreStatut(""); setFiltreVille(""); setFiltreAgentImmobilier(""); setSpecialFilter(""); setSearch("");
    if (initialFilter.type === "open_bien" && initialFilter.bien_id) { setFicheId(initialFilter.bien_id); return; }
    if (initialFilter.type === "statut") setFiltreStatut(initialFilter.value || "");
    if (initialFilter.type === "a_relancer") { setSpecialFilter("a_relancer"); setSortConfig({ key:"date_relance", direction:"asc" }); }
    if (initialFilter.type === "all") setSortConfig({ key:"created_at", direction:"desc" });
  }, [initialFilter]);

  const today = new Date().toISOString().slice(0,10);
  const villes = [...new Set(biens.map(b => b.ville).filter(Boolean))];
  const getAgentImmobilierLabel = (b = {}) => [
    b.interlocuteur,
    b.agence,
    b.visite_data?.general?.agence_vendeur,
  ].filter(Boolean).join(" ").trim();
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  let filtered = biens.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false;
    if (filtreVille && b.ville !== filtreVille) return false;
    if (filtreAgentImmobilier && !normTxt(getAgentImmobilierLabel(b)).includes(normTxt(filtreAgentImmobilier))) return false;
    if (specialFilter === "a_relancer" && !(b.date_relance && b.date_relance <= today)) return false;
    if (search && !normTxt(`${b.adresse||""} ${b.ville||""} ${b.code_postal||""} ${b.agence||""} ${b.interlocuteur||""} ${b.statut||""}`).includes(normTxt(search))) return false;
    return true;
  });

  filtered = [...filtered].sort((a,b) => {
    if (sortConfig.key === "agent_immobilier") {
      return compareValues(getAgentImmobilierLabel(a), getAgentImmobilierLabel(b), sortConfig.direction);
    }
    return compareValues(a[sortConfig.key], b[sortConfig.key], sortConfig.direction);
  });

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";
  const aRelancer = biens.filter(b => b.date_relance && b.date_relance <= today).length;
  const gridCols = "46px .85fr 2fr 1.15fr 1fr 1fr 1fr 1fr 80px";

  const toggleCompareBien = (bienId) => {
    setCompareIds(prev => {
      if (prev.includes(bienId)) return prev.filter(id => id !== bienId);
      if (prev.length >= 3) {
        alert("Le comparateur est limité à 3 biens pour garder une lecture claire.");
        return prev;
      }
      return [...prev, bienId];
    });
  };

  if (showComparateur) {
    return (
      <ComparateurBiensNomade
        biens={biens}
        selectedIds={compareIds}
        onToggle={toggleCompareBien}
        onOpenBien={(bienId) => { setShowComparateur(false); setFicheId(bienId); }}
        onClose={() => setShowComparateur(false)}
        T={T}
      />
    );
  }

  if (ficheId) return <FicheBien id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} />;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1500, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACING.xl-4, flexWrap:"wrap", gap:SPACING.sm+2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{
            width:44, height:44, borderRadius:RADIUS.lg, flexShrink:0,
            background:T.accentBg, color:T.accent,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={Building2} size={22} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Stock de Biens</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textMuted, marginTop:2, display:"inline-flex", alignItems:"center", gap:8 }}>
              {filtered.length} bien{filtered.length!==1?"s":""}
              {aRelancer > 0 && (
                <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:DA, fontWeight:700 }}>
                  · <Icon as={Bell} size={11} strokeWidth={2.2}/> {aRelancer} à relancer
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <button className="inv-btn inv-btn-blue" onClick={() => setShowComparateur(true)}>
            <Icon as={BarChart3} size={13} strokeWidth={2.2}/> Comparateur {compareIds.length > 0 ? `(${compareIds.length}/3)` : ""}
          </button>
          <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
            <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau bien
          </button>
        </div>
      </div>

      <CarteBiens biens={filtered} T={T} onOpenBien={setFicheId} />

      {/* Filtres */}
      <div style={{ display:"flex", gap:SPACING.sm+2, marginBottom:SPACING.lg, flexWrap:"wrap" }}>
        <div style={{position:"relative", width:240}}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}/>
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e=>{setFiltreStatut(e.target.value); setSpecialFilter("");}}>
          <option value="">Tous statuts</option>
          {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="inv-sel" value={filtreVille} onChange={e=>setFiltreVille(e.target.value)}>
          <option value="">Toutes villes</option>
          {villes.map(v=><option key={v}>{v}</option>)}
        </select>
        <div style={{position:"relative", width:220}}>
          <Icon as={Users} size={13} color={T.textMuted}
            style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
          <input
            className="inv-inp"
            placeholder="Agent immobilier…"
            value={filtreAgentImmobilier}
            onChange={e=>setFiltreAgentImmobilier(e.target.value)}
            style={{ width:"100%", textAlign:"left", paddingLeft:30, fontSize:FONT.sm.size+1 }}
          />
        </div>
        <select className="inv-sel" value={`${sortConfig.key}:${sortConfig.direction}`} onChange={e=>{ const [key,direction]=e.target.value.split(":"); setSortConfig({key,direction}); }}>
          <option value="created_at:desc">Date entrée ↓</option>
          <option value="rendement_brut:desc">Rendement brut ↓</option>
          <option value="cashflow_estime:desc">Cash-flow ↓</option>
          <option value="cout_total:desc">Coût total ↓</option>
          <option value="date_relance:asc">Date relance ↑</option>
          <option value="agent_immobilier:asc">Agent immobilier A-Z</option>
          <option value="agent_immobilier:desc">Agent immobilier Z-A</option>
        </select>
        <button className="inv-btn inv-btn-danger inv-btn-sm"
          onClick={() => { setSpecialFilter("a_relancer"); setSortConfig({key:"date_relance", direction:"asc"}); }}>
          <Icon as={Bell} size={12} strokeWidth={2.2}/> Voir à relancer
        </button>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => { setFiltreStatut(""); setFiltreVille(""); setFiltreAgentImmobilier(""); setSpecialFilter(""); setSearch(""); setSortConfig({key:"created_at", direction:"desc"}); }}>
          <Icon as={X} size={12} strokeWidth={2.2}/> Réinitialiser
        </button>
        {compareIds.length > 0 && (
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setCompareIds([])}>
            <Icon as={Trash2} size={12} strokeWidth={2.2}/> Vider comparateur
          </button>
        )}
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8 }}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : (
        <div style={{ background:T.card, borderRadius:RADIUS.xl, border:`1px solid ${T.border}`, overflowX:"auto", boxShadow:T.shadowSm }}>
          <div style={{minWidth:1240}}>
            <div style={{
              display:"grid", gridTemplateColumns:gridCols, gap:10,
              padding:`${SPACING.md-2}px ${SPACING.lg}px`, background:T.sectionHd,
              borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size-1, fontWeight:700,
              color:T.textMuted, textTransform:"uppercase", letterSpacing:0.8,
            }}>
              <div style={{ textAlign:"center" }}>Comparer</div>
              <SortableHeader label="Date entrée" sortKey="created_at" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Bien" sortKey="adresse" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Coût total" sortKey="cout_total" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Rendement" sortKey="rendement_brut" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Cash-flow" sortKey="cashflow_estime" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <SortableHeader label="Relance" sortKey="date_relance" sortConfig={sortConfig} onSort={handleSort} T={T}/>
              <div/>
            </div>
            {filtered.length === 0 ? (
              <div style={{ textAlign:"center", padding:`${SPACING.xl}px 0`, color:T.textMuted, fontSize:FONT.base.size, fontStyle:"italic" }}>Aucun bien trouvé</div>
            ) : filtered.map(b => {
              const couleurStatut = STATUT_BIEN_COLORS[b.statut] || T.textMuted;
              const enRelance = b.date_relance && b.date_relance <= today;
              const rendCol = b.rendement_brut >= 8 ? SU : b.rendement_brut >= 5 ? WA : T.textMuted;
              const cfVal = b.cashflow_estime || 0;
              const cfCol = cfVal > 0 ? SU : cfVal < 0 ? DA : T.textMuted;
              const inCompare = compareIds.includes(b.id);
              return (
                <div key={b.id} style={{
                  display:"grid", gridTemplateColumns:gridCols, gap:10,
                  padding:`${SPACING.md+2}px ${SPACING.lg}px`,
                  borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center",
                  cursor:"pointer", transition:"background .12s",
                }}
                  onMouseEnter={e=>e.currentTarget.style.background=T.cardHover}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  onClick={() => setFicheId(b.id)}>
                  <div style={{ display:"flex", justifyContent:"center" }} onClick={(e)=>e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={inCompare}
                      onChange={() => toggleCompareBien(b.id)}
                      title="Ajouter au comparateur"
                    />
                  </div>
                  <div style={{ fontSize:FONT.sm.size, color:T.textMuted }}>{fmtDate(b.created_at)}</div>
                  <div style={{display:"flex", alignItems:"center", gap:SPACING.sm+2, minWidth:0}}>
                    <div style={{
                      width:34, height:34, borderRadius:RADIUS.md, flexShrink:0,
                      background:`${couleurStatut}22`, color:couleurStatut,
                      border:`1px solid ${couleurStatut}40`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <Icon as={Home} size={17} strokeWidth={2}/>
                    </div>
                    <div style={{minWidth:0}}>
                      <div style={{ fontWeight:700, color:T.text, fontSize:FONT.base.size, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.adresse||"Adresse non renseignée"}</div>
                      <div style={{ fontSize:FONT.xs.size, color:T.textMuted, display:"inline-flex", alignItems:"center", gap:4 }}>
                        {b.ville && <><Icon as={MapPin} size={10}/> {b.ville}</>}
                        {b.agence && <span> · {b.agence}</span>}
                        {b.interlocuteur && <span> · Agent : {b.interlocuteur}</span>}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span style={{
                      background:`${couleurStatut}18`, color:couleurStatut,
                      border:`1px solid ${couleurStatut}33`, borderRadius:RADIUS.pill,
                      padding:`${SPACING.xs-2}px ${SPACING.sm+1}px`, fontSize:FONT.xs.size-1, fontWeight:700, whiteSpace:"nowrap",
                    }}>{b.statut}</span>
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size, fontWeight:600, color:T.textSub }}>{fmtEur(b.cout_total)}</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size+1, fontWeight:700, color:rendCol }}>
                    {b.rendement_brut > 0 ? Number(b.rendement_brut).toFixed(1)+"%" : "—"}
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size, color:cfCol, fontWeight:cfVal !== 0 ? 600 : 400 }}>
                    {b.cashflow_estime ? fmtEur(b.cashflow_estime)+"/mois" : "—"}
                  </div>
                  <div style={{ fontSize:FONT.sm.size, color: enRelance ? DA : T.textMuted, fontWeight: enRelance ? 700 : 400, display:"inline-flex", alignItems:"center", gap:3 }}>
                    {enRelance && <Icon as={Bell} size={11} strokeWidth={2.2}/>}
                    {fmtDate(b.date_relance)}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center", gap:3 }}>
                      Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && <FormulaireBien profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function InpText(props) { return <input className="inv-inp" {...props} style={{ width:"100%", textAlign:"left", ...props.style }}/>; }
function InpNum(props) { return <input className="inv-inp" type="number" {...props} style={{ width:"100%", ...props.style }}/>; }

function FormulaireBien({ bien, profil, onSave, onClose, T=THEMES_INV.dark }) {
  const isEdit = !!bien;
  const [form, setForm] = useState({
    adresse: bien?.adresse||"", ville: bien?.ville||"", code_postal: bien?.code_postal||"",
    latitude: bien?.latitude||"", longitude: bien?.longitude||"",
    commentaire: bien?.commentaire||"", interlocuteur: bien?.interlocuteur||"",
    telephone_interlocuteur: bien?.telephone_interlocuteur||"", agence: bien?.agence||"",
    lien_annonce: bien?.lien_annonce||"", lien_drive: bien?.lien_drive||"", lien_rentabilite: bien?.lien_rentabilite||"",
    statut: bien?.statut||"À analyser", prix_vente: bien?.prix_vente||0, prix_travaux: bien?.prix_travaux||0,
    cout_total: bien?.cout_total||0, rendement_brut: bien?.rendement_brut||0, cashflow_estime: bien?.cashflow_estime||0,
    montant_offre: bien?.montant_offre||0,
    date_relance: bien?.date_relance||"", statut_relance: bien?.statut_relance||"",
    date_visite: bien?.date_visite||"",
    reference_interne: bien?.reference_interne||"", conseiller_profero: bien?.conseiller_profero||"", source_bien: bien?.source_bien||"",
  });
  const [saving, setSaving] = useState(false);

  // Auto-calcul coût total
  useEffect(() => {
    const ct = (parseFloat(form.prix_vente)||0) + (parseFloat(form.prix_travaux)||0);
    if (ct > 0) setForm(f => ({ ...f, cout_total: ct }));
  }, [form.prix_vente, form.prix_travaux]);

  const sauvegarder = async () => {
    setSaving(true);
    const fullAddress = [form.adresse, form.code_postal, form.ville].filter(Boolean).join(", ").trim();
    const previousAddress = getBienGoogleAddress(bien || {});
    const geocoded = fullAddress ? await getCoordinatesFromAddress(fullAddress) : null;
    const coords = resolveCoordinatesFromGeocode(geocoded, bien, fullAddress, previousAddress);

    const payload = {
      adresse:                 form.adresse?.trim() || null,
      ville:                   form.ville?.trim() || null,
      code_postal:             form.code_postal?.trim() || null,
      latitude:                coords.lat,
      longitude:               coords.lng,
      commentaire:             form.commentaire?.trim() || null,
      interlocuteur:           form.interlocuteur?.trim() || null,
      telephone_interlocuteur: form.telephone_interlocuteur?.trim() || null,
      agence:                  form.agence?.trim() || null,
      lien_annonce:            form.lien_annonce?.trim() || null,
      lien_drive:              form.lien_drive?.trim() || null,
      lien_rentabilite:        form.lien_rentabilite?.trim() || null,
      statut_relance:          form.statut_relance?.trim() || null,
      statut:                  form.statut || "À analyser",
      prix_vente:              parseFloat(form.prix_vente) || 0,
      prix_travaux:            parseFloat(form.prix_travaux) || 0,
      cout_total:              parseFloat(form.cout_total) || 0,
      rendement_brut:          parseFloat(form.rendement_brut) || 0,
      cashflow_estime:         parseFloat(form.cashflow_estime) || 0,
      montant_offre:           parseFloat(form.montant_offre) || 0,
      date_relance:            form.date_relance || null,
      date_visite:             form.date_visite || null,
      reference_interne:       form.reference_interne?.trim() || null,
      conseiller_profero:      form.conseiller_profero?.trim() || null,
      source_bien:             form.source_bien || null,
    };
    const write = async (p) => isEdit
      ? await supabase.from("invest_biens").update(p).eq("id", bien.id)
      : await supabase.from("invest_biens").insert(p);
    let { error } = await write(payload);
    if (error && (error.code === "42703" || error.code === "PGRST204" || String(error.message||"").includes("latitude") || String(error.message||"").includes("longitude"))) {
      const { latitude, longitude, ...fallbackPayload } = payload;
      const retry = await write(fallbackPayload);
      error = retry.error;
      if (!error) console.warn("Colonnes latitude/longitude absentes. Lancez la migration SQL pour activer la carte.");
    }
    if (error) { console.error("Erreur bien:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", width:"90%", maxWidth:720, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.text, marginBottom:20 }}>{isEdit ? "Modifier le bien" : "Nouveau bien"}</div>
        <div style={{marginBottom:14, padding:"10px 12px", borderRadius:RADIUS.md, background:T.accentBg, border:`1px solid ${T.accentBorder}`, color:T.textSub, fontSize:FONT.sm.size+1, lineHeight:1.45}}>
          Fiche bien simplifiée : on garde uniquement les informations utiles pour créer, retrouver et décider rapidement. Les contrôles techniques, DPE, urbanisme, photos et points de vigilance se remplissent dans l’onglet <strong style={{color:T.accent}}>Visite terrain</strong>.
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Référence Profero</label>
            <InpText value={form.reference_interne} onChange={e=>setForm({...form,reference_interne:e.target.value})} placeholder="Ex : ANG-001"/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Statut</label>
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Adresse du bien</label>
            <InpText value={form.adresse} onChange={e=>setForm({...form,adresse:e.target.value})} placeholder="123 rue de la Paix"/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Ville</label>
            <InpText value={form.ville} onChange={e=>setForm({...form,ville:e.target.value})}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Code postal</label>
            <InpText value={form.code_postal} onChange={e=>setForm({...form,code_postal:e.target.value})}/>
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Prix affiché (€)</label>
            <InpNum value={form.prix_vente} onChange={e=>setForm({...form,prix_vente:e.target.value})}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Travaux estimés (€)</label>
            <InpNum value={form.prix_travaux} onChange={e=>setForm({...form,prix_travaux:e.target.value})}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Offre cible (€)</label>
            <InpNum value={form.montant_offre} onChange={e=>setForm({...form,montant_offre:e.target.value})}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Date visite prévue</label>
            <InpText type="date" value={form.date_visite} onChange={e=>setForm({...form,date_visite:e.target.value})}/>
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Interlocuteur</label>
            <InpText value={form.interlocuteur} onChange={e=>setForm({...form,interlocuteur:e.target.value})} placeholder="Agent / vendeur"/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Téléphone</label>
            <InpText value={form.telephone_interlocuteur} onChange={e=>setForm({...form,telephone_interlocuteur:e.target.value})}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Source</label>
            <select className="inv-sel" value={form.source_bien} style={{ width:"100%" }} onChange={e=>setForm({...form,source_bien:e.target.value})}>
              {SOURCES_BIEN_VISITE.map(s=><option key={s} value={s}>{s || "Sélectionner"}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Conseiller Profero</label>
            <InpText value={form.conseiller_profero} onChange={e=>setForm({...form,conseiller_profero:e.target.value})} placeholder={profil?.nom || "Conseiller"}/>
          </div>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien annonce</label>
            <InpText value={form.lien_annonce} onChange={e=>setForm({...form,lien_annonce:e.target.value})} placeholder="https://…"/>
          </div>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}>
            <label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Note rapide</label>
            <textarea className="inv-textarea" rows={3} value={form.commentaire} onChange={e=>setForm({...form,commentaire:e.target.value})} placeholder="Information utile avant analyse détaillée : vendeur motivé, point fort, point bloquant, action à faire…"/>
          </div>
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}


// ─── FICHE VISITE BIEN ────────────────────────────────────────────────────────
const VISITE_STATUS = ["", "OK", "À vérifier", "Problème"];
const YES_NO = ["", "Oui", "Non"];
const COMPLEXITE_VISITE = ["", "Simple", "Moyenne", "Complexe"];
const RECO_VISITE = ["", "Passer à l'offre", "Approfondir", "Abandonner"];
const SOURCES_BIEN_VISITE = ["", "LBC", "Agent", "Réseau", "Autre"];
const MANDATS_VISITE = ["", "Exclusif", "Simple"];
const TENSION_LOCATIVE = ["", "Faible", "Moyenne", "Forte"];
const LETTRES_DPE = ["", "A", "B", "C", "D", "E", "F", "G"];
const TYPES_LOT_VISITE = ["", "Studio", "T1", "T2", "T3", "T4", "T5", "T6", "Commerce"];

const TYPE_BIEN_VISITE = ["", "Immeuble de rapport", "Maison", "Appartement", "Local commercial", "Mixte habitation / commerce", "Terrain", "Autre"];
const NIVEAUX_BIEN_VISITE = ["", "RDC uniquement", "R+1", "R+2", "R+3", "R+4", "R+5 et plus", "À vérifier"];
const DELAI_VENTE_VISITE = ["", "Très court (< 7 jours)", "Court (1 à 3 semaines)", "Moyen (1 à 2 mois)", "Long (> 2 mois)", "À vérifier"];
const EXPOSITION_ANNONCE_VISITE = ["", "Nouvelle annonce", "Moins de 15 jours", "15 à 30 jours", "1 à 3 mois", "+3 mois", "À vérifier"];
const COMPTEUR_NOMBRE_VISITE = ["", "0", "1", "2", "3", "4", "5", "6+", "À vérifier"];
const DUREE_CHANTIER_VISITE = ["", "< 1 mois", "1 à 2 mois", "2 à 4 mois", "4 à 6 mois", "+6 mois", "À vérifier"];
const DELAI_RELOCATION_VISITE = ["", "< 7 jours", "1 à 2 semaines", "2 à 4 semaines", "+1 mois", "À vérifier"];
const VACANCE_LOCATIVE_VISITE = ["", "Quasi nulle", "< 2 semaines/an", "2 à 4 semaines/an", "+1 mois/an", "À vérifier"];
const FISCALITE_VISITE = ["", "LMNP réel", "SCI IS", "SCI IR", "Location nue", "À arbitrer avec fiscaliste", "À vérifier"];
const PROFILS_LOCATAIRES_VISITE = ["", "Étudiants", "Jeunes actifs", "Familles", "Couples", "Professionnels / mobilité", "Colocation", "Mixte", "À vérifier"];
const STRATEGIE_LOCATIVE_VISITE = ["", "Location meublée", "Location nue", "Colocation", "Mixte meublé / nu", "Courte durée", "Commerce / professionnel", "À approfondir"];
const PROCHAINE_ETAPE_VISITE = ["", "Faire une offre", "Demander documents complémentaires", "Contacter urbanisme", "Faire devis travaux", "Lancer simulation financière", "Organiser contre-visite", "Abandonner"];
const DUREE_REMBOURSEMENT_VISITE = ["", "15 ans", "20 ans", "25 ans", "30 ans", "À simuler"];

const TECHNIQUE_VISITE_GROUPS = [
  { title:"Gros œuvre", key:"gros_oeuvre", items:[
    ["toiture","État de la toiture"],["charpente","État de la charpente"],["facades","État des façades / ravalement"],
    ["murs_porteurs","État des murs porteurs"],["humidite","Présence d'humidité / moisissures"],
    ["amiante_plomb","Présence d'amiante / plomb (DDT)"],["planchers_dalles","État des planchers / dalles"],
    ["fondations","État des fondations"],["fissures_structurelles","Présence de fissures structurelles"],
  ]},
  { title:"Menuiseries & Isolation", key:"menuiseries_isolation", items:[
    ["type_vitrage","Type de vitrage"],["fenetres_portes_fenetres","État des fenêtres et portes-fenêtres"],
    ["volets","État des volets"],["isolation_combles","Isolation des combles"],["isolation_murs","Isolation des murs"],
    ["isolation_sol","Isolation du sol"],["porte_entree","Type de porte d'entrée"],
  ]},
  { title:"Électricité", key:"electricite", items:[
    ["tableau_electrique","Tableau électrique"],["terre","Mise à la terre"],["differentiels","Disjoncteurs différentiels"],
    ["cablage","Type de câblage"],["compteurs_individuels","Présence de compteurs individuels"],
    ["puissance_kva","Puissance disponible (kVA)"],["vmc","Présence de VMC"],["interphonie","Système d'interphonie"],
  ]},
  { title:"Plomberie & Eau", key:"plomberie_eau", items:[
    ["canalisations","Type de canalisations"],["plomberie_generale","État de la plomberie générale"],
    ["compteurs_lots","Compteurs individuels par lot"],["chauffe_eau","Chauffe-eau"],
    ["colonnes_montantes","Présence de colonnes montantes"],["evacuations","État des évacuations"],
    ["wc_sdb_par_lot","Présence WC / SDB possible par lot"],
  ]},
  { title:"Chauffage", key:"chauffage", items:[
    ["type_chauffage","Type de chauffage"],["chaudiere","Chaudière collective ou individuelle"],
    ["age_systeme","État et âge du système de chauffage"],["chauffage_individuel","Possibilité de chauffage individuel par lot"],
    ["radiateurs","Radiateurs"],["plancher_chauffant","Plancher chauffant"],
  ]},
];

const URBANISME_VISITE_ITEMS = [
  ["zone_plu","Zone PLU"],["zone_abf","Bien en zone ABF"],["permis_requis","Permis de construire requis pour la découpe"],
  ["dp_suffisante","Déclaration préalable suffisante"],["stationnement","Règles de stationnement"],
  ["division_logement","Règles locales de division de logement"],["servitudes","Servitudes existantes"],
  ["risques_naturels","Risques naturels"],["cadastre","Cadastre / plan de masse disponible"],
  ["copropriete","Régime de copropriété"],["reglement_copro","Règlement de copropriété autorisant la division"],
  ["syndic_charges","Syndic / charges de copropriété"],
];

const RISQUES_VISITE_ITEMS = [
  ["structurel","Risque structurel"],["amiante_plomb","Risque amiante / plomb non traité"],["refus_bancaire","Risque de refus bancaire"],
  ["refus_urbanisme","Risque de refus permis / déclaration"],["depassement_travaux","Risque de dépassement budget travaux"],
  ["delai_chantier","Risque de délai chantier"],["vacance","Risque de vacance locative élevée"],
  ["fiscal","Risque fiscal"],["contentieux_copro","Risque de contentieux copropriété"],
  ["voisinage","Risque de voisinage / nuisances"],["motivation_vendeur","Motivation vendeur"],
  ["titre_propriete","Qualité du titre de propriété"],
];

const makeAuditDefaults = (groupsOrItems) => {
  const entries = Array.isArray(groupsOrItems?.[0])
    ? groupsOrItems
    : groupsOrItems.flatMap(g => g.items);
  return entries.reduce((acc, [key]) => ({ ...acc, [key]: { statut:"", commentaire:"" } }), {});
};

const emptyLotCible = (i = 0) => ({
  numero: String(i + 1), type:"", surface:"", loyer:"", meuble:"", stationnement:"",
});
const emptyLotsCibles = (count = 1) => Array.from({length:Math.max(1, count)}, (_,i)=>emptyLotCible(i));

const deepMergeVisite = (base, extra) => {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (!base || typeof base !== "object") return extra !== undefined && extra !== null ? extra : base;
  const out = { ...base };
  Object.keys(extra || {}).forEach(k => {
    out[k] = deepMergeVisite(base[k], extra[k]);
  });
  return out;
};

const buildDefaultVisiteData = (bien = {}) => ({
  identification: {
    adresse: bien.adresse || "", ville: bien.ville || "", code_postal: bien.code_postal || "",
    latitude: bien.latitude ?? "", longitude: bien.longitude ?? "",
    conseiller_profero: bien.conseiller_profero || "", date_visite: bien.date_visite || "",
    source: bien.source_bien || "", reference_interne: bien.reference_interne || "",
  },
  general: {
    type_bien:"", annee_construction:"", surface_totale:"", nombre_niveaux:"",
    lots_actuels:"", lots_cibles:"", prix_affiche: bien.prix_vente || "",
    mandat:"", agence_vendeur: bien.agence || "", delai_vente_estime:"", duree_exposition_annonce:"",
  },
  configuration: {
    escaliers_interieurs:"", acces_independants:"", compteurs_eau:"", compteurs_gaz:"", compteurs_electricite:"",
    lots: emptyLotsCibles(1),
  },
  technique: makeAuditDefaults(TECHNIQUE_VISITE_GROUPS),
  dpe: {
    dpe_actuel:"", ges_actuel:"", conso_energie:"", emissions_co2:"", dpe_cible:"",
    audit_disponible:"", passoires_identifiees:"", travaux_energetiques:"",
  },
  urbanisme: {
    controles: makeAuditDefaults(URBANISME_VISITE_ITEMS),
    contact_mairie:"", observations:"", autorisations:"", duree_chantier:"",
    complexite:"", vigilance_travaux:"",
  },
  finance: {
    prix_acquisition_negocie:"", frais_notaire:"", frais_agence:"", frais_profero:"", budget_travaux_ttc:"",
    mobilier:"", frais_financement:"", divers_fonds_roulement:"",
    taux_vacance:"", loyers_nets_vacance:"", charges_annuelles:"", loyers_nets_charges:"",
    rendement_brut:"", rendement_net:"", cashflow_mensuel:"", duree_remboursement:"", plus_value_potentielle:"",
  },
  marche: {
    tension_locative:"", delai_relocation:"", loyer_moyen_m2:"", colocation_possible:"",
    meuble_pertinente:"", nue_pertinente:"", regime_fiscal:"", vacance_moyenne:"",
    profil_locataires:"", concurrence:"", points_forts:"", points_faibles:"",
  },
  risques: {
    controles: makeAuditDefaults(RISQUES_VISITE_ITEMS),
    points_negociation:"", marge_negociation:"", conditions_suspensives:"", observations_libres:"",
  },
  conclusion: {
    note_globale:"", recommandation:"", prix_offre_recommande:"", strategie_locative:"",
    fiscalite_recommandee:"", prochaine_etape:"", commentaire_conseiller:"",
  },
});

const normaliseVisiteData = (bien = {}) => {
  const merged = deepMergeVisite(buildDefaultVisiteData(bien), bien.visite_data || {});
  const existingLots = Array.isArray(merged.configuration?.lots) ? merged.configuration.lots : [];
  const countFromGeneral = parseInt(merged.general?.lots_cibles, 10);
  const baseCount = existingLots.length || (Number.isFinite(countFromGeneral) && countFromGeneral > 0 ? countFromGeneral : 1);
  merged.configuration.lots = emptyLotsCibles(baseCount).map((baseLot, i) => ({
    ...baseLot,
    ...(existingLots[i] || {}),
    numero: existingLots[i]?.numero || String(i + 1),
  }));
  if (!merged.general.lots_cibles) merged.general.lots_cibles = String(merged.configuration.lots.length);
  return merged;
};

const numVal = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function MiniField({ label, value, onChange, type="text", options, textarea=false, readOnly=false, required=false, helper="", T=THEMES_INV.dark }) {
  const isMissing = required && !readOnly && (value === null || value === undefined || String(value).trim() === "");
  const commonStyle = {
    width:"100%",
    textAlign:type==="number" ? "right" : "left",
    opacity:readOnly ? .8 : 1,
    borderColor:isMissing ? SEMANTIC.warning.border : undefined,
    background:isMissing ? SEMANTIC.warning.bg : undefined,
  };
  return (
    <div style={{ marginBottom:10 }}>
      <label style={{ fontSize:10, fontWeight:800, color:isMissing ? WA : T.textMuted, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:5 }}>
        {label}{required && !readOnly ? <span style={{color:WA}}> •</span> : null}
      </label>
      {textarea ? (
        <textarea className="inv-textarea" rows={3} value={value || ""} readOnly={readOnly} onChange={e=>onChange(e.target.value)} style={commonStyle} />
      ) : options ? (
        <select className="inv-sel" value={value || ""} disabled={readOnly} onChange={e=>onChange(e.target.value)} style={{ width:"100%", ...commonStyle }}>
          {options.map(o => <option key={o} value={o}>{o || "Sélectionner"}</option>)}
        </select>
      ) : (
        <input className="inv-inp" type={type} value={value ?? ""} readOnly={readOnly} onChange={e=>onChange(e.target.value)} style={commonStyle} />
      )}
      {(helper || isMissing) && (
        <div style={{fontSize:FONT.xs.size, color:isMissing ? WA : T.textMuted, marginTop:4, lineHeight:1.35}}>
          {isMissing ? "Réponse à compléter pour une fiche complète" : helper}
        </div>
      )}
    </div>
  );
}

function VisitSection({ title, icon, children, T=THEMES_INV.dark }) {
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden", marginBottom:14, background:T.input }}>
      <div style={{ padding:`${SPACING.sm}px ${SPACING.md}px`, background:T.sectionHd, color:T.accent, fontSize:FONT.xs.size, fontWeight:900, textTransform:"uppercase", letterSpacing:1.3, display:"flex", alignItems:"center", gap:6 }}>
        {icon && <Icon as={icon} size={13} strokeWidth={2.2}/>}
        {title}
      </div>
      <div style={{ padding:SPACING.md }}>{children}</div>
    </div>
  );
}

function AuditRows({ items, values, onChange, T=THEMES_INV.dark }) {
  const issueStatuses = ["À vérifier", "Problème"];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
      {items.map(([key,label]) => {
        const row = values?.[key] || { statut:"", commentaire:"" };
        const commentRequired = issueStatuses.includes(row.statut || "");
        const missingStatus = !row.statut;
        const missingComment = commentRequired && !String(row.commentaire || "").trim();
        return (
          <div key={key} style={{ display:"grid", gridTemplateColumns:"1.15fr 120px 1.45fr", gap:8, alignItems:"start", padding:missingStatus || missingComment ? "6px" : 0, borderRadius:RADIUS.md, background:missingStatus || missingComment ? SEMANTIC.warning.bg : "transparent", border:missingStatus || missingComment ? `1px solid ${SEMANTIC.warning.border}` : "1px solid transparent" }}>
            <div style={{ fontSize:FONT.sm.size, color:T.textSub, fontWeight:700, paddingTop:6 }}>{label} <span style={{color:WA}}>•</span></div>
            <select className="inv-sel" value={row.statut || ""} onChange={e=>onChange(key, "statut", e.target.value)} style={{ width:"100%", fontSize:FONT.xs.size+1, padding:"5px 7px" }}>
              {VISITE_STATUS.map(s => <option key={s} value={s}>{s || "Sélectionner"}</option>)}
            </select>
            <div>
              <input className="inv-inp" value={row.commentaire || ""} placeholder={commentRequired ? "Commentaire à compléter…" : "Commentaire utile si besoin…"} onChange={e=>onChange(key, "commentaire", e.target.value)} style={{ width:"100%", textAlign:"left", fontSize:FONT.xs.size+1, padding:"5px 7px", borderColor:missingComment ? SEMANTIC.warning.border : undefined, background:missingComment ? SEMANTIC.warning.bg : undefined }}/>
              {missingComment && <div style={{fontSize:FONT.xs.size, color:WA, marginTop:3}}>Commentaire conseillé pour préciser le point à vérifier ou le problème identifié</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FicheVisiteBien = React.forwardRef(function FicheVisiteBien({ bien, profil, T=THEMES_INV.dark, onSaved, onSaveStateChange }, ref) {
  const [data, setData] = useState(() => normaliseVisiteData(bien));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [visitStep, setVisitStep] = useState(0);
  const autoSaveTimerRef = useRef(null);
  const autoSaveBootRef = useRef(true);
  const dirtyRef = useRef(false);
  const latestDataRef = useRef(data);

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveBootRef.current = true;
    const nextData = normaliseVisiteData(bien);
    latestDataRef.current = nextData;
    dirtyRef.current = false;
    setData(nextData);
    setVisitStep(0);
  }, [bien?.id]);
  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { if (onSaveStateChange) onSaveStateChange({ saving, saved }); }, [saving, saved, onSaveStateChange]);

  const markDirtyData = (next) => { latestDataRef.current = next; dirtyRef.current = true; return next; };
  const upd = (section, key, value) => setData(prev => markDirtyData({ ...prev, [section]: { ...prev[section], [key]: value } }));
  const updControl = (section, key, field, value) => setData(prev => markDirtyData({ ...prev, [section]: { ...prev[section], controles: { ...prev[section]?.controles, [key]: { ...prev[section]?.controles?.[key], [field]: value } } } }));
  const updLot = (idx, key, value) => setData(prev => {
    const lots = [...(prev.configuration?.lots || emptyLotsCibles(1))];
    lots[idx] = { ...emptyLotCible(idx), ...lots[idx], [key]: value };
    return markDirtyData({ ...prev, configuration: { ...prev.configuration, lots } });
  });
  const addLotVisite = () => setData(prev => {
    const currentLots = prev.configuration?.lots || emptyLotsCibles(1);
    const lots = [...currentLots, emptyLotCible(currentLots.length)];
    return markDirtyData({
      ...prev,
      general: { ...prev.general, lots_cibles: String(lots.length) },
      configuration: { ...prev.configuration, lots },
    });
  });
  const removeLotVisite = (idx) => setData(prev => {
    const currentLots = prev.configuration?.lots || emptyLotsCibles(1);
    if (currentLots.length <= 1) return prev;
    const lots = currentLots.filter((_, i) => i !== idx).map((lot, i) => ({ ...lot, numero: String(i + 1) }));
    return markDirtyData({
      ...prev,
      general: { ...prev.general, lots_cibles: String(lots.length) },
      configuration: { ...prev.configuration, lots },
    });
  });

  const lots = data.configuration?.lots || [];
  const totalLoyersMensuels = lots.reduce((s,l)=>s+numVal(l.loyer),0);
  const totalLoyersAnnuels = totalLoyersMensuels * 12;
  const fin = data.finance || {};
  const coutOperation =
    numVal(fin.prix_acquisition_negocie) + numVal(fin.frais_notaire) + numVal(fin.frais_agence) +
    numVal(fin.frais_profero) + numVal(fin.budget_travaux_ttc) + numVal(fin.mobilier) +
    numVal(fin.frais_financement) + numVal(fin.divers_fonds_roulement);
  const loyersNetsVacance = totalLoyersAnnuels * (1 - (numVal(fin.taux_vacance) / 100));
  const loyersNetsCharges = loyersNetsVacance - numVal(fin.charges_annuelles);
  const rendementBrut = coutOperation > 0 ? (totalLoyersAnnuels / coutOperation) * 100 : 0;
  const rendementNet = coutOperation > 0 ? (loyersNetsCharges / coutOperation) * 100 : 0;

  const filled = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  const allTechniqueItems = TECHNIQUE_VISITE_GROUPS.flatMap(g => g.items);
  const issueStatuses = ["À vérifier", "Problème"];
  const targetLotsCount = Math.max(1, (lots || []).length || numVal(data.general?.lots_cibles) || 1);
  const isLotComplete = (lot) => filled(lot?.type) && filled(lot?.surface) && filled(lot?.loyer) && filled(lot?.meuble) && filled(lot?.stationnement);
  const countLots = (lots || []).filter(isLotComplete).length;
  const item = (label, done) => ({ label, done: !!done });
  const fieldItem = (label, obj, key) => item(label, filled(obj?.[key]));
  const auditItems = (title, values, items) => items.flatMap(([key,label]) => {
    const row = values?.[key] || {};
    const base = [item(`${title} — ${label}`, filled(row.statut))];
    if (issueStatuses.includes(row.statut || "")) {
      base.push(item(`${title} — commentaire ${label}`, filled(row.commentaire)));
    }
    return base;
  });
  const lotsChecklist = Array.from({length:targetLotsCount}, (_,i) => {
    const lot = lots?.[i] || {};
    return [
      item(`Lot ${i+1} — type`, filled(lot.type)),
      item(`Lot ${i+1} — surface`, filled(lot.surface)),
      item(`Lot ${i+1} — loyer cible`, filled(lot.loyer)),
      item(`Lot ${i+1} — meublé ou nu`, filled(lot.meuble)),
      item(`Lot ${i+1} — stationnement`, filled(lot.stationnement)),
    ];
  }).flat();
  const getStepChecklist = (idx) => {
    switch (idx) {
      case 0:
        return [
          fieldItem("Conseiller Profero", data.identification, "conseiller_profero"),
          fieldItem("Adresse complète", data.identification, "adresse"),
          fieldItem("Ville", data.identification, "ville"),
          fieldItem("Code postal", data.identification, "code_postal"),
          fieldItem("Date de visite", data.identification, "date_visite"),
          fieldItem("Source", data.identification, "source"),
          fieldItem("Type de bien", data.general, "type_bien"),
          fieldItem("Année de construction", data.general, "annee_construction"),
          fieldItem("Surface totale", data.general, "surface_totale"),
          fieldItem("Nombre de niveaux", data.general, "nombre_niveaux"),
          fieldItem("Nombre de lots actuels", data.general, "lots_actuels"),
          fieldItem("Nombre de lots cibles", data.general, "lots_cibles"),
          fieldItem("Prix affiché", data.general, "prix_affiche"),
          fieldItem("Mandat", data.general, "mandat"),
          fieldItem("Agence / vendeur", data.general, "agence_vendeur"),
          fieldItem("Délai de vente estimé", data.general, "delai_vente_estime"),
          fieldItem("Durée d’exposition de l’annonce", data.general, "duree_exposition_annonce"),
        ];
      case 1:
        return [
          fieldItem("Présence d’escaliers intérieurs", data.configuration, "escaliers_interieurs"),
          fieldItem("Accès indépendants existants", data.configuration, "acces_independants"),
          fieldItem("Nombre de compteurs eau", data.configuration, "compteurs_eau"),
          fieldItem("Nombre de compteurs gaz", data.configuration, "compteurs_gaz"),
          fieldItem("Nombre de compteurs électricité", data.configuration, "compteurs_electricite"),
          ...lotsChecklist,
        ];
      case 2:
        return TECHNIQUE_VISITE_GROUPS.flatMap(g => auditItems(g.title, data.technique, g.items));
      case 3:
        return [
          fieldItem("DPE actuel", data.dpe, "dpe_actuel"),
          fieldItem("GES actuel", data.dpe, "ges_actuel"),
          fieldItem("Consommation énergie", data.dpe, "conso_energie"),
          fieldItem("Émissions CO2", data.dpe, "emissions_co2"),
          fieldItem("DPE cible", data.dpe, "dpe_cible"),
          fieldItem("Audit énergétique disponible", data.dpe, "audit_disponible"),
          fieldItem("Passoires identifiées", data.dpe, "passoires_identifiees"),
          fieldItem("Travaux énergétiques envisagés", data.dpe, "travaux_energetiques"),
          ...auditItems("Urbanisme", data.urbanisme?.controles, URBANISME_VISITE_ITEMS),
          fieldItem("Contact mairie / urbanisme consulté", data.urbanisme, "contact_mairie"),
          fieldItem("Observations réglementaires", data.urbanisme, "observations"),
          fieldItem("Autorisations préalables", data.urbanisme, "autorisations"),
          fieldItem("Durée prévisionnelle du chantier", data.urbanisme, "duree_chantier"),
          fieldItem("Complexité estimée", data.urbanisme, "complexite"),
          fieldItem("Points de vigilance travaux", data.urbanisme, "vigilance_travaux"),
        ];
      case 4:
        return [
          fieldItem("Prix acquisition négocié", data.finance, "prix_acquisition_negocie"),
          fieldItem("Frais de notaire", data.finance, "frais_notaire"),
          fieldItem("Frais d’agence", data.finance, "frais_agence"),
          fieldItem("Frais Profero Invest", data.finance, "frais_profero"),
          fieldItem("Budget travaux TTC", data.finance, "budget_travaux_ttc"),
          fieldItem("Mobilier", data.finance, "mobilier"),
          fieldItem("Frais financement / garantie", data.finance, "frais_financement"),
          fieldItem("Divers / fonds de roulement", data.finance, "divers_fonds_roulement"),
          fieldItem("Taux de vacance", data.finance, "taux_vacance"),
          fieldItem("Charges annuelles", data.finance, "charges_annuelles"),
          fieldItem("Cash-flow mensuel", data.finance, "cashflow_mensuel"),
          fieldItem("Durée de remboursement", data.finance, "duree_remboursement"),
          fieldItem("Plus-value potentielle", data.finance, "plus_value_potentielle"),
        ];
      case 5:
        return [
          fieldItem("Tension locative", data.marche, "tension_locative"),
          fieldItem("Délai de relocation", data.marche, "delai_relocation"),
          fieldItem("Loyer moyen secteur", data.marche, "loyer_moyen_m2"),
          fieldItem("Colocation possible", data.marche, "colocation_possible"),
          fieldItem("Location meublée pertinente", data.marche, "meuble_pertinente"),
          fieldItem("Location nue pertinente", data.marche, "nue_pertinente"),
          fieldItem("Régime fiscal adapté", data.marche, "regime_fiscal"),
          fieldItem("Durée moyenne de vacance", data.marche, "vacance_moyenne"),
          fieldItem("Profil locataires cibles", data.marche, "profil_locataires"),
          fieldItem("Concurrence directe", data.marche, "concurrence"),
          fieldItem("Points forts du secteur", data.marche, "points_forts"),
          fieldItem("Points faibles / risques secteur", data.marche, "points_faibles"),
          ...auditItems("Risques", data.risques?.controles, RISQUES_VISITE_ITEMS),
          fieldItem("Marge de négociation", data.risques, "marge_negociation"),
          fieldItem("Points de négociation", data.risques, "points_negociation"),
          fieldItem("Conditions suspensives", data.risques, "conditions_suspensives"),
          fieldItem("Observations libres", data.risques, "observations_libres"),
        ];
      default:
        return [
          fieldItem("Note globale", data.conclusion, "note_globale"),
          fieldItem("Recommandation", data.conclusion, "recommandation"),
          fieldItem("Prix d’offre recommandé", data.conclusion, "prix_offre_recommande"),
          fieldItem("Stratégie locative", data.conclusion, "strategie_locative"),
          fieldItem("Fiscalité recommandée", data.conclusion, "fiscalite_recommandee"),
          fieldItem("Prochaine étape", data.conclusion, "prochaine_etape"),
          fieldItem("Commentaire conseiller", data.conclusion, "commentaire_conseiller"),
        ];
    }
  };
  const stepScores = Array.from({length:7}, (_,i) => {
    const list = getStepChecklist(i);
    return { done:list.filter(x=>x.done).length, total:list.length || 1 };
  });
  const pct = (i) => Math.min(100, Math.round((stepScores[i].done / Math.max(stepScores[i].total, 1)) * 100));
  const globalDone = stepScores.reduce((s,x)=>s+x.done,0);
  const globalTotal = stepScores.reduce((s,x)=>s+x.total,0);
  const globalPct = Math.min(100, Math.round((globalDone / Math.max(globalTotal,1)) * 100));
  const stepCompleted = (i) => getStepChecklist(i).every(x => x.done);
  const currentMissing = getStepChecklist(visitStep).filter(x => !x.done).map(x => x.label);
  const currentStepComplete = currentMissing.length === 0;
  const canReachStep = () => true;


  const sauvegarder = async (options = {}) => {
    const { refresh = true, dataOverride = null, silent = false } = options;
    const dataToSave = dataOverride || latestDataRef.current || data;
    if (!bien?.id) return false;
    if (!silent) { setSaving(true); setError(""); }
    const fullAddress = [dataToSave.identification?.adresse, dataToSave.identification?.code_postal, dataToSave.identification?.ville].filter(Boolean).join(", ").trim();
    const lotsToSave = dataToSave.configuration?.lots || [];
    const totalLoyersMensuelsSave = lotsToSave.reduce((s,l)=>s+numVal(l.loyer),0);
    const totalLoyersAnnuelsSave = totalLoyersMensuelsSave * 12;
    const finToSave = dataToSave.finance || {};
    const coutOperationSave =
      numVal(finToSave.prix_acquisition_negocie) + numVal(finToSave.frais_notaire) + numVal(finToSave.frais_agence) +
      numVal(finToSave.frais_profero) + numVal(finToSave.budget_travaux_ttc) + numVal(finToSave.mobilier) +
      numVal(finToSave.frais_financement) + numVal(finToSave.divers_fonds_roulement);
    const loyersNetsVacanceSave = totalLoyersAnnuelsSave * (1 - (numVal(finToSave.taux_vacance) / 100));
    const loyersNetsChargesSave = loyersNetsVacanceSave - numVal(finToSave.charges_annuelles);
    const rendementBrutSave = coutOperationSave > 0 ? (totalLoyersAnnuelsSave / coutOperationSave) * 100 : 0;
    const rendementNetSave = coutOperationSave > 0 ? (loyersNetsChargesSave / coutOperationSave) * 100 : 0;
    const previousAddress = getBienGoogleAddress(bien || {});
    const geocoded = fullAddress ? await getCoordinatesFromAddress(fullAddress) : null;
    const coords = resolveCoordinatesFromGeocode(geocoded, bien, fullAddress, previousAddress);

    const visiteData = {
      ...dataToSave,
      identification: {
        ...dataToSave.identification,
        latitude: coords.lat ?? "",
        longitude: coords.lng ?? "",
        geocoded_address: geocoded?.formatted_address || fullAddress || "",
        geocoding_status: geocoded?.error ? `Erreur : ${geocoded.error}` : (fullAddress ? "Adresse géolocalisée" : "Adresse non renseignée"),
        reference_interne: bien.reference_interne || dataToSave.identification?.reference_interne || "",
        total_loyers_mensuels_cibles: totalLoyersMensuelsSave,
        total_loyers_annuels_cibles: totalLoyersAnnuelsSave,
      },
      finance: {
        ...dataToSave.finance,
        cout_total_operation_calcule: coutOperationSave,
        loyers_bruts_mensuels: totalLoyersMensuelsSave,
        loyers_bruts_annuels: totalLoyersAnnuelsSave,
        loyers_nets_vacance_calcule: Math.round(loyersNetsVacanceSave),
        loyers_nets_charges_calcule: Math.round(loyersNetsChargesSave),
        rendement_brut_calcule: Number(rendementBrutSave.toFixed(2)),
        rendement_net_calcule: Number(rendementNetSave.toFixed(2)),
      },
    };
    visiteData.simulateur = syncSimulateurFromVisiteData(visiteData, bien);
    visiteData.simulateur_updated_at = new Date().toISOString();

    const payload = {
      adresse: dataToSave.identification?.adresse?.trim() || null,
      ville: dataToSave.identification?.ville?.trim() || null,
      code_postal: dataToSave.identification?.code_postal?.trim() || null,
      latitude: coords.lat,
      longitude: coords.lng,
      date_visite: dataToSave.identification?.date_visite || null,
      conseiller_profero: dataToSave.identification?.conseiller_profero?.trim() || profil?.nom || null,
      source_bien: dataToSave.identification?.source || null,
      visite_data: visiteData,
    };

    const { error } = await supabase.from("invest_biens").update(payload).eq("id", bien.id);
    if (!silent) setSaving(false);
    if (error) {
      console.error("Erreur sauvegarde fiche visite:", error);
      if (!silent) setError(`Erreur sauvegarde : ${error.message}. Vérifiez que la migration SQL fiche visite a bien été exécutée.`);
      return false;
    }
    dirtyRef.current = false;
    if (!silent) {
      setSaved(true);
      setTimeout(()=>setSaved(false), 2200);
    }
    if (refresh && onSaved) onSaved();
    return true;
  };
  useImperativeHandle(ref, () => ({ sauvegarder }));

  // Sauvegarde automatique de la fiche visite :
  // dès qu'une donnée est modifiée, on attend une courte pause de saisie,
  // puis on enregistre dans Supabase sans recharger toute la fiche.
  useEffect(() => {
    if (!bien?.id) return;
    if (autoSaveBootRef.current) {
      autoSaveBootRef.current = false;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      sauvegarder({ refresh:false, dataOverride: latestDataRef.current });
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (dirtyRef.current && bien?.id) {
        sauvegarder({ refresh:false, dataOverride: latestDataRef.current, silent:true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bien?.id]);

  const grid2 = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:"0 12px" };
  const grid3 = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"0 12px" };
  const stepDefs = [
    { key:"essentiel", label:"Essentiel", icon:MapPin, help:"Adresse, source, vendeur et caractéristiques principales" },
    { key:"decoupe", label:"Découpe & loyers", icon:Home, help:"Configuration actuelle et loyers cibles par lot" },
    { key:"technique", label:"Technique", icon:Hammer, help:"Contrôle rapide du bâti par corps d'état" },
    { key:"energie", label:"Énergie & urbanisme", icon:AlertTriangle, help:"DPE, PLU, copropriété, autorisations" },
    { key:"finance", label:"Financier", icon:Wallet, help:"Coût global, loyers, rendement et cash-flow" },
    { key:"marche", label:"Marché & risques", icon:TrendingUp, help:"Tension locative, risques et négociation" },
    { key:"conclusion", label:"Conclusion", icon:Check, help:"Décision, prix d'offre et prochaine étape" },
  ];

  const stepButton = (s, i) => {
    const IconComp = s.icon;
    const active = visitStep === i;
    const complete = stepCompleted(i);
    const reachable = canReachStep(i);
    return (
      <button key={s.key} onClick={()=>{ if (reachable) setVisitStep(i); }} disabled={!reachable} style={{
        width:"100%", textAlign:"left", border:`1px solid ${active ? T.accentBorder : complete ? SEMANTIC.success.border : T.border}`,
        background:active ? T.accentBg : T.card, color:active ? T.accent : T.text,
        borderRadius:RADIUS.lg, padding:`${SPACING.sm+1}px ${SPACING.md}px`, cursor:reachable ? "pointer" : "not-allowed",
        display:"grid", gridTemplateColumns:"28px 1fr auto", alignItems:"center", gap:8,
        fontFamily:"inherit", transition:"all .15s", opacity:reachable ? 1 : .45,
      }}>
        <span style={{width:28,height:28,borderRadius:RADIUS.md,background:complete?SU:(active?T.accent:T.input),color:complete?"white":(active?T.onAccent:T.accent),display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={complete ? Check : IconComp} size={14} strokeWidth={2.2}/></span>
        <span style={{minWidth:0}}>
          <span style={{fontSize:FONT.sm.size+1,fontWeight:900,display:"block",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{i+1}. {s.label}</span>
          <span style={{fontSize:FONT.xs.size,color:T.textMuted,display:"block",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.help}</span>
        </span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.xs.size,fontWeight:900,color:complete?SU:(active?T.accent:T.textMuted)}}>{pct(i)}%</span>
      </button>
    );
  };

  const renderStepContent = () => {
    switch (visitStep) {
      case 0:
        return (
          <>
            <VisitSection title="1. Identification rapide" icon={MapPin} T={T}>
              <div style={grid2}>
                <MiniField label="Référence interne Profero" value={bien.reference_interne || data.identification.reference_interne || "Générée automatiquement"} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Conseiller Profero en charge" value={data.identification.conseiller_profero} onChange={v=>upd("identification","conseiller_profero",v)} required helper="Personne responsable du suivi du bien" T={T}/>
                <MiniField label="Adresse complète" value={data.identification.adresse} onChange={v=>upd("identification","adresse",v)} required helper="Utilisée pour créer automatiquement latitude / longitude" T={T}/>
                <MiniField label="Ville" value={data.identification.ville} onChange={v=>upd("identification","ville",v)} required T={T}/>
                <MiniField label="Code postal" value={data.identification.code_postal} onChange={v=>upd("identification","code_postal",v)} required T={T}/>
                <MiniField label="Date de la visite" type="date" value={data.identification.date_visite} onChange={v=>upd("identification","date_visite",v)} required T={T}/>
                <MiniField label="Source" value={data.identification.source} options={SOURCES_BIEN_VISITE} onChange={v=>upd("identification","source",v)} required T={T}/>
                <MiniField label="Géolocalisation" value={data.identification.geocoding_status || (data.identification.latitude && data.identification.longitude ? "Coordonnées enregistrées" : "Automatique à l'enregistrement")} readOnly onChange={()=>{}} T={T}/>
              </div>
            </VisitSection>
            <VisitSection title="2. Données générales utiles à la décision" icon={Building2} T={T}>
              <div style={grid3}>
                <MiniField label="Type de bien" value={data.general.type_bien} options={TYPE_BIEN_VISITE} onChange={v=>upd("general","type_bien",v)} required T={T}/>
                <MiniField label="Année de construction" type="number" value={data.general.annee_construction} onChange={v=>upd("general","annee_construction",v)} required T={T}/>
                <MiniField label="Surface totale (m²)" type="number" value={data.general.surface_totale} onChange={v=>upd("general","surface_totale",v)} required T={T}/>
                <MiniField label="Nombre de niveaux" value={data.general.nombre_niveaux} options={NIVEAUX_BIEN_VISITE} onChange={v=>upd("general","nombre_niveaux",v)} required T={T}/>
                <MiniField label="Lots actuels" type="number" value={data.general.lots_actuels} onChange={v=>upd("general","lots_actuels",v)} required T={T}/>
                <MiniField label="Lots cibles" type="number" value={data.general.lots_cibles} onChange={v=>upd("general","lots_cibles",v)} required helper="Détermine le nombre de lots à compléter à l’étape suivante" T={T}/>
                <MiniField label="Prix affiché (€)" type="number" value={data.general.prix_affiche} onChange={v=>upd("general","prix_affiche",v)} required T={T}/>
                <MiniField label="Prix/m² affiché" value={numVal(data.general.surface_totale)>0 ? Math.round(numVal(data.general.prix_affiche)/numVal(data.general.surface_totale))+" €/m²" : "—"} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Mandat" value={data.general.mandat} options={MANDATS_VISITE} onChange={v=>upd("general","mandat",v)} required T={T}/>
                <MiniField label="Agence / vendeur" value={data.general.agence_vendeur} onChange={v=>upd("general","agence_vendeur",v)} required T={T}/>
                <MiniField label="Délai de vente estimé" value={data.general.delai_vente_estime} options={DELAI_VENTE_VISITE} onChange={v=>upd("general","delai_vente_estime",v)} required T={T}/>
                <MiniField label="Durée d'exposition de l'annonce" value={data.general.duree_exposition_annonce} options={EXPOSITION_ANNONCE_VISITE} onChange={v=>upd("general","duree_exposition_annonce",v)} required T={T}/>
              </div>
            </VisitSection>
          </>
        );
      case 1:
        return (
          <VisitSection title="Configuration cible et loyers" icon={Home} T={T}>
            <div style={grid3}>
              <MiniField label="Escaliers intérieurs" value={data.configuration.escaliers_interieurs} options={YES_NO} onChange={v=>upd("configuration","escaliers_interieurs",v)} required T={T}/>
              <MiniField label="Accès indépendants existants" value={data.configuration.acces_independants} options={YES_NO} onChange={v=>upd("configuration","acces_independants",v)} required T={T}/>
              <MiniField label="Compteurs eau" value={data.configuration.compteurs_eau} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_eau",v)} required T={T}/>
              <MiniField label="Compteurs gaz" value={data.configuration.compteurs_gaz} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_gaz",v)} required T={T}/>
              <MiniField label="Compteurs électricité" value={data.configuration.compteurs_electricite} options={COMPTEUR_NOMBRE_VISITE} onChange={v=>upd("configuration","compteurs_electricite",v)} required T={T}/>
            </div>
            <div style={{overflowX:"auto", marginTop:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:10, background:T.card}}>
              <div style={{display:"grid", gridTemplateColumns:"60px 90px 90px 110px 90px 120px 38px", gap:6, minWidth:610, fontSize:FONT.xs.size, color:T.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:.7, marginBottom:6}}>
                <div>Lot</div><div>Type</div><div>Surface</div><div>Loyer cible</div><div>Meublé</div><div>Stationnement</div><div/>
              </div>
              {lots.map((lot,idx)=>(
                <div key={idx} style={{display:"grid", gridTemplateColumns:"60px 90px 90px 110px 90px 120px 38px", gap:6, minWidth:610, marginBottom:6}}>
                  <input className="inv-inp" value={lot.numero} onChange={e=>updLot(idx,"numero",e.target.value)} style={{width:"100%"}}/>
                  <select className="inv-sel" value={lot.type || ""} onChange={e=>updLot(idx,"type",e.target.value)}>{TYPES_LOT_VISITE.map(x=><option key={x}>{x}</option>)}</select>
                  <input className="inv-inp" type="number" value={lot.surface || ""} onChange={e=>updLot(idx,"surface",e.target.value)} style={{width:"100%"}}/>
                  <input className="inv-inp" type="number" value={lot.loyer || ""} onChange={e=>updLot(idx,"loyer",e.target.value)} style={{width:"100%"}}/>
                  <select className="inv-sel" value={lot.meuble || ""} onChange={e=>updLot(idx,"meuble",e.target.value)}>{YES_NO.map(x=><option key={x}>{x || "—"}</option>)}</select>
                  <select className="inv-sel" value={lot.stationnement || ""} onChange={e=>updLot(idx,"stationnement",e.target.value)}>{YES_NO.map(x=><option key={x}>{x || "—"}</option>)}</select>
                  <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={()=>removeLotVisite(idx)} disabled={lots.length <= 1} title="Supprimer ce lot" style={{padding:"5px 7px", justifyContent:"center"}}>×</button>
                </div>
              ))}
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap"}}>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addLotVisite}>
                  <Icon as={Plus} size={12} strokeWidth={2.2}/> Ajouter un lot
                </button>
                <span style={{fontSize:FONT.xs.size+1, color:T.textMuted}}>Nombre de lots libre · la fiche se sauvegarde automatiquement</span>
              </div>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, marginTop:12}}>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers mensuels cibles</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersMensuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers annuels cibles</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersAnnuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Lots renseignés</div><div className="inv-kpi-val accent" style={{fontSize:18}}>{countLots}/{lots.length}</div></div>
            </div>
          </VisitSection>
        );
      case 2:
        return (
          <>
            <div style={{padding:"10px 12px", marginBottom:12, borderRadius:RADIUS.md, background:T.accentBg, border:`1px solid ${T.accentBorder}`, color:T.textSub, fontSize:FONT.sm.size+1}}>
              Renseignez d'abord le statut de chaque point. Ajoutez un commentaire uniquement quand il y a un risque, un doute ou une précision utile.
            </div>
            {TECHNIQUE_VISITE_GROUPS.map(g => (
              <VisitSection key={g.key} title={`Technique — ${g.title}`} icon={Hammer} T={T}>
                <AuditRows items={g.items} values={data.technique} onChange={(key,field,value)=>upd("technique",key,{...(data.technique?.[key]||{}),[field]:value})} T={T}/>
              </VisitSection>
            ))}
          </>
        );
      case 3:
        return (
          <>
            <VisitSection title="Performance énergétique & DPE" icon={Sparkles} T={T}>
              <div style={grid3}>
                <MiniField label="DPE actuel" value={data.dpe.dpe_actuel} options={LETTRES_DPE} onChange={v=>upd("dpe","dpe_actuel",v)} required T={T}/>
                <MiniField label="GES actuel" value={data.dpe.ges_actuel} options={LETTRES_DPE} onChange={v=>upd("dpe","ges_actuel",v)} required T={T}/>
                <MiniField label="Consommation énergie" type="number" value={data.dpe.conso_energie} onChange={v=>upd("dpe","conso_energie",v)} required T={T}/>
                <MiniField label="Émissions CO2" type="number" value={data.dpe.emissions_co2} onChange={v=>upd("dpe","emissions_co2",v)} required T={T}/>
                <MiniField label="DPE cible" value={data.dpe.dpe_cible} options={LETTRES_DPE} onChange={v=>upd("dpe","dpe_cible",v)} required T={T}/>
                <MiniField label="Audit énergétique disponible" value={data.dpe.audit_disponible} options={YES_NO} onChange={v=>upd("dpe","audit_disponible",v)} required T={T}/>
              </div>
              <MiniField label="Principales passoires identifiées" textarea value={data.dpe.passoires_identifiees} onChange={v=>upd("dpe","passoires_identifiees",v)} required T={T}/>
              <MiniField label="Travaux d'amélioration énergétique envisagés" textarea value={data.dpe.travaux_energetiques} onChange={v=>upd("dpe","travaux_energetiques",v)} required T={T}/>
            </VisitSection>
            <VisitSection title="Urbanisme, réglementation & faisabilité" icon={AlertTriangle} T={T}>
              <AuditRows items={URBANISME_VISITE_ITEMS} values={data.urbanisme.controles} onChange={(key,field,value)=>updControl("urbanisme",key,field,value)} T={T}/>
              <div style={{...grid3, marginTop:12}}>
                <MiniField label="Contact mairie / urbanisme consulté" value={data.urbanisme.contact_mairie} onChange={v=>upd("urbanisme","contact_mairie",v)} T={T}/>
                <MiniField label="Durée prévisionnelle du chantier" value={data.urbanisme.duree_chantier} options={DUREE_CHANTIER_VISITE} onChange={v=>upd("urbanisme","duree_chantier",v)} required T={T}/>
                <MiniField label="Complexité estimée" value={data.urbanisme.complexite} options={COMPLEXITE_VISITE} onChange={v=>upd("urbanisme","complexite",v)} T={T}/>
              </div>
              <MiniField label="Observations / risques réglementaires" textarea value={data.urbanisme.observations} onChange={v=>upd("urbanisme","observations",v)} required T={T}/>
              <MiniField label="Autorisations préalables à prévoir" textarea value={data.urbanisme.autorisations} onChange={v=>upd("urbanisme","autorisations",v)} required T={T}/>
              <MiniField label="Points de vigilance travaux spécifiques" textarea value={data.urbanisme.vigilance_travaux} onChange={v=>upd("urbanisme","vigilance_travaux",v)} required T={T}/>
            </VisitSection>
          </>
        );
      case 4:
        return (
          <>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:10, marginBottom:12}}>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Coût total opération</div><div className="inv-kpi-val" style={{fontSize:18}}>{fmt(coutOperation)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Loyers annuels</div><div className="inv-kpi-val green" style={{fontSize:18}}>{fmt(totalLoyersAnnuels)}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Rendement brut</div><div className="inv-kpi-val accent" style={{fontSize:18}}>{rendementBrut ? rendementBrut.toFixed(2)+" %" : "—"}</div></div>
              <div className="inv-kpi" style={{padding:12}}><div className="inv-kpi-lbl">Rendement net</div><div className="inv-kpi-val green" style={{fontSize:18}}>{rendementNet ? rendementNet.toFixed(2)+" %" : "—"}</div></div>
            </div>
            <VisitSection title="Coût total de l'opération" icon={Wallet} T={T}>
              <div style={grid3}>
                <MiniField label="Prix acquisition négocié (€)" type="number" value={fin.prix_acquisition_negocie} onChange={v=>upd("finance","prix_acquisition_negocie",v)} required T={T}/>
                <MiniField label="Frais de notaire estimés (€)" type="number" value={fin.frais_notaire} onChange={v=>upd("finance","frais_notaire",v)} required T={T}/>
                <MiniField label="Frais d'agence (€)" type="number" value={fin.frais_agence} onChange={v=>upd("finance","frais_agence",v)} required T={T}/>
                <MiniField label="Frais Profero Invest (€)" type="number" value={fin.frais_profero} onChange={v=>upd("finance","frais_profero",v)} required T={T}/>
                <MiniField label="Budget travaux TTC (€)" type="number" value={fin.budget_travaux_ttc} onChange={v=>upd("finance","budget_travaux_ttc",v)} required T={T}/>
                <MiniField label="Mobilier si meublé (€)" type="number" value={fin.mobilier} onChange={v=>upd("finance","mobilier",v)} required T={T}/>
                <MiniField label="Frais financement / garantie (€)" type="number" value={fin.frais_financement} onChange={v=>upd("finance","frais_financement",v)} required T={T}/>
                <MiniField label="Divers / fonds de roulement (€)" type="number" value={fin.divers_fonds_roulement} onChange={v=>upd("finance","divers_fonds_roulement",v)} required T={T}/>
              </div>
            </VisitSection>
            <VisitSection title="Rentabilité locative" icon={TrendingUp} T={T}>
              <div style={grid3}>
                <MiniField label="Loyers bruts mensuels" value={fmt(totalLoyersMensuels)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Loyers bruts annuels" value={fmt(totalLoyersAnnuels)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Taux de vacance estimé (%)" type="number" value={fin.taux_vacance} onChange={v=>upd("finance","taux_vacance",v)} required T={T}/>
                <MiniField label="Loyers nets de vacance" value={fmt(loyersNetsVacance)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Charges annuelles" type="number" value={fin.charges_annuelles} onChange={v=>upd("finance","charges_annuelles",v)} required T={T}/>
                <MiniField label="Loyers nets de charges" value={fmt(loyersNetsCharges)} readOnly onChange={()=>{}} T={T}/>
                <MiniField label="Cash-flow mensuel estimé (€)" type="number" value={fin.cashflow_mensuel} onChange={v=>upd("finance","cashflow_mensuel",v)} required T={T}/>
                <MiniField label="Durée de remboursement" value={fin.duree_remboursement} options={DUREE_REMBOURSEMENT_VISITE} onChange={v=>upd("finance","duree_remboursement",v)} required T={T}/>
                <MiniField label="Plus-value potentielle à terme (€)" type="number" value={fin.plus_value_potentielle} onChange={v=>upd("finance","plus_value_potentielle",v)} required T={T}/>
              </div>
            </VisitSection>
          </>
        );
      case 5:
        return (
          <>
            <VisitSection title="Marché locatif local" icon={TrendingUp} T={T}>
              <div style={grid3}>
                <MiniField label="Tension locative" value={data.marche.tension_locative} options={TENSION_LOCATIVE} onChange={v=>upd("marche","tension_locative",v)} required T={T}/>
                <MiniField label="Délai de relocation moyen" value={data.marche.delai_relocation} options={DELAI_RELOCATION_VISITE} onChange={v=>upd("marche","delai_relocation",v)} required T={T}/>
                <MiniField label="Loyer moyen secteur (€/m²)" type="number" value={data.marche.loyer_moyen_m2} onChange={v=>upd("marche","loyer_moyen_m2",v)} required T={T}/>
                <MiniField label="Colocation possible ?" value={data.marche.colocation_possible} options={YES_NO} onChange={v=>upd("marche","colocation_possible",v)} required T={T}/>
                <MiniField label="Location meublée pertinente ?" value={data.marche.meuble_pertinente} options={YES_NO} onChange={v=>upd("marche","meuble_pertinente",v)} required T={T}/>
                <MiniField label="Location nue pertinente ?" value={data.marche.nue_pertinente} options={YES_NO} onChange={v=>upd("marche","nue_pertinente",v)} required T={T}/>
                <MiniField label="Régime fiscal adapté" value={data.marche.regime_fiscal} options={FISCALITE_VISITE} onChange={v=>upd("marche","regime_fiscal",v)} required T={T}/>
                <MiniField label="Durée moyenne de vacance" value={data.marche.vacance_moyenne} options={VACANCE_LOCATIVE_VISITE} onChange={v=>upd("marche","vacance_moyenne",v)} required T={T}/>
              </div>
              <MiniField label="Profil des locataires cibles" value={data.marche.profil_locataires} options={PROFILS_LOCATAIRES_VISITE} onChange={v=>upd("marche","profil_locataires",v)} required T={T}/>
              <MiniField label="Concurrence directe" textarea value={data.marche.concurrence} onChange={v=>upd("marche","concurrence",v)} required T={T}/>
              <MiniField label="Points forts du secteur" textarea value={data.marche.points_forts} onChange={v=>upd("marche","points_forts",v)} required T={T}/>
              <MiniField label="Points faibles ou risques du secteur" textarea value={data.marche.points_faibles} onChange={v=>upd("marche","points_faibles",v)} required T={T}/>
            </VisitSection>
            <VisitSection title="Points de vigilance & risques" icon={AlertTriangle} T={T}>
              <AuditRows items={RISQUES_VISITE_ITEMS} values={data.risques.controles} onChange={(key,field,value)=>updControl("risques",key,field,value)} T={T}/>
              <div style={{...grid3, marginTop:12}}>
                <MiniField label="Marge de négociation estimée" value={data.risques.marge_negociation} onChange={v=>upd("risques","marge_negociation",v)} T={T}/>
              </div>
              <MiniField label="Points de négociation identifiés" textarea value={data.risques.points_negociation} onChange={v=>upd("risques","points_negociation",v)} required T={T}/>
              <MiniField label="Conditions suspensives à prévoir" textarea value={data.risques.conditions_suspensives} onChange={v=>upd("risques","conditions_suspensives",v)} required T={T}/>
              <MiniField label="Observations libres" textarea value={data.risques.observations_libres} onChange={v=>upd("risques","observations_libres",v)} required T={T}/>
            </VisitSection>
          </>
        );
      default:
        return (
          <VisitSection title="Conclusion & recommandation Profero" icon={Check} T={T}>
            <div style={grid3}>
              <MiniField label="Note globale du dossier /10" type="number" value={data.conclusion.note_globale} onChange={v=>upd("conclusion","note_globale",v)} required T={T}/>
              <MiniField label="Recommandation" value={data.conclusion.recommandation} options={RECO_VISITE} onChange={v=>upd("conclusion","recommandation",v)} required T={T}/>
              <MiniField label="Prix d'offre recommandé (€)" type="number" value={data.conclusion.prix_offre_recommande} onChange={v=>upd("conclusion","prix_offre_recommande",v)} required T={T}/>
              <MiniField label="Stratégie locative recommandée" value={data.conclusion.strategie_locative} options={STRATEGIE_LOCATIVE_VISITE} onChange={v=>upd("conclusion","strategie_locative",v)} required T={T}/>
              <MiniField label="Fiscalité recommandée" value={data.conclusion.fiscalite_recommandee} options={FISCALITE_VISITE} onChange={v=>upd("conclusion","fiscalite_recommandee",v)} required T={T}/>
              <MiniField label="Prochaine étape à engager" value={data.conclusion.prochaine_etape} options={PROCHAINE_ETAPE_VISITE} onChange={v=>upd("conclusion","prochaine_etape",v)} required T={T}/>
            </div>
            <MiniField label="Commentaire libre du conseiller Profero" textarea value={data.conclusion.commentaire_conseiller} onChange={v=>upd("conclusion","commentaire_conseiller",v)} required T={T}/>
          </VisitSection>
        );
    }
  };

  return (
    <div className="inv-card" style={{overflow:"visible"}}>
      <div className="inv-card-hd blue" style={{ justifyContent:"space-between", position:"sticky", top:0, zIndex:3 }}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13} strokeWidth={2.2}/>Fiche visite guidée</span>
        <span style={{
          fontSize:FONT.xs.size+1,
          color: saving ? WA : saved ? SU : T.textMuted,
          fontWeight:800,
          display:"inline-flex",
          alignItems:"center",
          gap:5,
        }}>
          {saving && <Icon as={RefreshCw} size={11} strokeWidth={2.2} style={{animation:"spin 1s linear infinite"}}/>}
          {saving ? "Sauvegarde en cours…" : saved ? "Sauvegardé" : "Complétion progressive"}
        </span>
      </div>
      <div className="inv-card-bd">
        {error && <div style={{marginBottom:12, padding:"9px 11px", borderRadius:RADIUS.md, background:SEMANTIC.danger.bg, border:`1px solid ${SEMANTIC.danger.border}`, color:DA, fontSize:FONT.sm.size}}>{error}</div>}

        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:14}}>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Avancement fiche</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.accent}}>{globalPct}%</div>
            <div style={{height:5, borderRadius:5, background:T.input, overflow:"hidden", marginTop:6}}><div style={{width:`${globalPct}%`, height:"100%", background:T.accent}}/></div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Recommandation</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:data.conclusion?.recommandation === "Abandonner" ? DA : SU}}>{data.conclusion?.recommandation || "À compléter"}</div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Coût total</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.text}}>{fmt(coutOperation)}</div>
          </div>
          <div style={{padding:10, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.cardHover}}>
            <div className="inv-kpi-lbl">Rendement brut</div>
            <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.accent}}>{rendementBrut ? rendementBrut.toFixed(2)+" %" : "—"}</div>
          </div>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"300px 1fr", gap:16, alignItems:"start"}}>
          <div style={{position:"sticky", top:56, display:"flex", flexDirection:"column", gap:8}}>
            {stepDefs.map((s,i)=>stepButton(s,i))}
            <div style={{padding:12, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input, color:T.textMuted, fontSize:FONT.xs.size+1, lineHeight:1.55}}>
              <strong style={{color:T.accent}}>Méthode de saisie :</strong><br/>
              1. compléter l’essentiel<br/>
              2. valider la configuration cible<br/>
              3. les réponses manquantes restent visibles<br/>
              4. commentaire conseillé si “À vérifier” ou “Problème”
            </div>
          </div>

          <div>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:12, padding:"10px 12px", border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.input}}>
              <div>
                <div style={{fontSize:FONT.md.size, fontWeight:900, color:T.text}}>{stepDefs[visitStep].label}</div>
                <div style={{fontSize:FONT.sm.size, color:T.textSub, marginTop:2}}>{stepDefs[visitStep].help}</div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:900}}>{pct(visitStep)}%</div>
            </div>

            {renderStepContent()}

            {!currentStepComplete && (
              <div style={{marginTop:14, padding:"10px 12px", borderRadius:RADIUS.md, background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:T.textSub, fontSize:FONT.sm.size, lineHeight:1.5}}>
                <strong style={{color:WA}}>Réponses manquantes / à compléter :</strong>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:"2px 12px", marginTop:6}}>
                  {currentMissing.slice(0, 12).map(m => <span key={m}>• {m}</span>)}
                  {currentMissing.length > 12 && <span>• +{currentMissing.length - 12} autre(s) point(s)</span>}
                </div>
              </div>
            )}

            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginTop:14, paddingTop:12, borderTop:`1px solid ${T.border}`}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setVisitStep(Math.max(0, visitStep-1))} disabled={visitStep===0}>
                <Icon as={ChevronLeft} size={13} strokeWidth={2.2}/> Précédent
              </button>
              <div style={{fontSize:FONT.xs.size+1, color:currentStepComplete ? SU : WA, fontWeight:800}}>
                {currentStepComplete ? "Étape complète" : `${currentMissing.length} réponse(s) manquante(s)`} · étape {visitStep+1}/{stepDefs.length}
              </div>
              <button className="inv-btn inv-btn-blue" onClick={()=>setVisitStep(Math.min(stepDefs.length-1, visitStep+1))} disabled={visitStep===stepDefs.length-1} title={currentStepComplete ? "Étape suivante" : "Étape suivante — réponses à compléter visibles ci-dessus"}>
                Suivant <Icon as={ChevronRight} size={13} strokeWidth={2.2}/>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});




function mapVisiteLotsToSimulateurLots(visiteData = {}) {
  const lotsCibles = Array.isArray(visiteData?.configuration?.lots) ? visiteData.configuration.lots : [];
  return lotsCibles
    .filter(l => l && (l.type || l.surface || l.loyer || l.meuble || l.stationnement))
    .map((l, idx) => {
      const lotNumber = l.numero || String(idx + 1);
      const comments = [
        `Lot ${lotNumber}`,
        l.meuble ? `Location : ${l.meuble}` : "",
        l.stationnement ? `Stationnement : ${l.stationnement}` : "",
      ].filter(Boolean).join(" · ");
      return {
        type: l.type || "T2",
        m2: numVal(l.surface),
        loyer: numVal(l.loyer),
        niveau: l.niveau || "RDC",
        comment: comments,
      };
    });
}

function deepCloneSimulationData(value) {
  if (value === null || value === undefined) return value;

  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch (e) {
    // fallback JSON ci-dessous
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    if (Array.isArray(value)) return value.map((item) => deepCloneSimulationData(item));
    if (typeof value === "object") return { ...value };
    return value;
  }
}

function hasMeaningfulSimulationLot(lot = {}) {
  const type = String(lot.type || "").trim();
  const hasType = type && type !== "Sélectionner";
  const hasSurface = numVal(lot.m2 || lot.surface) > 0;
  const hasLoyer = numVal(lot.loyer) > 0;
  const hasComment = String(lot.comment || lot.commentaire || "").trim() !== "";

  return hasType || hasSurface || hasLoyer || hasComment;
}

function syncSimulateurFromVisiteData(visiteData = {}, bien = {}) {
  const existingSim = deepCloneSimulationData(visiteData?.simulateur || {});
  const existingInputs = deepCloneSimulationData(existingSim.inputs || {});
  const existingSelects = deepCloneSimulationData(existingSim.selects || {});
  const existingDescriptions = deepCloneSimulationData(existingSim.descriptions || {});
  const finance = visiteData.finance || {};
  const general = visiteData.general || {};
  const dpe = visiteData.dpe || {};
  const marche = visiteData.marche || {};

  const lotsFromVisite = mapVisiteLotsToSimulateurLots(visiteData);
  const existingLots = Array.isArray(existingSim.lots)
    ? deepCloneSimulationData(existingSim.lots)
    : [];

  const shouldKeepExistingLots = existingLots.some(hasMeaningfulSimulationLot);
  const lots = shouldKeepExistingLots ? existingLots : lotsFromVisite;

  const surfaceFromLots = lots.reduce((s, l) => s + (numVal(l.m2 || l.surface) || 0), 0);

  const pickPositive = (...vals) => {
    for (const v of vals) {
      const n = numVal(v);
      if (n > 0) return n;
    }
    return 0;
  };

  // IMPORTANT :
  // On privilégie maintenant les valeurs déjà présentes dans la simulation.
  // Avant, les valeurs de la fiche bien repassaient devant et écrasaient chaque simulation,
  // ce qui faisait que l'original et le duplicata semblaient rester liés.
  const prixAffiche = pickPositive(existingInputs.prixAffiche, general.prix_affiche, bien.prix_vente);
  const prixNegocie = pickPositive(existingInputs.prixNegocie, finance.prix_acquisition_negocie, bien.montant_offre, prixAffiche);
  const budgetTravaux = pickPositive(existingInputs.budgetTravaux, finance.budget_travaux_ttc, bien.prix_travaux);
  const surface = pickPositive(existingInputs.surface, general.surface_totale, bien.surface_totale, surfaceFromLots);

  const adresse = [
    visiteData.identification?.adresse || bien.adresse,
    visiteData.identification?.code_postal || bien.code_postal,
    visiteData.identification?.ville || bien.ville,
  ].filter(Boolean).join(", ");

  return {
    ...existingSim,
    version: existingSim.version || 4,
    savedAt: existingSim.savedAt || new Date().toISOString(),
    projectName: existingSim.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,

    inputs: {
      tauxNotaire: 0.08,
      enedis: 0,
      taxeFonciere: 0,
      assurance: 0,
      compta: 0,
      provisions: 0,
      apport1: 0,
      apport2: 0,
      taux1: 4.20,
      taux2: 4.20,
      duree1: 20,
      duree2: 25,
      coefEtat: 1.0,
      imprevusPct: 10,
      ...existingInputs,
      prixAffiche,
      prixNegocie,
      budgetTravaux,
      surface,
      honoraires: pickPositive(existingInputs.honoraires, finance.frais_profero),
    },

    selects: {
      gestionActive: false,
      modeDetention: "IS",
      tmi: "0.30",
      selectedScenario: 1,
      ...existingSelects,
    },

    lots: lots.length
      ? deepCloneSimulationData(lots)
      : [{ type: "Sélectionner", m2: 0, loyer: 0, niveau: "RDC", comment: "" }],

    // Partie travaux :
    // budgetQty et budgetPrice sont clonés pour que les lignes travaux du duplicata
    // ne pointent plus vers les mêmes objets que la simulation d'origine.
    budgetQty: deepCloneSimulationData(existingSim.budgetQty || {}),
    budgetPrice: deepCloneSimulationData(existingSim.budgetPrice || {}),
    customDivers: Array.isArray(existingSim.customDivers)
      ? deepCloneSimulationData(existingSim.customDivers)
      : [],

    descriptions: {
      description: existingDescriptions.description || bien.commentaire || "",
      travaux: existingDescriptions.travaux || dpe.travaux_energetiques || "",
      atouts: existingDescriptions.atouts || marche.points_forts || "",
      adresse: existingDescriptions.adresse || adresse || "",
    },

    photos: Array.isArray(existingSim.photos)
      ? deepCloneSimulationData(existingSim.photos)
      : [null, null, null, null],

    bien_id: bien.id || existingSim.bien_id || null,
    synced_from_fiche_bien_at: existingSim.synced_from_fiche_bien_at || new Date().toISOString(),
  };
}

function makeSimulationId() {
  return `sim_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function duplicateSimulationDonnees(source = {}, { newSimulationId, name, bienId }) {
  const cloned = deepCloneSimulationData(source || {});
  const now = new Date().toISOString();

  return {
    ...cloned,
    projectName: name,
    simulation_id: newSimulationId,
    bien_id: bienId || cloned.bien_id || null,
    savedAt: now,
    duplicated_at: now,
    duplicated_from_simulation_id: cloned.simulation_id || null,

    inputs: deepCloneSimulationData(cloned.inputs || {}),
    selects: deepCloneSimulationData(cloned.selects || {}),

    lots: Array.isArray(cloned.lots)
      ? deepCloneSimulationData(cloned.lots)
      : [{ type: "Sélectionner", m2: 0, loyer: 0, niveau: "RDC", comment: "" }],

    // Partie travaux indépendante
    budgetQty: deepCloneSimulationData(cloned.budgetQty || {}),
    budgetPrice: deepCloneSimulationData(cloned.budgetPrice || {}),
    customDivers: Array.isArray(cloned.customDivers)
      ? deepCloneSimulationData(cloned.customDivers)
      : [],

    descriptions: deepCloneSimulationData(cloned.descriptions || {}),
    photos: Array.isArray(cloned.photos)
      ? deepCloneSimulationData(cloned.photos)
      : [null, null, null, null],
  };
}

function makeSimulationEntry({ id = makeSimulationId(), nom = "Simulation", donnees = {}, createdAt = null } = {}) {
  const now = new Date().toISOString();
  const clonedDonnees = deepCloneSimulationData(donnees || {});
  const label = nom || clonedDonnees?.projectName || "Simulation";

  return {
    id,
    nom: label,
    created_at: createdAt || now,
    updated_at: now,
    donnees: {
      ...clonedDonnees,
      projectName: label,
      simulation_id: id,
      bien_id: clonedDonnees?.bien_id || null,
      savedAt: clonedDonnees?.savedAt || now,

      inputs: deepCloneSimulationData(clonedDonnees.inputs || {}),
      selects: deepCloneSimulationData(clonedDonnees.selects || {}),
      lots: Array.isArray(clonedDonnees.lots)
        ? deepCloneSimulationData(clonedDonnees.lots)
        : [{ type: "Sélectionner", m2: 0, loyer: 0, niveau: "RDC", comment: "" }],
      budgetQty: deepCloneSimulationData(clonedDonnees.budgetQty || {}),
      budgetPrice: deepCloneSimulationData(clonedDonnees.budgetPrice || {}),
      customDivers: Array.isArray(clonedDonnees.customDivers)
        ? deepCloneSimulationData(clonedDonnees.customDivers)
        : [],
      descriptions: deepCloneSimulationData(clonedDonnees.descriptions || {}),
      photos: Array.isArray(clonedDonnees.photos)
        ? deepCloneSimulationData(clonedDonnees.photos)
        : [null, null, null, null],
    },
  };
}

function buildDefaultSimulateurStateFromBien(bien = {}) {
  const visite = bien.visite_data || {};
  const finance = visite.finance || {};
  const general = visite.general || {};
  const lots = mapVisiteLotsToSimulateurLots(visite);

  const prixAffiche = parseFloat(general.prix_affiche || bien.prix_vente) || 0;
  const prixNegocie = parseFloat(finance.prix_acquisition_negocie || bien.montant_offre || bien.prix_vente) || prixAffiche || 0;
  const budgetTravaux = parseFloat(finance.budget_travaux_ttc || bien.prix_travaux) || 0;
  const surface = parseFloat(general.surface_totale || bien.surface_totale) || lots.reduce((s,l)=>s+(l.m2||0),0) || 0;
  const label = `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`;

  return {
    version: 4,
    savedAt: bien.updated_at || new Date().toISOString(),
    projectName: label,
    inputs: {
      prixAffiche,
      prixNegocie,
      budgetTravaux,
      tauxNotaire: 0.08,
      surface,
      honoraires: parseFloat(finance.frais_profero) || 0,
      enedis: 0,
      taxeFonciere: 0,
      assurance: 0,
      compta: 0,
      provisions: 0,
      apport1: 0,
      apport2: 0,
      taux1: 4.20,
      taux2: 4.20,
      duree1: 20,
      duree2: 25,
      coefEtat: 1.0,
      imprevusPct: 10,
    },
    selects: {
      gestionActive: false,
      modeDetention: "IS",
      tmi: "0.30",
      selectedScenario: 1,
    },
    lots: lots.length ? deepCloneSimulationData(lots) : [{ type: "Sélectionner", m2: 0, loyer: 0, niveau: "RDC", comment: "" }],
    budgetQty: {},
    budgetPrice: {},
    customDivers: [],
    descriptions: {
      description: bien.commentaire || "",
      travaux: visite.dpe?.travaux_energetiques || "",
      atouts: visite.marche?.points_forts || "",
      adresse: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
    },
    photos: [null, null, null, null],
    bien_id: bien.id || null,
  };
}

function getBienSimulations(bien = {}) {
  const visite = bien.visite_data || {};
  const sims = Array.isArray(visite.simulateurs) ? visite.simulateurs.filter(s => s?.id) : [];

  if (sims.length) {
    return sims.map((s, idx) => {
      const id = s.id || makeSimulationId();
      const nom = s.nom || s.donnees?.projectName || `Simulation ${idx + 1}`;

      return makeSimulationEntry({
        id,
        nom,
        donnees: {
          ...deepCloneSimulationData(s.donnees || {}),
          projectName: nom,
          bien_id: bien.id || s.donnees?.bien_id || null,
          simulation_id: id,
        },
        createdAt: s.created_at,
      });
    });
  }

  if (visite.simulateur) {
    const label = visite.simulateur.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`;
    const id = visite.simulateur.simulation_id || visite.simulateur_active_id || `sim_default_${bien.id || "bien"}`;

    return [makeSimulationEntry({
      id,
      nom: label,
      donnees: {
        ...deepCloneSimulationData(visite.simulateur),
        projectName: label,
        bien_id: bien.id || visite.simulateur.bien_id || null,
        simulation_id: id,
      },
      createdAt: visite.simulateur.savedAt || bien.updated_at,
    })];
  }

  const defaultState = syncSimulateurFromVisiteData(
    { ...visite, simulateur: buildDefaultSimulateurStateFromBien(bien) },
    bien
  );

  const id = visite.simulateur_active_id || `sim_default_${bien.id || "bien"}`;

  return [makeSimulationEntry({
    id,
    nom: defaultState.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
    donnees: {
      ...defaultState,
      simulation_id: id,
    },
    createdAt: bien.created_at,
  })];
}

function getActiveSimulationEntry(bien = {}, selectedSimulationId = "") {
  const sims = getBienSimulations(bien);
  const visite = bien.visite_data || {};
  const wantedId = selectedSimulationId || visite.simulateur_active_id || sims[0]?.id || "";
  return sims.find(s => s.id === wantedId) || sims[0] || null;
}

function buildSimulateurProjectFromBien(bien = {}, selectedSimulationId = "") {
  const active = getActiveSimulationEntry(bien, selectedSimulationId);
  const activeData = deepCloneSimulationData(active?.donnees || {});
  const synced = syncSimulateurFromVisiteData(
    { ...(bien.visite_data || {}), simulateur: activeData },
    bien
  );

  const nom = active?.nom || synced.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`;

  return {
    id: null,
    nom,
    client_id: "",
    donnees: {
      ...deepCloneSimulationData(synced),
      projectName: nom,
      simulation_id: active?.id || selectedSimulationId || synced.simulation_id || null,
      bien_id: bien.id || synced.bien_id || null,
    },
  };
}

function hasMetricValue(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = getNumberLoose(value);
  return Number.isFinite(n);
}

function metricValue(...values) {
  for (const value of values) {
    if (hasMetricValue(value)) return getNumberLoose(value);
  }
  return 0;
}

function getSimulationMetricsFromBien(bien = {}, selectedSimulationId = "") {
  const active = getActiveSimulationEntry(bien, selectedSimulationId);
  const sim = active?.donnees || bien.visite_data?.simulateur || {};
  const inputs = sim.inputs || {};
  const selects = sim.selects || {};
  const lots = Array.isArray(sim.lots) ? sim.lots : [];
  const activeLots = lots.filter(l => l && (l.type || "") !== "Sélectionner");

  // IMPORTANT — dossier investisseur :
  // On reprend strictement l'hypothèse active du simulateur, et non les champs agrégés du bien.
  // Sinon le dossier peut afficher un cash-flow différent si plusieurs simulations existent
  // ou si l'hypothèse 2 est sélectionnée.
  const prix = metricValue(inputs.prixNegocie, bien.montant_offre, bien.prix_vente);
  const prixAffiche = metricValue(inputs.prixAffiche, bien.prix_vente);
  const travaux = metricValue(inputs.budgetTravaux, bien.prix_travaux);
  const honoraires = metricValue(inputs.honoraires);
  const enedis = metricValue(inputs.enedis);
  const tauxNotaire = hasMetricValue(inputs.tauxNotaire) ? getNumberLoose(inputs.tauxNotaire) : 0.08;
  const coutTotalSimulateur = prix + prix * tauxNotaire + travaux + honoraires + enedis;
  const coutTotal = coutTotalSimulateur > 0 ? coutTotalSimulateur : metricValue(bien.cout_total);

  const loyerMensuel = activeLots.reduce((s,l)=>s+numVal(l.loyer),0);
  const loyerAnnuel = loyerMensuel * 12;
  const rendement = coutTotal > 0 ? (loyerAnnuel / coutTotal) * 100 : metricValue(bien.rendement_brut);

  const gestionActive = !!selects.gestionActive;
  const gestionMensuelle = gestionActive
    ? activeLots.reduce((s,l)=>s+(GESTION_PRICES[l.type] || 0),0)
    : 0;
  const gestionAnnuelle = gestionMensuelle * 12;

  const taxeFonciere = metricValue(inputs.taxeFonciere);
  const assurance = metricValue(inputs.assurance);
  const compta = metricValue(inputs.compta);
  const provisions = metricValue(inputs.provisions);
  const chargesAnnuelles = taxeFonciere + assurance + compta + gestionAnnuelle + provisions;
  const rendementNet = coutTotal > 0 ? ((loyerAnnuel - chargesAnnuelles) / coutTotal) * 100 : 0;

  const selectedScenario = String(selects.selectedScenario || 1) === "2" ? 2 : 1;
  const apport = selectedScenario === 2 ? metricValue(inputs.apport2) : metricValue(inputs.apport1);
  const taux = selectedScenario === 2 ? metricValue(inputs.taux2) : metricValue(inputs.taux1);
  const duree = selectedScenario === 2 ? metricValue(inputs.duree2, 25) : metricValue(inputs.duree1, 20);
  const montantFinance = Math.max(coutTotal - apport, 0);
  const mensualite = pmt(montantFinance, taux, duree);
  const annuite = mensualite * 12;
  const cashflow = (loyerAnnuel - chargesAnnuelles) / 12 - mensualite;
  const pointEquilibreMois = loyerAnnuel > 0 ? ((chargesAnnuelles + annuite) / loyerAnnuel) * 12 : 0;
  const margeSecuritePct = loyerAnnuel > 0 ? (1 - ((chargesAnnuelles + annuite) / loyerAnnuel)) * 100 : 0;

  return {
    simulation: active,
    simulationId: active?.id || selectedSimulationId || sim.simulation_id || "",
    simulationNom: active?.nom || sim.projectName || "Simulation",
    selectedScenario,
    prixAffiche,
    prix,
    travaux,
    coutTotal,
    loyerMensuel,
    loyerAnnuel,
    rendement,
    rendementNet,
    cashflow: Number.isFinite(cashflow) ? cashflow : metricValue(bien.cashflow_estime),
    mensualite,
    annuite,
    apport,
    taux,
    duree,
    chargesAnnuelles,
    gestionMensuelle,
    pointEquilibreMois,
    margeSecuritePct,
    lots: activeLots.length,
    surface: metricValue(inputs.surface, bien.surface_totale, bien.visite_data?.general?.surface_totale),
    score: computeAutoBienScore(bien),
    ville: bien.ville || "—",
    adresse: getBienFullAddress(bien) || "—",
    statut: bien.statut || "—",
  };
}

function ComparateurBiensNomade({ biens = [], selectedIds = [], onToggle, onOpenBien, onClose, T = THEMES_INV.dark }) {
  const selected = selectedIds.map(id => biens.find(b => b.id === id)).filter(Boolean);
  const fmtEurLocal = v => numVal(v) > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(numVal(v)) + " €" : "—";
  const fmtPctLocal = v => numVal(v) > 0 ? `${numVal(v).toFixed(1)} %` : "—";
  const rows = [
    ["Adresse", m => m.adresse],
    ["Ville", m => m.ville],
    ["Statut", m => m.statut],
    ["Simulation", m => m.simulation?.nom || "—"],
    ["Prix affiché", m => fmtEurLocal(m.prixAffiche)],
    ["Prix négocié / offre", m => fmtEurLocal(m.prix)],
    ["Travaux", m => fmtEurLocal(m.travaux)],
    ["Coût total", m => fmtEurLocal(m.coutTotal)],
    ["Loyer mensuel", m => fmtEurLocal(m.loyerMensuel)],
    ["Rendement brut", m => fmtPctLocal(m.rendement)],
    ["Cash-flow", m => `${fmtEurLocal(m.cashflow)}/mois`],
    ["Lots", m => m.lots || "—"],
    ["Surface", m => m.surface ? `${m.surface} m²` : "—"],
    ["Score Profero", m => m.score ? `${m.score}/100` : "—"],
  ];
  const metrics = selected.map(b => ({ bien: b, m: getSimulationMetricsFromBien(b) }));

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1500, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:18, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onClose}><Icon as={ArrowLeft} size={12}/> Stock de biens</button>
          <div>
            <div style={{ fontSize:26, fontWeight:900, color:T.text }}>Comparateur de projets</div>
            <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>Sélectionnez jusqu’à 3 biens pour comparer rapidement les hypothèses et la rentabilité</div>
          </div>
        </div>
        <span className="inv-badge">{selected.length}/3 biens sélectionnés</span>
      </div>

      {selected.length === 0 ? (
        <div className="inv-card" style={{ padding:24, textAlign:"center", color:T.textMuted }}>Aucun bien sélectionné. Retournez dans le stock et cochez jusqu’à 3 biens.</div>
      ) : (
        <div className="inv-card" style={{ overflowX:"auto" }}>
          <div style={{ minWidth:860 }}>
            <div style={{ display:"grid", gridTemplateColumns:`220px repeat(${Math.max(1, selected.length)}, minmax(220px, 1fr))`, gap:0 }}>
              <div style={{ padding:14, background:T.sectionHd, borderBottom:`1px solid ${T.border}`, color:T.textMuted, fontWeight:800, textTransform:"uppercase", fontSize:11 }}>Critère</div>
              {metrics.map(({ bien }) => (
                <div key={bien.id} style={{ padding:14, background:T.sectionHd, borderBottom:`1px solid ${T.border}`, borderLeft:`1px solid ${T.border}` }}>
                  <div style={{ color:T.text, fontWeight:900, fontSize:14 }}>{bien.reference_interne || bien.adresse || "Bien"}</div>
                  <div style={{ color:T.textMuted, fontSize:12, marginTop:3 }}>{[bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(" ")}</div>
                  <div style={{ display:"flex", gap:6, marginTop:9, flexWrap:"wrap" }}>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOpenBien?.(bien.id)}><Icon as={Eye} size={12}/> Ouvrir</button>
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onToggle?.(bien.id)}>Retirer</button>
                  </div>
                </div>
              ))}
              {rows.map(([label, getter]) => (
                <React.Fragment key={label}>
                  <div style={{ padding:"11px 14px", borderBottom:`1px solid ${T.border}`, color:T.textMuted, fontWeight:800, fontSize:12 }}>{label}</div>
                  {metrics.map(({ bien, m }) => (
                    <div key={`${bien.id}-${label}`} style={{ padding:"11px 14px", borderBottom:`1px solid ${T.border}`, borderLeft:`1px solid ${T.border}`, color:T.text, fontWeight:700, fontSize:13 }}>
                      {getter(m)}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop:18 }} className="inv-card">
        <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13}/>Ajouter / retirer des biens</span></div>
        <div className="inv-card-bd" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:10 }}>
          {biens.map(b => {
            const active = selectedIds.includes(b.id);
            const disabled = !active && selectedIds.length >= 3;
            const m = getSimulationMetricsFromBien(b);
            return (
              <button key={b.id} disabled={disabled} onClick={() => onToggle?.(b.id)} className="inv-btn inv-btn-out" style={{ justifyContent:"space-between", textAlign:"left", opacity: disabled ? .5 : 1, padding:12 }}>
                <span style={{ minWidth:0 }}>
                  <span style={{ display:"block", color:T.text, fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.reference_interne || b.adresse || "Bien"}</span>
                  <span style={{ display:"block", color:T.textSub, fontSize:11, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getBienFullAddress(b) || "Adresse non renseignée"}</span>
                  <span style={{ display:"block", color:T.textMuted, fontSize:11, marginTop:3 }}>{fmtEurLocal(m.coutTotal)} · {fmtPctLocal(m.rendement)} · {fmtEurLocal(m.cashflow)}/mois</span>
                </span>
                <Icon as={active ? Check : Plus} size={14}/>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function openFicheClientInvestisseurPDFAvecMap(data = {}) {
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

  const eur = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n === 0) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " €";
  };

  const pct = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n === 0) return "—";
    return n.toFixed(2).replace(".", ",") + " %";
  };

  const lots = Array.isArray(data.lots) ? data.lots : [];
  const lotRows = lots.map((l, index) => `
    <tr>
      <td>${esc(l.type || `Lot ${index + 1}`)}</td>
      <td>${esc(l.niveau || "—")}</td>
      <td>${esc(l.m2 || 0)} m²</td>
      <td>${eur(l.loyer)}/mois</td>
      <td>${eur(l.gestion)}/mois</td>
      <td>${esc(l.comment || "")}</td>
    </tr>
  `).join("");

  const mapEmbed = data.mapEmbedUrl || googleMapsEmbedUrl(data.address || "");
  const mapLink = data.mapSearchUrl || googleMapsSearchUrl(data.address || "");
  const logo = LOGO_INVEST_H || LOGO_INVEST_V || "";

  const win = window.open("", "_blank", "width=980,height=780");
  if (!win) {
    alert("Autorisez les pop-ups pour générer la fiche client.");
    return;
  }

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(data.title || "Fiche client investisseur")}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f3f5f9;color:#172033;font-family:Arial,Helvetica,sans-serif}
  .wrap{max-width:960px;margin:0 auto;background:#fff;min-height:100vh}
  .hero{background:linear-gradient(135deg,#111827,#1f2f4a);color:#fff;padding:30px 38px 26px}
  .brand{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}
  .brand img{max-height:44px;max-width:240px;object-fit:contain}
  .brand .tag{font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:rgba(255,255,255,.62);font-weight:800}
  h1{font-size:32px;line-height:1.05;margin:0 0 8px;font-weight:900;letter-spacing:-.5px}
  .sub{font-size:14px;color:rgba(255,255,255,.76);line-height:1.45}
  .pill{display:inline-block;border:1px solid rgba(201,163,74,.55);color:#f4d58a;background:rgba(201,163,74,.11);border-radius:999px;padding:7px 12px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.9px;margin-top:14px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 38px;background:#fff}
  .kpi{background:#f8fafc;border:1px solid #e5eaf2;border-radius:14px;padding:14px 13px;border-left:4px solid #c9a34a}
  .kpi .v{font-size:21px;font-weight:900;color:#14213d;line-height:1.1}
  .kpi .l{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.9px;margin-top:5px;font-weight:800}
  .sec{padding:20px 38px;border-top:1px solid #e8edf5}
  .title{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#1f4ea1;margin-bottom:12px}
  .title:before{content:"";width:9px;height:9px;border-radius:50%;background:#c9a34a;display:inline-block}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 22px}
  .row{display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid #edf1f7;padding:8px 0;font-size:13px}
  .row span{color:#64748b}
  .row b{color:#172033;text-align:right}
  table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;overflow:hidden;border-radius:12px;border:1px solid #e5eaf2}
  th{background:#172033;color:#fff;text-align:left;padding:10px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.8px}
  td{padding:10px 9px;border-bottom:1px solid #edf1f7;color:#172033}
  tr:last-child td{border-bottom:0}
  .map{border:1px solid #e5eaf2;border-radius:16px;overflow:hidden;background:#f8fafc}
  .map iframe{width:100%;height:300px;border:0;display:block}
  .map-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 13px;font-size:12px;color:#64748b;border-top:1px solid #e5eaf2}
  .map-foot a{color:#1f4ea1;font-weight:800;text-decoration:none}
  .txt{font-size:13px;line-height:1.62;color:#263244;white-space:pre-wrap}
  .reco{background:linear-gradient(135deg,#f8fafc,#fff8e1);border:1px solid #ead9a8;border-radius:16px;padding:15px 16px;font-size:14px;font-weight:800;color:#172033}
  .no-print{position:fixed;right:18px;top:18px;z-index:5}
  .btn{background:#1f4ea1;color:#fff;border:0;border-radius:10px;padding:11px 16px;font-weight:900;cursor:pointer;box-shadow:0 12px 26px rgba(31,78,161,.22)}
  @media print{
    body{background:#fff}
    .wrap{max-width:none}
    .no-print{display:none}
    .hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .kpi{break-inside:avoid}
    .sec{break-inside:avoid}
    .map iframe{height:260px}
  }
</style>
</head>
<body>
  <div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div>
  <div class="wrap">
    <div class="hero">
      <div class="brand">
        ${logo ? `<img src="${esc(logo)}" alt="Profero Invest">` : `<div class="tag">Profero Invest</div>`}
        <div class="tag">${esc(data.dateEdition || "")}</div>
      </div>
      <h1>${esc(data.title || "Fiche client investisseur")}</h1>
      <div class="sub">${esc(data.subtitle || "Analyse de rentabilité")}<br>${esc(data.address || "")}</div>
      <div class="pill">${esc(data.recommandation || "Analyse Profero Invest")}</div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="v">${eur(data.coutTotal)}</div><div class="l">Coût total</div></div>
      <div class="kpi"><div class="v">${pct(data.rendementBrutPct)}</div><div class="l">Rendement brut</div></div>
      <div class="kpi"><div class="v">${eur(data.cashflowS1)}/mois</div><div class="l">Cash-flow</div></div>
      <div class="kpi"><div class="v">${eur(data.totLoyer)}/mois</div><div class="l">Loyers</div></div>
    </div>

    ${mapEmbed ? `
    <div class="sec">
      <div class="title">Localisation du bien</div>
      <div class="map">
        <iframe src="${esc(mapEmbed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
        <div class="map-foot">
          <span>${esc(data.address || data.mapAddress || "")}</span>
          <a href="${esc(mapLink)}" target="_blank" rel="noreferrer">Ouvrir dans Google Maps →</a>
        </div>
      </div>
    </div>` : ""}

    <div class="sec">
      <div class="title">Synthèse financière</div>
      <div class="grid">
        <div class="row"><span>Prix d'achat / offre</span><b>${eur(data.prixAchat)}</b></div>
        <div class="row"><span>Budget travaux</span><b>${eur(data.budgetTravaux)}</b></div>
        <div class="row"><span>Surface</span><b>${esc(data.surface || "—")} m²</b></div>
        <div class="row"><span>Logements</span><b>${esc(data.logements || "—")}</b></div>
        <div class="row"><span>Loyers annuels</span><b>${eur(data.totLoyerAn)}</b></div>
        <div class="row"><span>Charges annuelles</span><b>${eur(data.chargesAnnuelles)}</b></div>
        <div class="row"><span>Mensualité estimée</span><b>${eur(data.mensualiteS1)}/mois</b></div>
        <div class="row"><span>Rendement net</span><b>${pct(data.rendementNetPct)}</b></div>
        <div class="row"><span>Point d'équilibre</span><b>${Number(data.pointEquilibreMois || 0).toFixed(1).replace(".", ",")} mois</b></div>
        <div class="row"><span>Marge de sécurité</span><b>${pct(data.margeSecuritePct)}</b></div>
      </div>
    </div>

    <div class="sec">
      <div class="title">Configuration locative cible</div>
      <table>
        <thead><tr><th>Lot</th><th>Niveau</th><th>Surface</th><th>Loyer</th><th>Gestion</th><th>Commentaire</th></tr></thead>
        <tbody>${lotRows || `<tr><td colspan="6">Aucun lot renseigné</td></tr>`}</tbody>
      </table>
    </div>

    <div class="sec">
      <div class="title">Présentation du projet</div>
      <div class="txt">${esc(data.description || "")}</div>
    </div>

    <div class="sec">
      <div class="title">Travaux envisagés</div>
      <div class="txt">${esc(data.travaux || "")}</div>
    </div>

    <div class="sec">
      <div class="title">Atouts et recommandation</div>
      <div class="reco">${esc(data.atouts || data.recommandation || "")}</div>
    </div>
  </div>
</body>
</html>`);
  win.document.close();
}


function dossierEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '\"':"&quot;", "'":"&#39;"
  }[c]));
}

function dossierFmtEur(value) {
  const n = getNumberLoose(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(n) + " €";
}

function dossierFmtPct(value) {
  const n = getNumberLoose(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(1).replace(".", ",") + " %";
}

function getDossierLotsFromBien(bien = {}, selectedSimulationId = "") {
  const v = bien.visite_data || {};
  const active = getActiveSimulationEntry(bien, selectedSimulationId);
  const simLots = Array.isArray(active?.donnees?.lots) ? active.donnees.lots : (Array.isArray(v.simulateur?.lots) ? v.simulateur.lots : []);
  const visiteLots = Array.isArray(v.configuration?.lots) ? v.configuration.lots : [];
  return (simLots.length ? simLots : visiteLots)
    .filter(l => l && (l.type || l.typologie || l.surface || l.m2 || l.loyer) && (l.type || "") !== "Sélectionner")
    .map((l, index) => ({
      numero: l.numero || String(index + 1),
      type: l.type || l.typologie || l.type_lot || "Lot",
      surface: getNumberLoose(l.m2 || l.surface),
      loyer: getNumberLoose(l.loyer || l.loyer_cible),
      niveau: l.niveau || "—",
      commentaire: l.comment || l.commentaire || "",
    }));
}

function cleanDossierMediaList(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => ({
      id: item?.id || `media_${Date.now()}_${index}`,
      url: String(item?.url || "").trim(),
      titre: item?.titre || "",
      legende: item?.legende || "",
      source: item?.source || (String(item?.url || "").startsWith("data:") ? "upload" : "url"),
      filename: item?.filename || "",
      size_bytes: item?.size_bytes || null,
      uploaded_at: item?.uploaded_at || null,
    }))
    .filter(item => item.url || item.titre || item.legende);
}

function emptyDossierMediaItem(prefix = "media") {
  return { id:`${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`, url:"", titre:"", legende:"", source:"url", filename:"", size_bytes:null, uploaded_at:null };
}

function dossierFileNameToTitle(filename = "") {
  return String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function dossierFormatFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function readDossierFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function loadDossierImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image impossible à charger."));
    img.src = dataUrl;
  });
}

async function compressDossierImageFile(file, { maxWidth = 1800, maxHeight = 1800, quality = 0.84 } = {}) {
  if (!file) throw new Error("Aucun fichier sélectionné.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Seules les images sont acceptées pour le dossier investisseur.");

  const originalDataUrl = await readDossierFileAsDataUrl(file);
  const img = await loadDossierImage(originalDataUrl);
  const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return originalDataUrl;
  ctx.drawImage(img, 0, 0, width, height);

  // JPEG volontairement utilisé pour garder les dossiers légers dans visite_data.
  // Les PNG transparents restent acceptés, mais seront convertis en image optimisée.
  return canvas.toDataURL("image/jpeg", quality);
}

async function buildDossierMediaItemFromFile(file, prefix = "photo") {
  const url = await compressDossierImageFile(file);
  return {
    id: `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    url,
    titre: dossierFileNameToTitle(file.name),
    legende: "",
    source: "upload",
    filename: file.name || "image",
    size_bytes: file.size || null,
    uploaded_at: new Date().toISOString(),
  };
}

function buildDossierPresentationDefaults(bien = {}, selectedSimulationId = "") {
  const v = bien.visite_data || {};
  const gen = v.general || {};
  const marche = v.marche || {};
  const concl = v.conclusion || {};
  const terrain = v.mode_visite_terrain || {};
  const dossierSaved = v.dossier_presentation || {};
  const metrics = getSimulationMetricsFromBien(bien, selectedSimulationId);
  const lots = getDossierLotsFromBien(bien, selectedSimulationId);
  const adresse = [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(" ");
  const ville = bien.ville || gen.ville || "la ville ciblée";
  const lotsLabel = lots.length ? `${lots.length} logement${lots.length > 1 ? "s" : ""}` : (gen.lots_cibles ? `${gen.lots_cibles} logement(s)` : "plusieurs logements");
  const rb = metrics.rendement ? dossierFmtPct(metrics.rendement) : (bien.rendement_brut ? dossierFmtPct(bien.rendement_brut) : "à confirmer");
  const prixCible = metricValue(metrics.prix, bien.montant_offre, bien.prix_vente);
  const travaux = metricValue(metrics.travaux, bien.prix_travaux);
  const coutTotal = metricValue(metrics.coutTotal, bien.cout_total, prixCible + travaux);

  const photoPrincipale = dossierSaved.photo_url || v.photo_principale_url || bien.photo_url || "";
  const galeriePhotos = cleanDossierMediaList(dossierSaved.photos || []);
  const plansProjet = cleanDossierMediaList(dossierSaved.plans || []);

  return {
    titre: bien.reference_interne ? `Dossier investisseur — ${bien.reference_interne}` : "Dossier investisseur premium",
    sous_titre: adresse || "Projet immobilier analysé et structuré par Profero Invest",
    photo_url: photoPrincipale,
    photos: galeriePhotos.length ? galeriePhotos : [emptyDossierMediaItem("photo")],
    plans: plansProjet.length ? plansProjet : [emptyDossierMediaItem("plan")],
    accroche: `Un projet immobilier structuré pour transformer un actif existant en ${lotsLabel}, avec une rentabilité brute estimée à ${rb} selon les hypothèses actuellement renseignées.`,
    phrase_couverture: "Une opportunité pensée pour créer de la valeur par l’analyse, la structuration et la réalisation des travaux.",
    synthese_executive: `Ce dossier présente une opportunité d’investissement située à ${ville}. L’objectif est de valider la pertinence patrimoniale, locative et financière du projet avant engagement : emplacement, potentiel de transformation, budget global, loyers cibles et points de vigilance.`,
    analyse_ville_titre: `Analyse de ${ville}`,
    analyse_ville: marche.points_forts || `La ville de ${ville} doit être présentée sous l’angle de son attractivité résidentielle et locative : bassin d’emploi, accessibilité, services, écoles, commerces, évolution de la demande et profondeur du marché locatif.`,
    dynamique_economique: "À compléter : principaux bassins d’emploi, zones d’activité, établissements d’enseignement, pôles de santé, infrastructures et moteurs économiques locaux.",
    population_cible: marche.profil_locataires || "À compléter : étudiants, jeunes actifs, familles, salariés en mobilité, profils professionnels ou demande mixte selon le secteur.",
    analyse_quartier: terrain.points_forts || "À compléter : qualité du quartier, proximité transports, commerces, stationnement, écoles, services, perception terrain et facilité de relocation.",
    demande_locative: marche.tension_locative || marche.profil_locataires ? `Tension locative : ${marche.tension_locative || "à préciser"}. Profil cible : ${marche.profil_locataires || "à préciser"}.` : "À compléter : niveau de demande, typologie recherchée, loyers observés, vacance estimée et concurrence directe.",
    projet_global: concl.strategie_locative ? `Le projet est orienté ${concl.strategie_locative}, avec une configuration cible adaptée à la demande locative locale et aux objectifs patrimoniaux de l’investisseur.` : `Le projet consiste à repositionner le bien en ${lotsLabel}, après validation technique, financière et réglementaire. L’objectif est de créer une offre locative plus lisible, mieux valorisée et adaptée au marché local.`,
    vision_avant_apres: "Avant : un bien sous-exploité ou insuffisamment optimisé. Après : un actif restructuré, lisible, mieux positionné et générateur de revenus locatifs récurrents.",
    programme_travaux: v.dpe?.travaux_energetiques || terrain.points_blocants || "À détailler : rénovation intérieure, remise aux normes, redistribution, création ou optimisation des lots, amélioration énergétique, mobilier éventuel et finitions locatives.",
    strategie_locative: concl.strategie_locative || marche.profil_locataires || "À préciser : location meublée, location nue, colocation, mixte ou stratégie patrimoniale selon profil investisseur.",
    analyse_financiere_commentaire: `Les hypothèses financières sont construites à partir des éléments disponibles : prix cible ${dossierFmtEur(prixCible)}, travaux ${dossierFmtEur(travaux)}, coût global ${dossierFmtEur(coutTotal)} et loyers projetés issus de la configuration cible.`,
    arguments_investisseurs: "1. Création de valeur par la transformation du bien.\n2. Potentiel de revenus locatifs récurrents.\n3. Projet structuré avec analyse technique, locative et financière.\n4. Accompagnement Profero Invest et coordination possible avec les équipes travaux.",
    points_forts: marche.points_forts || terrain.points_forts || "Emplacement, potentiel de division, création de valeur par travaux, optimisation des loyers, mutualisation des coûts et projet clé en main.",
    points_vigilance: marche.points_faibles || terrain.points_blocants || "À vérifier : urbanisme, DPE, budget travaux, stationnement, diagnostics, copropriété le cas échéant et faisabilité technique définitive.",
    reponse_aux_risques: "Les points de vigilance sont intégrés à l’analyse afin d’éviter une décision uniquement basée sur la rentabilité théorique. Chaque risque doit être validé par document, devis, échange mairie, diagnostic ou contre-visite si nécessaire.",
    accompagnement_profero: "Profero Invest accompagne l’investisseur dans l’analyse, la structuration du projet, la mise en relation avec les bons interlocuteurs, le suivi des hypothèses et la préparation de la décision. Lorsque cela est pertinent, le projet peut être coordonné avec les compétences travaux du groupe.",
    conclusion: concl.commentaire_conseiller || concl.recommandation || "Opportunité à présenter sous réserve de validation des hypothèses financières, techniques et réglementaires.",
    profil_investisseur: "Investisseur recherchant un projet immobilier structuré, avec création de valeur, vision locative claire et accompagnement opérationnel.",
    prochaine_etape: concl.prochaine_etape || terrain.prochaine_action || "Valider les documents, affiner le chiffrage travaux, confirmer les loyers de marché et arbitrer le prix d’offre.",
    conditions: "Document de travail non contractuel, établi à partir des informations disponibles à date. Les chiffres sont à confirmer par devis, diagnostics, financement, documents juridiques et validation réglementaire.",
    responsable: bien.conseiller_profero || v.identification?.conseiller_profero || "Profero Invest",
    date_edition: new Date().toISOString().slice(0,10),
    afficher_page_ville: true,
    afficher_page_photos: true,
    afficher_page_plans: true,
    afficher_page_risques: true,
    afficher_page_accompagnement: true,
  };
}

function mergeDossierPresentationData(bien = {}, selectedSimulationId = "") {
  const defaults = buildDossierPresentationDefaults(bien, selectedSimulationId);
  const saved = bien.visite_data?.dossier_presentation || {};
  return {
    ...defaults,
    ...saved,
    photos: cleanDossierMediaList(saved.photos || defaults.photos),
    plans: cleanDossierMediaList(saved.plans || defaults.plans),
  };
}

function renderDossierHtmlParagraph(value = "") {
  return dossierEscapeHtml(value || "").replace(/\n/g, "<br>");
}

function renderDossierMediaGrid(items = [], fallbackLabel = "Visuel à ajouter") {
  const clean = cleanDossierMediaList(items).filter(x => x.url);
  if (!clean.length) {
    return `<div class="visual-empty"><strong>${dossierEscapeHtml(fallbackLabel)}</strong><span>Ajoutez une URL d’image, un lien Drive public ou une image hébergée depuis la fiche bien.</span></div>`;
  }
  return `<div class="media-grid">${clean.map((item, idx) => `
    <figure>
      <img src="${dossierEscapeHtml(item.url)}" alt="${dossierEscapeHtml(item.titre || fallbackLabel)} ${idx + 1}" />
      <figcaption><strong>${dossierEscapeHtml(item.titre || `Visuel ${idx + 1}`)}</strong>${item.legende ? `<br>${dossierEscapeHtml(item.legende)}` : ""}</figcaption>
    </figure>
  `).join("")}</div>`;
}

function openDossierPresentationInvestisseurPDF({ bien = {}, dossier = {}, selectedSimulationId = "" }) {
  const metrics = getSimulationMetricsFromBien(bien, selectedSimulationId);
  const lots = getDossierLotsFromBien(bien, selectedSimulationId);
  const adresse = [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(" ");
  const mapEmbed = googleMapsEmbedUrlForBien(bien);
  const mapLink = googleMapsSearchUrl(getBienMapQuery(bien) || adresse);
  const logo = LOGO_INVEST_H || LOGO_INVEST_V || "";
  const photoUrl = String(dossier.photo_url || "").trim();
  const dateEdition = dossier.date_edition ? new Date(dossier.date_edition).toLocaleDateString("fr-FR") : new Date().toLocaleDateString("fr-FR");
  const totalLoyers = lots.reduce((s,l)=>s+(Number(l.loyer)||0),0) || metrics.loyerMensuel || 0;
  const prixCible = metricValue(metrics.prix, bien.montant_offre, bien.prix_vente);
  const travaux = metricValue(metrics.travaux, bien.prix_travaux);
  const coutTotal = metricValue(metrics.coutTotal, bien.cout_total);
  const rendement = metricValue(metrics.rendement, bien.rendement_brut);
  const cashflow = metricValue(metrics.cashflow, bien.cashflow_estime);
  const surface = metrics.surface || bien.surface_totale || bien.visite_data?.general?.surface_totale || 0;
  const photoGallery = cleanDossierMediaList(dossier.photos || []);
  const planGallery = cleanDossierMediaList(dossier.plans || []);

  const lotRows = lots.map(l => `
    <tr>
      <td>${dossierEscapeHtml(l.numero)}</td>
      <td><strong>${dossierEscapeHtml(l.type)}</strong><br><span>${dossierEscapeHtml(l.niveau || "—")}</span></td>
      <td>${l.surface ? dossierEscapeHtml(l.surface) + " m²" : "—"}</td>
      <td>${dossierFmtEur(l.loyer)}/mois</td>
      <td>${dossierEscapeHtml(l.commentaire || "")}</td>
    </tr>
  `).join("");

  const photoBlock = photoUrl
    ? `<img class="hero-photo" src="${dossierEscapeHtml(photoUrl)}" alt="Photo principale du bien" />`
    : `<div class="photo-placeholder"><div>Photo principale du bien</div><span>Ajoutez une URL d’image dans la préparation du dossier</span></div>`;

  const win = window.open("", "_blank", "width=1120,height=840");
  if (!win) {
    alert("Autorisez les pop-ups pour générer le dossier investisseur.");
    return;
  }

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${dossierEscapeHtml(dossier.titre || "Dossier investisseur")}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
  html{background:#e9edf5}
  body{margin:0;background:#e9edf5;color:#172033;font-family:Arial,Helvetica,sans-serif;line-height:1.45}
  .print-toolbar{position:fixed;right:18px;top:18px;z-index:50;display:flex;align-items:center;gap:10px;background:rgba(17,24,39,.94);color:white;border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:10px 12px;box-shadow:0 18px 50px rgba(0,0,0,.28);backdrop-filter:blur(10px)}
  .print-toolbar span{font-size:11px;color:rgba(255,255,255,.72);font-weight:700;line-height:1.25}
  .print-btn{background:#c9a34a;color:#111827;border:0;border-radius:999px;padding:11px 16px;font-weight:900;box-shadow:0 8px 22px rgba(201,163,74,.28);cursor:pointer;white-space:nowrap}
  .doc{width:1060px;margin:0 auto;background:#ffffff;min-height:100vh;box-shadow:0 24px 90px rgba(15,23,42,.2)}
  .page{padding:34px 44px;border-top:1px solid #e8edf5;page-break-inside:avoid;break-inside:avoid;background:#ffffff}.page.break{page-break-before:always;break-before:page}.tight{padding-top:22px;padding-bottom:22px}
  .cover{min-height:610px;background:#14213d;background:linear-gradient(135deg,#111827 0%,#182743 58%,#263a60 100%);color:#ffffff;padding:36px 44px 34px;position:relative;overflow:hidden;page-break-after:always;break-after:page}.cover:after{content:"";position:absolute;right:-120px;top:-140px;width:410px;height:410px;border-radius:50%;background:rgba(201,163,74,.16)}.cover:before{content:"";position:absolute;left:-160px;bottom:-190px;width:430px;height:430px;border-radius:50%;background:rgba(255,255,255,.045)}
  .brand{display:flex;justify-content:space-between;align-items:center;gap:20px;position:relative;z-index:1;margin-bottom:28px}.brand img{max-height:48px;max-width:270px;object-fit:contain;filter:brightness(0) invert(1)}.brand .meta{text-align:right;color:rgba(255,255,255,.7);font-size:11px;text-transform:uppercase;letter-spacing:1.8px;font-weight:800}
  h1{font-size:43px;line-height:1.01;margin:0 0 12px;font-weight:900;letter-spacing:-.9px;max-width:780px;position:relative;z-index:1}.subtitle{font-size:17px;color:rgba(255,255,255,.8);max-width:790px;position:relative;z-index:1}.cover-claim{margin-top:20px;font-size:22px;font-weight:900;max-width:780px;line-height:1.28;color:#f8fafc;position:relative;z-index:1}.badge{display:inline-block;margin-top:18px;border:1px solid rgba(201,163,74,.7);background:rgba(201,163,74,.12);color:#f4d58a;border-radius:999px;padding:8px 13px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.1px;position:relative;z-index:1}
  .cover-photo{margin-top:28px;position:relative;z-index:1}.hero-photo{width:100%;height:315px;object-fit:cover;border-radius:24px;display:block;box-shadow:0 18px 52px rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.18)}.photo-placeholder{height:300px;border-radius:24px;background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.34);display:flex;align-items:center;justify-content:center;flex-direction:column;color:rgba(255,255,255,.82);font-weight:900;text-transform:uppercase;letter-spacing:1px}.photo-placeholder span{font-weight:600;text-transform:none;letter-spacing:0;margin-top:8px;font-size:12px;color:rgba(255,255,255,.58)}
  .section-title{margin:0 0 16px;font-size:16px;color:#14213d;text-transform:uppercase;letter-spacing:1.7px;font-weight:900;display:flex;align-items:center;gap:11px}.section-title:before{content:"";display:block;width:30px;height:3px;background:#c9a34a;border-radius:999px}.lead{font-size:20px;color:#172033;font-weight:900;margin:0 0 14px;line-height:1.38}.text{font-size:14px;color:#334155;white-space:pre-line}.muted{color:#64748b}.gold{color:#b98d22}.dark{color:#14213d}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:11px;margin-top:18px}.kpi{background:#f8fafc;border:1px solid #e5eaf2;border-radius:17px;padding:15px 13px;border-left:4px solid #c9a34a}.kpi .v{font-size:20px;font-weight:900;color:#14213d;line-height:1.08}.kpi .l{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-top:6px;font-weight:900}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.box{background:#f8fafc;border:1px solid #e5eaf2;border-radius:18px;padding:16px}.box.darkbox{background:#14213d;color:white;border:0}.box h3{margin:0 0 8px;color:#14213d;font-size:13px;text-transform:uppercase;letter-spacing:.9px}.box.darkbox h3{color:#f4d58a}.box p{margin:0;color:#334155;font-size:13.7px;white-space:pre-line}.box.darkbox p{color:rgba(255,255,255,.82)}
  .media-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.media-grid figure{margin:0;background:#f8fafc;border:1px solid #e5eaf2;border-radius:18px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.media-grid img{width:100%;height:235px;object-fit:cover;display:block}.media-grid figcaption{padding:11px 13px;color:#475569;font-size:12.5px;line-height:1.35}.media-grid figcaption strong{color:#14213d}.visual-empty{height:210px;border-radius:18px;background:#f8fafc;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#64748b;text-align:center;padding:24px}.visual-empty span{font-size:12px;margin-top:6px;color:#94a3b8;font-weight:600}
  .project{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:stretch}.project-card{background:#14213d;background:linear-gradient(135deg,#14213d,#233c65);color:white;border-radius:20px;padding:22px}.project-card h3{margin:0 0 10px;color:#f4d58a;font-size:13px;text-transform:uppercase;letter-spacing:1.1px}.project-card p{margin:0;font-size:15px;color:rgba(255,255,255,.86);white-space:pre-line}.timeline{display:grid;gap:10px}.step{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:start}.step b{width:30px;height:30px;border-radius:50%;background:#c9a34a;color:#111827;display:flex;align-items:center;justify-content:center;font-size:12px}.step span{font-size:13px;color:#334155;padding-top:5px}
  table{width:100%;border-collapse:collapse;border:1px solid #e5eaf2;border-radius:16px;overflow:hidden}th{background:#14213d;color:white;font-size:10px;text-transform:uppercase;letter-spacing:.9px;text-align:left;padding:10px}td{border-top:1px solid #e5eaf2;padding:10px;font-size:13px;color:#334155;vertical-align:top}td strong{color:#14213d}td span{color:#64748b;font-size:11px}
  .risk{background:#fff8ec;border:1px solid #f2d5a2;border-radius:18px;padding:16px}.risk strong{color:#b45309}.success{background:#eefaf3;border:1px solid #bde7cc;border-radius:18px;padding:16px}.success strong{color:#157347}.footer{background:#111827;color:rgba(255,255,255,.72);padding:24px 44px;font-size:12px}.footer strong{color:#f4d58a}

  @page{size:A4;margin:0}
  @media print{
    html,body{width:210mm;background:#ffffff!important;margin:0!important;padding:0!important}
    .print-toolbar{display:none!important}
    .doc{width:210mm!important;margin:0!important;box-shadow:none!important;background:#ffffff!important}
    .cover{min-height:297mm!important;padding:18mm 16mm!important;background:#14213d!important;background-image:linear-gradient(135deg,#111827 0%,#182743 58%,#263a60 100%)!important;color:#ffffff!important}
    .cover:after{background:rgba(201,163,74,.18)!important}.cover:before{background:rgba(255,255,255,.05)!important}
    .page{padding:13mm 15mm!important;border-top:1px solid #e8edf5!important;background:#ffffff!important;page-break-inside:avoid!important;break-inside:avoid!important}
    .page.break{page-break-before:always!important;break-before:page!important}
    .tight{padding-top:11mm!important;padding-bottom:11mm!important}
    h1{font-size:34pt!important}.subtitle{font-size:13pt!important}.cover-claim{font-size:18pt!important}
    .section-title{color:#14213d!important}.section-title:before{background:#c9a34a!important}
    .kpis{grid-template-columns:repeat(3,1fr)!important;gap:8px!important}
    .kpi{background:#f8fafc!important;border:1px solid #e5eaf2!important;border-left:4px solid #c9a34a!important;box-shadow:none!important}
    .kpi .v{color:#14213d!important}.kpi .l{color:#64748b!important}
    .box{background:#f8fafc!important;border:1px solid #e5eaf2!important}.box.darkbox{background:#14213d!important;color:#ffffff!important}.box.darkbox h3{color:#f4d58a!important}.box.darkbox p{color:rgba(255,255,255,.86)!important}
    .project-card{background:#14213d!important;background-image:linear-gradient(135deg,#14213d,#233c65)!important;color:#ffffff!important}.project-card h3{color:#f4d58a!important}.project-card p{color:rgba(255,255,255,.88)!important}
    th{background:#14213d!important;color:#ffffff!important}td{background:#ffffff!important;color:#334155!important}
    .risk{background:#fff8ec!important;border:1px solid #f2d5a2!important}.success{background:#eefaf3!important;border:1px solid #bde7cc!important}
    .footer{background:#111827!important;color:rgba(255,255,255,.72)!important}.footer strong{color:#f4d58a!important}
    .hero-photo{height:92mm!important;box-shadow:none!important}.media-grid img{height:62mm!important}.media-grid figure{background:#f8fafc!important;border:1px solid #e5eaf2!important;page-break-inside:avoid!important;break-inside:avoid!important}
    iframe{max-height:78mm!important}
    a{color:inherit!important;text-decoration:none!important}
  }
</style>
</head>
<body>
<div class="print-toolbar">
  <span>Pour exporter : Imprimer → Enregistrer au format PDF.<br>Les couleurs sont conservées par la feuille d’impression.</span>
  <button class="print-btn" onclick="window.print()">Imprimer / PDF</button>
</div>
<div class="doc">
  <section class="cover">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="Profero Invest" />` : `<div style="font-weight:900;font-size:22px;letter-spacing:1px">PROFERO INVEST</div>`}
      <div class="meta">Dossier investisseur<br>${dossierEscapeHtml(dateEdition)}</div>
    </div>
    <h1>${dossierEscapeHtml(dossier.titre || "Dossier investisseur")}</h1>
    <div class="subtitle">${dossierEscapeHtml(dossier.sous_titre || adresse || "Projet immobilier")}</div>
    <div class="cover-claim">${dossierEscapeHtml(dossier.phrase_couverture || "Projet immobilier structuré pour investisseurs")}</div>
    <div class="badge">Analyse · Projet · Rentabilité · Accompagnement</div>
    <div class="cover-photo">${photoBlock}</div>
  </section>

  <section class="page tight">
    <h2 class="section-title">Synthèse investisseur</h2>
    <p class="lead">${dossierEscapeHtml(dossier.accroche || "Synthèse du projet")}</p>
    <div class="kpis">
      <div class="kpi"><div class="v">${dossierFmtEur(prixCible)}</div><div class="l">Prix cible</div></div>
      <div class="kpi"><div class="v">${dossierFmtEur(travaux)}</div><div class="l">Travaux</div></div>
      <div class="kpi"><div class="v">${dossierFmtEur(coutTotal)}</div><div class="l">Coût global</div></div>
      <div class="kpi"><div class="v">${dossierFmtEur(totalLoyers)}</div><div class="l">Loyers mensuels</div></div>
      <div class="kpi"><div class="v">${dossierFmtPct(rendement)}</div><div class="l">Rendement brut</div></div>
      <div class="kpi"><div class="v">${dossierFmtEur(cashflow)}</div><div class="l">Cash-flow / mois</div></div>
      <div class="kpi"><div class="v">${lots.length || "—"}</div><div class="l">Lots cibles</div></div>
      <div class="kpi"><div class="v">${surface ? `${dossierEscapeHtml(surface)} m²` : "—"}</div><div class="l">Surface</div></div>
      <div class="kpi"><div class="v">${dossierEscapeHtml(bien.statut || "À analyser")}</div><div class="l">Statut</div></div>
      <div class="kpi"><div class="v">${dossierEscapeHtml(dossier.responsable || "Profero")}</div><div class="l">Suivi par</div></div>
    </div>
  </section>

  <section class="page">
    <h2 class="section-title">Résumé exécutif</h2>
    <div class="grid2">
      <div class="box darkbox"><h3>Vision du projet</h3><p>${renderDossierHtmlParagraph(dossier.synthese_executive)}</p></div>
      <div class="box"><h3>Profil investisseur</h3><p>${renderDossierHtmlParagraph(dossier.profil_investisseur)}</p></div>
    </div>
  </section>

  ${dossier.afficher_page_ville !== false ? `
  <section class="page break">
    <h2 class="section-title">Analyse de la ville et du secteur</h2>
    <div class="grid2">
      <div class="box"><h3>${dossierEscapeHtml(dossier.analyse_ville_titre || "Analyse de la ville")}</h3><p>${renderDossierHtmlParagraph(dossier.analyse_ville)}</p></div>
      <div class="box"><h3>Dynamique économique</h3><p>${renderDossierHtmlParagraph(dossier.dynamique_economique)}</p></div>
      <div class="box"><h3>Quartier et micro-localisation</h3><p>${renderDossierHtmlParagraph(dossier.analyse_quartier)}</p></div>
      <div class="box"><h3>Demande locative</h3><p>${renderDossierHtmlParagraph(dossier.demande_locative)}<br><br>${renderDossierHtmlParagraph(dossier.population_cible)}</p></div>
    </div>
    ${mapEmbed ? `<div style="margin-top:18px;border-radius:18px;overflow:hidden;border:1px solid #e5eaf2"><iframe src="${mapEmbed}" style="width:100%;height:260px;border:0" loading="lazy"></iframe></div><div style="font-size:11px;margin-top:8px"><a href="${mapLink}" target="_blank" style="color:#b98d22;font-weight:800;text-decoration:none">Ouvrir la localisation dans Google Maps →</a></div>` : ""}
  </section>` : ""}

  ${dossier.afficher_page_photos !== false ? `
  <section class="page break">
    <h2 class="section-title">Photos du bien</h2>
    ${renderDossierMediaGrid(photoGallery, "Photos du bien")}
  </section>` : ""}

  <section class="page break">
    <h2 class="section-title">Présentation du projet global</h2>
    <div class="project">
      <div class="project-card"><h3>Projet proposé</h3><p>${renderDossierHtmlParagraph(dossier.projet_global)}</p></div>
      <div class="box"><h3>Avant / Après</h3><p>${renderDossierHtmlParagraph(dossier.vision_avant_apres)}</p></div>
    </div>
    <div class="grid2" style="margin-top:18px">
      <div class="box"><h3>Programme travaux</h3><p>${renderDossierHtmlParagraph(dossier.programme_travaux)}</p></div>
      <div class="box"><h3>Stratégie locative</h3><p>${renderDossierHtmlParagraph(dossier.strategie_locative)}</p></div>
    </div>
  </section>

  ${dossier.afficher_page_plans !== false ? `
  <section class="page break">
    <h2 class="section-title">Plans du projet</h2>
    ${renderDossierMediaGrid(planGallery, "Plans du projet")}
  </section>` : ""}

  <section class="page">
    <h2 class="section-title">Configuration locative cible</h2>
    <table>
      <thead><tr><th>Lot</th><th>Typologie</th><th>Surface</th><th>Loyer cible</th><th>Commentaire</th></tr></thead>
      <tbody>${lotRows || `<tr><td colspan="5">Aucun lot renseigné</td></tr>`}</tbody>
    </table>
  </section>

  <section class="page break">
    <h2 class="section-title">Analyse financière</h2>
    <p class="lead">${renderDossierHtmlParagraph(dossier.analyse_financiere_commentaire)}</p>
    <div class="grid3" style="margin-top:18px">
      <div class="box"><h3>Coût d’acquisition</h3><p><strong>${dossierFmtEur(prixCible)}</strong><br>Prix cible / offre envisagée</p></div>
      <div class="box"><h3>Budget travaux</h3><p><strong>${dossierFmtEur(travaux)}</strong><br>Enveloppe à confirmer par devis</p></div>
      <div class="box"><h3>Coût global</h3><p><strong>${dossierFmtEur(coutTotal)}</strong><br>Base de calcul rentabilité</p></div>
      <div class="box"><h3>Loyers mensuels</h3><p><strong>${dossierFmtEur(totalLoyers)}</strong><br>Hypothèse locative cible</p></div>
      <div class="box"><h3>Rendement brut</h3><p><strong>${dossierFmtPct(rendement)}</strong><br>Avant fiscalité et charges détaillées</p></div>
      <div class="box"><h3>Cash-flow</h3><p><strong>${dossierFmtEur(cashflow)}/mois</strong><br>Selon hypothèses de financement</p></div>
    </div>
  </section>

  <section class="page">
    <h2 class="section-title">Pourquoi ce projet peut intéresser un investisseur</h2>
    <div class="grid2">
      <div class="success"><strong>Arguments investisseurs</strong><br><br>${renderDossierHtmlParagraph(dossier.arguments_investisseurs)}</div>
      <div class="box"><h3>Points forts identifiés</h3><p>${renderDossierHtmlParagraph(dossier.points_forts)}</p></div>
    </div>
  </section>

  ${dossier.afficher_page_risques !== false ? `
  <section class="page break">
    <h2 class="section-title">Points de vigilance et maîtrise des risques</h2>
    <div class="grid2">
      <div class="risk"><strong>Points à vérifier</strong><br><br>${renderDossierHtmlParagraph(dossier.points_vigilance)}</div>
      <div class="box"><h3>Réponse Profero</h3><p>${renderDossierHtmlParagraph(dossier.reponse_aux_risques)}</p></div>
    </div>
  </section>` : ""}

  ${dossier.afficher_page_accompagnement !== false ? `
  <section class="page break">
    <h2 class="section-title">Accompagnement Profero Invest</h2>
    <div class="project">
      <div class="project-card"><h3>Notre rôle</h3><p>${renderDossierHtmlParagraph(dossier.accompagnement_profero)}</p></div>
      <div class="timeline">
        <div class="step"><b>1</b><span>Analyse du bien, du secteur et des hypothèses d’investissement.</span></div>
        <div class="step"><b>2</b><span>Structuration du projet : lots, travaux, stratégie locative et chiffrage.</span></div>
        <div class="step"><b>3</b><span>Aide à la décision : risques, offre, prochaines étapes et arbitrages.</span></div>
        <div class="step"><b>4</b><span>Coordination opérationnelle possible selon le projet et les intervenants retenus.</span></div>
      </div>
    </div>
  </section>` : ""}

  <section class="page break">
    <h2 class="section-title">Conclusion et prochaines étapes</h2>
    <div class="grid2">
      <div class="box darkbox"><h3>Conclusion Profero Invest</h3><p>${renderDossierHtmlParagraph(dossier.conclusion)}</p></div>
      <div class="box"><h3>Prochaine étape</h3><p>${renderDossierHtmlParagraph(dossier.prochaine_etape)}</p></div>
    </div>
  </section>

  <div class="footer">
    <strong>Profero Invest</strong><br>
    ${renderDossierHtmlParagraph(dossier.conditions)}
  </div>
</div>
</body>
</html>`);
  win.document.close();
}

function DossierField({ label, value, onChange, textarea=false, rows=3, placeholder="", T=THEMES_INV.dark }) {
  return (
    <div style={{marginBottom:10}}>
      <label className="inv-kpi-lbl">{label}</label>
      {textarea ? (
        <textarea className="inv-textarea" rows={rows} value={value || ""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
      ) : (
        <input className="inv-inp" value={value || ""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",textAlign:"left"}}/>
      )}
    </div>
  );
}

function DossierToggle({ label, checked, onChange, T=THEMES_INV.dark }) {
  return (
    <label style={{display:"flex",alignItems:"center",gap:8,padding:"8px 9px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:T.input,color:T.textSub,fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer"}}>
      <input type="checkbox" checked={checked !== false} onChange={e=>onChange(e.target.checked)}/>
      {label}
    </label>
  );
}

function DossierMediaEditor({ title, icon, items = [], onChange, T=THEMES_INV.dark, addLabel="Ajouter", mediaType="photo", onMessage }) {
  const list = Array.isArray(items) && items.length ? items : [emptyDossierMediaItem(mediaType)];
  const [uploading, setUploading] = useState(false);

  const update = (idx, patch) => {
    const next = list.map((item, i) => i === idx ? { ...item, ...patch } : item);
    onChange(next);
  };
  const add = () => onChange([...list, emptyDossierMediaItem(mediaType)]);
  const remove = (idx) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(next.length ? next : [emptyDossierMediaItem(mediaType)]);
  };
  const move = (idx, dir) => {
    const next = [...list];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const importFiles = async (files, targetIndex = null) => {
    const selected = Array.from(files || []).filter(Boolean);
    if (!selected.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of selected) {
        uploaded.push(await buildDossierMediaItemFromFile(file, mediaType));
      }
      if (targetIndex !== null && targetIndex !== undefined) {
        const first = uploaded[0];
        const rest = uploaded.slice(1);
        const next = list.map((item, i) => i === targetIndex ? { ...item, ...first } : item);
        onChange(rest.length ? [...next, ...rest] : next);
      } else {
        const existing = list.filter(item => item.url || item.titre || item.legende);
        onChange([...existing, ...uploaded]);
      }
      onMessage?.(`${uploaded.length} image${uploaded.length > 1 ? "s" : ""} ajoutée${uploaded.length > 1 ? "s" : ""}`);
    } catch (e) {
      const message = e?.message || "Import image impossible.";
      onMessage?.(`Erreur : ${message}`);
      alert(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="inv-card" style={{marginBottom:12}}>
      <div className="inv-card-hd mid" style={{justifyContent:"space-between"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={icon} size={13}/>{title}</span>
        <label className="inv-btn inv-btn-blue inv-btn-sm" style={{cursor:"pointer",textTransform:"none",letterSpacing:0}}>
          <Icon as={Upload} size={12}/>{uploading ? "Import…" : "Importer images"}
          <input type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>{importFiles(e.target.files); e.target.value="";}} disabled={uploading}/>
        </label>
      </div>
      <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.45,background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"8px 10px"}}>
          Vous pouvez importer directement des images depuis l’ordinateur. Elles sont optimisées automatiquement et sauvegardées dans le dossier investisseur. L’URL reste disponible si vous préférez utiliser un lien public.
        </div>
        {list.map((item, idx) => (
          <div key={item.id || idx} style={{display:"grid",gridTemplateColumns:"128px 1fr 72px",gap:10,alignItems:"start",padding:10,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,background:T.input}}>
            {item.url ? (
              <img src={item.url} alt="" style={{width:128,height:92,objectFit:"cover",borderRadius:RADIUS.md,border:`1px solid ${T.border}`}} onError={e=>{e.currentTarget.style.display="none";}}/>
            ) : (
              <label style={{width:128,height:92,borderRadius:RADIUS.md,border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontSize:FONT.xs.size,fontWeight:800,textAlign:"center",cursor:"pointer",background:T.card}}>
                <span><Icon as={Upload} size={15}/><br/>Ajouter<br/>une image</span>
                <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{importFiles(e.target.files, idx); e.target.value="";}} disabled={uploading}/>
              </label>
            )}
            <div>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                <label className="inv-btn inv-btn-out inv-btn-sm" style={{cursor:"pointer",textTransform:"none",letterSpacing:0}}>
                  <Icon as={Upload} size={11}/> Remplacer par fichier
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{importFiles(e.target.files, idx); e.target.value="";}} disabled={uploading}/>
                </label>
                {item.source === "upload" && (
                  <span style={{fontSize:FONT.xs.size,color:SU,fontWeight:800}}>Image importée {item.size_bytes ? `· ${dossierFormatFileSize(item.size_bytes)}` : ""}</span>
                )}
              </div>
              <input className="inv-inp" value={item.url || ""} onChange={e=>update(idx,{url:e.target.value,source:e.target.value?.startsWith("data:")?"upload":"url"})} placeholder="URL image / lien public ou image importée" style={{width:"100%",textAlign:"left",marginBottom:6}}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1.3fr",gap:6}}>
                <input className="inv-inp" value={item.titre || ""} onChange={e=>update(idx,{titre:e.target.value})} placeholder="Titre" style={{width:"100%",textAlign:"left"}}/>
                <input className="inv-inp" value={item.legende || ""} onChange={e=>update(idx,{legende:e.target.value})} placeholder="Légende courte" style={{width:"100%",textAlign:"left"}}/>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>move(idx,-1)} disabled={idx===0} title="Monter" style={{padding:"7px 8px",justifyContent:"center"}}><Icon as={ChevronUp} size={12}/></button>
              <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>move(idx,1)} disabled={idx===list.length-1} title="Descendre" style={{padding:"7px 8px",justifyContent:"center"}}><Icon as={ChevronDown} size={12}/></button>
              <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={()=>remove(idx)} title="Retirer" style={{padding:"7px 8px",justifyContent:"center"}}><Icon as={Trash2} size={12}/></button>
            </div>
          </div>
        ))}
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={add} style={{alignSelf:"flex-start"}}><Icon as={Plus} size={12}/>{addLabel}</button>
      </div>
    </div>
  );
}

function DossierPresentationInvestisseurCard({ bien, T = THEMES_INV.dark, onSaved, selectedSimulationId = "" }) {
  const [data, setData] = useState(() => mergeDossierPresentationData(bien, selectedSimulationId));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [section, setSection] = useState("identite");

  useEffect(() => {
    setData(mergeDossierPresentationData(bien, selectedSimulationId));
    setSection("identite");
  }, [bien?.id, selectedSimulationId]);

  const metrics = getSimulationMetricsFromBien(bien, selectedSimulationId);
  const lots = getDossierLotsFromBien(bien, selectedSimulationId);
  const update = (key, value) => setData(prev => ({ ...prev, [key]: value }));

  const importCoverPhoto = async (file) => {
    if (!file) return;
    setMsg("");
    try {
      const media = await buildDossierMediaItemFromFile(file, "cover");
      setData(prev => ({
        ...prev,
        photo_url: media.url,
        photo_filename: media.filename,
        photo_source: "upload",
        photo_uploaded_at: media.uploaded_at,
      }));
      setMsg("Photo principale ajoutée");
      setTimeout(()=>setMsg(""), 2200);
    } catch (e) {
      const message = e?.message || "Import de la photo impossible.";
      setMsg(`Erreur : ${message}`);
      alert(message);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const dossier_presentation = {
      ...data,
      photos: cleanDossierMediaList(data.photos),
      plans: cleanDossierMediaList(data.plans),
      updated_at: new Date().toISOString(),
    };
    const visite_data = { ...(bien.visite_data || {}), dossier_presentation };
    const { error } = await supabase.from("invest_biens").update({ visite_data }).eq("id", bien.id);
    setSaving(false);
    if (error) {
      setMsg(`Erreur : ${error.message}`);
      return;
    }
    setData(dossier_presentation);
    setMsg("Dossier investisseur sauvegardé");
    onSaved?.();
    setTimeout(()=>setMsg(""),2500);
  };

  const resetDefaults = () => {
    if (!window.confirm("Reprendre les textes automatiques depuis la fiche bien ? Les textes personnalisés du dossier seront remplacés.")) return;
    setData(buildDossierPresentationDefaults(bien, selectedSimulationId));
  };

  const generate = () => openDossierPresentationInvestisseurPDF({ bien, dossier:data, selectedSimulationId });

  const sections = [
    ["identite", "Identité", Briefcase],
    ["visuels", "Photos & plans", ImageIcon],
    ["ville", "Ville & secteur", MapPin],
    ["projet", "Projet", Home],
    ["finance", "Financier", Wallet],
    ["vente", "Argumentaire", TrendingUp],
    ["risques", "Risques", AlertTriangle],
    ["final", "Finalisation", Check],
  ];

  const mediaCount = cleanDossierMediaList(data.photos).filter(x=>x.url).length;
  const planCount = cleanDossierMediaList(data.plans).filter(x=>x.url).length;
  const requiredScoreItems = [data.titre, data.photo_url, data.accroche, data.analyse_ville, data.analyse_quartier, data.projet_global, data.programme_travaux, data.arguments_investisseurs, data.conclusion];
  const completion = Math.round((requiredScoreItems.filter(x=>String(x||"").trim()).length / requiredScoreItems.length) * 100);

  const renderForm = () => {
    if (section === "visuels") return (
      <>
        <div className="inv-card" style={{marginBottom:12}}>
          <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={ImageIcon} size={13}/>Photo principale de couverture</span>
            <label className="inv-btn inv-btn-blue inv-btn-sm" style={{cursor:"pointer",textTransform:"none",letterSpacing:0}}>
              <Icon as={Upload} size={12}/> Importer une photo
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{importCoverPhoto(e.target.files?.[0]); e.target.value="";}} />
            </label>
          </div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:12,alignItems:"start"}}>
              {data.photo_url ? (
                <img src={data.photo_url} alt="Photo principale" style={{width:190,height:122,objectFit:"cover",borderRadius:RADIUS.lg,border:`1px solid ${T.border}`}} onError={e=>{e.currentTarget.style.display="none";}}/>
              ) : (
                <label style={{width:190,height:122,borderRadius:RADIUS.lg,border:`1px dashed ${T.border}`,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontWeight:800,textAlign:"center",cursor:"pointer"}}>
                  <span><Icon as={Upload} size={18}/><br/>Ajouter la photo<br/>de couverture</span>
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{importCoverPhoto(e.target.files?.[0]); e.target.value="";}} />
                </label>
              )}
              <div>
                <DossierField label="URL photo principale ou image importée" value={data.photo_url} onChange={v=>update("photo_url",v)} placeholder="Collez une URL ou importez directement une image depuis l’ordinateur" T={T}/>
                {data.photo_source === "upload" && data.photo_filename && (
                  <div style={{fontSize:FONT.xs.size+1,color:SU,fontWeight:800,marginTop:-4,marginBottom:8}}>Image importée : {data.photo_filename}</div>
                )}
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.45}}>Utiliser de préférence une image horizontale de bonne qualité. L’image importée est compressée automatiquement pour rester exploitable dans le dossier.</div>
              </div>
            </div>
          </div>
        </div>
        <DossierMediaEditor title="Galerie photos du bien" icon={ImageIcon} items={data.photos} onChange={v=>update("photos",v)} T={T} addLabel="Ajouter une photo" mediaType="photo" onMessage={(m)=>{setMsg(m); setTimeout(()=>setMsg(""), 2200);}}/>
        <DossierMediaEditor title="Plans du projet" icon={FileText} items={data.plans} onChange={v=>update("plans",v)} T={T} addLabel="Ajouter un plan" mediaType="plan" onMessage={(m)=>{setMsg(m); setTimeout(()=>setMsg(""), 2200);}}/>
      </>
    );

    if (section === "ville") return (
      <div className="inv-card">
        <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MapPin} size={13}/>Analyse ville, quartier et demande locative</span></div>
        <div className="inv-card-bd">
          <DossierField label="Titre analyse ville" value={data.analyse_ville_titre} onChange={v=>update("analyse_ville_titre",v)} T={T}/>
          <DossierField label="Analyse de la ville" textarea rows={5} value={data.analyse_ville} onChange={v=>update("analyse_ville",v)} placeholder="Attractivité, population, économie, accessibilité, patrimoine, perspectives…" T={T}/>
          <DossierField label="Dynamique économique" textarea rows={4} value={data.dynamique_economique} onChange={v=>update("dynamique_economique",v)} placeholder="Bassins d’emploi, zones d’activités, écoles, santé, universités…" T={T}/>
          <DossierField label="Analyse du quartier / micro-localisation" textarea rows={4} value={data.analyse_quartier} onChange={v=>update("analyse_quartier",v)} placeholder="Transports, commerces, stationnement, ambiance, sécurité, services…" T={T}/>
          <DossierField label="Demande locative" textarea rows={4} value={data.demande_locative} onChange={v=>update("demande_locative",v)} placeholder="Tension locative, loyers observés, concurrence, vacance…" T={T}/>
          <DossierField label="Population cible" textarea rows={3} value={data.population_cible} onChange={v=>update("population_cible",v)} placeholder="Étudiants, jeunes actifs, familles, mobilité professionnelle…" T={T}/>
        </div>
      </div>
    );

    if (section === "projet") return (
      <div className="inv-card">
        <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13}/>Projet global et transformation</span></div>
        <div className="inv-card-bd">
          <DossierField label="Présentation du projet global" textarea rows={5} value={data.projet_global} onChange={v=>update("projet_global",v)} T={T}/>
          <DossierField label="Vision avant / après" textarea rows={4} value={data.vision_avant_apres} onChange={v=>update("vision_avant_apres",v)} T={T}/>
          <DossierField label="Programme travaux" textarea rows={5} value={data.programme_travaux} onChange={v=>update("programme_travaux",v)} T={T}/>
          <DossierField label="Stratégie locative" textarea rows={4} value={data.strategie_locative} onChange={v=>update("strategie_locative",v)} T={T}/>
        </div>
      </div>
    );

    if (section === "finance") return (
      <div className="inv-card">
        <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Wallet} size={13}/>Analyse financière</span></div>
        <div className="inv-card-bd">
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8,marginBottom:12}}>
            {[
              ["Prix cible", dossierFmtEur(metricValue(metrics.prix, bien.montant_offre, bien.prix_vente))],
              ["Travaux", dossierFmtEur(metricValue(metrics.travaux, bien.prix_travaux))],
              ["Coût global", dossierFmtEur(metricValue(metrics.coutTotal, bien.cout_total))],
              ["Loyers", `${dossierFmtEur(metrics.loyerMensuel)}/mois`],
              ["Rendement", dossierFmtPct(metricValue(metrics.rendement, bien.rendement_brut))],
              ["Cash-flow", `${dossierFmtEur(metricValue(metrics.cashflow, bien.cashflow_estime))}/mois`],
            ].map(([label,value]) => (
              <div key={label} style={{padding:"9px 10px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,textTransform:"uppercase",fontWeight:900,letterSpacing:.7}}>{label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,fontWeight:900,color:T.text,marginTop:3}}>{value}</div>
              </div>
            ))}
          </div>
          <DossierField label="Commentaire d’analyse financière" textarea rows={5} value={data.analyse_financiere_commentaire} onChange={v=>update("analyse_financiere_commentaire",v)} T={T}/>
        </div>
      </div>
    );

    if (section === "vente") return (
      <div className="inv-card">
        <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={TrendingUp} size={13}/>Argumentaire investisseur</span></div>
        <div className="inv-card-bd">
          <DossierField label="Arguments investisseurs" textarea rows={6} value={data.arguments_investisseurs} onChange={v=>update("arguments_investisseurs",v)} T={T}/>
          <DossierField label="Points forts identifiés" textarea rows={5} value={data.points_forts} onChange={v=>update("points_forts",v)} T={T}/>
          <DossierField label="Profil d’investisseur cible" textarea rows={3} value={data.profil_investisseur} onChange={v=>update("profil_investisseur",v)} T={T}/>
        </div>
      </div>
    );

    if (section === "risques") return (
      <div className="inv-card">
        <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13}/>Crédibilité, risques et réponses</span></div>
        <div className="inv-card-bd">
          <DossierField label="Points de vigilance" textarea rows={5} value={data.points_vigilance} onChange={v=>update("points_vigilance",v)} T={T}/>
          <DossierField label="Réponse / méthode Profero" textarea rows={5} value={data.reponse_aux_risques} onChange={v=>update("reponse_aux_risques",v)} T={T}/>
        </div>
      </div>
    );

    if (section === "final") return (
      <div className="inv-card">
        <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Check} size={13}/>Conclusion et génération</span></div>
        <div className="inv-card-bd">
          <DossierField label="Conclusion Profero Invest" textarea rows={5} value={data.conclusion} onChange={v=>update("conclusion",v)} T={T}/>
          <DossierField label="Prochaine étape" textarea rows={3} value={data.prochaine_etape} onChange={v=>update("prochaine_etape",v)} T={T}/>
          <DossierField label="Accompagnement Profero" textarea rows={5} value={data.accompagnement_profero} onChange={v=>update("accompagnement_profero",v)} T={T}/>
          <DossierField label="Mentions / conditions" textarea rows={3} value={data.conditions} onChange={v=>update("conditions",v)} T={T}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,marginTop:8}}>
            <DossierToggle label="Page ville" checked={data.afficher_page_ville} onChange={v=>update("afficher_page_ville",v)} T={T}/>
            <DossierToggle label="Page photos" checked={data.afficher_page_photos} onChange={v=>update("afficher_page_photos",v)} T={T}/>
            <DossierToggle label="Page plans" checked={data.afficher_page_plans} onChange={v=>update("afficher_page_plans",v)} T={T}/>
            <DossierToggle label="Page risques" checked={data.afficher_page_risques} onChange={v=>update("afficher_page_risques",v)} T={T}/>
            <DossierToggle label="Page accompagnement" checked={data.afficher_page_accompagnement} onChange={v=>update("afficher_page_accompagnement",v)} T={T}/>
          </div>
        </div>
      </div>
    );

    return (
      <div className="inv-card">
        <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13}/>Identité du dossier</span></div>
        <div className="inv-card-bd">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <DossierField label="Titre du dossier" value={data.titre} onChange={v=>update("titre",v)} T={T}/>
            <DossierField label="Sous-titre / adresse" value={data.sous_titre} onChange={v=>update("sous_titre",v)} T={T}/>
            <DossierField label="Responsable" value={data.responsable} onChange={v=>update("responsable",v)} T={T}/>
            <DossierField label="Date d’édition" value={data.date_edition} onChange={v=>update("date_edition",v)} T={T}/>
          </div>
          <DossierField label="Phrase de couverture" textarea rows={3} value={data.phrase_couverture} onChange={v=>update("phrase_couverture",v)} T={T}/>
          <DossierField label="Accroche investisseur" textarea rows={4} value={data.accroche} onChange={v=>update("accroche",v)} T={T}/>
          <DossierField label="Résumé exécutif" textarea rows={5} value={data.synthese_executive} onChange={v=>update("synthese_executive",v)} T={T}/>
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"260px 1fr 320px",gap:16,alignItems:"start"}}>
      <div style={{position:"sticky",top:14,display:"flex",flexDirection:"column",gap:10}}>
        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13}/>Dossier premium</span></div>
          <div className="inv-card-bd">
            {msg && <div style={{fontSize:FONT.xs.size+1,color:msg.startsWith("Erreur")?DA:SU,fontWeight:800,marginBottom:8}}>{msg}</div>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
              <div>
                <div className="inv-kpi-lbl">Complétion dossier</div>
                <div style={{fontSize:FONT.h2.size,fontWeight:900,color:T.text,lineHeight:1}}>{completion}%</div>
              </div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted,textAlign:"right"}}>{mediaCount} photo{mediaCount>1?"s":""}<br/>{planCount} plan{planCount>1?"s":""}</div>
            </div>
            <div style={{height:8,borderRadius:RADIUS.pill,background:T.input,overflow:"hidden",border:`1px solid ${T.border}`,marginBottom:12}}>
              <div style={{height:"100%",width:`${completion}%`,background:completion>=80?SU:completion>=45?WA:DA,transition:"width .2s"}}/>
            </div>
            <button className="inv-btn inv-btn-gold" onClick={generate} style={{width:"100%",justifyContent:"center",marginBottom:8}}><Icon as={Download} size={13}/> Générer le dossier</button>
            <button className="inv-btn inv-btn-blue" onClick={save} disabled={saving} style={{width:"100%",justifyContent:"center",marginBottom:8}}><Icon as={saving ? RefreshCw : Save} size={13} style={saving ? {animation:"spin 1s linear infinite"} : undefined}/> {saving?"Sauvegarde…":"Sauvegarder"}</button>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={resetDefaults} style={{width:"100%",justifyContent:"center"}}>Reprendre textes auto</button>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {sections.map(([key,label,IconComp]) => {
            const active = section === key;
            return (
              <button key={key} onClick={()=>setSection(key)} style={{display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",border:`1px solid ${active?T.accentBorder:T.border}`,background:active?T.accentBg:T.card,color:active?T.accent:T.textSub,borderRadius:RADIUS.lg,padding:"9px 10px",cursor:"pointer",fontFamily:"inherit",fontWeight:900,fontSize:FONT.sm.size}}>
                <Icon as={IconComp} size={14}/>{label}
              </button>
            );
          })}
        </div>
      </div>

      <div>{renderForm()}</div>

      <div style={{position:"sticky",top:14,display:"flex",flexDirection:"column",gap:12}}>
        <div className="inv-card">
          <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Eye} size={13}/>Aperçu investisseur</span></div>
          <div className="inv-card-bd">
            {data.photo_url ? (
              <img src={data.photo_url} alt="Photo du bien" style={{width:"100%",height:170,objectFit:"cover",borderRadius:RADIUS.lg,border:`1px solid ${T.border}`,marginBottom:12}} onError={e=>{e.currentTarget.style.display="none";}}/>
            ) : (
              <div style={{height:145,borderRadius:RADIUS.lg,border:`1px dashed ${T.border}`,background:T.input,display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontWeight:800,marginBottom:12}}>Photo de couverture à ajouter</div>
            )}
            <div style={{fontSize:FONT.md.size,fontWeight:900,color:T.text,lineHeight:1.2}}>{data.titre}</div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,marginTop:5,lineHeight:1.45}}>{data.sous_titre}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
              {[
                ["Prix cible", dossierFmtEur(metricValue(metrics.prix, bien.montant_offre, bien.prix_vente))],
                ["Travaux", dossierFmtEur(metricValue(metrics.travaux, bien.prix_travaux))],
                ["Rendement", dossierFmtPct(metricValue(metrics.rendement, bien.rendement_brut))],
                ["Cash-flow", `${dossierFmtEur(metricValue(metrics.cashflow, bien.cashflow_estime))}/mois`],
                ["Lots", lots.length || "—"],
                ["Surface", metricValue(metrics.surface) ? `${metricValue(metrics.surface)} m²` : "—"],
              ].map(([label,value])=>(
                <div key={label} style={{padding:"8px 9px",borderRadius:RADIUS.md,background:T.input,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,textTransform:"uppercase",fontWeight:900,letterSpacing:.7}}>{label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:FONT.sm.size,fontWeight:900,color:T.text,marginTop:3}}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13}/>Configuration cible</span></div>
          <div className="inv-card-bd">
            {lots.length === 0 ? (
              <div style={{fontSize:FONT.sm.size,color:T.textMuted,fontStyle:"italic"}}>Aucun lot renseigné dans la simulation ou la visite terrain.</div>
            ) : lots.slice(0,6).map((lot,idx)=>(
              <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
                <div>
                  <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text}}>Lot {lot.numero} · {lot.type}</div>
                  <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2}}>{lot.surface ? `${lot.surface} m²` : "Surface à compléter"}</div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontWeight:900,color:SU,fontSize:FONT.sm.size}}>{dossierFmtEur(lot.loyer)}</div>
              </div>
            ))}
            {lots.length > 6 && <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:8}}>+ {lots.length - 6} autre(s) lot(s)</div>}
          </div>
        </div>
      </div>
    </div>
  );
}


function FicheBien({ id, profil, onRetour, T=THEMES_INV.dark }) {
  const [bien, setBien]       = useState(null);
  const [props, setProps]     = useState([]);
  const [clients, setClients] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showProp, setShowProp] = useState(false);
  const [newProp, setNewProp] = useState({ client_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
  const [savingProp, setSavingProp] = useState(false);
  const [geolocatingBien, setGeolocatingBien] = useState(false);
  const [geoMessageBien, setGeoMessageBien] = useState("");
  const [ficheTab, setFicheTab] = useState("fiche");
  const ficheVisiteRef = useRef(null);
  const [visiteSaveState, setVisiteSaveState] = useState({ saving:false, saved:false });
  const [selectedSimulationId, setSelectedSimulationId] = useState("");

  const charger = async () => {
    const [{ data: b }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("invest_biens").select("*").eq("id", id).single(),
      supabase.from("invest_propositions").select("*, client:invest_clients(nom,prenom)").eq("bien_id", id).order("created_at",{ascending:false}),
      supabase.from("invest_clients").select("id,nom,prenom,budget,statut,etape,strategie_data").order("nom"),
    ]);
    setBien(b); setProps(p||[]); setClients(c||[]);
  };
  useEffect(() => { charger(); }, [id]);

  useEffect(() => {
    if (!bien) return;
    const sims = getBienSimulations(bien);
    const activeId = bien.visite_data?.simulateur_active_id || sims[0]?.id || "";
    if (!selectedSimulationId || !sims.some(s => s.id === selectedSimulationId)) {
      setSelectedSimulationId(activeId);
    }
  }, [bien?.id, bien?.visite_data?.simulateur_active_id, bien?.visite_data?.simulateur_updated_at, selectedSimulationId]);

  const ajouterProp = async () => {
    if (!newProp.client_id) return;
    setSavingProp(true);
    await supabase.from("invest_propositions").insert({ bien_id: id, ...newProp, date_proposition: new Date().toISOString().slice(0,10) });
    setNewProp({ client_id:"", statut:"proposé", commentaire:"", lien_dossier:"" });
    setSavingProp(false);
    setShowProp(false);
    charger();
  };

  const associerClientMatching = async (clientId) => {
    if (!clientId) return;
    const { error } = await supabase.from("invest_propositions").insert({
      bien_id: id,
      client_id: clientId,
      statut: "proposé",
      commentaire: "Proposé depuis le matching automatique",
      lien_dossier: "",
      date_proposition: new Date().toISOString().slice(0,10),
    });
    if (error) alert("Impossible d'associer ce client : " + error.message);
    else charger();
  };

  const validerGeolocalisationBien = async () => {
    const adresseComplete = getBienGoogleAddress(bien || {});
    if (!adresseComplete) {
      setGeoMessageBien("Adresse manquante : renseignez au minimum l'adresse, le code postal ou la ville.");
      return;
    }

    setGeolocatingBien(true);
    setGeoMessageBien("");

    try {
      const geo = await getCoordinatesFromAddress(adresseComplete);
      if (!geo || !isValidLatLng(parseFloat(geo.lat), parseFloat(geo.lng))) {
        setGeoMessageBien(`Adresse introuvable par Google Maps : ${geo?.error || "vérifiez l'adresse"}`);
        setGeolocatingBien(false);
        return;
      }

      const lat = parseFloat(geo.lat);
      const lng = parseFloat(geo.lng);
      const updatedVisiteData = {
        ...(bien.visite_data || {}),
        identification: {
          ...(bien.visite_data?.identification || {}),
          latitude: lat,
          longitude: lng,
          geocoding_status: `Géolocalisation validée le ${new Date().toLocaleDateString("fr-FR")}`,
          adresse_google: geo.formatted_address || adresseComplete,
        },
      };

      const { error } = await supabase
        .from("invest_biens")
        .update({
          latitude: lat,
          longitude: lng,
          visite_data: updatedVisiteData,
        })
        .eq("id", id);

      if (error) {
        console.error("Erreur géolocalisation bien:", error);
        setGeoMessageBien(`Erreur Supabase : ${error.message}`);
      } else {
        setBien(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          visite_data: updatedVisiteData,
        }));
        setGeoMessageBien(`Géolocalisation validée : ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        charger();
      }
    } catch (e) {
      console.error("Erreur géolocalisation:", e);
      setGeoMessageBien(e?.message || "Géolocalisation impossible.");
    } finally {
      setGeolocatingBien(false);
    }
  };

  const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}) : "—";
  const fmtEur  = v => v > 0 ? new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v)+" €" : "—";

  const persistSimulationsBien = async (nextSimulations, activeId, legacySimulation = null) => {
    if (!bien) return;

    const cleanSimulations = (Array.isArray(nextSimulations) ? nextSimulations : [])
      .filter(Boolean)
      .map((s, index) => {
        const simId = s.id || s.donnees?.simulation_id || makeSimulationId();
        const simName = s.nom || s.donnees?.projectName || `Simulation ${index + 1}`;

        return makeSimulationEntry({
          id: simId,
          nom: simName,
          donnees: {
            ...deepCloneSimulationData(s.donnees || {}),
            projectName: simName,
            bien_id: bien.id || id,
            simulation_id: simId,
          },
          createdAt: s.created_at,
        });
      });

    const active = cleanSimulations.find(s => s.id === activeId) || cleanSimulations[0] || null;

    const activeLegacySimulation = legacySimulation
      ? deepCloneSimulationData(legacySimulation)
      : deepCloneSimulationData(active?.donnees || bien.visite_data?.simulateur || null);

    const updatedVisiteData = {
      ...(bien.visite_data || {}),
      simulateurs: cleanSimulations,
      simulateur_active_id: active?.id || "",
      simulateur: activeLegacySimulation,
      simulateur_updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("invest_biens")
      .update({ visite_data: updatedVisiteData })
      .eq("id", id);

    if (error) {
      alert("Erreur simulation : " + error.message);
      return;
    }

    setBien(prev => ({
      ...prev,
      visite_data: deepCloneSimulationData(updatedVisiteData),
    }));

    setSelectedSimulationId(active?.id || "");
    charger();
  };

  const creerSimulationBien = async () => {
    if (!bien) return;

    const name = window.prompt(
      "Nom de la nouvelle simulation",
      `Simulation ${getBienSimulations(bien).length + 1}`
    );

    if (!name) return;

    const newId = makeSimulationId();

    const baseState = syncSimulateurFromVisiteData(
      { ...(bien.visite_data || {}), simulateur: buildDefaultSimulateurStateFromBien(bien) },
      bien
    );

    const entry = makeSimulationEntry({
      id: newId,
      nom: name.trim(),
      donnees: {
        ...deepCloneSimulationData(baseState),
        projectName: name.trim(),
        bien_id: bien.id || id,
        simulation_id: newId,
        savedAt: new Date().toISOString(),
      },
    });

    await persistSimulationsBien([...getBienSimulations(bien), entry], entry.id, entry.donnees);
  };

  const dupliquerSimulationBien = async () => {
    if (!bien) return;

    const sims = getBienSimulations(bien);
    const active = getActiveSimulationEntry(bien, selectedSimulationId);

    if (!active) return;

    const name = window.prompt(
      "Nom de la simulation dupliquée",
      `${active.nom || "Simulation"} — copie`
    );

    if (!name) return;

    const newId = makeSimulationId();

    const clonedData = duplicateSimulationDonnees(active.donnees || {}, {
      newSimulationId: newId,
      name: name.trim(),
      bienId: bien.id || id,
    });

    const entry = makeSimulationEntry({
      id: newId,
      nom: name.trim(),
      donnees: clonedData,
    });

    await persistSimulationsBien([...sims, entry], entry.id, entry.donnees);
  };

  const renommerSimulationBien = async () => {
    if (!bien) return;

    const sims = getBienSimulations(bien);
    const active = getActiveSimulationEntry(bien, selectedSimulationId);

    if (!active) return;

    const name = window.prompt("Nouveau nom de la simulation", active.nom || "Simulation");

    if (!name) return;

    const next = sims.map(s => {
      if (s.id !== active.id) return s;

      return makeSimulationEntry({
        id: s.id,
        nom: name.trim(),
        donnees: {
          ...deepCloneSimulationData(s.donnees || {}),
          projectName: name.trim(),
          bien_id: bien.id || id,
          simulation_id: s.id,
          savedAt: new Date().toISOString(),
        },
        createdAt: s.created_at,
      });
    });

    await persistSimulationsBien(
      next,
      active.id,
      next.find(s => s.id === active.id)?.donnees || null
    );
  };

  const supprimerSimulationBien = async () => {
    if (!bien) return;

    const sims = getBienSimulations(bien);
    const active = getActiveSimulationEntry(bien, selectedSimulationId);

    if (!active) return;

    if (sims.length <= 1) {
      alert("Il faut conserver au moins une simulation pour le bien.");
      return;
    }

    if (!window.confirm(`Supprimer la simulation « ${active.nom} » ?`)) return;

    const next = sims.filter(s => s.id !== active.id);
    await persistSimulationsBien(next, next[0]?.id || "", next[0]?.donnees || null);
  };

  if (!bien) return <div style={{ textAlign:"center", padding:"60px", color:T.textMuted }}>Chargement…</div>;

  const couleur = STATUT_BIEN_COLORS[bien.statut] || "#9aa0b0";
  const currentTheme = T?.bg === THEMES_INV.light.bg ? "light" : "dark";
  const visiteDataBien = bien.visite_data || {};
  const simulationsBien = getBienSimulations(bien);
  const activeSimulation = getActiveSimulationEntry(bien, selectedSimulationId);
  const activeSimulationId = activeSimulation?.id || simulationsBien[0]?.id || "";
  const simulateurProjetBien = buildSimulateurProjectFromBien(bien, activeSimulationId);
  const conclusionBien = visiteDataBien.conclusion || {};
  const generalBien = visiteDataBien.general || {};
  const financeBien = visiteDataBien.finance || {};
  const genererFicheBienPDF = () => {
    const v = bien.visite_data || {}; const idf = v.identification || {}; const gen = v.general || {}; const fin = v.finance || {}; const concl = v.conclusion || {}; const lots = v.configuration?.lots || [];
    const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const win = window.open("", "_blank", "width=900,height=720"); if(!win){ alert("Autorisez les pop-ups."); return; }
    const lotRows = lots.filter(l=>l && (l.type||l.surface||l.loyer)).map(l=>`<tr><td>${esc(l.numero)}</td><td>${esc(l.type)}</td><td>${esc(l.surface)} m²</td><td>${esc(l.loyer)} €/mois</td><td>${esc(l.meuble)}</td></tr>`).join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fiche bien ${esc(bien.reference_interne||bien.adresse)}</title><style>body{font-family:Arial,sans-serif;margin:0;background:#f5f7fb;color:#1a1f2e}.wrap{max-width:900px;margin:0 auto;background:white;min-height:100vh}.hd{background:#1a2d4a;color:white;padding:28px 34px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 34px}.kpi{border-left:4px solid #4070e8;background:#f8f9fb;padding:12px;border-radius:8px}.k{font-size:20px;font-weight:800}.l{font-size:10px;text-transform:uppercase;color:#7b8496}.sec{padding:16px 34px;border-top:1px solid #eef0f5}.title{font-size:12px;font-weight:800;text-transform:uppercase;color:#4070e8;letter-spacing:1.6px;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eef0f5;padding:6px 0;font-size:13px}.row b{color:#1a2d4a}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1a2d4a;color:white;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #eef0f5}.no-print{position:fixed;right:18px;top:18px}.btn{background:#4070e8;color:white;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}@media print{.no-print{display:none}.wrap{max-width:none}}</style></head><body><div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div><div class="wrap"><div class="hd"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.7">Profero Invest</div><h1>${esc(bien.reference_interne||"Fiche bien")}</h1><div>${esc([bien.adresse,bien.code_postal,bien.ville].filter(Boolean).join(" "))}</div></div><div class="kpis"><div class="kpi"><div class="k">${esc(concl.note_globale||"—")}/10</div><div class="l">Note</div></div><div class="kpi"><div class="k">${esc(concl.recommandation||"—")}</div><div class="l">Recommandation</div></div><div class="kpi"><div class="k">${esc(fmtEur(bien.montant_offre||concl.prix_offre_recommande))}</div><div class="l">Offre</div></div><div class="kpi"><div class="k">${bien.rendement_brut?Number(bien.rendement_brut).toFixed(1)+" %":"—"}</div><div class="l">Rendement</div></div></div><div class="sec"><div class="title">Informations essentielles</div><div class="grid"><div class="row"><span>Type</span><b>${esc(gen.type_bien||"—")}</b></div><div class="row"><span>Surface</span><b>${esc(gen.surface_totale||"—")} m²</b></div><div class="row"><span>Prix affiché</span><b>${esc(fmtEur(bien.prix_vente))}</b></div><div class="row"><span>Travaux</span><b>${esc(fmtEur(bien.prix_travaux))}</b></div><div class="row"><span>Coût total</span><b>${esc(fmtEur(bien.cout_total))}</b></div><div class="row"><span>Cash-flow</span><b>${esc(fmtEur(bien.cashflow_estime))}/mois</b></div></div></div><div class="sec"><div class="title">Configuration cible</div><table><thead><tr><th>Lot</th><th>Type</th><th>Surface</th><th>Loyer</th><th>Location</th></tr></thead><tbody>${lotRows||"<tr><td colspan='5'>Aucun lot renseigné</td></tr>"}</tbody></table></div><div class="sec"><div class="title">Conclusion Profero</div><p><b>Stratégie locative :</b> ${esc(concl.strategie_locative||"—")}</p><p><b>Fiscalité recommandée :</b> ${esc(concl.fiscalite_recommandee||"—")}</p><p><b>Prochaine étape :</b> ${esc(concl.prochaine_etape||"—")}</p><p>${esc(concl.commentaire_conseiller||"")}</p></div></div></body></html>`); win.document.close();
  };


  const genererPresentationClientPDF = () => {
    const v = bien.visite_data || {};
    const sim = v.simulateur || {};
    const inputs = sim.inputs || {};
    const selects = sim.selects || {};
    const simLots = Array.isArray(sim.lots) ? sim.lots : [];
    const cfgLots = Array.isArray(v.configuration?.lots) ? v.configuration.lots : [];
    const sourceLots = (simLots.length ? simLots : cfgLots).filter(l => (l?.type || "") !== "Sélectionner");
    const lotsPDF = sourceLots.map(l => ({
      type: l.type || l.typologie || l.type_lot || "Lot",
      niveau: l.niveau || "—",
      m2: l.m2 ?? l.surface ?? 0,
      loyer: l.loyer ?? l.loyer_cible ?? 0,
      gestion: l.gestion ?? (l.type && GESTION_PRICES[l.type] ? GESTION_PRICES[l.type] : 0),
      comment: l.comment || l.commentaire || "",
    }));
    const surfacePdf = Number(inputs.surface || v.general?.surface_totale || bien.surface || lotsPDF.reduce((s,l)=>s+(Number(l.m2)||0),0) || 0);
    const prixPdf = Number(inputs.prixNegocie || bien.montant_offre || bien.prix_vente || v.finance?.prix_acquisition_negocie || 0);
    const budgetTravauxPdf = Number(inputs.budgetTravaux || bien.prix_travaux || v.finance?.budget_travaux_ttc || 0);
    const tauxNotairePdf = Number(inputs.tauxNotaire || 0.08);
    const coutTotalPdf = Number(bien.cout_total || v.finance?.cout_total_operation || (prixPdf + prixPdf * tauxNotairePdf + budgetTravauxPdf + Number(inputs.honoraires||0) + Number(inputs.enedis||0)) || 0);
    const totLoyerPdf = lotsPDF.reduce((s,l)=>s+(Number(l.loyer)||0),0) || Number(v.finance?.loyers_bruts_mensuels || 0);
    const totLoyerAnPdf = totLoyerPdf * 12;
    const chargesPdf = Number(inputs.taxeFonciere||0) + Number(inputs.assurance||0) + Number(inputs.compta||0) + Number(inputs.provisions||0);
    const apportPdf = Number(inputs.apport1 || 0);
    const tauxPdf = Number(inputs.taux1 || 0);
    const dureePdf = Number(inputs.duree1 || 20);
    const mensualitePdf = pmt(Math.max(coutTotalPdf - apportPdf, 0), tauxPdf, dureePdf);
    const annuitePdf = mensualitePdf * 12;
    const rbPdf = coutTotalPdf > 0 ? (totLoyerAnPdf / coutTotalPdf) * 100 : Number(bien.rendement_brut || 0);
    const rnPdf = coutTotalPdf > 0 ? ((totLoyerAnPdf - chargesPdf) / coutTotalPdf) * 100 : 0;
    const cfPdf = (totLoyerAnPdf - chargesPdf) / 12 - mensualitePdf;
    const pePdf = totLoyerAnPdf > 0 ? ((chargesPdf + annuitePdf) / totLoyerAnPdf) * 12 : 0;
    const margePdf = totLoyerAnPdf > 0 ? (1 - ((chargesPdf + annuitePdf) / totLoyerAnPdf)) * 100 : 0;
    const desc = sim.descriptions?.description || v.presentation || v.general?.commentaire || "Projet d’investissement immobilier analysé par Profero Invest.";
    const travaux = sim.descriptions?.travaux || v.technique?.travaux_envisages || (budgetTravauxPdf > 0 ? `Budget travaux estimé : ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(budgetTravauxPdf)} €.` : "Travaux à préciser après validation technique et devis.");
    const atouts = sim.descriptions?.atouts || v.marche?.points_forts || v.conclusion?.commentaire || `Rentabilité brute estimée à ${rbPdf.toFixed(2).replace(".", ",")} %. Stratégie à confirmer selon financement et objectifs client.`;

    openFicheClientInvestisseurPDFAvecMap({
      title: [bien.adresse, bien.ville].filter(Boolean).join(" - ") || bien.reference_interne || "Fiche investisseur",
      subtitle: "Analyse de Rentabilité",
      address: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
      mapAddress: getBienFullAddress(bien),
      mapEmbedUrl: googleMapsEmbedUrlForBien(bien),
      mapSearchUrl: googleMapsSearchUrl(getBienMapQuery(bien) || getBienFullAddress(bien)),
      dateEdition: new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" }),
      lots: lotsPDF,
      surface: surfacePdf,
      logements: lotsPDF.length || v.general?.nombre_lots_cibles || "—",
      prixAchat: prixPdf,
      budgetTravaux: budgetTravauxPdf,
      coutTotal: coutTotalPdf,
      totLoyer: totLoyerPdf,
      totLoyerAn: totLoyerAnPdf,
      chargesAnnuelles: chargesPdf,
      annuiteS1: annuitePdf,
      mensualiteS1: mensualitePdf,
      cashflowS1: cfPdf,
      rendementBrutPct: rbPdf,
      rendementNetPct: rnPdf,
      pointEquilibreMois: pePdf,
      margeSecuritePct: margePdf,
      totalGestionMois: lotsPDF.reduce((s,l)=>s+(Number(l.gestion)||0),0),
      apportS1: apportPdf,
      tauxS1: tauxPdf,
      dureeS1: dureePdf,
      description: desc,
      travaux,
      atouts,
      recommandation: v.conclusion?.recommandation || (cfPdf >= 0 && rbPdf >= 8 ? "Opportunité à approfondir" : "Analyse à confirmer"),
    });
  };

  const quitterFicheBien = async () => {
    onRetour();
  };

  const changerOngletFiche = async (key) => {
    setFicheTab(key);
  };

  const ClientsAssociesCard = () => (
    <div className="inv-card">
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>Clients associés ({props.length})</span>
        <button className="inv-btn inv-btn-sm" style={{ background:T.accentBg, color:"black", border:`1px solid ${T.accentBorder}` }} onClick={() => setShowProp(true)}>＋ Proposer</button>
      </div>
      <div className="inv-card-bd">
        {props.length === 0 ? (
          <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic", textAlign:"center", padding:"16px 0" }}>Aucun client associé</div>
        ) : props.map(p => (
          <div key={p.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontWeight:700, fontSize:13, color:T.text }}>{p.client?.prenom} {p.client?.nom}</div>
            <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
              {new Date(p.date_proposition).toLocaleDateString("fr-FR")} · <span style={{ fontWeight:600, color:T.accent }}>{p.statut}</span>
              {p.commentaire && ` · ${p.commentaire}`}
            </div>
            {p.lien_dossier && <a href={p.lien_dossier} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent }}>📄 Dossier présenté ↗</a>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:1420, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={quitterFicheBien}>← Stock de biens</button>
        <div style={{ flex:"1 1 260px", minWidth:0 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text }}>{bien.adresse||"Bien sans adresse"}</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>
            {bien.reference_interne ? <span style={{color:T.accent,fontWeight:800,marginRight:8}}>{bien.reference_interne}</span> : null}
            {bien.ville||""}{bien.code_postal ? ` ${bien.code_postal}` : ""}{bien.agence ? ` · ${bien.agence}` : ""}
          </div>
        </div>
        <span style={{ background:`${couleur}18`, color:couleur, border:`1px solid ${couleur}33`, borderRadius:20, padding:"4px 14px", fontSize:12, fontWeight:700 }}>{bien.statut}</span>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setFicheTab("dossier")} title="Préparer le dossier investisseur">
          <Icon as={Briefcase} size={12} strokeWidth={2.2}/> Dossier investisseur
        </button>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setShowEdit(true)}>
          <Icon as={Pencil} size={12} strokeWidth={2.2}/> Modifier
        </button>
        <button
          className="inv-btn inv-btn-blue inv-btn-sm"
          onClick={validerGeolocalisationBien}
          disabled={geolocatingBien}
          title="Valider et enregistrer les coordonnées Google Maps à partir de l'adresse"
        >
          <Icon as={geolocatingBien ? RefreshCw : MapPin} size={12} strokeWidth={2.2} style={geolocatingBien ? {animation:"spin 1s linear infinite"} : undefined}/>
          {geolocatingBien ? "Géoloc…" : "Valider géoloc."}
        </button>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={async () => {
          if (!window.confirm(`Supprimer ce bien (${bien.adresse||"sans adresse"}) ? Cette action est irréversible.`)) return;
          await supabase.from("invest_propositions").delete().eq("bien_id", id);
          await supabase.from("invest_biens").delete().eq("id", id);
          onRetour();
        }}><Icon as={Trash2} size={12} strokeWidth={2.2}/> Supprimer</button>
      </div>

      {geoMessageBien && (
        <div style={{
          marginBottom:16, padding:"10px 13px", borderRadius:RADIUS.md,
          background: geoMessageBien.startsWith("Géolocalisation validée") ? SEMANTIC.success.bg : SEMANTIC.warning.bg,
          border:`1px solid ${geoMessageBien.startsWith("Géolocalisation validée") ? SEMANTIC.success.border : SEMANTIC.warning.border}`,
          color: geoMessageBien.startsWith("Géolocalisation validée") ? SU : WA,
          fontSize:FONT.sm.size+1, fontWeight:700,
        }}>
          {geoMessageBien}
        </div>
      )}

      <div style={{ display:"flex", gap:4, marginBottom:18, borderBottom:`1px solid ${T.border}`, paddingBottom:8, flexWrap:"wrap" }}>
        {[
          ["fiche", "Fiche bien", FileText],
          ["terrain", "Visite terrain", PhoneIcon],
          ["simulateur", "Simulateur", BarChart3],
          ["dossier", "Dossier investisseur", Briefcase],
        ].map(([key,label,IconComp]) => (
          <button key={key}
            onClick={() => changerOngletFiche(key)}
            style={{
              padding:"8px 18px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:800,
              letterSpacing:.6, textTransform:"uppercase", display:"inline-flex", alignItems:"center", gap:7,
              background: ficheTab===key ? T.accent : "transparent",
              color: ficheTab===key ? T.onAccent : T.textSub,
              transition:"all .15s",
            }}>
            <Icon as={IconComp} size={13} strokeWidth={2.2}/> {label}
          </button>
        ))}
      </div>

      {ficheTab === "fiche" && (
        <>
          <div className="inv-card" style={{marginBottom:16}}>
            <div className="inv-card-hd blue">
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13} strokeWidth={2.2}/>Synthèse rapide du bien</span>
            </div>
            <div className="inv-card-bd">
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10}}>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Référence</div>
                  <div className="inv-kpi-val accent" style={{fontSize:18}}>{bien.reference_interne || "—"}</div>
                </div>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Prix affiché</div>
                  <div className="inv-kpi-val" style={{fontSize:18}}>{fmtEur(bien.prix_vente || generalBien.prix_affiche)}</div>
                </div>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Offre / prix cible</div>
                  <div className="inv-kpi-val orange" style={{fontSize:18}}>{fmtEur(bien.montant_offre || conclusionBien.prix_offre_recommande || financeBien.prix_acquisition_negocie)}</div>
                </div>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Rendement brut</div>
                  <div className="inv-kpi-val green" style={{fontSize:18}}>{bien.rendement_brut ? Number(bien.rendement_brut).toFixed(1)+" %" : (financeBien.rendement_brut_calcule ? Number(financeBien.rendement_brut_calcule).toFixed(1)+" %" : "—")}</div>
                </div>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Recommandation</div>
                  <div className={`inv-kpi-val ${conclusionBien.recommandation === "Abandonner" ? "red" : "green"}`} style={{fontSize:18}}>{conclusionBien.recommandation || "À compléter"}</div>
                </div>
                <div className="inv-kpi" style={{padding:12}}>
                  <div className="inv-kpi-lbl">Note dossier</div>
                  <div className="inv-kpi-val accent" style={{fontSize:18}}>{conclusionBien.note_globale ? `${conclusionBien.note_globale}/10` : "—"}</div>
                </div>
              </div>
            </div>
          </div>

          <BienGoogleMapCard bien={bien} T={T} title="Carte du bien" />
        </>
      )}

      {ficheTab === "simulateur" ? (
        <>
          <div className="inv-card" style={{ marginBottom:16 }}>
            <div className="inv-card-hd gold">
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={BarChart3} size={13}/>Simulations du bien</span>
            </div>
            <div className="inv-card-bd">
              <div style={{ display:"grid", gridTemplateColumns:"minmax(260px, 1fr) auto auto auto auto", gap:8, alignItems:"end" }}>
                <div>
                  <label className="inv-kpi-lbl">Simulation active</label>
                  <select className="inv-sel" value={activeSimulationId} onChange={e=>setSelectedSimulationId(e.target.value)} style={{ width:"100%" }}>
                    {simulationsBien.map((s, index) => <option key={s.id} value={s.id}>{s.nom || `Simulation ${index + 1}`}</option>)}
                  </select>
                </div>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={creerSimulationBien}><Icon as={Plus} size={12}/> Nouvelle</button>
                <button className="inv-btn inv-btn-out inv-btn-sm" onClick={dupliquerSimulationBien}><Icon as={Copy} size={12}/> Dupliquer</button>
                <button className="inv-btn inv-btn-out inv-btn-sm" onClick={renommerSimulationBien}><Icon as={Pencil} size={12}/> Renommer</button>
                <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={supprimerSimulationBien}><Icon as={Trash2} size={12}/> Supprimer</button>
              </div>
              <div style={{ marginTop:8, fontSize:FONT.xs.size+1, color:T.textMuted }}>
                Vous pouvez créer plusieurs hypothèses pour le même bien : version prudente, version optimiste, offre basse, offre haute, financement 20 ans / 25 ans, etc. La simulation sélectionnée est celle qui alimente la fiche client et les indicateurs principaux du bien.
              </div>
            </div>
          </div>

          <Simulateur
            key={`${id}-${activeSimulationId}-${activeSimulation?.updated_at || bien.visite_data?.simulateur_updated_at || bien.updated_at || "sim"}`}
            projet={simulateurProjetBien}
            profil={profil}
            embedded={true}
            bienId={id}
            bienSource={bien}
            simulationId={activeSimulationId}
            simulationName={activeSimulation?.nom || simulateurProjetBien?.nom || "Simulation"}
            onBienSaved={charger}
            onRetour={() => setFicheTab("fiche")}
            theme={currentTheme}
            setTheme={null}
          />
        </>
      ) : ficheTab === "terrain" ? (
        <ModeVisiteTerrainOnglet bien={bien} profil={profil} T={T} onSaved={charger} />
      ) : ficheTab === "dossier" ? (
        <DossierPresentationInvestisseurCard bien={bien} T={T} onSaved={charger} selectedSimulationId={activeSimulationId} />
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 360px", gap:16, alignItems:"start" }}>
          <div className="inv-grid-safe" style={{ display:"flex", flexDirection:"column", gap:16, minWidth:0 }}>
            <div className="inv-card">
              <div className="inv-card-hd blue" style={{justifyContent:"space-between"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>Fiche bien simplifiée</span>
                <span style={{fontSize:FONT.xs.size+1,color:T.textMuted,fontWeight:800}}>Saisie rapide équipe</span>
              </div>
              <div className="inv-card-bd">
                <div style={{padding:"10px 12px",borderRadius:RADIUS.md,background:T.accentBg,border:`1px solid ${T.accentBorder}`,color:T.textSub,fontSize:FONT.sm.size+1,lineHeight:1.5,marginBottom:12}}>
                  Cette fiche garde les éléments principaux pour décider vite. Les détails techniques, DPE, urbanisme, photos, risques et questions à l’agent sont regroupés dans l’onglet <strong style={{color:T.accent}}>Visite terrain</strong>.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div>
                    <div style={{fontSize:FONT.xs.size,fontWeight:900,color:T.accent,textTransform:"uppercase",letterSpacing:1.2,marginBottom:8}}>Identification</div>
                    {[
                      ["Référence", bien.reference_interne || "—"],
                      ["Statut", bien.statut || "—"],
                      ["Adresse", [bien.adresse,bien.code_postal,bien.ville].filter(Boolean).join(" ") || "—"],
                      ["Interlocuteur", bien.interlocuteur || "—"],
                      ["Téléphone", bien.telephone_interlocuteur || "—"],
                      ["Source", bien.source_bien || bien.visite_data?.identification?.source || "—"],
                      ["Conseiller", bien.conseiller_profero || bien.visite_data?.identification?.conseiller_profero || "—"],
                      ["Date visite", fmtDate(bien.date_visite)],
                    ].map(([l,v])=>(
                      <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v}</span></div>
                    ))}
                    {bien.lien_annonce && (
                      <a href={bien.lien_annonce} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{marginTop:10,color:T.accent,borderColor:T.accentBorder}}><Icon as={ExternalLink} size={12}/> Ouvrir l’annonce</a>
                    )}
                  </div>
                  <div>
                    <div style={{fontSize:FONT.xs.size,fontWeight:900,color:T.accent,textTransform:"uppercase",letterSpacing:1.2,marginBottom:8}}>Budget rapide</div>
                    {[
                      ["Prix affiché", fmtEur(bien.prix_vente || generalBien.prix_affiche)],
                      ["Travaux estimés", fmtEur(bien.prix_travaux || financeBien.budget_travaux_ttc)],
                      ["Offre cible", fmtEur(bien.montant_offre || conclusionBien.prix_offre_recommande || financeBien.prix_acquisition_negocie)],
                      ["Coût total", fmtEur(bien.cout_total || financeBien.cout_total_operation_calcule)],
                      ["Rendement brut", bien.rendement_brut ? Number(bien.rendement_brut).toFixed(1)+" %" : (financeBien.rendement_brut_calcule ? Number(financeBien.rendement_brut_calcule).toFixed(1)+" %" : "—")],
                      ["Cash-flow", bien.cashflow_estime ? fmtEur(bien.cashflow_estime)+"/mois" : (financeBien.cashflow_mensuel ? fmtEur(financeBien.cashflow_mensuel)+"/mois" : "—")],
                    ].map(([l,v])=>(
                      <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc" style={{fontFamily:"'DM Mono',monospace",fontWeight:800}}>{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {bien.commentaire && (
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13} strokeWidth={2.2}/>Note rapide</span></div>
                <div className="inv-card-bd" style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{bien.commentaire}</div>
              </div>
            )}

            <DocumentsSection folder={`biens/${id}`} T={T} categories={DOCUMENT_CATEGORIES_BIEN} />
            <HistoriqueBienCard bien={bien} propositions={props} T={T} />
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:16, minWidth:0 }}>
            <ClientsAssociesCard />

            <div className="inv-card">
              <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Actions rapides</span></div>
              <div className="inv-card-bd" style={{display:"grid",gridTemplateColumns:"1fr",gap:8}}>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setFicheTab("terrain")} style={{width:"100%",justifyContent:"center"}}><Icon as={PhoneIcon} size={12}/> Remplir la visite terrain</button>
                <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setFicheTab("simulateur")} style={{width:"100%",justifyContent:"center"}}><Icon as={BarChart3} size={12}/> Ouvrir le simulateur</button>
                <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setFicheTab("dossier")} style={{width:"100%",justifyContent:"center"}}><Icon as={Briefcase} size={12}/> Préparer le dossier investisseur</button>
                <button className="inv-btn inv-btn-out inv-btn-sm" onClick={genererPresentationClientPDF} style={{width:"100%",justifyContent:"center"}}><Icon as={FileText} size={12}/> Ancienne fiche client</button>
                <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setShowEdit(true)} style={{width:"100%",justifyContent:"center"}}><Icon as={Pencil} size={12}/> Modifier les infos principales</button>
              </div>
            </div>

            <AnalyseRapideBienCard bien={bien} T={T} onSaved={charger} />
            <AutoScoreBienCard bien={bien} T={T} />
            <MatchingClientsBienCard bien={bien} clients={clients} propositions={props} T={T} onAssociate={associerClientMatching} />
          </div>
        </div>
      )}

      {showEdit && <FormulaireBien bien={bien} profil={profil} T={T} onSave={() => { setShowEdit(false); charger(); }} onClose={() => setShowEdit(false)} />}

      {showProp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"24px 26px", width:"90%", maxWidth:440 }}>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:16 }}>Proposer ce bien à un client</div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:5 }}>Client</label>
              <select className="inv-sel" value={newProp.client_id} style={{ width:"100%" }} onChange={e=>setNewProp({...newProp,client_id:e.target.value})}>
                <option value="">Sélectionner un client…</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
              </select>
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
              <button className="inv-btn inv-btn-out" onClick={() => setShowProp(false)}>Annuler</button>
              <button className="inv-btn inv-btn-blue" onClick={ajouterProp} disabled={savingProp||!newProp.client_id}>{savingProp?"…":"Proposer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── ADMIN INVEST ─────────────────────────────────────────────────────────────

export default StockBiens;
export { StockBiens, FicheBien, FormulaireBien, FicheVisiteBien, CarteBiens };
