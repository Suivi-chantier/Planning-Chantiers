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
  MessageSquare,
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
  ExternalLink,
} from "lucide-react";

/**
 * CRM Prospection — V19.8 historique des échanges mis en avant
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
  "Fluidify",
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
  prochain_point_etape: "",
  date_prochain_point_etape: "",
  date_rdv: "",
  honoraires_estimes_ht: "",
  commentaire: "",
};

const EMPTY_ACTION = {
  type_action: "note",
  resume: "",
  tache_resume: "",
  tache_collaborateur: "",
  tache_email: "",
  tache_date: "",
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

function normalizeSearch(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function conseillerKey(name) {
  const normalized = normalizeSearch(name);

  if (!normalized) return "";

  // Matthieu, Matthieu Fumoleau, mf.centralisation et variantes doivent être regroupés.
  if (
    normalized === "matthieu" ||
    normalized === "matthieu fumoleau" ||
    normalized.includes("mf.centralisation") ||
    (normalized.includes("matthieu") && normalized.includes("fumoleau"))
  ) {
    return "matthieu-fumoleau";
  }

  return normalized;
}

function conseillerDisplayName(name) {
  const key = conseillerKey(name);

  if (!key) return "";
  if (key === "matthieu-fumoleau") return "Matthieu Fumoleau";

  return txt(name);
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

function isSignedStatus(statut) {
  return ["signe", "converti"].includes(statut);
}

function isLostStatus(statut) {
  return statut === "perdu";
}

function isRelaunchStatus(statut) {
  return ["relance", "relance_1", "relance_2"].includes(statut);
}

function moneyValue(p) {
  return Number(p?.ca_potentiel_ht || p?.honoraires_estimes_ht || 0) || 0;
}

function isFluidifySource(source) {
  return String(source || "").toLowerCase().includes("fluidify");
}

function fluidifyData(p = {}) {
  const root = p?.donnees || {};
  const data = root.fluidify || root.Fluidify || {};

  return {
    icp: data.icp || "",
    linkedin: data.linkedin || data.profil_linkedin || data.profilLinkedin || "",
    date_lancement_campagne: data.date_lancement_campagne || data.dateLancementCampagne || "",
    statut_conversation: data.statut_conversation || data.statutConversation || "",
    type_reponse: data.type_reponse || data.typeReponse || "",
    lien_conversation_lemlist: data.lien_conversation_lemlist || data.lienConversationLemlist || "",
    funnel: data.funnel || "",
    commentaires: data.commentaires || "",
    imported_at: data.imported_at || "",
    payload_original: data.payload_original || null,
  };
}

function hasFluidifyData(p = {}) {
  const data = fluidifyData(p);
  return isFluidifySource(p.source) || Object.values(data).some(Boolean);
}

function fmtDateTimeMaybe(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function containsPositiveIntent(text = "") {
  const value = String(text || "").toLowerCase();
  return [
    "interested",
    "intéress",
    "interess",
    "rdv",
    "rendez",
    "ok pour",
    "partant",
    "souhaite",
    "demande",
    "rappeler",
    "call",
    "meeting",
    "échange",
    "echange",
  ].some((word) => value.includes(word));
}

function transformationScoreDetail(p = {}) {
  if (p.statut === "perdu") {
    return {
      score: 0,
      label: "Perdu",
      color: DA,
      reasons: ["Prospect classé perdu."],
      penalties: [],
      breakdown: { intention: 0, avancement: 0, qualification: 0, suivi: 0 },
    };
  }

  if (p.statut === "signe" || p.statut === "converti") {
    return {
      score: 100,
      label: "Signé",
      color: SU,
      reasons: ["Prospect transformé en client."],
      penalties: [],
      breakdown: { intention: 35, avancement: 25, qualification: 25, suivi: 15 },
    };
  }

  const data = fluidifyData(p);
  const reasons = [];
  const penalties = [];

  let intention = 0;
  const funnel = String(data.funnel || "").toLowerCase();
  const conversation = String(data.statut_conversation || "").toLowerCase();
  const typeReponse = String(data.type_reponse || "");
  const commentaires = String(data.commentaires || p.commentaire || "");
  const objectif = String(p.objectif || data.icp || "");

  if (p.date_rdv || funnel.includes("rdv")) {
    intention = 35;
    reasons.push("RDV identifié ou déjà calé.");
  } else if (funnel.includes("interested") || containsPositiveIntent(typeReponse) || containsPositiveIntent(commentaires)) {
    intention = 25;
    reasons.push("Signal d’intérêt positif détecté.");
  } else if (objectif.length > 12 || typeReponse.length > 12) {
    intention = 20;
    reasons.push("Besoin ou réponse exploitable identifié.");
  } else if (conversation || funnel) {
    intention = 10;
    reasons.push("Conversation engagée mais intention encore faible.");
  }

  let avancement = 0;
  switch (p.statut) {
    case "proposition":
      avancement = 25;
      reasons.push("Proposition envoyée.");
      break;
    case "rdv":
      avancement = 20;
      reasons.push("Prospect passé en étape RDV.");
      break;
    case "contact":
      avancement = 10;
      reasons.push("Premier contact engagé.");
      break;
    case "relance":
      avancement = 8;
      reasons.push("Prospect en relance simple.");
      break;
    case "relance_1":
      avancement = 6;
      reasons.push("Prospect en Relance 1.");
      break;
    case "relance_2":
      avancement = 3;
      reasons.push("Prospect en Relance 2 : probabilité plus faible.");
      break;
    case "nouveau":
    default:
      avancement = 5;
      reasons.push("Lead entrant à traiter.");
      break;
  }

  let qualification = 0;
  if (p.telephone || p.email) {
    qualification += 5;
    reasons.push("Coordonnées exploitables.");
  } else {
    penalties.push("Aucun téléphone ou email renseigné.");
  }

  if (p.objectif || data.icp) {
    qualification += 5;
    reasons.push("Objectif ou ICP renseigné.");
  }

  if (Number(p.budget_global || 0) > 0) {
    qualification += 7;
    reasons.push("Budget renseigné.");
  }

  if (p.zone_recherche) {
    qualification += 4;
    reasons.push("Zone géographique renseignée.");
  }

  if (data.icp) {
    qualification += 4;
    reasons.push("Profil investisseur / ICP Fluidify disponible.");
  }

  let suivi = 0;
  const actionDate = dateOnly(p.date_prochaine_action);
  const rdvDate = dateOnly(p.date_rdv);
  const today = todayIso();
  const next14 = addDays(14);

  if (rdvDate && rdvDate >= today && rdvDate <= next14) {
    suivi += 15;
    reasons.push("RDV prévu prochainement.");
  } else if (rdvDate) {
    suivi += 10;
    reasons.push("RDV renseigné.");
  } else if (actionDate && actionDate >= today) {
    suivi += 8;
    reasons.push("Prochaine action planifiée.");
  }

  let penalty = 0;

  if (isLate(p.date_prochaine_action)) {
    penalty -= 10;
    penalties.push("Action de relance en retard.");
  }

  if (isActiveProspect(p) && !p.date_prochaine_action && !p.date_rdv) {
    penalty -= 10;
    penalties.push("Aucune prochaine action planifiée.");
  }

  if (p.statut === "relance_2" && !p.date_rdv) {
    penalty -= 10;
    penalties.push("Relance 2 sans RDV : probabilité de transformation réduite.");
  }

  if (!p.telephone && !p.email) {
    penalty -= 8;
    penalties.push("Prospect difficilement joignable.");
  }

  const rawScore = intention + avancement + qualification + suivi + penalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let label = "Froid";
  let color = "#60A5FA";

  if (score >= 70) {
    label = "Chaud";
    color = "#EF4444";
  } else if (score >= 40) {
    label = "Tiède";
    color = WA;
  }

  return {
    score,
    label,
    color,
    reasons: reasons.slice(0, 7),
    penalties,
    breakdown: {
      intention,
      avancement,
      qualification,
      suivi,
      penalty,
    },
  };
}

function priorityScore(p) {
  return transformationScoreDetail(p).score;
}

function temperature(p) {
  const detail = transformationScoreDetail(p);
  return {
    label: detail.label,
    color: detail.color,
    score: detail.score,
    reasons: detail.reasons,
    penalties: detail.penalties,
    breakdown: detail.breakdown,
  };
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
    prochain_point_etape: p.donnees?.suivi?.prochain_point_etape || p.donnees?.prochain_point_etape || "",
    date_prochain_point_etape: dateOnly(p.donnees?.suivi?.date_prochain_point_etape || p.donnees?.date_prochain_point_etape),
    date_rdv: dateOnly(p.date_rdv),
    honoraires_estimes_ht: p.honoraires_estimes_ht ?? p.ca_potentiel_ht ?? "",
    commentaire: p.commentaire || "",
    donnees: p.donnees || {},
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
    donnees: {
      ...(form.donnees || {}),
      suivi: {
        ...((form.donnees || {}).suivi || {}),
        prochain_point_etape: txt(form.prochain_point_etape),
        date_prochain_point_etape: form.date_prochain_point_etape || null,
      },
    },
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

function AnalysisStatCard({ icon, label, value, helper, color, T }) {
  const IconStat = icon;
  return (
    <div
      className="inv-card"
      style={{
        padding: 14,
        background: `linear-gradient(135deg, ${color || T.accent}14, rgba(255,255,255,.035))`,
        border: `1px solid ${color || T.accent}2E`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
          <div style={{ color: T.text, fontSize: 24, fontWeight: 950, marginTop: 5, lineHeight: 1 }}>{value}</div>
          {helper ? <div style={{ color: T.textMuted, fontSize: 11, marginTop: 6 }}>{helper}</div> : null}
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            background: `${color || T.accent}1C`,
            border: `1px solid ${color || T.accent}42`,
            color: color || T.accent,
            flexShrink: 0,
          }}
        >
          <Icon as={IconStat} size={18} />
        </div>
      </div>
    </div>
  );
}

function AdvancedBarRow({ label, value, max, color, T, helper, valueLabel }) {
  const pct = max > 0 ? Math.max(3, Math.min(100, (Number(value || 0) / max) * 100)) : 0;

  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5, alignItems: "baseline" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.textSub,
              fontSize: 11.5,
              fontWeight: 900,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
          {helper ? <div style={{ color: T.textMuted, fontSize: 10, marginTop: 1 }}>{helper}</div> : null}
        </div>
        <div style={{ color: T.text, fontSize: 11.5, fontWeight: 950, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{valueLabel || value}</div>
      </div>
      <div style={{ height: 9, borderRadius: 999, background: "rgba(148,163,184,.15)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: color || T.accent }} />
      </div>
    </div>
  );
}

function AdvancedBarCard({ title, subtitle, icon, color, data, T, money = false, valueSuffix = "" }) {
  const IconChart = icon;
  const max = Math.max(1, ...data.map((d) => Number(d.value || 0)));

  return (
    <div className="inv-card" style={{ padding: 14, minHeight: 280 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 13 }}>
        <div>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7 }}>
            <Icon as={IconChart} size={15} />
            {title}
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 3 }}>{subtitle}</div>
        </div>
      </div>

      {data.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 20, textAlign: "center" }}>
          Pas encore assez de données
        </div>
      ) : (
        data.slice(0, 9).map((row) => (
          <AdvancedBarRow
            key={row.label}
            label={row.label}
            value={row.value}
            max={max}
            color={row.color || color}
            T={T}
            helper={row.helper}
            valueLabel={money ? fmtDashboardEur(row.value) : `${row.value}${valueSuffix}`}
          />
        ))
      )}
    </div>
  );
}

function ConversionSourceCard({ data, T }) {
  const max = Math.max(1, ...data.map((d) => d.total));

  return (
    <div className="inv-card" style={{ padding: 14, minHeight: 300 }}>
      <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <Icon as={PieChart} size={15} />
        Conversion par source
      </div>
      <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 14 }}>
        Volume, signés et taux de conversion par canal d'acquisition
      </div>

      {data.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: 12, border: `1px dashed ${T.border}`, borderRadius: 14, padding: 20, textAlign: "center" }}>
          Pas encore de source renseignée
        </div>
      ) : (
        data.slice(0, 8).map((row) => {
          const pct = max > 0 ? Math.max(4, (row.total / max) * 100) : 0;
          return (
            <div key={row.label} style={{ marginBottom: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                <div style={{ color: T.textSub, fontSize: 11.5, fontWeight: 900 }}>{row.label}</div>
                <div style={{ color: T.text, fontSize: 11.5, fontWeight: 950, fontFamily: "'DM Mono', monospace" }}>
                  {row.signed}/{row.total} · {row.rate}%
                </div>
              </div>
              <div style={{ height: 9, borderRadius: 999, background: "rgba(148,163,184,.15)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "rgba(96,165,250,.45)", borderRadius: 999 }} />
                <div style={{ position: "absolute", inset: 0, width: `${Math.min(100, (pct * row.rate) / 100)}%`, background: SU, borderRadius: 999 }} />
              </div>
              <div style={{ color: T.textMuted, fontSize: 10, marginTop: 3 }}>
                RDV : {row.rdv} · Proposition : {row.proposal} · CA signé : {fmtDashboardEur(row.signedCa)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MiniTrendCard({ data, T }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.created, d.signed]));

  return (
    <div className="inv-card" style={{ padding: 14, minHeight: 300 }}>
      <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <Icon as={TrendingUp} size={15} />
        Évolution mensuelle
      </div>
      <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 14 }}>
        Prospects entrants et signatures par mois
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(34px, 1fr))`, gap: 8, alignItems: "end", height: 170 }}>
        {data.map((row) => (
          <div key={row.label} style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
            <div style={{ height: "130px", display: "flex", alignItems: "end", justifyContent: "center", gap: 4, width: "100%" }}>
              <div
                title={`Entrants : ${row.created}`}
                style={{
                  width: "38%",
                  height: `${Math.max(3, (row.created / max) * 100)}%`,
                  borderRadius: "9px 9px 3px 3px",
                  background: "#60A5FA",
                  opacity: .9,
                }}
              />
              <div
                title={`Signés : ${row.signed}`}
                style={{
                  width: "38%",
                  height: `${Math.max(3, (row.signed / max) * 100)}%`,
                  borderRadius: "9px 9px 3px 3px",
                  background: SU,
                  opacity: .95,
                }}
              />
            </div>
            <div style={{ color: T.textMuted, fontSize: 10, textAlign: "center", minHeight: 24 }}>{row.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 10, color: T.textMuted, fontSize: 11 }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "#60A5FA", marginRight: 5 }} />Entrants</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: SU, marginRight: 5 }} />Signés</span>
      </div>
    </div>
  );
}

function FluidifyFocusCard({ prospects, T }) {
  const fluidify = prospects.filter((p) => isFluidifySource(p.source));
  const total = fluidify.length;
  const contacted = fluidify.filter((p) => ["contact", "relance", "relance_1", "relance_2", "rdv", "proposition", "signe", "converti"].includes(p.statut)).length;
  const relaunch = fluidify.filter((p) => isRelaunchStatus(p.statut)).length;
  const rdv = fluidify.filter((p) => p.statut === "rdv" || p.date_rdv || ["proposition", "signe", "converti"].includes(p.statut)).length;
  const proposal = fluidify.filter((p) => ["proposition", "signe", "converti"].includes(p.statut)).length;
  const signed = fluidify.filter((p) => isSignedStatus(p.statut)).length;
  const signedCa = fluidify.filter((p) => isSignedStatus(p.statut)).reduce((s, p) => s + moneyValue(p), 0);
  const potential = fluidify.reduce((s, p) => s + moneyValue(p), 0);
  const withLinkedIn = fluidify.filter((p) => Boolean(fluidifyData(p).linkedin)).length;
  const withLemlist = fluidify.filter((p) => Boolean(fluidifyData(p).lien_conversation_lemlist)).length;
  const withConversationStatus = fluidify.filter((p) => Boolean(fluidifyData(p).statut_conversation)).length;

  const funnelRows = groupCount(fluidify, (p) => fluidifyData(p).funnel || "Non renseigné").slice(0, 5);
  const conversationRows = groupCount(fluidify, (p) => fluidifyData(p).statut_conversation || "Non renseigné").slice(0, 5);

  const steps = [
    { label: "Leads", value: total, color: "#60A5FA" },
    { label: "Contactés", value: contacted, color: "#F59E0B" },
    { label: "Relances", value: relaunch, color: "#F97316" },
    { label: "RDV", value: rdv, color: "#8B5CF6" },
    { label: "Propositions", value: proposal, color: "#22C55E" },
    { label: "Signés", value: signed, color: SU },
  ];

  const max = Math.max(1, ...steps.map((s) => s.value));
  const rate = total > 0 ? Math.round((signed / total) * 100) : 0;

  return (
    <div className="inv-card" style={{ padding: 14, minHeight: 300, background: "linear-gradient(135deg, rgba(201,163,74,.13), rgba(255,255,255,.035))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7 }}>
            <Icon as={Target} size={15} />
            Focus Fluidify
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 3 }}>Lecture dédiée des leads entrants Fluidify</div>
        </div>
        <Badge color={T.accent} T={T}>{rate}% signé</Badge>
      </div>

      {steps.map((step) => (
        <AdvancedBarRow
          key={step.label}
          label={step.label}
          value={step.value}
          max={max}
          color={step.color}
          T={T}
          valueLabel={String(step.value)}
        />
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 10, background: "rgba(255,255,255,.035)" }}>
          <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900 }}>CA potentiel</div>
          <div style={{ color: T.text, fontSize: 17, fontWeight: 950, marginTop: 3 }}>{fmtDashboardEur(potential)}</div>
        </div>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 10, background: "rgba(255,255,255,.035)" }}>
          <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900 }}>CA signé</div>
          <div style={{ color: SU, fontSize: 17, fontWeight: 950, marginTop: 3 }}>{fmtDashboardEur(signedCa)}</div>
        </div>
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 10, background: "rgba(255,255,255,.035)" }}>
          <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900 }}>Données utiles</div>
          <div style={{ color: T.text, fontSize: 12, fontWeight: 850, marginTop: 3, lineHeight: 1.45 }}>
            LinkedIn : {withLinkedIn}/{total}<br />
            Lemlist : {withLemlist}/{total}<br />
            Statut conv. : {withConversationStatus}/{total}
          </div>
        </div>
      </div>

      {(funnelRows.length > 0 || conversationRows.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
          <div>
            <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
              Funnel Fluidify
            </div>
            {funnelRows.map((row) => (
              <AdvancedBarRow key={row.label} label={row.label} value={row.value} max={Math.max(1, ...funnelRows.map((r) => r.value))} color={T.accent} T={T} valueLabel={String(row.value)} />
            ))}
          </div>

          <div>
            <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
              Statut conversation
            </div>
            {conversationRows.map((row) => (
              <AdvancedBarRow key={row.label} label={row.label} value={row.value} max={Math.max(1, ...conversationRows.map((r) => r.value))} color="#60A5FA" T={T} valueLabel={String(row.value)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightPanel({ insights, T }) {
  return (
    <div className="inv-card" style={{ padding: 14 }}>
      <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <Icon as={Bell} size={15} />
        Points d'attention automatiques
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {insights.map((insight, index) => (
          <div
            key={`${insight.label}-${index}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              border: `1px solid ${insight.color}32`,
              background: `${insight.color}12`,
              borderRadius: 14,
              padding: 10,
            }}
          >
            <div style={{ width: 24, height: 24, borderRadius: 9, background: `${insight.color}1E`, color: insight.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon as={insight.icon} size={13} />
            </div>
            <div>
              <div style={{ color: T.text, fontSize: 12, fontWeight: 950 }}>{insight.label}</div>
              <div style={{ color: T.textSub, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{insight.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiAnalysisView({ prospects, stats, T }) {
  const total = prospects.length;
  const active = prospects.filter(isActiveProspect).length;
  const signed = prospects.filter((p) => isSignedStatus(p.statut)).length;
  const lost = prospects.filter((p) => isLostStatus(p.statut)).length;
  const late = prospects.filter((p) => isLate(p.date_prochaine_action) && isActiveProspect(p)).length;
  const withoutNextAction = prospects.filter((p) => isActiveProspect(p) && !p.date_prochaine_action).length;
  const withoutContact = prospects.filter((p) => !p.telephone && !p.email).length;
  const relance2 = prospects.filter((p) => p.statut === "relance_2").length;
  const propositions = prospects.filter((p) => ["proposition", "signe", "converti"].includes(p.statut)).length;
  const rdv = prospects.filter((p) => p.statut === "rdv" || p.date_rdv).length;
  const caPotential = prospects.reduce((sum, p) => sum + moneyValue(p), 0);
  const caSigned = prospects.filter((p) => isSignedStatus(p.statut)).reduce((sum, p) => sum + moneyValue(p), 0);

  const conversionRate = total > 0 ? Math.round((signed / total) * 100) : 0;
  const proposalRate = total > 0 ? Math.round((propositions / total) * 100) : 0;
  const rdvRate = total > 0 ? Math.round((rdv / total) * 100) : 0;
  const lostRate = total > 0 ? Math.round((lost / total) * 100) : 0;

  const byStatus = STATUTS.map((s) => ({
    label: s.label,
    value: prospects.filter((p) => p.statut === s.id || (s.id === "signe" && p.statut === "converti")).length,
    color: s.color,
    helper: s.tone,
  }));

  const bySourceCount = groupCount(prospects, (p) => p.source).slice(0, 8);
  const byResponsable = groupCount(prospects, (p) => conseillerDisplayName(p.responsable) || "Non renseigné").slice(0, 8);
  const caByStatus = groupSum(prospects, (p) => statusOf(p.statut).label, moneyValue).slice(0, 9);
  const caBySource = groupSum(prospects, (p) => p.source, moneyValue).slice(0, 8);

  const sourceMap = new Map();
  prospects.forEach((p) => {
    const label = String(p.source || "Non renseigné").trim() || "Non renseigné";
    const row = sourceMap.get(label) || { label, total: 0, signed: 0, rdv: 0, proposal: 0, signedCa: 0 };
    row.total += 1;
    if (isSignedStatus(p.statut)) {
      row.signed += 1;
      row.signedCa += moneyValue(p);
    }
    if (p.statut === "rdv" || p.date_rdv || ["proposition", "signe", "converti"].includes(p.statut)) row.rdv += 1;
    if (["proposition", "signe", "converti"].includes(p.statut)) row.proposal += 1;
    sourceMap.set(label, row);
  });
  const conversionBySource = Array.from(sourceMap.values())
    .map((row) => ({ ...row, rate: row.total > 0 ? Math.round((row.signed / row.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate);

  const monthMap = new Map();
  prospects.forEach((p) => {
    const createdKey = monthKey(p.created_at || p.date_premier_contact || p.updated_at);
    const createdRow = monthMap.get(createdKey) || { key: createdKey, created: 0, signed: 0 };
    createdRow.created += 1;
    monthMap.set(createdKey, createdRow);

    if (isSignedStatus(p.statut)) {
      const signedKey = monthKey(p.converted_at || p.date_signature || p.updated_at || p.created_at);
      const signedRow = monthMap.get(signedKey) || { key: signedKey, created: 0, signed: 0 };
      signedRow.signed += 1;
      monthMap.set(signedKey, signedRow);
    }
  });
  const byMonth = Array.from(monthMap.values())
    .filter((row) => row.key && row.key !== "Non daté")
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-8)
    .map((row) => ({ ...row, label: monthLabel(row.key) }));

  const insights = [];
  if (late > 0) insights.push({ icon: AlertTriangle, color: DA, label: `${late} prospect(s) en retard`, text: "Des relances sont dépassées. À traiter en priorité dans la vue Planning." });
  if (relance2 > 0) insights.push({ icon: RefreshCw, color: "#EF4444", label: `${relance2} prospect(s) en Relance 2`, text: "Ces prospects risquent de sortir du tunnel. Prévoir une décision : dernier appel, RDV, ou perdu." });
  if (withoutNextAction > 0) insights.push({ icon: Clock, color: WA, label: `${withoutNextAction} prospect(s) sans prochaine action`, text: "Chaque prospect actif devrait avoir une prochaine action et une date de relance." });
  if (withoutContact > 0) insights.push({ icon: Mail, color: WA, label: `${withoutContact} prospect(s) sans contact`, text: "Téléphone ou email manquant : la qualité de la donnée doit être améliorée." });
  if (conversionRate >= 25 && total >= 4) insights.push({ icon: CheckCircle2, color: SU, label: "Conversion encourageante", text: `Le taux de conversion est de ${conversionRate}%. L'enjeu est maintenant d'augmenter le volume qualifié.` });
  if (!insights.length) insights.push({ icon: CheckCircle2, color: SU, label: "Pipeline propre", text: "Aucun point bloquant majeur détecté dans les données actuelles." });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <AnalysisStatCard icon={Users} label="Prospects" value={total} helper={`${active} actifs`} color="#60A5FA" T={T} />
        <AnalysisStatCard icon={TrendingUp} label="Conversion" value={`${conversionRate}%`} helper={`${signed} signé(s) · ${lostRate}% perdus`} color={conversionRate >= 25 ? SU : WA} T={T} />
        <AnalysisStatCard icon={Calendar} label="RDV" value={`${rdvRate}%`} helper={`${rdv} RDV identifiés`} color="#8B5CF6" T={T} />
        <AnalysisStatCard icon={Target} label="Proposition" value={`${proposalRate}%`} helper={`${propositions} proposition(s)`} color="#22C55E" T={T} />
        <AnalysisStatCard icon={Clock} label="Retards" value={late} helper="Relances dépassées" color={late > 0 ? DA : SU} T={T} />
        <AnalysisStatCard icon={Euro} label="CA signé" value={fmtDashboardEur(caSigned)} helper={`Potentiel : ${fmtDashboardEur(caPotential)}`} color={SU} T={T} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, .75fr)", gap: 12 }}>
        <AdvancedBarCard
          title="Tunnel commercial"
          subtitle="Répartition des prospects dans chaque étape du pipeline"
          icon={BarChart3}
          color="#60A5FA"
          data={byStatus}
          T={T}
        />
        <InsightPanel insights={insights} T={T} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <AdvancedBarCard title="Leads par source" subtitle="Volume généré par canal" icon={PieChart} color="#60A5FA" data={bySourceCount} T={T} />
        <ConversionSourceCard data={conversionBySource} T={T} />
        <FluidifyFocusCard prospects={prospects} T={T} />
        <MiniTrendCard data={byMonth} T={T} />
        <AdvancedBarCard title="CA potentiel par statut" subtitle="Valeur estimée du pipeline par étape" icon={Euro} color={WA} data={caByStatus} T={T} money />
        <AdvancedBarCard title="CA potentiel par source" subtitle="Canaux qui portent le plus de valeur commerciale" icon={Euro} color={SU} data={caBySource} T={T} money />
        <AdvancedBarCard title="Prospects par responsable" subtitle="Répartition de la charge commerciale" icon={Users} color="#8B5CF6" data={byResponsable} T={T} />
        <AdvancedBarCard
          title="Qualité des données"
          subtitle="Points à corriger pour fiabiliser le suivi commercial"
          icon={ListChecks}
          color={DA}
          data={[
            { label: "Sans prochaine action", value: withoutNextAction, helper: "Prospects actifs" },
            { label: "Sans téléphone / email", value: withoutContact, helper: "Données de contact" },
            { label: "Relance 2", value: relance2, helper: "Risque de perte" },
            { label: "En retard", value: late, helper: "Relance dépassée" },
          ].filter((row) => row.value > 0)}
          T={T}
        />
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
              <Icon as={Clock} size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.prochaine_action || "Aucune action"}
                {p.date_prochaine_action ? ` · ${fmtDate(p.date_prochaine_action)}` : ""}
              </span>
            </div>

            <Badge color={temp.color} T={T}>{temp.label} · {temp.score}/100</Badge>
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
        <Badge color={temp.color} T={T}>{temp.label} · {temp.score}/100</Badge>
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
                    <Badge color={temp.color} T={T}>{temp.label} · {temp.score}/100</Badge>
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
                  {conseillerDisplayName(p.responsable) || "—"}
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

function FicheSection({ title, icon, children, T, accent, helper }) {
  const color = accent || T.accent;

  return (
    <section
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 20,
        padding: 12,
        marginBottom: 12,
        background: "linear-gradient(135deg, rgba(255,255,255,.045), rgba(255,255,255,.022))",
        boxShadow: "0 14px 35px rgba(2,6,23,.14)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              background: `${color}18`,
              color,
              border: `1px solid ${color}35`,
              flexShrink: 0,
            }}
          >
            <Icon as={icon} size={14} />
          </span>

          <div style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 13, fontWeight: 950 }}>
              {title}
            </div>
            {helper && (
              <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2, lineHeight: 1.3 }}>
                {helper}
              </div>
            )}
          </div>
        </div>
      </div>

      {children}
    </section>
  );
}

function ProspectHistoryCard({ actions, T }) {
  const count = actions?.length || 0;

  return (
    <section
      style={{
        border: `1px solid ${T.accent}55`,
        borderRadius: 22,
        padding: 16,
        margin: "0 0 16px",
        background: "linear-gradient(135deg, rgba(201,163,74,.16), rgba(255,255,255,.035))",
        boxShadow: "0 20px 55px rgba(2,6,23,.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 9,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 15,
              display: "grid",
              placeItems: "center",
              background: `${T.accent}18`,
              color: T.accent,
              border: `1px solid ${T.accent}35`,
              flexShrink: 0,
            }}
          >
            <Icon as={ListChecks} size={18} />
          </span>

          <div style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 17, fontWeight: 950 }}>
              Historique des échanges
            </div>
            <div style={{ color: T.textSub, fontSize: 12.5, marginTop: 3, lineHeight: 1.35 }}>
              Derniers échanges, tâches assignées et suites prévues avant de reprendre contact.
            </div>
          </div>
        </div>

        <Badge color={T.accent} T={T}>
          {count} action{count > 1 ? "s" : ""}
        </Badge>
      </div>

      <div style={{ maxHeight: 390, overflowY: "auto", paddingRight: 6 }}>
        {count === 0 ? (
          <div
            style={{
              color: T.textMuted,
              fontSize: 13,
              padding: 14,
              border: `1px dashed ${T.border}`,
              borderRadius: 14,
              background: "rgba(255,255,255,.025)",
            }}
          >
            Aucun échange historisé pour le moment.
          </div>
        ) : (
          actions.map((a) => <ActionRow key={a.id} action={a} T={T} />)
        )}
      </div>
    </section>
  );
}

function ProspectSummaryCard({ prospect, T }) {
  const detail = transformationScoreDetail(prospect);
  const conseiller = conseillerDisplayName(prospect.responsable) || "Conseiller non renseigné";
  const action = txt(prospect.prochaine_action) || "Action à définir";
  const actionDate = dateOnly(prospect.date_prochaine_action);
  const etape = txt(prospect.prochain_point_etape) || "Point d’étape à définir";
  const etapeDate = dateOnly(prospect.date_prochain_point_etape);
  const isActionLate = actionDate && actionDate < todayIso();

  const summaryItems = [
    {
      label: "Conseiller",
      value: conseiller,
      icon: Users,
      color: T.accent,
    },
    {
      label: "Action à faire",
      value: action,
      helper: actionDate ? fmtDate(actionDate) : "Date à définir",
      icon: Clock,
      color: isActionLate ? DA : WA,
    },
    {
      label: "Point d’étape",
      value: etape,
      helper: etapeDate ? fmtDate(etapeDate) : "Date à définir",
      icon: CalendarDays,
      color: "#8B5CF6",
    },
    {
      label: "Score",
      value: `${detail.label} · ${detail.score}/100`,
      icon: TrendingUp,
      color: detail.color,
    },
  ];

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 20,
        padding: 12,
        margin: "10px 0 14px",
        background: "linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.025))",
        position: "sticky",
        top: 0,
        zIndex: 3,
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 9,
        }}
      >
        {summaryItems.map((item) => (
          <div
            key={item.label}
            style={{
              border: `1px solid ${item.color}35`,
              background: `${item.color}10`,
              borderRadius: 16,
              padding: 10,
              display: "flex",
              alignItems: "center",
              gap: 9,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 12,
                background: `${item.color}18`,
                border: `1px solid ${item.color}45`,
                color: item.color,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <Icon as={item.icon} size={14} />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em" }}>
                {item.label}
              </div>
              <div
                style={{
                  color: T.text,
                  fontSize: 12.5,
                  fontWeight: 950,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={item.value}
              >
                {item.value}
              </div>
              {item.helper && (
                <div style={{ color: item.color, fontSize: 10.5, fontWeight: 900, marginTop: 2 }}>
                  {item.helper}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreTransformationCard({ prospect, T }) {
  const detail = transformationScoreDetail(prospect);
  const maxBreakdown = 35;

  const breakdownRows = [
    ["Intention", detail.breakdown.intention, 35],
    ["Avancement", detail.breakdown.avancement, 25],
    ["Qualification", detail.breakdown.qualification, 25],
    ["Suivi", detail.breakdown.suivi, 15],
  ];

  return (
    <div
      style={{
        border: `1px solid ${detail.color}45`,
        borderRadius: 22,
        padding: 14,
        margin: "0 0 12px",
        background: `linear-gradient(135deg, ${detail.color}18, rgba(255,255,255,.035))`,
        boxShadow: `0 18px 45px ${detail.color}14`,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, .82fr) minmax(420px, 1.25fr) minmax(260px, .9fr)",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            border: `1px solid ${detail.color}30`,
            borderRadius: 18,
            padding: 12,
            background: "rgba(255,255,255,.035)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 126,
          }}
        >
          <div>
            <div style={{ color: T.text, fontSize: 14, fontWeight: 950, display: "flex", alignItems: "center", gap: 7 }}>
              <Icon as={TrendingUp} size={15} />
              Score de transformation
            </div>
            <div style={{ color: T.textMuted, fontSize: 11.5, marginTop: 3, lineHeight: 1.35 }}>
              Probabilité estimée que le prospect signe un accompagnement Profero Invest.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
            <div>
              <div style={{ color: detail.color, fontSize: 34, lineHeight: 1, fontWeight: 950 }}>
                {detail.score}/100
              </div>
              <div style={{ color: detail.color, fontSize: 12, fontWeight: 950, marginTop: 4 }}>
                {detail.label}
              </div>
            </div>

            <Badge color={detail.color} T={T}>
              {detail.label}
            </Badge>
          </div>

          <div style={{ height: 10, borderRadius: 999, background: "rgba(148,163,184,.18)", overflow: "hidden", marginTop: 11 }}>
            <div
              style={{
                width: `${Math.max(3, detail.score)}%`,
                height: "100%",
                background: detail.color,
                borderRadius: 999,
              }}
            />
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 18,
            padding: 12,
            background: "rgba(255,255,255,.026)",
            minHeight: 126,
          }}
        >
          <div style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 9 }}>
            Décomposition du score
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            {breakdownRows.map(([label, value, max]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${T.border}`,
                  background: "rgba(255,255,255,.035)",
                  borderRadius: 14,
                  padding: "8px 10px",
                  minWidth: 0,
                }}
              >
                <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginTop: 5 }}>
                  <span style={{ color: T.text, fontSize: 16, fontWeight: 950 }}>{value}</span>
                  <span style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 850 }}>/{max}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,.18)", overflow: "hidden", marginTop: 7 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, (Number(value || 0) / Number(max || maxBreakdown)) * 100))}%`,
                      background: detail.color,
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 18,
            padding: 12,
            background: "rgba(255,255,255,.026)",
            minHeight: 126,
            display: "grid",
            gridTemplateColumns: detail.penalties.length > 0 ? "1fr 1fr" : "1fr",
            gap: 10,
          }}
        >
          <div>
            <div style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 7 }}>
              Motifs positifs
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {detail.reasons.slice(0, 4).map((reason) => (
                <div key={reason} style={{ color: T.textSub, fontSize: 11.3, lineHeight: 1.35 }}>
                  • {reason}
                </div>
              ))}
              {detail.reasons.length === 0 && (
                <div style={{ color: T.textMuted, fontSize: 11.3 }}>Aucun signal fort identifié.</div>
              )}
            </div>
          </div>

          {detail.penalties.length > 0 && (
            <div>
              <div style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 7 }}>
                Vigilance
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {detail.penalties.slice(0, 4).map((penalty) => (
                  <div key={penalty} style={{ color: WA, fontSize: 11.3, lineHeight: 1.35 }}>
                    • {penalty}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FluidifyDetailCard({ prospect, T }) {
  const data = fluidifyData(prospect);

  if (!hasFluidifyData(prospect)) return null;

  const rows = [
    ["ICP", data.icp],
    ["Funnel", data.funnel],
    ["Statut conversation", data.statut_conversation],
    ["Type de réponse", data.type_reponse],
    ["Date lancement campagne", data.date_lancement_campagne ? fmtDate(data.date_lancement_campagne) : "—"],
    ["Import Profero", data.imported_at ? fmtDateTimeMaybe(data.imported_at) : "—"],
  ];

  const hasLinkedIn = Boolean(data.linkedin);
  const hasLemlist = Boolean(data.lien_conversation_lemlist);

  return (
    <div
      style={{
        border: `1px solid ${T.accent}35`,
        borderRadius: 18,
        padding: 12,
        margin: "10px 0 12px",
        background: "linear-gradient(135deg, rgba(201,163,74,.13), rgba(255,255,255,.035))",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ color: T.text, fontSize: 13, fontWeight: 950, display: "flex", alignItems: "center", gap: 7 }}>
            <Icon as={Target} size={14} />
            Informations Fluidify
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>
            Données reçues automatiquement depuis Saleslab / Fluidify
          </div>
        </div>

        <Badge color={T.accent} T={T}>Source Fluidify</Badge>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8,
        }}
      >
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              border: `1px solid ${T.border}`,
              background: "rgba(255,255,255,.035)",
              borderRadius: 14,
              padding: "8px 10px",
              minHeight: 52,
            }}
          >
            <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em" }}>
              {label}
            </div>
            <div style={{ color: T.text, fontSize: 12.5, fontWeight: 800, marginTop: 4, lineHeight: 1.35 }}>
              {value || "—"}
            </div>
          </div>
        ))}
      </div>

      {(data.commentaires || hasLinkedIn || hasLemlist) && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {data.commentaires && (
            <div
              style={{
                border: `1px solid ${T.border}`,
                background: "rgba(255,255,255,.035)",
                borderRadius: 14,
                padding: 10,
              }}
            >
              <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
                Commentaires Fluidify
              </div>
              <div style={{ color: T.textSub, fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {data.commentaires}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {hasLinkedIn && (
              <a
                className="inv-btn inv-btn-out inv-btn-sm"
                href={data.linkedin}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none" }}
              >
                <Icon as={ExternalLink} size={12} />
                Ouvrir LinkedIn
              </a>
            )}

            {hasLemlist && (
              <a
                className="inv-btn inv-btn-out inv-btn-sm"
                href={data.lien_conversation_lemlist}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none" }}
              >
                <Icon as={ExternalLink} size={12} />
                Conversation Lemlist
              </a>
            )}

            <button
              className="inv-btn inv-btn-out inv-btn-sm"
              type="button"
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(data, null, 2))}
            >
              <Icon as={Copy} size={12} />
              Copier données Fluidify
            </button>
          </div>
        </div>
      )}
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
  const author = txt(
    action.created_by ||
    action.auteur ||
    action.donnees?.auteur ||
    action.donnees?.created_by ||
    ""
  );

  return (
    <div
      style={{
        padding: 14,
        marginBottom: 11,
        border: `1px solid ${action.donnees?.tache_assignee ? T.accent + "55" : T.border}`,
        borderLeft: `4px solid ${action.donnees?.tache_assignee ? T.accent : T.accent + "80"}`,
        borderRadius: 16,
        background: action.donnees?.tache_assignee
          ? "linear-gradient(135deg, rgba(201,163,74,.13), rgba(255,255,255,.035))"
          : "linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.025))",
        boxShadow: "0 10px 26px rgba(2,6,23,.16)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: T.text, fontWeight: 950, fontSize: 14, textTransform: "capitalize" }}>
            {action.type_action || "note"}
          </div>

          <div style={{ color: T.textMuted, fontSize: 11.5, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon as={Users} size={12} />
            <span>{author || "Collaborateur non renseigné"}</span>
          </div>
        </div>

        <div style={{ color: T.textSub, fontSize: 12, fontWeight: 850, whiteSpace: "nowrap", fontFamily: "'DM Mono', monospace" }}>
          {fmtDate(action.date_action)}
        </div>
      </div>

      <div style={{ color: T.text, fontSize: 14.5, marginTop: 10, lineHeight: 1.5, fontWeight: 700, whiteSpace: "pre-wrap" }}>
        {action.resume}
      </div>

      {action.donnees?.tache_assignee && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 12,
            border: `1px solid ${T.accent}35`,
            background: `${T.accent}10`,
            color: T.textSub,
            fontSize: 11.5,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          <Icon as={Users} size={12} />
          <span>
            Tâche assignée à {action.donnees?.collaborateur || action.donnees?.collaborateur_email || "collaborateur"}
            {action.donnees?.date_echeance ? ` · échéance ${fmtDate(action.donnees.date_echeance)}` : ""}
          </span>
        </div>
      )}

      {(action.prochaine_action || action.date_prochaine_action) && (
        <div
          style={{
            marginTop: 9,
            padding: "8px 10px",
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            background: "rgba(255,255,255,.04)",
            color: T.textSub,
            fontSize: 11.5,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon as={Clock} size={10} />
          <span>
            Suite prévue : {action.prochaine_action || "Action à définir"}
            {action.date_prochaine_action ? ` · ${fmtDate(action.date_prochaine_action)}` : ""}
          </span>
        </div>
      )}
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
  const [advisorFilter, setAdvisorFilter] = useState("all");
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


  const notifySignedProspectByEmail = useCallback(async (prospect, mode = "passage en signé") => {
    const result = await notifyNewProspectByEmail(prospect, mode);

    showMailNotice(
      result.ok ? "success" : "warning",
      result.ok
        ? `Mail de signature envoyé à ${NEW_PROSPECT_NOTIFICATION_EMAIL}.`
        : `Prospect signé, mais le mail de signature n'a pas été confirmé. Détail : ${result.message || "fonction notify-new-prospect non confirmée"}`
    );

    return result;
  }, [notifyNewProspectByEmail, showMailNotice]);

  const notifyAssignedTaskByEmail = useCallback(async ({ prospect, task }) => {
    const email = txt(task?.email);

    if (!email) {
      return { ok: false, message: "Email collaborateur manquant." };
    }

    try {
      const { data, error: notifyErr } = await supabase.functions.invoke("notify-new-prospect", {
        body: {
          to: email,
          mode: "tâche assignée",
          event_type: "task_assigned",
          task,
          prospect: {
            id: prospect?.id || selected?.id || "",
            nom: prospect?.nom || form.nom || "",
            prenom: prospect?.prenom || form.prenom || "",
            societe: prospect?.societe || form.societe || "",
            telephone: prospect?.telephone || form.telephone || "",
            email: prospect?.email || form.email || "",
            source: prospect?.source || form.source || "",
            responsable: prospect?.responsable || form.responsable || "",
            objectif: prospect?.objectif || form.objectif || "",
            budget_global: prospect?.budget_global || form.budget_global || null,
            zone_recherche: prospect?.zone_recherche || form.zone_recherche || "",
            prochaine_action: task?.title || form.prochaine_action || "",
            date_prochaine_action: task?.date || form.date_prochaine_action || null,
            commentaire: prospect?.commentaire || form.commentaire || "",
          },
        },
      });

      if (notifyErr) {
        return { ok: false, message: notifyErr?.message || JSON.stringify(notifyErr) };
      }

      if (!data?.ok) {
        return { ok: false, message: data?.error || data?.message || "Mail tâche non confirmé." };
      }

      return { ok: true, message: `Mail envoyé à ${email}.` };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  }, [form, selected?.id]);

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

  const conseillerOptions = useMemo(() => {
    const map = new Map();

    prospects.forEach((p) => {
      const raw = txt(p.responsable);
      const key = conseillerKey(raw);
      const label = conseillerDisplayName(raw);

      if (key && label) map.set(key, label);
    });

    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);

    return prospects.filter((p) => {
      const haystack = normalizeSearch([
        prospectName(p),
        `${p.nom || ""} ${p.prenom || ""}`,
        `${p.prenom || ""} ${p.nom || ""}`,
        p.nom,
        p.prenom,
        p.societe,
        p.telephone,
        p.email,
        p.source,
        p.responsable,
        conseillerDisplayName(p.responsable),
        p.objectif,
        p.zone_recherche,
        p.commentaire,
        fluidifyData(p).icp,
        fluidifyData(p).commentaires,
      ].join(" "));

      const okQuery = !q || haystack.includes(q);
      const okAdvisor = advisorFilter === "all" || conseillerKey(p.responsable) === advisorFilter;

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

      return okQuery && okAdvisor && okQuick;
    });
  }, [prospects, query, advisorFilter, quickFilter]);

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
    } else if (!isSignedStatus(selected?.statut) && isSignedStatus(res.data?.statut)) {
      await notifySignedProspectByEmail(res.data, res.data?.statut === "converti" ? "conversion client" : "passage en signé");
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

    if (!isSignedStatus(prospect.statut) && isSignedStatus(newStatus)) {
      await notifySignedProspectByEmail(data, newStatus === "converti" ? "conversion client" : "passage en signé");
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

  const addAction = async (override = {}) => {
    if (!selected?.id) {
      setError("Sauvegarde d'abord le prospect avant d'ajouter une action.");
      return;
    }

    const currentActionForm = {
      ...actionForm,
      ...override,
    };

    const isAssignedTask = Boolean(
      currentActionForm.tache_collaborateur ||
      currentActionForm.tache_email ||
      currentActionForm.tache_date ||
      currentActionForm.type_action === "tache"
    );

    const resume = String(
      isAssignedTask
        ? (currentActionForm.tache_resume || currentActionForm.resume || "")
        : (currentActionForm.resume || "")
    ).trim();

    if (!resume) {
      setError(isAssignedTask ? "Écris l'objet ou la description de la tâche." : "Écris une courte note d'échange.");
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");

    const nextAction = form.prochaine_action || selected.prochaine_action || "";
    const nextDate = form.date_prochaine_action || selected.date_prochaine_action || null;

    if (isAssignedTask && !currentActionForm.tache_collaborateur) {
      setError("Pour assigner une tâche, renseigne le nom du collaborateur.");
      setSaving(false);
      return;
    }

    if (isAssignedTask && !currentActionForm.tache_email) {
      setError("Pour assigner une tâche, renseigne l'email du collaborateur.");
      setSaving(false);
      return;
    }

    if (isAssignedTask && !currentActionForm.tache_date) {
      setError("Pour assigner une tâche, renseigne une date d'échéance.");
      setSaving(false);
      return;
    }

    const actionPayload = {
      prospect_id: selected.id,
      created_by: auteur(profil),
      date_action: new Date().toISOString(),
      type_action: isAssignedTask ? "tache" : (currentActionForm.type_action || "note"),
      resume,
      resultat: isAssignedTask ? "Tâche assignée" : "",
      prochaine_action: nextAction,
      date_prochaine_action: nextDate || null,
      donnees: {
        source: "CRM Prospection",
        auteur: auteur(profil),
        tache_assignee: isAssignedTask,
        collaborateur: currentActionForm.tache_collaborateur || "",
        collaborateur_email: currentActionForm.tache_email || "",
        date_echeance: currentActionForm.tache_date || null,
        statut_tache: isAssignedTask ? "à faire" : "",
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

    let taskMailResult = null;
    if (isAssignedTask) {
      taskMailResult = await notifyAssignedTaskByEmail({
        prospect: updatedProspect || selected,
        task: {
          title: resume,
          type: actionPayload.type_action,
          collaborator: currentActionForm.tache_collaborateur || currentActionForm.tache_email,
          email: currentActionForm.tache_email,
          date: currentActionForm.tache_date,
          assigned_by: auteur(profil),
        },
      });

      showMailNotice(
        taskMailResult.ok ? "success" : "warning",
        taskMailResult.ok
          ? `Tâche assignée et mail envoyé à ${currentActionForm.tache_email}.`
          : `Tâche assignée, mais le mail n'a pas été confirmé. Détail : ${taskMailResult.message}`
      );
    }

    setActionForm({ ...EMPTY_ACTION });

    await loadActions(selected.id);
    await loadProspects();

    setSaving(false);
    setMsg(isAssignedTask ? "Tâche assignée au collaborateur." : "Échange ajouté à l'historique.");
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

    if (!isSignedStatus(prospect?.statut) && isSignedStatus(data?.statut)) {
      await notifySignedProspectByEmail(data, mode === "créé" ? "conversion client" : `conversion client - ${mode}`);
    }

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

        .inv-prospect-modal {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .inv-prospect-modal-body {
          overflow-y: auto;
          padding: 16px;
        }

        .inv-prospect-modal-body::-webkit-scrollbar { width: 10px; }
        .inv-prospect-modal-body::-webkit-scrollbar-thumb { background: rgba(201,163,74,.28); border-radius: 999px; }
        .inv-prospect-modal-body::-webkit-scrollbar-track { background: rgba(255,255,255,.035); border-radius: 999px; }

        .inv-prospect-section-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(380px, .95fr);
          gap: 12px;
          align-items: start;
        }

        .inv-prospect-actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 12px;
        }

        .inv-prospect-footer-actions {
          position: sticky;
          bottom: 0;
          z-index: 4;
          margin: 12px 0 10px;
          border-radius: 18px;
          padding: 10px;
          border: 1px solid rgba(148,163,184,.18);
          background: rgba(15,23,42,.88);
          backdrop-filter: blur(10px);
          box-shadow: 0 -18px 45px rgba(2,6,23,.28);
        }

        @media (max-width: 1080px) {
          .inv-prospect-section-grid,
          .inv-prospect-actions-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 1180px) {
          .inv-prospect-modal-body > div[style*="grid-template-columns: minmax(260px"] {
            grid-template-columns: 1fr !important;
          }
        }
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
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 220px auto", gap: 10, alignItems: "center" }}>
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
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value)}
            style={{ height: 34, fontSize: 13 }}
            title="Filtrer par conseiller"
          >
            <option value="all">Tous les conseillers</option>
            {conseillerOptions.map((advisor) => (
              <option key={advisor.key} value={advisor.key}>{advisor.label}</option>
            ))}
          </select>

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
            helper="Graphiques, sources et Fluidify"
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
          <div className="inv-card inv-prospect-modal" onMouseDown={(e) => e.stopPropagation()} style={{ padding: 0, width: "min(1240px, 97vw)", height: "min(92vh, 940px)", boxShadow: "0 30px 90px rgba(0,0,0,.45)" }}>
          <div
            className="inv-card-hd blue"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}
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

          <div className="inv-card-bd inv-prospect-modal-body">
            {!selected && !isCreating ? (
              <div style={{ textAlign: "center", padding: 50, color: T.textMuted }}>
                Sélectionne un prospect ou clique sur “Nouveau prospect”.
              </div>
            ) : (
              <>
                {selected?.id && <ScoreTransformationCard prospect={{ ...selected, ...form }} T={T} />}

                <div style={{ marginBottom: 12 }}>
                  <StatusPills value={form.statut} onChange={quickStatus} />
                </div>

                <ProspectSummaryCard prospect={currentProspect} T={T} />

                <div className="inv-prospect-section-grid">
                  <div>
                    <FicheSection
                      T={T}
                      icon={UserPlus}
                      title="Identité & contact"
                      helper="Les informations minimales pour retrouver, contacter et qualifier le prospect."
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                          gap: 10,
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

                        <Field label="Conseiller / responsable">
                          <Input value={form.responsable} onChange={(v) => setField("responsable", v)} placeholder="Ex : Matthieu Fumoleau" />
                        </Field>
                      </div>
                    </FicheSection>

                    <FicheSection
                      T={T}
                      icon={Target}
                      title="Projet & potentiel commercial"
                      helper="Les critères qui permettent d’évaluer l’intérêt commercial du prospect."
                      accent="#22C55E"
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                          gap: 10,
                        }}
                      >
                        <Field label="Objectif">
                          <Select value={form.objectif} onChange={(v) => setField("objectif", v)} options={OBJECTIFS} />
                        </Field>

                        <Field label="Budget">
                          <Input type="number" value={form.budget_global} onChange={(v) => setField("budget_global", v)} placeholder="Budget libre" />
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
                      </div>
                    </FicheSection>

                    <FicheSection
                      T={T}
                      icon={MessageCircle}
                      title="Note de synthèse"
                      helper="À lire avant chaque relance : besoin, freins, décision, suite à donner."
                      accent="#8B5CF6"
                    >
                      <textarea
                        className="inv-textarea"
                        value={form.commentaire || ""}
                        onChange={(e) => setField("commentaire", e.target.value)}
                        rows={4}
                        placeholder="Résumé rapide : besoin, échange, frein, suite à donner..."
                        style={{ width: "100%", fontSize: 13 }}
                      />
                    </FicheSection>
                  </div>

                  <div>
                    {selected?.id && <FluidifyDetailCard prospect={selected} T={T} />}

                    <FicheSection
                      T={T}
                      icon={CalendarDays}
                      title="Suivi à réaliser"
                      helper="Ce bloc pilote l’action commerciale à faire et le prochain jalon de suivi."
                      accent={WA}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(220px, 1fr) 160px",
                          gap: 10,
                          alignItems: "end",
                        }}
                      >
                        <Field label="Prochaine action à réaliser">
                          <Input
                            value={form.prochaine_action}
                            onChange={(v) => setField("prochaine_action", v)}
                            placeholder="Écris librement l’action à réaliser..."
                          />
                        </Field>

                        <Field label="Date action">
                          <Input type="date" value={form.date_prochaine_action} onChange={(v) => setField("date_prochaine_action", v)} />
                        </Field>
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 12 }}>
                        <span style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 900, alignSelf: "center", marginRight: 2 }}>
                          Actions rapides :
                        </span>
                        {PROCHAINES_ACTIONS.filter(Boolean).map((action) => (
                          <button
                            key={action}
                            type="button"
                            className="inv-btn inv-btn-out inv-btn-sm"
                            onClick={() => setField("prochaine_action", action)}
                            style={{
                              opacity: form.prochaine_action === action ? 1 : .82,
                              borderColor: form.prochaine_action === action ? T.accent : T.border,
                            }}
                          >
                            {action}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        <span style={{ color: T.textMuted, fontSize: 10.5, fontWeight: 900, alignSelf: "center", marginRight: 2 }}>
                          Dates rapides :
                        </span>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp(form.prochaine_action || "Relancer", 0)}>J</button>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp(form.prochaine_action || "Relancer", 2)}>J+2</button>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp(form.prochaine_action || "Relancer", 7)}>J+7</button>
                        <button className="inv-btn inv-btn-out inv-btn-sm" type="button" onClick={() => setQuickFollowUp(form.prochaine_action || "Relancer", 15)}>J+15</button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(220px, 1fr) 160px",
                          gap: 10,
                          alignItems: "end",
                        }}
                      >
                        <Field label="Prochain point d’étape client / prospect">
                          <Input value={form.prochain_point_etape} onChange={(v) => setField("prochain_point_etape", v)} placeholder="Ex : Point décision, validation budget, retour proposition..." />
                        </Field>

                        <Field label="Date point d’étape">
                          <Input type="date" value={form.date_prochain_point_etape} onChange={(v) => setField("date_prochain_point_etape", v)} />
                        </Field>
                      </div>
                    </FicheSection>
                  </div>
                </div>

                <div
                  className="inv-prospect-footer-actions"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
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
                    className="inv-prospect-actions-grid"
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: 12,
                      marginTop: 8,
                    }}
                  >
                    <div>
                      <ProspectHistoryCard actions={actions} T={T} />

                      <div
                        style={{
                          height: 1,
                          background: `linear-gradient(90deg, ${T.accent}65, transparent)`,
                          margin: "14px 0 12px",
                        }}
                      />

                      <div style={{ color: T.text, fontSize: 14, fontWeight: 950, marginBottom: 7, display: "flex", alignItems: "center", gap: 7 }}>
                        <Icon as={MessageSquare} size={15} />
                        Ajouter un échange à l’historique
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 11, marginTop: -4, marginBottom: 8 }}>
                        À utiliser pour garder une trace d’un appel, email, WhatsApp, RDV ou retour client.
                      </div>

                      <div
                        style={{
                          border: `1px solid ${T.border}`,
                          background: "rgba(255,255,255,.025)",
                          borderRadius: 16,
                          padding: 10,
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 118px", gap: 7 }}>
                          <select
                            className="inv-sel"
                            value={actionForm.type_action === "tache" ? "note" : actionForm.type_action}
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
                            placeholder="Ex : Appel effectué, échange WhatsApp, retour client..."
                            style={{ height: 34 }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addAction({ type_action: actionForm.type_action === "tache" ? "note" : actionForm.type_action });
                              }
                            }}
                          />

                          <button
                            className="inv-btn inv-btn-out inv-btn-sm"
                            type="button"
                            onClick={() => addAction({ type_action: actionForm.type_action === "tache" ? "note" : actionForm.type_action })}
                            disabled={saving}
                          >
                            Ajouter
                          </button>
                        </div>
                      </div>

                      <div style={{ color: T.text, fontSize: 13, fontWeight: 950, marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon as={CheckCircle2} size={14} />
                        Assigner une tâche à un collaborateur
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 11, marginTop: -4, marginBottom: 8 }}>
                        À utiliser lorsqu’une action doit être réalisée par un membre de l’équipe avec une date.
                      </div>

                      <div
                        style={{
                          border: `1px solid ${T.accent}30`,
                          background: "linear-gradient(135deg, rgba(201,163,74,.09), rgba(255,255,255,.025))",
                          borderRadius: 16,
                          padding: 10,
                        }}
                      >
                        <input
                          className="inv-inp"
                          value={actionForm.tache_resume}
                          onChange={(e) => setActionForm((p) => ({ ...p, tache_resume: e.target.value }))}
                          placeholder="Objet de la tâche : ex. Rappeler le prospect, préparer la proposition..."
                          style={{ height: 34, marginBottom: 7 }}
                        />

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 7 }}>
                          <input
                            className="inv-inp"
                            value={actionForm.tache_collaborateur}
                            onChange={(e) => setActionForm((p) => ({ ...p, tache_collaborateur: e.target.value }))}
                            placeholder="Collaborateur assigné"
                            style={{ height: 34 }}
                          />
                          <input
                            className="inv-inp"
                            type="email"
                            value={actionForm.tache_email}
                            onChange={(e) => setActionForm((p) => ({ ...p, tache_email: e.target.value }))}
                            placeholder="Email collaborateur"
                            style={{ height: 34 }}
                          />
                          <input
                            className="inv-inp"
                            type="date"
                            value={actionForm.tache_date}
                            onChange={(e) => setActionForm((p) => ({ ...p, tache_date: e.target.value }))}
                            style={{ height: 34, fontSize: 12 }}
                          />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginTop: 8 }}>
                          <div style={{ color: T.textMuted, fontSize: 11.2, lineHeight: 1.35, display: "flex", gap: 7, alignItems: "flex-start" }}>
                            <Icon as={Clock} size={13} />
                            <span>
                              À la validation, la tâche est ajoutée à l’historique et un mail est envoyé au collaborateur.
                            </span>
                          </div>

                          <button
                            className="inv-btn inv-btn-gold inv-btn-sm"
                            type="button"
                            onClick={() => addAction({ type_action: "tache" })}
                            disabled={saving}
                          >
                            Assigner
                          </button>
                        </div>
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
                  Formats acceptés : CSV avec en-têtes, liste au séparateur point-virgule, blocs texte avec Téléphone / Email / Budget. Les leads API Fluidify sont reçus automatiquement avec source = Fluidify et statut = Nouveau.
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
