// src/Renovation/blocsDuJour/BandeauDuJour.jsx — Bandeau du jour en haut du
// tableau de bord (projet docs/projets/organisation-par-jour.md, tâche 5).
//
// Affiché seulement quand l'utilisateur a une organisation pour ce jour-là
// (bandeauDuJour non null) : nom du jour, thématique, rendez-vous du jour
// (triés par trierRendezVous) et bouton « Ordre habituel aujourd'hui » /
// « Revenir à l'organisation du jour » (actions du hook useOrganisationDuJour,
// même écriture que le glisser-déposer). En mode « ordre habituel », le
// bandeau reste visible avec une mention discrète (règle 7).
import React from "react";
import { CalendarCheck, CalendarX, Clock, CalendarDays } from "lucide-react";
import { Icon } from "../../ui";
import { FONT, RADIUS } from "../../constants";
import { CARD_SHADOW } from "../../mobileUI";

export default function BandeauDuJour({ bandeau, onBasculer, T, accent = "#FFC200", isMobile }) {
  if (!bandeau) return null;
  const { libelleDate, theme, rendezVous, ordreHabituel, bouton } = bandeau;
  return (
    <section aria-label="Organisation du jour" style={{
      background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 16, boxShadow: CARD_SHADOW, padding: isMobile ? "13px 15px" : "16px 20px",
      marginBottom: isMobile ? 0 : 20,
      display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 10 : 20,
      alignItems: isMobile ? "stretch" : "flex-start",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: T.textMuted }}>
          <Icon as={CalendarDays} size={13} style={{ color: accent }}/>
          Organisation du jour · {libelleDate}
        </div>
        <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginTop: 4 }}>
          {theme || <span style={{ color: T.textSub, fontWeight: 600, fontSize: FONT.base.size }}>Pas de thématique réglée pour ce jour.</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          {rendezVous.length === 0 ? (
            <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>Aucun rendez-vous fixe ce jour-là.</div>
          ) : (
            <ul aria-label="Rendez-vous du jour" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {rendezVous.map((r, i) => (
                <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: FONT.sm.size, color: T.text }}>
                  <Icon as={Clock} size={12} style={{ color: T.textMuted, flexShrink: 0, alignSelf: "center" }}/>
                  {r.heure && <strong style={{ fontVariantNumeric: "tabular-nums" }}>{r.heure.replace(":", "h")}</strong>}
                  <span>{r.libelle}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {ordreHabituel && (
          <div role="status" style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>
            Ordre habituel aujourd'hui : menu et tableau de bord sans l'organisation du jour, jusqu'à demain.
          </div>
        )}
      </div>
      {bouton && onBasculer && (
        <button type="button" onClick={onBasculer}
          title={bouton.actif ? "Revenir à l'organisation du jour" : "Ordre habituel aujourd'hui : menu et tableau de bord sans l'organisation du jour, jusqu'à demain"}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
            background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
            padding: "6px 12px", color: T.textSub, fontSize: FONT.xs.size + 1, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", alignSelf: isMobile ? "flex-start" : "flex-start",
          }}>
          <Icon as={bouton.actif ? CalendarCheck : CalendarX} size={13}/>
          {bouton.libelle}
        </button>
      )}
    </section>
  );
}
