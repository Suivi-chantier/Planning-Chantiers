#!/usr/bin/env node
// Vérifie la bêta « Mes phases » de l'espace ouvrier (étape 1, lecture seule) :
//   - sql/202610_ouvrier_mes_phases.sql, exécuté dans un vrai PostgreSQL
//     (PGlite, en mémoire) sur une réplique MINIMALE des tables lues
//     (utilisateurs, planning_config, phasages, pointages, rapports,
//     planning_cells) et des helpers de rôle de production (mon_role,
//     est_ouvrier, mon_prenom_planning, norm_prenom) ;
//   - src/Renovation/mesPhasesV1.mjs (module pur de l'écran), branché sur le
//     payload RÉEL de la RPC ci-dessus.
//
// DONNÉES : toutes FICTIVES, écrites ici (chantier « Chantier Test », ouvriers
// Paul, Davy, Marc, Hamed…). Aucune donnée de production.
//
// Contrôles :
//   1. sécurité : aucune clé financière dans le payload (contrôle récursif),
//      ouvrier non bêta refusé, profil absent / inactif → NULL, anon refusé,
//      helper interne _beta_autorise inexécutable par l'API, p_prenom ignoré
//      pour un ouvrier et honoré pour le bureau (aperçu) ;
//   2. données : heures vendues / validées / en attente / miennes par tâche,
//      affectation « est_mienne » (planning prioritaire, jamais une occurrence
//      future, repli phasage), « À organiser », hors devis, modèles absent /
//      ambigu / legacy_v1 ;
//   3. même chiffre que chantierFinance : heures validées = tacheHeuresReelles,
//      avancement d'ouvrage = avancementOuvrage, de phase = statsGroupeChrono ;
//   4. module : pastilles et seuils existants (1 et SEUIL_RATIO_DERIVE),
//      « Mes phases (n) / Tout le chantier (n) », phase en cours, « Ensuite »,
//      chantier proposé par défaut ;
//   5. le fichier SQL ne redéfinit ni ouvrier_preparation_chantier ni aucune
//      policy, et se rejoue sans erreur.
//
//   npm install --no-save --no-package-lock @electric-sql/pglite@0.5.8   (une fois)
//   node scripts/verif-ouvrier-mes-phases.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  construireMesPhases, filtrerPhases, etatHeures, ratioDerive, dateCellule,
  choisirChantierParDefaut, libellePersonnes, statutDesTaches,
} from "../src/Renovation/mesPhasesV1.mjs";
import {
  indexPointagesParTache, tacheHeuresReelles, avancementOuvrage, statsGroupeChrono, SEUIL_RATIO_DERIVE,
} from "../src/chantierFinance.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION = readFileSync(join(racine, "sql/202610_ouvrier_mes_phases.sql"), "utf8");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");

let nbOk = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); nbOk++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };
const proche = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-6, `${msg} (obtenu ${a}, attendu ${b})`); nbOk++; };

// ── 0. Le fichier SQL ne touche à rien d'existant ───────────────────────────
ok(!/function\s+public\.ouvrier_preparation_chantier/i.test(MIGRATION), "ouvrier_preparation_chantier n'est pas redéfinie");
ok(!/function\s+public\.ouvrier_taches_actives/i.test(MIGRATION), "ouvrier_taches_actives n'est pas redéfinie");
ok(!/create\s+policy|drop\s+policy|alter\s+policy/i.test(MIGRATION), "aucune policy touchée (listes blanches intactes)");
ok(!/\binsert\s+into|\bupdate\s+public\.|\bdelete\s+from/i.test(MIGRATION), "aucune écriture de données");
ok(!/to_jsonb\(\s*(o|t|ouv|tache|ph)\s*\)/i.test(MIGRATION), "aucune recopie d'objet source dans le payload");

