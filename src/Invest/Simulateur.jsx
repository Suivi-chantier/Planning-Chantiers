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

// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({ profil, onOuvrir, onNouveauProjet, inline, T=THEMES_INV.dark }) {
  const [projets, setProjets] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suppId, setSuppId]   = useState(null);
  const [filtreClient, setFiltreClient] = useState("");

  const charger = async () => {
    setLoading(true);
    // Tente avec client_id ; si la colonne n'existe pas (42703), retry sans.
    // Migration SQL nécessaire : ALTER TABLE invest_projets ADD COLUMN client_id UUID REFERENCES invest_clients(id) ON DELETE SET NULL;
    let res = await supabase.from("invest_projets")
      .select("id,nom,created_by,created_at,updated_at,donnees,client_id")
      .order("updated_at",{ascending:false});
    if (res.error?.code === "42703") {
      res = await supabase.from("invest_projets")
        .select("id,nom,created_by,created_at,updated_at,donnees")
        .order("updated_at",{ascending:false});
    }
    setProjets(res.data || []);
    // Charge la liste des clients pour afficher leur nom sur les cards et filtrer
    const { data: cs } = await supabase.from("invest_clients").select("id,nom,prenom").order("nom");
    setClients(cs || []);
    setLoading(false);
  };
  useEffect(()=>{charger();},[]);

  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const projetsFiltres = filtreClient
    ? projets.filter(p => p.client_id === filtreClient)
    : projets;

  const supprimer = async (id) => {
    await supabase.from("invest_projets").delete().eq("id",id);
    setSuppId(null); charger();
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}) : "—";
  const kpi = (d) => {
    if(!d?.inputs) return null;
    const pN=d.inputs.prixNegocie||0, fn=pN*(d.inputs.tauxNotaire||0.08);
    const total=pN+fn+(d.inputs.honoraires||0)+(d.inputs.enedis||0);
    const lots=(d.lots||[]).filter(l=>l.type!=="Sélectionner");
    return {total, loyer:lots.reduce((s,l)=>s+l.loyer,0), nbLots:lots.length};
  };

  const renderCard = (p) => {
    const k = kpi(p.donnees);
    const client = p.client_id ? clientById[p.client_id] : null;
    return (
      <div key={p.id} className="inv-card" style={{padding:`${SPACING.lg+2}px ${SPACING.lg+4}px`, cursor:"pointer", transition:"all .18s"}}
        onClick={()=>onOuvrir(p)}>
        <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:SPACING.sm, marginBottom:SPACING.md-2}}>
          <div style={{flex:1, minWidth:0, display:"flex", alignItems:"flex-start", gap:SPACING.sm}}>
            <div style={{
              width:36, height:36, borderRadius:RADIUS.lg, flexShrink:0,
              background:T.accentBg, color:T.accent,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon as={FileText} size={18} strokeWidth={2}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:FONT.md.size, fontWeight:700, color:T.text, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:-0.2}}>
                {p.nom}
              </div>
              <div style={{fontSize:FONT.xs.size, color:T.textMuted}}>
                Par {p.created_by} · {fmtDate(p.updated_at)}
              </div>
              {client && (
                <div style={{fontSize:FONT.xs.size, color:T.accent, marginTop:5, display:"inline-flex", alignItems:"center", gap:4, fontWeight:600}}>
                  <Icon as={Users} size={11} strokeWidth={2.2}/>
                  {client.prenom} {client.nom}
                </div>
              )}
            </div>
          </div>
          <button onClick={e=>{e.stopPropagation();setSuppId(p.id);}}
            style={{
              background:"transparent", border:"none", cursor:"pointer", color:T.textMuted,
              padding:SPACING.xs, borderRadius:RADIUS.md, display:"flex", alignItems:"center",
              justifyContent:"center", transition:"all .15s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.background=SEMANTIC.danger.bg; e.currentTarget.style.color=DA;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent"; e.currentTarget.style.color=T.textMuted;}}>
            <Icon as={X} size={16} strokeWidth={2.2}/>
          </button>
        </div>
        {k && (
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:SPACING.xs+2, marginBottom:SPACING.md-2}}>
            {[
              {label:"Coût total", val:k.total>0?fmt(k.total):"—", color:T.accent, icon:Wallet},
              {label:"Loyers/mois", val:k.loyer>0?fmt(k.loyer):"—", color:SU, icon:TrendingUp},
              {label:"Lots", val:k.nbLots, color:WA, icon:Home},
            ].map(item=>(
              <div key={item.label} style={{
                background:T.cardHover, borderRadius:RADIUS.md, padding:`${SPACING.xs+2}px ${SPACING.sm+1}px`,
                borderLeft:`3px solid ${item.color}`,
              }}>
                <div style={{fontSize:FONT.xs.size-1, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:2, display:"inline-flex", alignItems:"center", gap:4}}>
                  <Icon as={item.icon} size={9} strokeWidth={2}/> {item.label}
                </div>
                <div style={{fontSize:FONT.sm.size+1, fontWeight:800, color:item.color, fontFamily:"'DM Mono',monospace"}}>{item.val}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <span style={{
            fontSize:FONT.xs.size-1, background:T.cardHover, color:T.textSub,
            padding:`${SPACING.xs-2}px ${SPACING.sm}px`, borderRadius:RADIUS.pill, fontWeight:600,
          }}>{fmtDate(p.created_at)}</span>
          <span style={{fontSize:FONT.sm.size, color:T.accent, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4}}>
            Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5}/>
          </span>
        </div>
      </div>
    );
  };

  const modalSuppr = () => (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)"}}>
      <div style={{
        background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl,
        padding:`${SPACING.xl+2}px ${SPACING.xl+6}px`, maxWidth:380, width:"90%", textAlign:"center",
        boxShadow:T.shadowMd,
      }}>
        <div style={{
          width:56, height:56, borderRadius:"50%", margin:`0 auto ${SPACING.md}px`,
          background:SEMANTIC.danger.bg, border:`2px solid ${SEMANTIC.danger.border}`,
          display:"flex", alignItems:"center", justifyContent:"center", color:DA,
        }}>
          <Icon as={Trash2} size={26} strokeWidth={2}/>
        </div>
        <div style={{fontSize:FONT.md.size+1, fontWeight:800, color:T.text, marginBottom:6}}>Supprimer ce projet ?</div>
        <div style={{fontSize:FONT.sm.size+1, color:T.textSub, marginBottom:SPACING.xl-2, lineHeight:1.55}}>
          Cette action est <strong>irréversible</strong>.
        </div>
        <div style={{display:"flex", gap:SPACING.sm+2, justifyContent:"center"}}>
          <button className="inv-btn inv-btn-out" onClick={()=>setSuppId(null)}>Annuler</button>
          <button className="inv-btn inv-btn-danger" onClick={()=>supprimer(suppId)}>
            <Icon as={Trash2} size={13} strokeWidth={2.2}/> Supprimer
          </button>
        </div>
      </div>
    </div>
  );

  const emptyState = (label, sub) => (
    <div style={{textAlign:"center", padding:`${SPACING.xxl}px ${SPACING.lg}px`}}>
      <div style={{
        width:64, height:64, borderRadius:RADIUS.xl, margin:`0 auto ${SPACING.md}px`,
        background:T.accentBg, color:T.accent,
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <Icon as={Building2} size={32} strokeWidth={1.5}/>
      </div>
      <div style={{fontSize:FONT.md.size+1, fontWeight:700, color:T.text, marginBottom:6}}>{label}</div>
      {sub && <div style={{fontSize:FONT.sm.size+1, color:T.textSub, marginBottom:SPACING.lg+2}}>{sub}</div>}
      <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
        <Icon as={Plus} size={13} strokeWidth={2.2}/> Créer un projet
      </button>
    </div>
  );

  if (inline) return (
    <div>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:SPACING.lg+2, flexWrap:"wrap", gap:SPACING.sm+2}}>
        <div style={{fontSize:FONT.sm.size+1, color:T.textMuted}}>
          {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet
        </button>
      </div>
      {loading ? (
        <div style={{textAlign:"center", padding:`${SPACING.xl+8}px 0`, color:T.textMuted, display:"inline-flex", alignItems:"center", justifyContent:"center", width:"100%", gap:8}}>
          <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
          Chargement…
        </div>
      ) : projets.length===0 ? (
        emptyState("Aucun projet pour l'instant", null)
      ) : (
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:SPACING.md+2}}>
          {projetsFiltres.map(p=>renderCard(p))}
        </div>
      )}
      {suppId&&modalSuppr()}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div className="inv" style={{position:"fixed",inset:0,zIndex:9999,overflowY:"auto"}}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{
        background:T.sidebar, padding:`${SPACING.md+2}px ${SPACING.xl}px`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, zIndex:10, borderBottom:`1px solid ${T.sidebarBorder}`,
        boxShadow:T.shadowSm,
      }}>
        <div style={{display:"flex", alignItems:"center", gap:SPACING.md}}>
          <span style={{fontSize:FONT.xs.size, letterSpacing:2, textTransform:"uppercase", color:T.accent, fontWeight:700}}>Profero</span>
          <span style={{fontSize:FONT.xl.size+2, fontWeight:800, color:T.text, letterSpacing:-0.3}}>Invest</span>
          <div style={{width:1, height:20, background:T.border}}/>
          <span style={{fontSize:FONT.sm.size+1, color:T.textSub}}>Portefeuille de projets</span>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={onNouveauProjet}>
          <Icon as={Plus} size={13} strokeWidth={2.2}/> Nouveau projet
        </button>
      </div>
      {/* Contenu */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#e8eaf0",letterSpacing:.3}}>Tous les projets</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:2}}>
              {projetsFiltres.length} projet{projetsFiltres.length!==1?"s":""}
              {filtreClient && projetsFiltres.length !== projets.length && ` sur ${projets.length}`}
              {" "}— partagés avec tous les associés
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <select className="inv-sel" value={filtreClient} onChange={e=>setFiltreClient(e.target.value)} style={{minWidth:200}}>
              <option value="">👥 Tous les clients</option>
              <option value="" disabled>──────────</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
              ))}
            </select>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={charger}>↻ Actualiser</button>
          </div>
        </div>
        {loading ? (
          <div style={{textAlign:"center", padding:`${SPACING.xxxl}px 0`, color:T.textMuted, display:"flex", justifyContent:"center", alignItems:"center", gap:8}}>
            <Icon as={RefreshCw} size={14} style={{animation:"spin 1s linear infinite"}}/>
            Chargement…
          </div>
        ) : projets.length===0 ? (
          emptyState("Aucun projet pour l'instant", "Créez votre premier projet d'investissement")
        ) : (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:SPACING.md+2}}>
            {projetsFiltres.map(p=>renderCard(p))}
          </div>
        )}
      </div>
      {suppId&&modalSuppr()}
    </div>
  );
}

