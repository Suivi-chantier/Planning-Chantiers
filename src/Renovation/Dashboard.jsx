import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { getTodayJour, getBranchAccent, FONT, RADIUS, SPACING, COULEURS_PALETTE } from "../constants";
import { Icon } from "../ui";
import { useIsMobile } from "./Navigation";
import {
  HardHat, TriangleAlert, Users, Building2, Package, ClipboardCheck,
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, Zap, Wind,
  MapPin, Thermometer, Check, X, Clock, ArrowRight, Pencil,
  CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertCircle, RefreshCw, ExternalLink,
} from "lucide-react";

// ─── WIDGET CONTAINER ─────────────────────────────────────────────────────────
function DashWidget({ title, icon: IconComp, children, action, T, accent = "#FFC200" }) {
  return (
    <div style={{
      background: T.widgetBg,
      border: `1px solid ${T.border}`,
      borderRadius: RADIUS.xl,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        padding: "14px 20px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${T.sectionDivider}`,
        gap: SPACING.md,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {IconComp && (
            <div style={{
              width: 28, height: 28, borderRadius: RADIUS.md,
              background: accent + "1a", color: accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon as={IconComp} size={16} strokeWidth={2} />
            </div>
          )}
          <div style={{
            fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
            textTransform: "uppercase", color: T.textSub,
          }}>{title}</div>
        </div>
        {action}
      </div>
      <div style={{ padding: "16px 20px", flex: 1 }}>{children}</div>
    </div>
  );
}

// ─── SECTION ACCORDÉON MOBILE ─────────────────────────────────────────────────
// En-tête toujours visible (titre + métrique clé) ; contenu dépliable.
function MobileSection({ title, icon: IconComp, summary, defaultOpen = false, T, accent = "#FFC200", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: T.widgetBg, border: `1px solid ${T.border}`,
      borderRadius: RADIUS.lg, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "13px 14px", background: "transparent", border: "none",
        cursor: "pointer", fontFamily: "inherit", color: T.text, textAlign: "left",
      }}>
        {IconComp && (
          <div style={{
            width: 26, height: 26, borderRadius: RADIUS.md, flexShrink: 0,
            background: accent + "1a", color: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon as={IconComp} size={15} strokeWidth={2}/></div>
        )}
        <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {summary != null && summary !== "" && (
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textSub }}>{summary}</span>
          )}
          <Icon as={open ? ChevronUp : ChevronDown} size={16} style={{ color: T.textMuted }}/>
        </span>
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

// ─── STAT CARD (KPI tile) ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: IconComp, color, T }) {
  return (
    <div style={{
      background: T.widgetBg,
      border: `1px solid ${T.border}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: RADIUS.md,
        background: color + "18", color: color,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Icon as={IconComp} size={22} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1.1, letterSpacing: -0.3 }}>
          {value}
          {sub && <span style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginLeft: 5 }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatDateLimite(iso) {
  if (!iso) return null;
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch { return iso; }
}

// ─── MÉTÉO : code WMO → icône + label ─────────────────────────────────────────
function weatherInfo(code) {
  if (code === 0)                         return { icon: Sun,          label: "Ensoleillé",     color: "#f5a623" };
  if (code >= 1 && code <= 3)             return { icon: Cloud,        label: "Nuageux",        color: "#94a3b8" };
  if (code === 45 || code === 48)         return { icon: CloudFog,     label: "Brouillard",     color: "#94a3b8" };
  if (code >= 51 && code <= 57)           return { icon: CloudDrizzle, label: "Bruine",         color: "#5b8af5" };
  if (code >= 61 && code <= 67)           return { icon: CloudRain,    label: "Pluie",          color: "#5b8af5" };
  if (code >= 71 && code <= 77)           return { icon: CloudSnow,    label: "Neige",          color: "#cbd5e1" };
  if (code >= 80 && code <= 82)           return { icon: CloudRain,    label: "Averses",        color: "#5b8af5" };
  if (code >= 95 && code <= 99)           return { icon: Zap,          label: "Orage",          color: "#a855f7" };
  return                                         { icon: Cloud,        label: "Variable",       color: "#94a3b8" };
}

// ─── PAGE DASHBOARD ───────────────────────────────────────────────────────────
function PageDashboard({ chantiers, cells, commandes, notesData, weekId, T, profil, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const isMobile = useIsMobile();
  const todayJour = getTodayJour();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const todayFr  = now.toLocaleDateString("fr-FR"); // DD/MM/YYYY (format rapports.date_rapport)
  const greeting = now.getHours() < 12 ? "Bonjour" : now.getHours() < 18 ? "Bon après-midi" : "Bonsoir";

  // ── Chantiers actifs aujourd'hui ──
  const chantiersAujourdHui = todayJour ? chantiers.map(c => {
    const cell = cells[`${c.id}_${todayJour}`] || { planifie:"", reel:"", ouvriers:[] };
    return { ...c, cell };
  }).filter(c => c.cell.ouvriers?.length > 0 || c.cell.planifie) : [];

  // ── Ouvriers attendus aujourd'hui (uniques) ──
  const ouvriersAttendus = Array.from(new Set(
    chantiersAujourdHui.flatMap(c => c.cell.ouvriers || [])
  ));

  // ── Données fetched ──
  const [cmdCount, setCmdCount]         = useState(0);
  const [todos, setTodos]               = useState([]);
  const [rapportsToday, setRapportsToday] = useState([]);
  const [weather, setWeather]           = useState(null);
  const [weatherCity, setWeatherCity]   = useState(() => localStorage.getItem("dash_weather_city") || "Paris");

  useEffect(() => {
    // Besoins ouvrier en attente (nouveau modèle) = demandes à transformer en commande
    supabase.from("besoins").select("id", { count: "exact", head: true }).eq("statut", "en_attente")
      .then(({ count }) => setCmdCount(count || 0));

    // Todos
    supabase.from("planning_config").select("value").eq("key", "bloc_todos").maybeSingle()
      .then(({ data }) => setTodos(Array.isArray(data?.value) ? data.value : []));

    // Rapports du jour (pour Activité équipe)
    supabase.from("rapports").select("ouvrier,chantier_nom,taches,submitted_at")
      .eq("date_rapport", todayFr)
      .then(({ data }) => setRapportsToday(data || []));
  }, [todayFr]);

  // ── Météo : Open-Meteo (gratuit, sans clé). On géocode la ville d'abord. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Géocodage de la ville → lat/lon
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(weatherCity)}&count=1&language=fr&format=json`).then(r => r.json());
        const loc = geo?.results?.[0];
        if (!loc) { if (!cancelled) setWeather({ error: "Ville inconnue" }); return; }

        // 2. Prévisions
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&forecast_days=4&timezone=Europe%2FParis`).then(r => r.json());

        if (!cancelled) setWeather({ city: loc.name, current: f.current, daily: f.daily });
      } catch (e) {
        if (!cancelled) setWeather({ error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [weatherCity]);

  // ── Calculs dérivés (mes tâches To-Do) ──
  // Filtre les todos assignées à l'utilisateur connecté (par email).
  // Catégories : en retard / aujourd'hui / autres (à venir ou sans date).
  const monEmail = profil?.email || null;
  const mesTodos = todos.filter(t => !t.fait && monEmail && t.assigne_email === monEmail);
  const todosEnRetard   = mesTodos.filter(t => t.date_limite && t.date_limite < todayIso);
  const todosAujourdhui = mesTodos.filter(t => t.date_limite === todayIso);
  const todosAutres     = mesTodos.filter(t => !t.date_limite || t.date_limite > todayIso);

  const ouvriersRendus = new Set((rapportsToday || []).map(r => r.ouvrier));
  const ouvriersManquants = ouvriersAttendus.filter(o => !ouvriersRendus.has(o));
  const tauxRendus = ouvriersAttendus.length > 0
    ? Math.round((ouvriersAttendus.length - ouvriersManquants.length) / ouvriersAttendus.length * 100)
    : null;

  // Stats KPI — toutes en couleur d'accent pour la sobriété.
  // Seul "Rapports rendus" garde un code couleur dynamique car c'est un
  // indicateur de performance qu'on veut voir d'un coup d'œil.
  const stats = [
    { label: "Chantiers actifs",   value: chantiersAujourdHui.length, icon: Building2,      color: acc.accent },
    { label: "Ouvriers terrain",   value: ouvriersAttendus.length,    icon: HardHat,        color: acc.accent },
    { label: "Commandes à passer", value: cmdCount,                   icon: Package,        color: acc.accent },
    { label: "Rapports rendus",    value: ouvriersAttendus.length ? `${ouvriersAttendus.length - ouvriersManquants.length}/${ouvriersAttendus.length}` : "—",
      icon: ClipboardCheck,
      color: tauxRendus === null ? acc.accent : tauxRendus >= 80 ? "#22c55e" : tauxRendus >= 50 ? "#f59e0b" : "#ef4444" },
  ];

  // ─── RENDU MOBILE : en-tête compact + KPI 2×2 + sections accordéon ──────────
  // Pensé pour la consultation au pouce : chaque section montre sa métrique clé
  // dans son en-tête (état visible sans déplier), on ouvre que ce qu'on veut.
  if (isMobile) {
    const rendus = ouvriersAttendus.length - ouvriersManquants.length;
    const tachesSummary = todosEnRetard.length > 0 ? `${todosEnRetard.length} en retard`
      : mesTodos.length > 0 ? `${mesTodos.length} à faire` : null;
    return (
      <div className="page-padding dashboard-page" style={{ flex:1, overflowY:"auto", padding:"14px 12px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* En-tête compact */}
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:8 }}>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.3, color:T.text }}>{greeting}</div>
          <div style={{ fontSize:FONT.xs.size+1, color:T.textMuted, textTransform:"capitalize", textAlign:"right" }}>
            {now.toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" })}
          </div>
        </div>

        {/* KPI 2×2 */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {stats.map((s,i) => <StatCard key={i} T={T} {...s}/>)}
        </div>

        {/* Chantiers du jour — ouvert par défaut */}
        <MobileSection T={T} accent={acc.accent} icon={HardHat} title="Chantiers du jour"
          summary={todayJour ? chantiersAujourdHui.length : "—"} defaultOpen>
          {!todayJour ? (
            <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>C'est le week-end — aucune activité prévue.</div>
          ) : chantiersAujourdHui.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:FONT.sm.size, lineHeight:1.6 }}>Aucun ouvrier planifié pour {todayJour}.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {chantiersAujourdHui.map(c => (
                <div key={c.id} style={{ display:"flex", gap:10, padding:"10px 12px", borderRadius:RADIUS.lg, background:c.couleur+"1c", border:`1px solid ${c.couleur}44` }}>
                  <div style={{ width:4, alignSelf:"stretch", borderRadius:2, background:c.couleur, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:FONT.base.size, color:T.text, marginBottom:4 }}>{c.nom}</div>
                    {c.cell.planifie && <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.5, marginBottom:6, whiteSpace:"pre-wrap" }}>{c.cell.planifie}</div>}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {c.cell.ouvriers.map(o => (
                        <span key={o} style={{ background:c.couleur, color:"#1a1f2e", borderRadius:RADIUS.sm+2, padding:"2px 8px", fontSize:FONT.xs.size, fontWeight:700 }}>{o}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </MobileSection>

        {/* Activité équipe */}
        <MobileSection T={T} accent={acc.accent} icon={Users} title="Activité équipe"
          summary={todayJour && ouvriersAttendus.length ? `${rendus}/${ouvriersAttendus.length}` : null}>
          {todayJour && ouvriersAttendus.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Personne planifié</div>
          ) : !todayJour ? (
            <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Week-end</div>
          ) : (
            <>
              <div style={{ height:6, borderRadius:3, background:T.card, marginBottom:12, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${tauxRendus||0}%`, background: tauxRendus===null?"#94a3b8":tauxRendus>=80?"#4caf78":tauxRendus>=50?"#f5a623":"#e15a5a", transition:"width .3s" }}/>
              </div>
              {ouvriersManquants.length > 0 ? (
                <>
                  <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginBottom:5, fontWeight:700, letterSpacing:.8, textTransform:"uppercase" }}>En attente</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {ouvriersManquants.map(o => (
                      <span key={o} style={{ display:"inline-flex", alignItems:"center", gap:4, background:"rgba(225,90,90,0.12)", color:"#e15a5a", border:"1px solid rgba(225,90,90,0.25)", borderRadius:RADIUS.sm+2, padding:"3px 9px", fontSize:FONT.xs.size+1, fontWeight:700 }}>
                        <Icon as={Clock} size={10}/>{o}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, color:"#4caf78", fontSize:FONT.sm.size, fontWeight:600 }}>
                  <Icon as={Check} size={16}/>Tous les rapports sont rendus
                </div>
              )}
            </>
          )}
        </MobileSection>

        {/* Mes tâches */}
        <MobileSection T={T} accent={acc.accent} icon={ClipboardCheck} title="Mes tâches" summary={tachesSummary}>
          {!monEmail ? (
            <div style={{ fontSize:FONT.sm.size, color:T.textMuted }}>Aucun email associé à votre profil.</div>
          ) : mesTodos.length === 0 ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, color:"#4caf78", fontSize:FONT.sm.size, fontWeight:600 }}>
              <Icon as={Check} size={16}/>Aucune tâche en cours
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {todosEnRetard.length > 0 && <AlertGroup T={T} color="#e15a5a" icon={TriangleAlert} label={`${todosEnRetard.length} en retard`} items={todosEnRetard.slice(0,4).map(t=>({text:t.texte, sub:formatDateLimite(t.date_limite)}))}/>}
              {todosAujourdhui.length > 0 && <AlertGroup T={T} color="#f5a623" icon={Clock} label={`${todosAujourdhui.length} aujourd'hui`} items={todosAujourdhui.slice(0,4).map(t=>({text:t.texte}))}/>}
              {todosAutres.length > 0 && <AlertGroup T={T} color={acc.accent} icon={ClipboardCheck} label={`${todosAutres.length} à venir`} items={todosAutres.slice(0,4).map(t=>({text:t.texte, sub:t.date_limite?formatDateLimite(t.date_limite):null}))}/>}
            </div>
          )}
        </MobileSection>

        {/* Météo */}
        <MobileSection T={T} accent={acc.accent} icon={Cloud} title={`Météo · ${weather?.city || weatherCity}`}>
          {!weather ? <div style={{ color:T.textMuted, fontSize:FONT.sm.size }}>Chargement…</div>
            : weather.error ? <div style={{ color:"#e15a5a", fontSize:FONT.sm.size }}>Météo indisponible</div>
            : <WeatherDisplay weather={weather} T={T}/>}
        </MobileSection>

        {/* Agenda équipe — widget autonome, en bas (secondaire) */}
        <AgendaWidget T={T} accent={acc.accent} branch={branch}/>
      </div>
    );
  }

  return (
    <div className="page-padding dashboard-page" style={{ flex:1, overflowY:"auto", padding:"28px 32px" }}>
      <style>{`
        @media (max-width:767px) {
          .dashboard-page .dash-title{font-size:26px!important}
          .dashboard-page .dash-stats-grid{grid-template-columns:repeat(2,1fr)!important}
          .dashboard-page .dashboard-row{grid-template-columns:1fr!important}
          .dashboard-page .dash-chantier-item{padding:12px!important}
          .dashboard-page .dash-chantier-name{font-size:15px!important}
          .dashboard-page .dash-agenda-grid{grid-template-columns:repeat(2,1fr)!important}
        }
        @media (min-width:768px) and (max-width:1100px){
          .dashboard-page .dash-agenda-grid{grid-template-columns:repeat(4,1fr)!important}
        }
      `}</style>

      {/* En-tête */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: FONT.sm.size, color: T.textMuted, marginBottom: 4,
          letterSpacing: .3, textTransform: "capitalize",
        }}>
          {now.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
        </div>
        <div className="dash-title" style={{
          fontSize: FONT.h1.size + 4, fontWeight: 800,
          letterSpacing: -0.4, lineHeight: 1.1, color: T.text,
        }}>{greeting}</div>
      </div>

      {/* Stats KPI : 4 tuiles */}
      <div className="dash-stats-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20,
      }}>
        {stats.map((s, i) => <StatCard key={i} T={T} {...s} />)}
      </div>

      {/* Layout : Chantiers en colonne gauche (héros), tous les autres widgets
         empilés à droite — tout visible sans scroller la page */}
      <div className="dashboard-row" style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:20, alignItems:"start", marginBottom:24 }}>

        <DashWidget T={T} accent={acc.accent} title="Chantiers aujourd'hui" icon={HardHat}>
          {!todayJour ? (
            <div style={{ color:T.textSub, fontSize:FONT.base.size, padding:"4px 0" }}>
              C'est le week-end — aucune activité prévue.
            </div>
          ) : chantiersAujourdHui.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:FONT.base.size, padding:"4px 0", lineHeight:1.6 }}>
              Aucun ouvrier planifié pour {todayJour}.<br/>
              <span style={{ color:T.textMuted }}>Ouvre le planning pour remplir la journée.</span>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:560, overflowY:"auto", paddingRight:4 }}>
              {chantiersAujourdHui.map(c => (
                <div key={c.id} className="dash-chantier-item" style={{
                  display:"flex", alignItems:"flex-start", gap:12, padding:"11px 14px",
                  borderRadius: RADIUS.lg,
                  background: c.couleur + "1c",
                  border: `1px solid ${c.couleur}44`,
                }}>
                  <div style={{
                    width:4, alignSelf:"stretch",
                    borderRadius:2, background:c.couleur,
                    marginTop:2, marginBottom:2, flexShrink:0,
                  }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="dash-chantier-name" style={{
                      fontWeight: 700, fontSize: FONT.base.size + 1,
                      color: T.text, marginBottom: 4,
                    }}>{c.nom}</div>
                    {c.cell.planifie && (
                      <div style={{
                        fontSize: FONT.sm.size, color: T.textSub,
                        lineHeight: 1.5, marginBottom: 7, whiteSpace: "pre-wrap",
                      }}>{c.cell.planifie}</div>
                    )}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {c.cell.ouvriers.map(o => (
                        <span key={o} style={{
                          background: c.couleur, color: "#1a1f2e",
                          borderRadius: RADIUS.sm + 2,
                          padding: "2px 8px", fontSize: FONT.xs.size,
                          fontWeight: 700, letterSpacing: .2,
                        }}>{o}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashWidget>

        {/* Colonne droite : 3 widgets empilés */}
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

          <DashWidget T={T} accent={acc.accent} title="Activité équipe" icon={Users}>
            {todayJour && ouvriersAttendus.length === 0 ? (
              <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Personne planifié</div>
            ) : !todayJour ? (
              <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Week-end</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                  <span style={{
                    fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: -0.3,
                  }}>{ouvriersAttendus.length - ouvriersManquants.length}</span>
                  <span style={{ fontSize: FONT.sm.size, color: T.textMuted }}>/ {ouvriersAttendus.length} compte rendu{ouvriersAttendus.length > 1 ? "s" : ""}</span>
                </div>
                <div style={{ height:6, borderRadius:3, background:T.card, marginBottom:12, overflow:"hidden" }}>
                  <div style={{
                    height:"100%",
                    width: `${tauxRendus || 0}%`,
                    background: tauxRendus === null ? "#94a3b8" : tauxRendus >= 80 ? "#4caf78" : tauxRendus >= 50 ? "#f5a623" : "#e15a5a",
                    transition: "width .3s",
                  }}/>
                </div>
                {ouvriersManquants.length > 0 ? (
                  <>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginBottom: 5, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase" }}>
                      En attente
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {ouvriersManquants.map(o => (
                        <span key={o} style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          background:"rgba(225,90,90,0.12)", color:"#e15a5a",
                          border:"1px solid rgba(225,90,90,0.25)",
                          borderRadius: RADIUS.sm + 2, padding:"3px 9px",
                          fontSize: FONT.xs.size + 1, fontWeight: 700,
                        }}>
                          <Icon as={Clock} size={10}/>
                          {o}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#4caf78", fontSize:FONT.sm.size, fontWeight:600 }}>
                    <Icon as={Check} size={16}/>
                    Tous les rapports sont rendus
                  </div>
                )}
              </>
            )}
          </DashWidget>

          <DashWidget T={T} accent={acc.accent} title="Mes tâches" icon={ClipboardCheck}>
            {!monEmail ? (
              <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>
                Aucun email associé à votre profil.
              </div>
            ) : mesTodos.length === 0 ? (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, color:"#4caf78", fontSize:FONT.sm.size, fontWeight:600, marginBottom:6 }}>
                  <Icon as={Check} size={16}/>
                  Aucune tâche en cours
                </div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.55 }}>
                  Les tâches que vous vous assignez depuis la page Notes &amp; To-Do apparaîtront ici.
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {todosEnRetard.length > 0 && (
                  <AlertGroup T={T} color="#e15a5a" icon={TriangleAlert} label={`${todosEnRetard.length} en retard`}
                    items={todosEnRetard.slice(0,4).map(t => ({ text: t.texte, sub: formatDateLimite(t.date_limite) }))}/>
                )}
                {todosAujourdhui.length > 0 && (
                  <AlertGroup T={T} color="#f5a623" icon={Clock} label={`${todosAujourdhui.length} aujourd'hui`}
                    items={todosAujourdhui.slice(0,4).map(t => ({ text: t.texte }))}/>
                )}
                {todosAutres.length > 0 && (
                  <AlertGroup T={T} color={acc.accent} icon={ClipboardCheck} label={`${todosAutres.length} à venir`}
                    items={todosAutres.slice(0,4).map(t => ({
                      text: t.texte,
                      sub: t.date_limite ? formatDateLimite(t.date_limite) : null,
                    }))}/>
                )}
              </div>
            )}
          </DashWidget>

          <DashWidget T={T} accent={acc.accent} title={`Météo · ${weather?.city || weatherCity}`} icon={Cloud}
            action={
              <button onClick={() => {
                const v = prompt("Ville pour la météo :", weatherCity);
                if (v && v.trim()) { setWeatherCity(v.trim()); localStorage.setItem("dash_weather_city", v.trim()); setWeather(null); }
              }} style={{
                display:"inline-flex", alignItems:"center", gap:5,
                background:"transparent",
                border:`1px solid ${T.border}`, borderRadius:RADIUS.md,
                padding:"4px 10px", color:T.textSub,
                fontSize:FONT.xs.size + 1, fontWeight:600,
                cursor:"pointer", fontFamily:"inherit",
              }}>
                <Icon as={MapPin} size={12}/>
                Changer
              </button>
            }>
            {!weather ? (
              <div style={{ color:T.textMuted, fontSize:FONT.sm.size, padding:"12px 0" }}>Chargement…</div>
            ) : weather.error ? (
              <div style={{ color:"#e15a5a", fontSize:FONT.sm.size, padding:"12px 0" }}>Météo indisponible — {weather.error}</div>
            ) : (
              <WeatherDisplay weather={weather} T={T} />
            )}
          </DashWidget>

        </div>
      </div>

      {/* Agendas équipe — pleine largeur */}
      <div style={{ marginBottom: 24 }}>
        <AgendaWidget T={T} accent={acc.accent} branch={branch} />
      </div>
    </div>
  );
}

// ─── ALERT GROUP (sous-composant pour Mes tâches) ─────────────────────────────
function AlertGroup({ T, color, label, items, icon: HeaderIcon = TriangleAlert }) {
  return (
    <div style={{
      background: color + "10",
      border: `1px solid ${color}33`,
      borderRadius: RADIUS.md,
      padding: "9px 12px",
    }}>
      <div style={{
        fontSize: FONT.sm.size, fontWeight: 700, color: color, marginBottom: items.length ? 6 : 0,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <Icon as={HeaderIcon} size={13}/>
        {label}
      </div>
      {items.map((it, i) => (
        <div key={i} style={{
          fontSize: FONT.xs.size + 1,
          color: T.text, lineHeight: 1.4,
          marginTop: i === 0 ? 0 : 5,
          display: "flex", flexDirection: "column",
        }}>
          <span style={{ fontWeight: 600 }}>{it.text}</span>
          {it.sub && <span style={{ color: T.textMuted, fontSize: FONT.xs.size }}>{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── WEATHER DISPLAY (sous-composant) ─────────────────────────────────────────
function WeatherDisplay({ weather, T }) {
  const { current, daily } = weather;
  const wi = weatherInfo(current?.weather_code);

  return (
    <div>
      {/* Bloc actuel */}
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: RADIUS.lg,
          background: wi.color + "18", color: wi.color,
          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
        }}>
          <Icon as={wi.icon} size={32} strokeWidth={1.75}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: T.text, letterSpacing: -0.5, lineHeight: 1 }}>
            {Math.round(current?.temperature_2m)}°
          </div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginTop: 3 }}>
            {wi.label}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize: FONT.sm.size, color: T.textMuted }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <Icon as={Wind} size={13}/>
            <span>{Math.round(current?.wind_speed_10m)} km/h</span>
          </div>
        </div>
      </div>

      {/* Prévisions 3 jours */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
        {(daily?.time || []).slice(1, 4).map((dateStr, i) => {
          const idx = i + 1;
          const di = weatherInfo(daily.weather_code[idx]);
          const dayName = new Date(dateStr + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short" });
          return (
            <div key={dateStr} style={{
              padding:"10px 8px",
              border:`1px solid ${T.border}`,
              borderRadius: RADIUS.md,
              background: T.card,
              display:"flex", flexDirection:"column", alignItems:"center", gap:4,
            }}>
              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textSub, textTransform: "capitalize", letterSpacing: .3 }}>
                {dayName.replace(".", "")}
              </div>
              <Icon as={di.icon} size={22} color={di.color}/>
              <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>
                {Math.round(daily.temperature_2m_max[idx])}°
                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 500, marginLeft: 3 }}>
                  {Math.round(daily.temperature_2m_min[idx])}°
                </span>
              </div>
              {daily.precipitation_sum[idx] > 0.5 && (
                <div style={{ fontSize: FONT.xs.size, color: "#5b8af5", fontWeight: 600 }}>
                  {daily.precipitation_sum[idx].toFixed(1)} mm
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AGENDAS ÉQUIPE (Google Calendar) ─────────────────────────────────────────
// Lit les agendas Google des membres de l'équipe via l'Edge Function
// `list-team-calendar-events` (compte og@ + refresh_token OAuth) et les affiche
// en vue semaine. ⚠️ Chaque agenda doit être partagé avec og@groupe-profero.com.

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// Lundi de la semaine courante décalée de `offset` semaines (heure locale).
function lundiSemaine(offset = 0) {
  const now = new Date();
  const jour = now.getDay();                 // 0 = dimanche … 6 = samedi
  const versLundi = jour === 0 ? -6 : 1 - jour;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + versLundi + offset * 7);
}
// Clé jour locale "AAAA-MM-JJ" à partir d'une Date.
function cleJour(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Clé jour d'un événement (gère tout-la-journée "AAAA-MM-JJ" et daté ISO).
function cleJourEvent(ev) {
  if (!ev.start) return null;
  if (ev.allDay) return String(ev.start).slice(0, 10);
  const d = new Date(ev.start);
  return isNaN(d) ? null : cleJour(d);
}

function AgendaWidget({ T, accent, branch = "renovation" }) {
  const [team, setTeam]       = useState([]);     // [{ email, nom, color }]
  const [offset, setOffset]   = useState(0);      // décalage de semaine
  const [events, setEvents]   = useState([]);
  const [calErrors, setCalErrors] = useState([]); // agendas non lisibles
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [hidden, setHidden]   = useState(() => new Set()); // emails masqués
  const [reloadKey, setReloadKey] = useState(0);

  // 1. Charger l'équipe (utilisateurs actifs de la branche, avec email).
  useEffect(() => {
    let annule = false;
    supabase.from("utilisateurs").select("email,nom,branches,actif").order("nom")
      .then(({ data }) => {
        if (annule) return;
        const membres = (data || [])
          .filter(u => u.actif && u.email && (!Array.isArray(u.branches) || u.branches.length === 0 || u.branches.includes(branch)))
          .map((u, i) => ({
            email: String(u.email).trim().toLowerCase(),
            nom: u.nom || u.email,
            color: COULEURS_PALETTE[i % COULEURS_PALETTE.length],
          }));
        setTeam(membres);
      });
    return () => { annule = true; };
  }, [branch]);

  // 2. Bornes de la semaine affichée.
  const lundi = lundiSemaine(offset);
  const lundiSuivant = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 7);
  const jours = Array.from({ length: 7 }, (_, i) =>
    new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + i));
  const todayKey = cleJour(new Date());

  // 3. Charger les événements de la semaine pour toute l'équipe.
  const emailsKey = team.map(m => m.email).join(",");
  useEffect(() => {
    if (!team.length) { setLoading(false); return; }
    let annule = false;
    setLoading(true); setError(""); setCalErrors([]);
    supabase.functions.invoke("list-team-calendar-events", {
      body: {
        emails: team.map(m => m.email),
        timeMin: lundi.toISOString(),
        timeMax: lundiSuivant.toISOString(),
        maxPerCalendar: 100,
      },
    }).then(({ data, error: fnErr }) => {
      if (annule) return;
      if (fnErr) { setError(fnErr.message || "Erreur de chargement des agendas."); setLoading(false); return; }
      if (data?.error) { setError(data.error); setLoading(false); return; }
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setCalErrors(Array.isArray(data?.errors) ? data.errors : []);
      setLoading(false);
    }).catch(e => { if (!annule) { setError(e.message); setLoading(false); } });
    return () => { annule = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailsKey, offset, reloadKey]);

  const colorFor = (email) => team.find(m => m.email === email)?.color || accent;
  const nomFor   = (email) => team.find(m => m.email === email)?.nom || email;

  // Événements visibles regroupés par jour, triés par heure.
  const visibles = events.filter(ev => !hidden.has(ev.calendarEmail));
  const parJour = {};
  for (const ev of visibles) {
    const k = cleJourEvent(ev);
    if (!k) continue;
    (parJour[k] = parJour[k] || []).push(ev);
  }
  Object.values(parJour).forEach(list => list.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return String(a.start).localeCompare(String(b.start));
  }));

  const heure = (ev) => {
    if (ev.allDay) return "journée";
    try { return new Date(ev.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };
  const labelSemaine = `${lundi.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${new Date(lundiSuivant.getFullYear(), lundiSuivant.getMonth(), lundiSuivant.getDate() - 1).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;

  const configManquante = /secrets google manquants/i.test(error);

  const navBtn = (onClick, children, title) => (
    <button onClick={onClick} title={title} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: RADIUS.md,
      background: "transparent", border: `1px solid ${T.border}`,
      color: T.textSub, cursor: "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );

  return (
    <DashWidget T={T} accent={accent} title="Agendas équipe" icon={CalendarDays}
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600, whiteSpace: "nowrap" }}>{labelSemaine}</span>
          {navBtn(() => setOffset(o => o - 1), <Icon as={ChevronLeft} size={14} />, "Semaine précédente")}
          {offset !== 0 && (
            <button onClick={() => setOffset(0)} style={{
              border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
              borderRadius: RADIUS.md, padding: "3px 9px", fontSize: FONT.xs.size + 1,
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Auj.</button>
          )}
          {navBtn(() => setOffset(o => o + 1), <Icon as={ChevronRight} size={14} />, "Semaine suivante")}
          {navBtn(() => setReloadKey(k => k + 1), <Icon as={RefreshCw} size={13} />, "Rafraîchir")}
        </div>
      }>

      {/* Filtres par personne */}
      {team.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {team.map(m => {
            const off = hidden.has(m.email);
            return (
              <button key={m.email} onClick={() => setHidden(prev => {
                const next = new Set(prev);
                next.has(m.email) ? next.delete(m.email) : next.add(m.email);
                return next;
              })} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: off ? "transparent" : m.color + "1f",
                border: `1px solid ${off ? T.border : m.color + "66"}`,
                color: off ? T.textMuted : T.text,
                borderRadius: RADIUS.pill, padding: "3px 10px",
                fontSize: FONT.xs.size + 1, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                opacity: off ? 0.55 : 1,
              }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
                {m.nom}
              </button>
            );
          })}
        </div>
      )}

      {/* Contenu */}
      {loading ? (
        <div style={{ color: T.textMuted, fontSize: FONT.sm.size, padding: "16px 0" }}>Chargement des agendas…</div>
      ) : configManquante ? (
        <div style={{
          background: "#f5a62310", border: "1px solid #f5a62333", borderRadius: RADIUS.md,
          padding: "12px 14px", fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.55,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#f5a623", fontWeight: 700, marginBottom: 6 }}>
            <Icon as={AlertCircle} size={15} /> Connexion Google à configurer
          </div>
          Ajoutez les secrets <strong>GOOGLE_OAUTH_CLIENT_ID</strong>, <strong>GOOGLE_OAUTH_CLIENT_SECRET</strong> et <strong>GOOGLE_OAUTH_REFRESH_TOKEN</strong> dans Supabase (mêmes valeurs que la fonction d'écriture <em>create-mission-calendar-event</em>), puis déployez la fonction <em>list-team-calendar-events</em>.
        </div>
      ) : error ? (
        <div style={{ color: "#e15a5a", fontSize: FONT.sm.size, padding: "12px 0" }}>
          <Icon as={AlertCircle} size={14} /> {error}
        </div>
      ) : team.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: FONT.sm.size, padding: "12px 0" }}>
          Aucun membre d'équipe avec email pour cette branche.
        </div>
      ) : (
        <>
          <div className="dash-agenda-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {jours.map((d, i) => {
              const k = cleJour(d);
              const evs = parJour[k] || [];
              const estAuj = k === todayKey;
              return (
                <div key={k} style={{
                  border: `1px solid ${estAuj ? accent + "88" : T.border}`,
                  background: estAuj ? accent + "0f" : T.card,
                  borderRadius: RADIUS.md, padding: "8px 8px 10px",
                  minHeight: 90, display: "flex", flexDirection: "column", gap: 5,
                }}>
                  <div style={{
                    fontSize: FONT.xs.size, fontWeight: 700, color: estAuj ? accent : T.textSub,
                    textTransform: "uppercase", letterSpacing: .4, marginBottom: 2,
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  }}>
                    <span>{JOURS_COURTS[i]}</span>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 600, color: T.textMuted }}>{d.getDate()}</span>
                  </div>
                  {evs.length === 0 ? (
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, opacity: .5 }}>—</div>
                  ) : evs.map((ev, j) => {
                    const c = colorFor(ev.calendarEmail);
                    return (
                      <a key={ev.id + j} href={ev.htmlLink || undefined} target="_blank" rel="noopener noreferrer"
                        title={`${nomFor(ev.calendarEmail)} · ${heure(ev)} — ${ev.summary}${ev.location ? `\n${ev.location}` : ""}`}
                        style={{
                          display: "block", textDecoration: "none",
                          background: c + "1c", borderLeft: `3px solid ${c}`,
                          borderRadius: RADIUS.sm + 1, padding: "3px 6px",
                          cursor: ev.htmlLink ? "pointer" : "default",
                        }}>
                        <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: c, lineHeight: 1.2 }}>
                          {ev.allDay ? "Journée" : heure(ev)}
                        </div>
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.text, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ev.summary}
                        </div>
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {calErrors.length > 0 && (
            <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.5 }}>
              <Icon as={AlertCircle} size={12} />{" "}
              {calErrors.length} agenda{calErrors.length > 1 ? "s" : ""} non lisible{calErrors.length > 1 ? "s" : ""} :{" "}
              {calErrors.map(e => nomFor(e.email)).join(", ")}.{" "}
              <span>Chaque personne doit partager son agenda Google avec <strong>og@groupe-profero.com</strong>.</span>
            </div>
          )}
        </>
      )}
    </DashWidget>
  );
}

export default PageDashboard;
