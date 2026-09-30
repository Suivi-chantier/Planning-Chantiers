#!/usr/bin/env node
// Vérifie la Tranche 2b-bis : le Copilote Invest raisonne sur le Dossier
// Invest (moteur commun pilotage.mjs), plus sur invest_clients.etape.
//
// Les outils réels (api/_ia/invest/outils.js) sont exécutés contre un faux
// client Supabase qui FILTRE réellement (eq, in, is, or/ilike…), injecté à la
// place du paquet @supabase/supabase-js : aucun réseau, aucune base, aucune
// dépendance à installer.
//
// Jeu de données : exemple issu des tests, données fictives. Il reproduit la
// forme de deux cas réels relevés le 30/09/2026 : un dossier avec Financement
// ET Acquisition en cours (cas « Sanyas ») et le dossier étalon RECETTE-T2A.
//
//   node scripts/verif-invest-copilote-2b.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");

// ── Faux Supabase ───────────────────────────────────────────────────────────
const JOURNAL = { tables: [], selects: {} };
let TABLES = {};
function fauxClient() {
  return {
    from(nom) {
      JOURNAL.tables.push(nom);
      const filtres = []; let tri = null; let plafond = null; let colonnes = "*";
      const norm = (v) => String(v ?? "").toLowerCase();
      const passe = (r) => filtres.every((f) => f(r));
      const b = {
        select(c) { colonnes = c; (JOURNAL.selects[nom] ||= []).push(c); return b; },
        eq(c, v) { filtres.push((r) => r[c] === v); return b; },
        in(c, v) { filtres.push((r) => v.includes(r[c])); return b; },
        is(c, v) { filtres.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
        lt(c, v) { filtres.push((r) => r[c] != null && String(r[c]) < String(v)); return b; },
        not() { return b; },
        ilike(c, motif) { const m = norm(motif).replace(/%/g, ""); filtres.push((r) => norm(r[c]).includes(m)); return b; },
        or(expr) {
          const conds = expr.split(",").map((x) => { const [c, , ...v] = x.split("."); return [c, norm(v.join(".")).replace(/%/g, "")]; });
          filtres.push((r) => conds.some(([c, m]) => norm(r[c]).includes(m))); return b;
        },
        order(c, o) { tri = { c, asc: o?.ascending !== false }; return b; },
        limit(n) { plafond = n; return b; },
        maybeSingle() { return b._exec().then((r) => ({ data: r.error ? null : (r.data[0] || null), error: r.error })); },
        _exec() {
          const rows = TABLES[nom];
          if (rows === undefined) return Promise.resolve({ data: null, error: { code: "42P01", message: `table ${nom} indisponible` } });
          let out = rows.filter(passe);
          if (tri) out = [...out].sort((x, y) => (tri.asc ? 1 : -1) * String(x[tri.c] ?? "").localeCompare(String(y[tri.c] ?? "")));
          if (plafond != null) out = out.slice(0, plafond);
          return Promise.resolve({ data: out, error: null });
        },
        then(res, rej) { return b._exec().then(res, rej); },
      };
      return b;
    },
  };
}
const faux = "/__faux_supabase__.js";
const resoudre = Module._resolveFilename;
Module._resolveFilename = function (req, ...r) { return req === "@supabase/supabase-js" ? faux : resoudre.call(this, req, ...r); };
require.cache[faux] = { id: faux, filename: faux, loaded: true, exports: { createClient: () => fauxClient() } };
process.env.SUPABASE_URL = "http://faux"; process.env.SUPABASE_SERVICE_ROLE_KEY = "faux";

const { TOUS } = require("../api/_ia/invest/outils.js");
const donnees = require("../api/_ia/invest/donnees.js");
const { chargerDossiers } = require("../api/_ia/invest/moteur.js");
const copilote = require("../api/_ia/taches/invest_copilot.js");
// Les outils sont appelés directement : la portée (rôles) est testée ailleurs.
const outil = (n) => TOUS.find((o) => o.nom === n);

// ── Jeu fictif ──────────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const jour = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const U = [{ id: "u-m", nom: "Matthieu Fumoleau", email: "m@test.fr", role: "admin" }, { id: "u-c", nom: "Camille Landais", email: "c@test.fr", role: "commercial" }];
// L'ancienne étape de chaque client est volontairement FAUSSE : si le Copilote
// la lisait encore, les résultats seraient faux.
const clients = [
  { id: "c-sanyas", nom: "SANYAS", prenom: "RAPHAEL", statut: "Actif", conseiller: "Matthieu", etape: "1 Signature contrat", prochaine_action: "ANCIENNE", date_prochaine_action: "2020-01-01" },
  { id: "c-t2a", nom: "RECETTE-T2A", prenom: "NE PAS UTILISER", statut: "Actif", conseiller: "Matthieu", etape: "13 Signature Notaire" },
  { id: "c-bloque", nom: "BLOQUÉ", prenom: "Bruno", statut: "Actif", conseiller: "Camille", etape: "8 Signature du compromis" },
  { id: "c-sans", nom: "SANSDOSSIER", prenom: "Sonia", statut: "Actif", conseiller: "Camille", etape: "10 Obtention du financement" },
];
const dossiers = [
  { id: "d-sanyas", client_id: "c-sanyas", reference: "INV-T-0009", libelle: "D", statut: "actif", conseiller_id: "u-m" },
  { id: "d-t2a", client_id: "c-t2a", reference: "INV-T-0023", libelle: "D", statut: "ouvert", conseiller_id: "u-m" },
  { id: "d-bloque", client_id: "c-bloque", reference: "INV-T-0030", libelle: "D", statut: "actif", conseiller_id: "u-c" },
  { id: "d-vieux", client_id: "c-sans", reference: "INV-T-0001", libelle: "Ancien", statut: "clos", conseiller_id: "u-c" },
];
const E = (dossier, etape, statut, x = {}) => ({ id: `${dossier}-${etape}`, dossier_id: dossier, operation_id: null, etape, statut, balle: null,
  balle_utilisateur_id: null, balle_tiers_libelle: null, prochaine_action: null, echeance: null, blocage_motif: null, bloquee_depuis: null,
  reprise_a_confirmer: false, updated_at: `${jour(0)}T09:00:00Z`, ...x });
const etapes = [
  E("d-sanyas", "signature", "terminee"), E("d-sanyas", "recherche", "terminee"),
  E("d-sanyas", "financement", "en_cours", { balle: "banque", balle_tiers_libelle: "Banque A", reprise_a_confirmer: true }),
  E("d-sanyas", "acquisition", "en_cours", { balle: "profero", balle_utilisateur_id: "u-m", prochaine_action: "Préparer le rendez-vous notaire", echeance: jour(5), reprise_a_confirmer: true }),
  E("d-sanyas", "suivi", "a_venir"),
  E("d-t2a", "signature", "en_cours", { balle: "profero", balle_utilisateur_id: "u-m" }),
  E("d-t2a", "collecte", "en_cours", { balle: "profero", balle_utilisateur_id: "u-m", prochaine_action: "Relancer le client pour la pièce", echeance: jour(31) }),
  E("d-t2a", "documents", "terminee", { prochaine_action: "Ancienne action historique", echeance: jour(-30) }),
  E("d-t2a", "analyse", "en_cours", { balle: "client" }),
  E("d-t2a", "strategie", "a_venir", { reprise_a_confirmer: true }),
  E("d-t2a", "structuration", "non_applicable"),
  E("d-bloque", "documents", "bloquee", { balle: "client", blocage_motif: "Avis d'imposition manquant", bloquee_depuis: jour(-4), prochaine_action: "Obtenir l'avis", echeance: jour(-2) }),
  E("d-vieux", "suivi", "en_cours", { balle: "profero", balle_utilisateur_id: "u-c", prochaine_action: "Dossier clos : jamais une action" }),
];
const taches = [
  { id: "t1", client_id: "c-bloque", dossier_id: "d-bloque", etape: "documents", step_key: "documents", step_label: "Documents", step_index: 3, action_title: "Relancer l'avis d'imposition", status: "a_faire", due_date: jour(-6), responsable: "Camille" },
  { id: "t2", client_id: "c-t2a", dossier_id: "d-t2a", etape: "collecte", step_key: "collecte", step_label: "Collecte", step_index: 2, action_title: "Reste ouverte", status: "a_faire", due_date: null, responsable: "Matthieu" },
];
const BASE = () => ({
  invest_clients: clients.map((c) => ({ ...c })), invest_dossiers: dossiers, invest_dossier_etapes: etapes, invest_mission_actions: taches,
  utilisateurs: U, invest_biens: [], invest_propositions: [], invest_planning: [], invest_action_notifications: [],
  invest_suivi_financier: [], invest_notes: [],
});
const PROFIL = { nom: "Matthieu Fumoleau", email: "m@test.fr" };
const exec = (nom, params = {}) => outil(nom).executer(params, { profil: PROFIL });

const cas = [];
const test = (n, f) => cas.push([n, f]);
const reinit = () => { TABLES = BASE(); JOURNAL.tables = []; JOURNAL.selects = {}; };

test("1. Sanyas : plusieurs étapes actives, balles Banque et Profero, principale et action du jour", async () => {
  reinit();
  const r = await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false });
  const d = r.dossier_invest;
  assert.equal(d.situation, "dossier_en_cours"); assert.equal(d.reference, "INV-T-0009");
  assert.deepEqual(d.etapes_actives.map((a) => [a.etape, a.balle]), [["Financement", "Banque (Banque A)"], ["Acquisition", "Profero (Matthieu Fumoleau)"]]);
  assert.equal(d.etape_principale.etape, "Acquisition", "la plus avancée des étapes en cours");
  assert.deepEqual(d.action_du_jour, { qui: "Matthieu Fumoleau", quoi: "Préparer le rendez-vous notaire", avant: jour(5), etape: "Acquisition" });
  assert.equal(d.etapes_a_confirmer, 2);
  assert.equal(r.prochaine_action.libelle, "Préparer le rendez-vous notaire");
  assert.ok(!JSON.stringify(r).includes("ANCIENNE") && !JSON.stringify(r).includes("Signature contrat"), "aucune trace de l'ancienne étape / action");
});

