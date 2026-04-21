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
            background: msg.type === "ok" ? "rgba(80,200,120,0.12)" : "rgba(
