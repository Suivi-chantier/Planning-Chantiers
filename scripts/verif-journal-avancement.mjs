// Vérification de l'étape 1C (refonte du Bilan semaine) : journal
// d'avancement daté et production exacte.
//
// Exemple issu des tests, données fictives : chantiers, tâches, dates,
// ouvriers et montants sont inventés pour le calcul.
//
//   1. module (chantierFinance.mjs) : état des tâches à une date, avancement
//      d'ouvrage exact (non arrondi), production d'une période, marge de la
//      semaine en mode journal ;
//   2. SQL (supabase/migrations/20261024130000_journal_avancement.sql) exécuté
//      dans PostgreSQL en mémoire (PGlite) sur une réplique minimale :
//      initialisation, compte rendu de mardi validé jeudi, phasage sur une
//      tâche déjà pointée, compte rendu rouvert puis revalidé, contexte
//      illisible sans blocage, lot, contrôle nocturne, reconstitution ;
//   3. gardes sur le code des écrans.
//
//   npm install --no-save --no-package-lock @electric-sql/pglite@0.5.8   (une fois)
//   node scripts/verif-journal-avancement.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  etatTachesALaDate, avancementOuvrageExact, avancementOuvrage, productionPeriode,
  margeReelleSemaine, METHODE_CALCUL,
} from "../src/chantierFinance.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const MIGRATION = lire("supabase/migrations/20261024130000_journal_avancement.sql");
let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(a != null && Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`); nb++; };

// ── 1. MODULE ───────────────────────────────────────────────────────────────
const L = (tache_id, avant, apres, date, created_at, extra = {}) =>
  ({ tache_id, avancement_avant: avant, avancement_apres: apres, date_realisation: date, created_at, ...extra });

// 1a. Compte rendu de MARDI validé JEUDI : la production tombe mardi.
{
  const ouvrages = [{ id: "o1", prix_ht: 10000, taches: [{ id: "t1", avancement: 30, heures_estimees: 10 }] }];
  const journal = [
    L("t1", null, 20, "2026-10-12", "2026-10-12T20:00:00Z", { source: "initial" }),
    L("t1", 20, 30, "2026-10-20", "2026-10-22T17:00:00Z", { source: "validation_cr" }), // mardi 20, validé jeudi 22
  ];
  ok(etatTachesALaDate(journal, "2026-10-19").get("t1") === 20, "lundi : 20 %");
  ok(etatTachesALaDate(journal, "2026-10-20").get("t1") === 30, "mardi (jour du rapport) : 30 %");
  proche(productionPeriode({ ouvrages, journal, du: "2026-10-19", au: "2026-10-20" }).valeur, 1000, "production de mardi = 10 % × 10 000 €");
  proche(productionPeriode({ ouvrages, journal, du: "2026-10-21", au: "2026-10-22" }).valeur, 0, "rien le jour de la validation");
}

// 1b. Écriture tardive : une valeur écrite plus tard l'emporte, même datée avant.
{
  const journal = [
    L("t1", 20, 25, "2026-10-21", "2026-10-21T10:00:00Z", { source: "phasage" }),      // mercredi, d'après une info ancienne
    L("t1", 25, 30, "2026-10-20", "2026-10-22T17:00:00Z", { source: "validation_cr" }), // CR de mardi validé jeudi
  ];
  ok(etatTachesALaDate(journal, "2026-10-19").get("t1") === 20, "avant tout : valeur « avant » de la première écriture");
  ok(etatTachesALaDate(journal, "2026-10-21").get("t1") === 30, "mercredi : la dernière écriture datée ≤ mercredi l'emporte");
  ok(etatTachesALaDate(journal, null).get("t1") === 30, "aujourd'hui = dernière valeur écrite");
}

// 1c. Avancement EXACT : 0,4 % ne doit plus donner 0 € (l'arrondi d'affichage reste).
{
  const o = { id: "o1", prix_ht: 50000, taches: [{ id: "a", avancement: 1, heures_estimees: 40 }, { id: "b", avancement: 0, heures_estimees: 60 }] };
  proche(avancementOuvrageExact(o), 0.4, "avancement exact 0,4 %");
  ok(avancementOuvrage(o) === 0, "l'avancement affiché reste arrondi (0 %)");
  proche(productionPeriode({ ouvrages: [o], journal: [], du: null, au: null }).valeur, 200, "0,4 % de 50 000 € = 200 €, plus 0 €");
}

// 1d. Ajout d'un ouvrage chiffré : la production passée des autres ne bouge pas.
{
  const o1 = { id: "o1", prix_ht: 20000, taches: [{ id: "t1", avancement: 50, heures_estimees: 10 }] };
  const journal = [L("t1", 0, 50, "2026-10-14", "2026-10-14T18:00:00Z")];
  const avant = productionPeriode({ ouvrages: [o1], journal, du: "2026-10-12", au: "2026-10-16" }).valeur;
  const o2 = { id: "o2", prix_ht: 80000, taches: [{ id: "t2", avancement: 0, heures_estimees: 50 }] }; // ajouté après
  const apres = productionPeriode({ ouvrages: [o1, o2], journal, du: "2026-10-12", au: "2026-10-16" }).valeur;
  proche(avant, 10000, "production de la semaine passée");
  proche(apres, avant, "ajouter un ouvrage ne change pas la production passée");
}

// 1e. Une tâche ajoutée à un ouvrage existant (composition actuelle) et les
//     tâches hors devis, hors de l'avancement.
{
  const o = { id: "o1", prix_ht: 10000, taches: [
    { id: "t1", avancement: 100, heures_estimees: 10 },
    { id: "hd", avancement: 100, heures_estimees: 90, hors_devis: true },
  ] };
  proche(avancementOuvrageExact(o), 100, "la tâche hors devis n'entre pas dans l'avancement");
}

// 1f. Une impossibilité reste visible : avant le début du journal → inconnu.
{
  const ouvrages = [{ id: "o1", libelle: "Cloisons", prix_ht: 10000, taches: [{ id: "t1", avancement: 40, heures_estimees: 10 }] }];
  const journal = [L("t1", null, 40, "2026-10-26", "2026-10-26T08:00:00Z", { source: "initial" })];
  const p = productionPeriode({ ouvrages, journal, du: "2026-10-16", au: "2026-10-23" });
  ok(p.valeur === null && p.inconnus.length === 1, "production inconnue avant la ligne initiale");
  ok(/journal d'avancement de ce chantier commence le 26\/10\/2026/.test(p.raison), `raison dite : ${p.raison}`);
}

// 1g. Marge de la semaine en mode journal : même production que productionPeriode.
{
  const phasage = { ouvrages: [{ id: "o1", prix_ht: 10000, taches: [{ id: "t1", avancement: 30, heures_estimees: 10 }] }], plan_travaux: { meta: {} } };
  const journal = [L("t1", null, 20, "2026-10-12", "2026-10-12T20:00:00Z"), L("t1", 20, 30, "2026-10-20", "2026-10-22T17:00:00Z")];
  const pointages = [{ date: "2026-10-20", heures: 8, taux_horaire: 30, tache_id: "t1" }];
  const r = margeReelleSemaine({ phasage, pointages, journal, tauxFG: [{ depuis: "2026-01-01", taux: 10 }],
    prixVendu: 99999, avancementDebut: 20, avancementFin: 30, du: "2026-10-16", au: "2026-10-23" });
  ok(r.modeJournal === true && r.calculable === true, "marge calculable avec le journal");
  proche(r.produit, 1000, "production = journal (et non points × prix vendu)");
  proche(r.marge, 1000 - 240 - 80, "marge = production − MO − FG");
  proche(r.cumul.produit, 3000, "production depuis le début = 30 % × 10 000 €");
  ok(r.semaine.ventilation.some(v => /↳ \(sans libellé\)/.test(v.main)), "détail par ouvrage dans la fiche");
  // Sans relevé de fin : le journal suffit (la semaine reste calculable).
  const r2 = margeReelleSemaine({ phasage, pointages, journal, avancementDebut: 20, avancementFin: null, du: "2026-10-16", au: "2026-10-23" });
  ok(r2.calculable === true, "relevé du vendredi absent : la production vient du journal");
  // Sans journal : ancienne méthode, inchangée.
  const r3 = margeReelleSemaine({ phasage, pointages, prixVendu: 10000, avancementDebut: 20, avancementFin: 30, du: "2026-10-16", au: "2026-10-23" });
  ok(r3.modeJournal === false && r3.produit === 1000, "sans journal : points × prix vendu");
  ok(METHODE_CALCUL.some(m => m.cle === "production" && /journal d'avancement daté/.test(m.formule)), "méthode de calcul : production");
}

// ── 2. SQL (PGlite) ─────────────────────────────────────────────────────────
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
  create extension if not exists plpgsql;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.email() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'email' $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;
  create table public.utilisateurs (email text, role text, actif boolean);
  create function public.mon_role() returns text language sql stable security definer set search_path = public as $$
    select u.role from public.utilisateurs u where u.email = auth.email() and u.actif is true limit 1; $$;
  create function public.est_ouvrier() returns boolean language sql stable security definer set search_path = public as $$
    select public.mon_role() = 'ouvrier'; $$;
  create function public.est_collaborateur_actif() returns boolean language sql stable as $$ select true $$;
  create table public.phasages (id uuid primary key default gen_random_uuid(), chantier_id text, chantier_nom text,
    ouvrages jsonb, plan_travaux jsonb, revision bigint not null default 0, updated_at timestamptz default now());
  create function public.phasages_incrementer_revision() returns trigger language plpgsql as $$
    begin new.revision := coalesce(old.revision, 0) + 1; return new; end $$;
  create trigger trg_phasages_revision before update on public.phasages for each row execute function public.phasages_incrementer_revision();
  create table public.pointages (id uuid primary key default gen_random_uuid(), chantier_id text, tache_id text, date date, heures numeric);
  create table public.phasages_history (id uuid primary key default gen_random_uuid(), phasage_id uuid, chantier_id text,
    chantier_nom text, ouvrages jsonb, plan_travaux jsonb, client_id text, prev_updated_at timestamptz, saved_at timestamptz);
  insert into public.utilisateurs values ('conducteur@test.fr', 'conducteur', true), ('ouvrier@test.fr', 'ouvrier', true);
`);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const js = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const q = async (sql) => (await db.query(sql)).rows;
const enTantQue = (email) => db.exec(`select set_config('request.jwt.claims', ${lit(JSON.stringify({ email, sub: "00000000-0000-0000-0000-000000000001" }))}, false)`);

