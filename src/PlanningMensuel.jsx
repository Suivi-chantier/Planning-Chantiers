import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ─── TYPES D'ÉVÉNEMENTS ───────────────────────────────────────────────────────
const EVENT_TYPES = [
  { id: "objectif",   label: "Objectif",        color: "#5B8AF5", bg: "rgba(91,138,245,0.15)",  icon: "🎯" },
  { id: "important",  label: "Date importante", color: "#f5a623", bg: "rgba(245,166,35,0.15)",  icon: "⚠️" },
  { id: "tendance",   label: "Tendance",         color: "#50c878", bg: "rgba(80,200,120,0.15)",  icon: "📈" },
  { id: "note",       label: "Note",             color: "#b06dd4", bg: "rgba(176,109,212,0.15)", icon: "📝" },
];

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const JOURS_COURTS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

function getTypeById(id) {
  return EVENT_TYPES.find(t => t.id === id) || EVENT_TYPES[3];
}

// ─── MODAL AJOUT / ÉDITION ────────────────────────────────────────────────────
function EventModal({ day, month, year, existing, onSave, onClose, onDelete, T }) {
  const [type, setType]     = useState(existing?.type || "objectif");
  const [texte, setTexte]   = useState(existing?.texte || "");
  const [saving, setSaving] = useState(false);

  const dateLabel = new Date(year, month, day).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  const handleSave = async () => {
    if (!texte.trim()) return;
    setSaving(true);
    await onSave({ type, texte: texte.trim() });
    setSaving(false);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 16, width: "100%", maxWidth: 480,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px 14px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>
              {existing ? "Modifier l'événement" : "Ajouter un événement"}
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2, textTransform: "capitalize" }}>
              {dateLabel}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: T.textMuted,
            fontSize: 20, cursor: "pointer", lineHeight: 1
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 22px" }}>
          {/* Type selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Type
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {EVENT_TYPES.map(t => (
                <button key={t.id} onClick={() => setType(t.id)} style={{
                  padding: "7px 14px", borderRadius: 20, border: `2px solid`,
                  borderColor: type === t.id ? t.color : T.border,
                  background: type === t.id ? t.bg : "transparent",
                  color: type === t.id ? t.color : T.textSub,
                  fontFamily: "inherit", fontSize: 13, fontWeight: type === t.id ? 700 : 500,
                  cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Texte */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
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
                borderRadius: 8, border: `1px solid ${T.border}`,
                background: T.inputBg || T.card, color: T.text,
                fontFamily: "inherit", fontSize: 14, resize: "vertical",
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {existing ? (
              <button onClick={() => onDelete(existing.id)} style={{
                background: "transparent", border: `1px solid rgba(224,92,92,0.4)`,
                borderRadius: 8, padding: "8px 14px", color: "#e05c5c",
                fontFamily: "inherit", fontSize: 13, cursor: "pointer",
              }}>
                🗑 Supprimer
              </button>
            ) : <div />}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{
                background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 18px", color: T.textSub,
                fontFamily: "inherit", fontSize: 13, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={handleSave} disabled={!texte.trim() || saving} style={{
                background: saving || !texte.trim() ? T.textMuted : getTypeById(type).color,
                border: "none", borderRadius: 8, padding: "9px 22px",
                color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800,
                cursor: saving || !texte.trim() ? "not-allowed" : "pointer",
              }}>
                {saving ? "Enregistrement…" : "✓ Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────────────
function PagePlanningMensuel({ T }) {
  const today = new Date();
  const [month, setMonth]     = useState(today.getMonth());
  const [year, setYear]       = useState(today.getFullYear());
  const [events, setEvents]   = useState([]);
  const [modal, setModal]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");

  // ── Chargement depuis Supabase ────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("planning_mensuel")
        .select("*")
        .gte("date", `${year}-${String(month + 1).padStart(2, "0")}-01`)
        .lte("date", `${year}-${String(month + 1).padStart(2, "0")}-31`);
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

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const handleSave = async ({ type, texte }) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(modal.day).padStart(2, "0")}`;
    if (modal.existing) {
      const { error } = await supabase
        .from("planning_mensuel")
        .update({ type, texte, updated_at: new Date().toISOString() })
        .eq("id", modal.existing.id);
      if (!error) {
        setEvents(prev => prev.map(e => e.id === modal.existing.id ? { ...e, type, texte } : e));
      }
    } else {
      const { data, error } = await supabase
        .from("planning_mensuel")
        .insert({ date: dateStr, type, texte, created_at: new Date().toISOString() })
        .select()
        .single();
      if (!error && data) {
        setEvents(prev => [...prev, data]);
      }
    }
    setModal(null);
  };

  const handleDelete = async (id) => {
    await supabase.from("planning_mensuel").delete().eq("id", id);
    setEvents(prev => prev.filter(e => e.id !== id));
    setModal(null);
  };

  // ── Navigation mois ───────────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setMonth(today.getMonth()); setYear(today.getFullYear()); };

  // ── Construction du calendrier ────────────────────────────────────────────
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7;

  const getEventsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return events.filter(e => e.date === dateStr && (filterType === "all" || e.type === filterType));
  };

  const isToday = (day) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const countByType = (typeId) => events.filter(e => e.type === typeId).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "16px 28px", borderBottom: `1px solid ${T.headerBorder || T.border}`,
        background: T.surface, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>
          📆 PLANNING MENSUEL
        </div>

        {/* Navigation mois */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="navbtn" onClick={prevMonth}>‹</button>
          <div style={{
            fontSize: 17, fontWeight: 800, padding: "6px 16px",
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
            minWidth: 180, textAlign: "center",
          }}>
            {MOIS_FR[month]} {year}
          </div>
          <button className="navbtn" onClick={nextMonth}>›</button>
          <button className="navbtn navbtn-today" onClick={goToday}
            style={{ fontSize: 11, padding: "6px 10px" }}>
            CE MOIS
          </button>
        </div>

        {/* Filtres par type */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setFilterType("all")}
            style={{
              padding: "6px 14px", borderRadius: 20, fontFamily: "inherit", fontSize: 12, fontWeight: 700,
              border: `2px solid ${filterType === "all" ? T.accent : T.border}`,
              background: filterType === "all" ? "rgba(255,194,0,0.1)" : "transparent",
              color: filterType === "all" ? T.accent : T.textSub, cursor: "pointer",
            }}>
            Tous ({events.length})
          </button>
          {EVENT_TYPES.map(t => (
            <button key={t.id} onClick={() => setFilterType(t.id)} style={{
              padding: "6px 14px", borderRadius: 20, fontFamily: "inherit", fontSize: 12, fontWeight: 700,
              border: `2px solid ${filterType === t.id ? t.color : T.border}`,
              background: filterType === t.id ? t.bg : "transparent",
              color: filterType === t.id ? t.color : T.textSub, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {t.icon} {t.label} ({countByType(t.id)})
            </button>
          ))}
        </div>
      </div>

      {/* ── Corps ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: "20px 28px", overflow: "auto" }}>

        {/* Message première utilisation */}
        {!loading && events.length === 0 && (
          <div style={{
            background: "rgba(91,138,245,0.06)", border: "1px dashed rgba(91,138,245,0.3)",
            borderRadius: 12, padding: "14px 20px", marginBottom: 16,
            fontSize: 13, color: T.textMuted, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div>
              <strong style={{ color: T.text }}>Première utilisation</strong> — Cliquez sur n'importe quel jour pour ajouter un objectif, une date importante ou une tendance.
              <br />
              <span style={{ fontSize: 12 }}>
                Note : créez la table <code style={{ background: T.card, padding: "1px 5px", borderRadius: 4 }}>planning_mensuel</code> dans Supabase avec les colonnes : id (uuid, pk), date (date), type (text), texte (text), created_at (timestamptz), updated_at (timestamptz).
              </span>
            </div>
          </div>
        )}

        {/* Grille jours de la semaine */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2, marginBottom: 4,
        }}>
          {JOURS_COURTS.map(j => (
            <div key={j} style={{
              textAlign: "center", fontSize: 11, fontWeight: 800,
              color: T.textMuted, padding: "6px 0", letterSpacing: 1, textTransform: "uppercase",
            }}>{j}</div>
          ))}
        </div>

        {/* ── Grille calendrier — hauteur fixe par ligne ─────────────────── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "120px",   /* ← hauteur fixe : toutes les cases font 120px */
          gap: 4,
        }}>
          {/* Cellules vides avant le 1er */}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} style={{
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: `1px solid transparent`,
            }} />
          ))}

          {/* Jours du mois */}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
            const dayEvents = getEventsForDay(day);
            const todayMark = isToday(day);
            const weekend = (() => {
              const d = new Date(year, month, day).getDay();
              return d === 0 || d === 6;
            })();

            return (
              <div
                key={day}
                onClick={() => setModal({ day, existing: null })}
                style={{
                  /* Hauteur contrôlée par gridAutoRows, pas de minHeight ici */
                  borderRadius: 10,
                  padding: "6px 7px 4px",
                  background: todayMark
                    ? "rgba(255,194,0,0.08)"
                    : weekend
                      ? "rgba(255,255,255,0.02)"
                      : T.card,
                  border: `1px solid ${todayMark ? "rgba(255,194,0,0.4)" : T.border}`,
                  cursor: "pointer", transition: "all .15s",
                  /* Flex colonne, overflow caché = la case ne grandit jamais */
                  display: "flex", flexDirection: "column", gap: 3,
                  overflow: "hidden",
                }}
                onMouseEnter={e => {
                  if (!todayMark) e.currentTarget.style.borderColor = T.borderHover || T.accent;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={e => {
                  if (!todayMark) e.currentTarget.style.borderColor = T.border;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Numéro du jour */}
                <div style={{
                  fontSize: 12, fontWeight: todayMark ? 900 : 700, flexShrink: 0,
                  color: todayMark ? "#FFC200" : weekend ? T.textMuted : T.text,
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {todayMark ? (
                    <span style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "#FFC200", color: "#111",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 900,
                    }}>{day}</span>
                  ) : day}
                </div>

                {/* Événements — tronqués sur une seule ligne */}
                {dayEvents.slice(0, 3).map(ev => {
                  const t = getTypeById(ev.type);
                  return (
                    <div
                      key={ev.id}
                      onClick={e => { e.stopPropagation(); setModal({ day, existing: ev }); }}
                      title={ev.texte}   /* ← texte complet au survol */
                      style={{
                        fontSize: 10, fontWeight: 600, flexShrink: 0,
                        background: t.bg, color: t.color,
                        borderRadius: 4, padding: "2px 6px",
                        border: `1px solid ${t.color}30`,
                        /* Une seule ligne, texte tronqué avec "…" */
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        lineHeight: "16px",
                        maxWidth: "100%",
                      }}
                    >
                      {t.icon} {ev.texte}
                    </div>
                  );
                })}

                {/* Badge "+N" si plus de 3 événements */}
                {dayEvents.length > 3 && (
                  <div style={{
                    fontSize: 9, fontWeight: 800, color: T.textMuted,
                    padding: "1px 5px", flexShrink: 0,
                  }}>
                    +{dayEvents.length - 3} de plus
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Récapitulatif liste ───────────────────────────────────────────── */}
        {events.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{
              fontSize: 13, fontWeight: 800, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: 1, marginBottom: 12,
            }}>
              Récapitulatif — {MOIS_FR[month]} {year}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {events
                .filter(e => filterType === "all" || e.type === filterType)
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(ev => {
                  const t = getTypeById(ev.type);
                  const d = new Date(ev.date + "T12:00:00");
                  const dayLabel = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setModal({ day: d.getDate(), existing: ev })}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: 10,
                        background: T.surface, border: `1px solid ${T.border}`,
                        cursor: "pointer", transition: "all .12s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = t.color}
                      onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 800, color: T.textMuted,
                        minWidth: 80, textTransform: "capitalize",
                      }}>{dayLabel}</div>
                      <div style={{
                        background: t.bg, color: t.color,
                        borderRadius: 5, padding: "2px 9px", fontSize: 11, fontWeight: 700,
                        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                      }}>
                        {t.icon} {t.label}
                      </div>
                      <div style={{ fontSize: 13, color: T.text, flex: 1 }}>{ev.texte}</div>
                      <div style={{ fontSize: 12, color: T.textMuted }}>✏️</div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modal && (
        <EventModal
          day={modal.day}
          month={month}
          year={year}
          existing={modal.existing}
          onSave={handleSave}
          onClose={() => setModal(null)}
          onDelete={handleDelete}
          T={T}
        />
      )}
    </div>
  );
}

export default PagePlanningMensuel;
