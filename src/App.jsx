import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
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
  besoin_ouvrier:{ label:"⚡ Besoin équipe", color:"#b060ff", bg:"rgba(176,96,255,0.12)", border:"rgba(176,96,255,0.35)" },
  a_commander:   { label:"À commander",     color:"#e05c5c", bg:"rgba(224,92,92,0.12)",  border:"rgba(224,92,92,0.3)"  },
  commande:      { label:"Commandé",         color:"#f5a623", bg:"rgba(245,166,35,0.12)", border:"rgba(245,166,35,0.3)" },
  retire:        { label:"Retiré ✓",         color:"#50c878", bg:"rgba(80,200,120,0.12)", border:"rgba(80,200,120,0.3)" },
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
function emptyCell(){return{planifie:"",reel:"",ouvriers:[],taches:[]};}
// Convertit le texte libre en tâches structurées (migration données existantes)
function parseTachesFromPlanifie(planifie,tachesExistantes){
  if(tachesExistantes&&tachesExistantes.length>0)return tachesExistantes;
  if(!planifie?.trim())return[];
  return planifie.split("\n").filter(l=>l.trim()).map(l=>({
    id:Math.random().toString(36).slice(2),text:l.trim(),ouvriers:[]
  }));
}
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
    {id:"equipe",   icon:"👷",label:"Équipe"},
    {id:"plans",    icon:"📐",label:"Plans"},
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

            {/* ── TÂCHES STRUCTURÉES ── */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted}}>📋 Tâches planifiées</div>
                <span style={{fontSize:11,color:T.textMuted}}>Assigne des ouvriers à chaque tâche</span>
              </div>

              {(draft.taches||[]).map((tache,idx)=>(
                <div key={tache.id} style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:10,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                  {/* Texte de la tâche */}
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{color:T.textMuted,fontSize:13,marginTop:2,flexShrink:0}}>{idx+1}.</span>
                    <textarea
                      value={tache.text}
                      autoFocus={idx===0 && (draft.taches||[]).length===1}
                      onChange={e=>{
                        const t=[...(draft.taches||[])];
                        t[idx]={...t[idx],text:e.target.value};
                        setDraft(p=>({...p,taches:t,planifie:t.map(x=>x.text).join("\n")}));
                      }}
                      placeholder="Décrire la tâche…"
                      rows={2}
                      style={{flex:1,background:"transparent",border:"none",color:T.planColor,
                        fontSize:14,lineHeight:1.5,resize:"none",fontFamily:"inherit",outline:"none"}}
                    />
                    {/* Durée estimée */}
                    <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,
                      background:T.fieldBg,border:`1px solid ${T.border}`,borderRadius:7,padding:"4px 8px"}}>
                      <span style={{fontSize:12,color:T.textMuted}}>⏱</span>
                      <input
                        type="number" min="0.5" max="24" step="0.5"
                        value={tache.duree||""}
                        onChange={e=>{
                          const t=[...(draft.taches||[])];
                          t[idx]={...t[idx],duree:e.target.value?parseFloat(e.target.value):null};
                          setDraft(p=>({...p,taches:t}));
                        }}
                        placeholder="h"
                        style={{width:38,background:"transparent",border:"none",color:T.text,
                          fontSize:13,fontFamily:"inherit",outline:"none",textAlign:"center"}}
                      />
                      <span style={{fontSize:11,color:T.textMuted}}>h</span>
                    </div>
                    <button onClick={()=>{
                      const t=(draft.taches||[]).filter((_,i)=>i!==idx);
                      setDraft(p=>({...p,taches:t,planifie:t.map(x=>x.text).join("\n")}));
                    }} style={{background:"transparent",border:"none",cursor:"pointer",
                      color:"#e05c5c",fontSize:16,padding:"0 2px",flexShrink:0,opacity:.6}}
                      title="Supprimer cette tâche">✕</button>
                  </div>

                  {/* Ouvriers assignés à cette tâche */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,paddingLeft:18}}>
                    <span style={{fontSize:11,color:T.textMuted,alignSelf:"center",marginRight:2}}>Pour :</span>
                    {(draft.ouvriers||[]).map(o=>{
                      const sel=(tache.ouvriers||[]).includes(o);
                      return(
                        <button key={o} onClick={()=>{
                          const list=[...(tache.ouvriers||[])];
                          const i=list.indexOf(o);
                          if(i>=0)list.splice(i,1);else list.push(o);
                          const t=[...(draft.taches||[])];
                          t[idx]={...t[idx],ouvriers:list};
                          setDraft(p=>({...p,taches:t}));
                        }} style={{
                          padding:"3px 10px",borderRadius:6,fontSize:12,fontWeight:700,
                          cursor:"pointer",fontFamily:"inherit",transition:"all .1s",
                          background:sel?chantier.couleur:"transparent",
                          border:`1.5px solid ${sel?"rgba(0,0,0,0.15)":T.border}`,
                          color:sel?"#1a1f2e":T.textSub,
                        }}>{o}</button>
                      );
                    })}
                    {(draft.ouvriers||[]).length===0&&(
                      <span style={{fontSize:12,color:T.textMuted,fontStyle:"italic"}}>
                        Ajoute des ouvriers au chantier ci-dessous
                      </span>
                    )}
                    {(tache.ouvriers||[]).length===0&&(draft.ouvriers||[]).length>0&&(
                      <span style={{fontSize:11,color:T.accent,marginLeft:4}}>→ Visible par tous</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Bouton ajouter tâche */}
              <button onClick={()=>{
                const newT={id:Math.random().toString(36).slice(2),text:"",ouvriers:[]};
                const t=[...(draft.taches||[]),newT];
                setDraft(p=>({...p,taches:t}));
              }} style={{
                padding:"10px",border:`1.5px dashed ${T.border}`,borderRadius:10,
                background:"transparent",color:T.textMuted,cursor:"pointer",
                fontFamily:"inherit",fontSize:13,fontWeight:600,transition:"all .15s"
              }}>+ Ajouter une tâche</button>
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
    const order=["besoin_ouvrier","a_commander","commande","retire"];
    // Si le statut actuel n'est pas dans l'ordre (cas rare), on commence à a_commander
    const curIdx = order.indexOf(row.statut);
    const next = order[(curIdx>=0 ? curIdx+1 : 1) % order.length];
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
                <tr key={row.id} style={{
                    borderBottom:`1px solid ${T.sectionDivider}`,transition:"background .1s",
                    background: row.statut==="besoin_ouvrier" ? "rgba(176,96,255,0.06)" : "transparent",
                    borderLeft: row.statut==="besoin_ouvrier" ? "3px solid #b060ff" : "3px solid transparent",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background=row.statut==="besoin_ouvrier"?"rgba(176,96,255,0.1)":T.card}
                  onMouseLeave={e=>e.currentTarget.style.background=row.statut==="besoin_ouvrier"?"rgba(176,96,255,0.06)":"transparent"}>
                  <td style={{padding:"11px 10px"}}>
                    {ch?<span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                      <span style={{width:10,height:10,borderRadius:3,background:ch.couleur,display:"block",flexShrink:0}}/>
                      <span style={{fontSize:13,fontWeight:700,color:T.text}}>{ch.nom}</span>
                    </span>:<span style={{fontSize:12,color:T.textMuted}}>—</span>}
                  </td>
                  <td style={{padding:"11px 10px",fontSize:13,color:row.statut==="besoin_ouvrier"?"#c080ff":T.text,fontWeight:600}}>
                    {row.article||"—"}
                  </td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub}}>{row.fournisseur||<span style={{color:T.emptyColor,fontSize:12}}>À renseigner</span>}</td>
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
    const existing = cells[`${cId}_${jour}`]||emptyCell();
    // Migration : si pas de tâches structurées mais texte libre, on convertit
    const taches = parseTachesFromPlanifie(existing.planifie, existing.taches);
    setCellDraft({...existing, taches});
    setCmdDraft(commandes[cId]||"");
    setNoteDraft(notesData[cId]||"");
  };
  const closeModal=async()=>{
    if(!modal||!cellDraft){setModal(null);return;}
    const{cId,jour}=modal;
    setSaving(true);
    // Dérive planifie depuis les tâches structurées pour la compatibilité
    const taches=(cellDraft.taches||[]).filter(t=>t.text.trim());
    const planifie=taches.map(t=>t.text).join("\n");
    const finalDraft={...cellDraft, taches, planifie};
    setCells(prev=>({...prev,[`${cId}_${jour}`]:finalDraft}));
    setCommandes(prev=>({...prev,[cId]:cmdDraft}));
    setNotesData(prev=>({...prev,[cId]:noteDraft}));
    await Promise.all([
      supabase.from("planning_cells").upsert({week_id:weekId,chantier_id:cId,jour,...finalDraft},{onConflict:"week_id,chantier_id,jour"}),
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

// ─── PAGE PLANS ───────────────────────────────────────────────────────────────

// ─── DXF PARSER ───────────────────────────────────────────────────────────────
function parseDXF(text) {
  const lines = text.split('\n').map(l => l.trim());
  const points = [], segments = [];
  const DXF_COLORS = {
    1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',
    6:'#ff00ff',7:'#ffffff',30:'#ff8000',40:'#80ff00',50:'#00ff80',
    60:'#0080ff',70:'#8000ff',80:'#ff0080',90:'#c0c0c0',100:'#808080',
    110:'#ffd700',113:'#a0c0ff',130:'#90ee90',150:'#ffb6c1',
  };
  const getColor = (c) => DXF_COLORS[c] || '#7090c0';
  let i = 0;
  while (i < lines.length) {
    const tok = lines[i];
    if (tok === 'POINT') {
      let x=null,y=null,color=7,layer='0';
      let j=i+1;
      while (j < Math.min(i+30, lines.length)) {
        const code = lines[j], val = lines[j+1];
        if (code==='10') x=parseFloat(val);
        else if (code==='20') y=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      if (x!=null && y!=null) points.push({x,y,color:getColor(color),layer});
    } else if (tok==='LINE') {
      let x1=null,y1=null,x2=null,y2=null,color=7,layer='0';
      let j=i+1;
      while (j < Math.min(i+40, lines.length)) {
        const code=lines[j], val=lines[j+1];
        if (code==='10') x1=parseFloat(val);
        else if (code==='20') y1=parseFloat(val);
        else if (code==='11') x2=parseFloat(val);
        else if (code==='21') y2=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      if (x1!=null&&y1!=null&&x2!=null&&y2!=null) segments.push({x1,y1,x2,y2,color:getColor(color),layer,id:Math.random()});
    } else if (tok==='LWPOLYLINE') {
      let verts=[],color=7,layer='0',closed=false;
      let j=i+1;
      while (j < Math.min(i+500, lines.length)) {
        const code=lines[j], val=lines[j+1];
        if (code==='10') verts.push({x:parseFloat(val),y:null});
        else if (code==='20' && verts.length) verts[verts.length-1].y=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='70') closed=!!(parseInt(val)&1);
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      const c=getColor(color);
      for (let k=0;k<verts.length-1;k++) {
        if (verts[k].y!=null&&verts[k+1].y!=null)
          segments.push({x1:verts[k].x,y1:verts[k].y,x2:verts[k+1].x,y2:verts[k+1].y,color:c,layer,id:Math.random()});
      }
      if (closed&&verts.length>1&&verts[0].y!=null&&verts[verts.length-1].y!=null)
        segments.push({x1:verts[verts.length-1].x,y1:verts[verts.length-1].y,x2:verts[0].x,y2:verts[0].y,color:c,layer,id:Math.random()});
    }
    i++;
  }
  return {points, segments};
}

// Auto-connect point cloud → line segments
function autoConnect(points, threshold) {
  if (points.length === 0) return [];
  // Group by color/layer
  const groups = {};
  points.forEach(p => {
    const k = p.color+'_'+p.layer;
    if (!groups[k]) groups[k] = [];
    groups[k].push(p);
  });
  const segs = [];
  Object.values(groups).forEach(grp => {
    if (grp.length < 2) return;
    // For each point, find nearest neighbors within threshold
    // Use spatial bucketing for performance
    const bucket = {};
    const bsize = threshold;
    grp.forEach((p,idx) => {
      const bx = Math.floor(p.x/bsize), by = Math.floor(p.y/bsize);
      for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) {
        const key = `${bx+dx}_${by+dy}`;
        if (!bucket[key]) continue;
        bucket[key].forEach(j => {
          if (j >= idx) return;
          const q = grp[j];
          const d = Math.sqrt((p.x-q.x)**2+(p.y-q.y)**2);
          if (d < threshold && d > 0.001) {
            segs.push({x1:p.x,y1:p.y,x2:q.x,y2:q.y,color:p.color,layer:p.layer,id:Math.random()});
          }
        });
      }
      const bk = `${bx}_${by}`;
      if (!bucket[bk]) bucket[bk] = [];
      bucket[bk].push(idx);
    });
  });
  return segs;
}

// Compute bounding box
function getBounds(segments, symbols=[]) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  segments.forEach(s => {
    minX=Math.min(minX,s.x1,s.x2); maxX=Math.max(maxX,s.x1,s.x2);
    minY=Math.min(minY,s.y1,s.y2); maxY=Math.max(maxY,s.y1,s.y2);
  });
  symbols.forEach(s => {
    minX=Math.min(minX,s.x); maxX=Math.max(maxX,s.x);
    minY=Math.min(minY,s.y); maxY=Math.max(maxY,s.y);
  });
  if (!isFinite(minX)) return {minX:0,maxX:100,minY:0,maxY:100,w:100,h:100};
  return {minX,maxX,minY,maxY,w:maxX-minX,h:maxY-minY};
}

const SYMBOL_TYPES = [
  {id:'door',  icon:'🚪', label:'Porte'},
  {id:'window',icon:'⬜', label:'Fenêtre'},
  {id:'stair', icon:'🪜', label:'Escalier'},
  {id:'wc',    icon:'🚽', label:'WC'},
  {id:'text',  icon:'T',  label:'Texte'},
];

const TOOL_LIST = [
  {id:'pan',    icon:'✋', label:'Déplacer'},
  {id:'select', icon:'↖',  label:'Sélectionner / Supprimer'},
  {id:'line',   icon:'╱',  label:'Tracer une ligne'},
  {id:'door',   icon:'🚪', label:'Ajouter une porte'},
  {id:'window', icon:'⬜', label:'Ajouter une fenêtre'},
  {id:'text',   icon:'T',  label:'Ajouter un texte'},
  {id:'measure',icon:'📏', label:'Mesurer'},
];

// ─── PLAN EDITOR ──────────────────────────────────────────────────────────────
function PlanEditor({plan, onSave, onClose, T, chantiers}) {
  const canvasRef = useRef(null);
  const [segments, setSegments] = useState(plan.data?.segments || []);
  const [symbols, setSymbols]   = useState(plan.data?.symbols || []);

  // Historique undo/redo — stocké dans des refs pour éviter les setState imbriqués
  const historyRef = useRef([]);   // pile des états passés
  const futureRef  = useRef([]);   // pile des états annulés (redo)
  const [historyLen, setHistoryLen] = useState(0); // juste pour forcer un re-render des boutons
  const [futureLen,  setFutureLen]  = useState(0);

  // Enregistre l'état courant AVANT une modification
  const pushHistory = useCallback((segs, syms) => {
    historyRef.current = [...historyRef.current.slice(-29), { segments: segs, symbols: syms }];
    futureRef.current  = [];
    setHistoryLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev  = historyRef.current[historyRef.current.length - 1];
    // Sauvegarde état actuel dans future (on a besoin des valeurs courantes ici)
    // On les récupère via les setters fonctionnels pour éviter la dépendance
    setSegments(curSegs => {
      setSymbols(curSyms => {
        futureRef.current = [{ segments: curSegs, symbols: curSyms }, ...futureRef.current.slice(0, 29)];
        setFutureLen(futureRef.current.length);
        return prev.symbols;
      });
      return prev.segments;
    });
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryLen(historyRef.current.length);
  }, []);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    setSegments(curSegs => {
      setSymbols(curSyms => {
        historyRef.current = [...historyRef.current, { segments: curSegs, symbols: curSyms }];
        setHistoryLen(historyRef.current.length);
        return next.symbols;
      });
      return next.segments;
    });
    futureRef.current = futureRef.current.slice(1);
    setFutureLen(futureRef.current.length);
  }, []);
  const [vp, setVp]             = useState(plan.data?.viewport || {x:0,y:0,scale:1});
  const [tool, setTool]         = useState('pan');
  const [lineStart, setLineStart] = useState(null);
  const [mousePos, setMousePos]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [measurePts, setMeasurePts] = useState([]);
  const [measureDist, setMeasureDist] = useState(null);
  const [threshold, setThreshold]   = useState(plan.data?.threshold || 0.5);
  const [showThreshold, setShowThreshold] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Derived
  const vpRef = useRef(vp);
  vpRef.current = vp;

  // Canvas coord helpers
  const toCanvas = (wx,wy) => ({
    cx: (wx - vpRef.current.x) * vpRef.current.scale,
    cy: (wy - vpRef.current.y) * vpRef.current.scale,
  });
  const toWorld = (cx,cy) => ({
    wx: cx / vpRef.current.scale + vpRef.current.x,
    wy: cy / vpRef.current.scale + vpRef.current.y,
  });

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const {width:W, height:H} = canvas;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0,0,W,H);

    // Grid
    const gridSize = Math.max(0.1, 1 / vpRef.current.scale);
    const gStep = gridSize * vpRef.current.scale;
    if (gStep > 20) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      const ox = (-vpRef.current.x % gridSize) * vpRef.current.scale;
      const oy = (-vpRef.current.y % gridSize) * vpRef.current.scale;
      for (let x=ox;x<W;x+=gStep) { ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
      for (let y=oy;y<H;y+=gStep) { ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }
    }

    // Segments
    segments.forEach(s => {
      if (s.deleted) return;
      const {cx:x1,cy:y1}=toCanvas(s.x1,s.y1);
      const {cx:x2,cy:y2}=toCanvas(s.x2,s.y2);
      const isSelected = selectedIds.has(s.id);
      ctx.strokeStyle = isSelected ? '#f5a623' : (s.color || '#7090c0');
      ctx.lineWidth = isSelected ? 3 : (s.user ? 2 : 1.5);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    });

    // Symbols
    symbols.forEach(sym => {
      if (sym.deleted) return;
      const {cx,cy} = toCanvas(sym.x, sym.y);
      const sz = Math.max(12, vpRef.current.scale * 0.6);
      ctx.save();
      ctx.translate(cx,cy);
      ctx.rotate((sym.angle||0)*Math.PI/180);
      if (sym.type==='door') {
        ctx.strokeStyle='#f5a623'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(sz,0);
        ctx.arc(0,0,sz,0,Math.PI/2); ctx.stroke();
      } else if (sym.type==='window') {
        ctx.strokeStyle='#60a0ff'; ctx.lineWidth=2;
        ctx.strokeRect(-sz/2,-sz/4,sz,sz/2);
        ctx.beginPath(); ctx.moveTo(-sz/2,0); ctx.lineTo(sz/2,0); ctx.stroke();
      } else if (sym.type==='stair') {
        ctx.strokeStyle='#80ff80'; ctx.lineWidth=1.5;
        for (let k=0;k<4;k++) { ctx.strokeRect(-sz/2+k*sz/4,-sz/2,sz/4,sz); }
      } else if (sym.type==='wc') {
        ctx.strokeStyle='#a0c0ff'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.ellipse(0,0,sz/2,sz/3,0,0,Math.PI*2); ctx.stroke();
      }
      if (sym.text) {
        ctx.fillStyle='#e8eaf0'; ctx.font=`bold ${Math.max(10,sz*0.5)}px sans-serif`;
        ctx.textAlign='center'; ctx.fillText(sym.text,0,sz+12);
      }
      if (sym.type==='text') {
        ctx.fillStyle='#f5d08a'; ctx.font=`bold ${Math.max(11,sz*0.6)}px sans-serif`;
        ctx.textAlign='center'; ctx.fillText(sym.text||'',0,4);
      }
      ctx.restore();
    });

    // Line in progress
    if (tool==='line' && lineStart && mousePos) {
      const {cx:x1,cy:y1}=toCanvas(lineStart.x,lineStart.y);
      ctx.strokeStyle='#5b8af5'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(mousePos.cx,mousePos.cy); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Measure
    if (measurePts.length===1 && mousePos) {
      const {cx:x1,cy:y1}=toCanvas(measurePts[0].x,measurePts[0].y);
      ctx.strokeStyle='#f5a623'; ctx.lineWidth=2; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(mousePos.cx,mousePos.cy); ctx.stroke();
      ctx.setLineDash([]);
      const {wx,wy}=toWorld(mousePos.cx,mousePos.cy);
      const d=Math.sqrt((wx-measurePts[0].x)**2+(wy-measurePts[0].y)**2);
      ctx.fillStyle='#f5a623'; ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
      ctx.fillText(`${d.toFixed(2)} m`, (x1+mousePos.cx)/2, (y1+mousePos.cy)/2-8);
    }
    if (measureDist) {
      const {cx:x1,cy:y1}=toCanvas(measurePts[0]?.x||0,measurePts[0]?.y||0);
      const {cx:x2,cy:y2}=toCanvas(measurePts[1]?.x||0,measurePts[1]?.y||0);
      ctx.strokeStyle='#f5a623'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.fillStyle='#f5a623'; ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
      ctx.fillText(`${measureDist.toFixed(2)} m`, (x1+x2)/2, (y1+y2)/2-10);
    }
  }, [segments, symbols, vp, tool, lineStart, mousePos, selectedIds, measurePts, measureDist]);

  useEffect(() => { render(); }, [render]);

  // Keyboard shortcuts Ctrl+Z / Ctrl+Y — undo/redo sont stables (useCallback sans deps)
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (((e.ctrlKey||e.metaKey) && e.key==='y') || ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key==='z')) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable - undo/redo ne changent plus

  // Resize canvas — observe le parent car le canvas est en position absolue
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const container = canvas.parentElement; if (!container) return;

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width  = w;
        canvas.height = h;
        render();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize(); // premier rendu
    return () => observer.disconnect();
  }, []); // eslint-disable-line

  // Fit to content
  const fitView = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const bounds = getBounds(segments.filter(s=>!s.deleted), symbols.filter(s=>!s.deleted));
    if (bounds.w===0 && bounds.h===0) return;
    const pad = 0.1;
    const scaleX = canvas.width / (bounds.w * (1+pad*2));
    const scaleY = canvas.height / (bounds.h * (1+pad*2));
    const scale = Math.min(scaleX, scaleY);
    const x = bounds.minX - bounds.w*pad;
    const y = bounds.minY - bounds.h*pad;
    setVp({x, y, scale});
  }, [segments, symbols]);

  useEffect(() => { if (segments.length>0) fitView(); }, []);

  // Mouse/touch events
  const dragRef = useRef(null);

  const getEventPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { cx: clientX-rect.left, cy: clientY-rect.top };
  };

  const onMouseDown = (e) => {
    const pos = getEventPos(e);
    const {wx,wy} = toWorld(pos.cx, pos.cy);
    if (tool==='pan') {
      dragRef.current = {startCx:pos.cx, startCy:pos.cy, startVx:vp.x, startVy:vp.y};
    } else if (tool==='line') {
      if (!lineStart) {
        setLineStart({x:wx, y:wy});
      } else {
        const newSeg = {x1:lineStart.x,y1:lineStart.y,x2:wx,y2:wy,color:'#5b8af5',layer:'user',user:true,id:Date.now()+Math.random()};
        pushHistory(segments, symbols);
        setSegments(s=>[...s,newSeg]);
        setLineStart(null);
      }
    } else if (tool==='select') {
      // Find nearest segment
      const hitThresh = 8 / vp.scale;
      let bestId=null, bestDist=Infinity;
      segments.filter(s=>!s.deleted).forEach(s => {
        // Distance from point to segment
        const dx=s.x2-s.x1, dy=s.y2-s.y1;
        const len2=dx*dx+dy*dy;
        if (len2===0) return;
        const t=Math.max(0,Math.min(1,((wx-s.x1)*dx+(wy-s.y1)*dy)/len2));
        const px=s.x1+t*dx-wx, py=s.y1+t*dy-wy;
        const d=Math.sqrt(px*px+py*py);
        if (d<hitThresh && d<bestDist) { bestDist=d; bestId=s.id; }
      });
      if (bestId) {
        pushHistory(segments, symbols);
        setSegments(s=>s.map(seg=>seg.id===bestId?{...seg,deleted:true}:seg));
        setSelectedIds(new Set());
      }
    } else if (['door','window','stair','wc'].includes(tool)) {
      const sym = {x:wx,y:wy,type:tool,angle:0,id:Date.now()+Math.random()};
      if (tool==='door'||tool==='window') sym.angle=0;
      pushHistory(segments, symbols);
      setSymbols(s=>[...s,sym]);
    } else if (tool==='text') {
      const txt=prompt('Texte :');
      if (txt?.trim()) {
        pushHistory(segments, symbols);
        setSymbols(s=>[...s,{x:wx,y:wy,type:'text',text:txt.trim(),id:Date.now()+Math.random()}]);
      }
    } else if (tool==='measure') {
      if (measurePts.length===0) {
        setMeasurePts([{x:wx,y:wy}]);
        setMeasureDist(null);
      } else {
        const d=Math.sqrt((wx-measurePts[0].x)**2+(wy-measurePts[0].y)**2);
        setMeasurePts([measurePts[0],{x:wx,y:wy}]);
        setMeasureDist(d);
      }
    }
  };

  const onMouseMove = (e) => {
    const pos = getEventPos(e);
    setMousePos(pos);
    if (dragRef.current && tool==='pan') {
      const dx=(pos.cx-dragRef.current.startCx)/vp.scale;
      const dy=(pos.cy-dragRef.current.startCy)/vp.scale;
      setVp(v=>({...v, x:dragRef.current.startVx-dx, y:dragRef.current.startVy-dy}));
    }
  };

  const onMouseUp = () => { dragRef.current=null; };

  const onWheel = (e) => {
    e.preventDefault();
    const pos = getEventPos(e);
    const {wx,wy} = toWorld(pos.cx, pos.cy);
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setVp(v => {
      const ns = v.scale * factor;
      return { scale:ns, x: wx - pos.cx/ns, y: wy - pos.cy/ns };
    });
  };

  // DXF Import
  const importDXF = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const {points, segments:segs} = parseDXF(ev.target.result);
      let finalSegs = segs;
      if (segs.length === 0 && points.length > 0) {
        finalSegs = autoConnect(points, threshold);
      }
      pushHistory(segments, symbols);
      setSegments(finalSegs);
      setSymbols([]);
      setTimeout(fitView, 50);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value='';
  };

  // Reconnect avec nouveau threshold
  const reconnect = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const {points,segments:segs} = parseDXF(ev.target.result);
      if (points.length>0) {
        setSegments(autoConnect(points, threshold));
        setTimeout(fitView, 50);
      }
    };
    reader.readAsText(file,'utf-8');
    e.target.value='';
  };

  // Save
  const handleSave = async () => {
    setSaving(true);
    // Generate thumbnail
    const canvas = canvasRef.current;
    const thumb = canvas ? canvas.toDataURL('image/png',0.3) : '';
    const data = {segments, symbols, viewport:vp, threshold};
    await supabase.from('plans').update({data, thumbnail:thumb, updated_at:new Date().toISOString()}).eq('id',plan.id);
    setSaving(false);
    onSave({...plan, data, thumbnail:thumb});
  };

  // Export PNG
  const exportPNG = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (plan.name||'plan')+'.png';
    a.click();
  };

  // Export PDF (print)
  const exportPDF = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const w = window.open('','_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>${plan.name}</title>
    <style>@page{size:A3 landscape;margin:10mm}body{margin:0}img{width:100%;height:auto}</style>
    </head><body><img src="${dataUrl}"/></body></html>`);
    w.document.close();
    setTimeout(()=>w.print(),500);
  };

  const segCount = segments.filter(s=>!s.deleted).length;
  const symCount = symbols.filter(s=>!s.deleted).length;

  const toolBtnStyle = (id) => ({
    display:'flex',alignItems:'center',justifyContent:'center',
    width:40,height:40,borderRadius:8,border:'none',cursor:'pointer',
    fontFamily:'inherit',fontSize:16,transition:'all .15s',
    background: tool===id ? '#5b8af5' : 'rgba(255,255,255,0.06)',
    color: tool===id ? '#fff' : '#9aa5c0',
    title: TOOL_LIST.find(t=>t.id===id)?.label||id,
  });

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,background:'#12151f'}}>
      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px',
        background:'#1e2336',borderBottom:'1px solid rgba(255,255,255,0.08)',flexShrink:0,flexWrap:'wrap'}}>
        {/* Back + name */}
        <button onClick={onClose} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.15)',
          borderRadius:8,padding:'6px 12px',color:'#9aa5c0',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>
          ← Retour
        </button>
        <div style={{fontSize:15,fontWeight:700,color:'#e8eaf0',marginRight:4}}>{plan.name}</div>
        <div style={{fontSize:12,color:'#5b6a8a'}}>{segCount} segments · {symCount} symboles</div>

        <div style={{height:24,width:1,background:'rgba(255,255,255,0.1)',margin:'0 4px'}}/>

        {/* Tools */}
        {TOOL_LIST.map(t=>(
          <button key={t.id} title={t.label} onClick={()=>{setTool(t.id);setLineStart(null);setMeasurePts([]);setMeasureDist(null);}} style={toolBtnStyle(t.id)}>
            {t.icon}
          </button>
        ))}

        <div style={{height:24,width:1,background:'rgba(255,255,255,0.1)',margin:'0 4px'}}/>

        {/* Import DXF */}
        <label style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',
          background:'rgba(91,138,245,0.15)',border:'1px solid rgba(91,138,245,0.3)',
          borderRadius:8,color:'#a0b8ff',fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
          📂 Importer DXF
          <input type='file' accept='.dxf' style={{display:'none'}} onChange={importDXF}/>
        </label>

        {/* Threshold */}
        <button onClick={()=>setShowThreshold(s=>!s)} title="Seuil de connexion automatique"
          style={{...toolBtnStyle('threshold'),width:'auto',padding:'0 10px',fontSize:12}}>
          ⚙ {threshold}m
        </button>
        {showThreshold&&(
          <div style={{display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.06)',
            borderRadius:8,padding:'6px 10px'}}>
            <span style={{fontSize:12,color:'#9aa5c0',whiteSpace:'nowrap'}}>Seuil auto:</span>
            <input type='number' value={threshold} min='0.01' max='10' step='0.05'
              onChange={e=>setThreshold(parseFloat(e.target.value)||0.5)}
              style={{width:60,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',
                borderRadius:5,padding:'3px 6px',color:'#e8eaf0',fontFamily:'inherit',fontSize:13}}/>
            <span style={{fontSize:11,color:'#5b6a8a'}}>m</span>
          </div>
        )}

        {/* Fit view */}
        <button title="Ajuster la vue" onClick={fitView}
          style={{...toolBtnStyle('fit'),fontSize:14}}>⊙</button>

        {/* Undo / Redo */}
        <button title="Annuler (Ctrl+Z)" onClick={undo} disabled={historyLen===0}
          style={{...toolBtnStyle('undo_btn'),fontSize:16,opacity:historyLen===0?0.3:1}}>⟲</button>
        <button title="Rétablir (Ctrl+Y)" onClick={redo} disabled={futureLen===0}
          style={{...toolBtnStyle('redo_btn'),fontSize:16,opacity:futureLen===0?0.3:1}}>⟳</button>

        {/* Undo all deleted */}
        <button title="Restaurer toutes les suppressions" onClick={()=>{pushHistory(segments,symbols);setSegments(s=>s.map(seg=>({...seg,deleted:false})));setSymbols(sy=>sy.map(s=>({...s,deleted:false})));}}
          style={{...toolBtnStyle('undo'),fontSize:14}}>↩</button>

        <div style={{flex:1}}/>

        {/* Export */}
        <button onClick={exportPNG} style={{background:'rgba(80,200,120,0.15)',border:'1px solid rgba(80,200,120,0.3)',
          borderRadius:8,padding:'7px 14px',color:'#7ee8a2',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          ↓ PNG
        </button>
        <button onClick={exportPDF} style={{background:'rgba(245,166,35,0.15)',border:'1px solid rgba(245,166,35,0.3)',
          borderRadius:8,padding:'7px 14px',color:'#f5a623',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          ↓ PDF
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{background:'#5b8af5',border:'none',borderRadius:8,padding:'7px 18px',
            color:'#fff',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer',opacity:saving?.6:1}}>
          {saving?'…':'💾 Sauvegarder'}
        </button>
      </div>

      {/* Zone canvas - position:relative + canvas absolu = hauteur garantie */}
      <div style={{flex:1,position:'relative',minHeight:0,background:'#12151f'}}>
        <canvas ref={canvasRef}
          style={{position:'absolute',top:0,left:0,right:0,bottom:0,width:'100%',height:'100%',
            background:'#12151f',display:'block',
            cursor:tool==='pan'?(dragRef.current?'grabbing':'grab'):tool==='select'?'crosshair':tool==='line'?'crosshair':'default',
            touchAction:'none'}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onTouchStart={onMouseDown}
          onTouchMove={onMouseMove}
          onTouchEnd={onMouseUp}
        />
      </div>

      {/* Status bar */}
      <div style={{padding:'5px 16px',background:'#1a1f2e',borderTop:'1px solid rgba(255,255,255,0.06)',
        fontSize:11,color:'#5b6a8a',display:'flex',gap:16,flexShrink:0}}>
        <span>Outil : <strong style={{color:'#9aa5c0'}}>{TOOL_LIST.find(t=>t.id===tool)?.label||tool}</strong></span>
        {tool==='line'&&lineStart&&<span style={{color:'#a0b8ff'}}>Cliquer pour terminer la ligne</span>}
        {tool==='measure'&&measurePts.length===0&&<span>Cliquer sur le 1er point</span>}
        {tool==='measure'&&measurePts.length===1&&<span style={{color:'#f5a623'}}>Cliquer sur le 2ème point</span>}
        {measureDist&&<span style={{color:'#f5a623'}}>Distance : {measureDist.toFixed(3)} m</span>}
        <span style={{marginLeft:'auto'}}>Scroll = zoom · Clic droit + drag = déplacer</span>
      </div>
    </div>
  );
}

// ─── PAGE PLANS ───────────────────────────────────────────────────────────────
function PagePlans({T, chantiers}) {
  const [plans, setPlans]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showNew, setShowNew]       = useState(false);
  const [newName, setNewName]       = useState('');
  const [newChantier, setNewChantier] = useState('');
  const [creating, setCreating]     = useState(false);

  const loadPlans = async () => {
    setLoading(true);
    const {data} = await supabase.from('plans').select('*').order('updated_at',{ascending:false});
    setPlans(data||[]);
    setLoading(false);
  };

  useEffect(()=>{ loadPlans(); },[]);

  const createPlan = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const {data} = await supabase.from('plans').insert({
      name:newName.trim(), chantier_id:newChantier,
      data:{segments:[],symbols:[],viewport:{x:0,y:0,scale:1},threshold:0.5},
      thumbnail:'',
    }).select().single();
    if (data) { setPlans(p=>[data,...p]); setEditingPlan(data); }
    setNewName(''); setNewChantier(''); setShowNew(false); setCreating(false);
  };

  const deletePlan = async (id) => {
    if (!confirm('Supprimer ce plan définitivement ?')) return;
    await supabase.from('plans').delete().eq('id',id);
    setPlans(p=>p.filter(x=>x.id!==id));
  };

  const onSave = (updated) => {
    setPlans(p=>p.map(x=>x.id===updated.id?updated:x));
  };

  // Editor mode
  if (editingPlan) return (
    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden',width:'100%'}}>
      <PlanEditor plan={editingPlan} onSave={onSave}
        onClose={()=>{ setEditingPlan(null); loadPlans(); }}
        T={T} chantiers={chantiers}/>
    </div>
  );

  // List mode
  return (
    <div style={{flex:1,overflowY:'auto',padding:'28px 32px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28,flexWrap:'wrap',gap:16}}>
        <div>
          <div style={{fontSize:36,fontWeight:800,letterSpacing:1,marginBottom:4,color:T.text}}>Plans</div>
          <div style={{fontSize:15,color:T.textSub}}>Relevés DXF annotés par chantier</div>
        </div>
        <button onClick={()=>setShowNew(true)} style={{background:T.accent,color:'#fff',border:'none',
          borderRadius:10,padding:'11px 22px',fontFamily:'inherit',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          + Nouveau plan
        </button>
      </div>

      {/* Modal nouveau plan */}
      {showNew&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:500,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:T.modal,borderRadius:14,padding:28,width:420,border:`1px solid ${T.border}`}}>
            <div style={{fontSize:20,fontWeight:800,marginBottom:20,color:T.text}}>Nouveau plan</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:T.textMuted,marginBottom:6}}>Nom</div>
              <input value={newName} onChange={e=>setNewName(e.target.value)} autoFocus
                onKeyDown={e=>e.key==='Enter'&&createPlan()}
                placeholder="Ex: RDC — Alfred Falloux"
                style={{width:'100%',background:T.fieldBg,border:`1px solid ${T.fieldBorder}`,borderRadius:8,
                  padding:'10px 12px',color:T.text,fontFamily:'inherit',fontSize:14,outline:'none'}}/>
            </div>
            <div style={{marginBottom:22}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:T.textMuted,marginBottom:6}}>Chantier associé</div>
              <select value={newChantier} onChange={e=>setNewChantier(e.target.value)}
                style={{width:'100%',background:'#1e2336',border:`1px solid ${T.fieldBorder}`,borderRadius:8,
                  padding:'10px 12px',color:'#e8eaf0',fontFamily:'inherit',fontSize:14,outline:'none'}}>
                <option value="" style={{background:'#1e2336'}}>— Aucun —</option>
                {chantiers.map(c=><option key={c.id} value={c.id} style={{background:'#1e2336'}}>{c.nom}</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowNew(false)} style={{background:'transparent',border:`1px solid ${T.border}`,
                borderRadius:8,padding:'9px 18px',color:T.textSub,fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>Annuler</button>
              <button onClick={createPlan} disabled={creating||!newName.trim()} style={{background:T.accent,color:'#fff',
                border:'none',borderRadius:8,padding:'9px 20px',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer',
                opacity:(!newName.trim()||creating)?0.5:1}}>
                {creating?'Création…':'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading&&<div style={{color:T.textMuted,fontSize:15,padding:32}}>Chargement…</div>}

      {!loading&&plans.length===0&&(
        <div style={{background:T.card,border:`1px dashed ${T.border}`,borderRadius:14,
          padding:'48px 32px',textAlign:'center',maxWidth:520,margin:'0 auto'}}>
          <div style={{fontSize:48,marginBottom:16}}>📐</div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:10,color:T.text}}>Aucun plan pour l'instant</div>
          <div style={{fontSize:14,color:T.textSub,lineHeight:1.8,marginBottom:24}}>
            Crée un plan, importe un fichier .DXF, et l'outil reliera automatiquement les points entre eux. Tu pourras ensuite ajouter des portes, fenêtres, annotations et exporter en PNG ou PDF.
          </div>
          <button onClick={()=>setShowNew(true)} style={{background:T.accent,color:'#fff',border:'none',
            borderRadius:10,padding:'12px 24px',fontFamily:'inherit',fontSize:14,fontWeight:700,cursor:'pointer'}}>
            + Créer mon premier plan
          </button>
        </div>
      )}

      {/* Grille des plans */}
      {!loading&&plans.length>0&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16}}>
          {plans.map(plan=>{
            const ch=chantiers.find(c=>c.id===plan.chantier_id);
            const segCount=plan.data?.segments?.filter(s=>!s.deleted)?.length||0;
            const symCount=plan.data?.symbols?.filter(s=>!s.deleted)?.length||0;
            return (
              <div key={plan.id} style={{background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:14,overflow:'hidden',transition:'all .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.2)';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none';}}>

                {/* Thumbnail / preview */}
                <div onClick={()=>setEditingPlan(plan)} style={{cursor:'pointer',height:160,
                  background:'#12151f',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
                  borderBottom:`1px solid ${T.border}`}}>
                  {plan.thumbnail
                    ? <img src={plan.thumbnail} style={{width:'100%',height:'100%',objectFit:'contain'}} alt=""/>
                    : <div style={{textAlign:'center'}}>
                        <div style={{fontSize:40,marginBottom:8}}>📐</div>
                        <div style={{fontSize:12,color:T.textMuted}}>Cliquer pour ouvrir</div>
                      </div>
                  }
                </div>

                <div style={{padding:'14px 16px'}}>
                  {ch&&<div style={{display:'inline-flex',alignItems:'center',gap:5,
                    background:ch.couleur+'33',border:`1px solid ${ch.couleur}55`,
                    borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700,color:ch.couleur==='#fff'?'#333':ch.couleur,
                    marginBottom:6}}>{ch.nom}</div>}
                  <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:4}}>{plan.name}</div>
                  <div style={{fontSize:12,color:T.textMuted}}>{segCount} segments · {symCount} symboles</div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:3}}>
                    Modifié {new Date(plan.updated_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                  </div>
                </div>

                <div style={{padding:'10px 16px',borderTop:`1px solid ${T.sectionDivider}`,
                  display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button onClick={()=>setEditingPlan(plan)} style={{background:T.accent,color:'#fff',
                    border:'none',borderRadius:7,padding:'6px 16px',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                    Ouvrir
                  </button>
                  <button onClick={()=>deletePlan(plan.id)} style={{background:'transparent',
                    border:'1px solid rgba(224,92,92,0.3)',borderRadius:7,padding:'6px 12px',
                    color:'#e05c5c',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── HELPERS EMAIL ────────────────────────────────────────────────────────────
async function sendRapportEmail(rapport, chantierNom) {
  const RESEND_KEY = import.meta.env.VITE_RESEND_KEY;
  if (!RESEND_KEY) { console.warn("VITE_RESEND_KEY non configuré"); return; }

  const tachesHtml = rapport.taches.map(t => {
    const icon = t.statut==="faite"?"✅":t.statut==="en_cours"?"🔄":"❌";
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${icon} <strong>${t.planifie}</strong></td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#666">${t.remarque||"—"}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a1f2e;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">Compte rendu — ${rapport.ouvrier}</h2>
        <p style="color:#9aa5c0;margin:6px 0 0">${rapport.chantier_nom} · ${rapport.date_rapport}</p>
      </div>
      <div style="background:#f9f9f9;padding:20px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Tâche</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Remarque</th>
          </tr></thead>
          <tbody>${tachesHtml}</tbody>
        </table>
        ${rapport.remarque?`<div style="margin-top:16px;padding:12px;background:#fff;border-radius:6px;border-left:4px solid #5b8af5">
          <strong>Remarque générale :</strong><br>${rapport.remarque}
        </div>`:""}
      </div>
    </div>`;

  await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{"Authorization":`Bearer ${RESEND_KEY}`,"Content-Type":"application/json"},
    body: JSON.stringify({
      from:"Planning Pro <onboarding@resend.dev>",
      to:["suivi.chantier@groupe-profero.com"],
      subject:`CR ${rapport.ouvrier} — ${chantierNom} — ${rapport.date_rapport}`,
      html,
    })
  });
}

