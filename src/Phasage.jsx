import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, getCurrentWeek, getWeekId } from "./constants";

// ─── PAGE PHASAGE ─────────────────────────────────────────────────────────────
function PagePhasage({chantiers,ouvriers,tauxHoraires,T}) {
  const [phasages,setPhasages]=useState([]);
  const [bibliotheque,setBibliotheque]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);
  const [showNew,setShowNew]=useState(false);
  const [newChantier,setNewChantier]=useState("");

  useEffect(()=>{loadAll();},[]);

  async function loadAll(){
    setLoading(true);
    const [{data:p},{data:b}]=await Promise.all([
      supabase.from("phasages").select("*").order("created_at",{ascending:false}),
      supabase.from("bibliotheque_ratios").select("*").order("libelle"),
    ]);
    setPhasages(p||[]);
    setBibliotheque(b||[]);
    setLoading(false);
  }

  async function creerPhasage(){
    if(!newChantier)return;
    const ch=chantiers.find(c=>c.id===newChantier);
    const{data,error}=await supabase.from("phasages").insert({
      chantier_id:newChantier,
      chantier_nom:ch?ch.nom:newChantier,
      ouvrages:[],
    }).select().single();
    if(error){console.error("creerPhasage:",error.message);return;}
    if(data){setPhasages(p=>[data,...p]);setSelected(data);setShowNew(false);setNewChantier("");}
  }

  async function savePhasage(phasage){
    const{error}=await supabase.from("phasages").update({ouvrages:phasage.ouvrages,updated_at:new Date().toISOString()}).eq("id",phasage.id);
    if(error){console.error("savePhasage:",error.message);return;}
    setPhasages(prev=>prev.map(p=>p.id===phasage.id?phasage:p));
    if(selected?.id===phasage.id)setSelected(phasage);
  }

  async function supprimerPhasage(id){
    if(!confirm("Supprimer ce phasage ?"))return;
    await supabase.from("phasages").delete().eq("id",id);
    setPhasages(prev=>prev.filter(p=>p.id!==id));
    if(selected?.id===id)setSelected(null);
  }

  if(selected){
    return(
      <PhasageDetail
        phasage={selected} bibliotheque={bibliotheque} T={T}
        chantiers={chantiers} ouvriers={ouvriers} tauxHoraires={tauxHoraires}
        onBack={()=>setSelected(null)} onSave={savePhasage}
        onDelete={()=>supprimerPhasage(selected.id)}
      />
    );
  }

  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:T.bg}}>
      <div style={{maxWidth:860,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
          <div>
            <div style={{fontSize:22,fontWeight:800,letterSpacing:1,color:T.text}}>📋 Phasages chantiers</div>
            <div style={{fontSize:13,color:T.textMuted,marginTop:4}}>Avancement, coûts MO et ressources par tâche</div>
          </div>
          <button onClick={()=>setShowNew(true)}
            style={{padding:"10px 20px",borderRadius:8,border:"none",background:T.accent,
              color:"#111",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            + Nouveau phasage
          </button>
        </div>

        {showNew&&(
          <div style={{background:T.surface,border:`1px solid ${T.accent}`,borderRadius:12,padding:"20px 24px",marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>Nouveau phasage</div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <select value={newChantier} onChange={e=>setNewChantier(e.target.value)}
                style={{flex:1,padding:"9px 12px",borderRadius:8,border:`1px solid ${T.border}`,
                  background:T.inputBg,color:newChantier?T.text:T.textMuted,fontFamily:"inherit",fontSize:14,outline:"none"}}>
                <option value="">Choisir un chantier…</option>
                {chantiers.map(c=>(<option key={c.id} value={c.id}>{c.nom}</option>))}
              </select>
              <button onClick={creerPhasage} disabled={!newChantier}
                style={{padding:"9px 20px",borderRadius:8,border:"none",
                  background:newChantier?T.accent:T.border,color:"#111",
                  fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:newChantier?"pointer":"default"}}>Créer</button>
              <button onClick={()=>{setShowNew(false);setNewChantier("");}}
                style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${T.border}`,
                  background:"transparent",color:T.textMuted,fontFamily:"inherit",fontSize:13,cursor:"pointer"}}>Annuler</button>
            </div>
          </div>
        )}

        {loading?(
          <div style={{color:T.textMuted,textAlign:"center",padding:60}}>Chargement…</div>
        ):phasages.length===0?(
          <div style={{textAlign:"center",padding:60,color:T.textMuted}}>
            <div style={{fontSize:32,marginBottom:12}}>📋</div>
            <div>Aucun phasage. Créez-en un pour commencer.</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {phasages.map(p=>{
              const ch=chantiers.find(c=>c.id===p.chantier_id);
              const ouvragesList=p.ouvrages||[];
              const totalH=ouvragesList.reduce((s,o)=>s+(parseFloat(o.heures_devis)||0),0);
              const nbO=ouvragesList.length;
              // Avancement global pondéré
              const totalTaches=ouvragesList.flatMap(o=>o.taches||[]);
              const avgAv=totalTaches.length>0
                ?Math.round(totalTaches.reduce((s,t)=>s+(parseFloat(t.avancement)||0),0)/totalTaches.length)
                :0;
              // Coût total
              const coutTotal=ouvragesList.reduce((s,o)=>{
                return s+(o.taches||[]).reduce((s2,t)=>{
                  const cMO=(t.heures_reelles||[]).reduce((s3,h)=>s3+((parseFloat(h.heures)||0)*(parseFloat(tauxHoraires?.[h.ouvrier])||0)),0);
                  const cRes=(t.ressources||[]).reduce((s3,r)=>s3+(parseFloat(r.montant)||0),0);
                  return s2+cMO+cRes;
                },0);
              },0);
              return(
                <div key={p.id} style={{background:T.surface,border:`1px solid ${T.border}`,
                  borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",
                  gap:16,cursor:"pointer",transition:"border .15s"}}
                  onClick={()=>setSelected(p)}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                  <div style={{width:10,height:56,borderRadius:5,background:ch?ch.couleur:T.accent,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:16,fontWeight:800,color:T.text,letterSpacing:.5}}>{p.chantier_nom}</div>
                    <div style={{fontSize:12,color:T.textMuted,marginTop:3}}>
                      {nbO} ouvrage{nbO>1?"s":""} · {totalH.toFixed(1)}h devis · {coutTotal>0?`${coutTotal.toFixed(0)}€`:"Pas de coûts saisis"}
                    </div>
                    {totalTaches.length>0&&(
                      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                        <div style={{flex:1,height:4,background:T.border,borderRadius:2}}>
                          <div style={{height:"100%",borderRadius:2,background:avgAv===100?"#50c878":T.accent,
                            width:`${avgAv}%`,transition:"width .3s"}}/>
                        </div>
                        <span style={{fontSize:11,fontWeight:700,color:avgAv===100?"#50c878":T.accent,minWidth:32}}>{avgAv}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={e=>{e.stopPropagation();supprimerPhasage(p.id);}}
                      style={{padding:"6px 12px",borderRadius:6,border:"1px solid rgba(224,92,92,0.3)",
                        background:"transparent",color:"#e05c5c",fontFamily:"inherit",fontSize:12,cursor:"pointer"}}>🗑</button>
                    <span style={{fontSize:18,color:T.textMuted,alignSelf:"center"}}>▶</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PHASAGE DÉTAIL ───────────────────────────────────────────────────────────
function PhasageDetail({phasage,bibliotheque,T,chantiers,ouvriers,tauxHoraires,onBack,onSave,onDelete}){
  const [ouvrages,setOuvrages]=useState(phasage.ouvrages||[]);
  const [showAjout,setShowAjout]=useState(false);
  const [selectedOuvrage,setSelectedOuvrage]=useState("");
  const [heuresInput,setHeuresInput]=useState("");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [search,setSearch]=useState("");
  const [expandedOuvrage,setExpandedOuvrage]=useState(null);
  const [expandedTache,setExpandedTache]=useState(null);
  const ch=chantiers.find(c=>c.id===phasage.chantier_id);

  // ─── ÉTAT POUR LA MODALE DE PLANIFICATION ───
  const [planifierTask, setPlanifierTask] = useState(null);
  const [planifierWeek, setPlanifierWeek] = useState("");
  const [planifierJour, setPlanifierJour] = useState("Lundi");
  const [isPlanningSaving, setIsPlanningSaving] = useState(false);

  // Générer les 8 prochaines semaines pour le menu déroulant
  const semainesFutures = [];
  const now = getCurrentWeek();
  for (let i=0; i<8; i++) {
    let w = now.week + i; 
    let y = now.year;
    if (w > 52) { w -= 52; y++; }
    semainesFutures.push(getWeekId(y,w));
  }

  function genererTaches(ouvrageId,heures){
    const bibl=bibliotheque.find(b=>b.id===ouvrageId);
    if(!bibl)return[];
    return(bibl.sous_taches||[]).map(st=>({
      nom:st.nom, ratio:st.ratio,
      heures:parseFloat(((heures*st.ratio)/100).toFixed(1)),
      avancement:0,
      heures_reelles:[],
      ressources:[],
    }));
  }

  function ajouterOuvrage(){
    if(!selectedOuvrage||!heuresInput)return;
    const bibl=bibliotheque.find(b=>b.id===selectedOuvrage);
    if(!bibl)return;
    const taches=genererTaches(selectedOuvrage,parseFloat(heuresInput));
    const newOuvrage={
      id:Math.random().toString(36).slice(2),
      bibliotheque_id:selectedOuvrage,
      libelle:bibl.libelle, unite:bibl.unite,
      heures_devis:parseFloat(heuresInput), taches,
    };
    setOuvrages(prev=>[...prev,newOuvrage]);
    setShowAjout(false); setSelectedOuvrage(""); setHeuresInput(""); setSearch("");
    setExpandedOuvrage(newOuvrage.id);
  }

  function supprimerOuvrage(id){setOuvrages(prev=>prev.filter(o=>o.id!==id));}

  function updateHeures(id,val){
    setOuvrages(prev=>prev.map(o=>{
      if(o.id!==id)return o;
      const heures=parseFloat(val)||0;
      const bibl=bibliotheque.find(b=>b.id===o.bibliotheque_id);
      const taches=bibl?genererTaches(o.bibliotheque_id,heures):o.taches;
      return{...o,heures_devis:heures,taches};
    }));
  }

  function updateTache(ouvrageId,tacheIdx,updates){
    setOuvrages(prev=>prev.map(o=>{
      if(o.id!==ouvrageId)return o;
      const taches=[...o.taches];
      taches[tacheIdx]={...taches[tacheIdx],...updates};
      return{...o,taches};
    }));
  }

  function addHeureMO(ouvrageId,tacheIdx){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=[...(tache.heures_reelles||[]),{id:Math.random().toString(36).slice(2),ouvrier:ouvriers[0]||"",heures:0}];
    updateTache(ouvrageId,tacheIdx,{heures_reelles:updated});
  }

  function updateHeureMO(ouvrageId,tacheIdx,heureIdx,changes){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=(tache.heures_reelles||[]).map((h,i)=>i===heureIdx?{...h,...changes}:h);
    updateTache(ouvrageId,tacheIdx,{heures_reelles:updated});
  }

  function removeHeureMO(ouvrageId,tacheIdx,heureIdx){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=(tache.heures_reelles||[]).filter((_,i)=>i!==heureIdx);
    updateTache(ouvrageId,tacheIdx,{heures_reelles:updated});
  }

  function addRessource(ouvrageId,tacheIdx){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=[...(tache.ressources||[]),{id:Math.random().toString(36).slice(2),description:"",montant:0}];
    updateTache(ouvrageId,tacheIdx,{ressources:updated});
  }

  function updateRessource(ouvrageId,tacheIdx,resIdx,changes){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=(tache.ressources||[]).map((r,i)=>i===resIdx?{...r,...changes}:r);
    updateTache(ouvrageId,tacheIdx,{ressources:updated});
  }

  function removeRessource(ouvrageId,tacheIdx,resIdx){
    const ouvrage=ouvrages.find(o=>o.id===ouvrageId);
    const tache=ouvrage?.taches[tacheIdx];
    if(!tache)return;
    const updated=(tache.ressources||[]).filter((_,i)=>i!==resIdx);
    updateTache(ouvrageId,tacheIdx,{ressources:updated});
  }

  function calcCoutMO(tache){
    return(tache.heures_reelles||[]).reduce((s,h)=>
      s+((parseFloat(h.heures)||0)*(parseFloat(tauxHoraires?.[h.ouvrier])||0)),0);
  }
  function calcCoutRes(tache){
    return(tache.ressources||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  }
  function calcCoutTache(tache){return calcCoutMO(tache)+calcCoutRes(tache);}

  async function sauvegarder(){
    setSaving(true);
    await onSave({...phasage,ouvrages});
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  }

  // ─── FONCTION POUR ENVOYER LA TÂCHE AU PLANNING ───
  async function executerPlanification() {
    if (!planifierWeek || !planifierJour || !planifierTask) return;
    setIsPlanningSaving(true);
    
    const chantierId = phasage.chantier_id;
    const { tache } = planifierTask;

    try {
      // 1. On va chercher la case existante dans le planning
      const { data: existing } = await supabase
        .from("planning_cells")
        .select("*")
        .eq("week_id", planifierWeek)
        .eq("chantier_id", chantierId)
        .eq("jour", planifierJour)
        .maybeSingle();

      const baseCell = existing || { planifie: "", reel: "", ouvriers: [], taches: [] };
      const currentTaches = baseCell.taches || [];

      // 2. On fabrique la nouvelle tâche pour le planning
      const newTachePlanning = {
        id: Math.random().toString(36).slice(2),
        text: tache.nom,
        duree: tache.heures,
        ouvriers: []
      };

      const updatedTaches = [...currentTaches, newTachePlanning];
      const updatedPlanifie = updatedTaches.map(t => t.text).join("\n");

      // 3. On sauvegarde dans Supabase (ça mettra à jour l'appli en temps réel !)
      await supabase.from("planning_cells").upsert({
        week_id: planifierWeek,
        chantier_id: chantierId,
        jour: planifierJour,
        planifie: updatedPlanifie,
        taches: updatedTaches,
        reel: baseCell.reel,
        ouvriers: baseCell.ouvriers
      }, { onConflict: "week_id,chantier_id,jour" });

      setPlanifierTask(null);
      alert("Tâche ajoutée au planning avec succès !");
    } catch (err) {
      console.error(err);
      alert("Une erreur est survenue lors de la planification.");
    }
    setIsPlanningSaving(false);
  }

  const totalH=ouvrages.reduce((s,o)=>s+(parseFloat(o.heures_devis)||0),0);
  const totalTaches=ouvrages.flatMap(o=>o.taches||[]);
  const avgAv=totalTaches.length>0
    ?Math.round(totalTaches.reduce((s,t)=>s+(parseFloat(t.avancement)||0),0)/totalTaches.length)
    :0;
  const totalCoutMO=totalTaches.reduce((s,t)=>s+calcCoutMO(t),0);
  const totalCoutRes=totalTaches.reduce((s,t)=>s+calcCoutRes(t),0);
  const totalCout=totalCoutMO+totalCoutRes;
  const biblFiltered=bibliotheque.filter(b=>!search||b.libelle.toLowerCase().includes(search.toLowerCase()));

  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:T.bg}}>
      
      {/* ── MODALE DE PLANIFICATION ── */}
      {planifierTask && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)" }}
          onClick={() => setPlanifierTask(null)}>
          <div style={{ background:T.modal, borderRadius:16, width:"100%", maxWidth:400,
            border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
            display:"flex", flexDirection:"column", overflow:"hidden" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:"20px 24px", borderBottom:`1px solid ${T.sectionDivider}`, background:T.surface }}>
              <div style={{ fontSize:18, fontWeight:800, color:T.text, marginBottom:4 }}>📅 Planifier une tâche</div>
              <div style={{ fontSize:13, color:T.textSub }}>Envoie cette tâche directement dans le planning.</div>
            </div>
            <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>
              <div style={{ background:T.card, padding:"12px", borderRadius:8, border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:14, fontWeight:700, color:T.text }}>{planifierTask.tache.nom}</div>
                <div style={{ fontSize:12, color:T.textMuted, marginTop:4 }}>Durée estimée : {planifierTask.tache.heures}h</div>
              </div>
              
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:12, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1 }}>Semaine</label>
                <select value={planifierWeek} onChange={e => setPlanifierWeek(e.target.value)}
                  style={{ padding:"10px 12px", borderRadius:8, border:`1px solid ${T.border}`,
                    background:T.inputBg, color:T.text, fontFamily:"inherit", fontSize:14, outline:"none" }}>
                  <option value="" disabled>Choisir une semaine...</option>
                  {semainesFutures.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:12, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1 }}>Jour</label>
                <select value={planifierJour} onChange={e => setPlanifierJour(e.target.value)}
                  style={{ padding:"10px 12px", borderRadius:8, border:`1px solid ${T.border}`,
                    background:T.inputBg, color:T.text, fontFamily:"inherit", fontSize:14, outline:"none" }}>
                  {JOURS.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
            </div>
            
            <div style={{ padding:"16px 24px", borderTop:`1px solid ${T.sectionDivider}`, display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setPlanifierTask(null)} style={{ background:"transparent", border:`1px solid ${T.border}`,
                borderRadius:8, padding:"10px 20px", color:T.textSub, fontFamily:"inherit", fontSize:14, cursor:"pointer" }}>Annuler</button>
              <button onClick={executerPlanification} disabled={isPlanningSaving || !planifierWeek} style={{ background:T.accent, border:"none",
                borderRadius:8, padding:"10px 24px", color:"#111", fontFamily:"inherit", fontSize:14, fontWeight:800, cursor:"pointer" }}>
                {isPlanningSaving ? "Envoi..." : "✓ Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{maxWidth:960,margin:"0 auto"}}>

        {/* ── HEADER ── */}
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <button onClick={onBack}
            style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${T.border}`,
              background:"transparent",color:T.textSub,fontFamily:"inherit",fontSize:13,cursor:"pointer"}}>← Retour</button>
          <div style={{width:12,height:36,borderRadius:6,background:ch?ch.couleur:T.accent}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:20,fontWeight:800,color:T.text}}>{phasage.chantier_nom}</div>
            <div style={{fontSize:12,color:T.textMuted}}>{ouvrages.length} ouvrage(s) · {totalH.toFixed(1)}h devis</div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onDelete}
              style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(224,92,92,0.3)",
                background:"transparent",color:"#e05c5c",fontFamily:"inherit",fontSize:13,cursor:"pointer"}}>Supprimer</button>
            <button onClick={sauvegarder} disabled={saving}
              style={{padding:"8px 20px",borderRadius:8,border:"none",
                background:saved?"#50c878":T.accent,color:"#111",
                fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer",transition:"background .3s"}}>
              {saving?"…":saved?"✓ Sauvegardé":"Sauvegarder"}
            </button>
          </div>
        </div>

        {/* ── RÉCAP GLOBAL ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
          {[
            {label:"Avancement",val:`${avgAv}%`,color:avgAv===100?"#50c878":T.accent},
            {label:"Coût MO",val:totalCoutMO>0?`${totalCoutMO.toFixed(0)} €`:"—",color:T.text},
            {label:"Coût ressources",val:totalCoutRes>0?`${totalCoutRes.toFixed(0)} €`:"—",color:T.text},
            {label:"Coût total",val:totalCout>0?`${totalCout.toFixed(0)} €`:"—",color:T.accent},
          ].map(({label,val,color})=>(
            <div key={label} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{label}</div>
              <div style={{fontSize:20,fontWeight:800,color}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Barre avancement globale */}
        {totalTaches.length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
            <div style={{flex:1,height:8,background:T.border,borderRadius:4}}>
              <div style={{height:"100%",borderRadius:4,background:avgAv===100?"#50c878":T.accent,
                width:`${avgAv}%`,transition:"width .3s"}}/>
            </div>
            <span style={{fontSize:13,fontWeight:700,color:avgAv===100?"#50c878":T.accent,minWidth:40}}>{avgAv}%</span>
          </div>
        )}

        {/* ── BOUTON AJOUT ── */}
        {!showAjout&&(
          <button onClick={()=>setShowAjout(true)}
            style={{width:"100%",padding:"12px",borderRadius:10,border:`1.5px dashed ${T.border}`,
              background:"transparent",color:T.textMuted,fontFamily:"inherit",
              fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:20}}>
            + Ajouter un ouvrage du devis
          </button>
        )}

        {/* ── FORMULAIRE AJOUT ── */}
        {showAjout&&(
          <div style={{background:T.surface,border:`1px solid ${T.accent}`,borderRadius:12,padding:"20px 24px",marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:14}}>Ajouter un ouvrage</div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filtrer les ouvrages…"
              style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${T.border}`,
                background:T.inputBg,color:T.text,fontFamily:"inherit",fontSize:13,outline:"none",marginBottom:10}}/>
            <select value={selectedOuvrage} onChange={e=>setSelectedOuvrage(e.target.value)}
              style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px solid ${T.border}`,
                background:T.inputBg,color:selectedOuvrage?T.text:T.textMuted,
                fontFamily:"inherit",fontSize:13,outline:"none",marginBottom:12}}>
              <option value="">Choisir un ouvrage…</option>
              {biblFiltered.map(b=>(<option key={b.id} value={b.id}>{b.libelle} ({b.unite})</option>))}
            </select>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                <span style={{fontSize:13,color:T.textMuted,whiteSpace:"nowrap"}}>Heures devis :</span>
                <input type="number" min="0.5" step="0.5" value={heuresInput} onChange={e=>setHeuresInput(e.target.value)}
                  placeholder="ex: 16"
                  style={{flex:1,padding:"8px 12px",borderRadius:8,border:`1px solid ${T.border}`,
                    background:T.inputBg,color:T.text,fontFamily:"inherit",fontSize:14,fontWeight:700,outline:"none"}}/>
                <span style={{fontSize:13,color:T.textMuted}}>h</span>
              </div>
              <button onClick={ajouterOuvrage} disabled={!selectedOuvrage||!heuresInput}
                style={{padding:"9px 20px",borderRadius:8,border:"none",
                  background:selectedOuvrage&&heuresInput?T.accent:T.border,color:"#111",
                  fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:selectedOuvrage&&heuresInput?"pointer":"default"}}>
                Générer les tâches
              </button>
              <button onClick={()=>{setShowAjout(false);setSearch("");setSelectedOuvrage("");setHeuresInput("");}}
                style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${T.border}`,
                  background:"transparent",color:T.textMuted,fontFamily:"inherit",fontSize:13,cursor:"pointer"}}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── LISTE OUVRAGES ── */}
        {ouvrages.length===0?(
          <div style={{textAlign:"center",padding:40,color:T.textMuted}}>Aucun ouvrage. Ajoutez les postes du devis ci-dessus.</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {ouvrages.map(ouvrage=>{
              const isExpanded=expandedOuvrage===ouvrage.id;
              const ouvrageAv=ouvrage.taches?.length>0
                ?Math.round(ouvrage.taches.reduce((s,t)=>s+(parseFloat(t.avancement)||0),0)/ouvrage.taches.length)
                :0;
              const ouvrCout=ouvrage.taches?.reduce((s,t)=>s+calcCoutTache(t),0)||0;
              return(
                <div key={ouvrage.id} style={{background:T.surface,border:`1px solid ${isExpanded?T.accent:T.border}`,
                  borderRadius:12,overflow:"hidden",transition:"border .2s"}}>

                  {/* En-tête ouvrage */}
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",
                    cursor:"pointer",borderBottom:isExpanded?`1px solid ${T.sectionDivider}`:"none"}}
                    onClick={()=>setExpandedOuvrage(isExpanded?null:ouvrage.id)}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:14,fontWeight:700,color:T.text}}>{ouvrage.libelle}</span>
                        <span style={{fontSize:11,color:T.textMuted,background:T.card,padding:"2px 7px",borderRadius:4}}>{ouvrage.unite}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:100,height:4,background:T.border,borderRadius:2}}>
                          <div style={{height:"100%",borderRadius:2,background:ouvrageAv===100?"#50c878":T.accent,width:`${ouvrageAv}%`}}/>
                        </div>
                        <span style={{fontSize:11,color:ouvrageAv===100?"#50c878":T.textMuted}}>{ouvrageAv}%</span>
                        <span style={{fontSize:11,color:T.textMuted}}>· {ouvrage.heures_devis}h devis</span>
                        {ouvrCout>0&&<span style={{fontSize:11,color:T.accent}}>· {ouvrCout.toFixed(0)}€</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:T.textMuted}}>Heures devis :</span>
                        <input type="number" min="0.5" step="0.5" value={ouvrage.heures_devis}
                          onClick={e=>e.stopPropagation()}
                          onChange={e=>{e.stopPropagation();updateHeures(ouvrage.id,e.target.value);}}
                          style={{width:60,padding:"4px 6px",borderRadius:6,textAlign:"center",
                            border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                            fontFamily:"inherit",fontSize:13,fontWeight:700,outline:"none"}}/>
                        <span style={{fontSize:11,color:T.textMuted}}>h</span>
                      </div>
                      <button onClick={e=>{e.stopPropagation();supprimerOuvrage(ouvrage.id);}}
                        style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(224,92,92,0.3)",
                          background:"transparent",color:"#e05c5c",fontFamily:"inherit",fontSize:12,cursor:"pointer"}}>🗑</button>
                      <span style={{fontSize:12,color:isExpanded?T.accent:T.textMuted}}>{isExpanded?"▲":"▼"}</span>
                    </div>
                  </div>

                  {/* Tâches décomposées */}
                  {isExpanded&&(
                    <div style={{padding:"0 18px 16px"}}>
                      {(ouvrage.taches||[]).map((tache,ti)=>{
                        const tacheKey=`${ouvrage.id}-${ti}`;
                        const isExpT=expandedTache===tacheKey;
                        const coutMO=calcCoutMO(tache);
                        const coutRes=calcCoutRes(tache);
                        const coutT=coutMO+coutRes;
                        const av=parseFloat(tache.avancement)||0;
                        return(
                          <div key={ti} style={{borderBottom:ti<ouvrage.taches.length-1?`1px solid ${T.sectionDivider}`:"none",
                            paddingBottom:isExpT?12:0}}>

                            {/* Ligne principale tâche */}
                            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",
                              cursor:"pointer"}} onClick={()=>setExpandedTache(isExpT?null:tacheKey)}>
                              <div style={{width:6,height:6,borderRadius:"50%",
                                background:av===100?"#50c878":av>0?"#f5a623":T.border,flexShrink:0}}/>
                              <span style={{flex:1,fontSize:13,color:T.text,fontWeight:600}}>{tache.nom}</span>
                              
                              {/* NOUVEAU BOUTON PLANIFIER */}
                              <button onClick={(e) => { 
                                e.stopPropagation(); 
                                setPlanifierWeek(semainesFutures[0]); // Par défaut, la semaine en cours
                                setPlanifierTask({ ouvrageId: ouvrage.id, tacheIdx: ti, tache }); 
                              }}
                                style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${T.accent}55`,
                                  background:T.accent+"15", color:T.accent, fontFamily:"inherit", fontSize:11,
                                  fontWeight:700, cursor:"pointer", transition:"all .2s" }}
                                onMouseEnter={e => e.currentTarget.style.background = T.accent+"30"}
                                onMouseLeave={e => e.currentTarget.style.background = T.accent+"15"}>
                                📅 Planifier
                              </button>

                              <span style={{fontSize:11,color:T.textMuted,minWidth:30,textAlign:"right"}}>{tache.ratio}%</span>
                              {/* Mini barre ratio */}
                              <div style={{width:50,height:3,background:T.border,borderRadius:2,flexShrink:0}}>
                                <div style={{height:"100%",borderRadius:2,background:T.border,opacity:.5,width:`${tache.ratio}%`}}/>
                              </div>
                              <span style={{fontSize:12,color:T.textMuted,minWidth:36,textAlign:"right"}}>{tache.heures}h</span>
                              {coutT>0&&<span style={{fontSize:12,color:T.accent,minWidth:55,textAlign:"right"}}>{coutT.toFixed(0)}€</span>}
                              {/* Avancement slider inline */}
                              <div style={{display:"flex",alignItems:"center",gap:6,minWidth:140}}
                                onClick={e=>e.stopPropagation()}>
                                <input type="range" min="0" max="100" step="5"
                                  value={av}
                                  onChange={e=>updateTache(ouvrage.id,ti,{avancement:parseInt(e.target.value)})}
                                  style={{flex:1,accentColor:av===100?"#50c878":T.accent}}/>
                                <span style={{fontSize:12,fontWeight:700,
                                  color:av===100?"#50c878":av>0?"#f5a623":T.textMuted,
                                  minWidth:35,textAlign:"right"}}>{av}%</span>
                              </div>
                              <span style={{fontSize:11,color:isExpT?T.accent:T.textMuted,marginLeft:4}}>{isExpT?"▲":"▼"}</span>
                            </div>

                            {/* Panneau détail tâche */}
                            {isExpT&&(
                              <div style={{background:T.card,borderRadius:10,padding:"14px 16px",
                                border:`1px solid ${T.border}`,marginBottom:4}}>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>

                                  {/* ── MAIN D'ŒUVRE ── */}
                                  <div>
                                    <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
                                      color:T.textMuted,marginBottom:10}}>👷 Main d'œuvre</div>
                                    {(tache.heures_reelles||[]).map((h,hi)=>(
                                      <div key={hi} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                        <select value={h.ouvrier}
                                          onChange={e=>updateHeureMO(ouvrage.id,ti,hi,{ouvrier:e.target.value})}
                                          style={{flex:1,padding:"6px 8px",borderRadius:6,border:`1px solid ${T.border}`,
                                            background:T.inputBg,color:T.text,fontFamily:"inherit",fontSize:12,outline:"none"}}>
                                          {ouvriers.map(o=>(<option key={o} value={o}>{o}</option>))}
                                        </select>
                                        <input type="number" min="0" step="0.5" value={h.heures||""}
                                          onChange={e=>updateHeureMO(ouvrage.id,ti,hi,{heures:parseFloat(e.target.value)||0})}
                                          placeholder="h"
                                          style={{width:52,padding:"6px 6px",borderRadius:6,textAlign:"center",
                                            border:`1px solid ${T.border}`,background:T.inputBg,color:T.text,
                                            fontFamily:"inherit",fontSize:12,outline:"none"}}/>
                                        <span style={{fontSize:11,color:T.textMuted}}>h</span>
                                        {tauxHoraires?.[h.ouvrier]>0&&(
                                          <span style={{fontSize:11,color:T.accent,minWidth:45,textAlign:"right"}}>
                                            {((parseFloat(h.heures)||0)*tauxHoraires[h.ouvrier]).toFixed(0)}€
                                          </span>
                                        )}
                                        <button onClick={()=>removeHeureMO(ouvrage.id,ti,hi)}
                                          style={{background:"transparent",border:"none",color:"#e05c5c",
                                            cursor:"pointer",fontSize:14,padding:"0 2px"}}>✕</button>
                                      </div>
                                    ))}
                                    <button onClick={()=>addHeureMO(ouvrage.id,ti)}
                                      style={{padding:"6px 12px",borderRadius:6,border:`1px dashed ${T.border}`,
                                        background:"transparent",color:T.textMuted,fontFamily:"inherit",
                                        fontSize:12,cursor:"pointer",width:"100%",marginTop:4}}>
                                      + Ajouter un ouvrier
                                    </button>
                                    {coutMO>0&&(
                                      <div style={{marginTop:8,fontSize:12,fontWeight:700,color:T.text,textAlign:"right"}}>
                                        MO : <span style={{color:T.accent}}>{coutMO.toFixed(0)} €</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* ── RESSOURCES ── */}
                                  <div>
                                    <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
                                      color:T.textMuted,marginBottom:10}}>🧱 Ressources</div>
                                    {(tache.ressources||[]).map((r,ri)=>(
                                      <div key={ri} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                        <input value={r.description||""}
                                          onChange={e=>updateRessource(ouvrage.id,ti,ri,{description:e.target.value})}
                                          placeholder="Description…"
                                          style={{flex:1,padding:"6px 8px",borderRadius:6,border:`1px solid ${T.border}`,
                                            background:T.inputBg,color:T.text,fontFamily:"inherit",fontSize:12,outline:"none"}}/>
                                        <input type="number" min="0" step="1" value={r.montant||""}
                                          onChange={e=>updateRessource(ouvrage.id,ti,ri,{montant:parseFloat(e.target.value)||0})}
                                          placeholder="€"
                                          style={{width:70,padding:"6px 6px",borderRadius:6,textAlign:"right",
                                            border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                                            fontFamily:"inherit",fontSize:12,fontWeight:700,outline:"none"}}/>
                                        <span style={{fontSize:11,color:T.textMuted}}>€</span>
                                        <button onClick={()=>removeRessource(ouvrage.id,ti,ri)}
                                          style={{background:"transparent",border:"none",color:"#e05c5c",
                                            cursor:"pointer",fontSize:14,padding:"0 2px"}}>✕</button>
                                      </div>
                                    ))}
                                    <button onClick={()=>addRessource(ouvrage.id,ti)}
                                      style={{padding:"6px 12px",borderRadius:6,border:`1px dashed ${T.border}`,
                                        background:"transparent",color:T.textMuted,fontFamily:"inherit",
                                        fontSize:12,cursor:"pointer",width:"100%",marginTop:4}}>
                                      + Ajouter une ressource
                                    </button>
                                    {coutRes>0&&(
                                      <div style={{marginTop:8,fontSize:12,fontWeight:700,color:T.text,textAlign:"right"}}>
                                        Ressources : <span style={{color:T.accent}}>{coutRes.toFixed(0)} €</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Total tâche */}
                                {coutT>0&&(
                                  <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${T.sectionDivider}`,
                                    display:"flex",justifyContent:"flex-end",gap:20}}>
                                    <span style={{fontSize:12,color:T.textMuted}}>MO : {coutMO.toFixed(0)}€</span>
                                    <span style={{fontSize:12,color:T.textMuted}}>Ressources : {coutRes.toFixed(0)}€</span>
                                    <span style={{fontSize:13,fontWeight:800,color:T.accent}}>Total : {coutT.toFixed(0)} €</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Total ouvrage */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        marginTop:10,paddingTop:10,borderTop:`1px solid ${T.sectionDivider}`}}>
                        <span style={{fontSize:12,color:T.textMuted}}>
                          {ouvrage.taches?.length} tâche(s) · {ouvrage.heures_devis}h devis
                        </span>
                        {ouvrCout>0&&(
                          <span style={{fontSize:13,fontWeight:800,color:T.accent}}>
                            Total ouvrage : {ouvrCout.toFixed(0)} €
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── RÉCAP FINAL ── */}
            <div style={{background:T.surface,border:`1px solid ${T.accent}`,borderRadius:12,padding:"18px 22px"}}>
              <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:12}}>Récapitulatif chantier</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>Heures devis</div>
                  <div style={{fontSize:18,fontWeight:800,color:T.text}}>{totalH.toFixed(1)}h</div>
                </div>
                <div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>Coût MO</div>
                  <div style={{fontSize:18,fontWeight:800,color:T.text}}>{totalCoutMO.toFixed(0)} €</div>
                </div>
                <div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>Coût ressources</div>
                  <div style={{fontSize:18,fontWeight:800,color:T.text}}>{totalCoutRes.toFixed(0)} €</div>
                </div>
              </div>
              <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.sectionDivider}`,
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:120,height:6,background:T.border,borderRadius:3}}>
                    <div style={{height:"100%",borderRadius:3,background:avgAv===100?"#50c878":T.accent,width:`${avgAv}%`}}/>
                  </div>
                  <span style={{fontSize:13,color:avgAv===100?"#50c878":T.accent}}>{avgAv}% terminé</span>
                </div>
                <div style={{fontSize:20,fontWeight:800,color:T.accent}}>{totalCout.toFixed(0)} €</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PagePhasage;
