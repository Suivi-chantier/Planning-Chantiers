// Libellé d'un ouvrage ou d'une tâche, renommable directement dans la ligne
// (prompt CR-2). Affiche le nom personnalisé s'il existe, sinon le libellé
// devis ; le libellé devis reste visible en petit dessous quand il diffère.
// Double-clic ou crayon → champ dans la ligne ; Entrée / clic ailleurs =
// enregistrer, Échap = annuler. Un nom vide ou identique au devis retire le
// nom personnalisé (le libellé devis n'est jamais modifié ici).
import React, { useEffect, useRef, useState } from "react";
import { FONT } from "../constants";

export default function LibelleEditable({ affiche, devis, perso, onSave, T, vide = "(sans nom)", gras = 700, taille = FONT.sm.size, uneLigne = true }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (edition && ref.current) { ref.current.focus(); ref.current.select(); } }, [edition]);

  const ouvrir = (e) => { e.stopPropagation(); setValeur(affiche || ""); setEdition(true); };
  const valider = () => { setEdition(false); if ((valeur || "").trim() !== (affiche || "").trim()) onSave(valeur); };

  if (edition) {
    return (
      <input ref={ref} value={valeur}
        onClick={e => e.stopPropagation()}
        onChange={e => setValeur(e.target.value)}
        onBlur={valider}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); valider(); }
          if (e.key === "Escape") { e.preventDefault(); setEdition(false); }
        }}
        placeholder={devis || vide}
        title="Nom sur le chantier — vide = reprendre le libellé du devis"
        style={{ width: "100%", boxSizing: "border-box", fontWeight: gras, fontSize: taille, color: T.text,
          background: T.inputBg || T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "2px 6px" }}/>
    );
  }
  const ellipse = uneLigne ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : {};
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }} onDoubleClick={ouvrir}>
        <div style={{ fontWeight: gras, fontSize: taille, color: T.text, minWidth: 0, ...ellipse }}>
          {affiche || <span style={{ fontStyle: "italic", color: T.textMuted }}>{vide}</span>}
        </div>
        <button type="button" onClick={ouvrir} aria-label="Renommer pour ce chantier"
          title="Renommer pour ce chantier (le libellé du devis est conservé)"
          style={{ flexShrink: 0, border: "none", background: "transparent", color: T.textMuted, cursor: "pointer", padding: "0 2px", fontSize: taille - 1, lineHeight: 1 }}>
          ✎
        </button>
      </div>
      {perso && devis && (
        <div title={devis} style={{ fontSize: FONT.xs.size - 1, color: T.textMuted, ...ellipse }}>Devis : {devis}</div>
      )}
    </div>
  );
}
