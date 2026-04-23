import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

// ─── STATUTS POINTS DE CONTRÔLE ──────────────────────────────────────────────
const STATUTS_CTRL = [
  { id: "ok",       label: "✓ Conforme",       color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)"  },
  { id: "reserve",  label: "⚠ Réserve",         color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)" },
  { id: "non_ok",   label: "✕ Non conforme",    color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)"  },
  { id: "na",       label: "— N/A",              color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.2)" },
];

const STATUT_VISITE = [
  { id: "en_cours",  label: "En cours",   color: "#f59e0b" },
  { id: "terminee",  label: "Terminée",   color: "#22c55e" },
];

// ─── LOTS PRÉDÉFINIS ──────────────────────────────────────────────────────────
const LOTS_PREDEFINIS = [
  { id: "gros_oeuvre",   nom: "Gros Œuvre",          icon: "🧱",
    points: ["État des murs porteurs","Planéité des dalles","Étanchéité toiture","Évacuations EP","Réservations baies"] },
  { id: "cloisons",      nom: "Cloisons / Placo",    icon: "📐",
    points: ["Aplomb des cloisons","Planéité des surfaces","Encadrements portes","Percements techniques","Joints et raccords"] },
  { id: "electricite",   nom: "Électricité",          icon: "⚡",
    points: ["Tableau électrique","Mise à la terre","Prises de courant","Interrupteurs","VMC / ventilation","Éclairage"] },
  { id: "plomberie",     nom: "Plomberie / Sanitaire", icon: "🚿",
    points: ["Alimentation eau froide/chaude","Évacuations","Étanchéité robinetterie","WC / vasques","Chauffe-eau"] },
  { id: "menuiseries",   nom: "Menuiseries",          icon: "🚪",
    points: ["Portes intérieures","Fenêtres / vitrages","Joints d'étanchéité","Quincaillerie","Seuils"] },
  { id: "sols",          nom: "Revêtements sols",     icon: "🏠",
    points: ["Ragréage / planéité","Parquet / PVC","Plinthes","Joints de dilatation","Escaliers"] },
  { id: "peinture",      nom: "Peinture / Enduits",   icon: "🖌️",
    points: ["Homogénéité teintes","Finition des angles","Impressions","Reprises et retouches","Nettoyage"] },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toISOString().split("T")[0]; }
function formatDate(d) {
  if (!d) return "";
  const [y, m, j] = d.split("-");
  return `${j}/${m}/${y}`;
}

