// ─── OUTILS PARTAGÉS DES TÂCHES TO-DO (bloc_todos) ───────────────────────────
// Source unique des règles des tâches partagées entre la page Notes & To-do,
// la bulle « Mes tâches » (BulleTodo) et le Tableau de bord :
//   - multi-assignés : `assignes` = [{ email, nom }] ; les anciens champs
//     `assigne_email` / `assigne_nom` restent lus (tâches créées avant) et
//     réécrits (1er assigné) pour les clients PWA pas encore rechargés ;
//   - échéances rapides (aujourd'hui / fin de semaine / …) : on stocke toujours
//     la date calculée dans `date_limite` (le cron de relance et les filtres
//     « en retard » existants continuent de marcher tels quels) + le type dans
//     `echeance_type` pour l'affichage ;
//   - emails : assignation et clôture (une tâche cochée par un assigné est
//     terminée pour tous → on prévient les autres).

import { supabase } from "./supabase";
import { getISOWeek, mondayOfWeek, profilSemaine, semainesDansAnnee } from "./rythmeSemaine";

// ─── MULTI-ASSIGNÉS ──────────────────────────────────────────────────────────
export function getAssignes(todo) {
  if (Array.isArray(todo?.assignes) && todo.assignes.length > 0) {
    return todo.assignes.filter(a => a && a.email);
  }
  if (todo?.assigne_email) {
    return [{ email: todo.assigne_email, nom: todo.assigne_nom || todo.assigne_email }];
  }
  return [];
}

export function estAssigne(todo, email) {
  if (!email) return false;
  const cible = String(email).toLowerCase();
  return getAssignes(todo).some(a => String(a.email).toLowerCase() === cible);
}

// ─── ÉCHÉANCES RAPIDES ───────────────────────────────────────────────────────
export const ECHEANCE_TYPES = [
  { id: "aujourdhui",        label: "Aujourd'hui" },
  { id: "demain",            label: "Demain" },
  { id: "fin_semaine",       label: "Fin de semaine" },
  { id: "semaine_prochaine", label: "Fin de semaine prochaine" },
  { id: "fin_mois",          label: "Fin du mois" },
  { id: "date",              label: "Date précise…" },
];

export function echeanceLabel(typeId) {
  return ECHEANCE_TYPES.find(e => e.id === typeId)?.label || "";
}

const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Dernier jour TRAVAILLÉ de la semaine ISO demandée (jeudi en semaine de
// 4 jours, vendredi sinon) — s'appuie sur le rythme 4j/5j.
function dernierJourTravaille(year, week) {
  const profil = profilSemaine(year, week);
  const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
  let idx = 4;
  for (let i = 4; i >= 0; i--) {
    if ((profil[jours[i]] ?? 0) > 0) { idx = i; break; }
  }
  const d = mondayOfWeek(year, week);
  d.setDate(d.getDate() + idx);
  return d;
}

// Calcule la date_limite (ISO) d'une échéance rapide. Pour "date", la date
// est saisie à la main ; pour "", pas d'échéance → null dans les deux cas.
export function computeEcheanceDate(typeId, aujourdhuiDate = new Date()) {
  const now = new Date(aujourdhuiDate.getFullYear(), aujourdhuiDate.getMonth(), aujourdhuiDate.getDate());
  const todayIso = toISO(now);
  switch (typeId) {
    case "aujourdhui":
      return todayIso;
    case "demain": {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      return toISO(d);
    }
    case "fin_semaine": {
      const { year, week } = getISOWeek(now);
      const d = dernierJourTravaille(year, week);
      // Vendredi non travaillé d'une semaine de 4 jours : le dernier jour
      // travaillé est déjà passé → on retient aujourd'hui plutôt qu'une
      // tâche née en retard.
      const iso = toISO(d);
      return iso < todayIso ? todayIso : iso;
    }
    case "semaine_prochaine": {
      let { year, week } = getISOWeek(now);
      week += 1;
      if (week > semainesDansAnnee(year)) { year += 1; week = 1; }
      return toISO(dernierJourTravaille(year, week));
    }
    case "fin_mois":
      return toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    default:
      return null;
  }
}

// ─── EMAILS ──────────────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = {
  todo_assign: {
    subject: "Nouvelle tâche : {texte}",
    body: "Bonjour {prenom},\n\n{assigneur} vous a assigné cette tâche :\n{texte}\n{note}\nPriorité : {priorite}\n\nConnectez-vous à Profero Planning, onglet Notes & To-do, pour cocher la tâche une fois terminée.",
  },
  todo_done: {
    subject: "Tâche terminée : {texte}",
    body: "Bonjour {prenom},\n\n{acteur} a marqué comme terminée la tâche qui vous était aussi assignée :\n{texte}\n\nElle est close pour tous les assignés — plus rien à faire de votre côté.",
  },
};

