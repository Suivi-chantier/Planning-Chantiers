import React, { useState, useEffect, useRef } from "react";
import { supabase, photoTransform } from "../supabase";
import { JOURS, STATUTS, emptyCell, parseTachesFromPlanifie, loadLots } from "../constants";
import { useDirtyGuard } from "../hooks";
import { loadPhasagePourPlanning, syncDatePrevueTache, planningParTache, HEURES_JOUR } from "./phasagePlanning";
import { sortByChrono } from "./chronoTemplate";

// Arrondi au quart d'heure (durée proposée par défaut depuis les heures
// estimées du phasage — modifiable ensuite dans la ligne de tâche).
const arrondiQuart = (h) => {
  const n = parseFloat(h);
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 4) / 4;
};

function CellModal({chantier,jour,draft,setDraft,commande,note,ouvriers,vehicules=[],saving,onClose,T,weekId,year,week,autresHeuresJour={}}){
  if(!chantier)return null;

  // La journée se sauvegarde à la fermeture (onClose) : tant que l'éditeur est
  // ouvert, on bloque l'auto-reload (MAJ PWA) pour ne pas perdre la saisie.
  useDirtyGuard("cell-modal", true);

  const [rapports, setRapports] = useState([]);
  const [loadingRapports, setLoadingRapports] = useState(true);
  // Lightbox plein écran pour les photos du compte rendu
  const [lightbox, setLightbox] = useState(null); // { urls: string[], idx: number }

  // Date réelle du jour sélectionné (objet Date, minuit locale)
  const getDateObj = () => {
    const JOURS_ORDER = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi"];
    const dayIndex = JOURS_ORDER.indexOf(jour);
    if (dayIndex < 0 || !year || !week) return null;
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d;
  };
  const getDateDuJour = () => {
    const d = getDateObj();
    return d ? d.toLocaleDateString("fr-FR") : null; // format dd/mm/yyyy
  };
  // Même jour au format ISO "YYYY-MM-DD" (format de date_prevue du phasage).
  const getDateISO = () => {
    const d = getDateObj();
    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : null;
  };

  // ── Tâches du phasage du chantier (sélecteur « Planifier depuis le phasage »).
  // Chargé à la première ouverture du panneau (lazy), trié dans l'ordre chrono
  // métier. Ajouter une tâche au jour écrit immédiatement sa date_prevue dans
  // le phasage ; la retirer du jour efface la date (si elle vaut encore ce jour).
  const [phasageOpen, setPhasageOpen] = useState(false);
  const [phasageData, setPhasageData] = useState(null); // { ouvrages, chronoGroupes }
  const [phasageLoading, setPhasageLoading] = useState(false);
  const [phasageLots, setPhasageLots] = useState([]);
  const [phasageSearch, setPhasageSearch] = useState("");
  // Heures déjà posées dans le planning par tâche liée (toutes semaines) :
  // { [tacheId]: [{ weekId, jour, date, duree }] }
  const [planningMap, setPlanningMap] = useState({});
  // Garde par ref (et non par state) : mettre loading/data dans les deps
  // relançait l'effet à son propre setState et annulait le fetch en cours
  // (« Chargement… » infini).
  const phasageLoadRef = useRef(null); // chantier.id déjà chargé ou en cours
  useEffect(() => {
    if (!chantier?.id) return;
    // Charge à l'ouverture du panneau, OU dès que la cellule contient des
    // lignes liées au phasage (le recalcul de durée au changement d'ouvriers
    // a besoin des tâches du phasage même panneau fermé).
    if (!phasageOpen && !(draft.taches || []).some(x => x.tache_id)) return;
    if (phasageLoadRef.current === chantier.id) return;
    phasageLoadRef.current = chantier.id;
    setPhasageLoading(true);
    Promise.all([loadPhasagePourPlanning(chantier.id), loadLots(), planningParTache(chantier.id)])
      .then(([data, lots, pmap]) => {
        setPhasageData(data || { ouvrages: [], chronoGroupes: [] });
        setPhasageLots(lots || []);
        setPlanningMap(pmap || {});
      })
      .catch(e => { console.warn("loadPhasagePourPlanning:", e?.message || e); phasageLoadRef.current = null; })
      .finally(() => setPhasageLoading(false));
  }, [phasageOpen, chantier?.id, draft.taches]);

  // Nombre d'ouvriers d'une ligne du brouillon (sans assignés = « visible
  // par tous » → tous les ouvriers de la cellule).
  const nbOuvriersLigne = (x) => (x.ouvriers && x.ouvriers.length) || (draft.ouvriers || []).length || 1;
  // MAIN-D'ŒUVRE de la tâche déjà posée dans le planning (durée × ouvriers,
  // tous jours, toutes semaines) : la durée vendue est en heures de MO — à
  // 2 ouvriers, 10 h vendues se font en 5 h dans la journée. Le brouillon de
  // la cellule en cours remplace ce que la DB connaît de CE jour (la cellule
  // n'est sauvegardée qu'à la fermeture). skipDraftId : ligne du brouillon à
  // exclure (recalcul de sa propre durée).
  const heuresDejaPlanifiees = (tacheId, skipDraftId = null) => {
    let h = (planningMap[String(tacheId)] || [])
      .filter(l => !(l.weekId === weekId && l.jour === jour))
      .reduce((s, l) => s + l.duree * (l.nb || 1), 0);
    (draft.taches || []).forEach(x => {
      if (x.id === skipDraftId) return;
      if (String(x.tache_id || "") === String(tacheId)) h += (parseFloat(x.duree) || 0) * nbOuvriersLigne(x);
    });
    return h;
  };
  // Durée totale prévue d'une tâche (heures de MO) : vendues puis estimées.
  const dureeTotale = (t) => {
    const hV = parseFloat(t.heures_vendues) || 0;
    return hV > 0 ? hV : (parseFloat(t.heures_estimees) || 0);
  };
  // Retrouve la tâche du phasage liée à un tache_id.
  const tacheDuPhasage = (tacheId) => {
    if (!phasageData) return null;
    for (const o of phasageData.ouvrages) {
      const t = (o.taches || []).find(x => String(x.id) === String(tacheId));
      if (t) return t;
    }
    return null;
  };
  // Capacité du jour (HEURES_JOUR est partagée : voir phasagePlanning.js).
  const capaciteJour = HEURES_JOUR[jour] ?? 9;
  // Charge d'un ouvrier ce jour : autres chantiers + lignes de cette cellule
  // qui le concernent (une ligne sans assigné vaut pour tous les ouvriers de
  // la cellule). skipIdx : ligne à exclure (recalcul de sa propre durée).
  const chargeOuvrier = (taches, o, skipIdx = -1) => {
    let h = parseFloat(autresHeuresJour[o]) || 0;
    taches.forEach((x, i) => {
      if (i === skipIdx) return;
      const d = parseFloat(x.duree) || 0;
      if (!d) return;
      const cibles = (x.ouvriers && x.ouvriers.length > 0) ? x.ouvriers : (draft.ouvriers || []);
      if (cibles.includes(o)) h += d;
    });
    return h;
  };
  // Temps restant dans la journée pour une ligne = capacité du jour moins la
  // charge de l'ouvrier le PLUS occupé parmi les assignés (tous chantiers).
  // Sans ouvrier connu : capacité moins la somme des lignes de la cellule.
  const restantJourPour = (taches, cibles, skipIdx = -1) => {
    const charge = (cibles && cibles.length)
      ? Math.max(...cibles.map(o => chargeOuvrier(taches, o, skipIdx)))
      : taches.reduce((s, x, i) => i === skipIdx ? s : s + (parseFloat(x.duree) || 0), 0);
    return Math.max(0, Math.round((capaciteJour - charge) * 4) / 4);
  };
  // Durée du jour proposée pour une ligne liée = MO restante de la tâche
  // (hors cette ligne) ÷ nb d'ouvriers de la ligne, plafonnée à ce qui reste
  // de la journée pour ces ouvriers. null si rien à proposer.
  const dureeAutoLigne = (taches, idx) => {
    const line = taches[idx];
    const t = line?.tache_id ? tacheDuPhasage(line.tache_id) : null;
    if (!t) return undefined; // phasage pas chargé ou tâche inconnue : ne rien changer
    const total = arrondiQuart(dureeTotale(t)) || 0;
    if (total <= 0) return undefined;
    const restantMO = Math.max(0, total - heuresDejaPlanifiees(line.tache_id, line.id));
    const cibles = (line.ouvriers && line.ouvriers.length > 0) ? line.ouvriers : (draft.ouvriers || []);
    const nb = cibles.length || 1;
    let d = Math.round((restantMO / nb) * 4) / 4;
    const restantJour = restantJourPour(taches, cibles, idx);
    if (restantJour > 0 && d > restantJour) d = restantJour;
    return d > 0 ? d : null;
  };

  // Sections du sélecteur : tâches non terminées regroupées sous les étapes
  // de la vue Chronologique du chantier (ordre + couleur des groupes), à
  // défaut par lot. Dans une étape : ordre chrono manuel (chrono_ordre).
  const phasageSections = (() => {
    if (!phasageData) return [];
    const rows = [];
    phasageData.ouvrages.forEach(o => {
      const lot = phasageLots.find(l => l.id === o.lot_id) || null;
      (o.taches || []).forEach(t => {
        if ((parseInt(t.avancement) || 0) >= 100) return;
        rows.push({ lot, ouvrage: o, tache: t });
      });
    });
    sortByChrono(rows, phasageData.chronoGroupes);
    const q = (phasageSearch || "").trim().toLowerCase();
    const visibles = !q ? rows : rows.filter(r =>
      `${r.tache.nom || ""} ${r.ouvrage.libelle || ""} ${r.lot?.label || ""}`.toLowerCase().includes(q));

    const groupes = [...(phasageData.chronoGroupes || [])].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    const sections = [];
    if (groupes.length > 0) {
      const byId = new Map(groupes.map(g => [g.id, { key: g.id, titre: g.nom || "(étape)", couleur: g.couleur || "#94a3b8", rows: [] }]));
      const aClasser = { key: "_aclasser", titre: "À classer", couleur: "#94a3b8", rows: [] };
      visibles.forEach(r => {
        const s = byId.get(r.tache.chrono_groupe_id);
        (s || aClasser).rows.push(r);
      });
      groupes.forEach(g => { const s = byId.get(g.id); if (s.rows.length) sections.push(s); });
      if (aClasser.rows.length) sections.push(aClasser);
    } else {
      // Pas de vue chrono : regroupement par lot (ordre du tri chrono = lot puis ouvrage).
      const byLot = new Map();
      visibles.forEach(r => {
        const key = r.lot?.id || "_sanslot";
        if (!byLot.has(key)) {
          byLot.set(key, { key, titre: r.lot?.label || "Sans lot", couleur: r.lot?.couleur || "#94a3b8", rows: [] });
          sections.push(byLot.get(key));
        }
        byLot.get(key).rows.push(r);
      });
    }
    return sections;
  })();
  const phasageNbTaches = phasageSections.reduce((s, x) => s + x.rows.length, 0);
  const dansLeJour = (tacheId) => (draft.taches || []).some(x => String(x.tache_id || "") === String(tacheId));

  // Reflète une date recalculée dans le panneau, sans recharger le phasage.
  const majDateLocale = (tacheId, date) => {
    if (date === undefined) return;
    setPhasageData(d => d ? {
      ...d,
      ouvrages: d.ouvrages.map(o => ({
        ...o,
        taches: (o.taches || []).map(x => x.id === tacheId ? { ...x, date_prevue: date || "" } : x),
      })),
    } : d);
  };

  // Ajoute une tâche du phasage au jour : ligne structurée liée (tache_id),
  // ouvriers de la tâche ajoutés à la cellule. La durée proposée est le
  // RESTANT de la tâche (durée vendue, à défaut estimée, moins les heures
  // déjà posées sur d'autres jours), plafonné à ce qui reste dans la journée
  // (7 h moins les tâches déjà posées ce jour) — une tâche longue s'étale
  // ainsi sur plusieurs jours, le reliquat étant proposé au placement
  // suivant. La date_prevue du phasage est synchronisée sur le PREMIER jour
  // planifié : poser un jour de continuation ne déplace pas la date de début.
  const addFromPhasage = (row) => {
    const t = row.tache;
    if (dansLeJour(t.id)) return;
    const ouvT = (Array.isArray(t.ouvriers) ? t.ouvriers : []).filter(o => ouvriers.includes(o));
    const total = arrondiQuart(dureeTotale(t)) || 0;
    const restantMO = Math.max(0, Math.round((total - heuresDejaPlanifiees(t.id)) * 4) / 4);
    // MO restante ÷ nb d'ouvriers = durée réelle dans la journée
    // (10 h vendues à 2 ouvriers → 5 h posées), plafonnée au temps restant
    // de l'ouvrier le plus occupé (tous chantiers du jour).
    const cibles = ouvT.length ? ouvT : (draft.ouvriers || []);
    const nb = cibles.length || 1;
    const restantJour = restantJourPour(draft.taches || [], cibles);
    let duree = restantMO > 0 ? Math.round((restantMO / nb) * 4) / 4 : null;
    if (duree != null && restantJour > 0 && duree > restantJour) duree = restantJour;
    const newT = {
      id: Math.random().toString(36).slice(2),
      tache_id: t.id,
      text: t.nom || "",
      duree,
      ouvriers: ouvT,
    };
    setDraft(p => {
      const taches = [...(p.taches || []), newT];
      return {
        ...p, taches,
        planifie: taches.map(x => x.text).join("\n"),
        ouvriers: [...new Set([...(p.ouvriers || []), ...ouvT])],
      };
    });
    const iso = getDateISO();
    if (iso) {
      syncDatePrevueTache(chantier.id, t.id, { addDates: [iso] })
        .then(({ changed, date }) => { if (changed) majDateLocale(t.id, date); });
    }
  };

  // À la suppression d'une ligne liée au phasage : recalcule la date depuis
  // les jours encore planifiés (premier jour restant) ; s'il n'en reste
  // aucun, efface la date si elle valait encore ce jour.
  const onRemoveTache = (removed) => {
    if (!removed?.tache_id) return;
    const iso = getDateISO();
    if (!iso) return;
    syncDatePrevueTache(chantier.id, removed.tache_id, { removeDates: [iso] })
      .then(({ changed, date }) => { if (changed) majDateLocale(removed.tache_id, date); });
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
                    color:T.textMuted,marginRight:2}} title="Toutes tâches du jour, tous chantiers confondus">⏱ Cumul jour</span>
                  {(draft.ouvriers||[]).map(o=>{
                    const ici=cumulParOuvrier[o]||0;
                    const ailleurs=parseFloat(autresHeuresJour[o])||0;
                    const h=Math.round((ici+ailleurs)*4)/4;
                    // Rouge : dépasse la journée ; vert : journée pleine pile.
                    const colH=h>capaciteJour?"#ef4444":h===capaciteJour?"#22c55e":(h>0?T.text:T.textMuted);
                    return(
                      <span key={o}
                        title={ailleurs>0?`${ici}h sur ce chantier + ${ailleurs}h sur d'autres chantiers ce jour`:undefined}
                        style={{display:"inline-flex",alignItems:"center",gap:5,
                          background:chantier.couleur+"22",border:`1px solid ${chantier.couleur}55`,
                          borderRadius:8,padding:"3px 9px",fontSize:12.5}}>
                        <strong style={{color:T.text,fontWeight:700}}>{o}</strong>
                        <span style={{color:colH,fontWeight:800}}>{h}h</span>
                        {ailleurs>0&&(
                          <span style={{color:T.textMuted,fontSize:10.5,fontWeight:700}}>
                            (dont {ailleurs}h ailleurs)
                          </span>
                        )}
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
                      onRemoveTache(tache);
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
                          // Ligne liée au phasage : la durée du jour suit le
                          // nombre d'ouvriers (MO restante ÷ ouvriers).
                          if(t[idx].tache_id){
                            const d=dureeAutoLigne(t,idx);
                            if(d!==undefined)t[idx]={...t[idx],duree:d};
                          }
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

              {/* ── Planifier depuis le phasage du chantier ── */}
              <button onClick={()=>setPhasageOpen(o=>!o)} style={{
                padding:"10px",border:`1.5px dashed ${phasageOpen?chantier.couleur:T.border}`,borderRadius:10,
                background:phasageOpen?chantier.couleur+"14":"transparent",
                color:phasageOpen?T.text:T.textMuted,cursor:"pointer",
                fontFamily:"inherit",fontSize:13,fontWeight:600,transition:"all .15s",
                display:"flex",alignItems:"center",justifyContent:"center",gap:6,
              }}>
                🧱 Planifier depuis le phasage {phasageOpen?"▴":"▾"}
              </button>
              {phasageOpen&&(
                <div style={{background:T.fieldBg,border:`1.5px solid ${T.fieldBorder}`,
                  borderRadius:10,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                  {phasageLoading||(!phasageData)?(
                    <div style={{color:T.textMuted,fontSize:13,padding:"4px 0"}}>Chargement du phasage…</div>
                  ):phasageData.ouvrages.length===0?(
                    <div style={{color:T.textMuted,fontSize:13,fontStyle:"italic",padding:"4px 0"}}>
                      Aucun phasage pour ce chantier.
                    </div>
                  ):(
                    <>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <input value={phasageSearch} onChange={e=>setPhasageSearch(e.target.value)}
                          placeholder="Filtrer (tâche, ouvrage, lot)…"
                          style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:7,
                            padding:"6px 10px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                        <span style={{fontSize:11,color:T.textMuted,flexShrink:0}}>
                          {phasageNbTaches} tâche{phasageNbTaches>1?"s":""} à faire
                        </span>
                      </div>
                      <div style={{maxHeight:340,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                        {phasageNbTaches===0?(
                          <div style={{color:T.textMuted,fontSize:12.5,fontStyle:"italic",padding:"6px 2px"}}>
                            Aucune tâche ne correspond au filtre.
                          </div>
                        ):phasageSections.map(sec=>(
                          <div key={sec.key}>
                            {/* En-tête d'étape (ordre de la vue Chronologique) */}
                            <div style={{
                              display:"flex",alignItems:"center",gap:7,
                              padding:"7px 4px 4px",position:"sticky",top:0,zIndex:2,
                              background:T.fieldBg,
                            }}>
                              <span style={{width:9,height:9,borderRadius:3,background:sec.couleur,flexShrink:0}}/>
                              <span style={{fontSize:10.5,fontWeight:800,letterSpacing:1,textTransform:"uppercase",
                                color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {sec.titre}
                              </span>
                              <span style={{fontSize:10.5,fontWeight:700,color:T.textMuted,flexShrink:0}}>
                                · {sec.rows.length}
                              </span>
                              <span style={{flex:1,borderTop:`1px solid ${T.border}`,marginLeft:2}}/>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:5}}>
                              {sec.rows.map(row=>{
                                const t=row.tache;
                                const added=dansLeJour(t.id);
                                const dejaDatee=!!t.date_prevue;
                                const av=Math.max(0,Math.min(100,parseInt(t.avancement)||0));
                                const hV=parseFloat(t.heures_vendues)||0;
                                const total=dureeTotale(t);
                                const deja=heuresDejaPlanifiees(t.id);
                                const restant=Math.max(0,Math.round((total-deja)*4)/4);
                                return(
                                  <div key={t.id} style={{
                                    display:"flex",alignItems:"center",gap:8,
                                    padding:"7px 9px",borderRadius:8,
                                    border:`1px solid ${added?chantier.couleur+"88":T.border}`,
                                    borderLeft:`3px solid ${av>0?"#8b5cf6":sec.couleur}`,
                                    background:added?chantier.couleur+"14":"transparent",
                                    opacity:added?.85:1,
                                  }}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:13,fontWeight:600,color:T.text,
                                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                        {t.nom||"(sans nom)"}
                                      </div>
                                      <div style={{fontSize:11,color:T.textMuted,
                                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                        {(row.lot?.label?row.lot.label+" · ":"")+(row.ouvrage.libelle||"—")}
                                      </div>
                                      {/* Barre d'avancement fine (si commencée) */}
                                      {av>0&&(
                                        <div style={{height:3,background:T.fieldBorder,borderRadius:2,marginTop:4,overflow:"hidden"}}>
                                          <div style={{height:"100%",width:`${av}%`,background:"#8b5cf6",borderRadius:2}}/>
                                        </div>
                                      )}
                                    </div>
                                    {total>0&&(
                                      <span title={`${total}h ${hV>0?"vendues":"estimées"}${deja>0?` · ${deja}h déjà planifiées`:""}`}
                                        style={{flexShrink:0,fontSize:11,fontWeight:700,
                                          color:deja<=0?"#5b8af5":restant>0?"#f97316":"#22c55e",
                                          background:deja<=0?"rgba(91,138,245,0.12)":restant>0?"rgba(249,115,22,0.12)":"rgba(34,197,94,0.12)",
                                          borderRadius:6,padding:"2px 7px"}}>
                                        ⏱ {deja<=0?`${total}h`:restant>0?`reste ${restant}h / ${total}h`:`${total}h planifiées`}
                                      </span>
                                    )}
                                    {av>0&&(
                                      <span title={`${av}% réalisé`}
                                        style={{flexShrink:0,fontSize:11,fontWeight:700,color:"#8b5cf6",
                                          background:"rgba(139,92,246,0.12)",borderRadius:6,padding:"2px 7px"}}>
                                        {av}%
                                      </span>
                                    )}
                                    {dejaDatee&&!added&&(
                                      <span title="Début prévu (une tâche peut s'étaler sur plusieurs jours : l'ajouter ici ne recule jamais cette date de début)"
                                        style={{flexShrink:0,fontSize:11,fontWeight:700,color:"#f5a623",
                                          background:"rgba(245,166,35,0.12)",borderRadius:6,padding:"2px 7px"}}>
                                        📅 {new Date(t.date_prevue).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}
                                      </span>
                                    )}
                                    {added?(
                                      <span style={{flexShrink:0,fontSize:12,fontWeight:800,color:T.text}}>✓ Ajoutée</span>
                                    ):(
                                      <button onClick={()=>addFromPhasage(row)}
                                        title="Ajouter cette tâche au jour (le phasage garde comme date le premier jour planifié)"
                                        style={{flexShrink:0,background:chantier.couleur,border:"none",borderRadius:7,
                                          padding:"5px 12px",color:"#1a1f2e",fontFamily:"inherit",fontSize:13,
                                          fontWeight:800,cursor:"pointer"}}>+</button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:11,color:T.textMuted,fontStyle:"italic"}}>
                        La date prévue du phasage suit le premier jour planifié : une tâche posée sur
                        plusieurs jours garde son jour de début. La durée proposée est la main-d'œuvre
                        restante divisée par le nombre d'ouvriers de la ligne (10 h vendues à 2 ouvriers
                        → 5 h dans la journée), plafonnée au temps restant des ouvriers ce jour
                        ({capaciteJour} h le {jour.toLowerCase()}, tous chantiers confondus).
                      </div>
                    </>
                  )}
                </div>
              )}
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
