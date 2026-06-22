import React, { useState, useEffect, useRef } from "react";
import { supabase, photoTransform } from "../supabase";
import { JOURS, STATUTS, emptyCell, parseTachesFromPlanifie } from "../constants";

function CellModal({chantier,jour,draft,setDraft,commande,note,ouvriers,vehicules=[],saving,onClose,T,weekId,year,week}){
  if(!chantier)return null;

  const [rapports, setRapports] = useState([]);
  const [loadingRapports, setLoadingRapports] = useState(true);
  // Lightbox plein écran pour les photos du compte rendu
  const [lightbox, setLightbox] = useState(null); // { urls: string[], idx: number }

  // Calculer la date réelle du jour sélectionné
  const getDateDuJour = () => {
    const JOURS_ORDER = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi"];
    const dayIndex = JOURS_ORDER.indexOf(jour);
    if (dayIndex < 0 || !year || !week) return null;
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d.toLocaleDateString("fr-FR"); // format dd/mm/yyyy
  };

  useEffect(() => {
    const load = async () => {
      setLoadingRapports(true);
      const dateKey = getDateDuJour();
      if (!dateKey || !chantier?.id) { setLoadingRapports(false); return; }
      const { data } = await supabase
        .from("rapports")
        .select("*")
        .eq("chantier_id", chantier.id)
        .eq("date_rapport", dateKey);
      setRapports(data || []);
      setLoadingRapports(false);
    };
    load();
  }, [chantier?.id, jour, weekId]);

  const toggleOuvrier=(o)=>{
    const list=[...(draft.ouvriers||[])];
    const i=list.indexOf(o);if(i>=0)list.splice(i,1);else list.push(o);
    setDraft(p=>({...p,ouvriers:list}));
  };

  const toggleVehicule=(v)=>{
    const list=[...(draft.vehicules||[])];
    const i=list.findIndex(x=>x.id===v.id);
    if(i>=0)list.splice(i,1);
    else list.push({id:v.id,nom:v.nom,immatriculation:v.immatriculation||""});
    setDraft(p=>({...p,vehicules:list}));
  };

  const statutIcon = (s) => s==="faite"?"✅":s==="en_cours"?"🔄":"❌";
  const statutColor = (s) => s==="faite"?"#50c878":s==="en_cours"?"#f5a623":"#e05c5c";

  // Cumul des heures planifiées par ouvrier pour ce jour (mis à jour en direct).
  // Une tâche sans ouvrier assigné est « visible par tous » → comptée pour chacun.
  const cumulParOuvrier = {};
  (draft.ouvriers||[]).forEach(o=>{ cumulParOuvrier[o]=0; });
  (draft.taches||[]).forEach(t=>{
    const d = parseFloat(t.duree)||0;
    if(!d) return;
    const assignes = (t.ouvriers||[]).filter(o=>(draft.ouvriers||[]).includes(o));
    const cibles = assignes.length>0 ? assignes : (draft.ouvriers||[]);
    cibles.forEach(o=>{ cumulParOuvrier[o]+=d; });
  });

  return(
    <div className="cell-modal-backdrop" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:500,
      display:"flex",alignItems:"center",
      justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}
      onClick={onClose}>
      <style>{`
        @media (max-width:767px) {
          .cm-header{padding:14px 16px!important}
          .cm-title{font-size:18px!important;letter-spacing:.3px!important}
          .cm-day-label{font-size:10px!important;letter-spacing:2px!important}
          .cm-close{width:36px!important;height:36px!important;font-size:18px!important}
          .cm-body-left{padding:14px 14px 8px!important;border-right:none!important;border-bottom:1px solid ${T.sectionDivider}}
          .cm-body-right{padding:14px 14px 14px!important;gap:12px!important}
          .cm-section-title{font-size:10px!important;letter-spacing:1.5px!important;margin-bottom:6px!important}
          .cm-task-row{flex-wrap:wrap!important;gap:6px!important}
          .cm-task-textarea{min-height:60px!important;width:100%!important;flex:1 1 100%!important}
          .cm-task-duree{order:2;flex:0 0 auto!important}
          .cm-task-del{order:3;flex:0 0 auto!important}
          .cm-ouvrier-btn{padding:8px 12px!important;font-size:13px!important;min-height:34px}
          .cm-footer{padding:12px 14px!important;flex-wrap:wrap!important;gap:8px!important}
          .cm-footer-text{flex:1 1 100%!important;order:2;font-size:11px!important}
          .cm-footer-btns{flex:1 1 100%!important;order:1;display:flex!important;gap:8px!important}
          .cm-footer-btns button{flex:1}
          .cm-textarea-cmd{min-height:120px!important}
          .cm-textarea-note{min-height:90px!important}
          .cm-textarea-reel{min-height:60px!important}
        }
      `}</style>
      <div className="cell-modal-box" style={{background:T.modal,
        borderRadius:18,
        width:"100%", maxWidth:860,
        maxHeight:"92vh",
        overflow:"hidden",display:"flex",flexDirection:"column",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.5)",border:`1px solid ${T.border}`}}
        onClick={e=>e.stopPropagation()}>
        <div className="cm-header" style={{background:chantier.couleur,padding:"20px 28px",display:"flex",
          alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{minWidth:0,flex:1}}>
            <div className="cm-day-label" style={{fontSize:11,fontWeight:700,letterSpacing:3,textTransform:"uppercase",
              color:"rgba(0,0,0,0.4)",marginBottom:3}}>{jour}</div>
            <div className="cm-title" style={{fontSize:26,fontWeight:800,letterSpacing:1,color:"#1a1f2e",textTransform:"uppercase",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{chantier.nom}</div>
          </div>
          <button onClick={onClose} className="cm-close" style={{background:"rgba(0,0,0,0.12)",border:"none",
            borderRadius:10,width:40,height:40,cursor:"pointer",fontSize:20,flexShrink:0,marginLeft:10,
            color:"#1a1f2e",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button>
        </div>
        <div className="cell-modal-body" style={{flex:1,overflow:"auto",display:"grid",
          gridTemplateColumns:"1fr 320px",minHeight:0}}>
          <div className="cm-body-left" style={{padding:"24px 20px 24px 28px",display:"flex",flexDirection:"column",gap:16,
            overflowY:"auto",borderRight:`1px solid ${T.sectionDivider}`}}>

            {/* ── TÂCHES STRUCTURÉES ── */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted}}>📋 Tâches planifiées</div>
                <span style={{fontSize:11,color:T.textMuted}}>Assigne des ouvriers à chaque tâche</span>
              </div>

              {/* ── Cumul des heures par ouvrier (ce jour) ── */}
              {(draft.ouvriers||[]).length>0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",
                  background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,borderRadius:10,padding:"8px 10px"}}>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
                    color:T.textMuted,marginRight:2}}>⏱ Cumul jour</span>
                  {(draft.ouvriers||[]).map(o=>{
                    const h=cumulParOuvrier[o]||0;
                    return(
                      <span key={o} style={{display:"inline-flex",alignItems:"center",gap:5,
                        background:chantier.couleur+"22",border:`1px solid ${chantier.couleur}55`,
                        borderRadius:8,padding:"3px 9px",fontSize:12.5}}>
                        <strong style={{color:T.text,fontWeight:700}}>{o}</strong>
                        <span style={{color:h>0?T.text:T.textMuted,fontWeight:800}}>{h}h</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {(draft.taches||[]).map((tache,idx)=>(
                <div key={tache.id} style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:10,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
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
                    <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,
                      background:T.fieldBg,border:`1px solid ${T.border}`,borderRadius:7,padding:"4px 8px"}}>
                      <span style={{fontSize:12,color:T.textMuted}}>⏱</span>
                      <input
                        type="number" min="0.25" max="24" step="0.25"
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

            {/* ── COMPTES RENDUS OUVRIERS ── */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:2}}>
                ✅ Réel effectué — Comptes rendus ouvriers
              </div>

              {loadingRapports ? (
                <div style={{color:T.textMuted,fontSize:13,padding:"10px 0"}}>Chargement…</div>
              ) : rapports.length === 0 ? (
                <div style={{
                  background:T.fieldBg, border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:10, padding:"14px 16px",
                  color:T.textMuted, fontSize:13, fontStyle:"italic"
                }}>
                  Aucun compte rendu soumis pour ce jour.
                </div>
              ) : (
                rapports.map(rapport => (
                  <div key={rapport.id} style={{
                    background:T.fieldBg, border:`1.5px solid ${T.fieldBorder}`,
                    borderRadius:12, overflow:"hidden",
                  }}>
                    {/* En-tête ouvrier */}
                    <div style={{
                      background: chantier.couleur + "33",
                      padding:"10px 14px",
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      borderBottom:`1px solid ${T.fieldBorder}`,
                    }}>
                      <div style={{fontWeight:800, fontSize:14, color:T.text}}>
                        👷 {rapport.ouvrier}
                      </div>
                      {rapport.remarque && (
                        <div style={{fontSize:12, color:T.textMuted, fontStyle:"italic", maxWidth:"60%", textAlign:"right"}}>
                          💬 {rapport.remarque}
                        </div>
                      )}
                    </div>

                    {/* Tâches du rapport */}
                    <div style={{display:"flex",flexDirection:"column",gap:0}}>
                      {(rapport.taches||[]).map((t,i)=>(
                        <div key={i} style={{
                          padding:"10px 14px",
                          borderBottom: i < rapport.taches.length-1 ? `1px solid ${T.fieldBorder}` : "none",
                          display:"flex", flexDirection:"column", gap:4,
                        }}>
                          {/* Ligne principale */}
                          <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                            <span style={{fontSize:15}}>{statutIcon(t.statut)}</span>
                            <span style={{flex:1, fontSize:13, fontWeight:600, color:T.text, lineHeight:1.4}}>
                              {t.planifie}
                            </span>
                            {/* Durée */}
                            {t.heures_reelles > 0 && (
                              <span style={{
                                background:"rgba(91,138,245,0.12)", color:"#5b8af5",
                                borderRadius:6, padding:"2px 8px", fontSize:12, fontWeight:700, flexShrink:0,
                              }}>⏱ {t.heures_reelles}h</span>
                            )}
                            {/* Avancement */}
                            {(t.avancement !== undefined && t.avancement !== null && t.avancement !== "") && (
                              <span style={{
                                background: parseInt(t.avancement)===100 ? "rgba(80,200,120,0.15)" : "rgba(139,92,246,0.12)",
                                color: parseInt(t.avancement)===100 ? "#50c878" : "#8b5cf6",
                                borderRadius:6, padding:"2px 8px", fontSize:12, fontWeight:700, flexShrink:0,
                              }}>📊 {t.avancement}%</span>
                            )}
                          </div>
                          {/* Barre avancement */}
                          {(t.avancement !== undefined && t.avancement !== null && t.avancement !== "") && (
                            <div style={{height:3, background:T.fieldBorder, borderRadius:2, marginTop:2, overflow:"hidden"}}>
                              <div style={{
                                height:"100%", borderRadius:2,
                                background: parseInt(t.avancement)===100 ? "#50c878" : "#8b5cf6",
                                width:`${t.avancement}%`, transition:"width .3s",
                              }}/>
                            </div>
                          )}
                          {/* Remarque tâche */}
                          {t.remarque && (
                            <div style={{fontSize:12, color:T.textMuted, fontStyle:"italic", paddingLeft:23}}>
                              ↳ {t.remarque}
                            </div>
                          )}
                          {/* Photos liées à la tâche */}
                          {(t.photos||[]).length>0 && (
                            <div style={{display:"flex",flexWrap:"wrap",gap:5,paddingLeft:23,marginTop:4}}>
                              {t.photos.map((url,pi)=>(
                                <img key={pi} src={photoTransform(url,{width:128,height:128})} alt="" loading="lazy"
                                  onClick={()=>setLightbox({urls:t.photos,idx:pi})}
                                  style={{width:54,height:54,objectFit:"cover",borderRadius:6,
                                    border:`1px solid ${T.fieldBorder}`,cursor:"pointer",display:"block"}}/>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Photos générales du chantier sur ce rapport */}
                    {(rapport.photos_chantier||[]).length>0 && (
                      <div style={{padding:"10px 14px",borderTop:`1px solid ${T.fieldBorder}`,background:"rgba(255,255,255,0.02)"}}>
                        <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>
                          📷 Photos du chantier · {rapport.photos_chantier.length}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {rapport.photos_chantier.map((url,pi)=>(
                            <img key={pi} src={photoTransform(url,{width:160,height:160})} alt="" loading="lazy"
                              onClick={()=>setLightbox({urls:rapport.photos_chantier,idx:pi})}
                              style={{width:64,height:64,objectFit:"cover",borderRadius:8,
                                border:`1px solid ${T.fieldBorder}`,cursor:"pointer",display:"block"}}/>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* ── RÉEL EFFECTUÉ (textarea manuel) ── */}
            <div style={{display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
                ✏️ Note réel complémentaire
              </div>
              <textarea className="cm-textarea-reel" value={draft.reel||""} onChange={e=>setDraft(p=>({...p,reel:e.target.value}))}
                placeholder="Complément ou correction manuelle…"
                style={{minHeight:80,width:"100%",background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.reelColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
            </div>

            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>👷 Ouvriers assignés</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {ouvriers.map(o=>{
                  const sel=(draft.ouvriers||[]).includes(o);
                  return(
                    <button key={o} onClick={()=>toggleOuvrier(o)} className="cm-ouvrier-btn" style={{
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

            {/* ── VÉHICULES ── */}
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>🚐 Véhicules</div>
              {vehicules.length===0 ? (
                <div style={{fontSize:13,color:T.textMuted,fontStyle:"italic"}}>
                  Aucun véhicule enregistré. Ajoutez-en dans Réglages → Véhicules.
                </div>
              ) : (
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {vehicules.map(v=>{
                    const sel=(draft.vehicules||[]).some(x=>x.id===v.id);
                    return(
                      <button key={v.id} onClick={()=>toggleVehicule(v)} className="cm-ouvrier-btn" style={{
                        display:"flex",flexDirection:"column",alignItems:"flex-start",
                        padding:"7px 14px",borderRadius:10,fontSize:14,fontWeight:700,
                        cursor:"pointer",fontFamily:"inherit",transition:"all .12s",
                        background:sel?chantier.couleur:T.fieldBg,
                        border:`2px solid ${sel?"rgba(0,0,0,0.15)":T.border}`,
                        color:sel?"#1a1f2e":T.textSub,
                        transform:sel?"scale(1.03)":"scale(1)",
                        boxShadow:sel?"0 2px 8px rgba(0,0,0,0.15)":"none",
                      }}>
                        <span>{v.nom}</span>
                        {v.immatriculation && (
                          <span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",letterSpacing:1,
                            opacity:sel?0.7:0.8,marginTop:1}}>{v.immatriculation}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="cm-body-right" style={{padding:"24px 28px 24px 20px",display:"flex",flexDirection:"column",gap:16,overflowY:"auto"}}>
            <div style={{flex:1,display:"flex",flexDirection:"column"}}>
              <div className="cm-section-title" style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>📦 Commandes à prévoir</div>
              <textarea className="cm-textarea-cmd" value={commande.value||""} onChange={e=>commande.set(e.target.value)}
                placeholder={"Matériaux\nLivraisons\nOutillage…"}
                style={{flex:1,minHeight:180,width:"100%",background:T.cmdBg,border:`1.5px solid ${T.cmdBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.cmdColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column"}}>
              <div className="cm-section-title" style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>🗒️ Notes chantier</div>
              <textarea className="cm-textarea-note" value={note.value||""} onChange={e=>note.set(e.target.value)}
                placeholder={"Code d'accès\nContact client\nInfos permanentes…"}
                style={{minHeight:120,width:"100%",background:T.noteBg,border:`1.5px solid ${T.noteBorder}`,
                  borderRadius:12,padding:"14px 16px",color:T.noteColor,fontSize:14,lineHeight:1.7,
                  resize:"none",fontFamily:"inherit",outline:"none"}}/>
              <div style={{fontSize:11,color:T.textMuted,marginTop:6}}>Notes permanentes — visibles toutes les semaines.</div>
            </div>
          </div>
        </div>

        <div className="cm-footer" style={{padding:"16px 28px",borderTop:`1px solid ${T.border}`,display:"flex",
          justifyContent:"space-between",alignItems:"center",flexShrink:0,background:T.modal}}>
          <div className="cm-footer-text" style={{fontSize:12,color:T.textMuted}}>
            {(draft.ouvriers||[]).length>0?`👷 ${(draft.ouvriers||[]).join(", ")}`:"Aucun ouvrier sélectionné"}
            {(draft.vehicules||[]).length>0 && <span> · 🚐 {(draft.vehicules||[]).map(v=>v.nom).join(", ")}</span>}
          </div>
          <div className="cm-footer-btns" style={{display:"flex",gap:10}}>
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

      {/* ── Lightbox plein écran (photos compte rendu) ── */}
      {lightbox && (
        <div onClick={(e)=>{ e.stopPropagation(); setLightbox(null); }} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20,
        }}>
          <button onClick={(e)=>{ e.stopPropagation(); setLightbox(null); }} style={{
            position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.1)",border:"none",
            borderRadius:10,width:42,height:42,color:"#fff",fontSize:22,fontWeight:700,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>✕</button>
          {lightbox.urls.length > 1 && (
            <>
              <button onClick={(e)=>{ e.stopPropagation(); setLightbox(lb=>({...lb,idx:(lb.idx-1+lb.urls.length)%lb.urls.length})); }} style={{
                position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",
                background:"rgba(255,255,255,0.1)",border:"none",borderRadius:10,
                width:48,height:48,color:"#fff",fontSize:24,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>‹</button>
              <button onClick={(e)=>{ e.stopPropagation(); setLightbox(lb=>({...lb,idx:(lb.idx+1)%lb.urls.length})); }} style={{
                position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",
                background:"rgba(255,255,255,0.1)",border:"none",borderRadius:10,
                width:48,height:48,color:"#fff",fontSize:24,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>›</button>
              <div style={{
                position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",
                color:"rgba(255,255,255,0.75)",fontSize:13,fontWeight:600,
                background:"rgba(0,0,0,0.5)",padding:"4px 10px",borderRadius:12,
              }}>{lightbox.idx + 1} / {lightbox.urls.length}</div>
            </>
          )}
          <img src={photoTransform(lightbox.urls[lightbox.idx],{width:1920,height:1920,resize:"contain",quality:80})} alt=""
            onClick={(e)=>e.stopPropagation()}
            style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:6,cursor:"default"}}/>
        </div>
      )}
    </div>
  );
}

export default CellModal;
