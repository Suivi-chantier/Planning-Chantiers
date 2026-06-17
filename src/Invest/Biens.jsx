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
const VISITE_TERRAIN_DECISIONS = ["", "À creuser", "Offre possible", "Contre-visite", "Abandonner"];
const VISITE_TERRAIN_INTERETS = ["", "Très intéressant", "Intéressant", "Moyen", "Faible", "Non pertinent"];
const VISITE_TERRAIN_POTENTIELS = ["", "Oui", "Non", "À vérifier"];
const VISITE_TERRAIN_POINTS = [
  { group:"Extérieur & structure", items:[
    ["toiture", "Toiture"], ["charpente", "Charpente"], ["facade", "Façade / ravalement"], ["fissures", "Fissures structurelles"], ["humidite", "Humidité / moisissures"],
  ]},
  { group:"Réseaux & équipements", items:[
    ["electricite", "Électricité"], ["plomberie", "Plomberie"], ["chauffage", "Chauffage"], ["vmc", "VMC / ventilation"], ["compteurs", "Compteurs individuels"],
  ]},
  { group:"Découpe & exploitation", items:[
    ["acces", "Accès indépendants"], ["escaliers", "Escaliers / circulation"], ["stationnement", "Stationnement"], ["configuration", "Configuration des lots"], ["marche_locatif", "Marché locatif perçu"],
  ]},
  { group:"Réglementaire", items:[
    ["copro", "Copropriété / règlement"], ["urbanisme", "Urbanisme / division"], ["dpe", "DPE / énergie"], ["documents", "Documents disponibles"],
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

  const pointLabels = VISITE_TERRAIN_POINTS.flatMap(g => g.items);
  const statusDone = pointLabels.filter(([key]) => !!latestRef.current.points?.[key]?.statut).length;
  const decisionDone = ["date_visite", "interet", "conclusion", "potentiel_decoupe", "prochaine_action"].filter(k => String(latestRef.current[k] || "").trim()).length;
  const total = pointLabels.length + 5;
  const done = statusDone + decisionDone;
  const pct = Math.min(100, Math.round((done / Math.max(total, 1)) * 100));
  const missing = [
    ...(!data.date_visite ? ["Date de visite"] : []),
    ...(!data.interet ? ["Intérêt du bien"] : []),
    ...(!data.conclusion ? ["Décision rapide"] : []),
    ...(!data.potentiel_decoupe ? ["Potentiel de découpe"] : []),
    ...(!data.prochaine_action ? ["Prochaine action"] : []),
    ...pointLabels.filter(([key]) => !data.points?.[key]?.statut).map(([,label]) => label),
  ];
  const problemes = pointLabels.filter(([key]) => data.points?.[key]?.statut === "Problème").map(([,label]) => label);
  const aVerifier = pointLabels.filter(([key]) => data.points?.[key]?.statut === "À vérifier").map(([,label]) => label);

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
    autoSaveRef.current = setTimeout(() => save({ silent:true }), 900);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const statusColor = (st) => st === "OK" ? SU : st === "À vérifier" ? WA : st === "Problème" ? DA : T.textMuted;
  const DecisionButton = ({ value }) => {
    const active = data.conclusion === value;
    return (
      <button
        className="inv-btn inv-btn-sm"
        onClick={() => updateData({ conclusion:value })}
        style={{
          background: active ? (value === "Offre possible" ? SEMANTIC.success.bg : value === "Abandonner" ? SEMANTIC.danger.bg : T.accentBg) : T.input,
          border:`1px solid ${active ? (value === "Offre possible" ? SEMANTIC.success.border : value === "Abandonner" ? SEMANTIC.danger.border : T.accentBorder) : T.border}`,
          color: active ? (value === "Offre possible" ? SU : value === "Abandonner" ? DA : T.accent) : T.textSub,
          justifyContent:"center",
        }}
      >{value}</button>
    );
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16,alignItems:"start"}}>
      <div style={{position:"sticky",top:14,display:"flex",flexDirection:"column",gap:12}}>
        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Visite terrain</span></div>
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
            <button className="inv-btn inv-btn-blue" onClick={() => save({ silent:false })} disabled={saving} style={{width:"100%",justifyContent:"center",marginTop:12}}>
              <Icon as={saving ? RefreshCw : Save} size={13} style={saving ? {animation:"spin 1s linear infinite"} : undefined}/>
              {saving ? "Sauvegarde…" : saved ? "Sauvegardé" : "Enregistrer la visite"}
            </button>
            <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:8,lineHeight:1.45}}>Autosave actif après chaque saisie. Le statut du bien est ajusté selon la décision rapide.</div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd"><span>À compléter</span></div>
          <div className="inv-card-bd" style={{maxHeight:260,overflowY:"auto"}}>
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
          <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Sparkles} size={13}/>Décision rapide en fin de visite</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {VISITE_TERRAIN_DECISIONS.filter(Boolean).map(v => <DecisionButton key={v} value={v}/>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div><label className="inv-kpi-lbl">Intérêt du bien</label><select className="inv-sel" value={data.interet} onChange={e=>updateData({interet:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_INTERETS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Potentiel découpe</label><select className="inv-sel" value={data.potentiel_decoupe} onChange={e=>updateData({potentiel_decoupe:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_POTENTIELS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Offre possible</label><select className="inv-sel" value={data.offre_possible} onChange={e=>updateData({offre_possible:e.target.value})} style={{width:"100%"}}>{VISITE_TERRAIN_POTENTIELS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></div>
              <div><label className="inv-kpi-lbl">Date visite</label><input className="inv-inp" type="date" value={data.date_visite} onChange={e=>updateData({date_visite:e.target.value})} style={{width:"100%"}}/></div>
              <div><label className="inv-kpi-lbl">Conseiller</label><input className="inv-inp" value={data.conseiller} onChange={e=>updateData({conseiller:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder={profil?.nom||"Conseiller"}/></div>
              <div><label className="inv-kpi-lbl">Temps de visite</label><input className="inv-inp" value={data.temps_visite} onChange={e=>updateData({temps_visite:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder="Ex : 25 min"/></div>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Check} size={13}/>Checklist terrain rapide</span></div>
          <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:14}}>
            {VISITE_TERRAIN_POINTS.map(group => (
              <div key={group.group}>
                <div style={{fontSize:FONT.xs.size,fontWeight:900,color:T.accent,textTransform:"uppercase",letterSpacing:1.2,marginBottom:8}}>{group.group}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
                  {group.items.map(([key,label]) => {
                    const row = data.points?.[key] || {};
                    return (
                      <div key={key} style={{border:`1px solid ${T.border}`,borderRadius:RADIUS.md,background:T.input,padding:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:7}}>
                          <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text}}>{label}</div>
                          <select className="inv-sel" value={row.statut || ""} onChange={e=>updatePoint(key,{statut:e.target.value})} style={{width:118,color:statusColor(row.statut),fontWeight:800}}>{VISITE_TERRAIN_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select>
                        </div>
                        <input className="inv-inp" value={row.commentaire || ""} onChange={e=>updatePoint(key,{commentaire:e.target.value})} style={{width:"100%",textAlign:"left",fontSize:FONT.xs.size+1}} placeholder="Commentaire rapide…"/>
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
            <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13}/>Découpe & chiffrage ressenti</span></div>
            <div className="inv-card-bd" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label className="inv-kpi-lbl">Nombre de lots possible</label><input className="inv-inp" value={data.nombre_lots_possible} onChange={e=>updateData({nombre_lots_possible:e.target.value})} style={{width:"100%"}} placeholder="Ex : 4"/></div>
              <div><label className="inv-kpi-lbl">Budget travaux ressenti</label><input className="inv-inp" value={data.budget_travaux_ressenti} onChange={e=>updateData({budget_travaux_ressenti:e.target.value})} style={{width:"100%"}} placeholder="Ex : 140 000"/></div>
              <div style={{gridColumn:"1 / -1"}}><label className="inv-kpi-lbl">Points forts</label><textarea className="inv-textarea" rows={2} value={data.points_forts} onChange={e=>updateData({points_forts:e.target.value})} placeholder="Emplacement, volumes, accès, luminosité, demande locative…"/></div>
              <div style={{gridColumn:"1 / -1"}}><label className="inv-kpi-lbl">Points bloquants</label><textarea className="inv-textarea" rows={2} value={data.points_blocants} onChange={e=>updateData({points_blocants:e.target.value})} placeholder="Structure, humidité, copropriété, stationnement, DPE, enveloppe travaux…"/></div>
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13}/>Documents & photos à chaud</span></div>
            <div className="inv-card-bd">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {VISITE_TERRAIN_DOCS.map(([key,label]) => (
                  <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:FONT.sm.size+1,color:T.textSub,fontWeight:700,background:T.input,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"8px 9px",cursor:"pointer"}}>
                    <input type="checkbox" checked={!!data.docs?.[key]} onChange={e=>updateDoc(key,e.target.checked)}/>
                    {label}
                  </label>
                ))}
              </div>
              <label className="inv-kpi-lbl">Commentaire photos / documents</label>
              <textarea className="inv-textarea" rows={3} value={data.photos_commentaire} onChange={e=>updateData({photos_commentaire:e.target.value})} placeholder="Photos manquantes, documents à demander à l’agent, pièces bloquantes…"/>
            </div>
          </div>
        </div>

        <div className="inv-card">
          <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13}/>Suite à donner</span></div>
          <div className="inv-card-bd">
            <div style={{display:"grid",gridTemplateColumns:"1fr 160px",gap:10,marginBottom:10}}>
              <div><label className="inv-kpi-lbl">Prochaine action</label><input className="inv-inp" value={data.prochaine_action} onChange={e=>updateData({prochaine_action:e.target.value})} style={{width:"100%",textAlign:"left"}} placeholder="Ex : faire offre, demander DDT, programmer contre-visite…"/></div>
              <div><label className="inv-kpi-lbl">Date relance</label><input className="inv-inp" type="date" value={data.prochaine_action_date} onChange={e=>updateData({prochaine_action_date:e.target.value})} style={{width:"100%"}}/></div>
            </div>
            <label className="inv-kpi-lbl">Questions à poser / notes libres</label>
            <textarea className="inv-textarea" rows={3} value={data.questions_agent} onChange={e=>updateData({questions_agent:e.target.value})} placeholder="Questions à l’agent, points à vérifier en mairie, éléments à transmettre à Profero Rénovation…"/>
            <label className="inv-kpi-lbl" style={{marginTop:10,display:"block"}}>Commentaire final terrain</label>
            <textarea className="inv-textarea" rows={3} value={data.commentaire} onChange={e=>updateData({commentaire:e.target.value})} placeholder="Conclusion terrain rapide : pourquoi on poursuit ou pourquoi on abandonne…"/>
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

function StockBiens({ profil, T=THEMES_INV.dark, initialFilter }) {
  const [biens, setBiens]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ficheId, setFicheId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreVille, setFiltreVille]   = useState("");
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
    setFiltreStatut(""); setFiltreVille(""); setSpecialFilter(""); setSearch("");
    if (initialFilter.type === "open_bien" && initialFilter.bien_id) { setFicheId(initialFilter.bien_id); return; }
    if (initialFilter.type === "statut") setFiltreStatut(initialFilter.value || "");
    if (initialFilter.type === "a_relancer") { setSpecialFilter("a_relancer"); setSortConfig({ key:"date_relance", direction:"asc" }); }
    if (initialFilter.type === "all") setSortConfig({ key:"created_at", direction:"desc" });
  }, [initialFilter]);

  const today = new Date().toISOString().slice(0,10);
  const villes = [...new Set(biens.map(b => b.ville).filter(Boolean))];
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  let filtered = biens.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false;
    if (filtreVille && b.ville !== filtreVille) return false;
    if (specialFilter === "a_relancer" && !(b.date_relance && b.date_relance <= today)) return false;
    if (search && !normTxt(`${b.adresse||""} ${b.ville||""} ${b.code_postal||""} ${b.agence||""} ${b.interlocuteur||""} ${b.statut||""}`).includes(normTxt(search))) return false;
    return true;
  });

  filtered = [...filtered].sort((a,b) => compareValues(a[sortConfig.key], b[sortConfig.key], sortConfig.direction));

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
        <select className="inv-sel" value={`${sortConfig.key}:${sortConfig.direction}`} onChange={e=>{ const [key,direction]=e.target.value.split(":"); setSortConfig({key,direction}); }}>
          <option value="created_at:desc">Date entrée ↓</option>
          <option value="rendement_brut:desc">Rendement brut ↓</option>
          <option value="cashflow_estime:desc">Cash-flow ↓</option>
          <option value="cout_total:desc">Coût total ↓</option>
          <option value="date_relance:asc">Date relance ↑</option>
        </select>
        <button className="inv-btn inv-btn-danger inv-btn-sm"
          onClick={() => { setSpecialFilter("a_relancer"); setSortConfig({key:"date_relance", direction:"asc"}); }}>
          <Icon as={Bell} size={12} strokeWidth={2.2}/> Voir à relancer
        </button>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => { setFiltreStatut(""); setFiltreVille(""); setSpecialFilter(""); setSearch(""); setSortConfig({key:"created_at", direction:"desc"}); }}>
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
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Adresse</label><InpText value={form.adresse} onChange={e=>setForm({...form,adresse:e.target.value})} placeholder="123 rue de la Paix"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Ville</label><InpText value={form.ville} onChange={e=>setForm({...form,ville:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Code postal</label><InpText value={form.code_postal} onChange={e=>setForm({...form,code_postal:e.target.value})}/></div>
          <div style={{ marginBottom:12, gridColumn:"1 / 3", padding:"9px 11px", borderRadius:RADIUS.md, background:T.accentBg, border:`1px solid ${T.accentBorder}`, color:T.accent, fontSize:FONT.sm.size }}>
            📍 La latitude et la longitude seront calculées automatiquement à partir de l'adresse lors de l'enregistrement, puis le bien apparaîtra sur la Maps.
          </div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Interlocuteur</label><InpText value={form.interlocuteur} onChange={e=>setForm({...form,interlocuteur:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Téléphone</label><InpText value={form.telephone_interlocuteur} onChange={e=>setForm({...form,telephone_interlocuteur:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Agence</label><InpText value={form.agence} onChange={e=>setForm({...form,agence:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Statut</label>
            <select className="inv-sel" value={form.statut} style={{ width:"100%" }} onChange={e=>setForm({...form,statut:e.target.value})}>
              {STATUTS_BIEN.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Prix de vente (€)</label><InpNum value={form.prix_vente} onChange={e=>setForm({...form,prix_vente:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Prix travaux (€)</label><InpNum value={form.prix_travaux} onChange={e=>setForm({...form,prix_travaux:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Coût total (€)</label><InpNum value={form.cout_total} onChange={e=>setForm({...form,cout_total:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Rendement brut (%)</label><InpNum value={form.rendement_brut} step="0.1" onChange={e=>setForm({...form,rendement_brut:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Cash-flow estimé (€/mois)</label><InpNum value={form.cashflow_estime} onChange={e=>setForm({...form,cashflow_estime:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Montant offre (€)</label><InpNum value={form.montant_offre} onChange={e=>setForm({...form,montant_offre:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Date visite</label><InpText type="date" value={form.date_visite} onChange={e=>setForm({...form,date_visite:e.target.value})}/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Date relance</label><InpText type="date" value={form.date_relance} onChange={e=>setForm({...form,date_relance:e.target.value})}/></div>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien annonce</label><InpText value={form.lien_annonce} onChange={e=>setForm({...form,lien_annonce:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien Drive</label><InpText value={form.lien_drive} onChange={e=>setForm({...form,lien_drive:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12 }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Lien dossier rentabilité</label><InpText value={form.lien_rentabilite} onChange={e=>setForm({...form,lien_rentabilite:e.target.value})} placeholder="https://…"/></div>
          <div style={{ marginBottom:12, gridColumn: "1 / 3" }}><label style={{ fontSize:10, fontWeight:700, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:1.2, display:"block", marginBottom:4 }}>Commentaire</label><textarea className="inv-textarea" rows={3} value={form.commentaire} onChange={e=>setForm({...form,commentaire:e.target.value})}/></div>
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

function syncSimulateurFromVisiteData(visiteData = {}, bien = {}) {
  const existingSim = visiteData?.simulateur || {};
  const existingInputs = existingSim.inputs || {};
  const existingSelects = existingSim.selects || {};
  const existingDescriptions = existingSim.descriptions || {};
  const finance = visiteData.finance || {};
  const general = visiteData.general || {};
  const dpe = visiteData.dpe || {};
  const marche = visiteData.marche || {};
  const lots = mapVisiteLotsToSimulateurLots(visiteData);
  const surfaceFromLots = lots.reduce((s,l)=>s+(l.m2||0),0);
  const pickPositive = (...vals) => {
    for (const v of vals) {
      const n = numVal(v);
      if (n > 0) return n;
    }
    return 0;
  };
  const prixAffiche = pickPositive(general.prix_affiche, bien.prix_vente, existingInputs.prixAffiche);
  const prixNegocie = pickPositive(finance.prix_acquisition_negocie, bien.montant_offre, existingInputs.prixNegocie, prixAffiche);
  const budgetTravaux = pickPositive(finance.budget_travaux_ttc, bien.prix_travaux, existingInputs.budgetTravaux);
  const surface = pickPositive(general.surface_totale, bien.surface_totale, existingInputs.surface, surfaceFromLots);
  const adresse = [
    visiteData.identification?.adresse || bien.adresse,
    visiteData.identification?.code_postal || bien.code_postal,
    visiteData.identification?.ville || bien.ville,
  ].filter(Boolean).join(", ");

  return {
    ...existingSim,
    version: existingSim.version || 4,
    savedAt: new Date().toISOString(),
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
      honoraires: pickPositive(finance.frais_profero, existingInputs.honoraires),
    },
    selects: {
      gestionActive: false,
      modeDetention: "IS",
      tmi: "0.30",
      selectedScenario: 1,
      ...existingSelects,
    },
    lots: lots.length ? lots : (Array.isArray(existingSim.lots) && existingSim.lots.length ? existingSim.lots : [{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}]),
    budgetQty: existingSim.budgetQty || {},
    budgetPrice: existingSim.budgetPrice || {},
    customDivers: Array.isArray(existingSim.customDivers) ? existingSim.customDivers : [],
    descriptions: {
      description: bien.commentaire || existingDescriptions.description || "",
      travaux: dpe.travaux_energetiques || existingDescriptions.travaux || "",
      atouts: marche.points_forts || existingDescriptions.atouts || "",
      adresse: adresse || existingDescriptions.adresse || "",
    },
    photos: Array.isArray(existingSim.photos) ? existingSim.photos : [null,null,null,null],
    bien_id: bien.id || existingSim.bien_id || null,
    synced_from_fiche_bien_at: new Date().toISOString(),
  };
}

function makeSimulationId() {
  return `sim_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function makeSimulationEntry({ id = makeSimulationId(), nom = "Simulation", donnees = {}, createdAt = null } = {}) {
  const now = new Date().toISOString();
  const label = nom || donnees?.projectName || "Simulation";
  return {
    id,
    nom: label,
    created_at: createdAt || now,
    updated_at: now,
    donnees: {
      ...(donnees || {}),
      projectName: label,
      simulation_id: id,
      savedAt: donnees?.savedAt || now,
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
    version:4,
    savedAt: bien.updated_at || new Date().toISOString(),
    projectName: label,
    inputs: {
      prixAffiche, prixNegocie, budgetTravaux, tauxNotaire:0.08, surface,
      honoraires: parseFloat(finance.frais_profero) || 0,
      enedis:0,
      taxeFonciere:0, assurance:0, compta:0, provisions:0,
      apport1:0, apport2:0, taux1:4.20, taux2:4.20, duree1:20, duree2:25,
      coefEtat:1.0, imprevusPct:10,
    },
    selects: { gestionActive:false, modeDetention:"IS", tmi:"0.30", selectedScenario:1 },
    lots: lots.length ? lots : [{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}],
    budgetQty:{}, budgetPrice:{}, customDivers:[],
    descriptions: {
      description: bien.commentaire || "",
      travaux: visite.dpe?.travaux_energetiques || "",
      atouts: visite.marche?.points_forts || "",
      adresse: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
    },
    photos:[null,null,null,null],
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
          ...(s.donnees || {}),
          projectName: nom,
          bien_id: bien.id || s.donnees?.bien_id || null,
        },
        createdAt: s.created_at,
      });
    });
  }

  if (visite.simulateur) {
    const label = visite.simulateur.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`;
    return [makeSimulationEntry({
      id: visite.simulateur.simulation_id || visite.simulateur_active_id || `sim_default_${bien.id || "bien"}`,
      nom: label,
      donnees: {
        ...visite.simulateur,
        projectName: label,
        bien_id: bien.id || visite.simulateur.bien_id || null,
      },
      createdAt: visite.simulateur.savedAt || bien.updated_at,
    })];
  }

  const defaultState = syncSimulateurFromVisiteData({ ...visite, simulateur: buildDefaultSimulateurStateFromBien(bien) }, bien);
  return [makeSimulationEntry({
    id: visite.simulateur_active_id || `sim_default_${bien.id || "bien"}`,
    nom: defaultState.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`,
    donnees: defaultState,
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
  const synced = syncSimulateurFromVisiteData({ ...(bien.visite_data || {}), simulateur: active?.donnees || null }, bien);
  const nom = active?.nom || synced.projectName || `Simulation — ${bien.reference_interne || bien.adresse || "Bien"}`;

  return {
    id: null,
    nom,
    client_id: "",
    donnees: {
      ...synced,
      projectName: nom,
      simulation_id: active?.id || selectedSimulationId || null,
      bien_id: bien.id || null,
    },
  };
}

function getSimulationMetricsFromBien(bien = {}, selectedSimulationId = "") {
  const active = getActiveSimulationEntry(bien, selectedSimulationId);
  const sim = active?.donnees || bien.visite_data?.simulateur || {};
  const inputs = sim.inputs || {};
  const lots = Array.isArray(sim.lots) ? sim.lots : [];
  const activeLots = lots.filter(l => l && (l.type || "") !== "Sélectionner");
  const prix = numVal(inputs.prixNegocie || bien.montant_offre || bien.prix_vente);
  const prixAffiche = numVal(inputs.prixAffiche || bien.prix_vente);
  const travaux = numVal(inputs.budgetTravaux || bien.prix_travaux);
  const honoraires = numVal(inputs.honoraires);
  const enedis = numVal(inputs.enedis);
  const tauxNotaire = numVal(inputs.tauxNotaire || 0.08);
  const coutTotal = numVal(bien.cout_total) || prix + prix * tauxNotaire + travaux + honoraires + enedis;
  const loyerMensuel = activeLots.reduce((s,l)=>s+numVal(l.loyer),0);
  const rendement = coutTotal > 0 ? (loyerMensuel * 12 / coutTotal) * 100 : numVal(bien.rendement_brut);
  const taxeFonciere = numVal(inputs.taxeFonciere);
  const assurance = numVal(inputs.assurance);
  const compta = numVal(inputs.compta);
  const provisions = numVal(inputs.provisions);
  const taux = numVal(inputs.taux1 || 0);
  const duree = numVal(inputs.duree1 || 20);
  const apport = numVal(inputs.apport1 || 0);
  const mensualite = pmt(Math.max(coutTotal - apport, 0), taux, duree);
  const cashflow = loyerMensuel - ((taxeFonciere + assurance + compta + provisions) / 12) - mensualite;

  return {
    simulation: active,
    prixAffiche,
    prix,
    travaux,
    coutTotal,
    loyerMensuel,
    rendement,
    cashflow: Number.isFinite(cashflow) ? cashflow : numVal(bien.cashflow_estime),
    lots: activeLots.length,
    surface: numVal(inputs.surface || bien.surface_totale || bien.visite_data?.general?.surface_totale),
    score: computeAutoBienScore(bien),
    ville: bien.ville || "—",
    statut: bien.statut || "—",
  };
}

function ComparateurBiensNomade({ biens = [], selectedIds = [], onToggle, onOpenBien, onClose, T = THEMES_INV.dark }) {
  const selected = selectedIds.map(id => biens.find(b => b.id === id)).filter(Boolean);
  const fmtEurLocal = v => numVal(v) > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(numVal(v)) + " €" : "—";
  const fmtPctLocal = v => numVal(v) > 0 ? `${numVal(v).toFixed(1)} %` : "—";
  const rows = [
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
    const active = nextSimulations.find(s => s.id === activeId) || nextSimulations[0] || null;
    const updatedVisiteData = {
      ...(bien.visite_data || {}),
      simulateurs: nextSimulations,
      simulateur_active_id: active?.id || "",
      simulateur: legacySimulation || active?.donnees || bien.visite_data?.simulateur || null,
      simulateur_updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("invest_biens").update({ visite_data: updatedVisiteData }).eq("id", id);
    if (error) {
      alert("Erreur simulation : " + error.message);
      return;
    }
    setBien(prev => ({ ...prev, visite_data: updatedVisiteData }));
    setSelectedSimulationId(active?.id || "");
    charger();
  };

  const creerSimulationBien = async () => {
    if (!bien) return;
    const name = window.prompt("Nom de la nouvelle simulation", `Simulation ${getBienSimulations(bien).length + 1}`);
    if (!name) return;
    const baseState = syncSimulateurFromVisiteData({ ...(bien.visite_data || {}), simulateur: buildDefaultSimulateurStateFromBien(bien) }, bien);
    const entry = makeSimulationEntry({
      nom: name.trim(),
      donnees: { ...baseState, projectName: name.trim(), bien_id: bien.id || id },
    });
    await persistSimulationsBien([...getBienSimulations(bien), entry], entry.id, entry.donnees);
  };

  const dupliquerSimulationBien = async () => {
    if (!bien) return;
    const sims = getBienSimulations(bien);
    const active = getActiveSimulationEntry(bien, selectedSimulationId);
    if (!active) return;
    const name = window.prompt("Nom de la simulation dupliquée", `${active.nom || "Simulation"} — copie`);
    if (!name) return;
    const clonedData = JSON.parse(JSON.stringify(active.donnees || {}));
    const entry = makeSimulationEntry({
      nom: name.trim(),
      donnees: { ...clonedData, projectName: name.trim(), bien_id: bien.id || id },
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
    const next = sims.map(s => s.id === active.id ? makeSimulationEntry({
      id: s.id,
      nom: name.trim(),
      donnees: { ...(s.donnees || {}), projectName: name.trim(), bien_id: bien.id || id },
      createdAt: s.created_at,
    }) : s);
    await persistSimulationsBien(next, active.id, next.find(s => s.id === active.id)?.donnees || null);
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

    openFicheClientInvestisseurPDF({
      title: [bien.adresse, bien.ville].filter(Boolean).join(" - ") || bien.reference_interne || "Fiche investisseur",
      subtitle: "Analyse de Rentabilité",
      address: [bien.adresse, bien.code_postal, bien.ville].filter(Boolean).join(", "),
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
    if (ficheTab === "fiche" && ficheVisiteRef.current?.sauvegarder) {
      await ficheVisiteRef.current.sauvegarder({ refresh:false });
    }
    onRetour();
  };

  const changerOngletFiche = async (key) => {
    if (ficheTab === "fiche" && key !== "fiche" && ficheVisiteRef.current?.sauvegarder) {
      await ficheVisiteRef.current.sauvegarder({ refresh:false });
      await charger();
    }
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
        {ficheTab === "fiche" && (
          <button
            className="inv-btn inv-btn-gold inv-btn-sm"
            onClick={() => ficheVisiteRef.current?.sauvegarder?.()}
            disabled={visiteSaveState.saving}
            title="Enregistrer la fiche visite"
          >
            <Icon as={Save} size={12} strokeWidth={2.2}/>
            {visiteSaveState.saving ? "Sauvegarde…" : visiteSaveState.saved ? "Sauvegardé" : "Enregistrer"}
          </button>
        )}
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={genererPresentationClientPDF} title="Générer la fiche client investisseur">
          <Icon as={Sparkles} size={12} strokeWidth={2.2}/> Fiche client
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
          ["fiche", "Fiche visite", FileText],
          ["terrain", "Visite terrain", PhoneIcon],
          ["simulateur", "Simulateur", BarChart3],
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
      ) : (
      <div style={{ display:"grid", gridTemplateColumns:"0.82fr 1.18fr", gap:16, alignItems:"start" }}>
        <div className="inv-grid-safe" style={{ display:"flex", flexDirection:"column", gap:16, minWidth:0 }}>
          <ClientsAssociesCard />
          <AutoScoreBienCard bien={bien} T={T} />
          <AnalyseRapideBienCard bien={bien} T={T} onSaved={charger} />
          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={PhoneIcon} size={13}/>Visite terrain</span></div>
            <div className="inv-card-bd">
              <div style={{fontSize:FONT.sm.size+1,color:T.textSub,lineHeight:1.55,marginBottom:10}}>Ouvrez l’onglet dédié pour remplir rapidement la visite sur mobile, avec checklist et décision immédiate.</div>
              <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setFicheTab("terrain")} style={{width:"100%",justifyContent:"center"}}>Ouvrir la visite terrain</button>
            </div>
          </div>
          <MatchingClientsBienCard bien={bien} clients={clients} propositions={props} T={T} onAssociate={associerClientMatching} />

          <div className="inv-card">
            <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>Informations</span></div>
            <div className="inv-card-bd">
              {[["Référence Profero", bien.reference_interne || "—"],["Géolocalisation", (isValidLatLng(parseFloat(bien.latitude), parseFloat(bien.longitude)) ? `${parseFloat(bien.latitude).toFixed(6)}, ${parseFloat(bien.longitude).toFixed(6)}` : "À valider")],["Interlocuteur", bien.interlocuteur],["Téléphone", bien.telephone_interlocuteur],["Source", bien.source_bien || bien.visite_data?.identification?.source],["Conseiller", bien.conseiller_profero || bien.visite_data?.identification?.conseiller_profero],["Lien annonce", bien.lien_annonce ? <a href={bien.lien_annonce} target="_blank" rel="noreferrer" style={{color:T.accent}}>Voir l'annonce ↗</a> : "—"],["Date visite", fmtDate(bien.date_visite)],["Date relance", fmtDate(bien.date_relance)],["Statut relance", bien.statut_relance||"—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v||"—"}</span></div>
              ))}
            </div>
          </div>

          <div className="inv-card">
            <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Wallet} size={13} strokeWidth={2.2}/>Données Financières</span></div>
            <div className="inv-card-bd">
              {[["Prix de vente", fmtEur(bien.prix_vente)],["Prix travaux", fmtEur(bien.prix_travaux)],["Coût total", fmtEur(bien.cout_total)],["Montant offre", fmtEur(bien.montant_offre)],["Rendement brut", bien.rendement_brut > 0 ? bien.rendement_brut.toFixed(1)+"%" : "—"],["Cash-flow estimé", bien.cashflow_estime ? fmtEur(bien.cashflow_estime)+"/mois" : "—"]].map(([l,v])=>(
                <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc" style={{fontFamily:"'DM Mono',monospace",fontWeight:700}}>{v}</span></div>
              ))}
              {(bien.lien_drive || bien.lien_rentabilite) && (
                <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                  {bien.lien_drive && <a href={bien.lien_drive} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:T.accentBorder}}><Icon as={FileText} size={12} strokeWidth={2.2}/> Dossier Drive <Icon as={ExternalLink} size={10}/></a>}
                  {bien.lien_rentabilite && <a href={bien.lien_rentabilite} target="_blank" rel="noreferrer" className="inv-btn inv-btn-out inv-btn-sm" style={{color:T.accent,borderColor:T.accentBorder}}><Icon as={BarChart3} size={12} strokeWidth={2.2}/> Rentabilité <Icon as={ExternalLink} size={10}/></a>}
                </div>
              )}
            </div>
          </div>
          {bien.commentaire && (
            <div className="inv-card">
              <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MessageSquare} size={13} strokeWidth={2.2}/>Commentaire</span></div>
              <div className="inv-card-bd" style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{bien.commentaire}</div>
            </div>
          )}

          <OffreAchatBienCard bien={bien} T={T} onSaved={charger} />
          <ChecklistDocumentsBienCard bien={bien} T={T} onSaved={charger} />
          <DocumentsSection folder={`biens/${id}`} T={T} categories={DOCUMENT_CATEGORIES_BIEN} />
          <HistoriqueBienCard bien={bien} propositions={props} T={T} />
        </div>

        <FicheVisiteBien ref={ficheVisiteRef} bien={bien} profil={profil} T={T} onSaved={charger} onSaveStateChange={setVisiteSaveState} />
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
