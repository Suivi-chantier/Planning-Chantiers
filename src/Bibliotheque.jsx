import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { BIBLIOTHEQUE_INITIALE } from "./constants";

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

const CATEGORIES_BASE = [
  { label: "Plâtrerie",                   ids: ["cloison", "doublage", "plafond", "lainage", "faux_plafond", "double"] },
  { label: "Électricité",                 ids: ["install_elec", "tableau", "radiateur", "vmc", "prise", "mise_a_terre"] },
  { label: "Plomberie / Sanitaire",       ids: ["chauffe_eau", "wc", "meuble_vasque", "receveur"] },
  { label: "Menuiserie / Gros œuvre",     ids: ["porte", "escalier", "plancher"] },
  { label: "Finitions",                   ids: ["peinture", "parquet", "ragreage"] },
];

// ─── SOUS-TÂCHE ROW ──────────────────────────────────────────────────────────
function SousTacheRow({ st, idx, editData, ouvrage, setOuvrages, ouvrages, T }) {
  const phase = PHASES.find(p => p.id === st.phaseId);
  const cadenceST = editData.cadence > 0 && st.ratio
    ? parseFloat(((editData.cadence * st.ratio) / 100).toFixed(3))
    : null;

  function update(field, value) {
    const next = [...(editData.sous_taches || [])];
    next[idx] = { ...next[idx], [field]: value };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function remove() {
    const next = (editData.sous_taches || []).filter((_, i) => i !== idx);
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 180px 80px 70px 26px",
      gap: 8,
      alignItems: "center",
      padding: "8px 12px",
      borderRadius: 8,
      background: T.card,
      border: `1px solid ${T.border}`,
    }}>
      {/* Nom de la sous-tâche */}
      <input
        value={st.nom || ""}
        onChange={e => update("nom", e.target.value)}
        placeholder="ex: Pose des rails, Vis et joints…"
        style={{
          padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}`,
          background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none",
        }}
      />

      {/* Phase */}
      <select
        value={st.phaseId || ""}
        onChange={e => update("phaseId", e.target.value)}
        style={{
          padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`,
          background: T.inputBg, color: st.phaseId ? (phase?.couleur || T.text) : T.textMuted,
          fontFamily: "inherit", fontSize: 12, outline: "none", cursor: "pointer", fontWeight: st.phaseId ? 700 : 400,
        }}
      >
        <option value="">Phase automatique…</option>
        {PHASES.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>)}
      </select>

      {/* Ratio */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number" min="0" max="100" step="1"
          value={st.ratio || ""}
          onChange={e => update("ratio", parseFloat(e.target.value) || 0)}
          style={{
            width: "100%", padding: "6px 6px", borderRadius: 6, textAlign: "center",
            border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent,
            fontFamily: "inherit", fontSize: 13, fontWeight: 800, outline: "none",
          }}
        />
        <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0 }}>%</span>
      </div>

      {/* Cadence calculée */}
      <div style={{ textAlign: "center" }}>
        {cadenceST !== null
          ? <span style={{ fontSize: 11, fontWeight: 700, color: "#5b9cf6", background: "rgba(91,156,246,0.12)", padding: "3px 6px", borderRadius: 5, whiteSpace: "nowrap" }}>{cadenceST}h</span>
          : <span style={{ fontSize: 11, color: T.textMuted }}>—</span>
        }
      </div>

      <button
        onClick={remove}
        style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", fontSize: 15, padding: 0, lineHeight: 1 }}
      >✕</button>
    </div>
  );
}