const ouvragesInit = [
  { id: "o1", prix_ht: 10000, taches: [{ id: "t1", avancement: 20, heures_estimees: 10 }, { id: "t2", avancement: 0, heures_estimees: 10 }] },
  { id: "o2", prix_ht: 5000, taches: [{ id: "t3", avancement: "45", heures_estimees: 5 }] },
];
const [{ id: PH }] = await q(`insert into public.phasages (chantier_id, ouvrages, updated_at) values ('C1', ${js(ouvragesInit)}, '2026-10-01T08:00:00Z') returning id`);
await db.exec(`insert into public.pointages (chantier_id, tache_id, date, heures) values
  ('C1', 't1', '2026-10-14', 8), ('C1', 't1', '2026-10-15', 8), ('C1', 't2', '2026-10-30', 4)`);

// 2a. La migration s'applique et initialise le journal.
await db.exec(MIGRATION);
ok(!/select\s+public\.avancement_journal_reconstituer\s*\(\s*true/i.test(MIGRATION.replace(/--.*$/gm, "")), "la migration ne lance PAS la reconstitution");
// (L'insertion du phasage AVANT la migration n'est pas journalisée : le déclencheur n'existait pas.)
let lignes = await q(`select tache_id, avancement_avant, avancement_apres::float as apres, source from public.avancement_journal order by tache_id`);
ok(lignes.length === 3 && lignes.every(l => l.source === "initial" && l.avancement_avant === null), "une ligne « initial » par tâche, avant inconnu");
ok(lignes.find(l => l.tache_id === "t3").apres === 45, "valeur texte « 45 » lue comme 45");
await db.exec(`select public.avancement_journal_initialiser()`);
ok((await q(`select count(*)::int n from public.avancement_journal`))[0].n === 3, "initialisation rejouable sans doublon");

const rev = async () => (await q(`select revision::int r from public.phasages where id = '${PH}'`))[0].r;
const ouvragesAvec = (patch) => ouvragesInit.map(o => ({ ...o, taches: o.taches.map(t => ({ ...t, ...(patch[t.id] != null ? { avancement: patch[t.id] } : {}) })) }));
const sauver = async (ouvrages, journal) => (await q(`select public.conducteur_sauvegarder_phasage_v2('${PH}', ${await rev()}, ${js(ouvrages)}, null, ${journal ? js(journal) : "null"}) r`))[0].r;
const RAPPORT = "11111111-1111-1111-1111-111111111111";

// 2b. Compte rendu de mardi (20/10) validé jeudi : ligne datée du mardi.
await enTantQue("conducteur@test.fr");
let r = await sauver(ouvragesAvec({ t1: 30 }), { source: "validation_cr", date: "2026-10-20", rapport_id: RAPPORT, auteur: "Conducteur A" });
ok(r.ok === true, "sauvegarde acceptée");
lignes = await q(`select * from public.avancement_journal where source <> 'initial'`);
ok(lignes.length === 1, "une seule ligne : seule t1 a changé");
const l1 = lignes[0];
ok(l1.tache_id === "t1" && Number(l1.avancement_avant) === 20 && Number(l1.avancement_apres) === 30, "avant 20 → après 30");
ok(String(l1.date_realisation instanceof Date ? l1.date_realisation.toISOString() : l1.date_realisation).startsWith("2026-10-20"), "datée du jour du RAPPORT");
ok(l1.source === "validation_cr" && l1.rapport_id === RAPPORT && l1.auteur === "Conducteur A" && l1.ouvrage_id === "o1", "source, compte rendu, auteur, ouvrage");

// 2c. Modification depuis le phasage sur une tâche déjà pointée : sans date
//     choisie → dernier pointage de la tâche ; avec date choisie → celle-ci.
r = await sauver(ouvragesAvec({ t1: 40 }), { source: "phasage" });
let der = (await q(`select date_realisation::text d, source from public.avancement_journal where tache_id = 't1' order by created_at desc limit 1`))[0];
ok(der.d === "2026-10-15" && der.source === "phasage", `phasage sans date : dernier pointage de la tâche (${der.d})`);
r = await sauver(ouvragesAvec({ t1: 45 }), { source: "phasage", dates: { t1: "2026-10-16" } });
der = (await q(`select date_realisation::text d from public.avancement_journal where tache_id = 't1' order by created_at desc limit 1`))[0];
ok(der.d === "2026-10-16", "phasage : date choisie dans l'écran");
// Une sauvegarde sans changement d'avancement n'écrit rien.
const avantRien = (await q(`select count(*)::int n from public.avancement_journal`))[0].n;
await sauver(ouvragesAvec({ t1: 45 }), null);
ok((await q(`select count(*)::int n from public.avancement_journal`))[0].n === avantRien, "aucune ligne quand rien ne change");

// 2d. Compte rendu rouvert (« Corriger ») puis revalidé : pas de doublon
//     incohérent — même valeur → rien ; nouvelle valeur → la chaîne continue.
r = await sauver(ouvragesAvec({ t1: 45 }), { source: "validation_cr", date: "2026-10-20", rapport_id: RAPPORT });
ok((await q(`select count(*)::int n from public.avancement_journal`))[0].n === avantRien, "revalidé à l'identique : aucune ligne");
r = await sauver(ouvragesAvec({ t1: 50 }), { source: "validation_cr", date: "2026-10-20", rapport_id: RAPPORT });
const journalT1 = await q(`select tache_id, avancement_avant::float, avancement_apres::float, date_realisation::text, created_at::text from public.avancement_journal where tache_id = 't1'`);
const chaine = journalT1.map(l => ({ ...l, avancement_avant: l.avancement_avant, avancement_apres: l.avancement_apres }));
ok(etatTachesALaDate(chaine, null).get("t1") === 50, "état d'aujourd'hui = 50 (valeur revalidée)");
ok(etatTachesALaDate(chaine, "2026-10-20").get("t1") === 50, "mardi : la revalidation l'emporte, une seule valeur par jour");
ok(journalT1.filter(l => l.avancement_apres === 50).length === 1, "une seule ligne pour la revalidation");

// 2e. Contexte illisible : l'enregistrement du phasage n'est JAMAIS bloqué.
r = await sauver(ouvragesAvec({ t1: 50, t2: 10 }), { source: "n'importe quoi", date: "pas une date", rapport_id: "pas un uuid" });
ok(r.ok === true, "contexte invalide : phasage enregistré");
der = (await q(`select date_realisation::text d, source, rapport_id from public.avancement_journal where tache_id = 't2' order by created_at desc limit 1`))[0];
ok(der.source === "phasage" && der.rapport_id === null && der.d === new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }),
  `valeurs par défaut (t2 n'a pas de pointage passé : aujourd'hui) — ${der.d}`);

