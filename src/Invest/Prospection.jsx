import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { FONT, RADIUS } from "../constants";
import { THEMES_INV, SU, WA, DA, fmtDashboardEur } from "./_shared";
import {
  UserPlus,
  Search,
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  Save,
  Trash2,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  Euro,
  Users,
  Pencil,
  X,
} from "lucide-react";

/**
 * CRM Prospection — Version simplifiée
 *
 * Logique retenue :
 * - Peu de champs obligatoires
 * - Une fiche courte et exploitable
 * - Un statut clair
 * - Une prochaine action obligatoire dans l'idéal
 * - Un historique simple
 * - Conversion vers CRM Client
 *
 * Tables utilisées :
 * - public.invest_prospects
 * - public.invest_prospect_actions
 */

const STATUTS = [
  { id: "nouveau", label: "Nouveau", icon: UserPlus, color: "#60A5FA" },
  { id: "contact", label: "Contact", icon: Phone, color: "#F59E0B" },
  { id: "rdv", label: "RDV", icon: Calendar, color: "#8B5CF6" },
  { id: "proposition", label: "Proposition", icon: Target, color: "#10B981" },
  { id: "signe", label: "Signé", icon: CheckCircle2, color: SU },
  { id: "perdu", label: "Perdu", icon: XCircle, color: DA },
];

const SOURCES = [
  "",
  "Site internet",
  "Recommandation",
  "Instagram",
  "LinkedIn",
  "Congrès UPI",
  "Partenaire",
  "Bouche-à-oreille",
  "Prospection directe",
  "Autre",
];

const OBJECTIFS = [
  "",
  "Créer du patrimoine",
  "Cash-flow",
  "Préparer la retraite",
  "Optimisation fiscale",
  "Achat-revente",
  "Investir à distance",
  "Projet à définir",
];

const BUDGETS_RAPIDES = [
  "",
  "100000",
  "150000",
  "200000",
  "250000",
  "300000",
  "400000",
  "500000",
];

const PROCHAINES_ACTIONS = [
  "",
  "Appeler",
  "Envoyer un message",
  "Programmer un RDV",
  "Envoyer une proposition",
  "Relancer la proposition",
  "Convertir en client",
  "Classer perdu",
];

const EMPTY_FORM = {
  nom: "",
  prenom: "",
  societe: "",
  telephone: "",
  email: "",
  source: "",
  responsable: "",
  statut: "nouveau",
  objectif: "",
  budget_global: "",
  zone_recherche: "",
  prochaine_action: "",
  date_prochaine_action: "",
  date_rdv: "",
  honoraires_estimes_ht: "",
  commentaire: "",
};

const EMPTY_ACTION = {
  type_action: "note",
  resume: "",
  prochaine_action: "",
  date_prochaine_action: "",
};

function auteur(profil) {
  return profil?.email || profil?.nom || profil?.prenom || profil?.role || "Profero";
}

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function txt(v) {
  return String(v || "").trim();
}

