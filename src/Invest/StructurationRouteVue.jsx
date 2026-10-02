// src/Invest/StructurationRouteVue.jsx — Feuille de route et rapports (lot 5).
// La feuille de route se déduit du dossier (structurationFeuilleRoute.mjs) : on choisit seulement le scénario retenu.
import React from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { FileText } from "lucide-react";
import { SU, WA } from "./_shared";
import { construireFeuilleRoute, LIBELLES_TYPES } from "./structurationFeuilleRoute.mjs";

const COULEURS = { reserve: "#d97706", action: "#4db8ff", operation: SU, objectif: "#7c3aed", revue: "#94a3b8" };

export function FeuilleDeRouteEtRapports({ T, data, onChange, onRapport, anneeDepart }) {
  const scenarios = Array.isArray(data.scenarios_chiffres) ? data.scenarios_chiffres : [];
  const route = construireFeuilleRoute(data, { anneeDepart, hypotheses: data.hypotheses_diagnostic || {} });
  const carte = { background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md };
  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <section style={carte}>
        <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>Rapports remis au client</h3>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "4px 0 10px", maxWidth: 860 }}>
          Deux niveaux de lecture. La <b>synthèse exécutive</b> (10 pages) répond aux questions du client : où il en est, où il va, ce que nous recommandons, ce qui peut mal tourner, ce que nous faisons maintenant. Le <b>rapport complet</b> y ajoute les annexes : situation détaillée, fiches des biens, comparaison des structures, hypothèses et points à faire valider par le notaire, l'expert-comptable ou la banque. Tout est généré à partir du dossier, rien n'est ressaisi.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="inv-btn inv-btn-blue" onClick={() => onRapport("synthese")}><Icon as={FileText} size={14} />Synthèse exécutive (PDF)</button>
          <button className="inv-btn" onClick={() => onRapport("complet")}><Icon as={FileText} size={14} />Rapport complet (PDF)</button>
        </div>
      </section>

      <section style={carte}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>Feuille de route</h3>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: FONT.sm.size, color: T.textSub }}>Scénario retenu
            <select className="inv-sel" value={data.scenario_retenu_id || ""} onChange={(e) => onChange("scenario_retenu_id", e.target.value)}>
              <option value="">— aucun —</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "4px 0 8px", maxWidth: 860 }}>
          Une étude vaut par ce qu'on en fait : voici l'ordre des opérations. Cette liste se déduit du scénario retenu, des objectifs chiffrés, des actions de mise en œuvre, des intervenants à contacter et de la prochaine revue ; elle n'est pas à saisir une seconde fois.
        </div>
        {route.manquants.map((m) => <div key={m} style={{ color: WA, fontWeight: 800, fontSize: FONT.sm.size }}>À compléter : {m}.</div>)}
        {route.alertes.map((m) => <div key={m} style={{ color: WA, fontSize: FONT.sm.size }}>{m}</div>)}
        {route.parAnnee.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Rien à afficher : renseignez des objectifs, retenez un scénario ou ajoutez des actions.</div>}
        {route.parAnnee.map((g) => (
          <div key={g.annee} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12, padding: "10px 0", borderTop: `1px solid ${T.rowBorder || T.border}` }}>
            <div style={{ fontSize: FONT.xl.size, fontWeight: 900, color: T.text }}>{g.annee}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {g.items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "100px minmax(0,1fr) 150px 110px", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontSize: FONT.xs.size, fontWeight: 900, color: COULEURS[it.type], textTransform: "uppercase", letterSpacing: .5 }}>{LIBELLES_TYPES[it.type]}</span>
                  <span><b style={{ color: T.text }}>{it.titre}</b>{it.detail && <span style={{ display: "block", fontSize: FONT.xs.size + 1, color: T.textMuted }}>{it.detail}</span>}{it.dependance && <span style={{ display: "block", fontSize: FONT.xs.size + 1, color: T.textSub }}>↳ dépend de : {it.dependance}</span>}</span>
                  <span style={{ fontSize: FONT.sm.size, color: T.textSub }}>{it.responsable || "—"}</span>
                  <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: it.statut === "Fait" ? SU : T.textSub }}>{it.statut}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
