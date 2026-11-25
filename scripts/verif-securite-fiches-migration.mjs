#!/usr/bin/env node
// Vérifie la migration de la fiche de préparation sécurité chantier (tâche 1
// du projet docs/projets/fiche-securite-chantier.md) par LECTURE STATIQUE du
// fichier SQL : aucune base, aucun réseau, aucune donnée.
//   - chaque table securite_ a la RLS et la policy RESTRICTIVE
//     profero_collaborateurs_seulement ;
//   - versions et signatures : aucune policy UPDATE / DELETE / ALL, sauf la
//     mise à jour de pdf_path des versions ; aucun droit DELETE ni TRUNCATE ;
//     déclencheurs d'immuabilité (update, delete, truncate) ;
//   - aptitudes médicales forcément confidentielles ;
//   - buckets securite-confidentiel et securite-preuves privés, couverts par
//     le verrou de storage.objects (rien d'autre ajouté à la liste), sans
//     aucune policy UPDATE ni DELETE ;
//   - signature d'accueil d'un ouvrier limitée à son compte, à la version en
//     cours et aux chantiers non archivés ; aucune fonction SECURITY DEFINER.
//   node scripts/verif-securite-fiches-migration.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const dossier = join(racine, "supabase/migrations");
const fichiers = readdirSync(dossier).filter((f) => /_securite_fiches_chantier\.sql$/.test(f));
assert.equal(fichiers.length, 1, "une seule migration *_securite_fiches_chantier.sql");
const brut = readFileSync(join(dossier, fichiers[0]), "utf8");
// Sans commentaires « -- … » et espaces normalisés.
const sql = brut.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").toLowerCase();

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

const TABLES = ["securite_operations", "securite_fiches", "securite_fiches_versions", "securite_signatures", "securite_justificatifs"];
const IMMUABLES = ["securite_fiches_versions", "securite_signatures"];