// ─── OUVRAGE CARD ─────────────────────────────────────────────────────────────
function OuvrageCard({ ouvrage, isEdit, onToggleEdit, onSave, onDelete, saving, ouvrages, setOuvrages, categories, getCat, changerCategorie, T }) {
  const editData = ouvrages.find(o => o.id === ouvrage.id) || ouvrage;
  const total = (editData.sous_taches || []).reduce((s, t) => s + (parseFloat(t.ratio) || 0), 0);
  const totalOk = editData.sous_taches?.length === 0 || Math.abs(total - 100) <= 0.5;
  const currentCat = getCat(ouvrage.identifiant);
  const cadence = parseFloat(ouvrage.cadence) || null;

  function addSousTache() {
    const next = [...(editData.sous_taches || []), { nom: "", ratio: 0, phaseId: "" }];
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  return (
    <div style={{
      background: T.surface, border: `1px solid ${isEdit ? T.accent : T.border}`,
      borderRadius: 12, overflow: "hidden", transition: "border .2s",
    }}>
      {/* En-tête cliquable */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer" }}
        onClick={() => onToggleEdit(ouvrage.id)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ouvrage.libelle}</span>
          <span style={{ fontSize: 11, color: T.textMuted, background: T.card, padding: "2px 8px", borderRadius: 4 }}>{ouvrage.unite}</span>
          {cadence
            ? <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, background: `${T.accent}18`, padding: "2px 10px", borderRadius: 20, border: `1px solid ${T.accent}33` }}>⏱ {cadence}h / {ouvrage.unite}</span>
            : <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>Pas de cadence</span>
          }
          {/* Aperçu des sous-tâches */}
          {!isEdit && (ouvrage.sous_taches || []).length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(ouvrage.sous_taches || []).slice(0, 4).map((st, i) => {
                const ph = PHASES.find(p => p.id === st.phaseId);
                return (
                  <span key={i} style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 4,
                    background: ph ? `${ph.couleur}22` : T.card,
                    color: ph ? ph.couleur : T.textMuted,
                    border: `1px solid ${ph ? ph.couleur + "44" : T.border}`,
                    fontWeight: 600,
                  }}>{st.nom || "—"} {st.ratio}%</span>
                );
              })}
              {(ouvrage.sous_taches || []).length > 4 && (
                <span style={{ fontSize: 10, color: T.textMuted, padding: "2px 6px" }}>+{ouvrage.sous_taches.length - 4}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: T.textMuted }}>{(ouvrage.sous_taches || []).length} sous-tâche{(ouvrage.sous_taches || []).length > 1 ? "s" : ""}</span>
          <span style={{ fontSize: 12, color: isEdit ? T.accent : T.textMuted }}>{isEdit ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Zone édition */}
      {isEdit && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.sectionDivider}` }}>

          {/* Propriétés principales */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12,
            marginTop: 14, marginBottom: 14, padding: "14px 16px",
            background: T.card, borderRadius: 10, border: `1px solid ${T.border}`,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Nom</label>
              <input
                value={editData.libelle}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, libelle: e.target.value }))}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Unité</label>
              <input
                value={editData.unite}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, unite: e.target.value }))}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Catégorie</label>
              <select
                value={currentCat}
                onChange={e => { e.stopPropagation(); changerCategorie(ouvrage.id, e.target.value); }}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none", cursor: "pointer" }}
              >
                {categories.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                <option value="Autre">Autre</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Cadence (h/{editData.unite || "u"})</label>
              <input
                type="number" min="0.01" step="0.05"
                value={editData.cadence ?? ""}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, cadence: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                onClick={e => e.stopPropagation()}
                placeholder="ex: 0.5"
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 15, fontWeight: 800, outline: "none", textAlign: "center" }}
              />
            </div>
          </div>

          {/* En-tête colonnes sous-tâches */}
          {(editData.sous_taches || []).length > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 180px 80px 70px 26px",
              gap: 8, padding: "0 12px 6px",
            }}>
              {["Nom de la sous-tâche", "Phase de travail", "Ratio", "Cadence", ""].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, textAlign: i >= 2 ? "center" : "left" }}>{h}</div>
              ))}
            </div>
          )}

          {/* Liste des sous-tâches */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(editData.sous_taches || []).map((st, idx) => (
              <SousTacheRow
                key={idx}
                st={st} idx={idx}
                editData={editData} ouvrage={ouvrage}
                setOuvrages={setOuvrages} ouvrages={ouvrages}
                T={T}
              />
            ))}
          </div>

          {/* Bouton ajout sous-tâche */}
          <button
            onClick={addSousTache}
            style={{
              marginTop: 8, width: "100%", padding: "9px",
              border: `1.5px dashed ${T.border}`, borderRadius: 8,
              background: "transparent", color: T.textMuted,
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >+ Ajouter une sous-tâche</button>

          {/* Aperçu répartition si cadence définie */}
          {editData.cadence > 0 && (editData.sous_taches || []).length > 0 && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: `${T.accent}0D`, borderRadius: 8, border: `1px solid ${T.accent}22` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>⏱ Récap cadence par sous-tâche</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(editData.sous_taches || []).filter(st => st.nom).map((st, i) => {
                  const ph = PHASES.find(p => p.id === st.phaseId);
                  const hPU = parseFloat(((editData.cadence * st.ratio) / 100).toFixed(3));
                  return (
                    <div key={i} style={{
                      fontSize: 11, padding: "4px 10px", borderRadius: 6,
                      background: ph ? `${ph.couleur}18` : T.card,
                      border: `1px solid ${ph ? ph.couleur + "44" : T.border}`,
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      {ph && <span style={{ fontSize: 12 }}>{ph.emoji}</span>}
                      <span style={{ color: T.text, fontWeight: 600 }}>{st.nom}</span>
                      <span style={{ color: T.textMuted }}>({st.ratio}%)</span>
                      <span style={{ color: ph?.couleur || T.accent, fontWeight: 700 }}>→ {hPU}h/{editData.unite}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.sectionDivider}`,
          }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <button
                onClick={() => onDelete(ouvrage.id)}
                style={{ background: "transparent", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 8, padding: "8px 16px", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}
              >🗑️ Supprimer</button>
              <div style={{ fontSize: 13, fontWeight: 700, color: totalOk ? "#50c878" : "#e05c5c" }}>
                Total : {total.toFixed(0)}% {totalOk ? "✓" : "⚠️ doit être 100%"}
              </div>
            </div>
            <button
              onClick={() => onSave(editData)}
              disabled={saving === ouvrage.id}
              style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >{saving === ouvrage.id ? "Sauvegarde…" : "✓ Sauvegarder"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE BIBLIOTHÈQUE (refonte) ─────────────────────────────────────────────
function PageBibliotheque({ T }) {
  const [ouvrages, setOuvrages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [filterCat, setFilterCat] = useState("Toutes");

  const [showNew, setShowNew] = useState(false);
  const [newLibelle, setNewLibelle] = useState("");
  const [newUnite, setNewUnite] = useState("U");
  const [newCatPrefix, setNewCatPrefix] = useState("autre");

  const [categoriesCustom, setCategoriesCustom] = useState([]);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatId, setNewCatId] = useState("");

  const categories = [...CATEGORIES_BASE, ...categoriesCustom];

  useEffect(() => { loadOuvrages(); loadCategoriesCustom(); }, []);

  async function loadOuvrages() {
    setLoading(true);
    const { data } = await supabase.from("bibliotheque_ratios").select("*").order("libelle");
    if (data && data.length > 0) {
      setOuvrages(data);
    } else {
      const inserts = BIBLIOTHEQUE_INITIALE.map(o => ({
        identifiant: o.identifiant, libelle: o.libelle, unite: o.unite || "", sous_taches: o.sous_taches,
      }));
      const { data: inserted } = await supabase.from("bibliotheque_ratios").insert(inserts).select();
      setOuvrages(inserted || []);
    }
    setLoading(false);
  }

  function loadCategoriesCustom() {
    try {
      const stored = localStorage.getItem("bibliotheque_categories_custom");
      if (stored) setCategoriesCustom(JSON.parse(stored));
    } catch (_) {}
  }

  function saveCategoriesCustom(cats) {
    setCategoriesCustom(cats);
    localStorage.setItem("bibliotheque_categories_custom", JSON.stringify(cats));
  }

  function creerCategorie() {
    const label = newCatLabel.trim();
    const id = newCatId.trim() || label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!label || !id) return;
    if (categories.some(c => c.label === label)) { setMsg({ type: "error", text: "⚠️ Une catégorie avec ce nom existe déjà" }); return; }
    saveCategoriesCustom([...categoriesCustom, { label, ids: [id], custom: true }]);
    setShowNewCat(false); setNewCatLabel(""); setNewCatId("");
    flash("ok", `✓ Catégorie "${label}" créée`);
  }

  async function supprimerCategorie(catLabel) {
    if (!confirm(`Supprimer la catégorie "${catLabel}" ?`)) return;
    const cat = categoriesCustom.find(c => c.label === catLabel);
    if (!cat?.custom) return;
    const affected = ouvrages.filter(o => cat.ids.some(k => o.identifiant?.startsWith(k)));
    if (affected.length > 0) {
      await Promise.all(affected.map(o => supabase.from("bibliotheque_ratios").update({ identifiant: `autre_${o.id}` }).eq("id", o.id)));
      setOuvrages(prev => prev.map(o => affected.find(a => a.id === o.id) ? { ...o, identifiant: `autre_${o.id}` } : o));
    }
    saveCategoriesCustom(categoriesCustom.filter(c => c.label !== catLabel));
    if (filterCat === catLabel) setFilterCat("Toutes");
    flash("ok", "Catégorie supprimée.");
  }

  async function changerCategorie(ouvrageId, newCatLabel) {
    const cat = categories.find(c => c.label === newCatLabel);
    const prefix = cat ? cat.ids[0] : "autre";
    const newId = `${prefix}_${ouvrageId}`;
    await supabase.from("bibliotheque_ratios").update({ identifiant: newId }).eq("id", ouvrageId);
    setOuvrages(prev => prev.map(o => o.id === ouvrageId ? { ...o, identifiant: newId } : o));
  }

  async function creerOuvrage() {
    if (!newLibelle.trim()) return;
    const newO = { identifiant: `${newCatPrefix}_${Date.now()}`, libelle: newLibelle.trim(), unite: newUnite, cadence: null, sous_taches: [] };
    const { data, error } = await supabase.from("bibliotheque_ratios").insert([newO]).select();
    if (!error && data) {
      setOuvrages(prev => [...prev, data[0]]);
      setShowNew(false); setNewLibelle(""); setNewUnite("U");
      setEditId(data[0].id);
    }
  }

  async function supprimerOuvrage(id) {
    if (!confirm("Supprimer cet ouvrage de la bibliothèque ?")) return;
    await supabase.from("bibliotheque_ratios").delete().eq("id", id);
    setOuvrages(prev => prev.filter(o => o.id !== id));
    if (editId === id) setEditId(null);
  }

  async function saveOuvrage(ouvrage) {
    setSaving(ouvrage.id);
    const total = (ouvrage.sous_taches || []).reduce((s, t) => s + (parseFloat(t.ratio) || 0), 0);
    if (ouvrage.sous_taches.length > 0 && Math.abs(total - 100) > 0.5) {
      setMsg({ type: "error", text: `⚠️ La somme des ratios doit être 100% (actuellement ${total.toFixed(1)}%)` });
      setSaving(null); return;
    }
    await supabase.from("bibliotheque_ratios").update({
      libelle: ouvrage.libelle, unite: ouvrage.unite,
      cadence: ouvrage.cadence ?? null,
      sous_taches: ouvrage.sous_taches,
      updated_at: new Date().toISOString(),
    }).eq("id", ouvrage.id);
    flash("ok", "✓ Ouvrage sauvegardé");
    setSaving(null);
    setEditId(null);
  }

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 2500);
  }

  function getCat(identifiant) {
    for (const cat of categories) {
      if (cat.ids.some(k => identifiant && identifiant.startsWith(k))) return cat.label;
    }
    return "Autre";
  }

  const uniqueCats = ["Toutes", ...categories.map(c => c.label), "Autre"];
  const filtered = ouvrages.filter(o => {
    const matchSearch = !search || o.libelle?.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "Toutes" || getCat(o.identifiant) === filterCat;
    return matchSearch && matchCat;
  });
  const grouped = {};
  filtered.forEach(o => { const cat = getCat(o.identifiant); if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(o); });
  const catCounts = {};
  ouvrages.forEach(o => { const cat = getCat(o.identifiant); catCounts[cat] = (catCounts[cat] || 0) + 1; });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: T.bg }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: T.text }}>📚 Bibliothèque de ratios</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>
              Définissez vos ouvrages, leurs sous-tâches nommées, phases et cadences · Utilisé lors de l'import devis
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, width: 200, outline: "none" }}
            />
            <button onClick={() => setShowNew(true)} style={{ background: T.accent, color: "#111", border: "none", borderRadius: 8, padding: "9px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nouvel ouvrage</button>
            <button onClick={() => setShowNewCat(true)} style={{ background: "transparent", color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Catégorie</button>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {uniqueCats.map(cat => {
            const count = cat === "Toutes" ? ouvrages.length : (catCounts[cat] || 0);
            const isActive = filterCat === cat;
            const isCustom = categoriesCustom.some(c => c.label === cat);
            return (
              <div key={cat} style={{ display: "flex", alignItems: "center" }}>
                <button onClick={() => setFilterCat(cat)} style={{
                  padding: "6px 14px", borderRadius: isCustom ? "8px 0 0 8px" : 8,
                  border: `1px solid ${isActive ? T.accent : T.border}`, borderRight: isCustom ? "none" : undefined,
                  background: isActive ? `${T.accent}22` : "transparent", color: isActive ? T.accent : T.textMuted,
                  fontFamily: "inherit", fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {cat}
                  {count > 0 && <span style={{ background: isActive ? T.accent : T.border, color: isActive ? "#111" : T.textMuted, borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{count}</span>}
                </button>
                {isCustom && (
                  <button onClick={() => supprimerCategorie(cat)} style={{ padding: "6px 8px", borderRadius: "0 8px 8px 0", border: `1px solid ${T.border}`, borderLeft: "none", background: "transparent", color: "#e05c5c", cursor: "pointer", fontSize: 11 }}>✕</button>
                )}
              </div>
            );
          })}
        </div>

        {/* Notification */}
        {msg && (
          <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600, background: msg.type === "ok" ? "rgba(80,200,120,0.12)" : "rgba(224,92,92,0.12)", color: msg.type === "ok" ? "#50c878" : "#e05c5c", border: `1px solid ${msg.type === "ok" ? "rgba(80,200,120,0.3)" : "rgba(224,92,92,0.3)"}` }}>
            {msg.text}
          </div>
        )}

        {/* Form nouvelle catégorie */}
        {showNewCat && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer une catégorie</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nom de la catégorie" style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <input value={newCatId} onChange={e => setNewCatId(e.target.value)} placeholder="Préfixe identifiant" style={{ flex: 1, minWidth: 160, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <button onClick={creerCategorie} disabled={!newCatLabel.trim()} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newCatLabel.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Créer</button>
              <button onClick={() => setShowNewCat(false)} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {/* Form nouvel ouvrage */}
        {showNew && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer un nouvel ouvrage</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newLibelle} onChange={e => setNewLibelle(e.target.value)} placeholder="Nom de l'ouvrage" style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <select value={newCatPrefix} onChange={e => setNewCatPrefix(e.target.value)} style={{ flex: 1, minWidth: 140, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                {categories.map(c => <option key={c.label} value={c.ids[0]}>{c.label}</option>)}
                <option value="autre">Autre</option>
              </select>
              <input value={newUnite} onChange={e => setNewUnite(e.target.value)} placeholder="Unité" style={{ width: 80, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
              <button onClick={creerOuvrage} disabled={!newLibelle.trim()} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newLibelle.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Créer</button>
              <button onClick={() => setShowNew(false)} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {/* Liste */}
        {loading
          ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60 }}>Chargement…</div>
          : filtered.length === 0
            ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60, fontSize: 14 }}>Aucun ouvrage trouvé.</div>
            : Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingLeft: 2 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: T.accent }}>{cat}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>({items.length})</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(ouvrage => (
                    <OuvrageCard
                      key={ouvrage.id}
                      ouvrage={ouvrage}
                      isEdit={editId === ouvrage.id}
                      onToggleEdit={id => setEditId(editId === id ? null : id)}
                      onSave={saveOuvrage}
                      onDelete={supprimerOuvrage}
                      saving={saving}
                      ouvrages={ouvrages}
                      setOuvrages={setOuvrages}
                      categories={categories}
                      getCat={getCat}
                      changerCategorie={changerCategorie}
                      T={T}
                    />
                  ))}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  );
}

export default PageBibliotheque;
