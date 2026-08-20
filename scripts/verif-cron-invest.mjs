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
const { runInvestEcheances, joursEntre, ajouterJours } =
  require("../api/_cron/cron-invest-echeances.js");
// La règle d'appariement est partagée avec l'interface : on la teste à la
// source, pas sur une copie propre au cron.
import {
  normaliserCleAnnuaire, indexerAnnuaire, emailPourResponsable,
  responsablesInvest, estUtilisateurCourant,
} from "../src/Invest/annuaire.mjs";

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
    // .not(col, "is", null) → la colonne est renseignée
    if (f.op === "notIsNull") return v !== null && v !== undefined;
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
        not(col, op, val) {
          if (op === "is" && val === null) filtres.push({ col, op: "notIsNull" });
          return builder;
        },
        update(patch) {
          const cible = { table, patch, filtres: [...filtres] };
          (journal.updates ||= []).push(cible);
          // .update().eq() : le .eq arrive APRÈS, on renvoie donc un objet
          // qui accepte encore les filtres puis se résout.
          const suite = {
            eq(col, val) { cible.filtres.push({ col, val, op: "eq" }); return suite; },
            then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
          };
          return suite;
        },
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

const UTILISATEURS = [
  { nom: "Matthieu Fumoleau", email: "matthieu.fumoleau@groupe-profero.com", role: "admin",      actif: true },
  { nom: "Camille Landais",   email: "camille.landais@groupe-profero.com",   role: "commercial", actif: true },
  { nom: "Tom Fourmond",      email: "tom.fourmond@groupe-profero.com",      role: "conseiller", actif: true },
  { nom: "Ancien Parti",      email: "ancien@groupe-profero.com",            role: "commercial", actif: false },
];

const AUJOURDHUI = "2026-08-20";
const t = { dateIso: AUJOURDHUI, dateFr: "20/08/2026", weekday: "Jeudi", hour: 4 };


// ════════════════════════════════════════════════════════════════════════════
section("1. Fonctions pures");

verifie("normaliserCleAnnuaire retire les accents et la casse",
  normaliserCleAnnuaire("FRANÇOIS Huet") === "francois huet");
verifie("joursEntre compte à l'endroit", joursEntre(AUJOURDHUI, "2026-08-30") === 10);
verifie("joursEntre compte à l'envers",  joursEntre("2026-08-30", AUJOURDHUI) === -10);
verifie("ajouterJours franchit le mois", ajouterJours(AUJOURDHUI, 15) === "2026-09-04");
verifie("ajouterJours recule",           ajouterJours("2026-08-01", -7) === "2026-07-25");

const annuaireTest = indexerAnnuaire(UTILISATEURS);
verifie("apparie sur le prénom seul",
  emailPourResponsable(annuaireTest, "Camille") === "camille.landais@groupe-profero.com");
verifie("apparie sur le nom complet",
  emailPourResponsable(annuaireTest, "Camille Landais") === "camille.landais@groupe-profero.com");
verifie("apparie malgré les accents",
  emailPourResponsable(indexerAnnuaire([{ nom:"François Huet", email:"francois.huet@x.fr" }]), "François")
    === "francois.huet@x.fr");
verifie("renvoie vide sur un inconnu",
  emailPourResponsable(annuaireTest, "Personne") === "");
verifie("un compte inactif n'entre pas dans l'annuaire",
  emailPourResponsable(annuaireTest, "Ancien") === "",
  "les comptes inactifs sont filtrés à la requête, pas à l'indexation");
verifie("les administrateurs sont repérés",
  annuaireTest.admins.includes("matthieu.fumoleau@groupe-profero.com"));
verifie("la liste des responsables contient l'équipe et les rôles extérieurs",
  responsablesInvest(annuaireTest).includes("Camille Landais")
  && responsablesInvest(annuaireTest).includes("Notaire"));
verifie("la liste retombe sur le repli quand l'annuaire est vide",
  responsablesInvest({ personnes: [] }).length > 0);
verifie("estUtilisateurCourant reconnaît le prénom du connecté",
  estUtilisateurCourant("Camille", { nom: "Camille Landais" }) === true);
verifie("estUtilisateurCourant reconnaît via l'email",
  estUtilisateurCourant("Camille", { email: "camille.landais@x.fr" }) === true);
verifie("estUtilisateurCourant ne confond pas deux personnes",
  estUtilisateurCourant("Tom", { nom: "Camille Landais" }) === false);

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
section("6. Relances consignées");

