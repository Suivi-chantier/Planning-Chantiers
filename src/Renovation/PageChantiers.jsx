import React, { useState, useEffect, useRef } from "react";
import { supabase, photoTransform, getClientId } from "../supabase";
import { getBranchAccent, FONT, RADIUS, PHASES_DEFAUT, loadPhases, calcAvancementPondere, TAUX_MO_PREV_DEFAUT } from "../constants";
import { indexPointagesParTache, heuresEff, coutMOEff, sumLibreEtIndirect } from "../pointages";
// SOURCE DE VÉRITÉ des calculs financiers/avancement V2 : src/chantierFinance.js
// (mêmes formules que Phasage V2). Les branches V1 legacy (plan_travaux sans
// ouvrages) gardent leur calcul historique, qui n'existe nulle part ailleurs.
import {
  computeChantierFinance,
  avancementChantier as cfAvancementChantier,
  tacheHeuresReelles as cfTacheHeuresReelles,
  statsGroupeChrono,
} from "../chantierFinance";
// QCD (Point 2a) : calculs du triangle Qualité/Coût/Délai — module dédié,
// indépendant de DashboardAnalyse (formules jugées fausses par le métier).
import {
  computeQCD, qcdDepuisFinance, QCD_METHODE,
  lireOverridesQCD, construireOverrideQCD, QCD_OVERRIDE_KEYS, QCD_STATUTS_FORCABLES,
} from "./qcd";
// Cycle de vie du chantier (Point 2a) : référentiel des 6 phases (devis → SAV),
// déduction de la phase (modèle frise CRM Invest) et évaluation des étapes.
// Rien à voir avec les phases V1 du phasage (plan_travaux[phase_id]).
import {
  CYCLE_VIE_PHASES, getPhase, etapesTravauxDepuisGroupes,
  computeCycleVie, evaluerEtape, lireEtatsEtapes, lirePhaseDeclaree,
  CV_META_PHASE_DECLAREE, CV_META_ETAPES,
  etapesSituationsTravaux, normaliserSeuilsSituations, SEUILS_SITUATIONS,
} from "./cycleVie";
// Documents du cycle de vie : bucket privé "chantier-documents" (URLs signées).
import { uploadDocumentChantier, urlDocumentChantier, supprimerDocumentChantier, ACCEPT_DOCS } from "./storageChantier";
import { Icon } from "../ui";
import { CARD_SHADOW, SummaryBar, MobileTabs } from "../mobileUI";
import { useIsMobile } from "./Navigation";
import {
  HardHat, Building2, ArrowLeft, Pencil, Camera, Link2, MapPin,
  ChevronLeft, ChevronRight, ExternalLink, X, Check, ClipboardList,
  Wallet, Banknote, Receipt, TrendingDown, TrendingUp, Image as ImageIcon,
  Clock, Search, Package, Calendar, Info, StickyNote, Bold, Italic, Underline,
  Palette, List, ListOrdered, ShieldCheck, Upload, Paperclip, Send,
} from "lucide-react";

// PHASES dynamiques : chargées depuis Admin → Phases (fallback sur défaut)
let PHASES = [...PHASES_DEFAUT];
loadPhases().then(p => { PHASES = p; });

// Format heures : 1 décimale max, sans .0 si entier (évite "11.200000003h")
const fmtH = (n) => +(parseFloat(n) || 0).toFixed(1);