// ─── PAGE VISITE CHANTIER ─────────────────────────────────────────────────────
function PageVisiteChantier({ chantiers, ouvriers, T }) {
  const [visites, setVisites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("liste"); // "liste" | "nouvelle" | "detail"
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── Chargement depuis Supabase ──
  const loadVisites = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("visites_chantier")
      .select("*")
      .order("date", { ascending: false });
    if (!error && data) setVisites(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadVisites(); }, [loadVisites]);

  const saveVisite = async (visite) => {
    setSaving(true);
    const { error } = await supabase
      .from("visites_chantier")
      .upsert({ ...visite, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (!error) {
      setVisites(prev => {
        const exists = prev.find(v => v.id === visite.id);
        if (exists) return prev.map(v => v.id === visite.id ? visite : v);
        return [visite, ...prev];
      });
    }
    setSaving(false);
    return !error;
  };

  const deleteVisite = async (id) => {
    if (!window.confirm("Supprimer cette visite ?")) return;
    await supabase.from("visites_chantier").delete().eq("id", id);
    setVisites(prev => prev.filter(v => v.id !== id));
    setView("liste");
  };

  const selectedVisite = visites.find(v => v.id === selectedId);

  // ── Stats globales ──
  const statsGlobales = visites.reduce((acc, v) => {
    const pts = Object.values(v.points_controle || {});
    acc.ok     += pts.filter(p => p === "ok").length;
    acc.reserve+= pts.filter(p => p === "reserve").length;
    acc.non_ok += pts.filter(p => p === "non_ok").length;
    return acc;
  }, { ok: 0, reserve: 0, non_ok: 0 });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: "16px 28px", borderBottom: `1px solid ${T.headerBorder}`,
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        background: T.surface, flexShrink: 0,
      }}>
        {view !== "liste" && (
          <button onClick={() => { setView("liste"); setSelectedId(null); }}
            style={{
              background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "7px 14px", color: T.textSub, fontFamily: "inherit", fontSize: 13,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}>← Retour</button>
        )}
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>
          {view === "liste" ? "VISITES CHANTIER" : view === "nouvelle" ? "NOUVELLE VISITE" : "DÉTAIL VISITE"}
        </div>
        {view === "liste" && (
          <button onClick={() => setView("nouvelle")} style={{
            marginLeft: "auto", background: T.accent, color: "#111", border: "none",
            borderRadius: 8, padding: "9px 20px", fontFamily: "inherit",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>+ Nouvelle visite</button>
        )}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {view === "liste" && (
          <ListView
            visites={visites} chantiers={chantiers} loading={loading}
            stats={statsGlobales} T={T}
            onOpen={(id) => { setSelectedId(id); setView("detail"); }}
            onDelete={deleteVisite}
          />
        )}
        {view === "nouvelle" && (
          <FormVisite
            chantiers={chantiers} ouvriers={ouvriers} T={T}
            saving={saving}
            onSave={async (v) => {
              const ok = await saveVisite(v);
              if (ok) { setSelectedId(v.id); setView("detail"); }
            }}
            onCancel={() => setView("liste")}
          />
        )}
        {view === "detail" && selectedVisite && (
          <DetailVisite
            visite={selectedVisite} chantiers={chantiers} ouvriers={ouvriers}
            T={T} saving={saving}
            onSave={async (v) => { await saveVisite(v); }}
            onDelete={() => deleteVisite(selectedVisite.id)}
          />
        )}
      </div>
    </div>
  );
}

// ─── LISTE DES VISITES ────────────────────────────────────────────────────────
function ListView({ visites, chantiers, loading, stats, T, onOpen, onDelete }) {
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: T.textMuted, fontSize: 15 }}>
      Chargement…
    </div>
  );

  return (
    <div>
      {/* Stats globales */}
      {visites.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Points conformes", val: stats.ok,      color: "#22c55e", icon: "✓" },
            { label: "Réserves",          val: stats.reserve, color: "#f59e0b", icon: "⚠" },
            { label: "Non conformes",     val: stats.non_ok,  color: "#ef4444", icon: "✕" },
          ].map(s => (
            <div key={s.label} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, background: s.color + "22",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, color: s.color, fontWeight: 800, flexShrink: 0,
              }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {visites.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: 300, gap: 16, color: T.textMuted,
        }}>
          <div style={{ fontSize: 56 }}>🏗️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Aucune visite enregistrée</div>
          <div style={{ fontSize: 14 }}>Créez votre première visite de chantier</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visites.map(v => {
            const ch = chantiers.find(c => c.id === v.chantier_id);
            const pts = Object.values(v.points_controle || {});
            const total = pts.length;
            const ok = pts.filter(p => p === "ok").length;
            const res = pts.filter(p => p === "reserve").length;
            const nok = pts.filter(p => p === "non_ok").length;
            const statut = STATUT_VISITE.find(s => s.id === v.statut) || STATUT_VISITE[0];

            return (
              <div key={v.id} onClick={() => onOpen(v.id)} style={{
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
                padding: "16px 20px", cursor: "pointer", transition: "all .15s",
                display: "flex", alignItems: "center", gap: 16,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = T.accent + "66"}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                {/* Couleur chantier */}
                <div style={{
                  width: 5, alignSelf: "stretch", borderRadius: 3,
                  background: ch?.couleur || "#ccc", flexShrink: 0,
                }} />

                {/* Infos principales */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: T.text }}>
                      {ch?.nom || v.chantier_id}
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                      background: statut.color + "22", color: statut.color, border: `1px solid ${statut.color}44`,
                    }}>{statut.label}</span>
                  </div>
                  <div style={{ fontSize: 13, color: T.textMuted, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>📅 {formatDate(v.date)}</span>
                    {v.intervenant && <span>👷 {v.intervenant}</span>}
                    {v.meteo && <span>{v.meteo}</span>}
                  </div>
                </div>

                {/* Compteurs */}
                {total > 0 && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {ok > 0   && <Pill val={ok}  color="#22c55e" icon="✓" />}
                    {res > 0  && <Pill val={res} color="#f59e0b" icon="⚠" />}
                    {nok > 0  && <Pill val={nok} color="#ef4444" icon="✕" />}
                  </div>
                )}

                <div style={{ fontSize: 18, color: T.textMuted, flexShrink: 0 }}>›</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── FORMULAIRE NOUVELLE VISITE ───────────────────────────────────────────────
function FormVisite({ chantiers, ouvriers, T, saving, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: genId(),
    chantier_id: chantiers[0]?.id || "",
    date: today(),
    intervenant: ouvriers[0] || "",
    meteo: "☀️ Beau",
    statut: "en_cours",
    lots_selectionnes: [],
    points_controle: {},
    observations: {},
    note_generale: "",
  });

  const toggleLot = (lotId) => {
    setForm(prev => {
      const has = prev.lots_selectionnes.includes(lotId);
      return {
        ...prev,
        lots_selectionnes: has
          ? prev.lots_selectionnes.filter(l => l !== lotId)
          : [...prev.lots_selectionnes, lotId],
      };
    });
  };

  const handleSave = () => {
    if (!form.chantier_id) return;
    onSave(form);
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Entête visite */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 16 }}>
          Informations générales
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 4 }}>Chantier *</label>
            <select value={form.chantier_id} onChange={e => setForm(p => ({ ...p, chantier_id: e.target.value }))}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text, fontFamily: "inherit", fontSize: 14,
              }}>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 4 }}>Date</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text, fontFamily: "inherit", fontSize: 14,
              }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 4 }}>Intervenant</label>
            <select value={form.intervenant} onChange={e => setForm(p => ({ ...p, intervenant: e.target.value }))}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text, fontFamily: "inherit", fontSize: 14,
              }}>
              {ouvriers.map(o => <option key={o} value={o}>{o}</option>)}
              <option value="">Autre…</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 4 }}>Météo</label>
            <select value={form.meteo} onChange={e => setForm(p => ({ ...p, meteo: e.target.value }))}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text, fontFamily: "inherit", fontSize: 14,
              }}>
              {["☀️ Beau", "⛅ Nuageux", "🌧️ Pluie", "❄️ Froid", "🌬️ Vent"].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Sélection des lots */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 16 }}>
          Lots à contrôler
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {LOTS_PREDEFINIS.map(lot => {
            const sel = form.lots_selectionnes.includes(lot.id);
            return (
              <button key={lot.id} onClick={() => toggleLot(lot.id)} style={{
                padding: "12px 16px", borderRadius: 10, cursor: "pointer",
                fontFamily: "inherit", fontSize: 14, fontWeight: 600, textAlign: "left",
                background: sel ? T.accent + "22" : T.card,
                border: `2px solid ${sel ? T.accent : T.border}`,
                color: sel ? T.accent : T.textSub, transition: "all .12s",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>{lot.icon}</span>
                <span style={{ flex: 1 }}>{lot.nom}</span>
                {sel && <span style={{ fontSize: 16, color: T.accent }}>✓</span>}
              </button>
            );
          })}
        </div>
        {form.lots_selectionnes.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted }}>
            {form.lots_selectionnes.length} lot(s) sélectionné(s) — les points de contrôle seront générés automatiquement.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8,
          padding: "10px 20px", color: T.textSub, fontFamily: "inherit", fontSize: 14, cursor: "pointer",
        }}>Annuler</button>
        <button onClick={handleSave} disabled={saving || !form.chantier_id} style={{
          background: T.accent, color: "#111", border: "none", borderRadius: 8,
          padding: "10px 28px", fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer",
          opacity: saving ? .6 : 1,
        }}>
          {saving ? "Création…" : "Créer la visite →"}
        </button>
      </div>
    </div>
  );
}

