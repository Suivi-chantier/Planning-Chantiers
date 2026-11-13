// src/Renovation/AcompteProgbat.jsx — Refonte Opérations, lot 4.
// Étape « Devis signé » de la fiche chantier : création de la facture
// d'acompte (50 %) en BROUILLON dans ProGBat, sur bouton, après aperçu et
// confirmation. Le serveur (Edge Function progbat-operations) vérifie que la
// signature est validée, qu'aucune facture d'acompte n'existe déjà pour ce
// devis, réserve l'écriture puis appelle ProGBat. L'assistante valide et
// émet ensuite la facture dans ProGBat (l'API ne le permet pas).
import React, { useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Receipt, ExternalLink, Check, AlertTriangle, RefreshCw, X } from "lucide-react";
import { lienProgbat } from "./progbatLiens.js";
import { TAUX_ACOMPTE } from "./progbatAutomatisation.js";
import { appelerProgbatOperations } from "./ProgbatClientChantier.jsx";

export default function AcompteProgbat({ T, acc, projetId, quoteId, devisSigneFait, factureConnue, onChange }) {
  const [apercu, setApercu] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [resultat, setResultat] = useState(null);
  const btn = (plein, off) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: RADIUS.md,
    border: plein ? "none" : `1px solid ${T.border}`, background: off ? T.border : plein ? acc.accent : "transparent",
    color: off ? T.textMuted : plein ? acc.onAccent : T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
    cursor: off ? "not-allowed" : "pointer", textDecoration: "none",
  });
  const petit = { fontSize: FONT.xs.size + 1, lineHeight: 1.5, marginTop: 4 };
  const bill = resultat?.billId ? { id: resultat.billId, code: resultat.billCode } : factureConnue;

  if (bill?.id || bill?.code) {
    const l = lienProgbat("facture", bill.id, { nom: bill.code || "" });
    return (
      <div style={{ ...petit, color: T.textSub }}>
        <Icon as={Receipt} size={11} /> Facture d'acompte : {bill.code || `n° ${bill.id}`}{resultat?.ok ? " — créée en brouillon : à valider puis émettre dans ProGBat" : ""}.
        {l?.url && <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.titre} style={{ ...btn(false, false), marginLeft: 6 }}><Icon as={ExternalLink} size={11} />Ouvrir dans ProGBat</a>}
      </div>
    );
  }
  if (!devisSigneFait) {
    return <div style={{ ...petit, color: T.textMuted, fontStyle: "italic" }}>Après la validation : bouton « Créer la facture d'acompte en brouillon » ({TAUX_ACOMPTE} %) dans ProGBat.</div>;
  }
  if (!quoteId || !projetId) {
    return <div style={{ ...petit, color: "#f5a623", fontWeight: 600 }}>Facture d'acompte : création impossible depuis l'application — aucun devis ProGBat connu pour ce chantier (devis créé hors de l'application ou chiffrage non rattaché). À créer à la main dans ProGBat.</div>;
  }

  const preparer = async () => {
    setOccupe(true); setResultat(null);
    const rep = await appelerProgbatOperations({ action: "preparer_acompte", projectId: projetId });
    setOccupe(false);
    if (rep?.ok) setApercu(rep); else setResultat({ ok: false, texte: rep?.error || "Aperçu impossible." });
  };
  const confirmer = async () => {
    setOccupe(true);
    const rep = await appelerProgbatOperations({ action: "creer_acompte", projectId: projetId, confirmed: true, expectedHash: apercu?.hash });
    setOccupe(false); setApercu(null);
    setResultat({ ok: !!rep?.ok, texte: rep?.message || rep?.error || "Réponse vide.", billId: rep?.billId, billCode: rep?.billCode, aFaire: rep?.a_faire_par_loris });
    if (rep?.ok) onChange?.();
  };
  const bloque = !!(apercu?.deja_existante || apercu?.blocage || (apercu && apercu.lecture_factures !== "ok"));

  return (
    <div style={petit}>
      {!apercu && (
        <button onClick={preparer} disabled={occupe} style={btn(true, occupe)} title="Aperçu puis confirmation : rien n'est créé sans votre confirmation">
          <Icon as={occupe ? RefreshCw : Receipt} size={11} />Créer la facture d'acompte en brouillon ({TAUX_ACOMPTE} %)
        </button>
      )}
      {apercu && (
        <div style={{ border: `2px solid ${acc.accent}`, borderRadius: RADIUS.md, padding: "8px 10px", marginTop: 4 }}>
          <div style={{ fontWeight: 800, color: T.text }}>Créer la facture d'acompte de {TAUX_ACOMPTE} % du devis ProGBat n° {apercu.quoteId} en brouillon ?</div>
          <div style={{ color: T.textMuted }}>Écriture dans la comptabilité ProGBat ({apercu.endpoint}, droit {apercu.droit}). La facture reste un brouillon : l'assistante la valide et l'émet dans ProGBat.</div>
          {apercu.deja_existante && <div style={{ color: "#e15a5a", fontWeight: 700 }}>{apercu.deja_existante}</div>}
          {apercu.lecture_factures !== "ok" && <div style={{ color: "#e15a5a", fontWeight: 700 }}>{apercu.lecture_factures || "Lecture des factures ProGBat impossible"} : impossible de vérifier qu'aucun acompte n'existe déjà, création bloquée.</div>}
          {apercu.blocage && <div style={{ color: "#e15a5a", fontWeight: 700 }}>{apercu.blocage.message}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button onClick={() => setApercu(null)} disabled={occupe} style={btn(false, occupe)}><Icon as={X} size={11} />Annuler</button>
            <button onClick={confirmer} disabled={occupe || bloque} style={btn(true, occupe || bloque)}><Icon as={occupe ? RefreshCw : Check} size={11} />{occupe ? "Création…" : "Confirmer la création dans ProGBat"}</button>
          </div>
        </div>
      )}
      {resultat && (
        <div style={{ marginTop: 4, fontWeight: 700, color: resultat.ok ? "#22c55e" : "#e15a5a", display: "flex", gap: 5, alignItems: "flex-start" }}>
          <Icon as={resultat.ok ? Check : AlertTriangle} size={12} />
          <span>{resultat.texte}{resultat.aFaire ? ` — À faire par Loris : ${resultat.aFaire}.` : ""}</span>
        </div>
      )}
    </div>
  );
}
