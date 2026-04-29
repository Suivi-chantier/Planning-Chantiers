import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const CATEGORIES_DEFAUT = {
  "Électricité": ["Prise courant simple","Prise courant double","Interrupteur va-et-vient","Installation électrique T1 SANS chauffage","Installation électrique T1 AVEC chauffage","Installation électrique T2 SANS chauffage","Installation électrique T2 AVEC chauffage","Installation électrique T3 SANS chauffage","Installation électrique T3 AVEC chauffage","Radiateur 1500W","Radiateur 1000W","Radiateur 2000W","Tableau 2R T1"],
  "Plomberie": ["Colonne douche thermostatique","Chauffe-eau 40 litres","Chauffe-eau 80 litres","Receveur douche 80x80","Receveur douche 90x90","WC au sol","WC suspendu","Meuble vasque simple"],
  "Ventilation": ["VMC Hygro simple flux","VMC auto simple flux","Bouche VMC","Aérateur extracteur"],
  "Plaquiste": ["Cloison BA13 standard","Cloison BA13 Hydro","Faux plafond","Goulotte GTL"],
  "Sols & Peinture": ["Parquet stratifié","Ragréage sol","Peinture finition C","Escalier 1/4 tournant"],
  "Menuiseries": ["Fenêtre PVC 600x750","Fenêtre PVC 1200x1400","Volet roulant PVC","Velux 78x98"],
  "Maçonnerie": ["Marche béton","Escalier sapin","Poutre sapin"],
  "Démolition": ["Dépose cuisine","Démolition salle de bain","Dépose baignoire"],
};
const UNITES = { "Électricité":"U","Plomberie":"U","Ventilation":"U","Plaquiste":"m²","Sols & Peinture":"m²","Menuiseries":"U","Maçonnerie":"U","Démolition":"m²" };
const LOGEMENTS = ["Studio (T0)","T1 (1 pièce)","T2 (2 pièces)","T3 (3 pièces)","T4 (4 pièces)"];

