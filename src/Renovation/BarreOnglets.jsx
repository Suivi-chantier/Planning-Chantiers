import React from "react";
import { Plus, X } from "lucide-react";
import { Icon } from "../ui";
import { useIsMobile } from "../hooks";

// Barre d'onglets façon navigateur (Rénovation et Invest ; `labels` = id de page → libellé) : chaque onglet porte sa propre page de
// l'application (et garde son état tant qu'il reste ouvert). Masquée sur mobile,
// où la navigation passe par la barre du bas.
export const MAX_ONGLETS = 12;

export default function BarreOnglets({ onglets, actifId, onSelect, onFermer, onNouveau, T, acc, labels = {} }) {
  const mobile = useIsMobile();
  if (mobile) return null;
  const peutFermer = onglets.length > 1;
  return (
    <div style={{
      display:"flex", alignItems:"flex-end", gap:2, padding:"6px 10px 0",
      background:T.surface, borderBottom:`1px solid ${T.border}`, flexShrink:0, overflowX:"auto",
    }}>
      {onglets.map(o => {
        const actif = o.id === actifId;
        return (
          <div key={o.id}
            onClick={() => onSelect(o.id)}
            onAuxClick={(e) => { if (e.button === 1 && peutFermer) { e.preventDefault(); onFermer(o.id); } }}
            title={labels[o.page] || o.page}
            style={{
              display:"flex", alignItems:"center", gap:6, minWidth:110, maxWidth:200, flex:"0 1 200px",
              padding:"7px 8px 7px 12px", cursor:"pointer", fontSize:12.5, fontWeight:actif ? 700 : 500,
              color:actif ? T.text : T.textSub, background:actif ? T.card : "transparent",
              border:`1px solid ${actif ? T.border : "transparent"}`, borderBottom:"none",
              borderTop:`2px solid ${actif ? acc.accent : "transparent"}`,
              borderRadius:"8px 8px 0 0", userSelect:"none",
            }}>
            <span style={{flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
              {labels[o.page] || o.page}
            </span>
            {peutFermer && (
              <button onClick={(e) => { e.stopPropagation(); onFermer(o.id); }}
                title="Fermer l'onglet" aria-label="Fermer l'onglet"
                style={{display:"inline-flex", background:"none", border:"none", padding:2, borderRadius:4,
                  cursor:"pointer", color:"inherit", opacity:.7}}>
                <Icon as={X} size={13}/>
              </button>
            )}
          </div>
        );
      })}
      {onglets.length < MAX_ONGLETS && (
        <button onClick={onNouveau} title="Nouvel onglet" aria-label="Nouvel onglet"
          style={{display:"inline-flex", alignItems:"center", background:"none", border:"none",
            padding:"8px 10px", marginBottom:2, cursor:"pointer", color:T.textSub, borderRadius:6}}>
          <Icon as={Plus} size={15}/>
        </button>
      )}
    </div>
  );
}
