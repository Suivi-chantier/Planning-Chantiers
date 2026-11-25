#!/usr/bin/env node
// Vérifie les alertes de la fiche sécurité dans la boîte de réception
// (tâche 7b du projet docs/projets/fiche-securite-chantier.md) :
//   - « même chiffre = même service » : le job serveur ne recalcule AUCUNE
//     règle ; il passe par alertesSecurite() (securiteCycleVie.mjs) via
//     securiteAlertesPush.mjs ; seuil 7 jours, statuts « planifie » /
//     « en_cours » et justificatifs requis expirés viennent des fonctions de
//     l'appli (lecture statique des fichiers) ;
//   - la migration : types S1 / S2 ajoutés aux deux contrôles de type (les
//     anciens conservés), job pg_cron au modèle des « profero_push_* »,
//     aucun droit, aucune fonction, aucune policy, aucun GRANT ;
//   - le catalogue : S1 admin + conducteur, S2 administrateurs seulement
//     (rôles imposés) ;
//   - le plan d'envoi : une alerte notifiée une seule fois tant qu'elle reste
//     vraie, oubliée quand elle est résolue, notification regroupée par jour,
//     lien vers la fiche, date du phasage inconnue toujours signalée ;
//   - l'affichage : icône et libellé du type dans la cloche.
//
// Exemples issus des tests, données fictives : chantiers, fiches, dates et
// justificatifs sont inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-alertes.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TYPE_PUSH_SECURITE, TYPE_PUSH_APTITUDES, ALERTES_NOTIFIEES, LIEN_LISTE_CHANTIERS,
  premiereDatePrevuePhasage, nbRequisExpires, entreesAlertesSecurite, aptitudesExpirees,
  planPushSecurite, calculerPlanSecurite, cleObjetAlerte,
} from "../src/Renovation/securiteAlertesPush.mjs";
import { alertesSecurite, ajouterJours, TYPES_ALERTE_SECURITE, STATUT_PLANIFIE, STATUT_EN_COURS } from "../src/Renovation/securiteCycleVie.mjs";
import { CATALOGUE, CODES_TYPES, normaliserReglages, validerContenu, lienVersNavigation, typeDuCatalogue } from "../supabase/functions/_partage/notificationsPushV1.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const sansCommentairesSql = (s) => s.replace(/--[^\n]*/g, "");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

const MIGRATIONS = readdirSync(join(racine, "supabase/migrations")).filter((f) => /_securite_alertes_notifications\.sql$/.test(f));
const MIGRATION = MIGRATIONS.length === 1 ? lire(`supabase/migrations/${MIGRATIONS[0]}`) : "";
const SQL = sansCommentairesSql(MIGRATION);
const JOB = lire("api/_cron/cron-alertes-securite.js");
const JOB_CODE = sansCommentaires(JOB);
const MODULE = sansCommentaires(lire("src/Renovation/securiteAlertesPush.mjs"));
const CYCLE = sansCommentaires(lire("src/Renovation/securiteCycleVie.mjs"));

