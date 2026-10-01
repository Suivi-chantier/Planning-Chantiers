// src/Invest/crm/SujetStructuration.jsx — case « Sujet de structuration » de la fiche client.
//
// Sépare les clients pour qui l'on fait une simple recherche d'investissement de ceux qui ont un
// sujet de structuration : la case fait apparaître l'onglet Structuration de la fiche et permet de
// filtrer la liste du CRM. Elle n'écrit que invest_clients.sujet_structuration.
import React, { useState } from "react";
import { supabase } from "../../supabase";
import { Discret, ROUGE } from "./ui";

export default function SujetStructuration({ T, client, onChange }) {
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const actif = client?.sujet_structuration === true;
  const basculer = async () => {
    setOccupe(true); setErreur("");
    const { data, error } = await supabase.from("invest_clients").update({ sujet_structuration: !actif }).eq("id", client.id).select("id");
    setOccupe(false);
    if (error) { setErreur(error.message); return; }
    if (!data?.length) { setErreur("Modification refusée : droits insuffisants."); return; }
    onChange?.();
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="inv-btn inv-btn-sm" disabled={occupe} aria-pressed={actif} onClick={basculer}
        title={actif ? "Ce client a un sujet de structuration (onglet Structuration visible). Cliquer pour le retirer." : "Cocher si ce client a un sujet de structuration, en plus ou à la place d'une recherche d'investissement."}
        style={actif ? { background: "#ede9fe", border: "1px solid #c4b5fd", color: "#5b21b6" } : undefined}>
        {actif ? "✓ Sujet de structuration" : "＋ Sujet de structuration"}
      </button>
      {erreur && <Discret T={T} style={{ color: ROUGE }}>{erreur}</Discret>}
    </span>
  );
}
