import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS } from "./constants";

// ─── PAGE DASHBOARD ───────────────────────────────────────────────────────────
function PageDashboard({chantiers,cells,commandes,notesData,weekId,T}){
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
      <div className="dashboard-row-1" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:20,marginBottom:20}}>

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
      <div className="dashboard-row-2" style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:20,marginBottom:24}}>

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

export default PageDashboard;