test("2. recherche par étape SECONDAIRE active : Sanyas trouvé par Financement ET par Acquisition (et par « banque »)", async () => {
  reinit();
  for (const etape of ["financement", "Acquisition", "banque", "profero"]) {
    const r = await exec("recherche_clients", { etape });
    assert.ok(r.clients.some((c) => c.id === "c-sanyas"), `${etape} : ${JSON.stringify(r.titre)}`);
  }
  const sig = await exec("recherche_clients", { etape: "signature" });
  assert.ok(!sig.clients.some((c) => c.id === "c-sanyas"), "Signature terminée chez Sanyas : pas trouvé (l'ancienne étape « 1 Signature contrat » est ignorée)");
  assert.ok(sig.clients.some((c) => c.id === "c-t2a"), "Signature active chez RECETTE-T2A");
  const fin = await exec("recherche_clients", { etape: "financement" });
  assert.ok(!fin.clients.some((c) => c.id === "c-sans"), "l'ancienne étape « 10 Obtention du financement » ne compte pas");
  const rien = await exec("recherche_clients", { etape: "opportunites" });
  assert.equal(rien.total, 0); assert.match(rien.titre, /Aucun dossier avec une étape « opportunites » en cours/);
});

test("3. RECETTE-T2A (forme reproduite) : balle Client sur la principale, action Profero sur une autre étape, étape terminée ignorée", async () => {
  reinit();
  const d = (await exec("resume_client", { client_id: "c-t2a", inclure_notes: false, inclure_biens: false })).dossier_invest;
  assert.equal(d.etape_principale.etape, "Analyse"); assert.equal(d.etape_principale.balle, "Client");
  assert.deepEqual(d.etapes_actives.map((a) => a.etape), ["Signature", "Collecte", "Analyse"]);
  assert.equal(d.action_du_jour.etape, "Collecte"); assert.equal(d.action_du_jour.avant, jour(31));
  assert.ok(!JSON.stringify(d).includes("Ancienne action historique"), "étape terminée : historique, pas action");
  assert.equal(d.etapes_a_confirmer, 1); assert.equal(d.taches_ouvertes, 1);
});

