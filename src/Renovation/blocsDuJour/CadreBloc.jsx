// src/Renovation/blocsDuJour/CadreBloc.jsx — Cadre commun d'un bloc du
// tableau de bord du jour (projet docs/projets/organisation-par-jour.md,
// tâche 5).
//
// Bureau : carte au style des widgets du tableau de bord (titre métier,
// métrique clé à droite, liens vers les pages du bloc en pied).
// Téléphone : section accordéon `MobileSection` existante, métrique clé dans
// l'en-tête (règle du catalogue), contenu + liens une fois dépliée.
import React from "react";
import { ArrowRight } from "lucide-react";
import { Icon } from "../../ui";
import { FONT, RADIUS, SPACING } from "../../constants";
import { MobileSection, CARD_SHADOW } from "../../mobileUI";
import { LABELS_PAGES } from "../Navigation";

/** Message affiché par un bloc dont le contenu n'est pas encore livré (règle 10). */
export const MESSAGE_BLOC_A_VENIR = "Contenu de ce bloc : à venir dans une prochaine mise à jour.";

/** Liens vers les pages du bloc (déjà filtrés sur les pages autorisées du rôle). */
function LiensBloc({ liens, onOuvrirPage, T, accent }) {
  if (!onOuvrirPage || !liens || liens.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      {liens.map((id) => (
        <button key={id} type="button" onClick={() => onOuvrirPage(id)} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
          padding: "5px 11px", color: accent, fontSize: FONT.xs.size + 1, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          {LABELS_PAGES[id] || id}
          <Icon as={ArrowRight} size={12}/>
        </button>
      ))}
    </div>
  );
}

/**
 * Cadre d'un bloc du jour.
 * @param {object} p
 * @param {string} p.titre        libellé métier (LIBELLES_BLOCS)
 * @param {any}    p.icone        icône lucide
 * @param {string} p.accent       couleur d'accent
 * @param {boolean} p.isMobile
 * @param {string[]} p.liens      pages autorisées liées au bloc (liensDuBloc)
 * @param {(id:string)=>void} [p.onOuvrirPage]
 * @param {React.ReactNode} [p.metrique]     métrique clé (en-tête), null = aucune
 * @param {string} [p.metriqueTon]           couleur de la métrique (téléphone)
 */
export function CadreBloc({ titre, icone, accent = "#FFC200", T, isMobile, liens, onOuvrirPage, metrique = null, metriqueTon, children, idBloc }) {
  if (isMobile) {
    return (
      <div data-bloc-du-jour={idBloc}>
        <MobileSection T={T} accent={accent} icon={icone} title={titre} summary={metrique} summaryTone={metriqueTon}>
          {children}
          <LiensBloc liens={liens} onOuvrirPage={onOuvrirPage} T={T} accent={accent}/>
        </MobileSection>
      </div>
    );
  }
  return (
    <div data-bloc-du-jour={idBloc} style={{
      background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 16, boxShadow: CARD_SHADOW, overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        padding: "14px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${T.sectionDivider}`, gap: SPACING.md,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {icone && (
            <div style={{
              width: 28, height: 28, borderRadius: RADIUS.md, background: accent + "1a", color: accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}><Icon as={icone} size={16} strokeWidth={2}/></div>
          )}
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textSub }}>{titre}</div>
        </div>
        {metrique != null && metrique !== "" && (
          <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: metriqueTon || T.text, whiteSpace: "nowrap" }}>{metrique}</div>
        )}
      </div>
      <div style={{ padding: "14px 20px 16px", flex: 1 }}>
        {children}
        <LiensBloc liens={liens} onOuvrirPage={onOuvrirPage} T={T} accent={accent}/>
      </div>
    </div>
  );
}

/**
 * Bloc dont le contenu n'est pas encore livré : cadre, titre, liens et message
 * explicite (jamais de bloc vide sans explication, règle 10). La métrique de
 * l'en-tête affiche « à venir ».
 */
export function BlocAVenir(props) {
  return (
    <CadreBloc {...props} metrique="à venir">
      <div style={{ color: props.T.textSub, fontSize: FONT.sm.size, lineHeight: 1.55 }}>{MESSAGE_BLOC_A_VENIR}</div>
    </CadreBloc>
  );
}