export default function PageInfoClient({ T }) {
  const [projets, setProjets]         = useState([]);
  const [projetId, setProjetId]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [infos, setInfos]             = useState({ client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"", date_visite:"", observations:"", logements:[] });
  const [ouvrages, setOuvrages]       = useState([]);
  const [cotes, setCotes]             = useState([]);
  const [plans, setPlans]             = useState([{ nom:"Plan 1", data:null }]);
  const [planIdx, setPlanIdx]         = useState(0);
  const [categories, setCategories]   = useState(CATEGORIES_DEFAUT);
  const [tabG, setTabG]               = useState("infos");
  const [tabD, setTabD]               = useState("plan");
  const [search, setSearch]           = useState("");
  const [filtresCat, setFiltresCat]   = useState([]);
  const [showModal, setShowModal]     = useState(false);
  const [newCat, setNewCat]           = useState("Électricité");
  const [newLib, setNewLib]           = useState("");
  const [catParam, setCatParam]       = useState("");
  const [drawActive, setDrawActive]   = useState(false);
  const [eraseActive, setEraseActive] = useState(false);
  const canvasRef  = useRef(null);
  const drawMode   = useRef(false);
  const eraseMode  = useRef(false);
  const isDrawing  = useRef(false);
  const lastPos    = useRef({ x:0, y:0 });
  const saveTimer  = useRef(null);

  // Thème
  const bg      = T.bg      || "#0d0f12";
  const surface = T.surface || "#13161b";
  const card    = T.card    || "#1a1d24";
  const border  = T.border  || "#2a2d35";
  const text    = T.text    || "#f0f0f0";
  const textSub = T.textSub || "#888";
  const accent  = T.accent  || "#FFC300";

  // Styles réutilisables
  const inp = { width:"100%", padding:"9px 12px", background:card, border:`1px solid ${border}`, borderRadius:7, color:text, fontSize:13, fontFamily:"inherit" };
  const ta  = { ...inp, resize:"vertical", minHeight:64 };
  const btn = { background:accent, color:"#000", border:"none", borderRadius:7, padding:"8px 16px", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer" };
  const btnSec = { background:"transparent", color:textSub, border:`1px solid ${border}`, borderRadius:7, padding:"8px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer" };
  const btnDng = { background:"transparent", color:"#e05c5c", border:"1px solid rgba(224,92,92,0.3)", borderRadius:7, padding:"5px 10px", fontFamily:"inherit", fontSize:11, cursor:"pointer" };
  const lbl  = { display:"block", fontSize:11, fontWeight:700, color:textSub, marginBottom:5, textTransform:"uppercase", letterSpacing:.5 };
  const h2s  = { color:accent, fontSize:11, fontWeight:700, marginTop:18, marginBottom:8, paddingBottom:5, borderBottom:`1px solid ${border}`, textTransform:"uppercase", letterSpacing:.7 };
  const tabS = (a) => ({ padding:"7px 16px", border:a?"none":`1px solid ${border}`, borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, background:a?accent:card, color:a?"#000":textSub, letterSpacing:.4, textTransform:"uppercase", transition:"all .12s" });

  // ─── INIT ────────────────────────────────────────────────────────────────────
  useEffect(() => { chargerProjets(); chargerCategories(); }, []);

  useEffect(() => {
    const plan = plans[planIdx];
    if (!plan || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (plan.data) {
      const img = new Image();
      img.onload = () => { ctx.clearRect(0,0,800,600); grille(ctx); ctx.drawImage(img,0,0); };
      img.src = plan.data;
    } else { grille(ctx); }
  }, [planIdx, plans.length]);

  // ─── DATA ────────────────────────────────────────────────────────────────────
  async function chargerProjets() {
    setLoading(true);
    const { data } = await supabase.from("profero_projets").select("*").order("created_at", { ascending:false });
    if (data) { setProjets(data); if (data.length > 0) chargerProjet(data[0].id); else setLoading(false); }
    else setLoading(false);
  }

  async function chargerCategories() {
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").order("ordre");
    if (data && data.length > 0) { const c={}; data.forEach(r => { c[r.nom]=r.ouvrages||[]; }); setCategories(c); }
    else { await supabase.from("profero_categories_ouvrages").insert(Object.entries(CATEGORIES_DEFAUT).map(([nom,ouvrages],i)=>({nom,ouvrages,ordre:i}))); }
  }

  async function chargerProjet(id) {
    setLoading(true); setProjetId(id);
    const [{ data:p },{ data:o },{ data:c },{ data:pl }] = await Promise.all([
      supabase.from("profero_projets").select("*").eq("id",id).single(),
      supabase.from("profero_ouvrages_selectionnes").select("*").eq("projet_id",id),
      supabase.from("profero_cotes").select("*").eq("projet_id",id),
      supabase.from("profero_plans").select("*").eq("projet_id",id),
    ]);
    if (p) setInfos({ client_nom:p.client_nom||"", client_prenom:p.client_prenom||"", adresse_bien:p.adresse_bien||"", description_projet:p.description_projet||"", date_visite:p.date_visite||"", observations:p.observations||"", logements:p.logements||[] });
    setOuvrages(o||[]); setCotes(c||[]);
    setPlans(pl && pl.length > 0 ? pl : [{nom:"Plan 1",data:null}]);
    setPlanIdx(0); setLoading(false);
  }

  function debounce(fn, d=800) { if(saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current=setTimeout(fn,d); }

  async function saveInfos(v) {
    if (!projetId) return; setSaving(true);
    await supabase.from("profero_projets").update({...v, updated_at:new Date().toISOString()}).eq("id",projetId);
    setSaving(false); setProjets(prev=>prev.map(p=>p.id===projetId?{...p,...v}:p));
  }
  function updInfo(f,v) { const u={...infos,[f]:v}; setInfos(u); debounce(()=>saveInfos(u)); }
  function togLog(v) { const l=infos.logements.includes(v)?infos.logements.filter(x=>x!==v):[...infos.logements,v]; const u={...infos,logements:l}; setInfos(u); debounce(()=>saveInfos(u)); }

  async function togOuvrage(cat,item) {
    if (!projetId) return;
    const ex=ouvrages.find(o=>o.category===cat&&o.item===item);
    if (ex) { await supabase.from("profero_ouvrages_selectionnes").delete().eq("id",ex.id); setOuvrages(p=>p.filter(o=>!(o.category===cat&&o.item===item))); }
    else { const{data}=await supabase.from("profero_ouvrages_selectionnes").insert({projet_id:projetId,category:cat,item,quantite:"",unite:UNITES[cat]||"U"}).select().single(); if(data) setOuvrages(p=>[...p,data]); }
  }
  async function updQte(id,q) { setOuvrages(p=>p.map(o=>o.id===id?{...o,quantite:q}:o)); debounce(()=>supabase.from("profero_ouvrages_selectionnes").update({quantite:q}).eq("id",id)); }
  async function updUnite(id,u) { setOuvrages(p=>p.map(o=>o.id===id?{...o,unite:u}:o)); await supabase.from("profero_ouvrages_selectionnes").update({unite:u}).eq("id",id); }

  async function ajoutCote() { if(!projetId) return; const{data}=await supabase.from("profero_cotes").insert({projet_id:projetId,nom:"",largeur:"",hauteur:"",localisation:""}).select().single(); if(data) setCotes(p=>[...p,data]); }
  async function updCote(id,f,v) { setCotes(p=>p.map(c=>c.id===id?{...c,[f]:v}:c)); debounce(()=>supabase.from("profero_cotes").update({[f]:v}).eq("id",id)); }
  async function delCote(id) { await supabase.from("profero_cotes").delete().eq("id",id); setCotes(p=>p.filter(c=>c.id!==id)); }

  async function ajoutPlan() { if(!projetId) return; const{data}=await supabase.from("profero_plans").insert({projet_id:projetId,nom:`Plan ${plans.length+1}`,data:null}).select().single(); if(data){setPlans(p=>[...p,data]);setPlanIdx(plans.length);} }

  async function savePlan() {
    const plan=plans[planIdx]; if(!plan||!canvasRef.current) return;
    const url=canvasRef.current.toDataURL();
    setPlans(p=>p.map((x,i)=>i===planIdx?{...x,data:url}:x));
    if(plan.id) await supabase.from("profero_plans").update({data:url}).eq("id",plan.id);
    else { const{data}=await supabase.from("profero_plans").insert({projet_id:projetId,nom:plan.nom,data:url}).select().single(); if(data) setPlans(p=>p.map((x,i)=>i===planIdx?data:x)); }
  }

  async function nouveauProjet() {
    const nom=window.prompt("Nom du projet :",`Projet ${projets.length+1}`); if(!nom) return;
    const{data}=await supabase.from("profero_projets").insert({client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",date_visite:new Date().toISOString().split("T")[0],observations:"",logements:[]}).select().single();
    if(data){ await supabase.from("profero_plans").insert({projet_id:data.id,nom:"Plan 1",data:null}); setProjets(p=>[data,...p]); chargerProjet(data.id); }
  }
  async function suppProjet() {
    if(!projetId||!window.confirm("Supprimer ce projet ?")) return;
    await supabase.from("profero_projets").delete().eq("id",projetId);
    const r=projets.filter(p=>p.id!==projetId); setProjets(r);
    if(r.length>0) chargerProjet(r[0].id);
    else { setProjetId(null); setInfos({client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",date_visite:"",observations:"",logements:[]}); setOuvrages([]); setCotes([]); setPlans([{nom:"Plan 1",data:null}]); }
  }

  async function ajoutOuvrageLib() {
    if(!newLib.trim()) return;
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",newCat).single();
    if(data){ const l=[...(data.ouvrages||[]),newLib.trim()]; await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[newCat]:l})); setNewLib(""); }
  }
  async function delOuvrageLib(cat,idx) {
    if(!window.confirm("Supprimer ?")) return;
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",cat).single();
    if(data){ const l=data.ouvrages.filter((_,i)=>i!==idx); await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[cat]:l})); }
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────
  function grille(ctx) {
    ctx.fillStyle=card; ctx.fillRect(0,0,800,600);
    ctx.strokeStyle="rgba(255,195,0,0.07)"; ctx.lineWidth=1;
    for(let i=0;i<=800;i+=20){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,600);ctx.stroke();}
    for(let i=0;i<=600;i+=20){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(800,i);ctx.stroke();}
    ctx.strokeStyle=accent; ctx.lineWidth=2; ctx.strokeRect(1,1,798,598);
  }
  function getPos(e,c){ const r=c.getBoundingClientRect(),sx=800/r.width,sy=600/r.height; return e.touches?{x:(e.touches[0].clientX-r.left)*sx,y:(e.touches[0].clientY-r.top)*sy}:{x:(e.clientX-r.left)*sx,y:(e.clientY-r.top)*sy}; }
  function onDown(e){ if(!drawMode.current&&!eraseMode.current) return; e.preventDefault(); isDrawing.current=true; lastPos.current=getPos(e,canvasRef.current); }
  function onMove(e){
    if(!isDrawing.current||(!drawMode.current&&!eraseMode.current)) return; e.preventDefault();
    const c=canvasRef.current,ctx=c.getContext("2d"),p=getPos(e,c);
    if(eraseMode.current){ ctx.fillStyle=card; ctx.fillRect(p.x-12,p.y-12,24,24); }
    else{ ctx.strokeStyle=accent; ctx.lineWidth=2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath(); ctx.moveTo(lastPos.current.x,lastPos.current.y); ctx.lineTo(p.x,p.y); ctx.stroke(); }
    lastPos.current=p;
  }
  function onUp(){ isDrawing.current=false; debounce(()=>savePlan(),1500); }
  function togDraw(){ drawMode.current=!drawMode.current; eraseMode.current=false; setDrawActive(drawMode.current); setEraseActive(false); }
  function togErase(){ eraseMode.current=!eraseMode.current; drawMode.current=false; setEraseActive(eraseMode.current); setDrawActive(false); }
  function clearCanvas(){ if(!window.confirm("Effacer le plan ?")) return; grille(canvasRef.current.getContext("2d")); savePlan(); }
  function dlCanvas(){ const a=document.createElement("a"); a.download=`plan-${plans[planIdx]?.nom||"plan"}.png`; a.href=canvasRef.current.toDataURL(); a.click(); }

  // ─── RENDU ───────────────────────────────────────────────────────────────────
  if (loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:bg,color:accent,fontSize:16,fontWeight:700}}>Chargement…</div>;

  return (
    <div style={{ display:"flex", height:"100%", background:bg, overflow:"hidden" }}>

      {/* ── LISTE PROJETS ── */}
      <div style={{ width:230, flexShrink:0, display:"flex", flexDirection:"column", background:surface, borderRight:`1px solid ${border}` }}>
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${border}`, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:accent, textTransform:"uppercase", letterSpacing:1 }}>
                Projets {saving && <span style={{fontSize:10,opacity:.6}}>💾</span>}
              </div>
              <div style={{ fontSize:11, color:textSub, marginTop:1 }}>{projets.length} fiche{projets.length>1?"s":""}</div>
            </div>
            <div style={{ display:"flex", gap:5 }}>
              <button style={{...btn, padding:"5px 10px", fontSize:13}} onClick={nouveauProjet} title="Nouveau">＋</button>
              <button style={{...btnDng, padding:"5px 8px"}} onClick={suppProjet} title="Supprimer">🗑</button>
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:8 }}>
          {projets.length===0 && (
            <div style={{color:textSub,fontSize:12,textAlign:"center",marginTop:24,lineHeight:1.8}}>
              Aucun projet<br/>
              <button style={{...btn,marginTop:8,fontSize:11}} onClick={nouveauProjet}>Créer</button>
            </div>
          )}
          {projets.map(p => {
            const act=p.id===projetId;
            return (
              <div key={p.id} onClick={()=>chargerProjet(p.id)} style={{ padding:"10px 12px", borderRadius:8, marginBottom:6, cursor:"pointer", background:act?accent:card, border:`1px solid ${act?accent:border}`, borderLeft:`3px solid ${accent}`, transition:"all .12s" }}>
                <div style={{ fontSize:13, fontWeight:700, color:act?"#000":text }}>{p.client_nom?`${p.client_nom} ${p.client_prenom||""}`:"Sans client"}</div>
                <div style={{ fontSize:11, marginTop:2, color:act?"rgba(0,0,0,0.55)":textSub }}>
                  {p.date_visite?`📅 ${new Date(p.date_visite).toLocaleDateString("fr-FR")}`:"Pas de date"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENU PRINCIPAL ── */}
      {!projetId ? (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:textSub}}>
          <div style={{fontSize:52,opacity:.2}}>📋</div>
          <div style={{fontSize:15,fontWeight:700}}>Sélectionne ou crée un projet</div>
          <button style={btn} onClick={nouveauProjet}>➕ Nouveau projet</button>
        </div>
      ) : (
        <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", overflow:"hidden", minWidth:0 }}>

          {/* ─ GAUCHE ─ */}
          <div style={{ overflowY:"auto", padding:"18px 20px", borderRight:`1px solid ${border}`, background:bg }}>
            <div style={{ display:"flex", gap:6, marginBottom:16, paddingBottom:14, borderBottom:`1px solid ${border}` }}>
              <button style={tabS(tabG==="infos")} onClick={()=>setTabG("infos")}>📋 Infos</button>
              <button style={tabS(tabG==="ouvrages")} onClick={()=>setTabG("ouvrages")}>🔨 Ouvrages</button>
            </div>

            {tabG==="infos" && (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:accent, marginBottom:14 }}>📝 Fiche Chantier</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                  <div><label style={lbl}>Nom</label><input style={inp} value={infos.client_nom} onChange={e=>updInfo("client_nom",e.target.value)} placeholder="Dupont" /></div>
                  <div><label style={lbl}>Prénom</label><input style={inp} value={infos.client_prenom} onChange={e=>updInfo("client_prenom",e.target.value)} placeholder="Jean" /></div>
                </div>
                <div style={{marginBottom:10}}><label style={lbl}>Adresse du bien</label><textarea style={ta} value={infos.adresse_bien} onChange={e=>updInfo("adresse_bien",e.target.value)} placeholder="Rue, Code Postal, Ville" /></div>
                <div style={{marginBottom:10}}><label style={lbl}>Description du projet</label><textarea style={ta} value={infos.description_projet} onChange={e=>updInfo("description_projet",e.target.value)} placeholder="Ex: Division en 1 studio + 2 T2" /></div>
                <div style={{marginBottom:10}}><label style={lbl}>Date de visite</label><input type="date" style={inp} value={infos.date_visite} onChange={e=>updInfo("date_visite",e.target.value)} /></div>
                <div style={{marginBottom:14}}><label style={lbl}>Observations générales</label><textarea style={{...ta,minHeight:80}} value={infos.observations} onChange={e=>updInfo("observations",e.target.value)} placeholder="Notes, accès, contraintes..." /></div>

                <div style={h2s}>Composition du projet</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:14 }}>
                  {LOGEMENTS.map(log => {
                    const val=log.split(" ")[0], chk=infos.logements.includes(val);
                    return (
                      <div key={val} onClick={()=>togLog(val)} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:chk?`rgba(255,195,0,0.1)`:card, border:`1px solid ${chk?accent:border}`, borderRadius:7, cursor:"pointer", transition:"all .12s" }}>
                        <input type="checkbox" checked={chk} onChange={()=>togLog(val)} style={{ accentColor:accent, width:15, height:15, flexShrink:0 }} />
                        <span style={{ fontSize:13, color:chk?accent:text }}>{log}</span>
                      </div>
                    );
                  })}
                </div>
                <button style={btnSec} onClick={()=>{ if(window.confirm("Effacer les infos ?")){ const v={client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",observations:"",logements:[],date_visite:""}; setInfos(v); saveInfos(v); }}}>Effacer</button>
              </>
            )}

            {tabG==="ouvrages" && (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:accent, marginBottom:14 }}>🔨 Sélection Ouvrages</div>
                <input style={{...inp,marginBottom:10}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Rechercher un ouvrage..." />
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:14 }}>
                  {Object.keys(categories).map(cat => { const a=filtresCat.includes(cat); return <div key={cat} onClick={()=>setFiltresCat(p=>p.includes(cat)?p.filter(c=>c!==cat):[...p,cat])} style={{ padding:"3px 10px", borderRadius:20, border:`1px solid ${a?accent:border}`, background:a?accent:"transparent", color:a?"#000":textSub, fontSize:11, fontWeight:700, cursor:"pointer", textTransform:"uppercase", letterSpacing:.4 }}>{cat}</div>; })}
                </div>

                {Object.entries(categories).map(([cat,items]) => {
                  const vis=items.filter(item=>(!search||item.toLowerCase().includes(search.toLowerCase()))&&(filtresCat.length===0||filtresCat.includes(cat)));
                  if(vis.length===0) return null;
                  return (
                    <div key={cat}>
                      <div style={h2s}>{cat} ({items.length})</div>
                      {vis.map((item,idx) => {
                        const sel=ouvrages.find(o=>o.category===cat&&o.item===item), chk=!!sel;
                        return (
                          <div key={idx} style={{ padding:"9px 12px", background:chk?`rgba(255,195,0,0.08)`:card, border:`1px solid ${chk?accent:border}`, borderRadius:7, marginBottom:6, display:"flex", alignItems:"flex-start", gap:10, transition:"all .12s" }}>
                            <input type="checkbox" checked={chk} onChange={()=>togOuvrage(cat,item)} style={{ accentColor:accent, width:15, height:15, marginTop:2, flexShrink:0, cursor:"pointer" }} />
                            <div style={{flex:1}}>
                              <div style={{ fontSize:13, color:chk?accent:text, fontWeight:chk?700:400 }}>{item}</div>
                              <div style={{ fontSize:11, color:textSub }}>{cat}</div>
                              {chk && (
                                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                                  <input type="number" placeholder="Quantité" value={sel.quantite||""} onChange={e=>updQte(sel.id,e.target.value)} style={{...inp,width:90,padding:"5px 8px",fontSize:12}} />
                                  <select value={sel.unite||"U"} onChange={e=>updUnite(sel.id,e.target.value)} style={{...inp,width:80,padding:"5px 8px",fontSize:12}}>
                                    <option value="U">Unité</option><option value="m">Mètres</option><option value="m²">M²</option><option value="ml">ML</option>
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <div style={{ display:"flex", gap:8, marginTop:18 }}>
                  <div style={{ background:card, border:`1px solid ${border}`, borderRadius:8, padding:"12px 16px", textAlign:"center", flex:1 }}>
                    <div style={{ fontSize:22, fontWeight:800, color:accent }}>{ouvrages.length}</div>
                    <div style={{ fontSize:11, color:textSub }}>Sélectionnés</div>
                  </div>
                  <div style={{ background:card, border:`1px solid ${border}`, borderRadius:8, padding:"12px 16px", textAlign:"center", flex:1 }}>
                    <div style={{ fontSize:22, fontWeight:800, color:textSub }}>{Object.values(categories).flat().length}</div>
                    <div style={{ fontSize:11, color:textSub }}>Disponibles</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:10 }}>
                  <button style={btnSec} onClick={async()=>{ if(!window.confirm("Déselectionner tout ?")) return; await supabase.from("profero_ouvrages_selectionnes").delete().eq("projet_id",projetId); setOuvrages([]); }}>Tout déselectionner</button>
                  <button style={btn} onClick={()=>setShowModal(true)}>👁️ Voir sélection</button>
                </div>
              </>
            )}
          </div>

          {/* ─ DROITE ─ */}
          <div style={{ overflowY:"auto", padding:"18px 20px", background:bg }}>
            <div style={{ display:"flex", gap:6, marginBottom:16, paddingBottom:14, borderBottom:`1px solid ${border}` }}>
              <button style={tabS(tabD==="plan")} onClick={()=>setTabD("plan")}>📐 Plan</button>
              <button style={tabS(tabD==="params")} onClick={()=>setTabD("params")}>⚙️ Paramètres</button>
              <button style={tabS(tabD==="export")} onClick={()=>setTabD("export")}>📄 Export PDF</button>
            </div>

            {tabD==="plan" && (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:accent, marginBottom:12 }}>📐 Plan du Chantier</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10 }}>
                  {plans.map((p,i) => <button key={i} onClick={()=>setPlanIdx(i)} style={{ padding:"5px 12px", border:`1px solid ${i===planIdx?accent:border}`, background:i===planIdx?accent:card, color:i===planIdx?"#000":textSub, borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700, transition:"all .12s" }}>{p.nom}</button>)}
                  <button style={{...btn,fontSize:11,padding:"5px 10px"}} onClick={ajoutPlan}>➕</button>
                </div>
                <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                  <button style={{...btn,background:drawActive?"#111":accent,color:drawActive?accent:"#000",fontSize:11,border:drawActive?`1px solid ${accent}`:"none"}} onClick={togDraw}>✏️ Dessiner</button>
                  <button style={{...btnSec,fontSize:11,background:eraseActive?"#222":"transparent",color:eraseActive?accent:textSub}} onClick={togErase}>🧹 Gomme</button>
                  <button style={{...btnSec,fontSize:11}} onClick={clearCanvas}>🗑️ Effacer</button>
                  <button style={{...btnSec,fontSize:11}} onClick={dlCanvas}>💾 Télécharger</button>
                </div>
                <div style={{ border:`2px solid ${accent}`, borderRadius:8, overflow:"hidden" }}>
                  <canvas ref={canvasRef} width={800} height={600}
                    style={{ display:"block", width:"100%", cursor:drawActive?"crosshair":eraseActive?"cell":"default", touchAction:"none" }}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                    onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
                  />
                </div>
                <div style={{...h2s,marginTop:20}}>Côtes menuiseries / huisseries</div>
                <button style={{...btn,fontSize:11,marginBottom:10}} onClick={ajoutCote}>➕ Ajouter côte</button>
                {cotes.length===0 && <div style={{color:textSub,fontSize:12,textAlign:"center",padding:16}}>Aucune côte enregistrée</div>}
                {cotes.map(c => (
                  <div key={c.id} style={{ background:card, border:`1px solid ${border}`, borderRadius:8, padding:12, marginBottom:8 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                      <input style={{...inp,fontSize:12}} value={c.nom||""} onChange={e=>updCote(c.id,"nom",e.target.value)} placeholder="Fenêtre salon" />
                      <input style={{...inp,fontSize:12}} value={c.localisation||""} onChange={e=>updCote(c.id,"localisation",e.target.value)} placeholder="Localisation" />
                      <input type="number" style={{...inp,fontSize:12}} value={c.largeur||""} onChange={e=>updCote(c.id,"largeur",e.target.value)} placeholder="Largeur (cm)" />
                      <input type="number" style={{...inp,fontSize:12}} value={c.hauteur||""} onChange={e=>updCote(c.id,"hauteur",e.target.value)} placeholder="Hauteur (cm)" />
                    </div>
                    <button style={btnDng} onClick={()=>delCote(c.id)}>✕ Supprimer</button>
                  </div>
                ))}
              </>
            )}

            {tabD==="params" && (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:accent, marginBottom:14 }}>⚙️ Bibliothèque Ouvrages</div>
                <label style={lbl}>Catégorie à modifier</label>
                <select style={{...inp,marginBottom:10}} value={catParam} onChange={e=>setCatParam(e.target.value)}>
                  <option value="">-- Sélectionner --</option>
                  {Object.keys(categories).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                {catParam && (
                  <>
                    <div style={h2s}>Ouvrages ({(categories[catParam]||[]).length})</div>
                    {(categories[catParam]||[]).map((item,idx) => (
                      <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:card, border:`1px solid ${border}`, borderRadius:7, marginBottom:6 }}>
                        <span style={{flex:1,fontSize:13,color:text}}>{item}</span>
                        <button style={btnDng} onClick={()=>delOuvrageLib(catParam,idx)}>✕</button>
                      </div>
                    ))}
                  </>
                )}
                <div style={{...h2s,marginTop:20}}>Ajouter un ouvrage</div>
                <label style={lbl}>Catégorie</label>
                <select style={{...inp,marginBottom:8}} value={newCat} onChange={e=>setNewCat(e.target.value)}>
                  {Object.keys(categories).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <label style={lbl}>Libellé</label>
                <input style={{...inp,marginBottom:8}} value={newLib} onChange={e=>setNewLib(e.target.value)} placeholder="Ex: Installation électrique T2" onKeyDown={e=>e.key==="Enter"&&ajoutOuvrageLib()} />
                <button style={btn} onClick={ajoutOuvrageLib}>➕ Ajouter</button>
              </>
            )}

            {tabD==="export" && (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:accent, marginBottom:14 }}>📄 Export PDF</div>
                <p style={{color:textSub,fontSize:13,marginBottom:16,lineHeight:1.7}}>Génère un PDF complet avec infos client, ouvrages sélectionnés, côtes et plans.</p>
                <div style={{ background:`rgba(255,195,0,0.07)`, border:`1px solid rgba(255,195,0,0.2)`, borderRadius:8, padding:"14px 16px", marginBottom:20 }}>
                  <div style={{color:accent,fontWeight:700,marginBottom:8,fontSize:13}}>📋 Contenu du PDF</div>
                  {["Infos client et projet","Composition (logements)","Tous les ouvrages sélectionnés","Côtes menuiseries / huisseries","Plans du chantier","Observations"].map(i=>(
                    <div key={i} style={{fontSize:12,color:textSub,marginBottom:4}}>✓ {i}</div>
                  ))}
                </div>
                <button style={btn} onClick={()=>genPDF({infos,ouvrages,cotes,plans,canvasRef})}>📥 Générer & Télécharger PDF</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL ── */}
      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div style={{background:surface,border:`2px solid ${accent}`,borderRadius:12,padding:24,maxWidth:520,width:"90%",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,borderBottom:`2px solid ${accent}`,paddingBottom:10}}>
              <span style={{color:accent,fontWeight:700,fontSize:15}}>✅ Ouvrages sélectionnés ({ouvrages.length})</span>
              <button style={{background:"#e05c5c",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",color:"#fff",fontSize:16}} onClick={()=>setShowModal(false)}>×</button>
            </div>
            {ouvrages.length===0 ? <div style={{color:textSub,textAlign:"center",padding:20}}>Aucun ouvrage sélectionné</div> : (
              Object.entries(ouvrages.reduce((a,o)=>{if(!a[o.category])a[o.category]=[];a[o.category].push(o);return a;},{})).map(([cat,items])=>(
                <div key={cat} style={{marginBottom:14}}>
                  <div style={{background:accent,color:"#000",padding:"6px 12px",borderRadius:6,fontWeight:700,fontSize:13,marginBottom:6}}>{cat}</div>
                  {items.map((it,i)=><div key={i} style={{padding:"5px 12px",fontSize:13,color:text,borderLeft:`2px solid ${border}`,marginBottom:4}}>{it.item}{it.quantite?` — ${it.quantite} ${it.unite}`:""}</div>)}
                </div>
              ))
            )}
            <button style={{...btn,marginTop:12,width:"100%"}} onClick={()=>setShowModal(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
function genPDF({ infos, ouvrages, cotes, plans, canvasRef }) {
  const g=ouvrages.reduce((a,o)=>{if(!a[o.category])a[o.category]=[];a[o.category].push(o);return a;},{});
  const cd=canvasRef.current?canvasRef.current.toDataURL():null;
  const d=new Date().toLocaleDateString("fr-FR");
  const html=`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;margin:20px;color:#333}
    .hd{text-align:center;border-bottom:3px solid #FFC300;padding-bottom:15px;margin-bottom:20px}
    .hd h1{color:#FFC300;margin:0;font-size:22px}
    .sec{margin-bottom:24px;page-break-inside:avoid}
    h2{border-bottom:2px solid #FFC300;padding-bottom:8px;margin-bottom:12px;font-size:15px}
    .row{margin:6px 0;font-size:14px}.lbl{font-weight:bold;color:#FFC300}
    .cat{background:#fff9e6;padding:10px 14px;border-left:4px solid #FFC300;margin-bottom:10px;border-radius:4px}
    .cat-t{font-weight:bold;margin-bottom:6px}ul{margin-left:20px;line-height:2}
    .cote{background:#f9f9f9;padding:10px;border-radius:4px;margin-bottom:8px;font-size:13px}
    img{max-width:100%;border:2px solid #FFC300;margin:10px 0;border-radius:4px}
    .ft{margin-top:30px;text-align:center;color:#aaa;font-size:11px;border-top:1px solid #eee;padding-top:10px}
  </style></head><body>
  <div class="hd"><div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px;"><img src="data:image/jpeg;base64,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" style="height:48px;width:48px;object-fit:contain;background:#0a0a0a;border-radius:8px;padding:4px;" /><h1 style="margin:0;">Information Client — Rapport de Visite</h1></div><p><strong>Client :</strong> ${infos.client_nom} ${infos.client_prenom}</p><p><strong>Date :</strong> ${d}</p></div>
  <div class="sec"><h2>Informations Client</h2>
    <div class="row"><span class="lbl">Nom :</span> ${infos.client_nom} ${infos.client_prenom}</div>
    <div class="row"><span class="lbl">Adresse :</span> ${infos.adresse_bien||"—"}</div>
    <div class="row"><span class="lbl">Date de visite :</span> ${infos.date_visite?new Date(infos.date_visite).toLocaleDateString("fr-FR"):"—"}</div>
    <div class="row"><span class="lbl">Description :</span> ${infos.description_projet||"—"}</div>
    ${infos.logements?.length?`<div class="row"><span class="lbl">Composition :</span> ${infos.logements.join(", ")}</div>`:""}
    ${infos.observations?`<div class="row"><span class="lbl">Observations :</span> ${infos.observations}</div>`:""}
  </div>
  ${ouvrages.length>0?`<div class="sec"><h2>Ouvrages Sélectionnés</h2>${Object.entries(g).map(([cat,its])=>`<div class="cat"><div class="cat-t">${cat}</div><ul>${its.map(i=>`<li>${i.item}${i.quantite?` — ${i.quantite} ${i.unite}`:""}</li>`).join("")}</ul></div>`).join("")}</div>`:""}
  ${cotes.length>0?`<div class="sec"><h2>Côtes</h2>${cotes.map(c=>`<div class="cote"><strong>${c.nom||"(Sans nom)"}</strong><br>L : ${c.largeur||"—"} cm | H : ${c.hauteur||"—"} cm | ${c.localisation||"—"}</div>`).join("")}</div>`:""}
  ${cd?`<div class="sec"><h2>Plan du Chantier</h2><img src="${cd}" /></div>`:""}
  <div class="ft">Rapport généré — ${d}</div></body></html>`;
  const w=window.open("","_blank"); w.document.write(html); w.document.close(); setTimeout(()=>{w.focus();w.print();},500);
}
