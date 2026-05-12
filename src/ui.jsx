// ─── DESIGN SYSTEM : COMPOSANTS UI RÉUTILISABLES ─────────────────────────────
// Utiliser ces composants au lieu de bricoler des div + styles inline pour
// garantir la cohérence visuelle sur toute l'app.

import React from "react";
import { NEUTRAL, RADIUS, SPACING, FONT, SHADOW, SEMANTIC, getBranchAccent } from "./constants";

// ─── ICON ─────────────────────────────────────────────────────────────────────
// Wrapper minimal : exporte les icônes Lucide en réglant la taille + stroke
// par défaut. À utiliser : <Icon as={Calendar} size={16} />
export function Icon({ as: Component, size = 16, strokeWidth = 1.75, ...props }) {
  if (!Component) return null;
  return <Component size={size} strokeWidth={strokeWidth} {...props} />;
}

// ─── BUTTON ───────────────────────────────────────────────────────────────────
// variant: primary | secondary | ghost | danger
// size:    sm | md | lg
// branch:  renovation | invest | groupe — détermine la couleur d'accent
export function Button({
  variant = "primary",
  size = "md",
  branch = "renovation",
  icon: IconComp,
  iconRight: IconRight,
  children,
  fullWidth = false,
  style,
  disabled,
  ...props
}) {
  const acc = getBranchAccent(branch);

  const sizes = {
    sm: { padX: 10, padY: 5,  fs: 12, gap: 6, iconSize: 14, radius: RADIUS.md },
    md: { padX: 14, padY: 8,  fs: 13, gap: 8, iconSize: 16, radius: RADIUS.md },
    lg: { padX: 18, padY: 11, fs: 14, gap: 8, iconSize: 18, radius: RADIUS.lg },
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    primary: {
      background: disabled ? NEUTRAL[600] : acc.accent,
      color:      acc.onAccent,
      border:     "1px solid transparent",
      hoverBg:    acc.accentDark,
    },
    secondary: {
      background: "transparent",
      color:      acc.accent,
      border:     `1px solid ${acc.border}`,
      hoverBg:    acc.bg10,
    },
    ghost: {
      background: "transparent",
      color:      NEUTRAL[200],
      border:     "1px solid transparent",
      hoverBg:    "rgba(255,255,255,0.06)",
    },
    danger: {
      background: SEMANTIC.danger.bg,
      color:      SEMANTIC.danger.color,
      border:     `1px solid ${SEMANTIC.danger.border}`,
      hoverBg:    "rgba(225,90,90,0.20)",
    },
  };
  const v = variants[variant] || variants.primary;

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: s.gap,
    padding: `${s.padY}px ${s.padX}px`,
    background: v.background,
    color: v.color,
    border: v.border,
    borderRadius: s.radius,
    fontFamily: "inherit",
    fontSize: s.fs,
    fontWeight: 700,
    letterSpacing: 0.2,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    transition: "background .12s, transform .08s",
    width: fullWidth ? "100%" : "auto",
    whiteSpace: "nowrap",
    userSelect: "none",
    ...style,
  };

  return (
    <button
      {...props}
      disabled={disabled}
      style={baseStyle}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = v.hoverBg; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = v.background; }}
    >
      {IconComp && <Icon as={IconComp} size={s.iconSize} />}
      {children}
      {IconRight && <Icon as={IconRight} size={s.iconSize} />}
    </button>
  );
}

// ─── CARD ─────────────────────────────────────────────────────────────────────
export function Card({ children, padding = "lg", elevated = false, style, ...props }) {
  const pad = SPACING[padding] ?? SPACING.lg;
  return (
    <div
      {...props}
      style={{
        background: NEUTRAL[700],
        border: `1px solid ${NEUTRAL[600]}`,
        borderRadius: RADIUS.lg,
        padding: pad,
        boxShadow: elevated ? SHADOW.md : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── BADGE ────────────────────────────────────────────────────────────────────
// variant: success | warning | danger | info | neutral
// + variant="branch" + branch="..." pour utiliser l'accent de la branche
export function Badge({ variant = "neutral", branch, icon: IconComp, children, style, ...props }) {
  let palette;
  if (variant === "branch" && branch) {
    const acc = getBranchAccent(branch);
    palette = { color: acc.accent, bg: acc.bg10, border: acc.border };
  } else if (SEMANTIC[variant]) {
    palette = SEMANTIC[variant];
  } else {
    palette = { color: NEUTRAL[200], bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.1)" };
  }

  return (
    <span
      {...props}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 9px",
        background: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        borderRadius: RADIUS.pill,
        fontSize: FONT.xs.size,
        fontWeight: FONT.xs.weight,
        letterSpacing: FONT.xs.tracking,
        lineHeight: 1,
        ...style,
      }}
    >
      {IconComp && <Icon as={IconComp} size={11} />}
      {children}
    </span>
  );
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
export function Input({ size = "md", style, ...props }) {
  const sizes = {
    sm: { padX: 10, padY: 6,  fs: 12 },
    md: { padX: 12, padY: 9,  fs: 13 },
    lg: { padX: 14, padY: 11, fs: 14 },
  };
  const s = sizes[size] || sizes.md;
  return (
    <input
      {...props}
      style={{
        width: "100%",
        background: NEUTRAL[800],
        color: NEUTRAL[50],
        border: `1px solid ${NEUTRAL[600]}`,
        borderRadius: RADIUS.md,
        padding: `${s.padY}px ${s.padX}px`,
        fontFamily: "inherit",
        fontSize: s.fs,
        outline: "none",
        transition: "border-color .12s",
        ...style,
      }}
      onFocus={e => { e.currentTarget.style.borderColor = NEUTRAL[400]; if (props.onFocus) props.onFocus(e); }}
      onBlur={e =>  { e.currentTarget.style.borderColor = NEUTRAL[600]; if (props.onBlur)  props.onBlur(e);  }}
    />
  );
}

// ─── SECTION TITLE ────────────────────────────────────────────────────────────
// Titre de section avec accent et tracking. Utiliser à la place des
// "<div style={{fontSize:11, letterSpacing:2, textTransform:uppercase, ...}}>"
export function SectionTitle({ children, branch = "renovation", style, ...props }) {
  const acc = getBranchAccent(branch);
  return (
    <div
      {...props}
      style={{
        fontSize: FONT.xs.size,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: acc.accent,
        opacity: 0.7,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
