import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { THEMES, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, getWeekId, getCurrentWeek, LOGO_HORIZ } from "./constants";

import { Sidebar, BottomNav } from "./components/Navigation";
import PageDashboard    from "./pages/Dashboard";
import PagePlanning     from "./pages/Planning";
import PageCommandes    from "./pages/Commandes";
import PageEquipe       from "./pages/Equipe";
import PagePlans        from "./pages/Plans";
import PagePhasage      from "./pages/Phasage";
import PageBibliotheque from "./pages/Bibliotheque";
import PageAdmin        from "./pages/Admin";
import PageRapportMobile from "./pages/RapportMobile";

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MainApp(){
  const{year:iY,week:iW}=getCurrentWeek();
  const[year,setYear]=useState(iY);
  const[week,setWeek]=useState(iW);
  const[page,setPage]=useState("dashboard");
  const[theme,setTheme]=useState(()=>localStorage.getItem("theme")||"dark");
  const[view,setView]=useState("planifie");

  const[ouvriers,setOuvriers]=useState(DEFAULT_OUVRIERS);
  const[ouvrierEmails,setOuvrierEmails]=useState({});
  const[tauxHoraires,setTauxHoraires]=useState({});
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
        if(r.key==="taux_horaires")setTauxHoraires(r.value||{});
        if(r.key==="chantiers")setChantiers(r.value);
        if(r.key==="ouvrier_emails")setOuvrierEmails(r.value||{});
      });
      const{data:cd}=await supabase.from("planning_cells").select("*").eq("week_id",weekId);
      if(cd){const m={};cd.forEach(r=>{m[`${r.chantier_id}_${r.jour}`]={planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[],taches:r.taches||[]};});setCells(m);}
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
        else setCells(prev=>({...prev,[key]:{planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[],taches:r.taches||[]}}));
        setLastSync(new Date());
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"planning_config"},p=>{
        const r=p.new;if(!r)return;
        if(r.key==="ouvriers")setOuvriers(r.value);
        if(r.key==="chantiers")setChantiers(r.value);
        if(r.key==="taux_horaires")setTauxHoraires(r.value||{});
        if(r.key==="ouvrier_emails")setOuvrierEmails(r.value||{});
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

  // CSS global injecté dynamiquement selon le thème
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
    .tab.on{background:${T.accent};color:#111;font-weight:800}
    .tab.off{background:${T.card};color:${T.textSub};border:1px solid ${T.border}}
    .tab.off:hover{background:${T.cardHover};color:${T.text}}
    .btn-p{background:${T.accent};color:#111;border:none;border-radius:6px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
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
    .bottom-nav-mobile{display:none!important}
    @media (max-width: 767px) {
      .app-sidebar{display:none!important}
      .bottom-nav-mobile{display:flex!important;position:fixed;bottom:0;left:0;right:0;z-index:200;
        background:#080a0d;border-top:2px solid #FFC200;align-items:stretch;
        padding-bottom:env(safe-area-inset-bottom)}
      .page-content-area{padding-bottom:64px!important}
      .page-padding{padding:14px 12px!important}
      .app-topbar{padding:10px 14px!important}
      .topbar-logo-mobile{display:block!important}
      .topbar-text-desktop{display:none!important}
      .planning-header{padding:10px 12px!important;flex-wrap:wrap;gap:8px!important}
      .planning-title{font-size:15px!important}
      .navbtn-today{display:none!important}
      .btn-print{display:none!important}
      .dashboard-row-1,.dashboard-row-2{grid-template-columns:1fr!important;gap:12px!important}
      .cell-modal-backdrop{align-items:flex-end!important}
      .cell-modal-box{border-radius:20px 20px 0 0!important;max-height:94vh!important;max-width:100%!important}
      .cell-modal-body{grid-template-columns:1fr!important}
      .tab{padding:6px 10px!important;font-size:12px!important}
      .table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
    }
  `;

  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{css}</style>
      <div className="app-sidebar"><Sidebar page={page} setPage={setPage} T={T}/></div>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
        <div className="app-topbar" style={{background:T.surface,borderBottom:`2px solid #FFC200`,
          padding:"8px 28px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <img src={LOGO_HORIZ} alt="Profero" className="topbar-logo-mobile" style={{height:26,objectFit:"contain",display:"none"}}/>
          <div className="topbar-text-desktop" style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,194,0,0.5)",textTransform:"uppercase"}}>
            Profero · Planning
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:T.card,borderRadius:8,fontSize:12,color:T.textSub}}>
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
        <div className="page-content-area" style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          {page==="dashboard"&&<PageDashboard chantiers={chantiers} cells={cells} commandes={commandes} notesData={notesData} weekId={weekId} T={T}/>}
          {page==="planning"&&<PagePlanning chantiers={chantiers} ouvriers={ouvriers} ouvrierEmails={ouvrierEmails} cells={cells} setCells={setCells} commandes={commandes} setCommandes={setCommandes} notesData={notesData} setNotesData={setNotesData} weekId={weekId} view={view} setView={setView} year={year} week={week} setYear={setYear} setWeek={setWeek} T={T}/>}
          {page==="commandes"&&<PageCommandes chantiers={chantiers} T={T}/>}
          {page==="equipe"&&<PageEquipe chantiers={chantiers} ouvriers={ouvriers} weekId={weekId} cells={cells} T={T}/>}
          {page==="plans"&&<PagePlans T={T} chantiers={chantiers}/>}
          {page==="phasage"&&<PagePhasage chantiers={chantiers} ouvriers={ouvriers} tauxHoraires={tauxHoraires} T={T}/>}
          {page==="bibliotheque"&&<PageBibliotheque T={T}/>}
          {page==="admin"&&<PageAdmin ouvriers={ouvriers} setOuvriers={setOuvriers} ouvrierEmails={ouvrierEmails} setOuvrierEmails={setOuvrierEmails} tauxHoraires={tauxHoraires} setTauxHoraires={setTauxHoraires} chantiers={chantiers} setChantiers={setChantiers} saveConfig={saveConfig} theme={theme} setTheme={setTheme} T={T}/>}
        </div>
      </div>
      <BottomNav page={page} setPage={setPage} T={T}/>
    </div>
  );
}

// ─── ROUTEUR RACINE ───────────────────────────────────────────────────────────
export default function App(){
  if (window.location.pathname.startsWith("/rapport")) {
    return <PageRapportMobile />;
  }
  return <MainApp />;
}
