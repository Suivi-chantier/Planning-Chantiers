// src/Renovation/blocsDuJour/BlocAdministratifFournisseurs.jsx — bloc
// « Administratif fournisseurs » du tableau de bord du jour (projet
// docs/projets/organisation-par-jour.md, tâche 9).
//
// 1. Factures à rapprocher : MÊME lecture que la page Rapprochement factures
//    (lireFacturesHistorique), MÊME statut « À rapprocher »
//    (historiqueRapprochementV1) : nombre et 5 plus anciennes.
// 2. Encours fournisseurs à payer : MÊMES lectures que la page Encours
//    fournisseurs (chargerDonneesEncoursFournisseurs), MÊME calcul
//    (encoursFournisseursPageV1), mêmes libellés que ses cartes. Le mois en
//    cours est celui de l'horloge de l'appareil, comme sur la page (pas la date
//    simulée), pour que les deux affichent toujours le même chiffre.
// Aucun calcul réécrit (règle 9). Règle 10 : chargement, erreur par partie,
// « aucune facture à rapprocher », « aucun encours à payer » explicites
// (etatBlocAdministratifFournisseursV1) — jamais 0 € à la place d'une donnée
// illisible.
import React, { useEffect, useState } from "react";
import { FONT } from "../../constants";
import { lireFacturesHistorique } from "../rapprochementDonnees";
import { chargerDonneesEncoursFournisseurs } from "../encoursFournisseursDonnees";
import { cleMoisCourant } from "../encoursFournisseursPageV1.js";
import { etatBlocAdministratifFournisseursV1 } from "../administratifFournisseursV1.js";
import { CadreBloc } from "./CadreBloc";

const ROUGE = "#e15a5a";
const ORANGE = "#f5a623";
const VERT = "#22c55e";
const msgErreur = (e) => (e ? e.message || String(e) : null);

export default function BlocAdministratifFournisseurs(props) {
  const { T, isMobile, accent } = props;
  const [rappro, setRappro] = useState({ chargement: true, erreur: null, factures: null });
  const [encours, setEncours] = useState({ chargement: true, erreur: null, donnees: null });
  const [moisCourant] = useState(() => cleMoisCourant(new Date()));

  useEffect(() => {
    let annule = false;
    lireFacturesHistorique()
      .then(({ data, error }) => { if (!annule) setRappro(error ? { chargement: false, erreur: msgErreur(error), factures: null } : { chargement: false, erreur: null, factures: data || [] }); })
      .catch((e) => { if (!annule) setRappro({ chargement: false, erreur: msgErreur(e) || "lecture impossible", factures: null }); });
    chargerDonneesEncoursFournisseurs()
      .then((d) => { if (!annule) setEncours(d.erreur ? { chargement: false, erreur: d.erreur, donnees: null } : { chargement: false, erreur: null, donnees: d }); })
      .catch((e) => { if (!annule) setEncours({ chargement: false, erreur: msgErreur(e) || "lecture impossible", donnees: null }); });
    return () => { annule = true; };
  }, []);

  const etat = etatBlocAdministratifFournisseursV1({ rapprochement: rappro, encours, moisCourant });
  const { rapprochement: r, encours: e } = etat;

  const texte = { fontSize: FONT.sm.size, lineHeight: 1.55 };
  const sousTitre = { fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 };
  const message = (m, erreur) => m && (
    <div role={erreur ? "alert" : "status"} style={{ ...texte, color: erreur ? ROUGE : T.textSub }}>{m}</div>
  );
  const ligne = { display: "flex", alignItems: "baseline", gap: 8, fontSize: FONT.sm.size, minWidth: 0, flexWrap: isMobile ? "wrap" : "nowrap" };
  const nom = { fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: isMobile ? "1 1 100%" : "0 1 auto" };
  const montant = (couleur) => ({ fontWeight: 800, color: couleur || T.text, whiteSpace: "nowrap", marginLeft: isMobile ? 0 : "auto", fontFamily: "'DM Mono', monospace" });

  return (
    <CadreBloc {...props} metrique={etat.metrique} metriqueTon={e.etat === "erreur" ? ROUGE : undefined}>
      <div data-etat-rapprochement={r.etat} style={{ marginBottom: 16 }}>
        <div style={sousTitre}>Factures à rapprocher{r.nombre > 0 ? ` · ${r.nombre}` : ""}</div>
        {r.etat === "liste" && (
          <div style={{ ...texte, color: T.textSub, marginBottom: 6 }}>
            <span data-nombre-a-rapprocher style={{ fontWeight: 800, color: accent }}>{r.nombre}</span> facture{r.nombre > 1 ? "s" : ""} au statut « À rapprocher » — les plus anciennes :
          </div>
        )}
        {message(r.message, r.etat === "erreur")}
        {r.apercu.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {r.apercu.map((f) => (
              <div key={f.id} data-facture-a-rapprocher style={ligne}>
                <span style={nom}>{f.fournisseur}</span>
                <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>{[f.numero ? `N° ${f.numero}` : null, f.date].filter(Boolean).join(" · ")}</span>
                {f.montant && <span style={montant(ORANGE)}>{f.montant}</span>}
              </div>
            ))}
            {r.reste > 0 && (
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>… et {r.reste} autre{r.reste > 1 ? "s" : ""} sur la page Rapprochement factures.</div>
            )}
          </div>
        )}
      </div>

      <div data-etat-encours={e.etat}>
        <div style={sousTitre}>Encours fournisseurs à payer</div>
        {e.tuiles.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
              {e.tuiles.map((t) => (
                <div key={t.cle} data-tuile={t.cle} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.libelle}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: t.cle === "aPayer" ? ORANGE : VERT, marginTop: 2 }}>{t.valeur}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: T.textSub, marginBottom: 8 }}>{e.explication}.</div>
          </>
        )}
        {message(e.message, e.etat === "erreur")}
        {e.fournisseurs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>À payer en {e.libelleMois} :</div>
            {e.fournisseurs.map((f) => (
              <div key={f.nom} data-fournisseur-a-payer style={ligne}>
                <span style={nom}>{f.nom}</span>
                <span style={montant(ORANGE)}>{f.aPayer}</span>
              </div>
            ))}
            {e.reste > 0 && (
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>… et {e.reste} autre{e.reste > 1 ? "s" : ""} sur la page Encours fournisseurs.</div>
            )}
          </div>
        )}
        {e.suivants.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>Échéances des mois suivants :</div>
            {e.suivants.map((m) => (
              <div key={m.mois} data-mois-suivant style={ligne}>
                <span style={{ ...nom, fontWeight: 600, textTransform: "capitalize" }}>{m.libelle}</span>
                <span style={montant(ORANGE)}>À payer {m.aPayer}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </CadreBloc>
  );
}
