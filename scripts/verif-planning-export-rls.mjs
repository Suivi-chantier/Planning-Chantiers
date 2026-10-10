// exemple issu des tests, données fictives — base PostgreSQL locale isolée.
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key);create table public.ia_jobs(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create function public.mon_role() returns text language sql as $$select current_setting('qa.role',true)$$;
create function public.est_collaborateur_actif() returns boolean language sql as $$select current_setting('qa.active',true)='true'$$;
grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated;`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261010204055_planning_semaine_export.sql',import.meta.url),'utf8'));
const uid='00000000-0000-4000-8000-000000000001';await db.exec(`insert into auth.users values ('${uid}')`);
async function comme(role,active,fn){await db.exec(`set role authenticated;select set_config('qa.uid','${uid}',false);select set_config('qa.role','${role}',false);select set_config('qa.active','${active}',false);`);try{return await fn();}finally{await db.exec('reset role');}}
await comme('admin',true,async()=>{await db.exec(`insert into planning_semaine_export(week_id) values ('2026-W42')`);const r=await db.query('select * from planning_semaine_export');assert.equal(r.rows.length,1);assert.equal(r.rows[0].updated_by,uid);});
await comme('conducteur',true,async()=>{const r=await db.query("update planning_semaine_export set remarques='Test fictif' where week_id='2026-W42' returning updated_at::text");assert.equal(r.rows.length,1);const ancien=r.rows[0].updated_at;await db.exec("update planning_semaine_export set remarques='Autre modification' where week_id='2026-W42'");const verrou=await db.query("update planning_semaine_export set remarques='Écrasement' where week_id='2026-W42' and updated_at=$1 returning week_id",[ancien]);assert.equal(verrou.rows.length,0);});
for(const [role,active] of [['ouvrier',true],['client',false],['admin',false],['inconnu',true]])await comme(role,active,async()=>{assert.equal((await db.query('select * from planning_semaine_export')).rows.length,0);await assert.rejects(db.exec("insert into planning_semaine_export(week_id) values ('2026-W43')"));assert.equal((await db.query("update planning_semaine_export set remarques='Interdit' returning week_id")).rows.length,0);});
await db.exec('set role anon');await assert.rejects(db.query('select * from planning_semaine_export'));await db.exec('reset role');
await db.close();console.log('✓ Sauvegarde hebdomadaire : bureau autorisé, autres accès refusés, traçabilité et conflit vérifiés — exemple issu des tests, données fictives.');
