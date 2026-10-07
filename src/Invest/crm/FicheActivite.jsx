// src/Invest/crm/FicheActivite.jsx — onglet « Activité » de la fiche client (remplace « Historique »).
// Notes, appels, rendez-vous, e-mails et événements de mission, filtrables. Les événements techniques
// (changement de balle, d'échéance…) restent enregistrés mais sont masqués : « ••• → Journal système ».
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { FILTRES_ACTIVITE, categorieActivite, filtrerActivite } from "./ficheOffres";
import { Section, Discret, dateCourte, ROUGE, VERT, BLEU, GRIS } from "./ui";

const TYPES_NOTE = [["commentaire", "Note"], ["appel", "Appel"], ["rendez-vous", "Rendez-vous"], ["relance", "Relance"], ["document", "Document"], ["autre", "Autre"]];
const COULEUR = { notes: VERT, appels: VERT, rdv: VERT, emails: BLEU, missions: BLEU, technique: GRIS };

export function ListeActivite({ T, items }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
      {items.map((h) => (
        <li key={h.id} style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", gap: 14, padding: "6px 0", borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>{dateCourte(h.quand) || "Date inconnue"}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: COULEUR[categorieActivite(h)] || BLEU }}>{h.type}{h.mission ? ` · ${h.mission}` : ""}</div>
            <div style={{ fontSize: 13, color: T.text, marginTop: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{h.texte || "—"}{h.auteur && <span style={{ fontSize: 11.5, color: T.textMuted }}> · {h.auteur}</span>}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function FicheActivite({ T, vue, client, profil, onAjoute, journal, onJournal, signalNote }) {
  const [filtre, setFiltre] = useState("tout");
  const [limite, setLimite] = useState(30);
  const [note, setNote] = useState({ type: "commentaire", contenu: "" });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const zone = useRef(null);
  useEffect(() => { if (signalNote) zone.current?.focus(); }, [signalNote]);
  const items = filtrerActivite(vue.historique, { filtre, technique: journal });
  const ajouter = async () => {
    if (!note.contenu.trim()) return;
    setEnvoi(true); setErreur("");
    const { error } = await supabase.from("invest_notes").insert({ client_id: client.id, auteur: profil?.nom || "", type: note.type, contenu: note.contenu.trim() });
    setEnvoi(false);
    if (error) { setErreur(error.message); return; }
    setNote({ type: "commentaire", contenu: "" }); onAjoute();
  };
  return (
    <>
      <Section T={T} compact titre="Ajouter une note">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <select className="inv-sel" value={note.type} onChange={(e) => setNote((n) => ({ ...n, type: e.target.value }))} aria-label="Type de note">{TYPES_NOTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <textarea ref={zone} className="inv-inp" rows={2} style={{ textAlign: "left", flex: "1 1 320px", minHeight: 44 }} placeholder="Compte rendu d'appel, échange, remarque…" value={note.contenu} onChange={(e) => setNote((n) => ({ ...n, contenu: e.target.value }))} />
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ajouter} disabled={envoi || !note.contenu.trim()}>{envoi ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
        {erreur && <Discret T={T} style={{ color: ROUGE, marginTop: 6 }}>{erreur}</Discret>}
      </Section>
      <Section T={T} compact titre={`Activité · ${items.length}`} action={
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {FILTRES_ACTIVITE.map((f) => (
            <button key={f.cle} onClick={() => { setFiltre(f.cle); setLimite(30); }} className="inv-btn inv-btn-sm" style={filtre === f.cle ? { background: T.accentBg, color: T.accent } : undefined}>{f.libelle}</button>
          ))}
        </div>}>
        {journal && (
          <Discret T={T} style={{ marginBottom: 8 }}>
            Journal système affiché : les événements techniques des missions sont inclus. <button className="inv-btn inv-btn-sm" onClick={() => onJournal(false)}>Masquer</button>
          </Discret>
        )}
        {items.length === 0 ? <Discret T={T}>Aucun élément pour ce filtre.</Discret> : <ListeActivite T={T} items={items.slice(0, limite)} />}
        {items.length > limite && <button className="inv-btn inv-btn-sm" style={{ marginTop: 12 }} onClick={() => setLimite((l) => l + 30)}>Afficher plus ({items.length - limite} restants)</button>}
      </Section>
    </>
  );
}
