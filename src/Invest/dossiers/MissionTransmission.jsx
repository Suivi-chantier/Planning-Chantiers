// src/Invest/dossiers/MissionTransmission.jsx — onglet « Transmission » : clôture de l'Offre 2.
// La mission se termine à la transmission du dossier pour mise en location / gestion. Pas de suivi des locataires,
// des loyers ni des quittances : c'est un autre périmètre. Les informations de transmission vivent dans
// invest_dossiers.suivi_offre2 (colonne optionnelle) ; « Terminer la mission » clôt le dossier (statut « clos »).
import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { checklistTransmission, syntheseOperation, statutFinancement } from "./offre2Vue";
import { enregistrerSuivi } from "./MissionTravaux";
import { Bloc, Pastille, Donnee, EtatVide, GrilleDonnees, COULEURS, dateFr, aujourdhuiIso } from "./MissionUi";

const Champ = ({ T, libelle, children }) => (<label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700, minWidth: 0 }}>{libelle}{children}</label>);

export default function MissionTransmission({ T, fiche, extra, m, modifiable, recharger, onMessage, onClientOnglet }) {
  const d = fiche.dossier, tr = m.transmission;
  const [f, setF] = useState({ date: "", destinataire: "", notes: "", documents: "" });
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => { setF({ date: tr.date || "", destinataire: tr.destinataire, notes: tr.notes, documents: tr.documents.join("\n") }); }, [d.id, d.updated_at]);
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const clos = fiche.entete.clos;
  const liste = checklistTransmission({ acquisition: m.acquisition, finance: statutFinancement({ financement: extra.financement, banques: extra.banques }), travaux: m.travaux, transmission: tr, documents: m.docs, clos });
  const bien = m.synthR.retenu?.bien || null;
  const apport = m.criteres.objectifs.find((o) => o.cle === "apport")?.valeur ?? null;
  const op = syntheseOperation({ acquisition: m.acquisition, bien, banques: extra.banques, apport, transmission: tr });

  const enregistrer = async () => {
    setOccupe(true); setErreur("");
    try {
      if (f.date && f.date > aujourdhuiIso()) throw new Error("La date de transmission ne peut pas être dans le futur.");
      await enregistrerSuivi(d, "transmission", { date: f.date || null, destinataire: f.destinataire.trim(), notes: f.notes.trim(), documents: f.documents.split("\n").map((x) => x.trim()).filter(Boolean) });
      onMessage?.("Transmission enregistrée."); recharger();
    } catch (e) { setErreur(e.message); }
    setOccupe(false);
  };
  const terminer = async () => {
    if (!window.confirm("Terminer la mission ?\n\nLe dossier passe « clos » et devient consultable seulement. Le client et ses données ne sont pas supprimés.")) return;
    setOccupe(true); setErreur("");
    const r = await supabase.from("invest_dossiers").update({ statut: "clos", motif_cloture: "Mission Offre 2 terminée : dossier transmis" }).eq("id", d.id).select("id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Clôture refusée : droits insuffisants."); return; }
    onMessage?.("Mission terminée."); recharger();
  };
  const dis = !modifiable || !m.suiviDisponible;
  const synthese = [
    { cle: "prix", libelle: "Prix d'achat", valeur: op.prixAchat, type: "eur" }, { cle: "travaux", libelle: "Travaux", valeur: op.travaux, type: "eur" }, { cle: "frais", libelle: "Frais", valeur: op.frais, type: "eur" },
    { cle: "cout", libelle: "Coût global", valeur: op.coutGlobal, type: "eur", fort: true }, { cle: "fin", libelle: "Financement", valeur: op.financement, type: "eur" }, { cle: "apport", libelle: "Apport", valeur: op.apport, type: "eur" },
    { cle: "loyer", libelle: "Loyer cible", valeur: op.loyerCible === null ? null : `${new Intl.NumberFormat("fr-FR").format(op.loyerCible)} € / mois` }, { cle: "renta", libelle: "Rentabilité cible", valeur: op.rendementCible, type: "pct" },
    { cle: "acq", libelle: "Date d'acquisition", valeur: dateFr(op.dateAcquisition) }, { cle: "trans", libelle: "Date de transmission", valeur: dateFr(op.dateTransmission) },
  ];
  return (
    <>
      <Bloc T={T} titre="Conditions de fin de mission" action={clos ? <Pastille couleur={COULEURS.termine}>Mission terminée</Pastille> : liste.terminable ? <Pastille couleur={COULEURS.termine}>Prête à terminer</Pastille> : <Pastille couleur="#d97706">{liste.manquants.length} point{liste.manquants.length > 1 ? "s" : ""} à finir</Pastille>}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {liste.items.map((i) => (
            <li key={i.cle} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, color: i.etat === "a_faire" ? T.textSub : T.text }}>
              <span style={{ width: 16, fontWeight: 900, color: i.etat === "ok" ? COULEURS.termine : i.etat === "na" ? COULEURS.na : T.textMuted }}>{i.etat === "ok" ? "✓" : i.etat === "na" ? "–" : "○"}</span>
              <span style={{ fontWeight: i.etat === "a_faire" ? 600 : 700 }}>{i.libelle}</span>
              {i.etat === "na" && <span style={{ fontSize: 11, color: T.textMuted }}>non applicable</span>}
              {i.cle === "documents" && i.etat === "a_faire" && <button className="inv-btn inv-btn-sm" style={{ fontSize: 11 }} onClick={() => onClientOnglet?.("documents")}>Voir les documents</button>}
            </li>
          ))}
        </ul>
        {modifiable && !clos && (
          <div style={{ marginTop: 10 }}>
            <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={!liste.terminable || occupe} onClick={terminer} title={liste.terminable ? "" : "Tous les points doivent être faits ou non applicables"}>Terminer la mission</button>
            {!liste.terminable && <span style={{ fontSize: 11.5, color: T.textMuted, marginLeft: 8 }}>Disponible quand tous les points sont faits.</span>}
          </div>
        )}
        {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
      </Bloc>

      <Bloc T={T} titre="Transmission du dossier">
        {!m.suiviDisponible && <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 8 }}>L'enregistrement de la transmission sera disponible après l'évolution de la base prévue (colonne de suivi de la mission).</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
          <Champ T={T} libelle="Date de transmission"><input className="inv-inp" type="date" disabled={dis} max={aujourdhuiIso()} value={f.date} onChange={maj("date")} /></Champ>
          <Champ T={T} libelle="Destinataire / gestionnaire"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.destinataire} onChange={maj("destinataire")} placeholder="Non renseigné" /></Champ>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8, marginTop: 8 }}>
          <Champ T={T} libelle="Documents transmis (un par ligne)"><textarea className="inv-textarea" rows={3} disabled={dis} value={f.documents} onChange={maj("documents")} /></Champ>
          <Champ T={T} libelle="Notes"><textarea className="inv-textarea" rows={3} disabled={dis} value={f.notes} onChange={maj("notes")} /></Champ>
        </div>
        {modifiable && m.suiviDisponible && <div style={{ marginTop: 8 }}><button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={enregistrer}>Enregistrer la transmission</button></div>}
      </Bloc>

      <Bloc T={T} titre="Synthèse de l'opération">
        {!m.acquisition && !bien ? <EtatVide T={T} titre="Opération pas encore constituée" texte="La synthèse se remplit avec le bien retenu, l'acquisition et le financement." /> : <GrilleDonnees T={T} donnees={synthese} colonnes={140} />}
        <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>Le suivi locatif (locataires, loyers encaissés, quittances) ne fait pas partie de cette mission.</div>
      </Bloc>
    </>
  );
}
