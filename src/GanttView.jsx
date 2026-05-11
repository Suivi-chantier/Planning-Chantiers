import React, { useMemo, useState } from "react";

const PHASES = [
  { id: "demolition",     label: "Démolition",                        emoji: "🔨", couleur: "#e05c5c" },
  { id: "plomberie_ro",   label: "Réseaux plomberie (gros œuvre)",     emoji: "🔵", couleur: "#3b82f6" },
  { id: "menuiserie",     label: "Menuiserie ext. & int.",             emoji: "🚪", couleur: "#8b5cf6" },
  { id: "feraillage",     label: "Feraillage cloisons & doublages",    emoji: "🧱", couleur: "#f59e0b" },
  { id: "elec_vmc",       label: "Réseaux élec & VMC",                 emoji: "⚡", couleur: "#eab308" },
  { id: "placo",          label: "Lainage / Placo / Bandes & enduits", emoji: "🪣", couleur: "#6366f1" },
  { id: "peinture_sols",  label: "Peintures & sols",                   emoji: "🎨", couleur: "#ec4899" },
  { id: "finition_elec",  label: "Finitions électricité",              emoji: "💡", couleur: "#f97316" },
  { id: "finition_plomb", label: "Finitions plomberie",                emoji: "🚿", couleur: "#06b6d4" },
  { id: "cuisine",        label: "Cuisine",                            emoji: "🍳", couleur: "#10b981" },
  { id: "finitions_gen",  label: "Finitions générales",                emoji: "✨", couleur: "#a78bfa" },
];

const H_PER_DAY = 7;            // heures travaillées par jour
const SKIP_WEEKENDS = true;     // ignorer samedi/dimanche
const DAY_PX = 28;              // largeur d'une journée à zoom 1
const ROW_H = 32;               // hauteur d'une ligne tâche
const LABEL_W = 280;            // largeur colonne libellés

