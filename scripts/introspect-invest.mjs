// scripts/introspect-invest.mjs — Relevé des colonnes réelles des tables Invest.
//
// Pourquoi : dix-sept des dix-neuf tables Invest n'ont pas de migration dans le
// dépôt. Le code se défend donc contre un schéma qu'il ne peut pas connaître —
// cascades de charges utiles dégradées à la conversion de prospect, huit noms
// de tables interrogés au hasard au chargement du tableau de bord. Ce script
// remplace la devinette par un relevé.
//
// Méthode : l'endpoint d'introspection OpenAPI de PostgREST est fermé sur ce
// projet (401 avec la clé anon), mais lire une ligne suffit — les clés du JSON
// renvoyé SONT les colonnes. On demande une ligne par table.
//
// Limites, assumées et signalées dans la sortie :
//   • une table vide, ou dont la RLS masque tout à la clé anon, ne révèle
//     aucune colonne. Le script le dit au lieu de conclure « pas de colonnes ».
//   • on obtient les NOMS, pas les types ni les contraintes. C'est ce qu'il
//     faut pour supprimer la devinette côté code ; un vrai `supabase db dump`
//     reste nécessaire pour une migration de référence complète.
//
// Usage :  node scripts/introspect-invest.mjs [--json]
//
// Aucune dépendance. Lit VITE_SUPABASE_URL / VITE_SUPABASE_KEY dans .env,
// comme les autres scripts du dossier.

import { readFileSync } from "node:fs";

function lireEnv() {
  const env = {};
  for (const f of ["../.env", "../ID.env"]) {
    try {
      for (const ligne of readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/)) {
        const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* fichier absent */ }
  }
  return { ...env, ...process.env };
}

const env = lireEnv();
const URL_BASE = String(env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const CLE = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_KEY;

if (!URL_BASE || !CLE) {
  console.error("VITE_SUPABASE_URL ou clé absente de .env / ID.env.");
  process.exit(1);
}

// Toutes les tables référencées par le code Invest, plus les candidates que le
// tableau de bord interroge à l'aveugle — c'est justement ce qu'on veut trancher.
const TABLES = [
  "invest_clients", "invest_biens", "invest_projets", "invest_propositions",
  "invest_planning", "invest_notes", "invest_mission_actions",
  "invest_action_notifications", "invest_morning_routine_items",
  "invest_structuration_patrimoniale", "invest_suivi_financier",
  "invest_drive_links", "invest_etats_des_lieux", "invest_urbanisme_dossiers",
  "sourcing_annonces", "sourcing_criteres", "sourcing_logs",
  "utilisateurs",
  // Candidates interrogées par Dashboard.jsx : lesquelles existent vraiment ?
  "invest_prospects", "invest_prospection", "invest_crm_prospects",
  "invest_crm_prospection", "invest_prospection_contacts",
  "crm_prospection", "crm_prospects", "prospects",
];

const ENTETES = { apikey: CLE, Authorization: `Bearer ${CLE}` };

async function inspecter(table) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=1`, { headers: ENTETES });
  if (!r.ok) {
    const corps = await r.text().catch(() => "");
    let code = "";
    try { code = JSON.parse(corps)?.code || ""; } catch { /* corps non JSON */ }
    // La table n'existe pas : c'est une RÉPONSE, pas une panne.
    //   42P01  → erreur PostgreSQL « relation inexistante »
    //   PGRST205 → PostgREST ne la trouve pas dans son cache de schéma, ce qui
    //              revient au même du point de vue de l'application.
    if (code === "42P01" || code === "PGRST205" || /does not exist/i.test(corps)
        || /could not find the table/i.test(corps)) return { etat: "absente" };
    return { etat: "erreur", detail: code || `HTTP ${r.status}` };
  }
  const lignes = await r.json();
  if (!Array.isArray(lignes) || lignes.length === 0) return { etat: "vide" };
  return { etat: "ok", colonnes: Object.keys(lignes[0]).sort() };
}

const resultats = {};
for (const t of TABLES) {
  try { resultats[t] = await inspecter(t); }
  catch (e) { resultats[t] = { etat: "erreur", detail: e.message }; }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(resultats, null, 2));
  process.exit(0);
}

const par = (etat) => Object.entries(resultats).filter(([, v]) => v.etat === etat);

console.log("Colonnes réelles des tables Invest");
console.log("═".repeat(62));

for (const [t, v] of par("ok")) {
  console.log(`\n${t}  (${v.colonnes.length} colonnes)`);
  console.log("  " + v.colonnes.join(", "));
}

const vides = par("vide");
if (vides.length) {
  console.log("\n" + "─".repeat(62));
  console.log("Aucune ligne lisible — table vide, ou RLS qui masque tout à cette clé.");
  console.log("Les colonnes restent inconnues, ce n'est PAS « aucune colonne » :");
  for (const [t] of vides) console.log(`  · ${t}`);
}

const absentes = par("absente");
if (absentes.length) {
  console.log("\n" + "─".repeat(62));
  console.log("N'existent pas dans la base :");
  for (const [t] of absentes) console.log(`  · ${t}`);
}

const erreurs = par("erreur");
if (erreurs.length) {
  console.log("\n" + "─".repeat(62));
  console.log("Non inspectables :");
  for (const [t, v] of erreurs) console.log(`  · ${t} — ${v.detail}`);
}

console.log("\n" + "═".repeat(62));
console.log(`${par("ok").length} tables relevées · ${vides.length} illisibles · ${absentes.length} absentes`);
