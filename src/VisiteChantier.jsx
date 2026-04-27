import { useState, useEffect } from "react";
import { supabase } from "./supabase";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const PHASES = [
  { id: "preparation",   label: "Préparation",     color: "#6366f1" },
  { id: "grosOeuvre",    label: "Gros Œuvre",       color: "#f59e0b" },
  { id: "secondOeuvre",  label: "Second Œuvre",     color: "#3b82f6" },
  { id: "finitions",     label: "Finitions",        color: "#22c55e" },
  { id: "reception",     label: "Réception",        color: "#a855f7" },
];

const STATUT_VISITE = [
  { id: "en_cours",   label: "En cours",   color: "#f59e0b" },
  { id: "terminee",   label: "Terminée",   color: "#22c55e" },
  { id: "annulee",    label: "Annulée",    color: "#ef4444" },
];

const genId = () => Math.random().toString(36).slice(2);
const today  = () => new Date().toISOString().split("T")[0];
const formatDate = (d) => {
  if (!d) return "—";
  const [y, m, j] = d.split("-");
  return `${j}/${m}/${y}`;
};

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
async function loadVisites(supabase) {
  const { data } = await supabase
    .from("visites_chantier")
    .select("*")
    .order("date", { ascending: false });
  return data || [];
}

async function loadPhasages(supabase) {
  const { data } = await supabase
    .from("phasages")
    .select("id, chantier_id, chantier_nom, plan_travaux");
  return data || [];
}

async function saveVisite(supabase, visite) {
  const { error } = await supabase
    .from("visites_chantier")
    .upsert(visite);
  return !error;
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────────────────────
export default function PageVisiteChantier({ chantiers = [], T }) {
  const [view,     setView]     = useState("liste");   // liste | new | detail
  const [visites,  setVisites]  = useState([]);
  const [phasages, setPhasages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!supabase) return;
    loadVisites(supabase).then(setVisites);
    loadPhasages(supabase).then(setPhasages);
  }, [supabase]);

  const handleSave = async (visite) => {
    setSaving(true);
    const ok = await saveVisite(supabase, visite);
    if (ok) {
      setVisites(prev => {
        const idx = prev.findIndex(v => v.id === visite.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = visite; return n; }
        return [visite, ...prev];
      });
    }
    setSaving(false);
    setView("liste");
  };

  // ── LISTE ──
  if (view === "liste") return (
    <ListeVisites
      visites={visites}
      chantiers={chantiers}
      T={T}
      onNew={() => setView("new")}
      onSelect={v => { setSelected(v); setView("detail"); }}
    />
  );

  // ── NOUVELLE VISITE ──
  if (view === "new") return (
    <FormVisite
      chantiers={chantiers}
      phasages={phasages}
      T={T}
      saving={saving}
      onSave={handleSave}
      onCancel={() => setView("liste")}
    />
  );

  // ── DÉTAIL ──
  if (view === "detail" && selected) return (
    <DetailVisite
      visite={selected}
      chantiers={chantiers}
      phasages={phasages}
      T={T}
      saving={saving}
      onSave={v => { setSelected(v); handleSave(v); }}
      onBack={() => setView("liste")}
    />
  );

  return null;
}

