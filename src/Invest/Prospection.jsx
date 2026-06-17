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
  BarChart3,
  PieChart,
  TrendingUp,
  Bell,
} from "lucide-react";

/**
 * CRM Prospection — V16 harmonisée : pipeline premium + liste + planning étendu + KPI + fiche modale + import liste + relances + conversion CRM corrigée
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
  { id: "nouveau", label: "Nouveau", icon: UserPlus, color: "#60A5FA", tone: "Lead entrant" },
  { id: "contact", label: "Contact", icon: Phone, color: "#F59E0B", tone: "Premier échange" },
  { id: "relance", label: "Relance", icon: RefreshCw, color: "#FB923C", tone: "À relancer" },
  { id: "relance_1", label: "Relance 1", icon: Clock, color: "#F97316", tone: "Suivi actif" },
  { id: "relance_2", label: "Relance 2", icon: AlertTriangle, color: "#EF4444", tone: "Dernière relance" },
  { id: "rdv", label: "RDV", icon: Calendar, color: "#8B5CF6", tone: "Rendez-vous" },
  { id: "proposition", label: "Proposition", icon: Target, color: "#22C55E", tone: "Offre envoyée" },
  { id: "signe", label: "Signé", icon: CheckCircle2, color: SU, tone: "Converti" },
  { id: "perdu", label: "Perdu", icon: XCircle, color: "#64748B", tone: "Sorti du pipe" },
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

function statusSoftBg(statut) {
  const status = statusOf(statut);
  return `linear-gradient(135deg, ${status.color}1F, rgba(255,255,255,.035))`;
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
    if (status.includes("relance") && (status.includes("2") || status.includes("deux"))) normalized.statut = "relance_2";
    else if (status.includes("relance") && (status.includes("1") || status.includes("une") || status.includes("premiere"))) normalized.statut = "relance_1";
    else if (status.includes("relance")) normalized.statut = "relance";
    else if (status.includes("contact")) normalized.statut = "contact";
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

function looksLikeHeaderLine(line) {
  const normalized = stripAccents(line || "").toLowerCase();
  const headerWords = [
    "prenom",
    "nom",
    "telephone",
    "email",
    "source",
    "responsable",
    "objectif",
    "budget",
    "zone",
    "note",
  ];

  return headerWords.filter((w) => normalized.includes(w)).length >= 2;
}

function splitName(fullName) {
  const cleaned = String(fullName || "")
    .replace(/^(prospect|client|nom)\s*[:\-]\s*/i, "")
    .trim();

  if (!cleaned) return { prenom: "", nom: "" };

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return { prenom: "", nom: parts[0] };
  }

  const prenom = parts.shift() || "";
  return { prenom, nom: parts.join(" ") };
}

function parseDirectProspectLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const delimiter = raw.includes(";")
    ? ";"
    : raw.includes("\t")
      ? "\t"
      : (raw.match(/,/g) || []).length >= 2
        ? ","
        : null;

  if (!delimiter) {
    const parsed = parseTextProspect(raw)[0];
    return parsed || null;
  }

  const cells = parseCSVLine(raw, delimiter).map((c) => String(c || "").trim());
  const [nameCell = "", telCell = "", emailCell = "", sourceCell = "", objectifCell = "", budgetCell = "", zoneCell = "", ...rest] = cells;

  const emailFromLine = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phoneFromLine = raw.match(/(?:\+33|0033|0)[\d\s.\-()]{8,}/)?.[0] || "";

  const name = splitName(nameCell);
  const email = emailCell.includes("@") ? emailCell : emailFromLine;
  const telephone = telCell || phoneFromLine;

  return normalizeImportedRow({
    prenom: name.prenom,
    nom: name.nom,
    telephone,
    email,
    source: sourceCell,
    objectif: objectifCell,
    budget_global: budgetCell,
    zone_recherche: zoneCell,
    commentaire: rest.filter(Boolean).join(" - "),
  });
}

