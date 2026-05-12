import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getBranchAccent, FONT, RADIUS } from "./constants";
import { Icon } from "./ui";
import {
  CalendarDays, Target, TriangleAlert, StickyNote,
  ChevronLeft, ChevronRight, ChevronsRight, ChevronDown,
  CalendarCheck, X, Check, Trash2, Pencil, Lightbulb, Printer,
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, Zap,
} from "lucide-react";

// ─── TYPES D'ÉVÉNEMENTS ───────────────────────────────────────────────────────
const EVENT_TYPES = [
  { id: "objectif",  label: "Objectif",        icon: Target,        color: "#5B8AF5", bg: "rgba(91,138,245,0.12)"  },
  { id: "important", label: "Date importante", icon: TriangleAlert, color: "#f5a623", bg: "rgba(245,166,35,0.12)"  },
  { id: "note",      label: "Note",            icon: StickyNote,    color: "#b06dd4", bg: "rgba(176,109,212,0.12)" },
];

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const JOURS_COURTS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

function getTypeById(id) {
  return EVENT_TYPES.find(t => t.id === id) || EVENT_TYPES[2];
}

const toIsoDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

// Code WMO → icône + couleur (compact).
function weatherInfo(code) {
  if (code == null) return null;
  if (code === 0)                  return { icon: Sun,          color: "#f5a623" };
  if (code >= 1 && code <= 3)      return { icon: Cloud,        color: "#94a3b8" };
  if (code === 45 || code === 48)  return { icon: CloudFog,     color: "#94a3b8" };
  if (code >= 51 && code <= 57)    return { icon: CloudDrizzle, color: "#5b8af5" };
  if (code >= 61 && code <= 67)    return { icon: CloudRain,    color: "#5b8af5" };
  if (code >= 71 && code <= 77)    return { icon: CloudSnow,    color: "#cbd5e1" };
  if (code >= 80 && code <= 82)    return { icon: CloudRain,    color: "#5b8af5" };
  if (code >= 95 && code <= 99)    return { icon: Zap,          color: "#a855f7" };
  return                                  { icon: Cloud,        color: "#94a3b8" };
}

