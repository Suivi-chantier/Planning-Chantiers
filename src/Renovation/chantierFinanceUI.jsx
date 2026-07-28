import React, { useState, useRef } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { eur, fmtH, couleurDepassement, SEUIL_RATIO_DERIVE } from "../chantierFinance";
import { AlertTriangle, X, Eye, EyeOff } from "lucide-react";

// ─── UI PARTAGÉE DES DONNÉES FINANCIÈRES ─────────────────────────────────────
// Composants communs à Phasage V2 et à la page Bilan semaine. Le CONTENU vient
// toujours des objets Donnee de src/chantierFinance.js — ici il n'y a que de
// la présentation. Aucun texte d'explication n'est rédigé dans ces composants.

// ─── INFOBULLE MAISON ─────────────────────────────────────────────────────────
// Remplace l'attribut HTML title="" : pas de délai d'une seconde, stylable, et
// surtout déclenchable au TACTILE (appui long ~450 ms). Aucune dépendance npm.
export function InfoBulle({ contenu, T, children, style, disabled = false }) {
  const [visible, setVisible] = useState(false);
  const pressTimer = useRef(null);
  const hideTimer = useRef(null);

  if (disabled || !contenu) return children || null;

  const show = () => { clearTimeout(hideTimer.current); setVisible(true); };
  const hide = () => setVisible(false);
  const onTouchStart = () => {
    pressTimer.current = setTimeout(() => {
      show();
      // Au doigt il n'y a pas de "mouseleave" : on referme tout seul.
      hideTimer.current = setTimeout(hide, 4500);
    }, 450);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  return (
    <span
      onMouseEnter={show} onMouseLeave={hide}
      onTouchStart={onTouchStart} onTouchEnd={cancelPress} onTouchMove={cancelPress}
      onContextMenu={(e) => { if (visible) e.preventDefault(); }}
      style={{ position: "relative", display: "inline-flex", minWidth: 0, ...style }}
    >
      {children}
      {visible && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 950,
          background: T?.modal || "#1e2336", color: T?.text || "#e8eaf0",
          border: `1px solid ${T?.border || "rgba(255,255,255,0.14)"}`,
          borderRadius: 10, padding: "9px 12px",
          width: "max-content", maxWidth: 300,
          fontSize: FONT.xs.size + 1, fontWeight: 500, lineHeight: 1.45,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          whiteSpace: "pre-line", pointerEvents: "none", textAlign: "left",
        }}>
          {contenu}
        </span>
      )}
    </span>
  );
}

// ─── <Donnee> : une valeur qui porte sa propre explication ────────────────────
// Trois niveaux de lecture :
//   1. la valeur visible (children, ou donnee.valeurTexte)
//   2. l'infobulle au survol / appui long : formule + calcul détaillé (court)
//      + fraîcheur — 3 lignes maximum
//   3. le clic : la ventilation complète (modale kpiDetail via onDetail)
// renseigne === false → rendu visuellement DIFFÉRENT (pointillés + teinte
// atténuée) et l'infobulle dit QUOI FAIRE (warnings du module).
const fmtDateFr = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m ? `${d}/${m}` : null;
};

export function Donnee({ donnee, T, children, onDetail, dateRef, style }) {
  if (!donnee) return children || null;
  const nonRenseigne = donnee.renseigne === false;

  const lignes = [];
  if (nonRenseigne && donnee.warnings?.length) {
    lignes.push(`⚠ ${donnee.warnings[0].message}`);
    if (donnee.formule) lignes.push(donnee.formule);
  } else {
    if (donnee.formule) lignes.push(donnee.formule);
    if (donnee.calculDetaille && donnee.calculDetaille.length <= 170 && !donnee.calculDetaille.includes("\n")) {
      lignes.push(donnee.calculDetaille);
    }
  }
  const fraich = [];
  if (dateRef) fraich.push(`à date du ${fmtDateFr(dateRef)}`);
  if (donnee.fraicheur?.dernierPointage) fraich.push(`dernier pointage le ${fmtDateFr(donnee.fraicheur.dernierPointage)}`);
  if (fraich.length) lignes.push(fraich.join(" · "));

  const clickable = typeof onDetail === "function";
  return (
    <InfoBulle contenu={lignes.slice(0, 3).join("\n")} T={T} style={style}>
      <span
        onClick={clickable ? (e) => { e.stopPropagation(); onDetail(donnee); } : undefined}
        style={{
          minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
          cursor: clickable ? "pointer" : "help",
          ...(nonRenseigne ? {
            opacity: 0.62, fontStyle: "italic",
            textDecoration: "underline dotted", textUnderlineOffset: 3,
          } : {
            borderBottom: "1px dashed color-mix(in srgb, currentColor 35%, transparent)",
          }),
        }}
      >
        {children != null ? children : donnee.valeurTexte}
      </span>
    </InfoBulle>
  );
}

