import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { FONT, RADIUS } from "../constants";
import { THEMES_INV, SU, WA, DA, fmtDashboardEur } from "./_shared";
import {
  UserPlus,
  Search,
  Phone,
  Calendar,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  Save,
  Trash2,
  RefreshCw,
  Eye,
  Pencil,
  X,
  Filter,
  Users,
  MessageSquare,
  Mail,
  BarChart3,
  AlertTriangle,
  Check,
  Send,
  ClipboardCheck,
  Target,
  LayoutGrid,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// CRM Prospection Profero Invest — V4 Ergonomie compacte
// Objectif : page plus lisible, moins de documents, et fiche express visible
// sans avoir à scroller longuement dans un panneau latéral.
// ─────────────────────────────────────────────────────────────────────────────

const STATUTS_PROSPECTION = [
  { id: "nouveau", label: "Nouveaux", short: "Nouveau", icon: UserPlus, color: "#60A5FA", aliases: ["nouveau"] },
  { id: "qualification", label: "À qualifier", short: "Qualif.", icon: Search, color: "#C9A84C", aliases: ["qualification"] },
  { id: "contact", label: "Contact", short: "Contact", icon: Phone, color: "#F59E0B", aliases: ["contact", "relance"] },
  { id: "rdv", label: "RDV", short: "RDV", icon: Calendar, color: "#8B5CF6", aliases: ["rdv"] },
  { id: "proposition", label: "Proposition", short: "Prop.", icon: FileText, color: "#10B981", aliases: ["proposition"] },
  { id: "signe", label: "Signés", short: "Signé", icon: CheckCircle2, color: SU, aliases: ["signe", "converti"] },
  { id: "perdu", label: "Perdus", short: "Perdu", icon: XCircle, color: DA, aliases: ["perdu", "sommeil", "hors_cible"] },
];

const STATUT_OPTIONS = [
  ["nouveau", "Nouveau"],
  ["qualification", "À qualifier"],
  ["contact", "Contact / relance"],
  ["rdv", "RDV planifié"],
  ["proposition", "Proposition envoyée"],
  ["signe", "Signé"],
  ["converti", "Converti client"],
  ["perdu", "Perdu"],
  ["sommeil", "En sommeil"],
  ["hors_cible", "Hors cible"],
];

const SOURCES = [
  "",
  "Site internet",
  "Recommandation",
  "Réseaux sociaux",
  "LinkedIn",
  "Instagram",
  "Congrès UPI",
  "Partenaire",
  "Ancien client",
  "Bouche-à-oreille",
  "Appel entrant",
  "Prospection directe",
  "Publicité",
  "Autre",
];

const PRIORITES = ["basse", "moyenne", "haute"];
const SCORES = ["A", "B", "C", "D"];

const TYPES_BIEN = [
  "",
  "Appartement",
  "Maison",
  "Immeuble de rapport",
  "Colocation",
  "Coliving",
  "Local commercial",
  "Division",
  "Bien avec travaux",
  "Passoire énergétique",
  "Autre",
];

const STRATEGIES = [
  "",
  "Location nue",
  "Location meublée",
  "LMNP",
  "Colocation",
  "Coliving",
  "Achat-revente",
  "Division",
  "Déficit foncier",
  "SCI",
  "Holding / société",
  "Patrimonial long terme",
];

const OBJECTIFS = [
  "",
  "Créer du patrimoine",
  "Générer du cash-flow",
  "Préparer la retraite",
  "Optimiser fiscalement",
  "Acheter une résidence principale",
  "Réaliser une opération patrimoniale",
  "Revendre avec plus-value",
  "Investir à distance",
  "Autre",
];

const MOTIVATIONS = ["", "Très fort", "Fort", "Moyen", "Faible"];
const MATURITES = ["", "Prêt à agir", "Projet dans les 3 mois", "Projet dans les 6 mois", "Projet dans l'année", "Projet lointain"];
const TYPES_ACTION = ["note", "appel", "sms", "email", "whatsapp", "rdv", "envoi_proposition", "relance"];
const RESULTATS_ACTION = ["", "Répondu", "Pas répondu", "Message laissé", "Intéressé", "À relancer", "Refus", "Signature prévue", "Proposition envoyée", "Contrat signé"];
const OFFRE_STATUTS = ["", "À préparer", "Envoyée", "En attente", "À relancer", "Acceptée", "Refusée"];

// Documents volontairement réduits : en prospection, on suit surtout les pièces commerciales.
const PROSPECT_DOCUMENTS = [
  { id: "questionnaire", label: "Questionnaire" },
  { id: "simulation", label: "Simulation" },
  { id: "proposition", label: "Proposition" },
  { id: "contrat", label: "Contrat signé" },
];

const RELANCE_PRESETS = [
  { label: "J+2", days: 2, action: "Relance proposition / prise de nouvelles" },
  { label: "J+7", days: 7, action: "Relance commerciale" },
  { label: "J+15", days: 15, action: "Relance longue" },
  { label: "1 mois", days: 30, action: "Relance prospect en sommeil" },
];

const EMPTY_PROSPECT = {
  civilite: "",
  nom: "",
  prenom: "",
  societe: "",
  telephone: "",
  email: "",
  adresse: "",
  ville: "",
  code_postal: "",
  pays: "France",

  source: "",
  responsable: "",
  statut: "nouveau",
  priorite: "moyenne",
  score: "B",

  profil_investisseur: "",
  experience: "",
  nb_biens: "",
  situation_professionnelle: "",
  objectif: "",

  zone_recherche: "",
  type_bien: "",
  strategie: "",
  budget_global: "",
  budget_travaux: "",
  apport: "",
  capacite_emprunt: "",
  delai_achat: "",

  motivation: "",
  maturite: "",
  probabilite_signature: "",
  offre_recommandee: "",
  honoraires_estimes_ht: "",
  honoraires_estimes_ttc: "",
  ca_potentiel_ht: "",
  objections: "",
  besoins: "",

  prochaine_action: "",
  date_prochaine_action: "",
  date_relance: "",
  date_premier_contact: "",

  date_rdv: "",
  heure_rdv: "",
  type_rdv: "",
  lieu_rdv: "",
  statut_rdv: "",
  compte_rendu_rdv: "",

  date_proposition: "",
  statut_proposition: "",
  date_signature: "",

  date_perte: "",
  raison_perte: "",

  commentaire: "",
  donnees: {},
};

const EMPTY_ACTION = {
  type_action: "note",
  resume: "",
  resultat: "",
  prochaine_action: "",
  date_prochaine_action: "",
};

const compactInputStyle = {
  height: 30,
  minHeight: 30,
  padding: "5px 8px",
  fontSize: 12,
};

const compactSelectStyle = {
  height: 30,
  minHeight: 30,
  padding: "5px 8px",
  fontSize: 12,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuteur(profil) {
  return profil?.email || profil?.nom || profil?.prenom || profil?.role || "Profero";
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const parsed = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeText(v) {
  return String(v || "").trim();
}

function safeObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function isoDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

function formatDateTime(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function isLate(date) {
  if (!date) return false;
  return isoDate(date) < todayIso();
}

function getProspectName(p) {
  const full = `${p?.prenom || ""} ${p?.nom || ""}`.trim();
  return full || p?.societe || "Prospect sans nom";
}

function getStageForStatus(statut) {
  return STATUTS_PROSPECTION.find((s) => s.aliases.includes(statut)) || STATUTS_PROSPECTION[0];
}

function getStageId(statut) {
  return getStageForStatus(statut).id;
}

function getDocumentsChecklist(p = {}) {
  const data = safeObj(p.donnees);
  return safeObj(data.documents_checklist);
}

function documentsProgress(p = {}) {
  const docs = getDocumentsChecklist(p);
  if (!PROSPECT_DOCUMENTS.length) return 0;
  const done = PROSPECT_DOCUMENTS.filter((d) => docs[d.id] === "recu" || docs[d.id] === "na").length;
  return Math.round((done / PROSPECT_DOCUMENTS.length) * 100);
}

function getAutoScore(p = {}) {
  let score = 0;

  if (p.telephone || p.email) score += 10;
  if (p.source) score += 5;
  if (p.responsable) score += 5;
  if (p.objectif) score += 10;
  if (p.zone_recherche) score += 8;
  if (p.budget_global) score += 12;
  if (p.apport || p.capacite_emprunt) score += 12;
  if (p.motivation === "Très fort") score += 14;
  else if (p.motivation === "Fort") score += 10;
  else if (p.motivation === "Moyen") score += 5;

  if (p.maturite === "Prêt à agir") score += 14;
  else if (p.maturite === "Projet dans les 3 mois") score += 10;
  else if (p.maturite === "Projet dans les 6 mois") score += 5;

  if (["proposition", "signe", "converti"].includes(p.statut)) score += 10;
  if (p.date_rdv) score += 5;
  if (p.date_prochaine_action || p.date_relance) score += 5;

  return Math.max(0, Math.min(100, score));
}

function getAutoQualification(p = {}) {
  const s = getAutoScore(p);
  if (s >= 75) return { label: "Chaud", color: SU };
  if (s >= 45) return { label: "Tiède", color: WA };
  return { label: "Froid", color: DA };
}

function getWeightedCa(p = {}) {
  const ca = Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0;
  const proba = Number(p.probabilite_signature || 0);
  const rate = proba > 0 ? proba / 100 : getAutoScore(p) / 100;
  return ca * Math.max(0, Math.min(1, rate));
}

function prospectToForm(p) {
  if (!p) return { ...EMPTY_PROSPECT };

  return {
    ...EMPTY_PROSPECT,
    ...p,
    nb_biens: p.nb_biens ?? "",
    budget_global: p.budget_global ?? "",
    budget_travaux: p.budget_travaux ?? "",
    apport: p.apport ?? "",
    capacite_emprunt: p.capacite_emprunt ?? "",
    probabilite_signature: p.probabilite_signature ?? "",
    honoraires_estimes_ht: p.honoraires_estimes_ht ?? "",
    honoraires_estimes_ttc: p.honoraires_estimes_ttc ?? "",
    ca_potentiel_ht: p.ca_potentiel_ht ?? "",
    date_prochaine_action: isoDate(p.date_prochaine_action),
    date_relance: isoDate(p.date_relance),
    date_premier_contact: isoDate(p.date_premier_contact),
    date_rdv: isoDate(p.date_rdv),
    date_proposition: isoDate(p.date_proposition),
    date_signature: isoDate(p.date_signature),
    date_perte: isoDate(p.date_perte),
    donnees: safeObj(p.donnees),
  };
}

function buildProspectPayload(form, profil, isNew = false) {
  const payload = {
    civilite: safeText(form.civilite),
    nom: safeText(form.nom),
    prenom: safeText(form.prenom),
    societe: safeText(form.societe),
    telephone: safeText(form.telephone),
    email: safeText(form.email),
    adresse: safeText(form.adresse),
    ville: safeText(form.ville),
    code_postal: safeText(form.code_postal),
    pays: safeText(form.pays) || "France",

    source: safeText(form.source),
    responsable: safeText(form.responsable),
    statut: safeText(form.statut) || "nouveau",
    priorite: safeText(form.priorite) || "moyenne",
    score: safeText(form.score) || "B",

    profil_investisseur: safeText(form.profil_investisseur),
    experience: safeText(form.experience),
    nb_biens: n(form.nb_biens),
    situation_professionnelle: safeText(form.situation_professionnelle),
    objectif: safeText(form.objectif),

    zone_recherche: safeText(form.zone_recherche),
    type_bien: safeText(form.type_bien),
    strategie: safeText(form.strategie),
    budget_global: n(form.budget_global),
    budget_travaux: n(form.budget_travaux),
    apport: n(form.apport),
    capacite_emprunt: n(form.capacite_emprunt),
    delai_achat: safeText(form.delai_achat),

    motivation: safeText(form.motivation),
    maturite: safeText(form.maturite),
    probabilite_signature: n(form.probabilite_signature),
    offre_recommandee: safeText(form.offre_recommandee),
    honoraires_estimes_ht: n(form.honoraires_estimes_ht),
    honoraires_estimes_ttc: n(form.honoraires_estimes_ttc),
    ca_potentiel_ht: n(form.ca_potentiel_ht) || n(form.honoraires_estimes_ht),
    objections: safeText(form.objections),
    besoins: safeText(form.besoins),

    prochaine_action: safeText(form.prochaine_action),
    date_prochaine_action: form.date_prochaine_action || null,
    date_relance: form.date_relance || null,
    date_premier_contact: form.date_premier_contact || null,

    date_rdv: form.date_rdv || null,
    heure_rdv: safeText(form.heure_rdv),
    type_rdv: safeText(form.type_rdv),
    lieu_rdv: safeText(form.lieu_rdv),
    statut_rdv: safeText(form.statut_rdv),
    compte_rendu_rdv: safeText(form.compte_rendu_rdv),

    date_proposition: form.date_proposition || null,
    statut_proposition: safeText(form.statut_proposition),
    date_signature: form.date_signature || null,

    date_perte: form.date_perte || null,
    raison_perte: safeText(form.raison_perte),

    commentaire: safeText(form.commentaire),
    donnees: safeObj(form.donnees),
    updated_by: getAuteur(profil),
    is_deleted: false,
  };

  if (isNew) payload.created_by = getAuteur(profil);

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini composants UI
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children, wide = false }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto", minWidth: 0 }}>
      <label className="inv-kpi-lbl" style={{ display: "block", marginBottom: 3, fontSize: 10 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, type = "text", placeholder = "", style = {} }) {
  return (
    <input
      className="inv-inp"
      type={type}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", textAlign: type === "number" ? "right" : "left", ...compactInputStyle, ...style }}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      className="inv-sel"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", ...compactSelectStyle }}
    >
      {options.map((o) => (
        <option key={o || "empty"} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

function TextArea({ value, onChange, rows = 2, placeholder = "" }) {
  return (
    <textarea
      className="inv-textarea"
      rows={rows}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", minHeight: rows * 28, fontSize: 12, padding: 8 }}
    />
  );
}

function Badge({ children, color, T }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px",
        borderRadius: 999,
        background: `${color || T.accent}18`,
        color: color || T.accent,
        fontSize: 10,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function KpiCard({ item, T }) {
  const KpiIcon = item.icon;

  return (
    <div className="inv-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 9, minHeight: 58 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: RADIUS.md,
          background: `${item.color}18`,
          color: item.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon as={KpiIcon} size={15} strokeWidth={2.1} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 800, marginBottom: 1 }}>
          {item.label}
        </div>
        <div style={{ fontSize: 15, color: T.text, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>{item.value}</div>
      </div>
    </div>
  );
}

function ProgressBar({ value, color, T }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div style={{ height: 5, borderRadius: 999, background: T.border, overflow: "hidden" }}>
      <div style={{ width: `${v}%`, height: "100%", background: color || T.accent }} />
    </div>
  );
}

function StageChips({ prospects, selectedStage, onSelectStage, T }) {
  const countFor = (stage) => prospects.filter((p) => stage.aliases.includes(p.statut)).length;

  return (
    <div className="inv-card" style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 7, marginBottom: 10 }}>
      {STATUTS_PROSPECTION.map((stage) => {
        const StageIcon = stage.icon;
        const count = countFor(stage);
        const active = selectedStage === stage.id;
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onSelectStage(active ? "" : stage.id)}
            style={{
              border: `1px solid ${active ? stage.color : T.border}`,
              background: active ? `${stage.color}18` : T.cardHover,
              color: active ? stage.color : T.textSub,
              borderRadius: RADIUS.md,
              padding: "8px 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              minWidth: 0,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <Icon as={StageIcon} size={13} />
              <span style={{ fontSize: 11, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage.label}</span>
            </span>
            <span style={{ fontSize: 11, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProspectsCompactList({ prospects, selectedId, onSelect, T, title = "Prospects" }) {
  return (
    <div className="inv-card" style={{ overflow: "hidden" }}>
      <div className="inv-card-hd blue" style={{ padding: "10px 12px", minHeight: 38 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={Users} size={13} />
          {title} · {prospects.length}
        </span>
      </div>

      <div style={{ maxHeight: "calc(100vh - 315px)", overflowY: "auto" }}>
        {prospects.length === 0 ? (
          <div style={{ padding: 20, color: T.textMuted, textAlign: "center", fontSize: 13 }}>Aucun prospect dans cette vue.</div>
        ) : (
          prospects.map((p) => {
            const stage = getStageForStatus(p.statut);
            const qualif = getAutoQualification(p);
            const late = isLate(p.date_prochaine_action || p.date_relance);
            const score = getAutoScore(p);
            const active = selectedId === p.id;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "minmax(160px, 1.35fr) 92px 92px 100px 92px 74px",
                  gap: 8,
                  alignItems: "center",
                  textAlign: "left",
                  border: "none",
                  borderBottom: `1px solid ${T.border}`,
                  background: active ? T.accentBg : "transparent",
                  color: T.text,
                  padding: "9px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getProspectName(p)}</div>
                  <div style={{ fontSize: 11, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[p.ville, p.source].filter(Boolean).join(" · ") || "À compléter"}
                  </div>
                </div>
                <Badge color={stage.color} T={T}>{stage.short}</Badge>
                <Badge color={qualif.color} T={T}>{qualif.label} · {score}</Badge>
                <div style={{ fontSize: 11, color: late ? DA : T.textSub }}>
                  {p.prochaine_action || "Sans action"}
                  <div style={{ fontSize: 10 }}>{formatDate(p.date_prochaine_action || p.date_relance)}</div>
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>
                  {p.ca_potentiel_ht || p.honoraires_estimes_ht ? fmtDashboardEur(p.ca_potentiel_ht || p.honoraires_estimes_ht) : "—"}
                </div>
                <span style={{ justifySelf: "end" }}>
                  <Icon as={Eye} size={15} color={active ? T.accent : T.textMuted} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function RelancesView({ prospects, onSelect, selectedId, T }) {
  const relances = [...prospects]
    .filter((p) => !["perdu", "converti", "hors_cible"].includes(p.statut))
    .sort((a, b) => String(a.date_prochaine_action || a.date_relance || "9999-12-31").localeCompare(String(b.date_prochaine_action || b.date_relance || "9999-12-31")));

  return <ProspectsCompactList prospects={relances} selectedId={selectedId} onSelect={onSelect} T={T} title="Relances à traiter" />;
}

function StatsView({ prospects, T }) {
  const total = prospects.length;
  const signed = prospects.filter((p) => ["signe", "converti"].includes(p.statut)).length;
  const propositions = prospects.filter((p) => ["proposition", "signe", "converti"].includes(p.statut)).length;
  const perdus = prospects.filter((p) => ["perdu", "hors_cible"].includes(p.statut)).length;
  const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);
  const caWeighted = prospects.reduce((s, p) => s + getWeightedCa(p), 0);
  const tauxConversion = total ? Math.round((signed / total) * 100) : 0;
  const tauxProp = total ? Math.round((propositions / total) * 100) : 0;

  const bySource = Object.entries(
    prospects.reduce((acc, p) => {
      const key = p.source || "Sans source";
      acc[key] = acc[key] || { count: 0, signed: 0, ca: 0 };
      acc[key].count += 1;
      if (["signe", "converti"].includes(p.statut)) acc[key].signed += 1;
      acc[key].ca += Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0;
      return acc;
    }, {})
  ).sort((a, b) => b[1].count - a[1].count);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
      <div className="inv-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: T.text, marginBottom: 10 }}>Performance commerciale</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <KpiCard item={{ label: "Conversion", value: `${tauxConversion}%`, icon: CheckCircle2, color: SU }} T={T} />
          <KpiCard item={{ label: "Propositions", value: `${tauxProp}%`, icon: FileText, color: WA }} T={T} />
          <KpiCard item={{ label: "Prospects perdus", value: perdus, icon: XCircle, color: DA }} T={T} />
          <KpiCard item={{ label: "CA pondéré", value: fmtDashboardEur(caWeighted), icon: TrendingUp, color: SU }} T={T} />
        </div>
        <div style={{ marginTop: 12, color: T.textSub, fontSize: 12 }}>CA potentiel total : <strong style={{ color: T.text }}>{fmtDashboardEur(ca)}</strong></div>
      </div>

      <div className="inv-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: T.text, marginBottom: 10 }}>Sources prospects</div>
        {bySource.length === 0 ? (
          <div style={{ color: T.textMuted, fontSize: 12 }}>Aucune donnée.</div>
        ) : (
          bySource.slice(0, 7).map(([source, d]) => (
            <div key={source} style={{ padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <strong style={{ color: T.text, fontSize: 12 }}>{source}</strong>
                <span style={{ color: T.textMuted, fontSize: 12 }}>{d.count} prospect{d.count > 1 ? "s" : ""}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: T.textSub }}>{d.signed} signé{d.signed > 1 ? "s" : ""} · {fmtDashboardEur(d.ca)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CompactDocuments({ form, T, onChange }) {
  const docs = getDocumentsChecklist(form);
  const pct = documentsProgress(form);

  const setDoc = (docId, value) => {
    const nextData = {
      ...safeObj(form.donnees),
      documents_checklist: {
        ...docs,
        [docId]: value,
      },
    };
    onChange(nextData);
  };

  return (
    <div style={{ padding: 8, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.cardHover }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <div style={{ fontWeight: 900, color: T.text, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={ClipboardCheck} size={13} /> Docs commerciaux
        </div>
        <Badge color={pct >= 75 ? SU : pct >= 40 ? WA : DA} T={T}>{pct}%</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
        {PROSPECT_DOCUMENTS.map((doc) => (
          <div key={doc.id}>
            <div style={{ color: T.textMuted, fontSize: 10, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.label}</div>
            <select className="inv-sel" value={docs[doc.id] || ""} onChange={(e) => setDoc(doc.id, e.target.value)} style={{ width: "100%", ...compactSelectStyle, fontSize: 10, padding: "3px 5px" }}>
              <option value="">—</option>
              <option value="demande">Demandé</option>
              <option value="recu">Reçu</option>
              <option value="verifier">À vérifier</option>
              <option value="na">N/A</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────────

export default function Prospection({ profil, T = THEMES_INV.dark }) {
  const [prospects, setProspects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_PROSPECT });
  const [draftOpen, setDraftOpen] = useState(false);
  const [actions, setActions] = useState([]);
  const [actionForm, setActionForm] = useState({ ...EMPTY_ACTION });

  const [view, setView] = useState("pipeline");
  const [query, setQuery] = useState("");
  const [statutFilter, setStatutFilter] = useState("");
  const [responsableFilter, setResponsableFilter] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const showFormPanel = draftOpen || !!selected?.id;

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadProspects = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .select("*")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false });

    if (err) {
      setError(err.message || "Erreur lors du chargement des prospects.");
      setProspects([]);
    } else {
      setProspects(data || []);
    }

    setLoading(false);
  }, []);

  const loadActions = useCallback(async (prospectId) => {
    if (!prospectId) {
      setActions([]);
      return;
    }

    const { data, error: err } = await supabase
      .from("invest_prospect_actions")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("date_action", { ascending: false });

    if (!err) setActions(data || []);
  }, []);

  useEffect(() => {
    loadProspects();
  }, [loadProspects]);

  useEffect(() => {
    if (selected?.id) loadActions(selected.id);
    else setActions([]);
  }, [selected?.id, loadActions]);

  const responsables = useMemo(() => Array.from(new Set(prospects.map((p) => p.responsable).filter(Boolean))).sort(), [prospects]);

  const filteredProspects = useMemo(() => {
    const q = query.trim().toLowerCase();

    return prospects.filter((p) => {
      const haystack = [
        p.nom,
        p.prenom,
        p.societe,
        p.email,
        p.telephone,
        p.ville,
        p.source,
        p.responsable,
        p.objectif,
        p.zone_recherche,
        p.prochaine_action,
      ].join(" ").toLowerCase();

      const matchQuery = !q || haystack.includes(q);
      const matchStatut = !statutFilter || getStageId(p.statut) === statutFilter || p.statut === statutFilter;
      const matchResponsable = !responsableFilter || p.responsable === responsableFilter;

      return matchQuery && matchStatut && matchResponsable;
    });
  }, [prospects, query, statutFilter, responsableFilter]);

  const attentionProspects = useMemo(() => {
    return prospects
      .filter((p) => !["perdu", "hors_cible", "converti"].includes(p.statut))
      .filter((p) => isLate(p.date_prochaine_action || p.date_relance) || (!p.date_prochaine_action && !p.date_relance))
      .sort((a, b) => getAutoScore(b) - getAutoScore(a))
      .slice(0, 4);
  }, [prospects]);

  const kpis = useMemo(() => {
    const actifs = prospects.filter((p) => !["perdu", "sommeil", "hors_cible", "converti"].includes(p.statut)).length;
    const rdv = prospects.filter((p) => p.date_rdv && isoDate(p.date_rdv) >= todayIso()).length;
    const retard = prospects.filter((p) => isLate(p.date_prochaine_action || p.date_relance) && !["perdu", "converti"].includes(p.statut)).length;
    const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);
    const caWeighted = prospects.reduce((s, p) => s + getWeightedCa(p), 0);

    return [
      { label: "Actifs", value: actifs, icon: UserPlus, color: "#60A5FA" },
      { label: "RDV", value: rdv, icon: Calendar, color: "#8B5CF6" },
      { label: "Retards", value: retard, icon: Clock, color: retard > 0 ? DA : SU },
      { label: "CA potentiel", value: fmtDashboardEur(ca), icon: TrendingUp, color: SU },
      { label: "CA pondéré", value: fmtDashboardEur(caWeighted), icon: Target, color: WA },
    ];
  }, [prospects]);

  const startNew = () => {
    setSelected(null);
    setDraftOpen(true);
    setForm({
      ...EMPTY_PROSPECT,
      responsable: profil?.prenom || profil?.nom || "",
      statut: "nouveau",
      priorite: "moyenne",
      score: "B",
    });
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const selectProspect = (p) => {
    setSelected(p);
    setDraftOpen(true);
    setForm(prospectToForm(p));
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const closePanel = () => {
    setSelected(null);
    setDraftOpen(false);
    setForm({ ...EMPTY_PROSPECT });
    setActionForm({ ...EMPTY_ACTION });
  };

  const saveProspect = async () => {
    setSaving(true);
    setMsg("");
    setError("");

    const isNew = !selected?.id;
    const payload = buildProspectPayload(form, profil, isNew);

    if (!payload.nom && !payload.prenom && !payload.societe) {
      setError("Renseigne au minimum un nom, un prénom ou une société.");
      setSaving(false);
      return;
    }

    let result;

    if (isNew) {
      result = await supabase.from("invest_prospects").insert(payload).select("*").single();
    } else {
      result = await supabase.from("invest_prospects").update(payload).eq("id", selected.id).select("*").single();
    }

    setSaving(false);

    if (result.error) {
      setError(result.error.message || "Erreur de sauvegarde.");
      return;
    }

    setMsg(isNew ? "Prospect créé." : "Prospect sauvegardé.");
    setSelected(result.data);
    setDraftOpen(true);
    setForm(prospectToForm(result.data));
    await loadProspects();

    setTimeout(() => setMsg(""), 2200);
  };

  const patchSelected = async (patch) => {
    if (!selected?.id) {
      setForm((prev) => ({ ...prev, ...patch }));
      return;
    }

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .update({ ...patch, updated_by: getAuteur(profil) })
      .eq("id", selected.id)
      .select("*")
      .single();

    if (err) {
      setError(err.message);
      return;
    }

    setSelected(data);
    setForm(prospectToForm(data));
    await loadProspects();
  };

  const setQuickStatus = async (statut) => {
    setField("statut", statut);
    await patchSelected({ statut });
  };

  const scheduleRelance = async (days, action) => {
    const date = addDaysIso(days);
    setField("prochaine_action", action);
    setField("date_prochaine_action", date);
    setField("date_relance", date);
    await patchSelected({ prochaine_action: action, date_prochaine_action: date, date_relance: date });
  };

  const softDeleteProspect = async () => {
    if (!selected?.id) return;
    if (!window.confirm("Classer ce prospect comme supprimé ? Il ne sera plus visible dans la liste.")) return;

    const { error: err } = await supabase
      .from("invest_prospects")
      .update({ is_deleted: true, updated_by: getAuteur(profil) })
      .eq("id", selected.id);

    if (err) {
      setError(err.message);
      return;
    }

    closePanel();
    await loadProspects();
  };

  const saveAction = async () => {
    if (!selected?.id) {
      setError("Sauvegarde d'abord le prospect avant d'ajouter une action.");
      return;
    }

    if (!actionForm.resume.trim()) {
      setError("Renseigne un résumé d'action.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      prospect_id: selected.id,
      created_by: getAuteur(profil),
      type_action: actionForm.type_action || "note",
      resume: actionForm.resume.trim(),
      resultat: actionForm.resultat || "",
      prochaine_action: actionForm.prochaine_action || "",
      date_prochaine_action: actionForm.date_prochaine_action || null,
    };

    const { error: err } = await supabase.from("invest_prospect_actions").insert(payload);

    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    if (actionForm.prochaine_action || actionForm.date_prochaine_action) {
      const { data } = await supabase
        .from("invest_prospects")
        .update({
          prochaine_action: actionForm.prochaine_action || selected.prochaine_action,
          date_prochaine_action: actionForm.date_prochaine_action || selected.date_prochaine_action,
          date_relance: actionForm.date_prochaine_action || selected.date_relance,
          updated_by: getAuteur(profil),
        })
        .eq("id", selected.id)
        .select("*")
        .single();

      if (data) {
        setSelected(data);
        setForm(prospectToForm(data));
      }
    }

    setActionForm({ ...EMPTY_ACTION });
    await loadActions(selected.id);
    await loadProspects();

    setSaving(false);
    setMsg("Action ajoutée.");
    setTimeout(() => setMsg(""), 2200);
  };

  const copyMailConfirmation = () => {
    const text = `Bonjour ${form.prenom || ""},\n\nJe vous confirme notre rendez-vous${form.date_rdv ? ` du ${formatDate(form.date_rdv)}` : ""}${form.heure_rdv ? ` à ${form.heure_rdv}` : ""}.\n\nL'objectif sera de faire le point sur votre projet immobilier, votre capacité d'investissement et la stratégie la plus adaptée.\n\nBien cordialement,\nProfero Invest`;
    navigator.clipboard?.writeText(text);
    setMsg("Mail de confirmation copié.");
    setTimeout(() => setMsg(""), 1800);
  };

  const copyRelanceMessage = () => {
    const text = `Bonjour ${form.prenom || ""},\n\nJe reviens vers vous concernant votre projet immobilier.\n\nSouhaitez-vous que nous avancions sur la prochaine étape ?\n\nBien cordialement,\nProfero Invest`;
    navigator.clipboard?.writeText(text);
    setMsg("Message de relance copié.");
    setTimeout(() => setMsg(""), 1800);
  };

  const convertToClient = async () => {
    if (!selected?.id) return;

    const prospect = { ...selected, ...buildProspectPayload(form, profil, false) };
    const missing = [];

    if (!prospect.nom) missing.push("Nom");
    if (!prospect.prenom) missing.push("Prénom");
    if (!prospect.email && !prospect.telephone) missing.push("Email ou téléphone");
    if (!prospect.offre_recommandee) missing.push("Offre signée / proposée");
    if (!prospect.date_signature) missing.push("Date de signature");
    if (!prospect.responsable) missing.push("Responsable");

    if (missing.length) {
      setError(`Impossible de convertir : champs manquants — ${missing.join(", ")}.`);
      return;
    }

    if (prospect.email) {
      const { data: existing } = await supabase
        .from("invest_clients")
        .select("id,nom,prenom,email")
        .eq("email", prospect.email)
        .limit(1);

      if (existing?.length) {
        setError("Un client existe déjà avec cet email. Conversion bloquée pour éviter un doublon.");
        return;
      }
    }

    if (!window.confirm("Convertir ce prospect en client dans le CRM Client ?")) return;

    setSaving(true);
    setError("");
    setMsg("");

    const strategieData = {
      origine: "CRM Prospection",
      prospect_id: selected.id,
      objectif: prospect.objectif || "",
      budget_max: prospect.budget_global || null,
      apport: prospect.apport || null,
      zones: prospect.zone_recherche || "",
      strategie: prospect.strategie || "",
      urgence: prospect.delai_achat || "",
      documents_prospection: getDocumentsChecklist(prospect),
      remarques: [
        prospect.commentaire,
        prospect.besoins ? `Besoins : ${prospect.besoins}` : "",
        prospect.objections ? `Objections : ${prospect.objections}` : "",
      ].filter(Boolean).join("\n\n"),
    };

    const fullPayload = {
      nom: prospect.nom || "",
      prenom: prospect.prenom || "",
      telephone: prospect.telephone || "",
      email: prospect.email || "",
      adresse: prospect.adresse || "",
      ville: prospect.ville || "",
      code_postal: prospect.code_postal || "",
      source: prospect.source || "CRM Prospection",
      etape: "1. Signature contrat",
      statut: "actif",
      budget: prospect.budget_global || null,
      date_signature: prospect.date_signature || todayIso(),
      strategie_data: strategieData,
      created_by: getAuteur(profil),
    };

    const mediumPayload = {
      nom: fullPayload.nom,
      prenom: fullPayload.prenom,
      telephone: fullPayload.telephone,
      email: fullPayload.email,
      budget: fullPayload.budget,
      strategie_data: fullPayload.strategie_data,
    };

    const minimalPayload = {
      nom: fullPayload.nom,
      prenom: fullPayload.prenom,
    };

    const attempts = [fullPayload, mediumPayload, minimalPayload];
    let inserted = null;
    let lastError = null;

    for (const payload of attempts) {
      const { data, error: err } = await supabase.from("invest_clients").insert(payload).select("id").single();

      if (!err) {
        inserted = data;
        lastError = null;
        break;
      }

      lastError = err;
      if (err.code !== "42703") break;
    }

    if (lastError || !inserted?.id) {
      setSaving(false);
      setError(lastError?.message || "La conversion vers le CRM Client a échoué.");
      return;
    }

    const { data: updatedProspect, error: updateError } = await supabase
      .from("invest_prospects")
      .update({
        statut: "converti",
        converted_client_id: inserted.id,
        converted_at: new Date().toISOString(),
        date_signature: prospect.date_signature || todayIso(),
        updated_by: getAuteur(profil),
      })
      .eq("id", selected.id)
      .select("*")
      .single();

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMsg("Prospect converti en client.");
    setSelected(updatedProspect);
    setForm(prospectToForm(updatedProspect));
    await loadProspects();
  };

  const score = getAutoScore(form);
  const qualif = getAutoQualification(form);
  const docsPct = documentsProgress(form);
  const currentStage = getStageForStatus(form.statut);
  const callHref = form.telephone ? `tel:${String(form.telephone).replace(/\s/g, "")}` : undefined;
  const mailHref = form.email ? `mailto:${form.email}` : undefined;
  const whatsappHref = form.telephone ? `https://wa.me/33${String(form.telephone).replace(/\D/g, "").replace(/^0/, "")}` : undefined;

  return (
    <div style={{ padding: "14px 18px", maxWidth: 1560, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: T.text, letterSpacing: 0.3 }}>CRM Prospection</div>
          <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.35 }}>Vue compacte pour qualifier, relancer, proposer et convertir les prospects.</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {msg && <Badge color={SU} T={T}>{msg}</Badge>}
          <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={loadProspects} disabled={loading}>
            <Icon as={RefreshCw} size={13} /> Actualiser
          </button>
          <button className="inv-btn inv-btn-blue inv-btn-sm" type="button" onClick={startNew}>
            <Icon as={UserPlus} size={13} /> Nouveau prospect
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 9, borderRadius: RADIUS.md, background: `${DA}12`, color: DA, fontWeight: 800, marginBottom: 10, fontSize: 12 }}>
          {error}
        </div>
      )}

      {attentionProspects.length > 0 && (
        <div className="inv-card" style={{ padding: "8px 10px", marginBottom: 10, borderLeft: `4px solid ${DA}`, background: `${DA}10`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, color: DA, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <Icon as={AlertTriangle} size={14} /> À traiter
          </span>
          {attentionProspects.map((p) => (
            <button key={p.id} type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => selectProspect(p)} style={{ padding: "4px 8px", fontSize: 11 }}>
              {getProspectName(p)} · {p.date_prochaine_action || p.date_relance ? formatDate(p.date_prochaine_action || p.date_relance) : "sans action"}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
        {kpis.map((item) => (
          <KpiCard key={item.label} item={item} T={T} />
        ))}
      </div>

      <div className="inv-card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(210px, 1fr) 160px 160px auto", gap: 8, alignItems: "end" }}>
          <Field label="Recherche">
            <div style={{ position: "relative" }}>
              <Icon as={Search} size={14} style={{ position: "absolute", left: 9, top: 8, color: T.textMuted }} />
              <input
                className="inv-inp"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom, téléphone, ville, source..."
                style={{ width: "100%", paddingLeft: 30, ...compactInputStyle }}
              />
            </div>
          </Field>

          <Field label="Statut">
            <select className="inv-sel" value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} style={{ width: "100%", ...compactSelectStyle }}>
              <option value="">Tous</option>
              {STATUTS_PROSPECTION.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Responsable">
            <select className="inv-sel" value={responsableFilter} onChange={(e) => setResponsableFilter(e.target.value)} style={{ width: "100%", ...compactSelectStyle }}>
              <option value="">Tous</option>
              {responsables.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>

          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className={view === "pipeline" ? "inv-btn inv-btn-blue inv-btn-sm" : "inv-btn inv-btn-out inv-btn-sm"} type="button" onClick={() => setView("pipeline")}>
              <Icon as={LayoutGrid} size={13} /> Pipeline
            </button>
            <button className={view === "table" ? "inv-btn inv-btn-blue inv-btn-sm" : "inv-btn inv-btn-out inv-btn-sm"} type="button" onClick={() => setView("table")}>
              <Icon as={FileText} size={13} /> Liste
            </button>
            <button className={view === "relances" ? "inv-btn inv-btn-blue inv-btn-sm" : "inv-btn inv-btn-out inv-btn-sm"} type="button" onClick={() => setView("relances")}>
              <Icon as={Clock} size={13} /> Relances
            </button>
            <button className={view === "stats" ? "inv-btn inv-btn-blue inv-btn-sm" : "inv-btn inv-btn-out inv-btn-sm"} type="button" onClick={() => setView("stats")}>
              <Icon as={BarChart3} size={13} /> Stats
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: showFormPanel ? "minmax(0, 1fr) 520px" : "1fr", gap: 12, alignItems: "start" }}>
        <div>
          {view !== "stats" && <StageChips prospects={prospects} selectedStage={statutFilter} onSelectStage={setStatutFilter} T={T} />}

          {loading ? (
            <div className="inv-card" style={{ padding: 24, color: T.textMuted, textAlign: "center" }}>Chargement des prospects...</div>
          ) : view === "relances" ? (
            <RelancesView prospects={filteredProspects} selectedId={selected?.id} onSelect={selectProspect} T={T} />
          ) : view === "stats" ? (
            <StatsView prospects={filteredProspects} T={T} />
          ) : (
            <ProspectsCompactList prospects={filteredProspects} selectedId={selected?.id} onSelect={selectProspect} T={T} title={view === "pipeline" ? "Pipeline compact" : "Liste des prospects"} />
          )}
        </div>

        {showFormPanel && (
          <div className="inv-card" style={{ position: "sticky", top: 10, overflow: "hidden" }}>
            <div className="inv-card-hd blue" style={{ justifyContent: "space-between", padding: "10px 12px", minHeight: 38 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={selected?.id ? Pencil : UserPlus} size={13} />
                {selected?.id ? getProspectName(form) : "Nouveau prospect"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Badge color={currentStage.color} T={T}>{currentStage.short}</Badge>
                <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={closePanel} style={{ padding: "4px 7px" }}>
                  <Icon as={X} size={12} />
                </button>
              </div>
            </div>

            <div className="inv-card-bd" style={{ padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 78px", gap: 8, alignItems: "end", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 900, marginBottom: 3 }}>Score</div>
                  <Badge color={qualif.color} T={T}>{qualif.label} · {score}</Badge>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 900, marginBottom: 3 }}>Progression</div>
                  <ProgressBar value={score} color={qualif.color} T={T} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 900, marginBottom: 3 }}>Documents</div>
                  <ProgressBar value={docsPct} color={docsPct >= 75 ? SU : docsPct >= 40 ? WA : DA} T={T} />
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: T.textMuted }}>{docsPct}% docs</div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {["qualification", "contact", "rdv", "proposition", "signe"].map((s) => (
                  <button key={s} type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => setQuickStatus(s)} style={{ padding: "4px 7px", fontSize: 11 }}>
                    {STATUT_OPTIONS.find(([id]) => id === s)?.[1] || s}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <Field label="Prénom">
                  <TextInput value={form.prenom} onChange={(v) => setField("prenom", v)} />
                </Field>
                <Field label="Nom">
                  <TextInput value={form.nom} onChange={(v) => setField("nom", v)} />
                </Field>
                <Field label="Société">
                  <TextInput value={form.societe} onChange={(v) => setField("societe", v)} />
                </Field>
                <Field label="Téléphone">
                  <TextInput value={form.telephone} onChange={(v) => setField("telephone", v)} />
                </Field>
                <Field label="Email">
                  <TextInput value={form.email} onChange={(v) => setField("email", v)} />
                </Field>
                <Field label="Ville">
                  <TextInput value={form.ville} onChange={(v) => setField("ville", v)} />
                </Field>
                <Field label="Source">
                  <SelectInput value={form.source} onChange={(v) => setField("source", v)} options={SOURCES} />
                </Field>
                <Field label="Responsable">
                  <TextInput value={form.responsable} onChange={(v) => setField("responsable", v)} />
                </Field>
                <Field label="Statut">
                  <select className="inv-sel" value={form.statut || "nouveau"} onChange={(e) => setField("statut", e.target.value)} style={{ width: "100%", ...compactSelectStyle }}>
                    {STATUT_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Objectif" wide>
                  <SelectInput value={form.objectif} onChange={(v) => setField("objectif", v)} options={OBJECTIFS} />
                </Field>
                <Field label="Zone">
                  <TextInput value={form.zone_recherche} onChange={(v) => setField("zone_recherche", v)} />
                </Field>
                <Field label="Délai">
                  <TextInput value={form.delai_achat} onChange={(v) => setField("delai_achat", v)} placeholder="Ex : 3 mois" />
                </Field>
                <Field label="Type bien">
                  <SelectInput value={form.type_bien} onChange={(v) => setField("type_bien", v)} options={TYPES_BIEN} />
                </Field>
                <Field label="Stratégie">
                  <SelectInput value={form.strategie} onChange={(v) => setField("strategie", v)} options={STRATEGIES} />
                </Field>
                <Field label="Budget">
                  <TextInput type="number" value={form.budget_global} onChange={(v) => setField("budget_global", v)} />
                </Field>
                <Field label="Apport">
                  <TextInput type="number" value={form.apport} onChange={(v) => setField("apport", v)} />
                </Field>
                <Field label="Capacité emprunt">
                  <TextInput type="number" value={form.capacite_emprunt} onChange={(v) => setField("capacite_emprunt", v)} />
                </Field>
                <Field label="Motivation">
                  <SelectInput value={form.motivation} onChange={(v) => setField("motivation", v)} options={MOTIVATIONS} />
                </Field>
                <Field label="Maturité">
                  <SelectInput value={form.maturite} onChange={(v) => setField("maturite", v)} options={MATURITES} />
                </Field>
                <Field label="Prob. %">
                  <TextInput type="number" value={form.probabilite_signature} onChange={(v) => setField("probabilite_signature", v)} />
                </Field>
              </div>

              <div style={{ margin: "10px 0", height: 1, background: T.border }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <Field label="Offre" wide>
                  <TextInput value={form.offre_recommandee} onChange={(v) => setField("offre_recommandee", v)} placeholder="Ex : Accompagnement Invest" />
                </Field>
                <Field label="Honoraires HT">
                  <TextInput type="number" value={form.honoraires_estimes_ht} onChange={(v) => setField("honoraires_estimes_ht", v)} />
                </Field>
                <Field label="Honoraires TTC">
                  <TextInput type="number" value={form.honoraires_estimes_ttc} onChange={(v) => setField("honoraires_estimes_ttc", v)} />
                </Field>
                <Field label="CA potentiel HT">
                  <TextInput type="number" value={form.ca_potentiel_ht} onChange={(v) => setField("ca_potentiel_ht", v)} />
                </Field>
                <Field label="Statut proposition">
                  <SelectInput value={form.statut_proposition} onChange={(v) => setField("statut_proposition", v)} options={OFFRE_STATUTS} />
                </Field>
                <Field label="Date proposition">
                  <TextInput type="date" value={form.date_proposition} onChange={(v) => setField("date_proposition", v)} />
                </Field>
                <Field label="Date signature">
                  <TextInput type="date" value={form.date_signature} onChange={(v) => setField("date_signature", v)} />
                </Field>
              </div>

              <div style={{ marginTop: 9 }}>
                <CompactDocuments form={form} T={T} onChange={(nextData) => setField("donnees", nextData)} />
              </div>

              <div style={{ margin: "10px 0", height: 1, background: T.border }} />

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr .8fr", gap: 8 }}>
                <Field label="Prochaine action">
                  <TextInput value={form.prochaine_action} onChange={(v) => setField("prochaine_action", v)} />
                </Field>
                <Field label="Date action">
                  <TextInput type="date" value={form.date_prochaine_action} onChange={(v) => setField("date_prochaine_action", v)} />
                </Field>
                <Field label="Date RDV">
                  <TextInput type="date" value={form.date_rdv} onChange={(v) => setField("date_rdv", v)} />
                </Field>
                <Field label="Heure">
                  <TextInput value={form.heure_rdv} onChange={(v) => setField("heure_rdv", v)} placeholder="14:30" />
                </Field>
                <Field label="Type RDV">
                  <TextInput value={form.type_rdv} onChange={(v) => setField("type_rdv", v)} placeholder="Tél / visio" />
                </Field>
                <Field label="Lieu / lien">
                  <TextInput value={form.lieu_rdv} onChange={(v) => setField("lieu_rdv", v)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 9 }}>
                <Field label="Besoins / contexte">
                  <TextArea value={form.besoins} onChange={(v) => setField("besoins", v)} rows={2} />
                </Field>
                <Field label="Objections / freins">
                  <TextArea value={form.objections} onChange={(v) => setField("objections", v)} rows={2} />
                </Field>
                <Field label="Commentaire interne" wide>
                  <TextArea value={form.commentaire} onChange={(v) => setField("commentaire", v)} rows={2} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {callHref && <a className="inv-btn inv-btn-out inv-btn-sm" href={callHref}><Icon as={Phone} size={12} /> Appeler</a>}
                {mailHref && <a className="inv-btn inv-btn-out inv-btn-sm" href={mailHref}><Icon as={Mail} size={12} /> Email</a>}
                {whatsappHref && <a className="inv-btn inv-btn-out inv-btn-sm" href={whatsappHref} target="_blank" rel="noreferrer"><Icon as={MessageSquare} size={12} /> WhatsApp</a>}
                <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={copyMailConfirmation}><Icon as={Mail} size={12} /> Copier RDV</button>
                <button type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={copyRelanceMessage}><Icon as={MessageSquare} size={12} /> Copier relance</button>
                {RELANCE_PRESETS.map((r) => (
                  <button key={r.label} type="button" className="inv-btn inv-btn-out inv-btn-sm" onClick={() => scheduleRelance(r.days, r.action)}>Relance {r.label}</button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                <button className="inv-btn inv-btn-blue" type="button" onClick={saveProspect} disabled={saving}>
                  <Icon as={Save} size={14} /> {saving ? "Sauvegarde..." : "Sauvegarder"}
                </button>

                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {selected?.id && (
                    <button className="inv-btn inv-btn-gold" type="button" onClick={convertToClient} disabled={saving || selected?.statut === "converti"}>
                      <Icon as={ArrowRight} size={14} /> Convertir client
                    </button>
                  )}
                  {selected?.id && (
                    <button className="inv-btn inv-btn-out" type="button" onClick={softDeleteProspect}>
                      <Icon as={Trash2} size={14} />
                    </button>
                  )}
                </div>
              </div>

              {selected?.id && (
                <div style={{ marginTop: 10, padding: 9, borderRadius: RADIUS.md, background: T.cardHover, border: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 12, color: T.text, fontWeight: 900, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon as={MessageSquare} size={13} /> Action rapide
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Historique : {actions.length}</div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "86px 96px 1fr", gap: 6, marginBottom: 6 }}>
                    <select className="inv-sel" value={actionForm.type_action} onChange={(e) => setActionForm((p) => ({ ...p, type_action: e.target.value }))} style={{ ...compactSelectStyle, width: "100%" }}>
                      {TYPES_ACTION.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select className="inv-sel" value={actionForm.resultat} onChange={(e) => setActionForm((p) => ({ ...p, resultat: e.target.value }))} style={{ ...compactSelectStyle, width: "100%" }}>
                      {RESULTATS_ACTION.map((r) => <option key={r || "empty"} value={r}>{r || "Résultat"}</option>)}
                    </select>
                    <input className="inv-inp" value={actionForm.resume} onChange={(e) => setActionForm((p) => ({ ...p, resume: e.target.value }))} placeholder="Résumé de l'action" style={{ ...compactInputStyle, width: "100%" }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 6 }}>
                    <input className="inv-inp" value={actionForm.prochaine_action} onChange={(e) => setActionForm((p) => ({ ...p, prochaine_action: e.target.value }))} placeholder="Prochaine action" style={{ ...compactInputStyle, width: "100%" }} />
                    <input className="inv-inp" type="date" value={actionForm.date_prochaine_action} onChange={(e) => setActionForm((p) => ({ ...p, date_prochaine_action: e.target.value }))} style={{ ...compactInputStyle, width: "100%" }} />
                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={saveAction} disabled={saving}>
                      <Icon as={Check} size={12} /> Ajouter
                    </button>
                  </div>

                  {actions.slice(0, 3).length > 0 && (
                    <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
                      {actions.slice(0, 3).map((a) => (
                        <div key={a.id} style={{ padding: "6px 0", borderTop: `1px solid ${T.border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <strong style={{ color: T.text, fontSize: 11 }}>{a.type_action}</strong>
                            <span style={{ color: T.textMuted, fontSize: 10 }}>{formatDateTime(a.date_action)}</span>
                          </div>
                          <div style={{ color: T.textSub, fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>{a.resume}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
