// PageOperations — la fiche « Opération » : le pendant de la fiche Chantier à
// l'échelle d'une opération (immeuble / programme de plusieurs logements).
//
// Une opération = un item du référentiel planning_config/operations (Réglages →
// Opérations) ; ses logements = les chantiers dont operation_id pointe dessus.
//
// RÈGLE DE CALCUL : aucun chiffre nouveau. Chaque chantier passe par
// computeChantierFinance (le MÊME module que Phasage / fiche Chantier / Bilan
// semaine), puis la page SOMME les scalaires `brut`. L'avancement de
// l'opération est pondéré par le vendu HT de chaque logement (jamais une
// moyenne simple). Le diagramme financier réutilise seriesReellesChantier +
// consoliderSeries (diagrammeFinancier.mjs) + DiagrammeFinancierChart —
// exactement comme le consolidé entreprise de DashboardAnalyse.
//
// Performance : tout est chargé en UNE passe au montage (Promise.all +
// regroupement côté client), avec pagination sur pointages / commande_lignes
// (la limite Supabase de 1 000 lignes tronquerait les gros volumes). Changer
// d'opération ne recharge rien.
import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { supabase } from "../supabase";
import { loadOperations, FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { CARD_SHADOW, SummaryBar } from "../mobileUI";
import { computeChantierFinance, eur, fmtH, couleurMarge } from "../chantierFinance";
import { seriesReellesChantier, consoliderSeries, fusionnerSeriesPourGraphe } from "./diagrammeFinancier";
import { loadReferencesFinancieres } from "./referenceFinanciere";
import { KpiCard } from "./chantierFinanceUI";
import {
  Building2, ArrowLeft, MapPin, HardHat, Wallet, Clock, Package, Receipt,
  TrendingUp, TrendingDown, Settings, ExternalLink, Banknote,
} from "lucide-react";

// recharts reste dans son chunk dédié (même règle que la fiche Chantier).
const DiagrammeFinancierChart = React.lazy(() => import("./DiagrammeFinancierChart"));

const STATUTS = {
  en_cours: { label: "En cours",  color: "#FFC300", bg: "rgba(255,195,0,0.15)"  },
  termine:  { label: "Terminé",   color: "#22c55e", bg: "rgba(34,197,94,0.15)"  },
  planifie: { label: "Planifié",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  en_pause: { label: "En pause",  color: "#f97316", bg: "rgba(249,115,22,0.15)" },
};

function ProgressBar({ value, color, height = 6 }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div style={{ width: "100%", height, borderRadius: height, background: "rgba(128,128,128,0.2)", overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${pct}%`, borderRadius: height,
        background: pct >= 100 ? "#22c55e" : (color || "#FFC300"),
        transition: "width .4s ease",
      }}/>
    </div>
  );
}

// Pagination Supabase : au-delà de 1 000 lignes une requête simple TRONQUE en
// silence — même garde-fou que Bilan semaine.
async function fetchTout(table, select) {
  const PAGE = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) return { data: out, error: null };
    from += PAGE;
  }
}

// Somme des scalaires `brut` des logements d'une opération. L'avancement est
// pondéré par le vendu HT (un studio à 20 k€ ne pèse pas comme un T4 à 80 k€).
function agregerOperation(chantiersOp, finParChantier) {
  const t = {
    nbChantiers: chantiersOp.length, nbAvecPhasage: 0,
    vendu: 0, moReel: 0, mat: 0, fg: 0, marge: 0,
    moPrev: 0, matPrev: 0, margePrev: 0,
    hVendues: 0, hReelles: 0,
    avNum: 0, avDen: 0,
    statuts: {},
  };
  chantiersOp.forEach((c) => {
    const statut = STATUTS[c.statut] ? c.statut : "en_cours";
    t.statuts[statut] = (t.statuts[statut] || 0) + 1;
    const f = finParChantier[c.id];
    if (!f) return;
    const b = f.finance.brut;
    t.nbAvecPhasage++;
    t.vendu    += b.prixHTChantier || 0;
    t.moReel   += b.coutMOTotalChantier || 0;
    t.mat      += b.coutMatChantier || 0;
    t.fg       += b.fgChantier || 0;
    t.marge    += b.margeChantier || 0;
    t.moPrev   += b.moPrevChantier || 0;
    t.matPrev  += b.commandesPrevChantier || 0;
    t.margePrev += b.margePrevChantier || 0;
    t.hVendues += b.heuresVenduesChantier || 0;
    t.hReelles += b.heuresReellesTotalChantier || 0;
    const poids = b.prixHTChantier || 0;
    t.avNum += (b.avancementChantier || 0) * poids;
    t.avDen += poids;
  });
  t.avancement = t.avDen > 0 ? Math.round(t.avNum / t.avDen) : 0;
  t.margePct = t.vendu > 0 ? (t.marge / t.vendu) * 100 : null;
  t.margePrevPct = t.vendu > 0 ? (t.margePrev / t.vendu) * 100 : null;
  return t;
}

const pctTxt = (p) => (p == null ? "—" : `${p.toFixed(1)} %`);

export default function PageOperations({ chantiers = [], T, branch = "renovation", onOpenChantier, onOuvrirAdmin }) {
  const acc = getBranchAccent(branch);
  const [operations, setOperations] = useState(null); // null = chargement
  const [etat, setEtat] = useState({ charge: false, phasages: [], ptsByChantier: {}, clByChantier: {}, cfg: {}, refsParChantier: {}, erreurs: [] });
  const [opId, setOpId] = useState(() => localStorage.getItem("operations_selected") || null);
  const [periode, setPeriode] = useState("12");
  const [masques, setMasques] = useState({});
  const grapheRef = useRef(null);

  // ── Chargement : une passe pour toutes les opérations ──
  useEffect(() => {
    let actif = true;
    (async () => {
      const erreurs = [];
      const [ops, phRes, ptsRes, clRes, cfgRes] = await Promise.all([
        loadOperations(),
        // select("*") volontaire : évite d'échouer si une colonne manque dans
        // le schéma de cette instance (même précaution que la fiche Chantier).
        supabase.from("phasages").select("*"),
        fetchTout("pointages", "*"),
        fetchTout("commande_lignes",
          "id, quantite, prix_unitaire, prix_total, materiau_id, ouvrage_id, chantier_id, created_at, commande:commandes(date_doc, created_at)"),
        supabase.from("planning_config").select("key,value").in("key", ["taux_horaires", "taux_mo_previsionnel", "etats_financiers", "lots_travaux"]),
      ]);
      [["phasages", phRes], ["pointages", ptsRes], ["lignes de commande", clRes], ["réglages", cfgRes]]
        .forEach(([nom, r]) => { if (r.error) erreurs.push(`${nom} : ${r.error.message}`); });

      // Un phasage par chantier : le plus récent (même règle que le cron snapshot).
      const parChantier = {};
      (phRes.data || []).forEach((ph) => {
        const cur = parChantier[ph.chantier_id];
        if (!cur || String(ph.updated_at || "") > String(cur.updated_at || "")) parChantier[ph.chantier_id] = ph;
      });
      const phasages = Object.values(parChantier).filter((ph) => (ph.ouvrages || []).length > 0);

      const ptsByChantier = {};
      (ptsRes.data || []).forEach((p) => { (ptsByChantier[p.chantier_id] ||= []).push(p); });
      const clByChantier = {};
      (clRes.data || []).forEach((l) => { (clByChantier[l.chantier_id] ||= []).push(l); });
      const cfg = Object.fromEntries((cfgRes.data || []).map((r) => [r.key, r.value]));

      const refsRes = await loadReferencesFinancieres(phasages.map((ph) => ph.chantier_id));
      if (refsRes.erreur) erreurs.push(`références figées : ${refsRes.erreur}`);

      if (!actif) return;
      setOperations(ops || []);
      setEtat({ charge: true, phasages, ptsByChantier, clByChantier, cfg, refsParChantier: refsRes.parChantier || {}, erreurs });
    })();
    return () => { actif = false; };
  }, []);

  // ── Finance par chantier (uniquement les chantiers rattachés à une opération) ──
  const finParChantier = useMemo(() => {
    if (!etat.charge) return {};
    const rattaches = new Set(chantiers.filter((c) => c.operation_id).map((c) => c.id));
    const tauxHoraires = etat.cfg.taux_horaires || {};
    const tauxMOPrev = parseFloat(etat.cfg.taux_mo_previsionnel) || 0;
    const etatsFinanciers = etat.cfg.etats_financiers || null;
    const lots = etat.cfg.lots_travaux?.items || [];
    const out = {};
    etat.phasages.forEach((ph) => {
      if (!rattaches.has(ph.chantier_id)) return;
      const pointages = etat.ptsByChantier[ph.chantier_id] || [];
      const commandeLignes = etat.clByChantier[ph.chantier_id] || [];
      const finance = computeChantierFinance({ phasage: ph, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots });
      const reelles = seriesReellesChantier({
        finance, pointages, commandeLignes, etatsFinanciers,
        chantierNom: ph.chantier_nom || ph.chantier_id,
      });
      out[ph.chantier_id] = { finance, reelles, reference: etat.refsParChantier[ph.chantier_id]?.series || null };
    });
    return out;
  }, [etat, chantiers]);

  // ── Agrégats par opération (l'ordre des logements = l'ordre global des
  //    chantiers dans Réglages, le même que suit le Chemin de fer) ──
  const parOperation = useMemo(() => {
    return (operations || []).map((op) => {
      const chantiersOp = chantiers.filter((c) => c.operation_id === op.id);
      return { op, chantiersOp, agg: agregerOperation(chantiersOp, finParChantier) };
    });
  }, [operations, chantiers, finParChantier]);

  const sansOperation = useMemo(() => chantiers.filter((c) => !c.operation_id).length, [chantiers]);

  const selection = opId ? parOperation.find((e) => e.op.id === opId) : null;

  const ouvrirOp = (id) => {
    setOpId(id);
    localStorage.setItem("operations_selected", id || "");
  };

  const bg = T.bg, text = T.text, textSub = T.textSub, textMuted = T.textMuted, border = T.border;
  const selectStyle = {
    padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`,
    background: T.inputBg || T.surface, color: text, fontFamily: "inherit", fontSize: 12.5, outline: "none",
  };

  const bandeauErreurs = etat.erreurs.length > 0 && (
    <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(225,90,90,.12)",
      border: "1px solid rgba(225,90,90,.4)", fontSize: 12.5, color: "#e15a5a", fontWeight: 600 }}>
      Sources en erreur (les chiffres ci-dessous sont incomplets) : {etat.erreurs.join(" — ")}
    </div>
  );

  // ─── VUE LISTE ──────────────────────────────────────────────────────────────
  if (!selection) {
    const totaux = parOperation.reduce((s, e) => ({ vendu: s.vendu + e.agg.vendu, marge: s.marge + e.agg.marge }), { vendu: 0, marge: 0 });
    return (
      <div className="pops-list" style={{ flex: 1, overflowY: "auto", background: bg, padding: "28px 32px" }}>
        <style>{`
          .operation-card { transition: all .18s; cursor: pointer; }
          .operation-card:hover { transform: translateY(-3px); box-shadow: 0 16px 34px rgba(16,24,40,0.14); border-color: ${acc.border} !important; }
          @media(max-width:768px) { .operations-grid { grid-template-columns: 1fr !important; } .pops-list { padding: 14px 12px !important; } }
        `}</style>

        <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Building2} size={20} strokeWidth={2}/>
          </div>
          <div>
            <h1 style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>Opérations</h1>
            <p style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3 }}>
              {(operations || []).length} opération{(operations || []).length > 1 ? "s" : ""} · {chantiers.filter((c) => c.operation_id).length} logement{chantiers.filter((c) => c.operation_id).length > 1 ? "s" : ""} rattaché{chantiers.filter((c) => c.operation_id).length > 1 ? "s" : ""}
              {sansOperation > 0 ? ` · ${sansOperation} chantier${sansOperation > 1 ? "s" : ""} hors opération` : ""}
            </p>
          </div>
        </div>

        {bandeauErreurs && <div style={{ marginBottom: 14 }}>{bandeauErreurs}</div>}

        {operations === null || !etat.charge ? (
          <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>Chargement…</div>
        ) : (operations.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
            <div style={{ fontSize: FONT.base.size, fontWeight: 600, marginBottom: 10 }}>Aucune opération pour le moment.</div>
            <div style={{ fontSize: FONT.sm.size, marginBottom: 16 }}>Les opérations se créent dans Réglages → Opérations, puis chaque chantier s'y rattache.</div>
            {onOuvrirAdmin && (
              <button onClick={onOuvrirAdmin} style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
                borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10,
                color: acc.accent, fontWeight: 700, fontSize: FONT.sm.size, cursor: "pointer", fontFamily: "inherit",
              }}>
                <Icon as={Settings} size={15}/> Ouvrir les Réglages
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>
              <SummaryBar T={T} items={[
                { label: "Opérations", value: operations.length,  color: acc.accent, icon: Building2 },
                { label: "Vendu HT",   value: eur(totaux.vendu),  color: "#5b8af5",  icon: Wallet },
                { label: "Marge nette", value: eur(totaux.marge), color: totaux.marge >= 0 ? "#22c55e" : "#e15a5a", icon: totaux.marge >= 0 ? TrendingUp : TrendingDown },
              ]}/>
            </div>

            <div className="operations-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
              {parOperation.map(({ op, chantiersOp, agg }) => (
                <div key={op.id} className="operation-card" onClick={() => ouvrirOp(op.id)} style={{
                  background: T.surface, border: `1px solid ${border}`, borderRadius: 16,
                  boxShadow: CARD_SHADOW, overflow: "hidden",
                }}>
                  <div style={{ height: 5, background: op.couleur || "#888" }}/>
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: text, letterSpacing: -0.2 }}>{op.nom}</div>
                        {op.adresse && (
                          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                            <Icon as={MapPin} size={11}/> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{op.adresse}</span>
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: FONT.xs.size, fontWeight: 700, padding: "3px 10px", borderRadius: RADIUS.pill,
                        background: acc.bg10, color: acc.accent, whiteSpace: "nowrap", flexShrink: 0,
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}>
                        <Icon as={HardHat} size={11}/> {chantiersOp.length} logement{chantiersOp.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    {chantiersOp.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {Object.entries(agg.statuts).map(([sId, n]) => {
                          const s = STATUTS[sId];
                          return (
                            <span key={sId} style={{
                              fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: RADIUS.pill,
                              color: s.color, background: s.bg, border: `1px solid ${s.color}40`,
                            }}>{n} {s.label.toLowerCase()}</span>
                          );
                        })}
                      </div>
                    )}

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.xs.size + 1, color: textSub, marginBottom: 5 }}>
                        <span>Avancement</span><span style={{ fontWeight: 800, color: text }}>{agg.avancement}%</span>
                      </div>
                      <ProgressBar value={agg.avancement} color={op.couleur}/>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${border}`, paddingTop: 10 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", color: textMuted }}>Vendu HT</div>
                        <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: text }}>{agg.vendu > 0 ? eur(agg.vendu) : "—"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", color: textMuted }}>Marge nette</div>
                        <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: agg.vendu > 0 ? couleurMarge(agg.marge, agg.margePct ?? 0) : textMuted }}>
                          {agg.vendu > 0 ? `${eur(agg.marge)} · ${pctTxt(agg.margePct)}` : "—"}
                        </div>
                      </div>
                    </div>

                    {agg.nbAvecPhasage < chantiersOp.length && (
                      <div style={{ fontSize: FONT.xs.size, color: textMuted, fontStyle: "italic" }}>
                        {chantiersOp.length - agg.nbAvecPhasage} logement{chantiersOp.length - agg.nbAvecPhasage > 1 ? "s" : ""} sans phasage — hors chiffres.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ))}
      </div>
    );
  }

  // ─── VUE DÉTAILLÉE ──────────────────────────────────────────────────────────
  const { op, chantiersOp, agg } = selection;
  const margeColor = agg.vendu > 0 ? couleurMarge(agg.marge, agg.margePct ?? 0) : textMuted;

  // Barre de décomposition du vendu : MO / matériaux / FG / marge. Si les coûts
  // dépassent le vendu, la base devient les coûts (la marge négative se lit
  // alors dans les KPI, pas dans la barre).
  const coutTotal = agg.moReel + agg.mat + agg.fg;
  const baseBarre = Math.max(agg.vendu, coutTotal);
  const segments = baseBarre > 0 ? [
    { label: "Coût MO",     val: agg.moReel, color: "#f5a623" },
    { label: "Matériaux",   val: agg.mat,    color: "#5b8af5" },
    { label: "Frais gén.",  val: agg.fg,     color: "#c084fc" },
    ...(agg.marge > 0 ? [{ label: "Marge", val: agg.marge, color: "#22c55e" }] : []),
  ].filter((s) => s.val > 0) : [];

  // Diagramme financier consolidé de l'opération (mêmes briques que le
  // consolidé entreprise) : un logement sans référence figée n'entre pas dans
  // les courbes de référence.
  const entrees = chantiersOp
    .filter((c) => finParChantier[c.id])
    .map((c) => ({
      chantierId: c.id, nom: c.nom,
      reelles: finParChantier[c.id].reelles,
      reference: finParChantier[c.id].reference,
    }));
  const consolide = consoliderSeries(entrees);
  const dataGraphe = (() => {
    const rows = fusionnerSeriesPourGraphe({ reelles: consolide.reelles, reference: consolide.reference });
    if (periode === "tout") return rows;
    const d = new Date(); d.setMonth(d.getMonth() - parseInt(periode, 10) + 1);
    const cutoff = d.toISOString().slice(0, 7);
    return rows.filter((r) => r.mois >= cutoff);
  })();

  const th = { textAlign: "right", padding: "8px 10px", fontWeight: 700, fontSize: FONT.xs.size, textTransform: "uppercase", letterSpacing: .6, color: textMuted, whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", textAlign: "right", fontSize: FONT.sm.size, color: textSub, whiteSpace: "nowrap" };

  return (
    <div className="pops-detail" style={{ flex: 1, overflowY: "auto", background: bg, padding: "24px 32px 40px" }}>
      <style>{`
        @media(max-width:768px) { .pops-detail { padding: 14px 12px 30px !important; } .pops-kpis { grid-template-columns: repeat(2, 1fr) !important; } }
        .pops-row-clic:hover { background: ${acc.bg10}; }
      `}</style>

      {/* ── En-tête ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <button onClick={() => ouvrirOp(null)} style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px",
          borderRadius: RADIUS.md, border: `1px solid ${border}`, background: T.surface,
          color: textSub, fontWeight: 700, fontSize: FONT.sm.size, cursor: "pointer", fontFamily: "inherit",
        }}>
          <Icon as={ArrowLeft} size={15}/> Opérations
        </button>
        <span style={{ width: 14, height: 14, borderRadius: 5, background: op.couleur || "#888", flexShrink: 0 }}/>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: FONT.xl.size + 2, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>{op.nom}</h1>
          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {op.adresse && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon as={MapPin} size={12}/>{op.adresse}</span>}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon as={HardHat} size={12}/>{chantiersOp.length} logement{chantiersOp.length > 1 ? "s" : ""}</span>
          </div>
        </div>
        <select value={op.id} onChange={(e) => ouvrirOp(e.target.value)} style={selectStyle} title="Changer d'opération">
          {(operations || []).map((o) => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </div>

      {bandeauErreurs && <div style={{ marginBottom: 14 }}>{bandeauErreurs}</div>}

      {chantiersOp.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
          <div style={{ fontSize: FONT.base.size, fontWeight: 600, marginBottom: 8 }}>Aucun chantier rattaché à cette opération.</div>
          <div style={{ fontSize: FONT.sm.size }}>Le rattachement se fait dans Réglages → Opérations (colonne Opération du tableau des chantiers).</div>
        </div>
      ) : (
        <>
          {/* ── KPI financiers agrégés ── */}
          <div className="pops-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard T={T} icon={Wallet} iconColor="#5b8af5" label="Vendu HT" bold
              value={agg.vendu > 0 ? eur(agg.vendu) : "—"}
              sub={`${agg.nbAvecPhasage}/${agg.nbChantiers} logements chiffrés`}/>
            <KpiCard T={T} icon={Clock} iconColor="#f5a623" label="Coût MO réel"
              value={eur(agg.moReel)}
              sub={`${fmtH(agg.hReelles)} h réelles / ${fmtH(agg.hVendues)} h vendues`}/>
            <KpiCard T={T} icon={Package} iconColor="#5b8af5" label="Matériaux réels"
              value={eur(agg.mat)}
              sub={agg.matPrev > 0 ? `prévu : ${eur(agg.matPrev)}` : undefined}/>
            <KpiCard T={T} icon={Receipt} iconColor="#c084fc" label="Frais généraux"
              value={agg.fg > 0 ? eur(agg.fg) : "—"}/>
            <KpiCard T={T} icon={agg.marge >= 0 ? TrendingUp : TrendingDown} iconColor={margeColor} accent={margeColor} bold
              label="Marge nette" value={agg.vendu > 0 ? eur(agg.marge) : "—"}
              sub={agg.vendu > 0 ? `${pctTxt(agg.margePct)} du vendu` : "vendu HT non renseigné"}/>
            <KpiCard T={T} icon={Banknote} iconColor="#22c55e" label="Marge prévisionnelle"
              value={agg.vendu > 0 ? eur(agg.margePrev) : "—"}
              sub={agg.vendu > 0 ? `${pctTxt(agg.margePrevPct)} au devis` : undefined}/>
          </div>

          {/* ── Avancement + décomposition du vendu ── */}
          <div style={{ background: T.surface, border: `1px solid ${border}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: "14px 16px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.sm.size, color: textSub, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>Avancement de l'opération <span style={{ fontWeight: 500, color: textMuted }}>(pondéré par le vendu HT de chaque logement)</span></span>
                <span style={{ fontWeight: 800, color: text }}>{agg.avancement}%</span>
              </div>
              <ProgressBar value={agg.avancement} color={op.couleur} height={8}/>
            </div>
            {segments.length > 0 && (
              <div>
                <div style={{ fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", color: textMuted, marginBottom: 6 }}>
                  Décomposition du vendu HT
                </div>
                <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "rgba(128,128,128,0.15)" }}>
                  {segments.map((s) => (
                    <div key={s.label} title={`${s.label} : ${eur(s.val)}`}
                      style={{ width: `${(s.val / baseBarre) * 100}%`, background: s.color, minWidth: s.val > 0 ? 2 : 0 }}/>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 7 }}>
                  {segments.map((s) => (
                    <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, color: textSub }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: s.color }}/>{s.label} · <strong style={{ color: text }}>{eur(s.val)}</strong>
                    </span>
                  ))}
                  {agg.marge < 0 && (
                    <span style={{ fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>
                      Coûts supérieurs au vendu : marge {eur(agg.marge)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Tableau des logements ── */}
          <div style={{ background: T.surface, border: `1px solid ${border}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: "6px 4px", marginBottom: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Logement</th>
                  <th style={{ ...th, textAlign: "left" }}>Statut</th>
                  <th style={th}>Avanc.</th>
                  <th style={th}>Vendu HT</th>
                  <th style={th}>Coût MO</th>
                  <th style={th}>Matériaux</th>
                  <th style={th}>Marge</th>
                  <th style={th}>Marge %</th>
                  <th style={th}>Heures (réel/vendu)</th>
                </tr>
              </thead>
              <tbody>
                {chantiersOp.map((c) => {
                  const f = finParChantier[c.id];
                  const b = f?.finance.brut;
                  const s = STATUTS[c.statut] || STATUTS.en_cours;
                  const mColor = b && b.prixHTChantier > 0 ? couleurMarge(b.margeChantier, b.margePctChantier ?? 0) : textMuted;
                  return (
                    <tr key={c.id} className={onOpenChantier ? "pops-row-clic" : undefined}
                      onClick={onOpenChantier ? () => onOpenChantier(c.id) : undefined}
                      style={{ borderTop: `1px solid ${border}`, cursor: onOpenChantier ? "pointer" : "default" }}>
                      <td style={{ ...td, textAlign: "left", color: text, fontWeight: 700 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: c.couleur || "#888", flexShrink: 0 }}/>
                          {c.nom}
                          {onOpenChantier && <Icon as={ExternalLink} size={11} style={{ opacity: .45 }}/>}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "left" }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
                          color: s.color, background: s.bg, border: `1px solid ${s.color}40`, whiteSpace: "nowrap",
                        }}>{s.label}</span>
                      </td>
                      {!b ? (
                        <td colSpan={7} style={{ ...td, textAlign: "left", fontStyle: "italic", color: textMuted }}>Sans phasage — hors chiffres</td>
                      ) : (
                        <>
                          <td style={{ ...td, fontWeight: 700, color: text }}>{b.avancementChantier}%</td>
                          <td style={td}>{b.prixHTChantier > 0 ? eur(b.prixHTChantier) : "—"}</td>
                          <td style={td}>{eur(b.coutMOTotalChantier)}</td>
                          <td style={td}>{eur(b.coutMatChantier)}</td>
                          <td style={{ ...td, fontWeight: 800, color: mColor }}>{b.prixHTChantier > 0 ? eur(b.margeChantier) : "—"}</td>
                          <td style={{ ...td, fontWeight: 700, color: mColor }}>{b.prixHTChantier > 0 ? pctTxt(b.margePctChantier) : "—"}</td>
                          <td style={td}>{fmtH(b.heuresReellesTotalChantier)}h / {fmtH(b.heuresVenduesChantier)}h</td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {/* Ligne de total */}
                <tr style={{ borderTop: `2px solid ${border}` }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800, color: text }}>Total opération</td>
                  <td style={td}/>
                  <td style={{ ...td, fontWeight: 800, color: text }}>{agg.avancement}%</td>
                  <td style={{ ...td, fontWeight: 800, color: text }}>{agg.vendu > 0 ? eur(agg.vendu) : "—"}</td>
                  <td style={{ ...td, fontWeight: 800, color: text }}>{eur(agg.moReel)}</td>
                  <td style={{ ...td, fontWeight: 800, color: text }}>{eur(agg.mat)}</td>
                  <td style={{ ...td, fontWeight: 800, color: margeColor }}>{agg.vendu > 0 ? eur(agg.marge) : "—"}</td>
                  <td style={{ ...td, fontWeight: 800, color: margeColor }}>{agg.vendu > 0 ? pctTxt(agg.margePct) : "—"}</td>
                  <td style={{ ...td, fontWeight: 800, color: text }}>{fmtH(agg.hReelles)}h / {fmtH(agg.hVendues)}h</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Diagramme financier consolidé de l'opération ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: text }}>
                Diagramme financier de l'opération
                <span style={{ fontWeight: 600, fontSize: 12.5, color: textMuted, marginLeft: 10 }}>
                  courbes de référence : {consolide.stats.nbAvecReference} logement{consolide.stats.nbAvecReference > 1 ? "s" : ""} inclus / {consolide.stats.sansReference.length} exclu{consolide.stats.sansReference.length > 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ flex: 1 }}/>
              <select value={periode} onChange={(e) => setPeriode(e.target.value)} style={selectStyle}>
                <option value="12">12 derniers mois</option>
                <option value="24">24 derniers mois</option>
                <option value="tout">Tout l'historique</option>
              </select>
            </div>
            {consolide.stats.sansReference.length > 0 && (
              <div style={{ padding: "8px 12px", borderRadius: 10, border: `1px dashed ${border}`, fontSize: 12.5, color: textSub }}>
                <strong>Sans référence figée</strong> (hors courbes de référence — prendre la référence depuis la fiche chantier) : {consolide.stats.sansReference.map((c) => c.nom).join(" · ")}
              </div>
            )}
            {consolide.stats.nonApparies.length > 0 && (
              <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(245,166,35,.12)",
                border: "1px solid rgba(245,166,35,.4)", fontSize: 12.5, color: "#b97a10", fontWeight: 600 }}>
                Non apparié{consolide.stats.nonApparies.length > 1 ? "s" : ""} aux États financiers (jointure par nom) — absent{consolide.stats.nonApparies.length > 1 ? "s" : ""} des recettes réelles : {consolide.stats.nonApparies.map((c) => c.nom).join(" · ")}
              </div>
            )}
            {dataGraphe.length > 0 ? (
              <div ref={grapheRef} style={{ background: T.surface, border: `1px solid ${border}`, borderRadius: 12, padding: "16px 14px 6px", minWidth: 0 }}>
                <Suspense fallback={<div style={{ color: textMuted, fontSize: 13, padding: 20 }}>Chargement du graphique…</div>}>
                  <DiagrammeFinancierChart T={T} data={dataGraphe} hauteur={320}
                    masques={masques}
                    onToggleSerie={(k) => k && setMasques((m) => ({ ...m, [k]: !m[k] }))}/>
                </Suspense>
                <div style={{ fontSize: 11.5, color: textMuted, textAlign: "center", margin: "2px 0 8px" }}>
                  Trait plein = réel · pointillés = référence figée · somme des logements de l'opération, cumuls mensuels € HT · clic sur la légende = masquer/afficher
                </div>
              </div>
            ) : (
              <div style={{ color: textMuted, fontSize: 13 }}>Aucune donnée mensuelle sur la période choisie.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