// Toutes les policies : { nom, table, restrictive, cmd, corps }.
const policies = [...sql.matchAll(/create policy ("[^"]+"|\w+) on ([\w.]+)(.*?);/g)].map((m) => {
  const reste = m[3];
  const cmd = (reste.match(/\bfor (all|select|insert|update|delete)\b/) || [, "all"])[1];
  return { nom: m[1].replace(/"/g, ""), table: m[2].replace(/^public\./, ""), restrictive: /\bas restrictive\b/.test(reste), cmd, corps: reste };
});

test("1. les 5 tables securite_ sont créées, et ce sont les seules tables créées", () => {
  const creees = [...sql.matchAll(/create table (?:public\.)?(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...creees].sort(), [...TABLES].sort());
  assert.ok(!/\balter table public\.(?!securite_)/.test(sql), "aucune table existante n'est modifiée");
});

test("2. chaque table securite_ : RLS activée et policy RESTRICTIVE profero_collaborateurs_seulement", () => {
  for (const t of TABLES) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security`), `${t} : RLS`);
    const p = policies.find((x) => x.table === t && x.nom === "profero_collaborateurs_seulement");
    assert.ok(p, `${t} : profero_collaborateurs_seulement`);
    assert.ok(p.restrictive && p.cmd === "all", `${t} : restrictive pour tout`);
    assert.match(p.corps, /using \(\(select public\.est_collaborateur_actif\(\)\)\) with check \(\(select public\.est_collaborateur_actif\(\)\)\)/, `${t} : est_collaborateur_actif`);
  }
});

test("3. versions et signatures : aucune policy UPDATE / DELETE / ALL permissive, sauf pdf_path des versions", () => {
  const ouvertes = policies.filter((p) => IMMUABLES.includes(p.table) && !p.restrictive && ["update", "delete", "all"].includes(p.cmd));
  assert.deepEqual(ouvertes.map((p) => `${p.table}:${p.nom}`), ["securite_fiches_versions:securite versions bureau pdf"]);
  assert.equal(ouvertes[0].cmd, "update");
});

test("4. droits SQL : tout retiré à anon et authenticated, jamais DELETE ni TRUNCATE, update des versions limité à pdf_path", () => {
  const revoke = sql.match(/revoke all on (.*?) from anon, authenticated;/);
  assert.ok(revoke, "revoke all … from anon, authenticated");
  for (const t of [...TABLES, "securite_fiches_etat", "securite_justificatifs_expiration"]) {
    assert.ok(revoke[1].includes(`public.${t}`), `${t} dans le revoke`);
  }
  const grants = [...sql.matchAll(/grant ([^;]*?) on (?:table )?([\w., ]+?) to ([\w, ]+);/g)];
  for (const [, privs, , qui] of grants) {
    assert.ok(!/\b(delete|truncate|all)\b/.test(privs), `pas de ${privs}`);
    assert.ok(!/\banon\b/.test(qui), "rien pour anon");
  }
  for (const t of IMMUABLES) {
    const g = grants.filter(([, , objets]) => objets.split(",").map((s) => s.trim()).includes(`public.${t}`)).map(([, p]) => p.trim());
    const attendus = t === "securite_fiches_versions" ? ["select, insert", "update (pdf_path)"] : ["select, insert"];
    assert.deepEqual(g.sort(), attendus.sort(), `${t} : droits ${g.join(" / ")}`);
  }
});

test("5. déclencheurs d'immuabilité : update, delete et truncate refusés sur versions et signatures", () => {
  assert.match(sql, /before update or delete on public\.securite_fiches_versions for each row execute function public\.securite_versions_immuables\(\)/);
  assert.match(sql, /before truncate on public\.securite_fiches_versions for each statement execute function public\.securite_versions_immuables\(\)/);
  assert.match(sql, /before update or delete on public\.securite_signatures for each row execute function public\.securite_signatures_immuables\(\)/);
  assert.match(sql, /before truncate on public\.securite_signatures for each statement execute function public\.securite_signatures_immuables\(\)/);
  assert.match(sql, /if tg_op in \('delete', 'truncate'\) then raise exception/);
  assert.match(sql, /before update on public\.securite_fiches for each row execute function public\.securite_fiche_verrouillee\(\)/);
});

test("6. aptitude médicale toujours confidentielle, et réservée aux admins", () => {
  assert.ok(sql.includes("check (type_code <> 'aptitude_medicale' or confidentiel)"));
  for (const p of policies.filter((x) => x.table === "securite_justificatifs" && !x.restrictive)) {
    assert.ok(/not confidentiel/.test(p.corps), `${p.nom} : filtre confidentiel`);
  }
});

test("7. buckets securite-confidentiel et securite-preuves : privés, couverts par le verrou, rien ne s'y modifie ni ne s'y efface", () => {
  for (const b of ["securite-confidentiel", "securite-preuves"]) {
    assert.ok(sql.includes(`insert into storage.buckets (id, name, public) values ('${b}', '${b}', false)`), `${b} privé`);
  }
  const verrou = policies.filter((p) => p.table === "storage.objects" && p.nom === "profero_collaborateurs_seulement");
  assert.equal(verrou.length, 1);
  assert.ok(verrou[0].restrictive && verrou[0].cmd === "all");
  assert.ok(sql.includes("drop policy if exists profero_collaborateurs_seulement on storage.objects"));
  const listes = [...verrou[0].corps.matchAll(/bucket_id not in \(([^)]*)\)/g)].map((m) => m[1].replace(/[' ]/g, "").split(",").sort());
  assert.equal(listes.length, 2, "using et with check");
  for (const l of listes) assert.deepEqual(l, ["chantier-documents", "invest-documents", "photos", "securite-confidentiel", "securite-preuves"]);
  const stockage = policies.filter((x) => x.table === "storage.objects" && !x.restrictive);
  assert.deepEqual(stockage.map((p) => p.nom).sort(), [
    "securite confidentiel admin ecriture", "securite confidentiel admin lecture",
    "securite preuves bureau ajout", "securite preuves bureau lecture",
    "securite preuves ouvrier lecture", "securite preuves ouvrier signature"]);
  for (const p of stockage) assert.ok(["select", "insert"].includes(p.cmd), `${p.nom} : ni update ni delete (pas d'écrasement)`);
  for (const p of stockage.filter((x) => x.nom.startsWith("securite confidentiel"))) {
    assert.match(p.corps, /bucket_id = 'securite-confidentiel' and \(select public\.is_admin\(\)\)/, p.nom);
  }
  const sig = stockage.find((p) => p.nom === "securite preuves ouvrier signature");
  assert.ok(sig.corps.includes("(storage.foldername(name))[1] = 'signatures'"), "ouvrier : seulement sous signatures/");
  assert.ok(sig.corps.includes("from public.securite_fiches f"), "ouvrier : fiche qu'il voit");
  assert.match(sql, /raise exception 'une policy permet de modifier ou supprimer un fichier/);
});

test("8. signature d'accueil d'un ouvrier : son compte, version en cours validée, chantier non archivé", () => {
  const p = policies.find((x) => x.nom === "securite signatures ouvrier accueil");
  assert.ok(p && p.cmd === "insert");
  for (const morceau of ["type = 'accueil'", "auth_user_id = (select auth.uid())", "f.version = securite_signatures.version",
    "v.empreinte = securite_signatures.empreinte_version", "f.statut = 'validee'", "c.archive_le is null"]) {
    assert.ok(p.corps.includes(morceau), morceau);
  }
  const bureau = policies.find((x) => x.nom === "securite signatures bureau ajout");
  assert.ok(bureau.corps.includes("auth_user_id is null or auth_user_id = (select auth.uid())"), "bureau : pas au nom d'un autre compte");
});

test("9. vues en security_invoker, aucune fonction SECURITY DEFINER, garde-fou final présent", () => {
  const vues = [...sql.matchAll(/create view (public\.\w+) with \(security_invoker = true\)/g)].map((m) => m[1]);
  assert.deepEqual(vues.sort(), ["public.securite_fiches_etat", "public.securite_justificatifs_expiration"]);
  assert.equal((sql.match(/create (or replace )?view/g) || []).length, 2);
  assert.ok(!/security definer/.test(sql), "aucune SECURITY DEFINER");
  assert.match(sql, /raise exception 'tables securite_ sans rls ou sans profero_collaborateurs_seulement/);
  assert.match(sql, /raise exception 'bucket securite-confidentiel ou securite-preuves non couvert/);
});

console.log(`\n${n} vérifications réussies (${fichiers[0]}).`);
