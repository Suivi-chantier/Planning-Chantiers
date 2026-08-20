import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import {
  LayoutDashboard, LayoutGrid, Users, Building2, BarChart3, RefreshCw, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Home, Euro, Filter,
  AlertTriangle, Eye, Sparkles, Send, Handshake, Bell, Briefcase,
  ExternalLink, Clock, UserCheck, ClipboardCheck, ListChecks, ShieldCheck,
} from "lucide-react";

import {
  THEMES_INV, SU, WA, DA,
  isoDate, normTxt, KPICard,
  fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween,
  getClientName, getBienLabel, getBienScore,
  HONORAIRE_BASE_CONTRAT_HT,
  NAV,
} from "./_shared";

// ─────────────────────────────────────────────────────────────
// TABLEAU DE BORD V9 — Pilotage par dossier consolidé
// Objectif : pilotage quotidien à distance sans doublons.
// Principe : 1 prospect / 1 client / 1 bien = 1 carte consolidée.
// Les alertes sont agrégées dans la même carte, puis classées en :
// À décider maintenant / À surveiller / Délégué / Traité aujourd'hui.
// ─────────────────────────────────────────────────────────────

const V9_RESPONSABLES = ["Matthieu", "Tom", "Benjamin", "Camille", "Autre"];
const V9_ENTITY_FILTERS = [
  { key:"all", label:"Tous", icon:LayoutDashboard },
  { key:"prospect", label:"Prospects", icon:Phone },
  { key:"client", label:"Clients", icon:Briefcase },
  { key:"bien", label:"Biens", icon:Home },
  { key:"team", label:"Équipe", icon:Users },
];
const V9_COLUMNS = [
  { key:"decision", label:"À décider maintenant", icon:AlertTriangle, color:DA, help:"Dossiers qui demandent ton arbitrage aujourd'hui." },
  { key:"watch", label:"À surveiller", icon:Eye, color:WA, help:"Dossiers suivis avec une échéance future ou une vigilance." },
  { key:"delegated", label:"Délégué / en attente", icon:UserCheck, color:"#4db8ff", help:"Actions confiées à l'équipe ou en attente de retour." },
  { key:"done", label:"Traité aujourd'hui", icon:ShieldCheck, color:SU, help:"Dossiers validés dans le dashboard du jour." },
];
const V9_DECISIONS = {
  prospect:["Appeler", "Envoyer WhatsApp", "Envoyer mail", "Programmer RDV", "Créer tâche", "Assigner", "Reporter", "Passer froid", "Passer perdu", "Archiver"],
  client:["Faire avancer", "Relancer client", "Relancer banque", "Relancer notaire", "Relancer assurance", "Demander document", "Assigner", "Arbitrage Matthieu", "Mettre en pause", "Clôturer"],
  bien:["Analyser", "Demander visite terrain", "Proposer à un client", "Matcher avec client", "Relancer agent / vendeur", "Faire offre", "Revoir le prix", "Archiver", "Mettre en attente"],
  team:["Valider retour", "Demander retour", "Réassigner", "Bloquer", "Clôturer"],
};
const V9_PROSPECT_LOST = ["perdu", "perdue", "archive", "archivé", "archivée", "supprime", "supprimé", "supprimée", "corbeille", "trash", "deleted", "removed", "inactif", "termine", "terminé", "client"];
const V9_BIEN_INACTIVE = ["archivé", "archive", "refusé", "refuse", "terminé", "termine", "vendu", "perdu"];
const V9_CLIENT_INACTIVE = ["prospect", "inactif", "terminé", "termine", "perdu", "archivé", "archive", "supprimé", "supprime"];

