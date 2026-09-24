// scripts/verif-renovation-copilot-v1.mjs — Assistant IA Rénovation, étape 1
// (Chantier 10) + correctif « crédit IA épuisé » du socle.
//
// TOUTES LES DONNÉES DE CE SCRIPT SONT FICTIVES (fixtures écrites ici). Aucun
// accès à la base, aucun appel réel au modèle : le client Supabase et le SDK
// Anthropic sont remplacés par des faux en mémoire, injectés dans le cache de
// require() avant le chargement des modules de api/.
//
// Lancement : node scripts/verif-renovation-copilot-v1.mjs

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// ── Environnement factice, AVANT tout chargement de api/ ─────────────────────
process.env.SUPABASE_URL = "https://faux.supabase.local";
process.env.VITE_SUPABASE_URL = "https://faux.supabase.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fausse-cle-service";
process.env.ANTHROPIC_API_KEY = "fausse-cle-anthropic";
delete process.env.CRON_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// Faux client Supabase (en mémoire)
// ─────────────────────────────────────────────────────────────────────────────
const ecritures = []; // { table, op, lignes }

class Requete {
  constructor(etat, nom) {
    this.etat = etat; this.nom = nom; this.filtres = [];
    this.tri = null; this.plage = null; this.lim = null; this.mode = "many";
    this.op = "select"; this.payload = null;
  }
  select() { return this; }
  eq(c, v) { this.filtres.push((r) => String(r[c]) === String(v)); return this; }
  in(c, vs) { const s = new Set(vs.map(String)); this.filtres.push((r) => s.has(String(r[c]))); return this; }
  gte(c, v) { this.filtres.push((r) => String(r[c] ?? "") >= String(v)); return this; }
  order(c, { ascending = true } = {}) { this.tri = { c, ascending }; return this; }
  range(a, b) { this.plage = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  insert(l) { this.op = "insert"; this.payload = l; return this; }
  upsert(l) { this.op = "upsert"; this.payload = l; return this; }
  executer() {
    if (this.op !== "select") {
      const lignes = Array.isArray(this.payload) ? this.payload : [this.payload];
      ecritures.push({ table: this.nom, op: this.op, lignes });
      const rendu = lignes.map((l, i) => ({ id: `id-${ecritures.length}-${i}`, ...l }));
      return { data: this.mode === "many" ? rendu : rendu[0], error: null };
    }
    let rows = (this.etat.tables[this.nom] || []).filter((r) => this.filtres.every((f) => f(r)));
    if (this.tri) {
      const { c, ascending } = this.tri;
      rows = [...rows].sort((a, b) => {
        const x = String(a[c] ?? ""), y = String(b[c] ?? "");
        return ascending ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (this.plage) rows = rows.slice(this.plage[0], this.plage[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.mode === "maybe") return { data: rows[0] || null, error: null };
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "0 ou plusieurs lignes" } };
    return { data: rows, error: null };
  }
  then(res, rej) {
    try { return Promise.resolve(this.executer()).then(res, rej); }
    catch (e) { return Promise.reject(e).then(res, rej); }
  }
}

const etatBase = { tables: {} };
const JETONS = { "jeton-admin": "admin@test.local", "jeton-conducteur": "conducteur@test.local", "jeton-admin-invest": "invest@test.local" };
const fauxClient = {
  auth: {
    async getUser(jeton) {
      const email = JETONS[jeton];
      return email ? { data: { user: { id: `u-${email}`, email } }, error: null } : { data: null, error: { message: "jeton invalide" } };
    },
  },
  from: (nom) => new Requete(etatBase, nom),
};
const clientSur = (tables) => ({ from: (nom) => new Requete({ tables }, nom) });

// ─────────────────────────────────────────────────────────────────────────────
// Faux SDK Anthropic : il rejoue un scénario, et enregistre ce qu'il reçoit
// ─────────────────────────────────────────────────────────────────────────────
const modele = { scenario: [], recus: [] };
class ErreurSDK extends Error {}
class FauxAnthropic {
  constructor() {
    this.messages = {
      create: async (params) => {
        modele.recus.push(JSON.parse(JSON.stringify(params)));
        const etape = modele.scenario.shift();
        if (!etape) throw new Error("scénario du faux modèle épuisé");
        if (etape.erreur) throw etape.erreur;
        return etape;
      },
    };
  }
}
FauxAnthropic.APIConnectionError = class extends ErreurSDK {};
FauxAnthropic.RateLimitError = class extends ErreurSDK {};
FauxAnthropic.InternalServerError = class extends ErreurSDK {};

function injecter(nomModule, exportsFactices) {
  const chemin = require.resolve(nomModule, { paths: [path.join(RACINE, "api")] });
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: exportsFactices };
}
injecter("@supabase/supabase-js", { createClient: () => fauxClient });
injecter("@anthropic-ai/sdk", FauxAnthropic);

// Chargement des modules testés (APRÈS l'injection)
const { estCreditEpuise, CODE_CREDIT_EPUISE, MESSAGE_CREDIT_EPUISE } = require("../api/_ia/erreursModele.js");
const { autoriserRenovation } = require("../api/_ia/renovation/portee.js");
const { envelopperLecture, TABLES_AUTORISEES } = require("../api/_ia/renovation/donnees.js");
const { parNom, CHANTIERS_EXCLUS_ALERTES, semainePrecedente } = require("../api/_ia/renovation/outils.js");
const tache = require("../api/_ia/taches/renovation_copilot.js");
const REGISTRE = require("../api/_ia/registre.js");
const routeAI = require("../api/ai.js");
const cronHebdo = require("../api/cron-snapshot-hebdo.js");
const { chargerDonneesFinance } = require("../api/_partage/donneesFinanceChantiers.js");

const finance = await import("../src/chantierFinance.mjs");
const alertesMod = await import("../src/Renovation/alertesV1.mjs");
const donneesAttention = await import("../src/Renovation/pointsAttentionDonneesV1.mjs");
const donneesLiees = await import("../src/Renovation/avancementDonneesLiees.mjs");
const semainesMod = await import("../src/Renovation/bilanSemaineProchaineV1.mjs");

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — DONNÉES FICTIVES
// ─────────────────────────────────────────────────────────────────────────────
const ouvrage = (id, prix, heures, av, lot = "lot1") => ({
  id, libelle: `Ouvrage ${id}`, lot_id: lot, prix_ht: prix, heures_devis: heures, cout_materiaux: prix / 5,
  taches: [{ id: `t-${id}`, avancement: av, heures_estimees: heures }],
});
const pointage = (chantier_id, tache_id, heures, date) => ({
  id: `p-${chantier_id}-${tache_id}-${date}`, chantier_id, tache_id, heures, taux_horaire: 30,
  date, type_pointage: "tache", ouvrier: "Ouvrier fictif",
});
const snap = (chantier_id, chantier_nom, week_id, date_snapshot, v = {}) => ({
  chantier_id, chantier_nom, week_id, date_snapshot, created_at: `${date_snapshot}T18:10:00Z`,
  avancement: 50, heures_vendues: 100, heures_reelles: 40, marge: 3000, marge_terminaison: 2000, warnings: [], ...v,
});

function fixtures() {
  const chantiers = [
    { id: "briollay-1", nom: "BRIOLLAY", statut: "en_cours" },
    { id: "briollay-appt-1", nom: "BRIOLLAY APPT 1" },
    { id: "briollay-appt-2", nom: "BRIOLLAY APPT 2" },
    { id: "briollay-appt-3", nom: "BRIOLLAY APPT 3" },
    { id: "briollay-appt-4", nom: "BRIOLLAY APPT 4" },
    { id: "briollay-appt-5", nom: "BRIOLLAY APPT 5" },
    { id: "ch-test-a", nom: "CHANTIER TEST A" },
    { id: "ch-test-b", nom: "CHANTIER TEST B" },
    { id: "depot-1", nom: "DÉPOT" },
  ];
  const historiqueA = [];
  const semaines = ["2026-W29", "2026-W30", "2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35", "2026-W36", "2026-W37"];
  const vendredis = ["2026-07-17", "2026-07-24", "2026-07-31", "2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04", "2026-09-11"];
  semaines.forEach((w, i) => historiqueA.push(snap("ch-test-a", "CHANTIER TEST A", w, vendredis[i], { avancement: 10 + i * 5, heures_reelles: 10 + i * 5, marge: 4000 - i * 100 })));
  // Doublon de relevé en W31 (le cron avait tourné deux fois) : la ligne la
  // plus récemment écrite doit faire foi.
  historiqueA.push({ ...snap("ch-test-a", "CHANTIER TEST A", "2026-W31", "2026-07-31", { avancement: 99, marge: -1 }), created_at: "2026-07-31T08:00:00Z" });

  return {
    planning_config: [
      { key: "chantiers", value: chantiers },
      { key: "taux_horaires", value: { "Ouvrier fictif": 30 } },
      { key: "taux_mo_previsionnel", value: 28 },
      { key: "lots_travaux", value: { items: [{ id: "lot1", label: "Plâtrerie" }] } },
      { key: "etats_financiers", value: { avancement: { periods: [{ id: "p1" }], rows: [{ chantier: "CHANTIER TEST A", values: { p1: { pctFacture: "30" } } }] } } },
    ],
    phasages: [
      { id: "ph-a-ancien", chantier_id: "ch-test-a", chantier_nom: "CHANTIER TEST A", updated_at: "2026-01-01T00:00:00Z",
        plan_travaux: { meta: { fg_taux_horaire: 12 } }, ouvrages: [ouvrage("vieux", 999999, 1, 0)] },
      { id: "ph-a", chantier_id: "ch-test-a", chantier_nom: "CHANTIER TEST A", updated_at: "2026-09-20T00:00:00Z",
        plan_travaux: { meta: { fg_taux_horaire: 12 } }, ouvrages: [ouvrage("a1", 10000, 100, 50), ouvrage("a2", 5000, 40, 20)] },
      // Frais généraux NON renseignés → fg_non_regle
      { id: "ph-b", chantier_id: "ch-test-b", chantier_nom: "CHANTIER TEST B", updated_at: "2026-09-20T00:00:00Z",
        plan_travaux: { meta: {} }, ouvrages: [ouvrage("b1", 8000, 80, 40)] },
    ],
    pointages: [
      pointage("ch-test-a", "t-a1", 40, "2026-09-15"),
      pointage("ch-test-a", "t-a2", 12, "2026-09-17"),
      pointage("ch-test-b", "t-b1", 30, "2026-09-16"),
    ],
    commande_lignes: [
      { id: "cl1", chantier_id: "ch-test-a", prix_total: 1500, created_at: "2026-09-01T00:00:00Z" },
      { id: "cl2", chantier_id: "ch-test-b", prix_total: 700, created_at: "2026-09-02T00:00:00Z" },
    ],
    materiaux_bibliotheque: [{ id: 1, prix_unitaire: 10 }],
    chantier_factures_client: [
      { chantier_id: "ch-test-a", date_facture: "2026-08-01", progbat_situation_number: 1, progbat_achievement: 2000, progbat_deal_net_total: 15000 },
      { chantier_id: "ch-test-a", date_facture: "2026-09-10", progbat_situation_number: 2, progbat_achievement: 4500, progbat_deal_net_total: 15000 },
    ],
    chantier_snapshots_hebdo: [
      ...historiqueA,
      snap("ch-test-a", "CHANTIER TEST A", "2026-W38", "2026-09-18", { avancement: 55, heures_reelles: 60, marge: 3000, marge_terminaison: -1200,
        warnings: [{ code: "derive_lot", gravite: "alerte", message: "dérive fictive" }] }),
      snap("ch-test-b", "CHANTIER TEST B", "2026-W37", "2026-09-11", { avancement: 40, heures_reelles: 20, marge: 2500 }),
      snap("ch-test-b", "CHANTIER TEST B", "2026-W38", "2026-09-18", { avancement: 40, heures_reelles: 30, marge: 1900,
        warnings: [{ code: "fg_non_regle", gravite: "alerte", message: "frais généraux fictifs non renseignés" }] }),
      snap("depot-1", "DÉPOT", "2026-W37", "2026-09-11", { marge_terminaison: -5000 }),
      snap("depot-1", "DÉPOT", "2026-W38", "2026-09-18", { marge_terminaison: -5000 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Harnais
// ─────────────────────────────────────────────────────────────────────────────
let ok = 0, ko = 0;
const echecs = [];
function verifier(cond, message) {
  if (cond) ok++; else { ko++; echecs.push(message); console.log(`    ✗ ${message}`); }
}
async function bloc(titre, fn) {
  console.log(`\n■ ${titre}`);
  const avant = ko;
  try { await fn(); } catch (e) { ko++; echecs.push(`${titre} : exception ${e.stack || e}`); console.log(`    ✗ exception : ${e.stack || e}`); }
  if (ko === avant) console.log("    ✓");
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const outil = async (nom, params, tables = fixtures()) => parNom[nom].executer(params, { sb: envelopperLecture(clientSur(tables)) });

console.log("Vérification de l'assistant IA Rénovation — toutes les données ci-dessous sont FICTIVES (fixtures du script).");

// ─────────────────────────────────────────────────────────────────────────────
// 1-2. Autorisation
// ─────────────────────────────────────────────────────────────────────────────
await bloc("1. Refus d'un non-administrateur", () => {
  const v = autoriserRenovation({ role: "conducteur", branches: ["renovation"] });
  verifier(typeof v === "string" && /réservé aux administrateurs/.test(v) && v.includes("conducteur"), `refus explicite attendu, reçu ${v}`);
  verifier(autoriserRenovation({ role: "comptable", branches: ["renovation", "invest"] }) !== true, "comptable refusé");
  verifier(autoriserRenovation({ role: "admin", branches: ["renovation"] }) === true, "admin Rénovation accepté");
  verifier(autoriserRenovation({ role: "admin", branches: ["renovation", "invest"] }) === true, "admin des deux branches accepté");
  // Même règle que normalizeBranches() du front : absent ou vide = Rénovation.
  verifier(autoriserRenovation({ role: "admin", branches: null }) === true, "branches absentes = Rénovation (normalizeBranches)");
  verifier(autoriserRenovation({ role: "admin", branches: "{renovation,invest}" }) === true, "littéral Postgres lu");
  verifier(tache.autoriser({ role: "conducteur", branches: ["renovation"] }) !== true, "la tâche délègue bien à autoriserRenovation");
});

await bloc("2. Refus d'un compte de la seule branche Invest", () => {
  const v = autoriserRenovation({ role: "admin", branches: ["invest"] });
  verifier(v === "Ce compte n'a pas accès à la branche Profero Rénovation.", `refus de branche attendu, reçu ${v}`);
  verifier(autoriserRenovation({ role: "admin", branches: '["invest"]' }) !== true, "chaîne JSON invest refusée");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3-4. chercher_chantier
// ─────────────────────────────────────────────────────────────────────────────
await bloc("3. chercher_chantier : nom ambigu → liste, aucun choix", async () => {
  const r = await outil("chercher_chantier", { texte: "briollay" });
  verifier(r.nb === 6 && r.chantiers.length === 6, `6 chantiers attendus, reçu ${r.nb}`);
  verifier(r.ambigu === true, "ambigu = true");
  verifier(/DEMANDER/.test(r.consigne) && /ne pas en choisir/.test(r.consigne), "la consigne interdit de choisir");
  verifier(r.chantiers.every((c) => c.id && c.nom), "chaque résultat porte id et nom");
  verifier(!("chantier_id" in r) && !("choix" in r), "l'outil ne désigne aucun chantier retenu");
});

await bloc("4. chercher_chantier : unique, accents, aucun résultat", async () => {
  const u = await outil("chercher_chantier", { texte: "chantier test a" });
  verifier(u.nb === 1 && u.ambigu === false && u.chantiers[0].id === "ch-test-a" && u.consigne === null, "correspondance unique");
  const d = await outil("chercher_chantier", { texte: "depot" });
  verifier(d.nb === 1 && d.chantiers[0].nom === "DÉPOT", "« depot » retrouve « DÉPOT »");
  const z = await outil("chercher_chantier", { texte: "inexistant" });
  verifier(z.nb === 0 && /Aucun chantier/.test(z.consigne), "aucun résultat dit comme tel");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5-6. etat_chantier
// ─────────────────────────────────────────────────────────────────────────────
await bloc("5. etat_chantier : chiffres = chantierFinance, même chargement que le relevé", async () => {
  const tables = fixtures();
  const r = await outil("etat_chantier", { chantier_id: "ch-test-a" }, tables);
  verifier(r.trouve === true && r.chantier.nom === "CHANTIER TEST A", "chantier trouvé");
  // Référence : le module appelé directement, sur le chargeur partagé du cron.
  const donnees = await chargerDonneesFinance(clientSur(tables));
  const ph = donnees.phasagesUniques.find((p) => p.chantier_id === "ch-test-a");
  verifier(ph.id === "ph-a", "le phasage le plus récent est retenu (règle du cron)");
  const b = finance.computeChantierFinance(donnees.inputsPour(ph)).brut;
  const c = r.chiffres;
  const r2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));
  verifier(c.avancement_pct === b.avancementChantier, "avancement");
  verifier(c.vendu_ht === r2(b.prixHTChantier) && c.vendu_ht === 15000, `vendu ${c.vendu_ht}`);
  verifier(c.marge === r2(b.margeChantier), "marge");
  verifier(c.marge_a_terminaison === r2(b.margeATerminaison), "marge à terminaison");
  verifier(c.heures_vendues === r2(b.heuresVenduesChantier) && c.heures_reelles === r2(b.heuresReellesTotalChantier), "heures");
  verifier(c.reste_a_faire_heures === r2(b.heuresRestantes) && c.reste_a_faire_euros === r2(b.resteAFaireEuros), "reste à faire");
  verifier(c.situation_a_facturer === r2(b.situationAFacturer), "situation à facturer (% facturé des États financiers)");
  const sit = donneesLiees.indexerSituations(tables.chantier_factures_client).get("ch-test-a");
  verifier(c.facture_progbat && c.facture_progbat.numero_situation === 2 && c.facture_progbat.cumul_facture_euros === sit.cumulEuros, "facturé ProGBat = dernière situation (indexerSituations)");
  verifier(r.date_donnees && r.date_donnees.calcule_le && r.date_donnees.dernier_pointage === "2026-09-17", "date des données transmise");
  verifier(r.fiabilite === null && !r.avertissements.some((w) => w.code === "fg_non_regle"), "frais généraux renseignés : pas de drapeau");
  const x = await outil("etat_chantier", { chantier_id: "inconnu" }, tables);
  verifier(x.trouve === false && /ne peut pas être calculé/.test(x.message), "chantier sans phasage : impossibilité visible");
});

await bloc("6. etat_chantier : avertissement « frais généraux non renseignés » transmis", async () => {
  const r = await outil("etat_chantier", { chantier_id: "ch-test-b" });
  verifier(r.avertissements.some((w) => w.code === "fg_non_regle"), "warning fg_non_regle transmis");
  verifier(r.fiabilite === alertesMod.MESSAGE_MARGE_SURESTIMEE, `drapeau de fiabilité du moteur d'alertes, reçu ${r.fiabilite}`);
  verifier(r.chiffres.facture_progbat === null && r.indisponibles.some((t) => /Aucune situation de travaux ProGBat/.test(t)), "facturé ProGBat absent dit comme tel");
  verifier(r.chiffres.situation_a_facturer === null && r.indisponibles.some((t) => /% facturé non disponible/.test(t)), "situation à facturer indisponible dite comme telle");
});

// ─────────────────────────────────────────────────────────────────────────────
// 7-8. alertes
// ─────────────────────────────────────────────────────────────────────────────
await bloc("7. alertes : sortie d'alertesV1 sur le dernier relevé, DÉPOT exclu", async () => {
  const tables = fixtures();
  const r = await outil("alertes", {}, tables);
  verifier(r.semaine_releve === "2026-W38" && r.semaine_comparaison === "2026-W37" && r.date_releve === "2026-09-18", "semaine et date du relevé");
  const [cour, prec] = donneesAttention.preparerSemainesAttentionV1({ lignes: tables.chantier_snapshots_hebdo, weekIds: ["2026-W38", "2026-W37"] });
  const attendu = alertesMod.alertesV1({ snapshotsCourants: cour, snapshotsPrecedents: prec, exclusions: ["DÉPOT"] });
  verifier(egal(r.alertes.map((a) => [a.chantier_id, a.niveau, a.motifs.map((m) => m.code), a.impact_euros]),
    attendu.alertes.map((a) => [a.chantierId, a.niveau, a.motifs, a.impactEuros])), "mêmes alertes, même ordre que le moteur");
  verifier(egal(r.totaux, attendu.totaux), "mêmes totaux");
  verifier(!r.alertes.some((a) => a.nom === "DÉPOT") && r.exclus.includes("DÉPOT"), "DÉPOT exclu et signalé comme tel");
  verifier(r.etat.statut === alertesMod.ETAT_DERIVES, "état : alertes");
  verifier(r.alertes[0].chantier_id === "ch-test-a" && r.alertes[0].niveau === "critique", "marge à terminaison négative en tête");
  const b = r.alertes.find((a) => a.chantier_id === "ch-test-b");
  verifier(b && b.fiabilite === alertesMod.MESSAGE_MARGE_SURESTIMEE && r.marge_surestimee.includes("CHANTIER TEST B"), "drapeau de fiabilité transmis sur l'alerte");
});

await bloc("8. alertes : relevé absent et « aucune alerte » restent distincts", async () => {
  const vide = { ...fixtures(), chantier_snapshots_hebdo: [] };
  const r = await outil("alertes", {}, vide);
  verifier(r.etat.statut === alertesMod.ETAT_RELEVE_ABSENT, `relevé absent attendu, reçu ${r.etat.statut}`);
  verifier(r.etat.message === alertesMod.etatAlertesV1(alertesMod.alertesV1({ snapshotsCourants: [], snapshotsPrecedents: [] })).message, "message du module, pas un texte maison");
  verifier(r.alertes.length === 0 && r.semaine_releve === null && r.date_releve === null, "aucune semaine inventée");
  verifier(!/aucune alerte/i.test(r.etat.message), "le relevé absent ne se lit pas « aucune alerte »");
  const calme = { ...fixtures(), chantier_snapshots_hebdo: [
    snap("ch-test-a", "CHANTIER TEST A", "2026-W37", "2026-09-11"), snap("ch-test-a", "CHANTIER TEST A", "2026-W38", "2026-09-18") ] };
  const c = await outil("alertes", {}, calme);
  verifier(c.etat.statut === alertesMod.ETAT_AUCUNE_DERIVE && c.alertes.length === 0, "relevé présent sans alerte : état « aucune alerte »");
  // Semaine 1 : la précédente est la dernière semaine de l'année d'avant.
  verifier(semainePrecedente("2027-W01", semainesMod) === "2026-W53", `2026 a 53 semaines ISO, reçu ${semainePrecedente("2027-W01", semainesMod)}`);
  verifier(semainePrecedente("2026-W01", semainesMod) === "2025-W52", "2025 a 52 semaines ISO");
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. expliquer_alerte
// ─────────────────────────────────────────────────────────────────────────────
await bloc("9. expliquer_alerte : motifs + 8 derniers relevés dédoublonnés", async () => {
  const r = await outil("expliquer_alerte", { chantier_id: "ch-test-a" });
  verifier(r.alerte && r.alerte.niveau === "critique" && r.alerte.motifs.some((m) => m.code === "marge_terminaison_negative"), "motifs du moteur");
  verifier(r.historique.length === 8, `8 relevés attendus, reçu ${r.historique.length}`);
  verifier(r.historique[0].semaine === "2026-W38" && r.historique[7].semaine === "2026-W31", "du plus récent au plus ancien");
  const w31 = r.historique.find((h) => h.semaine === "2026-W31");
  verifier(w31 && w31.avancement_pct === 20 && w31.marge === 3800, "doublon W31 : la ligne la plus récemment écrite fait foi");
  verifier(r.doublons_ecartes === 1, "le doublon écarté est compté, pas masqué");
  verifier(r.semaine_releve === "2026-W38" && r.date_releve === "2026-09-18", "date du relevé citée");
  const absent = await outil("expliquer_alerte", { chantier_id: "briollay-appt-2" });
  verifier(absent.alerte === null && /ne figure pas/.test(absent.raison_sans_alerte) && /n'est pas « aucune alerte »/.test(absent.raison_sans_alerte), "chantier absent du relevé : pas présenté comme « aucune alerte »");
  verifier(absent.historique.length === 0 && absent.historique_vide, "historique vide dit comme tel");
  const depot = await outil("expliquer_alerte", { chantier_id: "depot-1" });
  verifier(/exclu/.test(depot.raison_sans_alerte), "DÉPOT : exclusion expliquée");
  const vide = await outil("expliquer_alerte", { chantier_id: "ch-test-a" }, { ...fixtures(), chantier_snapshots_hebdo: [] });
  verifier(vide.etat_releve.statut === alertesMod.ETAT_RELEVE_ABSENT && vide.raison_sans_alerte === vide.etat_releve.message, "relevé absent transmis par expliquer_alerte");
});

// ─────────────────────────────────────────────────────────────────────────────
// 10-11. Gardes statiques sur api/_ia/renovation
// ─────────────────────────────────────────────────────────────────────────────
const DOSSIER_RENO = path.join(RACINE, "api", "_ia", "renovation");
const sourcesReno = readdirSync(DOSSIER_RENO).filter((f) => f.endsWith(".js"))
  .map((f) => ({ f, src: readFileSync(path.join(DOSSIER_RENO, f), "utf8") }));
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const sansChaines = (s) => s.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""');

await bloc("10. Garde statique : aucun calcul financier dans api/_ia/renovation (délégation)", () => {
  verifier(sourcesReno.length >= 4, "fichiers de api/_ia/renovation trouvés");
  const INTERDITS = [
    [/\*/, "multiplication"],
    [/[\w)\]]\s+\/\s+[\w(]/, "division"],
    [/\.reduce\s*\(/, "agrégation .reduce("],
    [/\bMath\./, "Math.*"],
    [/\b(prix_ht|heures_devis|cout_materiaux|fg_taux_horaire|heures_estimees|taux_horaire|prix_unitaire|prix_total)\b/, "colonne brute de calcul"],
    [/\.(ouvrages|taches)\b/, "lecture de la structure des ouvrages"],
  ];
  for (const { f, src } of sourcesReno) {
    const code = sansChaines(sansCommentaires(src));
    for (const [re, quoi] of INTERDITS) verifier(!re.test(code), `${f} : ${quoi} interdit(e) — le calcul appartient aux modules`);
  }
  const outilsSrc = sansCommentaires(sourcesReno.find((s) => s.f === "outils.js").src);
  for (const appel of ["computeChantierFinance(", "chargerDonneesFinance(", "alertesV1(", "etatAlertesV1(", "preparerSemainesAttentionV1(",
    "dedoublonnerSnapshotsV1(", "auditDoublonsSnapshotsV1(", "indexerSituations(", "fiabiliteV1("]) {
    verifier(outilsSrc.includes(appel), `outils.js délègue à ${appel.slice(0, -1)}`);
  }
  const moteursSrc = sourcesReno.find((s) => s.f === "moteurs.js").src;
  verifier(moteursSrc.includes('"../../../src/chantierFinance.mjs"') && moteursSrc.includes('"../../../src/Renovation/alertesV1.mjs"'), "modules importés depuis src/, pas recopiés");
  // Le chargement n'est pas dupliqué : le cron et l'assistant partagent le même module.
  const cronSrc = readFileSync(path.join(RACINE, "api", "cron-snapshot-hebdo.js"), "utf8");
  verifier(cronSrc.includes('require("./_partage/donneesFinanceChantiers")') && !/async function fetchAll/.test(cronSrc), "le cron utilise le chargeur partagé");
  verifier(outilsSrc.includes('require("../../_partage/donneesFinanceChantiers")'), "l'assistant utilise le même chargeur");
  // La liste d'exclusion des alertes est la même que celle de la page Alertes.
  const page = readFileSync(path.join(RACINE, "src", "Renovation", "PageAlertes.jsx"), "utf8");
  const m = /const CHANTIERS_EXCLUS\s*=\s*(\[[^\]]*\])/.exec(page);
  verifier(m && egal(JSON.parse(m[1]), CHANTIERS_EXCLUS_ALERTES), `exclusions identiques à PageAlertes.jsx (${m && m[1]})`);
});

await bloc("11. Garde : aucune écriture (insert/update/upsert/delete/rpc) dans api/_ia/renovation", async () => {
  for (const { f, src } of sourcesReno) {
    const code = sansCommentaires(src);
    verifier(!/\.\s*(insert|update|upsert|delete|rpc)\s*\(/.test(code), `${f} : appel d'écriture interdit`);
    verifier(!/\b(insert|upsert|rpc)\b/i.test(sansChaines(code)), `${f} : aucun identifiant d'écriture`);
  }
  // L'adaptateur n'expose que select : l'écriture n'est même pas appelable.
  const adapt = envelopperLecture(clientSur(fixtures())).from("phasages");
  verifier(Object.keys(adapt).join(",") === "select", "l'adaptateur n'expose que select");
  let leve = false;
  try { envelopperLecture(clientSur({})).from("invest_clients"); } catch { leve = true; }
  verifier(leve, "une table hors liste blanche lève (ex. invest_clients)");
  verifier(![...TABLES_AUTORISEES].some((t) => t.startsWith("invest_") || t === "utilisateurs"), "aucune table Invest ni utilisateurs");
  // Exécution de tous les outils : aucune écriture enregistrée par le faux client.
  const avant = ecritures.length;
  for (const nom of Object.keys(parNom)) await outil(nom, { texte: "test", chantier_id: "ch-test-a" });
  verifier(ecritures.length === avant, "aucune écriture pendant l'exécution des quatre outils");
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Crédit IA épuisé
// ─────────────────────────────────────────────────────────────────────────────
// Format du message tel que journalisé dans ia_jobs le 14/09/2026 (message
// d'erreur Anthropic, sans donnée métier).
const MSG_CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_test"}';
const MSG_CLE = '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}';
const MSG_WORKSPACE = '400 {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header."},"request_id":null}';

await bloc("12. Message « crédit épuisé » : reconnaissance du message", () => {
  verifier(MESSAGE_CREDIT_EPUISE === "Service IA indisponible : le crédit du compte IA est épuisé. Prévenez l'administrateur.", "texte exact du message");
  verifier(CODE_CREDIT_EPUISE === "credit_ia_epuise", "code dédié");
  verifier(estCreditEpuise(new Error(MSG_CREDIT)), "reconnu dans e.message");
  verifier(estCreditEpuise({ error: { type: "error", error: { message: "Your credit balance is too low to access the Anthropic API." } } }), "reconnu dans le corps décodé (e.error.error.message)");
  verifier(estCreditEpuise("your CREDIT  balance is TOO low"), "insensible à la casse et aux espaces");
  verifier(!estCreditEpuise(new Error(MSG_CLE)), "clé invalide ≠ crédit épuisé");
  verifier(!estCreditEpuise(new Error(MSG_WORKSPACE)), "en-tête workspace manquant ≠ crédit épuisé (même code HTTP 400)");
  verifier(!estCreditEpuise(null) && !estCreditEpuise({}), "valeurs vides");
});

// ─────────────────────────────────────────────────────────────────────────────
// 13-15. De bout en bout dans api/ai.js, avec le faux modèle
// ─────────────────────────────────────────────────────────────────────────────
function preparerBase() {
  etatBase.tables = {
    ...fixtures(),
    utilisateurs: [
      { id: "u1", email: "admin@test.local", nom: "Admin fictif", role: "admin", actif: true, branches: ["renovation", "invest"] },
      { id: "u2", email: "conducteur@test.local", nom: "Conducteur fictif", role: "conducteur", actif: true, branches: ["renovation"] },
      { id: "u3", email: "invest@test.local", nom: "Admin Invest fictif", role: "admin", actif: true, branches: ["invest"] },
    ],
    ia_jobs: [],
  };
  ecritures.length = 0;
  modele.recus.length = 0;
}
async function appelerRoute(jeton, question, tacheId = "renovation_copilot") {
  const res = {
    statusCode: 0, body: null,
    setHeader() {}, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }, end() { return this; },
  };
  await routeAI({ method: "POST", headers: { authorization: `Bearer ${jeton}` },
    body: { tache: tacheId, entree: { question }, contexte: { branche: "renovation" } } }, res);
  return res;
}
const journalIA = () => ecritures.filter((e) => e.table === "ia_jobs").map((e) => e.lignes[0]);

await bloc("13. Route /api/ai : question ambiguë, le faux modèle appelle l'outil et demande lequel", async () => {
  preparerBase();
  verifier(REGISTRE.renovation_copilot === tache, "tâche inscrite au registre");
  modele.scenario = [
    { stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 },
      content: [{ type: "tool_use", id: "tu1", name: "chercher_chantier", input: { texte: "BRIOLLAY" } }] },
    { stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 60 },
      content: [{ type: "text", text: JSON.stringify({
        reponse: "Six chantiers correspondent à « BRIOLLAY ». Lequel voulez-vous ?", donnee_absente: false,
        outils_appeles: ["chercher_chantier"], chiffres_utilises: [{ libelle: "chantiers correspondants", valeur: 6, outil: "chercher_chantier" }] }) }] },
  ];
  const res = await appelerRoute("jeton-admin", "Où en est BRIOLLAY ?");
  verifier(res.statusCode === 200 && res.body.ok === true, `200 attendu, reçu ${res.statusCode} ${JSON.stringify(res.body && res.body.erreur)}`);
  verifier(res.body.blocs && res.body.blocs[0].outil === "chercher_chantier" && res.body.blocs[0].resultat.nb === 6 && res.body.blocs[0].resultat.ambigu === true, "sortie d'outil jointe telle quelle (6 chantiers, ambigu)");
  verifier(egal(res.body.outils_utilises, ["chercher_chantier"]), "trace serveur des outils");
  verifier(egal(res.body.resultat.outils_appeles, ["chercher_chantier"]) && res.body.resultat.chiffres_utilises.length === 1, "sortie : texte + outils + chiffres");
  const params = modele.recus[0];
  verifier(params.model === "claude-sonnet-5" && params.model === REGISTRE.invest_copilot.modele, "même modèle que le Copilote Invest");
  verifier(egal(params.tools.map((t) => t.name).sort(), ["alertes", "chercher_chantier", "etat_chantier", "expliquer_alerte"]), "les quatre outils exposés");
  const s = params.system;
  verifier(s.includes(tache.PHRASE_ABSENCE) && s.includes("Je n'ai pas trouvé cette information dans Profero Rénovation."), "phrase d'absence dans le prompt");
  verifier(s.includes(tache.PHRASE_PAS_ENCORE) && /JAMAIS de calcul de tête/.test(s) && /date des données/.test(s) && /avertissements de fiabilité/.test(s) && /NE CHOISIS PAS/.test(s), "règles impératives présentes");
  const j = journalIA();
  verifier(j.length === 1 && j[0].statut === "succes" && j[0].tache === "renovation_copilot" && j[0].entree._outils[0].nom === "chercher_chantier", "journal ia_jobs : succès + trace des outils");
  verifier(!JSON.stringify(j[0]).includes("BRIOLLAY APPT"), "les lignes renvoyées par les outils ne sont pas journalisées");
  verifier(ecritures.every((e) => e.table === "ia_jobs"), "seule écriture : le journal ia_jobs du socle");
});

await bloc("14. Route /api/ai : refus non-admin et Invest seul, avant tout appel au modèle", async () => {
  preparerBase();
  modele.scenario = [];
  const r1 = await appelerRoute("jeton-conducteur", "Où en est CHANTIER TEST A ?");
  verifier(r1.statusCode === 403 && r1.body.erreur.code === "non_autorise" && /réservé aux administrateurs/.test(r1.body.erreur.message), "conducteur refusé, message explicite");
  const r2 = await appelerRoute("jeton-admin-invest", "Où en est CHANTIER TEST A ?");
  verifier(r2.statusCode === 403 && /branche Profero Rénovation/.test(r2.body.erreur.message), "admin Invest seul refusé");
  verifier(modele.recus.length === 0, "le modèle n'a pas été appelé");
});

await bloc("15. Route /api/ai : crédit épuisé → code et message dédiés (générique, Invest compris)", async () => {
  preparerBase();
  modele.scenario = [{ erreur: Object.assign(new Error(MSG_CREDIT), { status: 400 }) }];
  const r = await appelerRoute("jeton-admin", "Quelles alertes cette semaine ?");
  verifier(r.statusCode === 503 && r.body.erreur.code === "credit_ia_epuise", `503 credit_ia_epuise attendu, reçu ${r.statusCode} ${r.body.erreur && r.body.erreur.code}`);
  verifier(r.body.erreur.message === MESSAGE_CREDIT_EPUISE, "message lisible par l'utilisateur");
  verifier(journalIA()[0].erreur_code === "credit_ia_epuise", "journalisé avec le vrai code");
  // Même correctif pour le Copilote Invest (l'échec survient avant tout outil).
  preparerBase();
  modele.scenario = [{ erreur: Object.assign(new Error(MSG_CREDIT), { status: 400 }) }];
  const inv = await appelerRoute("jeton-admin", "Quels dossiers sont bloqués ?", "ping");
  verifier(inv.body.erreur && inv.body.erreur.code === "credit_ia_epuise", "une autre tâche (ping) reçoit le même code");
  // Une clé invalide reste une erreur interne : on ne maquille pas une autre cause.
  preparerBase();
  modele.scenario = [{ erreur: Object.assign(new Error(MSG_CLE), { status: 401 }) }];
  const cle = await appelerRoute("jeton-admin", "Quelles alertes ?");
  verifier(cle.body.erreur.code === "erreur_interne", "clé invalide ≠ crédit épuisé");
  const aiSrc = readFileSync(path.join(RACINE, "api", "ai.js"), "utf8");
  verifier((aiSrc.match(/estCreditEpuise\(e\)/g) || []).length === 2, "reconnu au premier appel ET à la relance corrective");
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Le cron du relevé, rebranché sur le chargeur partagé, écrit les mêmes chiffres
// ─────────────────────────────────────────────────────────────────────────────
await bloc("16. Cron du relevé hebdo : même résultat après extraction du chargement", async () => {
  preparerBase();
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await cronHebdo({ headers: {}, query: {} }, res);
  verifier(res.statusCode === 200 && res.body.ok === true, `cron 200 attendu, reçu ${res.statusCode} ${JSON.stringify(res.body)}`);
  const up = ecritures.find((e) => e.table === "chantier_snapshots_hebdo" && e.op === "upsert");
  verifier(up && up.lignes.length === 2, "deux chantiers actifs relevés");
  const ligneA = up && up.lignes.find((l) => l.chantier_id === "ch-test-a");
  const direct = await outil("etat_chantier", { chantier_id: "ch-test-a" }, fixtures());
  verifier(ligneA && ligneA.phasage_id === "ph-a", "phasage le plus récent retenu");
  verifier(ligneA && ligneA.marge === direct.chiffres.marge && ligneA.vendu_ht === direct.chiffres.vendu_ht &&
    ligneA.marge_terminaison === direct.chiffres.marge_a_terminaison && ligneA.avancement === direct.chiffres.avancement_pct,
    "le relevé et l'assistant donnent les mêmes chiffres");
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Sortie attendue du modèle
// ─────────────────────────────────────────────────────────────────────────────
await bloc("17. schema_sortie : texte + outils appelés + chiffres utilisés", () => {
  const valide = { reponse: "ok", donnee_absente: false, outils_appeles: ["alertes"], chiffres_utilises: [{ libelle: "critiques", valeur: 1, outil: "alertes" }] };
  verifier(tache.schema_sortie(valide) === true, "sortie complète acceptée");
  verifier(tache.schema_sortie({ reponse: "ok", donnee_absente: false, outils_appeles: [], chiffres_utilises: [] }) === true, "question hors périmètre : listes vides acceptées");
  verifier(Array.isArray(tache.schema_sortie({ reponse: "ok" })), "listes manquantes refusées (relance corrective)");
  verifier(Array.isArray(tache.schema_sortie({ ...valide, outils_appeles: ["simuler_planning"] })), "outil inventé refusé");
  verifier(Array.isArray(tache.schema_sortie({ ...valide, chiffres_utilises: [{ libelle: "x", valeur: 1, outil: "calcul_de_tete" }] })), "chiffre sans outil source refusé");
  verifier(tache.schema_entree({ question: "" }) !== true && tache.schema_entree({ question: "Où en est X ?" }) === true, "schema_entree");
});

console.log(`\n${ok} contrôles OK, ${ko} en échec.`);
if (ko > 0) {
  console.log("Échecs :\n - " + echecs.join("\n - "));
  process.exit(1);
}
