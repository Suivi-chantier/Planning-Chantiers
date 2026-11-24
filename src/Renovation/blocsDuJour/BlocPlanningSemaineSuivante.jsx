// src/Renovation/blocsDuJour/BlocPlanningSemaineSuivante.jsx — bloc
// « Planning de la semaine suivante » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 11).
//
// Heures prévues la semaine qui suit la date du jour (contexte.dateIso, date
// simulée comprise), par chantier et par personne, TELLES QUE LES PRODUIT la
// carte « La semaine qui vient » de la page Bilan de semaine : même lancement
// du moteur de planning (chargerSemaineQuiVient, lecture seule, horizon
// 42 jours), même découpe (bilanSemaineProchaineV1), mêmes noms
// (nomsSemaineQuiVientV1), même fenêtre (fenetreSemaineSuivanteV1). Aucun
// calcul réécrit (règle 9).
//
// Règle 10 : « calcul en cours », erreur du moteur dite comme la page, « aucune
// heure prévue la semaine 49 », et la ligne fixe « Montant prévisionnel :
// fonctionnalité à venir » (le calcul des euros est un projet à part).
import React, { useEffect, useMemo, useState } from "react";
import { FONT } from "../../constants";
import { chargerSemaineQuiVient } from "../semaineQuiVientDonnees.js";
import { fenetreSemaineSuivanteV1, nomsSemaineQuiVientV1, etatBlocPlanningSemaineSuivanteV1 } from "../planningSemaineSuivanteV1.js";
import { etNAutres } from "../tourneeChantiersV1.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";

export default function BlocPlanningSemaineSuivante(props) {
  const { T, contexte } = props;
  const fenetre = useMemo(() => fenetreSemaineSuivanteV1(contexte?.dateIso), [contexte?.dateIso]);
  const cle = fenetre ? fenetre.debut : null;
  const [donnees, setDonnees] = useState({ cle: null, valeur: null, erreur: null });

  useEffect(() => {
    if (!fenetre) return undefined;
    let annule = false;
    setDonnees({ cle: null, valeur: null, erreur: null });
    chargerSemaineQuiVient(fenetre)
      .then((v) => { if (!annule) setDonnees({ cle, valeur: v, erreur: null }); })
      .catch((e) => { if (!annule) setDonnees({ cle, valeur: null, erreur: e?.message || "erreur du moteur de planning" }); });
    return () => { annule = true; };
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  const chantiers = contexte?.chantiers;
  const pret = donnees.cle === cle;
  const etat = useMemo(() => {
    const { nomChantier, nomRessource } = nomsSemaineQuiVientV1({ chantiers, referentiel: donnees.valeur?.referentiel || null });
    return etatBlocPlanningSemaineSuivanteV1({
      fenetre, chargement: !pret, erreur: pret ? donnees.erreur : null,
      decoupe: pret ? donnees.valeur?.decoupe || null : null, nomChantier, nomRessource,
    });
  }, [fenetre, pret, donnees, chantiers]);

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  const petit = { fontSize: FONT.xs.size + 1, color: T.textMuted };
  const sousTitre = { fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 };
  const ligne = { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, fontSize: FONT.sm.size, padding: "4px 0",
    borderBottom: `1px solid ${T.sectionDivider || T.border}` };
  const nomStyle = { fontWeight: 700, color: T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const heuresStyle = { marginLeft: "auto", fontWeight: 800, color: T.text, whiteSpace: "nowrap" };

  const liste = (titre, lignes, autres, attr, detail) => (
    <div style={{ marginTop: 12 }}>
      <div style={sousTitre}>{titre}</div>
      {lignes.map((l) => (
        <div key={l.id} {...{ [attr]: l.id }} style={ligne}>
          <span style={nomStyle}>{l.nom}</span>
          <span style={{ ...petit, whiteSpace: "nowrap" }}>{detail(l)}</span>
          <span style={heuresStyle}>{l.texte}</span>
        </div>
      ))}
      {autres > 0 && <div style={{ ...petit, marginTop: 4 }}>… {etNAutres(autres)} sur la page Bilan de semaine.</div>}
    </div>
  );

  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={etat.etat === "erreur" ? ROUGE : undefined}>
      <div data-etat-bloc={etat.etat}>
        {etat.libelleSemaine && <div style={{ ...petit, marginBottom: 6 }}>{etat.libelleSemaine} · proposition du moteur de planning</div>}
        {etat.message && (
          <div role={etat.etat === "erreur" ? "alert" : "status"} style={{ ...texte, color: etat.etat === "erreur" ? ROUGE : T.textSub }}>
            {etat.message}
          </div>
        )}
        {etat.total && <div data-total-heures style={{ ...texte, color: T.text, fontWeight: 700 }}>{etat.total}</div>}
        {etat.chantiers.length > 0 && liste("Par chantier", etat.chantiers, etat.autresChantiers, "data-chantier-prevu",
          (l) => `${l.jours} jour${l.jours > 1 ? "s" : ""}`)}
        {etat.personnes.length > 0 && liste("Par personne", etat.personnes, etat.autresPersonnes, "data-personne-prevue",
          (l) => `${l.nbChantiers} chantier${l.nbChantiers > 1 ? "s" : ""}`)}
        {etat.auDelaHorizon.length > 0 && (
          <div data-au-dela-horizon style={{ ...petit, marginTop: 8 }}>
            Au-delà de l'horizon du planning : {etat.auDelaHorizon.slice(0, 6).join(", ")}{etat.auDelaHorizon.length > 6 ? ` ${etNAutres(etat.auDelaHorizon.length - 6)}` : ""}.
          </div>
        )}
        <div data-montant-previsionnel style={{ ...texte, color: T.textSub, marginTop: 12, fontStyle: "italic" }}>{etat.montant}</div>
        {etat.explication && etat.etat !== "erreur" && <div style={{ ...petit, marginTop: 6 }}>{etat.explication}</div>}
      </div>
    </CadreBloc>
  );
}
