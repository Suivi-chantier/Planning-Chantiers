import React, { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase, getClientId } from "../supabase";
import { JOURS, getCurrentWeek, getWeekId, FONT, RADIUS, SPACING, getBranchAccent, PHASES_DEFAUT, loadPhases, calcAvancementPondere } from "../constants";
import { indexPointagesParTache, heuresEff as heuresEffShared, coutMOEff as coutMOEffShared, sumLibreEtIndirect } from "../pointages";
import { confirmPerteMassive } from "../guards";
import { Icon } from "../ui";
import {
  ClipboardList, Plus, BarChart3, GanttChartSquare, Trash2, ChevronRight, ChevronLeft as ChevronLeftIcon,
  Building2, Hammer, Clock, Euro, TrendingUp, AlertTriangle, Search, FileSpreadsheet,
  CalendarPlus, Check, GripVertical, X, ChevronDown, ChevronUp,
  Info, Unlink, Link2, SplitSquareHorizontal, HardHat, Package, CalendarCheck, Car,
} from "lucide-react";
import GanttView from "./GanttView";
import { useIsMobile } from "./Navigation";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
  for (const b of bibliotheque) {
    const s = scoreSimilarite(libelle, b.libelle);
    if (s > bestScore) { bestScore = s; best = b; }
  }
  return bestScore >= 0.35 ? { match: best, score: bestScore } : { match: null, score: 0 };
}

function toNum(val) {
  if (val === null || val === undefined || val === "") return NaN;
  if (typeof val === "number") return val;
  return parseFloat(String(val).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
}

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        let hIdx = 0;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          if (rows[i].filter(c => String(c).trim().length > 0).length >= 2) { hIdx = i; break; }
        }
        const hRow = rows[hIdx];
        let colL = -1, colH = -1, colQ = -1, colP = -1;

        hRow.forEach((cell, i) => {
          const c = normalise(String(cell));
          if (colL === -1 && (
            c.includes("libelle") || c.includes("libellé") ||
            c.includes("designation") || c.includes("désignation") ||
            c.includes("description") || c.includes("ouvrage") ||
            c.includes("poste") || c.includes("travaux") ||
            c.includes("prestation") || c.includes("article") ||
            c.includes("nature") || c.includes("intitule") ||
            c === "n°" || c === "no"
          )) colL = i;
          if (colH === -1 && (
            c.includes("heure") || c.includes("h mo") ||
            c === "mo" || c === "h" || c === "mh" ||
            c.includes("main") || c.includes("temps") ||
            c.includes("duree") || c.includes("durée") ||
            c.includes("tps") || c.includes("mano")
          )) colH = i;
          if (colQ === -1 && (
            c.includes("quantite") || c.includes("quantité") ||
            c === "qte" || c === "q" || c === "qt" ||
            c.includes("nombre") || c.includes("surface") ||
            c.includes("volume") || c.includes("m2") || c.includes("ml") ||
            c.includes("m²") || c.includes("m3") || c === "u"
          )) colQ = i;
          if (colP === -1 && (
            c.includes("total h") || c.includes("montant ht") ||
            c.includes("montant h") || c.includes("prix ht") ||
            c.includes("prix h") || c.includes("ht") ||
            c.includes("total ttc") || c.includes("montant")
          )) colP = i;
        });

        if (colP === -1) hRow.forEach((cell, i) => {
          if (colP === -1 && normalise(String(cell)) === "total") colP = i;
        });

        if (colL === -1) colL = 0;

        if (colH === -1) {
          for (let i = 1; i < Math.min(hRow.length, 15); i++) {
            if (i === colL || i === colQ || i === colP) continue;
            const vals = rows.slice(hIdx + 1).map(r => r[i]).filter(v => String(v).trim() !== "");
            if (vals.length === 0) continue;
            const numCount = vals.filter(v => !isNaN(toNum(v))).length;
            if (numCount / vals.length > 0.5) { colH = i; break; }
          }
        }

        const lignes = [];
        for (let i = hIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const lib = String(row[colL] || "").trim();
          if (lib.length < 2) continue;

          const h = colH !== -1 ? (toNum(row[colH]) || 0) : 0;

          let q = null;
          if (colQ !== -1) { const qv = toNum(row[colQ]); if (!isNaN(qv) && qv > 0) q = qv; }

          let p = null;
          if (colP !== -1) { const pv = toNum(row[colP]); if (!isNaN(pv) && pv > 0) p = pv; }

          lignes.push({ libelle: lib, heures: h, quantite: q, prix_ht: p });
        }
        resolve(lignes);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function getDateFromWeekAndDay(weekId, jourName) {
  if (!weekId || !jourName) return "";
  const parts = weekId.split('-W');
  if (parts.length !== 2) return "";
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1], 10);
  const joursList = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const dayIndex = joursList.indexOf(jourName);
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
  const d = new Date(mon);
  d.setDate(mon.getDate() + dayIndex);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── PHASES ───────────────────────────────────────────────────────────────────
// PHASES : on initialise avec les défauts pour le 1er render, puis on
// remplace au mount par les phases personnalisées depuis Supabase.
let PHASES = [...PHASES_DEFAUT];
loadPhases().then(p => { PHASES = p; });

const PHASE_KEYWORDS = {
  demolition:     ["demol","casse","depose","enlev","retrait","decap"],
  plomberie_ro:   ["per","aliment","evacu","evac","chute","colonne","nourrice","cuivre","pex","plomb","sanitaire","eau froide","eau chaude","egout","siphon","attente"],
  menuiserie:     ["porte","fenetre","baie","chassis","volet","velux","menuiser","bloc porte","dormant","huisserie","galandage","coulissant","vitrage"],
  feraillage:     ["cloison","doublage","ferail","ossature","rail","montant","carrelet","isolant","ite"],
  elec_vmc:       ["elec","tableau","cable","fil","gaine","vmc","ventil","reseau elec","passage elec","chemin de cable","conduit","goulotte"],
  placo:          ["placo","enduit","bande","joint","lissage","ratissage","platre","staff","projection","ba13","plaque"],
  peinture_sols:  ["peinture","peindre","lasure","vernis","sol","parquet","carrelage","faience","revetement","moquette","lino","dalle","chape"],
  finition_elec:  ["finition elec","appareillage","prise","luminaire","spot","tableau final","raccord elec"],
  finition_plomb: ["finition plomb","robinet","mitigeur","wc","lavabo","douche","baignoire","radiateur","raccord plomb"],
  cuisine:        ["cuisine","meuble","plan de travail","credence","evier","hotte","electromenager"],
  finitions_gen:  ["finition","nettoyage","retouche","ragre","silicone","quincaillerie","poignee","serrure","plinthe"],
};

function matchPhase(nomTache) {
  const n = normalise(nomTache || "");
  for (const [phaseId, keywords] of Object.entries(PHASE_KEYWORDS)) {
    if (keywords.some(kw => n.includes(kw))) return phaseId;
  }
  return "finitions_gen";
}

function distribuerTaches(ouvrages) {
  const plan = {};
  PHASES.forEach(p => { plan[p.id] = []; });
  ouvrages.forEach(ouvrage => {
    (ouvrage.taches || []).forEach(t => {
      const phaseId = (t.phaseId && plan[t.phaseId]) ? t.phaseId : matchPhase(t.nom);
      // Nouveau modèle : les heures vendues vivent uniquement au niveau ouvrage
      // (`ouvrage.heures_devis`). Les sous-tâches sont créées sans heures pré-
      // calculées ; la durée sera saisie manuellement à la planification semaine.
      // Le lien ouvrage_id permet au tooltip de remonter aux infos de l'ouvrage.
      plan[phaseId].push({
        id: Math.random().toString(36).slice(2),
        nom: t.nom,
        ouvrage_id: ouvrage.id || null,
        ouvrage_libelle: ouvrage.libelle,
        heures_vendues: 0,
        heures_estimees: null,
        heures_reelles: 0,
        cout_materiel: 0,
        prix_ht: null,
        ouvriers: [],
        date_prevue: "",
        avancement: 0,
      });
    });
  });
  return plan;
}

// Fusion : ajoute au plan existant les sous-tâches déclarées dans ouvrages
// qui ne sont pas encore présentes, sans toucher aux tâches existantes
// (préserve avancements, dates, heures réelles déjà saisies).
//
// Matching : par (ouvrage_id + nom) pour les nouvelles tâches, fallback
// (ouvrage_libelle + nom) pour les anciennes tâches qui n'avaient pas
// d'ouvrage_id stable. Les tâches du plan qui n'existent plus dans
// ouvrages sont CONSERVÉES (cas user qui supprime une sous-tâche mais
// veut garder le suivi de ce qui a déjà été fait).
function fusionnerPlanAvecOuvrages(planExistant, ouvrages) {
  const plan = { ...planExistant };
  // S'assurer que chaque phase a un tableau (au moins vide)
  PHASES.forEach(p => { if (!Array.isArray(plan[p.id])) plan[p.id] = []; });

  // Index des sous-tâches déjà présentes dans le plan (toutes phases)
  const dejaPresente = (ouvrageId, ouvrageLibelle, nom) => {
    const nomNorm = (nom || "").trim().toLowerCase();
    return PHASES.some(p => (plan[p.id] || []).some(t => {
      const matchNom = (t.nom || "").trim().toLowerCase() === nomNorm;
      if (!matchNom) return false;
      if (ouvrageId && t.ouvrage_id) return t.ouvrage_id === ouvrageId;
      return (t.ouvrage_libelle || "") === (ouvrageLibelle || "");
    }));
  };

  ouvrages.forEach(ouvrage => {
    (ouvrage.taches || []).forEach(t => {
      if (!t.nom) return;
      if (dejaPresente(ouvrage.id, ouvrage.libelle, t.nom)) return;
      const phaseId = (t.phaseId && plan[t.phaseId]) ? t.phaseId : matchPhase(t.nom);
      if (!plan[phaseId]) plan[phaseId] = [];
      plan[phaseId].push({
        id: Math.random().toString(36).slice(2),
        nom: t.nom,
        ouvrage_id: ouvrage.id || null,
        ouvrage_libelle: ouvrage.libelle,
        heures_vendues: 0,
        heures_estimees: null,
        heures_reelles: 0,
        cout_materiel: 0,
        prix_ht: null,
        ouvriers: [],
        date_prevue: "",
        avancement: 0,
      });
    });
  });
  return plan;
}

