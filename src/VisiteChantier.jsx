import { useState, useEffect } from "react";
import { supabase } from "./supabase";

// ─── PHASES (mêmes IDs que Phasage.jsx) ──────────────────────────────────────
const PHASES = [
  { id: "demolition",     label: "Démolition",                        color: "#e05c5c" },
  { id: "plomberie_ro",   label: "Réseaux plomberie (gros œuvre)",    color: "#3b82f6" },
  { id: "menuiserie",     label: "Menuiserie ext. & int.",            color: "#8b5cf6" },
  { id: "feraillage",     label: "Feraillage cloisons & doublages",   color: "#f59e0b" },
  { id: "elec_vmc",       label: "Réseaux élec & VMC",                color: "#eab308" },
  { id: "placo",          label: "Lainage / Placo / Bandes & enduits",color: "#6366f1" },
  { id: "peinture_sols",  label: "Peintures & sols",                  color: "#ec4899" },
  { id: "finition_elec",  label: "Finitions électricité",             color: "#f97316" },
  { id: "finition_plomb", label: "Finitions plomberie",               color: "#06b6d4" },
  { id: "cuisine",        label: "Cuisine",                           color: "#10b981" },
  { id: "finitions_gen",  label: "Finitions générales",               color: "#a78bfa" },
];

const STATUTS = [
  { id: "en_cours", label: "En cours",  color: "#f59e0b" },
  { id: "cloturee", label: "Clôturée",  color: "#22c55e" },
  { id: "annulee",  label: "Annulée",   color: "#ef4444" },
];

const genId  = () => Math.random().toString(36).slice(2);
const today  = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, j] = d.split("-");
  return `${j}/${m}/${y}`;
};

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
async function loadVisites() {
  const { data } = await supabase
    .from("visites_chantier")
    .select("*")
    .order("date", { ascending: false });
  return data || [];
}

async function loadPhasages() {
  const { data } = await supabase
    .from("phasages")
    .select("id, chantier_id, chantier_nom, plan_travaux");
  return data || [];
}

async function upsertVisite(visite) {
  const { error } = await supabase.from("visites_chantier").upsert(visite);
  return !error;
}