test("4. blocage, échéance dépassée et tâche en retard : alertes du moteur, retrouvées par dossiers_bloques", async () => {
  reinit();
  const d = (await exec("resume_client", { client_id: "c-bloque", inclure_notes: false, inclure_biens: false })).dossier_invest;
  assert.equal(d.etape_principale.blocage, "Avis d'imposition manquant");
  assert.deepEqual(d.taches_en_retard, [{ tache: "Relancer l'avis d'imposition", echeance: jour(-6) }]);
  const codes = d.alertes.map((a) => a.code);
  assert.ok(codes.includes("echeance_depassee_documents") && codes.includes("bloquee_documents") && codes.includes("tache_retard_t1"), codes.join(","));
  const bl = await exec("dossiers_bloques", { motif: "bloque" });
  assert.ok(bl.dossiers.some((x) => x.id === "c-bloque"));
  assert.equal(bl.dossiers.find((x) => x.id === "c-bloque").dossier_invest.situation, "dossier_en_cours");
  const fin = await exec("dossiers_bloques", { motif: "financement" });
  assert.deepEqual(fin.dossiers.map((x) => x.id), ["c-sanyas"], "Financement actif (étape secondaire), pas l'ancienne étape");
});

test("5. échéances : celle de l'étape Acquisition de Sanyas, filtrable par étape active", async () => {
  reinit();
  const r = await exec("echeances_a_venir", { jours: 7, motif: "acquisition" });
  assert.ok(r.echeances.some((e) => e.dossier === "RAPHAEL SANYAS" && e.date === jour(5)), JSON.stringify(r.echeances));
  const fin = await exec("echeances_a_venir", { jours: 7, motif: "financement" });
  assert.ok(fin.echeances.some((e) => e.dossier === "RAPHAEL SANYAS"), "Financement actif aussi → le dossier sort sur ce motif");
});

