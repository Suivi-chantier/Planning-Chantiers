// src/Invest/crm/FicheMissions.jsx — onglet « Missions » de la fiche client.
// MISSIONS EN COURS puis TERMINÉES. Offre 2 (accompagnement à l'investissement, un projet par mission) et
// Offre 3 (structuration patrimoniale) peuvent figurer ensemble : l'Offre 3 s'appuie sur le dossier de structuration.
// « Nouvelle mission » est l'unique point d'entrée : plus de bouton « Sujet de structuration ».
import React, { useState } from "react";
import { supabase } from "../../supabase";
import { DemarrerMission } from "../dossiers/DossierInvestCard";
import { STATUTS_PRECONISATION, preconisationsSuivies, majStatutPreconisation } from "./ficheOffres";
import { Section, Carte, Pastille, Discret, Vide, dateFr, ROUGE, ORANGE, BLEU, GRIS } from "./ui";

function LigneMission({ T, c, onOuvrir }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, padding: "9px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>
          {c.intitule}{c.reference && <span style={{ fontWeight: 700, color: T.textMuted, fontSize: 12 }}> · {c.reference}</span>}
          <span style={{ fontWeight: 800, color: T.accent, fontSize: 12 }}> · {c.offreLibelle}</span>
        </div>
        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
          Conseiller : {c.conseiller || <span style={{ color: ORANGE }}>non défini</span>} · Étape : <b>{c.etape || "—"}</b> · Prochaine action : {c.prochaineAction || <span style={{ color: ORANGE }}>à compléter</span>}
          {c.echeance && <> · <span style={{ color: c.retardJours ? ROUGE : T.textSub, fontWeight: c.retardJours ? 800 : 500 }}>Échéance {dateFr(c.echeance)}{c.retardJours ? ` (${c.retardJours} j de retard)` : ""}</span></>}
        </div>
      </div>
      <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={onOuvrir}>{c.dossierId ? "Ouvrir" : "Ouvrir l'étude"}</button>
    </div>
  );
}

