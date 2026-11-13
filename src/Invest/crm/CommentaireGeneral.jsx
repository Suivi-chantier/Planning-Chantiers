// src/Invest/crm/CommentaireGeneral.jsx — « Commentaire général » de la fiche client (Vue d'ensemble).
//
// Même principe que la « Note de synthèse » de la fiche prospect : un texte libre (besoin, freins, décision,
// suite à donner), lu avant l'activité. Il réutilise la colonne existante invest_clients.notes_rapides (« Notes
// rapides » de l'ancienne fiche et du formulaire client) : aucune colonne nouvelle, aucun doublon, rien à migrer.
// Seule écriture de ce composant : invest_clients.notes_rapides. Note interne, jamais montrée au client.
import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { Section, Discret, ROUGE, VERT } from "./ui";

export default function CommentaireGeneral({ T, clientId, valeur, onEnregistre }) {
  const enregistre = valeur || "";
  const [texte, setTexte] = useState(enregistre);
  const [occupe, setOccupe] = useState(false);
  const [retour, setRetour] = useState(null); // { ok, message }
  // Une relecture de la fiche (après une autre modification) ne doit pas écraser une saisie en cours.
  useEffect(() => { setTexte((t) => (t === enregistre || t === "" ? enregistre : t)); }, [enregistre]);
  useEffect(() => { setTexte(enregistre); setRetour(null); }, [clientId]);

  const modifie = texte !== enregistre;
  const enregistrer = async () => {
    setOccupe(true); setRetour(null);
    const { data, error } = await supabase.from("invest_clients").update({ notes_rapides: texte.trim() || null }).eq("id", clientId).select("id");
    setOccupe(false);
    if (error) { setRetour({ ok: false, message: `Enregistrement impossible : ${error.message}` }); return; }
    if (!data?.length) { setRetour({ ok: false, message: "Modification refusée : droits insuffisants ou client introuvable." }); return; }
    setTexte(texte.trim());
    setRetour({ ok: true, message: "Commentaire enregistré." });
    onEnregistre?.();
  };

  return (
    <Section T={T} compact titre="Commentaire général">
      <textarea className="inv-textarea" rows={4} value={texte} onChange={(e) => setTexte(e.target.value)} aria-label="Commentaire général"
        placeholder="Résumé rapide : besoin, échange, frein, décision, suite à donner…" style={{ width: "100%", fontSize: 14, lineHeight: 1.5 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        {modifie && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={enregistrer} disabled={occupe}>{occupe ? "Enregistrement…" : "Enregistrer"}</button>}
        {modifie && !occupe && <button className="inv-btn inv-btn-sm" onClick={() => { setTexte(enregistre); setRetour(null); }}>Annuler</button>}
        {retour && <Discret T={T} style={{ color: retour.ok ? VERT : ROUGE, fontWeight: 700 }}>{retour.message}</Discret>}
        {!modifie && !retour && <Discret T={T}>Note interne : le client ne la voit pas.</Discret>}
      </div>
    </Section>
  );
}
