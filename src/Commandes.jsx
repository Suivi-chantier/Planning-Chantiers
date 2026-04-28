import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { COULEURS_PALETTE, THEMES, emptyCommande } from "./constants";

// Statuts pour les commandes (hors besoin_ouvrier)
const STATUTS_CMD = {
  a_commander: { label: "À commander", color: "#f5a623", bg: "rgba(245,166,35,0.12)", border: "rgba(245,166,35,0.3)" },
  commande:    { label: "Commandé",    color: "#50c878", bg: "rgba(80,200,120,0.12)", border: "rgba(80,200,120,0.3)" },
  retire:      { label: "Retiré",      color: "#9aa5c0", bg: "rgba(154,165,192,0.10)", border: "rgba(154,165,192,0.2)" },
};

// ─── PANNEAU DEMANDES OUVRIERS ────────────────────────────────────────────────
// Couleurs internes fixes (dark) — indépendantes du thème passé en prop
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

function PanneauDemandes({ demandes, chantiers, T, onClose, onConvertir }) {
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    const init = {};
    demandes.forEach(d => {
      init[d.id] = {
        article:      d.article      || "",
        fournisseur:  d.fournisseur  || "",
        quantite:     d.quantite     || "",
        notes:        d.notes        || "",
        priorite:     d.priorite     || "normal",
        chantier_id:  d.chantier_id  || "",
      };
    });
    setDrafts(init);
  }, [demandes]);

  const set = (id, field, val) =>
    setDrafts(p => ({ ...p, [id]: { ...p[id], [field]: val } }));

  const inp = (highlight) => ({
    background: P.inputBg,
    border: `1px solid ${highlight ? "rgba(224,92,92,0.5)" : P.border}`,
    borderRadius: 7,
    padding: "7px 10px",
    color: P.text,
    fontFamily: "inherit",
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  });

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        zIndex: 800,
      }} />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(520px, 100vw)",
        background: P.surface,
        borderLeft: `1px solid ${P.border}`,
        zIndex: 801,
        display: "flex", flexDirection: "column",
        boxShadow: "-24px 0 80px rgba(0,0,0,0.6)",
        animation: "slideIn .25s cubic-bezier(.22,1,.36,1)",
      }}>

        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${P.border}`,
          background: "rgba(176,96,255,0.10)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(176,96,255,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
              }}>📋</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: P.text }}>
                  Demandes ouvriers
                </div>
                <div style={{ fontSize: 12, color: "#b060ff", fontWeight: 600, marginTop: 2 }}>
                  {demandes.length} demande{demandes.length > 1 ? "s" : ""} en attente
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent",
              border: `1px solid ${P.border}`,
              borderRadius: 8, width: 34, height: 34,
              cursor: "pointer", color: P.textSub,
              fontSize: 20, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>
        </div>

        {/* Scrollable list */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "16px 20px",
          display: "flex", flexDirection: "column", gap: 14,
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
            const ch      = chantiers.find(c => c.id === d.chantier_id);
            const draft   = drafts[d.id] || {};
            const urgent  = d.priorite === "urgent";
            const dateD   = d.created_at
              ? new Date(d.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
              : "—";
            const heureD  = d.created_at
              ? new Date(d.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
              : "";

            return (
              <div key={d.id} style={{
                background: P.card,
                border: `1px solid ${urgent ? "rgba(224,92,92,0.45)" : "rgba(176,96,255,0.3)"}`,
                borderRadius: 14,
                overflow: "hidden",
              }}>

                {/* En-tête carte */}
                <div style={{
                  padding: "10px 14px",
                  background: urgent ? "rgba(224,92,92,0.10)" : "rgba(176,96,255,0.09)",
                  borderBottom: `1px solid ${P.border}`,
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 8, flexWrap: "wrap",
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
                        fontSize: 11, fontWeight: 700, color: "#a0b8ff",
                        background: "rgba(160,184,255,0.14)", borderRadius: 5, padding: "2px 7px",
                      }}>👤 {d.ouvrier_demandeur}</span>
                    )}
                    {urgent && (
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: "#e05c5c",
                        background: "rgba(224,92,92,0.15)", borderRadius: 5,
                        padding: "2px 7px", border: "1px solid rgba(224,92,92,0.3)",
                      }}>🔴 URGENT</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: P.textMuted, whiteSpace: "nowrap" }}>
                    {dateD} {heureD}
                  </span>
                </div>

                {/* Demande brute */}
                <div style={{
                  padding: "10px 14px",
                  borderBottom: `1px solid ${P.border}`,
                  background: "rgba(255,255,255,0.02)",
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: P.textMuted,
                    textTransform: "uppercase", letterSpacing: 1, marginBottom: 5,
                  }}>Demande brute</div>
                  <div style={{ fontSize: 13, color: "#c8b0ff", fontStyle: "italic" }}>
                    « {d.article || "—"} »
                    {d.quantite && <span style={{ color: P.textSub }}> · {d.quantite}</span>}
                  </div>
                  {d.notes && (
                    <div style={{ fontSize: 12, color: P.textMuted, marginTop: 4 }}>{d.notes}</div>
                  )}
                </div>

                {/* Formulaire conversion */}
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: P.textMuted,
                    textTransform: "uppercase", letterSpacing: 1, marginBottom: 2,
                  }}>↳ Convertir en commande</div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      value={draft.article || ""}
                      onChange={e => set(d.id, "article", e.target.value)}
                      placeholder="Article exact *"
                      style={inp(!draft.article)}
                    />
                    <input
                      value={draft.fournisseur || ""}
                      onChange={e => set(d.id, "fournisseur", e.target.value)}
                      placeholder="Fournisseur"
                      style={inp(false)}
                    />
                    <input
                      value={draft.quantite || ""}
                      onChange={e => set(d.id, "quantite", e.target.value)}
                      placeholder="Quantité"
                      style={inp(false)}
                    />
                    <select
                      value={draft.priorite || "normal"}
                      onChange={e => set(d.id, "priorite", e.target.value)}
                      style={{
                        ...inp(false),
                        color: draft.priorite === "urgent" ? "#e05c5c" : "#c0a060",
                        fontWeight: 700,
                      }}
                    >
                      <option value="normal" style={{ background: "#1e2540" }}>🟡 Normal</option>
                      <option value="urgent" style={{ background: "#1e2540" }}>🔴 Urgent</option>
                    </select>
                  </div>

                  <input
                    value={draft.notes || ""}
                    onChange={e => set(d.id, "notes", e.target.value)}
                    placeholder="Notes additionnelles"
                    style={inp(false)}
                  />

                  <button
                    onClick={() => onConvertir(d, draft)}
                    disabled={!draft.article?.trim()}
                    style={{
                      marginTop: 2,
                      padding: "9px 0",
                      background: draft.article?.trim() ? "#b060ff" : "rgba(176,96,255,0.15)",
                      border: `1px solid ${draft.article?.trim() ? "#b060ff" : "rgba(176,96,255,0.2)"}`,
                      borderRadius: 8,
                      color: draft.article?.trim() ? "#fff" : P.textMuted,
                      fontFamily: "inherit", fontSize: 13, fontWeight: 800,
                      cursor: draft.article?.trim() ? "pointer" : "not-allowed",
                      transition: "all .15s",
                      width: "100%",
                    }}
                  >
                    ✓ Valider comme commande
                  </button>
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
function BoutonDemandes({ count, onClick, T }) {
  const hasNew = count > 0;
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      {/* Anneau pulsant */}
      {hasNew && (
        <span style={{
          position: "absolute", inset: 0,
          borderRadius: 10,
          border: "2px solid #e05c5c",
          animation: "pulseRing 1.6s ease-out infinite",
          pointerEvents: "none",
        }} />
      )}
      <button
        onClick={onClick}
        style={{
          background: hasNew ? "rgba(224,92,92,0.15)" : T.card,
          border: `1px solid ${hasNew ? "rgba(224,92,92,0.5)" : T.border}`,
          borderRadius: 10,
          padding: "10px 18px",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 700,
          color: hasNew ? "#e05c5c" : T.textSub,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "all .2s",
          position: "relative",
        }}
      >
        <span style={{ fontSize: 16 }}>{hasNew ? "📋" : "📋"}</span>
        Demandes ouvriers
        {hasNew && (
          <span style={{
            background: "#e05c5c",
            color: "#fff",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 900,
            padding: "1px 7px",
            minWidth: 20,
            textAlign: "center",
            animation: "badgePulse 1.2s ease-in-out infinite",
          }}>
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── PAGE COMMANDES ───────────────────────────────────────────────────────────
function PageCommandes({ chantiers, T }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterChantier, setFilterChantier] = useState("all");
  const [filterStatut, setFilterStatut] = useState("all");
  const [filterOuvrier, setFilterOuvrier] = useState("all");
  const [editRow, setEditRow] = useState(null);
  const [newRow, setNewRow] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [modaleCommande, setModaleCommande] = useState(null);
  const [phasages, setPhasages] = useState([]);
  const [modalePrix, setModalePrix] = useState("");
  const [modalePhaseId, setModalePhaseId] = useState("");
  const [modaleTacheId, setModaleTacheId] = useState("");
  const [panneauOuvert, setPanneauOuvert] = useState(false);

  // Demandes ouvriers = statut "besoin_ouvrier"
  // Demandes ouvriers — tolère les variantes orthographiques du statut
  const isDemande = (r) => r.statut === "besoin_ouvrier" || r.statut === "besoin ouvrier" || r.statut === "besoin_ouvriers";
  const demandes = rows.filter(isDemande);
  // Commandes = tout le reste
  const commandes = rows.filter(r => !isDemande(r));

  const isEnRetard = (row) => {
    if (row.statut === "commande" || row.statut === "retire") return false;
    if (!row.created_at) return false;
    const diffJ = (new Date() - new Date(row.created_at)) / (1000 * 60 * 60 * 24);
    return diffJ > (row.priorite === "urgent" ? 2 : 5);
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("commandes_detail").select("*").order("created_at", { ascending: true });
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.from("phasages").select("id,chantier_nom,plan_travaux").then(({ data }) => setPhasages(data || []));
  }, []);

  useEffect(() => {
    const ch = supabase.channel("commandes-detail")
      .on("postgres_changes", { event: "*", schema: "public", table: "commandes_detail" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Convertir une demande ouvrier en commande réelle
  const convertirDemande = async (demande, draft) => {
    const updates = {
      article: draft.article?.trim() || demande.article,
      fournisseur: draft.fournisseur?.trim() || "",
      quantite: draft.quantite?.trim() || demande.quantite,
      notes: draft.notes?.trim() || demande.notes,
      priorite: draft.priorite || "normal",
      statut: "a_commander",
    };
    await supabase.from("commandes_detail").update(updates).eq("id", demande.id);
    setRows(prev => prev.map(r => r.id === demande.id ? { ...r, ...updates } : r));
    // Fermer le panneau si plus de demandes
    if (demandes.length <= 1) setPanneauOuvert(false);
  };

  const saveRow = async (row) => {
    setEditRow(null); setNewRow(null); setEditDraft(null);
    if (row.id) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...row } : r));
      const baseFields = {
        chantier_id: row.chantier_id ?? "",
        article: row.article ?? "",
        fournisseur: row.fournisseur ?? "",
        quantite: row.quantite ?? "",
        statut: row.statut ?? "a_commander",
        notes: row.notes ?? "",
      };
      const { error: e1 } = await supabase.from("commandes_detail").update(baseFields).eq("id", row.id);
      if (e1) { console.error(e1); alert("Erreur sauvegarde: " + e1.message); load(); return; }
      await supabase.from("commandes_detail").update({
        priorite: row.priorite ?? "normal",
        ouvrier_demandeur: row.ouvrier_demandeur ?? "",
      }).eq("id", row.id);
    } else {
      const fields = {
        chantier_id: row.chantier_id ?? "",
        article: row.article ?? "",
        fournisseur: row.fournisseur ?? "",
        quantite: row.quantite ?? "",
        statut: row.statut ?? "a_commander",
        notes: row.notes ?? "",
      };
      const { data: created, error } = await supabase.from("commandes_detail").insert(fields).select().single();
      if (error) { alert("Erreur création: " + error.message); }
      else if (created) {
        await supabase.from("commandes_detail").update({
          priorite: row.priorite ?? "normal",
          ouvrier_demandeur: row.ouvrier_demandeur ?? "",
        }).eq("id", created.id);
      }
    }
    load();
  };

  const deleteRow = async (id) => {
    if (!confirm("Supprimer cette ligne ?")) return;
    await supabase.from("commandes_detail").delete().eq("id", id);
    load();
  };

  const cycleStatut = async (row) => {
    const order = ["a_commander", "commande", "retire"];
    const curIdx = order.indexOf(row.statut);
    const next = order[(curIdx >= 0 ? curIdx + 1 : 1) % order.length];
    if (next === "commande") {
      setModalePrix(row.prix_ht || "");
      setModalePhaseId(""); setModaleTacheId("");
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
    if (modalePhaseId && modaleTacheId) {
      updates.phasage_id = modalePhaseId;
      updates.tache_id = modaleTacheId;
    }
    await supabase.from("commandes_detail").update(updates).eq("id", row.id);
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...updates } : r));
    if (prix && modalePhaseId && modaleTacheId) {
      const phasage = phasages.find(p => p.id === modalePhaseId);
      if (phasage?.plan_travaux) {
        const plan = phasage.plan_travaux;
        let updated = false;
        const newPlan = {};
        Object.keys(plan).forEach(phId => {
          if (!Array.isArray(plan[phId])) { newPlan[phId] = plan[phId]; return; }
          newPlan[phId] = plan[phId].map(t => {
            if (t.id !== modaleTacheId) return t;
            updated = true;
            const autresCmds = rows.filter(r => r.id !== row.id && r.tache_id === modaleTacheId && r.prix_ht);
            const totalMat = autresCmds.reduce((s, r) => s + (parseFloat(r.prix_ht) || 0), 0) + prix;
            return { ...t, cout_materiel: parseFloat(totalMat.toFixed(2)) };
          });
        });
        if (updated) {
          await supabase.from("phasages").update({ plan_travaux: newPlan }).eq("id", modalePhaseId);
          setPhasages(prev => prev.map(p => p.id === modalePhaseId ? { ...p, plan_travaux: newPlan } : p));
        }
      }
    }
    setModaleCommande(null);
  };

  // Filtres sur les commandes uniquement (pas les demandes brutes)
  const STATUTS_COMMANDES = ["a_commander", "commande", "retire"];
  const filtered = commandes.filter(r =>
    (filterChantier === "all" || r.chantier_id === filterChantier) &&
    (filterStatut === "all" || r.statut === filterStatut) &&
    (filterOuvrier === "all" || r.ouvrier_demandeur === filterOuvrier)
  );

  const ouvriersDansCmds = [...new Set(commandes.map(r => r.ouvrier_demandeur).filter(Boolean))];
  const counts = Object.fromEntries(
    STATUTS_COMMANDES.map(k => [k, commandes.filter(r => r.statut === k).length])
  );

  const STATUTS = STATUTS_CMD;

  const phasageModale = phasages.find(p => p.id === modalePhaseId);
  const tachesModale = phasageModale?.plan_travaux
    ? Object.entries(phasageModale.plan_travaux)
      .filter(([k, v]) => k !== "meta" && Array.isArray(v))
      .flatMap(([phId, arr]) => arr.map(t => ({ ...t, phId })))
    : [];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

      {/* ── Panneau demandes ── */}
      {panneauOuvert && (
        <PanneauDemandes
          demandes={demandes}
          chantiers={chantiers}
          T={T}
          onClose={() => setPanneauOuvert(false)}
          onConvertir={convertirDemande}
        />
      )}

      {/* ── Modale passage à "Commandé" ── */}
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
                width: 36, height: 36, borderRadius: 10, background: "rgba(80,200,120,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
              }}>🛒</div>
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
                    onChange={e => setModalePrix(e.target.value)}
                    placeholder="ex: 450.00"
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
                }}>Lier à un plan de travail</label>
                <select value={modalePhaseId} onChange={e => { setModalePhaseId(e.target.value); setModaleTacheId(""); }}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
                    background: T.inputBg, color: modalePhaseId ? T.text : T.textMuted,
                    fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 8,
                  }}>
                  <option value="">— Choisir un chantier / phasage —</option>
                  {phasages.map(p => <option key={p.id} value={p.id}>{p.chantier_nom}</option>)}
                </select>
                {modalePhaseId && (
                  <select value={modaleTacheId} onChange={e => setModaleTacheId(e.target.value)}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
                      background: T.inputBg, color: modaleTacheId ? T.text : T.textMuted,
                      fontFamily: "inherit", fontSize: 13, outline: "none",
                    }}>
                    <option value="">— Choisir une tâche —</option>
                    {tachesModale.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.nom}{t.ouvrage_libelle ? ` (${t.ouvrage_libelle})` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {!modalePhaseId && (
                  <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                    Optionnel — le coût matériel sera automatiquement ajouté à la tâche liée.
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
                padding: "9px 24px", borderRadius: 8, border: "none",
                background: "#50c878", color: "#111", fontFamily: "inherit",
                fontSize: 13, fontWeight: 800, cursor: "pointer",
              }}>✓ Confirmer la commande</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        marginBottom: 24, display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", flexWrap: "wrap", gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>Commandes</div>
          <div style={{ fontSize: 14, color: T.textSub }}>Suivi des besoins par chantier et par fournisseur</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Bouton demandes ouvriers */}
          <BoutonDemandes
            count={demandes.length}
            onClick={() => setPanneauOuvert(true)}
            T={T}
          />
          <button
            onClick={() => { const e = emptyCommande(); setNewRow(e); setEditDraft(e); }}
            style={{
              background: T.accent, color: "#fff", border: "none",
              borderRadius: 10, padding: "11px 22px", fontFamily: "inherit",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>
            + Nouvelle commande
          </button>
        </div>
      </div>

      {/* ── Compteurs statut (commandes uniquement) ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {STATUTS_COMMANDES.map(k => {
          const v = STATUTS[k];
          return (
            <div key={k} style={{
              background: v.bg, border: `1px solid ${v.border}`, borderRadius: 10,
              padding: "10px 18px", cursor: "pointer", transition: "all .15s",
              outline: filterStatut === k ? `2px solid ${v.color}` : "none",
            }} onClick={() => setFilterStatut(filterStatut === k ? "all" : k)}>
              <div style={{ fontSize: 20, fontWeight: 800, color: v.color }}>{counts[k] || 0}</div>
              <div style={{ fontSize: 12, color: v.color, fontWeight: 600 }}>{v.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Filtres ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          {
            value: filterChantier, onChange: setFilterChantier,
            options: [{ value: "all", label: "Tous les chantiers" }, ...chantiers.map(c => ({ value: c.id, label: c.nom }))],
          },
          {
            value: filterStatut, onChange: setFilterStatut,
            options: [{ value: "all", label: "Tous les statuts" }, ...STATUTS_COMMANDES.map(k => ({ value: k, label: STATUTS[k].label }))],
          },
          {
            value: filterOuvrier, onChange: setFilterOuvrier,
            options: [{ value: "all", label: "Tous les ouvriers" }, ...ouvriersDansCmds.map(o => ({ value: o, label: o }))],
          },
        ].map((sel, i) => (
          <select key={i} value={sel.value} onChange={e => sel.onChange(e.target.value)}
            style={{
              background: "#1e2336", border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "8px 12px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13, outline: "none",
            }}>
            {sel.options.map(o => (
              <option key={o.value} value={o.value} style={{ background: "#1e2336", color: "#e8eaf0" }}>{o.label}</option>
            ))}
          </select>
        ))}
        {commandes.filter(r => isEnRetard(r)).length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            background: "rgba(224,92,92,0.12)", border: "1px solid rgba(224,92,92,0.3)",
            borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#e05c5c",
          }}>
            ⚠️ {commandes.filter(r => isEnRetard(r)).length} en retard
          </div>
        )}
      </div>

      {/* ── Tableau commandes ── */}
      <div style={{ background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden" }}>
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
            {/* Ligne nouvelle commande */}
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
                  <button onClick={() => saveRow(editDraft)} style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginRight: 6 }}>✓</button>
                  <button onClick={() => { setNewRow(null); setEditDraft(null); }} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", color: T.textSub, fontFamily: "inherit" }}>✕</button>
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
              const retard = isEnRetard(row);
              const urgent = row.priorite === "urgent";
              const rowBg = retard ? "rgba(224,92,92,0.10)" : urgent ? "rgba(224,92,92,0.05)" : "transparent";
              const rowBorderLeft = retard ? "3px solid #e05c5c" : urgent ? "3px solid rgba(224,92,92,0.5)" : "3px solid transparent";

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
                    <button onClick={() => saveRow(editDraft)} style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginRight: 6 }}>✓</button>
                    <button onClick={() => { setEditRow(null); setEditDraft(null); }} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", color: T.textSub, fontFamily: "inherit" }}>✕</button>
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
                  onMouseEnter={e => e.currentTarget.style.background = retard ? "rgba(224,92,92,0.16)" : urgent ? "rgba(224,92,92,0.1)" : T.card}
                  onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                  <td style={{ padding: "11px 10px" }}>
                    {ch ? <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: ch.couleur, display: "block", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{ch.nom}</span>
                    </span> : <span style={{ fontSize: 12, color: T.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "11px 10px", fontWeight: 600 }}>
                    <div style={{ fontSize: 13, color: retard ? "#f08080" : T.text }}>
                      {retard && <span title="En retard !" style={{ marginRight: 5 }}>⚠️</span>}
                      {row.article || "—"}
                    </div>
                  </td>
                  <td style={{ padding: "11px 10px", fontSize: 13, color: T.textSub }}>{row.fournisseur || <span style={{ color: T.emptyColor, fontSize: 12 }}>À renseigner</span>}</td>
                  <td style={{ padding: "11px 10px", fontSize: 13, color: T.textSub }}>
                    <div>{row.quantite || "—"}</div>
                    {row.prix_ht > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#50c878", marginTop: 2 }}>{parseFloat(row.prix_ht).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div>}
                    {row.tache_id && <div style={{ fontSize: 10, color: "#5b9cf6", marginTop: 1 }}>🔗 Lié au plan</div>}
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button onClick={() => cycleStatut(row)} style={{
                        background: st.bg, border: `1px solid ${st.border}`, borderRadius: 6,
                        padding: "4px 10px", fontSize: 12, fontWeight: 700, color: st.color,
                        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all .15s",
                      }} title="Cliquer pour changer le statut">{st.label}</button>
                      <span style={{
                        display: "inline-block", borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 700,
                        background: urgent ? "rgba(224,92,92,0.15)" : "rgba(245,166,35,0.10)",
                        color: urgent ? "#e05c5c" : "#c0a060",
                        border: `1px solid ${urgent ? "rgba(224,92,92,0.35)" : "rgba(245,166,35,0.2)"}`,
                        alignSelf: "flex-start",
                      }}>{urgent ? "🔴 Urgent" : "🟡 Normal"}</span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    {row.ouvrier_demandeur && (
                      <div style={{ fontSize: 12, color: "#a0b8ff", fontWeight: 700, marginBottom: 2 }}>
                        👤 {row.ouvrier_demandeur}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: T.textSub, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.notes || ""}
                    </div>
                  </td>
                  <td style={{ padding: "11px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: retard ? "#e05c5c" : urgent ? "#f5a070" : T.textMuted }}>{dateCreation}</div>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{heureCreation}</div>
                    {retard && <div style={{ fontSize: 10, color: "#e05c5c", fontWeight: 700, marginTop: 2 }}>EN RETARD</div>}
                  </td>
                  <td style={{ padding: "11px 10px", whiteSpace: "nowrap" }}>
                    <button onClick={() => { setEditRow(row.id); setEditDraft({ ...row }); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, opacity: .6, marginRight: 4, color: T.text }} title="Modifier">✏️</button>
                    <button onClick={() => deleteRow(row.id)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, opacity: .5, color: "#e05c5c" }} title="Supprimer">🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Résumé par fournisseur ── */}
      {commandes.filter(r => r.statut !== "retire" && r.fournisseur).length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted, marginBottom: 12 }}>
            Par fournisseur
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {[...new Set(commandes.filter(r => r.statut !== "retire" && r.fournisseur).map(r => r.fournisseur))].map(f => {
              const items = commandes.filter(r => r.fournisseur === f && r.statut !== "retire");
              return (
                <div key={f} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: T.text }}>{f}</div>
                  {items.map(it => (
                    <div key={it.id} style={{ fontSize: 12, color: T.textSub, marginBottom: 3, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: STATUTS[it.statut]?.color || "#888", display: "block", flexShrink: 0 }} />
                      {it.article}{it.quantite ? ` × ${it.quantite}` : ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
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
