import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock, History, RefreshCw, Snowflake, TriangleAlert, X } from "lucide-react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import {
  chargerDonneesPlanningBaselineV1,
  creerBaselineChantierV1,
  etatBaselineChantierV1,
  indexerCellulesParChantierV1,
  indexerDerniereBaselineParChantierV1,
} from "./planningBaselineDataV1.js";

const fmtDateTime = value => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
};

const fmtDate = value => {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0,10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" });
};

const chip = (label, color, bg) => (
  <span style={{fontSize:10.5,fontWeight:800,color,background:bg,borderRadius:999,padding:"3px 8px",whiteSpace:"nowrap"}}>{label}</span>
);

const changeLabel = change => {
  if (change.type === "added") return "Ajoutée au planning";
  if (change.type === "removed") return "Retirée du planning";
  const d = change.details || [];
  const labels = [];
  if (d.includes("date")) labels.push("déplacée");
  if (d.includes("duree")) labels.push("durée modifiée");
  if (d.includes("ressources")) labels.push("équipe modifiée");
  if (d.includes("tache")) labels.push("liaison tâche modifiée");
  return labels.join(" · ") || "Modifiée";
};

export default function PlanningBaselinePanel({ chantiers = [], T, acc, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await chargerDonneesPlanningBaselineV1()); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const cellsByChantier = useMemo(() => indexerCellulesParChantierV1(data?.cells || []), [data]);
  const baselineByChantier = useMemo(() => indexerDerniereBaselineParChantierV1(data?.baselines || []), [data]);

  const rows = useMemo(() => (chantiers || []).map(chantier => {
    const cells = cellsByChantier.get(String(chantier.id)) || [];
    const baseline = baselineByChantier.get(String(chantier.id)) || null;
    let state;
    try {
      state = etatBaselineChantierV1({
        chantierId: chantier.id,
        cells,
        baseline,
        resourceIndex: data?.resourceIndex || new Map(),
      });
    } catch (e) {
      state = { chantier_id:chantier.id, courant:[], baseline, reference:[], diff:null, sans_duree:0, lignes_manuelles:0, erreur:e?.message || String(e) };
    }
    return { chantier, cells, baseline, state };
  }).sort((a,b) => String(a.chantier.nom||"").localeCompare(String(b.chantier.nom||""), "fr")), [chantiers, cellsByChantier, baselineByChantier, data]);

  const toggle = id => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const create = async row => {
    const id = row.chantier.id;
    setCreating(id);
    setError("");
    try {
      await creerBaselineChantierV1({
        chantierId: id,
        cells: data?.cells || [],
        resourceIndex: data?.resourceIndex || new Map(),
        derniereBaseline: row.baseline,
      });
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setCreating(null);
    }
  };

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:1300,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:980,maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column",background:T.modal||T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,boxShadow:"0 24px 70px rgba(0,0,0,.45)"}}>
        <div style={{padding:"18px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:9,fontSize:FONT.lg.size,fontWeight:900,color:T.text}}>
              <Icon as={Snowflake} size={18} color={acc.accent}/> Planning de référence
            </div>
            <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.6,maxWidth:760,marginTop:5}}>
              La référence est une photo immuable du planning. Déplacer ensuite une tâche modifie le planning courant, jamais la référence. Un rebaseline crée une nouvelle version et conserve toutes les précédentes.
            </div>
          </div>
          <div style={{display:"flex",gap:7,flexShrink:0}}>
            <button onClick={load} title="Actualiser" style={{width:34,height:34,borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,cursor:"pointer",display:"grid",placeItems:"center"}}><Icon as={RefreshCw} size={14}/></button>
            <button onClick={onClose} title="Fermer" style={{width:34,height:34,borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,cursor:"pointer",display:"grid",placeItems:"center"}}><Icon as={X} size={15}/></button>
          </div>
        </div>

        {error && <div style={{margin:"12px 18px 0",padding:"9px 12px",borderRadius:RADIUS.md,background:"rgba(239,68,68,.10)",border:"1px solid rgba(239,68,68,.35)",color:"#ef4444",fontSize:12.5,fontWeight:700}}>{error}</div>}

        <div style={{padding:18,overflowY:"auto",display:"flex",flexDirection:"column",gap:10}}>
          {loading ? <div style={{padding:28,textAlign:"center",color:T.textMuted}}>Chargement des références…</div> : rows.map(row => {
            const { chantier, baseline, state } = row;
            const diff = state.diff?.resume;
            const isExpanded = expanded.has(chantier.id);
            const noChange = baseline && diff?.total === 0;
            const nextVersion = Number(baseline?.version || 0) + 1;
            return <div key={chantier.id} style={{border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,background:T.surface,overflow:"hidden"}}>
              <div style={{padding:"13px 15px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <span style={{width:10,height:36,borderRadius:5,background:chantier.couleur||acc.accent,flexShrink:0}}/>
                <div style={{flex:"1 1 220px",minWidth:180}}>
                  <div style={{fontSize:FONT.sm.size+1,fontWeight:900,color:T.text}}>{chantier.nom}</div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2}}>
                    {state.courant.length} allocation{state.courant.length!==1?"s":""} actuellement
                    {state.lignes_manuelles>0 ? ` · ${state.lignes_manuelles} manuelle${state.lignes_manuelles>1?"s":""}` : ""}
                    {state.sans_duree>0 ? ` · ${state.sans_duree} sans durée` : ""}
                  </div>
                </div>

                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  {!baseline ? chip("AUCUNE RÉFÉRENCE", "#f59e0b", "rgba(245,158,11,.12)") : <>
                    {chip(`RÉF. V${baseline.version}`, acc.accent, acc.bg10)}
                    {noChange ? chip("AUCUN ÉCART", "#16a34a", "rgba(34,197,94,.12)") : diff?.total>0 ? chip(`${diff.total} ÉCART${diff.total>1?"S":""}`, "#f97316", "rgba(249,115,22,.12)") : null}
                  </>}
                </div>

                {baseline && <button onClick={()=>toggle(chantier.id)} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"7px 9px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,fontFamily:"inherit",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>
                  Détails <Icon as={isExpanded?ChevronUp:ChevronDown} size={12}/>
                </button>}

                <button disabled={!state.courant.length || !!state.erreur || creating===chantier.id} onClick={()=>setConfirm({chantierId:chantier.id,nextVersion})} style={{padding:"8px 12px",borderRadius:RADIUS.md,border:"none",background:(!state.courant.length||state.erreur)?T.border:acc.accent,color:(!state.courant.length||state.erreur)?T.textMuted:acc.onAccent,fontFamily:"inherit",fontSize:11.5,fontWeight:900,cursor:(!state.courant.length||state.erreur)?"default":"pointer",opacity:creating===chantier.id?.65:1}}>
                  {creating===chantier.id ? "Création…" : baseline ? `Rebaseline V${nextVersion}` : "Figer V1"}
                </button>
              </div>

              {state.erreur && <div style={{padding:"0 15px 12px",fontSize:11.5,color:"#ef4444",fontWeight:700}}><Icon as={TriangleAlert} size={12}/> {state.erreur}</div>}

              {baseline && isExpanded && <div style={{borderTop:`1px solid ${T.border}`,padding:"12px 15px 14px",background:T.card}}>
                <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11.5,color:T.textSub,marginBottom:10}}>
                  <span><Icon as={History} size={12}/> Créée le <strong>{fmtDateTime(baseline.created_at)}</strong></span>
                  <span>{baseline.allocation_count} allocation{baseline.allocation_count!==1?"s":""} figée{baseline.allocation_count!==1?"s":""}</span>
                  {baseline.source==="manual_rebaseline" && <span>Rebaseline explicite</span>}
                </div>
                {noChange ? <div style={{display:"flex",alignItems:"center",gap:6,color:"#16a34a",fontWeight:800,fontSize:12}}><Icon as={CheckCircle2} size={14}/> Le planning courant correspond exactement à la référence V{baseline.version}.</div> : (
                  <>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                      {diff?.moved>0 && chip(`${diff.moved} déplacée${diff.moved>1?"s":""}`, "#2563eb", "rgba(37,99,235,.10)")}
                      {diff?.resized>0 && chip(`${diff.resized} durée${diff.resized>1?"s":""} modifiée${diff.resized>1?"s":""}`, "#7c3aed", "rgba(124,58,237,.10)")}
                      {diff?.restaffed>0 && chip(`${diff.restaffed} équipe${diff.restaffed>1?"s":""} modifiée${diff.restaffed>1?"s":""}`, "#0891b2", "rgba(8,145,178,.10)")}
                      {diff?.added>0 && chip(`${diff.added} ajoutée${diff.added>1?"s":""}`, "#16a34a", "rgba(34,197,94,.10)")}
                      {diff?.removed>0 && chip(`${diff.removed} retirée${diff.removed>1?"s":""}`, "#dc2626", "rgba(239,68,68,.10)")}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {(state.diff?.changements || []).map((c,i) => {
                        const a = c.after || c.before || {};
                        return <div key={`${c.allocation_uid}-${i}`} style={{padding:"8px 10px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:T.surface,display:"grid",gridTemplateColumns:"minmax(170px,1fr) minmax(160px,1.1fr)",gap:10,fontSize:11.5}}>
                          <div><strong style={{color:T.text}}>{a.texte || "Tâche sans libellé"}</strong><div style={{color:T.textMuted,marginTop:2}}>{changeLabel(c)}</div></div>
                          <div style={{color:T.textSub}}>
                            {c.type==="changed" && c.details?.includes("date") && <div><Icon as={Clock} size={11}/> {fmtDate(c.before?.date)} → <strong>{fmtDate(c.after?.date)}</strong></div>}
                            {c.type==="changed" && c.details?.includes("duree") && <div>Durée : {c.before?.duree||0} h → <strong>{c.after?.duree||0} h</strong></div>}
                            {c.type==="changed" && c.details?.includes("ressources") && <div>Équipe : {(c.before?.ouvriers_noms||[]).join(", ")||"—"} → <strong>{(c.after?.ouvriers_noms||[]).join(", ")||"—"}</strong></div>}
                            {c.type==="added" && <div>Ajout le {fmtDate(c.after?.date)} · {c.after?.duree||0} h</div>}
                            {c.type==="removed" && <div>Référence : {fmtDate(c.before?.date)} · {c.before?.duree||0} h</div>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </>
                )}
              </div>}
            </div>;
          })}
        </div>

        {confirm && (() => {
          const row = rows.find(r=>r.chantier.id===confirm.chantierId);
          if (!row) return null;
          const isRebaseline = !!row.baseline;
          return <div onClick={()=>setConfirm(null)} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.58)",display:"grid",placeItems:"center",padding:18,zIndex:4}}>
            <div onClick={e=>e.stopPropagation()} style={{maxWidth:480,width:"100%",background:T.modal||T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:18,boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
              <div style={{fontWeight:900,fontSize:FONT.md.size,color:T.text}}>{isRebaseline?`Créer la référence V${confirm.nextVersion} ?`:"Figer la référence V1 ?"}</div>
              <div style={{fontSize:12.5,lineHeight:1.65,color:T.textSub,marginTop:8}}>
                {isRebaseline
                  ? `La V${row.baseline.version} restera conservée. Le planning actuel de ${row.chantier.nom} deviendra simplement la nouvelle référence V${confirm.nextVersion}.`
                  : `Le planning actuel de ${row.chantier.nom} sera figé comme référence V1. Les modifications futures seront comparées à cette photo.`}
              </div>
              {row.state.sans_duree>0 && <div style={{marginTop:10,padding:"8px 10px",borderRadius:RADIUS.md,background:"rgba(245,158,11,.10)",color:"#f59e0b",fontSize:11.5,fontWeight:700}}><Icon as={TriangleAlert} size={12}/> {row.state.sans_duree} allocation{row.state.sans_duree>1?"s":""} sans durée seront quand même figées.</div>}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
                <button onClick={()=>setConfirm(null)} style={{padding:"8px 13px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,fontFamily:"inherit",cursor:"pointer"}}>Annuler</button>
                <button onClick={()=>create(row)} style={{padding:"8px 13px",borderRadius:RADIUS.md,border:"none",background:acc.accent,color:acc.onAccent,fontFamily:"inherit",fontWeight:900,cursor:"pointer"}}>Confirmer V{confirm.nextVersion}</button>
              </div>
            </div>
          </div>;
        })()}
      </div>
    </div>
  );
}
