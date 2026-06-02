import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "./constants";
import { Icon } from "./ui";
import {
  ListChecks, Sparkles, Building2, Boxes, Hammer, ClipboardList,
  ChevronDown, Plus, Trash2, FileSpreadsheet, X, Check, AlertTriangle,
} from "lucide-react";
import { parseDevisExcel } from "./devisImport";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte du phasage : vue 3 colonnes (Lots → Ouvrages → Tâches) pour un
// chantier sélectionné en haut de page. Lit/écrit dans les mêmes tables
// Supabase que la v1 (`phasages`, `bibliotheque_ratios`, `planning_config`).
// Les ouvrages portent un nouveau champ `lot_id` qui les rattache à un lot.

const rid = () => Math.random().toString(36).slice(2, 10);

function PagePhasageV2({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);

  // ── État ────────────────────────────────────────────────────────────────
  const [lots, setLots] = useState(LOTS_DEFAUT);
  const [chantierId, setChantierId] = useState(() => {
    try { return localStorage.getItem("phasage_v2_chantier") || ""; } catch { return ""; }
  });
  const [phasage, setPhasage] = useState(null);
  const [loadingPhasage, setLoadingPhasage] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [selectedOuvrageId, setSelectedOuvrageId] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved"); // saved | pending | saving | error
  const saveTimerRef = useRef(null);
  const newOuvrageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  // Bibliothèque ouvrages (sert au matching à l'import devis)
  const [bibliotheque, setBibliotheque] = useState([]);
  // État de la modale d'import (null si fermée)
  // { items: [...], unknownLotHeaders: [...], parsing: bool, error: string|null }
  const [importState, setImportState] = useState(null);

  // Charge les lots (config Admin)
  useEffect(() => { loadLots().then(setLots); }, []);
  // Charge la bibliothèque d'ouvrages
  useEffect(() => {
    supabase.from("bibliotheque_ratios").select("*").order("libelle")
      .then(({ data }) => setBibliotheque(data || []));
  }, []);

  // Mémorise le dernier chantier ouvert
  useEffect(() => {
    if (chantierId) {
      try { localStorage.setItem("phasage_v2_chantier", chantierId); } catch {}
    }
  }, [chantierId]);

  // Charge le phasage du chantier sélectionné
  useEffect(() => {
    if (!chantierId) { setPhasage(null); return; }
    let cancelled = false;
    setLoadingPhasage(true);
    supabase.from("phasages").select("*").eq("chantier_id", chantierId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== "PGRST116") console.warn("PhasageV2 load:", error.message);
        setPhasage(data || null);
        setLoadingPhasage(false);
      });
    return () => { cancelled = true; };
  }, [chantierId]);

  // Reset des sélections quand on change de chantier
  useEffect(() => { setSelectedLotId(null); setSelectedOuvrageId(null); }, [chantierId]);

  const ouvrages = phasage?.ouvrages || [];
  const chantier = chantiers.find(c => c.id === chantierId);

  // ─── PERSISTANCE ────────────────────────────────────────────────────────
  // Crée la ligne phasages si elle n'existe pas encore pour ce chantier.
  const ensurePhasage = async () => {
    if (phasage?.id) return phasage;
    const { data, error } = await supabase.from("phasages").insert({
      chantier_id: chantierId,
      chantier_nom: chantier?.nom || chantierId,
      ouvrages: [],
    }).select().single();
    if (error) { console.error("ensurePhasage:", error.message); return null; }
    setPhasage(data);
    return data;
  };

  // Autosave debounced 800ms : on push tout le tableau ouvrages à chaque
  // modif. Simple et fiable pour la v2 ; le merge collab par id pourra être
  // ajouté plus tard si nécessaire.
  const scheduleSave = (ouvragesNext) => {
    setAutoSaveStatus("pending");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const p = await ensurePhasage();
      if (!p?.id) { setAutoSaveStatus("error"); return; }
      const { error } = await supabase.from("phasages").update({
        ouvrages: ouvragesNext,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      setAutoSaveStatus(error ? "error" : "saved");
      if (error) console.warn("PhasageV2 save:", error.message);
    }, 800);
  };

  const updateOuvrages = (next) => {
    setPhasage(p => ({ ...(p || { chantier_id: chantierId }), ouvrages: next }));
    scheduleSave(next);
  };

  // ─── CRUD OUVRAGES ──────────────────────────────────────────────────────
  const createOuvrage = (lotId) => {
    const newO = {
      id: rid(),
      libelle: "",
      lot_id: lotId === "_orphans" ? null : lotId,
      heures_devis: null,
      quantite: null,
      unite: "U",
      prix_ht: null,
      taches: [],
    };
    const next = [...ouvrages, newO];
    updateOuvrages(next);
    setSelectedOuvrageId(newO.id);
    // Focus le champ libellé du nouvel ouvrage juste après le render.
    setTimeout(() => { newOuvrageInputRef.current?.focus(); }, 50);
  };

  const updateOuvrage = (id, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === id ? { ...o, ...patch } : o));
  };

  const deleteOuvrage = (id) => {
    const o = ouvrages.find(x => x.id === id);
    if (!o) return;
    if (!window.confirm(`Supprimer l'ouvrage « ${o.libelle || "sans libellé"} » et toutes ses tâches ?`)) return;
    updateOuvrages(ouvrages.filter(x => x.id !== id));
    if (selectedOuvrageId === id) setSelectedOuvrageId(null);
  };

  // ─── CRUD TÂCHES ────────────────────────────────────────────────────────
  const createTache = (ouvrageId) => {
    const newT = { id: rid(), nom: "", heures_estimees: null, avancement: 0 };
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: [...(o.taches || []), newT] }
      : o));
  };

  const updateTache = (ouvrageId, tacheId, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).map(t => t.id === tacheId ? { ...t, ...patch } : t) }
      : o));
  };

  const deleteTache = (ouvrageId, tacheId) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).filter(t => t.id !== tacheId) }
      : o));
  };

  // ─── IMPORT DEVIS ───────────────────────────────────────────────────────
  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState({ items: [], unknownLotHeaders: [], parsing: true, error: null });
    try {
      const { items, unknownLotHeaders } = await parseDevisExcel(file, lots, bibliotheque);
      setImportState({ items, unknownLotHeaders, parsing: false, error: null });
    } catch (err) {
      console.error("Parsing devis:", err);
      setImportState({ items: [], unknownLotHeaders: [], parsing: false, error: err.message || "Impossible de lire le fichier." });
    }
    // Reset input pour permettre re-import du même fichier après cancel
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateImportItem = (key, patch) => {
    setImportState(s => ({ ...s, items: s.items.map(it => it._key === key ? { ...it, ...patch } : it) }));
  };
  const toggleAllImport = (val) => {
    setImportState(s => ({ ...s, items: s.items.map(it => ({ ...it, selectionne: val })) }));
  };

  const confirmImport = () => {
    if (!importState) return;
    const selected = importState.items.filter(it => it.selectionne);
    if (selected.length === 0) { setImportState(null); return; }
    const newOuvrages = selected.map(it => {
      // Heures estimées = cadence biblio × quantité (si dispo), sinon null.
      const cadence = parseFloat(it.match?.cadence) || null;
      const heuresEstimees = cadence && it.quantite ? parseFloat((cadence * it.quantite).toFixed(2)) : null;
      // Tâches : copies des sous_taches de la biblio (juste le nom pour la v2)
      const taches = (it.match?.sous_taches || []).map(st => ({
        id: rid(),
        nom: st.nom || "",
        heures_estimees: null,
        avancement: 0,
      }));
      return {
        id: rid(),
        libelle: it.libelle,
        lot_id: it.lot_id || null,
        heures_devis: it.heures,
        quantite: it.quantite,
        unite: it.unite || "U",
        prix_ht: it.prix_ht,
        heures_estimees: heuresEstimees,
        bibliotheque_id: it.match?.id || null,
        taches,
      };
    });
    updateOuvrages([...ouvrages, ...newOuvrages]);
    setImportState(null);
  };

  // Comptes pour les badges
  const countByLot = lots.reduce((acc, l) => {
    acc[l.id] = ouvrages.filter(o => o.lot_id === l.id).length;
    return acc;
  }, {});
  const orphans = ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id)).length;

  const ouvragesLot = selectedLotId
    ? ouvrages.filter(o => (selectedLotId === "_orphans"
        ? (!o.lot_id || !lots.some(l => l.id === o.lot_id))
        : o.lot_id === selectedLotId))
    : [];
  const selectedOuvrage = ouvrages.find(o => o.id === selectedOuvrageId) || null;
  const taches = selectedOuvrage?.taches || [];

  // ── Styles ──────────────────────────────────────────────────────────────
  const colHeader = {
    padding: "10px 14px",
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    display: "flex", alignItems: "center", gap: 8,
    fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
    color: T.textMuted,
    flexShrink: 0,
  };
  const colBody = { flex: 1, overflowY: "auto", padding: "10px 10px" };
  const emptyColMsg = (label) => (
    <div style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size + 1, fontStyle: "italic" }}>
      {label}
    </div>
  );
  const addBtn = {
    marginLeft: "auto",
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 9px", borderRadius: RADIUS.sm + 2,
    border: "none", background: acc.accent, color: acc.onAccent,
    fontSize: 10, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
    cursor: "pointer", fontFamily: "inherit",
  };
  const iconBtnDanger = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26, borderRadius: RADIUS.sm,
    background: "transparent", border: `1px solid transparent`,
    color: "#e15a5a", cursor: "pointer",
    transition: "all .12s",
  };
  const inp = {
    padding: "6px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
    color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit",
    outline: "none", width: "100%",
  };
  const lbl = {
    display: "block", fontSize: 9, fontWeight: 700, letterSpacing: .6,
    textTransform: "uppercase", color: T.textMuted, marginBottom: 4,
  };

  // ── Statut sauvegarde ──
  const statusColor = autoSaveStatus === "saved"  ? "#22c55e"
                    : autoSaveStatus === "saving" ? acc.accent
                    : autoSaveStatus === "error"  ? "#e15a5a"
                    : "#f5a623";
  const statusLbl = autoSaveStatus === "saved"  ? "Sauvegardé"
                  : autoSaveStatus === "saving" ? "Sauvegarde…"
                  : autoSaveStatus === "error"  ? "Erreur"
                  : "Modif en cours";

  const noChantier = !chantierId;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
      {/* CSS bubbles — couleur de chaque bulle = --bubble-color (var inline). */}
      <style>{`
        .p2-bubble {
          --c: var(--bubble-color, #888);
          background: color-mix(in srgb, var(--c) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--c) 25%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 11px 14px;
          margin: 8px 4px;
          cursor: pointer;
          color: ${T.text};
          font-size: ${FONT.sm.size}px;
          transition: transform .14s ease, background-color .14s ease, border-color .14s ease, box-shadow .14s ease;
          will-change: transform;
        }
        .p2-bubble:hover {
          background: color-mix(in srgb, var(--c) 20%, transparent);
          border-color: color-mix(in srgb, var(--c) 55%, transparent);
          transform: scale(1.02);
          box-shadow: 0 6px 18px color-mix(in srgb, var(--c) 28%, transparent);
        }
        .p2-bubble.active {
          background: color-mix(in srgb, var(--c) 22%, transparent);
          border-color: var(--c);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 32%, transparent);
        }
        .p2-bubble-form {
          background: color-mix(in srgb, var(--c) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 14px 16px;
          margin: 8px 4px;
          box-shadow: 0 4px 16px color-mix(in srgb, var(--c) 18%, transparent);
        }
      `}</style>

      {/* ── Header avec sélecteur chantier ── */}
      <div style={{
        padding: "14px 22px", borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: RADIUS.md, flexShrink: 0,
          background: acc.bg10, color: acc.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={ListChecks} size={18} strokeWidth={2}/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>Phasage</div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: acc.bg10, color: acc.accent, border: `1px solid ${acc.border}`,
            borderRadius: RADIUS.pill, padding: "2px 9px",
            fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
          }}>
            <Icon as={Sparkles} size={10}/>
            V2
          </span>
        </div>

        {/* Badge statut sauvegarde — visible seulement si on a un chantier ouvert */}
        {chantierId && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
            color: statusColor, background: statusColor + "18", border: `1px solid ${statusColor}40`,
            borderRadius: 99, padding: "2px 8px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}/>
            {statusLbl}
          </span>
        )}

        {/* Bouton import devis */}
        {chantierId && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFilePicked} style={{ display: "none" }}/>
            <button onClick={() => fileInputRef.current?.click()} style={{
              marginLeft: "auto",
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={FileSpreadsheet} size={14}/>
              Importer un devis
            </button>
          </>
        )}

        {/* Sélecteur chantier */}
        <div style={{ position: "relative", marginLeft: chantierId ? 0 : "auto", minWidth: 240 }}>
          <Icon as={Building2} size={13} color={T.textMuted}
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
          <select
            value={chantierId}
            onChange={e => setChantierId(e.target.value)}
            style={{
              width: "100%",
              appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
              padding: "9px 32px 9px 32px",
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: T.fieldBg || T.card,
              color: chantierId ? T.text : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600,
              outline: "none", cursor: "pointer",
            }}>
            <option value="">— Sélectionner un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
          <Icon as={ChevronDown} size={13} color={T.textMuted}
            style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
        </div>
      </div>

      {/* ── Body 3 colonnes ── */}
      {noChantier ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{
            background: T.card, border: `1px dashed ${T.border}`,
            borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
            maxWidth: 460, color: T.textMuted,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: RADIUS.lg,
              background: acc.bg10, color: acc.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
            }}>
              <Icon as={Building2} size={26} strokeWidth={1.5}/>
            </div>
            <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              Choisis un chantier
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6 }}>
              Sélectionne un chantier en haut à droite pour afficher ses lots, ouvrages et tâches.
            </div>
          </div>
        </div>
      ) : loadingPhasage ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
          Chargement du phasage…
        </div>
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) minmax(0, 1.2fr)", minHeight: 0 }}>
          {/* ── Colonne 1 : Lots ── */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}><Icon as={Boxes} size={12}/> Lots</div>
            <div style={colBody}>
              {lots.map(l => {
                const active = selectedLotId === l.id;
                const count = countByLot[l.id] || 0;
                return (
                  <div key={l.id} className={`p2-bubble ${active ? "active" : ""}`}
                    style={{ "--bubble-color": l.couleur, display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => { setSelectedLotId(l.id); setSelectedOuvrageId(null); }}>
                    <span style={{ flex: 1, fontWeight: 700, color: T.text }}>{l.label}</span>
                    {l.code_prefixe && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: .5,
                        padding: "1px 6px", borderRadius: RADIUS.sm,
                        background: "rgba(255,255,255,0.10)", color: T.text, opacity: .65,
                      }}>{l.code_prefixe}</span>
                    )}
                    {count > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: "2px 8px",
                        borderRadius: RADIUS.pill,
                        background: "rgba(0,0,0,0.18)", color: T.text,
                      }}>{count}</span>
                    )}
                  </div>
                );
              })}
              {orphans > 0 && (
                <div className={`p2-bubble ${selectedLotId === "_orphans" ? "active" : ""}`}
                  style={{ "--bubble-color": T.textMuted, marginTop: 14,
                    display: "flex", alignItems: "center", gap: 10, opacity: .85 }}
                  onClick={() => { setSelectedLotId("_orphans"); setSelectedOuvrageId(null); }}>
                  <span style={{ flex: 1, fontStyle: "italic", color: T.textMuted, fontWeight: 600 }}>Sans lot</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "2px 8px",
                    borderRadius: RADIUS.pill, background: "rgba(0,0,0,0.18)", color: T.text,
                  }}>{orphans}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Colonne 2 : Ouvrages ── */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}>
              <Icon as={Hammer} size={12}/> Ouvrages
              {selectedLotId && (
                <>
                  {ouvragesLot.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{ouvragesLot.length}</span>
                  )}
                  <button onClick={() => createOuvrage(selectedLotId)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Ouvrage
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedLotId
                ? emptyColMsg("Sélectionne un lot à gauche")
                : ouvragesLot.length === 0
                  ? emptyColMsg("Aucun ouvrage pour ce lot — clique « + Ouvrage »")
                  : ouvragesLot.map(o => {
                    const active = selectedOuvrageId === o.id;
                    const nbTaches = (o.taches || []).length;
                    const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
                    if (active) {
                      // Édition inline pour l'ouvrage sélectionné
                      return (
                        <div key={o.id} className="p2-bubble-form"
                          style={{ "--bubble-color": lotColor, display: "flex", flexDirection: "column", gap: 10 }}>
                          <div>
                            <span style={lbl}>Libellé</span>
                            <input ref={newOuvrageInputRef} value={o.libelle || ""}
                              onChange={e => updateOuvrage(o.id, { libelle: e.target.value })}
                              placeholder="Nom de l'ouvrage" style={{ ...inp, fontWeight: 600 }}/>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <div>
                              <span style={lbl}>Heures vendues</span>
                              <input type="number" step="0.5" min="0" value={o.heures_devis ?? ""}
                                onChange={e => updateOuvrage(o.id, { heures_devis: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                placeholder="0" style={inp}/>
                            </div>
                            <div>
                              <span style={lbl}>Quantité</span>
                              <div style={{ display: "flex", gap: 4 }}>
                                <input type="number" step="0.01" min="0" value={o.quantite ?? ""}
                                  onChange={e => updateOuvrage(o.id, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                  placeholder="0" style={{ ...inp, flex: 1 }}/>
                                <input value={o.unite || ""}
                                  onChange={e => updateOuvrage(o.id, { unite: e.target.value })}
                                  placeholder="U" style={{ ...inp, width: 50, textAlign: "center" }}/>
                              </div>
                            </div>
                            <div>
                              <span style={lbl}>Prix HT (€)</span>
                              <input type="number" step="0.01" min="0" value={o.prix_ht ?? ""}
                                onChange={e => updateOuvrage(o.id, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                placeholder="0" style={inp}/>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                            <div style={{ flex: 1 }}>
                              <span style={lbl}>Lot</span>
                              <select value={o.lot_id || ""}
                                onChange={e => updateOuvrage(o.id, { lot_id: e.target.value || null })}
                                style={{ ...inp, cursor: "pointer" }}>
                                <option value="">— Sans lot —</option>
                                {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                              </select>
                            </div>
                            <button onClick={() => deleteOuvrage(o.id)} title="Supprimer l'ouvrage"
                              style={{ ...iconBtnDanger, width: 32, height: 32 }}
                              onMouseEnter={e => { e.currentTarget.style.background = "rgba(225,90,90,0.12)"; e.currentTarget.style.borderColor = "rgba(225,90,90,0.3)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}>
                              <Icon as={Trash2} size={14}/>
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={o.id} className="p2-bubble"
                        style={{ "--bubble-color": lotColor, display: "flex", alignItems: "center", gap: 10 }}
                        onClick={() => setSelectedOuvrageId(o.id)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.libelle || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans libellé)</span>}
                          </div>
                          {(o.heures_devis || o.quantite || o.prix_ht) && (
                            <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>
                              {o.heures_devis ? `${o.heures_devis}h` : ""}
                              {o.quantite ? `${o.heures_devis ? " · " : ""}${o.quantite} ${o.unite || ""}` : ""}
                              {o.prix_ht ? `${(o.heures_devis||o.quantite) ? " · " : ""}${o.prix_ht.toLocaleString("fr-FR")} €` : ""}
                            </div>
                          )}
                        </div>
                        {nbTaches > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: "2px 8px",
                            borderRadius: RADIUS.pill,
                            background: "rgba(0,0,0,0.18)", color: T.text, flexShrink: 0,
                          }}>{nbTaches}</span>
                        )}
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* ── Colonne 3 : Tâches ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={colHeader}>
              <Icon as={ClipboardList} size={12}/> Tâches
              {selectedOuvrage && (
                <>
                  {taches.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{taches.length}</span>
                  )}
                  <button onClick={() => createTache(selectedOuvrage.id)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Tâche
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedOuvrage
                ? emptyColMsg("Sélectionne un ouvrage")
                : taches.length === 0
                  ? emptyColMsg("Aucune tâche — clique « + Tâche »")
                  : (() => {
                    const tacheColor = lots.find(l => l.id === selectedOuvrage.lot_id)?.couleur || acc.accent;
                    return taches.map(t => (
                      <div key={t.id} className="p2-bubble-form"
                        style={{ "--bubble-color": tacheColor, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <input value={t.nom || ""}
                            onChange={e => updateTache(selectedOuvrage.id, t.id, { nom: e.target.value })}
                            placeholder="Description de la tâche"
                            style={{ ...inp, flex: 1, fontWeight: 600 }}/>
                          <button onClick={() => deleteTache(selectedOuvrage.id, t.id)} title="Supprimer la tâche"
                            style={iconBtnDanger}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(225,90,90,0.12)"; e.currentTarget.style.borderColor = "rgba(225,90,90,0.3)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}>
                            <Icon as={Trash2} size={13}/>
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <span style={lbl}>Heures estimées</span>
                            <input type="number" step="0.5" min="0" value={t.heures_estimees ?? ""}
                              onChange={e => updateTache(selectedOuvrage.id, t.id, { heures_estimees: e.target.value === "" ? null : parseFloat(e.target.value) })}
                              placeholder="0" style={inp}/>
                          </div>
                          <div>
                            <span style={lbl}>Avancement (%)</span>
                            <input type="number" step="5" min="0" max="100" value={t.avancement ?? ""}
                              onChange={e => updateTache(selectedOuvrage.id, t.id, { avancement: e.target.value === "" ? 0 : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                              placeholder="0" style={inp}/>
                          </div>
                        </div>
                      </div>
                    ));
                  })()
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Modale import devis ── */}
      {importState && (
        <ImportDevisModal
          state={importState}
          lots={lots}
          T={T} accent={acc.accent} accentBorder={acc.border} accentBg10={acc.bg10}
          onUpdateItem={updateImportItem}
          onToggleAll={toggleAllImport}
          onClose={() => setImportState(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}

// ─── Modale d'import devis ────────────────────────────────────────────────────
function ImportDevisModal({ state, lots, T, accent, accentBorder, accentBg10, onUpdateItem, onToggleAll, onClose, onConfirm }) {
  const { items, unknownLotHeaders, parsing, error } = state;
  // Groupe les items par lot pour l'affichage
  const groups = (() => {
    const map = new Map();
    items.forEach(it => {
      const k = it.lot_id || "_orphans";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    });
    return Array.from(map.entries());
  })();
  const nbSel       = items.filter(i => i.selectionne).length;
  const nbMatchCode = items.filter(i => i.matchBy === "code").length;
  const nbMatchLbl  = items.filter(i => i.matchBy === "libelle").length;

  const lotLabel = (id) => id === "_orphans" ? "Sans lot" : (lots.find(l => l.id === id)?.label || id);
  const lotCouleur = (id) => id === "_orphans" ? T.textMuted : (lots.find(l => l.id === id)?.couleur || T.textMuted);

  const inp = {
    padding: "5px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
    background: T.fieldBg || T.card, color: T.text, fontSize: FONT.xs.size + 1,
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl, border: `1px solid ${T.border}`,
        width: "100%", maxWidth: 980, maxHeight: "92vh",
        display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: accentBg10, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={FileSpreadsheet} size={17}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>Importer un devis</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              {parsing ? "Analyse en cours…"
                : error ? "Erreur"
                : `${items.length} ouvrage${items.length > 1 ? "s" : ""} détecté${items.length > 1 ? "s" : ""} · ${nbMatchCode} par code · ${nbMatchLbl} par similarité · ${nbSel} sélectionné${nbSel > 1 ? "s" : ""}`}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 6,
            borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center",
          }}><Icon as={X} size={18}/></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {parsing ? (
            <div style={{ padding: 60, textAlign: "center", color: T.textMuted }}>Lecture du fichier…</div>
          ) : error ? (
            <div style={{ padding: 16, borderRadius: RADIUS.md, background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.3)", color: "#e15a5a", fontSize: FONT.sm.size }}>
              <Icon as={AlertTriangle} size={14} style={{ verticalAlign: "middle", marginRight: 6 }}/>
              {error}
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
              Aucun ouvrage détecté dans ce fichier.
              {unknownLotHeaders.length > 0 && (
                <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                  En-têtes potentiels trouvés : {unknownLotHeaders.slice(0, 5).join(" · ")}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Actions globales */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => onToggleAll(true)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout cocher</button>
                <button onClick={() => onToggleAll(false)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout décocher</button>
                {unknownLotHeaders.length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                    {unknownLotHeaders.length} en-tête{unknownLotHeaders.length > 1 ? "s" : ""} non reconnu{unknownLotHeaders.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Liste groupée par lot */}
              {groups.map(([lotId, lotItems]) => (
                <div key={lotId} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", marginBottom: 4,
                    background: T.card, borderRadius: RADIUS.sm,
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: lotCouleur(lotId), flexShrink: 0 }}/>
                    <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text, letterSpacing: .5, textTransform: "uppercase" }}>
                      {lotLabel(lotId)}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.surface, color: T.textMuted,
                    }}>{lotItems.length}</span>
                  </div>
                  {lotItems.map(it => (
                    <div key={it._key} style={{
                      display: "grid",
                      gridTemplateColumns: "24px minmax(0, 1fr) 70px 70px 80px 110px",
                      gap: 8, alignItems: "center",
                      padding: "8px 10px",
                      borderBottom: `1px solid ${T.border}`,
                      opacity: it.selectionne ? 1 : .45,
                    }}>
                      <input type="checkbox" checked={it.selectionne}
                        onChange={e => onUpdateItem(it._key, { selectionne: e.target.checked })}
                        style={{ cursor: "pointer", accentColor: accent }}/>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.libelle}
                        </div>
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          {it.match ? (
                            <>
                              <Icon as={Check} size={10} color={it.matchBy === "code" ? "#22c55e" : "#5b8af5"}/>
                              <span>
                                {it.matchBy === "code"
                                  ? <>Match par <strong>code</strong> ({it.code})</>
                                  : <>Match par similarité ({Math.round(it.score * 100)}%)</>}
                                {" · "}{(it.match.sous_taches || []).length} sous-tâche{(it.match.sous_taches || []).length > 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontStyle: "italic" }}>
                              {it.code ? `Code ${it.code} inconnu en biblio — créé sans tâches` : "Pas de match biblio — créé sans tâches"}
                            </span>
                          )}
                        </div>
                      </div>
                      <input type="number" step="0.5" value={it.heures ?? ""}
                        onChange={e => onUpdateItem(it._key, { heures: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="h" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.quantite ?? ""}
                        onChange={e => onUpdateItem(it._key, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="qté" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.prix_ht ?? ""}
                        onChange={e => onUpdateItem(it._key, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="€ HT" style={{ ...inp, textAlign: "right" }}/>
                      <select value={it.lot_id || ""}
                        onChange={e => onUpdateItem(it._key, { lot_id: e.target.value || null })}
                        style={{ ...inp, cursor: "pointer" }}>
                        <option value="">Sans lot</option>
                        {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {!parsing && !error && items.length > 0 && `${nbSel} ouvrage${nbSel > 1 ? "s" : ""} à importer`}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={onConfirm} disabled={parsing || !!error || nbSel === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                background: (parsing || !!error || nbSel === 0) ? T.border : accent,
                color: (parsing || !!error || nbSel === 0) ? T.textMuted : "#000",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: (parsing || !!error || nbSel === 0) ? "default" : "pointer",
              }}>
              <Icon as={Check} size={13}/>
              Importer {nbSel > 0 ? `(${nbSel})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PagePhasageV2;
