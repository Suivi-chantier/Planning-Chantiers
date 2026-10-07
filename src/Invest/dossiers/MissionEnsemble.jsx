// src/Invest/dossiers/MissionEnsemble.jsx — « Vue d'ensemble » d'une mission Offre 2 : le cockpit.
// À FAIRE MAINTENANT · AVANCEMENT · PROJET · RECHERCHE / BIEN · ÉTAT DU DOSSIER · ACTIVITÉ RÉCENTE.
import React, { useState } from "react";
import { LigneAction } from "../crm/FicheEnsemble";
import { Bloc, Pastille, GrilleDonnees, EtatVide, COULEURS, eur, dateFr } from "./MissionUi";
import { MODES_TRAVAUX } from "./offre2Vue";

const ORANGE = "#d97706";

function Avancement({ T, m, naviguer }) {
  const j = Object.fromEntries(m.frise.jalons.map((x) => [x.cle, x]));
  const f = m.financement;
  const resume = {
    projet: m.criteres.objectifs.some((o) => o.valeur !== null) ? "Projet renseigné" : "Projet à compléter",
    recherche: m.synthR.etudies ? `${m.synthR.etudies} bien${m.synthR.etudies > 1 ? "s" : ""} étudié${m.synthR.etudies > 1 ? "s" : ""}` : "Aucun bien étudié",
    bien: m.synthR.retenu ? (m.synthR.retenu.bien.adresse || "Bien retenu") : "Aucun bien retenu",
    offre: m.offre && !m.offre.vide ? (m.offre.statut || "Offre en préparation") : "Aucune offre",
    acquisition: m.progression.courante ? m.progression.courante : m.progression.acte ? "Acte signé" : "Pas commencée",
    financement: m.finance.demarre ? m.finance.libelle : "À constituer",
    travaux: m.travaux.mode ? MODES_TRAVAUX[m.travaux.mode] : "À définir",
    transmission: m.transmission.date ? `Transmis le ${dateFr(m.transmission.date)}` : "Pas encore transmis",
  };
  return (
    <Bloc T={T} titre="Avancement">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
        {m.frise.jalons.map((x) => (
          <button key={x.cle} onClick={() => naviguer(x.onglet)} style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", padding: "6px 10px", borderRadius: 9,
            border: `${x.courant ? 2 : 1}px solid ${x.courant ? T.accent : T.border}`, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>{j[x.cle].libelle}</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: COULEURS[x.etat] }}>{x.etatLibelle}</span>
            </div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resume[x.cle]}</div>
          </button>
        ))}
      </div>
    </Bloc>
  );
}

