import React from "react";
import { FONT, RADIUS, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import { ListChecks, Sparkles } from "lucide-react";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte en cours. Cohabite avec la v1 (`Phasage.jsx`) sans la remplacer.
// Lit/écrit dans les mêmes tables Supabase (`phasages`, `bibliotheque_ratios`,
// `planning_config`) pour éviter une migration plus tard.
function PagePhasageV2({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);

  return (
    <div className="page-padding phase-v2-list" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={ListChecks} size={20} strokeWidth={2}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Phasage</div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: acc.bg10, color: acc.accent, border: `1px solid ${acc.border}`,
                borderRadius: RADIUS.pill, padding: "2px 9px",
                fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
              }}>
                <Icon as={Sparkles} size={10}/>
                V2
              </span>
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              Nouvelle version en cours de construction.
            </div>
          </div>
        </div>

        {/* Placeholder vide — on remplit étape par étape selon les directives */}
        <div style={{
          background: T.card,
          border: `1px dashed ${T.border}`,
          borderRadius: RADIUS.xl,
          padding: "56px 32px",
          textAlign: "center",
          color: T.textMuted,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: RADIUS.lg,
            background: acc.bg10, color: acc.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 14,
          }}>
            <Icon as={Sparkles} size={26} strokeWidth={1.5}/>
          </div>
          <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Page en chantier
          </div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
            La page Phasage v2 est en cours de refonte. La version actuelle reste disponible sous l'onglet <strong style={{ color: T.text }}>Phasage</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}

export default PagePhasageV2;