function parsePastedProspectList(content) {
  const raw = String(content || "").trim();
  if (!raw) return [];

  const firstLine = raw.split(/\r?\n/).find((l) => l.trim()) || "";

  if (
    raw.startsWith("{") ||
    raw.startsWith("[") ||
    raw.includes("BEGIN:VCARD") ||
    looksLikeHeaderLine(firstLine)
  ) {
    const parsed = parseImportedProspects(raw, looksLikeHeaderLine(firstLine) ? "prospects.csv" : "prospects.txt");
    if (parsed.length) return parsed;
  }

  const blocks = raw
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    const blockProspects = blocks
      .map((block) => parseTextProspect(block)[0])
      .filter(Boolean)
      .map(normalizeImportedRow);

    if (blockProspects.length) return blockProspects;
  }

  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseDirectProspectLine)
    .filter(Boolean)
    .map(normalizeImportedRow)
    .filter((p) => p.nom || p.prenom || p.societe || p.email || p.telephone);
}


const NEW_PROSPECT_NOTIFICATION_EMAIL = "matthieu.fumoleau@groupe-profero.com";

function monthKey(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return "Non daté";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  if (!key || key === "Non daté") return "Non daté";
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function groupCount(items, getKey, fallback = "Non renseigné") {
  const map = new Map();
  (items || []).forEach((item) => {
    const key = String(getKey(item) || fallback).trim() || fallback;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function groupSum(items, getKey, getValue, fallback = "Non renseigné") {
  const map = new Map();
  (items || []).forEach((item) => {
    const key = String(getKey(item) || fallback).trim() || fallback;
    const value = Number(getValue(item) || 0) || 0;
    map.set(key, (map.get(key) || 0) + value);
  });
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function ChartBar({ label, value, max, color, T, valueLabel }) {
  const pct = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div
          style={{
            color: T.textSub,
            fontSize: 11.5,
            fontWeight: 800,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div style={{ color: T.text, fontSize: 11.5, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>
          {valueLabel || value}
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,.16)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: color || T.accent }} />
      </div>
    </div>
  );
}

function MiniBarChart({ title, subtitle, icon, color, data, T, money = false }) {
  const IconChart = icon;
  const max = Math.max(1, ...data.map((d) => Number(d.value || 0)));

  return (
    <div className="inv-card" style={{ padding: 12, minHeight: 230 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", gap: 7 }}>
            <Icon as={IconChart} size={15} />
            {title}
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 3 }}>{subtitle}</div>
        </div>
      </div>

      {data.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md, padding: 16, textAlign: "center" }}>
          Pas encore assez de données
        </div>
      ) : (
        data.slice(0, 8).map((row) => (
          <ChartBar
            key={row.label}
            label={row.label}
            value={row.value}
            max={max}
            color={color}
            T={T}
            valueLabel={money ? fmtDashboardEur(row.value) : String(row.value)}
          />
        ))
      )}
    </div>
  );
}

function FunnelStep({ label, count, total, color, T }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div style={{ border: `1px solid ${T.border}`, background: T.cardHover, borderRadius: RADIUS.md, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ color: T.text, fontSize: 12, fontWeight: 900 }}>{label}</div>
        <div style={{ color, fontSize: 12, fontWeight: 900, fontFamily: "'DM Mono', monospace" }}>{count}</div>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: "rgba(148,163,184,.16)", overflow: "hidden", marginBottom: 6 }}>
        <div style={{ width: `${Math.max(4, pct)}%`, height: "100%", background: color, borderRadius: 999 }} />
      </div>
      <div style={{ color: T.textMuted, fontSize: 10.5 }}>{pct}% du total</div>
    </div>
  );
}

