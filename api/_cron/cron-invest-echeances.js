// api/_cron/cron-invest-echeances.js — Veille quotidienne Profero Invest.
//
// Pourquoi ce fichier existe
// ──────────────────────────
// Invest n'avait AUCUNE automatisation côté serveur. Les quatre tâches
// planifiées du projet concernaient toutes Profero Rénovation ; une recherche
// du mot « invest » dans api/ ne renvoyait rien. Conséquence : tout ce que
// l'application « notifiait » partait d'un clic humain. Si personne n'ouvrait
// l'onglet, personne n'était prévenu — y compris pour un dépôt d'urbanisme
// hors délai, qui est une échéance opposable.
//
// Contrainte de déploiement respectée
// ───────────────────────────────────
// Le plan Vercel Hobby plafonne à 12 fonctions serverless. Ce dossier
// (api/_cron/) n'est PAS déployé en fonctions : il n'est joignable qu'à
// travers api/cron-dispatcher.js. Ce fichier n'ajoute donc AUCUNE fonction —
// seulement une branche dans le dispatcher et un créneau GitHub Actions.
//
// Ce que le cron regarde chaque matin
// ───────────────────────────────────
//   urbanisme   date_max_depot dans moins de 15 jours, dossier pas encore déposé
//   urbanisme   instruction terminée sans décision saisie
//   actions     échéance dépassée, action non terminée
//   biens       date_relance échue
//   edl         brouillon laissé plus de 7 jours sans archivage
//   notifs      notifications en échec d'envoi   → à l'administrateur
//
// Un e-mail par destinataire, toutes ses lignes regroupées. Pas un e-mail par
// ligne : le but est qu'il soit lu, pas qu'il soit ignoré.
//
// Idempotence
// ───────────
// Un destinataire ne reçoit qu'un envoi par jour, mémorisé dans
// planning_config.invest_echeances_state. Le dispatcher tolère ±1 h de dérive
// (heure d'été), donc un double déclenchement est possible : sans cette garde
// la même personne recevrait deux fois le même récapitulatif.
//
// RLS
// ───
// Les tables Invest sont protégées par une policy « bureau uniquement ». Avec
// la clé anonyme, les SELECT renverraient zéro ligne — donc zéro alerte, en
// silence, ce qui est le pire résultat possible pour une veille d'échéances.
// Le dispatcher passe SUPABASE_SERVICE_ROLE_KEY en priorité ; on vérifie ici
// que c'est bien le cas et on le signale sinon.

const SEUIL_DEPOT_JOURS   = 15;  // fenêtre d'alerte avant la date maximum de dépôt
const SEUIL_EDL_JOURS     = 7;   // au-delà, un brouillon d'état des lieux dort
const ETAT_CONFIG_KEY     = "invest_echeances_state";
const APP_URL             = "https://planning-chantiers.vercel.app";

// Statuts d'un dossier d'urbanisme qui n'est pas encore parti en mairie.
// Doit rester aligné sur URBA_STATUTS_AVANT_DEPOT (src/Invest/urbanismeStore.js).
const URBA_AVANT_DEPOT = ["brouillon", "transmis", "attente_pieces", "complet"];

// Statuts d'une action de mission considérée close.
// Aligné sur missionActionDone (src/Invest/CRM.jsx).
const ACTION_TERMINEE = ["fait", "non_concerne"];

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDateFr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("fr-FR");
}

// Nombre de jours entiers entre deux dates ISO (positif si `b` est après `a`).
function joursEntre(aIso, bIso) {
  const ms = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((ms(bIso) - ms(aIso)) / 86400000);
}