const interpolate = (str, vars) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v ?? ""), str || "");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function chargerTemplate(cle) {
  let tpl = DEFAULT_TEMPLATES[cle];
  try {
    const { data } = await supabase.from("planning_config").select("value").eq("key", "email_templates").maybeSingle();
    if (data?.value?.[cle]) tpl = { ...tpl, ...data.value[cle] };
  } catch (e) { /* fallback déjà en place */ }
  return tpl;
}

function wrapHtml({ badge, titre, bodyHtml, accent = "#FFC200" }) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid ${accent}">
      <div style="color:${accent};font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">${badge}</div>
      <div style="color:#fff;font-size:20px;font-weight:800">${titre}</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <div style="font-size:14px;color:#1a1f2e;line-height:1.7">${bodyHtml}</div>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;
}

async function envoyer(to, subject, html) {
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch (e) {
    console.error("Email todo:", e);
    return { ok: false, reason: e.message };
  }
}

export async function envoyerEmailAssignation({ to, nom, texte, priorite, assigneur, note }) {
  if (!to) return { ok: false, reason: "no_email" };
  const prioLabel = priorite === "haute" ? "🔴 Haute" : priorite === "basse" ? "🟢 Basse" : "🟡 Normale";
  const tpl = await chargerTemplate("todo_assign");
  const vars = {
    prenom: nom || "", texte: texte || "", priorite: prioLabel, assigneur: assigneur || "Quelqu'un",
    // {note} = bloc complet (titre + contenu) pour que le template reste
    // propre quand la tâche n'a pas de note.
    note: note?.trim() ? `\nNote / détails :\n${note.trim()}\n` : "",
  };
  // Template personnalisé enregistré avant l'ajout de {note} : on insère la
  // note après {texte} pour que le mail reste complet.
  let body = tpl.body || "";
  if (!body.includes("{note}")) {
    body = body.includes("{texte}") ? body.replace("{texte}", "{texte}\n{note}") : body + "\n{note}";
  }
  const html = wrapHtml({
    badge: "Profero Planning · Nouvelle tâche",
    titre: "📋 Une tâche vous a été assignée",
    bodyHtml: escapeHtml(interpolate(body, vars)).replace(/\n/g, "<br/>"),
  });
  return envoyer(to, interpolate(tpl.subject, vars), html);
}

// Prévient les AUTRES assignés (pas celui qui vient de cocher) qu'une tâche
// partagée est close. Un mail par destinataire pour personnaliser {prenom}.
export async function envoyerEmailsTerminee({ todo, acteurEmail, acteurNom }) {
  const autres = getAssignes(todo).filter(
    a => a.email && String(a.email).toLowerCase() !== String(acteurEmail || "").toLowerCase()
  );
  if (autres.length === 0) return { ok: true, envoyes: 0 };
  const tpl = await chargerTemplate("todo_done");
  let envoyes = 0, echecs = 0;
  for (const a of autres) {
    const vars = { prenom: a.nom || "", texte: todo.texte || "", acteur: acteurNom || "Quelqu'un" };
    const html = wrapHtml({
      badge: "Profero Planning · Tâche terminée",
      titre: "✅ Une tâche partagée a été terminée",
      bodyHtml: escapeHtml(interpolate(tpl.body, vars)).replace(/\n/g, "<br/>"),
      accent: "#22c55e",
    });
    const r = await envoyer(a.email, interpolate(tpl.subject, vars), html);
    if (r.ok) envoyes += 1; else echecs += 1;
  }
  return { ok: echecs === 0, envoyes, echecs };
}
