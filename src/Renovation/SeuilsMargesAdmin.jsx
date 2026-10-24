// src/Renovation/SeuilsMargesAdmin.jsx — Réglages → Taux horaires →
// « Marge probable et alertes » (étape 2 de la refonte des marges). Tous les
// seuils de la marge probable et des alertes, stockés dans planning_config
// (clé CLE_CONFIG_SEUILS_MARGES). Valeur vide = défaut. Affiche aussi, en
// lecture seule, les dérives historiques par type de lot calculées chaque nuit.
import React, { useState } from "react";
import { CLE_CONFIG_SEUILS_MARGES, SEUILS_MARGES_DEFAUT, normaliserSeuilsMarges } from "../chantierFinance";
import { useReglagesMarges, chargerReglagesMarges } from "./reglagesMarges";

const CHAMPS = [
  { titre: "Marge probable" },
  { cle: "deriveSeuilAvancementPct", label: "Dérive constatée appliquée à partir de", unite: "% d'avancement du lot" },
  { cle: "derivePlafond", label: "Coefficient maximal appliqué aux heures restantes", unite: "× (plafond)" },
  { cle: "historiqueMinChantiers", label: "Dérive historique d'un lot : au moins", unite: "chantiers terminés" },
  { titre: "Alertes" },
  { cle: "alerteBaisseMargeProbableEuros", label: "Marge probable en baisse de plus de", unite: "€ par rapport au relevé de comparaison" },
  { cle: "alerteDeriveLotRatio", label: "Lot qui dérive au-delà de", unite: "× (heures réelles ÷ attendues)" },
  { cle: "alerteDeriveLotAvancementPct", label: "… avec au moins", unite: "% d'avancement du lot" },
  { cle: "alerteSansLotPct", label: "Heures « sans lot » au-delà de", unite: "% des heures du chantier" },
  { cle: "alerteProductionHeureFacteur", label: "Production par heure aberrante au-delà de", unite: "× la production par heure vendue" },
  { cle: "alerteDepassementEnveloppeMinEuros", label: "Dépassement d'enveloppe matériaux d'un lot à partir de", unite: "€" },
  { titre: "Consommation sans avancement" },
  { cle: "consoAvancementStablePts", label: "Avancement considéré stable jusqu'à", unite: "point(s) de production" },
  { cle: "consoHeuresAjouteesMin", label: "Au moins", unite: "heures consommées sur la période" },
  { cle: "consoMargePerdueMinEuros", label: "Marge à l'avancement en baisse d'au moins", unite: "€" },
  { titre: "Tâches hors devis" },
  { cle: "horsDevisRappelSemaines", label: "Rappel des tâches « à arbitrer » au-delà de", unite: "semaines sans décision (avenant ou geste commercial)" },
];

