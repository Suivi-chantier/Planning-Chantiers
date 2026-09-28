// ─────────────────────────────────────────────────────────────────────────────
// Vérification des scripts SQL « historique + restauration de la bibliothèque »
//
//   supabase/migrations/20260924130000_data_history_planning_cells_bibliotheque.sql
//   sql/202609_restauration_bibliotheque_14-09.sql
//   sql/202609_restauration_bibliotheque_14-09_annulation.sql
//
// DONNÉES FICTIVES. Aucune connexion à la base réelle : les scripts sont joués
// dans un Postgres en mémoire (PGlite), sur une copie de la structure de
// bibliotheque_ratios relevée en base le 24/09/2026 (colonnes, contraintes et
// les trois gardes, recopiées mot pour mot). Les 59 identifiants sont ceux du
// script ; les libellés, cadences et chantiers sont inventés.
//
// Prérequis (non inscrit dans package.json, pour ne pas toucher l'application) :
//   npm install --no-save @electric-sql/pglite@0.3
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const lire = p => fs.readFileSync(`${REPO}/${p}`, "utf8");
const MIGRATION = lire("supabase/migrations/20260924130000_data_history_planning_cells_bibliotheque.sql");
const RESTAURE = lire("sql/202609_restauration_bibliotheque_14-09.sql");
const ANNULE = lire("sql/202609_restauration_bibliotheque_14-09_annulation.sql");
const SOCLE = lire("sql/202606_data_history_filet_securite.sql");

const ids = [...RESTAURE.slice(RESTAURE.indexOf("ids constant text[]"), RESTAURE.indexOf("introuvables constant")).matchAll(/'([0-9a-f-]{36})'/g)].map(m => m[1]);
const introuvables = ["0753c8ad-6721-4cbe-9486-dd47a3856ff7","3c98148e-c0e4-4841-8104-720987ae5f82","64ed05c5-71cc-4645-a631-62795ceda7a4","8e1cba47-7514-491d-94c7-3371b39bc560"];
const AUTEUR = "Codex — nettoyage bibliothèque hors Ouvrages V2 ou sans code (2026-09-14)";

