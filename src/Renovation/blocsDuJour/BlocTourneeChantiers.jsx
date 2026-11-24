// src/Renovation/blocsDuJour/BlocTourneeChantiers.jsx — bloc « Tournée des
// chantiers » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 10).
//
// 1. Niveau d'alerte des chantiers : MÊMES lectures que la page Alertes
//    (semainesAlertesCourantes, chargerRelevesAlertesSemaines, réglages des
//    marges), MÊME calcul (calculerAlertesEcranV1), mêmes libellés et couleurs
//    (PRESENTATION_NIVEAUX_ALERTE_V1), même référentiel de chantiers (liste
//    complète, comme App la passe à la page).
// 2. Retours du terrain de la semaine : MÊMES lectures que la page Retours du
//    terrain (chargerRetoursTerrainSemaine), MÊME calcul (retoursTerrain).
//    Ces deux semaines sont celles de l'horloge de l'appareil, comme sur les
//    pages, pour afficher toujours la même chose qu'elles.
// 3. Tâches de phasage en retard à la date du jour du tableau de bord
//    (contexte.dateIso) : règle existante etatReelTacheV1().en_retard.
// Tout le calcul est dans tourneeChantiersV1.mjs (aucun calcul réécrit,
// règle 9). Règle 10 : chargement, erreur PAR PARTIE, vides explicites,
// « relevé pas encore disponible ».
// Un clic sur une ligne ouvre la fiche du chantier par le même mécanisme que la
// page Opérations (onOuvrirChantier, null si non autorisé : pas de lien).
import React, { useEffect, useMemo, useState } from "react";
import { FONT, RADIUS } from "../../constants";
import { useReglagesMarges } from "../reglagesMarges";
import { semainesAlertesCourantes, chargerRelevesAlertesSemaines } from "../alertesChantiersDonnees";
import { chargerRetoursTerrainSemaine, semaineCouranteRetoursTerrain } from "../retoursTerrainDonnees";
import { lirePhasagesChantiers } from "../tourneeChantiersDonnees";
import { lundiSemaineISOv1, ajouterJoursV1 } from "../bilanSemaineProchaineV1.mjs";
import {
  etatBlocTourneeChantiersV1, chantiersEnCoursTourneeV1, chantiersDuNiveau, etNAutres,
  NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO,
} from "../tourneeChantiersV1.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";
const ORANGE = "#f5a623";
const msgErreur = (e) => (e ? e.message || String(e) : null);
const COULEUR_RETOUR = { bloque: ROUGE, pas_commence: "#b27416", depassement: "#c0392b" };

function Ligne({ T, chantierId, onOuvrirChantier, titre, children, attr }) {
  const ouvrir = onOuvrirChantier && chantierId ? () => onOuvrirChantier(chantierId) : null;
  return (
    <div {...attr}
      role={ouvrir ? "button" : undefined} tabIndex={ouvrir ? 0 : undefined}
      onClick={ouvrir || undefined}
      onKeyDown={ouvrir ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); } } : undefined}
      title={ouvrir ? titre : undefined}
      className={ouvrir ? "pops-row-clic" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, fontSize: FONT.sm.size,
        padding: "5px 0", borderBottom: `1px solid ${T.sectionDivider || T.border}`, cursor: ouvrir ? "pointer" : "default" }}>
      {children}
    </div>
  );
}

