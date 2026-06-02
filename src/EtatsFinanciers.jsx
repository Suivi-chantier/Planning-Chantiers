import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import { Calculator, Euro, Clock, TrendingUp, Info, Save } from "lucide-react";

const KEY = "etats_financiers";

const MOIS = [
  { id: "01", label: "Janvier"   },
  { id: "02", label: "Février"   },
  { id: "03", label: "Mars"      },
  { id: "04", label: "Avril"     },
  { id: "05", label: "Mai"       },
  { id: "06", label: "Juin"      },
  { id: "07", label: "Juillet"   },
  { id: "08", label: "Août"      },
  { id: "09", label: "Septembre" },
  { id: "10", label: "Octobre"   },
  { id: "11", label: "Novembre"  },
  { id: "12", label: "Décembre"  },
];

function emptyMonths() {
  return MOIS.reduce((acc, m) => ({ ...acc, [m.id]: { fg: "", heures: "" } }), {});
}

const fmtEur = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " €";
const fmtH = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " h";
const fmtTaux = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €/h";

export default function PageEtatsFinanciers({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [months, setMonths] = useState(emptyMonths());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("planning_config")
        .select("value")
        .eq("key", KEY)
        .maybeSingle();
      if (data?.value?.months) {
        setMonths({ ...emptyMonths(), ...data.value.months });
      }
      setDirty(false);
    } catch (e) {
      console.error("EtatsFinanciers load:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Sauvegarde manuelle ─────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("planning_config")
      .upsert({ key: KEY, value: { months }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      console.error("EtatsFinanciers save:", error);
      alert("Erreur lors de la sauvegarde : " + error.message);
      return;
    }
    setDirty(false);
    setLastSavedAt(new Date());
  };

  const updateField = (moisId, field, raw) => {
    setMonths(prev => ({ ...prev, [moisId]: { ...prev[moisId], [field]: raw } }));
    setDirty(true);
  };

  // ── Avertir avant de quitter avec des modifs non sauvegardées ──────────────
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Calculs ─────────────────────────────────────────────────────────────────
  const parsed = MOIS.map(m => {
    const fg = parseFloat(String(months[m.id]?.fg).replace(",", ".")) || 0;
    const heures = parseFloat(String(months[m.id]?.heures).replace(",", ".")) || 0;
    return { ...m, fg, heures, hasData: fg > 0 || heures > 0 };
  });
  const nbMoisSaisis = parsed.filter(p => p.hasData).length;
  const totalFG = parsed.reduce((s, p) => s + p.fg, 0);
  const totalH  = parsed.reduce((s, p) => s + p.heures, 0);
  const moyFG = nbMoisSaisis > 0 ? totalFG / nbMoisSaisis : 0;
  const moyH  = nbMoisSaisis > 0 ? totalH  / nbMoisSaisis : 0;
  const tauxHoraire = moyH > 0 ? moyFG / moyH : 0;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = T.surface;
  const cellInputStyle = {
    width: "100%",
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: RADIUS.md,
    padding: "8px 10px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 14,
    textAlign: "right",
    outline: "none",
    transition: "border-color .12s",
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.textSub, padding: 40 }}>
        Chargement…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg, color: T.text }}>
      <style>{`
        .ef-row:hover { background: ${T.cardHover}; }
        .ef-input:focus { border-color: ${acc.accent} !important; }
        @media (max-width: 767px) {
          .ef-wrap { padding: 14px 12px !important; }
          .ef-kpis { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="ef-wrap" style={{ padding: "24px 32px", maxWidth: 980, margin: "0 auto" }}>
        {/* ─── Header ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
              color: acc.accent, opacity: 0.75, marginBottom: 4,
            }}>
              Suivi mensuel · Annuel
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: 0.3 }}>
              États financiers
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {dirty && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: RADIUS.pill,
                background: "rgba(245,166,35,0.12)", color: "#f5a623",
                fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
              }}>
                ● Modifications non sauvegardées
              </span>
            )}
            {!dirty && lastSavedAt && (
              <span style={{ fontSize: 12, color: T.textMuted }}>
                Enregistré à {lastSavedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "9px 18px", borderRadius: RADIUS.md,
                border: "none", cursor: (saving || !dirty) ? "not-allowed" : "pointer",
                background: (saving || !dirty) ? T.card : acc.accent,
                color: (saving || !dirty) ? T.textMuted : "#111",
                fontFamily: "inherit", fontSize: 13, fontWeight: 800,
                letterSpacing: 0.5, textTransform: "uppercase",
                opacity: (saving || !dirty) ? 0.6 : 1,
                transition: "background .12s, opacity .12s",
              }}
            >
              <Icon as={Save} size={14}/>
              {saving ? "Enregistrement…" : "Sauvegarder"}
            </button>
          </div>
        </div>

        {/* ─── KPI : moyennes + taux horaire ──────────────────────────────────── */}
        <div className="ef-kpis" style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20,
        }}>
          <KpiCard T={T} icon={Euro}        iconColor="#ff9a4d"   label="Moyenne FG / mois"     value={fmtEur(moyFG)}/>
          <KpiCard T={T} icon={Clock}       iconColor="#5b9cf6"   label="Moyenne Heures / mois" value={fmtH(moyH)}/>
          <KpiCard T={T} icon={Calculator}  iconColor={acc.accent} label="Taux horaire FG"      value={fmtTaux(tauxHoraire)} highlight/>
        </div>

        {/* ─── Tableau mensuel ────────────────────────────────────────────────── */}
        <div style={{
          background: card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
          padding: 18, marginBottom: 20,
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{
                    textAlign: "left", padding: "10px 12px", fontSize: 11,
                    fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                    color: T.textSub,
                  }}>Mois</th>
                  <th style={{
                    textAlign: "right", padding: "10px 12px", fontSize: 11,
                    fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                    color: T.textSub,
                  }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon as={Euro} size={12}/> Frais Généraux
                    </span>
                  </th>
                  <th style={{
                    textAlign: "right", padding: "10px 12px", fontSize: 11,
                    fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                    color: T.textSub,
                  }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon as={Clock} size={12}/> Heures / mois
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {MOIS.map(m => (
                  <tr key={m.id} className="ef-row" style={{ borderBottom: `1px solid ${T.border}`, transition: "background .12s" }}>
                    <td style={{ padding: "8px 12px", fontSize: 14, fontWeight: 600, color: T.text }}>
                      {m.label}
                    </td>
                    <td style={{ padding: "6px 12px", width: "30%" }}>
                      <input
                        className="ef-input"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        placeholder="0"
                        value={months[m.id]?.fg ?? ""}
                        onChange={e => updateField(m.id, "fg", e.target.value)}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={{ padding: "6px 12px", width: "30%" }}>
                      <input
                        className="ef-input"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        placeholder="0"
                        value={months[m.id]?.heures ?? ""}
                        onChange={e => updateField(m.id, "heures", e.target.value)}
                        style={cellInputStyle}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: T.card }}>
                  <td style={{
                    padding: "12px", fontSize: 12, fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase", color: T.textSub,
                  }}>
                    Total ({nbMoisSaisis} mois saisis)
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", fontSize: 14, fontWeight: 700, color: T.text }}>
                    {fmtEur(totalFG)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "right", fontSize: 14, fontWeight: 700, color: T.text }}>
                    {fmtH(totalH)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ─── Note explicative ───────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 14px", borderRadius: RADIUS.md,
          background: T.card, border: `1px solid ${T.border}`,
          fontSize: 12.5, color: T.textSub, lineHeight: 1.55,
        }}>
          <Icon as={Info} size={14} style={{ marginTop: 2, flexShrink: 0, color: T.textMuted }}/>
          <div>
            Le <strong style={{ color: T.text }}>taux horaire FG</strong> est calculé comme <em>moyenne FG / moyenne heures</em> sur les mois saisis.
            Cette valeur est indicative — Phasage v2 conserve sa propre saisie par chantier pour ne pas modifier les calculs passés.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI CARD ──────────────────────────────────────────────────────────────────
function KpiCard({ T, icon, iconColor, label, value, highlight = false }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${highlight ? iconColor + "55" : T.border}`,
      borderRadius: RADIUS.lg,
      padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 8,
      boxShadow: highlight ? `0 0 0 1px ${iconColor}22` : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: iconColor + "1a",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: iconColor,
        }}>
          <Icon as={icon} size={15}/>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
          textTransform: "uppercase", color: T.textSub,
        }}>
          {label}
        </div>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 800,
        color: highlight ? iconColor : T.text,
        letterSpacing: 0.3,
      }}>
        {value}
      </div>
    </div>
  );
}