function dateOnly(v) {
  return v ? String(v).slice(0, 10) : "";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

function isLate(v) {
  return !!v && dateOnly(v) < todayIso();
}

function prospectName(p) {
  const full = `${p?.prenom || ""} ${p?.nom || ""}`.trim();
  return full || p?.societe || "Prospect sans nom";
}

function statusOf(statut) {
  if (statut === "converti") return STATUTS.find((s) => s.id === "signe");
  return STATUTS.find((s) => s.id === statut) || STATUTS[0];
}

function priorityScore(p) {
  let score = 0;

  if (p.telephone || p.email) score += 20;
  if (p.objectif) score += 20;
  if (Number(p.budget_global || 0) > 0) score += 20;
  if (p.date_rdv) score += 20;
  if (p.statut === "proposition" || p.statut === "signe" || p.statut === "converti") score += 20;

  return Math.min(100, score);
}

function temperature(p) {
  const s = priorityScore(p);
  if (p.statut === "perdu") return { label: "Perdu", color: DA };
  if (p.statut === "signe" || p.statut === "converti") return { label: "Signé", color: SU };
  if (s >= 70) return { label: "Chaud", color: DA };
  if (s >= 40) return { label: "Tiède", color: WA };
  return { label: "Froid", color: "#60A5FA" };
}

function prospectToForm(p) {
  if (!p) return { ...EMPTY_FORM };

  return {
    nom: p.nom || "",
    prenom: p.prenom || "",
    societe: p.societe || "",
    telephone: p.telephone || "",
    email: p.email || "",
    source: p.source || "",
    responsable: p.responsable || "",
    statut: p.statut || "nouveau",
    objectif: p.objectif || "",
    budget_global: p.budget_global ?? "",
    zone_recherche: p.zone_recherche || "",
    prochaine_action: p.prochaine_action || "",
    date_prochaine_action: dateOnly(p.date_prochaine_action),
    date_rdv: dateOnly(p.date_rdv),
    honoraires_estimes_ht: p.honoraires_estimes_ht ?? p.ca_potentiel_ht ?? "",
    commentaire: p.commentaire || "",
  };
}

function formToPayload(form, profil, isNew = false) {
  const honoraires = num(form.honoraires_estimes_ht);

  const payload = {
    nom: txt(form.nom),
    prenom: txt(form.prenom),
    societe: txt(form.societe),
    telephone: txt(form.telephone),
    email: txt(form.email),
    source: txt(form.source),
    responsable: txt(form.responsable),
    statut: txt(form.statut) || "nouveau",
    objectif: txt(form.objectif),
    budget_global: num(form.budget_global),
    zone_recherche: txt(form.zone_recherche),
    prochaine_action: txt(form.prochaine_action),
    date_prochaine_action: form.date_prochaine_action || null,
    date_rdv: form.date_rdv || null,
    honoraires_estimes_ht: honoraires,
    ca_potentiel_ht: honoraires,
    commentaire: txt(form.commentaire),
    updated_by: auteur(profil),
    is_deleted: false,
  };

  if (isNew) payload.created_by = auteur(profil);

  return payload;
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
        fontSize: 11,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: 4,
          color: "#8E96A8",
          fontSize: 10,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder = "" }) {
  return (
    <input
      className="inv-inp"
      type={type}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 34,
        fontSize: 13,
        textAlign: type === "number" ? "right" : "left",
      }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      className="inv-sel"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", height: 34, fontSize: 13 }}
    >
      {options.map((o) => (
        <option key={o || "empty"} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

function Kpi({ icon, label, value, color, T }) {
  return (
    <div
      className="inv-card"
      style={{
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 58,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: RADIUS.md,
          background: `${color}18`,
          color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon as={icon} size={16} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.textMuted,
            fontSize: 10,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: T.text,
            fontSize: 17,
            fontWeight: 900,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function StatusPills({ value, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
      {STATUTS.map((s) => {
        const active = value === s.id || (value === "converti" && s.id === "signe");
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            style={{
              border: `1px solid ${active ? s.color : "rgba(148,163,184,.22)"}`,
              background: active ? `${s.color}22` : "transparent",
              color: active ? s.color : "#9CA3AF",
              borderRadius: 999,
              height: 28,
              fontSize: 11,
              fontWeight: 900,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function ProspectRow({ p, selected, onClick, T }) {
  const st = statusOf(p.statut);
  const temp = temperature(p);
  const late = isLate(p.date_prochaine_action);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        border: `1px solid ${selected ? T.accent : T.border}`,
        background: selected ? T.accentBg : T.card,
        borderRadius: RADIUS.md,
        padding: "9px 10px",
        cursor: "pointer",
        textAlign: "left",
        marginBottom: 7,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.text,
              fontWeight: 900,
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {prospectName(p)}
          </div>
          <div
            style={{
              color: T.textMuted,
              fontSize: 11,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {[p.telephone, p.email].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
          </div>
        </div>

        <Badge color={st.color} T={T}>{st.label}</Badge>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          marginTop: 8,
          alignItems: "center",
        }}
      >
        <div style={{ color: late ? DA : T.textSub, fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={Clock} size={11} />
          {p.prochaine_action || "Aucune action"}
          {p.date_prochaine_action ? ` · ${fmtDate(p.date_prochaine_action)}` : ""}
        </div>

        <Badge color={temp.color} T={T}>{temp.label}</Badge>
      </div>
    </button>
  );
}

function ActionRow({ action, T }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ color: T.text, fontWeight: 900, fontSize: 12 }}>
          {action.type_action || "note"}
        </div>
        <div style={{ color: T.textMuted, fontSize: 11 }}>
          {fmtDate(action.date_action)}
        </div>
      </div>
      <div style={{ color: T.textSub, fontSize: 12, marginTop: 3, lineHeight: 1.35 }}>
        {action.resume}
      </div>
    </div>
  );
}

export default function Prospection({ profil, T = THEMES_INV.dark }) {
  const [prospects, setProspects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [actions, setActions] = useState([]);
  const [actionForm, setActionForm] = useState({ ...EMPTY_ACTION });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const loadProspects = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .select("*")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false });

    if (err) {
      setError(err.message || "Erreur de chargement");
      setProspects([]);
    } else {
      setProspects(data || []);
    }

    setLoading(false);
  }, []);

  const loadActions = useCallback(async (id) => {
    if (!id) {
      setActions([]);
      return;
    }

    const { data } = await supabase
      .from("invest_prospect_actions")
      .select("*")
      .eq("prospect_id", id)
      .order("date_action", { ascending: false })
      .limit(6);

    setActions(data || []);
  }, []);

  useEffect(() => {
    loadProspects();
  }, [loadProspects]);

  useEffect(() => {
    loadActions(selected?.id);
  }, [selected?.id, loadActions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return prospects.filter((p) => {
      const haystack = [
        p.nom,
        p.prenom,
        p.societe,
        p.telephone,
        p.email,
        p.source,
        p.responsable,
        p.objectif,
        p.zone_recherche,
      ].join(" ").toLowerCase();

      const okQ = !q || haystack.includes(q);
      const okStatus = !statusFilter || p.statut === statusFilter || (statusFilter === "signe" && p.statut === "converti");

      return okQ && okStatus;
    });
  }, [prospects, query, statusFilter]);

  const stats = useMemo(() => {
    const actifs = prospects.filter((p) => !["perdu", "converti", "signe"].includes(p.statut)).length;
    const rdv = prospects.filter((p) => p.date_rdv && dateOnly(p.date_rdv) >= todayIso()).length;
    const relances = prospects.filter((p) => isLate(p.date_prochaine_action) && !["perdu", "converti"].includes(p.statut)).length;
    const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);

    return { actifs, rdv, relances, ca };
  }, [prospects]);

  const selectProspect = (p) => {
    setSelected(p);
    setForm(prospectToForm(p));
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const newProspect = () => {
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      responsable: profil?.prenom || profil?.nom || "",
      prochaine_action: "Appeler",
      date_prochaine_action: todayIso(),
    });
    setActions([]);
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const saveProspect = async () => {
    setSaving(true);
    setMsg("");
    setError("");

    const isNew = !selected?.id;
    const payload = formToPayload(form, profil, isNew);

    if (!payload.nom && !payload.prenom && !payload.societe) {
      setError("Renseigne au minimum un prénom, un nom ou une société.");
      setSaving(false);
      return;
    }

    let res;

    if (isNew) {
      res = await supabase
        .from("invest_prospects")
        .insert(payload)
        .select("*")
        .single();
    } else {
      res = await supabase
        .from("invest_prospects")
        .update(payload)
        .eq("id", selected.id)
        .select("*")
        .single();
    }

    if (res.error) {
      setError(res.error.message || "Erreur de sauvegarde.");
      setSaving(false);
      return;
    }

    setSelected(res.data);
    setForm(prospectToForm(res.data));
    await loadProspects();

    setSaving(false);
    setMsg(isNew ? "Prospect créé." : "Prospect sauvegardé.");
    setTimeout(() => setMsg(""), 2000);
  };

  const quickStatus = async (statut) => {
    setField("statut", statut);

    if (!selected?.id) return;

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .update({
        statut,
        updated_by: auteur(profil),
      })
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

  const setQuickFollowUp = (label, days) => {
    setField("prochaine_action", label);
    setField("date_prochaine_action", addDays(days));
  };

  const addAction = async () => {
    if (!selected?.id) {
      setError("Sauvegarde d'abord le prospect.");
      return;
    }

    if (!actionForm.resume.trim()) {
      setError("Écris une courte note d'action.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      prospect_id: selected.id,
      created_by: auteur(profil),
      type_action: actionForm.type_action || "note",
      resume: actionForm.resume.trim(),
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

    if (payload.prochaine_action || payload.date_prochaine_action) {
      const { data } = await supabase
        .from("invest_prospects")
        .update({
          prochaine_action: payload.prochaine_action || selected.prochaine_action,
          date_prochaine_action: payload.date_prochaine_action || selected.date_prochaine_action,
          updated_by: auteur(profil),
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
    setTimeout(() => setMsg(""), 1800);
  };

  const softDelete = async () => {
    if (!selected?.id) return;
    if (!window.confirm("Masquer ce prospect ?")) return;

    const { error: err } = await supabase
      .from("invest_prospects")
      .update({
        is_deleted: true,
        updated_by: auteur(profil),
      })
      .eq("id", selected.id);

    if (err) {
      setError(err.message);
      return;
    }

    setSelected(null);
    setForm({ ...EMPTY_FORM });
    setActions([]);
    await loadProspects();
  };

  const convertClient = async () => {
    if (!selected?.id) return;

    const payloadProspect = formToPayload(form, profil, false);
    const prospect = { ...selected, ...payloadProspect };

    if (!prospect.nom && !prospect.prenom) {
      setError("Conversion impossible : renseigne au minimum prénom ou nom.");
      return;
    }

    if (!prospect.telephone && !prospect.email) {
      setError("Conversion impossible : renseigne au minimum téléphone ou email.");
      return;
    }

    if (!window.confirm("Convertir ce prospect en client ?")) return;

    setSaving(true);
    setError("");

    const clientPayloads = [
      {
        nom: prospect.nom || "",
        prenom: prospect.prenom || "",
        telephone: prospect.telephone || "",
        email: prospect.email || "",
        source: prospect.source || "CRM Prospection",
        statut: "actif",
        etape: "1. Signature contrat",
        budget: prospect.budget_global || null,
        date_signature: todayIso(),
        strategie_data: {
          origine: "CRM Prospection",
          prospect_id: selected.id,
          objectif: prospect.objectif || "",
          budget_max: prospect.budget_global || null,
          zones: prospect.zone_recherche || "",
          remarques: prospect.commentaire || "",
        },
        created_by: auteur(profil),
      },
      {
        nom: prospect.nom || "",
        prenom: prospect.prenom || "",
        telephone: prospect.telephone || "",
        email: prospect.email || "",
        budget: prospect.budget_global || null,
      },
      {
        nom: prospect.nom || "",
        prenom: prospect.prenom || "",
      },
    ];

    let client = null;
    let lastError = null;

    for (const clientPayload of clientPayloads) {
      const { data, error: err } = await supabase
        .from("invest_clients")
        .insert(clientPayload)
        .select("id")
        .single();

      if (!err) {
        client = data;
        lastError = null;
        break;
      }

      lastError = err;

      if (err.code !== "42703") break;
    }

    if (!client?.id) {
      setSaving(false);
      setError(lastError?.message || "Conversion impossible.");
      return;
    }

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .update({
        statut: "converti",
        converted_client_id: client.id,
        converted_at: new Date().toISOString(),
        updated_by: auteur(profil),
      })
      .eq("id", selected.id)
      .select("*")
      .single();

    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }

    setSelected(data);
    setForm(prospectToForm(data));
    await loadProspects();

    setSaving(false);
    setMsg("Prospect converti en client.");
    setTimeout(() => setMsg(""), 2200);
  };

  const callLink = form.telephone ? `tel:${form.telephone}` : null;
  const mailLink = form.email ? `mailto:${form.email}` : null;
  const waLink = form.telephone ? `https://wa.me/${String(form.telephone).replace(/\D/g, "")}` : null;

  return (
    <div style={{ padding: "16px 18px", maxWidth: 1500, margin: "0 auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          alignItems: "start",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ color: T.text, fontSize: 24, fontWeight: 900, marginBottom: 3 }}>
            CRM Prospection
          </div>
          <div style={{ color: T.textSub, fontSize: 13 }}>
            Simple, rapide, orienté action : qui est le prospect, où il en est, quelle est la prochaine action.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="inv-btn inv-btn-out" type="button" onClick={loadProspects} disabled={loading}>
            <Icon as={RefreshCw} size={14} />
            Actualiser
          </button>
          <button className="inv-btn inv-btn-blue" type="button" onClick={newProspect}>
            <Icon as={UserPlus} size={14} />
            Nouveau prospect
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: `${DA}12`, color: DA, borderRadius: RADIUS.md, padding: 10, marginBottom: 10, fontWeight: 800 }}>
          {error}
        </div>
      )}

      {msg && (
        <div style={{ background: `${SU}12`, color: SU, borderRadius: RADIUS.md, padding: 10, marginBottom: 10, fontWeight: 900 }}>
          {msg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
        <Kpi icon={Users} label="Prospects actifs" value={stats.actifs} color="#60A5FA" T={T} />
        <Kpi icon={Calendar} label="RDV à venir" value={stats.rdv} color="#8B5CF6" T={T} />
        <Kpi icon={Clock} label="Relances en retard" value={stats.relances} color={stats.relances > 0 ? DA : SU} T={T} />
        <Kpi icon={Euro} label="CA potentiel" value={fmtDashboardEur(stats.ca)} color={SU} T={T} />
      </div>

      <div className="inv-card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <Icon as={Search} size={14} style={{ position: "absolute", left: 10, top: 10, color: T.textMuted }} />
            <input
              className="inv-inp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un prospect..."
              style={{ width: "100%", height: 34, paddingLeft: 32 }}
            />
          </div>

          <select
            className="inv-sel"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: "100%", height: 34 }}
          >
            <option value="">Tous les statuts</option>
            {STATUTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, alignItems: "start" }}>
        <div className="inv-card" style={{ padding: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5, marginBottom: 10 }}>
            {STATUTS.map((s) => {
              const IconStatus = s.icon;
              const count = filtered.filter((p) => p.statut === s.id || (s.id === "signe" && p.statut === "converti")).length;
              const active = statusFilter === s.id;

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(active ? "" : s.id)}
                  title={s.label}
                  style={{
                    border: `1px solid ${active ? s.color : T.border}`,
                    background: active ? `${s.color}20` : T.cardHover,
                    borderRadius: RADIUS.md,
                    color: active ? s.color : T.textMuted,
                    cursor: "pointer",
                    padding: "7px 4px",
                    minWidth: 0,
                  }}
                >
                  <Icon as={IconStatus} size={14} />
                  <div style={{ fontSize: 10, fontWeight: 900, marginTop: 2 }}>{count}</div>
                </button>
              );
            })}
          </div>

          <div style={{ maxHeight: "calc(100vh - 258px)", overflowY: "auto", paddingRight: 2 }}>
            {loading ? (
              <div style={{ color: T.textMuted, textAlign: "center", padding: 18 }}>Chargement...</div>
            ) : filtered.length === 0 ? (
              <div style={{ color: T.textMuted, textAlign: "center", padding: 18 }}>Aucun prospect</div>
            ) : (
              filtered.map((p) => (
                <ProspectRow
                  key={p.id}
                  p={p}
                  selected={selected?.id === p.id}
                  onClick={() => selectProspect(p)}
                  T={T}
                />
              ))
            )}
          </div>
        </div>

        <div className="inv-card" style={{ padding: 0, minHeight: 500 }}>
          <div
            className="inv-card-hd blue"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon as={selected?.id ? Pencil : UserPlus} size={13} />
              {selected?.id ? prospectName(selected) : "Fiche prospect"}
            </span>

            <div style={{ display: "flex", gap: 6 }}>
              {selected?.id && <Badge color={temperature(selected).color} T={T}>{temperature(selected).label}</Badge>}
              <button
                className="inv-btn inv-btn-out inv-btn-sm"
                type="button"
                onClick={() => {
                  setSelected(null);
                  setForm({ ...EMPTY_FORM });
                  setActions([]);
                }}
              >
                <Icon as={X} size={12} />
              </button>
            </div>
          </div>

          <div className="inv-card-bd" style={{ padding: 12 }}>
            {!selected && !form.nom && !form.prenom && !form.societe ? (
              <div style={{ textAlign: "center", padding: 50, color: T.textMuted }}>
                Sélectionne un prospect ou clique sur “Nouveau prospect”.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <StatusPills value={form.statut} onChange={quickStatus} />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <Field label="Prénom">
                    <Input value={form.prenom} onChange={(v) => setField("prenom", v)} />
                  </Field>

                  <Field label="Nom">
                    <Input value={form.nom} onChange={(v) => setField("nom", v)} />
                  </Field>

                  <Field label="Téléphone">
                    <Input value={form.telephone} onChange={(v) => setField("telephone", v)} />
                  </Field>

                  <Field label="Email">
                    <Input value={form.email} onChange={(v) => setField("email", v)} />
                  </Field>

                  <Field label="Source">
                    <Select value={form.source} onChange={(v) => setField("source", v)} options={SOURCES} />
                  </Field>

                  <Field label="Responsable">
                    <Input value={form.responsable} onChange={(v) => setField("responsable", v)} />
                  </Field>

                  <Field label="Objectif">
                    <Select value={form.objectif} onChange={(v) => setField("objectif", v)} options={OBJECTIFS} />
                  </Field>

                  <Field label="Budget">
                    <Select value={String(form.budget_global || "")} onChange={(v) => setField("budget_global", v)} options={BUDGETS_RAPIDES} />
                  </Field>

                  <Field label="Zone">
                    <Input value={form.zone_recherche} onChange={(v) => setField("zone_recherche", v)} placeholder="Angers, 49..." />
                  </Field>

                  <Field label="Honoraires HT">
                    <Input type="number" value={form.honoraires_estimes_ht} onChange={(v) => setField("honoraires_estimes_ht", v)} />
                  </Field>

                  <Field label="RDV">
                    <Input type="date" value={form.date_rdv} onChange={(v) => setField("date_rdv", v)} />
                  </Field>

                  <Field label="Prochaine relance">
                    <Input type="date" value={form.date_prochaine_action} onChange={(v) => setField("date_prochaine_action", v)} />
                  </Field>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 230px",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <Field label="Prochaine action">
                    <Select value={form.prochaine_action} onChange={(v) => setField("prochaine_action", v)} options={PROCHAINES_ACTIONS} />
                  </Field>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, alignItems: "end" }}>
                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp("Relancer", 2)}>J+2</button>
                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp("Relancer", 7)}>J+7</button>
                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp("Relancer", 15)}>J+15</button>
                  </div>
                </div>

                <Field label="Note simple">
                  <textarea
                    className="inv-textarea"
                    value={form.commentaire || ""}
                    onChange={(e) => setField("commentaire", e.target.value)}
                    rows={3}
                    placeholder="Résumé rapide : besoin, échange, frein, suite à donner..."
                    style={{ width: "100%", fontSize: 13 }}
                  />
                </Field>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    alignItems: "center",
                    marginTop: 10,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {callLink && (
                      <a className="inv-btn inv-btn-out inv-btn-sm" href={callLink}>
                        <Icon as={Phone} size={12} />
                        Appeler
                      </a>
                    )}
                    {mailLink && (
                      <a className="inv-btn inv-btn-out inv-btn-sm" href={mailLink}>
                        <Icon as={Mail} size={12} />
                        Email
                      </a>
                    )}
                    {waLink && (
                      <a className="inv-btn inv-btn-out inv-btn-sm" href={waLink} target="_blank" rel="noreferrer">
                        <Icon as={MessageCircle} size={12} />
                        WhatsApp
                      </a>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 7 }}>
                    <button className="inv-btn inv-btn-blue" type="button" onClick={saveProspect} disabled={saving}>
                      <Icon as={Save} size={14} />
                      {saving ? "..." : "Sauvegarder"}
                    </button>

                    {selected?.id && (
                      <button className="inv-btn inv-btn-gold" type="button" onClick={convertClient} disabled={saving || form.statut === "converti"}>
                        <Icon as={ArrowRight} size={14} />
                        Client
                      </button>
                    )}

                    {selected?.id && (
                      <button className="inv-btn inv-btn-out" type="button" onClick={softDelete}>
                        <Icon as={Trash2} size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {selected?.id && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 330px",
                      gap: 12,
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: 12,
                    }}
                  >
                    <div>
                      <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 7 }}>
                        Ajouter une action
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 110px", gap: 7 }}>
                        <select
                          className="inv-sel"
                          value={actionForm.type_action}
                          onChange={(e) => setActionForm((p) => ({ ...p, type_action: e.target.value }))}
                          style={{ height: 34 }}
                        >
                          <option value="note">Note</option>
                          <option value="appel">Appel</option>
                          <option value="email">Email</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="rdv">RDV</option>
                          <option value="relance">Relance</option>
                        </select>

                        <input
                          className="inv-inp"
                          value={actionForm.resume}
                          onChange={(e) => setActionForm((p) => ({ ...p, resume: e.target.value }))}
                          placeholder="Ex : Appel effectué, prospect intéressé, relance prévue..."
                          style={{ height: 34 }}
                        />

                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={addAction} disabled={saving}>
                          Ajouter
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ color: T.text, fontSize: 13, fontWeight: 900, marginBottom: 7 }}>
                        Dernières actions
                      </div>

                      <div style={{ maxHeight: 142, overflowY: "auto" }}>
                        {actions.length === 0 ? (
                          <div style={{ color: T.textMuted, fontSize: 12, padding: 10, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
                            Aucune action.
                          </div>
                        ) : (
                          actions.map((a) => <ActionRow key={a.id} action={a} T={T} />)
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
