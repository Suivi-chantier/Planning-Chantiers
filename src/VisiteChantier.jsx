import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, loadPhases } from "./constants";
import { Icon } from "./ui";
import {
  ClipboardCheck, Plus, Trash2, ChevronLeft as ChevronLeftIcon,
  ChevronRight, ChevronUp, ChevronDown, Check, X, AlertTriangle,
  Building2, Calendar, MessageSquare, Save, History, ArrowRight,
  Eye, FileWarning, Camera, FileDown, ListChecks, Settings,
} from "lucide-react";

// ─── PHASES (chargées depuis Supabase, fallback sur défaut) ─────────────────
// Normalise `couleur` → `color` pour cohérence avec le code existant ici.
const normalizePhases = (list) => list.map(p => ({ ...p, color: p.couleur || p.color }));
let PHASES = normalizePhases(PHASES_DEFAUT);
loadPhases().then(p => { PHASES = normalizePhases(p); });

const STATUTS = [
  { id: "en_cours", label: "En cours",  color: "#f59e0b" },
  { id: "cloturee", label: "Clôturée",  color: "#22c55e" },
  { id: "annulee",  label: "Annulée",   color: "#ef4444" },
];

// ─── CHECKLIST PAR DÉFAUT (points de vigilance récurrents) ──────────────────
const CHECKLIST_DEFAUT = [
  { id: "secu_epi",        label: "Port des EPI (casque, chaussures, gants)" },
  { id: "secu_balisage",   label: "Balisage et signalisation chantier" },
  { id: "proprete_chantier", label: "Propreté générale du chantier" },
  { id: "proprete_dechets", label: "Évacuation des déchets et gravats" },
  { id: "stockage_mat",    label: "Stockage des matériaux organisé" },
  { id: "outillage",       label: "Outillage rangé et en bon état" },
  { id: "elec_protection", label: "Protections électriques en place" },
  { id: "voisinage",       label: "Pas de nuisances pour le voisinage" },
];

const genId  = () => Math.random().toString(36).slice(2);
const today  = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, j] = d.split("-");
  return `${j}/${m}/${y}`;
};

