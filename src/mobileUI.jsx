// ════════════════════════════════════════════════════════════════════════════
// KIT UI MOBILE — langage visuel premium (référence figée le 2026-06-30)
//
// Optimisé pour le THÈME CLAIR (cartes blanches surélevées sur fond #f7f7f7),
// fonctionne aussi en sombre. À réutiliser sur TOUTES les pages mobiles pour une
// finition cohérente. Patterns :
//   - MobileHero    : bandeau dégradé sombre + halos colorés, titre + chips
//   - MobileStat    : carte KPI surélevée, icône pleine à ombre colorée, chiffre
//   - MobileSection : carte accordéon (accent gauche coloré, métrique en pastille,
//                     ouverture animée)
//   - MobileCard    : carte générique surélevée (accent gauche optionnel)
// ════════════════════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { Icon } from "./ui";
import { ChevronDown } from "lucide-react";

// Ombre douce en couches : donne la profondeur "appli pro" sur fond clair.
export const CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.06)";

// ─── HERO ─────────────────────────────────────────────────────────────────────
// eyebrow : petite ligne au-dessus (date, contexte) ; title : titre principal ;
// right : élément à droite (météo, action…) ; chips : [{icon,value,label,color}].
export function MobileHero({ eyebrow, title, right, chips, accent = "#FFC200" }) {
  return (
    <div style={{
      borderRadius: 18, padding: "17px 18px 18px", position: "relative", overflow: "hidden",
      background: "linear-gradient(135deg, #1c2536 0%, #2f3a52 60%, #3a3050 100%)",
      boxShadow: "0 12px 30px rgba(16,24,40,0.22)",
    }}>
      <div style={{ position: "absolute", top: -50, right: -40, width: 170, height: 170, borderRadius: "50%", background: `radial-gradient(circle, ${accent}50, transparent 70%)` }}/>
      <div style={{ position: "absolute", bottom: -60, left: -30, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(91,138,245,0.25), transparent 70%)" }}/>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: "rgba(255,255,255,0.6)", textTransform: "capitalize" }}>{eyebrow}</div>}
            <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.4, color: "#fff", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          </div>
          {right}
        </div>
        {chips && chips.length > 0 && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chips.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 11, padding: "7px 11px" }}>
                {c.icon && <Icon as={c.icon} size={14} style={{ color: c.color || accent }}/>}
                <span style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>{c.value}</span>
                {c.label && <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{c.label}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI ────────────────────────────────────────────────────────────────────
export function MobileStat({ icon: IconComp, label, value, sub, bar, color, T }) {
  return (
    <div style={{
      background: `linear-gradient(155deg, ${color}14, ${T.surface} 58%)`,
      borderRadius: 16, border: `1px solid ${T.border}`,
      boxShadow: CARD_SHADOW, padding: "14px 14px 13px",
      display: "flex", flexDirection: "column", gap: 9, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12,
        background: `linear-gradient(135deg, ${color}, ${color}c0)`, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 5px 14px ${color}55`,
      }}><Icon as={IconComp} size={19} strokeWidth={2.3}/></div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.text, letterSpacing: -0.6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.textMuted }}>{label}</div>
      {bar != null && (
        <div style={{ height: 5, borderRadius: 3, background: T.card, overflow: "hidden", marginTop: 1 }}>
          <div style={{ height: "100%", width: `${Math.max(3, bar)}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: 3, transition: "width .4s" }}/>
        </div>
      )}
      {sub && <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

// ─── SECTION ACCORDÉON ────────────────────────────────────────────────────────
export function MobileSection({ title, icon: IconComp, summary, summaryTone, defaultOpen = false, T, accent = "#FFC200", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 16, overflow: "hidden", boxShadow: CARD_SHADOW,
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 15px", background: "transparent", border: "none",
        cursor: "pointer", fontFamily: "inherit", color: T.text, textAlign: "left",
      }}>
        {IconComp && (
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, ${accent}2e, ${accent}14)`, color: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon as={IconComp} size={17} strokeWidth={2.2}/></div>
        )}
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.2 }}>{title}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {summary != null && summary !== "" && (
            <span style={{
              fontSize: 13, fontWeight: 800, lineHeight: 1,
              color: summaryTone || T.textSub,
              background: summaryTone ? `${summaryTone}1f` : T.card,
              padding: "5px 10px", borderRadius: 999,
            }}>{summary}</span>
          )}
          <Icon as={ChevronDown} size={18} style={{ color: T.textMuted, transform: open ? "rotate(180deg)" : "none", transition: "transform .25s ease" }}/>
        </span>
      </button>
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .28s ease" }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ padding: "0 15px 15px" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

// ─── CARTE GÉNÉRIQUE ──────────────────────────────────────────────────────────
// Carte surélevée non repliable (accent gauche optionnel).
export function MobileCard({ accent, T, style, children }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      ...(accent ? { borderLeft: `3px solid ${accent}` } : {}),
      borderRadius: 16, boxShadow: CARD_SHADOW, ...style,
    }}>
      {children}
    </div>
  );
}
