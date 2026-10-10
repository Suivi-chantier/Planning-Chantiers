import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { capaciteJour } from '../rythmeSemaine';
import { analyserObjectifsSemaine, objectifsDepuisFaits, validerRedaction, semainesAnalyse, lundiSemaine, JOURS_EXPORT } from './objectifsSemaine';
import { buildPlanningHebdoDoc, imprimerPlanningHebdo } from './planningHebdoDoc';
import { calculerCapaciteRessourcePourDate } from './planningResourceCapacityV1';

async function lireToutes(requete) {
  const lignes=[];for(let start=0;;start+=1000){const r=await requete().range(start,start+999);if(r.error)throw new Error(r.error.message);lignes.push(...r.data);if(r.data.length<1000)return lignes;}
}
async function chargerAnalyse({weekId,chantiers,cells,ouvriers,year,week}) {
  const semaines=semainesAnalyse(weekId),m=lundiSemaine(weekId),fin=new Date(+m+4*86400000).toISOString().slice(0,10);
  const [historique,phasages,config,resources,events]=await Promise.all([
    lireToutes(()=>supabase.from('planning_cells').select('week_id,chantier_id,jour,taches,ouvriers,planifie').in('week_id',semaines).order('id')),
    lireToutes(()=>supabase.from('phasages').select('id,chantier_id,ouvrages').in('chantier_id',chantiers.map(c=>c.id)).order('id')),
    supabase.from('planning_config').select('value').eq('key','operations').maybeSingle(),
    supabase.from('planning_resources').select('*').eq('actif',true),
    supabase.from('planning_resource_events').select('*').eq('actif',true).lte('date_debut',fin).gte('date_fin',m.toISOString().slice(0,10)),
  ]);
  for(const r of [config,resources,events])if(r.error)throw new Error(r.error.message);
  const courantes=chantiers.flatMap(c=>JOURS_EXPORT.map(j=>({...cells[`${c.id}_${j}`],chantier_id:c.id,jour:j,week_id:weekId})));
  const indisponibles={};
  for(const o of ouvriers)for(let i=0;i<5;i++) {const resource=resources.data.find(r=>(r.nom_planning||r.nom)===o);if(resource){const dateISO=new Date(+m+i*86400000).toISOString().slice(0,10);const cap=calculerCapaciteRessourcePourDate({resource,dateISO,evenements:events.data.filter(e=>e.resource_id===resource.id),heuresDejaAllouees:0});if(cap.capacite_apres_exceptions===0)indisponibles[`${o}_${JOURS_EXPORT[i]}`]=true;}}
  return analyserObjectifsSemaine({weekId,chantiers,ouvriers,phasages,operations:config.data?.value?.items||[],cells:[...historique.filter(c=>c.week_id!==weekId),...courantes],joursOuvres:JOURS_EXPORT.filter(j=>capaciteJour(j,year,week)>0),indisponibles});
}
export default function PlanningExportModal({weekId,week,year,chantiers,cells,ouvriers,dates,getDisplayTaches,onClose,T}) {
  const [objectifs,setObjectifs]=useState([]),[remarques,setRemarques]=useState(''),[attentions,setAttentions]=useState([]);
  const [busy,setBusy]=useState(true),[message,setMessage]=useState(''),[erreur,setErreur]=useState(''),[succes,setSucces]=useState(''),[manuel,setManuel]=useState(false),[job,setJob]=useState(null);
  const version=useRef(null),generation=useRef(0),charge=useRef(false),dirty=useRef(false);
  const changer=fn=>{setSucces('');dirty.current=true;setManuel(true);fn();};
  async function analyser(token) {
    const a=await chargerAnalyse({weekId,year,week,chantiers,cells,ouvriers});if(token!==generation.current)return;
    let os=objectifsDepuisFaits(a.faits),jobId=null;setAttentions([...a.attentions,...(a.ecartes?[`${a.ecartes} autres jalons écartés (maximum 8 propositions).`]:[])]);
    setMessage('');
    if(a.faits.length)try {
      const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Session expirée');
      const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({tache:'objectifs_semaine',entree:{faits:a.faits},contexte:{branche:'renovation',entite_type:'planning_semaine',entite_id:weekId}})});
      const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.erreur?.message||'Erreur IA');
      if(!validerRedaction(data.resultat,a.faits))throw new Error('Rédaction sans preuve ou jalon modifié');
      os=os.map((o,i)=>({...o,titre:data.resultat.find(r=>r.fait_ids[0]===o.fait_ids[0]).titre,detail:data.resultat.find(r=>r.fait_ids[0]===o.fait_ids[0]).detail}));jobId=data.job_id;
    }catch(e){if(token===generation.current)setMessage(`Rédaction automatique indisponible — objectifs proposés par règles, à relire. ${e.message}`);}
    if(token!==generation.current)return;setObjectifs(os);setJob(jobId);setManuel(false);dirty.current=true;
  }
  useEffect(()=>{const token=++generation.current;async function init(){try{
    const r=await supabase.from('planning_semaine_export').select('*').eq('week_id',weekId).maybeSingle();if(r.error)throw new Error(r.error.message);if(token!==generation.current)return;
    version.current=r.data?.updated_at||null;charge.current=true;
    if(r.data){setObjectifs(r.data.objectifs);setRemarques(r.data.remarques);setManuel(r.data.modifications_manuelles);setJob(r.data.analyse_job_id);setAttentions(r.data.points_attention||[]);setMessage(r.data.message_analyse||'');}
    else await analyser(token);
  }catch(e){if(token===generation.current)setErreur(`Analyse ou chargement impossible : ${e.message}. La saisie manuelle et « Planning seul » restent disponibles.`);}finally{if(token===generation.current)setBusy(false);}}
  init();return()=>{generation.current++;};},[weekId]);
  async function relancer(){if(manuel&&!window.confirm('Remplacer les objectifs modifiés par une nouvelle analyse ? Les remarques seront conservées.'))return;setBusy(true);setErreur('');try{await analyser(++generation.current);}catch(e){setErreur(`Analyse impossible : ${e.message}`);}finally{setBusy(false);}}
  async function sauvegarder(){
    if(!charge.current)throw new Error('Sauvegarde indisponible : fermez puis rouvrez cette fenêtre pour recharger la semaine.');
    const payload={week_id:weekId,objectifs,remarques,analyse_job_id:job,modifications_manuelles:manuel,points_attention:attentions,message_analyse:message};
    const q=version.current?supabase.from('planning_semaine_export').update(payload).eq('week_id',weekId).eq('updated_at',version.current):supabase.from('planning_semaine_export').insert(payload);
    const r=await q.select('updated_at').maybeSingle();if(r.error)throw new Error(r.error.code==='23505'?'Cette semaine a été enregistrée ailleurs : rouvrez la fenêtre.':r.error.message);
    if(!r.data)throw new Error('Cette semaine a été modifiée ailleurs : rouvrez la fenêtre avant de sauvegarder.');version.current=r.data.updated_at;dirty.current=false;
  }
  async function imprimer(seul=false){
    const w=window.open('','_blank');if(!w){setErreur('Autorisez les fenêtres pour ouvrir le PDF.');return;}
    setBusy(true);setErreur('');try{if(!seul)await sauvegarder();await imprimerPlanningHebdo(w,buildPlanningHebdoDoc({week,year,dates,chantiers,cells,getDisplayTaches,objectifs:seul?[]:objectifs,remarques:seul?'':remarques,imprimeLe:new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}),baseUrl:window.location.origin+'/'}));}catch(e){w.close();setErreur(e.message);}finally{setBusy(false);}
  }
  const champ={width:'100%',padding:8,border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text,fontFamily:'inherit'};
  const btn={padding:'9px 12px',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',background:T.card||T.bg,color:T.text,fontFamily:'inherit'};
  const modifier=(id,key,val)=>changer(()=>setObjectifs(os=>os.map(o=>o.id===id?{...o,[key]:val,origine:'manuel'}:o)));
  const fermer=()=>{if(!dirty.current||window.confirm('Fermer sans enregistrer les modifications ?'))onClose();};
  return <div style={{position:'fixed',inset:0,zIndex:1200,background:'#0009',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
    <div role="dialog" aria-modal="true" aria-label={`Export du planning — Semaine ${week}`} style={{background:T.modal||T.bg,color:T.text,borderRadius:14,padding:22,width:900,maxWidth:'100%',maxHeight:'92vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><h2>Export du planning — Semaine {week}</h2><button style={btn} disabled={busy} onClick={fermer}>Fermer</button></div>
      {busy&&<p role="status">Préparation en cours…</p>}{erreur&&<p role="alert" style={{color:'#dc2626'}}>{erreur}</p>}{message&&<p role="status" style={{color:'#d97706'}}>{message}</p>}
      {succes&&<p role="status">{succes}</p>}
      <p>Validez les résultats attendus avant d’imprimer. Les points d’attention restent dans cette fenêtre.</p>
      <button style={btn} disabled={busy} onClick={relancer}>Relancer l’analyse</button>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:12,margin:'16px 0'}}>{objectifs.map(o=><div key={o.id} style={{padding:12,border:`1px solid ${T.border}`,borderLeft:`4px solid ${o.couleur||'#64748b'}`,borderRadius:8}}>
        <label>Groupe affiché<input disabled={busy} style={champ} value={o.libelle_groupe} onChange={e=>modifier(o.id,'libelle_groupe',e.target.value)}/></label>
        <label>Jour<select disabled={busy} style={champ} value={o.jour} onChange={e=>modifier(o.id,'jour',e.target.value)}>{JOURS_EXPORT.map(j=><option key={j}>{j}</option>)}</select></label>
        <label>Titre court<input disabled={busy} style={champ} maxLength={100} value={o.titre} onChange={e=>modifier(o.id,'titre',e.target.value)}/></label>
        <label>Détail<input disabled={busy} style={champ} maxLength={240} value={o.detail} onChange={e=>modifier(o.id,'detail',e.target.value)}/></label>
        <label>Couleur<input disabled={busy} type="color" value={/^#[a-f0-9]{6}$/i.test(o.couleur)?o.couleur:'#64748b'} onChange={e=>modifier(o.id,'couleur',e.target.value)}/></label>
        <button disabled={busy} style={btn} onClick={()=>changer(()=>setObjectifs(os=>os.filter(x=>x.id!==o.id)))}>Supprimer</button>
      </div>)}</div>
      {!busy&&!objectifs.length&&<p>Aucun objectif proposé. Ajoutez les engagements à la main.</p>}
      <button style={btn} disabled={busy||objectifs.length>=8} onClick={()=>changer(()=>setObjectifs(os=>[...os,{id:crypto.randomUUID(),operation_id:null,chantier_ids:[],libelle_groupe:'',jour:'Lundi',titre:'',detail:'',couleur:'#64748b',origine:'manuel',fait_ids:[]}]))}>+ Ajouter un objectif</button>
      <label style={{display:'block',marginTop:16}}>Remarques — une ligne par remarque<textarea disabled={busy} style={{...champ,minHeight:80}} value={remarques} onChange={e=>changer(()=>setRemarques(e.target.value))}/></label>
      {!!attentions.length&&<details style={{margin:'16px 0'}}><summary>Points d’attention ({attentions.length}) — non imprimés</summary><ul>{attentions.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
      <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:16}}>
        <button disabled={busy||objectifs.some(o=>!o.titre.trim()||!o.libelle_groupe.trim())} style={{...btn,background:'#FFC200',color:'#161b28',fontWeight:800}} onClick={()=>imprimer()}>Générer le PDF</button>
        <button disabled={busy} style={btn} onClick={async()=>{setBusy(true);setErreur('');try{await sauvegarder();setSucces('Objectifs et remarques enregistrés.');}catch(e){setErreur(e.message);}finally{setBusy(false);}}}>Enregistrer sans imprimer</button>
        <button disabled={busy} style={btn} onClick={()=>imprimer(true)}>Planning seul</button>
      </div>
    </div>
  </div>;
}
