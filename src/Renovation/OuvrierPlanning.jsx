import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { ChevronLeft, ChevronRight, CalendarCheck, MapPin, CalendarX, Building2 } from "lucide-react";
import { MobileCard, MobileEmptyState } from "../mobileUI";
import { NavButtons } from "./ouvrierNav";

const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];

export default function OuvrierPlanning({ prenom, T, accent = "#FFC200" }) {
  const now = getCurrentWeek();
  const [year, setYear] = useState(now.year);
  const [week, setWeek] = useState(now.week);
  const [loading, setLoading] = useState(true);
  const [cellsByDay, setCellsByDay] = useState({});
  const [config, setConfig] = useState({ chantiers: DEFAULT_CHANTIERS, adresses: {} });

  const weekId    = getWeekId(year, week);
  const todayJour = getTodayJour();
  const isCurrentWeek = year === now.year && week === now.week;

  const prevWeek = () => { if (week === 1) { setYear(y => y - 1); setWeek(52); } else setWeek(w => w - 1); };
  const nextWeek = () => { if (week >= 52) { setYear(y => y + 1); setWeek(1); } else setWeek(w => w + 1); };
  const goNow    = () => { setYear(now.year); setWeek(now.week); };

  // Lundi + jour du décalage (même calcul ISO que le Planning conducteur).
  const dateDuJour = (dayIndex) => {
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d;
  };
  const fmtJour = (d) => `${d.getDate()} ${MOIS[d.getMonth()]}`;

  // Config chantiers/adresses (une fois)
  useEffect(() => {
    supabase.from("planning_config").select("key,value").in("key", ["chantiers", "chantier_adresses"])
      .then(({ data }) => {
        let chantiers = DEFAULT_CHANTIERS, adresses = {};
        (data || []).forEach(r => {
          if (r.key === "chantiers" && Array.isArray(r.value)) chantiers = r.value;
          if (r.key === "chantier_adresses" && r.value) adresses = r.value;
        });
        setConfig({ chantiers, adresses });
      });
  }, []);

  // Cellules de la semaine (RLS = seulement les miennes)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.from("planning_cells").select("*").eq("week_id", weekId).then(({ data }) => {
      if (cancelled) return;
      const byDay = {};
      (data || []).forEach(cell => {
        const ch = config.chantiers.find(c => c.id === cell.chantier_id);
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
        (byDay[cell.jour] ||= []).push({
          chantier_id: cell.chantier_id,
          nom: ch?.nom || cell.chantier_id,
          couleur: ch?.couleur || "#5b8af5",
          geo: config.adresses[cell.chantier_id] || null,
          taches,
        });
      });
      setCellsByDay(byDay);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekId, config, prenom]);

  const navBtn = {
    width:36, height:36, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center",
    background:T.surface, border:`1px solid ${T.border}`, color:T.textSub, cursor:"pointer", flexShrink:0,
  };
  const hasAny = JOURS.some(j => (cellsByDay[j] || []).length > 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Navigation semaine */}
      <MobileCard T={T} style={{ padding:"12px 14px", display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={prevWeek} style={navBtn}><Icon as={ChevronLeft} size={18}/></button>
        <div style={{ flex:1, textAlign:"center", minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted }}>Semaine {week}</div>
          <div style={{ fontSize:15, fontWeight:800, color:T.text }}>
            {fmtJour(dateDuJour(0))} – {fmtJour(dateDuJour(4))}
          </div>
        </div>
        <button onClick={nextWeek} style={navBtn}><Icon as={ChevronRight} size={18}/></button>
      </MobileCard>

      {!isCurrentWeek && (
        <button onClick={goNow} style={{
          alignSelf:"center", display:"inline-flex", alignItems:"center", gap:6,
          background:`${accent}22`, color:"#1a1f2e", border:`1px solid ${accent}`,
          borderRadius:999, padding:"7px 16px", fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer",
        }}>
          <Icon as={CalendarCheck} size={14}/>
          Revenir à cette semaine
        </button>
      )}

      {loading ? (
        <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
      ) : !hasAny ? (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={CalendarX} title="Aucune affectation cette semaine"
            hint="Rien ne t'est planifié sur cette semaine. Utilise les flèches pour voir les autres semaines." />
        </MobileCard>
      ) : (
        JOURS.map((jour, idx) => {
          const dayCells = cellsByDay[jour] || [];
          if (!dayCells.length) return null;
          const estAujourdhui = isCurrentWeek && jour === todayJour;
          return (
            <div key={jour} style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"2px 4px" }}>
                <span style={{ fontSize:14, fontWeight:800, color:estAujourdhui ? accent : T.text, letterSpacing:-0.2 }}>
                  {jour}
                </span>
                <span style={{ fontSize:12.5, color:T.textMuted, fontWeight:600 }}>{fmtJour(dateDuJour(idx))}</span>
                {estAujourdhui && (
                  <span style={{ fontSize:10.5, fontWeight:800, letterSpacing:0.4, textTransform:"uppercase",
                    color:"#1a1f2e", background:accent, borderRadius:999, padding:"2px 8px" }}>Aujourd'hui</span>
                )}
              </div>
              {dayCells.map((c, i) => (
                <MobileCard key={`${c.chantier_id}_${i}`} T={T} accent={c.couleur} style={{ padding:"13px 15px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:c.geo?.adresse ? 6 : 10 }}>
                    <Icon as={Building2} size={15} color={c.couleur} strokeWidth={2.3}/>
                    <span style={{ fontSize:16, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>{c.nom}</span>
                  </div>
                  {c.geo?.adresse && (
                    <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
                      <Icon as={MapPin} size={13} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                      <span style={{ fontSize:13, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                    </div>
                  )}
                  <div style={{ marginBottom: c.taches.length ? 12 : 0 }}><NavButtons geo={c.geo}/></div>
                  {c.taches.length > 0 && (
                    <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
                      {c.taches.map((t, j) => (
                        <li key={j} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:13.5, color:T.text, lineHeight:1.4 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background:c.couleur, marginTop:6, flexShrink:0 }}/>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </MobileCard>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
