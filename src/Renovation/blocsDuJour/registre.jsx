// src/Renovation/blocsDuJour/registre.jsx — Registre des blocs du tableau de
// bord du jour (projet docs/projets/organisation-par-jour.md, tâche 5).
//
// Une entrée par bloc du catalogue (CATALOGUE_BLOCS) : identifiant → { icone,
// accent, Composant }. Tant qu'un bloc n'est pas livré, son Composant est
// BlocAVenir (cadre + message « à venir », règle 10).
//
// Brancher un bloc (tâches 6 à 12) :
//   1. créer src/Renovation/blocsDuJour/Bloc<Nom>.jsx, qui lit ses données via
//      un module pur existant (ou extrait en .mjs) et rend
//      <CadreBloc {...props} metrique={…}>contenu</CadreBloc> ;
//   2. remplacer ici `Composant: BlocAVenir` par ce composant pour son
//      identifiant. Rien d'autre à toucher dans Dashboard.jsx.
// Props reçues par chaque Composant : idBloc, titre, icone, accent, T,
// isMobile, liens (pages autorisées), onOuvrirPage, profil, contexte (données
// déjà chargées par le tableau de bord : chantiers, cells, commandes,
// notesData, weekId, dateIso), onOuvrirChantier (ouvre la fiche chantier
// comme la page Opérations ; null si Opérations ou Chantiers non autorisée).
import React from "react";
import { ChartBar, Package, HardHat, Receipt, Route, CalendarRange, Layers } from "lucide-react";
import { CATALOGUE_BLOCS, LIBELLES_BLOCS, liensDuBloc } from "../organisationJour.js";
import { BlocAVenir } from "./CadreBloc";
import BlocBilanSemainePassee from "./BlocBilanSemainePassee";
import BlocCommandesASaisir from "./BlocCommandesASaisir";
import BlocChantiersAVenir from "./BlocChantiersAVenir";
import BlocAdministratifFournisseurs from "./BlocAdministratifFournisseurs";

export const REGISTRE_BLOCS = Object.freeze({
  bilan_semaine_passee:       { icone: ChartBar,      accent: "#5b8af5", Composant: BlocBilanSemainePassee },
  commandes_a_saisir:         { icone: Package,       accent: "#f5a623", Composant: BlocCommandesASaisir },
  chantiers_a_venir:          { icone: HardHat,       accent: "#22c55e", Composant: BlocChantiersAVenir },
  administratif_fournisseurs: { icone: Receipt,       accent: "#a855f7", Composant: BlocAdministratifFournisseurs },
  tournee_chantiers:          { icone: Route,         accent: "#ef4444", Composant: BlocAVenir },
  planning_semaine_suivante:  { icone: CalendarRange, accent: "#38bdf8", Composant: BlocAVenir },
  materiaux_a_commander:      { icone: Layers,        accent: "#f59e0b", Composant: BlocAVenir },
});

/**
 * Blocs du jour, dans l'ordre de la configuration, au-dessus des widgets
 * actuels (règle 8). Rien du tout si la liste est vide.
 * @param {string[]} blocs     identifiants (blocsDuJour / bandeauDuJour)
 * @param {(id:string)=>boolean} pageAutorisee
 */
export function BlocsDuJour({ blocs, T, isMobile, pageAutorisee, onOuvrirPage, onOuvrirChantier = null, profil, contexte }) {
  const connus = (blocs || []).filter((id) => CATALOGUE_BLOCS.includes(id) && REGISTRE_BLOCS[id]);
  if (connus.length === 0) return null;
  const liste = connus.map((id) => {
    const { icone, accent, Composant } = REGISTRE_BLOCS[id];
    return (
      <Composant key={id} idBloc={id} titre={LIBELLES_BLOCS[id]} icone={icone} accent={accent} T={T}
        isMobile={isMobile} liens={liensDuBloc(id, pageAutorisee)} onOuvrirPage={onOuvrirPage} onOuvrirChantier={onOuvrirChantier}
        profil={profil} contexte={contexte}/>
    );
  });
  return (
    <div aria-label="Blocs du jour" style={isMobile
      ? { display: "flex", flexDirection: "column", gap: 12 }
      : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20, marginBottom: 20 }}>
      {liste}
    </div>
  );
}
