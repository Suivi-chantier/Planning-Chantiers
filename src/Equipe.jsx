import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, BIBLIOTHEQUE_INITIALE, getCurrentWeek, getWeekId } from "./constants";

// ─── PAGE ÉQUIPE ──────────────────────────────────────────────────────────────
// ─── HEURES PAR JOUR ─────────────────────────────────────────────────────────
const HEURES_PAR_JOUR = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9 };

// ─── MODAL BILAN SEMAINE ──────────────────────────────────────────────────────
function BilanSemaine({ rapports, chantiers, cells, weekId, onClose, T }) {
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftStatus, setDraftStatus]     = useState(null);

  // ── Détection ouvriers sur plusieurs chantiers un même jour ─────────────────
  const conflits = (() => {
    const result = [];
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const parOuvrier = {};
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!parOuvrier[o]) parOuvrier[o] = [];
          parOuvrier[o].push(cid);
        });
      });
      Object.entries(parOuvrier).forEach(([ouvrier, chantierIds]) => {
        if (chantierIds.length < 2) return;
        const heuresJour = HEURES_PAR_JOUR[jour];
        const heuresInit = {};
        chantierIds.forEach(cid => { heuresInit[cid] = parseFloat((heuresJour / chantierIds.length).toFixed(1)); });
        result.push({ jour, ouvrier, chantierIds, heures: heuresInit, heuresJour });
      });
    });
    return result;
  })();

  const [etape, setEtape] = useState(conflits.length > 0 ? "saisie" : "bilan");
  const [heuresSaisies, setHeuresSaisies] = useState(() => {
    const init = {};
    conflits.forEach(c => {
      if (!init[c.jour]) init[c.jour] = {};
      init[c.jour][c.ouvrier] = { ...c.heures };
    });
    return init;
  });

  const setH = (jour, ouvrier, chantierId, val) => {
    setHeuresSaisies(prev => ({
      ...prev,
      [jour]: { ...prev[jour], [ouvrier]: { ...prev[jour]?.[ouvrier], [chantierId]: val } }
    }));
  };

  // ── Calcul heures réelles par chantier ───────────────────────────────────────
  const calcHeuresParChantier = () => {
    const res = {};
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const heuresJour = HEURES_PAR_JOUR[jour];
      const conflitsJour = conflits.filter(c => c.jour === jour);
      const ouvrierEnConflit = new Set(conflitsJour.map(c => c.ouvrier));
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!res[cid]) res[cid] = 0;
          if (ouvrierEnConflit.has(o)) {
            res[cid] += parseFloat(heuresSaisies[jour]?.[o]?.[cid] || 0);
          } else {
            res[cid] += heuresJour;
          }
        });
      });
    });
    return res;
  };

  const heuresParChantier = etape === "bilan" ? calcHeuresParChantier() : {};
  const totalHeures = Object.values(heuresParChantier).reduce((a, b) => a + b, 0);
  const totalFaites = rapports.reduce((a, r) => a + (r.taches||[]).filter(t => t.statut==="faite").length, 0);

  // ── Regroupement rapports par chantier ───────────────────────────────────────
  const parChantier = {};
  rapports.forEach(r => {
    const key = r.chantier_id || "__divers__";
    if (!parChantier[key]) parChantier[key] = { rapports: [], nom: r.chantier_nom || "Divers" };
    parChantier[key].rapports.push(r);
  });

  // ── Création brouillon Gmail ─────────────────────────────────────────────────
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [showNotes, setShowNotes]         = useState(false);
  const [notesLibres, setNotesLibres]     = useState("");

  const genererDocx = async () => {
    setGeneratingDoc(true);
    setDraftStatus(null);
    try {
      const hpc = calcHeuresParChantier();
      const totalH = Object.values(hpc).reduce((a, b) => a + b, 0);

      // Construire les données structurées pour le document
      const chantierData = Object.entries(parChantier).map(([cId, grp]) => {
        const hCh = hpc[cId] || 0;
        const taches = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier: r.ouvrier})));
        const presences = [];
        Object.keys(HEURES_PAR_JOUR).forEach(jour => {
          const cell = cells[`${cId}_${jour}`];
          if (cell && (cell.ouvriers||[]).length)
            presences.push(`${jour} : ${cell.ouvriers.join(", ")}`);
        });
        return {
          nom: grp.nom,
          heures: hCh,
          presences,
          faites:    taches.filter(t=>t.statut==="faite").map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier })),
          enCours:   taches.filter(t=>t.statut==="en_cours").map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier })),
          nonFaites: taches.filter(t=>t.statut==="non_faite").map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier })),
          remarques: grp.rapports.filter(r=>r.remarque?.trim()).map(r=>({ ouvrier: r.ouvrier, texte: r.remarque })),
        };
      });

      const response = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, totalH, chantierData, notesLibres })
      });

      if (!response.ok) {
        const err = await response.json().catch(()=>({error:"Erreur serveur"}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      // Télécharger le fichier
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Compte-rendu-${weekId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setDraftStatus("ok");
    } catch(e) {
      console.error("Erreur génération docx:", e);
      setDraftStatus("error");
    }
    setGeneratingDoc(false);
  };

  // ── Écran saisie heures (étape 1) ────────────────────────────────────────────
  if (etape === "saisie") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", zIndex:600,
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:16, backdropFilter:"blur(4px)" }} onClick={onClose}>
        <div style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:580,
          maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column",
          border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
          minHeight:0 }} onClick={e => e.stopPropagation()}>
          <div style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
            padding:"20px 24px", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Étape 1 / 2</div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:6 }}>Répartition des heures</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", lineHeight:1.5 }}>
              Ces ouvriers étaient planifiés sur plusieurs chantiers le même jour. Indique combien d'heures ils ont passé sur chaque chantier.
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:20, minHeight:0 }}>
            {conflits.map((c, idx) => {
              const total = c.chantierIds.reduce((s, cid) => s + parseFloat(heuresSaisies[c.jour]?.[c.ouvrier]?.[cid] || 0), 0);
              const ecart = parseFloat((c.heuresJour - total).toFixed(2));
              const ok = Math.abs(ecart) < 0.05;
              return (
                <div key={idx} style={{ background:T.surface,
                  border:`1px solid ${ok ? T.border : "rgba(224,92,92,0.4)"}`, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ background:"rgba(255,194,0,0.15)", border:"1px solid rgba(255,194,0,0.3)",
                      borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700, color:T.accent }}>{c.jour}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:"#e8eaf0" }}>👷 {c.ouvrier}</div>
                    <div style={{ fontSize:12, color:T.textMuted }}>({c.heuresJour}h dans la journée)</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {c.chantierIds.map(cid => {
                      const ch = chantiers.find(x => x.id === cid);
                      const val = heuresSaisies[c.jour]?.[c.ouvrier]?.[cid] ?? c.heures[cid];
                      return (
                        <div key={cid} style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
                            <div style={{ width:10, height:10, borderRadius:3, background:ch?.couleur||"#5b8af5", flexShrink:0 }}/>
                            <div style={{ fontSize:13, fontWeight:700, color:"#e8eaf0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {ch?.nom || cid}
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                            <input type="number" min={0} max={c.heuresJour} step={0.5} value={val}
                              onChange={e => setH(c.jour, c.ouvrier, cid, parseFloat(e.target.value)||0)}
                              style={{ width:68, background:T.fieldBg||"#1a1d28",
                                border:`1.5px solid ${ok ? T.border : "rgba(224,92,92,0.5)"}`,
                                borderRadius:8, padding:"7px 10px", color:"#e8eaf0",
                                fontFamily:"inherit", fontSize:15, fontWeight:700,
                                textAlign:"center", outline:"none" }}/>
                            <span style={{ fontSize:13, color:T.textMuted }}>h</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${T.border}`,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:T.textMuted }}>Total saisi</span>
                    <span style={{ fontSize:14, fontWeight:800,
                      color: ok ? "#50c878" : Math.abs(ecart)<1 ? T.accent : "#e05c5c" }}>
                      {total.toFixed(1)}h / {c.heuresJour}h
                      {ok ? " ✓" : ecart>0 ? ` (${ecart.toFixed(1)}h restantes)` : ` (dépassement de ${Math.abs(ecart).toFixed(1)}h)`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding:"16px 24px", borderTop:`1px solid ${T.border}`,
            display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
            <button onClick={onClose} style={{ background:"transparent", border:`1px solid ${T.border}`,
              borderRadius:10, padding:"10px 20px", color:T.textSub,
              fontFamily:"inherit", fontSize:14, cursor:"pointer" }}>Annuler</button>
            <button onClick={() => setEtape("bilan")} style={{ background:T.accent, border:"none",
              borderRadius:10, padding:"10px 24px", color:"#111",
              fontFamily:"inherit", fontSize:14, fontWeight:800, cursor:"pointer" }}>Voir le bilan →</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Bilan (étape 2) ──────────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:600,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:16, backdropFilter:"blur(4px)" }} onClick={onClose}>
      <div style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:740,
        maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column",
        border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", minHeight:0
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
          padding:"22px 28px", display:"flex", alignItems:"center",
          justifyContent:"space-between", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Bilan de la semaine</div>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff" }}>{weekId}</div>
          </div>
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:T.accent }}>{totalHeures.toFixed(1)}h</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Heures réelles</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:"#50c878" }}>{totalFaites}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Tâches faites</div>
            </div>
            <button onClick={()=>setShowNotes(true)} disabled={generatingDoc}
              style={{ background: draftStatus==="ok" ? "rgba(80,200,120,0.85)" : generatingDoc ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.85)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: generatingDoc ? "wait" : "pointer", fontSize:13, fontWeight:700,
                color:"#fff", display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap",
                opacity: generatingDoc ? 0.7 : 1 }}>
              {generatingDoc ? "⏳ Génération…" : draftStatus==="ok" ? "✅ Téléchargé !" : draftStatus==="error" ? "❌ Erreur" : "📄 Compte rendu .docx"}
            </button>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none",
              borderRadius:10, width:40, height:40, cursor:"pointer", fontSize:20, color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        </div>

        {/* Modale notes libres */}
        {showNotes&&(
          <div style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16
          }} onClick={()=>setShowNotes(false)}>
            <div style={{
              background:"#1e2336", borderRadius:16, width:"100%", maxWidth:560,
              border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              display:"flex", flexDirection:"column", overflow:"hidden"
            }} onClick={e=>e.stopPropagation()}>
              {/* Header */}
              <div style={{padding:"20px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:18, fontWeight:800, color:"#e8eaf0", marginBottom:6}}>
                  📝 Enrichir le compte rendu
                </div>
                <div style={{fontSize:13, color:"#5b6a8a", lineHeight:1.6}}>
                  Ajoute ici toutes les précisions que tu veux inclure dans le document :
                  contexte supplémentaire, corrections, points importants, instructions de mise en forme…
                  Ces notes seront transmises à la génération du .docx.
                </div>
              </div>
              {/* Zone texte */}
              <div style={{padding:"20px 24px"}}>
                <textarea
                  value={notesLibres}
                  onChange={e=>setNotesLibres(e.target.value)}
                  placeholder={`Exemple :
- Le chantier LOU a pris du retard à cause des livraisons
- Mettre en avant la bonne avancée sur ARTHUR
- Le vélux a été posé mais avec difficulté, mentionner que c'est soldé
- Ajouter une mention sur les malfaçons corrigées`}
                  autoFocus
                  style={{
                    width:"100%", minHeight:180, background:"rgba(255,255,255,0.05)",
                    border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10,
                    padding:"14px 16px", color:"#e8eaf0", fontFamily:"inherit",
                    fontSize:14, lineHeight:1.7, resize:"vertical", outline:"none",
                    boxSizing:"border-box"
                  }}
                />
                <div style={{fontSize:11, color:"#5b6a8a", marginTop:8}}>
                  Laisse vide pour générer le document sans notes supplémentaires.
                </div>
              </div>
              {/* Footer */}
              <div style={{
                padding:"16px 24px", borderTop:"1px solid rgba(255,255,255,0.08)",
                display:"flex", gap:10, justifyContent:"flex-end"
              }}>
                <button onClick={()=>setShowNotes(false)} style={{
                  background:"transparent", border:"1px solid rgba(255,255,255,0.15)",
                  borderRadius:10, padding:"10px 20px", color:"#9aa5c0",
                  fontFamily:"inherit", fontSize:14, cursor:"pointer"
                }}>Annuler</button>
                <button onClick={()=>{ setShowNotes(false); genererDocx(); }} style={{
                  background:"rgba(91,138,245,0.9)", border:"none",
                  borderRadius:10, padding:"10px 24px", color:"#fff",
                  fontFamily:"inherit", fontSize:14, fontWeight:800, cursor:"pointer"
                }}>📄 Générer le .docx</button>
              </div>
            </div>
          </div>
        )}

        {/* Corps */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:16, minHeight:0 }}>
          {Object.keys(parChantier).length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted, fontSize:15 }}>
              Aucun compte rendu pour cette semaine.
            </div>
          )}
          {Object.entries(parChantier).map(([cId, grp]) => {
            const ch = chantiers.find(c => c.id === cId);
            const heures = heuresParChantier[cId] || 0;
            const detailJours = [];
            Object.entries(HEURES_PAR_JOUR).forEach(([jour]) => {
              const cell = cells[`${cId}_${jour}`];
              if (!cell || !(cell.ouvriers||[]).length) return;
              detailJours.push({ jour, ouvriers: cell.ouvriers });
            });
            const toutesTouches = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier:r.ouvrier})));
            const faites    = toutesTouches.filter(t => t.statut==="faite");
            const enCours   = toutesTouches.filter(t => t.statut==="en_cours");
            const nonFaites = toutesTouches.filter(t => t.statut==="non_faite");
            const remarques = grp.rapports.filter(r => r.remarque?.trim());
            return (
              <div key={cId} style={{ background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:14, overflow:"hidden", borderLeft:`5px solid ${ch?.couleur||"#5b8af5"}` }}>
                <div style={{ padding:"16px 20px", display:"flex", alignItems:"center",
                  justifyContent:"space-between", flexWrap:"wrap", gap:12,
                  background: ch ? ch.couleur+"18" : T.card }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    {ch && <div style={{ width:14, height:14, borderRadius:4, background:ch.couleur, flexShrink:0 }}/>}
                    <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{grp.nom}</div>
                  </div>
                  {heures > 0 && (
                    <div style={{ background:T.accent+"22", border:`1.5px solid ${T.accent}55`,
                      borderRadius:10, padding:"8px 16px", textAlign:"center" }}>
                      <div style={{ fontSize:22, fontWeight:800, color:T.accent, lineHeight:1 }}>{heures.toFixed(1)}h</div>
                      <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:1, marginTop:2 }}>réelles</div>
                    </div>
                  )}
                </div>
                <div style={{ padding:"14px 20px", display:"flex", flexDirection:"column", gap:14 }}>
                  {detailJours.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>⏱ Présences</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                        {detailJours.map(({jour, ouvriers}) => (
                          <div key={jour} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 12px" }}>
                            <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, marginBottom:4 }}>{jour}</div>
                            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                              {ouvriers.map(o => (
                                <span key={o} style={{ background:ch?.couleur+"44"||T.tagBg, color:T.text,
                                  borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700 }}>{o}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {faites.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#50c878", marginBottom:8 }}>✅ Réalisé</div>
                      {faites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#50c878", flexShrink:0 }}>✓</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {enCours.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:T.accent, marginBottom:8 }}>🔄 En cours</div>
                      {enCours.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:T.accent, flexShrink:0 }}>→</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {nonFaites.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#e05c5c", marginBottom:8 }}>❌ Non réalisé</div>
                      {nonFaites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#e05c5c", flexShrink:0 }}>✕</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {remarques.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#a0b8ff", marginBottom:8 }}>💬 Remarques</div>
                      {remarques.map((r,i) => (
                        <div key={i} style={{ fontSize:13, color:T.textSub, marginBottom:4 }}>
                          <strong style={{color:T.text}}>{r.ouvrier}</strong> : {r.remarque}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PageEquipe({chantiers, ouvriers, weekId, cells, T}) {
  const [rapports, setRapports]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterOuvrier, setFilterOuvrier] = useState("all");
  const [filterChantier, setFilterChantier] = useState("all");
  const [filterSemaine, setFilterSemaine]   = useState(weekId);
  const [groupBy, setGroupBy]         = useState("ouvrier"); // "ouvrier" | "chantier"
  const [showBilan, setShowBilan]     = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});

  const appUrl = window.location.origin + "/rapport";
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("rapports").select("*").order("date_rapport",{ascending:false}).order("submitted_at",{ascending:false});
    if (filterOuvrier !== "all") q = q.eq("ouvrier", filterOuvrier);
    if (filterChantier !== "all") q = q.eq("chantier_id", filterChantier);
    if (filterSemaine) q = q.eq("semaine", filterSemaine);
    const { data } = await q;
    setRapports(data||[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterOuvrier, filterChantier, filterSemaine]);

  useEffect(() => {
    const ch = supabase.channel("rapports-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"rapports"},()=>load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [filterOuvrier, filterChantier, filterSemaine]);

  const copyLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  };

  const semaines = [];
  const now = getCurrentWeek();
  for (let i=0; i<8; i++) {
    let w = now.week - i; let y = now.year;
    if (w <= 0) { w += 52; y--; }
    semaines.push(getWeekId(y,w));
  }

  // ── Groupement des rapports ──────────────────────────────────────────────
  const grouped = (() => {
    const map = {};
    rapports.forEach(r => {
      const key   = groupBy === "ouvrier" ? (r.ouvrier||"?") : (r.chantier_id||"__divers__");
      const label = groupBy === "ouvrier" ? (r.ouvrier||"?") : (r.chantier_nom || chantiers.find(c=>c.id===r.chantier_id)?.nom || "Divers");
      if (!map[key]) map[key] = { key, label, rapports: [] };
      map[key].rapports.push(r);
    });
    return Object.values(map).sort((a,b) => a.label.localeCompare(b.label));
  })();

  const toggleGroup = (key) => setExpandedGroups(p => ({...p, [key]: !p[key]}));

  // Stats globales
  const allTaches = rapports.flatMap(r => r.taches||[]);
  const stats = {
    total:   rapports.length,
    faites:  allTaches.filter(t=>t.statut==="faite").length,
    enCours: allTaches.filter(t=>t.statut==="en_cours").length,
    nonFaites: allTaches.filter(t=>t.statut==="non_faite").length,
    heures:  allTaches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0),
  };

  return (
    <div className="page-padding" style={{flex:1,overflowY:"auto",padding:"24px 28px",background:T.bg}}>
      {showBilan&&(
        <BilanSemaine rapports={rapports} chantiers={chantiers} cells={cells}
          weekId={filterSemaine||weekId} onClose={()=>setShowBilan(false)} T={T}/>
      )}

      {/* ── Header ── */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",
        marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:26,fontWeight:800,letterSpacing:1,marginBottom:2}}>Équipe</div>
          <div style={{fontSize:13,color:T.textSub}}>Comptes rendus journaliers de l'équipe</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setShowBilan(true)} style={{
            background:"linear-gradient(135deg,#FFC200,#e6ae00)",color:"#111",border:"none",
            borderRadius:10,padding:"9px 18px",fontFamily:"inherit",fontSize:13,fontWeight:800,
            cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            📊 Bilan semaine
          </button>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,
            padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
            <code style={{fontSize:12,color:T.accent}}>{appUrl}</code>
            <button onClick={copyLink} style={{background:T.accent,color:"#fff",border:"none",
              borderRadius:6,padding:"6px 12px",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {copied?"✓ Copié !":"📋 Copier"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Filtres + tri ── */}
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
        padding:"14px 16px",marginBottom:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>

        {/* Tri / groupement */}
        <div style={{display:"flex",background:T.card,borderRadius:8,padding:3,gap:2,flexShrink:0}}>
          {[["ouvrier","👷 Par ouvrier"],["chantier","🏗️ Par chantier"]].map(([v,l])=>(
            <button key={v} onClick={()=>setGroupBy(v)} style={{
              padding:"6px 14px",borderRadius:6,border:"none",cursor:"pointer",
              fontFamily:"inherit",fontSize:12,fontWeight:700,
              background: groupBy===v ? T.accent : "transparent",
              color: groupBy===v ? "#111" : T.textMuted,
              transition:"all .15s",
            }}>{l}</button>
          ))}
        </div>

        <div style={{width:1,height:28,background:T.border,flexShrink:0}}/>

        {/* Semaine */}
        <select value={filterSemaine} onChange={e=>setFilterSemaine(e.target.value)}
          style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"7px 10px",color:T.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="">Toutes les semaines</option>
          {semaines.map(s=><option key={s} value={s}>{s}</option>)}
        </select>

        {/* Ouvrier */}
        <select value={filterOuvrier} onChange={e=>setFilterOuvrier(e.target.value)}
          style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"7px 10px",color:T.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all">Tous les ouvriers</option>
          {ouvriers.map(o=><option key={o} value={o}>{o}</option>)}
        </select>

        {/* Chantier */}
        <select value={filterChantier} onChange={e=>setFilterChantier(e.target.value)}
          style={{background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,
            padding:"7px 10px",color:T.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
          <option value="all">Tous les chantiers</option>
          {chantiers.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>

        {(filterOuvrier!=="all"||filterChantier!=="all")&&(
          <button onClick={()=>{setFilterOuvrier("all");setFilterChantier("all");}}
            style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:7,
              padding:"6px 10px",color:T.textMuted,fontFamily:"inherit",fontSize:12,cursor:"pointer"}}>
            ✕ Réinitialiser
          </button>
        )}
      </div>

      {/* ── Stats ── */}
      {rapports.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
          {[
            {label:"Comptes rendus", val:stats.total,    color:T.accent,        icon:"📋"},
            {label:"Heures réelles", val:stats.heures>0?stats.heures.toFixed(1)+"h":"—", color:"#5b9cf6", icon:"⏱"},
            {label:"Tâches faites",  val:stats.faites,   color:"#50c878",       icon:"✅"},
            {label:"En cours",       val:stats.enCours,  color:"#f5a623",       icon:"🔄"},
            {label:"Non faites",     val:stats.nonFaites,color:"#e05c5c",       icon:"❌"},
          ].map(s=>(
            <div key={s.label} style={{background:T.surface,border:`1px solid ${T.border}`,
              borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:8,background:s.color+"18",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                {s.icon}
              </div>
              <div>
                <div style={{fontSize:20,fontWeight:800,color:s.color,lineHeight:1}}>{s.val}</div>
                <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contenu ── */}
      {loading&&<div style={{color:T.textMuted,padding:40,textAlign:"center"}}>Chargement…</div>}

      {!loading&&rapports.length===0&&(
        <div style={{background:T.surface,border:`1px dashed ${T.border}`,borderRadius:14,
          padding:"48px 32px",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Aucun compte rendu</div>
          <div style={{fontSize:13,color:T.textSub}}>Partage le lien ci-dessus à ton équipe.</div>
        </div>
      )}

      {/* ── Groupes ── */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {grouped.map(grp => {
          const isOpen = expandedGroups[grp.key] !== false; // ouvert par défaut
          const ch = groupBy==="chantier" ? chantiers.find(c=>c.id===grp.key) : null;
          const grpTaches = grp.rapports.flatMap(r=>r.taches||[]);
          const grpFaites   = grpTaches.filter(t=>t.statut==="faite").length;
          const grpEnCours  = grpTaches.filter(t=>t.statut==="en_cours").length;
          const grpNonFaites= grpTaches.filter(t=>t.statut==="non_faite").length;
          const grpHeures   = grpTaches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0);
          const accentColor = ch?.couleur || T.accent;

          return (
            <div key={grp.key} style={{background:T.surface,border:`1px solid ${T.border}`,
              borderRadius:14,overflow:"hidden"}}>

              {/* En-tête groupe */}
              <div onClick={()=>toggleGroup(grp.key)} style={{
                padding:"14px 18px",cursor:"pointer",
                background: ch ? ch.couleur+"14" : T.card,
                borderBottom: isOpen ? `1px solid ${T.sectionDivider}` : "none",
                display:"flex",alignItems:"center",gap:12,
                borderLeft:`4px solid ${accentColor}`,
              }}>
                {/* Icône / avatar */}
                <div style={{width:38,height:38,borderRadius:10,flexShrink:0,
                  background:accentColor+"22",border:`1.5px solid ${accentColor}44`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,fontWeight:800,color:accentColor}}>
                  {groupBy==="ouvrier" ? grp.label[0].toUpperCase() : "🏗️"}
                </div>

                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:16,fontWeight:800,color:T.text}}>{grp.label}</div>
                  <div style={{fontSize:12,color:T.textMuted,marginTop:1}}>
                    {grp.rapports.length} compte{grp.rapports.length>1?"s":""} rendu{grp.rapports.length>1?"s":""}
                    {grpHeures>0&&<> · <span style={{color:"#5b9cf6",fontWeight:700}}>{grpHeures.toFixed(1)}h</span></>}
                  </div>
                </div>

                {/* Mini stats */}
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {grpFaites>0&&<span style={{fontSize:12,fontWeight:700,color:"#50c878",
                    background:"rgba(80,200,120,0.12)",borderRadius:6,padding:"3px 8px"}}>✅ {grpFaites}</span>}
                  {grpEnCours>0&&<span style={{fontSize:12,fontWeight:700,color:"#f5a623",
                    background:"rgba(245,166,35,0.12)",borderRadius:6,padding:"3px 8px"}}>🔄 {grpEnCours}</span>}
                  {grpNonFaites>0&&<span style={{fontSize:12,fontWeight:700,color:"#e05c5c",
                    background:"rgba(224,92,92,0.12)",borderRadius:6,padding:"3px 8px"}}>❌ {grpNonFaites}</span>}
                  <span style={{color:T.textMuted,fontSize:14,marginLeft:4}}>{isOpen?"▲":"▼"}</span>
                </div>
              </div>

              {/* Rapports du groupe */}
              {isOpen&&(
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {grp.rapports.map((r,ri) => {
                    const rCh = chantiers.find(c=>c.id===r.chantier_id);
                    const taches = r.taches||[];
                    const faites    = taches.filter(t=>t.statut==="faite");
                    const enCours   = taches.filter(t=>t.statut==="en_cours");
                    const nonFaites = taches.filter(t=>t.statut==="non_faite");
                    const heuresTotal = taches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0);

                    return (
                      <div key={r.id} style={{
                        borderTop: ri>0 ? `1px solid ${T.sectionDivider}` : "none",
                        padding:"16px 20px",
                      }}>
                        {/* Ligne meta */}
                        <div style={{display:"flex",alignItems:"center",gap:10,
                          marginBottom:12,flexWrap:"wrap"}}>
                          {/* Date */}
                          <div style={{fontSize:13,fontWeight:700,color:T.textMuted,
                            background:T.card,borderRadius:6,padding:"3px 9px",border:`1px solid ${T.border}`}}>
                            📅 {r.date_rapport}
                          </div>
                          {/* Ouvrier (si vue chantier) */}
                          {groupBy==="chantier"&&(
                            <div style={{fontSize:13,fontWeight:700,color:T.accent,
                              background:T.accent+"15",borderRadius:6,padding:"3px 9px"}}>
                              👷 {r.ouvrier}
                            </div>
                          )}
                          {/* Chantier (si vue ouvrier) */}
                          {groupBy==="ouvrier"&&rCh&&(
                            <div style={{fontSize:12,fontWeight:700,color:"#1a1f2e",
                              background:rCh.couleur,borderRadius:6,padding:"3px 9px"}}>
                              {rCh.nom}
                            </div>
                          )}
                          {/* Heures totales */}
                          {heuresTotal>0&&(
                            <div style={{fontSize:13,fontWeight:800,color:"#5b9cf6",
                              background:"rgba(91,156,246,0.12)",borderRadius:6,padding:"3px 9px",
                              border:"1px solid rgba(91,156,246,0.25)"}}>
                              ⏱ {heuresTotal.toFixed(1)}h
                            </div>
                          )}
                          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                            {faites.length>0&&<span style={{fontSize:12,color:"#50c878",fontWeight:700}}>✅{faites.length}</span>}
                            {enCours.length>0&&<span style={{fontSize:12,color:"#f5a623",fontWeight:700}}>🔄{enCours.length}</span>}
                            {nonFaites.length>0&&<span style={{fontSize:12,color:"#e05c5c",fontWeight:700}}>❌{nonFaites.length}</span>}
                            <button onClick={async()=>{
                              if(!confirm(`Supprimer le CR de ${r.ouvrier} du ${r.date_rapport} ?`))return;
                              await supabase.from("rapports").delete().eq("id",r.id);
                              setRapports(p=>p.filter(x=>x.id!==r.id));
                            }} style={{background:"transparent",border:"none",color:"#e05c5c",
                              cursor:"pointer",fontSize:14,padding:"0 4px",opacity:.6}}>🗑</button>
                          </div>
                        </div>

                        {/* Tâches */}
                        {taches.length>0&&(
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {[["faite","✅","#50c878","rgba(80,200,120,0.08)","rgba(80,200,120,0.2)",faites],
                              ["en_cours","🔄","#f5a623","rgba(245,166,35,0.08)","rgba(245,166,35,0.2)",enCours],
                              ["non_faite","❌","#e05c5c","rgba(224,92,92,0.08)","rgba(224,92,92,0.2)",nonFaites],
                            ].filter(([,,,,, arr])=>arr.length>0).map(([statut,icon,color,bg,border,arr])=>(
                              <div key={statut} style={{background:bg,border:`1px solid ${border}`,
                                borderRadius:10,padding:"10px 14px"}}>
                                <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,
                                  textTransform:"uppercase",color,marginBottom:8}}>
                                  {icon} {statut==="faite"?"Réalisé":statut==="en_cours"?"En cours":"Non réalisé"}
                                </div>
                                {arr.map((t,ti)=>(
                                  <div key={ti} style={{display:"flex",alignItems:"flex-start",
                                    gap:10,padding:"6px 0",
                                    borderTop:ti>0?`1px solid ${border}`:""  }}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:14,fontWeight:600,color:"#1a1f2e",lineHeight:1.4}}>
                                        {t.planifie||t.text||""}
                                      </div>
                                      {t.remarque&&(
                                        <div style={{fontSize:13,color:"#555",marginTop:3,
                                          fontStyle:"italic",paddingLeft:8,
                                          borderLeft:`2px solid ${color}66`}}>
                                          {t.remarque}
                                        </div>
                                      )}
                                    </div>
                                    {t.heures_reelles>0&&(
                                      <div style={{fontSize:12,fontWeight:800,color,flexShrink:0,
                                        background:"rgba(255,255,255,0.6)",borderRadius:5,
                                        padding:"2px 7px",border:`1px solid ${border}`}}>
                                        {t.heures_reelles}h
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Remarque générale */}
                        {r.remarque?.trim()&&(
                          <div style={{marginTop:10,padding:"10px 14px",
                            background:"rgba(91,138,245,0.08)",borderRadius:10,
                            border:"1px solid rgba(91,138,245,0.2)",
                            borderLeft:`3px solid #5b8af5`}}>
                            <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,
                              textTransform:"uppercase",color:"#5b8af5",marginBottom:5}}>
                              💬 Remarque générale
                            </div>
                            <div style={{fontSize:14,color:T.text,lineHeight:1.5}}>{r.remarque}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DONNÉES BIBLIOTHÈQUE ─────────────────────────────────────────────────────

export default PageEquipe;
