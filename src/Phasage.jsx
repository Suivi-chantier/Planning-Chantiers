import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import { JOURS, getCurrentWeek, getWeekId } from "./constants";

function EcartBadge({ devis, estime }) {
  if (!estime || !devis || estime === 0) return null;
  const ecart = ((devis - estime) / estime) * 100;
  if (Math.abs(ecart) < 1) return null;
  const surCote = devis > estime;
  const color = surCote ? "#50c878" : "#e05c5c";
  const bg = surCote ? "rgba(80,200,120,0.12)" : "rgba(224,92,92,0.12)";
  const border = surCote ? "rgba(80,200,120,0.3)" : "rgba(224,92,92,0.3)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, border: `1px solid ${border}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {surCote ? "+" : ""}{ecart.toFixed(0)}%
    </span>
  );
}

function normalise(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function scoreSimilarite(a, b) {
  const na = normalise(a), nb = normalise(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wA = new Set(na.split(" ").filter(w => w.length > 2));
  const wB = new Set(nb.split(" ").filter(w => w.length > 2));
  const inter = [...wA].filter(w => wB.has(w)).length;
  const union = new Set([...wA, ...wB]).size;
  return union > 0 ? inter / union : 0;
}
function matcherOuvrage(libelle, bibliotheque) {
  let best = null, bestScore = 0;
  for (const b of bibliotheque) { const s = scoreSimilarite(libelle, b.libelle); if (s > bestScore) { bestScore = s; best = b; } }
  return bestScore >= 0.35 ? best : null;
}

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        let colL = -1, colH = -1;
        const hRow = rows.find(r => r.some(c => typeof c === "string" && c.length > 0));
        const hIdx = rows.indexOf(hRow);
        if (hRow) {
          hRow.forEach((cell, i) => {
            const c = normalise(String(cell));
            if (colL === -1 && (c.includes("libelle") || c.includes("designation") || c.includes("description") || c.includes("ouvrage") || c.includes("poste"))) colL = i;
            if (colH === -1 && (c.includes("heure") || c.includes("h mo") || c.includes("mo") || c.includes("main") || c.includes("temps") || c.includes("duree"))) colH = i;
          });
          if (colL === -1) colL = 0;
          if (colH === -1) {
            for (let i = 1; i < Math.min(hRow.length, 10); i++) {
              const vals = rows.slice(hIdx + 1).map(r => r[i]).filter(v => v !== "");
              if (vals.filter(v => !isNaN(parseFloat(String(v).replace(",", ".")))).length > vals.length * 0.5) { colH = i; break; }
            }
          }
        }
        const lignes = [];
        for (let i = hIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const lib = String(row[colL] || "").trim();
          const h = parseFloat(String(row[colH] || "").replace(",", ".").replace(/[^0-9.]/g, ""));
          if (lib.length > 2 && !isNaN(h) && h > 0) lignes.push({ libelle: lib, heures: h });
        }
        resolve(lignes);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function ModaleImportExcel({ T, bibliotheque, onImporter, onFermer }) {
  const [etape, setEtape] = useState("upload");
  const [parsing, setParsing] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [lignes, setLignes] = useState([]);
  const fileRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setParsing(true); setErreur(null);
    try {
      const parsed = await parseExcel(file);
      if (parsed.length === 0) { setErreur("Aucune ligne valide détectée. Vérifie que ton fichier a bien une colonne libellé et une colonne heures."); setParsing(false); return; }
      setLignes(parsed.map(l => ({ ...l, selectionne: true, match: matcherOuvrage(l.libelle, bibliotheque) })));
      setEtape("preview");
    } catch (err) { setErreur("Erreur de lecture : " + err.message); }
    setParsing(false);
  }

  const nbSel = lignes.filter(l => l.selectionne).length;
  const nbMatch = lignes.filter(l => l.match && l.selectionne).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }} onClick={onFermer}>
      <div style={{ background: T.modal || T.surface, borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "85vh", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.sectionDivider}`, background: T.surface, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>📂 Importer un devis Excel</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
              {etape === "upload" ? "Glisse ou sélectionne ton fichier .xlsx / .xls" : `${lignes.length} ligne(s) · ${lignes.filter(l => l.match).length} correspondance(s) bibliothèque`}
            </div>
          </div>
          <button onClick={onFermer} style={{ background: "transparent", border: "none", color: T.textMuted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {etape === "upload" && (
            <>
              <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                style={{ border: `2px dashed ${T.accent}55`, borderRadius: 12, padding: "44px 24px", textAlign: "center", cursor: "pointer", background: `${T.accent}08` }}
                onMouseEnter={e => e.currentTarget.style.borderColor = T.accent} onMouseLeave={e => e.currentTarget.style.borderColor = `${T.accent}55`}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Glisse ton fichier ici ou clique pour parcourir</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>Formats acceptés : .xlsx, .xls</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
              </div>
              {parsing && <div style={{ textAlign: "center", padding: 20, color: T.textMuted, fontSize: 13 }}>⏳ Lecture en cours…</div>}
              {erreur && <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(224,92,92,0.1)", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 8, color: "#e05c5c", fontSize: 13 }}>⚠️ {erreur}</div>}
              <div style={{ marginTop: 18, padding: "14px 16px", background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Format attendu</div>
                <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.8 }}>
                  Le fichier doit contenir :<br />
                  • Une colonne <strong style={{ color: T.text }}>libellé / désignation</strong><br />
                  • Une colonne <strong style={{ color: T.text }}>heures</strong> (ex : 16 ou 16.5)<br />
                  Les en-têtes sont détectés automatiquement.
                </div>
              </div>
            </>
          )}

          {etape === "preview" && (
            <>
              <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "#50c878", display: "inline-block" }} /> Correspondance bibliothèque</span>
                <span style={{ fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: T.border, display: "inline-block" }} /> Sans correspondance</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["Tout sélectionner", p => p.map(l => ({ ...l, selectionne: true }))], ["Tout désélectionner", p => p.map(l => ({ ...l, selectionne: false }))], ["Correspondances seules", p => p.map(l => ({ ...l, selectionne: !!l.match }))]].map(([label, fn]) => (
                  <button key={label} onClick={() => setLignes(fn)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>{label}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lignes.map((ligne, idx) => {
                  const cadence = parseFloat(ligne.match?.cadence) || null;
                  const unite = ligne.match?.unite || "";
                  const quantite = parseFloat(ligne.quantite) || null;
                  const hEstimees = cadence && quantite ? parseFloat((cadence * quantite).toFixed(2)) : null;
                  return (
                    <div key={idx} style={{ borderRadius: 10, border: `1px solid ${ligne.selectionne ? (ligne.match ? "rgba(80,200,120,0.35)" : T.border) : T.border}`, background: ligne.selectionne ? (ligne.match ? "rgba(80,200,120,0.06)" : T.card) : `${T.card}55`, opacity: ligne.selectionne ? 1 : 0.45, transition: "all .15s", overflow: "hidden" }}>
                      {/* Ligne principale */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                        <input type="checkbox" checked={ligne.selectionne} onChange={() => setLignes(p => p.map((l, i) => i === idx ? { ...l, selectionne: !l.selectionne } : l))} style={{ width: 16, height: 16, accentColor: T.accent, cursor: "pointer", flexShrink: 0 }} />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: ligne.match ? "#50c878" : T.border, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ligne.libelle}</div>
                          {ligne.match
                            ? <div style={{ fontSize: 11, color: "#50c878", marginTop: 2 }}>→ {ligne.match.libelle}{cadence ? ` · cadence ${cadence}h/${unite}` : " · pas de cadence"}</div>
                            : <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>Aucune correspondance — importé tel quel</div>}
                        </div>
                        {/* Heures devis */}
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: T.textMuted }}>Devis</span>
                          <input type="number" min="0.5" step="0.5" value={ligne.heures} onChange={e => setLignes(p => p.map((l, i) => i === idx ? { ...l, heures: parseFloat(e.target.value) || l.heures } : l))} style={{ width: 60, padding: "5px 8px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 800, outline: "none" }} />
                          <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                        </div>
                      </div>
                      {/* Bloc cadence — uniquement si match avec cadence */}
                      {ligne.match && cadence && (
                        <div style={{ margin: "0 14px 10px 38px", padding: "8px 12px", background: "rgba(91,156,246,0.08)", border: "1px solid rgba(91,156,246,0.25)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#5b9cf6" }}>⏱ Cadence {cadence}h/{unite}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12, color: T.textMuted }}>Qté :</span>
                            <input
                              type="number" min="0" step="1"
                              value={ligne.quantite || ""}
                              placeholder="ex: 50"
                              onChange={e => setLignes(p => p.map((l, i) => i === idx ? { ...l, quantite: e.target.value } : l))}
                              style={{ width: 72, padding: "5px 8px", borderRadius: 6, textAlign: "center", border: "1px solid rgba(91,156,246,0.4)", background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }}
                            />
                            <span style={{ fontSize: 12, color: T.textMuted }}>{unite}</span>
                          </div>
                          {hEstimees
                            ? <span style={{ fontSize: 12, fontWeight: 800, color: "#5b9cf6", background: "rgba(91,156,246,0.15)", padding: "3px 10px", borderRadius: 6 }}>→ {hEstimees}h estimées</span>
                            : <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>Saisis la quantité pour calculer les heures estimées</span>
                          }
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {etape === "preview" && (
          <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface }}>
            <div style={{ fontSize: 13, color: T.textMuted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{nbSel}</span> ouvrage{nbSel > 1 ? "s" : ""} à importer
              {nbMatch > 0 && <> · <span style={{ color: "#50c878", fontWeight: 700 }}>{nbMatch}</span> avec tâches auto-générées</>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setEtape("upload"); setLignes([]); }} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Retour</button>
              <button onClick={() => onImporter(lignes.filter(l => l.selectionne && l.heures > 0))} disabled={nbSel === 0} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: nbSel > 0 ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: nbSel > 0 ? "pointer" : "default" }}>
                ✓ Importer {nbSel} ouvrage{nbSel > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTravaux({ phasage, ouvrages, T, ouvriers, onBack, onSavePlan }) {
  const BLEU = "#5b9cf6";

  // Initialise le plan depuis phasage.plan_travaux ou crée les phases vides
  const initPlan = () => {
    if (phasage.plan_travaux) return phasage.plan_travaux;
    // Distribuer les tâches existantes des ouvrages dans les phases selon la catégorie bibliothèque
    const plan = {};
    PHASES.forEach(p => { plan[p.id] = []; });
    // Aplatir toutes les tâches des ouvrages comme point de départ
    ouvrages.forEach(o => {
      (o.taches || []).forEach(t => {
        // On met tout dans "non classé" → l'utilisateur répartit manuellement
        // En pratique on ne pré-assigne pas automatiquement
      });
    });
    return plan;
  };

  const [plan, setPlan] = useState(initPlan);
  const [expandedPhase, setExpandedPhase] = useState(PHASES[0].id);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  const [ajoutPhase, setAjoutPhase] = useState(null); // id de la phase en cours d'ajout
  const [ajoutForm, setAjoutForm] = useState({ nom: "", heures_vendues: "", heures_estimees: "", ouvrier: "", date_prevue: "", ressources: [] });

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      await onSavePlan(plan);
      setAutoSaveStatus("saved");
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
  }, [plan]);

  function addTache(phaseId) {
    if (!ajoutForm.nom) return;
    const newT = {
      id: Math.random().toString(36).slice(2),
      nom: ajoutForm.nom,
      heures_vendues: parseFloat(ajoutForm.heures_vendues) || 0,
      heures_estimees: parseFloat(ajoutForm.heures_estimees) || null,
      heures_reelles: parseFloat(ajoutForm.heures_reelles) || 0,
      ouvrier: ajoutForm.ouvrier || "",
      date_prevue: ajoutForm.date_prevue || "",
      avancement: 0,
      ressources: [],
    };
    setPlan(p => ({ ...p, [phaseId]: [...(p[phaseId] || []), newT] }));
    setAjoutPhase(null);
    setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvrier: "", date_prevue: "", ressources: [] });
  }

  function updateTache(phaseId, tacheId, updates) {
    setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).map(t => t.id === tacheId ? { ...t, ...updates } : t) }));
  }

  function deleteTache(phaseId, tacheId) {
    setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).filter(t => t.id !== tacheId) }));
  }

  // Totaux globaux
  const allTaches = PHASES.flatMap(ph => (plan[ph.id] || []));
  const totalVendu = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const totalEstime = allTaches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  const totalReel = allTaches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const totalTaches = allTaches.length;
  const terminees = allTaches.filter(t => (parseFloat(t.avancement) || 0) === 100).length;
  const avgAv = totalTaches > 0 ? Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / totalTaches) : 0;

  const autoColor = autoSaveStatus === "saved" ? "#50c878" : autoSaveStatus === "saving" ? T.accent : "#f5a623";
  const autoLabel = autoSaveStatus === "saved" ? "✓ Sauvegardé" : autoSaveStatus === "saving" ? "Sauvegarde…" : "● Modification en cours";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Retour au devis</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>📋 Plan de travaux — {phasage.chantier_nom}</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{totalTaches} tâche{totalTaches > 1 ? "s" : ""} · {terminees} terminée{terminees > 1 ? "s" : ""}</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: autoColor, display: "flex", alignItems: "center", gap: 5 }}>
            {autoSaveStatus === "saving" && <svg width="12" height="12" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>}
            {autoLabel}
          </div>
        </div>

        {/* Récap global */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
          {[
            ["Avancement", `${avgAv}%`, avgAv === 100 ? "#50c878" : T.accent],
            ["Total vendu", totalVendu > 0 ? `${totalVendu.toFixed(1)}h` : "—", T.accent],
            ["Total estimé", totalEstime > 0 ? `${totalEstime.toFixed(1)}h` : "—", BLEU],
            ["Total réel", totalReel > 0 ? `${totalReel.toFixed(1)}h` : "—", totalReel > totalVendu && totalVendu > 0 ? "#e05c5c" : "#50c878"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4 }}>
            <div style={{ height: "100%", borderRadius: 4, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 40 }}>{avgAv}%</span>
        </div>

        {/* Phases */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {PHASES.map((phase, phaseIdx) => {
            const taches = plan[phase.id] || [];
            const isExp = expandedPhase === phase.id;
            const phAv = taches.length > 0 ? Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length) : 0;
            const phVendu = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
            const phReel = taches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);

            return (
              <div key={phase.id} style={{ background: T.surface, border: `1px solid ${isExp ? phase.couleur + "88" : T.border}`, borderRadius: 12, overflow: "hidden", transition: "border .2s" }}>

                {/* En-tête phase */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", cursor: "pointer", borderBottom: isExp ? `1px solid ${T.sectionDivider}` : "none" }}
                  onClick={() => setExpandedPhase(isExp ? null : phase.id)}>
                  <div style={{ width: 4, height: 36, borderRadius: 2, background: phase.couleur, flexShrink: 0 }} />
                  <span style={{ fontSize: 16 }}>{phase.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{phase.label}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                      {taches.length} tâche{taches.length > 1 ? "s" : ""}
                      {phVendu > 0 && <> · <span style={{ color: T.accent, fontWeight: 700 }}>{phVendu.toFixed(1)}h vendues</span></>}
                      {phReel > 0 && <> · <span style={{ color: phReel > phVendu && phVendu > 0 ? "#e05c5c" : "#50c878", fontWeight: 700 }}>{phReel.toFixed(1)}h réelles</span></>}
                    </div>
                  </div>
                  {taches.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
                      <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2 }}>
                        <div style={{ height: "100%", borderRadius: 2, background: phAv === 100 ? "#50c878" : phase.couleur, width: `${phAv}%`, transition: "width .3s" }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: phAv === 100 ? "#50c878" : T.textMuted, minWidth: 32 }}>{phAv}%</span>
                    </div>
                  )}
                  <span style={{ fontSize: 12, color: isExp ? phase.couleur : T.textMuted }}>{isExp ? "▲" : "▼"}</span>
                </div>

                {/* Corps phase */}
                {isExp && (
                  <div style={{ padding: "0 18px 16px" }}>

                    {/* En-têtes colonnes */}
                    {taches.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 72px 110px 130px 70px 100px 32px", gap: 8, padding: "8px 10px 6px", borderBottom: `1px solid ${T.sectionDivider}` }}>
                        {["Tâche", "Vendu", "Estimé", "Réel", "Écart", "Ouvrier", "Date", "Avancement", ""].map((h, i) => (
                          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, textAlign: i > 0 ? "center" : "left" }}>{h}</div>
                        ))}
                      </div>
                    )}

                    {/* Lignes de tâches */}
                    {taches.map(tache => {
                      const av = parseFloat(tache.avancement) || 0;
                      const hV = parseFloat(tache.heures_vendues) || 0;
                      const hE = parseFloat(tache.heures_estimees) || null;
                      const hR = parseFloat(tache.heures_reelles) || 0;
                      return (
                        <div key={tache.id} style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 72px 110px 130px 70px 100px 32px", gap: 8, padding: "10px 10px", borderBottom: `1px solid ${T.sectionDivider}`, alignItems: "center" }}>

                          {/* Nom */}
                          <input value={tache.nom} onChange={e => updateTache(phase.id, tache.id, { nom: e.target.value })}
                            style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none", width: "100%" }} />

                          {/* Vendu */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <input type="number" min="0" step="0.5" value={tache.heures_vendues || ""} placeholder="0" onChange={e => updateTache(phase.id, tache.id, { heures_vendues: parseFloat(e.target.value) || 0 })}
                              style={{ width: "100%", padding: "5px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                          </div>

                          {/* Estimé */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <input type="number" min="0" step="0.5" value={tache.heures_estimees || ""} placeholder="—" onChange={e => updateTache(phase.id, tache.id, { heures_estimees: parseFloat(e.target.value) || null })}
                              style={{ width: "100%", padding: "5px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: BLEU, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                          </div>

                          {/* Réel */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <input type="number" min="0" step="0.5" value={tache.heures_reelles || ""} placeholder="0" onChange={e => updateTache(phase.id, tache.id, { heures_reelles: parseFloat(e.target.value) || 0 })}
                              style={{ width: "100%", padding: "5px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: hR > hV && hV > 0 ? "#e05c5c" : hR > 0 ? "#50c878" : T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                          </div>

                          {/* Écart */}
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <EcartReel vendu={hV} reel={hR} />
                          </div>

                          {/* Ouvrier */}
                          <select value={tache.ouvrier || ""} onChange={e => updateTache(phase.id, tache.id, { ouvrier: e.target.value })}
                            style={{ padding: "5px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.inputBg, color: tache.ouvrier ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 12, outline: "none", width: "100%" }}>
                            <option value="">—</option>
                            {ouvriers.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>

                          {/* Date prévue */}
                          <input type="date" value={tache.date_prevue || ""} onChange={e => updateTache(phase.id, tache.id, { date_prevue: e.target.value })}
                            style={{ padding: "5px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none", width: "100%", colorScheme: "dark" }} />

                          {/* Avancement */}
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <input type="range" min="0" max="100" step="5" value={av} onChange={e => updateTache(phase.id, tache.id, { avancement: parseInt(e.target.value) })}
                              style={{ flex: 1, accentColor: av === 100 ? "#50c878" : phase.couleur }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: av === 100 ? "#50c878" : av > 0 ? "#f5a623" : T.textMuted, minWidth: 28, textAlign: "right" }}>{av}%</span>
                          </div>

                          {/* Supprimer */}
                          <button onClick={() => deleteTache(phase.id, tache.id)} style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                        </div>
                      );
                    })}

                    {/* Formulaire ajout */}
                    {ajoutPhase === phase.id ? (
                      <div style={{ marginTop: 12, padding: "14px 16px", background: T.card, borderRadius: 10, border: `1px solid ${phase.couleur}55` }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: phase.couleur, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>{phase.emoji} Nouvelle tâche — {phase.label}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Nom de la tâche *</div>
                            <input value={ajoutForm.nom} onChange={e => setAjoutForm(f => ({ ...f, nom: e.target.value }))} placeholder="ex: Pose plaques BA13"
                              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none" }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Heures vendues</div>
                            <input type="number" min="0" step="0.5" value={ajoutForm.heures_vendues} onChange={e => setAjoutForm(f => ({ ...f, heures_vendues: e.target.value }))} placeholder="0h"
                              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Heures estimées</div>
                            <input type="number" min="0" step="0.5" value={ajoutForm.heures_estimees} onChange={e => setAjoutForm(f => ({ ...f, heures_estimees: e.target.value }))} placeholder="—"
                              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color: BLEU, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Ouvrier</div>
                            <select value={ajoutForm.ouvrier} onChange={e => setAjoutForm(f => ({ ...f, ouvrier: e.target.value }))}
                              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color: ajoutForm.ouvrier ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 13, outline: "none" }}>
                              <option value="">— Non assigné</option>
                              {ouvriers.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Date prévue</div>
                            <input type="date" value={ajoutForm.date_prevue} onChange={e => setAjoutForm(f => ({ ...f, date_prevue: e.target.value }))}
                              style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", colorScheme: "dark" }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button onClick={() => addTache(phase.id)} disabled={!ajoutForm.nom}
                            style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: ajoutForm.nom ? phase.couleur : T.border, color: ajoutForm.nom ? "#fff" : T.textMuted, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: ajoutForm.nom ? "pointer" : "default" }}>
                            ✓ Ajouter la tâche
                          </button>
                          <button onClick={() => { setAjoutPhase(null); setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvrier: "", date_prevue: "", ressources: [] }); }}
                            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAjoutPhase(phase.id); setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvrier: "", date_prevue: "", ressources: [] }); }}
                        style={{ marginTop: 12, width: "100%", padding: "9px", borderRadius: 8, border: `1.5px dashed ${phase.couleur}55`, background: "transparent", color: phase.couleur, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        + Ajouter une tâche
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


function PhasageDetail({ phasage, bibliotheque, T, chantiers, ouvriers, tauxHoraires, onBack, onSave, onDelete }) {
  const [ouvrages, setOuvrages] = useState(phasage.ouvrages || []);
  const [showAjout, setShowAjout] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedOuvrage, setSelectedOuvrage] = useState("");
  const [heuresInput, setHeuresInput] = useState("");
  const [quantiteInput, setQuantiteInput] = useState("");
  const [search, setSearch] = useState("");
  const [expandedOuvrage, setExpandedOuvrage] = useState(null);
  const [expandedTache, setExpandedTache] = useState(null);
  const [showPlanTravaux, setShowPlanTravaux] = useState(false);
  const ch = chantiers.find(c => c.id === phasage.chantier_id);

  if (showPlanTravaux) {
    return <PlanTravaux phasage={phasage} ouvrages={ouvrages} T={T} ouvriers={ouvriers}
      onBack={() => setShowPlanTravaux(false)}
      onSavePlan={async (plan) => { await onSave({ ...phasage, plan_travaux: plan, ouvrages }); }}
    />;
  }
  const BLEU = "#5b9cf6";

  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      await onSave({ ...phasage, ouvrages });
      setAutoSaveStatus("saved");
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
  }, [ouvrages]);

  const [planifierTask, setPlanifierTask] = useState(null);
  const [planifierWeek, setPlanifierWeek] = useState("");
  const [planifierJour, setPlanifierJour] = useState("Lundi");
  const [isPlanningSaving, setIsPlanningSaving] = useState(false);
  const semainesFutures = [];
  const now = getCurrentWeek();
  for (let i = 0; i < 8; i++) { let w = now.week + i, y = now.year; if (w > 52) { w -= 52; y++; } semainesFutures.push(getWeekId(y, w)); }

  function genererTaches(ouvrageId, heuresDevis, heuresEstimees) {
    const bibl = bibliotheque.find(b => b.id === ouvrageId);
    if (!bibl) return [];
    return (bibl.sous_taches || []).map(st => ({ nom: st.nom, ratio: st.ratio, heures: parseFloat(((heuresDevis * st.ratio) / 100).toFixed(1)), heures_estimees: heuresEstimees ? parseFloat(((heuresEstimees * st.ratio) / 100).toFixed(2)) : null, avancement: 0, heures_reelles: [], ressources: [] }));
  }

  function handleImportExcel(lignesSelectionnees) {
    const nouveaux = lignesSelectionnees.map(ligne => {
      const bibl = ligne.match;
      const quantite = parseFloat(ligne.quantite) || null;
      const cadence = parseFloat(bibl?.cadence) || null;
      const heuresEstimees = cadence && quantite ? parseFloat((cadence * quantite).toFixed(2)) : null;
      return { id: Math.random().toString(36).slice(2), bibliotheque_id: bibl?.id || null, libelle: bibl ? bibl.libelle : ligne.libelle, libelle_devis: ligne.libelle, unite: bibl?.unite || "U", heures_devis: ligne.heures, heures_estimees: heuresEstimees, quantite, taches: bibl ? genererTaches(bibl.id, ligne.heures, heuresEstimees) : [] };
    });
    setOuvrages(prev => [...prev, ...nouveaux]);
    setShowImport(false);
    if (nouveaux.length > 0) setExpandedOuvrage(nouveaux[0].id);
  }

  function ajouterOuvrage() {
    if (!selectedOuvrage || !heuresInput) return;
    const bibl = bibliotheque.find(b => b.id === selectedOuvrage);
    if (!bibl) return;
    const hD = parseFloat(heuresInput), q = parseFloat(quantiteInput) || null;
    const hE = bibl.cadence && q ? parseFloat((bibl.cadence * q).toFixed(2)) : null;
    const newO = { id: Math.random().toString(36).slice(2), bibliotheque_id: selectedOuvrage, libelle: bibl.libelle, unite: bibl.unite, heures_devis: hD, quantite: q, heures_estimees: hE, taches: genererTaches(selectedOuvrage, hD, hE) };
    setOuvrages(prev => [...prev, newO]);
    setShowAjout(false); setSelectedOuvrage(""); setHeuresInput(""); setQuantiteInput(""); setSearch("");
    setExpandedOuvrage(newO.id);
  }

  function supprimerOuvrage(id) { setOuvrages(prev => prev.filter(o => o.id !== id)); }
  function updateHeures(id, val) { setOuvrages(prev => prev.map(o => { if (o.id !== id) return o; const h = parseFloat(val) || 0; const bibl = bibliotheque.find(b => b.id === o.bibliotheque_id); return { ...o, heures_devis: h, taches: bibl ? genererTaches(o.bibliotheque_id, h, o.heures_estimees) : o.taches }; })); }
  function updateTache(oid, ti, upd) { setOuvrages(prev => prev.map(o => { if (o.id !== oid) return o; const t = [...o.taches]; t[ti] = { ...t[ti], ...upd }; return { ...o, taches: t }; })); }
  function addHeureMO(oid, ti) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { heures_reelles: [...(t.heures_reelles || []), { id: Math.random().toString(36).slice(2), ouvrier: ouvriers[0] || "", heures: 0 }] }); }
  function updateHeureMO(oid, ti, hi, ch) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { heures_reelles: (t.heures_reelles || []).map((h, i) => i === hi ? { ...h, ...ch } : h) }); }
  function removeHeureMO(oid, ti, hi) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { heures_reelles: (t.heures_reelles || []).filter((_, i) => i !== hi) }); }
  function addRessource(oid, ti) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { ressources: [...(t.ressources || []), { id: Math.random().toString(36).slice(2), description: "", montant: 0 }] }); }
  function updateRessource(oid, ti, ri, ch) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { ressources: (t.ressources || []).map((r, i) => i === ri ? { ...r, ...ch } : r) }); }
  function removeRessource(oid, ti, ri) { const t = ouvrages.find(o => o.id === oid)?.taches[ti]; if (!t) return; updateTache(oid, ti, { ressources: (t.ressources || []).filter((_, i) => i !== ri) }); }
  function calcCoutMO(t) { return (t.heures_reelles || []).reduce((s, h) => s + ((parseFloat(h.heures) || 0) * (parseFloat(tauxHoraires?.[h.ouvrier]) || 0)), 0); }
  function calcCoutRes(t) { return (t.ressources || []).reduce((s, r) => s + (parseFloat(r.montant) || 0), 0); }

  async function executerPlanification() {
    if (!planifierWeek || !planifierJour || !planifierTask) return;
    setIsPlanningSaving(true);
    try {
      const { data: ex } = await supabase.from("planning_cells").select("*").eq("week_id", planifierWeek).eq("chantier_id", phasage.chantier_id).eq("jour", planifierJour).maybeSingle();
      const base = ex || { planifie: "", reel: "", ouvriers: [], taches: [] };
      const upd = [...(base.taches || []), { id: Math.random().toString(36).slice(2), text: planifierTask.tache.nom, duree: planifierTask.tache.heures, ouvriers: [] }];
      await supabase.from("planning_cells").upsert({ week_id: planifierWeek, chantier_id: phasage.chantier_id, jour: planifierJour, planifie: upd.map(t => t.text).join("\n"), taches: upd, reel: base.reel, ouvriers: base.ouvriers }, { onConflict: "week_id,chantier_id,jour" });
      setPlanifierTask(null); alert("Tâche ajoutée au planning !");
    } catch (err) { alert("Erreur planification."); }
    setIsPlanningSaving(false);
  }

  const totalH = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
  const totalHEst = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_estimees) || 0), 0);
  const totalTaches = ouvrages.flatMap(o => o.taches || []);
  const avgAv = totalTaches.length > 0 ? Math.round(totalTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / totalTaches.length) : 0;
  const totMO = totalTaches.reduce((s, t) => s + calcCoutMO(t), 0);
  const totRes = totalTaches.reduce((s, t) => s + calcCoutRes(t), 0);
  const biblF = bibliotheque.filter(b => !search || b.libelle.toLowerCase().includes(search.toLowerCase()));
  const biblSel = bibliotheque.find(b => b.id === selectedOuvrage);
  const cadSel = parseFloat(biblSel?.cadence) || null;
  const hEstAjout = cadSel && quantiteInput ? parseFloat((cadSel * parseFloat(quantiteInput)).toFixed(2)) : null;
  const autoColor = autoSaveStatus === "saved" ? "#50c878" : autoSaveStatus === "saving" ? T.accent : "#f5a623";
  const autoLabel = autoSaveStatus === "saved" ? "✓ Sauvegardé" : autoSaveStatus === "saving" ? "Sauvegarde…" : "● Modification en cours";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: T.bg }}>
      {showImport && <ModaleImportExcel T={T} bibliotheque={bibliotheque} onImporter={handleImportExcel} onFermer={() => setShowImport(false)} />}

      {planifierTask && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setPlanifierTask(null)}>
          <div style={{ background: T.modal || T.surface, borderRadius: 16, width: "100%", maxWidth: 400, border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.sectionDivider}`, background: T.surface }}><div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>📅 Planifier une tâche</div></div>
            <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: T.card, padding: "12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{planifierTask.tache.nom}</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Durée : {planifierTask.tache.heures}h</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Semaine</label>
                <select value={planifierWeek} onChange={e => setPlanifierWeek(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                  <option value="" disabled>Choisir…</option>
                  {semainesFutures.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Jour</label>
                <select value={planifierJour} onChange={e => setPlanifierJour(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                  {JOURS.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
            </div>
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPlanifierTask(null)} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 18px", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={executerPlanification} disabled={isPlanningSaving || !planifierWeek} style={{ background: T.accent, border: "none", borderRadius: 8, padding: "9px 22px", color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{isPlanningSaving ? "Envoi..." : "✓ Confirmer"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Retour</button>
          <div style={{ width: 12, height: 36, borderRadius: 6, background: ch ? ch.couleur : T.accent }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{phasage.chantier_nom}</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>{ouvrages.length} ouvrage(s) · {totalH.toFixed(1)}h devis</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: autoColor, display: "flex", alignItems: "center", gap: 5 }}>
              {autoSaveStatus === "saving" && <svg width="12" height="12" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>}
              {autoLabel}
            </div>
            <button onClick={() => setShowPlanTravaux(true)} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Plan de travaux →</button>
            <button onClick={onDelete} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Supprimer</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "8px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.textMuted }}><span style={{ fontWeight: 700, color: T.accent }}>Devis</span> Heures vendues</span>
          <span style={{ fontSize: 12, color: T.textMuted }}><span style={{ fontWeight: 700, color: BLEU }}>Estimé</span> Cadence × quantité</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#50c878", background: "rgba(80,200,120,0.12)", border: "1px solid rgba(80,200,120,0.3)", borderRadius: 5, padding: "1px 7px" }}>+x% marge</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#e05c5c", background: "rgba(224,92,92,0.12)", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 5, padding: "1px 7px" }}>-x% dépassement</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
          {[["Avancement", `${avgAv}%`, avgAv === 100 ? "#50c878" : T.accent], ["Coût MO", totMO > 0 ? `${totMO.toFixed(0)} €` : "—", T.text], ["Coût ressources", totRes > 0 ? `${totRes.toFixed(0)} €` : "—", T.text], ["Coût total", (totMO + totRes) > 0 ? `${(totMO + totRes).toFixed(0)} €` : "—", T.accent]].map(([label, val, color]) => (
            <div key={label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
            </div>
          ))}
        </div>
        {totalTaches.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}><div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4 }}><div style={{ height: "100%", borderRadius: 4, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} /></div><span style={{ fontSize: 13, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 40 }}>{avgAv}%</span></div>}

        {!showAjout && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <button onClick={() => setShowAjout(true)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1.5px dashed ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Ajouter manuellement</button>
            <button onClick={() => setShowImport(true)} style={{ padding: "12px 22px", borderRadius: 10, border: `1.5px dashed ${T.accent}66`, background: `${T.accent}0A`, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📂 Importer un devis .xlsx</button>
          </div>
        )}

        {showAjout && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>Ajouter un ouvrage</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer les ouvrages…" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 10 }} />
            <select value={selectedOuvrage} onChange={e => { setSelectedOuvrage(e.target.value); setQuantiteInput(""); setHeuresInput(""); }} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: selectedOuvrage ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 12 }}>
              <option value="">Choisir un ouvrage…</option>
              {biblF.map(b => <option key={b.id} value={b.id}>{b.libelle} ({b.unite}){b.cadence ? ` — ${b.cadence}h/${b.unite}` : ""}</option>)}
            </select>
            {cadSel && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: `${BLEU}0D`, border: `1px solid ${BLEU}33`, borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BLEU, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>⏱ Cadence : {cadSel}h / {biblSel?.unite}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: T.textMuted }}>Quantité :</span>
                  <input type="number" min="0" step="1" value={quantiteInput} onChange={e => { setQuantiteInput(e.target.value); const q = parseFloat(e.target.value); if (q && cadSel) setHeuresInput((cadSel * q).toFixed(1)); }} style={{ width: 100, padding: "8px 12px", borderRadius: 8, border: `1px solid ${BLEU}55`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                  <span style={{ fontSize: 13, color: T.textMuted }}>{biblSel?.unite}</span>
                  {hEstAjout && <span style={{ fontSize: 13, fontWeight: 700, color: BLEU, background: `${BLEU}15`, padding: "4px 12px", borderRadius: 6 }}>→ {hEstAjout}h estimées</span>}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <span style={{ fontSize: 13, color: T.textMuted, whiteSpace: "nowrap" }}>Heures devis :</span>
                <input type="number" min="0.5" step="0.5" value={heuresInput} onChange={e => setHeuresInput(e.target.value)} placeholder="ex: 16" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                <span style={{ fontSize: 13, color: T.textMuted }}>h</span>
              </div>
              <button onClick={ajouterOuvrage} disabled={!selectedOuvrage || !heuresInput} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: selectedOuvrage && heuresInput ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: selectedOuvrage && heuresInput ? "pointer" : "default" }}>Générer les tâches</button>
              <button onClick={() => { setShowAjout(false); setSearch(""); setSelectedOuvrage(""); setHeuresInput(""); setQuantiteInput(""); }} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {ouvrages.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}><div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>Ajoutez des ouvrages manuellement ou importez votre devis Excel.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {ouvrages.map(ouvrage => {
              const isExp = expandedOuvrage === ouvrage.id;
              const ouvrAv = ouvrage.taches?.length > 0 ? Math.round(ouvrage.taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / ouvrage.taches.length) : 0;
              const ouvrCout = ouvrage.taches?.reduce((s, t) => s + calcCoutMO(t) + calcCoutRes(t), 0) || 0;
              const hEst = parseFloat(ouvrage.heures_estimees) || null;
              return (
                <div key={ouvrage.id} style={{ background: T.surface, border: `1px solid ${isExp ? T.accent : T.border}`, borderRadius: 12, overflow: "hidden", transition: "border .2s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", borderBottom: isExp ? `1px solid ${T.sectionDivider}` : "none" }} onClick={() => setExpandedOuvrage(isExp ? null : ouvrage.id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{ouvrage.libelle}</span>
                        <span style={{ fontSize: 11, color: T.textMuted, background: T.card, padding: "2px 7px", borderRadius: 4 }}>{ouvrage.unite}</span>
                        {ouvrage.libelle_devis && ouvrage.libelle_devis !== ouvrage.libelle && <span style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic", background: T.card, padding: "2px 8px", borderRadius: 4 }}>devis : "{ouvrage.libelle_devis}"</span>}
                        {!ouvrage.bibliotheque_id && <span style={{ fontSize: 10, color: "#f5a623", background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)", padding: "2px 8px", borderRadius: 4 }}>Sans bibliothèque</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, color: T.textMuted }}>Devis</span><span style={{ fontSize: 13, fontWeight: 800, color: T.accent }}>{ouvrage.heures_devis}h</span></div>
                        {hEst && <><span style={{ fontSize: 11, color: T.border }}>|</span><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, color: T.textMuted }}>Estimé</span><span style={{ fontSize: 13, fontWeight: 800, color: BLEU }}>{hEst}h</span></div><EcartBadge devis={ouvrage.heures_devis} estime={hEst} /></>}
                        <div style={{ width: 70, height: 4, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", borderRadius: 2, background: ouvrAv === 100 ? "#50c878" : T.accent, width: `${ouvrAv}%` }} /></div>
                        <span style={{ fontSize: 11, color: ouvrAv === 100 ? "#50c878" : T.textMuted }}>{ouvrAv}%</span>
                        {ouvrCout > 0 && <span style={{ fontSize: 11, color: T.accent }}>· {ouvrCout.toFixed(0)}€</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 11, color: T.textMuted }}>Devis :</span>
                        <input type="number" min="0.5" step="0.5" value={ouvrage.heures_devis} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); updateHeures(ouvrage.id, e.target.value); }} style={{ width: 58, padding: "4px 6px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }} />
                        <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                      </div>
                      <button onClick={e => { e.stopPropagation(); supprimerOuvrage(ouvrage.id); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>🗑</button>
                      <span style={{ fontSize: 12, color: isExp ? T.accent : T.textMuted }}>{isExp ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExp && (
                    <div style={{ padding: "0 18px 16px" }}>
                      {(ouvrage.taches || []).length === 0
                        ? <div style={{ padding: "18px 0", textAlign: "center", color: T.textMuted, fontSize: 13 }}>Aucune tâche — pas de correspondance en bibliothèque.</div>
                        : (ouvrage.taches || []).map((tache, ti) => {
                          const tacheKey = `${ouvrage.id}-${ti}`;
                          const isExpT = expandedTache === tacheKey;
                          const cMO = calcCoutMO(tache), cRes = calcCoutRes(tache), cT = cMO + cRes;
                          const av = parseFloat(tache.avancement) || 0;
                          const tEst = parseFloat(tache.heures_estimees) || null;
                          return (
                            <div key={ti} style={{ borderBottom: ti < ouvrage.taches.length - 1 ? `1px solid ${T.sectionDivider}` : "none", paddingBottom: isExpT ? 12 : 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }} onClick={() => setExpandedTache(isExpT ? null : tacheKey)}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: av === 100 ? "#50c878" : av > 0 ? "#f5a623" : T.border, flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: 13, color: T.text, fontWeight: 600 }}>{tache.nom}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, minWidth: 36, textAlign: "right" }}>{tache.heures}h</span>
                                {tEst && <><span style={{ fontSize: 11, color: T.border }}>|</span><span style={{ fontSize: 12, fontWeight: 700, color: BLEU, minWidth: 36, textAlign: "right" }}>{tEst}h</span><EcartBadge devis={tache.heures} estime={tEst} /></>}
                                <button onClick={e => { e.stopPropagation(); setPlanifierWeek(semainesFutures[0]); setPlanifierTask({ ouvrageId: ouvrage.id, tacheIdx: ti, tache }); }} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.accent}55`, background: T.accent + "15", color: T.accent, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "30"} onMouseLeave={e => e.currentTarget.style.background = T.accent + "15"}>📅 Planifier</button>
                                <span style={{ fontSize: 11, color: T.textMuted, minWidth: 28, textAlign: "right" }}>{tache.ratio}%</span>
                                {cT > 0 && <span style={{ fontSize: 12, color: T.accent, minWidth: 50, textAlign: "right" }}>{cT.toFixed(0)}€</span>}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 140 }} onClick={e => e.stopPropagation()}>
                                  <input type="range" min="0" max="100" step="5" value={av} onChange={e => updateTache(ouvrage.id, ti, { avancement: parseInt(e.target.value) })} style={{ flex: 1, accentColor: av === 100 ? "#50c878" : T.accent }} />
                                  <span style={{ fontSize: 12, fontWeight: 700, color: av === 100 ? "#50c878" : av > 0 ? "#f5a623" : T.textMuted, minWidth: 35, textAlign: "right" }}>{av}%</span>
                                </div>
                                <span style={{ fontSize: 11, color: isExpT ? T.accent : T.textMuted, marginLeft: 4 }}>{isExpT ? "▲" : "▼"}</span>
                              </div>

                              {isExpT && (
                                <div style={{ background: T.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${T.border}`, marginBottom: 4 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>👷 Main d'œuvre</div>
                                      {(tache.heures_reelles || []).map((h, hi) => (
                                        <div key={hi} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                          <select value={h.ouvrier} onChange={e => updateHeureMO(ouvrage.id, ti, hi, { ouvrier: e.target.value })} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none" }}>{ouvriers.map(o => <option key={o} value={o}>{o}</option>)}</select>
                                          <input type="number" min="0" step="0.5" value={h.heures || ""} onChange={e => updateHeureMO(ouvrage.id, ti, hi, { heures: parseFloat(e.target.value) || 0 })} placeholder="h" style={{ width: 52, padding: "6px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none" }} />
                                          <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                                          {tauxHoraires?.[h.ouvrier] > 0 && <span style={{ fontSize: 11, color: T.accent, minWidth: 45, textAlign: "right" }}>{((parseFloat(h.heures) || 0) * tauxHoraires[h.ouvrier]).toFixed(0)}€</span>}
                                          <button onClick={() => removeHeureMO(ouvrage.id, ti, hi)} style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>
                                        </div>
                                      ))}
                                      <button onClick={() => addHeureMO(ouvrage.id, ti)} style={{ padding: "6px 12px", borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 12, cursor: "pointer", width: "100%", marginTop: 4 }}>+ Ajouter un ouvrier</button>
                                      {cMO > 0 && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: T.text, textAlign: "right" }}>MO : <span style={{ color: T.accent }}>{cMO.toFixed(0)} €</span></div>}
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>🧱 Ressources</div>
                                      {(tache.ressources || []).map((r, ri) => (
                                        <div key={ri} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                          <input value={r.description || ""} onChange={e => updateRessource(ouvrage.id, ti, ri, { description: e.target.value })} placeholder="Description…" style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none" }} />
                                          <input type="number" min="0" step="1" value={r.montant || ""} onChange={e => updateRessource(ouvrage.id, ti, ri, { montant: parseFloat(e.target.value) || 0 })} placeholder="€" style={{ width: 70, padding: "6px", borderRadius: 6, textAlign: "right", border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 12, fontWeight: 700, outline: "none" }} />
                                          <span style={{ fontSize: 11, color: T.textMuted }}>€</span>
                                          <button onClick={() => removeRessource(ouvrage.id, ti, ri)} style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>
                                        </div>
                                      ))}
                                      <button onClick={() => addRessource(ouvrage.id, ti)} style={{ padding: "6px 12px", borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 12, cursor: "pointer", width: "100%", marginTop: 4 }}>+ Ajouter une ressource</button>
                                      {cRes > 0 && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: T.text, textAlign: "right" }}>Ressources : <span style={{ color: T.accent }}>{cRes.toFixed(0)} €</span></div>}
                                    </div>
                                  </div>
                                  {cT > 0 && <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.sectionDivider}`, display: "flex", justifyContent: "flex-end", gap: 20 }}><span style={{ fontSize: 12, color: T.textMuted }}>MO : {cMO.toFixed(0)}€</span><span style={{ fontSize: 12, color: T.textMuted }}>Ressources : {cRes.toFixed(0)}€</span><span style={{ fontSize: 13, fontWeight: 800, color: T.accent }}>Total : {cT.toFixed(0)} €</span></div>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.sectionDivider}` }}>
                        <span style={{ fontSize: 12, color: T.textMuted }}>{ouvrage.taches?.length || 0} tâche(s)</span>
                        {ouvrCout > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: T.accent }}>Total ouvrage : {ouvrCout.toFixed(0)} €</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "18px 22px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>Récapitulatif chantier</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${totalHEst > 0 ? 4 : 3}, 1fr)`, gap: 12 }}>
                <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 2 }}>Heures devis</div><div style={{ fontSize: 18, fontWeight: 800, color: T.accent }}>{totalH.toFixed(1)}h</div></div>
                {totalHEst > 0 && <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 2 }}>Heures estimées</div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 18, fontWeight: 800, color: BLEU }}>{totalHEst.toFixed(1)}h</div><EcartBadge devis={totalH} estime={totalHEst} /></div></div>}
                <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 2 }}>Coût MO</div><div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{totMO.toFixed(0)} €</div></div>
                <div><div style={{ fontSize: 11, color: T.textMuted, marginBottom: 2 }}>Coût ressources</div><div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{totRes.toFixed(0)} €</div></div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.sectionDivider}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 120, height: 6, background: T.border, borderRadius: 3 }}><div style={{ height: "100%", borderRadius: 3, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%` }} /></div>
                  <span style={{ fontSize: 13, color: avgAv === 100 ? "#50c878" : T.accent }}>{avgAv}% terminé</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.accent }}>{(totMO + totRes).toFixed(0)} €</div>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


// ─── PHASES DE TRAVAUX ────────────────────────────────────────────────────────
const PHASES = [
  { id: "demolition",      label: "Démolition",                     emoji: "🔨", couleur: "#e05c5c" },
  { id: "plomberie_ro",    label: "Réseaux plomberie (gros œuvre)", emoji: "🔵", couleur: "#3b82f6" },
  { id: "menuiserie",      label: "Menuiserie extérieure & intérieure", emoji: "🚪", couleur: "#8b5cf6" },
  { id: "feraillage",      label: "Feraillage cloisons & doublages",emoji: "🧱", couleur: "#f59e0b" },
  { id: "elec_vmc",        label: "Réseaux élec & VMC",             emoji: "⚡", couleur: "#eab308" },
  { id: "placo",           label: "Lainage / Placo / Bandes & enduits", emoji: "🪣", couleur: "#6366f1" },
  { id: "peinture_sols",   label: "Peintures & sols",               emoji: "🎨", couleur: "#ec4899" },
  { id: "finition_elec",   label: "Finitions électricité",          emoji: "💡", couleur: "#f97316" },
  { id: "finition_plomb",  label: "Finitions plomberie",            emoji: "🚿", couleur: "#06b6d4" },
  { id: "cuisine",         label: "Cuisine",                        emoji: "🍳", couleur: "#10b981" },
  { id: "finitions_gen",   label: "Finitions générales",            emoji: "✨", couleur: "#a78bfa" },
];

function PagePhasage({ chantiers, ouvriers, tauxHoraires, T }) {
  const [phasages, setPhasages] = useState([]);
  const [bibliotheque, setBibliotheque] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newChantier, setNewChantier] = useState("");

  useEffect(() => { loadAll(); }, []);
  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: b }] = await Promise.all([supabase.from("phasages").select("*").order("created_at", { ascending: false }), supabase.from("bibliotheque_ratios").select("*").order("libelle")]);
    setPhasages(p || []); setBibliotheque(b || []); setLoading(false);
  }
  async function creerPhasage() {
    if (!newChantier) return;
    const ch = chantiers.find(c => c.id === newChantier);
    const { data, error } = await supabase.from("phasages").insert({ chantier_id: newChantier, chantier_nom: ch ? ch.nom : newChantier, ouvrages: [] }).select().single();
    if (error) { console.error(error.message); return; }
    if (data) { setPhasages(p => [data, ...p]); setSelected(data); setShowNew(false); setNewChantier(""); }
  }
  async function savePhasage(phasage) {
    const { error } = await supabase.from("phasages").update({ ouvrages: phasage.ouvrages, updated_at: new Date().toISOString() }).eq("id", phasage.id);
    if (error) { console.error(error.message); return; }
    setPhasages(prev => prev.map(p => p.id === phasage.id ? phasage : p));
    if (selected?.id === phasage.id) setSelected(phasage);
  }
  async function supprimerPhasage(id) {
    if (!confirm("Supprimer ce phasage ?")) return;
    await supabase.from("phasages").delete().eq("id", id);
    setPhasages(prev => prev.filter(p => p.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  if (selected) return <PhasageDetail phasage={selected} bibliotheque={bibliotheque} T={T} chantiers={chantiers} ouvriers={ouvriers} tauxHoraires={tauxHoraires} onBack={() => setSelected(null)} onSave={savePhasage} onDelete={() => supprimerPhasage(selected.id)} />;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: T.bg }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: T.text }}>📋 Phasages chantiers</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Avancement, coûts MO et ressources par tâche</div>
          </div>
          <button onClick={() => setShowNew(true)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nouveau phasage</button>
        </div>
        {showNew && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Nouveau phasage</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select value={newChantier} onChange={e => setNewChantier(e.target.value)} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: newChantier ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                <option value="">Choisir un chantier…</option>
                {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
              <button onClick={creerPhasage} disabled={!newChantier} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newChantier ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newChantier ? "pointer" : "default" }}>Créer</button>
              <button onClick={() => { setShowNew(false); setNewChantier(""); }} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}
        {loading ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60 }}>Chargement…</div>
          : phasages.length === 0 ? <div style={{ textAlign: "center", padding: 60, color: T.textMuted }}><div style={{ fontSize: 32, marginBottom: 12 }}>📋</div><div>Aucun phasage. Créez-en un pour commencer.</div></div>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {phasages.map(p => {
                const ch = chantiers.find(c => c.id === p.chantier_id);
                const ol = p.ouvrages || [];
                const totalH = ol.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
                const totalTaches = ol.flatMap(o => o.taches || []);
                const avgAv = totalTaches.length > 0 ? Math.round(totalTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / totalTaches.length) : 0;
                const cout = ol.reduce((s, o) => s + (o.taches || []).reduce((s2, t) => s2 + (t.heures_reelles || []).reduce((s3, h) => s3 + ((parseFloat(h.heures) || 0) * (parseFloat(tauxHoraires?.[h.ouvrier]) || 0)), 0) + (t.ressources || []).reduce((s3, r) => s3 + (parseFloat(r.montant) || 0), 0), 0), 0);
                return (
                  <div key={p.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer", transition: "border .15s" }} onClick={() => setSelected(p)} onMouseEnter={e => e.currentTarget.style.borderColor = T.accent} onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                    <div style={{ width: 10, height: 56, borderRadius: 5, background: ch ? ch.couleur : T.accent, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{p.chantier_nom}</div>
                      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{ol.length} ouvrage{ol.length > 1 ? "s" : ""} · {totalH.toFixed(1)}h devis · {cout > 0 ? `${cout.toFixed(0)}€` : "Pas de coûts saisis"}</div>
                      {totalTaches.length > 0 && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", borderRadius: 2, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} /></div><span style={{ fontSize: 11, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 32 }}>{avgAv}%</span></div>}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={e => { e.stopPropagation(); supprimerPhasage(p.id); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>🗑</button>
                      <span style={{ fontSize: 18, color: T.textMuted, alignSelf: "center" }}>▶</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

export default PagePhasage;