function KpiAnalysisView({ prospects, stats, T }) {
  const total = prospects.length;
  const signed = prospects.filter((p) => ["signe", "converti"].includes(p.statut)).length;
  const lost = prospects.filter((p) => p.statut === "perdu").length;
  const propositions = prospects.filter((p) => ["proposition", "signe", "converti"].includes(p.statut)).length;
  const conversionRate = total > 0 ? Math.round((signed / total) * 100) : 0;
  const proposalRate = total > 0 ? Math.round((propositions / total) * 100) : 0;
  const caSigned = prospects
    .filter((p) => ["signe", "converti"].includes(p.statut))
    .reduce((sum, p) => sum + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);

  const byStatus = STATUTS.map((s) => ({
    label: s.label,
    value: prospects.filter((p) => p.statut === s.id || (s.id === "signe" && p.statut === "converti")).length,
    color: s.color,
  }));

  const bySource = groupCount(prospects, (p) => p.source).slice(0, 8);
  const byResponsable = groupCount(prospects, (p) => p.responsable).slice(0, 8);
  const caByStatus = groupSum(prospects, (p) => statusOf(p.statut).label, (p) => p.ca_potentiel_ht || p.honoraires_estimes_ht).slice(0, 8);

  const byMonth = groupCount(prospects, (p) => monthKey(p.created_at || p.date_premier_contact || p.updated_at), "Non daté")
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-8)
    .map((row) => ({ ...row, label: monthLabel(row.label) }));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Kpi icon={Users} label="Total prospects" value={total} color="#60A5FA" T={T} />
        <Kpi icon={TrendingUp} label="Taux conversion" value={`${conversionRate}%`} color={conversionRate >= 25 ? SU : WA} T={T} />
        <Kpi icon={Target} label="Taux proposition" value={`${proposalRate}%`} color="#8B5CF6" T={T} />
        <Kpi icon={Euro} label="CA signé" value={fmtDashboardEur(caSigned)} color={SU} T={T} />
      </div>

      <div className="inv-card" style={{ padding: 12 }}>
        <div style={{ color: T.text, fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          <Icon as={BarChart3} size={15} />
          Tunnel commercial
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
          {byStatus.map((s) => (
            <FunnelStep key={s.label} label={s.label} count={s.value} total={total} color={s.color} T={T} />
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <MiniBarChart title="Prospects par source" subtitle="Origine des contacts entrants" icon={PieChart} color="#60A5FA" data={bySource} T={T} />
        <MiniBarChart title="Prospects par responsable" subtitle="Répartition commerciale" icon={Users} color="#8B5CF6" data={byResponsable} T={T} />
        <MiniBarChart title="Nouveaux prospects par mois" subtitle="Évolution du volume de prospection" icon={TrendingUp} color={SU} data={byMonth} T={T} />
        <MiniBarChart title="CA potentiel par statut" subtitle="Honoraires estimés par étape" icon={Euro} color={WA} data={caByStatus} T={T} money />
      </div>

      <div className="inv-card" style={{ padding: 12 }}>
        <div style={{ color: T.text, fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Lecture rapide</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ color: T.textSub, fontSize: 12 }}>Prospects actifs : <strong style={{ color: T.text }}>{stats.actifs}</strong></div>
          <div style={{ color: T.textSub, fontSize: 12 }}>Relances en retard : <strong style={{ color: stats.relances > 0 ? DA : SU }}>{stats.relances}</strong></div>
          <div style={{ color: T.textSub, fontSize: 12 }}>Prospects perdus : <strong style={{ color: T.text }}>{lost}</strong></div>
          <div style={{ color: T.textSub, fontSize: 12 }}>CA potentiel : <strong style={{ color: T.text }}>{fmtDashboardEur(stats.ca)}</strong></div>
        </div>
      </div>
    </div>
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
        background: activeDrop ? `${statut.color}18` : "rgba(255,255,255,.032)",
        border: `1px solid ${activeDrop ? statut.color : T.border}`,
        borderTop: `3px solid ${statut.color}`,
        borderRadius: 22,
        padding: 10,
        minHeight: 520,
        transition: "all .12s ease",
        boxShadow: activeDrop ? `0 18px 45px ${statut.color}18` : "0 14px 35px rgba(2,6,23,.16)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
          padding: "10px 10px 11px",
          borderRadius: 16,
          background: statusSoftBg(statut.id),
          border: `1px solid ${statut.color}35`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 12,
              background: `${statut.color}20`,
              border: `1px solid ${statut.color}45`,
              color: statut.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon as={IconStatus} size={15} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: T.text,
                fontSize: 13,
                fontWeight: 950,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {statut.label}
            </div>
            <div style={{ color: T.textMuted, fontSize: 10.5, marginTop: 1 }}>
              {statut.tone || "Suivi commercial"}
            </div>
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: T.text, fontSize: 15, fontWeight: 950, lineHeight: 1 }}>{prospects.length}</div>
          <div style={{ color: T.textMuted, fontSize: 10, marginTop: 3 }}>prospect(s)</div>
        </div>
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
              padding: "34px 8px",
              background: "rgba(255,255,255,.02)",
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
              padding: "34px 8px",
              background: "rgba(255,255,255,.02)",
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
            Visualisation des actions à faire : retard, aujourd'hui, demain, 7 jours, 14 jours, 30 jours et 3 mois
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))", gap: 10 }}>
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

function ViewButton({ active, icon, label, helper, onClick, T }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? T.accent : T.border}`,
        background: active ? T.accentBg : T.cardHover,
        color: active ? T.accent : T.textSub,
        borderRadius: RADIUS.md,
        padding: "8px 10px",
        cursor: "pointer",
        textAlign: "left",
        minHeight: 52,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 900 }}>
        <Icon as={icon} size={14} />
        {label}
      </div>
      <div style={{ fontSize: 10.5, color: active ? T.textSub : T.textMuted, marginTop: 3 }}>
        {helper}
      </div>
    </button>
  );
}

function ListView({ prospects, selectedId, onSelect, onStatusChange, T }) {
  const sorted = prospects
    .slice()
    .sort((a, b) => {
      const activeA = isActiveProspect(a) ? 0 : 1;
      const activeB = isActiveProspect(b) ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return compareActionDate(a, b);
    });

  return (
    <div className="inv-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr .9fr .75fr .8fr .9fr .65fr",
          gap: 8,
          padding: "9px 10px",
          borderBottom: `1px solid ${T.border}`,
          color: T.textMuted,
          fontSize: 10,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        <div>Prospect</div>
        <div>Contact</div>
        <div>Statut</div>
        <div>Responsable</div>
        <div>Prochaine action</div>
        <div style={{ textAlign: "right" }}>CA</div>
      </div>

      <div style={{ maxHeight: "calc(100vh - 360px)", overflowY: "auto" }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 24, color: T.textMuted, textAlign: "center" }}>Aucun prospect</div>
        ) : (
          sorted.map((p) => {
            const st = statusOf(p.statut);
            const temp = temperature(p);
            const selected = selectedId === p.id;
            const late = isLate(p.date_prochaine_action);

            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(p);
                }}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "1.4fr .9fr .75fr .8fr .9fr .65fr",
                  gap: 8,
                  alignItems: "center",
                  padding: "9px 10px",
                  border: "none",
                  borderBottom: `1px solid ${T.border}`,
                  background: selected ? T.accentBg : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: T.text,
                      fontSize: 12.5,
                      fontWeight: 900,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {prospectName(p)}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 4, alignItems: "center" }}>
                    <Badge color={temp.color} T={T}>{temp.label}</Badge>
                    {p.source && <span style={{ color: T.textMuted, fontSize: 10.5 }}>{p.source}</span>}
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: T.textSub,
                      fontSize: 11,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.telephone || "—"}
                  </div>
                  <div
                    style={{
                      color: T.textMuted,
                      fontSize: 10.5,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      marginTop: 2,
                    }}
                  >
                    {p.email || "—"}
                  </div>
                </div>

                <div onClick={(e) => e.stopPropagation()}>
                  <select
                    className="inv-sel"
                    value={p.statut === "converti" ? "signe" : p.statut || "nouveau"}
                    onChange={(e) => onStatusChange(p.id, e.target.value)}
                    style={{
                      height: 30,
                      fontSize: 11.5,
                      borderColor: `${st.color}55`,
                      color: st.color,
                      fontWeight: 900,
                    }}
                  >
                    {STATUTS.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    color: T.textSub,
                    fontSize: 11.5,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.responsable || "—"}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: late ? DA : T.textSub,
                      fontSize: 11.5,
                      fontWeight: late ? 900 : 600,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.prochaine_action || "À définir"}
                  </div>
                  <div style={{ color: late ? DA : T.textMuted, fontSize: 10.5, marginTop: 2 }}>
                    {p.date_prochaine_action ? fmtDate(p.date_prochaine_action) : "Pas de date"}
                  </div>
                </div>

                <div
                  style={{
                    color: T.text,
                    fontSize: 12,
                    fontWeight: 900,
                    textAlign: "right",
                    fontFamily: "'DM Mono', monospace",
                  }}
                >
                  {fmtDashboardEur(Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PipelineView({
  grouped,
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
  return (
    <div
      className="inv-prospection-kanban"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${STATUTS.length}, minmax(270px, 1fr))`,
        gap: 12,
        overflowX: "auto",
        padding: "2px 2px 12px",
      }}
    >
      {grouped.map(({ statut, prospects: items }) => (
        <PipelineColumn
          key={statut.id}
          statut={statut}
          prospects={items}
          selectedId={selectedId}
          dragOverStatus={dragOverStatus}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          T={T}
        />
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, T }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: T.text,
        fontSize: 12,
        fontWeight: 950,
        margin: "12px 0 8px",
        paddingTop: 2,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          background: `${T.accent}18`,
          color: T.accent,
          border: `1px solid ${T.accent}35`,
        }}
      >
        <Icon as={icon} size={13} />
      </span>
      {title}
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
  const [viewMode, setViewMode] = useState("pipeline");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStatus, setDragOverStatus] = useState(null);

  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [mailNotice, setMailNotice] = useState(null);

  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const showMailNotice = useCallback((type, text) => {
    setMailNotice({ type, text });
    window.setTimeout(() => setMailNotice(null), 5200);
  }, []);

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

  const notifyNewProspectByEmail = useCallback(async (prospect, mode = "création") => {
    if (!prospect?.id) {
      return { ok: false, message: "Prospect introuvable pour la notification." };
    }

    try {
      const { data, error: notifyErr } = await supabase.functions.invoke("notify-new-prospect", {
        body: {
          to: NEW_PROSPECT_NOTIFICATION_EMAIL,
          mode,
          prospect: {
            id: prospect.id,
            nom: prospect.nom || "",
            prenom: prospect.prenom || "",
            societe: prospect.societe || "",
            telephone: prospect.telephone || "",
            email: prospect.email || "",
            source: prospect.source || "",
            responsable: prospect.responsable || "",
            objectif: prospect.objectif || "",
            budget_global: prospect.budget_global || null,
            zone_recherche: prospect.zone_recherche || "",
            prochaine_action: prospect.prochaine_action || "",
            date_prochaine_action: prospect.date_prochaine_action || null,
            date_rdv: prospect.date_rdv || null,
            honoraires_estimes_ht: prospect.honoraires_estimes_ht || prospect.ca_potentiel_ht || null,
            commentaire: prospect.commentaire || "",
            created_at: prospect.created_at || new Date().toISOString(),
          },
        },
      });

      if (notifyErr) {
        const details = notifyErr?.message || JSON.stringify(notifyErr);
        console.warn("Notification nouveau prospect non envoyée", notifyErr);
        return { ok: false, message: details || "Erreur Edge Function notify-new-prospect." };
      }

      if (!data?.ok) {
        const details = data?.error || data?.warning || data?.message || "La fonction notify-new-prospect n'a pas confirmé l'envoi du mail.";
        console.warn("Notification nouveau prospect non confirmée", data);
        return { ok: false, message: details };
      }

      return { ok: true, message: `Mail envoyé via ${data.provider || "notification"}.` };
    } catch (err) {
      const details = err?.message || String(err);
      console.warn("Notification nouveau prospect non envoyée", err);
      return { ok: false, message: details || "Erreur inconnue pendant l'envoi du mail." };
    }
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
    const relancePipeline = prospects.filter((p) => ["relance", "relance_1", "relance_2"].includes(p.statut)).length;
    const today = prospects.filter((p) => isTodayOrLate(p.date_prochaine_action) && !["perdu", "converti", "signe"].includes(p.statut)).length;
    const hot = prospects.filter((p) => temperature(p).label === "Chaud" && !["perdu", "converti", "signe"].includes(p.statut)).length;
    const ca = prospects.reduce((s, p) => s + (Number(p.ca_potentiel_ht || p.honoraires_estimes_ht || 0) || 0), 0);

    return { actifs, rdv, relances, relancePipeline, today, hot, ca };
  }, [prospects]);

  const planningBuckets = useMemo(() => {
    const today = todayIso();
    const tomorrow = addDays(1);
    const day7 = addDays(7);
    const day14 = addDays(14);
    const day30 = addDays(30);
    const day90 = addDays(90);

    const active = prospects
      .filter(isActiveProspect)
      .slice()
      .sort(compareActionDate);

    return [
      {
        id: "late",
        title: "En retard",
        subtitle: "Avant aujourd'hui",
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
        title: "7 jours",
        subtitle: "J+2 à J+7",
        icon: CalendarDays,
        color: SU,
        items: active.filter((p) => {
          const d = dateOnly(p.date_prochaine_action);
          return d > tomorrow && d <= day7;
        }),
      },
      {
        id: "two_weeks",
        title: "14 jours",
        subtitle: "J+8 à J+14",
        icon: CalendarDays,
        color: "#38BDF8",
        items: active.filter((p) => {
          const d = dateOnly(p.date_prochaine_action);
          return d > day7 && d <= day14;
        }),
      },
      {
        id: "month",
        title: "30 jours",
        subtitle: "J+15 à J+30",
        icon: CalendarDays,
        color: "#F59E0B",
        items: active.filter((p) => {
          const d = dateOnly(p.date_prochaine_action);
          return d > day14 && d <= day30;
        }),
      },
      {
        id: "quarter",
        title: "3 mois",
        subtitle: "J+31 à J+90",
        icon: CalendarDays,
        color: "#A78BFA",
        items: active.filter((p) => {
          const d = dateOnly(p.date_prochaine_action);
          return d > day30 && d <= day90;
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
    setMailNotice(null);
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
    setMailNotice(null);
  };

  const importParsedProspects = async (parsed, originLabel = "import") => {
    if (!parsed.length) {
      setError("Import impossible : aucun prospect reconnu.");
      return [];
    }

    if (parsed.length > 1) {
      const ok = window.confirm(`${parsed.length} prospects détectés. Souhaites-tu les importer ?`);
      if (!ok) return [];
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
        import_source: originLabel,
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
      return [];
    }

    await loadProspects();

    const notificationResults = await Promise.allSettled((data || []).map((p) => notifyNewProspectByEmail(p, originLabel)));
    const notificationValues = notificationResults.map((r) => r.status === "fulfilled" ? r.value : { ok: false, message: r.reason?.message || String(r.reason) });
    const notifiedCount = notificationValues.filter((r) => r?.ok).length;
    const firstNotificationError = notificationValues.find((r) => !r?.ok)?.message;
    const totalImported = data?.length || 0;

    if (data?.length === 1) {
      setIsCreating(false);
      setSelected(data[0]);
      setForm(prospectToForm(data[0]));
    }

    if (totalImported > 0 && notifiedCount === totalImported) {
      showMailNotice(
        "success",
        totalImported > 1
          ? `${notifiedCount} mails de notification envoyés à ${NEW_PROSPECT_NOTIFICATION_EMAIL}.`
          : `Mail de notification envoyé à ${NEW_PROSPECT_NOTIFICATION_EMAIL}.`
      );
    } else if (totalImported > 0) {
      showMailNotice(
        "warning",
        `${totalImported} prospect(s) importé(s), mais seulement ${notifiedCount} mail(s) confirmé(s). Détail : ${firstNotificationError || "fonction notify-new-prospect non confirmée"}`
      );
    }

    setMsg(data?.length > 1 ? `${data.length} prospects importés.` : "Prospect importé.");
    setTimeout(() => setMsg(""), 2600);

    return data || [];
  };

  const handleImportProspects = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError("");
    setMsg("");
    setMailNotice(null);

    try {
      const content = await file.text();
      const parsed = parseImportedProspects(content, file.name);
      await importParsedProspects(parsed, file.name || "import fichier");
    } catch (err) {
      setError(err?.message || "Erreur de lecture du fichier.");
    }

    setImporting(false);
    event.target.value = "";
  };

  const handleBulkImportProspects = async () => {
    const content = String(bulkImportText || "").trim();

    if (!content) {
      setError("Colle une liste de prospects avant d'importer.");
      return;
    }

    setImporting(true);
    setError("");
    setMsg("");
    setMailNotice(null);

    try {
      const parsed = parsePastedProspectList(content);

      if (!parsed.length) {
        setError("Aucun prospect reconnu dans la liste collée.");
        setImporting(false);
        return;
      }

      const imported = await importParsedProspects(parsed, "liste collée");

      if (imported.length) {
        setBulkImportText("");
        setBulkImportOpen(false);
      }
    } catch (err) {
      setError(err?.message || "Erreur pendant l'import de la liste.");
    }

    setImporting(false);
  };

  const saveProspect = async () => {
    setSaving(true);
    setMsg("");
    setError("");
    setMailNotice(null);

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

    if (isNew) {
      const notificationResult = await notifyNewProspectByEmail(res.data, "création manuelle");

      showMailNotice(
        notificationResult.ok ? "success" : "warning",
        notificationResult.ok
          ? `Mail de notification envoyé à ${NEW_PROSPECT_NOTIFICATION_EMAIL}.`
          : `Prospect créé, mais le mail de notification n'a pas été confirmé. Détail : ${notificationResult.message || "fonction notify-new-prospect non confirmée"}`
      );
    }

    setSaving(false);
    setMsg(isNew ? "Prospect créé." : "Prospect sauvegardé.");
    setTimeout(() => setMsg(""), 2200);
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

  const isMissingClientColumnError = (err) => {
    const raw = [err?.code, err?.message, err?.details, err?.hint]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      err?.code === "42703" ||
      err?.code === "PGRST204" ||
      raw.includes("schema cache") ||
      raw.includes("could not find") ||
      raw.includes("column")
    );
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

      // Supabase/PostgREST renvoie parfois PGRST204, et non 42703,
      // quand une colonne n'existe pas dans le cache de schéma.
      // Exemple rencontré : colonne created_by absente de invest_clients.
      // Dans ce cas, on tente automatiquement le payload suivant, plus minimal.
      if (isMissingClientColumnError(err)) continue;

      break;
    }

    if (!client?.id) {
      setSaving(false);
      setError(
        lastError?.message
          ? `Conversion impossible : ${lastError.message}`
          : "Conversion impossible : aucune version compatible avec la table invest_clients."
      );
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
    <div style={{ padding: "16px 18px", maxWidth: 1680, margin: "0 auto" }}>
      <style>{`
        .inv-prospection-kanban::-webkit-scrollbar { height: 10px; }
        .inv-prospection-kanban::-webkit-scrollbar-thumb { background: rgba(201,163,74,.35); border-radius: 999px; }
        .inv-prospection-kanban::-webkit-scrollbar-track { background: rgba(255,255,255,.04); border-radius: 999px; }
      `}</style>
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
            Pipeline commercial harmonisé, relances, planning et analyse des leads entrants.
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

          <button
            className="inv-btn inv-btn-out"
            type="button"
            onClick={() => setBulkImportOpen(true)}
            disabled={importing}
            title="Coller directement une liste de prospects"
          >
            <Icon as={ListChecks} size={14} />
            Coller une liste
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

      {mailNotice && (
        <div
          style={{
            background: `${mailNotice.type === "success" ? SU : WA}12`,
            color: mailNotice.type === "success" ? SU : WA,
            border: `1px solid ${(mailNotice.type === "success" ? SU : WA)}35`,
            borderRadius: RADIUS.md,
            padding: 10,
            marginBottom: 10,
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon as={Bell} size={15} />
          {mailNotice.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Kpi icon={Users} label="Prospects actifs" value={stats.actifs} color="#60A5FA" T={T} />
        <Kpi icon={RefreshCw} label="En relance" value={stats.relancePipeline} color="#F97316" T={T} />
        <Kpi icon={Clock} label="À traiter" value={stats.today} color={stats.today > 0 ? WA : SU} T={T} />
        <Kpi icon={Euro} label="CA potentiel" value={fmtDashboardEur(stats.ca)} color={SU} T={T} />
      </div>

      <div className="inv-card" style={{ padding: 12, marginBottom: 12, background: "linear-gradient(135deg, rgba(255,255,255,.05), rgba(255,255,255,.025))" }}>
        <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 7 }}>
          Import accepté : CSV, JSON, TXT, VCF ou liste collée. Champs reconnus : prénom, nom, téléphone, email, source, responsable, objectif, budget, zone, relance, note.
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

      <div className="inv-card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
          <ViewButton
            active={viewMode === "pipeline"}
            icon={Target}
            label="Pipeline"
            helper="Drag & drop par statut"
            onClick={() => setViewMode("pipeline")}
            T={T}
          />
          <ViewButton
            active={viewMode === "liste"}
            icon={ListChecks}
            label="Liste"
            helper="Lecture détaillée et rapide"
            onClick={() => setViewMode("liste")}
            T={T}
          />
          <ViewButton
            active={viewMode === "planning"}
            icon={CalendarDays}
            label="Planning"
            helper="Relances à 7j, 14j, 30j et 3 mois"
            onClick={() => setViewMode("planning")}
            T={T}
          />
          <ViewButton
            active={viewMode === "analyse"}
            icon={BarChart3}
            label="Analyse"
            helper="KPI, sources et conversion"
            onClick={() => setViewMode("analyse")}
            T={T}
          />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
          {viewMode === "analyse" ? (
            <KpiAnalysisView
              prospects={filtered}
              stats={stats}
              T={T}
            />
          ) : viewMode === "planning" ? (
            <PlanningPanel
              buckets={planningBuckets}
              onSelect={selectProspect}
              selectedId={selected?.id}
              T={T}
            />
          ) : viewMode === "liste" ? (
            <ListView
              prospects={filtered}
              selectedId={selected?.id}
              onSelect={selectProspect}
              onStatusChange={updateProspectStatus}
              T={T}
            />
          ) : (
            <PipelineView
              grouped={grouped}
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
          )}
      </div>

      {(isCreating || selected) && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsCreating(false);
              setSelected(null);
              setForm({ ...EMPTY_FORM });
              setActions([]);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(2,6,23,.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div className="inv-card" onMouseDown={(e) => e.stopPropagation()} style={{ padding: 0, width: "min(1100px, 96vw)", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 30px 90px rgba(0,0,0,.45)" }}>
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

                <SectionTitle icon={UserPlus} title="Identité du prospect" T={T} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: 10,
                    marginBottom: 12,
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
                </div>

                <SectionTitle icon={Target} title="Projet et potentiel commercial" T={T} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
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

                <SectionTitle icon={CalendarDays} title="Suivi commercial et relances" T={T} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(230px, 300px)",
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
      )}

      {bulkImportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBulkImportOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(2,6,23,.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            className="inv-card"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(960px, 96vw)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 0,
              boxShadow: "0 30px 90px rgba(0,0,0,.45)",
            }}
          >
            <div
              className="inv-card-hd blue"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={ListChecks} size={14} />
                Intégrer une liste de prospects
              </span>

              <button
                className="inv-btn inv-btn-out inv-btn-sm"
                type="button"
                onClick={() => setBulkImportOpen(false)}
              >
                <Icon as={X} size={12} />
              </button>
            </div>

            <div className="inv-card-bd" style={{ padding: 14 }}>
              <div style={{ color: T.textSub, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                Colle une liste de prospects. Tu peux utiliser un CSV avec en-têtes, ou une ligne par prospect au format simple :
                <br />
                <strong style={{ color: T.text }}>Nom complet ; Téléphone ; Email ; Source ; Objectif ; Budget ; Zone ; Note</strong>
              </div>

              <textarea
                className="inv-textarea"
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                placeholder={`prenom;nom;telephone;email;source;responsable;objectif;budget;zone;note\nJean;Dupont;0600000000;jean@email.fr;Fluidify;Matthieu;Créer du patrimoine;250000;Angers;Lead entrant qualifié\nMarie Martin;0611111111;marie@email.fr;Instagram;Cash-flow;200000;Saumur;À rappeler rapidement`}
                rows={12}
                style={{ width: "100%", fontSize: 13, fontFamily: "'DM Mono', monospace" }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <div style={{ color: T.textMuted, fontSize: 12 }}>
                  Formats acceptés : CSV avec en-têtes, liste au séparateur point-virgule, blocs texte avec Téléphone / Email / Budget.
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="inv-btn inv-btn-out" type="button" onClick={() => setBulkImportOpen(false)}>
                    Annuler
                  </button>
                  <button className="inv-btn inv-btn-blue" type="button" onClick={handleBulkImportProspects} disabled={importing}>
                    <Icon as={Upload} size={14} />
                    {importing ? "Import..." : "Importer la liste"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