// ─── LISTE DES VISITES ────────────────────────────────────────────────────────
function ListeVisites({ visites, chantiers, T, onNew, onSelect }) {
  const getChantier = (id) => chantiers.find(c => c.id === id);

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>
            Visites de chantier
          </div>
          <div style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
            {visites.length} visite{visites.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button onClick={onNew} style={{
          padding: "10px 22px", borderRadius: 10, border: "none", cursor: "pointer",
          background: T.accent, color: "#fff", fontFamily: "inherit",
          fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Nouvelle visite
        </button>
      </div>

      {/* Vide */}
      {visites.length === 0 && (
        <div style={{
          background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 14,
          padding: 60, textAlign: "center", color: T.textMuted,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Aucune visite pour le moment</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Créez votre première visite de chantier</div>
        </div>
      )}

      {/* Cartes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visites.map(v => {
          const ch  = getChantier(v.chantier_id);
          const all = Object.values(v.points_controle || {}).flat();
          const ok  = all.filter(x => x === "ok").length;
          const res = all.filter(x => x === "reserve").length;
          const nok = all.filter(x => x === "non_ok").length;
          const total = ok + res + nok;
          const st = STATUT_VISITE.find(s => s.id === v.statut);

          return (
            <div key={v.id} onClick={() => onSelect(v)} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: "16px 20px", cursor: "pointer", display: "flex",
              alignItems: "center", gap: 16,
              transition: "border-color .15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: T.accent + "18", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>🔍</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                  {ch?.nom || v.chantier_id}
                </div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                  {formatDate(v.date)}
                </div>
              </div>

              {/* Statut */}
              <span style={{
                padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: (st?.color || "#888") + "22", color: st?.color || "#888",
              }}>{st?.label || v.statut}</span>

              {/* Compteurs */}
              {total > 0 && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {ok  > 0 && <Pill val={ok}  color="#22c55e" icon="✓" T={T} />}
                  {res > 0 && <Pill val={res} color="#f59e0b" icon="⚠" T={T} />}
                  {nok > 0 && <Pill val={nok} color="#ef4444" icon="✕" T={T} />}
                </div>
              )}

              <div style={{ fontSize: 18, color: T.textMuted, flexShrink: 0 }}>›</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FORMULAIRE NOUVELLE VISITE ───────────────────────────────────────────────
function FormVisite({ chantiers, phasages, T, saving, onSave, onCancel }) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id || "");
  const [date,       setDate]       = useState(today());

  // Phasage associé au chantier sélectionné
  const phasage = phasages.find(p => p.chantier_id === chantierId);
  const plan    = phasage?.plan_travaux || {};

  // Toutes les tâches du plan, toutes phases confondues
  const toutesLesTaches = PHASES.flatMap(ph =>
    (plan[ph.id] || []).map(t => ({ ...t, phaseLabel: ph.label, phaseColor: ph.color }))
  );

  const handleSave = () => {
    if (!chantierId) return;
    onSave({
      id:              genId(),
      chantier_id:     chantierId,
      date,
      statut:          "en_cours",
      points_controle: {},
      observations:    {},
      note_generale:   "",
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <button onClick={onCancel} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
          padding: "6px 14px", cursor: "pointer", color: T.text,
          fontFamily: "inherit", fontSize: 13,
        }}>← Retour</button>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Nouvelle visite</div>
      </div>

      {/* Champ chantier + date */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 24, marginBottom: 20,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          textTransform: "uppercase", color: T.textMuted, marginBottom: 16,
        }}>Informations générales</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 6 }}>
              Chantier *
            </label>
            <select
              value={chantierId}
              onChange={e => setChantierId(e.target.value)}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text,
                fontFamily: "inherit", fontSize: 14, outline: "none",
              }}
            >
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textMuted, display: "block", marginBottom: 6 }}>
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{
                width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text,
                fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </div>

      {/* Récap plan de travail */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 24, marginBottom: 24,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          textTransform: "uppercase", color: T.textMuted, marginBottom: 16,
        }}>Plan de travail associé</div>

        {!phasage ? (
          <div style={{
            padding: "24px 0", textAlign: "center",
            color: T.textMuted, fontSize: 13, fontStyle: "italic",
          }}>
            Aucun plan de travail trouvé pour ce chantier.
          </div>
        ) : toutesLesTaches.length === 0 ? (
          <div style={{
            padding: "24px 0", textAlign: "center",
            color: T.textMuted, fontSize: 13, fontStyle: "italic",
          }}>
            Le plan de travail est vide (aucune tâche générée).
          </div>
        ) : (
          <>
            {/* Avancement global */}
            <AvancementGlobal taches={toutesLesTaches} T={T} />

            {/* Par phase */}
            {PHASES.map(ph => {
              const taches = (plan[ph.id] || []);
              if (taches.length === 0) return null;
              return (
                <PhaseRecap key={ph.id} phase={ph} taches={taches} T={T} />
              );
            })}
          </>
        )}
      </div>

      {/* Boutons */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          padding: "10px 24px", borderRadius: 10, border: `1px solid ${T.border}`,
          background: "transparent", color: T.text, fontFamily: "inherit",
          fontSize: 14, cursor: "pointer",
        }}>Annuler</button>
        <button onClick={handleSave} disabled={saving || !chantierId} style={{
          padding: "10px 28px", borderRadius: 10, border: "none",
          background: saving ? T.textMuted : T.accent, color: "#fff",
          fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
        }}>
          {saving ? "Enregistrement…" : "Créer la visite →"}
        </button>
      </div>
    </div>
  );
}