export default function BlocTourneeChantiers(props) {
  const { T, contexte, onOuvrirChantier = null } = props;
  const dateIso = contexte?.dateIso;
  const chantiers = contexte?.chantiers;
  // Référentiel de la page Alertes : liste complète des chantiers non archivés.
  const referentiel = contexte?.referentielChantiers ?? chantiers ?? null;
  const reglagesMarges = useReglagesMarges();

  const [semaines] = useState(() => semainesAlertesCourantes());
  const [semaineRetours] = useState(() => semaineCouranteRetoursTerrain());
  const lundi = lundiSemaineISOv1(semaineRetours);
  const dimanche = lundi ? ajouterJoursV1(lundi, 6) : null;

  const [releves, setReleves] = useState({ chargement: true, erreur: null, lignes: null });
  const [retours, setRetours] = useState({ chargement: true, erreur: null, rapports: null, phasages: [] });
  const [phasages, setPhasages] = useState({ cle: null, chargement: true, erreur: null, phasages: null });

  useEffect(() => {
    let annule = false;
    chargerRelevesAlertesSemaines(semaines)
      .then(({ data, error }) => { if (!annule) setReleves(error ? { chargement: false, erreur: msgErreur(error), lignes: null } : { chargement: false, erreur: null, lignes: data || [] }); })
      .catch((e) => { if (!annule) setReleves({ chargement: false, erreur: msgErreur(e) || "lecture impossible", lignes: null }); });
    if (lundi) {
      chargerRetoursTerrainSemaine(lundi)
        .then((r) => { if (!annule) setRetours(r.statut === "erreur" ? { chargement: false, erreur: r.erreur || "lecture impossible", rapports: null, phasages: [] } : { chargement: false, erreur: null, rapports: r.rapports, phasages: r.phasages }); })
        .catch((e) => { if (!annule) setRetours({ chargement: false, erreur: msgErreur(e) || "lecture impossible", rapports: null, phasages: [] }); });
    } else {
      setRetours({ chargement: false, erreur: "semaine illisible", rapports: null, phasages: [] });
    }
    return () => { annule = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enCours = useMemo(() => chantiersEnCoursTourneeV1(chantiers), [chantiers]);
  const cle = enCours.map((c) => c.id).join("|");
  useEffect(() => {
    if (!Array.isArray(chantiers)) return undefined;
    let annule = false;
    setPhasages({ cle: null, chargement: true, erreur: null, phasages: null });
    lirePhasagesChantiers(enCours.map((c) => c.id))
      .then(({ data, error }) => { if (!annule) setPhasages(error ? { cle, chargement: false, erreur: error, phasages: null } : { cle, chargement: false, erreur: null, phasages: data }); })
      .catch((e) => { if (!annule) setPhasages({ cle, chargement: false, erreur: msgErreur(e) || "lecture impossible", phasages: null }); });
    return () => { annule = true; };
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  const etat = useMemo(() => etatBlocTourneeChantiersV1({
    alertes: { ...releves, semaines, seuilsMarges: reglagesMarges.seuilsMarges, referentielChantiers: referentiel },
    retours: { ...retours, debut: lundi, fin: dimanche },
    phasage: { ...phasages, chargement: phasages.chargement || phasages.cle !== cle, chantiers: enCours, dateIso },
  }), [releves, retours, phasages, semaines, reglagesMarges, referentiel, lundi, dimanche, enCours, cle, dateIso]);
  const { alertes: a, retours: r, phasage: p } = etat;

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  const sousTitre = { fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 };
  const petit = { fontSize: FONT.xs.size + 1, color: T.textMuted };
  const message = (m, erreur) => m && (
    <div role={erreur ? "alert" : "status"} style={{ ...texte, color: erreur ? ROUGE : T.textSub }}>{m}</div>
  );
  const badge = (couleur, fond, bord) => ({
    fontSize: FONT.xs.size, fontWeight: 800, color: couleur, background: fond || "transparent",
    border: `1px solid ${bord || couleur}`, padding: "1px 8px", borderRadius: RADIUS.pill, whiteSpace: "nowrap",
  });
  const nomStyle = { fontWeight: 700, color: T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" };
  const enAlerte = [...chantiersDuNiveau(a, NIVEAU_CRITIQUE), ...chantiersDuNiveau(a, NIVEAU_A_SURVEILLER)];
  const infos = chantiersDuNiveau(a, NIVEAU_INFO);

  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={a.etat === "erreur" ? ROUGE : a.nbEnAlerte > 0 ? ROUGE : undefined}>
      {/* 1. Niveau d'alerte */}
      <div data-etat-alertes={a.etat} style={{ marginBottom: 16 }}>
        <div style={sousTitre}>Niveau d'alerte des chantiers{a.totaux ? ` · ${a.totaux.critique} critique${a.totaux.critique > 1 ? "s" : ""} · ${a.totaux.aSurveiller} à surveiller` : ""}</div>
        {a.etat !== "liste" && message(a.message, a.etat === "erreur")}
        {enAlerte.map((c) => (
          <Ligne key={c.id} T={T} chantierId={c.id} onOuvrirChantier={onOuvrirChantier} titre={`Ouvrir la fiche du chantier ${c.nom}`}
            attr={{ "data-chantier-alerte": c.id, "data-niveau": c.niveau }}>
            <span style={{ width: 9, height: 9, borderRadius: 9, background: c.couleur, flexShrink: 0 }}/>
            <span style={nomStyle}>{c.nom}</span>
            <span style={{ ...badge(c.couleur, c.fond, c.bord), marginLeft: "auto" }}>{c.libelle}</span>
          </Ligne>
        ))}
        {a.etat === "liste" && enAlerte.length === 0 && message("Aucun chantier critique ni à surveiller cette semaine.")}
        {infos.length > 0 && (
          <div data-alertes-info style={{ ...petit, marginTop: 6 }}>
            + {infos.length} chantier{infos.length > 1 ? "s" : ""} au niveau « Information » : bruit de fond, replié{infos.length > 1 ? "s" : ""} sur la page Alertes.
          </div>
        )}
        {a.sansReleve.length > 0 && (
          <div data-sans-releve style={{ ...petit, marginTop: 6 }}>
            Relevé pas encore disponible (niveau d'alerte non calculé) : {a.sansReleve.slice(0, 5).map((c) => c.nom).join(", ")}{a.sansReleve.length > 5 ? ` ${etNAutres(a.sansReleve.length - 5)}` : ""}.
          </div>
        )}
      </div>

      {/* 2. Retours du terrain */}
      <div data-etat-retours={r.etat} style={{ marginBottom: 16 }}>
        <div style={sousTitre}>Retours du terrain · semaine {String(semaineRetours).split("-W")[1] || "?"}</div>
        {message(r.message, r.etat === "erreur")}
        {r.nbRapports > 0 && (
          <div data-comptes-retours style={{ ...texte, color: T.textSub, marginBottom: 4 }}>
            <strong style={{ color: r.nbBloque ? ROUGE : T.text }}>{r.nbBloque}</strong> bloqué{r.nbBloque > 1 ? "s" : ""} ·{" "}
            <strong style={{ color: T.text }}>{r.nbPasCommence}</strong> pas commencé{r.nbPasCommence > 1 ? "s" : ""} ·{" "}
            <strong style={{ color: T.text }}>{r.nbDepassements}</strong> dépassement{r.nbDepassements > 1 ? "s" : ""}
          </div>
        )}
        {r.lignes.map((l) => (
          <Ligne key={l.cle} T={T} chantierId={l.chantierId} onOuvrirChantier={onOuvrirChantier} titre={`Ouvrir la fiche du chantier ${l.chantier}`}
            attr={{ "data-retour": l.type }}>
            <span style={badge(COULEUR_RETOUR[l.type] || ORANGE)}>{l.etiquette}</span>
            <span style={nomStyle}>{l.chantier}</span>
            <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{l.tache}</span>
            <span style={{ ...petit, marginLeft: "auto", whiteSpace: "nowrap" }}>{l.date.slice(8, 10)}/{l.date.slice(5, 7)}</span>
          </Ligne>
        ))}
        {r.reste > 0 && <div style={{ ...petit, marginTop: 4 }}>… {etNAutres(r.reste)} sur la page Retours du terrain.</div>}
        {r.messagesVides.map((m) => <div key={m} style={{ ...petit, marginTop: 4 }}>{m}</div>)}
        {r.phasagesIllisibles && <div style={{ ...petit, marginTop: 4 }}>Phasages illisibles : ouvrages non affichés.</div>}
      </div>

      {/* 3. Tâches de phasage en retard */}
      <div data-etat-phasage={p.etat}>
        <div style={sousTitre}>Tâches de phasage en retard{p.nombre > 0 ? ` · ${p.nombre} sur ${p.nbChantiers} chantier${p.nbChantiers > 1 ? "s" : ""}` : ""}</div>
        {message(p.message, p.etat === "erreur")}
        {p.lignes.map((t) => (
          <Ligne key={t.cle} T={T} chantierId={t.chantierId} onOuvrirChantier={onOuvrirChantier} titre={`Ouvrir la fiche du chantier ${t.chantier}`}
            attr={{ "data-tache-retard": t.cle }}>
            <span style={nomStyle}>{t.chantier}</span>
            <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.tache}</span>
            <span style={{ ...petit, marginLeft: "auto", whiteSpace: "nowrap" }}>prévue le {t.date}</span>
            <span style={badge(ROUGE)}>{t.joursRetard} j de retard</span>
          </Ligne>
        ))}
        {p.reste > 0 && <div style={{ ...petit, marginTop: 4 }}>… {etNAutres(p.reste)} sur la page Phasage.</div>}
        {p.parChantier.length > 1 && (
          <div data-retards-par-chantier style={{ ...petit, marginTop: 4 }}>
            Par chantier : {p.parChantier.slice(0, 5).map((c) => `${c.chantier} (${c.nombre})`).join(" · ")}{p.parChantier.length > 5 ? ` ${etNAutres(p.parChantier.length - 5)}` : ""}.
          </div>
        )}
        {p.etat === "liste" && <div style={{ ...petit, marginTop: 4 }}>En retard : date prévue passée et avancement sous 100 % (règle de la page Phasage).</div>}
      </div>
    </CadreBloc>
  );
}
