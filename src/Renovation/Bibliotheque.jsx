import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { BIBLIOTHEQUE_INITIALE, FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots, loadGroupesTypes } from "../constants";
import { Icon } from "../ui";
import { useDirtyGuard } from "../hooks";
import {
  DEPENDANCE_MODES, dupliquerSousTachesV2, estOuvrageV2, maturiteOuvrageV2,
  normaliserOuvrageV2, nouvelIdSousTache,
} from "./planningModelV1";
import { calculerOuvrage, validerCoefficient } from "./chiffragePricing.mjs";
import {
  optionsSelectTaux, tauxSelectionne, validerTauxOuvrage, expliquerPrixMainOeuvre,
  formaterTauxHT, diagnostiquerListe, tauxParDefaut,
} from "./tauxHorairesVente.mjs";
import {
  Library, Plus, Search, X, Trash2, Check, Clock, ChevronDown, ChevronUp,
  AlertTriangle, FolderPlus, FolderOpen, Hammer, Box, Package, Copy, Euro,
} from "lucide-react";

// LOTS dynamiques (phasage v2) : init avec les défauts, remplacement async au mount
let LOTS = [...LOTS_DEFAUT];
loadLots().then(l => { LOTS = l; });

// Format monétaire des prix calculés (2 décimales, fr-FR)
const fmtEur2 = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
// Colonnes de prix ajoutées par sql/202609_chiffrage_devis_logement.sql
const COLONNES_PRIX = ["taux_marge_pct", "main_oeuvre_seule", "cout_direct_unitaire", "coef_vente", "taux_horaire_vente_id"];
const fmtCoef = (k) => k == null ? "—" : `× ${Number(k).toLocaleString("fr-FR", { maximumFractionDigits: 3 })}`;
const erreurColonnesPrix = (error) => !!error && COLONNES_PRIX.some(c => (error.message || "").includes(c));

// (exporté : le Chiffrage s'en sert pour classer les ouvrages repris de la bibliothèque)
export const CATEGORIES_BASE = [
  { label: "Plâtrerie",                   ids: ["cloison", "doublage", "plafond", "lainage", "faux_plafond", "double"] },
  { label: "Électricité",                 ids: ["install_elec", "tableau", "radiateur", "vmc", "prise", "mise_a_terre"] },
  { label: "Plomberie / Sanitaire",       ids: ["chauffe_eau", "wc", "meuble_vasque", "receveur"] },
  { label: "Menuiserie / Gros œuvre",     ids: ["porte", "escalier", "plancher"] },
  { label: "Finitions",                   ids: ["peinture", "parquet", "ragreage"] },
];

