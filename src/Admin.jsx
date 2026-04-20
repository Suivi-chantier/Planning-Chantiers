import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS } from "./constants";

// ─── PAGE ADMIN ───────────────────────────────────────────────────────────────
function PageAdmin({ouvriers,setOuvriers,ouvrierEmails,setOuvrierEmails,tauxHoraires,setTauxHoraires,chantiers,setChantiers,saveConfig,theme,setTheme,T}){
  const [adminTab,setAdminTab]=useState("ouvriers");
  const [newOuvrier,setNewOuvrier]=useState("");
  const [editOuvrier,setEditOuvrier]=useState(null);
  const [newNom,setNewNom]=useState("");
  const [newColor,setNewColor]=useState(COULEURS_PALETTE[0]);
  const [editChIdx,setEditChIdx]=useState(null);

  const addOuvrier=()=>{if(!newOuvrier.trim())return;const u=[...ouvriers,newOuvrier.trim()];setOuvriers(u);saveConfig("ouvriers",u);setNewOuvrier("");};
  const removeOuvrier=i=>{const u=ouvriers.filter((_,idx)=>idx!==i);setOuvriers(u);saveConfig("ouvriers",u);};
  const renameOuvrier=(i,v,email)=>{
    const oldNom=ouvriers[i];
    const u=ouvriers.map((o,idx)=>idx===i?v:o);
    setOuvriers(u);saveConfig("ouvriers",u);
    const ne={...ouvrierEmails};delete ne[oldNom];
    if(email?.trim())ne[v]=email.trim();
    setOuvrierEmails(ne);saveConfig("ouvrier_emails",ne);
    setEditOuvrier(null);
  };
  const moveOuvrier=(i,d)=>{const a=[...ouvriers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setOuvriers(a);saveConfig("ouvriers",a);};
  const addChantier=()=>{if(!newNom.trim())return;const id=newNom.trim().toLowerCase().replace(/\s+/g,"-")+"-"+Date.now();const nc={id,nom:newNom.trim().toUpperCase(),couleur:newColor};const u=[...chantiers,nc];setChantiers(u);saveConfig("chantiers",u);setNewNom("");};
  const removeChantier=i=>{const u=chantiers.filter((_,idx)=>idx!==i);setChantiers(u);saveConfig("chantiers",u);};
  const updateChantier=(i,ch)=>{const u=chantiers.map((c,idx)=>idx===i?{...c,...ch}:c);setChantiers(u);saveConfig("chantiers",u);};
  const moveChantier=(i,d)=>{const a=[...chantiers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setChantiers(a);saveConfig("chantiers",a);};

  return(
    <div style={{flex:1,overflowY:"auto",padding: "16px"}}>
      <div style={{fontSize:24,fontWeight:800,letterSpacing:1,marginBottom:4}}>Réglages</div>
      <div style={{color:T.textSub,fontSize:14,marginBottom:24}}>Modifications appliquées immédiatement pour toute l'équipe.</div>
      <div style={{display:"flex",gap:4,marginBottom:22,borderBottom:`1px solid ${T.border}`,paddingBottom:8}}>
        {[["ouvriers","👷 Ouvriers"],["taux","💰 Taux horaires"],["chantiers","🏗️ Chantiers"],["apparence","🎨 Apparence"]].map(([k,l])=>(
          <button key={k} className={`atab ${adminTab===k?"on":"off"}`} onClick={()=>setAdminTab(k)}>{l}</button>
        ))}
      </div>

      {adminTab==="taux"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Taux horaires</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>
            Coût horaire de chaque ouvrier — utilisé pour calculer le coût MO dans le phasage.
          </div>
          {ouvriers.map((o,i)=>(
            <div key={i} className="ar" style={{gap:12}}>
              <div style={{flex:1,fontWeight:700,fontSize:15,color:T.text}}>{o}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input
                  type="number" min="0" step="0.5"
                  value={tauxHoraires?.[o]||""}
                  onChange={e=>{
                    const t={...tauxHoraires,[o]:parseFloat(e.target.value)||0};
                    setTauxHoraires(t);
                    saveConfig("taux_horaires",t);
                  }}
                  placeholder="0"
                  style={{width:80,padding:"7px 10px",borderRadius:8,textAlign:"center",
                    border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                    fontFamily:"inherit",fontSize:15,fontWeight:700,outline:"none"}}
                />
                <span style={{fontSize:13,color:T.textMuted}}>€/h</span>
              </div>
              {tauxHoraires?.[o]>0&&(
                <span style={{fontSize:12,color:T.textMuted}}>
                  = {(tauxHoraires[o]*8).toFixed(0)}€/jour
                </span>
              )}
            </div>
          ))}
          {ouvriers.length===0&&(
            <div style={{color:T.textMuted,fontStyle:"italic",fontSize:13}}>
              Ajoutez d'abord des ouvriers dans l'onglet Ouvriers.
            </div>
          )}
        </div>
      )}

      {adminTab==="ouvriers"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Liste des ouvriers</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>Nom + email — l'email permet d'inviter automatiquement sur Google Agenda.</div>
          {ouvriers.map((o,i)=>(
            <div key={i} className="ar" style={{flexWrap:"wrap",gap:6}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveOuvrier(i,-1)}>▲</button>
                <button className="ib" onClick={()=>moveOuvrier(i,1)}>▼</button>
              </div>
              {editOuvrier?.index===i
                ?<>
                  <input className="ti" value={editOuvrier.value} placeholder="Prénom"
                    style={{flex:"1 1 80px",minWidth:70}}
                    onChange={e=>setEditOuvrier({...editOuvrier,value:e.target.value})}
                    onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value,editOuvrier.email);if(e.key==="Escape")setEditOuvrier(null);}}
                    autoFocus/>
                  <input className="ti" value={editOuvrier.email||""} placeholder="email@exemple.com"
                    style={{flex:"2 1 160px",minWidth:140}}
                    onChange={e=>setEditOuvrier({...editOuvrier,email:e.target.value})}
                    onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value,editOuvrier.email);if(e.key==="Escape")setEditOuvrier(null);}}/>
                  <button className="btn-p" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>renameOuvrier(i,editOuvrier.value,editOuvrier.email)}>✓</button>
                  <button className="btn-g" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>setEditOuvrier(null)}>✕</button>
                </>
                :<>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{fontWeight:700,fontSize:15}}>{o}</div>
                    {ouvrierEmails?.[o]
                      ?<div style={{fontSize:12,color:T.textMuted,marginTop:1}}>{ouvrierEmails[o]}</div>
                      :<div style={{fontSize:11,color:"#e06060",fontStyle:"italic",marginTop:1}}>Pas d'email — cliquer ✏️ pour ajouter</div>}
                  </div>
                  <button className="ib" onClick={()=>setEditOuvrier({index:i,value:o,email:ouvrierEmails?.[o]||""})}>✏️</button>
                  <button className="btn-d" onClick={()=>removeOuvrier(i)}>Supprimer</button>
                </>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap"}}>
            <input className="ti" value={newOuvrier} onChange={e=>setNewOuvrier(e.target.value)}
              placeholder="Prénom ou initiales…" style={{flex:1,minWidth:120}}
              onKeyDown={e=>e.key==="Enter"&&addOuvrier()}/>
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

export default PageAdmin;
