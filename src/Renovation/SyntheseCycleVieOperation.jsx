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
import { estChantierPerdu } from "./statutsChantier.js";

export default function SyntheseCycleVieOperation({ T, chantiersOp = [], phasagesParChantier = {} }) {
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
      return { id: c.id, nom: c.nom, perdu: estChantierPerdu(c), resume: resumeCycleVieChantier({ etats: etatsPar[c.id], autorisation }) };
    });
    return { synthese: syntheseCycleVieOperation(parChantier), parChantier };
  }, [chantiersOp, phasagesParChantier, lignes.liste]);

  if (!chantiersOp.length) return null;
  const border = T.border, text = T.text, textMuted = T.textMuted, textSub = T.textSub;
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: RADIUS.lg || 12, padding: "12px 16px", marginBottom: 16, background: T.card || "transparent" }}>
      <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Cycle de vie des chantiers <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>— synthèse en lecture seule (les étapes se valident sur chaque fiche chantier)</span>
      </div>
      {!lignes.charge ? (
        <div style={{ fontSize: FONT.sm.size, color: textMuted, fontStyle: "italic" }}>Chargement…</div>
      ) : lignes.erreur ? (
        <div style={{ fontSize: FONT.sm.size, color: "#e15a5a", fontWeight: 600 }}>
          Synthèse indisponible : étapes du cycle de vie illisibles ({lignes.erreur}).
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {synthese.lignes.map((l) => (
              <span key={l.id} style={{
                fontSize: FONT.sm.size, fontWeight: 700, color: l.faits === l.total && l.total > 0 ? "#22c55e" : text,
                border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "3px 11px",
              }}>{l.texte}</span>
            ))}
          </div>
          {synthese.perdus > 0 && (
            <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 6 }}>
              {synthese.perdus} chantier{synthese.perdus > 1 ? "s" : ""} perdu{synthese.perdus > 1 ? "s" : ""}, non compté{synthese.perdus > 1 ? "s" : ""}.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
            {parChantier.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: FONT.xs.size + 1 }}>
                <span style={{ color: textSub, fontWeight: 700, minWidth: 140 }}>{c.nom}{c.perdu ? " (perdu)" : ""}</span>
                {c.resume.jalons.map((j) => (
                  <span key={j.id} title={j.via ? `Validée via le chantier ${j.via.chantierNom}` : ""} style={{
                    color: j.fait ? "#22c55e" : textMuted, fontWeight: j.fait ? 700 : 500,
                  }}>{j.fait ? "●" : "○"} {j.court}</span>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