// ─── UPLOAD PHOTO (bucket "photos") ──────────────────────────────────────────
async function uploadVisitePhoto(file, pathPrefix) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${pathPrefix}/${safe}`;
  const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
  if (error) { console.error("upload photo:", error); return null; }
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data?.publicUrl || null;
}

// ─── COMPOSANT PHOTOS PICKER (compact, intégré dans une tâche d'audit) ───────
function PhotosPicker({ photos, onChange, pathPrefix, color = "#5b9cf6", onLightbox }) {
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef(null);

  const onFiles = async (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setUploading(arr.length);
    const urls = [];
    for (const f of arr) {
      const url = await uploadVisitePhoto(f, pathPrefix);
      if (url) urls.push(url);
      setUploading(n => n - 1);
    }
    if (urls.length > 0) onChange([...(photos || []), ...urls]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (i) => onChange((photos || []).filter((_, idx) => idx !== i));

  return (
    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {(photos || []).map((url, i) => (
        <div key={i} style={{
          position: "relative", width: 56, height: 56, borderRadius: RADIUS.md, overflow: "hidden",
          border: `1.5px solid ${color}44`,
        }}>
          <img src={url} alt="" loading="lazy"
            onClick={() => onLightbox?.({ urls: photos, idx: i })}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "pointer" }}/>
          <button onClick={(e) => { e.stopPropagation(); remove(i); }} title="Retirer"
            style={{
              position: "absolute", top: 2, right: 2,
              background: "rgba(0,0,0,0.6)", border: "none", color: "#fff",
              borderRadius: "50%", width: 18, height: 18, cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            <Icon as={X} size={10} strokeWidth={3}/>
          </button>
        </div>
      ))}
      <label style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        width: 56, height: 56, borderRadius: RADIUS.md, cursor: "pointer",
        border: `1.5px dashed ${color}66`, background: `${color}0A`, color,
        fontSize: FONT.xs.size, fontWeight: 700,
      }}>
        <Icon as={Camera} size={16} strokeWidth={1.8}/>
        <span style={{ fontSize: 9, letterSpacing: .3 }}>Photo</span>
        <input ref={inputRef} type="file" accept="image/*" multiple capture="environment"
          onChange={e => onFiles(e.target.files)} style={{ display: "none" }}/>
      </label>
      {uploading > 0 && (
        <span style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", fontWeight: 600 }}>
          Upload… {uploading}
        </span>
      )}
    </div>
  );
}

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
  if (error) {
    console.error("upsertVisite error:", error);
    return { ok: false, error };
  }
  return { ok: true };
}

async function removeVisite(id) {
  const { error } = await supabase.from("visites_chantier").delete().eq("id", id);
  return !error;
}

async function loadChecklistTemplate() {
  const { data } = await supabase.from("planning_config").select("*").eq("key", "visite_checklist_template").maybeSingle();
  const items = data?.value?.items;
  return Array.isArray(items) && items.length > 0 ? items : CHECKLIST_DEFAUT;
}

async function saveChecklistTemplate(items) {
  await supabase.from("planning_config").upsert({ key: "visite_checklist_template", value: { items } });
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PageVisiteChantier({ chantiers = [], T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [view,     setView]     = useState("liste");
  const [visites,  setVisites]  = useState([]);
  const [phasages, setPhasages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [checklistTemplate, setChecklistTemplate] = useState(CHECKLIST_DEFAUT);
  const [showTemplate, setShowTemplate] = useState(false);

  useEffect(() => {
    loadVisites().then(setVisites);
    loadPhasages().then(setPhasages);
    loadChecklistTemplate().then(setChecklistTemplate);
  }, []);

  const handleSaveTemplate = async (items) => {
    setChecklistTemplate(items);
    await saveChecklistTemplate(items);
    setShowTemplate(false);
  };

  const handleSave = async (visite) => {
    setSaving(true);
    const res = await upsertVisite(visite);
    if (res.ok) {
      setVisites(prev => {
        const idx = prev.findIndex(v => v.id === visite.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = visite; return n; }
        return [visite, ...prev];
      });
    } else {
      const msg = res.error?.message || "Erreur inconnue";
      const hint = msg.includes("column") || msg.includes("schema")
        ? `\n\nIl manque probablement une colonne dans Supabase :\nALTER TABLE visites_chantier ADD COLUMN IF NOT EXISTS phases_auditees JSONB DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;`
        : "";
      alert(`Erreur lors de la sauvegarde de la visite :\n${msg}${hint}`);
    }
    setSaving(false);
    if (res.ok) setView("liste");
  };

  const askDelete = (v) => setToDelete(v);
  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const ok = await removeVisite(toDelete.id);
    if (ok) setVisites(prev => prev.filter(v => v.id !== toDelete.id));
    setDeleting(false);
    setToDelete(null);
    if (selected?.id === toDelete.id) { setSelected(null); setView("liste"); }
  };

  const deleteModal = toDelete && (
    <div onClick={() => !deleting && setToDelete(null)} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
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
            <Icon as={AlertTriangle} size={20}/>
          </div>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Supprimer cette visite&nbsp;?</div>
        </div>
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 20 }}>
          La visite du <strong style={{ color: T.text }}>{fmtDate(toDelete.date)}</strong> sera définitivement supprimée avec tout son audit et ses commentaires.
          <br/><span style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>Cette action est irréversible.</span>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => setToDelete(null)} disabled={deleting}
            style={{ background: "transparent", border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer", opacity: deleting ? .5 : 1 }}>
            Annuler
          </button>
          <button onClick={confirmDelete} disabled={deleting}
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
  );

  const templateModal = showTemplate && (
    <ChecklistTemplateModal
      items={checklistTemplate}
      T={T} acc={acc}
      onSave={handleSaveTemplate}
      onClose={() => setShowTemplate(false)}
    />
  );

  if (view === "new") return (
    <>
      {deleteModal}
      {templateModal}
      <FormVisite
        chantiers={chantiers}
        phasages={phasages}
        checklistTemplate={checklistTemplate}
        T={T} acc={acc}
        saving={saving}
        onSave={handleSave}
        onCancel={() => setView("liste")}
      />
    </>
  );

  if (view === "audit" && selected) return (
    <>
      {deleteModal}
      {templateModal}
      <AuditVisite
        visite={selected}
        chantiers={chantiers}
        phasages={phasages}
        toutesVisites={visites}
        T={T} acc={acc}
        saving={saving}
        onSave={async (v) => { setSelected(v); await handleSave(v); setView("audit"); setSaving(false); }}
        onBack={() => setView("liste")}
        onDelete={() => askDelete(selected)}
      />
    </>
  );

  return (
    <>
      {deleteModal}
      {templateModal}
      <ListeVisites
        visites={visites}
        chantiers={chantiers}
        T={T} acc={acc}
        onNew={() => setView("new")}
        onSelect={v => { setSelected(v); setView("audit"); }}
        onDelete={askDelete}
        onOpenTemplate={() => setShowTemplate(true)}
      />
    </>
  );
}

// ─── LISTE ────────────────────────────────────────────────────────────────────
function ListeVisites({ visites, chantiers, T, acc, onNew, onSelect, onDelete, onOpenTemplate }) {
  const ch = (id) => chantiers.find(c => c.id === id);

  // ── Stats globales
  const toutesTaches = visites.flatMap(v => Object.values(v.audit || {}).flat());
  const stats = {
    total: visites.length,
    enCours: visites.filter(v => v.statut === "en_cours").length,
    nbReserves: toutesTaches.filter(t => t.statut === "reserve").length,
    nbNOK: toutesTaches.filter(t => t.statut === "nok").length,
  };

  return (
    <div className="page-padding visite-liste" style={{ padding: "24px 28px", background: T.bg, flex: 1, overflowY: "auto" }}>
      <style>{`
        @media(max-width:767px) {
          .visite-liste .visite-row{flex-wrap:wrap!important;padding:12px!important;gap:10px!important}
          .visite-liste .visite-row > div:nth-child(2){flex:1 1 100%!important;order:2}
          .visite-liste .visite-row > div:first-child{order:1}
          .visite-liste .visite-row > div:nth-child(3){order:3}
          .visite-liste .visite-row > span,.visite-liste .visite-row > button{order:4}
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20, flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: RADIUS.md,
              background: acc.bg10, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon as={ClipboardCheck} size={20} strokeWidth={2}/>
            </div>
            <div>
              <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 2 }}>
                Visites de chantier
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                Audits terrain pour s'assurer que tout est conforme
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={onOpenTemplate} title="Gérer les points de vigilance par défaut" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={ListChecks} size={13}/>
              Checklist
            </button>
            <button onClick={onNew} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: RADIUS.md, border: "none",
              background: acc.accent, color: acc.onAccent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={Plus} size={14}/>
              Nouvelle visite
            </button>
          </div>
        </div>

        {/* ── Stats ── */}
        {visites.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 10, marginBottom: 18,
          }}>
            {[
              { label: "Visites",      val: stats.total,      icon: ClipboardCheck, color: acc.accent },
              { label: "En cours",     val: stats.enCours,    icon: History,        color: "#5b9cf6" },
              { label: "Réserves",     val: stats.nbReserves, icon: AlertTriangle,  color: stats.nbReserves > 0 ? "#f59e0b" : T.textMuted },
              { label: "Non conformes",val: stats.nbNOK,      icon: FileWarning,    color: stats.nbNOK > 0 ? "#e15a5a" : T.textMuted },
            ].map(s => (
              <div key={s.label} style={{
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
                  <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: T.text, letterSpacing: -.5, lineHeight: 1 }}>{s.val}</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {visites.length === 0 && (
          <div style={{
            background: T.card, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl,
            padding: "48px 32px", textAlign: "center", maxWidth: 540, margin: "0 auto",
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: RADIUS.lg,
              background: acc.bg10, color: acc.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
            }}>
              <Icon as={ClipboardCheck} size={28} strokeWidth={1.5}/>
            </div>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 700, color: T.text, marginBottom: 8 }}>Aucune visite pour l'instant</div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.7, marginBottom: 22 }}>
              Crée une visite pour auditer un chantier en cours : pointe les tâches conformes, les réserves et les non-conformités.
            </div>
            <button onClick={onNew} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: acc.accent, color: acc.onAccent, border: "none",
              borderRadius: RADIUS.md, padding: "11px 22px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={Plus} size={14}/>
              Créer ma première visite
            </button>
          </div>
        )}

        {/* ── Liste ── */}
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
            const accentColor = c?.couleur || acc.accent;

            return (
              <div key={v.id} className="visite-row" onClick={() => onSelect(v)} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderLeft: `4px solid ${accentColor}`,
                borderRadius: RADIUS.xl, padding: "14px 18px",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                transition: "all .15s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.borderLeftColor = accentColor; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.borderLeftColor = accentColor; e.currentTarget.style.boxShadow = "none"; }}>

                <div style={{
                  width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
                  background: accentColor + "22", border: `1.5px solid ${accentColor}44`,
                  color: accentColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon as={Building2} size={16} strokeWidth={2}/>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>
                    {c?.nom || v.chantier_id}
                  </div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon as={Calendar} size={11}/>
                      {fmtDate(v.date)}
                    </span>
                    {v.note_generale && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon as={MessageSquare} size={11}/>
                        Note
                      </span>
                    )}
                    {Array.isArray(v.phases_auditees) && v.phases_auditees.length > 0 && v.phases_auditees.length < PHASES.length && (
                      <span style={{ color: acc.accent, fontWeight: 600 }}>
                        · {v.phases_auditees.length} phase{v.phases_auditees.length > 1 ? "s" : ""} auditée{v.phases_auditees.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {total > 0 && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: T.border, borderRadius: 3, overflow: "hidden", display: "flex" }}>
                        {nb_ok  > 0 && <div style={{ width: `${(nb_ok /total)*100}%`,  height: "100%", background: "#22c55e" }} />}
                        {nb_res > 0 && <div style={{ width: `${(nb_res/total)*100}%`, height: "100%", background: "#f59e0b" }} />}
                        {nb_nok > 0 && <div style={{ width: `${(nb_nok/total)*100}%`, height: "100%", background: "#ef4444" }} />}
                      </div>
                      <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, whiteSpace: "nowrap", fontWeight: 600 }}>
                        {total - toutes.filter(t => !t.statut).length}/{total} évaluées
                      </span>
                    </div>
                  )}
                </div>

                {total > 0 && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {nb_ok  > 0 && <Pill val={nb_ok}  color="#22c55e" label="OK"  />}
                    {nb_res > 0 && <Pill val={nb_res} color="#f59e0b" label="Rés" />}
                    {nb_nok > 0 && <Pill val={nb_nok} color="#ef4444" label="NOK" />}
                  </div>
                )}

                <span style={{
                  padding: "3px 10px", borderRadius: RADIUS.pill,
                  fontSize: FONT.xs.size, fontWeight: 700,
                  background: (st?.color || "#888") + "22", color: st?.color || "#888",
                  border: `1px solid ${(st?.color || "#888")}33`, flexShrink: 0,
                }}>{st?.label || v.statut}</span>

                <button onClick={e => { e.stopPropagation(); onDelete(v); }} title="Supprimer"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: `1px solid rgba(224,92,92,0.3)`,
                    borderRadius: RADIUS.md, padding: "6px 9px", color: "#e15a5a",
                    cursor: "pointer", flexShrink: 0,
                  }}>
                  <Icon as={Trash2} size={13}/>
                </button>
                <Icon as={ChevronRight} size={16} color={T.textMuted}/>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── FORMULAIRE CRÉATION ──────────────────────────────────────────────────────