// ─── SIMULATEUR ───────────────────────────────────────────────────────────────
function Simulateur({ projet, profil, onRetour, theme="dark", setTheme, embedded=false, bienId: embeddedBienId=null, bienSource=null, onBienSaved }) {
  const isNew = !projet?.id;
  const projetIdRef = useRef(projet?.id||null);
  const isEmbedded = !!embedded;

  // ── État principal ──────────────────────────────────────────────────────────
  const [nom,    setNom]    = useState(projet?.donnees?.projectName || projet?.nom || "Nouveau projet");
  const [tab,    setTab]    = useState("simulateur");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [showReset, setShowReset] = useState(false);
  // Lien client (optionnel) — ajouté au BLOC B
  const [clientId, setClientId] = useState(projet?.client_id || "");
  const [clientsList, setClientsList] = useState([]);
  useEffect(() => {
    supabase.from("invest_clients").select("id,nom,prenom").order("nom")
      .then(({ data }) => setClientsList(data || []));
  }, []);

  // ── Entrées ──────────────────────────────────────────────────────────────────
  const d0 = projet?.donnees?.inputs || {};
  const s0 = projet?.donnees?.selects || {};
  const [prixAffiche,   setPrixAffiche]   = useState(d0.prixAffiche||280000);
  const [prixNegocie,   setPrixNegocie]   = useState(d0.prixNegocie||250000);
  const [tauxNotaire,   setTauxNotaire]   = useState(d0.tauxNotaire||0.08);
  const [surface,       setSurface]       = useState(d0.surface||237);
  const [budgetTravaux, setBudgetTravaux] = useState(d0.budgetTravaux||0);
  const [honoraires,    setHonoraires]    = useState(d0.honoraires||0);
  const [enedis,        setEnedis]        = useState(d0.enedis||0);
  const [taxeFonciere,  setTaxeFonciere]  = useState(d0.taxeFonciere||1000);
  const [assurance,     setAssurance]     = useState(d0.assurance||600);
  const [compta,        setCompta]        = useState(d0.compta||800);
  const [provisions,    setProvisions]    = useState(d0.provisions ?? 0);
  const [apport1,       setApport1]       = useState(d0.apport1||20000);
  const [apport2,       setApport2]       = useState(d0.apport2||20000);
  const [taux1,         setTaux1]         = useState(d0.taux1||4.32);
  const [taux2,         setTaux2]         = useState(d0.taux2||3.14);
  const [duree1,        setDuree1]        = useState(d0.duree1||20);
  const [duree2,        setDuree2]        = useState(d0.duree2||25);
  const [coefEtat,      setCoefEtat]      = useState(d0.coefEtat||1.0);
  const [imprevusPct,   setImprevusPct]   = useState(d0.imprevusPct||10);
  const [gestionActive, setGestionActive] = useState(s0.gestionActive||false);
  const [modeDetention, setModeDetention] = useState(s0.modeDetention||"IS");
  const [tmi,           setTmi]           = useState(parseFloat(s0.tmi)||0.30);
  const [selectedScen,  setSelectedScen]  = useState(s0.selectedScenario||1);
  const [lots, setLots] = useState(projet?.donnees?.lots || DEFAULT_LOTS.map(l=>({...l})));
  const [budgetQty,   setBudgetQty]   = useState(()=>{
    const b=initBudgetState(projet?.donnees?.lots||DEFAULT_LOTS, d0.surface||237);
    if(projet?.donnees?.budgetQty) Object.assign(b.qty, projet.donnees.budgetQty);
    return b.qty;
  });
  const [budgetPrice, setBudgetPrice] = useState(()=>{
    const b=initBudgetState(projet?.donnees?.lots||DEFAULT_LOTS, d0.surface||237);
    if(projet?.donnees?.budgetPrice) Object.assign(b.price, projet.donnees.budgetPrice);
    return b.price;
  });
  const [customDivers, setCustomDivers] = useState(projet?.donnees?.customDivers||[]);
  const [desc,      setDesc]      = useState(projet?.donnees?.descriptions?.description||"");
  const [travaux,   setTravaux]   = useState(projet?.donnees?.descriptions?.travaux||"");
  const [atouts,    setAtouts]    = useState(projet?.donnees?.descriptions?.atouts||"");
  const [adresse,   setAdresse]   = useState(projet?.donnees?.descriptions?.adresse||"");
  const [photos,    setPhotos]    = useState(projet?.donnees?.photos||[null,null,null,null]);
  // Liaison optionnelle vers un bien du stock (table invest_biens)
  const [bienId,    setBienId]    = useState(projet?.donnees?.bien_id||"");
  const [biensList, setBiensList] = useState([]);
  const [showLierBien, setShowLierBien] = useState(false);
  useEffect(() => {
    supabase.from("invest_biens").select("id,adresse,ville,code_postal,prix_vente,prix_travaux,cout_total,interlocuteur,agence").order("adresse")
      .then(({ data }) => setBiensList(data || []));
  }, []);

  // ── Calculs dérivés ─────────────────────────────────────────────────────────
  const fn          = prixNegocie * tauxNotaire;
  const prixAchat   = prixNegocie + fn;
  const coutTotal   = prixAchat + budgetTravaux + honoraires + enedis;
  const aLots       = actLots(lots);
  const totLoyer    = aLots.reduce((s,l)=>s+l.loyer,0);
  const totLoyerAn  = totLoyer*12;
  const totGestMois = gestionActive ? aLots.reduce((s,l)=>s+(GESTION_PRICES[l.type]||0),0) : 0;
  const totGestAn   = totGestMois*12;
  const totCharges  = taxeFonciere+assurance+compta+totGestAn+provisions;
  const af1=coutTotal-apport1, af2=coutTotal-apport2;
  const m1=pmt(af1,taux1,duree1), m2=pmt(af2,taux2,duree2);
  const ann1=m1*12, ann2=m2*12;
  const rb = coutTotal>0 ? totLoyerAn/coutTotal : 0;
  const rn = coutTotal>0 ? (totLoyerAn-totCharges)/coutTotal : 0;
  const cfm1=(totLoyerAn-totCharges)/12-m1, cfm2=(totLoyerAn-totCharges)/12-m2;
  const ct1=totCharges+ann1, ct2=totCharges+ann2;
  const pe1=totLoyerAn>0?ct1/totLoyerAn:0, pe2=totLoyerAn>0?ct2/totLoyerAn:0;
  const cfSel=selectedScen===1?cfm1:cfm2, peSel=selectedScen===1?pe1:pe2;

  // Fiscalité rapide
  const res=totLoyerAn-totCharges-ann1;
  const ab=coutTotal*0.85/30, at=budgetTravaux/10;
  let impotRapide=0;
  if(modeDetention==="IS"){const r2=totLoyerAn-totCharges-ann1*.7-ab;impotRapide=r2>0?Math.min(r2,42500)*.15+Math.max(r2-42500,0)*.25:0;}
  else if(modeDetention==="IR"){const rf=totLoyerAn-totCharges-ann1*.7;impotRapide=Math.max(rf,0)*(tmi+.172);}
  else{const rl=res-ab-at;impotRapide=Math.max(rl,0)*tmi;}
  const cfNetRapide=res-impotRapide;

  // Fiscalité détaillée
  const rIS=totLoyerAn-totCharges-ann1*.7-ab;
  const isT1=Math.min(Math.max(rIS,0),42500)*.15, isT2=Math.max(rIS-42500,0)*.25;
  const cfIS=res-(isT1+isT2);
  const rf=totLoyerAn-totCharges-ann1*.7;
  const irImp=Math.max(rf,0)*tmi, irPS=Math.max(rf,0)*.172, cfIR=res-irImp-irPS;
  const rL=res-ab-at, lImp=Math.max(rL,0)*tmi, cfL=res-lImp;

  // Budget travaux
  let budgetSub=0;
  BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{budgetSub+=(budgetQty[item.id]||0)*(budgetPrice[item.id]||0);}));
  customDivers.forEach(cd=>{budgetSub+=(cd.qty||0)*(cd.price||0);});
  const budgetImp=budgetSub*(imprevusPct/100);
  const budgetCoef=(budgetSub+budgetImp)*coefEtat;
  const budgetTTC=budgetCoef*1.10;

  // ── Sauvegarde Supabase ─────────────────────────────────────────────────────
  const collectState = useCallback(()=>({
    version:4, savedAt:new Date().toISOString(), projectName:nom,
    inputs:{prixAffiche,prixNegocie,budgetTravaux,tauxNotaire,surface,honoraires,enedis,taxeFonciere,assurance,compta,provisions,apport1,apport2,taux1,taux2,duree1,duree2,coefEtat,imprevusPct},
    selects:{gestionActive,modeDetention,tmi:tmi.toString(),selectedScenario:selectedScen},
    lots:lots.map(l=>({...l})), budgetQty:{...budgetQty}, budgetPrice:{...budgetPrice},
    customDivers:customDivers.map(c=>({...c})),
    descriptions:{description:desc,travaux,atouts,adresse},
    photos:photos.slice(),
    bien_id: bienId || null,
  }),[nom,prixAffiche,prixNegocie,budgetTravaux,tauxNotaire,surface,honoraires,enedis,taxeFonciere,assurance,compta,provisions,apport1,apport2,taux1,taux2,duree1,duree2,coefEtat,imprevusPct,gestionActive,modeDetention,tmi,selectedScen,lots,budgetQty,budgetPrice,customDivers,desc,travaux,atouts,adresse,photos,bienId]);

  const sauvegarder = useCallback(async(options = {})=>{
    const silent = !!options?.silent;
    setSaving(true);
    const state = collectState();

    if (isEmbedded && embeddedBienId) {
      const existingVisiteData = (bienSource && bienSource.visite_data) || {};
      const updatedVisiteData = {
        ...existingVisiteData,
        simulateur: state,
        simulateur_updated_at: new Date().toISOString(),
      };

      const payloadBien = {
        visite_data: updatedVisiteData,
        prix_vente: parseFloat(prixAffiche) || 0,
        prix_travaux: parseFloat(budgetTravaux) || 0,
        cout_total: parseFloat(coutTotal) || 0,
        rendement_brut: rb > 0 ? rb * 100 : 0,
        cashflow_estime: parseFloat(cfSel) || 0,
        montant_offre: parseFloat(prixNegocie) || 0,
      };

      const { error } = await supabase.from("invest_biens").update(payloadBien).eq("id", embeddedBienId);
      if (error) {
        console.error("Erreur sauvegarde simulateur bien:", error);
        if (!silent) alert("Erreur sauvegarde simulateur : " + error.message);
      } else {
        if (!silent && typeof onBienSaved === "function") onBienSaved();
        setSaved(true);
        setTimeout(()=>setSaved(false),2500);
      }
      setSaving(false);
      return;
    }

    // Inclut client_id (peut être null si non lié). Si la colonne n'existe pas
    // encore en base (code 42703), on retry sans pour ne pas bloquer la save.
    const payload = {
      nom,
      created_by: profil?.email||profil?.nom||"inconnu",
      updated_at: new Date().toISOString(),
      donnees: state,
      client_id: clientId || null,
    };
    const tryWrite = async (p) => {
      if (projetIdRef.current) {
        return await supabase.from("invest_projets").update(p).eq("id", projetIdRef.current);
      } else {
        return await supabase.from("invest_projets").insert({...p, created_at:new Date().toISOString()}).select("id").single();
      }
    };
    let res = await tryWrite(payload);
    if (res.error?.code === "42703") {
      console.warn("Colonne client_id manquante sur invest_projets — fallback. Migration nécessaire.");
      const { client_id, ...payloadSansClient } = payload;
      res = await tryWrite(payloadSansClient);
    }
    if (res.error) {
      console.error("Erreur sauvegarde projet:", res.error);
      if (!silent) alert("Erreur sauvegarde simulateur : " + res.error.message);
    } else if (!projetIdRef.current && res.data?.id) {
      projetIdRef.current = res.data.id;
    }
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2500);
  },[collectState, nom, profil, clientId, isEmbedded, embeddedBienId, bienSource, prixAffiche, prixNegocie, budgetTravaux, coutTotal, rb, cfSel, onBienSaved]);

  // Autosave rapide du simulateur
  const autoRef = useRef(null);
  const saveRef = useRef(null);
  useEffect(() => { saveRef.current = sauvegarder; }, [sauvegarder]);

  const scheduleAutoSave = useCallback(()=>{
    if(autoRef.current) clearTimeout(autoRef.current);
    autoRef.current = setTimeout(()=>{
      saveRef.current?.({ silent:true });
    }, 900);
  },[]);

  // Sauvegarde avant fermeture/changement d'onglet pour ne pas perdre les dernières saisies.
  useEffect(()=>()=>{
    if(autoRef.current) { clearTimeout(autoRef.current); autoRef.current = null; }
    saveRef.current?.({ silent:true });
  },[]);

  // Auto-déclenche scheduleAutoSave dès qu'une donnée du simulateur change.
  const autoSaveBootRef = useRef(true);
  useEffect(() => {
    if (autoSaveBootRef.current) { autoSaveBootRef.current = false; return; }
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nom, clientId, prixAffiche, prixNegocie, budgetTravaux, tauxNotaire, surface,
    honoraires, enedis, taxeFonciere, assurance, compta, provisions,
    apport1, apport2, taux1, taux2, duree1, duree2,
    coefEtat, imprevusPct, gestionActive, modeDetention, tmi, selectedScen,
    lots, budgetQty, budgetPrice, customDivers,
    desc, travaux, atouts, adresse, photos, bienId,
  ]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const doReset = () => {
    setPrixAffiche(0);setPrixNegocie(0);setSurface(0);setBudgetTravaux(0);
    setHonoraires(0);setEnedis(0);setTaxeFonciere(0);setAssurance(0);setCompta(0);setProvisions(0);
    setApport1(0);setApport2(0);setTaux1(0);setTaux2(0);setDuree1(0);setDuree2(0);
    setCoefEtat(1);setImprevusPct(10);setGestionActive(false);setModeDetention("IS");setTmi(0.30);
    setLots([{type:"Sélectionner",m2:0,loyer:0,niveau:"RDC",comment:""}]);
    setDesc("");setTravaux("");setAtouts("");setAdresse("");setBienId("");setPhotos([null,null,null,null]);
    setCustomDivers([]);
    const b=initBudgetState([],0); setBudgetQty(b.qty); setBudgetPrice(b.price);
    setShowReset(false);
  };

  // ── Gestion lots ─────────────────────────────────────────────────────────────
  const addLot=()=>{if(lots.length>=MAX_LOTS)return;setLots([...lots,{type:"T2",m2:35,loyer:450,niveau:"RDC",comment:""}]);scheduleAutoSave();};
  const removeLot=(i)=>{if(lots.length<=1)return;setLots(lots.filter((_,idx)=>idx!==i));scheduleAutoSave();};
  const dupLot=(i)=>{if(lots.length>=MAX_LOTS)return;const n=[...lots];n.splice(i+1,0,{...lots[i]});setLots(n);scheduleAutoSave();};
  const updateLot=(i,k,v)=>{const n=[...lots];n[i]={...n[i],[k]:v};setLots(n);scheduleAutoSave();};

  // ── Export Excel ─────────────────────────────────────────────────────────────
  const exportXLSX = async()=>{
    const XLSX = await import("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").catch(()=>null);
    if(!XLSX){alert("Export Excel non disponible.");return;}
    // Fallback simple si XLSX non dispo
    alert("Pour exporter, utilisez le bouton Export depuis l'interface.");
  };

  // ── Fiche PDF ────────────────────────────────────────────────────────────────
  const genererFiche=()=>{
    const win=window.open("","_blank","width=900,height=700");
    if(!win){alert("Autorisez les pop-ups.");return;}
    const fmtN=v=>Math.round(v).toLocaleString("fr-FR");
    const esc=s=>String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const lotRows=aLots.map((l,i)=>`<tr><td>Appt ${i+1}${l.comment?` — <span style="color:#888;font-size:9px">${esc(l.comment)}</span>`:""}</td><td style="text-align:center">${esc(l.type)}</td><td style="text-align:center">${esc(l.niveau)||"—"}</td><td style="text-align:right">${l.m2} m²</td><td style="text-align:right;font-weight:700;color:#1a7a4a">${l.loyer.toLocaleString("fr-FR")} €</td></tr>`).join("");
    // Photo principale (index 0) si dispo
    const photoMain = photos && photos[0] ? photos[0] : null;
    // Map iframe Google Maps Embed si adresse renseignée
    const hasAddr = adresse && adresse.trim();
    const mapSrc = hasAddr ? `https://maps.google.com/maps?q=${encodeURIComponent(adresse)}&output=embed` : null;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fiche — ${esc(nom)}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica',sans-serif;background:white;padding:14mm;font-size:11px;color:#2c3040;}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1f4ea1;}
    .brand{font-size:16px;font-weight:800;color:#1a2d4a;}.title{font-size:18px;font-weight:800;color:#1a2d4a;}
    .addr{font-size:11px;color:#1f4ea1;margin-top:4px;display:flex;align-items:center;gap:4px}
    .addr svg{vertical-align:middle}
    .kpi-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
    .kpi{background:#f8f9fb;border-radius:7px;padding:9px 11px;border-left:3px solid #1f4ea1;}
    .kpi.green{border-left-color:#1a7a4a;}.kpi.gold{border-left-color:#c9a84c;}
    .kv{font-size:14px;font-weight:800;color:#1a2d4a;}.kv.green{color:#1a7a4a;}.kv.orange{color:#d4610a;}
    .kl{font-size:9px;font-weight:600;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;}
    .sec-hd{background:#1a2d4a;color:white;padding:5px 9px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border-radius:4px 4px 0 0;}
    .sec-bd{border:1px solid #eef0f5;border-top:none;border-radius:0 0 4px 4px;padding:9px 11px;}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
    .visu-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:12px;}
    .photo-block,.map-block{border:1px solid #eef0f5;border-radius:5px;overflow:hidden;}
    .photo-block img{width:100%;height:200px;object-fit:cover;display:block;}
    .map-block iframe{width:100%;height:200px;border:0;display:block;}
    .photo-cap,.map-cap{padding:5px 9px;font-size:9px;color:#5a6070;background:#f8f9fb;border-top:1px solid #eef0f5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;}
    table{width:100%;border-collapse:collapse;font-size:10px;}th{background:#1e3a5f;color:white;padding:4px 7px;text-align:left;font-size:9px;text-transform:uppercase;}
    td{padding:4px 7px;border-bottom:1px solid #eef0f5;}tr:nth-child(even) td{background:#f8f9fb;}
    .footer{border-top:1px solid #eef0f5;padding-top:7px;margin-top:12px;text-align:center;font-size:9px;color:#9aa0b0;}
    .no-print{position:fixed;top:14px;right:14px;display:flex;gap:7px;}
    .pbtn{padding:9px 18px;background:#1f4ea1;color:white;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer;}
    .cbtn{padding:9px 14px;background:#f8f9fb;color:#1a2d4a;border:1px solid #d8dce6;border-radius:5px;font-size:12px;cursor:pointer;}
    @media print{
      .no-print{display:none!important;}
      body{padding:0;}
      @page{size:A4;margin:14mm;}
      /* En impression, les iframes Google Maps deviennent souvent blanches —
         on remplace par une vignette statique via screenshot fallback */
      .map-block.print-fallback{background:#f0f4ff;display:flex;align-items:center;justify-content:center;font-size:11px;color:#1f4ea1;font-weight:700;padding:60px 20px;text-align:center;line-height:1.6}
    }
    </style></head><body>
    <div class="no-print"><button class="cbtn" onclick="window.close()">✕ Fermer</button><button class="pbtn" onclick="window.print()">🖨️ Imprimer / PDF</button></div>
    <div class="hd">
      <div class="brand">🏢 Profero Invest</div>
      <div style="text-align:right">
        <div class="title">${esc(nom)}</div>
        <div style="font-size:11px;color:#1f4ea1;margin-top:3px">Analyse de Rentabilité · ${new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</div>
        ${hasAddr ? `<div class="addr">📍 ${esc(adresse)}</div>` : ""}
      </div>
    </div>
    <div class="kpi-bar">
      <div class="kpi green"><div class="kv green">${(rb*100).toFixed(2)} %</div><div class="kl">Rendement brut</div></div>
      <div class="kpi green"><div class="kv green">${(rn*100).toFixed(2)} %</div><div class="kl">Rendement net</div></div>
      <div class="kpi ${cfm1>=0?"green":""}"><div class="kv ${cfm1>=0?"green":"orange"}">${fmtN(cfm1)} €/mois</div><div class="kl">Cash-flow S1</div></div>
      <div class="kpi"><div class="kv">${fmtN(coutTotal)} €</div><div class="kl">Coût total</div></div>
      <div class="kpi gold"><div class="kv">${fmtN(totLoyer)} €/mois</div><div class="kl">Loyers mensuels</div></div>
    </div>
    ${(photoMain || mapSrc) ? `<div class="visu-grid">
      ${photoMain ? `<div class="photo-block">
        <img src="${photoMain}" alt="Photo principale"/>
        <div class="photo-cap">📷 Photo principale</div>
      </div>` : `<div class="photo-block" style="background:#f8f9fb;display:flex;align-items:center;justify-content:center;color:#9aa0b0;font-size:10px;font-style:italic;min-height:200px">Aucune photo principale</div>`}
      ${mapSrc ? `<div class="map-block">
        <iframe src="${mapSrc}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
        <div class="map-cap">🗺️ ${esc(adresse)}</div>
      </div>` : `<div class="map-block" style="background:#f8f9fb;display:flex;align-items:center;justify-content:center;color:#9aa0b0;font-size:10px;font-style:italic;min-height:200px">Adresse non renseignée</div>`}
    </div>` : ""}
    <div class="grid-2" style="margin-bottom:12px">
      <div><div class="sec-hd">🏢 Acquisition</div><div class="sec-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 10px">
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Prix négocié</div><div style="font-weight:700">${fmtN(prixNegocie)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Budget travaux</div><div style="font-weight:700">${fmtN(budgetTravaux)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Surface</div><div style="font-weight:700">${surface} m²</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Coût total</div><div style="font-weight:700;color:#1a7a4a">${fmtN(coutTotal)} €</div></div>
        </div>
        ${desc?`<div style="margin-top:7px;padding:5px 7px;background:#f0f4ff;border-radius:4px;border-left:3px solid #1f4ea1;font-size:10px;color:#5a6070;line-height:1.5">${esc(desc)}</div>`:""}
      </div></div>
      <div><div class="sec-hd">🏘️ Lots (${aLots.length})</div><div class="sec-bd" style="padding:0">
        <table><thead><tr><th>Lot</th><th>Type</th><th>Niv.</th><th>m²</th><th>Loyer</th></tr></thead>
        <tbody>${lotRows}<tr style="background:#1a2d4a"><td colspan="4" style="color:white;font-weight:700;padding:4px 7px">TOTAL</td><td style="text-align:right;color:#50c878;font-weight:700;padding:4px 7px">${fmtN(totLoyer)} €</td></tr></tbody></table>
      </div></div>
    </div>
    <div class="footer">Profero Invest · Document confidentiel · ${new Date().toLocaleDateString("fr-FR")}</div>
    </body></html>`);
    win.document.close();
  };

  // ── Fiche de Présentation Client ─────────────────────────────────────────────
  // Vue commerciale séduisante destinée à être partagée avec un client investisseur.
  // Cache les infos sensibles (prix négocié, budget travaux, marges) et met en
  // avant les indicateurs vendeurs (rendement, cash-flow, loyers, photos, map).
  const genererFicheClient = () => {
    const client = clientId ? clientsList.find(c => c.id === clientId) : null;
    const clientFullName = client ? `${client.prenom||""} ${client.nom||""}`.trim() : "";
    const lotsPDF = aLots.map((l, i) => ({
      type: l.type,
      niveau: l.niveau,
      m2: l.m2,
      loyer: l.loyer,
      gestion: gestionActive ? (GESTION_PRICES[l.type] || 0) : 0,
      comment: l.comment || "",
    }));

    openFicheClientInvestisseurPDF({
      title: nom,
      subtitle: "Analyse de Rentabilité",
      client: clientFullName,
      address: adresse,
      dateEdition: new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" }),
      lots: lotsPDF,
      surface,
      logements: aLots.length,
      prixAchat: prixNegocie,
      budgetTravaux,
      coutTotal,
      totLoyer,
      totLoyerAn,
      chargesAnnuelles: totCharges,
      annuiteS1: ann1,
      mensualiteS1: m1,
      cashflowS1: cfm1,
      rendementBrutPct: rb * 100,
      rendementNetPct: rn * 100,
      pointEquilibreMois: pe1 * 12,
      margeSecuritePct: (1 - pe1) * 100,
      totalGestionMois: totGestMois,
      apportS1: apport1,
      tauxS1: taux1,
      dureeS1: duree1,
      description: desc || "Projet d’investissement immobilier analysé par Profero Invest.",
      travaux: travaux || (budgetTravaux > 0 ? `Budget travaux estimé : ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(budgetTravaux)} €.` : "Travaux à préciser après validation technique et devis."),
      atouts: atouts || `Rentabilité brute estimée à ${(rb*100).toFixed(2).replace(".", ",")} %. Cash-flow S1 estimé à ${new Intl.NumberFormat("fr-FR", {maximumFractionDigits:0}).format(cfm1)} €/mois.`,
      recommandation: cfSel >= 0 && rb >= 0.08 ? "Opportunité à approfondir" : "Analyse à confirmer",
    });
  };

  // ── Champ numérique : utilise NumInput (défini top-level) ──────────────────

  // ── Photo handlers ───────────────────────────────────────────────────────────
  const handlePhoto=(i,file)=>{
    if(!file||file.size>5*1024*1024){alert("Photo max 5 Mo");return;}
    const r=new FileReader();
    r.onload=e=>{const p=[...photos];p[i]=e.target.result;setPhotos(p);scheduleAutoSave();};
    r.readAsDataURL(file);
  };

  const PHOTO_LABELS=["Photo principale","Vue intérieure","Vue extérieure","Autre"];

  // Thème dynamique (suit le toggle de la sidebar) — le CSS de la page parente
  // s'applique déjà via <style>{CSS}</style>, mais on a besoin de T ici pour
  // les inline styles de la topbar.
  const T = THEMES_INV[theme] || THEMES_INV.dark;
  const localCSS = getCSS(T);
  const switchTheme = () => {
    if (!setTheme) return;
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("invest_theme", next);
  };
  return (
    <div className="inv" style={isEmbedded
      ? {display:"flex",flexDirection:"column",background:T.bg,borderRadius:RADIUS.xl,overflow:"hidden",minHeight:760}
      : {position:"fixed",inset:0,zIndex:9999,display:"flex",flexDirection:"column",background:T.bg}
    }>
      <style>{localCSS}</style>

      {/* Topbar moderne — fond sombre avec accent bleu (au lieu du navy/doré vintage) */}
      <div style={{
        background:T.sidebar,borderBottom:`1px solid ${T.sidebarBorder}`,
        padding:`${SPACING.sm+2}px ${SPACING.xl-4}px`,
        display:"flex",alignItems:"center",gap:SPACING.md,flexShrink:0,
        boxShadow:T.shadowSm,
      }}>
        {!isEmbedded && (
          <>
            <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}>
              <Icon as={ArrowLeft} size={13} strokeWidth={2.2}/>
              Projets
            </button>
            <div style={{width:1,height:20,background:T.border}}/>
          </>
        )}
        <span style={{fontSize:FONT.xs.size,letterSpacing:1.8,textTransform:"uppercase",color:T.accent,fontWeight:700}}>
          Profero Invest
        </span>
        <input
          value={nom} onChange={e=>{setNom(e.target.value);scheduleAutoSave();}}
          style={{
            background:T.input,border:`1px solid ${T.inputBorder}`,
            borderRadius:RADIUS.md,padding:`${SPACING.xs+1}px ${SPACING.md}px`,
            color:T.text,fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:FONT.base.size,fontWeight:700,outline:"none",minWidth:200,
            transition:"all .15s",
          }}
          onFocus={e=>{e.target.style.borderColor=T.accent; e.target.style.boxShadow=`0 0 0 3px ${T.accentBg}`;}}
          onBlur={e=>{e.target.style.borderColor=T.inputBorder; e.target.style.boxShadow="none";}}
        />
        {/* Sélecteur client lié (optionnel) */}
        <span style={{fontSize:FONT.xs.size,color:T.textMuted,letterSpacing:1.2,textTransform:"uppercase",fontWeight:700}}>Client</span>
        <select
          value={clientId}
          onChange={e=>{setClientId(e.target.value); scheduleAutoSave();}}
          style={{
            background: clientId ? T.accentBg : T.input,
            border:`1px solid ${clientId ? T.accentBorder : T.inputBorder}`,
            borderRadius:RADIUS.md,padding:`${SPACING.xs+1}px ${SPACING.md}px`,
            color: clientId ? T.accent : T.textSub,
            fontFamily:"'Barlow Condensed',sans-serif",fontSize:FONT.sm.size+1,
            fontWeight:600,outline:"none",cursor:"pointer",minWidth:170,
          }}
        >
          <option value="">— Aucun —</option>
          {clientsList.map(c => (
            <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
          ))}
        </select>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:SPACING.sm}}>
          {saving && (
            <span style={{fontSize:FONT.xs.size+1,color:T.textMuted,display:"inline-flex",alignItems:"center",gap:4}}>
              <Icon as={RefreshCw} size={11} strokeWidth={2.2} style={{animation:"spin 1s linear infinite"}}/>
              Sync…
            </span>
          )}
          {saved && !saving && (
            <span style={{fontSize:FONT.xs.size+1,color:SU,display:"inline-flex",alignItems:"center",gap:4,fontWeight:700}}>
              <Icon as={Check} size={12} strokeWidth={2.5}/> Sauvegardé
            </span>
          )}
          {setTheme && (
            <button onClick={switchTheme} title={theme==="dark" ? "Mode clair" : "Mode sombre"}
              className="inv-btn inv-btn-out inv-btn-sm" style={{padding:"5px 9px"}}>
              <Icon as={theme==="dark" ? Sun : Moon} size={13} strokeWidth={2.2}/>
            </button>
          )}
          <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={()=>setShowReset(true)}>
            <Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Reset
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-blue" onClick={genererFicheClient} title="Générer la fiche client investisseur">
            <Icon as={Sparkles} size={12} strokeWidth={2.2}/> Fiche client
          </button>
          <button className="inv-btn inv-btn-sm inv-btn-gold" onClick={sauvegarder}>
            <Icon as={Save} size={12} strokeWidth={2.2}/> Enregistrer
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Tabs nav */}
      <div className="inv-tab-nav">
        {[
          ["simulateur","Simulateur", BarChart3],
          ["budget","Budget Travaux", Hammer],
          ["fiscalite","Fiscalité", Briefcase],
        ].map(([k,l,IconComp])=>(
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}
            style={{display:"inline-flex",alignItems:"center",gap:6}}>
            <Icon as={IconComp} size={13} strokeWidth={2.2}/>
            {l}
          </button>
        ))}
      </div>

      {/* Contenu scrollable */}
      <div style={{flex:1,overflowY:"auto",background:T.bg}}>

        {/* ══ TAB SIMULATEUR ══ */}
        {tab==="simulateur"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            {/* KPIs */}
            <div className="inv-kpi-bar" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:18}}>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Coût total opération</div><div className="inv-kpi-val">{fmt(coutTotal)}</div></div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Rentabilité nette</div><div className="inv-kpi-val green">{fmtPct(rn)}</div></div>
              <div className="inv-kpi">
                <div className="inv-kpi-lbl">Cash-flow mensuel</div>
                <div className={`inv-kpi-val ${cfSel>0?"green":cfSel<0?"red":"orange"}`}>{fmt(cfSel)}</div>
                <div className="inv-scen-toggle">
                  <button className={`inv-scen-btn${selectedScen===1?" active":""}`} onClick={()=>setSelectedScen(1)}>S1</button>
                  <button className={`inv-scen-btn${selectedScen===2?" active":""}`} onClick={()=>setSelectedScen(2)}>S2</button>
                </div>
              </div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Point d'équilibre</div><div className="inv-kpi-val orange">{fmtMois(peSel*12)}</div></div>
              <div className="inv-kpi"><div className="inv-kpi-lbl">Marge de sécurité</div><div className={`inv-kpi-val ${(1-peSel)>.2?"green":(1-peSel)>0?"orange":"red"}`}>{fmtPct(1-peSel)}</div></div>
            </div>

            <div className="inv-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {/* Colonne gauche */}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* A — Acquisition */}
                <div className="inv-card">
                  <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Home} size={13} strokeWidth={2.2}/>A — Acquisition</span></div>
                  <div className="inv-card-bd">
                    {[
                      ["Prix affiché (€)", prixAffiche, setPrixAffiche],
                      ["Prix négocié (€)", prixNegocie, setPrixNegocie],
                    ].map(([label,val,set])=>(
                      <div key={label} className="inv-row"><span className="inv-lbl">{label}</span><NumInput value={val} onChange={set}/></div>
                    ))}
                    <div className="inv-row"><span className="inv-lbl">Négociation obtenue</span><span className="inv-val calc">{fmtPct(prixAffiche>0?(prixAffiche-prixNegocie)/prixAffiche:0)}</span></div>
                    <div className="inv-row">
                      <span className="inv-lbl">Taux frais notaire</span>
                      <select className="inv-sel" value={tauxNotaire} onChange={e=>{setTauxNotaire(parseFloat(e.target.value));scheduleAutoSave();}}>
                        <option value="0.08">8% (ancien)</option><option value="0.03">3% (neuf)</option>
                        <option value="0.025">2,5%</option><option value="0.07">7%</option>
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">Frais de notaire</span><span className="inv-val calc">{fmt(fn)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Surface totale (m²)</span><NumInput value={surface} onChange={setSurface}/></div>
                    <div className="inv-row"><span className="inv-lbl">Prix d'achat / m²</span><span className="inv-val calc">{surface>0?(prixAchat/surface).toFixed(0)+" €/m²":"—"}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Budget travaux TTC (€)</span><NumInput value={budgetTravaux} onChange={setBudgetTravaux}/></div>
                    <div className="inv-row"><span className="inv-lbl">Honoraires (€)</span><NumInput value={honoraires} onChange={setHonoraires}/></div>
                    <div className="inv-row"><span className="inv-lbl">Raccordement Enedis (€)</span><NumInput value={enedis} onChange={setEnedis}/></div>
                    <div className="inv-row total"><span className="inv-lbl bold">COÛT TOTAL OPÉRATION</span><span className="inv-val green">{fmt(coutTotal)}</span></div>
                  </div>
                </div>

                {/* C — Charges */}
                <div className="inv-card">
                  <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={FileText} size={13} strokeWidth={2.2}/>C — Charges d'Exploitation</span></div>
                  <div className="inv-card-bd">
                    {[["Taxe foncière (€/an)",taxeFonciere,setTaxeFonciere],["Assurance PNO (€/an)",assurance,setAssurance],["Comptabilité société (€/an)",compta,setCompta],["Provisions travaux (€/an)",provisions,setProvisions]].map(([l,v,s])=>(
                      <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><NumInput value={v} onChange={s}/></div>
                    ))}
                    <div className="inv-row sub"><span className="inv-lbl">Frais gestion locative (€/an)</span><span className="inv-val calc">{gestionActive?fmt(totGestAn):"0 €"}</span></div>
                    <div className="inv-row total"><span className="inv-lbl bold">TOTAL CHARGES (€/an)</span><span className="inv-val orange">{fmt(totCharges)}</span></div>
                  </div>
                </div>
              </div>

              {/* Colonne droite */}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* B — Lots */}
                <div className="inv-card">
                  <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13} strokeWidth={2.2}/>B — Lots & Loyers</span></div>
                  <div className="inv-card-bd">
                    <div className="inv-toggle-wrap">
                      <label className="inv-toggle">
                        <input type="checkbox" checked={gestionActive} onChange={e=>{setGestionActive(e.target.checked);scheduleAutoSave();}}/>
                        <span className="inv-toggle-sl"/>
                      </label>
                      <span style={{fontSize:12,fontWeight:600,color:"#5a6070"}}>Gestion locative externalisée</span>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <div className="inv-lot-grid hd">
                        <div>Type</div><div>m²</div><div>Niveau</div><div>Loyer/mois</div>
                        <div>Loyer/an</div><div>€/m²</div><div>Gestion</div><div>Note</div><div/>
                      </div>
                      {lots.map((lot,i)=>{
                        const gP=gestionActive?(GESTION_PRICES[lot.type]||0):0;
                        return (
                          <div key={i} className="inv-lot-grid">
                            <select className="inv-sel" value={lot.type} style={{fontSize:11,padding:"4px 5px"}}
                              onChange={e=>updateLot(i,"type",e.target.value)}>
                              {LOT_TYPES.map(t=><option key={t}>{t}</option>)}
                            </select>
                            <input type="number" className="inv-inp" value={lot.m2} style={{fontSize:12,padding:"4px 6px"}}
                              onChange={e=>updateLot(i,"m2",parseFloat(e.target.value)||0)}/>
                            <select className="inv-sel" value={lot.niveau||"RDC"} style={{fontSize:11,padding:"4px 5px"}}
                              onChange={e=>updateLot(i,"niveau",e.target.value)}>
                              {NIVEAUX.map(n=><option key={n}>{n}</option>)}
                            </select>
                            <input type="number" className="inv-inp" value={lot.loyer} style={{fontSize:12,padding:"4px 6px"}}
                              onChange={e=>updateLot(i,"loyer",parseFloat(e.target.value)||0)}/>
                            <div className="inv-lot-val">{fmt(lot.loyer*12)}</div>
                            <div className="inv-lot-val">{lot.m2>0?(lot.loyer/lot.m2).toFixed(2):"—"}</div>
                            <div className="inv-lot-val" style={{color:gestionActive?"#d4610a":"#9aa0b0"}}>{gestionActive?fmt(gP):"—"}</div>
                            <input type="text" className="inv-inp" value={lot.comment||""} placeholder="Note…"
                              style={{fontSize:11,padding:"3px 6px",textAlign:"left",background:"#f8f9fb",borderColor:"#d8dce6"}}
                              onChange={e=>updateLot(i,"comment",e.target.value)}/>
                            <div style={{display:"flex",gap:2}}>
                              <button className="inv-rm" title="Dupliquer" style={{color:"#1f4ea1",fontSize:13}} onClick={()=>dupLot(i)}>⧉</button>
                              <button className="inv-rm" onClick={()=>removeLot(i)}>×</button>
                            </div>
                          </div>
                        );
                      })}
                      {/* Total */}
                      <div className="inv-lot-grid" style={{fontWeight:700,fontSize:12,color:"#1a2d4a"}}>
                        <div style={{gridColumn:"1/3"}}>TOTAL</div><div/><div/>
                        <div className="inv-lot-val" style={{color:"#1a7a4a",fontWeight:700}}>{fmt(totLoyer)}</div>
                        <div className="inv-lot-val" style={{color:"#1a7a4a",fontWeight:700}}>{fmt(totLoyerAn)}</div>
                        <div/><div className="inv-lot-val" style={{color:"#d4610a",fontWeight:700}}>{gestionActive?fmt(totGestMois):"—"}</div>
                        <div/><div/>
                      </div>
                    </div>
                    {lots.length<MAX_LOTS&&(
                      <button className="inv-add-lot" onClick={addLot}>＋ Ajouter un lot</button>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="inv-card">
                  <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Pencil} size={13} strokeWidth={2.2}/>Description du Projet</span></div>
                  <div className="inv-card-bd" style={{display:"flex",flexDirection:"column",gap:10}}>
                    {/* Adresse + bouton Lier à un bien */}
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:5}}>Adresse du bien</label>
                      <div style={{display:"flex",gap:6}}>
                        <input className="inv-inp" value={adresse}
                          onChange={e=>setAdresse(e.target.value)}
                          placeholder="123 rue de la Paix, 49000 Angers"
                          style={{flex:1, textAlign:"left"}}/>
                        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>setShowLierBien(true)} title="Importer depuis un bien du stock">
                          <Icon as={Building2} size={12} strokeWidth={2.2}/> Lier
                        </button>
                      </div>
                      {bienId && (() => {
                        const b = biensList.find(x => x.id === bienId);
                        return b ? (
                          <div style={{marginTop:6, fontSize:11, color:T.accent, display:"inline-flex", alignItems:"center", gap:5}}>
                            <Icon as={Building2} size={11} strokeWidth={2.2}/>
                            Lié au bien : <strong>{b.adresse}</strong>{b.ville ? ` — ${b.ville}` : ""}
                            <button onClick={()=>setBienId("")} title="Délier" style={{background:"transparent",border:"none",color:T.textMuted,cursor:"pointer",padding:"0 4px"}}>×</button>
                          </div>
                        ) : null;
                      })()}
                    </div>
                    {[["Description générale","Localisation, contexte…",desc,setDesc],["Travaux envisagés","Rénovation toiture, électricité…",travaux,setTravaux],["Atouts / Points de vigilance","Emplacement, potentiel, risques…",atouts,setAtouts]].map(([label,ph,val,set])=>(
                      <div key={label}>
                        <label style={{fontSize:10,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:5}}>{label}</label>
                        <textarea className="inv-textarea" rows={2} placeholder={ph} value={val}
                          onChange={e=>{set(e.target.value);scheduleAutoSave();}}/>
                      </div>
                    ))}
                    {/* Photos */}
                    <div>
                      <label style={{fontSize:10,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:1.2,display:"block",marginBottom:8}}>Photos du bien</label>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {photos.map((photo,i)=>(
                          <div key={i}>
                            <div style={{fontSize:9,fontWeight:700,color:"#9aa0b0",textTransform:"uppercase",letterSpacing:.8,marginBottom:4}}>{PHOTO_LABELS[i]}</div>
                            <div className={`inv-photo-zone${photo?" has-photo":""}`}
                              onClick={()=>document.getElementById(`photo-input-${i}`).click()}>
                              {photo
                                ? <>
                                    <img src={photo} alt={`Photo ${i+1}`} style={{width:"100%",height:90,objectFit:"cover"}}/>
                                    <div className="inv-photo-actions">
                                      <button style={{background:"rgba(0,0,0,.55)",color:"white",border:"none",borderRadius:3,padding:"3px 7px",fontSize:10,cursor:"pointer"}}
                                        onClick={e=>{e.stopPropagation();const p=[...photos];p[i]=null;setPhotos(p);}}>✕</button>
                                    </div>
                                  </>
                                : <>
                                    <span style={{fontSize:22}}>📷</span>
                                    <span style={{fontSize:11,fontWeight:600,color:"#9aa0b0",textAlign:"center"}}>Cliquer ou glisser</span>
                                  </>
                              }
                            </div>
                            <input id={`photo-input-${i}`} type="file" accept="image/*" style={{display:"none"}}
                              onChange={e=>handlePhoto(i,e.target.files[0])}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Localisation — map iframe Google Maps Embed (gratuit, sans clé API) */}
                {adresse && (
                  <div className="inv-card">
                    <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={MapPin} size={13} strokeWidth={2.2}/>Localisation</span></div>
                    <div className="inv-card-bd" style={{padding:0}}>
                      <iframe
                        title="Carte du bien"
                        src={`https://maps.google.com/maps?q=${encodeURIComponent(adresse)}&output=embed`}
                        width="100%" height="280"
                        style={{border:0, display:"block"}}
                        loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                      />
                      <div style={{padding:`${SPACING.sm+2}px ${SPACING.lg}px`, borderTop:`1px solid ${T.border}`, fontSize:FONT.sm.size, color:T.textSub, display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.sm}}>
                        <span>{adresse}</span>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`}
                          target="_blank" rel="noreferrer"
                          style={{color:T.accent, fontSize:FONT.xs.size+1, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4, textDecoration:"none"}}>
                          Ouvrir dans Maps <Icon as={ExternalLink} size={11} strokeWidth={2.2}/>
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* D+E — Financement + Rentabilité */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:16}}>
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Wallet} size={13} strokeWidth={2.2}/>D — Plan de Financement</span></div>
                <div className="inv-card-bd">
                  <div className="inv-scen-hd"><div>Paramètre</div><div style={{textAlign:"right"}}>Scénario 1</div><div style={{textAlign:"right"}}>Scénario 2</div></div>
                  <div className="inv-scen-row"><div className="inv-lbl">Montant opération</div><div className="inv-s">{fmt(coutTotal)}</div><div className="inv-s">{fmt(coutTotal)}</div></div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Apport (€)</div>
                    <div><input type="number" className="inv-inp" value={apport1} style={{width:95,fontSize:12,padding:"4px 6px"}} onChange={e=>{setApport1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={apport2} style={{width:95,fontSize:12,padding:"4px 6px"}} onChange={e=>{setApport2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row"><div className="inv-lbl">À financer</div><div className="inv-s">{fmt(af1)}</div><div className="inv-s">{fmt(af2)}</div></div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Taux TAEG (%)</div>
                    <div><input type="number" className="inv-inp" value={taux1} step="0.01" style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setTaux1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={taux2} step="0.01" style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setTaux2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row">
                    <div className="inv-lbl">Durée (années)</div>
                    <div><input type="number" className="inv-inp" value={duree1} style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setDuree1(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={duree2} style={{width:75,fontSize:12,padding:"4px 6px"}} onChange={e=>{setDuree2(parseFloat(e.target.value)||0);scheduleAutoSave();}}/></div>
                  </div>
                  <div className="inv-scen-row hl"><div className="inv-lbl bold">Mensualité</div><div className="inv-s green">{fmt(m1)}</div><div className="inv-s green">{fmt(m2)}</div></div>
                  <div className="inv-scen-row"><div className="inv-lbl">Annuité</div><div className="inv-s">{fmt(ann1)}</div><div className="inv-s">{fmt(ann2)}</div></div>
                </div>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div className="inv-card">
                  <div className="inv-card-hd gold"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={TrendingUp} size={13} strokeWidth={2.2}/>E — Rentabilité</span></div>
                  <div className="inv-card-bd">
                    <div className="inv-scen-hd"><div>Indicateur</div><div style={{textAlign:"right"}}>S1</div><div style={{textAlign:"right"}}>S2</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Loyers bruts annuels</div><div className="inv-s">{fmt(totLoyerAn)}</div><div className="inv-s"></div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Rentabilité brute</div><div className="inv-s">{fmtPct(rb)}</div><div className="inv-s"></div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Rentabilité nette</div><div className="inv-s green">{fmtPct(rn)}</div><div className="inv-s green">{fmtPct(rn)}</div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Cash-flow mensuel</div><div className={`inv-s ${cfm1>0?"green":cfm1<0?"orange":""}`}>{fmt(cfm1)}</div><div className={`inv-s ${cfm2>0?"green":cfm2<0?"orange":""}`}>{fmt(cfm2)}</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Cash-flow annuel</div><div className="inv-s">{fmt(cfm1*12)}</div><div className="inv-s">{fmt(cfm2*12)}</div></div>
                  </div>
                </div>
                <div className="inv-card">
                  <div className="inv-card-hd danger"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={AlertTriangle} size={13} strokeWidth={2.2}/>F — Point d'Équilibre</span></div>
                  <div className="inv-card-bd">
                    <div className="inv-scen-hd"><div>Indicateur</div><div style={{textAlign:"right"}}>S1</div><div style={{textAlign:"right"}}>S2</div></div>
                    <div className="inv-scen-row warn"><div className="inv-lbl bold">Point d'équilibre (%)</div><div className="inv-s orange">{fmtPct(pe1)}</div><div className="inv-s orange">{fmtPct(pe2)}</div></div>
                    <div className="inv-scen-row warn"><div className="inv-lbl bold">Point d'équilibre (mois)</div><div className="inv-s orange">{fmtMois(pe1*12)}</div><div className="inv-s orange">{fmtMois(pe2*12)}</div></div>
                    <div className="inv-scen-row hl"><div className="inv-lbl bold">Marge de sécurité</div><div className="inv-s green">{fmtPct(1-pe1)}</div><div className="inv-s green">{fmtPct(1-pe2)}</div></div>
                    <div className="inv-scen-row"><div className="inv-lbl">Loyer minimum viable</div><div className="inv-s">{fmt(ct1/12)}</div><div className="inv-s">{fmt(ct2/12)}</div></div>
                  </div>
                </div>
              </div>
            </div>

            {/* G — Fiscalité rapide */}
            <div className="inv-card" style={{marginTop:16}}>
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13} strokeWidth={2.2}/>G — Fiscalité Rapide (Scénario 1)</span></div>
              <div className="inv-card-bd">
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                  <div>
                    <div className="inv-row"><span className="inv-lbl">Mode de détention</span>
                      <select className="inv-sel" value={modeDetention} onChange={e=>{setModeDetention(e.target.value);scheduleAutoSave();}}>
                        <option value="IS">SCI à l'IS</option><option value="IR">SCI à l'IR</option><option value="LMNP">LMNP au réel</option>
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">TMI du foyer</span>
                      <select className="inv-sel" value={tmi} onChange={e=>{setTmi(parseFloat(e.target.value));scheduleAutoSave();}}>
                        {[0,0.11,0.30,0.41,0.45].map(v=><option key={v} value={v}>{(v*100).toFixed(0)}%</option>)}
                      </select>
                    </div>
                    <div className="inv-row"><span className="inv-lbl">Résultat avant impôt (€/an)</span><span className="inv-val calc">{fmt(res)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">Impôt estimé (€/an)</span><span className="inv-val calc">{fmt(impotRapide)}</span></div>
                  </div>
                  <div>
                    <div className="inv-row"><span className="inv-lbl">CF net après impôt (€/an)</span><span className="inv-val green">{fmt(cfNetRapide)}</span></div>
                    <div className="inv-row"><span className="inv-lbl">CF net après impôt (€/mois)</span><span className="inv-val green">{fmt(cfNetRapide/12)}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB BUDGET ══ */}
        {tab==="budget"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Settings} size={13} strokeWidth={2.2}/>Paramètres</span></div>
                <div className="inv-card-bd">
                  {[["Surface totale",surface+" m²"],["Logements",actLots(lots).length],["Studios",lots.filter(l=>l.type==="Studio").length],["T1",lots.filter(l=>l.type==="T1").length],["T2",lots.filter(l=>l.type==="T2").length],["T3",lots.filter(l=>l.type==="T3").length],["T4+",lots.filter(l=>["T4","T5","T6"].includes(l.type)).length]].map(([l,v])=>(
                    <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val calc">{v}</span></div>
                  ))}
                </div>
              </div>
              <div className="inv-card">
                <div className="inv-card-hd mid"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Building2} size={13} strokeWidth={2.2}/>Coefficient État Général</span></div>
                <div className="inv-card-bd">
                  {[["Bon état général","× 0,70","#1a7a4a"],["État moyen","× 1,00","#2c3040"],["Mauvais état","× 1,30","#d4610a"],["Passoire / ruine","× 1,60","#c0392b"]].map(([l,v,c])=>(
                    <div key={l} className="inv-row"><span className="inv-lbl">{l}</span><span className="inv-val" style={{color:c}}>{v}</span></div>
                  ))}
                  <div className="inv-row total">
                    <span className="inv-lbl bold">▶ Coefficient retenu</span>
                    <input type="number" className="inv-inp" value={coefEtat} step="0.05" min="0.5" max="2" style={{width:80}}
                      onChange={e=>{setCoefEtat(parseFloat(e.target.value)||1);scheduleAutoSave();}}/>
                  </div>
                </div>
              </div>
            </div>

            <div className="inv-card">
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Hammer} size={13} strokeWidth={2.2}/>Détail par Corps de Métier</span></div>
              <div className="inv-card-bd">
                <div className="inv-brow hd">
                  <div>Corps de métier</div><div style={{textAlign:"center"}}>Base</div>
                  <div style={{textAlign:"right"}}>Qté</div><div style={{textAlign:"right"}}>Prix unit.</div><div style={{textAlign:"right"}}>Total HT</div>
                </div>
                {BUDGET_SECTIONS.map(sec=>(
                  <React.Fragment key={sec.id}>
                    <div className="inv-bsec">{sec.sec}</div>
                    {sec.items.map(item=>{
                      const tot=(budgetQty[item.id]||0)*(budgetPrice[item.id]||0);
                      return (
                        <div key={item.id} className="inv-brow">
                          <div className="bl">{item.label}</div>
                          <div style={{textAlign:"center",fontSize:11,color:"#9aa0b0"}}>{item.base}</div>
                          <div><input type="number" className="inv-inp" value={budgetQty[item.id]||0} min="0"
                            style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                            onChange={e=>{setBudgetQty(q=>({...q,[item.id]:parseFloat(e.target.value)||0}));scheduleAutoSave();}}/></div>
                          <div><input type="number" className="inv-inp" value={budgetPrice[item.id]||0} min="0"
                            style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                            onChange={e=>{setBudgetPrice(p=>({...p,[item.id]:parseFloat(e.target.value)||0}));scheduleAutoSave();}}/></div>
                          <div className="bn" style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12}}>{fmt(tot)}</div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {/* Lignes personnalisées */}
                {customDivers.map((cd,ci)=>(
                  <div key={ci} className="inv-brow">
                    <div><input type="text" className="inv-inp" value={cd.label||""} placeholder="Désignation"
                      style={{width:"100%",fontSize:12,padding:"3px 6px",textAlign:"left"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],label:e.target.value};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div style={{textAlign:"center",fontSize:11,color:"#9aa0b0"}}>unité</div>
                    <div><input type="number" className="inv-inp" value={cd.qty||0} min="0"
                      style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],qty:parseFloat(e.target.value)||0};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div><input type="number" className="inv-inp" value={cd.price||0} min="0"
                      style={{width:"100%",fontSize:12,padding:"3px 6px"}}
                      onChange={e=>{const n=[...customDivers];n[ci]={...n[ci],price:parseFloat(e.target.value)||0};setCustomDivers(n);scheduleAutoSave();}}/></div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:12}}>{fmt((cd.qty||0)*(cd.price||0))}</span>
                      <button className="inv-rm" onClick={()=>{setCustomDivers(customDivers.filter((_,j)=>j!==ci));scheduleAutoSave();}}>×</button>
                    </div>
                  </div>
                ))}
                <button className="inv-add-lot" style={{marginTop:8}}
                  onClick={()=>{setCustomDivers([...customDivers,{label:"",qty:1,price:0}]);}}>
                  ＋ Ligne personnalisée
                </button>

                {/* Imprévus */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0 4px",borderTop:"1px solid #d8dce6",marginTop:8,gap:8}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#d4610a"}}>Provision imprévus</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <input type="number" className="inv-inp" value={imprevusPct} min="0" max="50" style={{width:60,borderColor:"#d4610a"}}
                      onChange={e=>{setImprevusPct(parseFloat(e.target.value)||0);scheduleAutoSave();}}/>
                    <span style={{fontSize:12,color:"#d4610a",fontWeight:600}}>%</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"#d4610a",minWidth:90,textAlign:"right"}}>{fmt(budgetImp)}</span>
                  </div>
                </div>

                {/* Totaux */}
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"6px 0",borderTop:"2px solid #1a2d4a",marginTop:5,fontSize:12,fontWeight:700,color:"#1a2d4a"}}>
                  <div>Sous-total HT + imprévus</div><div style={{fontFamily:"'DM Mono',monospace"}}>{fmt(budgetSub+budgetImp)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"4px 0",fontSize:12,fontWeight:600,color:"#1e3a5f"}}>
                  <div>× Coefficient état (×{coefEtat.toFixed(2).replace(".",",")})</div><div style={{fontFamily:"'DM Mono',monospace"}}>{fmt(budgetCoef)}</div>
                </div>
                <div style={{background:"#1a2d4a",margin:"7px -16px 0",padding:"10px 16px",borderRadius:"0 0 10px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:"white",fontSize:13,fontWeight:800}}>TOTAL TTC (TVA 10%)</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#c9a84c"}}>{fmt(budgetTTC)}</span>
                </div>
                <div style={{display:"flex",gap:20,marginTop:12,paddingTop:10,borderTop:"1px solid #eef0f5"}}>
                  <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:.6,color:"#9aa0b0"}}>Budget HT/m²</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#1a2d4a"}}>{surface>0?Math.round(budgetCoef/surface)+" €/m²":"—"}</div></div>
                  <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:.6,color:"#9aa0b0"}}>Budget TTC/m²</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:"#1a2d4a"}}>{surface>0?Math.round(budgetTTC/surface)+" €/m²":"—"}</div></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB FISCALITÉ ══ */}
        {tab==="fiscalite"&&(
          <div style={{padding:"18px 22px",maxWidth:1200,margin:"0 auto"}}>
            {/* Comparatif */}
            <div className="inv-card" style={{marginBottom:16}}>
              <div className="inv-card-hd"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Briefcase} size={13} strokeWidth={2.2}/>Comparatif des Régimes Fiscaux</span></div>
              <div className="inv-card-bd" style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr>
                    <th style={{textAlign:"left",padding:8,borderBottom:"2px solid #d8dce6",color:"#9aa0b0",fontSize:10,textTransform:"uppercase",letterSpacing:.5}}>Critère</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #1e3a5f",color:"#1e3a5f",background:"rgba(30,58,95,.04)"}}>SCI à l'IS</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #6b3a8a",color:"#6b3a8a",background:"rgba(107,58,138,.04)"}}>SCI à l'IR</th>
                    <th style={{textAlign:"center",padding:8,borderBottom:"2px solid #1a7a4a",color:"#1a7a4a",background:"rgba(26,122,74,.04)"}}>LMNP (réel)</th>
                  </tr></thead>
                  <tbody>
                    {COMP_FISCA.map((r,i)=>(
                      <tr key={i} style={{background:i%2===0?"rgba(255,255,255,0.03)":"transparent"}}>
                        <td style={{padding:8,fontWeight:600,color:"#e8eaf0",borderBottom:"1px solid #2a2d3a"}}>{r[0]}</td>
                        {[1,2,3].map(j=><td key={j} style={{padding:8,textAlign:"center",borderBottom:"1px solid #2a2d3a"}}>{r[j]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3 régimes */}
            <div className="inv-fisca-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
              {/* IS */}
              <div className="inv-regime">
                <div className="inv-regime-hd is">🏢 SCI à l'IS</div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges exploitation",fmt(totCharges)],["− Intérêts emprunt ~70%",fmt(ann1*.7)],["− Amortissement bien /30 ans",fmt(ab)],[" Résultat imposable",fmt(rIS),rIS<0?"warn":""],["IS tranche 1 (15%)",fmt(isT1)],["IS tranche 2 (25%)",fmt(isT2)],["IS total",fmt(isT1+isT2)],["CF net annuel après IS",fmt(cfIS),"hl"],["CF net mensuel",fmt(cfIS/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
              {/* IR */}
              <div className="inv-regime">
                <div className="inv-regime-hd ir"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={Users} size={13} strokeWidth={2.2}/>SCI à l'IR</span></div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges déductibles",fmt(totCharges)],["− Intérêts emprunt ~70%",fmt(ann1*.7)],[" Revenu foncier net",fmt(rf),rf<0?"warn":""],["Impôt IR (TMI)",fmt(irImp)],["Prélèvements sociaux 17,2%",fmt(irPS)],["Total imposition",fmt(irImp+irPS)],["CF net annuel",fmt(cfIR),"hl"],["CF net mensuel",fmt(cfIR/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
              {/* LMNP */}
              <div className="inv-regime">
                <div className="inv-regime-hd lmnp">🏨 LMNP au Réel</div>
                {[["Loyers bruts",fmt(totLoyerAn)],["− Charges",fmt(totCharges)],["− Amortissement bien /30 ans",fmt(ab)],["− Amortissement travaux /10 ans",fmt(at)],[" Résultat imposable",fmt(rL),rL<0?"warn":""],["Déficit reportable",fmt(Math.min(rL,0)),rL<0?"hl":""],["Imposition BIC (TMI)",fmt(lImp)],["CF net annuel",fmt(cfL),"hl"],["CF net mensuel",fmt(cfL/12),"hl"]].map(([l,v,cls])=>(
                  <div key={l} className={`inv-regime-row ${cls||""}`}><div className="rl">{l}</div><div className="rv">{v}</div></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Lier à un bien */}
      {showLierBien && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}
          onClick={()=>setShowLierBien(false)}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl}px ${SPACING.xl+2}px`,maxWidth:560,width:"92%",maxHeight:"82vh",overflowY:"auto",boxShadow:T.shadowMd}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",gap:SPACING.md,marginBottom:SPACING.md}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.lg,flexShrink:0,
                background:T.accentBg, color:T.accent,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}><Icon as={Building2} size={20} strokeWidth={2}/></div>
              <div>
                <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text}}>Importer depuis un bien</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,marginTop:2}}>Auto-remplit adresse, prix de vente et budget travaux</div>
              </div>
            </div>
            {biensList.length === 0 ? (
              <div style={{textAlign:"center",padding:`${SPACING.lg}px 0`,color:T.textMuted,fontStyle:"italic"}}>
                Aucun bien dans le stock. Ajoute d'abord un bien depuis « Stock de biens ».
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {biensList.map(b => (
                  <button key={b.id}
                    onClick={()=>{
                      const addr = [b.adresse, b.code_postal, b.ville].filter(Boolean).join(", ");
                      if (addr) setAdresse(addr);
                      if (b.prix_vente) { setPrixAffiche(b.prix_vente); setPrixNegocie(b.prix_vente); }
                      if (b.prix_travaux) setBudgetTravaux(b.prix_travaux);
                      setBienId(b.id);
                      setShowLierBien(false);
                    }}
                    style={{
                      display:"flex",alignItems:"center",gap:SPACING.sm+2,
                      padding:`${SPACING.sm+2}px ${SPACING.md+2}px`,
                      background:bienId===b.id?T.accentBg:T.input,
                      border:`1px solid ${bienId===b.id?T.accentBorder:T.border}`,
                      borderRadius:RADIUS.md,cursor:"pointer",textAlign:"left",
                      fontFamily:"inherit",transition:"all .12s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderHover;}}
                    onMouseLeave={e=>{if(bienId!==b.id)e.currentTarget.style.borderColor=T.border;}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,color:T.text,fontSize:FONT.base.size,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {b.adresse || "Sans adresse"}
                      </div>
                      <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
                        {b.ville && <span><Icon as={MapPin} size={10} strokeWidth={2.2}/> {b.ville}</span>}
                        {b.prix_vente > 0 && <span>· {new Intl.NumberFormat("fr-FR").format(b.prix_vente)} €</span>}
                        {b.agence && <span>· {b.agence}</span>}
                      </div>
                    </div>
                    <Icon as={ChevronRight} size={14} color={T.accent} strokeWidth={2.2}/>
                  </button>
                ))}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:SPACING.md+2}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setShowLierBien(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reset */}
      {showReset&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:`${SPACING.xl+2}px ${SPACING.xl+6}px`,maxWidth:380,width:"90%",textAlign:"center",boxShadow:T.shadowMd}}>
            <div style={{
              width:56,height:56,borderRadius:"50%",margin:`0 auto ${SPACING.md}px`,
              background:SEMANTIC.warning.bg,border:`2px solid ${SEMANTIC.warning.border}`,
              display:"flex",alignItems:"center",justifyContent:"center",color:WA,
            }}><Icon as={AlertTriangle} size={26} strokeWidth={2}/></div>
            <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text,marginBottom:6}}>Réinitialiser le simulateur ?</div>
            <div style={{fontSize:FONT.sm.size+1,color:T.textSub,marginBottom:SPACING.xl-2,lineHeight:1.55}}>Toutes les données saisies seront effacées. Cette action est <strong>irréversible</strong>.</div>
            <div style={{display:"flex",gap:SPACING.sm+2,justifyContent:"center"}}>
              <button className="inv-btn inv-btn-out" onClick={()=>setShowReset(false)}>Annuler</button>
              <button className="inv-btn inv-btn-danger" onClick={doReset}><Icon as={RefreshCw} size={13} strokeWidth={2.2}/> Réinitialiser</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TABLEAU DE BORD INVEST ───────────────────────────────────────────────────

export { Simulateur, ListeProjets };
export default Simulateur;