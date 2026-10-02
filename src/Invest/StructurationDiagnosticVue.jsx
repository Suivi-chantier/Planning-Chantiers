// src/Invest/StructurationDiagnosticVue.jsx — Diagnostic automatique (lot 2) : situation, forces / faiblesses /
// risques / opportunités, capacité d'emprunt en trajectoire. Les calculs viennent de structurationDiagnostic.mjs.
import React from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { Plus, Trash2, Copy } from "lucide-react";
import { SU, WA, DA } from "./_shared";
import { num } from "./structurationDonnees.mjs";
import { situation, analyserSwot, trajectoireCapacite, texteSynthese, HYPOTHESES_PAR_DEFAUT } from "./structurationDiagnostic.mjs";

const eur = (v) => (v === null || v === undefined ? "non calculable" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`);
const pc = (v) => (v === null || v === undefined ? "non calculable" : `${Math.round(v * 100)} %`);
const nouvelId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

function Carte({ T, titre, aide, action, children }) {
  return (
    <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>{titre}</h3>{action}
      </div>
      {aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: SPACING.sm, maxWidth: 860 }}>{aide}</div>}
      {children}
    </section>
  );
}
const Puce = ({ T, label, valeur, ton }) => (
  <div style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "8px 12px", background: T.input, minWidth: 0 }}>
    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: FONT.lg.size, fontWeight: 900, color: ton || T.text }}>{valeur}</div>
  </div>
);
const GRILLE = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 };

function BarreRepartition({ T, segments }) {
  const total = segments.reduce((s, x) => s + x.valeur, 0);
  if (total <= 0) return <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Rien à représenter pour l'instant.</div>;
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
        {segments.filter((x) => x.valeur > 0).map((x) => <div key={x.libelle} title={`${x.libelle} : ${eur(x.valeur)}`} style={{ width: `${(x.valeur / total) * 100}%`, background: x.couleur }} />)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: FONT.xs.size + 1, color: T.textSub }}>
        {segments.filter((x) => x.valeur > 0).map((x) => <span key={x.libelle}><span style={{ display: "inline-block", width: 9, height: 9, background: x.couleur, borderRadius: 2, marginRight: 5 }} />{x.libelle} {eur(x.valeur)} ({Math.round((x.valeur / total) * 100)} %)</span>)}
      </div>
    </div>
  );
}

const COLONNES_SWOT = [
  ["forces", "Forces", SU], ["faiblesses", "Faiblesses", WA], ["risques", "Risques", DA], ["opportunites", "Opportunités", "#4db8ff"],
];

export function DiagnosticAuto({ T, data, onChange, onInsererSynthese, diagnosticRedige }) {
  const hyp = { ...HYPOTHESES_PAR_DEFAUT, ...(data.hypotheses_diagnostic || {}) };
  const ops = Array.isArray(data.operations_envisagees) ? data.operations_envisagees : [];
  const s = situation(data);
  const sw = analyserSwot(data, hyp);
  const tr = trajectoireCapacite(data, ops, hyp);
  const setHyp = (k, v) => onChange("hypotheses_diagnostic", { ...(data.hypotheses_diagnostic || {}), [k]: num(v) ?? "" });
  const majOp = (i, p) => onChange("operations_envisagees", ops.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const inconnu = "non calculable";
  const lecteur = { "dans la norme": SU, limite: WA, "au-dessus du plafond": DA, [inconnu]: T.textMuted };

  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <Carte T={T} titre="Diagnostic automatique — situation actuelle"
        aide="Calculé à partir des données saisies, avant impôt, à titre indicatif. Une donnée manquante s'affiche « non calculable » : elle n'est jamais comptée comme zéro."
        action={<button className="inv-btn inv-btn-sm" onClick={() => onInsererSynthese(texteSynthese(data, hyp))}><Icon as={Copy} size={12} />{String(diagnosticRedige || "").trim() ? "Ajouter à la fin du diagnostic rédigé" : "Recopier dans le diagnostic rédigé"}</button>}>
        <div style={GRILLE}>
          <Puce T={T} label="Patrimoine brut" valeur={eur(s.patrimoineBrut)} />
          <Puce T={T} label="Dettes" valeur={eur(s.dettes)} />
          <Puce T={T} label="Patrimoine net" valeur={eur(s.patrimoineNet)} ton={s.patrimoineNet < 0 ? DA : undefined} />
          <Puce T={T} label="Liquidités" valeur={eur(s.liquidites)} />
          <Puce T={T} label="Part de l'immobilier" valeur={pc(s.composition.partImmobilier)} />
          <Puce T={T} label="Revenus récurrents / an" valeur={eur(s.revenusAnnuelsRecurrents)} />
          <Puce T={T} label="Épargne réelle / an" valeur={eur(s.epargneAnnuelle)} />
          <Puce T={T} label="Cash-flow immobilier / mois" valeur={s.biensIncomplets ? `${eur(s.cashflowImmobilierMois)} (partiel)` : eur(s.cashflowImmobilierMois)} ton={s.biensIncomplets ? WA : undefined} />
          <Puce T={T} label="TMI" valeur={s.tmi || "non renseignée"} />
        </div>
        {s.nonCompte.length > 0 && <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: WA }}>Non compté dans le patrimoine brut (comme dans le bilan) : {s.nonCompte.join(", ")}.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: SPACING.md, marginTop: SPACING.md }}>
          <div><div style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textMuted, marginBottom: 4 }}>Composition du patrimoine</div>
            <BarreRepartition T={T} segments={[{ libelle: "Immobilier", valeur: s.composition.immobilier, couleur: "#c9a14f" }, { libelle: "Financier", valeur: s.composition.financier, couleur: "#4db8ff" }, { libelle: "Liquidités", valeur: s.composition.liquidites, couleur: SU }]} /></div>
          <div><div style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textMuted, marginBottom: 4 }}>Répartition des dettes</div>
            <BarreRepartition T={T} segments={s.repartitionDettes.map((x, i) => ({ libelle: x.libelle, valeur: x.montant, couleur: ["#dc2626", "#d97706", "#7c3aed"][i % 3] }))} /></div>
        </div>
      </Carte>

      <Carte T={T} titre="Forces, faiblesses, risques, opportunités" aide="Chaque ligne porte le chiffre qui la justifie. Ce sont des repères de lecture à discuter avec le client, pas des conclusions : les sujets juridiques et fiscaux sont à valider avec le notaire et l'expert-comptable.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: SPACING.md }}>
          {COLONNES_SWOT.map(([cle, titre, couleur]) => (
            <div key={cle} style={{ borderTop: `3px solid ${couleur}`, background: T.input, borderRadius: RADIUS.md, padding: "10px 12px" }}>
              <div style={{ fontWeight: 900, color: couleur, marginBottom: 6 }}>{titre} <span style={{ color: T.textMuted }}>{sw[cle].length}</span></div>
              {sw[cle].length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Rien à signaler avec les données saisies.</div>}
              {sw[cle].map((x, i) => <div key={i} style={{ padding: "5px 0", borderTop: i ? `1px solid ${T.rowBorder || T.border}` : "none" }}><div style={{ fontWeight: 800, color: T.text, fontSize: FONT.sm.size + 1 }}>{x.titre}</div><div style={{ color: T.textSub, fontSize: FONT.xs.size + 1 }}>{x.detail}</div></div>)}
            </div>
          ))}
        </div>
      </Carte>

      <Carte T={T} titre="Capacité d'emprunt en trajectoire"
        aide="Plutôt qu'un chiffre unique : où en est la capacité aujourd'hui, puis après chaque opération envisagée. L'objectif n'est pas « combien pouvez-vous emprunter » mais « comment continuer à investir ». La banque retient une part des loyers ; hypothèses modifiables ci-dessous."
        action={<button className="inv-btn inv-btn-sm" onClick={() => onChange("operations_envisagees", [...ops, { id: nouvelId(), libelle: "", prix: "", apport: "", taux: "", duree: "", loyer_mois: "" }])}><Icon as={Plus} size={12} />Ajouter une opération</button>}>
        <div style={{ ...GRILLE, marginBottom: SPACING.sm }}>
          {[["plafondEndettement", "Plafond d'endettement (%)"], ["tauxCredit", "Taux du crédit (%)"], ["dureeCredit", "Durée (années)"], ["assuranceEmprunteur", "Assurance emprunteur (%/an)"], ["loyersRetenusBanque", "Loyers retenus (%)"]].map(([k, l]) => (
            <label key={k}><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{l}</span>
              <input className="inv-inp" type="number" value={hyp[k]} onChange={(e) => setHyp(k, e.target.value)} style={{ width: "100%" }} /></label>
          ))}
        </div>
        {ops.map((o, i) => (
          <div key={o.id || i} style={{ ...GRILLE, gridTemplateColumns: "minmax(0,1.3fr) repeat(5,110px) auto", alignItems: "end", padding: "6px 0" }}>
            {[["libelle", "Opération " + (i + 1), "text"], ["prix", "Prix (€)", "number"], ["apport", "Apport (€)", "number"], ["taux", "Taux (%)", "number"], ["duree", "Durée (ans)", "number"], ["loyer_mois", "Loyer attendu (€/mois)", "number"]].map(([k, l, t]) => (
              <label key={k}><span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{l}</span>
                <input className="inv-inp" type={t} value={o[k] ?? ""} onChange={(e) => majOp(i, { [k]: e.target.value })} style={{ width: "100%", textAlign: t === "text" ? "left" : "right" }} /></label>
            ))}
            <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => onChange("operations_envisagees", ops.filter((_, j) => j !== i))} aria-label="Retirer"><Icon as={Trash2} size={11} /></button>
          </div>
        ))}
        <div style={{ overflowX: "auto", marginTop: SPACING.sm }}>
          <table className="inv-table" style={{ width: "100%", minWidth: 760 }}>
            <thead><tr><th>Étape</th><th>Revenus retenus / mois</th><th>Mensualités / mois</th><th>Endettement</th><th>Marge mensuelle</th><th>Capital empruntable</th><th>Lecture</th></tr></thead>
            <tbody>{tr.etapes.map((e, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 800 }}>{e.libelle}{e.incomplete && <span style={{ color: WA }}> (incomplète : {e.motif})</span>}</td>
                <td>{eur(e.revenusRetenus)}</td><td>{eur(e.mensualitesTotal)}</td><td>{pc(e.tauxEndettement)}</td>
                <td>{eur(e.mensualiteDisponible)}</td><td>{eur(e.capitalEmpruntable)}</td>
                <td style={{ fontWeight: 800, color: lecteur[e.lecture] }}>{e.lecture}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Estimation indicative avant impôt, hors frais de notaire et de garantie. Le capital empruntable suppose le taux et la durée ci-dessus. Non contractuel : la décision appartient à la banque.</div>
      </Carte>
    </div>
  );
}
