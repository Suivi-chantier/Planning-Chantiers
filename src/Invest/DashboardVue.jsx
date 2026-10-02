import React, { useState } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import {
  AlertTriangle, Eye, UserCheck, ShieldCheck, Phone, Briefcase, Home, Users,
  ChevronRight, ChevronDown, ClipboardCheck, Sparkles, CheckCircle2,
} from "lucide-react";
import { SU, WA, DA } from "./_shared";
import { safeArr, safeDate, priorityComplete } from "./tableauBord.mjs";
import { resumePilotage, actionDuJour, alertesPilotage } from "./dossiers/pilotage";

// ─────────────────────────────────────────────────────────────────────────────
// TABLEAU DE BORD — affichage (refonte du 02/10/2026)
//
// Une seule question guide l'écran : « qu'est-ce que je dois faire maintenant ? »
//   1. Une bande de quatre onglets (À décider · À surveiller · Délégué · Traité)
//      donne le volume de chacun et choisit LA liste affichée.
//   2. Cette liste est faite de lignes courtes : qui, pourquoi, qui agit, quand.
//   3. À droite, deux repères : les 3 priorités du jour et l'avancement des
//      Dossiers Invest.
// Rien ici ne calcule : les classements, décisions et chiffres viennent de
// tableauBord.mjs et de dossiers/pilotage.mjs, comme pour la veille du matin.
// ─────────────────────────────────────────────────────────────────────────────

export function levelColor(level, T) {
  return level === "danger" ? DA : level === "warning" ? WA : level === "success" ? SU : T.accent;
}

const TYPES = {
  prospect: { label: "Prospect", icon: Phone },
  client: { label: "Client", icon: Briefcase },
  bien: { label: "Bien", icon: Home },
  team: { label: "Équipe", icon: Users },
};

const ONGLETS = [
  { key: "decision", label: "À décider", icon: AlertTriangle, color: DA, vide: "Rien à arbitrer maintenant." },
  { key: "watch", label: "À surveiller", icon: Eye, color: WA, vide: "Aucun dossier sous surveillance." },
  { key: "delegated", label: "Délégué", icon: UserCheck, color: "#4db8ff", vide: "Aucune action en attente de retour." },
  { key: "done", label: "Traité aujourd'hui", icon: ShieldCheck, color: SU, vide: "Rien n'a encore été traité aujourd'hui." },
];

const PAGE = 20;

