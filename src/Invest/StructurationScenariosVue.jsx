// src/Invest/StructurationScenariosVue.jsx — Scénarios chiffrés, projection 5/10/20 ans, tests de résistance (lot 3).
// Les calculs viennent de structurationProjection.mjs ; ici on saisit et on affiche.
import React, { useState, useMemo } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { Plus, Trash2 } from "lucide-react";
import { SU, WA, DA } from "./_shared";
import {
  CAS, LIBELLES_CAS, LIBELLES_HYPOTHESES, HYPOTHESES_CAS_PAR_DEFAUT, HYPOTHESES_GLOBALES_PAR_DEFAUT,
  projeter, comparerScenarios, testsResistance, jalons, operationComplete,
} from "./structurationProjection.mjs";

const eur = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`);
const nouvelId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const COULEURS_CAS = { prudent: "#d97706", central: "#4db8ff", degrade: "#dc2626" };

function Carte({ T, titre, aide, action, children }) {
  return (
    <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 6, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>{titre}</h3>{action}
      </div>
      {aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: SPACING.sm, maxWidth: 880 }}>{aide}</div>}
      {children}
    </section>
  );
}
const Entree = ({ T, label, value, onChange, type = "number", width }) => (
  <label style={{ display: "block", minWidth: 0, width }}>
    <span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{label}</span>
    <input className="inv-inp" type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", textAlign: type === "text" ? "left" : "right" }} />
  </label>
);

function Courbe({ T, series, horizon }) {
  const W = 640, Ht = 190, pad = 34;
  const toutes = series.flatMap((s) => s.valeurs);
  const min = Math.min(0, ...toutes), max = Math.max(1, ...toutes);
  const x = (k) => pad + (k / horizon) * (W - pad - 10);
  const y = (v) => Ht - 22 - ((v - min) / (max - min || 1)) * (Ht - 40);
  return (
    <svg viewBox={`0 0 ${W} ${Ht}`} style={{ width: "100%", maxWidth: 720, height: "auto" }} role="img" aria-label="Patrimoine net projeté dans les trois cas">
      <line x1={pad} y1={y(0)} x2={W - 10} y2={y(0)} stroke={T.border} strokeDasharray="3 3" />
      {[0, 5, 10, 20].filter((k) => k <= horizon).map((k) => <text key={k} x={x(k)} y={Ht - 5} fontSize="11" fill={T.textMuted} textAnchor="middle">{k === 0 ? "auj." : `${k} ans`}</text>)}
      <text x={4} y={y(max) + 4} fontSize="11" fill={T.textMuted}>{eur(max)}</text>
      {series.map((s) => <polyline key={s.cas} fill="none" stroke={COULEURS_CAS[s.cas]} strokeWidth="2.2" points={s.valeurs.map((v, k) => `${x(k)},${y(v)}`).join(" ")} />)}
    </svg>
  );
}

export function ScenariosProjection({ T, data, onChange }) {
  const scenarios = useMemo(() => (Array.isArray(data.scenarios_chiffres) ? data.scenarios_chiffres : []), [data.scenarios_chiffres]);
  const surcharges = useMemo(() => data.hypotheses_projection || {}, [data.hypotheses_projection]);
  const [cas, setCas] = useState("central");
  const [horizon, setHorizon] = useState(10);
  const [choisi, setChoisi] = useState("actuel");
  const [hypOuvert, setHypOuvert] = useState(false);
  const anneeDepart = new Date().getFullYear();

  const selection = scenarios.find((s) => s.id === choisi);
  const operations = selection ? (selection.operations || []) : [];
  const comparaison = useMemo(() => comparerScenarios(data.collecte ? data : { collecte: {} }, scenarios, { cas, horizon, anneeDepart, surcharges }), [data, scenarios, cas, horizon, anneeDepart, surcharges]);
  const projections = useMemo(() => CAS.map((c) => ({ cas: c, p: projeter(data, { operations, cas: c, anneeDepart, surcharges, horizon: 20 }) })), [data, operations, anneeDepart, surcharges]);
  const tests = useMemo(() => testsResistance(data, { operations, anneeDepart, surcharges }), [data, operations, anneeDepart, surcharges]);

  const sauver = (liste) => onChange("scenarios_chiffres", liste);
  const majScenario = (id, p) => sauver(scenarios.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const majOp = (id, i, p) => sauver(scenarios.map((s) => (s.id === id ? { ...s, operations: s.operations.map((o, j) => (j === i ? { ...o, ...p } : o)) } : s)));
  const setHyp = (portee, cle, valeur, c) => {
    const base = { ...surcharges, parCas: { ...(surcharges.parCas || {}) }, globales: { ...(surcharges.globales || {}) } };
    if (portee === "cas") base.parCas[c] = { ...(base.parCas[c] || {}), [cle]: valeur };
    else base.globales[cle] = valeur;
    onChange("hypotheses_projection", base);
  };
  const lignes = [
    ["Patrimoine net", "patrimoineNet"], ["Dettes", "dettes"], ["Capital remboursé (cumul)", "capitalRembourse"],
    ["Loyers encaissés / an", "loyers"], ["Cash-flow annuel du foyer", "cashflowAnnuel"], ["Liquidités", "liquidites"],
    ["Effort d'épargne maximal / an", "effortEpargneMax"], ["Liquidités au plus bas", "liquiditesMin"],
  ];
  const central = projections.find((x) => x.cas === "central").p;

  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <Carte T={T} titre="Scénarios chiffrés"
        aide="Un scénario = une suite d'opérations immobilières (année, prix, apport, financement, loyer attendu). Plutôt qu'une recommandation unique, comparez plusieurs trajectoires : le client comprend pourquoi l'une est préférable pour ses objectifs. Les chiffres sont avant impôt."
        action={<button className="inv-btn inv-btn-sm" onClick={() => { const id = nouvelId(); sauver([...scenarios, { id, nom: `Scénario ${scenarios.length + 1}`, operations: [] }]); setChoisi(id); }}><Icon as={Plus} size={12} />Ajouter un scénario</button>}>
        {scenarios.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun scénario. « Situation actuelle » (sans nouvelle opération) sert toujours de référence.</div>}
        {scenarios.map((s) => (
          <div key={s.id} style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 6 }}>
              <div style={{ flex: 1 }}><Entree T={T} label="Nom du scénario" type="text" value={s.nom} onChange={(v) => majScenario(s.id, { nom: v })} /></div>
              <button className="inv-btn inv-btn-sm" onClick={() => majScenario(s.id, { operations: [...(s.operations || []), { id: nouvelId(), annee: String(anneeDepart), libelle: "", prix: "", apport: "", travaux: "", taux: "", duree: "", loyer_mois: "", charges_pct: "" }] })}><Icon as={Plus} size={12} />Opération</button>
              <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => { if (window.confirm(`Supprimer « ${s.nom} » ?`)) { sauver(scenarios.filter((x) => x.id !== s.id)); if (choisi === s.id) setChoisi("actuel"); } }} aria-label="Supprimer le scénario"><Icon as={Trash2} size={11} /></button>
            </div>
            {(s.operations || []).map((o, i) => (
              <div key={o.id || i} style={{ display: "grid", gridTemplateColumns: "80px minmax(0,1.2fr) repeat(7,minmax(70px,1fr)) auto", gap: 6, alignItems: "end", padding: "3px 0" }}>
                <Entree T={T} label="Année" value={o.annee} onChange={(v) => majOp(s.id, i, { annee: v })} />
                <Entree T={T} label="Opération" type="text" value={o.libelle} onChange={(v) => majOp(s.id, i, { libelle: v })} />
                <Entree T={T} label="Prix (€)" value={o.prix} onChange={(v) => majOp(s.id, i, { prix: v })} />
                <Entree T={T} label="Apport (€)" value={o.apport} onChange={(v) => majOp(s.id, i, { apport: v })} />
                <Entree T={T} label="Travaux (€)" value={o.travaux} onChange={(v) => majOp(s.id, i, { travaux: v })} />
                <Entree T={T} label="Taux (%)" value={o.taux} onChange={(v) => majOp(s.id, i, { taux: v })} />
                <Entree T={T} label="Durée (ans)" value={o.duree} onChange={(v) => majOp(s.id, i, { duree: v })} />
                <Entree T={T} label="Loyer (€/mois)" value={o.loyer_mois} onChange={(v) => majOp(s.id, i, { loyer_mois: v })} />
                <Entree T={T} label="Charges (% loyers)" value={o.charges_pct} onChange={(v) => majOp(s.id, i, { charges_pct: v })} />
                <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => majScenario(s.id, { operations: s.operations.filter((_, j) => j !== i) })} aria-label="Retirer l'opération"><Icon as={Trash2} size={11} /></button>
              </div>
            ))}
            {(s.operations || []).some((o) => !operationComplete(o)) && <div style={{ fontSize: FONT.xs.size + 1, color: WA, marginTop: 4 }}>Une opération sans prix ou sans année est ignorée dans les calculs.</div>}
          </div>
        ))}
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 6 }}>L'apport inclut les frais d'acquisition. Les travaux sont payés comptant l'année d'achat et n'augmentent pas la valeur du bien (position prudente). Taux, durée et charges vides : valeurs des hypothèses.</div>
      </Carte>

      <Carte T={T} titre="Comparaison des trajectoires"
        action={<span style={{ display: "inline-flex", gap: 8 }}>
          <select className="inv-sel" value={cas} onChange={(e) => setCas(e.target.value)} aria-label="Cas">{CAS.map((c) => <option key={c} value={c}>Cas {LIBELLES_CAS[c].toLowerCase()}</option>)}</select>
          <select className="inv-sel" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} aria-label="Horizon">{[5, 10, 20].map((h) => <option key={h} value={h}>À {h} ans</option>)}</select>
        </span>}
        aide="Le même dossier, projeté avec chaque scénario, dans le cas et à l'horizon choisis. Sur toutes les lignes, lisez d'abord « liquidités au plus bas » : une trajectoire qui épuise la trésorerie n'est pas tenable, quel que soit son patrimoine final.">
        <div style={{ overflowX: "auto" }}>
          <table className="inv-table" style={{ width: "100%", minWidth: 560 }}>
            <thead><tr><th></th>{comparaison.map((c) => <th key={c.id}>{c.nom}</th>)}</tr></thead>
            <tbody>
              {lignes.map(([titre, cle]) => (
                <tr key={cle}><td style={{ fontWeight: 800 }}>{titre}</td>{comparaison.map((c) => <td key={c.id} style={{ color: (cle === "liquiditesMin" || cle === "liquidites") && c[cle] < 0 ? DA : undefined, fontWeight: cle === "patrimoineNet" ? 900 : 500 }}>{eur(c[cle])}</td>)}</tr>
              ))}
              <tr><td style={{ fontWeight: 800 }}>Tenable ?</td>{comparaison.map((c) => <td key={c.id} style={{ fontWeight: 800, color: c.anneeInsuffisance ? DA : SU }}>{c.anneeInsuffisance ? `Non — liquidités négatives dès ${c.anneeInsuffisance}` : "Oui"}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Carte>

      <Carte T={T} titre="Projection patrimoniale : prudent, central, dégradé"
        action={<select className="inv-sel" value={choisi} onChange={(e) => setChoisi(e.target.value)} aria-label="Scénario projeté"><option value="actuel">Situation actuelle</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select>}
        aide="Patrimoine net projeté sur 20 ans dans les trois cas. L'écart entre les courbes mesure la sensibilité de la stratégie aux hypothèses.">
        <Courbe T={T} horizon={20} series={projections.map(({ cas: c, p }) => ({ cas: c, valeurs: p.annees.map((a) => a.patrimoineNet) }))} />
        <div style={{ display: "flex", gap: 14, fontSize: FONT.xs.size + 1, color: T.textSub, marginBottom: 8 }}>{CAS.map((c) => <span key={c}><span style={{ display: "inline-block", width: 10, height: 3, background: COULEURS_CAS[c], marginRight: 5, verticalAlign: "middle" }} />{LIBELLES_CAS[c]}</span>)}</div>
        <div style={{ overflowX: "auto" }}>
          <table className="inv-table" style={{ width: "100%", minWidth: 640 }}>
            <thead><tr><th>Cas</th><th>Échéance</th><th>Valeur immobilière</th><th>Dettes</th><th>Patrimoine net</th><th>Loyers / an</th><th>Cash-flow / an</th><th>Liquidités</th></tr></thead>
            <tbody>{projections.flatMap(({ cas: c, p }) => jalons(p).map((j) => (
              <tr key={c + j.ans}>{j.indisponible ? <td colSpan={8}>—</td> : <>
                <td style={{ fontWeight: 800, color: COULEURS_CAS[c] }}>{LIBELLES_CAS[c]}</td><td>{j.ans} ans ({j.annee})</td><td>{eur(j.valeurImmobilier)}</td><td>{eur(j.dettes)}</td>
                <td style={{ fontWeight: 900 }}>{eur(j.patrimoineNet)}</td><td>{eur(j.loyersEncaisses)}</td><td>{eur(j.cashflow)}</td><td style={{ color: j.liquidites < 0 ? DA : undefined }}>{eur(j.liquidites)}</td></>}</tr>
            )))}</tbody>
          </table>
        </div>
        {central.alertes.map((a, i) => <div key={i} style={{ marginTop: 6, color: DA, fontWeight: 800, fontSize: FONT.sm.size }}>{a}</div>)}
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: T.textMuted, fontSize: FONT.xs.size + 1 }}>{central.limites.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </Carte>

      <Carte T={T} titre="Tests de résistance"
        aide="Que se passe-t-il si les hypothèses ne se réalisent pas ? Pour le scénario projeté ci-dessus, cas central, sur les 5 premières années : le foyer garde-t-il assez de trésorerie pour continuer à rembourser ?">
        <div style={{ marginBottom: 6, fontSize: FONT.sm.size, color: T.textSub }}>Référence : liquidités au plus bas <b style={{ color: T.text }}>{eur(tests.reference.liquiditesMin)}</b>, pire cash-flow annuel <b style={{ color: T.text }}>{eur(tests.reference.pireCashflow)}</b>.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="inv-table" style={{ width: "100%", minWidth: 640 }}>
            <thead><tr><th>Choc</th><th>Liquidités au plus bas</th><th>Écart vs référence</th><th>Pire cash-flow / an</th><th>Patrimoine net à 5 ans</th><th>La trésorerie tient-elle ?</th></tr></thead>
            <tbody>{tests.chocs.map((c) => (
              <tr key={c.cle}><td style={{ fontWeight: 800 }}>{c.libelle}</td><td style={{ color: c.liquiditesMin < 0 ? DA : undefined }}>{eur(c.liquiditesMin)}</td>
                <td>{eur(c.ecartLiquiditesMin)}</td><td>{eur(c.pireCashflow)}</td><td>{eur(c.patrimoineNetFin)}</td>
                <td style={{ fontWeight: 800, color: c.tient ? SU : DA }}>{c.tient ? "Oui" : `Non — dès ${c.anneeInsuffisance}`}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Carte>

      <Carte T={T} titre="Hypothèses utilisées" action={<button className="inv-btn inv-btn-sm" onClick={() => setHypOuvert((o) => !o)}>{hypOuvert ? "Masquer" : "Voir et modifier"}</button>}
        aide="Valeurs de départ choisies pour être raisonnables et prudentes : ce ne sont pas des données de marché. À adapter à la date de l'étude et au territoire, et à faire figurer dans le rapport remis au client.">
        {hypOuvert && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="inv-table" style={{ width: "100%", minWidth: 520 }}>
                <thead><tr><th>Hypothèse</th>{CAS.map((c) => <th key={c} style={{ color: COULEURS_CAS[c] }}>{LIBELLES_CAS[c]}</th>)}</tr></thead>
                <tbody>{Object.keys(LIBELLES_HYPOTHESES).map((k) => (
                  <tr key={k}><td>{LIBELLES_HYPOTHESES[k]}</td>{CAS.map((c) => (
                    <td key={c}><input className="inv-inp" type="number" style={{ width: 90, textAlign: "right" }} value={surcharges.parCas?.[c]?.[k] ?? HYPOTHESES_CAS_PAR_DEFAUT[c][k]} onChange={(e) => setHyp("cas", k, e.target.value, c)} /></td>))}</tr>))}</tbody>
              </table>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: SPACING.sm }}>
              {[["tauxCredit", "Taux des crédits (%)"], ["assuranceEmprunteur", "Assurance emprunteur (%/an)"], ["chargesOperationPct", "Charges d'une opération (% des loyers)"], ["dureeResiduelleRP", "Durée résiduelle du prêt de la résidence principale (ans)"]].map(([k, l]) => (
                <Entree key={k} T={T} label={l} value={surcharges.globales?.[k] ?? HYPOTHESES_GLOBALES_PAR_DEFAUT[k]} onChange={(v) => setHyp("globales", k, v)} />))}
            </div>
          </>
        )}
      </Carte>
    </div>
  );
}
