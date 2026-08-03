// ─── CHEMIN DE FER — planning géo-temporel d'une OPÉRATION ───────────────────
// Les logements (chantiers) en lignes, le temps en colonnes, les groupes
// d'exécution en barres : l'« escalier » des équipes qui descendent d'un
// logement au suivant. Page à part (le Phasage est structurellement
// mono-chantier), scopée par un sélecteur d'opération.
//
// LECTURE SEULE à ce stade (l'édition arrive au Prompt 4 du Point 4b).
// Source des dates : date_prevue des tâches, la même que le Gantt et la
// Chrono — aucune donnée nouvelle, aucun champ « zone » (la zone = le
// chantier). Données chargées par loadPhasagesOperation (une requête).

import React, { useState, useEffect, useMemo } from "react";
import {
  TrainFront, FileDown, RefreshCw, X, Home, Settings, CalendarDays, Calendar,
} from "lucide-react";
import {
  getBranchAccent, RADIUS, FONT, LOGO_RENO_H,
  loadOperations, loadGroupesTypes, loadEquipes,
} from "../constants";
import { Icon } from "../ui";
import { loadPhasagesOperation, shiftGroupePhasage } from "./phasagePlanning";

// ── Helpers dates (calendaires : le chemin de fer se lit en semaines) ────────
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const parseD = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const mondayOf = (d) => addDays(d, -(((d.getDay() || 7)) - 1));
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtFR = (s) => { const d = parseD(s); return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"; };
const numSemaine = (d) => {
  // Numéro ISO de la semaine (même logique que dateFromWeekJour, inversée).
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const jan4 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
};

const LABEL_W = 190;
const ROW_H = 46;
const HEADER_H = 44;

export default function PageCheminDeFer({ chantiers = [], T, branch = "renovation", onOuvrirAdmin }) {
  const acc = getBranchAccent(branch);

  // Référentiels (globaux, un seul chargement)
  const [operations, setOperations] = useState([]);
  const [groupesTypes, setGroupesTypes] = useState([]);
  const [equipes, setEquipes] = useState([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  useEffect(() => {
    let ok = true;
    Promise.all([loadOperations(), loadGroupesTypes(), loadEquipes()]).then(([ops, gts, eqs]) => {
      if (!ok) return;
      setOperations(ops); setGroupesTypes(gts); setEquipes(eqs); setRefsLoaded(true);
    });
    return () => { ok = false; };
  }, []);

  // Opération courante (persistée, comme le chantier du Phasage)
  const [opId, setOpId] = useState(() => {
    try { return localStorage.getItem("chemin_fer_operation") || ""; } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("chemin_fer_operation", opId); } catch {}
  }, [opId]);
  // Si l'opération mémorisée n'existe plus (ou premier passage) : la première.
  useEffect(() => {
    if (!refsLoaded) return;
    if (operations.length > 0 && !operations.some(o => o.id === opId)) setOpId(operations[0].id);
  }, [refsLoaded, operations]); // eslint-disable-line react-hooks/exhaustive-deps

  const operation = operations.find(o => o.id === opId) || null;
  const chantiersOp = useMemo(
    () => chantiers.filter(c => c.operation_id === opId),
    [chantiers, opId]
  );

  // Données de l'opération (phasages frères, une requête)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!opId || chantiersOp.length === 0) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    loadPhasagesOperation(chantiersOp).then(res => {
      if (cancelled) return;
      setData(res); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [opId, chantiersOp, reloadKey]);

  const [zoom, setZoom] = useState("semaine"); // "semaine" | "jour"
  // Sélection par IDS (pas par objets) : la carte de détail reste ouverte et
  // à jour quand les données sont rechargées après un décalage.
  const [detail, setDetail] = useState(null);  // { chantierId, groupeId }
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDetail(null); }, [opId]);
  const detailCtx = useMemo(() => {
    if (!detail || !data) return null;
    const row = (data.chantiers || []).find(r => r.chantier.id === detail.chantierId);
    const groupe = row?.groupes?.find(g => g.id === detail.groupeId);
    return row && groupe ? { chantier: row.chantier, groupe } : null;
  }, [detail, data]);

  // ── Décalage d'un groupe (Prompt 4) : écrit date_prevue via le module
  //    phasagePlanning, dans LE phasage du logement cliqué uniquement.
  //    Jamais de décalage en cascade des logements suivants. ─────────────────
  const doShift = async (jours, ouvres) => {
    if (!detailCtx || saving || loading) return;
    setSaving(true);
    const res = await shiftGroupePhasage(detailCtx.chantier.id, detailCtx.groupe.id, {
      jours, ouvres, expectedDebut: detailCtx.groupe.debut,
    });
    setSaving(false);
    if (!res.ok && res.reason === "conflit") {
      alert("Ce groupe a été modifié ailleurs entre-temps. Rien n'a été écrit — les données vont être rechargées.");
    } else if (!res.ok) {
      alert("Décalage impossible : " + res.reason);
    }
    setReloadKey(k => k + 1); // recharge (source unique : la DB)
  };

  // ── Échelle de temps ───────────────────────────────────────────────────────
  const DAY_PX = zoom === "jour" ? 26 : 9;
  const scale = useMemo(() => {
    const today = startOfDay(new Date());
    let debut = parseD(data?.bornes?.debut) || today;
    let fin = parseD(data?.bornes?.fin) || addDays(today, 56);
    const dateMin = mondayOf(addDays(debut, -7));
    let dateMax = addDays(fin, 14);
    dateMax = addDays(mondayOf(dateMax), 6); // fin de semaine pleine
    const totalDays = diffDays(dateMin, dateMax) + 1;
    const semaines = [];
    for (let d = new Date(dateMin); d <= dateMax; d = addDays(d, 7)) semaines.push(new Date(d));
    const mois = [];
    let lastKey = "";
    semaines.forEach(s => {
      const k = `${s.getFullYear()}-${s.getMonth()}`;
      if (k !== lastKey) { mois.push({ label: s.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), span: 1 }); lastKey = k; }
      else mois[mois.length - 1].span += 1;
    });
    return { dateMin, dateMax, totalDays, semaines, mois, today };
  }, [data, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const x = (dateISO) => { const d = parseD(dateISO); return d ? diffDays(scale.dateMin, d) * DAY_PX : null; };
  const totalW = scale.totalDays * DAY_PX;
  const todayX = diffDays(scale.dateMin, scale.today) * DAY_PX;
  const todayVisible = todayX >= 0 && todayX <= totalW;

  // ── Équipe par défaut d'un groupe (même résolution que le Phasage :
  //    groupe_type_id → groupe type → equipe_id → équipe) ────────────────────
  const equipePourGroupe = (g) => {
    if (!g?.groupe_type_id) return null;
    const gt = groupesTypes.find(t => t.id === g.groupe_type_id);
    if (!gt?.equipe_id) return null;
    return equipes.find(e => e.id === gt.equipe_id) || null;
  };

  // ── Légende : groupes dédupliqués (par groupe type, sinon par nom) ─────────
  const legende = useMemo(() => {
    const seen = new Map();
    (data?.chantiers || []).forEach(row => (row.groupes || []).forEach(g => {
      const key = g.groupe_type_id || (g.nom || "").trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, { nom: g.nom, couleur: g.couleur, ordre: g.ordre });
    }));
    return [...seen.values()].sort((a, b) => a.ordre - b.ordre);
  }, [data]);

  // ── Export PDF paysage (même patron que le Gantt : HTML → window.print) ────
  const buildCheminDeFerHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = operation?.nom || "Opération";
    const rows = data?.chantiers || [];
    const todayISO = isoDay(scale.today);

    // Une colonne par SEMAINE ; dans chaque cellule, 7 segments (un par jour)
    // colorés par le groupe qui couvre le jour — les transitions milieu de
    // semaine restent exactes à l'impression.
    const groupePourJour = (row, dISO) =>
      (row.groupes || []).find(g => g.debut && g.fin && g.debut <= dISO && dISO <= g.fin) || null;

    const monthHeaders = scale.mois.map(m =>
      `<th colspan="${m.span}" style="border-right:1pt solid #ccc;border-bottom:0.5pt solid #ccc;padding:3pt 5pt;font-size:7.5pt;font-weight:700;text-transform:capitalize;color:#444;background:#fafafa;">${esc(m.label)}</th>`
    ).join("");
    const weekHeaders = scale.semaines.map(s => {
      const isTodayWeek = isoDay(s) <= todayISO && todayISO <= isoDay(addDays(s, 6));
      return `<th style="border-right:0.5pt solid #eee;padding:2pt 1pt;font-size:6.5pt;font-weight:${isTodayWeek ? 800 : 600};color:${isTodayWeek ? "#9a7a00" : "#666"};background:${isTodayWeek ? "#fff4b8" : "#fafafa"};text-align:center;white-space:nowrap;">S${numSemaine(s)}<br/>${String(s.getDate()).padStart(2, "0")}/${String(s.getMonth() + 1).padStart(2, "0")}</th>`;
    }).join("");

    let body = "";
    rows.forEach(row => {
      const c = row.chantier;
      if (row.statut !== "ok") {
        const msg = row.statut === "v1" ? "Phasage V1 — non représentable" : "Aucun phasage";
        body += `<tr style="break-inside:avoid;"><td style="padding:5pt 8pt;border-right:1pt solid #ccc;border-bottom:0.5pt solid #eee;font-size:8pt;font-weight:700;color:#1a1f2e;">${esc(c.nom)}</td><td colspan="${scale.semaines.length}" style="padding:5pt 8pt;font-size:7.5pt;color:#999;font-style:italic;border-bottom:0.5pt solid #eee;">${msg}</td></tr>`;
        return;
      }
      const cells = scale.semaines.map(s => {
        const stops = [];
        let label = "";
        for (let i = 0; i < 7; i++) {
          const dISO = isoDay(addDays(s, i));
          const g = groupePourJour(row, dISO);
          const col = g ? g.couleur : "transparent";
          stops.push(`${col} ${(i / 7 * 100).toFixed(2)}% ${((i + 1) / 7 * 100).toFixed(2)}%`);
          if (g && g.debut === dISO) label = `${g.nom}${g.avancement > 0 ? ` · ${g.avancement}%` : ""}`;
        }
        const vide = stops.every(st => st.startsWith("transparent"));
        const bg = vide ? "" : `background:linear-gradient(90deg, ${stops.join(", ")});`;
        return `<td style="border-right:0.5pt solid #eee;padding:0;height:20pt;${bg}font-size:6.5pt;color:#fff;overflow:hidden;white-space:nowrap;">${label ? `<div style="padding:0 2pt;font-weight:700;text-shadow:0 0 2pt rgba(0,0,0,.55);overflow:hidden;text-overflow:ellipsis;">${esc(label.slice(0, 30))}</div>` : ""}</td>`;
      }).join("");
      const nonDates = (row.groupes || []).filter(g => g.nbTaches > 0 && !g.debut).length;
      body += `<tr style="break-inside:avoid;page-break-inside:avoid;">
        <td style="padding:4pt 8pt;border-right:1pt solid #ccc;border-bottom:0.5pt solid #eee;font-size:8pt;color:#1a1f2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          <div style="font-weight:800;">${esc(c.nom)}</div>
          ${nonDates > 0 ? `<div style="font-size:6.5pt;color:#9a7a00;">${nonDates} groupe${nonDates > 1 ? "s" : ""} non daté${nonDates > 1 ? "s" : ""}</div>` : ""}
        </td>
        ${cells}
      </tr>`;
    });

    const legendeHTML = legende.length === 0 ? "" : `
      <div style="margin-top:10pt;display:flex;flex-wrap:wrap;gap:6pt;font-size:7.5pt;color:#333;">
        ${legende.map(l => `<span style="display:inline-flex;align-items:center;white-space:nowrap;"><span style="display:inline-block;width:9pt;height:9pt;background:${l.couleur};border-radius:2pt;margin-right:3pt;"></span>${esc(l.nom)}</span>`).join("")}
      </div>`;

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Chemin de fer ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1f2e;font-size:9pt;}
  table{border-collapse:collapse;table-layout:fixed;width:100%;}
  th,td{vertical-align:middle;}
  thead{display:table-header-group;}
  tbody{display:table-row-group;}
  @page{size:A4 landscape;margin:8mm;}
  @page {
    @bottom-left   { content: "Profero Rénovation — Chemin de fer"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
  <table style="margin-bottom:10pt;width:100%;border-collapse:collapse;background:#0a0a0a;">
    <tr>
      <td style="padding:8pt 12pt;vertical-align:middle;width:60pt;">
        <img src="${logoUrl}" alt="Profero" style="height:24pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:8pt 6pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:6.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;">Chemin de fer — opération</div>
        <div style="color:#fff;font-size:12pt;font-weight:800;line-height:1.1;margin-top:1pt;">${esc(titre)}</div>
        ${operation?.adresse ? `<div style="color:rgba(255,255,255,.6);font-size:7.5pt;margin-top:1pt;">${esc(operation.adresse)}</div>` : ""}
      </td>
      <td style="padding:8pt 10pt;vertical-align:middle;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;white-space:nowrap;">
        ${rows.length} logement${rows.length > 1 ? "s" : ""} · Édité le ${dateGen}
      </td>
    </tr>
  </table>
  <table>
    <colgroup>
      <col style="width:110pt;"/>
      ${scale.semaines.map(() => `<col/>`).join("")}
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" style="border-right:1pt solid #ccc;border-bottom:1pt solid #ccc;background:#fafafa;padding:4pt 8pt;font-size:7.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;color:#444;text-align:left;">Logement</th>
        ${monthHeaders}
      </tr>
      <tr>${weekHeaders}</tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>
  ${legendeHTML}
</body></html>`;
  };

  const exportPDF = () => {
    try {
      const html = buildCheminDeFerHTML();
      const w = window.open("", "_blank", "width=1100,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `CheminDeFer-${operation?.nom || opId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF Chemin de fer : " + (e.message || e));
    }
  };

  // ── Rendus ─────────────────────────────────────────────────────────────────
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg };

  const detailGroupe = detailCtx && (() => {
    const eq = equipePourGroupe(detailCtx.groupe);
    const g = detailCtx.groupe;
    const items = [
      ["Dates", g.debut ? `${fmtFR(g.debut)} → ${fmtFR(g.fin)}` : "non planifié"],
      ["Tâches", `${g.nbTachesDatees}/${g.nbTaches} datée${g.nbTachesDatees > 1 ? "s" : ""}`],
      ["Heures", `${g.heuresVendues || g.heuresEstimees || 0} h ${g.heuresVendues ? "vendues" : "estimées"}`],
      ["Équipe", eq ? `${eq.nom}${eq.externe ? " (externe)" : ""}` : "—"],
      ["Avancement", `${g.avancement}%${g.termine ? " · terminé" : ""}`],
    ];
    const busy = saving || loading;
    const shiftBtns = [
      ["−1 sem.", -7, false], ["−1 j", -1, true], ["+1 j", +1, true], ["+1 sem.", +7, false],
    ];
    return (
      <div style={{ ...card, padding: "12px 16px", marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: g.couleur, display: "inline-block", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 800, color: T.text, fontSize: FONT.sm.size }}>{g.nom}</div>
              <div style={{ color: T.textSub, fontSize: FONT.xs.size }}>{detailCtx.chantier.nom}</div>
            </div>
          </div>
          {items.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: FONT.xs.size, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5 }}>{k}</div>
              <div style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
          <button className="ib" onClick={() => setDetail(null)} title="Fermer" style={{ marginLeft: "auto" }}>
            <Icon as={X} size={14} />
          </button>
        </div>
        {/* ── Décaler le groupe (écrit date_prevue — Gantt et Chrono suivent) ── */}
        {g.debut && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}55` }}>
            <span style={{ fontSize: FONT.xs.size, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, fontWeight: 700 }}>Décaler</span>
            {shiftBtns.map(([label, jours, ouvres]) => (
              <button key={label} className="btn-g" disabled={busy}
                onClick={() => doShift(jours, ouvres)}
                title={ouvres ? "Décale d'un jour ouvré (jamais de week-end)" : "Décale d'une semaine (même jour)"}
                style={{ padding: "5px 12px", fontSize: FONT.xs.size + 1, fontWeight: 700, opacity: busy ? .5 : 1 }}>
                {label}
              </button>
            ))}
            <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
              Toutes les tâches datées du groupe (et ses jalons) bougent d'autant — les autres logements ne bougent pas.
            </span>
            {busy && (
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, fontWeight: 700, color: acc.accent }}>
                <span className="dot-pulse" />
                {saving ? "Enregistrement…" : "Actualisation…"}
              </span>
            )}
          </div>
        )}
      </div>
    );
  })();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "18px 22px", minWidth: 0 }}>
      {/* ── En-tête ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={TrainFront} size={19} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: FONT.lg.size, color: T.text, lineHeight: 1.1 }}>Chemin de fer</div>
            <div style={{ fontSize: FONT.xs.size, color: T.textSub }}>Les logements d'une opération dans le temps</div>
          </div>
        </div>
        {operations.length > 0 && (
          <select className="ti" value={opId} onChange={e => setOpId(e.target.value)}
            style={{ minWidth: 200, fontWeight: 700 }} title="Opération affichée">
            {operations.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        )}
        {operation?.adresse && (
          <span style={{ fontSize: FONT.xs.size + 1, color: T.textSub, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon as={Home} size={12} />{operation.adresse}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Zoom semaines / jours */}
          <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
            {[["semaine", "Semaines", CalendarDays], ["jour", "Jours", Calendar]].map(([id, label, Ic]) => {
              const active = zoom === id;
              return (
                <button key={id} onClick={() => setZoom(id)} style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px",
                  background: active ? acc.bg10 : "transparent", color: active ? acc.accent : T.textSub,
                  border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: active ? 800 : 600,
                }}>
                  <Icon as={Ic} size={13} />{label}
                </button>
              );
            })}
          </div>
          <button className="btn-g" onClick={() => setReloadKey(k => k + 1)} title="Recharger les données"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px" }}>
            <Icon as={RefreshCw} size={13} />
          </button>
          <button className="btn-p" onClick={exportPDF} disabled={!data}
            title="Exporter le chemin de fer en PDF (paysage)"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: data ? 1 : .5 }}>
            <Icon as={FileDown} size={14} />
            PDF
          </button>
        </div>
      </div>

      {/* ── États vides ── */}
      {refsLoaded && operations.length === 0 && (
        <div style={{ ...card, padding: 40, textAlign: "center" }}>
          <Icon as={TrainFront} size={34} style={{ color: T.textMuted }} />
          <div style={{ fontWeight: 800, color: T.text, fontSize: FONT.md.size, marginTop: 10 }}>Aucune opération pour l'instant</div>
          <div style={{ color: T.textSub, fontSize: FONT.sm.size, marginTop: 6, lineHeight: 1.6 }}>
            Une opération regroupe les chantiers/logements d'une même maison.<br />
            Crée-la dans les Réglages puis rattache ses chantiers : le chemin de fer s'affichera ici.
          </div>
          {onOuvrirAdmin && (
            <button className="btn-p" onClick={onOuvrirAdmin} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon as={Settings} size={13} />
              Ouvrir les réglages → Opérations
            </button>
          )}
        </div>
      )}
      {refsLoaded && operations.length > 0 && chantiersOp.length === 0 && (
        <div style={{ ...card, padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 800, color: T.text, fontSize: FONT.md.size }}>Aucun chantier rattaché à « {operation?.nom} »</div>
          <div style={{ color: T.textSub, fontSize: FONT.sm.size, marginTop: 6 }}>
            Rattache les logements de cette opération dans les Réglages (onglet Opérations ou Chantiers).
          </div>
          {onOuvrirAdmin && (
            <button className="btn-p" onClick={onOuvrirAdmin} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon as={Settings} size={13} />
              Ouvrir les réglages
            </button>
          )}
        </div>
      )}
      {!refsLoaded || (loading && !data) ? (
        <div style={{ ...card, padding: 40, textAlign: "center", color: T.textSub, fontSize: FONT.sm.size }}>Chargement…</div>
      ) : null}

      {/* ── La frise ── */}
      {data && chantiersOp.length > 0 && (
        <>
          <div style={{ ...card, overflow: "auto", maxHeight: "calc(100vh - 220px)", position: "relative" }}>
            <div style={{ width: LABEL_W + totalW, minWidth: "100%" }}>
              {/* En-tête : mois + semaines (sticky top) */}
              <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
                <div style={{
                  width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 4, background: T.surface,
                  borderRight: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "0 12px",
                  fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textSub, height: HEADER_H,
                }}>Logement</div>
                <div style={{ position: "relative", width: totalW, height: HEADER_H }}>
                  {/* Mois */}
                  {(() => {
                    let off = 0;
                    return scale.mois.map((m, i) => {
                      const w = m.span * 7 * DAY_PX;
                      const el = (
                        <div key={i} style={{
                          position: "absolute", left: off, top: 0, width: w, height: 20,
                          borderRight: `1px solid ${T.border}`, fontSize: FONT.xs.size, color: T.textSub,
                          fontWeight: 700, textTransform: "capitalize", padding: "2px 6px", overflow: "hidden", whiteSpace: "nowrap",
                        }}>{m.label}</div>
                      );
                      off += w;
                      return el;
                    });
                  })()}
                  {/* Semaines */}
                  {scale.semaines.map((s, i) => {
                    const isTodayWeek = diffDays(s, scale.today) >= 0 && diffDays(s, scale.today) < 7;
                    return (
                      <div key={i} style={{
                        position: "absolute", left: i * 7 * DAY_PX, top: 20, width: 7 * DAY_PX, height: HEADER_H - 20,
                        borderRight: `1px solid ${T.border}22`, fontSize: FONT.xs.size - 1,
                        color: isTodayWeek ? acc.accent : T.textMuted, fontWeight: isTodayWeek ? 800 : 600,
                        background: isTodayWeek ? acc.bg10 : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap",
                      }}>
                        {zoom === "jour"
                          ? `S${numSemaine(s)} · ${String(s.getDate()).padStart(2, "0")}/${String(s.getMonth() + 1).padStart(2, "0")}`
                          : `S${numSemaine(s)}`}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lignes logements */}
              <div style={{ position: "relative" }}>
                {/* Repère AUJOURD'HUI */}
                {todayVisible && (
                  <div style={{
                    position: "absolute", top: 0, bottom: 0, left: LABEL_W + todayX + Math.floor(DAY_PX / 2),
                    width: 2, background: "#e15a5a", zIndex: 2, pointerEvents: "none",
                  }} title="Aujourd'hui" />
                )}
                {data.chantiers.map(row => {
                  const c = row.chantier;
                  const nonDates = (row.groupes || []).filter(g => g.nbTaches > 0 && !g.debut);
                  return (
                    <div key={c.id} style={{ display: "flex", borderBottom: `1px solid ${T.border}55`, minHeight: ROW_H }}>
                      {/* Libellé logement (sticky left) */}
                      <div style={{
                        width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: T.surface,
                        borderRight: `1px solid ${T.border}`, padding: "6px 12px", display: "flex", flexDirection: "column", justifyContent: "center",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.couleur, flexShrink: 0 }} />
                          <span style={{ fontWeight: 800, fontSize: FONT.xs.size + 2, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nom}</span>
                        </div>
                        {row.statut === "ok" && nonDates.length > 0 && (
                          <div style={{ fontSize: FONT.xs.size - 1, color: "#b8860b", marginTop: 1 }}
                            title={nonDates.map(g => g.nom).join(", ")}>
                            {nonDates.length} groupe{nonDates.length > 1 ? "s" : ""} non daté{nonDates.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                      {/* Zone temps */}
                      <div style={{
                        position: "relative", width: totalW, minHeight: ROW_H,
                        background: `repeating-linear-gradient(90deg, transparent 0 ${7 * DAY_PX - 1}px, ${T.border}44 ${7 * DAY_PX - 1}px ${7 * DAY_PX}px)`,
                      }}>
                        {row.statut !== "ok" && (
                          <div style={{ position: "sticky", left: LABEL_W + 12, display: "inline-flex", alignItems: "center", height: ROW_H, fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic", paddingLeft: 12 }}>
                            {row.statut === "v1" ? "Phasage V1 — non représentable dans le chemin de fer" : "Aucun phasage pour ce chantier"}
                          </div>
                        )}
                        {row.statut === "ok" && row.groupes.filter(g => g.debut).map(g => {
                          const left = x(g.debut);
                          const w = Math.max((diffDays(parseD(g.debut), parseD(g.fin)) + 1) * DAY_PX - 2, 8);
                          const eq = equipePourGroupe(g);
                          const isSel = detail && detail.chantierId === c.id && detail.groupeId === g.id;
                          return (
                            <div key={g.id}
                              onClick={() => setDetail(isSel ? null : { chantierId: c.id, groupeId: g.id })}
                              title={`${g.nom} — ${fmtFR(g.debut)} → ${fmtFR(g.fin)} · ${g.avancement}%${eq ? ` · ${eq.nom}` : ""}`}
                              style={{
                                position: "absolute", left, top: (ROW_H - 26) / 2, width: w, height: 26,
                                background: g.couleur, borderRadius: 6, cursor: "pointer",
                                border: isSel ? `2px solid ${T.text}` : "2px solid transparent",
                                boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                                display: "flex", alignItems: "center", overflow: "hidden",
                              }}>
                              {/* Avancement : liseré bas */}
                              {g.avancement > 0 && (
                                <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${g.avancement}%`, background: "rgba(255,255,255,.65)", borderRadius: "0 2px 2px 0" }} />
                              )}
                              {w > 56 && (
                                <span style={{
                                  padding: "0 7px", fontSize: FONT.xs.size, fontWeight: 800, color: "#fff",
                                  textShadow: "0 0 3px rgba(0,0,0,.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {g.nom}{g.avancement > 0 ? ` · ${g.avancement}%` : ""}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Détail du groupe cliqué */}
          {detailGroupe}

          {/* Légende */}
          {legende.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, alignItems: "center" }}>
              <span style={{ fontSize: FONT.xs.size, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, fontWeight: 700 }}>Légende</span>
              {legende.map((l, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: l.couleur, display: "inline-block" }} />
                  {l.nom}
                </span>
              ))}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                <span style={{ width: 2, height: 12, background: "#e15a5a", display: "inline-block" }} />
                Aujourd'hui
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