// ─── DÉTAIL / ÉDITION VISITE ──────────────────────────────────────────────────
function DetailVisite({ visite, chantiers, ouvriers, T, saving, onSave, onDelete }) {
  const [draft, setDraft] = useState(() => ({
    ...visite,
    lots_selectionnes: visite.lots_selectionnes || [],
    points_controle: visite.points_controle || {},
    observations: visite.observations || {},
  }));
  const [activeLot, setActiveLot] = useState(() =>
    (visite.lots_selectionnes || [])[0] || LOTS_PREDEFINIS[0].id
  );
  const [dirty, setDirty] = useState(false);
  const [printMode, setPrintMode] = useState(false);

  const ch = chantiers.find(c => c.id === draft.chantier_id);

  const update = (key, val) => {
    setDraft(p => ({ ...p, [key]: val }));
    setDirty(true);
  };

  const setPoint = (lotId, pointIdx, statut) => {
    const key = `${lotId}_${pointIdx}`;
    setDraft(p => ({ ...p, points_controle: { ...p.points_controle, [key]: statut } }));
    setDirty(true);
  };

  const setObs = (lotId, pointIdx, text) => {
    const key = `${lotId}_${pointIdx}`;
    setDraft(p => ({ ...p, observations: { ...p.observations, [key]: text } }));
    setDirty(true);
  };

  const handleSave = async () => {
    await onSave(draft);
    setDirty(false);
  };

  const handlePrint = () => {
    const ch = chantiers.find(c => c.id === draft.chantier_id);
    const lotsData = LOTS_PREDEFINIS.filter(l => draft.lots_selectionnes.includes(l.id));
    let html = `
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Visite chantier – ${ch?.nom} – ${formatDate(draft.date)}</title>
      <style>
        @page{size:A4;margin:15mm}
        body{font-family:Arial,sans-serif;font-size:10px;color:#1a1f2e}
        h1{font-size:18px;font-weight:800;margin-bottom:4px;letter-spacing:1px}
        .sub{font-size:11px;color:#666;margin-bottom:20px}
        .lot{margin-bottom:20px;page-break-inside:avoid}
        .lot-title{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;
          padding:8px 12px;background:#1a1f2e;color:#fff;border-radius:6px 6px 0 0;margin-bottom:0}
        table{width:100%;border-collapse:collapse;margin-bottom:0}
        th{background:#f0f2f8;padding:6px 10px;text-align:left;font-size:10px;font-weight:700;
          text-transform:uppercase;letter-spacing:.5px;border:1px solid #ddd}
        td{padding:7px 10px;border:1px solid #ddd;vertical-align:top}
        .ok{color:#22c55e;font-weight:700} .reserve{color:#f59e0b;font-weight:700}
        .non_ok{color:#ef4444;font-weight:700} .na{color:#999}
        .note-gen{margin-top:20px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:6px}
        .stats{display:flex;gap:12px;margin-bottom:16px}
        .stat-box{padding:8px 14px;border-radius:6px;font-size:11px;font-weight:700}
      </style></head><body>
      <h1>VISITE DE CHANTIER — ${ch?.nom || ""}</h1>
      <div class="sub">
        Date : ${formatDate(draft.date)} &nbsp;|&nbsp;
        Intervenant : ${draft.intervenant || "—"} &nbsp;|&nbsp;
        Météo : ${draft.meteo || "—"} &nbsp;|&nbsp;
        Statut : ${STATUT_VISITE.find(s => s.id === draft.statut)?.label || ""}
      </div>
    `;

    lotsData.forEach(lot => {
      html += `<div class="lot"><div class="lot-title">${lot.icon} ${lot.nom}</div>
        <table><thead><tr>
          <th style="width:45%">Point de contrôle</th>
          <th style="width:18%">Statut</th>
          <th>Observation</th>
        </tr></thead><tbody>`;
      lot.points.forEach((pt, idx) => {
        const key = `${lot.id}_${idx}`;
        const statut = draft.points_controle[key] || "";
        const obs = draft.observations[key] || "";
        const sc = STATUTS_CTRL.find(s => s.id === statut);
        html += `<tr>
          <td>${pt}</td>
          <td class="${statut || 'na'}">${sc?.label || "—"}</td>
          <td>${obs || ""}</td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    });

    if (draft.note_generale?.trim()) {
      html += `<div class="note-gen"><strong>Note générale :</strong><br>${draft.note_generale.replace(/\n/g, "<br>")}</div>`;
    }

    html += `</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // Calcul avancement du lot actif
  const getLotStats = (lotId) => {
    const lot = LOTS_PREDEFINIS.find(l => l.id === lotId);
    if (!lot) return { total: 0, ok: 0, reserve: 0, non_ok: 0, na: 0 };
    const vals = lot.points.map((_, i) => draft.points_controle[`${lotId}_${i}`]).filter(Boolean);
    return {
      total: lot.points.length,
      ok:      vals.filter(v => v === "ok").length,
      reserve: vals.filter(v => v === "reserve").length,
      non_ok:  vals.filter(v => v === "non_ok").length,
      na:      vals.filter(v => v === "na").length,
    };
  };

  const lotsActifs = LOTS_PREDEFINIS.filter(l => draft.lots_selectionnes.includes(l.id));
  const lotDetail = LOTS_PREDEFINIS.find(l => l.id === activeLot);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* Colonne gauche : infos + lots */}
      <div style={{ width: 240, flexShrink: 0 }}>
        {/* Entête chantier */}
        <div style={{
          background: ch?.couleur || T.surface,
          borderRadius: 12, padding: "16px 18px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1a1f2e", letterSpacing: 1 }}>{ch?.nom}</div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,0.5)", marginTop: 4 }}>📅 {formatDate(draft.date)}</div>
          {draft.intervenant && <div style={{ fontSize: 13, color: "rgba(0,0,0,0.5)" }}>👷 {draft.intervenant}</div>}
          {draft.meteo && <div style={{ fontSize: 13, color: "rgba(0,0,0,0.5)" }}>{draft.meteo}</div>}
        </div>

        {/* Statut global */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>Statut</div>
          <div style={{ display: "flex", gap: 6 }}>
            {STATUT_VISITE.map(s => (
              <button key={s.id} onClick={() => update("statut", s.id)} style={{
                flex: 1, padding: "7px 4px", borderRadius: 7, cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                background: draft.statut === s.id ? s.color + "22" : "transparent",
                border: `2px solid ${draft.statut === s.id ? s.color : T.border}`,
                color: draft.statut === s.id ? s.color : T.textSub,
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Navigation lots */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>Lots contrôlés</div>
          {lotsActifs.length === 0 && (
            <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucun lot sélectionné</div>
          )}
          {lotsActifs.map(lot => {
            const s = getLotStats(lot.id);
            const pct = s.total > 0 ? Math.round(((s.ok + s.reserve + s.non_ok + s.na) / s.total) * 100) : 0;
            const active = activeLot === lot.id;
            return (
              <button key={lot.id} onClick={() => setActiveLot(lot.id)} style={{
                width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: active ? 700 : 500,
                background: active ? T.accent + "18" : "transparent",
                border: `1.5px solid ${active ? T.accent : "transparent"}`,
                color: active ? T.accent : T.textSub, marginBottom: 4,
                display: "flex", flexDirection: "column", gap: 5,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{lot.icon}</span>
                  <span style={{ flex: 1 }}>{lot.nom}</span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>{pct}%</span>
                </div>
                {/* Barre de progression mini */}
                <div style={{ height: 3, borderRadius: 2, background: T.border, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${pct}%`,
                    background: s.non_ok > 0 ? "#ef4444" : s.reserve > 0 ? "#f59e0b" : "#22c55e",
                    transition: "width .3s",
                  }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={handleSave} disabled={!dirty || saving} style={{
            background: dirty ? T.accent : T.card, color: dirty ? "#111" : T.textMuted,
            border: `1px solid ${dirty ? T.accent : T.border}`, borderRadius: 8,
            padding: "10px", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
            cursor: dirty ? "pointer" : "default", transition: "all .2s",
          }}>
            {saving ? "Enregistrement…" : dirty ? "💾 Enregistrer" : "✓ Sauvegardé"}
          </button>
          <button onClick={handlePrint} style={{
            background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "9px", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
          }}>🖨️ Imprimer / PDF</button>
          <button onClick={onDelete} style={{
            background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8,
            padding: "9px", color: "#ef4444", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
          }}>🗑️ Supprimer</button>
        </div>
      </div>

      {/* Colonne droite : points de contrôle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {lotsActifs.length === 0 ? (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
            padding: 40, textAlign: "center", color: T.textMuted, fontSize: 15,
          }}>
            Aucun lot à contrôler — revenez en arrière pour en sélectionner.
          </div>
        ) : !lotDetail ? null : (
          <div>
            {/* Header lot */}
            <div style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px 14px 0 0",
              padding: "16px 22px", display: "flex", alignItems: "center", gap: 12,
              borderBottom: `2px solid ${T.accent}22`,
            }}>
              <span style={{ fontSize: 24 }}>{lotDetail.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: .5 }}>{lotDetail.nom}</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                  {lotDetail.points.length} points de contrôle
                </div>
              </div>
              {/* Stats lot */}
              {(() => {
                const s = getLotStats(activeLot);
                return (
                  <div style={{ display: "flex", gap: 6 }}>
                    {s.ok > 0     && <Pill val={s.ok}      color="#22c55e" icon="✓" />}
                    {s.reserve > 0&& <Pill val={s.reserve} color="#f59e0b" icon="⚠" />}
                    {s.non_ok > 0 && <Pill val={s.non_ok}  color="#ef4444" icon="✕" />}
                  </div>
                );
              })()}
            </div>

            {/* Points de contrôle */}
            <div style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderTop: "none", borderRadius: "0 0 14px 14px", overflow: "hidden",
            }}>
              {lotDetail.points.map((pt, idx) => {
                const key = `${activeLot}_${idx}`;
                const statut = draft.points_controle[key] || null;
                const obs = draft.observations[key] || "";
                const sc = STATUTS_CTRL.find(s => s.id === statut);

                return (
                  <div key={idx} style={{
                    padding: "14px 22px",
                    borderBottom: idx < lotDetail.points.length - 1 ? `1px solid ${T.border}` : "none",
                    background: sc ? sc.bg : "transparent",
                    transition: "background .15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: obs || statut === "reserve" || statut === "non_ok" ? 10 : 0 }}>
                      {/* Numéro */}
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, background: T.card,
                        border: `1px solid ${T.border}`, display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: 11, fontWeight: 700,
                        color: T.textMuted, flexShrink: 0, marginTop: 1,
                      }}>{idx + 1}</div>

                      {/* Libellé */}
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.text, lineHeight: 1.5, paddingTop: 3 }}>
                        {pt}
                      </div>

                      {/* Boutons statut */}
                      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                        {STATUTS_CTRL.map(s => (
                          <button key={s.id} onClick={() => setPoint(activeLot, idx, statut === s.id ? null : s.id)}
                            title={s.label}
                            style={{
                              width: statut === s.id ? "auto" : 32, height: 32,
                              padding: statut === s.id ? "0 10px" : 0,
                              borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                              fontSize: statut === s.id ? 12 : 14, fontWeight: 700,
                              background: statut === s.id ? s.color : T.card,
                              border: `2px solid ${statut === s.id ? s.color : T.border}`,
                              color: statut === s.id ? "#fff" : T.textSub,
                              transition: "all .12s", whiteSpace: "nowrap",
                            }}>
                            {statut === s.id ? s.label : s.label.split(" ")[0]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Zone observation (affichée si réserve ou non conforme, ou si déjà remplie) */}
                    {(statut === "reserve" || statut === "non_ok" || obs) && (
                      <div style={{ paddingLeft: 38 }}>
                        <textarea
                          value={obs}
                          onChange={e => setObs(activeLot, idx, e.target.value)}
                          placeholder="Décrire l'observation, la réserve ou la non-conformité…"
                          rows={2}
                          style={{
                            width: "100%", background: T.inputBg,
                            border: `1.5px solid ${sc?.border || T.border}`,
                            borderRadius: 8, padding: "10px 12px", color: T.text,
                            fontFamily: "inherit", fontSize: 13, lineHeight: 1.5,
                            resize: "vertical", outline: "none",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Navigation lots bas */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
              {(() => {
                const idx = lotsActifs.findIndex(l => l.id === activeLot);
                const prev = lotsActifs[idx - 1];
                const next = lotsActifs[idx + 1];
                return (
                  <>
                    <button onClick={() => prev && setActiveLot(prev.id)} disabled={!prev}
                      style={{
                        background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8,
                        padding: "9px 16px", color: prev ? T.textSub : T.border,
                        fontFamily: "inherit", fontSize: 13, cursor: prev ? "pointer" : "default",
                      }}>
                      {prev ? `← ${prev.icon} ${prev.nom}` : ""}
                    </button>
                    <button onClick={() => next && setActiveLot(next.id)} disabled={!next}
                      style={{
                        background: next ? T.accent + "22" : "transparent",
                        border: `1px solid ${next ? T.accent : T.border}`, borderRadius: 8,
                        padding: "9px 16px",
                        color: next ? T.accent : T.border,
                        fontFamily: "inherit", fontSize: 13, cursor: next ? "pointer" : "default",
                        fontWeight: next ? 700 : 400,
                      }}>
                      {next ? `${next.icon} ${next.nom} →` : ""}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* Note générale */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
          padding: "18px 22px", marginTop: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
            📝 Note générale de visite
          </div>
          <textarea
            value={draft.note_generale || ""}
            onChange={e => update("note_generale", e.target.value)}
            placeholder="Observations générales, points d'attention, actions à mener…"
            rows={4}
            style={{
              width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: "12px 14px", color: T.text,
              fontFamily: "inherit", fontSize: 14, lineHeight: 1.6, resize: "vertical", outline: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── COMPOSANT PILL ───────────────────────────────────────────────────────────
function Pill({ val, color, icon }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4, padding: "3px 9px",
      borderRadius: 7, background: color + "18", border: `1px solid ${color}44`,
      fontSize: 12, fontWeight: 700, color,
    }}>
      <span>{icon}</span><span>{val}</span>
    </div>
  );
}

export default PageVisiteChantier;