function todayIso() { return isoDate(new Date()); }
function safeArr(v) { return Array.isArray(v) ? v : []; }
function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
function isDueTodayOrPast(value) {
  const d = toDate(value); const t = toDate(new Date());
  return Boolean(d && t && d <= t);
}
function isFuture(value) {
  const d = toDate(value); const t = toDate(new Date());
  return Boolean(d && t && d > t);
}
function isWithinNextDays(value, days=7) {
  const d = toDate(value); const t = toDate(new Date());
  if (!d || !t) return false;
  const end = new Date(t); end.setDate(end.getDate() + days);
  return d >= t && d <= end;
}
function daysSince(value) {
  const d = toDate(value); const t = toDate(new Date());
  if (!d || !t) return null;
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}
function firstFilled(obj={}, keys=[]) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}
function numberFromAny(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function joinNonEmpty(parts=[], sep=" · ") { return parts.map(v => String(v || "").trim()).filter(Boolean).join(sep); }
function levelRank(level) { return ({ danger:0, warning:1, info:2, success:3 }[level] ?? 4); }
function levelColor(level, T) { return level === "danger" ? DA : level === "warning" ? WA : level === "success" ? SU : T.accent; }
function levelLabel(level) { return level === "danger" ? "Urgent" : level === "warning" ? "Attention" : level === "success" ? "OK" : "Info"; }

function isDeletedLike(row={}) {
  const deletedFlags = [row.deleted_at, row.removed_at, row.archived_at].some(Boolean);
  const boolFlags = [row.is_deleted, row.deleted, row.supprime, row.supprimé, row.removed, row.trashed, row.corbeille].some(v => v === true || String(v).toLowerCase() === "true");
  const txt = normTxt(`${row.statut || ""} ${row.status || ""} ${row.etat || ""} ${row.state || ""}`);
  return deletedFlags || boolFlags || ["supprime", "supprim", "deleted", "removed", "trash", "corbeille"].some(k => txt.includes(k));
}
function prospectStatusText(c={}) { return normTxt(`${c.statut || ""} ${c.status || ""} ${c.etape || ""} ${c.pipeline_stage || ""} ${c.categorie || ""} ${c.type || ""}`); }
function isActiveProspectRecord(c={}) {
  if (!c || !c.id || isDeletedLike(c)) return false;
  const txt = prospectStatusText(c);
  if (V9_PROSPECT_LOST.some(k => txt.includes(k))) return false;
  if (txt.includes("actif") || txt.includes("client") || c.date_signature) return false;
  const explicit = firstFilled(c, ["contact_type", "type_contact", "type", "categorie", "pipeline", "module"]);
  if (normTxt(explicit).includes("prospect")) return true;
  const prospectWords = ["prospect", "nouveau", "qualifie", "qualifié", "rdv", "proposition", "relance", "chaud", "tiede", "tiède", "froid", "a qualifier", "à qualifier"];
  return prospectWords.some(k => txt.includes(k)) || (!txt || txt === "nouveau");
}
function isClientRecord(c={}) {
  if (!c || !c.id || isDeletedLike(c)) return false;
  const txt = normTxt(`${c.statut || ""} ${c.status || ""} ${c.etape || ""}`);
  if (V9_CLIENT_INACTIVE.some(k => txt.includes(k))) return false;
  return c.date_signature || txt.includes("actif") || txt.includes("contrat") || txt.includes("financement") || txt.includes("compromis") || txt.includes("travaux") || txt.includes("location") || Boolean(c.etape);
}
function isActiveBien(b={}) {
  if (!b || !b.id || isDeletedLike(b)) return false;
  const txt = normTxt(`${b.statut || ""} ${b.status || ""}`);
  return !V9_BIEN_INACTIVE.some(k => txt.includes(k));
}
function withSourceTable(rows=[], table) { return safeArr(rows).map(r => ({ ...r, _source_table:table })); }
function uniqueRows(rows=[]) {
  const map = new Map();
  safeArr(rows).forEach(r => {
    const key = `${r._source_table || "invest_clients"}:${r.id}`;
    if (!map.has(key)) map.set(key, r);
  });
  return Array.from(map.values());
}

function prospectOwner(c={}) { return firstFilled(c, ["conseiller", "responsable", "owner", "assigned_to", "commercial", "collaborateur"]) || "Matthieu"; }
function prospectEmail(c={}) { return firstFilled(c, ["email", "mail", "adresse_email"]); }
function prospectPhone(c={}) { return firstFilled(c, ["telephone", "téléphone", "phone", "mobile", "whatsapp"]); }
function prospectSource(c={}) { return firstFilled(c, ["source_lead", "source", "origine", "canal", "provenance", "lead_source"]); }
function prospectStage(c={}) { return firstFilled(c, ["etape", "étape", "pipeline_stage", "stage", "statut", "status"]); }
function prospectBudget(c={}) { return numberFromAny(firstFilled(c, ["budget", "budget_cible", "budget_max", "montant_projet"])); }
function prospectCapacity(c={}) { return numberFromAny(firstFilled(c, ["capacite_emprunt", "capacité_emprunt", "capacite", "capacité", "financement", "budget_financement"])); }
function prospectApport(c={}) { return numberFromAny(firstFilled(c, ["apport", "apport_personnel", "cash", "epargne", "épargne"])); }
function prospectMotivation(c={}) { return firstFilled(c, ["motivation", "niveau_motivation", "qualification", "temperature", "priorite", "priorité"]); }
function prospectHorizon(c={}) { return firstFilled(c, ["horizon", "delai", "délai", "deadline", "date_projet", "urgence"]); }
function prospectZone(c={}) { return firstFilled(c, ["zone_ciblee", "zone_ciblée", "zone", "secteur", "ville_recherche", "ville"]); }
function prospectGoal(c={}) { return firstFilled(c, ["objectif", "objectif_investissement", "strategie", "stratégie", "projet"]); }
function prospectComment(c={}) { return firstFilled(c, ["commentaire", "commentaires", "note", "notes", "description", "message"]); }
function prospectLastContact(c={}) { return firstFilled(c, ["date_dernier_contact", "dernier_contact", "last_contact_at", "last_contact", "updated_at", "date_premier_contact", "created_at"]); }
function prospectNextAction(c={}) { return firstFilled(c, ["prochaine_action", "next_action", "action_suivante", "relance_action"]); }
function prospectNextDate(c={}) { return firstFilled(c, ["date_prochaine_action", "relance_date", "date_relance", "next_action_date", "due_date"]); }
function relanceCount(c={}) { return numberFromAny(firstFilled(c, ["relance_count", "nb_relances", "nombre_relances", "relances_count"])); }
function nextRelanceDateFromCount(count=0) {
  const seq = [1, 3, 7, 14, 30];
  const days = seq[Math.min(Math.max(0, Number(count) || 0), seq.length - 1)];
  const d = new Date(); d.setDate(d.getDate() + days);
  return isoDate(d);
}
function computeProspectScore(c={}) {
  let score = 0;
  const horizon = normTxt(prospectHorizon(c));
  if (horizon.match(/urgent|immédiat|immediat|maintenant|1 mois|30 jours|court/)) score += 24;
  else if (horizon.match(/3 mois|90 jours|trimestre/)) score += 18;
  else if (horizon) score += 10;
  const capacity = prospectCapacity(c) || prospectBudget(c);
  if (capacity >= 180000) score += 22;
  else if (capacity >= 100000) score += 15;
  else if (capacity > 0) score += 8;
  const motivation = normTxt(prospectMotivation(c));
  if (motivation.match(/chaud|élevé|eleve|fort|urgent|très|tres|motiv/)) score += 24;
  else if (motivation.match(/normal|moyen|tiede|tiède/)) score += 14;
  else if (motivation) score += 7;
  if (prospectEmail(c) && prospectPhone(c)) score += 12;
  else if (prospectEmail(c) || prospectPhone(c)) score += 6;
  const source = normTxt(prospectSource(c));
  if (source.match(/recommand|parrain|client|reseau|réseau|direct/)) score += 10;
  else if (source) score += 5;
  if (prospectGoal(c)) score += 8;
  return Math.max(0, Math.min(100, score));
}

function actionOwner(a={}) { return firstFilled(a, ["responsable", "owner", "assigned_to", "assignee", "collaborateur"]) || "Matthieu"; }
function actionTitle(a={}) { return firstFilled(a, ["action_title", "title", "titre", "nom", "label"]) || "Action"; }
function isOpenAction(a={}) {
  const s = normTxt(firstFilled(a, ["status", "statut", "etat"]));
  if (!s) return true;
  return ["a_faire", "à faire", "faire", "en_cours", "cours", "bloque", "bloqué", "open", "todo", "pending", "attente"].some(k => s.includes(k));
}
function isDoneAction(a={}) {
  const s = normTxt(firstFilled(a, ["status", "statut", "etat"]));
  return ["termine", "terminé", "fait", "done", "completed", "validé", "valide"].some(k => s.includes(k));
}
function isBlockedAction(a={}) {
  const s = normTxt(`${a.status || ""} ${a.statut || ""} ${a.commentaire || ""} ${a.comment || ""}`);
  return s.includes("bloque") || s.includes("bloqué") || s.includes("compliqué") || s.includes("complique");
}
function isPartnerSensitive(a={}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""} ${a.commentaire || ""}`);
  return txt.match(/notaire|financement|banque|assurance|compromis/);
}
function isDocumentSensitive(a={}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""} ${a.commentaire || ""}`);
  return txt.match(/document|pièce|piece|justificatif|contrat|patrimoine/);
}
function linkedEntityType(a={}) { return firstFilled(a, ["linked_entity_type", "item_type", "entity_type", "type_lien"]); }
function linkedEntityId(a={}) { return firstFilled(a, ["linked_entity_id", "item_id", "entity_id", "source_id"]); }
function clientLastActivity(c={}) { return firstFilled(c, ["date_derniere_action", "date_dernier_contact", "updated_at", "date_prochaine_action", "date_signature", "created_at"]); }

function makeAlert({ code, label, level="warning", due_date="", source="" }) { return { code, label, level, due_date, source }; }
function worstLevel(alerts=[]) {
  if (alerts.some(a => a.level === "danger")) return "danger";
  if (alerts.some(a => a.level === "warning")) return "warning";
  if (alerts.some(a => a.level === "info")) return "info";
  return "success";
}
function entityKey(type, id) { return `${type}_${String(id || "unknown")}`; }
function emptyRoutine() { return { date:todayIso(), decisions:{}, resolved:{}, priorities:[{},{},{}], status:"in_progress", started_at:new Date().toISOString() }; }
function decisionKey(item) { return item?.key || entityKey(item?.type, item?.id); }

// Reconstitue la routine du jour à partir des lignes déjà écrites en base.
//
// La table invest_morning_routine_items recevait une ligne à chaque validation
// depuis toujours — et n'était relue nulle part. L'état de la journée vivait
// dans localStorage, donc dans UN navigateur : on pilotait du téléphone le
// matin, on rouvrait du poste fixe l'après-midi, et les dossiers déjà arbitrés
// remontaient en « à décider ».
//
// Une même carte peut avoir été validée plusieurs fois dans la journée
// (correction d'un arbitrage) : on garde la dernière, d'où le tri par date
// croissante — la plus récente écrase les précédentes.
function routineDepuisLignes(lignes = []) {
  const routine = emptyRoutine();
  const triees = [...lignes].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")));

  for (const l of triees) {
    if (l.step_key === "priorite") {
      const idx = Number(l.item_id);
      if (Number.isInteger(idx) && idx >= 0 && idx < 3) {
        routine.priorities[idx] = {
          title: l.item_label || l.next_action || "",
          responsable: l.responsable || "",
          due_date: l.due_date || "",
          comment: l.comment || "",
        };
      }
      continue;
    }

    const cle = entityKey(l.item_type, l.item_id);
    routine.decisions[cle] = {
      decision: l.decision || "",
      responsable: l.responsable || "",
      next_action: l.next_action || "",
      due_date: l.due_date || "",
      comment: l.comment || "",
      create_task: true,
      created_task_id: l.created_task_id || null,
      resolved_at: l.created_at || null,
    };
    routine.resolved[cle] = {
      resolved_at: l.created_at || null,
      label: l.item_label || "",
      type: l.item_type || "",
    };
  }
  return routine;
}


function isResolvedToday(routine, item) { return Boolean(routine?.resolved?.[decisionKey(item)]); }
function defaultDecision(item={}) {
  const suggestedDue = item.due_date && isFuture(item.due_date) ? item.due_date : todayIso();
  return { decision:"", responsable:item.responsable || "Matthieu", next_action:item.next_action || item.primaryAlert || "", due_date:suggestedDue, comment:"", create_task:true, force_reason:"" };
}
function missingDecisionFields(item, d={}) {
  const miss = [];
  if (!String(d.decision || "").trim()) miss.push("décision");
  if (!String(d.responsable || "").trim()) miss.push("responsable");
  if (!String(d.next_action || "").trim()) miss.push("action future");
  if (!String(d.due_date || "").trim()) miss.push("échéance");
  if (!String(d.comment || "").trim()) miss.push("commentaire");
  if (d.force_validated && !String(d.force_reason || "").trim()) miss.push("motif de forçage");
  if ((normTxt(d.decision).includes("proposer") || normTxt(d.decision).includes("matcher")) && item?.type === "bien" && !String(d.client_id || "").trim()) miss.push("client à matcher");
  if (normTxt(d.decision).includes("offre") && item?.type === "bien" && !String(d.offer_amount || "").trim()) miss.push("montant offre");
  return miss;
}
function isDecisionComplete(item, d={}) { return missingDecisionFields(item, d).length === 0; }
function priorityComplete(p={}) { return String(p.title || "").trim() && String(p.responsable || "").trim() && String(p.due_date || "").trim() && String(p.comment || "").trim(); }