// ─── MODAL AJOUT / ÉDITION ────────────────────────────────────────────────────
function EventModal({ day, month, year, existing, onSave, onClose, onDelete, T, acc, chantiers }) {
  const [type, setType]     = useState(existing?.type || "objectif");
  const [texte, setTexte]   = useState(existing?.texte || "");
  const [chantierId, setChantierId] = useState(existing?.chantier_id || "");
  const [dateFin, setDateFin] = useState(existing?.date_fin || "");
  const [multiJours, setMultiJours] = useState(!!existing?.date_fin);
  const [saving, setSaving] = useState(false);

  const dateLabel = new Date(year, month, day).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  const handleSave = async () => {
    if (!texte.trim()) return;
    setSaving(true);
    const ch = chantiers.find(c => c.id === chantierId);
    await onSave({
      type, texte: texte.trim(),
      chantier_id: ch ? ch.id : null,
      chantier_nom: ch ? ch.nom : null,
      chantier_couleur: ch ? ch.couleur : null,
      date_fin: multiJours && dateFin ? dateFin : null,
    });
    setSaving(false);
  };

  const typeData = getTypeById(type);
  const startDateIso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: RADIUS.xl, width: "100%", maxWidth: 480,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>
              {existing ? "Modifier l'événement" : "Ajouter un événement"}
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 3, textTransform: "capitalize" }}>
              {dateLabel}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted,
            cursor: "pointer", padding: 4, borderRadius: RADIUS.sm,
            display: "inline-flex", alignItems: "center",
          }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px" }}>
          {/* Type selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
              Type
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {EVENT_TYPES.map(t => {
                const active = type === t.id;
                return (
                  <button key={t.id} onClick={() => setType(t.id)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", borderRadius: RADIUS.md, border: "1.5px solid",
                    borderColor: active ? t.color : T.border,
                    background: active ? t.bg : "transparent",
                    color: active ? t.color : T.textSub,
                    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: active ? 700 : 600,
                    cursor: "pointer", transition: "all .12s",
                  }}>
                    <Icon as={t.icon} size={13}/>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Texte */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
              Description
            </div>
            <textarea
              value={texte}
              onChange={e => setTexte(e.target.value)}
              placeholder="Ex : Livraison placo sur chantier Lamartine…"
              rows={3}
              autoFocus
              style={{
                width: "100%", padding: "10px 12px",
                borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: T.inputBg || T.card, color: T.text,
                fontFamily: "inherit", fontSize: FONT.base.size, resize: "vertical",
                outline: "none", transition: "border-color .12s",
              }}
              onFocus={e => e.target.style.borderColor = typeData.color}
              onBlur={e => e.target.style.borderColor = T.border}
            />
          </div>

          {/* Chantier */}
          {chantiers.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                Chantier (optionnel)
              </div>
              <div style={{ position: "relative" }}>
                <span style={{
                  position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                  width: 10, height: 10, borderRadius: 3,
                  background: chantierId ? (chantiers.find(c => c.id === chantierId)?.couleur || T.textMuted) : T.textMuted,
                  opacity: chantierId ? 1 : 0.4, pointerEvents:"none",
                }}/>
                <select value={chantierId} onChange={e => setChantierId(e.target.value)} style={{
                  width: "100%", padding: "8px 10px 8px 28px", borderRadius: RADIUS.md,
                  border: `1px solid ${chantierId ? acc.border : T.border}`,
                  background: T.inputBg || T.card, color: chantierId ? T.text : T.textMuted,
                  fontFamily: "inherit", fontSize: FONT.sm.size + 1, outline: "none",
                  fontWeight: chantierId ? 600 : 500,
                }}>
                  <option value="">Aucun chantier</option>
                  {chantiers.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Multi-jours */}
          <div style={{ marginBottom: 18 }}>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
              fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub,
              textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8,
            }}>
              <input type="checkbox" checked={multiJours} onChange={e => setMultiJours(e.target.checked)}
                style={{ accentColor: acc.accent, width: 14, height: 14 }}/>
              Événement multi-jours
            </label>
            {multiJours && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: FONT.sm.size, color: T.textMuted }}>du</span>
                <span style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 600 }}>{day}/{String(month+1).padStart(2,"0")}/{year}</span>
                <span style={{ fontSize: FONT.sm.size, color: T.textMuted }}>au</span>
                <input type="date" value={dateFin} min={startDateIso}
                  onChange={e => setDateFin(e.target.value)}
                  style={{
                    padding: "6px 10px", borderRadius: RADIUS.md,
                    border: `1px solid ${dateFin ? acc.border : T.border}`,
                    background: T.inputBg || T.card,
                    color: dateFin ? T.text : T.textMuted,
                    fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                    fontWeight: dateFin ? 600 : 500,
                  }}/>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {existing ? (
              <button onClick={() => onDelete(existing.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "transparent", border: `1px solid rgba(225,90,90,0.35)`,
                borderRadius: RADIUS.md, padding: "8px 14px", color: "#e15a5a",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            ) : <div />}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{
                background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md, padding: "8px 16px", color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={handleSave} disabled={!texte.trim() || saving} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: saving || !texte.trim() ? T.textMuted : typeData.color,
                border: "none", borderRadius: RADIUS.md, padding: "8px 18px",
                color: "#fff", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: saving || !texte.trim() ? "not-allowed" : "pointer",
              }}>
                {saving ? "Enregistrement…" : <><Icon as={Check} size={13}/> Enregistrer</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────────────
function PagePlanningMensuel({ T, chantiers = [], branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const today = new Date();
  const [month, setMonth]     = useState(today.getMonth());
  const [year, setYear]       = useState(today.getFullYear());
  const [events, setEvents]   = useState([]);
  const [modal, setModal]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [filterChantier, setFilterChantier] = useState("");
  const [recapExpanded, setRecapExpanded] = useState(false);
  const [weatherByDay, setWeatherByDay] = useState({});

  // ── Chargement events depuis Supabase ──
  //    On élargit la fenêtre pour capturer les events multi-jours qui
  //    commencent avant le mois ou se terminent après.
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      // 3 mois avant → 1 mois après pour couvrir les multi-jours
      const monthStart = new Date(year, month - 3, 1);
      const monthEnd   = new Date(year, month + 2, 0);
      const { data, error } = await supabase
        .from("planning_mensuel")
        .select("*")
        .gte("date", toIsoDate(monthStart))
        .lte("date", toIsoDate(monthEnd));
      if (error) {
        console.warn("planning_mensuel:", error.message);
        setEvents([]);
      } else {
        setEvents(data || []);
      }
    } catch (e) {
      console.error(e);
      setEvents([]);
    }
    setLoading(false);
  }, [month, year]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Météo du mois (Open-Meteo, gratuit, sans clé).
  //    On ne fetch que pour les jours dans la fenêtre de prévision (~14 j).
  useEffect(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const todayD   = new Date(); todayD.setHours(0,0,0,0);
    const maxForecast = new Date(todayD); maxForecast.setDate(todayD.getDate() + 14);
    if (lastDay < todayD || firstDay > maxForecast) { setWeatherByDay({}); return; }

    const start = toIsoDate(firstDay < todayD ? todayD : firstDay);
    const end   = toIsoDate(lastDay > maxForecast ? maxForecast : lastDay);
    const city = localStorage.getItem("dash_weather_city") || "Paris";

    let cancelled = false;
    (async () => {
      try {
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`).then(r => r.json());
        const loc = geo?.results?.[0];
        if (!loc) return;
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code&start_date=${start}&end_date=${end}&timezone=Europe%2FParis`).then(r => r.json());
        if (cancelled || !f?.daily) return;
        const map = {};
        (f.daily.time || []).forEach((iso, i) => {
          map[iso] = { code: f.daily.weather_code[i] };
        });
        setWeatherByDay(map);
      } catch (e) { /* météo non bloquant */ }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  // ── Sauvegarde ──
  const handleSave = async (payload) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(modal.day).padStart(2, "0")}`;
    if (modal.existing) {
      const { error } = await supabase
        .from("planning_mensuel")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", modal.existing.id);
      if (!error) {
        setEvents(prev => prev.map(e => e.id === modal.existing.id ? { ...e, ...payload } : e));
      } else {
        console.warn("Update planning_mensuel:", error.message);
      }
    } else {
      const { data, error } = await supabase
        .from("planning_mensuel")
        .insert({ date: dateStr, ...payload, created_at: new Date().toISOString() })
        .select()
        .single();
      if (!error && data) {
        setEvents(prev => [...prev, data]);
      } else if (error) {
        console.warn("Insert planning_mensuel:", error.message);
      }
    }
    setModal(null);
  };

  const handleDelete = async (id) => {
    await supabase.from("planning_mensuel").delete().eq("id", id);
    setEvents(prev => prev.filter(e => e.id !== id));
    setModal(null);
  };

  // ── Navigation mois ──
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setMonth(today.getMonth()); setYear(today.getFullYear()); };

  // ── Construction du calendrier ──
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7;

  // Renvoie les events d'un jour donné (singles + multi-jours qui chevauchent)
  const getEventsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return events.filter(e => {
      const fin = e.date_fin || e.date;
      const overlaps = e.date <= dateStr && dateStr <= fin;
      if (!overlaps) return false;
      if (filterType !== "all" && e.type !== filterType) return false;
      if (filterChantier && e.chantier_id !== filterChantier) return false;
      return true;
    });
  };

  const isToday = (day) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // Compte des events visibles dans le mois courant (pour les badges des filtres type)
  const eventsDuMois = events.filter(e => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end   = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    const fin = e.date_fin || e.date;
    return e.date <= end && fin >= start;
  });
  const countByType = (typeId) => eventsDuMois.filter(e => e.type === typeId).length;

  // Liste à plat pour le récap, filtrée et triée
  const recapEvents = eventsDuMois
    .filter(e => filterType === "all" || e.type === filterType)
    .filter(e => !filterChantier || e.chantier_id === filterChantier)
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Impression ──
  const handlePrint = () => {
    const monthLabel = `${MOIS_FR[month]} ${year}`;
    const rowsHtml = recapEvents.map(ev => {
      const t = getTypeById(ev.type);
      const d = new Date(ev.date + "T12:00:00");
      const fin = ev.date_fin ? new Date(ev.date_fin + "T12:00:00") : null;
      const dayLabel = fin
        ? `${d.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} → ${fin.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}`
        : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      const ch = ev.chantier_nom ? `<span style="background:${ev.chantier_couleur || "#888"}30;border-left:3px solid ${ev.chantier_couleur || "#888"};padding:2px 6px;border-radius:3px;font-size:10px;margin-left:8px">${ev.chantier_nom}</span>` : "";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;width:160px;font-weight:600">${dayLabel}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;width:140px"><span style="background:${t.bg};color:${t.color};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${t.label}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${ev.texte}${ch}</td>
      </tr>`;
    }).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Planning mensuel — ${monthLabel}</title>
      <style>@page{size:A4 portrait;margin:14mm}body{font-family:Arial,sans-serif;font-size:12px;color:#1a1f2e}
      h1{font-size:18px;margin:0 0 4px}.sub{font-size:11px;color:#666;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}thead th{background:#1a1f2e;color:#fff;padding:8px 10px;text-align:left;font-size:11px}
      </style></head><body>
      <h1>Planning mensuel — ${monthLabel}</h1>
      <div class="sub">${recapEvents.length} événement${recapEvents.length > 1 ? "s" : ""} · imprimé le ${new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Description</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="3" style="padding:14px;text-align:center;color:#888">Aucun événement</td></tr>`}</tbody></table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // ── Styles communs ──
  const navBtn = {
    width: 32, height: 32, borderRadius: RADIUS.md,
    background: "transparent", border: `1px solid ${T.border}`,
    color: T.textSub, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    transition: "border-color .12s, color .12s, background .12s",
  };

  return (
    <div className="pm-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <style>{`
        @media (max-width:767px) {
          .pm-page .pm-header{padding:10px 12px!important;gap:8px!important}
          .pm-page .pm-title{font-size:16px!important}
          .pm-page .pm-month-label{min-width:120px!important;font-size:14px!important;padding:5px 8px!important}
          .pm-page .pm-filters{margin-left:0!important;width:100%!important;overflow-x:auto;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch}
          .pm-page .pm-filters button,.pm-page .pm-filters select{flex:0 0 auto;padding:5px 10px!important;font-size:11px!important;white-space:nowrap}
          .pm-page .pm-body{padding:10px 10px 20px!important}
          .pm-page .pm-calendar{grid-auto-rows:60px!important;gap:2px!important}
          .pm-page .pm-day{padding:3px 3px 2px!important;border-radius:6px!important}
          .pm-page .pm-day-number{font-size:11px!important}
          .pm-page .pm-event-chip{font-size:9px!important;padding:1px 4px!important;line-height:13px!important}
          .pm-page .pm-event-chip-text{display:none}
          .pm-page .pm-recap-row{padding:8px 10px!important;flex-wrap:wrap!important;gap:6px!important}
          .pm-page .pm-recap-day{min-width:64px!important;font-size:10px!important}
          .pm-page .pm-recap-text{font-size:12px!important;flex:1 1 100%!important;order:3}
        }
      `}</style>

      {/* ── Header ── */}
      <div className="pm-header" style={{
        padding: "14px 28px", borderBottom: `1px solid ${T.headerBorder || T.border}`,
        background: T.surface, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={CalendarDays} size={18} strokeWidth={2}/>
          </div>
          <div className="pm-title" style={{ fontSize: FONT.xl.size, fontWeight: 800, letterSpacing: -0.3, color: T.text }}>
            Planning mensuel
          </div>
        </div>

        {/* Navigation mois */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button title="Mois précédent" onClick={prevMonth} style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={ChevronLeft} size={16}/>
          </button>
          <div className="pm-month-label" style={{
            fontSize: FONT.md.size, fontWeight: 700, padding: "6px 16px",
            background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
            minWidth: 180, textAlign: "center", color: T.text,
          }}>
            {MOIS_FR[month]} {year}
          </div>
          <button title="Mois suivant" onClick={nextMonth} style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={ChevronRight} size={16}/>
          </button>
          <button title="Ce mois" onClick={goToday} style={{
            ...navBtn, width: "auto", padding: "0 12px", gap: 6,
            fontSize: FONT.xs.size + 1, fontWeight: 600, letterSpacing: .4, textTransform: "uppercase",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={CalendarCheck} size={13}/>
            Aujourd'hui
          </button>
        </div>

        {/* Filtres + impression */}
        <div className="pm-filters" style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setFilterType("all")} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 11px", borderRadius: RADIUS.md, fontFamily: "inherit",
            fontSize: FONT.xs.size + 1, fontWeight: filterType === "all" ? 700 : 600,
            border: `1px solid ${filterType === "all" ? acc.accent : T.border}`,
            background: filterType === "all" ? acc.bg10 : "transparent",
            color: filterType === "all" ? acc.accent : T.textSub, cursor: "pointer",
          }}>
            Tous
            <span style={{ fontSize: FONT.xs.size, fontWeight: 700, opacity: filterType === "all" ? .8 : .55 }}>
              ({eventsDuMois.length})
            </span>
          </button>
          {EVENT_TYPES.map(t => {
            const active = filterType === t.id;
            return (
              <button key={t.id} onClick={() => setFilterType(t.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 11px", borderRadius: RADIUS.md, fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: active ? 700 : 600,
                border: `1px solid ${active ? t.color : T.border}`,
                background: active ? t.bg : "transparent",
                color: active ? t.color : T.textSub, cursor: "pointer",
              }}>
                <Icon as={t.icon} size={11}/>
                {t.label}
                <span style={{ fontSize: FONT.xs.size, fontWeight: 700, opacity: active ? .8 : .55 }}>
                  ({countByType(t.id)})
                </span>
              </button>
            );
          })}

          {/* Filtre chantier */}
          {chantiers.length > 0 && (
            <div style={{ position: "relative", minWidth: 150 }}>
              {filterChantier && (
                <span style={{
                  position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                  width: 9, height: 9, borderRadius: 2,
                  background: chantiers.find(c => c.id === filterChantier)?.couleur || T.textMuted,
                  pointerEvents: "none",
                }}/>
              )}
              <select value={filterChantier} onChange={e => setFilterChantier(e.target.value)} style={{
                width: "100%",
                padding: filterChantier ? "5px 22px 5px 26px" : "5px 10px",
                borderRadius: RADIUS.md,
                border: `1px solid ${filterChantier ? acc.border : T.border}`,
                background: T.card, color: filterChantier ? T.text : T.textSub,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1,
                fontWeight: filterChantier ? 700 : 600,
                outline: "none", cursor: "pointer",
              }}>
                <option value="">Tous les chantiers</option>
                {chantiers.map(c => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
              {filterChantier && (
                <button onClick={() => setFilterChantier("")} title="Retirer le filtre"
                  style={{
                    position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none", color: T.textMuted,
                    cursor: "pointer", padding: 2, borderRadius: 3,
                    display: "inline-flex", alignItems: "center",
                  }}>
                  <Icon as={X} size={11}/>
                </button>
              )}
            </div>
          )}

          <button title="Imprimer / Exporter" onClick={handlePrint} style={{ ...navBtn, marginLeft: 4 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={Printer} size={15}/>
          </button>
        </div>
      </div>

      {/* ── Corps ── */}
      <div className="pm-body" style={{ flex: 1, padding: "20px 28px", overflow: "auto" }}>

        {/* Banner première utilisation */}
        {!loading && events.length === 0 && (
          <div style={{
            background: acc.bg10, border: `1px dashed ${acc.border}`,
            borderRadius: RADIUS.lg, padding: "14px 18px", marginBottom: 16,
            fontSize: FONT.sm.size, color: T.textSub, display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: RADIUS.md,
              background: acc.bg20, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon as={Lightbulb} size={16}/>
            </div>
            <div>
              <strong style={{ color: T.text }}>Première utilisation</strong> — Cliquez sur n'importe quel jour pour ajouter un objectif, une date importante ou une note. Les événements peuvent s'étaler sur plusieurs jours et être liés à un chantier.
            </div>
          </div>
        )}

        {/* En-tête jours de la semaine */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2, marginBottom: 4,
        }}>
          {JOURS_COURTS.map(j => (
            <div key={j} style={{
              textAlign: "center", fontSize: FONT.xs.size, fontWeight: 700,
              color: T.textMuted, padding: "6px 0", letterSpacing: 1.5, textTransform: "uppercase",
            }}>{j}</div>
          ))}
        </div>

        {/* Grille calendrier */}
        <div className="pm-calendar" style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "120px",
          gap: 4,
        }}>
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} style={{
              borderRadius: RADIUS.md,
              background: "rgba(255,255,255,0.02)",
              border: `1px solid transparent`,
            }} />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
            const dayEvents = getEventsForDay(day);
            const todayMark = isToday(day);
            const dateObj = new Date(year, month, day);
            const weekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
            const dateIso = toIsoDate(dateObj);
            const w = weatherByDay[dateIso];
            const wi = w ? weatherInfo(w.code) : null;

            return (
              <div
                key={day}
                className="pm-day"
                onClick={() => setModal({ day, existing: null })}
                style={{
                  borderRadius: RADIUS.lg,
                  padding: "6px 7px 4px",
                  background: todayMark
                    ? acc.bg10
                    : weekend
                      ? "rgba(255,255,255,0.02)"
                      : T.card,
                  border: `1px solid ${todayMark ? acc.border : T.border}`,
                  cursor: "pointer", transition: "all .15s",
                  display: "flex", flexDirection: "column", gap: 3,
                  overflow: "hidden",
                }}
                onMouseEnter={e => {
                  if (!todayMark) e.currentTarget.style.borderColor = T.borderHover || acc.accent;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={e => {
                  if (!todayMark) e.currentTarget.style.borderColor = T.border;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Header de la case : numéro + météo */}
                <div className="pm-day-number" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  flexShrink: 0,
                }}>
                  <div style={{
                    fontSize: FONT.xs.size + 1, fontWeight: todayMark ? 900 : 700,
                    color: todayMark ? acc.accent : weekend ? T.textMuted : T.text,
                  }}>
                    {todayMark ? (
                      <span style={{
                        width: 20, height: 20, borderRadius: "50%",
                        background: acc.accent, color: acc.onAccent,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 900,
                      }}>{day}</span>
                    ) : day}
                  </div>
                  {wi && (
                    <Icon as={wi.icon} size={11} color={wi.color}/>
                  )}
                </div>

                {/* Événements — chip avec icône + texte tronqué + pastille chantier */}
                {dayEvents.slice(0, 3).map(ev => {
                  const t = getTypeById(ev.type);
                  const isMulti = !!ev.date_fin;
                  const isStart = ev.date === dateIso;
                  return (
                    <div
                      key={ev.id}
                      className="pm-event-chip"
                      onClick={e => { e.stopPropagation(); setModal({ day, existing: ev }); }}
                      title={ev.texte + (ev.chantier_nom ? ` — ${ev.chantier_nom}` : "") + (isMulti ? ` (multi-jours)` : "")}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        fontSize: FONT.xs.size, fontWeight: 600, flexShrink: 0,
                        background: t.bg, color: t.color,
                        borderRadius: RADIUS.sm, padding: "2px 6px",
                        border: `1px solid ${t.color}30`,
                        borderLeft: ev.chantier_couleur ? `3px solid ${ev.chantier_couleur}` : `1px solid ${t.color}30`,
                        overflow: "hidden", whiteSpace: "nowrap",
                        cursor: "pointer", lineHeight: "16px", maxWidth: "100%",
                        opacity: isMulti && !isStart ? 0.78 : 1, // continuation un peu estompée
                      }}
                    >
                      <Icon as={isMulti && !isStart ? ChevronsRight : t.icon} size={10}/>
                      <span className="pm-event-chip-text" style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{ev.texte}</span>
                    </div>
                  );
                })}

                {dayEvents.length > 3 && (
                  <div style={{
                    fontSize: FONT.xs.size - 1, fontWeight: 800, color: T.textMuted,
                    padding: "1px 5px", flexShrink: 0,
                  }}>
                    +{dayEvents.length - 3} de plus
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Récapitulatif liste (pliable) ── */}
        {recapEvents.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <button onClick={() => setRecapExpanded(v => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "transparent", border: "none", padding: "4px 0",
              fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: 1.2,
              cursor: "pointer", marginBottom: 12,
            }}>
              <Icon as={recapExpanded ? ChevronDown : ChevronRight} size={13}/>
              Récapitulatif — {MOIS_FR[month]} {year} ({recapEvents.length})
            </button>
            {recapExpanded && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recapEvents.map(ev => {
                  const t = getTypeById(ev.type);
                  const d = new Date(ev.date + "T12:00:00");
                  const fin = ev.date_fin ? new Date(ev.date_fin + "T12:00:00") : null;
                  const dayLabel = fin
                    ? `${d.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} → ${fin.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}`
                    : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
                  return (
                    <div
                      key={ev.id}
                      className="pm-recap-row"
                      onClick={() => setModal({ day: d.getDate(), existing: ev })}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: RADIUS.md,
                        background: T.surface, border: `1px solid ${T.border}`,
                        borderLeft: ev.chantier_couleur ? `4px solid ${ev.chantier_couleur}` : `1px solid ${T.border}`,
                        cursor: "pointer", transition: "border-color .12s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = t.color}
                      onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                    >
                      <div className="pm-recap-day" style={{
                        fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
                        minWidth: 100, textTransform: "capitalize",
                      }}>{dayLabel}</div>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        background: t.bg, color: t.color,
                        borderRadius: RADIUS.sm + 2, padding: "2px 9px",
                        fontSize: FONT.xs.size, fontWeight: 700, flexShrink: 0,
                      }}>
                        <Icon as={t.icon} size={11}/>
                        {t.label}
                      </div>
                      <div className="pm-recap-text" style={{ fontSize: FONT.sm.size, color: T.text, flex: 1 }}>{ev.texte}</div>
                      {ev.chantier_nom && (
                        <span title="Chantier" style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "1px 8px", borderRadius: RADIUS.pill,
                          background: (ev.chantier_couleur || "#888") + "22",
                          border: `1px solid ${(ev.chantier_couleur || "#888")}55`,
                          color: T.text, fontSize: FONT.xs.size, fontWeight: 700,
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: ev.chantier_couleur || "#888" }}/>
                          {ev.chantier_nom}
                        </span>
                      )}
                      <Icon as={Pencil} size={13} color={T.textMuted}/>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <EventModal
          day={modal.day}
          month={month}
          year={year}
          existing={modal.existing}
          onSave={handleSave}
          onClose={() => setModal(null)}
          onDelete={handleDelete}
          T={T} acc={acc}
          chantiers={chantiers}
        />
      )}
    </div>
  );
}

export default PagePlanningMensuel;
