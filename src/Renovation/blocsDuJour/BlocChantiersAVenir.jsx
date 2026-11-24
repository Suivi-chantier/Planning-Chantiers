// src/Renovation/blocsDuJour/BlocChantiersAVenir.jsx — bloc « Chantiers à
// venir » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 8).
//
// Chantiers au statut « Planifié » (statut de la fiche chantier : signés, pas
// encore démarrés), avec l'avancement de leur phase « Préparation » du cycle
// de vie et les étapes qui manquent, évaluées comme sur la fiche chantier
// (chantiersAVenirV1.mjs, qui ne fait qu'assembler cycleVie.mjs et
// factureAEmettre.mjs ; lectures : chantiersAVenirDonnees.js). Aucun calcul
// réécrit (règle 9).
//
// Un clic sur un chantier ouvre sa fiche par le même mécanisme que la page
// Opérations (onOuvrirChantier, fourni par App seulement si les pages
// Opérations et Chantiers sont autorisées au rôle ; sinon pas de lien).
// Règle 10 : chargement, erreur, « aucun chantier à venir », « Préparation
// non renseignée » explicites.
import React, { useEffect, useMemo, useState } from "react";
import { FONT } from "../../constants";
import { chantiersAVenirV1, etatBlocChantiersAVenirV1 } from "../chantiersAVenirV1.js";
import { chargerDonneesChantiersAVenir } from "../chantiersAVenirDonnees.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";
const VERT = "#22c55e";

export default function BlocChantiersAVenir(props) {
  const { T, contexte, onOuvrirChantier = null } = props;
  const chantiers = contexte?.chantiers;
  const cle = (chantiers || []).map((c) => `${c?.id}:${c?.statut || ""}:${c?.nom || ""}`).join("|");
  const [donnees, setDonnees] = useState({ cle: null, valeur: null, erreur: null });

  useEffect(() => {
    if (!Array.isArray(chantiers)) return undefined;
    let annule = false;
    setDonnees({ cle: null, valeur: null, erreur: null });
    chargerDonneesChantiersAVenir(chantiers)
      .then((v) => { if (!annule) setDonnees({ cle, valeur: v, erreur: v.erreur || null }); })
      .catch((e) => { if (!annule) setDonnees({ cle, valeur: null, erreur: e?.message || "lecture impossible" }); });
    return () => { annule = true; };
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  const pret = donnees.cle === cle && (!!donnees.valeur || !!donnees.erreur);
  const liste = useMemo(() => (pret && !donnees.erreur && donnees.valeur
    ? chantiersAVenirV1({ chantiers, ...donnees.valeur })
    : null), [pret, donnees, chantiers]);
  const etat = etatBlocChantiersAVenirV1({ chargement: !pret, erreur: donnees.erreur, liste });

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={etat.etat === "erreur" ? ROUGE : undefined}>
      <div data-etat-bloc={etat.etat}>
        {etat.message && (
          <div role={etat.etat === "erreur" ? "alert" : "status"} style={{ ...texte, color: etat.etat === "erreur" ? ROUGE : T.textSub }}>
            {etat.message}
          </div>
        )}
        {etat.chantiers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {etat.chantiers.map((c) => {
              const ouvrir = onOuvrirChantier ? () => onOuvrirChantier(c.id) : null;
              return (
                <div key={c.id} data-chantier-a-venir={c.id}
                  role={ouvrir ? "button" : undefined} tabIndex={ouvrir ? 0 : undefined}
                  onClick={ouvrir || undefined}
                  onKeyDown={ouvrir ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); } } : undefined}
                  title={ouvrir ? `Ouvrir la fiche du chantier ${c.nom}` : undefined}
                  className={ouvrir ? "pops-row-clic" : undefined}
                  style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0, cursor: ouvrir ? "pointer" : "default" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.couleur || "#888", flexShrink: 0 }}/>
                    <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                      textDecoration: ouvrir ? "underline" : "none", textDecorationColor: T.border }}>{c.nom}</span>
                    <span data-avancement style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, marginLeft: "auto", whiteSpace: "nowrap",
                      color: c.erreur ? ROUGE : c.complete ? VERT : c.renseignee ? T.text : T.textMuted }}>{c.avancement}</span>
                  </div>
                  {c.manquantes.length > 0 && (
                    <div data-manquantes style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, lineHeight: 1.5 }}>
                      Manque : {c.manquantes.join(" · ")}{c.reste > 0 ? ` et ${c.reste} autre${c.reste > 1 ? "s" : ""}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CadreBloc>
  );
}
