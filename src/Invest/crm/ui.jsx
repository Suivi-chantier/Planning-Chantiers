// src/Invest/crm/ui.jsx — Éléments d'interface sobres du CRM V2 et de la fiche Client V2.
//
// Principe : peu de bordures, de l'espace, une hiérarchie typographique nette
// (information principale → action → synthèse → détail).
import React from "react";

export const ROUGE = "#dc2626", ORANGE = "#d97706", BLEU = "#2563eb", VERT = "#16a34a", GRIS = "#64748b";

export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
export const dateCourte = (ts) => { if (!ts) return ""; const d = new Date(ts); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); };
export const eur = (v) => (v == null || v === "" ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
export const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);

/** Fil d'Ariane : répond à « où suis-je ? ». */
export function FilAriane({ T, elements }) {
  return (
    <nav aria-label="Fil d'Ariane" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: T.textMuted, marginBottom: 14 }}>
      {elements.map((e, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden>›</span>}
          {e.onClick
            ? <button onClick={e.onClick} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", color: T.textSub, fontWeight: 700, fontSize: 12.5 }}>{e.libelle}</button>
            : <span style={{ color: T.text, fontWeight: 800 }}>{e.libelle}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

/** Onglets en soulignement, sans cadre. */
export function Onglets({ T, onglets, actif, onChange, compteurs = {} }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 22, borderBottom: `1px solid ${T.border}`, marginBottom: 22, overflowX: "auto" }}>
      {onglets.map((o) => {
        const on = o.cle === actif;
        return (
          <button key={o.cle} role="tab" aria-selected={on} onClick={() => onChange(o.cle)}
            style={{ border: 0, background: "none", cursor: "pointer", padding: "10px 0", marginBottom: -1, whiteSpace: "nowrap",
              borderBottom: `2px solid ${on ? T.accent : "transparent"}`, color: on ? T.text : T.textSub, fontWeight: on ? 900 : 700, fontSize: 14 }}>
            {o.libelle}{compteurs[o.cle] != null && <span style={{ marginLeft: 6, fontSize: 12, color: T.textMuted, fontWeight: 700 }}>{compteurs[o.cle]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Titre de section : texte seul, pas de bandeau. */
export function Section({ T, titre, action, children, style }) {
  return (
    <section style={{ marginBottom: 30, minWidth: 0, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: T.text }}>{titre}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Carte simple : fond léger, pas de sous-blocs bordés. */
export function Carte({ T, children, onClick, accent, style }) {
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      style={{ background: T.surface || T.card, borderRadius: 14, padding: "16px 18px", boxShadow: T.shadowSm, minWidth: 0,
        borderLeft: accent ? `3px solid ${accent}` : undefined, cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </div>
  );
}

export const Pastille = ({ couleur, children, titre }) => (
  <span title={titre} style={{ fontSize: 11, fontWeight: 800, color: couleur, background: `${couleur}14`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{children}</span>
);

/** Compteur cliquable (haut de « À traiter »). */
export function Compteur({ T, libelle, valeur, couleur, actif, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={actif}
      style={{ textAlign: "left", cursor: "pointer", border: `1.5px solid ${actif ? couleur : "transparent"}`, background: T.surface || T.card, borderRadius: 14,
        padding: "14px 16px", boxShadow: T.shadowSm, minWidth: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: valeur ? couleur : T.textMuted, lineHeight: 1 }}>{valeur}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.textSub, marginTop: 6 }}>{libelle}</div>
    </button>
  );
}

export const Discret = ({ T, children, style }) => <div style={{ fontSize: 12.5, color: T.textMuted, ...style }}>{children}</div>;

export function Chiffre({ T, libelle, valeur, fort }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 700 }}>{libelle}</div>
      <div style={{ fontSize: fort ? 20 : 16, fontWeight: 900, color: T.text, marginTop: 2 }}>{valeur}</div>
    </div>
  );
}

export function Vide({ T, titre, texte, action }) {
  return (
    <div style={{ padding: "26px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${T.border}` }}>
      <div style={{ fontSize: 14.5, fontWeight: 900, color: T.text }}>{titre}</div>
      {texte && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 6, maxWidth: 560, marginInline: "auto" }}>{texte}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