test("6. client sans dossier en cours : situation explicite, pas une erreur (dossier clos ignoré)", async () => {
  reinit();
  const r = await exec("resume_client", { client_id: "c-sans", inclure_notes: false, inclure_biens: false });
  assert.deepEqual(r.dossier_invest, { situation: "aucun_dossier", libelle: "Aucun Dossier Invest en cours" });
  assert.equal(r.prochaine_action.libelle, null);
  assert.ok(!JSON.stringify(r).includes("Dossier clos : jamais une action"));
  const l = await exec("recherche_clients", { recherche: "sansdossier" });
  assert.equal(l.clients[0].dossier_invest.situation, "aucun_dossier");
  const { consolide } = await chargerDossiers({ profil: PROFIL });
  assert.equal(consolide.clientDossiers.find((d) => d.id === "c-sans").alerts[0].code, "sans_dossier_invest");
});

test("7. données Dossier Invest indisponibles : « avancement indisponible », distinct de « aucun dossier »", async () => {
  reinit(); delete TABLES.invest_dossier_etapes;
  const r = await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false });
  assert.equal(r.dossier_invest.situation, "avancement_indisponible");
  assert.ok(r.avertissements.some((a) => /étapes des dossiers/.test(a)));
  const rech = await exec("recherche_clients", { etape: "financement" });
  assert.equal(rech.type, "absence"); assert.match(rech.titre, /Avancement indisponible/);
  const pr = await exec("priorites_du_jour", { perimetre: "equipe" });
  const tous = [...pr.priorites];
  assert.ok(tous.every((d) => d.type !== "client" || d.dossier_invest.situation === "avancement_indisponible"));
  const { consolide } = await chargerDossiers({ profil: PROFIL });
  assert.equal(consolide.avancementInconnu, true);
  assert.ok(consolide.clientDossiers.every((d) => d.alerts[0].code === "avancement_inconnu"), "jamais « sans dossier » quand c'est inconnu");
  reinit(); delete TABLES.invest_dossiers;
  assert.equal((await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false })).dossier_invest.situation, "avancement_indisponible");
});

