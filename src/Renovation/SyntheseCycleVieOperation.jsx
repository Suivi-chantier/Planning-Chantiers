// ─────────────────────────────────────────────────────────────────────────────
// Synthèse du cycle de vie des chantiers d'une opération (Refonte Opérations,
// lot 3). LECTURE SEULE : l'opération n'a pas de cycle de vie à elle ; on
// compte, chantier par chantier, les étapes enregistrées (table
// chantier_cycle_vie + ancien cycle du phasage repris à la lecture).
// Calcul : syntheseCycleVieOperation / resumeCycleVieChantier (cycleVie.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { FONT, RADIUS } from "../constants";
import {
  etatsCycleVie, autorisationPartagee, resumeCycleVieChantier, syntheseCycleVieOperation,
} from "./cycleVie.js";
import { chargerCycleVie } from "./cycleVieDonnees.js";
import { estChantierPerdu, statutAffiche } from "./statutsChantier.js";
import { BadgeStatut } from "./ComposantsCommerciaux.jsx";

// Lot 5 : ce bloc est aussi LA liste des chantiers de la fiche Opération
// (porte d'entrée) : chaque chantier, son statut, sa mini-frise ; un clic
// ouvre la fiche chantier (onOpenChantier). La liste s'affiche même si les
// étapes ne se chargent pas (la frise dit alors pourquoi elle manque).
export default function SyntheseCycleVieOperation({ T, chantiersOp = [], phasagesParChantier = {}, onOpenChantier = null }) {
  const [lignes, setLignes] = useState({ charge: false, liste: [], erreur: null });
  const ids = chantiersOp.map((c) => c.id).join("|");
  useEffect(() => {
    let actif = true;
    setLignes({ charge: false, liste: [], erreur: null });
    chargerCycleVie(ids ? ids.split("|") : []).then((r) => { if (actif) setLignes({ charge: true, liste: r.lignes, erreur: r.erreur }); });
    return () => { actif = false; };
  }, [ids]);

  const { synthese, parChantier } = useMemo(() => {
    const etatsPar = {};
    chantiersOp.forEach((c) => {
      const meta = phasagesParChantier?.[c.id]?.plan_travaux?.meta || null;
      etatsPar[c.id] = etatsCycleVie({ meta, lignes: lignes.liste.filter((l) => l.chantier_id === c.id) }).etats;
    });
    const parChantier = chantiersOp.map((c) => {
      const autorisation = autorisationPartagee({
        chantierId: c.id, etatPropre: etatsPar[c.id]?.autorisation_recue || null,
        autres: chantiersOp.filter((x) => x.id !== c.id).map((x) => ({ chantierId: x.id, chantierNom: x.nom, etat: etatsPar[x.id]?.autorisation_recue || null })),
      });
      return { id: c.id, nom: c.nom, couleur: c.couleur, statut: statutAffiche(c), perdu: estChantierPerdu(c), resume: resumeCycleVieChantier({ etats: etatsPar[c.id], autorisation }) };
    });
    return { synthese: syntheseCycleVieOperation(parChantier), parChantier };
  }, [chantiersOp, phasagesParChantier, lignes.liste]);

  if (!chantiersOp.length) return null;
  const border = T.border, text = T.text, textMuted = T.textMuted, textSub = T.textSub;
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: RADIUS.lg || 12, padding: "12px 16px", marginBottom: 16, background: T.card || "transparent" }}>
      <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Chantiers et cycle de vie <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>— synthèse en lecture seule (les étapes se valident sur chaque fiche chantier{onOpenChantier ? " : cliquez sur un chantier pour l'ouvrir" : ""})</span>
      </div>
      {!lignes.charge ? (
        <div style={{ fontSize: FONT.sm.size, color: textMuted, fontStyle: "italic" }}>Chargement…</div>
      ) : lignes.erreur ? (
        <div style={{ fontSize: FONT.sm.size, color: "#e15a5a", fontWeight: 600 }}>
          Synthèse indisponible : étapes du cycle de vie illisibles ({lignes.erreur}).
        </div>
      ) : null}
      {lignes.charge && !lignes.erreur && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {synthese.lignes.map((l) => (
              <span key={l.id} style={{
                fontSize: FONT.sm.size, fontWeight: 700, color: l.faits === l.total && l.total > 0 ? "#22c55e" : text,
                border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "3px 11px",
              }}>{l.texte}</span>
            ))}
          </div>
      )}
      {lignes.charge && !lignes.erreur && synthese.perdus > 0 && (
        <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 6 }}>
          {synthese.perdus} chantier{synthese.perdus > 1 ? "s" : ""} perdu{synthese.perdus > 1 ? "s" : ""}, non compté{synthese.perdus > 1 ? "s" : ""}.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
        {parChantier.map((c) => (
          <div key={c.id}
            role={onOpenChantier ? "button" : undefined} tabIndex={onOpenChantier ? 0 : undefined}
            onClick={onOpenChantier ? () => onOpenChantier(c.id) : undefined}
            onKeyDown={onOpenChantier ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenChantier(c.id); } } : undefined}
            title={onOpenChantier ? `Ouvrir la fiche du chantier ${c.nom}` : undefined}
            className={onOpenChantier ? "pops-row-clic" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: FONT.xs.size + 1,
              padding: "4px 6px", borderRadius: 8, cursor: onOpenChantier ? "pointer" : "default" }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c.couleur || "#888", flexShrink: 0 }}/>
            <span style={{ color: onOpenChantier ? text : textSub, fontWeight: 700, minWidth: 140, textDecoration: onOpenChantier ? "underline" : "none", textDecorationColor: border }}>{c.nom}</span>
            <BadgeStatut statut={c.statut}/>
            {!lignes.charge ? null
              : lignes.erreur ? <span style={{ color: "#e15a5a" }}>frise indisponible</span>
              : c.resume.jalons.map((j) => (
                <span key={j.id} title={j.via ? `Validée via le chantier ${j.via.chantierNom}` : ""} style={{
                  color: j.fait ? "#22c55e" : textMuted, fontWeight: j.fait ? 700 : 500,
                }}>{j.fait ? "●" : "○"} {j.court}</span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
