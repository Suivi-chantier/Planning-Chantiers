import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { MapPin, CalendarX, Building2, CalendarDays, Users } from "lucide-react";
import { MobileCard, MobileEmptyState, MobileTabs } from "../mobileUI";
import { NavButtons } from "./ouvrierNav";

const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const ABBR = { Lundi:"Lun", Mardi:"Mar", Mercredi:"Mer", Jeudi:"Jeu", Vendredi:"Ven" };

// Semaine à afficher : la semaine en cours, sauf vendredi/samedi/dimanche
// où on bascule sur la semaine suivante (le vendredi on prépare la suite).
function semaineCible() {
  const jsDay = new Date().getDay(); // 0=dim, 5=ven, 6=sam
  const showNext = jsDay === 0 || jsDay === 5 || jsDay === 6;
  const cur = getCurrentWeek();
  let year = cur.year, week = cur.week;
  if (showNext) { if (week >= 52) { year += 1; week = 1; } else week += 1; }
  return { year, week, showNext };
}

export default function OuvrierPlanning({ prenom, T, accent = "#FFC200" }) {
  const { year, week, showNext } = semaineCible();
  const weekId    = getWeekId(year, week);
  const todayJour = getTodayJour();

  const [loading, setLoading]     = useState(true);
  const [cellsByDay, setCellsByDay] = useState({});
  const [config, setConfig]       = useState({ chantiers: DEFAULT_CHANTIERS, adresses: {} });
  // Jour sélectionné : aujourd'hui si semaine en cours, sinon lundi (semaine suivante).
  const [jour, setJour] = useState(showNext ? "Lundi" : (todayJour || "Lundi"));

  // Lundi + décalage (même calcul ISO que le Planning conducteur).
  const dateDuJour = (dayIndex) => {
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d;
  };
  const fmtJour = (d) => `${d.getDate()} ${MOIS[d.getMonth()]}`;

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
        // Collègues présents sur ce chantier ce jour-là (niveau cellule + tâches), sauf moi.
        const equipe = new Set(cell.ouvriers || []);
        (cell.taches || []).forEach(t => (t.ouvriers || []).forEach(o => equipe.add(o)));
        const collegues = [...equipe].filter(n => n && n !== prenom);
        (byDay[cell.jour] ||= []).push({
          chantier_id: cell.chantier_id,
          nom: ch?.nom || cell.chantier_id,
          couleur: ch?.couleur || "#5b8af5",
          geo: config.adresses[cell.chantier_id] || null,
          taches,
          collegues,
        });
      });
      setCellsByDay(byDay);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekId, config, prenom]);

  const dayCells = cellsByDay[jour] || [];
  const jourIdx  = JOURS.indexOf(jour);
  const tabs = JOURS.map(j => {
    const n = (cellsByDay[j] || []).length;
    return { id: j, label: ABBR[j], count: n > 0 ? n : null };
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Bandeau semaine */}
      <MobileCard T={T} accent={accent} style={{ padding:"11px 14px", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{
          width:38, height:38, borderRadius:12, flexShrink:0,
          background:`linear-gradient(135deg, ${accent}, ${accent}c0)`, color:"#1a1f2e",
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Icon as={CalendarDays} size={19} strokeWidth={2.3}/>
        </div>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted }}>
            {showNext ? "Semaine prochaine" : "Cette semaine"}
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:T.text }}>
            {fmtJour(dateDuJour(0))} – {fmtJour(dateDuJour(4))}
          </div>
        </div>
      </MobileCard>

      {/* Sélecteur de jour */}
      <MobileTabs tabs={tabs} value={jour} onChange={setJour} accent={accent} onAccent="#1a1f2e" T={T}/>

      {/* Contenu du jour sélectionné */}
      {loading ? (
        <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
      ) : dayCells.length === 0 ? (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={CalendarX}
            title={`Rien de prévu le ${jour.toLowerCase()}`}
            hint="Aucun chantier ne t'est affecté ce jour-là." />
        </MobileCard>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:13, fontWeight:700, color:T.textSub, padding:"0 4px" }}>
            {jour} {fmtJour(dateDuJour(jourIdx))} · {dayCells.length} chantier{dayCells.length > 1 ? "s" : ""}
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
              {/* Collègues sur ce chantier */}
              <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:10 }}>
                <Icon as={Users} size={14} color={T.textMuted} strokeWidth={2.2}/>
                {c.collegues.length > 0 ? (
                  c.collegues.map(n => (
                    <span key={n} style={{
                      background:c.couleur+"22", color:T.text, border:`1px solid ${c.couleur}55`,
                      borderRadius:999, padding:"2px 10px", fontSize:12.5, fontWeight:700,
                    }}>{n}</span>
                  ))
                ) : (
                  <span style={{ fontSize:12.5, color:T.textMuted, fontStyle:"italic" }}>Seul sur ce chantier</span>
                )}
              </div>
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
      )}
    </div>
  );
}