async function removeVisite(id) {
  const { error } = await supabase.from("visites_chantier").delete().eq("id", id);
  return !error;
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PageVisiteChantier({ chantiers = [], T }) {
  const [view,     setView]     = useState("liste");
  const [visites,  setVisites]  = useState([]);
  const [phasages, setPhasages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    loadVisites().then(setVisites);
    loadPhasages().then(setPhasages);
  }, []);

  const handleSave = async (visite) => {
    setSaving(true);
    const ok = await upsertVisite(visite);
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

  const handleDelete = async (id) => {
    if (!confirm("Supprimer cette visite ?")) return;
    const ok = await removeVisite(id);
    if (ok) setVisites(prev => prev.filter(v => v.id !== id));
    setView("liste");
  };

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

  if (view === "audit" && selected) return (
    <AuditVisite
      visite={selected}
      chantiers={chantiers}
      phasages={phasages}
      T={T}
      saving={saving}
      onSave={async (v) => { setSelected(v); await handleSave(v); setView("audit"); setSaving(false); }}
      onBack={() => setView("liste")}
      onDelete={() => handleDelete(selected.id)}
    />
  );

  return (
    <ListeVisites
      visites={visites}
      chantiers={chantiers}
      T={T}
      onNew={() => setView("new")}
      onSelect={v => { setSelected(v); setView("audit"); }}
      onDelete={handleDelete}
    />
  );
}

// ─── LISTE ────────────────────────────────────────────────────────────────────
function ListeVisites({ visites, chantiers, T, onNew, onSelect, onDelete }) {
  const ch = (id) => chantiers.find(c => c.id === id);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 860, margin: "0 auto", flex: 1, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>Visites de chantier</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginTop: 3 }}>{visites.length} visite{visites.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={onNew} style={{
          padding: "10px 22px", borderRadius: 10, border: "none", cursor: "pointer",
          background: T.accent, color: "#111", fontFamily: "inherit",
          fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8,
        }}>+ Nouvelle visite</button>
      </div>

      {visites.length === 0 && (
        <div style={{
          background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 14,
          padding: 60, textAlign: "center", color: T.textMuted,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Aucune visite</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Créez votre première visite de chantier</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visites.map(v => {
          const c = ch(v.chantier_id);
          const audit = v.audit || {};
          const toutes = Object.values(audit).flat();
          const nb_ok  = toutes.filter(t => t.statut === "ok").length;
          const nb_res = toutes.filter(t => t.statut === "reserve").length;
          const nb_nok = toutes.filter(t => t.statut === "nok").length;
          const total  = toutes.length;
          const st = STATUTS.find(s => s.id === v.statut);

          return (
            <div key={v.id} onClick={() => onSelect(v)} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16,
              transition: "border-color .15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: (c?.couleur || T.accent) + "22",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, flexShrink: 0,
              }}>🔍</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                  {c?.nom || v.chantier_id}
                </div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                  Visite du {fmtDate(v.date)}
                  {v.note_generale && " · Note rédigée"}
                </div>
                {/* Barre de progression audit */}
                {total > 0 && (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2, overflow: "hidden", display: "flex" }}>
                      {nb_ok  > 0 && <div style={{ width: `${(nb_ok /total)*100}%`,  height: "100%", background: "#22c55e" }} />}
                      {nb_res > 0 && <div style={{ width: `${(nb_res/total)*100}%`, height: "100%", background: "#f59e0b" }} />}
                      {nb_nok > 0 && <div style={{ width: `${(nb_nok/total)*100}%`, height: "100%", background: "#ef4444" }} />}
                    </div>
                    <span style={{ fontSize: 11, color: T.textMuted, whiteSpace: "nowrap" }}>
                      {total} tâche{total > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Compteurs */}
              {total > 0 && (
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {nb_ok  > 0 && <Pill val={nb_ok}  color="#22c55e" label="OK"  />}
                  {nb_res > 0 && <Pill val={nb_res} color="#f59e0b" label="Rés" />}
                  {nb_nok > 0 && <Pill val={nb_nok} color="#ef4444" label="NOK" />}
                </div>
              )}

              <span style={{
                padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: (st?.color || "#888") + "22", color: st?.color || "#888", flexShrink: 0,
              }}>{st?.label || v.statut}</span>

              <button onClick={e => { e.stopPropagation(); onDelete(v.id); }} style={{
                background: "transparent", border: `1px solid rgba(224,92,92,0.3)`,
                borderRadius: 6, padding: "4px 8px", color: "#e05c5c",
                cursor: "pointer", fontSize: 13, flexShrink: 0,
              }}>🗑</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FORMULAIRE CRÉATION ──────────────────────────────────────────────────────
function FormVisite({ chantiers, phasages, T, saving, onSave, onCancel }) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id || "");
  const [date,       setDate]       = useState(today());

  const phasage = phasages.find(p => p.chantier_id === chantierId);
  const plan    = phasage?.plan_travaux || {};
  const taches  = PHASES.flatMap(ph => (plan[ph.id] || []).map(t => ({ ...t, phaseId: ph.id })));

  const handleCreate = () => {
    if (!chantierId) return;
    // Initialiser l'audit avec toutes les tâches du plan (statut vide)
    const audit = {};
    PHASES.forEach(ph => {
      const ts = plan[ph.id] || [];
      if (ts.length > 0) {
        audit[ph.id] = ts.map(t => ({
          tache_id:   t.id,
          nom:        t.nom,
          ouvrage:    t.ouvrage_libelle || "",
          h_vendues:  t.heures_vendues || 0,
          avancement: t.avancement || 0,
          statut:     null,   // null = non évalué
          commentaire: "",
        }));
      }
    });
    onSave({
      id:            genId(),
      chantier_id:   chantierId,
      date,
      statut:        "en_cours",
      audit,
      note_generale: "",
    });
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 720, margin: "0 auto", flex: 1, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <button onClick={onCancel} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
          padding: "6px 14px", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: 13,
        }}>← Retour</button>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Nouvelle visite</div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, marginBottom: 20 }}>
        <Label T={T}>Informations générales</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Chantier *</div>
            <select value={chantierId} onChange={e => setChantierId(e.target.value)} style={selectStyle(T)}>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Date de visite</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...selectStyle(T), colorScheme: "dark" }} />
          </div>
        </div>
      </div>

      {/* Aperçu plan */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, marginBottom: 24 }}>
        <Label T={T}>Plan de travail associé</Label>
        {!phasage ? (
          <div style={{ color: T.textMuted, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
            Aucun plan de travail trouvé pour ce chantier.
          </div>
        ) : taches.length === 0 ? (
          <div style={{ color: T.textMuted, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
            Le plan de travail est vide.
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <AvancementGlobal taches={taches} T={T} />
            {PHASES.map(ph => {
              const ts = plan[ph.id] || [];
              if (!ts.length) return null;
              return <MiniPhase key={ph.id} phase={ph} taches={ts} T={T} />;
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>Annuler</button>
        <button onClick={handleCreate} disabled={saving || !chantierId} style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: saving ? T.textMuted : T.accent, color: "#111", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Création…" : "Créer la visite →"}
        </button>
      </div>
    </div>
  );
}

// ─── AUDIT VISITE (cœur de l'outil) ──────────────────────────────────────────
function AuditVisite({ visite, chantiers, phasages, T, saving, onSave, onBack, onDelete }) {
  const [draft,    setDraft]    = useState(() => JSON.parse(JSON.stringify(visite)));
  const [expanded, setExpanded] = useState({});
  const [dirty,    setDirty]    = useState(false);

  const ch      = chantiers.find(c => c.id === visite.chantier_id);
  const phasage = phasages.find(p => p.chantier_id === visite.chantier_id);
  const plan    = phasage?.plan_travaux || {};

  // Sync : si le plan a des nouvelles tâches depuis la création de la visite,
  // on les ajoute à l'audit automatiquement
  useEffect(() => {
    const updated = { ...draft };
    let changed = false;
    PHASES.forEach(ph => {
      const planTaches = plan[ph.id] || [];
      const auditTaches = draft.audit?.[ph.id] || [];
      const auditIds = new Set(auditTaches.map(t => t.tache_id));
      planTaches.forEach(t => {
        if (!auditIds.has(t.id)) {
          if (!updated.audit[ph.id]) updated.audit[ph.id] = [];
          updated.audit[ph.id].push({
            tache_id: t.id, nom: t.nom,
            ouvrage: t.ouvrage_libelle || "",
            h_vendues: t.heures_vendues || 0,
            avancement: t.avancement || 0,
            statut: null, commentaire: "",
          });
          changed = true;
        }
      });
    });
    if (changed) setDraft(updated);
  }, []);

  const updateTache = (phaseId, idx, updates) => {
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      n.audit[phaseId][idx] = { ...n.audit[phaseId][idx], ...updates };
      return n;
    });
    setDirty(true);
  };

  const setNote = (val) => { setDraft(d => ({ ...d, note_generale: val })); setDirty(true); };
  const setStatutVisite = (val) => { setDraft(d => ({ ...d, statut: val })); setDirty(true); };

  const handleSave = async () => { await onSave(draft); setDirty(false); };

  // KPIs globaux
  const toutes  = Object.values(draft.audit || {}).flat();
  const nb_ok   = toutes.filter(t => t.statut === "ok").length;
  const nb_res  = toutes.filter(t => t.statut === "reserve").length;
  const nb_nok  = toutes.filter(t => t.statut === "nok").length;
  const nb_nd   = toutes.filter(t => !t.statut).length;
  const total   = toutes.length;

  const phasesAvecTaches = PHASES.filter(ph => (draft.audit?.[ph.id] || []).length > 0);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 24 }}>
          <button onClick={onBack} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: 13, flexShrink: 0 }}>← Retour</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{ch?.nom || visite.chantier_id}</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>Visite du {fmtDate(draft.date)}</div>
          </div>
          {/* Statut */}
          <select value={draft.statut} onChange={e => setStatutVisite(e.target.value)} style={{
            padding: "6px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.card, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none",
          }}>
            {STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button onClick={handleSave} disabled={saving} style={{
            padding: "8px 20px", borderRadius: 10, border: "none",
            background: dirty ? T.accent : T.card,
            color: dirty ? "#111" : T.textMuted,
            fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
            border: dirty ? "none" : `1px solid ${T.border}`,
            transition: "all .2s",
          }}>
            {saving ? "Sauvegarde…" : dirty ? "💾 Sauvegarder" : "✓ Sauvegardé"}
          </button>
          <button onClick={onDelete} style={{ background: "transparent", border: `1px solid rgba(224,92,92,0.3)`, borderRadius: 8, padding: "8px 14px", color: "#e05c5c", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>🗑</button>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Conformes",      val: nb_ok,  color: "#22c55e" },
            { label: "Réserves",       val: nb_res, color: "#f59e0b" },
            { label: "Non conformes",  val: nb_nok, color: "#ef4444" },
            { label: "Non évalués",    val: nb_nd,  color: T.textMuted },
          ].map(k => (
            <div key={k.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.val}</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Barre globale */}
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.border, overflow: "hidden", display: "flex" }}>
              {nb_ok  > 0 && <div style={{ width: `${(nb_ok /total)*100}%`, background: "#22c55e" }} />}
              {nb_res > 0 && <div style={{ width: `${(nb_res/total)*100}%`, background: "#f59e0b" }} />}
              {nb_nok > 0 && <div style={{ width: `${(nb_nok/total)*100}%`, background: "#ef4444" }} />}
            </div>
            <span style={{ fontSize: 12, color: T.textMuted, whiteSpace: "nowrap" }}>
              {total - nb_nd}/{total} tâches évaluées
            </span>
          </div>
        )}

        {/* Phases */}
        {total === 0 ? (
          <div style={{ background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 48, textAlign: "center", color: T.textMuted }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Aucune tâche dans le plan de travail</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Créez d'abord un phasage pour ce chantier dans l'onglet Phasage</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {phasesAvecTaches.map(ph => {
              const taches = draft.audit?.[ph.id] || [];
              const ph_ok  = taches.filter(t => t.statut === "ok").length;
              const ph_res = taches.filter(t => t.statut === "reserve").length;
              const ph_nok = taches.filter(t => t.statut === "nok").length;
              const isExp  = expanded[ph.id] !== false; // ouvert par défaut

              return (
                <div key={ph.id} style={{ background: T.surface, border: `1px solid ${isExp ? ph.color + "66" : T.border}`, borderRadius: 12, overflow: "hidden", transition: "border .2s" }}>
                  {/* En-tête phase */}
                  <div
                    onClick={() => setExpanded(prev => ({ ...prev, [ph.id]: !isExp }))}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", cursor: "pointer", borderBottom: isExp ? `1px solid ${T.sectionDivider || T.border}` : "none" }}
                  >
                    <div style={{ width: 4, height: 28, borderRadius: 2, background: ph.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{ph.label}</div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>{taches.length} tâche{taches.length > 1 ? "s" : ""}</div>
                    </div>
                    {/* Mini compteurs */}
                    <div style={{ display: "flex", gap: 5 }}>
                      {ph_ok  > 0 && <Pill val={ph_ok}  color="#22c55e" label="OK"  />}
                      {ph_res > 0 && <Pill val={ph_res} color="#f59e0b" label="Rés" />}
                      {ph_nok > 0 && <Pill val={ph_nok} color="#ef4444" label="NOK" />}
                    </div>
                    <span style={{ fontSize: 12, color: T.textMuted, padding: "0 8px", userSelect: "none" }}>{isExp ? "▲" : "▼"}</span>
                  </div>

                  {isExp && (
                    <div style={{ padding: "8px 0" }}>
                      {taches.map((tache, idx) => (
                        <TacheAudit
                          key={tache.tache_id || idx}
                          tache={tache}
                          phaseColor={ph.color}
                          T={T}
                          onChange={updates => updateTache(ph.id, idx, updates)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Note générale */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginTop: 16 }}>
          <Label T={T}>Note générale de visite</Label>
          <textarea
            value={draft.note_generale || ""}
            onChange={e => setNote(e.target.value)}
            placeholder="Observations générales, points d'attention, prochaines actions…"
            rows={4}
            style={{
              marginTop: 12, width: "100%", background: T.inputBg || T.card,
              border: `1px solid ${T.border}`, borderRadius: 10,
              padding: "12px 14px", color: T.text, fontFamily: "inherit",
              fontSize: 14, resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Récap réserves/NOK en bas */}
        {(nb_res + nb_nok) > 0 && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginTop: 16 }}>
            <Label T={T}>Récapitulatif des points à traiter</Label>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {PHASES.map(ph => {
                const ts = (draft.audit?.[ph.id] || []).filter(t => t.statut === "reserve" || t.statut === "nok");
                if (!ts.length) return null;
                return ts.map((t, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "10px 14px", borderRadius: 10,
                    background: t.statut === "nok" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                    border: `1px solid ${t.statut === "nok" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                      {t.statut === "nok" ? "⛔" : "⚠️"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{t.nom}</div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>{ph.label}</div>
                      {t.commentaire && (
                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, fontStyle: "italic" }}>
                          → {t.commentaire}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                      background: t.statut === "nok" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                      color: t.statut === "nok" ? "#ef4444" : "#f59e0b",
                    }}>
                      {t.statut === "nok" ? "NOK" : "RÉSERVE"}
                    </span>
                  </div>
                ));
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── TÂCHE AUDIT ──────────────────────────────────────────────────────────────
function TacheAudit({ tache, phaseColor, T, onChange }) {
  const [showComment, setShowComment] = useState(!!tache.commentaire);

  const setStatut = (s) => {
    onChange({ statut: s === tache.statut ? null : s });
    if ((s === "reserve" || s === "nok") && !showComment) setShowComment(true);
  };

  const statutColor = tache.statut === "ok" ? "#22c55e" : tache.statut === "reserve" ? "#f59e0b" : tache.statut === "nok" ? "#ef4444" : T.border;

  return (
    <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 12, alignItems: "start" }}>
        {/* Indicateur statut */}
        <div style={{
          width: 16, height: 16, borderRadius: "50%", marginTop: 3, flexShrink: 0,
          background: tache.statut ? statutColor + "25" : "transparent",
          border: `2px solid ${statutColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {tache.statut === "ok" && <svg width="8" height="8" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#22c55e" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
          {tache.statut === "reserve" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
          {tache.statut === "nok" && <svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="2" x2="2" y2="8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/></svg>}
        </div>

        {/* Infos tâche */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{tache.nom}</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1, display: "flex", gap: 8 }}>
            {tache.ouvrage && <span>↳ {tache.ouvrage}</span>}
            {tache.h_vendues > 0 && <span style={{ color: T.accent }}>{tache.h_vendues}h vendues</span>}
            {tache.avancement > 0 && (
              <span style={{ color: tache.avancement === 100 ? "#22c55e" : T.textMuted }}>
                {tache.avancement}% réalisé
              </span>
            )}
          </div>

          {/* Commentaire */}
          {showComment && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
              <div style={{ width: 2, borderRadius: 1, background: statutColor, alignSelf: "stretch", flexShrink: 0, marginTop: 2 }} />
              <textarea
                value={tache.commentaire || ""}
                onChange={e => onChange({ commentaire: e.target.value })}
                placeholder="Commentaire / observation…"
                rows={2}
                style={{
                  flex: 1, background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 8, padding: "7px 10px", color: T.text,
                  fontFamily: "inherit", fontSize: 12, resize: "vertical",
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* Boutons statut */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {[
              { id: "ok",      label: "OK",   activeColor: "#22c55e" },
              { id: "reserve", label: "Rés.", activeColor: "#f59e0b" },
              { id: "nok",     label: "NOK",  activeColor: "#ef4444" },
            ].map(btn => {
              const isActive = tache.statut === btn.id;
              return (
                <button key={btn.id} onClick={() => setStatut(btn.id)} style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                  background: isActive ? btn.activeColor + "22" : "transparent",
                  border: `1px solid ${isActive ? btn.activeColor : T.border}`,
                  color: isActive ? btn.activeColor : T.textMuted,
                  transition: "all .15s",
                }}>
                  {btn.label}
                </button>
              );
            })}
          </div>
          {/* Bouton commentaire */}
          <button onClick={() => setShowComment(s => !s)} style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: 11, color: showComment ? T.accent : T.textMuted,
            fontFamily: "inherit", padding: "2px 4px",
          }}>
            {showComment ? "✕ cacher note" : "+ ajouter note"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── HELPERS UI ───────────────────────────────────────────────────────────────
function Label({ T, children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: T.textMuted }}>
      {children}
    </div>
  );
}

function Pill({ val, color, label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 3,
      padding: "3px 8px", borderRadius: 20,
      background: color + "18", fontSize: 11, fontWeight: 700, color,
    }}>
      <span>{val}</span>
      <span style={{ opacity: 0.7, fontSize: 10 }}>{label}</span>
    </div>
  );
}

function AvancementGlobal({ taches, T }) {
  const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const avg = totalH > 0
    ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalH)
    : taches.length > 0
      ? Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length)
      : 0;

  const color = avg === 100 ? "#22c55e" : avg > 50 ? "#3b82f6" : "#f59e0b";

  return (
    <div style={{ background: T.card, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 5 }}>
          Avancement global — {taches.filter(t => (parseFloat(t.avancement)||0) === 100).length}/{taches.length} tâches terminées
        </div>
        <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}>
          <div style={{ width: `${avg}%`, height: "100%", borderRadius: 3, background: color }} />
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, minWidth: 48, textAlign: "right" }}>{avg}%</div>
    </div>
  );
}

function MiniPhase({ phase, taches, T }) {
  const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const av = totalH > 0
    ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement)||0) * (parseFloat(t.heures_vendues)||0)), 0) / totalH)
    : taches.length > 0 ? Math.round(taches.reduce((s,t) => s + (parseFloat(t.avancement)||0), 0) / taches.length) : 0;
  const avColor = av === 100 ? "#22c55e" : av > 50 ? "#3b82f6" : "#f59e0b";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ width: 3, height: 20, borderRadius: 2, background: phase.color, flexShrink: 0 }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1 }}>{phase.label}</div>
      <span style={{ fontSize: 11, color: T.textMuted }}>{taches.length} tâche{taches.length>1?"s":""}</span>
      <div style={{ width: 60, height: 4, borderRadius: 2, background: T.border, overflow: "hidden" }}>
        <div style={{ width: `${av}%`, height: "100%", background: avColor }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: avColor, minWidth: 32, textAlign: "right" }}>{av}%</span>
    </div>
  );
}

function selectStyle(T) {
  return {
    width: "100%", background: T.inputBg || T.card, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "9px 12px", color: T.text,
    fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box",
  };
}