// La règle centrale : une relance sortie doit être consignée, sinon elle repart
// chaque jour ; une relance NON sortie ne doit pas l'être, sinon elle se taît à
// jamais.
const journalR = {};
const boiteR = [];
const tablesR = {
  utilisateurs: UTILISATEURS,
  planning_config: [],
  invest_mission_actions: [
    // Palier J+5 franchi (échéance 2026-08-10, aujourd'hui 2026-08-20)
    { id: "r1", action_title: "Demander la CNI", due_date: "2026-08-10", status: "a_faire",
      responsable: "Camille", client_id: "c1", relance_rule: "J+2 puis J+5 si non reçue",
      due_reminder_enabled: true, last_reminder_sent_at: null, reminder_count: 0,
      document_drive_attendu: true, justificatif_drive_url: null },
    // Justificatif déposé → aucune relance
    { id: "r2", action_title: "Fiche patrimoniale", due_date: "2026-08-10", status: "a_faire",
      responsable: "Camille", client_id: "c1", relance_rule: "J+2 puis J+5 si non reçue",
      due_reminder_enabled: true, last_reminder_sent_at: null, reminder_count: 0,
      document_drive_attendu: true, justificatif_drive_url: "https://drive/ok" },
    // Règle non calculable → aucune relance
    { id: "r3", action_title: "Contacter la mairie", due_date: "2026-08-01", status: "a_faire",
      responsable: "Camille", client_id: "c1", relance_rule: "Avant dépôt urbanisme",
      due_reminder_enabled: true, last_reminder_sent_at: null, reminder_count: 0 },
  ],
};
await runInvestEcheances({ headers: {} }, fauxSupabase(tablesR, journalR), t, fauxMailer(boiteR));

const corpsR = JSON.stringify(boiteR);
verifie("une relance due part", corpsR.includes("Demander la CNI"));
verifie("le motif nomme le palier atteint", /J\+5/.test(corpsR),
  "le destinataire doit savoir de quelle relance il s'agit");
// Attention à ce qu'on affirme : ces deux actions ont une échéance dépassée,
// donc collecteActions les signale légitimement. Ce qu'on vérifie ici, c'est
// qu'elles ne produisent pas de RELANCE — les lignes de relance sont les seules
// préfixées « Relance — ».
const relancesEmises = (boiteR[0]?.html || "").match(/Relance — [^<]+/g) || [];
verifie("un justificatif déposé ne produit pas de relance",
  !relancesEmises.some(l => l.includes("Fiche patrimoniale")),
  `relances émises : ${JSON.stringify(relancesEmises)}`);
verifie("une règle non calculable ne produit pas de relance",
  !relancesEmises.some(l => l.includes("Contacter la mairie")),
  `relances émises : ${JSON.stringify(relancesEmises)}`);
verifie("une seule relance émise au total", relancesEmises.length === 1,
  `${relancesEmises.length} relance(s) : ${JSON.stringify(relancesEmises)}`);
verifie("l'action en retard reste signalée par ailleurs",
  corpsR.includes("Fiche patrimoniale"),
  "collecteActions doit continuer à signaler une échéance dépassée");

const majR = (journalR.updates || []).filter(u => u.table === "invest_mission_actions");
verifie("la relance sortie est consignée", majR.length === 1,
  `${majR.length} mise(s) à jour — attendu 1`);
verifie("last_reminder_sent_at est posé",
  !!majR[0]?.patch?.last_reminder_sent_at);
verifie("le compteur est incrémenté", majR[0]?.patch?.reminder_count === 1);
verifie("la consignation cible la bonne action",
  majR[0]?.filtres?.some(f => f.col === "id" && f.val === "r1"));

// Envoi en échec : la relance ne doit PAS être consignée, sinon elle ne
// repartirait jamais.
const journalKO = {};
const boiteKO = [];
await runInvestEcheances({ headers: {} }, fauxSupabase(tablesR, journalKO), t,
  fauxMailer(boiteKO, { echouePour: ["camille.landais@groupe-profero.com"] }));
verifie("un envoi en échec ne consigne aucune relance",
  (journalKO.updates || []).filter(u => u.table === "invest_mission_actions").length === 0,
  "sinon la relance serait perdue définitivement");

// Deuxième passage le même jour : l'idempotence par destinataire doit tenir.
const journal2e = {};
const boite2e = [];
await runInvestEcheances({ headers: {} }, fauxSupabase({
  ...tablesR,
  planning_config: [{ key: "invest_echeances_state",
    value: { date: AUJOURDHUI, emails: ["camille.landais@groupe-profero.com"] } }],
}, journal2e), t, fauxMailer(boite2e));
verifie("second passage le même jour : aucune relance en double",
  boite2e.length === 0 && (journal2e.updates || []).length === 0);

section("7. Robustesse");

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
