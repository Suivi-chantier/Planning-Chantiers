// src/Invest/crm/CrmCartes.jsx — « À traiter » et « Clients » pour le SUIVI QUOTIDIEN (simplifié le 06/10/2026).
//
// Principe : par défaut, MES missions ; trois groupes (urgent, aujourd'hui, à faire) ; une ligne par mission avec seulement
// qui, quoi, quand. Le détail est dans la fiche. Les actions rares (inviter un client au portail, filtres fins) ne sont plus ici.
// Calculs : crmV2Vue.mjs et crmQuotidien.mjs ; aucune écriture.
import React, { useMemo, useState } from "react";
import { filtrerPortefeuille, portefeuille, alertesMission, echeanceCourte } from "./crmV2Vue";
import { repartirQuotidien, clientsDuPerimetre } from "./crmQuotidien.mjs";
import { Discret, Vide, ROUGE, ORANGE, GRIS, VERT, BLEU } from "./ui";

const VIOLET = "#7c3aed";
const TON = { rouge: ROUGE, orange: ORANGE, violet: VIOLET, neutre: GRIS };
const COULEUR_GROUPE = { urgent: ROUGE, aujourdhui: ORANGE, a_faire: BLEU, attente: VIOLET };

const COL_MISSION = "minmax(0,1.5fr) minmax(0,1.7fr) minmax(0,.9fr)";
const COL_CLIENT = "minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.6fr)";

function Echeance({ T, iso, aujourdhui }) {
  const e = echeanceCourte(iso, aujourdhui);
  if (!iso) return <span style={{ color: T.textMuted }}>sans date</span>;
  return <span style={{ color: e.ton === "neutre" ? T.textSub : TON[e.ton], fontWeight: 800 }}>{e.texte}</span>;
}

function LigneMission({ T, m, couleur, aujourdhui, onMission, onClient }) {
  const principale = alertesMission(m, aujourdhui)[0];
  return (
    <div className="crm-lig crm-clic" role="button" tabIndex={0} style={{ gridTemplateColumns: COL_MISSION, borderLeft: `3px solid ${couleur}`, padding: "10px 12px" }}
      onClick={() => onMission(m.clientId, m.dossierId)} onKeyDown={(e) => { if (e.key === "Enter") onMission(m.clientId, m.dossierId); }}>
      <div className="crm-cel">
        <button onClick={(e) => { e.stopPropagation(); onClient(m.clientId); }} title="Ouvrir la fiche client" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 14.5, fontWeight: 900, color: T.text }}>{m.client}</button>
        <span style={{ color: T.textMuted, fontSize: 12 }}> · {m.offre.court || m.offre.libelle}{m.etape ? ` · ${m.etape}` : ""}</span>
      </div>
      <div className="crm-cel" style={{ fontWeight: 700, color: T.text }} title={m.action}>
        {m.action || <span style={{ color: ORANGE }}>Aucune action prévue</span>}
        {m.balleType === "client" && <span style={{ color: VIOLET, fontWeight: 700 }}> · chez le client</span>}
        {principale?.code === "bloquee" && <span style={{ color: ROUGE, fontWeight: 800 }}> · bloquée</span>}
      </div>
      <div className="crm-cel" style={{ textAlign: "right" }}><Echeance T={T} iso={m.echeance} aujourdhui={aujourdhui} /></div>
    </div>
  );
}