// 2f. Un compte ouvrier ne peut pas écrire ; le journal n'est pas inscriptible directement.
await enTantQue("ouvrier@test.fr");
r = (await q(`select public.conducteur_sauvegarder_phasage_v2('${PH}', ${await rev()}, ${js(ouvragesAvec({ t1: 99 }))}, null, null) r`))[0].r;
ok(r === null, "compte ouvrier : refusé, comme avant");
await enTantQue("conducteur@test.fr");
ok(/grant select on public\.avancement_journal, public\.avancement_journal_controles to authenticated/.test(MIGRATION)
  && /revoke all on public\.avancement_journal, public\.avancement_journal_controles from authenticated, anon/.test(MIGRATION),
  "l'application ne peut que LIRE le journal");

// 2g. Variante « lot » : contexte propre à chaque entrée.
r = (await q(`select public.conducteur_sauvegarder_phasages_lot(${js([{ phasage_id: PH, revision_attendue: await rev(),
  ouvrages: ouvragesAvec({ t1: 50, t2: 10, t3: 60 }), journal: { source: "correction", date: "2026-10-21", rapport_id: RAPPORT } }])}) r`))[0].r;
ok(r.ok === true, "lot enregistré");
der = (await q(`select date_realisation::text d, source from public.avancement_journal where tache_id = 't3' order by created_at desc limit 1`))[0];
ok(der.d === "2026-10-21" && der.source === "correction", "lot : contexte de l'entrée appliqué");

