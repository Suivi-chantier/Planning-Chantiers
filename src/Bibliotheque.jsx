import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, BIBLIOTHEQUE_INITIALE } from "../constants";

// ─── PAGE BIBLIOTHÈQUE ────────────────────────────────────────────────────────
function PageBibliotheque({T}) {
  const [ouvrages, setOuvrages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { loadOuvrages(); }, []);

  async function loadOuvrages() {
    setLoading(true);
    const { data } = await supabase.from("bibliotheque_ratios").select("*").order("libelle");
    if (data && data.length > 0) {
      setOuvrages(data);
    } else {
      const inserts = BIBLIOTHEQUE_INITIALE.map(o => ({
        identifiant: o.identifiant, libelle: o.libelle, unite: o.unite || "", sous_taches: o.sous_taches,
      }));
      const { data: inserted } = await supabase.from("bibliotheque_ratios").insert(inserts).select();
      setOuvrages(inserted || []);
    }
    setLoading(false);
  }

  async function saveOuvrage(ouvrage) {
    setSaving(ouvrage.id);
    const total = ouvrage.sous_taches.reduce((s, t) => s + (parseFloat(t.ratio) || 0), 0);
    if (Math.abs(total - 100) > 0.5) {
      setMsg({ type:"error", text:`⚠️ La somme des ratios doit être 100% (actuellement ${total.toFixed(1)}%)` });
      setSaving(null); return;
    }
    await supabase.from("bibliotheque_ratios").update({
      sous_taches: ouvrage.sous_taches, updated_at: new Date().toISOString(),
    }).eq("id", ouvrage.id);
    setMsg({ type:"ok", text:"✓ Ratios sauvegardés" });
    setSaving(null);
    setTimeout(() => setMsg(null), 2500);
    setEditId(null);
  }

  const categories = [
    { label:"Plâtrerie", ids:["cloison","doublage","plafond","lainage","faux_plafond","double"] },
    { label:"Électricité", ids:["install_elec","tableau","radiateur","vmc","prise","mise_a_terre"] },
    { label:"Plomberie / Sanitaire", ids:["chauffe_eau","wc","meuble_vasque","receveur"] },
    { label:"Menuiserie / Gros œuvre", ids:["porte","escalier","plancher"] },
    { label:"Finitions", ids:["peinture","parquet","ragreage"] },
  ];
  function getCat(identifiant) {
    for (const cat of categories) {
      if (cat.ids.some(k => identifiant && identifiant.startsWith(k))) return cat.label;
    }
    return "Autre";
  }
  const filtered = ouvrages.filter(o => !search || o.libelle?.toLowerCase().includes(search.toLowerCase()));
  const grouped = {};
  filtered.forEach(o => { const cat=getCat(o.identifiant); if(!grouped[cat])grouped[cat]=[]; grouped[cat].push(o); });

  return (
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:T.bg}}>
      <div style={{maxWidth:900,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
          <div>
            <div style={{fontSize:22,fontWeight:800,letterSpacing:1,color:T.text}}>📚 Bibliothèque de ratios</div>
            <div style={{fontSize:13,color:T.textMuted,marginTop:4}}>Ratios de décomposition — ajustez selon votre expérience terrain</div>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un ouvrage…"
            style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${T.border}`,background:T.inputBg,
              color:T.text,fontFamily:"inherit",fontSize:13,width:240,outline:"none"}}/>
        </div>
        {msg&&(
          <div style={{padding:"10px 16px",borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,
            background:msg.type==="ok"?"rgba(80,200,120,0.12)":"rgba(224,92,92,0.12)",
            color:msg.type==="ok"?"#50c878":"#e05c5c",
            border:`1px solid ${msg.type==="ok"?"rgba(80,200,120,0.3)":"rgba(224,92,92,0.3)"}`}}>
            {msg.text}
          </div>
        )}
        {loading ? (
          <div style={{color:T.textMuted,textAlign:"center",padding:60}}>Chargement…</div>
        ) : (
          Object.entries(grouped).map(([cat,items])=>(
            <div key={cat} style={{marginBottom:32}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:3,textTransform:"uppercase",
                color:T.accent,marginBottom:12,paddingLeft:2}}>{cat}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {items.map(ouvrage=>{
                  const isEdit=editId===ouvrage.id;
                  const editData=isEdit?ouvrages.find(o=>o.id===ouvrage.id):ouvrage;
                  const total=(editData.sous_taches||[]).reduce((s,t)=>s+(parseFloat(t.ratio)||0),0);
                  return(
                    <div key={ouvrage.id} style={{background:T.surface,border:`1px solid ${isEdit?T.accent:T.border}`,
                      borderRadius:12,overflow:"hidden",transition:"border .2s"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"12px 16px",cursor:"pointer"}} onClick={()=>setEditId(isEdit?null:ouvrage.id)}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:13,fontWeight:700,color:T.text}}>{ouvrage.libelle}</span>
                          <span style={{fontSize:11,color:T.textMuted,background:T.card,padding:"2px 8px",borderRadius:4}}>{ouvrage.unite}</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:T.textMuted}}>{(ouvrage.sous_taches||[]).length} tâches</span>
                          <span style={{fontSize:12,color:isEdit?T.accent:T.textMuted}}>{isEdit?"▲":"▼"}</span>
                        </div>
                      </div>
                      {isEdit&&(
                        <div style={{padding:"0 16px 16px",borderTop:`1px solid ${T.sectionDivider}`}}>
                          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
                            {(editData.sous_taches||[]).map((tache,idx)=>(
                              <div key={idx} style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{flex:1,padding:"8px 12px",background:T.fieldBg,borderRadius:8,fontSize:13,color:T.text}}>{tache.nom}</div>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <input type="number" min="0" max="100" step="1" value={tache.ratio}
                                    onChange={e=>{
                                      const updated=ouvrages.map(o=>{
                                        if(o.id!==ouvrage.id)return o;
                                        const st=[...o.sous_taches];
                                        st[idx]={...st[idx],ratio:parseFloat(e.target.value)||0};
                                        return{...o,sous_taches:st};
                                      });
                                      setOuvrages(updated);
                                    }}
                                    style={{width:60,padding:"6px 8px",borderRadius:6,textAlign:"center",
                                      border:`1px solid ${T.border}`,background:T.inputBg,color:T.text,
                                      fontFamily:"inherit",fontSize:14,fontWeight:700,outline:"none"}}/>
                                  <span style={{fontSize:13,color:T.textMuted}}>%</span>
                                </div>
                                <div style={{width:80,height:6,background:T.border,borderRadius:3}}>
                                  <div style={{height:"100%",borderRadius:3,background:T.accent,
                                    width:`${Math.min(tache.ratio,100)}%`,transition:"width .2s"}}/>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12}}>
                            <div style={{fontSize:13,fontWeight:700,color:Math.abs(total-100)<0.5?"#50c878":"#e05c5c"}}>
                              Total : {total.toFixed(0)}% {Math.abs(total-100)<0.5?"✓":"⚠️ doit être 100%"}
                            </div>
                            <button onClick={()=>saveOuvrage(editData)} disabled={saving===ouvrage.id}
                              style={{padding:"8px 20px",borderRadius:8,border:"none",background:T.accent,
                                color:"#111",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                              {saving===ouvrage.id?"…":"Sauvegarder"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default PageBibliotheque;