let notices = [];
async function nouvelleBase() {
  const db = new PGlite();
  // PGlite n'a pas les rôles Supabase : on neutralise le bloc RLS du socle (policies) sans toucher la fonction.
  await db.exec(`create role anon; create role authenticated;`);
  await db.exec(SOCLE);
  await db.exec(`
    create table public.coefficients_vente (id uuid primary key default gen_random_uuid(), libelle text, valeur numeric, est_defaut boolean not null default false, actif boolean not null default true);
    create table public.taux_horaires_vente (id uuid primary key default gen_random_uuid(), libelle text, taux_ht numeric, est_defaut boolean not null default false, actif boolean not null default true);
    insert into coefficients_vente (libelle, valeur, est_defaut) values ('Coefficient standard', 1.5, true), ('Coeff 90%', 1.9, false);
    insert into taux_horaires_vente (libelle, taux_ht, est_defaut) values ('MO investisseur', 80, true), ('MO particulier', 90, false);

    -- Structure recopiée de la base (colonnes, contraintes, gardes) le 24/09
    create table public.bibliotheque_ratios (
      id uuid primary key default gen_random_uuid(), identifiant text not null, libelle text not null, unite text,
      sous_taches jsonb not null default '[]'::jsonb, updated_at timestamptz default now(), cadence double precision,
      materiaux_liens jsonb default '[]'::jsonb, taux_marge_pct numeric, main_oeuvre_seule boolean not null default false,
      cout_direct_unitaire numeric, progbat_id text, progbat_sync_at timestamptz, coef_vente numeric,
      taux_horaire_vente_id uuid references taux_horaires_vente(id) on delete restrict,
      coefficient_vente_id uuid references coefficients_vente(id) on delete restrict,
      cadence_source text, cadence_imported_at timestamptz, cadence_import_run_id uuid,
      coefficient_vente_valeur numeric not null, taux_horaire_vente_valeur numeric not null,
      constraint bibliotheque_ratios_cadence_source_check check (cadence_source is null or cadence_source in ('profero','progbat_import')),
      constraint bibliotheque_ratios_coef_vente_check check (coef_vente is null or coef_vente >= 1),
      constraint bibliotheque_ratios_cout_direct_check check (cout_direct_unitaire is null or cout_direct_unitaire >= 0),
      constraint bibliotheque_ratios_taux_marge_pct_check check (taux_marge_pct is null or (taux_marge_pct >= 0 and taux_marge_pct < 100)),
      constraint bibliotheque_ratios_valeurs_vente_positives_check check (coefficient_vente_valeur > 0 and taux_horaire_vente_valeur > 0)
    );
    create function public.bibliotheque_ratios_cadence_provenance() returns trigger language plpgsql set search_path to 'public' as $f$
    begin
      if coalesce(current_setting('profero.cadence_import', true), '') = 'on' then return new; end if;
      if tg_op = 'INSERT' then
        if new.cadence is not null and new.cadence_source is null then new.cadence_source := 'profero'; end if;
        return new;
      end if;
      if new.cadence is distinct from old.cadence then new.cadence_source := 'profero'; end if;
      return new;
    end $f$;
    create function public.bibliotheque_ratios_colonnes_obsoletes_garde() returns trigger language plpgsql set search_path to 'public' as $f$
    begin
      if tg_op = 'INSERT' then
        if new.coef_vente is not null or new.taux_marge_pct is not null then
          raise exception 'Colonnes obsolètes : le coefficient se choisit via coefficient_vente_id (coef_vente / taux_marge_pct ne sont plus enregistrés).';
        end if;
      elsif new.coef_vente is distinct from old.coef_vente or new.taux_marge_pct is distinct from old.taux_marge_pct then
        raise exception 'Colonnes obsolètes : coef_vente et taux_marge_pct ne sont plus modifiables, utiliser coefficient_vente_id.';
      end if;
      return new;
    end; $f$;
    create function public.bibliotheque_ratios_valeurs_vente_garde() returns trigger language plpgsql security definer set search_path to 'public' as $f$
    begin
      if new.coefficient_vente_valeur is null then
        select c.valeur into new.coefficient_vente_valeur from public.coefficients_vente c where c.est_defaut and c.actif limit 1;
        if new.coefficient_vente_valeur is null then raise exception 'Coefficient de vente obligatoire : saisir une valeur sur la fiche de l''ouvrage.'; end if;
      end if;
      if new.taux_horaire_vente_valeur is null then
        select t.taux_ht into new.taux_horaire_vente_valeur from public.taux_horaires_vente t where t.est_defaut and t.actif limit 1;
        if new.taux_horaire_vente_valeur is null then raise exception 'Taux horaire de main-d''œuvre obligatoire : saisir une valeur sur la fiche de l''ouvrage.'; end if;
      end if;
      if new.coefficient_vente_valeur <= 0 then raise exception 'Coefficient de vente invalide (nul ou négatif) : %.', new.coefficient_vente_valeur; end if;
      if new.taux_horaire_vente_valeur <= 0 then raise exception 'Taux horaire de main-d''œuvre invalide (nul ou négatif) : %.', new.taux_horaire_vente_valeur; end if;
      return new;
    end; $f$;
    create trigger bibliotheque_ratios_cadence_provenance before insert or update of cadence on public.bibliotheque_ratios for each row execute function bibliotheque_ratios_cadence_provenance();
    create trigger bibliotheque_ratios_colonnes_obsoletes_garde_trg before insert or update of coef_vente, taux_marge_pct on public.bibliotheque_ratios for each row execute function bibliotheque_ratios_colonnes_obsoletes_garde();
    create trigger bibliotheque_ratios_valeurs_vente_garde_trg before insert or update of coefficient_vente_valeur, taux_horaire_vente_valeur on public.bibliotheque_ratios for each row execute function bibliotheque_ratios_valeurs_vente_garde();

    create table public.planning_cells (id uuid primary key default gen_random_uuid(), week_id text, chantier_id text, jour text, planifie text, reel text, ouvriers text[], created_at timestamptz default now(), taches jsonb, vehicules jsonb);
    create table public.phasages (id uuid primary key default gen_random_uuid(), chantier_id text, chantier_nom text, ouvrages jsonb);
    create table public.planning_config (key text primary key, value jsonb, updated_at timestamptz);
    create table public.profero_ouvrages_selectionnes (id uuid primary key default gen_random_uuid(), bibliotheque_id uuid);
  `);
  // Données FICTIVES : un ouvrage survivant, 59 sauvegardes DELETE (8 colonnes), 9 autres sauvegardes non citées.
  await db.query(`insert into bibliotheque_ratios (id, identifiant, libelle, coefficient_vente_valeur, taux_horaire_vente_valeur) values ('11111111-1111-1111-1111-111111111111','FICTIF_1','Ouvrage fictif survivant',1.5,80)`);
  for (const [i, id] of ids.entries()) {
    const row = { id, identifiant: `fictif_${i}`, libelle: `Ouvrage fictif ${i}`, unite: "U", sous_taches: [{ nom: "t" }],
      updated_at: "2026-05-01T10:00:00+00:00", cadence: i < 57 ? 1.25 : null, materiaux_liens: i === 3 ? null : [] };
    await db.query(`insert into data_history (table_name,row_id,op,row_data,changed_by,saved_at) values ('bibliotheque_ratios',$1,'DELETE',$2,$3,'2026-09-14 10:08:47+00')`, [id, row, AUTEUR]);
  }
  for (let i = 0; i < 9; i++) {
    const id = `99999999-0000-0000-0000-00000000000${i}`;
    await db.query(`insert into data_history (table_name,row_id,op,row_data,changed_by) values ('bibliotheque_ratios',$1,'DELETE',$2,$3)`, [id, { id, identifiant: "x", libelle: "x" }, AUTEUR]);
  }
  // Phasages fictifs : 140 ouvrages vers les 59, 13 vers les 4 introuvables, 5 vers le survivant.
  const ouvr = [];
  ids.forEach((id, i) => { const n = i < 22 ? 3 : 1; for (let k = 0; k < n; k++) ouvr.push({ bibliotheque_id: id }); });
  while (ouvr.length < 140) ouvr.push({ bibliotheque_id: ids[0] });
  introuvables.forEach((id, i) => { const n = i === 0 ? 10 : 1; for (let k = 0; k < n; k++) ouvr.push({ bibliotheque_id: id }); });
  for (let k = 0; k < 5; k++) ouvr.push({ bibliotheque_id: "11111111-1111-1111-1111-111111111111" });
  ouvr.push({ nom: "sans lien" });
  await db.query(`insert into phasages (chantier_id, ouvrages) values ('CH_FICTIF_A', $1), ('CH_FICTIF_B', 'null'::jsonb)`, [ouvr]);
  await db.query(`insert into planning_cells (week_id, chantier_id, jour, taches) values ('2026-W40','CH_FICTIF_A','lundi','[]')`);
  return db;
}

