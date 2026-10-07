// src/Invest/dossiers/MissionProjet.jsx — onglet « Projet » : objectifs, capacité, critères, stratégie retenue, scénarios.
// Fusionne les anciens onglets Projet, Analyse et Stratégie SANS en perdre les données : les écrans existants restent
// disponibles dans les volets repliables (questionnaire du projet, analyse et hypothèses, stratégie et scénarios).
// La capacité est lue sur le patrimoine du CLIENT : « non renseigné » n'est jamais présenté comme 0 €.
import React from "react";
import ProjetSituationCard from "./ProjetSituationCard";
import AnalyseMission from "./AnalyseMission";
import StrategieMission from "./StrategieMission";
import { Bloc, GrilleDonnees, EtatVide, Pastille, COULEURS } from "./MissionUi";

const ORANGE = "#d97706";

function Volet({ T, titre, resume, children, ouvert = false }) {
  return (
    <details open={ouvert} style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, marginTop: 8, paddingTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 800, color: T.textSub }}>{titre}{resume && <span style={{ fontWeight: 600, color: T.textMuted }}> — {resume}</span>}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

export default function MissionProjet({ T, fiche, client, profil, m, naviguer, onOuvrirEtape, onClientOnglet, modifiable, setOnglet }) {
  const d = fiche.dossier;
  const a = m.analyse, pat = m.patrimoine;
  const sec = (cle) => pat.sections.find((s) => s.cle === cle)?.renseignee;
  const connu = (cle, v) => (sec(cle) ? v : null);
  const cap = a.capacite.calculable && sec("revenus");
  const capacite = [
    { cle: "revenus", libelle: "Revenus mensuels", valeur: connu("revenus", a.revenus), type: "eur" },
    { cle: "charges", libelle: "Charges mensuelles", valeur: connu("revenus", a.charges), type: "eur" },
    { cle: "credits", libelle: "Crédits en cours (mensualités)", valeur: connu("credits", a.creditsEnCours), type: "eur" },
    { cle: "epargne", libelle: "Épargne disponible", valeur: connu("epargne", a.epargneDisponible), type: "eur" },
    { cle: "apport", libelle: "Apport souhaité", valeur: m.criteres.objectifs.find((o) => o.cle === "apport")?.valeur ?? null, type: "eur" },
    { cle: "endettement", libelle: "Taux d'endettement actuel", valeur: cap ? a.tauxEndettementPct : null, type: "pct" },
    { cle: "capacite", libelle: "Capacité d'investissement indicative", valeur: cap ? a.capacite.capaciteAchat : null, type: "eur", fort: true },
    { cle: "hyp", libelle: "Hypothèses (taux · durée · endettement max)", valeur: `${String(a.hypotheses.tauxPct).replace(".", ",")} % · ${a.hypotheses.dureeAns} ans · ${a.hypotheses.endettementMaxPct} %` },
  ];
  const strat = m.strategie;
  const retenue = m.scenarios.find((s) => s.recommande);
  return (
    <>
      <Bloc T={T} titre="Objectifs">
        <GrilleDonnees T={T} donnees={m.criteres.objectifs} colonnes={170} />
        <Volet T={T} titre="Compléter ou modifier le questionnaire du projet" resume={`${fiche.projet.pourcentage} % des questions renseignées`}>
          <ProjetSituationCard T={T} dossierId={d.id} dossierEnCoursId={fiche.dossierEnCours?.id ?? null} integre />
        </Volet>
      </Bloc>

      <Bloc T={T} titre="Capacité d'investissement" action={<button className="inv-btn inv-btn-sm" onClick={() => onClientOnglet?.("patrimoine")}>Voir le patrimoine du client</button>}>
        {pat.vide
          ? <EtatVide T={T} titre="Situation patrimoniale à compléter" texte="La capacité se calcule à partir des revenus, charges et crédits du client." action={<button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onClientOnglet?.("patrimoine")}>Compléter</button>} />
          : <GrilleDonnees T={T} donnees={capacite} colonnes={170} />}
        {!pat.vide && !cap && <div style={{ fontSize: 12, color: ORANGE, marginTop: 6 }}>⚠ Revenus non renseignés : capacité non évaluable.</div>}
        {a.avertissements.map((w) => <div key={w} style={{ fontSize: 11.5, color: ORANGE, marginTop: 4 }}>⚠ {w}</div>)}
        <Volet T={T} titre="Analyse détaillée, hypothèses de crédit et lecture de l'analyste">
          <AnalyseMission T={T} fiche={fiche} client={client} dossier={d} profil={profil} modifiable={modifiable} onOuvrirEtape={onOuvrirEtape} onOnglet={(o) => (o === "situation" || o === "documents" ? onClientOnglet?.(o === "situation" ? "patrimoine" : "documents") : setOnglet("projet"))} />
        </Volet>
      </Bloc>

      <Bloc T={T} titre="Critères de recherche"><GrilleDonnees T={T} donnees={m.criteres.criteres} colonnes={170} /></Bloc>

      <Bloc T={T} titre="Stratégie immobilière retenue">
        {!strat && m.scenarios.length === 0
          ? <EtatVide T={T} titre="Stratégie à définir" texte="Comparez des scénarios puis retenez la stratégie d'investissement." />
          : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {strat?.statut && <Pastille couleur={strat.statut === "validee" ? COULEURS.termine : COULEURS.cours}>{strat.statut === "validee" ? "Validée" : "Brouillon"}</Pastille>}
                {retenue && <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Scénario recommandé : {retenue.libelle || `#${retenue.ordre}`}</span>}
              </div>
              {strat?.message_cle && <div style={{ fontSize: 13, color: T.text, marginTop: 6 }}><b>Message clé :</b> {strat.message_cle}</div>}
              {strat?.recommandation && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 4, whiteSpace: "pre-wrap" }}>{strat.recommandation}</div>}
            </>
          )}
        <Volet T={T} titre="Scénarios, stratégie et recommandation" resume={m.scenarios.length ? `${m.scenarios.length} scénario${m.scenarios.length > 1 ? "s" : ""}` : "aucun scénario"}>
          <StrategieMission T={T} fiche={fiche} client={client} dossier={d} profil={profil} modifiable={modifiable} onOnglet={() => setOnglet("projet")} />
        </Volet>
      </Bloc>
    </>
  );
}
