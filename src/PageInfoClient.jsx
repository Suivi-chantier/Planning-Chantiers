import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import {
  UserCircle, Plus, Trash2, Search, Calendar, MapPin, FileText, Hammer,
  Ruler, Settings, FileDown, Check, X, AlertTriangle, Menu,
  Pencil, Eraser, Download, ChevronRight, Building2, Layers,
  Camera, Copy, Euro, ChevronLeft as ChevronLeftIcon,
} from "lucide-react";

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

// ─── STATUTS DE PROJET (flux commercial) ─────────────────────────────────────
const STATUTS_PROJET = [
  { id: "prospect",       label: "Prospect",         color: "#94a3b8" },
  { id: "rdv_planifie",   label: "RDV planifié",     color: "#5b9cf6" },
  { id: "visite_faite",   label: "Visite faite",     color: "#22c55e" },
  { id: "chiffrage",      label: "Chiffrage",        color: "#f5a623" },
  { id: "devis_envoye",   label: "Devis envoyé",     color: "#a78bfa" },
  { id: "signe",          label: "Signé",            color: "#10b981" },
  { id: "abandonne",      label: "Abandonné",        color: "#e15a5a" },
];
const statutMeta = (id) => STATUTS_PROJET.find(s => s.id === id) || STATUTS_PROJET[0];

// ─── UPLOAD PHOTO (bucket "photos") ──────────────────────────────────────────
async function uploadInfoClientPhoto(file, projetId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `info-client/${projetId}/${safe}`;
  const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
  if (error) { console.error("upload photo:", error); return null; }
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data?.publicUrl || null;
}

