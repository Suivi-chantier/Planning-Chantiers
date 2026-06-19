import { useState, useEffect, useRef } from "react";
import html2pdf from "html2pdf.js";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import {
  ClipboardCheck, Plus, Trash2, ChevronLeft as ChevronLeftIcon,
  ChevronRight, ChevronUp, ChevronDown, Check, X, AlertTriangle,
  Building2, Calendar, MessageSquare, Save, History, ArrowRight,
  Eye, FileWarning, Camera, FileDown, ListChecks, Layers, Package,
} from "lucide-react";

// ─── LOTS (chargés depuis Supabase, fallback sur défaut) ────────────────────
// Modèle V2 : un chantier a des ouvrages (phasage.ouvrages[]), chaque ouvrage
// porte un lot_id et contient des taches[]. L'audit se fait par LOT.
let LOTS = LOTS_DEFAUT.slice();
loadLots().then(l => { LOTS = l; });

// Lot fictif pour les ouvrages sans lot_id (ne rien perdre à l'audit).
const SANS_LOT = { id: "_sans", label: "Sans lot", couleur: "#94a3b8", code_prefixe: "" };
const lotMeta = (lotId) =>
  LOTS.find(l => l.id === lotId) || (lotId === "_sans" ? SANS_LOT : { id: lotId, label: lotId, couleur: "#888888" });

const STATUTS = [
  { id: "en_cours", label: "En cours",  color: "#f59e0b" },
  { id: "cloturee", label: "Clôturée",  color: "#22c55e" },
  { id: "annulee",  label: "Annulée",   color: "#ef4444" },
];

// ─── STATUTS D'UNE TÂCHE AUDITÉE ────────────────────────────────────────────
// Validé (conforme) / Réserves (à reprendre) / Pas encore commencé. null = non évalué.
const STATUTS_TACHE = [
  { id: "valide",       label: "Validé",   full: "Validé",              color: "#22c55e" },
  { id: "reserve",      label: "Réserve",  full: "Réserve",             color: "#f59e0b" },
  { id: "non_commence", label: "Pas com.", full: "Pas encore commencé", color: "#94a3b8" },
];
const statutColorOf = (s) => STATUTS_TACHE.find(x => x.id === s)?.color || "#3a4252";
const statutLabelOf = (s) => STATUTS_TACHE.find(x => x.id === s)?.full || "Non évalué";

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

// ─── DÉTECTION MOBILE (Chrome / Safari smartphone) ──────────────────────────
// La page est utilisée principalement en mobilité, sur chantier. On adapte la
// mise en page (boutons pleine largeur, barre d'actions fixe…) selon la largeur.
function useIsMobile(bp = 767) {
  const query = `(max-width:${bp}px)`;
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = e => setM(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else mq.addListener(fn); // Safari < 14
    setM(mq.matches);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", fn); else mq.removeListener(fn); };
  }, [query]);
  return m;
}

// ─── HELPERS MODÈLE V2 ──────────────────────────────────────────────────────
// Avancement pondéré par heures_estimees (logique alignée sur PhasageV2).
function avancementMoyen(taches = []) {
  const ts = taches || [];
  const totalH = ts.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalH > 0)
    return Math.round(ts.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalH);
  return ts.length ? Math.round(ts.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / ts.length) : 0;
}

// lotId d'un ouvrage (avec repli "_sans" quand le lot est absent/inconnu).
const ouvrageLotId = (o) => (o.lot_id && LOTS.some(l => l.id === o.lot_id)) ? o.lot_id : "_sans";

// Liste des lots présents dans un phasage (avec leurs ouvrages), triés selon LOTS.
function lotsDuPhasage(ouvrages = []) {
  const byLot = {};
  (ouvrages || []).forEach(o => {
    const lid = ouvrageLotId(o);
    (byLot[lid] ||= []).push(o);
  });
  const ordered = [...LOTS, SANS_LOT]
    .filter(l => byLot[l.id])
    .map(l => ({ ...l, ouvrages: byLot[l.id] }));
  return ordered;
}

// Construit le snapshot d'audit indexé par lot_id à partir des ouvrages cochés.
function buildAudit(ouvrages = [], lotsSel = []) {
  const audit = {};
  lotsSel.forEach(lotId => {
    const list = [];
    (ouvrages || []).filter(o => ouvrageLotId(o) === lotId).forEach(o => {
      (o.taches || []).forEach(t => {
        list.push({
          ouvrage_id:      o.id,
          ouvrage_libelle: o.libelle || "",
          tache_id:        t.id,
          nom:             t.nom || "",
          heures_estimees: t.heures_estimees || 0,
          avancement:      t.avancement || 0,
          statut:          null,
          commentaire:     "",
          photos:          [],
        });
      });
    });
    if (list.length) audit[lotId] = list;
  });
  return audit;
}

