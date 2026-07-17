import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { Wallet, Loader2, ChevronDown, ChevronRight, Printer } from "lucide-react";

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisLabel = (ym) => {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
};
const eur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Date d'échéance de paiement selon le mode du fournisseur.
//  comptant / inconnu -> le jour même (mois du document)
//  30j                 -> date + 30 jours
//  echeance (30j FDM)  -> fin du mois de la facture, PUIS + 30 jours
//     (ex. facture du 01/07 -> fin juillet 31/07 -> + 30 j = 30/08, payable en août)
// Renvoie "AAAA-MM-JJ" (heure locale, pas de décalage de fuseau).
function echeanceISO(docISO, mode) {
  if (!docISO) return docISO || "";
  const d = new Date(docISO + "T00:00:00");
  if (isNaN(d.getTime())) return docISO;
  if (mode === "30j") { d.setDate(d.getDate() + 30); }
  else if (mode === "echeance") {
    const fdm = new Date(d.getFullYear(), d.getMonth() + 1, 0); // dernier jour du mois de la facture
    fdm.setDate(fdm.getDate() + 30);
    return fdm.toLocaleDateString("sv-SE");
  } else { return docISO; }
  return d.toLocaleDateString("sv-SE");
}

// Suivi des dépenses par fournisseur et par mois.
// Sources (sans double comptage) :
//  - factures (facture fournisseur mensuelle) — considérées "à payer"
//  - commandes NON rattachées à une facture (facture_id vide) : comptant/30j/BL
//    en attente. Celles rattachées à une facture sont comptées via la facture.
// "Payé" = commande réglée comptant (statut_facturation='facture'). Le reste = à payer.
export default function PageEncoursFournisseurs({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);        // { mois, fournisseur, montant, paye }
  const [fFilter, setFFilter] = useState("all");
  const [ouverts, setOuverts] = useState({});     // { [mois]: true } — mois déplié

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [fournRes, cRes, fRes] = await Promise.all([
        supabase.from("fournisseurs").select("id, nom, mode_paiement"),
        supabase.from("commandes")
          .select("fournisseur_id, fournisseur_nom, montant_ht, date_doc, created_at, statut_facturation, source, lignes:commande_lignes(prix_total)")
          .is("facture_id", null).limit(5000),
        supabase.from("factures")
          .select("fournisseur_id, fournisseur_nom, montant_ht, date_facture, created_at, statut")
          .neq("statut", "archivee").limit(2000),
      ]);
      // mode de paiement par fournisseur (par id et par nom normalisé)
      const modeById = {}, modeByNom = {};
      (fournRes.data || []).forEach(f => { modeById[f.id] = f.mode_paiement || ""; if (f.nom) modeByNom[normNom(f.nom)] = f.mode_paiement || ""; });
      const modeOf = (id, nom) => modeById[id] || modeByNom[normNom(nom)] || "";

      const arr = [];
      (cRes.data || []).forEach(c => {
        if (c.source === "migration") return; // anciennes saisies (avant la refonte) : non comptées
        const montant = c.montant_ht != null ? Number(c.montant_ht)
          : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
        if (!montant) return;
        const docISO = c.date_doc || (c.created_at || "").slice(0, 10);
        const paye = c.statut_facturation === "facture";
        // payé (comptant) -> le mois du document ; sinon -> mois d'échéance selon le mode
        const dueISO = paye ? docISO : echeanceISO(docISO, modeOf(c.fournisseur_id, c.fournisseur_nom));
        arr.push({ kind: "cmd", mois: (dueISO || "").slice(0, 7), fournisseur: c.fournisseur_nom || "Sans fournisseur", montant, paye });
      });
      (fRes.data || []).forEach(f => {
        const montant = Number(f.montant_ht) || 0;
        if (!montant) return;
        const docISO = f.date_facture || (f.created_at || "").slice(0, 10);
        const dueISO = echeanceISO(docISO, modeOf(f.fournisseur_id, f.fournisseur_nom));
        arr.push({ kind: "fact", mois: (dueISO || "").slice(0, 7), fournisseur: f.fournisseur_nom || "Sans fournisseur", montant, paye: false });
      });
      setItems(arr);
      setLoading(false);
    })();
  }, []);

  const fournisseurs = [...new Set(items.map(i => i.fournisseur))].sort((a, b) => a.localeCompare(b));
  const filtered = fFilter === "all" ? items : items.filter(i => i.fournisseur === fFilter);

  // Agrégation mois -> fournisseur : saisi (nos commandes), facturé (factures
  // reçues), payé (comptant déjà réglé). "À payer" = la facture si on en a une
  // (c'est ce qu'on règle réellement), sinon le saisi (aperçu avant facture).
  const aPayerOf = (pf) => (pf.facture > 0 ? pf.facture : pf.saisi);
  const moisMap = new Map();
  for (const it of filtered) {
    const m = it.mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, { mois: m, parFourn: new Map() });
    const g = moisMap.get(m);
    if (!g.parFourn.has(it.fournisseur)) g.parFourn.set(it.fournisseur, { nom: it.fournisseur, saisi: 0, facture: 0, paye: 0 });
    const pf = g.parFourn.get(it.fournisseur);
    if (it.kind === "fact") pf.facture += it.montant;
    else if (it.paye) pf.paye += it.montant;
    else pf.saisi += it.montant;
  }
  for (const g of moisMap.values()) {
    const list = [...g.parFourn.values()];
    g.aPayer = list.reduce((s, pf) => s + aPayerOf(pf), 0);
    g.paye = list.reduce((s, pf) => s + pf.paye, 0);
  }
  const moisList = [...moisMap.values()].sort((a, b) => b.mois.localeCompare(a.mois));
  const totalGlobal = moisList.reduce((s, g) => s + g.aPayer, 0);
  // Cartes "ce mois" : uniquement l'échéance / le paiement du mois calendaire en cours.
  const moisCourantKey = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const moisCourantLabel = moisLabel(moisCourantKey);
  const aPayerMoisCourant = moisMap.get(moisCourantKey)?.aPayer || 0;
  const payeMoisCourant = moisMap.get(moisCourantKey)?.paye || 0;

  const page = {
    flex: 1, minHeight: 0, overflowY: "auto", background: T.bg, color: T.text,
    fontFamily: "inherit", padding: SPACING.lg, paddingBottom: 96, maxWidth: 860, margin: "0 auto", boxSizing: "border-box",
  };
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, marginBottom: SPACING.sm };
  const labelStyle = { display: "block", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSub, marginBottom: 6 };
  const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: 15, fontFamily: "inherit", outline: "none" };

  const toggle = (m) => setOuverts(o => ({ ...o, [m]: !o[m] }));

  const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const exporterPDF = () => {
    const sections = moisList.map(g => {
      const list = [...g.parFourn.values()].sort((a, b) => aPayerOf(b) - aPayerOf(a));
      const rows = list.map(pf => {
        const aP = aPayerOf(pf);
        const ecart = (pf.facture > 0 && pf.saisi > 0) ? (pf.facture - pf.saisi) : null;
        return `<tr>
          <td>${escapeHtml(pf.nom)}</td>
          <td class=r>${pf.saisi > 0 ? eur(pf.saisi) + " €" : ""}</td>
          <td class=r>${pf.facture > 0 ? eur(pf.facture) + " €" : ""}</td>
          <td class=r>${ecart != null ? (ecart > 0 ? "+" : "") + eur(ecart) + " €" : ""}</td>
          <td class=r>${pf.paye > 0 ? eur(pf.paye) + " €" : ""}</td>
          <td class="r b">${aP > 0 ? eur(aP) + " €" : (pf.paye > 0 ? "payé" : "")}</td>
        </tr>`;
      }).join("");
      return `<h2>${moisLabel(g.mois)} — ${eur(g.aPayer)} € à payer</h2>
        <table><thead><tr><th>Fournisseur</th><th class=r>Saisi</th><th class=r>Facturé</th><th class=r>Écart</th><th class=r>Payé</th><th class=r>À payer</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Encours fournisseurs</title>
      <style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;font-size:11px;color:#1a1f2e}
      h1{font-size:18px;margin:0 0 2px}.sub{color:#666;font-size:11px;margin-bottom:14px}
      h2{font-size:13px;margin:16px 0 6px;border-bottom:2px solid #1a1f2e;padding-bottom:3px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th{background:#1a1f2e;color:#fff;padding:5px 8px;text-align:left;font-size:10px}
      td{padding:4px 8px;border-bottom:1px solid #eee}.r{text-align:right}.b{font-weight:700}
      </style></head><body>
      <h1>Encours fournisseurs</h1>
      <div class="sub">${fFilter !== "all" ? `Fournisseur : ${escapeHtml(fFilter)} · ` : ""}Total à payer : ${eur(totalGlobal)} € · imprimé le ${new Date().toLocaleDateString("fr-FR")}</div>
      ${sections || "<div>Aucune donnée</div>"}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACING.lg }}>
        <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon as={Wallet} size={20} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, color: T.text }}>Encours fournisseurs</h1>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Montants regroupés par mois d'échéance de paiement (selon le mode de chaque fournisseur)</div>
        </div>
        <button onClick={exporterPDF} title="Exporter en PDF" style={{
          display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
          background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
          padding: "8px 12px", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
        }}>
          <Icon as={Printer} size={14} /> PDF
        </button>
      </div>

      {/* Totaux + filtre */}
      <div style={{ display: "flex", gap: SPACING.sm, marginBottom: SPACING.md, flexWrap: "wrap" }}>
        <div style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, padding: "12px 14px", borderColor: SEMANTIC.warning.border }}>
          <div style={labelStyle}>À payer · {moisCourantLabel}</div>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: SEMANTIC.warning.color }}>{eur(aPayerMoisCourant)} €</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, padding: "12px 14px" }}>
          <div style={labelStyle}>Payé comptant · {moisCourantLabel}</div>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: SEMANTIC.success.color }}>{eur(payeMoisCourant)} €</div>
        </div>
      </div>

      <div style={{ marginBottom: SPACING.md }}>
        <label style={labelStyle}>Fournisseur</label>
        <select value={fFilter} onChange={e => setFFilter(e.target.value)} style={inputStyle}>
          <option value="all">Tous les fournisseurs</option>
          {fournisseurs.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSub }}><Icon as={Loader2} size={24} className="spin" /> Chargement…</div>
      ) : moisList.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: T.textSub, padding: 30 }}>Aucune dépense enregistrée.</div>
      ) : (
        moisList.map(g => {
          const fournTries = [...g.parFourn.values()].sort((a, b) => aPayerOf(b) - aPayerOf(a));
          const ouvert = ouverts[g.mois] ?? (fFilter !== "all"); // déplié d'office si un fournisseur est filtré
          return (
            <div key={g.mois} style={card}>
              <button onClick={() => toggle(g.mois)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
                background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}>
                <Icon as={ouvert ? ChevronDown : ChevronRight} size={16} color={T.textSub} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text, textTransform: "capitalize" }}>{moisLabel(g.mois)}</div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>
                    {fournTries.length} fournisseur{fournTries.length > 1 ? "s" : ""}
                    {g.aPayer > 0 && <span style={{ color: SEMANTIC.warning.color, fontWeight: 700 }}> · {eur(g.aPayer)} € à payer</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: acc.accent }}>{eur(g.aPayer)} €</div>
                </div>
              </button>

              {ouvert && (
                <div style={{ borderTop: `1px solid ${T.border}` }}>
                  {fournTries.map(pf => {
                    const aP = aPayerOf(pf);
                    const ecart = (pf.facture > 0 && pf.saisi > 0) ? (pf.facture - pf.saisi) : null;
                    const parts = [];
                    if (pf.saisi > 0) parts.push(`Saisi ${eur(pf.saisi)} €`);
                    if (pf.facture > 0) parts.push(`Facturé ${eur(pf.facture)} €`);
                    if (pf.paye > 0) parts.push(`Payé ${eur(pf.paye)} €`);
                    return (
                      <div key={pf.nom} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 10px 40px", borderBottom: `1px solid ${T.border}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text }}>{pf.nom}</div>
                          {parts.length > 0 && <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 1 }}>{parts.join("  ·  ")}</div>}
                          {ecart != null && (
                            <div style={{ fontSize: FONT.xs.size, fontWeight: 700, marginTop: 1, color: Math.abs(ecart) < 1 ? SEMANTIC.success.color : SEMANTIC.warning.color }}>
                              écart facture − saisi : {ecart > 0 ? "+" : ""}{eur(ecart)} €
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: FONT.base.size, fontWeight: 800, minWidth: 96, textAlign: "right", fontFamily: "'DM Mono', monospace", color: aP > 0 ? SEMANTIC.warning.color : (pf.paye > 0 ? SEMANTIC.success.color : T.textSub) }}>
                          {aP > 0 ? `${eur(aP)} €` : (pf.paye > 0 ? "payé" : "—")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
    </div>
  );
}