export default function PageInfoClient({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [projets, setProjets]         = useState([]);
  const [projetId, setProjetId]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [infos, setInfos]             = useState({ client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"", date_visite:"", observations:"", logements:[], statut:"prospect" });
  const [ouvrages, setOuvrages]       = useState([]);
  const [cotes, setCotes]             = useState([]);
  const [plans, setPlans]             = useState([{ nom:"Plan 1", data:null }]);
  const [planIdx, setPlanIdx]         = useState(0);
  const [categories, setCategories]   = useState(CATEGORIES_DEFAUT);
  // Un seul flux d'onglets (au lieu de gauche/droite) — bien plus clair
  const [tab, setTab]                 = useState("client");
  const [search, setSearch]           = useState("");
  const [filtresCat, setFiltresCat]   = useState([]);
  const [filtreStatut, setFiltreStatut] = useState("all");
  const [searchProjets, setSearchProjets] = useState("");
  const [showModal, setShowModal]     = useState(false);
  const [newCat, setNewCat]           = useState("Électricité");
  const [newLib, setNewLib]           = useState("");
  const [catParam, setCatParam]       = useState("");
  const [drawActive, setDrawActive]   = useState(false);
  const [eraseActive, setEraseActive] = useState(false);
  const [mobileShowProjets, setMobileShowProjets] = useState(false);
  const [toDelete, setToDelete]       = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [toDeleteOuvrage, setToDeleteOuvrage] = useState(null);
  const [photos, setPhotos]           = useState([]); // [{ id, url, label, created_at }]
  const [uploadingCount, setUploadingCount] = useState(0);
  const [lightbox, setLightbox]       = useState(null); // { urls:[], idx:0 }
  const [exporting, setExporting]     = useState(false);
  const photoInputRef = useRef(null);
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
    if (p) setInfos({ client_nom:p.client_nom||"", client_prenom:p.client_prenom||"", adresse_bien:p.adresse_bien||"", description_projet:p.description_projet||"", date_visite:p.date_visite||"", observations:p.observations||"", logements:p.logements||[], statut:p.statut||"prospect" });
    setOuvrages(o||[]); setCotes(c||[]);
    setPlans(pl && pl.length > 0 ? pl : [{nom:"Plan 1",data:null}]);
    setPhotos(Array.isArray(p?.photos) ? p.photos : []);
    setPlanIdx(0); setLoading(false);
  }

  async function savePhotos(newPhotos) {
    setPhotos(newPhotos);
    if (!projetId) return;
    const { error } = await supabase.from("profero_projets").update({ photos: newPhotos }).eq("id", projetId);
    if (error) console.error("savePhotos:", error);
  }

  async function onPhotoFiles(files) {
    if (!projetId) return;
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setUploadingCount(arr.length);
    const news = [];
    for (const f of arr) {
      const url = await uploadInfoClientPhoto(f, projetId);
      if (url) news.push({ id: Math.random().toString(36).slice(2), url, label: "", created_at: new Date().toISOString() });
      setUploadingCount(n => n - 1);
    }
    if (news.length > 0) await savePhotos([...photos, ...news]);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }
  const removePhoto = (i) => savePhotos(photos.filter((_, idx) => idx !== i));
  const updatePhotoLabel = (i, label) => {
    const next = photos.map((p, idx) => idx === i ? { ...p, label } : p);
    setPhotos(next);
    debounce(() => savePhotos(next));
  };

  function debounce(fn, d=800) { if(saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current=setTimeout(fn,d); }

  async function saveInfos(v) {
    if (!projetId) return; setSaving(true);
    const payload = {
      client_nom:          v.client_nom          ?? "",
      client_prenom:       v.client_prenom       ?? "",
      adresse_bien:        v.adresse_bien        ?? "",
      description_projet:  v.description_projet  ?? "",
      date_visite:         v.date_visite         ?? "",
      observations:        v.observations        ?? "",
      logements:           v.logements           ?? [],
      statut:              v.statut              ?? "prospect",
    };
    const { error } = await supabase.from("profero_projets").update(payload).eq("id", projetId);
    if (error) console.error("saveInfos projet error:", error);
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
  async function updPrix(id,prix) {
    setOuvrages(p=>p.map(o=>o.id===id?{...o,prix_unitaire:prix}:o));
    debounce(()=>supabase.from("profero_ouvrages_selectionnes").update({prix_unitaire:prix===""?null:parseFloat(prix)}).eq("id",id));
  }

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
    const{data}=await supabase.from("profero_projets").insert({
      client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"",
      date_visite:new Date().toISOString().split("T")[0], observations:"", logements:[], statut:"prospect",
    }).select().single();
    if(data){ await supabase.from("profero_plans").insert({projet_id:data.id,nom:"Plan 1",data:null}); setProjets(p=>[data,...p]); chargerProjet(data.id); }
  }

  async function dupliquerProjet() {
    if (!projetId) return;
    const src = projets.find(p => p.id === projetId);
    if (!src) return;
    // 1) Création du nouveau projet (copie des infos + photos, statut reset à prospect)
    const newNom = src.client_nom ? `Copie de ${src.client_nom}` : "Copie sans client";
    const { data: nouveau } = await supabase.from("profero_projets").insert({
      client_nom:      newNom,
      client_prenom:   src.client_prenom || "",
      adresse_bien:    src.adresse_bien || "",
      description_projet: src.description_projet || "",
      date_visite:     new Date().toISOString().split("T")[0],
      observations:    src.observations || "",
      logements:       src.logements || [],
      statut:          "prospect",
      photos:          src.photos || [],
    }).select().single();
    if (!nouveau) return;
    // 2) Clone ouvrages
    const ouvrSrc = ouvrages.map(o => ({
      projet_id: nouveau.id,
      category:  o.category,
      item:      o.item,
      quantite:  o.quantite,
      unite:     o.unite,
      prix_unitaire: o.prix_unitaire ?? null,
    }));
    if (ouvrSrc.length > 0) await supabase.from("profero_ouvrages_selectionnes").insert(ouvrSrc);
    // 3) Clone côtes
    const cotesSrc = cotes.map(c => ({
      projet_id: nouveau.id,
      nom: c.nom, largeur: c.largeur, hauteur: c.hauteur, localisation: c.localisation,
    }));
    if (cotesSrc.length > 0) await supabase.from("profero_cotes").insert(cotesSrc);
    // 4) Clone plans
    const plansSrc = plans.filter(p => p.id).map(p => ({
      projet_id: nouveau.id, nom: p.nom, data: p.data,
    }));
    if (plansSrc.length > 0) await supabase.from("profero_plans").insert(plansSrc);
    else await supabase.from("profero_plans").insert({ projet_id: nouveau.id, nom: "Plan 1", data: null });
    // 5) Refresh
    setProjets(p => [nouveau, ...p]);
    chargerProjet(nouveau.id);
  }

  async function confirmSuppProjet() {
    if (!toDelete) return;
    setDeleting(true);
    await supabase.from("profero_projets").delete().eq("id", toDelete.id);
    const r = projets.filter(p => p.id !== toDelete.id);
    setProjets(r);
    if (toDelete.id === projetId) {
      if (r.length > 0) chargerProjet(r[0].id);
      else {
        setProjetId(null);
        setInfos({client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",date_visite:"",observations:"",logements:[],statut:"prospect"});
        setOuvrages([]); setCotes([]); setPlans([{nom:"Plan 1",data:null}]);
      }
    }
    setDeleting(false);
    setToDelete(null);
  }

  async function ajoutOuvrageLib() {
    if(!newLib.trim()) return;
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",newCat).single();
    if(data){ const l=[...(data.ouvrages||[]),newLib.trim()]; await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[newCat]:l})); setNewLib(""); }
  }
  async function delOuvrageLib(cat,idx) {
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",cat).single();
    if(data){ const l=data.ouvrages.filter((_,i)=>i!==idx); await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[cat]:l})); }
    setToDeleteOuvrage(null);
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────
  // T.card est semi-transparent (rgba alpha 0.04) → inutilisable pour peindre
  // le canvas. On utilise T.surface qui est opaque, ainsi la gomme couvre
  // vraiment les traits au lieu de juste teinter le fond.
  const canvasBg = T.surface || "#14171f";
  function grille(ctx) {
    ctx.fillStyle=canvasBg; ctx.fillRect(0,0,800,600);
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
    if(eraseMode.current){
      // Trait épais couleur fond opaque pour gommer en continu entre les points
      ctx.strokeStyle=canvasBg; ctx.lineWidth=24; ctx.lineCap="round"; ctx.lineJoin="round";
      ctx.beginPath(); ctx.moveTo(lastPos.current.x,lastPos.current.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    }
    else{ ctx.strokeStyle=accent; ctx.lineWidth=2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath(); ctx.moveTo(lastPos.current.x,lastPos.current.y); ctx.lineTo(p.x,p.y); ctx.stroke(); }
    lastPos.current=p;
  }
  function onUp(){ isDrawing.current=false; debounce(()=>savePlan(),1500); }
  function togDraw(){ drawMode.current=!drawMode.current; eraseMode.current=false; setDrawActive(drawMode.current); setEraseActive(false); }
  function togErase(){ eraseMode.current=!eraseMode.current; drawMode.current=false; setEraseActive(eraseMode.current); setDrawActive(false); }
  function clearCanvas(){ if(!window.confirm("Effacer le plan ?")) return; grille(canvasRef.current.getContext("2d")); savePlan(); }
  function dlCanvas(){ const a=document.createElement("a"); a.download=`plan-${plans[planIdx]?.nom||"plan"}.png`; a.href=canvasRef.current.toDataURL(); a.click(); }

  // ─── EXPORT WORD ─────────────────────────────────────────────────────────────
  async function handleExportWord() {
    if (!projetId || exporting) return;
    setExporting(true);
    try {
      // Snapshot du canvas du plan en cours (s'il y a quelque chose)
      const plansSnap = plans.map((p, i) => {
        if (i === planIdx && canvasRef.current) {
          return { ...p, data: canvasRef.current.toDataURL() };
        }
        return p;
      });
      const payload = { infos, ouvrages, cotes, plans: plansSnap, photos };
      const res = await fetch("/api/generate-info-client-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (infos.client_nom || "client").replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `Fiche-${safe}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export docx:", e);
      alert("Erreur lors de la génération du document : " + e.message);
    }
    setExporting(false);
  }

  // ─── COMPUTED ────────────────────────────────────────────────────────────────
  // Filtrage projets (recherche + statut)
  const projetsFiltres = projets.filter(p => {
    if (filtreStatut !== "all" && (p.statut || "prospect") !== filtreStatut) return false;
    if (searchProjets.trim()) {
      const q = searchProjets.toLowerCase();
      const name = `${p.client_nom || ""} ${p.client_prenom || ""} ${p.adresse_bien || ""}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  // Stats par statut
  const statsParStatut = STATUTS_PROJET.reduce((acc, s) => {
    acc[s.id] = projets.filter(p => (p.statut || "prospect") === s.id).length;
    return acc;
  }, {});

  // ─── RENDU ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,color:T.textMuted,fontSize:FONT.sm.size}}>
      Chargement…
    </div>
  );

  const projetActif = projets.find(p => p.id === projetId);

  return (
    <div className="pic-page" style={{ display:"flex", height:"100%", background:T.bg, overflow:"hidden", position:"relative" }}>
      <style>{`
        .pic-mobile-bar{display:none}
        @media(max-width:767px){
          /* Sans cette règle, le parent reste en flex-row : la mobile-bar avec
             width:100% + flex-shrink:0 prend toute la largeur ET toute la hauteur
             (align-items:stretch), et le contenu principal a 0px de large. */
          .pic-page{flex-direction:column!important}

          .pic-page .pic-list-panel{position:absolute;left:0;top:0;bottom:0;width:88%;max-width:320px;z-index:60;transform:translateX(-100%);transition:transform .25s;box-shadow:4px 0 24px rgba(0,0,0,0.4)}
          .pic-page .pic-list-panel.open{transform:translateX(0)}
          .pic-page .pic-drawer-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:55;opacity:0;pointer-events:none;transition:opacity .2s}
          .pic-page .pic-drawer-backdrop.open{opacity:1;pointer-events:auto}
          .pic-page .pic-mobile-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:${T.surface};border-bottom:1px solid ${T.border};flex-shrink:0;width:100%}
          .pic-page .pic-form-grid{grid-template-columns:1fr!important;gap:8px!important}

          /* Header projet : padding réduit, statut + actions sur leur propre ligne */
          .pic-page .pic-projet-header{padding:10px 12px!important}
          .pic-page .pic-projet-header-row{flex-wrap:wrap!important;gap:8px!important;margin-bottom:8px!important}
          .pic-page .pic-projet-actions{flex:1 1 100%;display:flex;gap:6px;order:10}
          .pic-page .pic-projet-actions select{flex:1}
          .pic-page .pic-projet-name{font-size:15px!important}

          /* Onglets : scroll horizontal au lieu de wrap, plus compacts */
          .pic-page .pic-tabs{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -12px;padding:0 12px;scrollbar-width:none}
          .pic-page .pic-tabs::-webkit-scrollbar{display:none}
          .pic-page .pic-tabs button{flex-shrink:0;padding:7px 11px!important;white-space:nowrap}

          /* Body des onglets : padding réduit */
          .pic-page .pic-body{padding:14px 12px!important}

          /* Ligne d'édition d'ouvrage : inputs compacts (anti CSS global 42px+10/12px) */
          .pic-page .ouvrage-edit-row{gap:5px!important}
          .pic-page .ouvrage-edit-row input,
          .pic-page .ouvrage-edit-row select{
            min-height:34px!important;
            padding:5px 8px!important;
            font-size:14px!important;
          }
          .pic-page .ouvrage-edit-row .qte-input{width:64px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .unit-select{width:64px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .prix-wrap{width:96px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .total-badge{flex:1 1 100%;margin-left:0!important;justify-content:flex-end}

          /* Cartes côtes : grille 2x2 reste lisible */
          .pic-page .cote-card input{min-height:34px!important;padding:5px 8px!important;font-size:14px!important}
        }
      `}</style>

      {/* ── BARRE MOBILE ── */}
      <div className="pic-mobile-bar">
        <button onClick={()=>setMobileShowProjets(true)} style={{
          display:"inline-flex",alignItems:"center",gap:6,
          background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,
          padding:"7px 12px",color:T.text,fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
        }}>
          <Icon as={Menu} size={13}/>
          Projets
        </button>
        <div style={{flex:1,minWidth:0,fontSize:FONT.sm.size,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {projetId ? (infos.client_nom?`${infos.client_nom} ${infos.client_prenom||""}`:"Sans client") : "Aucun projet"}
        </div>
      </div>

      <div className={`pic-drawer-backdrop ${mobileShowProjets?"open":""}`} onClick={()=>setMobileShowProjets(false)}/>

      {/* ── SIDEBAR LISTE PROJETS ── */}
      <div className={`pic-list-panel ${mobileShowProjets?"open":""}`} style={{
        width:280,flexShrink:0,display:"flex",flexDirection:"column",
        background:T.surface,borderRight:`1px solid ${T.border}`,
      }}>
        {/* Header sidebar */}
        <div style={{padding:"14px 14px",borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{
              width:32,height:32,borderRadius:RADIUS.md,flexShrink:0,
              background:acc.bg10,color:acc.accent,
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <Icon as={UserCircle} size={18} strokeWidth={2}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,letterSpacing:-.2}}>Info Client</div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>
                {projets.length} projet{projets.length>1?"s":""}{saving && " · sauvegarde…"}
              </div>
            </div>
            <button onClick={nouveauProjet} title="Nouveau projet" style={{
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              background:acc.accent,color:acc.onAccent,border:"none",
              borderRadius:RADIUS.md,width:30,height:30,cursor:"pointer",
            }}>
              <Icon as={Plus} size={14}/>
            </button>
          </div>

          {/* Recherche */}
          <div style={{position:"relative",marginBottom:8}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
            <input value={searchProjets} onChange={e=>setSearchProjets(e.target.value)} placeholder="Rechercher…"
              style={{
                width:"100%",background:T.fieldBg||T.card,
                border:`1px solid ${T.fieldBorder||T.border}`,borderRadius:RADIUS.md,
                padding:"7px 10px 7px 28px",color:T.text,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",
              }}/>
          </div>

          {/* Filtre statut */}
          <select value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)} style={{
            width:"100%",background:T.fieldBg||T.card,border:`1px solid ${T.fieldBorder||T.border}`,
            borderRadius:RADIUS.md,padding:"7px 10px",color:T.text,
            fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",cursor:"pointer",
          }}>
            <option value="all">Tous les statuts</option>
            {STATUTS_PROJET.map(s => (
              <option key={s.id} value={s.id}>{s.label} ({statsParStatut[s.id] || 0})</option>
            ))}
          </select>
        </div>

        {/* Liste */}
        <div style={{flex:1,overflowY:"auto",padding:8}}>
          {projets.length===0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",marginTop:20,lineHeight:1.8}}>
              Aucun projet<br/>
              <button onClick={nouveauProjet} style={{
                display:"inline-flex",alignItems:"center",gap:5,marginTop:10,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"7px 14px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
              }}>
                <Icon as={Plus} size={12}/>
                Créer
              </button>
            </div>
          )}
          {projetsFiltres.length===0 && projets.length>0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",padding:"16px 12px",fontStyle:"italic"}}>
              Aucun projet pour ces filtres.
            </div>
          )}
          {projetsFiltres.map(p => {
            const act=p.id===projetId;
            const st=statutMeta(p.statut);
            return (
              <div key={p.id} onClick={()=>{chargerProjet(p.id);setMobileShowProjets(false);}} style={{
                padding:"10px 12px",borderRadius:RADIUS.md,marginBottom:6,cursor:"pointer",
                background:act?acc.bg10:T.card,
                border:`1px solid ${act?acc.accent:T.border}`,
                borderLeft:`3px solid ${st.color}`,
                transition:"all .12s",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <span style={{fontSize:FONT.sm.size,fontWeight:700,color:act?acc.accent:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.client_nom?`${p.client_nom} ${p.client_prenom||""}`:"Sans client"}
                  </span>
                  <span style={{
                    fontSize:FONT.xs.size-1,fontWeight:700,padding:"1px 6px",borderRadius:RADIUS.sm,
                    background:st.color+"22",color:st.color,whiteSpace:"nowrap",flexShrink:0,
                  }}>{st.label}</span>
                </div>
                {p.adresse_bien && (
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"flex",alignItems:"center",gap:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <Icon as={MapPin} size={9}/>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse_bien}</span>
                  </div>
                )}
                {p.date_visite && (
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Calendar} size={9}/>
                    {new Date(p.date_visite).toLocaleDateString("fr-FR")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENU PRINCIPAL ── */}
      {!projetId ? (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:T.textSub,padding:24}}>
          <div style={{
            width:64,height:64,borderRadius:RADIUS.lg,
            background:acc.bg10,color:acc.accent,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            <Icon as={UserCircle} size={32} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.md.size,fontWeight:700,color:T.text}}>Sélectionne ou crée un projet</div>
          <button onClick={nouveauProjet} style={{
            display:"inline-flex",alignItems:"center",gap:6,
            background:acc.accent,color:acc.onAccent,border:"none",
            borderRadius:RADIUS.md,padding:"10px 20px",cursor:"pointer",
            fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
          }}>
            <Icon as={Plus} size={14}/>
            Nouveau projet
          </button>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          {/* En-tête projet + statut + onglets */}
          <div className="pic-projet-header" style={{
            padding:"14px 22px",borderBottom:`1px solid ${T.border}`,background:T.bg,flexShrink:0,
          }}>
            <div className="pic-projet-header-row" style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{
                width:36,height:36,borderRadius:RADIUS.md,flexShrink:0,
                background:acc.bg10,color:acc.accent,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={UserCircle} size={20} strokeWidth={2}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div className="pic-projet-name" style={{fontSize:FONT.lg.size+2,fontWeight:800,color:T.text,letterSpacing:-.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {infos.client_nom ? `${infos.client_nom} ${infos.client_prenom||""}` : "Nouveau projet"}
                </div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,display:"flex",flexWrap:"wrap",gap:10}}>
                  {infos.adresse_bien && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={MapPin} size={11}/>{infos.adresse_bien}
                    </span>
                  )}
                  {infos.date_visite && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={Calendar} size={11}/>{new Date(infos.date_visite).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                </div>
              </div>
              {/* Statut + actions : sur mobile passent en row dédiée pleine largeur */}
              <div className="pic-projet-actions">
                <select value={infos.statut || "prospect"} onChange={e=>updInfo("statut",e.target.value)}
                  style={{
                    padding:"7px 12px",borderRadius:RADIUS.md,border:`1px solid ${statutMeta(infos.statut).color}55`,
                    background:statutMeta(infos.statut).color+"18",color:statutMeta(infos.statut).color,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,outline:"none",cursor:"pointer",
                  }}>
                  {STATUTS_PROJET.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button onClick={dupliquerProjet} title="Dupliquer ce projet" style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid ${T.border}`,
                  borderRadius:RADIUS.md,padding:"7px 10px",color:T.textSub,cursor:"pointer",
                }}>
                  <Icon as={Copy} size={13}/>
                </button>
                <button onClick={()=>setToDelete(projetActif)} title="Supprimer ce projet" style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid rgba(224,92,92,0.3)`,
                  borderRadius:RADIUS.md,padding:"7px 10px",color:"#e15a5a",cursor:"pointer",
                }}>
                  <Icon as={Trash2} size={13}/>
                </button>
              </div>
            </div>

            {/* Onglets unifiés (scroll horizontal sur mobile) */}
            <div className="pic-tabs" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[
                { id:"client",   label:"Client & projet", icon:UserCircle },
                { id:"ouvrages", label:"Ouvrages",        icon:Hammer },
                { id:"plan",     label:"Plan & côtes",    icon:Ruler },
                { id:"photos",   label:"Photos",          icon:Camera },
                { id:"params",   label:"Paramètres",      icon:Settings },
                { id:"export",   label:"Export",          icon:FileDown },
              ].map(t => {
                const a=tab===t.id;
                return (
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    padding:"7px 14px",borderRadius:RADIUS.md,
                    border:a?"none":`1px solid ${T.border}`,
                    background:a?acc.accent:T.card,color:a?acc.onAccent:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                    transition:"all .12s",
                  }}>
                    <Icon as={t.icon} size={12}/>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Corps onglet */}
          <div className="pic-body" style={{flex:1,overflowY:"auto",padding:"18px 22px",background:T.bg,minWidth:0}}>

            {tab==="client" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={FileText} size={11}/>
                  Fiche chantier
                </div>
                <div className="pic-form-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                  <div><label style={lbl}>Nom</label><input style={inp} value={infos.client_nom} onChange={e=>updInfo("client_nom",e.target.value)} placeholder="Dupont" /></div>
                  <div><label style={lbl}>Prénom</label><input style={inp} value={infos.client_prenom} onChange={e=>updInfo("client_prenom",e.target.value)} placeholder="Jean" /></div>
                </div>
                <div style={{marginBottom:10}}><label style={lbl}>Adresse du bien</label><textarea style={ta} value={infos.adresse_bien} onChange={e=>updInfo("adresse_bien",e.target.value)} placeholder="Rue, code postal, ville" /></div>
                <div style={{marginBottom:10}}><label style={lbl}>Description du projet</label><textarea style={ta} value={infos.description_projet} onChange={e=>updInfo("description_projet",e.target.value)} placeholder="Ex : division en 1 studio + 2 T2" /></div>
                <div style={{marginBottom:10}}><label style={lbl}>Date de visite</label><input type="date" style={inp} value={infos.date_visite} onChange={e=>updInfo("date_visite",e.target.value)} /></div>
                <div style={{marginBottom:14}}><label style={lbl}>Observations générales</label><textarea style={{...ta,minHeight:80}} value={infos.observations} onChange={e=>updInfo("observations",e.target.value)} placeholder="Notes, accès, contraintes…" /></div>

                <div style={h2s}>Composition du projet</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:6, marginBottom:14 }}>
                  {LOGEMENTS.map(log => {
                    const val=log.split(" ")[0], chk=infos.logements.includes(val);
                    return (
                      <div key={val} onClick={()=>togLog(val)} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:chk?acc.bg10:T.card, border:`1px solid ${chk?acc.accent:T.border}`, borderRadius:RADIUS.md, cursor:"pointer", transition:"all .12s" }}>
                        <input type="checkbox" checked={chk} onChange={()=>togLog(val)} style={{ accentColor:acc.accent, width:15, height:15, flexShrink:0 }} />
                        <span style={{ fontSize:FONT.sm.size, color:chk?acc.accent:T.text, fontWeight:chk?700:500 }}>{log}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {tab==="ouvrages" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Hammer} size={11}/>
                  Sélection d'ouvrages
                </div>
                <div style={{position:"relative",marginBottom:10}}>
                  <Icon as={Search} size={13} color={T.textMuted} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
                  <input style={{...inp,padding:"9px 12px 9px 30px"}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un ouvrage…" />
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:14 }}>
                  {Object.keys(categories).map(cat => {
                    const a=filtresCat.includes(cat);
                    return <div key={cat} onClick={()=>setFiltresCat(p=>p.includes(cat)?p.filter(c=>c!==cat):[...p,cat])} style={{ padding:"3px 10px", borderRadius:RADIUS.pill, border:`1px solid ${a?acc.accent:T.border}`, background:a?acc.bg10:"transparent", color:a?acc.accent:T.textSub, fontSize:FONT.xs.size, fontWeight:700, cursor:"pointer", textTransform:"uppercase", letterSpacing:.4 }}>{cat}</div>;
                  })}
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
                          <div key={idx} style={{ padding:"9px 12px", background:chk?acc.bg10:T.card, border:`1px solid ${chk?acc.accent:T.border}`, borderRadius:RADIUS.md, marginBottom:6, display:"flex", alignItems:"flex-start", gap:10, transition:"all .12s" }}>
                            <input type="checkbox" checked={chk} onChange={()=>togOuvrage(cat,item)} style={{ accentColor:acc.accent, width:15, height:15, marginTop:2, flexShrink:0, cursor:"pointer" }} />
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{ fontSize:FONT.sm.size, color:chk?acc.accent:T.text, fontWeight:chk?700:500 }}>{item}</div>
                              <div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{cat}</div>
                              {chk && (() => {
                                const q  = parseFloat(sel.quantite) || 0;
                                const pu = parseFloat(sel.prix_unitaire) || 0;
                                const totalLigne = q * pu;
                                return (
                                  <div className="ouvrage-edit-row" style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap", alignItems:"center" }}>
                                    <input type="number" placeholder="Qté" value={sel.quantite||""} onChange={e=>updQte(sel.id,e.target.value)}
                                      className="qte-input"
                                      style={{...inp,width:70,padding:"5px 8px",fontSize:FONT.xs.size+1}}/>
                                    <select value={sel.unite||"U"} onChange={e=>updUnite(sel.id,e.target.value)}
                                      className="unit-select"
                                      style={{...inp,width:70,padding:"5px 8px",fontSize:FONT.xs.size+1,cursor:"pointer"}}>
                                      <option value="U">Unité</option><option value="m">m</option><option value="m²">m²</option><option value="ml">ml</option>
                                    </select>
                                    <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>×</span>
                                    <div className="prix-wrap" style={{position:"relative",width:100}}>
                                      <input type="number" placeholder="Prix" step="0.01" value={sel.prix_unitaire ?? ""} onChange={e=>updPrix(sel.id,e.target.value)}
                                        style={{...inp,width:"100%",padding:"5px 22px 5px 8px",fontSize:FONT.xs.size+1,color:"#22c55e",fontWeight:700}}/>
                                      <span style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",fontSize:FONT.xs.size,color:T.textMuted,pointerEvents:"none"}}>€</span>
                                    </div>
                                    {totalLigne > 0 && (
                                      <span className="total-badge" style={{
                                        marginLeft:"auto", display:"inline-flex", alignItems:"center", gap:4,
                                        fontSize:FONT.xs.size+1, fontWeight:800, color:"#22c55e",
                                        background:"rgba(34,197,94,0.10)", border:"1px solid rgba(34,197,94,0.25)",
                                        borderRadius:RADIUS.sm, padding:"3px 8px",
                                      }}>
                                        = {totalLigne.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {(() => {
                  // Estimation par catégorie + total
                  const totauxParCat = {};
                  ouvrages.forEach(o => {
                    const q  = parseFloat(o.quantite) || 0;
                    const pu = parseFloat(o.prix_unitaire) || 0;
                    if (q > 0 && pu > 0) {
                      totauxParCat[o.category] = (totauxParCat[o.category] || 0) + q * pu;
                    }
                  });
                  const totalGlobal = Object.values(totauxParCat).reduce((s, v) => s + v, 0);
                  const fmt = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  return (
                    <>
                      <div style={{ display:"flex", gap:10, marginTop:18, flexWrap:"wrap" }}>
                        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:"10px 14px", flex:1, minWidth:140, display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:30,height:30,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center" }}>
                            <Icon as={Check} size={15}/>
                          </div>
                          <div>
                            <div style={{ fontSize:FONT.xl.size-2, fontWeight:800, color:T.text, lineHeight:1 }}>{ouvrages.length}</div>
                            <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, fontWeight:600 }}>Sélectionnés</div>
                          </div>
                        </div>
                        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:"10px 14px", flex:1, minWidth:140, display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:30,height:30,borderRadius:RADIUS.md,background:"rgba(91,156,246,0.16)",color:"#5b9cf6",display:"flex",alignItems:"center",justifyContent:"center" }}>
                            <Icon as={Layers} size={15}/>
                          </div>
                          <div>
                            <div style={{ fontSize:FONT.xl.size-2, fontWeight:800, color:T.text, lineHeight:1 }}>{Object.values(categories).flat().length}</div>
                            <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, fontWeight:600 }}>Disponibles</div>
                          </div>
                        </div>
                        <div style={{ background:T.surface, border:`1px solid ${totalGlobal > 0 ? "rgba(34,197,94,0.40)" : T.border}`, borderRadius:RADIUS.lg, padding:"10px 14px", flex:"2 1 240px", display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:30,height:30,borderRadius:RADIUS.md,background:"rgba(34,197,94,0.16)",color:"#22c55e",display:"flex",alignItems:"center",justifyContent:"center" }}>
                            <Icon as={Euro} size={15}/>
                          </div>
                          <div style={{flex:1}}>
                            <div style={{ fontSize:FONT.xl.size, fontWeight:800, color: totalGlobal > 0 ? "#22c55e" : T.textMuted, lineHeight:1, letterSpacing:-.5 }}>
                              {fmt(totalGlobal)} €
                            </div>
                            <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2, fontWeight:600 }}>Estimation totale</div>
                          </div>
                        </div>
                      </div>

                      {/* Détail par catégorie */}
                      {Object.keys(totauxParCat).length > 0 && (
                        <div style={{
                          marginTop: 10, background: T.surface, border: `1px solid ${T.border}`,
                          borderRadius: RADIUS.lg, padding: "10px 14px",
                        }}>
                          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>
                            Détail par catégorie
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {Object.entries(totauxParCat).sort(([,a],[,b])=>b-a).map(([cat, total]) => (
                              <div key={cat} style={{
                                display: "inline-flex", alignItems: "baseline", gap: 6,
                                padding: "6px 12px", background: T.card,
                                border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
                              }}>
                                <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub }}>{cat}</span>
                                <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: "#22c55e" }}>
                                  {fmt(total)} €
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                  <button onClick={async()=>{ if(!window.confirm("Désélectionner tous les ouvrages ?")) return; await supabase.from("profero_ouvrages_selectionnes").delete().eq("projet_id",projetId); setOuvrages([]); }}
                    style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                    <Icon as={X} size={11}/>
                    Tout désélectionner
                  </button>
                  <button onClick={()=>setShowModal(true)}
                    style={{...btn, display:"inline-flex", alignItems:"center", gap:5}}>
                    <Icon as={FileText} size={11}/>
                    Voir la sélection
                  </button>
                </div>
              </>
            )}

            {tab==="plan" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Ruler} size={11}/>
                  Plan & côtes
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10 }}>
                  {plans.map((p,i) => (
                    <button key={i} onClick={()=>setPlanIdx(i)} style={{
                      padding:"5px 12px",border:`1px solid ${i===planIdx?acc.accent:T.border}`,
                      background:i===planIdx?acc.bg10:T.card,
                      color:i===planIdx?acc.accent:T.textSub,
                      borderRadius:RADIUS.md,cursor:"pointer",
                      fontSize:FONT.xs.size+1,fontWeight:700,transition:"all .12s",
                    }}>{p.nom}</button>
                  ))}
                  <button onClick={ajoutPlan} style={{
                    display:"inline-flex",alignItems:"center",gap:4,
                    padding:"5px 10px",background:acc.accent,color:acc.onAccent,border:"none",
                    borderRadius:RADIUS.md,cursor:"pointer",
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
                  }}>
                    <Icon as={Plus} size={11}/>
                    Plan
                  </button>
                </div>
                <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                  <button onClick={togDraw} style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    padding:"7px 12px",borderRadius:RADIUS.md,border:"none",
                    background:drawActive?acc.accent:T.card,color:drawActive?acc.onAccent:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                  }}>
                    <Icon as={Pencil} size={11}/>
                    Dessiner
                  </button>
                  <button onClick={togErase} style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    padding:"7px 12px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,
                    background:eraseActive?T.surface:"transparent",color:eraseActive?acc.accent:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                  }}>
                    <Icon as={Eraser} size={11}/>
                    Gomme
                  </button>
                  <button onClick={clearCanvas} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                    <Icon as={Trash2} size={11}/>
                    Effacer
                  </button>
                  <button onClick={dlCanvas} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                    <Icon as={Download} size={11}/>
                    Télécharger
                  </button>
                </div>
                <div style={{ border:`1px solid ${acc.accent}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
                  <canvas ref={canvasRef} width={800} height={600}
                    style={{ display:"block", width:"100%", cursor:drawActive?"crosshair":eraseActive?"cell":"default", touchAction:"none" }}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                    onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}/>
                </div>

                <div style={{...h2s, marginTop:20}}>Côtes menuiseries / huisseries</div>
                <button onClick={ajoutCote} style={{
                  display:"inline-flex",alignItems:"center",gap:5,marginBottom:10,
                  background:acc.accent,color:acc.onAccent,border:"none",
                  borderRadius:RADIUS.md,padding:"7px 14px",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
                }}>
                  <Icon as={Plus} size={11}/>
                  Ajouter une côte
                </button>
                {cotes.length===0 && <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",padding:14,fontStyle:"italic"}}>Aucune côte enregistrée</div>}
                {cotes.map(c => (
                  <div key={c.id} className="cote-card" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:12, marginBottom:8 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                      <input style={{...inp,fontSize:FONT.xs.size+1}} value={c.nom||""} onChange={e=>updCote(c.id,"nom",e.target.value)} placeholder="Fenêtre salon" />
                      <input style={{...inp,fontSize:FONT.xs.size+1}} value={c.localisation||""} onChange={e=>updCote(c.id,"localisation",e.target.value)} placeholder="Localisation" />
                      <input type="number" style={{...inp,fontSize:FONT.xs.size+1}} value={c.largeur||""} onChange={e=>updCote(c.id,"largeur",e.target.value)} placeholder="Largeur (cm)" />
                      <input type="number" style={{...inp,fontSize:FONT.xs.size+1}} value={c.hauteur||""} onChange={e=>updCote(c.id,"hauteur",e.target.value)} placeholder="Hauteur (cm)" />
                    </div>
                    <button onClick={()=>delCote(c.id)} style={{...btnDng, display:"inline-flex", alignItems:"center", gap:4}}>
                      <Icon as={Trash2} size={10}/>
                      Supprimer
                    </button>
                  </div>
                ))}
              </>
            )}

            {tab==="photos" && (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, gap:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Camera} size={11}/>
                    Photos du projet
                    {photos.length > 0 && <span style={{color:acc.accent}}>· {photos.length}</span>}
                  </div>
                  <label style={{
                    display:"inline-flex", alignItems:"center", gap:6,
                    background:acc.accent, color:acc.onAccent, border:"none",
                    borderRadius:RADIUS.md, padding:"9px 16px", cursor:"pointer",
                    fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800,
                  }}>
                    <Icon as={Camera} size={13}/>
                    Ajouter des photos
                    <input ref={photoInputRef} type="file" accept="image/*" multiple capture="environment"
                      onChange={e=>onPhotoFiles(e.target.files)} style={{display:"none"}}/>
                  </label>
                </div>
                {uploadingCount > 0 && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, marginBottom:10 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}>
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                    </svg>
                    Upload en cours… {uploadingCount} restante{uploadingCount > 1 ? "s" : ""}
                  </div>
                )}
                {photos.length === 0 ? (
                  <div style={{
                    background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl,
                    padding:"40px 24px", textAlign:"center", color:T.textSub,
                  }}>
                    <div style={{
                      width:48,height:48,borderRadius:RADIUS.lg,
                      background:acc.bg10,color:acc.accent,
                      display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12,
                    }}>
                      <Icon as={Camera} size={24} strokeWidth={1.5}/>
                    </div>
                    <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucune photo</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>
                      Prends des photos sur place (état de l'existant, points d'attention) — l'appareil photo s'ouvrira directement sur mobile.
                    </div>
                  </div>
                ) : (
                  <div style={{
                    display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12,
                  }}>
                    {photos.map((ph, i) => (
                      <div key={ph.id || i} style={{
                        background:T.surface, border:`1px solid ${T.border}`,
                        borderRadius:RADIUS.lg, overflow:"hidden",
                      }}>
                        <div style={{ position:"relative", aspectRatio:"4/3", background:T.card, cursor:"pointer" }}
                          onClick={()=>setLightbox({urls:photos.map(p=>p.url),idx:i})}>
                          <img src={ph.url} alt={ph.label||""} loading="lazy"
                            style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}/>
                          <button onClick={(e)=>{e.stopPropagation();removePhoto(i);}} title="Supprimer cette photo"
                            style={{
                              position:"absolute", top:6, right:6,
                              display:"inline-flex", alignItems:"center", justifyContent:"center",
                              background:"rgba(0,0,0,0.65)", color:"#fff", border:"none",
                              borderRadius:"50%", width:26, height:26, cursor:"pointer", padding:0,
                            }}>
                            <Icon as={Trash2} size={11}/>
                          </button>
                        </div>
                        <div style={{ padding:"8px 10px" }}>
                          <input value={ph.label || ""} onChange={e=>updatePhotoLabel(i, e.target.value)}
                            placeholder="Libellé (ex : Salon — mur sud)"
                            style={{
                              width:"100%", background:"transparent", border:"none",
                              color:T.text, fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none",
                              padding:"3px 0",
                            }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab==="params" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Settings} size={11}/>
                  Bibliothèque d'ouvrages
                </div>
                <label style={lbl}>Catégorie à modifier</label>
                <select style={{...inp,marginBottom:10}} value={catParam} onChange={e=>setCatParam(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {Object.keys(categories).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                {catParam && (
                  <>
                    <div style={h2s}>Ouvrages ({(categories[catParam]||[]).length})</div>
                    {(categories[catParam]||[]).map((item,idx) => (
                      <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, marginBottom:6 }}>
                        <span style={{flex:1,fontSize:FONT.sm.size,color:T.text}}>{item}</span>
                        <button onClick={()=>setToDeleteOuvrage({cat:catParam,idx,label:item})} title="Supprimer"
                          style={{...btnDng, display:"inline-flex", alignItems:"center", justifyContent:"center", padding:"4px 8px"}}>
                          <Icon as={Trash2} size={11}/>
                        </button>
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
                <input style={{...inp,marginBottom:8}} value={newLib} onChange={e=>setNewLib(e.target.value)} placeholder="Ex : Installation électrique T2" onKeyDown={e=>e.key==="Enter"&&ajoutOuvrageLib()} />
                <button onClick={ajoutOuvrageLib} style={{
                  display:"inline-flex",alignItems:"center",gap:5,
                  background:acc.accent,color:acc.onAccent,border:"none",
                  borderRadius:RADIUS.md,padding:"8px 16px",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                }}>
                  <Icon as={Plus} size={12}/>
                  Ajouter
                </button>
              </>
            )}

            {tab==="export" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={FileDown} size={11}/>
                  Export du dossier
                </div>
                <p style={{color:T.textSub,fontSize:FONT.sm.size,marginBottom:14,lineHeight:1.7}}>
                  Génère une fiche complète avec infos client, ouvrages sélectionnés, côtes, plan et photos.
                </p>
                <div style={{ background:acc.bg10, border:`1px solid ${acc.accent}33`, borderRadius:RADIUS.md, padding:"12px 14px", marginBottom:18 }}>
                  <div style={{display:"inline-flex",alignItems:"center",gap:5,color:acc.accent,fontWeight:700,marginBottom:8,fontSize:FONT.sm.size}}>
                    <Icon as={FileText} size={12}/>
                    Contenu de la fiche
                  </div>
                  {["Infos client et projet","Composition (logements)","Ouvrages avec estimation budgétaire","Côtes menuiseries / huisseries","Plan du chantier","Photos sur place","Observations"].map(i=>(
                    <div key={i} style={{fontSize:FONT.xs.size+1,color:T.textSub,marginBottom:4,display:"inline-flex",alignItems:"center",gap:5,width:"100%"}}>
                      <Icon as={Check} size={10} color={acc.accent}/>
                      {i}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button onClick={handleExportWord} disabled={exporting} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:acc.accent,color:acc.onAccent,border:"none",
                    borderRadius:RADIUS.md,padding:"10px 18px",cursor:exporting?"not-allowed":"pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,opacity:exporting?.6:1,
                  }}>
                    <Icon as={FileDown} size={13}/>
                    {exporting ? "Génération…" : "Exporter en Word (.docx)"}
                  </button>
                  <button onClick={()=>genPDF({infos,ouvrages,cotes,plans,canvasRef})} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"transparent",color:T.textSub,border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"10px 18px",cursor:"pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,
                  }}>
                    <Icon as={Download} size={13}/>
                    PDF (impression navigateur)
                  </button>
                </div>
                <p style={{color:T.textMuted,fontSize:FONT.xs.size+1,marginTop:14,lineHeight:1.6,fontStyle:"italic"}}>
                  Le Word inclut les photos directement dans le document. Le PDF reste accessible via l'impression du navigateur.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── LIGHTBOX PHOTOS ── */}
      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:1200,
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:20, flexDirection:"column", gap:14,
        }}>
          <img src={lightbox.urls[lightbox.idx]} alt=""
            onClick={e=>e.stopPropagation()}
            style={{ maxWidth:"100%", maxHeight:"calc(100vh - 120px)", objectFit:"contain", borderRadius:8 }}/>
          <div onClick={e=>e.stopPropagation()} style={{ display:"flex", gap:12, alignItems:"center" }}>
            {lightbox.urls.length > 1 && (
              <>
                <button onClick={()=>setLightbox(l=>({...l,idx:(l.idx-1+l.urls.length)%l.urls.length}))}
                  style={{
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronLeftIcon} size={16}/>
                </button>
                <span style={{ color:"#fff", fontSize:13, fontWeight:600 }}>
                  {lightbox.idx + 1} / {lightbox.urls.length}
                </span>
                <button onClick={()=>setLightbox(l=>({...l,idx:(l.idx+1)%l.urls.length}))}
                  style={{
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronRight} size={16}/>
                </button>
              </>
            )}
            <button onClick={()=>setLightbox(null)}
              style={{
                background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)",
                color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer",
                fontFamily:"inherit", fontSize:13, fontWeight:600,
              }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL SÉLECTION OUVRAGES ── */}
      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}
          onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div style={{
            background:T.modal||T.surface,borderRadius:RADIUS.xl,
            padding:0,maxWidth:560,width:"100%",maxHeight:"85vh",
            border:`1px solid ${T.border}`,boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
            display:"flex",flexDirection:"column",overflow:"hidden",
          }}>
            <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.sectionDivider||T.border}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:32,height:32,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={Check} size={16}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Ouvrages sélectionnés</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1}}>{ouvrages.length} ouvrage{ouvrages.length>1?"s":""} retenus</div>
              </div>
              <button onClick={()=>setShowModal(false)} title="Fermer" style={{
                display:"inline-flex",alignItems:"center",justifyContent:"center",
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,width:30,height:30,cursor:"pointer",color:T.textSub,
              }}>
                <Icon as={X} size={13}/>
              </button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"16px 22px"}}>
              {ouvrages.length===0 ? <div style={{color:T.textMuted,textAlign:"center",padding:20,fontSize:FONT.sm.size,fontStyle:"italic"}}>Aucun ouvrage sélectionné</div> : (
                Object.entries(ouvrages.reduce((a,o)=>{if(!a[o.category])a[o.category]=[];a[o.category].push(o);return a;},{})).map(([cat,items])=>(
                  <div key={cat} style={{marginBottom:14}}>
                    <div style={{display:"inline-flex",alignItems:"center",gap:5,background:acc.bg10,color:acc.accent,padding:"4px 10px",borderRadius:RADIUS.sm,fontWeight:700,fontSize:FONT.xs.size+1,marginBottom:6,border:`1px solid ${acc.accent}33`}}>
                      <Icon as={Layers} size={11}/>
                      {cat}
                    </div>
                    {items.map((it,i)=>(
                      <div key={i} style={{padding:"5px 12px",fontSize:FONT.sm.size,color:T.text,borderLeft:`2px solid ${T.border}`,marginBottom:4}}>
                        {it.item}{it.quantite?` — ${it.quantite} ${it.unite}`:""}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div style={{padding:"14px 22px",borderTop:`1px solid ${T.sectionDivider||T.border}`,display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setShowModal(false)} style={{
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"9px 22px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
              }}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION PROJET ── */}
      {toDelete && (
        <div onClick={()=>!deleting&&setToDelete(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,
                background:"rgba(224,92,92,0.12)",color:"#e15a5a",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce projet&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le projet <strong style={{color:T.text}}>« {toDelete.client_nom||"Sans client"} {toDelete.client_prenom||""} »</strong> sera supprimé avec ses ouvrages, ses côtes et ses plans.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Cette action est irréversible.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDelete(null)} disabled={deleting} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",opacity:deleting?.5:1,
              }}>Annuler</button>
              <button onClick={confirmSuppProjet} disabled={deleting} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                cursor:"pointer",opacity:deleting?.6:1,
              }}>
                <Icon as={Trash2} size={13}/>
                {deleting?"Suppression…":"Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION OUVRAGE BIBLIOTHÈQUE ── */}
      {toDeleteOuvrage && (
        <div onClick={()=>setToDeleteOuvrage(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cet ouvrage ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              L'ouvrage <strong style={{color:T.text}}>« {toDeleteOuvrage.label} »</strong> sera retiré de la bibliothèque <strong style={{color:T.text}}>{toDeleteOuvrage.cat}</strong>.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeleteOuvrage(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={()=>delOuvrageLib(toDeleteOuvrage.cat,toDeleteOuvrage.idx)} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
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
  <div class="hd"><div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px;"><img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCABkAGQDASIAAhEBAxEB/8QAGwABAAIDAQEAAAAAAAAAAAAAAAUGAgMEAQf/xAA4EAABAwMCBAMGBAQHAAAAAAABAAIDBAUREjEGIUFhFFFxEyIygZGhFTVS0UJTcrIWI5OxwcLw/8QAGgEBAAMBAQEAAAAAAAAAAAAAAAECAwQFBv/EACQRAAICAQQCAwADAAAAAAAAAAABAhEDBCExQRJhE1FxIqHB/9oADAMBAAIRAxEAPwCloiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAtdisNBXWqKoqGSGRxdkh5A5HCkP8LWv+XL/AKpWfCv5DB/U/wDuKl183qNTmjlklJ8s7oY4uKtFXq+F6SEF/tZRCd35BMfcjq36EKAutqqLVMGTAOY74JG7O/Y9l9Gcxr2ljxlrhgjsVFVFKLjw2I383+xDmOP6gOR+33W2n12RNebtcFZ4V0UBE6IveOMIiIAiIgCIiAIiIC/cK/kMH9T/AO4qWJA3IHzVNpb823cPw09Ph1U4v9IxqPM9+y47PdY6epcK+JlRFI7LnvaHOafPv6LwsmhyZJTye3Xs7I5lFJFznqPb6qekcHSO918jeYiHUk+fkFlWyR0Nslf8McURDR8sAf7LU+7WymhB8XA1gGQ1hB+gCqd/vzrmRDC0spmnODu8+Z/ZY4NNPLJKqii08iirvchRsiIvozhCIiAIiID0AnYE+iEEbgj1Vh4K/Mp8/wAn/sFMVIqJrPX/AIzDDG1ocYi3fbkfXOFxZdX8eTwr67339GscdxuyjaXfpP0Xivz5LjHbrd+HQxyksb7QP2A0juuSuttHWcTwR6W8ojJOxv8AEQeWfXP0VI65N/yW2/d8EvF9FN0u06sHT545IATsCfRWyTib2dyNGKSPwjX+yI674zjb5KRoKCOgvda2naGskhY8NGzTkggdshTPWSxq5xra1uFiTezKFpI/hI+SaXfpP0Vnu1ddxDFBX0sEUc0rQCw5OQQfNT1wddGzAUEdK6PHvGZxBznsolrXFK0t772290FiTvf+j51pPkfovCCN+SufD9VUVVPdKlrGeIfJlrRtq08gsrjDLWWJv4rHFDWOkDIy3GQS4AfbOQpesqfg12lz9+h8Vq0UsNc74Wk48hleK43O6M4efFQ0FNGQGBznOzz+m55bri4ihp6u1Ut3hjET5SA9o65z9wRurw1Tk43GlLhkPGldPgraIi7DImOGrhT22tllqi4MdHpGlueeQVHVVVNUPfrmkezUS0PcSB8loUpFS2xzHh9W5rw1m+MEnBOPTZYOMITeSt2XTbVElU8RRxw23wkkhdBgTMIIDhpAx36rRW3elivkdytxc4uGJo3N056fcfcLk8Ha8F3jXgcsDlkdPLn58tsLNtJamsc41bn41ADUG5OHdMZ3A9crnWLDHdJ9r9su5SZJm48OvqfHugl8RnUWaT8XnjZYUHEcJuVZVVmqNsjGsia0asAE/uo59JatRd4w6cn3WEfQZ26czvnsvIoKM22pZ4iAStkdpe8e85o+EDrz8xy8+ir8OJxadvrfr8J8pX0cRrJ5pYjUTyytY8OGtxdjmrLcLlw/cZmy1LqkuaNI0hzeWcqEgp7aYiZKlzZBC12DjGo7gen/AD2W40dpdM9zawiPJIaXjkMnrjnnA781pkjCTT3VfRWLaR10d1t9BT3KGmfMxsp/yDpOfhxv05rXU3enr7HFHUve2vpzqY/TnJHXPcfcLWKW0Nc8Goa4asty/OO2Rv8A+8liKS0F5eap2gHAZ7QZ29Pnn5Knhivyp3z/AITcqo73Xaz3WKN11heyojGC5gOHfMdOxUffbxHXMipaSIxUkPwgjBJ2HLoAsHUlsIL/ABZA30NIz8Owz367c8KOqGRx1EjIn+0ja4hrvMea0xYcalavbhPhfhEpSo1oiLsMgiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiA/9k=" style="height:48px;width:48px;object-fit:contain;background:#0a0a0a;border-radius:8px;padding:4px;" /><h1 style="margin:0;">Information Client — Rapport de Visite</h1></div><p><strong>Client :</strong> ${infos.client_nom} ${infos.client_prenom}</p><p><strong>Date :</strong> ${d}</p></div>
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
