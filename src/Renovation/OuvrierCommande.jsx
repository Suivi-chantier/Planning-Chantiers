import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { ShoppingCart, Search, X, Plus, Minus, AlertTriangle, Clock, CheckCircle2, Ban, Building2, Send, Package, ListChecks } from "lucide-react";
import { MobileCard, MobileEmptyState, Pill, MobileTabs } from "../mobileUI";

const NAV_H = 66; // hauteur de la bottom-nav de l'espace ouvrier
const STATUTS = {
  en_attente: { label: "En attente", color: "#f59e0b", icon: Clock },
  traite:     { label: "Traité",     color: "#22c55e", icon: CheckCircle2 },
  annule:     { label: "Annulé",     color: "#8a9ab0", icon: Ban },
};
const imgOf = (a) => a.image_url || a.image || a.photo || a.photo_url || null;

export default function OuvrierCommande({ prenom, T, accent = "#FFC200", preview = false }) {
  const [view, setView] = useState("catalogue"); // catalogue | demandes
  const [chantiers, setChantiers] = useState(DEFAULT_CHANTIERS);
  const [biblio, setBiblio]       = useState([]);
  const [besoins, setBesoins]     = useState([]);
  const [loadingBiblio, setLoadingBiblio]     = useState(true);
  const [loadingBesoins, setLoadingBesoins]   = useState(true);

  // Contexte de la commande
  const [chantierId, setChantierId] = useState("");
  const [urgent, setUrgent]         = useState(false);

  // Catalogue
  const [search, setSearch]       = useState("");
  const [catActive, setCatActive] = useState("Tous");
  const [panier, setPanier]       = useState({}); // { id: { article, qty } }
  const [submitting, setSubmitting] = useState(false);

  // Article hors catalogue
  const [libreOpen, setLibreOpen] = useState(false);
  const [libreNom, setLibreNom]   = useState("");
  const [libreQty, setLibreQty]   = useState("1");

  const chargerBesoins = async () => {
    setLoadingBesoins(true);
    const { data } = await supabase.from("besoins")
      .select("id, chantier_id, article, quantite, statut, priorite, photo_url, notes, created_at")
      .order("created_at", { ascending: false });
    setBesoins(data || []);
    setLoadingBesoins(false);
  };

  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantiers").maybeSingle()
      .then(({ data }) => { if (Array.isArray(data?.value) && data.value.length) setChantiers(data.value); });
    supabase.from("materiaux_bibliotheque").select("*").order("nom")
      .then(({ data }) => { setBiblio(data || []); setLoadingBiblio(false); });
    chargerBesoins();
  }, []);

  const nomChantier = (id) => chantiers.find(c => c.id === id)?.nom || id || "—";
  const couleurChantier = (id) => chantiers.find(c => c.id === id)?.couleur || "#5b8af5";

  const categories = useMemo(
    () => ["Tous", ...Array.from(new Set(biblio.map(a => a.categorie).filter(Boolean))).sort()],
    [biblio]
  );
  const filtered = useMemo(() => biblio.filter(a => {
    const matchCat = catActive === "Tous" || a.categorie === catActive;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (a.nom||"").toLowerCase().includes(q)
      || (a.reference||"").toLowerCase().includes(q) || (a.categorie||"").toLowerCase().includes(q);
    return matchCat && matchSearch;
  }), [biblio, catActive, search]);

  const setQty = (article, delta, absolute = false) => {
    setPanier(prev => {
      const cur = prev[article.id]?.qty || 0;
      const q = absolute ? delta : Math.max(0, cur + delta);
      if (q <= 0) { const n = { ...prev }; delete n[article.id]; return n; }
      return { ...prev, [article.id]: { article, qty: q } };
    });
  };

  const ajouterLibre = () => {
    const nom = libreNom.trim();
    if (!nom) return;
    const id = `libre-${Date.now()}`;
    setPanier(prev => ({ ...prev, [id]: { article: { id, nom, libre: true }, qty: Math.max(1, parseInt(libreQty) || 1) } }));
    setLibreNom(""); setLibreQty("1"); setLibreOpen(false);
  };

  const panierItems = Object.values(panier).filter(v => v.qty > 0);
  const panierCount = panierItems.reduce((s, v) => s + v.qty, 0);

  const envoyer = async () => {
    if (preview) return; // aperçu admin : lecture seule
    if (panierItems.length === 0) return;
    setSubmitting(true);
    // Toutes les lignes de ce panier partagent un même panier_id : le bureau
    // valide ensuite le panier entier (et non article par article).
    const panierId = crypto.randomUUID();
    const rows = panierItems.map(({ article, qty }) => ({
      chantier_id: chantierId || null,
      materiau_id: article.libre ? null : article.id,
      article: article.nom,
      quantite: String(qty),
      ouvrier_demandeur: prenom,
      origine: "ouvrier",
      statut: "en_attente",
      priorite: urgent ? "urgent" : "normal",
      panier_id: panierId,
    }));
    const { error } = await supabase.from("besoins").insert(rows);
    setSubmitting(false);
    if (error) { alert("Erreur à l'envoi : " + error.message); return; }
    setPanier({}); setUrgent(false);
    await chargerBesoins();
    setView("demandes");
  };

  const input = {
    width:"100%", border:`1.5px solid ${T.border}`, borderRadius:12, padding:"11px 12px",
    fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box", color:T.text, background:T.surface,
  };
  const enAttenteCount = besoins.filter(b => b.statut === "en_attente").length;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <MobileTabs
        tabs={[
          { id:"catalogue", label:"Catalogue", icon:Package },
          { id:"demandes",  label:"Mes demandes", icon:ListChecks, count: enAttenteCount || null },
        ]}
        value={view} onChange={setView} accent={accent} onAccent="#1a1f2e" T={T}
      />

      {view === "catalogue" ? (
        <>
          {/* Contexte commande */}
          <MobileCard T={T} style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, display:"block", marginBottom:6 }}>Pour quel chantier ?</label>
              <select style={input} value={chantierId} onChange={e=>setChantierId(e.target.value)}>
                <option value="">— Aucun / non précisé —</option>
                {chantiers.filter(c=>!c.archive).map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {[{v:false,l:"Normal",c:"#c0a060"},{v:true,l:"Urgent",c:"#e05c5c"}].map(o => (
                <button key={o.l} onClick={()=>setUrgent(o.v)} style={{
                  flex:1, padding:"9px 0", borderRadius:12, border:"1.5px solid", cursor:"pointer", fontFamily:"inherit",
                  fontSize:14, fontWeight:700,
                  borderColor: urgent===o.v ? o.c : T.border,
                  background: urgent===o.v ? `${o.c}18` : T.surface,
                  color: urgent===o.v ? o.c : T.textMuted,
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                }}>
                  {o.v && <Icon as={AlertTriangle} size={13} strokeWidth={2.3}/>}
                  {o.l}
                </button>
              ))}
            </div>
          </MobileCard>

          {/* Recherche */}
          <div style={{ display:"flex", alignItems:"center", gap:8, background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 12px" }}>
            <Icon as={Search} size={16} color={T.textMuted}/>
            <input style={{ flex:1, border:"none", outline:"none", background:"transparent", fontSize:16, fontFamily:"inherit", color:T.text }}
              placeholder="Rechercher un article…" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search && <button onClick={()=>setSearch("")} style={{ background:"none", border:"none", color:T.textMuted, cursor:"pointer", padding:0 }}><Icon as={X} size={15}/></button>}
          </div>

          {/* Catégories */}
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2, scrollbarWidth:"none" }}>
            {categories.map(cat => {
              const sel = catActive === cat;
              return (
                <button key={cat} onClick={()=>setCatActive(cat)} style={{
                  flexShrink:0, padding:"7px 14px", borderRadius:999, cursor:"pointer", fontFamily:"inherit",
                  fontSize:13, fontWeight:700, whiteSpace:"nowrap",
                  border:`1.5px solid ${sel ? "transparent" : T.border}`,
                  background: sel ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : T.surface,
                  color: sel ? "#1a1f2e" : T.textSub,
                  boxShadow: sel ? `0 4px 12px ${accent}44` : "none",
                }}>{cat}</button>
              );
            })}
          </div>

          {/* Grille articles */}
          {loadingBiblio ? (
            <div style={{ padding:"30px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
          ) : filtered.length === 0 ? (
            <MobileCard T={T}><MobileEmptyState T={T} icon={Search} title="Aucun article trouvé" hint="Essaie un autre mot-clé ou catégorie."/></MobileCard>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10 }}>
              {filtered.map(article => {
                const qty = panier[article.id]?.qty || 0;
                const inCart = qty > 0;
                const url = imgOf(article);
                return (
                  <div key={article.id} style={{
                    background:T.surface, borderRadius:14, border:`2px solid ${inCart ? accent : T.border}`,
                    boxShadow: inCart ? `0 4px 14px ${accent}33` : "0 1px 4px rgba(16,24,40,0.05)",
                    position:"relative", display:"flex", flexDirection:"column", overflow:"hidden",
                  }}>
                    {inCart && (
                      <div style={{ position:"absolute", top:6, right:6, background:accent, color:"#1a1f2e", borderRadius:"50%",
                        width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, zIndex:2 }}>{qty}</div>
                    )}
                    {url ? (
                      <img src={url} alt={article.nom} loading="lazy" style={{ width:"100%", aspectRatio:"1/1", objectFit:"contain", background:"#f8f9fc", padding:8, display:"block" }}/>
                    ) : (
                      <div style={{ width:"100%", aspectRatio:"1/1", background:"linear-gradient(135deg,#f0f2f7,#e4e8f0)", display:"flex", alignItems:"center", justifyContent:"center", color:T.textMuted }}>
                        <Icon as={Package} size={30}/>
                      </div>
                    )}
                    <div style={{ padding:"8px 10px 10px", flex:1, display:"flex", flexDirection:"column", gap:3 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:T.text, lineHeight:1.3 }}>{article.nom}</div>
                      {article.reference && <div style={{ fontSize:10, color:T.textMuted, letterSpacing:.5 }}>Réf. {article.reference}</div>}
                      <div style={{ marginTop:"auto", paddingTop:6 }}>
                        {qty === 0 ? (
                          <button onClick={()=>setQty(article, 1)} style={{
                            width:"100%", padding:"8px 0", background:accent, border:"none", borderRadius:8,
                            fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit", color:"#1a1f2e",
                          }}>+ Ajouter</button>
                        ) : (
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <button onClick={()=>setQty(article, -1)} style={{ flex:1, padding:"7px 0", background:"rgba(224,92,92,0.12)", border:"1.5px solid rgba(224,92,92,0.3)", borderRadius:8, cursor:"pointer", color:"#e05c5c", display:"flex", justifyContent:"center" }}><Icon as={Minus} size={15} strokeWidth={2.6}/></button>
                            <input type="number" min="1" value={qty} onChange={e=>setQty(article, Math.max(0, parseInt(e.target.value)||0), true)}
                              style={{ width:38, textAlign:"center", border:`1.5px solid ${accent}`, borderRadius:8, padding:"6px 2px", fontSize:15, fontWeight:800, fontFamily:"inherit", color:T.text, outline:"none" }}/>
                            <button onClick={()=>setQty(article, 1)} style={{ flex:1, padding:"7px 0", background:"rgba(80,200,120,0.12)", border:"1.5px solid rgba(80,200,120,0.3)", borderRadius:8, cursor:"pointer", color:"#50c878", display:"flex", justifyContent:"center" }}><Icon as={Plus} size={15} strokeWidth={2.6}/></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Article hors catalogue */}
          {libreOpen ? (
            <MobileCard T={T} style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ fontSize:13, fontWeight:800, color:T.text }}>Article hors catalogue</div>
              <input style={input} value={libreNom} onChange={e=>setLibreNom(e.target.value)} placeholder="Nom / description de l'article"/>
              <div style={{ display:"flex", gap:8 }}>
                <input style={{...input, flex:"0 0 90px"}} value={libreQty} onChange={e=>setLibreQty(e.target.value)} placeholder="Qté" inputMode="numeric"/>
                <button onClick={ajouterLibre} disabled={!libreNom.trim()} style={{ flex:1, padding:"11px", border:"none", borderRadius:12, background: libreNom.trim() ? accent : T.border, color:"#1a1f2e", fontWeight:800, fontFamily:"inherit", cursor: libreNom.trim() ? "pointer":"not-allowed" }}>Ajouter au panier</button>
              </div>
            </MobileCard>
          ) : (
            <button onClick={()=>setLibreOpen(true)} style={{
              padding:"11px", border:`1.5px dashed ${T.border}`, borderRadius:12, background:T.surface,
              color:T.textSub, fontFamily:"inherit", fontSize:14, fontWeight:700, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            }}>
              <Icon as={Plus} size={14} strokeWidth={2.2}/> Article absent du catalogue ?
            </button>
          )}

          {/* Espace pour la barre panier fixe */}
          {panierItems.length > 0 && <div style={{ height:72 }}/>}

          {/* Barre panier fixe */}
          {panierItems.length > 0 && (
            <div style={{ position:"fixed", left:0, right:0, bottom:NAV_H, zIndex:49, padding:"10px 12px 12px",
              background:`linear-gradient(to top, ${T.bg} 62%, ${T.bg}cc 82%, transparent)` }}>
              <button onClick={envoyer} disabled={submitting || preview} style={{
                width:"100%", padding:"15px", border:"none", borderRadius:15,
                background: preview ? T.border : `linear-gradient(135deg, ${accent}, ${accent}cc)`, color:"#1a1f2e",
                fontFamily:"inherit", fontSize:16, fontWeight:800, cursor: (submitting || preview) ? "not-allowed" : "pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow: preview ? "none" : `0 8px 20px ${accent}66`,
              }}>
                <Icon as={Send} size={17} strokeWidth={2.3}/>
                {preview ? "Aperçu — envoi désactivé" : submitting ? "Envoi…" : `Envoyer ma demande · ${panierCount} article${panierCount>1?"s":""}`}
              </button>
            </div>
          )}
        </>
      ) : (
        /* ── Mes demandes ── */
        loadingBesoins ? (
          <div style={{ padding:"30px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
        ) : besoins.length === 0 ? (
          <MobileCard T={T}><MobileEmptyState T={T} icon={ShoppingCart} title="Aucune demande pour l'instant" hint="Choisis des articles dans le catalogue et envoie ta demande."/></MobileCard>
        ) : (
          besoins.map(b => {
            const st = STATUTS[b.statut] || STATUTS.en_attente;
            const urg = b.priorite === "urgent";
            const d = b.created_at ? new Date(b.created_at).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "";
            return (
              <MobileCard key={b.id} T={T} accent={urg ? "#e05c5c" : couleurChantier(b.chantier_id)} style={{ padding:"13px 15px" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                  {b.photo_url && (
                    <img src={b.photo_url} alt="" onClick={()=>window.open(b.photo_url,"_blank")}
                      style={{ width:52, height:52, objectFit:"cover", borderRadius:10, border:`1px solid ${T.border}`, flexShrink:0, cursor:"pointer" }}/>
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:3 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:T.text }}>{b.article}</span>
                      {b.quantite && <span style={{ fontSize:13, color:T.textSub, fontWeight:600 }}>· {b.quantite}</span>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12.5, color:T.textMuted }}>
                      {b.chantier_id && <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Icon as={Building2} size={11}/> {nomChantier(b.chantier_id)}</span>}
                      {d && <span>{d}</span>}
                    </div>
                    {b.notes && <div style={{ fontSize:12.5, color:T.textSub, marginTop:4, lineHeight:1.4 }}>{b.notes}</div>}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, marginTop:10 }}>
                  <Pill color={st.color}><Icon as={st.icon} size={12} strokeWidth={2.3}/> {st.label}</Pill>
                  {urg && <Pill color="#e05c5c"><Icon as={AlertTriangle} size={12} strokeWidth={2.3}/> Urgent</Pill>}
                </div>
              </MobileCard>
            );
          })
        )
      )}
    </div>
  );
}
