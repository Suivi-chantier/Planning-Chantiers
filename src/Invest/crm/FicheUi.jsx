// src/Invest/crm/FicheUi.jsx — petits composants d'affichage de la fiche client (aucune donnée, aucun appel base).
// Frise d'une mission, grille de champs « À compléter », barre de progression.
import React from "react";
import { eur, ORANGE, VERT } from "./ui";

/** Frise : étapes faites (pleines), étape en cours (fortement mise en avant), étapes à venir (grises). */
export function Frise({ T, frise }) {
  return (
    <ol aria-label="Avancement de la mission" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${frise.etapes.length}, minmax(0,1fr))`, gap: 4 }}>
      {frise.etapes.map((e) => {
        const courante = e.libelle === frise.courante && !frise.terminee;
        const fait = e.etat === "fait";
        const couleur = fait ? T.sidebar || "#16233f" : courante ? T.accent : T.textMuted;
        return (
          <li key={e.cle} aria-current={courante ? "step" : undefined} style={{ minWidth: 0, textAlign: "center" }}>
            <div style={{ height: courante ? 6 : 4, borderRadius: 3, background: fait ? couleur : courante ? T.accent : `${T.textMuted}40`, marginBottom: 6 }} />
            <div style={{ fontSize: courante ? 12.5 : 11.5, fontWeight: courante ? 900 : fait ? 700 : 600, color: courante ? T.text : fait ? T.textSub : T.textMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={`${e.libelle} — ${fait ? "fait" : courante ? "en cours" : e.etat === "cours" ? "entamé" : "à venir"}`}>
              {fait ? "✓ " : courante ? "● " : e.etat === "cours" ? "◐ " : "○ "}{e.libelle}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Champs d'une mission : la valeur si elle existe, sinon « À compléter » (jamais 0, jamais une valeur inventée). */
export function ChampsMission({ T, champs }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px 16px" }}>
      {champs.map((c) => (
        <div key={c.cle} style={{ minWidth: 0 }}>
          <dt style={{ fontSize: 11.5, color: T.textMuted, fontWeight: 700 }}>{c.libelle}</dt>
          <dd style={{ margin: "1px 0 0", fontSize: 13.5, fontWeight: c.valeur == null ? 600 : 800, color: c.valeur == null ? ORANGE : T.text, overflowWrap: "anywhere" }}>
            {c.valeur == null ? "À compléter" : c.type === "eur" ? eur(c.valeur) : String(c.valeur)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Barre({ T, pourcentage, couleur }) {
  return (
    <div role="progressbar" aria-valuenow={pourcentage} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: `${T.textMuted}30`, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pourcentage))}%`, height: "100%", background: couleur || (pourcentage >= 100 ? VERT : T.accent) }} />
    </div>
  );
}
