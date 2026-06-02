import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "./constants";
import { Icon } from "./ui";
import { ListChecks, Sparkles, Building2, Boxes, Hammer, ClipboardList, ChevronDown } from "lucide-react";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte du phasage : vue 3 colonnes (Lots → Ouvrages → Tâches) pour un
// chantier sélectionné en haut de page. Lit/écrit dans les mêmes tables
// Supabase que la v1 (`phasages`, `bibliotheque_ratios`, `planning_config`).
// Les ouvrages portent un nouveau champ `lot_id` qui les rattache à un lot.
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

  // Charge les lots (config Admin)
  useEffect(() => { loadLots().then(setLots); }, []);

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

  // Compte d'ouvrages par lot (pour le badge sur chaque lot)
  const countByLot = lots.reduce((acc, l) => {
    acc[l.id] = ouvrages.filter(o => o.lot_id === l.id).length;
    return acc;
  }, {});
  const orphans = ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id)).length;

  const ouvragesLot = selectedLotId
    ? ouvrages.filter(o => (selectedLotId === "_orphans" ? (!o.lot_id || !lots.some(l => l.id === o.lot_id)) : o.lot_id === selectedLotId))
    : [];
  const selectedOuvrage = ouvragesLot.find(o => o.id === selectedOuvrageId) || null;
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
  const colBody = { flex: 1, overflowY: "auto", padding: "8px 6px" };
  const rowItem = (active) => ({
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px", margin: "2px 4px",
    borderRadius: RADIUS.md,
    background: active ? acc.bg10 : "transparent",
    border: `1px solid ${active ? acc.border : "transparent"}`,
    color: active ? acc.accent : T.text,
    cursor: "pointer", fontSize: FONT.sm.size,
    transition: "all .12s",
  });
  const emptyColMsg = (label) => (
    <div style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size + 1, fontStyle: "italic" }}>
      {label}
    </div>
  );

  // ── Pas de chantier sélectionné : placeholder ───────────────────────────
  const noChantier = !chantierId;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
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

        {/* Sélecteur chantier */}
        <div style={{ position: "relative", marginLeft: "auto", minWidth: 240 }}>
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
                  <div key={l.id} onClick={() => { setSelectedLotId(l.id); setSelectedOuvrageId(null); }}
                    style={rowItem(active)}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: l.couleur, flexShrink: 0 }}/>
                    <span style={{ flex: 1, fontWeight: 600 }}>{l.label}</span>
                    {count > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 7px",
                        borderRadius: RADIUS.pill,
                        background: active ? "rgba(255,255,255,0.12)" : T.card,
                        color: active ? acc.accent : T.textMuted,
                      }}>{count}</span>
                    )}
                  </div>
                );
              })}
              {orphans > 0 && (
                <div onClick={() => { setSelectedLotId("_orphans"); setSelectedOuvrageId(null); }}
                  style={{ ...rowItem(selectedLotId === "_orphans"), marginTop: 8, borderTop: `1px dashed ${T.border}`, paddingTop: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: T.textMuted, flexShrink: 0, opacity: .5 }}/>
                  <span style={{ flex: 1, fontStyle: "italic", color: T.textMuted }}>Sans lot</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 7px",
                    borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                  }}>{orphans}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Colonne 2 : Ouvrages ── */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}>
              <Icon as={Hammer} size={12}/> Ouvrages
              {selectedLotId && ouvragesLot.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 7px",
                  borderRadius: RADIUS.pill, background: T.card, color: T.textMuted, marginLeft: "auto",
                }}>{ouvragesLot.length}</span>
              )}
            </div>
            <div style={colBody}>
              {!selectedLotId
                ? emptyColMsg("Sélectionne un lot à gauche")
                : ouvragesLot.length === 0
                  ? emptyColMsg("Aucun ouvrage pour ce lot")
                  : ouvragesLot.map(o => {
                    const active = selectedOuvrageId === o.id;
                    const nbTaches = (o.taches || []).length;
                    return (
                      <div key={o.id} onClick={() => setSelectedOuvrageId(o.id)} style={rowItem(active)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: FONT.sm.size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.libelle || "(sans libellé)"}
                          </div>
                          {(o.heures_devis || o.quantite || o.prix_ht) && (
                            <div style={{ fontSize: FONT.xs.size, color: active ? acc.accent : T.textMuted, marginTop: 2, opacity: active ? .9 : 1 }}>
                              {o.heures_devis ? `${o.heures_devis}h` : ""}
                              {o.quantite ? `${o.heures_devis ? " · " : ""}${o.quantite} ${o.unite || ""}` : ""}
                              {o.prix_ht ? `${(o.heures_devis||o.quantite) ? " · " : ""}${o.prix_ht.toLocaleString("fr-FR")} €` : ""}
                            </div>
                          )}
                        </div>
                        {nbTaches > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 7px",
                            borderRadius: RADIUS.pill,
                            background: active ? "rgba(255,255,255,0.12)" : T.card,
                            color: active ? acc.accent : T.textMuted, flexShrink: 0,
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
              {selectedOuvrage && taches.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 7px",
                  borderRadius: RADIUS.pill, background: T.card, color: T.textMuted, marginLeft: "auto",
                }}>{taches.length}</span>
              )}
            </div>
            <div style={colBody}>
              {!selectedOuvrage
                ? emptyColMsg("Sélectionne un ouvrage")
                : taches.length === 0
                  ? emptyColMsg("Aucune tâche pour cet ouvrage")
                  : taches.map((t, i) => (
                    <div key={i} style={{
                      padding: "10px 12px", margin: "2px 4px",
                      borderRadius: RADIUS.md,
                      background: T.card, border: `1px solid ${T.border}`,
                      fontSize: FONT.sm.size, color: T.text,
                    }}>
                      <div style={{ fontWeight: 600 }}>{t.nom || "(sans nom)"}</div>
                      {(t.heures_estimees || t.avancement !== undefined) && (
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, display: "flex", gap: 10 }}>
                          {t.heures_estimees ? <span>{t.heures_estimees}h estimées</span> : null}
                          {t.avancement !== undefined && t.avancement !== null && t.avancement !== "" ? <span>{t.avancement}% fait</span> : null}
                        </div>
                      )}
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PagePhasageV2;