// ─── MODALE IMPORT EXCEL ──────────────────────────────────────────────────────
function ModaleImportExcel({ T, bibliotheque, onImporter, onFermer }) {
  const [etape, setEtape] = useState("upload");
  const [parsing, setParsing] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [lignesBrutes, setLignesBrutes] = useState([]);
  const [ouvragesDetectes, setOuvragesDetectes] = useState([]);
  const fileRef = useRef();
  const BLEU = "#5b9cf6";
  const acc = getBranchAccent("renovation");

  async function handleFile(file) {
    if (!file) return;
    setParsing(true); setErreur(null);
    try {
      const parsed = await parseExcel(file);
      if (parsed.length === 0) { setErreur("Aucune ligne valide détectée."); setParsing(false); return; }
      setLignesBrutes(parsed);

      const groupes = {};
      parsed.forEach((ligne, idx) => {
        const { match, score } = matcherOuvrage(ligne.libelle, bibliotheque);
        const cle = match ? match.id : `_libre_${idx}`;
        if (!groupes[cle]) {
          groupes[cle] = {
            id: Math.random().toString(36).slice(2),
            match,
            score,
            libelle_devis_original: ligne.libelle,
            libelle_personnalise: match ? match.libelle : ligne.libelle,
            lignes: [],
            selectionne: true,
            mode: "groupe",
          };
        }
        groupes[cle].lignes.push({ ...ligne, idx, selectionne: true });
      });

      setOuvragesDetectes(Object.values(groupes));
      setEtape("detection");
    } catch (err) { setErreur("Erreur de lecture : " + err.message); }
    setParsing(false);
  }

  function totalHeures(g) {
    return g.lignes.filter(l => l.selectionne !== false).reduce((s, l) => s + (parseFloat(l.heures) || 0), 0);
  }
  function totalPrix(g) {
    return g.lignes.filter(l => l.selectionne !== false).reduce((s, l) => s + (parseFloat(l.prix_ht) || 0), 0);
  }

  function updateOuvrage(id, updates) {
    setOuvragesDetectes(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  }
  function updateLigne(ouvrageId, ligneIdx, updates) {
    setOuvragesDetectes(prev => prev.map(o => {
      if (o.id !== ouvrageId) return o;
      const lignes = o.lignes.map((l, i) => i === ligneIdx ? { ...l, ...updates } : l);
      return { ...o, lignes };
    }));
  }
  function separerLignes(ouvrageId) {
    setOuvragesDetectes(prev => {
      const idx = prev.findIndex(o => o.id === ouvrageId);
      if (idx === -1) return prev;
      const groupe = prev[idx];
      const nouveaux = groupe.lignes.map((l, i) => ({
        id: Math.random().toString(36).slice(2),
        match: groupe.match,
        score: groupe.score,
        libelle_devis_original: l.libelle,
        libelle_personnalise: l.libelle,
        lignes: [{ ...l, selectionne: true }],
        selectionne: true,
        mode: "separe",
      }));
      const next = [...prev];
      next.splice(idx, 1, ...nouveaux);
      return next;
    });
  }
  function fusionnerSelection() {
    const sel = ouvragesDetectes.filter(o => o.selectionne);
    if (sel.length < 2) return;
    const premier = sel[0];
    const toutesLignes = sel.flatMap(o => o.lignes);
    const fusionne = {
      ...premier,
      id: Math.random().toString(36).slice(2),
      lignes: toutesLignes,
      libelle_personnalise: premier.libelle_personnalise,
      mode: "groupe",
    };
    setOuvragesDetectes(prev => {
      const ids = new Set(sel.map(o => o.id));
      return [fusionne, ...prev.filter(o => !ids.has(o.id))];
    });
  }

  function construireImport() {
    const resultat = [];
    for (const g of ouvragesDetectes) {
      if (!g.selectionne) continue;
      const lignesActives = g.lignes.filter(l => l.selectionne !== false);
      if (lignesActives.length === 0) continue;
      const hTotal = lignesActives.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0);
      const pTotal = lignesActives.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0), 0);
      const qTotal = lignesActives.reduce((s, l) => s + (parseFloat(l.quantite) || 0), 0) || null;
      resultat.push({
        libelle_devis: g.libelle_devis_original,
        libelle: g.libelle_personnalise,
        match: g.match,
        heures: hTotal,
        quantite: qTotal,
        prix_ht: pTotal > 0 ? pTotal : null,
      });
    }
    return resultat;
  }

  const nbSel = ouvragesDetectes.filter(o => o.selectionne).length;
  const nbMatch = ouvragesDetectes.filter(o => o.match && o.selectionne).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }} onClick={onFermer}>
      <div style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 800, maxHeight: "90vh", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.sectionDivider}`, background: T.surface, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
              background: acc.bg10, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon as={etape === "upload" ? FileSpreadsheet : Search} size={18}/>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>
                {etape === "upload" && "Importer un devis Excel"}
                {etape === "detection" && "Ouvrages détectés"}
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
                {etape === "upload" && "Glisse ou sélectionne ton fichier .xlsx / .xls"}
                {etape === "detection" && `${ouvragesDetectes.length} ouvrage${ouvragesDetectes.length > 1 ? "s" : ""} · ${nbMatch} match${nbMatch > 1 ? "s" : ""} bibliothèque`}
              </div>
            </div>
          </div>
          <button onClick={onFermer} title="Fermer" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", color: T.textMuted,
            cursor: "pointer", padding: 4,
          }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        <div style={{ display: "flex", background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {["upload", "detection"].map((s, i) => {
            const labels = ["Upload fichier", "Personnalisation"];
            const active = etape === s;
            const done = (s === "upload" && etape === "detection");
            return (
              <div key={s} style={{
                flex: 1, padding: "9px 16px", textAlign: "center",
                fontSize: FONT.xs.size + 1, fontWeight: 700,
                color: active ? acc.accent : done ? "#22c55e" : T.textMuted,
                borderBottom: active ? `2px solid ${acc.accent}` : done ? "2px solid #22c55e" : "2px solid transparent",
                transition: "all .2s",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                {done && <Icon as={Check} size={12}/>}
                <span style={{ opacity: .6 }}>{i + 1}</span>
                <span>·</span>
                {labels[i]}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {etape === "upload" && (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                style={{ border: `2px dashed ${acc.accent}55`, borderRadius: RADIUS.xl, padding: "44px 24px",
                  textAlign: "center", cursor: "pointer", background: `${acc.accent}08`, transition: "border .15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = acc.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = `${acc.accent}55`}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: RADIUS.lg,
                  background: acc.bg10, color: acc.accent,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12,
                }}>
                  <Icon as={FileSpreadsheet} size={28} strokeWidth={1.5}/>
                </div>
                <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                  Glisse ton fichier ici ou clique pour parcourir
                </div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Formats acceptés : .xlsx, .xls</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
              </div>
              {parsing && (
                <div style={{ textAlign: "center", padding: 20, color: T.textMuted, fontSize: FONT.sm.size,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                  </svg>
                  Analyse du fichier…
                </div>
              )}
              {erreur && (
                <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(224,92,92,0.1)",
                  border: "1px solid rgba(224,92,92,0.3)", borderRadius: RADIUS.md, color: "#e15a5a",
                  fontSize: FONT.sm.size, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon as={AlertTriangle} size={14}/>
                  {erreur}
                </div>
              )}
              <div style={{ marginTop: 18, padding: "14px 16px", background: T.card, borderRadius: RADIUS.lg, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Colonnes détectées automatiquement</div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.9 }}>
                  • <strong style={{ color: T.text }}>Libellé / désignation</strong> — nom de l'ouvrage <span style={{ color: acc.accent, fontWeight: 700 }}>obligatoire</span><br />
                  • <strong style={{ color: T.text }}>Heures MO</strong> — <span style={{ color: "#22c55e", fontWeight: 600 }}>optionnel</span> — si absent, tu les saisis dans l'étape suivante<br />
                  • <strong style={{ color: T.text }}>Quantité</strong> — <span style={{ color: "#22c55e", fontWeight: 600 }}>optionnel</span> — pour calcul cadence automatique<br />
                  • <strong style={{ color: T.text }}>Total HT</strong> — <span style={{ color: "#22c55e", fontWeight: 600 }}>optionnel</span> — montant de la ligne
                </div>
              </div>
            </>
          )}

          {etape === "detection" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#50c878", display: "inline-block" }} /> Match bibliothèque
                  </span>
                  <span style={{ fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.border, display: "inline-block" }} /> Libre (pas de match)
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  {[
                    ["Tout sélectionner", () => setOuvragesDetectes(p => p.map(o => ({ ...o, selectionne: true })))],
                    ["Tout désélectionner", () => setOuvragesDetectes(p => p.map(o => ({ ...o, selectionne: false })))],
                    ["Correspondances seules", () => setOuvragesDetectes(p => p.map(o => ({ ...o, selectionne: !!o.match })))],
                  ].map(([label, fn]) => (
                    <button key={label} onClick={fn} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>{label}</button>
                  ))}
                </div>
              </div>

              <div style={{ padding: "10px 14px", background: T.card, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, marginBottom: 14, fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.7, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Icon as={Info} size={14} color={acc.accent} style={{ marginTop: 2, flexShrink: 0 }}/>
                <span><strong style={{ color: T.text }}>Personnalise chaque ouvrage</strong> : renomme-le pour le contexte du chantier, ajuste les heures, sépare les lignes groupées ou fusionne des lignes similaires.</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ouvragesDetectes.map((ouvrage) => {
                  const hT = totalHeures(ouvrage);
                  const pT = totalPrix(ouvrage);
                  const cadence = parseFloat(ouvrage.match?.cadence) || null;
                  const unite = ouvrage.match?.unite || "";
                  const q = ouvrage.lignes.filter(l => l.selectionne !== false).reduce((s, l) => s + (parseFloat(l.quantite) || 0), 0) || null;
                  const hEstimees = cadence && q ? parseFloat((cadence * q).toFixed(2)) : null;
                  const multiLigne = ouvrage.lignes.length > 1;

                  return (
                    <div
                      key={ouvrage.id}
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${ouvrage.selectionne ? (ouvrage.match ? "rgba(80,200,120,0.4)" : T.border) : T.border}`,
                        background: ouvrage.selectionne ? (ouvrage.match ? "rgba(80,200,120,0.05)" : T.card) : `${T.card}55`,
                        opacity: ouvrage.selectionne ? 1 : 0.45,
                        overflow: "hidden",
                        transition: "all .15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px" }}>
                        <input
                          type="checkbox" checked={ouvrage.selectionne}
                          onChange={() => updateOuvrage(ouvrage.id, { selectionne: !ouvrage.selectionne })}
                          style={{ width: 16, height: 16, accentColor: T.accent, cursor: "pointer", flexShrink: 0, marginTop: 2 }}
                        />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: ouvrage.match ? "#50c878" : T.border, flexShrink: 0, marginTop: 4 }} />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Nom dans le plan de travail</div>
                              <input
                                value={ouvrage.libelle_personnalise}
                                onChange={e => updateOuvrage(ouvrage.id, { libelle_personnalise: e.target.value })}
                                style={{
                                  width: "100%", padding: "6px 10px", borderRadius: 7,
                                  border: `1.5px solid ${T.accent}66`,
                                  background: T.inputBg, color: T.text,
                                  fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none",
                                }}
                              />
                            </div>
                          </div>

                          {ouvrage.match
                            ? <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, color: "#50c878" }}>
                                  → {ouvrage.match.libelle}
                                  {cadence ? ` · cadence ${cadence}h/${unite}` : " · pas de cadence"}
                                  {ouvrage.match.sous_taches?.length > 0 && ` · ${ouvrage.match.sous_taches.length} sous-tâches`}
                                </span>
                                <button
                                  onClick={() => updateOuvrage(ouvrage.id, { match: null })}
                                  title="Délier de la bibliothèque"
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    fontSize: FONT.xs.size, padding: "2px 7px", borderRadius: RADIUS.sm,
                                    border: "1px solid rgba(224,92,92,0.3)", background: "transparent",
                                    color: "#e15a5a", cursor: "pointer", fontFamily: "inherit",
                                  }}>
                                  <Icon as={Unlink} size={9}/>
                                  délier
                                </button>
                              </div>
                            : <div style={{ marginBottom: 6 }}>
                                {ouvrage._showLier
                                  ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>Lier à :</span>
                                      <select
                                        autoFocus
                                        defaultValue=""
                                        onChange={e => {
                                          const bibl = bibliotheque.find(b => b.id === e.target.value);
                                          if (bibl) {
                                            const nomInchange = ouvrage.libelle_personnalise === ouvrage.libelle_devis_original;
                                            updateOuvrage(ouvrage.id, {
                                              match: bibl,
                                              _showLier: false,
                                              libelle_personnalise: nomInchange ? bibl.libelle : ouvrage.libelle_personnalise,
                                            });
                                          } else {
                                            updateOuvrage(ouvrage.id, { _showLier: false });
                                          }
                                        }}
                                        style={{
                                          flex: 1, padding: "5px 8px", borderRadius: 7,
                                          border: `1.5px solid ${T.accent}88`,
                                          background: T.inputBg, color: T.text,
                                          fontFamily: "inherit", fontSize: 12, outline: "none", cursor: "pointer",
                                        }}
                                      >
                                        <option value="">— Choisir un ouvrage bibliothèque —</option>
                                        {bibliotheque.map(b => (
                                          <option key={b.id} value={b.id}>
                                            {b.libelle} ({b.unite}){b.cadence ? ` · ${b.cadence}h/${b.unite}` : ""}
                                            {(b.sous_taches || []).length > 0 ? ` · ${b.sous_taches.length} tâches` : ""}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => updateOuvrage(ouvrage.id, { _showLier: false })}
                                        style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}
                                      >Annuler</button>
                                    </div>
                                  : <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>Aucune correspondance</span>
                                      <button
                                        onClick={() => updateOuvrage(ouvrage.id, { _showLier: true })}
                                        style={{
                                          display: "inline-flex", alignItems: "center", gap: 4,
                                          fontSize: FONT.xs.size + 1, padding: "3px 10px", borderRadius: RADIUS.sm,
                                          border: `1px solid ${acc.accent}66`,
                                          background: `${acc.accent}12`, color: acc.accent,
                                          fontFamily: "inherit", fontWeight: 700, cursor: "pointer",
                                        }}>
                                        <Icon as={Link2} size={11}/>
                                        Lier à la bibliothèque
                                      </button>
                                    </div>
                                }
                              </div>
                          }

                          <div style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic" }}>
                            Devis : "{ouvrage.libelle_devis_original}"
                            {multiLigne && <span style={{ marginLeft: 8, color: BLEU, fontWeight: 700, fontStyle: "normal" }}>{ouvrage.lignes.length} lignes regroupées</span>}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 11, color: T.textMuted }}>H. vendues</span>
                            <input
                              type="number" min="0" step="0.5"
                              value={hT || ""}
                              placeholder="0"
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                const lignesActives = ouvrage.lignes.filter(l => l.selectionne !== false);
                                if (lignesActives.length === 1) {
                                  updateLigne(ouvrage.id, ouvrage.lignes.indexOf(lignesActives[0]), { heures: val });
                                } else {
                                  const firstIdx = ouvrage.lignes.findIndex(l => l.selectionne !== false);
                                  if (firstIdx !== -1) updateLigne(ouvrage.id, firstIdx, { heures: val });
                                }
                              }}
                              style={{
                                width: 64, padding: "4px 6px", borderRadius: 6, textAlign: "center",
                                border: `1.5px solid ${hT === 0 ? "#f5a623" : T.accent}`,
                                background: hT === 0 ? "rgba(245,166,35,0.1)" : "transparent",
                                color: hT === 0 ? "#f5a623" : T.accent,
                                fontFamily: "inherit", fontSize: 14, fontWeight: 800, outline: "none",
                              }}
                            />
                            <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                            {hT === 0 && <span style={{ fontSize: 10, color: "#f5a623", fontWeight: 700 }}>← saisir</span>}
                          </div>
                          {hEstimees && <span style={{ fontSize: 11, fontWeight: 700, color: BLEU }}>≈ {hEstimees}h estimées</span>}
                          {pT > 0 && <span style={{ fontSize: 11, color: T.textMuted }}>{pT.toFixed(0)} €</span>}
                        </div>
                      </div>

                      {ouvrage.match && (ouvrage.match.sous_taches || []).length > 0 && ouvrage.selectionne && (
                        <div style={{ margin: "0 14px 10px 38px", padding: "8px 12px", background: "rgba(91,156,246,0.08)", border: "1px solid rgba(91,156,246,0.2)", borderRadius: 8 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, color: BLEU, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                            <Icon as={ClipboardList} size={11}/>
                            Sous-tâches générées depuis la bibliothèque
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {(ouvrage.match.sous_taches || []).map((st, i) => {
                              const ph = PHASES.find(p => p.id === st.phaseId);
                              const hST = parseFloat(((hT * st.ratio) / 100).toFixed(1));
                              return (
                                <span key={i} style={{
                                  fontSize: 11, padding: "3px 9px", borderRadius: 5,
                                  background: ph ? `${ph.couleur}1A` : "rgba(91,156,246,0.12)",
                                  color: ph ? ph.couleur : BLEU,
                                  border: `1px solid ${ph ? ph.couleur + "44" : "rgba(91,156,246,0.3)"}`,
                                  fontWeight: 600,
                                }}>
                                  {ph?.emoji} {st.nom || `Tâche ${i + 1}`} · {st.ratio}% · {hST}h
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {multiLigne && ouvrage.selectionne && (
                        <div style={{ margin: "0 14px 10px 38px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Lignes du devis ({ouvrage.lignes.length})</div>
                            <button
                              onClick={() => separerLignes(ouvrage.id)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "3px 10px", borderRadius: RADIUS.sm,
                                border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted,
                                fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer",
                              }}>
                              <Icon as={SplitSquareHorizontal} size={11}/>
                              Séparer en {ouvrage.lignes.length} ouvrages
                            </button>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {ouvrage.lignes.map((ligne, li) => (
                              <div key={li} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: T.card, borderRadius: 6, border: `1px solid ${T.border}` }}>
                                <input type="checkbox" checked={ligne.selectionne !== false} onChange={() => updateLigne(ouvrage.id, li, { selectionne: !ligne.selectionne })} style={{ width: 13, height: 13, accentColor: T.accent, cursor: "pointer", flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: 12, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ligne.libelle}</span>
                                <input
                                  type="number" min="0" step="0.5"
                                  value={ligne.heures}
                                  onChange={e => updateLigne(ouvrage.id, li, { heures: parseFloat(e.target.value) || 0 })}
                                  style={{ width: 56, padding: "3px 6px", borderRadius: 5, border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 12, fontWeight: 700, textAlign: "center", outline: "none" }}
                                />
                                <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                                {ligne.prix_ht > 0 && <span style={{ fontSize: 11, color: T.textMuted }}>{ligne.prix_ht.toFixed(0)}€</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {etape === "detection" && (
          <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface, flexShrink: 0, gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: FONT.sm.size, color: T.textMuted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span><strong style={{ color: T.text, fontWeight: 700 }}>{nbSel}</strong> ouvrage{nbSel > 1 ? "s" : ""} sélectionné{nbSel > 1 ? "s" : ""}</span>
              {nbMatch > 0 && <span>· <strong style={{ color: "#22c55e", fontWeight: 700 }}>{nbMatch}</strong> avec sous-tâches auto</span>}
              {(() => {
                const nbSansH = ouvragesDetectes.filter(o => o.selectionne && o.lignes.filter(l => l.selectionne !== false).reduce((s, l) => s + (parseFloat(l.heures) || 0), 0) === 0).length;
                return nbSansH > 0
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>·
                      <Icon as={AlertTriangle} size={11} color="#f5a623"/>
                      <span style={{ color: "#f5a623", fontWeight: 700 }}>{nbSansH} sans heures</span>
                    </span>
                  : null;
              })()}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setEtape("upload"); setOuvragesDetectes([]); setLignesBrutes([]); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "9px 16px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted,
                  fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
                }}>
                <Icon as={ChevronLeftIcon} size={12}/>
                Retour
              </button>
              <button
                onClick={() => onImporter(construireImport())}
                disabled={nbSel === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 20px", borderRadius: RADIUS.md, border: "none",
                  background: nbSel > 0 ? acc.accent : T.border, color: acc.onAccent,
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                  cursor: nbSel > 0 ? "pointer" : "default", opacity: nbSel > 0 ? 1 : .6,
                }}>
                <Icon as={Check} size={13}/>
                Importer {nbSel} ouvrage{nbSel > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OUVRIERS SELECT ──────────────────────────────────────────────────────────
function OuvriersSelect({ ouvriers, selected, onChange, T, stopDrag }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef();
  const triggerRef = useRef();

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleToggle(e) {
    e.stopPropagation();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setOpenUp(window.innerHeight - rect.bottom < ouvriers.length * 32 + 20);
    }
    setOpen(o => !o);
  }

  const selectedList = selected || [];
  const dropdownPos = () => {
    if (!triggerRef.current) return { top: 0, left: 0 };
    const rect = triggerRef.current.getBoundingClientRect();
    if (openUp) return { bottom: window.innerHeight - rect.top + 4, left: rect.left };
    return { top: rect.bottom + 4, left: rect.left };
  };

  return (
    <div ref={ref} style={{ position: "relative" }} onPointerDown={stopDrag}>
      <div ref={triggerRef} onClick={handleToggle} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 3, minHeight: 30, padding: "3px 6px", borderRadius: 6, border: `1px solid ${open ? T.accent : T.border}`, background: T.inputBg, cursor: "pointer", transition: "border-color .15s" }}>
        {selectedList.length === 0
          ? <span style={{ fontSize: 11, color: T.textMuted, userSelect: "none" }}>&#8212;</span>
          : selectedList.map(o => <span key={o} style={{ fontSize: 10, fontWeight: 700, background: `${T.accent}25`, color: T.accent, borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}>{o}</span>)
        }
        <span style={{ fontSize: 9, color: T.textMuted, marginLeft: "auto", paddingLeft: 2, userSelect: "none" }}>{open ? "▴" : "▾"}</span>
      </div>
      {open && (
        <div style={{ position: "fixed", zIndex: 9999, background: T.surface, border: `1px solid ${T.accent}55`, borderRadius: 10, padding: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 160, maxWidth: 220, display: "flex", flexDirection: "column", gap: 2, ...dropdownPos() }}>
          {ouvriers.map(o => {
            const sel = selectedList.includes(o);
            return (
              <div key={o} onClick={e => { e.stopPropagation(); onChange(sel ? selectedList.filter(x => x !== o) : [...selectedList, o]); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 7, cursor: "pointer", background: sel ? `${T.accent}18` : "transparent", transition: "background .1s" }} onMouseEnter={e => { if (!sel) e.currentTarget.style.background = `${T.accent}0D`; }} onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `2px solid ${sel ? T.accent : T.border}`, background: sel ? T.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .1s" }}>{sel && <span style={{ fontSize: 9, color: "#111", fontWeight: 900, lineHeight: 1 }}>✓</span>}</div>
                <span style={{ fontSize: 13, color: T.text, fontWeight: sel ? 700 : 400 }}>{o}</span>
              </div>
            );
          })}
          {selectedList.length > 0 && (
            <><div style={{ height: 1, background: T.border, margin: "4px 0" }} /><div onClick={e => { e.stopPropagation(); onChange([]); setOpen(false); }} style={{ padding: "5px 10px", fontSize: 11, color: "#e05c5c", cursor: "pointer", borderRadius: 6, textAlign: "center" }}>Effacer</div></>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MODALE AJOUT MATÉRIAU PRÉVISIONNEL (PAR PHASE) ──────────────────────────
function ModaleAjoutMateriauPhase({ phaseId, materiauxBibl, fournisseursBibl, onClose, onAjouter, T, accent }) {
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState("");
  const [quantite, setQuantite] = useState("1");
  const [prixHt, setPrixHt] = useState("");
  const [fournisseurId, setFournisseurId] = useState("");
  const [fournisseurNom, setFournisseurNom] = useState("");

  const sel = materiauxBibl.find(m => m.id === selId) || null;

  // Préremplissage prix + fournisseur quand on sélectionne un matériau
  useEffect(() => {
    if (!sel) return;
    setPrixHt(sel.prix_unitaire != null ? String(sel.prix_unitaire) : "");
    if (sel.fournisseur_id) {
      const f = fournisseursBibl.find(x => x.id === sel.fournisseur_id);
      setFournisseurId(sel.fournisseur_id);
      setFournisseurNom(f ? f.nom : (sel.fournisseur || ""));
    } else {
      setFournisseurId("");
      setFournisseurNom(sel.fournisseur || "");
    }
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtres = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return materiauxBibl.slice(0, 50);
    return materiauxBibl.filter(m =>
      (m.nom || "").toLowerCase().includes(q)
      || (m.reference || "").toLowerCase().includes(q)
      || (m.fournisseur || "").toLowerCase().includes(q)
    ).slice(0, 50);
  })();

  const peutAjouter = sel && parseFloat(quantite) > 0;

  const handleAjouter = () => {
    if (!peutAjouter) return;
    onAjouter({
      id:               (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)),
      materiau_id:      sel.id,
      libelle:          sel.nom,
      unite:            sel.unite || "U",
      prix_ht:          parseFloat(prixHt) || 0,
      quantite:         parseFloat(quantite) || 0,
      fournisseur_id:   fournisseurId || null,
      fournisseur_nom:  fournisseurNom || null,
      date_ajout:       new Date().toISOString(),
    });
  };

  const inp = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, padding: "8px 11px", color: T.text,
    fontFamily: "inherit", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 620, maxHeight: "88vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.sectionDivider || T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: accent + "22", color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={Package} size={16}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Ajouter un matériau</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>Matériau prévisionnel pour la phase</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 6, display: "flex" }}>
            <Icon as={X} size={16}/>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Rechercher un matériau</label>
            <div style={{ position: "relative" }}>
              <Icon as={Search} size={12} color={T.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom, référence, fournisseur…"
                style={{ ...inp, paddingLeft: 30 }} autoFocus/>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Matériau</label>
            {materiauxBibl.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic", padding: "6px 0" }}>
                Bibliothèque matériaux vide. Ajoute des matériaux dans la page Bibliothèque pour pouvoir les sélectionner ici.
              </div>
            ) : (
              <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8, background: T.card }}>
                {filtres.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 12, color: T.textMuted, fontStyle: "italic", textAlign: "center" }}>Aucun matériau ne correspond.</div>
                ) : filtres.map(m => {
                  const isSel = m.id === selId;
                  return (
                    <button key={m.id} onClick={() => setSelId(m.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "8px 10px", background: isSel ? accent + "22" : "transparent",
                      border: "none", borderBottom: `1px solid ${T.sectionDivider || T.border}`,
                      cursor: "pointer", textAlign: "left", color: T.text, fontFamily: "inherit",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nom}</div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {m.reference && <span style={{ fontFamily: "monospace" }}>{m.reference}</span>}
                          {m.fournisseur && <span>· {m.fournisseur}</span>}
                          {m.unite && <span>· /{m.unite}</span>}
                        </div>
                      </div>
                      {m.prix_unitaire != null && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#22c55e", flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>
                          {parseFloat(m.prix_unitaire).toFixed(2)} €
                        </div>
                      )}
                      {isSel && <Icon as={Check} size={13} color={accent}/>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {sel && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Quantité ({sel.unite || "U"})</label>
                <input type="number" min="0" step="0.01" value={quantite} onChange={e => setQuantite(e.target.value)} style={{ ...inp, fontWeight: 700 }}/>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Prix HT unitaire (€)</label>
                <input type="number" min="0" step="0.01" value={prixHt} onChange={e => setPrixHt(e.target.value)} style={{ ...inp, color: "#22c55e", fontWeight: 700 }}/>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Fournisseur</label>
                {fournisseursBibl.length > 0 ? (
                  <select value={fournisseurId} onChange={e => {
                    const id = e.target.value || "";
                    setFournisseurId(id);
                    const f = id ? fournisseursBibl.find(x => x.id === id) : null;
                    setFournisseurNom(f ? f.nom : (sel.fournisseur || ""));
                  }} style={inp}>
                    <option value="">— {fournisseurNom ? `Texte : « ${fournisseurNom} »` : "Aucun"} —</option>
                    {fournisseursBibl.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                  </select>
                ) : (
                  <input value={fournisseurNom} onChange={e => setFournisseurNom(e.target.value)} placeholder="Nom du fournisseur" style={inp}/>
                )}
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "8px 10px", background: T.card, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Total ligne</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: T.accent, fontFamily: "'DM Mono',monospace" }}>
                  {((parseFloat(prixHt) || 0) * (parseFloat(quantite) || 0)).toFixed(2)} € HT
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.sectionDivider || T.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: RADIUS.md, padding: "9px 16px", color: T.textSub,
            fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={handleAjouter} disabled={!peutAjouter} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: peutAjouter ? accent : T.border, color: peutAjouter ? "#fff" : T.textMuted,
            border: "none", borderRadius: RADIUS.md, padding: "9px 18px",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            cursor: peutAjouter ? "pointer" : "not-allowed",
          }}>
            <Icon as={Check} size={13}/>
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PLAN TRAVAUX ─────────────────────────────────────────────────────────────
function PlanTravaux({ phasage, ouvrages, T, ouvriers, tauxHoraires, onBack, onSavePlan }) {
  const BLEU = "#5b9cf6";
  const planAcc = getBranchAccent("renovation");
  const isMobile = useIsMobile();

  const initPlan = () => {
    if (phasage.plan_travaux && Object.keys(phasage.plan_travaux).filter(k => k !== 'meta').length > 0) {
      return phasage.plan_travaux;
    }
    return distribuerTaches(ouvrages);
  };

  const [plan, setPlan] = useState(initPlan);
  const [showGantt, setShowGantt] = useState(false);
  const [prixVendu, setPrixVendu] = useState(() => {
    if (phasage.plan_travaux?.meta?.prix_vendu) return phasage.plan_travaux.meta.prix_vendu;
    const totalHT = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    return totalHT > 0 ? parseFloat(totalHT.toFixed(2)) : 0;
  });
  // ── Suivi direction (Dashboard Analyse) : marge vendue cible, seuil prime, prime
  //    Stockés dans plan_travaux.meta. Défauts conformes au cahier gérant.
  const [margeVendueCible, setMargeVendueCible] = useState(() =>
    phasage.plan_travaux?.meta?.marge_vendue_cible ?? 30);
  const [seuilPrime, setSeuilPrime] = useState(() =>
    phasage.plan_travaux?.meta?.seuil_prime ?? 25);
  const [primeChantier, setPrimeChantier] = useState(() =>
    phasage.plan_travaux?.meta?.prime ?? 300);
  const [expandedPhases, setExpandedPhases] = useState(() => PHASES.reduce((acc, p) => ({ ...acc, [p.id]: true }), {}));
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  // ─── Collab temps réel : merge par id sur le plan ─────────────────────────
  // dirtyTachesRef = ids de tâches modifiées localement depuis la dernière save
  // (transverse à toutes les phases). dirtyMetaRef = champs scalaires meta
  // modifiés localement (prix_vendu, marge_vendue_cible, seuil_prime, prime).
  // lastSyncedSnapshotRef = JSON du plan + meta synchronisé, pour court-circuiter
  // l'autosave quand un merge n'a rien changé.
  const dirtyTachesRef = useRef(new Set());
  const dirtyMetaRef   = useRef(new Set());
  const lastSyncedSnapshotRef = useRef("");
  const markTacheDirty = (id) => { if (id) dirtyTachesRef.current.add(id); };
  const markMetaDirty  = (key) => { dirtyMetaRef.current.add(key); };
  const [ajoutPhase, setAjoutPhase] = useState(null);
  const [ajoutForm, setAjoutForm] = useState({ nom: "", heures_vendues: "", heures_estimees: "", ouvriers: [], date_prevue: "" });
  const dragItem = useRef(null);
  const dragOver = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [planifierTask, setPlanifierTask] = useState(null);
  const [planifierWeek, setPlanifierWeek] = useState("");
  const [planifierJour, setPlanifierJour] = useState("Lundi");
  // Durée saisie manuellement au moment d'envoyer la sous-tâche dans le planning
  // semaine. Pré-rempli avec heures_vendues si existant (compat legacy), sinon vide.
  const [planifierDuree, setPlanifierDuree] = useState("");
  const [isPlanningSaving, setIsPlanningSaving] = useState(false);
  // Commandes liées à ce phasage (pour calcul coût mat par phase + modale)
  const [commandesPhasage, setCommandesPhasage] = useState([]);
  const [showPhaseCmds, setShowPhaseCmds] = useState(null); // ID de la phase ouverte dans la modale
  useEffect(() => {
    if (!phasage?.chantier_id) return;
    // Nouveau modèle : coût matériel = somme des commande_lignes du chantier.
    // On capte ainsi aussi les saisies mobiles (qui portent chantier_id, et
    // parfois phase_id). On remappe vers la même forme que l'ancien jeu de
    // données pour que le calcul de coût et la modale restent inchangés.
    supabase.from("commande_lignes")
      .select("id, libelle, quantite, prix_total, prix_unitaire, prix_verrouille, phase_id, commande:commandes(fournisseur_nom, statut_facturation, notes)")
      .eq("chantier_id", phasage.chantier_id)
      .then(({ data, error }) => {
        if (error) { setCommandesPhasage([]); return; }
        const mapped = (data || []).map(l => ({
          id:          l.id,
          article:     l.libelle || "",
          fournisseur: l.commande?.fournisseur_nom || "",
          quantite:    l.quantite != null ? String(l.quantite) : "",
          prix_ht:     l.prix_total != null ? l.prix_total
                        : (l.prix_unitaire != null && l.quantite != null ? l.prix_unitaire * l.quantite : null),
          statut:      (l.prix_verrouille || l.commande?.statut_facturation === "facture") ? "retire" : "commande",
          phase_id:    l.phase_id || "",
          notes:       l.commande?.notes || "",
        }));
        setCommandesPhasage(mapped);
      });
  }, [phasage?.chantier_id]);

  // ─── P8 : registre de pointage ──────────────────────────────────────────────
  // Heures réelles + coût MO sont désormais DÉRIVÉS du registre `pointages`
  // (table créée au P2, alimentée par la validation des rapports au P3).
  // Repli : si une tâche n'a aucun pointage (legacy ou pré-bascule), on retombe
  // sur l'ancien calcul heures_reelles × taux[ouvriers[0]] le temps de la migration P9.
  const [pointages, setPointages] = useState([]);
  const [rapportsEnAttente, setRapportsEnAttente] = useState([]);
  useEffect(() => {
    if (!phasage?.chantier_id) return;
    supabase.from("pointages").select("*").eq("chantier_id", phasage.chantier_id)
      .then(({ data, error }) => {
        if (error?.code === "42P01") setPointages([]); // table absente (P2 non joué)
        else setPointages(data || []);
      });
    // Sous-total "non validé" : on récupère les rapports en attente du chantier
    // pour afficher un complément informatif côté bandeau coût/marge.
    supabase.from("rapports")
      .select("id,ouvrier,date_rapport,taches,heures_indirectes,statut")
      .eq("chantier_id", phasage.chantier_id)
      .neq("statut", "valide")
      .then(({ data, error }) => {
        if (error) { setRapportsEnAttente([]); return; }
        setRapportsEnAttente(data || []);
      });
  }, [phasage?.chantier_id]);

  // Index pointages "tâche" par tache_id. Les pointages indirects sont mis à
  // part : ils n'appartiennent à aucune tâche du plan mais comptent dans le
  // coût MO du chantier.
  const pointagesParTache = useMemo(() => {
    const m = {};
    pointages.forEach(p => {
      if (p.type_pointage === "indirect") return;
      if (!p.tache_id) return; // tâche libre : pas d'imputation au plan
      const k = String(p.tache_id);
      if (!m[k]) m[k] = [];
      m[k].push(p);
    });
    return m;
  }, [pointages]);

  // Pointages "indirect" séparés en deux catégories :
  // - Trajets (motif_indirect = "Trajet" — auto-créés à la validation)
  // - Autres heures indirectes (intempéries, SAV, nettoyage…)
  const indirectStats = useMemo(() => {
    let heures = 0, cout = 0;
    pointages.forEach(p => {
      if (p.type_pointage !== "indirect") return;
      if (/trajet/i.test(p.motif_indirect || "")) return; // exclu, va dans trajetStats
      const h = parseFloat(p.heures) || 0;
      heures += h;
      cout += h * (parseFloat(p.taux_horaire) || 0);
    });
    return { heures, cout };
  }, [pointages]);

  const trajetStats = useMemo(() => {
    let heures = 0, cout = 0;
    pointages.forEach(p => {
      if (p.type_pointage !== "indirect") return;
      if (!/trajet/i.test(p.motif_indirect || "")) return;
      const h = parseFloat(p.heures) || 0;
      heures += h;
      cout += h * (parseFloat(p.taux_horaire) || 0);
    });
    return { heures, cout };
  }, [pointages]);

  // Heures + coût MO pour les pointages "tâche libre" (tache_id null, type tache)
  const libreStats = useMemo(() => {
    let heures = 0, cout = 0;
    pointages.forEach(p => {
      if (p.type_pointage === "indirect") return;
      if (p.tache_id) return;
      const h = parseFloat(p.heures) || 0;
      heures += h;
      cout += h * (parseFloat(p.taux_horaire) || 0);
    });
    return { heures, cout };
  }, [pointages]);

  // Heures + coût MO des rapports en attente (non validés) — sous-total séparé
  const enAttenteStats = useMemo(() => {
    let heures = 0, cout = 0;
    rapportsEnAttente.forEach(r => {
      const taux = parseFloat(tauxHoraires?.[r.ouvrier]) || 0;
      (r.taches || []).forEach(t => {
        const h = parseFloat(t.heures_reelles) || 0;
        heures += h;
        cout += h * taux;
      });
      (r.heures_indirectes || []).forEach(li => {
        const h = parseFloat(li.heures) || 0;
        heures += h;
        cout += h * taux;
      });
    });
    return { heures, cout };
  }, [rapportsEnAttente, tauxHoraires]);

  // Heures réelles effectives d'une tâche : somme des pointages si présents,
  // sinon ancienne valeur du plan (repli legacy).
  const heuresEff = (t) => {
    if (!t) return 0;
    const pts = pointagesParTache[String(t.id)];
    if (pts && pts.length > 0) {
      return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
    }
    return parseFloat(t.heures_reelles) || 0;
  };

  // Coût MO effectif d'une tâche : somme des pointages × taux figé si présents,
  // sinon legacy heures_reelles × taux[ouvriers[0]].
  const coutMOEff = (t) => {
    if (!t) return 0;
    const pts = pointagesParTache[String(t.id)];
    if (pts && pts.length > 0) {
      return pts.reduce((s, p) => s + ((parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0)), 0);
    }
    const pO = (t.ouvriers || [])[0] || "";
    return (parseFloat(t.heures_reelles) || 0) * (pO ? (tauxHoraires?.[pO] || 0) : 0);
  };

  // ─── MATÉRIAUX PRÉVISIONNELS PAR PHASE ─────────────────────────────────────
  // Stockés à côté des tâches dans plan_travaux :
  //   plan[phaseId + "__materiaux_prevus"] = tableau de matériaux
  //   plan[phaseId + "__date_commande"]    = vendredi S-1 (string ISO)
  // Aucune mutation des tableaux de tâches existants.
  const [materiauxBibl, setMateriauxBibl] = useState([]);
  const [fournisseursBibl, setFournisseursBibl] = useState([]);
  const [addMatPhase, setAddMatPhase] = useState(null); // phaseId ouvert dans la modale d'ajout
  useEffect(() => {
    supabase.from("materiaux_bibliotheque")
      .select("id,nom,reference,unite,prix_unitaire,fournisseur,fournisseur_id,categorie")
      .order("nom")
      .then(({ data }) => setMateriauxBibl(data || []));
    supabase.from("fournisseurs")
      .select("id,nom")
      .order("nom")
      .then(({ data }) => setFournisseursBibl(data || []));
  }, []);

  // Vendredi de la semaine précédant la date passée. Renvoie une chaîne ISO yyyy-mm-dd.
  function vendrediSPrec(dateISO) {
    if (!dateISO) return null;
    const d = new Date(dateISO);
    if (isNaN(d.getTime())) return null;
    const dow = d.getDay(); // 0=Dim … 6=Sam
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const lundi = new Date(d);
    lundi.setDate(d.getDate() + diffToMon);
    const vendrediSPrec = new Date(lundi);
    vendrediSPrec.setDate(lundi.getDate() - 3); // lundi - 3 jours = vendredi précédent
    const y = vendrediSPrec.getFullYear();
    const m = String(vendrediSPrec.getMonth() + 1).padStart(2, "0");
    const j = String(vendrediSPrec.getDate()).padStart(2, "0");
    return `${y}-${m}-${j}`;
  }

  // Première date_prevue d'une phase (date la plus ancienne), ou null.
  function premiereDatePhase(taches) {
    const dates = (taches || []).map(t => t.date_prevue).filter(Boolean).sort();
    return dates[0] || null;
  }

  function getMateriauxPhase(phaseId) {
    return plan[phaseId + "__materiaux_prevus"] || [];
  }

  // Met à jour la liste des matériaux d'une phase + recalcule et persiste la
  // date de commande. La sauvegarde Supabase passe par l'autosave existant
  // (déclenché par setPlan).
  function setMateriauxPhase(phaseId, nextMateriaux) {
    setPlan(p => {
      const matKey  = phaseId + "__materiaux_prevus";
      const dateKey = phaseId + "__date_commande";
      const next = { ...p, [matKey]: nextMateriaux };
      const premiere = premiereDatePhase(p[phaseId] || []);
      const dateCmd  = vendrediSPrec(premiere);
      if (dateCmd) next[dateKey] = dateCmd;
      // Save immédiat (sans debounce) : les matériaux à prévoir sont une
      // donnée critique, on ne veut pas qu'une actualisation entre la
      // saisie et l'autosave les perde.
      saveImmediat(next);
      return next;
    });
  }

  function ajouterMateriauPhase(phaseId, mat) {
    const liste = getMateriauxPhase(phaseId);
    setMateriauxPhase(phaseId, [...liste, mat]);
  }

  function supprimerMateriauPhase(phaseId, matPrevuId) {
    const liste = getMateriauxPhase(phaseId).filter(m => m.id !== matPrevuId);
    setMateriauxPhase(phaseId, liste);
  }

  // Si les dates des tâches changent et qu'une phase a déjà des matériaux,
  // resynchroniser la date_commande stockée. N'écrit rien pour les phases
  // sans matériaux (préserve les phasages legacy).
  useEffect(() => {
    let dirty = false;
    const updates = {};
    PHASES.forEach(ph => {
      const mat = plan[ph.id + "__materiaux_prevus"];
      if (!mat || mat.length === 0) return;
      const cible = vendrediSPrec(premiereDatePhase(plan[ph.id] || []));
      const courante = plan[ph.id + "__date_commande"] || null;
      if (cible && cible !== courante) {
        updates[ph.id + "__date_commande"] = cible;
        dirty = true;
      }
    });
    if (dirty) setPlan(p => ({ ...p, ...updates }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  const semainesFutures = [];
  const now = getCurrentWeek();
  for (let i = 0; i < 8; i++) { let w = now.week + i, y = now.year; if (w > 52) { w -= 52; y++; } semainesFutures.push(getWeekId(y, w)); }

  // Helper : construit le meta avec les champs Direction (utilisé par
  // l'autosave et le save immédiat des matériaux).
  const buildMeta = (planSrc) => ({
    ...(planSrc.meta || {}),
    prix_vendu:          prixVendu,
    marge_vendue_cible:  parseFloat(margeVendueCible) || 0,
    seuil_prime:         parseFloat(seuilPrime) || 0,
    prime:               parseFloat(primeChantier) || 0,
  });

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      lastSyncedSnapshotRef.current = JSON.stringify({ plan, meta: buildMeta(plan) });
      return;
    }
    const snapshot = JSON.stringify({ plan, meta: buildMeta(plan) });
    if (snapshot === lastSyncedSnapshotRef.current) return; // identique à l'état synchronisé
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        await onSavePlan({ ...plan, meta: buildMeta(plan) });
        lastSyncedSnapshotRef.current = JSON.stringify({ plan, meta: buildMeta(plan) });
        dirtyTachesRef.current.clear();
        dirtyMetaRef.current.clear();
        setAutoSaveStatus("saved");
      } catch (e) {
        console.error("Autosave échouée :", e);
        setAutoSaveStatus("error");
      }
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, prixVendu, margeVendueCible, seuilPrime, primeChantier]);

  // ─── Subscription Realtime sur ce phasage ────────────────────────────────
  // Merge per-id sur chaque phase de plan_travaux + sur les scalaires meta.
  // Items remote dont l'id est dirty → on garde le local. Sinon take remote.
  useEffect(() => {
    if (!phasage?.id) return;
    const clientId = getClientId();
    const ch = supabase
      .channel(`plan-travaux-${phasage.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "phasages", filter: `id=eq.${phasage.id}` },
        (payload) => {
          const remote = payload?.new;
          if (!remote) return;
          if (remote.plan_travaux?.meta?.last_client_id === clientId) return;
          const remotePlan = remote.plan_travaux || {};
          const dirtyT = dirtyTachesRef.current;
          const dirtyM = dirtyMetaRef.current;
          const rMeta  = remotePlan.meta || {};
          // ─ Merge des arrays de tâches par phase + clés scalaires non-array.
          let mergedSnapshot = null;
          setPlan(prev => {
            const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(remotePlan)]);
            const merged = {};
            allKeys.forEach(key => {
              if (key === "meta") return;
              const r = remotePlan[key];
              const l = prev?.[key];
              if (Array.isArray(r) || Array.isArray(l)) {
                const lr = Array.isArray(r) ? r : [];
                const ll = Array.isArray(l) ? l : [];
                const remoteById = new Map(lr.map(t => [t.id, t]));
                const localById  = new Map(ll.map(t => [t.id, t]));
                const phaseMerged = [];
                lr.forEach(rT => {
                  if (dirtyT.has(rT.id) && localById.has(rT.id)) phaseMerged.push(localById.get(rT.id));
                  else phaseMerged.push(rT);
                });
                ll.forEach(lT => {
                  if (!remoteById.has(lT.id) && dirtyT.has(lT.id)) phaseMerged.push(lT);
                });
                merged[key] = phaseMerged;
              } else {
                merged[key] = r !== undefined ? r : l;
              }
            });
            merged.meta = remotePlan.meta || prev?.meta || {};
            mergedSnapshot = merged;
            return merged;
          });
          // ─ Merge des scalaires meta (prix_vendu, etc.) — détermine la valeur
          //   que l'état React aura APRÈS les setX, pour précalculer le
          //   futur snapshot et court-circuiter l'autosave consécutif.
          const futurePrix = !dirtyM.has("prix_vendu")         && rMeta.prix_vendu         !== undefined ? rMeta.prix_vendu         : prixVendu;
          const futureMarg = !dirtyM.has("marge_vendue_cible") && rMeta.marge_vendue_cible !== undefined ? rMeta.marge_vendue_cible : margeVendueCible;
          const futureSeui = !dirtyM.has("seuil_prime")        && rMeta.seuil_prime        !== undefined ? rMeta.seuil_prime        : seuilPrime;
          const futurePrim = !dirtyM.has("prime")              && rMeta.prime              !== undefined ? rMeta.prime              : primeChantier;
          if (!dirtyM.has("prix_vendu")         && rMeta.prix_vendu         !== undefined) setPrixVendu(rMeta.prix_vendu);
          if (!dirtyM.has("marge_vendue_cible") && rMeta.marge_vendue_cible !== undefined) setMargeVendueCible(rMeta.marge_vendue_cible);
          if (!dirtyM.has("seuil_prime")        && rMeta.seuil_prime        !== undefined) setSeuilPrime(rMeta.seuil_prime);
          if (!dirtyM.has("prime")              && rMeta.prime              !== undefined) setPrimeChantier(rMeta.prime);
          // Snapshot identique à ce que produira buildMeta(merged) après re-render
          if (mergedSnapshot) {
            const futureMeta = {
              ...(mergedSnapshot.meta || {}),
              prix_vendu:         futurePrix,
              marge_vendue_cible: parseFloat(futureMarg) || 0,
              seuil_prime:        parseFloat(futureSeui) || 0,
              prime:              parseFloat(futurePrim) || 0,
            };
            lastSyncedSnapshotRef.current = JSON.stringify({ plan: mergedSnapshot, meta: futureMeta });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phasage?.id]);

  // Save immédiat (sans debounce) pour les opérations critiques où la
  // perte de données serait grave (ajout/suppression de matériaux à prévoir,
  // d'ouvrages, etc.). Utilisé par setMateriauxPhase ci-dessous.
  const saveImmediat = async (planToSave) => {
    clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus("saving");
    try {
      await onSavePlan({ ...planToSave, meta: buildMeta(planToSave) });
      lastSyncedSnapshotRef.current = JSON.stringify({ plan: planToSave, meta: buildMeta(planToSave) });
      dirtyTachesRef.current.clear();
      dirtyMetaRef.current.clear();
      setAutoSaveStatus("saved");
    } catch (e) {
      console.error("Save immédiat échoué :", e);
      setAutoSaveStatus("error");
    }
  };

  // Warning si l'utilisateur tente de fermer/recharger la page pendant
  // qu'un autosave est en attente (pending) ou en cours (saving).
  useEffect(() => {
    const handler = (e) => {
      if (autoSaveStatus === "pending" || autoSaveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "Sauvegarde en cours, attends un instant avant de quitter.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [autoSaveStatus]);

  function updateTache(phaseId, tacheId, updates) {
    markTacheDirty(tacheId);
    setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).map(t => t.id === tacheId ? { ...t, ...updates } : t) }));
  }
  function deleteTache(phaseId, tacheId) {
    dirtyTachesRef.current.delete(tacheId);
    setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).filter(t => t.id !== tacheId) }));
  }
  function addTache(phaseId) {
    if (!ajoutForm.nom) return;
    const newT = { id: Math.random().toString(36).slice(2), nom: ajoutForm.nom, heures_vendues: parseFloat(ajoutForm.heures_vendues) || 0, heures_estimees: parseFloat(ajoutForm.heures_estimees) || null, heures_reelles: 0, cout_materiel: 0, ouvriers: ajoutForm.ouvriers || [], date_prevue: ajoutForm.date_prevue || "", avancement: 0 };
    markTacheDirty(newT.id);
    setPlan(p => ({ ...p, [phaseId]: [...(p[phaseId] || []), newT] }));
    setAjoutPhase(null); setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvriers: [], date_prevue: "" });
  }
  function togglePhase(id) { setExpandedPhases(prev => ({ ...prev, [id]: !prev[id] })); }
  function onDragStart(phaseId, index) { dragItem.current = { phaseId, index }; setDragActive(true); }
  function onDragEnter(phaseId, index) { dragOver.current = { phaseId, index }; }
  function onDragEnd() {
    setDragActive(false);
    if (!dragItem.current || !dragOver.current) { dragItem.current = null; dragOver.current = null; return; }
    const { phaseId: fp, index: fi } = dragItem.current;
    const { phaseId: tp, index: ti } = dragOver.current;
    if (fp === tp && fi === ti) { dragItem.current = null; dragOver.current = null; return; }
    setPlan(prev => {
      const next = {};
      PHASES.forEach(ph => { next[ph.id] = [...(prev[ph.id] || [])]; });
      const [moved] = next[fp].splice(fi, 1);
      if (moved?.id) markTacheDirty(moved.id); // reorder = position locale à préserver
      next[tp].splice(ti, 0, moved);
      return next;
    });
    dragItem.current = null; dragOver.current = null;
  }
  const stopDrag = (e) => { e.stopPropagation(); };

  async function executerPlanification() {
    if (!planifierWeek || !planifierJour || !planifierTask) return;
    setIsPlanningSaving(true);
    try {
      const { data: ex } = await supabase.from("planning_cells").select("*").eq("week_id", planifierWeek).eq("chantier_id", phasage.chantier_id).eq("jour", planifierJour).maybeSingle();
      const base = ex || { planifie: "", reel: "", ouvriers: [], taches: [] };
      const ouvriersAssignes = planifierTask.tache.ouvriers || [];
      const nouveauPlanifieTexte = base.planifie ? `${base.planifie}\n${planifierTask.tache.nom}` : planifierTask.tache.nom;
      const dureeSaisie = parseFloat(planifierDuree) || 0;
      const upd = [...(base.taches || []), { id: Math.random().toString(36).slice(2), text: planifierTask.tache.nom, duree: dureeSaisie, ouvriers: ouvriersAssignes, tache_id: planifierTask.tache.id, phase_id: planifierTask.phaseId }];
      await supabase.from("planning_cells").upsert({ week_id: planifierWeek, chantier_id: phasage.chantier_id, jour: planifierJour, planifie: nouveauPlanifieTexte, taches: upd, reel: base.reel, ouvriers: [...new Set([...(base.ouvriers || []), ...ouvriersAssignes])] }, { onConflict: "week_id,chantier_id,jour" });
      const exactDate = getDateFromWeekAndDay(planifierWeek, planifierJour);
      updateTache(planifierTask.phaseId, planifierTask.tache.id, { date_prevue: exactDate });
      setPlanifierTask(null);
      alert("Tâche ajoutée au planning !");
    } catch (err) { console.error(err); alert("Erreur lors de la planification."); }
    setIsPlanningSaving(false);
  }

  const allTaches = PHASES.flatMap(ph => (plan[ph.id] || []).map(t => ({ ...t, _phaseId: ph.id, _phaseCouleur: ph.couleur, _phaseLabel: ph.label })));
  const nbTaches = allTaches.length;
  const terminees = allTaches.filter(t => (parseFloat(t.avancement) || 0) === 100).length;
  // Nouveau modèle : les heures vendues vivent au niveau ouvrage (heures_devis).
  // Fallback ancien modèle : si aucun ouvrage avec heures_devis mais des tâches
  // avec heures_vendues > 0 → on prend la somme des tâches (compat legacy).
  const totalHVenduOuvrages = (ouvrages || []).reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
  const totalHVenduTaches   = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const totalHVenduGlobal = totalHVenduOuvrages > 0 ? totalHVenduOuvrages : totalHVenduTaches;
  const totalHEstimeeGlobal = allTaches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  // P8 : heures réelles dérivées du registre + heures libres / indirectes / trajets
  // (qui n'appartiennent à aucune tâche du plan mais comptent au chantier).
  const totalHReelGlobal = allTaches.reduce((s, t) => s + heuresEff(t), 0)
                         + libreStats.heures + indirectStats.heures + trajetStats.heures;

  // ── Date prévue de fin : la dernière date_prevue parmi toutes les tâches
  const dateFin = (() => {
    const dates = allTaches.map(t => t.date_prevue).filter(Boolean).sort();
    return dates.length > 0 ? dates[dates.length - 1] : null;
  })();
  const dateFinFmt = dateFin ? new Date(dateFin).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;

  // ── Détection dépassements pour bandeau d'alerte (P8 : hR dérivé du registre)
  const depassementsH = allTaches.filter(t => {
    const hV = parseFloat(t.heures_vendues) || 0;
    const hR = heuresEff(t);
    return hV > 0 && hR > hV;
  });

  // ── Avancement global : pondéré par valeur facturable (prix HT au niveau ouvrage),
  // avec cascade de fallbacks. Voir calcAvancementPondere() dans constants.js.
  const avgAv = calcAvancementPondere(ouvrages, allTaches);

  // P8 : coût MO global dérivé du registre (heures × taux figé par ouvrier),
  // + coût des heures libres, indirectes et trajets du chantier.
  const totalMO = allTaches.reduce((s, t) => s + coutMOEff(t), 0)
                + libreStats.cout + indirectStats.cout + trajetStats.cout;
  // Coût matériel = somme des prix HT des commandes AYANT phase_id rempli.
  // Cohérent avec phCoutMat (filtré par phase). Les commandes sans phase_id
  // (= non attribuées) ne sont pas comptées ici → on signale leur nb plus bas.
  const cmdsAvecPhase = commandesPhasage.filter(c => c.phase_id);
  const cmdsSansPhase = commandesPhasage.filter(c => !c.phase_id);
  const totalMat = cmdsAvecPhase.reduce((s, c) => s + (parseFloat(c.prix_ht) || 0), 0);
  const totalMatNonAttribue = cmdsSansPhase.reduce((s, c) => s + (parseFloat(c.prix_ht) || 0), 0);
  const coutTotal = totalMO + totalMat;
  const pVendu = parseFloat(prixVendu) || 0;
  const marge = pVendu - coutTotal;
  const margePct = pVendu > 0 ? (marge / pVendu) * 100 : 0;
  const autoColor = autoSaveStatus === "saved" ? "#50c878" : autoSaveStatus === "saving" ? T.accent : "#f5a623";
  const autoLabel = autoSaveStatus === "saved" ? "✓ Sauvegardé" : autoSaveStatus === "saving" ? "Sauvegarde…" : "● Modification en cours";
  
  // Adjusted grid columns to fit the new text input for avancement
  // Sur mobile : 3 colonnes égales pour E/R/AV sur la même rangée
  // (V — heures vendues — n'est plus affiché par sous-tâche, l'info vit
  // désormais au niveau ouvrage uniquement).
  const gridCols = isMobile
    ? "1fr 1fr 1fr"
    : "20px 1.5fr 120px 55px 70px 110px 70px 90px 26px";

  // Sur mobile, on stacke chaque ligne de tâche en carte avec grid-template-areas.
  const gridAreas = isMobile
    ? `"name name name del" "e r av av" "date date ouv ouv" "plan plan plan plan"`
    : undefined;
  const ga = (areaName) => isMobile ? { gridArea: areaName } : {};

  return (
    <div className="page-padding plan-travaux" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg, position: "relative" }}>
      <style>{`
        .plan-travaux .ouvrage-tooltip-wrap:hover .ouvrage-tooltip { opacity: 1 !important; }
        @media (max-width: 767px) {
          .plan-travaux .plan-task-headers { display: none !important; }
          .plan-travaux .plan-task-row {
            padding: 10px 12px !important;
            gap: 6px !important;
            border-radius: 8px;
            margin: 2px 0;
          }
          .plan-travaux .plan-task-row .drag-handle { display: none !important; }
          .plan-travaux .plan-task-row .field-mini-label {
            display: block !important;
          }
          .plan-travaux .plan-task-row .planifier-btn-wrap {
            text-align: left !important;
          }
          .plan-travaux .plan-task-row .planifier-btn-wrap button {
            width: 100% !important;
            justify-content: center !important;
            padding: 8px 12px !important;
          }
          /* Inputs compacts dans la carte tâche (≠ inputs des formulaires "vrais"),
             tout en gardant font-size: 16px pour éviter le zoom iOS au focus. */
          .plan-travaux .plan-task-row input[type="number"],
          .plan-travaux .plan-task-row input[type="date"],
          .plan-travaux .plan-task-row input[type="text"] {
            width: 100% !important;
            min-height: 32px !important;
            padding: 5px 8px !important;
          }
          /* L'avancement : sur mobile on étire l'input pour matcher les autres
             champs, et le label (.field-mini-label) s'affiche au-dessus. */
          .plan-travaux .plan-task-row .av-wrap .av-inner {
            justify-content: flex-start !important;
          }
          .plan-travaux .plan-task-row .av-wrap .av-inner input {
            width: 100% !important;
            min-width: 0 !important;
            flex: 1 1 auto !important;
          }
          /* Bouton supprimer aligné à droite dans sa cellule */
          .plan-travaux .plan-task-row .del-btn {
            justify-self: end !important;
          }
        }
        .field-mini-label { display: none; font-size: 8.5px; font-weight: 700; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 1px; line-height: 1; }
      `}</style>

      {planifierTask && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setPlanifierTask(null)}>
          <div style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 440, border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.sectionDivider}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, background: planAcc.bg10, color: planAcc.accent,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon as={CalendarPlus} size={16}/>
              </div>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Envoyer dans le planning</div>
            </div>
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: T.card, padding: "12px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{planifierTask.tache.nom}</div>
                {planifierTask.tache.ouvrage_libelle && (
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>↳ {planifierTask.tache.ouvrage_libelle}</div>
                )}
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(planifierTask.tache.ouvriers || []).length > 0
                    ? <span>{planifierTask.tache.ouvriers.join(", ")}</span>
                    : <span style={{ color: "#f5a623" }}>Aucun ouvrier assigné</span>}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Durée prévue (heures)</label>
                <input
                  type="number" min="0" step="0.5" value={planifierDuree} onChange={e => setPlanifierDuree(e.target.value)}
                  placeholder="ex: 4"
                  style={{
                    padding: "9px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
                    background: T.fieldBg || T.card, color: T.text, fontFamily: "'DM Mono',monospace",
                    fontSize: FONT.md.size, fontWeight: 700, outline: "none",
                  }}
                />
                <span style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic" }}>
                  Durée allouée à cette sous-tâche pour cet ouvrier — affichée dans la cellule planning.
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Semaine</label>
                <select value={planifierWeek} onChange={e => setPlanifierWeek(e.target.value)}
                  style={{ padding: "9px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
                    background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer" }}>
                  <option value="" disabled>Choisir…</option>
                  {semainesFutures.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Jour</label>
                <select value={planifierJour} onChange={e => setPlanifierJour(e.target.value)}
                  style={{ padding: "9px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`,
                    background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", cursor: "pointer" }}>
                  {JOURS.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
            </div>
            <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPlanifierTask(null)}
                style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "9px 18px",
                  color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer" }}>Annuler</button>
              <button onClick={executerPlanification} disabled={isPlanningSaving || !planifierWeek}
                style={{ display: "inline-flex", alignItems: "center", gap: 6,
                  background: planAcc.accent, border: "none", borderRadius: RADIUS.md, padding: "9px 18px",
                  color: planAcc.onAccent, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
                  opacity: (isPlanningSaving || !planifierWeek) ? .6 : 1 }}>
                <Icon as={Check} size={13}/>
                {isPlanningSaving ? "Envoi…" : "Ajouter au planning"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* ── Bouton retour ── */}
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: RADIUS.md,
          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", marginBottom: 14,
        }}>
          <Icon as={ChevronLeftIcon} size={13}/>
          Préparation du devis
        </button>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{
            width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0,
            background: planAcc.bg10, color: planAcc.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={ClipboardList} size={20} strokeWidth={2}/>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
                {phasage.chantier_nom}
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: FONT.xs.size, fontWeight: 700, color: autoColor,
                background: autoColor + "1A", border: `1px solid ${autoColor}44`,
                borderRadius: RADIUS.pill, padding: "1px 8px",
              }}>
                {autoSaveStatus === "saving" && (
                  <svg width="10" height="10" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                  </svg>
                )}
                {autoLabel}
              </span>
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 5, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={Hammer} size={11}/>
                {nbTaches} tâche{nbTaches > 1 ? "s" : ""}
              </span>
              {totalHVenduGlobal > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Total heures vendues (somme des heures de devis des ouvrages)">
                  <Icon as={Clock} size={11}/>
                  <strong style={{ color: T.accent, fontWeight: 700 }}>{totalHVenduGlobal.toFixed(1)}h</strong> vendues
                </span>
              )}
              {terminees > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#22c55e", fontWeight: 700 }}>
                  <Icon as={Check} size={11}/>
                  {terminees} terminée{terminees > 1 ? "s" : ""}
                </span>
              )}
              {dateFinFmt && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Date prévue de fin (dernière échéance des tâches)">
                  <Icon as={CalendarCheck} size={11}/>
                  Fin prévue : <strong style={{ color: T.text, fontWeight: 700 }}>{dateFinFmt}</strong>
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowGantt(true)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 14px", borderRadius: RADIUS.md,
            border: `1px solid rgba(91,156,246,0.4)`, background: "rgba(91,156,246,0.10)", color: "#5b9cf6",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
          }} title="Afficher la vue Gantt">
            <Icon as={GanttChartSquare} size={13}/>
            Vue Gantt
          </button>
        </div>

        {showGantt && (
          <GanttView
            planTravaux={plan}
            chantierNom={phasage.chantier_nom}
            T={T}
            onClose={() => setShowGantt(false)}
          />
        )}

        {/* ── Bandeau d'alerte dépassements ── */}
        {(depassementsH.length > 0 || (pVendu > 0 && marge < 0)) && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 14px", marginBottom: 12,
            background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.3)",
            borderRadius: RADIUS.lg,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: RADIUS.md, flexShrink: 0,
              background: "rgba(225,90,90,0.18)", color: "#e15a5a",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon as={AlertTriangle} size={14} strokeWidth={2.2}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: "#e15a5a", marginBottom: 2 }}>
                Attention&nbsp;: dépassement{depassementsH.length > 1 ? "s" : ""} détecté{depassementsH.length > 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5 }}>
                {depassementsH.length > 0 && (
                  <span>{depassementsH.length} tâche{depassementsH.length > 1 ? "s" : ""} dépasse{depassementsH.length > 1 ? "nt" : ""} les heures vendues</span>
                )}
                {depassementsH.length > 0 && pVendu > 0 && marge < 0 && <span> · </span>}
                {pVendu > 0 && marge < 0 && (
                  <span>Marge négative ({Math.round(marge).toLocaleString("fr-FR")} €)</span>
                )}
                {depassementsH.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {depassementsH.slice(0, 5).map(t => {
                      const hV = parseFloat(t.heures_vendues) || 0;
                      const hR = heuresEff(t);
                      return (
                        <span key={t.id} style={{
                          fontSize: FONT.xs.size, padding: "2px 7px", borderRadius: RADIUS.sm,
                          background: t._phaseCouleur + "1A", color: t._phaseCouleur,
                          border: `1px solid ${t._phaseCouleur}33`, fontWeight: 600,
                        }}>
                          {t.nom} · {hR}h / {hV}h
                        </span>
                      );
                    })}
                    {depassementsH.length > 5 && (
                      <span style={{ fontSize: FONT.xs.size, color: T.textMuted, padding: "2px 4px" }}>
                        +{depassementsH.length - 5} autre{depassementsH.length - 5 > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── KPI cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 14 }}>
          <div style={{
            background: T.surface, border: `1px solid ${planAcc.accent}66`,
            borderRadius: RADIUS.lg, padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
              background: planAcc.bg10, color: planAcc.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon as={Euro} size={16} strokeWidth={2}/>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 600, letterSpacing: .3 }}>Prix de vente</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <input type="number" value={prixVendu || ""} onChange={e => { markMetaDirty("prix_vendu"); setPrixVendu(e.target.value); }} placeholder="0"
                  style={{ flex: 1, minWidth: 0, padding: "2px 4px", background: "transparent", border: "none",
                    color: T.text, fontSize: FONT.xl.size - 2, fontWeight: 800, outline: "none", letterSpacing: -.5 }}/>
                <span style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.textMuted }}>€</span>
              </div>
            </div>
          </div>
          {(() => {
            const ratioH = totalHVenduGlobal > 0 ? (totalHReelGlobal / totalHVenduGlobal) * 100 : 0;
            const heuresColor = totalHVenduGlobal === 0
              ? T.textMuted
              : ratioH > 100 ? "#e15a5a"
              : ratioH > 85 ? "#f5a623"
              : "#22c55e";
            // P8 : sous-total séparé pour les rapports en attente (non encore validés)
            // — visibilité au conducteur sans fausser le validé.
            const enAttenteCout = enAttenteStats.cout;
            const enAttenteH = enAttenteStats.heures;
            return [
              { label: "Main d'œuvre", value: `${Math.round(totalMO).toLocaleString("fr-FR")} €`, icon: HardHat,
                color: totalMO > pVendu && pVendu > 0 ? "#e15a5a" : "#5b9cf6",
                subtext: enAttenteCout > 0 ? `+ ${Math.round(enAttenteCout).toLocaleString("fr-FR")} € en attente de validation` : null },
              { label: "Trajets",
                value: trajetStats.heures > 0
                  ? `${trajetStats.heures.toFixed(1)}h · ${Math.round(trajetStats.cout).toLocaleString("fr-FR")} €`
                  : "—",
                icon: Car, color: trajetStats.heures > 0 ? "#06b6d4" : T.textMuted },
              { label: "Matériaux", value: totalMat > 0 ? `${Math.round(totalMat).toLocaleString("fr-FR")} €` : "—",
                icon: Package, color: totalMat > 0 ? "#a78bfa" : T.textMuted },
              { label: totalHVenduGlobal > 0 ? `Heures · ${ratioH.toFixed(0)}%` : "Heures réelles",
                value: `${totalHReelGlobal.toFixed(1)}h${totalHVenduGlobal > 0 ? ` / ${totalHVenduGlobal.toFixed(0)}h` : ""}`,
                icon: Clock, color: heuresColor,
                subtext: enAttenteH > 0 ? `+ ${enAttenteH.toFixed(1)}h en attente de validation` : null },
              { label: "Marge nette",
                value: `${marge > 0 ? "+" : ""}${Math.round(marge).toLocaleString("fr-FR")} €${pVendu > 0 ? ` · ${margePct.toFixed(1)}%` : ""}`,
                icon: TrendingUp, color: marge < 0 ? "#e15a5a" : marge > 0 ? "#22c55e" : T.textMuted },
            ];
          })().map((s, i) => (
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
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
                <div style={{ fontSize: FONT.xl.size - 2, fontWeight: 800, color: s.color, letterSpacing: -.5, marginTop: 2, lineHeight: 1 }}>{s.value}</div>
                {s.subtext && (
                  <div style={{ fontSize: FONT.xs.size, color: "#d18a16", fontWeight: 600, marginTop: 4, letterSpacing: .2 }}>
                    {s.subtext}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Suivi direction (Dashboard Analyse) ── */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg, padding: "12px 16px", marginBottom: 18,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
            background: "rgba(255,194,0,0.12)", color: "#FFC200",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={TrendingUp} size={16} strokeWidth={2}/>
          </div>
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Suivi direction</div>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2, fontStyle: "italic" }}>Visible dans Dashboard Analyse</div>
          </div>
          {[
            { label: "Marge vendue cible", value: margeVendueCible, set: setMargeVendueCible, key: "marge_vendue_cible", suffix: "%", placeholder: "30" },
            { label: "Seuil prime",         value: seuilPrime,       set: setSeuilPrime,       key: "seuil_prime",         suffix: "%", placeholder: "25" },
            { label: "Prime chantier",      value: primeChantier,    set: setPrimeChantier,    key: "prime",               suffix: "€", placeholder: "300" },
          ].map(f => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 130 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: .4, textTransform: "uppercase" }}>{f.label}</span>
              <div style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                <input type="number" value={f.value ?? ""} onChange={e => { markMetaDirty(f.key); f.set(e.target.value); }} placeholder={f.placeholder}
                  style={{ width: 70, padding: "5px 8px", background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`,
                    borderRadius: 6, color: T.text, fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 700, outline: "none" }}/>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.textMuted }}>{f.suffix}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4 }}>
            <div style={{ height: "100%", borderRadius: 4, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 40 }}>{avgAv}% avancement global</span>
        </div>

        {/* Avertissement : commandes non rattachées à une phase */}
        {cmdsSansPhase.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", marginBottom: 16,
            background: "rgba(245,166,35,0.10)", border: "1px solid rgba(245,166,35,0.30)",
            borderRadius: RADIUS.md, color: "#f5a623",
          }}>
            <Icon as={AlertTriangle} size={14}/>
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
              <strong>{cmdsSansPhase.length} commande{cmdsSansPhase.length > 1 ? "s" : ""}</strong>
              {" "}({Math.round(totalMatNonAttribue).toLocaleString("fr-FR")} € HT)
              {" "}non rattachée{cmdsSansPhase.length > 1 ? "s" : ""} à une phase. Ces montants ne sont pas inclus dans le coût matériel ci-dessus.
            </span>
            <span style={{ fontSize: 11, color: "#c08015", fontStyle: "italic" }}>
              Lie-les depuis l'onglet Commandes
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PHASES.map((phase) => {
            const taches = plan[phase.id] || [];
            const isExp = expandedPhases[phase.id];
            const phHVendu = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
            const phHEstimee = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

            // Avancement par phase : pondéré par prix HT ouvrage (cf. calcAvancementPondere)
            const phAv = calcAvancementPondere(ouvrages, taches);

            const phVendu = phHVendu;
            const phReel = taches.reduce((s, t) => s + heuresEff(t), 0);
            const phPrixHt = taches.reduce((s, t) => s + (parseFloat(t.prix_ht) || 0), 0);
            const phCoutMO = taches.reduce((s, t) => s + coutMOEff(t), 0);
            // Coût matériel par phase = somme commandes ayant phase_id = cette phase
            const phCmds = commandesPhasage.filter(c => c.phase_id === phase.id);
            const phCoutMat = phCmds.reduce((s, c) => s + (parseFloat(c.prix_ht) || 0), 0);
            const phCout = phCoutMO + phCoutMat;
            const phMarge = phPrixHt - phCout;

            return (
              <div key={phase.id}
                onDragOver={e => { e.preventDefault(); if ((plan[phase.id] || []).length === 0) dragOver.current = { phaseId: phase.id, index: 0 }; }}
                onDrop={onDragEnd}
                style={{ background: T.surface, border: `1px solid ${isExp ? phase.couleur + "99" : T.border}`, borderRadius: 12, overflow: "hidden", transition: "border .2s" }}>

                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", cursor: "pointer", borderBottom: isExp ? `1px solid ${T.sectionDivider}` : "none" }} onClick={() => togglePhase(phase.id)}>
                  <div style={{ width: 4, height: 32, borderRadius: 2, background: phase.couleur, flexShrink: 0 }} />
                  <span style={{ fontSize: 15 }}>{phase.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{phase.label}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                      {taches.length} tâche{taches.length > 1 ? "s" : ""}
                      {phVendu > 0 && <> · <span style={{ color: T.accent, fontWeight: 700 }}>{phVendu.toFixed(1)}h vendues</span></>}
                      {phReel > 0 && <> · <span style={{ color: phReel > phVendu && phVendu > 0 ? "#e05c5c" : "#50c878", fontWeight: 700 }}>{phReel.toFixed(1)}h réelles</span></>}
                    </div>
                  </div>
                  {phPrixHt > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Vendu</div><div style={{ fontSize: 13, fontWeight: 800, color: T.accent }}>{phPrixHt.toFixed(2)} €</div></div>
                      <div style={{ width: 1, height: 28, background: T.border }} />
                      <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Coût</div><div style={{ fontSize: 13, fontWeight: 800, color: phCout > phPrixHt && phPrixHt > 0 ? "#e05c5c" : T.text }}>{phCout.toFixed(2)} €</div></div>
                      {phCout > 0 && <><div style={{ width: 1, height: 28, background: T.border }} /><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Marge</div><div style={{ fontSize: 13, fontWeight: 800, color: phMarge >= 0 ? "#50c878" : "#e05c5c" }}>{phMarge >= 0 ? "+" : ""}{phMarge.toFixed(2)} €</div></div></>}
                    </div>
                  )}
                  {taches.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
                      <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", borderRadius: 2, background: phAv === 100 ? "#50c878" : phase.couleur, width: `${phAv}%`, transition: "width .3s" }} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: phAv === 100 ? "#50c878" : T.textMuted, minWidth: 28 }}>{phAv}%</span>
                    </div>
                  )}
                  {/* Bouton "Commandes" — affiche le nb de commandes liées à cette phase */}
                  <button onClick={(e) => { e.stopPropagation(); setShowPhaseCmds(phase.id); }}
                    title={`Voir les ${phCmds.length} commande${phCmds.length > 1 ? "s" : ""} liée${phCmds.length > 1 ? "s" : ""}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: RADIUS.pill,
                      background: phCmds.length > 0 ? `${phase.couleur}22` : "transparent",
                      border: `1px solid ${phase.couleur}55`, color: phase.couleur,
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                      flexShrink: 0,
                    }}>
                    <Icon as={Package} size={11} strokeWidth={2.2}/>
                    {phCmds.length} cmd{phCmds.length > 1 ? "s" : ""}
                  </button>
                  <span style={{ color: isExp ? phase.couleur : T.textMuted, userSelect: "none", padding: "0 4px", display: "flex", alignItems: "center" }}>
                    <Icon as={isExp ? ChevronUp : ChevronDown} size={14}/>
                  </span>
                </div>

                {isExp && (
                  <div style={{ padding: "0 0 14px" }}>
                    {taches.length > 0 && (
                      <div className="plan-task-headers" style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, padding: "7px 16px 6px", borderBottom: `1px solid ${T.sectionDivider}` }}>
                        {["", "Tâche", "Ouvrier(s)", "Estimé", "Réel", "Date", "Avanc.", "Planning", ""].map((h, i) => (
                          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, textAlign: i > 2 ? "center" : "left" }}>{h}</div>
                        ))}
                      </div>
                    )}

                    {taches.map((tache, ti) => {
                      const av = parseFloat(tache.avancement) || 0;
                      const hV = parseFloat(tache.heures_vendues) || 0;
                      const hR = heuresEff(tache); // P8 : dérivé du registre, repli legacy si vide
                      const isDragging = dragActive && dragItem.current?.phaseId === phase.id && dragItem.current?.index === ti;
                      const ouvriersActuels = tache.ouvriers ? tache.ouvriers : (tache.ouvrier ? [tache.ouvrier] : []);

                      return (
                        <div key={tache.id}
                          className="plan-task-row"
                          draggable={!isMobile}
                          onDragStart={() => onDragStart(phase.id, ti)}
                          onDragEnter={() => onDragEnter(phase.id, ti)}
                          onDragEnd={onDragEnd}
                          onDragOver={e => e.preventDefault()}
                          style={{
                            display: "grid",
                            gridTemplateColumns: gridCols,
                            ...(gridAreas ? { gridTemplateAreas: gridAreas } : {}),
                            gap: 8, padding: "7px 16px",
                            borderBottom: `1px solid ${T.sectionDivider}`,
                            alignItems: "center",
                            opacity: isDragging ? 0.35 : 1,
                            background: isDragging ? `${phase.couleur}18` : "transparent",
                            transition: "opacity .15s",
                            cursor: isMobile ? "default" : "grab",
                          }}>

                          <div className="drag-handle" style={{ color: T.textMuted, cursor: isMobile ? "default" : "grab", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "center", ...ga("drag") }} title={isMobile ? "" : "Glisser pour réordonner"}>
                            <Icon as={GripVertical} size={14}/>
                          </div>

                          <div style={{ minWidth: 0, ...ga("name") }}>
                            <input value={tache.nom} onChange={e => updateTache(phase.id, tache.id, { nom: e.target.value })} onPointerDown={stopDrag} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none" }} onFocus={e => e.target.style.borderColor = T.border} onBlur={e => e.target.style.borderColor = "transparent"} />
                            {tache.ouvrage_libelle && (() => {
                              // Bulle tooltip au survol : ouvrage parent + heures vendues + heures réelles cumulées
                              // Lookup ouvrage : par ouvrage_id (nouveau modèle) sinon fallback par libellé
                              const ouvParent = ouvrages.find(o => o.id === tache.ouvrage_id)
                                             || ouvrages.find(o => o.libelle === tache.ouvrage_libelle);
                              const heuresVenduesOuvrage = parseFloat(ouvParent?.heures_devis) || 0;
                              const heuresReellesCumulees = allTaches
                                .filter(t => {
                                  if (ouvParent && tache.ouvrage_id) return t.ouvrage_id === tache.ouvrage_id;
                                  return t.ouvrage_libelle === tache.ouvrage_libelle;
                                })
                                .reduce((s, t) => s + heuresEff(t), 0);
                              return (
                                <div className="ouvrage-tooltip-wrap" style={{ position: "relative", display: "inline-block", marginTop: 1 }}>
                                  <div style={{ fontSize: 10, color: T.textMuted, paddingLeft: 6, cursor: "help" }}>↳ {tache.ouvrage_libelle}</div>
                                  <div className="ouvrage-tooltip" style={{
                                    position: "absolute", left: 6, top: "100%", marginTop: 6, zIndex: 20,
                                    background: T.surface, border: `1px solid ${T.border}`,
                                    borderRadius: RADIUS.md, padding: "8px 12px",
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                                    pointerEvents: "none", minWidth: 220,
                                    opacity: 0, transition: "opacity .15s",
                                  }}>
                                    <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>Ouvrage parent</div>
                                    <div style={{ fontSize: 12, color: T.text, fontWeight: 700, marginBottom: 6 }}>{tache.ouvrage_libelle}</div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.textSub, padding: "2px 0" }}>
                                      <span>Heures vendues</span>
                                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: T.accent }}>{heuresVenduesOuvrage.toFixed(1)} h</span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.textSub, padding: "2px 0" }}>
                                      <span>Heures réelles cumulées</span>
                                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: heuresReellesCumulees > heuresVenduesOuvrage && heuresVenduesOuvrage > 0 ? "#e05c5c" : "#50c878" }}>{heuresReellesCumulees.toFixed(1)} h</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          <div style={{ minWidth: 0, ...ga("ouv") }}>
                            <span className="field-mini-label">Ouvrier(s)</span>
                            <OuvriersSelect ouvriers={ouvriers} selected={ouvriersActuels} onChange={next => updateTache(phase.id, tache.id, { ouvriers: next })} T={T} stopDrag={stopDrag} />
                          </div>

                          {/* Estimé : reste éditable manuellement */}
                          <div style={{ minWidth: 0, ...ga("e") }}>
                            <span className="field-mini-label">Estimé</span>
                            <input type="number" min="0" step="0.5" value={tache.heures_estimees || ""} placeholder="—" onPointerDown={stopDrag}
                              onChange={e => updateTache(phase.id, tache.id, { heures_estimees: parseFloat(e.target.value) || null })}
                              style={{ width: "100%", padding: "4px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: BLEU, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                          </div>
                          {/* Réel : P8 → dérivé du registre, plus saisissable. Affichage seul. */}
                          <div style={{ minWidth: 0, ...ga("r") }} title="Heures réelles cumulées depuis le registre de pointage (validations de fin de journée). Non éditable.">
                            <span className="field-mini-label">Réel</span>
                            <div style={{
                              width: "100%", padding: "4px 4px", borderRadius: 6,
                              border: `1px dashed ${T.border}`, background: "transparent",
                              color: hR > hV && hV > 0 ? "#e05c5c" : hR > 0 ? "#50c878" : T.textMuted,
                              fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center",
                            }}>
                              {hR > 0 ? (Number.isInteger(hR) ? hR : hR.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) : "0"}
                            </div>
                          </div>

                          <div style={{ minWidth: 0, ...ga("date") }}>
                            <span className="field-mini-label">Date prévue</span>
                            <input type="date" value={tache.date_prevue || ""} onChange={e => updateTache(phase.id, tache.id, { date_prevue: e.target.value })} onPointerDown={stopDrag} style={{ padding: "4px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 11, outline: "none", width: "100%", colorScheme: "dark" }} />
                          </div>

                          <div className="av-wrap" style={{ minWidth: 0, ...ga("av") }}>
                            <span className="field-mini-label">Avanc.</span>
                            <div className="av-inner" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                              <input type="number" min="0" max="100" step="1" value={av} onPointerDown={stopDrag} onChange={e => { let val = parseInt(e.target.value); if (isNaN(val)) val = 0; if (val > 100) val = 100; if (val < 0) val = 0; updateTache(phase.id, tache.id, { avancement: val }); }} style={{ width: 42, padding: "4px 2px", borderRadius: 6, border: `1.5px solid ${av === 100 ? "#50c878" : T.border}`, background: T.inputBg, color: av === 100 ? "#50c878" : T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 800, textAlign: "center", outline: "none" }} />
                              <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0 }}>%</span>
                            </div>
                          </div>

                          <div className="planifier-btn-wrap" style={{ textAlign: "center", ...ga("plan") }}>
                            <button onClick={() => {
                              setPlanifierWeek(semainesFutures[0]);
                              // Pré-remplit la durée avec heures_vendues si existant (compat ancien),
                              // sinon vide pour saisie manuelle.
                              setPlanifierDuree((parseFloat(tache.heures_vendues) || 0) > 0 ? String(tache.heures_vendues) : "");
                              setPlanifierTask({ phaseId: phase.id, tacheIdx: ti, tache: { ...tache, ouvriers: ouvriersActuels } });
                            }}
                              onPointerDown={stopDrag}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "4px 8px", borderRadius: RADIUS.sm,
                                border: `1px solid ${planAcc.accent}55`, background: planAcc.accent + "15", color: planAcc.accent,
                                fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer",
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = planAcc.accent + "30"}
                              onMouseLeave={e => e.currentTarget.style.background = planAcc.accent + "15"}>
                              <Icon as={CalendarPlus} size={11}/>
                              Planifier
                            </button>
                          </div>

                          <button onClick={() => deleteTache(phase.id, tache.id)} onPointerDown={stopDrag}
                            className="del-btn"
                            title="Supprimer la tâche"
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              background: "transparent", border: "none", color: "#e15a5a",
                              cursor: "pointer", padding: isMobile ? 6 : 0, lineHeight: 1,
                              ...ga("del"),
                            }}>
                            <Icon as={X} size={isMobile ? 18 : 14}/>
                          </button>
                        </div>
                      );
                    })}

                    {taches.length === 0 && dragActive && (
                      <div style={{ margin: "8px 16px", padding: "14px", borderRadius: 8, border: `2px dashed ${phase.couleur}55`, textAlign: "center", color: T.textMuted, fontSize: 12 }}>Déposer ici</div>
                    )}

                    {ajoutPhase === phase.id ? (
                      <div style={{ margin: "10px 16px 0", padding: "14px", background: T.card, borderRadius: 10, border: `1px solid ${phase.couleur}55` }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: phase.couleur, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>{phase.emoji} Nouvelle tâche</div>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                          {[["Nom *", "nom", "text", T.text, "ex: Pose plaques"], ["H. estimées", "heures_estimees", "number", BLEU, "—"], ["Date prévue", "date_prevue", "date", T.text, ""]].map(([label, field, type, color, ph]) => (
                            <div key={field}>
                              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 3 }}>{label}</div>
                              <input type={type} value={ajoutForm[field] || ""} onChange={e => setAjoutForm(f => ({ ...f, [field]: e.target.value }))} placeholder={ph} style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.inputBg, color, fontFamily: "inherit", fontSize: 13, fontWeight: field.includes("heure") ? 700 : 400, outline: "none", colorScheme: "dark" }} />
                            </div>
                          ))}
                          <div>
                            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 3 }}>Ouvrier(s)</div>
                            <OuvriersSelect ouvriers={ouvriers} selected={ajoutForm.ouvriers || []} onChange={next => setAjoutForm(f => ({ ...f, ouvriers: next }))} T={T} stopDrag={() => {}} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button onClick={() => addTache(phase.id)} disabled={!ajoutForm.nom}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "8px 16px", borderRadius: RADIUS.md, border: "none",
                              background: ajoutForm.nom ? phase.couleur : T.border,
                              color: ajoutForm.nom ? "#fff" : T.textMuted,
                              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
                              cursor: ajoutForm.nom ? "pointer" : "default",
                            }}>
                            <Icon as={Check} size={12}/>
                            Ajouter
                          </button>
                          <button onClick={() => { setAjoutPhase(null); setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvriers: [], date_prevue: "" }); }}
                            style={{ padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                              background: "transparent", color: T.textMuted,
                              fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer" }}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAjoutPhase(phase.id); setExpandedPhases(prev => ({ ...prev, [phase.id]: true })); }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          margin: "10px 16px 0", padding: "8px",
                          borderRadius: RADIUS.md, border: `1.5px dashed ${phase.couleur}55`,
                          background: "transparent", color: phase.couleur,
                          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600,
                          cursor: "pointer", width: "calc(100% - 32px)",
                        }}>
                        <Icon as={Plus} size={12}/>
                        Ajouter une tâche
                      </button>
                    )}

                    {/* ── Matériaux prévisionnels ── */}
                    {(() => {
                      const mats = getMateriauxPhase(phase.id);
                      const totalHt = mats.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
                      const premiere = premiereDatePhase(taches);
                      const dateCmd = vendrediSPrec(premiere);
                      const dateCmdFmt = dateCmd ? new Date(dateCmd).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : null;
                      return (
                        <div style={{ margin: "14px 16px 0", padding: "12px 14px", borderRadius: RADIUS.md, background: T.card, border: `1px dashed ${phase.couleur}55` }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.text, letterSpacing: 0.3 }}>
                                <Icon as={Package} size={12} color={phase.couleur}/>
                                Matériaux à prévoir
                                {mats.length > 0 && <span style={{ color: T.textMuted, fontWeight: 600 }}>· {mats.length}</span>}
                              </div>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, color: dateCmd ? T.textSub : T.textMuted, fontStyle: dateCmd ? "normal" : "italic" }}>
                                <Icon as={CalendarCheck} size={11}/>
                                {dateCmd ? <>À commander avant le <strong style={{ color: T.text, fontWeight: 700 }}>{dateCmdFmt}</strong></> : "Date à définir (renseigner la date prévue d'une tâche)"}
                              </div>
                            </div>
                            <button onClick={() => setAddMatPhase(phase.id)} style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "6px 12px", borderRadius: RADIUS.sm,
                              border: `1px solid ${phase.couleur}55`, background: phase.couleur + "15", color: phase.couleur,
                              fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
                            }}>
                              <Icon as={Plus} size={11}/>
                              Ajouter un matériau
                            </button>
                          </div>

                          {mats.length === 0 ? (
                            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic", padding: "4px 0" }}>
                              Aucun matériau prévu pour cette phase.
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 70px 80px 28px" : "2fr 1.2fr 70px 90px 90px 28px", gap: 8, padding: "3px 6px", fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                                <div>Matériau</div>
                                {!isMobile && <div>Fournisseur</div>}
                                <div style={{ textAlign: "center" }}>Qté</div>
                                <div style={{ textAlign: "right" }}>PU HT</div>
                                <div style={{ textAlign: "right" }}>Total HT</div>
                                <div/>
                              </div>
                              {mats.map(m => {
                                const sousTotal = (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0);
                                return (
                                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 70px 80px 28px" : "2fr 1.2fr 70px 90px 90px 28px", gap: 8, padding: "6px 6px", borderRadius: 6, background: T.surface, alignItems: "center" }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.libelle}</div>
                                      {isMobile && m.fournisseur_nom && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>{m.fournisseur_nom}</div>}
                                    </div>
                                    {!isMobile && (
                                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {m.fournisseur_nom || <span style={{ color: T.textMuted, fontStyle: "italic" }}>—</span>}
                                      </div>
                                    )}
                                    <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text, textAlign: "center" }}>
                                      {m.quantite}{m.unite ? <span style={{ color: T.textMuted, fontWeight: 400 }}> {m.unite}</span> : null}
                                    </div>
                                    <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                                      {(parseFloat(m.prix_ht) || 0).toFixed(2)} €
                                    </div>
                                    <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.accent, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                                      {sousTotal.toFixed(2)} €
                                    </div>
                                    <button onClick={() => supprimerMateriauPhase(phase.id, m.id)} title="Supprimer" style={{
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      background: "transparent", border: "none", color: "#e15a5a",
                                      cursor: "pointer", padding: 2, lineHeight: 1,
                                    }}>
                                      <Icon as={X} size={13}/>
                                    </button>
                                  </div>
                                );
                              })}
                              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "6px 10px 2px", borderTop: `1px solid ${T.sectionDivider || T.border}`, marginTop: 4 }}>
                                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Total phase</span>
                                <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.accent, fontFamily: "'DM Mono',monospace" }}>
                                  {totalHt.toFixed(2)} € HT
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Modale : ajouter un matériau prévisionnel à une phase */}
      {addMatPhase && (
        <ModaleAjoutMateriauPhase
          phaseId={addMatPhase}
          materiauxBibl={materiauxBibl}
          fournisseursBibl={fournisseursBibl}
          onClose={() => setAddMatPhase(null)}
          onAjouter={(mat) => { ajouterMateriauPhase(addMatPhase, mat); setAddMatPhase(null); }}
          T={T}
          accent={(PHASES.find(p => p.id === addMatPhase) || {}).couleur || planAcc.accent}
        />
      )}

      {/* Modale : commandes liées à une phase */}
      {showPhaseCmds && (() => {
        const cmds = commandesPhasage.filter(c => c.phase_id === showPhaseCmds);
        const total = cmds.reduce((s, c) => s + (parseFloat(c.prix_ht) || 0), 0);
        const phaseLabel = (PHASES.find(p => p.id === showPhaseCmds) || {}).label || showPhaseCmds;
        const phaseEmoji = (PHASES.find(p => p.id === showPhaseCmds) || {}).emoji || "📦";
        return (
          <div onClick={() => setShowPhaseCmds(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 720, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
              <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.sectionDivider}`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: planAcc.bg10, color: planAcc.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                  {phaseEmoji}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>{phaseLabel}</div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>{cmds.length} commande{cmds.length > 1 ? "s" : ""} · Total {Math.round(total).toLocaleString("fr-FR")} € HT</div>
                </div>
                <button onClick={() => setShowPhaseCmds(null)} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 6, borderRadius: RADIUS.md, display: "flex" }}>
                  <Icon as={X} size={18}/>
                </button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                {cmds.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: T.textMuted, fontStyle: "italic", fontSize: FONT.sm.size + 1 }}>
                    Aucune commande liée à cette phase pour l'instant.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {cmds.map(c => (
                      <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 100px 100px", gap: 10, padding: "10px 12px", background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, alignItems: "center" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.article || "—"}</div>
                          {c.notes && <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.notes}</div>}
                        </div>
                        <div style={{ fontSize: FONT.sm.size, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.fournisseur || "—"}</div>
                        <div style={{ fontSize: FONT.sm.size, color: T.textSub, textAlign: "right" }}>{c.quantite || "—"}</div>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.accent, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                          {c.prix_ht ? `${parseFloat(c.prix_ht).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €` : "—"}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: RADIUS.pill,
                            background: c.statut === "retire" ? "rgba(80,200,120,0.15)" : c.statut === "commande" ? "rgba(245,166,35,0.15)" : "rgba(224,92,92,0.15)",
                            color: c.statut === "retire" ? "#22c55e" : c.statut === "commande" ? "#f5a623" : "#e15a5a",
                          }}>
                            {c.statut === "retire" ? "Retiré" : c.statut === "commande" ? "Commandé" : c.statut === "besoin_ouvrier" ? "Besoin" : "À cmd."}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                  Pour modifier ces commandes, ouvrir l'onglet <strong style={{ color: T.text }}>Commandes</strong> dans le menu.
                </span>
                <button onClick={() => setShowPhaseCmds(null)} style={{
                  background: planAcc.accent, color: planAcc.onAccent, border: "none",
                  borderRadius: RADIUS.md, padding: "9px 18px", fontFamily: "inherit",
                  fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
                }}>Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── PHASAGE DETAIL ───────────────────────────────────────────────────────────
function PhasageDetail({ phasage, bibliotheque, T, chantiers, ouvriers, tauxHoraires, onBack, onSave, onDelete }) {
  const [ouvrages, setOuvrages] = useState(phasage.ouvrages || []);
  const [showAjout, setShowAjout] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedOuvrage, setSelectedOuvrage] = useState("");
  const [heuresInput, setHeuresInput] = useState("");
  const [quantiteInput, setQuantiteInput] = useState("");
  const [search, setSearch] = useState("");
  // Ajout manuel d'une sous-tâche à un ouvrage : on garde l'ID de l'ouvrage
  // en cours d'édition + les valeurs du mini-formulaire.
  const [ajoutSTOuvrageId, setAjoutSTOuvrageId] = useState(null);
  const [ajoutSTNom, setAjoutSTNom] = useState("");
  const [ajoutSTPhase, setAjoutSTPhase] = useState("");
  const ch = chantiers.find(c => c.id === phasage.chantier_id);
  const BLEU = "#5b9cf6";
  const hasPlan = phasage.plan_travaux && Object.values(phasage.plan_travaux).filter(v => Array.isArray(v)).some(arr => arr.length > 0);
  const [view, setView] = useState(hasPlan ? "plan" : "preparation");
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  // ─── Collab temps réel : merge par id ────────────────────────────────────
  // dirtyOuvragesRef = ids d'ouvrages modifiés localement depuis la dernière
  // save terminée. Permet, à la réception d'un update Realtime, de garder nos
  // versions locales pour ces ids et de prendre la version remote pour les
  // autres. lastSyncedSnapshotRef = JSON du dernier état synchronisé (post-save
  // ou post-merge) pour court-circuiter l'autosave si rien n'a changé.
  const dirtyOuvragesRef = useRef(new Set());
  const lastSyncedSnapshotRef = useRef(JSON.stringify(phasage.ouvrages || []));
  const markOuvrageDirty = (id) => { if (id) dirtyOuvragesRef.current.add(id); };

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (view === "plan") return;
    const snapshot = JSON.stringify(ouvrages);
    if (snapshot === lastSyncedSnapshotRef.current) return; // identique au dernier sync → rien à sauver
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      await onSave({ ...phasage, ouvrages });
      lastSyncedSnapshotRef.current = JSON.stringify(ouvrages);
      dirtyOuvragesRef.current.clear();
      setAutoSaveStatus("saved");
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
  }, [ouvrages]);

  // ─── Subscription Realtime sur ce phasage ────────────────────────────────
  // À chaque UPDATE sur la ligne, on merge avec l'état local :
  //   - items remote dont l'id est dans dirtyOuvragesRef → on garde le local
  //   - autres items remote → on prend leur version
  //   - items local-only (créés ici) restent si dirty
  useEffect(() => {
    if (!phasage?.id) return;
    const clientId = getClientId();
    const ch = supabase
      .channel(`phasage-detail-${phasage.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "phasages", filter: `id=eq.${phasage.id}` },
        (payload) => {
          const remote = payload?.new;
          if (!remote) return;
          // Filtre nos propres saves
          if (remote.plan_travaux?.meta?.last_client_id === clientId) return;
          const remoteOuvrages = Array.isArray(remote.ouvrages) ? remote.ouvrages : [];
          setOuvrages(prev => {
            const dirty = dirtyOuvragesRef.current;
            const remoteById = new Map(remoteOuvrages.map(o => [o.id, o]));
            const localById  = new Map(prev.map(o => [o.id, o]));
            const merged = [];
            remoteOuvrages.forEach(r => {
              if (dirty.has(r.id) && localById.has(r.id)) merged.push(localById.get(r.id));
              else merged.push(r);
            });
            prev.forEach(l => {
              if (!remoteById.has(l.id) && dirty.has(l.id)) merged.push(l);
            });
            // Synchronise lastSynced pour ne pas redéclencher de save inutile
            lastSyncedSnapshotRef.current = JSON.stringify(merged);
            return merged;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [phasage?.id]);

  // Génère les sous-tâches d'un ouvrage importé.
  // Refactor : on n'applique plus de ratio — les sous-tâches sont créées sans
  // heures pré-calculées. Les heures vendues totales de l'ouvrage sont
  // conservées au niveau ouvrage (ouvrage.heures_devis). La durée par
  // sous-tâche est saisie manuellement au moment de la planification semaine.
  function genererTaches(ouvrageId) {
    const bibl = bibliotheque.find(b => b.id === ouvrageId);
    if (!bibl) return [];
    return (bibl.sous_taches || []).map(st => ({
      nom: st.nom,
      phaseId: st.phaseId,
      heures: 0,
      heures_estimees: null,
      prix_ht: null,
      avancement: 0,
      heures_reelles: [],
      ressources: [],
    }));
  }

  function handleImportExcel(lignesSelectionnees) {
    const nouveaux = lignesSelectionnees.map(ligne => {
      const bibl = ligne.match;
      const quantite = parseFloat(ligne.quantite) || null;
      const cadence = parseFloat(bibl?.cadence) || null;
      const heuresEstimees = cadence && quantite ? parseFloat((cadence * quantite).toFixed(2)) : null;
      const prix_ht = parseFloat(ligne.prix_ht) || null;
      return {
        id: Math.random().toString(36).slice(2),
        bibliotheque_id: bibl?.id || null,
        libelle: ligne.libelle,
        libelle_devis: ligne.libelle_devis,
        unite: bibl?.unite || "U",
        heures_devis: ligne.heures,
        heures_estimees: heuresEstimees,
        quantite,
        prix_ht,
        taches: bibl ? genererTaches(bibl.id) : [
          {
            nom: ligne.libelle,
            phaseId: "",
            heures: 0,
            heures_estimees: null,
            prix_ht: null,
            avancement: 0,
            heures_reelles: [],
            ressources: [],
          }
        ],
      };
    });
    nouveaux.forEach(o => markOuvrageDirty(o.id));
    setOuvrages(prev => [...prev, ...nouveaux]);
    setShowImport(false);
  }

  function ajouterOuvrage() {
    if (!selectedOuvrage || !heuresInput) return;
    const bibl = bibliotheque.find(b => b.id === selectedOuvrage);
    if (!bibl) return;
    const hD = parseFloat(heuresInput), q = parseFloat(quantiteInput) || null;
    const hE = bibl.cadence && q ? parseFloat((bibl.cadence * q).toFixed(2)) : null;
    const newO = { id: Math.random().toString(36).slice(2), bibliotheque_id: selectedOuvrage, libelle: bibl.libelle, unite: bibl.unite, heures_devis: hD, quantite: q, heures_estimees: hE, taches: genererTaches(selectedOuvrage) };
    markOuvrageDirty(newO.id);
    setOuvrages(prev => [...prev, newO]);
    setShowAjout(false); setSelectedOuvrage(""); setHeuresInput(""); setQuantiteInput(""); setSearch("");
  }

  function supprimerOuvrage(id) {
    dirtyOuvragesRef.current.delete(id); // pas la peine de tracker un item supprimé
    setOuvrages(prev => prev.filter(o => o.id !== id));
  }
  function updateHeures(id, val) {
    markOuvrageDirty(id);
    setOuvrages(prev => prev.map(o => {
      if (o.id !== id) return o;
      const h = parseFloat(val) || 0;
      const bibl = bibliotheque.find(b => b.id === o.bibliotheque_id);
      // On ne régénère plus les sous-tâches quand heures_devis change, car
      // celles-ci n'ont plus de heures calculées (saisie manuelle au planning).
      return { ...o, heures_devis: h };
    }));
  }
  function updateLibelle(id, val) {
    markOuvrageDirty(id);
    setOuvrages(prev => prev.map(o => o.id !== id ? o : { ...o, libelle: val }));
  }

  // CRUD sous-tâches d'un ouvrage (préparation du devis)
  function ajouterSousTacheOuvrage(ouvrageId, nom, phaseId) {
    if (!nom?.trim()) return;
    markOuvrageDirty(ouvrageId);
    const nouvelle = {
      nom: nom.trim(),
      phaseId: phaseId || "",
      heures: 0,
      heures_estimees: null,
      prix_ht: null,
      avancement: 0,
      heures_reelles: [],
      ressources: [],
    };
    setOuvrages(prev => prev.map(o => o.id !== ouvrageId ? o : { ...o, taches: [...(o.taches || []), nouvelle] }));
  }
  function supprimerSousTacheOuvrage(ouvrageId, idx) {
    markOuvrageDirty(ouvrageId);
    setOuvrages(prev => prev.map(o => o.id !== ouvrageId ? o : { ...o, taches: (o.taches || []).filter((_, i) => i !== idx) }));
  }

  if (view === "plan") {
    return <PlanTravaux
      phasage={{ ...phasage, ouvrages }}
      ouvrages={ouvrages}
      T={T}
      ouvriers={ouvriers}
      tauxHoraires={tauxHoraires}
      onBack={() => setView("preparation")}
      onSavePlan={async (planToSave) => { await onSave({ ...phasage, plan_travaux: planToSave, ouvrages }); }}
    />;
  }

  const totalH = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
  const biblF = bibliotheque.filter(b => !search || b.libelle.toLowerCase().includes(search.toLowerCase()));
  const biblSel = bibliotheque.find(b => b.id === selectedOuvrage);
  const cadSel = parseFloat(biblSel?.cadence) || null;
  const hEstAjout = cadSel && quantiteInput ? parseFloat((cadSel * parseFloat(quantiteInput)).toFixed(2)) : null;

  const acc = getBranchAccent("renovation");
  const accentColor = ch ? ch.couleur : acc.accent;
  const totalPrix = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  const autoSaveColor = autoSaveStatus === "saved" ? "#22c55e" : autoSaveStatus === "saving" ? acc.accent : "#f5a623";
  const autoSaveLabel = autoSaveStatus === "saved" ? "Sauvegardé" : autoSaveStatus === "saving" ? "Sauvegarde…" : "Modification en cours";

  return (
    <div className="page-padding phase-detail" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <style>{`
        @media(max-width:767px){
          .phase-detail .phase-detail-header{flex-wrap:wrap;gap:10px!important;margin-bottom:14px!important}
          .phase-detail .phase-detail-header > div:nth-child(3){flex:1 1 100%;order:3}
          .phase-detail .phase-detail-header > div:last-child{flex:1 1 100%;justify-content:stretch!important;order:4;gap:8px!important}
          .phase-detail .phase-detail-header > div:last-child button{flex:1}
          .phase-detail .phase-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
          .phase-detail .phase-table-wrap > div{min-width:640px}
        }
      `}</style>

      {showImport && <ModaleImportExcel T={T} bibliotheque={bibliotheque} onImporter={handleImportExcel} onFermer={() => setShowImport(false)} />}

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* ── Bouton retour ── */}
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: RADIUS.md,
          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", marginBottom: 14,
        }}>
          <Icon as={ChevronLeftIcon} size={13}/>
          Retour aux phasages
        </button>

        <div className="phase-detail-header" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{
            width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0,
            background: accentColor + "22", border: `1.5px solid ${accentColor}55`,
            color: accentColor,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={Building2} size={20} strokeWidth={2}/>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: acc.accent, letterSpacing: 1.2, textTransform: "uppercase" }}>
                Étape 1 — Préparation du devis
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: FONT.xs.size, fontWeight: 700, color: autoSaveColor,
                background: autoSaveColor + "1A", border: `1px solid ${autoSaveColor}44`,
                borderRadius: RADIUS.pill, padding: "1px 8px",
              }}>
                {autoSaveStatus === "saving" && (
                  <svg width="10" height="10" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                  </svg>
                )}
                {autoSaveLabel}
              </span>
            </div>
            <div style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginTop: 2 }}>
              {phasage.chantier_nom}
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={Hammer} size={11}/>
                {ouvrages.length} ouvrage{ouvrages.length > 1 ? "s" : ""}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={Clock} size={11}/>
                {totalH.toFixed(1)}h vendues
              </span>
              {totalPrix > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
                  <Icon as={Euro} size={11}/>
                  {Math.round(totalPrix).toLocaleString("fr-FR")} € HT
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={onDelete} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: `1px solid rgba(224,92,92,0.3)`, background: "transparent", color: "#e15a5a",
              fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
            }}>
              <Icon as={Trash2} size={12}/>
              Supprimer
            </button>
            <button
              onClick={async () => {
                const planExistant = phasage.plan_travaux || {};
                const aDejaUnPlan = Object.keys(planExistant).filter(k => k !== 'meta').length > 0;
                // Premier passage : génération complète. Sinon : fusion qui
                // n'ajoute que les sous-tâches manquantes (préserve avancement,
                // dates, heures réelles des tâches existantes).
                const nextPlan = aDejaUnPlan
                  ? fusionnerPlanAvecOuvrages(planExistant, ouvrages)
                  : distribuerTaches(ouvrages);
                phasage.plan_travaux = nextPlan;
                await onSave({ ...phasage, plan_travaux: nextPlan, ouvrages });
                setView("plan");
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 16px", borderRadius: RADIUS.md,
                border: "none", background: acc.accent, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>
              Générer le plan de travail
              <Icon as={ChevronRight} size={13}/>
            </button>
          </div>
        </div>

        {!showAjout && (
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            <button onClick={() => setShowImport(true)} style={{
              flex: "2 1 280px",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "16px 22px", borderRadius: RADIUS.xl,
              border: `2px dashed ${acc.accent}`, background: acc.accent + "0A", color: acc.accent,
              fontFamily: "inherit", fontSize: FONT.md.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={FileSpreadsheet} size={18}/>
              Importer un devis Excel (.xlsx)
            </button>
            <button onClick={() => setShowAjout(true)} style={{
              flex: "1 1 180px",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "12px", borderRadius: RADIUS.xl,
              border: `1.5px dashed ${T.border}`, background: "transparent", color: T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
            }}>
              <Icon as={Plus} size={13}/>
              Saisie manuelle
            </button>
          </div>
        )}

        {showAjout && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>Ajouter un ouvrage depuis la bibliothèque</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer les ouvrages…" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 10 }} />
            <select value={selectedOuvrage} onChange={e => { setSelectedOuvrage(e.target.value); setQuantiteInput(""); setHeuresInput(""); }} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: selectedOuvrage ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 13, outline: "none", marginBottom: 12 }}>
              <option value="">Choisir un ouvrage…</option>
              {biblF.map(b => <option key={b.id} value={b.id}>{b.libelle} ({b.unite}){b.cadence ? ` — ${b.cadence}h/${b.unite}` : ""}</option>)}
            </select>
            {cadSel && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: `${BLEU}0D`, border: `1px solid ${BLEU}33`, borderRadius: 8 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: BLEU, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                  <Icon as={Clock} size={11}/>
                  Cadence : {cadSel}h / {biblSel?.unite}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: T.textMuted }}>Quantité :</span>
                  <input type="number" min="0" step="1" value={quantiteInput} onChange={e => { setQuantiteInput(e.target.value); const q = parseFloat(e.target.value); if (q && cadSel) setHeuresInput((cadSel * q).toFixed(1)); }} style={{ width: 100, padding: "8px 12px", borderRadius: 8, border: `1px solid ${BLEU}55`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                  <span style={{ fontSize: 13, color: T.textMuted }}>{biblSel?.unite}</span>
                  {hEstAjout && <span style={{ fontSize: 13, fontWeight: 700, color: BLEU, background: `${BLEU}15`, padding: "4px 12px", borderRadius: 6 }}>→ {hEstAjout}h estimées</span>}
                </div>
              </div>
            )}
            {biblSel && (biblSel.sous_taches || []).length > 0 && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: T.card, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Sous-tâches qui seront générées</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {(biblSel.sous_taches || []).map((st, i) => {
                    const ph = PHASES.find(p => p.id === st.phaseId);
                    return (
                      <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, background: ph ? `${ph.couleur}18` : T.card, color: ph ? ph.couleur : T.textMuted, border: `1px solid ${ph ? ph.couleur + "44" : T.border}`, fontWeight: 600 }}>
                        {ph?.emoji} {st.nom || `Tâche ${i + 1}`} · {st.ratio}%
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <span style={{ fontSize: 13, color: T.textMuted, whiteSpace: "nowrap" }}>Heures devis :</span>
                <input type="number" min="0.5" step="0.5" value={heuresInput} onChange={e => setHeuresInput(e.target.value)} placeholder="ex: 16" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" }} />
                <span style={{ fontSize: 13, color: T.textMuted }}>h</span>
              </div>
              <button onClick={ajouterOuvrage} disabled={!selectedOuvrage || !heuresInput} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: selectedOuvrage && heuresInput ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: selectedOuvrage && heuresInput ? "pointer" : "default" }}>Ajouter l'ouvrage</button>
              <button onClick={() => { setShowAjout(false); setSearch(""); setSelectedOuvrage(""); setHeuresInput(""); setQuantiteInput(""); }} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {ouvrages.length > 0 && (
          <div className="phase-table-wrap"><div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth:640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px 70px 40px", gap: 8, padding: "6px 18px" }}>
              {["Nom dans le plan", "Bibliothèque", "H. vendues", "H. estimées", "Prix HT", ""].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</div>
              ))}
            </div>
            {ouvrages.map(ouvrage => {
              const hEst = parseFloat(ouvrage.heures_estimees) || null;
              const bibl = bibliotheque.find(b => b.id === ouvrage.bibliotheque_id);
              return (
                <div key={ouvrage.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px 70px 40px", gap: 8, padding: "12px 18px", alignItems: "center" }}>
                    <div>
                      <input
                        value={ouvrage.libelle}
                        onChange={e => updateLibelle(ouvrage.id, e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }}
                      />
                      {ouvrage.libelle_devis && ouvrage.libelle_devis !== ouvrage.libelle && (
                        <div style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic", marginTop: 2 }}>Devis : "{ouvrage.libelle_devis}"</div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: bibl ? "#50c878" : T.textMuted }}>
                      {bibl ? `✓ ${bibl.libelle}` : "Libre"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="number" min="0.5" step="0.5" value={ouvrage.heures_devis} onChange={e => updateHeures(ouvrage.id, e.target.value)} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, textAlign: "center", border: `1px solid ${T.border}`, background: T.inputBg, color: T.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, outline: "none" }} />
                      <span style={{ fontSize: 11, color: T.textMuted }}>h</span>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {hEst ? <span style={{ fontSize: 13, fontWeight: 800, color: BLEU }}>{hEst}h</span> : <span style={{ fontSize: 12, color: T.textMuted }}>—</span>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {ouvrage.prix_ht ? <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{ouvrage.prix_ht.toFixed(0)} €</span> : <span style={{ fontSize: 12, color: T.textMuted }}>—</span>}
                    </div>
                    <button onClick={() => supprimerOuvrage(ouvrage.id)} title="Supprimer cet ouvrage" style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: "5px 8px", borderRadius: RADIUS.sm,
                      border: `1px solid rgba(224,92,92,0.3)`, background: "transparent", color: "#e15a5a",
                      fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
                    }}>
                      <Icon as={Trash2} size={12}/>
                    </button>
                  </div>
                  <div style={{ padding: "8px 18px 12px", borderTop: `1px solid ${T.sectionDivider}` }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                      {(ouvrage.taches || []).map((t, i) => {
                        const ph = PHASES.find(p => p.id === (t.phaseId || matchPhase(t.nom)));
                        return (
                          <span key={i} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 10, padding: "3px 6px 3px 8px", borderRadius: 4,
                            background: ph ? `${ph.couleur}18` : T.card,
                            color: ph ? ph.couleur : T.textMuted,
                            border: `1px solid ${ph ? ph.couleur + "33" : T.border}`,
                            fontWeight: 600,
                          }}>
                            {ph?.emoji} {t.nom}
                            <button onClick={() => supprimerSousTacheOuvrage(ouvrage.id, i)} title="Supprimer cette sous-tâche"
                              style={{ background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 0, display: "inline-flex", lineHeight: 1, marginLeft: 2 }}>
                              <Icon as={X} size={10}/>
                            </button>
                          </span>
                        );
                      })}
                      {ajoutSTOuvrageId === ouvrage.id ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: 3, background: T.card, borderRadius: 4, border: `1px solid ${T.accent}55` }}>
                          <input
                            autoFocus value={ajoutSTNom} onChange={e => setAjoutSTNom(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { ajouterSousTacheOuvrage(ouvrage.id, ajoutSTNom, ajoutSTPhase); setAjoutSTOuvrageId(null); setAjoutSTNom(""); setAjoutSTPhase(""); } if (e.key === "Escape") { setAjoutSTOuvrageId(null); setAjoutSTNom(""); setAjoutSTPhase(""); } }}
                            placeholder="Nom de la sous-tâche"
                            style={{ padding: "3px 6px", borderRadius: 3, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 11, outline: "none", width: 160 }}
                          />
                          <select value={ajoutSTPhase} onChange={e => setAjoutSTPhase(e.target.value)}
                            style={{ padding: "3px 4px", borderRadius: 3, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 10, outline: "none", cursor: "pointer" }}>
                            <option value="">Auto…</option>
                            {PHASES.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>)}
                          </select>
                          <button onClick={() => { ajouterSousTacheOuvrage(ouvrage.id, ajoutSTNom, ajoutSTPhase); setAjoutSTOuvrageId(null); setAjoutSTNom(""); setAjoutSTPhase(""); }}
                            disabled={!ajoutSTNom.trim()}
                            style={{ padding: "3px 7px", borderRadius: 3, border: "none", background: ajoutSTNom.trim() ? T.accent : T.border, color: ajoutSTNom.trim() ? "#111" : T.textMuted, fontFamily: "inherit", fontSize: 10, fontWeight: 700, cursor: ajoutSTNom.trim() ? "pointer" : "default" }}>
                            OK
                          </button>
                          <button onClick={() => { setAjoutSTOuvrageId(null); setAjoutSTNom(""); setAjoutSTPhase(""); }}
                            style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 0, display: "inline-flex", lineHeight: 1 }}>
                            <Icon as={X} size={11}/>
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => { setAjoutSTOuvrageId(ouvrage.id); setAjoutSTNom(""); setAjoutSTPhase(""); }}
                          title="Ajouter une sous-tâche à cet ouvrage"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: 11, padding: "4px 10px", borderRadius: 6,
                            background: `${T.accent}18`, border: `1px dashed ${T.accent}66`,
                            color: T.accent, fontFamily: "inherit", fontWeight: 700,
                            cursor: "pointer",
                          }}>
                          <Icon as={Plus} size={11}/>
                          Ajouter une sous-tâche
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px 70px 40px", gap: 8, padding: "10px 18px", background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>TOTAL</div>
              <div />
              <div style={{ fontSize: 13, fontWeight: 800, color: T.accent, textAlign: "center" }}>{totalH.toFixed(1)}h</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: BLEU, textAlign: "center" }}>
                {ouvrages.reduce((s, o) => s + (parseFloat(o.heures_estimees) || 0), 0) > 0
                  ? `${ouvrages.reduce((s, o) => s + (parseFloat(o.heures_estimees) || 0), 0).toFixed(1)}h` : "—"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text, textAlign: "right" }}>
                {ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0) > 0
                  ? `${ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0).toFixed(0)} €` : "—"}
              </div>
              <div />
            </div>
          </div></div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── RAPPORT MODAL ────────────────────────────────────────────────────────────