test("8. aucune dépendance à invest_clients.etape (dynamique et statique)", async () => {
  reinit();
  const avant = await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false });
  TABLES.invest_clients = TABLES.invest_clients.map((c) => ({ ...c, etape: "7 Réalisation des devis précis", etape_num: 7, prochaine_action: "X", date_prochaine_action: "2019-01-01" }));
  const apres = await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false });
  assert.deepEqual(apres.dossier_invest, avant.dossier_invest); assert.deepEqual(apres.prochaine_action, avant.prochaine_action);
  assert.ok((JOURNAL.selects.invest_clients || []).every((s) => !/\betape\b|prochaine_action/.test(s)), JOURNAL.selects.invest_clients.join(" | "));
  const code = ["api/_ia/invest/outils.js", "api/_ia/invest/moteur.js", "api/_ia/taches/invest_copilot.js"]
    .map((f) => lire(f).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n")).join("\n");
  assert.ok(!/etape_num|ilike\("etape"|client\.etape|c\.etape\b/.test(code));
  assert.ok(!/13 étapes|Signature Notaire|ETAPES_CLIENT/.test(code), "prompt : plus les 13 anciennes étapes");
  const prompt = (await copilote.construire_prompt({ question: "où en est Sanyas ?" }, {})).system;
  assert.match(prompt, /11 étapes/); assert.match(prompt, /8 Financement/); assert.match(prompt, /EN MÊME TEMPS/);
  assert.match(prompt, /Aucun Dossier Invest en cours/); assert.match(prompt, /Avancement indisponible/);
});

test("9. liste blanche : dossiers et étapes seulement ; ni journal, ni utilisateurs ; noms lus par une porte étroite", async () => {
  assert.ok(donnees.TABLES_AUTORISEES.has("invest_dossiers") && donnees.TABLES_AUTORISEES.has("invest_dossier_etapes"));
  assert.ok(!donnees.TABLES_AUTORISEES.has("invest_dossier_evenements"), "journal complet non exposé");
  assert.ok(!donnees.TABLES_AUTORISEES.has("utilisateurs"));
  assert.throws(() => donnees.table("invest_dossier_evenements"), /hors périmètre/);
  assert.throws(() => donnees.table("utilisateurs"), /hors périmètre/);
  assert.throws(() => donnees.table("invest_prospects"), /interdite/);
  reinit();
  await exec("resume_client", { client_id: "c-sanyas", inclure_notes: false, inclure_biens: false });
  assert.deepEqual([...new Set(JOURNAL.selects.utilisateurs)], ["id,nom"], "seulement id et nom, jamais e-mail ni rôle");
  assert.ok(!JOURNAL.tables.includes("invest_dossier_evenements"));
  const avant = donnees.TABLES_AUTORISEES.size;
  assert.equal(avant, 18, "16 tables d'origine + 2 ajoutées");
});

let echecs = 0;
for (const [n, f] of cas) {
  try { await f(); console.log(`  ✓ ${n}`); }
  catch (e) { echecs++; console.log(`  ✗ ${n}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
