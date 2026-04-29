import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import { JOURS, getCurrentWeek, getWeekId } from "./constants";

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
const PHASES = [
  { id: "demolition",     label: "Démolition",                        emoji: "🔨", couleur: "#e05c5c" },
  { id: "plomberie_ro",   label: "Réseaux plomberie (gros œuvre)",     emoji: "🔵", couleur: "#3b82f6" },
  { id: "menuiserie",     label: "Menuiserie ext. & int.",             emoji: "🚪", couleur: "#8b5cf6" },
  { id: "feraillage",     label: "Feraillage cloisons & doublages",    emoji: "🧱", couleur: "#f59e0b" },
  { id: "elec_vmc",       label: "Réseaux élec & VMC",                 emoji: "⚡", couleur: "#eab308" },
  { id: "placo",          label: "Lainage / Placo / Bandes & enduits", emoji: "🪣", couleur: "#6366f1" },
  { id: "peinture_sols",  label: "Peintures & sols",                   emoji: "🎨", couleur: "#ec4899" },
  { id: "finition_elec",  label: "Finitions électricité",              emoji: "💡", couleur: "#f97316" },
  { id: "finition_plomb", label: "Finitions plomberie",                emoji: "🚿", couleur: "#06b6d4" },
  { id: "cuisine",        label: "Cuisine",                            emoji: "🍳", couleur: "#10b981" },
  { id: "finitions_gen",  label: "Finitions générales",                emoji: "✨", couleur: "#a78bfa" },
];

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
      const prixHtTache = (ouvrage.prix_ht && t.ratio)
        ? parseFloat(((ouvrage.prix_ht * t.ratio) / 100).toFixed(2))
        : (ouvrage.prix_ht && !t.ratio ? ouvrage.prix_ht : null);
      plan[phaseId].push({
        id: Math.random().toString(36).slice(2),
        nom: t.nom,
        ouvrage_libelle: ouvrage.libelle,
        heures_vendues: parseFloat(t.heures) || 0,
        heures_estimees: parseFloat(t.heures_estimees) || null,
        heures_reelles: 0,
        cout_materiel: 0,
        prix_ht: prixHtTache,
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
      <div style={{ background: T.modal || T.surface, borderRadius: 16, width: "100%", maxWidth: 780, maxHeight: "90vh", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.sectionDivider}`, background: T.surface, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>
              {etape === "upload" && "📂 Importer un devis Excel"}
              {etape === "detection" && "🔍 Ouvrages détectés — Personnalisation"}
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
              {etape === "upload" && "Glisse ou sélectionne ton fichier .xlsx / .xls"}
              {etape === "detection" && `${ouvragesDetectes.length} ouvrage(s) · ${nbMatch} correspondance(s) bibliothèque · Modifie les noms, regroupe ou sépare`}
            </div>
          </div>
          <button onClick={onFermer} style={{ background: "transparent", border: "none", color: T.textMuted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {["upload", "detection"].map((s, i) => {
            const labels = ["1 · Upload fichier", "2 · Personnalisation"];
            const active = etape === s;
            const done = (s === "upload" && etape === "detection");
            return (
              <div key={s} style={{ flex: 1, padding: "8px 16px", textAlign: "center", fontSize: 11, fontWeight: 700, color: active ? T.accent : done ? "#50c878" : T.textMuted, borderBottom: active ? `2px solid ${T.accent}` : done ? "2px solid #50c878" : "2px solid transparent", transition: "all .2s" }}>
                {done ? "✓ " : ""}{labels[i]}
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
                style={{ border: `2px dashed ${T.accent}55`, borderRadius: 12, padding: "44px 24px", textAlign: "center", cursor: "pointer", background: `${T.accent}08` }}
                onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = `${T.accent}55`}
              >
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Glisse ton fichier ici ou clique pour parcourir</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>Formats acceptés : .xlsx, .xls</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
              </div>
              {parsing && <div style={{ textAlign: "center", padding: 20, color: T.textMuted, fontSize: 13 }}>⏳ Analyse du fichier…</div>}
              {erreur && <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(224,92,92,0.1)", border: "1px solid rgba(224,92,92,0.3)", borderRadius: 8, color: "#e05c5c", fontSize: 13 }}>⚠️ {erreur}</div>}
              <div style={{ marginTop: 18, padding: "14px 16px", background: T.card, borderRadius: 10, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Colonnes détectées automatiquement</div>
                <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.9 }}>
                  • <strong style={{ color: T.text }}>Libellé / désignation</strong> — nom de l'ouvrage <span style={{ color: T.accent, fontWeight: 700 }}>obligatoire</span><br />
                  • <strong style={{ color: T.text }}>Heures MO</strong> — <span style={{ color: "#50c878", fontWeight: 600 }}>optionnel</span> — si absent, tu les saisis dans l'étape suivante<br />
                  • <strong style={{ color: T.text }}>Quantité</strong> — <span style={{ color: "#50c878", fontWeight: 600 }}>optionnel</span> — pour calcul cadence automatique<br />
                  • <strong style={{ color: T.text }}>Total HT</strong> — <span style={{ color: "#50c878", fontWeight: 600 }}>optionnel</span> — montant de la ligne
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

              <div style={{ padding: "10px 14px", background: T.card, borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 14, fontSize: 12, color: T.textMuted, lineHeight: 1.7 }}>
                💡 <strong style={{ color: T.text }}>Personnalise chaque ouvrage</strong> : renomme-le pour le contexte du chantier, ajuste les heures, sépare les lignes groupées ou fusionne des lignes similaires.
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
                                  style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", cursor: "pointer", fontFamily: "inherit" }}
                                >✕ délier</button>
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
                                          fontSize: 11, padding: "2px 10px", borderRadius: 5,
                                          border: `1px solid ${T.accent}66`,
                                          background: `${T.accent}12`, color: T.accent,
                                          fontFamily: "inherit", fontWeight: 700, cursor: "pointer",
                                        }}
                                      >🔗 Lier à la bibliothèque</button>
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
                          <div style={{ fontSize: 10, fontWeight: 700, color: BLEU, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>📋 Sous-tâches générées depuis la bibliothèque</div>
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
                              style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                            >⎘ Séparer en {ouvrage.lignes.length} ouvrages</button>
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
          <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.sectionDivider}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface, flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: T.textMuted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{nbSel}</span> ouvrage{nbSel > 1 ? "s" : ""} sélectionné{nbSel > 1 ? "s" : ""}
              {nbMatch > 0 && <> · <span style={{ color: "#50c878", fontWeight: 700 }}>{nbMatch}</span> avec sous-tâches auto</>}
              {(() => {
                const nbSansH = ouvragesDetectes.filter(o => o.selectionne && o.lignes.filter(l => l.selectionne !== false).reduce((s, l) => s + (parseFloat(l.heures) || 0), 0) === 0).length;
                return nbSansH > 0
                  ? <> · <span style={{ color: "#f5a623", fontWeight: 700 }}>⚠ {nbSansH} sans heures</span></>
                  : null;
              })()}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setEtape("upload"); setOuvragesDetectes([]); setLignesBrutes([]); }} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Retour</button>
              <button
                onClick={() => onImporter(construireImport())}
                disabled={nbSel === 0}
                style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: nbSel > 0 ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: nbSel > 0 ? "pointer" : "default" }}
              >✓ Importer {nbSel} ouvrage{nbSel > 1 ? "s" : ""}</button>
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

// ─── PLAN TRAVAUX ─────────────────────────────────────────────────────────────
function PlanTravaux({ phasage, ouvrages, T, ouvriers, tauxHoraires, onBack, onSavePlan }) {
  const BLEU = "#5b9cf6";

  const initPlan = () => {
    if (phasage.plan_travaux && Object.keys(phasage.plan_travaux).filter(k => k !== 'meta').length > 0) {
      return phasage.plan_travaux;
    }
    return distribuerTaches(ouvrages);
  };

  const [plan, setPlan] = useState(initPlan);
  const [prixVendu, setPrixVendu] = useState(() => {
    if (phasage.plan_travaux?.meta?.prix_vendu) return phasage.plan_travaux.meta.prix_vendu;
    const totalHT = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    return totalHT > 0 ? parseFloat(totalHT.toFixed(2)) : 0;
  });
  const [expandedPhases, setExpandedPhases] = useState(() => PHASES.reduce((acc, p) => ({ ...acc, [p.id]: true }), {}));
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  const [ajoutPhase, setAjoutPhase] = useState(null);
  const [ajoutForm, setAjoutForm] = useState({ nom: "", heures_vendues: "", heures_estimees: "", ouvriers: [], date_prevue: "" });
  const dragItem = useRef(null);
  const dragOver = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [planifierTask, setPlanifierTask] = useState(null);
  const [planifierWeek, setPlanifierWeek] = useState("");
  const [planifierJour, setPlanifierJour] = useState("Lundi");
  const [isPlanningSaving, setIsPlanningSaving] = useState(false);
  const semainesFutures = [];
  const now = getCurrentWeek();
  for (let i = 0; i < 8; i++) { let w = now.week + i, y = now.year; if (w > 52) { w -= 52; y++; } semainesFutures.push(getWeekId(y, w)); }

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      await onSavePlan({ ...plan, meta: { prix_vendu: prixVendu } });
      setAutoSaveStatus("saved");
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
  }, [plan, prixVendu]);

  function updateTache(phaseId, tacheId, updates) { setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).map(t => t.id === tacheId ? { ...t, ...updates } : t) })); }
  function deleteTache(phaseId, tacheId) { setPlan(p => ({ ...p, [phaseId]: (p[phaseId] || []).filter(t => t.id !== tacheId) })); }
  function addTache(phaseId) {
    if (!ajoutForm.nom) return;
    const newT = { id: Math.random().toString(36).slice(2), nom: ajoutForm.nom, heures_vendues: parseFloat(ajoutForm.heures_vendues) || 0, heures_estimees: parseFloat(ajoutForm.heures_estimees) || null, heures_reelles: 0, cout_materiel: 0, ouvriers: ajoutForm.ouvriers || [], date_prevue: ajoutForm.date_prevue || "", avancement: 0 };
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
      const upd = [...(base.taches || []), { id: Math.random().toString(36).slice(2), text: planifierTask.tache.nom, duree: planifierTask.tache.heures_vendues, ouvriers: ouvriersAssignes }];
      await supabase.from("planning_cells").upsert({ week_id: planifierWeek, chantier_id: phasage.chantier_id, jour: planifierJour, planifie: nouveauPlanifieTexte, taches: upd, reel: base.reel, ouvriers: [...new Set([...(base.ouvriers || []), ...ouvriersAssignes])] }, { onConflict: "week_id,chantier_id,jour" });
      const exactDate = getDateFromWeekAndDay(planifierWeek, planifierJour);
      updateTache(planifierTask.phaseId, planifierTask.tache.id, { date_prevue: exactDate });
      setPlanifierTask(null);
      alert("Tâche ajoutée au planning !");
    } catch (err) { console.error(err); alert("Erreur lors de la planification."); }
    setIsPlanningSaving(false);
  }

  const allTaches = PHASES.flatMap(ph => (plan[ph.id] || []));
  const nbTaches = allTaches.length;
  const terminees = allTaches.filter(t => (parseFloat(t.avancement) || 0) === 100).length;
  const totalHVenduGlobal = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  const totalHEstimeeGlobal = allTaches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

  // ── Avancement global : pondéré par h. vendues, sinon h. estimées, sinon moyenne simple
  const avgAv = nbTaches === 0 ? 0
    : totalHVenduGlobal > 0
      ? Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHVenduGlobal)
      : totalHEstimeeGlobal > 0
        ? Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalHEstimeeGlobal)
        : Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / nbTaches);

  const totalMO = allTaches.reduce((s, t) => { const pO = (t.ouvriers || [])[0] || ""; return s + ((parseFloat(t.heures_reelles) || 0) * (tauxHoraires?.[pO] || 45)); }, 0);
  const totalMat = allTaches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
  const coutTotal = totalMO + totalMat;
  const pVendu = parseFloat(prixVendu) || 0;
  const marge = pVendu - coutTotal;
  const margePct = pVendu > 0 ? (marge / pVendu) * 100 : 0;
  const autoColor = autoSaveStatus === "saved" ? "#50c878" : autoSaveStatus === "saving" ? T.accent : "#f5a623";
  const autoLabel = autoSaveStatus === "saved" ? "✓ Sauvegardé" : autoSaveStatus === "saving" ? "Sauvegarde…" : "● Modification en cours";
  const gridCols = "20px 1.5fr 120px 55px 55px 70px 110px 70px 90px 26px";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg, position: "relative" }}>

      {planifierTask && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setPlanifierTask(null)}>
          <div style={{ background: T.modal || T.surface, borderRadius: 16, width: "100%", maxWidth: 400, border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.sectionDivider}` }}><div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>📅 Envoyer dans le Planning</div></div>
            <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: T.card, padding: "12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{planifierTask.tache.nom}</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Durée : {planifierTask.tache.heures_vendues}h{(planifierTask.tache.ouvriers || []).length > 0 ? ` · ${planifierTask.tache.ouvriers.join(", ")}` : " · Aucun ouvrier assigné"}</div>
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
              <button onClick={executerPlanification} disabled={isPlanningSaving || !planifierWeek} style={{ background: T.accent, border: "none", borderRadius: 8, padding: "9px 22px", color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{isPlanningSaving ? "Envoi..." : "✓ Ajouter au planning"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Préparation du devis</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>📋 Plan de travail — {phasage.chantier_nom}</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{nbTaches} tâche{nbTaches > 1 ? "s" : ""} · {terminees} terminée{terminees > 1 ? "s" : ""}</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: autoColor, display: "flex", alignItems: "center", gap: 5 }}>
            {autoSaveStatus === "saving" && <svg width="12" height="12" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>}
            {autoLabel}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Prix de vente final</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="number" value={prixVendu || ""} onChange={e => setPrixVendu(e.target.value)} placeholder="Ex: 15000" style={{ flex: 1, padding: "4px 8px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 20, fontWeight: 800, outline: "none", width: "100%" }} />
              <span style={{ fontSize: 18, fontWeight: 800, color: T.textMuted }}>€</span>
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Coûts cumulés</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: coutTotal > pVendu && pVendu > 0 ? "#e05c5c" : T.text }}>{coutTotal.toFixed(0)} €</div>
          </div>
          <div style={{ background: marge < 0 ? "rgba(224,92,92,0.1)" : "rgba(80,200,120,0.1)", border: `1px solid ${marge < 0 ? "rgba(224,92,92,0.3)" : "rgba(80,200,120,0.3)"}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: marge < 0 ? "#e05c5c" : "#50c878", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Marge Nette</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: marge < 0 ? "#e05c5c" : "#50c878" }}>{marge > 0 ? "+" : ""}{marge.toFixed(0)} €</div>
          </div>
          <div style={{ background: marge < 0 ? "rgba(224,92,92,0.1)" : "rgba(80,200,120,0.1)", border: `1px solid ${marge < 0 ? "rgba(224,92,92,0.3)" : "rgba(80,200,120,0.3)"}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: marge < 0 ? "#e05c5c" : "#50c878", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Marge %</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: marge < 0 ? "#e05c5c" : "#50c878" }}>{margePct.toFixed(1)} %</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4 }}>
            <div style={{ height: "100%", borderRadius: 4, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 40 }}>{avgAv}% avancement global</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PHASES.map((phase) => {
            const taches = plan[phase.id] || [];
            const isExp = expandedPhases[phase.id];
            const phHVendu = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
            const phHEstimee = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

            // ── Avancement par phase : pondéré par h. vendues, sinon h. estimées, sinon moyenne simple
            const phAv = taches.length === 0 ? 0
              : phHVendu > 0
                ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / phHVendu)
                : phHEstimee > 0
                  ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / phHEstimee)
                  : Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length);

            const phVendu = phHVendu;
            const phReel = taches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
            const phPrixHt = taches.reduce((s, t) => s + (parseFloat(t.prix_ht) || 0), 0);
            const phCoutMO = taches.reduce((s, t) => { const pO = (t.ouvriers || [])[0] || ""; return s + ((parseFloat(t.heures_reelles) || 0) * (tauxHoraires?.[pO] || 45)); }, 0);
            const phCoutMat = taches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
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
                      <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Vendu</div><div style={{ fontSize: 13, fontWeight: 800, color: T.accent }}>{phPrixHt.toFixed(0)} €</div></div>
                      <div style={{ width: 1, height: 28, background: T.border }} />
                      <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Coût</div><div style={{ fontSize: 13, fontWeight: 800, color: phCout > phPrixHt && phPrixHt > 0 ? "#e05c5c" : T.text }}>{phCout.toFixed(0)} €</div></div>
                      {phCout > 0 && <><div style={{ width: 1, height: 28, background: T.border }} /><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase" }}>Marge</div><div style={{ fontSize: 13, fontWeight: 800, color: phMarge >= 0 ? "#50c878" : "#e05c5c" }}>{phMarge >= 0 ? "+" : ""}{phMarge.toFixed(0)} €</div></div></>}
                    </div>
                  )}
                  {taches.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
                      <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", borderRadius: 2, background: phAv === 100 ? "#50c878" : phase.couleur, width: `${phAv}%`, transition: "width .3s" }} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: phAv === 100 ? "#50c878" : T.textMuted, minWidth: 28 }}>{phAv}%</span>
                    </div>
                  )}
                  <span style={{ fontSize: 12, color: isExp ? phase.couleur : T.textMuted, userSelect: "none", padding: "0 8px" }}>{isExp ? "▲" : "▼"}</span>
                </div>

                {isExp && (
                  <div style={{ padding: "0 0 14px" }}>
                    {taches.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, padding: "7px 16px 6px", borderBottom: `1px solid ${T.sectionDivider}` }}>
                        {["", "Tâche", "Ouvrier(s)", "Vendu", "Estimé", "Réel", "Date", "Avanc.", "Planning", ""].map((h, i) => (
                          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, textAlign: i > 2 ? "center" : "left" }}>{h}</div>
                        ))}
                      </div>
                    )}

                    {taches.map((tache, ti) => {
                      const av = parseFloat(tache.avancement) || 0;
                      const hV = parseFloat(tache.heures_vendues) || 0;
                      const hR = parseFloat(tache.heures_reelles) || 0;
                      const isDragging = dragActive && dragItem.current?.phaseId === phase.id && dragItem.current?.index === ti;
                      const ouvriersActuels = tache.ouvriers ? tache.ouvriers : (tache.ouvrier ? [tache.ouvrier] : []);

                      return (
                        <div key={tache.id}
                          onDragEnter={() => onDragEnter(phase.id, ti)}
                          onDragEnd={onDragEnd}
                          onDragOver={e => e.preventDefault()}
                          style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, padding: "7px 16px", borderBottom: `1px solid ${T.sectionDivider}`, alignItems: "center", opacity: isDragging ? 0.35 : 1, background: isDragging ? `${phase.couleur}18` : "transparent", transition: "opacity .15s" }}>

                          <div draggable onDragStart={() => onDragStart(phase.id, ti)} style={{ color: T.textMuted, fontSize: 13, cursor: "grab", userSelect: "none", textAlign: "center" }}>⠿</div>

                          <div style={{ minWidth: 0 }}>
                            <input value={tache.nom} onChange={e => updateTache(phase.id, tache.id, { nom: e.target.value })} onPointerDown={stopDrag} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 600, outline: "none" }} onFocus={e => e.target.style.borderColor = T.border} onBlur={e => e.target.style.borderColor = "transparent"} />
                            {tache.ouvrage_libelle && <div style={{ fontSize: 10, color: T.textMuted, paddingLeft: 6, marginTop: 1 }}>↳ {tache.ouvrage_libelle}</div>}
                          </div>

                          <OuvriersSelect ouvriers={ouvriers} selected={ouvriersActuels} onChange={next => updateTache(phase.id, tache.id, { ouvriers: next })} T={T} stopDrag={stopDrag} />

                          {[["heures_vendues", T.accent], ["heures_estimees", BLEU], ["heures_reelles", hR > hV && hV > 0 ? "#e05c5c" : hR > 0 ? "#50c878" : T.text]].map(([field, color]) => (
                            <input key={field} type="number" min="0" step="0.5" value={tache[field] || ""} placeholder={field === "heures_estimees" ? "—" : "0"} onPointerDown={stopDrag} onChange={e => updateTache(phase.id, tache.id, { [field]: parseFloat(e.target.value) || (field === "heures_estimees" ? null : 0) })} style={{ width: "100%", padding: "4px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                          ))}

                          <input type="date" value={tache.date_prevue || ""} onChange={e => updateTache(phase.id, tache.id, { date_prevue: e.target.value })} onPointerDown={stopDrag} style={{ padding: "4px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 11, outline: "none", width: "100%", colorScheme: "dark" }} />

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            <input type="number" min="0" max="100" step="5" value={av} onPointerDown={stopDrag} onChange={e => { let val = parseInt(e.target.value); if (isNaN(val)) val = 0; if (val > 100) val = 100; if (val < 0) val = 0; updateTache(phase.id, tache.id, { avancement: val }); }} style={{ width: 45, padding: "4px", borderRadius: 6, border: `1px solid ${av === 100 ? "#50c878" : T.border}`, background: T.inputBg, color: av === 100 ? "#50c878" : T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }} />
                            <span style={{ fontSize: 11, color: T.textMuted }}>%</span>
                          </div>

                          <div style={{ textAlign: "center" }}>
                            <button onClick={() => { setPlanifierWeek(semainesFutures[0]); setPlanifierTask({ phaseId: phase.id, tacheIdx: ti, tache: { ...tache, ouvriers: ouvriersActuels } }); }} onPointerDown={stopDrag} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.accent}55`, background: T.accent + "15", color: T.accent, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = T.accent + "30"} onMouseLeave={e => e.currentTarget.style.background = T.accent + "15"}>📅 Planifier</button>
                          </div>

                          <button onClick={() => deleteTache(phase.id, tache.id)} onPointerDown={stopDrag} style={{ background: "transparent", border: "none", color: "#e05c5c", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
                        </div>
                      );
                    })}

                    {taches.length === 0 && dragActive && (
                      <div style={{ margin: "8px 16px", padding: "14px", borderRadius: 8, border: `2px dashed ${phase.couleur}55`, textAlign: "center", color: T.textMuted, fontSize: 12 }}>Déposer ici</div>
                    )}

                    {ajoutPhase === phase.id ? (
                      <div style={{ margin: "10px 16px 0", padding: "14px", background: T.card, borderRadius: 10, border: `1px solid ${phase.couleur}55` }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: phase.couleur, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>{phase.emoji} Nouvelle tâche</div>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                          {[["Nom *", "nom", "text", T.text, "ex: Pose plaques"], ["H. vendues", "heures_vendues", "number", T.accent, "0h"], ["H. estimées", "heures_estimees", "number", BLEU, "—"], ["Date prévue", "date_prevue", "date", T.text, ""]].map(([label, field, type, color, ph]) => (
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
                          <button onClick={() => addTache(phase.id)} disabled={!ajoutForm.nom} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: ajoutForm.nom ? phase.couleur : T.border, color: ajoutForm.nom ? "#fff" : T.textMuted, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: ajoutForm.nom ? "pointer" : "default" }}>✓ Ajouter</button>
                          <button onClick={() => { setAjoutPhase(null); setAjoutForm({ nom: "", heures_vendues: "", heures_estimees: "", ouvriers: [], date_prevue: "" }); }} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAjoutPhase(phase.id); setExpandedPhases(prev => ({ ...prev, [phase.id]: true })); }} style={{ margin: "10px 16px 0", padding: "8px", borderRadius: 8, border: `1.5px dashed ${phase.couleur}55`, background: "transparent", color: phase.couleur, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "block", width: "calc(100% - 32px)" }}>
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

// ─── PHASAGE DETAIL ───────────────────────────────────────────────────────────
function PhasageDetail({ phasage, bibliotheque, T, chantiers, ouvriers, tauxHoraires, onBack, onSave, onDelete }) {
  const [ouvrages, setOuvrages] = useState(phasage.ouvrages || []);
  const [showAjout, setShowAjout] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedOuvrage, setSelectedOuvrage] = useState("");
  const [heuresInput, setHeuresInput] = useState("");
  const [quantiteInput, setQuantiteInput] = useState("");
  const [search, setSearch] = useState("");
  const ch = chantiers.find(c => c.id === phasage.chantier_id);
  const BLEU = "#5b9cf6";
  const hasPlan = phasage.plan_travaux && Object.values(phasage.plan_travaux).filter(v => Array.isArray(v)).some(arr => arr.length > 0);
  const [view, setView] = useState(hasPlan ? "plan" : "preparation");
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (view === "plan") return;
    setAutoSaveStatus("pending");
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      await onSave({ ...phasage, ouvrages });
      setAutoSaveStatus("saved");
    }, 1200);
    return () => clearTimeout(autoSaveTimer.current);
  }, [ouvrages]);

  function genererTaches(ouvrageId, heuresDevis, heuresEstimees, prixHt = null) {
    const bibl = bibliotheque.find(b => b.id === ouvrageId);
    if (!bibl) return [];
    return (bibl.sous_taches || []).map(st => ({
      nom: st.nom,
      ratio: st.ratio,
      phaseId: st.phaseId,
      heures: parseFloat(((heuresDevis * st.ratio) / 100).toFixed(1)),
      heures_estimees: heuresEstimees ? parseFloat(((heuresEstimees * st.ratio) / 100).toFixed(2)) : null,
      prix_ht: prixHt ? parseFloat(((prixHt * st.ratio) / 100).toFixed(2)) : null,
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
        taches: bibl ? genererTaches(bibl.id, ligne.heures, heuresEstimees, prix_ht) : [
          {
            nom: ligne.libelle,
            ratio: 100,
            phaseId: "",
            heures: ligne.heures,
            heures_estimees: null,
            prix_ht,
            avancement: 0,
            heures_reelles: [],
            ressources: [],
          }
        ],
      };
    });
    setOuvrages(prev => [...prev, ...nouveaux]);
    setShowImport(false);
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
  }

  function supprimerOuvrage(id) { setOuvrages(prev => prev.filter(o => o.id !== id)); }
  function updateHeures(id, val) {
    setOuvrages(prev => prev.map(o => {
      if (o.id !== id) return o;
      const h = parseFloat(val) || 0;
      const bibl = bibliotheque.find(b => b.id === o.bibliotheque_id);
      return { ...o, heures_devis: h, taches: bibl ? genererTaches(o.bibliotheque_id, h, o.heures_estimees) : o.taches };
    }));
  }
  function updateLibelle(id, val) {
    setOuvrages(prev => prev.map(o => o.id !== id ? o : { ...o, libelle: val }));
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

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: T.bg }}>
      {showImport && <ModaleImportExcel T={T} bibliotheque={bibliotheque} onImporter={handleImportExcel} onFermer={() => setShowImport(false)} />}

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>← Retour aux phasages</button>
          <div style={{ width: 12, height: 36, borderRadius: 6, background: ch ? ch.couleur : T.accent }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>Étape 1 : Préparation du devis — {phasage.chantier_nom}</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>
              {ouvrages.length} ouvrage(s) · {totalH.toFixed(1)}h total vendues
              {ouvrages.some(o => o.prix_ht > 0) && ` · ${ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0).toFixed(0)} € HT`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={onDelete} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Supprimer</button>
            <button
              onClick={async () => {
                if (!phasage.plan_travaux || Object.keys(phasage.plan_travaux).filter(k => k !== 'meta').length === 0) {
                  const newPlan = distribuerTaches(ouvrages);
                  phasage.plan_travaux = newPlan;
                  await onSave({ ...phasage, plan_travaux: newPlan, ouvrages });
                }
                setView("plan");
              }}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >Générer le plan de travail →</button>
          </div>
        </div>

        {!showAjout && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <button onClick={() => setShowImport(true)} style={{ flex: 2, padding: "16px 22px", borderRadius: 10, border: `2px dashed ${T.accent}`, background: `${T.accent}0A`, color: T.accent, fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
              📂 Importer un devis Excel (.xlsx)
            </button>
            <button onClick={() => setShowAjout(true)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1.5px dashed ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Saisie manuelle</button>
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
                <div style={{ fontSize: 11, fontWeight: 700, color: BLEU, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>⏱ Cadence : {cadSel}h / {biblSel?.unite}</div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                    <button onClick={() => supprimerOuvrage(ouvrage.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer", textAlign: "center" }}>🗑</button>
                  </div>
                  {(ouvrage.taches || []).length > 0 && (
                    <div style={{ padding: "6px 18px 10px", borderTop: `1px solid ${T.sectionDivider}` }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {(ouvrage.taches || []).map((t, i) => {
                          const ph = PHASES.find(p => p.id === (t.phaseId || matchPhase(t.nom)));
                          return (
                            <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: ph ? `${ph.couleur}18` : T.card, color: ph ? ph.couleur : T.textMuted, border: `1px solid ${ph ? ph.couleur + "33" : T.border}`, fontWeight: 600 }}>
                              {ph?.emoji} {t.nom} · {t.heures}h
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── RAPPORT MODAL ────────────────────────────────────────────────────────────
function RapportModal({ phasages, chantiers, tauxHoraires, onFermer }) {
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const donneesChantiers = phasages.map(p => {
    const ch = chantiers.find(c => c.id === p.chantier_id);
    const tPlan = p.plan_travaux
      ? Object.values(p.plan_travaux).filter(arr => Array.isArray(arr)).flat()
      : [];
    const totalHVendu = tPlan.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
    const totalHEstimee = tPlan.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

    // ── Avancement : pondéré par h. vendues, sinon h. estimées, sinon moyenne simple
    const avgAv = tPlan.length === 0 ? 0
      : totalHVendu > 0
        ? Math.round(tPlan.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHVendu)
        : totalHEstimee > 0
          ? Math.round(tPlan.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalHEstimee)
          : Math.round(tPlan.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / tPlan.length);

    const coutMO = tPlan.reduce((s, t) => {
      const pO = (t.ouvriers || (t.ouvrier ? [t.ouvrier] : []))[0] || "";
      return s + ((parseFloat(t.heures_reelles) || 0) * (tauxHoraires?.[pO] || 45));
    }, 0);
    const coutMat = tPlan.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
    const coutTotal = coutMO + coutMat;
    const prixVendu = parseFloat(p.plan_travaux?.meta?.prix_vendu) || 0;
    const marge = prixVendu - coutTotal;
    const margePct = prixVendu > 0 ? (marge / prixVendu) * 100 : null;
    const terminees = tPlan.filter(t => (parseFloat(t.avancement) || 0) === 100).length;
    const totalHReel = tPlan.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);

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
function PagePhasage({ chantiers, ouvriers, tauxHoraires, T }) {
  const [phasages, setPhasages] = useState([]);
  const [bibliotheque, setBibliotheque] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newChantier, setNewChantier] = useState("");
  const [showRapport, setShowRapport] = useState(false);

  useEffect(() => { loadAll(); }, []);
  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: b }] = await Promise.all([
      supabase.from("phasages").select("*").order("created_at", { ascending: false }),
      supabase.from("bibliotheque_ratios").select("*").order("libelle"),
    ]);
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
    const { error } = await supabase.from("phasages").update({ ouvrages: phasage.ouvrages, plan_travaux: phasage.plan_travaux || null, updated_at: new Date().toISOString() }).eq("id", phasage.id);
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

      {showRapport && (
        <RapportModal
          phasages={phasages}
          chantiers={chantiers}
          tauxHoraires={tauxHoraires}
          onFermer={() => setShowRapport(false)}
        />
      )}

      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: T.text }}>📋 Phasages chantiers</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Avancement, coûts MO et ressources par tâche</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={() => setShowRapport(true)}
              style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid rgba(245,166,35,0.4)", background: "rgba(245,166,35,0.1)", color: "#f5a623", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              📊 Rapport
            </button>
            <button onClick={() => setShowNew(true)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nouveau phasage</button>
          </div>
        </div>

        {showNew && (
          <div style={{ background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Nouveau phasage</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select value={newChantier} onChange={e => setNewChantier(e.target.value)} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: newChantier ? T.text : T.textMuted, fontFamily: "inherit", fontSize: 14, outline: "none" }}>
                <option value="">Choisir un chantier…</option>
                {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
              <button onClick={creerPhasage} disabled={!newChantier} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: newChantier ? T.accent : T.border, color: "#111", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: newChantier ? "pointer" : "default" }}>Créer et Importer le devis</button>
              <button onClick={() => { setShowNew(false); setNewChantier(""); }} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {loading
          ? <div style={{ color: T.textMuted, textAlign: "center", padding: 60 }}>Chargement…</div>
          : phasages.length === 0
            ? <div style={{ textAlign: "center", padding: 60, color: T.textMuted }}><div style={{ fontSize: 32, marginBottom: 12 }}>📋</div><div>Aucun phasage. Créez-en un pour commencer.</div></div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {phasages.map(p => {
                  const ch = chantiers.find(c => c.id === p.chantier_id);
                  const tPlan = p.plan_travaux ? Object.values(p.plan_travaux).filter(arr => Array.isArray(arr)).flat() : [];
                  const totalHVendu = tPlan.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
                  const totalHEstimee = tPlan.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);

                  // ── Avancement carte : pondéré par h. vendues, sinon h. estimées, sinon moyenne simple
                  const avgAv = tPlan.length === 0 ? 0
                    : totalHVendu > 0
                      ? Math.round(tPlan.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHVendu)
                      : totalHEstimee > 0
                        ? Math.round(tPlan.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0)), 0) / totalHEstimee)
                        : Math.round(tPlan.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / tPlan.length);

                  const coutMO = tPlan.reduce((s, t) => { const pO = (t.ouvriers || (t.ouvrier ? [t.ouvrier] : []))[0] || ""; return s + ((parseFloat(t.heures_reelles) || 0) * (tauxHoraires?.[pO] || 45)); }, 0);
                  const coutMat = tPlan.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
                  const coutTotal = coutMO + coutMat;
                  const prixVendu = p.plan_travaux?.meta?.prix_vendu || 0;
                  return (
                    <div key={p.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer", transition: "border .15s" }} onClick={() => setSelected(p)} onMouseEnter={e => e.currentTarget.style.borderColor = T.accent} onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                      <div style={{ width: 10, height: 56, borderRadius: 5, background: ch ? ch.couleur : T.accent, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{p.chantier_nom}</div>
                        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
                          {tPlan.length} tâche{tPlan.length > 1 ? "s" : ""} · Coûts cumulés : <span style={{ fontWeight: 700, color: T.text }}>{coutTotal > 0 ? `${coutTotal.toFixed(0)}€` : "0€"}</span>
                          {prixVendu > 0 && ` / Vendu : ${prixVendu}€`}
                        </div>
                        {tPlan.length > 0 && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2 }}><div style={{ height: "100%", borderRadius: 2, background: avgAv === 100 ? "#50c878" : T.accent, width: `${avgAv}%`, transition: "width .3s" }} /></div><span style={{ fontSize: 11, fontWeight: 700, color: avgAv === 100 ? "#50c878" : T.accent, minWidth: 32 }}>{avgAv}%</span></div>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={e => { e.stopPropagation(); supprimerPhasage(p.id); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#e05c5c", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>🗑</button>
                        <span style={{ fontSize: 18, color: T.textMuted, alignSelf: "center" }}>▶</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
        }
      </div>
    </div>
  );
}

export default PagePhasage;
