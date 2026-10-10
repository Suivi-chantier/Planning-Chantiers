// Analyse pure : les absences de données ne prouvent jamais une fin de travaux.
export const JOURS_EXPORT = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
export const normaliser = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const texte = t => t.text || t.nom || '';
const passage = t => /\bpassage[s]?\b/.test(normaliser(texte(t)));
const rdv = t => /\brdv\b/.test(normaliser(texte(t)));
const reseau = t => /plomberie|electricite|vmc/.test(t.lot_id || '') || /per|cable|gaine|alimentation|evacuation/.test(normaliser(texte(t)));
const exterieur = o => /fenetre|baie vitree/.test(normaliser(o.libelle));
export function lundiSemaine(weekId) {
  const [y,w] = weekId.split('-W').map(Number); const d = new Date(Date.UTC(y,0,4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7)-1) + (w-1)*7); return d;
}
export function semaineDate(d) {
  const x = new Date(d); x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7)); const y=x.getUTCFullYear();
  return `${y}-W${String(Math.ceil((((x-new Date(Date.UTC(y,0,1)))/86400000)+1)/7)).padStart(2,'0')}`;
}
export function semainesAnalyse(weekId) {
  const m=lundiSemaine(weekId); return Array.from({length:7},(_,i)=>semaineDate(new Date(+m+(i-4)*7*86400000)));
}
export function analyserObjectifsSemaine({weekId,cells=[],chantiers=[],operations=[],phasages=[],ouvriers=[],joursOuvres=JOURS_EXPORT,indisponibles={}}) {
  const faits=[], attentions=[]; const m=lundiSemaine(weekId);
  for (const c of chantiers) {
    const cc=cells.filter(x=>x.chantier_id===c.id);
    const lignes=cc.flatMap(x=>(x.taches?.length ? x.taches : String(x.planifie||'').split('\n').filter(Boolean).map(text=>({text}))).map((t,i)=>({...t,jour:x.jour,week_id:x.week_id,preuve_id:t.allocation_uid || `${x.week_id}:${c.id}:${x.jour}:${i}`})));
    const ici=lignes.filter(x=>x.week_id===weekId).sort((a,b)=>JOURS_EXPORT.indexOf(a.jour)-JOURS_EXPORT.indexOf(b.jour));
    if (!ici.length) continue;
    const ouvrages=phasages.find(p=>p.chantier_id===c.id)?.ouvrages;
    const restantes=(ouvrages||[]).flatMap(o=>(o.taches||[]).filter(t=>Number(t.avancement||0)<100).map(t=>({...t,lot_id:o.lot_id,exterieur:exterieur(o)})));
    // Liens directs prioritaires. Le nom est un secours uniquement si unique dans le phasage.
    const toutes=(ouvrages||[]).flatMap(o=>o.taches||[]);
    const correspond=(t,l)=> l.tache_id ? String(l.tache_id)===String(t.id) : normaliser(texte(l))===normaliser(t.nom) && toutes.filter(x=>normaliser(x.nom)===normaliser(t.nom)).length===1;
    const plan=(t,avant=4)=>ici.filter(l=>JOURS_EXPORT.indexOf(l.jour)<=avant && correspond(t,l));
    const add=(type,ls,extra={})=> { if(!ls.length)return; const jour=ls.at(-1).jour; faits.push({id:`${type}:${c.id}:${jour}:${extra.lot_id||''}:${type==='RDV'?ls[0].preuve_id:''}`,type,chantier_ids:[c.id],operation_id:c.operation_id||null,libelle_groupe:c.nom,jour,couleur:c.couleur,preuves:ls.map(t=>({id:t.preuve_id,tache_id:t.tache_id||null,nom:texte(t),jour:t.jour})),...extra}); };
    const travaux=ici.filter(t=>!rdv(t));
    if(travaux.length && !lignes.some(l=>l.week_id<weekId && !rdv(l))) add('DEMARRAGE',[travaux[0]]);
    const dernier=ici.at(-1).jour;
    if(!lignes.some(l=>l.week_id>weekId) && ici.some(t=>t.jour===dernier && /reception|livraison/.test(normaliser(texte(t))))) add('LIVRAISON',ici.filter(t=>t.jour===dernier && /reception|livraison/.test(normaliser(texte(t)))));
    const essais=ici.filter(t=>/essais? reseaux|avant fermeture/.test(normaliser(texte(t))));
    const passages=ici.filter(t=>passage(t)&&reseau(t));
    if(essais.length) add('FIN_RESEAUX',essais,{controle:true});
    else if(passages.length && ouvrages?.length && restantes.filter(t=>passage(t)&&reseau(t)).every(t=>plan(t).length) && !lignes.some(t=>t.week_id>weekId&&passage(t)&&reseau(t))) add('FIN_RESEAUX',passages,{controle:false});
    const complet=restantes.length>0 && restantes.every(t=>plan(t).length) && !lignes.some(l=>l.week_id>weekId);
    if(complet && restantes.length<=12) add('FIN_CHANTIER',ici);
    else for(const lot of new Set(restantes.map(t=>t.exterieur?'menuiseries_exterieures':t.lot_id).filter(Boolean))) {
      const ts=restantes.filter(t=>(t.exterieur?'menuiseries_exterieures':t.lot_id)===lot);
      if(ts.length && ts.every(t=>plan(t).length) && !lignes.some(l=>l.week_id>weekId && ts.some(t=>correspond(t,l)))) add('FIN_LOT',ici.filter(l=>ts.some(t=>correspond(t,l))),{lot_id:lot});
    }
    for(const l of ici.filter(rdv)) add('RDV',[l],{rdv:texte(l)});
    for(const f of faits.filter(f=>f.chantier_ids.includes(c.id)&&['LIVRAISON','FIN_RESEAUX'].includes(f.type))) {
      const pertinentes=f.type==='LIVRAISON'?restantes:restantes.filter(t=>passage(t)&&reseau(t));
      const manquantes=pertinentes.filter(t=>!plan(t,JOURS_EXPORT.indexOf(f.jour)).length);
      if(manquantes.length) attentions.push(`${c.nom} : ${manquantes.length} tâche(s) du phasage non planifiée(s) avant ${f.type==='LIVRAISON'?'la livraison':'la fin des réseaux'} (${f.jour}).`);
      if(!ouvrages?.length) attentions.push(`${c.nom} : phasage indisponible, achèvement non vérifiable.`);
    }
    for(const t of restantes) for(const l of plan(t)) if(t.date_prevue) {
      const date=new Date(+m+JOURS_EXPORT.indexOf(l.jour)*86400000);
      if(Math.abs(date-new Date(t.date_prevue))/86400000>7) { attentions.push(`${c.nom} : « ${t.nom} », date prévue décalée de plus de 7 jours.`); break; }
    }
    for(const cell of cc.filter(x=>x.week_id===weekId)) if(cell.ouvriers?.length && !ici.some(t=>t.jour===cell.jour)) attentions.push(`${c.nom} — ${cell.jour} : compagnons affectés sans tâche.`);
  }
  for(const o of ouvriers) for(const j of joursOuvres) if(!indisponibles[`${o}_${j}`] && !cells.some(c=>c.week_id===weekId && c.jour===j && c.taches?.some(t=>(t.ouvriers?.length?t.ouvriers:c.ouvriers||[]).includes(o)))) attentions.push(`${o} n'a aucune tâche ${j.toLowerCase()}.`);
  // Un chantier court terminé absorbe ses jalons internes ; une livraison
  // absorbe ses fins de lots. Les preuves restent présentes dans le fait final.
  const retenus=faits.filter(f=>!faits.some(g=>g!==f && g.chantier_ids[0]===f.chantier_ids[0] &&
    ((g.type==='FIN_CHANTIER' && ['DEMARRAGE','FIN_RESEAUX','FIN_LOT'].includes(f.type)) ||
     (g.type==='LIVRAISON' && ['FIN_LOT','FIN_CHANTIER'].includes(f.type)))));
  // Cas métier « menuiseries posées » : pose/calage/fixation, distinct des
  // réglages et finitions. Consolider à l'opération au dernier jour de pose.
  for(const op of operations) {
    const cs=chantiers.filter(c=>c.operation_id===op.id);
    const preuves=[],ids=[];let inconnu=false;
    for(const c of cs) {
      const os=phasages.find(p=>p.chantier_id===c.id)?.ouvrages||[];
      const poses=os.filter(exterieur).flatMap(o=>(o.taches||[]).filter(t=>Number(t.avancement||0)<100 && /mise en place.*(?:fixation|calage)|pose.*(?:fenetre|baie)/.test(normaliser(t.nom))));
      if(!poses.length)continue;
      const lc=cells.filter(x=>x.chantier_id===c.id).flatMap(x=>(x.taches||[]).map((t,i)=>({...t,week_id:x.week_id,jour:x.jour,preuve_id:t.allocation_uid||`${x.week_id}:${c.id}:${x.jour}:${i}`})));
      for(const t of poses) {
        const ls=lc.filter(l=>l.week_id===weekId && (l.tache_id?String(l.tache_id)===String(t.id):normaliser(texte(l))===normaliser(t.nom)));
        if(!ls.length || lc.some(l=>l.week_id>weekId && String(l.tache_id)===String(t.id))) {inconnu=true;break;}
        preuves.push(...ls.map(l=>({id:l.preuve_id,tache_id:t.id,nom:texte(l),jour:l.jour})));if(!ids.includes(c.id))ids.push(c.id);
      }
    }
    if(!inconnu && preuves.length) {
      const jour=JOURS_EXPORT[Math.max(...preuves.map(p=>JOURS_EXPORT.indexOf(p.jour)))];
      const indices=retenus.map((f,i)=>f.type==='FIN_LOT'&&f.operation_id===op.id&&f.lot_id==='menuiseries_exterieures'?i:-1).filter(i=>i>=0).reverse();for(const i of indices)retenus.splice(i,1);
      retenus.push({id:`POSE_EXTERIEURES:${op.id}:${jour}`,type:'FIN_LOT',lot_id:'menuiseries_exterieures',pose_seulement:true,operation_id:op.id,chantier_ids:ids,libelle_groupe:op.nom,jour,couleur:cs[0]?.couleur,preuves});
    }
  }
  const groupes=new Map();
  for(const f of retenus) {
    const k=`${f.operation_id||f.chantier_ids[0]}:${f.type}:${f.jour}:${f.lot_id||''}:${f.rdv||''}`;
    if(!groupes.has(k)) groupes.set(k,{...f,fait_ids:[f.id]});
    else {const g=groupes.get(k);g.chantier_ids.push(...f.chantier_ids);g.preuves.push(...f.preuves);g.fait_ids.push(f.id);g.libelle_groupe+=' · '+f.libelle_groupe;}
  }
  const priorite=['LIVRAISON','DEMARRAGE','FIN_RESEAUX','FIN_LOT','FIN_CHANTIER','RDV'];
  const fusionnes=[...groupes.values()].sort((a,b)=>priorite.indexOf(a.type)-priorite.indexOf(b.type)||JOURS_EXPORT.indexOf(a.jour)-JOURS_EXPORT.indexOf(b.jour));
  for(const g of fusionnes) { const op=operations.find(o=>o.id===g.operation_id); if(op&&g.chantier_ids.length>1&&!g.pose_seulement) {const noms=g.chantier_ids.map(id=>chantiers.find(c=>c.id===id)?.nom||id); const suffixes=noms.map(n=>n.toLowerCase().startsWith(op.nom.toLowerCase())?n.slice(op.nom.length).trim():n);g.libelle_groupe=`${op.nom} ${suffixes.join(' · ')}`;} }
  return {faits:fusionnes.slice(0,8),attentions:[...new Set(attentions)],ecartes:Math.max(0,fusionnes.length-8)};
}
export function objectifsDepuisFaits(faits) {
  return faits.map(f=>({id:f.id,operation_id:f.operation_id,chantier_ids:f.chantier_ids,libelle_groupe:f.libelle_groupe,jour:f.jour,couleur:f.couleur,origine:'analyse',fait_ids:[f.id],titre:({LIVRAISON: /(?:RDC|R\+\d)/i.test(f.libelle_groupe)?`Livraison ${[...f.libelle_groupe.matchAll(/RDC|R\+\d/gi)].map(m=>m[0]).join(', ')}`:'Livraison des logements',DEMARRAGE:'Démarrage du chantier',FIN_RESEAUX:f.controle?'Réseaux terminés':'Réseaux passés',FIN_LOT:f.lot_id==='menuiseries_exterieures'?'Menuiseries extérieures posées':({demolition:'Démolition terminée',electricite:'Électricité terminée',plomberie:'Plomberie terminée',menuiserie:'Menuiseries terminées'})[f.lot_id]||'Lot terminé',FIN_CHANTIER:'Chantier terminé',RDV:f.rdv})[f.type],detail:({LIVRAISON:`Prêts pour la réception ${f.jour.toLowerCase()} soir.`,DEMARRAGE:`Les travaux démarrent ${f.jour.toLowerCase()}.`,FIN_RESEAUX:f.controle?`Réseaux réalisés et contrôlés avant fermeture ${f.jour.toLowerCase()}.`:`Passages des réseaux achevés ${f.jour.toLowerCase()}.`,FIN_LOT:f.pose_seulement?`Menuiseries extérieures en place ${f.jour.toLowerCase()}.`:`Travaux de ce lot terminés ${f.jour.toLowerCase()}.`,FIN_CHANTIER:`Travaux terminés et chantier prêt ${f.jour.toLowerCase()} soir.`,RDV:`Intervention externe prévue ${f.jour.toLowerCase()}.`})[f.type]}));
}
export function validerRedaction(resultat,faits) {
  if(!Array.isArray(resultat)||resultat.length!==faits.length)return false;
  const vus=new Set();
  return resultat.every(o=>{if(!Array.isArray(o.fait_ids)||o.fait_ids.length!==1)return false;const f=faits.find(f=>f.id===o.fait_ids[0]);if(!f||vus.has(f.id)||o.jour!==f.jour||o.libelle_groupe!==f.libelle_groupe||typeof o.titre!=='string'||!o.titre.trim()||o.titre.length>100||typeof o.detail!=='string'||o.detail.length>240)return false;vus.add(f.id);return true;});
}
