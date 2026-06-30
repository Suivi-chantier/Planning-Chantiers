import CellModal from "./CellModal";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { JOURS, emptyCell, parseTachesFromPlanifie, getCurrentWeek, getTodayJour, getBranchAccent, FONT, RADIUS, SHADOW } from "../constants";
import { useIsMobile } from "./Navigation";
import { Icon } from "../ui";
import { CARD_SHADOW, SummaryBar, MobileSection } from "../mobileUI";
import {
  ChevronLeft, ChevronRight, Printer, Calendar, Plus, CalendarCheck, Package, StickyNote,
  ArrowRightLeft, Clock, TriangleAlert, Check,
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, Zap,
} from "lucide-react";

const MOIS_COURTS = ["jan","fév","mar","avr","mai","jun","jul","aoû","sep","oct","nov","déc"];

// Calcule la luminance d'une couleur hex et renvoie un texte lisible (blanc ou foncé).
function contrastText(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return "#111";
  const h = hex.length === 4 ? "#" + hex.slice(1).split("").map(c => c+c).join("") : hex;
  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.62 ? "#1a1f2e" : "#ffffff";
}

// Code WMO → icône + couleur (compact pour la vue planning).
function weatherInfo(code) {
  if (code == null)                       return null;
  if (code === 0)                         return { icon: Sun,          color: "#f5a623", label: "Ensoleillé" };
  if (code >= 1 && code <= 3)             return { icon: Cloud,        color: "#94a3b8", label: "Nuageux" };
  if (code === 45 || code === 48)         return { icon: CloudFog,     color: "#94a3b8", label: "Brouillard" };
  if (code >= 51 && code <= 57)           return { icon: CloudDrizzle, color: "#5b8af5", label: "Bruine" };
  if (code >= 61 && code <= 67)           return { icon: CloudRain,    color: "#5b8af5", label: "Pluie" };
  if (code >= 71 && code <= 77)           return { icon: CloudSnow,    color: "#cbd5e1", label: "Neige" };
  if (code >= 80 && code <= 82)           return { icon: CloudRain,    color: "#5b8af5", label: "Averses" };
  if (code >= 95 && code <= 99)           return { icon: Zap,          color: "#a855f7", label: "Orage" };
  return                                         { icon: Cloud,        color: "#94a3b8", label: "Variable" };
}

const toIsoDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