// ── 1. Même service : aucune règle recopiée ─────────────────────────────────
test("1. le job serveur passe par le module de l'appli, sans recalcul", () => {
  assert.match(JOB_CODE, /import\("\.\.\/\.\.\/src\/Renovation\/securiteAlertesPush\.mjs"\)/);
  assert.match(JOB_CODE, /M\.calculerPlanSecurite\(/);
  // Aucun seuil, aucun statut, aucune comparaison de date écrits dans le job.
  assert.ok(!/planifie|en_cours|a_mettre_a_jour|validee|brouillon/.test(JOB_CODE.replace(/validee_le|validee_par/g, "")), "aucun statut recopié dans le job");
  assert.ok(!/\b7\b\s*\*|ajouterJours|expire_le\s*</.test(JOB_CODE), "aucun seuil de jours dans le job");
  // Le module passe par alertesSecurite et les règles de validation, sans les réécrire.
  assert.match(MODULE, /import \{ alertesSecurite, TYPES_ALERTE_SECURITE \} from "\.\/securiteCycleVie\.mjs"/);
  assert.match(MODULE, /import \{ justificatifsRequisManquants, estExpire, estJustificatifActif \} from "\.\/securiteValidation\.mjs"/);
  assert.match(MODULE, /const alertes = alertesSecurite\(entrees\)/);
  assert.ok(!/ajouterJours|STATUT_PLANIFIE|STATUT_EN_COURS|"planifie"|"en_cours"/.test(MODULE), "le module ne refait pas les règles de statut ni le seuil");
  // Le seuil reste écrit une seule fois, dans alertesSecurite.
  assert.equal((CYCLE.match(/ajouterJours\(jour, 7\)/g) || []).length, 1, "seuil 7 jours écrit une fois");
  assert.deepEqual([...ALERTES_NOTIFIEES].sort(), Object.keys(TYPES_ALERTE_SECURITE).sort());
});

test("2. la migration ne contient aucune règle métier (pas de seuil, pas de statut de chantier)", () => {
  assert.equal(MIGRATIONS.length, 1, `migrations trouvées : ${MIGRATIONS.join(", ") || "aucune"}`);
  const s = SQL.toLowerCase();
  assert.ok(!/planifie|en_cours|securite_fiches|phasages|interval|current_date/.test(s), "aucune règle recopiée en SQL");
});

// ── 2. Migration : contrôles élargis, job au modèle existant, aucun droit ──
test("3. migration : S1 / S2 ajoutés aux deux contrôles, anciens types conservés", () => {
  const s = SQL.toLowerCase();
  const avant = ["c1", "c2", "c3", "c4", "c5", "f1", "f2", "d1", "d2", "d3", "d4"];
  const chkNotif = s.match(/add constraint notifications_type_check\s+check \(type in \(([^)]*)\)\)/);
  const chkEtat = s.match(/add constraint notifications_etat_type_check\s+check \(type in \(([^)]*)\)\)/);
  assert.ok(chkNotif && chkEtat, "les deux contrôles sont recréés");
  const codes = (m) => m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(codes(chkNotif), [...avant, "s1", "s2", "test"]);
  assert.deepEqual(codes(chkEtat), [...avant, "s1", "s2"]);
  // Le catalogue et la base acceptent exactement les mêmes types.
  assert.deepEqual(CODES_TYPES.map((c) => c.toLowerCase()), [...avant, "s1", "s2"]);
});

test("4. migration : aucun droit, aucune fonction, aucune policy, aucune table", () => {
  const s = SQL.toLowerCase();
  assert.ok(!/create (or replace )?function|security definer/.test(s), "aucune fonction");
  assert.ok(!/create policy|alter policy|drop policy/.test(s), "aucune policy");
  assert.ok(!/\bgrant\b|\brevoke\b/.test(s), "aucun droit");
  assert.ok(!/create table|drop table|delete from|update |insert into|truncate/.test(s), "aucune donnée touchée");
  assert.ok(!/invest_dossier_etapes/.test(s));
  assert.ok(!/vault\.(create_secret|update_secret)|insert\s+into\s+vault/.test(s), "le secret n'est jamais écrit");
  const alters = s.match(/alter table [^\s]+/g) || [];
  assert.ok(alters.every((a) => /public\.notifications(_etat)?$/.test(a)), alters.join(", "));
  assert.ok(!/notifications_push/.test(s), "réglage commun non écrit (interrupteur inchangé)");
});