// 2h. Insertion d'un phasage : journalisée (tâches non nulles, depuis 0).
await db.exec(`insert into public.phasages (chantier_id, ouvrages) values ('C2', ${js([{ id: "x", taches: [{ id: "u1", avancement: 15 }, { id: "u2", avancement: 0 }] }])})`);
const c2 = await q(`select tache_id, avancement_avant::float a from public.avancement_journal where chantier_id = 'C2'`);
ok(c2.length === 1 && c2[0].tache_id === "u1" && c2[0].a === 0, "nouveau phasage : seule la tâche non nulle, depuis 0");

// 2i. Contrôle nocturne : 0 écart, puis un chemin oublié simulé (déclencheur coupé).
let ctl = (await q(`select public.avancement_journal_reconcilier() r`))[0].r;
ok(ctl.nb_ecarts === 0, `aucun écart quand tout passe par le journal (${JSON.stringify(ctl)})`);
await db.exec(`alter table public.phasages disable trigger trg_avancement_journal;
  update public.phasages set ouvrages = ${js(ouvragesAvec({ t1: 50, t2: 10, t3: 70 }))} where id = '${PH}';
  alter table public.phasages enable trigger trg_avancement_journal;`);
ctl = (await q(`select public.avancement_journal_reconcilier() r`))[0].r;
ok(ctl.nb_ecarts === 1, "un écart compté");
der = (await q(`select source, avancement_avant::float a, avancement_apres::float b from public.avancement_journal where tache_id = 't3' order by created_at desc limit 1`))[0];
ok(der.source === "reconciliation" && der.a === 60 && der.b === 70, "ligne « reconciliation » 60 → 70");
const ctlRows = await q(`select nb_ecarts from public.avancement_journal_controles order by execute_le`);
ok(ctlRows.length === 2 && ctlRows[1].nb_ecarts === 1, "compteur consigné (affiché dans Réglages)");
ctl = (await q(`select public.avancement_journal_reconcilier() r`))[0].r;
ok(ctl.nb_ecarts === 0, "idempotent : plus d'écart au passage suivant");

