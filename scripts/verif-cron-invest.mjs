// scripts/verif-cron-invest.mjs — Vérification de la veille d'échéances Invest
//
// Exerce api/_cron/cron-invest-echeances.js de bout en bout contre un FAUX
// client Supabase et un FAUX envoyeur de mail. Aucune base, aucun réseau,
// aucun mail réellement expédié.
//
// Pourquoi ce script : le cron est le seul morceau de la remise à niveau qu'on
// ne peut pas vérifier en cliquant dans l'application. Il tourne à 4h du matin,
// sans témoin. Un bug d'appariement d'annuaire ou de fenêtre de dates se
// traduirait par « aucun mail » — c'est-à-dire exactement ce qu'on observait
// avant, donc indétectable.
//
// Usage :  node scripts/verif-cron-invest.mjs
//
// Aucune dépendance.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runInvestEcheances, normaliserCle, emailDe, joursEntre, ajouterJours } =
  require("../api/_cron/cron-invest-echeances.js");

// ── Petit harnais d'assertions ──────────────────────────────────────────────
let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(titre) { console.log(`\n${titre}\n${"─".repeat(titre.length)}`); }

// ── Faux client Supabase ────────────────────────────────────────────────────
//
// Reproduit la surface réellement utilisée par le cron : .from().select()
// avec .eq / .lt / .lte / .in enchaînables, et .maybeSingle() / await.
// Le filtrage est appliqué pour de bon : un test qui ne filtrerait pas
// laisserait passer une erreur de fenêtre de dates.
function fauxSupabase(tables, journal = {}) {
  const filtrer = (rows, filtres) => rows.filter(r => filtres.every(f => {
    const v = r[f.col];
    if (f.op === "eq")  return v === f.val;
    if (f.op === "lt")  return v != null && String(v) <  String(f.val);
    if (f.op === "lte") return v != null && String(v) <= String(f.val);
    if (f.op === "in")  return f.val.includes(v);
    return true;
  }));

  return {
    from(table) {
      const filtres = [];
      const rows = tables[table];
      const builder = {
        select() { return builder; },
        eq(col, val)  { filtres.push({ col, val, op: "eq" });  return builder; },
        lt(col, val)  { filtres.push({ col, val, op: "lt" });  return builder; },
        lte(col, val) { filtres.push({ col, val, op: "lte" }); return builder; },
        in(col, val)  { filtres.push({ col, val, op: "in" });  return builder; },
        maybeSingle() {
          if (rows === undefined) return Promise.resolve({ data: null, error: { code: "42P01", message: "table absente" } });
          return Promise.resolve({ data: filtrer(rows, filtres)[0] || null, error: null });
        },
        upsert(valeur) { (journal.upserts ||= []).push({ table, valeur }); return Promise.resolve({ error: null }); },
        then(resolve, reject) {
          if (rows === undefined) return Promise.resolve({ data: null, error: { code: "42P01", message: "table absente" } }).then(resolve, reject);
          return Promise.resolve({ data: filtrer(rows, filtres), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

// ── Faux envoyeur ───────────────────────────────────────────────────────────
function fauxMailer(boite, { echouePour = [] } = {}) {
  return async (_req, to, subject, html) => {
    if (echouePour.includes(to)) return { ok: false, status: 422, data: { message: "domaine non vérifié" } };
    boite.push({ to, subject, html });
    return { ok: true, status: 200, data: { id: "fake" } };
  };
}

const AUJOURDHUI = "2026-08-20";
const t = { dateIso: AUJOURDHUI, dateFr: "20/08/2026", weekday: "Jeudi", hour: 4 };

const UTILISATEURS = [
  { nom: "Matthieu Fumoleau", email: "matthieu.fumoleau@groupe-profero.com", role: "admin",      actif: true },
  { nom: "Camille Landais",   email: "camille.landais@groupe-profero.com",   role: "commercial", actif: true },
  { nom: "Tom Fourmond",      email: "tom.fourmond@groupe-profero.com",      role: "conseiller", actif: true },
  { nom: "Ancien Parti",      email: "ancien@groupe-profero.com",            role: "commercial", actif: false },
];

// ════════════════════════════════════════════════════════════════════════════
section("1. Fonctions pures");

verifie("normaliserCle retire les accents et la casse",
  normaliserCle("FRANÇOIS Huet") === "francois huet");
verifie("joursEntre compte à l'endroit", joursEntre(AUJOURDHUI, "2026-08-30") === 10);
verifie("joursEntre compte à l'envers",  joursEntre("2026-08-30", AUJOURDHUI) === -10);
verifie("ajouterJours franchit le mois", ajouterJours(AUJOURDHUI, 15) === "2026-09-04");
verifie("ajouterJours recule",           ajouterJours("2026-08-01", -7) === "2026-07-25");

const annuaireTest = {
  parCle: { "camille landais": "camille.landais@x.fr", camille: "camille.landais@x.fr" },
  admins: [],
};
verifie("emailDe apparie sur le prénom seul",
  emailDe(annuaireTest, "Camille") === "camille.landais@x.fr");
verifie("emailDe apparie sur le nom complet",
  emailDe(annuaireTest, "Camille Landais") === "camille.landais@x.fr");
verifie("emailDe renvoie null sur un inconnu",
  emailDe(annuaireTest, "Personne") === null);

// ════════════════════════════════════════════════════════════════════════════
section("2. Fenêtres d'échéance");

const journal2 = {};
const boite2 = [];
const supa2 = fauxSupabase({
  utilisateurs: UTILISATEURS,
  planning_config: [],
  invest_urbanisme_dossiers: [
    // dans la fenêtre de 15 jours → doit alerter
    { id: "u1", reference: "FDU-001", commune: "Nantes", statut: "brouillon",
      date_max_depot: "2026-08-28", commercial: "Camille" },
    // dépassée → critique
    { id: "u2", reference: "FDU-002", commune: "Rezé", statut: "attente_pieces",
      date_max_depot: "2026-08-10", commercial: "Camille" },
    // hors fenêtre (J+40) → silence
    { id: "u3", reference: "FDU-003", commune: "Angers", statut: "brouillon",
      date_max_depot: "2026-09-29", commercial: "Camille" },
    // déjà déposée → silence, même si la date est passée
    { id: "u4", reference: "FDU-004", commune: "Vertou", statut: "depose",
      date_max_depot: "2026-08-01", commercial: "Camille" },
    // instruction finie sans décision → alerte
    { id: "u5", reference: "FDU-005", commune: "Orvault", statut: "depose",
      date_fin_instruction: "2026-08-15", commercial: "Tom" },
  ],
  invest_mission_actions: [
    { id: "a1", action_title: "Demander la CNI", due_date: "2026-08-12", status: "a_faire",
      responsable: "Tom", client_id: "c1" },
    { id: "a2", action_title: "Déjà faite", due_date: "2026-08-01", status: "fait",
      responsable: "Tom", client_id: "c1" },
    { id: "a3", action_title: "Non concernée", due_date: "2026-08-01", status: "non_concerne",
      responsable: "Tom", client_id: "c1" },
  ],
  invest_biens: [
    { id: "b1", reference_interne: "BIEN-01", ville: "Nantes", statut: "À visiter",
      date_relance: "2026-08-18", conseiller_profero: "Camille" },
    { id: "b2", reference_interne: "BIEN-02", ville: "Nantes", statut: "Abandonné",
      date_relance: "2026-08-01", conseiller_profero: "Camille" },
  ],
  invest_etats_des_lieux: [
    { id: "e1", titre: "Apt 16", statut: "brouillon", type: "ENTRÉE",
      auteur: "Tom", updated_at: "2026-08-05T10:00:00Z" },
  ],
}, journal2);

const r2 = await runInvestEcheances({ headers: {} }, supa2, t, fauxMailer(boite2));

verifie("l'urbanisme hors fenêtre ne déclenche rien (FDU-003 absent)",
  !JSON.stringify(boite2).includes("FDU-003"));
verifie("un dossier déjà déposé ne déclenche pas d'alerte de dépôt (FDU-004 absent)",
  !JSON.stringify(boite2).includes("FDU-004"));
verifie("une échéance dépassée est signalée (FDU-002 présent)",
  JSON.stringify(boite2).includes("FDU-002"));
verifie("une instruction close sans décision est signalée (FDU-005 présent)",
  JSON.stringify(boite2).includes("FDU-005"));
verifie("une action terminée ne remonte pas",
  !JSON.stringify(boite2).includes("Déjà faite") && !JSON.stringify(boite2).includes("Non concernée"));
verifie("une action en retard remonte",
  JSON.stringify(boite2).includes("Demander la CNI"));
verifie("un bien abandonné n'est pas relancé (BIEN-02 absent)",
  !JSON.stringify(boite2).includes("BIEN-02"));
verifie("un bien actif à relancer remonte (BIEN-01 présent)",
  JSON.stringify(boite2).includes("BIEN-01"));
verifie("un brouillon d'EDL dormant remonte",
  JSON.stringify(boite2).includes("Apt 16"));

// ════════════════════════════════════════════════════════════════════════════
section("3. Regroupement et adressage");

const dests = boite2.map(m => m.to).sort();
verifie("un seul mail par destinataire",
  new Set(dests).size === dests.length, `reçus : ${JSON.stringify(dests)}`);
verifie("Camille reçoit ses dossiers",
  dests.includes("camille.landais@groupe-profero.com"));
verifie("Tom reçoit les siens",
  dests.includes("tom.fourmond@groupe-profero.com"));
verifie("un utilisateur inactif n'est jamais destinataire",
  !dests.includes("ancien@groupe-profero.com"));

const mailCamille = boite2.find(m => m.to.startsWith("camille"));
verifie("le sujet annonce les échéances dépassées",
  /échéance\(s\) dépassée\(s\)/.test(mailCamille?.subject || ""),
  `sujet obtenu : ${mailCamille?.subject}`);
verifie("le mail de Camille ne contient pas les dossiers de Tom",
  !(mailCamille?.html || "").includes("FDU-005"));

// ════════════════════════════════════════════════════════════════════════════
section("4. Lignes orphelines → administrateurs");

const boite4 = [];
const supa4 = fauxSupabase({
  utilisateurs: UTILISATEURS,
  planning_config: [],
  invest_biens: [
    // conseiller inconnu de l'annuaire : la ligne ne doit pas disparaître
    { id: "b9", reference_interne: "ORPHELIN-01", ville: "Nantes", statut: "À visiter",
      date_relance: "2026-08-01", conseiller_profero: "Quelqu'un d'Externe" },
  ],
  invest_mission_actions: [
    { id: "a9", action_title: "Notif cassée", notification_status: "erreur_envoi",
      notification_error: "domaine non vérifié", responsable: "Tom", client_id: "c1" },
  ],
}, {});

await runInvestEcheances({ headers: {} }, supa4, t, fauxMailer(boite4));

const admin = boite4.find(m => m.to.startsWith("matthieu"));
verifie("une ligne sans responsable identifié part à l'administrateur",
  (admin?.html || "").includes("ORPHELIN-01"));
verifie("une notification en échec est signalée à l'administrateur",
  (admin?.html || "").includes("Notif cassée"));

// ════════════════════════════════════════════════════════════════════════════
section("5. Idempotence");

const journal5 = {};
const boite5 = [];
const tables5 = {
  utilisateurs: UTILISATEURS,
  // état du jour : Camille a déjà été servie
  planning_config: [{ key: "invest_echeances_state",
    value: { date: AUJOURDHUI, emails: ["camille.landais@groupe-profero.com"] } }],
  invest_biens: [
    { id: "b1", reference_interne: "BIEN-01", ville: "Nantes", statut: "À visiter",
      date_relance: "2026-08-18", conseiller_profero: "Camille" },
  ],
};
await runInvestEcheances({ headers: {} }, fauxSupabase(tables5, journal5), t, fauxMailer(boite5));

verifie("un destinataire déjà servi aujourd'hui n'est pas relancé",
  boite5.length === 0, `mails partis : ${boite5.length}`);

// Un échec ne doit PAS être mémorisé comme traité.
const journal6 = {};
const boite6 = [];
const tables6 = {
  utilisateurs: UTILISATEURS,
  planning_config: [],
  invest_biens: [
    { id: "b1", reference_interne: "BIEN-01", ville: "Nantes", statut: "À visiter",
      date_relance: "2026-08-18", conseiller_profero: "Camille" },
  ],
};
const r6 = await runInvestEcheances({ headers: {} }, fauxSupabase(tables6, journal6), t,
  fauxMailer(boite6, { echouePour: ["camille.landais@groupe-profero.com"] }));

verifie("un envoi en échec est compté comme échec", r6.echecs.length === 1);
verifie("un envoi en échec n'est pas mémorisé comme traité",
  !(journal6.upserts || []).some(u =>
    (u.valeur?.value?.emails || []).includes("camille.landais@groupe-profero.com")),
  "l'échec aurait été considéré comme envoyé : il ne repartirait jamais");

// ════════════════════════════════════════════════════════════════════════════
section("6. Robustesse");

const boite7 = [];
// Modules pas encore déployés : les tables urbanisme et EDL n'existent pas.
const supa7 = fauxSupabase({ utilisateurs: UTILISATEURS, planning_config: [] }, {});
const r7 = await runInvestEcheances({ headers: {} }, supa7, t, fauxMailer(boite7));
verifie("des tables absentes ne font pas planter le cron", r7.lignes === 0 && !r7.error);
verifie("aucun mail quand il n'y a rien à signaler", boite7.length === 0);

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(52)}`);
console.log(echecs === 0
  ? `✓ ${passes} vérifications passées.`
  : `✗ ${echecs} échec(s) sur ${passes + echecs} vérifications.`);
process.exit(echecs === 0 ? 0 : 1);