// ─── HELPERS DATES ───────────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : startOfDay(d);
}
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return startOfDay(x); }
function diffDays(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }
function nextWorkDay(d) { let x = startOfDay(d); while (SKIP_WEEKENDS && isWeekend(x)) x = addDays(x, 1); return x; }
function addWorkDays(start, n) {
  let x = startOfDay(start);
  let remaining = Math.max(0, n);
  while (remaining > 0) {
    x = addDays(x, 1);
    if (!SKIP_WEEKENDS || !isWeekend(x)) remaining--;
  }
  return x;
}
function workDaysBetween(a, b) {
  if (!SKIP_WEEKENDS) return diffDays(a, b);
  let n = 0;
  let cur = startOfDay(a);
  const end = startOfDay(b);
  while (cur < end) {
    if (!isWeekend(cur)) n++;
    cur = addDays(cur, 1);
  }
  return n;
}
function fmtDateShort(d) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function fmtMonth(d) {
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// ─── AUTO-PLANIFICATION ──────────────────────────────────────────────────────
function planifier(planTravaux) {
  // Trouver l'ancre : min des date_prevue valides, sinon aujourd'hui
  const allTaches = PHASES.flatMap(ph => (planTravaux?.[ph.id] || []).map(t => ({ ...t, phaseId: ph.id })));
  const ancres = allTaches.map(t => parseDate(t.date_prevue)).filter(Boolean);
  const ancre = ancres.length > 0 ? new Date(Math.min(...ancres.map(d => d.getTime()))) : startOfDay(new Date());
  const startGlobal = nextWorkDay(ancre);

  const result = [];
  let curseur = startGlobal;

  PHASES.forEach(ph => {
    const taches = planTravaux?.[ph.id] || [];
    taches.forEach(t => {
      const heures = parseFloat(t.heures_vendues) || parseFloat(t.heures_estimees) || H_PER_DAY;
      const dureeJours = Math.max(1, Math.ceil(heures / H_PER_DAY));

      const ancreT = parseDate(t.date_prevue);
      let start;
      if (ancreT) {
        start = nextWorkDay(ancreT);
        // ne pas reculer le curseur si manual
        if (start > curseur) curseur = start;
      } else {
        start = curseur;
      }
      const end = addWorkDays(start, dureeJours);

      result.push({
        ...t,
        phase: ph,
        start,
        end,
        dureeJours,
        heures,
        avancement: parseFloat(t.avancement) || 0,
        ancre: !!ancreT,
      });

      curseur = end;
    });
  });

  return result;
}

// ─── EXPORT IMPRESSION / PDF ─────────────────────────────────────────────────
function exporterGantt(taches, chantierNom, gridStart, gridEnd, totalDays, today, planTravaux) {
  // Largeur jour adaptative (~960px max pour timeline en A4 paysage)
  const TIMELINE_MAX = 960;
  const LABEL_W_PRINT = 220;
  const dayW = Math.max(8, Math.min(20, Math.floor(TIMELINE_MAX / totalDays)));
  const widthPx = totalDays * dayW;

  const jours = [];
  for (let i = 0; i < totalDays; i++) jours.push(addDays(gridStart, i));

  const moisGroupes = [];
  jours.forEach((d, i) => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const last = moisGroupes[moisGroupes.length - 1];
    if (last && last.key === key) last.count++;
    else moisGroupes.push({ key, label: fmtMonth(d), count: 1 });
  });

  const phasesPresentes = PHASES.filter(ph => (planTravaux?.[ph.id] || []).length > 0);
  const heuresTotal = taches.reduce((s, t) => s + t.heures, 0);
  const avancementMoyen = Math.round(taches.reduce((s, t) => s + t.avancement, 0) / taches.length);
  const dureeJoursOuvres = workDaysBetween(taches[0].start, taches[taches.length - 1].end);
  const todayIdx = diffDays(gridStart, today);

  const esc = (s) => String(s || "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const moisHtml = moisGroupes.map(m =>
    `<div class="mois" style="width:${m.count * dayW}px">${esc(m.label)}</div>`
  ).join("");

  const joursHtml = jours.map(d => {
    const we = isWeekend(d);
    const t = diffDays(today, d) === 0;
    return `<div class="jour ${we ? "we" : ""} ${t ? "today" : ""}" style="width:${dayW}px">
      <div class="dow">${["D","L","M","M","J","V","S"][d.getDay()]}</div>
      <div class="dom">${d.getDate()}</div>
    </div>`;
  }).join("");

  const weBgHtml = jours.map((d, i) => isWeekend(d)
    ? `<div class="we-bg" style="left:${i * dayW}px; width:${dayW}px"></div>` : "").join("");

  const todayLineHtml = (todayIdx >= 0 && todayIdx < totalDays)
    ? `<div class="today-line" style="left:${todayIdx * dayW + dayW / 2 - 1}px"></div>` : "";

  const lignesHtml = taches.map((t, i) => {
    const startIdx = diffDays(gridStart, t.start);
    const endIdx   = diffDays(gridStart, t.end);
    const w = Math.max(1, endIdx - startIdx) * dayW;
    const x = startIdx * dayW;
    const fillW = (w * Math.min(100, Math.max(0, t.avancement))) / 100;
    const done = t.avancement >= 100;
    const showLabel = w > 70;
    return `<div class="row ${i % 2 === 0 ? "even" : "odd"}">
      <div class="lbl">
        <span class="emo">${t.phase.emoji}</span>
        <span class="nom">${esc(t.nom || "(sans nom)")}</span>
        ${t.ancre ? '<span class="anc" title="Date imposée">📌</span>' : ""}
        <span class="h">${Math.round(t.heures)}h</span>
      </div>
      <div class="tl">
        <div class="bar" style="left:${x}px; width:${w}px;
          background:${t.phase.couleur}22;
          border:1px solid ${t.phase.couleur};">
          <div class="fill" style="width:${fillW}px;
            background:${done ? "#50c87844" : t.phase.couleur + "88"};"></div>
          ${showLabel ? `<div class="bartxt">${esc(t.nom)}${t.avancement > 0 ? ` · ${t.avancement}%` : ""}</div>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  const legendeHtml = phasesPresentes.map(ph =>
    `<span class="lg"><span class="dot" style="background:${ph.couleur}"></span>${ph.emoji} ${esc(ph.label)}</span>`
  ).join("");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Gantt — ${esc(chantierNom || "Plan de travail")}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1f2e; margin: 0; padding: 0; }
  .doc { padding: 4mm 6mm; }
  .hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #FFC200; }
  .hd .t1 { font-size: 9px; color: #999; letter-spacing: 2px; text-transform: uppercase; }
  .hd .t2 { font-size: 18px; font-weight: 800; color: #1a1f2e; margin-top: 2px; }
  .hd .t3 { font-size: 11px; color: #666; margin-top: 4px; }
  .hd .meta { text-align: right; font-size: 10px; color: #666; }
  .hd .meta b { color: #1a1f2e; font-size: 13px; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; padding: 6px 8px; background: #f9f9f9; border-radius: 4px; border: 1px solid #eee; }
  .legend .lg { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; color: #333; }
  .legend .dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .chart { display: flex; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
  .col-lbl { width: ${LABEL_W_PRINT}px; flex-shrink: 0; background: #fafafa; border-right: 1px solid #ddd; }
  .col-tl  { width: ${widthPx}px; position: relative; }
  .hdr { background: #f0f0f0; border-bottom: 1px solid #ddd; }
  .hdr-lbl { height: 38px; padding: 0 10px; display: flex; align-items: center; font-size: 9px; font-weight: 700; color: #666; letter-spacing: 1px; text-transform: uppercase; }
  .mois-row { display: flex; height: 18px; border-bottom: 1px solid #e0e0e0; }
  .mois { padding: 0 6px; display: flex; align-items: center; font-size: 9px; font-weight: 700; color: #666; letter-spacing: 1px; text-transform: uppercase; border-right: 1px solid #e8e8e8; }
  .jours-row { display: flex; height: 20px; }
  .jour { text-align: center; display: flex; flex-direction: column; justify-content: center; line-height: 1; font-size: 8px; color: #888; border-right: 1px solid #f0f0f0; }
  .jour .dow { font-size: 7px; }
  .jour .dom { font-weight: 700; font-size: 9px; color: #333; }
  .jour.we { background: #f5f5f5; color: #aaa; }
  .jour.today .dom { color: #b88800; font-weight: 800; }
  .body { position: relative; }
  .row { display: flex; height: 22px; border-bottom: 1px solid #eee; position: relative; }
  .row.odd { background: #fafafa; }
  .row .lbl { width: ${LABEL_W_PRINT}px; flex-shrink: 0; padding: 0 8px; display: flex; align-items: center; gap: 6px; border-right: 1px solid #ddd; background: inherit; }
  .row .lbl .emo { font-size: 10px; }
  .row .lbl .nom { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; color: #1a1f2e; }
  .row .lbl .anc { font-size: 9px; }
  .row .lbl .h { font-size: 9px; color: #888; font-weight: 600; }
  .row .tl { flex: 1; position: relative; }
  .bar { position: absolute; top: 3px; height: 16px; border-radius: 3px; overflow: hidden; }
  .bar .fill { position: absolute; top: 0; left: 0; bottom: 0; }
  .bar .bartxt { position: absolute; inset: 0; padding: 0 6px; display: flex; align-items: center; font-size: 9px; font-weight: 700; color: #1a1f2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
  .we-bg { position: absolute; top: 0; bottom: 0; background: #f5f5f5; z-index: 0; pointer-events: none; }
  .today-line { position: absolute; top: 0; bottom: 0; width: 2px; background: #FFC200; z-index: 3; pointer-events: none; }
  .ft { margin-top: 10px; font-size: 8px; color: #999; text-align: center; }
  @media print {
    .no-print { display: none; }
  }
</style>
</head><body>
<div class="doc">
  <div class="hd">
    <div>
      <div class="t1">📊 Planning prévisionnel</div>
      <div class="t2">${esc(chantierNom || "Plan de travail")}</div>
      <div class="t3">Édité le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>
    <div class="meta">
      <div><b>${taches.length}</b> tâches · <b>${Math.round(heuresTotal)}h</b> · <b>${dureeJoursOuvres}j</b> ouvrés</div>
      <div>${fmtDateShort(taches[0].start)} → ${fmtDateShort(taches[taches.length - 1].end)}</div>
      <div>Avancement moyen : <b>${avancementMoyen}%</b></div>
    </div>
  </div>
  <div class="legend">${legendeHtml}</div>
  <div class="chart">
    <div class="col-lbl">
      <div class="hdr">
        <div class="mois-row"></div>
        <div class="hdr-lbl">Tâche</div>
      </div>
      <div class="body">
        ${taches.map((t, i) => `<div class="row ${i % 2 === 0 ? "even" : "odd"}">
          <div class="lbl" style="width:100%; border-right:none;">
            <span class="emo">${t.phase.emoji}</span>
            <span class="nom">${esc(t.nom || "(sans nom)")}</span>
            ${t.ancre ? '<span class="anc">📌</span>' : ""}
            <span class="h">${Math.round(t.heures)}h</span>
          </div>
        </div>`).join("")}
      </div>
    </div>
    <div class="col-tl">
      <div class="hdr">
        <div class="mois-row">${moisHtml}</div>
        <div class="jours-row">${joursHtml}</div>
      </div>
      <div class="body" style="width:${widthPx}px">
        ${weBgHtml}
        ${todayLineHtml}
        ${taches.map((t, i) => {
          const startIdx = diffDays(gridStart, t.start);
          const endIdx   = diffDays(gridStart, t.end);
          const w = Math.max(1, endIdx - startIdx) * dayW;
          const x = startIdx * dayW;
          const fillW = (w * Math.min(100, Math.max(0, t.avancement))) / 100;
          const done = t.avancement >= 100;
          const showLabel = w > 70;
          return `<div class="row ${i % 2 === 0 ? "even" : "odd"}">
            <div class="bar" style="left:${x}px; width:${w}px;
              background:${t.phase.couleur}22;
              border:1px solid ${t.phase.couleur};">
              <div class="fill" style="width:${fillW}px;
                background:${done ? "#50c87844" : t.phase.couleur + "88"};"></div>
              ${showLabel ? `<div class="bartxt">${esc(t.nom)}${t.avancement > 0 ? ` · ${t.avancement}%` : ""}</div>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
  </div>
  <div class="ft">Document généré depuis Profero Planning · Auto-planification 7h/jour ouvré, week-ends exclus</div>
</div>
<script>
  setTimeout(function(){ window.print(); }, 500);
</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Impossible d'ouvrir la fenêtre d'export. Autorisez les pop-ups pour ce site.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─── GANTT ───────────────────────────────────────────────────────────────────
export default function GanttView({ planTravaux, chantierNom, T, onClose }) {
  const [zoom, setZoom] = useState(1); // 0.5 .. 2

  const taches = useMemo(() => planifier(planTravaux), [planTravaux]);

  if (taches.length === 0) {
    return (
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1300,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
          padding: "32px 40px", textAlign: "center", color: T.textSub, maxWidth: 420,
        }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Plan vide</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>Aucune tâche à afficher dans le Gantt.</div>
          <button onClick={onClose} style={{
            background: T.accent, color: "#111", border: "none", borderRadius: 8,
            padding: "9px 22px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>Fermer</button>
        </div>
      </div>
    );
  }

  const dStart = taches.reduce((m, t) => t.start < m ? t.start : m, taches[0].start);
  const dEnd   = taches.reduce((m, t) => t.end   > m ? t.end   : m, taches[0].end);
  // Marges autour
  const gridStart = addDays(dStart, -2);
  const gridEnd   = addDays(dEnd, 3);
  const totalDays = diffDays(gridStart, gridEnd) + 1;
  const dayW = DAY_PX * zoom;
  const widthPx = totalDays * dayW;

  // Liste des jours pour l'axe
  const jours = [];
  for (let i = 0; i < totalDays; i++) jours.push(addDays(gridStart, i));

  // Regrouper les jours par mois pour le bandeau supérieur
  const moisGroupes = [];
  jours.forEach((d, i) => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const last = moisGroupes[moisGroupes.length - 1];
    if (last && last.key === key) { last.count++; }
    else moisGroupes.push({ key, label: fmtMonth(d), count: 1, startIdx: i });
  });

  const today = startOfDay(new Date());
  const todayIdx = diffDays(gridStart, today);

  // Statistiques globales
  const heuresTotal = taches.reduce((s, t) => s + t.heures, 0);
  const avancementMoyen = taches.length === 0 ? 0
    : Math.round(taches.reduce((s, t) => s + t.avancement, 0) / taches.length);

  const dateStartLabel = fmtDateShort(taches[0].start);
  const dateEndLabel   = fmtDateShort(taches[taches.length - 1].end);
  const dureeJours     = workDaysBetween(taches[0].start, taches[taches.length - 1].end);

  return (
    <div style={{
      position: "fixed", inset: 0, background: T.bg, zIndex: 1300,
      display: "flex", flexDirection: "column", fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
    }}>
      {/* HEADER */}
      <div style={{
        padding: "14px 22px", borderBottom: `1px solid ${T.border}`, background: T.surface,
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: T.accent, textTransform: "uppercase" }}>
            📊 Vue Gantt
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text, marginTop: 2 }}>
            {chantierNom || "Plan de travail"}
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
            {taches.length} tâche{taches.length > 1 ? "s" : ""} · {heuresTotal.toFixed(0)}h · {dureeJours} jour{dureeJours > 1 ? "s" : ""} ouvrés
            · {dateStartLabel} → {dateEndLabel}
            · {avancementMoyen}% avancement
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}
              style={{ background: "transparent", border: "none", color: T.text, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, opacity: zoom <= 0.5 ? 0.4 : 1 }}>−</button>
            <span style={{ padding: "4px 8px", fontSize: 12, color: T.textMuted, fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2, z + 0.25))} disabled={zoom >= 2}
              style={{ background: "transparent", border: "none", color: T.text, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, opacity: zoom >= 2 ? 0.4 : 1 }}>+</button>
          </div>
          <button onClick={() => exporterGantt(taches, chantierNom, gridStart, totalDays > 0 ? addDays(gridStart, totalDays - 1) : gridStart, totalDays, today, planTravaux)}
            style={{
              background: "rgba(80,200,120,0.12)", border: "1px solid rgba(80,200,120,0.35)", borderRadius: 8,
              padding: "8px 16px", color: "#50c878", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }} title="Exporter en PDF / Imprimer">
            📥 Exporter
          </button>
          <button onClick={onClose} style={{
            background: "rgba(224,92,92,0.1)", border: "1px solid rgba(224,92,92,0.25)", borderRadius: 8,
            padding: "8px 16px", color: "#e05c5c", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>✕ Fermer</button>
        </div>
      </div>

      {/* LÉGENDE */}
      <div style={{
        padding: "8px 22px", background: T.card, borderBottom: `1px solid ${T.border}`,
        display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>Phases :</span>
        {PHASES.filter(ph => (planTravaux?.[ph.id] || []).length > 0).map(ph => (
          <span key={ph.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.text }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: ph.couleur, display: "inline-block" }} />
            {ph.emoji} {ph.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>
          📌 = date imposée · ⛶ = auto-planifié · {H_PER_DAY}h/jour · {SKIP_WEEKENDS ? "weekends ignorés" : "weekends inclus"}
        </span>
      </div>

      {/* TIMELINE */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <div style={{ display: "flex", minWidth: LABEL_W + widthPx }}>

          {/* Colonne libellés (sticky) */}
          <div style={{
            width: LABEL_W, flexShrink: 0, background: T.surface,
            borderRight: `1px solid ${T.border}`, position: "sticky", left: 0, zIndex: 5,
          }}>
            {/* Header colonne libellés (aligné sur le double bandeau dates) */}
            <div style={{ height: 56, borderBottom: `1px solid ${T.border}`, padding: "0 14px",
              display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700,
              letterSpacing: 1, textTransform: "uppercase", color: T.textMuted,
              background: T.card }}>
              Tâche
            </div>
            {/* Lignes */}
            {taches.map((t, i) => (
              <div key={t.id || i} style={{
                height: ROW_H, padding: "0 12px 0 14px",
                borderBottom: `1px solid ${T.sectionDivider || T.border}`,
                display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
              }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{t.phase.emoji}</span>
                <span style={{
                  flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", color: T.text, fontWeight: 600,
                }} title={t.nom}>
                  {t.nom || "(sans nom)"}
                </span>
                {t.ancre && <span title="Date imposée" style={{ fontSize: 11 }}>📌</span>}
                <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, flexShrink: 0 }}>
                  {t.heures}h
                </span>
              </div>
            ))}
          </div>

          {/* Zone timeline */}
          <div style={{ position: "relative", width: widthPx }}>
            {/* Bandeau mois */}
            <div style={{ display: "flex", height: 28, borderBottom: `1px solid ${T.border}`, background: T.card }}>
              {moisGroupes.map((m, i) => (
                <div key={i} style={{
                  width: m.count * dayW, padding: "0 8px",
                  display: "flex", alignItems: "center",
                  fontSize: 11, fontWeight: 700, letterSpacing: 1,
                  textTransform: "uppercase", color: T.textMuted,
                  borderRight: i < moisGroupes.length - 1 ? `1px solid ${T.border}` : "none",
                  position: "sticky", top: 0,
                }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* Bandeau jours */}
            <div style={{ display: "flex", height: 28, borderBottom: `1px solid ${T.border}`, background: T.surface }}>
              {jours.map((d, i) => {
                const we = isWeekend(d);
                const isToday = diffDays(today, d) === 0;
                return (
                  <div key={i} style={{
                    width: dayW, flexShrink: 0, textAlign: "center",
                    fontSize: 10, fontWeight: isToday ? 800 : 600,
                    color: isToday ? T.accent : we ? T.textMuted : T.textSub,
                    background: we ? "rgba(255,255,255,0.03)" : "transparent",
                    borderRight: `1px solid ${T.sectionDivider || T.border}`,
                    display: "flex", flexDirection: "column", justifyContent: "center",
                    lineHeight: 1.2,
                  }}>
                    <div>{["D","L","M","M","J","V","S"][d.getDay()]}</div>
                    <div>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>

            {/* Lignes de fond + bandes WE */}
            <div style={{ position: "relative" }}>
              {/* Bandes WE (fond) */}
              {jours.map((d, i) => isWeekend(d) ? (
                <div key={`we-${i}`} style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: i * dayW, width: dayW,
                  background: "rgba(255,255,255,0.025)",
                  pointerEvents: "none",
                }}/>
              ) : null)}

              {/* Ligne "aujourd'hui" */}
              {todayIdx >= 0 && todayIdx < totalDays && (
                <div style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: todayIdx * dayW + dayW / 2 - 1,
                  width: 2, background: T.accent, zIndex: 3,
                  pointerEvents: "none",
                }}/>
              )}

              {/* Barres tâches */}
              {taches.map((t, i) => {
                const startIdx = diffDays(gridStart, t.start);
                const endIdx   = diffDays(gridStart, t.end);
                const w = Math.max(1, endIdx - startIdx) * dayW;
                const x = startIdx * dayW;
                const fillW = (w * Math.min(100, Math.max(0, t.avancement))) / 100;
                const done = t.avancement >= 100;

                return (
                  <div key={t.id || i} style={{
                    height: ROW_H,
                    borderBottom: `1px solid ${T.sectionDivider || T.border}`,
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                    position: "relative",
                  }}>
                    {/* Conteneur barre */}
                    <div
                      title={`${t.nom}\n${fmtDateShort(t.start)} → ${fmtDateShort(t.end)} · ${t.dureeJours}j ouvrés\n${t.heures}h · ${t.avancement}%`}
                      style={{
                        position: "absolute", top: 5, height: ROW_H - 10,
                        left: x, width: w,
                        background: t.phase.couleur + "33",
                        border: `1.5px solid ${t.phase.couleur}`,
                        borderRadius: 5,
                        overflow: "hidden",
                        boxShadow: t.ancre ? `inset 0 0 0 2px ${t.phase.couleur}55` : "none",
                      }}>
                      {/* Remplissage avancement */}
                      <div style={{
                        position: "absolute", top: 0, left: 0, bottom: 0,
                        width: fillW,
                        background: done ? "#50c87844" : t.phase.couleur + "88",
                        transition: "width .3s",
                      }}/>
                      {/* Label dans la barre si assez large */}
                      {w > 80 && (
                        <div style={{
                          position: "absolute", inset: 0, padding: "0 8px",
                          display: "flex", alignItems: "center", gap: 5,
                          fontSize: 11, fontWeight: 700, color: T.text,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          zIndex: 2, lineHeight: 1,
                        }}>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {t.nom}
                          </span>
                          {t.avancement > 0 && (
                            <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.85 }}>
                              {t.avancement}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
