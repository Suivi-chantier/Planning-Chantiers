// src/Invest/crm/FichePatrimoine.jsx — onglet « Patrimoine » : UN patrimoine par client, commun à toutes ses missions.
// Résumé par section (« non renseigné » ≠ 0 €), complétude, puis la carte de saisie existante (SituationPatrimonialeCard).
import React, { useState } from "react";
import SituationPatrimonialeCard from "../dossiers/SituationPatrimonialeCard";
import { Barre } from "./FicheUi";
import { Section, Carte, Vide, Discret, eur, ORANGE, VERT } from "./ui";

export default function FichePatrimoine({ T, client, vue, completude, dossierEnCours, onNouvelleMission }) {
  const [collecte, setCollecte] = useState(false);
  const p = vue.patrimoine;
  const montant = {
    revenus: !p.incomplet && p.revenusMensuels != null ? `${eur(p.revenusMensuels)} / mois` : null,
    epargne: p.epargneDisponible != null ? `${eur(p.epargneDisponible)} disponibles` : null,
  };
  const carte = (
    <Carte T={T}>
      <SituationPatrimonialeCard client={client} T={T} dossierEnCoursId={dossierEnCours?.id ?? null} dossierReference={dossierEnCours?.reference ?? null} integre />
    </Carte>
  );

  if (completude.vide && !collecte) {
    return (
      <Vide T={T} titre="SITUATION PATRIMONIALE À COMPLÉTER"
        texte="Aucune donnée patrimoniale n'est encore saisie pour ce client : foyer, revenus et charges, épargne, crédits, immobilier."
        action={dossierEnCours
          ? <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setCollecte(true)}>Commencer la collecte</button>
          : <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <Discret T={T}>La saisie se fait dans une mission en cours : démarrez-en une pour commencer.</Discret>
              <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={onNouvelleMission}>＋ Nouvelle mission</button>
            </div>} />
    );
  }
  return (
    <>
      <Section T={T} compact titre={`Dossier patrimonial : ${completude.pourcentage} % complété`}>
        <Barre T={T} pourcentage={completude.pourcentage} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 12 }}>
          {completude.sections.map((s) => (
            <div key={s.cle} style={{ minWidth: 0, padding: "8px 12px", borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textMuted }}>{s.libelle}</div>
              <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2, color: s.renseignee ? T.text : ORANGE }}>
                {s.renseignee ? (s.detail || `${s.lignes} ligne${s.lignes > 1 ? "s" : ""}`) : "Non renseigné"}
              </div>
              {s.cle === "revenus" && s.renseignee && montant.revenus && <div style={{ fontSize: 11.5, color: T.textSub }}>{montant.revenus}</div>}
              {s.cle === "epargne" && s.renseignee && montant.epargne && <div style={{ fontSize: 11.5, color: T.textSub }}>{montant.epargne}</div>}
            </div>
          ))}
        </div>
        {p.incomplet && <Discret T={T} style={{ marginTop: 8 }}>Certains totaux sont incomplets : une donnée manque, ils ne sont donc pas affichés comme exacts.</Discret>}
        {completude.pourcentage >= 100 && <Discret T={T} style={{ marginTop: 8, color: VERT }}>Toutes les sections de base sont renseignées.</Discret>}
      </Section>
      <Section T={T} compact titre="Détail et modification">
        <Discret T={T} style={{ marginBottom: 10, maxWidth: 760 }}>
          Ce patrimoine appartient au client et sert à toutes ses missions.
          {dossierEnCours ? ` Les modifications sont rattachées à la mission ${dossierEnCours.reference}.` : " Sans mission en cours, il est consultable mais non modifiable."}
        </Discret>
        {carte}
      </Section>
    </>
  );
}
