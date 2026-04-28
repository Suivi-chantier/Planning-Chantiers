import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ─── CATÉGORIES PRÉDÉFINIES ───────────────────────────────────────────────────
const CATEGORIES = [
  "Plâtrerie / Cloison",
  "Électricité",
  "Plomberie",
  "Peinture",
  "Revêtement sol",
  "Menuiserie",
  "Isolation",
  "Outillage",
  "Quincaillerie",
  "Consommables",
  "Autre",
];

const UNITES = ["U", "m²", "ml", "kg", "L", "boîte", "rouleau", "sac", "palette"];

// ─── ARTICLE VIDE ─────────────────────────────────────────────────────────────
const emptyArticle = () => ({
  id: null,
  nom: "",
  reference: "",
  fournisseur: "",
  categorie: "",
  prix_unitaire: "",
  unite: "U",
  stock_min: "",
  lien_fournisseur: "",
  photo_url: "",
  notes: "",
});

// ─── COMPOSANT MODALE ─────────────────────────────────────────────────────────
function ArticleModal({ article, onClose, onSave, T }) {
  const [draft, setDraft] = useState(article || emptyArticle());
  const [saving, setSaving] = useState(false);

  const set = (field, val) => setDraft(p => ({ ...p, [field]: val }));

  const handleSave = async () => {
    if (!draft.nom?.trim()) return;
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };

  const inp = (highlight = false) => ({
    background: "rgba(255,255,255,0.06)",
    border: `1px solid ${highlight ? "rgba(255,194,0,0.5)" : "rgba(255,255,255,0.1)"}`,
    borderRadius: 8,
    padding: "9px 12px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color .15s",
  });

  const sel = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "9px 12px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)", zIndex: 900,
      }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: "min(600px, 96vw)", maxHeight: "90vh",
        background: T.surface, borderRadius: 18,
        border: `1px solid rgba(255,255,255,0.1)`,
        boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        zIndex: 901, display: "flex", flexDirection: "column",
        overflow: "hidden",
        animation: "fadeIn .2s ease",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,194,0,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "rgba(255,194,0,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20,
            }}>📦</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>
                {draft.id ? "Modifier l'article" : "Nouvel article"}
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                Bibliothèque matériaux
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, width: 34, height: 34,
            cursor: "pointer", color: T.textSub, fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>×</button>
        </div>

        {/* Corps scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Nom + Référence */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Désignation *
                </label>
                <input
                  value={draft.nom}
                  onChange={e => set("nom", e.target.value)}
                  placeholder="ex: Plaque BA13 standard"
                  autoFocus
                  style={inp(!draft.nom?.trim())}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Référence
                </label>
                <input
                  value={draft.reference}
                  onChange={e => set("reference", e.target.value)}
                  placeholder="ex: REF-001"
                  style={inp()}
                />
              </div>
            </div>

            {/* Catégorie + Fournisseur */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Catégorie
                </label>
                <select
                  value={draft.categorie}
                  onChange={e => set("categorie", e.target.value)}
                  style={sel}
                >
                  <option value="">— Choisir —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Fournisseur
                </label>
                <input
                  value={draft.fournisseur}
                  onChange={e => set("fournisseur", e.target.value)}
                  placeholder="ex: Point P, Leroy Merlin…"
                  style={inp()}
                />
              </div>
            </div>

            {/* Prix + Unité + Stock min */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Prix unitaire (€ HT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.prix_unitaire}
                  onChange={e => set("prix_unitaire", e.target.value)}
                  placeholder="0.00"
                  style={{ ...inp(), color: "#50c878" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Unité
                </label>
                <select value={draft.unite} onChange={e => set("unite", e.target.value)} style={sel}>
                  {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                  Stock minimum
                </label>
                <input
                  type="number"
                  min="0"
                  value={draft.stock_min}
                  onChange={e => set("stock_min", e.target.value)}
                  placeholder="0"
                  style={inp()}
                />
              </div>
            </div>

            {/* Lien fournisseur */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Lien fournisseur (URL)
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.lien_fournisseur}
                  onChange={e => set("lien_fournisseur", e.target.value)}
                  placeholder="https://…"
                  style={{ ...inp(), flex: 1 }}
                />
                {draft.lien_fournisseur && (
                  <a
                    href={draft.lien_fournisseur}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "rgba(255,194,0,0.15)",
                      border: "1px solid rgba(255,194,0,0.3)",
                      borderRadius: 8,
                      padding: "9px 14px",
                      color: "#FFC200",
                      textDecoration: "none",
                      fontSize: 14,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    🔗 Ouvrir
                  </a>
                )}
              </div>
            </div>

            {/* URL Photo */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Photo (URL image)
              </label>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input
                  value={draft.photo_url}
                  onChange={e => set("photo_url", e.target.value)}
                  placeholder="https://… (lien image directe)"
                  style={{ ...inp(), flex: 1 }}
                />
                {draft.photo_url && (
                  <img
                    src={draft.photo_url}
                    alt="preview"
                    onError={e => e.target.style.display = "none"}
                    style={{
                      width: 60, height: 60, borderRadius: 8,
                      objectFit: "cover",
                      border: "1px solid rgba(255,255,255,0.1)",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Notes / Détails
              </label>
              <textarea
                value={draft.notes}
                onChange={e => set("notes", e.target.value)}
                placeholder="Informations complémentaires, variantes, conditionnement…"
                rows={3}
                style={{ ...inp(), resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 24px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", gap: 10, justifyContent: "flex-end",
          background: T.surface, flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            padding: "9px 18px", borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "transparent", color: T.textSub,
            fontFamily: "inherit", fontSize: 13, cursor: "pointer",
          }}>Annuler</button>
          <button
            onClick={handleSave}
            disabled={!draft.nom?.trim() || saving}
            style={{
              padding: "9px 24px", borderRadius: 8, border: "none",
              background: draft.nom?.trim() ? "#FFC200" : "rgba(255,194,0,0.2)",
              color: draft.nom?.trim() ? "#111" : T.textMuted,
              fontFamily: "inherit", fontSize: 13, fontWeight: 800,
              cursor: draft.nom?.trim() ? "pointer" : "not-allowed",
              transition: "all .15s",
            }}
          >
            {saving ? "Enregistrement…" : draft.id ? "✓ Modifier" : "✓ Ajouter"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
function PageBibliothequeMateriaux({ T }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [modale, setModale] = useState(null); // null | "new" | article{}
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("materiaux_bibliotheque")
      .select("*")
      .order("categorie")
      .order("nom");
    if (!error) setArticles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtrage
  const filtered = articles.filter(a => {
    const matchCat = filterCat === "all" || a.categorie === filterCat;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      a.nom?.toLowerCase().includes(q) ||
      a.reference?.toLowerCase().includes(q) ||
      a.fournisseur?.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  // Catégories présentes
  const catsPresentes = [...new Set(articles.map(a => a.categorie).filter(Boolean))].sort();

  // CRUD
  const saveArticle = async (draft) => {
    const payload = {
      nom: draft.nom?.trim(),
      reference: draft.reference?.trim() || null,
      fournisseur: draft.fournisseur?.trim() || null,
      categorie: draft.categorie || null,
      prix_unitaire: draft.prix_unitaire ? parseFloat(draft.prix_unitaire) : null,
      unite: draft.unite || "U",
      stock_min: draft.stock_min ? parseInt(draft.stock_min) : null,
      lien_fournisseur: draft.lien_fournisseur?.trim() || null,
      photo_url: draft.photo_url?.trim() || null,
      notes: draft.notes?.trim() || null,
    };

    if (draft.id) {
      await supabase.from("materiaux_bibliotheque").update(payload).eq("id", draft.id);
    } else {
      await supabase.from("materiaux_bibliotheque").insert(payload);
    }
    setModale(null);
    load();
  };

  const deleteArticle = async (id) => {
    await supabase.from("materiaux_bibliotheque").delete().eq("id", id);
    setConfirmDelete(null);
    load();
  };

  // Stats
  const totalArticles = articles.length;
  const withPrice = articles.filter(a => a.prix_unitaire).length;
  const withLink = articles.filter(a => a.lien_fournisseur).length;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

      {/* Modale article */}
      {modale && (
        <ArticleModal
          article={modale === "new" ? null : modale}
          onClose={() => setModale(null)}
          onSave={saveArticle}
          T={T}
        />
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <>
          <div onClick={() => setConfirmDelete(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)", zIndex: 900,
          }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            background: T.surface, borderRadius: 16,
            border: "1px solid rgba(224,92,92,0.4)",
            padding: "24px 28px", zIndex: 901, maxWidth: 400, width: "90vw",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              Supprimer cet article ?
            </div>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20 }}>
              « {confirmDelete.nom} » sera supprimé définitivement.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmDelete(null)} style={{
                padding: "8px 20px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent", color: T.textSub,
                fontFamily: "inherit", fontSize: 13, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={() => deleteArticle(confirmDelete.id)} style={{
                padding: "8px 20px", borderRadius: 8, border: "none",
                background: "#e05c5c", color: "#fff",
                fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
              }}>Supprimer</button>
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <div style={{
        marginBottom: 24, display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", flexWrap: "wrap", gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>
            Bibliothèque matériaux
          </div>
          <div style={{ fontSize: 14, color: T.textSub }}>
            Catalogue des articles, consommables et matériaux récurrents
          </div>
        </div>
        <button
          onClick={() => setModale("new")}
          style={{
            background: T.accent, color: "#111", border: "none",
            borderRadius: 10, padding: "11px 22px",
            fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          + Nouvel article
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Articles", val: totalArticles, color: "#FFC200", bg: "rgba(255,194,0,0.12)", border: "rgba(255,194,0,0.3)" },
          { label: "Avec prix", val: withPrice, color: "#50c878", bg: "rgba(80,200,120,0.12)", border: "rgba(80,200,120,0.3)" },
          { label: "Avec lien", val: withLink, color: "#5b9cf6", bg: "rgba(91,156,246,0.12)", border: "rgba(91,156,246,0.3)" },
          { label: "Catégories", val: catsPresentes.length, color: "#b060ff", bg: "rgba(176,96,255,0.12)", border: "rgba(176,96,255,0.3)" },
        ].map(k => (
          <div key={k.label} style={{
            background: k.bg, border: `1px solid ${k.border}`,
            borderRadius: 10, padding: "10px 18px",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 12, color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Recherche + filtre catégorie */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Rechercher un article, référence, fournisseur…"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "8px 14px",
            color: T.text, fontFamily: "inherit", fontSize: 13,
            outline: "none", flex: "1 1 220px", minWidth: 200,
          }}
        />
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          style={{
            background: "#1e2336", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "8px 12px",
            color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, outline: "none",
          }}
        >
          <option value="all">Toutes catégories</option>
          {catsPresentes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{
        background: T.surface, borderRadius: 14,
        border: `1px solid ${T.border}`, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: T.card, borderBottom: `2px solid ${T.border}` }}>
              {["Photo", "Désignation / Réf.", "Catégorie", "Fournisseur", "Prix unitaire", "Stock min", "Lien", ""].map(h => (
                <th key={h} style={{
                  padding: "12px 10px", fontSize: 11, fontWeight: 700,
                  letterSpacing: 1.5, textTransform: "uppercase",
                  color: T.textMuted, textAlign: "left",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: T.textMuted }}>
                Chargement…
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: T.textMuted }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                {articles.length === 0
                  ? "Aucun article — cliquez sur « + Nouvel article » pour commencer."
                  : "Aucun résultat pour cette recherche."}
              </td></tr>
            ) : filtered.map(a => (
              <tr
                key={a.id}
                style={{
                  borderBottom: `1px solid ${T.sectionDivider}`,
                  transition: "background .1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.card}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                {/* Photo */}
                <td style={{ padding: "10px 10px", width: 60 }}>
                  {a.photo_url ? (
                    <img
                      src={a.photo_url}
                      alt={a.nom}
                      onError={e => { e.target.style.display = "none"; }}
                      style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", border: `1px solid ${T.border}` }}
                    />
                  ) : (
                    <div style={{
                      width: 44, height: 44, borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 20, color: T.textMuted,
                    }}>📦</div>
                  )}
                </td>

                {/* Désignation + réf */}
                <td style={{ padding: "10px 10px", maxWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{a.nom}</div>
                  {a.reference && (
                    <div style={{
                      fontSize: 11, color: T.textMuted, marginTop: 3,
                      fontFamily: "monospace",
                    }}>
                      {a.reference}
                    </div>
                  )}
                  {a.notes && (
                    <div style={{
                      fontSize: 11, color: T.textMuted, marginTop: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      maxWidth: 200,
                    }}>{a.notes}</div>
                  )}
                </td>

                {/* Catégorie */}
                <td style={{ padding: "10px 10px" }}>
                  {a.categorie && (
                    <span style={{
                      background: "rgba(255,194,0,0.12)", color: "#FFC200",
                      border: "1px solid rgba(255,194,0,0.3)",
                      borderRadius: 6, padding: "3px 8px",
                      fontSize: 11, fontWeight: 700,
                    }}>{a.categorie}</span>
                  )}
                </td>

                {/* Fournisseur */}
                <td style={{ padding: "10px 10px", fontSize: 13, color: T.textSub }}>
                  {a.fournisseur || <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>}
                </td>

                {/* Prix */}
                <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                  {a.prix_unitaire != null ? (
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#50c878" }}>
                      {parseFloat(a.prix_unitaire).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                      <span style={{ fontSize: 11, fontWeight: 400, color: T.textMuted, marginLeft: 4 }}>
                        HT / {a.unite || "U"}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: T.emptyColor, fontSize: 12 }}>À renseigner</span>
                  )}
                </td>

                {/* Stock min */}
                <td style={{ padding: "10px 10px", fontSize: 13, color: T.textSub }}>
                  {a.stock_min != null ? `${a.stock_min} ${a.unite || "U"}` : <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>}
                </td>

                {/* Lien */}
                <td style={{ padding: "10px 10px" }}>
                  {a.lien_fournisseur ? (
                    <a
                      href={a.lien_fournisseur}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "rgba(91,156,246,0.12)",
                        border: "1px solid rgba(91,156,246,0.3)",
                        borderRadius: 6, padding: "4px 10px",
                        color: "#5b9cf6", fontSize: 12, fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      🔗 Voir
                    </a>
                  ) : (
                    <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>
                  )}
                </td>

                {/* Actions */}
                <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => setModale(a)}
                    style={{
                      background: "transparent", border: "none",
                      cursor: "pointer", fontSize: 15, opacity: .6, marginRight: 4, color: T.text,
                    }}
                    title="Modifier"
                  >✏️</button>
                  <button
                    onClick={() => setConfirmDelete(a)}
                    style={{
                      background: "transparent", border: "none",
                      cursor: "pointer", fontSize: 15, opacity: .5, color: "#e05c5c",
                    }}
                    title="Supprimer"
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SQL à exécuter */}
      {articles.length === 0 && !loading && (
        <div style={{
          marginTop: 24, background: "rgba(176,96,255,0.08)",
          border: "1px solid rgba(176,96,255,0.25)",
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#b060ff", marginBottom: 10 }}>
            ⚙️ Table Supabase à créer si elle n'existe pas :
          </div>
          <pre style={{
            fontSize: 12, color: T.textSub, background: "rgba(0,0,0,0.3)",
            borderRadius: 8, padding: 14, overflowX: "auto", lineHeight: 1.6,
          }}>{`CREATE TABLE materiaux_bibliotheque (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nom text NOT NULL,
  reference text,
  fournisseur text,
  categorie text,
  prix_unitaire numeric,
  unite text DEFAULT 'U',
  stock_min integer,
  lien_fournisseur text,
  photo_url text,
  notes text,
  created_at timestamp DEFAULT now()
);`}</pre>
        </div>
      )}

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translate(-50%,-48%)}to{opacity:1;transform:translate(-50%,-50%)}}`}</style>
    </div>
  );
}

export default PageBibliothequeMateriaux;