test("5. migration : job pg_cron au modèle « profero_push_* », 7h35 Paris été comme hiver, hors 6h-9h Pacifique", () => {
  assert.match(SQL, /select cron\.unschedule\(jobname\)\s+from cron\.job\s+where jobname = 'profero_push_alertes_securite';/);
  assert.match(SQL, /cron\.schedule\(\s*'profero_push_alertes_securite',\s*'35 5,6 \* \* 1-5',/);
  assert.match(SQL, /extract\(hour from \(now\(\) at time zone 'Europe\/Paris'\)\) <> 7 then\s+return;/);
  assert.match(SQL, /from vault\.decrypted_secrets where name = 'cron_secret'/);
  assert.match(SQL, /raise exception 'profero_push_alertes_securite : secret cron_secret absent du Vault/);
  assert.match(SQL, /url := 'https:\/\/planning-chantiers\.vercel\.app\/api\/cron-dispatcher\?job=alertes_securite&pas_avant=7'/);
  // 05h35 et 06h35 UTC = 22h35 la veille à Los Angeles (heure d'été / d'hiver) : hors 6h-9h.
  for (const h of [5, 6]) for (const decalage of [7, 8]) {
    const pacifique = (h - decalage + 24) % 24;
    assert.ok(pacifique < 6 || pacifique >= 9, `${h}h35 UTC = ${pacifique}h35 Pacifique`);
  }
});

test("6. dispatcher : tâche alertes_securite par ?job= seulement", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /require\("\.\/_cron\/cron-alertes-securite\.js"\)/);
  assert.match(disp, /alertes_securite: \{\s*fenetre: null,\s*run: \(req, supabase, t\) => runAlertesSecurite\(req, supabase, t\),/);
  // Écritures du job : send-push (boîte) et notifications_etat, rien d'autre.
  const ecritures = JOB_CODE.match(/\.from\([^)]*\)\.(upsert|insert|update|delete)\(/g) || [];
  assert.ok(ecritures.length >= 2 && ecritures.every((e) => /TABLE_ETAT/.test(e)), ecritures.join(" | "));
  assert.match(JOB_CODE, /appelerSendPush\(\{ mode: "serveur", \.\.\.bloc\.contenu \}\)/);
  assert.match(JOB_CODE, /if \(ecrites <= 0\)/, "rien d'inscrit si rien n'est écrit en boîte");
  assert.match(JOB_CODE, /if \(simulation\) \{/);
  const fonctions = readdirSync(join(racine, "api")).filter((f) => !f.startsWith("_"));
  assert.ok(fonctions.length <= 12, `${fonctions.length} fonctions Vercel`);
});

test("7. catalogue : S1 admin + conducteur, S2 administrateurs seulement (imposé)", () => {
  assert.deepEqual([...typeDuCatalogue("S1").roles], ["admin", "conducteur"]);
  assert.deepEqual([...typeDuCatalogue("S2").roles], ["admin"]);
  assert.deepEqual([...typeDuCatalogue("S2").rolesFixes], ["admin"]);
  const r = normaliserReglages({ actif: true, types: { S2: { actif: true, roles: ["conducteur", "admin"] } } });
  assert.deepEqual(r.types.S2.roles, ["admin"]);
  assert.ok(CATALOGUE.every((t) => !t.roles.includes("ouvrier")));
});

// ── 3. Module : exemples issus des tests, données fictives ──────────────────
const JOUR = "2026-11-25";
const CHANTIERS = [
  { id: "a", nom: "PLANIFIÉ SANS FICHE", statut: "planifie" },
  { id: "b", nom: "PLANIFIÉ BROUILLON J+7", statut: "planifie" },
  { id: "c", nom: "PLANIFIÉ BROUILLON J+8", statut: "planifie" },
  { id: "d", nom: "EN COURS JUSTIF EXPIRÉ", statut: "en_cours" },
  { id: "e", nom: "EN COURS À METTRE À JOUR", statut: "en_cours" },
  { id: "f", nom: "PLANIFIÉ SANS DATE", statut: "planifie" },
  { id: "g", nom: "ARCHIVÉ", statut: "planifie", archive_le: "2026-01-01" },
  { id: "h", nom: "TERMINÉ À METTRE À JOUR", statut: "termine" },
];
const REP_AMIANTE = { p4: { statut: "concerne" } };
const FICHES = [
  { id: "fb", chantier_id: "b", statut: "brouillon", version: 1, reponses: {} },
  { id: "fc", chantier_id: "c", statut: "brouillon", version: 1, reponses: {} },
  { id: "fd", chantier_id: "d", statut: "validee", version: 1, validee_le: "2026-11-01", reponses: REP_AMIANTE },
  { id: "fe", chantier_id: "e", statut: "a_mettre_a_jour", version: 2, reponses: {} },
  { id: "ff", chantier_id: "f", statut: "brouillon", version: 1, reponses: {} },
  { id: "fh", chantier_id: "h", statut: "a_mettre_a_jour", version: 1, reponses: {} },
];
const PHASAGES = [
  { chantier_id: "a", ouvrages: [{ taches: [{ date_prevue: "2027-03-01" }] }] },
  { chantier_id: "b", ouvrages: [{ taches: [{ date_prevue: "2026-12-10" }, { date_prevue: ajouterJours(JOUR, 7) }] }, { taches: [{ date_prevue: "" }] }] },
  { chantier_id: "c", ouvrages: [{ taches: [{ date_prevue: ajouterJours(JOUR, 8) }] }] },
  { chantier_id: "f", ouvrages: [{ taches: [{ date_prevue: "" }, { date_prevue: null }] }] },
];

test("8. première date prévue du phasage : la plus petite date_prevue, vide = inconnue", () => {
  assert.equal(premiereDatePrevuePhasage(PHASAGES[1].ouvrages), "2026-12-02");
  assert.equal(premiereDatePrevuePhasage(PHASAGES[3].ouvrages), null);
  assert.equal(premiereDatePrevuePhasage(null), null);
  assert.equal(premiereDatePrevuePhasage([{ taches: [{ date_prevue: "2026-13-45x" }] }]), null);
});

test("9. justificatif requis expiré : même règle que la validation, confidentiel exclu", () => {
  // Le point 4 (amiante) exige un repérage amiante (securite/points.mjs).
  const expire = { portee: "chantier", chantier_id: "d", point: 4, type_code: "reperage_amiante", expire_le: "2026-11-24", confidentiel: false };
  assert.equal(nbRequisExpires({ reponses: REP_AMIANTE, justificatifs: [expire], aujourdhui: JOUR }), 1);
  assert.equal(nbRequisExpires({ reponses: REP_AMIANTE, justificatifs: [{ ...expire, expire_le: JOUR }], aujourdhui: JOUR }), 0, "expire le jour même : encore valable");
  assert.equal(nbRequisExpires({ reponses: REP_AMIANTE, justificatifs: [expire, { ...expire, expire_le: "2027-01-01" }], aujourdhui: JOUR }), 0, "un justificatif valable suffit");
  assert.equal(nbRequisExpires({ reponses: REP_AMIANTE, justificatifs: [{ ...expire, archive_le: "2026-11-20" }], aujourdhui: JOUR }), 0, "archivé : absent, pas expiré");
  assert.equal(nbRequisExpires({ reponses: REP_AMIANTE, justificatifs: [{ ...expire, confidentiel: true }], aujourdhui: JOUR }), 0);
  assert.equal(nbRequisExpires({ reponses: {}, justificatifs: [expire], aujourdhui: JOUR }), 0, "point non concerné : pas requis");
});

const JUSTIFS = [
  { id: "j1", portee: "chantier", chantier_id: "d", point: 4, type_code: "reperage_amiante", expire_le: "2026-11-01", confidentiel: false },
  { id: "j2", portee: "entreprise", chantier_id: null, point: 4, type_code: "aptitude_medicale", expire_le: "2026-11-01", confidentiel: true, personne: "Nom fictif" },
  { id: "j3", portee: "entreprise", chantier_id: null, point: 4, type_code: "aptitude_medicale", expire_le: "2027-11-01", confidentiel: true },
];

test("10. les 4 alertes : exactement celles de alertesSecurite() sur les mêmes entrées", () => {
  const entrees = entreesAlertesSecurite({ chantiers: CHANTIERS, fiches: FICHES, phasages: PHASAGES, justificatifs: JUSTIFS, aujourdhui: JOUR });
  const attendu = alertesSecurite(entrees);
  const p = calculerPlanSecurite({ chantiers: CHANTIERS, fiches: FICHES, phasages: PHASAGES, justificatifs: JUSTIFS, etatsStockes: [], dateParis: JOUR });
  assert.deepEqual(p.alertes, attendu, "même service");
  const vu = p.s1.nouvelles.map((a) => `${a.type}:${a.chantier_id}`).sort();
  assert.deepEqual(vu, [
    "fiche_a_creer:a",
    "fiche_a_mettre_a_jour:e",
    "fiche_non_validee_j7:b", // à 7 jours pile
    "justificatif_expire:d",
  ]);
  assert.ok(!vu.some((x) => x.endsWith(":c")), "à 8 jours : pas encore");
  assert.ok(!vu.some((x) => x.endsWith(":g")), "archivé : jamais");
  assert.ok(!vu.some((x) => x.endsWith(":h")), "terminé : jamais");
  assert.deepEqual(p.datesInconnues, ["f"], "date inconnue signalée à part");
  assert.equal(p.s2.nouvelles.length, 1, "une aptitude médicale expirée");
  assert.equal(STATUT_PLANIFIE, "planifie");
  assert.equal(STATUT_EN_COURS, "en_cours");
});

test("11. une alerte n'est envoyée qu'une fois tant qu'elle reste vraie ; résolue, elle est oubliée", () => {
  const base = { chantiers: CHANTIERS, fiches: FICHES, phasages: PHASAGES, justificatifs: JUSTIFS, dateParis: JOUR };
  const p1 = calculerPlanSecurite({ ...base, etatsStockes: [] });
  const stockes = [...p1.s1.aInscrire.map((c) => ({ type: "S1", cle_objet: c })), ...p1.s2.aInscrire.map((c) => ({ type: "S2", cle_objet: c }))];
  const p2 = calculerPlanSecurite({ ...base, etatsStockes: stockes });
  assert.equal(p2.s1.nouvelles.length, 0);
  assert.equal(p2.s1.contenu, null, "rien de nouveau : aucune notification");
  assert.equal(p2.s2.contenu, null);
  assert.deepEqual(p2.aOublier, []);
  // Le lendemain, le chantier « c » entre dans les 7 jours : nouvelle alerte, les autres ne repartent pas.
  const lendemain = calculerPlanSecurite({ ...base, etatsStockes: stockes, dateParis: "2026-11-26" });
  assert.deepEqual(lendemain.s1.nouvelles.map(cleObjetAlerte), ["fiche_non_validee_j7:c"]);
  // La fiche du chantier « a » est créée : l'alerte est oubliée…
  const fiches3 = [...FICHES, { id: "fa", chantier_id: "a", statut: "brouillon", version: 1, reponses: {} }];
  const p3 = calculerPlanSecurite({ ...base, fiches: fiches3, etatsStockes: stockes });
  assert.deepEqual(p3.aOublier, [{ type: "S1", cle_objet: "fiche_a_creer:a" }]);
  // … et si elle revient (fiche supprimée), elle repart.
  const restants = stockes.filter((s) => s.cle_objet !== "fiche_a_creer:a");
  const p4 = calculerPlanSecurite({ ...base, etatsStockes: restants });
  assert.deepEqual(p4.s1.nouvelles.map(cleObjetAlerte), ["fiche_a_creer:a"]);
});

test("12. contenu : une notification regroupée par jour, valide pour send-push, lien vers la fiche", () => {
  const p = calculerPlanSecurite({ chantiers: CHANTIERS, fiches: FICHES, phasages: PHASAGES, justificatifs: JUSTIFS, etatsStockes: [], dateParis: JOUR });
  const c = p.s1.contenu;
  assert.equal(c.type, TYPE_PUSH_SECURITE);
  assert.equal(c.cle_regroupement, `S1-${JOUR}`);
  assert.equal(c.titre, "4 alertes fiche sécurité");
  assert.equal(c.lien, LIEN_LISTE_CHANTIERS, "plusieurs chantiers : la liste");
  assert.match(c.texte, /PLANIFIÉ SANS DATE|1 chantier planifié sans date au phasage/);
  assert.ok(validerContenu(c).ok, JSON.stringify(validerContenu(c)));
  // Un seul chantier : lien direct vers sa fiche (bandeau « Fiche sécurité »).
  const un = planPushSecurite({ alertes: [p.s1.nouvelles[0]], nomsChantiers: { a: "PLANIFIÉ SANS FICHE" }, dateParis: JOUR });
  assert.equal(un.s1.contenu.lien, "/?page=chantiers&chantier=a");
  assert.deepEqual(lienVersNavigation(un.s1.contenu.lien), { page: "chantiers", chantier: "a" });
  assert.equal(un.s1.contenu.titre, "Fiche sécurité à créer — PLANIFIÉ SANS FICHE");
  assert.ok(validerContenu(un.s1.contenu).ok);
  // Beaucoup d'alertes : titre et texte restent dans les limites.
  const beaucoup = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, nom: `CHANTIER FICTIF ${"N".repeat(40)} ${i}`, statut: "planifie" }));
  const pb = calculerPlanSecurite({ chantiers: beaucoup, fiches: [], phasages: [], justificatifs: [], etatsStockes: [], dateParis: JOUR });
  assert.equal(pb.s1.nouvelles.length, 60);
  assert.ok(validerContenu(pb.s1.contenu).ok, "texte tronqué sous 1000 caractères");
  assert.match(pb.s1.contenu.texte, /… et \d+ autres\.\n60 chantiers planifiés sans date au phasage/, "la fin du texte n'est jamais coupée");
});