// ─── PAGE PLANNING ────────────────────────────────────────────────────────────
function PagePlanning({ chantiers: chantiersAll, ouvriers, ouvrierEmails, vehicules = [], cells, setCells, commandes, setCommandes, notesData, setNotesData, weekId, view, setView, year, week, setYear, setWeek, T, branch = "renovation" }) {
  // Un chantier marqué "Terminé" (dans la page Chantiers) disparaît du planning hebdo.
  const chantiers = useMemo(() => chantiersAll.filter(c => c.statut !== "termine"), [chantiersAll]);
  const isMobile = useIsMobile();
  const acc = getBranchAccent(branch);
  // Vue forcée à "planifie" — les vues "réel" et "bilan" ont été retirées
  // car peu utilisées (les rapports ouvriers couvrent déjà le réel).
  const v = "planifie";
  const [modal, setModal] = useState(null);
  const [cellDraft, setCellDraft] = useState(null);
  const [cmdDraft, setCmdDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileDay, setMobileDay] = useState(() => getTodayJour() || "Lundi");
  // Menu "déplacer vers …" — ancré sur la position du bouton dans la viewport.
  const [moveMenu, setMoveMenu] = useState(null); // { cId, jour, taskIdx, x, y }

  const prevWeek = () => { if (week === 1) { setYear(y => y - 1); setWeek(52); } else setWeek(w => w - 1); };
  const nextWeek = () => { if (week === 52) { setYear(y => y + 1); setWeek(1); } else setWeek(w => w + 1); };
  const goNow = () => { const { year:y, week:w } = getCurrentWeek(); setYear(y); setWeek(w); };

  const getDateDuJour = (dayIndex) => {
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d;
  };

  // ── Total d'heures par ouvrier sur la semaine, calculé depuis les tâches
  //    structurées (taches[].duree, distribuées sur taches[].ouvriers).
  //    Si une tâche n'a pas d'ouvriers spécifiés, elle s'applique à tous les
  //    ouvriers de la cellule.
  const heuresParOuvrier = useMemo(() => {
    const totals = {};
    chantiers.forEach(c => {
      JOURS.forEach(jour => {
        const cell = cells[`${c.id}_${jour}`];
        if (!cell?.taches) return;
        cell.taches.forEach(t => {
          const duree = parseFloat(t.duree) || 0;
          if (duree === 0) return;
          const ouvs = (t.ouvriers && t.ouvriers.length > 0) ? t.ouvriers : (cell.ouvriers || []);
          ouvs.forEach(o => { totals[o] = (totals[o] || 0) + duree; });
        });
      });
    });
    return totals;
  }, [chantiers, cells]);

  // ── Météo de la semaine (Open-Meteo, gratuit, sans clé).
  //    On ne fetch que si la semaine est dans la fenêtre de prévision
  //    (~14 jours dans le futur, depuis aujourd'hui).
  const [weatherByDay, setWeatherByDay] = useState({});
  useEffect(() => {
    const monday = getDateDuJour(0);
    const friday = getDateDuJour(4);
    const today  = new Date(); today.setHours(0,0,0,0);
    const maxForecast = new Date(today); maxForecast.setDate(today.getDate() + 14);
    if (friday < today || monday > maxForecast) { setWeatherByDay({}); return; }

    const city = localStorage.getItem("dash_weather_city") || "Paris";
    let cancelled = false;
    (async () => {
      try {
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`).then(r => r.json());
        const loc = geo?.results?.[0];
        if (!loc) return;
        const start = toIsoDate(monday), end = toIsoDate(friday);
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,precipitation_sum&start_date=${start}&end_date=${end}&timezone=Europe%2FParis`).then(r => r.json());
        if (cancelled || !f?.daily) return;
        const map = {};
        (f.daily.time || []).forEach((iso, i) => {
          map[iso] = {
            code: f.daily.weather_code[i],
            tempMax: f.daily.temperature_2m_max[i],
            rain: f.daily.precipitation_sum[i],
          };
        });
        setWeatherByDay(map);
      } catch (e) { /* silencieux : météo est non bloquant */ }
    })();
    return () => { cancelled = true; };
  }, [year, week]);

  const getCell = (cId, jour) => {
    if (modal?.cId === cId && modal?.jour === jour && cellDraft) return cellDraft;
    return cells[`${cId}_${jour}`] || emptyCell();
  };

  const openModal = (cId, jour) => {
    setModal({ cId, jour });
    const existing = cells[`${cId}_${jour}`] || emptyCell();
    const taches = parseTachesFromPlanifie(existing.planifie, existing.taches);
    setCellDraft({ ...existing, taches });
    setCmdDraft(commandes[cId] || "");
    setNoteDraft(notesData[cId] || "");
  };

  // Liste de tâches affichables pour une cellule. Si `taches` est vide mais
  // que `planifie` contient du texte (ancien format), on découpe ligne à ligne
  // pour pouvoir quand même proposer un bouton "déplacer".
  const getDisplayTaches = (cell) => {
    if (cell.taches?.length > 0) return cell.taches;
    if (cell.planifie?.trim()) {
      return cell.planifie.split("\n").filter(l => l.trim()).map((text, i) => ({
        id: `legacy-${i}`, text, ouvriers: [],
      }));
    }
    return [];
  };

  // Déplace une tâche d'un jour à un autre sur le même chantier.
  // Met à jour les deux cellules en local puis sur Supabase.
  const moveTache = async (cId, fromJour, taskIdx, toJour) => {
    setMoveMenu(null);
    if (fromJour === toJour) return;
    const fromKey = `${cId}_${fromJour}`;
    const toKey   = `${cId}_${toJour}`;
    const fromCell = cells[fromKey] || emptyCell();
    // On reconstruit toujours des tâches avec id stable (pour les legacy).
    const fromTaches = getDisplayTaches(fromCell).map(t =>
      String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t
    );
    if (taskIdx < 0 || taskIdx >= fromTaches.length) return;
    const moved = fromTaches[taskIdx];
    const newFromTaches = fromTaches.filter((_, i) => i !== taskIdx);
    const newFromCell = {
      ...fromCell,
      taches: newFromTaches,
      planifie: newFromTaches.map(t => t.text).join("\n"),
    };
    const toCell = cells[toKey] || emptyCell();
    const toTaches = getDisplayTaches(toCell).map(t =>
      String(t.id).startsWith("legacy-") ? { ...t, id: Math.random().toString(36).slice(2) } : t
    );
    const newToTaches = [...toTaches, moved];
    const newToCell = {
      ...toCell,
      taches: newToTaches,
      planifie: newToTaches.map(t => t.text).join("\n"),
    };
    setCells(prev => ({ ...prev, [fromKey]: newFromCell, [toKey]: newToCell }));
    await Promise.all([
      supabase.from("planning_cells").upsert(
        { week_id: weekId, chantier_id: cId, jour: fromJour, ...newFromCell },
        { onConflict: "week_id,chantier_id,jour" }
      ),
      supabase.from("planning_cells").upsert(
        { week_id: weekId, chantier_id: cId, jour: toJour, ...newToCell },
        { onConflict: "week_id,chantier_id,jour" }
      ),
    ]);
  };

  const closeModal = async () => {
    if (!modal || !cellDraft) { setModal(null); return; }
    const { cId, jour } = modal;
    setSaving(true);
    const taches = (cellDraft.taches || []).filter(t => t.text.trim());
    const planifie = taches.map(t => t.text).join("\n");
    const finalDraft = { ...cellDraft, taches, planifie };
    setCells(prev => ({ ...prev, [`${cId}_${jour}`]: finalDraft }));
    setCommandes(prev => ({ ...prev, [cId]: cmdDraft }));
    setNotesData(prev => ({ ...prev, [cId]: noteDraft }));
    await Promise.all([
      supabase.from("planning_cells").upsert({ week_id: weekId, chantier_id: cId, jour, ...finalDraft }, { onConflict: "week_id,chantier_id,jour" }),
      supabase.from("planning_commandes").upsert({ week_id: weekId, chantier_id: cId, contenu: cmdDraft }, { onConflict: "week_id,chantier_id" }),
      supabase.from("planning_notes").upsert({ chantier_id: cId, contenu: noteDraft }, { onConflict: "chantier_id" }),
    ]);
    setSaving(false); setModal(null); setCellDraft(null);
  };

  // ── Google Calendar : lien direct par cellule ──
  const makeGCalUrl = (chantier, jour, dayIndex, cell) => {
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
    const d = new Date(mon); d.setDate(mon.getDate() + dayIndex);
    const pad = n => String(n).padStart(2,'0');
    const dateStr = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
    const endHour = dayIndex <= 2 ? '173000' : '163000';
    const startDt = `${dateStr}T073000`;
    const endDt = `${dateStr}T${endHour}`;
    const taches = (cell.taches || []).filter(t => t.text?.trim());
    const lignes = taches.length
      ? taches.map(t => `• ${t.text}${t.duree ? ` (${t.duree}h)` : ''}${t.ouvriers?.length ? ` → ${t.ouvriers.join(', ')}` : ' → tous'}`)
      : (cell.planifie || '').split('\n').filter(l => l.trim()).map(l => `• ${l}`);
    const ouv = (cell.ouvriers || []).map(n => n.toUpperCase()).join(' ');
    const title = ouv ? `${chantier.nom} / ${ouv}` : chantier.nom;
    const descLines = [...lignes];
    if (cell.reel) descLines.push('', 'Réalisé :', cell.reel);
    descLines.push('', 'Compte rendu : https://planning-chantiers.vercel.app/rapport#rapport');
    const params = new URLSearchParams({
      action: 'TEMPLATE', text: title, dates: `${startDt}/${endDt}`,
      details: descLines.join('\n'), ctz: 'Europe/Paris',
    });
    const emails = (cell.ouvriers || []).map(n => ouvrierEmails?.[n]).filter(Boolean);
    if (emails.length) params.append('add', emails.join(','));
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const handlePrint = () => {
    const vl = { "planifie":"PLANNING PLANIFIÉ", "reel":"RÉEL", "compare":"BILAN COMPARATIF" }[view];
    const rows = chantiers.map(c => {
      const cols = JOURS.map(j => {
        const cell = getCell(c.id, j); let html = "";
        if (view === "compare") {
          if (cell.planifie) html += `<div style="color:#3060c0">▸ ${cell.planifie.replace(/\n/g,"<br>")}</div>`;
          if (cell.reel)     html += `<div style="color:#207040">✓ ${cell.reel.replace(/\n/g,"<br>")}</div>`;
        } else if (cell[view]) html += cell[view].replace(/\n/g,"<br>");
        if (cell.ouvriers?.length) html += `<div style="font-weight:700;color:#666;font-size:9px;border-top:1px solid #eee;padding-top:3px;margin-top:4px">${cell.ouvriers.join(" · ")}</div>`;
        return `<td>${html || "—"}</td>`;
      }).join("");
      return `<tr><td style="font-weight:800;font-size:11px;text-transform:uppercase;background:${c.couleur};color:${contrastText(c.couleur)};width:100px">${c.nom}</td>${cols}</tr>`;
    }).join("");
    const w = window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Planning S${week}—${year}</title>
    <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:10px}
    h1{font-size:16px;margin-bottom:2px}.sub{font-size:10px;color:#666;margin-bottom:12px}
    table{width:100%;border-collapse:collapse}th{background:#1a1f2e;color:#fff;padding:6px 8px;text-align:center;font-size:11px}
    td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;line-height:1.4}
    </style></head><body>
    <h1>Planning — Semaine ${week} / ${year}</h1>
    <div class="sub">${vl} · ${new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
    <table><thead><tr><th>Chantier</th>${JOURS.map(j => `<th>${j}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    w.document.close(); setTimeout(() => w.print(), 400);
  };

  const modalChantier = modal ? chantiers.find(c => c.id === modal.cId) : null;

  // ── Styles compacts pour la barre de header ──
  const navBtn = {
    width: 32, height: 32, borderRadius: RADIUS.md,
    background: "transparent", border: `1px solid ${T.border}`,
    color: T.textSub, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    transition: "border-color .12s, color .12s, background .12s",
  };
  const tabBtn = (active) => ({
    padding: "7px 14px",
    border: "none",
    borderRadius: RADIUS.md,
    fontFamily: "inherit",
    fontSize: FONT.xs.size + 1,
    fontWeight: active ? 800 : 600,
    letterSpacing: 1,
    textTransform: "uppercase",
    cursor: "pointer",
    background: active ? acc.accent : "transparent",
    color: active ? acc.onAccent : T.textSub,
    transition: "background .12s, color .12s",
  });

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
      <style>{`
        .cell-with-agenda:hover .cell-agenda-btn { opacity: .85 !important; pointer-events: auto !important; }
        .cell-with-agenda .cell-agenda-btn:hover { opacity: 1 !important; }
        .cell-with-agenda:hover .tache-move-btn { opacity: .6 !important; pointer-events: auto !important; }
        .tache-move-btn:hover { opacity: 1 !important; }
      `}</style>

      {/* ── Menu "déplacer vers …" (popup ancré sur le bouton) ── */}
      {moveMenu && (
        <>
          <div onClick={() => setMoveMenu(null)}
            style={{ position:"fixed", inset:0, zIndex:100, background:"transparent" }}/>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              position:"fixed",
              top: Math.min(moveMenu.y + 4, window.innerHeight - 60),
              left: Math.max(8, Math.min(moveMenu.x - 220, window.innerWidth - 230)),
              zIndex:101, background:T.modal, border:`1px solid ${T.border}`,
              borderRadius:RADIUS.md, padding:6, boxShadow:SHADOW.lg,
              display:"flex", flexDirection:"column", gap:4, minWidth:210,
            }}>
            <div style={{
              fontSize:10, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase",
              color:T.textMuted, padding:"2px 4px 4px",
            }}>
              Déplacer vers
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {JOURS.filter(j => j !== moveMenu.jour).map(targetJour => (
                <button key={targetJour}
                  onClick={() => moveTache(moveMenu.cId, moveMenu.jour, moveMenu.taskIdx, targetJour)}
                  style={{
                    flex:"1 1 auto",
                    background:"transparent", border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.sm, padding:"6px 10px",
                    fontSize:11, fontWeight:700, letterSpacing:.6, textTransform:"uppercase",
                    cursor:"pointer", color:T.textSub, fontFamily:"inherit", transition:"all .1s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = acc.accent;
                    e.currentTarget.style.color = acc.onAccent;
                    e.currentTarget.style.borderColor = acc.accent;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = T.textSub;
                    e.currentTarget.style.borderColor = T.border;
                  }}>
                  {targetJour.slice(0,3)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {modal && cellDraft && <CellModal
        chantier={modalChantier}
        jour={modal.jour}
        draft={cellDraft} setDraft={setCellDraft}
        commande={{ value: cmdDraft, set: setCmdDraft }}
        note={{ value: noteDraft, set: setNoteDraft }}
        ouvriers={ouvriers} vehicules={vehicules} saving={saving} onClose={closeModal}
        T={T} weekId={weekId} year={year} week={week}
      />}

      {/* ── HEADER ── */}
      <div className="planning-header" style={{
        padding:"14px 28px",
        borderBottom:`1px solid ${T.headerBorder}`,
        display:"flex", alignItems:"center", gap:14,
        flexWrap:"wrap", background: T.surface,
      }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
          <span className="planning-title" style={{
            fontSize: FONT.xl.size, fontWeight: 800, letterSpacing: -0.3, color: T.text,
          }}>
            Semaine {week}
          </span>
          <span style={{ fontSize: FONT.sm.size, color: T.textMuted, fontWeight: 600 }}>
            {year}
          </span>
        </div>

        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button title="Semaine précédente" onClick={prevWeek} style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={ChevronLeft} size={16}/>
          </button>
          <button title="Cette semaine" onClick={goNow} className="navbtn-today" style={{
            ...navBtn, width:"auto", padding:"0 12px", gap: 6,
            fontSize: FONT.xs.size + 1, fontWeight:600, letterSpacing: .4, textTransform: "uppercase",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={CalendarCheck} size={13}/>
            Aujourd'hui
          </button>
          <button title="Semaine suivante" onClick={nextWeek} style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={ChevronRight} size={16}/>
          </button>
        </div>

        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          <button title="Imprimer / Exporter" onClick={handlePrint} style={navBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={Printer} size={15}/>
          </button>
        </div>
      </div>

      {/* === VUE MOBILE === */}
      {isMobile && (
        <div style={{ flex:1, overflowY:"auto", padding:"12px 12px 24px" }}>
          {/* Résumé de la semaine */}
          {(() => {
            const heuresVals = Object.values(heuresParOuvrier);
            const totalH = heuresVals.reduce((s, h) => s + h, 0);
            const surcharge = heuresVals.filter(h => h > 40).length;
            const actifs = chantiers.filter(c => JOURS.some(j => {
              const cell = getCell(c.id, j);
              return cell.planifie || cell.ouvriers?.length > 0;
            })).length;
            return (
              <div style={{ marginBottom:14 }}>
                <SummaryBar T={T} items={[
                  { label:"Chantiers actifs", value:actifs,        color:acc.accent, icon:CalendarCheck },
                  { label:"Heures équipe",    value:`${totalH}h`,   color:"#5b8af5",  icon:Clock },
                  { label: surcharge > 0 ? "En surcharge" : "Charge OK", value: surcharge > 0 ? surcharge : "✓",
                    color: surcharge > 0 ? "#ef4444" : "#22c55e", icon: surcharge > 0 ? TriangleAlert : Check },
                ]}/>
              </div>
            );
          })()}

          {/* Sélecteur de jour en chips */}
          <div className="tabs-scroll" style={{ display:"flex", gap:6, marginBottom:14, paddingBottom:4 }}>
            {JOURS.map((j, di) => {
              const d = getDateDuJour(di);
              const sel = j === mobileDay;
              const today = getTodayJour() === j;
              const w = weatherByDay[toIsoDate(d)];
              const wi = w ? weatherInfo(w.code) : null;
              return (
                <button key={j} onClick={() => setMobileDay(j)} style={{
                  flex:"0 0 auto", padding:"8px 11px", borderRadius:14, cursor:"pointer",
                  fontFamily:"inherit", transition:"all .15s",
                  display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:60,
                  background: sel ? `linear-gradient(135deg, ${acc.accent}, ${acc.accent}cc)` : T.surface,
                  color:      sel ? acc.onAccent : T.textSub,
                  border:    `1.5px solid ${sel ? "transparent" : T.border}`,
                  boxShadow:  sel ? `0 5px 14px ${acc.accent}55` : CARD_SHADOW,
                  fontWeight: sel ? 800 : 600,
                }}>
                  <span style={{ fontSize: FONT.xs.size, letterSpacing:.8, textTransform:"uppercase" }}>{j.slice(0,3)}</span>
                  <span style={{ fontSize: 16, fontWeight: 800 }}>{d.getDate()}</span>
                  {wi ? (
                    <Icon as={wi.icon} size={11} color={sel ? acc.onAccent : wi.color}/>
                  ) : today && !sel ? (
                    <span style={{ width:4, height:4, borderRadius:"50%", background:acc.accent }}/>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Chantiers actifs du jour en cartes ; les vides regroupés dans « À planifier » */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {(() => {
              const isFilled = (cc) => { const cl = getCell(cc.id, mobileDay); return cl.planifie || cl.reel || cl.ouvriers?.length > 0 || cl.vehicules?.length > 0; };
              const actifs = chantiers.filter(isFilled);
              const vides  = chantiers.filter(cc => !isFilled(cc));
              const renderCard = (c) => {
              const cell = getCell(c.id, mobileDay);
              const filled = cell.planifie || cell.reel || cell.ouvriers?.length > 0 || cell.vehicules?.length > 0;
              const di = JOURS.indexOf(mobileDay);
              const onChip = contrastText(c.couleur);
              const taches = filled ? getDisplayTaches(cell) : [];
              return (
                <div key={c.id} onClick={() => openModal(c.id, mobileDay)}
                  style={{
                    background: filled ? `linear-gradient(160deg, ${c.couleur}10, ${T.surface} 55%)` : T.surface,
                    border: `1px solid ${filled ? c.couleur + "44" : T.border}`,
                    borderLeft: `5px solid ${c.couleur}`,
                    borderRadius: 14,
                    boxShadow: CARD_SHADOW,
                    padding: "11px 13px", cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                  {/* En-tête : nom + nb tâches + indicateurs + calendrier (icône) */}
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{
                      fontWeight:800, fontSize:14, letterSpacing:.3, textTransform:"uppercase",
                      color:T.text, flex:1, minWidth:0,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>
                      {c.nom}
                    </div>
                    {filled && taches.length > 0 && (
                      <span style={{ fontSize:10.5, fontWeight:800, color:T.textMuted, flexShrink:0 }}>
                        {taches.length} tâche{taches.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {commandes[c.id]?.trim() && <Icon as={Package} size={13} color="#f5a623"/>}
                    {notesData[c.id]?.trim() && <Icon as={StickyNote} size={13} color="#8070d0"/>}
                    {filled && (
                      <a href={makeGCalUrl(c, mobileDay, di, cell)} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()} title="Ajouter à Google Agenda"
                        style={{ display:"inline-flex", color:T.textSub, lineHeight:0, flexShrink:0 }}>
                        <Icon as={Calendar} size={14}/>
                      </a>
                    )}
                  </div>
                  {!filled ? (
                    <div style={{ color:T.textMuted, fontSize:13, fontStyle:"italic", display:"flex", alignItems:"center", gap:6 }}>
                      <Icon as={Plus} size={14}/>
                      Toucher pour planifier
                    </div>
                  ) : (
                    <>
                      {/* Aperçu des tâches : 2 lignes max (détail complet dans la modale au tap) */}
                      {taches.length > 0 && (
                        <div style={{
                          fontSize:12.5, lineHeight:1.45, color:T.textSub,
                          overflow:"hidden", display:"-webkit-box",
                          WebkitLineClamp:2, WebkitBoxOrient:"vertical",
                        }}>
                          {taches.map(t => t.text).join("  ·  ")}
                        </div>
                      )}
                      {(cell.ouvriers?.length > 0 || cell.vehicules?.length > 0) && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {cell.ouvriers?.map(o => (
                            <span key={o} style={{
                              background: c.couleur, color: onChip,
                              borderRadius: RADIUS.sm + 2,
                              padding: "2px 9px", fontSize: 11, fontWeight: 700,
                            }}>{o}</span>
                          ))}
                          {cell.vehicules?.map(vh => (
                            <span key={vh.id} style={{
                              display:"inline-flex", alignItems:"center", gap:4,
                              background: "transparent", color: T.textSub,
                              border:`1px solid ${T.border}`, borderRadius: RADIUS.sm + 2,
                              padding: "2px 9px", fontSize: 11, fontWeight: 700,
                            }}>🚐 {vh.nom}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
              };
              if (chantiers.length === 0) return (
                <div style={{ textAlign:"center", padding:"40px 20px", color:T.textMuted, fontSize:14 }}>
                  Aucun chantier configuré.
                </div>
              );
              return (
                <>
                  {actifs.length === 0 && (
                    <div style={{ textAlign:"center", padding:"6px 12px 2px", color:T.textMuted, fontSize:13, lineHeight:1.5 }}>
                      Rien de planifié ce jour. Déplie « À planifier » pour assigner un chantier.
                    </div>
                  )}
                  {actifs.map(renderCard)}
                  {vides.length > 0 && (
                    <MobileSection T={T} accent="#94a3b8" icon={Plus} title="À planifier" summary={vides.length} defaultOpen={actifs.length === 0}>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {vides.map(c => (
                          <button key={c.id} onClick={() => openModal(c.id, mobileDay)} style={{
                            display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left",
                            background:T.surface, border:`1px solid ${T.border}`, borderLeft:`4px solid ${c.couleur}`,
                            borderRadius:12, padding:"10px 12px", cursor:"pointer", fontFamily:"inherit",
                          }}>
                            <span style={{ flex:1, minWidth:0, fontWeight:700, fontSize:14, color:T.text, textTransform:"uppercase", letterSpacing:.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.nom}</span>
                            <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:acc.accent, fontSize:12, fontWeight:700, flexShrink:0 }}>
                              <Icon as={Plus} size={14}/> Planifier
                            </span>
                          </button>
                        ))}
                      </div>
                    </MobileSection>
                  )}
                </>
              );
            })()}

            {/* Récap heures par ouvrier sur la semaine — repliable */}
            {Object.keys(heuresParOuvrier).length > 0 && (
              <MobileSection T={T} accent="#5b8af5" icon={Clock} title={`Heures · semaine ${week}`}>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {ouvriers.filter(o => heuresParOuvrier[o]).map(o => {
                    const h = heuresParOuvrier[o];
                    const col = h > 40 ? "#ef4444" : h >= 35 ? "#22c55e" : T.textSub;
                    const bg  = h > 40 ? "rgba(239,68,68,0.10)"
                              : h >= 35 ? "rgba(34,197,94,0.10)"
                              : T.card;
                    return (
                      <div key={o} style={{
                        display:"inline-flex", alignItems:"baseline", gap:5,
                        padding:"5px 10px", background:bg,
                        border:`1px solid ${col === T.textSub ? T.border : col + "44"}`,
                        borderRadius: RADIUS.md,
                      }}>
                        <span style={{ fontSize:11, fontWeight:700, color:T.textSub }}>{o}</span>
                        <span style={{ fontSize:13, fontWeight:800, color:col }}>{h}h</span>
                      </div>
                    );
                  })}
                </div>
              </MobileSection>
            )}
          </div>
        </div>
      )}

      {/* === VUE DESKTOP === */}
      {!isMobile && (
        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px" }}>
          <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch", background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, boxShadow:CARD_SHADOW, padding:18 }}>
            {/* En-tête colonnes : jours + dates + météo */}
            <div style={{
              display:"grid", gridTemplateColumns:`160px repeat(${JOURS.length},minmax(140px,1fr))`,
              gap:5, marginBottom:6, minWidth:860,
            }}>
              <div/>
              {JOURS.map((j, di) => {
                const d = getDateDuJour(di);
                const today = getTodayJour() === j;
                const w = weatherByDay[toIsoDate(d)];
                const wi = w ? weatherInfo(w.code) : null;
                return (
                  <div key={j} style={{
                    textAlign:"center", padding:"6px 0",
                    borderBottom: today ? `2px solid ${acc.accent}` : "2px solid transparent",
                  }}>
                    <div style={{
                      fontWeight: today ? 800 : 700, fontSize: FONT.xs.size + 1,
                      letterSpacing: 1.5, textTransform: "uppercase",
                      color: today ? acc.accent : T.textMuted,
                    }}>{j}</div>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, opacity: today ? 1 : .65, marginTop: 2 }}>
                      {d.getDate()} {MOIS_COURTS[d.getMonth()]}
                    </div>
                    {wi && (
                      <div title={`${wi.label} · ${Math.round(w.tempMax)}°${w.rain > 0.5 ? ` · ${w.rain.toFixed(1)} mm` : ""}`}
                        style={{ display:"inline-flex", alignItems:"center", gap:4, marginTop:4,
                          fontSize: FONT.xs.size, color: wi.color, fontWeight: 600 }}>
                        <Icon as={wi.icon} size={13}/>
                        <span>{Math.round(w.tempMax)}°</span>
                        {w.rain > 0.5 && <span style={{ color:"#5b8af5" }}>· {w.rain.toFixed(1)}mm</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Lignes de chantier */}
            {chantiers.map(c => {
              const onLabel = contrastText(c.couleur);
              const onChip = onLabel;
              return (
                <div key={c.id} style={{
                  display:"grid", gridTemplateColumns:`160px repeat(${JOURS.length},minmax(140px,1fr))`,
                  gap:5, marginBottom:5, minWidth:860,
                }}>
                  {/* Label chantier coloré */}
                  <div style={{
                    background: c.couleur, color: onLabel,
                    borderRadius: `${RADIUS.lg}px 0 0 ${RADIUS.lg}px`,
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                    textAlign:"center", fontWeight:800,
                    fontSize: FONT.sm.size, letterSpacing: .8, textTransform:"uppercase",
                    padding:"10px 8px", gap:5,
                  }}>
                    <span>{c.nom}</span>
                    <div style={{ display:"flex", gap:6, opacity:.85 }}>
                      {commandes[c.id]?.trim() && <Icon as={Package}    size={11}/>}
                      {notesData[c.id]?.trim() && <Icon as={StickyNote} size={11}/>}
                    </div>
                  </div>

                  {/* Cellules par jour */}
                  {JOURS.map((jour, di) => {
                    const cell = getCell(c.id, jour);
                    const filled = cell.planifie || cell.reel || cell.ouvriers?.length > 0 || cell.vehicules?.length > 0;
                    const displayTaches = getDisplayTaches(cell);
                    return (
                      <div key={jour} className={`cell ${filled ? "filled" : ""} cell-with-agenda`} onClick={() => openModal(c.id, jour)}
                        style={{ position:"relative" }}>
                        {filled ? (
                          <>
                            <div style={{ fontSize:12, lineHeight:1.5, color: T.text, display:"flex", flexDirection:"column", gap:2 }}>
                              {displayTaches.length > 0 ? displayTaches.map((tache, ti) => (
                                <div key={tache.id || ti} style={{ display:"flex", alignItems:"flex-start", gap:3 }}>
                                  <span style={{ flex:1, minWidth:0, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{tache.text}</span>
                                  <button
                                    className="tache-move-btn"
                                    title="Déplacer vers un autre jour"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setMoveMenu({ cId: c.id, jour, taskIdx: ti, x: r.right, y: r.bottom });
                                    }}
                                    style={{
                                      background:"transparent", border:"none", padding:2,
                                      cursor:"pointer", color:T.textMuted, flexShrink:0, lineHeight:0,
                                      opacity:0, pointerEvents:"none", transition:"opacity .15s",
                                    }}>
                                    <Icon as={ArrowRightLeft} size={11}/>
                                  </button>
                                </div>
                              )) : <span style={{ color:T.emptyColor }}>—</span>}
                            </div>
                            {cell.ouvriers?.length > 0 && (
                              <div style={{ marginTop:5, display:"flex", flexWrap:"wrap", gap:3 }}>
                                {cell.ouvriers.map(o => (
                                  <span key={o} style={{
                                    background: c.couleur, color: onChip,
                                    borderRadius: RADIUS.sm,
                                    padding: "1px 7px", fontSize: 11, fontWeight: 700,
                                  }}>{o}</span>
                                ))}
                              </div>
                            )}
                            {cell.vehicules?.length > 0 && (
                              <div style={{ marginTop:4, display:"flex", flexWrap:"wrap", gap:3 }}>
                                {cell.vehicules.map(vh => (
                                  <span key={vh.id} title={vh.immatriculation || vh.nom} style={{
                                    display:"inline-flex", alignItems:"center", gap:3,
                                    background: "transparent", color: T.textSub,
                                    border:`1px solid ${T.border}`, borderRadius: RADIUS.sm,
                                    padding: "1px 6px", fontSize: 10.5, fontWeight: 700,
                                  }}>🚐 {vh.nom}</span>
                                ))}
                              </div>
                            )}
                            {/* Bouton Google Agenda — visible seulement au survol */}
                            <a href={makeGCalUrl(c, jour, di, cell)} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              title="Ajouter à Google Agenda"
                              className="cell-agenda-btn"
                              style={{
                                position:"absolute", bottom:4, right:4,
                                display:"inline-flex", alignItems:"center",
                                background: T.card, border:`1px solid ${T.border}`,
                                color: T.textSub,
                                borderRadius: RADIUS.sm, padding:"2px 5px",
                                opacity: 0, transition:"opacity .15s",
                                textDecoration:"none", pointerEvents:"none",
                              }}>
                              <Icon as={Calendar} size={11}/>
                            </a>
                          </>
                        ) : (
                          <div className="cell-add-hint" style={{
                            position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
                            opacity:0, transition:"opacity .15s", color: T.textMuted,
                          }}>
                            <Icon as={Plus} size={20}/>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Récap heures par ouvrier sur la semaine */}
            {Object.keys(heuresParOuvrier).length > 0 && (
              <div style={{
                marginTop: 18, paddingTop: 14,
                borderTop: `1px solid ${T.headerBorder}`,
                minWidth: 860,
              }}>
                <div style={{
                  fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.5,
                  textTransform: "uppercase", color: T.textMuted, marginBottom: 10,
                }}>
                  Heures planifiées · semaine {week}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ouvriers.filter(o => heuresParOuvrier[o]).map(o => {
                    const h = heuresParOuvrier[o];
                    // Seuil indicatif : 35-40h = OK (vert), <35 = sous-utilisé (gris),
                    // >40 = surcharge (rouge). Le BTP français est à 35h.
                    const col = h > 40 ? "#ef4444" : h >= 35 ? "#22c55e" : T.textSub;
                    const bg  = h > 40 ? "rgba(239,68,68,0.10)"
                              : h >= 35 ? "rgba(34,197,94,0.10)"
                              : T.card;
                    return (
                      <div key={o} style={{
                        display:"inline-flex", alignItems:"baseline", gap:6,
                        padding:"6px 12px",
                        background: bg,
                        border: `1px solid ${col === T.textSub ? T.border : col + "44"}`,
                        borderRadius: RADIUS.md,
                      }}>
                        <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub, letterSpacing: .3 }}>{o}</span>
                        <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: col }}>{h}h</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PagePlanning;
