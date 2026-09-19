// src/Invest/tableauBord.mjs — Moteur du tableau de bord Invest.
//
// Pourquoi ce module existe
// ─────────────────────────
// Toute la consolidation du tableau de bord (V9) vivait dans Dashboard.jsx :
// un fichier React, avec des imports de lucide-react. Impossible à charger
// depuis Node — donc impossible à rejouer côté serveur.
//
// Or le tableau de bord est le SEUL endroit où l'on sait ce qu'il faut faire
// aujourd'hui : quels dossiers demandent un arbitrage, lesquels sont délégués,
// lesquels sont déjà traités. Tant que cette logique restait enfermée dans
// l'interface, un mail quotidien ne pouvait que la réinventer — et diverger.
//
// Extension .mjs : parsable en ESM par Node sans passer par le build, pour que
// api/_cron/ (en CommonJS) l'importe via `await import()`. Même convention que
// annuaire.mjs et relances.mjs. Le front passe par Dashboard.jsx et
// _shared.jsx, qui réexporte les formateurs.
//
// Ce que ce module NE contient pas : aucun composant, aucune icône, aucune
// couleur de thème. La présentation reste côté appelant — l'écran dessine des
// cartes, le mail dessine des lignes de tableau, avec les mêmes données.
//
// Notion d'« aujourd'hui »
// ────────────────────────
// Les prédicats de date comparent au jour courant du processus (UTC sur
// Vercel, heure locale dans le navigateur). L'écart ne se manifeste qu'entre
// minuit et 2h heure de Paris ; la veille tourne à 7h. Les crons qui ont
// besoin du jour Paris exact le passent explicitement via `jour`.

import { estUtilisateurCourant } from "./annuaire.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Formateurs et petits utilitaires purs
//
// Ils vivaient dans _shared.jsx, qui est un fichier JSX : Node ne peut pas
// l'analyser. Ils sont définis ici et réexportés par _shared.jsx, pour qu'il
// n'existe qu'une seule définition de chacun.
// ─────────────────────────────────────────────────────────────────────────────

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const normTxt = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const fmtDashboardEur = (v) => Number(v || 0) > 0
  ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v || 0)) + " €"
  : "—";
export const fmtDashboardPct = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(1).replace(".", ",") + " %" : "—";
export const safeDate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";
export const daysBetween = (from, to = new Date()) => {
  if (!from) return null;
  const a = new Date(from); a.setHours(12, 0, 0, 0);
  const b = new Date(to);   b.setHours(12, 0, 0, 0);
  return Math.round((b - a) / 86400000);
};
export const getClientName = (c) => `${c?.prenom || ""} ${c?.nom || ""}`.trim() || c?.nom || "Client";
export const getBienLabel = (b) => [b?.reference_interne, b?.adresse, b?.ville].filter(Boolean).join(" · ") || "Bien sans adresse";
export const getBienScore = (b) => {
  const v = b?.visite_data || {};
  const note = parseFloat(v?.conclusion?.note_globale || 0);
  const rendement = parseFloat(b?.rendement_brut || v?.finance?.rendement_brut || 0);
  const cashflow = parseFloat(b?.cashflow_estime || v?.finance?.cashflow_mensuel_estime || 0);
  let score = 0;
  if (note > 0) score += Math.min(10, note) * 10;
  if (rendement > 0) score += Math.min(15, rendement) * 3;
  if (cashflow > 0) score += Math.min(500, cashflow) / 20;
  if (["Offre à faire", "Visité", "À analyser", "A analyser"].includes(b?.statut)) score += 12;
  if (["Offre envoyée", "Offre acceptée"].includes(b?.statut)) score += 18;
  return Math.round(score);
};

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulaire du tableau de bord
// ─────────────────────────────────────────────────────────────────────────────

// Les quatre colonnes, sans icône ni couleur : l'écran et le mail les habillent
// chacun à sa façon, mais les clés, libellés et explications sont les mêmes.
export const V9_COLONNES = [
  { key: "decision",  label: "À décider maintenant",  help: "Dossiers qui demandent ton arbitrage aujourd'hui." },
  { key: "watch",     label: "À surveiller",          help: "Dossiers suivis avec une échéance future ou une vigilance." },
  { key: "delegated", label: "Délégué / en attente",  help: "Actions confiées à l'équipe ou en attente de retour." },
  { key: "done",      label: "Traité aujourd'hui",    help: "Dossiers validés dans le dashboard du jour." },
];