// ─── KPI CARD (extraite de PhasageV2, paramétrable) ──────────────────────────
// Si `donnee` est fourni, la valeur porte son infobulle <Donnee> (le clic de
// la carte reste le onClick historique → ventilation).
export function KpiCard({ T, icon, iconColor, label, value, sub, accent, bold, onClick, donnee, dateRef }) {
  const valColor = accent || T.text;
  const valeur = donnee
    ? <Donnee donnee={donnee} T={T} dateRef={dateRef}>{value}</Donnee>
    : value;
  return (
    <div onClick={onClick}
      className={onClick ? "p2-kpi-clic" : undefined}
      style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 6px 18px rgba(16,24,40,0.06)",
      padding: "11px 13px",
      display: "flex", flexDirection: "column", gap: 6,
      minWidth: 0,
      cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
        color: T.textMuted,
      }}>
        {icon && (
          <span style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            background: `color-mix(in srgb, ${iconColor || T.textMuted} 18%, transparent)`,
            color: iconColor || T.textMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={icon} size={11} strokeWidth={2.4}/>
          </span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: FONT.md.size + 4, fontWeight: bold ? 900 : 800,
        color: valColor, letterSpacing: -.4, lineHeight: 1.1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {valeur}
      </div>
      {sub && (
        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, opacity: .85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── MODALE DE VENTILATION (extraite de PhasageV2) ───────────────────────────
// `cfg` = { icon, color, title, subtitle, empty, rows, total, totalLabel,
//           totalColor, totalIsText } — construit depuis un objet Donnee :
//   cfgFromDonnee(donnee, { icon, color, totalColor })
export function cfgFromDonnee(d, { icon, color, totalColor } = {}) {
  if (!d) return null;
  return {
    icon, color,
    title: d.titre, subtitle: d.sousTitre, empty: d.vide,
    rows: d.ventilation || [],
    total: d.totalTexte != null ? d.totalTexte : d.valeur,
    totalLabel: d.totalLabel,
    totalColor: totalColor || color,
    totalIsText: d.totalTexte != null,
  };
}

export function KpiDetailModal({ cfg, sousTitrePrefixe, T, onClose }) {
  if (!cfg) return null;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
          width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0,
            background: `color-mix(in srgb, ${cfg.color} 20%, transparent)`, color: cfg.color,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={cfg.icon} size={16}/>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>{cfg.title}</div>
            <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{sousTitrePrefixe ? `${sousTitrePrefixe} · ` : ""}{cfg.subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}><Icon as={X} size={18}/></button>
        </div>
        <div style={{ padding: "12px 20px" }}>
          {cfg.rows.length === 0 ? (
            <div style={{ fontSize: FONT.sm.size, color: T.textMuted, fontStyle: "italic" }}>{cfg.empty}</div>
          ) : cfg.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.main}</div>
                {r.sub && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{r.sub}</div>}
              </div>
              <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: r.rightColor || T.text, whiteSpace: "nowrap", flexShrink: 0 }}>{r.right}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.card }}>
          <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.textMuted }}>{cfg.totalLabel}</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: cfg.totalColor }}>{cfg.totalIsText ? cfg.total : eur(cfg.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── TABLEAU DES LOTS (heures, avancement, ratio de dérive) ──────────────────
// Consomme fin.lots du module. Lots vides masqués par défaut, bouton pour les
// afficher — même comportement que Phasage V2.
export function LotsTableau({ lots, T, compact = false }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const list = (lots || []).filter(l => showEmpty || !l.vide);
  const nbVides = (lots || []).filter(l => l.vide).length;
  const ratioColor = (r) => r == null ? T.textMuted : r > SEUIL_RATIO_DERIVE ? "#e15a5a" : r > 1 ? "#f5a623" : "#22c55e";
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? FONT.xs.size + 1 : FONT.sm.size }}>
        <thead>
          <tr style={{ color: T.textMuted, fontSize: FONT.xs.size, textTransform: "uppercase", letterSpacing: .6 }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Lot</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Heures</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Avanc.</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Dérive</th>
          </tr>
        </thead>
        <tbody>
          {list.map(l => (
            <tr key={l.id} style={{ borderTop: `1px solid ${T.border}` }}>
              <td style={{ padding: "7px 8px", color: T.text, fontWeight: 600 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: l.couleur || "#888", flexShrink: 0 }}/>
                  {l.label}
                  {l.vide && <span style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic" }}>vide</span>}
                </span>
              </td>
              <td style={{ padding: "7px 8px", textAlign: "right", color: couleurDepassement(l.heuresReelles, l.heuresVendues) || T.textSub, whiteSpace: "nowrap" }}>
                {fmtH(l.heuresReelles)}h / {fmtH(l.heuresVendues)}h
              </td>
              <td style={{ padding: "7px 8px", textAlign: "right", color: T.text, fontWeight: 700 }}>{l.avancement}%</td>
              <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800, color: ratioColor(l.ratioDerive), whiteSpace: "nowrap" }}>
                {l.ratioDerive == null ? "—" : `×${l.ratioDerive.toFixed(2)}`}
                {l.ratioDerive != null && l.ratioDerive > SEUIL_RATIO_DERIVE && (
                  <Icon as={AlertTriangle} size={11} style={{ marginLeft: 4, verticalAlign: "-1px" }}/>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {nbVides > 0 && (
        <button onClick={() => setShowEmpty(v => !v)} style={{
          marginTop: 6, background: "transparent", border: "none", color: T.textMuted,
          fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}>
          <Icon as={showEmpty ? EyeOff : Eye} size={11}/>
          {showEmpty ? "Masquer" : "Afficher"} les {nbVides} lot{nbVides > 1 ? "s" : ""} vide{nbVides > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
