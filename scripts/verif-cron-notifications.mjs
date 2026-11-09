// scripts/verif-cron-notifications.mjs — Créneaux des notifications sur
// téléphone tenus par la base (pg_cron + pg_net), à l'heure de Paris.
//
// Pourquoi ce script : les « schedule » GitHub de ces 7 notifications ne
// partaient pas, ou avec des heures de retard (constat du 09/11/2026). Ils
// sont remplacés par des jobs pg_cron (migration *_cron_notifications_push.sql).
// Une erreur d'heure UTC ou de garde « heure de Paris » ne se verrait qu'au
// changement d'heure suivant, par une notification absente ou en double :
// on la vérifie ici sur trois années complètes, jour par jour.
//
// Contrôles :
//   1. la migration planifie les 7 jobs `profero_push_*`, chacun vers le bon
//      `?job=` avec les mêmes paramètres que les anciens créneaux GitHub ;
//   2. simulés jour par jour du 01/01/2026 au 31/12/2028 (deux passages UTC +
//      garde « heure de Paris »), chaque job appelle le dispatcher exactement
//      une fois les jours voulus, à l'heure de Paris voulue, et jamais les
//      autres jours — été, hiver et lendemains de changement d'heure ;
//   3. la migration ne crée ni table, ni policy, ni fonction ; le secret est
//      lu dans Vault (`cron_secret`) au moment de l'appel, et sans secret
//      aucun appel ne part ;
//   4. les 7 workflows GitHub n'ont plus de `schedule`, gardent
//      `workflow_dispatch` ;
//   5. aucune valeur de secret n'apparaît dans le dépôt.
//
// Aucune base, aucun réseau. Usage : node scripts/verif-cron-notifications.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const MIGRATIONS = readdirSync(chemin("supabase/migrations")).filter((f) => /_cron_notifications_push\.sql$/.test(f));
const MIGRATION = MIGRATIONS.length === 1 ? lire(`supabase/migrations/${MIGRATIONS[0]}`) : "";
const URL_DISPATCHER = "https://planning-chantiers.vercel.app/api/cron-dispatcher?job=";

const JOURS_OUVRES = [1, 2, 3, 4, 5];
// Attendu : job pg_cron, paramètres d'URL (repris des anciens workflows),
// jours (0 = dimanche … 6 = samedi, heure de Paris), heure de Paris.
const ATTENDUS = [
  { nom: "profero_push_reportes",           query: "push_reportes",                      jours: JOURS_OUVRES, h: 7,  m: 5,  workflow: "cron-push-reportes.yml" },
  { nom: "profero_push_materiaux",          query: "push_materiaux",                     jours: JOURS_OUVRES, h: 8,  m: 5,  workflow: "cron-push-materiaux.yml" },
  { nom: "profero_push_factures_a_emettre", query: "factures_a_emettre&pas_avant=8",     jours: JOURS_OUVRES, h: 8,  m: 15, workflow: "cron-factures-a-emettre.yml" },
  { nom: "profero_push_synthese_semaine",   query: "synthese_semaine&pas_avant=8",       jours: [1],          h: 8,  m: 30, workflow: "cron-push-synthese-semaine.yml" },
  { nom: "profero_push_nouveaux_chantiers", query: "nouveaux_chantiers&pas_avant=8",     jours: JOURS_OUVRES, h: 8,  m: 45, workflow: "cron-push-nouveaux-chantiers.yml" },
  { nom: "profero_push_alertes_chantiers",  query: "alertes_chantiers&pas_avant=9",      jours: JOURS_OUVRES, h: 9,  m: 5,  workflow: "cron-alertes-chantiers.yml" },
  { nom: "profero_push_point_conducteurs",  query: "point_conducteurs&pas_avant=18:30",  jours: JOURS_OUVRES, h: 18, m: 30, workflow: "cron-point-conducteurs.yml" },
];

/** Les appels cron.schedule('nom', 'planification', $cmd$ … $cmd$) de la migration. */
function planifications(sql) {
  const res = new Map();
  const re = /select\s+cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\$cmd\$([\s\S]*?)\$cmd\$\s*\)\s*;/g;
  for (const m of sql.matchAll(re)) res.set(m[1], { cron: m[2], commande: m[3] });
  return res;
}

