import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// 🔧 REMPLACE CES DEUX VALEURS PAR LES TIENNES (voir guide étape 2)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "COLLE_TON_URL_ICI";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "COLLE_TA_CLE_ICI";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
const OUVRIERS_DEFAULT = ["JP", "Stev", "Kev", "Reza", "Hamed", "Mady", "Yann", "Julien", "Steven"];

const COULEURS = ["#c8d8f0","#ffd6cc","#fce4a0","#d4edda","#d1f7e4","#e8d0e8","#fff0c0","#ffd6e7","#d0e8ff","#e0f0e0"];

const CHANTIERS_DEFAULT = [
  { id: "lamartine", nom: "LAMARTINE", couleur: "#c8d8f0" },
  { id: "lou", nom: "LOU", couleur: "#ffd6cc" },
  { id: "philibert", nom: "PHILIBERT", couleur: "#fce4a0" },
  { id: "arthur", nom: "ARTHUR", couleur: "#d4edda" },
  { id: "metois", nom: "METOIS", couleur: "#d1f7e4" },
  { id: "gildas", nom: "GILDAS BAUGE 2", couleur: "#e8d0e8" },
];

function getWeekId(year, week) { return `${year}-W${String(week).padStart(2, "0")}`; }

function getCurrentWeek() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return { year: now.getFullYear(), week };
}

function emptyCell() { return { planifie: "", reel: "", ouvriers: [] }; }

