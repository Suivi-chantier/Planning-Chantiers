import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { COULEURS_PALETTE, THEMES, emptyCommande, getBranchAccent, FONT, RADIUS } from "./constants";
import { Icon } from "./ui";
import {
  Package, FileText, Plus, Pencil, Trash2, Check, X, ShoppingCart,
  ExternalLink, AlertTriangle, Search, Bell, User, Building2,
  Settings, ListChecks, Link2, LayoutList, Truck, Download, FileSpreadsheet, Printer,
} from "lucide-react";

// Statuts pour les commandes (hors besoin_ouvrier)
const STATUTS_CMD = {
  a_commander: { label: "À commander", color: "#f5a623", bg: "rgba(245,166,35,0.12)", border: "rgba(245,166,35,0.3)" },
  commande:    { label: "Commandé",    color: "#50c878", bg: "rgba(80,200,120,0.12)", border: "rgba(80,200,120,0.3)" },
  retire:      { label: "Retiré",      color: "#9aa5c0", bg: "rgba(154,165,192,0.10)", border: "rgba(154,165,192,0.2)" },
};

const P = {
  bg:       "#151929",
  surface:  "#1a1f35",
  card:     "#1e2540",
  border:   "rgba(255,255,255,0.08)",
  text:     "#e8eaf0",
  textSub:  "#9aa5c0",
  textMuted:"#6b7694",
  inputBg:  "#12162a",
};

const PHASES_LABELS = {
  demolition:     "Démolition",
  plomberie_ro:   "Réseaux plomberie (gros œuvre)",
  menuiserie:     "Menuiserie ext. & int.",
  feraillage:     "Feraillage cloisons & doublages",
  elec_vmc:       "Réseaux élec & VMC",
  placo:          "Lainage / Placo / Bandes & enduits",
  peinture_sols:  "Peintures & sols",
  finition_elec:  "Finitions électricité",
  finition_plomb: "Finitions plomberie",
  cuisine:        "Cuisine",
  finitions_gen:  "Finitions générales",
};

