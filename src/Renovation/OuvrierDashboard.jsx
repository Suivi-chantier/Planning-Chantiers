import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { MapPin, ClipboardList, ChevronRight, CheckCircle2, CalendarX, Navigation, Building2 } from "lucide-react";
import { MobileCard, MobileEmptyState, Pill } from "../mobileUI";

// Lien carte universel (Google Maps ouvre l'app native sur mobile).
function gpsUrl(geo) {
  if (!geo) return null;
  const q = (geo.lat != null && geo.lon != null) ? `${geo.lat},${geo.lon}` : geo.adresse;
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default function OuvrierDashboard({ prenom, T, accent = "#FFC200", onGoCompteRendu }) {
  const [loading, setLoading]             = useState(true);
  const [chantiersJour, setChantiersJour] = useState([]);
  const [crRendu, setCrRendu]             = useState(false);

  const today    = new Date();
  const dateKey  = today.toLocaleDateString("fr-FR");
  const { year, week } = getCurrentWeek();
  const weekId    = getWeekId(year, week);
  const todayJour = getTodayJour();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data: cfg } = await supabase
        .from("planning_config").select("key,value").in("key", ["chantiers", "chantier_adresses"]);
      let chantiersData = DEFAULT_CHANTIERS, adresses = {};
      (cfg || []).forEach(r => {
        if (r.key === "chantiers" && Array.isArray(r.value)) chantiersData = r.value;
        if (r.key === "chantier_adresses" && r.value) adresses = r.value;
      });

      // La RLS ne renvoie QUE les cellules de l'ouvrier connecté.
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
          couleur: ch?.couleur || "#5b8af5",
          geo: adresses[cell.chantier_id] || null,
          taches,
        });
      });

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

  if (loading) return (
    <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>
      CHARGEMENT…
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Résumé du jour */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <Pill color={accent} solid={false}>
          <Icon as={Building2} size={13} strokeWidth={2.2}/>
          {chantiersJour.length} chantier{chantiersJour.length > 1 ? "s" : ""}
        </Pill>
        <Pill color={crRendu ? "#22c55e" : "#f59e0b"}>
          <Icon as={crRendu ? CheckCircle2 : ClipboardList} size={13} strokeWidth={2.2}/>
          {crRendu ? "CR rendu" : "CR à faire"}
        </Pill>
      </div>

      {/* Chantiers du jour */}
      {chantiersJour.length === 0 ? (
        <MobileCard T={T}>
          <MobileEmptyState
            T={T}
            icon={CalendarX}
            title={todayJour ? "Aucun chantier aujourd'hui" : "Pas de planning aujourd'hui"}
            hint={todayJour ? "Rien ne t'est affecté pour aujourd'hui." : "On est le week-end — repose-toi !"}
          />
        </MobileCard>
      ) : (
        chantiersJour.map((c, i) => {
          const url = gpsUrl(c.geo);
          return (
            <MobileCard key={`${c.chantier_id}_${i}`} T={T} accent={c.couleur} style={{ padding:"14px 16px" }}>
              <div style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.2, marginBottom:c.geo?.adresse ? 6 : 12 }}>
                {c.nom}
              </div>
              {c.geo?.adresse && (
                <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:12 }}>
                  <Icon as={MapPin} size={14} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                  <span style={{ fontSize:13.5, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                </div>
              )}
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" style={{
                  display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none",
                  background:"#5b8af514", color:"#5b8af5", border:"1px solid #5b8af540",
                  borderRadius:12, padding:"8px 14px", fontSize:13.5, fontWeight:700, marginBottom:12,
                }}>
                  <Icon as={Navigation} size={13} strokeWidth={2.2}/>
                  Y aller (GPS)
                </a>
              )}
              {c.taches.length > 0 ? (
                <div>
                  <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                    Tâches prévues
                  </div>
                  <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:7 }}>
                    {c.taches.map((t, j) => (
                      <li key={j} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:14, color:T.text, lineHeight:1.4 }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:c.couleur, marginTop:7, flexShrink:0 }}/>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic" }}>Aucune tâche détaillée pour ce chantier.</div>
              )}
            </MobileCard>
          );
        })
      )}

      {/* Gros bouton compte rendu */}
      <button onClick={onGoCompteRendu} style={{
        width:"100%", padding:"16px", border:"none", borderRadius:16,
        background:`linear-gradient(135deg, ${accent}, ${accent}cc)`, color:"#1a1f2e", fontFamily:"inherit",
        fontSize:17, fontWeight:800, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        boxShadow:`0 6px 18px ${accent}55`,
      }}>
        <Icon as={ClipboardList} size={18} strokeWidth={2.3}/>
        Faire mon compte rendu
        <Icon as={ChevronRight} size={18} strokeWidth={2.5}/>
      </button>
    </div>
  );
}
