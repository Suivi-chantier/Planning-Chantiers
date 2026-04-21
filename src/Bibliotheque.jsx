import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { BIBLIOTHEQUE_INITIALE } from "./constants";

// ─── LISTE DES FAMILLES (PHASES) POUR LE MENU DÉROULANT ───────────────────────
const FAMILLES_TACHES = [
  { id: "demolition", label: "Démolition" },
  { id: "plomberie_ro", label: "Réseaux plomberie (gros œuvre)" },
  { id: "menuiserie", label: "Menuiserie ext. & int." },
  { id: "feraillage", label: "Feraillage cloisons & doublages" },
  { id: "elec_vmc", label: "Réseaux élec & VMC" },
  { id: "placo", label: "Lainage / Placo / Bandes & enduits" },
  { id: "peinture_sols", label: "Peintures & sols" },
  { id: "finition_elec", label: "Finitions électricité" },
  { id: "finition_plomb", label: "Finitions plomberie" },
  { id: "cuisine", label: "Cuisine" },
  { id: "finitions_gen", label: "Finitions générales" },
];

// ─── PAGE BIBLIOTHÈQUE ────────────────────────────────────────────────────────
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

  const categoriesBase = [
    { label: "Plâtrerie", ids: ["cloison", "doublage", "plafond", "lainage", "faux_plafond", "double"] },
    { label: "Électricité", ids: ["install_elec", "tableau", "radiateur", "vmc", "prise", "mise_a_terre"] },
    { label: "Plomberie / Sanitaire", ids: ["chauffe_eau", "wc", "meuble_vasque", "receveur"] },
    { label: "Menuiserie / Gros œuvre", ids: ["porte", "escalier", "plancher"] },
    { label: "Finitions", ids: ["peinture", "parquet", "ragreage"] },
  ];

  const categories = [...categoriesBase, ...categoriesCustom];

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
    if (categories.some(c => c.label === label)) {
      setMsg({ type: "error", text: "⚠️ Une catégorie avec ce nom existe déjà" }); return;
    }
    saveCategoriesCustom([...categoriesCustom, { label, ids: [id], custom: true }]);
    setShowNewCat(false); setNewCatLabel(""); setNewCatId("");
    setMsg({ type: "ok", text: `✓ Catégorie "${label}" créée` });
    setTimeout(() => setMsg(null), 2500);
  }

  async function supprimerCategorie(catLabel) {
    if (!confirm(`Supprimer la catégorie "${catLabel}" ? Les ouvrages associés passeront en "Autre".`)) return;
    const cat = categoriesCustom.find(c => c.label === catLabel);
    if (!cat?.custom) return;
    const ouvragesAffectes = ouvrages.filter(o => cat.ids.some(k => o.identifiant && o.identifiant.startsWith(k)));
    if (ouvragesAffectes.length > 0) {
      await Promise.all(ouvragesAffectes.map(o => supabase.from("bibliotheque_ratios").update({ identifiant: `autre_${o.id}` }).eq("id", o.id)));
      setOuvrages(prev => prev.map(o => ouvragesAffectes.find(oa => oa.id === o.id) ? { ...o, identifiant: `autre_${o.id}` } : o));
    }
    saveCategoriesCustom(categoriesCustom.filter(c => c.label !== catLabel));
    if (filterCat === catLabel) setFilterCat("Toutes");
    setMsg({ type: "ok", text: "Catégorie supprimée." });
    setTimeout(() => setMsg(null), 2500);
  }

  async function changerCategorieOuvrage(ouvrageId, newCatLabel) {
    const cat = categories.find(c => c.label === newCatLabel);
    const prefix = cat ? cat.ids[0] : "autre";
    const newIdentifiant = `${prefix}_${ouvrageId}`;
    await supabase.from("bibliotheque_ratios").update({ identifiant: newIdentifiant }).eq("id", ouvrageId);
    setOuvrages(prev => prev.map(o => o.id === ouvrageId ? { ...o, identifiant: newIdentifiant } : o));
  }

  async function creerOuvrage() {
    if (!newLibelle.trim()) return;
    const newOuvrage = {
      identifiant: `${newCatPrefix}_${Date.now()}`,
      libelle: newLibelle.trim(), unite: newUnite,
      cadence: null, sous_taches: [],
    };
    const { data, error } = await supabase.from("bibliotheque_ratios").insert([newOuvrage]).select();
    if (!error && data) {
      setOuvrages(prev => [...prev, data[0]]);
      setShowNew(false); setNewLibelle(""); setNewUnite("U");
      setEditId(data[0].id);
    }
  }

  async function supprimerOuvrage(id) {
    if (!confirm("Es-tu sûr de vouloir supprimer cet ouvrage de la bibliothèque ?")) return;
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
    setMsg({ type: "ok", text: "✓ Ouvrage sauvegardé avec succès" });
    setSaving(null);
    setTimeout(() => setMsg(null), 2500);
    setEditId(null);
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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ── EN-TÊTE ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: T.text }}>📚 Bibliothèque de ratios</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Cadences et ratios de décomposition — ajustez selon votre expérience terrain</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un ouvrage…"
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, width: 200, outline: "none" }} />
            <button onClick={() => setShowNew(true)} style={{ background: T.accent, color: "#111", border: "none", borderRadius: 8, padding: "9px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nouvel ouvrage</button>
            <button onClick={() => setShowNewCat(true)} style={{ background: "transparent", color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Catégorie</button>
          </div>
        </div>

        {/* ── FILTRES ── */}
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

        {/* ── NOTIFICATIONS ── */}
        {msg && (
          <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
            background: msg.type === "ok" ? "rgba(80,200,120,0.12)" : "rgba(224,92,92,0.12)",
            color: msg.type === "ok" ? "#50c878" : "#e05c5c",
            border: `1px solid ${msg.type === "ok" ? "rgba(80,200,120,0.3)" : "rgba(224,92,92,0.3)"}` }}>
            {msg.text}
          </div>
        )}

        {/* ── FORMULAIRE NOUVELLE CATÉGORIE ── */}
        {showNewCat && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer une nouvelle catégorie</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} placeholder="Nom de la catégorie"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <input value={newCatId} onChange={e => setNewCatId(e.target.value)} placeholder="Préfixe identifiant"
                style={{ flex: 1, minWidth: 160, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <button onClick={creerCategorie} disabled={!newCatLabel.trim()} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newCatLabel.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newCatLabel.trim() ? "pointer" : "default" }}>Créer</button>
              <button onClick={() => setShowNewCat(false)} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── FORMULAIRE NOUVEL OUVRAGE ── */}
        {showNew && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer un nouvel ouvrage</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newLibelle} onChange={e => setNewLibelle(e.target.value)} placeholder="Nom de l'ouvrage"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <select value={newCatPrefix} onChange={e => setNewCatPrefix(e.target.value)}
                style={{ flex: 1, minWidth: 140, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                {categories.map(c => <option key={c.label} value={c.ids[0]}>{c.label}</option>)}
                <option value="autre">Autre</option>
              </select>
              <input value={newUnite} onChange={e => setNewUnite(e.target.value)} placeholder="Unité"
                style={{ width: 80, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
              <button onClick={creerOuvrage} disabled={!newLibelle.trim()} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newLibelle.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newLibelle.trim() ? "pointer" : "default" }}>Créer</button>
              <button onClick={() => setShowNew(false)} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── LISTE DES OUVRAGES ── */}
        {loading ? (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 60 }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 60, fontSize: 14 }}>Aucun ouvrage trouvé.</div>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingLeft: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: T.accent }}>{cat}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>({items.length})</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map(ouvrage => {
                  const isEdit = editId === ouvrage.id;
                  const editData = isEdit ? ouvrages.find(o => o.id === ouvrage.id) : ouvrage;
                  const total = (editData.sous_taches || []).reduce((s, t) => s + (parseFloat(t.ratio) || 0), 0);
                  const currentCat = getCat(ouvrage.identifiant);
                  const cadence = parseFloat(ouvrage.cadence) || null;

                  return (
                    <div key={ouvrage.id} style={{ background: T.surface, border: `1px solid ${isEdit ? T.accent : T.border}`, borderRadius: 12, overflow: "hidden", transition: "border .2s" }}>

                      {/* En-tête */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => setEditId(isEdit ? null : ouvrage.id)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ouvrage.libelle}</span>
                          <span style={{ fontSize: 11, color: T.textMuted, background: T.card, padding: "2px 8px", borderRadius: 4 }}>{ouvrage.unite}</span>
                          {cadence ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, background: `${T.accent}18`, padding: "2px 10px", borderRadius: 20, border: `1px solid ${T.accent}33` }}>
                              ⏱ {cadence}h / {ouvrage.unite}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>Pas de cadence</span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: T.textMuted }}>{(ouvrage.sous_taches || []).length} tâches</span>
                          <span style={{ fontSize: 12, color: isEdit ? T.accent : T.textMuted }}>{isEdit ? "▲" : "▼"}</span>
                        </div>
                      </div>

                      {/* Zone d'édition */}
                      {isEdit && (
                        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.sectionDivider}` }}>

                          {/* ── Propriétés de l'ouvrage ── */}
                          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", marginTop: 14, marginBottom: 14, padding: "14px 16px", background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>

                            <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 2, minWidth: 160 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Nom</label>
                              <input value={editData.libelle}
                                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, libelle: e.target.value }))}
                                onClick={e => e.stopPropagation()}
                                style={{ padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 5, width: 80 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Unité</label>
                              <input value={editData.unite}
                                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, unite: e.target.value }))}
                                onClick={e => e.stopPropagation()}
                                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", textAlign: "center" }} />
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 140 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Catégorie</label>
                              <select value={currentCat}
                                onChange={e => { e.stopPropagation(); changerCategorieOuvrage(ouvrage.id, e.target.value); }}
                                onClick={e => e.stopPropagation()}
                                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none", cursor: "pointer" }}>
                                {categories.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                                <option value="Autre">Autre</option>
                              </select>
                            </div>

                            {/* ── CADENCE ── */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Cadence estimée</label>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input type="number" min="0.01" step="0.05" value={editData.cadence ?? ""}
                                  onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, cadence: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                                  onClick={e => e.stopPropagation()}
                                  placeholder="ex: 0.5"
                                  style={{ width: 80, padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 15, fontWeight: 800, outline: "none", textAlign: "center" }} />
                                <span style={{ fontSize: 12, color: T.textMuted, whiteSpace: "nowrap" }}>h / {editData.unite || "unité"}</span>
                              </div>
                            </div>
                          </div>

                          {/* ── Aperçu cadence par sous-tâche ── */}
                          {editData.cadence > 0 && (editData.sous_taches || []).length > 0 && (
                            <div style={{ marginBottom: 14, padding: "10px 14px", background: `${T.accent}0D`, borderRadius: 8, border: `1px solid ${T.accent}22` }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>⏱ Cadence calculée par sous-tâche</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {(editData.sous_taches || []).filter(st => st.nom).map((st, i) => {
                                  const heuresParUnite = parseFloat(((editData.cadence * st.ratio) / 100).toFixed(3));
                                  const labelFamille = FAMILLES_TACHES.find(f => f.id === st.phaseId)?.label || "Auto";
                                  return (
                                    <div key={i} style={{ fontSize: 11, color: T.textMuted, background: T.card, padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ color: T.text, fontWeight: 600 }}>{st.nom}</span>
                                      <span style={{ color: T.textMuted }}>({st.ratio}%)</span>
                                      <span style={{ color: T.accent, fontWeight: 700 }}>→ {heuresParUnite}h/{editData.unite}</span>
                                      <span style={{ color: T.textMuted, fontStyle: "italic", marginLeft: 4, paddingLeft: 6, borderLeft: `1px solid ${T.border}` }}>[{labelFamille}]</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* ── Sous-tâches ── */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {(editData.sous_taches || []).map((tache, idx) => {
                              const cadenceST = editData.cadence > 0 ? parseFloat(((editData.cadence * tache.ratio) / 100).toFixed(3)) : null;
                              return (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                  <input value={tache.nom}
                                    onChange={e => {
                                      const st = [...(editData.sous_taches || [])];
                                      st[idx] = { ...st[idx], nom: e.target.value };
                                      setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: st }));
                                    }}
                                    placeholder="Nom de la sous-tâche"
                                    style={{ flex: 1, minWidth: 150, padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none" }} />
                                  
                                  {/* MENU DÉROULANT POUR LA FAMILLE */}
                                  <select 
                                    value={tache.phaseId || ""}
                                    onChange={e => {
                                      const st = [...(editData.sous_taches || [])];
                                      st[idx] = { ...st[idx], phaseId: e.target.value };
                                      setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: st }));
                                    }}
                                    style={{ width: 140, padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none", cursor: "pointer" }}
                                  >
                                    <option value="">Famille auto…</option>
                                    {FAMILLES_TACHES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                  </select>

                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input type="number" min="0" max="100" step="1" value={tache.ratio}
                                      onChange={e => {
                                        const st = [...(editData.sous_taches || [])];
                                        st[idx] = { ...st[idx], ratio: parseFloat(e.target.value) || 0 };
                                        setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: st }));
                                      }}
                                      style={{ width: 60, padding: "6px 8px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                                    <span style={{ fontSize: 13, color: T.textMuted }}>%</span>
                                  </div>
                                  {/* Cadence calculée inline */}
                                  {cadenceST !== null && (
                                    <span style={{ fontSize: 11, color: T.accent, fontWeight: 700, minWidth: 72, textAlign: "right", background: `${T.accent}12`, padding: "3px 8px", borderRadius: 5 }}>
                                      {cadenceST}h/{editData.unite}
                                    </span>
                                  )}
                                  <div style={{ width: 50, height: 6, background: T.border, borderRadius: 3, display: ["none", "none", "block"] }}>
                                    <div style={{ height: "100%", borderRadius: 3, background: T.accent, width: `${Math.min(tache.ratio, 100)}%`, transition: "width .2s" }} />
                                  </div>
                                  <button onClick={() => {
                                    const st = [...(editData.sous_taches || [])].filter((_, i) => i !== idx);
                                    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: st }));
                                  }} style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", padding: "0 6px", fontSize: 14 }}>✕</button>
                                </div>
                              );
                            })}
                            <button onClick={() => {
                              const st = [...(editData.sous_taches || []), { nom: "", ratio: 0, phaseId: "" }];
                              setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: st }));
                            }} style={{ padding: "10px", border: `1.5px dashed ${T.border}`, borderRadius: 8, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                              + Ajouter une sous-tâche
                            </button>
                          </div>

                          {/* Footer */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.sectionDivider}` }}>
                            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                              <button onClick={() => supprimerOuvrage(ouvrage.id)} style={{ background: "transparent", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 8, padding: "8px 16px", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>🗑️ Supprimer l'ouvrage</button>
                              <div style={{ fontSize: 13, fontWeight: 700, color: (total === 100 || editData.sous_taches?.length === 0) ? "#50c878" : "#e05c5c" }}>
                                Total : {total.toFixed(0)}% {(total === 100 || editData.sous_taches?.length === 0) ? "✓" : "⚠️ doit être 100%"}
                              </div>
                            </div>
                            <button onClick={() => saveOuvrage(editData)} disabled={saving === ouvrage.id}
                              style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                              {saving === ouvrage.id ? "Sauvegarde…" : "✓ Sauvegarder"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default PageBibliotheque;
