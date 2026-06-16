import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  GripVertical,
  Copy,
  Flame,
  AlertTriangle,
  Upload,
  CalendarDays,
  ListChecks,
} from "lucide-react";

/**
 * CRM Prospection — Version simple + Drag & Drop + relances + conversion sécurisée + import + planning
 *
 * Objectif :
 * - CRM volontairement simple
 * - Statuts en colonnes
 * - Déplacement des prospects par drag & drop
 * - Sauvegarde automatique du statut dans Supabase
 * - Fiche prospect compacte à droite
 * - Filtres rapides : à traiter, en retard, RDV, prospects chauds
 * - Messages commerciaux prêts à copier
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

function isTodayOrLate(v) {
  return !!v && dateOnly(v) <= todayIso();
}

function isActiveProspect(p) {
  return !["perdu", "converti", "signe"].includes(p?.statut);
}

function compareActionDate(a, b) {
  const da = a?.date_prochaine_action ? new Date(a.date_prochaine_action).getTime() : Number.MAX_SAFE_INTEGER;
  const db = b?.date_prochaine_action ? new Date(b.date_prochaine_action).getTime() : Number.MAX_SAFE_INTEGER;
  return da - db;
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

function messageRelance(p) {
  const prenom = p?.prenom || "";
  return `Bonjour ${prenom},\n\nJe me permets de revenir vers vous concernant votre projet d'investissement immobilier.\n\nAvez-vous toujours le souhait d'avancer sur ce sujet ?\n\nJe reste disponible pour échanger et vous accompagner dans la structuration du projet.\n\nBien cordialement,\nProfero Invest`;
}

function messageConfirmationRdv(p) {
  const prenom = p?.prenom || "";
  const rdv = p?.date_rdv ? fmtDate(p.date_rdv) : "la date convenue";
  return `Bonjour ${prenom},\n\nJe vous confirme notre rendez-vous prévu le ${rdv} concernant votre projet d'investissement immobilier.\n\nL'objectif sera de faire le point sur votre situation, vos objectifs, votre budget et la meilleure stratégie à mettre en place.\n\nBien cordialement,\nProfero Invest`;
}

function messageProposition(p) {
  const prenom = p?.prenom || "";
  return `Bonjour ${prenom},\n\nSuite à nos échanges, je vous confirme que votre projet semble cohérent avec l'accompagnement Profero Invest.\n\nNous pouvons vous accompagner sur la stratégie, la recherche du bien, l'analyse de rentabilité, la négociation, le financement et le suivi du projet.\n\nJe reste disponible pour vous présenter la proposition d'accompagnement.\n\nBien cordialement,\nProfero Invest`;
}

function stripAccents(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeImportKey(k) {
  const key = stripAccents(k)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const aliases = {
    prenom: "prenom",
    first_name: "prenom",
    firstname: "prenom",
    nom: "nom",
    last_name: "nom",
    lastname: "nom",
    name: "nom",
    full_name: "nom_complet",
    nom_complet: "nom_complet",
    prospect: "nom_complet",
    societe: "societe",
    entreprise: "societe",
    telephone: "telephone",
    tel: "telephone",
    phone: "telephone",
    mobile: "telephone",
    email: "email",
    mail: "email",
    source: "source",
    origine: "source",
    responsable: "responsable",
    commercial: "responsable",
    objectif: "objectif",
    projet: "objectif",
    budget: "budget_global",
    budget_global: "budget_global",
    zone: "zone_recherche",
    ville: "zone_recherche",
    secteur: "zone_recherche",
    zone_recherche: "zone_recherche",
    prochaine_action: "prochaine_action",
    action: "prochaine_action",
    relance: "date_prochaine_action",
    date_relance: "date_prochaine_action",
    date_prochaine_action: "date_prochaine_action",
    rdv: "date_rdv",
    date_rdv: "date_rdv",
    rendez_vous: "date_rdv",
    honoraires: "honoraires_estimes_ht",
    honoraires_ht: "honoraires_estimes_ht",
    honoraires_estimes_ht: "honoraires_estimes_ht",
    commentaire: "commentaire",
    note: "commentaire",
    notes: "commentaire",
    statut: "statut",
  };

  return aliases[key] || key;
}

function parseCSVLine(line, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out;
}

function normalizeImportedRow(row) {
  const normalized = {};

  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = normalizeImportKey(key);
    const cleanValue = typeof value === "string" ? value.trim() : value;

    if (cleanValue !== undefined && cleanValue !== null && String(cleanValue).trim() !== "") {
      normalized[cleanKey] = cleanValue;
    }
  });

  if (normalized.nom_complet && !normalized.nom && !normalized.prenom) {
    const parts = String(normalized.nom_complet).trim().split(/\s+/);
    normalized.prenom = parts.shift() || "";
    normalized.nom = parts.join(" ");
  }

  if (!normalized.nom && !normalized.prenom && normalized.email) {
    normalized.nom = String(normalized.email).split("@")[0];
  }

  if (!normalized.nom && !normalized.prenom && normalized.telephone) {
    normalized.nom = "Prospect importé";
  }

  if (normalized.statut) {
    const status = stripAccents(normalized.statut).toLowerCase();
    if (status.includes("contact")) normalized.statut = "contact";
    else if (status.includes("rdv") || status.includes("rendez")) normalized.statut = "rdv";
    else if (status.includes("proposition")) normalized.statut = "proposition";
    else if (status.includes("sign")) normalized.statut = "signe";
    else if (status.includes("perdu")) normalized.statut = "perdu";
    else normalized.statut = "nouveau";
  }

  return normalized;
}

function parseCSV(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const headers = parseCSVLine(firstLine, delimiter).map(normalizeImportKey);

  return lines.slice(1)
    .map((line) => {
      const values = parseCSVLine(line, delimiter);
      const row = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || "";
      });
      return normalizeImportedRow(row);
    })
    .filter((p) => p.nom || p.prenom || p.societe || p.email || p.telephone);
}

function extractLabeledValue(content, labels) {
  for (const label of labels) {
    const rx = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*(.+)`, "i");
    const match = String(content || "").match(rx);
    if (match?.[1]) return match[1].split(/\n/)[0].trim();
  }
  return "";
}

function parseTextProspect(content) {
  const raw = String(content || "");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const telephone = raw.match(/(?:\+33|0033|0)[\d\s.\-()]{8,}/)?.[0] || "";

  const explicitPrenom = extractLabeledValue(raw, ["prenom", "prénom", "first name"]);
  const explicitNom = extractLabeledValue(raw, ["nom", "name", "last name"]);
  const explicitFullName = extractLabeledValue(raw, ["prospect", "client", "nom complet"]);

  let prenom = explicitPrenom;
  let nom = explicitNom;

  if (!prenom && !nom) {
    const nameLine = explicitFullName || lines.find((line) => {
      const l = stripAccents(line).toLowerCase();
      return !l.includes("@")
        && !l.includes("tel")
        && !l.includes("mail")
        && !l.includes("budget")
        && !l.includes("source")
        && !l.includes("objectif")
        && !l.includes("zone")
        && !l.includes("note")
        && !/^begin:vcard/i.test(l)
        && !/^version:/i.test(l)
        && !/^fn:/i.test(l)
        && line.length <= 80;
    }) || "";

    const cleaned = nameLine.replace(/^(nom|prospect|client)\s*[:\-]\s*/i, "").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    prenom = parts.shift() || "";
    nom = parts.join(" ");
  }

  const prospect = normalizeImportedRow({
    prenom,
    nom,
    telephone,
    email,
    source: extractLabeledValue(raw, ["source", "origine"]),
    responsable: extractLabeledValue(raw, ["responsable", "commercial"]),
    objectif: extractLabeledValue(raw, ["objectif", "projet"]),
    budget_global: extractLabeledValue(raw, ["budget", "budget global"]),
    zone_recherche: extractLabeledValue(raw, ["zone", "ville", "secteur"]),
    prochaine_action: extractLabeledValue(raw, ["prochaine action", "action"]),
    date_prochaine_action: extractLabeledValue(raw, ["date relance", "relance"]),
    date_rdv: extractLabeledValue(raw, ["rdv", "date rdv", "rendez-vous"]),
    honoraires_estimes_ht: extractLabeledValue(raw, ["honoraires", "honoraires ht"]),
    commentaire: extractLabeledValue(raw, ["note", "commentaire"]) || raw.slice(0, 1200),
  });

  return prospect.nom || prospect.prenom || prospect.email || prospect.telephone ? [prospect] : [];
}