/** Valeurs d'un champ cron simple : « * », « n », « a,b », « a-b ». */
function valeursChamp(champ, min, max) {
  if (champ === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const out = [];
  for (const morceau of champ.split(",")) {
    const r = /^(\d+)(?:-(\d+))?$/.exec(morceau);
    assert.ok(r, `champ cron non pris en charge : ${champ}`);
    const a = Number(r[1]), b = r[2] != null ? Number(r[2]) : a;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return out;
}

const FMT_PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", hourCycle: "h23",
  weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit",
});
const JOURS_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function paris(ms) {
  const p = Object.fromEntries(FMT_PARIS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { jour: JOURS_EN[p.weekday], h: Number(p.hour), m: Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/**
 * Simule un job pg_cron jour par jour (pg_cron tourne en UTC sur Supabase) :
 * chaque passage UTC prévu exécute la commande, qui n'appelle le dispatcher
 * que si l'heure de Paris vaut la garde. Rend les appels, en heure de Paris.
 */
function simuler(cronUtc, heureGarde, debut, fin) {
  const [min, heure, dom, mois, dow] = cronUtc.trim().split(/\s+/);
  assert.equal(dom, "*"); assert.equal(mois, "*");
  const minutes = valeursChamp(min, 0, 59), heures = valeursChamp(heure, 0, 23), jours = valeursChamp(dow, 0, 6);
  const appels = [];
  for (let j = Date.UTC(...debut); j <= Date.UTC(...fin); j += 86400000) {
    if (!jours.includes(new Date(j).getUTCDay())) continue;
    for (const h of heures) for (const mi of minutes) {
      const t = paris(j + h * 3600000 + mi * 60000);
      if (t.h === heureGarde) appels.push(t);
    }
  }
  return appels;
}

// ── 1. La migration planifie les 7 jobs, vers le bon ?job= ─────────────────
test("1. une seule migration *_cron_notifications_push.sql, qui planifie exactement les 7 jobs profero_push_*", () => {
  assert.equal(MIGRATIONS.length, 1, `migrations trouvées : ${MIGRATIONS.join(", ") || "aucune"}`);
  const p = planifications(MIGRATION);
  assert.deepEqual([...p.keys()].sort(), ATTENDUS.map((a) => a.nom).sort());
  for (const a of ATTENDUS) assert.ok(a.nom.startsWith("profero_push_"));
});

test("2. chaque job appelle le dispatcher avec les paramètres des anciens créneaux GitHub (pas_avant compris)", () => {
  const p = planifications(MIGRATION);
  for (const a of ATTENDUS) {
    const { commande } = p.get(a.nom);
    const urls = [...commande.matchAll(/url\s*:=\s*'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(urls, [URL_DISPATCHER + a.query], a.nom);
    assert.match(commande, /net\.http_get\(/, `${a.nom} : appel pg_net`);
    assert.match(commande, /jsonb_build_object\('Authorization', 'Bearer ' \|\| v_secret\)/, `${a.nom} : en-tête Authorization`);
    assert.match(commande, /timeout_milliseconds\s*:=\s*\d{5,}/, `${a.nom} : délai d'attente suffisant (≥ 10 s)`);
  }
});

test("3. déplanification préalable des 7 noms : la migration peut être rejouée", () => {
  const bloc = /select\s+cron\.unschedule\(jobname\)\s+from\s+cron\.job\s+where\s+jobname\s+in\s*\(([^)]*)\)/i.exec(MIGRATION);
  assert.ok(bloc, "cron.unschedule des jobs existants");
  const noms = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(noms, ATTENDUS.map((a) => a.nom).sort());
  assert.ok(MIGRATION.indexOf("cron.unschedule") < MIGRATION.indexOf("cron.schedule("), "déplanifier AVANT de planifier");
});

// ── 2. Heure de Paris, été comme hiver ──────────────────────────────────────
test("4. simulés jour par jour de 2026 à 2028 : un seul appel les jours voulus, à l'heure de Paris voulue, jamais les autres jours", () => {
  const p = planifications(MIGRATION);
  for (const a of ATTENDUS) {
    const { cron, commande } = p.get(a.nom);
    const garde = /extract\(hour from \(now\(\) at time zone 'Europe\/Paris'\)\) <> (\d+) then\s*\n\s*return;/.exec(commande);
    assert.ok(garde, `${a.nom} : garde sur l'heure de Paris`);
    assert.equal(Number(garde[1]), a.h, `${a.nom} : garde sur ${a.h}h Paris`);
    assert.ok(commande.indexOf(garde[0]) < commande.indexOf("net.http_get"), `${a.nom} : la garde précède l'appel`);
    const appels = simuler(cron, Number(garde[1]), [2026, 0, 1], [2028, 11, 31]);
    const parDate = new Map();
    for (const c of appels) parDate.set(c.date, [...(parDate.get(c.date) || []), c]);
    for (const [date, liste] of parDate) {
      assert.equal(liste.length, 1, `${a.nom} : ${liste.length} appels le ${date}`);
      const c = liste[0];
      assert.ok(a.jours.includes(c.jour), `${a.nom} : appel un jour non prévu (${date})`);
      assert.equal(c.h * 60 + c.m, a.h * 60 + a.m, `${a.nom} : appel à ${c.h}h${String(c.m).padStart(2, "0")} Paris le ${date}`);
      const pasAvant = /pas_avant=(\d+)(?::(\d+))?/.exec(a.query);
      if (pasAvant) {
        assert.ok(c.h * 60 + c.m >= Number(pasAvant[1]) * 60 + Number(pasAvant[2] || 0), `${a.nom} : l'appel n'est pas ignoré par pas_avant`);
      }
    }
    // Chaque jour voulu reçoit son appel (aucun trou au changement d'heure).
    for (let j = Date.UTC(2026, 0, 1); j <= Date.UTC(2028, 11, 31); j += 86400000) {
      const t = paris(j + 12 * 3600000);
      if (a.jours.includes(t.jour)) assert.ok(parDate.has(t.date), `${a.nom} : aucun appel le ${t.date}`);
    }
  }
});

test("5. points de contrôle lisibles : 7h05 / 9h05 / 18h30 Paris en été, en hiver et aux lendemains de changement d'heure", () => {
  const p = planifications(MIGRATION);
  const cas5 = [
    ["profero_push_reportes", "2026-07-13", 7, 5], ["profero_push_reportes", "2026-11-09", 7, 5],
    ["profero_push_alertes_chantiers", "2026-03-30", 9, 5], ["profero_push_alertes_chantiers", "2026-10-26", 9, 5],
    ["profero_push_point_conducteurs", "2027-03-29", 18, 30], ["profero_push_point_conducteurs", "2027-11-01", 18, 30],
    ["profero_push_synthese_semaine", "2026-11-09", 8, 30], ["profero_push_synthese_semaine", "2027-06-07", 8, 30],
  ];
  for (const [nom, date, h, m] of cas5) {
    const [a, mo, j] = date.split("-").map(Number);
    const appels = simuler(p.get(nom).cron, h, [a, mo - 1, j], [a, mo - 1, j]);
    assert.equal(appels.length, 1, `${nom} le ${date}`);
    assert.deepEqual([appels[0].h, appels[0].m], [h, m], `${nom} le ${date}`);
  }
});

// ── 3. Pas de table, de policy, de fonction ; le secret vient de Vault ──────
test("6. migration : uniquement des planifications cron (ni table, ni policy, ni fonction, ni SECURITY DEFINER)", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "");
  for (const motif of [/create\s+(or\s+replace\s+)?(table|policy|function|procedure|view|trigger|role|extension)/i,
    /security\s+definer/i, /\balter\s+/i, /\bdrop\s+/i, /\bgrant\s+/i, /\binsert\s+into/i, /\bdelete\s+from/i, /\btruncate\b/i]) {
    assert.ok(!motif.test(sql), `motif interdit : ${motif}`);
  }
  // En dehors des commandes $cmd$…$cmd$, rien d'autre que unschedule/schedule.
  const horsCommandes = sql.replace(/\$cmd\$[\s\S]*?\$cmd\$/g, "").replace(/'[^']*'/g, "''");
  const instructions = horsCommandes.split(";").map((s) => s.trim()).filter(Boolean);
  for (const i of instructions) assert.match(i, /^select\s+cron\.(unschedule|schedule)\(/i, `instruction inattendue : ${i.slice(0, 80)}`);
});

test("7. secret : lu dans Vault (cron_secret) au moment de l'appel ; absent ou vide → aucun appel, échec visible", () => {
  assert.ok(!/vault\.(create_secret|update_secret)|insert\s+into\s+vault/i.test(MIGRATION), "la migration n'écrit jamais le secret");
  const p = planifications(MIGRATION);
  for (const a of ATTENDUS) {
    const c = p.get(a.nom).commande;
    assert.match(c, /select decrypted_secret into v_secret from vault\.decrypted_secrets where name = 'cron_secret';/, a.nom);
    const garde = /if coalesce\(v_secret, ''\) = '' then\s*\n\s*raise exception '[^']+'/.exec(c);
    assert.ok(garde, `${a.nom} : sans secret, exception (job en échec dans cron.job_run_details)`);
    assert.ok(c.indexOf(garde[0]) < c.indexOf("net.http_get"), `${a.nom} : la vérification du secret précède l'appel`);
    assert.equal((c.match(/net\.http_/g) || []).length, 1, `${a.nom} : un seul appel réseau`);
  }
});

// ── 4. Workflows GitHub : plus de schedule ──────────────────────────────────
test("8. les 7 workflows GitHub n'ont plus de schedule et restent lançables à la main", () => {
  for (const a of ATTENDUS) {
    const wf = lire(`.github/workflows/${a.workflow}`);
    assert.ok(!/^\s*schedule:/m.test(wf), `${a.workflow} : schedule encore présent`);
    assert.ok(!/^\s*- cron:/m.test(wf), `${a.workflow} : ligne cron encore présente`);
    assert.match(wf, /^\s*workflow_dispatch:/m, `${a.workflow} : workflow_dispatch`);
    assert.ok(!/"schedule"/.test(wf), `${a.workflow} : branche « schedule » devenue morte`);
    assert.match(wf, new RegExp(a.nom), `${a.workflow} : le commentaire renvoie au job pg_cron`);
    assert.match(wf, /cron-dispatcher\?job=/);
  }
  assert.match(lire(".github/workflows/verify-cron-notifications.yml"), /node scripts\/verif-cron-notifications\.mjs/);
});

// ── 5. Aucune valeur de secret dans le dépôt ────────────────────────────────
test("9. aucune valeur de secret dans le dépôt (jeton Bearer en clair, CRON_SECRET affecté, secret Vault créé)", () => {
  // Jetons manifestement fictifs déjà utilisés par d'autres vérifications.
  const FICTIFS = new Set(["abcdefghijklmnopqrstuvwxyz0123456789", "secret-verif-copilot", "secret-fictif"]);
  const fichiers = execSync("git ls-files", { cwd: chemin("."), encoding: "utf8" }).split("\n")
    .filter((f) => f && /\.(m?js|jsx|ts|tsx|sql|ya?ml|json|md|toml|sh|html|env|txt)$/i.test(f) && !/package-lock\.json$/.test(f));
  assert.ok(fichiers.length > 100, "liste des fichiers suivis");
  const fautes = [];
  for (const f of fichiers) {
    let txt;
    try { txt = lire(f); } catch { continue; }
    for (const m of txt.matchAll(/Bearer\s+([A-Za-z0-9_.~+/=-]{16,})/g)) if (!FICTIFS.has(m[1])) fautes.push(`${f} : Bearer ${m[1].slice(0, 4)}…`);
    for (const m of txt.matchAll(/CRON_SECRET\s*[:=]\s*["']?([A-Za-z0-9_+/=-]{12,})/g)) if (!FICTIFS.has(m[1])) fautes.push(`${f} : CRON_SECRET = ${m[1].slice(0, 4)}…`);
    if (/vault\.create_secret\s*\(\s*'/i.test(txt)) fautes.push(`${f} : vault.create_secret avec une valeur écrite`);
  }
  assert.deepEqual(fautes, []);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (aucune base, aucun réseau)`);
process.exit(echecs ? 1 : 0);