function FormVisite({ chantiers, phasages, checklistTemplate = [], T, acc, saving, onSave, onCancel }) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id || "");
  const [date,       setDate]       = useState(today());
  const [phasesSel,  setPhasesSel]  = useState([]); // IDs des phases à auditer

  const phasage = phasages.find(p => p.chantier_id === chantierId);
  const plan    = phasage?.plan_travaux || {};
  const phasesAvecTaches = PHASES.filter(ph => (plan[ph.id] || []).length > 0);

  // ── Quand on change de chantier : pré-sélectionner toutes les phases qui ont
  //    des tâches non terminées (avancement < 100%). Les phases entièrement
  //    terminées sont par défaut décochées car peu d'intérêt à les ré-auditer.
  useEffect(() => {
    const presel = phasesAvecTaches.filter(ph => {
      const ts = plan[ph.id] || [];
      return ts.some(t => (parseFloat(t.avancement) || 0) < 100);
    }).map(ph => ph.id);
    setPhasesSel(presel.length > 0 ? presel : phasesAvecTaches.map(ph => ph.id));
  }, [chantierId]);

  const togglePhase = (id) => {
    setPhasesSel(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };
  const toutCocher = () => setPhasesSel(phasesAvecTaches.map(ph => ph.id));
  const toutDecocher = () => setPhasesSel([]);

  const handleCreate = () => {
    if (!chantierId) return;
    const audit = {};
    PHASES.forEach(ph => {
      const ts = plan[ph.id] || [];
      if (ts.length > 0 && phasesSel.includes(ph.id)) {
        audit[ph.id] = ts.map(t => ({
          tache_id:   t.id,
          nom:        t.nom,
          ouvrage:    t.ouvrage_libelle || "",
          h_vendues:  t.heures_vendues || 0,
          avancement: t.avancement || 0,
          statut:     null,
          commentaire: "",
        }));
      }
    });
    onSave({
      id:              genId(),
      chantier_id:     chantierId,
      date,
      statut:          "en_cours",
      audit,
      note_generale:   "",
      phases_auditees: phasesSel,
      checklist: checklistTemplate.map(item => ({
        id: item.id,
        label: item.label,
        statut: null,
        commentaire: "",
        photos: [],
      })),
    });
  };

  const ch = chantiers.find(c => c.id === chantierId);
  const accentChantier = ch?.couleur || acc.accent;

  return (
    <div className="page-padding" style={{ padding: "24px 28px", background: T.bg, flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* ── Bouton retour ── */}
        <button onClick={onCancel} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: RADIUS.md,
          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", marginBottom: 14,
        }}>
          <Icon as={ChevronLeftIcon} size={13}/>
          Retour
        </button>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={ClipboardCheck} size={20} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ fontSize: FONT.xl.size + 2, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Nouvelle visite</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Choisis un chantier, une date, puis les phases à auditer</div>
          </div>
        </div>

        {/* ── Infos générales ── */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 20, marginBottom: 14,
        }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 12 }}>
            Informations générales
          </div>
          <div className="responsive-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 6 }}>
                <Icon as={Building2} size={11}/>
                Chantier *
              </div>
              <select value={chantierId} onChange={e => setChantierId(e.target.value)} style={selectStyle(T)}>
                {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 6 }}>
                <Icon as={Calendar} size={11}/>
                Date de visite
              </div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...selectStyle(T), colorScheme: "dark" }} />
            </div>
          </div>
        </div>

        {/* ── Sélecteur de phases à auditer ── */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 20, marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 4 }}>
                Portée de l'audit
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>
                Coche les phases que tu vas vérifier aujourd'hui. Tu pourras élargir ensuite.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={toutCocher} style={{
                padding: "5px 10px", borderRadius: RADIUS.sm,
                border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
              }}>Tout cocher</button>
              <button onClick={toutDecocher} style={{
                padding: "5px 10px", borderRadius: RADIUS.sm,
                border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
              }}>Tout décocher</button>
            </div>
          </div>

          {!phasage ? (
            <div style={{
              padding: "14px 16px", background: "rgba(245,166,35,0.08)",
              border: "1px solid rgba(245,166,35,0.25)", borderRadius: RADIUS.md,
              display: "flex", alignItems: "center", gap: 8,
              fontSize: FONT.sm.size, color: "#f5a623",
            }}>
              <Icon as={AlertTriangle} size={14}/>
              Aucun phasage trouvé pour ce chantier. Créez-en un dans l'onglet Phasage.
            </div>
          ) : phasesAvecTaches.length === 0 ? (
            <div style={{
              padding: "14px 16px", background: T.card,
              border: `1px dashed ${T.border}`, borderRadius: RADIUS.md,
              fontSize: FONT.sm.size, color: T.textMuted,
            }}>
              Le plan de travail est vide. Ajoute des tâches dans le phasage avant de créer une visite.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {phasesAvecTaches.map(ph => {
                const ts = plan[ph.id] || [];
                const totalH = ts.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
                const av = totalH > 0
                  ? Math.round(ts.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalH)
                  : ts.length > 0 ? Math.round(ts.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / ts.length) : 0;
                const isCheck = phasesSel.includes(ph.id);
                return (
                  <div key={ph.id} onClick={() => togglePhase(ph.id)} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: RADIUS.md, cursor: "pointer",
                    background: isCheck ? ph.color + "12" : T.card,
                    border: `1px solid ${isCheck ? ph.color + "66" : T.border}`,
                    transition: "all .15s",
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: RADIUS.sm, flexShrink: 0,
                      background: isCheck ? ph.color : "transparent",
                      border: `2px solid ${isCheck ? ph.color : T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff",
                    }}>
                      {isCheck && <Icon as={Check} size={11} strokeWidth={3}/>}
                    </div>
                    <div style={{ width: 3, height: 22, borderRadius: 2, background: ph.color, flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{ph.label}</div>
                      <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>
                        {ts.length} tâche{ts.length > 1 ? "s" : ""}
                        {av === 100 && <span style={{ color: "#22c55e", fontWeight: 700 }}> · Terminée</span>}
                        {av > 0 && av < 100 && <span> · {av}% avancé</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "10px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub,
            fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={handleCreate} disabled={saving || !chantierId || phasesSel.length === 0} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "10px 22px", borderRadius: RADIUS.md, border: "none",
            background: (saving || phasesSel.length === 0) ? T.border : acc.accent,
            color: acc.onAccent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            cursor: (saving || phasesSel.length === 0) ? "not-allowed" : "pointer",
            opacity: (saving || phasesSel.length === 0) ? .6 : 1,
          }}>
            {saving ? "Création…" : (
              <>
                Créer la visite
                <Icon as={ArrowRight} size={14}/>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AUDIT VISITE (cœur de l'outil) ──────────────────────────────────────────
function AuditVisite({ visite, chantiers, phasages, toutesVisites = [], T, acc, saving, onSave, onBack, onDelete }) {
  const [draft,    setDraft]    = useState(() => JSON.parse(JSON.stringify(visite)));
  const [expanded, setExpanded] = useState({});
  const [dirty,    setDirty]    = useState(false);
  const [showAll,  setShowAll]  = useState(false); // élargir au-delà de phases_auditees
  const [lightbox, setLightbox] = useState(null);  // { urls:[], idx:0 }
  const [exporting,setExporting]= useState(false);

  // Préfixe de stockage pour les photos de cette visite
  const photoPathPrefix = `visites/${visite.chantier_id}/${visite.id}`;

  const ch      = chantiers.find(c => c.id === visite.chantier_id);
  const phasage = phasages.find(p => p.chantier_id === visite.chantier_id);
  const plan    = phasage?.plan_travaux || {};
  const accentChantier = ch?.couleur || acc.accent;

  // ── Phases prévues à auditer (portée), fallback : toutes celles avec tâches
  const phasesAuditees = Array.isArray(visite.phases_auditees) && visite.phases_auditees.length > 0
    ? visite.phases_auditees
    : PHASES.filter(ph => (plan[ph.id] || []).length > 0).map(ph => ph.id);

  // ── Visites précédentes du même chantier (date < visite.date), tri DESC
  const visitesPrecedentes = (toutesVisites || [])
    .filter(v => v.chantier_id === visite.chantier_id && v.id !== visite.id && (v.date || "") < (visite.date || ""))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // ── Réserves héritées : prendre la dernière visite et lister les tâches
  //    encore en réserve/NOK qui sont aussi dans la portée actuelle
  const derniereVisite = visitesPrecedentes[0];
  const reservesHeritees = (() => {
    if (!derniereVisite) return [];
    const list = [];
    PHASES.forEach(ph => {
      const phaseInScope = phasesAuditees.includes(ph.id) || showAll;
      if (!phaseInScope) return;
      const tachesPrec = derniereVisite.audit?.[ph.id] || [];
      tachesPrec.forEach(t => {
        if (t.statut === "reserve" || t.statut === "nok") {
          // Statut actuel de la même tâche dans la visite en cours
          const tCourante = (draft.audit?.[ph.id] || []).find(x => x.tache_id === t.tache_id);
          list.push({
            phase_id: ph.id,
            phase_label: ph.label,
            phase_color: ph.color,
            tache_id: t.tache_id,
            nom_origine: t.nom,
            commentaire_origine: t.commentaire || "",
            statut_origine: t.statut,
            tache_courante: tCourante || null,
            statut_courant: tCourante?.statut || null,
          });
        }
      });
    });
    return list;
  })();

  // Sync : si le plan a des nouvelles tâches depuis la création de la visite,
  // on les ajoute à l'audit, mais uniquement pour les phases auditées (ou
  // toutes si showAll est actif).
  useEffect(() => {
    const updated = { ...draft, audit: { ...(draft.audit || {}) } };
    let changed = false;
    PHASES.forEach(ph => {
      const inScope = phasesAuditees.includes(ph.id) || showAll;
      if (!inScope) return;
      const planTaches = plan[ph.id] || [];
      const auditTaches = updated.audit?.[ph.id] || [];
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
  }, [showAll]);

  // ── Marqueur visuel : tâches héritées d'une réserve/NOK
  const idsHeritees = new Set(reservesHeritees.map(r => `${r.phase_id}::${r.tache_id}`));

  const updateTache = (phaseId, idx, updates) => {
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      n.audit[phaseId][idx] = { ...n.audit[phaseId][idx], ...updates };
      return n;
    });
    setDirty(true);
  };

  const updateChecklistItem = (idx, updates) => {
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      if (!Array.isArray(n.checklist)) n.checklist = [];
      n.checklist[idx] = { ...n.checklist[idx], ...updates };
      return n;
    });
    setDirty(true);
  };

  const setNote = (val) => { setDraft(d => ({ ...d, note_generale: val })); setDirty(true); };
  const setStatutVisite = (val) => { setDraft(d => ({ ...d, statut: val })); setDirty(true); };

  const handleSave = async () => { await onSave(draft); setDirty(false); };

  const handleExport = async () => {
    if (dirty || exporting) return;
    setExporting(true);
    try {
      const payload = {
        visite: draft, // draft.checklist transporte les items
        chantier: ch ? { id: ch.id, nom: ch.nom, couleur: ch.couleur } : null,
        phases: PHASES.map(p => ({ id: p.id, label: p.label, color: p.color })),
        reserves_heritees: reservesHeritees,
        derniere_visite_date: derniereVisite?.date || null,
      };
      const res = await fetch("/api/generate-visite-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (ch?.nom || "visite").replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `Visite-${safeName}-${draft.date}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export docx:", e);
      alert("Erreur lors de la génération du document : " + e.message);
    }
    setExporting(false);
  };

  // KPIs globaux : on inclut les items de checklist comme tâches d'audit
  const checklist = Array.isArray(draft.checklist) ? draft.checklist : [];
  const toutes  = [...Object.values(draft.audit || {}).flat(), ...checklist];
  const nb_ok   = toutes.filter(t => t.statut === "ok").length;
  const nb_res  = toutes.filter(t => t.statut === "reserve").length;
  const nb_nok  = toutes.filter(t => t.statut === "nok").length;
  const nb_nd   = toutes.filter(t => !t.statut).length;
  const total   = toutes.length;

  // ── Phases affichées : selon portée (sauf si élargi)
  const phasesAffichees = PHASES.filter(ph => {
    const inScope = phasesAuditees.includes(ph.id) || showAll;
    return inScope && (draft.audit?.[ph.id] || []).length > 0;
  });

  // ── Phases hors portée (avec tâches dans le plan mais non auditées)
  const phasesHorsPortee = PHASES.filter(ph => {
    if (phasesAuditees.includes(ph.id)) return false;
    return (plan[ph.id] || []).length > 0;
  });

  return (
    <div className="page-padding visite-audit" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <style>{`
        @media(max-width:767px) {
          .visite-audit .audit-header{flex-wrap:wrap!important}
          .visite-audit .audit-header > div:nth-child(2){flex:1 1 100%!important;order:0}
          .visite-audit .audit-header select{flex:1}
          .visite-audit .audit-kpis{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
          .visite-audit .audit-tache-row{flex-wrap:wrap!important}
          .visite-audit .audit-tache-row > div:last-child{flex:1 1 100%!important;justify-content:flex-start!important}
        }
      `}</style>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Bouton retour */}
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: RADIUS.md,
          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", marginBottom: 14,
        }}>
          <Icon as={ChevronLeftIcon} size={13}/>
          Retour aux visites
        </button>

        {/* Header */}
        <div className="audit-header" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{
            width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0,
            background: accentChantier + "22", border: `1.5px solid ${accentChantier}55`,
            color: accentChantier,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={Building2} size={20} strokeWidth={2}/>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>{ch?.nom || visite.chantier_id}</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={Calendar} size={11}/>
                Visite du {fmtDate(draft.date)}
              </span>
              {visitesPrecedentes.length > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon as={History} size={11}/>
                  {visitesPrecedentes.length} visite{visitesPrecedentes.length > 1 ? "s" : ""} précédente{visitesPrecedentes.length > 1 ? "s" : ""}
                </span>
              )}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: acc.accent, fontWeight: 600 }}>
                <Icon as={Eye} size={11}/>
                {phasesAuditees.length} phase{phasesAuditees.length > 1 ? "s" : ""} dans la portée
              </span>
            </div>
          </div>
          <select value={draft.statut} onChange={e => setStatutVisite(e.target.value)} style={{
            padding: "8px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
            background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer",
          }}>
            {STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button onClick={handleSave} disabled={saving} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: RADIUS.md,
            background: dirty ? acc.accent : T.card,
            color: dirty ? acc.onAccent : T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            border: dirty ? "none" : `1px solid ${T.border}`,
            transition: "all .2s",
          }}>
            <Icon as={dirty ? Save : Check} size={13}/>
            {saving ? "Sauvegarde…" : dirty ? "Sauvegarder" : "Sauvegardé"}
          </button>
          <button onClick={handleExport} disabled={exporting || dirty} title={dirty ? "Sauvegarde d'abord la visite" : "Exporter en .docx"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
              cursor: exporting || dirty ? "not-allowed" : "pointer",
              opacity: dirty ? .5 : 1,
            }}>
            <Icon as={FileDown} size={13}/>
            {exporting ? "Export…" : "Word"}
          </button>
          <button onClick={onDelete} title="Supprimer" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid rgba(224,92,92,0.3)`,
            borderRadius: RADIUS.md, padding: "8px 10px", color: "#e15a5a",
            cursor: "pointer",
          }}>
            <Icon as={Trash2} size={13}/>
          </button>
        </div>

        {/* KPIs */}
        <div className="audit-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Conformes",      val: nb_ok,  color: "#22c55e", icon: Check },
            { label: "Réserves",       val: nb_res, color: "#f59e0b", icon: AlertTriangle },
            { label: "Non conformes",  val: nb_nok, color: "#ef4444", icon: X },
            { label: "Non évalués",    val: nb_nd,  color: T.textMuted, icon: Eye },
          ].map(k => (
            <div key={k.label} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: RADIUS.lg, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                background: k.color + "18", color: k.color,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={k.icon} size={16} strokeWidth={2}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: k.color, letterSpacing: -.5, lineHeight: 1 }}>{k.val}</div>
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Barre globale */}
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.border, overflow: "hidden", display: "flex" }}>
              {nb_ok  > 0 && <div style={{ width: `${(nb_ok /total)*100}%`, background: "#22c55e" }} />}
              {nb_res > 0 && <div style={{ width: `${(nb_res/total)*100}%`, background: "#f59e0b" }} />}
              {nb_nok > 0 && <div style={{ width: `${(nb_nok/total)*100}%`, background: "#ef4444" }} />}
            </div>
            <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, whiteSpace: "nowrap", fontWeight: 600 }}>
              {total - nb_nd}/{total} évaluées
            </span>
          </div>
        )}

        {/* ── Réserves héritées de la visite précédente ── */}
        {reservesHeritees.length > 0 && (
          <div style={{
            background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.30)",
            borderRadius: RADIUS.xl, padding: "16px 18px", marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                background: "rgba(245,158,11,0.16)", color: "#f59e0b",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={History} size={16}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: "#f59e0b" }}>
                  Réserves de la visite du {fmtDate(derniereVisite.date)} à vérifier
                </div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 2 }}>
                  Coche OK sur la tâche concernée plus bas pour marquer la réserve comme levée.
                </div>
              </div>
              <div style={{
                fontSize: FONT.xs.size + 1, fontWeight: 700,
                background: "rgba(245,158,11,0.16)", color: "#f59e0b",
                borderRadius: RADIUS.pill, padding: "2px 10px",
              }}>
                {reservesHeritees.length}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {reservesHeritees.map((r, i) => {
                const isLevee = r.statut_courant === "ok";
                const isToujoursPresente = r.statut_courant === "reserve" || r.statut_courant === "nok";
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px", borderRadius: RADIUS.md,
                    background: isLevee ? "rgba(34,197,94,0.08)" : T.card,
                    border: `1px solid ${isLevee ? "rgba(34,197,94,0.30)" : isToujoursPresente ? "rgba(239,68,68,0.25)" : T.border}`,
                  }}>
                    <div style={{
                      width: 3, height: 24, borderRadius: 2, flexShrink: 0,
                      background: r.phase_color,
                    }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{r.nom_origine}</span>
                        <span style={{
                          fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                          background: r.phase_color + "22", color: r.phase_color, fontWeight: 600,
                        }}>{r.phase_label}</span>
                        <span style={{
                          fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                          background: r.statut_origine === "nok" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                          color: r.statut_origine === "nok" ? "#ef4444" : "#f59e0b", fontWeight: 700,
                        }}>{r.statut_origine === "nok" ? "NOK" : "RÉSERVE"}</span>
                      </div>
                      {r.commentaire_origine && (
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, fontStyle: "italic" }}>
                          « {r.commentaire_origine} »
                        </div>
                      )}
                    </div>
                    {/* Indicateur statut courant */}
                    {isLevee ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#22c55e",
                        background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                        borderRadius: RADIUS.pill, padding: "2px 8px", flexShrink: 0,
                      }}>
                        <Icon as={Check} size={11}/>
                        Levée
                      </span>
                    ) : isToujoursPresente ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#ef4444",
                        background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: RADIUS.pill, padding: "2px 8px", flexShrink: 0,
                      }}>
                        <Icon as={AlertTriangle} size={11}/>
                        Toujours présente
                      </span>
                    ) : (
                      <span style={{
                        fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600,
                        padding: "2px 8px", flexShrink: 0,
                      }}>
                        À évaluer
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Points de vigilance (checklist) ── */}
        {checklist.length > 0 && (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.xl, padding: "14px 18px", marginBottom: 14, overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{
                width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                background: acc.bg10, color: acc.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={ListChecks} size={16}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text }}>Points de vigilance</div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>
                  Sécurité, propreté, conditions générales du chantier
                </div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {(() => {
                  const ck_ok  = checklist.filter(c => c.statut === "ok").length;
                  const ck_res = checklist.filter(c => c.statut === "reserve").length;
                  const ck_nok = checklist.filter(c => c.statut === "nok").length;
                  return (
                    <>
                      {ck_ok  > 0 && <Pill val={ck_ok}  color="#22c55e" label="OK"  />}
                      {ck_res > 0 && <Pill val={ck_res} color="#f59e0b" label="Rés" />}
                      {ck_nok > 0 && <Pill val={ck_nok} color="#ef4444" label="NOK" />}
                    </>
                  );
                })()}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {checklist.map((item, idx) => (
                <TacheAudit
                  key={item.id || idx}
                  tache={{
                    nom: item.label,
                    statut: item.statut,
                    commentaire: item.commentaire,
                    photos: item.photos,
                    h_vendues: 0, avancement: 0, ouvrage: "",
                  }}
                  phaseColor={acc.accent}
                  T={T}
                  pathPrefix={`${photoPathPrefix}/checklist`}
                  onLightbox={setLightbox}
                  onChange={updates => updateChecklistItem(idx, updates)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Bandeau "Élargir la portée" ── */}
        {phasesHorsPortee.length > 0 && !showAll && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", marginBottom: 14,
            background: T.surface, border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg,
          }}>
            <Icon as={Eye} size={14} color={T.textMuted}/>
            <div style={{ flex: 1, fontSize: FONT.xs.size + 1, color: T.textSub }}>
              <strong style={{ color: T.text }}>{phasesHorsPortee.length} phase{phasesHorsPortee.length > 1 ? "s" : ""}</strong> du plan n'{phasesHorsPortee.length > 1 ? "ont" : "a"} pas été incluse{phasesHorsPortee.length > 1 ? "s" : ""} dans cette visite.
            </div>
            <button onClick={() => setShowAll(true)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: RADIUS.sm,
              border: `1px solid ${acc.accent}55`, background: acc.bg10, color: acc.accent,
              fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={Plus} size={11}/>
              Élargir la portée
            </button>
          </div>
        )}

        {/* Phases */}
        {phasesAffichees.length === 0 ? (
          <div style={{
            background: T.card, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl,
            padding: "40px 24px", textAlign: "center", color: T.textMuted,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: RADIUS.lg,
              background: acc.bg10, color: acc.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12,
            }}>
              <Icon as={ClipboardCheck} size={24} strokeWidth={1.5}/>
            </div>
            <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Aucune tâche à auditer
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, marginTop: 4 }}>
              {phasesAuditees.length === 0
                ? "Aucune phase n'est dans la portée — élargis la portée pour voir les tâches."
                : "Crée d'abord un phasage pour ce chantier dans l'onglet Phasage."}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {phasesAffichees.map(ph => {
              const taches = draft.audit?.[ph.id] || [];
              const ph_ok  = taches.filter(t => t.statut === "ok").length;
              const ph_res = taches.filter(t => t.statut === "reserve").length;
              const ph_nok = taches.filter(t => t.statut === "nok").length;
              const isExp  = expanded[ph.id] !== false;
              const horsScope = !phasesAuditees.includes(ph.id);

              return (
                <div key={ph.id} style={{
                  background: T.surface, border: `1px solid ${isExp ? ph.color + "66" : T.border}`,
                  borderRadius: RADIUS.xl, overflow: "hidden", transition: "border .2s",
                  opacity: horsScope ? .85 : 1,
                }}>
                  <div onClick={() => setExpanded(prev => ({ ...prev, [ph.id]: !isExp }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", cursor: "pointer",
                      borderBottom: isExp ? `1px solid ${T.sectionDivider || T.border}` : "none",
                    }}>
                    <div style={{ width: 4, height: 28, borderRadius: 2, background: ph.color, flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{ph.label}</div>
                        {horsScope && (
                          <span style={{
                            fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                            background: T.card, color: T.textMuted, border: `1px solid ${T.border}`, fontWeight: 600,
                          }}>Hors portée initiale</span>
                        )}
                      </div>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>
                        {taches.length} tâche{taches.length > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {ph_ok  > 0 && <Pill val={ph_ok}  color="#22c55e" label="OK"  />}
                      {ph_res > 0 && <Pill val={ph_res} color="#f59e0b" label="Rés" />}
                      {ph_nok > 0 && <Pill val={ph_nok} color="#ef4444" label="NOK" />}
                    </div>
                    <Icon as={isExp ? ChevronUp : ChevronDown} size={14} color={isExp ? ph.color : T.textMuted}/>
                  </div>

                  {isExp && (
                    <div style={{ padding: "6px 0" }}>
                      {taches.map((tache, idx) => (
                        <TacheAudit
                          key={tache.tache_id || idx}
                          tache={tache}
                          phaseColor={ph.color}
                          isHeritee={idsHeritees.has(`${ph.id}::${tache.tache_id}`)}
                          T={T}
                          pathPrefix={`${photoPathPrefix}/${ph.id}`}
                          onLightbox={setLightbox}
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
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 18, marginTop: 14,
        }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
            <Icon as={MessageSquare} size={12}/>
            Note générale de visite
          </div>
          <textarea
            value={draft.note_generale || ""}
            onChange={e => setNote(e.target.value)}
            placeholder="Observations générales, points d'attention, prochaines actions…"
            rows={4}
            style={{
              width: "100%", background: T.fieldBg || T.card,
              border: `1px solid ${T.fieldBorder || T.border}`, borderRadius: RADIUS.md,
              padding: "12px 14px", color: T.text, fontFamily: "inherit",
              fontSize: FONT.sm.size, resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Lightbox photos */}
        {lightbox && (
          <div onClick={() => setLightbox(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1200,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, flexDirection: "column", gap: 14,
          }}>
            <img src={lightbox.urls[lightbox.idx]} alt=""
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: "100%", maxHeight: "calc(100vh - 120px)", objectFit: "contain", borderRadius: 8 }}/>
            <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {lightbox.urls.length > 1 && (
                <>
                  <button onClick={() => setLightbox(l => ({ ...l, idx: (l.idx - 1 + l.urls.length) % l.urls.length }))}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                      color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit",
                    }}>
                    <Icon as={ChevronLeftIcon} size={16}/>
                  </button>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
                    {lightbox.idx + 1} / {lightbox.urls.length}
                  </span>
                  <button onClick={() => setLightbox(l => ({ ...l, idx: (l.idx + 1) % l.urls.length }))}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                      color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit",
                    }}>
                    <Icon as={ChevronRight} size={16}/>
                  </button>
                </>
              )}
              <button onClick={() => setLightbox(null)}
                style={{
                  background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                  color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                }}>
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* Récap réserves/NOK en bas */}
        {(nb_res + nb_nok) > 0 && (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.xl, padding: 18, marginTop: 14,
          }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
              <Icon as={FileWarning} size={12}/>
              Points à traiter à l'issue de la visite
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PHASES.map(ph => {
                const ts = (draft.audit?.[ph.id] || []).filter(t => t.statut === "reserve" || t.statut === "nok");
                if (!ts.length) return null;
                return ts.map((t, i) => (
                  <div key={`${ph.id}-${i}`} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px", borderRadius: RADIUS.md,
                    background: t.statut === "nok" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                    border: `1px solid ${t.statut === "nok" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
                  }}>
                    <Icon as={t.statut === "nok" ? X : AlertTriangle} size={14}
                      color={t.statut === "nok" ? "#ef4444" : "#f59e0b"}
                      style={{ marginTop: 2, flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{t.nom}</div>
                      <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{ph.label}</div>
                      {t.commentaire && (
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, fontStyle: "italic" }}>
                          → {t.commentaire}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700, padding: "3px 8px", borderRadius: RADIUS.pill,
                      background: t.statut === "nok" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                      color: t.statut === "nok" ? "#ef4444" : "#f59e0b", flexShrink: 0,
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
function TacheAudit({ tache, phaseColor, isHeritee = false, T, pathPrefix, onLightbox, onChange }) {
  const [showComment, setShowComment] = useState(!!tache.commentaire);
  const [showPhotos,  setShowPhotos]  = useState((tache.photos || []).length > 0);

  const setStatut = (s) => {
    onChange({ statut: s === tache.statut ? null : s });
    if ((s === "reserve" || s === "nok") && !showComment) setShowComment(true);
  };

  const statutColor = tache.statut === "ok" ? "#22c55e" : tache.statut === "reserve" ? "#f59e0b" : tache.statut === "nok" ? "#ef4444" : T.border;

  return (
    <div className="audit-tache-row" style={{
      padding: "10px 18px", borderBottom: `1px solid ${T.sectionDivider || T.border}`,
      background: isHeritee && !tache.statut ? "rgba(245,158,11,0.04)" : "transparent",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 12, alignItems: "start" }}>
        {/* Indicateur statut */}
        <div style={{
          width: 16, height: 16, borderRadius: "50%", marginTop: 3, flexShrink: 0,
          background: tache.statut ? statutColor + "25" : "transparent",
          border: `2px solid ${statutColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {tache.statut === "ok" && <Icon as={Check} size={9} color="#22c55e" strokeWidth={3.5}/>}
          {tache.statut === "reserve" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
          {tache.statut === "nok" && <Icon as={X} size={9} color="#ef4444" strokeWidth={3.5}/>}
        </div>

        {/* Infos tâche */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{tache.nom}</div>
            {isHeritee && (
              <span title="Réserve héritée de la visite précédente" style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                fontSize: FONT.xs.size, fontWeight: 700, color: "#f59e0b",
                background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: RADIUS.sm, padding: "1px 6px",
              }}>
                <Icon as={History} size={9}/>
                Hérité
              </span>
            )}
          </div>
          <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tache.ouvrage && <span>↳ {tache.ouvrage}</span>}
            {tache.h_vendues > 0 && <span style={{ color: phaseColor, fontWeight: 600 }}>{tache.h_vendues}h vendues</span>}
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
                  flex: 1, background: T.fieldBg || T.card,
                  border: `1px solid ${T.fieldBorder || T.border}`,
                  borderRadius: RADIUS.md, padding: "7px 10px", color: T.text,
                  fontFamily: "inherit", fontSize: FONT.xs.size + 1, resize: "vertical",
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* Photos */}
          {(showPhotos || (tache.photos || []).length > 0) && (
            <PhotosPicker
              photos={tache.photos || []}
              onChange={(nv) => onChange({ photos: nv })}
              pathPrefix={pathPrefix}
              color={phaseColor}
              onLightbox={onLightbox}
            />
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
                  padding: "6px 14px", borderRadius: RADIUS.md, fontSize: FONT.xs.size + 1, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit", minWidth: 48,
                  background: isActive ? btn.activeColor + "22" : "transparent",
                  border: `1.5px solid ${isActive ? btn.activeColor : T.border}`,
                  color: isActive ? btn.activeColor : T.textMuted,
                  transition: "all .15s",
                }}>
                  {btn.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowComment(s => !s)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: FONT.xs.size + 1, color: showComment ? phaseColor : T.textMuted,
              fontFamily: "inherit", padding: "2px 4px", fontWeight: 600,
            }}>
              {showComment ? "− note" : "+ note"}
            </button>
            <button onClick={() => setShowPhotos(s => !s)} style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: FONT.xs.size + 1, color: showPhotos || (tache.photos || []).length > 0 ? phaseColor : T.textMuted,
              fontFamily: "inherit", padding: "2px 4px", fontWeight: 600,
            }}>
              <Icon as={Camera} size={11}/>
              photo{(tache.photos || []).length > 0 ? ` · ${(tache.photos || []).length}` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MODALE GESTION DU TEMPLATE CHECKLIST ────────────────────────────────────
function ChecklistTemplateModal({ items, T, acc, onSave, onClose }) {
  const [draft, setDraft]   = useState(() => items.map(i => ({ ...i })));
  const [saving, setSaving] = useState(false);

  const addItem = () => setDraft(d => [...d, { id: genId(), label: "" }]);
  const removeItem = (i) => setDraft(d => d.filter((_, idx) => idx !== i));
  const updateItem = (i, label) => setDraft(d => d.map((x, idx) => idx === i ? { ...x, label } : x));
  const moveUp = (i) => setDraft(d => {
    if (i === 0) return d;
    const n = [...d]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
  });
  const moveDown = (i) => setDraft(d => {
    if (i === d.length - 1) return d;
    const n = [...d]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n;
  });

  const handleSave = async () => {
    setSaving(true);
    const cleaned = draft.map(it => ({ id: it.id || genId(), label: (it.label || "").trim() })).filter(it => it.label);
    await onSave(cleaned);
    setSaving(false);
  };

  const handleReset = () => {
    if (!confirm("Restaurer la checklist par défaut ?")) return;
    setDraft(CHECKLIST_DEFAUT.map(i => ({ ...i })));
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal, borderRadius: RADIUS.xl,
        width: "100%", maxWidth: 560, maxHeight: "90vh",
        border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.sectionDivider || T.border}`,
          display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={ListChecks} size={16}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Points de vigilance</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              Items récurrents repris automatiquement dans chaque nouvelle visite
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: RADIUS.md, width: 32, height: 32,
            cursor: "pointer", color: T.textSub,
          }}>
            <Icon as={X} size={14}/>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {draft.map((it, i) => (
              <div key={it.id || i} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 10px", borderRadius: RADIUS.md,
                background: T.card, border: `1px solid ${T.border}`,
              }}>
                <input
                  value={it.label}
                  onChange={e => updateItem(i, e.target.value)}
                  placeholder="Ex : Port des EPI"
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                  }}/>
                <button onClick={() => moveUp(i)} disabled={i === 0} title="Monter"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", cursor: i === 0 ? "default" : "pointer",
                    padding: 3, color: i === 0 ? T.textMuted : T.textSub, opacity: i === 0 ? .4 : 1,
                  }}>
                  <Icon as={ChevronUp} size={14}/>
                </button>
                <button onClick={() => moveDown(i)} disabled={i === draft.length - 1} title="Descendre"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", cursor: i === draft.length - 1 ? "default" : "pointer",
                    padding: 3, color: i === draft.length - 1 ? T.textMuted : T.textSub, opacity: i === draft.length - 1 ? .4 : 1,
                  }}>
                  <Icon as={ChevronDown} size={14}/>
                </button>
                <button onClick={() => removeItem(i)} title="Supprimer"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: 3, color: "#e15a5a",
                  }}>
                  <Icon as={Trash2} size={13}/>
                </button>
              </div>
            ))}
          </div>
          <button onClick={addItem} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            marginTop: 10, width: "100%", padding: 10,
            border: `1.5px dashed ${T.border}`, borderRadius: RADIUS.md,
            background: "transparent", color: T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
          }}>
            <Icon as={Plus} size={13}/>
            Ajouter un point
          </button>
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.sectionDivider || T.border}`,
          display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button onClick={handleReset} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textMuted,
            fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
          }}>
            Restaurer par défaut
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{
              padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={handleSave} disabled={saving} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
              background: acc.accent, color: acc.onAccent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              opacity: saving ? .6 : 1,
            }}>
              <Icon as={Check} size={13}/>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
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
