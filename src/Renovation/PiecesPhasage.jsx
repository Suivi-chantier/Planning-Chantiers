// Pièces du chantier dans le phasage (prompt CR-2) : liste des pièces,
// barre de rattachement de plusieurs tâches, duplication d'une tâche pour
// plusieurs pièces. Les calculs sont dans piecesPhasageV1.mjs.
import React, { useState } from "react";
import { FONT, RADIUS } from "../constants";
import { repartirHeures, dupliquerTacheParPieces } from "./piecesPhasageV1";

const rid = () => Math.random().toString(36).slice(2, 10);
const fmtH = (n) => String(Math.round(n * 100) / 100).replace(".", ",");

function Fenetre({ titre, onClose, T, children, largeur = 460 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: largeur, maxHeight: "85vh", overflowY: "auto", background: T.surface || T.card, color: T.text, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ flex: 1, fontWeight: 800, fontSize: FONT.md?.size || 15 }}>{titre}</div>
          <button onClick={onClose} aria-label="Fermer" style={{ border: "none", background: "transparent", color: T.textMuted, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const btn = (T, accent, plein = false) => ({
  padding: "6px 12px", borderRadius: RADIUS.sm, border: `1px solid ${plein ? accent : T.border}`,
  background: plein ? accent : "transparent", color: plein ? "#111" : T.text, fontWeight: 700,
  fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
});
const champ = (T) => ({ padding: "5px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size });

// Liste des pièces : ajouter, renommer, réordonner, supprimer.
export function PiecesPanel({ pieces, onChange, onSupprimer, onClose, T, accent }) {
  const [nouveau, setNouveau] = useState("");
  const ajouter = () => {
    const n = nouveau.trim();
    if (!n || pieces.some(p => p.nom.toLowerCase() === n.toLowerCase())) return;
    onChange([...pieces, { id: rid(), nom: n }]);
    setNouveau("");
  };
  const deplacer = (i, d) => {
    const l = [...pieces]; const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; onChange(l);
  };
  return (
    <Fenetre titre="Pièces du chantier" onClose={onClose} T={T}>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginBottom: 10 }}>
        Saisies une fois pour le chantier. Une tâche peut être rattachée à une pièce (facultatif) : filtre et regroupement dans la colonne Tâches.
      </div>
      {pieces.length === 0 && <div style={{ fontSize: FONT.sm.size, color: T.textMuted, marginBottom: 10 }}>Aucune pièce pour l'instant.</div>}
      {pieces.map((p, i) => (
        <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input defaultValue={p.nom} onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.nom) onChange(pieces.map(x => x.id === p.id ? { ...x, nom: v } : x)); }}
            style={{ ...champ(T), flex: 1 }}/>
          <button onClick={() => deplacer(i, -1)} disabled={i === 0} aria-label="Monter" style={btn(T, accent)}>↑</button>
          <button onClick={() => deplacer(i, 1)} disabled={i === pieces.length - 1} aria-label="Descendre" style={btn(T, accent)}>↓</button>
          <button onClick={() => { if (window.confirm(`Supprimer la pièce « ${p.nom} » ? Les tâches rattachées redeviennent « sans pièce ».`)) onSupprimer(p.id); }}
            aria-label="Supprimer" style={btn(T, accent)}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input value={nouveau} onChange={e => setNouveau(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ajouter(); }}
          placeholder="Salle de bain, Chambre 1, Séjour…" style={{ ...champ(T), flex: 1 }}/>
        <button onClick={ajouter} style={btn(T, accent, true)}>Ajouter</button>
      </div>
    </Fenetre>
  );
}

// Barre du bas en sélection multiple : rattacher les tâches cochées.
export function BarreSelectionPieces({ nb, pieces, onRattacher, onAnnuler, T, accent }) {
  const [piece, setPiece] = useState("");
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 900, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: T.surface || T.card, border: `1px solid ${accent}`, borderRadius: RADIUS.lg, padding: "8px 12px", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>
      <span style={{ fontWeight: 800, fontSize: FONT.sm.size }}>{nb} tâche{nb > 1 ? "s" : ""} choisie{nb > 1 ? "s" : ""}</span>
      <select value={piece} onChange={e => setPiece(e.target.value)} style={champ(T)}>
        <option value="">— pièce —</option>
        {pieces.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
        <option value="__aucune__">Sans pièce (détacher)</option>
      </select>
      <button disabled={!nb || !piece} onClick={() => onRattacher(piece === "__aucune__" ? null : piece)} style={btn(T, accent, true)}>Rattacher</button>
      <button onClick={onAnnuler} style={btn(T, accent)}>Annuler</button>
    </div>
  );
}

// Duplication d'une tâche pour plusieurs pièces, heures réparties (total conservé).
export function DuplicationPieces({ tache, nomAffiche, pieces, onValider, onClose, T, accent }) {
  const total = Math.round((parseFloat(tache?.heures_estimees) || 0) * 100) / 100;
  const [choisies, setChoisies] = useState(() => (tache?.piece_id && pieces.some(p => p.id === tache.piece_id) ? [tache.piece_id] : []));
  const [heures, setHeures] = useState({});
  const egal = (ids) => { const parts = repartirHeures(total, ids.length); setHeures(Object.fromEntries(ids.map((id, i) => [id, parts[i]]))); };
  const basculer = (id) => {
    const next = choisies.includes(id) ? choisies.filter(x => x !== id) : [...choisies, id];
    const ordre = pieces.map(p => p.id).filter(x => next.includes(x));
    setChoisies(ordre); egal(ordre);
  };
  const parts = choisies.map(id => ({ piece_id: id, heures: parseFloat(String(heures[id] ?? "").replace(",", ".")) || 0 }));
  const somme = Math.round(parts.reduce((s, p) => s + p.heures, 0) * 100) / 100;
  const juste = choisies.length >= 2 && Math.abs(somme - total) < 0.001;
  const ajuster = (id, d) => setHeures(h => ({ ...h, [id]: Math.max(0, Math.round(((parseFloat(String(h[id] ?? 0).replace(",", ".")) || 0) + d) * 100) / 100) }));
  const valider = () => {
    // La première pièce cochée garde la tâche d'origine, les autres reçoivent une copie.
    const res = dupliquerTacheParPieces(tache, parts, parts.slice(1).map(() => rid()));
    if (!res.ok) { alert(res.erreur); return; }
    onValider(res.taches);
  };
  return (
    <Fenetre titre={`Dupliquer « ${nomAffiche} » par pièce`} onClose={onClose} T={T} largeur={520}>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginBottom: 10 }}>
        Une tâche par pièce cochée. La première garde la tâche actuelle (son avancement et ses heures pointées) ; les autres partent à 0 %.
        Les {fmtH(total)} h estimées sont réparties entre les copies (ajustables) — le total ne change pas, ni les heures prévues de l'ouvrage.
      </div>
      {pieces.length < 2 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Ajoute d'abord au moins deux pièces (bouton « Pièces »).</div>}
      {pieces.map(p => {
        const on = choisies.includes(p.id);
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: FONT.sm.size }}>
              <input type="checkbox" checked={on} onChange={() => basculer(p.id)}/> {p.nom}
            </label>
            {on && (<>
              <button onClick={() => ajuster(p.id, -0.25)} style={btn(T, accent)}>−¼</button>
              <input value={heures[p.id] ?? ""} onChange={e => setHeures(h => ({ ...h, [p.id]: e.target.value }))} style={{ ...champ(T), width: 64, textAlign: "right" }}/>
              <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>h</span>
              <button onClick={() => ajuster(p.id, 0.25)} style={btn(T, accent)}>+¼</button>
            </>)}
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <span style={{ flex: 1, fontSize: FONT.sm.size, fontWeight: 700, color: juste ? T.text : "#e67e22" }}>
          Total : {fmtH(somme)} h / {fmtH(total)} h{choisies.length < 2 ? " — coche au moins deux pièces" : juste ? "" : " — la répartition doit tomber juste"}
        </span>
        <button onClick={() => egal(choisies)} disabled={choisies.length < 2} style={btn(T, accent)}>Parts égales</button>
        <button onClick={valider} disabled={!juste} style={{ ...btn(T, accent, true), opacity: juste ? 1 : 0.5 }}>Dupliquer</button>
      </div>
    </Fenetre>
  );
}

// Petit badge de pièce sur une tâche.
export function BadgePiece({ nom, T }) {
  if (!nom) return null;
  return (
    <span title={`Pièce : ${nom}`} style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: RADIUS.pill, border: `1px solid ${T.border}`, color: T.textSub, whiteSpace: "nowrap", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }}>
      {nom}
    </span>
  );
}
