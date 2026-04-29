import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

const STYLE_INJECTED = { current: false };
function injectStyles() {
  if (STYLE_INJECTED.current) return;
  STYLE_INJECTED.current = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes drawerUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes popIn {
      0%   { transform: scale(0.85); opacity: 0; }
      60%  { transform: scale(1.04); }
      100% { transform: scale(1);    opacity: 1; }
    }
    .bcd-article-card:active { transform: scale(0.97); }
    .bcd-article-card { transition: transform .1s, box-shadow .15s; }
    .bcd-qty-btn:active { transform: scale(0.9); }
    .bcd-qty-btn { transition: transform .1s; }
    @media (min-width: 768px) {
      .bcd-drawer { max-width: 680px !important; left: 50% !important; right: auto !important; height: 85vh !important; bottom: 50% !important; transform: translate(-50%, 50%) !important; border-radius: 20px !important; }
      .bcd-grid { grid-template-columns: repeat(3, 1fr) !important; }
      .bcd-article-card img { max-height: 110px !important; object-fit: contain !important; }
      .bcd-img-placeholder { max-height: 110px !important; }
    }
  `;
  document.head.appendChild(style);
}

export default function BesoinCommandeDrawer({
  chantierNom,
  chantierCouleur,
  panier,
  onPanierChange,
  onClose,
}) {
  injectStyles();

  const [bibliotheque, setBibliotheque] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [catActive, setCatActive]       = useState("Tous");
  const searchRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("materiaux_bibliotheque")
        .select("*")
        .order("nom");
      if (error) console.error("Erreur chargement bibliothèque:", error);
      setBibliotheque(data || []);
      setLoading(false);
    })();
  }, []);

  const categories = ["Tous", ...Array.from(new Set((bibliotheque || []).map(a => a.categorie).filter(Boolean))).sort()];

  const filtered = bibliotheque.filter(a => {
    const matchCat = catActive === "Tous" || a.categorie === catActive;
    const q = search.trim().toLowerCase();
    const matchSearch = !q
      || (a.nom || "").toLowerCase().includes(q)
      || (a.reference || "").toLowerCase().includes(q)
      || (a.categorie || "").toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const panierCount = Object.values(panier).reduce((s, v) => s + (v.qty || 0), 0);
  const panierItems = Object.values(panier).filter(v => v.qty > 0);

  const setQty = useCallback((article, delta, absolute = false) => {
    onPanierChange(prev => {
      const current = prev[article.id]?.qty || 0;
      const newQty = absolute ? delta : Math.max(0, current + delta);
      if (newQty === 0) {
        const next = { ...prev };
        delete next[article.id];
        return next;
      }
      return { ...prev, [article.id]: { article, qty: newQty } };
    });
  }, [onPanierChange]);

  const accent = chantierCouleur || "#FFC200";

  return (
    <>
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
          animation: "fadeIn .2s ease",
        }}
        onClick={onClose}
      />

      <div className="bcd-drawer" style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        height: "92vh",
        background: "#f0f2f7",
        borderRadius: "20px 20px 0 0",
        zIndex: 1001,
        display: "flex", flexDirection: "column",
        animation: "drawerUp .3s cubic-bezier(.22,1,.36,1)",
        fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
      }}>

        {/* Header */}
        <div style={{
          background: "#080a0d",
          padding: "14px 16px 10px",
          borderBottom: `3px solid ${accent}`,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>
                Besoin commande
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>
                📦 {chantierNom || "Chantier"}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.1)", border: "none",
              borderRadius: 10, padding: "8px 14px",
              color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1,
            }}>✕</button>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.09)",
            borderRadius: 10, padding: "9px 12px", marginTop: 10,
          }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <input
              ref={searchRef}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 15, color: "#fff", fontFamily: "inherit" }}
              placeholder="Rechercher un article…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 16, cursor: "pointer", padding: 0 }}>✕</button>
            )}
          </div>
        </div>

        {/* Filtres catégories */}
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px",
          background: "#fff", flexShrink: 0, scrollbarWidth: "none",
        }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setCatActive(cat)} style={{
              flexShrink: 0, padding: "6px 14px", borderRadius: 20,
              border: `1.5px solid ${catActive === cat ? accent : "#e0e4ef"}`,
              background: catActive === cat ? accent + "22" : "#fff",
              color: catActive === cat ? "#111" : "#8a9ab0",
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}>{cat}</button>
          ))}
        </div>

        {/* Grille articles */}
        <div style={{
          flex: 1, overflowY: "auto", minHeight: 0,
          padding: "12px 14px",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
          alignContent: "start",
          background: "#f0f2f7",
        }} className="bcd-grid">
          {loading && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "#8a9ab0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              Chargement…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "#8a9ab0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              Aucun article trouvé
            </div>
          )}

          {!loading && filtered.map(article => {
            const inPanier = !!(panier[article.id]?.qty > 0);
            const qty = panier[article.id]?.qty || 0;
            const imageUrl = article.image_url || article.image || article.photo || article.photo_url || null;

            return (
              <div
                key={article.id}
                className="bcd-article-card"
                style={{
                  background: "#ffffff",
                  borderRadius: 14,
                  border: `2px solid ${inPanier ? accent : "#d8dde8"}`,
                  boxShadow: inPanier ? `0 4px 16px ${accent}44` : "0 2px 8px rgba(0,0,0,0.09)",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {inPanier && (
                  <div style={{
                    position: "absolute", top: -8, right: -8,
                    background: accent, color: "#111", borderRadius: "50%",
                    width: 24, height: 24,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800,
                    animation: "popIn .2s ease", zIndex: 2,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  }}>{qty}</div>
                )}

                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={article.nom}
                    style={{
                      width: "100%", aspectRatio: "1/1",
                      objectFit: "contain", background: "#f8f9fc",
                      padding: 8, borderRadius: "12px 12px 0 0",
                      display: "block",
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div style={{
                    width: "100%", aspectRatio: "1/1",
                    background: "linear-gradient(135deg,#f0f2f7,#e4e8f0)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 32, borderRadius: "12px 12px 0 0",
                  }} className="bcd-img-placeholder">📦</div>
                )}

                <div style={{ padding: "8px 10px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1f2e", lineHeight: 1.3 }}>
                    {article.nom}
                  </div>
                  {article.reference && (
                    <div style={{ fontSize: 10, color: "#9aa5c0", letterSpacing: .5 }}>
                      Réf. {article.reference}
                    </div>
                  )}
{/* Prix masqué intentionnellement */}

                  <div style={{ marginTop: "auto", paddingTop: 6 }}>
                    {qty === 0 ? (
                      <button
                        className="bcd-qty-btn"
                        onClick={() => setQty(article, 1)}
                        style={{
                          width: "100%", padding: "8px 0",
                          background: accent, border: "none", borderRadius: 8,
                          fontSize: 13, fontWeight: 800,
                          cursor: "pointer", fontFamily: "inherit", color: "#111",
                        }}
                      >+ Ajouter</button>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button className="bcd-qty-btn" onClick={() => setQty(article, -1)} style={{
                          flex: 1, padding: "7px 0", background: "rgba(224,92,92,0.12)",
                          border: "1.5px solid rgba(224,92,92,0.3)", borderRadius: 8,
                          fontSize: 16, fontWeight: 800, cursor: "pointer", color: "#e05c5c",
                        }}>−</button>
                        <input
                          type="number" min="1" max="999"
                          value={qty}
                          onChange={e => setQty(article, Math.max(0, parseInt(e.target.value) || 0), true)}
                          style={{
                            flex: 1, textAlign: "center",
                            border: `1.5px solid ${accent}`,
                            borderRadius: 8, padding: "6px 2px",
                            fontSize: 14, fontWeight: 800, fontFamily: "inherit",
                            color: "#1a1f2e", outline: "none",
                          }}
                        />
                        <button className="bcd-qty-btn" onClick={() => setQty(article, 1)} style={{
                          flex: 1, padding: "7px 0", background: "rgba(80,200,120,0.12)",
                          border: "1.5px solid rgba(80,200,120,0.3)", borderRadius: 8,
                          fontSize: 16, fontWeight: 800, cursor: "pointer", color: "#50c878",
                        }}>+</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Barre panier */}
        <div style={{
          background: "#080a0d",
          borderTop: `3px solid ${accent}`,
          padding: "10px 16px 20px",
          flexShrink: 0,
        }}>
          {panierItems.length > 0 && (
            <div style={{
              display: "flex", gap: 8, overflowX: "auto",
              marginBottom: 10, paddingBottom: 4, scrollbarWidth: "none",
            }}>
              {panierItems.map(({ article, qty }) => (
                <div key={article.id} style={{
                  flexShrink: 0, background: "rgba(255,255,255,0.1)",
                  borderRadius: 8, padding: "5px 10px",
                  display: "flex", alignItems: "center", gap: 6,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}>
                  <span style={{ fontSize: 13, color: "#fff", fontWeight: 700 }}>{qty}×</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {article.nom}
                  </span>
                  <button onClick={() => setQty(article, 0, true)} style={{
                    background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                    fontSize: 13, cursor: "pointer", padding: 0, lineHeight: 1,
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <button
            disabled={panierItems.length === 0}
            onClick={() => panierItems.length > 0 && onClose()}
            style={{
              width: "100%", padding: "15px",
              border: "none", borderRadius: 12,
              fontSize: 16, fontWeight: 800,
              cursor: panierItems.length === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit", letterSpacing: .4,
              background: panierItems.length === 0 ? "#333" : accent,
              color: panierItems.length === 0 ? "#666" : "#111",
              boxShadow: panierItems.length === 0 ? "none" : `0 4px 16px ${accent}44`,
              transition: "all .15s",
            }}
          >
            {panierItems.length === 0
              ? "Aucun article sélectionné"
              : `✓ Confirmer — ${panierCount} article${panierCount > 1 ? "s" : ""}`
            }
          </button>
        </div>

      </div>
    </>
  );
}
