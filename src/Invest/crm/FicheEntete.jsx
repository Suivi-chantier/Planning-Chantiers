// src/Invest/crm/FicheEntete.jsx — en-tête de la fiche client : NOM Prénom, statut, conseiller, téléphone, e-mail,
// et les trois gestes du quotidien [＋ Nouvelle mission] [＋ Note] [•••]. Aucune donnée n'est écrite ici.
import React, { useEffect, useRef, useState } from "react";
import { Pastille, BLEU, ORANGE } from "./ui";

export default function FicheEntete({ T, entete, onNouvelleMission, onNote, actionsMenu }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const ferme = (e) => { if (zone.current && !zone.current.contains(e.target)) setOuvert(false); };
    const echap = (e) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", ferme); document.addEventListener("keydown", echap);
    return () => { document.removeEventListener("mousedown", ferme); document.removeEventListener("keydown", echap); };
  }, [ouvert]);
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: T.text, letterSpacing: -0.4 }}>{entete.nom}</h1>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 6, fontSize: 13, color: T.textSub }}>
          <Pastille couleur={BLEU}>{entete.statutRelation}</Pastille>
          <span>Conseiller : <b style={{ color: T.text }}>{entete.conseiller || "non défini"}</b></span>
          {entete.telephone ? <a href={`tel:${entete.telephone}`} style={{ color: T.textSub }}>{entete.telephone}</a> : <span style={{ color: ORANGE }}>Téléphone non renseigné</span>}
          {entete.email ? <a href={`mailto:${entete.email}`} style={{ color: T.textSub, overflowWrap: "anywhere" }}>{entete.email}</a> : <span style={{ color: ORANGE }}>E-mail non renseigné</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={onNouvelleMission}>＋ Nouvelle mission</button>
        <button className="inv-btn inv-btn-sm" onClick={onNote}>＋ Note</button>
        <div ref={zone} style={{ position: "relative" }}>
          <button className="inv-btn inv-btn-sm" aria-haspopup="menu" aria-expanded={ouvert} aria-label="Autres actions" onClick={() => setOuvert((v) => !v)}>•••</button>
          {ouvert && (
            <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 220, background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: 4 }}>
              {actionsMenu.map((a) => (
                <button key={a.cle} role="menuitem" disabled={a.indisponible} title={a.indisponible || undefined} onClick={() => { setOuvert(false); a.onClick?.(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "none", padding: "8px 10px", borderRadius: 7, fontSize: 13, fontWeight: 700,
                    color: a.indisponible ? T.textMuted : T.text, cursor: a.indisponible ? "not-allowed" : "pointer" }}>
                  {a.libelle}{a.indisponible && <span style={{ display: "block", fontSize: 11, fontWeight: 500 }}>{a.indisponible}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