export function ATraiterListe({ T, missions, nbEquipe, nbMoi, perimetre, setPerimetre, erreur, aujourdhui, onMission, onClient }) {
  const [voirAttente, setVoirAttente] = useState(false);
  const groupes = useMemo(() => repartirQuotidien(missions || []), [missions]);
  if (!missions) return <Vide T={T} titre="Avancement des missions indisponible" texte={`Les missions n'ont pas pu être lues, la liste à traiter ne peut donc pas être établie${erreur ? ` (${erreur})` : ""}. Réessayez avec « Actualiser ».`} />;
  const bascule = (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      <button className={`inv-btn inv-btn-sm ${perimetre === "moi" ? "inv-btn-gold" : ""}`} onClick={() => setPerimetre("moi")}>Mes missions ({nbMoi})</button>
      <button className={`inv-btn inv-btn-sm ${perimetre === "equipe" ? "inv-btn-gold" : ""}`} onClick={() => setPerimetre("equipe")}>Toute l'équipe ({nbEquipe})</button>
    </div>
  );
  if (missions.length === 0) return <>{bascule}<Vide T={T} titre={perimetre === "moi" ? "Aucune mission ne vous est confiée" : "Aucune mission en cours"} texte={perimetre === "moi" ? "Passez à « Toute l'équipe » pour voir les autres missions." : "Les missions démarrées depuis une fiche client apparaîtront ici."} /></>;
  const aSuivre = groupes.filter((g) => g.cle !== "attente");
  const total = aSuivre.reduce((s, g) => s + g.missions.length, 0);
  const attente = groupes.find((g) => g.cle === "attente");
  const ligne = (m, couleur) => <LigneMission key={m.dossierId} T={T} m={m} couleur={couleur} aujourdhui={aujourdhui} onMission={onMission} onClient={onClient} />;
  return (
    <>
      {bascule}
      {total === 0
        ? <div style={{ fontSize: 14, margin: "4px 0 14px", color: VERT, fontWeight: 800 }}>Rien d'urgent : tout suit son cours.</div>
        : aSuivre.filter((g) => g.missions.length).map((g) => (
          <section key={g.cle} style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 900, color: COULEUR_GROUPE[g.cle] }}>{g.titre} <span style={{ color: T.textMuted }}>{g.missions.length}</span> <span style={{ color: T.textMuted, fontWeight: 600, fontSize: 12 }}>{g.aide}</span></h3>
            <div>{g.missions.map((m) => ligne(m, COULEUR_GROUPE[g.cle]))}</div>
          </section>
        ))}
      {attente.missions.length > 0 && (
        <section>
          <button className="inv-btn inv-btn-sm" onClick={() => setVoirAttente((v) => !v)}>{voirAttente ? "Masquer" : "Afficher"} les {attente.missions.length} mission{attente.missions.length > 1 ? "s" : ""} en attente du client</button>
          {voirAttente && <div style={{ marginTop: 8 }}>{attente.missions.map((m) => ligne(m, VIOLET))}</div>}
        </section>
      )}
    </>
  );
}

export function ClientsListe({ T, donnees, missions, idsMissionsMoi, estMoi, perimetre, setPerimetre, erreur, aujourdhui, onClient }) {
  const [q, setQ] = useState("");
  const [avecMission, setAvecMission] = useState(false);
  const lignes = useMemo(() => portefeuille({ clients: donnees.clients, dossiers: donnees.dossiers, missions, notes: donnees.notes }), [donnees, missions]);
  const miens = useMemo(() => clientsDuPerimetre(lignes, idsMissionsMoi, estMoi), [lignes, idsMissionsMoi, estMoi]);
  const base = perimetre === "moi" ? miens : lignes;
  const visibles = filtrerPortefeuille(base, { q, mission: avecMission ? "avec" : "" });
  if (erreur) return <Vide T={T} titre="Clients illisibles" texte={erreur} />;
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px", alignItems: "center" }}>
        <button className={`inv-btn inv-btn-sm ${perimetre === "moi" ? "inv-btn-gold" : ""}`} onClick={() => setPerimetre("moi")}>Mes clients ({miens.length})</button>
        <button className={`inv-btn inv-btn-sm ${perimetre === "equipe" ? "inv-btn-gold" : ""}`} onClick={() => setPerimetre("equipe")}>Tous les clients ({lignes.length})</button>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 200, flex: "1 1 200px", maxWidth: 320 }} placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <label style={{ fontSize: 13, color: T.textSub, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={avecMission} onChange={(e) => setAvecMission(e.target.checked)} />Avec mission en cours</label>
      </div>
      {missions === null && <Discret T={T} style={{ marginBottom: 10, color: ORANGE }}>Avancement des missions indisponible : missions et prochaine action ne peuvent pas être affichées.</Discret>}
      {visibles.length === 0 ? <Vide T={T} titre="Aucun client" texte="Aucun client ne correspond." /> : (
        <div>
          {visibles.map((l) => {
            const m0 = l.missions[0];
            return (
              <div key={l.id} className="crm-lig crm-clic" role="button" tabIndex={0} onClick={() => onClient(l.id)} onKeyDown={(e) => { if (e.key === "Enter") onClient(l.id); }}
                style={{ gridTemplateColumns: COL_CLIENT, borderLeft: `3px solid ${l.urgent ? ROUGE : "transparent"}`, padding: "10px 12px" }}>
                <div className="crm-cel" style={{ fontWeight: 900, color: T.text, fontSize: 14.5 }}>{l.nom}</div>
                <div className="crm-cel" style={{ color: T.textSub }}>{m0 ? `${m0.reference} · ${m0.etape || m0.jalon || m0.offre}${l.missions.length > 1 ? ` (+${l.missions.length - 1})` : ""}` : <span style={{ color: T.textMuted }}>Aucune mission</span>}</div>
                <div className="crm-cel" style={{ color: T.text }}>{l.prochaineAction ? <>{l.prochaineAction}{l.echeance && <> · <Echeance T={T} iso={l.echeance} aujourdhui={aujourdhui} /></>}</> : <span style={{ color: T.textMuted }}>—</span>}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
