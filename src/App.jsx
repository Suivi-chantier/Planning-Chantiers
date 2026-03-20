import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
 
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
 
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
 
const COULEURS_PALETTE = [
  "#c8d8f0","#ffd6cc","#fce4a0","#d4edda","#d1f7e4","#e8d0e8",
  "#fff0c0","#ffd6e7","#d0e8ff","#e0f0e0","#ffe4b5","#d6e4ff",
  "#f0d6e8","#d6f0e4","#fff0d6","#e8d6f0",
];
 
const THEMES = {
  dark: {
    bg:"#1a1f2e", surface:"#1e2336", card:"rgba(255,255,255,0.04)",
    cardHover:"rgba(255,255,255,0.08)", cardFill:"rgba(255,255,255,0.06)",
    cardEditing:"rgba(255,255,255,0.1)", border:"rgba(255,255,255,0.07)",
    borderHover:"rgba(255,255,255,0.15)", text:"#e8eaf0", textSub:"#9aa5c0",
    textMuted:"#5b6a8a", accent:"#5b8af5", accentSub:"#4a76e8",
    tagBg:"rgba(91,138,245,0.25)", tagColor:"#a0b8ff",
    tagReelBg:"rgba(80,200,120,0.2)", tagReelColor:"#7ee8a2",
    planColor:"#a0b8ff", reelColor:"#b0f0c0",
    cmdColor:"#f5d08a", cmdBg:"rgba(245,208,138,0.08)", cmdBorder:"rgba(245,208,138,0.15)",
    emptyColor:"#3a4060", headerBorder:"rgba(255,255,255,0.08)",
    scrollThumb:"#3a4060", labelText:"#1a1f2e",
  },
  light: {
    bg:"#f0f2f8", surface:"#ffffff", card:"rgba(0,0,0,0.02)",
    cardHover:"rgba(0,0,0,0.05)", cardFill:"rgba(91,138,245,0.04)",
    cardEditing:"rgba(91,138,245,0.08)", border:"rgba(0,0,0,0.09)",
    borderHover:"rgba(0,0,0,0.2)", text:"#1a1f2e", textSub:"#4a5568",
    textMuted:"#8a9ab0", accent:"#4070e8", accentSub:"#3060d0",
    tagBg:"rgba(64,112,232,0.15)", tagColor:"#3060c0",
    tagReelBg:"rgba(40,160,80,0.12)", tagReelColor:"#207040",
    planColor:"#3060c0", reelColor:"#207040",
    cmdColor:"#b06000", cmdBg:"rgba(200,140,0,0.07)", cmdBorder:"rgba(200,140,0,0.25)",
    emptyColor:"#c0c8d8", headerBorder:"rgba(0,0,0,0.08)",
    scrollThumb:"#c0c8d8", labelText:"#1a1f2e",
  },
};
 
function getWeekId(y, w) { return `${y}-W${String(w).padStart(2,"0")}`; }
function getCurrentWeek() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const w = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return { year: now.getFullYear(), week: w };
}
function emptyCell() { return { planifie:"", reel:"", ouvriers:[] }; }
 
const DEFAULT_OUVRIERS = ["JP","Stev","Kev","Reza","Hamed","Mady","Yann","Julien","Steven"];
const DEFAULT_CHANTIERS = [
  { id:"lamartine",  nom:"LAMARTINE",      couleur:"#c8d8f0" },
  { id:"lou",        nom:"LOU",            couleur:"#ffd6cc" },
  { id:"philibert",  nom:"PHILIBERT",      couleur:"#fce4a0" },
  { id:"arthur",     nom:"ARTHUR",         couleur:"#d4edda" },
  { id:"metois",     nom:"METOIS",         couleur:"#d1f7e4" },
  { id:"gildas",     nom:"GILDAS BAUGE 2", couleur:"#e8d0e8" },
];
 