function parseVCard(content) {
  const cards = String(content || "")
    .split(/BEGIN:VCARD/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const prospects = cards.map((card) => {
    const fn = card.match(/^FN:(.+)$/im)?.[1]?.trim() || "";
    const email = card.match(/^EMAIL[^:]*:(.+)$/im)?.[1]?.trim() || "";
    const telephone = card.match(/^TEL[^:]*:(.+)$/im)?.[1]?.trim() || "";

    const parts = fn.split(/\s+/).filter(Boolean);
    const prenom = parts.shift() || "";
    const nom = parts.join(" ");

    return normalizeImportedRow({
      prenom,
      nom,
      email,
      telephone,
      source: "Import contact",
      prochaine_action: "Appeler",
    });
  });

  return prospects.filter((p) => p.nom || p.prenom || p.email || p.telephone);
}

function parseImportedProspects(content, fileName = "") {
  const lower = String(fileName || "").toLowerCase();
  const raw = String(content || "").trim();

  if (!raw) return [];

  if (lower.endsWith(".vcf") || raw.includes("BEGIN:VCARD")) {
    const vcards = parseVCard(raw);
    if (vcards.length) return vcards;
  }

  if (lower.endsWith(".json") || raw.startsWith("{") || raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.prospects)
        ? parsed.prospects
        : Array.isArray(parsed.data)
          ? parsed.data
          : [parsed];

    return arr
      .map(normalizeImportedRow)
      .filter((p) => p.nom || p.prenom || p.societe || p.email || p.telephone);
  }

  if (lower.endsWith(".csv") || raw.split(/\r?\n/)[0]?.includes(";") || raw.split(/\r?\n/)[0]?.includes(",")) {
    const csv = parseCSV(raw);
    if (csv.length) return csv;
  }

  return parseTextProspect(raw);
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

function QuickFilterButton({ active, icon, label, count, color, onClick, T }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? color : T.border}`,
        background: active ? `${color}18` : T.cardHover,
        color: active ? color : T.textSub,
        borderRadius: RADIUS.md,
        padding: "7px 9px",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 900,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
      }}
    >
      <Icon as={icon} size={13} />
      {label}
      {typeof count === "number" && <span style={{ fontFamily: "'DM Mono', monospace" }}>{count}</span>}
    </button>
  );
}

function ProspectDragCard({ p, selected, onClick, onDragStart, onDragEnd, T }) {
  const temp = temperature(p);
  const late = isLate(p.date_prochaine_action);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => onDragStart(e, p)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title="Glisser-déposer dans une autre colonne pour changer le statut"
      style={{
        width: "100%",
        border: `1px solid ${selected ? T.accent : T.border}`,
        background: selected ? T.accentBg : T.card,
        borderRadius: RADIUS.md,
        padding: "8px 8px",
        cursor: "grab",
        textAlign: "left",
        marginBottom: 7,
        boxShadow: selected ? `0 0 0 1px ${T.accent}30` : "none",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 6, alignItems: "start" }}>
        <div style={{ color: T.textMuted, paddingTop: 2 }}>
          <Icon as={GripVertical} size={13} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.text,
              fontWeight: 900,
              fontSize: 12,
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
              fontSize: 10.5,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {[p.telephone, p.email].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 6,
              alignItems: "center",
              marginTop: 7,
            }}
          >
            <div style={{ color: late ? DA : T.textSub, fontSize: 10.5, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <Icon as={Clock} size={10} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.prochaine_action || "Aucune action"}
                {p.date_prochaine_action ? ` · ${fmtDate(p.date_prochaine_action)}` : ""}
              </span>
            </div>

            <Badge color={temp.color} T={T}>{temp.label}</Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

function PipelineColumn({
  statut,
  prospects,
  selectedId,
  dragOverStatus,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  T,
}) {
  const IconStatus = statut.icon;
  const activeDrop = dragOverStatus === statut.id;

  return (
    <div
      onDragOver={(e) => onDragOver(e, statut.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, statut.id)}
      style={{
        background: activeDrop ? `${statut.color}14` : T.cardHover,
        border: `1px solid ${activeDrop ? statut.color : T.border}`,
        borderTop: `3px solid ${statut.color}`,
        borderRadius: RADIUS.lg,
        padding: 8,
        minHeight: 182,
        transition: "all .12s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: RADIUS.md,
              background: `${statut.color}18`,
              color: statut.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon as={IconStatus} size={13} />
          </div>

          <div
            style={{
              color: T.text,
              fontSize: 12,
              fontWeight: 900,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {statut.label}
          </div>
        </div>

        <Badge color={statut.color} T={T}>{prospects.length}</Badge>
      </div>

      <div style={{ minHeight: 112 }}>
        {prospects.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${activeDrop ? statut.color : T.border}`,
              borderRadius: RADIUS.md,
              color: activeDrop ? statut.color : T.textMuted,
              fontSize: 11,
              textAlign: "center",
              padding: "18px 8px",
            }}
          >
            Déposer ici
          </div>
        ) : (
          prospects.map((p) => (
            <ProspectDragCard
              key={p.id}
              p={p}
              selected={selectedId === p.id}
              onClick={() => onSelect(p)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              T={T}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlanningMiniCard({ p, onClick, selected, T }) {
  const temp = temperature(p);
  const late = isLate(p.date_prochaine_action);

  return (
    <button
      type="button"
      onClick={() => onClick(p)}
      style={{
        width: "100%",
        border: `1px solid ${selected ? T.accent : T.border}`,
        background: selected ? T.accentBg : T.card,
        borderRadius: RADIUS.md,
        padding: "7px 8px",
        cursor: "pointer",
        textAlign: "left",
        marginBottom: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div
          style={{
            color: T.text,
            fontSize: 12,
            fontWeight: 900,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {prospectName(p)}
        </div>
        <Badge color={temp.color} T={T}>{temp.label}</Badge>
      </div>

      <div
        style={{
          color: late ? DA : T.textSub,
          fontSize: 10.5,
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
        }}
      >
        <Icon as={ListChecks} size={10} />
        <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {p.prochaine_action || "Action à définir"}
          {p.date_prochaine_action ? ` · ${fmtDate(p.date_prochaine_action)}` : ""}
        </span>
      </div>
    </button>
  );
}

function PlanningBucket({ title, subtitle, icon, color, items, onSelect, selectedId, T }) {
  const IconBucket = icon;

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        background: T.cardHover,
        borderRadius: RADIUS.lg,
        padding: 9,
        minHeight: 130,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: RADIUS.md,
                background: `${color}18`,
                color,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon as={IconBucket} size={13} />
            </span>
            <span style={{ color: T.text, fontSize: 12, fontWeight: 900 }}>{title}</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 10.5, marginTop: 3 }}>{subtitle}</div>
        </div>

        <Badge color={color} T={T}>{items.length}</Badge>
      </div>

      <div style={{ maxHeight: 128, overflowY: "auto", paddingRight: 2 }}>
        {items.length === 0 ? (
          <div
            style={{
              color: T.textMuted,
              fontSize: 11,
              border: `1px dashed ${T.border}`,
              borderRadius: RADIUS.md,
              padding: "18px 8px",
              textAlign: "center",
            }}
          >
            Rien à faire
          </div>
        ) : (
          items.slice(0, 6).map((p) => (
            <PlanningMiniCard
              key={p.id}
              p={p}
              onClick={onSelect}
              selected={selectedId === p.id}
              T={T}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlanningPanel({ buckets, onSelect, selectedId, T }) {
  return (
    <div className="inv-card" style={{ padding: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
        <div>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon as={CalendarDays} size={15} />
            Planning commercial
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>
            Visualisation rapide des personnes à contacter et des prochaines actions
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {buckets.map((bucket) => (
          <PlanningBucket
            key={bucket.id}
            {...bucket}
            onSelect={onSelect}
            selectedId={selectedId}
            T={T}
          />
        ))}
      </div>
    </div>
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
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [actions, setActions] = useState([]);
  const [actionForm, setActionForm] = useState({ ...EMPTY_ACTION });

  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStatus, setDragOverStatus] = useState(null);

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

  const stats = useMemo(() => {
    const actifs = prospects.filter((p) => !["perdu", "converti", "signe"].includes(p.statut)).length;
    const rdv = prospects.filter((p) => p.date_rdv && dateOnly(p.date_rdv) >= todayIso()).length;
    const relances = prospects.filter((p) => isLate(p.date_prochaine_action) && !["perdu", "converti"].includes(p.statut)).length;
    const today = prospects.filter((p) => isTodayOrLate(p.date_prochaine_action) && !["perdu", "converti", "signe"].includes(p.statut)).length;
    const hot = prospects.filter((p) => temperature(p).label === "Chaud" && !["perdu", "converti", "signe"].includes(p.statut)).length;
    const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);

    return { actifs, rdv, relances, today, hot, ca };
  }, [prospects]);

  const planningBuckets = useMemo(() => {
    const today = todayIso();
    const tomorrow = addDays(1);
    const week = addDays(7);

    const active = prospects
      .filter(isActiveProspect)
      .slice()
      .sort(compareActionDate);

    return [
      {
        id: "late",
        title: "En retard",
        subtitle: "À traiter en priorité",
        icon: AlertTriangle,
        color: DA,
        items: active.filter((p) => p.date_prochaine_action && dateOnly(p.date_prochaine_action) < today),
      },
      {
        id: "today",
        title: "Aujourd'hui",
        subtitle: "À contacter maintenant",
        icon: Clock,
        color: WA,
        items: active.filter((p) => dateOnly(p.date_prochaine_action) === today),
      },
      {
        id: "tomorrow",
        title: "Demain",
        subtitle: "Actions prévues demain",
        icon: Calendar,
        color: "#8B5CF6",
        items: active.filter((p) => dateOnly(p.date_prochaine_action) === tomorrow),
      },
      {
        id: "week",
        title: "7 prochains jours",
        subtitle: "À anticiper",
        icon: CalendarDays,
        color: SU,
        items: active.filter((p) => {
          const d = dateOnly(p.date_prochaine_action);
          return d > tomorrow && d <= week;
        }),
      },
    ];
  }, [prospects]);

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

      const okQuery = !q || haystack.includes(q);

      let okQuick = true;
      if (quickFilter === "today") {
        okQuick = isTodayOrLate(p.date_prochaine_action) && !["perdu", "converti", "signe"].includes(p.statut);
      }
      if (quickFilter === "late") {
        okQuick = isLate(p.date_prochaine_action) && !["perdu", "converti", "signe"].includes(p.statut);
      }
      if (quickFilter === "rdv") {
        okQuick = !!p.date_rdv && dateOnly(p.date_rdv) >= todayIso();
      }
      if (quickFilter === "hot") {
        okQuick = temperature(p).label === "Chaud" && !["perdu", "converti", "signe"].includes(p.statut);
      }

      return okQuery && okQuick;
    });
  }, [prospects, query, quickFilter]);

  const grouped = useMemo(() => {
    return STATUTS.map((s) => ({
      statut: s,
      prospects: filtered.filter((p) => p.statut === s.id || (s.id === "signe" && p.statut === "converti")),
    }));
  }, [filtered]);

  const selectProspect = (p) => {
    setIsCreating(false);
    setSelected(p);
    setForm(prospectToForm(p));
    setActionForm({ ...EMPTY_ACTION });
    setMsg("");
    setError("");
  };

  const newProspect = () => {
    setIsCreating(true);
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

  const handleImportProspects = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError("");
    setMsg("");

    try {
      const content = await file.text();
      const parsed = parseImportedProspects(content, file.name);

      if (!parsed.length) {
        setError("Import impossible : aucun prospect reconnu dans le fichier.");
        setImporting(false);
        event.target.value = "";
        return;
      }

      if (parsed.length > 1) {
        const ok = window.confirm(`${parsed.length} prospects détectés. Souhaites-tu les importer ?`);
        if (!ok) {
          setImporting(false);
          event.target.value = "";
          return;
        }
      }

      const payloads = parsed.map((p) => {
        const merged = {
          ...EMPTY_FORM,
          ...p,
          statut: p.statut || "nouveau",
          responsable: p.responsable || profil?.prenom || profil?.nom || "",
          prochaine_action: p.prochaine_action || "Appeler",
          date_prochaine_action: p.date_prochaine_action || todayIso(),
        };

        const payload = formToPayload(merged, profil, true);

        if (!payload.nom && !payload.prenom && !payload.societe) {
          payload.nom = "Prospect importé";
        }

        payload.donnees = {
          import_source_file: file.name,
          import_date: new Date().toISOString(),
        };

        return payload;
      });

      const { data, error: err } = await supabase
        .from("invest_prospects")
        .insert(payloads)
        .select("*");

      if (err) {
        setError(err.message || "Erreur pendant l'import.");
        setImporting(false);
        event.target.value = "";
        return;
      }

      await loadProspects();

      if (data?.length === 1) {
        setIsCreating(false);
        setSelected(data[0]);
        setForm(prospectToForm(data[0]));
      }

      setMsg(data?.length > 1 ? `${data.length} prospects importés.` : "Prospect importé.");
      setTimeout(() => setMsg(""), 2400);
    } catch (err) {
      setError(err?.message || "Erreur de lecture du fichier.");
    }

    setImporting(false);
    event.target.value = "";
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

    setIsCreating(false);
    setSelected(res.data);
    setForm(prospectToForm(res.data));
    await loadProspects();

    setSaving(false);
    setMsg(isNew ? "Prospect créé." : "Prospect sauvegardé.");
    setTimeout(() => setMsg(""), 2000);
  };

  const updateProspectStatus = async (prospectId, newStatus) => {
    const prospect = prospects.find((p) => p.id === prospectId);
    if (!prospect || prospect.statut === newStatus) return;

    setError("");
    setMsg("");

    setProspects((prev) =>
      prev.map((p) =>
        p.id === prospectId
          ? { ...p, statut: newStatus, updated_at: new Date().toISOString() }
          : p
      )
    );

    if (selected?.id === prospectId) {
      setSelected((prev) => (prev ? { ...prev, statut: newStatus } : prev));
      setForm((prev) => ({ ...prev, statut: newStatus }));
    }

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .update({
        statut: newStatus,
        updated_by: auteur(profil),
      })
      .eq("id", prospectId)
      .select("*")
      .single();

    if (err) {
      setError(err.message || "Impossible de déplacer le prospect.");
      await loadProspects();
      return;
    }

    if (selected?.id === prospectId) {
      setSelected(data);
      setForm(prospectToForm(data));
    }

    setMsg(`Prospect déplacé dans “${statusOf(newStatus).label}”.`);
    setTimeout(() => setMsg(""), 1600);
  };

  const quickStatus = async (statut) => {
    setField("statut", statut);

    if (!selected?.id) return;
    await updateProspectStatus(selected.id, statut);
  };

  const handleDragStart = (e, prospect) => {
    setDraggingId(prospect.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", prospect.id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStatus(null);
  };

  const handleDragOver = (e, statutId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(statutId);
  };

  const handleDragLeave = () => {
    setDragOverStatus(null);
  };

  const handleDrop = async (e, statutId) => {
    e.preventDefault();

    const idFromData = e.dataTransfer.getData("text/plain");
    const prospectId = idFromData || draggingId;

    setDraggingId(null);
    setDragOverStatus(null);

    if (!prospectId) return;
    await updateProspectStatus(prospectId, statutId);
  };

  const setQuickFollowUp = (label, days) => {
    setField("prochaine_action", label);
    setField("date_prochaine_action", addDays(days));
  };

  const addAction = async () => {
    if (!selected?.id) {
      setError("Sauvegarde d'abord le prospect avant d'ajouter une action.");
      return;
    }

    const resume = String(actionForm.resume || "").trim();

    if (!resume) {
      setError("Écris une courte note d'action.");
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");

    const nextAction = actionForm.prochaine_action || form.prochaine_action || selected.prochaine_action || "";
    const nextDate = actionForm.date_prochaine_action || form.date_prochaine_action || selected.date_prochaine_action || null;

    const actionPayload = {
      prospect_id: selected.id,
      created_by: auteur(profil),
      date_action: new Date().toISOString(),
      type_action: actionForm.type_action || "note",
      resume,
      resultat: "",
      prochaine_action: nextAction,
      date_prochaine_action: nextDate || null,
      donnees: {
        source: "CRM Prospection",
      },
    };

    const { data: insertedAction, error: err } = await supabase
      .from("invest_prospect_actions")
      .insert(actionPayload)
      .select("*")
      .single();

    if (err) {
      setError(`Action non ajoutée : ${err.message}`);
      setSaving(false);
      return;
    }

    const prospectPatch = {
      prochaine_action: nextAction,
      date_prochaine_action: nextDate || null,
      updated_by: auteur(profil),
    };

    const { data: updatedProspect, error: updateErr } = await supabase
      .from("invest_prospects")
      .update(prospectPatch)
      .eq("id", selected.id)
      .select("*")
      .single();

    if (updateErr) {
      setError(`Action ajoutée, mais la prochaine relance n'a pas été mise à jour : ${updateErr.message}`);
    }

    if (updatedProspect) {
      setSelected(updatedProspect);
      setForm(prospectToForm(updatedProspect));
    }

    setActions((prev) => [insertedAction, ...prev].filter(Boolean).slice(0, 6));
    setActionForm({ ...EMPTY_ACTION });

    await loadActions(selected.id);
    await loadProspects();

    setSaving(false);
    setMsg("Action ajoutée au prospect.");
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

    setIsCreating(false);
    setSelected(null);
    setForm({ ...EMPTY_FORM });
    setActions([]);
    await loadProspects();
  };

  const findExistingClient = async (prospect) => {
    const email = String(prospect.email || "").trim();
    const telephone = String(prospect.telephone || "").replace(/\\D/g, "");

    if (email) {
      const { data, error: err } = await supabase
        .from("invest_clients")
        .select("id, nom, prenom, email, telephone")
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      if (!err && data?.id) return data;
    }

    if (telephone) {
      const { data, error: err } = await supabase
        .from("invest_clients")
        .select("id, nom, prenom, email, telephone")
        .eq("telephone", prospect.telephone)
        .limit(1)
        .maybeSingle();

      if (!err && data?.id) return data;
    }

    return null;
  };

  const markProspectAsConverted = async (clientId, prospect, mode = "créé") => {
    const convertedAt = new Date().toISOString();

    const { data, error: err } = await supabase
      .from("invest_prospects")
      .update({
        statut: "converti",
        converted_client_id: clientId,
        converted_at: convertedAt,
        date_signature: selected?.date_signature || todayIso(),
        updated_by: auteur(profil),
      })
      .eq("id", selected.id)
      .select("*")
      .single();

    if (err) {
      setError(err.message);
      return null;
    }

    await supabase
      .from("invest_prospect_actions")
      .insert({
        prospect_id: selected.id,
        created_by: auteur(profil),
        type_action: "conversion",
        resume: `Prospect converti en client CRM (${mode}). Client ID : ${clientId}`,
        prochaine_action: "",
        date_prochaine_action: null,
      });

    setSelected(data);
    setForm(prospectToForm(data));
    await loadActions(selected.id);
    await loadProspects();

    return data;
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

    if (!prospect.responsable) {
      setError("Conversion impossible : renseigne le responsable du dossier.");
      return;
    }

    if (!window.confirm("Convertir ce prospect en client ?")) return;

    setSaving(true);
    setError("");
    setMsg("");

    // 1. On sauvegarde d'abord les dernières informations du prospect.
    const { data: savedProspect, error: saveErr } = await supabase
      .from("invest_prospects")
      .update(payloadProspect)
      .eq("id", selected.id)
      .select("*")
      .single();

    if (saveErr) {
      setSaving(false);
      setError(saveErr.message || "Impossible de sauvegarder le prospect avant conversion.");
      return;
    }

    const cleanProspect = { ...prospect, ...savedProspect };

    // 2. Détection de doublon CRM client par email ou téléphone.
    const existingClient = await findExistingClient(cleanProspect);

    if (existingClient?.id) {
      const existingName = `${existingClient.prenom || ""} ${existingClient.nom || ""}`.trim() || existingClient.email || existingClient.telephone || "client existant";
      const confirmLink = window.confirm(
        `Un client existe déjà dans le CRM : ${existingName}.\n\nSouhaites-tu lier ce prospect à cette fiche client au lieu de créer un doublon ?`
      );

      if (!confirmLink) {
        setSaving(false);
        setMsg("Conversion annulée pour éviter un doublon.");
        setTimeout(() => setMsg(""), 2200);
        return;
      }

      await markProspectAsConverted(existingClient.id, cleanProspect, "lié à un client existant");
      setSaving(false);
      setMsg("Prospect lié au client existant.");
      setTimeout(() => setMsg(""), 2400);
      return;
    }

    // 3. Création du client CRM avec plusieurs niveaux de compatibilité selon les colonnes disponibles.
    const clientPayloads = [
      {
        nom: cleanProspect.nom || "",
        prenom: cleanProspect.prenom || "",
        telephone: cleanProspect.telephone || "",
        email: cleanProspect.email || "",
        source: cleanProspect.source || "CRM Prospection",
        statut: "actif",
        etape: "1. Signature contrat",
        budget: cleanProspect.budget_global || null,
        date_signature: todayIso(),
        strategie_data: {
          origine: "CRM Prospection",
          prospect_id: selected.id,
          objectif: cleanProspect.objectif || "",
          budget_max: cleanProspect.budget_global || null,
          zones: cleanProspect.zone_recherche || "",
          honoraires_estimes_ht: cleanProspect.honoraires_estimes_ht || null,
          responsable: cleanProspect.responsable || "",
          remarques: cleanProspect.commentaire || "",
        },
        notes: [
          "Créé depuis le CRM Prospection.",
          cleanProspect.objectif ? `Objectif : ${cleanProspect.objectif}` : null,
          cleanProspect.zone_recherche ? `Zone : ${cleanProspect.zone_recherche}` : null,
          cleanProspect.commentaire ? `Note prospection : ${cleanProspect.commentaire}` : null,
        ].filter(Boolean).join("\n"),
        created_by: auteur(profil),
      },
      {
        nom: cleanProspect.nom || "",
        prenom: cleanProspect.prenom || "",
        telephone: cleanProspect.telephone || "",
        email: cleanProspect.email || "",
        source: cleanProspect.source || "CRM Prospection",
        budget: cleanProspect.budget_global || null,
      },
      {
        nom: cleanProspect.nom || "",
        prenom: cleanProspect.prenom || "",
        telephone: cleanProspect.telephone || "",
        email: cleanProspect.email || "",
      },
      {
        nom: cleanProspect.nom || "",
        prenom: cleanProspect.prenom || "",
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

      // Si une colonne n'existe pas, on tente une version plus simple.
      if (err.code !== "42703") break;
    }

    if (!client?.id) {
      setSaving(false);
      setError(lastError?.message || "Conversion impossible.");
      return;
    }

    await markProspectAsConverted(client.id, cleanProspect, "créé");
    setSaving(false);
    setMsg("Prospect converti en nouveau client CRM.");
    setTimeout(() => setMsg(""), 2400);
  };

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${label} copié.`);
      setTimeout(() => setMsg(""), 1800);
    } catch {
      setError("Impossible de copier le message.");
    }
  };

  const callLink = form.telephone ? `tel:${form.telephone}` : null;
  const mailLink = form.email ? `mailto:${form.email}` : null;
  const waLink = form.telephone ? `https://wa.me/${String(form.telephone).replace(/\D/g, "")}` : null;
  const currentProspect = selected ? { ...selected, ...formToPayload(form, profil, false) } : form;

  return (
    <div style={{ padding: "16px 18px", maxWidth: 1580, margin: "0 auto" }}>
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
            Glisse les fiches prospects dans la bonne colonne, puis traite les relances prioritaires.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="inv-btn inv-btn-out" type="button" onClick={loadProspects} disabled={loading}>
            <Icon as={RefreshCw} size={14} />
            Actualiser
          </button>

          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.json,.txt,.vcf,text/csv,application/json,text/plain"
            onChange={handleImportProspects}
            style={{ display: "none" }}
          />

          <button
            className="inv-btn inv-btn-out"
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Importer un prospect depuis CSV, JSON, TXT ou contact VCF"
          >
            <Icon as={Upload} size={14} />
            {importing ? "Import..." : "Importer"}
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
        <Kpi icon={Clock} label="À traiter" value={stats.today} color={stats.today > 0 ? WA : SU} T={T} />
        <Kpi icon={Euro} label="CA potentiel" value={fmtDashboardEur(stats.ca)} color={SU} T={T} />
      </div>

      <div className="inv-card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 7 }}>
          Import accepté : CSV, JSON, TXT ou VCF. Champs reconnus automatiquement : prénom, nom, téléphone, email, source, responsable, objectif, budget, zone, relance, note.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) auto", gap: 10, alignItems: "center" }}>
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

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <QuickFilterButton
              active={quickFilter === "all"}
              icon={Users}
              label="Tous"
              color={T.accent}
              onClick={() => setQuickFilter("all")}
              T={T}
            />
            <QuickFilterButton
              active={quickFilter === "today"}
              icon={Clock}
              label="À traiter"
              count={stats.today}
              color={WA}
              onClick={() => setQuickFilter(quickFilter === "today" ? "all" : "today")}
              T={T}
            />
            <QuickFilterButton
              active={quickFilter === "late"}
              icon={AlertTriangle}
              label="En retard"
              count={stats.relances}
              color={DA}
              onClick={() => setQuickFilter(quickFilter === "late" ? "all" : "late")}
              T={T}
            />
            <QuickFilterButton
              active={quickFilter === "rdv"}
              icon={Calendar}
              label="RDV"
              count={stats.rdv}
              color="#8B5CF6"
              onClick={() => setQuickFilter(quickFilter === "rdv" ? "all" : "rdv")}
              T={T}
            />
            <QuickFilterButton
              active={quickFilter === "hot"}
              icon={Flame}
              label="Chauds"
              count={stats.hot}
              color={DA}
              onClick={() => setQuickFilter(quickFilter === "hot" ? "all" : "hot")}
              T={T}
            />
          </div>
        </div>
      </div>

      <PlanningPanel
        buckets={planningBuckets}
        onSelect={selectProspect}
        selectedId={selected?.id}
        T={T}
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 520px", gap: 14, alignItems: "start" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(190px, 1fr))",
            gap: 10,
          }}
        >
          {grouped.map(({ statut, prospects: items }) => (
            <PipelineColumn
              key={statut.id}
              statut={statut}
              prospects={items}
              selectedId={selected?.id}
              dragOverStatus={dragOverStatus}
              onSelect={selectProspect}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              T={T}
            />
          ))}
        </div>

        <div className="inv-card" style={{ padding: 0, minHeight: 500 }}>
          <div
            className="inv-card-hd blue"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon as={selected?.id ? Pencil : UserPlus} size={13} />
              {selected?.id ? prospectName(selected) : isCreating ? "Nouveau prospect" : "Fiche prospect"}
            </span>

            <div style={{ display: "flex", gap: 6 }}>
              {selected?.id && <Badge color={temperature(selected).color} T={T}>{temperature(selected).label}</Badge>}
              <button
                className="inv-btn inv-btn-out inv-btn-sm"
                type="button"
                onClick={() => {
                  setIsCreating(false);
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
            {!selected && !isCreating ? (
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
                    marginBottom: 10,
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

                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => copyText(messageRelance(currentProspect), "Relance")}>
                      <Icon as={Copy} size={12} />
                      Relance
                    </button>

                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => copyText(messageConfirmationRdv(currentProspect), "Confirmation RDV")}>
                      <Icon as={Copy} size={12} />
                      RDV
                    </button>

                    <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => copyText(messageProposition(currentProspect), "Message proposition")}>
                      <Icon as={Copy} size={12} />
                      Proposition
                    </button>
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
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addAction();
                            }
                          }}
                        />

                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={addAction} disabled={saving}>
                          Ajouter
                        </button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 52px 52px 52px", gap: 7, marginTop: 7 }}>
                        <select
                          className="inv-sel"
                          value={actionForm.prochaine_action}
                          onChange={(e) => setActionForm((p) => ({ ...p, prochaine_action: e.target.value }))}
                          style={{ height: 32, fontSize: 12 }}
                        >
                          {PROCHAINES_ACTIONS.map((o) => (
                            <option key={o || "empty-action"} value={o}>
                              {o || "Prochaine action"}
                            </option>
                          ))}
                        </select>

                        <input
                          className="inv-inp"
                          type="date"
                          value={actionForm.date_prochaine_action}
                          onChange={(e) => setActionForm((p) => ({ ...p, date_prochaine_action: e.target.value }))}
                          style={{ height: 32, fontSize: 12 }}
                        />

                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setActionForm((p) => ({ ...p, prochaine_action: p.prochaine_action || "Relancer", date_prochaine_action: todayIso() }))}>
                          J
                        </button>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setActionForm((p) => ({ ...p, prochaine_action: p.prochaine_action || "Relancer", date_prochaine_action: addDays(2) }))}>
                          J+2
                        </button>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setActionForm((p) => ({ ...p, prochaine_action: p.prochaine_action || "Relancer", date_prochaine_action: addDays(7) }))}>
                          J+7
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
