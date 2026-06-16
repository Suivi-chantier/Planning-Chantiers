import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { FONT, RADIUS, SPACING } from "../constants";
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
  Euro,
  AlertTriangle,
  Check,
} from "lucide-react";

const STATUTS_PROSPECTION = [
  {
    id: "nouveau",
    label: "Nouveaux prospects",
    short: "Nouveau",
    description: "Prospects ajoutés mais pas encore qualifiés",
    icon: UserPlus,
    color: "#60A5FA",
    aliases: ["nouveau"],
  },
  {
    id: "qualification",
    label: "À qualifier",
    short: "À qualifier",
    description: "Analyse du profil, budget, objectif et délai",
    icon: Search,
    color: "#C9A84C",
    aliases: ["qualification"],
  },
  {
    id: "contact",
    label: "Contact / relance",
    short: "Contact",
    description: "Premier échange réalisé ou relance à prévoir",
    icon: Phone,
    color: "#F59E0B",
    aliases: ["contact", "relance"],
  },
  {
    id: "rdv",
    label: "RDV planifié",
    short: "RDV",
    description: "Rendez-vous découverte ou closing prévu",
    icon: Calendar,
    color: "#8B5CF6",
    aliases: ["rdv"],
  },
  {
    id: "proposition",
    label: "Proposition envoyée",
    short: "Proposition",
    description: "Offre commerciale ou contrat transmis",
    icon: FileText,
    color: "#10B981",
    aliases: ["proposition"],
  },
  {
    id: "signe",
    label: "Signés / convertis",
    short: "Signé",
    description: "Prospects signés ou convertis vers le CRM Client",
    icon: CheckCircle2,
    color: SU,
    aliases: ["signe", "converti"],
  },
  {
    id: "perdu",
    label: "Perdus / sommeil",
    short: "Perdu",
    description: "Prospects non transformés ou à reprendre plus tard",
    icon: XCircle,
    color: DA,
    aliases: ["perdu", "sommeil", "hors_cible"],
  },
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
const TYPES_ACTION = ["note", "appel", "sms", "email", "whatsapp", "rdv_visio", "rdv_physique", "envoi_document", "envoi_contrat", "relance"];
const RESULTATS_ACTION = ["", "Répondu", "Pas répondu", "Message laissé", "Intéressé", "À relancer", "Refus", "Signature prévue", "Contrat envoyé", "Contrat signé"];

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
};

const EMPTY_ACTION = {
  type_action: "note",
  resume: "",
  resultat: "",
  prochaine_action: "",
  date_prochaine_action: "",
};

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

function isoDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
    ca_potentiel_ht: n(form.ca_potentiel_ht),
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
    updated_by: getAuteur(profil),
    is_deleted: false,
  };

  if (isNew) payload.created_by = getAuteur(profil);

  if (!payload.ca_potentiel_ht && payload.honoraires_estimes_ht) {
    payload.ca_potentiel_ht = payload.honoraires_estimes_ht;
  }

  return payload;
}