function buildProspectDossier(c) {
  const alerts = [];
  const score = computeProspectScore(c);
  const nextAction = prospectNextAction(c);
  const nextDate = prospectNextDate(c);
  const owner = prospectOwner(c);
  const lastDays = daysSince(prospectLastContact(c));
  if (!nextAction) alerts.push(makeAlert({ code:"no_next_action", label:"Sans prochaine action", level:"danger" }));
  if (!nextDate) alerts.push(makeAlert({ code:"no_next_date", label:"Sans date de relance", level:"danger" }));
  if (!owner) alerts.push(makeAlert({ code:"no_owner", label:"Sans responsable", level:"danger" }));
  if (nextDate && isDueTodayOrPast(nextDate)) alerts.push(makeAlert({ code:"late_relaunch", label:`Relance à traiter (${safeDate(nextDate)})`, level:"danger", due_date:nextDate }));
  if (nextDate && isFuture(nextDate) && isWithinNextDays(nextDate, 7)) alerts.push(makeAlert({ code:"future_relaunch", label:`Relance à venir ${safeDate(nextDate)}`, level:"warning", due_date:nextDate }));
  if (lastDays !== null && lastDays >= 10) alerts.push(makeAlert({ code:"stale_red", label:`Sans contact depuis ${lastDays} jours`, level:"danger" }));
  else if (lastDays !== null && lastDays >= 7) alerts.push(makeAlert({ code:"stale_orange", label:`Sans contact depuis ${lastDays} jours`, level:"warning" }));
  if (score >= 70) alerts.push(makeAlert({ code:"hot", label:`Prospect chaud ${score}/100`, level:nextAction && nextDate && isFuture(nextDate) ? "warning" : "danger" }));
  const level = worstLevel(alerts);
  const due = nextDate || nextRelanceDateFromCount(relanceCount(c));
  return {
    key:entityKey("prospect", c.id), type:"prospect", id:c.id, sourceTable:c._source_table || "invest_clients",
    label:getClientName(c), subtitle:joinNonEmpty([prospectStage(c), prospectSource(c), prospectZone(c)]),
    level, alerts, primaryAlert:alerts[0]?.label || "Sous contrôle", responsable:owner || "Matthieu",
    next_action:nextAction || "Définir la prochaine action prospect", due_date:due,
    readOnly:level !== "danger" && isFuture(due), score, raw:c,
    meta:{ score, budget:prospectBudget(c), capacity:prospectCapacity(c), phone:prospectPhone(c), email:prospectEmail(c), source:prospectSource(c), goal:prospectGoal(c), lastContact:prospectLastContact(c) },
  };
}
function buildClientDossier(c, actions=[]) {
  const alerts = [];
  const nextAction = c.prochaine_action;
  const nextDate = c.date_prochaine_action;
  const owner = firstFilled(c, ["conseiller", "responsable", "owner", "assigned_to"]);
  const lastDays = daysSince(clientLastActivity(c));
  const relatedActions = safeArr(actions).filter(a => String(a.client_id || linkedEntityId(a) || "") === String(c.id));
  const blocked = relatedActions.filter(isBlockedAction);
  const late = relatedActions.filter(a => isOpenAction(a) && a.due_date && isDueTodayOrPast(a.due_date));
  const docs = relatedActions.filter(isDocumentSensitive);
  const partner = relatedActions.filter(isPartnerSensitive);
  if (!c.etape) alerts.push(makeAlert({ code:"no_stage", label:"Étape client non renseignée", level:"danger" }));
  if (!owner) alerts.push(makeAlert({ code:"no_owner", label:"Responsable non renseigné", level:"danger" }));
  if (!nextAction) alerts.push(makeAlert({ code:"no_next_action", label:"Sans prochaine action", level:"danger" }));
  if (!nextDate) alerts.push(makeAlert({ code:"no_next_date", label:"Sans date de prochaine action", level:"danger" }));
  if (nextDate && isDueTodayOrPast(nextDate)) alerts.push(makeAlert({ code:"late_action", label:`Action à traiter (${safeDate(nextDate)})`, level:"danger", due_date:nextDate }));
  if (nextDate && isFuture(nextDate) && isWithinNextDays(nextDate, 7)) alerts.push(makeAlert({ code:"future_action", label:`Échéance sous 7 jours (${safeDate(nextDate)})`, level:"warning", due_date:nextDate }));
  if (lastDays !== null && lastDays >= 10) alerts.push(makeAlert({ code:"stale_red", label:`Aucune avancée depuis ${lastDays} jours`, level:"danger" }));
  else if (lastDays !== null && lastDays >= 7) alerts.push(makeAlert({ code:"stale_orange", label:`À vérifier : ${lastDays} jours sans avancée`, level:"warning" }));
  blocked.forEach(a => alerts.push(makeAlert({ code:`blocked_${a.id}`, label:`Action bloquée : ${actionTitle(a)}`, level:"danger", due_date:a.due_date })));
  late.forEach(a => alerts.push(makeAlert({ code:`late_${a.id}`, label:`Tâche en retard : ${actionTitle(a)}`, level:"danger", due_date:a.due_date })));
  docs.forEach(a => alerts.push(makeAlert({ code:`doc_${a.id}`, label:`Document à suivre : ${actionTitle(a)}`, level:isDueTodayOrPast(a.due_date) ? "danger" : "warning", due_date:a.due_date })));
  partner.forEach(a => alerts.push(makeAlert({ code:`partner_${a.id}`, label:`Partenaire à suivre : ${actionTitle(a)}`, level:isDueTodayOrPast(a.due_date) ? "danger" : "warning", due_date:a.due_date })));
  const level = worstLevel(alerts);
  return {
    key:entityKey("client", c.id), type:"client", id:c.id, sourceTable:"invest_clients", label:getClientName(c), subtitle:joinNonEmpty([c.etape, c.statut, fmtDashboardEur(c.budget)]),
    level, alerts, primaryAlert:alerts[0]?.label || "Sous contrôle", responsable:owner || "Matthieu",
    next_action:nextAction || "Définir la prochaine action client", due_date:nextDate || todayIso(), readOnly:level !== "danger" && nextDate && isFuture(nextDate), raw:c,
    meta:{ step:c.etape, status:c.statut, budget:c.budget, lastActivity:clientLastActivity(c), relatedActions },
  };
}
function buildBienDossier(b, actions=[], propositions=[]) {
  const alerts = [];
  const statut = b.statut || "Statut non renseigné";
  const txt = normTxt(statut);
  const score = getBienScore(b);
  const due = firstFilled(b, ["date_relance", "date_prochaine_action", "due_date"]);
  const owner = firstFilled(b, ["conseiller_profero", "responsable", "owner", "assigned_to"]) || "Benjamin";
  const relatedActions = safeArr(actions).filter(a => (linkedEntityType(a) === "bien" && String(linkedEntityId(a)) === String(b.id)) || String(a.bien_id || "") === String(b.id));
  if (!statut || txt.includes("non renseign")) alerts.push(makeAlert({ code:"no_status", label:"Statut bien non renseigné", level:"danger" }));
  if (due && isDueTodayOrPast(due)) alerts.push(makeAlert({ code:"late_relaunch", label:`Relance dépassée (${safeDate(due)})`, level:"danger", due_date:due }));
  if (due && isFuture(due) && isWithinNextDays(due, 7)) alerts.push(makeAlert({ code:"future_relaunch", label:`Relance sous 7 jours (${safeDate(due)})`, level:"warning", due_date:due }));
  if (!due && ["nouveau", "a trier", "à trier", "a analyser", "à analyser", "analyse", "offre", "matcher"].some(k => txt.includes(normTxt(k)))) alerts.push(makeAlert({ code:"no_due", label:"Action à prévoir sur le bien", level:"danger" }));
  if (["offre envoyee", "offre envoyée", "offre acceptee", "offre acceptée", "offre a faire", "offre à faire"].some(k => txt.includes(normTxt(k)))) alerts.push(makeAlert({ code:"offer", label:`Offre en cours : ${statut}`, level:due && isFuture(due) ? "warning" : "danger", due_date:due }));
  if (score >= 70 && !due) alerts.push(makeAlert({ code:"high_score", label:"Opportunité forte sans échéance", level:"warning" }));
  if (!b.adresse && !b.ville) alerts.push(makeAlert({ code:"incomplete", label:"Fiche bien incomplète", level:"warning" }));
  relatedActions.filter(isBlockedAction).forEach(a => alerts.push(makeAlert({ code:`blocked_${a.id}`, label:`Action bloquée : ${actionTitle(a)}`, level:"danger", due_date:a.due_date })));
  relatedActions.filter(a => isOpenAction(a) && a.due_date && isDueTodayOrPast(a.due_date)).forEach(a => alerts.push(makeAlert({ code:`late_${a.id}`, label:`Tâche en retard : ${actionTitle(a)}`, level:"danger", due_date:a.due_date })));
  const level = worstLevel(alerts);
  return {
    key:entityKey("bien", b.id), type:"bien", id:b.id, sourceTable:"invest_biens", label:getBienLabel(b), subtitle:joinNonEmpty([statut, b.ville, fmtDashboardEur(b.prix_vente)]),
    level, alerts, primaryAlert:alerts[0]?.label || "Sous contrôle", responsable:owner,
    next_action:"Prévoir l’action suivante sur le bien", due_date:due || todayIso(), readOnly:level !== "danger" && due && isFuture(due), score, raw:b,
    meta:{ statut, prix:b.prix_vente, travaux:b.prix_travaux, cout:b.cout_total, rendement:b.rendement_brut, cashflow:b.cashflow_estime, score, propositions:safeArr(propositions).filter(p => String(p.bien_id || "") === String(b.id)) },
  };
}
function buildTeamDossiers(actions=[]) {
  return safeArr(actions).filter(a => isOpenAction(a) && !linkedEntityId(a)).map(a => {
    const due = a.due_date;
    const alerts = [];
    if (isBlockedAction(a)) alerts.push(makeAlert({ code:"blocked", label:"Action bloquée / compliquée", level:"danger", due_date:due }));
    if (due && isDueTodayOrPast(due)) alerts.push(makeAlert({ code:"late", label:`Échéance ${safeDate(due)}`, level:"danger", due_date:due }));
    if (due && isFuture(due) && isWithinNextDays(due, 7)) alerts.push(makeAlert({ code:"future", label:`À suivre sous 7 jours (${safeDate(due)})`, level:"warning", due_date:due }));
    const level = worstLevel(alerts);
    return { key:entityKey("team", a.id), type:"team", id:a.id, label:actionTitle(a), subtitle:joinNonEmpty([actionOwner(a), a.step_label, a.status || a.statut]), level, alerts, primaryAlert:alerts[0]?.label || "Action sous contrôle", responsable:actionOwner(a), next_action:actionTitle(a), due_date:due || todayIso(), readOnly:level !== "danger" && due && isFuture(due), raw:a, meta:{ status:a.status || a.statut } };
  });
}
function consolidateData({ clients=[], crmProspects=[], biens=[], propositions=[], planning=[], actions=[] }) {
  const prospects = uniqueRows([...safeArr(clients).filter(isActiveProspectRecord), ...safeArr(crmProspects).filter(isActiveProspectRecord)]);
  const clientsMetier = safeArr(clients).filter(isClientRecord);
  const biensActifs = safeArr(biens).filter(isActiveBien);
  const prospectDossiers = prospects.map(buildProspectDossier);
  const clientDossiers = clientsMetier.map(c => buildClientDossier(c, actions));
  const bienDossiers = biensActifs.map(b => buildBienDossier(b, actions, propositions));
  const teamDossiers = buildTeamDossiers(actions);
  const allDossiers = [...prospectDossiers, ...clientDossiers, ...bienDossiers, ...teamDossiers];
  allDossiers.forEach(d => {
    d.category = d.level === "danger" && !d.readOnly ? "decision" : (d.responsable && d.responsable !== "Matthieu" && d.type !== "team" ? "delegated" : "watch");
    if (d.type === "team") d.category = d.level === "danger" ? "decision" : "delegated";
  });
  return { prospects, clientsMetier, biensActifs, prospectDossiers, clientDossiers, bienDossiers, teamDossiers, allDossiers, planning, actions, propositions,
    stats:{ prospects:prospects.length, clients:clientsMetier.length, biens:biensActifs.length, decision:allDossiers.filter(d => d.category === "decision").length, watch:allDossiers.filter(d => d.category === "watch").length, delegated:allDossiers.filter(d => d.category === "delegated").length, blocked:allDossiers.filter(d => d.alerts.some(a => a.code.includes("blocked") || normTxt(a.label).includes("bloqu"))).length, relancesLate:allDossiers.filter(d => d.alerts.some(a => a.level === "danger" && normTxt(a.label).match(/relance|échéance|echeance|retard|action/))).length, echeances7:allDossiers.filter(d => d.alerts.some(a => a.due_date && isWithinNextDays(a.due_date, 7))).length } };
}
function filterDossiers(dossiers=[], filter="all") {
  return filter === "all" ? dossiers : safeArr(dossiers).filter(d => d.type === filter || (filter === "team" && d.type === "team"));
}
function sortDossiers(list=[]) {
  return [...safeArr(list)].sort((a,b) => levelRank(a.level) - levelRank(b.level) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || String(a.label || "").localeCompare(String(b.label || ""), "fr", { sensitivity:"base" }));
}
function planFromRoutine(routine, dossiers) {
  const lines = [];
  safeArr(routine.priorities).forEach((p, idx) => { if (priorityComplete(p)) lines.push({ responsable:p.responsable, title:`Priorité ${idx + 1} — ${p.title}`, due_date:p.due_date, comment:p.comment, source:"Priorité" }); });
  Object.entries(routine.decisions || {}).forEach(([key,d]) => {
    if (!d || !String(d.next_action || "").trim()) return;
    const item = dossiers.find(x => decisionKey(x) === key);
    lines.push({ responsable:d.responsable || "Matthieu", title:d.next_action, due_date:d.due_date, comment:d.comment, source:item?.label || key, type:item?.type || "", decision:d.decision || "" });
  });
  return lines;
}

