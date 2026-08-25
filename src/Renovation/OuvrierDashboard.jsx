import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { MapPin, ClipboardList, CheckCircle2, CalendarX, Building2, Clock, Users, RotateCcw } from "lucide-react";
import { MobileStat, MobileSection, MobileCard, MobileEmptyState } from "../mobileUI";
import { NavButtons } from "./ouvrierNav";

// Statut dérivé de l'avancement du phasage (les tâches n'ont pas de champ
// statut : 100 % ⟺ terminé, cohérence garantie par construction).
const statutAvancement = (av) =>
  av > 0 ? { label: "En cours", color: "#e0a800" } : { label: "Non commencée", color: "#8a9ab0" };

const fmtJJMM = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export default function OuvrierDashboard({ prenom, T, accent = "#FFC200" }) {
  const [loading, setLoading]             = useState(true);
  const [chantiersJour, setChantiersJour] = useState([]);
  const [aReprendre, setAReprendre]       = useState([]);
  const [crRendu, setCrRendu]             = useState(false);

  const today    = new Date();
  const dateKey  = today.toLocaleDateString("fr-FR");
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
      // Tâches du phasage déjà posées AUJOURD'HUI dans le planning : elles
      // sont dans « Aujourd'hui », on ne les remontre pas dans « À reprendre ».
      const tacheIdsDuJour = new Set();
      (cells || []).filter(c => c.jour === todayJour).forEach(cell => {
        const ch = chantiersData.find(c => c.id === cell.chantier_id);
        const taches = [];
        if (Array.isArray(cell.taches) && cell.taches.length) {
          cell.taches.forEach(t => {
            if (!t.text?.trim()) return;
            const pourTout = !t.ouvriers || t.ouvriers.length === 0;
            const pourMoi  = (t.ouvriers || []).includes(prenom);
            if (pourTout || pourMoi) {
              taches.push(t.text.trim());
              if (t.tache_id) tacheIdsDuJour.add(String(t.tache_id));
            }
          });
        } else if (cell.planifie?.trim()) {
          cell.planifie.split("\n").filter(l => l.trim()).forEach(l => taches.push(l.trim()));
        }
        const equipe = new Set(cell.ouvriers || []);
        (cell.taches || []).forEach(t => (t.ouvriers || []).forEach(o => equipe.add(o)));
        const collegues = [...equipe].filter(n => n && n !== prenom);
        groups.push({
          chantier_id: cell.chantier_id,
          nom: ch?.nom || cell.chantier_id,
          couleur: ch?.couleur || "#5b8af5",
          geo: adresses[cell.chantier_id] || null,
          taches,
          collegues,
        });
      });

      const { data: raps } = await supabase
        .from("rapports").select("id").eq("date_rapport", dateKey).limit(1);

      // Tâches en retard (phasage = source de vérité) : assignées à l'ouvrier,
      // date_prevue < aujourd'hui, avancement < 100. La RPC ne renvoie ni prix
      // ni taux (phasages est bureau-only). On écarte celles déjà posées
      // aujourd'hui dans le planning (aucune duplication) et les doublons.
      const retard = [];
      const { data: actives, error: errActives } = await supabase
        .rpc("ouvrier_taches_actives", { p_aujourdhui: todayISO, p_prenom: prenom });
      if (errActives) console.error("ouvrier_taches_actives:", errActives);
      const vus = new Set();
      (Array.isArray(actives) ? actives : []).forEach(t => {
        const id = String(t.tache_id || "");
        if (!id || vus.has(id) || tacheIdsDuJour.has(id)) return;
        vus.add(id);
        const ch = chantiersData.find(c => c.id === t.chantier_id);
        retard.push({
          tache_id: id,
          nom: t.nom || "(sans nom)",
          chantier_nom: ch?.nom || t.chantier_nom || t.chantier_id,
          couleur: ch?.couleur || "#5b8af5",
          date_prevue: t.date_prevue || "",
          avancement: Math.max(0, Math.min(100, parseInt(t.avancement) || 0)),
          heures_reelles: parseFloat(t.heures_reelles) || 0,
        });
      });

      if (cancelled) return;
      setChantiersJour(groups);
      setAReprendre(retard);
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

  const totalTaches = chantiersJour.reduce((s, c) => s + c.taches.length, 0);
  const crColor = crRendu ? "#22c55e" : "#f59e0b";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* KPI du jour */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <MobileStat icon={Building2}     label="Chantiers du jour" value={chantiersJour.length} color="#5b8af5" T={T}/>
        <MobileStat icon={ClipboardList} label="Tâches prévues"    value={totalTaches}          color="#8b5cf6" T={T}/>
      </div>

      {/* Statut compte rendu du jour */}
      <MobileCard T={T} accent={crColor} style={{ padding:"13px 15px", display:"flex", alignItems:"center", gap:13 }}>
        <div style={{
          width:40, height:40, borderRadius:12, flexShrink:0,
          background:`linear-gradient(135deg, ${crColor}, ${crColor}c0)`, color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 5px 14px ${crColor}55`,
        }}>
          <Icon as={crRendu ? CheckCircle2 : Clock} size={20} strokeWidth={2.3}/>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:15, color:T.text }}>Compte rendu du jour</div>
          <div style={{ fontSize:13, color:crColor, fontWeight:700, marginTop:1 }}>
            {crRendu ? "Déjà rendu — merci !" : "À faire en fin de journée"}
          </div>
        </div>
      </MobileCard>

      {/* À reprendre — tâches du phasage en retard (date prévue < aujourd'hui,
          non terminées). La date prévue et l'avancement viennent du phasage
          tels quels : rien n'est déplacé ni dupliqué, la tâche sort de la
          liste quand un compte rendu validé la fait passer à 100 %. */}
      {aReprendre.length > 0 && (
        <MobileSection
          T={T}
          accent="#f97316"
          icon={RotateCcw}
          title="À reprendre"
          summary={`${aReprendre.length} tâche${aReprendre.length > 1 ? "s" : ""}`}
          summaryTone="#f97316"
          defaultOpen
        >
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {aReprendre.map(t => {
              const st = statutAvancement(t.avancement);
              return (
                <div key={t.tache_id} style={{ background:T.bg, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
                    <span style={{
                      width:7, height:7, borderRadius:"50%", background:t.couleur,
                      marginTop:6, flexShrink:0, boxShadow:`0 0 0 3px ${t.couleur}22`,
                    }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:T.text, lineHeight:1.35 }}>{t.nom}</div>
                      <div style={{ fontSize:12.5, color:T.textSub, marginTop:1 }}>
                        {t.chantier_nom} · Prévue le {fmtJJMM(t.date_prevue)}
                      </div>
                      <div style={{ fontSize:12.5, fontWeight:700, color:st.color, marginTop:2 }}>
                        {st.label} — {t.avancement} %
                        {t.heures_reelles > 0 && (
                          <span style={{ color:T.textMuted, fontWeight:600 }}>
                            {" "}· {+t.heures_reelles.toFixed(1)} h faites
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ height:5, borderRadius:3, background:T.card, overflow:"hidden", marginTop:7 }}>
                    <div style={{
                      height:"100%", width:`${t.avancement}%`, borderRadius:3,
                      background:`linear-gradient(90deg, ${st.color}, ${st.color}cc)`,
                    }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </MobileSection>
      )}

      {/* Chantiers du jour — accordéons repliables (limite le scroll) */}
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
          return (
            <MobileSection
              key={`${c.chantier_id}_${i}`}
              T={T}
              accent={c.couleur}
              icon={Building2}
              title={c.nom}
              summary={`${c.taches.length} tâche${c.taches.length > 1 ? "s" : ""}`}
              summaryTone={c.couleur}
              defaultOpen={chantiersJour.length === 1}
            >
              {c.geo?.adresse && (
                <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
                  <Icon as={MapPin} size={14} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                  <span style={{ fontSize:13.5, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                </div>
              )}
              {/* Collègues sur ce chantier */}
              <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:12 }}>
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
              <div style={{ marginBottom:12 }}><NavButtons geo={c.geo}/></div>
              {c.taches.length > 0 ? (
                <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:8 }}>
                  {c.taches.map((t, j) => (
                    <li key={j} style={{
                      display:"flex", alignItems:"flex-start", gap:10, fontSize:14, color:T.text, lineHeight:1.4,
                      background:T.bg, borderRadius:10, padding:"10px 12px",
                    }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:c.couleur, marginTop:6, flexShrink:0, boxShadow:`0 0 0 3px ${c.couleur}22` }}/>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic" }}>Aucune tâche détaillée pour ce chantier.</div>
              )}
            </MobileSection>
          );
        })
      )}
    </div>
  );
}