// 2j. Reconstitution depuis phasages_history : SIMULATION puis application.
const db2 = new PGlite();
await db2.exec(`
  create extension if not exists plpgsql;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.email() returns text language sql stable as $$ select null::text $$;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.utilisateurs (email text, role text, actif boolean);
  create function public.est_ouvrier() returns boolean language sql stable as $$ select false $$;
  create function public.est_collaborateur_actif() returns boolean language sql stable as $$ select true $$;
  create table public.phasages (id uuid primary key default gen_random_uuid(), chantier_id text, chantier_nom text,
    ouvrages jsonb, plan_travaux jsonb, revision bigint not null default 0, updated_at timestamptz default now());
  create table public.pointages (id uuid primary key default gen_random_uuid(), chantier_id text, tache_id text, date date, heures numeric);
  create table public.phasages_history (id uuid primary key default gen_random_uuid(), phasage_id uuid, chantier_id text,
    chantier_nom text, ouvrages jsonb, plan_travaux jsonb, client_id text, prev_updated_at timestamptz, saved_at timestamptz);
`);
const q2 = async (sql) => (await db2.query(sql)).rows;
const etat = (av1, av2) => [{ id: "o", prix_ht: 1000, taches: [{ id: "r1", avancement: av1 }, ...(av2 == null ? [] : [{ id: "r2", avancement: av2 }])] }];
const [{ id: P2 }] = await q2(`insert into public.phasages (chantier_id, ouvrages, updated_at) values ('R', ${js(etat(60, 10))}, '2026-10-10T09:00:00Z') returning id`);
// États successifs : écrit le 01/09 (r1 = 0), le 03/09 (r1 = 30), le 08/10 (r1 = 60, r2 apparaît à 10).
await db2.exec(`insert into public.phasages_history (phasage_id, chantier_id, ouvrages, prev_updated_at, saved_at) values
  ('${P2}', 'R', ${js(etat(0))},  '2026-09-01T08:00:00Z', '2026-09-03T18:00:00Z'),
  ('${P2}', 'R', ${js(etat(30))}, '2026-09-03T18:00:00Z', '2026-10-10T09:00:00Z');
  insert into public.pointages (chantier_id, tache_id, date, heures) values ('R', 'r1', '2026-09-02', 8)`);
