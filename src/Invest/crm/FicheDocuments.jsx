// src/Invest/crm/FicheDocuments.jsx — onglet « Documents » : liste de contrôle compacte par catégories.
// Statuts de pièce : à demander · demandé · reçu · validé · non applicable (stockés dans invest_clients.strategie_data,
// emplacement historique de la checklist : les cinq pièces existantes et leurs clés sont conservées).
// Une demande groupée n'est JAMAIS envoyée sans confirmation (même e-mail qu'avant).
import React, { useState } from "react";
import { supabase } from "../../supabase";
import { clientStrategy, DocumentsSection } from "../_shared";
import { envoyerEmailApi } from "../../emailApi";
import { CATALOGUE_DOCUMENTS, EXIGENCES, ETATS_DOCUMENT, syntheseDocuments } from "./ficheOffres";
import { Section, Pastille, Discret, Carte, dateFr, aujourdhuiIso, ROUGE, ORANGE, BLEU, VERT, GRIS } from "./ui";

const COULEUR_ETAT = { "": ORANGE, demande: BLEU, recu: VERT, valide: VERT, na: GRIS };

export default function FicheDocuments({ T, client, profil, depotsClient, etude, onChange, onOuvrirEtude }) {
  const [liste, setListe] = useState(() => clientStrategy(client).documents_checklist || {});
  const [demandes, setDemandes] = useState(() => clientStrategy(client).documents_demandes || {});
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const email = String(client.email || "").trim();
  const synth = syntheseDocuments(liste, demandes);

  // Écrit la checklist dans strategie_data (même emplacement que l'ancienne vue CRM).
  const enregistrer = async (nextListe, nextDemandes) => {
    const strat = { ...clientStrategy(client), documents_checklist: nextListe, documents_demandes: nextDemandes };
    const r = await supabase.from("invest_clients").update({ strategie_data: strat }).eq("id", client.id).select("id");
    if (r.error) throw new Error(r.error.message);
    if (!r.data?.length) throw new Error("Modification refusée : droits insuffisants.");
    setListe(nextListe); setDemandes(nextDemandes); onChange?.();
  };
  const changer = async (cle, valeur) => {
    setErreur(""); setMessage("");
    try { await enregistrer({ ...liste, [cle]: valeur }, demandes); } catch (e) { setErreur(e.message); }
  };
  const demander = async (cles) => {
    if (!email) { setErreur("Aucune adresse e-mail sur la fiche : renseignez-la pour demander les pièces."); return; }
    const libelles = CATALOGUE_DOCUMENTS.filter((d) => cles.includes(d.cle)).map((d) => d.libelle);
    if (!window.confirm(`Envoyer à ${email} une demande pour :\n\n- ${libelles.join("\n- ")}\n\nLe client recevra un e-mail de votre part.`)) return;
    setOccupe(true); setErreur(""); setMessage("");
    try {
      const prenom = client.prenom || "";
      const signature = profil?.nom || "L'équipe Profero Invest";
      const texte = `Bonjour${prenom ? " " + prenom : ""},\n\nPour faire avancer votre dossier, pourriez-vous nous transmettre les pièces suivantes :\n\n- ${libelles.join("\n- ")}\n\nVous pouvez simplement répondre à ce message avec les documents en pièce jointe.\n\nMerci d'avance,\n${signature}\nProfero Invest`;
      const echap = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1a1f2e;font-size:14px"><p>Bonjour${prenom ? " " + echap(prenom) : ""},</p><p>Pour faire avancer votre dossier, pourriez-vous nous transmettre les pièces suivantes :</p><ul>${libelles.map((l) => `<li>${echap(l)}</li>`).join("")}</ul><p>Vous pouvez simplement répondre à ce message avec les documents en pièce jointe.</p><p>Merci d'avance,<br>${echap(signature)}<br>Profero Invest</p></div>`;
      const resp = await envoyerEmailApi({ to: email, subject: "Profero Invest — pièces à nous transmettre", html, text: texte }, { source: "crm-documents" });
      const corps = await resp.json().catch(() => ({}));
      if (!resp.ok || corps?.error) throw new Error(corps?.error || `Envoi refusé (erreur ${resp.status})`);
      const jour = aujourdhuiIso();
      const nextListe = { ...liste }, nextDem = { ...demandes };
      cles.forEach((k) => { if (!nextListe[k]) nextListe[k] = "demande"; nextDem[k] = jour; });
      await enregistrer(nextListe, nextDem);
      await supabase.from("invest_notes").insert({ client_id: client.id, auteur: profil?.nom || "", type: "document", contenu: `Demande de pièces envoyée à ${email} : ${libelles.join(", ")}.` });
      setMessage(`Demande envoyée à ${email}.`);
    } catch (e) { setErreur(e.message); }
    setOccupe(false);
  };

  const n = synth.aDemander.length;
  return (
    <>
      <Section T={T} compact titre={`Pièces suivies · ${synth.recus} / ${synth.total} reçues`} action={
        <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe || n === 0 || !email} onClick={() => demander(synth.aDemander)}
          title={!email ? "Aucune adresse e-mail sur la fiche" : "Une confirmation vous sera demandée avant l'envoi"}>
          {n ? `Demander les ${n} pièce${n > 1 ? "s" : ""} manquante${n > 1 ? "s" : ""}` : "Aucune pièce à demander"}
        </button>}>
        {message && <Discret T={T} style={{ color: VERT, marginBottom: 8 }}>{message}</Discret>}
        {erreur && <Discret T={T} style={{ color: ROUGE, marginBottom: 8 }}>{erreur}</Discret>}
        {depotsClient > 0 && <Discret T={T} style={{ color: ORANGE, marginBottom: 8, fontWeight: 800 }}>Le client a déposé {depotsClient} pièce{depotsClient > 1 ? "s" : ""} depuis son espace : à vérifier{etude ? "" : " (étude patrimoniale requise pour les intégrer)"}.
          {etude && <> <button className="inv-btn inv-btn-sm" onClick={onOuvrirEtude}>Vérifier</button></>}</Discret>}
        {synth.categories.map((c) => (
          <Carte key={c.cle} T={T} style={{ padding: "8px 14px", marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, padding: "2px 0 4px" }}>{c.libelle}</div>
            {c.lignes.map((l) => (
              <div key={l.cle} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${T.rowBorder || T.border}`, fontSize: 13.5, color: T.text }}>
                <span>{l.libelle} <span style={{ fontSize: 11.5, color: T.textMuted }}>· {EXIGENCES[l.exigence]}{l.demandeLe && l.etat === "demande" ? ` · demandé le ${dateFr(l.demandeLe)}` : ""}</span></span>
                <Pastille couleur={COULEUR_ETAT[l.etat]}>{ETATS_DOCUMENT[l.etat]}</Pastille>
                <select className="inv-sel" value={l.etat} onChange={(e) => changer(l.cle, e.target.value)} aria-label={`Statut : ${l.libelle}`}>
                  {Object.entries(ETATS_DOCUMENT).map(([v, lib]) => <option key={v} value={v}>{lib}</option>)}
                </select>
                <button className="inv-btn inv-btn-sm" disabled={occupe || !email || ["recu", "valide", "na"].includes(l.etat)} onClick={() => demander([l.cle])}>{l.etat === "demande" ? "Relancer" : "Demander"}</button>
              </div>
            ))}
          </Carte>
        ))}
        {etude && etude.requis > 0 && (
          <Discret T={T} style={{ marginTop: 4 }}>
            Pièces de l'étude patrimoniale : {etude.recus} / {etude.requis} obligatoires reçues. <button className="inv-btn inv-btn-sm" onClick={onOuvrirEtude}>Ouvrir l'étude</button>
          </Discret>
        )}
      </Section>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 14, color: T.textSub, padding: "8px 0" }}>Fichiers du client (Drive)</summary>
        <div style={{ marginTop: 8 }}><DocumentsSection folder={`clients/${client.id}`} T={T} lectureSeule /></div>
      </details>
    </>
  );
}
