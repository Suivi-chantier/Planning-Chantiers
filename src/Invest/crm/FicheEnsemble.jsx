// src/Invest/crm/FicheEnsemble.jsx — onglet « Vue d'ensemble » : le poste de pilotage du conseiller.
// De haut en bas : À FAIRE MAINTENANT · MISSION(S) EN COURS · ÉTAT DU DOSSIER · ACTIVITÉ RÉCENTE.
// Aucune donnée n'est créée ici : tout vient de ficheOffres.mjs (lecture des données existantes).
import React, { useState } from "react";
import { supabase } from "../../supabase";
import { Frise, ChampsMission } from "./FicheUi";
import { ListeActivite } from "./FicheActivite";
import { Section, Carte, Pastille, Discret, Vide, dateFr, aujourdhuiIso, ROUGE, ORANGE, BLEU, VERT, GRIS } from "./ui";

const COULEUR_PRIORITE = { Urgente: ROUGE, Haute: ORANGE, Normale: BLEU, Faible: GRIS };

/** Une action : titre, contexte, priorité, boutons selon sa source. */
export function LigneAction({ T, a, onOuvrirMission, onOuvrirEtude, onOnglet, onChange, onDefinir, onOuvrirEtape }) {
  const [reportOuvert, setReportOuvert] = useState(false);
  const [date, setDate] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");

  const ecrire = async (patch) => {
    setOccupe(true); setErreur("");
    const r = await supabase.from("invest_mission_actions").update(patch).eq("id", a.id).select("id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Modification refusée : droits insuffisants."); return; }
    setReportOuvert(false); onChange();
  };
  const bouton = (code) => {
    if (code === "terminer") return <button key={code} className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => ecrire({ status: "fait" })}>Terminer</button>;
    if (code === "reporter") return <button key={code} className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => setReportOuvert((v) => !v)}>Reporter</button>;
    if (code === "ouvrir") return <button key={code} className="inv-btn inv-btn-sm" onClick={() => onOuvrirMission(a.dossierId)}>Ouvrir</button>;
    if (code === "definir") return <button key={code} className="inv-btn inv-btn-blue inv-btn-sm" onClick={onDefinir}>Définir</button>;
    if (code === "ouvrir_etape") return <button key={code} className="inv-btn inv-btn-sm" onClick={onOuvrirEtape}>Ouvrir</button>;
    if (code === "ouvrir_etude") return <button key={code} className="inv-btn inv-btn-sm" onClick={onOuvrirEtude}>Ouvrir</button>;
    if (code === "demander") return <button key={code} className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOnglet("documents")}>Demander</button>;
    if (code === "completer") return <button key={code} className="inv-btn inv-btn-sm" onClick={() => onOnglet("patrimoine")}>Compléter</button>;
    return null;
  };
  return (
    <li style={{ padding: "8px 0", borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
        <Pastille couleur={COULEUR_PRIORITE[a.priorite]}>{a.priorite}</Pastille>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text, overflowWrap: "anywhere" }}>{a.titre}</div>
          <div style={{ fontSize: 11.5, color: a.retardJours ? ROUGE : T.textMuted, marginTop: 1, fontWeight: a.retardJours ? 800 : 500 }}>
            {[a.mission, a.echeance ? `Échéance ${dateFr(a.echeance)}${a.retardJours ? ` · ${a.retardJours} j de retard` : ""}` : "Sans échéance"].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{a.boutons.map(bouton)}</div>
      </div>
      {reportOuvert && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, justifyContent: "flex-end" }}>
          <label style={{ fontSize: 12, color: T.textSub }}>Nouvelle échéance <input type="date" className="inv-inp" value={date} min={aujourdhuiIso()} onChange={(e) => setDate(e.target.value)} /></label>
          <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={!date || occupe} onClick={() => ecrire({ due_date: date })}>Reporter</button>
        </div>
      )}
      {erreur && <Discret T={T} style={{ color: ROUGE, marginTop: 4 }}>{erreur}</Discret>}
    </li>
  );
}

function AFaireMaintenant({ T, actions, illisible, ...rest }) {
  const [tout, setTout] = useState(false);
  const liste = tout ? actions.tout : actions.visibles;
  return (
    <Section T={T} compact titre={`À faire maintenant${actions.total ? ` · ${actions.total}` : ""}`}
      action={actions.total > actions.visibles.length && <button className="inv-btn inv-btn-sm" onClick={() => setTout((v) => !v)}>{tout ? "Réduire" : "Voir toutes les actions"}</button>}>
      {illisible ? <Vide T={T} compact titre="Actions indisponibles" texte="les missions du client n'ont pas pu être lues" />
        : liste.length === 0 ? <Vide T={T} compact titre="Rien à faire pour le moment" texte="aucune action ouverte, aucune pièce à demander" />
        : <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>{liste.map((a) => <LigneAction key={a.id} T={T} a={a} {...rest} />)}</ol>}
    </Section>
  );
}

