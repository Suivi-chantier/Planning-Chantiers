import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

// ─── CATÉGORIES PAR DÉFAUT ────────────────────────────────────────────────────
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
const UNITES_PAR_CAT = { "Électricité":"U","Plomberie":"U","Ventilation":"U","Plaquiste":"m²","Sols & Peinture":"m²","Menuiseries":"U","Maçonnerie":"U","Démolition":"m²" };
const LOGEMENTS_TYPES = ["Studio (T0)","T1 (1 pièce)","T2 (2 pièces)","T3 (3 pièces)","T4 (4 pièces)"];

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────────────
export default function PageInfoClient({ T }) {
  const [projets, setProjets] = useState([]);
  const [projetId, setProjetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Données du projet courant
  const [infos, setInfos] = useState({ client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"", date_visite:"", observations:"", logements:[] });
  const [ouvrages, setOuvrages] = useState([]); // [{category, item, quantite, unite}]
  const [cotes, setCotes] = useState([]);
  const [plans, setPlans] = useState([{ nom:"Plan 1", data:null }]);
  const [planIdx, setPlanIdx] = useState(0);

  // Bibliothèque partagée
  const [categories, setCategories] = useState(CATEGORIES_DEFAUT);

  // UI
  const [tabGauche, setTabGauche] = useState("infos");
  const [tabDroite, setTabDroite] = useState("plan");
  const [search, setSearch] = useState("");
  const [filtresCat, setFiltresCat] = useState([]);
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [newOuvrageCat, setNewOuvrageCat] = useState("Électricité");
  const [newOuvrageLib, setNewOuvrageLib] = useState("");
  const [catParamSelect, setCatParamSelect] = useState("");

  // Canvas
  const canvasRef = useRef(null);
  const drawMode = useRef(false);
  const eraseMode = useRef(false);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x:0, y:0 });
  const [drawActive, setDrawActive] = useState(false);
  const [eraseActive, setEraseActive] = useState(false);

  const saveTimeout = useRef(null);

  // ─── CHARGEMENT ──────────────────────────────────────────────────────────────
  useEffect(() => { chargerProjets(); chargerCategories(); }, []);

  async function chargerProjets() {
    setLoading(true);
    const { data } = await supabase.from("profero_projets").select("*").order("created_at", { ascending: false });
    if (data) {
      setProjets(data);
      if (data.length > 0) chargerProjet(data[0].id);
      else setLoading(false);
    } else {
      setLoading(false);
    }
  }

  async function chargerCategories() {
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").order("ordre");
    if (data && data.length > 0) {
      const cats = {};
      data.forEach(row => { cats[row.nom] = row.ouvrages || []; });
      setCategories(cats);
    } else {
      // Initialiser avec les défauts
      const inserts = Object.entries(CATEGORIES_DEFAUT).map(([nom, ouvrages], i) => ({ nom, ouvrages, ordre: i }));
      await supabase.from("profero_categories_ouvrages").insert(inserts);
      setCategories(CATEGORIES_DEFAUT);
    }
  }

  async function chargerProjet(id) {
    setLoading(true);
    setProjetId(id);

    const [{ data: proj }, { data: ouv }, { data: cot }, { data: pl }] = await Promise.all([
      supabase.from("profero_projets").select("*").eq("id", id).single(),
      supabase.from("profero_ouvrages_selectionnes").select("*").eq("projet_id", id),
      supabase.from("profero_cotes").select("*").eq("projet_id", id),
      supabase.from("profero_plans").select("*").eq("projet_id", id),
    ]);

    if (proj) setInfos({ client_nom: proj.client_nom||"", client_prenom: proj.client_prenom||"", adresse_bien: proj.adresse_bien||"", description_projet: proj.description_projet||"", date_visite: proj.date_visite||"", observations: proj.observations||"", logements: proj.logements||[] });
    setOuvrages(ouv || []);
    setCotes(cot || []);
    const plansData = pl && pl.length > 0 ? pl : [{ nom:"Plan 1", data:null }];
    setPlans(plansData);
    setPlanIdx(0);
    setLoading(false);
  }

  // Dessiner le canvas quand le plan change
  useEffect(() => {
    const plan = plans[planIdx];
    if (!plan || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (plan.data) {
      const img = new Image();
      img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); dessinerGrille(ctx,canvas); ctx.drawImage(img,0,0); };
      img.src = plan.data;
    } else {
      dessinerGrille(ctx, canvas);
    }
  }, [planIdx, plans.length]);

  // ─── SAUVEGARDE AUTO ──────────────────────────────────────────────────────────
  function debounceSave(fn, delay = 800) {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(fn, delay);
  }

  async function sauvegarderInfos(nouvellesInfos) {
    if (!projetId) return;
    setSaving(true);
    await supabase.from("profero_projets").update({ ...nouvellesInfos, updated_at: new Date().toISOString() }).eq("id", projetId);
    setSaving(false);
    // Mettre à jour la liste
    setProjets(prev => prev.map(p => p.id === projetId ? { ...p, ...nouvellesInfos } : p));
  }

  function updateInfos(field, value) {
    const updated = { ...infos, [field]: value };
    setInfos(updated);
    debounceSave(() => sauvegarderInfos(updated));
  }

  function toggleLogement(val) {
    const newLog = infos.logements.includes(val) ? infos.logements.filter(l=>l!==val) : [...infos.logements, val];
    const updated = { ...infos, logements: newLog };
    setInfos(updated);
    debounceSave(() => sauvegarderInfos(updated));
  }

  // ─── OUVRAGES ─────────────────────────────────────────────────────────────────
  async function toggleOuvrage(category, item) {
    if (!projetId) return;
    const existe = ouvrages.find(o => o.category === category && o.item === item);
    if (existe) {
      await supabase.from("profero_ouvrages_selectionnes").delete().eq("id", existe.id);
      setOuvrages(prev => prev.filter(o => !(o.category === category && o.item === item)));
    } else {
      const unite = UNITES_PAR_CAT[category] || "U";
      const { data } = await supabase.from("profero_ouvrages_selectionnes").insert({ projet_id: projetId, category, item, quantite: "", unite }).select().single();
      if (data) setOuvrages(prev => [...prev, data]);
    }
  }

  async function updateOuvrageQte(id, quantite) {
    setOuvrages(prev => prev.map(o => o.id === id ? { ...o, quantite } : o));
    debounceSave(() => supabase.from("profero_ouvrages_selectionnes").update({ quantite }).eq("id", id));
  }

  async function updateOuvrageUnite(id, unite) {
    setOuvrages(prev => prev.map(o => o.id === id ? { ...o, unite } : o));
    await supabase.from("profero_ouvrages_selectionnes").update({ unite }).eq("id", id);
  }

  // ─── CÔTES ───────────────────────────────────────────────────────────────────
  async function ajouterCote() {
    if (!projetId) return;
    const { data } = await supabase.from("profero_cotes").insert({ projet_id: projetId, nom:"", largeur:"", hauteur:"", localisation:"" }).select().single();
    if (data) setCotes(prev => [...prev, data]);
  }

  async function updateCote(id, field, value) {
    setCotes(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    debounceSave(() => supabase.from("profero_cotes").update({ [field]: value }).eq("id", id));
  }

  async function supprimerCote(id) {
    await supabase.from("profero_cotes").delete().eq("id", id);
    setCotes(prev => prev.filter(c => c.id !== id));
  }

  // ─── PLANS ───────────────────────────────────────────────────────────────────
  async function ajouterPlan() {
    if (!projetId) return;
    const nom = `Plan ${plans.length + 1}`;
    const { data } = await supabase.from("profero_plans").insert({ projet_id: projetId, nom, data: null }).select().single();
    if (data) {
      setPlans(prev => [...prev, data]);
      setPlanIdx(plans.length);
    }
  }

  async function sauvegarderPlan() {
    const plan = plans[planIdx];
    if (!plan || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL();
    const updatedPlans = plans.map((p, i) => i === planIdx ? { ...p, data: dataUrl } : p);
    setPlans(updatedPlans);
    if (plan.id) {
      await supabase.from("profero_plans").update({ data: dataUrl }).eq("id", plan.id);
    } else {
      const { data } = await supabase.from("profero_plans").insert({ projet_id: projetId, nom: plan.nom, data: dataUrl }).select().single();
      if (data) setPlans(updatedPlans.map((p,i) => i===planIdx ? data : p));
    }
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────────
  function dessinerGrille(ctx, canvas) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += 20) {
      ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,canvas.height); ctx.stroke();
    }
    for (let i = 0; i <= canvas.height; i += 20) {
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(canvas.width,i); ctx.stroke();
    }
    ctx.strokeStyle = "#FFC300"; ctx.lineWidth = 2;
    ctx.strokeRect(0,0,canvas.width,canvas.height);
  }

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function onCanvasDown(e) {
    if (!drawMode.current && !eraseMode.current) return;
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e, canvasRef.current);
  }

  function onCanvasMove(e) {
    if (!isDrawing.current || (!drawMode.current && !eraseMode.current)) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    if (eraseMode.current) {
      ctx.clearRect(pos.x - 10, pos.y - 10, 20, 20);
    } else {
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    }
    lastPos.current = pos;
  }

  function onCanvasUp(e) {
    isDrawing.current = false;
    debounceSave(() => sauvegarderPlan(), 1500);
  }

  function toggleDraw() { drawMode.current = !drawMode.current; eraseMode.current = false; setDrawActive(drawMode.current); setEraseActive(false); }
  function toggleErase() { eraseMode.current = !eraseMode.current; drawMode.current = false; setEraseActive(eraseMode.current); setDrawActive(false); }

  function effacerPlan() {
    if (!window.confirm("Effacer le plan ?")) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    dessinerGrille(ctx, canvas);
    sauvegarderPlan();
  }

  function telechargerPlan() {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.download = `plan-${plans[planIdx]?.nom || "plan"}.png`;
    link.href = canvas.toDataURL();
    link.click();
  }

  // ─── PROJETS ─────────────────────────────────────────────────────────────────
  async function nouveauProjet() {
    const nom = window.prompt("Nom du projet :", `Projet ${projets.length + 1}`);
    if (!nom) return;
    const dateAuj = new Date().toISOString().split("T")[0];
    const { data } = await supabase.from("profero_projets").insert({ client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"", date_visite: dateAuj, observations:"", logements:[] }).select().single();
    if (data) {
      // Créer un plan par défaut
      await supabase.from("profero_plans").insert({ projet_id: data.id, nom: "Plan 1", data: null });
      setProjets(prev => [data, ...prev]);
      chargerProjet(data.id);
    }
  }

  async function supprimerProjet() {
    if (!projetId) return;
    if (!window.confirm("Supprimer ce projet définitivement ?")) return;
    await supabase.from("profero_projets").delete().eq("id", projetId);
    const reste = projets.filter(p => p.id !== projetId);
    setProjets(reste);
    if (reste.length > 0) chargerProjet(reste[0].id);
    else { setProjetId(null); setInfos({ client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",date_visite:"",observations:"",logements:[] }); setOuvrages([]); setCotes([]); setPlans([{nom:"Plan 1",data:null}]); }
  }

  // ─── BIBLIOTHÈQUE ─────────────────────────────────────────────────────────────
  async function ajouterOuvrageLiblio() {
    if (!newOuvrageLib.trim()) return;
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").eq("nom", newOuvrageCat).single();
    if (data) {
      const newList = [...(data.ouvrages || []), newOuvrageLib.trim()];
      await supabase.from("profero_categories_ouvrages").update({ ouvrages: newList }).eq("id", data.id);
      setCategories(prev => ({ ...prev, [newOuvrageCat]: newList }));
      setNewOuvrageLib("");
      alert("✓ Ouvrage ajouté !");
    }
  }

  async function supprimerOuvrageLiblio(cat, idx) {
    if (!window.confirm("Supprimer cet ouvrage ?")) return;
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").eq("nom", cat).single();
    if (data) {
      const newList = data.ouvrages.filter((_,i) => i !== idx);
      await supabase.from("profero_categories_ouvrages").update({ ouvrages: newList }).eq("id", data.id);
      setCategories(prev => ({ ...prev, [cat]: newList }));
    }
  }

  // ─── FILTRES ─────────────────────────────────────────────────────────────────
  function toggleFiltreCat(cat) {
    setFiltresCat(prev => prev.includes(cat) ? prev.filter(c=>c!==cat) : [...prev, cat]);
  }

  function ouvrageVisible(category, item) {
    const matchSearch = !search || item.toLowerCase().includes(search.toLowerCase());
    const matchCat = filtresCat.length === 0 || filtresCat.includes(category);
    return matchSearch && matchCat;
  }

  // ─── STYLES ──────────────────────────────────────────────────────────────────
  const S = {
    page: { display:"flex", flexDirection:"column", height:"100%", background: T.bg, overflow:"hidden" },
    header: { background:"#000", color:"#FFC300", padding:"10px 20px", display:"flex", alignItems:"center", gap:12, borderBottom:"3px solid #FFC300", flexShrink:0 },
    body: { display:"flex", flex:1, overflow:"hidden" },
    sidebar: { width:220, flexShrink:0, background:"#111", borderRight:"2px solid #FFC300", display:"flex", flexDirection:"column", overflow:"hidden" },
    sidebarHead: { padding:"10px 14px", background:"#000", color:"#FFC300", fontWeight:700, fontSize:13, letterSpacing:1, borderBottom:"1px solid #FFC300", textTransform:"uppercase" },
    sidebarList: { flex:1, overflowY:"auto", padding:8 },
    projetItem: (active) => ({ background: active ? "#FFC300" : "#1a1a1a", color: active ? "#000" : "#ccc", border: active ? "none" : "1px solid #333", borderRadius:6, padding:"10px 12px", marginBottom:6, cursor:"pointer", borderLeft: active ? "none" : "3px solid #FFC300" }),
    sidebarActions: { padding:8, borderTop:"1px solid #333", display:"flex", gap:6 },
    main: { flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", overflow:"hidden" },
    section: { padding:16, overflowY:"auto", borderRight:"1px solid #2a2a2a" },
    sectionLast: { padding:16, overflowY:"auto" },
    sectionTitle: { color:"#FFC300", fontSize:16, fontWeight:700, marginBottom:12, paddingBottom:8, borderBottom:"2px solid #FFC300", display:"flex", alignItems:"center", gap:8 },
    sectionH2: { color:"#FFC300", fontSize:13, fontWeight:600, marginTop:16, marginBottom:8, paddingBottom:6, borderBottom:"1px solid #333" },
    tabs: { display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" },
    tab: (active) => ({ padding:"7px 14px", border:"none", borderRadius:6, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, background: active ? "#FFC300" : "#222", color: active ? "#000" : "#888", letterSpacing:.5, textTransform:"uppercase" }),
    label: { display:"block", fontSize:12, fontWeight:600, color:"#aaa", marginTop:10, marginBottom:4 },
    input: { width:"100%", padding:"9px 11px", background:"#1a1a1a", border:"1px solid #333", borderRadius:6, color:"#fff", fontSize:13, fontFamily:"inherit", marginBottom:4 },
    textarea: { width:"100%", padding:"9px 11px", background:"#1a1a1a", border:"1px solid #333", borderRadius:6, color:"#fff", fontSize:13, fontFamily:"inherit", resize:"vertical", minHeight:60 },
    btnPrimary: { background:"#FFC300", color:"#000", border:"none", borderRadius:6, padding:"8px 16px", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer" },
    btnSecondary: { background:"transparent", color:"#aaa", border:"1px solid #444", borderRadius:6, padding:"8px 16px", fontFamily:"inherit", fontSize:12, cursor:"pointer" },
    btnDanger: { background:"transparent", color:"#e05c5c", border:"1px solid rgba(224,92,92,0.3)", borderRadius:6, padding:"5px 10px", fontFamily:"inherit", fontSize:11, cursor:"pointer" },
    checkItem: (checked) => ({ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 10px", background: checked ? "rgba(255,195,0,0.08)" : "#1a1a1a", borderRadius:6, marginBottom:6, cursor:"pointer", borderLeft:`3px solid ${checked ? "#FFC300" : "transparent"}` }),
    ouvrageItem: (checked) => ({ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 10px", background: checked ? "rgba(255,195,0,0.08)" : "#1a1a1a", borderRadius:6, marginBottom:6, borderLeft:`3px solid ${checked ? "#FFC300" : "transparent"}` }),
    statBox: { background:"#1a1a1a", border:"1px solid #333", borderRadius:8, padding:"12px 16px", textAlign:"center", flex:1 },
    filterTag: (active) => ({ padding:"4px 12px", borderRadius:20, border:`1px solid ${active ? "#FFC300" : "#444"}`, background: active ? "#FFC300" : "transparent", color: active ? "#000" : "#888", fontSize:11, fontWeight:700, cursor:"pointer", textTransform:"uppercase", letterSpacing:.5 }),
    canvasContainer: { border:"2px solid #FFC300", borderRadius:8, overflow:"hidden", marginTop:10 },
    coteItem: { background:"#1a1a1a", border:"1px solid #333", borderRadius:6, padding:10, marginBottom:8 },
    planTab: (active) => ({ padding:"5px 12px", border:`1px solid ${active ? "#FFC300" : "#444"}`, background: active ? "#FFC300" : "transparent", color: active ? "#000" : "#888", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700, marginRight:6, marginBottom:6 }),
    modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center" },
    modalBox: { background:"#111", border:"2px solid #FFC300", borderRadius:12, padding:24, maxWidth:500, width:"90%", maxHeight:"80vh", overflowY:"auto" },
    saving: { fontSize:11, color:"#FFC300", opacity:.7 },
  };

  const projetCourant = projets.find(p => p.id === projetId);

  if (loading) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:T.bg, color:"#FFC300", fontSize:16, fontWeight:700 }}>
      Chargement…
    </div>
  );

  return (
    <div style={S.page}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={{ width:38, height:38, background:"#FFC300", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, color:"#000", flexShrink:0 }}>P</div>
        <div>
          <div style={{ fontSize:16, fontWeight:800, letterSpacing:1 }}>Information Client</div>
          <div style={{ fontSize:11, opacity:.7 }}>Information client</div>
        </div>
        {saving && <div style={{ marginLeft:"auto", ...S.saving }}>💾 Sauvegarde…</div>}
      </div>

      <div style={S.body}>
        {/* SIDEBAR PROJETS */}
        <div style={S.sidebar}>
          <div style={S.sidebarHead}>📋 Projets ({projets.length})</div>
          <div style={S.sidebarList}>
            {projets.length === 0 && <div style={{ color:"#666", fontSize:12, textAlign:"center", marginTop:20 }}>Aucun projet</div>}
            {projets.map(p => (
              <div key={p.id} style={S.projetItem(p.id === projetId)} onClick={() => chargerProjet(p.id)}>
                <div style={{ fontSize:13, fontWeight:700 }}>{p.client_nom ? `${p.client_nom} ${p.client_prenom||""}` : "Sans client"}</div>
                <div style={{ fontSize:11, opacity:.7, marginTop:2 }}>
                  {p.date_visite ? `📅 ${new Date(p.date_visite).toLocaleDateString("fr-FR")}` : "Pas de date"}
                </div>
              </div>
            ))}
          </div>
          <div style={S.sidebarActions}>
            <button style={{ ...S.btnPrimary, flex:1, fontSize:11 }} onClick={nouveauProjet}>➕ Nouveau</button>
            <button style={{ ...S.btnDanger, padding:"8px 10px" }} onClick={supprimerProjet}>🗑️</button>
          </div>
        </div>

        {/* MAIN CONTENT */}
        {!projetId ? (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16, color:"#666" }}>
            <div style={{ fontSize:40 }}>📋</div>
            <div style={{ fontSize:16, fontWeight:700 }}>Aucun projet sélectionné</div>
            <button style={S.btnPrimary} onClick={nouveauProjet}>➕ Créer un projet</button>
          </div>
        ) : (
          <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", overflow:"hidden" }}>

            {/* GAUCHE : INFOS + OUVRAGES */}
            <div style={{ ...S.section, borderRight:`1px solid #2a2a2a` }}>
              <div style={S.tabs}>
                <button style={S.tab(tabGauche==="infos")} onClick={()=>setTabGauche("infos")}>📋 Infos</button>
                <button style={S.tab(tabGauche==="ouvrages")} onClick={()=>setTabGauche("ouvrages")}>🔨 Ouvrages</button>
              </div>

              {/* TAB INFOS */}
              {tabGauche === "infos" && (
                <>
                  <div style={S.sectionTitle}>📝 Fiche Chantier</div>

                  <label style={S.label}>Nom du client</label>
                  <input style={S.input} value={infos.client_nom} onChange={e=>updateInfos("client_nom",e.target.value)} placeholder="Dupont" />

                  <label style={S.label}>Prénom</label>
                  <input style={S.input} value={infos.client_prenom} onChange={e=>updateInfos("client_prenom",e.target.value)} placeholder="Jean" />

                  <label style={S.label}>Adresse du bien</label>
                  <textarea style={S.textarea} value={infos.adresse_bien} onChange={e=>updateInfos("adresse_bien",e.target.value)} placeholder="Rue, Code Postal, Ville" />

                  <label style={S.label}>Description du projet</label>
                  <textarea style={S.textarea} value={infos.description_projet} onChange={e=>updateInfos("description_projet",e.target.value)} placeholder="Ex: Division d'un bâtiment en 1 studio + 2 T2" />

                  <label style={S.label}>Date de visite</label>
                  <input type="date" style={S.input} value={infos.date_visite} onChange={e=>updateInfos("date_visite",e.target.value)} />

                  <label style={S.label}>Observations générales</label>
                  <textarea style={S.textarea} value={infos.observations} onChange={e=>updateInfos("observations",e.target.value)} placeholder="Notes, accès, contraintes..." />

                  <div style={S.sectionH2}>Composition du projet</div>
                  {LOGEMENTS_TYPES.map(log => {
                    const val = log.split(" ")[0];
                    const checked = infos.logements.includes(val);
                    return (
                      <div key={val} style={S.checkItem(checked)} onClick={()=>toggleLogement(val)}>
                        <input type="checkbox" checked={checked} onChange={()=>toggleLogement(val)} style={{ accentColor:"#FFC300", width:16, height:16, flexShrink:0 }} />
                        <span style={{ fontSize:13, color: checked ? "#FFC300" : "#ccc" }}>{log}</span>
                      </div>
                    );
                  })}

                  <div style={{ marginTop:16 }}>
                    <button style={S.btnSecondary} onClick={()=>{ if(window.confirm("Effacer toutes les infos ?")) { const v={client_nom:"",client_prenom:"",adresse_bien:"",description_projet:"",observations:"",logements:[],date_visite:""}; setInfos(v); sauvegarderInfos(v); } }}>Effacer</button>
                  </div>
                </>
              )}

              {/* TAB OUVRAGES */}
              {tabGauche === "ouvrages" && (
                <>
                  <div style={S.sectionTitle}>🔨 Sélection Ouvrages</div>

                  <input style={{ ...S.input, marginBottom:10 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Rechercher un ouvrage..." />

                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                    {Object.keys(categories).map(cat => (
                      <div key={cat} style={S.filterTag(filtresCat.includes(cat))} onClick={()=>toggleFiltreCat(cat)}>{cat}</div>
                    ))}
                  </div>

                  {Object.entries(categories).map(([cat, items]) => {
                    const visibles = items.filter(item => ouvrageVisible(cat, item));
                    if (visibles.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div style={S.sectionH2}>{cat} ({items.length})</div>
                        {visibles.map((item, idx) => {
                          const sel = ouvrages.find(o => o.category===cat && o.item===item);
                          const checked = !!sel;
                          return (
                            <div key={idx} style={S.ouvrageItem(checked)}>
                              <input type="checkbox" checked={checked} onChange={()=>toggleOuvrage(cat,item)} style={{ accentColor:"#FFC300", width:16, height:16, marginTop:2, flexShrink:0, cursor:"pointer" }} />
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:13, color: checked ? "#FFC300" : "#ccc", fontWeight: checked ? 600 : 400 }}>{item}</div>
                                <div style={{ fontSize:11, color:"#666" }}>{cat}</div>
                                {checked && (
                                  <div style={{ display:"flex", gap:6, marginTop:6 }}>
                                    <input type="number" placeholder="Qté/Mesure" value={sel.quantite||""} onChange={e=>updateOuvrageQte(sel.id,e.target.value)} style={{ ...S.input, width:100, marginBottom:0, fontSize:12, padding:"5px 8px" }} />
                                    <select value={sel.unite||"U"} onChange={e=>updateOuvrageUnite(sel.id,e.target.value)} style={{ ...S.input, width:80, marginBottom:0, fontSize:12, padding:"5px 8px" }}>
                                      <option value="U">Unité</option>
                                      <option value="m">Mètres</option>
                                      <option value="m²">M²</option>
                                      <option value="ml">ML</option>
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

                  <div style={{ display:"flex", gap:8, marginTop:16, alignItems:"center" }}>
                    <div style={S.statBox}>
                      <div style={{ fontSize:24, fontWeight:800, color:"#FFC300" }}>{ouvrages.length}</div>
                      <div style={{ fontSize:11, color:"#666" }}>Sélectionnés</div>
                    </div>
                    <div style={S.statBox}>
                      <div style={{ fontSize:24, fontWeight:800, color:"#aaa" }}>{Object.values(categories).flat().length}</div>
                      <div style={{ fontSize:11, color:"#666" }}>Disponibles</div>
                    </div>
                  </div>

                  <div style={{ marginTop:12, display:"flex", gap:8 }}>
                    <button style={S.btnSecondary} onClick={async()=>{ if(!window.confirm("Déselectionner tout ?")) return; await supabase.from("profero_ouvrages_selectionnes").delete().eq("projet_id",projetId); setOuvrages([]); }}>Déselectionner tout</button>
                    <button style={S.btnPrimary} onClick={()=>setShowSelectionModal(true)}>👁️ Voir sélection</button>
                  </div>
                </>
              )}
            </div>

            {/* DROITE : PLAN + PARAMÈTRES + EXPORT */}
            <div style={S.sectionLast}>
              <div style={S.tabs}>
                <button style={S.tab(tabDroite==="plan")} onClick={()=>setTabDroite("plan")}>📐 Plan</button>
                <button style={S.tab(tabDroite==="params")} onClick={()=>setTabDroite("params")}>⚙️ Paramètres</button>
                <button style={S.tab(tabDroite==="export")} onClick={()=>setTabDroite("export")}>📄 Export PDF</button>
              </div>

              {/* TAB PLAN */}
              {tabDroite === "plan" && (
                <>
                  <div style={S.sectionTitle}>📐 Plan du Chantier</div>

                  <div style={{ display:"flex", flexWrap:"wrap", gap:0, marginBottom:8 }}>
                    {plans.map((p,i) => (
                      <button key={i} style={S.planTab(i===planIdx)} onClick={()=>setPlanIdx(i)}>{p.nom}</button>
                    ))}
                    <button style={{ ...S.btnPrimary, fontSize:11, padding:"5px 10px" }} onClick={ajouterPlan}>➕</button>
                  </div>

                  <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
                    <button style={{ ...S.btnPrimary, fontSize:11, background: drawActive ? "#000" : "#FFC300", color: drawActive ? "#FFC300" : "#000" }} onClick={toggleDraw}>✏️ Dessiner</button>
                    <button style={{ ...S.btnSecondary, fontSize:11, background: eraseActive ? "#000" : "transparent", color: eraseActive ? "#FFC300" : "#888" }} onClick={toggleErase}>🧹 Gomme</button>
                    <button style={{ ...S.btnSecondary, fontSize:11 }} onClick={effacerPlan}>🗑️ Effacer</button>
                    <button style={{ ...S.btnSecondary, fontSize:11 }} onClick={telechargerPlan}>💾 Télécharger</button>
                  </div>

                  <div style={S.canvasContainer}>
                    <canvas
                      ref={canvasRef}
                      width={400} height={500}
                      style={{ display:"block", width:"100%", cursor: drawActive ? "crosshair" : eraseActive ? "cell" : "default", touchAction:"none" }}
                      onMouseDown={onCanvasDown}
                      onMouseMove={onCanvasMove}
                      onMouseUp={onCanvasUp}
                      onMouseLeave={onCanvasUp}
                      onTouchStart={onCanvasDown}
                      onTouchMove={onCanvasMove}
                      onTouchEnd={onCanvasUp}
                    />
                  </div>

                  <div style={S.sectionH2}>Côtes menuiseries / huisseries</div>
                  <button style={{ ...S.btnPrimary, fontSize:11, marginBottom:10 }} onClick={ajouterCote}>➕ Ajouter côte</button>

                  {cotes.length === 0 && <div style={{ color:"#555", fontSize:12, textAlign:"center", padding:16 }}>Aucune côte enregistrée</div>}
                  {cotes.map(cote => (
                    <div key={cote.id} style={S.coteItem}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                        <input style={{ ...S.input, marginBottom:0, fontSize:12 }} value={cote.nom||""} onChange={e=>updateCote(cote.id,"nom",e.target.value)} placeholder="Fenêtre salon" />
                        <input style={{ ...S.input, marginBottom:0, fontSize:12 }} value={cote.localisation||""} onChange={e=>updateCote(cote.id,"localisation",e.target.value)} placeholder="Localisation" />
                        <input type="number" style={{ ...S.input, marginBottom:0, fontSize:12 }} value={cote.largeur||""} onChange={e=>updateCote(cote.id,"largeur",e.target.value)} placeholder="Largeur (cm)" />
                        <input type="number" style={{ ...S.input, marginBottom:0, fontSize:12 }} value={cote.hauteur||""} onChange={e=>updateCote(cote.id,"hauteur",e.target.value)} placeholder="Hauteur (cm)" />
                      </div>
                      <button style={S.btnDanger} onClick={()=>supprimerCote(cote.id)}>✕ Supprimer</button>
                    </div>
                  ))}
                </>
              )}

              {/* TAB PARAMÈTRES */}
              {tabDroite === "params" && (
                <>
                  <div style={S.sectionTitle}>⚙️ Bibliothèque Ouvrages</div>

                  <label style={S.label}>Catégorie à modifier</label>
                  <select style={S.input} value={catParamSelect} onChange={e=>setCatParamSelect(e.target.value)}>
                    <option value="">-- Sélectionner --</option>
                    {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>

                  {catParamSelect && (
                    <>
                      <div style={S.sectionH2}>Ouvrages ({(categories[catParamSelect]||[]).length})</div>
                      {(categories[catParamSelect]||[]).map((item, idx) => (
                        <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:"#1a1a1a", borderRadius:6, marginBottom:6 }}>
                          <span style={{ flex:1, fontSize:13, color:"#ccc" }}>{item}</span>
                          <button style={S.btnDanger} onClick={()=>supprimerOuvrageLiblio(catParamSelect,idx)}>✕</button>
                        </div>
                      ))}
                    </>
                  )}

                  <div style={S.sectionH2}>Ajouter un ouvrage</div>
                  <label style={S.label}>Catégorie</label>
                  <select style={S.input} value={newOuvrageCat} onChange={e=>setNewOuvrageCat(e.target.value)}>
                    {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <label style={S.label}>Libellé</label>
                  <input style={S.input} value={newOuvrageLib} onChange={e=>setNewOuvrageLib(e.target.value)} placeholder="Ex: Installation électrique T2 sans chauffage" onKeyDown={e=>e.key==="Enter"&&ajouterOuvrageLiblio()} />
                  <button style={{ ...S.btnPrimary, marginTop:6 }} onClick={ajouterOuvrageLiblio}>➕ Ajouter</button>
                </>
              )}

              {/* TAB EXPORT */}
              {tabDroite === "export" && (
                <>
                  <div style={S.sectionTitle}>📄 Export PDF</div>
                  <p style={{ color:"#888", fontSize:13, marginBottom:16, lineHeight:1.6 }}>Génère un PDF complet avec infos client, ouvrages sélectionnés, côtes et plans.</p>
                  <div style={{ background:"rgba(255,195,0,0.08)", border:"1px solid rgba(255,195,0,0.3)", borderRadius:8, padding:"14px 16px", marginBottom:20 }}>
                    <div style={{ color:"#FFC300", fontWeight:700, marginBottom:8, fontSize:13 }}>📋 Contenu du PDF</div>
                    {["Infos client et projet","Composition (logements)","Tous les ouvrages sélectionnés","Côtes menuiseries / huisseries","Tous les plans du chantier","Observations"].map(item => (
                      <div key={item} style={{ fontSize:12, color:"#aaa", marginBottom:4 }}>✓ {item}</div>
                    ))}
                  </div>
                  {projetCourant && (
                    <button style={S.btnPrimary} onClick={() => genererPDF({ infos, ouvrages, cotes, plans, canvasRef })}>
                      📥 Générer & Télécharger PDF
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL SÉLECTION */}
      {showSelectionModal && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&setShowSelectionModal(false)}>
          <div style={S.modalBox}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, borderBottom:"2px solid #FFC300", paddingBottom:10 }}>
              <span style={{ color:"#FFC300", fontWeight:700, fontSize:15 }}>✅ Ouvrages Sélectionnés ({ouvrages.length})</span>
              <button style={{ background:"#e05c5c", border:"none", borderRadius:"50%", width:28, height:28, cursor:"pointer", color:"#fff", fontSize:16 }} onClick={()=>setShowSelectionModal(false)}>×</button>
            </div>
            {ouvrages.length === 0 ? (
              <div style={{ color:"#666", textAlign:"center", padding:20 }}>Aucun ouvrage sélectionné</div>
            ) : (
              Object.entries(
                ouvrages.reduce((acc, o) => { if(!acc[o.category]) acc[o.category]=[]; acc[o.category].push(o); return acc; }, {})
              ).map(([cat, items]) => (
                <div key={cat} style={{ marginBottom:16 }}>
                  <div style={{ background:"#FFC300", color:"#000", padding:"6px 12px", borderRadius:6, fontWeight:700, fontSize:13, marginBottom:8 }}>{cat}</div>
                  {items.map((item, i) => (
                    <div key={i} style={{ padding:"5px 12px", fontSize:13, color:"#ccc", borderLeft:"2px solid #333", marginBottom:4 }}>
                      {item.item}{item.quantite ? ` — ${item.quantite} ${item.unite}` : ""}
                    </div>
                  ))}
                </div>
              ))
            )}
            <button style={{ ...S.btnPrimary, marginTop:12, width:"100%" }} onClick={()=>setShowSelectionModal(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GÉNÉRATION PDF (via impression) ─────────────────────────────────────────
function genererPDF({ infos, ouvrages, cotes, plans, canvasRef }) {
  const grouped = ouvrages.reduce((acc, o) => { if(!acc[o.category]) acc[o.category]=[]; acc[o.category].push(o); return acc; }, {});
  const canvasData = canvasRef.current ? canvasRef.current.toDataURL() : null;
  const dateStr = new Date().toLocaleDateString("fr-FR");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;margin:20px;color:#333}
    .header{text-align:center;border-bottom:3px solid #FFC300;padding-bottom:15px;margin-bottom:20px}
    .header h1{color:#FFC300;margin:0;font-size:24px}
    .section{margin-bottom:24px;page-break-inside:avoid}
    h2{color:#000;border-bottom:2px solid #FFC300;padding-bottom:8px;margin-bottom:12px}
    .info-row{margin:6px 0;font-size:14px}
    .info-label{font-weight:bold;color:#FFC300}
    .cat-block{background:#fff9e6;padding:10px 14px;border-left:4px solid #FFC300;margin-bottom:10px;border-radius:4px}
    .cat-title{font-weight:bold;color:#000;margin-bottom:6px}
    ul{margin-left:20px;line-height:2}
    .cote-block{background:#f9f9f9;padding:10px;border-radius:4px;margin-bottom:8px;font-size:13px}
    .plan-img{max-width:100%;border:2px solid #FFC300;margin:10px 0;border-radius:4px}
    .footer{margin-top:30px;text-align:center;color:#aaa;font-size:11px;border-top:1px solid #eee;padding-top:10px}
  </style>
  </head><body>
  <div class="header">
    <h1>Infos Client — Rapport de Visite Chantier</h1>
    <p><strong>Client :</strong> ${infos.client_nom} ${infos.client_prenom}</p>
    <p><strong>Date :</strong> ${dateStr}</p>
  </div>
  <div class="section">
    <h2>Informations Client</h2>
    <div class="info-row"><span class="info-label">Nom :</span> ${infos.client_nom} ${infos.client_prenom}</div>
    <div class="info-row"><span class="info-label">Adresse :</span> ${infos.adresse_bien||"—"}</div>
    <div class="info-row"><span class="info-label">Date de visite :</span> ${infos.date_visite ? new Date(infos.date_visite).toLocaleDateString("fr-FR") : "—"}</div>
    <div class="info-row"><span class="info-label">Description :</span> ${infos.description_projet||"—"}</div>
    ${infos.logements?.length ? `<div class="info-row"><span class="info-label">Composition :</span> ${infos.logements.join(", ")}</div>` : ""}
    ${infos.observations ? `<div class="info-row"><span class="info-label">Observations :</span> ${infos.observations}</div>` : ""}
  </div>
  ${ouvrages.length > 0 ? `
  <div class="section">
    <h2>Ouvrages Sélectionnés</h2>
    ${Object.entries(grouped).map(([cat, items]) => `
      <div class="cat-block">
        <div class="cat-title">${cat}</div>
        <ul>${items.map(i=>`<li>${i.item}${i.quantite?` — ${i.quantite} ${i.unite}`:""}</li>`).join("")}</ul>
      </div>
    `).join("")}
  </div>` : ""}
  ${cotes.length > 0 ? `
  <div class="section">
    <h2>Côtes Menuiseries / Huisseries</h2>
    ${cotes.map(c=>`<div class="cote-block"><strong>${c.nom||"(Sans nom)"}</strong><br>Largeur : ${c.largeur||"—"} cm | Hauteur : ${c.hauteur||"—"} cm<br>Localisation : ${c.localisation||"—"}</div>`).join("")}
  </div>` : ""}
  ${canvasData ? `
  <div class="section">
    <h2>Plan du Chantier</h2>
    <img src="${canvasData}" class="plan-img" />
  </div>` : ""}
  <div class="footer">Rapport généré par Infos Client — ${dateStr}</div>
  </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 500);
}
