// src/Renovation/blocsDuJour/BlocCommandesASaisir.jsx — bloc « Commandes à
// saisir » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 7).
//
// 1. Demandes de matériel des ouvriers en attente : MÊME lecture que la tuile
//    « Commandes à passer » du tableau de bord (compterBesoinsEnAttente) pour
//    le nombre, MÊME lecture que l'onglet « Demandes ouvriers » de la page
//    Commandes à passer (lireBesoinsEnAttente) pour le détail.
// 2. Articles à commander : MÊMES lectures que la page
//    (chargerDonneesCommandesAPasser), MÊME calcul (modeleCommandesAPasser +
//    statsCommandesAPasser), mêmes libellés que son bandeau.
// Aucun calcul réécrit (règle 9). Règle 10 : chargement, erreur, « aucune
// demande en attente », « aucun article à commander » explicites
// (etatBlocCommandesASaisirV1) — jamais un 0 à la place d'une donnée illisible.
import React, { useEffect, useMemo, useState } from "react";
import { FONT } from "../../constants";
import { modeleCommandesAPasser, statsCommandesAPasser, indexMateriaux, indexLots } from "../commandesAPasserV1.js";
import { compterBesoinsEnAttente, lireBesoinsEnAttente, chargerDonneesCommandesAPasser } from "../commandesAPasserDonnees.js";
import { etatBlocCommandesASaisirV1 } from "../commandesASaisirV1.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";
const msgErreur = (e) => (e ? e.message || String(e) : null);
const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

export default function BlocCommandesASaisir(props) {
  const { T, isMobile, contexte, accent } = props;
  const [compte, setCompte] = useState({ chargement: true, erreur: null, nombre: null });
  const [besoins, setBesoins] = useState({ chargement: true, erreur: null, lignes: null });
  const [donnees, setDonnees] = useState({ chargement: true, erreur: null, valeur: null });

  useEffect(() => {
    let annule = false;
    compterBesoinsEnAttente()
      .then(({ count, error }) => { if (!annule) setCompte(error ? { chargement: false, erreur: msgErreur(error), nombre: null } : { chargement: false, erreur: null, nombre: count ?? null }); })
      .catch((e) => { if (!annule) setCompte({ chargement: false, erreur: msgErreur(e) || "lecture impossible", nombre: null }); });
    lireBesoinsEnAttente()
      .then(({ data, error }) => { if (!annule) setBesoins(error ? { chargement: false, erreur: msgErreur(error), lignes: null } : { chargement: false, erreur: null, lignes: data || [] }); })
      .catch((e) => { if (!annule) setBesoins({ chargement: false, erreur: msgErreur(e) || "lecture impossible", lignes: null }); });
    chargerDonneesCommandesAPasser()
      .then((v) => { if (!annule) setDonnees({ chargement: false, erreur: v.erreur, valeur: v }); })
      .catch((e) => { if (!annule) setDonnees({ chargement: false, erreur: msgErreur(e) || "lecture impossible", valeur: null }); });
    return () => { annule = true; };
  }, []);

  const chantiers = contexte?.chantiers;
  const modele = useMemo(() => {
    const v = donnees.valeur;
    if (!v || donnees.erreur) return null;
    return modeleCommandesAPasser({
      phasages: v.phasages, chantiers: chantiers || [], matById: indexMateriaux(v.materiaux), lotById: indexLots(v.lots),
      lignesCmd: v.lignesCmd, lots: v.lots, achatsParCh: v.achatsParCh,
    });
  }, [donnees, chantiers]);
  const stats = useMemo(() => (modele ? statsCommandesAPasser(modele) : null), [modele]);

  const etat = etatBlocCommandesASaisirV1({
    compte, besoins,
    commandes: { chargement: donnees.chargement, erreur: donnees.erreur, modele, stats },
    chantiers: chantiers || [],
  });
  const { demandes, articles } = etat;

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  const sousTitre = { fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 };
  const message = (m, erreur) => m && (
    <div role={erreur ? "alert" : "status"} style={{ ...texte, color: erreur ? ROUGE : T.textSub }}>{m}</div>
  );
  const tuile = (cle, libelle, valeur, sous, couleur) => (
    <div key={cle} data-tuile={cle} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{libelle}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: couleur || T.text, marginTop: 2 }}>{valeur}</div>
      {sous && <div style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>{sous}</div>}
    </div>
  );
  const grille = { display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 };

  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={demandes.etat === "erreur" ? ROUGE : undefined}>
      <div data-etat-demandes={demandes.etat} style={{ marginBottom: 14 }}>
        <div style={sousTitre}>Demandes de matériel des ouvriers</div>
        {demandes.etat === "liste" && (
          <div style={{ ...grille, marginBottom: 8 }}>
            {tuile("articlesDemandes", "Articles demandés en attente", demandes.nombre, "tuile « Commandes à passer » du tableau de bord", accent)}
            {demandes.nbDemandes != null && tuile("demandesOuvriers", "Demandes ouvriers", demandes.nbDemandes, "envois des ouvriers, à valider sur la page")}
          </div>
        )}
        {message(demandes.message, demandes.etat === "erreur")}
        {demandes.apercu.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {demandes.apercu.map((d) => (
              <div key={d.id} data-demande style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: FONT.sm.size, minWidth: 0, flexWrap: isMobile ? "wrap" : "nowrap" }}>
                <span style={{ fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: isMobile ? "1 1 100%" : "0 1 auto" }}>
                  {d.urgent && <span style={{ color: ROUGE, fontWeight: 800, marginRight: 4 }}>Urgent ·</span>}
                  {d.quantite ? `${d.quantite} × ` : ""}{d.article}
                </span>
                <span style={{ color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.chantier}</span>
                <span style={{ color: T.textMuted, whiteSpace: "nowrap", marginLeft: isMobile ? 0 : "auto" }}>
                  {[d.demandeur, dateCourte(d.date)].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
            {demandes.reste > 0 && (
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>… et {demandes.reste} autre{demandes.reste > 1 ? "s" : ""} sur la page Commandes à passer.</div>
            )}
          </div>
        )}
      </div>
      <div data-etat-articles={articles.etat}>
        <div style={sousTitre}>Articles à commander (phasage)</div>
        {articles.tuiles.length > 0 && (
          <div style={{ ...grille, marginBottom: articles.message ? 8 : 0 }}>
            {articles.tuiles.map((t) => tuile(t.cle, t.libelle, t.valeur, null, t.cle === "nbACommander" ? accent : t.cle === "totalHt" ? "#22c55e" : null))}
          </div>
        )}
        {message(articles.message, articles.etat === "erreur")}
      </div>
    </CadreBloc>
  );
}
