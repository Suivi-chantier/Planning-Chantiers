// Garde du projet « nouvel éditeur de plans » (docs/projets/editeur-plans.md,
// règle 1 et section « Validation automatique » : « aucune écriture dans la
// table plans, ce qu'un script de vérification contrôle »).
//
// Analyse STATIQUE des fichiers du dépôt (aucune base, aucune donnée) :
//
//  A. Code. Tous les fichiers de src/Renovation/planV2/, et tout fichier qu'ils
//     importent, de proche en proche, où qu'il soit dans le dépôt :
//       • la table `plans` n'est atteinte que par `.from("plans").select(…)` :
//         aucun insert, update, upsert ni delete dans la même chaîne d'appels ;
//       • aucun `.from(…)` dont on ne peut pas lire la table (variable, gabarit
//         à trous) suivi d'une écriture, ni gardé dans une variable ;
//       • le nom "plans" n'apparaît que comme argument d'un `.from(…)` ;
//       • aucun appel `.rpc(…)` (une fonction de la base pourrait écrire sans
//         que ce script le voie), aucune adresse REST directe vers la table.
//  B. Migrations du projet (fichiers dont le nom contient « plans_v2 », dans
//     supabase/migrations/ et sql/) : la table `plans` n'y est nommée NULLE
//     PART hors commentaires — donc ni alter table, ni drop, ni policy, ni
//     grant, ni clé étrangère (references), ni déclencheur — et aucun SQL
//     fabriqué à l'exécution (execute '…'), qui échapperait à la lecture.
//  C. La migration de la table (…_plans_v2.sql) ne fait que créer, sur
//     public.plans_v2 seulement, avec exactement les deux règles d'accès
//     accordées par Loris (question 1 du fichier projet).
//
// Le script se contrôle lui-même : il embarque des contre-exemples (faux
// fichiers, données fictives) qu'il DOIT refuser, et des exemples permis qu'il
// doit accepter. S'il ne les départage plus, il échoue.
//
//   node scripts/verif-plan-v2-aucune-ecriture-plans.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const DOSSIER = "src/Renovation/planV2";
const TABLE = "plans";
const ECRITURES = ["insert", "update", "upsert", "delete"];
const EXTENSIONS = [".js", ".jsx", ".mjs", ".ts", ".tsx"];
// `X.from(…)` qui ne désigne pas une table : fabriques du langage.
const PAS_UNE_TABLE = /^(Array|\w*Array|Buffer|Object|Set|Map|String)$/;

// ── Lecture du JavaScript ──────────────────────────────────────────────────
const blanc = (s) => s.replace(/[^\n]/g, " ");
// Fin d'un gabarit `…` ouvert en i (les ${ … } peuvent contenir accolades et gabarits).
function finGabarit(s, i) {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === "\\") { j += 2; continue; }
    if (s[j] === "`") return j + 1;
    if (s[j] === "$" && s[j + 1] === "{") {
      let prof = 1; j += 2;
      while (j < s.length && prof > 0) {
        if (s[j] === "`") { j = finGabarit(s, j); continue; }
        if (s[j] === "{") prof++; else if (s[j] === "}") prof--;
        j++;
      }
      continue;
    }
    j++;
  }
  return s.length;
}
const finChaine = (s, i) => {
  let j = i + 1;
  while (j < s.length && s[j] !== s[i] && s[j] !== "\n") { if (s[j] === "\\") j++; j++; }
  return Math.min(s.length, j + 1);
};
// Code sans commentaires ni expressions régulières (remplacés par des blancs,
// les numéros de ligne sont conservés). Les chaînes sont gardées telles quelles.
export function nettoyerJs(src) {
  let out = "", i = 0;
  const avantRegex = () => {
    const fin = out.trimEnd();
    return fin === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(fin) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(fin);
  };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let j = src.indexOf("\n", i); if (j < 0) j = src.length; out += blanc(src.slice(i, j)); i = j; continue; }
    if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? src.length : j + 2; out += blanc(src.slice(i, j)); i = j; continue; }
    if (c === "'" || c === '"') { const j = finChaine(src, i); out += src.slice(i, j); i = j; continue; }
    if (c === "`") { const j = finGabarit(src, i); out += src.slice(i, j); i = j; continue; }
    if (c === "/" && avantRegex()) {
      let j = i + 1, classe = false, ok = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") classe = true; else if (src[j] === "]") classe = false;
        else if (src[j] === "/" && !classe) { ok = true; break; }
        j++;
      }
      if (ok) { out += `/${blanc(src.slice(i + 1, j))}/`; i = j + 1; continue; }
    }
    out += c; i++;
  }
  return out;
}
// Fin de la parenthèse ouverte en i (chaînes et gabarits sautés).
function finParenthese(s, i) {
  let prof = 0, j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === "'" || c === '"') { j = finChaine(s, j); continue; }
    if (c === "`") { j = finGabarit(s, j); continue; }
    if (c === "(") prof++;
    else if (c === ")") { prof--; if (prof === 0) return j + 1; }
    j++;
  }
  return s.length;
}
const ligne = (s, i) => s.slice(0, i).split("\n").length;
// Chemin relatif à la racine du dépôt, avec des « / » sur toutes les machines.
const relatif = (f) => path.relative(racine, f).split(path.sep).join("/");