export const V9_DECISIONS = {
  prospect: ["Appeler", "Envoyer WhatsApp", "Envoyer mail", "Programmer RDV", "Créer tâche", "Assigner", "Reporter", "Passer froid", "Passer perdu", "Archiver"],
  client:   ["Faire avancer", "Relancer client", "Relancer banque", "Relancer notaire", "Relancer assurance", "Demander document", "Assigner", "Arbitrage Matthieu", "Mettre en pause", "Clôturer"],
  bien:     ["Analyser", "Demander visite terrain", "Proposer à un client", "Matcher avec client", "Relancer agent / vendeur", "Faire offre", "Revoir le prix", "Archiver", "Mettre en attente"],
  team:     ["Valider retour", "Demander retour", "Réassigner", "Bloquer", "Clôturer"],
};

export const V9_PROSPECT_LOST = ["perdu", "perdue", "archive", "archivé", "archivée", "supprime", "supprimé", "supprimée", "corbeille", "trash", "deleted", "removed", "inactif", "termine", "terminé", "client"];
export const V9_BIEN_INACTIVE = ["archivé", "archive", "refusé", "refuse", "terminé", "termine", "vendu", "perdu"];
export const V9_CLIENT_INACTIVE = ["prospect", "inactif", "terminé", "termine", "perdu", "archivé", "archive", "supprimé", "supprime"];

// ─────────────────────────────────────────────────────────────────────────────
// Dates et lecture tolérante des colonnes
// ─────────────────────────────────────────────────────────────────────────────

