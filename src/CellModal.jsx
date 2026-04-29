import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { JOURS, STATUTS, emptyCell, parseTachesFromPlanifie } from "./constants";

function CellModal({chantier,jour,draft,setDraft,commande,note,ouvriers,saving,onClose,T,weekId,year,week}){
  if(!chantier)return null;

  const [rapports, setRapports] = useState([]);
  const [loadingRapports, setLoadingRapports] = useState(true);

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

  const statutIcon = (s) => s==="faite"?"✅":s==="en_cours"?"🔄":"❌";
  const statutColor = (s) => s==="faite"?"#50c878":s==="en_cours"?"#f5a623":"#e05c5c";

  return(
    <div className="cell-modal-backdrop" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:500,
      display:"flex",alignItems:"center",
      justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}
      onClick={onClose}>
      <div className="cell-modal-box" style={{background:T.modal,
        borderRadius:18,
        width:"100%", maxWidth:860,
        maxHeight:"92vh",
        overflow:"hidden",display:"flex",flexDirection:"column",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.5)",border:`1px solid ${T.border}`}}
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
        <div className="cell-modal-body" style={{flex:1,overflow:"hidden",display:"grid",
          gridTemplateColumns:"1fr 320px",minHeight:0}}>
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
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── RÉEL EFFECTUÉ (textarea manuel) ── */}
            <div style={{display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
                ✏️ Note réel complémentaire
              </div>
              <textarea value={draft.reel||""} onChange={e=>setDraft(p=>({...p,reel:e.target.value}))}
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

export default CellModal;