export default function App() {
  const { year: initY, week: initW } = getCurrentWeek();
  const [year, setYear] = useState(initY);
  const [week, setWeek] = useState(initW);
  const [chantiers, setChantiers] = useState(CHANTIERS_DEFAULT);
  const [cells, setCells] = useState({}); // { "chantierId_jour": {planifie, reel, ouvriers} }
  const [commandes, setCommandes] = useState({}); // { chantierId: string }
  const [view, setView] = useState("planifie");
  const [editCell, setEditCell] = useState(null);
  const [editCommande, setEditCommande] = useState(null);
  const [showAddChantier, setShowAddChantier] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newColor, setNewColor] = useState(COULEURS[6]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [connected, setConnected] = useState(false);

  const weekId = getWeekId(year, week);

  // ─── LOAD DATA FROM SUPABASE ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      // Load cells
      const { data: cellsData } = await supabase
        .from("planning_cells")
        .select("*")
        .eq("week_id", weekId);

      if (cellsData) {
        const map = {};
        cellsData.forEach(row => {
          map[`${row.chantier_id}_${row.jour}`] = {
            planifie: row.planifie || "",
            reel: row.reel || "",
            ouvriers: row.ouvriers || [],
          };
        });
        setCells(map);
      }

      // Load commandes
      const { data: commandesData } = await supabase
        .from("planning_commandes")
        .select("*")
        .eq("week_id", weekId);

      if (commandesData) {
        const map = {};
        commandesData.forEach(row => { map[row.chantier_id] = row.contenu || ""; });
        setCommandes(map);
      }

      // Load custom chantiers
      const { data: chantiersData } = await supabase
        .from("planning_chantiers")
        .select("*")
        .order("created_at", { ascending: true });

      if (chantiersData && chantiersData.length > 0) {
        setChantiers(chantiersData.map(c => ({ id: c.id, nom: c.nom, couleur: c.couleur })));
      }

      setConnected(true);
      setLastSync(new Date());
    } catch (e) {
      console.error(e);
    }
    setSyncing(false);
  }, [weekId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── REAL-TIME SUBSCRIPTIONS ──────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`planning-${weekId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_cells", filter: `week_id=eq.${weekId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row) return;
          const key = `${row.chantier_id}_${row.jour}`;
          if (payload.eventType === "DELETE") {
            setCells(prev => { const n = {...prev}; delete n[key]; return n; });
          } else {
            setCells(prev => ({ ...prev, [key]: { planifie: row.planifie || "", reel: row.reel || "", ouvriers: row.ouvriers || [] } }));
          }
          setLastSync(new Date());
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_commandes", filter: `week_id=eq.${weekId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row) return;
          if (payload.eventType === "DELETE") {
            setCommandes(prev => { const n = {...prev}; delete n[row.chantier_id]; return n; });
          } else {
            setCommandes(prev => ({ ...prev, [row.chantier_id]: row.contenu || "" }));
          }
          setLastSync(new Date());
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [weekId]);

  // ─── SAVE CELL ────────────────────────────────────────────────────────────
  const saveCell = async (chantierId, jour, field, value) => {
    const key = `${chantierId}_${jour}`;
    const current = cells[key] || emptyCell();
    const updated = { ...current, [field]: value };
    setCells(prev => ({ ...prev, [key]: updated }));

    await supabase.from("planning_cells").upsert({
      week_id: weekId,
      chantier_id: chantierId,
      jour,
      planifie: updated.planifie,
      reel: updated.reel,
      ouvriers: updated.ouvriers,
    }, { onConflict: "week_id,chantier_id,jour" });
  };

  const toggleOuvrier = async (chantierId, jour, ouvrier) => {
    const key = `${chantierId}_${jour}`;
    const current = cells[key] || emptyCell();
    const list = [...(current.ouvriers || [])];
    const idx = list.indexOf(ouvrier);
    if (idx >= 0) list.splice(idx, 1); else list.push(ouvrier);
    await saveCell(chantierId, jour, "ouvriers", list);
  };

  const saveCommande = async (chantierId, value) => {
    setCommandes(prev => ({ ...prev, [chantierId]: value }));
    await supabase.from("planning_commandes").upsert({
      week_id: weekId,
      chantier_id: chantierId,
      contenu: value,
    }, { onConflict: "week_id,chantier_id" });
  };

  const addChantier = async () => {
    if (!newNom.trim()) return;
    const id = newNom.trim().toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const nc = { id, nom: newNom.trim().toUpperCase(), couleur: newColor };
    const { error } = await supabase.from("planning_chantiers").insert({ id, nom: nc.nom, couleur: nc.couleur });
    if (!error) { setChantiers(prev => [...prev, nc]); }
    setNewNom(""); setShowAddChantier(false);
  };

  // ─── NAV ──────────────────────────────────────────────────────────────────
  const prevWeek = () => { if (week === 1) { setYear(y=>y-1); setWeek(52); } else setWeek(w=>w-1); };
  const nextWeek = () => { if (week === 52) { setYear(y=>y+1); setWeek(1); } else setWeek(w=>w+1); };
  const goNow = () => { const {year:y, week:w} = getCurrentWeek(); setYear(y); setWeek(w); };

  const getCell = (cId, jour) => cells[`${cId}_${jour}`] || emptyCell();
  const isEditing = (cId, jour) => editCell?.cId === cId && editCell?.jour === jour;

  return (
    <div style={{ fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif", background: "#1a1f2e", minHeight: "100vh", color: "#e8eaf0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #1a1f2e; }
        ::-webkit-scrollbar-thumb { background: #3a4060; border-radius: 3px; }
        textarea, input { outline: none; font-family: inherit; }
        .cell { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 8px 10px; min-height: 64px; cursor: pointer; transition: all 0.15s; }
        .cell:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); }
        .cell.filled { background: rgba(255,255,255,0.06); }
        .cell.editing { background: rgba(255,255,255,0.1); border-color: #5b8af5; box-shadow: 0 0 0 2px rgba(91,138,245,0.2); }
        .badge { display: inline-block; background: rgba(91,138,245,0.25); color: #a0b8ff; border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 600; margin: 1px 2px 1px 0; }
        .badge.reel { background: rgba(80,200,120,0.2); color: #7ee8a2; }
        .tab { padding: 8px 20px; border: none; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; letter-spacing: 0.5px; text-transform: uppercase; transition: all 0.15s; }
        .tab.on { background: #5b8af5; color: #fff; }
        .tab.off { background: rgba(255,255,255,0.07); color: #9aa5c0; }
        .tab.off:hover { background: rgba(255,255,255,0.12); color: #e8eaf0; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: #252a3d; border-radius: 12px; padding: 28px; width: 480px; max-width: 95vw; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
        .btn-p { background: #5b8af5; color: #fff; border: none; border-radius: 6px; padding: 9px 18px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
        .btn-p:hover { background: #4a76e8; }
        .btn-g { background: transparent; color: #9aa5c0; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 16px; font-family: inherit; font-size: 13px; cursor: pointer; }
        .btn-g:hover { background: rgba(255,255,255,0.07); color: #e8eaf0; }
        .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.5; margin-bottom: 2px; }
        .ouvbtn { display: inline-block; padding: 4px 10px; border-radius: 5px; font-size: 12px; font-weight: 600; cursor: pointer; margin: 3px 3px 3px 0; border: 1.5px solid rgba(255,255,255,0.15); background: transparent; color: #9aa5c0; font-family: inherit; transition: all 0.12s; }
        .ouvbtn.on { background: rgba(91,138,245,0.3); border-color: #5b8af5; color: #a0b8ff; }
        .ouvbtn:hover { border-color: rgba(255,255,255,0.3); color: #e8eaf0; }
        .navbtn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); color: #e8eaf0; border-radius: 6px; padding: 6px 14px; font-family: inherit; font-size: 18px; cursor: pointer; transition: background 0.15s; }
        .navbtn:hover { background: rgba(255,255,255,0.14); }
        .dot-pulse { width: 8px; height: 8px; border-radius: 50%; background: #50c878; display: inline-block; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        textarea.inp { width: 100%; background: transparent; border: none; color: #e8eaf0; font-size: 13px; line-height: 1.5; resize: none; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#1e2336", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#5b6a8a", marginBottom: 2 }}>Planning Chantier</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>SEMAINE {week} — {year}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="navbtn" onClick={prevWeek}>‹</button>
          <button className="navbtn" onClick={goNow} style={{ fontSize: 12, padding: "6px 12px", letterSpacing: 1 }}>CETTE SEMAINE</button>
          <button className="navbtn" onClick={nextWeek}>›</button>
        </div>

        {/* Sync status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 12, color: "#7a8aaa" }}>
          {syncing
            ? <><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f5a623", display: "inline-block" }} />Sync...</>
            : connected
              ? <><div className="dot-pulse" />En ligne {lastSync ? `· ${lastSync.toLocaleTimeString("fr-FR", {hour:"2-digit",minute:"2-digit"})}` : ""}</>
              : <><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e05c5c", display: "inline-block" }} />Hors ligne</>
          }
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className={`tab ${view === "planifie" ? "on" : "off"}`} onClick={() => setView("planifie")}>Planifié</button>
          <button className={`tab ${view === "reel" ? "on" : "off"}`} onClick={() => setView("reel")}>Réel</button>
          <button className={`tab ${view === "compare" ? "on" : "off"}`} onClick={() => setView("compare")}>Bilan</button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* TABLE */}
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {/* Days header */}
          <div style={{ display: "grid", gridTemplateColumns: "140px repeat(5, minmax(140px, 1fr))", gap: 5, marginBottom: 6 }}>
            <div />
            {JOURS.map(j => (
              <div key={j} style={{ textAlign: "center", fontWeight: 800, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#5b6a8a", padding: "6px 0" }}>{j}</div>
            ))}
          </div>

          {chantiers.map(chantier => (
            <div key={chantier.id} style={{ display: "grid", gridTemplateColumns: "140px repeat(5, minmax(140px, 1fr))", gap: 5, marginBottom: 5 }}>
              {/* Label chantier */}
              <div
                style={{ background: chantier.couleur, color: "#1a1f2e", borderRadius: "8px 0 0 8px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontWeight: 800, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", padding: "10px 8px", cursor: "pointer" }}
                onClick={() => setEditCommande(editCommande === chantier.id ? null : chantier.id)}
                title="Cliquer pour commandes"
              >
                {commandes[chantier.id]?.trim() && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f5a623", display: "inline-block", marginRight: 6, flexShrink: 0 }} />}
                {chantier.nom}
              </div>

              {JOURS.map(jour => {
                const cell = getCell(chantier.id, jour);
                const editing = isEditing(chantier.id, jour);
                const filled = cell.planifie || cell.reel || cell.ouvriers?.length > 0;

                return (
                  <div key={jour} className={`cell ${filled ? "filled" : ""} ${editing ? "editing" : ""}`} onClick={() => !editing && setEditCell({ cId: chantier.id, jour })}>
                    {editing ? (
                      <div onClick={e => e.stopPropagation()}>
                        {(view !== "reel") && <>
                          <div className="lbl" style={{ color: "#5b8af5" }}>Planifié</div>
                          <textarea className="inp" autoFocus={view === "planifie"} rows={3} value={cell.planifie} onChange={e => saveCell(chantier.id, jour, "planifie", e.target.value)} placeholder="Tâches prévues…" />
                        </>}
                        {(view !== "planifie") && <>
                          <div className="lbl" style={{ color: "#50c878", marginTop: view === "compare" ? 6 : 0 }}>Réel</div>
                          <textarea className="inp" autoFocus={view === "reel"} rows={3} value={cell.reel} onChange={e => saveCell(chantier.id, jour, "reel", e.target.value)} placeholder="Ce qui a été fait…" style={{ color: "#b0f0c0" }} />
                        </>}
                        <div style={{ marginTop: 8 }}>
                          <div className="lbl">Ouvriers</div>
                          <div style={{ marginTop: 4 }}>
                            {OUVRIERS_DEFAULT.map(o => (
                              <button key={o} className={`ouvbtn ${(cell.ouvriers||[]).includes(o) ? "on" : ""}`} onClick={() => toggleOuvrier(chantier.id, jour, o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div style={{ marginTop: 10, textAlign: "right" }}>
                          <button className="btn-p" style={{ fontSize: 12, padding: "5px 14px" }} onClick={() => setEditCell(null)}>✓ Fermer</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {view === "compare" ? <>
                          {cell.planifie && <><div className="lbl">Planifié</div><div style={{ fontSize: 12, color: "#a0b8ff", lineHeight: 1.5 }}>{cell.planifie}</div></>}
                          {cell.reel && <><div className="lbl" style={{ marginTop: cell.planifie ? 4 : 0 }}>Réel</div><div style={{ fontSize: 12, color: "#7ee8a2", lineHeight: 1.5 }}>{cell.reel}</div></>}
                          {!cell.planifie && !cell.reel && <div style={{ color: "#3a4060", fontSize: 13 }}>—</div>}
                        </> : <>
                          <div style={{ fontSize: 13, lineHeight: 1.5, color: view === "reel" ? "#b0f0c0" : "#d0d8f0" }}>
                            {cell[view] || <span style={{ color: "#3a4060" }}>—</span>}
                          </div>
                        </>}
                        {cell.ouvriers?.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {cell.ouvriers.map(o => <span key={o} className={`badge ${view === "reel" ? "reel" : ""}`}>{o}</span>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <button className="btn-g" style={{ marginTop: 8, fontSize: 13 }} onClick={() => setShowAddChantier(true)}>+ Ajouter un chantier</button>
        </div>

        {/* SIDEBAR COMMANDES */}
        <div style={{ width: 230, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#5b6a8a", marginBottom: 10 }}>Commandes à prévoir</div>
          {chantiers.map(chantier => (
            <div key={chantier.id} style={{ marginBottom: 10 }}>
              <div
                style={{ background: chantier.couleur, color: "#1a1f2e", borderRadius: "6px 6px 0 0", padding: "6px 10px", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                onClick={() => setEditCommande(editCommande === chantier.id ? null : chantier.id)}
              >
                {chantier.nom} <span style={{ opacity: 0.5 }}>{editCommande === chantier.id ? "▲" : "▼"}</span>
              </div>
              {editCommande === chantier.id
                ? <textarea rows={4} style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "none", borderRadius: "0 0 6px 6px", color: "#f5d08a", padding: "8px 10px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }} value={commandes[chantier.id] || ""} onChange={e => saveCommande(chantier.id, e.target.value)} placeholder="Matériaux, livraisons…" autoFocus />
                : commandes[chantier.id]?.trim()
                  ? <div style={{ background: "rgba(245,208,138,0.08)", border: "1px solid rgba(245,208,138,0.15)", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "6px 10px", fontSize: 12, color: "#f5d08a", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{commandes[chantier.id]}</div>
                  : <div onClick={() => setEditCommande(chantier.id)} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "6px 10px", fontSize: 12, color: "#3a4060", cursor: "pointer" }}>Cliquer pour ajouter</div>
              }
            </div>
          ))}
        </div>
      </div>

      {/* MODAL NOUVEAU CHANTIER */}
      {showAddChantier && (
        <div className="modal-bg" onClick={() => setShowAddChantier(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 20, letterSpacing: 1 }}>NOUVEAU CHANTIER</div>
            <div style={{ marginBottom: 16 }}>
              <div className="lbl" style={{ marginBottom: 6, opacity: 0.7 }}>Nom</div>
              <input style={{ width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "10px 12px", color: "#e8eaf0", fontSize: 15 }} value={newNom} onChange={e => setNewNom(e.target.value)} placeholder="Ex: DUPONT GARAGE" autoFocus onKeyDown={e => e.key === "Enter" && addChantier()} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div className="lbl" style={{ marginBottom: 8, opacity: 0.7 }}>Couleur</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {COULEURS.map(c => (
                  <div key={c} onClick={() => setNewColor(c)} style={{ width: 28, height: 28, borderRadius: 6, background: c, cursor: "pointer", border: newColor === c ? "3px solid #5b8af5" : "2px solid transparent" }} />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-g" onClick={() => setShowAddChantier(false)}>Annuler</button>
              <button className="btn-p" onClick={addChantier}>Ajouter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
