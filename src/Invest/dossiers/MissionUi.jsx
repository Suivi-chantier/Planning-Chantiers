// src/Invest/dossiers/MissionUi.jsx — composants d'affichage partagés de la mission Offre 2 (aucun appel base).
// DA Profero : bleu marine pour la structure et la lecture, doré en accent rare (étape actuelle, bouton principal).
import React from "react";

export const MARINE = "#16233f";
export const COULEURS = { termine: "#16a34a", cours: "#2563eb", avenir: "#94a3b8", bloque: "#dc2626", na: "#cbd5e1", ok: "#16a34a", a_faire: "#d97706" };
export const eur = (v) => (v == null || v === "" ? null : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : null);
export const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);

/** Carte compacte : titre en capitales discrètes, filet léger, pas de grand cadre. */
export function Bloc({ T, titre, action, children, style, id }) {
  return (
    <section id={id} style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "11px 14px", minWidth: 0, ...style }}>
      {(titre || action) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.9, textTransform: "uppercase", color: T.textSub }}>{titre}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const Pastille = ({ couleur, children, titre }) => (
  <span title={titre} style={{ fontSize: 10.5, fontWeight: 800, color: couleur, background: `${couleur}14`, border: `1px solid ${couleur}30`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>
);

/** Donnée : valeur ou « À compléter » (jamais 0 à la place d'une absence ; un vrai 0 s'affiche 0). */
export function Donnee({ T, libelle, valeur, type, fort }) {
  const absent = valeur === null || valeur === undefined || valeur === "";
  const texte = absent ? "À compléter" : type === "eur" ? eur(valeur) : type === "pct" ? `${String(valeur).replace(".", ",")} %` : String(valeur);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}</div>
      <div style={{ fontSize: fort ? 14.5 : 12.5, fontWeight: absent ? 600 : fort ? 900 : 700, color: absent ? "#b45309" : T.text, overflowWrap: "anywhere" }}>{texte}</div>
    </div>
  );
}
export const GrilleDonnees = ({ T, donnees, colonnes = 150 }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${colonnes}px,1fr))`, gap: "8px 14px" }}>
    {donnees.map((d) => <Donnee key={d.cle || d.libelle} T={T} {...d} />)}
  </div>
);

/** État vide intelligent : un titre, une phrase, une action. */
export function EtatVide({ T, titre, texte, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", borderRadius: 10, border: `1px dashed ${T.border}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{titre}</div>
        {texte && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>{texte}</div>}
      </div>
      {action}
    </div>
  );
}

/** Frise principale : l'étape actuelle est la seule en relief (doré) ; les étapes terminées sont en bleu marine. */
export function FriseMission({ T, frise, onOuvrir }) {
  return (
    <ol aria-label="Avancement de la mission" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${frise.jalons.length}, minmax(0,1fr))`, gap: 4 }}>
      {frise.jalons.map((j) => {
        const fait = j.etat === "termine", na = j.etat === "na", bloque = j.etat === "bloque";
        const barre = bloque ? COULEURS.bloque : j.courant ? T.accent : fait ? MARINE : na ? `${T.textMuted}30` : j.etat === "cours" ? `${MARINE}70` : `${T.textMuted}40`;
        return (
          <li key={j.cle} aria-current={j.courant ? "step" : undefined} style={{ minWidth: 0 }}>
            <button onClick={() => onOuvrir?.(j.onglet)} title={`${j.libelle} — ${j.etatLibelle}`}
              style={{ all: "unset", cursor: onOuvrir ? "pointer" : "default", display: "block", width: "100%", textAlign: "center", boxSizing: "border-box" }}>
              <div style={{ height: j.courant ? 6 : 4, borderRadius: 3, background: barre, marginBottom: 5 }} />
              <div style={{ fontSize: j.courant ? 12 : 11, fontWeight: j.courant ? 900 : fait ? 700 : 600, color: j.courant ? T.text : fait ? T.textSub : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                textDecoration: na ? "line-through" : "none" }}>
                {fait ? "✓ " : j.courant ? "● " : bloque ? "⛔ " : ""}{j.libelle}
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: bloque ? COULEURS.bloque : j.courant ? T.accent : T.textMuted }}>{j.etatLibelle}</div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Pipeline horizontal générique (financement, acquisition). */
export function Pipeline({ T, etapes }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${etapes.length}, minmax(0,1fr))`, gap: 4 }}>
      {etapes.map((e) => (
        <li key={e.libelle} style={{ minWidth: 0, textAlign: "center" }}>
          <div style={{ height: e.etat === "cours" ? 6 : 4, borderRadius: 3, marginBottom: 4, background: e.etat === "termine" ? MARINE : e.etat === "cours" ? T.accent : `${T.textMuted}40` }} />
          <div style={{ fontSize: 11, fontWeight: e.etat === "cours" ? 900 : 600, color: e.etat === "cours" ? T.text : e.etat === "termine" ? T.textSub : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.etat === "termine" ? "✓ " : ""}{e.libelle}</div>
        </li>
      ))}
    </ol>
  );
}