// ─── COMPOSANT SÉLECTEUR BIBLIOTHÈQUE ─────────────────────────────────────────
function BiblioSelector({ value, onChange, T, materiaux }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 320 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const dropW = 320;
      const left = rect.left + dropW > window.innerWidth
        ? window.innerWidth - dropW - 8
        : rect.left;
      setDropPos({ top: rect.bottom + 4, left, width: dropW });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = value ? materiaux.find(m => m.id === value) : null;
  const filtered = materiaux.filter(m => {
    const q = search.toLowerCase();
    return !q || m.nom?.toLowerCase().includes(q) || m.reference?.toLowerCase().includes(q) || m.fournisseur?.toLowerCase().includes(q);
  });

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button ref={btnRef} onClick={handleOpen} style={{
        background: selected ? "rgba(255,194,0,0.1)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${selected ? "rgba(255,194,0,0.4)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 7, padding: "5px 10px",
        color: selected ? "#FFC200" : (T?.textMuted || P.textMuted),
        fontFamily: "inherit", fontSize: 12, fontWeight: 700,
        cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        whiteSpace: "nowrap",
      }}>
        <Icon as={Package} size={12}/>
        {selected ? selected.nom.substring(0, 22) + (selected.nom.length > 22 ? "…" : "") : "Lier à la biblio."}
        {selected && (
          <span onClick={e => { e.stopPropagation(); onChange(null); }}
            style={{ marginLeft: 4, opacity: .6, cursor: "pointer", fontSize: 14 }}>×</span>
        )}
      </button>
      {open && (
        <div ref={dropRef} style={{
          position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
          maxHeight: 320, overflowY: "auto", background: "#1a1f35",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
          zIndex: 9999, boxShadow: "0 16px 40px rgba(0,0,0,0.7)",
        }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{
                background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 6,
                padding: "6px 10px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13,
                outline: "none", width: "100%", boxSizing: "border-box",
              }} />
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: P.textMuted }}>Aucun article trouvé</div>
          ) : filtered.map(m => (
            <div key={m.id} onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
              style={{
                padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)",
                cursor: "pointer", background: value === m.id ? "rgba(255,194,0,0.1)" : "transparent", transition: "background .1s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
              onMouseLeave={e => e.currentTarget.style.background = value === m.id ? "rgba(255,194,0,0.1)" : "transparent"}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaf0" }}>{m.nom}</div>
              <div style={{ fontSize: 11, color: P.textMuted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {m.reference && <span style={{ fontFamily: "monospace" }}>{m.reference}</span>}
                {m.fournisseur && <span>· {m.fournisseur}</span>}
                {m.prix_unitaire != null && (
                  <span style={{ color: "#50c878", fontWeight: 700 }}>
                    {parseFloat(m.prix_unitaire).toFixed(2)} € / {m.unite || "U"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SÉLECTEUR FAMILLE DEUX NIVEAUX ───────────────────────────────────────────
// Une "famille" = regroupement de tâches partageant le même ouvrage_libelle dans
// une phase. La valeur est encodée en string "phaseId|||ouvrageLibelle" pour le
// <select>, parsée en 2 callbacks au moment du change.
function FamilleSelector({ phasageId, phaseId, ouvrageLibelle, onChangePhasage, onChangeFamille, phasages, T, compact = false }) {
  const phasage = phasages.find(p => p.id === phasageId);
  // Construit la liste des familles uniques par phase (groupe par ouvrage_libelle)
  const familles = phasage?.plan_travaux
    ? Object.entries(phasage.plan_travaux)
        .filter(([k, v]) => k !== "meta" && Array.isArray(v))
        .flatMap(([phId, arr]) => {
          const seen = new Set();
          const out = [];
          arr.forEach(t => {
            const lib = (t.ouvrage_libelle || "").trim();
            if (!lib) return;
            const key = `${phId}|||${lib}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ phId, phLabel: PHASES_LABELS[phId] || phId, ouvrageLibelle: lib });
          });
          return out;
        })
    : [];

  const selStyle = {
    background: "#12162a", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 6,
    padding: compact ? "5px 8px" : "8px 10px", color: P.text,
    fontFamily: "inherit", fontSize: compact ? 12 : 13, outline: "none",
    width: "100%", boxSizing: "border-box",
  };

  const currentKey = phaseId && ouvrageLibelle ? `${phaseId}|||${ouvrageLibelle}` : "";
  const onSelectFamille = (e) => {
    const v = e.target.value;
    if (!v) { onChangeFamille("", ""); return; }
    const [pId, lib] = v.split("|||");
    onChangeFamille(pId, lib);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select value={phasageId || ""} onChange={e => { onChangePhasage(e.target.value); onChangeFamille("", ""); }} style={selStyle}>
        <option value="">— Chantier / Phasage —</option>
        {phasages.map(p => <option key={p.id} value={p.id}>{p.chantier_nom}</option>)}
      </select>
      {phasageId && (
        <select value={currentKey} onChange={onSelectFamille} style={selStyle}>
          <option value="">— Famille —</option>
          {familles.map(f => (
            <option key={`${f.phId}|||${f.ouvrageLibelle}`} value={`${f.phId}|||${f.ouvrageLibelle}`}>
              [{f.phLabel}] {f.ouvrageLibelle}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── MODALE IMPORT DOCUMENT ───────────────────────────────────────────────────
function ModaleImport({ onClose, onImport, materiaux, phasages, chantiers, T }) {
  const [step, setStep] = useState("upload"); // upload | analysing | validation
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState("");
  const [fournisseurGlobal, setFournisseurGlobal] = useState("");
  const [phasageGlobal, setPhasageGlobal] = useState("");
  const [phaseGlobale, setPhaseGlobale] = useState("");
  const [ouvrageGlobale, setOuvrageGlobale] = useState("");
  const [importing, setImporting] = useState(false);
  const dropRef = useRef(null);

  // Tenter un matching automatique biblio par nom/référence
  const tryMatchBiblio = (designation, reference) => {
    if (!designation && !reference) return null;
    const needle = (designation + " " + (reference || "")).toLowerCase().trim();
    let best = null, bestScore = 0;
    for (const m of materiaux) {
      const hay = (m.nom + " " + (m.reference || "")).toLowerCase();
      // Score simple : nombre de mots communs
      const wordsN = needle.split(/\s+/).filter(w => w.length > 2);
      const wordsH = hay.split(/\s+/).filter(w => w.length > 2);
      const common = wordsN.filter(w => wordsH.some(h => h.includes(w) || w.includes(h))).length;
      const score = wordsN.length > 0 ? common / wordsN.length : 0;
      if (score > bestScore && score >= 0.4) { bestScore = score; best = m; }
    }
    return best ? best.id : null;
  };

  const handleFile = (f) => {
    if (!f) return;
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(f.type)) {
      setErreur("Format non supporté. Utilise une image (JPG, PNG, WEBP) ou un PDF.");
      return;
    }
    setFile(f);
    setErreur("");
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const analyser = async () => {
    if (!file) return;
    setStep("analysing");
    setErreur("");
    try {
      // Lire le fichier en base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const mediaType = file.type === "application/pdf" ? "application/pdf" : file.type;

      const response = await fetch("https://yooksnzhlffqgpzkcjhl.supabase.co/functions/v1/analyse-commande", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });

      const data = await response.json();
      console.log("Réponse complète Edge Function:", JSON.stringify(data).substring(0, 500));
      if (!response.ok) throw new Error(data.error?.message || "Erreur Edge Function");

      // La Edge Function peut renvoyer la réponse Anthropic directement ou encapsulée
      const anthropicData = data.content ? data : (data.data || data);
      const textContent = anthropicData.content?.find(c => c.type === "text")?.text || "";
      let parsed;
      try {
        let clean = textContent.replace(/```json|```/g, "").trim();
        if (clean[0] !== "{") {
          const match = clean.match(/\{[\s\S]*\}/);
          if (match) clean = match[0];
        }
        parsed = JSON.parse(clean);
      } catch {
        console.error("Réponse brute IA:", textContent);
        throw new Error("Format de réponse inattendu. Réessaie ou utilise une image plus nette.");
      }

      if (!parsed.lignes || parsed.lignes.length === 0) {
        throw new Error("Aucune ligne de produit détectée. Vérifie que le document contient bien une liste de produits.");
      }

      // Pré-remplir fournisseur et tenter matching biblio
      if (parsed.fournisseur) setFournisseurGlobal(parsed.fournisseur);

      const lignesInit = parsed.lignes.map((l, idx) => ({
        _id: idx,
        selected: true,
        designation: l.designation || "",
        reference: l.reference || "",
        quantite: l.quantite || "",
        prix_unitaire: l.prix_unitaire ?? "",
        prix_total: l.prix_total ?? "",
        materiau_id: tryMatchBiblio(l.designation, l.reference),
        phasage_id: "",
        phase_id: "",
        ouvrage_libelle: "",
      }));

      setLignes(lignesInit);
      setStep("validation");
    } catch (err) {
      setErreur(err.message || "Erreur lors de l'analyse.");
      setStep("upload");
    }
  };

  // Appliquer chantier/famille globale à toutes les lignes sélectionnées
  const appliquerGlobal = () => {
    setLignes(prev => prev.map(l =>
      l.selected
        ? { ...l, phasage_id: phasageGlobal, phase_id: phaseGlobale, ouvrage_libelle: ouvrageGlobale }
        : l
    ));
  };

  const updateLigne = (idx, field, val) => {
    setLignes(prev => prev.map(l => l._id === idx ? { ...l, [field]: val } : l));
  };

  const handleImport = async () => {
    const toImport = lignes.filter(l => l.selected && l.designation.trim());
    if (toImport.length === 0) return;
    setImporting(true);
    await onImport(toImport, fournisseurGlobal);
    setImporting(false);
    onClose();
  };

  const nbSelected = lignes.filter(l => l.selected).length;

  const inpStyle = {
    background: "#12162a", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6, padding: "6px 8px", color: P.text,
    fontFamily: "inherit", fontSize: 12, outline: "none",
    width: "100%", boxSizing: "border-box",
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)", zIndex: 1000,
      }} />
      <div style={{
        position: "fixed", inset: 0, zIndex: 1001,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          background: P.surface, borderRadius: 18,
          border: `1px solid rgba(255,255,255,0.1)`,
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          width: "100%",
          maxWidth: step === "validation" ? 900 : 560,
          maxHeight: "90vh",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          transition: "max-width .3s ease",
        }} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div style={{
            padding: "20px 24px", borderBottom: `1px solid ${P.border}`,
            background: "rgba(91,156,246,0.08)",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(91,156,246,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
              }}>📄</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: P.text }}>
                  {step === "upload" && "Importer depuis un document"}
                  {step === "analysing" && "Analyse en cours…"}
                  {step === "validation" && `${lignes.length} produit${lignes.length > 1 ? "s" : ""} détecté${lignes.length > 1 ? "s" : ""}`}
                </div>
                <div style={{ fontSize: 12, color: "#5b9cf6", marginTop: 2 }}>
                  {step === "upload" && "Bon de commande, capture d'écran ou confirmation fournisseur"}
                  {step === "analysing" && "L'IA extrait les lignes du document…"}
                  {step === "validation" && "Vérifie, complète et importe les lignes"}
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: `1px solid ${P.border}`,
              borderRadius: 8, width: 34, height: 34, cursor: "pointer",
              color: P.textSub, fontSize: 20, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>

          {/* Contenu */}
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

            {/* ── ÉTAPE UPLOAD ── */}
            {step === "upload" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div
                  ref={dropRef}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  style={{
                    border: `2px dashed ${file ? "rgba(91,156,246,0.6)" : "rgba(255,255,255,0.15)"}`,
                    borderRadius: 14, padding: "40px 24px",
                    textAlign: "center", cursor: "pointer",
                    background: file ? "rgba(91,156,246,0.05)" : "rgba(255,255,255,0.02)",
                    transition: "all .2s",
                  }}
                  onClick={() => document.getElementById("import-file-input").click()}
                >
                  <input
                    id="import-file-input" type="file"
                    accept="image/*,.pdf" style={{ display: "none" }}
                    onChange={e => handleFile(e.target.files[0])}
                  />
                  {preview ? (
                    <div>
                      <img src={preview} alt="Aperçu" style={{
                        maxHeight: 200, maxWidth: "100%", borderRadius: 8,
                        marginBottom: 12, objectFit: "contain",
                      }} />
                      <div style={{ fontSize: 13, color: "#5b9cf6", fontWeight: 700 }}>{file.name}</div>
                    </div>
                  ) : file ? (
                    <div>
                      <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                      <div style={{ fontSize: 13, color: "#5b9cf6", fontWeight: 700 }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: P.textMuted, marginTop: 4 }}>
                        {(file.size / 1024).toFixed(0)} Ko
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: P.text, marginBottom: 6 }}>
                        Glisse ton document ici
                      </div>
                      <div style={{ fontSize: 13, color: P.textMuted }}>
                        ou clique pour sélectionner
                      </div>
                      <div style={{ fontSize: 11, color: P.textMuted, marginTop: 8 }}>
                        JPG · PNG · WEBP · PDF
                      </div>
                    </div>
                  )}
                </div>

                {erreur && (
                  <div style={{
                    background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.30)",
                    borderRadius: RADIUS.md, padding: "9px 14px", fontSize: FONT.sm.size, color: "#e15a5a",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}>
                    <Icon as={AlertTriangle} size={14}/>
                    {erreur}
                  </div>
                )}

                {file && (
                  <button onClick={analyser} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                    padding: "12px 0", borderRadius: 10, border: "none",
                    background: "#5b9cf6", color: "#fff",
                    fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer",
                  }}>
                    <Icon as={Search} size={16}/>
                    Analyser le document
                  </button>
                )}
              </div>
            )}

            {/* ── ÉTAPE ANALYSE ── */}
            {step === "analysing" && (
              <div style={{
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 20, padding: "40px 0",
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: "rgba(91,156,246,0.15)",
                  color: "#5b9cf6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  animation: "spin 2s linear infinite",
                }}>
                  <Icon as={Search} size={32}/>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: P.text, marginBottom: 6 }}>
                    Analyse en cours…
                  </div>
                  <div style={{ fontSize: 13, color: P.textMuted }}>
                    L'IA lit le document et extrait les lignes de produits
                  </div>
                </div>
              </div>
            )}

            {/* ── ÉTAPE VALIDATION ── */}
            {step === "validation" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* En-tête global */}
                <div style={{
                  background: P.card, borderRadius: 12,
                  border: "1px solid rgba(91,156,246,0.2)",
                  padding: "16px 18px",
                }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#5b9cf6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                    <Icon as={Settings} size={12}/>
                    Paramètres globaux — appliqués à toutes les lignes sélectionnées
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
                    <div>
                      <div style={{ fontSize: 11, color: P.textMuted, marginBottom: 5, fontWeight: 600 }}>Fournisseur</div>
                      <input
                        value={fournisseurGlobal}
                        onChange={e => setFournisseurGlobal(e.target.value)}
                        placeholder="Nom du fournisseur"
                        style={{
                          background: "#12162a", border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 7, padding: "8px 10px", color: P.text,
                          fontFamily: "inherit", fontSize: 13, outline: "none",
                          width: "100%", boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: P.textMuted, marginBottom: 5, fontWeight: 600 }}>Plan de travail par défaut</div>
                      <FamilleSelector
                        phasageId={phasageGlobal}
                        phaseId={phaseGlobale}
                        ouvrageLibelle={ouvrageGlobale}
                        onChangePhasage={setPhasageGlobal}
                        onChangeFamille={(p, l) => { setPhaseGlobale(p); setOuvrageGlobale(l); }}
                        phasages={phasages}
                        T={T}
                        compact
                      />
                    </div>
                  </div>
                  {(phasageGlobal || fournisseurGlobal) && (
                    <button onClick={appliquerGlobal} style={{
                      marginTop: 10, padding: "7px 14px", borderRadius: 7,
                      border: "1px solid rgba(91,156,246,0.4)",
                      background: "rgba(91,156,246,0.1)", color: "#5b9cf6",
                      fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>
                      ↓ Appliquer à toutes les lignes sélectionnées
                    </button>
                  )}
                </div>

                {/* Sélectionner tout / aucun */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => setLignes(p => p.map(l => ({ ...l, selected: true })))}
                    style={{ background: "transparent", border: `1px solid ${P.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, color: P.textSub, cursor: "pointer", fontFamily: "inherit" }}>
                    Tout sélectionner
                  </button>
                  <button onClick={() => setLignes(p => p.map(l => ({ ...l, selected: false })))}
                    style={{ background: "transparent", border: `1px solid ${P.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, color: P.textSub, cursor: "pointer", fontFamily: "inherit" }}>
                    Tout décocher
                  </button>
                  <span style={{ fontSize: 12, color: P.textMuted }}>
                    {nbSelected} ligne{nbSelected > 1 ? "s" : ""} sélectionnée{nbSelected > 1 ? "s" : ""}
                  </span>
                </div>

                {/* Tableau des lignes */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {lignes.map((l) => {
                    const matLie = l.materiau_id ? materiaux.find(m => m.id === l.materiau_id) : null;
                    return (
                      <div key={l._id} style={{
                        background: l.selected ? P.card : "rgba(255,255,255,0.02)",
                        border: `1px solid ${l.selected ? "rgba(91,156,246,0.25)" : P.border}`,
                        borderRadius: 10, padding: "12px 14px",
                        opacity: l.selected ? 1 : 0.45,
                        transition: "all .15s",
                      }}>
                        {/* Ligne 1 : checkbox + désignation + référence + qté + prix */}
                        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 100px 80px 90px", gap: 8, alignItems: "start", marginBottom: 8 }}>
                          <input type="checkbox" checked={l.selected}
                            onChange={e => updateLigne(l._id, "selected", e.target.checked)}
                            style={{ width: 16, height: 16, marginTop: 6, cursor: "pointer", accentColor: "#5b9cf6" }} />
                          <div>
                            <input value={l.designation} onChange={e => updateLigne(l._id, "designation", e.target.value)}
                              placeholder="Désignation"
                              style={{ ...inpStyle, fontWeight: 700, fontSize: 13, marginBottom: 3 }} />
                            {l.reference && (
                              <div style={{ fontSize: 11, color: P.textMuted, fontFamily: "monospace" }}>{l.reference}</div>
                            )}
                          </div>
                          <input value={l.quantite} onChange={e => updateLigne(l._id, "quantite", e.target.value)}
                            placeholder="Qté"
                            style={inpStyle} />
                          <input value={l.prix_unitaire} onChange={e => updateLigne(l._id, "prix_unitaire", e.target.value)}
                            placeholder="PU HT €" type="number" min="0" step="0.01"
                            style={{ ...inpStyle, color: "#50c878" }} />
                          <input value={l.prix_total} onChange={e => updateLigne(l._id, "prix_total", e.target.value)}
                            placeholder="Total HT €" type="number" min="0" step="0.01"
                            style={{ ...inpStyle, color: "#50c878" }} />
                        </div>
                        {/* Ligne 2 : biblio + tâche */}
                        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr", gap: 8, paddingLeft: 0 }}>
                          <div />
                          <div>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: P.textMuted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>
                              <Icon as={Package} size={11}/>
                              Article bibliothèque {matLie && <span style={{ color: "#FFC200" }}>· {matLie.nom.substring(0, 18)}</span>}
                            </div>
                            <BiblioSelector
                              value={l.materiau_id}
                              onChange={mId => updateLigne(l._id, "materiau_id", mId)}
                              T={{ textMuted: P.textMuted }}
                              materiaux={materiaux}
                            />
                          </div>
                          <div>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: P.textMuted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>
                              <Icon as={ListChecks} size={11}/>
                              Plan de travail
                            </div>
                            <FamilleSelector
                              phasageId={l.phasage_id}
                              phaseId={l.phase_id}
                              ouvrageLibelle={l.ouvrage_libelle}
                              onChangePhasage={v => updateLigne(l._id, "phasage_id", v)}
                              onChangeFamille={(p, lib) => { updateLigne(l._id, "phase_id", p); updateLigne(l._id, "ouvrage_libelle", lib); }}
                              phasages={phasages}
                              T={T}
                              compact
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {step === "validation" && (
            <div style={{
              padding: "14px 24px", borderTop: `1px solid ${P.border}`,
              display: "flex", gap: 10, justifyContent: "space-between",
              alignItems: "center", background: P.surface, flexShrink: 0,
            }}>
              <button onClick={() => { setStep("upload"); setLignes([]); setFile(null); setPreview(null); }}
                style={{
                  padding: "9px 16px", borderRadius: 8, border: `1px solid ${P.border}`,
                  background: "transparent", color: P.textSub,
                  fontFamily: "inherit", fontSize: 13, cursor: "pointer",
                }}>← Reprendre</button>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: P.textMuted }}>
                  {nbSelected} ligne{nbSelected > 1 ? "s" : ""} à importer
                </span>
                <button onClick={handleImport} disabled={nbSelected === 0 || importing} style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: nbSelected > 0 ? "#50c878" : "rgba(80,200,120,0.2)",
                  color: nbSelected > 0 ? "#111" : P.textMuted,
                  fontFamily: "inherit", fontSize: 14, fontWeight: 800,
                  cursor: nbSelected > 0 ? "pointer" : "not-allowed",
                }}>
                  {importing ? "Import…" : `✓ Importer ${nbSelected} ligne${nbSelected > 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── PANNEAU DEMANDES ─────────────────────────────────────────────────────────
function PanneauDemandes({ demandes, chantiers, T, onClose, onConvertir, onSupprimer, materiaux }) {
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    const init = {};
    demandes.forEach(d => {
      init[d.id] = {
        article:       d.article      || "",
        fournisseur:   d.fournisseur  || "",
        quantite:      d.quantite     || "",
        notes:         d.notes        || "",
        priorite:      d.priorite     || "normal",
        chantier_id:   d.chantier_id  || "",
        materiau_id:   d.materiau_id  || null,
      };
    });
    setDrafts(init);
  }, [demandes]);

  const set = (id, field, val) =>
    setDrafts(p => ({ ...p, [id]: { ...p[id], [field]: val } }));

  const handleSelectMateriau = (demId, mId) => {
    if (!mId) { set(demId, "materiau_id", null); return; }
    const mat = materiaux.find(m => m.id === mId);
    if (mat) {
      setDrafts(p => ({
        ...p,
        [demId]: { ...p[demId], materiau_id: mId, fournisseur: mat.fournisseur || p[demId].fournisseur },
      }));
    }
  };

  const inp = (highlight) => ({
    background: P.inputBg,
    border: `1px solid ${highlight ? "rgba(224,92,92,0.5)" : P.border}`,
    borderRadius: 7, padding: "7px 10px", color: P.text,
    fontFamily: "inherit", fontSize: 13, outline: "none",
    width: "100%", boxSizing: "border-box",
  });

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)", zIndex: 800,
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(520px, 100vw)", height: "100vh",
        background: P.surface, borderLeft: `1px solid ${P.border}`,
        zIndex: 801, display: "flex", flexDirection: "column",
        overflow: "hidden", boxShadow: "-24px 0 80px rgba(0,0,0,0.6)",
        animation: "slideIn .25s cubic-bezier(.22,1,.36,1)",
      }}>
        <div style={{
          padding: "20px 24px", borderBottom: `1px solid ${P.border}`,
          background: "rgba(176,96,255,0.10)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(176,96,255,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
              }}>📋</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: P.text }}>Demandes ouvriers</div>
                <div style={{ fontSize: 12, color: "#b060ff", fontWeight: 600, marginTop: 2 }}>
                  {demandes.length} demande{demandes.length > 1 ? "s" : ""} en attente
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: `1px solid ${P.border}`,
              borderRadius: 8, width: 34, height: 34, cursor: "pointer",
              color: P.textSub, fontSize: 20, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: "auto",
          padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14,
        }}>
          {demandes.length === 0 ? (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 12, color: P.textMuted, fontSize: 14, paddingTop: 60,
            }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontWeight: 600 }}>Aucune demande en attente</div>
            </div>
          ) : demandes.map(d => {
            const ch    = chantiers.find(c => c.id === d.chantier_id);
            const draft = drafts[d.id] || {};
            const urgent = d.priorite === "urgent";
            const dateD  = d.created_at
              ? new Date(d.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
              : "—";
            const heureD = d.created_at
              ? new Date(d.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
              : "";

            return (
              <div key={d.id} style={{
                background: P.card,
                border: `1px solid ${urgent ? "rgba(224,92,92,0.45)" : "rgba(176,96,255,0.3)"}`,
                borderRadius: 14, flexShrink: 0,
              }}>
                <div style={{
                  padding: "10px 14px",
                  background: urgent ? "rgba(224,92,92,0.10)" : "rgba(176,96,255,0.09)",
                  borderBottom: `1px solid ${P.border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {ch && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: ch.couleur, display: "block" }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{ch.nom}</span>
                      </span>
                    )}
                    {d.ouvrier_demandeur && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 11, fontWeight: 700, color: "#a0b8ff",
                        background: "rgba(160,184,255,0.14)", borderRadius: 5, padding: "2px 7px",
                      }}><Icon as={User} size={10}/> {d.ouvrier_demandeur}</span>
                    )}
                    {urgent && (
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: "#e05c5c",
                        background: "rgba(224,92,92,0.15)", borderRadius: 5,
                        padding: "2px 7px", border: "1px solid rgba(224,92,92,0.3)",
                      }}>🔴 URGENT</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: P.textMuted, whiteSpace: "nowrap" }}>{dateD} {heureD}</span>
                    <button onClick={() => onSupprimer(d.id)} title="Supprimer cette demande" style={{
                      background: "rgba(224,92,92,0.12)", border: "1px solid rgba(224,92,92,0.25)",
                      borderRadius: 6, width: 26, height: 26, cursor: "pointer", color: "#e05c5c",
                      fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all .15s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(224,92,92,0.28)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(224,92,92,0.12)"}
                    >🗑</button>
                  </div>
                </div>

                <div style={{
                  padding: "10px 14px", borderBottom: `1px solid ${P.border}`,
                  background: "rgba(255,255,255,0.02)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Demande brute</div>
                  <div style={{ fontSize: 13, color: "#c8b0ff", fontStyle: "italic" }}>
                    « {d.article || "—"} »
                    {d.quantite && <span style={{ color: P.textSub }}> · {d.quantite}</span>}
                  </div>
                  {d.notes && <div style={{ fontSize: 12, color: P.textMuted, marginTop: 4 }}>{d.notes}</div>}
                </div>

                <div style={{ padding: "8px 14px", borderBottom: `1px solid ${P.border}`, background: "rgba(255,194,0,0.03)" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                    <Icon as={Package} size={11}/>
                    Lier à un article de la bibliothèque
                  </div>
                  <BiblioSelector
                    value={draft.materiau_id || null}
                    onChange={mId => handleSelectMateriau(d.id, mId)}
                    T={{ textMuted: P.textMuted, text: P.text }}
                    materiaux={materiaux}
                  />
                </div>

                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>↳ Convertir en commande</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input value={draft.article || ""} onChange={e => set(d.id, "article", e.target.value)}
                      placeholder="Article exact *" style={inp(!draft.article)} />
                    <input value={draft.fournisseur || ""} onChange={e => set(d.id, "fournisseur", e.target.value)}
                      placeholder="Fournisseur" style={inp(false)} />
                    <input value={draft.quantite || ""} onChange={e => set(d.id, "quantite", e.target.value)}
                      placeholder="Quantité" style={inp(false)} />
                    <select value={draft.priorite || "normal"} onChange={e => set(d.id, "priorite", e.target.value)}
                      style={{ ...inp(false), color: draft.priorite === "urgent" ? "#e05c5c" : "#c0a060", fontWeight: 700 }}>
                      <option value="normal" style={{ background: "#1e2540" }}>🟡 Normal</option>
                      <option value="urgent" style={{ background: "#1e2540" }}>🔴 Urgent</option>
                    </select>
                  </div>
                  <input value={draft.notes || ""} onChange={e => set(d.id, "notes", e.target.value)}
                    placeholder="Notes additionnelles" style={inp(false)} />
                  <button onClick={() => onConvertir(d, draft)} disabled={!draft.article?.trim()} style={{
                    marginTop: 2, padding: "9px 0",
                    background: draft.article?.trim() ? "#b060ff" : "rgba(176,96,255,0.15)",
                    border: `1px solid ${draft.article?.trim() ? "#b060ff" : "rgba(176,96,255,0.2)"}`,
                    borderRadius: 8,
                    color: draft.article?.trim() ? "#fff" : P.textMuted,
                    fontFamily: "inherit", fontSize: 13, fontWeight: 800,
                    cursor: draft.article?.trim() ? "pointer" : "not-allowed",
                    transition: "all .15s", width: "100%",
                  }}>✓ Valider comme commande</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── BOUTON DEMANDES FLOTTANT ─────────────────────────────────────────────────
function BoutonDemandes({ count, onClick, T, acc }) {
  const hasNew = count > 0;
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      {hasNew && (
        <span style={{
          position: "absolute", inset: 0, borderRadius: RADIUS.md,
          border: "2px solid #e15a5a",
          animation: "pulseRing 1.6s ease-out infinite",
          pointerEvents: "none",
        }} />
      )}
      <button onClick={onClick} style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: hasNew ? "rgba(225,90,90,0.12)" : "transparent",
        border: `1px solid ${hasNew ? "rgba(225,90,90,0.50)" : T.border}`,
        borderRadius: RADIUS.md, padding: "8px 14px",
        fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600,
        color: hasNew ? "#e15a5a" : T.textSub,
        cursor: "pointer",
        transition: "border-color .12s, color .12s",
        position: "relative",
      }}>
        <Icon as={Bell} size={14}/>
        Demandes ouvriers
        {hasNew && (
          <span style={{
            background: "#e15a5a", color: "#fff", borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, padding: "1px 7px",
            minWidth: 20, textAlign: "center",
            animation: "badgePulse 1.2s ease-in-out infinite",
          }}>{count}</span>
        )}
      </button>
    </div>
  );
}

// ─── VUE GROUPÉE (par fournisseur ou par chantier) ────────────────────────────
function VueGroupee({ commandes, groupBy, chantiers, materiaux, T, acc, onEditRow }) {
  // Construit les groupes
  const groupes = {};
  commandes.forEach(r => {
    let key, label, couleur;
    if (groupBy === "fournisseur") {
      key = r.fournisseur || "_sans";
      label = r.fournisseur || "Sans fournisseur";
      couleur = null;
    } else {
      key = r.chantier_id || "_sans";
      const ch = chantiers.find(c => c.id === r.chantier_id);
      label = ch?.nom || "Sans chantier";
      couleur = ch?.couleur;
    }
    if (!groupes[key]) groupes[key] = { key, label, couleur, items: [], total: 0 };
    groupes[key].items.push(r);
    groupes[key].total += parseFloat(r.prix_ht) || 0;
  });
  // Trie : non commandés d'abord (plus de "à commander"), puis alphabétique
  const ordre = Object.values(groupes).sort((a, b) => {
    const ac = a.items.filter(i => i.statut === "a_commander").length;
    const bc = b.items.filter(i => i.statut === "a_commander").length;
    if (ac !== bc) return bc - ac;
    return a.label.localeCompare(b.label);
  });

  if (ordre.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
        Aucune commande dans cette vue.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {ordre.map(g => {
        const aCmd  = g.items.filter(i => i.statut === "a_commander").length;
        const cmd   = g.items.filter(i => i.statut === "commande").length;
        const ret   = g.items.filter(i => i.statut === "retire").length;
        return (
          <div key={g.key} style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.xl, overflow: "hidden",
            borderLeft: g.couleur ? `4px solid ${g.couleur}` : `1px solid ${T.border}`,
          }}>
            {/* Header du groupe */}
            <div style={{
              padding: "12px 18px", borderBottom: `1px solid ${T.border}`,
              background: T.card,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              {g.couleur && (
                <span style={{ width: 12, height: 12, borderRadius: 3, background: g.couleur }}/>
              )}
              {!g.couleur && (
                <Icon as={Truck} size={16} color={T.textSub}/>
              )}
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>{g.label}</div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>
                  {g.items.length} article{g.items.length > 1 ? "s" : ""}
                  {g.total > 0 && ` · ${g.total.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} € HT`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {aCmd > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "rgba(245,166,35,0.12)", color: "#f5a623",
                    border: "1px solid rgba(245,166,35,0.30)",
                    borderRadius: RADIUS.pill, padding: "2px 9px",
                    fontSize: FONT.xs.size, fontWeight: 700,
                  }}>{aCmd} à commander</span>
                )}
                {cmd > 0 && (
                  <span style={{
                    background: "rgba(34,197,94,0.12)", color: "#22c55e",
                    border: "1px solid rgba(34,197,94,0.30)",
                    borderRadius: RADIUS.pill, padding: "2px 9px",
                    fontSize: FONT.xs.size, fontWeight: 700,
                  }}>{cmd} commandé{cmd > 1 ? "s" : ""}</span>
                )}
                {ret > 0 && (
                  <span style={{
                    background: "rgba(154,165,192,0.10)", color: "#9aa5c0",
                    border: "1px solid rgba(154,165,192,0.25)",
                    borderRadius: RADIUS.pill, padding: "2px 9px",
                    fontSize: FONT.xs.size, fontWeight: 700,
                  }}>{ret} retiré{ret > 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            {/* Items */}
            <div>
              {g.items.map(r => {
                const statut = STATUTS_CMD[r.statut] || STATUTS_CMD.a_commander;
                const matLie = r.materiau_id && materiaux.find(m => m.id === r.materiau_id);
                const ch = chantiers.find(c => c.id === r.chantier_id);
                return (
                  <div key={r.id} onClick={() => onEditRow(r)} className="tache-row" style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 18px",
                    borderBottom: `1px solid ${T.sectionDivider || T.border}`,
                    cursor: "pointer",
                  }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: "50%",
                      background: statut.color, flexShrink: 0,
                    }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, color: T.text, lineHeight: 1.3 }}>
                        {r.article || "—"}
                        {r.quantite && (
                          <span style={{ color: T.textMuted, fontWeight: 500, marginLeft: 6 }}>× {r.quantite}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                        {groupBy === "fournisseur" && ch && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: ch.couleur }}/>
                            {ch.nom}
                          </span>
                        )}
                        {groupBy === "chantier" && r.fournisseur && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <Icon as={Truck} size={10}/>
                            {r.fournisseur}
                          </span>
                        )}
                        {matLie && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#FFC200", fontWeight: 600 }}>
                            <Icon as={Package} size={10}/>
                            {matLie.reference || matLie.nom.substring(0, 22)}
                          </span>
                        )}
                        {r.priorite === "urgent" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#e15a5a", fontWeight: 700 }}>
                            <Icon as={AlertTriangle} size={10}/>
                            Urgent
                          </span>
                        )}
                        {r.ouvrier_demandeur && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <Icon as={User} size={10}/>
                            {r.ouvrier_demandeur}
                          </span>
                        )}
                      </div>
                      {r.notes && (
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2, opacity: .8 }}>
                          {r.notes}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center",
                        background: statut.bg, color: statut.color,
                        border: `1px solid ${statut.border}`,
                        borderRadius: RADIUS.pill, padding: "2px 9px",
                        fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .3, textTransform: "uppercase",
                      }}>{statut.label}</div>
                      {r.prix_ht > 0 && (
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: "#22c55e", marginTop: 4 }}>
                          {parseFloat(r.prix_ht).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── PAGE COMMANDES ───────────────────────────────────────────────────────────
function PageCommandes({ chantiers, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [rows, setRows] = useState([]);
  const [materiaux, setMateriaux] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterChantier, setFilterChantier] = useState("all");
  const [filterStatut, setFilterStatut] = useState("all");
  const [filterOuvrier, setFilterOuvrier] = useState("all");
  // viewMode : 'liste' | 'fournisseur' | 'chantier'
  const [viewMode, setViewMode] = useState("liste");
  const [editRow, setEditRow] = useState(null);
  const [newRow, setNewRow] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [modaleCommande, setModaleCommande] = useState(null);
  const [phasages, setPhasages] = useState([]);
  const [modalePrix, setModalePrix] = useState("");
  // Note : modalePhaseId est l'ID du PHASAGE (chantier), pas la phase interne.
  // Naming legacy conservé pour minimiser le diff. modalePhaseInterne et
  // modaleOuvrageLibelle pointent vers la famille (= ouvrage dans la phase).
  const [modalePhaseId, setModalePhaseId] = useState("");
  const [modalePhaseInterne, setModalePhaseInterne] = useState("");
  const [modaleOuvrageLibelle, setModaleOuvrageLibelle] = useState("");
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [modaleImport, setModaleImport] = useState(false);

  const isDemande = (r) => r.statut === "besoin_ouvrier" || r.statut === "besoin ouvrier" || r.statut === "besoin_ouvriers";
  const demandes = rows.filter(isDemande);
  const commandes = rows.filter(r => !isDemande(r));

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("commandes_detail").select("*").order("created_at", { ascending: true });
    if (data) {
      setRows(prev => data.map(row => {
        if (row.materiau_id != null) return row;
        const existing = prev.find(p => p.id === row.id);
        if (existing?.materiau_id) return { ...row, materiau_id: existing.materiau_id };
        return row;
      }));
    } else setRows([]);
    setLoading(false);
  };

  const loadMateriaux = async () => {
    const { data } = await supabase.from("materiaux_bibliotheque").select("*").order("nom");
    setMateriaux(data || []);
  };

  useEffect(() => {
    load();
    loadMateriaux();
    supabase.from("phasages").select("id,chantier_nom,plan_travaux").then(({ data }) => setPhasages(data || []));
  }, []);

  useEffect(() => {
    const ch = supabase.channel("commandes-detail")
      .on("postgres_changes", { event: "*", schema: "public", table: "commandes_detail" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // ─── MIGRATION AUTO : tache_id → (phase_id, ouvrage_libelle) ────────────────
  // Migre les anciennes commandes liées à une tâche spécifique vers la nouvelle
  // logique de liaison à une famille (= ouvrage). One-shot par session, idempotent.
  // Tourne tant que la colonne tache_id existe encore en base. Une fois le SQL
  // de cleanup exécuté (DROP COLUMN tache_id), `r.tache_id` sera toujours
  // undefined → la migration ne fait simplement rien.
  // SQL pré-requis : ALTER TABLE commandes_detail ADD COLUMN IF NOT EXISTS phase_id TEXT;
  //                  ALTER TABLE commandes_detail ADD COLUMN IF NOT EXISTS ouvrage_libelle TEXT;
  const migrationRef = useRef(false);
  useEffect(() => {
    if (migrationRef.current) return;
    if (!rows.length || !phasages.length) return;
    const aMigrer = rows.filter(r => r.tache_id && !r.phase_id);
    if (aMigrer.length === 0) { migrationRef.current = true; return; }
    migrationRef.current = true;
    (async () => {
      let nbOk = 0, nbErr = 0, schemaMissing = false;
      for (const cmd of aMigrer) {
        const phasage = phasages.find(p => p.id === cmd.phasage_id);
        if (!phasage?.plan_travaux) continue;
        let phaseId = null, ouvrageLibelle = null;
        for (const [pId, taches] of Object.entries(phasage.plan_travaux)) {
          if (pId === "meta" || !Array.isArray(taches)) continue;
          const tache = taches.find(t => t.id === cmd.tache_id);
          if (tache) { phaseId = pId; ouvrageLibelle = tache.ouvrage_libelle || ""; break; }
        }
        if (!phaseId) continue;
        const { error } = await supabase.from("commandes_detail")
          .update({ phase_id: phaseId, ouvrage_libelle: ouvrageLibelle })
          .eq("id", cmd.id);
        if (error?.code === "42703") {
          schemaMissing = true;
          console.warn("[Migration commandes] Colonnes phase_id/ouvrage_libelle manquantes en base. SQL requise :\n" +
            "  ALTER TABLE commandes_detail ADD COLUMN IF NOT EXISTS phase_id TEXT;\n" +
            "  ALTER TABLE commandes_detail ADD COLUMN IF NOT EXISTS ouvrage_libelle TEXT;");
          break;
        }
        if (error) { nbErr++; console.error("[Migration commandes] Erreur sur", cmd.id, error); }
        else nbOk++;
      }
      if (!schemaMissing && nbOk > 0) {
        console.log(`[Migration commandes] ${nbOk} ligne(s) migrée(s)${nbErr > 0 ? `, ${nbErr} erreur(s)` : ""}.`);
        load(); // refresh pour récupérer les nouvelles valeurs
      }
    })();
  }, [rows, phasages]);

  // ── IMPORT DEPUIS DOCUMENT ──────────────────────────────────────────────────
  const handleImportLignes = async (lignes, fournisseurGlobal) => {
    for (const l of lignes) {
      const fields = {
        article:         l.designation.trim(),
        fournisseur:     fournisseurGlobal.trim() || "",
        quantite:        l.quantite || "",
        prix_ht:         parseFloat(l.prix_total) || parseFloat(l.prix_unitaire) || null,
        statut:          "commande",
        priorite:        "normal",
        materiau_id:     l.materiau_id || null,
        phasage_id:      l.phasage_id || null,
        phase_id:        l.phase_id || null,
        ouvrage_libelle: l.ouvrage_libelle || null,
        notes:           l.reference ? `Réf: ${l.reference}` : "",
      };

      const { error } = await supabase.from("commandes_detail").insert(fields);
      if (error) {
        // Fallback sans colonnes optionnelles si migration manquante
        if (error.code === "42703") {
          const { materiau_id, phasage_id, phase_id, ouvrage_libelle, ...fallback } = fields;
          await supabase.from("commandes_detail").insert(fallback);
        }
      }
      // Note : on n'écrit plus cout_materiel sur les tâches. Le coût mat est
      // désormais agrégé dynamiquement au niveau famille dans le Plan de travaux.
    }
    load();
  };

  const handleSelectMateriau = (mId) => {
    if (!mId) { setEditDraft(p => ({ ...p, materiau_id: null })); return; }
    const mat = materiaux.find(m => m.id === mId);
    if (mat) setEditDraft(p => ({ ...p, materiau_id: mId, fournisseur: mat.fournisseur || p.fournisseur || "" }));
  };

  const supprimerDemande = async (id) => {
    if (!confirm("Supprimer cette demande ? Elle sera définitivement supprimée.")) return;
    await supabase.from("commandes_detail").delete().eq("id", id);
    setRows(prev => prev.filter(r => r.id !== id));
    if (demandes.filter(d => d.id !== id).length === 0) setPanneauOuvert(false);
  };

  const convertirDemande = async (demande, draft) => {
    const updates = {
      article:      draft.article?.trim() || demande.article,
      fournisseur:  draft.fournisseur?.trim() || "",
      quantite:     draft.quantite?.trim() || demande.quantite,
      notes:        draft.notes?.trim() || demande.notes,
      priorite:     draft.priorite || "normal",
      statut:       "a_commander",
      materiau_id:  draft.materiau_id || null,
    };
    await supabase.from("commandes_detail").update(updates).eq("id", demande.id);
    setRows(prev => prev.map(r => r.id === demande.id ? { ...r, ...updates } : r));
    if (demandes.length <= 1) setPanneauOuvert(false);
  };

  const saveRow = async (row) => {
    setEditRow(null); setNewRow(null); setEditDraft(null);
    const allFields = {
      chantier_id:       row.chantier_id       ?? "",
      article:           row.article           ?? "",
      fournisseur:       row.fournisseur       ?? "",
      quantite:          row.quantite          ?? "",
      statut:            row.statut            ?? "a_commander",
      notes:             row.notes             ?? "",
      priorite:          row.priorite          ?? "normal",
      ouvrier_demandeur: row.ouvrier_demandeur ?? "",
      materiau_id:       row.materiau_id       ?? null,
    };
    if (row.id) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...allFields } : r));
      const { error } = await supabase.from("commandes_detail").update(allFields).eq("id", row.id);
      if (error) {
        if (error.message?.includes("materiau_id") || error.code === "42703") {
          const { materiau_id, ...fieldsWithout } = allFields;
          await supabase.from("commandes_detail").update(fieldsWithout).eq("id", row.id);
        } else { alert("Erreur sauvegarde: " + error.message); load(); return; }
      }
    } else {
      const { error } = await supabase.from("commandes_detail").insert(allFields).select().single();
      if (error) {
        if (error.message?.includes("materiau_id") || error.code === "42703") {
          const { materiau_id, ...fieldsWithout } = allFields;
          await supabase.from("commandes_detail").insert(fieldsWithout).select().single();
        } else { alert("Erreur création: " + error.message); load(); return; }
      }
    }
    load();
  };

  const deleteRow = async (id) => {
    if (!confirm("Supprimer cette ligne ?")) return;
    await supabase.from("commandes_detail").delete().eq("id", id);
    load();
  };

  // ── Export CSV (Excel) ──────────────────────────────────────────────────────
  const exporterCSV = () => {
    const escapeCSV = (val) => {
      const s = String(val ?? "");
      if (s.includes(";") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const headers = ["Chantier", "Article", "Fournisseur", "Référence", "Quantité", "Prix HT", "Statut", "Priorité", "Ouvrier", "Notes", "Date création"];
    const rows = commandes.map(r => {
      const ch = chantiers.find(c => c.id === r.chantier_id);
      const mat = r.materiau_id && materiaux.find(m => m.id === r.materiau_id);
      const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString("fr-FR") : "";
      return [
        ch?.nom || "", r.article || "", r.fournisseur || "",
        mat?.reference || "", r.quantite || "",
        r.prix_ht ? parseFloat(r.prix_ht).toFixed(2) : "",
        STATUTS_CMD[r.statut]?.label || r.statut,
        r.priorite === "urgent" ? "Urgent" : "Normal",
        r.ouvrier_demandeur || "", r.notes || "", dateStr,
      ].map(escapeCSV).join(";");
    });
    const csv = "﻿" + [headers.join(";"), ...rows].join("\r\n"); // BOM pour Excel FR
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    a.href = url;
    a.download = `commandes_${now.toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── Export PDF (via window.print) ──────────────────────────────────────────
  const exporterPDF = () => {
    const filtreLabel = [
      filterChantier !== "all" && `Chantier : ${chantiers.find(c => c.id === filterChantier)?.nom || filterChantier}`,
      filterStatut !== "all" && `Statut : ${STATUTS_CMD[filterStatut]?.label || filterStatut}`,
    ].filter(Boolean).join(" · ");
    const rowsHtml = commandes.map(r => {
      const ch = chantiers.find(c => c.id === r.chantier_id);
      const mat = r.materiau_id && materiaux.find(m => m.id === r.materiau_id);
      const statut = STATUTS_CMD[r.statut] || STATUTS_CMD.a_commander;
      const urgent = r.priorite === "urgent" ? '<span style="color:#e15a5a;font-weight:700;margin-left:4px">URGENT</span>' : "";
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${ch ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${ch.couleur};margin-right:5px;vertical-align:middle"></span>${ch.nom}` : ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.article || ""}${mat ? `<br><span style="font-size:9px;color:#888">${mat.reference || ""}</span>` : ""}${urgent}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.fournisseur || ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${r.quantite || ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${r.prix_ht ? parseFloat(r.prix_ht).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) + " €" : ""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee"><span style="background:${statut.bg};color:${statut.color};padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${statut.label}</span></td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:10px;color:#666">${r.ouvrier_demandeur || ""}${r.notes ? `<br>${r.notes}` : ""}</td>
      </tr>`;
    }).join("");
    const totalHT = commandes.reduce((s, r) => s + (parseFloat(r.prix_ht) || 0), 0);
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Commandes</title>
      <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:11px;color:#1a1f2e}
        h1{font-size:18px;margin:0 0 4px}.sub{font-size:11px;color:#666;margin-bottom:14px}
        table{width:100%;border-collapse:collapse}thead th{background:#1a1f2e;color:#fff;padding:7px 8px;text-align:left;font-size:10px;letter-spacing:.5px}
        .total{margin-top:14px;text-align:right;font-size:13px;font-weight:700}
      </style></head><body>
      <h1>Commandes</h1>
      <div class="sub">${commandes.length} ligne${commandes.length > 1 ? "s" : ""}${filtreLabel ? ` · ${filtreLabel}` : ""} · imprimé le ${new Date().toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" })}</div>
      <table><thead><tr><th>Chantier</th><th>Article</th><th>Fournisseur</th><th>Qté</th><th>Prix HT</th><th>Statut</th><th>Demandeur / Notes</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="7" style="padding:14px;text-align:center;color:#888">Aucune commande</td></tr>`}</tbody></table>
      ${totalHT > 0 ? `<div class="total">Total : ${totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div>` : ""}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const cycleStatut = async (row) => {
    const order = ["a_commander", "commande", "retire"];
    const curIdx = order.indexOf(row.statut);
    const next = order[(curIdx >= 0 ? curIdx + 1 : 1) % order.length];
    if (next === "commande") {
      setModalePrix(row.prix_ht || "");
      setModalePhaseId(""); setModalePhaseInterne(""); setModaleOuvrageLibelle("");
      setModaleCommande({ row, next });
      return;
    }
    await supabase.from("commandes_detail").update({ statut: next }).eq("id", row.id);
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, statut: next } : r));
  };

  const confirmerCommande = async () => {
    if (!modaleCommande) return;
    const { row } = modaleCommande;
    const prix = parseFloat(modalePrix) || null;
    const updates = { statut: "commande", prix_ht: prix };
    if (modalePhaseId && modalePhaseInterne && modaleOuvrageLibelle) {
      updates.phasage_id = modalePhaseId;
      updates.phase_id = modalePhaseInterne;
      updates.ouvrage_libelle = modaleOuvrageLibelle;
    }
    const { error } = await supabase.from("commandes_detail").update(updates).eq("id", row.id);
    if (error?.code === "42703") {
      // Fallback : colonnes phase_id/ouvrage_libelle pas encore migrées
      console.warn("[Commandes] Colonnes phase_id/ouvrage_libelle manquantes — sauvegarde sans liaison famille.");
      const { phase_id, ouvrage_libelle, ...sansFamille } = updates;
      await supabase.from("commandes_detail").update(sansFamille).eq("id", row.id);
    }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...updates } : r));
    // Plus de mise à jour de cout_materiel sur les tâches : le coût est désormais
    // agrégé dynamiquement au niveau famille dans le Plan de travaux.
    setModaleCommande(null);
  };

  const STATUTS_COMMANDES = ["a_commander", "commande", "retire"];
  const filtered = commandes.filter(r =>
    (filterChantier === "all" || r.chantier_id === filterChantier) &&
    (filterStatut === "all" || r.statut === filterStatut) &&
    (filterOuvrier === "all" || r.ouvrier_demandeur === filterOuvrier)
  );

  const ouvriersDansCmds = [...new Set(commandes.map(r => r.ouvrier_demandeur).filter(Boolean))];
  const counts = Object.fromEntries(STATUTS_COMMANDES.map(k => [k, commandes.filter(r => r.statut === k).length]));
  const STATUTS = STATUTS_CMD;
  const phasageModale = phasages.find(p => p.id === modalePhaseId);
  // Liste des familles uniques (groupe par ouvrage_libelle dans chaque phase)
  const famillesModale = phasageModale?.plan_travaux
    ? Object.entries(phasageModale.plan_travaux)
        .filter(([k, v]) => k !== "meta" && Array.isArray(v))
        .flatMap(([phId, arr]) => {
          const seen = new Set(); const out = [];
          arr.forEach(t => {
            const lib = (t.ouvrage_libelle || "").trim();
            if (!lib) return;
            const key = `${phId}|||${lib}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ phId, ouvrageLibelle: lib });
          });
          return out;
        })
    : [];

  const renderBiblioRowEditor = (draft, setDraft) => (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
        <Icon as={Package} size={11}/>
        Lier à la bibliothèque
      </div>
      <BiblioSelector
        value={draft.materiau_id || null}
        onChange={(mId) => {
          if (!mId) { setDraft(p => ({ ...p, materiau_id: null })); return; }
          const mat = materiaux.find(m => m.id === mId);
          if (mat) setDraft(p => ({ ...p, materiau_id: mId, fournisseur: mat.fournisseur || p.fournisseur || "" }));
        }}
        T={T}
        materiaux={materiaux}
      />
    </div>
  );

  return (
    <div className="page-padding cmd-page" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      <style>{`
        @media(max-width:767px) {
          .cmd-page .cmd-header{flex-direction:column;align-items:stretch!important}
          .cmd-page .cmd-header > div:first-child > div:first-child{font-size:22px!important}
          .cmd-page .cmd-actions{flex-direction:column!important;align-items:stretch!important}
          .cmd-page .cmd-actions > button,.cmd-page .cmd-actions > div{width:100%;justify-content:center}
          .cmd-page .cmd-table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}
          .cmd-page .cmd-table-wrapper table{min-width:800px}
          .cmd-page .cmd-counters > div{padding:8px 12px!important;min-width:0;flex:1}
          .cmd-page .cmd-counters > div > div:first-child{font-size:16px!important}
          .cmd-page .cmd-counters > div > div:last-child{font-size:10px!important}
          .cmd-page .cmd-filters select{width:100%;flex:1 1 100%!important}
        }
      `}</style>

      {/* Modale import */}
      {modaleImport && (
        <ModaleImport
          onClose={() => setModaleImport(false)}
          onImport={handleImportLignes}
          materiaux={materiaux}
          phasages={phasages}
          chantiers={chantiers}
          T={T}
        />
      )}

      {/* Panneau demandes */}
      {panneauOuvert && (
        <PanneauDemandes
          demandes={demandes} chantiers={chantiers} T={T}
          onClose={() => setPanneauOuvert(false)}
          onConvertir={convertirDemande}
          onSupprimer={supprimerDemande}
          materiaux={materiaux}
        />
      )}

      {/* Modale passage à "Commandé" */}
      {modaleCommande && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 900,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          backdropFilter: "blur(4px)",
        }} onClick={() => setModaleCommande(null)}>
          <div style={{
            background: T.surface, borderRadius: 16, width: "100%", maxWidth: 480,
            border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden",
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              padding: "18px 24px", borderBottom: `1px solid ${T.border}`,
              background: "rgba(80,200,120,0.08)", display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: "rgba(34,197,94,0.18)",
                color: "#22c55e",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={ShoppingCart} size={18} strokeWidth={2}/>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Commande passée</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{modaleCommande.row.article}</div>
              </div>
            </div>
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{
                  fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase",
                  letterSpacing: 1, display: "block", marginBottom: 6,
                }}>Prix de la commande (HT)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="number" min="0" step="0.01" value={modalePrix} autoFocus
                    onChange={e => setModalePrix(e.target.value)} placeholder="ex: 450.00"
                    style={{
                      flex: 1, padding: "10px 14px", borderRadius: 8,
                      border: `1px solid ${modalePrix ? "rgba(80,200,120,0.5)" : T.border}`,
                      background: T.inputBg, color: "#50c878", fontFamily: "inherit",
                      fontSize: 16, fontWeight: 800, outline: "none",
                    }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.textMuted }}>€ HT</span>
                </div>
              </div>
              <div>
                <label style={{
                  fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase",
                  letterSpacing: 1, display: "block", marginBottom: 6,
                }}>Lier à une famille du plan de travail</label>
                <select value={modalePhaseId} onChange={e => { setModalePhaseId(e.target.value); setModalePhaseInterne(""); setModaleOuvrageLibelle(""); }}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
                    background: T.inputBg, color: modalePhaseId ? T.text : T.textMuted,
                    fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 8,
                  }}>
                  <option value="">— Choisir un chantier / phasage —</option>
                  {phasages.map(p => <option key={p.id} value={p.id}>{p.chantier_nom}</option>)}
                </select>
                {modalePhaseId && (
                  <select
                    value={modalePhaseInterne && modaleOuvrageLibelle ? `${modalePhaseInterne}|||${modaleOuvrageLibelle}` : ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) { setModalePhaseInterne(""); setModaleOuvrageLibelle(""); return; }
                      const [p, lib] = v.split("|||");
                      setModalePhaseInterne(p); setModaleOuvrageLibelle(lib);
                    }}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
                      background: T.inputBg, color: (modalePhaseInterne && modaleOuvrageLibelle) ? T.text : T.textMuted,
                      fontFamily: "inherit", fontSize: 13, outline: "none",
                    }}>
                    <option value="">— Choisir une famille —</option>
                    {famillesModale.map(f => (
                      <option key={`${f.phId}|||${f.ouvrageLibelle}`} value={`${f.phId}|||${f.ouvrageLibelle}`}>
                        [{PHASES_LABELS[f.phId] || f.phId}] {f.ouvrageLibelle}
                      </option>
                    ))}
                  </select>
                )}
                {!modalePhaseId && (
                  <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                    Optionnel — la commande sera rattachée à une famille (ex: « Réseaux plomberie »).
                  </div>
                )}
              </div>
            </div>
            <div style={{
              padding: "14px 24px", borderTop: `1px solid ${T.border}`,
              display: "flex", gap: 10, justifyContent: "flex-end", background: T.surface,
            }}>
              <button onClick={() => setModaleCommande(null)} style={{
                padding: "9px 18px", borderRadius: 8, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={confirmerCommande} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 22px", borderRadius: RADIUS.md, border: "none",
                background: "#22c55e", color: "#fff", fontFamily: "inherit",
                fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>
                <Icon as={Check} size={14}/>
                Confirmer la commande
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="cmd-header" style={{
        marginBottom: 24, display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Package} size={20} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 2 }}>Commandes</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Suivi des besoins par chantier et par fournisseur</div>
          </div>
        </div>
        <div className="cmd-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <BoutonDemandes count={demandes.length} onClick={() => setPanneauOuvert(true)} T={T} acc={acc} />
          <button
            onClick={() => setModaleImport(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md, padding: "8px 14px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600,
              color: T.textSub, cursor: "pointer",
              transition: "border-color .12s, color .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}
          >
            <Icon as={FileText} size={14}/>
            Importer un document
          </button>
          <button
            onClick={() => { const e = emptyCommande(); setNewRow(e); setEditDraft(e); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: acc.accent, color: acc.onAccent, border: "none",
              borderRadius: RADIUS.md, padding: "9px 16px", fontFamily: "inherit",
              fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
            <Icon as={Plus} size={14}/>
            Nouvelle commande
          </button>
        </div>
      </div>

      {/* Compteurs statut */}
      <div className="cmd-counters" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {STATUTS_COMMANDES.map(k => {
          const v = STATUTS[k];
          const active = filterStatut === k;
          return (
            <div key={k} style={{
              background: active ? v.bg : "transparent",
              border: `1px solid ${active ? v.color : T.border}`,
              borderRadius: RADIUS.lg,
              padding: "10px 16px", cursor: "pointer",
              transition: "border-color .12s, background .12s",
              display: "flex", alignItems: "center", gap: 10,
            }} onClick={() => setFilterStatut(active ? "all" : k)}
              onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = v.color + "80"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = T.border; }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: v.color, lineHeight: 1.1, letterSpacing: -0.3 }}>
                {counts[k] || 0}
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: active ? v.color : T.textSub, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase" }}>
                {v.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filtres */}
      <div className="cmd-filters" style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          { icon: Building2, value: filterChantier, onChange: setFilterChantier, options: [{ value: "all", label: "Tous les chantiers" }, ...chantiers.map(c => ({ value: c.id, label: c.nom }))] },
          { icon: ListChecks, value: filterStatut, onChange: setFilterStatut, options: [{ value: "all", label: "Tous les statuts" }, ...STATUTS_COMMANDES.map(k => ({ value: k, label: STATUTS[k].label }))] },
        ].map((sel, i) => {
          const has = sel.value && sel.value !== "all";
          return (
            <div key={i} style={{ position: "relative" }}>
              <Icon as={sel.icon} size={13} style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                color: has ? acc.accent : T.textMuted, pointerEvents: "none",
              }}/>
              <select value={sel.value} onChange={e => sel.onChange(e.target.value)}
                style={{
                  background: T.card, border: `1px solid ${has ? acc.border : T.border}`,
                  borderRadius: RADIUS.md,
                  padding: "7px 12px 7px 30px",
                  color: has ? T.text : T.textSub,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                  fontWeight: has ? 600 : 500, cursor: "pointer",
                }}>
                {sel.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        })}

        {/* View switch + Export — alignés à droite */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{
            display: "flex", padding: 3, gap: 2,
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.lg,
          }}>
            {[
              { id: "liste",       label: "Liste",         icon: LayoutList },
              { id: "fournisseur", label: "Fournisseur",   icon: Truck },
              { id: "chantier",    label: "Chantier",      icon: Building2 },
            ].map(v => {
              const active = viewMode === v.id;
              return (
                <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px",
                  border: "none",
                  borderRadius: RADIUS.md,
                  fontFamily: "inherit",
                  fontSize: FONT.xs.size + 1, fontWeight: active ? 800 : 600,
                  letterSpacing: .4,
                  cursor: "pointer",
                  background: active ? acc.accent : "transparent",
                  color: active ? acc.onAccent : T.textSub,
                  transition: "background .12s, color .12s",
                }}>
                  <Icon as={v.icon} size={12}/>
                  {v.label}
                </button>
              );
            })}
          </div>
          <button onClick={() => exporterCSV()} title="Exporter en CSV (Excel)" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            width: "auto", padding: "6px 12px",
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.xs.size + 1, fontWeight: 600,
            borderRadius: RADIUS.md, cursor: "pointer",
            transition: "border-color .12s, color .12s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={FileSpreadsheet} size={13}/>
            CSV
          </button>
          <button onClick={() => exporterPDF()} title="Imprimer / Exporter PDF" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32,
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.textSub, borderRadius: RADIUS.md, cursor: "pointer",
            transition: "border-color .12s, color .12s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}>
            <Icon as={Printer} size={14}/>
          </button>
        </div>
      </div>

      {/* Tableau commandes ou vues groupées */}
      {viewMode === "liste" && (
      <div className="cmd-table-wrapper" style={{ background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: T.card, borderBottom: `2px solid ${T.border}` }}>
              {["Chantier", "Article / Matériau", "Fournisseur", "Qté", "Statut / Priorité", "Ouvrier · Notes", "Date", ""].map(h => (
                <th key={h} style={{
                  padding: "12px 10px", fontSize: 11, fontWeight: 700,
                  letterSpacing: 1.5, textTransform: "uppercase", color: T.textMuted, textAlign: "left",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newRow && editDraft && (
              <tr style={{ background: T.fieldBg }}>
                <td style={{ padding: "8px 10px" }}>
                  <select value={editDraft.chantier_id} onChange={e => setEditDraft(p => ({ ...p, chantier_id: e.target.value }))}
                    style={{ background: "#1e2336", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }}>
                    <option value="">— Chantier —</option>
                    {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </td>
                <td style={{ padding: "8px 10px" }}>
                  {renderBiblioRowEditor(editDraft, setEditDraft)}
                  <input value={editDraft.article || ""} onChange={e => setEditDraft(p => ({ ...p, article: e.target.value }))}
                    placeholder="Article" autoFocus={!editDraft.materiau_id}
                    style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <input value={editDraft.fournisseur || ""} onChange={e => setEditDraft(p => ({ ...p, fournisseur: e.target.value }))}
                    placeholder="Fournisseur"
                    style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <input value={editDraft.quantite || ""} onChange={e => setEditDraft(p => ({ ...p, quantite: e.target.value }))}
                    placeholder="Qté"
                    style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <select value={editDraft.statut || "a_commander"} onChange={e => setEditDraft(p => ({ ...p, statut: e.target.value }))}
                    style={{ background: "#1e2336", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none", marginBottom: 4 }}>
                    {STATUTS_COMMANDES.map(k => <option key={k} value={k}>{STATUTS[k].label}</option>)}
                  </select>
                  <select value={editDraft.priorite || "normal"} onChange={e => setEditDraft(p => ({ ...p, priorite: e.target.value }))}
                    style={{ background: "#1e2336", border: `1px solid ${editDraft.priorite === "urgent" ? "rgba(224,92,92,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 6, padding: "5px 8px", color: editDraft.priorite === "urgent" ? "#e05c5c" : "#9aa5c0", fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none", fontWeight: 700 }}>
                    <option value="normal">🟡 Normal</option>
                    <option value="urgent">🔴 URGENT</option>
                  </select>
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <input value={editDraft.ouvrier_demandeur || ""} onChange={e => setEditDraft(p => ({ ...p, ouvrier_demandeur: e.target.value }))}
                    placeholder="Ouvrier" style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", color: T.text, fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none", marginBottom: 4 }} />
                  <input value={editDraft.notes || ""} onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Notes" style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                </td>
                <td style={{ padding: "8px 10px" }}></td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  <button onClick={() => saveRow(editDraft)} title="Enregistrer" style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: acc.accent, color: acc.onAccent, border: "none",
                    borderRadius: RADIUS.sm + 2, padding: "6px 10px",
                    cursor: "pointer", fontFamily: "inherit", marginRight: 4,
                  }}>
                    <Icon as={Check} size={14}/>
                  </button>
                  <button onClick={() => { setNewRow(null); setEditDraft(null); }} title="Annuler" style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.sm + 2, padding: "6px 8px",
                    cursor: "pointer", color: T.textSub, fontFamily: "inherit",
                  }}>
                    <Icon as={X} size={13}/>
                  </button>
                </td>
              </tr>
            )}

            {loading ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: T.textMuted }}>Chargement…</td></tr>
            ) : filtered.length === 0 && !newRow ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: T.textMuted }}>
                Aucune commande — clique sur "+ Nouvelle commande" pour commencer.
              </td></tr>
            ) : filtered.map(row => {
              const ch = chantiers.find(c => c.id === row.chantier_id);
              const st = STATUTS[row.statut] || STATUTS.a_commander;
              const urgent = row.priorite === "urgent";
              const rowBg = urgent ? "rgba(224,92,92,0.05)" : "transparent";
              const rowBorderLeft = urgent ? "3px solid rgba(224,92,92,0.5)" : "3px solid transparent";
              const matLie = row.materiau_id ? materiaux.find(m => m.id === row.materiau_id) : null;

              if (editRow === row.id && editDraft) return (
                <tr key={row.id} style={{ background: T.fieldBg }}>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={editDraft.chantier_id} onChange={e => setEditDraft(p => ({ ...p, chantier_id: e.target.value }))}
                      style={{ background: "#1e2336", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }}>
                      <option value="">— Chantier —</option>
                      {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {renderBiblioRowEditor(editDraft, setEditDraft)}
                    <input value={editDraft.article || ""} onChange={e => setEditDraft(p => ({ ...p, article: e.target.value }))}
                      placeholder="Article" autoFocus
                      style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={editDraft.fournisseur || ""} onChange={e => setEditDraft(p => ({ ...p, fournisseur: e.target.value }))}
                      placeholder="Fournisseur"
                      style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={editDraft.quantite || ""} onChange={e => setEditDraft(p => ({ ...p, quantite: e.target.value }))}
                      placeholder="Qté"
                      style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <select value={editDraft.statut || "a_commander"} onChange={e => setEditDraft(p => ({ ...p, statut: e.target.value }))}
                      style={{ background: "#1e2336", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none", marginBottom: 4 }}>
                      {STATUTS_COMMANDES.map(k => <option key={k} value={k}>{STATUTS[k].label}</option>)}
                    </select>
                    <select value={editDraft.priorite || "normal"} onChange={e => setEditDraft(p => ({ ...p, priorite: e.target.value }))}
                      style={{ background: "#1e2336", border: `1px solid ${editDraft.priorite === "urgent" ? "rgba(224,92,92,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 6, padding: "5px 8px", color: editDraft.priorite === "urgent" ? "#e05c5c" : "#9aa5c0", fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none", fontWeight: 700 }}>
                      <option value="normal">🟡 Normal</option>
                      <option value="urgent">🔴 URGENT</option>
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input value={editDraft.ouvrier_demandeur || ""} onChange={e => setEditDraft(p => ({ ...p, ouvrier_demandeur: e.target.value }))}
                      placeholder="Ouvrier" style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", color: T.text, fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none", marginBottom: 4 }} />
                    <input value={editDraft.notes || ""} onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Notes" style={{ background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", color: T.text, fontFamily: "inherit", fontSize: 13, width: "100%", outline: "none" }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}></td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <button onClick={() => saveRow(editDraft)} title="Enregistrer" style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: acc.accent, color: acc.onAccent, border: "none",
                      borderRadius: RADIUS.sm + 2, padding: "6px 10px",
                      cursor: "pointer", fontFamily: "inherit", marginRight: 4,
                    }}>
                      <Icon as={Check} size={14}/>
                    </button>
                    <button onClick={() => { setEditRow(null); setEditDraft(null); }} title="Annuler" style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "transparent", border: `1px solid ${T.border}`,
                      borderRadius: RADIUS.sm + 2, padding: "6px 8px",
                      cursor: "pointer", color: T.textSub, fontFamily: "inherit",
                    }}>
                      <Icon as={X} size={13}/>
                    </button>
                  </td>
                </tr>
              );

              const dateCreation = row.created_at
                ? new Date(row.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
                : "—";
              const heureCreation = row.created_at
                ? new Date(row.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                : "";

              return (
                <tr key={row.id} style={{
                  borderBottom: `1px solid ${T.sectionDivider}`, transition: "background .1s",
                  background: rowBg, borderLeft: rowBorderLeft,
                }}
                  onMouseEnter={e => e.currentTarget.style.background = urgent ? "rgba(224,92,92,0.1)" : T.card}
                  onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                  <td style={{ padding: "11px 10px" }}>
                    {ch ? <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: ch.couleur, display: "block", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ch.nom}</span>
                    </span> : <span style={{ fontSize: 12, color: T.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "11px 10px", fontWeight: 600 }}>
                    <div style={{ fontSize: 13, color: T.text }}>{row.article || "—"}</div>
                    {matLie && (
                      <div style={{
                        marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5,
                        background: "rgba(255,194,0,0.10)", border: "1px solid rgba(255,194,0,0.25)",
                        borderRadius: 5, padding: "2px 7px", fontSize: 11, color: "#FFC200", fontWeight: 700,
                      }}>
                        <Icon as={Package} size={11}/>
                        {matLie.reference || matLie.nom.substring(0, 20)}
                        {matLie.lien_fournisseur && (
                          <a href={matLie.lien_fournisseur} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ display: "inline-flex", alignItems: "center", color: "#5b9cf6", marginLeft: 4, textDecoration: "none" }}
                            title="Voir sur le site fournisseur">
                            <Icon as={ExternalLink} size={11}/>
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "11px 10px", fontSize: 13, color: T.textSub }}>
                    {row.fournisseur || <span style={{ color: T.emptyColor, fontSize: 12 }}>À renseigner</span>}
                  </td>
                  <td style={{ padding: "11px 10px", fontSize: 13, color: T.textSub }}>
                    <div>{row.quantite || "—"}</div>
                    {matLie?.prix_unitaire != null && row.quantite && (
                      <div style={{ fontSize: 11, color: "#50c878", marginTop: 2, fontWeight: 700 }}>
                        ≈ {(parseFloat(matLie.prix_unitaire) * parseFloat(row.quantite) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT
                      </div>
                    )}
                    {row.prix_ht > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#50c878", marginTop: 2 }}>{parseFloat(row.prix_ht).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div>}
                    {row.ouvrage_libelle && <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#5b9cf6", marginTop: 1, fontWeight: 600 }}><Icon as={Link2} size={9}/> {row.ouvrage_libelle}</div>}
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button onClick={() => cycleStatut(row)} style={{
                        background: st.bg, border: `1px solid ${st.border}`, borderRadius: 6,
                        padding: "4px 10px", fontSize: 12, fontWeight: 700, color: st.color,
                        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all .15s",
                      }} title="Cliquer pour changer le statut">{st.label}</button>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        borderRadius: RADIUS.pill, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                        background: urgent ? "rgba(225,90,90,0.15)" : "rgba(245,166,35,0.10)",
                        color: urgent ? "#e15a5a" : "#c0a060",
                        border: `1px solid ${urgent ? "rgba(225,90,90,0.35)" : "rgba(245,166,35,0.2)"}`,
                        alignSelf: "flex-start",
                      }}>
                        {urgent && <Icon as={AlertTriangle} size={10}/>}
                        {urgent ? "Urgent" : "Normal"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    {row.ouvrier_demandeur && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#a0b8ff", fontWeight: 700, marginBottom: 2 }}>
                        <Icon as={User} size={11}/> {row.ouvrier_demandeur}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: T.textSub, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.notes || ""}
                    </div>
                  </td>
                  <td style={{ padding: "11px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: urgent ? "#f5a070" : T.textMuted }}>{dateCreation}</div>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{heureCreation}</div>
                  </td>
                  <td style={{ padding: "11px 10px", whiteSpace: "nowrap" }}>
                    <button onClick={() => { setEditRow(row.id); setEditDraft({ ...row }); }} title="Modifier" style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      padding: 5, borderRadius: RADIUS.sm, marginRight: 2,
                      color: T.textMuted, opacity: .65, transition: "opacity .15s, background .15s",
                      display: "inline-flex", alignItems: "center",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = ".65"; e.currentTarget.style.background = "transparent"; }}>
                      <Icon as={Pencil} size={14}/>
                    </button>
                    <button onClick={() => deleteRow(row.id)} title="Supprimer" style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      padding: 5, borderRadius: RADIUS.sm,
                      color: "#e15a5a", opacity: .55, transition: "opacity .15s, background .15s",
                      display: "inline-flex", alignItems: "center",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(225,90,90,0.08)"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = ".55"; e.currentTarget.style.background = "transparent"; }}>
                      <Icon as={Trash2} size={14}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Vue groupée par fournisseur */}
      {viewMode === "fournisseur" && (
        <VueGroupee
          commandes={commandes}
          groupBy="fournisseur"
          chantiers={chantiers}
          materiaux={materiaux}
          T={T}
          acc={acc}
          onEditRow={(row) => { setEditRow(row.id); setEditDraft({ ...row }); }}
        />
      )}

      {/* Vue groupée par chantier */}
      {viewMode === "chantier" && (
        <VueGroupee
          commandes={commandes}
          groupBy="chantier"
          chantiers={chantiers}
          materiaux={materiaux}
          T={T}
          acc={acc}
          onEditRow={(row) => { setEditRow(row.id); setEditDraft({ ...row }); }}
        />
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: .8 }
          70% { transform: scale(2.4); opacity: 0 }
          100% { transform: scale(2.4); opacity: 0 }
        }
        @keyframes badgePulse {
          0%, 100% { transform: scale(1) }
          50% { transform: scale(1.18) }
        }
      `}</style>
    </div>
  );
}

export default PageCommandes;