function Field({ label, children, wide = false }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto" }}>
      <label className="inv-kpi-lbl" style={{ display: "block", marginBottom: 4 }}>
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
      style={{ width: "100%", textAlign: type === "number" ? "right" : "left", ...style }}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      className="inv-sel"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%" }}
    >
      {options.map((o) => (
        <option key={o || "empty"} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

function TextArea({ value, onChange, rows = 3 }) {
  return (
    <textarea
      className="inv-textarea"
      rows={rows}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%" }}
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
        padding: "3px 8px",
        borderRadius: 999,
        background: `${color || T.accent}18`,
        color: color || T.accent,
        fontSize: FONT.xs.size,
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
    <div
      className="inv-card"
      style={{
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: RADIUS.lg,
          background: `${item.color}18`,
          color: item.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon as={KpiIcon} size={18} strokeWidth={2.1} />
      </div>

      <div>
        <div
          style={{
            fontSize: FONT.xs.size,
            color: T.textMuted,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            fontWeight: 800,
            marginBottom: 2,
          }}
        >
          {item.label}
        </div>
        <div
          style={{
            fontSize: FONT.lg.size,
            color: T.text,
            fontWeight: 900,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {item.value}
        </div>
      </div>
    </div>
  );
}

function ProspectMiniCard({ prospect, selected, onClick, T }) {
  const stage = getStageForStatus(prospect.statut);
  const late = isLate(prospect.date_prochaine_action || prospect.date_relance);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        background: selected ? T.accentBg : T.cardHover,
        border: `1px solid ${selected ? T.accent : T.border}`,
        borderRadius: RADIUS.md,
        padding: 10,
        cursor: "pointer",
        color: T.text,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getProspectName(prospect)}
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
            {prospect.ville || prospect.source || "Information à compléter"}
          </div>
        </div>
        <Badge color={stage.color} T={T}>
          {stage.short}
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        <div style={{ fontSize: FONT.xs.size + 1, color: late ? DA : T.textSub, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={Clock} size={12} />
          {prospect.date_prochaine_action ? formatDate(prospect.date_prochaine_action) : "Aucune action"}
        </div>

        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontFamily: "'DM Mono', monospace" }}>
          {prospect.ca_potentiel_ht ? fmtDashboardEur(prospect.ca_potentiel_ht) : "—"}
        </div>
      </div>
    </button>
  );
}

function PipelineColumn({ stage, prospects, selectedId, onSelect, T }) {
  const StageIcon = stage.icon;

  return (
    <div
      className="inv-card"
      style={{
        minWidth: 250,
        padding: 12,
        borderTop: `3px solid ${stage.color}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: RADIUS.md,
            background: `${stage.color}18`,
            color: stage.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon as={StageIcon} size={15} strokeWidth={2.2} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 900, color: T.text, lineHeight: 1.15 }}>
            {stage.label}
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {prospects.length} prospect{prospects.length > 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.4, marginBottom: 10 }}>
        {stage.description}
      </div>

      {prospects.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${T.border}`,
            borderRadius: RADIUS.md,
            padding: 14,
            textAlign: "center",
            color: T.textMuted,
            fontSize: FONT.xs.size + 1,
          }}
        >
          Aucun prospect
        </div>
      ) : (
        prospects.map((p) => (
          <ProspectMiniCard
            key={p.id}
            prospect={p}
            selected={selectedId === p.id}
            onClick={() => onSelect(p)}
            T={T}
          />
        ))
      )}
    </div>
  );
}

function ProspectsTable({ prospects, selectedId, onSelect, T }) {
  return (
    <div className="inv-card" style={{ overflow: "hidden" }}>
      <div className="inv-card-hd blue">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={Users} size={13} />
          Liste des prospects
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 950 }}>
          <thead>
            <tr style={{ background: T.cardHover }}>
              {["Prospect", "Statut", "Responsable", "Source", "Prochaine action", "CA potentiel", "Priorité", "Action"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    color: T.textMuted,
                    fontSize: FONT.xs.size,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {prospects.map((p) => {
              const stage = getStageForStatus(p.statut);
              const late = isLate(p.date_prochaine_action || p.date_relance);

              return (
                <tr
                  key={p.id}
                  style={{
                    background: selectedId === p.id ? T.accentBg : "transparent",
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ color: T.text, fontWeight: 900 }}>{getProspectName(p)}</div>
                    <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>
                      {[p.email, p.telephone].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Badge color={stage.color} T={T}>{stage.short}</Badge>
                  </td>
                  <td style={{ padding: "10px 12px", color: T.textSub, fontSize: FONT.sm.size }}>
                    {p.responsable || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: T.textSub, fontSize: FONT.sm.size }}>
                    {p.source || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: late ? DA : T.textSub, fontSize: FONT.sm.size }}>
                    {p.prochaine_action || "—"}
                    <div style={{ fontSize: FONT.xs.size }}>{formatDate(p.date_prochaine_action || p.date_relance)}</div>
                  </td>
                  <td style={{ padding: "10px 12px", color: T.text, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>
                    {p.ca_potentiel_ht ? fmtDashboardEur(p.ca_potentiel_ht) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Badge color={p.priorite === "haute" ? DA : p.priorite === "moyenne" ? WA : SU} T={T}>
                      {p.priorite || "—"}
                    </Badge>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => onSelect(p)}>
                      <Icon as={Eye} size={12} />
                      Ouvrir
                    </button>
                  </td>
                </tr>
              );
            })}

            {prospects.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: T.textMuted }}>
                  Aucun prospect dans cette vue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Prospection({ profil, T = THEMES_INV.dark }) {
  const [prospects, setProspects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_PROSPECT });
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

  const responsables = useMemo(() => {
    return Array.from(new Set(prospects.map((p) => p.responsable).filter(Boolean))).sort();
  }, [prospects]);

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
      ].join(" ").toLowerCase();

      const matchQuery = !q || haystack.includes(q);
      const matchStatut = !statutFilter || getStageForStatus(p.statut).id === statutFilter || p.statut === statutFilter;
      const matchResponsable = !responsableFilter || p.responsable === responsableFilter;

      return matchQuery && matchStatut && matchResponsable;
    });
  }, [prospects, query, statutFilter, responsableFilter]);

  const grouped = useMemo(() => {
    return STATUTS_PROSPECTION.map((stage) => ({
      stage,
      prospects: filteredProspects.filter((p) => stage.aliases.includes(p.statut)),
    }));
  }, [filteredProspects]);

  const kpis = useMemo(() => {
    const actifs = prospects.filter((p) => !["perdu", "sommeil", "hors_cible", "converti"].includes(p.statut)).length;
    const rdv = prospects.filter((p) => p.date_rdv && isoDate(p.date_rdv) >= todayIso()).length;
    const retard = prospects.filter((p) => isLate(p.date_prochaine_action || p.date_relance) && !["perdu", "converti"].includes(p.statut)).length;
    const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);

    return [
      { label: "Prospects actifs", value: actifs, icon: UserPlus, color: "#60A5FA" },
      { label: "RDV à venir", value: rdv, icon: Calendar, color: "#8B5CF6" },
      { label: "Relances en retard", value: retard, icon: Clock, color: retard > 0 ? DA : SU },
      { label: "CA potentiel HT", value: fmtDashboardEur(ca), icon: TrendingUp, color: SU },
    ];
  }, [prospects]);

  const startNew = () => {
    setSelected(null);
    setForm({
      ...EMPTY_PROSPECT,
      responsable: profil?.prenom || profil?.nom || "",
      date_premier_contact: "",
    });
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const selectProspect = (p) => {
    setSelected(p);
    setForm(prospectToForm(p));
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
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
      result = await supabase
        .from("invest_prospects")
        .insert(payload)
        .select("*")
        .single();
    } else {
      result = await supabase
        .from("invest_prospects")
        .update(payload)
        .eq("id", selected.id)
        .select("*")
        .single();
    }

    setSaving(false);

    if (result.error) {
      setError(result.error.message || "Erreur de sauvegarde.");
      return;
    }

    setMsg(isNew ? "Prospect créé." : "Prospect sauvegardé.");
    setSelected(result.data);
    setForm(prospectToForm(result.data));
    await loadProspects();

    setTimeout(() => setMsg(""), 2200);
  };

  const softDeleteProspect = async () => {
    if (!selected?.id) return;
    if (!window.confirm("Classer ce prospect comme supprimé ? Il ne sera plus visible dans la liste.")) return;

    const { error: err } = await supabase
      .from("invest_prospects")
      .update({
        is_deleted: true,
        updated_by: getAuteur(profil),
      })
      .eq("id", selected.id);

    if (err) {
      setError(err.message);
      return;
    }

    setSelected(null);
    setForm({ ...EMPTY_PROSPECT });
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

    const { error: err } = await supabase
      .from("invest_prospect_actions")
      .insert(payload);

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

  const convertToClient = async () => {
    if (!selected?.id) return;

    const prospect = { ...selected, ...buildProspectPayload(form, profil, false) };

    if (!prospect.nom && !prospect.prenom) {
      setError("Impossible de convertir : le nom ou prénom du client est manquant.");
      return;
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
      travaux_acceptes: prospect.budget_travaux ? "Oui" : "",
      urgence: prospect.delai_achat || "",
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
      const { data, error: err } = await supabase
        .from("invest_clients")
        .insert(payload)
        .select("id")
        .single();

      if (!err) {
        inserted = data;
        lastError = null;
        break;
      }

      lastError = err;

      // 42703 = colonne inexistante. On retente avec un payload plus simple.
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

  const missingTable = error && (
    error.includes("invest_prospects") ||
    error.includes("Could not find the table") ||
    error.includes("relation") ||
    error.includes("schema cache")
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1500, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: T.text,
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            CRM Prospection
          </div>
          <div
            style={{
              fontSize: 14,
              color: T.textSub,
              maxWidth: 760,
              lineHeight: 1.5,
            }}
          >
            Suivi des prospects avant signature. Les prospects qualifiés et signés
            pourront ensuite être convertis vers le CRM Client.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="inv-btn inv-btn-out" type="button" onClick={loadProspects} disabled={loading}>
            <Icon as={RefreshCw} size={15} />
            Actualiser
          </button>

          <button className="inv-btn inv-btn-blue" type="button" onClick={startNew}>
            <Icon as={UserPlus} size={15} />
            Nouveau prospect
          </button>
        </div>
      </div>

      {missingTable && (
        <div
          style={{
            padding: 16,
            borderRadius: RADIUS.lg,
            border: `1px solid ${DA}`,
            background: `${DA}12`,
            color: T.text,
            marginBottom: 18,
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 900, color: DA, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <Icon as={AlertTriangle} size={17} />
            Table Supabase manquante
          </div>
          Exécute d'abord le fichier SQL <strong>supabase_prospection_v1.sql</strong> dans Supabase,
          puis redéploie ou actualise cette page.
        </div>
      )}

      {error && !missingTable && (
        <div
          style={{
            padding: 12,
            borderRadius: RADIUS.md,
            background: `${DA}12`,
            color: DA,
            fontWeight: 800,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {msg && (
        <div
          style={{
            padding: 12,
            borderRadius: RADIUS.md,
            background: `${SU}12`,
            color: SU,
            fontWeight: 900,
            marginBottom: 14,
          }}
        >
          {msg}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {kpis.map((item) => (
          <KpiCard key={item.label} item={item} T={T} />
        ))}
      </div>

      <div className="inv-card" style={{ padding: 14, marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) 190px 190px auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <Field label="Recherche">
            <div style={{ position: "relative" }}>
              <Icon as={Search} size={15} style={{ position: "absolute", left: 10, top: 10, color: T.textMuted }} />
              <input
                className="inv-inp"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom, téléphone, ville, source..."
                style={{ width: "100%", paddingLeft: 32 }}
              />
            </div>
          </Field>

          <Field label="Statut">
            <select className="inv-sel" value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} style={{ width: "100%" }}>
              <option value="">Tous les statuts</option>
              {STATUTS_PROSPECTION.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Responsable">
            <select className="inv-sel" value={responsableFilter} onChange={(e) => setResponsableFilter(e.target.value)} style={{ width: "100%" }}>
              <option value="">Tous</option>
              {responsables.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className={view === "pipeline" ? "inv-btn inv-btn-blue" : "inv-btn inv-btn-out"} type="button" onClick={() => setView("pipeline")}>
              <Icon as={Filter} size={14} />
              Pipeline
            </button>
            <button className={view === "table" ? "inv-btn inv-btn-blue" : "inv-btn inv-btn-out"} type="button" onClick={() => setView("table")}>
              <Icon as={FileText} size={14} />
              Tableau
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selected || form !== EMPTY_PROSPECT ? "minmax(0, 1fr) 460px" : "1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div>
          {loading ? (
            <div className="inv-card" style={{ padding: 24, color: T.textMuted, textAlign: "center" }}>
              Chargement des prospects...
            </div>
          ) : view === "pipeline" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(250px, 1fr))",
                gap: 12,
                overflowX: "auto",
                paddingBottom: 8,
              }}
            >
              {grouped.map(({ stage, prospects: items }) => (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  prospects={items}
                  selectedId={selected?.id}
                  onSelect={selectProspect}
                  T={T}
                />
              ))}
            </div>
          ) : (
            <ProspectsTable
              prospects={filteredProspects}
              selectedId={selected?.id}
              onSelect={selectProspect}
              T={T}
            />
          )}
        </div>

        {(selected || form.nom || form.prenom || form.societe || form.responsable) && (
          <div className="inv-card" style={{ position: "sticky", top: 16 }}>
            <div className="inv-card-hd blue" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={selected?.id ? Pencil : UserPlus} size={13} />
                {selected?.id ? "Fiche prospect" : "Nouveau prospect"}
              </span>

              <button
                type="button"
                className="inv-btn inv-btn-out inv-btn-sm"
                onClick={() => {
                  setSelected(null);
                  setForm({ ...EMPTY_PROSPECT });
                }}
              >
                <Icon as={X} size={12} />
              </button>
            </div>

            <div className="inv-card-bd" style={{ maxHeight: "calc(100vh - 170px)", overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Prénom">
                  <TextInput value={form.prenom} onChange={(v) => setField("prenom", v)} />
                </Field>

                <Field label="Nom">
                  <TextInput value={form.nom} onChange={(v) => setField("nom", v)} />
                </Field>

                <Field label="Société" wide>
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

                <Field label="Code postal">
                  <TextInput value={form.code_postal} onChange={(v) => setField("code_postal", v)} />
                </Field>

                <Field label="Source">
                  <SelectInput value={form.source} onChange={(v) => setField("source", v)} options={SOURCES} />
                </Field>

                <Field label="Responsable">
                  <TextInput value={form.responsable} onChange={(v) => setField("responsable", v)} />
                </Field>

                <Field label="Statut">
                  <select className="inv-sel" value={form.statut || "nouveau"} onChange={(e) => setField("statut", e.target.value)} style={{ width: "100%" }}>
                    {[
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
                    ].map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Priorité">
                  <SelectInput value={form.priorite} onChange={(v) => setField("priorite", v)} options={PRIORITES} />
                </Field>

                <Field label="Score">
                  <SelectInput value={form.score} onChange={(v) => setField("score", v)} options={SCORES} />
                </Field>
              </div>

              <div style={{ height: 1, background: T.border, margin: "18px 0" }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Objectif" wide>
                  <SelectInput value={form.objectif} onChange={(v) => setField("objectif", v)} options={OBJECTIFS} />
                </Field>

                <Field label="Zone recherchée">
                  <TextInput value={form.zone_recherche} onChange={(v) => setField("zone_recherche", v)} />
                </Field>

                <Field label="Délai d'achat">
                  <TextInput value={form.delai_achat} onChange={(v) => setField("delai_achat", v)} />
                </Field>

                <Field label="Type de bien">
                  <SelectInput value={form.type_bien} onChange={(v) => setField("type_bien", v)} options={TYPES_BIEN} />
                </Field>

                <Field label="Stratégie">
                  <SelectInput value={form.strategie} onChange={(v) => setField("strategie", v)} options={STRATEGIES} />
                </Field>

                <Field label="Budget global">
                  <TextInput type="number" value={form.budget_global} onChange={(v) => setField("budget_global", v)} />
                </Field>

                <Field label="Apport">
                  <TextInput type="number" value={form.apport} onChange={(v) => setField("apport", v)} />
                </Field>

                <Field label="Capacité emprunt">
                  <TextInput type="number" value={form.capacite_emprunt} onChange={(v) => setField("capacite_emprunt", v)} />
                </Field>

                <Field label="Honoraires estimés HT">
                  <TextInput type="number" value={form.honoraires_estimes_ht} onChange={(v) => setField("honoraires_estimes_ht", v)} />
                </Field>

                <Field label="Motivation">
                  <SelectInput value={form.motivation} onChange={(v) => setField("motivation", v)} options={MOTIVATIONS} />
                </Field>

                <Field label="Maturité">
                  <SelectInput value={form.maturite} onChange={(v) => setField("maturite", v)} options={MATURITES} />
                </Field>

                <Field label="Probabilité signature %">
                  <TextInput type="number" value={form.probabilite_signature} onChange={(v) => setField("probabilite_signature", v)} />
                </Field>
              </div>

              <div style={{ height: 1, background: T.border, margin: "18px 0" }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Prochaine action" wide>
                  <TextInput value={form.prochaine_action} onChange={(v) => setField("prochaine_action", v)} />
                </Field>

                <Field label="Date prochaine action">
                  <TextInput type="date" value={form.date_prochaine_action} onChange={(v) => setField("date_prochaine_action", v)} />
                </Field>

                <Field label="Date relance">
                  <TextInput type="date" value={form.date_relance} onChange={(v) => setField("date_relance", v)} />
                </Field>

                <Field label="Date RDV">
                  <TextInput type="date" value={form.date_rdv} onChange={(v) => setField("date_rdv", v)} />
                </Field>

                <Field label="Heure RDV">
                  <TextInput value={form.heure_rdv} onChange={(v) => setField("heure_rdv", v)} placeholder="Ex : 14:30" />
                </Field>

                <Field label="Type RDV">
                  <TextInput value={form.type_rdv} onChange={(v) => setField("type_rdv", v)} placeholder="Téléphone, visio, physique..." />
                </Field>

                <Field label="Lieu / lien RDV">
                  <TextInput value={form.lieu_rdv} onChange={(v) => setField("lieu_rdv", v)} />
                </Field>
              </div>

              <div style={{ marginTop: 12 }}>
                <Field label="Besoins identifiés" wide>
                  <TextArea value={form.besoins} onChange={(v) => setField("besoins", v)} rows={3} />
                </Field>
              </div>

              <div style={{ marginTop: 12 }}>
                <Field label="Objections / freins" wide>
                  <TextArea value={form.objections} onChange={(v) => setField("objections", v)} rows={3} />
                </Field>
              </div>

              <div style={{ marginTop: 12 }}>
                <Field label="Commentaire interne" wide>
                  <TextArea value={form.commentaire} onChange={(v) => setField("commentaire", v)} rows={4} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
                <button className="inv-btn inv-btn-blue" type="button" onClick={saveProspect} disabled={saving}>
                  <Icon as={Save} size={14} />
                  {saving ? "Sauvegarde..." : "Sauvegarder"}
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                  {selected?.id && (
                    <button className="inv-btn inv-btn-gold" type="button" onClick={convertToClient} disabled={saving || selected?.statut === "converti"}>
                      <Icon as={ArrowRight} size={14} />
                      Convertir client
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
                <>
                  <div style={{ height: 1, background: T.border, margin: "20px 0" }} />

                  <div style={{ fontSize: FONT.md.size, fontWeight: 900, color: T.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon as={MessageSquare} size={15} />
                    Historique commercial
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <Field label="Type action">
                      <select className="inv-sel" value={actionForm.type_action} onChange={(e) => setActionForm((p) => ({ ...p, type_action: e.target.value }))} style={{ width: "100%" }}>
                        {TYPES_ACTION.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>

                    <Field label="Résultat">
                      <select className="inv-sel" value={actionForm.resultat} onChange={(e) => setActionForm((p) => ({ ...p, resultat: e.target.value }))} style={{ width: "100%" }}>
                        {RESULTATS_ACTION.map((r) => <option key={r || "empty"} value={r}>{r || "—"}</option>)}
                      </select>
                    </Field>

                    <Field label="Résumé" wide>
                      <TextArea value={actionForm.resume} onChange={(v) => setActionForm((p) => ({ ...p, resume: v }))} rows={3} />
                    </Field>

                    <Field label="Prochaine action">
                      <TextInput value={actionForm.prochaine_action} onChange={(v) => setActionForm((p) => ({ ...p, prochaine_action: v }))} />
                    </Field>

                    <Field label="Date prochaine action">
                      <TextInput type="date" value={actionForm.date_prochaine_action} onChange={(v) => setActionForm((p) => ({ ...p, date_prochaine_action: v }))} />
                    </Field>
                  </div>

                  <button className="inv-btn inv-btn-out" type="button" onClick={saveAction} disabled={saving}>
                    <Icon as={Check} size={14} />
                    Ajouter l'action
                  </button>

                  <div style={{ marginTop: 14 }}>
                    {actions.length === 0 ? (
                      <div style={{ color: T.textMuted, fontSize: FONT.sm.size, padding: 12, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
                        Aucune action enregistrée.
                      </div>
                    ) : (
                      actions.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            padding: "10px 0",
                            borderBottom: `1px solid ${T.border}`,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ color: T.text, fontWeight: 900 }}>{a.type_action}</div>
                            <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>{formatDateTime(a.date_action)}</div>
                          </div>
                          <div style={{ color: T.textSub, fontSize: FONT.sm.size, marginTop: 4, lineHeight: 1.45 }}>
                            {a.resume}
                          </div>
                          {(a.resultat || a.prochaine_action) && (
                            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {a.resultat && <Badge color={WA} T={T}>{a.resultat}</Badge>}
                              {a.prochaine_action && <Badge color={SU} T={T}>{a.prochaine_action}</Badge>}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