// ─── PAGE RAPPORT MOBILE ──────────────────────────────────────────────────────
function PageRapportMobile() {
  const [step, setStep]         = useState("login"); // login | rapport | done
  const [ouvrier, setOuvrier]   = useState(() => localStorage.getItem("mon_prenom") || "");
  const [chantiers, setChantiers] = useState([]);
  const [ouvriers, setOuvriers]   = useState(DEFAULT_OUVRIERS);
  const [taches, setTaches]       = useState([]);
  const [remarque, setRemarque]   = useState("");
  const [besoins, setBesoins]     = useState({}); // { chantier_id: "texte des besoins" }
  const [submitting, setSubmitting] = useState(false);
  const [planData, setPlanData]   = useState(null); // {chantier, cell}

  const today = new Date();
  const dateStr = today.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  const dateKey = today.toLocaleDateString("fr-FR");
  const {year, week} = getCurrentWeek();
  const weekId = getWeekId(year, week);
  const todayJour = getTodayJour();

  // Load config + planning
  useEffect(() => {
    const load = async () => {
      const { data: cfg } = await supabase.from("planning_config").select("*");
      if (cfg?.length) {
        cfg.forEach(r => {
          if (r.key === "chantiers") setChantiers(r.value);
          if (r.key === "ouvriers")  setOuvriers(r.value);
        });
      }
    };
    load();
  }, []);

  // Quand ouvrier confirmé, charge ses tâches du jour
  const loadTaches = async (nom) => {
    if (!todayJour) { setStep("rapport"); return; }
    const { data: cells } = await supabase
      .from("planning_cells").select("*").eq("week_id", weekId);

    // Charger config chantiers
    const { data: cfg } = await supabase.from("planning_config").select("*");
    let chantiersData = DEFAULT_CHANTIERS;
    if (cfg?.length) { const c=cfg.find(r=>r.key==="chantiers"); if(c) chantiersData=c.value; }

    const tachesInit = [];
    (cells||[]).forEach(cell => {
      if (cell.jour !== todayJour) return;
      if (!(cell.ouvriers||[]).includes(nom)) return;
      const ch = chantiersData.find(c => c.id === cell.chantier_id);

      // Tâches structurées (Option A)
      if (cell.taches && cell.taches.length > 0) {
        cell.taches.forEach(t => {
          if (!t.text?.trim()) return;
          const pourTout = !t.ouvriers || t.ouvriers.length === 0;
          const pourMoi  = (t.ouvriers||[]).includes(nom);
          if (pourTout || pourMoi) {
            tachesInit.push({
              chantier_id: cell.chantier_id,
              chantier_nom: ch?.nom || cell.chantier_id,
              chantier_couleur: ch?.couleur || "#c8d8f0",
              planifie: t.text,
              statut: null, remarque: "",
              pourTout,
            });
          }
        });
      } else if (cell.planifie?.trim()) {
        // Rétrocompatibilité texte libre → visible par tous
        cell.planifie.split("\n").filter(l=>l.trim()).forEach(ligne => {
          tachesInit.push({
            chantier_id: cell.chantier_id,
            chantier_nom: ch?.nom || cell.chantier_id,
            chantier_couleur: ch?.couleur || "#c8d8f0",
            planifie: ligne.trim(),
            statut: null, remarque: "", pourTout: true,
          });
        });
      }
    });

    setPlanData({ chantiersData });
    setTaches(tachesInit);
    setStep("rapport");
  };

  const confirmerPrenom = () => {
    if (!ouvrier.trim()) return;
    localStorage.setItem("mon_prenom", ouvrier.trim());
    loadTaches(ouvrier.trim());
  };

  const setStatut = (idx, statut) => {
    setTaches(t => t.map((x,i) => i===idx ? {...x, statut} : x));
  };
  const setTacheRemarque = (idx, val) => {
    setTaches(t => t.map((x,i) => i===idx ? {...x, remarque:val} : x));
  };
  const setTachePlanifie = (idx, val) => {
    setTaches(t => t.map((x,i) => i===idx ? {...x, planifie:val} : x));
  };
  const addTacheLibre = () => {
    setTaches(t => [...t, {chantier_id:"",chantier_nom:"",chantier_couleur:"#c8d8f0",planifie:"",statut:null,remarque:"",libre:true}]);
  };

  const soumettre = async () => {
    const tachesRemplies = taches.filter(t => t.planifie.trim());
    if (tachesRemplies.length === 0) { alert("Aucune tâche à soumettre."); return; }

    setSubmitting(true);

    // Regrouper par chantier
    const parChantier = {};
    tachesRemplies.forEach(t => {
      const k = t.chantier_id || "divers";
      if (!parChantier[k]) parChantier[k] = { chantier_id:t.chantier_id, chantier_nom:t.chantier_nom||"Divers", taches:[] };
      parChantier[k].taches.push({ planifie:t.planifie, statut:t.statut||"non_faite", remarque:t.remarque });
    });

    for (const k of Object.keys(parChantier)) {
      const grp = parChantier[k];
      const rapport = {
        ouvrier: ouvrier.trim(),
        chantier_id: grp.chantier_id,
        chantier_nom: grp.chantier_nom,
        date_rapport: dateKey,
        semaine: weekId,
        taches: grp.taches,
        remarque,
      };
      await supabase.from("rapports").insert(rapport);
      try { await sendRapportEmail(rapport, grp.chantier_nom); } catch(e) { console.error("Email:",e); }

      // Créer les besoins en commande → onglet Commandes
      const besoinTexte = besoins[grp.chantier_id];
      if (besoinTexte?.trim()) {
        // Une ligne par besoin (séparé par retour à la ligne)
        const lignes = besoinTexte.split("\n").filter(l=>l.trim());
        for (const ligne of lignes) {
          await supabase.from("commandes_detail").insert({
            chantier_id: grp.chantier_id,
            article: ligne.trim(),
            fournisseur: "",
            quantite: "",
            statut: "besoin_ouvrier",
            notes: `Demande de ${ouvrier.trim()} — ${dateKey}`,
          });
        }
      }
    }

    setSubmitting(false);
    setStep("done");
  };

  const progress = taches.filter(t=>t.statut!==null).length;
  const total    = taches.length;

  const S = {
    wrap: { minHeight:"100vh", background:"#f4f6fa", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif" },
    header: { background:"#1a1f2e", padding:"20px 20px 16px", position:"sticky", top:0, zIndex:10 },
    card: { background:"#fff", borderRadius:14, padding:"18px 16px", margin:"12px 16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" },
    label: { fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#8a9ab0", marginBottom:8, display:"block" },
    input: { width:"100%", border:"1.5px solid #e0e4ef", borderRadius:10, padding:"14px 14px", fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" },
    btn: (color,bg) => ({ width:"100%", padding:"16px", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:bg, color:color, marginTop:8 }),
  };

  // ── STEP: LOGIN ──
  if (step === "login") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:4}}>Planning Pro</div>
        <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Mon compte rendu</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginTop:4}}>{dateStr}</div>
      </div>
      <div style={{...S.card, marginTop:32}}>
        <span style={S.label}>C'est qui ?</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
          {ouvriers.map(o => (
            <button key={o} onClick={()=>setOuvrier(o)} style={{
              padding:"10px 18px",borderRadius:10,fontSize:15,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",border:"2px solid",transition:"all .12s",
              background: ouvrier===o ? "#1a1f2e" : "#f4f6fa",
              borderColor: ouvrier===o ? "#1a1f2e" : "#e0e4ef",
              color: ouvrier===o ? "#fff" : "#1a1f2e",
            }}>{o}</button>
          ))}
        </div>
        <div style={{fontSize:13,color:"#8a9ab0",marginBottom:8}}>Ou saisis ton prénom :</div>
        <input style={S.input} value={ouvrier} onChange={e=>setOuvrier(e.target.value)}
          placeholder="Ton prénom…" onKeyDown={e=>e.key==="Enter"&&confirmerPrenom()}/>
        <button onClick={confirmerPrenom} disabled={!ouvrier.trim()} style={{
          ...S.btn("#fff","#1a1f2e"), opacity:ouvrier.trim()?1:0.4, marginTop:16
        }}>C'est parti →</button>
      </div>
    </div>
  );

  // ── STEP: DONE ──
  if (step === "done") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Mon compte rendu</div>
      </div>
      <div style={{...S.card, textAlign:"center", padding:"40px 24px", marginTop:32}}>
        <div style={{fontSize:56,marginBottom:16}}>✅</div>
        <div style={{fontSize:22,fontWeight:800,color:"#1a1f2e",marginBottom:8}}>Compte rendu envoyé !</div>
        <div style={{fontSize:15,color:"#8a9ab0",lineHeight:1.6,marginBottom:28}}>
          Merci {ouvrier}. Ton compte rendu du {dateKey} a bien été enregistré.
        </div>
        <button onClick={()=>{setStep("rapport");setTaches([]);loadTaches(ouvrier);}} style={{...S.btn("#fff","#1a1f2e")}}>
          Voir mes tâches
        </button>
      </div>
    </div>
  );

  // ── STEP: RAPPORT ──
  const faites   = taches.filter(t=>t.statut==="faite").length;
  const enCours  = taches.filter(t=>t.statut==="en_cours").length;
  const nonFaite = taches.filter(t=>t.statut==="non_faite").length;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:2}}>Bonjour {ouvrier} 👋</div>
            <div style={{fontSize:20,fontWeight:800,color:"#fff"}}>{dateStr}</div>
          </div>
          <button onClick={()=>setStep("login")} style={{background:"rgba(255,255,255,0.1)",border:"none",
            borderRadius:8,padding:"6px 12px",color:"rgba(255,255,255,0.6)",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            Changer
          </button>
        </div>
        {total>0 && (
          <div style={{marginTop:12}}>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              {faites>0&&<span style={{background:"rgba(80,200,120,0.2)",color:"#7ee8a2",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>✅ {faites} faite{faites>1?"s":""}</span>}
              {enCours>0&&<span style={{background:"rgba(245,166,35,0.2)",color:"#f5a623",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>🔄 {enCours}</span>}
              {nonFaite>0&&<span style={{background:"rgba(224,92,92,0.2)",color:"#ff8888",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>❌ {nonFaite}</span>}
            </div>
            <div style={{background:"rgba(255,255,255,0.1)",borderRadius:4,height:4}}>
              <div style={{background:"#50c878",height:4,borderRadius:4,width:`${(progress/total)*100}%`,transition:"width .3s"}}/>
            </div>
          </div>
        )}
      </div>

      {/* Tâches */}
      {taches.length===0 && (
        <div style={{...S.card, textAlign:"center", padding:"32px 24px"}}>
          <div style={{fontSize:36,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e",marginBottom:6}}>Aucune tâche planifiée</div>
          <div style={{fontSize:14,color:"#8a9ab0",marginBottom:16}}>
            {todayJour ? `Rien n'est planifié pour toi ce ${todayJour}.` : "C'est le week-end ! 🎉"}
          </div>
          <button onClick={addTacheLibre} style={S.btn("#fff","#1a1f2e")}>+ Ajouter une tâche manuellement</button>
        </div>
      )}

      {taches.map((t, idx) => (
        <div key={idx} style={{...S.card, borderLeft:`4px solid ${t.chantier_couleur||"#5b8af5"}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {t.chantier_nom && (
              <div style={{display:"inline-block",background:t.chantier_couleur+"33",color:"#1a1f2e",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700,textTransform:"uppercase",
                letterSpacing:1}}>{t.chantier_nom}</div>
            )}
            {t.pourTout && (
              <div style={{display:"inline-block",background:"rgba(91,138,245,0.12)",color:"#5b8af5",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700}}>👥 Pour tous</div>
            )}
            {t.duree && (
              <div style={{display:"inline-block",background:"rgba(245,166,35,0.12)",color:"#c07800",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700}}>⏱ {t.duree}h estimée{t.duree>1?"s":""}</div>
            )}
          </div>
          {t.libre ? (
            <textarea value={t.planifie} onChange={e=>setTachePlanifie(idx,e.target.value)}
              placeholder="Décris la tâche…"
              style={{...S.input,resize:"none",minHeight:60,marginBottom:10,fontSize:15}}/>
          ) : (
            <div style={{fontSize:16,fontWeight:600,color:"#1a1f2e",marginBottom:12,lineHeight:1.4}}>{t.planifie}</div>
          )}

          {/* Boutons statut */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {[["faite","✅","Faite","#50c878","rgba(80,200,120,0.12)"],
              ["en_cours","🔄","En cours","#f5a623","rgba(245,166,35,0.12)"],
              ["non_faite","❌","Non faite","#e05c5c","rgba(224,92,92,0.12)"]].map(([val,ic,lb,col,bg])=>(
              <button key={val} onClick={()=>setStatut(idx,val)} style={{
                padding:"10px 4px",borderRadius:10,border:`2px solid`,cursor:"pointer",
                fontFamily:"inherit",fontSize:13,fontWeight:700,transition:"all .12s",
                borderColor: t.statut===val ? col : "#e0e4ef",
                background: t.statut===val ? bg : "#fff",
                color: t.statut===val ? col : "#aaa",
              }}>{ic}<br/><span style={{fontSize:11}}>{lb}</span></button>
            ))}
          </div>

          {/* Remarque */}
          <textarea value={t.remarque} onChange={e=>setTacheRemarque(idx,e.target.value)}
            placeholder="Remarque, précision… (optionnel)"
            style={{...S.input,resize:"none",minHeight:52,fontSize:14,color:"#4a5568"}}/>
        </div>
      ))}

      {/* Ajouter tâche */}
      <div style={{padding:"0 16px 8px"}}>
        <button onClick={addTacheLibre} style={{
          width:"100%",padding:"12px",border:"1.5px dashed #c0c8d8",borderRadius:12,
          fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
          background:"transparent",color:"#8a9ab0",marginBottom:4
        }}>+ Ajouter une tâche</button>
      </div>

      {/* Besoins en commande par chantier */}
      {[...new Set(taches.filter(t=>t.chantier_id).map(t=>t.chantier_id))].map(cId => {
        const ct = taches.find(t=>t.chantier_id===cId);
        return (
          <div key={cId} style={{...S.card, border:"1.5px solid rgba(176,96,255,0.3)", background:"rgba(176,96,255,0.04)"}}>
            <span style={{...S.label, color:"#9040c0"}}>
              📦 Besoins commande
              {ct?.chantier_nom && <span style={{marginLeft:6,background:ct.chantier_couleur+"44",color:"#1a1f2e",
                borderRadius:4,padding:"0 6px",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{ct.chantier_nom}</span>}
            </span>
            <textarea
              value={besoins[cId]||""}
              onChange={e=>setBesoins(b=>({...b,[cId]:e.target.value}))}
              placeholder={"Matériaux manquants, outils à prévoir…\nEx: 10m de gaine Ø80, visserie placo..."}
              style={{...S.input,resize:"none",minHeight:80,fontSize:14,color:"#6020a0"}}/>
            <div style={{fontSize:11,color:"#9040c0",marginTop:6}}>
              ⚡ Sera transmis automatiquement dans l'onglet Commandes
            </div>
          </div>
        );
      })}

      <div style={{...S.card}}>
        <span style={S.label}>Remarque générale de la journée</span>
        <textarea value={remarque} onChange={e=>setRemarque(e.target.value)}
          placeholder="Problèmes rencontrés, informations pour le chef…"
          style={{...S.input,resize:"none",minHeight:80,fontSize:14}}/>
      </div>

      <div style={{padding:"8px 16px 32px"}}>
        <button onClick={soumettre} disabled={submitting} style={{
          width:"100%",padding:"18px",border:"none",borderRadius:14,fontSize:17,
          fontWeight:800,cursor:"pointer",fontFamily:"inherit",letterSpacing:.5,
          background:submitting?"#c0c8d8":"#1a1f2e",color:"#fff",
          boxShadow:"0 4px 20px rgba(26,31,46,0.3)",
        }}>
          {submitting ? "Envoi en cours…" : "✓ Valider mon compte rendu"}
        </button>
      </div>
    </div>
  );
}

// ─── PAGE ÉQUIPE ──────────────────────────────────────────────────────────────
function PageEquipe({chantiers, ouvriers, weekId, T}) {
  const [rapports, setRapports]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filterOuvrier, setFilterOuvrier] = useState("all");
  const [filterSemaine, setFilterSemaine] = useState(weekId);
  const [selectedRapport, setSelectedRapport] = useState(null);

  const appUrl = window.location.origin + "/rapport";
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("rapports").select("*").order("submitted_at",{ascending:false});
    if (filterOuvrier !== "all") q = q.eq("ouvrier", filterOuvrier);
    if (filterSemaine) q = q.eq("semaine", filterSemaine);
    const { data } = await q;
    setRapports(data||[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterOuvrier, filterSemaine]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("rapports-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"rapports"},()=>load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [filterOuvrier, filterSemaine]);

  const copyLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  };

  const STATUT_ICONS = { faite:"✅", en_cours:"🔄", non_faite:"❌" };

  const semaines = [];
  const now = getCurrentWeek();
  for (let i=0; i<8; i++) {
    let w = now.week - i; let y = now.year;
    if (w <= 0) { w += 52; y--; }
    semaines.push(getWeekId(y,w));
  }

  return (
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28,flexWrap:"wrap",gap:16}}>
        <div>
          <div style={{fontSize:36,fontWeight:800,letterSpacing:1,marginBottom:4}}>Équipe</div>
          <div style={{fontSize:15,color:T.textSub}}>Comptes rendus et lien mobile pour les ouvriers</div>
        </div>
        {/* Lien mobile */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:T.textMuted,marginBottom:4}}>Lien pour l'équipe</div>
            <code style={{fontSize:13,color:T.accent}}>{appUrl}</code>
          </div>
          <button onClick={copyLink} style={{background:T.accent,color:"#fff",border:"none",
            borderRadius:8,padding:"8px 16px",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
            {copied ? "✓ Copié !" : "📋 Copier le lien"}
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <select value={filterOuvrier} onChange={e=>setFilterOuvrier(e.target.value)}
          style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all" style={{background:"#1e2336"}}>Tous les ouvriers</option>
          {ouvriers.map(o=><option key={o} value={o} style={{background:"#1e2336"}}>{o}</option>)}
        </select>
        <select value={filterSemaine} onChange={e=>setFilterSemaine(e.target.value)}
          style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="" style={{background:"#1e2336"}}>Toutes les semaines</option>
          {semaines.map(s=><option key={s} value={s} style={{background:"#1e2336"}}>{s}</option>)}
        </select>
      </div>

      {/* Stats rapides */}
      {rapports.length>0&&(
        <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
          {[
            {label:"Comptes rendus",val:rapports.length,color:T.accent},
            {label:"Tâches faites",val:rapports.reduce((a,r)=>a+(r.taches||[]).filter(t=>t.statut==="faite").length,0),color:"#50c878"},
            {label:"En cours",val:rapports.reduce((a,r)=>a+(r.taches||[]).filter(t=>t.statut==="en_cours").length,0),color:"#f5a623"},
            {label:"Non faites",val:rapports.reduce((a,r)=>a+(r.taches||[]).filter(t=>t.statut==="non_faite").length,0),color:"#e05c5c"},
          ].map(s=>(
            <div key={s.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 18px",minWidth:120}}>
              <div style={{fontSize:24,fontWeight:800,color:s.color}}>{s.val}</div>
              <div style={{fontSize:12,color:T.textMuted}}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Liste des rapports */}
      {loading&&<div style={{color:T.textMuted,fontSize:15,padding:32}}>Chargement…</div>}
      {!loading&&rapports.length===0&&(
        <div style={{background:T.card,border:`1px dashed ${T.border}`,borderRadius:14,padding:"48px 32px",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:8}}>Aucun compte rendu</div>
          <div style={{fontSize:14,color:T.textSub}}>Partage le lien ci-dessus à ton équipe pour qu'ils saisissent leur compte rendu.</div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {rapports.map(r => {
          const ch = chantiers.find(c=>c.id===r.chantier_id);
          const taches = r.taches||[];
          const f=taches.filter(t=>t.statut==="faite").length;
          const ec=taches.filter(t=>t.statut==="en_cours").length;
          const nf=taches.filter(t=>t.statut==="non_faite").length;
          const isOpen = selectedRapport === r.id;
          return (
            <div key={r.id} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden",
              borderLeft:`4px solid ${ch?.couleur||T.accent}`}}>
              <div onClick={()=>setSelectedRapport(isOpen?null:r.id)}
                style={{padding:"14px 18px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                    <span style={{fontWeight:800,fontSize:16,color:T.text}}>{r.ouvrier}</span>
                    {ch&&<span style={{background:ch.couleur+"44",color:"#1a1f2e",borderRadius:4,padding:"1px 8px",fontSize:11,fontWeight:700}}>{ch.nom||r.chantier_nom}</span>}
                    <span style={{fontSize:12,color:T.textMuted}}>{r.date_rapport}</span>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {f>0&&<span style={{fontSize:13,color:"#50c878"}}>✅ {f}</span>}
                    {ec>0&&<span style={{fontSize:13,color:"#f5a623"}}>🔄 {ec}</span>}
                    {nf>0&&<span style={{fontSize:13,color:"#e05c5c"}}>❌ {nf}</span>}
                    {taches.length===0&&<span style={{fontSize:13,color:T.textMuted}}>Aucune tâche</span>}
                  </div>
                </div>
                <span style={{color:T.textMuted,fontSize:14}}>{isOpen?"▲":"▼"}</span>
              </div>
              {isOpen&&(
                <div style={{padding:"0 18px 16px",borderTop:`1px solid ${T.sectionDivider}`}}>
                  {taches.map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 0",
                      borderBottom:i<taches.length-1?`1px solid ${T.sectionDivider}`:"none"}}>
                      <span style={{fontSize:18,flexShrink:0,marginTop:1}}>{STATUT_ICONS[t.statut]||"⬜"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,color:T.text,fontWeight:600}}>{t.planifie}</div>
                        {t.remarque&&<div style={{fontSize:13,color:T.textSub,marginTop:3,fontStyle:"italic"}}>"{t.remarque}"</div>}
                      </div>
                    </div>
                  ))}
                  {r.remarque&&(
                    <div style={{marginTop:10,padding:"10px 12px",background:T.card,borderRadius:8,borderLeft:`3px solid ${T.accent}`}}>
                      <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:T.textMuted,marginBottom:4}}>Remarque générale</div>
                      <div style={{fontSize:14,color:T.text}}>{r.remarque}</div>
                    </div>
                  )}
                  <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:11,color:T.textMuted}}>
                      Soumis le {new Date(r.submitted_at).toLocaleDateString("fr-FR",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}
                    </div>
                    <button onClick={async()=>{
                      if(!confirm(`Supprimer le compte rendu de ${r.ouvrier} du ${r.date_rapport} ?`)) return;
                      await supabase.from("rapports").delete().eq("id",r.id);
                      setRapports(p=>p.filter(x=>x.id!==r.id));
                      setSelectedRapport(null);
                    }} style={{background:"transparent",border:"1px solid rgba(224,92,92,0.3)",
                      borderRadius:6,padding:"4px 12px",color:"#e05c5c",fontFamily:"inherit",
                      fontSize:12,cursor:"pointer"}}>
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function App(){
  // ─── Routage mobile ───────────────────────────────────────────────────────
  if (window.location.pathname.startsWith("/rapport")) {
    return <PageRapportMobile />;
  }
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
          {page==="equipe"&&(
            <PageEquipe chantiers={chantiers} ouvriers={ouvriers} weekId={weekId} T={T}/>
          )}
          {page==="plans"&&(
            <PagePlans T={T} chantiers={chantiers}/>
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
