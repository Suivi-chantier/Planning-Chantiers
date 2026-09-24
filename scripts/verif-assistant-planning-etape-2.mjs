#!/usr/bin/env node
// ─── ASSISTANT PLANNING — ÉTAPE 2 (chantier 10) ─────────────────────────────
// TOUTES les données de ce script sont FICTIVES (exemple issu des tests,
// données fictives) : « Steven », « Kev », « CHANTIER FICTIF A/B » ne sont que
// des étiquettes. Le modèle IA est SIMULÉ (scénario rejoué) : aucune phrase
// n'est réellement traduite par Claude ici, et aucune ligne ne vient de la base.
//
// Ce que le script prouve :
//  1. modules purs (pas de Supabase, pas d'horloge) et semaine ISO identique à
//     src/rythmeSemaine.js ;
//  2. traduction SIMULÉE des 3 phrases de Loris par la vraie route /api/ai
//     (droits, outils en lecture seule, validation serveur, journal ia_jobs) ;
//  3. validation serveur + navigateur, et refus clairs des cas invalides ;
//  4. les lignes produites passent les contraintes SQL des deux tables et le
//     modèle de contraintes du moteur ;
//  5. le moteur existant, avec ces lignes : exception « hors équipe », verrou
//     du vendredi conservé et signalé ;
//  6. l'aperçu Avant / Après (diff du chantier 05) : déplacement, fantôme,
//     absence, fins, non planifiées avec raison, conflits ;
//  7. gardes statiques : admin seulement, aucune écriture serveur, écriture
//     navigateur limitée à deux tables avec source = assistant, pas de bouton
//     « Appliquer », aucune couleur en dur.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as C from "../src/Renovation/assistantPlanningConsigneV1.mjs";
import { construireApercuRecalculV1, semainesDisponiblesV1 } from "../src/Renovation/assistantPlanningApercuV1.mjs";
import { getISOWeek } from "../src/rythmeSemaine.js";
import { semaineISOv1 as semaineMoteur } from "../src/Renovation/planningEngineDataHelpersV1.js";
import { capaciteBasePlanningPourDate } from "../src/Renovation/planningResourceCapacityV1.js";
import { maturiteContraintePlanning, porteePreciseRessourceImposee } from "../src/Renovation/planningConstraintModelV1.js";
import { normaliserEquipeLegacy } from "../src/Renovation/planningResourceModelV1.js";
import { preparerSimulationReplanningV1 } from "../src/Renovation/planningReplanningAdapterV1.js";
import { planifierReplanningIncrementalV1 } from "../src/Renovation/planningReplanningIncrementalV1.js";

const require = createRequire(import.meta.url);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..");
const lire = (rel) => readFileSync(path.join(RACINE, rel), "utf8");

let ok = 0;
const echecs = [];
const blocs = [];
function verifier(cond, libelle) {
  if (cond) ok++;
  else echecs.push(libelle);
}
async function bloc(titre, fn) {
  const avant = echecs.length;
  try { await fn(); } catch (e) { echecs.push(`${titre} : exception ${e.stack || e.message}`); }
  blocs.push(`■ ${titre}\n    ${echecs.length === avant ? "✓" : `✗ ${echecs.slice(avant).join("\n    ✗ ")}`}`);
}
const exemples = [];
const exemple = (titre, lignes) => exemples.push(`■ ${titre} (exemple issu des tests, données fictives)\n${lignes.map(l => `   ${l}`).join("\n")}`);