/** Préconisations de l'Offre 3 : actions suivies (À valider · À faire · En cours · Réalisé · Abandonné). */
function Preconisations({ T, structuration, onChange }) {
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const donnees = structuration?.donnees;
  const recos = preconisationsSuivies(donnees);
  if (recos.length === 0) return null;
  const changer = async (index, etat) => {
    setOccupe(true); setErreur("");
    try {
      const suivantes = majStatutPreconisation(donnees, index, etat);
      const r = await supabase.from("invest_structuration_patrimoniale").update({ donnees: suivantes, analyse_data: suivantes.analyse, updated_at: new Date().toISOString() }).eq("id", structuration.id).select("id");
      if (r.error) throw new Error(r.error.message);
      if (!r.data?.length) throw new Error("Modification refusée : droits insuffisants.");
      onChange();
    } catch (e) { setErreur(e.message); }
    setOccupe(false);
  };
  return (
    <Section T={T} compact titre={`Préconisations de l'Offre 3 · ${recos.length}`}>
      <Discret T={T} style={{ marginBottom: 6 }}>Chaque préconisation est une action suivie : celles « À valider », « À faire » ou « En cours » remontent dans « À faire maintenant ».</Discret>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {recos.map((r) => (
          <li key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, padding: "7px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{r.titre} <Pastille couleur={r.priorite === "Haute" || r.priorite === "Urgente" ? ORANGE : GRIS}>{r.priorite}</Pastille></div>
              <div style={{ fontSize: 12, color: T.textMuted }}>{[r.axe, r.action].filter(Boolean).join(" · ")}</div>
            </div>
            <select className="inv-sel" disabled={occupe} value={r.etat} aria-label={`Statut : ${r.titre}`} onChange={(e) => changer(r.index, e.target.value)}>
              {Object.entries(STATUTS_PRECONISATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {erreur && <Discret T={T} style={{ color: ROUGE, marginTop: 6 }}>{erreur}</Discret>}
    </Section>
  );
}

/** Formulaire « Nouvelle mission » : on choisit l'offre. */
function NouvelleMission({ T, vue, donnees, profil, structuration, onCree, onEtude, onAnnuler }) {
  const [offre, setOffre] = useState("offre2");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const monId = donnees.utilisateurs.find((u) => String(u.email || "").trim().toLowerCase() === String(profil?.email || "").trim().toLowerCase())?.id || "";
  const ouvrirEtude = async () => {
    setOccupe(true); setErreur("");
    if (donnees.client.sujet_structuration !== true) {
      const r = await supabase.from("invest_clients").update({ sujet_structuration: true }).eq("id", donnees.client.id).select("id");
      if (r.error || !r.data?.length) { setOccupe(false); setErreur(r.error?.message || "Modification refusée : droits insuffisants."); return; }
    }
    setOccupe(false); onEtude();
  };
  return (
    <Carte T={T} style={{ marginBottom: 12 }}>
      <div role="radiogroup" aria-label="Offre" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {[["offre2", "Offre 2 — Accompagnement à l'investissement", "un projet immobilier"], ["offre3", "Offre 3 — Structuration patrimoniale", "étude du patrimoine"]].map(([k, l, d]) => (
          <button key={k} role="radio" aria-checked={offre === k} onClick={() => setOffre(k)} className="inv-btn inv-btn-sm"
            style={offre === k ? { background: T.accentBg, color: T.accent, border: `1.5px solid ${T.accent}` } : undefined}>{l} <span style={{ fontWeight: 500 }}>· {d}</span></button>
        ))}
        <button className="inv-btn inv-btn-sm" onClick={onAnnuler} style={{ marginLeft: "auto" }}>Annuler</button>
      </div>
      {offre === "offre2" && (vue.nouvelleMission.possible
        ? <DemarrerMission T={T} client={donnees.client} utilisateurs={donnees.utilisateurs} monId={monId} onAnnuler={onAnnuler} onCree={onCree} />
        : <div role="status" style={{ fontSize: 13, color: T.text, background: `${ORANGE}12`, borderRadius: 10, padding: "9px 12px" }}>{vue.nouvelleMission.raison}</div>)}
      {offre === "offre3" && (
        <div>
          <Discret T={T} style={{ marginBottom: 8 }}>
            {structuration ? "Ce client a déjà une étude patrimoniale : elle s'ouvre ci-dessous." : "L'étude patrimoniale regroupe le recueil de la situation, le diagnostic, les scénarios et les préconisations. Aucune donnée n'est créée avant votre clic dans l'étude."}
          </Discret>
          <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={ouvrirEtude}>{structuration ? "Ouvrir l'étude patrimoniale" : "Démarrer l'étude patrimoniale"}</button>
          {erreur && <Discret T={T} style={{ color: ROUGE, marginTop: 6 }}>{erreur}</Discret>}
        </div>
      )}
    </Carte>
  );
}

export default function FicheMissions({ T, vue, donnees, cartes, structuration, profil, illisible, ouvrirNouvelle, onOuvrirMission, onOuvrirEtude, onCree, onChange }) {
  const [nouvelle, setNouvelle] = useState(!!ouvrirNouvelle);
  if (illisible) return <Vide T={T} compact titre="Missions illisibles" texte="les missions du client n'ont pas pu être lues" />;
  const terminees = vue.missionsTerminees;
  return (
    <>
      <Section T={T} compact titre={`Missions en cours · ${cartes.length}`} action={!nouvelle && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setNouvelle(true)}>＋ Nouvelle mission</button>}>
        {nouvelle && <NouvelleMission T={T} vue={vue} donnees={donnees} profil={profil} structuration={structuration} onAnnuler={() => setNouvelle(false)}
          onCree={(id) => { setNouvelle(false); onCree(id); }} onEtude={() => { setNouvelle(false); onOuvrirEtude(); }} />}
        {cartes.length === 0 ? <Vide T={T} compact titre="Aucune mission en cours" />
          : cartes.map((c) => <LigneMission key={c.cle} T={T} c={c} onOuvrir={() => (c.dossierId ? onOuvrirMission(c.dossierId) : onOuvrirEtude())} />)}
        {!nouvelle && !vue.nouvelleMission.possible && cartes.some((c) => c.offre === "offre2") && (
          <Discret T={T} style={{ marginTop: 8 }}>Une seule mission d'accompagnement peut être en cours par client pour le moment : un second projet s'ouvrira après la clôture de la mission en cours.</Discret>
        )}
      </Section>
      <Preconisations T={T} structuration={structuration} onChange={onChange} />
      <Section T={T} compact titre={`Missions terminées · ${terminees.length}`}>
        {terminees.length === 0 ? <Vide T={T} compact titre="Aucune mission terminée" />
          : terminees.map((m) => (
            <div key={m.dossierId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, padding: "8px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{m.libelle || m.offre.libelle} <span style={{ fontWeight: 700, color: T.textMuted, fontSize: 12 }}>· {m.reference}</span> <span style={{ fontWeight: 800, color: T.accent, fontSize: 12 }}>· {m.offre.court ? `${m.offre.court} — ${m.offre.libelle}` : m.offre.libelle}</span></div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>{[m.statutLibelle, m.conseiller ? `Conseiller : ${m.conseiller}` : null, m.ouverture ? `ouverte le ${dateFr(m.ouverture)}` : null, m.cloture ? `close le ${dateFr(m.cloture)}` : null, m.motif ? `Motif : ${m.motif}` : null].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="inv-btn inv-btn-sm" onClick={() => onOuvrirMission(m.dossierId)}>Consulter</button>
            </div>
          ))}
      </Section>
    </>
  );
}