// Regroupe les entrées d'audit d'un lot par ouvrage (pour l'affichage 2 niveaux).
function groupByOuvrage(taches = []) {
  const groups = [];
  const idx = {};
  (taches || []).forEach(t => {
    const key = t.ouvrage_id || "_";
    if (idx[key] === undefined) {
      idx[key] = groups.length;
      groups.push({ ouvrage_id: t.ouvrage_id, ouvrage_libelle: t.ouvrage_libelle || "Ouvrage", taches: [] });
    }
    groups[idx[key]].taches.push(t);
  });
  return groups;
}

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
    .select("id, chantier_id, chantier_nom, ouvrages");
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
  const [lotsReady, setLotsReady] = useState(false);
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
    loadLots().then(l => { LOTS = l; setLotsReady(true); });
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
        ? `\n\nIl manque probablement une colonne dans Supabase :\nALTER TABLE visites_chantier ADD COLUMN IF NOT EXISTS lots_audites JSONB DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;`
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
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
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
    nbAFaire: toutesTaches.filter(t => t.statut === "non_commence").length,
  };

  return (
    <div className="page-padding visite-liste" style={{ padding: "24px 28px", background: T.bg, flex: 1, overflowY: "auto" }}>
      <style>{`
        @media(max-width:767px) {
          .visite-liste{ padding:16px 12px !important; }
          .visite-liste button{ -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
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
                Audits terrain par lot : valide ce qui est fait, note les réserves
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
              { label: "À réaliser",   val: stats.nbAFaire,   icon: FileWarning,    color: stats.nbAFaire > 0 ? "#94a3b8" : T.textMuted },
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
              Crée une visite pour auditer un chantier : choisis les lots du jour, puis valide les tâches faites, note les réserves et ce qui reste à réaliser.
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
            const nb_ok  = toutes.filter(t => t.statut === "valide").length;
            const nb_res = toutes.filter(t => t.statut === "reserve").length;
            const nb_af  = toutes.filter(t => t.statut === "non_commence").length;
            const total  = toutes.length;
            const nbEval = toutes.filter(t => t.statut).length;
            const st = STATUTS.find(s => s.id === v.statut);
            const accentColor = c?.couleur || acc.accent;
            const nbLots = Array.isArray(v.lots_audites) ? v.lots_audites.length : Object.keys(audit).length;

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
                    {nbLots > 0 && (
                      <span style={{ color: acc.accent, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon as={Layers} size={11}/>
                        {nbLots} lot{nbLots > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {total > 0 && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: T.border, borderRadius: 3, overflow: "hidden", display: "flex" }}>
                        {nb_ok  > 0 && <div style={{ width: `${(nb_ok /total)*100}%`, height: "100%", background: "#22c55e" }} />}
                        {nb_res > 0 && <div style={{ width: `${(nb_res/total)*100}%`, height: "100%", background: "#f59e0b" }} />}
                        {nb_af  > 0 && <div style={{ width: `${(nb_af /total)*100}%`, height: "100%", background: "#94a3b8" }} />}
                      </div>
                      <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, whiteSpace: "nowrap", fontWeight: 600 }}>
                        {nbEval}/{total} évaluées
                      </span>
                    </div>
                  )}
                </div>

                {total > 0 && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {nb_ok  > 0 && <Pill val={nb_ok}  color="#22c55e" label="Validé" />}
                    {nb_res > 0 && <Pill val={nb_res} color="#f59e0b" label="Rés"   />}
                    {nb_af  > 0 && <Pill val={nb_af}  color="#94a3b8" label="À faire" />}
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
  const [lotsSel,    setLotsSel]    = useState([]); // IDs des lots à auditer

  const phasage  = phasages.find(p => p.chantier_id === chantierId);
  const ouvrages = phasage?.ouvrages || [];
  const lotsAvecOuvrages = lotsDuPhasage(ouvrages);

  // ── Quand on change de chantier : pré-sélectionner les lots qui ont au moins
  //    une tâche non terminée (avancement < 100). Les lots entièrement terminés
  //    sont décochés par défaut (peu d'intérêt à les ré-auditer).
  useEffect(() => {
    const presel = lotsAvecOuvrages.filter(l => {
      const ts = l.ouvrages.flatMap(o => o.taches || []);
      return ts.some(t => (parseFloat(t.avancement) || 0) < 100);
    }).map(l => l.id);
    setLotsSel(presel.length > 0 ? presel : lotsAvecOuvrages.map(l => l.id));
  }, [chantierId]);

  const toggleLot = (id) => {
    setLotsSel(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };
  const toutCocher = () => setLotsSel(lotsAvecOuvrages.map(l => l.id));
  const toutDecocher = () => setLotsSel([]);

  const handleCreate = () => {
    if (!chantierId) return;
    onSave({
      id:            genId(),
      chantier_id:   chantierId,
      date,
      statut:        "en_cours",
      lots_audites:  lotsSel,
      audit:         buildAudit(ouvrages, lotsSel),
      note_generale: "",
      checklist: checklistTemplate.map(item => ({
        id: item.id,
        label: item.label,
        statut: null,
        commentaire: "",
        photos: [],
      })),
    });
  };

  return (
    <div className="page-padding visite-form" style={{ padding: "24px 28px", background: T.bg, flex: 1, overflowY: "auto" }}>
      <style>{`
        @media(max-width:767px) {
          .visite-form{ padding:16px 12px !important; }
          .visite-form input, .visite-form select, .visite-form textarea{ font-size:16px !important; min-height:46px; }
          .visite-form button{ -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
          .visite-form .responsive-grid{ grid-template-columns:1fr !important; }
        }
      `}</style>
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
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Choisis un chantier, une date, puis les lots à auditer</div>
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

        {/* ── Sélecteur de lots à auditer ── */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 20, marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 4 }}>
                Lots à auditer aujourd'hui
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>
                Coche les lots que tu vas vérifier. Tu pourras élargir la portée pendant l'audit.
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
          ) : lotsAvecOuvrages.length === 0 ? (
            <div style={{
              padding: "14px 16px", background: T.card,
              border: `1px dashed ${T.border}`, borderRadius: RADIUS.md,
              fontSize: FONT.sm.size, color: T.textMuted,
            }}>
              Le phasage est vide. Ajoute des ouvrages et des tâches dans le Phasage avant de créer une visite.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lotsAvecOuvrages.map(l => {
                const ts = l.ouvrages.flatMap(o => o.taches || []);
                const av = avancementMoyen(ts);
                const isCheck = lotsSel.includes(l.id);
                return (
                  <div key={l.id} onClick={() => toggleLot(l.id)} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: RADIUS.md, cursor: "pointer",
                    background: isCheck ? l.couleur + "12" : T.card,
                    border: `1px solid ${isCheck ? l.couleur + "66" : T.border}`,
                    transition: "all .15s",
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: RADIUS.sm, flexShrink: 0,
                      background: isCheck ? l.couleur : "transparent",
                      border: `2px solid ${isCheck ? l.couleur : T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff",
                    }}>
                      {isCheck && <Icon as={Check} size={11} strokeWidth={3}/>}
                    </div>
                    <div style={{ width: 3, height: 22, borderRadius: 2, background: l.couleur, flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{l.label}</div>
                      <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>
                        {l.ouvrages.length} ouvrage{l.ouvrages.length > 1 ? "s" : ""} · {ts.length} tâche{ts.length > 1 ? "s" : ""}
                        {av === 100 && <span style={{ color: "#22c55e", fontWeight: 700 }}> · Terminé</span>}
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
          <button onClick={handleCreate} disabled={saving || !chantierId || lotsSel.length === 0} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "10px 22px", borderRadius: RADIUS.md, border: "none",
            background: (saving || lotsSel.length === 0) ? T.border : acc.accent,
            color: acc.onAccent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            cursor: (saving || lotsSel.length === 0) ? "not-allowed" : "pointer",
            opacity: (saving || lotsSel.length === 0) ? .6 : 1,
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
  const [showAll,  setShowAll]  = useState(false); // élargir au-delà de lots_audites
  const [lightbox, setLightbox] = useState(null);  // { urls:[], idx:0 }
  const [exporting,setExporting]= useState(null);   // "docx" | "pdf" | null
  const isMobile = useIsMobile();

  // Préfixe de stockage pour les photos de cette visite
  const photoPathPrefix = `visites/${visite.chantier_id}/${visite.id}`;

  const ch       = chantiers.find(c => c.id === visite.chantier_id);
  const phasage  = phasages.find(p => p.chantier_id === visite.chantier_id);
  const ouvrages = phasage?.ouvrages || [];
  const accentChantier = ch?.couleur || acc.accent;

  // ── Lots dans la portée (fallback : tous ceux présents dans l'audit)
  const lotsAuditesIds = Array.isArray(visite.lots_audites) && visite.lots_audites.length > 0
    ? visite.lots_audites
    : Object.keys(visite.audit || {});

  // ── Tous les lots qui existent côté phasage (pour "hors portée" / élargir)
  const lotsPhasage = lotsDuPhasage(ouvrages);

  // ── Visites précédentes du même chantier (date < visite.date), tri DESC
  const visitesPrecedentes = (toutesVisites || [])
    .filter(v => v.chantier_id === visite.chantier_id && v.id !== visite.id && (v.date || "") < (visite.date || ""))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // ── Réserves héritées : dernière visite, tâches encore en réserve, matchées
  //    par tache_id avec la visite courante.
  const derniereVisite = visitesPrecedentes[0];
  const reservesHeritees = (() => {
    if (!derniereVisite) return [];
    const tachesCourantes = Object.values(draft.audit || {}).flat();
    const list = [];
    Object.entries(derniereVisite.audit || {}).forEach(([lotId, taches]) => {
      taches.forEach(t => {
        if (t.statut !== "reserve") return;
        const tCourante = tachesCourantes.find(x => x.tache_id === t.tache_id);
        const meta = lotMeta(lotId);
        list.push({
          lot_id: lotId,
          lot_label: meta.label,
          lot_color: meta.couleur,
          tache_id: t.tache_id,
          nom_origine: t.nom,
          ouvrage_origine: t.ouvrage_libelle || "",
          commentaire_origine: t.commentaire || "",
          statut_origine: t.statut,
          statut_courant: tCourante?.statut || null,
        });
      });
    });
    return list;
  })();

  // Sync : ajoute au snapshot les tâches/ouvrages ajoutés au phasage depuis la
  // création de la visite, pour les lots en portée (ou tous si showAll).
  useEffect(() => {
    const updated = { ...draft, audit: { ...(draft.audit || {}) } };
    let changed = false;
    lotsPhasage.forEach(l => {
      const inScope = lotsAuditesIds.includes(l.id) || showAll;
      if (!inScope) return;
      const existing = updated.audit[l.id] || [];
      const seen = new Set(existing.map(t => t.tache_id));
      const additions = [];
      l.ouvrages.forEach(o => {
        (o.taches || []).forEach(t => {
          if (!seen.has(t.id)) {
            additions.push({
              ouvrage_id: o.id, ouvrage_libelle: o.libelle || "",
              tache_id: t.id, nom: t.nom || "",
              heures_estimees: t.heures_estimees || 0, avancement: t.avancement || 0,
              statut: null, commentaire: "", photos: [],
            });
            changed = true;
          }
        });
      });
      if (additions.length) updated.audit[l.id] = [...existing, ...additions];
    });
    if (changed) setDraft(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  // ── Marqueur visuel : tâches héritées d'une réserve
  const idsHeritees = new Set(reservesHeritees.map(r => r.tache_id));

  const updateTache = (lotId, idx, updates) => {
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      n.audit[lotId][idx] = { ...n.audit[lotId][idx], ...updates };
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

  // ── Méta des lots affichés (lots en portée OU tous si showAll), avec audit
  const lotsAffiches = (showAll
    ? [...new Set([...lotsAuditesIds, ...lotsPhasage.map(l => l.id)])]
    : lotsAuditesIds
  )
    .filter(lotId => (draft.audit?.[lotId] || []).length > 0)
    .map(lotId => ({ ...lotMeta(lotId), taches: draft.audit[lotId], horsScope: !lotsAuditesIds.includes(lotId) }));

  // ── Lots hors portée (présents au phasage mais pas dans lots_audites)
  const lotsHorsPortee = lotsPhasage.filter(l => !lotsAuditesIds.includes(l.id));

  // KPIs globaux (tâches en portée + checklist)
  const checklist = Array.isArray(draft.checklist) ? draft.checklist : [];
  const toutes  = [...lotsAffiches.flatMap(l => l.taches), ...checklist];
  const nb_ok   = toutes.filter(t => t.statut === "valide").length;
  const nb_res  = toutes.filter(t => t.statut === "reserve").length;
  const nb_af   = toutes.filter(t => t.statut === "non_commence").length;
  const nb_nd   = toutes.filter(t => !t.statut).length;
  const total   = toutes.length;

  // ── Export : construit le payload commun (Word + PDF)
  const buildPayload = () => ({
    visite: draft,
    chantier: ch ? { id: ch.id, nom: ch.nom, couleur: ch.couleur } : null,
    lots: lotsAffiches.map(l => ({ id: l.id, label: l.label, couleur: l.couleur })),
    reserves_heritees: reservesHeritees,
    derniere_visite_date: derniereVisite?.date || null,
  });

  const handleExportWord = async () => {
    if (dirty || exporting) return;
    setExporting("docx");
    try {
      const res = await fetch("/api/generate-visite-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
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
    setExporting(null);
  };

  const handleExportPdf = async () => {
    if (dirty || exporting) return;
    setExporting("pdf");
    try {
      await exportVisitePdf(buildPayload());
    } catch (e) {
      console.error("Export pdf:", e);
      alert("Erreur lors de la génération du PDF : " + e.message);
    }
    setExporting(null);
  };

  return (
    <div className="page-padding visite-audit" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <style>{`
        @media(max-width:767px) {
          .visite-audit{ padding:16px 12px !important; }
          .visite-audit input, .visite-audit select, .visite-audit textarea{ font-size:16px !important; }
          .visite-audit button{ -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
          .visite-audit .audit-header{ flex-wrap:wrap !important; gap:10px !important; }
          .visite-audit .audit-header > div:nth-child(2){ flex:1 1 100% !important; order:0; }
          .visite-audit .audit-header select{ flex:1; min-height:46px; }
          .visite-audit .audit-kpis{ grid-template-columns:repeat(2,1fr) !important; gap:8px !important; }
        }
      `}</style>
      <div style={{ maxWidth: 960, margin: "0 auto", paddingBottom: isMobile ? 84 : 0 }}>

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
                <Icon as={Layers} size={11}/>
                {lotsAuditesIds.length} lot{lotsAuditesIds.length > 1 ? "s" : ""} dans la portée
              </span>
            </div>
          </div>
          <select value={draft.statut} onChange={e => setStatutVisite(e.target.value)} style={{
            padding: "8px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
            background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer",
          }}>
            {STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {!isMobile && (<>
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
          <button onClick={handleExportWord} disabled={!!exporting || dirty} title={dirty ? "Sauvegarde d'abord la visite" : "Exporter en .docx"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
              cursor: exporting || dirty ? "not-allowed" : "pointer",
              opacity: dirty ? .5 : 1,
            }}>
            <Icon as={FileDown} size={13}/>
            {exporting === "docx" ? "Export…" : "Word"}
          </button>
          <button onClick={handleExportPdf} disabled={!!exporting || dirty} title={dirty ? "Sauvegarde d'abord la visite" : "Exporter en PDF"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
              cursor: exporting || dirty ? "not-allowed" : "pointer",
              opacity: dirty ? .5 : 1,
            }}>
            <Icon as={FileDown} size={13}/>
            {exporting === "pdf" ? "Export…" : "PDF"}
          </button>
          </>)}
          <button onClick={onDelete} title="Supprimer" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid rgba(224,92,92,0.3)`,
            borderRadius: RADIUS.md, padding: "8px 10px", color: "#e15a5a",
            cursor: "pointer",
          }}>
            <Icon as={Trash2} size={13}/>
          </button>
        </div>

        {/* Barre d'actions fixe (mobile) — toujours à portée du pouce */}
        {isMobile && (
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90,
            display: "flex", gap: 8,
            padding: "10px 12px calc(10px + env(safe-area-inset-bottom))",
            background: T.surface, borderTop: `1px solid ${T.border}`,
            boxShadow: "0 -6px 20px rgba(0,0,0,0.28)",
          }}>
            <button onClick={handleSave} disabled={saving} style={{
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "13px 14px", borderRadius: RADIUS.md,
              background: dirty ? acc.accent : T.card, color: dirty ? acc.onAccent : T.textMuted,
              border: dirty ? "none" : `1px solid ${T.border}`,
              fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={dirty ? Save : Check} size={16}/>
              {saving ? "Sauvegarde…" : dirty ? "Sauvegarder" : "Sauvegardé"}
            </button>
            <button onClick={handleExportWord} disabled={!!exporting || dirty} title="Exporter en Word" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "13px 16px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
              fontFamily: "inherit", fontSize: 14, fontWeight: 700,
              cursor: exporting || dirty ? "not-allowed" : "pointer", opacity: dirty ? .5 : 1,
            }}>
              <Icon as={FileDown} size={16}/>{exporting === "docx" ? "…" : "Word"}
            </button>
            <button onClick={handleExportPdf} disabled={!!exporting || dirty} title="Exporter en PDF" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "13px 16px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
              fontFamily: "inherit", fontSize: 14, fontWeight: 700,
              cursor: exporting || dirty ? "not-allowed" : "pointer", opacity: dirty ? .5 : 1,
            }}>
              <Icon as={FileDown} size={16}/>{exporting === "pdf" ? "…" : "PDF"}
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="audit-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Validées",        val: nb_ok,  color: "#22c55e", icon: Check },
            { label: "Réserves",        val: nb_res, color: "#f59e0b", icon: AlertTriangle },
            { label: "Pas commencées",  val: nb_af,  color: "#94a3b8", icon: Package },
            { label: "Non évaluées",    val: nb_nd,  color: T.textMuted, icon: Eye },
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
              {nb_af  > 0 && <div style={{ width: `${(nb_af /total)*100}%`, background: "#94a3b8" }} />}
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
                  Passe la tâche concernée en « Validé » plus bas pour lever la réserve.
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
                const isLevee = r.statut_courant === "valide";
                const isToujoursPresente = r.statut_courant === "reserve";
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px", borderRadius: RADIUS.md,
                    background: isLevee ? "rgba(34,197,94,0.08)" : T.card,
                    border: `1px solid ${isLevee ? "rgba(34,197,94,0.30)" : isToujoursPresente ? "rgba(239,68,68,0.25)" : T.border}`,
                  }}>
                    <div style={{
                      width: 3, height: 24, borderRadius: 2, flexShrink: 0,
                      background: r.lot_color,
                    }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{r.nom_origine}</span>
                        <span style={{
                          fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                          background: r.lot_color + "22", color: r.lot_color, fontWeight: 600,
                        }}>{r.lot_label}</span>
                        <span style={{
                          fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                          background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700,
                        }}>RÉSERVE</span>
                      </div>
                      {r.ouvrage_origine && (
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>↳ {r.ouvrage_origine}</div>
                      )}
                      {r.commentaire_origine && (
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, fontStyle: "italic" }}>
                          « {r.commentaire_origine} »
                        </div>
                      )}
                    </div>
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
                  const ck_ok  = checklist.filter(c => c.statut === "valide").length;
                  const ck_res = checklist.filter(c => c.statut === "reserve").length;
                  const ck_af  = checklist.filter(c => c.statut === "non_commence").length;
                  return (
                    <>
                      {ck_ok  > 0 && <Pill val={ck_ok}  color="#22c55e" label="Validé" />}
                      {ck_res > 0 && <Pill val={ck_res} color="#f59e0b" label="Rés"   />}
                      {ck_af  > 0 && <Pill val={ck_af}  color="#94a3b8" label="N/A"   />}
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
                    heures_estimees: 0, avancement: 0, ouvrage_libelle: "",
                  }}
                  lotColor={acc.accent}
                  isMobile={isMobile}
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
        {lotsHorsPortee.length > 0 && !showAll && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", marginBottom: 14,
            background: T.surface, border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg,
          }}>
            <Icon as={Eye} size={14} color={T.textMuted}/>
            <div style={{ flex: 1, fontSize: FONT.xs.size + 1, color: T.textSub }}>
              <strong style={{ color: T.text }}>{lotsHorsPortee.length} lot{lotsHorsPortee.length > 1 ? "s" : ""}</strong> du phasage n'{lotsHorsPortee.length > 1 ? "ont" : "a"} pas été inclus{lotsHorsPortee.length > 1 ? "s" : ""} dans cette visite.
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

        {/* Lots → Ouvrages → Tâches */}
        {lotsAffiches.length === 0 ? (
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
              {lotsAuditesIds.length === 0
                ? "Aucun lot n'est dans la portée — élargis la portée pour voir les tâches."
                : "Crée d'abord un phasage pour ce chantier dans l'onglet Phasage."}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lotsAffiches.map(lot => {
              const lot_ok  = lot.taches.filter(t => t.statut === "valide").length;
              const lot_res = lot.taches.filter(t => t.statut === "reserve").length;
              const lot_af  = lot.taches.filter(t => t.statut === "non_commence").length;
              const isExp   = expanded[lot.id] !== false;
              const groupes = groupByOuvrage(lot.taches);

              return (
                <div key={lot.id} style={{
                  background: T.surface, border: `1px solid ${isExp ? lot.couleur + "66" : T.border}`,
                  borderRadius: RADIUS.xl, overflow: "hidden", transition: "border .2s",
                  opacity: lot.horsScope ? .9 : 1,
                }}>
                  <div onClick={() => setExpanded(prev => ({ ...prev, [lot.id]: !isExp }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", cursor: "pointer",
                      borderBottom: isExp ? `1px solid ${T.sectionDivider || T.border}` : "none",
                    }}>
                    <div style={{ width: 4, height: 28, borderRadius: 2, background: lot.couleur, flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{lot.label}</div>
                        {lot.horsScope && (
                          <span style={{
                            fontSize: FONT.xs.size, padding: "1px 7px", borderRadius: RADIUS.sm,
                            background: T.card, color: T.textMuted, border: `1px solid ${T.border}`, fontWeight: 600,
                          }}>Hors portée initiale</span>
                        )}
                      </div>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>
                        {groupes.length} ouvrage{groupes.length > 1 ? "s" : ""} · {lot.taches.length} tâche{lot.taches.length > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {lot_ok  > 0 && <Pill val={lot_ok}  color="#22c55e" label="Validé" />}
                      {lot_res > 0 && <Pill val={lot_res} color="#f59e0b" label="Rés"   />}
                      {lot_af  > 0 && <Pill val={lot_af}  color="#94a3b8" label="À faire" />}
                    </div>
                    <Icon as={isExp ? ChevronUp : ChevronDown} size={14} color={isExp ? lot.couleur : T.textMuted}/>
                  </div>

                  {isExp && (
                    <div style={{ padding: "4px 0 8px" }}>
                      {groupes.map(g => (
                        <div key={g.ouvrage_id || g.ouvrage_libelle}>
                          {/* En-tête ouvrage : bandeau teinté + libellé coloré (accent) */}
                          <div style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 12px", margin: "10px 10px 5px",
                            borderRadius: RADIUS.md,
                            background: `color-mix(in srgb, ${lot.couleur} 13%, transparent)`,
                            borderLeft: `3px solid ${lot.couleur}`,
                          }}>
                            <Icon as={Package} size={14} color={lot.couleur}/>
                            <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: lot.couleur, letterSpacing: .2 }}>
                              {g.ouvrage_libelle || "Ouvrage"}
                            </div>
                          </div>
                          {/* Tâches indentées sous l'ouvrage (filet coloré à gauche) */}
                          <div style={{
                            marginLeft: 18, paddingLeft: 8,
                            borderLeft: `1px solid color-mix(in srgb, ${lot.couleur} 30%, transparent)`,
                          }}>
                            {g.taches.map((tache) => {
                              // index réel dans lot.taches pour la mise à jour
                              const realIdx = lot.taches.indexOf(tache);
                              return (
                                <TacheAudit
                                  key={tache.tache_id || realIdx}
                                  tache={tache}
                                  lotColor={lot.couleur}
                                  isHeritee={idsHeritees.has(tache.tache_id)}
                                  isMobile={isMobile}
                                  T={T}
                                  pathPrefix={`${photoPathPrefix}/${lot.id}`}
                                  onLightbox={setLightbox}
                                  onChange={updates => updateTache(lot.id, realIdx, updates)}
                                />
                              );
                            })}
                          </div>
                        </div>
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

        {/* Récap réserves / à réaliser en bas */}
        {(nb_res + nb_af) > 0 && (
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.xl, padding: 18, marginTop: 14,
          }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
              <Icon as={FileWarning} size={12}/>
              Points à traiter à l'issue de la visite
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lotsAffiches.map(lot => {
                const ts = lot.taches.filter(t => t.statut === "reserve" || t.statut === "non_commence");
                if (!ts.length) return null;
                return ts.map((t, i) => {
                  const isRes = t.statut === "reserve";
                  return (
                    <div key={`${lot.id}-${i}`} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "10px 12px", borderRadius: RADIUS.md,
                      background: isRes ? "rgba(245,158,11,0.08)" : "rgba(148,163,184,0.08)",
                      border: `1px solid ${isRes ? "rgba(245,158,11,0.25)" : "rgba(148,163,184,0.25)"}`,
                    }}>
                      <Icon as={isRes ? AlertTriangle : Package} size={14}
                        color={isRes ? "#f59e0b" : "#94a3b8"}
                        style={{ marginTop: 2, flexShrink: 0 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{t.nom}</div>
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                          {lot.label}{t.ouvrage_libelle ? ` · ${t.ouvrage_libelle}` : ""}
                        </div>
                        {t.commentaire && (
                          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, fontStyle: "italic" }}>
                            → {t.commentaire}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: FONT.xs.size, fontWeight: 700, padding: "3px 8px", borderRadius: RADIUS.pill,
                        background: isRes ? "rgba(245,158,11,0.15)" : "rgba(148,163,184,0.15)",
                        color: isRes ? "#f59e0b" : "#94a3b8", flexShrink: 0,
                      }}>
                        {isRes ? "RÉSERVE" : "À RÉALISER"}
                      </span>
                    </div>
                  );
                });
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── TÂCHE AUDIT ──────────────────────────────────────────────────────────────
function TacheAudit({ tache, lotColor, isHeritee = false, isMobile = false, T, pathPrefix, onLightbox, onChange }) {
  const [showComment, setShowComment] = useState(!!tache.commentaire);
  const [showPhotos,  setShowPhotos]  = useState((tache.photos || []).length > 0);

  const setStatut = (s) => {
    onChange({ statut: s === tache.statut ? null : s });
    if (s === "reserve" && !showComment) setShowComment(true);
  };

  const statutColor = statutColorOf(tache.statut);

  // ── Indicateur de statut (pastille)
  const dot = (
    <div style={{
      width: 16, height: 16, borderRadius: "50%", marginTop: 3, flexShrink: 0,
      background: tache.statut ? statutColor + "25" : "transparent",
      border: `2px solid ${statutColor}`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {tache.statut === "valide" && <Icon as={Check} size={9} color="#22c55e" strokeWidth={3.5}/>}
      {tache.statut === "reserve" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
      {tache.statut === "non_commence" && <div style={{ width: 7, height: 2, borderRadius: 1, background: "#94a3b8" }} />}
    </div>
  );

  // ── Titre + badge hérité
  const titleBlock = (
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
  );

  // ── Métadonnées (heures, avancement phasage)
  const metaBlock = (tache.heures_estimees > 0 || tache.avancement > 0) && (
    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
      {tache.heures_estimees > 0 && <span style={{ color: lotColor, fontWeight: 600 }}>{tache.heures_estimees}h estimées</span>}
      {tache.avancement > 0 && (
        <span style={{ color: tache.avancement === 100 ? "#22c55e" : T.textMuted }}>
          {tache.avancement}% au phasage
        </span>
      )}
    </div>
  );

  // ── Commentaire
  const commentBlock = showComment && (
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
          borderRadius: RADIUS.md, padding: isMobile ? "10px 12px" : "7px 10px", color: T.text,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, resize: "vertical", outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );

  // ── Photos
  const photosBlock = (showPhotos || (tache.photos || []).length > 0) && (
    <PhotosPicker
      photos={tache.photos || []}
      onChange={(nv) => onChange({ photos: nv })}
      pathPrefix={pathPrefix}
      color={lotColor}
      onLightbox={onLightbox}
    />
  );

  // ── Boutons de statut. full=true → pleine largeur (mobile), libellés longs.
  const statutButtons = (full) => (
    <div style={{ display: "flex", gap: 6, width: full ? "100%" : "auto" }}>
      {STATUTS_TACHE.map(btn => {
        const isActive = tache.statut === btn.id;
        return (
          <button key={btn.id} onClick={() => setStatut(btn.id)} style={{
            flex: full ? 1 : "none",
            padding: full ? "11px 4px" : "6px 12px",
            borderRadius: RADIUS.md, fontSize: full ? 13.5 : FONT.xs.size + 1, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", minWidth: full ? 0 : 48, whiteSpace: "nowrap",
            background: isActive ? btn.color + "22" : "transparent",
            border: `1.5px solid ${isActive ? btn.color : T.border}`,
            color: isActive ? btn.color : T.textMuted,
            transition: "all .15s",
          }}>
            {full ? btn.full : btn.label}
          </button>
        );
      })}
    </div>
  );

  // ── Raccourcis note / photo
  const toggles = (
    <div style={{ display: "flex", gap: isMobile ? 18 : 6 }}>
      <button onClick={() => setShowComment(s => !s)} style={{
        background: "transparent", border: "none", cursor: "pointer",
        fontSize: isMobile ? 13 : FONT.xs.size + 1, color: showComment ? lotColor : T.textMuted,
        fontFamily: "inherit", padding: isMobile ? "6px 2px" : "2px 4px", fontWeight: 600,
      }}>
        {showComment ? "− note" : "+ note"}
      </button>
      <button onClick={() => setShowPhotos(s => !s)} style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        background: "transparent", border: "none", cursor: "pointer",
        fontSize: isMobile ? 13 : FONT.xs.size + 1, color: showPhotos || (tache.photos || []).length > 0 ? lotColor : T.textMuted,
        fontFamily: "inherit", padding: isMobile ? "6px 2px" : "2px 4px", fontWeight: 600,
      }}>
        <Icon as={Camera} size={isMobile ? 14 : 11}/>
        photo{(tache.photos || []).length > 0 ? ` · ${(tache.photos || []).length}` : ""}
      </button>
    </div>
  );

  // ── Mise en page MOBILE : statuts en gros boutons pleine largeur, empilés.
  if (isMobile) {
    return (
      <div className="audit-tache-row" style={{
        padding: "12px 14px", borderBottom: `1px solid ${T.sectionDivider || T.border}`,
        background: isHeritee && !tache.statut ? "rgba(245,158,11,0.04)" : "transparent",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {dot}
          <div style={{ flex: 1, minWidth: 0 }}>{titleBlock}{metaBlock}</div>
        </div>
        <div style={{ marginTop: 10 }}>{statutButtons(true)}</div>
        <div style={{ marginTop: 8 }}>{toggles}</div>
        {commentBlock}
        {photosBlock}
      </div>
    );
  }

  // ── Mise en page DESKTOP : 3 colonnes (pastille / infos / boutons à droite).
  return (
    <div className="audit-tache-row" style={{
      padding: "10px 18px", borderBottom: `1px solid ${T.sectionDivider || T.border}`,
      background: isHeritee && !tache.statut ? "rgba(245,158,11,0.04)" : "transparent",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 12, alignItems: "start" }}>
        {dot}
        <div>{titleBlock}{metaBlock}{commentBlock}{photosBlock}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          {statutButtons(false)}
          {toggles}
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
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
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

// ─── EXPORT PDF (client-side, html2pdf.js) ────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function exportVisitePdf(payload) {
  const { visite, chantier, lots = [], reserves_heritees = [], derniere_visite_date } = payload;
  const audit = visite.audit || {};
  const checklist = Array.isArray(visite.checklist) ? visite.checklist : [];

  const allTaches = lots.flatMap(l => audit[l.id] || []);
  const allEval = [...allTaches, ...checklist];
  const nb_ok  = allEval.filter(t => t.statut === "valide").length;
  const nb_res = allEval.filter(t => t.statut === "reserve").length;
  const nb_af  = allEval.filter(t => t.statut === "non_commence").length;
  const nb_nd  = allEval.filter(t => !t.statut).length;
  const total  = allEval.length;

  const badge = (statut) => {
    const c = statutColorOf(statut);
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${c}22;color:${c};border:1px solid ${c}55">${esc(statutLabelOf(statut))}</span>`;
  };

  const photosHtml = (photos = []) => {
    if (!photos.length) return "";
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">` +
      photos.slice(0, 6).map(u => `<img src="${esc(u)}" crossorigin="anonymous" style="width:150px;height:112px;object-fit:cover;border-radius:6px;border:1px solid #ddd"/>`).join("") +
      `</div>`;
  };

  const tacheHtml = (t) => `
    <div style="padding:8px 0;border-bottom:1px solid #eee">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div style="font-size:13px;font-weight:700;color:#1a1f2e">${esc(t.nom)}</div>
        <div style="flex-shrink:0">${badge(t.statut)}</div>
      </div>
      ${t.commentaire ? `<div style="font-size:12px;color:#5b6a8a;font-style:italic;margin-top:3px">« ${esc(t.commentaire)} »</div>` : ""}
      ${photosHtml(t.photos)}
    </div>`;

  let body = "";

  // En-tête
  body += `
    <div style="border-bottom:3px solid #E6AE00;padding-bottom:10px;margin-bottom:18px">
      <div style="font-size:22px;font-weight:800;color:#1a1f2e">PROFERO RÉNOVATION</div>
      <div style="font-size:14px;color:#5b6a8a">Compte rendu de visite de chantier</div>
    </div>
    <div style="font-size:13px;color:#1a1f2e;margin-bottom:18px;line-height:1.7">
      <div><span style="color:#5b6a8a">Chantier : </span><strong>${esc(chantier?.nom || visite.chantier_id || "—")}</strong></div>
      <div><span style="color:#5b6a8a">Date de visite : </span><strong>${esc(fmtDate(visite.date))}</strong></div>
    </div>`;

  // Bilan global
  if (total > 0) {
    body += `
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#5b6a8a;margin-bottom:6px">BILAN GLOBAL</div>
        <div style="font-size:13px">
          <strong style="color:#1a6b3a">${nb_ok} validées</strong> &nbsp;·&nbsp;
          <strong style="color:#b05a10">${nb_res} réserves</strong> &nbsp;·&nbsp;
          <strong style="color:#5b6a8a">${nb_af} pas commencées</strong> &nbsp;·&nbsp;
          <span style="color:#999">${nb_nd} non évaluées</span>
        </div>
        <div style="font-size:11px;font-style:italic;color:#999;margin-top:4px">Sur ${total} point${total > 1 ? "s" : ""} dans la portée d'audit.</div>
      </div>`;
  }

  // Note générale
  if (visite.note_generale && visite.note_generale.trim()) {
    body += `
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#5b6a8a;border-bottom:1px solid #E6AE00;padding-bottom:4px;margin-bottom:8px">NOTE GÉNÉRALE</div>
        <div style="font-size:13px;color:#1a1f2e;white-space:pre-wrap">${esc(visite.note_generale)}</div>
      </div>`;
  }

  // Réserves héritées
  if (reserves_heritees.length > 0) {
    body += `
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#b05a10;border-bottom:1px solid #b05a10;padding-bottom:4px;margin-bottom:8px">SUIVI DES RÉSERVES — VISITE DU ${esc(fmtDate(derniere_visite_date))}</div>`;
    reserves_heritees.forEach(r => {
      const levee = r.statut_courant === "valide";
      const stillThere = r.statut_courant === "reserve";
      const txt = levee ? "✓ LEVÉE" : stillThere ? "⚠ TOUJOURS PRÉSENTE" : "à évaluer";
      const c = levee ? "#1a6b3a" : stillThere ? "#b03030" : "#999";
      body += `<div style="font-size:13px;margin-bottom:5px">– <strong>${esc(r.nom_origine)}</strong> <span style="color:#5b6a8a">(${esc(r.lot_label)})</span> — <strong style="color:${c}">${txt}</strong>${r.commentaire_origine ? `<div style="font-size:11px;font-style:italic;color:#999;margin-left:12px">"${esc(r.commentaire_origine)}"</div>` : ""}</div>`;
    });
    body += `</div>`;
  }

  // Points de vigilance
  if (checklist.length > 0) {
    body += `
      <div style="margin-bottom:6px;page-break-inside:avoid">
        <div style="font-size:15px;font-weight:800;color:#1a1f2e;border-bottom:2px solid #E6AE00;padding-bottom:4px;margin-bottom:8px">POINTS DE VIGILANCE</div>
        ${checklist.map(item => tacheHtml({ nom: item.label, statut: item.statut, commentaire: item.commentaire, photos: item.photos })).join("")}
      </div>`;
  }

  // Détail par lot → ouvrage → tâche
  lots.forEach(l => {
    const taches = audit[l.id] || [];
    if (!taches.length) return;
    const lot_ok  = taches.filter(t => t.statut === "valide").length;
    const lot_res = taches.filter(t => t.statut === "reserve").length;
    const lot_af  = taches.filter(t => t.statut === "non_commence").length;
    body += `
      <div style="margin-top:16px;page-break-inside:avoid">
        <div style="font-size:15px;font-weight:800;color:#1a1f2e;border-bottom:2px solid ${esc(l.couleur || "#E6AE00")};padding-bottom:4px;margin-bottom:8px">
          ${esc((l.label || "").toUpperCase())}
          <span style="font-size:11px;font-weight:600;color:#5b6a8a"> — ${lot_ok} validées · ${lot_res} rés · ${lot_af} à faire</span>
        </div>`;
    groupByOuvrage(taches).forEach(g => {
      body += `<div style="font-size:12px;font-weight:700;color:#5b6a8a;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 2px">${esc(g.ouvrage_libelle || "Ouvrage")}</div>`;
      g.taches.forEach(t => { body += tacheHtml(t); });
    });
    body += `</div>`;
  });

  body += `<div style="margin-top:28px;font-size:10px;font-style:italic;color:#999">Document généré automatiquement par Profero Rénovation</div>`;

  const container = document.createElement("div");
  container.style.cssText = "width:794px;padding:36px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#1a1f2e";
  container.innerHTML = body;
  document.body.appendChild(container);

  const safeName = (chantier?.nom || "visite").replace(/[^a-zA-Z0-9-_]/g, "_");
  try {
    await html2pdf().set({
      margin: [10, 0, 10, 0],
      filename: `Visite-${safeName}-${visite.date}.pdf`,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

// ─── HELPERS UI ───────────────────────────────────────────────────────────────
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

function selectStyle(T) {
  return {
    width: "100%", background: T.inputBg || T.card, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "9px 12px", color: T.text,
    fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box",
  };
}
