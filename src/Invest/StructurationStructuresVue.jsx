// src/Invest/StructurationStructuresVue.jsx — Comparaison des structures de détention d'une acquisition (lot 4).
// Les calculs viennent de structurationStructures.mjs. Aucun classement : les chiffres sont mis côte à côte.
import React, { useMemo, useState } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { SU, WA, DA } from "./_shared";
import { num } from "./structurationDonnees.mjs";
import { operationComplete } from "./structurationProjection.mjs";
import { comparerStructures, HYPOTHESES_STRUCTURES_PAR_DEFAUT, REGLES, lireTmi } from "./structurationStructures.mjs";

const eur = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`);

const PARAMS = [
  ["horizon", "Horizon de détention (ans)"], ["fraisAcquisitionPct", "Frais d'acquisition (%)"], ["terrainPct", "Part du terrain non amortissable (%)"],
  ["dureeAmortissement", "Durée d'amortissement (ans)"], ["fraisCreationSociete", "Création de la société (€)"],
  ["comptabiliteSciIR", "Comptabilité SCI IR (€/an)"], ["comptabiliteLmnpReel", "Comptabilité LMNP réel (€/an)"], ["comptabiliteSciIS", "Comptabilité SCI IS (€/an)"],
];

export function ComparaisonStructures({ T, data, onChange }) {
  const scenarios = Array.isArray(data.scenarios_chiffres) ? data.scenarios_chiffres : [];
  const operations = useMemo(() => scenarios.flatMap((s) => (s.operations || []).filter(operationComplete).map((o) => ({ ...o, scenarioId: s.id, scenarioNom: s.nom }))), [scenarios]);
  const [choix, setChoix] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const params = data.parametres_structures || {};
  const op = operations.find((o) => `${o.scenarioId}:${o.id}` === choix) || operations[0] || null;
  const surcharges = data.hypotheses_projection || {};
  const resultat = useMemo(() => (op ? comparerStructures(data, op, { surcharges, parametres: params }) : null), [data, op, surcharges, params]);
  const tmiDossier = lireTmi(data.collecte?.profil?.tmi);

  const setParam = (k, v) => onChange("parametres_structures", { ...params, [k]: v });
  const setLoyerMeuble = (v) => onChange("scenarios_chiffres", scenarios.map((s) => (s.id !== op.scenarioId ? s : { ...s, operations: s.operations.map((o) => (o.id === op.id ? { ...o, loyer_meuble_mois: v } : o)) })));

  const carte = { background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md };
  const lignes = resultat && resultat.structures.length ? [
    ["Régime retenu", (s) => s.libelleRegime],
    ["À l'entrée : frais d'acquisition et de société", (s) => eur(s.entree.frais)],
    ["Impôt de l'année 1 (négatif = économie)", (s) => eur(s.annuel.impotAnnee1)],
    ["Impôt annuel moyen", (s) => eur(s.annuel.impotMoyen)],
    ["Cash-flow annuel moyen après impôt", (s) => eur(s.annuel.cashApresImpotMoyen)],
    ["Trésorerie cumulée après impôt", (s) => eur(s.tresorerie.cumulCashApresImpot)],
    ["À la sortie : valeur de vente", (s) => eur(s.sortie.vente)],
    ["À la sortie : plus-value", (s) => eur(s.sortie.plusValue)],
    ["À la sortie : impôts", (s) => eur(s.sortie.impotSortie)],
    ["Gain net total sur la période", (s) => eur(s.gainNet), true],
    ["Complexité", (s) => s.complexite.niveau],
  ] : [];

  return (
    <section style={carte}>
      <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>Structures de détention comparées</h3>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "4px 0 10px", maxWidth: 900 }}>
        Une même acquisition détenue de quatre façons : nom propre en location nue, meublé non professionnel, SCI à l'IR, SCI à l'IS. On compare le cycle de vie complet (entrée, exploitation, trésorerie, sortie), pas seulement la fiscalité annuelle. <b>Estimation à valider par l'expert-comptable et le notaire</b> : aucune structure n'est désignée comme la meilleure.
      </div>
      {operations.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Ajoutez une opération avec un prix et une année dans un scénario chiffré (ci-dessus) pour comparer ses structures.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 10 }}>
            <label><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>Acquisition étudiée</span>
              <select className="inv-sel" value={op ? `${op.scenarioId}:${op.id}` : ""} onChange={(e) => setChoix(e.target.value)}>
                {operations.map((o) => <option key={`${o.scenarioId}:${o.id}`} value={`${o.scenarioId}:${o.id}`}>{o.scenarioNom} — {o.libelle || "Opération"} ({o.annee}, {eur(num(o.prix))})</option>)}
              </select></label>
            <label><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>TMI du foyer</span>
              <input className="inv-inp" style={{ width: 90 }} placeholder={tmiDossier !== null ? `${tmiDossier} %` : "ex. 30 %"} value={params.tmi ?? ""} onChange={(e) => setParam("tmi", e.target.value)} /></label>
            <label><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>Loyer si meublé (€/mois)</span>
              <input className="inv-inp" type="number" style={{ width: 130 }} placeholder={op ? String(op.loyer_mois || "") : ""} value={op?.loyer_meuble_mois ?? ""} onChange={(e) => setLoyerMeuble(e.target.value)} /></label>
            <button className="inv-btn inv-btn-sm" onClick={() => setOuvert((o) => !o)}>{ouvert ? "Masquer les hypothèses" : "Hypothèses et règles"}</button>
          </div>
          {resultat?.manquants.length > 0 && <div style={{ color: WA, fontWeight: 800, fontSize: FONT.sm.size }}>Non calculable : il manque {resultat.manquants.join(", ")}.</div>}
          {lignes.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="inv-table" style={{ width: "100%", minWidth: 760 }}>
                <thead><tr><th></th>{resultat.structures.map((s) => <th key={s.cle}>{s.libelle}</th>)}</tr></thead>
                <tbody>{lignes.map(([titre, f, fort]) => (
                  <tr key={titre}><td style={{ fontWeight: 800 }}>{titre}</td>{resultat.structures.map((s) => <td key={s.cle} style={{ fontWeight: fort ? 900 : 500, color: fort && s.gainNet < 0 ? DA : undefined }}>{f(s)}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {resultat?.structures.map((s) => (
            <div key={s.cle} style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: T.textSub }}>
              <b style={{ color: T.text }}>{s.libelle}</b> — {s.complexite.texte} <span style={{ color: T.textMuted }}>Sortie : {s.sortie.detail}</span>
              {s.alertes.map((a, i) => <div key={i} style={{ color: WA, fontWeight: 700 }}>{a}</div>)}
            </div>
          ))}
          {resultat?.avertissements.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: T.textMuted, fontSize: FONT.xs.size + 1 }}>{resultat.avertissements.map((a, i) => <li key={i}>{a}</li>)}</ul>
          )}
          <div style={{ marginTop: 10, padding: "8px 12px", borderLeft: `3px solid ${WA}`, background: T.input, borderRadius: RADIUS.md, fontSize: FONT.xs.size + 1, color: T.textSub }}>
            <b>À valider avec le notaire</b> : transmission du bien (donation de parts de SCI, démembrement). L'abattement de donation est de 100 000 € par parent et par enfant, renouvelable tous les 15 ans ; une décote sur la valeur des parts peut se justifier, mais elle n'a pas de taux légal : elle se motive au cas par cas.
          </div>
          {ouvert && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                {PARAMS.map(([k, l]) => (
                  <label key={k}><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{l}</span>
                    <input className="inv-inp" type="number" style={{ width: "100%" }} value={params[k] ?? HYPOTHESES_STRUCTURES_PAR_DEFAUT[k]} onChange={(e) => setParam(k, e.target.value)} /></label>))}
              </div>
              <div style={{ marginTop: 10, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                Règles appliquées : prélèvements sociaux {REGLES.prelevementsSociaux} % (revenus fonciers, meublés, plus-values immobilières) ; PFU {REGLES.pfu} % sur les dividendes ; IS {REGLES.isTauxReduit} % jusqu'à {eur(REGLES.isSeuilTauxReduit)} puis {REGLES.isTauxNormal} % ; plus-value des particuliers {REGLES.plusValueIR} % + {REGLES.plusValuePS} % avec abattements de durée ; micro-foncier {REGLES.microFoncierAbattement} % jusqu'à {eur(REGLES.microFoncierPlafond)} ; micro-BIC {REGLES.microBICAbattement} % jusqu'à {eur(REGLES.microBICPlafond)} ; déficit foncier imputable jusqu'à {eur(REGLES.deficitFoncierPlafond)} par an ; LMP au-delà de {eur(REGLES.lmpSeuilRecettes)} de recettes et des autres revenus professionnels. Régime d'impôt sur le revenu : barème, via la TMI saisie. Les hypothèses de marché (valeur, loyers, charges, vacance) sont celles du cas central de la projection.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