// Appels `.from(…)` d'un code nettoyé : [{ table | null, methodes, ligne }].
// `methodes` : la chaîne d'appels qui suit, dans l'ordre (`.select(…).eq(…)`).
export function appelsFrom(code) {
  const appels = [];
  for (const m of code.matchAll(/\.from\s*\(/g)) {
    const receveur = /([A-Za-z_$][\w$]*)\s*\??\s*$/.exec(code.slice(Math.max(0, m.index - 80), m.index))?.[1] || "";
    if (PAS_UNE_TABLE.test(receveur) || receveur === "storage") continue;      // fabrique du langage, ou dossier de stockage
    const ouvre = m.index + m[0].length - 1, ferme = finParenthese(code, ouvre);
    const arg = code.slice(ouvre + 1, ferme - 1).trim();
    const lit = /^(['"`])([^'"`\\$]*)\1$/.exec(arg);
    const methodes = [];
    let j = ferme;
    for (;;) {
      const suite = /^\s*\??\.\s*([A-Za-z_$][\w$]*)\s*/.exec(code.slice(j));
      if (!suite) break;
      j += suite[0].length;
      if (code[j] !== "(") continue;                       // propriété, pas un appel
      methodes.push(suite[1]);
      j = finParenthese(code, j);
    }
    appels.push({ table: lit ? lit[2] : null, arg, methodes, ligne: ligne(code, m.index) });
  }
  return appels;
}

// Violations d'un fichier JavaScript : [{ ligne, texte }].
export function violationsJs(source) {
  const code = nettoyerJs(source), V = [];
  const appels = appelsFrom(code);
  for (const a of appels) {
    const ecrit = a.methodes.filter((x) => ECRITURES.includes(x));
    if (a.table === TABLE) {
      if (ecrit.length) V.push({ ligne: a.ligne, texte: `écriture dans la table ${TABLE} : .${ecrit.join("(), .")}()` });
      else if (a.methodes[0] !== "select") V.push({ ligne: a.ligne, texte: `la table ${TABLE} ne se lit que par .from("${TABLE}").select(…) dans la même chaîne d'appels` });
    } else if (a.table === null) {
      if (ecrit.length) V.push({ ligne: a.ligne, texte: `écriture dans une table non vérifiable : .from(${a.arg}) — écrire le nom de la table en clair` });
      else if (!a.methodes.length) V.push({ ligne: a.ligne, texte: `.from(${a.arg}) gardé sans appel : table non vérifiable` });
    }
  }
  const nommee = [...code.matchAll(new RegExp(`(['"\`])${TABLE}\\1`, "g"))];
  if (nommee.length !== appels.filter((a) => a.table === TABLE).length) {
    V.push({ ligne: ligne(code, nommee[0].index), texte: `le nom "${TABLE}" apparaît ailleurs que dans un .from("${TABLE}")` });
  }
  for (const m of code.matchAll(/\.rpc\s*\(/g)) V.push({ ligne: ligne(code, m.index), texte: "appel .rpc(…) : interdit dans le nouvel éditeur (écriture invisible pour ce script)" });
  for (const m of code.matchAll(new RegExp(`rest/v1/${TABLE}\\b`, "g"))) V.push({ ligne: ligne(code, m.index), texte: `adresse REST directe vers la table ${TABLE}` });
  return V;
}

// Imports locaux d'un code nettoyé (chemins relatifs seulement).
function importsLocaux(code) {
  const chemins = [];
  for (const re of [
    /\b(?:import|export)\s+[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`$]+)\1\s*\)/g,
  ]) for (const m of code.matchAll(re)) chemins.push(m[2]);
  return chemins.filter((c) => c.startsWith("./") || c.startsWith("../")).map((c) => c.replace(/\?.*$/, ""));
}
function resoudre(depuis, chemin) {
  const base = path.resolve(path.dirname(depuis), chemin);
  for (const essai of [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => path.join(base, `index${e}`))]) {
    if (fs.existsSync(essai) && fs.statSync(essai).isFile()) return essai;
  }
  return null;
}
function fichiersDe(dossier) {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dossier, e.name);
    return e.isDirectory() ? fichiersDe(p) : EXTENSIONS.includes(path.extname(e.name)) ? [p] : [];
  });
}

// ── Lecture du SQL ─────────────────────────────────────────────────────────
// SQL sans commentaires ni textes entre apostrophes, en minuscules. Les corps
// de fonctions ($$ … $$) sont GARDÉS : une écriture peut s'y cacher.
export const nettoyerSql = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/--[^\n]*/g, " ")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase();
export function violationsSql(sql) {
  const propre = nettoyerSql(sql), V = [];
  if (new RegExp(`(^|[^a-z0-9_])${TABLE}([^a-z0-9_]|$)`).test(propre)) V.push(`la table ${TABLE} est nommée (alter, drop, policy, grant, references, déclencheur… : rien de tout cela n'est permis)`);
  if (/\bexecute\s+(format\s*\(|''|\$)/.test(propre)) V.push("SQL fabriqué à l'exécution (execute '…') : non vérifiable");
  return V;
}

// ── Contrôle du script par lui-même (faux fichiers, données fictives) ──────
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

test("contre-exemples JavaScript : chacun est refusé", () => {
  const interdits = {
    "update sur plusieurs lignes": 'await supabase\n  .from("plans")\n  .update({ data })\n  .eq("id", id);',
    "apostrophes": "await supabase.from('plans').update({ data }).eq('id', id);",
    "gabarit": "await supabase.from(`plans`).delete().eq('id', id);",
    "insert": 'const { data } = await client.from("plans").insert(ligne).select().single();',
    "upsert": 'client.from( "plans" ).upsert(lignes)',
    "écriture après un filtre": 'client.from("plans").eq("id", id).update({ name })',
    "chaînage facultatif": 'client?.from("plans")?.delete()?.eq("id", id)',
    "table gardée dans une variable": 'const t = client.from("plans");\nawait t.update({ data });',
    "nom de table dans une constante": 'const T = "plans";\nawait client.from(T).select("id");',
    "table variable et écriture": "await client.from(table).update({ data }).eq('id', id);",
    "gabarit à trous et écriture": "await client.from(`${prefixe}plans`).insert(ligne);",
    "table variable gardée": "const t = client.from(nomTable);",
    "lecture sans select": 'client.from("plans").eq("id", id)',
    "rpc": 'await supabase.rpc("enregistrer_plan", { p_id: id });',
    "adresse REST": 'await fetch(`${url}/rest/v1/plans?id=eq.${id}`, { method: "PATCH", body });',
    "écriture cachée derrière un commentaire": 'client.from("plans") // lecture seule\n  .update({ data })',
    "écriture après une expression régulière": 'const re = /"/g; client.from("plans").delete();',
  };
  for (const [nom, source] of Object.entries(interdits)) assert.ok(violationsJs(source).length > 0, `devrait être refusé : ${nom}`);
});

test("exemples JavaScript permis : aucun n'est refusé", () => {
  const permis = {
    "lecture de l'ancienne table": 'const { data } = await client.from("plans").select("id, name").not("data->releve", "is", null).order("updated_at");',
    "lecture sur plusieurs lignes": 'client\n  .from("plans")\n  .select("releve:data->releve")\n  .eq("id", id)\n  .maybeSingle()',
    "écriture dans la nouvelle table": 'await client.from("plans_v2").update({ data }).eq("id", id).select("id");',
    "autre table au nom proche": "await client.from('profero_plans').insert(ligne);",
    "suppression dans la nouvelle table": 'await client.from("plans_v2").delete().eq("id", id);',
    "requête complétée ensuite": 'let q = client.from("plans_v2").update(x).eq("id", id);\nq = q.eq("updated_at", d);',
    "stockage de fichiers": "await supabase.storage.from(BUCKET).upload(chemin, fichier);\nawait supabase.storage.from(BUCKET).remove([chemin]);",
    "fabriques du langage": "const a = Array.from(liste).map(f); const b = Uint8Array.from(octets); Object.fromEntries(paires);",
    "écriture seulement citée en commentaire": '// jamais : client.from("plans").update({ data })\n/* ni client.from("plans").delete() */\nconst x = 1;',
    "table variable en lecture": "const { data } = await client.from(table).select(colonnes);",
    "mot plans dans un texte": 'const titre = "Liste des plans du chantier"; const cle = "plans_v2";',
  };
  for (const [nom, source] of Object.entries(permis)) assert.deepEqual(violationsJs(source), [], `devrait être permis : ${nom}`);
});

test("contre-exemples SQL : chacun est refusé ; exemples permis acceptés", () => {
  const interdits = [
    "alter table public.plans add column v2_id uuid;",
    "ALTER TABLE plans ENABLE ROW LEVEL SECURITY;",
    "create table public.plans_v2 (id uuid primary key, origine uuid references public.plans(id));",
    'create table public.plans_v2 (id uuid primary key, origine uuid references "plans" (id));',
    "create policy lecture on public.plans for select to authenticated using (true);",
    "drop policy if exists bureau_all on plans;",
    "grant select on public.plans to authenticated;",
    "revoke all on plans from anon;",
    "drop table if exists public.plans;",
    "create trigger t after insert on public.plans_v2 for each row execute function f();\nupdate plans set data = '{}';",
    "create function f() returns void language plpgsql as $$ begin delete from public.plans; end $$;",
    "insert into public.plans_v2 (data) select data from public.plans;",
    "do $$ begin execute 'alter table pla' || 'ns add column x int'; end $$;",
    "do $$ begin execute format('drop table %I', nom); end $$;",
  ];
  for (const sql of interdits) assert.ok(violationsSql(sql).length > 0, `devrait être refusé : ${sql}`);
  const permis = [
    "create table if not exists public.plans_v2 (id uuid primary key, origine_plan_id uuid);",
    "-- l'ancienne table plans n'est pas touchée\nalter table public.plans_v2 enable row level security;",
    "comment on table public.plans_v2 is 'Plans du nouvel éditeur (la table plans reste telle quelle).';",
    "create policy bureau_all on public.plans_v2 for all to authenticated using (true);",
    "create table public.plans_v2_symboles (id uuid primary key); alter table public.profero_plans add column x int;",
    "create trigger plans_v2_set_updated_at before update on public.plans_v2 for each row execute function public.set_updated_at();",
  ];
  for (const sql of permis) assert.deepEqual(violationsSql(sql), [], `devrait être permis : ${sql}`);
});

// ── A. Le code du nouvel éditeur ───────────────────────────────────────────
test("code du nouvel éditeur et tout ce qu'il importe : aucune écriture dans la table plans", () => {
  const depart = fichiersDe(path.join(racine, DOSSIER));
  assert.ok(depart.length > 0, `${DOSSIER} : aucun fichier trouvé`);
  const vus = new Map(), file = [...depart], erreurs = [];
  const compte = { lectures: 0, autres: 0 };
  while (file.length) {
    const f = file.pop();
    if (vus.has(f)) continue;
    const source = fs.readFileSync(f, "utf8"), code = nettoyerJs(source), rel = relatif(f);
    vus.set(f, true);
    for (const v of violationsJs(source)) erreurs.push(`${rel}:${v.ligne} — ${v.texte}`);
    for (const a of appelsFrom(code)) { if (a.table === TABLE) compte.lectures++; else compte.autres++; }
    for (const chemin of importsLocaux(code)) {
      const cible = resoudre(f, chemin);
      if (!cible) { erreurs.push(`${rel} — import introuvable : ${chemin} (fichier non vérifié)`); continue; }
      if (EXTENSIONS.includes(path.extname(cible))) file.push(cible);
    }
    if (rel.startsWith(DOSSIER) && /\bimport\s*\(\s*(?!['"`])/.test(code)) erreurs.push(`${rel} — import( ) dont le chemin n'est pas écrit en clair (fichier non vérifiable)`);
  }
  const hors = [...vus.keys()].map(relatif).filter((f) => !f.startsWith(DOSSIER)).sort();
  console.log(`    ${depart.length} fichiers dans ${DOSSIER}, ${hors.length} importés d'ailleurs (${hors.join(", ") || "aucun"})`);
  console.log(`    accès à la table ${TABLE} : ${compte.lectures} lecture(s) par select, 0 écriture ; ${compte.autres} accès à d'autres tables`);
  assert.deepEqual(erreurs, [], `\n      ${erreurs.join("\n      ")}`);
});

// ── B et C. Les migrations du projet ───────────────────────────────────────
const migrations = ["supabase/migrations", "sql"].flatMap((d) => fs.readdirSync(path.join(racine, d)).filter((f) => /plans_v2/.test(f) && f.endsWith(".sql")).map((f) => `${d}/${f}`));

test("migrations du projet : la table plans n'y est nommée nulle part", () => {
  assert.ok(migrations.some((f) => f.startsWith("supabase/migrations/")), "aucune migration du projet trouvée (nom contenant « plans_v2 »)");
  for (const f of migrations) assert.deepEqual(violationsSql(fs.readFileSync(path.join(racine, f), "utf8")), [], f);
  console.log(`    ${migrations.length} fichier(s) : ${migrations.join(", ")}`);
});

test("migration de la table : elle ne fait que créer, sur public.plans_v2, avec les deux règles d'accès accordées", () => {
  const fichiers = migrations.filter((f) => /^supabase\/migrations\/\d{14}_plans_v2\.sql$/.test(f));
  assert.equal(fichiers.length, 1, `une seule migration « plans_v2 » attendue (trouvé : ${fichiers.join(", ") || "aucune"})`);
  const sql = nettoyerSql(fs.readFileSync(path.join(racine, fichiers[0]), "utf8")).replace(/\s+/g, " ");
  const instructions = sql.split(";").map((s) => s.trim()).filter(Boolean);
  const PERMIS = [
    /^create table if not exists public\.plans_v2 \(/,
    /^create index if not exists \w+ on public\.plans_v2 \(/,
    /^comment on (table|column) public\.plans_v2\b/,
    /^drop trigger if exists \w+ on public\.plans_v2$/,
    /^create trigger \w+ before update on public\.plans_v2 for each row execute function public\.set_updated_at\(\)$/,
    /^alter table public\.plans_v2 enable row level security$/,
    /^revoke all on public\.plans_v2 from anon, authenticated$/,
    /^grant [a-z, ]+ on public\.plans_v2 to (authenticated|service_role)$/,
    /^drop policy if exists \w+ on public\.plans_v2$/,
    /^create policy \w+ on public\.plans_v2 /,
  ];
  for (const s of instructions) assert.ok(PERMIS.some((re) => re.test(s)), `instruction non prévue : ${s.slice(0, 90)}`);
  // Clé étrangère : vers les chantiers seulement.
  assert.deepEqual([...sql.matchAll(/references ([a-z_."]+)/g)].map((m) => m[1]), ["public.chantiers"], "seule clé étrangère : public.chantiers");
  // Accès : RLS activée, deux règles et pas une de plus, écrites comme convenu.
  assert.ok(instructions.includes("alter table public.plans_v2 enable row level security"), "RLS activée");
  const regles = instructions.filter((s) => s.startsWith("create policy")).sort();
  assert.deepEqual(regles, [
    "create policy bureau_all on public.plans_v2 for all to authenticated using ((select not public.est_ouvrier())) with check ((select not public.est_ouvrier()))",
    "create policy profero_collaborateurs_seulement on public.plans_v2 as restrictive for all to authenticated using ((select public.est_collaborateur_actif())) with check ((select public.est_collaborateur_actif()))",
  ], "exactement les deux règles de l'ancienne table des plans (accord de Loris, question 1)");
  assert.ok(!/security definer|create (or replace )?function/.test(sql), "aucune fonction, aucun SECURITY DEFINER");
  assert.ok(!instructions.some((s) => /^grant .* to (anon|public)\b/.test(s)), "aucun droit pour un visiteur non connecté");
  assert.ok(instructions.includes("grant select, insert, update, delete on public.plans_v2 to authenticated"), "comptes connectés : lecture, création, modification, suppression");
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications « aucune écriture dans la table plans » (nouvel éditeur)`);