export function BandeOnglets({ onglet, setOnglet, byColumn, stats, T }) {
  return (
    <div style={{ marginBottom: SPACING.md }}>
      <div className="dbv-onglets" role="tablist">
        {ONGLETS.map(o => {
          const actif = onglet === o.key;
          const n = safeArr(byColumn[o.key]).length;
          return (
            <button key={o.key} type="button" role="tab" aria-selected={actif} onClick={() => setOnglet(o.key)}
              style={{
                textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${actif ? o.color : T.border}`,
                borderBottom: `3px solid ${actif ? o.color : T.border}`,
                background: actif ? `${o.color}12` : T.card,
                borderRadius: RADIUS.lg, padding: "12px 14px",
              }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: actif ? o.color : T.textSub, fontWeight: 800, fontSize: FONT.sm.size + 1 }}>
                  <Icon as={o.icon} size={15} />{o.label}
                </span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.xl.size, fontWeight: 900, color: n ? o.color : T.textMuted }}>{n}</span>
              </div>
            </button>
          );
        })}
      </div>
      {(stats.blocked > 0 || stats.relancesLate > 0) && (
        <div style={{ display: "flex", gap: SPACING.md, flexWrap: "wrap", marginTop: 8, fontSize: FONT.sm.size, color: T.textMuted }}>
          {stats.blocked > 0 && <span><strong style={{ color: DA }}>{stats.blocked}</strong> dossier(s) bloqué(s)</span>}
          {stats.relancesLate > 0 && <span><strong style={{ color: DA }}>{stats.relancesLate}</strong> relance(s) en retard</span>}
        </div>
      )}
    </div>
  );
}

function Ligne({ item, T, onOpen, onDecide }) {
  const color = levelColor(item.level, T);
  const type = TYPES[item.type] || TYPES.team;
  const alertes = safeArr(item.alerts);
  const premiere = alertes[0];
  return (
    <div className="dbv-ligne" style={{ borderLeft: `4px solid ${color}`, background: T.card, border: `1px solid ${T.border}`, borderLeftColor: color, borderRadius: RADIUS.md }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.textMuted, fontSize: FONT.xs.size, textTransform: "uppercase", letterSpacing: .6, fontWeight: 800 }}>
          <Icon as={type.icon} size={11} />{type.label}
          {item.readOnly && <span style={{ color: WA }}>· lecture seule</span>}
        </div>
        <div style={{ color: T.text, fontWeight: 800, fontSize: FONT.base.size, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
        {item.subtitle && <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subtitle}</div>}
      </div>
      <div style={{ minWidth: 0, fontSize: FONT.sm.size }}>
        {premiere
          ? <div style={{ color, fontWeight: 800 }}>{premiere.label}{alertes.length > 1 && <span style={{ color: T.textMuted, fontWeight: 600 }}> (+{alertes.length - 1})</span>}</div>
          : <div style={{ color: T.textMuted }}>Aucune alerte</div>}
        {item.next_action && <div style={{ color: T.textSub, marginTop: 2 }}>→ {item.next_action}</div>}
      </div>
      <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>
        <div><span style={{ color: T.textSub, fontWeight: 700 }}>{item.responsable || "Non assigné"}</span></div>
        <div>{item.due_date ? `avant le ${safeDate(item.due_date)}` : "sans échéance"}</div>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen?.(item)}><Icon as={Eye} size={12} />Voir</button>
        <button className="inv-btn inv-btn-gold inv-btn-sm" disabled={item.readOnly} onClick={() => onDecide?.(item)}><Icon as={ClipboardCheck} size={12} />Décider</button>
      </div>
    </div>
  );
}

export function ListeATraiter({ onglet, items, T, onOpen, onDecide }) {
  const [tout, setTout] = useState(false);
  const meta = ONGLETS.find(o => o.key === onglet) || ONGLETS[0];
  const liste = safeArr(items);
  const visibles = tout ? liste : liste.slice(0, PAGE);
  if (!liste.length) {
    return (
      <div style={{ padding: SPACING.xl, border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg, textAlign: "center", color: T.textMuted }}>
        <Icon as={CheckCircle2} size={22} style={{ color: SU }} />
        <div style={{ marginTop: 6, fontWeight: 700, color: T.textSub }}>{meta.vide}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {visibles.map(item => <Ligne key={item.key} item={item} T={T} onOpen={onOpen} onDecide={onDecide} />)}
      {liste.length > PAGE && (
        <button className="inv-btn inv-btn-out inv-btn-sm" style={{ justifySelf: "center" }} onClick={() => setTout(t => !t)}>
          {tout ? "Réduire" : `Afficher les ${liste.length - PAGE} autres`}
        </button>
      )}
    </div>
  );
}

function Panneau({ titre, icon, sous, children, T, action }) {
  return (
    <section style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: SPACING.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: T.text, fontWeight: 900, fontSize: FONT.base.size }}>
          <Icon as={icon} size={14} style={{ color: T.accent }} />{titre}
        </div>
        {action}
      </div>
      {sous && <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, marginBottom: SPACING.sm }}>{sous}</div>}
      {children}
    </section>
  );
}

export function PrioritesCompact({ routine, setRoutine, responsables, T }) {
  const update = (idx, patch) => setRoutine(prev => {
    const list = [...safeArr(prev.priorities)];
    list[idx] = { ...(list[idx] || {}), ...patch };
    return { ...prev, priorities: list };
  });
  const faites = [0, 1, 2].filter(i => priorityComplete(routine.priorities?.[i] || {})).length;
  return (
    <Panneau titre="3 priorités du jour" icon={Sparkles} T={T}
      action={<span style={{ fontSize: FONT.xs.size + 1, color: faites === 3 ? SU : T.textMuted, fontWeight: 800 }}>{faites}/3 définies</span>}>
      <div style={{ display: "grid", gap: 10 }}>
        {[0, 1, 2].map(idx => {
          const p = routine.priorities?.[idx] || {};
          return (
            <div key={idx} style={{ display: "grid", gap: 6, paddingTop: idx ? 10 : 0, borderTop: idx ? `1px solid ${T.border}` : "none" }}>
              <input className="inv-inp" placeholder={`Priorité ${idx + 1}`} value={p.title || ""}
                onChange={e => update(idx, { title: e.target.value })} style={{ width: "100%", textAlign: "left", fontWeight: 700 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <select className="inv-sel" value={p.responsable || ""} onChange={e => update(idx, { responsable: e.target.value })}>
                  <option value="">Responsable</option>
                  {safeArr(responsables).map(r => <option key={r}>{r}</option>)}
                </select>
                <input className="inv-inp" type="date" value={p.due_date || ""} onChange={e => update(idx, { due_date: e.target.value })} />
              </div>
              {p.title && (
                <input className="inv-inp" placeholder="Objectif précis (facultatif)" value={p.comment || ""}
                  onChange={e => update(idx, { comment: e.target.value })} style={{ width: "100%", textAlign: "left" }} />
              )}
            </div>
          );
        })}
      </div>
    </Panneau>
  );
}

export function SuiviDossiersCompact({ data, nomsClients, T, onOpenClient }) {
  const [tout, setTout] = useState(false);
  if (data.avancementInconnu) {
    return (
      <Panneau titre="Dossiers Invest" icon={Briefcase} T={T}>
        <div style={{ padding: SPACING.md, border: `1px solid ${WA}55`, borderRadius: RADIUS.md, color: WA, fontWeight: 800 }}>
          Avancement indisponible : les Dossiers Invest n'ont pas pu être chargés. Aucun chiffre n'est affiché plutôt qu'un chiffre faux.
        </div>
      </Panneau>
    );
  }
  const s = data.suiviInvest || {};
  const balles = s.balles || {};
  const tuiles = [
    { label: "Actifs", value: s.dossiers ?? 0, color: T.accent },
    { label: "Balle chez Profero", value: balles.profero ?? 0, color: WA },
    { label: "Bloqués", value: s.bloques ?? 0, color: s.bloques ? DA : SU },
    { label: "Échéances dépassées", value: s.echeancesDepassees ?? 0, color: s.echeancesDepassees ? DA : SU },
  ];
  const rang = (p) => { const a = alertesPilotage(p); return a.some(x => x.level === "danger") ? 0 : a.some(x => x.level === "warning") ? 1 : 2; };
  const lignes = [...safeArr(data.pilotages)].sort((a, b) => rang(a) - rang(b) || String(a.prochaineEcheance || "9999").localeCompare(String(b.prochaineEcheance || "9999")));
  const visibles = tout ? lignes : lignes.slice(0, 5);
  return (
    <Panneau titre="Dossiers Invest" icon={Briefcase} T={T}
      sous={`Balle : client ${balles.client ?? 0} · banque ${balles.banque ?? 0} · notaire ${balles.notaire ?? 0} · tiers ${balles.tiers ?? 0}. ${s.tachesEnRetard ?? 0} tâche(s) en retard, ${s.sansProchaineAction ?? 0} dossier(s) sans prochaine action.`}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: SPACING.sm }}>
        {tuiles.map(t => (
          <div key={t.label} style={{ border: `1px solid ${t.color}44`, background: T.input, borderRadius: RADIUS.md, padding: "8px 10px" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.xl.size, fontWeight: 900, color: t.color, lineHeight: 1 }}>{t.value}</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4, fontWeight: 700 }}>{t.label}</div>
          </div>
        ))}
      </div>
      {lignes.length === 0
        ? <div style={{ padding: SPACING.md, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md, color: T.textMuted, textAlign: "center" }}>Aucun Dossier Invest en cours.</div>
        : <div style={{ display: "grid", gap: 6 }}>
          {visibles.map(p => {
            const al = alertesPilotage(p);
            const niveau = al.some(x => x.level === "danger") ? "danger" : al.some(x => x.level === "warning") ? "warning" : "info";
            const ajd = actionDuJour(p);
            return (
              <button key={p.dossierId} type="button" onClick={() => onOpenClient?.(p.clientId)}
                style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${T.border}`, borderLeft: `4px solid ${levelColor(niveau, T)}`, background: T.input, borderRadius: RADIUS.md, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800, color: T.text, fontSize: FONT.sm.size + 1 }}>{nomsClients.get(p.clientId) || "Client"}</span>
                  <span style={{ display: "block", color: T.textMuted, fontSize: FONT.xs.size + 1 }}>{resumePilotage(p)}</span>
                  {al[0] && <span style={{ display: "block", color: levelColor(al[0].level, T), fontWeight: 700, fontSize: FONT.xs.size + 1 }}>{al[0].label}{al.length > 1 ? ` (+${al.length - 1})` : ""}</span>}
                </span>
                <span style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, textAlign: "right", flexShrink: 0 }}>
                  {ajd.responsable || "—"}{ajd.echeance && <><br />{safeDate(ajd.echeance)}</>}
                </span>
              </button>
            );
          })}
          {lignes.length > 5 && (
            <button className="inv-btn inv-btn-out inv-btn-sm" style={{ justifySelf: "center" }} onClick={() => setTout(t => !t)}>
              <Icon as={tout ? ChevronDown : ChevronRight} size={12} />{tout ? "Réduire" : `Voir les ${lignes.length - 5} autres`}
            </button>
          )}
        </div>}
    </Panneau>
  );
}

export const DASHBOARD_VUE_CSS = `
.dbv-onglets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.dbv-corps{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:start}
.dbv-ligne{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,2fr) minmax(130px,1fr) auto;gap:14px;align-items:center;padding:10px 12px}
@media(max-width:1180px){.dbv-corps{grid-template-columns:1fr}}
@media(max-width:900px){.dbv-onglets{grid-template-columns:repeat(2,minmax(0,1fr))}.dbv-ligne{grid-template-columns:1fr;gap:6px}}
`;