function CarteMission({ T, c, onOuvrirMission, onOuvrirEtude }) {
  const ouvrir = c.dossierId ? () => onOuvrirMission(c.dossierId) : onOuvrirEtude;
  return (
    <Carte T={T} accent={c.retardJours > 0 || c.blocages.length ? ROUGE : T.accent} style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: T.accent, textTransform: "uppercase", letterSpacing: 0.6 }}>{c.offreLibelle}</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text, marginTop: 1 }}>{c.intitule}{c.reference && <span style={{ fontWeight: 700, color: T.textMuted, fontSize: 12.5 }}> · {c.reference}</span>}</div>
        </div>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ouvrir}>{c.dossierId ? "Ouvrir la mission" : "Ouvrir l'étude"}</button>
      </div>
      <Frise T={T} frise={c.frise} />
      <div style={{ margin: "14px 0 12px" }}><ChampsMission T={T} champs={c.champs} /></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: T.textSub }}>
        <span>Prochaine action : <b style={{ color: c.prochaineAction ? T.text : ORANGE }}>{c.prochaineAction || "À compléter"}</b></span>
        {c.echeance ? <Pastille couleur={c.retardJours ? ROUGE : GRIS}>{`Échéance ${dateFr(c.echeance)}${c.retardJours ? ` · ${c.retardJours} j de retard` : ""}`}</Pastille> : null}
        {c.blocages.map((b) => <Pastille key={b.etape} couleur={ROUGE}>Bloquée : {b.etape}</Pastille>)}
      </div>
    </Carte>
  );
}

function Tuile({ T, titre, valeur, detail, couleur, onClick }) {
  return (
    <Carte T={T} accent={couleur} onClick={onClick} style={{ padding: "11px 14px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textMuted }}>{titre}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: valeur === "Non renseigné" || valeur === "—" ? T.textMuted : T.text, marginTop: 2 }}>{valeur}</div>
      {detail && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{detail}</div>}
    </Carte>
  );
}

export default function FicheEnsemble({ T, vue, activite, cartes, actions, etat, illisible, onOnglet, onOuvrirMission, onOuvrirEtude, onChange }) {
  const portail = etat.portail === "actif" ? ["Actif", VERT] : etat.portail === "non_active" ? ["Non activé", ORANGE] : ["Non consultable", GRIS];
  return (
    <>
      <AFaireMaintenant T={T} actions={actions} illisible={illisible} onOuvrirMission={onOuvrirMission} onOuvrirEtude={onOuvrirEtude} onOnglet={onOnglet} onChange={onChange} />

      <Section T={T} compact titre={illisible ? "Missions" : `${cartes.length > 1 ? "Missions" : "Mission"} en cours`}>
        {illisible ? <Vide T={T} compact titre="Missions illisibles" texte="avancement indisponible" />
          : cartes.length === 0
            ? <Vide T={T} compact titre="Aucune mission en cours" texte={vue.missionsTerminees.length ? `${vue.missionsTerminees.length} terminée(s)` : "Démarrez une mission pour suivre ce client étape par étape."}
                action={<button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOnglet("missions")}>＋ Nouvelle mission</button>} />
            : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{cartes.map((c) => <CarteMission key={c.cle} T={T} c={c} onOuvrirMission={onOuvrirMission} onOuvrirEtude={onOuvrirEtude} />)}</div>}
      </Section>

      <Section T={T} compact titre="État du dossier">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
          <Tuile T={T} titre="Patrimoine" valeur={etat.patrimoine == null ? "Non renseigné" : `${etat.patrimoine} %`} couleur={etat.patrimoine == null || etat.patrimoine < 100 ? ORANGE : VERT} onClick={() => onOnglet("patrimoine")} />
          <Tuile T={T} titre="Documents" valeur={`${etat.documents.recus} / ${etat.documents.total}`} detail="pièces obligatoires reçues" couleur={etat.documents.recus < etat.documents.total ? ORANGE : VERT} onClick={() => onOnglet("documents")} />
          <Tuile T={T} titre="Portail client" valeur={portail[0]} couleur={portail[1]} />
          <Tuile T={T} titre="Missions" valeur={`${etat.missionsActives} active${etat.missionsActives > 1 ? "s" : ""}`} couleur={BLEU} onClick={() => onOnglet("missions")} />
        </div>
        {etat.anomalies.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {etat.anomalies.map((x) => <li key={x.code}><Pastille couleur={x.code === "retard" || x.code === "bloquee" ? ROUGE : ORANGE}>{x.libelle}</Pastille></li>)}
          </ul>
        )}
      </Section>

      <Section T={T} compact titre="Activité récente" action={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("activite")}>Voir toute l'activité</button>}>
        {activite.length === 0 ? <Vide T={T} compact titre="Aucune activité enregistrée" /> : <ListeActivite T={T} items={activite.slice(0, 5)} />}
      </Section>
    </>
  );
}
