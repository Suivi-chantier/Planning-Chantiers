import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { getSimulateurHTML } from "./investSimulateurHTML.js";

// ─── LISTE DES PROJETS ────────────────────────────────────────────────────────
function ListeProjets({ profil, onOuvrir, onNouveauProjet }) {
  const [projets, setProjets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [suppId, setSuppId]     = useState(null);

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("invest_projets")
      .select("id, nom, created_by, created_at, updated_at, donnees")
      .order("updated_at", { ascending: false });
    setProjets(data || []);
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const supprimer = async (id) => {
    await supabase.from("invest_projets").delete().eq("id", id);
    setSuppId(null);
    charger();
  };

  const fmt = (iso) => iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })
    : "—";

  const kpi = (d) => {
    if (!d?.inputs) return null;
    const pN = d.inputs.prixNegocie || 0;
    const fn = pN * (d.inputs.tauxNotaire || 0.08);
    const total = pN + fn + (d.inputs.honoraires||0) + (d.inputs.enedis||0);
    const lots  = (d.lots||[]).filter(l=>l.type!=="Sélectionner");
    const loyer = lots.reduce((s,l)=>s+l.loyer,0);
    return { total, loyer, nbLots: lots.length };
  };

  return (
    <div style={{
      minHeight:"100vh", background:"#f8f9fb",
      fontFamily:"'Sora','Barlow Condensed',sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700;800&display=swap');
        .inv-card { background:white; border-radius:12px; border:1px solid #eef0f5;
          box-shadow:0 1px 4px rgba(15,30,53,.06); transition:all .2s; cursor:pointer; }
        .inv-card:hover { border-color:#1f4ea1; box-shadow:0 4px 20px rgba(31,78,161,.12); transform:translateY(-2px); }
        .inv-btn-blue { background:#1f4ea1; color:white; border:none; border-radius:8px;
          padding:10px 20px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer; }
        .inv-btn-blue:hover { background:#1740c0; }
        .inv-btn-out { background:white; color:#1a2d4a; border:1.5px solid #d8dce6; border-radius:8px;
          padding:10px 20px; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; }
        .inv-btn-out:hover { background:#f8f9fb; }
        .inv-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:10px;
          font-weight:700; background:#eef0f5; color:#5a6070; }
      `}</style>

      {/* Header */}
      <div style={{ background:"#1a2d4a", padding:"20px 32px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ fontSize:11, letterSpacing:2, textTransform:"uppercase", color:"rgba(201,168,76,0.7)", marginBottom:2 }}>Profero</div>
          <div style={{ fontSize:22, fontWeight:800, color:"white", letterSpacing:.3 }}>Invest</div>
          <div style={{ width:1, height:24, background:"rgba(255,255,255,0.15)" }}/>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)" }}>Portefeuille de projets</div>
        </div>
        <button className="inv-btn-blue" onClick={onNouveauProjet}
          style={{ background:"#c9a84c", color:"#1a2d4a", display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:16 }}>＋</span> Nouveau projet
        </button>
      </div>

      {/* Contenu */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 24px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:"#1a2d4a" }}>Tous les projets</div>
            <div style={{ fontSize:13, color:"#9aa0b0", marginTop:2 }}>
              {projets.length} projet{projets.length!==1?"s":""} — partagés avec tous les associés
            </div>
          </div>
          <button className="inv-btn-out" onClick={charger} style={{ fontSize:12, padding:"7px 14px" }}>
            ↻ Actualiser
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:"60px 0", color:"#9aa0b0", fontSize:14 }}>Chargement…</div>
        ) : projets.length === 0 ? (
          <div style={{ textAlign:"center", padding:"80px 20px" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🏢</div>
            <div style={{ fontSize:18, fontWeight:700, color:"#1a2d4a", marginBottom:8 }}>Aucun projet pour l'instant</div>
            <div style={{ fontSize:14, color:"#9aa0b0", marginBottom:24 }}>Créez votre premier projet d'investissement</div>
            <button className="inv-btn-blue" onClick={onNouveauProjet}>＋ Créer un projet</button>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16 }}>
            {projets.map(p => {
              const k = kpi(p.donnees);
              return (
                <div key={p.id} className="inv-card" style={{ padding:"20px 22px" }}
                  onClick={() => onOuvrir(p)}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:16, fontWeight:700, color:"#1a2d4a", marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        📄 {p.nom}
                      </div>
                      <div style={{ fontSize:11, color:"#9aa0b0" }}>
                        Par {p.created_by} · Modifié {fmt(p.updated_at)}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setSuppId(p.id); }}
                      style={{ background:"none", border:"none", cursor:"pointer", color:"#9aa0b0", fontSize:16, padding:"0 4px", lineHeight:1, flexShrink:0 }}>
                      ×
                    </button>
                  </div>
                  {k && (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
                      <div style={{ background:"#f8f9fb", borderRadius:8, padding:"8px 10px", borderLeft:"3px solid #1f4ea1" }}>
                        <div style={{ fontSize:10, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:.5, marginBottom:2 }}>Coût total</div>
                        <div style={{ fontSize:13, fontWeight:800, color:"#1a2d4a" }}>
                          {k.total > 0 ? Math.round(k.total).toLocaleString("fr-FR")+" €" : "—"}
                        </div>
                      </div>
                      <div style={{ background:"#f8f9fb", borderRadius:8, padding:"8px 10px", borderLeft:"3px solid #1a7a4a" }}>
                        <div style={{ fontSize:10, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:.5, marginBottom:2 }}>Loyers/mois</div>
                        <div style={{ fontSize:13, fontWeight:800, color:"#1a7a4a" }}>
                          {k.loyer > 0 ? k.loyer.toLocaleString("fr-FR")+" €" : "—"}
                        </div>
                      </div>
                      <div style={{ background:"#f8f9fb", borderRadius:8, padding:"8px 10px", borderLeft:"3px solid #c9a84c" }}>
                        <div style={{ fontSize:10, color:"#9aa0b0", textTransform:"uppercase", letterSpacing:.5, marginBottom:2 }}>Lots</div>
                        <div style={{ fontSize:13, fontWeight:800, color:"#1a2d4a" }}>{k.nbLots}</div>
                      </div>
                    </div>
                  )}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span className="inv-badge">{fmt(p.created_at)}</span>
                    <span style={{ fontSize:12, color:"#1f4ea1", fontWeight:600 }}>Ouvrir →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal confirmation suppression */}
      {suppId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"white", borderRadius:16, padding:"28px 32px", maxWidth:380, width:"90%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🗑️</div>
            <div style={{ fontSize:16, fontWeight:800, color:"#1a2d4a", marginBottom:8 }}>Supprimer ce projet ?</div>
            <div style={{ fontSize:13, color:"#5a6070", marginBottom:24, lineHeight:1.6 }}>
              Cette action est irréversible. Le projet sera supprimé pour tous les associés.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button className="inv-btn-out" onClick={() => setSuppId(null)}>Annuler</button>
              <button className="inv-btn-blue" onClick={() => supprimer(suppId)}
                style={{ background:"#c0392b" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SIMULATEUR (iframe vers le HTML original, enrichi de Supabase) ───────────
// On embarque toute la logique HTML dans un string et on la monte dans un iframe
// pour conserver fidèlement le simulateur de ton collègue.
// La communication React ↔ iframe se fait via postMessage.

function Simulateur({ projet, profil, onRetour }) {
  const iframeRef  = useRef(null);
  const [saving, setSaving]  = useState(false);
  const [saved, setSaved]    = useState(false);
  const [nom, setNom]        = useState(projet?.nom || "Nouveau projet");
  const autoSaveRef          = useRef(null);
  const isNew                = !projet?.id;
  const projetIdRef          = useRef(projet?.id || null);

  // ── Sauvegarder dans Supabase ──────────────────────────────────────────────
  const sauvegarder = useCallback(async (etat, nomProjet) => {
    setSaving(true);
    const nomFinal = nomProjet || nom;
    const payload = {
      nom:        nomFinal,
      created_by: profil?.email || profil?.nom || "inconnu",
      updated_at: new Date().toISOString(),
      donnees:    etat,
    };
    if (projetIdRef.current) {
      await supabase.from("invest_projets")
        .update(payload)
        .eq("id", projetIdRef.current);
    } else {
      const { data } = await supabase.from("invest_projets")
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select("id").single();
      if (data?.id) projetIdRef.current = data.id;
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [nom, profil]);

  // ── Écouter les messages de l'iframe ──────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || e.data.source !== "profero-invest") return;
      if (e.data.type === "save") {
        const nomMaj = e.data.projectName || nom;
        setNom(nomMaj);
        sauvegarder(e.data.state, nomMaj);
      }
      if (e.data.type === "autosave") {
        const nomMaj = e.data.projectName || nom;
        setNom(nomMaj);
        sauvegarder(e.data.state, nomMaj);
      }
      if (e.data.type === "namechange") {
        setNom(e.data.projectName);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sauvegarder, nom]);

  // ── Injecter l'état initial dans l'iframe une fois chargée ─────────────────
  const onIframeLoad = () => {
    if (projet?.donnees && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        source: "profero-host",
        type:   "loadState",
        state:  projet.donnees,
        projectName: projet.nom,
      }, "*");
    }
  };

  // ── HTML du simulateur enrichi de postMessage ──────────────────────────────
  const htmlContent = getSimulateurHTML();

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", fontFamily:"'Sora',sans-serif" }}>
      {/* Barre de navigation */}
      <div style={{
        background:"#1a2d4a", borderBottom:"3px solid #c9a84c",
        padding:"8px 20px", display:"flex", alignItems:"center", gap:14, flexShrink:0,
      }}>
        <button onClick={onRetour} style={{
          background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)",
          borderRadius:6, padding:"6px 12px", color:"rgba(255,255,255,0.7)", fontSize:12,
          cursor:"pointer", fontFamily:"inherit", fontWeight:600,
        }}>← Projets</button>

        <div style={{ width:1, height:20, background:"rgba(255,255,255,0.15)" }}/>

        <div style={{ fontSize:11, letterSpacing:1.5, textTransform:"uppercase", color:"rgba(201,168,76,0.7)" }}>Profero Invest</div>
        <div style={{ fontSize:14, fontWeight:700, color:"white" }}>{nom || "Nouveau projet"}</div>

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          {saving && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#f5a623", display:"inline-block" }}/>
              Sauvegarde…
            </div>
          )}
          {saved && !saving && (
            <div style={{ fontSize:12, color:"#50c878", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#50c878", display:"inline-block" }}/>
              Sauvegardé
            </div>
          )}
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)" }}>
            Sauvegarde auto toutes les 30s
          </div>
        </div>
      </div>

      {/* Iframe du simulateur */}
      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        onLoad={onIframeLoad}
        style={{ flex:1, border:"none", width:"100%" }}
        title="Simulateur Profero Invest"
      />
    </div>
  );
}

// ─── PAGE INVEST (routeur interne) ────────────────────────────────────────────
export default function PageInvest({ profil }) {
  const [vue, setVue]       = useState("liste"); // "liste" | "simulateur"
  const [projetOuvert, setProjetOuvert] = useState(null);

  const ouvrir = (p) => { setProjetOuvert(p); setVue("simulateur"); };
  const nouveau = () => { setProjetOuvert(null); setVue("simulateur"); };
  const retour  = () => { setProjetOuvert(null); setVue("liste"); };

  if (vue === "simulateur") {
    return <Simulateur projet={projetOuvert} profil={profil} onRetour={retour} />;
  }
  return <ListeProjets profil={profil} onOuvrir={ouvrir} onNouveauProjet={nouveau} />;
}