export default function SeuilsMargesAdmin({ T, saveConfig }) {
  const reglages = useReglagesMarges();
  const valeurs = normaliserSeuilsMarges(reglages.seuilsMarges);
  const [brouillon, setBrouillon] = useState({});
  const [message, setMessage] = useState(null);
  const valeurChamp = (cle) => brouillon[cle] ?? String(valeurs[cle]).replace(".", ",");

  const enregistrer = async () => {
    const suivant = { ...(reglages.seuilsMarges || {}) };
    Object.entries(brouillon).forEach(([cle, texte]) => {
      const n = parseFloat(String(texte).replace(",", "."));
      if (String(texte).trim() === "") delete suivant[cle];
      else if (Number.isFinite(n) && n >= 0) suivant[cle] = n;
    });
    await saveConfig?.(CLE_CONFIG_SEUILS_MARGES, suivant);
    await chargerReglagesMarges({ forcer: true });
    setBrouillon({});
    setMessage("Réglages enregistrés : la marge probable et les alertes en tiennent compte dès maintenant (les relevés passés sont recalculés la nuit pour les chantiers qui bougent).");
  };

  const inp = {
    width: 80, padding: "6px 8px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg,
    color: T.accent, fontFamily: "inherit", fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none",
  };
  const hist = reglages.derivesDetail;
  const lotsHist = Object.values(hist?.lots || {});

  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Marge probable et alertes</div>
      <div style={{ color: T.textSub, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
        La <strong>marge probable</strong> multiplie les heures restantes de chaque lot par sa dérive : la dérive constatée
        quand le lot est assez avancé, sinon la dérive moyenne de ce type de lot sur les chantiers terminés. Les seuils
        ci-dessous règlent ce calcul et les alertes du Bilan. Un champ vidé reprend la valeur par défaut.
      </div>
      {CHAMPS.map((c, i) => c.titre ? (
        <div key={`t${i}`} style={{ fontWeight: 700, fontSize: 13, color: T.textMuted, textTransform: "uppercase", letterSpacing: .6, margin: "12px 0 4px" }}>{c.titre}</div>
      ) : (
        <div key={c.cle} className="ar" style={{ gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 14, color: T.text }}>{c.label}</div>
          <input value={valeurChamp(c.cle)} inputMode="decimal"
            onChange={e => { setMessage(null); setBrouillon(b => ({ ...b, [c.cle]: e.target.value })); }}
            style={inp}/>
          <div style={{ width: 260, fontSize: 12, color: T.textMuted }}>
            {c.unite}
            {valeurs[c.cle] !== SEUILS_MARGES_DEFAUT[c.cle] && (
              <span style={{ display: "block", fontStyle: "italic" }}>défaut : {String(SEUILS_MARGES_DEFAUT[c.cle]).replace(".", ",")}</span>
            )}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button onClick={enregistrer} disabled={Object.keys(brouillon).length === 0}
          style={{ padding: "8px 14px", borderRadius: 8, border: "none", fontWeight: 700, cursor: Object.keys(brouillon).length ? "pointer" : "not-allowed",
            background: Object.keys(brouillon).length ? T.accent : T.border, color: "#111" }}>
          Enregistrer
        </button>
        {message && <span style={{ fontSize: 12, color: "#22c55e" }}>{message}</span>}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, color: T.textMuted, textTransform: "uppercase", letterSpacing: .6, margin: "18px 0 4px" }}>
        Dérives historiques par type de lot
      </div>
      <div style={{ color: T.textSub, fontSize: 12.5, marginBottom: 6, lineHeight: 1.5 }}>
        Calculées chaque nuit sur les chantiers au statut « terminé », chantiers repris et chantiers avec une reprise
        d'heures d'avant l'application exclus.
        {hist?.calcule_le ? ` Dernier calcul : ${new Date(hist.calcule_le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.` : " Pas encore calculées."}
        {(hist?.exclusReprise || []).length > 0 && ` Exclus (reprise d'heures) : ${hist.exclusReprise.join(", ")}.`}
        {(hist?.exclusRepris || []).length > 0 && ` Exclus (chantiers repris) : ${hist.exclusRepris.join(", ")}.`}
      </div>
      {lotsHist.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucune dérive historique disponible : les lots non commencés gardent un coefficient ×1.</div>
      ) : lotsHist.map(l => (
        <div key={l.lotId} className="ar" style={{ gap: 10 }}>
          <div style={{ flex: 1, fontSize: 14, color: T.text }}>{l.label}</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: l.retenu ? T.accent : T.textMuted }}>
            {l.coef == null ? "—" : `×${(Math.round(l.coef * 100) / 100).toLocaleString("fr-FR")}`}
          </div>
          <div style={{ width: 260, fontSize: 12, color: T.textMuted }}>
            {l.nbChantiers} chantier{l.nbChantiers > 1 ? "s" : ""}{l.retenu ? "" : " · pas assez de chantiers, non appliquée"}
          </div>
        </div>
      ))}
    </div>
  );
}