await db2.exec(MIGRATION);
const simu = (await q2(`select public.avancement_journal_reconstituer(false) r`))[0].r;
ok(simu.applique === false && simu.nb_lignes === 4, `simulation : point de départ de r1 + 3 changements (${JSON.stringify(simu)})`);
ok((await q2(`select count(*)::int n from public.avancement_journal where source = 'reconstitution'`))[0].n === 0, "simulation : rien n'est écrit");
const app = (await q2(`select public.avancement_journal_reconstituer(true) r`))[0].r;
ok(app.applique === true && app.nb_lignes === 4, "application : 4 lignes");
const reco = await q2(`select tache_id, avancement_avant::float a, avancement_apres::float b, date_realisation::text d, created_at::text c, source from public.avancement_journal order by created_at, tache_id`);
const lr = reco.filter(x => x.source === "reconstitution");
ok(lr[0].tache_id === "r1" && lr[0].a === null && lr[0].b === 0 && lr[0].d === "2026-09-01", "r1 : point de départ au premier état connu (avant inconnu → 0 %)");
ok(lr.some(x => x.tache_id === "r1" && x.a === 0 && x.b === 30 && x.d === "2026-09-02"), "r1 0 → 30, daté du dernier pointage avant l'écriture (02/09)");
ok(lr.some(x => x.tache_id === "r1" && x.a === 30 && x.b === 60 && x.d === "2026-09-02"), "r1 30 → 60 : même règle, dernier jour pointé avant l'écriture");
ok(lr.some(x => x.tache_id === "r2" && x.a === 0 && x.b === 10 && x.d === "2026-10-10"), "r2 apparue en cours de route : depuis 0, jamais pointée → jour de l'écriture");
ok(reco.filter(x => x.source === "initial").every(i => lr.every(x => x.c < i.c)), "les lignes reconstituées sont écrites AVANT les lignes initiales");
const journalReco = reco.map(x => ({ tache_id: x.tache_id, avancement_avant: x.a, avancement_apres: x.b, date_realisation: x.d, created_at: x.c }));
ok(etatTachesALaDate(journalReco, "2026-09-01").get("r1") === 0, "après reconstitution, l'état du 01/09 est connu (0 %)");
ok(etatTachesALaDate(journalReco, "2026-08-31").get("r1") === null, "avant le premier état connu : inconnu, jamais 0");
ok(etatTachesALaDate(journalReco, "2026-09-02").get("r1") === 60, "et celui du 02/09, dernier jour pointé (60 %)");
ok((await q2(`select public.avancement_journal_reconstituer(true) r`))[0].r.code === "deja_reconstitue", "jamais deux fois");

