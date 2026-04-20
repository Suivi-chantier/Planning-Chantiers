import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS } from "./constants";

// ─── PAGE COMMANDES ───────────────────────────────────────────────────────────
function PageCommandes({chantiers,T}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filterChantier,setFilterChantier]=useState("all");
  const [filterStatut,setFilterStatut]=useState("all");
  const [filterOuvrier,setFilterOuvrier]=useState("all");
  const [editRow,setEditRow]=useState(null); // id en cours d'édition inline
  const [newRow,setNewRow]=useState(null);   // brouillon nouvelle ligne
  const [editDraft,setEditDraft]=useState(null); // draft de la ligne en cours d'édition

  // Calcul retard : ligne non traitée (pas commande/retire) depuis > 2 jours
  const isEnRetard = (row) => {
    if (row.statut==="commande"||row.statut==="retire") return false;
    if (!row.created_at) return false;
    const created = new Date(row.created_at);
    const now = new Date();
    const diffJ = (now - created) / (1000*60*60*24);
    // Urgent = retard si > 2 jours, Normal = retard si > 5 jours
    const seuilJ = row.priorite==="urgent" ? 2 : 5;
    return diffJ > seuilJ;
  };

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
    setEditRow(null); setNewRow(null); setEditDraft(null);
    if(row.id){
      // Mise à jour optimiste immédiate du state local
      setRows(prev=>prev.map(r=>r.id===row.id?{...r,...row}:r));
      // Champs de base (colonnes qui existent depuis le début)
      const baseFields={
        chantier_id:       row.chantier_id       ?? "",
        article:           row.article           ?? "",
        fournisseur:       row.fournisseur       ?? "",
        quantite:          row.quantite          ?? "",
        statut:            row.statut            ?? "a_commander",
        notes:             row.notes             ?? "",
      };
      const {error:e1}=await supabase.from("commandes_detail").update(baseFields).eq("id",row.id);
      if(e1){ console.error("Erreur update base:",e1); alert("Erreur sauvegarde: "+e1.message); load(); return; }
      // Champs additionnels (peuvent ne pas exister selon la migration Supabase)
      const extraFields={
        priorite:          row.priorite          ?? "normal",
        ouvrier_demandeur: row.ouvrier_demandeur ?? "",
      };
      const {error:e2}=await supabase.from("commandes_detail").update(extraFields).eq("id",row.id);
      if(e2) console.warn("Colonnes priorite/ouvrier absentes de la table:",e2.message);
    } else {
      const fields={
        chantier_id:       row.chantier_id       ?? "",
        article:           row.article           ?? "",
        fournisseur:       row.fournisseur       ?? "",
        quantite:          row.quantite          ?? "",
        statut:            row.statut            ?? "a_commander",
        notes:             row.notes             ?? "",
      };
      const {data:created, error}=await supabase.from("commandes_detail").insert(fields).select().single();
      if(error){ console.error("Erreur insert:",error); alert("Erreur création: "+error.message); }
      else if(created){
        // Ajouter les champs extra si possible
        await supabase.from("commandes_detail").update({
          priorite: row.priorite??"normal",
          ouvrier_demandeur: row.ouvrier_demandeur??""
        }).eq("id",created.id);
      }
    }
    load();
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
    (filterStatut==="all"||r.statut===filterStatut)&&
    (filterOuvrier==="all"||r.ouvrier_demandeur===filterOuvrier)
  );

  // Liste des ouvriers ayant des commandes
  const ouvriersDansCmds=[...new Set(rows.map(r=>r.ouvrier_demandeur).filter(Boolean))];

  // editDraft est dans le state du parent pour survivre aux re-renders

  const counts=Object.fromEntries(Object.keys(STATUTS).map(k=>[k,rows.filter(r=>r.statut===k).length]));

  return(
    <div className="page-padding" style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
      <div style={{marginBottom:24,display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:1,marginBottom:4}}>Commandes</div>
          <div style={{fontSize:14,color:T.textSub}}>Suivi des besoins par chantier et par fournisseur</div>
        </div>
        <button onClick={()=>{const e=emptyCommande();setNewRow(e);setEditDraft(e);}} style={{background:T.accent,color:"#fff",border:"none",
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
        <select value={filterOuvrier} onChange={e=>setFilterOuvrier(e.target.value)}
          style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",
            color:"#e8eaf0",fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all" style={{background:"#1e2336",color:"#e8eaf0"}}>Tous les ouvriers</option>
          {ouvriersDansCmds.map(o=><option key={o} value={o} style={{background:"#1e2336",color:"#e8eaf0"}}>{o}</option>)}
        </select>
        {rows.filter(r=>isEnRetard(r)).length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",
            background:"rgba(224,92,92,0.12)",border:"1px solid rgba(224,92,92,0.3)",
            borderRadius:8,fontSize:12,fontWeight:700,color:"#e05c5c"}}>
            ⚠️ {rows.filter(r=>isEnRetard(r)).length} en retard
          </div>
        )}
      </div>

      {/* Tableau */}
      {/* Vue mobile : cartes | Vue desktop : tableau */}

      <div style={{background:T.surface,borderRadius:14,border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:T.card,borderBottom:`2px solid ${T.border}`}}>
              {["Chantier","Article / Matériau","Fournisseur","Qté","Statut / Priorité","Ouvrier · Notes","Date",""].map(h=>(
                <th key={h} style={{padding:"12px 10px",fontSize:11,fontWeight:700,letterSpacing:1.5,
                  textTransform:"uppercase",color:T.textMuted,textAlign:"left"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newRow&&editDraft&&(
              <tr style={{background:T.fieldBg}}>
                <td style={{padding:"8px 10px"}}>
                  <select value={editDraft.chantier_id} onChange={e=>setEditDraft(p=>({...p,chantier_id:e.target.value}))}
                    style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}>
                    <option value="">— Chantier —</option>
                    {chantiers.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </td>
                <td style={{padding:"8px 10px"}}>
                  <input value={editDraft.article||""} onChange={e=>setEditDraft(p=>({...p,article:e.target.value}))}
                    placeholder="Article" autoFocus
                    style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                </td>
                <td style={{padding:"8px 10px"}}>
                  <input value={editDraft.fournisseur||""} onChange={e=>setEditDraft(p=>({...p,fournisseur:e.target.value}))}
                    placeholder="Fournisseur"
                    style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                </td>
                <td style={{padding:"8px 10px"}}>
                  <input value={editDraft.quantite||""} onChange={e=>setEditDraft(p=>({...p,quantite:e.target.value}))}
                    placeholder="Qté"
                    style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                </td>
                <td style={{padding:"8px 10px"}}>
                  <select value={editDraft.statut||"a_commander"} onChange={e=>setEditDraft(p=>({...p,statut:e.target.value}))}
                    style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none",marginBottom:4}}>
                    {Object.entries(STATUTS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select value={editDraft.priorite||"normal"} onChange={e=>setEditDraft(p=>({...p,priorite:e.target.value}))}
                    style={{background:"#1e2336",border:`1px solid ${editDraft.priorite==="urgent"?"rgba(224,92,92,0.5)":"rgba(255,255,255,0.1)"}`,borderRadius:6,padding:"5px 8px",color:editDraft.priorite==="urgent"?"#e05c5c":"#9aa5c0",fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",fontWeight:700}}>
                    <option value="normal">🟡 Normal</option>
                    <option value="urgent">🔴 URGENT</option>
                  </select>
                </td>
                <td style={{padding:"8px 10px"}}>
                  <input value={editDraft.ouvrier_demandeur||""} onChange={e=>setEditDraft(p=>({...p,ouvrier_demandeur:e.target.value}))}
                    placeholder="Ouvrier" style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"5px 8px",color:T.text,fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",marginBottom:4}}/>
                  <input value={editDraft.notes||""} onChange={e=>setEditDraft(p=>({...p,notes:e.target.value}))}
                    placeholder="Notes" style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"5px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                </td>
                <td style={{padding:"8px 10px"}}></td>
                <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                  <button onClick={()=>saveRow(editDraft)} style={{background:T.accent,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginRight:6}}>✓</button>
                  <button onClick={()=>{setNewRow(null);setEditDraft(null);}} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>✕</button>
                </td>
              </tr>
            )}
            {loading?(
              <tr><td colSpan={8} style={{padding:32,textAlign:"center",color:T.textMuted}}>Chargement…</td></tr>
            ):filtered.length===0&&!newRow?(
              <tr><td colSpan={8} style={{padding:32,textAlign:"center",color:T.textMuted}}>
                Aucune commande — clique sur "+ Nouvelle ligne" pour commencer.
              </td></tr>
            ):filtered.map(row=>{
              const ch=chantiers.find(c=>c.id===row.chantier_id);
              const st=STATUTS[row.statut]||STATUTS.a_commander;
              const retard=isEnRetard(row);
              const urgent=row.priorite==="urgent";
              // Couleur de fond selon priorité / retard
              const rowBg = retard ? "rgba(224,92,92,0.10)"
                : urgent ? "rgba(224,92,92,0.05)"
                : row.statut==="besoin_ouvrier" ? "rgba(176,96,255,0.06)"
                : "transparent";
              const rowBorderLeft = retard ? "3px solid #e05c5c"
                : urgent ? "3px solid rgba(224,92,92,0.5)"
                : row.statut==="besoin_ouvrier" ? "3px solid #b060ff"
                : "3px solid transparent";
              // Ligne en mode édition
              if(editRow===row.id&&editDraft) return(
                <tr key={row.id} style={{background:T.fieldBg}}>
                  <td style={{padding:"8px 10px"}}>
                    <select value={editDraft.chantier_id} onChange={e=>setEditDraft(p=>({...p,chantier_id:e.target.value}))}
                      style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}>
                      <option value="">— Chantier —</option>
                      {chantiers.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </td>
                  <td style={{padding:"8px 10px"}}>
                    <input value={editDraft.article||""} onChange={e=>setEditDraft(p=>({...p,article:e.target.value}))}
                      placeholder="Article" autoFocus
                      style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                  </td>
                  <td style={{padding:"8px 10px"}}>
                    <input value={editDraft.fournisseur||""} onChange={e=>setEditDraft(p=>({...p,fournisseur:e.target.value}))}
                      placeholder="Fournisseur"
                      style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                  </td>
                  <td style={{padding:"8px 10px"}}>
                    <input value={editDraft.quantite||""} onChange={e=>setEditDraft(p=>({...p,quantite:e.target.value}))}
                      placeholder="Qté"
                      style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                  </td>
                  <td style={{padding:"8px 10px"}}>
                    <select value={editDraft.statut||"a_commander"} onChange={e=>setEditDraft(p=>({...p,statut:e.target.value}))}
                      style={{background:"#1e2336",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 8px",color:"#e8eaf0",fontFamily:"inherit",fontSize:13,width:"100%",outline:"none",marginBottom:4}}>
                      {Object.entries(STATUTS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select value={editDraft.priorite||"normal"} onChange={e=>setEditDraft(p=>({...p,priorite:e.target.value}))}
                      style={{background:"#1e2336",border:`1px solid ${editDraft.priorite==="urgent"?"rgba(224,92,92,0.5)":"rgba(255,255,255,0.1)"}`,borderRadius:6,padding:"5px 8px",color:editDraft.priorite==="urgent"?"#e05c5c":"#9aa5c0",fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",fontWeight:700}}>
                      <option value="normal">🟡 Normal</option>
                      <option value="urgent">🔴 URGENT</option>
                    </select>
                  </td>
                  <td style={{padding:"8px 10px"}}>
                    <input value={editDraft.ouvrier_demandeur||""} onChange={e=>setEditDraft(p=>({...p,ouvrier_demandeur:e.target.value}))}
                      placeholder="Ouvrier" style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"5px 8px",color:T.text,fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",marginBottom:4}}/>
                    <input value={editDraft.notes||""} onChange={e=>setEditDraft(p=>({...p,notes:e.target.value}))}
                      placeholder="Notes" style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"5px 8px",color:T.text,fontFamily:"inherit",fontSize:13,width:"100%",outline:"none"}}/>
                  </td>
                  <td style={{padding:"8px 10px"}}></td>
                  <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                    <button onClick={()=>saveRow(editDraft)} style={{background:T.accent,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginRight:6}}>✓</button>
                    <button onClick={()=>{setEditRow(null);setEditDraft(null);}} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>✕</button>
                  </td>
                </tr>
              );
              // Date de création formatée
              const dateCreation = row.created_at
                ? new Date(row.created_at).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit"})
                : "—";
              const heureCreation = row.created_at
                ? new Date(row.created_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})
                : "";
              return(
                <tr key={row.id} style={{
                    borderBottom:`1px solid ${T.sectionDivider}`,transition:"background .1s",
                    background:rowBg, borderLeft:rowBorderLeft,
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background=retard?"rgba(224,92,92,0.16)":urgent?"rgba(224,92,92,0.1)":T.card}
                  onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                  <td style={{padding:"11px 10px"}}>
                    {ch?<span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                      <span style={{width:10,height:10,borderRadius:3,background:ch.couleur,display:"block",flexShrink:0}}/>
                      <span style={{fontSize:13,fontWeight:700,color:T.text}}>{ch.nom}</span>
                    </span>:<span style={{fontSize:12,color:T.textMuted}}>—</span>}
                  </td>
                  <td style={{padding:"11px 10px",fontWeight:600}}>
                    <div style={{fontSize:13,color:retard?"#f08080":row.statut==="besoin_ouvrier"?"#c080ff":T.text}}>
                      {retard&&<span title="En retard !" style={{marginRight:5}}>⚠️</span>}
                      {row.article||"—"}
                    </div>
                  </td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub}}>{row.fournisseur||<span style={{color:T.emptyColor,fontSize:12}}>À renseigner</span>}</td>
                  <td style={{padding:"11px 10px",fontSize:13,color:T.textSub}}>{row.quantite||"—"}</td>
                  <td style={{padding:"11px 10px"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <button onClick={()=>cycleStatut(row)} style={{
                        background:st.bg,border:`1px solid ${st.border}`,borderRadius:6,
                        padding:"4px 10px",fontSize:12,fontWeight:700,color:st.color,
                        cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",
                        transition:"all .15s"}} title="Cliquer pour changer le statut">
                        {st.label}
                      </button>
                      <span style={{
                        display:"inline-block",borderRadius:5,padding:"2px 7px",fontSize:11,fontWeight:700,
                        background:urgent?"rgba(224,92,92,0.15)":"rgba(245,166,35,0.10)",
                        color:urgent?"#e05c5c":"#c0a060",border:`1px solid ${urgent?"rgba(224,92,92,0.35)":"rgba(245,166,35,0.2)"}`,
                        alignSelf:"flex-start",
                      }}>
                        {urgent?"🔴 Urgent":"🟡 Normal"}
                      </span>
                    </div>
                  </td>
                  <td style={{padding:"11px 10px"}}>
                    {row.ouvrier_demandeur&&(
                      <div style={{fontSize:12,color:"#a0b8ff",fontWeight:700,marginBottom:2}}>
                        👤 {row.ouvrier_demandeur}
                      </div>
                    )}
                    <div style={{fontSize:13,color:T.textSub,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {row.notes||""}
                    </div>
                  </td>
                  <td style={{padding:"11px 10px",whiteSpace:"nowrap"}}>
                    <div style={{fontSize:12,fontWeight:700,
                      color:retard?"#e05c5c":urgent?"#f5a070":T.textMuted}}>
                      {dateCreation}
                    </div>
                    <div style={{fontSize:11,color:T.textMuted}}>{heureCreation}</div>
                    {retard&&<div style={{fontSize:10,color:"#e05c5c",fontWeight:700,marginTop:2}}>EN RETARD</div>}
                  </td>
                  <td style={{padding:"11px 10px",whiteSpace:"nowrap"}}>
                    <button onClick={()=>{setEditRow(row.id);setEditDraft({...row});}} style={{background:"transparent",border:"none",
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

export default PageCommandes;