const orphelins = async db => (await db.query(`select count(*)::int n from phasages p, jsonb_array_elements(case when jsonb_typeof(p.ouvrages)='array' then p.ouvrages else '[]' end) o where coalesce(o->>'bibliotheque_id','')<>'' and not exists (select 1 from bibliotheque_ratios b where b.id::text=o->>'bibliotheque_id')`)).rows[0].n;
const q1 = async (db, sql) => (await db.query(sql)).rows[0];
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "ÉCHEC"} ${msg}`); if (!cond) process.exitCode = 1; };
async function tente(db, sql) { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch {} return e.message; } }

console.log(`[données fictives] ${ids.length} identifiants lus dans le script`);

// ── A. Preuve : une réinsertion naïve échoue ──
{
  const db = await nouvelleBase();
  const err = await tente(db, `insert into bibliotheque_ratios select r.* from data_history h, jsonb_populate_record(null::bibliotheque_ratios, h.row_data) r where h.row_id='${ids[0]}'`);
  ok(err && /main_oeuvre_seule|null value/.test(err), `réinsertion naïve refusée : ${err}`);
}

// ── B. Parcours nominal ──
{
  const db = await nouvelleBase();
  await db.query(`insert into planning_config values ('bibliotheque_archives', '{"items":["11111111-1111-1111-1111-111111111111"]}', '2026-09-20')`);
  ok(await orphelins(db) === 153, `orphelins avant : ${await orphelins(db)}`);

  ok(!(await tente(db, MIGRATION)), "migration appliquée");
  const trg = await q1(db, `select string_agg(c.relname, ',' order by c.relname) t from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='trg_data_history'`);
  ok(trg.t === "bibliotheque_ratios,planning_cells", `déclencheurs : ${trg.t}`);
  ok(!(await tente(db, MIGRATION)), "migration rejouée sans erreur");

  await db.query(`update planning_cells set reel='x'`);
  const hc = await q1(db, `select count(*)::int n, max(chantier_id) c from data_history where table_name='planning_cells'`);
  ok(hc.n === 1 && hc.c === "CH_FICTIF_A", `modification d'une cellule historisée (${hc.n}, chantier ${hc.c})`);

  const e1 = await tente(db, RESTAURE);
  ok(!e1, `restauration : ${e1 ?? "sans erreur"}`);
  const r = await q1(db, `select count(*)::int n, count(*) filter (where cadence_source='profero')::int prof, count(*) filter (where cadence_source is null)::int sans,
     count(*) filter (where coefficient_vente_valeur=1.5 and taux_horaire_vente_valeur=80)::int vente, bool_and(not main_oeuvre_seule) mo,
     count(*) filter (where updated_at='2026-05-01T10:00:00+00')::int dates, count(*) filter (where materiaux_liens is null)::int mat_null
     from bibliotheque_ratios where id::text = any($1)`.replace("$1", `array[${ids.map(i => `'${i}'`).join(",")}]`));
  ok(r.n === 59, `59 présents (${r.n})`);
  ok(r.prof === 57 && r.sans === 2, `provenance : ${r.prof} « profero », ${r.sans} sans cadence`);
  ok(r.vente === 59, `valeurs de vente par défaut sur les 59 (${r.vente})`);
  ok(r.mo === true && r.dates === 59 && r.mat_null === 1, `défauts et valeurs d'origine conservés (mo=${r.mo}, dates=${r.dates}, materiaux null=${r.mat_null})`);
  const cfg = await q1(db, `select value, updated_at from planning_config where key='bibliotheque_archives'`);
  ok(cfg.value.items.length === 60 && cfg.value.items[0] === "11111111-1111-1111-1111-111111111111", `archives : ${cfg.value.items.length} (l'archivé existant conservé en tête)`);
  ok(await orphelins(db) === 13, `orphelins après : ${await orphelins(db)}`);
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios where identifiant='x'`)).n === 0, "les 9 non cités restent supprimés");

  // Rejouabilité
  const avant = cfg.updated_at.toISOString();
  const e2 = await tente(db, RESTAURE);
  ok(!e2, `seconde exécution : ${e2 ?? "sans erreur"}`);
  const cfg2 = await q1(db, `select value, updated_at from planning_config where key='bibliotheque_archives'`);
  ok(cfg2.updated_at.toISOString() === avant && cfg2.value.items.length === 60, "seconde exécution : archives non réécrites");
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios`)).n === 60, "seconde exécution : aucune ligne en plus");

  // Annulation
  const e3 = await tente(db, ANNULE);
  ok(!e3, `annulation : ${e3 ?? "sans erreur"}`);
  ok(await orphelins(db) === 153, `orphelins après annulation : ${await orphelins(db)}`);
  const cfg3 = await q1(db, `select value from planning_config where key='bibliotheque_archives'`);
  ok(JSON.stringify(cfg3.value.items) === '["11111111-1111-1111-1111-111111111111"]', "annulation : seul l'archivé d'origine reste");
  const hd = await q1(db, `select count(*)::int n from data_history where table_name='bibliotheque_ratios' and op='DELETE' and changed_by is null`);
  ok(hd.n === 59, `annulation historisée : ${hd.n} sauvegardes DELETE`);
  ok(!(await tente(db, ANNULE)), "annulation rejouée sans erreur");
  // Re-restauration après annulation
  ok(!(await tente(db, RESTAURE)) && await orphelins(db) === 13, "restauration relancée après annulation");
}

