import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// ─── PHASES (identiques à Phasage.jsx) ───────────────────────────────────────
const PHASES = [
  { id: "demolition",     label: "Démolition",           couleur: "#e05c5c" },
  { id: "plomberie_ro",   label: "Réseaux plomberie",    couleur: "#3b82f6" },
  { id: "menuiserie",     label: "Menuiserie",            couleur: "#8b5cf6" },
  { id: "feraillage",     label: "Feraillage / Cloisons", couleur: "#f59e0b" },
  { id: "elec_vmc",       label: "Électricité & VMC",     couleur: "#eab308" },
  { id: "placo",          label: "Placo / Enduits",       couleur: "#6366f1" },
  { id: "peinture_sols",  label: "Peintures & sols",      couleur: "#ec4899" },
  { id: "finition_elec",  label: "Finitions électricité", couleur: "#f97316" },
  { id: "finition_plomb", label: "Finitions plomberie",   couleur: "#06b6d4" },
  { id: "cuisine",        label: "Cuisine",               couleur: "#10b981" },
  { id: "finitions_gen",  label: "Finitions générales",   couleur: "#a78bfa" },
];

const STATUTS = {
  en_cours: { label: "En cours",  color: "#FFC300", bg: "rgba(255,195,0,0.15)"   },
  termine:  { label: "Terminé",   color: "#50c878", bg: "rgba(80,200,120,0.15)"  },
  planifie: { label: "Planifié",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  en_pause: { label: "En pause",  color: "#f97316", bg: "rgba(249,115,22,0.15)" },
};

function StatutBadge({ statut }) {
  const s = STATUTS[statut] || STATUTS.en_cours;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: .8,
      textTransform: "uppercase", padding: "3px 10px",
      borderRadius: 20, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`,
    }}>{s.label}</span>
  );
}

function ProgressBar({ value, color = "#FFC300", height = 6 }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div style={{ width: "100%", height, borderRadius: height, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: height, background: pct >= 100 ? "#50c878" : color, transition: "width .4s ease" }}/>
    </div>
  );
}

// ─── CALCULS ─────────────────────────────────────────────────────────────────
function calcFinances(phasage, tauxHoraires = {}) {
  if (!phasage?.plan_travaux) return { coutMO: 0, coutMat: 0, coutTotal: 0, prixVendu: 0, marge: 0, margePct: 0 };
  const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
  const coutMO   = allTaches.reduce((s, t) => s + ((parseFloat(t.heures_reelles) || 0) * (tauxHoraires[(t.ouvriers || [])[0] || ""] || 45)), 0);
  const coutMat  = allTaches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
  const coutTotal = coutMO + coutMat;
  const prixVendu = parseFloat(phasage.prix_vendu) || 0;
  const marge     = prixVendu - coutTotal;
  const margePct  = prixVendu > 0 ? (marge / prixVendu) * 100 : 0;
  return { coutMO, coutMat, coutTotal, prixVendu, marge, margePct };
}

function calcAvancement(phasage) {
  if (!phasage?.plan_travaux) return 0;
  const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
  if (allTaches.length === 0) return 0;
  const totalHV = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const totalHE = allTaches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHV > 0) return Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHV);
  if (totalHE > 0) return Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalHE);
  return Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / allTaches.length);
}

function getLastTaches(phasage, n = 5) {
  if (!phasage?.plan_travaux) return [];
  return PHASES.flatMap(ph =>
    (phasage.plan_travaux[ph.id] || []).map(t => ({ ...t, phaseLabel: ph.label, phaseCouleur: ph.couleur }))
  )
    .filter(t => (parseFloat(t.avancement) || 0) > 0)
    .sort((a, b) => (parseFloat(b.avancement) || 0) - (parseFloat(a.avancement) || 0))
    .slice(0, n);
}

// ─── CORRESPONDANCE NOM CHANTIER (robuste, insensible à la casse et accents) ─
function normalise(str) {
  return (str || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

// Vérifie si le nom du chantier apparaît dans l'adresse du compte rendu
function chantierMatchCR(chantierNom, crAdresse) {
  const nom = normalise(chantierNom);
  const adr = normalise(crAdresse || "");
  if (!nom || !adr) return false;
  // Test direct
  if (adr.includes(nom)) return true;
  // Test mot par mot (mots >2 chars)
  const mots = nom.split(" ").filter(m => m.length > 2);
  if (mots.length === 0) return false;
  return mots.some(m => adr.includes(m));
}

// Trouve le phasage correspondant à un chantier (par id puis par nom)
function trouverPhasage(phasages, chantier) {
  if (!chantier) return null;
  // 1. Match exact par chantier_id
  const exact = phasages.find(p => p.chantier_id === chantier.id);
  if (exact) return exact;
  // 2. Match par nom normalisé
  const nomCh = normalise(chantier.nom);
  return phasages.find(p => normalise(p.chantier_nom).includes(nomCh) || nomCh.includes(normalise(p.chantier_nom).split(" ")[0])) || null;
}

const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PageChantiers({ chantiers = [], tauxHoraires = {}, T }) {
  const [phasages, setPhasages]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(null);
  const [photoMap, setPhotoMap]         = useState({});
  const [uploading, setUploading]       = useState(false);
  const [compteRendus, setCompteRendus] = useState([]);
  const [loadingCR, setLoadingCR]       = useState(false);
  const fileInputRef                    = useRef(null);

  const bg      = T?.bg      || "#0d0f12";
  const surface = T?.surface || "#13161b";
  const card    = T?.card    || "#1a1d24";
  const border  = T?.border  || "#2a2d35";
  const text    = T?.text    || "#f0f0f0";
  const textSub = T?.textSub || "#888";
  const accent  = T?.accent  || "#FFC300";

  // ── Chargement phasages ──────────────────────────────────────────────────────
  // La table Supabase s'appelle "phasages"
  // chantier_id = id texte du chantier (ex: "arthur")
  // chantier_nom = nom complet (ex: "ARTHUR - R+2")
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("phasages")
        .select("id, chantier_id, chantier_nom, prix_vendu, plan_travaux, statut, photo_batiment, created_at, updated_at");
      if (!error && data) {
        setPhasages(data);
        const pm = {};
        data.forEach(p => { if (p.photo_batiment) pm[p.chantier_id] = p.photo_batiment; });
        setPhotoMap(pm);
      }
      setLoading(false);
    };
    load();
  }, []);

  // ── Chargement comptes rendus ────────────────────────────────────────────────
  // La table s'appelle "cr_comptes_rendus" (pas "comptes_rendus")
  // Elle n'a pas de chantier_id — on filtre côté client par le champ "adresse"
  // qui doit contenir le nom du chantier
  useEffect(() => {
    if (!selected || loading) { setCompteRendus([]); return; }

    const loadCR = async () => {
      setLoadingCR(true);
      const chantier = chantiers.find(c => c.id === selected);
      const phasage  = trouverPhasage(phasages, chantier);

      // Essayer d'abord par chantier_id exact (si le CR a bien été lié)
      const { data: dataById } = await supabase
        .from("cr_comptes_rendus")
        .select("id, chantier_id, adresse, date_visite, resume, avancement, prochaine_etape, type_visite, client_nom1, client_prenom1")
        .eq("chantier_id", selected)
        .order("date_visite", { ascending: false })
        .limit(5);

      if (dataById && dataById.length > 0) {
        setCompteRendus(dataById);
      } else {
        // Fallback : recherche par correspondance de nom dans l'adresse
        const { data, error } = await supabase
          .from("cr_comptes_rendus")
          .select("id, chantier_id, adresse, date_visite, resume, avancement, prochaine_etape, type_visite, client_nom1, client_prenom1")
          .order("date_visite", { ascending: false })
          .limit(150);

        if (!error && data) {
          const nomsCibles = [chantier?.nom, phasage?.chantier_nom, chantier?.id].filter(Boolean);
          const filtered = data.filter(cr =>
            nomsCibles.some(nom => chantierMatchCR(nom, cr.adresse))
          );
          setCompteRendus(filtered.slice(0, 5));
        }
      }
      setLoadingCR(false);
    };

    loadCR();
  }, [selected, loading, chantiers, phasages]);

  // ── Upload photo bâtiment ─────────────────────────────────────────────────────
  const handlePhotoUpload = async (e, chantierId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      const path = `chantiers/${chantierId}/batiment.${ext}`;
      const { error: upErr } = await supabase.storage.from("photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("photos").getPublicUrl(path);
      const url = urlData?.publicUrl;
      const phasage = phasages.find(p => p.chantier_id === chantierId);
      if (phasage) {
        await supabase.from("phasages").update({ photo_batiment: url }).eq("id", phasage.id);
        setPhasages(prev => prev.map(p => p.chantier_id === chantierId ? { ...p, photo_batiment: url } : p));
      }
      setPhotoMap(prev => ({ ...prev, [chantierId]: url }));
    } catch (err) {
      console.error("Erreur upload photo:", err);
      alert("Erreur upload photo. Vérifiez que le bucket 'photos' existe dans Supabase Storage.");
    }
    setUploading(false);
  };

  // ── Données du chantier sélectionné ──────────────────────────────────────────
  const selectedChantier = chantiers.find(c => c.id === selected);
  const selectedPhasage  = trouverPhasage(phasages, selectedChantier);
  const avancement       = selectedPhasage ? calcAvancement(selectedPhasage) : 0;
  const finances         = selectedPhasage ? calcFinances(selectedPhasage, tauxHoraires) : null;
  const lastTaches       = selectedPhasage ? getLastTaches(selectedPhasage) : [];

  // ─── VUE LISTE ────────────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div style={{ flex: 1, overflowY: "auto", background: bg, padding: "28px 32px" }}>
        <style>{`
          .chantier-card { transition: all .18s; cursor: pointer; }
          .chantier-card:hover { transform: translateY(-2px); box-shadow: 0 12px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,195,0,0.2); border-color: rgba(255,195,0,0.35) !important; }
          @media(max-width:768px) { .chantiers-grid { grid-template-columns: 1fr !important; } }
        `}</style>

        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: text, letterSpacing: .5, margin: 0 }}>🏗️ Mes Chantiers</h1>
            <p style={{ fontSize: 13, color: textSub, marginTop: 4 }}>
              {chantiers.length} chantier{chantiers.length > 1 ? "s" : ""} · {phasages.length} phasage{phasages.length > 1 ? "s" : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              { label: "En cours",  val: phasages.filter(p => !p.statut || p.statut === "en_cours").length, color: accent },
              { label: "Terminés",  val: phasages.filter(p => p.statut === "termine").length,               color: "#50c878" },
              { label: "Planifiés", val: phasages.filter(p => p.statut === "planifie").length,              color: "#3b82f6" },
            ].map(s => (
              <div key={s.label} style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "10px 18px", textAlign: "center", minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: textSub, letterSpacing: .5 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: textSub, padding: 80, fontSize: 15 }}>Chargement…</div>
        ) : chantiers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80, color: textSub }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🏗️</div>
            <div>Aucun chantier — ajoutez-en dans les réglages.</div>
          </div>
        ) : (
          <div className="chantiers-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 18 }}>
            {chantiers.map(chantier => {
              const phasage = trouverPhasage(phasages, chantier);
              const av      = phasage ? calcAvancement(phasage) : null;
              const fin     = phasage ? calcFinances(phasage, tauxHoraires) : null;
              const photo   = photoMap[chantier.id];
              const statut  = phasage?.statut || (phasage ? "en_cours" : null);

              return (
                <div key={chantier.id} className="chantier-card"
                  onClick={() => setSelected(chantier.id)}
                  style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>

                  <div style={{ height: 160, background: "rgba(255,255,255,0.04)", position: "relative", overflow: "hidden", flexShrink: 0 }}>
                    {photo ? (
                      <img src={photo} alt={chantier.nom} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <span style={{ fontSize: 40, opacity: .3 }}>🏢</span>
                        <span style={{ fontSize: 11, color: textSub, opacity: .6 }}>Aucune photo</span>
                      </div>
                    )}
                    {statut && <div style={{ position: "absolute", top: 10, right: 10 }}><StatutBadge statut={statut}/></div>}
                    {phasage && (
                      <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "rgba(255,255,255,0.6)", background: "rgba(0,0,0,0.45)", borderRadius: 5, padding: "2px 7px" }}>
                        {phasage.chantier_nom}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: "16px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: text }}>{chantier.nom}</div>

                    {av !== null ? (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: textSub }}>Avancement</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: av >= 100 ? "#50c878" : accent }}>{av}%</span>
                        </div>
                        <ProgressBar value={av}/>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: textSub, opacity: .5, fontStyle: "italic" }}>Pas de phasage créé</div>
                    )}

                    {fin && fin.prixVendu > 0 && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: textSub, marginBottom: 2 }}>Marché</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: text }}>{fmt(fin.prixVendu)}</div>
                        </div>
                        <div style={{ flex: 1, background: fin.marge >= 0 ? "rgba(80,200,120,0.08)" : "rgba(224,92,92,0.08)", borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: textSub, marginBottom: 2 }}>Marge</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: fin.marge >= 0 ? "#50c878" : "#e05c5c" }}>
                            {fmt(fin.marge)} <span style={{ fontSize: 10, opacity: .7 }}>({fin.margePct.toFixed(1)}%)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── VUE DÉTAILLÉE ───────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: "auto", background: bg }}>
      <style>{`
        .ch-stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 18px; }
        .ch-photo-upload:hover { border-color: ${accent} !important; background: rgba(255,195,0,0.06) !important; }
        .tache-row { border-bottom: 1px solid rgba(255,255,255,0.05); transition: background .12s; }
        .tache-row:hover { background: rgba(255,255,255,0.04); }
        .tache-row:last-child { border-bottom: none; }
        @media(max-width:768px) { .ch-fin-grid { grid-template-columns: 1fr 1fr !important; } .ch-content-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Header */}
      <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: "16px 28px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={() => { setSelected(null); setCompteRendus([]); }} style={{
          background: "rgba(255,255,255,0.07)", border: `1px solid ${border}`, borderRadius: 8,
          padding: "7px 14px", color: text, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
        }}>← Retour</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: text, margin: 0 }}>{selectedChantier?.nom || "Chantier"}</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {selectedPhasage ? (
              <>
                <StatutBadge statut={selectedPhasage.statut || "en_cours"}/>
                <span style={{ fontSize: 11, color: textSub }}>{selectedPhasage.chantier_nom}</span>
                {selectedPhasage.updated_at && (
                  <span style={{ fontSize: 11, color: textSub, opacity: .5 }}>
                    · Phasage mis à jour : {new Date(selectedPhasage.updated_at).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: textSub, opacity: .5, fontStyle: "italic" }}>Aucun phasage trouvé pour ce chantier</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Section 1 : Photo + avancement ── */}
        <div className="ch-content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>Photo du bâtiment</div>
            <div className="ch-photo-upload" style={{
              height: 240, borderRadius: 14, overflow: "hidden", position: "relative",
              border: `2px dashed ${border}`, cursor: "pointer", transition: "all .18s", background: "rgba(255,255,255,0.03)",
            }} onClick={() => fileInputRef.current?.click()}>
              {photoMap[selected] ? (
                <>
                  <img src={photoMap[selected]} alt="Bâtiment" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 14px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", display: "flex", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>✎ Modifier</span>
                  </div>
                </>
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  {uploading
                    ? <><span style={{ fontSize: 28 }}>⏳</span><span style={{ fontSize: 13, color: textSub }}>Upload…</span></>
                    : <><span style={{ fontSize: 36, opacity: .4 }}>📷</span><span style={{ fontSize: 13, color: textSub }}>Cliquer pour ajouter une photo</span><span style={{ fontSize: 11, color: textSub, opacity: .5 }}>JPG, PNG, WEBP</span></>
                  }
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoUpload(e, selected)}/>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase" }}>Avancement global</div>
            {selectedPhasage ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
                <AvancementCircle value={avancement} accent={accent}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: textSub, marginBottom: 8 }}>Détail par phase</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 170, overflowY: "auto" }}>
                    {PHASES.map(ph => {
                      const taches = selectedPhasage.plan_travaux?.[ph.id] || [];
                      if (taches.length === 0) return null;
                      const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
                      const av = totalH > 0
                        ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement)||0)*(parseFloat(t.heures_vendues)||0)),0)/totalH)
                        : Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement)||0), 0) / taches.length);
                      return (
                        <div key={ph.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: ph.couleur, flexShrink: 0 }}/>
                          <span style={{ fontSize: 11, color: textSub, minWidth: 140, flexShrink: 0 }}>{ph.label}</span>
                          <div style={{ flex: 1 }}><ProgressBar value={av} color={ph.couleur} height={5}/></div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: text, minWidth: 32, textAlign: "right" }}>{av}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: 30, textAlign: "center", color: textSub, fontSize: 13, background: card, borderRadius: 12, border: `1px solid ${border}` }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>📋</div>
                Aucun phasage lié à ce chantier.<br/>
                <span style={{ opacity: .6, fontSize: 12 }}>Créez-en un depuis la page Phasage.</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Section 2 : Finances ── */}
        {finances && finances.prixVendu > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>Finances du chantier</div>
            <div className="ch-fin-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {[
                { label: "Prix marché HT",    val: fmt(finances.prixVendu), color: text,       sub: "Vendu au client" },
                { label: "Coût main d'œuvre", val: fmt(finances.coutMO),   color: "#60a5fa",  sub: "Heures réelles" },
                { label: "Coût matériaux",    val: fmt(finances.coutMat),  color: "#f59e0b",  sub: "Matériaux" },
                { label: "Marge brute",       val: fmt(finances.marge),    color: finances.marge >= 0 ? "#50c878" : "#e05c5c", sub: `${finances.margePct.toFixed(1)}% du marché`, bold: true },
              ].map(s => (
                <div key={s.label} className="ch-stat-card">
                  <div style={{ fontSize: 11, color: textSub, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: s.bold ? 800 : 700, color: s.color, lineHeight: 1.2 }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: textSub, marginTop: 4, opacity: .7 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {finances.coutTotal > 0 && (
              <div style={{ marginTop: 12, background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: textSub, marginBottom: 8 }}>Décomposition du coût total ({fmt(finances.coutTotal)})</div>
                <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                  <div style={{ flex: finances.coutMO || 0.001, background: "#60a5fa" }}/>
                  <div style={{ flex: finances.coutMat || 0.001, background: "#f59e0b" }}/>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: "#60a5fa" }}>● Main d'œuvre {finances.coutTotal > 0 ? `${Math.round((finances.coutMO/finances.coutTotal)*100)}%` : ""}</span>
                  <span style={{ fontSize: 11, color: "#f59e0b" }}>● Matériaux {finances.coutTotal > 0 ? `${Math.round((finances.coutMat/finances.coutTotal)*100)}%` : ""}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 3 : Tâches + CRs ── */}
        <div className="ch-content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>Dernières tâches actives</div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, overflow: "hidden" }}>
              {lastTaches.length === 0 ? (
                <div style={{ padding: 28, textAlign: "center", color: textSub, fontSize: 13, opacity: .6 }}>
                  {selectedPhasage ? "Aucune tâche avec avancement." : "Créez un phasage pour ce chantier."}
                </div>
              ) : (
                lastTaches.map((t, i) => (
                  <div key={t.id || i} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.phaseCouleur, flexShrink: 0, display: "inline-block" }}/>
                      <span style={{ fontSize: 13, fontWeight: 600, color: text, flex: 1, lineHeight: 1.3 }}>{t.nom}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: parseFloat(t.avancement) >= 100 ? "#50c878" : accent, flexShrink: 0 }}>{parseFloat(t.avancement) || 0}%</span>
                    </div>
                    <ProgressBar value={parseFloat(t.avancement) || 0} color={t.phaseCouleur} height={4}/>
                    <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: textSub }}>{t.phaseLabel}</span>
                      {t.heures_vendues && <span style={{ fontSize: 10, color: textSub }}>· {t.heures_vendues}h vendues</span>}
                      {t.heures_reelles && <span style={{ fontSize: 10, color: "#f59e0b" }}>· {t.heures_reelles}h réelles</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>Derniers comptes rendus</div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, overflow: "hidden" }}>
              {loadingCR ? (
                <div style={{ padding: 28, textAlign: "center", color: textSub, fontSize: 13 }}>Chargement…</div>
              ) : compteRendus.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: textSub, fontSize: 13 }}>
                  <div style={{ opacity: .5, marginBottom: 8 }}>Aucun compte rendu trouvé.</div>
                  <div style={{ fontSize: 11, opacity: .4, lineHeight: 1.6 }}>
                    Dans la page "Compte rendu", renseignez<br/>
                    <strong style={{ color: text, opacity: .7 }}>{selectedChantier?.nom}</strong> dans le champ <em>Adresse</em><br/>
                    pour lier automatiquement les CRs à ce chantier.
                  </div>
                </div>
              ) : (
                compteRendus.map((cr, i) => (
                  <div key={cr.id || i} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: text }}>
                          {cr.date_visite ? new Date(cr.date_visite).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}
                        </span>
                        {cr.type_visite && (
                          <span style={{ fontSize: 10, color: textSub, background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "1px 6px" }}>{cr.type_visite}</span>
                        )}
                      </div>
                      {cr.avancement != null && (
                        <span style={{ fontSize: 11, color: accent, fontWeight: 700 }}>{cr.avancement}%</span>
                      )}
                    </div>
                    {cr.adresse && (
                      <div style={{ fontSize: 11, color: textSub, opacity: .5, marginBottom: 3 }}>📍 {cr.adresse}</div>
                    )}
                    {cr.resume && (
                      <p style={{ fontSize: 12, color: textSub, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {cr.resume}
                      </p>
                    )}
                    {cr.prochaine_etape && (
                      <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 5 }}>→ {cr.prochaine_etape}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Section 4 : Galerie ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: textSub, letterSpacing: 1.2, textTransform: "uppercase" }}>Photos du chantier</div>
            <span style={{ fontSize: 11, color: textSub, opacity: .4, fontStyle: "italic" }}>Bientôt : photos des équipes</span>
          </div>
          <div style={{ background: card, border: `2px dashed ${border}`, borderRadius: 14, padding: "36px 20px", textAlign: "center", color: textSub }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: .35 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Galerie des photos de chantier</div>
            <div style={{ fontSize: 12, opacity: .5 }}>
              Prochainement : les équipes pourront joindre des photos à leurs comptes rendus.<br/>
              Elles s'afficheront automatiquement ici.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Cercle d'avancement ──────────────────────────────────────────────────────
function AvancementCircle({ value, accent }) {
  const r    = 46;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(100, Math.max(0, value || 0));
  const dash = (pct / 100) * circ;
  const color = pct >= 100 ? "#50c878" : accent;
  return (
    <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9"/>
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
          style={{ transition: "stroke-dasharray .5s ease" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>avancement</span>
      </div>
    </div>
  );
}
