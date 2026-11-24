// src/Renovation/blocsDuJour/BlocBilanSemainePassee.jsx — bloc « Bilan de la
// semaine passée » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 6).
//
// Chiffres clés de la semaine précédant la date du jour (contexte.dateIso,
// date simulée comprise), TELS QUE LES AFFICHE la page Bilan de semaine :
// mêmes données (chargerDonneesBilanPeriode), même calcul
// (calculBilanPeriodeBaseV1), mêmes tuiles et explications
// (tuilesBandeauBilanV1). Aucun calcul réécrit (règle 9). Pas de choix
// manuel de chantiers : la présélection par défaut de la page.
//
// Règle 10 : « Chargement… », erreur explicite, « aucune donnée de bilan pour
// la semaine 47 », « relevé pas encore disponible » — jamais un 0 à la place
// d'une donnée absente.
import React, { useEffect, useMemo, useState } from "react";
import { FONT } from "../../constants";
import { useReglagesMarges } from "../reglagesMarges";
import { periodeSemaineV3 } from "../bilanPeriodeV3.js";
import { chantiersEnCoursBilanV1, calculBilanPeriodeBaseV1, semainePasseeV1, etatBlocBilanSemaineV1 } from "../bilanSemaineChiffresV1.js";
import { chargerDonneesBilanPeriode } from "../bilanSemaineDonnees.js";
import { CadreBloc } from "./CadreBloc";

const couleurSigne = (v, T) => (v == null ? T.textMuted : v < -0.5 ? "#e15a5a" : v > 0.5 ? "#22c55e" : T.text);
const couleurTuile = (t, T) => (t.ton === "alerte" ? "#e15a5a" : t.ton === "signe" ? couleurSigne(t.signe, T) : T.text);

export default function BlocBilanSemainePassee(props) {
  const { T, isMobile, contexte } = props;
  const weekId = semainePasseeV1(contexte?.dateIso);
  const periode = useMemo(() => (weekId ? periodeSemaineV3(weekId) : null), [weekId]);
  const reglages = useReglagesMarges();
  const [donnees, setDonnees] = useState({ cle: null, valeur: null, erreur: null });

  useEffect(() => {
    if (!periode) return undefined;
    let annule = false;
    setDonnees({ cle: null, valeur: null, erreur: null });
    chargerDonneesBilanPeriode(periode, { estAnnule: () => annule })
      .then((v) => { if (!annule && v) setDonnees({ cle: periode.cle, valeur: v, erreur: v.erreur || null }); })
      .catch((e) => { if (!annule) setDonnees({ cle: periode.cle, valeur: null, erreur: e?.message || "lecture impossible" }); });
    return () => { annule = true; };
  }, [periode?.cle]); // eslint-disable-line react-hooks/exhaustive-deps

  const chantiers = contexte?.chantiers;
  const enCours = useMemo(() => chantiersEnCoursBilanV1(chantiers), [chantiers]);
  const pret = donnees.cle === periode?.cle && !!donnees.valeur && reglages.charge;
  const base = useMemo(() => (pret && !donnees.erreur
    ? calculBilanPeriodeBaseV1({ periode, donnees: donnees.valeur, enCours, choix: {}, reglages })
    : null), [pret, donnees, periode, enCours, reglages]);
  const etat = etatBlocBilanSemaineV1({ weekId, chargement: !donnees.erreur && !base, erreur: donnees.erreur, base });

  const tonMetrique = etat.etat === "erreur" ? "#e15a5a" : undefined;
  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={tonMetrique}>
      <div data-etat-bloc={etat.etat}>
        {etat.libelleSemaine && (
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 10 }}>{etat.libelleSemaine}</div>
        )}
        {etat.message && (
          <div role={etat.etat === "erreur" ? "alert" : "status"}
            style={{ ...texte, color: etat.etat === "erreur" ? "#e15a5a" : T.textSub, marginBottom: etat.tuiles.length ? 10 : 0 }}>
            {etat.message}
          </div>
        )}
        {etat.tuiles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            {etat.tuiles.map((t) => (
              <div key={t.cle} data-tuile={t.cle} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.libelle}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: couleurTuile(t, T), marginTop: 2 }}>{t.valeur}</div>
                {t.sous.map((x, i) => <div key={i} style={{ fontSize: 10.5, color: T.textSub, marginTop: 2 }}>{x}</div>)}
              </div>
            ))}
          </div>
        )}
        {etat.note && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 10 }}>{etat.note}</div>}
      </div>
    </CadreBloc>
  );
}