export function todayIso() { return isoDate(new Date()); }
export function safeArr(v) { return Array.isArray(v) ? v : []; }
export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
export function isDueTodayOrPast(value) {
  const d = toDate(value); const t = toDate(new Date());
  return Boolean(d && t && d <= t);
}
export function isFuture(value) {
  const d = toDate(value); const t = toDate(new Date());
  return Boolean(d && t && d > t);
}
export function isWithinNextDays(value, days = 7) {
  const d = toDate(value); const t = toDate(new Date());
  if (!d || !t) return false;
  const end = new Date(t); end.setDate(end.getDate() + days);
  return d >= t && d <= end;
}
export function daysSince(value) {
  const d = toDate(value); const t = toDate(new Date());
  if (!d || !t) return null;
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}
export function firstFilled(obj = {}, keys = []) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}
export function numberFromAny(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
export function joinNonEmpty(parts = [], sep = " · ") { return parts.map(v => String(v || "").trim()).filter(Boolean).join(sep); }
export function levelRank(level) { return ({ danger: 0, warning: 1, info: 2, success: 3 }[level] ?? 4); }
export function levelLabel(level) { return level === "danger" ? "Urgent" : level === "warning" ? "Attention" : level === "success" ? "OK" : "Info"; }

export function isDeletedLike(row = {}) {
  const deletedFlags = [row.deleted_at, row.removed_at, row.archived_at].some(Boolean);
  const boolFlags = [row.is_deleted, row.deleted, row.supprime, row.supprimé, row.removed, row.trashed, row.corbeille].some(v => v === true || String(v).toLowerCase() === "true");
  const txt = normTxt(`${row.statut || ""} ${row.status || ""} ${row.etat || ""} ${row.state || ""}`);
  return deletedFlags || boolFlags || ["supprime", "supprim", "deleted", "removed", "trash", "corbeille"].some(k => txt.includes(k));
}
export function prospectStatusText(c = {}) { return normTxt(`${c.statut || ""} ${c.status || ""} ${c.etape || ""} ${c.pipeline_stage || ""} ${c.categorie || ""} ${c.type || ""}`); }
export function isActiveProspectRecord(c = {}) {
  if (!c || !c.id || isDeletedLike(c)) return false;
  const txt = prospectStatusText(c);
  if (V9_PROSPECT_LOST.some(k => txt.includes(k))) return false;
  if (txt.includes("actif") || txt.includes("client") || c.date_signature) return false;
  const explicit = firstFilled(c, ["contact_type", "type_contact", "type", "categorie", "pipeline", "module"]);
  if (normTxt(explicit).includes("prospect")) return true;
  const prospectWords = ["prospect", "nouveau", "qualifie", "qualifié", "rdv", "proposition", "relance", "chaud", "tiede", "tiède", "froid", "a qualifier", "à qualifier"];
  return prospectWords.some(k => txt.includes(k)) || (!txt || txt === "nouveau");
}
export function isClientRecord(c = {}) {
  if (!c || !c.id || isDeletedLike(c)) return false;
  const txt = normTxt(`${c.statut || ""} ${c.status || ""} ${c.etape || ""}`);
  if (V9_CLIENT_INACTIVE.some(k => txt.includes(k))) return false;
  return c.date_signature || txt.includes("actif") || txt.includes("contrat") || txt.includes("financement") || txt.includes("compromis") || txt.includes("travaux") || txt.includes("location") || Boolean(c.etape);
}
export function isActiveBien(b = {}) {
  if (!b || !b.id || isDeletedLike(b)) return false;
  const txt = normTxt(`${b.statut || ""} ${b.status || ""}`);
  return !V9_BIEN_INACTIVE.some(k => txt.includes(k));
}
export function withSourceTable(rows = [], table) { return safeArr(rows).map(r => ({ ...r, _source_table: table })); }
export function uniqueRows(rows = []) {
  const map = new Map();
  safeArr(rows).forEach(r => {
    const key = `${r._source_table || "invest_clients"}:${r.id}`;
    if (!map.has(key)) map.set(key, r);
  });
  return Array.from(map.values());
}

// Le défaut n'est plus un prénom en dur : un dossier sans responsable revient
// à qui pilote le tableau de bord, quel que soit son nom.
export function prospectOwner(c = {}, defaut = "") { return firstFilled(c, ["conseiller", "responsable", "owner", "assigned_to", "commercial", "collaborateur"]) || defaut; }
export function prospectEmail(c = {}) { return firstFilled(c, ["email", "mail", "adresse_email"]); }
export function prospectPhone(c = {}) { return firstFilled(c, ["telephone", "téléphone", "phone", "mobile", "whatsapp"]); }
export function prospectSource(c = {}) { return firstFilled(c, ["source_lead", "source", "origine", "canal", "provenance", "lead_source"]); }
export function prospectStage(c = {}) { return firstFilled(c, ["etape", "étape", "pipeline_stage", "stage", "statut", "status"]); }
export function prospectBudget(c = {}) { return numberFromAny(firstFilled(c, ["budget", "budget_cible", "budget_max", "montant_projet"])); }
export function prospectCapacity(c = {}) { return numberFromAny(firstFilled(c, ["capacite_emprunt", "capacité_emprunt", "capacite", "capacité", "financement", "budget_financement"])); }
export function prospectApport(c = {}) { return numberFromAny(firstFilled(c, ["apport", "apport_personnel", "cash", "epargne", "épargne"])); }
export function prospectMotivation(c = {}) { return firstFilled(c, ["motivation", "niveau_motivation", "qualification", "temperature", "priorite", "priorité"]); }
export function prospectHorizon(c = {}) { return firstFilled(c, ["horizon", "delai", "délai", "deadline", "date_projet", "urgence"]); }
export function prospectZone(c = {}) { return firstFilled(c, ["zone_ciblee", "zone_ciblée", "zone", "secteur", "ville_recherche", "ville"]); }
export function prospectGoal(c = {}) { return firstFilled(c, ["objectif", "objectif_investissement", "strategie", "stratégie", "projet"]); }
export function prospectComment(c = {}) { return firstFilled(c, ["commentaire", "commentaires", "note", "notes", "description", "message"]); }
export function prospectLastContact(c = {}) { return firstFilled(c, ["date_dernier_contact", "dernier_contact", "last_contact_at", "last_contact", "updated_at", "date_premier_contact", "created_at"]); }
export function prospectNextAction(c = {}) { return firstFilled(c, ["prochaine_action", "next_action", "action_suivante", "relance_action"]); }
export function prospectNextDate(c = {}) { return firstFilled(c, ["date_prochaine_action", "relance_date", "date_relance", "next_action_date", "due_date"]); }
export function relanceCount(c = {}) { return numberFromAny(firstFilled(c, ["relance_count", "nb_relances", "nombre_relances", "relances_count"])); }
export function nextRelanceDateFromCount(count = 0) {
  const seq = [1, 3, 7, 14, 30];
  const days = seq[Math.min(Math.max(0, Number(count) || 0), seq.length - 1)];
  const d = new Date(); d.setDate(d.getDate() + days);
  return isoDate(d);
}
export function computeProspectScore(c = {}) {
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

export function actionOwner(a = {}, defaut = "") { return firstFilled(a, ["responsable", "owner", "assigned_to", "assignee", "collaborateur"]) || defaut; }
export function actionTitle(a = {}) { return firstFilled(a, ["action_title", "title", "titre", "nom", "label"]) || "Action"; }
export function isOpenAction(a = {}) {
  const s = normTxt(firstFilled(a, ["status", "statut", "etat"]));
  if (!s) return true;
  return ["a_faire", "à faire", "faire", "en_cours", "cours", "bloque", "bloqué", "open", "todo", "pending", "attente"].some(k => s.includes(k));
}
export function isDoneAction(a = {}) {
  const s = normTxt(firstFilled(a, ["status", "statut", "etat"]));
  return ["termine", "terminé", "fait", "done", "completed", "validé", "valide"].some(k => s.includes(k));
}
export function isBlockedAction(a = {}) {
  const s = normTxt(`${a.status || ""} ${a.statut || ""} ${a.commentaire || ""} ${a.comment || ""}`);
  return s.includes("bloque") || s.includes("bloqué") || s.includes("compliqué") || s.includes("complique");
}
export function isPartnerSensitive(a = {}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""} ${a.commentaire || ""}`);
  return txt.match(/notaire|financement|banque|assurance|compromis/);
}
export function isDocumentSensitive(a = {}) {
  const txt = normTxt(`${actionTitle(a)} ${a.step_label || ""} ${a.commentaire || ""}`);
  return txt.match(/document|pièce|piece|justificatif|contrat|patrimoine/);
}
export function linkedEntityType(a = {}) { return firstFilled(a, ["linked_entity_type", "item_type", "entity_type", "type_lien"]); }
export function linkedEntityId(a = {}) { return firstFilled(a, ["linked_entity_id", "item_id", "entity_id", "source_id"]); }
export function clientLastActivity(c = {}) { return firstFilled(c, ["date_derniere_action", "date_dernier_contact", "updated_at", "date_prochaine_action", "date_signature", "created_at"]); }

export function makeAlert({ code, label, level = "warning", due_date = "", source = "" }) { return { code, label, level, due_date, source }; }
export function worstLevel(alerts = []) {
  if (alerts.some(a => a.level === "danger")) return "danger";
  if (alerts.some(a => a.level === "warning")) return "warning";
  if (alerts.some(a => a.level === "info")) return "info";
  return "success";
}
export function entityKey(type, id) { return `${type}_${String(id || "unknown")}`; }

// ─────────────────────────────────────────────────────────────────────────────
// Routine du jour
// ─────────────────────────────────────────────────────────────────────────────

export function emptyRoutine() { return { date: todayIso(), decisions: {}, resolved: {}, priorities: [{}, {}, {}], status: "in_progress", started_at: new Date().toISOString() }; }
export function decisionKey(item) { return item?.key || entityKey(item?.type, item?.id); }

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
export function routineDepuisLignes(lignes = []) {
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

export function isResolvedToday(routine, item) { return Boolean(routine?.resolved?.[decisionKey(item)]); }
export function defaultDecision(item = {}) {
  const suggestedDue = item.due_date && isFuture(item.due_date) ? item.due_date : todayIso();
  return { decision: "", responsable: item.responsable || "", next_action: item.next_action || item.primaryAlert || "", due_date: suggestedDue, comment: "", create_task: true, force_reason: "" };
}
export function missingDecisionFields(item, d = {}) {
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
export function isDecisionComplete(item, d = {}) { return missingDecisionFields(item, d).length === 0; }
export function priorityComplete(p = {}) { return Boolean(String(p.title || "").trim() && String(p.responsable || "").trim() && String(p.due_date || "").trim() && String(p.comment || "").trim()); }

// ─────────────────────────────────────────────────────────────────────────────
// Construction des dossiers consolidés — 1 prospect / 1 client / 1 bien = 1 carte
// ─────────────────────────────────────────────────────────────────────────────

export function buildProspectDossier(c, pilote = "") {
  const alerts = [];
  const score = computeProspectScore(c);
  const nextAction = prospectNextAction(c);
  const nextDate = prospectNextDate(c);
  const owner = prospectOwner(c, pilote);
  const lastDays = daysSince(prospectLastContact(c));
  if (!nextAction) alerts.push(makeAlert({ code: "no_next_action", label: "Sans prochaine action", level: "danger" }));
  if (!nextDate) alerts.push(makeAlert({ code: "no_next_date", label: "Sans date de relance", level: "danger" }));
  if (!owner) alerts.push(makeAlert({ code: "no_owner", label: "Sans responsable", level: "danger" }));
  if (nextDate && isDueTodayOrPast(nextDate)) alerts.push(makeAlert({ code: "late_relaunch", label: `Relance à traiter (${safeDate(nextDate)})`, level: "danger", due_date: nextDate }));
  if (nextDate && isFuture(nextDate) && isWithinNextDays(nextDate, 7)) alerts.push(makeAlert({ code: "future_relaunch", label: `Relance à venir ${safeDate(nextDate)}`, level: "warning", due_date: nextDate }));
  if (lastDays !== null && lastDays >= 10) alerts.push(makeAlert({ code: "stale_red", label: `Sans contact depuis ${lastDays} jours`, level: "danger" }));
  else if (lastDays !== null && lastDays >= 7) alerts.push(makeAlert({ code: "stale_orange", label: `Sans contact depuis ${lastDays} jours`, level: "warning" }));
  if (score >= 70) alerts.push(makeAlert({ code: "hot", label: `Prospect chaud ${score}/100`, level: nextAction && nextDate && isFuture(nextDate) ? "warning" : "danger" }));
  const level = worstLevel(alerts);
  const due = nextDate || nextRelanceDateFromCount(relanceCount(c));
  return {
    key: entityKey("prospect", c.id), type: "prospect", id: c.id, sourceTable: c._source_table || "invest_clients",
    label: getClientName(c), subtitle: joinNonEmpty([prospectStage(c), prospectSource(c), prospectZone(c)]),
    level, alerts, primaryAlert: alerts[0]?.label || "Sous contrôle", responsable: owner || pilote,
    next_action: nextAction || "Définir la prochaine action prospect", due_date: due,
    readOnly: level !== "danger" && isFuture(due), score, raw: c,
    meta: { score, budget: prospectBudget(c), capacity: prospectCapacity(c), phone: prospectPhone(c), email: prospectEmail(c), source: prospectSource(c), goal: prospectGoal(c), lastContact: prospectLastContact(c) },
  };
}

export function buildClientDossier(c, actions = [], pilote = "") {
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
  if (!c.etape) alerts.push(makeAlert({ code: "no_stage", label: "Étape client non renseignée", level: "danger" }));
  if (!owner) alerts.push(makeAlert({ code: "no_owner", label: "Responsable non renseigné", level: "danger" }));
  if (!nextAction) alerts.push(makeAlert({ code: "no_next_action", label: "Sans prochaine action", level: "danger" }));
  if (!nextDate) alerts.push(makeAlert({ code: "no_next_date", label: "Sans date de prochaine action", level: "danger" }));
  if (nextDate && isDueTodayOrPast(nextDate)) alerts.push(makeAlert({ code: "late_action", label: `Action à traiter (${safeDate(nextDate)})`, level: "danger", due_date: nextDate }));
  if (nextDate && isFuture(nextDate) && isWithinNextDays(nextDate, 7)) alerts.push(makeAlert({ code: "future_action", label: `Échéance sous 7 jours (${safeDate(nextDate)})`, level: "warning", due_date: nextDate }));
  if (lastDays !== null && lastDays >= 10) alerts.push(makeAlert({ code: "stale_red", label: `Aucune avancée depuis ${lastDays} jours`, level: "danger" }));
  else if (lastDays !== null && lastDays >= 7) alerts.push(makeAlert({ code: "stale_orange", label: `À vérifier : ${lastDays} jours sans avancée`, level: "warning" }));
  blocked.forEach(a => alerts.push(makeAlert({ code: `blocked_${a.id}`, label: `Action bloquée : ${actionTitle(a)}`, level: "danger", due_date: a.due_date })));
  late.forEach(a => alerts.push(makeAlert({ code: `late_${a.id}`, label: `Tâche en retard : ${actionTitle(a)}`, level: "danger", due_date: a.due_date })));
  docs.forEach(a => alerts.push(makeAlert({ code: `doc_${a.id}`, label: `Document à suivre : ${actionTitle(a)}`, level: isDueTodayOrPast(a.due_date) ? "danger" : "warning", due_date: a.due_date })));
  partner.forEach(a => alerts.push(makeAlert({ code: `partner_${a.id}`, label: `Partenaire à suivre : ${actionTitle(a)}`, level: isDueTodayOrPast(a.due_date) ? "danger" : "warning", due_date: a.due_date })));
  const level = worstLevel(alerts);
  return {
    key: entityKey("client", c.id), type: "client", id: c.id, sourceTable: "invest_clients", label: getClientName(c), subtitle: joinNonEmpty([c.etape, c.statut, fmtDashboardEur(c.budget)]),
    level, alerts, primaryAlert: alerts[0]?.label || "Sous contrôle", responsable: owner || pilote,
    next_action: nextAction || "Définir la prochaine action client", due_date: nextDate || todayIso(), readOnly: level !== "danger" && nextDate && isFuture(nextDate), raw: c,
    meta: { step: c.etape, status: c.statut, budget: c.budget, lastActivity: clientLastActivity(c), relatedActions },
  };
}

export function buildBienDossier(b, actions = [], propositions = [], pilote = "") {
  const alerts = [];
  const statut = b.statut || "Statut non renseigné";
  const txt = normTxt(statut);
  const score = getBienScore(b);
  const due = firstFilled(b, ["date_relance", "date_prochaine_action", "due_date"]);
  // Repli sur qui pilote, comme pour les prospects et les clients. C'était
  // « Benjamin » en dur : un bien sans conseiller renseigné apparaissait donc
  // comme délégué à un tiers dans le tableau de bord de tout le monde — et
  // sortait de la colonne « à décider » de celui qui devait s'en occuper.
  const owner = firstFilled(b, ["conseiller_profero", "responsable", "owner", "assigned_to"]) || pilote;
  const relatedActions = safeArr(actions).filter(a => (linkedEntityType(a) === "bien" && String(linkedEntityId(a)) === String(b.id)) || String(a.bien_id || "") === String(b.id));
  if (!statut || txt.includes("non renseign")) alerts.push(makeAlert({ code: "no_status", label: "Statut bien non renseigné", level: "danger" }));
  if (due && isDueTodayOrPast(due)) alerts.push(makeAlert({ code: "late_relaunch", label: `Relance dépassée (${safeDate(due)})`, level: "danger", due_date: due }));
  if (due && isFuture(due) && isWithinNextDays(due, 7)) alerts.push(makeAlert({ code: "future_relaunch", label: `Relance sous 7 jours (${safeDate(due)})`, level: "warning", due_date: due }));
  if (!due && ["nouveau", "a trier", "à trier", "a analyser", "à analyser", "analyse", "offre", "matcher"].some(k => txt.includes(normTxt(k)))) alerts.push(makeAlert({ code: "no_due", label: "Action à prévoir sur le bien", level: "danger" }));
  if (["offre envoyee", "offre envoyée", "offre acceptee", "offre acceptée", "offre a faire", "offre à faire"].some(k => txt.includes(normTxt(k)))) alerts.push(makeAlert({ code: "offer", label: `Offre en cours : ${statut}`, level: due && isFuture(due) ? "warning" : "danger", due_date: due }));
  if (score >= 70 && !due) alerts.push(makeAlert({ code: "high_score", label: "Opportunité forte sans échéance", level: "warning" }));
  if (!b.adresse && !b.ville) alerts.push(makeAlert({ code: "incomplete", label: "Fiche bien incomplète", level: "warning" }));
  relatedActions.filter(isBlockedAction).forEach(a => alerts.push(makeAlert({ code: `blocked_${a.id}`, label: `Action bloquée : ${actionTitle(a)}`, level: "danger", due_date: a.due_date })));
  relatedActions.filter(a => isOpenAction(a) && a.due_date && isDueTodayOrPast(a.due_date)).forEach(a => alerts.push(makeAlert({ code: `late_${a.id}`, label: `Tâche en retard : ${actionTitle(a)}`, level: "danger", due_date: a.due_date })));
  const level = worstLevel(alerts);
  return {
    key: entityKey("bien", b.id), type: "bien", id: b.id, sourceTable: "invest_biens", label: getBienLabel(b), subtitle: joinNonEmpty([statut, b.ville, fmtDashboardEur(b.prix_vente)]),
    level, alerts, primaryAlert: alerts[0]?.label || "Sous contrôle", responsable: owner,
    next_action: "Prévoir l’action suivante sur le bien", due_date: due || todayIso(), readOnly: level !== "danger" && due && isFuture(due), score, raw: b,
    meta: { statut, prix: b.prix_vente, travaux: b.prix_travaux, cout: b.cout_total, rendement: b.rendement_brut, cashflow: b.cashflow_estime, score, propositions: safeArr(propositions).filter(p => String(p.bien_id || "") === String(b.id)) },
  };
}

export function buildTeamDossiers(actions = [], pilote = "") {
  return safeArr(actions).filter(a => isOpenAction(a) && !linkedEntityId(a)).map(a => {
    const due = a.due_date;
    const alerts = [];
    if (isBlockedAction(a)) alerts.push(makeAlert({ code: "blocked", label: "Action bloquée / compliquée", level: "danger", due_date: due }));
    if (due && isDueTodayOrPast(due)) alerts.push(makeAlert({ code: "late", label: `Échéance ${safeDate(due)}`, level: "danger", due_date: due }));
    if (due && isFuture(due) && isWithinNextDays(due, 7)) alerts.push(makeAlert({ code: "future", label: `À suivre sous 7 jours (${safeDate(due)})`, level: "warning", due_date: due }));
    const level = worstLevel(alerts);
    return { key: entityKey("team", a.id), type: "team", id: a.id, label: actionTitle(a), subtitle: joinNonEmpty([actionOwner(a, pilote), a.step_label, a.status || a.statut]), level, alerts, primaryAlert: alerts[0]?.label || "Action sous contrôle", responsable: actionOwner(a, pilote), next_action: actionTitle(a), due_date: due || todayIso(), readOnly: level !== "danger" && due && isFuture(due), raw: a, meta: { status: a.status || a.statut } };
  });
}

export function consolidateData({ clients = [], crmProspects = [], biens = [], propositions = [], planning = [], actions = [], profil = null, pilote = "" }) {
  const prospects = uniqueRows([...safeArr(clients).filter(isActiveProspectRecord), ...safeArr(crmProspects).filter(isActiveProspectRecord)]);
  const clientsMetier = safeArr(clients).filter(isClientRecord);
  const biensActifs = safeArr(biens).filter(isActiveBien);
  const prospectDossiers = prospects.map(c => buildProspectDossier(c, pilote));
  const clientDossiers = clientsMetier.map(c => buildClientDossier(c, actions, pilote));
  const bienDossiers = biensActifs.map(b => buildBienDossier(b, actions, propositions, pilote));
  const teamDossiers = buildTeamDossiers(actions, pilote);
  const allDossiers = [...prospectDossiers, ...clientDossiers, ...bienDossiers, ...teamDossiers];
  allDossiers.forEach(d => {
    // « délégué » = confié à quelqu'un d'autre que celui qui pilote. La
    // comparaison portait sur la chaîne « Matthieu » : dès qu'un autre compte
    // ouvrait le tableau de bord, ses propres dossiers apparaissaient comme
    // délégués — donc comme traités par un tiers.
    const confieAUnTiers = d.responsable && !estUtilisateurCourant(d.responsable, profil);
    d.category = d.level === "danger" && !d.readOnly ? "decision" : (confieAUnTiers && d.type !== "team" ? "delegated" : "watch");
    if (d.type === "team") d.category = d.level === "danger" ? "decision" : "delegated";
  });
  return {
    prospects, clientsMetier, biensActifs, prospectDossiers, clientDossiers, bienDossiers, teamDossiers, allDossiers, planning, actions, propositions,
    stats: {
      prospects: prospects.length, clients: clientsMetier.length, biens: biensActifs.length,
      decision: allDossiers.filter(d => d.category === "decision").length,
      watch: allDossiers.filter(d => d.category === "watch").length,
      delegated: allDossiers.filter(d => d.category === "delegated").length,
      blocked: allDossiers.filter(d => d.alerts.some(a => a.code.includes("blocked") || normTxt(a.label).includes("bloqu"))).length,
      relancesLate: allDossiers.filter(d => d.alerts.some(a => a.level === "danger" && normTxt(a.label).match(/relance|échéance|echeance|retard|action/))).length,
      echeances7: allDossiers.filter(d => d.alerts.some(a => a.due_date && isWithinNextDays(a.due_date, 7))).length,
    },
  };
}

export function filterDossiers(dossiers = [], filter = "all") {
  return filter === "all" ? dossiers : safeArr(dossiers).filter(d => d.type === filter || (filter === "team" && d.type === "team"));
}
export function sortDossiers(list = []) {
  return [...safeArr(list)].sort((a, b) => levelRank(a.level) - levelRank(b.level) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || String(a.label || "").localeCompare(String(b.label || ""), "fr", { sensitivity: "base" }));
}

// Les quatre colonnes de l'écran, calculées une fois pour toutes.
//
// L'interface et le mail quotidien partagent cette fonction : c'est elle qui
// garantit qu'un dossier arbitré ce matin depuis le téléphone n'est pas
// annoncé « à décider » dans le mail du lendemain.
export function repartirEnColonnes({ dossiers = [], routine = emptyRoutine(), filtre = "all" }) {
  const traites = safeArr(dossiers).filter(d => isResolvedToday(routine, d));
  const ouverts = safeArr(dossiers).filter(d => !isResolvedToday(routine, d));
  const filtres = filterDossiers(ouverts, filtre);
  return {
    decision: sortDossiers(filtres.filter(d => d.category === "decision")),
    watch: sortDossiers(filtres.filter(d => d.category === "watch")),
    delegated: sortDossiers(filtres.filter(d => d.category === "delegated")),
    done: sortDossiers(filterDossiers(traites, filtre)),
  };
}

export function planFromRoutine(routine, dossiers) {
  const lines = [];
  safeArr(routine.priorities).forEach((p, idx) => { if (priorityComplete(p)) lines.push({ responsable: p.responsable, title: `Priorité ${idx + 1} — ${p.title}`, due_date: p.due_date, comment: p.comment, source: "Priorité" }); });
  Object.entries(routine.decisions || {}).forEach(([key, d]) => {
    if (!d || !String(d.next_action || "").trim()) return;
    const item = safeArr(dossiers).find(x => decisionKey(x) === key);
    lines.push({ responsable: d.responsable || "—", title: d.next_action, due_date: d.due_date, comment: d.comment, source: item?.label || key, type: item?.type || "", decision: d.decision || "" });
  });
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce que le tableau de bord lit en base
//
// Source unique de vérité, partagée par l'interface (Dashboard.jsx) et par la
// veille du matin (api/_cron/cron-invest-tableau-bord.js). Recopier ces
// requêtes dans le cron aurait suffi — jusqu'au jour où l'une des deux copies
// change. Le précédent est documenté dans Dashboard.jsx : le chargement
// interrogeait sept tables de prospects inexistantes, et personne ne le voyait.
// ─────────────────────────────────────────────────────────────────────────────

export const REQUETES_TABLEAU_BORD = [
  { cle: "clients",       label: "clients",          requis: true,
    requete: (sb) => sb.from("invest_clients").select("*").order("created_at", { ascending: false }) },
  { cle: "biens",         label: "biens",            requis: true,
    requete: (sb) => sb.from("invest_biens").select("*").order("created_at", { ascending: false }) },
  { cle: "propositions",  label: "propositions",
    requete: (sb) => sb.from("invest_propositions").select("*").limit(500) },
  { cle: "planning",      label: "planning",
    requete: (sb) => sb.from("invest_planning").select("*").order("date_rdv", { ascending: false }).limit(500) },
  { cle: "actions",       label: "actions équipe",
    requete: (sb) => sb.from("invest_mission_actions").select("*, client:invest_clients(id,nom,prenom,statut,etape)").order("due_date", { ascending: true, nullsFirst: false }).limit(700) },
  { cle: "notifications", label: "notifications",
    requete: (sb) => sb.from("invest_action_notifications").select("*").order("created_at", { ascending: false }).limit(100) },
  { cle: "finance",       label: "finance",
    requete: (sb) => sb.from("invest_suivi_financier").select("*").limit(800) },
  // Une seule table de prospects, et c'est la bonne (relevé fait par
  // scripts/introspect-invest.mjs). Le marquage `_source_table` sert à
  // dédoublonner un prospect présent aussi dans invest_clients.
  { cle: "crmProspects",  label: "prospection",
    requete: (sb) => sb.from("invest_prospects").select("*").order("created_at", { ascending: false }).limit(1000),
    apres: (rows) => withSourceTable(rows, "invest_prospects") },
  { cle: "routineRows",   label: "routine du jour",
    requete: (sb, { jour }) => sb.from("invest_morning_routine_items").select("*").eq("routine_date", jour) },
];

// Exécute les requêtes ci-dessus et renvoie un objet prêt pour consolidateData.
//
// `onErreur` reçoit (label, erreur, requis) : l'interface y affiche un bandeau,
// le cron y écrit un avertissement dans son résumé. Une requête en échec rend
// un tableau vide plutôt que de faire tomber tout le chargement — mais elle
// n'est jamais silencieuse.
export async function chargerTableauBord(sb, { jour = todayIso(), onErreur = null } = {}) {
  const resultats = await Promise.all(REQUETES_TABLEAU_BORD.map(async (r) => {
    try {
      const { data, error } = await r.requete(sb, { jour });
      if (error) { onErreur?.(r.label, error, Boolean(r.requis)); return [r.cle, []]; }
      return [r.cle, r.apres ? r.apres(data || []) : (data || [])];
    } catch (e) {
      onErreur?.(r.label, e, Boolean(r.requis));
      return [r.cle, []];
    }
  }));
  return Object.fromEntries(resultats);
}
