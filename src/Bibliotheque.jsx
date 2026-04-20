import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { BIBLIOTHEQUE_INITIALE } from "./constants";

// ─── PAGE BIBLIOTHÈQUE ────────────────────────────────────────────────────────
function PageBibliotheque({ T }) {
  const [ouvrages, setOuvrages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [filterCat, setFilterCat] = useState("Toutes");

  // États pour la création d'un nouvel ouvrage
  const [showNew, setShowNew] = useState(false);
  const [newLibelle, setNewLibelle] = useState("");
  const [newUnite, setNewUnite] = useState("U");
  const [newCatPrefix, setNewCatPrefix] = useState("autre");

  // États pour la gestion des catégories personnalisées
  const [categoriesCustom, setCategoriesCustom] = useState([]);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatId, setNewCatId] = useState("");

  // Catégories de base (non supprimables)
  const categoriesBase = [
    { label: "Plâtrerie", ids: ["cloison", "doublage", "plafond", "lainage", "faux_plafond", "double"] },
    { label: "Électricité", ids: ["install_elec", "tableau", "radiateur", "vmc", "prise", "mise_a_terre"] },
    { label: "Plomberie / Sanitaire", ids: ["chauffe_eau", "wc", "meuble_vasque", "receveur"] },
    { label: "Menuiserie / Gros œuvre", ids: ["porte", "escalier", "plancher"] },
    { label: "Finitions", ids: ["peinture", "parquet", "ragreage"] },
  ];

  // Toutes les catégories (base + custom)
  const categories = [...categoriesBase, ...categoriesCustom];

  useEffect(() => { loadOuvrages(); loadCategoriesCustom(); }, []);

  // ─── CHARGEMENT ───
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

  // Chargement des catégories custom depuis localStorage (ou Supabase si dispo)
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

  // ─── GESTION DES CATÉGORIES ───
  function creerCategorie() {
    const label = newCatLabel.trim();
    const id = newCatId.trim() || label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!label || !id) return;
    if (categories.some(c => c.label === label)) {
      setMsg({ type: "error", text: "⚠️ Une catégorie avec ce nom existe déjà" });
      return;
    }
    const updated = [...categoriesCustom, { label, ids: [id], custom: true }];
    saveCategoriesCustom(updated);
    setShowNewCat(false);
    setNewCatLabel("");
    setNewCatId("");
    setMsg({ type: "ok", text: `✓ Catégorie "${label}" créée` });
    setTimeout(() => setMsg(null), 2500);
  }

  function supprimerCategorie(catLabel) {
    const cat = categories.find(c => c.label === catLabel);
    if (!cat?.custom) return;
    // Déplace les ouvrages de cette catégorie vers "Autre"
    const updated = categoriesCustom.filter(c => c.label !== catLabel);
    saveCategoriesCustom(updated);
    if (filterCat === catLabel) setFilterCat("Toutes");
    setMsg({ type: "ok", text: `Catégorie supprimée. Les ouvrages associés passent en "Autre".` });
    setTimeout(() => setMsg(null), 3000);
  }

  // ─── GESTION DES OUVRAGES ───
  async function creerOuvrage() {
    if (!newLibelle.trim()) return;
    const identifiant = `${newCatPrefix}_${Date.now()}`;
    const newOuvrage = { identifiant, libelle: newLibelle.trim(), unite: newUnite, sous_taches: [] };
    const { data, error } = await supabase.from("bibliotheque_ratios").insert([newOuvrage]).select();
    if (!error && data) {
      setOuvrages(prev => [...prev, data[0]]);
      setShowNew(false);
      setNewLibelle("");
      setNewUnite("U");
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
      libelle: ouvrage.libelle,
      sous_taches: ouvrage.sous_taches,
      updated_at: new Date().toISOString(),
    }).eq("id", ouvrage.id);
    setMsg({ type: "ok", text: "✓ Ouvrage sauvegardé avec succès" });
    setSaving(null);
    setTimeout(() => setMsg(null), 2500);
    setEditId(null);
  }

  // ─── UTILITAIRES ───
  function getCat(identifiant) {
    for (const cat of categories) {
      if (cat.ids.some(k => identifiant && identifiant.startsWith(k))) return cat.label;
    }
    return "Autre";
  }

  // ─── FILTRAGE & GROUPAGE ───
  const allCatLabels = [...categories.map(c => c.label), "Autre"];
  const uniqueCats = ["Toutes", ...allCatLabels];

  const filtered = ouvrages.filter(o => {
    const matchSearch = !search || o.libelle?.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "Toutes" || getCat(o.identifiant) === filterCat;
    return matchSearch && matchCat;
  });

  const grouped = {};
  filtered.forEach(o => {
    const cat = getCat(o.identifiant);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(o);
  });

  // Catégories qui ont des ouvrages (pour afficher le compteur)
  const catCounts = {};
  ouvrages.forEach(o => {
    const cat = getCat(o.identifiant);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: T.bg }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ── EN-TÊTE ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: T.text }}>📚 Bibliothèque de ratios</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ratios de décomposition — ajustez selon votre expérience terrain</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un ouvrage…"
              style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, width: 200, outline: "none" }}
            />
            <button onClick={() => setShowNew(true)}
              style={{ background: T.accent, color: "#111", border: "none", borderRadius: 8, padding: "9px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              + Nouvel ouvrage
            </button>
            <button onClick={() => setShowNewCat(true)}
              style={{ background: "transparent", color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Catégorie
            </button>
          </div>
        </div>

        {/* ── FILTRES PAR CATÉGORIE ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {uniqueCats.map(cat => {
            const count = cat === "Toutes" ? ouvrages.length : (catCounts[cat] || 0);
            const isActive = filterCat === cat;
            const isCustom = categoriesCustom.some(c => c.label === cat);
            return (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <button
                  onClick={() => setFilterCat(cat)}
                  style={{
                    padding: "6px 14px", borderRadius: isCustom ? "8px 0 0 8px" : 8,
                    border: `1px solid ${isActive ? T.accent : T.border}`,
                    borderRight: isCustom ? "none" : undefined,
                    background: isActive ? `${T.accent}22` : "transparent",
                    color: isActive ? T.accent : T.textMuted,
                    fontFamily: "inherit", fontSize: 12, fontWeight: isActive ? 700 : 500,
                    cursor: "pointer", transition: "all .15s",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                  {cat}
                  {count > 0 && (
                    <span style={{
                      background: isActive ? T.accent : T.border, color: isActive ? "#111" : T.textMuted,
                      borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                    }}>{count}</span>
                  )}
                </button>
                {isCustom && (
                  <button
                    onClick={() => supprimerCategorie(cat)}
                    title={`Supprimer la catégorie "${cat}"`}
                    style={{
                      padding: "6px 8px", borderRadius: "0 8px 8px 0",
                      border: `1px solid ${T.border}`, borderLeft: "none",
                      background: "transparent", color: "#e05c5c",
                      cursor: "pointer", fontSize: 11, lineHeight: 1,
                    }}>✕</button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── NOTIFICATIONS ── */}
        {msg && (
          <div style={{
            padding: "10px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
            background: msg.type === "ok" ? "rgba(80,200,120,0.12)" : "rgba(224,92,92,0.12)",
            color: msg.type === "ok" ? "#50c878" : "#e05c5c",
            border: `1px solid ${msg.type === "ok" ? "rgba(80,200,120,0.3)" : "rgba(224,92,92,0.3)"}`,
          }}>
            {msg.text}
          </div>
        )}

        {/* ── FORMULAIRE NOUVELLE CATÉGORIE ── */}
        {showNewCat && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer une nouvelle catégorie</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                placeholder="Nom de la catégorie (ex: Isolation)"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}
              />
              <input
                value={newCatId} onChange={e => setNewCatId(e.target.value)}
                placeholder="Préfixe identifiant (ex: isolat)"
                style={{ flex: 1, minWidth: 160, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}
              />
              <button onClick={creerCategorie} disabled={!newCatLabel.trim()}
                style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newCatLabel.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newCatLabel.trim() ? "pointer" : "default" }}>
                Créer
              </button>
              <button onClick={() => setShowNewCat(false)}
                style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                Annuler
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>
              Le préfixe identifiant sera utilisé pour associer automatiquement les ouvrages créés avec ce préfixe à cette catégorie.
            </div>
          </div>
        )}

        {/* ── FORMULAIRE NOUVEL OUVRAGE ── */}
        {showNew && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Créer un nouvel ouvrage</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={newLibelle} onChange={e => setNewLibelle(e.target.value)}
                placeholder="Nom de l'ouvrage (ex: Peinture plafond)"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}
              />
              <select
                value={newCatPrefix} onChange={e => setNewCatPrefix(e.target.value)}
                style={{ flex: 1, minWidth: 140, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                {categories.map(c => <option key={c.label} value={c.ids[0]}>{c.label}</option>)}
                <option value="autre">Autre</option>
              </select>
              <input
                value={newUnite} onChange={e => setNewUnite(e.target.value)}
                placeholder="Unité (m², U...)"
                style={{ width: 80, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }}
              />
              <button onClick={creerOuvrage} disabled={!newLibelle.trim()}
                style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newLibelle.trim() ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newLibelle.trim() ? "pointer" : "default" }}>
                Créer
              </button>
              <button onClick={() => setShowNew(false)}
                style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* ── LISTE DES OUVRAGES ── */}
        {loading ? (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 60 }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 60, fontSize: 14 }}>
            Aucun ouvrage trouvé{search ? ` pour "${search}"` : ""}{filterCat !== "Toutes" ? ` dans "${filterCat}"` : ""}.
          </div>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingLeft: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: T.accent }}>
                  {cat}
                </div>
                <div style={{ fontSize: 11, color: T.textMuted }}>({items.length})</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map(ouvrage => {
                  const isEdit = editId === ouvrage.id;
                  const editData = isEdit ? ouvrages.find(o => o.id === ouvrage.id) : ouvrage;
                  const total = (editData.sous_taches || []).reduce((s, t) => s + (parseFloat(t.ratio) || 0), 0);

                  return (
                    <div key={ouvrage.id} style={{
                      background: T.surface, border: `1px solid ${isEdit ? T.accent : T.border}`,
                      borderRadius: 12, overflow: "hidden", transition: "border .2s",
                    }}>

                      {/* ── En-tête de l'ouvrage ── */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => setEditId(isEdit ? null : ouvrage.id)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ouvrage.libelle}</span>
                          <span style={{ fontSize: 11, color: T.textMuted, background: T.card, padding: "2px 8px", borderRadius: 4 }}>{ouvrage.unite}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: T.textMuted }}>{(ouvrage.sous_taches || []).length} tâches</span>
                          <span style={{ fontSize: 12, color: isEdit ? T.accent : T.textMuted }}>{isEdit ? "▲" : "▼"}</span>
                        </div>
                      </div>

                      {/* ── Zone d'édition ── */}
                      {isEdit && (
                        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.sectionDivider}` }}>

                          {/* Édition du nom et de l'unité */}
                          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, marginBottom: 14, padding: "12px 14px", background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>Nom</div>
                            <input
                              value={editData.libelle}
                              onChange={e => {
                                const updated = ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, libelle: e.target.value });
                                setOuvrages(updated);
                              }}
                              onClick={e => e.stopPropagation()}
                              placeholder="Nom de l'ouvrage"
                              style={{ flex: 1, padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }}
                            />
                            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>Unité</div>
                            <input
                              value={editData.unite}
                              onChange={e => {
                                const updated = ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, unite: e.target.value });
                                setOuvrages(updated);
                              }}
                              onClick={e => e.stopPropagation()}
                              placeholder="m², U..."
                              style={{ width: 70, padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", textAlign: "center" }}
                            />
                          </div>

                          {/* Sous-tâches */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {(editData.sous_taches || []).map((tache, idx) => (
                              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <input
                                  value={tache.nom}
                                  onChange={e => {
                                    const updated = ouvrages.map(o => {
                                      if (o.id !== ouvrage.id) return o;
                                      const st = [...(o.sous_taches || [])];
                                      st[idx] = { ...st[idx], nom: e.target.value };
                                      return { ...o, sous_taches: st };
                                    });
                                    setOuvrages(updated);
                                  }}
                                  placeholder="Nom de la sous-tâche"
                                  style={{ flex: 1, padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none" }}
                                />
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <input
                                    type="number" min="0" max="100" step="1" value={tache.ratio}
                                    onChange={e => {
                                      const updated = ouvrages.map(o => {
                                        if (o.id !== ouvrage.id) return o;
                                        const st = [...o.sous_taches];
                                        st[idx] = { ...st[idx], ratio: parseFloat(e.target.value) || 0 };
                                        return { ...o, sous_taches: st };
                                      });
                                      setOuvrages(updated);
                                    }}
                                    style={{ width: 60, padding: "6px 8px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }}
                                  />
                                  <span style={{ fontSize: 13, color: T.textMuted }}>%</span>
                                </div>
                                <div style={{ width: 80, height: 6, background: T.border, borderRadius: 3 }}>
                                  <div style={{ height: "100%", borderRadius: 3, background: T.accent, width: `${Math.min(tache.ratio, 100)}%`, transition: "width .2s" }} />
                                </div>
                                <button
                                  onClick={() => {
                                    const updated = ouvrages.map(o => {
                                      if (o.id !== ouvrage.id) return o;
                                      const st = [...(o.sous_taches || [])].filter((_, i) => i !== idx);
                                      return { ...o, sous_taches: st };
                                    });
                                    setOuvrages(updated);
                                  }}
                                  style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", padding: "0 6px", fontSize: 14 }}
                                  title="Supprimer cette tâche">✕</button>
                              </div>
                            ))}

                            <button
                              onClick={() => {
                                const updated = ouvrages.map(o => {
                                  if (o.id !== ouvrage.id) return o;
                                  const st = [...(o.sous_taches || []), { nom: "", ratio: 0 }];
                                  return { ...o, sous_taches: st };
                                });
                                setOuvrages(updated);
                              }}
                              style={{ padding: "10px", border: `1.5px dashed ${T.border}`, borderRadius: 8, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                              + Ajouter une sous-tâche
                            </button>
                          </div>

                          {/* Footer édition */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.sectionDivider}` }}>
                            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                              <button
                                onClick={() => supprimerOuvrage(ouvrage.id)}
                                style={{ background: "transparent", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 8, padding: "8px 16px", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
                                🗑️ Supprimer l'ouvrage
                              </button>
                              <div style={{ fontSize: 13, fontWeight: 700, color: (total === 100 || editData.sous_taches?.length === 0) ? "#50c878" : "#e05c5c" }}>
                                Total : {total.toFixed(0)}% {(total === 100 || editData.sous_taches?.length === 0) ? "✓" : "⚠️ doit être 100%"}
                              </div>
                            </div>
                            <button
                              onClick={() => saveOuvrage(editData)} disabled={saving === ouvrage.id}
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