// ── 1. Réplique minimale ────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(`
  create extension if not exists plpgsql;
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.email() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'email' $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.email() to anon, authenticated;

  create table public.utilisateurs (email text, role text, actif boolean, prenom_planning text);
  create table public.planning_config (key text primary key, value jsonb);
  create table public.phasages (id uuid primary key default gen_random_uuid(), chantier_id text, chantier_nom text, ouvrages jsonb, plan_travaux jsonb);
  create table public.pointages (id uuid primary key default gen_random_uuid(), chantier_id text, tache_id text, ouvrier text, date date, heures numeric, taux_horaire numeric, rapport_id uuid, type_pointage text);
  create table public.rapports (id uuid primary key, ouvrier text, chantier_id text, date_rapport text, taches jsonb, statut text);
  create table public.planning_cells (week_id text, jour text, chantier_id text, ouvriers text[], taches jsonb);
  alter table public.phasages enable row level security;
  alter table public.pointages enable row level security;
  alter table public.rapports enable row level security;
  alter table public.planning_config enable row level security;
  alter table public.planning_cells enable row level security;

  -- Helpers : définitions de PRODUCTION (relevées le 05/10/2026).
  create function public.mon_role() returns text language sql stable security definer set search_path = public as $$
    select u.role from public.utilisateurs u where u.email = auth.email() and u.actif is true limit 1; $$;
  create function public.est_ouvrier() returns boolean language sql stable security definer set search_path = public as $$
    select public.mon_role() = 'ouvrier'; $$;
  create function public.mon_prenom_planning() returns text language sql stable security definer set search_path = public as $$
    select prenom_planning from public.utilisateurs where email = auth.email() limit 1; $$;
  -- norm_prenom : en production lower(regexp_replace(trim(unaccent(t)), '\\s+', ' ', 'g')).
  -- unaccent n'existe pas dans PGlite : translate() des accents utiles au test.
  create function public.norm_prenom(t text) returns text language sql stable as $$
    select lower(regexp_replace(trim(translate(coalesce(t, ''), 'ÉÈÊËéèêëÏÎïîÇç', 'EEEEeeeeIIiiCc')), '\\s+', ' ', 'g')); $$;
`);

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const js = (v) => `${lit(JSON.stringify(v))}::jsonb`;

await db.exec(`
  insert into public.utilisateurs values
    ('paul@test.fr',   'ouvrier',    true,  'Paul'),
    ('marc@test.fr',   'ouvrier',    true,  'Marc'),
    ('ines@test.fr',   'ouvrier',    false, 'Inès'),
    ('bureau@test.fr', 'conducteur', true,  null);
  insert into public.planning_config values
    ('chantiers', ${js([
      { id: "ch1", nom: "Chantier Test" }, { id: "ch2", nom: "Sans phasage" },
      { id: "ch3", nom: "Homonyme" }, { id: "ch4", nom: "Ancien modèle" }, { id: "ch5", nom: "Sans groupes" },
    ])}),
    -- « PAUL » avec espaces et casse différente : la comparaison normalise.
    ('fonctionnalites_beta', ${js({ mes_phases: ["  PAUL ", "Ines"], compte_rendu_v2: ["Marc"] })});