test("13. S2 aptitudes médicales : administrateurs, aucun nom de personne", () => {
  const ap = aptitudesExpirees({ justificatifs: JUSTIFS, aujourdhui: JOUR });
  assert.deepEqual(ap.map((j) => j.id), ["j2"]);
  const p = planPushSecurite({ alertes: [], aptitudes: ap, dateParis: JOUR });
  const c = p.s2.contenu;
  assert.equal(c.type, TYPE_PUSH_APTITUDES);
  assert.equal(c.titre, "1 aptitude médicale expirée");
  assert.ok(!/Nom fictif/.test(JSON.stringify(c)), "jamais le nom de la personne");
  assert.ok(validerContenu(c).ok);
  assert.equal(c.cle_regroupement, `S2-${JOUR}`);
});

test("14. sans date du jour : rien (pas d'horloge dans les modules)", () => {
  const p = calculerPlanSecurite({ chantiers: CHANTIERS, fiches: FICHES, phasages: PHASAGES, justificatifs: JUSTIFS, etatsStockes: [], dateParis: "" });
  assert.equal(p.alertes.length, 0);
  assert.equal(p.s1.contenu, null);
  assert.ok(!/new Date\(\)|Date\.now\(/.test(MODULE), "aucune horloge (Date.UTC ne sert qu'à contrôler une date)");
});

// ── 4. Affichage ────────────────────────────────────────────────────────────
test("15. cloche : icône et libellé du type S1 / S2, lien traduit sans rechargement", () => {
  const cloche = sansCommentaires(lire("src/Renovation/ClocheNotifications.jsx"));
  assert.match(cloche, /const ICONES_TYPE = \{ S1: ShieldAlert, S2: ShieldAlert \}/);
  assert.match(cloche, /typeDuCatalogue\(n\.type\)/);
  assert.match(cloche, /onNaviguer\?\.\(n\.lien \|\| "\/"\)/);
  const reglages = sansCommentaires(lire("src/Renovation/ReglagesNotificationsAdmin.jsx"));
  assert.match(reglages, /disabled=\{!!t\.rolesFixes\}/, "S2 : rôles non modifiables à l'écran");
});

console.log(`\n${n} vérifications passées (exemples issus des tests, données fictives).`);
