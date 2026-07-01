import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { MapPin, ClipboardList, ChevronRight, CheckCircle2, CalendarX, Navigation } from "lucide-react";

// Lien carte universel (Google Maps ouvre l'app native sur mobile).
function gpsUrl(geo) {
  if (!geo) return null;
  const q = (geo.lat != null && geo.lon != null) ? `${geo.lat},${geo.lon}` : geo.adresse;
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default function OuvrierDashboard({ prenom, T, onGoCompteRendu }) {
  const [loading, setLoading]           = useState(true);
  const [chantiersJour, setChantiersJour] = useState([]);
  const [crRendu, setCrRendu]           = useState(false);

  const today    = new Date();
  const dateKey  = today.toLocaleDateString("fr-FR");
  const dateLong = today.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
  const { year, week } = getCurrentWeek();
  const weekId   = getWeekId(year, week);
  const todayJour = getTodayJour();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Config : chantiers (nom/couleur) + adresses (GPS)
      const { data: cfg } = await supabase
        .from("planning_config").select("key,value").in("key", ["chantiers", "chantier_adresses"]);
      let chantiersData = DEFAULT_CHANTIERS, adresses = {};
      (cfg || []).forEach(r => {
        if (r.key === "chantiers" && Array.isArray(r.value)) chantiersData = r.value;
        if (r.key === "chantier_adresses" && r.value) adresses = r.value;
      });

      // Cellules planning — la RLS ne renvoie QUE celles de l'ouvrier connecté.
      const { data: cells } = await supabase
        .from("planning_cells").select("*").eq("week_id", weekId);

      const groups = [];
      (cells || []).filter(c => c.jour === todayJour).forEach(cell => {
        const ch = chantiersData.find(c => c.id === cell.chantier_id);
        const taches = [];
        if (Array.isArray(cell.taches) && cell.taches.length) {
          cell.taches.forEach(t => {
            if (!t.text?.trim()) return;
            const pourTout = !t.ouvriers || t.ouvriers.length === 0;
            const pourMoi  = (t.ouvriers || []).includes(prenom);
            if (pourTout || pourMoi) taches.push(t.text.trim());
          });
        } else if (cell.planifie?.trim()) {
          cell.planifie.split("\n").filter(l => l.trim()).forEach(l => taches.push(l.trim()));
        }
        groups.push({
          chantier_id: cell.chantier_id,
          nom: ch?.nom || cell.chantier_id,
          couleur: ch?.couleur || "#c8d8f0",
          geo: adresses[cell.chantier_id] || null,
          taches,
        });
      });

      // Compte rendu du jour déjà rendu ? (RLS = seulement les miens)
      const { data: raps } = await supabase
        .from("rapports").select("id").eq("date_rapport", dateKey).limit(1);

      if (cancelled) return;
      setChantiersJour(groups);
      setCrRendu((raps || []).length > 0);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [weekId, todayJour, dateKey, prenom]);

  const card = {
    background:T.card, borderRadius:RADIUS.xl, padding:"16px",
    margin:"12px 16px", border:`1px solid ${T.border}`, boxShadow:"0 2px 8px rgba(0,0,0,0.05)",
  };

  if (loading) return (
    <div style={{ padding:"48px 24px", textAlign:"center", color:T.textMuted, fontSize:FONT.sm.size, letterSpacing:2 }}>
      CHARGEMENT…
    </div>
  );

  return (
    <div>
      {/* Bandeau date + statut CR */}
      <div style={{ ...card, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div style={{ textTransform:"capitalize", fontSize:FONT.md.size, fontWeight:700, color:T.text }}>{dateLong}</div>
        <span style={{
          display:"inline-flex", alignItems:"center", gap:5, whiteSpace:"nowrap",
          borderRadius:RADIUS.md, padding:"4px 10px", fontSize:FONT.sm.size, fontWeight:700,
          background: crRendu ? "rgba(34,197,94,0.12)" : "rgba(245,166,35,0.14)",
          color: crRendu ? "#16a34a" : "#b88800",
        }}>
          <Icon as={crRendu ? CheckCircle2 : ClipboardList} size={13} strokeWidth={2.2}/>
          {crRendu ? "CR rendu" : "CR à faire"}
        </span>
      </div>

      {/* Aucun chantier / week-end */}
      {chantiersJour.length === 0 ? (
        <div style={{ ...card, textAlign:"center", padding:"36px 24px", color:T.textMuted }}>
          <Icon as={CalendarX} size={34} strokeWidth={1.6} style={{ marginBottom:10, opacity:0.7 }}/>
          <div style={{ fontSize:FONT.md.size, fontWeight:700, color:T.text, marginBottom:4 }}>
            {todayJour ? "Aucun chantier prévu aujourd'hui" : "Pas de planning aujourd'hui"}
          </div>
          <div style={{ fontSize:FONT.sm.size, lineHeight:1.5 }}>
            {todayJour ? "Rien ne t'est affecté pour aujourd'hui." : "On est le week-end — repose-toi !"}
          </div>
        </div>
      ) : (
        chantiersJour.map((c, i) => {
          const url = gpsUrl(c.geo);
          return (
            <div key={`${c.chantier_id}_${i}`} style={{ ...card, padding:0, overflow:"hidden" }}>
              <div style={{ height:6, background:c.couleur }}/>
              <div style={{ padding:"14px 16px" }}>
                <div style={{ fontSize:FONT.lg.size, fontWeight:800, color:T.text, letterSpacing:-0.2, marginBottom:6 }}>
                  {c.nom}
                </div>
                {c.geo?.adresse && (
                  <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:12 }}>
                    <Icon as={MapPin} size={14} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                    <span style={{ fontSize:FONT.sm.size+1, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                  </div>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{
                    display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none",
                    background:`${T.info}14`, color:T.info, border:`1px solid ${T.info}40`,
                    borderRadius:RADIUS.md, padding:"8px 14px", fontSize:FONT.sm.size+1, fontWeight:700, marginBottom:12,
                  }}>
                    <Icon as={Navigation} size={13} strokeWidth={2.2}/>
                    Y aller (GPS)
                  </a>
                )}
                {c.taches.length > 0 ? (
                  <div>
                    <div style={{ fontSize:FONT.xs.size, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                      Tâches prévues
                    </div>
                    <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:7 }}>
                      {c.taches.map((t, j) => (
                        <li key={j} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:FONT.base.size, color:T.text, lineHeight:1.4 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background:c.couleur, marginTop:7, flexShrink:0 }}/>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div style={{ fontSize:FONT.sm.size, color:T.textMuted, fontStyle:"italic" }}>Aucune tâche détaillée pour ce chantier.</div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Gros bouton compte rendu */}
      <div style={{ padding:"4px 16px 20px" }}>
        <button onClick={onGoCompteRendu} style={{
          width:"100%", padding:"16px", border:"none", borderRadius:RADIUS.xl,
          background:T.accent, color:T.accentText, fontFamily:"inherit",
          fontSize:FONT.md.size+1, fontWeight:800, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          boxShadow:`0 4px 16px ${T.accent}40`,
        }}>
          <Icon as={ClipboardList} size={18} strokeWidth={2.3}/>
          Faire mon compte rendu
          <Icon as={ChevronRight} size={18} strokeWidth={2.5}/>
        </button>
      </div>
    </div>
  );
}
