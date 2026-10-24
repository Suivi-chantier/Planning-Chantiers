// src/Renovation/TauxFraisGenerauxAdmin.jsx — Réglages → Taux horaires →
// « Frais généraux » : LE taux de frais généraux de l'entreprise, daté.
// Stocké dans planning_config (clé CLE_CONFIG_TAUX_FG) sous forme de liste
// [{ depuis, taux }]. Chaque heure pointée est comptée au taux en vigueur à sa
// date (calcul dans chantierFinance.mjs) : ajouter un taux ne change pas les
// heures passées, les anciens taux restent dans la liste.
import React, { useState } from "react";
import { CLE_CONFIG_TAUX_FG, TAUX_FG_DEFAUT, normaliserBaremeFG, ajouterTauxFG, tauxFGALaDate } from "../chantierFinance";

const dateFr = (iso) => String(iso).split("-").reverse().join("/");
const fmtTaux = (t) => `${(parseFloat(t) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €/h`;

export default function TauxFraisGenerauxAdmin({ T, tauxFG, setTauxFG, saveConfig }) {
  const enregistre = Array.isArray(tauxFG) && tauxFG.length > 0;
  const bareme = normaliserBaremeFG(tauxFG);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const tauxDuJour = tauxFGALaDate(bareme, aujourdhui);
  // Entrée en vigueur : la dernière commencée (la plus ancienne si toutes sont à venir).
  const dateEnVigueur = (bareme.filter(e => e.depuis <= aujourdhui).pop() || bareme[0]).depuis;
  const [depuis, setDepuis] = useState(aujourdhui);
  const [taux, setTaux] = useState("");
  const [erreur, setErreur] = useState(null);

  const enregistrer = (liste) => {
    setTauxFG && setTauxFG(liste);
    saveConfig && saveConfig(CLE_CONFIG_TAUX_FG, liste);
  };
  const ajouter = () => {
    const r = ajouterTauxFG(bareme, { depuis, taux });
    if (r.erreur) { setErreur(r.erreur); return; }
    setErreur(null); setTaux("");
    enregistrer(r.bareme);
  };
  const supprimer = (e) => {
    if (bareme.length <= 1) return;
    const ok = window.confirm(
      `Supprimer le taux de ${fmtTaux(e.taux)} applicable depuis le ${dateFr(e.depuis)} ?\n\n` +
      "Les heures de cette période seront recomptées au taux précédent : les frais généraux et les marges passées changeront.");
    if (!ok) return;
    enregistrer(bareme.filter(x => x.depuis !== e.depuis));
  };

  const inp = {
    padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg,
    color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none",
  };

  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Taux de frais généraux</div>
      <div style={{ color: T.textSub, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
        Un seul taux pour tous les chantiers. Chaque heure réelle d'un chantier coûte en frais généraux le taux
        <strong> en vigueur à la date de cette heure</strong> ; les heures restantes à faire sont estimées au taux
        d'aujourd'hui (<strong>{fmtTaux(tauxDuJour)}</strong>). Pour changer de taux, ajoute-en un nouveau avec sa date
        d'effet : les anciens restent, et les heures passées gardent leur taux.
        {!enregistre && (
          <span style={{ display: "block", marginTop: 6, fontStyle: "italic", color: T.textMuted }}>
            Aucun taux enregistré : valeur par défaut appliquée ({fmtTaux(TAUX_FG_DEFAUT[0].taux)} depuis le {dateFr(TAUX_FG_DEFAUT[0].depuis)}).
          </span>
        )}
      </div>

      {[...bareme].reverse().map((e) => {
        const enVigueur = e.depuis === dateEnVigueur;
        return (
          <div key={e.depuis} className="ar" style={{ gap: 12 }}>
            <div style={{ flex: 1, fontSize: 14, color: T.text }}>
              Depuis le <strong>{dateFr(e.depuis)}</strong>
              {enVigueur && <span style={{ marginLeft: 8, fontSize: 12, color: "#22c55e", fontWeight: 600 }}>en vigueur</span>}
              {e.depuis > aujourdhui && <span style={{ marginLeft: 8, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>à venir</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.accent }}>{fmtTaux(e.taux)}</div>
            {bareme.length > 1 && (
              <button onClick={() => supprimer(e)} title="Supprimer ce taux"
                style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13 }}>
                Supprimer
              </button>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 13, color: T.textSub }}>Nouveau taux à partir du</span>
        <input type="date" value={depuis} onChange={e => setDepuis(e.target.value)} style={inp}/>
        <input type="number" min="0" step="0.01" value={taux} onChange={e => setTaux(e.target.value)}
          placeholder={String(tauxDuJour).replace(".", ",")} style={{ ...inp, width: 90, textAlign: "center" }}/>
        <span style={{ fontSize: 13, color: T.textMuted }}>€/h</span>
        <button onClick={ajouter}
          style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: T.accent, color: "#fff",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Ajouter ce taux
        </button>
      </div>
      {erreur && <div style={{ marginTop: 6, fontSize: 12, color: "#e15a5a" }}>{erreur}</div>}
    </div>
  );
}
