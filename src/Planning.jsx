import CellModal from "../components/CellModal";
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS } from "../constants";

// ─── PAGE PLANNING ────────────────────────────────────────────────────────────
function PagePlanning({chantiers,ouvriers,ouvrierEmails,cells,setCells,commandes,setCommandes,notesData,setNotesData,weekId,view,setView,year,week,setYear,setWeek,T}){
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


  // ── Google Calendar – lien direct par cellule ───────────────────────────
  const makeGCalUrl=(chantier, jour, dayIndex, cell)=>{
    // Calcul date ISO de la case (Lundi = 0, Vendredi = 4)
    const jan4=new Date(year,0,4);
    const mon=new Date(jan4);
    mon.setDate(jan4.getDate()-(((jan4.getDay()||7)-1))+(week-1)*7);
    const d=new Date(mon); d.setDate(mon.getDate()+dayIndex);
    // Formatage LOCAL (pas toISOString qui décale en UTC)
    const pad=n=>String(n).padStart(2,'0');
    const dateStr=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;

    // Horaires : lun-mer 7h30→17h30 / jeu-ven 7h30→16h30
    const endHour=dayIndex<=2?'173000':'163000';
    const startDt=`${dateStr}T073000`;
    const endDt=`${dateStr}T${endHour}`;

    const taches=(cell.taches||[]).filter(t=>t.text?.trim());
    const lignes=taches.length
      ?taches.map(t=>`• ${t.text}${t.duree?` (${t.duree}h)`:''}${t.ouvriers?.length?` → ${t.ouvriers.join(', ')}`:' → tous'}`)
      :(cell.planifie||'').split('\n').filter(l=>l.trim()).map(l=>`• ${l}`);

    // Titre : "LAMARTINE / JP STEV"
    const ouv=(cell.ouvriers||[]).map(n=>n.toUpperCase()).join(' ');
    const title=ouv?`${chantier.nom} / ${ouv}`:chantier.nom;

    // Description + lien compte rendu
    const descLines=[...lignes];
    if(cell.reel) descLines.push('','Réalisé :',cell.reel);
    descLines.push('','📱 Compte rendu : https://planning-chantiers.vercel.app/rapport');

    const params=new URLSearchParams({
      action:'TEMPLATE',
      text:title,
      dates:`${startDt}/${endDt}`,
      details:descLines.join('\n'),
      ctz:'Europe/Paris',
    });
    const emails=(cell.ouvriers||[]).map(n=>ouvrierEmails?.[n]).filter(Boolean);
    if(emails.length) params.append('add',emails.join(','));
    return`https://calendar.google.com/calendar/render?${params.toString()}`;
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
      <div className="planning-header" style={{padding:"16px 28px",
        borderBottom:`1px solid ${T.headerBorder}`,
        display:"flex",alignItems:"center",gap:16,
        flexWrap:"wrap",background:T.surface}}>
        <div className="planning-title" style={{fontSize:20,fontWeight:800,letterSpacing:1}}>
          SEMAINE {week} — {year}
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="navbtn" onClick={prevWeek} >‹</button>
          {<button className="navbtn navbtn-today" onClick={goNow} style={{fontSize:11,padding:"6px 10px"}}>CETTE SEMAINE</button>}
          <button className="navbtn" onClick={nextWeek} >›</button>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <button className={`tab ${view==="planifie"?"on":"off"}`} onClick={()=>setView("planifie")}
            >Planifié</button>
          <button className={`tab ${view==="reel"?"on":"off"}`} onClick={()=>setView("reel")}
            >Réel</button>
          <button className={`tab ${view==="compare"?"on":"off"}`} onClick={()=>setView("compare")}
            >Bilan</button>
          <button className="btn-g btn-print" onClick={handlePrint} style={{fontSize:17,padding:"6px 12px"}}>🖨</button>

        </div>
      </div>

      {/* Grille */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
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
              {JOURS.map((jour,di)=>{
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
                        {/* Bouton Google Agenda */}
                        <a href={makeGCalUrl(c,jour,di,cell)} target="_blank" rel="noopener noreferrer"
                          onClick={e=>e.stopPropagation()}
                          title="Ajouter à Google Agenda"
                          style={{position:"absolute",bottom:4,right:4,fontSize:13,textDecoration:"none",
                            background:"#4285F4",color:"#fff",borderRadius:5,padding:"1px 5px",
                            lineHeight:"20px",opacity:.75,transition:"opacity .15s"}}
                          onMouseEnter={e=>e.currentTarget.style.opacity="1"}
                          onMouseLeave={e=>e.currentTarget.style.opacity=".75"}>
                          📅
                        </a>
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

export default PagePlanning;