export default function MissionEnsemble({ T, fiche, m, naviguer, ouvrirDefinir, onOuvrirEtape, onClientOnglet, recharger, modifiable }) {
  const [tout, setTout] = useState(false);
  const liste = tout ? m.actions.tout : m.actions.visibles;
  const capacite = m.capaciteEvaluee && m.analyse.capacite.calculable ? m.analyse.capacite.capaciteAchat : null;
  const obj = Object.fromEntries(m.criteres.objectifs.map((o) => [o.cle, o.valeur]));
  const strategie = m.strategie?.message_cle || m.strategie?.recommandation || null;
  const projetDonnees = [
    { cle: "objectif", libelle: "Objectif", valeur: obj.objectif }, { cle: "budget", libelle: "Budget", valeur: obj.budget, type: "eur" }, { cle: "apport", libelle: "Apport", valeur: obj.apport, type: "eur" },
    { cle: "capacite", libelle: "Capacité d'investissement", valeur: capacite, type: "eur" }, { cle: "zone", libelle: "Zone", valeur: obj.zones }, { cle: "typo", libelle: "Typologie", valeur: obj.typologies },
    { cle: "strategie", libelle: "Stratégie retenue", valeur: strategie },
  ];
  const s = m.synthR, b = s.retenu?.bien;
  const nbEcartes = s.ecartes;
  return (
    <>
      <Bloc T={T} titre={`À faire maintenant${m.actions.total ? ` · ${m.actions.total}` : ""}`}
        action={m.actions.total > m.actions.visibles.length && <button className="inv-btn inv-btn-sm" onClick={() => setTout((v) => !v)}>{tout ? "Réduire" : "Voir toutes les actions"}</button>}>
        {liste.length === 0
          ? <EtatVide T={T} titre="Rien à faire pour le moment" texte="Aucune action ouverte sur cette mission." action={modifiable && <button className="inv-btn inv-btn-sm" onClick={ouvrirDefinir}>Définir la prochaine action</button>} />
          : <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {liste.map((a) => <LigneAction key={a.id} T={T} a={a} onChange={recharger} onDefinir={ouvrirDefinir} onOuvrirEtape={() => onOuvrirEtape(m.etapeDefinir)} />)}
            </ol>}
      </Bloc>

      <Avancement T={T} m={{ ...m, financement: m.financement }} naviguer={naviguer} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 10, alignItems: "start" }}>
        <Bloc T={T} titre="Projet" action={<button className="inv-btn inv-btn-sm" onClick={() => naviguer("projet")}>Ouvrir le Projet</button>}>
          <GrilleDonnees T={T} donnees={projetDonnees} colonnes={130} />
        </Bloc>

        <Bloc T={T} titre="Recherche / bien" action={<button className="inv-btn inv-btn-sm" onClick={() => naviguer("biens")}>Recherche & biens</button>}>
          {s.etudies === 0
            ? <EtatVide T={T} titre="Aucun bien étudié" texte="La recherche n'a pas encore commencé." action={modifiable && <button className="inv-btn inv-btn-sm" onClick={() => naviguer("biens")}>Ajouter / rechercher un bien</button>} />
            : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: T.textSub }}>
                  <span><b style={{ color: T.text, fontSize: 15 }}>{s.etudies}</b> étudié{s.etudies > 1 ? "s" : ""}</span>
                  <span><b style={{ color: T.text, fontSize: 15 }}>{nbEcartes}</b> écarté{nbEcartes > 1 ? "s" : ""}</span>
                  <span><b style={{ color: T.text, fontSize: 15 }}>{s.aAnalyser}</b> à analyser</span>
                  <span><b style={{ color: T.text, fontSize: 15 }}>{s.visites}</b> visité{s.visites > 1 ? "s" : ""}</span>
                  <span><b style={{ color: T.text, fontSize: 15 }}>{s.retenus}</b> retenu{s.retenus > 1 ? "s" : ""}</span>
                </div>
                <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${T.rowBorder || T.border}` }}>
                  <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted }}>Bien retenu</div>
                  {b ? (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginTop: 3 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{b.adresse || "Adresse non renseignée"}</div>
                        <div style={{ fontSize: 12.5, color: b.prix === null ? ORANGE : T.textSub }}>{b.prix === null ? "Prix à compléter" : eur(b.prix)}</div>
                      </div>
                      <button className="inv-btn inv-btn-sm" onClick={() => naviguer("biens")}>Voir le bien</button>
                    </div>
                  ) : <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 3 }}>Aucun bien retenu pour le moment.</div>}
                </div>
              </>
            )}
        </Bloc>
      </div>

      <Bloc T={T} titre="État du dossier">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
          {[
            { k: "pat", l: "Patrimoine client", v: m.patrimoine.vide ? "À compléter" : `${m.patrimoine.pourcentage} %`, c: m.patrimoine.vide || m.patrimoine.pourcentage < 100 ? ORANGE : COULEURS.termine, b: "Voir le patrimoine", f: () => onClientOnglet?.("patrimoine") },
            { k: "doc", l: "Documents", v: `${m.docs.recus} / ${m.docs.total}`, c: m.docs.recus < m.docs.total ? ORANGE : COULEURS.termine, b: "Voir les documents", f: () => onClientOnglet?.("documents") },
            { k: "fin", l: "Financement", v: m.finance.demarre ? m.finance.libelle : "À constituer", c: m.finance.acceptee ? COULEURS.termine : m.finance.refus ? COULEURS.bloque : T.text, b: "Ouvrir", f: () => naviguer("financement") },
            { k: "acq", l: "Acquisition", v: m.progression.acte ? "Acte signé" : (m.progression.courante || "Pas commencée"), c: m.progression.acte ? COULEURS.termine : T.text, b: "Ouvrir", f: () => naviguer("offre") },
          ].map((t) => (
            <div key={t.k} style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${T.border}`, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textMuted }}>{t.l}</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: t.c }}>{t.v}</div>
              <button className="inv-btn inv-btn-sm" style={{ marginTop: 4, fontSize: 11 }} onClick={t.f}>{t.b}</button>
            </div>
          ))}
        </div>
        {m.anomalies.filter((x) => x.code !== "sans_action").length > 0 && (
          <ul style={{ margin: "9px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
            {m.anomalies.filter((x) => x.code !== "sans_action").map((x) => (
              <li key={x.code} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: x.niveau === "danger" ? COULEURS.bloque : "#b45309", fontWeight: 700 }}>
                <span>⚠ {x.libelle}</span>
                <button className="inv-btn inv-btn-sm" style={{ fontSize: 11 }} onClick={() => naviguer(x.cible)}>Voir</button>
              </li>
            ))}
          </ul>
        )}
      </Bloc>

      <Bloc T={T} titre="Activité récente">
        {m.activite.length === 0 ? <EtatVide T={T} titre="Aucune activité enregistrée" /> : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            {m.activite.map((a) => (
              <li key={a.id} style={{ display: "grid", gridTemplateColumns: "82px 80px minmax(0,1fr)", gap: 8, fontSize: 12.5, alignItems: "baseline" }}>
                <span style={{ color: T.textMuted, fontSize: 11.5 }}>{dateFr(a.quand) || "—"}</span>
                <Pastille couleur={COULEURS.cours}>{a.genre}</Pastille>
                <span style={{ color: T.text, overflowWrap: "anywhere" }}>{a.texte || "—"}{a.auteur && <span style={{ color: T.textMuted }}> · {a.auteur}</span>}</span>
              </li>
            ))}
          </ol>
        )}
      </Bloc>
    </>
  );
}
