// src/Renovation/blocsDuJour/BlocMateriauxACommander.jsx — bloc « Matériaux à
// commander » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 12, décision de Loris du
// 24/11/2026).
//
// Articles de la page « Commandes à passer » dont la date de besoin tombe la
// semaine suivant la date du jour (contexte.dateIso, date simulée comprise),
// TELS QUE LES RANGE l'onglet « Semaine prochaine » de la fenêtre
// « Commandes de la semaine » de la page :
//   - mêmes lectures que la page (chargerDonneesCommandesAPasser) ;
//   - même liste (modeleCommandesAPasser + lignesACommander) ;
//   - même rangement par semaine (commandesParSemaineV1, déplacé de la page).
// Aucun calcul réécrit (règle 9). Règle 10 : chargement, erreur, « aucun
// matériau à commander pour la semaine 49 » explicites
// (etatBlocMateriauxACommanderV1).
import React, { useEffect, useMemo, useState } from "react";
import { FONT } from "../../constants";
import { modeleCommandesAPasser, lignesACommander, indexMateriaux, indexLots } from "../commandesAPasserV1.js";
import { chargerDonneesCommandesAPasser } from "../commandesAPasserDonnees.js";
import { etatBlocMateriauxACommanderV1, dateBesoinFR } from "../commandesParSemaineV1.js";
import { etNAutres } from "../tourneeChantiersV1.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";
const msgErreur = (e) => (e ? e.message || String(e) : null);

export default function BlocMateriauxACommander(props) {
  const { T, isMobile, contexte, accent } = props;
  const [donnees, setDonnees] = useState({ chargement: true, erreur: null, valeur: null });

  useEffect(() => {
    let annule = false;
    chargerDonneesCommandesAPasser()
      .then((v) => { if (!annule) setDonnees({ chargement: false, erreur: v.erreur, valeur: v }); })
      .catch((e) => { if (!annule) setDonnees({ chargement: false, erreur: msgErreur(e) || "lecture impossible", valeur: null }); });
    return () => { annule = true; };
  }, []);

  const chantiers = contexte?.chantiers;
  const lignes = useMemo(() => {
    const v = donnees.valeur;
    if (!v || donnees.erreur) return null;
    return lignesACommander(modeleCommandesAPasser({
      phasages: v.phasages, chantiers: chantiers || [], matById: indexMateriaux(v.materiaux), lotById: indexLots(v.lots),
      lignesCmd: v.lignesCmd, lots: v.lots, achatsParCh: v.achatsParCh,
    }));
  }, [donnees, chantiers]);

  const etat = useMemo(() => etatBlocMateriauxACommanderV1({
    dateIso: contexte?.dateIso, chargement: donnees.chargement, erreur: donnees.erreur, lignes,
  }), [contexte?.dateIso, donnees, lignes]);

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  const petit = { fontSize: FONT.xs.size + 1, color: T.textMuted };
  const sousTitre = { fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 };
  const ligne = { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, fontSize: FONT.sm.size, padding: "4px 0",
    borderBottom: `1px solid ${T.sectionDivider || T.border}`, flexWrap: isMobile ? "wrap" : "nowrap" };
  const coupe = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={etat.etat === "erreur" ? ROUGE : undefined}>
      <div data-etat-materiaux={etat.etat}>
        {etat.libelleSemaine && <div style={{ ...petit, marginBottom: 8 }}>{etat.libelleSemaine} · date de besoin = date prévue la plus proche des tâches de l'ouvrage</div>}
        {etat.message && (
          <div role={etat.etat === "erreur" ? "alert" : "status"} style={{ ...texte, color: etat.etat === "erreur" ? ROUGE : T.textSub }}>{etat.message}</div>
        )}
        {etat.etat === "liste" && (
          <>
            <div data-total style={{ fontSize: 15, fontWeight: 800, color: accent, marginBottom: 10 }}>{etat.total}</div>
            <div style={sousTitre}>Par chantier</div>
            <div>
              {etat.chantiers.map((c) => (
                <div key={c.id || c.nom} data-chantier={c.nom} style={ligne}>
                  <span style={{ ...coupe, fontWeight: 700, color: T.text, flex: "1 1 auto" }}>{c.nom}</span>
                  <span style={{ color: T.textSub, whiteSpace: "nowrap" }}>{c.nb} article{c.nb > 1 ? "s" : ""}</span>
                  <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>besoin dès le {dateBesoinFR(c.dateBesoin)}</span>
                </div>
              ))}
            </div>
            <div style={{ ...sousTitre, marginTop: 12 }}>Les plus urgents</div>
            <div>
              {etat.articles.map((a, i) => (
                <div key={i} data-article style={ligne}>
                  <span style={{ ...coupe, color: T.text, flex: isMobile ? "1 1 100%" : "1 1 auto" }}>
                    {a.libelle}{a.quantite ? <span style={{ color: T.textMuted }}> · {a.quantite}</span> : null}
                  </span>
                  <span style={{ ...coupe, color: T.textSub }}>{a.chantier}</span>
                  <span style={{ color: T.textMuted, whiteSpace: "nowrap", marginLeft: isMobile ? 0 : "auto" }}>date de besoin {dateBesoinFR(a.dateBesoin)}</span>
                </div>
              ))}
              {etat.autres > 0 && (
                <div style={{ ...petit, marginTop: 4 }}>{etNAutres(etat.autres)} dans l'onglet « Semaine prochaine » de la page Commandes à passer (bouton « Commandes de la semaine »).</div>
              )}
            </div>
          </>
        )}
      </div>
    </CadreBloc>
  );
}