export default function App() {
  const { year:iY, week:iW } = getCurrentWeek();
  const [year, setYear]     = useState(iY);
  const [week, setWeek]     = useState(iW);
  const [page, setPage]     = useState("planning");
  const [theme, setTheme]   = useState(() => localStorage.getItem("theme") || "dark");
 
  const [ouvriers, setOuvriers]   = useState(DEFAULT_OUVRIERS);
  const [chantiers, setChantiers] = useState(DEFAULT_CHANTIERS);
  const [cells, setCells]         = useState({});
  const [commandes, setCommandes] = useState({});
  const [notesData, setNotesData] = useState({});
 
  // ── ÉTAT LOCAL DE LA CELLULE EN COURS D'ÉDITION ──────────────────────────
  // On tape ici librement. Rien n'est envoyé à Supabase avant le clic "Fermer".
  const [editCell, setEditCell]   = useState(null); // { cId, jour }
  const [cellDraft, setCellDraft] = useState(null); // { planifie, reel, ouvriers }
 
  // Commandes et notes : sauvegarde au blur (quand on clique ailleurs)
  const [editCom, setEditCom]     = useState(null);
  const [editNote, setEditNote]   = useState(null);
 
  const [view, setView]           = useState("planifie");
  const [syncing, setSyncing]     = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync]   = useState(null);
  const [saving, setSaving]       = useState(false); // indicateur pendant le Fermer
 
  const [adminTab, setAdminTab]       = useState("ouvriers");
  const [newOuvrier, setNewOuvrier]   = useState("");
  const [editOuvrier, setEditOuvrier] = useState(null);
  const [newNom, setNewNom]           = useState("");
  const [newColor, setNewColor]       = useState(COULEURS_PALETTE[0]);
  const [editChIdx, setEditChIdx]     = useState(null);
 
  const T = THEMES[theme];
  const weekId = getWeekId(year, week);
 
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); localStorage.setItem("theme", next);
  };
 
  // ── LOAD ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      const { data: cfg, error: cfgErr } = await supabase.from("planning_config").select("*");
      if (cfgErr) console.error("planning_config :", cfgErr.message);
      else if (cfg?.length) {
        cfg.forEach(r => {
          if (r.key === "ouvriers")  setOuvriers(r.value);
          if (r.key === "chantiers") setChantiers(r.value);
        });
      }
      const { data: cd } = await supabase.from("planning_cells").select("*").eq("week_id", weekId);
      if (cd) {
        const m = {};
        cd.forEach(r => { m[`${r.chantier_id}_${r.jour}`] = { planifie:r.planifie||"", reel:r.reel||"", ouvriers:r.ouvriers||[] }; });
        setCells(m);
      }
      const { data: comd } = await supabase.from("planning_commandes").select("*").eq("week_id", weekId);
      if (comd) { const m={}; comd.forEach(r => { m[r.chantier_id] = r.contenu||""; }); setCommandes(m); }
      const { data: nd } = await supabase.from("planning_notes").select("*");
      if (nd) { const m={}; nd.forEach(r => { m[r.chantier_id] = r.contenu||""; }); setNotesData(m); }
      setConnected(true); setLastSync(new Date());
    } catch(e) { console.error(e); }
    setSyncing(false);
  }, [weekId]);
 
  useEffect(() => { loadData(); }, [loadData]);
 
  // ── REALTIME ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`planning-${weekId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"planning_cells", filter:`week_id=eq.${weekId}` }, p => {
        const r = p.new || p.old; if (!r) return;
        const key = `${r.chantier_id}_${r.jour}`;
        if (p.eventType === "DELETE") setCells(prev => { const n={...prev}; delete n[key]; return n; });
        else setCells(prev => ({ ...prev, [key]: { planifie:r.planifie||"", reel:r.reel||"", ouvriers:r.ouvriers||[] } }));
        setLastSync(new Date());
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"planning_commandes", filter:`week_id=eq.${weekId}` }, p => {
        const r = p.new || p.old; if (!r) return;
        if (p.eventType === "DELETE") setCommandes(prev => { const n={...prev}; delete n[r.chantier_id]; return n; });
        else setCommandes(prev => ({ ...prev, [r.chantier_id]: r.contenu||"" }));
        setLastSync(new Date());
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"planning_config" }, p => {
        const r = p.new; if (!r) return;
        if (r.key === "ouvriers")  setOuvriers(r.value);
        if (r.key === "chantiers") setChantiers(r.value);
        setLastSync(new Date());
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekId]);
 
  // ── SAVE CONFIG (chantiers & ouvriers) ───────────────────────────────────
  const saveConfig = async (key, value) => {
    const { error } = await supabase
      .from("planning_config")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict:"key" });
    if (error) {
      console.error("saveConfig échoué :", error.message);
      // Réessai après 1s
      setTimeout(() => supabase.from("planning_config")
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict:"key" }), 1000);
    }
  };
 
  // ── OUVRIR UNE CELLULE ───────────────────────────────────────────────────
  const openCell = (cId, jour) => {
    // Si une autre cellule était ouverte, on l'a déjà sauvegardée via closeCell
    setEditCell({ cId, jour });
    // Initialise le brouillon avec les données actuelles de cette cellule
    setCellDraft({ ...(cells[`${cId}_${jour}`] || emptyCell()) });
  };
 
  // ── FERMER ET SAUVEGARDER (seul moment où Supabase est appelé pour le texte)
  const closeCell = async () => {
    if (!editCell || !cellDraft) { setEditCell(null); setCellDraft(null); return; }
    const { cId, jour } = editCell;
    const key = `${cId}_${jour}`;
    setSaving(true);
    // 1. Mise à jour de l'état local immédiatement
    setCells(prev => ({ ...prev, [key]: cellDraft }));
    // 2. Envoi à Supabase
    await supabase.from("planning_cells")
      .upsert({ week_id:weekId, chantier_id:cId, jour, ...cellDraft }, { onConflict:"week_id,chantier_id,jour" });
    setSaving(false);
    setEditCell(null);
    setCellDraft(null);
  };
 
  // ── TOGGLE OUVRIER (dans la cellule ouverte) ─────────────────────────────
  // Pas besoin de Supabase ici, on met juste à jour le brouillon local.
  // La sauvegarde se fera au "Fermer".
  const toggleOuvrier = (o) => {
    if (!cellDraft) return;
    const list = [...(cellDraft.ouvriers||[])];
    const i = list.indexOf(o);
    if (i >= 0) list.splice(i,1); else list.push(o);
    setCellDraft(prev => ({ ...prev, ouvriers: list }));
  };
 
  // ── COMMANDES (sauvegarde au blur) ───────────────────────────────────────
  const saveCommande = async (cId, v) => {
    setCommandes(prev => ({ ...prev, [cId]: v }));
    await supabase.from("planning_commandes")
      .upsert({ week_id:weekId, chantier_id:cId, contenu:v }, { onConflict:"week_id,chantier_id" });
  };
 
  // ── NOTES (sauvegarde au blur) ───────────────────────────────────────────
  const saveNote = async (cId, v) => {
    setNotesData(prev => ({ ...prev, [cId]: v }));
    await supabase.from("planning_notes")
      .upsert({ chantier_id:cId, contenu:v }, { onConflict:"chantier_id" });
  };
 
  // ── NAV ───────────────────────────────────────────────────────────────────
  const prevWeek = () => { if(week===1){setYear(y=>y-1);setWeek(52);}else setWeek(w=>w-1); };
  const nextWeek = () => { if(week===52){setYear(y=>y+1);setWeek(1);}else setWeek(w=>w+1); };
  const goNow = () => { const {year:y,week:w}=getCurrentWeek(); setYear(y); setWeek(w); };
 
  // Données à afficher pour une cellule : brouillon si en cours d'édition, sinon Supabase
  const getCell = (cId, jour) => {
    if (editCell?.cId===cId && editCell?.jour===jour && cellDraft) return cellDraft;
    return cells[`${cId}_${jour}`] || emptyCell();
  };
  const isEditing = (cId, jour) => editCell?.cId===cId && editCell?.jour===jour;
 
  // ── ADMIN : OUVRIERS ──────────────────────────────────────────────────────
  const addOuvrier    = () => { if(!newOuvrier.trim())return; const u=[...ouvriers,newOuvrier.trim()]; setOuvriers(u); saveConfig("ouvriers",u); setNewOuvrier(""); };
  const removeOuvrier = i  => { const u=ouvriers.filter((_,idx)=>idx!==i); setOuvriers(u); saveConfig("ouvriers",u); };
  const renameOuvrier = (i,v) => { const u=ouvriers.map((o,idx)=>idx===i?v:o); setOuvriers(u); saveConfig("ouvriers",u); setEditOuvrier(null); };
  const moveOuvrier   = (i,dir) => { const a=[...ouvriers],j=i+dir; if(j<0||j>=a.length)return; [a[i],a[j]]=[a[j],a[i]]; setOuvriers(a); saveConfig("ouvriers",a); };
 
  // ── ADMIN : CHANTIERS ─────────────────────────────────────────────────────
  const addChantier    = () => { if(!newNom.trim())return; const id=newNom.trim().toLowerCase().replace(/\s+/g,"-")+"-"+Date.now(); const nc={id,nom:newNom.trim().toUpperCase(),couleur:newColor}; const u=[...chantiers,nc]; setChantiers(u); saveConfig("chantiers",u); setNewNom(""); };
  const removeChantier = i  => { const u=chantiers.filter((_,idx)=>idx!==i); setChantiers(u); saveConfig("chantiers",u); };
  const updateChantier = (i,ch) => { const u=chantiers.map((c,idx)=>idx===i?{...c,...ch}:c); setChantiers(u); saveConfig("chantiers",u); };
  const moveChantier   = (i,dir) => { const a=[...chantiers],j=i+dir; if(j<0||j>=a.length)return; [a[i],a[j]]=[a[j],a[i]]; setChantiers(a); saveConfig("chantiers",a); };
 
  // ── IMPRESSION ────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const vl = {"planifie":"PLANNING PLANIFIÉ","reel":"RÉEL","compare":"BILAN COMPARATIF"}[view];
    const rows = chantiers.map(c => {
      const cols = JOURS.map(j => {
        const cell = getCell(c.id, j);
        let html = "";
        if (view==="compare") {
          if (cell.planifie) html+=`<div style="color:#3060c0;margin-bottom:3px">▸ ${cell.planifie.replace(/\n/g,"<br>")}</div>`;
          if (cell.reel)     html+=`<div style="color:#207040">✓ ${cell.reel.replace(/\n/g,"<br>")}</div>`;
        } else if (cell[view]) html+=cell[view].replace(/\n/g,"<br>");
        if (cell.ouvriers?.length) html+=`<div style="margin-top:4px;font-weight:700;color:#666;font-size:9px;border-top:1px solid #eee;padding-top:3px">${cell.ouvriers.join(" · ")}</div>`;
        return `<td>${html||"—"}</td>`;
      }).join("");
      return `<tr><td style="font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase;background:${c.couleur};width:100px">${c.nom}</td>${cols}</tr>`;
    }).join("");
    const cmds = chantiers.filter(c=>commandes[c.id]?.trim()).map(c=>
      `<div style="margin:4px 0;padding:4px 0;border-bottom:1px solid #eee;font-size:10px"><strong style="background:${c.couleur};padding:2px 6px;border-radius:4px;color:#1a1f2e">${c.nom}</strong> — ${commandes[c.id]}</div>`
    ).join("");
    const w = window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Planning S${week}—${year}</title>
    <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:10px;color:#1a1f2e}
    h1{font-size:16px;margin-bottom:2px}.sub{font-size:10px;color:#666;margin-bottom:12px}
    table{width:100%;border-collapse:collapse}th{background:#1a1f2e;color:#fff;padding:6px 8px;text-align:center;font-size:11px;letter-spacing:1px}
    td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;line-height:1.4}
    .cs{margin-top:14px}.ct{font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#666;margin-bottom:6px}
    </style></head><body>
    <h1>Planning — Semaine ${week} / ${year}</h1>
    <div class="sub">${vl} · ${new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
    <table><thead><tr><th>Chantier</th>${JOURS.map(j=>`<th>${j}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    ${cmds?`<div class="cs"><div class="ct">📦 Commandes à prévoir</div>${cmds}</div>`:""}</body></html>`);
    w.document.close(); setTimeout(()=>w.print(),400);
  };
 
  // ── CSS ───────────────────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};min-height:100vh}
    ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:3px}
    textarea,input{outline:none;font-family:inherit}
    .cell{background:${T.card};border:1px solid ${T.border};border-radius:8px;padding:8px 10px;min-height:64px;cursor:pointer;transition:all .15s}
    .cell:hover{background:${T.cardHover};border-color:${T.borderHover}}
    .cell.filled{background:${T.cardFill}}
    .cell.editing{background:${T.cardEditing};border-color:${T.accent};box-shadow:0 0 0 2px ${T.accent}33}
    .badge{display:inline-block;background:${T.tagBg};color:${T.tagColor};border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;margin:1px 2px 1px 0}
    .badge.reel{background:${T.tagReelBg};color:${T.tagReelColor}}
    .tab{padding:8px 18px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:all .15s}
    .tab.on{background:${T.accent};color:#fff}
    .tab.off{background:${T.card};color:${T.textSub};border:1px solid ${T.border}}
    .tab.off:hover{background:${T.cardHover};color:${T.text}}
    .btn-p{background:${T.accent};color:#fff;border:none;border-radius:6px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s}
    .btn-p:hover{background:${T.accentSub}}
    .btn-p:disabled{opacity:.5;cursor:default}
    .btn-g{background:transparent;color:${T.textSub};border:1px solid ${T.border};border-radius:6px;padding:8px 16px;font-family:inherit;font-size:13px;cursor:pointer;transition:all .15s}
    .btn-g:hover{background:${T.cardHover};color:${T.text}}
    .btn-d{background:transparent;color:#e05c5c;border:1px solid rgba(224,92,92,0.3);border-radius:6px;padding:5px 10px;font-family:inherit;font-size:12px;cursor:pointer}
    .btn-d:hover{background:rgba(224,92,92,0.1)}
    .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.5;margin-bottom:2px}
    .ouvbtn{display:inline-block;padding:4px 10px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;margin:3px 3px 3px 0;border:1.5px solid ${T.border};background:transparent;color:${T.textSub};font-family:inherit;transition:all .12s}
    .ouvbtn.on{background:${T.tagBg};border-color:${T.accent};color:${T.tagColor}}
    .ouvbtn:hover{border-color:${T.borderHover};color:${T.text}}
    .navbtn{background:${T.card};border:1px solid ${T.border};color:${T.text};border-radius:6px;padding:6px 14px;font-family:inherit;font-size:18px;cursor:pointer;transition:background .15s}
    .navbtn:hover{background:${T.cardHover}}
    .dot-pulse{width:8px;height:8px;border-radius:50%;background:#50c878;display:inline-block;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .inp{width:100%;background:transparent;border:none;color:${T.text};font-size:13px;line-height:1.5;resize:none}
    .sec-hdr{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${T.textMuted};margin-bottom:10px}
    .ac{background:${T.surface};border:1px solid ${T.border};border-radius:12px;padding:22px;margin-bottom:14px}
    .ar{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${T.border}}
    .ar:last-child{border-bottom:none}
    .ti{background:${T.card};border:1px solid ${T.border};border-radius:6px;padding:8px 12px;color:${T.text};font-family:inherit;font-size:14px;flex:1}
    .ti:focus{border-color:${T.accent}}
    .atab{padding:8px 16px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:.5px;text-transform:uppercase}
    .atab.on{background:${T.accent};color:#fff}
    .atab.off{background:transparent;color:${T.textSub}}
    .atab.off:hover{color:${T.text}}
    .cdot{width:22px;height:22px;border-radius:50%;cursor:pointer;transition:transform .1s;flex-shrink:0}
    .cdot:hover{transform:scale(1.2)}
    .cdot.sel{outline:3px solid ${T.accent};outline-offset:2px}
    .np{font-size:12px;color:${T.cmdColor};background:${T.cmdBg};border:1px solid ${T.cmdBorder};border-radius:6px;padding:6px 10px;white-space:pre-wrap;line-height:1.5;margin-top:4px;cursor:pointer}
    .ib{background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 3px;opacity:.6;transition:opacity .15s;color:${T.text}}
    .ib:hover{opacity:1}
  `;
 
  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh" }}>
      <style>{css}</style>
 
      {/* HEADER */}
      <div style={{ background:T.surface, borderBottom:`1px solid ${T.headerBorder}`, padding:"14px 24px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", position:"sticky", top:0, zIndex:100 }}>
        <div>
          <div style={{ fontSize:10, letterSpacing:3, textTransform:"uppercase", color:T.textMuted }}>Planning Chantier</div>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:1 }}>SEMAINE {week} — {year}</div>
        </div>
 
        {page==="planning" && (
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button className="navbtn" onClick={prevWeek}>‹</button>
            <button className="navbtn" onClick={goNow} style={{ fontSize:11, padding:"6px 10px" }}>CETTE SEMAINE</button>
            <button className="navbtn" onClick={nextWeek}>›</button>
          </div>
        )}
 
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", background:T.card, borderRadius:8, fontSize:12, color:T.textSub }}>
          {syncing
            ? <><span style={{ width:8,height:8,borderRadius:"50%",background:"#f5a623",display:"inline-block" }}/> Sync…</>
            : connected
              ? <><span className="dot-pulse"/>{" "}En ligne {lastSync?`· ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`:""}</>
              : <><span style={{ width:8,height:8,borderRadius:"50%",background:"#e05c5c",display:"inline-block" }}/> Hors ligne</>
          }
        </div>
 
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {page==="planning" && <>
            <button className={`tab ${view==="planifie"?"on":"off"}`} onClick={()=>setView("planifie")}>Planifié</button>
            <button className={`tab ${view==="reel"?"on":"off"}`}     onClick={()=>setView("reel")}>Réel</button>
            <button className={`tab ${view==="compare"?"on":"off"}`}  onClick={()=>setView("compare")}>Bilan</button>
            <button className="btn-g" onClick={handlePrint} title="Imprimer" style={{ fontSize:17, padding:"6px 12px" }}>🖨</button>
          </>}
          <button className="btn-g" onClick={toggleTheme} title="Thème" style={{ fontSize:17, padding:"6px 12px" }}>{theme==="dark"?"☀️":"🌙"}</button>
          <button className={page==="admin"?"btn-p":"btn-g"} onClick={()=>setPage(p=>p==="admin"?"planning":"admin")}>
            ⚙️ {page==="admin"?"← Retour":"Réglages"}
          </button>
        </div>
      </div>
 
      {/* ═══ PAGE PLANNING ═══ */}
      {page==="planning" && (
        <div style={{ padding:"20px 24px", display:"flex", gap:20, alignItems:"flex-start" }}>
          <div style={{ flex:1, minWidth:0, overflowX:"auto" }}>
            {/* En-têtes jours */}
            <div style={{ display:"grid", gridTemplateColumns:`150px repeat(${JOURS.length},minmax(130px,1fr))`, gap:5, marginBottom:6 }}>
              <div/>
              {JOURS.map(j=>(
                <div key={j} style={{ textAlign:"center", fontWeight:800, fontSize:12, letterSpacing:2, textTransform:"uppercase", color:T.textMuted, padding:"6px 0" }}>{j}</div>
              ))}
            </div>
 
            {/* Lignes chantiers */}
            {chantiers.map(c=>(
              <div key={c.id} style={{ display:"grid", gridTemplateColumns:`150px repeat(${JOURS.length},minmax(130px,1fr))`, gap:5, marginBottom:5 }}>
                <div style={{ background:c.couleur, color:T.labelText, borderRadius:"8px 0 0 8px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", fontWeight:800, fontSize:13, letterSpacing:1, textTransform:"uppercase", padding:"10px 8px", cursor:"pointer", gap:4 }}
                  onClick={()=>setEditCom(editCom===c.id?null:c.id)}>
                  <span>{c.nom}</span>
                  <div style={{ display:"flex", gap:4 }}>
                    {commandes[c.id]?.trim() && <span style={{ width:6,height:6,borderRadius:"50%",background:"#f5a623",display:"block" }}/>}
                    {notesData[c.id]?.trim()  && <span style={{ width:6,height:6,borderRadius:"50%",background:T.accent,display:"block" }}/>}
                  </div>
                </div>
 
                {JOURS.map(jour=>{
                  const cell    = getCell(c.id, jour);
                  const editing = isEditing(c.id, jour);
                  const filled  = cell.planifie||cell.reel||cell.ouvriers?.length>0;
                  return (
                    <div key={jour} className={`cell ${filled?"filled":""} ${editing?"editing":""}`}
                      onClick={()=>{ if(!editing) openCell(c.id, jour); }}>
                      {editing ? (
                        <div onClick={e=>e.stopPropagation()}>
                          {view!=="reel" && <>
                            <div className="lbl" style={{ color:T.accent }}>Planifié</div>
                            <textarea className="inp" autoFocus={view==="planifie"} rows={3}
                              value={cellDraft?.planifie||""}
                              onChange={e=>setCellDraft(prev=>({...prev,planifie:e.target.value}))}
                              placeholder="Tâches prévues…"/>
                          </>}
                          {view!=="planifie" && <>
                            <div className="lbl" style={{ color:"#50c878", marginTop:view==="compare"?6:0 }}>Réel</div>
                            <textarea className="inp" autoFocus={view==="reel"} rows={3}
                              value={cellDraft?.reel||""}
                              onChange={e=>setCellDraft(prev=>({...prev,reel:e.target.value}))}
                              placeholder="Ce qui a été fait…" style={{ color:T.reelColor }}/>
                          </>}
                          <div style={{ marginTop:8 }}>
                            <div className="lbl">Ouvriers</div>
                            <div style={{ marginTop:4 }}>
                              {ouvriers.map(o=>(
                                <button key={o} className={`ouvbtn ${(cellDraft?.ouvriers||[]).includes(o)?"on":""}`}
                                  onClick={()=>toggleOuvrier(o)}>{o}</button>
                              ))}
                            </div>
                          </div>
                          <div style={{ marginTop:10, textAlign:"right" }}>
                            <button className="btn-p" style={{ fontSize:12, padding:"5px 14px" }}
                              onClick={closeCell} disabled={saving}>
                              {saving ? "…" : "✓ Fermer"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {view==="compare" ? <>
                            {cell.planifie && <><div className="lbl">Planifié</div><div style={{ fontSize:12, color:T.planColor, lineHeight:1.5 }}>{cell.planifie}</div></>}
                            {cell.reel     && <><div className="lbl" style={{ marginTop:cell.planifie?4:0 }}>Réel</div><div style={{ fontSize:12, color:T.reelColor, lineHeight:1.5 }}>{cell.reel}</div></>}
                            {!cell.planifie&&!cell.reel && <div style={{ color:T.emptyColor, fontSize:13 }}>—</div>}
                          </> : <>
                            <div style={{ fontSize:13, lineHeight:1.5, color:view==="reel"?T.reelColor:T.text }}>
                              {cell[view]||<span style={{ color:T.emptyColor }}>—</span>}
                            </div>
                          </>}
                          {cell.ouvriers?.length>0 && (
                            <div style={{ marginTop:4 }}>
                              {cell.ouvriers.map(o=><span key={o} className={`badge ${view==="reel"?"reel":""}`}>{o}</span>)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <button className="btn-g" style={{ marginTop:10, fontSize:13 }} onClick={()=>{ setPage("admin"); setAdminTab("chantiers"); }}>+ Gérer les chantiers</button>
          </div>
 
          {/* Sidebar */}
          <div style={{ width:230, flexShrink:0 }}>
            <div className="sec-hdr">📦 Commandes semaine</div>
            {chantiers.map(c=>(
              <div key={c.id} style={{ marginBottom:10 }}>
                <div style={{ background:c.couleur, color:T.labelText, borderRadius:"6px 6px 0 0", padding:"6px 10px", fontSize:12, fontWeight:800, letterSpacing:1, textTransform:"uppercase", cursor:"pointer", display:"flex", justifyContent:"space-between" }}
                  onClick={()=>setEditCom(editCom===c.id?null:c.id)}>
                  {c.nom} <span style={{ opacity:.5 }}>{editCom===c.id?"▲":"▼"}</span>
                </div>
                {editCom===c.id
                  ? <textarea rows={4}
                      style={{ width:"100%", background:T.card, border:`1px solid ${T.border}`, borderTop:"none", borderRadius:"0 0 6px 6px", color:T.cmdColor, padding:"8px 10px", fontSize:13, lineHeight:1.5, fontFamily:"inherit" }}
                      defaultValue={commandes[c.id]||""}
                      onBlur={e=>saveCommande(c.id, e.target.value)}
                      placeholder="Matériaux, livraisons…" autoFocus/>
                  : commandes[c.id]?.trim()
                    ? <div className="np" onClick={()=>setEditCom(c.id)} style={{ borderRadius:"0 0 6px 6px", borderTop:"none" }}>{commandes[c.id]}</div>
                    : <div onClick={()=>setEditCom(c.id)} style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:"none", borderRadius:"0 0 6px 6px", padding:"6px 10px", fontSize:12, color:T.emptyColor, cursor:"pointer" }}>Cliquer pour ajouter</div>
                }
              </div>
            ))}
 
            <div className="sec-hdr" style={{ marginTop:22 }}>📋 Notes chantier</div>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:10, lineHeight:1.4 }}>Informations permanentes (accès, contacts…)</div>
            {chantiers.map(c=>(
              <div key={c.id} style={{ marginBottom:8 }}>
                <div style={{ background:c.couleur, color:T.labelText, borderRadius:"6px 6px 0 0", padding:"5px 10px", fontSize:11, fontWeight:800, letterSpacing:1, textTransform:"uppercase", cursor:"pointer", display:"flex", justifyContent:"space-between" }}
                  onClick={()=>setEditNote(editNote===c.id?null:c.id)}>
                  {c.nom} <span style={{ opacity:.5 }}>{editNote===c.id?"▲":"▼"}</span>
                </div>
                {editNote===c.id
                  ? <textarea rows={3}
                      style={{ width:"100%", background:T.card, border:`1px solid ${T.border}`, borderTop:"none", borderRadius:"0 0 6px 6px", color:T.text, padding:"8px 10px", fontSize:12, lineHeight:1.5, fontFamily:"inherit" }}
                      defaultValue={notesData[c.id]||""}
                      onBlur={e=>saveNote(c.id, e.target.value)}
                      placeholder="Code d'accès, contact client…" autoFocus/>
                  : notesData[c.id]?.trim()
                    ? <div className="np" onClick={()=>setEditNote(c.id)} style={{ color:T.textSub, background:T.card, borderRadius:"0 0 6px 6px", borderTop:"none" }}>{notesData[c.id]}</div>
                    : <div onClick={()=>setEditNote(c.id)} style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:"none", borderRadius:"0 0 6px 6px", padding:"5px 10px", fontSize:11, color:T.emptyColor, cursor:"pointer" }}>Ajouter une note…</div>
                }
              </div>
            ))}
          </div>
        </div>
      )}
 
      {/* ═══ PAGE ADMIN ═══ */}
      {page==="admin" && (
        <div style={{ maxWidth:680, margin:"0 auto", padding:"32px 24px" }}>
          <div style={{ fontSize:28, fontWeight:800, letterSpacing:1, marginBottom:4 }}>Réglages</div>
          <div style={{ color:T.textSub, fontSize:14, marginBottom:24 }}>Modifications appliquées immédiatement pour toute l'équipe.</div>
 
          <div style={{ display:"flex", gap:4, marginBottom:22, borderBottom:`1px solid ${T.border}`, paddingBottom:8 }}>
            {[["ouvriers","👷 Ouvriers"],["chantiers","🏗️ Chantiers"],["apparence","🎨 Apparence"]].map(([k,l])=>(
              <button key={k} className={`atab ${adminTab===k?"on":"off"}`} onClick={()=>setAdminTab(k)}>{l}</button>
            ))}
          </div>
 
          {adminTab==="ouvriers" && (
            <div className="ac">
              <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Liste des ouvriers</div>
              <div style={{ color:T.textSub, fontSize:13, marginBottom:18 }}>Les noms apparaissent comme boutons cliquables dans chaque case du planning.</div>
              {ouvriers.map((o,i)=>(
                <div key={i} className="ar">
                  <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                    <button className="ib" onClick={()=>moveOuvrier(i,-1)}>▲</button>
                    <button className="ib" onClick={()=>moveOuvrier(i,1)}>▼</button>
                  </div>
                  {editOuvrier?.index===i
                    ? <>
                        <input className="ti" value={editOuvrier.value} onChange={e=>setEditOuvrier({index:i,value:e.target.value})}
                          onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value);if(e.key==="Escape")setEditOuvrier(null);}} autoFocus/>
                        <button className="btn-p" style={{ fontSize:12, padding:"6px 12px" }} onClick={()=>renameOuvrier(i,editOuvrier.value)}>✓</button>
                        <button className="btn-g" style={{ fontSize:12, padding:"6px 12px" }} onClick={()=>setEditOuvrier(null)}>✕</button>
                      </>
                    : <>
                        <div style={{ flex:1, fontWeight:600, fontSize:15 }}>{o}</div>
                        <button className="ib" onClick={()=>setEditOuvrier({index:i,value:o})} title="Renommer">✏️</button>
                        <button className="btn-d" onClick={()=>removeOuvrier(i)}>Supprimer</button>
                      </>
                  }
                </div>
              ))}
              <div style={{ display:"flex", gap:10, marginTop:16 }}>
                <input className="ti" value={newOuvrier} onChange={e=>setNewOuvrier(e.target.value)} placeholder="Prénom ou initiales…" onKeyDown={e=>e.key==="Enter"&&addOuvrier()}/>
                <button className="btn-p" onClick={addOuvrier}>+ Ajouter</button>
              </div>
            </div>
          )}
 
          {adminTab==="chantiers" && (
            <div className="ac">
              <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Chantiers par défaut</div>
              <div style={{ color:T.textSub, fontSize:13, marginBottom:18 }}>Clique sur le rond coloré pour changer la couleur d'un chantier.</div>
              {chantiers.map((c,i)=>(
                <div key={c.id} className="ar" style={{ flexWrap:"wrap" }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                    <button className="ib" onClick={()=>moveChantier(i,-1)}>▲</button>
                    <button className="ib" onClick={()=>moveChantier(i,1)}>▼</button>
                  </div>
                  <div className={`cdot ${editChIdx===i?"sel":""}`} style={{ background:c.couleur, border:`2px solid ${T.border}` }} onClick={()=>setEditChIdx(editChIdx===i?null:i)} title="Changer la couleur"/>
                  {editChIdx===i
                    ? <div style={{ display:"flex", flexWrap:"wrap", gap:6, flex:1 }}>
                        {COULEURS_PALETTE.map(col=>(
                          <div key={col} className={`cdot ${c.couleur===col?"sel":""}`} style={{ background:col }} onClick={()=>{ updateChantier(i,{couleur:col}); setEditChIdx(null); }}/>
                        ))}
                      </div>
                    : <input className="ti" value={c.nom} onChange={e=>updateChantier(i,{nom:e.target.value.toUpperCase()})} style={{ fontWeight:700 }}/>
                  }
                  {editChIdx!==i
                    ? <button className="btn-d" onClick={()=>removeChantier(i)}>Supprimer</button>
                    : <button className="btn-g" style={{ fontSize:12, padding:"5px 10px" }} onClick={()=>setEditChIdx(null)}>✕</button>
                  }
                </div>
              ))}
              <div style={{ display:"flex", gap:10, marginTop:18, flexWrap:"wrap", alignItems:"center" }}>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {COULEURS_PALETTE.map(c=>(
                    <div key={c} className={`cdot ${newColor===c?"sel":""}`} style={{ background:c }} onClick={()=>setNewColor(c)}/>
                  ))}
                </div>
                <input className="ti" value={newNom} onChange={e=>setNewNom(e.target.value)} placeholder="Nom du chantier…" style={{ flex:1, minWidth:140 }} onKeyDown={e=>e.key==="Enter"&&addChantier()}/>
                <button className="btn-p" onClick={addChantier}>+ Ajouter</button>
              </div>
            </div>
          )}
 
          {adminTab==="apparence" && (
            <div className="ac">
              <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Thème d'affichage</div>
              <div style={{ color:T.textSub, fontSize:13, marginBottom:18 }}>Chaque membre choisit son thème, sauvegardé sur son appareil.</div>
              <div style={{ display:"flex", gap:14 }}>
                {[["dark","🌙","Sombre","#1a1f2e","#e8eaf0"],["light","☀️","Clair","#f0f2f8","#1a1f2e"]].map(([k,ic,lb,bg,col])=>(
                  <div key={k} onClick={()=>{ setTheme(k); localStorage.setItem("theme",k); }}
                    style={{ flex:1, background:bg, border:`3px solid ${theme===k?T.accent:T.border}`, borderRadius:12, padding:"22px 16px", cursor:"pointer", textAlign:"center", transition:"border .15s" }}>
                    <div style={{ fontSize:30, marginBottom:8 }}>{ic}</div>
                    <div style={{ fontSize:14, fontWeight:700, color:col }}>{lb}</div>
                    {theme===k && <div style={{ fontSize:11, color:T.accent, marginTop:6 }}>✓ Actif</div>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop:24, padding:"14px 16px", background:T.card, borderRadius:10, fontSize:13, color:T.textSub, lineHeight:1.6 }}>
                💡 Tu veux modifier autre chose ? Nombre de jours, nom de l'entreprise… Envoie un message à celui qui gère l'outil.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