// ─── SOUS-TÂCHE ROW ──────────────────────────────────────────────────────────
// Le ratio (%) détermine la répartition des heures ESTIMÉES de l'ouvrage.
// Pour les Ouvrages_V2, la ligne porte aussi son groupe d'exécution et sa
// dépendance technique. Les ouvrages historiques gardent leur affichage sans
// imposer ces nouvelles métadonnées.
function SousTacheRow({ st, idx, editData, ouvrage, setOuvrages, ouvrages, groupesTypes, T }) {
  const lotId = st.lotId ?? st.phaseId ?? "";
  const lot = LOTS.find(l => l.id === lotId);
  const total = (editData.sous_taches || []).length;
  const isV2 = estOuvrageV2(editData);
  const groupeTypeId = st.groupe_type_id || "";
  const groupeType = (groupesTypes || []).find(g => g.id === groupeTypeId);
  const mode = st.dependance_mode || DEPENDANCE_MODES.PARALLEL;
  const candidates = (editData.sous_taches || []).slice(0, idx).filter(x => x?.id);

  function update(field, value) {
    const next = [...(editData.sous_taches || [])];
    next[idx] = { ...next[idx], [field]: value };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function updatePatch(patch) {
    const next = [...(editData.sous_taches || [])];
    next[idx] = { ...next[idx], ...patch };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function remove() {
    const removedId = st.id;
    const next = (editData.sous_taches || [])
      .filter((_, i) => i !== idx)
      .map(x => removedId && Array.isArray(x.predecesseur_ids)
        ? { ...x, predecesseur_ids: x.predecesseur_ids.filter(id => id !== removedId) }
        : x);
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function move(delta) {
    const j = idx + delta;
    if (j < 0 || j >= total) return;
    const next = [...(editData.sous_taches || [])];
    [next[idx], next[j]] = [next[j], next[idx]];
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function setMode(nextMode) {
    updatePatch({
      dependance_mode: nextMode,
      ...(nextMode === DEPENDANCE_MODES.EXPLICIT ? {} : { predecesseur_ids: [] }),
      ...(nextMode === DEPENDANCE_MODES.PARALLEL ? { delai_min_calendaire: 0 } : {}),
    });
  }

  function togglePred(id) {
    const cur = Array.isArray(st.predecesseur_ids) ? st.predecesseur_ids : [];
    update("predecesseur_ids", cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  const arrowStyle = (disabled) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", border: "none", padding: 0, lineHeight: 1,
    color: T.textMuted, cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.2 : 1, height: 13,
  });
  const fieldStyle = {
    padding: "6px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
    background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1,
    outline: "none",
  };

  return (
    <div className="biblio-row" style={{
      padding: "8px 12px", borderRadius: RADIUS.md,
      background: T.card, border: `1px solid ${T.border}`,
    }}>
      <div className="biblio-task-grid" style={{
        display: "grid",
        gridTemplateColumns: "20px minmax(220px,1.4fr) 150px 190px 72px 26px",
        gap: 8, alignItems: "center",
      }}>
        <div className="biblio-reorder" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={() => move(-1)} disabled={idx === 0} title="Monter" style={arrowStyle(idx === 0)}>
            <Icon as={ChevronUp} size={13}/>
          </button>
          <button onClick={() => move(1)} disabled={idx === total - 1} title="Descendre" style={arrowStyle(idx === total - 1)}>
            <Icon as={ChevronDown} size={13}/>
          </button>
        </div>

        <input
          value={st.nom || ""}
          onChange={e => update("nom", e.target.value)}
          placeholder="ex: Pose des rails, Vis et joints…"
          style={{ ...fieldStyle, padding: "6px 10px", fontSize: FONT.sm.size }}
        />

        <select
          value={lotId}
          onChange={e => update("lotId", e.target.value)}
          style={{ ...fieldStyle, color: lotId ? (lot?.couleur || T.text) : T.textMuted, cursor: "pointer", fontWeight: lotId ? 700 : 400 }}
        >
          <option value="">Lot automatique…</option>
          {LOTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>

        {isV2 ? (
          <select
            value={groupeTypeId}
            onChange={e => update("groupe_type_id", e.target.value || null)}
            title="Moment d'exécution de cette sous-tâche dans le chantier"
            style={{ ...fieldStyle, color: groupeTypeId ? (groupeType?.couleur || T.text) : T.textMuted, cursor: "pointer", fontWeight: groupeTypeId ? 700 : 400 }}
          >
            <option value="">Groupe d'exécution…</option>
            {[...(groupesTypes || [])].sort((a,b) => (a.ordre ?? 0) - (b.ordre ?? 0)).map(g => (
              <option key={g.id} value={g.id}>{g.nom}</option>
            ))}
          </select>
        ) : (
          <div style={{ ...fieldStyle, color: T.textMuted, fontStyle: "italic" }}>— historique —</div>
        )}

        <div style={{ position: "relative" }}>
          <input
            type="number" min="0" max="100" step="1"
            value={st.ratio ?? ""}
            onChange={e => update("ratio", e.target.value === "" ? null : parseFloat(e.target.value))}
            placeholder="—"
            style={{ ...fieldStyle, width: "100%", padding: "6px 20px 6px 8px", fontSize: FONT.sm.size, textAlign: "center", fontWeight: 700 }}
          />
          <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: T.textMuted, fontSize: FONT.xs.size, pointerEvents: "none" }}>%</span>
        </div>

        <button onClick={remove} title="Supprimer cette sous-tâche" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 0, lineHeight: 1,
        }}>
          <Icon as={X} size={14}/>
        </button>
      </div>

      {isV2 && (
        <div style={{
          margin: "8px 0 0 28px", padding: "7px 9px", borderRadius: RADIUS.sm,
          background: T.inputBg, border: `1px solid ${T.sectionDivider}`,
          display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap",
        }}>
          <div style={{ minWidth: 190 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Dépendance</div>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ ...fieldStyle, width: "100%", cursor: "pointer" }}>
              <option value={DEPENDANCE_MODES.SEQUENCE}>{idx === 0 ? "Début de séquence" : "Suit la tâche précédente"}</option>
              <option value={DEPENDANCE_MODES.PARALLEL}>Peut être réalisée en parallèle</option>
              <option value={DEPENDANCE_MODES.EXPLICIT}>Dépend de tâches spécifiques</option>
            </select>
          </div>

          {mode === DEPENDANCE_MODES.EXPLICIT && (
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Prédécesseurs</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {candidates.length === 0 ? (
                  <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>Aucune tâche précédente disponible</span>
                ) : candidates.map(c => {
                  const checked = (st.predecesseur_ids || []).includes(c.id);
                  return (
                    <label key={c.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px",
                      borderRadius: RADIUS.sm, border: `1px solid ${checked ? "#5b8af5" : T.border}`,
                      background: checked ? "rgba(91,138,245,.12)" : "transparent",
                      color: checked ? "#5b8af5" : T.textSub, fontSize: FONT.xs.size, cursor: "pointer",
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => togglePred(c.id)} style={{ margin: 0 }}/>
                      {c.nom || "(sans nom)"}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {mode !== DEPENDANCE_MODES.PARALLEL && (
            <div style={{ minWidth: 170 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Attente technique mini.</div>
              <div style={{ display: "flex", gap: 5 }}>
                <input
                  type="number" min="0" step="1" value={st.delai_min_calendaire ?? 0}
                  onChange={e => update("delai_min_calendaire", Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ ...fieldStyle, width: 75, textAlign: "center" }}
                />
                <select value={st.unite_delai || "heures"} onChange={e => update("unite_delai", e.target.value)} style={{ ...fieldStyle, cursor: "pointer" }}>
                  <option value="heures">heures</option>
                  <option value="jours">jours</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MATÉRIAU LIÉ ROW ────────────────────────────────────────────────────────
// Un lien matériau ↔ ouvrage : { materiau_id, quantite }. La quantité est
// exprimée pour 1 unité d'ouvrage (ex : 4 vis par porte posée).
function MateriauLienRow({ ml, idx, editData, ouvrage, setOuvrages, ouvrages, materiaux, T, acc }) {
  const [search, setSearch] = useState("");
  const [open, setOpen]     = useState(false);
  const mat = materiaux.find(m => m.id === ml.materiau_id);

  function update(field, value) {
    const next = [...(editData.materiaux_liens || [])];
    next[idx] = { ...next[idx], [field]: value };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, materiaux_liens: next }));
  }

  function remove() {
    const next = (editData.materiaux_liens || []).filter((_, i) => i !== idx);
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, materiaux_liens: next }));
  }

  function pick(materiau) {
    update("materiau_id", materiau.id);
    setOpen(false);
    setSearch("");
  }

  const q = search.trim().toLowerCase();
  const filtered = !q ? [] : materiaux
    .filter(m =>
      (m.nom || "").toLowerCase().includes(q) ||
      (m.reference || "").toLowerCase().includes(q) ||
      (m.fournisseur || "").toLowerCase().includes(q)
    )
    .slice(0, 8);

  const prixLigne = mat && ml.quantite != null
    ? (parseFloat(mat.prix_unitaire) || 0) * (parseFloat(ml.quantite) || 0)
    : null;

  return (
    <div className="biblio-row" style={{
      display: "grid",
      gridTemplateColumns: "1fr 100px 60px 80px 26px",
      gap: 8, alignItems: "center",
      padding: "8px 12px", borderRadius: RADIUS.md,
      background: T.card, border: `1px solid ${T.border}`,
    }}>
      {/* Sélecteur matériau */}
      {mat ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
          background: T.inputBg, borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
          minWidth: 0,
        }}>
          <Icon as={Package} size={11} color={acc.accent}/>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: FONT.sm.size, fontWeight: 600, color: T.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{mat.nom}</div>
            {(mat.reference || mat.fournisseur) && (
              <div style={{
                fontSize: FONT.xs.size, color: T.textMuted, marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {mat.reference}{mat.reference && mat.fournisseur ? " · " : ""}{mat.fournisseur}
              </div>
            )}
          </div>
          <button onClick={() => update("materiau_id", null)} title="Changer le matériau" style={{
            background: "transparent", border: "none", color: T.textMuted,
            cursor: "pointer", padding: 0, lineHeight: 1,
          }}>
            <Icon as={X} size={11}/>
          </button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder="Rechercher un matériau…"
            style={{
              width: "100%", padding: "6px 10px", borderRadius: RADIUS.sm,
              border: `1px solid ${T.border}`, background: T.inputBg, color: T.text,
              fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
            }}
          />
          {open && filtered.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
              maxHeight: 240, overflowY: "auto", zIndex: 20,
              boxShadow: "0 10px 24px rgba(0,0,0,0.30)",
            }}>
              {filtered.map(m => (
                <div key={m.id} onMouseDown={() => pick(m)}
                  style={{
                    padding: "7px 10px", cursor: "pointer",
                    borderBottom: `1px solid ${T.sectionDivider}`, fontSize: FONT.sm.size, color: T.text,
                  }}>
                  <div style={{ fontWeight: 600 }}>{m.nom}</div>
                  {(m.reference || m.fournisseur || m.unite) && (
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>
                      {m.reference}{m.reference && m.fournisseur ? " · " : ""}{m.fournisseur}
                      {m.unite ? <span style={{ marginLeft: m.reference || m.fournisseur ? 6 : 0 }}>· {m.unite}</span> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {open && q && filtered.length === 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
              padding: "8px 12px", zIndex: 20, fontSize: FONT.xs.size + 1, color: T.textMuted,
              boxShadow: "0 10px 24px rgba(0,0,0,0.30)",
            }}>
              Aucun matériau trouvé pour « {search} »
            </div>
          )}
        </div>
      )}

      {/* Quantité par unité d'ouvrage */}
      <input
        type="number" min="0" step="0.01"
        value={ml.quantite ?? ""}
        onChange={e => update("quantite", e.target.value === "" ? null : parseFloat(e.target.value))}
        placeholder="Qté / u"
        style={{
          padding: "6px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
          background: T.inputBg, color: T.text, fontFamily: "inherit",
          fontSize: FONT.sm.size, outline: "none", textAlign: "center",
        }}
      />

      {/* Unité (depuis matériau, read-only) */}
      <div style={{
        padding: "6px 4px", color: T.textMuted,
        fontSize: FONT.xs.size + 1, textAlign: "center", fontWeight: 600,
      }}>
        {mat?.unite || "—"}
      </div>

      {/* Prix calculé */}
      <div style={{
        padding: "6px 4px", color: prixLigne != null ? T.text : T.textMuted,
        fontSize: FONT.xs.size + 1, textAlign: "right", fontWeight: prixLigne != null ? 700 : 400,
      }}>
        {prixLigne != null ? `${prixLigne.toFixed(2)} €` : "—"}
      </div>

      <button onClick={remove} title="Retirer ce matériau" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", color: "#e15a5a",
        cursor: "pointer", padding: 0, lineHeight: 1,
      }}>
        <Icon as={X} size={14}/>
      </button>
    </div>
  );
}

// ─── OUVRAGE CARD ─────────────────────────────────────────────────────────────
function OuvrageCard({ ouvrage, isEdit, onToggleEdit, onSave, onDelete, onDuplicate, saving, ouvrages, setOuvrages, categories, getCat, changerCategorie, materiaux, groupesTypes, coutHoraire, tauxHoraires = [], tauxOrigineId = null, T, acc }) {
  const editData = ouvrages.find(o => o.id === ouvrage.id) || ouvrage;
  const currentCat = getCat(ouvrage.identifiant);
  const cadence = parseFloat(ouvrage.cadence) || null;
  const isV2 = estOuvrageV2(editData);
  const maturite = isV2 ? maturiteOuvrageV2(editData) : null;
  // Prix calculé (module pur chiffragePricing) : matériaux × coefficient
  // (+ coût direct × coefficient) + cadence × taux horaire de VENTE sélectionné.
  // Le coût horaire chargé ne sert plus qu'à la marge.
  const prix = calculerOuvrage(editData, { materiaux, coutHoraire, tauxHoraires });
  // Liste déroulante : taux actifs + le taux (désactivé) déjà enregistré sur l'ouvrage
  const optionsTaux = optionsSelectTaux(tauxHoraires, tauxOrigineId ?? editData.taux_horaire_vente_id);
  const tauxChoisi = editData.taux_horaire_vente_id != null ? String(editData.taux_horaire_vente_id) : "";
  const patchOuvrage = (patch) => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, ...patch }));

  // Bloque l'auto-reload pendant l'édition d'un ouvrage (sauvegarde au clic).
  useDirtyGuard("ouvrage-edit-" + ouvrage.id, isEdit);

  function addSousTache() {
    const next = [...(editData.sous_taches || []), isV2
      ? { id: nouvelIdSousTache(), nom: "", lotId: "", groupe_type_id: null, ratio: null, dependance_mode: DEPENDANCE_MODES.PARALLEL, predecesseur_ids: [], delai_min_calendaire: 0, unite_delai: "heures" }
      : { nom: "", lotId: "", ratio: null }];
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function addMateriauLien() {
    const next = [...(editData.materiaux_liens || []), { materiau_id: null, quantite: null }];
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, materiaux_liens: next }));
  }

  const liens = editData.materiaux_liens || [];
  const coutTotalParUnite = liens.reduce((s, ml) => {
    const m = materiaux.find(x => x.id === ml.materiau_id);
    if (!m || ml.quantite == null) return s;
    return s + (parseFloat(m.prix_unitaire) || 0) * (parseFloat(ml.quantite) || 0);
  }, 0);

  return (
    <div style={{
      background: T.surface, border: `1px solid ${isEdit ? acc.accent : T.border}`,
      borderRadius: RADIUS.xl, overflow: "hidden", transition: "border .2s",
    }}>
      {/* En-tête cliquable */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", cursor: "pointer" }}
        onClick={() => onToggleEdit(ouvrage.id)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, letterSpacing: -.1 }}>{ouvrage.libelle}</span>
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted, background: T.card,
            padding: "2px 8px", borderRadius: RADIUS.sm, fontWeight: 600 }}>{ouvrage.unite}</span>
          {cadence
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: FONT.xs.size + 1, fontWeight: 700, color: acc.accent,
                background: `${acc.accent}18`, padding: "2px 9px",
                borderRadius: RADIUS.pill, border: `1px solid ${acc.accent}33` }}>
                <Icon as={Clock} size={10}/>
                {cadence}h / {ouvrage.unite}
              </span>
            : <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>Pas de cadence</span>
          }
          {prix.complet ? (
            <span title={`Matériaux ${fmtEur2(prix.coutMateriauxUnitaire)} ${fmtCoef(prix.coefVente)} = ${fmtEur2(prix.prixMateriauxUnitaire)}${prix.prixDirectUnitaire ? ` + coût direct ${fmtEur2(prix.prixDirectUnitaire)}` : ""} + main-d'œuvre ${expliquerPrixMainOeuvre(prix.mainOeuvre.heures, prix.mainOeuvre.tauxVente) || "—"} (${prix.tauxHoraire.libelle || "taux"})${prix.margeUnitaire != null ? ` · marge ${fmtEur2(prix.margeUnitaire)} soit ${prix.tauxMargePct} % du prix de vente` : " · marge non calculable (coût horaire chargé non réglé)"}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size + 1, fontWeight: 800, color: "#22c55e",
                background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.28)", padding: "2px 9px", borderRadius: RADIUS.pill }}>
              <Icon as={Euro} size={10}/>
              {fmtEur2(prix.prixVenteUnitaire)} HT / {prix.unite} · MO {prix.mainOeuvre.tauxVente} €/h{prix.tauxHoraire.actif === false ? " (désactivé)" : ""}
            </span>
          ) : (
            <span title={prix.erreurs.join(" · ")}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size, fontWeight: 700, color: "#e15a5a",
                background: "rgba(225,90,90,.10)", border: "1px solid rgba(225,90,90,.28)", padding: "2px 8px", borderRadius: RADIUS.pill }}>
              <Icon as={AlertTriangle} size={10}/>
              Prix incalculable ({prix.erreurs.length})
            </span>
          )}
          {maturite && (
            <span title={[...(maturite.erreurs || []), ...(maturite.warnings || [])].join(" · ")} style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size, fontWeight: 700,
              color: maturite.planifiable ? "#22c55e" : "#f5a623",
              background: maturite.planifiable ? "rgba(34,197,94,.10)" : "rgba(245,166,35,.10)",
              border: `1px solid ${maturite.planifiable ? "rgba(34,197,94,.28)" : "rgba(245,166,35,.28)"}`,
              padding: "2px 8px", borderRadius: RADIUS.pill,
            }}>
              <Icon as={maturite.planifiable ? Check : AlertTriangle} size={10}/>
              {maturite.planifiable ? "Prêt planning" : "Planning à compléter"}
            </span>
          )}
          {/* Aperçu des sous-tâches */}
          {!isEdit && (ouvrage.sous_taches || []).length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(ouvrage.sous_taches || []).slice(0, 4).map((st, i) => {
                const lo = LOTS.find(l => l.id === (st.lotId ?? st.phaseId));
                return (
                  <span key={i} style={{
                    fontSize: FONT.xs.size, padding: "2px 7px", borderRadius: RADIUS.sm,
                    background: lo ? `${lo.couleur}22` : T.card,
                    color: lo ? lo.couleur : T.textMuted,
                    border: `1px solid ${lo ? lo.couleur + "44" : T.border}`,
                    fontWeight: 600,
                  }}>{st.nom || "—"}</span>
                );
              })}
              {(ouvrage.sous_taches || []).length > 4 && (
                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, padding: "2px 6px" }}>+{ouvrage.sous_taches.length - 4}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{(ouvrage.sous_taches || []).length} sous-tâche{(ouvrage.sous_taches || []).length > 1 ? "s" : ""}</span>
          <Icon as={isEdit ? ChevronUp : ChevronDown} size={14} color={isEdit ? acc.accent : T.textMuted}/>
        </div>
      </div>

      {/* Zone édition */}
      {isEdit && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.sectionDivider}` }}>

          {/* Propriétés principales */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12,
            marginTop: 14, marginBottom: 14, padding: "14px 16px",
            background: T.card, borderRadius: 10, border: `1px solid ${T.border}`,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Nom</label>
              <input
                value={editData.libelle}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, libelle: e.target.value }))}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 12px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Unité</label>
              <input
                value={editData.unite}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, unite: e.target.value }))}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Catégorie</label>
              <select
                value={currentCat}
                onChange={e => { e.stopPropagation(); changerCategorie(ouvrage.id, e.target.value); }}
                onClick={e => e.stopPropagation()}
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none", cursor: "pointer" }}
              >
                {categories.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                <option value="Autre">Autre</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Cadence (h/{editData.unite || "u"})</label>
              <input
                type="number" min="0.01" step="0.05"
                value={editData.cadence ?? ""}
                onChange={e => setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, cadence: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                onClick={e => e.stopPropagation()}
                placeholder="ex: 0.5"
                style={{ padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.accent}55`, color: T.accent, fontFamily: "inherit", fontSize: 15, fontWeight: 800, outline: "none", textAlign: "center" }}
              />
            </div>
          </div>

          {/* ── Prix de vente calculé (Profero = source de vérité du prix) ──
              Formule v2 : matériaux × coefficient + coût direct × coefficient
              (traitement historique conservé) + cadence × taux horaire de VENTE. */}
          {(() => {
            const cellLbl = { fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 };
            const cellVal = (ok = true) => ({ fontSize: FONT.sm.size + 1, fontWeight: 800, color: ok ? T.text : T.textMuted, marginTop: 4 });
            const inputS = { padding: "8px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none", textAlign: "center", width: "100%" };
            const coefSaisi = editData.coef_vente ?? "";
            const coef = validerCoefficient(coefSaisi);
            const coefRequis = (editData.materiaux_liens || []).some(l => l && l.materiau_id != null) || (parseFloat(editData.cout_direct_unitaire) || 0) > 0;
            const tauxOk = prix.tauxHoraire.valide;
            const explicationMO = expliquerPrixMainOeuvre(prix.mainOeuvre.heures, prix.mainOeuvre.tauxVente);
            return (
              <div style={{ marginBottom: 14, padding: "14px 16px", background: T.card, borderRadius: 10, border: `1px solid ${prix.complet ? "rgba(34,197,94,.35)" : T.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <Icon as={Euro} size={12} color={acc.accent}/>
                    <div style={cellLbl}>Prix de vente calculé</div>
                    <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                      matériaux × coefficient + main-d'œuvre (cadence × taux horaire de vente){prix.coutDirectUnitaire ? " + coût direct × coefficient" : ""}
                    </span>
                  </div>
                  <span style={{ fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
                    color: prix.complet ? "#22c55e" : "#e15a5a", background: prix.complet ? "rgba(34,197,94,.10)" : "rgba(225,90,90,.10)",
                    border: `1px solid ${prix.complet ? "rgba(34,197,94,.28)" : "rgba(225,90,90,.28)"}` }}>
                    {prix.complet ? "Complet — prix figé à l'ajout dans un chiffrage" : "Incomplet — l'ouvrage ne peut pas être chiffré"}
                  </span>
                </div>

                {/* Ligne 1 : matériaux */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                  <div>
                    <div style={cellLbl}>Coût matériaux HT / {prix.unite}</div>
                    <div style={cellVal(prix.coutMateriauxUnitaire != null)}>{fmtEur2(prix.coutMateriauxUnitaire)}</div>
                  </div>
                  <div>
                    <label style={cellLbl}>Coefficient matériaux (×)</label>
                    <div style={{ position: "relative", marginTop: 4 }}>
                      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textMuted, fontSize: FONT.sm.size, fontWeight: 800, pointerEvents: "none" }}>×</span>
                      <input type="number" min="1" step="0.05" value={coefSaisi} placeholder={coefRequis ? "ex : 1,35" : "sans objet"}
                        onClick={e => e.stopPropagation()}
                        onChange={e => patchOuvrage({ coef_vente: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        style={{ ...inputS, border: `1px solid ${coef.valide || !coefRequis ? T.accent + "55" : "rgba(225,90,90,.6)"}`, color: coef.valide ? T.accent : coefRequis ? "#e15a5a" : T.textMuted, paddingLeft: 24 }}/>
                    </div>
                    <div style={{ fontSize: FONT.xs.size, color: coef.valide || !coefRequis ? T.textMuted : "#e15a5a", marginTop: 3 }}>
                      {coef.valide ? "appliqué aux matériaux seulement" : (coefSaisi === "" && editData.taux_marge_pct != null && coefRequis ? `repli : ancien taux ${editData.taux_marge_pct} % ⇒ ${fmtCoef(prix.coefVente)}` : coefRequis ? coef.erreur : "aucun matériau : inutile")}
                    </div>
                  </div>
                  <div>
                    <div style={cellLbl}>Prix matériaux HT / {prix.unite}</div>
                    <div style={cellVal(prix.prixMateriauxUnitaire != null)}>{fmtEur2(prix.prixMateriauxUnitaire)}</div>
                    {prix.prixMateriauxUnitaire != null && <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>{fmtEur2(prix.coutMateriauxUnitaire)} {fmtCoef(prix.coefVente)}</div>}
                  </div>
                  <div>
                    <label style={cellLbl}>Coût direct compl. / {prix.unite}</label>
                    <input type="number" min="0" step="0.01" value={editData.cout_direct_unitaire ?? ""} placeholder="0"
                      onClick={e => e.stopPropagation()}
                      onChange={e => patchOuvrage({ cout_direct_unitaire: e.target.value === "" ? null : parseFloat(e.target.value) })}
                      style={{ ...inputS, marginTop: 4 }}/>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>{prix.coutDirectUnitaire ? `vendu ${fmtEur2(prix.prixDirectUnitaire)} (× coefficient)` : "location, évacuation… (× coefficient)"}</div>
                  </div>
                </div>

                {/* Ligne 2 : main-d'œuvre */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.sectionDivider || T.border}` }}>
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={cellLbl}>Taux horaire de main-d'œuvre *</label>
                    <select value={tauxChoisi} required
                      onClick={e => e.stopPropagation()}
                      onChange={e => patchOuvrage({ taux_horaire_vente_id: e.target.value || null })}
                      style={{ ...inputS, marginTop: 4, textAlign: "left", cursor: "pointer", border: `1px solid ${tauxOk ? T.accent + "55" : "rgba(225,90,90,.6)"}`, color: tauxOk ? T.accent : "#e15a5a" }}>
                      {!tauxChoisi && <option value="">— Sélectionner un taux —</option>}
                      {tauxChoisi && !optionsTaux.some(o => o.id === tauxChoisi) && <option value={tauxChoisi}>Taux introuvable (à remplacer)</option>}
                      {optionsTaux.map(o => <option key={o.id} value={o.id}>{o.texte}</option>)}
                    </select>
                    <div style={{ fontSize: FONT.xs.size, color: prix.tauxHoraire.actif === false ? "#f5a623" : T.textMuted, marginTop: 3 }}>
                      {prix.tauxHoraire.actif === false ? "Taux désactivé : conservé sur cet ouvrage, choisir un autre taux pour les futurs chiffrages" : optionsTaux.length === 0 ? "Aucun taux actif : Réglages → Taux horaires" : "Liste gérée dans Réglages → Taux horaires"}
                    </div>
                  </div>
                  <div>
                    <div style={cellLbl}>Prix main-d'œuvre HT / {prix.unite}</div>
                    <div style={cellVal(prix.prixMainOeuvreUnitaire != null)}>{fmtEur2(prix.prixMainOeuvreUnitaire)}</div>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>{explicationMO ? `Main-d'œuvre : ${explicationMO}` : "cadence × taux horaire"}</div>
                  </div>
                  <div>
                    <div style={cellLbl}>Prix de vente HT / {prix.unite}</div>
                    <div style={{ ...cellVal(prix.prixVenteUnitaire != null), color: prix.prixVenteUnitaire != null ? "#22c55e" : T.textMuted, fontSize: FONT.md.size }}>{fmtEur2(prix.prixVenteUnitaire)}</div>
                    {prix.prixVenteUnitaire != null && <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>{fmtEur2(prix.prixMateriauxUnitaire)}{prix.prixDirectUnitaire ? ` + ${fmtEur2(prix.prixDirectUnitaire)}` : ""} + {fmtEur2(prix.prixMainOeuvreUnitaire)}</div>}
                  </div>
                </div>

                {/* Ligne 3 : coût et marge (coût horaire chargé de référence) */}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.sectionDivider || T.border}`, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                  <span>Coût MO {fmtEur2(prix.coutMainOeuvreUnitaire)}{prix.mainOeuvre.heures != null && prix.mainOeuvre.coutHoraire != null ? ` (${prix.mainOeuvre.heures} h × ${prix.mainOeuvre.coutHoraire} €/h chargé)` : ""}</span>
                  <span>Coût total {fmtEur2(prix.coutTotalUnitaire)}</span>
                  <span style={{ fontWeight: 700, color: prix.margeUnitaire != null ? T.text : T.textMuted }}>
                    {prix.margeUnitaire != null ? `Marge ${fmtEur2(prix.margeUnitaire)} · ${prix.tauxMargeReel} % du prix de vente` : "Marge non calculable"}
                  </span>
                </div>

                <label onClick={e => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textSub, cursor: "pointer" }}>
                  <input type="checkbox" checked={editData.main_oeuvre_seule === true}
                    onChange={e => patchOuvrage({ main_oeuvre_seule: e.target.checked })} style={{ accentColor: acc.accent, width: 15, height: 15 }}/>
                  Ouvrage <strong style={{ color: T.text }}>main-d'œuvre seule</strong> (volontairement sans matériau — dépose, démolition, forfait de pose…)
                </label>
                {(prix.erreurs.length > 0 || prix.avertissements.length > 0) && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                    {prix.erreurs.map((e, i) => (
                      <div key={`e${i}`} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: FONT.xs.size + 1, color: "#e15a5a" }}>
                        <Icon as={AlertTriangle} size={11} style={{ marginTop: 2, flexShrink: 0 }}/>{e}
                      </div>
                    ))}
                    {prix.avertissements.map((a, i) => (
                      <div key={`a${i}`} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: FONT.xs.size + 1, color: "#f5a623" }}>
                        <Icon as={AlertTriangle} size={11} style={{ marginTop: 2, flexShrink: 0 }}/>{a}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {maturite && isEdit && (
            <div style={{
              display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 12,
              borderRadius: RADIUS.md,
              background: maturite.planifiable ? "rgba(34,197,94,.08)" : "rgba(245,166,35,.08)",
              border: `1px solid ${maturite.planifiable ? "rgba(34,197,94,.25)" : "rgba(245,166,35,.25)"}`,
            }}>
              <Icon as={maturite.planifiable ? Check : AlertTriangle} size={14} color={maturite.planifiable ? "#22c55e" : "#f5a623"} style={{ marginTop: 1, flexShrink: 0 }}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: maturite.planifiable ? "#22c55e" : "#f5a623" }}>
                  {maturite.planifiable ? "Ouvrage prêt pour la planification automatique" : "Référentiel planning incomplet"}
                </div>
                {!maturite.planifiable && (
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 3, lineHeight: 1.5 }}>
                    {(maturite.erreurs || []).join(" · ")}
                  </div>
                )}
                {(maturite.warnings || []).length > 0 && (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>
                    {(maturite.warnings || []).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* En-tête colonnes sous-tâches + total ratios */}
          {(editData.sous_taches || []).length > 0 && (() => {
            const sumRatios = (editData.sous_taches || [])
              .reduce((s, st) => s + (parseFloat(st.ratio) || 0), 0);
            const ratioOk = sumRatios === 100;
            const ratioColor = sumRatios === 0
              ? T.textMuted
              : ratioOk ? "#22c55e" : "#f5a623";
            return (
              <>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 6, paddingLeft: 2,
                }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: T.textMuted,
                      textTransform: "uppercase", letterSpacing: 1,
                    }}>Sous-tâches</div>
                    <div style={{
                      fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 600,
                      background: T.card, borderRadius: RADIUS.pill, padding: "1px 7px",
                    }}>{(editData.sous_taches || []).length}</div>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                      L'ordre est repris dans le phasage
                    </div>
                  </div>
                  <div title="Le total des ratios doit faire 100 % pour répartir correctement les heures estimées de l'ouvrage entre les sous-tâches."
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: ratioColor,
                    }}>
                    Σ ratios = {sumRatios.toFixed(0)} %
                    {!ratioOk && sumRatios > 0 && <Icon as={AlertTriangle} size={11}/>}
                  </div>
                </div>
                <div style={{
                  display: "grid", gridTemplateColumns: "20px minmax(220px,1.4fr) 150px 190px 72px 26px",
                  gap: 8, padding: "0 12px 6px",
                }}>
                  {["", "Nom de la sous-tâche", "Lot", "Groupe d’exécution", "Ratio", ""].map((h, i) => (
                    <div key={i} style={{
                      fontSize: 10, fontWeight: 700, color: T.textMuted,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      textAlign: i === 4 ? "center" : "left",
                    }}>{h}</div>
                  ))}
                </div>
              </>
            );
          })()}

          {/* Liste des sous-tâches */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(editData.sous_taches || []).map((st, idx) => (
              <SousTacheRow
                key={st.id || idx}
                st={st} idx={idx}
                editData={editData} ouvrage={ouvrage}
                setOuvrages={setOuvrages} ouvrages={ouvrages}
                groupesTypes={groupesTypes}
                T={T}
              />
            ))}
          </div>

          {/* Bouton ajout sous-tâche */}
          <button
            onClick={addSousTache}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              marginTop: 8, width: "100%", padding: "9px",
              border: `1.5px dashed ${T.border}`, borderRadius: RADIUS.md,
              background: "transparent", color: T.textMuted,
              fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
            }}>
            <Icon as={Plus} size={12}/>
            Ajouter une sous-tâche
          </button>

          {/* ── Matériaux liés ─────────────────────────────────────────────── */}
          <div style={{
            marginTop: 22, paddingTop: 14, borderTop: `1px dashed ${T.sectionDivider}`,
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 10, paddingLeft: 2,
            }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Icon as={Package} size={12} color={acc.accent}/>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: T.textMuted,
                  textTransform: "uppercase", letterSpacing: 1,
                }}>Matériaux liés</div>
                <div style={{
                  fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 600,
                  background: T.card, borderRadius: RADIUS.pill, padding: "1px 7px",
                }}>{liens.length}</div>
              </div>
              {coutTotalParUnite > 0 && (
                <div style={{ fontSize: FONT.xs.size + 1, color: T.text, fontWeight: 700 }}>
                  {coutTotalParUnite.toFixed(2)} € / {editData.unite || "u"}
                </div>
              )}
            </div>

            {liens.length > 0 && (
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 100px 60px 80px 26px",
                gap: 8, padding: "0 12px 6px",
              }}>
                {["Matériau", "Qté / u", "Unité", "Prix", ""].map((h, i) => (
                  <div key={i} style={{
                    fontSize: 10, fontWeight: 700, color: T.textMuted,
                    textTransform: "uppercase", letterSpacing: 0.8,
                    textAlign: i === 0 ? "left" : i === 3 ? "right" : "center",
                  }}>{h}</div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {liens.map((ml, idx) => (
                <MateriauLienRow
                  key={idx}
                  ml={ml} idx={idx}
                  editData={editData} ouvrage={ouvrage}
                  setOuvrages={setOuvrages} ouvrages={ouvrages}
                  materiaux={materiaux}
                  T={T} acc={acc}
                />
              ))}
            </div>

            <button
              onClick={addMateriauLien}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                marginTop: 8, width: "100%", padding: "9px",
                border: `1.5px dashed ${T.border}`, borderRadius: RADIUS.md,
                background: "transparent", color: T.textMuted,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
              }}>
              <Icon as={Plus} size={12}/>
              Ajouter un matériau
            </button>
          </div>

          {/* Footer */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.sectionDivider}`,
            flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => onDelete(ouvrage.id)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "transparent", border: "1px solid rgba(224,92,92,0.3)",
                  borderRadius: RADIUS.md, padding: "8px 14px", color: "#e15a5a",
                  fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
                }}>
                <Icon as={Trash2} size={12}/>
                Supprimer
              </button>
              <button
                onClick={() => onDuplicate(editData)}
                title="Créer une copie de cet ouvrage (sous-tâches et matériaux inclus) pour en faire une déclinaison"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "transparent", border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md, padding: "8px 14px", color: T.textSub,
                  fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
                }}>
                <Icon as={Copy} size={12}/>
                Dupliquer
              </button>
            </div>
            <button
              onClick={() => onSave(editData)}
              disabled={saving === ouvrage.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
                background: acc.accent, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
                opacity: saving === ouvrage.id ? .6 : 1,
              }}>
              <Icon as={Check} size={13}/>
              {saving === ouvrage.id ? "Sauvegarde…" : "Sauvegarder"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE BIBLIOTHÈQUE (refonte) ─────────────────────────────────────────────
function PageBibliotheque({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [ouvrages, setOuvrages] = useState([]);
  const [materiaux, setMateriaux] = useState([]);
  const [groupesTypes, setGroupesTypes] = useState([]);
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

  const [toDelete, setToDelete] = useState(null);       // ouvrage à supprimer
  const [catToDelete, setCatToDelete] = useState(null); // catégorie à supprimer
  const [deleting, setDeleting] = useState(false);
  // Coût horaire chargé de référence (planning_config.taux_mo_previsionnel,
  // Admin → Taux). null = non réglé ⇒ aucun prix calculable (état bloquant).
  const [coutHoraire, setCoutHoraire] = useState(null);
  // Taux horaires de VENTE (table taux_horaires_vente) : prix MO = cadence × taux
  // sélectionné sur l'ouvrage. Liste vide = aucun prix calculable (bloquant).
  const [tauxHoraires, setTauxHoraires] = useState([]);
  const [newTauxId, setNewTauxId] = useState("");
  // Taux enregistré en base par ouvrage (avant édition) : un taux désactivé est
  // conservé tant qu'on n'en choisit pas un autre.
  const tauxOrigine = useRef(new Map());
  // Colonnes de prix absentes en base (SQL 202609_chiffrage_devis_logement.sql pas lancé)
  const [schemaPrixManquant, setSchemaPrixManquant] = useState(false);

  const categories = [...CATEGORIES_BASE, ...categoriesCustom];

  useEffect(() => {
    loadOuvrages();
    loadCategoriesCustom();
    loadMateriaux();
    loadCoutHoraire();
    loadTauxHoraires();
    loadGroupesTypes().then(setGroupesTypes);
    const chTaux = supabase.channel("biblio-taux-rt")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "planning_config", filter: "key=eq.taux_mo_previsionnel" },
          () => loadCoutHoraire())
      .on("postgres_changes", { event: "*", schema: "public", table: "taux_horaires_vente" },
          () => loadTauxHoraires())
      .subscribe();
    // Realtime : tout changement de la bibliothèque ou des catégories custom
    // est propagé en direct chez tous les utilisateurs connectés.
    const chOuvr = supabase.channel("biblio-ouvrages-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "bibliotheque_ratios" },
          () => loadOuvrages())
      .subscribe();
    const chCat = supabase.channel("biblio-cats-rt")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "planning_config", filter: "key=eq.bibliotheque_categories_custom" },
          () => loadCategoriesCustom())
      .subscribe();
    const chMat = supabase.channel("biblio-materiaux-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiaux_bibliotheque" },
          () => loadMateriaux())
      .subscribe();
    return () => {
      supabase.removeChannel(chOuvr);
      supabase.removeChannel(chCat);
      supabase.removeChannel(chMat);
      supabase.removeChannel(chTaux);
    };
  }, []);

  async function loadTauxHoraires() {
    const { data, error } = await supabase.from("taux_horaires_vente").select("*").order("libelle");
    if (error) {
      if (/taux_horaires_vente/.test(error.message || "")) setSchemaPrixManquant(true);
      return;
    }
    setTauxHoraires(data || []);
  }
  // Présélection du taux actif par défaut dans le formulaire « Nouvel ouvrage »
  useEffect(() => {
    const d = tauxParDefaut(tauxHoraires);
    if (d && (!newTauxId || !tauxHoraires.some(t => String(t.id) === newTauxId && t.actif !== false))) setNewTauxId(String(d.id));
  }, [tauxHoraires]);

  async function loadCoutHoraire() {
    const { data } = await supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle();
    const v = parseFloat(data?.value);
    setCoutHoraire(Number.isFinite(v) && v > 0 ? v : null);
  }

  async function loadMateriaux() {
    const { data } = await supabase.from("materiaux_bibliotheque")
      .select("id,nom,reference,unite,prix_unitaire,fournisseur,categorie")
      .order("nom");
    setMateriaux(data || []);
  }

  async function loadOuvrages() {
    setLoading(true);
    const { data } = await supabase.from("bibliotheque_ratios").select("*").order("libelle");
    if (data && data.length > 0) {
      tauxOrigine.current = new Map(data.map(o => [o.id, o.taux_horaire_vente_id ?? null]));
      setOuvrages(data.map(o => estOuvrageV2(o) ? normaliserOuvrageV2(o, { assignIds: true }) : o));
    } else {
      const inserts = BIBLIOTHEQUE_INITIALE.map(o => ({
        identifiant: o.identifiant, libelle: o.libelle, unite: o.unite || "", sous_taches: o.sous_taches,
      }));
      const { data: inserted } = await supabase.from("bibliotheque_ratios").insert(inserts).select();
      setOuvrages(inserted || []);
    }
    setLoading(false);
  }

  // Catégories custom : stockées dans planning_config (partagées entre tous les
  // utilisateurs). Migration douce depuis l'ancien localStorage : si Supabase
  // n'a pas encore de données mais que localStorage en a, on les remonte.
  async function loadCategoriesCustom() {
    const { data } = await supabase.from("planning_config")
      .select("value").eq("key", "bibliotheque_categories_custom").maybeSingle();
    if (data?.value && Array.isArray(data.value.items)) {
      setCategoriesCustom(data.value.items);
      return;
    }
    // Pas en base : on tente la migration depuis localStorage si présent
    try {
      const stored = localStorage.getItem("bibliotheque_categories_custom");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCategoriesCustom(parsed);
          // Push vers Supabase pour partager avec l'équipe (one-shot migration)
          await supabase.from("planning_config").upsert(
            { key: "bibliotheque_categories_custom", value: { items: parsed } },
            { onConflict: "key" }
          );
        }
      }
    } catch (_) {}
  }

  async function saveCategoriesCustom(cats) {
    setCategoriesCustom(cats);
    await supabase.from("planning_config").upsert(
      { key: "bibliotheque_categories_custom", value: { items: cats } },
      { onConflict: "key" }
    );
  }

  function creerCategorie() {
    const label = newCatLabel.trim();
    const id = newCatId.trim() || label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!label || !id) return;
    if (categories.some(c => c.label === label)) { setMsg({ type: "error", text: "Une catégorie avec ce nom existe déjà" }); return; }
    saveCategoriesCustom([...categoriesCustom, { label, ids: [id], custom: true }]);
    setShowNewCat(false); setNewCatLabel(""); setNewCatId("");
    flash("ok", `Catégorie « ${label} » créée`);
  }

  async function confirmSupprimerCategorie() {
    if (!catToDelete) return;
    const catLabel = catToDelete;
    setDeleting(true);
    const cat = categoriesCustom.find(c => c.label === catLabel);
    if (!cat?.custom) { setDeleting(false); setCatToDelete(null); return; }
    const affected = ouvrages.filter(o => cat.ids.some(k => o.identifiant?.startsWith(k)));
    if (affected.length > 0) {
      await Promise.all(affected.map(o => supabase.from("bibliotheque_ratios").update({ identifiant: `autre_${o.id}` }).eq("id", o.id)));
      setOuvrages(prev => prev.map(o => affected.find(a => a.id === o.id) ? { ...o, identifiant: `autre_${o.id}` } : o));
    }
    saveCategoriesCustom(categoriesCustom.filter(c => c.label !== catLabel));
    if (filterCat === catLabel) setFilterCat("Toutes");
    setDeleting(false);
    setCatToDelete(null);
    flash("ok", "Catégorie supprimée.");
  }

  async function changerCategorie(ouvrageId, newCatLabel) {
    const cat = categories.find(c => c.label === newCatLabel);
    const prefix = cat ? cat.ids[0] : "autre";
    const newId = `${prefix}_${ouvrageId}`;
    await supabase.from("bibliotheque_ratios").update({ identifiant: newId }).eq("id", ouvrageId);
    setOuvrages(prev => prev.map(o => o.id === ouvrageId ? { ...o, identifiant: newId } : o));
  }

  async function creerOuvrage() {
    if (!newLibelle.trim()) return;
    // Taux horaire obligatoire : référence stable vers taux_horaires_vente (jamais la valeur)
    const tauxId = newTauxId || tauxSelectionne(tauxHoraires, null);
    const ctrl = validerTauxOuvrage(tauxHoraires, tauxId);
    if (!ctrl.valide) { flash("error", ctrl.erreur); return; }
    const newO = { identifiant: `${newCatPrefix}_${Date.now()}`, libelle: newLibelle.trim(), unite: newUnite, cadence: null, sous_taches: [], taux_horaire_vente_id: tauxId };
    const { data, error } = await supabase.from("bibliotheque_ratios").insert([newO]).select();
    if (error || !data?.[0]) { flash("error", "Création impossible : " + (error?.message || "insertion vide")); return; }
    tauxOrigine.current.set(data[0].id, data[0].taux_horaire_vente_id ?? null);
    setOuvrages(prev => [...prev, data[0]]);
    setShowNew(false); setNewLibelle(""); setNewUnite("U");
    setEditId(data[0].id);
  }

  // Clone complet d'un ouvrage (état affiché, y compris modifs non sauvegardées)
  // pour créer une déclinaison : sous-tâches et matériaux liés copiés, même
  // catégorie (préfixe d'identifiant conservé), et ouverture directe en édition.
  async function dupliquerOuvrage(ouvrage) {
    let prefix = "autre";
    for (const cat of categories) {
      const match = cat.ids.find(k => ouvrage.identifiant?.startsWith(k));
      if (match) { prefix = match; break; }
    }
    const clone = {
      identifiant: `${prefix}_${Date.now()}`,
      libelle: `${ouvrage.libelle} (copie)`,
      unite: ouvrage.unite || "",
      cadence: ouvrage.cadence ?? null,
      sous_taches: estOuvrageV2(ouvrage)
        ? dupliquerSousTachesV2(ouvrage.sous_taches || [])
        : JSON.parse(JSON.stringify(ouvrage.sous_taches || [])),
      materiaux_liens: JSON.parse(JSON.stringify(ouvrage.materiaux_liens || [])),
    };
    // Le taux de la source est repris s'il est encore actif ; sinon le taux par défaut.
    const tauxSource = tauxHoraires.find(t => String(t.id) === String(ouvrage.taux_horaire_vente_id ?? ""));
    const prixClone = {
      coef_vente: ouvrage.coef_vente ?? null,
      taux_marge_pct: ouvrage.taux_marge_pct ?? null,
      main_oeuvre_seule: ouvrage.main_oeuvre_seule === true,
      cout_direct_unitaire: ouvrage.cout_direct_unitaire ?? null,
      taux_horaire_vente_id: tauxSource && tauxSource.actif !== false ? tauxSource.id : tauxSelectionne(tauxHoraires, null),
    };
    let { data, error } = await supabase.from("bibliotheque_ratios").insert([{ ...clone, ...prixClone }]).select();
    if (erreurColonnesPrix(error)) {
      // Colonnes de prix absentes (SQL pas lancé) : on duplique sans elles
      setSchemaPrixManquant(true);
      ({ data, error } = await supabase.from("bibliotheque_ratios").insert([clone]).select());
    }
    if (error || !data?.[0]) {
      flash("error", "Erreur lors de la duplication : " + (error?.message || "insertion vide"));
      return;
    }
    tauxOrigine.current.set(data[0].id, data[0].taux_horaire_vente_id ?? null);
    setOuvrages(prev => [...prev, data[0]]);
    setEditId(data[0].id);
    flash("ok", `Copie créée : « ${clone.libelle} » — renommez-la et ajustez les différences`);
  }

  async function confirmSupprimerOuvrage() {
    if (!toDelete) return;
    setDeleting(true);
    await supabase.from("bibliotheque_ratios").delete().eq("id", toDelete.id);
    setOuvrages(prev => prev.filter(o => o.id !== toDelete.id));
    if (editId === toDelete.id) setEditId(null);
    setDeleting(false);
    setToDelete(null);
  }

  async function saveOuvrage(ouvrage) {
    setSaving(ouvrage.id);
    const ouvrageClean = estOuvrageV2(ouvrage) ? normaliserOuvrageV2(ouvrage, { assignIds: true }) : ouvrage;
    // Note : la validation "somme ratios = 100 %" a été retirée avec le refactor
    // des heures vendues (elles vivent désormais au niveau ouvrage uniquement).
    // Conserver cette validation bloquait silencieusement la sauvegarde des
    // sous-tâches saisies via la nouvelle UI (sans ratio).
    // Nettoyage : on ne persiste que les liens valides (matériau sélectionné).
    const liensClean = (ouvrageClean.materiaux_liens || [])
      .filter(ml => ml && ml.materiau_id != null)
      .map(ml => ({
        materiau_id: ml.materiau_id,
        quantite: ml.quantite == null ? null : parseFloat(ml.quantite),
      }));
    // Prix : saisie = coefficient de vente (≥ 1) ; le taux de marge équivalent
    // (% du prix de vente) est dérivé et stocké avec lui (contrainte SQL
    // 0 ≤ taux < 100 garantie par coef ≥ 1). Le prix de vente n'est JAMAIS
    // stocké dans la bibliothèque : il est recalculé, puis figé sur chaque
    // ligne de chiffrage au moment de l'ajout.
    const coefSaisi = ouvrageClean.coef_vente;
    const coefVide = coefSaisi == null || coefSaisi === "";
    if (!coefVide && !validerCoefficient(coefSaisi).valide) {
      flash("error", validerCoefficient(coefSaisi).erreur);
      setSaving(null);
      return;
    }
    // Taux horaire : référence obligatoire, existante et active (un taux désactivé
    // n'est accepté que s'il est déjà celui enregistré sur l'ouvrage).
    const ctrlTaux = validerTauxOuvrage(tauxHoraires, ouvrageClean.taux_horaire_vente_id, tauxOrigine.current.get(ouvrage.id));
    if (!ctrlTaux.valide) {
      flash("error", ctrlTaux.erreur);
      setSaving(null);
      return;
    }
    const base = {
      libelle: ouvrageClean.libelle, unite: ouvrageClean.unite,
      cadence: ouvrageClean.cadence ?? null,
      sous_taches: ouvrageClean.sous_taches,
      materiaux_liens: liensClean,
      updated_at: new Date().toISOString(),
    };
    const prixPatch = {
      coef_vente: coefVide ? null : parseFloat(coefSaisi),
      // taux_marge_pct n'est plus une saisie (marge dérivée du prix) : conservé tel quel pour le repli des anciens ouvrages
      taux_marge_pct: ouvrageClean.taux_marge_pct ?? null,
      main_oeuvre_seule: ouvrageClean.main_oeuvre_seule === true,
      cout_direct_unitaire: ouvrageClean.cout_direct_unitaire == null || ouvrageClean.cout_direct_unitaire === "" ? null : parseFloat(ouvrageClean.cout_direct_unitaire),
      taux_horaire_vente_id: ouvrageClean.taux_horaire_vente_id,
    };
    let { error } = await supabase.from("bibliotheque_ratios").update({ ...base, ...prixPatch }).eq("id", ouvrage.id);
    let prixIgnores = false;
    if (erreurColonnesPrix(error)) {
      setSchemaPrixManquant(true);
      prixIgnores = true;
      ({ error } = await supabase.from("bibliotheque_ratios").update(base).eq("id", ouvrage.id));
    }
    if (error) {
      flash("error", "Erreur lors de la sauvegarde : " + error.message);
    } else {
      if (!prixIgnores) tauxOrigine.current.set(ouvrage.id, prixPatch.taux_horaire_vente_id);
      setOuvrages(prev => prev.map(o => o.id === ouvrage.id ? { ...o, ...ouvrageClean, ...(prixIgnores ? {} : prixPatch), materiaux_liens: liensClean } : o));
      flash(prixIgnores ? "error" : "ok", prixIgnores
        ? "Ouvrage sauvegardé SANS le prix : lancer sql/202609_chiffrage_devis_logement.sql dans Supabase"
        : "Ouvrage sauvegardé");
    }
    setSaving(null);
    setEditId(null);
  }

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 2500);
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

  // ── Stats globales ──────────────────────────────────────────────────────────
  const v2 = ouvrages.filter(estOuvrageV2);
  const v2Planifiables = v2.filter(o => maturiteOuvrageV2(o).planifiable).length;
  const prixCalculables = ouvrages.filter(o => calculerOuvrage(o, { materiaux, coutHoraire, tauxHoraires }).complet).length;
  const diagTaux = diagnostiquerListe(tauxHoraires);
  const stats = {
    total: ouvrages.length,
    categories: Object.keys(catCounts).length,
    avecCadence: ouvrages.filter(o => parseFloat(o.cadence) > 0).length,
    sansCadence: ouvrages.filter(o => !o.cadence).length,
    v2Total: v2.length,
    v2Planifiables,
    prixCalculables,
  };

  return (
    <div className="page-padding biblio-page" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <style>{`
        @media(max-width:767px){
          .biblio-page .biblio-actions{width:100%}
          .biblio-page .biblio-actions input{flex:1 1 100%;width:100%!important}
          .biblio-page .biblio-actions button{flex:1}
          .biblio-page .biblio-row{grid-template-columns:1fr!important;gap:8px!important;padding:10px 12px!important}
          .biblio-page .biblio-task-grid{grid-template-columns:1fr!important}
          .biblio-page .biblio-reorder{flex-direction:row!important;gap:16px!important}
        }
      `}</style>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div className="biblio-header" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20, flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: RADIUS.md,
              background: acc.bg10, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon as={Library} size={20} strokeWidth={2}/>
            </div>
            <div>
              <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 2 }}>
                Bibliothèque de ratios
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                Ouvrages, sous-tâches, cadences, matériaux et taux horaire · prix = matériaux × coefficient + cadence × taux horaire de vente, repris par le Chiffrage
                {diagTaux.defaut && <span> · taux par défaut <strong style={{ color: T.text }}>{diagTaux.defaut.libelle} {formaterTauxHT(diagTaux.defaut.taux_ht)}</strong></span>}
                {coutHoraire != null && <span> · coût horaire chargé (marge) <strong style={{ color: T.text }}>{coutHoraire} €/h</strong></span>}
              </div>
            </div>
          </div>
          <div className="biblio-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setShowNew(true)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: acc.accent, color: acc.onAccent, border: "none",
              borderRadius: RADIUS.md, padding: "9px 16px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={Plus} size={14}/>
              Nouvel ouvrage
            </button>
            <button onClick={() => setShowNewCat(true)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: T.surface, color: T.textSub, border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md, padding: "9px 14px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={FolderPlus} size={13}/>
              Catégorie
            </button>
          </div>
        </div>

        {/* ── Taux horaires de vente (bloquant s'il n'y en a aucun) / coût horaire chargé (marge) ── */}
        {!loading && (!diagTaux.ok || coutHoraire == null || schemaPrixManquant) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {!diagTaux.ok && !schemaPrixManquant && (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 14px", borderRadius: RADIUS.md, background: "rgba(225,90,90,.10)", border: "1px solid rgba(225,90,90,.35)", color: "#e15a5a", fontSize: FONT.sm.size, fontWeight: 600 }}>
                <Icon as={AlertTriangle} size={14} style={{ marginTop: 2, flexShrink: 0 }}/>
                <div>
                  {diagTaux.problemes.map((m, i) => <div key={i}>{m}</div>)}
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, fontWeight: 500, marginTop: 3 }}>
                    Réglages → Taux horaires → « Taux horaires de main-d'œuvre ». Le prix de la main-d'œuvre d'un ouvrage = cadence (h/unité) × taux horaire de vente sélectionné.
                  </div>
                </div>
              </div>
            )}
            {coutHoraire == null && (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 14px", borderRadius: RADIUS.md, background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.4)", color: "#f5a623", fontSize: FONT.sm.size, fontWeight: 600 }}>
                <Icon as={AlertTriangle} size={14} style={{ marginTop: 2, flexShrink: 0 }}/>
                <div>
                  Coût horaire chargé de référence non configuré : les prix de vente sont calculés, mais la marge ne peut pas l'être.
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, fontWeight: 500, marginTop: 3 }}>
                    Réglages → onglet Taux → « Taux horaire moyen (prévisionnel) » (€/h chargé) : sert au coût de main-d'œuvre (cadence × coût horaire), donc à la marge.
                  </div>
                </div>
              </div>
            )}
            {schemaPrixManquant && (
              <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "9px 14px", borderRadius: RADIUS.md, background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.4)", color: "#f5a623", fontSize: FONT.xs.size + 1, fontWeight: 600 }}>
                <Icon as={AlertTriangle} size={13}/>
                Base non à jour : lancer <code style={{ fontFamily: "monospace" }}>sql/202609_chiffrage_devis_logement.sql</code>, <code style={{ fontFamily: "monospace" }}>sql/202609_chiffrage_coef_vente.sql</code> puis la migration <code style={{ fontFamily: "monospace" }}>20260915140000_taux_horaires_vente.sql</code> dans Supabase pour enregistrer le coefficient, « main-d'œuvre seule » et le taux horaire.
              </div>
            )}
          </div>
        )}

        {/* ── Stats ── */}
        {!loading && ouvrages.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 10, marginBottom: 14,
          }}>
            {[
              { label: "Total ouvrages", value: stats.total,       icon: Hammer,     color: acc.accent },
              { label: "Catégories",     value: stats.categories,  icon: FolderOpen, color: "#5b9cf6" },
              { label: "Avec cadence",   value: stats.avecCadence, icon: Clock,      color: "#22c55e" },
              { label: "Sans cadence",   value: stats.sansCadence, icon: Box,        color: stats.sansCadence > 0 ? "#f5a623" : T.textMuted },
              { label: "Prix calculables", value: `${stats.prixCalculables}/${stats.total}`, icon: Euro, color: stats.prixCalculables === stats.total && stats.total > 0 ? "#22c55e" : "#e15a5a" },
              { label: "V2 prêts planning", value: `${stats.v2Planifiables}/${stats.v2Total}`, icon: Check, color: stats.v2Planifiables === stats.v2Total && stats.v2Total > 0 ? "#22c55e" : "#f5a623" },
            ].map((s, i) => (
              <div key={i} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: RADIUS.lg, padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                  background: s.color + "18", color: s.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon as={s.icon} size={16} strokeWidth={2}/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: T.text, letterSpacing: -.5, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Recherche + filtres ── */}
        {!loading && ouvrages.length > 0 && (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.lg, padding: "10px 12px", marginBottom: 16,
          }}>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Icon as={Search} size={13} color={T.textMuted}
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un ouvrage…"
                style={{
                  width: "100%", padding: "8px 10px 8px 30px",
                  borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
                  background: T.fieldBg || T.card, color: T.text,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                }}/>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {uniqueCats.map(cat => {
                const count = cat === "Toutes" ? ouvrages.length : (catCounts[cat] || 0);
                const isActive = filterCat === cat;
                const isCustom = categoriesCustom.some(c => c.label === cat);
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center" }}>
                    <button onClick={() => setFilterCat(cat)} style={{
                      padding: "5px 12px", borderRadius: isCustom ? `${RADIUS.md}px 0 0 ${RADIUS.md}px` : RADIUS.md,
                      border: `1px solid ${isActive ? acc.accent : T.border}`, borderRight: isCustom ? "none" : undefined,
                      background: isActive ? `${acc.accent}22` : "transparent", color: isActive ? acc.accent : T.textMuted,
                      fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: isActive ? 700 : 600, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                      {cat}
                      {count > 0 && <span style={{
                        background: isActive ? acc.accent : T.border,
                        color: isActive ? acc.onAccent : T.textMuted,
                        borderRadius: RADIUS.pill, padding: "1px 7px", fontSize: FONT.xs.size, fontWeight: 700,
                      }}>{count}</span>}
                    </button>
                    {isCustom && (
                      <button onClick={() => setCatToDelete(cat)} title="Supprimer cette catégorie"
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          padding: "5px 8px", borderRadius: `0 ${RADIUS.md}px ${RADIUS.md}px 0`,
                          border: `1px solid ${T.border}`, borderLeft: "none",
                          background: "transparent", color: "#e15a5a", cursor: "pointer",
                        }}>
                        <Icon as={X} size={10}/>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Notification ── */}
        {msg && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", borderRadius: RADIUS.md, marginBottom: 14,
            fontSize: FONT.sm.size, fontWeight: 600,
            background: msg.type === "ok" ? "rgba(34,197,94,0.12)" : "rgba(224,92,92,0.12)",
            color: msg.type === "ok" ? "#22c55e" : "#e15a5a",
            border: `1px solid ${msg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(224,92,92,0.3)"}`,
          }}>
            <Icon as={msg.type === "ok" ? Check : AlertTriangle} size={14}/>
            {msg.text}
          </div>
        )}

        {/* ── Form nouvelle catégorie ── */}
        {showNewCat && (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.xl, padding: "18px 22px", marginBottom: 18,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon as={FolderPlus} size={14} color={acc.accent}/>
              <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>Créer une catégorie</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} autoFocus
                placeholder="Nom de la catégorie"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none" }}/>
              <input value={newCatId} onChange={e => setNewCatId(e.target.value)}
                placeholder="Préfixe identifiant (optionnel)"
                style={{ flex: 1, minWidth: 160, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none" }}/>
              <button onClick={creerCategorie} disabled={!newCatLabel.trim()} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                background: newCatLabel.trim() ? acc.accent : T.border, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: newCatLabel.trim() ? "pointer" : "default", opacity: newCatLabel.trim() ? 1 : .6,
              }}>
                <Icon as={Check} size={13}/>
                Créer
              </button>
              <button onClick={() => setShowNewCat(false)} style={{
                padding: "9px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textMuted,
                fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── Form nouvel ouvrage ── */}
        {showNew && (
          <div style={{
            background: T.surface, border: `1px solid ${acc.accent}`,
            borderRadius: RADIUS.xl, padding: "18px 22px", marginBottom: 18,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon as={Hammer} size={14} color={acc.accent}/>
              <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>Créer un nouvel ouvrage</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={newLibelle} onChange={e => setNewLibelle(e.target.value)} autoFocus
                placeholder="Nom de l'ouvrage"
                style={{ flex: 2, minWidth: 200, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none" }}/>
              <select value={newCatPrefix} onChange={e => setNewCatPrefix(e.target.value)}
                style={{ flex: 1, minWidth: 140, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer" }}>
                {categories.map(c => <option key={c.label} value={c.ids[0]}>{c.label}</option>)}
                <option value="autre">Autre</option>
              </select>
              <input value={newUnite} onChange={e => setNewUnite(e.target.value)} placeholder="Unité"
                style={{ width: 80, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", textAlign: "center" }}/>
              <select value={newTauxId} onChange={e => setNewTauxId(e.target.value)} required title="Taux horaire de main-d'œuvre (obligatoire) — présélection : taux par défaut"
                style={{ flex: 1, minWidth: 220, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${newTauxId ? (T.fieldBorder || T.border) : "rgba(225,90,90,.6)"}`, background: T.fieldBg || T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer" }}>
                {!newTauxId && <option value="">— Taux horaire de main-d'œuvre —</option>}
                {optionsSelectTaux(tauxHoraires, null).map(o => <option key={o.id} value={o.id}>{o.texte}</option>)}
              </select>
              <button onClick={creerOuvrage} disabled={!newLibelle.trim() || !newTauxId} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                background: newLibelle.trim() && newTauxId ? acc.accent : T.border, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: newLibelle.trim() && newTauxId ? "pointer" : "default", opacity: newLibelle.trim() && newTauxId ? 1 : .6,
              }}>
                <Icon as={Check} size={13}/>
                Créer
              </button>
              <button onClick={() => setShowNew(false)} style={{
                padding: "9px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textMuted,
                fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── Modale confirmation suppression ouvrage ── */}
        {toDelete && (
          <div onClick={() => !deleting && setToDelete(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 500,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: T.modal, borderRadius: RADIUS.xl, padding: 24,
              width: "100%", maxWidth: 420, border: `1px solid ${T.border}`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0,
                  background: "rgba(224,92,92,0.12)", color: "#e15a5a",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon as={AlertTriangle} size={20} strokeWidth={2}/>
                </div>
                <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Supprimer cet ouvrage&nbsp;?</div>
              </div>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 20 }}>
                L'ouvrage <strong style={{ color: T.text }}>« {toDelete.libelle} »</strong> et toutes ses sous-tâches seront définitivement supprimés.
                <br/><span style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>Cette action est irréversible.</span>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setToDelete(null)} disabled={deleting}
                  style={{ background: "transparent", border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub,
                    fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer", opacity: deleting ? .5 : 1 }}>
                  Annuler
                </button>
                <button onClick={confirmSupprimerOuvrage} disabled={deleting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6,
                    background: "#e15a5a", color: "#fff", border: "none",
                    borderRadius: RADIUS.md, padding: "9px 18px",
                    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                    cursor: "pointer", opacity: deleting ? .6 : 1 }}>
                  <Icon as={Trash2} size={13}/>
                  {deleting ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modale confirmation suppression catégorie ── */}
        {catToDelete && (
          <div onClick={() => !deleting && setCatToDelete(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 500,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: T.modal, borderRadius: RADIUS.xl, padding: 24,
              width: "100%", maxWidth: 460, border: `1px solid ${T.border}`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0,
                  background: "rgba(245,166,35,0.12)", color: "#f5a623",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon as={AlertTriangle} size={20} strokeWidth={2}/>
                </div>
                <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Supprimer cette catégorie&nbsp;?</div>
              </div>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 20 }}>
                La catégorie <strong style={{ color: T.text }}>« {catToDelete} »</strong> sera supprimée.
                {(() => {
                  const cat = categoriesCustom.find(c => c.label === catToDelete);
                  if (!cat) return null;
                  const affected = ouvrages.filter(o => cat.ids.some(k => o.identifiant?.startsWith(k))).length;
                  return affected > 0
                    ? <><br/><span style={{ color: "#f5a623", fontWeight: 600 }}>{affected} ouvrage{affected > 1 ? "s" : ""}</span> sera{affected > 1 ? "ont" : ""} déplacé{affected > 1 ? "s" : ""} dans <em>Autre</em>.</>
                    : null;
                })()}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setCatToDelete(null)} disabled={deleting}
                  style={{ background: "transparent", border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub,
                    fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer", opacity: deleting ? .5 : 1 }}>
                  Annuler
                </button>
                <button onClick={confirmSupprimerCategorie} disabled={deleting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6,
                    background: "#e15a5a", color: "#fff", border: "none",
                    borderRadius: RADIUS.md, padding: "9px 18px",
                    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                    cursor: "pointer", opacity: deleting ? .6 : 1 }}>
                  <Icon as={Trash2} size={13}/>
                  {deleting ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Liste ── */}
        {loading
          ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60, fontSize: FONT.sm.size }}>Chargement…</div>
          : filtered.length === 0
            ? (
              <div style={{
                background: T.card, border: `1px dashed ${T.border}`,
                borderRadius: RADIUS.xl, padding: "32px 24px",
                textAlign: "center", color: T.textSub, fontSize: FONT.sm.size,
              }}>
                Aucun ouvrage ne correspond à ces filtres.
              </div>
            )
            : Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: 24 }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  marginBottom: 10, paddingLeft: 2,
                }}>
                  <Icon as={FolderOpen} size={12} color={acc.accent}/>
                  <div style={{
                    fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 2.5,
                    textTransform: "uppercase", color: acc.accent,
                  }}>{cat}</div>
                  <div style={{
                    fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 600,
                    background: T.card, borderRadius: RADIUS.pill, padding: "1px 8px",
                  }}>{items.length}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(ouvrage => (
                    <OuvrageCard
                      key={ouvrage.id}
                      ouvrage={ouvrage}
                      isEdit={editId === ouvrage.id}
                      onToggleEdit={id => setEditId(editId === id ? null : id)}
                      onSave={saveOuvrage}
                      onDelete={(id) => setToDelete(ouvrages.find(o => o.id === id))}
                      onDuplicate={dupliquerOuvrage}
                      saving={saving}
                      ouvrages={ouvrages}
                      setOuvrages={setOuvrages}
                      categories={categories}
                      getCat={getCat}
                      changerCategorie={changerCategorie}
                      materiaux={materiaux}
                      groupesTypes={groupesTypes}
                      coutHoraire={coutHoraire}
                      tauxHoraires={tauxHoraires}
                      tauxOrigineId={tauxOrigine.current.get(ouvrage.id) ?? null}
                      T={T} acc={acc}
                    />
                  ))}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  );
}

export default PageBibliotheque;