// ── C. Refus : pas de défaut de vente ⇒ rien n'est écrit ──
{
  const db = await nouvelleBase();
  await db.query(`update coefficients_vente set est_defaut=false`);
  const e = await tente(db, RESTAURE);
  ok(e && /par défaut/.test(e), `sans coefficient par défaut : refus (${e})`);
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios`)).n === 1 && !(await q1(db, `select count(*)::int n from planning_config`)).n, "rien n'est écrit");
}

// ── D. Refus : archives illisibles ──
{
  const db = await nouvelleBase();
  await db.query(`insert into planning_config values ('bibliotheque_archives', '["pas un objet"]', now())`);
  const e = await tente(db, RESTAURE);
  ok(e && /forme inattendue/.test(e), `archives illisibles : refus`);
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios`)).n === 1, "rien n'est écrit");
}

// ── E. Refus : un phasage a changé (orphelin hors des 4 connus) ──
{
  const db = await nouvelleBase();
  await db.query(`update phasages set ouvrages = ouvrages || '[{"bibliotheque_id":"aaaaaaaa-0000-0000-0000-000000000000"}]'::jsonb where chantier_id='CH_FICTIF_A'`);
  const e = await tente(db, RESTAURE);
  ok(e && /hors des 4 introuvables/.test(e), `orphelin inattendu : refus`);
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios`)).n === 1, "rien n'est écrit");
}

// ── F. Annulation refusée sans historique, ou si un chiffrage cite un ouvrage ──
{
  const db = await nouvelleBase();
  await tente(db, RESTAURE);
  const e = await tente(db, ANNULE);
  ok(e && /pas historisée/.test(e), "annulation sans migration : refus");
  await tente(db, MIGRATION);
  await db.query(`insert into profero_ouvrages_selectionnes (bibliotheque_id) values ('${ids[5]}')`);
  const e2 = await tente(db, ANNULE);
  ok(e2 && /chiffrage/.test(e2), "annulation avec un chiffrage lié : refus");
  ok((await q1(db, `select count(*)::int n from bibliotheque_ratios`)).n === 60, "rien n'est supprimé");
}

// ── G. Clé des archivés absente (état réel de la base au 24/09) ──
{
  const db = await nouvelleBase();
  await tente(db, MIGRATION);
  const e = await tente(db, RESTAURE);
  const cfg = await q1(db, `select value from planning_config where key='bibliotheque_archives'`);
  ok(!e && cfg.value.items.length === 59 && Object.keys(cfg.value).join() === "items", `clé absente : créée avec ${cfg?.value?.items?.length} archivés (${e ?? "sans erreur"})`);
  ok(await orphelins(db) === 13, "clé absente : orphelins 13");
}