`);

// Phasage du chantier test — porte VOLONTAIREMENT des champs financiers
// (prix_ht, cout_materiaux, ratio) : ils ne doivent jamais sortir.
const T = (id, nom, g, hv, he, av, ouvriers, extra = {}) => ({
  id, nom, chrono_groupe_id: g, heures_vendues: hv, heures_estimees: he, avancement: av, ouvriers,
  prix_ht: 999, ratio: 1.2, ...extra,
});
const OUVRAGES = [
  { id: "o1", libelle: "Doublage murs", quantite: 85, unite: "m²", heures_devis: 40, prix_ht: 5000, cout_materiaux: 800,
    taches: [
      T("t1", "Ossature", "g1", 14, 14, 100, ["Paul", "Davy"], { chrono_ordre: 1, date_prevue: "2026-10-01" }),
      T("t2", "Plaques", "g1", 16, 16, 50, ["Davy"], { chrono_ordre: 2, date_prevue: "2026-10-05" }),
      T("t3", "Bandes", "g1", 6, 6, 0, ["Hamed"], { chrono_ordre: 3, date_prevue: "2026-10-08" }),
    ] },
  { id: "o2", libelle: "Électricité", heures_devis: 30, prix_ht: 3000,
    taches: [
      T("t4", "Saignées", "g1", 8, 8, 50, ["Marc"], { date_prevue: "2026-10-02" }),
      T("t5", "Tirage câbles", "g2", 12, 12, 0, ["Marc"], { date_prevue: "2026-10-12" }),
      T("t8", "Appareillage", "g2", 10, 10, 20, ["Marc"], { date_prevue: "2026-10-14" }),
    ] },
  { id: "o3", libelle: "Divers / hors devis", heures_devis: 0,
    taches: [T("t6", "Reprise imprévue", null, 0, null, 0, [], { heures_reelles: [1, 2] })] },
  { id: "o4", libelle: "Ouvrage vendu en bloc", heures_devis: 10,
    taches: [T("t7", "Pose", "g2", 0, null, 20, ["Marc"])] },
];
const PLAN = { meta: { chrono_groupes: [
  { id: "g2", nom: "Électricité second œuvre", ordre: 20, couleur: "#3b82f6" },
  { id: "g1", nom: "Cloisons & doublage", ordre: 10, couleur: "#f59e0b" },
] } };

const R_ATT_PAUL = "00000000-0000-0000-0000-0000000000a1";
const R_ATT_DAVY = "00000000-0000-0000-0000-0000000000a2";
const R_VALIDE   = "00000000-0000-0000-0000-0000000000a3";
const R_DEVALIDE = "00000000-0000-0000-0000-0000000000a4";
const R_ATT_MARC = "00000000-0000-0000-0000-0000000000a5";
const POINTAGES = [
  { tache_id: "t1", ouvrier: "Paul",  heures: 7, type_pointage: "tache" },
  { tache_id: "t1", ouvrier: "Davy",  heures: 7, type_pointage: "tache" },
  { tache_id: "t1", ouvrier: "Paul",  heures: 2, type_pointage: "indirect" },     // exclu : indirect
  { tache_id: "t2", ouvrier: "Paul",  heures: 5, type_pointage: "tache" },
  { tache_id: "t2", ouvrier: "Davy",  heures: 4, type_pointage: "tache" },
  { tache_id: "t3", ouvrier: "Hamed", heures: 2, type_pointage: "tache", rapport_id: R_DEVALIDE },
  { tache_id: "t4", ouvrier: "Marc",  heures: 6, type_pointage: "tache" },
  { tache_id: "t8", ouvrier: "Marc",  heures: 4, type_pointage: "tache" },
];
await db.exec(`
  insert into public.phasages (chantier_id, chantier_nom, ouvrages, plan_travaux) values
    ('ch1', 'Chantier Test', ${js(OUVRAGES)}, ${js(PLAN)}),
    (null, 'Homonyme', ${js([{ id: "x", libelle: "x", taches: [] }])}, '{}'::jsonb),
    (null, 'Homonyme', ${js([{ id: "y", libelle: "y", taches: [] }])}, '{}'::jsonb),
    ('ch4', 'Ancien modèle', '[]'::jsonb, ${js({ meta: {}, demolition: [{ id: "v1", nom: "Vieille" }] })}),
    ('ch5', 'Sans groupes', ${js([{ id: "z", libelle: "Z", heures_devis: 4, taches: [{ id: "tz", nom: "Seule", heures_vendues: 4, avancement: 10 }] }])}, '{}'::jsonb);
  insert into public.pointages (chantier_id, tache_id, ouvrier, heures, taux_horaire, type_pointage, rapport_id) values
    ${POINTAGES.map(p => `('ch1', ${lit(p.tache_id)}, ${lit(p.ouvrier)}, ${p.heures}, 30, ${lit(p.type_pointage)}, ${p.rapport_id ? lit(p.rapport_id) : "null"})`).join(",\n    ")},
    ('ch9', 't1', 'Paul', 3, 30, 'tache', null);  -- autre chantier : exclu
  insert into public.rapports (id, ouvrier, chantier_id, date_rapport, statut, taches) values
    (${lit(R_ATT_PAUL)}, 'Paul', 'ch1', '2026-10-05', 'en_attente',
       ${js([{ tache_id: "t2", heures_reelles: 3 }, { tache_id: null, heures_reelles: 4 }])}),
    (${lit(R_ATT_DAVY)}, 'Davy', 'ch1', '2026-10-05', null, ${js([{ tache_id: "t2", heures_reelles: "1" }])}),
    (${lit(R_VALIDE)},   'Paul', 'ch1', '2026-10-02', 'valide', ${js([{ tache_id: "t1", heures_reelles: 5 }])}),
    (${lit(R_DEVALIDE)}, 'Hamed','ch1', '2026-10-03', 'en_attente', ${js([{ tache_id: "t3", heures_reelles: 2 }])}),
    (${lit(R_ATT_MARC)}, 'Marc', 'ch1', '2026-10-05', 'en_attente', ${js([{ tache_id: "t4", heures_reelles: 3 }])});
  insert into public.planning_cells values
    -- 2026-W41 Lundi = 05/10 : la ligne t2 porte Paul + Davy (prioritaire sur le phasage).
    ('2026-W41', 'Lundi', 'ch1', array['Davy'], ${js([{ tache_id: "t2", text: "Plaques", ouvriers: ["Paul", "Davy"] }])}),
    -- Occurrence FUTURE (12/10) qui met Paul sur t3 : doit être ignorée.
    ('2026-W42', 'Lundi', 'ch1', array['Paul'], ${js([{ tache_id: "t3", text: "Bandes", ouvriers: ["Paul"] }])}),
    -- Ligne sans ouvriers : on prend la cellule (Paul) — prioritaire sur le phasage (Marc).
    ('2026-W40', 'Mardi', 'ch1', array['Paul'], ${js([{ tache_id: "t5", text: "Câbles", ouvriers: [] }])});