// ─────────────────────────────────────────────────────────────────────────────
// Données fictives
// ─────────────────────────────────────────────────────────────────────────────
// Aujourd'hui fictif : jeudi 24/09/2026 (S39, semaine impaire → vendredi 0 h).
const AUJOURDHUI = "2026-09-24";
const ressources = [
  { id: "R-STEVEN", nom: "Steven", nom_planning: "Steven", kind: "personne", actif: true, capacite_facteur: 1 },
  { id: "R-KEV", nom: "Kev", nom_planning: "Kev", kind: "personne", actif: true, capacite_facteur: 1 },
  { id: "R-DAVY", nom: "Davy", nom_planning: "Davy", kind: "personne", actif: true, capacite_facteur: 1 },
  { id: "R-ANCIEN", nom: "Ancien", nom_planning: "Ancien", kind: "personne", actif: false, capacite_facteur: 1 },
];
const chantiers = [
  { id: "CH-A", nom: "CHANTIER FICTIF A", statut: "en_cours" },
  { id: "CH-B", nom: "CHANTIER FICTIF B", statut: "en_cours" },
  { id: "CH-FINI", nom: "CHANTIER FICTIF TERMINÉ", statut: "termine" },
];
const groupesTypes = [
  { id: "gt_placo", nom: "Ossature placo", ordre: 10, equipe_id: "EQ-PLACO", ouvriers_prio: [] },
  { id: "gt_elec", nom: "Électricité", ordre: 20, equipe_id: "EQ-ELEC", ouvriers_prio: [] },
];
const equipes = [
  { id: "EQ-PLACO", nom: "Second œuvre", responsable: "Steven", membres: [], externe: false },
  { id: "EQ-ELEC", nom: "Électricité", responsable: "Kev", membres: [{ ouvrier: "Davy" }], externe: false },
];
const tache = (id, nom, heures, cg, extra = {}) => ({
  id, nom, heures_vendues: heures, heures_estimees: heures, avancement: 0, chrono_groupe_id: cg, chrono_ordre: 0, ouvriers: [], predecesseurs: [], ...extra,
});
const phasage = (chantierId, taches, groupes) => ({
  id: `PH-${chantierId}`, chantier_id: chantierId, revision: 1, updated_at: "2026-09-20T18:00:00Z",
  ouvrages: [{ id: `O-${chantierId}`, code_ouvrage: "P-001", taches }],
  plan_travaux: { meta: { chrono_groupes: groupes } },
});
const phasages = [
  phasage("CH-A", [
    tache("T-OSS-A", "Ossature placo séjour", 16, "CG-A1"),
    tache("T-ELEC-A", "Tirage câbles", 6, "CG-A2"),
    tache("T-FINIE", "Ossature placo cuisine", 4, "CG-A1", { avancement: 100 }),
  ], [{ id: "CG-A1", ordre: 10, groupe_type_id: "gt_placo" }, { id: "CG-A2", ordre: 20, groupe_type_id: "gt_elec" }]),
  phasage("CH-B", [tache("T-OSS-B", "Ossature placo chambre", 8, "CG-B1")], [{ id: "CG-B1", ordre: 10, groupe_type_id: "gt_placo" }]),
];
// Intervention posée à la main le vendredi 25/09 (S39 : 0 h) sur CH-A.
const cellules = [
  { id: "CELL-FRI", week_id: "2026-W39", chantier_id: "CH-A", jour: "Vendredi", planifie: true, reel: false, ouvriers: ["Davy"], vehicules: [],
    taches: [{ allocation_uid: "U-FRI", tache_id: null, text: "Intervention fictive", duree: 4, ouvriers: ["Davy"] }] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Faux Supabase (même modèle que verif-renovation-copilot-v1.mjs)
// ─────────────────────────────────────────────────────────────────────────────
const ecritures = [];
const journal = () => ecritures.filter(e => e.table === "ia_jobs").map(e => e.ligne);
class Requete {
  constructor(tables, nom) { this.tables = tables; this.nom = nom; this.filtres = []; this.op = "select"; this.mode = "many"; this.plage = null; this.lim = null; }
  select() { return this; }
  eq(c, v) { this.filtres.push(r => String(r[c]) === String(v)); return this; }
  in(c, vs) { const s = new Set(vs.map(String)); this.filtres.push(r => s.has(String(r[c]))); return this; }
  gte(c, v) { this.filtres.push(r => String(r[c] ?? "") >= String(v)); return this; }
  lte(c, v) { this.filtres.push(r => String(r[c] ?? "") <= String(v)); return this; }
  order() { return this; }
  range(a, b) { this.plage = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  insert(l) { this.op = "insert"; this.payload = l; return this; }
  executer() {
    if (this.op !== "select") {
      ecritures.push({ table: this.nom, op: this.op, ligne: this.payload });
      return { data: this.mode === "many" ? [{ id: `id-${ecritures.length}` }] : { id: `id-${ecritures.length}` }, error: null };
    }
    let rows = (this.tables[this.nom] || []).filter(r => this.filtres.every(f => f(r)));
    if (this.plage) rows = rows.slice(this.plage[0], this.plage[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.mode === "maybe") return { data: rows[0] || null, error: null };
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "0 ou plusieurs lignes" } };
    return { data: rows, error: null };
  }
  then(res, rej) { try { return Promise.resolve(this.executer()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}
const tables = {
  utilisateurs: [
    { id: "u1", email: "admin@test.local", nom: "Admin Test", role: "admin", actif: true, branches: ["renovation"] },
    { id: "u2", email: "conducteur@test.local", nom: "Conducteur Test", role: "conducteur", actif: true, branches: ["renovation"] },
    { id: "u3", email: "invest@test.local", nom: "Admin Invest", role: "admin", actif: true, branches: ["invest"] },
  ],
  planning_config: [
    { key: "ia_config", value: { active: true } },
    { key: "chantiers", value: chantiers },
    { key: "groupes_types", value: { items: groupesTypes } },
    { key: "equipes", value: { items: equipes } },
  ],
  planning_resources: ressources,
  phasages,
  planning_cells: cellules,
  planning_constraints: [],
  planning_resource_events: [],
  ia_jobs: [],
};
const JETONS = { "jeton-admin": "admin@test.local", "jeton-conducteur": "conducteur@test.local", "jeton-invest": "invest@test.local" };
const fauxClient = {
  auth: { async getUser(j) { const e = JETONS[j]; return e ? { data: { user: { id: `auth-${e}`, email: e } }, error: null } : { data: null, error: { message: "jeton invalide" } }; } },
  from: (nom) => new Requete(tables, nom),
};

// Faux SDK Anthropic : rejoue un scénario et garde ce qu'il reçoit.
const modele = { scenario: [], recus: [] };
class FauxAnthropic {
  constructor() {
    this.messages = { create: async (p) => { modele.recus.push(JSON.parse(JSON.stringify(p))); const e = modele.scenario.shift(); if (!e) throw new Error("scénario épuisé"); return e; } };
  }
}
FauxAnthropic.APIConnectionError = class extends Error {};
FauxAnthropic.RateLimitError = class extends Error {};
FauxAnthropic.InternalServerError = class extends Error {};

function injecter(nom, exportsFactices) {
  const chemin = require.resolve(nom, { paths: [path.join(RACINE, "api")] });
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: exportsFactices };
}
injecter("@supabase/supabase-js", { createClient: () => fauxClient });
injecter("@anthropic-ai/sdk", FauxAnthropic);
process.env.SUPABASE_URL = "https://exemple.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-factice";
process.env.ANTHROPIC_API_KEY = "cle-factice";

const handler = require("../api/ai.js");
const REGISTRE = require("../api/_ia/registre.js");
const tacheIA = require("../api/_ia/taches/renovation_planning_consigne.js");
tacheIA.__definirHorlogePourTests(() => new Date(`${AUJOURDHUI}T10:00:00+02:00`));

async function appeler({ jeton = "jeton-admin", entree, contexte = { page: "planning", page_libelle: "Planning semaine" } }) {
  const res = { statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${jeton}` }, body: { tache: "renovation_planning_consigne", entree, contexte } }, res);
  return res;
}
const outil = (id, name, input) => ({ stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: "tool_use", id, name, input }] });
const fin = (obj) => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text: JSON.stringify(obj) }] });

// Référentiel « navigateur » (même forme que chargerReferentiel).
const referentiel = (extra = {}) => ({
  ressources, chantiers, groupesTypes, equipes, phasages, interventions: [], evenements: [], contraintes: [], ...extra,
});
const membresEquipeLot = (gtId) => {
  const gt = groupesTypes.find(g => g.id === gtId);
  const eq = equipes.find(e => e.id === gt?.equipe_id);
  return eq ? normaliserEquipeLegacy(eq, ressources).resource_ids : null;
};
const optionsNavigateur = { aujourdhui: AUJOURDHUI, capaciteBase: capaciteBasePlanningPourDate, membresEquipeLot };

// Contrôles SQL des deux tables (relevés en base le 24/09/2026, lecture seule).
function passeContraintesSqlEvenement(l) {
  return ["absence", "indisponibilite", "capacite_override"].includes(l.type)
    && ["manuel", "paie", "assistant", "import"].includes(l.source)
    && l.date_fin >= l.date_debut
    && ((l.type === "capacite_override" && l.capacite_heures != null && l.heures_indisponibles == null)
      || (l.type !== "capacite_override" && l.capacite_heures == null
        && ((l.toute_journee === true && l.heures_indisponibles == null) || (l.toute_journee === false && l.heures_indisponibles > 0))));
}
function passeContraintesSqlConsigne(l) {
  const scopeOk = l.scope === "global" || (l.scope === "chantier" && l.chantier_id) || (l.scope === "groupe" && l.groupe_type_id)
    || (l.scope === "tache" && l.tache_id) || (l.scope === "allocation" && l.allocation_id);
  const payloadOk = (l.type === "fixed_date" && l.date_debut) || (l.type === "allocation_lock" && l.allocation_id)
    || (["resource_required", "resource_forbidden"].includes(l.type) && Array.isArray(l.config?.resource_ids) && l.config.resource_ids.length > 0);
  return !!scopeOk && !!payloadOk && ["manuel", "assistant", "systeme", "import"].includes(l.source)
    && (!l.date_fin || !l.date_debut || l.date_fin >= l.date_debut);
}

// ─────────────────────────────────────────────────────────────────────────────
await bloc("1. Modules purs et semaine ISO identique à src/rythmeSemaine.js", () => {
  const consigne = lire("src/Renovation/assistantPlanningConsigneV1.mjs");
  const apercu = lire("src/Renovation/assistantPlanningApercuV1.mjs");
  for (const [nom, src] of [["consigne", consigne], ["aperçu", apercu]]) {
    verifier(!/supabase/i.test(src.replace(/\/\/.*$/gm, "")), `${nom} : aucun accès Supabase`);
    verifier(!/new Date\(\s*\)|Date\.now\(/.test(src), `${nom} : aucune horloge`);
  }
  verifier(!/^\s*import\s/m.test(consigne), "le module consigne n'importe rien (chargeable côté serveur sans détection de syntaxe)");
  verifier(lire("src/Renovation/assistantPlanningConsigneV1.js").includes('export * from "./assistantPlanningConsigneV1.mjs"'), "façade .js du module consigne");
  verifier(lire("src/Renovation/assistantPlanningApercuV1.js").includes('export * from "./assistantPlanningApercuV1.mjs"'), "façade .js du module aperçu");
  let ecarts = 0;
  for (let d = "2025-12-20"; d <= "2028-01-15"; d = C.ajouterJoursV1(d, 1)) {
    const a = C.semaineISOv1(d); const r = getISOWeek(d); const m = semaineMoteur(d);
    if (a.annee !== r.year || a.semaine !== r.week || a.week_id !== m.week_id) ecarts++;
  }
  verifier(ecarts === 0, `semaine ISO identique jour par jour sur 2 ans (${ecarts} écart)`);
  verifier(C.dateISOv1("2026-02-31") === null && C.dateISOv1("2026-09-28") === "2026-09-28", "dates débordantes refusées");
  const cal = C.calendrierConsignesV1(AUJOURDHUI, 14);
  verifier(cal[0].aujourdhui && cal.find(j => j.date === "2026-09-28").semaine === "semaine prochaine" && cal.find(j => j.date === "2026-09-28").jour === "lundi", "calendrier : lundi 28/09 = semaine prochaine");
});

await bloc("2. Phrase 1 — « Steven est absent lundi prochain, recalcule » (traduction simulée)", async () => {
  modele.recus.length = 0;
  modele.scenario = [
    outil("t1", "chercher_ressource", { texte: "Steven" }),
    fin({ type: "proposition", message: "J'ai compris : Steven absent lundi 28/09 (« lundi prochain »). Je l'enregistre ?", outils_appeles: ["chercher_ressource"],
      consigne: { nature: "absence", resource_id: "R-STEVEN", date_debut: "2026-09-28", date_fin: "2026-09-28", toute_journee: true } }),
  ];
  const nbIa = journal().length;
  const r = await appeler({ entree: { question: "Steven est absent lundi prochain, recalcule les plannings en fonction." } });
  verifier(r.statusCode === 200 && r.body.ok, `réponse 200 (${r.statusCode} ${JSON.stringify(r.body?.erreur)})`);
  verifier(r.body.resultat?.consigne?.resource_id === "R-STEVEN", "identifiant issu de l'outil");
  const system = modele.recus[0]?.system || "";
  verifier(system.includes("2026-09-28 = Lundi 28/09/2026 (semaine prochaine)"), "le calendrier donné au modèle place lundi 28/09 en semaine prochaine");
  verifier(system.includes("Aucun chantier n'est ouvert sur la page"), "le contexte de page est transmis");
  verifier(modele.recus[0].tools.map(t => t.name).sort().join() === "chercher_chantier,chercher_ressource,interventions_du_jour,travaux_chantier", "quatre outils de lecture exposés");
  verifier(journal().length === nbIa + 1 && journal().at(-1).statut === "succes" && journal().at(-1).tache === "renovation_planning_consigne", "journal ia_jobs : succès");
  verifier(ecritures.filter(e => e.table !== "ia_jobs").length === 0, "aucune écriture côté serveur (hors journal ia_jobs)");
  const v = C.validerConsigneV1(r.body.resultat.consigne, referentiel(), optionsNavigateur);
  verifier(v.ok && v.table === "planning_resource_events", "validation navigateur OK");
  verifier(passeContraintesSqlEvenement(v.ligne) && v.ligne.source === "assistant", "la ligne passe les contraintes SQL, source = assistant");
  verifier(v.fiche.lignes.find(l => l.libelle === "Quand").valeur === "Lundi 28/09/2026", "fiche : Lundi 28/09/2026");
  exemple("Fiche de consigne, phrase 1", [`[${v.fiche.etiquette}] ${v.fiche.lignes.map(l => `${l.libelle} : ${l.valeur}`).join(" · ")}`, `Effet : ${v.fiche.effet}`, `Où la retrouver : ${v.fiche.visibilite}`]);
});

await bloc("3. Phrase 2 — « Kev va réaliser l'ossature placo sur ce chantier » : question, puis proposition", async () => {
  modele.scenario = [
    outil("t1", "travaux_chantier", { texte: "ossature placo" }),
    fin({ type: "question", message: "Sur quel chantier ? Vous êtes sur la page Planning, je préfère ne pas deviner.", outils_appeles: ["travaux_chantier"],
      choix: [{ libelle: "CHANTIER FICTIF A" }, { libelle: "CHANTIER FICTIF B" }] }),
  ];
  const q = await appeler({ entree: { question: "Kev va réaliser l'ossature placo sur ce chantier même s'il n'est pas censé le faire, recalcule." } });
  verifier(q.statusCode === 200 && q.body.resultat.type === "question" && q.body.resultat.choix.length === 2, "ambiguïté → question à choix");
  const blocTravaux = q.body.blocs?.find(b => b.outil === "travaux_chantier")?.resultat;
  verifier(blocTravaux?.nb_chantiers === 2 && blocTravaux.chantiers.every(c => c.lots.some(l => l.groupe_type_id === "gt_placo")), "l'outil trouve le lot placo sur les deux chantiers en cours");
  verifier(!blocTravaux.chantiers.some(c => c.taches.some(t => t.tache_id === "T-FINIE")), "une tâche terminée n'est jamais proposée");

  modele.recus.length = 0;
  modele.scenario = [
    outil("t2", "chercher_ressource", { texte: "Kev" }),
    outil("t3", "travaux_chantier", { chantier_id: "CH-A", texte: "ossature placo" }),
    fin({ type: "proposition", message: "Kev imposé sur l'ossature placo de CHANTIER FICTIF A.", outils_appeles: ["chercher_ressource", "travaux_chantier"],
      consigne: { nature: "ressource_imposee", resource_ids: ["R-KEV"], chantier_id: "CH-A", groupe_type_id: "gt_placo" } }),
  ];
  const historique = [{ role: "user", texte: "Kev va réaliser l'ossature placo sur ce chantier…" }, { role: "assistant", texte: "Sur quel chantier ?\nChoix proposés : CHANTIER FICTIF A / CHANTIER FICTIF B" }];
  const p = await appeler({ entree: { question: "CHANTIER FICTIF A", historique } });
  verifier(p.statusCode === 200 && p.body.resultat.type === "proposition", `proposition acceptée par le serveur (${JSON.stringify(p.body?.erreur)})`);
  verifier(modele.recus[0].messages.length === 3 && modele.recus[0].messages[0].role === "user", "l'historique est rejoué dans l'ordre utilisateur / assistant / utilisateur");
  const v = C.validerConsigneV1(p.body.resultat.consigne, referentiel(), optionsNavigateur);
  verifier(v.ok && v.ligne.type === "resource_required" && v.ligne.scope === "groupe" && v.ligne.chantier_id === "CH-A" && v.ligne.groupe_type_id === "gt_placo", "ligne resource_required, portée chantier + lot");
  verifier(v.ligne.config.exception_hors_equipe === true && v.fiche.avertissements.some(a => a.code === "hors_equipe"), "Kev hors de l'équipe du lot : exception signalée sur la fiche");
  verifier(porteePreciseRessourceImposee(v.ligne) && maturiteContraintePlanning(v.ligne).valide, "le moteur reconnaît une portée précise (seule à pouvoir élargir l'équipe)");
  verifier(passeContraintesSqlConsigne(v.ligne), "la ligne passe les contraintes SQL de planning_constraints");
  exemple("Fiche de consigne, phrase 2", [`[${v.fiche.etiquette}] ${v.fiche.lignes.map(l => `${l.libelle} : ${l.valeur}`).join(" · ")}`, ...v.fiche.avertissements.map(a => `${a.niveau} : ${a.message}`)]);
});

await bloc("4. Phrase 3 — « Je programme manuellement une intervention le 25/09 » : verrou + exception vendredi 0 h", async () => {
  modele.scenario = [
    outil("t1", "interventions_du_jour", { date: "2026-09-25" }),
    fin({ type: "proposition", message: "Je verrouille l'intervention de vendredi 25/09 sur CHANTIER FICTIF A.", outils_appeles: ["interventions_du_jour"],
      consigne: { nature: "intervention_verrouillee", allocation_uid: "U-FRI", date: "2026-09-25" } }),
  ];
  const r = await appeler({ entree: { question: "Je vais programmer manuellement une intervention sur un chantier le 25/09, prends-la en compte et recalcule." } });
  verifier(r.statusCode === 200 && r.body.resultat.consigne.allocation_uid === "U-FRI", `proposition acceptée (${JSON.stringify(r.body?.erreur)})`);
  const inter = r.body.blocs.find(b => b.outil === "interventions_du_jour").resultat;
  verifier(inter.interventions.length === 1 && inter.interventions[0].ouvriers.join() === "Davy" && inter.interventions[0].verrouillee === false, "l'outil lit l'intervention posée dans planning_cells");
  const v = C.validerConsigneV1(r.body.resultat.consigne, referentiel({ interventions: inter.interventions }), optionsNavigateur);
  const zero = v.fiche.avertissements.find(a => a.code === "jour_zero_heure");
  verifier(v.ok && v.ligne.type === "allocation_lock" && v.ligne.allocation_id === "U-FRI" && passeContraintesSqlConsigne(v.ligne), "ligne allocation_lock valide");
  verifier(zero && /vendredi 25\/09 est normalement non travaillé \(0 h\)\. Je la garde comme exception/.test(zero.message), "avertissement vendredi 0 h, comme la maquette");
  // Le moteur (adaptateur, PR #30) conserve le verrou et le signale.
  const prep = preparerSimulationReplanningV1({ phasages, chantiers, cellules, ressources, evenementsRessources: [], contraintes: [{ id: "L1", ...v.ligne }], groupesTypes, equipes, startDate: "2026-09-25", horizonDays: 14 });
  const w = prep.warnings.find(x => x.type === "allocation_verrouillee_jour_non_travaille");
  verifier(prep.forecastCourant.allocations_fixes.some(a => a.allocation_uid === "U-FRI" && a.locked) && w && /exception conservée/.test(w.explication), "moteur : verrou conservé + « exception conservée »");
  // Une date imposée sur ce même vendredi est REFUSÉE : le moteur ne pourrait rien y placer.
  const d = C.validerConsigneV1({ nature: "date_imposee", chantier_id: "CH-A", tache_id: "T-OSS-A", date_debut: "2026-09-25", date_fin: "2026-09-25" }, referentiel(), optionsNavigateur);
  verifier(!d.ok && d.erreurs[0].code === "date_zero_heure", "date imposée sur un jour à 0 h : refus clair, orienté vers le verrou");
  exemple("Fiche de consigne, phrase 3", [`[${v.fiche.etiquette}] ${v.fiche.lignes.map(l => `${l.libelle} : ${l.valeur}`).join(" · ")}`, ...v.fiche.avertissements.map(a => `${a.niveau} : ${a.message}`), `moteur : ${w.explication}`]);
});

await bloc("5. Refus des cas invalides (serveur et navigateur)", async () => {
  const S = (res) => tacheIA.validerSortie(res, { sb: fauxClient, aujourdhui: AUJOURDHUI });
  const base = { type: "proposition", message: "ok", outils_appeles: [] };
  const cas = [
    [{ ...base, consigne: { nature: "absence", resource_id: "R-INVENTE", date_debut: "2026-09-28" } }, /Aucune ressource/],
    [{ ...base, consigne: { nature: "absence", resource_id: "R-ANCIEN", date_debut: "2026-09-28" } }, /inactif/],
    [{ ...base, consigne: { nature: "vacances", resource_id: "R-STEVEN" } }, /Type de consigne inconnu/],
    [{ ...base, consigne: { nature: "absence", resource_id: "R-STEVEN", date_debut: "2026-09-01" } }, /avant aujourd'hui/],
    [{ ...base, consigne: { nature: "absence", resource_id: "R-STEVEN", date_debut: "2026-02-31" } }, /illisible/],
    [{ ...base, consigne: { nature: "absence", resource_id: "R-STEVEN", date_debut: "2026-10-02", date_fin: "2026-09-30" } }, /avant la date de début/],
    [{ ...base, consigne: { nature: "ressource_imposee", resource_ids: ["R-KEV"], chantier_id: "CH-B", groupe_type_id: "gt_elec" } }, /aucune tâche ouverte/],
    [{ ...base, consigne: { nature: "ressource_imposee", resource_ids: ["R-KEV"], chantier_id: "CH-A", groupe_type_id: "gt_placo", tache_id: "T-OSS-A" } }, /un seul des deux/],
    [{ ...base, consigne: { nature: "ressource_imposee", resource_ids: ["R-KEV"], chantier_id: "CH-FINI", groupe_type_id: "gt_placo" } }, /terminé/],
    [{ ...base, consigne: { nature: "date_imposee", chantier_id: "CH-A", tache_id: "T-FINIE", date_debut: "2026-09-29" } }, /terminée/],
    [{ ...base, consigne: { nature: "intervention_verrouillee", allocation_uid: "U-INEXISTANTE", date: "2026-09-25" } }, /n'existe pas dans le planning/],
    [{ ...base, consigne: { nature: "intervention_verrouillee", allocation_uid: "U-FRI" } }, /consigne\.date/],
    [{ ...base }, /consigne" manquant/],
    [{ type: "question", message: "Lequel ?", outils_appeles: [], choix: [{ libelle: "Seul choix" }] }, /entre 2 et 6 choix/],
    [{ type: "information", message: "ok", outils_appeles: ["simuler_planning"] }, /outil inconnu/],
    [{ type: "reponse", message: "ok", outils_appeles: [] }, /"type" doit valoir/],
  ];
  for (const [sortie, attendu] of cas) {
    const r = await S(sortie);
    verifier(Array.isArray(r) && r.some(e => attendu.test(e)), `refus attendu ${attendu} → ${JSON.stringify(r)}`);
  }
  verifier(await S({ type: "information", message: "Je traduis des consignes de planning.", outils_appeles: [] }) === true, "information valide acceptée");
  // Déjà verrouillée (navigateur, avec les verrous existants).
  const deja = C.validerConsigneV1({ nature: "intervention_verrouillee", allocation_uid: "U-FRI", date: "2026-09-25" },
    referentiel({ interventions: C.interventionsDuJourV1({ cellules, date: "2026-09-25", verrous: [{ allocation_id: "U-FRI" }] }) }), optionsNavigateur);
  verifier(!deja.ok && deja.erreurs[0].code === "deja_verrouillee", "intervention déjà verrouillée refusée");
  // Nom inconnu : l'outil le dit, sans en choisir un autre.
  const inconnu = C.chercherRessourcesV1(ressources, "Robert");
  verifier(inconnu.inconnu && inconnu.trouvees.length === 0 && inconnu.toutes.includes("Steven"), "nom inconnu : aucune personne choisie, liste fournie");
  // Pipeline : identifiant inventé deux fois → refus clair après UNE relance.
  const invente = fin({ type: "proposition", message: "x", outils_appeles: [], consigne: { nature: "absence", resource_id: "R-FANTOME", date_debut: "2026-09-28" } });
  modele.scenario = [invente, invente];
  const nbAvant = modele.recus.length;
  const r = await appeler({ entree: { question: "Fantôme est absent lundi" } });
  verifier(r.statusCode === 502 && r.body.erreur.code === "sortie_invalide" && /contrôle serveur : Aucune ressource/.test(r.body.erreur.message), `refus clair (${r.statusCode} ${r.body?.erreur?.message})`);
  verifier(modele.recus.length - nbAvant === 2, "une seule relance corrective");
  verifier(journal().at(-1).statut === "echec" && journal().at(-1).erreur_code === "sortie_invalide", "refus journalisé dans ia_jobs");
  // Droits : admin Rénovation seulement.
  modele.scenario = [];
  const c = await appeler({ jeton: "jeton-conducteur", entree: { question: "Steven absent lundi" } });
  const i = await appeler({ jeton: "jeton-invest", entree: { question: "Steven absent lundi" } });
  verifier(c.statusCode === 403 && i.statusCode === 403, `conducteur et admin Invest refusés (${c.statusCode}, ${i.statusCode})`);
  verifier(REGISTRE.renovation_planning_consigne === tacheIA && tacheIA.roles.join() === "admin", "tâche au registre, rôle admin");
  verifier(ecritures.filter(e => e.table !== "ia_jobs").length === 0, "toujours aucune écriture serveur hors ia_jobs");
});

// ─────────────────────────────────────────────────────────────────────────────
// Moteur existant, avant / après, sur la chaîne chantier 05 complète
// ─────────────────────────────────────────────────────────────────────────────
function simuler({ contraintes = [], evenements = [], startDate = "2026-09-28", horizonDays = 28 } = {}) {
  const prep = preparerSimulationReplanningV1({ phasages, chantiers, cellules: [], ressources, evenementsRessources: evenements, contraintes, groupesTypes, equipes, startDate, horizonDays });
  const proposition = planifierReplanningIncrementalV1({ engineInput: prep.engineInput, forecast: prep.forecastCourant.allocations_recalculables, trigger: null });
  return {
    generated_at: "2026-09-24T09:32:00.000Z",
    horizon: { start_date: startDate, end_date: C.ajouterJoursV1(startDate, horizonDays - 1), horizon_days: horizonDays },
    referentiel: { chantiers: chantiers.map(c => ({ id: c.id, nom: c.nom })), ressources: ressources.map(r => ({ id: r.id, nom: r.nom, nom_planning: r.nom_planning })) },
    warnings_adaptateur: prep.warnings,
    proposition,
  };
}

await bloc("6. Aperçu Avant / Après — absence de Steven (diff du chantier 05)", () => {
  const v = C.validerConsigneV1({ nature: "absence", resource_id: "R-STEVEN", date_debut: "2026-09-28", date_fin: "2026-09-28" }, referentiel(), optionsNavigateur);
  const evenement = { id: "E1", ...v.ligne };
  const avant = simuler();
  const apres = simuler({ evenements: [evenement] });
  const ap = construireApercuRecalculV1({ avant, apres, lundi: "2026-09-28", evenements: [evenement], capaciteBase: capaciteBasePlanningPourDate, ressourcesConsigne: ["R-STEVEN"] });
  const steven = ap.lignes.find(l => l.resource_id === "R-STEVEN");
  const lundi = steven.cellules[0];
  verifier(lundi.absent === true && lundi.apres.length === 0, "lundi : Steven absent (hachuré), aucune tâche après");
  verifier(lundi.fantomes.length > 0 && lundi.fantomes.every(f => f.fantome), "lundi : fantôme de l'ancienne place");
  const deplace = steven.cellules.slice(1).flatMap(c => c.apres).find(i => i.change && i.deplace_depuis === "2026-09-28");
  verifier(deplace && deplace.libelle_deplacement === "← décalé de lun.", `tâche déplacée encadrée « ← décalé de lun. » (${deplace?.libelle_deplacement})`);
  verifier(ap.resume.deplacees >= 1 && ap.deplacees.every(d => d.apres.debut > d.avant.debut), "résumé : tâches déplacées plus tard");
  verifier(ap.fins.some(f => f.decalage_jours > 0), "bandeau : une fin prévisionnelle recule");
  verifier(ap.resume.non_planifiees === 0 && ap.resume.conflits === 0, "aucune tâche non planifiée ni conflit nouveau");
  const kevLundi = ap.lignes.find(l => l.resource_id === "R-KEV")?.cellules[0];
  verifier(!kevLundi || kevLundi.apres.every(i => !i.change), "les autres personnes : cellules inchangées (atténuées)");
  verifier(ap.jours[4].date === "2026-10-02" && ap.jours[4].non_travaille === false && semainesDisponiblesV1(apres)[0] === "2026-09-28", "semaine S40 : vendredi travaillé (6 h), navigation par semaine");
  exemple("Aperçu, absence de Steven lundi 28/09", [
    `résumé : ${ap.resume.deplacees} déplacée(s), ${ap.resume.non_planifiees} non planifiée(s), ${ap.resume.conflits} conflit`,
    ...ap.deplacees.map(d => `${d.chantier} · ${d.texte} : ${d.avant.debut} → ${d.apres.debut}`),
    ...ap.fins.map(f => `fin ${f.chantier} : ${f.avant.titre} → ${f.apres.titre}`),
  ]);
});

await bloc("7. Aperçu — Kev imposé hors équipe : exception visible ; Kev absent : non planifié avec raison", () => {
  const v = C.validerConsigneV1({ nature: "ressource_imposee", resource_ids: ["R-KEV"], chantier_id: "CH-A", groupe_type_id: "gt_placo" }, referentiel(), optionsNavigateur);
  const contrainte = { id: "K1", ...v.ligne };
  const avant = simuler();
  const apres = simuler({ contraintes: [contrainte] });
  const ap = construireApercuRecalculV1({ avant, apres, lundi: "2026-09-28", capaciteBase: capaciteBasePlanningPourDate, ressourcesConsigne: ["R-KEV"] });
  const itemsKev = ap.lignes.find(l => l.resource_id === "R-KEV").cellules.flatMap(c => c.apres).filter(i => i.travail_id === "CH-A::T-OSS-A");
  verifier(itemsKev.length > 0 && itemsKev.every(i => i.exception && /hors de l'équipe du lot/.test(i.exception)), "l'ossature de CH-A passe à Kev, marquée exception");
  const bPlaco = apres.proposition.allocations_proposees.filter(a => a.travail_id === "CH-B::T-OSS-B");
  verifier(bPlaco.length > 0 && bPlaco.every(a => a.resource_ids.join() === "R-STEVEN"), "portée exacte : CH-B garde l'équipe habituelle");
  const absent = simuler({ contraintes: [contrainte], evenements: [{ id: "E2", resource_id: "R-KEV", type: "absence", date_debut: "2026-09-28", date_fin: "2026-12-31", toute_journee: true, actif: true }] });
  const ap2 = construireApercuRecalculV1({ avant, apres: absent, lundi: "2026-09-28", capaciteBase: capaciteBasePlanningPourDate });
  const np = ap2.non_planifiees.find(n => n.travail_id === "CH-A::T-OSS-A");
  verifier(np && np.raison_code === "ressource_imposee_indisponible" && /Kev imposé/.test(np.raison), "non planifiée avec sa raison (invariant « jamais sans raison »)");
  verifier(ap2.non_planifiees.every(n => n.raison && n.raison_code), "toute tâche non planifiée affichée porte un code et un libellé");
  exemple("Aperçu, Kev imposé puis absent", [`exception : ${itemsKev[0].exception}`, `non planifiée : ${np.texte} — ${np.raison}`]);
});

await bloc("8. Fenêtre de simulation et liste des consignes de l'assistant", () => {
  const f1 = C.fenetreSimulationConsigneV1({ periode: { debut: "2026-09-25", fin: "2026-09-25" }, prochainJourPlanifiable: "2026-09-28", demain: "2026-09-25" });
  verifier(f1.startDate === "2026-09-25" && f1.horizonDays === 42, "verrou du 25/09 : le recalcul démarre le 25/09 pour l'inclure");
  const f2 = C.fenetreSimulationConsigneV1({ periode: { debut: "2026-11-20", fin: "2026-11-27" }, prochainJourPlanifiable: "2026-09-28", demain: "2026-09-25" });
  verifier(f2.startDate === "2026-09-28" && f2.horizonDays >= 71, "consigne lointaine : horizon allongé pour la couvrir");
  const liste = C.consignesAssistantV1({
    contraintes: [{ id: "k1", type: "resource_required", source: "assistant", actif: true, label: "Kev imposé", created_at: "2026-09-24T10:00:00Z" }, { id: "k2", type: "allocation_lock", source: "manuel", actif: true }],
    evenements: [{ id: "e1", resource_id: "R-STEVEN", type: "absence", date_debut: "2026-09-28", date_fin: "2026-09-28", source: "assistant", actif: true, created_at: "2026-09-24T11:00:00Z" }, { id: "e2", resource_id: "R-KEV", source: "manuel", actif: true }],
    ressources, chantiers,
  });
  verifier(liste.length === 2 && liste.every(c => c.id === "k1" || c.id === "e1"), "seules les consignes de l'assistant sont listées (jamais une saisie manuelle)");
});

await bloc("9. Gardes statiques : admin seulement, écriture limitée, pas de bouton Appliquer, design de l'appli", () => {
  const app = lire("src/App.jsx");
  verifier(/\{role === "admin" && \(\s*<Suspense fallback=\{null\}>\s*<AssistantPlanning /.test(app), "App.jsx : monté pour role === \"admin\" uniquement");
  const ecran = lire("src/Renovation/AssistantPlanning.jsx") + lire("src/Renovation/AssistantPlanningApercu.jsx");
  verifier(!/supabase/i.test(ecran.replace(/\/\/.*$/gm, "")), "les écrans ne parlent pas à Supabase");
  verifier(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(ecran), "aucune couleur en dur dans les écrans (thème T, accent de branche, jetons)");
  verifier(ecran.includes("Application au planning : étape 3") && !/>\s*Appliquer au planning\s*</.test(ecran), "pas de bouton « Appliquer », texte « Application au planning : étape 3 »");
  const donnees = lire("src/Renovation/assistantPlanningDonnees.js");
  const ecrituresNav = donnees.match(/\.(insert|update|upsert|delete)\s*\(/g) || [];
  verifier(ecrituresNav.length === 2 && donnees.includes(".delete().eq(\"id\", id).eq(\"source\", SOURCE_ASSISTANT)"), "navigateur : une insertion et une suppression (source = assistant) seulement");
  verifier(!/planning_cells"\)\.(insert|update|upsert|delete)|from\("phasages"\)\.(insert|update|upsert|delete)/.test(donnees), "ni le planning ni les phasages ne sont écrits");
  const serveur = lire("api/_ia/renovation/outilsPlanning.js") + lire("api/_ia/taches/renovation_planning_consigne.js");
  verifier(!/\.\s*(insert|update|upsert|delete|rpc)\s*\(/.test(serveur.replace(/\/\/.*$/gm, "")), "serveur : aucune écriture dans la tâche et ses outils");
  const wf = lire(".github/workflows/verify-planning-engine-v1.yml");
  verifier(wf.includes("scripts/verif-assistant-planning-etape-2.mjs"), "script branché dans un workflow de vérification");
});

console.log(blocs.join("\n"));
console.log("\n" + exemples.join("\n\n"));
console.log(`\n${ok} contrôles OK, ${echecs.length} en échec.`);
if (echecs.length) process.exit(1);
