import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
 
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
 
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
const JOURS_JS = [null,"Lundi","Mardi","Mercredi","Jeudi","Vendredi",null]; // 0=dim,6=sam
 
const COULEURS_PALETTE = [
  "#c8d8f0","#ffd6cc","#fce4a0","#d4edda","#d1f7e4","#e8d0e8",
  "#fff0c0","#ffd6e7","#d0e8ff","#e0f0e0","#ffe4b5","#d6e4ff",
  "#f0d6e8","#d6f0e4","#fff0d6","#e8d6f0",
];
 
const STATUTS = {
  a_commander: { label:"À commander", color:"#e05c5c", bg:"rgba(224,92,92,0.12)", border:"rgba(224,92,92,0.3)" },
  commande:    { label:"Commandé",    color:"#f5a623", bg:"rgba(245,166,35,0.12)", border:"rgba(245,166,35,0.3)" },
  retire:      { label:"Retiré ✓",    color:"#50c878", bg:"rgba(80,200,120,0.12)", border:"rgba(80,200,120,0.3)" },
};
 
const THEMES = {
  dark: {
    bg:"#1a1f2e", surface:"#1e2336", modal:"#232840",
    card:"rgba(255,255,255,0.04)", cardHover:"rgba(255,255,255,0.08)",
    cardFill:"rgba(255,255,255,0.06)", border:"rgba(255,255,255,0.07)",
    borderHover:"rgba(255,255,255,0.18)", text:"#e8eaf0", textSub:"#9aa5c0",
    textMuted:"#5b6a8a", accent:"#5b8af5", accentSub:"#4a76e8",
    tagBg:"rgba(91,138,245,0.25)", tagColor:"#a0b8ff",
    tagReelBg:"rgba(80,200,120,0.2)", tagReelColor:"#7ee8a2",
    planColor:"#a0b8ff", reelColor:"#b0f0c0",
    cmdColor:"#f5d08a", cmdBg:"rgba(245,208,138,0.06)", cmdBorder:"rgba(245,208,138,0.2)",
    noteColor:"#c0b8f0", noteBg:"rgba(180,160,245,0.06)", noteBorder:"rgba(180,160,245,0.2)",
    emptyColor:"#3a4060", headerBorder:"rgba(255,255,255,0.08)",
    scrollThumb:"#3a4060", labelText:"#1a1f2e",
    fieldBg:"rgba(255,255,255,0.05)", fieldBorder:"rgba(255,255,255,0.1)",
    sectionDivider:"rgba(255,255,255,0.06)",
    sidebar:"#161b28", sidebarActive:"rgba(91,138,245,0.15)", sidebarBorder:"rgba(255,255,255,0.06)",
    widgetBg:"rgba(255,255,255,0.03)", inputBg:"rgba(255,255,255,0.06)",
  },
  light: {
    bg:"#f0f2f8", surface:"#ffffff", modal:"#ffffff",
    card:"rgba(0,0,0,0.02)", cardHover:"rgba(0,0,0,0.05)",
    cardFill:"rgba(91,138,245,0.05)", border:"rgba(0,0,0,0.09)",
    borderHover:"rgba(0,0,0,0.22)", text:"#1a1f2e", textSub:"#4a5568",
    textMuted:"#8a9ab0", accent:"#4070e8", accentSub:"#3060d0",
    tagBg:"rgba(64,112,232,0.15)", tagColor:"#3060c0",
    tagReelBg:"rgba(40,160,80,0.12)", tagReelColor:"#207040",
    planColor:"#3060c0", reelColor:"#207040",
    cmdColor:"#b06000", cmdBg:"rgba(200,140,0,0.06)", cmdBorder:"rgba(200,140,0,0.2)",
    noteColor:"#6050b0", noteBg:"rgba(100,80,200,0.06)", noteBorder:"rgba(100,80,200,0.2)",
    emptyColor:"#c0c8d8", headerBorder:"rgba(0,0,0,0.08)",
    scrollThumb:"#c0c8d8", labelText:"#1a1f2e",
    fieldBg:"rgba(0,0,0,0.03)", fieldBorder:"rgba(0,0,0,0.1)",
    sectionDivider:"rgba(0,0,0,0.06)",
    sidebar:"#1a1f2e", sidebarActive:"rgba(91,138,245,0.2)", sidebarBorder:"rgba(255,255,255,0.08)",
    widgetBg:"rgba(0,0,0,0.02)", inputBg:"rgba(0,0,0,0.04)",
  },
};
 
function getWeekId(y,w){return`${y}-W${String(w).padStart(2,"0")}`;}
function getCurrentWeek(){
  const now=new Date(),jan1=new Date(now.getFullYear(),0,1);
  const w=Math.ceil(((now-jan1)/86400000+jan1.getDay()+1)/7);
  return{year:now.getFullYear(),week:w};
}
function getTodayJour(){
  const d=new Date().getDay(); // 0=dim ... 6=sam
  return JOURS_JS[d]||null; // null si week-end
}
function emptyCell(){return{planifie:"",reel:"",ouvriers:[]};}
function emptyCommande(){return{chantier_id:"",article:"",fournisseur:"",quantite:"",statut:"a_commander",notes:""};}
 
const DEFAULT_OUVRIERS=["JP","Stev","Kev","Reza","Hamed","Mady","Yann","Julien","Steven"];
const DEFAULT_CHANTIERS=[
  {id:"lamartine",nom:"LAMARTINE",couleur:"#c8d8f0"},
  {id:"lou",nom:"LOU",couleur:"#ffd6cc"},
  {id:"philibert",nom:"PHILIBERT",couleur:"#fce4a0"},
  {id:"arthur",nom:"ARTHUR",couleur:"#d4edda"},
  {id:"metois",nom:"METOIS",couleur:"#d1f7e4"},
  {id:"gildas",nom:"GILDAS BAUGE 2",couleur:"#e8d0e8"},
];
 
// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({page,setPage,T}){
  const[collapsed,setCollapsed]=useState(()=>localStorage.getItem("sidebar_collapsed")==="1");
  const nav=[
    {id:"dashboard",icon:"⊞",label:"Tableau de bord"},
    {id:"planning", icon:"📅",label:"Planning"},
    {id:"commandes",icon:"📦",label:"Commandes"},
    {id:"admin",    icon:"⚙️",label:"Réglages"},
  ];
  const toggle=()=>{
    const next=!collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed",next?"1":"0");
  };
  const W=collapsed?64:220;
  return(
    <div style={{width:W,flexShrink:0,background:T.sidebar,borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",zIndex:50,
      transition:"width .2s ease",overflow:"hidden"}}>
 
      {/* Logo + toggle */}
      <div style={{padding:collapsed?"16px 0":"20px 16px 12px",display:"flex",
        alignItems:"center",justifyContent:collapsed?"center":"space-between",gap:8,flexShrink:0}}>
        {!collapsed&&<div>
          <div style={{fontSize:9,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,0.3)",marginBottom:3}}>Mon Entreprise</div>
          <div style={{fontSize:16,fontWeight:800,letterSpacing:1,color:"#fff",whiteSpace:"nowrap"}}>PLANNING PRO</div>
        </div>}
        <button onClick={toggle} title={collapsed?"Agrandir le menu":"Réduire le menu"} style={{
          background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,
          width:32,height:32,cursor:"pointer",color:"rgba(255,255,255,0.6)",
          fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",
          flexShrink:0,transition:"background .15s",
        }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"}
        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}>
          {collapsed?"▶":"◀"}
        </button>
      </div>
 
      {!collapsed&&<div style={{height:1,background:T.sidebarBorder,margin:"0 14px 10px"}}/>}
 
      {/* Nav items */}
      <nav style={{flex:1,padding:collapsed?"8px 6px":"0 8px"}}>
        {nav.map(n=>{
          const active=page===n.id;
          return(
            <button key={n.id} onClick={()=>setPage(n.id)}
              title={collapsed?n.label:""} style={{
              width:"100%",display:"flex",alignItems:"center",
              justifyContent:collapsed?"center":"flex-start",
              gap:10,padding:collapsed?"12px 0":"11px 14px",
              borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",
              fontSize:15,fontWeight:active?700:500,letterSpacing:.3,
              background:active?T.sidebarActive:"transparent",
              color:active?"#fff":"rgba(255,255,255,0.45)",
              marginBottom:4,transition:"all .15s",textAlign:"left",
              whiteSpace:"nowrap",
            }}>
              <span style={{fontSize:20,width:24,textAlign:"center",flexShrink:0}}>{n.icon}</span>
              {!collapsed&&<>
                <span>{n.label}</span>
                {active&&<span style={{marginLeft:"auto",width:4,height:18,borderRadius:2,background:T.accent,display:"block"}}/>}
              </>}
            </button>
          );
        })}
      </nav>
 
      {/* Date en bas */}
      {!collapsed&&<div style={{padding:"12px 16px",borderTop:`1px solid ${T.sidebarBorder}`,flexShrink:0}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",lineHeight:1.5}}>
          {new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
        </div>
      </div>}
    </div>
  );
}
 
// ─── CELL MODAL ───────────────────────────────────────────────────────────────
function CellModal({chantier,jour,draft,setDraft,commande,note,ouvriers,saving,onClose,T}){
  if(!chantier)return null;
  const toggleOuvrier=(o)=>{
    const list=[...(draft.ouvriers||[])];
    const i=list.indexOf(o);if(i>=0)list.splice(i,1);else list.push(o);
    setDraft(p=>({...p,ouvriers:list}));
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:500,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}
      onClick={onClose}>
      <div style={{background:T.modal,borderRadius:18,width:"100%",maxWidth:860,
        maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column",
        boxShadow:"0 32px 100px rgba(0,0,0,0.5)",border:`1px solid ${T.border}`}}
        onClick={e=>e.stopPropagation()}>
        <div style={{background:chantier.couleur,padding:"20px 28px",display:"flex",
          alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:3,textTransform:"uppercase",
              color:"rgba(0,0,0,0.4)",marginBottom:3}}>{jour}</div>
            <div style={{fontSize:26,fontWeight:800,letterSpacing:1,color:"#1a1f2e",textTransform:"uppercase"}}>{chantier.nom}</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(0,0,0,0.12)",border:"none",
            borderRadius:10,width:40,height:40,cursor:"pointer",fontSize:20,
            color:"#1a1f2e",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button>
        </div>
        <div style={{flex:1,overflow:"hidden",display:"grid",gridTemplateColumns:"1fr 320px",minHeight:0}}>
          <div style={{padding:"24px 20px 24px 28px",display:"flex",flexDirection:"column",gap:16,
            overflowY:"auto",borderRight:`1px solid ${T.sectionDivider}`}}>
            <div style={{flex:1,display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>📋 Tâches planifiées</div>
              <textarea autoFocus value={draft.planifie||""} onChange={e=>setDraft(p=>({...p,planifie:e.target.value}))}
                placeholder="Décrire les tâches prévues…"
                style={{flex:1,minHeight:220,width:"100%",background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.planColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>✅ Réel effectué</div>
              <textarea value={draft.reel||""} onChange={e=>setDraft(p=>({...p,reel:e.target.value}))}
                placeholder="Ce qui a réellement été réalisé…"
                style={{minHeight:100,width:"100%",background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.reelColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>👷 Ouvriers assignés</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {ouvriers.map(o=>{
                  const sel=(draft.ouvriers||[]).includes(o);
                  return(
                    <button key={o} onClick={()=>toggleOuvrier(o)} style={{
                      padding:"9px 18px",borderRadius:10,fontSize:14,fontWeight:700,
                      cursor:"pointer",fontFamily:"inherit",transition:"all .12s",
                      background:sel?chantier.couleur:T.fieldBg,
                      border:`2px solid ${sel?"rgba(0,0,0,0.15)":T.border}`,
                      color:sel?"#1a1f2e":T.textSub,
                      transform:sel?"scale(1.05)":"scale(1)",
                      boxShadow:sel?"0 2px 8px rgba(0,0,0,0.15)":"none",
                    }}>{o}</button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{padding:"24px 28px 24px 20px",display:"flex",flexDirection:"column",gap:16,overflowY:"auto"}}>
            <div style={{flex:1,display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>📦 Commandes à prévoir</div>
              <textarea value={commande.value||""} onChange={e=>commande.set(e.target.value)}
                placeholder={"Matériaux\nLivraisons\nOutillage…"}
                style={{flex:1,minHeight:180,width:"100%",background:T.cmdBg,border:`1.5px solid ${T.cmdBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.cmdColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>🗒️ Notes chantier</div>
              <textarea value={note.value||""} onChange={e=>note.set(e.target.value)}
                placeholder={"Code d'accès\nContact client\nInfos permanentes…"}
                style={{minHeight:120,width:"100%",background:T.noteBg,border:`1.5px solid ${T.noteBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.noteColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
              <div style={{fontSize:11,color:T.textMuted,marginTop:6}}>Notes permanentes — visibles toutes les semaines.</div>
            </div>
          </div>
        </div>
        <div style={{padding:"16px 28px",borderTop:`1px solid ${T.border}`,display:"flex",
          justifyContent:"space-between",alignItems:"center",flexShrink:0,background:T.modal}}>
          <div style={{fontSize:12,color:T.textMuted}}>
            {(draft.ouvriers||[]).length>0?`👷 ${(draft.ouvriers||[]).join(", ")}`:"Aucun ouvrier sélectionné"}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onClose} style={{background:"transparent",border:`1px solid ${T.border}`,
              borderRadius:8,padding:"10px 20px",color:T.textSub,fontFamily:"inherit",fontSize:14,cursor:"pointer"}}>Annuler</button>
            <button onClick={onClose} disabled={saving} style={{background:chantier.couleur,border:"none",
              borderRadius:8,padding:"10px 32px",color:"#1a1f2e",fontFamily:"inherit",
              fontSize:14,fontWeight:800,cursor:"pointer",opacity:saving?.6:1}}>
              {saving?"Enregistrement…":"✓ Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 
// ─── PAGE DASHBOARD ───────────────────────────────────────────────────────────
function PageDashboard({chantiers,cells,commandes,notesData,weekId,T,settings,setSettings}){
  const todayJour=getTodayJour();
  const now=new Date();
  const greeting=now.getHours()<12?"Bonjour":"Bon après-midi";
 
  // Chantiers actifs aujourd'hui
  const chantiersAujourdHui=todayJour?chantiers.map(c=>{
    const cell=cells[`${c.id}_${todayJour}`]||{planifie:"",reel:"",ouvriers:[]};
    return{...c,cell};
  }).filter(c=>c.cell.ouvriers?.length>0||c.cell.planifie):[];
 
  // Commandes urgentes (à commander)
  const [cmdDetails,setCmdDetails]=useState([]);
  useEffect(()=>{
    supabase.from("commandes_detail").select("*").eq("statut","a_commander")
      .then(({data})=>setCmdDetails(data||[]));
  },[]);
 
  // Config liens Google (stockée localement)
  const [calEmbed,setCalEmbed]=useState(()=>localStorage.getItem("gcal_embed")||"");
  const [driveLinks,setDriveLinks]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("drive_links")||"[]");}catch{return[];}
  });
  const [editLinks,setEditLinks]=useState(false);
  const [newLinkName,setNewLinkName]=useState("");
  const [newLinkUrl,setNewLinkUrl]=useState("");
 
  const saveCalEmbed=(v)=>{setCalEmbed(v);localStorage.setItem("gcal_embed",v);};
  const addDriveLink=()=>{
    if(!newLinkName.trim()||!newLinkUrl.trim())return;
    const updated=[...driveLinks,{name:newLinkName.trim(),url:newLinkUrl.trim()}];
    setDriveLinks(updated);
    localStorage.setItem("drive_links",JSON.stringify(updated));
    setNewLinkName("");setNewLinkUrl("");
  };
  const removeDriveLink=(i)=>{
    const updated=driveLinks.filter((_,idx)=>idx!==i);
    setDriveLinks(updated);
    localStorage.setItem("drive_links",JSON.stringify(updated));
  };
 
  const Widget=({title,icon,children,action})=>(
    <div style={{background:T.widgetBg,border:`1px solid ${T.border}`,borderRadius:14,overflow:"hidden"}}>
      <div style={{padding:"14px 18px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",
        borderBottom:`1px solid ${T.sectionDivider}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18}}>{icon}</span>
          <span style={{fontSize:13,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:T.textMuted}}>{title}</span>
        </div>
        {action}
      </div>
      <div style={{padding:"14px 18px"}}>{children}</div>
    </div>
  );
 
  const ExternalBtn=({href,icon,label,color="#5b8af5"})=>(
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
      borderRadius:10,border:`1px solid ${T.border}`,background:T.card,
      color:T.text,textDecoration:"none",fontSize:14,fontWeight:600,
      transition:"all .15s",marginBottom:8,
    }}
    onMouseEnter={e=>{e.currentTarget.style.background=T.cardHover;e.currentTarget.style.borderColor=color+"66";}}
    onMouseLeave={e=>{e.currentTarget.style.background=T.card;e.currentTarget.style.borderColor=T.border;}}>
      <span style={{fontSize:20}}>{icon}</span>
      <span>{label}</span>
      <span style={{marginLeft:"auto",fontSize:12,color:T.textMuted}}>↗</span>
    </a>
  );
 
  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
 
      {/* Titre */}
      <div style={{marginBottom:28}}>
        <div style={{fontSize:15,color:T.textMuted,marginBottom:6}}>
          {now.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
        </div>
        <div style={{fontSize:36,fontWeight:800,letterSpacing:1}}>{greeting} 👋</div>
      </div>
 
      {/* Rangée 1 : Chantiers (2/3) + Commandes urgentes (1/3) */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:20,marginBottom:20}}>
 
        <Widget title="Chantiers aujourd'hui" icon="🏗️">
          {!todayJour?(
            <div style={{color:T.textMuted,fontSize:16,padding:"8px 0"}}>C'est le week-end ! 🎉</div>
          ):chantiersAujourdHui.length===0?(
            <div style={{color:T.textMuted,fontSize:15,padding:"8px 0"}}>
              Aucun ouvrier planifié pour {todayJour} — ouvre le planning pour remplir la journée.
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {chantiersAujourdHui.map(c=>(
                <div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:14,
                  padding:"14px 16px",borderRadius:12,background:c.couleur+"22",border:`1px solid ${c.couleur}55`}}>
                  <div style={{width:14,height:14,borderRadius:4,background:c.couleur,marginTop:3,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:16,color:T.text,marginBottom:5}}>{c.nom}</div>
                    {c.cell.planifie&&<div style={{fontSize:14,color:T.textSub,lineHeight:1.6,marginBottom:8}}>{c.cell.planifie}</div>}
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {c.cell.ouvriers.map(o=>(
                        <span key={o} style={{background:c.couleur,color:"#1a1f2e",borderRadius:6,
                          padding:"3px 10px",fontSize:13,fontWeight:700}}>{o}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>
 
        <Widget title="Commandes urgentes" icon="🚨">
          {cmdDetails.length===0?(
            <div style={{color:T.textMuted,fontSize:15}}>Aucune commande en attente ✓</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {cmdDetails.slice(0,7).map(c=>{
                const ch=chantiers.find(x=>x.id===c.chantier_id);
                return(
                  <div key={c.id} style={{fontSize:14,display:"flex",alignItems:"center",gap:8,
                    padding:"9px 12px",borderRadius:8,background:"rgba(224,92,92,0.08)",border:"1px solid rgba(224,92,92,0.2)"}}>
                    {ch&&<span style={{width:9,height:9,borderRadius:2,background:ch.couleur,display:"block",flexShrink:0}}/>}
                    <span style={{flex:1,color:T.text,fontWeight:600}}>{c.article}</span>
                    {ch&&<span style={{fontSize:12,color:T.textMuted}}>{ch.nom}</span>}
                  </div>
                );
              })}
              {cmdDetails.length>7&&<div style={{fontSize:13,color:T.textMuted}}>+{cmdDetails.length-7} autres…</div>}
            </div>
          )}
        </Widget>
      </div>
 
      {/* Rangée 2 : Accès rapides (1/3) + Agenda large (2/3) */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:20,marginBottom:24}}>
 
        <Widget title="Accès rapides" icon="🔗"
          action={<button onClick={()=>setEditLinks(!editLinks)} style={{background:"transparent",
            border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",
            color:T.textMuted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            {editLinks?"✓ Terminer":"Modifier"}
          </button>}>
          <ExternalBtn href="https://mail.google.com"    icon="📧" label="Gmail"         color="#ea4335"/>
          <ExternalBtn href="https://calendar.google.com" icon="📅" label="Google Agenda" color="#4285f4"/>
          <ExternalBtn href="https://keep.google.com"    icon="🗒️" label="Google Keep"   color="#fbbc04"/>
          <ExternalBtn href="https://drive.google.com"   icon="💾" label="Google Drive"  color="#34a853"/>
          <ExternalBtn href="https://web.whatsapp.com"   icon="💬" label="WhatsApp Web"  color="#25d366"/>
          {driveLinks.length>0&&<>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
              color:T.textMuted,margin:"14px 0 8px"}}>Dossiers Drive</div>
            {driveLinks.map((l,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{flex:1}}><ExternalBtn href={l.url} icon="📁" label={l.name} color="#34a853"/></div>
                {editLinks&&<button onClick={()=>removeDriveLink(i)} style={{background:"transparent",
                  border:"none",color:"#e05c5c",cursor:"pointer",fontSize:18,flexShrink:0,padding:"0 4px"}}>✕</button>}
              </div>
            ))}
          </>}
          {editLinks&&(
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8,
              paddingTop:14,borderTop:`1px solid ${T.sectionDivider}`}}>
              <div style={{fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:T.textMuted}}>Ajouter un dossier</div>
              <input value={newLinkName} onChange={e=>setNewLinkName(e.target.value)} placeholder="Nom"
                style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:7,padding:"9px 12px",
                  color:T.text,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
              <input value={newLinkUrl} onChange={e=>setNewLinkUrl(e.target.value)} placeholder="URL Drive"
                style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:7,padding:"9px 12px",
                  color:T.text,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
              <button onClick={addDriveLink} style={{background:T.accent,color:"#fff",border:"none",
                borderRadius:8,padding:"10px",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                + Ajouter
              </button>
            </div>
          )}
        </Widget>
 
        {/* AGENDA — large, hauteur généreuse */}
        <Widget title="Mon Agenda" icon="📅"
          action={<button onClick={()=>{const url=prompt("Colle l'URL d'intégration Google Calendar :",calEmbed);if(url!==null)saveCalEmbed(url.trim());}}
            style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,
              padding:"4px 10px",color:T.textMuted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            {calEmbed?"Modifier l'URL":"Configurer"}
          </button>}>
          {calEmbed?(
            <iframe src={calEmbed} style={{width:"100%",height:480,border:"none",borderRadius:10,display:"block"}} title="Google Agenda"/>
          ):(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"50px 20px",textAlign:"center",minHeight:300}}>
              <div style={{fontSize:48,marginBottom:20}}>📅</div>
              <div style={{fontSize:18,color:T.text,fontWeight:700,marginBottom:10}}>Intègre ton agenda Google</div>
              <div style={{fontSize:14,color:T.textMuted,lineHeight:1.8,marginBottom:24,maxWidth:400}}>
                Va sur <strong>calendar.google.com</strong> → ⚙️ Paramètres → clique sur ton calendrier à gauche → section <strong>"Intégrer le calendrier"</strong> → copie l'<strong>Adresse intégrable</strong>.
              </div>
              <button onClick={()=>{const url=prompt("Adresse intégrable Google Calendar :");if(url)saveCalEmbed(url.trim());}}
                style={{background:T.accent,color:"#fff",border:"none",borderRadius:10,padding:"14px 28px",
                  fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                Coller l'URL et activer
              </button>
            </div>
          )}
        </Widget>
      </div>
    </div>
  );
}
 
// ─── PAGE COMMANDES ───────────────────────────────────────────────────────────
function PageCommandes({chantiers,T}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filterChantier,setFilterChantier]=useState("all");
  const [filterStatut,setFilterStatut]=useState("all");
  const [editRow,setEditRow]=useState(null); // id en cours d'édition inline
  const [newRow,setNewRow]=useState(null);   // brouillon nouvelle ligne
 
  const load=async()=>{
    setLoading(true);
    const{data}=await supabase.from("commandes_detail").select("*").order("created_at",{ascending:true});
    setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{load();},[]);
 
  // Realtime
  useEffect(()=>{
    const ch=supabase.channel("commandes-detail")
      .on("postgres_changes",{event:"*",schema:"public",table:"commandes_detail"},()=>load())
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);
 
  const saveRow=async(row)=>{
    if(row.id){
      await supabase.from("commandes_detail").update(row).eq("id",row.id);
    } else {
      await supabase.from("commandes_detail").insert(row);
    }
    setEditRow(null);setNewRow(null);load();
  };
  const deleteRow=async(id)=>{
    if(!confirm("Supprimer cette ligne ?"))return;
    await supabase.from("commandes_detail").delete().eq("id",id);
    load();
  };
  const cycleStatut=async(row)=>{
    const order=["a_commander","commande","retire"];
    const next=order[(order.indexOf(row.statut)+1)%3];
    await supabase.from("commandes_detail").update({statut:next}).eq("id",row.id);
    setRows(prev=>prev.map(r=>r.id===row.id?{...r,statut:next}:r));
  };
 
  const filtered=rows.filter(r=>
    (filterChantier==="all"||r.chantier_id===filterChantier)&&
    (filterStatut==="all"||r.statut===filterStatut)
  );
 
  const RowEditor=({row,onSave,onCancel})=>{
    const[draft,setDraft]=useState(row);
    return(
      <tr style={{background:T.fieldBg}}>
        <td style={{padding:"8px 10px"}}>
          <select value={draft.chantier_id} onChange={e=>setDraft(p=>({...p,chantier_id:e.target.value}))}
            style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}>
            <option value="" style={{background:"#1e2336",color:"#9aa5c0"}}>— Chantier —</option>
            {chantiers.map(c=><option key={c.id} value={c.id} style={{background:"#1e2336",color:"#e8eaf0"}}>{c.nom}</option>)}
          </select>
        </td>
        <td style={{padding:"8px 10px"}}>
          <input value={draft.article} onChange={e=>setDraft(p=>({...p,article:e.target.value}))}
            placeholder="Article / matériau" autoFocus
            style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
        </td>
        <td style={{padding:"8px 10px"}}>
          <input value={draft.fournisseur} onChange={e=>setDraft(p=>({...p,fournisseur:e.target.value}))}
            placeholder="Fournisseur"
            style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
        </td>
        <td style={{padding:"8px 10px"}}>
          <input value={draft.quantite} onChange={e=>setDraft(p=>({...p,quantite:e.target.value}))}
            placeholder="Qté"
            style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
        </td>
        <td style={{padding:"8px 10px"}}>
          <select value={draft.statut} onChange={e=>setDraft(p=>({...p,statut:e.target.value}))}
            style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}>
            {Object.entries(STATUTS).map(([k,v])=><option key={k} value={k} style={{background:"#1e2336",color:"#e8eaf0"}}>{v.label}</option>)}
          </select>
        </td>
        <td style={{padding:"8px 10px"}}>
          <input value={draft.notes} onChange={e=>setDraft(p=>({...p,notes:e.target.value}))}
            placeholder="Notes"
            style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",
              color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
        </td>
        <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
          <button onClick={()=>onSave(draft)} style={{background:T.accent,color:"#fff",border:"none",
            borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginRight:6}}>✓</button>
          <button onClick={onCancel} style={{background:"transparent",border:`1px solid ${T.border}`,
            borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>✕</button>
        </td>
      </tr>
    );
  };
 
  const counts=Object.fromEntries(Object.keys(STATUTS).map(k=>[k,rows.filter(r=>r.statut===k).length]));
 
  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
      <div style={{marginBottom:24,display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:1,marginBottom:4}}>Commandes</div>
          <div style={{fontSize:14,color:T.textSub}}>Suivi des besoins par chantier et par fournisseur</div>
        </div>
        <button onClick={()=>setNewRow(emptyCommande())} style={{background:T.accent,color:"#fff",border:"none",
          borderRadius:10,padding:"11px 22px",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:"pointer"}}>
          + Nouvelle ligne
        </button>
      </div>
 
      {/* Compteurs statut */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        {Object.entries(STATUTS).map(([k,v])=>(
          <div key={k} style={{background:v.bg,border:`1px solid ${v.border}`,borderRadius:10,
            padding:"10px 18px",cursor:"pointer",transition:"all .15s",
            outline:filterStatut===k?`2px solid ${v.color}`:"none"}}
            onClick={()=>setFilterStatut(filterStatut===k?"all":k)}>
            <div style={{fontSize:20,fontWeight:800,color:v.color}}>{counts[k]||0}</div>
            <div style={{fontSize:12,color:v.color,fontWeight:600}}>{v.label}</div>
          </div>
        ))}
      </div>
 
      {/* Filtres */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <select value={filterChantier} onChange={e=>setFilterChantier(e.target.value)}
          style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",
            color:"#e8eaf0",fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all" style={{background:"#1e2336",color:"#e8eaf0"}}>Tous les chantiers</option>
          {chantiers.map(c=><option key={c.id} value={c.id} style={{background:"#1e2336",color:"#e8eaf0"}}>{c.nom}</option>)}
        </select>
        <select value={filterStatut} onChange={e=>setFilterStatut(e.target.value)}
          style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",
            color:"#e8eaf0",fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all" style={{background:"#1e2336",color:"#e8eaf0"}}>Tous les statuts</option>
          {Object.entries(STATUTS).map(([k,v])=><option key={k} value={k} style={{background:"#1e2336",color:"#e8eaf0"}}>{v.label}</option>)}
        </select>
      </div>
 
      {/* Tableau */}
      <div style={{background:T.surface,borderRadius:14,border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:T.card,borderBottom:`2px solid ${T.border}`}}>
              {["Chantier","Article / Matériau","Fournisseur","Quantité","Statut","Notes",""].map(h=>(
                <th key={h} style={{padding:"12px 10px",fontSize:11,fontWeight:700,letterSpacing:1.5,
                  textTransform:"uppercase",color:T.textMuted,textAlign:"left"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newRow&&(
              <RowEditor row={newRow} onSave={saveRow} onCancel={()=>setNewRow(null)}/>
            )}
            {loading?(
              <tr><td colSpan={7} style={{padding:32,textAlign:"center",color:T.textMuted}}>Chargement…</td></tr>
            ):filtered.length===0&&!newRow?(
              <tr><td colSpan={7} style={{padding:32,textAlign:"center",color:T.textMuted}}>
                Aucune commande — clique sur "+ Nouvelle ligne" pour commencer.
              </td></tr>
            ):filtered.map(row=>{
              const ch=chantiers.find(c=>c.id===row.chantier_id);
              const st=STATUTS[row.statut]||STATUTS.a_commander;
              if(editRow===row.id)return<RowEditor key={row.id} row={row} onSave={saveRow} onCancel={()=>setEditRow(null)}/>;
              return(
                <tr key={row.id} style={{borderBottom:`1px solid ${T.sectionDivider}`,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.card}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"11px 10px"}}>
                    {ch?<span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                      <span style={{width:10,height:10,borderRadius:3,background:ch.couleur,display:"block",flexShrink:0}}/>
                      <span style={{fontSize:13,fontWeight:700,color:T.text}}>{ch.nom}</span>
                    </span>:<span style={{fontSize:12,color:T.textMuted}}>—</span>}
                  </td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.text,fontWeight:600}}>{row.article||"—"}</td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub}}>{row.fournisseur||"—"}</td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub}}>{row.quantite||"—"}</td>
                  <td style={{padding:"11px 10px"}}>
                    <button onClick={()=>cycleStatut(row)} style={{
                      background:st.bg,border:`1px solid ${st.border}`,borderRadius:6,
                      padding:"5px 10px",fontSize:12,fontWeight:700,color:st.color,
                      cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",
                      transition:"all .15s"}} title="Cliquer pour changer le statut">
                      {st.label}
                    </button>
                  </td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub,maxWidth:180,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.notes||""}</td>
                  <td style={{padding:"11px 10px",whiteSpace:"nowrap"}}>
                    <button onClick={()=>setEditRow(row.id)} style={{background:"transparent",border:"none",
                      cursor:"pointer",fontSize:15,opacity:.6,marginRight:4,color:T.text}} title="Modifier">✏️</button>
                    <button onClick={()=>deleteRow(row.id)} style={{background:"transparent",border:"none",
                      cursor:"pointer",fontSize:15,opacity:.5,color:"#e05c5c"}} title="Supprimer">🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
 
      {/* Résumé par fournisseur */}
      {rows.filter(r=>r.statut!=="retire"&&r.fournisseur).length>0&&(
        <div style={{marginTop:24}}>
          <div style={{fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
            color:T.textMuted,marginBottom:12}}>Par fournisseur</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
            {[...new Set(rows.filter(r=>r.statut!=="retire"&&r.fournisseur).map(r=>r.fournisseur))].map(f=>{
              const items=rows.filter(r=>r.fournisseur===f&&r.statut!=="retire");
              return(
                <div key={f} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 16px",minWidth:160}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:T.text}}>{f}</div>
                  {items.map(it=>(
                    <div key={it.id} style={{fontSize:12,color:T.textSub,marginBottom:3,display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{width:6,height:6,borderRadius:2,background:STATUTS[it.statut].color,display:"block",flexShrink:0}}/>
                      {it.article}{it.quantite?` × ${it.quantite}`:""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
 
// ─── PAGE PLANNING ────────────────────────────────────────────────────────────
function PagePlanning({chantiers,ouvriers,cells,setCells,commandes,setCommandes,notesData,setNotesData,weekId,view,setView,year,week,setYear,setWeek,T}){
  const [modal,setModal]=useState(null);
  const [cellDraft,setCellDraft]=useState(null);
  const [cmdDraft,setCmdDraft]=useState("");
  const [noteDraft,setNoteDraft]=useState("");
  const [saving,setSaving]=useState(false);
 
  const prevWeek=()=>{if(week===1){setYear(y=>y-1);setWeek(52);}else setWeek(w=>w-1);};
  const nextWeek=()=>{if(week===52){setYear(y=>y+1);setWeek(1);}else setWeek(w=>w+1);};
  const goNow=()=>{const{year:y,week:w}=getCurrentWeek();setYear(y);setWeek(w);};
 
  const getCell=(cId,jour)=>{
    if(modal?.cId===cId&&modal?.jour===jour&&cellDraft)return cellDraft;
    return cells[`${cId}_${jour}`]||emptyCell();
  };
 
  const openModal=(cId,jour)=>{
    setModal({cId,jour});
    setCellDraft({...(cells[`${cId}_${jour}`]||emptyCell())});
    setCmdDraft(commandes[cId]||"");
    setNoteDraft(notesData[cId]||"");
  };
  const closeModal=async()=>{
    if(!modal||!cellDraft){setModal(null);return;}
    const{cId,jour}=modal;
    setSaving(true);
    setCells(prev=>({...prev,[`${cId}_${jour}`]:cellDraft}));
    setCommandes(prev=>({...prev,[cId]:cmdDraft}));
    setNotesData(prev=>({...prev,[cId]:noteDraft}));
    await Promise.all([
      supabase.from("planning_cells").upsert({week_id:weekId,chantier_id:cId,jour,...cellDraft},{onConflict:"week_id,chantier_id,jour"}),
      supabase.from("planning_commandes").upsert({week_id:weekId,chantier_id:cId,contenu:cmdDraft},{onConflict:"week_id,chantier_id"}),
      supabase.from("planning_notes").upsert({chantier_id:cId,contenu:noteDraft},{onConflict:"chantier_id"}),
    ]);
    setSaving(false);setModal(null);setCellDraft(null);
  };
 
  const handlePrint=()=>{
    const vl={"planifie":"PLANNING PLANIFIÉ","reel":"RÉEL","compare":"BILAN COMPARATIF"}[view];
    const rows=chantiers.map(c=>{
      const cols=JOURS.map(j=>{
        const cell=getCell(c.id,j);let html="";
        if(view==="compare"){
          if(cell.planifie)html+=`<div style="color:#3060c0">▸ ${cell.planifie.replace(/\n/g,"<br>")}</div>`;
          if(cell.reel)html+=`<div style="color:#207040">✓ ${cell.reel.replace(/\n/g,"<br>")}</div>`;
        }else if(cell[view])html+=cell[view].replace(/\n/g,"<br>");
        if(cell.ouvriers?.length)html+=`<div style="font-weight:700;color:#666;font-size:9px;border-top:1px solid #eee;padding-top:3px;margin-top:4px">${cell.ouvriers.join(" · ")}</div>`;
        return`<td>${html||"—"}</td>`;
      }).join("");
      return`<tr><td style="font-weight:800;font-size:11px;text-transform:uppercase;background:${c.couleur};width:100px">${c.nom}</td>${cols}</tr>`;
    }).join("");
    const w=window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Planning S${week}—${year}</title>
    <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:10px}
    h1{font-size:16px;margin-bottom:2px}.sub{font-size:10px;color:#666;margin-bottom:12px}
    table{width:100%;border-collapse:collapse}th{background:#1a1f2e;color:#fff;padding:6px 8px;text-align:center;font-size:11px}
    td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;line-height:1.4}
    </style></head><body>
    <h1>Planning — Semaine ${week} / ${year}</h1>
    <div class="sub">${vl} · ${new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
    <table><thead><tr><th>Chantier</th>${JOURS.map(j=>`<th>${j}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    w.document.close();setTimeout(()=>w.print(),400);
  };
 
  const modalChantier=modal?chantiers.find(c=>c.id===modal.cId):null;
 
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      {modal&&cellDraft&&<CellModal chantier={modalChantier} jour={modal.jour} draft={cellDraft}
        setDraft={setCellDraft} commande={{value:cmdDraft,set:setCmdDraft}}
        note={{value:noteDraft,set:setNoteDraft}} ouvriers={ouvriers}
        saving={saving} onClose={closeModal} T={T}/>}
 
      {/* Sous-header planning */}
      <div style={{padding:"16px 28px",borderBottom:`1px solid ${T.headerBorder}`,
        display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",background:T.surface}}>
        <div style={{fontSize:20,fontWeight:800,letterSpacing:1}}>SEMAINE {week} — {year}</div>
        <div style={{display:"flex",gap:8}}>
          <button className="navbtn" onClick={prevWeek}>‹</button>
          <button className="navbtn" onClick={goNow} style={{fontSize:11,padding:"6px 10px"}}>CETTE SEMAINE</button>
          <button className="navbtn" onClick={nextWeek}>›</button>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <button className={`tab ${view==="planifie"?"on":"off"}`} onClick={()=>setView("planifie")}>Planifié</button>
          <button className={`tab ${view==="reel"?"on":"off"}`} onClick={()=>setView("reel")}>Réel</button>
          <button className={`tab ${view==="compare"?"on":"off"}`} onClick={()=>setView("compare")}>Bilan</button>
          <button className="btn-g" onClick={handlePrint} style={{fontSize:17,padding:"6px 12px"}}>🖨</button>
        </div>
      </div>
 
      {/* Grille */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
        <div style={{overflowX:"auto"}}>
          <div style={{display:"grid",gridTemplateColumns:`160px repeat(${JOURS.length},minmax(140px,1fr))`,gap:5,marginBottom:6,minWidth:860}}>
            <div/>
            {JOURS.map(j=>(
              <div key={j} style={{textAlign:"center",fontWeight:800,fontSize:12,letterSpacing:2,
                textTransform:"uppercase",color:T.textMuted,padding:"6px 0"}}>{j}</div>
            ))}
          </div>
          {chantiers.map(c=>(
            <div key={c.id} style={{display:"grid",gridTemplateColumns:`160px repeat(${JOURS.length},minmax(140px,1fr))`,gap:5,marginBottom:5,minWidth:860}}>
              <div style={{background:c.couleur,color:T.labelText,borderRadius:"8px 0 0 8px",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                textAlign:"center",fontWeight:800,fontSize:13,letterSpacing:1,textTransform:"uppercase",padding:"10px 8px",gap:4}}>
                <span>{c.nom}</span>
                <div style={{display:"flex",gap:4}}>
                  {commandes[c.id]?.trim()&&<span style={{width:6,height:6,borderRadius:"50%",background:"#f5a623",display:"block"}}/>}
                  {notesData[c.id]?.trim()&&<span style={{width:6,height:6,borderRadius:"50%",background:"#8070d0",display:"block"}}/>}
                </div>
              </div>
              {JOURS.map(jour=>{
                const cell=getCell(c.id,jour);
                const filled=cell.planifie||cell.reel||cell.ouvriers?.length>0;
                return(
                  <div key={jour} className={`cell ${filled?"filled":""}`} onClick={()=>openModal(c.id,jour)}
                    style={{position:"relative"}}>
                    {filled?(
                      <>
                        {view==="compare"?<>
                          {cell.planifie&&<div style={{fontSize:12,color:T.planColor,lineHeight:1.5,marginBottom:2}}>{cell.planifie}</div>}
                          {cell.reel&&<div style={{fontSize:12,color:T.reelColor,lineHeight:1.5}}>{cell.reel}</div>}
                          {!cell.planifie&&!cell.reel&&<div style={{color:T.emptyColor,fontSize:12}}>—</div>}
                        </>:(
                          <div style={{fontSize:12,lineHeight:1.5,color:view==="reel"?T.reelColor:T.text}}>
                            {cell[view]||<span style={{color:T.emptyColor}}>—</span>}
                          </div>
                        )}
                        {cell.ouvriers?.length>0&&(
                          <div style={{marginTop:5,display:"flex",flexWrap:"wrap",gap:3}}>
                            {cell.ouvriers.map(o=>(
                              <span key={o} style={{background:c.couleur+"55",color:T.text,borderRadius:4,
                                padding:"1px 6px",fontSize:11,fontWeight:700}}>{o}</span>
                            ))}
                          </div>
                        )}
                      </>
                    ):(
                      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
                        justifyContent:"center",fontSize:20,opacity:0,transition:"opacity .15s",
                        color:T.textMuted}} className="cell-add-hint">+</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
 
// ─── PAGE ADMIN ───────────────────────────────────────────────────────────────
function PageAdmin({ouvriers,setOuvriers,chantiers,setChantiers,saveConfig,theme,setTheme,T}){
  const [adminTab,setAdminTab]=useState("ouvriers");
  const [newOuvrier,setNewOuvrier]=useState("");
  const [editOuvrier,setEditOuvrier]=useState(null);
  const [newNom,setNewNom]=useState("");
  const [newColor,setNewColor]=useState(COULEURS_PALETTE[0]);
  const [editChIdx,setEditChIdx]=useState(null);
 
  const addOuvrier=()=>{if(!newOuvrier.trim())return;const u=[...ouvriers,newOuvrier.trim()];setOuvriers(u);saveConfig("ouvriers",u);setNewOuvrier("");};
  const removeOuvrier=i=>{const u=ouvriers.filter((_,idx)=>idx!==i);setOuvriers(u);saveConfig("ouvriers",u);};
  const renameOuvrier=(i,v)=>{const u=ouvriers.map((o,idx)=>idx===i?v:o);setOuvriers(u);saveConfig("ouvriers",u);setEditOuvrier(null);};
  const moveOuvrier=(i,d)=>{const a=[...ouvriers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setOuvriers(a);saveConfig("ouvriers",a);};
  const addChantier=()=>{if(!newNom.trim())return;const id=newNom.trim().toLowerCase().replace(/\s+/g,"-")+"-"+Date.now();const nc={id,nom:newNom.trim().toUpperCase(),couleur:newColor};const u=[...chantiers,nc];setChantiers(u);saveConfig("chantiers",u);setNewNom("");};
  const removeChantier=i=>{const u=chantiers.filter((_,idx)=>idx!==i);setChantiers(u);saveConfig("chantiers",u);};
  const updateChantier=(i,ch)=>{const u=chantiers.map((c,idx)=>idx===i?{...c,...ch}:c);setChantiers(u);saveConfig("chantiers",u);};
  const moveChantier=(i,d)=>{const a=[...chantiers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setChantiers(a);saveConfig("chantiers",a);};
 
  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
      <div style={{fontSize:28,fontWeight:800,letterSpacing:1,marginBottom:4}}>Réglages</div>
      <div style={{color:T.textSub,fontSize:14,marginBottom:24}}>Modifications appliquées immédiatement pour toute l'équipe.</div>
      <div style={{display:"flex",gap:4,marginBottom:22,borderBottom:`1px solid ${T.border}`,paddingBottom:8}}>
        {[["ouvriers","👷 Ouvriers"],["chantiers","🏗️ Chantiers"],["apparence","🎨 Apparence"]].map(([k,l])=>(
          <button key={k} className={`atab ${adminTab===k?"on":"off"}`} onClick={()=>setAdminTab(k)}>{l}</button>
        ))}
      </div>
 
      {adminTab==="ouvriers"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Liste des ouvriers</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>Ces noms apparaissent dans la modale d'édition de chaque case.</div>
          {ouvriers.map((o,i)=>(
            <div key={i} className="ar">
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveOuvrier(i,-1)}>▲</button>
                <button className="ib" onClick={()=>moveOuvrier(i,1)}>▼</button>
              </div>
              {editOuvrier?.index===i
                ?<><input className="ti" value={editOuvrier.value}
                    onChange={e=>setEditOuvrier({index:i,value:e.target.value})}
                    onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value);if(e.key==="Escape")setEditOuvrier(null);}}
                    autoFocus/>
                  <button className="btn-p" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>renameOuvrier(i,editOuvrier.value)}>✓</button>
                  <button className="btn-g" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>setEditOuvrier(null)}>✕</button></>
                :<><div style={{flex:1,fontWeight:600,fontSize:15}}>{o}</div>
                  <button className="ib" onClick={()=>setEditOuvrier({index:i,value:o})}>✏️</button>
                  <button className="btn-d" onClick={()=>removeOuvrier(i)}>Supprimer</button></>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:16}}>
            <input className="ti" value={newOuvrier} onChange={e=>setNewOuvrier(e.target.value)}
              placeholder="Prénom ou initiales…" onKeyDown={e=>e.key==="Enter"&&addOuvrier()}/>
            <button className="btn-p" onClick={addOuvrier}>+ Ajouter</button>
          </div>
        </div>
      )}
 
      {adminTab==="chantiers"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Chantiers par défaut</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>Clique sur le rond coloré pour changer la couleur.</div>
          {chantiers.map((c,i)=>(
            <div key={c.id} className="ar" style={{flexWrap:"wrap"}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveChantier(i,-1)}>▲</button>
                <button className="ib" onClick={()=>moveChantier(i,1)}>▼</button>
              </div>
              <div className={`cdot ${editChIdx===i?"sel":""}`}
                style={{background:c.couleur,border:`2px solid ${T.border}`}}
                onClick={()=>setEditChIdx(editChIdx===i?null:i)} title="Couleur"/>
              {editChIdx===i
                ?<div style={{display:"flex",flexWrap:"wrap",gap:6,flex:1}}>
                    {COULEURS_PALETTE.map(col=>(
                      <div key={col} className={`cdot ${c.couleur===col?"sel":""}`}
                        style={{background:col}} onClick={()=>{updateChantier(i,{couleur:col});setEditChIdx(null);}}/>
                    ))}
                  </div>
                :<input className="ti" value={c.nom} onChange={e=>updateChantier(i,{nom:e.target.value.toUpperCase()})} style={{fontWeight:700}}/>
              }
              {editChIdx!==i
                ?<button className="btn-d" onClick={()=>removeChantier(i)}>Supprimer</button>
                :<button className="btn-g" style={{fontSize:12,padding:"5px 10px"}} onClick={()=>setEditChIdx(null)}>✕</button>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:18,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {COULEURS_PALETTE.map(c=>(
                <div key={c} className={`cdot ${newColor===c?"sel":""}`} style={{background:c}} onClick={()=>setNewColor(c)}/>
              ))}
            </div>
            <input className="ti" value={newNom} onChange={e=>setNewNom(e.target.value)}
              placeholder="Nom du chantier…" style={{flex:1,minWidth:140}} onKeyDown={e=>e.key==="Enter"&&addChantier()}/>
            <button className="btn-p" onClick={addChantier}>+ Ajouter</button>
          </div>
        </div>
      )}
 
      {adminTab==="apparence"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Thème d'affichage</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>Chaque membre choisit son thème, sauvegardé sur son appareil.</div>
          <div style={{display:"flex",gap:14}}>
            {[["dark","🌙","Sombre","#1a1f2e","#e8eaf0"],["light","☀️","Clair","#f0f2f8","#1a1f2e"]].map(([k,ic,lb,bg,col])=>(
              <div key={k} onClick={()=>{setTheme(k);localStorage.setItem("theme",k);}}
                style={{flex:1,background:bg,border:`3px solid ${theme===k?T.accent:T.border}`,
                  borderRadius:12,padding:"22px 16px",cursor:"pointer",textAlign:"center",transition:"border .15s"}}>
                <div style={{fontSize:30,marginBottom:8}}>{ic}</div>
                <div style={{fontSize:14,fontWeight:700,color:col}}>{lb}</div>
                {theme===k&&<div style={{fontSize:11,color:T.accent,marginTop:6}}>✓ Actif</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
 
// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function App(){
  const{year:iY,week:iW}=getCurrentWeek();
  const[year,setYear]=useState(iY);
  const[week,setWeek]=useState(iW);
  const[page,setPage]=useState("dashboard");
  const[theme,setTheme]=useState(()=>localStorage.getItem("theme")||"dark");
  const[view,setView]=useState("planifie");
 
  const[ouvriers,setOuvriers]=useState(DEFAULT_OUVRIERS);
  const[chantiers,setChantiers]=useState(DEFAULT_CHANTIERS);
  const[cells,setCells]=useState({});
  const[commandes,setCommandes]=useState({});
  const[notesData,setNotesData]=useState({});
  const[syncing,setSyncing]=useState(false);
  const[connected,setConnected]=useState(false);
  const[lastSync,setLastSync]=useState(null);
 
  const T=THEMES[theme];
  const weekId=getWeekId(year,week);
 
  const loadData=useCallback(async()=>{
    setSyncing(true);
    try{
      const{data:cfg,error:cfgErr}=await supabase.from("planning_config").select("*");
      if(cfgErr)console.error("planning_config:",cfgErr.message);
      else if(cfg?.length)cfg.forEach(r=>{
        if(r.key==="ouvriers")setOuvriers(r.value);
        if(r.key==="chantiers")setChantiers(r.value);
      });
      const{data:cd}=await supabase.from("planning_cells").select("*").eq("week_id",weekId);
      if(cd){const m={};cd.forEach(r=>{m[`${r.chantier_id}_${r.jour}`]={planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[]};});setCells(m);}
      const{data:comd}=await supabase.from("planning_commandes").select("*").eq("week_id",weekId);
      if(comd){const m={};comd.forEach(r=>{m[r.chantier_id]=r.contenu||"";});setCommandes(m);}
      const{data:nd}=await supabase.from("planning_notes").select("*");
      if(nd){const m={};nd.forEach(r=>{m[r.chantier_id]=r.contenu||"";});setNotesData(m);}
      setConnected(true);setLastSync(new Date());
    }catch(e){console.error(e);}
    setSyncing(false);
  },[weekId]);
 
  useEffect(()=>{loadData();},[loadData]);
 
  useEffect(()=>{
    const ch=supabase.channel(`planning-${weekId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"planning_cells",filter:`week_id=eq.${weekId}`},p=>{
        const r=p.new||p.old;if(!r)return;
        const key=`${r.chantier_id}_${r.jour}`;
        if(p.eventType==="DELETE")setCells(prev=>{const n={...prev};delete n[key];return n;});
        else setCells(prev=>({...prev,[key]:{planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[]}}));
        setLastSync(new Date());
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"planning_config"},p=>{
        const r=p.new;if(!r)return;
        if(r.key==="ouvriers")setOuvriers(r.value);
        if(r.key==="chantiers")setChantiers(r.value);
        setLastSync(new Date());
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[weekId]);
 
  const saveConfig=async(key,value)=>{
    const{error}=await supabase.from("planning_config")
      .upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"});
    if(error){
      console.error("saveConfig:",error.message);
      setTimeout(()=>supabase.from("planning_config").upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"}),1000);
    }
  };
 
  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};min-height:100vh}
    ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:3px}
    textarea,input,select{outline:none;font-family:inherit}
    .cell{background:${T.card};border:1px solid ${T.border};border-radius:8px;padding:8px 10px;min-height:70px;cursor:pointer;transition:all .15s}
    .cell:hover{background:${T.cardHover};border-color:${T.borderHover};transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.15)}
    .cell:hover .cell-add-hint{opacity:.4!important}
    .cell.filled{background:${T.cardFill}}
    .tab{padding:8px 18px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:all .15s}
    .tab.on{background:${T.accent};color:#fff}
    .tab.off{background:${T.card};color:${T.textSub};border:1px solid ${T.border}}
    .tab.off:hover{background:${T.cardHover};color:${T.text}}
    .btn-p{background:${T.accent};color:#fff;border:none;border-radius:6px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .btn-g{background:transparent;color:${T.textSub};border:1px solid ${T.border};border-radius:6px;padding:8px 16px;font-family:inherit;font-size:13px;cursor:pointer}
    .btn-g:hover{background:${T.cardHover};color:${T.text}}
    .btn-d{background:transparent;color:#e05c5c;border:1px solid rgba(224,92,92,0.3);border-radius:6px;padding:5px 10px;font-family:inherit;font-size:12px;cursor:pointer}
    .navbtn{background:${T.card};border:1px solid ${T.border};color:${T.text};border-radius:6px;padding:6px 14px;font-family:inherit;font-size:18px;cursor:pointer}
    .navbtn:hover{background:${T.cardHover}}
    .dot-pulse{width:8px;height:8px;border-radius:50%;background:#50c878;display:inline-block;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .ac{background:${T.surface};border:1px solid ${T.border};border-radius:12px;padding:22px;margin-bottom:14px}
    .ar{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${T.border}}
    .ar:last-child{border-bottom:none}
    .ti{background:${T.card};border:1px solid ${T.border};border-radius:6px;padding:8px 12px;color:${T.text};font-family:inherit;font-size:14px;flex:1}
    .ti:focus{border-color:${T.accent}}
    .atab{padding:8px 16px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.5px;text-transform:uppercase}
    .atab.on{background:${T.accent};color:#fff}
    .atab.off{background:transparent;color:${T.textSub}}
    .atab.off:hover{color:${T.text}}
    .cdot{width:22px;height:22px;border-radius:50%;cursor:pointer;transition:transform .1s;flex-shrink:0}
    .cdot:hover{transform:scale(1.2)}
    .cdot.sel{outline:3px solid ${T.accent};outline-offset:2px}
    .ib{background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 3px;opacity:.6;color:${T.text}}
    .ib:hover{opacity:1}
  `;
 
  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{css}</style>
      <Sidebar page={page} setPage={setPage} T={T}/>
 
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
        {/* Top bar */}
        <div style={{background:T.surface,borderBottom:`1px solid ${T.headerBorder}`,
          padding:"10px 28px",display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",
            background:T.card,borderRadius:8,fontSize:12,color:T.textSub}}>
            {syncing
              ?<><span style={{width:8,height:8,borderRadius:"50%",background:"#f5a623",display:"inline-block"}}/> Sync…</>
              :connected
                ?<><span className="dot-pulse"/>{" "}En ligne {lastSync?`· ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`:""}</>
                :<><span style={{width:8,height:8,borderRadius:"50%",background:"#e05c5c",display:"inline-block"}}/> Hors ligne</>
            }
          </div>
          <div style={{marginLeft:"auto"}}>
            <button className="btn-g" onClick={()=>{setTheme(t=>t==="dark"?"light":"dark");localStorage.setItem("theme",theme==="dark"?"light":"dark");}}
              style={{fontSize:16,padding:"5px 10px"}}>{theme==="dark"?"☀️":"🌙"}</button>
          </div>
        </div>
 
        {/* Page content */}
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          {page==="dashboard"&&(
            <PageDashboard chantiers={chantiers} cells={cells} commandes={commandes}
              notesData={notesData} weekId={weekId} T={T}/>
          )}
          {page==="planning"&&(
            <PagePlanning chantiers={chantiers} ouvriers={ouvriers} cells={cells} setCells={setCells}
              commandes={commandes} setCommandes={setCommandes} notesData={notesData} setNotesData={setNotesData}
              weekId={weekId} view={view} setView={setView} year={year} week={week}
              setYear={setYear} setWeek={setWeek} T={T}/>
          )}
          {page==="commandes"&&(
            <PageCommandes chantiers={chantiers} T={T}/>
          )}
          {page==="admin"&&(
            <PageAdmin ouvriers={ouvriers} setOuvriers={setOuvriers}
              chantiers={chantiers} setChantiers={setChantiers}
              saveConfig={saveConfig} theme={theme} setTheme={setTheme} T={T}/>
          )}
        </div>
      </div>
    </div>
  );
}
