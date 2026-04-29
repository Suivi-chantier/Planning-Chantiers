// ─── BESOIN COMMANDE DRAWER ───────────────────────────────────────────────────
// Remplace le textarea "Besoins commande" dans PageRapportMobile
//
// USAGE dans PageRapportMobile :
//   1. Importer ce composant : import BesoinCommandeDrawer from "./BesoinCommandeDrawer";
//   2. Ajouter l'état : const [besoinDrawer, setBesoinDrawer] = useState(null); // chantier_id actif
//   3. Remplacer le bloc "Besoins en commande par chantier" par le JSX en bas de ce fichier
//   4. Adapter soumettre() : remplacer `besoins[grp.chantier_id]` par le nouveau format (voir bas)
//
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

// Petite animation CSS injectée une seule fois
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
  `;
  document.head.appendChild(style);
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────────────
export default function BesoinCommandeDrawer({
  chantierNom,
  chantierCouleur,
  panier,          // { [articleId]: { article, qty } }
  onPanierChange,  // (nouveauPanier) => void
  onClose,
}) {
  injectStyles();

  const [bibliotheque, setBibliotheque] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [catActive, setCatActive]       = useState("Tous");
  const searchRef = useRef(null);

  // Charger la bibliothèque
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("materiaux_bibliotheque").select("*").order("nom");
      setBibliotheque(data || []);
      setLoading(false);
    })();
  }, []);

  // Catégories dynamiques
  const categories = ["Tous", ...Array.from(new Set((bibliotheque || []).map(a => a.categorie).filter(Boolean))).sort()];

  // Filtrage
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

  const C = {
    overlay: {
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(2px)",
      animation: "fadeIn .2s ease",
    },
    drawer: {
      position: "fixed", left: 0, right: 0, bottom: 0,
      height: "92vh",
      background: "#f4f6fa",
      borderRadius: "20px 20px 0 0",
      zIndex: 1001,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      animation: "drawerUp .3s cubic-bezier(.22,1,.36,1)",
      fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
    },
    header: {
      background: "#080a0d",
      padding: "14px 16px 10px",
      borderBottom: `3px solid ${chantierCouleur || "#FFC200"}`,
      flexShrink: 0,
    },
    searchBar: {
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(255,255,255,0.09)",
      borderRadius: 10, padding: "9px 12px",
      marginTop: 10,
    },
    searchInput: {
      flex: 1, background: "transparent", border: "none", outline: "none",
      fontSize: 15, color: "#fff", fontFamily: "inherit",
    },
    catScroll: {
      display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px",
      background: "#fff",
      flexShrink: 0,
      scrollbarWidth: "none",
    },
    catChip: (active) => ({
      flexShrink: 0,
      padding: "6px 14px",
      borderRadius: 20,
      border: `1.5px solid ${active ? (chantierCouleur || "#FFC200") : "#e0e4ef"}`,
      background: active ? (chantierCouleur || "#FFC200") + "22" : "#fff",
      color: active ? "#111" : "#8a9ab0",
      fontSize: 13, fontWeight: 700,
      cursor: "pointer", fontFamily: "inherit",
    }),
    grid: {
      flex: 1, overflowY: "auto",
      padding: "12px 14px",
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 10,
      alignContent: "start",
    },
    articleCard: (inPanier) => ({
      background: "#fff",
      borderRadius: 14,
      border: `2px solid ${inPanier ? (chantierCouleur || "#FFC200") : "#e8ecf2"}`,
      overflow: "hidden",
      cursor: "pointer",
      boxShadow: inPanier ? `0 2px 12px ${(chantierCouleur || "#FFC200")}44` : "0 1px 4px rgba(0,0,0,0.06)",
      position: "relative",
    }),
    articleImg: {
      width: "100%", aspectRatio: "1/1",
      objectFit: "contain",
      background: "#f8f9fc",
      padding: 6,
    },
    articleImgPlaceholder: {
      width: "100%", aspectRatio: "1/1",
      background: "linear-gradient(135deg,#f0f2f7,#e4e8f0)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 28,
    },
    articleInfo: {
      padding: "8px 9px 10px",
    },
    panierBar: {
      background: "#080a0d",
      borderTop: `3px solid ${chantierCouleur || "#FFC200"}`,
      padding: "10px 16px 20px",
      flexShrink: 0,
    },
    panierScroll: {
      display: "flex", gap: 8, overflowX: "auto",
      marginBottom: 10, paddingBottom: 4,
      scrollbarWidth: "none",
    },
    panierChip: {
      flexShrink: 0,
      background: "rgba(255,255,255,0.1)",
      borderRadius: 8, padding: "5px 10px",
      display: "flex", alignItems: "center", gap: 6,
      border: "1px solid rgba(255,255,255,0.15)",
    },
    validerBtn: (disabled) => ({
      width: "100%", padding: "15px",
      border: "none", borderRadius: 12,
      fontSize: 16, fontWeight: 800,
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit", letterSpacing: .4,
      background: disabled ? "#555" : (chantierCouleur || "#FFC200"),
      color: disabled ? "#888" : "#111",
      boxShadow: disabled ? "none" : `0 4px 16px ${(chantierCouleur || "#FFC200")}44`,
      transition: "all .15s",
    }),
  };

  return (
    <>
      {/* Overlay */}
      <div style={C.overlay} onClick={onClose} />

      {/* Drawer */}
      <div style={C.drawer}>

        {/* Header */}
        <div style={C.header}>
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
              borderRadius: 10, padding: "8px 12px",
              color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1,
            }}>✕</button>
          </div>

          {/* Recherche */}
          <div style={C.searchBar}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <input
              ref={searchRef}
              style={C.searchInput}
              placeholder="Rechercher un article…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button onClick={() => setSearch("")} style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.5)",
                fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1,
              }}>✕</button>
            )}
          </div>
        </div>

        {/* Filtres catégories */}
        <div style={C.catScroll}>
          {categories.map(cat => (
            <button key={cat} style={C.catChip(catActive === cat)}
              onClick={() => setCatActive(cat)}>
              {cat}
            </button>
          ))}
        </div>

        {/* Grille articles */}
        <div style={C.grid}>
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
          {filtered.map(article => {
            const inPanier = !!(panier[article.id]?.qty > 0);
            const qty = panier[article.id]?.qty || 0;
            return (
              <div
                key={article.id}
                className="bcd-article-card"
                style={C.articleCard(inPanier)}
              >
                {/* Badge panier */}
                {inPanier && (
                  <div style={{
                    position: "absolute", top: 7, right: 7,
                    background: chantierCouleur || "#FFC200",
                    color: "#111", borderRadius: "50%",
                    width: 22, height: 22,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800,
                    animation: "popIn .2s ease",
                    zIndex: 2,
                  }}>{qty}</div>
                )}

                {/* Image */}
                {article.image_url
                  ? <img src={article.image_url} alt={article.nom} style={C.articleImg} loading="lazy" />
                  : <div style={C.articleImgPlaceholder}>📦</div>
                }

                {/* Infos */}
                <div style={C.articleInfo}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1f2e", lineHeight: 1.3, marginBottom: 3 }}>
                    {article.nom}
                  </div>
                  {article.reference && (
                    <div style={{ fontSize: 10, color: "#9aa5c0", letterSpacing: .5, marginBottom: 3 }}>
                      Réf. {article.reference}
                    </div>
                  )}
                  {article.prix_unitaire > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#5b8af5", marginBottom: 6 }}>
                      {article.prix_unitaire}€ <span style={{ fontWeight: 400, color: "#9aa5c0" }}>/ {article.unite || "u"}</span>
                    </div>
                  )}

                  {/* Contrôle quantité */}
                  {qty === 0 ? (
                    <button
                      className="bcd-qty-btn"
                      onClick={() => setQty(article, 1)}
                      style={{
                        width: "100%", padding: "7px 0",
                        background: chantierCouleur || "#FFC200",
                        border: "none", borderRadius: 8,
                        fontSize: 13, fontWeight: 800,
                        cursor: "pointer", fontFamily: "inherit", color: "#111",
                      }}
                    >
                      + Ajouter
                    </button>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button className="bcd-qty-btn" onClick={() => setQty(article, -1)} style={{
                        flex: 1, padding: "7px 0", background: "rgba(224,92,92,0.12)",
                        border: "1.5px solid rgba(224,92,92,0.25)", borderRadius: 8,
                        fontSize: 16, fontWeight: 800, cursor: "pointer", color: "#e05c5c",
                      }}>−</button>
                      <input
                        type="number" min="1" max="999"
                        value={qty}
                        onChange={e => setQty(article, Math.max(0, parseInt(e.target.value) || 0), true)}
                        style={{
                          flex: 1, textAlign: "center",
                          border: `1.5px solid ${chantierCouleur || "#FFC200"}`,
                          borderRadius: 8, padding: "6px 2px",
                          fontSize: 14, fontWeight: 800, fontFamily: "inherit",
                          color: "#1a1f2e", outline: "none",
                        }}
                      />
                      <button className="bcd-qty-btn" onClick={() => setQty(article, 1)} style={{
                        flex: 1, padding: "7px 0", background: "rgba(80,200,120,0.12)",
                        border: "1.5px solid rgba(80,200,120,0.25)", borderRadius: 8,
                        fontSize: 16, fontWeight: 800, cursor: "pointer", color: "#50c878",
                      }}>+</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Barre panier + valider */}
        <div style={C.panierBar}>
          {panierItems.length > 0 && (
            <div style={C.panierScroll}>
              {panierItems.map(({ article, qty }) => (
                <div key={article.id} style={C.panierChip}>
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
            style={C.validerBtn(panierItems.length === 0)}
            disabled={panierItems.length === 0}
            onClick={() => panierItems.length > 0 && onClose()}
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


// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCTIONS D'INTÉGRATION dans PageRapportMobile.jsx
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. IMPORT en haut de fichier :
//    import BesoinCommandeDrawer from "./BesoinCommandeDrawer";
//
// 2. REMPLACER l'état besoins :
//    // AVANT  : const [besoins, setBesoins] = useState({});
//    // APRÈS  :
//    const [paniers, setPaniers]         = useState({});  // { chantier_id: { articleId: {article, qty} } }
//    const [besoinDrawer, setBesoinDrawer] = useState(null); // chantier_id actif ou null
//
// 3. REMPLACER le bloc "Besoins en commande par chantier" par :
//
//    {[...new Set(taches.filter(t=>t.chantier_id).map(t=>t.chantier_id))].map(cId => {
//      const ct = taches.find(t=>t.chantier_id===cId);
//      const nbArticles = Object.values(paniers[cId]||{}).filter(v=>v.qty>0).length;
//      return (
//        <div key={cId} style={{...S.card, border:"1.5px solid rgba(176,96,255,0.3)", background:"rgba(176,96,255,0.04)"}}>
//          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
//            <span style={{...S.label, marginBottom:0, color:"#9040c0"}}>
//              📦 Besoins commande
//              {ct?.chantier_nom && (
//                <span style={{marginLeft:6,background:ct.chantier_couleur+"44",color:"#1a1f2e",
//                  borderRadius:4,padding:"0 6px",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>
//                  {ct.chantier_nom}
//                </span>
//              )}
//            </span>
//            {nbArticles > 0 && (
//              <span style={{background:"rgba(176,96,255,0.2)",color:"#9040c0",borderRadius:20,
//                padding:"2px 10px",fontSize:12,fontWeight:700}}>
//                {nbArticles} article{nbArticles>1?"s":""}
//              </span>
//            )}
//          </div>
//
//          {/* Récap articles sélectionnés */}
//          {nbArticles > 0 && (
//            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
//              {Object.values(paniers[cId]||{}).filter(v=>v.qty>0).map(({article,qty})=>(
//                <div key={article.id} style={{background:"rgba(176,96,255,0.12)",borderRadius:8,
//                  padding:"4px 10px",fontSize:12,fontWeight:700,color:"#6020a0"}}>
//                  {qty}× {article.nom}
//                </div>
//              ))}
//            </div>
//          )}
//
//          <button onClick={()=>setBesoinDrawer(cId)} style={{
//            width:"100%",padding:"12px",border:"1.5px dashed rgba(176,96,255,0.4)",
//            borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",
//            fontFamily:"inherit",background:"transparent",color:"#9040c0",
//          }}>
//            {nbArticles > 0 ? "✏️ Modifier ma sélection" : "🛒 Choisir dans la bibliothèque"}
//          </button>
//          <div style={{fontSize:11,color:"#9040c0",marginTop:6}}>
//            ⚡ Sera transmis automatiquement dans l'onglet Commandes
//          </div>
//        </div>
//      );
//    })}
//
//    {/* Drawer */}
//    {besoinDrawer && (() => {
//      const ct = taches.find(t=>t.chantier_id===besoinDrawer);
//      return (
//        <BesoinCommandeDrawer
//          chantierNom={ct?.chantier_nom}
//          chantierCouleur={ct?.chantier_couleur}
//          panier={paniers[besoinDrawer]||{}}
//          onPanierChange={updater => setPaniers(prev => ({
//            ...prev,
//            [besoinDrawer]: typeof updater==="function" ? updater(prev[besoinDrawer]||{}) : updater,
//          }))}
//          onClose={()=>setBesoinDrawer(null)}
//        />
//      );
//    })()}
//
// 4. ADAPTER soumettre() — remplacer la partie "besoins" par :
//
//    const besoinArticles = Object.values(paniers[grp.chantier_id]||{}).filter(v=>v.qty>0);
//    for (const {article, qty} of besoinArticles) {
//      await supabase.from("commandes_detail").insert({
//        chantier_id: grp.chantier_id,
//        article: article.nom,
//        reference: article.reference || "",
//        fournisseur: article.fournisseur || "",
//        quantite: String(qty),
//        unite: article.unite || "",
//        prix_unitaire: article.prix_unitaire || null,
//        lien_commande: article.lien_url || "",
//        statut: "besoin_ouvrier",
//        notes: `Demande de ${ouvrier.trim()} — ${dateKey}`,
//      });
//    }