const STATUTS = {
  en_cours: { label: "En cours",  color: "#FFC300", bg: "rgba(255,195,0,0.15)"  },
  termine:  { label: "Terminé",   color: "#22c55e", bg: "rgba(34,197,94,0.15)"  },
  planifie: { label: "Planifié",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  en_pause: { label: "En pause",  color: "#f97316", bg: "rgba(249,115,22,0.15)" },
};

function StatutBadge({ statut }) {
  const s = STATUTS[statut] || STATUTS.en_cours;
  return (
    <span style={{
      fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8,
      textTransform: "uppercase", padding: "3px 10px",
      borderRadius: RADIUS.pill, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`,
    }}>{s.label}</span>
  );
}

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

// ─── BANDEAU QCD (Point 2a) ──────────────────────────────────────────────────
// Triangle Qualité / Coût / Délai en tête de la fiche chantier. Affichage
// uniquement : tous les calculs viennent de src/Renovation/qcd.js (module pur).
// Clic sur un sommet (badge ou triangle) → panneau de détail : valeur, calcul
// en clair (QCD_METHODE) et explication renvoyée par le module.
const QCD_COULEURS = {
  vert:   { color: "#22c55e", bg: "rgba(34,197,94,0.12)"   },
  orange: { color: "#f5a623", bg: "rgba(245,166,35,0.12)"  },
  rouge:  { color: "#e15a5a", bg: "rgba(225,90,90,0.12)"   },
  gris:   { color: "#94a3b8", bg: "rgba(148,163,184,0.10)" },
};

// Libellé du statut, contextualisé par axe pour les cas gris (le gris du Délai
// en démarrage n'est pas le gris de la Qualité non contrôlée).
const qcdStatutLabel = (axeId, s) => {
  if (s.statut === "vert")   return "OK";
  if (s.statut === "orange") return "À surveiller";
  if (s.statut === "rouge")  return "Alerte";
  if (axeId === "qualite")   return "Non évalué";
  if (axeId === "delai")     return s.demarrage ? "Trop tôt pour juger" : "Non calculable";
  return "Non évaluable";
};

function BandeauQCD({ qcd, overrides, sansPhasage, peutForcer, onForcer, onRetourAuto, T }) {
  const [detail, setDetail] = useState(null); // "qualite" | "cout" | "delai" | null
  const [formOpen, setFormOpen] = useState(false);       // formulaire de correction manuelle
  const [formStatut, setFormStatut] = useState(null);
  const [formCommentaire, setFormCommentaire] = useState("");
  const [saving, setSaving] = useState(false);
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // Sans phasage lié, les trois sommets sont gris avec une explication dédiée.
  const placeholder = {
    statut: "gris", valeur: null, valeurFormatee: "—", demarrage: false,
    explication: "Aucun phasage lié à ce chantier : liez un phasage pour calculer cet indicateur.",
  };
  const sommets = {
    qualite: qcd?.qualite || placeholder,
    cout:    qcd?.cout    || placeholder,
    delai:   qcd?.delai   || placeholder,
  };
  const AXES = [
    { id: "qualite", label: "Qualité", icon: ShieldCheck },
    { id: "cout",    label: "Coût",    icon: Wallet },
    { id: "delai",   label: "Délai",   icon: Clock },
  ];
  const toggle = (id) => { setDetail(d => (d === id ? null : id)); setFormOpen(false); };
  const detailSommet = detail ? sommets[detail] : null;
  const detailOverride = detail ? (overrides?.[detail] || null) : null;

  const ouvrirForm = () => {
    setFormStatut(detailOverride?.statut || null);
    setFormCommentaire(detailOverride?.commentaire || "");
    setFormOpen(true);
  };
  const soumettreForm = async () => {
    if (!formStatut || !formCommentaire.trim() || saving) return;
    setSaving(true);
    const ok = await onForcer?.(detail, formStatut, formCommentaire);
    setSaving(false);
    if (ok) setFormOpen(false);
  };
  const revenirAuto = async () => {
    if (saving) return;
    setSaving(true);
    await onRetourAuto?.(detail);
    setSaving(false);
    setFormOpen(false);
  };

  // Petit bouton bordé, cohérent avec les boutons secondaires de la fiche.
  const btnStyle = (disabled) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "transparent", border: `1px solid ${border}`,
    borderRadius: RADIUS.md, padding: "6px 12px",
    color: textSub, fontSize: FONT.xs.size + 1, fontWeight: 600,
    cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
    opacity: disabled ? .5 : 1,
  });

  return (
    <div className="ch-stat-card">
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
        letterSpacing: 1.2, textTransform: "uppercase",
      }}>
        Pilotage QCD
        <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", opacity: .7 }}>
          — cliquer sur un sommet pour le détail
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* Triangle : Qualité en haut, Coût en bas à gauche, Délai en bas à droite */}
        <svg className="ch-qcd-tri" width="94" height="80" viewBox="0 0 100 84" style={{ flexShrink: 0 }}>
          <polygon points="50,15 15,69 85,69" fill="none" stroke={border} strokeWidth="2"/>
          {[["qualite", 50, 15, "Q"], ["cout", 15, 69, "C"], ["delai", 85, 69, "D"]].map(([id, cx, cy, lettre]) => {
            const ov = overrides?.[id] || null;
            const col = QCD_COULEURS[ov ? ov.statut : sommets[id].statut].color;
            return (
              <g key={id} onClick={() => toggle(id)} style={{ cursor: "pointer" }}>
                {/* anneau pointillé = statut forcé à la main */}
                {ov && <circle cx={cx} cy={cy} r="14.5" fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="3 2.5"/>}
                <circle cx={cx} cy={cy} r="12" fill={col}
                  stroke={detail === id ? text : "transparent"} strokeWidth="2"/>
                <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff"
                  style={{ pointerEvents: "none", userSelect: "none" }}>{lettre}</text>
              </g>
            );
          })}
        </svg>

        <div className="ch-qcd-grid" style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, minWidth: 0 }}>
          {AXES.map(a => {
            const s = sommets[a.id];
            const ov = overrides?.[a.id] || null;
            const st = QCD_COULEURS[ov ? ov.statut : s.statut]; // statut effectif : le forcé prime
            const actif = detail === a.id;
            return (
              <button key={a.id} className="ch-qcd-som" onClick={() => toggle(a.id)} style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
                background: actif ? st.bg : "transparent",
                border: `1px solid ${actif ? `${st.color}66` : border}`,
                borderRadius: 12, padding: "10px 12px", minWidth: 0,
                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                transition: "background .12s, border-color .12s",
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: FONT.xs.size, color: textMuted, fontWeight: 600,
                  letterSpacing: .3, textTransform: "uppercase",
                }}>
                  <Icon as={a.icon} size={11}/> {a.label}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: st.color, boxShadow: `0 0 8px ${st.color}55`, flexShrink: 0 }}/>
                  <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: st.color, lineHeight: 1.1 }}>
                    {ov ? qcdStatutLabel(a.id, { statut: ov.statut }) : qcdStatutLabel(a.id, s)}
                  </span>
                  {ov && (
                    <span title="Statut forcé à la main" style={{ display: "inline-flex" }}>
                      <Icon as={Pencil} size={11} color={st.color}/>
                    </span>
                  )}
                  {!ov && s.valeurFormatee !== "—" && (
                    <span style={{ fontSize: FONT.xs.size + 1, color: textSub, fontWeight: 600 }}>
                      {a.id === "delai" ? `indice ${s.valeurFormatee}` : s.valeurFormatee}
                    </span>
                  )}
                </span>
                {/* Rappel de la valeur automatique quand le sommet est forcé */}
                {ov && (
                  <span style={{ fontSize: FONT.xs.size, color: textMuted, fontWeight: 600 }}>
                    auto : {qcdStatutLabel(a.id, s)}{s.valeurFormatee !== "—" ? ` · ${s.valeurFormatee}` : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panneau de détail : valeur, explication du module, calcul en clair,
          correction manuelle (l'override se SUPERPOSE : l'auto reste visible) */}
      {detail && detailSommet && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: text }}>{QCD_METHODE[detail].titre}</span>
            {detailOverride ? (
              <>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
                  color: QCD_COULEURS[detailOverride.statut].color, background: QCD_COULEURS[detailOverride.statut].bg,
                  border: `1px dashed ${QCD_COULEURS[detailOverride.statut].color}`,
                }}>
                  <Icon as={Pencil} size={10}/>
                  {qcdStatutLabel(detail, { statut: detailOverride.statut })} (forcé)
                </span>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 600 }}>
                  auto : <span style={{ color: QCD_COULEURS[detailSommet.statut].color, fontWeight: 700 }}>{qcdStatutLabel(detail, detailSommet)}</span>
                  {detailSommet.valeurFormatee !== "—" ? ` (${detail === "delai" ? "indice " : ""}${detailSommet.valeurFormatee})` : ""}
                </span>
              </>
            ) : (
              <>
                <span style={{
                  fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
                  color: QCD_COULEURS[detailSommet.statut].color, background: QCD_COULEURS[detailSommet.statut].bg,
                  border: `1px solid ${QCD_COULEURS[detailSommet.statut].color}40`,
                }}>{qcdStatutLabel(detail, detailSommet)}</span>
                {detailSommet.valeurFormatee !== "—" && (
                  <span style={{ fontSize: FONT.sm.size, color: textSub, fontWeight: 700 }}>
                    {detail === "delai" ? `Indice : ${detailSommet.valeurFormatee}`
                      : detail === "qualite" ? `Conformité : ${detailSommet.valeurFormatee}`
                      : `Ratio retenu : ${detailSommet.valeurFormatee}`}
                  </span>
                )}
              </>
            )}
          </div>
          {detailOverride && (
            <div style={{ fontSize: FONT.sm.size, color: textSub, marginBottom: 6 }}>
              Forcé{detailOverride.auteur ? ` par ${detailOverride.auteur}` : ""}
              {detailOverride.date ? ` le ${new Date(detailOverride.date).toLocaleDateString("fr-FR")}` : ""}
              {" — « "}{detailOverride.commentaire}{" »"}
            </div>
          )}
          {detail === "cout" && detailSommet.mo ? (
            // Coût : les deux sous-ratios (MO / matériaux), chacun avec son statut.
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[detailSommet.mo, detailSommet.materiaux].map(r => (
                <div key={r.libelle} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT.sm.size, color: textSub }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: QCD_COULEURS[r.statut].color, flexShrink: 0 }}/>
                  {r.explication}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: FONT.sm.size, color: textSub }}>{detailSommet.explication}</div>
          )}
          <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: textMuted, display: "flex", gap: 6 }}>
            <Icon as={Info} size={12} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span>Calcul : {QCD_METHODE[detail].formule}. {QCD_METHODE[detail].description}</span>
          </div>

          {/* Correction manuelle : forcer / modifier / revenir à l'automatique */}
          {peutForcer && !formOpen && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {detailOverride ? (
                <>
                  <button onClick={revenirAuto} disabled={saving} style={btnStyle(saving)}>
                    <Icon as={X} size={12}/> Revenir à l'automatique
                  </button>
                  <button onClick={ouvrirForm} disabled={saving} style={btnStyle(saving)}>
                    <Icon as={Pencil} size={12}/> Modifier la correction
                  </button>
                </>
              ) : (
                <button onClick={ouvrirForm} style={btnStyle(false)}>
                  <Icon as={Pencil} size={12}/> Corriger à la main
                </button>
              )}
            </div>
          )}
          {peutForcer && formOpen && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {QCD_STATUTS_FORCABLES.map(sid => {
                const c = QCD_COULEURS[sid];
                const sel = formStatut === sid;
                return (
                  <button key={sid} onClick={() => setFormStatut(sid)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
                    borderRadius: RADIUS.pill, border: `1px solid ${sel ? c.color : border}`,
                    background: sel ? c.bg : "transparent", color: c.color,
                    fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }}/>
                    {sid === "vert" ? "Vert" : sid === "orange" ? "Orange" : "Rouge"}
                  </button>
                );
              })}
              <input value={formCommentaire} onChange={e => setFormCommentaire(e.target.value)}
                placeholder="Commentaire (obligatoire)"
                onKeyDown={e => { if (e.key === "Enter") soumettreForm(); }}
                style={{
                  flex: 1, minWidth: 180, padding: "7px 10px", borderRadius: RADIUS.md,
                  border: `1px solid ${border}`, background: "transparent", color: text,
                  fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none",
                }}/>
              <button onClick={soumettreForm} disabled={!formStatut || !formCommentaire.trim() || saving}
                style={btnStyle(!formStatut || !formCommentaire.trim() || saving)}>
                <Icon as={Check} size={12}/> Forcer
              </button>
              <button onClick={() => setFormOpen(false)} disabled={saving} style={btnStyle(saving)}>
                Annuler
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MODALE « ENVOYER UN DOCUMENT » ──────────────────────────────────────────
// Envoie une pièce jointe d'étape par email aux utilisateurs de l'application
// (table utilisateurs — comptes actifs avec un vrai email ; les comptes
// locaux @profero.local n'ont pas de boîte). Passe par /api/send-email
// (proxy Resend) : le fichier est JOINT s'il fait ≤ 3 Mo (limite du body
// Vercel), et l'email contient dans tous les cas un lien signé valable
// 7 jours (le bucket chantier-documents est privé).
const escHtml = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ModaleEnvoiDocument({ envoi, chantierNom, auteur, T, onClose }) {
  const [users, setUsers] = useState(null); // null = chargement
  const [sel, setSel] = useState(() => new Set());
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const surface   = T?.surface   || "#262a32";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  useEffect(() => {
    let actif = true;
    supabase.from("utilisateurs").select("id, nom, email, actif").order("nom")
      .then(({ data, error }) => {
        if (!actif) return;
        setUsers((error ? [] : (data || [])).filter(u =>
          u.actif !== false && u.email && !String(u.email).toLowerCase().endsWith("@profero.local")));
      });
    return () => { actif = false; };
  }, []);

  const toggle = (email) => setSel(s => {
    const n = new Set(s);
    if (n.has(email)) n.delete(email); else n.add(email);
    return n;
  });

  const envoyer = async () => {
    if (!sel.size || enCours) return;
    setEnCours(true);
    try {
      const pj = envoi.pj;
      const lien = await urlDocumentChantier(pj.path, 7 * 24 * 3600);
      if (!lien) throw new Error("lien du document introuvable (bucket « chantier-documents »)");
      // Fichier joint si ≤ 3 Mo ; sinon le lien signé suffit.
      let attachments = null;
      if ((pj.taille || 0) > 0 && pj.taille <= 3 * 1024 * 1024) {
        try {
          const rep = await fetch(lien);
          if (rep.ok) {
            const blob = await rep.blob();
            const base64 = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
              fr.onerror = reject;
              fr.readAsDataURL(blob);
            });
            if (base64) attachments = [{ filename: pj.nom || "document", content: base64 }];
          }
        } catch { /* repli : lien seul */ }
      }
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
        <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
          <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Document de chantier</div>
          <div style="color:#fff;font-size:20px;font-weight:800">📎 ${escHtml(pj.nom || "Document")}</div>
        </div>
        <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px;font-size:14px;line-height:1.7">
          <p style="margin:0 0 10px">${escHtml(auteur || "Un utilisateur")} vous partage un document du chantier <strong>${escHtml(chantierNom || "")}</strong>${envoi.etapeNom ? ` (étape « ${escHtml(envoi.etapeNom)} »)` : ""}.</p>
          ${message.trim() ? `<p style="margin:0 0 14px;padding:10px 14px;background:#f6f7fb;border-left:3px solid #FFC200;border-radius:4px">${escHtml(message).replace(/\n/g, "<br/>")}</p>` : ""}
          ${attachments ? `<p style="margin:0 0 10px">Le document est joint à cet email.</p>` : ""}
          <p style="margin:14px 0 0"><a href="${lien}" style="display:inline-block;background:#FFC200;color:#1a1f2e;font-weight:700;padding:11px 20px;border-radius:8px;text-decoration:none">Ouvrir le document</a></p>
          <p style="margin:10px 0 0;font-size:11px;color:#999">Lien valable 7 jours.</p>
        </div>
        <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
      </div>`;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [...sel],
          subject: `Chantier ${chantierNom || ""} — ${pj.nom || "document"}`,
          html,
          ...(attachments ? { attachments } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "envoi refusé");
      onClose();
    } catch (e) {
      alert(`Envoi impossible : ${e?.message || e}`);
    }
    setEnCours(false);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(3px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || surface, borderRadius: RADIUS.xl, padding: 22,
        width: "100%", maxWidth: 440, border: `1px solid ${border}`,
        display: "flex", flexDirection: "column", gap: 14, maxHeight: "86vh",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon as={Send} size={18} color={text}/>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Envoyer « {envoi.pj?.nom || "document"} »
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
              {chantierNom}{envoi.etapeNom ? ` · ${envoi.etapeNom}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: RADIUS.sm, border: `1px solid ${border}`,
            background: "transparent", color: textMuted, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}><Icon as={X} size={14}/></button>
        </div>

        <div style={{ overflowY: "auto", maxHeight: 280, display: "flex", flexDirection: "column", gap: 4 }}>
          {users === null ? (
            <div style={{ color: textMuted, fontSize: FONT.sm.size, padding: "10px 0" }}>Chargement des utilisateurs…</div>
          ) : users.length === 0 ? (
            <div style={{ color: textMuted, fontSize: FONT.sm.size, padding: "10px 0", fontStyle: "italic" }}>
              Aucun utilisateur avec une adresse email.
            </div>
          ) : users.map(u => (
            <label key={u.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: RADIUS.md, cursor: "pointer",
              border: `1px solid ${sel.has(u.email) ? "#22c55e66" : border}`,
              background: sel.has(u.email) ? "rgba(34,197,94,0.08)" : "transparent",
            }}>
              <input type="checkbox" checked={sel.has(u.email)} onChange={() => toggle(u.email)}
                style={{ width: 15, height: 15, accentColor: "#22c55e", cursor: "pointer", flexShrink: 0 }}/>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: FONT.sm.size, fontWeight: 700, color: text }}>{u.nom || u.email}</span>
                <span style={{ display: "block", fontSize: FONT.xs.size, color: textMuted, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
              </span>
            </label>
          ))}
        </div>

        <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Message (optionnel)…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 11px",
            borderRadius: RADIUS.md, border: `1px solid ${border}`,
            background: "transparent", color: text, fontFamily: "inherit",
            fontSize: 16, resize: "vertical", outline: "none",
          }}/>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={enCours} style={{
            padding: "9px 16px", borderRadius: RADIUS.md, border: `1px solid ${border}`,
            background: "transparent", color: textSub, fontSize: FONT.sm.size, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>Annuler</button>
          <button onClick={envoyer} disabled={!sel.size || enCours} style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
            background: !sel.size || enCours ? (textMuted) : "#22c55e", color: "#fff",
            fontSize: FONT.sm.size, fontWeight: 800,
            cursor: !sel.size || enCours ? "default" : "pointer", fontFamily: "inherit",
          }}>
            <Icon as={Send} size={14}/>
            {enCours ? "Envoi…" : `Envoyer${sel.size ? ` (${sel.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── UNE ÉTAPE DU CYCLE DE VIE (ligne de la frise) ───────────────────────────
// Affiche l'état (fait / à faire + raison + données saisies) et porte les
// actions du Prompt 6 : coche manuelle (avec champs), import de document qui
// VALIDE l'étape, journal SAV, et pièce jointe possible sur TOUTE étape.
// Les étapes "auto" n'ont aucune action de validation (jamais faussées à la
// main) mais acceptent les pièces jointes en preuve.
const CV_CHOIX_LABELS = { accepte: "Accepté", en_attente: "En attente", refuse: "Refusé" };

function EtapeCycleVie({ etape, peutModifier, actions, T }) {
  const [formOpen, setFormOpen] = useState(false);
  const [valeurs, setValeurs] = useState({});
  const [journalTexte, setJournalTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const fileDocRef = useRef(null); // import qui VALIDE (nature document)
  const filePjRef  = useRef(null); // pièce jointe simple (toute étape)
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  const etat = etape.etat || {};
  const pjs = Array.isArray(etat.pieces_jointes) ? etat.pieces_jointes : [];
  const entreesJournal = Array.isArray(etat.journal) ? etat.journal : [];
  const champs = etape.champs || [];

  const btn = (disabled) => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "transparent", border: `1px solid ${border}`,
    borderRadius: RADIUS.md, padding: "4px 10px",
    color: textSub, fontSize: FONT.xs.size + 1, fontWeight: 600,
    cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
    opacity: disabled ? .5 : 1,
  });
  const inputStyle = {
    padding: "5px 8px", borderRadius: RADIUS.md, border: `1px solid ${border}`,
    background: "transparent", color: text, fontSize: FONT.xs.size + 1,
    fontFamily: "inherit", outline: "none", maxWidth: 150,
  };

  const valider = async (donnees) => {
    setBusy(true);
    await actions.onValider(etape.id, donnees || {});
    setBusy(false);
    setFormOpen(false);
  };
  const devalider = async () => { setBusy(true); await actions.onDevalider(etape.id); setBusy(false); };
  const importerDoc = async (file) => {
    if (!file) return;
    setBusy(true);
    await actions.onAjouterPJ(etape.id, file, { valide: true, donnees: valeurs });
    setBusy(false);
  };
  const joindre = async (file) => {
    if (!file) return;
    setBusy(true);
    await actions.onAjouterPJ(etape.id, file, { valide: false });
    setBusy(false);
  };
  const ajouterJournal = async () => {
    if (!journalTexte.trim() || busy) return;
    setBusy(true);
    await actions.onAjouterJournal(etape.id, journalTexte);
    setBusy(false);
    setJournalTexte("");
  };

  const champInput = (c) => c.type === "choix" ? (
    <select key={c.id} value={valeurs[c.id] || ""} title={c.nom}
      onChange={e => setValeurs(v => ({ ...v, [c.id]: e.target.value }))} style={inputStyle}>
      <option value="">{c.nom}…</option>
      {(c.options || []).map(o => <option key={o} value={o}>{CV_CHOIX_LABELS[o] || o}</option>)}
    </select>
  ) : (
    <input key={c.id} type={c.type === "nombre" ? "number" : c.type === "date" ? "date" : "text"}
      value={valeurs[c.id] || ""} placeholder={c.nom} title={c.nom}
      onChange={e => setValeurs(v => ({ ...v, [c.id]: e.target.value }))} style={inputStyle}/>
  );

  // Résumé des données saisies (montant, date, réponse…), affiché sous la raison.
  const resume = champs
    .filter(c => etat.donnees?.[c.id] != null && etat.donnees[c.id] !== "")
    .map(c => `${c.nom} : ${c.type === "choix" ? (CV_CHOIX_LABELS[etat.donnees[c.id]] || etat.donnees[c.id]) : etat.donnees[c.id]}`)
    .join(" · ");

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{
        width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: etape.fait ? "#22c55e" : "transparent",
        border: `2px solid ${etape.fait ? "#22c55e" : border}`,
      }}>{etape.fait ? <Icon as={Check} size={10} color="#fff"/> : null}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: etape.fait ? text : textSub }}>{etape.nom}</span>
        <span style={{
          marginLeft: 7, fontSize: 9.5, fontWeight: 700, letterSpacing: .5,
          textTransform: "uppercase", color: textMuted,
          border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "1px 7px",
          verticalAlign: "middle",
        }}>{etape.nature}</span>
        {/* Facture de situation : seuil franchi et pas encore émise → signalée */}
        {etape.prete && !etape.fait && (
          <span style={{
            marginLeft: 6, fontSize: 9.5, fontWeight: 800, letterSpacing: .5,
            textTransform: "uppercase", color: "#f59e0b",
            border: "1px solid #f59e0b88", background: "#f59e0b14",
            borderRadius: RADIUS.pill, padding: "1px 7px", verticalAlign: "middle",
          }}>à émettre</span>
        )}
        <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 1 }}>{etape.raison}</div>
        {resume && <div style={{ fontSize: FONT.xs.size + 1, color: textSub, marginTop: 2, fontWeight: 600 }}>{resume}</div>}

        {/* Entrée de GROUPE (phase Travaux) : avancement + témoin de contrôle
            (emplacement explicite du « contrôlé / non contrôlé » — Point 2 b). */}
        {etape.signal === "groupe_controle" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, maxWidth: 380, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <ProgressBar value={etape.avancement || 0} color={etape.couleur || undefined} height={5}/>
            </div>
            <span style={{ fontSize: FONT.xs.size + 1, color: textSub, fontWeight: 700, flexShrink: 0 }}>
              {Math.round(etape.avancement || 0)} %{etape.termine ? " · terminé" : ""}
            </span>
            <span title="Témoin de contrôle de fin de groupe (Point 2 b)" style={{
              fontSize: FONT.xs.size, fontWeight: 700, padding: "1px 8px", borderRadius: RADIUS.pill,
              color: etape.fait ? "#22c55e" : textMuted,
              border: `1px ${etape.fait ? "solid #22c55e" : `dashed ${border}`}`,
              flexShrink: 0,
            }}>{etape.fait ? "contrôlé" : "non contrôlé"}</span>
          </div>
        )}

        {/* Pièces jointes : consultables depuis la frise (URL signée) */}
        {pjs.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {pjs.map(pj => (
              <span key={pj.path} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "2px 8px",
                fontSize: FONT.xs.size + 1, color: textSub, maxWidth: "100%",
              }}>
                <button onClick={() => actions.onOuvrirPJ(pj)} title="Ouvrir / télécharger" style={{
                  display: "inline-flex", alignItems: "center", gap: 4, background: "transparent",
                  border: "none", color: textSub, cursor: "pointer", fontFamily: "inherit",
                  fontSize: FONT.xs.size + 1, padding: 0, maxWidth: 220, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  <Icon as={Paperclip} size={10}/><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{pj.nom}</span>
                </button>
                <button onClick={() => actions.onEnvoyerPJ?.(etape, pj)} title="Envoyer par email à des utilisateurs de l'application" style={{
                  background: "transparent", border: "none", color: textMuted, cursor: "pointer",
                  padding: 0, display: "inline-flex",
                }}><Icon as={Send} size={10}/></button>
                {peutModifier && (
                  <button onClick={() => actions.onSupprimerPJ(etape.id, pj)} title="Supprimer la pièce jointe" style={{
                    background: "transparent", border: "none", color: textMuted, cursor: "pointer",
                    padding: 0, display: "inline-flex",
                  }}><Icon as={X} size={10}/></button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Journal (SAV) */}
        {entreesJournal.length > 0 && (
          <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
            {entreesJournal.map((j, i) => (
              <div key={i} style={{ fontSize: FONT.xs.size + 1, color: textSub }}>
                · {j.date ? String(j.date).slice(0, 10) : ""} — {j.texte}{j.auteur ? ` (${j.auteur})` : ""}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {peutModifier && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
            {etape.nature === "coche" && !etape.journal && (etape.fait ? (
              <button onClick={devalider} disabled={busy} style={btn(busy)}><Icon as={X} size={11}/> Annuler la validation</button>
            ) : formOpen ? (
              <>
                {champs.map(champInput)}
                <button onClick={() => valider(valeurs)} disabled={busy} style={btn(busy)}><Icon as={Check} size={11}/> Valider</button>
                <button onClick={() => setFormOpen(false)} disabled={busy} style={btn(busy)}>Annuler</button>
              </>
            ) : (
              <button onClick={() => { if (champs.length) { setValeurs(etat.donnees || {}); setFormOpen(true); } else valider({}); }}
                disabled={busy} style={btn(busy)}>
                <Icon as={Check} size={11}/> Valider{champs.length ? "…" : ""}
              </button>
            ))}
            {etape.nature === "document" && !etape.fait && (
              <>
                {champs.filter(c => c.type === "date").map(champInput)}
                <button onClick={() => fileDocRef.current?.click()} disabled={busy} style={btn(busy)}>
                  <Icon as={Upload} size={11}/> Importer le document
                </button>
                <input ref={fileDocRef} type="file" accept={ACCEPT_DOCS} style={{ display: "none" }}
                  onChange={e => { importerDoc(e.target.files?.[0]); e.target.value = ""; }}/>
              </>
            )}
            {etape.nature === "document" && etape.fait && (
              <button onClick={devalider} disabled={busy} style={btn(busy)}><Icon as={X} size={11}/> Annuler la validation</button>
            )}
            {etape.journal && (
              <>
                <input value={journalTexte} onChange={e => setJournalTexte(e.target.value)}
                  placeholder="Intervention SAV…" style={{ ...inputStyle, maxWidth: 240, flex: 1, minWidth: 140 }}
                  onKeyDown={e => { if (e.key === "Enter") ajouterJournal(); }}/>
                <button onClick={ajouterJournal} disabled={!journalTexte.trim() || busy} style={btn(!journalTexte.trim() || busy)}>Ajouter</button>
              </>
            )}
            <button onClick={() => filePjRef.current?.click()} disabled={busy} style={btn(busy)}
              title="Joindre une preuve (photo ou document) — possible sur toute étape">
              <Icon as={Paperclip} size={11}/> Joindre
            </button>
            <input ref={filePjRef} type="file" accept={ACCEPT_DOCS} style={{ display: "none" }}
              onChange={e => { joindre(e.target.files?.[0]); e.target.value = ""; }}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FRISE DU CYCLE DE VIE (Point 2a) ────────────────────────────────────────
// Les 6 phases du chantier (devis → SAV), sous le bandeau QCD. Affichage pur :
// le positionnement vient de computeCycleVie (src/Renovation/cycleVie.js),
// sur le modèle de la frise CRM Invest — phase déclarée à la main PRIORITAIRE,
// phase déduite toujours visible à côté, raisons affichées.
function FriseCycleVie({ cv, cvCtx, chronoGroupes, statsGroupes, avancementChantier, seuilsSituations, peutModifier, onDeclarer, actionsEtape, T }) {
  const [saving, setSaving] = useState(false);
  const [phaseVue, setPhaseVue] = useState(null); // phase consultée (null = suivre la phase en cours)
  const surface   = T?.surface   || "#262a32";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  const declarer = async (phaseId) => {
    if (!peutModifier || saving) return;
    setSaving(true);
    await onDeclarer?.(phaseId);
    setSaving(false);
  };

  return (
    <div className="ch-stat-card">
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
        fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
        letterSpacing: 1.2, textTransform: "uppercase",
      }}>
        Cycle de vie du chantier
        {cv && (
          <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", opacity: .7 }}>
            — cliquer sur une phase pour consulter ses étapes et documents
          </span>
        )}
      </div>

      {!cv ? (
        <div style={{ fontSize: FONT.sm.size, color: textMuted, fontStyle: "italic" }}>
          Aucun phasage lié à ce chantier : la frise s'activera dès qu'un phasage est lié.
        </div>
      ) : (
        <>
          {/* Les 6 phases sur un rail horizontal (scroll sur mobile) */}
          <div style={{ overflowX: "auto", paddingBottom: 4 }}>
            <div style={{ position: "relative", minWidth: 560 }}>
              <div style={{ position: "absolute", left: 32, right: 32, top: 15, height: 2, background: border }}/>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6, position: "relative" }}>
                {CYCLE_VIE_PHASES.map(ph => {
                  const courante = ph.id === cv.phaseId;
                  const atteinte = ph.ordre < cv.ordre;
                  const consultee = ph.id === (phaseVue || cv.phaseId);
                  return (
                    <button key={ph.id} onClick={() => setPhaseVue(ph.id === cv.phaseId ? null : ph.id)}
                      title={`Voir les étapes de « ${ph.nom} »`}
                      style={{
                        background: "transparent", border: "none", padding: 0,
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0,
                      }}>
                      <span style={{
                        width: courante ? 32 : 26, height: courante ? 32 : 26, borderRadius: "50%",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: (atteinte || courante) ? ph.couleur : surface,
                        border: `2px solid ${(atteinte || courante) ? ph.couleur : (consultee ? text : border)}`,
                        color: (atteinte || courante) ? "#fff" : textMuted,
                        fontSize: 12, fontWeight: 800, flexShrink: 0,
                        boxShadow: courante ? `0 0 10px ${ph.couleur}66` : (consultee ? `0 0 0 2px ${border}` : "none"),
                        marginTop: courante ? 0 : 3,
                      }}>{ph.ordre}</span>
                      <span style={{
                        fontSize: FONT.xs.size, fontWeight: (courante || consultee) ? 800 : 600,
                        color: courante ? text : (consultee ? textSub : textMuted), textAlign: "center", lineHeight: 1.2,
                        textDecoration: consultee && !courante ? "underline" : "none",
                      }}>{ph.nom}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Raisons + déclaration manuelle (déduite toujours visible à côté) */}
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {cv.verrouManuel && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
                color: cv.phase.couleur, border: `1px dashed ${cv.phase.couleur}`,
              }}>
                <Icon as={Pencil} size={10}/> déclarée à la main{cv.declaredPar ? ` par ${cv.declaredPar}` : ""}
              </span>
            )}
            {cv.verrouManuel && (
              <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 600 }}>
                auto : <span style={{ color: cv.detectedPhase.couleur, fontWeight: 700 }}>{cv.detectedPhase.nom}</span>
              </span>
            )}
            <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>{cv.reasons.join(" · ")}</span>
            {cv.verrouManuel && peutModifier && (
              <button onClick={() => declarer(null)} disabled={saving} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "transparent", border: `1px solid ${border}`,
                borderRadius: RADIUS.md, padding: "5px 11px",
                color: textSub, fontSize: FONT.xs.size + 1, fontWeight: 600,
                cursor: saving ? "default" : "pointer", fontFamily: "inherit", opacity: saving ? .5 : 1,
              }}>
                <Icon as={X} size={12}/> Revenir à l'automatique
              </button>
            )}
          </div>
          {cv.detectedAhead && (
            <div style={{ marginTop: 5, fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 600 }}>
              Signaux plus avancés détectés : phase « {cv.detectedPhase.nom} ». Position conservée sur la phase déclarée à la main.
            </div>
          )}

          {/* Étapes de la phase consultée (par défaut : la phase en cours) —
              validables par leur action, avec pièces jointes (Prompt 6). */}
          {(() => {
            const phaseVueId = phaseVue || cv.phaseId;
            const phaseVueObj = getPhase(phaseVueId) || cv.phase;
            const etapes = (phaseVueId === "cv_travaux"
              // Travaux : les groupes d'exécution, puis les factures de
              // situation indexées sur l'avancement (seuils réglés en Admin).
              ? [...etapesTravauxDepuisGroupes(chronoGroupes, statsGroupes),
                 ...etapesSituationsTravaux(avancementChantier, seuilsSituations)]
              : (phaseVueObj?.etapes || [])
            ).map(e => ({ ...e, ...evaluerEtape(e, cvCtx), etat: (cvCtx?.etatsEtapes || {})[e.id] || null }));
            const estPhaseCourante = phaseVueId === cv.phaseId;
            return (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{
                    fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
                    letterSpacing: .5, textTransform: "uppercase",
                  }}>
                    Étapes — {phaseVueObj?.nom}
                  </span>
                  {estPhaseCourante ? (
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700, padding: "1px 8px", borderRadius: RADIUS.pill,
                      color: phaseVueObj?.couleur, border: `1px solid ${phaseVueObj?.couleur}55`,
                    }}>phase en cours</span>
                  ) : (
                    <>
                      {peutModifier && (
                        <button onClick={() => declarer(phaseVueId)} disabled={saving} style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          background: "transparent", border: `1px solid ${border}`,
                          borderRadius: RADIUS.md, padding: "4px 10px",
                          color: textSub, fontSize: FONT.xs.size + 1, fontWeight: 600,
                          cursor: saving ? "default" : "pointer", fontFamily: "inherit", opacity: saving ? .5 : 1,
                        }}>
                          <Icon as={Pencil} size={11}/> Déclarer comme phase en cours
                        </button>
                      )}
                      <button onClick={() => setPhaseVue(null)} style={{
                        background: "transparent", border: "none", padding: 0,
                        color: textMuted, fontSize: FONT.xs.size + 1, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit", textDecoration: "underline",
                      }}>revenir à la phase en cours</button>
                    </>
                  )}
                </div>
                {etapes.length === 0 ? (
                  <div style={{ fontSize: FONT.sm.size, color: textMuted, fontStyle: "italic" }}>
                    Aucun groupe d'exécution défini dans la vue chrono du phasage.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {etapes.map(e => (
                      <EtapeCycleVie key={e.id} etape={e} peutModifier={peutModifier} actions={actionsEtape} T={T}/>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ─── CALCULS ─────────────────────────────────────────────────────────────────
// P9 : coût MO dérivé du registre de pointage. Si le chantier n'a aucun pointage
// (legacy), on retombe sur l'ancien calcul heures_reelles × ouvriers[0].
// Le caller passe pointagesIndexes (résultat de indexPointagesParTache) et
// extraStats ({coutLibre, coutIndirect}) pour ajouter les heures hors-tâches.
// Total réel d'un jeu de lignes de commande (prix_total sinon PU × quantité).
// Aligné sur PhasageV2 : la somme des lignes de commande est la source de
// vérité du coût matériaux RÉEL.
function totalLignes(lignes) {
  return (lignes || []).reduce(
    (s, l) => s + (parseFloat(l.prix_total) || ((parseFloat(l.prix_unitaire) || 0) * (parseFloat(l.quantite) || 0)) || 0), 0);
}

function calcFinances(phasage, tauxHoraires = {}, pointagesIndexes = {}, extraStats = {}, pointagesChantier = [], commandeLignes = [], tauxMOPrev = 0) {
  const ouvrages = phasage?.ouvrages || [];
  const hasV2 = ouvrages.length > 0;
  if (!hasV2 && !phasage?.plan_travaux) return { coutMO: 0, coutMat: 0, fg: 0, coutTotal: 0, prixVendu: 0, marge: 0, margePct: 0, ecartVendu: null, fin: null };

  // ── V2 : tout vient du module (mêmes chiffres que Phasage V2, au centime).
  // Le vendu est la SOMME DES OUVRAGES (plus le devis saisi), la marge est la
  // MARGE NETTE (frais généraux déduits) et le coût MO gère le repli legacy
  // par tâche + la reprise d'antériorité — exactement comme Phasage V2.
  if (hasV2) {
    const fin = computeChantierFinance({
      phasage, pointages: pointagesChantier, commandeLignes, tauxHoraires, tauxMOPrev, lots: [],
    });
    const b = fin.brut;
    return {
      coutMO: b.coutMOTotalChantier,
      coutMat: b.coutMatChantier,
      fg: b.fgChantier,
      coutTotal: b.coutMOTotalChantier + b.coutMatChantier + b.fgChantier,
      prixVendu: b.prixHTChantier,
      marge: b.margeChantier,
      margePct: b.margePctChantier,
      ecartVendu: b.ecartVendu,
      montantDevis: b.montantDevis,
      moPrev: b.moPrevChantier,
      fin,
    };
  }

  // ── Repli V1 legacy (plan_travaux sans ouvrages) : calcul historique,
  // n'existe nulle part ailleurs (Phasage V2 ne gère pas la V1).
  let coutMO;
  if (Array.isArray(pointagesChantier) && pointagesChantier.length > 0) {
    coutMO = pointagesChantier.reduce((s, p) => s + (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0), 0);
  } else {
    const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
    const coutMOTaches = allTaches.reduce((s, t) => s + coutMOEff(t, pointagesIndexes, tauxHoraires), 0);
    coutMO = coutMOTaches + (extraStats.coutLibre || 0) + (extraStats.coutIndirect || 0);
  }
  const coutMat = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || [])).reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
  const coutTotal = coutMO + coutMat;
  const prixVendu = parseFloat(phasage?.prix_vendu) || parseFloat(phasage?.plan_travaux?.meta?.prix_vendu) || 0;
  const marge     = prixVendu - coutTotal;
  const margePct  = prixVendu > 0 ? (marge / prixVendu) * 100 : 0;
  return { coutMO, coutMat, fg: 0, coutTotal, prixVendu, marge, margePct, ecartVendu: null, fin: null };
}

function calcAvancement(phasage) {
  // V2 : avancement du module (pondéré heures_estimees par ouvrage puis
  // prix_ht au chantier — identique à Phasage V2). Repli V1 : plan_travaux.
  const ouvrages = phasage?.ouvrages || [];
  if (ouvrages.length > 0) return cfAvancementChantier(ouvrages);
  if (!phasage?.plan_travaux) return 0;
  const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
  return calcAvancementPondere(ouvrages, allTaches);
}

function getLastTaches(phasage, n = 5) {
  if (!phasage?.plan_travaux) return [];
  return PHASES.flatMap(ph =>
    (phasage.plan_travaux[ph.id] || []).map(t => ({ ...t, phaseLabel: ph.label, phaseCouleur: ph.couleur }))
  )
    .filter(t => (parseFloat(t.avancement) || 0) > 0)
    .sort((a, b) => (parseFloat(b.avancement) || 0) - (parseFloat(a.avancement) || 0))
    .slice(0, n);
}

// ─── CORRESPONDANCE NOM CHANTIER (robuste, insensible à la casse et accents) ─
function normalise(str) {
  return (str || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function chantierMatchCR(chantierNom, crAdresse) {
  const nom = normalise(chantierNom);
  const adr = normalise(crAdresse || "");
  if (!nom || !adr) return false;
  if (adr.includes(nom)) return true;
  const mots = nom.split(" ").filter(m => m.length > 2);
  if (mots.length === 0) return false;
  return mots.some(m => adr.includes(m));
}

function trouverPhasage(phasages, chantier) {
  if (!chantier) return null;
  // 1. Match exact par chantier_id (lien explicite)
  const exact = phasages.find(p => p.chantier_id === chantier.id);
  if (exact) return exact;

  // 2. Match par nom normalisé : on cherche dans les deux sens et par mot.
  const nomCh = normalise(chantier.nom);
  const motsCh = nomCh.split(" ").filter(m => m.length > 2);
  if (motsCh.length === 0) return null;

  return phasages.find(p => {
    const nomPh = normalise(p.chantier_nom || "");
    if (!nomPh) return false;
    // Inclusion directe dans les deux sens
    if (nomPh.includes(nomCh) || nomCh.includes(nomPh)) return true;
    // Au moins un mot significatif en commun
    const motsPh = nomPh.split(" ").filter(m => m.length > 2);
    return motsCh.some(m => motsPh.includes(m));
  }) || null;
}

const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

// ─── WIDGET NOTES (par chantier) ──────────────────────────────────────────────
// Éditeur riche minimal avec contentEditable natif + document.execCommand :
// gras, italique, souligné. Aucune dépendance externe. Autosave debounced
// 800ms. Subscription Realtime sur chantier_notes filtrée par chantier_id pour
// la collab. Quand un remote arrive pendant qu'on est focus, on l'ignore pour
// ne pas perdre le curseur (le local va écraser au prochain save de toute façon).
// Palette de couleurs pour le texte des notes. "default" reset à la couleur
// héritée du thème (= variable T.text). 6 teintes choisies pour rester lisibles
// sur fond sombre comme sur fond clair.
const NOTE_COLORS = [
  { id: "default", label: "Défaut",  value: null      },
  { id: "red",     label: "Rouge",   value: "#e15a5a" },
  { id: "orange",  label: "Orange",  value: "#f5a623" },
  { id: "yellow",  label: "Jaune",   value: "#FFC300" },
  { id: "green",   label: "Vert",    value: "#22c55e" },
  { id: "blue",    label: "Bleu",    value: "#5b9cf6" },
  { id: "purple",  label: "Violet",  value: "#a78bfa" },
];

function NotesChantier({ chantierId, T, accent }) {
  const [loading, setLoading]             = useState(true);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const editorRef    = useRef(null);
  const saveTimer    = useRef(null);
  const isFocusedRef = useRef(false);
  const isDirtyRef   = useRef(false);
  const savedSelectionRef = useRef(null); // sauve la sélection avant ouvrir le menu couleur

  // Applique le HTML reçu de la base dans le contentEditable sans casser le
  // curseur si l'utilisateur n'est pas en train d'écrire.
  const applyHtml = (html) => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html || "";
  };

  // Chargement initial
  useEffect(() => {
    if (!chantierId) { setLoading(false); return; }
    setLoading(true);
    isDirtyRef.current = false;
    supabase.from("chantier_notes").select("contenu").eq("chantier_id", chantierId).maybeSingle()
      .then(({ data, error }) => {
        if (error && error.code !== "PGRST116") console.warn("Chargement notes :", error.message);
        applyHtml(data?.contenu || "");
        setLoading(false);
      });
  }, [chantierId]);

  // Autosave debounced
  const scheduleSave = (html) => {
    setAutoSaveStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("chantier_notes").upsert({
        chantier_id: chantierId,
        contenu: html,
        last_client_id: getClientId(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "chantier_id" });
      if (error) { console.error("Save notes :", error.message); setAutoSaveStatus("error"); return; }
      isDirtyRef.current = false;
      setAutoSaveStatus("saved");
    }, 800);
  };

  const onInput = () => {
    isDirtyRef.current = true;
    scheduleSave(editorRef.current?.innerHTML || "");
  };

  // Subscription Realtime — applique le contenu remote si on ne tape pas
  useEffect(() => {
    if (!chantierId) return;
    const clientId = getClientId();
    const ch = supabase.channel(`chantier-notes-${chantierId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chantier_notes", filter: `chantier_id=eq.${chantierId}` },
        (payload) => {
          const remote = payload?.new;
          if (!remote) return;
          if (remote.last_client_id === clientId) return;
          if (isFocusedRef.current && isDirtyRef.current) return; // l'utilisateur tape, on ne touche pas
          applyHtml(remote.contenu || "");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chantierId]);

  // Toolbar : exécute la commande sur la sélection courante puis trigger save
  const exec = (cmd, arg = undefined) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    // Restaure la sélection si on l'a sauvegardée (utilisé par le menu couleur
    // qui fait perdre le focus le temps du clic sur une pastille).
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
      savedSelectionRef.current = null;
    }
    document.execCommand(cmd, false, arg);
    onInput();
  };

  // Mémorise la sélection courante avant d'ouvrir le menu couleur (le clic sur
  // une pastille ferait perdre le focus du contenteditable).
  const memoSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  // Applique une couleur (ou reset si null/default).
  const applyColor = (value) => {
    if (value) {
      exec("foreColor", value);
    } else {
      // Reset : on remet la couleur héritée. Astuce : foreColor avec "inherit"
      // n'est pas universellement supporté ; on passe par removeFormat pour les
      // attributs de style/font, puis on rapplique bold/italic/underline si la
      // sélection les avait — trop complexe pour un cas marginal. Plus simple :
      // foreColor avec la couleur texte du thème.
      exec("foreColor", T?.text || "#f0f0f0");
    }
    setColorMenuOpen(false);
  };

  const statusColor = autoSaveStatus === "saved" ? "#22c55e"
                    : autoSaveStatus === "saving" ? accent
                    : autoSaveStatus === "error"  ? "#e15a5a"
                    : "#f5a623";
  const statusLbl = autoSaveStatus === "saved" ? "Sauvegardé"
                  : autoSaveStatus === "saving" ? "Sauvegarde…"
                  : autoSaveStatus === "error"  ? "Erreur"
                  : "Modif en cours";

  const text     = T?.text     || "#f0f0f0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface  = T?.surface  || "#262a32";
  const border   = T?.border   || "rgba(255,255,255,0.07)";
  const card     = T?.card     || "rgba(255,255,255,0.04)";

  const toolBtn = (active = false) => ({
    width: 30, height: 30, borderRadius: RADIUS.sm,
    background: active ? accent + "22" : "transparent",
    border: `1px solid ${border}`, color: text,
    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontFamily: "inherit", padding: 0,
  });

  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 12px", borderBottom: `1px solid ${border}`,
        background: surface,
      }}>
        <button onClick={() => exec("bold")}       title="Gras (Ctrl+B)"       style={toolBtn()}><Icon as={Bold} size={13}/></button>
        <button onClick={() => exec("italic")}     title="Italique (Ctrl+I)"   style={toolBtn()}><Icon as={Italic} size={13}/></button>
        <button onClick={() => exec("underline")}  title="Souligné (Ctrl+U)"   style={toolBtn()}><Icon as={Underline} size={13}/></button>
        {/* Séparateur */}
        <div style={{ width: 1, height: 18, background: border, margin: "0 2px" }}/>
        {/* Couleur de texte */}
        <div style={{ position: "relative" }}>
          <button
            onMouseDown={memoSelection}
            onClick={() => setColorMenuOpen(o => !o)}
            title="Couleur de texte"
            style={{ ...toolBtn(colorMenuOpen) }}
          >
            <Icon as={Palette} size={13}/>
          </button>
          {colorMenuOpen && (
            <>
              <div onClick={() => setColorMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100,
                background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.md,
                padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                display: "flex", gap: 6,
              }}>
                {NOTE_COLORS.map(c => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c.value)}
                    title={c.label}
                    style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: c.value || `linear-gradient(135deg, ${text} 50%, ${textMuted} 50%)`,
                      border: c.value ? `2px solid ${border}` : `2px dashed ${textMuted}`,
                      cursor: "pointer", padding: 0,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        {/* Listes */}
        <button onClick={() => exec("insertUnorderedList")} title="Liste à puces"     style={toolBtn()}><Icon as={List} size={13}/></button>
        <button onClick={() => exec("insertOrderedList")}   title="Liste numérotée" style={toolBtn()}><Icon as={ListOrdered} size={13}/></button>
        <div style={{ flex: 1 }}/>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 9, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
          color: statusColor, background: statusColor + "18", border: `1px solid ${statusColor}40`,
          borderRadius: 99, padding: "2px 8px",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}/>
          {statusLbl}
        </span>
      </div>
      {/* Éditeur */}
      <div
        ref={editorRef}
        contentEditable={!loading}
        suppressContentEditableWarning
        onInput={onInput}
        onFocus={() => { isFocusedRef.current = true; }}
        onBlur={() => { isFocusedRef.current = false; }}
        data-placeholder="Écrire des notes sur ce chantier…"
        style={{
          minHeight: 110, padding: "12px 16px",
          color: text, fontSize: FONT.sm.size + 1, lineHeight: 1.6,
          outline: "none", fontFamily: "inherit",
        }}
      />
      <style>{`
        [contenteditable=true]:empty:before {
          content: attr(data-placeholder);
          color: ${textMuted};
          opacity: .55;
          pointer-events: none;
        }
        [contenteditable=true] b, [contenteditable=true] strong { font-weight: 800; }
        [contenteditable=true] i, [contenteditable=true] em     { font-style: italic; }
        [contenteditable=true] u                                { text-decoration: underline; }
        [contenteditable=true] ul                               { list-style: disc;    padding-left: 22px; margin: 4px 0; }
        [contenteditable=true] ol                               { list-style: decimal; padding-left: 22px; margin: 4px 0; }
        [contenteditable=true] li                               { margin: 2px 0; }
      `}</style>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PageChantiers({ chantiers = [], setChantiers, saveConfig, tauxHoraires = {}, tauxMOPrev = 0, T, profil = null, branch = "renovation", initialSelectedId = null, onSelectionConsumed }) {
  const acc = getBranchAccent(branch);
  const [phasages, setPhasages]         = useState([]);
  // P9 : pointages globaux (tous chantiers) pour dériver heures réelles + coût MO
  // dans calcFinances, suivi par ouvrage et totaux par tâche.
  const [pointages, setPointages]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(initialSelectedId);
  const [statutFilter, setStatutFilter] = useState("tous");
  const [detailTab, setDetailTab]       = useState("apercu"); // onglet de la fiche détail (mobile)
  const isMobile = useIsMobile();
  const [statutMenuOpen, setStatutMenuOpen] = useState(false);

  // Statut effectif d'un chantier : chantier.statut (source de vérité) ; fallback
  // sur phasage.statut pour compat avec l'existant ; défaut "en_cours" si phasage
  // présent, "planifie" sinon.
  const getStatut = (chantier, phasage) =>
    chantier?.statut || phasage?.statut || (phasage ? "en_cours" : "planifie");

  // Met à jour le statut d'un chantier dans la config globale.
  const updateChantierStatut = (chantierId, nouveauStatut) => {
    if (!setChantiers || !saveConfig) return;
    const u = chantiers.map(c => c.id === chantierId ? { ...c, statut: nouveauStatut } : c);
    setChantiers(u);
    saveConfig("chantiers", u);
  };
  // Si un nouvel ID est demandé en prop (ex : navigation depuis le dashboard),
  // on l'applique et on signale au parent qu'il peut le reset.
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selected) {
      setSelected(initialSelectedId);
      onSelectionConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId]);
  const [photoMap, setPhotoMap]         = useState({});
  const [uploading, setUploading]       = useState(false);
  const [compteRendus, setCompteRendus] = useState([]);
  const [loadingCR, setLoadingCR]       = useState(false);
  const [showLierModal, setShowLierModal] = useState(false);
  const [showLierPhasage, setShowLierPhasage] = useState(false);
  const [tousCRs, setTousCRs]           = useState([]);
  // Adresses des chantiers (stockées en planning_config sous "chantier_adresses")
  // → mapping { chantier_id: { adresse, lat, lon } }
  const [chantierAdresses, setChantierAdresses] = useState({});
  const [adresseDraft, setAdresseDraft]     = useState("");
  const [adresseSaving, setAdresseSaving]   = useState(false);
  const [adresseError, setAdresseError]     = useState("");
  const [rapportsEquipe, setRapportsEquipe] = useState([]);
  // Lignes de commande du chantier sélectionné → coût matériaux RÉEL (V2).
  // Source de vérité depuis la refonte commandes (cf. PhasageV2), remplace
  // l'estimation ouvrages[].cout_materiaux pour le "réel".
  const [commandeLignes, setCommandeLignes] = useState([]);
  const [lightboxGal, setLightboxGal]     = useState(null);
  const [loadingTous, setLoadingTous]   = useState(false);
  const fileInputRef                    = useRef(null);

  const bg      = T?.bg      || "#1e2128";
  const surface = T?.surface || "#262a32";
  const card    = T?.card    || "rgba(255,255,255,0.04)";
  const border  = T?.border  || "rgba(255,255,255,0.07)";
  const text    = T?.text    || "#f0f0f0";
  const textSub = T?.textSub || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // ── Chargement phasages ──
  // select("*") plutôt que la liste explicite : évite les erreurs si une
  // colonne (statut, plan_travaux, photo_batiment…) n'existe pas dans le
  // schéma de cette instance.
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.from("phasages").select("*");
      // Charge les pointages en parallèle. Si la table n'existe pas, on garde []
      // — calcFinances retombera sur le repli legacy automatiquement.
      const { data: pts, error: ptsErr } = await supabase.from("pointages").select("*");
      if (ptsErr?.code === "42P01") setPointages([]);
      else setPointages(pts || []);
      if (error) {
        console.warn("Chargement phasages :", error.message);
        setPhasages([]);
      } else if (data) {
        setPhasages(data);
        // photoMap est indexé par chantier.id. Comme un phasage peut être lié par
        // nom (et pas par chantier_id exact), on passe par trouverPhasage pour
        // chaque chantier afin de retrouver la photo correspondante.
        const pm = {};
        chantiers.forEach(c => {
          const ph = trouverPhasage(data, c);
          if (ph?.photo_batiment) pm[c.id] = ph.photo_batiment;
        });
        setPhotoMap(pm);
      }
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantiers]);

  // ── Chargement adresses des chantiers (planning_config) ──
  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantier_adresses").maybeSingle()
      .then(({ data }) => setChantierAdresses(data?.value || {}));
  }, []);

  // Resync draft quand on change de chantier
  useEffect(() => {
    if (selected) {
      const existing = chantierAdresses[selected];
      setAdresseDraft(existing?.adresse || "");
      setAdresseError("");
    }
  }, [selected, chantierAdresses]);

  // ── Chargement des lignes de commande (tous chantiers) ──
  // Coût matériaux RÉEL (V2) = somme des lignes de commande liées au chantier,
  // cohérent avec PhasageV2. Chargées globalement (comme les pointages) puis
  // filtrées par chantier, pour que les cartes de la liste ET la fiche détail
  // soient justes. Si la table n'existe pas encore, on garde [].
  useEffect(() => {
    let cancelled = false;
    supabase.from("commande_lignes")
      .select("id, quantite, prix_unitaire, prix_total, lot_id, ouvrage_id, chantier_id")
      .then(({ data, error }) => {
        if (cancelled) return;
        setCommandeLignes(error ? [] : (data || []));
      });
    return () => { cancelled = true; };
  }, []);

  // Géocode + sauvegarde l'adresse via Nominatim (OSM, gratuit, sans clé)
  const handleSaveAdresse = async () => {
    if (!adresseDraft.trim()) return;
    setAdresseSaving(true);
    setAdresseError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adresseDraft.trim())}&format=json&limit=1&addressdetails=0`;
      const r = await fetch(url, { headers: { "Accept-Language": "fr" } });
      const data = await r.json();
      if (!data || data.length === 0) {
        setAdresseError("Adresse non trouvée — vérifiez l'orthographe ou ajoutez la ville/CP.");
      } else {
        const newAdresse = {
          adresse: adresseDraft.trim(),
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
        };
        const updated = { ...chantierAdresses, [selected]: newAdresse };
        await supabase.from("planning_config").upsert(
          { key: "chantier_adresses", value: updated, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
        setChantierAdresses(updated);
      }
    } catch (e) {
      console.error("Géocodage:", e);
      setAdresseError("Erreur lors du géocodage — réessayez.");
    }
    setAdresseSaving(false);
  };

  const handleRemoveAdresse = async () => {
    if (!selected) return;
    const updated = { ...chantierAdresses };
    delete updated[selected];
    await supabase.from("planning_config").upsert(
      { key: "chantier_adresses", value: updated, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    setChantierAdresses(updated);
    setAdresseDraft("");
  };

  // ── Chargement comptes rendus ──
  useEffect(() => {
    if (!selected || loading) { setCompteRendus([]); return; }
    const loadCR = async () => {
      setLoadingCR(true);
      const chantier = chantiers.find(c => c.id === selected);
      const phasage  = trouverPhasage(phasages, chantier);
      const { data: dataById } = await supabase
        .from("cr_comptes_rendus")
        .select("*")
        .eq("chantier_id", selected)
        .order("date_visite", { ascending: false })
        .limit(5);
      if (dataById && dataById.length > 0) {
        setCompteRendus(dataById);
      } else {
        const { data, error } = await supabase
          .from("cr_comptes_rendus")
          .select("*")
          .order("date_visite", { ascending: false })
          .limit(150);
        if (!error && data) {
          const nomsCibles = [chantier?.nom, phasage?.chantier_nom, chantier?.id].filter(Boolean);
          const filtered = data.filter(cr =>
            nomsCibles.some(nom => chantierMatchCR(nom, cr.adresse))
          );
          setCompteRendus(filtered.slice(0, 5));
        }
      }
      setLoadingCR(false);
    };
    loadCR();
  }, [selected, loading, chantiers, phasages]);

  // ── Chargement rapports équipe (table "rapports") pour la galerie photos ──
  useEffect(() => {
    if (!selected) { setRapportsEquipe([]); return; }
    const load = async () => {
      const { data } = await supabase
        .from("rapports")
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, taches, photos_chantier")
        .eq("chantier_id", selected)
        .order("date_rapport", { ascending: false })
        .limit(120);
      if (data) setRapportsEquipe(data);
      else {
        const { data: d2 } = await supabase
          .from("rapports")
          .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, taches")
          .eq("chantier_id", selected)
          .order("date_rapport", { ascending: false })
          .limit(120);
        setRapportsEquipe(d2 || []);
      }
    };
    load();
  }, [selected]);

  const photosEquipe = (() => {
    const all = [];
    rapportsEquipe.forEach(r => {
      (r.photos_chantier || []).forEach(url => {
        all.push({ url, ouvrier: r.ouvrier, date: r.date_rapport, source: "Vue chantier" });
      });
      (r.taches || []).forEach(t => {
        (t.photos || []).forEach(url => {
          all.push({ url, ouvrier: r.ouvrier, date: r.date_rapport, source: t.planifie || "Tâche" });
        });
      });
    });
    return all;
  })();

  const ouvrirLierModal = async () => {
    setShowLierModal(true);
    setLoadingTous(true);
    const { data } = await supabase
      .from("cr_comptes_rendus")
      .select("*")
      .order("date_visite", { ascending: false });
    setTousCRs((data || []).filter(cr => cr.chantier_id !== selected));
    setLoadingTous(false);
  };

  // Lie un phasage existant à ce chantier en mettant à jour son chantier_id.
  // Permet de réparer manuellement les liens cassés (chantiers renommés, etc.)
  const lierPhasage = async (phasageId) => {
    const ch = chantiers.find(c => c.id === selected);
    if (!ch) return;
    const { error } = await supabase.from("phasages")
      .update({ chantier_id: selected, chantier_nom: ch.nom })
      .eq("id", phasageId);
    if (error) { console.error("Lier phasage:", error); return; }
    setPhasages(prev => prev.map(p => p.id === phasageId
      ? { ...p, chantier_id: selected, chantier_nom: ch.nom }
      : p));
    setShowLierPhasage(false);
  };

  const lierCR = async (crId) => {
    await supabase.from("cr_comptes_rendus").update({ chantier_id: selected }).eq("id", crId);
    setTousCRs(prev => prev.filter(cr => cr.id !== crId));
    const { data } = await supabase
      .from("cr_comptes_rendus")
      .select("*")
      .eq("chantier_id", selected)
      .order("date_visite", { ascending: false })
      .limit(5);
    if (data) setCompteRendus(data);
  };

  const handlePhotoUpload = async (e, chantierId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      // Cache-buster pour forcer le rafraîchissement de l'image après upsert
      const path = `chantiers/${chantierId}/batiment.${ext}`;
      const { error: upErr } = await supabase.storage.from("photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("photos").getPublicUrl(path);
      const url = urlData?.publicUrl;
      // Recherche du phasage : par chantier_id exact, sinon par fuzzy match
      // (un phasage peut être lié par nom plutôt qu'id).
      const chantier = chantiers.find(c => c.id === chantierId);
      const phasage  = trouverPhasage(phasages, chantier);
      if (phasage) {
        const { error: updErr } = await supabase.from("phasages")
          .update({ photo_batiment: url }).eq("id", phasage.id);
        if (updErr) throw updErr;
        setPhasages(prev => prev.map(p => p.id === phasage.id ? { ...p, photo_batiment: url } : p));
      } else {
        // Pas de phasage → on en crée un minimal pour persister la photo.
        const { data: newPh, error: insErr } = await supabase.from("phasages")
          .insert({ chantier_id: chantierId, chantier_nom: chantier?.nom, ouvrages: [], photo_batiment: url })
          .select().single();
        if (insErr) throw insErr;
        if (newPh) setPhasages(prev => [...prev, newPh]);
      }
      setPhotoMap(prev => ({ ...prev, [chantierId]: url }));
    } catch (err) {
      console.error("Erreur upload photo:", err);
      const msg = err?.message || err?.error || String(err);
      alert(`Erreur upload photo : ${msg}\n\nVérifiez que le bucket 'photos' existe et que les politiques RLS autorisent l'upload sur le chemin 'chantiers/*'.`);
    }
    setUploading(false);
  };

  const selectedChantier = chantiers.find(c => c.id === selected);
  const selectedPhasage  = trouverPhasage(phasages, selectedChantier);
  const avancement       = selectedPhasage ? calcAvancement(selectedPhasage) : 0;
  // P9 : pointages du chantier sélectionné → index pour heuresEff/coutMOEff + extras (libre/indirect)
  const pointagesChantierSelected = selectedPhasage
    ? pointages.filter(p => p.chantier_id === selectedPhasage.chantier_id)
    : [];
  const ptsIndexSelected = indexPointagesParTache(pointagesChantierSelected);
  const extraSelected = sumLibreEtIndirect(pointagesChantierSelected);
  // Lignes de commande du chantier sélectionné → coût matériaux réel (V2).
  const commandeLignesSelected = selectedPhasage
    ? commandeLignes.filter(l => l.chantier_id === selectedPhasage.chantier_id)
    : [];
  // Contrôles de groupe + réserves du chantier (Point 2 b) : ils alimentent
  // le sommet QUALITÉ du QCD (calculQualite), les témoins « contrôlé » de la
  // frise (controleGroupe) et la règle de clôture de la phase Travaux.
  // Tables absentes (SQL pas lancé) → listes vides : Qualité grise, témoins
  // pointillés, comme avant.
  const cvChantierId = selectedPhasage?.chantier_id || null;
  const [controlesGroupesSel, setControlesGroupesSel] = useState([]);
  const [reservesGroupesSel, setReservesGroupesSel] = useState([]);
  // Factures de situation (réglage Admin → Fact. de situation) : seuils
  // d'avancement + rôles destinataires de la notification.
  const [seuilsSituations, setSeuilsSituations] = useState([...SEUILS_SITUATIONS]);
  const [rolesSituations, setRolesSituations] = useState(["admin", "conducteur"]);
  useEffect(() => {
    if (!cvChantierId) { setControlesGroupesSel([]); setReservesGroupesSel([]); return; }
    let actif = true;
    (async () => {
      const [rc, rr, rs] = await Promise.all([
        supabase.from("controles_groupe")
          .select("id, groupe_id, date_controle, nb_taches, nb_conformes")
          .eq("chantier_id", cvChantierId),
        supabase.from("reserves")
          .select("id, groupe_id, controle_id, statut, created_at, levee_le")
          .eq("chantier_id", cvChantierId),
        supabase.from("planning_config")
          .select("value").eq("key", "situations_seuils").maybeSingle(),
      ]);
      if (!actif) return;
      setControlesGroupesSel(rc.error ? [] : (rc.data || []));
      setReservesGroupesSel(rr.error ? [] : (rr.data || []));
      if (!rs.error && rs.data?.value) {
        if (Array.isArray(rs.data.value.seuils) && rs.data.value.seuils.length > 0) {
          setSeuilsSituations(normaliserSeuilsSituations(rs.data.value.seuils));
        }
        if (Array.isArray(rs.data.value.roles)) setRolesSituations(rs.data.value.roles);
      }
    })();
    return () => { actif = false; };
  }, [cvChantierId]);
  const finances         = selectedPhasage ? calcFinances(selectedPhasage, tauxHoraires, ptsIndexSelected, extraSelected, pointagesChantierSelected, commandeLignesSelected, tauxMOPrev) : null;
  const adresseGeo       = selected ? chantierAdresses[selected] : null;

  // Heures vendues vs réelles par OUVRAGE (suivi des dérives).
  // Source : ouvrage.heures_devis pour les vendues, somme des heures réelles
  // (dérivées du registre, repli legacy) des tâches rattachées à l'ouvrage.
  // V2 : les tâches vivent dans ouvrages[].taches (source de vérité, comme
  // calcFinances/calcAvancement et PhasageV2). V1 (legacy) : on retombe sur
  // plan_travaux[phase], en groupant par ouvrage_id + "Sans ouvrage" en fin.
  const heuresParOuvrage = (() => {
    if (!selectedPhasage) return [];
    const ouvrages = selectedPhasage.ouvrages || [];
    const hasV2 = ouvrages.length > 0;

    if (hasV2) {
      // Tâches rattachées directement à chaque ouvrage (structure V2) — heures
      // réelles du module (registre, repli legacy y c. format tableau v1).
      return ouvrages.map(o => {
        const reelles = (o.taches || []).reduce((s, t) => s + cfTacheHeuresReelles(t, ptsIndexSelected), 0);
        const vendues = parseFloat(o.heures_devis) || 0;
        return { id: o.id, label: o.libelle || "(sans nom)", couleur: acc.accent, vendues, reelles };
      }).filter(o => o.vendues > 0 || o.reelles > 0);
    }

    // ── Repli V1 : tâches organisées par phase dans plan_travaux ──
    const tachesParOuvrage = new Map();
    const orphan = { reelles: 0, vendues: 0 };
    PHASES.forEach(ph => {
      (selectedPhasage.plan_travaux?.[ph.id] || []).forEach(t => {
        const hR = heuresEff(t, ptsIndexSelected); // P9 : dérivé du registre, repli legacy
        const hV = parseFloat(t.heures_vendues) || 0;
        if (t.ouvrage_id) {
          if (!tachesParOuvrage.has(t.ouvrage_id)) tachesParOuvrage.set(t.ouvrage_id, { reelles: 0, phasesCount: {} });
          const entry = tachesParOuvrage.get(t.ouvrage_id);
          entry.reelles += hR;
          entry.phasesCount[ph.id] = (entry.phasesCount[ph.id] || 0) + 1;
        } else {
          orphan.reelles += hR;
          orphan.vendues += hV;
        }
      });
    });
    const result = ouvrages.map(o => {
      const entry = tachesParOuvrage.get(o.id) || { reelles: 0, phasesCount: {} };
      const vendues = parseFloat(o.heures_devis) || 0;
      // Couleur = celle de la phase dominante (la plus de tâches), fallback accent
      let domPhaseId = null, maxCount = 0;
      Object.entries(entry.phasesCount).forEach(([phId, count]) => {
        if (count > maxCount) { maxCount = count; domPhaseId = phId; }
      });
      const couleur = PHASES.find(p => p.id === domPhaseId)?.couleur || acc.accent;
      return { id: o.id, label: o.libelle || "(sans nom)", couleur, vendues, reelles: entry.reelles };
    }).filter(o => o.vendues > 0 || o.reelles > 0);
    if (orphan.vendues > 0 || orphan.reelles > 0) {
      result.push({ id: "_orphan", label: "Sans ouvrage rattaché", couleur: textMuted, ...orphan });
    }
    return result;
  })();
  const totalHeures = heuresParOuvrage.reduce((s, o) => ({
    vendues: s.vendues + o.vendues,
    reelles: s.reelles + o.reelles,
  }), { vendues: 0, reelles: 0 });

  // ── QCD (Point 2a) : les trois sommets, calculés par le module dédié à
  // partir des données déjà chargées (aucune requête supplémentaire).
  // V2 : agrégats bruts de computeChantierFinance (mêmes chiffres que la
  // section Finances). V1 legacy : totaux d'heures de la fiche + coût MO
  // historique ; le prévisionnel matériaux n'existe pas en V1 → ratio
  // matériaux non évaluable (gris), c'est voulu.
  // Contexte du sommet Qualité (Point 2 b) : contrôles + réserves du chantier.
  const qualiteCtx = {
    reserves: reservesGroupesSel,
    controles: controlesGroupesSel,
    todayISO: new Date().toISOString().slice(0, 10),
  };
  const qcd = !selectedPhasage ? null
    : finances?.fin ? qcdDepuisFinance(finances.fin.brut, qualiteCtx)
    : computeQCD({
        heuresReelles: totalHeures.reelles,
        heuresVendues: totalHeures.vendues,
        avancement: (avancement || 0) / 100,
        coutMOReel: finances?.coutMO,
        coutMOPrevu: totalHeures.vendues > 0 ? totalHeures.vendues * (parseFloat(tauxMOPrev) || TAUX_MO_PREV_DEFAUT) : null,
        coutMateriauxReel: finances?.coutMat,
        coutMateriauxPrevu: null,
        ...qualiteCtx,
      });
  // Overrides manuels des sommets (superposés à l'auto, jamais à sa place).
  const qcdOverrides = lireOverridesQCD(selectedPhasage?.plan_travaux?.meta);

  // ── Écriture des meta du phasage (overrides QCD) ──
  // Réplique STRICTEMENT le read-before-write de PhasageV2.saveMeta : on relit
  // plan_travaux depuis la DB AVANT d'écrire. Le state local `phasages` est
  // chargé une fois au montage, sans realtime : écrire à partir de lui
  // écraserait le travail V1/chrono fait entre-temps dans PhasageV2
  // (incident du 2026-06-03).
  const saveMetaPhasage = async (patch) => {
    if (!selectedPhasage?.id) return false;
    const { data: fresh, error: fetchErr } = await supabase.from("phasages")
      .select("plan_travaux").eq("id", selectedPhasage.id).maybeSingle();
    if (fetchErr) { alert(`Sauvegarde impossible : ${fetchErr.message}`); return false; }
    const currentPlan = fresh?.plan_travaux || {};
    const newPlan = { ...currentPlan, meta: { ...(currentPlan.meta || {}), ...patch } };
    const { error } = await supabase.from("phasages")
      .update({ plan_travaux: newPlan, updated_at: new Date().toISOString() })
      .eq("id", selectedPhasage.id);
    if (error) { alert(`Sauvegarde impossible : ${error.message}`); return false; }
    setPhasages(prev => prev.map(p => p.id === selectedPhasage.id ? { ...p, plan_travaux: newPlan } : p));
    return true;
  };

  // Force un sommet (commentaire obligatoire, auteur + date tracés) / retour auto.
  const forcerSommetQCD = async (axeId, statut, commentaire) => {
    const override = construireOverrideQCD({
      statut, commentaire,
      auteur: profil?.nom || profil?.email || "",
      date: new Date().toISOString(),
    });
    if (!override) return false;
    return saveMetaPhasage({ [QCD_OVERRIDE_KEYS[axeId]]: override });
  };
  const retourAutoSommetQCD = (axeId) => saveMetaPhasage({ [QCD_OVERRIDE_KEYS[axeId]]: null });

  // ── Cycle de vie (Point 2a) : positionnement déduit + phase déclarée ──
  const metaSelected = selectedPhasage?.plan_travaux?.meta || {};
  const cvEtats = lireEtatsEtapes(metaSelected);
  const cvPhaseDeclaree = lirePhaseDeclaree(metaSelected);
  const chronoGroupesSelected = Array.isArray(metaSelected.chrono_groupes) ? metaSelected.chrono_groupes : [];
  // « Équipes affectées » : chaque groupe a au moins une tâche et toutes ses
  // tâches ont des ouvriers (ou sont marquées externes). null = aucun groupe
  // défini (indéterminé).
  const cvEquipesAffectees = (() => {
    if (!chronoGroupesSelected.length) return null;
    const taches = (selectedPhasage?.ouvrages || []).flatMap(o => o.taches || []);
    return chronoGroupesSelected.every(g => {
      const tg = taches.filter(t => t.chrono_groupe_id === g.id);
      return tg.length > 0 && tg.every(t => (Array.isArray(t.ouvriers) && t.ouvriers.length > 0) || t.externe);
    });
  })();
  const cvCtx = {
    etatsEtapes: cvEtats,
    chiffrage: totalHeures.vendues > 0 || (finances?.prixVendu || 0) > 0,
    equipesAffectees: cvEquipesAffectees,
    controles: controlesGroupesSel, // témoins « contrôlé » (Point 2 b)
    todayISO: new Date().toISOString().slice(0, 10),
  };
  const cv = selectedPhasage ? computeCycleVie({
    statutChantier: getStatut(selectedChantier, selectedPhasage),
    avancement, // entier 0-100
    chiffrage: cvCtx.chiffrage,
    etatsEtapes: cvEtats,
    phaseDeclaree: cvPhaseDeclaree,
    equipesAffectees: cvEquipesAffectees,
    groupes: chronoGroupesSelected, // règle : Travaux ne se clôture que si tous les groupes sont contrôlés
    controles: controlesGroupesSel,
    todayISO: cvCtx.todayISO,
  }) : null;
  // Avancement de chaque groupe (pondéré heures_vendues, comme la vue chrono).
  const statsGroupesSelected = (() => {
    const map = {};
    chronoGroupesSelected.forEach(g => {
      if (g?.id) map[g.id] = statsGroupeChrono(g.id, selectedPhasage?.ouvrages);
    });
    return map;
  })();
  // Déclare la phase en cours à la main (prioritaire) — null = retour auto.
  const declarerPhaseCV = (phaseId) => saveMetaPhasage({
    [CV_META_PHASE_DECLAREE]: phaseId ? {
      phaseId, auteur: profil?.nom || profil?.email || "", date: new Date().toISOString(),
    } : null,
  });

  // ── Écriture de l'état d'UNE étape du cycle de vie ──
  // Même read-before-write que saveMetaPhasage, mais le merge se fait au
  // niveau de l'étape : l'updater reçoit l'état FRAIS relu en base (jamais le
  // state local), pour ne pas écraser les autres étapes modifiées entre-temps.
  const saveEtatEtapeCV = async (etapeId, updater) => {
    if (!selectedPhasage?.id) return false;
    const { data: fresh, error: fetchErr } = await supabase.from("phasages")
      .select("plan_travaux").eq("id", selectedPhasage.id).maybeSingle();
    if (fetchErr) { alert(`Sauvegarde impossible : ${fetchErr.message}`); return false; }
    const currentPlan = fresh?.plan_travaux || {};
    const etats = lireEtatsEtapes(currentPlan.meta || {});
    const nouveau = typeof updater === "function" ? updater(etats[etapeId] || {}) : updater;
    const nextEtats = { ...etats };
    if (nouveau == null) delete nextEtats[etapeId]; else nextEtats[etapeId] = nouveau;
    const newPlan = { ...currentPlan, meta: { ...(currentPlan.meta || {}), [CV_META_ETAPES]: nextEtats } };
    const { error } = await supabase.from("phasages")
      .update({ plan_travaux: newPlan, updated_at: new Date().toISOString() })
      .eq("id", selectedPhasage.id);
    if (error) { alert(`Sauvegarde impossible : ${error.message}`); return false; }
    setPhasages(prev => prev.map(p => p.id === selectedPhasage.id ? { ...p, plan_travaux: newPlan } : p));
    return true;
  };

  // ── Actions sur les étapes du cycle de vie (Prompt 6) ──
  const auteurCV = profil?.nom || profil?.email || "";
  // Coche manuelle (avec données saisies : montant, date, réponse…).
  const validerEtapeCV = (etapeId, donnees = {}) => saveEtatEtapeCV(etapeId, (courant) => ({
    ...courant, fait: true, date: new Date().toISOString(), auteur: auteurCV,
    donnees: { ...(courant.donnees || {}), ...donnees },
  }));
  // Dé-validation : on garde les données saisies et les pièces jointes.
  const devaliderEtapeCV = (etapeId) => saveEtatEtapeCV(etapeId, (courant) => ({
    ...courant, fait: false, date: null, auteur: null,
  }));
  // Pièce jointe (toute étape) ; valide=true = import qui VALIDE l'étape
  // (nature "document"), avec d'éventuelles données (date de signature…).
  const ajouterPieceJointeCV = async (etapeId, file, { valide = false, donnees = {} } = {}) => {
    if (!selectedPhasage?.id || !file) return false;
    const doc = await uploadDocumentChantier(file, `cycle-vie/${selectedPhasage.id}/${etapeId}`);
    if (!doc) {
      alert("Échec de l'envoi du fichier. Vérifiez que le bucket « chantier-documents » existe (sql/202607_bucket_chantier_documents.sql).");
      return false;
    }
    const nowIso = new Date().toISOString();
    return saveEtatEtapeCV(etapeId, (courant) => ({
      ...courant,
      ...(valide ? { fait: true, date: nowIso, auteur: auteurCV, donnees: { ...(courant.donnees || {}), ...donnees } } : {}),
      pieces_jointes: [
        ...(Array.isArray(courant.pieces_jointes) ? courant.pieces_jointes : []),
        { ...doc, date: nowIso, auteur: auteurCV },
      ],
    }));
  };
  const supprimerPieceJointeCV = async (etapeId, pj) => {
    if (!window.confirm(`Supprimer la pièce jointe « ${pj.nom} » ?`)) return false;
    await supprimerDocumentChantier(pj.path); // best-effort, la métadonnée part quoi qu'il arrive
    return saveEtatEtapeCV(etapeId, (courant) => ({
      ...courant,
      pieces_jointes: (Array.isArray(courant.pieces_jointes) ? courant.pieces_jointes : []).filter(x => x.path !== pj.path),
    }));
  };
  // Journal (interventions SAV) : entrées multiples, l'étape ne se termine pas.
  const ajouterJournalCV = (etapeId, texte) => saveEtatEtapeCV(etapeId, (courant) => ({
    ...courant,
    journal: [
      ...(Array.isArray(courant.journal) ? courant.journal : []),
      { date: new Date().toISOString(), texte: String(texte || "").trim(), auteur: auteurCV },
    ],
  }));
  // Envoi d'une pièce jointe par email (modale de choix des destinataires).
  const [envoiPJ, setEnvoiPJ] = useState(null); // { pj, etapeNom } | null

  // ── Notification « facture de situation prête » (best-effort, côté client).
  // Quand l'avancement franchit un seuil (réglage Admin) et que la situation
  // n'est ni émise ni déjà notifiée : email aux admin + conducteurs via
  // /api/send-email (pas de nouvelle fonction Vercel : plafond des 12
  // atteint — la détection se fait à l'ouverture de la fiche). Drapeau PLAT
  // par seuil dans meta (situation_mail_<seuil>), posé seulement si l'envoi
  // a réussi ; garde de session anti-doublon pendant l'aller-retour réseau.
  const notifSituationRef = useRef(null);
  useEffect(() => {
    if (!selectedPhasage?.id || !selectedChantier) return;
    if (getStatut(selectedChantier, selectedPhasage) === "termine") return; // chantier soldé : pas de relance
    if (!rolesSituations.length) return; // aucun rôle coché en Admin : pas de notification
    const aPrevenir = seuilsSituations.filter(s =>
      (avancement || 0) >= s
      && !cvEtats[`situation_${s}`]?.fait
      && !metaSelected[`situation_mail_${s}`]
    );
    if (!aPrevenir.length) return;
    const cle = `${selectedPhasage.id}:${aPrevenir.join(",")}`;
    if (notifSituationRef.current === cle) return;
    notifSituationRef.current = cle;
    (async () => {
      const { data: users } = await supabase.from("utilisateurs")
        .select("email, role, actif").in("role", rolesSituations);
      const dests = (users || [])
        .filter(u => u.actif !== false && u.email && !String(u.email).toLowerCase().endsWith("@profero.local"))
        .map(u => u.email);
      if (!dests.length) return;
      for (const seuil of aPrevenir) {
        const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
          <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
            <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Facturation</div>
            <div style="color:#fff;font-size:20px;font-weight:800">💶 Facture de situation à émettre</div>
          </div>
          <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px;font-size:14px;line-height:1.7">
            <p style="margin:0 0 10px">Le chantier <strong>${escHtml(selectedChantier.nom)}</strong> a atteint
            <strong>${Math.round(avancement || 0)} %</strong> d'avancement : la facture de situation du seuil
            <strong>${seuil} %</strong> est prête à être émise.</p>
            <p style="margin:0;color:#666">Une fois émise, validez l'étape « Facture de situation — ${seuil} % »
            dans la frise du chantier (phase Travaux), avec le montant et la date — la facture peut y être jointe.</p>
          </div>
          <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
        </div>`;
        try {
          const res = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: dests,
              subject: `Facture de situation à émettre — ${selectedChantier.nom} (${seuil} %)`,
              html,
            }),
          });
          if (res.ok) await saveMetaPhasage({ [`situation_mail_${seuil}`]: new Date().toISOString() });
        } catch { /* réessaiera à une prochaine ouverture de la fiche */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhasage?.id, avancement, seuilsSituations, rolesSituations]);
  // Ouverture d'un document (URL signée) — fenêtre ouverte AVANT l'await pour
  // ne pas être bloqué par l'anti-popup.
  const ouvrirPieceJointeCV = async (pj) => {
    const fenetre = window.open("", "_blank");
    const url = await urlDocumentChantier(pj.path);
    if (url) { if (fenetre) fenetre.location = url; else window.open(url, "_blank"); }
    else {
      if (fenetre) fenetre.close();
      alert("Impossible d'ouvrir le fichier (bucket « chantier-documents » manquant ou fichier supprimé).");
    }
  };

  // ── Styles communs (cohérent avec autres pages) ──
  const sectionTitle = {
    fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
    letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12,
    display: "flex", alignItems: "center", gap: 8,
  };

  // ─── VUE LISTE ────────────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="pchan-list" style={{ flex: 1, overflowY: "auto", background: bg, padding: "28px 32px" }}>
        <style>{`
          .chantier-card { transition: all .18s; cursor: pointer; }
          .chantier-card:hover { transform: translateY(-3px); box-shadow: 0 16px 34px rgba(16,24,40,0.14); border-color: ${acc.border} !important; }
          @media(max-width:768px) { .chantiers-grid { grid-template-columns: 1fr !important; } }
          @media(max-width:767px) {
            .pchan-list{padding:14px 12px!important}
            .pchan-list h1{font-size:22px!important}
            .pchan-list .pchan-list-header{flex-direction:column;align-items:flex-start!important;gap:10px!important}
            .pchan-list .pchan-stats{width:100%;gap:8px!important}
            .pchan-list .pchan-stats > div{flex:1;min-width:0!important;padding:8px 10px!important}
            .pchan-list .chantier-card .chantier-card-photo{height:96px!important}
            .pchan-list .chantier-card .chantier-card-body{padding:11px 13px!important;gap:7px!important}
            .pchan-list .chantier-card .chantier-card-name{font-size:15px!important}
          }
        `}</style>

        <div className="pchan-list-header" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={HardHat} size={20} strokeWidth={2}/>
          </div>
          <div>
            <h1 style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>Mes chantiers</h1>
            <p style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3 }}>
              {chantiers.length} chantier{chantiers.length > 1 ? "s" : ""} · {phasages.length} phasage{phasages.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* ── Résumé financier ── */}
        {chantiers.length > 0 && (() => {
          let caTotal = 0, margeTotal = 0;
          chantiers.forEach(c => {
            const ph = trouverPhasage(phasages, c);
            if (!ph) return;
            const ptsCh = pointages.filter(p => p.chantier_id === ph.chantier_id);
            const cmdCh = commandeLignes.filter(l => l.chantier_id === ph.chantier_id);
            const f = calcFinances(ph, tauxHoraires, indexPointagesParTache(ptsCh), sumLibreEtIndirect(ptsCh), ptsCh, cmdCh);
            caTotal += f.prixVendu || 0;
            margeTotal += f.marge || 0;
          });
          return (
            <div style={{ marginBottom: 16 }}>
              <SummaryBar T={T} items={[
                { label: "Chantiers", value: chantiers.length, color: acc.accent, icon: HardHat },
                { label: "CA total",  value: fmt(caTotal),     color: "#5b8af5",   icon: Wallet },
                { label: "Marge",     value: fmt(margeTotal),  color: margeTotal >= 0 ? "#22c55e" : "#e15a5a", icon: TrendingUp },
              ]}/>
            </div>
          );
        })()}

        {/* ── Filtres par statut ── */}
        {(() => {
          const counts = chantiers.reduce((acc, c) => {
            const ph = trouverPhasage(phasages, c);
            const s = getStatut(c, ph);
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {});
          const filters = [
            { key: "tous",     label: "Tous",      count: chantiers.length, color: textSub },
            { key: "planifie", label: "Planifié",  count: counts.planifie || 0, color: STATUTS.planifie.color, bg: STATUTS.planifie.bg },
            { key: "en_cours", label: "En cours",  count: counts.en_cours || 0, color: STATUTS.en_cours.color, bg: STATUTS.en_cours.bg },
            { key: "termine",  label: "Terminé",   count: counts.termine  || 0, color: STATUTS.termine.color,  bg: STATUTS.termine.bg  },
          ];
          return (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {filters.map(f => {
                const active = statutFilter === f.key;
                return (
                  <button key={f.key} onClick={() => setStatutFilter(f.key)} style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "7px 14px", borderRadius: RADIUS.pill,
                    border: `1px solid ${active ? (f.color || acc.accent) : border}`,
                    background: active ? (f.bg || acc.bg10) : "transparent",
                    color: active ? (f.color || acc.accent) : textSub,
                    fontSize: FONT.sm.size, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "all .15s",
                  }}>
                    {f.label}
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700,
                      padding: "1px 7px", borderRadius: RADIUS.pill,
                      background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                      color: active ? (f.color || acc.accent) : textMuted,
                    }}>{f.count}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {(() => {
          const chantiersFiltres = chantiers.filter(chantier => {
            if (statutFilter === "tous") return true;
            return getStatut(chantier, trouverPhasage(phasages, chantier)) === statutFilter;
          });
          if (loading) {
            return <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>Chargement…</div>;
          }
          if (chantiers.length === 0) {
            return (
              <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
                <div style={{
                  width: 64, height: 64, borderRadius: RADIUS.xl,
                  background: acc.bg10, color: acc.accent,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 16,
                }}>
                  <Icon as={HardHat} size={28}/>
                </div>
                <div style={{ fontSize: FONT.base.size, color: text, fontWeight: 600 }}>Aucun chantier</div>
                <div style={{ fontSize: FONT.sm.size, opacity: .7, marginTop: 4 }}>Ajoutez-en dans les réglages.</div>
              </div>
            );
          }
          if (chantiersFiltres.length === 0) {
            return (
              <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
                <div style={{ fontSize: FONT.base.size, color: text, fontWeight: 600 }}>Aucun chantier avec ce statut</div>
                <button onClick={() => setStatutFilter("tous")} style={{
                  marginTop: 12, padding: "7px 14px", borderRadius: RADIUS.md,
                  border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
                  fontSize: FONT.sm.size, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}>Voir tous les chantiers</button>
              </div>
            );
          }
          return (
          <div className="chantiers-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
            {chantiersFiltres.map(chantier => {
              const phasage = trouverPhasage(phasages, chantier);
              const av      = phasage ? calcAvancement(phasage) : null;
              const ptsCh   = phasage ? pointages.filter(p => p.chantier_id === phasage.chantier_id) : [];
              const ptsIdx  = indexPointagesParTache(ptsCh);
              const extras  = sumLibreEtIndirect(ptsCh);
              const cmdCh   = phasage ? commandeLignes.filter(l => l.chantier_id === phasage.chantier_id) : [];
              const fin     = phasage ? calcFinances(phasage, tauxHoraires, ptsIdx, extras, ptsCh, cmdCh) : null;
              const photo   = photoMap[chantier.id];
              const statut  = getStatut(chantier, phasage);

              return (
                <div key={chantier.id} className="chantier-card"
                  onClick={() => setSelected(chantier.id)}
                  style={{
                    background: surface, border: `1px solid ${border}`,
                    borderRadius: 16, overflow: "hidden", boxShadow: CARD_SHADOW,
                    display: "flex", flexDirection: "column",
                    borderTop: `3px solid ${chantier.couleur}`,
                  }}>
                  <div className="chantier-card-photo" style={{ height: 104, background: "rgba(128,128,128,0.10)", position: "relative", overflow: "hidden", flexShrink: 0 }}>
                    {photo ? (
                      <img src={photo} alt={chantier.nom} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: textMuted }}>
                        <Icon as={Building2} size={26} strokeWidth={1.5} style={{ opacity: .35 }}/>
                      </div>
                    )}
                    {statut && <div style={{ position: "absolute", top: 10, right: 10 }}><StatutBadge statut={statut}/></div>}
                    {phasage && (
                      <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: FONT.xs.size, color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.55)", borderRadius: RADIUS.sm, padding: "2px 8px", fontWeight: 600 }}>
                        {phasage.chantier_nom}
                      </div>
                    )}
                  </div>

                  <div className="chantier-card-body" style={{ padding: "11px 13px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="chantier-card-name" style={{
                      fontSize: FONT.md.size, fontWeight: 700, color: text,
                      letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{chantier.nom}</div>

                    {av !== null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ProgressBar value={av} color={acc.accent}/>
                        <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: av >= 100 ? "#22c55e" : acc.accent, flexShrink: 0, minWidth: 32, textAlign: "right" }}>{av}%</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, opacity: .55, fontStyle: "italic" }}>
                        Pas de phasage créé
                      </div>
                    )}

                    {fin && fin.prixVendu > 0 && (
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, fontSize: FONT.xs.size + 1 }}>
                        <span style={{ color: textMuted }}>{fmt(fin.prixVendu)}</span>
                        <span style={{ color: fin.marge >= 0 ? "#22c55e" : "#e15a5a", fontWeight: 700 }}>
                          {fin.marge >= 0 ? "+" : ""}{fmt(fin.marge)} <span style={{ opacity: .7, fontWeight: 600 }}>({fin.margePct.toFixed(0)}%)</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
    );
  }

  // ─── VUE DÉTAILLÉE ───────────────────────────────────────────────────────────
  return (
    <div className="pchan-detail" style={{ flex: 1, overflowY: "auto", background: bg }}>
      <style>{`
        .ch-stat-card { background: ${surface}; border: 1px solid ${border}; border-radius: 14px; padding: 14px 16px; box-shadow: ${CARD_SHADOW}; }
        .ch-photo-upload:hover { border-color: ${acc.accent} !important; background: ${acc.bg10} !important; }
        .tache-row { border-bottom: 1px solid rgba(255,255,255,0.05); transition: background .12s; }
        .tache-row:hover { background: rgba(128,128,128,0.06); }
        .tache-row:last-child { border-bottom: none; }
        @media(max-width:768px) { .ch-fin-grid { grid-template-columns: 1fr 1fr !important; } .ch-content-grid { grid-template-columns: 1fr !important; } .ch-map-grid { grid-template-columns: 1fr !important; } .ch-budget-grid { grid-template-columns: 1fr !important; } .ch-budget-totaux { grid-template-columns: 1fr 1fr !important; } }
        @media(max-width:767px) {
          .pchan-detail .pchan-detail-header{padding:12px 14px!important;gap:10px!important}
          .pchan-detail .pchan-detail-header h1{font-size:18px!important}
          .pchan-detail .pchan-detail-body{padding:14px 12px!important;gap:18px!important}
          .pchan-detail .ch-photo-upload{height:180px!important}
          .pchan-detail .ch-stat-card{padding:12px!important}
          .pchan-detail .ch-stat-card > div:nth-child(2){font-size:16px!important}
          .pchan-detail .ch-fin-grid{grid-template-columns:1fr 1fr!important;gap:8px!important}
          .pchan-detail .ch-qcd-tri{display:none}
          .pchan-detail .ch-qcd-grid{gap:6px!important}
          .pchan-detail .ch-qcd-som{padding:8px 8px!important}
        }
      `}</style>

      {/* Header */}
      <div className="pchan-detail-header" style={{
        background: surface, borderBottom: `1px solid ${border}`,
        padding: "14px 28px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <button onClick={() => { setSelected(null); setCompteRendus([]); }} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: `1px solid ${border}`,
          borderRadius: RADIUS.md, padding: "6px 12px",
          color: textSub, fontSize: FONT.sm.size, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
          transition: "border-color .12s, color .12s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = textSub; }}>
          <Icon as={ArrowLeft} size={14}/>
          Retour
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: FONT.xl.size, fontWeight: 800, color: text, margin: 0, letterSpacing: -0.3 }}>{selectedChantier?.nom || "Chantier"}</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {/* Sélecteur de statut — toujours présent (même sans phasage) */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setStatutMenuOpen(o => !o)}
                title="Changer le statut"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "transparent", border: "none", padding: 0,
                  cursor: setChantiers ? "pointer" : "default",
                  fontFamily: "inherit",
                }}>
                <StatutBadge statut={getStatut(selectedChantier, selectedPhasage)}/>
                {setChantiers && (
                  <Icon as={ChevronLeft} size={11} color={textMuted} style={{ transform: "rotate(-90deg)" }}/>
                )}
              </button>
              {statutMenuOpen && setChantiers && (
                <>
                  <div onClick={() => setStatutMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 100 }}/>
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 101,
                    background: surface, border: `1px solid ${border}`,
                    borderRadius: RADIUS.md, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                    padding: 6, minWidth: 160,
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    {["planifie", "en_cours", "en_pause", "termine"].map(s => {
                      const def = STATUTS[s];
                      const isCur = getStatut(selectedChantier, selectedPhasage) === s;
                      return (
                        <button key={s} onClick={() => {
                          updateChantierStatut(selectedChantier.id, s);
                          setStatutMenuOpen(false);
                        }} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 10px", borderRadius: RADIUS.sm, border: "none",
                          background: isCur ? def.bg : "transparent",
                          color: isCur ? def.color : text,
                          fontSize: FONT.sm.size, fontWeight: 600, textAlign: "left",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                          onMouseEnter={e => { if (!isCur) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                          onMouseLeave={e => { if (!isCur) e.currentTarget.style.background = "transparent"; }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: def.color, flexShrink: 0 }}/>
                          {def.label}
                          {isCur && <Icon as={Check} size={12} style={{ marginLeft: "auto" }}/>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {selectedPhasage ? (
              <>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>{selectedPhasage.chantier_nom}</span>
                {selectedPhasage.updated_at && (
                  <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, opacity: .6 }}>
                    · Phasage maj {new Date(selectedPhasage.updated_at).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: FONT.sm.size, color: textMuted, opacity: .55, fontStyle: "italic" }}>Aucun phasage trouvé pour ce chantier</span>
            )}
          </div>
        </div>
      </div>

      <div className="pchan-detail-body" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Bandeau QCD (Point 2a) : santé du chantier, toujours visible
            (hors onglets mobiles), avant tous les blocs existants ── */}
        <BandeauQCD qcd={qcd} overrides={qcdOverrides} sansPhasage={!selectedPhasage}
          peutForcer={!!selectedPhasage} onForcer={forcerSommetQCD} onRetourAuto={retourAutoSommetQCD} T={T}/>

        {/* ── Frise du cycle de vie (Point 2a) : sous le bandeau QCD ── */}
        <FriseCycleVie cv={cv} cvCtx={cvCtx} chronoGroupes={chronoGroupesSelected} statsGroupes={statsGroupesSelected}
          avancementChantier={avancement} seuilsSituations={seuilsSituations}
          peutModifier={!!selectedPhasage} onDeclarer={declarerPhaseCV}
          actionsEtape={{
            onValider: validerEtapeCV,
            onDevalider: devaliderEtapeCV,
            onAjouterPJ: ajouterPieceJointeCV,
            onSupprimerPJ: supprimerPieceJointeCV,
            onAjouterJournal: ajouterJournalCV,
            onOuvrirPJ: ouvrirPieceJointeCV,
            onEnvoyerPJ: (etape, pj) => setEnvoiPJ({ pj, etapeNom: etape.nom }),
          }} T={T}/>

        {/* Modale d'envoi d'un document d'étape par email */}
        {envoiPJ && (
          <ModaleEnvoiDocument envoi={envoiPJ} chantierNom={selectedChantier?.nom || ""}
            auteur={auteurCV} T={T} onClose={() => setEnvoiPJ(null)}/>
        )}

        {/* Onglets (mobile uniquement) — sur desktop tout s'affiche en scroll */}
        {isMobile && (
          <MobileTabs T={T} accent={acc.accent} onAccent={acc.onAccent}
            value={detailTab} onChange={setDetailTab}
            tabs={[
              { id: "apercu",   label: "Aperçu",   icon: Building2 },
              { id: "finances", label: "Finances", icon: Wallet },
              { id: "suivi",    label: "Suivi",    icon: ClipboardList },
            ]}/>
        )}

        {(!isMobile || detailTab === "apercu") && (<>
        {/* ── Section 1 : Photo + avancement ── */}
        <div className="ch-content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>
          <div>
            <div style={sectionTitle}>
              <Icon as={Camera} size={13}/> Photo du bâtiment
            </div>
            <div className="ch-photo-upload" style={{
              height: 240, borderRadius: RADIUS.xl, overflow: "hidden", position: "relative",
              border: `2px dashed ${border}`, cursor: "pointer", transition: "all .18s",
              background: "rgba(128,128,128,0.08)",
            }} onClick={() => fileInputRef.current?.click()}>
              {photoMap[selected] ? (
                <>
                  <img src={photoMap[selected]} alt="Bâtiment" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 14px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", display: "flex", justifyContent: "flex-end" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
                      <Icon as={Pencil} size={11}/>
                      Modifier
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: textMuted }}>
                  {uploading ? (
                    <>
                      <Icon as={Camera} size={32} strokeWidth={1.5}/>
                      <span style={{ fontSize: FONT.sm.size }}>Upload en cours…</span>
                    </>
                  ) : (
                    <>
                      <Icon as={Camera} size={36} strokeWidth={1.5} style={{ opacity: .5 }}/>
                      <span style={{ fontSize: FONT.sm.size }}>Cliquer pour ajouter une photo</span>
                      <span style={{ fontSize: FONT.xs.size, opacity: .55 }}>JPG, PNG, WEBP</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoUpload(e, selected)}/>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={sectionTitle}>
              <Icon as={TrendingUp} size={13}/> Avancement global
            </div>
            {selectedPhasage ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
                <AvancementCircle value={avancement} accent={acc.accent}/>
                <div style={{ flex: 1 }}>
                  {(() => {
                    // Détail de l'avancement : par OUVRAGE en V2 (source de vérité
                    // ouvrages[].taches), par PHASE en repli legacy V1.
                    const ouvragesV2 = selectedPhasage.ouvrages || [];
                    const hasV2 = ouvragesV2.length > 0;
                    // Avancement pondéré (heures_estimees, repli moyenne simple) d'un
                    // jeu de tâches — cohérent avec calcAvancementPondere.
                    const avPondere = (taches) => {
                      if (!taches.length) return 0;
                      const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
                      return totalHE > 0
                        ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement)||0)*(parseFloat(t.heures_estimees)||0)),0)/totalHE)
                        : Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement)||0), 0) / taches.length);
                    };
                    const rows = hasV2
                      ? ouvragesV2
                          .filter(o => (o.taches || []).length > 0)
                          .map(o => ({ id: o.id, label: o.libelle || "(sans nom)", couleur: acc.accent, av: avPondere(o.taches || []) }))
                      : PHASES.map(ph => {
                          const taches = selectedPhasage.plan_travaux?.[ph.id] || [];
                          if (taches.length === 0) return null;
                          return { id: ph.id, label: ph.label, couleur: ph.couleur, av: avPondere(taches) };
                        }).filter(Boolean);
                    return (
                      <>
                        <div style={{ fontSize: FONT.sm.size, color: textMuted, marginBottom: 8 }}>
                          {hasV2 ? "Détail par ouvrage" : "Détail par phase"}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 170, overflowY: "auto" }}>
                          {rows.map(r => (
                            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.couleur, flexShrink: 0 }}/>
                              <span title={r.label} style={{ fontSize: FONT.xs.size + 1, color: textMuted, flex: "0 0 220px", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                              <div style={{ flex: 1, minWidth: 0 }}><ProgressBar value={r.av} color={r.couleur} height={5}/></div>
                              <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: text, minWidth: 32, textAlign: "right" }}>{r.av}%</span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div style={{
                padding: "24px 24px 20px", textAlign: "center", color: textMuted, fontSize: FONT.sm.size,
                background: card, borderRadius: RADIUS.lg, border: `1px solid ${border}`,
              }}>
                <Icon as={ClipboardList} size={28} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 8 }}/>
                <div style={{ color: text, fontWeight: 600, marginBottom: 4 }}>Aucun phasage lié à ce chantier</div>
                <div style={{ opacity: .65, fontSize: FONT.xs.size + 1, marginBottom: 14 }}>
                  Soit le phasage existe déjà mais n'est pas lié, soit il faut le créer depuis la page Phasage.
                </div>
                {phasages.length > 0 && (
                  <button onClick={() => setShowLierPhasage(true)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: RADIUS.md, border: `1px solid ${acc.border}`,
                    background: acc.bg10, color: acc.accent,
                    fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                    cursor: "pointer",
                  }}>
                    <Icon as={Link2} size={12}/>
                    Lier un phasage existant
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modale liaison phasage */}
        {showLierPhasage && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:800, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowLierPhasage(false)}>
            <div style={{ background:surface, border:`1px solid ${border}`, borderRadius:RADIUS.xl, width:"100%", maxWidth:560, maxHeight:"80vh", display:"flex", flexDirection:"column", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e=>e.stopPropagation()}>
              <div style={{ padding:"16px 20px 12px", borderBottom:`1px solid ${border}`, flexShrink:0, display:"flex", alignItems:"center", gap:10 }}>
                <Icon as={Link2} size={16} color={acc.accent}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:FONT.md.size, fontWeight:800, color:text, letterSpacing:-.2 }}>
                    Lier un phasage existant
                  </div>
                  <div style={{ fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3 }}>
                    À <span style={{color:acc.accent, fontWeight:600}}>{selectedChantier?.nom}</span>
                  </div>
                </div>
                <button onClick={()=>setShowLierPhasage(false)} title="Fermer" style={{
                  background:"transparent", border:"none", color:textMuted,
                  cursor:"pointer", padding:4, borderRadius:RADIUS.sm,
                  display:"inline-flex", alignItems:"center",
                }}>
                  <Icon as={X} size={18}/>
                </button>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
                {phasages.length === 0 ? (
                  <div style={{ textAlign:"center", padding:40, color:textMuted, opacity:.65, fontSize:FONT.sm.size }}>
                    Aucun phasage n'existe encore. Créez-en un depuis la page Phasage.
                  </div>
                ) : (
                  phasages.map(p => {
                    const dejaChantier = chantiers.find(c => c.id === p.chantier_id);
                    return (
                      <div key={p.id} style={{
                        display:"flex", alignItems:"center", gap:12,
                        padding:"11px 14px", borderRadius:RADIUS.md, marginBottom:8,
                        background:card, border:`1px solid ${border}`,
                      }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:FONT.sm.size + 1, fontWeight:700, color:text, marginBottom:2 }}>
                            {p.chantier_nom || "(sans nom)"}
                          </div>
                          <div style={{ fontSize:FONT.xs.size + 1, color:textMuted }}>
                            chantier_id: <code style={{ background:"rgba(255,255,255,0.06)", padding:"1px 5px", borderRadius:3, fontSize:FONT.xs.size }}>{p.chantier_id || "—"}</code>
                          </div>
                          {dejaChantier && dejaChantier.id !== selected && (
                            <div style={{
                              display:"inline-block", marginTop:4,
                              fontSize:FONT.xs.size, color:"#f97316",
                              background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.3)",
                              borderRadius:RADIUS.sm, padding:"1px 6px", fontWeight:600,
                            }}>
                              Actuellement lié à : {dejaChantier.nom}
                            </div>
                          )}
                        </div>
                        <button onClick={()=>lierPhasage(p.id)} style={{
                          display:"inline-flex", alignItems:"center", gap:5,
                          flexShrink:0, padding:"6px 12px", borderRadius:RADIUS.md, border:"none",
                          background:acc.accent, color:acc.onAccent,
                          fontSize:FONT.xs.size + 1, fontWeight:700,
                          cursor:"pointer", fontFamily:"inherit",
                        }}>
                          <Icon as={Check} size={11}/>
                          Lier
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ padding:"10px 18px", borderTop:`1px solid ${border}`, display:"flex", justifyContent:"flex-end", flexShrink:0 }}>
                <button onClick={()=>setShowLierPhasage(false)} style={{
                  padding:"7px 16px", borderRadius:RADIUS.md, border:`1px solid ${border}`,
                  background:"transparent", color:textSub,
                  cursor:"pointer", fontFamily:"inherit",
                  fontSize:FONT.sm.size, fontWeight: 600,
                }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Section : Localisation (adresse + carte + street view) ── */}
        <div>
          <div style={sectionTitle}>
            <Icon as={MapPin} size={13}/> Localisation
          </div>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, padding: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={adresseDraft}
                onChange={e => setAdresseDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveAdresse(); }}
                placeholder="Ex : 10 rue de la Paix, 75002 Paris"
                style={{
                  flex: 1, minWidth: 200,
                  padding: "9px 12px 9px 32px",
                  borderRadius: RADIUS.md,
                  border: `1px solid ${border}`,
                  background: T?.inputBg || card, color: text,
                  fontFamily: "inherit", fontSize: FONT.base.size,
                  outline: "none",
                  backgroundImage: "none",
                  position: "relative",
                }}
              />
              <button onClick={handleSaveAdresse} disabled={!adresseDraft.trim() || adresseSaving} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 16px",
                borderRadius: RADIUS.md, border: "none",
                background: !adresseDraft.trim() || adresseSaving ? textMuted : acc.accent,
                color: acc.onAccent, fontFamily: "inherit",
                fontSize: FONT.sm.size, fontWeight: 800,
                cursor: !adresseDraft.trim() || adresseSaving ? "not-allowed" : "pointer",
              }}>
                <Icon as={Search} size={13}/>
                {adresseSaving ? "Recherche…" : adresseGeo ? "Mettre à jour" : "Localiser"}
              </button>
              {adresseGeo && (
                <button onClick={handleRemoveAdresse} title="Retirer l'adresse" style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "9px 11px",
                  borderRadius: RADIUS.md, border: `1px solid ${border}`,
                  background: "transparent", color: "#e15a5a",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Icon as={X} size={13}/>
                </button>
              )}
            </div>
            {adresseError && (
              <div style={{
                marginTop: 10, padding: "6px 12px", borderRadius: RADIUS.md,
                background: "rgba(225,90,90,0.10)", color: "#e15a5a",
                fontSize: FONT.xs.size + 1, fontWeight: 600,
              }}>{adresseError}</div>
            )}

            {adresseGeo && (() => {
              // Si une clé Google Maps Embed est fournie via VITE_GOOGLE_MAPS_KEY,
              // on utilise l'API officielle qui permet d'afficher Street View
              // directement en iframe. Sinon, fallback sur la carte basique
              // (sans clé) + bouton qui ouvre Street View dans un nouvel onglet.
              const gMapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
              const mapSrc = gMapsKey
                ? `https://www.google.com/maps/embed/v1/place?key=${gMapsKey}&q=${adresseGeo.lat},${adresseGeo.lon}&zoom=17`
                : `https://www.google.com/maps?q=${adresseGeo.lat},${adresseGeo.lon}&z=17&output=embed`;
              const svSrc = gMapsKey
                ? `https://www.google.com/maps/embed/v1/streetview?key=${gMapsKey}&location=${adresseGeo.lat},${adresseGeo.lon}&heading=0&pitch=0&fov=90`
                : null;
              return (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
                  marginTop: 14,
                }} className="ch-map-grid">
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: textMuted, letterSpacing: .8, textTransform: "uppercase" }}>
                        Vue carte
                      </span>
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 4,
                           fontSize: FONT.xs.size, color: acc.accent, textDecoration: "none",
                           fontWeight: 700,
                         }}>
                        <Icon as={ExternalLink} size={11}/>
                        Itinéraire
                      </a>
                    </div>
                    <iframe
                      title="Carte du chantier"
                      src={mapSrc}
                      style={{ width: "100%", height: 280, border: 0, borderRadius: RADIUS.lg, display: "block" }}
                      loading="lazy"
                      allowFullScreen
                    />
                  </div>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: textMuted, letterSpacing: .8, textTransform: "uppercase" }}>
                        Street View
                      </span>
                      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 4,
                           fontSize: FONT.xs.size, color: acc.accent, textDecoration: "none",
                           fontWeight: 700,
                         }}>
                        <Icon as={ExternalLink} size={11}/>
                        Plein écran
                      </a>
                    </div>
                    {svSrc ? (
                      <iframe
                        title="Street View"
                        src={svSrc}
                        style={{ width: "100%", height: 280, border: 0, borderRadius: RADIUS.lg, display: "block" }}
                        loading="lazy"
                        allowFullScreen
                      />
                    ) : (
                      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
                           width: "100%", height: 280,
                           borderRadius: RADIUS.lg,
                           background: `linear-gradient(135deg, ${acc.bg10}, ${acc.bg20})`,
                           border: `1px dashed ${acc.border}`,
                           color: acc.accent,
                           textDecoration: "none",
                           cursor: "pointer", transition: "transform .15s, border-color .15s",
                         }}
                         onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = acc.accent; }}
                         onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = acc.border; }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: "50%",
                          background: acc.bg20, color: acc.accent,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <Icon as={MapPin} size={24}/>
                        </div>
                        <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, textAlign: "center", maxWidth: 260, lineHeight: 1.4 }}>
                          Configurez VITE_GOOGLE_MAPS_KEY pour afficher Street View intégré
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, color: textMuted }}>
                          <Icon as={ExternalLink} size={11}/>
                          Cliquer pour ouvrir Street View dans Google Maps
                        </span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
            {!adresseGeo && (
              <div style={{
                marginTop: 12, fontSize: FONT.xs.size + 1, color: textMuted, opacity: .7,
              }}>
                Saisissez l'adresse du chantier pour afficher la carte et le Street View.
              </div>
            )}
          </div>
        </div>

        {/* ── Section : Notes du chantier ── */}
        <div>
          <div style={sectionTitle}>
            <Icon as={StickyNote} size={13}/> Notes du chantier
          </div>
          <NotesChantier chantierId={selected} T={T} accent={acc.accent}/>
        </div>

        </>)}
        {(!isMobile || detailTab === "finances") && (<>
        {/* ── Section : Suivi des heures par ouvrage ── */}
        {heuresParOuvrage.length > 0 && (
          <div>
            <div style={sectionTitle}>
              <Icon as={Clock} size={13}/> Suivi des heures par ouvrage
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {/* Totaux en haut */}
              {totalHeures.vendues > 0 && (() => {
                const drift = (totalHeures.reelles / totalHeures.vendues) * 100;
                const col = drift > 120 ? "#ef4444" : drift > 100 ? "#f59e0b" : "#22c55e";
                return (
                  <div style={{
                    padding: "14px 16px",
                    borderBottom: `1px solid ${border}`,
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: textMuted, letterSpacing: 1, textTransform: "uppercase" }}>
                      Total chantier
                    </span>
                    <span style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -0.3 }}>
                      {fmtH(totalHeures.reelles)}h
                      <span style={{ fontSize: FONT.sm.size, color: textMuted, fontWeight: 600, marginLeft: 4 }}>
                        / {fmtH(totalHeures.vendues)}h vendues
                      </span>
                    </span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: col,
                      background: col + "18", border: `1px solid ${col}40`,
                      borderRadius: RADIUS.pill, padding: "3px 10px",
                      marginLeft: "auto",
                    }}>
                      <Icon as={drift > 100 ? TrendingUp : TrendingDown} size={11}/>
                      {drift.toFixed(0)}%
                    </span>
                  </div>
                );
              })()}
              {heuresParOuvrage.map(o => {
                const drift = o.vendues > 0 ? (o.reelles / o.vendues) * 100 : (o.reelles > 0 ? 999 : 0);
                const col = drift > 120 ? "#ef4444" : drift > 100 ? "#f59e0b" : "#22c55e";
                const widthVendu  = Math.min(100, drift);
                const widthOver   = Math.min(80, Math.max(0, drift - 100));
                return (
                  <div key={o.id} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: o.couleur, flexShrink: 0 }}/>
                      <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                      <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: col, flexShrink: 0 }}>
                        {fmtH(o.reelles)}h / {fmtH(o.vendues)}h
                        {o.vendues > 0 && (
                          <span style={{ fontSize: FONT.xs.size, opacity: .8, marginLeft: 5, fontWeight: 700 }}>
                            ({drift.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(128,128,128,0.2)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${widthVendu}%`, background: col, transition: "width .4s ease" }}/>
                      {widthOver > 0 && (
                        <div style={{
                          width: `${widthOver}%`,
                          background: "repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, rgba(239,68,68,0.6) 4px, rgba(239,68,68,0.6) 8px)",
                        }}/>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 2 : Finances ── */}
        {finances && finances.prixVendu > 0 && (
          <div>
            <div style={sectionTitle}>
              <Icon as={Wallet} size={13}/> Finances du chantier
            </div>
            <div className="ch-fin-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${finances.fg > 0 ? 5 : 4},1fr)`, gap: 12 }}>
              {[
                { label: finances.fin ? "Vendu HT" : "Prix marché HT",
                  val: fmt(finances.prixVendu), color: text,
                  sub: finances.fin ? "Somme des ouvrages" : "Vendu au client", icon: Banknote },
                { label: "Coût main d'œuvre", val: fmt(finances.coutMO),   color: "#60a5fa",  sub: "Heures réelles",  icon: HardHat },
                { label: "Coût matériaux",    val: fmt(finances.coutMat),  color: "#f59e0b",  sub: "Matériaux",        icon: Receipt },
                ...(finances.fg > 0 ? [{ label: "Frais généraux", val: fmt(finances.fg), color: "#a78bfa", sub: "Taux × heures réelles", icon: Wallet }] : []),
                { label: finances.fin ? "Marge nette" : "Marge brute",
                  val: fmt(finances.marge),
                  color: finances.marge >= 0 ? "#22c55e" : "#e15a5a",
                  sub: `${finances.margePct.toFixed(1)}% du ${finances.fin ? "vendu" : "marché"}`,
                  icon: finances.marge >= 0 ? TrendingUp : TrendingDown,
                  bold: true },
              ].map(s => (
                <div key={s.label} className="ch-stat-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, marginBottom: 6, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase" }}>
                    <Icon as={s.icon} size={11}/>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: s.bold ? 800 : 700, color: s.color, lineHeight: 1.15, letterSpacing: -0.3 }}>{s.val}</div>
                  <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 4, opacity: .75 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {/* Contrôle d'écart : somme des ouvrages vs montant du devis saisi.
                Un écart signale une donnée à corriger (avenant oublié, ouvrage
                non chiffré), pas une marge. */}
            {finances.fin?.warnings?.some(w => w.code === "ecart_vendu") && (
              <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: "#f5a623", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon as={Info} size={12}/>
                {finances.fin.warnings.find(w => w.code === "ecart_vendu").message}
              </div>
            )}
            {finances.coutTotal > 0 && (
              <div style={{ marginTop: 12, background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "12px 16px" }}>
                <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginBottom: 8 }}>Décomposition du coût total ({fmt(finances.coutTotal)})</div>
                <div style={{ display: "flex", height: 8, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                  <div style={{ flex: finances.coutMO || 0.001, background: "#60a5fa" }}/>
                  <div style={{ flex: finances.coutMat || 0.001, background: "#f59e0b" }}/>
                  {finances.fg > 0 && <div style={{ flex: finances.fg, background: "#a78bfa" }}/>}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "#60a5fa", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#60a5fa" }}/>
                    Main d'œuvre {finances.coutTotal > 0 ? `${Math.round((finances.coutMO/finances.coutTotal)*100)}%` : ""}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }}/>
                    Matériaux {finances.coutTotal > 0 ? `${Math.round((finances.coutMat/finances.coutTotal)*100)}%` : ""}
                  </span>
                  {finances.fg > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "#a78bfa", fontWeight: 600 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a78bfa" }}/>
                      Frais généraux {finances.coutTotal > 0 ? `${Math.round((finances.fg/finances.coutTotal)*100)}%` : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 2bis : Budget prévisionnel & suivi des coûts ── */}
        {selectedPhasage && (() => {
          const allTaches   = PHASES.flatMap(ph => (selectedPhasage.plan_travaux?.[ph.id] || []));
          // Heures vendues : nouveau modèle = somme des heures_devis des ouvrages
          // (source de vérité depuis le refactor). Fallback : somme des
          // heures_vendues des tâches du planning (ancien modèle).
          const totalHVenduOuvrages = (selectedPhasage.ouvrages || []).reduce(
            (s, o) => s + (parseFloat(o.heures_devis) || 0), 0
          );
          const totalHVendues = totalHVenduOuvrages > 0
            ? totalHVenduOuvrages
            : allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
          // Coût MO prévisionnel : V2 = module (heures vendues × taux Admin,
          // identique à Phasage V2). Repli V1 : même formule sur les heures
          // vendues des tâches du plan.
          const tauxMoyen      = tauxMOPrev > 0 ? tauxMOPrev : TAUX_MO_PREV_DEFAUT;
          const coutMOPrev     = finances?.fin ? finances.moPrev : totalHVendues * tauxMoyen;
          const coutMOReel     = finances?.coutMO || 0;

          // Détail matériaux : par OUVRAGE en V2 (prévu = cout_materiaux estimé,
          // réel = lignes de commande rattachées), par PHASE en repli legacy V1.
          const hasV2Budget = (selectedPhasage.ouvrages || []).length > 0;
          let lignesMat, totalMatReel, aucunMatPrev;
          if (hasV2Budget) {
            const ouvrages = selectedPhasage.ouvrages || [];
            lignesMat = ouvrages.map(o => {
              const coutPrev = parseFloat(o.cout_materiaux) || 0;
              const coutReel = totalLignes(commandeLignesSelected.filter(l => l.ouvrage_id === o.id));
              return {
                id: o.id, label: o.libelle || "(sans nom)", couleur: acc.accent, emoji: null,
                matsPrev: [], coutPrev, coutReel, dateCmd: null,
                hasMat: coutPrev > 0 || coutReel > 0,
                statutCmd: coutReel > 0 ? "commande" : "a_commander",
              };
            }).filter(l => l.hasMat);
            // Lignes de commande non rattachées à un ouvrage → ligne récap.
            const orphanReel = totalLignes(commandeLignesSelected.filter(l => !l.ouvrage_id));
            if (orphanReel > 0) {
              lignesMat.push({
                id: "_orphan", label: "Commandes non rattachées", couleur: textMuted, emoji: null,
                matsPrev: [], coutPrev: 0, coutReel: orphanReel, dateCmd: null,
                hasMat: true, statutCmd: "commande",
              });
            }
            // Réel = TOTAL des lignes de commande du chantier (source de vérité,
            // identique à PhasageV2), y compris les lignes non rattachées.
            totalMatReel = totalLignes(commandeLignesSelected);
            aucunMatPrev = false;
          } else {
            // Agrégats matériaux par phase (ancien modèle V1)
            lignesMat = PHASES.map(ph => {
              const taches    = selectedPhasage.plan_travaux?.[ph.id] || [];
              const matsPrev  = selectedPhasage.plan_travaux?.[ph.id + "__materiaux_prevus"] || [];
              const coutCmd   = parseFloat(selectedPhasage.plan_travaux?.[ph.id + "__cout_commandes"]) || 0;
              const dateCmd   = selectedPhasage.plan_travaux?.[ph.id + "__date_commande"] || null;
              const coutPrev  = matsPrev.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
              const coutMatTaches = taches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
              const coutReel  = coutMatTaches + coutCmd;
              return {
                id: ph.id, label: ph.label, couleur: ph.couleur, emoji: ph.emoji,
                matsPrev, coutPrev, coutReel, coutCmd, dateCmd,
                hasMat: matsPrev.length > 0 || coutCmd > 0 || coutMatTaches > 0,
                statutCmd: coutCmd > 0 ? "commande" : "a_commander",
              };
            }).filter(l => l.hasMat);
            totalMatReel = lignesMat.reduce((s, l) => s + l.coutReel, 0);
            aucunMatPrev = lignesMat.every(l => l.matsPrev.length === 0);
          }

          // Matériaux prévisionnel = somme des coûts matériaux estimés des
          // ouvrages (cout_materiaux, calculé depuis les matériaux liés de la
          // bibliothèque). Remplace l'ancien total basé sur les matériaux saisis
          // manuellement par phase (vide après un import de devis).
          const totalMatPrev = (selectedPhasage.ouvrages || []).reduce(
            (s, o) => s + (parseFloat(o.cout_materiaux) || 0), 0
          );
          const coutTotalPrev = coutMOPrev + totalMatPrev;
          const coutTotalReel = coutMOReel + totalMatReel;
          const prixVendu    = parseFloat(selectedPhasage.prix_vendu) || 0;
          const margePrev    = prixVendu - coutTotalPrev;
          const margeReel    = prixVendu - coutTotalReel;

          const fmtH = (n) => `${(+(parseFloat(n) || 0).toFixed(1))}h`;
          const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;

          return (
            <div>
              <div style={sectionTitle}>
                <Icon as={TrendingUp} size={13}/> Budget prévisionnel & suivi des coûts
              </div>

              <div className="ch-budget-grid" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
                {/* ── SECTION 1 : Main d'œuvre ── */}
                <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                    <Icon as={HardHat} size={12} color="#60a5fa"/>
                    Main d'œuvre
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Heures vendues</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace" }}>{fmtH(totalHVendues)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                        Taux MO prévisionnel
                        <span style={{ fontSize: 10, color: textMuted, opacity: .7, marginLeft: 5, fontStyle: "italic" }}>{tauxMOPrev > 0 ? "(réglages)" : `(défaut ${TAUX_MO_PREV_DEFAUT} €/h)`}</span>
                      </span>
                      <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, fontFamily: "'DM Mono',monospace" }}>{tauxMoyen.toFixed(2)} €/h</span>
                    </div>
                    <div style={{ height: 1, background: border, margin: "2px 0" }}/>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Coût MO prévisionnel</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: "#60a5fa", fontFamily: "'DM Mono',monospace" }}>{fmt(coutMOPrev)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Coût MO réel</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: coutMOReel > coutMOPrev && coutMOPrev > 0 ? "#e15a5a" : text, fontFamily: "'DM Mono',monospace" }}>{fmt(coutMOReel)}</span>
                    </div>
                  </div>
                </div>

                {/* ── SECTION 2 : Matériaux ── */}
                <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                    <Icon as={Package} size={12} color="#f59e0b"/>
                    {hasV2Budget ? "Matériaux par ouvrage" : "Matériaux par phase"}
                  </div>

                  {lignesMat.length === 0 || aucunMatPrev ? (
                    <div style={{
                      padding: "20px 14px", textAlign: "center",
                      background: card, borderRadius: RADIUS.md, border: `1px dashed ${border}`,
                      color: textMuted,
                    }}>
                      <Icon as={Package} size={24} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 6 }}/>
                      <div style={{ fontSize: FONT.sm.size, color: text, fontWeight: 600, marginBottom: 3 }}>
                        {hasV2Budget ? "Aucun matériau ni commande" : "Aucun matériau prévisionnel défini"}
                      </div>
                      <div style={{ fontSize: FONT.xs.size + 1, opacity: .8, lineHeight: 1.5 }}>
                        {hasV2Budget
                          ? <>Renseigne les matériaux des ouvrages et les commandes depuis la page <strong style={{ color: text }}>Phasage</strong>.</>
                          : <>Ajoute des matériaux par phase depuis la page <strong style={{ color: text }}>Phasage</strong>.</>}
                      </div>
                    </div>
                  ) : (
                    <div className="ch-budget-mat-wrap" style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: hasV2Budget ? 380 : 600 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${border}` }}>
                            {[
                              { l: hasV2Budget ? "Ouvrage" : "Phase", align: "left", w: 160 },
                              ...(hasV2Budget ? [] : [{ l: "Matériaux prévus", align: "left", w: null }]),
                              { l: "Prévu HT",       align: "right",  w: 90 },
                              { l: "Réel HT",        align: "right",  w: 90 },
                              { l: "Statut",         align: "center", w: 100 },
                              ...(hasV2Budget ? [] : [{ l: "À cmd. avant", align: "center", w: 110 }]),
                            ].map(h => (
                              <th key={h.l} style={{
                                padding: "8px 8px", fontSize: 10, fontWeight: 700, color: textMuted,
                                textTransform: "uppercase", letterSpacing: .8, textAlign: h.align,
                                width: h.w || undefined,
                              }}>{h.l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lignesMat.map(l => (
                            <tr key={l.id} style={{ borderBottom: `1px solid ${border}` }}>
                              <td style={{ padding: "8px 8px" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.couleur, flexShrink: 0 }}/>
                                  <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: text }}>{l.emoji ? `${l.emoji} ` : ""}{l.label}</span>
                                </span>
                              </td>
                              {!hasV2Budget && (
                                <td style={{ padding: "8px 8px", fontSize: FONT.xs.size + 1, color: textSub, lineHeight: 1.5 }}>
                                  {l.matsPrev.length === 0 ? (
                                    <span style={{ color: textMuted, fontStyle: "italic" }}>—</span>
                                  ) : (
                                    l.matsPrev.map((m, i) => (
                                      <span key={m.id}>
                                        <span style={{ color: text, fontWeight: 600 }}>{m.libelle}</span>
                                        <span style={{ color: textMuted }}> ({m.quantite}{m.unite ? ` ${m.unite}` : ""})</span>
                                        {i < l.matsPrev.length - 1 && <span style={{ color: textMuted }}> · </span>}
                                      </span>
                                    ))
                                  )}
                                </td>
                              )}
                              <td style={{ padding: "8px 8px", textAlign: "right", fontSize: FONT.sm.size, fontWeight: 700, color: "#f59e0b", fontFamily: "'DM Mono',monospace" }}>
                                {l.coutPrev > 0 ? fmt(l.coutPrev) : "—"}
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "right", fontSize: FONT.sm.size, fontWeight: 700, color: l.coutReel > l.coutPrev && l.coutPrev > 0 ? "#e15a5a" : text, fontFamily: "'DM Mono',monospace" }}>
                                {l.coutReel > 0 ? fmt(l.coutReel) : "—"}
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "center" }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, letterSpacing: .5,
                                  padding: "2px 8px", borderRadius: RADIUS.pill,
                                  textTransform: "uppercase",
                                  background: l.statutCmd === "commande" ? "rgba(34,197,94,0.15)" : "rgba(245,166,35,0.15)",
                                  color:      l.statutCmd === "commande" ? "#22c55e" : "#f59e0b",
                                  border:    `1px solid ${l.statutCmd === "commande" ? "#22c55e44" : "#f59e0b44"}`,
                                }}>
                                  {l.statutCmd === "commande" ? "Commandé" : "À commander"}
                                </span>
                              </td>
                              {!hasV2Budget && (
                                <td style={{ padding: "8px 8px", textAlign: "center", fontSize: FONT.xs.size + 1, color: l.dateCmd ? textSub : textMuted, fontStyle: l.dateCmd ? "normal" : "italic" }}>
                                  {fmtDate(l.dateCmd) || "—"}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* ── TOTAUX ── */}
              <div style={{ marginTop: 12, background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                <div className="ch-budget-totaux" style={{ display: "grid", gridTemplateColumns: prixVendu > 0 ? "repeat(6,1fr)" : "repeat(4,1fr)", gap: 12 }}>
                  {[
                    { l: "MO prévisionnel",  v: coutMOPrev,  color: "#60a5fa" },
                    { l: "MO réel",          v: coutMOReel,  color: coutMOReel > coutMOPrev && coutMOPrev > 0 ? "#e15a5a" : text },
                    { l: "Matériaux prév.",  v: totalMatPrev, color: "#f59e0b" },
                    { l: "Matériaux réel",   v: totalMatReel, color: totalMatReel > totalMatPrev && totalMatPrev > 0 ? "#e15a5a" : text },
                    ...(prixVendu > 0 ? [
                      { l: "Marge prévisionnelle", v: margePrev, color: margePrev >= 0 ? "#22c55e" : "#e15a5a", bold: true, sub: `Coût ${fmt(coutTotalPrev)} vs ${fmt(prixVendu)}` },
                      { l: "Marge constatée",      v: margeReel, color: margeReel >= 0 ? "#22c55e" : "#e15a5a", bold: true, sub: `Coût ${fmt(coutTotalReel)} vs ${fmt(prixVendu)}` },
                    ] : []),
                  ].map(t => (
                    <div key={t.l}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: .6, marginBottom: 4 }}>{t.l}</div>
                      <div style={{ fontSize: t.bold ? 17 : 15, fontWeight: t.bold ? 800 : 700, color: t.color, fontFamily: "'DM Mono',monospace", letterSpacing: -0.3 }}>
                        {fmt(t.v)}
                      </div>
                      {t.sub && <div style={{ fontSize: 10, color: textMuted, marginTop: 3, opacity: .85 }}>{t.sub}</div>}
                    </div>
                  ))}
                </div>
                {prixVendu === 0 && (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, color: textMuted, fontStyle: "italic" }}>
                    <Icon as={Info} size={11}/>
                    Prix vendu non renseigné dans le phasage — la marge n'est pas affichée.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        </>)}
        {(!isMobile || detailTab === "suivi") && (<>
        {/* ── Section 3 : Comptes rendus ── */}
        <div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...sectionTitle, marginBottom: 0 }}>
                <Icon as={ClipboardList} size={13}/> Derniers comptes rendus client
              </div>
              <button onClick={ouvrirLierModal} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: FONT.xs.size + 1, fontWeight: 600,
                padding: "5px 10px", borderRadius: RADIUS.md,
                border: `1px solid ${border}`, background: "transparent", color: textSub,
                cursor: "pointer", fontFamily: "inherit",
                transition: "border-color .12s, color .12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = textSub; }}>
                <Icon as={Link2} size={11}/>
                Lier un CR
              </button>
            </div>

            {/* Modale liaison CRs existants */}
            {showLierModal && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:800, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowLierModal(false)}>
                <div style={{ background:surface, border:`1px solid ${border}`, borderRadius:RADIUS.xl, width:"100%", maxWidth:560, maxHeight:"80vh", display:"flex", flexDirection:"column", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e=>e.stopPropagation()}>
                  <div style={{ padding:"16px 20px 12px", borderBottom:`1px solid ${border}`, flexShrink:0, display:"flex", alignItems:"center", gap:10 }}>
                    <Icon as={Link2} size={16} color={acc.accent}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:FONT.md.size, fontWeight:800, color:text, letterSpacing:-.2 }}>
                        Lier un compte rendu
                      </div>
                      <div style={{ fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3 }}>
                        À <span style={{color:acc.accent, fontWeight:600}}>{selectedChantier?.nom}</span>
                      </div>
                    </div>
                    <button onClick={()=>setShowLierModal(false)} title="Fermer" style={{
                      background:"transparent", border:"none", color:textMuted,
                      cursor:"pointer", padding:4, borderRadius:RADIUS.sm,
                      display:"inline-flex", alignItems:"center",
                    }}>
                      <Icon as={X} size={18}/>
                    </button>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
                    {loadingTous ? (
                      <div style={{ textAlign:"center", padding:40, color:textMuted, fontSize:FONT.sm.size }}>Chargement…</div>
                    ) : tousCRs.length === 0 ? (
                      <div style={{ textAlign:"center", padding:40, color:textMuted, opacity:.65, fontSize:FONT.sm.size }}>
                        Tous les comptes rendus sont déjà liés à un chantier.
                      </div>
                    ) : (
                      tousCRs.map(cr => {
                        const nomClient = cr.client_nom1 ? `${cr.client_prenom1||""} ${cr.client_nom1}`.trim() : "Sans client";
                        const dejaLie = cr.chantier_id && cr.chantier_id !== selected;
                        return (
                          <div key={cr.id} style={{
                            display:"flex", alignItems:"center", gap:12,
                            padding:"11px 14px", borderRadius:RADIUS.md, marginBottom:8,
                            background:card, border:`1px solid ${border}`,
                          }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                                <span style={{ fontSize:FONT.sm.size + 1, fontWeight:700, color:text }}>{nomClient}</span>
                                {dejaLie && (
                                  <span style={{
                                    fontSize:FONT.xs.size, color:"#f97316",
                                    background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.3)",
                                    borderRadius:RADIUS.sm, padding:"1px 6px", fontWeight:600,
                                  }}>
                                    Lié à un autre chantier
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize:FONT.xs.size + 1, color:textMuted }}>
                                {cr.type_visite || "Visite"}{cr.date_visite ? ` · ${new Date(cr.date_visite).toLocaleDateString("fr-FR")}` : ""}
                              </div>
                              {cr.adresse && <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:FONT.xs.size, color:textMuted, opacity:.55, marginTop:2 }}>
                                <Icon as={MapPin} size={9}/> {cr.adresse}
                              </div>}
                              {cr.resume && <div style={{
                                fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3, opacity:.75,
                                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                              }}>{cr.resume}</div>}
                            </div>
                            <button onClick={()=>lierCR(cr.id)} style={{
                              display:"inline-flex", alignItems:"center", gap:5,
                              flexShrink:0, padding:"6px 12px", borderRadius:RADIUS.md, border:"none",
                              background:acc.accent, color:acc.onAccent,
                              fontSize:FONT.xs.size + 1, fontWeight:700,
                              cursor:"pointer", fontFamily:"inherit",
                            }}>
                              <Icon as={Check} size={11}/>
                              Lier
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div style={{ padding:"10px 18px", borderTop:`1px solid ${border}`, display:"flex", justifyContent:"flex-end", flexShrink:0 }}>
                    <button onClick={()=>setShowLierModal(false)} style={{
                      padding:"7px 16px", borderRadius:RADIUS.md, border:`1px solid ${border}`,
                      background:"transparent", color:textSub,
                      cursor:"pointer", fontFamily:"inherit",
                      fontSize:FONT.sm.size, fontWeight: 600,
                    }}>Fermer</button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {loadingCR ? (
                <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: FONT.sm.size }}>Chargement…</div>
              ) : compteRendus.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: FONT.sm.size }}>
                  <div style={{ opacity: .55, marginBottom: 8 }}>Aucun compte rendu client pour ce chantier.</div>
                  <div style={{ fontSize: FONT.xs.size + 1, opacity: .55, lineHeight: 1.6 }}>
                    Dans la page « Compte rendu client », renseignez<br/>
                    <strong style={{ color: text, opacity: .75 }}>{selectedChantier?.nom}</strong> dans le champ <em>Adresse</em><br/>
                    pour lier automatiquement les CRs à ce chantier.
                  </div>
                </div>
              ) : (
                compteRendus.map((cr, i) => (
                  <div key={cr.id || i} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: text }}>
                          {cr.date_visite ? new Date(cr.date_visite).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}
                        </span>
                        {cr.type_visite && (
                          <span style={{ fontSize: FONT.xs.size, color: textMuted, background: "rgba(255,255,255,0.06)", borderRadius: RADIUS.sm, padding: "1px 6px", fontWeight: 600 }}>{cr.type_visite}</span>
                        )}
                      </div>
                      {cr.avancement != null && (
                        <span style={{ fontSize: FONT.xs.size + 1, color: acc.accent, fontWeight: 700 }}>{cr.avancement}%</span>
                      )}
                    </div>
                    {cr.adresse && (
                      <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize: FONT.xs.size, color: textMuted, opacity: .55, marginBottom: 3 }}>
                        <Icon as={MapPin} size={9}/> {cr.adresse}
                      </div>
                    )}
                    {cr.resume && (
                      <p style={{ fontSize: FONT.xs.size + 1, color: textMuted, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {cr.resume}
                      </p>
                    )}
                    {cr.prochaine_etape && (
                      <div style={{ fontSize: FONT.xs.size + 1, color: "#3b82f6", marginTop: 5, fontWeight: 600 }}>→ {cr.prochaine_etape}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Section : Activité équipe récente (rapports ouvriers) ── */}
        {rapportsEquipe.length > 0 && (
          <div>
            <div style={{ ...sectionTitle, marginBottom: 12 }}>
              <Icon as={HardHat} size={13}/>
              Activité équipe récente
              <span style={{ color: acc.accent, fontWeight: 800, marginLeft: 4 }}>· {rapportsEquipe.length}</span>
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {rapportsEquipe.slice(0, 8).map(r => {
                const taches = r.taches || [];
                const nbFaites    = taches.filter(t => t.statut === "faite").length;
                const nbEnCours   = taches.filter(t => t.statut === "en_cours").length;
                const nbNonFaites = taches.filter(t => t.statut === "non_faite").length;
                const totalHeures = taches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
                return (
                  <div key={r.id} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: FONT.sm.size + 1, fontWeight: 700, color: text,
                      }}>
                        <Icon as={HardHat} size={13} color={acc.accent}/>
                        {r.ouvrier}
                      </span>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                        {r.date_rapport}
                      </span>
                      {totalHeures > 0 && (
                        <span style={{ fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 700 }}>
                          {fmtH(totalHeures)}h
                        </span>
                      )}
                      <div style={{ marginLeft: "auto", display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {nbFaites > 0 && (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#22c55e", background: "rgba(34,197,94,0.10)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            <Icon as={Check} size={9}/> {nbFaites} faite{nbFaites > 1 ? "s" : ""}
                          </span>
                        )}
                        {nbEnCours > 0 && (
                          <span style={{
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#f59e0b", background: "rgba(245,158,11,0.10)",
                            border: "1px solid rgba(245,158,11,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            {nbEnCours} en cours
                          </span>
                        )}
                        {nbNonFaites > 0 && (
                          <span style={{
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#e15a5a", background: "rgba(225,90,90,0.10)",
                            border: "1px solid rgba(225,90,90,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            {nbNonFaites} non faite{nbNonFaites > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {taches.length > 0 && (
                      <div style={{
                        fontSize: FONT.xs.size + 1, color: textMuted, lineHeight: 1.5,
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>
                        {taches.map(t => t.planifie).filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })}
              {rapportsEquipe.length > 8 && (
                <div style={{ padding: "10px 16px", textAlign: "center", fontSize: FONT.xs.size + 1, color: textMuted, borderTop: `1px solid ${border}` }}>
                  + {rapportsEquipe.length - 8} rapport{rapportsEquipe.length - 8 > 1 ? "s" : ""} plus ancien{rapportsEquipe.length - 8 > 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section 4 : Galerie photos équipe ── */}
        <div>
          <div style={{ ...sectionTitle, marginBottom: 12 }}>
            <Icon as={ImageIcon} size={13}/>
            Photos des équipes
            {photosEquipe.length > 0 && <span style={{color:acc.accent, fontWeight: 800, marginLeft: 4 }}>· {photosEquipe.length}</span>}
          </div>
          {photosEquipe.length === 0 ? (
            <div style={{
              background: card, border: `2px dashed ${border}`, borderRadius: RADIUS.xl,
              padding: "32px 20px", textAlign: "center", color: textMuted,
            }}>
              <Icon as={Camera} size={32} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 10 }}/>
              <div style={{ fontSize: FONT.base.size, fontWeight: 600, marginBottom: 5, color: text }}>Aucune photo pour ce chantier</div>
              <div style={{ fontSize: FONT.xs.size + 1, opacity: .6 }}>
                Les photos jointes par les ouvriers à leur compte rendu apparaîtront ici.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
              {photosEquipe.map((ph, i) => (
                <div key={i}
                  onClick={() => setLightboxGal({ urls: photosEquipe.map(p => p.url), idx: i, items: photosEquipe })}
                  style={{
                    position:"relative", aspectRatio:"1/1", borderRadius:RADIUS.lg, overflow:"hidden",
                    border:`1px solid ${border}`, cursor:"pointer", background:"#0a0c10",
                  }}>
                  <img src={photoTransform(ph.url,{width:256,height:256})} alt="" loading="lazy"
                    style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                  <div style={{position:"absolute",bottom:0,left:0,right:0,
                    background:"linear-gradient(transparent, rgba(0,0,0,0.78))",
                    padding:"14px 8px 6px",color:"#fff"}}>
                    <div style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:FONT.xs.size,fontWeight:700}}>
                      <Icon as={HardHat} size={10}/> {ph.ouvrier}
                    </div>
                    <div style={{fontSize:FONT.xs.size - 1,opacity:.8,marginTop:1}}>{new Date(ph.date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </>)}

      </div>

      {/* Lightbox galerie */}
      {lightboxGal && (
        <div onClick={()=>setLightboxGal(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:14
        }}>
          <img src={photoTransform(lightboxGal.urls[lightboxGal.idx],{width:1920,height:1920,resize:"contain",quality:80})} alt="" style={{
            maxWidth:"100%",maxHeight:"calc(100vh - 140px)",objectFit:"contain",borderRadius:RADIUS.md
          }} onClick={e=>e.stopPropagation()}/>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}} onClick={e=>e.stopPropagation()}>
            {lightboxGal.urls.length > 1 && (
              <>
                <button onClick={()=>setLightboxGal(l=>({...l, idx:(l.idx-1+l.urls.length)%l.urls.length}))}
                  style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:RADIUS.md,padding:"8px 12px",cursor:"pointer",
                    fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronLeft} size={16}/>
                </button>
                <span style={{color:"#fff",fontSize:FONT.sm.size,fontWeight:600}}>{lightboxGal.idx+1} / {lightboxGal.urls.length}</span>
                <button onClick={()=>setLightboxGal(l=>({...l, idx:(l.idx+1)%l.urls.length}))}
                  style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:RADIUS.md,padding:"8px 12px",cursor:"pointer",
                    fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronRight} size={16}/>
                </button>
              </>
            )}
            {lightboxGal.items && lightboxGal.items[lightboxGal.idx] && (
              <span style={{display:"inline-flex",alignItems:"center",gap:6,color:"rgba(255,255,255,0.85)",fontSize:FONT.xs.size + 1}}>
                <Icon as={HardHat} size={11}/>
                {lightboxGal.items[lightboxGal.idx].ouvrier} · {new Date(lightboxGal.items[lightboxGal.idx].date).toLocaleDateString("fr-FR")} · {lightboxGal.items[lightboxGal.idx].source}
              </span>
            )}
            <a href={lightboxGal.urls[lightboxGal.idx]} target="_blank" rel="noopener noreferrer"
              style={{
                display:"inline-flex",alignItems:"center",gap:5,
                background:acc.accent,color:acc.onAccent,borderRadius:RADIUS.md,padding:"7px 12px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,textDecoration:"none",
              }}>
              <Icon as={ExternalLink} size={12}/>
              Ouvrir
            </a>
            <button onClick={()=>setLightboxGal(null)} style={{
              background:"rgba(255,255,255,0.1)",
              border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:RADIUS.md,
              padding:"7px 14px",cursor:"pointer",fontFamily:"inherit",
              fontSize:FONT.sm.size,fontWeight:600,
            }}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cercle d'avancement ──────────────────────────────────────────────────────
function AvancementCircle({ value, accent }) {
  const r    = 46;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(100, Math.max(0, value || 0));
  const dash = (pct / 100) * circ;
  const color = pct >= 100 ? "#22c55e" : accent;
  return (
    <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(128,128,128,0.2)" strokeWidth="9"/>
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
          style={{ transition: "stroke-dasharray .5s ease" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, letterSpacing: -0.3 }}>{pct}%</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2, letterSpacing: .3, textTransform: "uppercase", fontWeight: 600 }}>avancement</span>
      </div>
    </div>
  );
}