`);

// Applique la migration DEUX fois : elle doit être rejouable.
await db.exec(MIGRATION);
await db.exec(MIGRATION);
nbOk++;

// ── Appel sous une identité (transaction annulée) ───────────────────────────
async function appel(email, sql, role = "authenticated") {
  let out;
  try {
    await db.transaction(async (tx) => {
      const claims = email ? { role, email } : { role };
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.query(`select set_config('role', $1, true)`, [role]);
      const r = await tx.query(sql);
      out = { val: r.rows[0]?.v ?? null };
      throw new Error("__annuler__");
    });
  } catch (e) {
    if (e.message !== "__annuler__") out = { erreur: e.message };
  }
  return out;
}
const RPC = (args) => `select public.ouvrier_mes_phases(${args}) as v`;

// ── 2. Sécurité ─────────────────────────────────────────────────────────────
const paul = (await appel("paul@test.fr", RPC(`'ch1', 'Marc', '2026-10-05'`))).val;
ok(paul && paul.modele === "v2", "Paul (bêta) reçoit le phasage v2");
eq(paul.prenom, "Paul", "p_prenom ignoré pour un ouvrier : toujours SON prénom");

const cles = new Set();
(function parcours(v) {
  if (Array.isArray(v)) v.forEach(parcours);
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => { cles.add(k); parcours(x); });
})(paul);
const interdites = [...cles].filter(k => /prix|cout|coût|marge|taux|coefficient|ratio|montant|euro|fournisseur|fg_/i.test(k));
eq(interdites, [], `aucune clé financière dans le payload (clés : ${[...cles].sort().join(", ")})`);
ok(!/"prix|"cout|5000|1\.2\b/.test(JSON.stringify(paul)), "aucune valeur financière recopiée (prix 5000, ratio 1,2)");

const marc = (await appel("marc@test.fr", RPC(`'ch1'`))).val;
eq(marc, { chantier_id: "ch1", acces_refuse: true }, "ouvrier hors bêta : refusé côté serveur, rien d'autre");
eq((await appel("ines@test.fr", RPC(`'ch1'`))).val, null, "ouvrier inactif (même listé bêta) → NULL");
eq((await appel("inconnu@test.fr", RPC(`'ch1'`))).val, null, "profil absent → NULL");
ok(/permission denied/i.test((await appel(null, RPC(`'ch1'`), "anon")).erreur || ""), "anon → permission refusée");
ok(/permission denied/i.test((await appel("paul@test.fr", `select public._beta_autorise('mes_phases','Paul') as v`)).erreur || ""),
  "_beta_autorise n'est pas exécutable par l'API");

const betaPaul = (await appel("paul@test.fr", `select public.mes_fonctionnalites_beta('Marc') as v`)).val;
eq(betaPaul, ["mes_phases"], "Paul lit SES codes bêta (p_prenom ignoré), jamais ceux des autres");
eq((await appel("marc@test.fr", `select public.mes_fonctionnalites_beta() as v`)).val, ["compte_rendu_v2"], "Marc : son seul code");
eq((await appel("bureau@test.fr", `select public.mes_fonctionnalites_beta('Paul') as v`)).val, ["mes_phases"], "bureau : aperçu de Paul");
eq((await appel("bureau@test.fr", `select public.mes_fonctionnalites_beta() as v`)).val, [], "bureau sans prénom : aucun code");
eq((await appel("ines@test.fr", `select public.mes_fonctionnalites_beta() as v`)).val, [], "inactif : aucun code");
ok(/permission denied/i.test((await appel(null, `select public.mes_fonctionnalites_beta('Paul') as v`, "anon")).erreur || ""), "anon : mes_fonctionnalites_beta refusée");

const bureauMarc = (await appel("bureau@test.fr", RPC(`'ch1', 'Marc', '2026-10-05'`))).val;
eq(bureauMarc.prenom, "Marc", "bureau : p_prenom honoré (aperçu)");

// ── 3. Données ──────────────────────────────────────────────────────────────
eq(paul.phases.map(p => p.nom), ["Cloisons & doublage", "Électricité second œuvre", "À organiser"], "phases dans l'ordre chrono, « À organiser » en dernier");
const taches = Object.fromEntries(paul.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).map(t => [t.id, t]));
eq(Object.keys(taches).sort(), ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"], "aucune tâche perdue ni dupliquée");

const attendu = {
  //     vendues validées attente mes   mienne
  t1: [14, 14, 0, 7, true],   // pointages Paul 7 + Davy 7 ; indirect et autre chantier exclus ; rapport validé ignoré
  t2: [16, 9, 4, 8, true],    // registre 5+4 ; attente Paul 3 + Davy 1 ; mes = 5 + 3 ; planning ligne → Paul
  t3: [6, 2, 0, 0, false],    // rapport dévalidé déjà au registre : jamais compté deux fois ; occurrence future ignorée
  t4: [8, 6, 3, 0, false],
  t5: [12, 0, 0, 0, true],    // cellule (Paul) prioritaire sur le phasage (Marc)
  t6: [0, 3, 0, 0, false],    // ancien suivi heures_reelles [1,2], aucun pointage
  t7: [0, 0, 0, 0, false],
  t8: [10, 4, 0, 0, false],
};
for (const [id, [hv, hval, hatt, mes, mienne]] of Object.entries(attendu)) {
  const t = taches[id];
  eq([t.heures_vendues, t.heures_validees, t.heures_en_attente, t.mes_heures, t.est_mienne].map(x => typeof x === "string" ? +x : x),
    [hv, hval, hatt, mes, mienne], `tâche ${id} : vendues / validées / attente / miennes / est_mienne`);
}
eq(taches.t2.ouvriers, ["Paul", "Davy"], "t2 : équipe du planning (ligne)");
eq(taches.t1.ouvriers, ["Paul", "Davy"], "t1 : repli sur le phasage (aucune occurrence planning)");
eq(taches.t6.heures_validees_source, "ancien_suivi", "t6 : heures de l'ancien suivi signalées comme telles");
eq([taches.t6.hors_devis, taches.t7.hors_devis, taches.t1.hors_devis], [true, false, false], "hors devis : t6 oui ; t7 non (l'ouvrage porte les heures)");
eq(taches.t6.phase_id, "_a_organiser", "tâche sans groupe → « À organiser »");
eq(taches.t3.date_prevue, "2026-10-08", "date prévue au format ISO");
eq(bureauMarc.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).filter(t => t.est_mienne).map(t => t.id).sort(),
  ["t4", "t7", "t8"], "aperçu de Marc : ses tâches (t5 est passée à Paul par le planning)");

const o2g1 = paul.phases[0].ouvrages.find(o => o.id === "o2");
const o1 = paul.phases[0].ouvrages.find(o => o.id === "o1");
eq([o1.ouvrage_complet, o2g1.ouvrage_complet], [true, false], "ouvrage complet / réparti sur plusieurs phases");
eq(+o1.heures_vendues_ouvrage, 40, "heures vendues de l'ouvrage = heures_devis (fiche chantier)");

// Modèles
const modele = async (ch) => (await appel("paul@test.fr", RPC(`'${ch}'`))).val.modele;
eq(await modele("ch2"), "absent", "chantier sans phasage");
eq(await modele("ch3"), "ambigu", "phasages homonymes : on ne choisit pas");
eq(await modele("ch4"), "legacy_v1", "ancien modèle : rien n'est converti");

// ── 3 bis. Même chiffre que chantierFinance ─────────────────────────────────
const ppt = indexPointagesParTache(POINTAGES.map(p => ({ ...p })));
for (const o of OUVRAGES) for (const t of o.taches) {
  proche(+taches[t.id].heures_validees, tacheHeuresReelles(t, ppt), `tâche ${t.id} : heures validées = tacheHeuresReelles`);
}

// ── 4. Module de l'écran, sur le payload réel ───────────────────────────────
const r = construireMesPhases(paul);
eq(r.etat, "ok", "état ok");
eq([r.nbMiennes, r.nbTout], [2, 3], "Mes phases (2) / Tout le chantier (3)");
eq(filtrerPhases(r, "miennes").map(p => p.id), ["g1", "g2"], "filtre « Mes phases »");
eq(r.phaseEnCoursId, "g1", "phase en cours = première phase en cours");
eq(r.phases[0].suivante, { id: "g2", nom: "Électricité second œuvre" }, "« Ensuite » : phase suivante");
eq(r.phases[1].suivante, null, "dernière phase réelle : pas de suite (« À organiser » n'en est pas une)");

const g1 = r.phases[0];
eq([g1.vendues, g1.validees, g1.attente], [48, 31, 7], "phase 1 : 40 (ouvrage complet, heures_devis) + 8 (part de l'ouvrage réparti)");
eq(g1.avancement, statsGroupeChrono("g1", OUVRAGES).avancement, "avancement de phase = statsGroupeChrono");
eq(g1.avancement, 59, "avancement de phase pondéré heures vendues (2600 / 44)");
eq([g1.dateMin, g1.dateMax], ["2026-10-01", "2026-10-08"], "dates min – max de la phase");
eq(g1.statut, "en_cours", "statut de phase");
const ag1 = g1.ouvrages.find(o => o.id === "o1");
eq(ag1.avancement, avancementOuvrage(OUVRAGES[0]), "avancement d'ouvrage complet = avancementOuvrage");
const g2 = r.phases[1];
eq(g2.ouvrages.find(o => o.id === "o4").vendues, 10, "ouvrage vendu en bloc : heures au niveau de l'ouvrage");
eq(g2.vendues, 32, "phase 2 : 12 + 10 (part de o2) + 10 (o4)");

const e = (id) => r.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).find(t => t.id === id).etat;
eq(e("t1").code, "dans_le_temps", "t1 : ratio 1,00 → dans le temps");
eq(e("t2").code, "a_surveiller", "t2 : ratio 1,125 → à surveiller");
eq(e("t3").code, "sans_avancement", "t3 : heures posées, avancement 0 → dérive incalculable, dit tel quel");
eq([e("t4").code, e("t4").label], ["depasse", "Dépassé +1 h"], "t4 : 6 validées + 3 en attente > 8 vendues");
eq(e("t5").code, "a_venir", "t5 : 0 h et 0 %");
eq(e("t6").code, "hors_devis", "t6 : hors devis, sans jauge");
eq([e("t7").code, e("t7").label, e("t7").jauge], ["sans_jauge", "Heures vendues sur l'ouvrage", false], "t7 : pas de répartition inventée");
eq(e("t8").code, "derive", "t8 : ratio 2,00 → dérive");
const t2 = r.phases[0].ouvrages[0].taches.find(t => t.id === "t2");
eq([t2.reste, t2.miennes, t2.consommees], [3, 8, 13], "t2 : reste 3 h, dont toi 8 h");
eq(r.phases[0].ouvrages[0].taches.find(t => t.id === "t1").reste, null, "t1 terminée : pas de « reste »");

// Seuils : ceux de chantierFinance, pas de nouveaux.
eq(SEUIL_RATIO_DERIVE, 1.15, "seuil de dérive de chantierFinance");
eq(etatHeures({ vendues: 10, validees: 5, attente: 0, avancement: 50 }).code, "dans_le_temps", "ratio 1 → dans le temps");
eq(etatHeures({ vendues: 100, validees: 57.5, attente: 0, avancement: 50 }).code, "a_surveiller", "ratio 1,15 → à surveiller");
eq(etatHeures({ vendues: 100, validees: 58, attente: 0, avancement: 50 }).code, "derive", "ratio 1,16 → dérive");
eq(ratioDerive(5, 0, 50), null, "ratio indéterminé sans heures vendues");
eq(statutDesTaches([]), "vide", "liste vide : « Aucune tâche », pas « À venir »");

// États
eq(construireMesPhases((await appel("paul@test.fr", RPC(`'ch5'`))).val).etat, "sans_groupes", "phasage sans groupes : tout dans « À organiser »");
eq(construireMesPhases(marc).etat, "acces_refuse", "accès refusé visible comme tel");
eq(construireMesPhases(null).etat, "absent", "pas de payload");

// Chantier par défaut, dates de cellule, libellés
eq(dateCellule("2026-W41", "Lundi"), "2026-10-05", "2026-W41 lundi");
eq(dateCellule("2026-W01", "Lundi"), "2025-12-29", "semaine ISO 1 à cheval sur l'année");
eq(dateCellule("2026-W53", "Lundi") !== null, true, "format accepté");
eq(dateCellule("n'importe", "Lundi"), null, "week_id invalide");
const cellules = [
  { week_id: "2026-W40", jour: "Mardi", chantier_id: "chA", ouvriers: ["Paul"], taches: [] },
  { week_id: "2026-W41", jour: "Lundi", chantier_id: "chB", ouvriers: [], taches: [{ ouvriers: ["Paul"] }] },
  { week_id: "2026-W41", jour: "Mardi", chantier_id: "chC", ouvriers: ["Paul"], taches: [] },
  { week_id: "2026-W41", jour: "Lundi", chantier_id: "chD", ouvriers: ["Davy"], taches: [] },
];
eq(choisirChantierParDefaut({ cellules, prenom: "Paul", aujourdhuiISO: "2026-10-05" }), "chB", "planifié aujourd'hui (via une ligne)");
eq(choisirChantierParDefaut({ cellules, prenom: "Paul", aujourdhuiISO: "2026-10-04" }), "chA", "sinon la dernière journée passée");
eq(choisirChantierParDefaut({ cellules, prenom: "Marc", aujourdhuiISO: "2026-10-05" }), null, "jamais planifié → null");
eq(libellePersonnes(["Davy", "Paul"], "Paul"), "Toi, Davy", "« Toi » en premier");

await db.close();
console.log(`verif-ouvrier-mes-phases : ${nbOk} contrôles OK`);
