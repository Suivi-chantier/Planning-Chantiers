// Choix d'un article de la bibliothèque matériaux par recherche.
//
// Remplace les <select> qui listaient toute la bibliothèque : avec plus de
// 23 000 articles (catalogue SIDER), une liste déroulante complète fige
// l'écran. On tape quelques lettres (nom, référence ou fournisseur) et au plus
// PLAFOND_LISTE_CHOIX résultats s'affichent, avec le nombre total trouvé.
import React, { useState } from "react";
import { RADIUS, FONT } from "../constants";
import { filtrerListeChoix, PLAFOND_LISTE_CHOIX } from "./materiauxCatalogueV1.js";

export default function ChoixMateriau({ materiaux = [], value = "", onChange, T, placeholder = "Chercher un matériau de la bibliothèque (optionnel)…" }) {
  const [texte, setTexte] = useState("");
  const selection = value ? materiaux.find(m => String(m.id) === String(value)) : null;
  const { visibles, total, saisieRequise } = filtrerListeChoix(materiaux, texte);
  const champ = {
    width: "100%", padding: "8px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
    background: T.fieldBg || T.surface, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  };

  if (value) {
    return (
      <div style={{ ...champ, display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selection ? selection.nom : "Matériau lié (introuvable dans la bibliothèque)"}
          {selection?.reference && <span style={{ fontWeight: 400, color: T.textMuted, fontFamily: "monospace" }}> · {selection.reference}</span>}
        </span>
        <button type="button" onClick={() => { onChange(""); setTexte(""); }} title="Retirer le lien"
          style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <input value={texte} onChange={e => setTexte(e.target.value)} placeholder={placeholder} style={champ}/>
      {texte.trim() && (
        <div style={{ marginTop: 4, maxHeight: 240, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.sm, background: T.surface }}>
          {visibles.length === 0 ? (
            <div style={{ padding: 10, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Aucun article trouvé.</div>
          ) : visibles.map(m => (
            <div key={m.id} onClick={() => { onChange(String(m.id)); setTexte(""); }}
              style={{ padding: "7px 10px", cursor: "pointer", borderBottom: `1px solid ${T.border}` }}
              onMouseEnter={e => e.currentTarget.style.background = T.card}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{m.nom}</div>
              <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                {[m.reference, m.fournisseur].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
          {total > visibles.length && (
            <div style={{ padding: "7px 10px", fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
              {visibles.length} affichés sur {total} — précisez la recherche.
            </div>
          )}
        </div>
      )}
      {!texte.trim() && saisieRequise && (
        <div style={{ marginTop: 4, fontSize: FONT.xs.size, color: T.textMuted }}>
          {total} articles : tapez un nom, une référence ou un fournisseur ({PLAFOND_LISTE_CHOIX} résultats au plus).
        </div>
      )}
    </div>
  );
}