function RapportModal({ phasages, chantiers, tauxHoraires, pointagesByChantier = {}, onFermer }) {
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const donneesChantiers = phasages.map(p => {
    const ch = chantiers.find(c => c.id === p.chantier_id);
    const tPlan = p.plan_travaux
      ? Object.values(p.plan_travaux).filter(arr => Array.isArray(arr)).flat()
      : [];
    const totalHVendu = tPlan.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
    const totalHEstimee = tPlan.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

    // Avancement pondéré par prix HT au niveau ouvrage (cf. calcAvancementPondere)
    const avgAv = calcAvancementPondere(p.ouvrages || [], tPlan);

    // P9 : coût MO + heures réelles dérivés du registre (repli legacy par tâche)
    const ptsCh = pointagesByChantier[p.chantier_id] || [];
    const ptsIdx = indexPointagesParTache(ptsCh);
    const extras = sumLibreEtIndirect(ptsCh);
    const coutMOTaches = tPlan.reduce((s, t) => s + coutMOEffShared(t, ptsIdx, tauxHoraires), 0);
    const coutMO = coutMOTaches + (extras.coutLibre || 0) + (extras.coutIndirect || 0);
    const coutMat = tPlan.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
    const coutTotal = coutMO + coutMat;
    const prixVendu = parseFloat(p.plan_travaux?.meta?.prix_vendu) || 0;
    const marge = prixVendu - coutTotal;
    const margePct = prixVendu > 0 ? (marge / prixVendu) * 100 : null;
    const terminees = tPlan.filter(t => (parseFloat(t.avancement) || 0) === 100).length;
    const totalHReel = tPlan.reduce((s, t) => s + heuresEffShared(t, ptsIdx), 0)
                     + (extras.heuresLibre || 0) + (extras.heuresIndirect || 0);

    return {
      nom: p.chantier_nom,
      couleur: ch?.couleur || "#5b9cf6",
      nbTaches: tPlan.length,
      terminees,
      avancement: avgAv,
      totalHVendu,
      totalHReel,
      coutTotal,
      prixVendu,
      marge,
      margePct,
    };
  });

  const totalVendu = donneesChantiers.reduce((s, c) => s + c.prixVendu, 0);
  const totalCout = donneesChantiers.reduce((s, c) => s + c.coutTotal, 0);
  const totalMarge = totalVendu - totalCout;
  const avgAvancement = donneesChantiers.length > 0
    ? Math.round(donneesChantiers.reduce((s, c) => s + c.avancement, 0) / donneesChantiers.length)
    : 0;

  function imprimer() {
    const win = window.open("", "_blank", "width=900,height=700");
    win.document.write(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Rapport Chantiers — PROFERO</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f8f6; color: #1a1a1a; padding: 40px; }
          .page-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 36px; padding-bottom: 20px; border-bottom: 2px solid #1a1a1a; }
          .logo { font-size: 28px; font-weight: 900; letter-spacing: -1px; color: #1a1a1a; }
          .logo span { color: #f5a623; }
          .date { font-size: 13px; color: #666; }
          .titre-rapport { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #666; margin-bottom: 4px; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 32px; }
          .kpi { background: white; border-radius: 10px; padding: 16px 20px; border: 1px solid #e8e8e4; }
          .kpi-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 6px; }
          .kpi-val { font-size: 24px; font-weight: 800; color: #1a1a1a; }
          .kpi-val.green { color: #1a7a4a; }
          .kpi-val.red { color: #c0392b; }
          .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 12px; }
          .chantier-card { background: white; border-radius: 10px; padding: 18px 20px; margin-bottom: 10px; border: 1px solid #e8e8e4; display: grid; grid-template-columns: 4px 1fr auto; gap: 16px; align-items: center; }
          .couleur-bar { width: 4px; height: 100%; border-radius: 2px; min-height: 40px; }
          .ch-nom { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
          .ch-meta { font-size: 12px; color: #888; display: flex; gap: 16px; flex-wrap: wrap; }
          .ch-meta span { font-weight: 500; }
          .progress-wrap { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
          .progress-bg { flex: 1; height: 5px; background: #e8e8e4; border-radius: 3px; overflow: hidden; }
          .progress-fill { height: 100%; border-radius: 3px; }
          .progress-pct { font-size: 12px; font-weight: 800; min-width: 36px; text-align: right; }
          .ch-financier { text-align: right; min-width: 140px; }
          .ch-vendu { font-size: 12px; color: #888; margin-bottom: 4px; }
          .ch-marge { font-size: 16px; font-weight: 800; }
          .ch-marge.green { color: #1a7a4a; }
          .ch-marge.red { color: #c0392b; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e8e8e4; display: flex; justify-content: space-between; font-size: 11px; color: #aaa; }
          @media print { body { background: white; padding: 20px; } @page { margin: 1cm; } }
        </style>
      </head>
      <body>
        <div class="page-header">
          <div>
            <div class="titre-rapport">Rapport d'avancement</div>
            <div class="logo">PRO<span>FERO</span></div>
          </div>
          <div class="date">${dateStr}</div>
        </div>

        <div class="kpis">
          <div class="kpi">
            <div class="kpi-label">Chantiers actifs</div>
            <div class="kpi-val">${phasages.length}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Avancement moyen</div>
            <div class="kpi-val">${avgAvancement}%</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">CA total vendu</div>
            <div class="kpi-val">${totalVendu > 0 ? totalVendu.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €" : "—"}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Marge nette globale</div>
            <div class="kpi-val ${totalMarge >= 0 ? "green" : "red"}">${totalVendu > 0 ? (totalMarge >= 0 ? "+" : "") + totalMarge.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €" : "—"}</div>
          </div>
        </div>

        <div class="section-title">Détail par chantier</div>
        ${donneesChantiers.map(ch => `
          <div class="chantier-card">
            <div class="couleur-bar" style="background: ${ch.couleur};"></div>
            <div>
              <div class="ch-nom">${ch.nom}</div>
              <div class="ch-meta">
                <span>${ch.nbTaches} tâche${ch.nbTaches > 1 ? "s" : ""}</span>
                <span>${ch.terminees} terminée${ch.terminees > 1 ? "s" : ""}</span>
                ${ch.totalHVendu > 0 ? `<span>${ch.totalHVendu.toFixed(1)}h vendues</span>` : ""}
                ${ch.totalHReel > 0 ? `<span>${ch.totalHReel.toFixed(1)}h réelles</span>` : ""}
              </div>
              <div class="progress-wrap">
                <div class="progress-bg">
                  <div class="progress-fill" style="width: ${ch.avancement}%; background: ${ch.avancement === 100 ? "#1a7a4a" : ch.couleur};"></div>
                </div>
                <div class="progress-pct" style="color: ${ch.avancement === 100 ? "#1a7a4a" : ch.couleur};">${ch.avancement}%</div>
              </div>
            </div>
            <div class="ch-financier">
              ${ch.prixVendu > 0 ? `<div class="ch-vendu">Vendu : ${ch.prixVendu.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>` : ""}
              ${ch.marge !== 0 && ch.prixVendu > 0
                ? `<div class="ch-marge ${ch.marge >= 0 ? "green" : "red"}">${ch.marge >= 0 ? "+" : ""}${ch.marge.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>`
                : ch.coutTotal > 0 ? `<div class="ch-marge" style="color:#888;">${ch.coutTotal.toFixed(0)} € coûts</div>` : ""}
              ${ch.margePct !== null ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">${ch.margePct.toFixed(1)}% marge</div>` : ""}
            </div>
          </div>
        `).join("")}

        <div class="footer">
          <span>PROFERO — planning-chantiers.vercel.app</span>
          <span>Généré le ${dateStr}</span>
        </div>

        <script>window.onload = () => window.print();<\/script>
      </body>
      </html>
    `);
    win.document.close();
  }

  const TM = {
    surface: "#1a1a1a",
    card: "#242424",
    border: "rgba(255,255,255,0.1)",
    text: "#f0f0ee",
    textMuted: "#888",
    accent: "#f5a623",
    inputBg: "#2a2a2a",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }} onClick={onFermer}>
      <div style={{ background: TM.surface, borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "88vh", border: `1px solid ${TM.border}`, boxShadow: "0 32px 80px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: "20px 28px 18px", borderBottom: `1px solid ${TM.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: TM.accent, marginBottom: 4 }}>Rapport d'avancement</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: TM.text, letterSpacing: -0.5 }}>PRO<span style={{ color: TM.accent }}>FERO</span></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: TM.textMuted }}>{dateStr}</div>
            <button
              onClick={imprimer}
              style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: TM.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimer / PDF
            </button>
            <button onClick={onFermer} style={{ background: "transparent", border: "none", color: TM.textMuted, fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "4px 6px" }}>✕</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: "18px 28px", borderBottom: `1px solid ${TM.border}`, flexShrink: 0 }}>
          {[
            { label: "Chantiers", val: phasages.length },
            { label: "Avancement moy.", val: `${avgAvancement}%`, color: avgAvancement === 100 ? "#50c878" : TM.accent },
            { label: "CA total vendu", val: totalVendu > 0 ? `${totalVendu.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €` : "—" },
            { label: "Marge nette", val: totalVendu > 0 ? `${totalMarge >= 0 ? "+" : ""}${totalMarge.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €` : "—", color: totalMarge >= 0 ? "#50c878" : "#e05c5c" },
          ].map(k => (
            <div key={k.label} style={{ background: TM.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${TM.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: TM.textMuted, marginBottom: 5 }}>{k.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.color || TM.text }}>{k.val}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {donneesChantiers.map((ch, i) => (
              <div key={i} style={{ background: TM.card, borderRadius: 10, border: `1px solid ${TM.border}`, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 14, padding: "14px 16px", alignItems: "center" }}>
                  <div style={{ width: 4, height: "100%", minHeight: 44, borderRadius: 2, background: ch.couleur }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TM.text, marginBottom: 4 }}>{ch.nom}</div>
                    <div style={{ fontSize: 11, color: TM.textMuted, display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                      <span><strong style={{ color: TM.text }}>{ch.nbTaches}</strong> tâches</span>
                      <span><strong style={{ color: "#50c878" }}>{ch.terminees}</strong> terminées</span>
                      {ch.totalHVendu > 0 && <span><strong style={{ color: TM.accent }}>{ch.totalHVendu.toFixed(1)}h</strong> vendues</span>}
                      {ch.totalHReel > 0 && <span><strong style={{ color: ch.totalHReel > ch.totalHVendu && ch.totalHVendu > 0 ? "#e05c5c" : TM.text }}>{ch.totalHReel.toFixed(1)}h</strong> réelles</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: ch.avancement === 100 ? "#50c878" : ch.couleur, width: `${ch.avancement}%`, transition: "width .4s" }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: ch.avancement === 100 ? "#50c878" : ch.couleur, minWidth: 36 }}>{ch.avancement}%</span>
                    </div>
                  </div>
                  {(ch.prixVendu > 0 || ch.coutTotal > 0) && (
                    <div style={{ textAlign: "right", minWidth: 120 }}>
                      {ch.prixVendu > 0 && <div style={{ fontSize: 11, color: TM.textMuted, marginBottom: 3 }}>Vendu : {ch.prixVendu.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>}
                      {ch.prixVendu > 0 && (
                        <div style={{ fontSize: 16, fontWeight: 800, color: ch.marge >= 0 ? "#50c878" : "#e05c5c" }}>
                          {ch.marge >= 0 ? "+" : ""}{ch.marge.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
                        </div>
                      )}
                      {ch.margePct !== null && <div style={{ fontSize: 10, color: TM.textMuted, marginTop: 2 }}>{ch.margePct.toFixed(1)}% marge</div>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "12px 28px", borderTop: `1px solid ${TM.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: TM.textMuted }}>Le bouton <strong style={{ color: TM.text }}>Imprimer / PDF</strong> ouvre une fenêtre d'impression — choisis "Enregistrer en PDF" dans ton navigateur.</div>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE PHASAGE (ENTRÉE PRINCIPALE) ─────────────────────────────────────────
function PagePhasage({ chantiers, ouvriers, tauxHoraires, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [phasages, setPhasages] = useState([]);
  // P9 : pointages tous chantiers, regroupés en map { chantier_id: [pointages] }
  const [pointagesByChantier, setPointagesByChantier] = useState({});
  const [bibliotheque, setBibliotheque] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newChantier, setNewChantier] = useState("");
  const [newTplId, setNewTplId]       = useState("");
  const [phasageTemplates, setPhasageTemplates] = useState([]);
  const [showRapport, setShowRapport] = useState(false);
  const [ganttPhasage, setGanttPhasage] = useState(null);
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("tous");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Retrouve le chantier correspondant à un phasage : id exact d'abord,
  // sinon match par nom (un phasage peut être lié par nom seulement).
  const trouverChantierPourPhasage = (phasage) => {
    if (!phasage) return null;
    const exact = chantiers.find(c => c.id === phasage.chantier_id);
    if (exact) return exact;
    const nomP = normalise(phasage.chantier_nom || "");
    if (!nomP) return null;
    return chantiers.find(c => {
      const nomC = normalise(c.nom || "");
      if (!nomC) return false;
      if (nomC === nomP || nomC.includes(nomP) || nomP.includes(nomC)) return true;
      const motsC = nomC.split(" ").filter(m => m.length > 2);
      const motsP = nomP.split(" ").filter(m => m.length > 2);
      return motsC.some(m => motsP.includes(m));
    }) || null;
  };

  // Statut effectif d'un phasage. Source de vérité = chantier.statut
  // (modifiable depuis la page Chantiers). Fallbacks : phasage.statut, puis
  // déduction depuis l'avancement.
  const getStatutPhasage = (phasage, avgAv, hasPlan) => {
    const chantier = trouverChantierPourPhasage(phasage);
    if (chantier?.statut) return chantier.statut;
    if (phasage?.statut)  return phasage.statut;
    if (!hasPlan)         return "planifie";
    if (avgAv >= 100)     return "termine";
    if (avgAv > 0)        return "en_cours";
    return "planifie";
  };

  useEffect(() => { loadAll(); }, []);
  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: b }, { data: cfg }, ptsQ] = await Promise.all([
      supabase.from("phasages").select("*").order("created_at", { ascending: false }),
      supabase.from("bibliotheque_ratios").select("*").order("libelle"),
      supabase.from("planning_config").select("value").eq("key", "phasage_templates").maybeSingle(),
      supabase.from("pointages").select("chantier_id,tache_id,heures,taux_horaire,type_pointage,motif_indirect"),
    ]);
    // P9 : regroupe les pointages par chantier (repli vide si table absente)
    const byCh = {};
    if (!ptsQ?.error) (ptsQ.data || []).forEach(pt => {
      const k = pt.chantier_id;
      if (!byCh[k]) byCh[k] = [];
      byCh[k].push(pt);
    });
    setPointagesByChantier(byCh);
    setPhasages(p || []); setBibliotheque(b || []); setLoading(false);
    if (cfg?.value?.items && Array.isArray(cfg.value.items)) setPhasageTemplates(cfg.value.items);
  }

  async function creerPhasage() {
    if (!newChantier) return;
    const ch = chantiers.find(c => c.id === newChantier);
    // Si un template est sélectionné, on duplique ses ouvrages
    let ouvragesInit = [];
    if (newTplId) {
      const tpl = phasageTemplates.find(t => t.id === newTplId);
      if (tpl && Array.isArray(tpl.ouvrages)) {
        ouvragesInit = tpl.ouvrages.map(o => ({
          id: Math.random().toString(36).slice(2),
          libelle: o.libelle || "",
          unite: o.unite || "U",
          heures_devis: parseFloat(o.heures) || 0,
          quantite: null,
          heures_estimees: null,
          taches: [],
        }));
      }
    }
    const { data, error } = await supabase.from("phasages").insert({
      chantier_id: newChantier,
      chantier_nom: ch ? ch.nom : newChantier,
      ouvrages: ouvragesInit,
    }).select().single();
    if (error) { console.error(error.message); return; }
    if (data) { setPhasages(p => [data, ...p]); setSelected(data); setShowNew(false); setNewChantier(""); setNewTplId(""); }
  }

  async function savePhasage(phasage) {
    // Garde anti-écrasement : si la sauvegarde s'apprête à faire disparaître
    // une grande partie des données (cas typique : autosave concurrent qui
    // pousse un état local non hydraté), on demande confirmation explicite.
    // Le trigger SQL phasages_history sert de filet final, mais on évite
    // ici de polluer l'historique avec des wipes accidentels.
    const prev = phasages.find(p => p.id === phasage.id);
    if (prev) {
      const countTaches = (p) => Object.values(p?.plan_travaux || {})
        .filter(Array.isArray).reduce((s, arr) => s + arr.length, 0);
      const countOuvrages = (p) => Array.isArray(p?.ouvrages) ? p.ouvrages.length : 0;
      const prevT = countTaches(prev),    nextT = countTaches(phasage);
      const prevO = countOuvrages(prev),  nextO = countOuvrages(phasage);
      const okT = confirmPerteMassive({ label: "Tâches",   avant: prevT, apres: nextT, seuilMin: 5,
        contexte: "Sauvegarde du phasage : on s'apprête à écraser le distant par un état plus réduit." });
      // Si l'utilisateur a déjà confirmé/refusé sur les tâches, on ne le redemande
      // pour les ouvrages que si le verdict tâches n'a pas déjà tranché.
      const okO = okT ? confirmPerteMassive({ label: "Ouvrages", avant: prevO, apres: nextO, seuilMin: 2,
        contexte: "Sauvegarde du phasage : on s'apprête à écraser le distant par un état plus réduit." }) : false;
      if (!okT || !okO) {
        console.warn("[savePhasage] Perte massive refusée/annulée", {
          phasage_id: phasage.id, taches: { avant: prevT, apres: nextT }, ouvrages: { avant: prevO, apres: nextO },
        });
        // Force un refresh depuis Supabase pour resynchroniser l'état local
        // avec le distant et éviter qu'un autosave immédiat ne repropose
        // la même suppression.
        const { data } = await supabase.from("phasages").select("*").eq("id", phasage.id).maybeSingle();
        if (data) {
          setPhasages(p => p.map(x => x.id === data.id ? data : x));
          if (selected?.id === data.id) setSelected(data);
        }
        return;
      }
    }
    // Étiquette la save avec notre client_id pour que les autres tabs/onglets
    // sachent que c'est notre update et ne nous le réinjectent pas. On le stocke
    // dans plan_travaux.meta pour éviter une nouvelle colonne en base.
    const clientId = getClientId();
    const planTrav = phasage.plan_travaux || {};
    const planTravWithMeta = {
      ...planTrav,
      meta: { ...(planTrav.meta || {}), last_client_id: clientId, last_saved_at: Date.now() },
    };
    const phasageOut = { ...phasage, plan_travaux: planTravWithMeta };
    const { error } = await supabase.from("phasages").update({
      ouvrages: phasageOut.ouvrages,
      plan_travaux: planTravWithMeta,
      updated_at: new Date().toISOString(),
    }).eq("id", phasage.id);
    if (error) { console.error(error.message); return; }
    setPhasages(prev => prev.map(p => p.id === phasage.id ? phasageOut : p));
    if (selected?.id === phasage.id) setSelected(phasageOut);
  }

  async function supprimerPhasage(id) {
    setDeleting(true);
    await supabase.from("phasages").delete().eq("id", id);
    setPhasages(prev => prev.filter(p => p.id !== id));
    if (selected?.id === id) setSelected(null);
    setDeleting(false);
    setToDelete(null);
  }

  if (selected) return <PhasageDetail phasage={selected} bibliotheque={bibliotheque} T={T} chantiers={chantiers} ouvriers={ouvriers} tauxHoraires={tauxHoraires} onBack={() => setSelected(null)} onSave={savePhasage} onDelete={() => supprimerPhasage(selected.id)} />;

  // ── Stats globales : on calcule en parcourant les phasages (P9 : registre)
  const calcsByPhasage = phasages.map(p => {
    const tPlan = p.plan_travaux ? Object.values(p.plan_travaux).filter(arr => Array.isArray(arr)).flat() : [];
    const totalHVendu   = tPlan.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
    const totalHEstimee = tPlan.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
    // P9 : pointages du chantier → index + extras (libres / indirects)
    const ptsCh = pointagesByChantier[p.chantier_id] || [];
    const ptsIdx = indexPointagesParTache(ptsCh);
    const extras = sumLibreEtIndirect(ptsCh);
    const totalHReel = tPlan.reduce((s, t) => s + heuresEffShared(t, ptsIdx), 0)
                     + (extras.heuresLibre || 0) + (extras.heuresIndirect || 0);
    // Avancement pondéré par prix HT au niveau ouvrage (cf. calcAvancementPondere)
    const avgAv = calcAvancementPondere(p.ouvrages || [], tPlan);
    const coutMOTaches = tPlan.reduce((s, t) => s + coutMOEffShared(t, ptsIdx, tauxHoraires), 0);
    const coutMO = coutMOTaches + (extras.coutLibre || 0) + (extras.coutIndirect || 0);
    const coutMat = tPlan.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
    const coutTotal = coutMO + coutMat;
    const prixVendu = p.plan_travaux?.meta?.prix_vendu || 0;
    const marge = prixVendu > 0 ? prixVendu - coutTotal : 0;
    return { p, tPlan, avgAv, coutMO, coutMat, coutTotal, prixVendu, marge, totalHVendu, totalHEstimee, totalHReel };
  });

  const stats = {
    total:     phasages.length,
    actifs:    calcsByPhasage.filter(x => x.avgAv > 0 && x.avgAv < 100).length,
    termines:  calcsByPhasage.filter(x => x.avgAv === 100 && x.tPlan.length > 0).length,
    coutTotal: calcsByPhasage.reduce((s, x) => s + x.coutTotal, 0),
    margeTotale: calcsByPhasage.reduce((s, x) => s + x.marge, 0),
  };

  // ── Filtrage : recherche + statut ───────────────────────────────────────────
  const calcsFiltres = calcsByPhasage.filter(({ p, avgAv, tPlan }) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.chantier_nom?.toLowerCase().includes(q)) return false;
    }
    if (statutFilter !== "tous") {
      if (getStatutPhasage(p, avgAv, tPlan.length > 0) !== statutFilter) return false;
    }
    return true;
  });

  // Comptes par statut (pour les pastilles)
  const statutCounts = calcsByPhasage.reduce((acc, { p, avgAv, tPlan }) => {
    const s = getStatutPhasage(p, avgAv, tPlan.length > 0);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page-padding phase-list" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <style>{`
        @media(max-width:767px){
          .phase-list .phase-list-header{flex-direction:column;align-items:stretch!important;gap:10px!important;margin-bottom:14px!important}
          .phase-list .phase-list-actions{flex-wrap:wrap}
          .phase-list .phase-list-actions button{flex:1}
          .phase-list .phase-row{flex-wrap:wrap;padding:12px 14px!important;gap:10px!important}
          .phase-list .phase-row > div:nth-child(2){flex:1 1 calc(100% - 26px)}
          .phase-list .phase-row > div:nth-child(3){flex:1 1 100%;justify-content:flex-end}
        }
      `}</style>

      {showRapport && (
        <RapportModal
          phasages={phasages}
          chantiers={chantiers}
          tauxHoraires={tauxHoraires}
          pointagesByChantier={pointagesByChantier}
          onFermer={() => setShowRapport(false)}
        />
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* ── Header ── */}
        <div className="phase-list-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: RADIUS.md,
              background: acc.bg10, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon as={ClipboardList} size={20} strokeWidth={2}/>
            </div>
            <div>
              <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 2 }}>Phasages chantiers</div>
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Avancement, coûts main-d'œuvre et ressources par tâche</div>
            </div>
          </div>
          <div className="phase-list-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setShowRapport(true)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={BarChart3} size={13}/>
              Rapport
            </button>
            <button onClick={() => setShowNew(true)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: RADIUS.md,
              border: "none", background: acc.accent, color: acc.onAccent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={Plus} size={14}/>
              Nouveau phasage
            </button>
          </div>
        </div>

        {/* ── Stats ── */}
        {!loading && phasages.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 10, marginBottom: 14,
          }}>
            {[
              { label: "Total",     value: stats.total,    icon: ClipboardList, color: acc.accent },
              { label: "En cours",  value: stats.actifs,   icon: Hammer,        color: "#5b9cf6" },
              { label: "Terminés",  value: stats.termines, icon: TrendingUp,    color: "#22c55e" },
              { label: "Coût cumulé", value: stats.coutTotal > 0 ? `${Math.round(stats.coutTotal).toLocaleString("fr-FR")}€` : "—", icon: Euro, color: "#f5a623" },
              { label: "Marge",     value: stats.margeTotale !== 0 ? `${Math.round(stats.margeTotale).toLocaleString("fr-FR")}€` : "—",
                icon: TrendingUp, color: stats.margeTotale > 0 ? "#22c55e" : stats.margeTotale < 0 ? "#e15a5a" : T.textMuted },
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
                  <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, letterSpacing: -.5, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Recherche + filtre par statut ── */}
        {!loading && phasages.length > 0 && (
          <div style={{
            display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px",
          }}>
            <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 380 }}>
              <Icon as={Search} size={13} color={T.textMuted}
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un phasage…"
                style={{ width: "100%", background: T.fieldBg || T.card, border: `1px solid ${T.fieldBorder || T.border}`,
                  borderRadius: RADIUS.md, padding: "8px 10px 8px 30px", color: T.text,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none" }}/>
            </div>
            {/* Filtres par statut */}
            {(() => {
              const filters = [
                { key: "tous",     label: "Tous",     count: phasages.length,            color: T.textSub },
                { key: "planifie", label: "Planifié", count: statutCounts.planifie || 0, color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
                { key: "en_cours", label: "En cours", count: statutCounts.en_cours || 0, color: "#FFC300", bg: "rgba(255,195,0,0.15)" },
                { key: "termine",  label: "Terminé",  count: statutCounts.termine  || 0, color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
              ];
              return filters.map(f => {
                const active = statutFilter === f.key;
                return (
                  <button key={f.key} onClick={() => setStatutFilter(f.key)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", borderRadius: RADIUS.pill,
                    border: `1px solid ${active ? (f.color || acc.accent) : T.border}`,
                    background: active ? (f.bg || acc.bg10) : "transparent",
                    color: active ? (f.color || acc.accent) : T.textSub,
                    fontSize: FONT.xs.size + 1, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "all .15s",
                  }}>
                    {f.label}
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700,
                      padding: "1px 6px", borderRadius: RADIUS.pill,
                      background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                      color: active ? (f.color || acc.accent) : T.textMuted,
                    }}>{f.count}</span>
                  </button>
                );
              });
            })()}
            <div style={{ marginLeft: "auto", fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600 }}>
              {calcsFiltres.length} / {phasages.length}
            </div>
          </div>
        )}

        {/* ── Modale nouveau phasage ── */}
        {showNew && (
          <div onClick={() => { setShowNew(false); setNewChantier(""); }} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 500,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: T.modal, borderRadius: RADIUS.xl, padding: 24,
              width: "100%", maxWidth: 480, border: `1px solid ${T.border}`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon as={Plus} size={16}/>
                </div>
                <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Nouveau phasage</div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  color: T.textMuted, marginBottom: 6 }}>Chantier</div>
                <select value={newChantier} onChange={e => setNewChantier(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: RADIUS.md,
                    border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                    color: newChantier ? T.text : T.textMuted, fontFamily: "inherit", fontSize: FONT.sm.size,
                    outline: "none", cursor: "pointer" }}>
                  <option value="">— Choisir un chantier —</option>
                  {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              {phasageTemplates.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                    color: T.textMuted, marginBottom: 6 }}>Modèle (optionnel)</div>
                  <select value={newTplId} onChange={e => setNewTplId(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: RADIUS.md,
                      border: `1px solid ${T.fieldBorder || T.border}`, background: T.fieldBg || T.card,
                      color: newTplId ? T.text : T.textMuted, fontFamily: "inherit", fontSize: FONT.sm.size,
                      outline: "none", cursor: "pointer" }}>
                    <option value="">— Phasage vide —</option>
                    {phasageTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.nom} ({(t.ouvrages||[]).length} ouvrage{(t.ouvrages||[]).length>1?"s":""})
                      </option>
                    ))}
                  </select>
                  {newTplId && (
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 5, fontStyle: "italic" }}>
                      Les ouvrages du modèle seront pré-remplis. Tu pourras ensuite les ajuster ou importer un devis Excel.
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => { setShowNew(false); setNewChantier(""); setNewTplId(""); }} style={{
                  padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub,
                  fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer" }}>Annuler</button>
                <button onClick={creerPhasage} disabled={!newChantier} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                  background: newChantier ? acc.accent : T.border, color: acc.onAccent,
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                  cursor: newChantier ? "pointer" : "default", opacity: newChantier ? 1 : .5 }}>
                  <Icon as={Plus} size={13}/>
                  Créer et importer le devis
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modale confirmation suppression ── */}
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
                <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Supprimer ce phasage&nbsp;?</div>
              </div>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 20 }}>
                Le phasage de <strong style={{ color: T.text }}>« {toDelete.chantier_nom} »</strong> sera supprimé avec toutes ses tâches, ses heures réelles et son plan de travaux.
                <br/><span style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>Cette action est irréversible.</span>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setToDelete(null)} disabled={deleting}
                  style={{ background: "transparent", border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub,
                    fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer", opacity: deleting ? .5 : 1 }}>
                  Annuler
                </button>
                <button onClick={() => supprimerPhasage(toDelete.id)} disabled={deleting}
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

        {/* ── Liste / état vide ── */}
        {loading
          ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60, fontSize: FONT.sm.size }}>Chargement…</div>
          : phasages.length === 0
            ? (
              <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl,
                padding: "48px 32px", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
                <div style={{
                  width: 56, height: 56, borderRadius: RADIUS.lg,
                  background: acc.bg10, color: acc.accent,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
                }}>
                  <Icon as={ClipboardList} size={28} strokeWidth={1.5}/>
                </div>
                <div style={{ fontSize: FONT.lg.size, fontWeight: 700, color: T.text, marginBottom: 8 }}>Aucun phasage</div>
                <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.7, marginBottom: 22 }}>
                  Crée un phasage pour suivre l'avancement, les coûts main-d'œuvre et les ressources tâche par tâche.
                </div>
                <button onClick={() => setShowNew(true)} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: acc.accent, color: acc.onAccent, border: "none",
                  borderRadius: RADIUS.md, padding: "11px 22px",
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer" }}>
                  <Icon as={Plus} size={14}/>
                  Créer mon premier phasage
                </button>
              </div>
            )
            : calcsFiltres.length === 0
              ? (
                <div style={{ background: T.card, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl,
                  padding: "32px 24px", textAlign: "center", color: T.textSub, fontSize: FONT.sm.size }}>
                  Aucun phasage ne correspond à cette recherche.
                </div>
              )
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {calcsFiltres.map(({ p, tPlan, avgAv, coutTotal, prixVendu, marge, totalHReel }) => {
                  const ch = trouverChantierPourPhasage(p);
                  const accentColor = ch ? ch.couleur : acc.accent;
                  const statut = getStatutPhasage(p, avgAv, tPlan.length > 0);
                  const STATUT_DEF = {
                    planifie: { label: "Planifié", color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)" },
                    en_cours: { label: "En cours", color: "#FFC300", bg: "rgba(255,195,0,0.12)",  border: "rgba(255,195,0,0.3)" },
                    en_pause: { label: "En pause", color: "#f97316", bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.3)" },
                    termine:  { label: "Terminé",  color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)"  },
                  }[statut] || null;
                  return (
                    <div key={p.id} className="phase-row" style={{
                      background: T.surface, border: `1px solid ${T.border}`,
                      borderLeft: `4px solid ${accentColor}`,
                      borderRadius: RADIUS.xl, padding: "14px 18px",
                      display: "flex", alignItems: "center", gap: 14, cursor: "pointer", transition: "all .15s"
                    }} onClick={() => setSelected(p)}
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
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>{p.chantier_nom}</div>
                          {STATUT_DEF && (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 3,
                              fontSize: FONT.xs.size, fontWeight: 700, color: STATUT_DEF.color,
                              background: STATUT_DEF.bg, border: `1px solid ${STATUT_DEF.border}`,
                              borderRadius: RADIUS.pill, padding: "2px 8px",
                            }}>{STATUT_DEF.label}</span>
                          )}
                        </div>
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 10 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon as={Hammer} size={11}/>
                            {tPlan.length} tâche{tPlan.length > 1 ? "s" : ""}
                          </span>
                          {totalHReel > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Icon as={Clock} size={11}/>
                              {totalHReel.toFixed(1)}h
                            </span>
                          )}
                          {coutTotal > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: T.textSub, fontWeight: 600 }}>
                              <Icon as={Euro} size={11}/>
                              {Math.round(coutTotal).toLocaleString("fr-FR")}€
                              {prixVendu > 0 && <> / {Math.round(prixVendu).toLocaleString("fr-FR")}€</>}
                            </span>
                          )}
                          {prixVendu > 0 && marge !== 0 && (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontWeight: 700,
                              color: marge > 0 ? "#22c55e" : "#e15a5a",
                            }}>
                              {marge > 0 ? "+" : ""}{Math.round(marge).toLocaleString("fr-FR")}€
                            </span>
                          )}
                        </div>
                        {tPlan.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 5, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 3,
                                background: avgAv === 100 ? "#22c55e" : acc.accent,
                                width: `${avgAv}%`, transition: "width .3s" }}/>
                            </div>
                            <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800,
                              color: avgAv === 100 ? "#22c55e" : acc.accent, minWidth: 36, textAlign: "right" }}>
                              {avgAv}%
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={e => { e.stopPropagation(); setGanttPhasage(p); }}
                          title="Vue Gantt"
                          style={{
                            display: "inline-flex", alignItems: "center",
                            padding: "7px 10px", borderRadius: RADIUS.md,
                            border: `1px solid rgba(91,156,246,0.35)`,
                            background: "rgba(91,156,246,0.08)", color: "#5b9cf6",
                            fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
                          }}>
                          <Icon as={GanttChartSquare} size={13}/>
                        </button>
                        <button onClick={e => { e.stopPropagation(); setToDelete(p); }}
                          title="Supprimer"
                          style={{
                            display: "inline-flex", alignItems: "center",
                            padding: "7px 10px", borderRadius: RADIUS.md,
                            border: `1px solid rgba(224,92,92,0.3)`,
                            background: "transparent", color: "#e15a5a",
                            fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer",
                          }}>
                          <Icon as={Trash2} size={13}/>
                        </button>
                        <Icon as={ChevronRight} size={16} color={T.textMuted}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
        }
      </div>

      {ganttPhasage && (
        <GanttView
          planTravaux={ganttPhasage.plan_travaux || {}}
          chantierNom={ganttPhasage.chantier_nom}
          T={T}
          onClose={() => setGanttPhasage(null)}
        />
      )}
    </div>
  );
}

export default PagePhasage;