function ajouterJours(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Annuaire
//
// La règle d'appariement vit dans src/Invest/annuaire.mjs — le MÊME module que
// l'interface. Elle décide qui reçoit un e-mail ici et qui apparaît dans les
// sélecteurs de responsable là-bas : deux copies auraient divergé.
//
// Import dynamique parce que ce fichier est en CommonJS et le module en ESM.
// Même schéma que chantierFinance.mjs côté Rénovation.
// ─────────────────────────────────────────────────────────────────────────────

let _annuaireMod = null;
async function moduleAnnuaire() {
  if (!_annuaireMod) _annuaireMod = await import("../../src/Invest/annuaire.mjs");
  return _annuaireMod;
}

// Moteur de relance, partagé avec l'interface (qui l'utilise pour AFFICHER ce
// qu'une règle déclenchera réellement). Même raison qu'annuaire.mjs : deux
// copies de la règle divergeraient.
let _relancesMod = null;
async function moduleRelances() {
  if (!_relancesMod) _relancesMod = await import("../../src/Invest/relances.mjs");
  return _relancesMod;
}

async function chargerAnnuaire(supabase) {
  const { indexerAnnuaire, ANNUAIRE_VIDE } = await moduleAnnuaire();
  const { data, error } = await supabase
    .from("utilisateurs")
    .select("nom,email,role,actif")
    .eq("actif", true);

  if (error) {
    console.warn("[invest-echeances] annuaire indisponible:", error.message);
    return ANNUAIRE_VIDE;
  }
  return indexerAnnuaire(data || []);
}

// Version synchrone, utilisable dans les boucles de collecte : le module est
// déjà chargé à ce stade (chargerAnnuaire a été appelé avant).
function emailDe(annuaire, nomOuPrenom) {
  if (!_annuaireMod) return null;
  return _annuaireMod.emailPourResponsable(annuaire, nomOuPrenom) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collecte des échéances
//
// Chaque collecteur renvoie des lignes { destinataire, gravite, titre, detail,
// echeance, lien }. `destinataire` est un e-mail, ou null quand personne n'est
// désigné — ces lignes-là partent aux administrateurs, sinon elles se
// perdraient exactement comme avant.
// ─────────────────────────────────────────────────────────────────────────────

async function collecteUrbanisme(supabase, annuaire, todayIso) {
  const lignes = [];
  const limite = ajouterJours(todayIso, SEUIL_DEPOT_JOURS);

  const { data, error } = await supabase
    .from("invest_urbanisme_dossiers")
    .select("id,reference,commune,adresse,statut,date_max_depot,date_fin_instruction,commercial,auteur");

  if (error) {
    // 42P01 = table absente : le module n'est pas déployé sur cet environnement.
    if (error.code !== "42P01") console.warn("[invest-echeances] urbanisme:", error.message);
    return lignes;
  }

  for (const d of data || []) {
    const lieu = [d.commune, d.adresse].filter(Boolean).join(" · ");
    const dest = emailDe(annuaire, d.commercial) || emailDe(annuaire, d.auteur);
    const lien = `${APP_URL}/?invest_urbanisme=${d.id}`;

    // 1. Dépôt à faire, et l'échéance approche ou est dépassée.
    if (d.date_max_depot && URBA_AVANT_DEPOT.includes(d.statut) && d.date_max_depot <= limite) {
      const reste = joursEntre(todayIso, d.date_max_depot);
      lignes.push({
        destinataire: dest,
        gravite: reste < 0 ? "critique" : reste <= 5 ? "urgent" : "a_venir",
        titre: `Urbanisme — ${d.reference || "dossier sans référence"}`,
        detail: reste < 0
          ? `Date maximum de dépôt dépassée de ${Math.abs(reste)} jour(s). ${lieu}`
          : `Dépôt à faire sous ${reste} jour(s). ${lieu}`,
        echeance: d.date_max_depot,
        lien,
      });
    }

    // 2. Instruction terminée sans décision saisie : le délai de recours court
    //    peut-être déjà, et personne ne le sait.
    if (d.date_fin_instruction && d.statut === "depose" && d.date_fin_instruction < todayIso) {
      lignes.push({
        destinataire: dest,
        gravite: "urgent",
        titre: `Urbanisme — ${d.reference || "dossier sans référence"}`,
        detail: `Fin d'instruction le ${fmtDateFr(d.date_fin_instruction)}, aucune décision enregistrée. ${lieu}`,
        echeance: d.date_fin_instruction,
        lien,
      });
    }
  }
  return lignes;
}

async function collecteActions(supabase, annuaire, todayIso) {
  const lignes = [];
  const { data, error } = await supabase
    .from("invest_mission_actions")
    .select("id,action_title,due_date,status,responsable,responsable_email,client_id,step_label")
    .lt("due_date", todayIso);

  if (error) {
    if (error.code !== "42P01") console.warn("[invest-echeances] actions:", error.message);
    return lignes;
  }

  for (const a of data || []) {
    if (ACTION_TERMINEE.includes(a.status)) continue;
    const retard = joursEntre(a.due_date, todayIso);
    lignes.push({
      destinataire: a.responsable_email || emailDe(annuaire, a.responsable),
      gravite: retard > 7 ? "critique" : "urgent",
      titre: a.action_title || "Action sans intitulé",
      detail: `En retard de ${retard} jour(s)${a.step_label ? ` · ${a.step_label}` : ""}`,
      echeance: a.due_date,
      lien: a.client_id ? `${APP_URL}/?crm_client=${a.client_id}&mission_action=${a.id}` : APP_URL,
    });
  }
  return lignes;
}

// Relances dues, d'après les règles écrites dans les modèles de mission.
//
// Soixante-six règles étaient stockées en texte libre (« J+2 puis J+5 si non
// reçue », « Hebdomadaire »), affichées avec une cloche, recopiées dans les
// e-mails — et lues par aucun moteur. Une intention documentée, pas un
// mécanisme. src/Invest/relances.mjs les traduit ; ce collecteur les exécute.
//
// Distinct de collecteActions : celui-là signale une échéance dépassée UNE
// fois, celui-ci applique la cadence prévue par la règle. Une même action peut
// donc apparaître dans les deux — c'est voulu, ce sont deux informations
// différentes (« c'est en retard » et « voici la Nᵉ relance prévue »).
async function collecteRelances(supabase, annuaire, todayIso) {
  const lignes = [];
  const { relanceDue } = await moduleRelances();

  const { data, error } = await supabase
    .from("invest_mission_actions")
    .select("id,action_title,due_date,status,responsable,responsable_email,client_id,step_label," +
            "relance_rule,due_reminder_enabled,last_reminder_sent_at,reminder_count," +
            "document_drive_attendu,justificatif_drive_url")
    .not("relance_rule", "is", null);

  if (error) {
    if (error.code !== "42P01") console.warn("[invest-echeances] relances:", error.message);
    return lignes;
  }

  for (const a of data || []) {
    const due = relanceDue(a, todayIso);
    if (!due) continue;
    lignes.push({
      destinataire: a.responsable_email || emailDe(annuaire, a.responsable),
      gravite: due.rang >= 2 ? "critique" : "urgent",
      titre: `Relance — ${a.action_title || "action sans intitulé"}`,
      detail: `${due.motif}${a.step_label ? ` · ${a.step_label}` : ""}${a.relance_rule ? ` · règle : ${a.relance_rule}` : ""}`,
      echeance: due.echeance,
      lien: a.client_id ? `${APP_URL}/?crm_client=${a.client_id}&mission_action=${a.id}` : APP_URL,
      // Consigné après envoi réussi seulement, pour que la même relance ne
      // reparte pas demain — et qu'un échec la fasse repartir.
      _relance: { actionId: a.id, compteur: Number(a.reminder_count || 0) + 1 },
    });
  }
  return lignes;
}

async function collecteBiens(supabase, annuaire, todayIso) {
  const lignes = [];
  const { data, error } = await supabase
    .from("invest_biens")
    .select("id,reference_interne,adresse,ville,statut,date_relance,conseiller_profero")
    .lte("date_relance", todayIso);

  if (error) {
    if (error.code !== "42P01") console.warn("[invest-echeances] biens:", error.message);
    return lignes;
  }

  for (const b of data || []) {
    if (/aband|archiv|perdu|refus/i.test(String(b.statut || ""))) continue;
    lignes.push({
      destinataire: emailDe(annuaire, b.conseiller_profero),
      gravite: joursEntre(b.date_relance, todayIso) > 7 ? "urgent" : "a_venir",
      titre: `Bien à relancer — ${b.reference_interne || b.adresse || "sans référence"}`,
      detail: [b.ville, b.statut].filter(Boolean).join(" · "),
      echeance: b.date_relance,
      lien: `${APP_URL}/?invest_bien=${b.id}`,
    });
  }
  return lignes;
}

async function collecteEDL(supabase, annuaire, todayIso) {
  const lignes = [];
  const seuil = ajouterJours(todayIso, -SEUIL_EDL_JOURS);

  const { data, error } = await supabase
    .from("invest_etats_des_lieux")
    .select("id,titre,adresse,type,statut,auteur,updated_at")
    .eq("statut", "brouillon")
    .lt("updated_at", `${seuil}T23:59:59Z`);

  if (error) {
    if (error.code !== "42P01") console.warn("[invest-echeances] edl:", error.message);
    return lignes;
  }

  for (const e of data || []) {
    const dormance = joursEntre(String(e.updated_at).slice(0, 10), todayIso);
    lignes.push({
      destinataire: emailDe(annuaire, e.auteur),
      gravite: "a_venir",
      titre: `État des lieux non archivé — ${e.titre || "sans titre"}`,
      // Les photos d'un brouillon restent sur l'appareil qui les a prises :
      // tant qu'il n'est pas archivé, elles ne sont nulle part ailleurs.
      detail: `${e.type || "EDL"} en brouillon depuis ${dormance} jours. Les photos sont encore locales à l'appareil de saisie. ${e.adresse || ""}`.trim(),
      echeance: String(e.updated_at).slice(0, 10),
      lien: `${APP_URL}/?invest_edl=${e.id}`,
    });
  }
  return lignes;
}

async function collecteNotificationsEnEchec(supabase, todayIso) {
  const lignes = [];
  const { data, error } = await supabase
    .from("invest_mission_actions")
    .select("id,action_title,responsable,notification_status,notification_error,client_id")
    .in("notification_status", ["erreur_envoi", "bloque_sans_email"]);

  if (error) {
    if (error.code !== "42P01") console.warn("[invest-echeances] notifs:", error.message);
    return lignes;
  }

  for (const a of data || []) {
    lignes.push({
      destinataire: null,   // → administrateurs
      gravite: "urgent",
      titre: `Notification jamais partie — ${a.action_title || "action"}`,
      detail: a.notification_status === "bloque_sans_email"
        ? `Aucune adresse pour ${a.responsable || "le responsable"} : l'action est assignée mais personne n'a été prévenu.`
        : `Échec d'envoi vers ${a.responsable || "le responsable"} : ${a.notification_error || "cause inconnue"}`,
      echeance: todayIso,
      lien: a.client_id ? `${APP_URL}/?crm_client=${a.client_id}&mission_action=${a.id}` : APP_URL,
    });
  }
  return lignes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mise en forme
// ─────────────────────────────────────────────────────────────────────────────

const COULEUR_GRAVITE = {
  critique: { bg: "#fee2e2", bord: "#dc2626", texte: "#991b1b", label: "En retard" },
  urgent:   { bg: "#fef3c7", bord: "#d97706", texte: "#92400e", label: "À traiter" },
  a_venir:  { bg: "#e0f2fe", bord: "#0284c7", texte: "#075985", label: "À venir" },
};

const ORDRE_GRAVITE = { critique: 0, urgent: 1, a_venir: 2 };

function buildEmailHtml(lignes, dateFr) {
  const triees = [...lignes].sort((a, b) =>
    (ORDRE_GRAVITE[a.gravite] ?? 9) - (ORDRE_GRAVITE[b.gravite] ?? 9) ||
    String(a.echeance).localeCompare(String(b.echeance)));

  const critiques = triees.filter(l => l.gravite === "critique").length;

  const items = triees.map(l => {
    const c = COULEUR_GRAVITE[l.gravite] || COULEUR_GRAVITE.a_venir;
    return `
    <tr><td style="padding:0 0 10px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg};border-left:3px solid ${c.bord};border-radius:0 6px 6px 0">
        <tr><td style="padding:12px 14px">
          <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:${c.texte};margin-bottom:5px">
            ${c.label} · ${escapeHtml(fmtDateFr(l.echeance))}
          </div>
          <div style="font-size:14.5px;font-weight:700;color:#1a1f2e;margin-bottom:3px">${escapeHtml(l.titre)}</div>
          <div style="font-size:13px;color:#475569;line-height:1.45">${escapeHtml(l.detail)}</div>
          <div style="margin-top:8px"><a href="${escapeHtml(l.lien)}" style="font-size:12.5px;color:#2f5fd0;font-weight:700;text-decoration:none">Ouvrir le dossier →</a></div>
        </td></tr>
      </table>
    </td></tr>`;
  }).join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1a1f2e">
    <div style="background:#12151b;padding:22px 24px;border-radius:10px 10px 0 0;border-bottom:3px solid #4070e8">
      <div style="color:#7ba4f7;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Invest · Veille quotidienne</div>
      <div style="color:#fff;font-size:19px;font-weight:800">${triees.length} point${triees.length > 1 ? "s" : ""} à traiter</div>
      <div style="color:#94a3b8;font-size:13px;margin-top:4px">${escapeHtml(dateFr)}${critiques ? ` · ${critiques} en retard` : ""}</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:20px 22px">
      <table width="100%" cellpadding="0" cellspacing="0">${items}</table>
      <p style="margin:18px 0 0;font-size:11.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:14px">
        Envoi automatique une fois par jour. Une ligne disparaît d'elle-même dès que l'échéance est traitée dans l'application.
      </p>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envoi
//
// Deux canaux coexistent dans ce projet, et ils ne sont pas interchangeables :
//
//   • Edge Function Supabase `send-mission-email` (Gmail, depuis
//     og@groupe-profero.com) — le bouton « Mail » du CRM. Elle EXIGE un
//     `actionId` : c'est une notification attachée à une action de mission
//     précise, qu'elle relit en base. Vérifié par diag-mail-invest.mjs, qui
//     répond « actionId manquant ».
//
//   • /api/send-email (Resend) — tous les crons du projet : récap commandes,
//     rappel rapport, encours fournisseurs. C'est le canal des envois
//     périodiques, qui ne se rattachent à aucune ligne métier.
//
// La veille appartient à la seconde famille : ses lignes viennent de cinq
// tables différentes et aucune n'est une action de mission. Elle passe donc
// par /api/send-email, comme les autres crons.
//
// Historique de cette décision, pour ne pas la refaire : j'ai d'abord cru que
// Resend était un verrou à configurer (faux — il fonctionne, testé), puis
// basculé sur l'Edge Function par souci de cohérence avec Invest (faux aussi —
// elle exige un actionId que la veille n'a pas). Le canal correct est celui de
// la famille d'usage, pas celui du module.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée, appelé par le dispatcher
// ─────────────────────────────────────────────────────────────────────────────

// `envoyerMail` reste injectable pour les tests ; en production la veille
// utilise l'Edge Function d'Invest.
async function runInvestEcheances(req, supabase, t, envoyerMail) {
  const expedier = envoyerMail;
  const todayIso = t.dateIso;
  const resume = {
    lignes: 0, destinataires: 0, envoyes: [], echecs: [],
    deja_envoye: [], sans_destinataire: 0,
  };

  // Sans clé de service, les policies « bureau uniquement » renvoient zéro
  // ligne : le cron conclurait à tort qu'il n'y a rien à signaler.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    resume.avertissement =
      "SUPABASE_SERVICE_ROLE_KEY absente : les tables Invest sont sous RLS, " +
      "la veille risque de ne rien voir.";
  }

  const annuaire = await chargerAnnuaire(supabase);

  const paquets = await Promise.all([
    collecteUrbanisme(supabase, annuaire, todayIso),
    collecteActions(supabase, annuaire, todayIso),
    collecteBiens(supabase, annuaire, todayIso),
    collecteRelances(supabase, annuaire, todayIso),
    collecteEDL(supabase, annuaire, todayIso),
    collecteNotificationsEnEchec(supabase, todayIso),
  ]);
  const lignes = paquets.flat();
  resume.lignes = lignes.length;
  if (!lignes.length) return resume;

  // Regroupement par destinataire. Une ligne sans responsable identifié part
  // aux administrateurs : c'est précisément le cas qui se perdait avant.
  const parDestinataire = {};
  for (const l of lignes) {
    const cibles = l.destinataire ? [l.destinataire] : annuaire.admins;
    if (!cibles.length) { resume.sans_destinataire++; continue; }
    for (const email of cibles) (parDestinataire[email] ||= []).push(l);
  }
  resume.destinataires = Object.keys(parDestinataire).length;

  // Idempotence : même forme que le rappel rapport ({ date, emails }).
  const { data: etatRow } = await supabase.from("planning_config")
    .select("value").eq("key", ETAT_CONFIG_KEY).maybeSingle();
  const etat = etatRow?.value || {};
  const dejaTraites = new Set(etat.date === todayIso ? (etat.emails || []) : []);

  const envoyesCeJour = new Set(dejaTraites);
  for (const [email, sesLignes] of Object.entries(parDestinataire)) {
    if (dejaTraites.has(email)) { resume.deja_envoye.push(email); continue; }

    const critiques = sesLignes.filter(l => l.gravite === "critique").length;
    const sujet = critiques
      ? `[Profero Invest] ${critiques} échéance(s) dépassée(s) — ${sesLignes.length} point(s) à traiter`
      : `[Profero Invest] ${sesLignes.length} point(s) à traiter aujourd'hui`;

    try {
      const r = await expedier(req, email, sujet, buildEmailHtml(sesLignes, t.dateFr));
      if (r.ok) {
        resume.envoyes.push({ to: email, lignes: sesLignes.length });
        envoyesCeJour.add(email);
        // Consignation des relances SORTIES, et d'elles seules.
        //
        // C'est ce qui empêche la même relance de repartir demain : relanceDue
        // compare le palier franchi à last_reminder_sent_at. Marquer avant
        // l'envoi ferait taire à jamais une relance jamais partie ; ne pas
        // marquer du tout la ferait partir chaque jour.
        for (const l of sesLignes) {
          if (!l._relance) continue;
          const { error } = await supabase.from("invest_mission_actions").update({
            last_reminder_sent_at: new Date().toISOString(),
            reminder_count: l._relance.compteur,
            reminder_error: null,
          }).eq("id", l._relance.actionId);
          if (error) {
            // Non consignée : elle repartira demain. Un doublon vaut mieux
            // qu'une relance perdue, mais il faut le savoir.
            console.warn("[invest-echeances] relance non consignée:", error.message);
            (resume.relances_non_consignees ||= []).push(l._relance.actionId);
          } else {
            resume.relances_envoyees = (resume.relances_envoyees || 0) + 1;
          }
        }
      } else {
        resume.echecs.push({ to: email, status: r.status, data: r.data });
      }
    } catch (e) {
      resume.echecs.push({ to: email, error: e.message });
    }
  }

  // On ne mémorise que les envois réussis : un échec doit pouvoir repartir au
  // déclenchement suivant plutôt que d'être considéré comme traité.
  if (resume.envoyes.length) {
    await supabase.from("planning_config").upsert(
      { key: ETAT_CONFIG_KEY, value: { date: todayIso, emails: Array.from(envoyesCeJour) } },
      { onConflict: "key" }
    );
  }

  return resume;
}

module.exports = { runInvestEcheances };
// Exportés pour être testables isolément, sans base ni réseau.
module.exports.chargerAnnuaire = chargerAnnuaire;
module.exports.emailDe = emailDe;
module.exports.joursEntre = joursEntre;
module.exports.ajouterJours = ajouterJours;
module.exports.buildEmailHtml = buildEmailHtml;
