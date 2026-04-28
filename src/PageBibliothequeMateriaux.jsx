import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ─── CATÉGORIES ───────────────────────────────────────────────────────────────
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

// ─── PARSER CSV ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cols.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

// ─── HELPER : extrait l'ID d'une URL Google Sheets ───────────────────────────
function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

// ─── COLONNES ATTENDUES ───────────────────────────────────────────────────────
const COLONNES = [
  { key: "nom",              required: true  },
  { key: "reference",        required: false },
  { key: "fournisseur",      required: false },
  { key: "categorie",        required: false },
  { key: "prix_unitaire",    required: false },
  { key: "unite",            required: false },
  { key: "stock_min",        required: false },
  { key: "lien_fournisseur", required: false },
  { key: "photo_url",        required: false },
  { key: "notes",            required: false },
];

// ─── MODALE IMPORT GOOGLE SHEETS ─────────────────────────────────────────────
function ModaleImportSheets({ onClose, onImport, T }) {
  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("Feuille1");
  const [step, setStep] = useState("config"); // config | loading | preview | importing | done
  const [preview, setPreview] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [progress, setProgress] = useState(0);
  const [importMode, setImportMode] = useState("append");

  const fetchSheet = async () => {
    const sheetId = extractSheetId(url.trim());
    if (!sheetId) {
      setFetchError("URL invalide — colle le lien complet de ton Google Sheet.");
      return;
    }
    setFetchError("");
    setStep("loading");

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`Impossible de lire le sheet (erreur ${res.status}). Vérifie que le sheet est bien partagé en lecture publique.`);

      const text = await res.text();
      const rows = parseCSV(text);

      if (rows.length < 2) {
        throw new Error("Le sheet est vide ou ne contient que l'en-tête.");
      }

      const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[\s\-]/g, "_"));
      const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));

      const mapped = dataRows.map((row, i) => {
        const obj = {};
        COLONNES.forEach(col => {
          const idx = headers.indexOf(col.key);
          obj[col.key] = idx >= 0 ? (row[idx] || "").trim() : "";
        });
        return { ...obj, _line: i + 2 };
      });

      const warns = mapped.filter(r => !r.nom).map(r => `Ligne ${r._line} ignorée (colonne "nom" vide)`);
      const valid = mapped.filter(r => r.nom);

      setWarnings(warns);
      setPreview(valid);
      setStep("preview");
    } catch (e) {
      setFetchError(e.message || "Erreur de lecture du sheet.");
      setStep("config");
    }
  };

  const doImport = async () => {
    setStep("importing");
    setProgress(0);

    try {
      if (importMode === "replace") {
        // Supprime tout (contourne la contrainte en filtrant sur un uuid impossible)
        await supabase.from("materiaux_bibliotheque").delete().gte("created_at", "2000-01-01");
      }

      const payload = preview.map(r => ({
        nom:              r.nom,
        reference:        r.reference || null,
        fournisseur:      r.fournisseur || null,
        categorie:        r.categorie || null,
        prix_unitaire:    r.prix_unitaire ? parseFloat(r.prix_unitaire.replace(",", ".")) : null,
        unite:            r.unite || "U",
        stock_min:        r.stock_min ? parseInt(r.stock_min) : null,
        lien_fournisseur: r.lien_fournisseur || null,
        photo_url:        r.photo_url || null,
        notes:            r.notes || null,
      }));

      const BATCH = 50;
      for (let i = 0; i < payload.length; i += BATCH) {
        const batch = payload.slice(i, i + BATCH);
        const { error } = await supabase.from("materiaux_bibliotheque").insert(batch);
        if (error) throw new Error(error.message);
        setProgress(Math.round(((i + batch.length) / payload.length) * 100));
      }

      setStep("done");
      setTimeout(() => { onImport(); onClose(); }, 1400);
    } catch (e) {
      setFetchError(e.message);
      setStep("preview");
    }
  };

  const G = { green: "#0F9D58", blue: "#4285F4" };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(8px)", zIndex: 910,
      }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: "min(700px, 96vw)", maxHeight: "92vh",
        background: "#13161e",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 48px 120px rgba(0,0,0,0.95)",
        zIndex: 911, display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: "22px 28px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: `linear-gradient(135deg, rgba(15,157,88,0.12), rgba(66,133,244,0.08))`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: `linear-gradient(135deg, ${G.green}, ${G.blue})`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: "#eef0f6", letterSpacing: .3 }}>
                Import Google Sheets
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                Importe tes articles depuis un tableur partagé
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, width: 36, height: 36, cursor: "pointer",
            color: "rgba(255,255,255,0.4)", fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>×</button>
        </div>

        {/* ── Corps ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ─ Config ─ */}
          {(step === "config" || step === "loading") && (<>

            {/* Instructions */}
            <div style={{
              background: "rgba(66,133,244,0.07)", border: "1px solid rgba(66,133,244,0.18)",
              borderRadius: 12, padding: "16px 18px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: G.blue, marginBottom: 10 }}>
                📋 Comment préparer ton Google Sheet
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.9 }}>
                1. Crée ou copie un Google Sheet avec ces colonnes exactes en <strong style={{ color: "#eef0f6" }}>ligne 1</strong> :<br />
                <code style={{
                  display: "block", margin: "8px 0",
                  background: "rgba(0,0,0,0.35)", borderRadius: 7, padding: "9px 13px",
                  fontSize: 11, color: "#FFC200", letterSpacing: .4,
                  fontFamily: "monospace", overflowX: "auto", whiteSpace: "nowrap",
                }}>
                  nom · reference · fournisseur · categorie · prix_unitaire · unite · stock_min · lien_fournisseur · photo_url · notes
                </code>
                2. Remplis les lignes avec tes articles (seul <strong style={{ color: "#eef0f6" }}>nom</strong> est obligatoire)<br />
                3. <strong style={{ color: "#eef0f6" }}>Fichier → Partager → Tout le monde avec le lien → Lecteur</strong><br />
                4. Colle le lien ci-dessous et clique sur « Lire le sheet »
              </div>
            </div>

            {/* Template */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              background: "rgba(15,157,88,0.07)", border: "1px solid rgba(15,157,88,0.22)",
              borderRadius: 11, padding: "14px 18px",
            }}>
              <span style={{ fontSize: 26 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.green }}>Template prêt à l'emploi</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                  Copie ce Google Sheet modèle avec les bonnes colonnes, remplis-le et importe-le directement
                </div>
              </div>
              <a
                href="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/copy"
                target="_blank"
                rel="noreferrer"
                style={{
                  background: G.green, color: "#fff",
                  borderRadius: 9, padding: "9px 18px",
                  fontSize: 12, fontWeight: 800,
                  textDecoration: "none", whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                📋 Copier le template
              </a>
            </div>

            {/* URL */}
            <div>
              <label style={{
                fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)",
                textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 8,
              }}>URL de ton Google Sheet *</label>
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); setFetchError(""); }}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                autoFocus
                onKeyDown={e => e.key === "Enter" && url.trim() && fetchSheet()}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.05)",
                  border: `1px solid ${fetchError ? "rgba(224,92,92,0.5)" : url ? "rgba(66,133,244,0.45)" : "rgba(255,255,255,0.09)"}`,
                  borderRadius: 10, padding: "12px 14px",
                  color: "#eef0f6", fontFamily: "inherit", fontSize: 14,
                  outline: "none", transition: "border-color .15s",
                }}
              />
              {fetchError && (
                <div style={{ fontSize: 12, color: "#e05c5c", marginTop: 7 }}>⚠️ {fetchError}</div>
              )}
            </div>

            {/* Nom feuille + mode */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 8 }}>
                  Nom de la feuille
                </label>
                <input
                  value={sheetName}
                  onChange={e => setSheetName(e.target.value)}
                  placeholder="Feuille1"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10, padding: "12px 14px",
                    color: "#eef0f6", fontFamily: "inherit", fontSize: 13, outline: "none",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 8 }}>
                  Mode d'import
                </label>
                <select
                  value={importMode}
                  onChange={e => setImportMode(e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "#1c2030", border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: 10, padding: "12px 14px",
                    color: "#eef0f6", fontFamily: "inherit", fontSize: 13, outline: "none",
                  }}
                >
                  <option value="append">➕ Ajouter aux existants</option>
                  <option value="replace">🔄 Remplacer toute la bibliothèque</option>
                </select>
              </div>
            </div>
          </>)}

          {/* ─ Loading ─ */}
          {step === "loading" && (
            <div style={{ textAlign: "center", padding: "50px 0", color: "rgba(255,255,255,0.4)" }}>
              <div style={{ fontSize: 44, marginBottom: 18, animation: "spin 0.9s linear infinite", display: "inline-block" }}>⟳</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Lecture du Google Sheet…</div>
              <div style={{ fontSize: 12, marginTop: 6, opacity: .6 }}>Récupération des données via l'API Google</div>
            </div>
          )}

          {/* ─ Preview ─ */}
          {step === "preview" && (<>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{
                background: "rgba(15,157,88,0.1)", border: "1px solid rgba(15,157,88,0.28)",
                borderRadius: 11, padding: "12px 18px",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: G.green }}>
                    {preview.length} article{preview.length > 1 ? "s" : ""} prêts à importer
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    Mode : {importMode === "replace" ? "Remplacement total" : "Ajout aux existants"}
                  </div>
                </div>
              </div>
              <button onClick={() => setStep("config")} style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8, padding: "8px 14px",
                color: "rgba(255,255,255,0.35)", fontFamily: "inherit", fontSize: 12, cursor: "pointer",
              }}>← Modifier l'URL</button>
            </div>

            {/* Avertissements lignes ignorées */}
            {warnings.length > 0 && (
              <div style={{
                background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.22)",
                borderRadius: 10, padding: "12px 16px",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#f5a623", marginBottom: 5 }}>
                  ⚠️ {warnings.length} ligne{warnings.length > 1 ? "s" : ""} ignorée{warnings.length > 1 ? "s" : ""} (nom vide)
                </div>
                {warnings.slice(0, 4).map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{w}</div>
                ))}
                {warnings.length > 4 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>…et {warnings.length - 4} autres</div>}
              </div>
            )}

            {/* Erreur import */}
            {fetchError && (
              <div style={{ background: "rgba(224,92,92,0.08)", border: "1px solid rgba(224,92,92,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#e05c5c" }}>
                ⚠️ {fetchError}
              </div>
            )}

            {/* Table aperçu */}
            <div style={{
              background: "rgba(255,255,255,0.025)", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 14px", background: "rgba(255,255,255,0.035)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase", letterSpacing: 1.2,
              }}>
                Aperçu — {Math.min(preview.length, 25)} premiers articles
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["Nom", "Réf.", "Fournisseur", "Catégorie", "Prix HT", "Unité"].map(h => (
                        <th key={h} style={{
                          padding: "8px 10px", textAlign: "left",
                          color: "rgba(255,255,255,0.3)", fontWeight: 700,
                          fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 25).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "7px 10px", color: "#eef0f6", fontWeight: 600 }}>{r.nom}</td>
                        <td style={{ padding: "7px 10px", color: "rgba(255,255,255,0.38)", fontFamily: "monospace", fontSize: 11 }}>{r.reference || "—"}</td>
                        <td style={{ padding: "7px 10px", color: "rgba(255,255,255,0.45)" }}>{r.fournisseur || "—"}</td>
                        <td style={{ padding: "7px 10px" }}>
                          {r.categorie
                            ? <span style={{ background: "rgba(255,194,0,0.1)", color: "#FFC200", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700 }}>{r.categorie}</span>
                            : <span style={{ color: "rgba(255,255,255,0.2)" }}>—</span>
                          }
                        </td>
                        <td style={{ padding: "7px 10px", color: "#50c878", fontWeight: 700 }}>
                          {r.prix_unitaire ? `${parseFloat(r.prix_unitaire.replace(",", ".")).toFixed(2)} €` : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", color: "rgba(255,255,255,0.38)" }}>{r.unite || "U"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 25 && (
                <div style={{
                  padding: "8px 14px", textAlign: "center",
                  fontSize: 11, color: "rgba(255,255,255,0.25)",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}>
                  …et {preview.length - 25} article{preview.length - 25 > 1 ? "s" : ""} supplémentaire{preview.length - 25 > 1 ? "s" : ""}
                </div>
              )}
            </div>
          </>)}

          {/* ─ Importing ─ */}
          {step === "importing" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 22 }}>
                Import en cours… {progress}%
              </div>
              <div style={{ width: "100%", height: 10, background: "rgba(255,255,255,0.07)", borderRadius: 5, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${progress}%`,
                  background: `linear-gradient(90deg, ${G.green}, ${G.blue})`,
                  borderRadius: 5, transition: "width .3s ease",
                }} />
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 12 }}>
                {Math.round(preview.length * progress / 100)} / {preview.length} articles
              </div>
            </div>
          )}

          {/* ─ Done ─ */}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 56, marginBottom: 18 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: G.green, marginBottom: 8 }}>Import réussi !</div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
                {preview.length} article{preview.length > 1 ? "s" : ""} importé{preview.length > 1 ? "s" : ""} dans la bibliothèque
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {(step === "config" || step === "loading") && (
          <div style={{
            padding: "16px 28px", borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex", gap: 10, justifyContent: "flex-end",
            background: "#13161e", flexShrink: 0,
          }}>
            <button onClick={onClose} style={{
              padding: "10px 20px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.09)",
              background: "transparent", color: "rgba(255,255,255,0.35)",
              fontFamily: "inherit", fontSize: 13, cursor: "pointer",
            }}>Annuler</button>
            <button
              onClick={fetchSheet}
              disabled={!url.trim() || step === "loading"}
              style={{
                padding: "10px 28px", borderRadius: 9, border: "none",
                background: url.trim() && step !== "loading"
                  ? `linear-gradient(135deg, ${G.green}, ${G.blue})`
                  : "rgba(255,255,255,0.07)",
                color: url.trim() && step !== "loading" ? "#fff" : "rgba(255,255,255,0.25)",
                fontFamily: "inherit", fontSize: 13, fontWeight: 800,
                cursor: url.trim() && step !== "loading" ? "pointer" : "not-allowed",
                transition: "all .15s",
              }}
            >
              {step === "loading" ? "Lecture…" : "→ Lire le sheet"}
            </button>
          </div>
        )}

        {step === "preview" && (
          <div style={{
            padding: "16px 28px", borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex", gap: 10, justifyContent: "flex-end",
            background: "#13161e", flexShrink: 0,
          }}>
            <button onClick={onClose} style={{
              padding: "10px 20px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.09)",
              background: "transparent", color: "rgba(255,255,255,0.35)",
              fontFamily: "inherit", fontSize: 13, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={doImport} style={{
              padding: "10px 32px", borderRadius: 9, border: "none",
              background: `linear-gradient(135deg, ${G.green}, ${G.blue})`,
              color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}>
              ✓ Importer {preview.length} article{preview.length > 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

// ─── MODALE ARTICLE ───────────────────────────────────────────────────────────
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
    borderRadius: 8, padding: "9px 12px",
    color: T.text, fontFamily: "inherit", fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box",
    transition: "border-color .15s",
  });

  const sel = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, padding: "9px 12px",
    color: T.text, fontFamily: "inherit", fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", zIndex: 900 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(600px, 96vw)", maxHeight: "90vh",
        background: T.surface, borderRadius: 18, border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        zIndex: 901, display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,194,0,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,194,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📦</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{draft.id ? "Modifier l'article" : "Nouvel article"}</div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>Bibliothèque matériaux</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, width: 34, height: 34, cursor: "pointer", color: T.textSub, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Désignation *</label>
                <input value={draft.nom} onChange={e => set("nom", e.target.value)} placeholder="ex: Plaque BA13 standard" autoFocus style={inp(!draft.nom?.trim())} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Référence</label>
                <input value={draft.reference} onChange={e => set("reference", e.target.value)} placeholder="ex: REF-001" style={inp()} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Catégorie</label>
                <select value={draft.categorie} onChange={e => set("categorie", e.target.value)} style={sel}>
                  <option value="">— Choisir —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Fournisseur</label>
                <input value={draft.fournisseur} onChange={e => set("fournisseur", e.target.value)} placeholder="ex: Point P, Leroy Merlin…" style={inp()} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Prix unitaire (€ HT)</label>
                <input type="number" min="0" step="0.01" value={draft.prix_unitaire} onChange={e => set("prix_unitaire", e.target.value)} placeholder="0.00" style={{ ...inp(), color: "#50c878" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Unité</label>
                <select value={draft.unite} onChange={e => set("unite", e.target.value)} style={sel}>
                  {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Stock minimum</label>
                <input type="number" min="0" value={draft.stock_min} onChange={e => set("stock_min", e.target.value)} placeholder="0" style={inp()} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Lien fournisseur (URL)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={draft.lien_fournisseur} onChange={e => set("lien_fournisseur", e.target.value)} placeholder="https://…" style={{ ...inp(), flex: 1 }} />
                {draft.lien_fournisseur && (
                  <a href={draft.lien_fournisseur} target="_blank" rel="noreferrer" style={{ background: "rgba(255,194,0,0.15)", border: "1px solid rgba(255,194,0,0.3)", borderRadius: 8, padding: "9px 14px", color: "#FFC200", textDecoration: "none", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>🔗 Ouvrir</a>
                )}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Photo (URL image)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input value={draft.photo_url} onChange={e => set("photo_url", e.target.value)} placeholder="https://… (lien image directe)" style={{ ...inp(), flex: 1 }} />
                {draft.photo_url && (
                  <img src={draft.photo_url} alt="preview" onError={e => e.target.style.display = "none"} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
                )}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Notes / Détails</label>
              <textarea value={draft.notes} onChange={e => set("notes", e.target.value)} placeholder="Informations complémentaires, variantes, conditionnement…" rows={3} style={{ ...inp(), resize: "vertical" }} />
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 10, justifyContent: "flex-end", background: T.surface, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
          <button onClick={handleSave} disabled={!draft.nom?.trim() || saving} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: draft.nom?.trim() ? "#FFC200" : "rgba(255,194,0,0.2)", color: draft.nom?.trim() ? "#111" : T.textMuted, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: draft.nom?.trim() ? "pointer" : "not-allowed", transition: "all .15s" }}>
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
  const [modale, setModale] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [modaleSheets, setModaleSheets] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("materiaux_bibliotheque").select("*").order("categorie").order("nom");
    if (!error) setArticles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = articles.filter(a => {
    const matchCat = filterCat === "all" || a.categorie === filterCat;
    const q = search.toLowerCase();
    const matchSearch = !q || a.nom?.toLowerCase().includes(q) || a.reference?.toLowerCase().includes(q) || a.fournisseur?.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const catsPresentes = [...new Set(articles.map(a => a.categorie).filter(Boolean))].sort();

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

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

      {modaleSheets && <ModaleImportSheets onClose={() => setModaleSheets(false)} onImport={load} T={T} />}
      {modale && <ArticleModal article={modale === "new" ? null : modale} onClose={() => setModale(null)} onSave={saveArticle} T={T} />}

      {confirmDelete && (
        <>
          <div onClick={() => setConfirmDelete(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: T.surface, borderRadius: 16, border: "1px solid rgba(224,92,92,0.4)", padding: "24px 28px", zIndex: 901, maxWidth: 400, width: "90vw", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Supprimer cet article ?</div>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20 }}>« {confirmDelete.nom} » sera supprimé définitivement.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={() => deleteArticle(confirmDelete.id)} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#e05c5c", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Supprimer</button>
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>Bibliothèque matériaux</div>
          <div style={{ fontSize: 14, color: T.textSub }}>Catalogue des articles, consommables et matériaux récurrents</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setModaleSheets(true)} style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(15,157,88,0.12)", border: "1px solid rgba(15,157,88,0.35)",
            borderRadius: 10, padding: "11px 18px",
            fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "#0F9D58",
            cursor: "pointer", transition: "all .15s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(15,157,88,0.22)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(15,157,88,0.12)"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#0F9D58">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            Importer depuis Sheets
          </button>
          <button onClick={() => setModale("new")} style={{ background: T.accent, color: "#111", border: "none", borderRadius: 10, padding: "11px 22px", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            + Nouvel article
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Articles",   val: articles.length,                           color: "#FFC200", bg: "rgba(255,194,0,0.12)",   border: "rgba(255,194,0,0.3)"   },
          { label: "Avec prix",  val: articles.filter(a => a.prix_unitaire).length, color: "#50c878", bg: "rgba(80,200,120,0.12)",  border: "rgba(80,200,120,0.3)"  },
          { label: "Avec lien",  val: articles.filter(a => a.lien_fournisseur).length, color: "#5b9cf6", bg: "rgba(91,156,246,0.12)", border: "rgba(91,156,246,0.3)" },
          { label: "Catégories", val: catsPresentes.length,                      color: "#b060ff", bg: "rgba(176,96,255,0.12)",  border: "rgba(176,96,255,0.3)"  },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 10, padding: "10px 18px" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 12, color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Bandeau vide */}
      {articles.length === 0 && !loading && (
        <div style={{
          marginBottom: 24,
          background: "linear-gradient(135deg, rgba(15,157,88,0.07), rgba(66,133,244,0.07))",
          border: "1px solid rgba(15,157,88,0.18)",
          borderRadius: 14, padding: "24px 28px",
          display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 40 }}>📋</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 4 }}>Ta bibliothèque est vide</div>
            <div style={{ fontSize: 13, color: T.textSub }}>Importe tes articles depuis un Google Sheet partagé ou ajoute-les un par un.</div>
          </div>
          <button onClick={() => setModaleSheets(true)} style={{
            background: "linear-gradient(135deg, #0F9D58, #4285F4)", color: "#fff", border: "none",
            borderRadius: 10, padding: "12px 24px", fontFamily: "inherit",
            fontSize: 14, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
          }}>📥 Importer depuis Google Sheets</button>
        </div>
      )}

      {/* Recherche + filtre */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher un article, référence, fournisseur…"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 14px", color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", flex: "1 1 220px", minWidth: 200 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ background: "#1e2336", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, outline: "none" }}>
          <option value="all">Toutes catégories</option>
          {catsPresentes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: T.card, borderBottom: `2px solid ${T.border}` }}>
              {["Photo", "Désignation / Réf.", "Catégorie", "Fournisseur", "Prix unitaire", "Stock min", "Lien", ""].map(h => (
                <th key={h} style={{ padding: "12px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: T.textMuted, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: T.textMuted }}>Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: T.textMuted }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                {articles.length === 0 ? "Importe depuis Google Sheets ou ajoute manuellement." : "Aucun résultat."}
              </td></tr>
            ) : filtered.map(a => (
              <tr key={a.id} style={{ borderBottom: `1px solid ${T.sectionDivider}`, transition: "background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.card}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 10px", width: 60 }}>
                  {a.photo_url
                    ? <img src={a.photo_url} alt={a.nom} onError={e => { e.target.style.display = "none"; }} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", border: `1px solid ${T.border}` }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: T.textMuted }}>📦</div>
                  }
                </td>
                <td style={{ padding: "10px 10px", maxWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{a.nom}</div>
                  {a.reference && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, fontFamily: "monospace" }}>{a.reference}</div>}
                  {a.notes && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{a.notes}</div>}
                </td>
                <td style={{ padding: "10px 10px" }}>
                  {a.categorie && <span style={{ background: "rgba(255,194,0,0.12)", color: "#FFC200", border: "1px solid rgba(255,194,0,0.3)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>{a.categorie}</span>}
                </td>
                <td style={{ padding: "10px 10px", fontSize: 13, color: T.textSub }}>{a.fournisseur || <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>}</td>
                <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                  {a.prix_unitaire != null
                    ? <div style={{ fontSize: 14, fontWeight: 800, color: "#50c878" }}>{parseFloat(a.prix_unitaire).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € <span style={{ fontSize: 11, fontWeight: 400, color: T.textMuted }}>HT / {a.unite || "U"}</span></div>
                    : <span style={{ color: T.emptyColor, fontSize: 12 }}>À renseigner</span>
                  }
                </td>
                <td style={{ padding: "10px 10px", fontSize: 13, color: T.textSub }}>
                  {a.stock_min != null ? `${a.stock_min} ${a.unite || "U"}` : <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>}
                </td>
                <td style={{ padding: "10px 10px" }}>
                  {a.lien_fournisseur
                    ? <a href={a.lien_fournisseur} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(91,156,246,0.12)", border: "1px solid rgba(91,156,246,0.3)", borderRadius: 6, padding: "4px 10px", color: "#5b9cf6", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>🔗 Voir</a>
                    : <span style={{ color: T.emptyColor, fontSize: 12 }}>—</span>
                  }
                </td>
                <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                  <button onClick={() => setModale(a)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, opacity: .6, marginRight: 4, color: T.text }} title="Modifier">✏️</button>
                  <button onClick={() => setConfirmDelete(a)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, opacity: .5, color: "#e05c5c" }} title="Supprimer">🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PageBibliothequeMateriaux;