function AlertBadge({ level="info", children, T=THEMES_INV.dark, icon=null }) {
  const color = levelColor(level, T);
  const IconComp = icon || (level === "danger" ? AlertTriangle : level === "success" ? Check : Bell);
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 8px", borderRadius:RADIUS.pill, background:`${color}14`, border:`1px solid ${color}38`, color, fontSize:FONT.xs.size, fontWeight:900, whiteSpace:"nowrap" }}><Icon as={IconComp} size={11}/>{children}</span>;
}
function SectionCard({ title, icon, subtitle, children, T=THEMES_INV.dark, action=null }) {
  return <section className="inv-card" style={{ marginBottom:SPACING.md }}><div className="inv-card-hd blue" style={{ alignItems:"center", justifyContent:"space-between" }}><span style={{ display:"inline-flex", alignItems:"center", gap:7 }}><Icon as={icon || LayoutDashboard} size={14}/>{title}</span>{action || (subtitle && <span style={{ color:T.textMuted, fontSize:FONT.xs.size, letterSpacing:0, textTransform:"none" }}>{subtitle}</span>)}</div><div className="inv-card-bd">{children}</div></section>;
}
function StateBar({ data, doneCount=0, T=THEMES_INV.dark, onSelect }) {
  const cards = [
    { key:"decision", label:"À décider", value:data.stats.decision, icon:AlertTriangle, color:data.stats.decision ? DA : SU, hint:"Dossiers à arbitrer aujourd'hui" },
    { key:"blocked", label:"Bloqués", value:data.stats.blocked, icon:ShieldCheck, color:data.stats.blocked ? DA : SU, hint:"Points compliqués / bloquants" },
    { key:"relances", label:"Relances retard", value:data.stats.relancesLate, icon:Bell, color:data.stats.relancesLate ? DA : SU, hint:"Prospects, clients, biens" },
    { key:"delegated", label:"Délégué", value:data.stats.delegated, icon:UserCheck, color:data.stats.delegated ? "#4db8ff" : SU, hint:"Actions à suivre à distance" },
    { key:"done", label:"Traité aujourd'hui", value:doneCount, icon:Check, color:SU, hint:"Dossiers sortis du flux" },
  ];
  return <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:SPACING.md, marginBottom:SPACING.xl }}>{cards.map(c => <button key={c.key} type="button" onClick={() => onSelect?.(c.key)} style={{ border:`1px solid ${c.color}55`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, textAlign:"left", cursor:"pointer", fontFamily:"inherit", boxShadow:T.shadowSm }}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}><span style={{ width:34, height:34, borderRadius:RADIUS.md, display:"inline-flex", alignItems:"center", justifyContent:"center", color:c.color, background:`${c.color}14` }}><Icon as={c.icon} size={17}/></span><span style={{ fontFamily:"'DM Mono',monospace", fontSize:FONT.xl.size, fontWeight:900, color:c.color }}>{c.value}</span></div><div style={{ fontSize:FONT.sm.size+1, fontWeight:900, color:T.text, marginTop:9 }}>{c.label}</div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{c.hint}</div></button>)}</div>;
}
function DossierCard({ item, T=THEMES_INV.dark, onOpen, onDecide, compact=false }) {
  const color = levelColor(item.level, T);
  return <article style={{ border:`1px solid ${color}40`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md, boxShadow:T.shadowSm }}>
    <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
      <div style={{ minWidth:0 }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:7 }}><AlertBadge level={item.level} T={T}>{levelLabel(item.level)}</AlertBadge><AlertBadge level="info" T={T}>{item.type === "bien" ? "Bien" : item.type === "client" ? "Client" : item.type === "prospect" ? "Prospect" : "Équipe"}</AlertBadge>{item.readOnly && <AlertBadge level="warning" T={T} icon={Clock}>Lecture seule</AlertBadge>}</div>
        <div style={{ fontSize:FONT.lg.size, color:T.text, fontWeight:900, lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis" }}>{item.label}</div>
        <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:4 }}>{item.subtitle || "—"}</div>
      </div>
      <div style={{ display:"flex", gap:6, flexShrink:0 }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => onOpen?.(item)}><Icon as={Eye} size={12}/>Fiche</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => onDecide?.(item)} disabled={item.readOnly}><Icon as={ClipboardCheck} size={12}/>Décider</button></div>
    </div>
    <div style={{ display:"grid", gap:6, marginTop:SPACING.sm }}>{safeArr(item.alerts).slice(0, compact ? 2 : 4).map(a => <div key={a.code} style={{ display:"flex", justifyContent:"space-between", gap:8, border:`1px solid ${levelColor(a.level, T)}30`, background:T.card, borderRadius:RADIUS.md, padding:"7px 8px" }}><span style={{ fontSize:FONT.xs.size + 1, color:T.textSub, fontWeight:800 }}>{a.label}</span>{a.due_date && <span style={{ color:levelColor(a.level, T), fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size }}>{safeDate(a.due_date)}</span>}</div>)}</div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:SPACING.sm, fontSize:FONT.xs.size + 1, color:T.textMuted }}><div><strong style={{ color:T.textSub }}>Resp.</strong> {item.responsable || "—"}</div><div><strong style={{ color:T.textSub }}>Échéance</strong> {safeDate(item.due_date)}</div><div style={{ gridColumn:"1 / -1" }}><strong style={{ color:T.textSub }}>Action</strong> {item.next_action || "—"}</div></div>
  </article>;
}
function BoardColumn({ column, items=[], T=THEMES_INV.dark, onOpen, onDecide }) {
  return <section style={{ minWidth:0, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, overflow:"hidden" }}><div style={{ padding:SPACING.md, borderBottom:`1px solid ${T.border}`, background:T.sectionHd }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}><div style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:900, color:column.color }}><Icon as={column.icon} size={15}/>{column.label}</div><span style={{ fontFamily:"'DM Mono',monospace", color:column.color, fontWeight:900 }}>{items.length}</span></div><div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:4 }}>{column.help}</div></div><div style={{ padding:SPACING.md, display:"grid", gap:SPACING.md }}>{items.length ? items.map(item => <DossierCard key={item.key} item={item} T={T} onOpen={onOpen} onDecide={onDecide} compact />) : <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted, fontSize:FONT.sm.size }}>Aucun dossier dans cette colonne.</div>}</div></section>;
}
function PrioritiesPanel({ routine, setRoutine, T=THEMES_INV.dark }) {
  const update = (idx, patch) => setRoutine(prev => { const list = [...safeArr(prev.priorities)]; list[idx] = { ...(list[idx] || {}), ...patch }; return { ...prev, priorities:list }; });
  return <SectionCard title="3 priorités du jour" icon={Sparkles} subtitle="À définir après lecture des dossiers à piloter" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:SPACING.md }}>{[0,1,2].map(idx => { const p = routine.priorities?.[idx] || {}; return <div key={idx} style={{ border:`1px solid ${priorityComplete(p) ? SU : WA}44`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Priorité n°{idx + 1}</div><input className="inv-inp" placeholder="Titre de la priorité" value={p.title || ""} onChange={e => update(idx, { title:e.target.value })} style={{ width:"100%", textAlign:"left", marginBottom:8 }}/><select className="inv-sel" value={p.responsable || ""} onChange={e => update(idx, { responsable:e.target.value })} style={{ width:"100%", marginBottom:8 }}><option value="">Responsable</option>{V9_RESPONSABLES.map(r => <option key={r}>{r}</option>)}</select><input className="inv-inp" type="date" value={p.due_date || ""} onChange={e => update(idx, { due_date:e.target.value })} style={{ width:"100%", marginBottom:8 }}/><textarea className="inv-inp" placeholder="Commentaire / objectif précis" value={p.comment || ""} onChange={e => update(idx, { comment:e.target.value })} style={{ width:"100%", minHeight:70, textAlign:"left" }}/></div> })}</div></SectionCard>;
}
function ActionPlanPDF({ plan=[], T=THEMES_INV.dark, onPrint }) {
  const owners = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  return <SectionCard title="Plan d’action du jour" icon={Send} subtitle="Généré à partir des décisions validées" T={T} action={<button className="inv-btn inv-btn-gold inv-btn-sm" onClick={onPrint}><Icon as={Download} size={12}/>PDF</button>}>
    {plan.length === 0 ? <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, color:T.textMuted, textAlign:"center" }}>Aucune action validée pour le moment.</div> : <div style={{ display:"grid", gap:SPACING.md }}>{owners.map(owner => <div key={owner} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ fontSize:FONT.lg.size, fontWeight:900, color:T.text, marginBottom:8 }}>{owner}</div>{plan.filter(p => (p.responsable || "À définir") === owner).map((p,i) => <div key={i} style={{ padding:"8px 0", borderTop:i ? `1px solid ${T.border}` : "none" }}><div style={{ fontWeight:900, color:T.text }}>{p.title}</div><div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>Échéance : {safeDate(p.due_date)} · Source : {p.source || "—"} · {p.type || ""}</div>{p.comment && <div style={{ fontSize:FONT.sm.size, color:T.textSub, marginTop:3 }}>{p.comment}</div>}</div>)}</div>)}</div>}
  </SectionCard>;
}
function DetailField({ label, value, T=THEMES_INV.dark, mono=false }) {
  return <div style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.md, padding:"8px 9px" }}><div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:900, textTransform:"uppercase", letterSpacing:.5 }}>{label}</div><div style={{ fontSize:FONT.sm.size + 1, color:T.text, fontWeight:800, marginTop:3, fontFamily:mono ? "'DM Mono',monospace" : "inherit" }}>{value || "—"}</div></div>;
}
function DecisionDrawer({ item, decision, setDecision, T=THEMES_INV.dark, onClose, onSave, onOpenFull, saving=false }) {
  if (!item) return null;
  const d = decision || defaultDecision(item);
  const missing = missingDecisionFields(item, d);
  const set = patch => setDecision?.({ ...d, ...patch });
  const decisions = V9_DECISIONS[item.type] || V9_DECISIONS.team;
  const fieldGrid = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:8 };
  const isBien = item.type === "bien";
  return <div style={{ position:"fixed", inset:0, zIndex:80, background:"rgba(15,23,42,.32)", display:"flex", justifyContent:"flex-end" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}><aside style={{ width:"min(560px,100%)", height:"100%", background:T.card, borderLeft:`1px solid ${T.border}`, boxShadow:"-12px 0 30px rgba(15,23,42,.18)", display:"flex", flexDirection:"column" }}><div style={{ padding:SPACING.lg, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", gap:12 }}><div><div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:7 }}><AlertBadge level={item.level} T={T}>{levelLabel(item.level)}</AlertBadge><AlertBadge level="info" T={T}>{item.type}</AlertBadge></div><div style={{ fontSize:FONT.xl.size, fontWeight:900, color:T.text }}>{item.label}</div><div style={{ fontSize:FONT.sm.size, color:T.textMuted, marginTop:3 }}>{item.subtitle}</div></div><button className="inv-btn inv-btn-out inv-btn-sm" onClick={onClose}><Icon as={X} size={13}/>Fermer</button></div><div style={{ padding:SPACING.lg, overflowY:"auto", display:"grid", gap:SPACING.md }}><section style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Alertes consolidées</div><div style={{ display:"grid", gap:6 }}>{safeArr(item.alerts).length ? item.alerts.map(a => <div key={a.code} style={{ display:"flex", justifyContent:"space-between", gap:8, border:`1px solid ${levelColor(a.level, T)}35`, background:T.input, borderRadius:RADIUS.md, padding:"7px 8px" }}><span style={{ color:T.textSub, fontWeight:800 }}>{a.label}</span>{a.due_date && <span style={{ fontFamily:"'DM Mono',monospace", color:levelColor(a.level, T) }}>{safeDate(a.due_date)}</span>}</div>) : <div style={{ color:T.textMuted }}>Aucune alerte.</div>}</div></section><section style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card, padding:SPACING.md }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Lecture rapide</div><div style={fieldGrid}>{item.type === "prospect" && <><DetailField label="Score" value={`${item.score || 0}/100`} T={T} mono/><DetailField label="Budget" value={fmtDashboardEur(item.meta?.budget)} T={T}/><DetailField label="Capacité" value={fmtDashboardEur(item.meta?.capacity)} T={T}/><DetailField label="Téléphone" value={item.meta?.phone} T={T}/><DetailField label="Email" value={item.meta?.email} T={T}/><DetailField label="Source" value={item.meta?.source} T={T}/><DetailField label="Objectif" value={item.meta?.goal} T={T}/><DetailField label="Dernier contact" value={safeDate(item.meta?.lastContact)} T={T}/></>}{item.type === "client" && <><DetailField label="Étape" value={item.meta?.step} T={T}/><DetailField label="Statut" value={item.meta?.status} T={T}/><DetailField label="Budget" value={fmtDashboardEur(item.meta?.budget)} T={T}/><DetailField label="Dernière activité" value={safeDate(item.meta?.lastActivity)} T={T}/></>}{item.type === "bien" && <><DetailField label="Statut" value={item.meta?.statut} T={T}/><DetailField label="Prix" value={fmtDashboardEur(item.meta?.prix)} T={T}/><DetailField label="Travaux" value={fmtDashboardEur(item.meta?.travaux)} T={T}/><DetailField label="Rendement" value={item.meta?.rendement ? fmtDashboardPct(item.meta.rendement) : "—"} T={T}/><DetailField label="Cash-flow" value={fmtDashboardEur(item.meta?.cashflow)} T={T}/><DetailField label="Score" value={item.meta?.score} T={T} mono/></>}{item.type === "team" && <><DetailField label="Responsable" value={item.responsable} T={T}/><DetailField label="Statut" value={item.meta?.status} T={T}/><DetailField label="Échéance" value={safeDate(item.due_date)} T={T}/></>}</div><button className="inv-btn inv-btn-out inv-btn-sm" style={{ marginTop:SPACING.sm }} onClick={() => onOpenFull?.(item)}><Icon as={ExternalLink} size={12}/>Ouvrir la fiche complète</button></section><section style={{ border:`1px solid ${missing.length ? WA : SU}55`, borderRadius:RADIUS.lg, background:T.input, padding:SPACING.md }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:SPACING.sm }}><div style={{ fontWeight:900, color:T.text }}>Décision du jour</div>{missing.length ? <AlertBadge level="warning" T={T}>{missing.length} champ(s) manquant(s)</AlertBadge> : <AlertBadge level="success" T={T}>Complet</AlertBadge>}</div><div style={{ display:"grid", gap:8 }}><select className="inv-sel" value={d.decision || ""} onChange={e => set({ decision:e.target.value })}><option value="">Décision</option>{decisions.map(x => <option key={x}>{x}</option>)}</select><select className="inv-sel" value={d.responsable || ""} onChange={e => set({ responsable:e.target.value })}><option value="">Responsable</option>{V9_RESPONSABLES.map(r => <option key={r}>{r}</option>)}</select><input className="inv-inp" value={d.next_action || ""} onChange={e => set({ next_action:e.target.value })} placeholder="Action future" style={{ width:"100%", textAlign:"left" }}/><input className="inv-inp" type="date" value={d.due_date || ""} onChange={e => set({ due_date:e.target.value })} style={{ width:"100%" }}/>{isBien && (normTxt(d.decision).includes("proposer") || normTxt(d.decision).includes("matcher")) && <input className="inv-inp" value={d.client_id || ""} onChange={e => set({ client_id:e.target.value })} placeholder="Client à matcher / proposer" style={{ width:"100%", textAlign:"left" }}/>} {isBien && normTxt(d.decision).includes("offre") && <input className="inv-inp" value={d.offer_amount || ""} onChange={e => set({ offer_amount:e.target.value })} placeholder="Montant de l’offre" style={{ width:"100%", textAlign:"left" }}/>}<textarea className="inv-inp" value={d.comment || ""} onChange={e => set({ comment:e.target.value })} placeholder="Commentaire obligatoire" style={{ minHeight:92, width:"100%", textAlign:"left" }}/><label style={{ display:"flex", alignItems:"center", gap:7, fontSize:FONT.sm.size, color:T.textSub }}><input type="checkbox" checked={Boolean(d.force_validated)} onChange={e => set({ force_validated:e.target.checked })}/> Validation forcée</label>{d.force_validated && <textarea className="inv-inp" value={d.force_reason || ""} onChange={e => set({ force_reason:e.target.value })} placeholder="Motif obligatoire du forçage" style={{ minHeight:70, width:"100%", textAlign:"left" }}/>}<button className="inv-btn inv-btn-gold" disabled={saving || missing.length > 0} onClick={() => onSave?.(item, d)}><Icon as={Check} size={14}/>{saving ? "Validation…" : "Valider le suivi du jour"}</button>{missing.length > 0 && <div style={{ color:WA, fontSize:FONT.xs.size + 1 }}>Complète : {missing.join(", ")}</div>}</div></section></div></aside></div>;
}
function printPlan(plan=[]) {
  const owners = Array.from(new Set(plan.map(p => p.responsable || "À définir")));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan d'action ${todayIso()}</title><style>body{font-family:Arial,sans-serif;color:#0D2E5C;margin:32px}h1{font-size:24px;margin:0 0 6px}h2{margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#667085}.item{margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:8px}.title{font-weight:700}.meta{font-size:12px;color:#667085;margin-top:4px}</style></head><body><h1>Plan d'action du jour — Profero Invest</h1><div class="muted">Dashboard V9 — ${todayIso()}</div>${owners.map(o => `<h2>${o}</h2>${plan.filter(p => (p.responsable || "À définir") === o).map(p => `<div class="item"><div class="title">${p.title || "Action"}</div><div class="meta">Échéance : ${safeDate(p.due_date)} · Source : ${p.source || "—"} · Décision : ${p.decision || "—"}</div><div>${p.comment || ""}</div></div>`).join("")}`).join("")}</body></html>`;
  const w = window.open("", "_blank"); if (!w) return; w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

function TableauBord({ profil, T=THEMES_INV.dark, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeView, setActiveView] = useState("pilotage");
  const [selected, setSelected] = useState(null);
  const [decisionItem, setDecisionItem] = useState(null);
  const [clients, setClients] = useState([]);
  const [crmProspects, setCrmProspects] = useState([]);
  const [biens, setBiens] = useState([]);
  const [propositions, setPropositions] = useState([]);
  const [planning, setPlanning] = useState([]);
  const [actions, setActions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [finance, setFinance] = useState([]);
  // La routine du jour est chargée depuis la base par loadDashboard : elle doit
  // suivre l'utilisateur d'un appareil à l'autre, pas rester dans un navigateur.
  const [routine, setRoutine] = useState(() => emptyRoutine());
  const [routineChargee, setRoutineChargee] = useState(false);

  // Persistance des 3 priorités du jour.
  //
  // Elles se saisissent au clavier : on ne peut pas écrire à chaque frappe.
  // Un délai d'inactivité, puis remplacement des lignes du jour — supprimer
  // avant d'insérer évite d'avoir à supposer une contrainte d'unicité sur une
  // table dont le schéma n'est pas versionné dans le dépôt.
  //
  // On n'écrit qu'après le premier chargement : sans cette garde, le state
  // initial vide effacerait les priorités déjà saisies ailleurs.
  const prioritesTimer = useRef(null);
  useEffect(() => {
    if (!routineChargee) return;
    if (prioritesTimer.current) clearTimeout(prioritesTimer.current);
    prioritesTimer.current = setTimeout(async () => {
      const lignes = safeArr(routine.priorities)
        .map((p, idx) => ({ p: p || {}, idx }))
        .filter(({ p }) => String(p.title || "").trim())
        .map(({ p, idx }) => ({
          routine_date: todayIso(),
          step_key: "priorite",
          item_type: "priorite",
          item_id: String(idx),
          item_label: p.title || "",
          next_action: p.title || "",
          responsable: p.responsable || null,
          due_date: p.due_date || null,
          comment: p.comment || "",
          status: "validated",
        }));
      try {
        await supabase.from("invest_morning_routine_items")
          .delete().eq("routine_date", todayIso()).eq("step_key", "priorite");
        if (lignes.length) await supabase.from("invest_morning_routine_items").insert(lignes);
      } catch (e) {
        console.warn("[Dashboard] priorités non enregistrées", e);
      }
    }, 1200);
    return () => { if (prioritesTimer.current) clearTimeout(prioritesTimer.current); };
  }, [routine.priorities, routineChargee]);

  const safeQuery = useCallback(async (label, query, required=false) => {
    try { const { data, error } = await query; if (error) { console.warn(`[Dashboard V9] ${label}`, error); if (required) setError(`Impossible de charger ${label}. Vérifie Supabase / RLS.`); return []; } return data || []; } catch(e) { console.warn(`[Dashboard V9] ${label}`, e); if (required) setError(`Impossible de charger ${label}.`); return []; }
  }, []);
  const loadDashboard = useCallback(async () => {
    setLoading(true); setError("");
    const [c,b,p,pl,a,n,fin,routineRows] = await Promise.all([
      safeQuery("clients", supabase.from("invest_clients").select("*").order("created_at", { ascending:false }), true),
      safeQuery("biens", supabase.from("invest_biens").select("*").order("created_at", { ascending:false }), true),
      safeQuery("propositions", supabase.from("invest_propositions").select("*").limit(500)),
      safeQuery("planning", supabase.from("invest_planning").select("*").order("date_rdv", { ascending:false }).limit(500)),
      safeQuery("actions équipe", supabase.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").order("due_date", { ascending:true, nullsFirst:false }).limit(700)),
      safeQuery("notifications", supabase.from("invest_action_notifications").select("*").order("created_at", { ascending:false }).limit(100)),
      safeQuery("finance", supabase.from("invest_suivi_financier").select("*").limit(800)),
      safeQuery("routine du jour", supabase.from("invest_morning_routine_items").select("*").eq("routine_date", todayIso())),
    ]);
    const prospectTables = ["invest_prospects", "invest_prospection", "invest_crm_prospects", "invest_crm_prospection", "invest_prospection_contacts", "crm_prospection", "crm_prospects", "prospects"];
    const prospectRows = (await Promise.all(prospectTables.map(t => safeQuery(`prospection ${t}`, supabase.from(t).select("*").order("created_at", { ascending:false }).limit(1000))))).flatMap((rows, idx) => withSourceTable(rows, prospectTables[idx]));
    setClients(c); setBiens(b); setPropositions(p); setPlanning(pl); setActions(a); setNotifications(n); setFinance(fin); setCrmProspects(prospectRows);
    setRoutine(routineDepuisLignes(routineRows));
    setRoutineChargee(true);
    setLoading(false);
  }, [safeQuery]);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const data = useMemo(() => consolidateData({ clients, crmProspects, biens, propositions, planning, actions }), [clients, crmProspects, biens, propositions, planning, actions]);
  const doneItems = useMemo(() => safeArr(data.allDossiers).filter(d => isResolvedToday(routine, d)), [data.allDossiers, routine]);
  const openItems = useMemo(() => safeArr(data.allDossiers).filter(d => !isResolvedToday(routine, d)), [data.allDossiers, routine]);
  const byColumn = useMemo(() => {
    const filtered = filterDossiers(openItems, filter);
    return {
      decision:sortDossiers(filtered.filter(d => d.category === "decision")),
      watch:sortDossiers(filtered.filter(d => d.category === "watch")),
      delegated:sortDossiers(filtered.filter(d => d.category === "delegated")),
      done:sortDossiers(filterDossiers(doneItems, filter)),
    };
  }, [openItems, doneItems, filter]);
  const plan = useMemo(() => planFromRoutine(routine, data.allDossiers), [routine, data.allDossiers]);
  const currentDecision = decisionItem ? (routine.decisions?.[decisionKey(decisionItem)] || defaultDecision(decisionItem)) : null;
  const openDetail = item => setSelected(item);
  const openDecision = item => { setDecisionItem(item); setSelected(null); };
  const updateDecision = value => { if (!decisionItem) return; setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(decisionItem)]:value } })); };

  // Ouvre la fiche complète du dossier consolidé.
  //
  // Un prospect issu de `invest_clients` (converti, ou saisi directement au CRM)
  // n'existe pas dans la table prospection : le renvoyer là-bas afficherait une
  // fiche vide. On le route vers le CRM, qui est sa vraie fiche.
  const openFullRecord = item => {
    if (!item) return;
    if (item.type === "prospect") {
      if (item.sourceTable === "invest_clients") onNavigate?.("crm", NAV.ficheClient(item.id));
      else onNavigate?.("prospection", NAV.ficheProspect(item.id, item.sourceTable));
    }
    else if (item.type === "client") onNavigate?.("crm", NAV.ficheClient(item.id));
    else if (item.type === "bien")   onNavigate?.("biens", NAV.ficheBien(item.id));
    else onNavigate?.("crm", NAV.actionsClient(item.raw?.client_id || item.client_id, item.id));
  };
  const createNotification = async ({ actionId, responsable, title, message, item }) => {
    if (!responsable || responsable === "Matthieu") return;
    try { await supabase.from("invest_action_notifications").insert({ action_id:actionId || null, recipient:responsable, title:title || "Nouvelle action assignée", message:message || "Action créée depuis le Dashboard V9.", linked_entity_type:item?.type || null, linked_entity_id:item?.id ? String(item.id) : null, priority:item?.level === "danger" ? "high" : "normal", status:"unread", source_module:"dashboard_v9", created_by:profil?.email || profil?.nom || "Matthieu" }); } catch(e) { console.warn("Notification non bloquante", e); }
  };
  const createMissionAction = async (item, d) => {
    if (!d?.create_task || !d?.responsable || !d?.next_action) return null;
    if (d.responsable === "Matthieu") return null;
    const base = { responsable:d.responsable, action_title:d.next_action, due_date:d.due_date || null, status:"a_faire", step_label:`Dashboard V9 — ${item.type}`, client_id:item.type === "client" || (item.type === "prospect" && item.sourceTable === "invest_clients") ? item.id : null };
    const linked = { ...base, linked_entity_type:item.type, linked_entity_id:String(item.id), source_module:"dashboard_v9", source_context:{ comment:d.comment, decision:d.decision, routine_date:todayIso() } };
    let created = null;
    const first = await supabase.from("invest_mission_actions").insert(linked).select("id").single();
    if (first.error) {
      const fallback = await supabase.from("invest_mission_actions").insert(base).select("id").single();
      if (!fallback.error) created = fallback.data;
    } else created = first.data;
    await createNotification({ actionId:created?.id, responsable:d.responsable, title:d.next_action, message:d.comment, item });
    return created?.id || null;
  };
  const applyEntityUpdate = async (item, d) => {
    if (item.type === "prospect") {
      const table = item.sourceTable || "invest_clients";
      const payload = { prochaine_action:d.next_action, date_prochaine_action:d.due_date };
      if (table === "invest_clients") payload.conseiller = d.responsable;
      if (normTxt(d.decision).includes("perdu")) payload.statut = "Perdu";
      if (normTxt(d.decision).includes("archiver")) payload.statut = "Archivé";
      await supabase.from(table).update(payload).eq("id", item.id);
    } else if (item.type === "client") {
      await supabase.from("invest_clients").update({ prochaine_action:d.next_action, date_prochaine_action:d.due_date, conseiller:d.responsable }).eq("id", item.id);
    } else if (item.type === "bien") {
      const dn = normTxt(d.decision);
      const statut = dn.includes("archiver") ? "Archivé" : dn.includes("visite") ? "À visiter" : dn.includes("proposer") ? "Proposé à client" : dn.includes("matcher") ? "À matcher" : dn.includes("offre") ? "Offre à faire" : dn.includes("attente") ? "À trier" : dn.includes("analyser") ? "À analyser" : item.raw?.statut;
      await supabase.from("invest_biens").update({ statut, date_relance:d.due_date, conseiller_profero:d.responsable }).eq("id", item.id);
    }
  };
  const saveDecision = async (item, d) => {
    const miss = missingDecisionFields(item, d);
    if (miss.length) { setError(`Validation impossible : complète ${miss.join(", ")}.`); return; }
    setSaving(true); setError("");
    try {
      await applyEntityUpdate(item, d);
      const taskId = await createMissionAction(item, d);
      try { await supabase.from("invest_morning_routine_items").insert({ routine_date:todayIso(), step_key:"pilotage_dossier", item_type:item.type, item_id:String(item.id), item_label:item.label, alert_level:item.level, decision:d.decision, comment:d.comment, responsable:d.responsable, next_action:d.next_action, due_date:d.due_date || null, status:"validated", created_task_id:taskId ? String(taskId) : null }); } catch(e) { console.warn("Historique routine non bloquant", e); }
      setRoutine(prev => ({ ...prev, decisions:{ ...prev.decisions, [decisionKey(item)]:{ ...d, created_task_id:taskId || null, resolved_at:new Date().toISOString() } }, resolved:{ ...prev.resolved, [decisionKey(item)]:{ resolved_at:new Date().toISOString(), label:item.label, type:item.type } } }));
      setDecisionItem(null); await loadDashboard();
    } catch(e) { console.error(e); setError(e.message || "Impossible de valider le dossier."); }
    setSaving(false);
  };
  const printPdf = () => printPlan(plan);

  const renderPilotage = () => <>
    <StateBar data={data} doneCount={doneItems.length} T={T} onSelect={(k) => { if (k === "done") setActiveView("plan"); }} />
    <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", marginBottom:SPACING.md }}><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>{V9_ENTITY_FILTERS.map(f => { const active = filter === f.key; return <button key={f.key} className={`inv-btn ${active ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setFilter(f.key)}><Icon as={f.icon} size={12}/>{f.label}</button> })}</div><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className="inv-btn inv-btn-out inv-btn-sm" onClick={loadDashboard}><Icon as={RefreshCw} size={12}/>Actualiser</button><button className="inv-btn inv-btn-gold inv-btn-sm" onClick={printPdf}><Icon as={Download} size={12}/>Plan PDF</button></div></div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md, alignItems:"start" }} className="v9-board-grid"><BoardColumn column={V9_COLUMNS[0]} items={byColumn.decision} T={T} onOpen={openDetail} onDecide={openDecision}/><BoardColumn column={V9_COLUMNS[1]} items={byColumn.watch} T={T} onOpen={openDetail} onDecide={openDecision}/><BoardColumn column={V9_COLUMNS[2]} items={byColumn.delegated} T={T} onOpen={openDetail} onDecide={openDecision}/></div>
    <SectionCard title="Traité aujourd’hui" icon={Check} subtitle="Dossiers consolidés validés dans la journée" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{byColumn.done.length ? byColumn.done.map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact/>) : <div style={{ padding:SPACING.lg, border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, textAlign:"center", color:T.textMuted }}>Aucun dossier traité aujourd'hui.</div>}</div></SectionCard>
    <PrioritiesPanel routine={routine} setRoutine={setRoutine} T={T}/>
    <ActionPlanPDF plan={plan} T={T} onPrint={printPdf}/>
  </>;
  const renderMetier = () => <div style={{ display:"grid", gap:SPACING.md }}><SectionCard title="Prospects actifs" icon={Phone} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(filterDossiers(data.prospectDossiers, "all")).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard><SectionCard title="Clients actifs" icon={Briefcase} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(data.clientDossiers).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard><SectionCard title="Stock de biens" icon={Home} T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:SPACING.md }}>{sortDossiers(data.bienDossiers).map(item => <DossierCard key={item.key} item={item} T={T} onOpen={openDetail} onDecide={openDecision} compact />)}</div></SectionCard></div>;
  const renderEquipe = () => <SectionCard title="Pilotage équipe à distance" icon={Users} subtitle="Actions déléguées et notifications collaborateurs" T={T}><div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:SPACING.md }}>{V9_RESPONSABLES.map(r => { const list = data.allDossiers.filter(d => d.responsable === r && (d.category === "delegated" || d.type === "team")); return <div key={r} style={{ border:`1px solid ${T.border}`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}><div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:8 }}><strong style={{ color:T.text }}>{r}</strong><AlertBadge level={list.some(x => x.level === "danger") ? "danger" : "info"} T={T}>{list.length}</AlertBadge></div>{list.slice(0,8).map(item => <button key={item.key} onClick={() => openDetail(item)} style={{ width:"100%", textAlign:"left", border:"none", background:"transparent", padding:"7px 0", borderTop:`1px solid ${T.border}`, cursor:"pointer", fontFamily:"inherit" }}><div style={{ color:T.text, fontWeight:800, fontSize:FONT.sm.size }}>{item.next_action || item.label}</div><div style={{ color:T.textMuted, fontSize:FONT.xs.size }}>{item.label} · {safeDate(item.due_date)}</div></button>)}</div> })}</div>{notifications.length > 0 && <div style={{ marginTop:SPACING.md, color:T.textMuted, fontSize:FONT.sm.size }}>{notifications.filter(n => !n.read_at && n.status !== "read").length} notification(s) collaborateur non lue(s).</div>}</SectionCard>;

  return <div style={{ padding:`${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth:1500, margin:"0 auto" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:SPACING.md, flexWrap:"wrap", marginBottom:SPACING.xl }}><div style={{ display:"flex", gap:SPACING.md, alignItems:"center" }}><div style={{ width:50, height:50, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={LayoutDashboard} size={24}/></div><div><div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Dashboard pilotage quotidien</div><div style={{ fontSize:FONT.sm.size + 1, color:T.textSub }}>V9 — 1 dossier = 1 carte consolidée. Pilotable à distance, sans doublons.</div></div></div><div style={{ display:"flex", gap:8, flexWrap:"wrap" }}><button className={`inv-btn ${activeView === "pilotage" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("pilotage")}><Icon as={LayoutGrid} size={12}/>Pilotage</button><button className={`inv-btn ${activeView === "metier" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("metier")}><Icon as={ListChecks} size={12}/>Vue métier</button><button className={`inv-btn ${activeView === "equipe" ? "inv-btn-gold" : "inv-btn-out"} inv-btn-sm`} onClick={() => setActiveView("equipe")}><Icon as={Users} size={12}/>Équipe</button></div></div>
    {error && <div style={{ marginBottom:SPACING.md, padding:SPACING.md, border:`1px solid ${SEMANTIC?.danger?.border || "#fecdd3"}`, background:SEMANTIC?.danger?.bg || "#fff1f2", borderRadius:RADIUS.md, color:DA }}>{error}</div>}
    {loading ? <div style={{ padding:SPACING.xxxl, textAlign:"center", color:T.textMuted }}><Icon as={RefreshCw} size={15} style={{ animation:"spin 1s linear infinite" }}/> Chargement du pilotage consolidé…</div> : activeView === "pilotage" ? renderPilotage() : activeView === "metier" ? renderMetier() : renderEquipe()}
    <DecisionDrawer item={decisionItem || selected} decision={decisionItem ? currentDecision : null} setDecision={decisionItem ? updateDecision : null} T={T} onClose={() => { setDecisionItem(null); setSelected(null); }} onSave={decisionItem ? saveDecision : null} onOpenFull={openFullRecord} saving={saving}/>
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @media(max-width:1180px){.v9-board-grid{grid-template-columns:1fr!important}}`}</style>
  </div>;
}

export default TableauBord;
export { TableauBord };