// ─── AVANCEMENT GLOBAL ────────────────────────────────────────────────────────
function AvancementGlobal({ taches, T }) {
  const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const avg = totalH > 0
    ? Math.round(taches.reduce((s, t) =>
        s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalH)
    : taches.length > 0
      ? Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length)
      : 0;

  const terminees = taches.filter(t => (parseFloat(t.avancement) || 0) === 100).length;

  return (
    <div style={{
      background: T.card, borderRadius: 10, padding: "14px 18px",
      marginBottom: 20, display: "flex", alignItems: "center", gap: 20,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>
          Avancement global — {terminees}/{taches.length} tâches terminées
        </div>
        <div style={{
          height: 8, borderRadius: 99, background: T.border, overflow: "hidden",
        }}>
          <div style={{
            width: `${avg}%`, height: "100%", borderRadius: 99,
            background: avg === 100 ? "#22c55e" : avg > 50 ? "#3b82f6" : "#f59e0b",
            transition: "width .4s ease",
          }} />
        </div>
      </div>
      <div style={{
        fontSize: 24, fontWeight: 800,
        color: avg === 100 ? "#22c55e" : avg > 50 ? "#3b82f6" : "#f59e0b",
        minWidth: 52, textAlign: "right",
      }}>{avg}%</div>
    </div>
  );
}

// ─── PHASE RECAP ──────────────────────────────────────────────────────────────
function PhaseRecap({ phase, taches, T }) {
  const [open, setOpen] = useState(true);

  const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const phAv = totalH > 0
    ? Math.round(taches.reduce((s, t) =>
        s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalH)
    : taches.length > 0
      ? Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length)
      : 0;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* En-tête phase */}
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        background: "transparent", border: "none", cursor: "pointer",
        padding: "8px 0", marginBottom: open ? 8 : 0,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: phase.color, flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1, textAlign: "left" }}>
          {phase.label}
        </span>
        <span style={{ fontSize: 12, color: T.textMuted }}>{taches.length} tâche{taches.length > 1 ? "s" : ""}</span>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: phAv === 100 ? "#22c55e" : phAv > 50 ? "#3b82f6" : "#f59e0b",
          minWidth: 36, textAlign: "right",
        }}>{phAv}%</span>
        <span style={{ fontSize: 12, color: T.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Tâches */}
      {open && (
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden",
        }}>
          {taches.map((t, i) => {
            const av = parseFloat(t.avancement) || 0;
            const avColor = av === 100 ? "#22c55e" : av > 50 ? "#3b82f6" : av > 0 ? "#f59e0b" : T.textMuted;
            return (
              <div key={t.id || i} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "10px 14px",
                borderBottom: i < taches.length - 1 ? `1px solid ${T.border}` : "none",
                background: i % 2 === 0 ? T.surface : T.card,
              }}>
                {/* Indicateur */}
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: av === 100 ? "#22c55e" : av > 0 ? "#f59e0b" : T.border,
                }} />

                {/* Nom */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, color: T.text, fontWeight: 500,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{t.nom || "Tâche sans nom"}</div>
                  {t.ouvrage_libelle && (
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                      {t.ouvrage_libelle}
                    </div>
                  )}
                </div>

                {/* Barre progression */}
                <div style={{ width: 80, flexShrink: 0 }}>
                  <div style={{
                    height: 5, borderRadius: 99, background: T.border, overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${av}%`, height: "100%", borderRadius: 99,
                      background: avColor,
                    }} />
                  </div>
                </div>

                {/* % */}
                <div style={{
                  fontSize: 13, fontWeight: 700, color: avColor,
                  minWidth: 40, textAlign: "right",
                }}>{av}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DÉTAIL VISITE ────────────────────────────────────────────────────────────
function DetailVisite({ visite, chantiers, phasages, T, saving, onSave, onBack }) {
  const [draft, setDraft] = useState(visite);
  const ch = chantiers.find(c => c.id === visite.chantier_id);
  const phasage = phasages.find(p => p.chantier_id === visite.chantier_id);
  const plan = phasage?.plan_travaux || {};
  const toutesLesTaches = PHASES.flatMap(ph =>
    (plan[ph.id] || []).map(t => ({ ...t, phaseLabel: ph.label, phaseColor: ph.color }))
  );

  const updateNote = (val) => setDraft(d => ({ ...d, note_generale: val }));

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
          padding: "6px 14px", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: 13,
        }}>← Retour</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>
            {ch?.nom || draft.chantier_id}
          </div>
          <div style={{ fontSize: 12, color: T.textMuted }}>
            Visite du {formatDate(draft.date)}
          </div>
        </div>
        <button onClick={() => onSave(draft)} disabled={saving} style={{
          padding: "8px 20px", borderRadius: 10, border: "none",
          background: T.accent, color: "#fff", fontFamily: "inherit",
          fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
        }}>
          {saving ? "Enregistrement…" : "💾 Sauvegarder"}
        </button>
      </div>

      {/* Récap plan */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 24, marginBottom: 20,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          textTransform: "uppercase", color: T.textMuted, marginBottom: 16,
        }}>Plan de travail</div>

        {toutesLesTaches.length === 0 ? (
          <div style={{ color: T.textMuted, fontSize: 13, fontStyle: "italic" }}>
            Aucune tâche dans le plan de travail de ce chantier.
          </div>
        ) : (
          <>
            <AvancementGlobal taches={toutesLesTaches} T={T} />
            {PHASES.map(ph => {
              const taches = (plan[ph.id] || []);
              if (taches.length === 0) return null;
              return <PhaseRecap key={ph.id} phase={ph} taches={taches} T={T} />;
            })}
          </>
        )}
      </div>

      {/* Note générale */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: 24,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          textTransform: "uppercase", color: T.textMuted, marginBottom: 12,
        }}>Note de visite</div>
        <textarea
          value={draft.note_generale || ""}
          onChange={e => updateNote(e.target.value)}
          placeholder="Observations générales, points d'attention, actions à mener…"
          rows={5}
          style={{
            width: "100%", background: T.inputBg, border: `1px solid ${T.border}`,
            borderRadius: 10, padding: "12px 14px", color: T.text,
            fontFamily: "inherit", fontSize: 14, resize: "vertical",
            outline: "none", boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}

// ─── PILL ─────────────────────────────────────────────────────────────────────
function Pill({ val, color, icon, T }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 20,
      background: color + "18", fontSize: 12, fontWeight: 700, color,
    }}>
      <span>{icon}</span><span>{val}</span>
    </div>
  );
}
