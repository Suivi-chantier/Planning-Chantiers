import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { Wallet, Loader2, ChevronDown, ChevronRight } from "lucide-react";

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisLabel = (ym) => {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
};
const eur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      const [cRes, fRes] = await Promise.all([
        supabase.from("commandes")
          .select("fournisseur_nom, montant_ht, date_doc, created_at, statut_facturation, lignes:commande_lignes(prix_total)")
          .is("facture_id", null).limit(5000),
        supabase.from("factures")
          .select("fournisseur_nom, montant_ht, date_facture, created_at, statut").limit(2000),
      ]);
      const arr = [];
      (cRes.data || []).forEach(c => {
        const montant = c.montant_ht != null ? Number(c.montant_ht)
          : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
        if (!montant) return;
        const dateISO = c.date_doc || (c.created_at || "").slice(0, 10);
        arr.push({ mois: (dateISO || "").slice(0, 7), fournisseur: c.fournisseur_nom || "Sans fournisseur", montant, paye: c.statut_facturation === "facture" });
      });
      (fRes.data || []).forEach(f => {
        const montant = Number(f.montant_ht) || 0;
        if (!montant) return;
        const dateISO = f.date_facture || (f.created_at || "").slice(0, 10);
        arr.push({ mois: (dateISO || "").slice(0, 7), fournisseur: f.fournisseur_nom || "Sans fournisseur", montant, paye: false });
      });
      setItems(arr);
      setLoading(false);
    })();
  }, []);

  const fournisseurs = [...new Set(items.map(i => i.fournisseur))].sort((a, b) => a.localeCompare(b));
  const filtered = fFilter === "all" ? items : items.filter(i => i.fournisseur === fFilter);

  // Agrégation mois -> fournisseur
  const moisMap = new Map();
  for (const it of filtered) {
    const m = it.mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, { mois: m, total: 0, paye: 0, aPayer: 0, parFourn: new Map() });
    const g = moisMap.get(m);
    g.total += it.montant; it.paye ? (g.paye += it.montant) : (g.aPayer += it.montant);
    if (!g.parFourn.has(it.fournisseur)) g.parFourn.set(it.fournisseur, { nom: it.fournisseur, total: 0, paye: 0, aPayer: 0 });
    const pf = g.parFourn.get(it.fournisseur);
    pf.total += it.montant; it.paye ? (pf.paye += it.montant) : (pf.aPayer += it.montant);
  }
  const moisList = [...moisMap.values()].sort((a, b) => b.mois.localeCompare(a.mois));
  const totalGlobal = filtered.reduce((s, i) => s + i.montant, 0);
  const aPayerGlobal = filtered.filter(i => !i.paye).reduce((s, i) => s + i.montant, 0);

  const page = {
    flex: 1, minHeight: 0, overflowY: "auto", background: T.bg, color: T.text,
    fontFamily: "inherit", padding: SPACING.lg, paddingBottom: 96, maxWidth: 860, margin: "0 auto", boxSizing: "border-box",
  };
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, marginBottom: SPACING.sm };
  const labelStyle = { display: "block", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSub, marginBottom: 6 };
  const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: 15, fontFamily: "inherit", outline: "none" };

  const toggle = (m) => setOuverts(o => ({ ...o, [m]: !o[m] }));

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACING.lg }}>
        <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon as={Wallet} size={20} strokeWidth={2} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, color: T.text }}>Encours fournisseurs</h1>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Dépenses par fournisseur et par mois — suivi des règlements</div>
        </div>
      </div>

      {/* Totaux + filtre */}
      <div style={{ display: "flex", gap: SPACING.sm, marginBottom: SPACING.md, flexWrap: "wrap" }}>
        <div style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, padding: "12px 14px" }}>
          <div style={labelStyle}>Total {fFilter !== "all" ? "" : "général"}</div>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>{eur(totalGlobal)} €</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, padding: "12px 14px", borderColor: SEMANTIC.warning.border }}>
          <div style={labelStyle}>Reste à payer</div>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: SEMANTIC.warning.color }}>{eur(aPayerGlobal)} €</div>
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
          const fournTries = [...g.parFourn.values()].sort((a, b) => b.total - a.total);
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
                  <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: acc.accent }}>{eur(g.total)} €</div>
                </div>
              </button>

              {ouvert && (
                <div style={{ borderTop: `1px solid ${T.border}` }}>
                  {fournTries.map(pf => (
                    <div key={pf.nom} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 10px 40px", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pf.nom}</div>
                        {pf.aPayer > 0 && pf.paye > 0 && (
                          <div style={{ fontSize: FONT.xs.size, color: T.textSub }}>payé {eur(pf.paye)} € · à payer {eur(pf.aPayer)} €</div>
                        )}
                      </div>
                      {pf.aPayer > 0 && (
                        <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: SEMANTIC.warning.color, whiteSpace: "nowrap" }}>{eur(pf.aPayer)} € à payer</span>
                      )}
                      <div style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text, minWidth: 90, textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{eur(pf.total)} €</div>
                    </div>
                  ))}
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