// ── 3. GARDES SUR LE CODE ───────────────────────────────────────────────────
{
  const val = lire("src/Renovation/Validation.jsx");
  ok(/source: "validation_cr", date: frToISO\(rapport\.date_rapport\), rapport_id: rapport\.id/.test(val), "validation : datée du jour du rapport");
  ok(/sauvegarderCR\(\{\s*phasageId: phV2\.id/.test(val), "validation : l'avancement par ouvrage passe le contexte");
  ok(/source: "correction", date: frToISO\(rapport\.date_rapport\)/.test(val), "« Corriger » : source correction");
  const pe = lire("src/Renovation/phasageEcriture.mjs");
  ok(/p_journal: journal/.test(pe), "écriture partagée : contexte transmis");
  const ph = lire("src/Renovation/PhasageV2.jsx");
  ok(/p_journal: \{ source: "phasage", dates:/.test(ph), "phasage : dates de réalisation envoyées");
  ok(/réalisé le/.test(ph) && /dateAvancementDefaut/.test(ph), "phasage : date préremplie et modifiable");
  const bil = lire("src/Renovation/BilanSemaine.jsx");
  ok(/productionPeriode\(/.test(bil) && /journal: p\.journal/.test(bil), "Bilan : « Généré » et marge de la semaine par la même production");
  ok(/job=journal_avancement/.test(lire(".github/workflows/cron-journal-avancement.yml")), "contrôle nocturne planifié");
  ok(/journal_avancement:/.test(lire("api/cron-dispatcher.js")), "tâche du dispatcher");
  ok(/<ControleJournalAvancement/.test(lire("src/Renovation/Admin.jsx")), "compteur visible dans Réglages");
  const mod = lire("src/chantierFinance.mjs");
  ok(!/new Date\s*\(|Date\.now\s*\(/.test(mod), "module sans horloge");
  ok(/export function avancementOuvrage\(ouvrage\) \{[\s\S]{0,400}Math\.round/.test(mod), "avancementOuvrage garde son arrondi");
}

console.log(`verif-journal-avancement : ${nb} contrôles OK (données fictives)`);
