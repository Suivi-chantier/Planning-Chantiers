#!/usr/bin/env node
// ─── ASSISTANT PLANNING — ÉTAPE 2 (chantier 10) ─────────────────────────────
// TOUTES les données de ce script sont FICTIVES (exemple issu des tests,
// données fictives) : « Steven », « Kev », « CHANTIER FICTIF A/B » ne sont que
// des étiquettes. Seuls les NOMS des quatre chantiers FOURMOND (001, 101, 102,
// COMMUNS) sont repris de la base (relevés le 25/09/2026, lecture seule) pour
// rejouer la phrase de Loris ; leurs identifiants, tâches et plannings sont
// inventés. Le modèle IA est SIMULÉ (scénario rejoué) : aucune phrase n'est
// réellement traduite par Claude ici, et aucune ligne ne vient de la base.
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
//     « Appliquer », aucune couleur en dur ;
//  8. demandes simples (« fais le planning de la semaine prochaine pour
//     fourmond ») : question à choix calculée par l'outil pour une famille de
//     chantiers, puis aperçu « Planning actuel / Proposition du moteur » sans
//     aucune écriture ; ton court, information réservée au hors planning.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as C from "../src/Renovation/assistantPlanningConsigneV1.mjs";
import { construireApercuPlanningActuelV1, construireApercuRecalculV1, semainesDisponiblesV1 } from "../src/Renovation/assistantPlanningApercuV1.mjs";
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
  // Noms réels (base, 25/09/2026), identifiants et contenu fictifs.
  { id: "CH-F001", nom: "FOURMOND 001", statut: "en_cours" },
  { id: "CH-F101", nom: "FOURMOND 101", statut: "en_cours" },
  { id: "CH-F102", nom: "FOURMOND 102", statut: "en_cours" },
  { id: "CH-FCOM", nom: "FOURMOND COMMUNS", statut: null },
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
    // Une étape peut être une fonction : elle reçoit la requête, donc les
    // résultats RÉELS des outils, et répond en conséquence.
    this.messages = { create: async (p) => { modele.recus.push(JSON.parse(JSON.stringify(p))); const e = modele.scenario.shift(); if (!e) throw new Error("scénario épuisé"); return typeof e === "function" ? e(p) : e; } };
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
// Dernier résultat d'outil renvoyé au modèle par /api/ai (tel quel).
const dernierResultatOutil = (p) => {
  const tour = [...p.messages].reverse().find(m => m.role === "user" && Array.isArray(m.content) && m.content.some(c => c.type === "tool_result"));
  return JSON.parse(tour.content.find(c => c.type === "tool_result").content);
};

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
function simuler({ contraintes = [], evenements = [], startDate = "2026-09-28", horizonDays = 28, phasagesSim = phasages, cellulesSim = [] } = {}) {
  const prep = preparerSimulationReplanningV1({ phasages: phasagesSim, chantiers, cellules: cellulesSim, ressources, evenementsRessources: evenements, contraintes, groupesTypes, equipes, startDate, horizonDays });
  const proposition = planifierReplanningIncrementalV1({ engineInput: prep.engineInput, forecast: prep.forecastCourant.allocations_recalculables, trigger: null });
  return {
    generated_at: "2026-09-24T09:32:00.000Z",
    horizon: { start_date: startDate, end_date: C.ajouterJoursV1(startDate, horizonDays - 1), horizon_days: horizonDays },
    referentiel: { chantiers: chantiers.map(c => ({ id: c.id, nom: c.nom })), ressources: ressources.map(r => ({ id: r.id, nom: r.nom, nom_planning: r.nom_planning })) },
    warnings_adaptateur: prep.warnings,
    forecast_courant: prep.forecastCourant,
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


// ─────────────────────────────────────────────────────────────────────────────
// Demandes simples : l'assistant répond OUI (question courte, puis aperçu)
// ─────────────────────────────────────────────────────────────────────────────
const PHRASE_LORIS = "Fais les plannings pour la semaine prochaine pour le chantier fourmond";
const S = (res) => tacheIA.validerSortie(res, { sb: fauxClient, aujourdhui: AUJOURDHUI });
let questionFourmond = null;

await bloc("10. Phrase exacte de Loris → question courte à 5 choix (4 FOURMOND + « Tous les FOURMOND »)", async () => {
  modele.recus.length = 0;
  modele.scenario = [
    outil("t1", "chercher_chantier", { texte: "fourmond" }),
    // Le modèle simulé reprend les choix RENVOYÉS PAR L'OUTIL (code réel).
    (p) => fin({ type: "question", message: "Quel chantier FOURMOND ?", outils_appeles: ["chercher_chantier"],
      choix: dernierResultatOutil(p).choix.map(c => ({ libelle: c.libelle, demande: `Fais les plannings pour la semaine prochaine pour ${c.libelle}` })) }),
  ];
  const nbEcritures = ecritures.filter(e => e.table !== "ia_jobs").length;
  const r = await appeler({ entree: { question: PHRASE_LORIS } });
  verifier(r.statusCode === 200 && r.body.resultat?.type === "question", `question acceptée (${r.statusCode} ${JSON.stringify(r.body?.erreur)})`);
  const outilRes = r.body.blocs?.find(b => b.outil === "chercher_chantier")?.resultat;
  verifier(outilRes?.nb === 4 && outilRes.choix.length === 5, `l'outil trouve 4 chantiers et prépare 5 choix (${outilRes?.nb}, ${outilRes?.choix?.length})`);
  verifier(outilRes?.choix.at(-1).libelle === "Tous les FOURMOND" && outilRes.choix.at(-1).chantier_ids.join() === "CH-F001,CH-F101,CH-F102,CH-FCOM", "« Tous les FOURMOND » porte les 4 chantiers");
  const libelles = (r.body.resultat?.choix || []).map(c => c.libelle);
  verifier(libelles.join(" | ") === "FOURMOND 001 | FOURMOND 101 | FOURMOND 102 | FOURMOND COMMUNS | Tous les FOURMOND", `5 boutons dans l'ordre (${libelles.join(" | ")})`);
  verifier(r.body.resultat.choix.every(c => c.demande && c.demande.endsWith(c.libelle)), "chaque bouton renvoie la demande complétée (l'admin ne retape rien)");
  verifier(r.body.resultat.message.length < 60, "question courte (une phrase)");
  const system = modele.recus[0]?.system || "";
  verifier(!system.includes("Hors consigne de planning") && system.includes("Une demande de planning, de recalcul ou de date de fin n'est JAMAIS hors planning"), "prompt : une demande de planning n'est plus « hors consigne »");
  verifier(system.includes("Jamais de mode d'emploi") && system.includes("1 à 2 phrases courtes"), "prompt : ton court, sans mode d'emploi");
  verifier(ecritures.filter(e => e.table !== "ia_jobs").length === nbEcritures, "aucune écriture (hors journal ia_jobs)");
  questionFourmond = r.body.resultat;
  exemple("Réponse à la phrase de Loris (modèle simulé, choix calculés par l'outil)", [
    `Loris : « ${PHRASE_LORIS} »`,
    `Assistant : ${r.body.resultat.message}`,
    `Boutons : ${libelles.map(l => `[${l}]`).join(" ")}`,
  ]);
});

await bloc("11. Famille de chantiers : un seul, aucun, trop nombreux (règle du module pur)", () => {
  const un = C.familleChantiersV1(chantiers, "fourmond 001");
  verifier(un.unique && un.chantiers[0].id === "CH-F001" && un.choix.length === 0, "« fourmond 001 » → un seul chantier, pas de question");
  const aucun = C.familleChantiersV1(chantiers, "chantier inexistant");
  verifier(aucun.inconnu && aucun.choix.length === 0, "nom inconnu → aucun choix inventé");
  const fini = C.familleChantiersV1(chantiers, "terminé");
  verifier(fini.inconnu, "un chantier terminé n'est jamais proposé");
  const famille = Array.from({ length: 6 }, (_, i) => ({ id: `CH-G${i}`, nom: `FAMILLE FICTIVE ${i + 1}`, statut: "en_cours" }));
  const trop = C.familleChantiersV1(famille, "famille fictive");
  verifier(trop.trop_nombreux && trop.nb === 6 && trop.choix.length === 0, "6 chantiers + « Tous » = 7 > 6 : on demande de préciser, sans boutons");
  const cinq = C.familleChantiersV1(famille.slice(0, 5), "famille fictive");
  verifier(!cinq.trop_nombreux && cinq.choix.length === 6, "5 chantiers + « Tous » = 6 boutons : accepté");
});

let apercuFourmond = null;
await bloc("12. Clic « FOURMOND 001 » → aperçu : bon périmètre, semaine du 28/09 lue dans le calendrier", async () => {
  const choix = questionFourmond?.choix?.[0];
  verifier(choix?.libelle === "FOURMOND 001", "premier bouton = FOURMOND 001");
  modele.recus.length = 0;
  modele.scenario = [
    outil("t1", "chercher_chantier", { texte: "FOURMOND 001" }),
    (p) => fin({ type: "apercu", message: "Voici le planning proposé pour FOURMOND 001, semaine du 28/09.", outils_appeles: ["chercher_chantier"],
      perimetre: { chantier_ids: dernierResultatOutil(p).chantiers.map(c => c.id), date_debut: "2026-09-28", date_fin: "2026-10-02" } }),
  ];
  const historique = [{ role: "user", texte: PHRASE_LORIS }, { role: "assistant", texte: `${questionFourmond.message}\nChoix proposés : ${questionFourmond.choix.map(c => c.libelle).join(" / ")}` }];
  const nbEcritures = ecritures.filter(e => e.table !== "ia_jobs").length;
  const r = await appeler({ entree: { question: choix.demande, historique } });
  verifier(r.statusCode === 200 && r.body.resultat?.type === "apercu", `aperçu accepté par le serveur (${r.statusCode} ${JSON.stringify(r.body?.erreur)})`);
  verifier(modele.recus[0].messages.at(-1).content === "Fais les plannings pour la semaine prochaine pour FOURMOND 001", "le clic a renvoyé la demande complète");
  const per = r.body.resultat.perimetre;
  verifier(per.chantier_ids.join() === "CH-F001" && per.date_debut === "2026-09-28" && per.date_fin === "2026-10-02", `périmètre FOURMOND 001, 28/09 → 02/10 (${JSON.stringify(per)})`);
  const system = modele.recus[0]?.system || "";
  verifier(system.includes("2026-09-28 = Lundi 28/09/2026 (semaine prochaine)") && system.includes("2026-10-02 = Vendredi 02/10/2026 (semaine prochaine)"), "lundi 28/09 et vendredi 02/10 figurent dans le calendrier donné au modèle, en « semaine prochaine »");
  verifier(!r.body.resultat.consigne, "aucune consigne dans un aperçu");
  verifier(ecritures.filter(e => e.table !== "ia_jobs").length === nbEcritures, "aucune écriture (ni consigne, ni planning)");
  const v = C.validerPerimetreApercuV1(per, { chantiers, aujourdhui: AUJOURDHUI });
  verifier(v.ok && v.perimetre.libelle === "FOURMOND 001 — du lun. 28/09 au ven. 02/10", `revalidation navigateur (${v.perimetre?.libelle})`);
  apercuFourmond = v.perimetre;
});

await bloc("13. Navigateur : planning actuel (planning_cells) ↔ proposition du moteur, filtré sur FOURMOND 001", () => {
  const phasagesF = [
    ...phasages,
    phasage("CH-F001", [tache("T-F1", "Doublage cloisons", 12, "CG-F1")], [{ id: "CG-F1", ordre: 10, groupe_type_id: "gt_placo" }]),
    phasage("CH-F101", [tache("T-F2", "Ossature placo séjour", 8, "CG-F2")], [{ id: "CG-F2", ordre: 10, groupe_type_id: "gt_placo" }]),
  ];
  // Planning actuel fictif (forme planning_cells), semaine S40.
  const cellulesF = [
    { id: "C1", week_id: "2026-W40", chantier_id: "CH-F001", jour: "Lundi", ouvriers: ["Steven"], taches: [{ allocation_uid: "U-F1", tache_id: "T-F1", text: "Doublage cloisons", duree: 7, ouvriers: ["Steven"] }] },
    { id: "C2", week_id: "2026-W40", chantier_id: "CH-F001", jour: "Mercredi", ouvriers: ["Kev"], taches: [{ allocation_uid: "U-F1-REU", tache_id: null, text: "Réunion de chantier fictive", duree: 1, ouvriers: ["Kev"] }] },
    { id: "C3", week_id: "2026-W40", chantier_id: "CH-F101", jour: "Mardi", ouvriers: ["Davy"], taches: [{ allocation_uid: "U-F2-LIV", tache_id: null, text: "Livraison fictive", duree: 2, ouvriers: ["Davy"] }] },
  ];
  const resultat = simuler({ phasagesSim: phasagesF, cellulesSim: cellulesF, horizonDays: 42 });
  const ap = construireApercuPlanningActuelV1({ resultat, lundi: apercuFourmond?.date_debut, chantierIds: apercuFourmond?.chantier_ids, capaciteBase: capaciteBasePlanningPourDate });
  verifier(ap.comparaison === "planning_actuel" && ap.lundi === "2026-09-28" && ap.chantier_ids.join() === "CH-F001", "comparaison « planning actuel », semaine du 28/09, périmètre FOURMOND 001");
  const tous = ap.lignes.flatMap(l => l.cellules.flatMap(c => [...c.avant, ...c.apres, ...c.fantomes]));
  verifier(tous.length > 0 && tous.every(i => i.chantier === "FOURMOND 001"), "seul FOURMOND 001 est affiché (le moteur a pourtant planifié tous les chantiers)");
  verifier(resultat.proposition.allocations_proposees.some(a => a.chantier_id !== "CH-F001"), "le moteur a bien planifié les autres chantiers ensemble");
  const steven = ap.lignes.find(l => l.resource_id === "R-STEVEN");
  verifier(steven?.cellules[0].avant.some(i => i.texte === "Doublage cloisons" && i.duree === 7), "vue « Planning actuel » : la ligne posée lundi dans planning_cells");
  const kevMer = ap.lignes.find(l => l.resource_id === "R-KEV")?.cellules[2];
  verifier(kevMer && kevMer.avant.some(i => i.texte === "Réunion de chantier fictive") && kevMer.apres.some(i => i.texte === "Réunion de chantier fictive" && !i.change), "ligne manuelle : identique dans les deux vues (le moteur la garde)");
  verifier(!ap.lignes.some(l => l.cellules.some(c => [...c.avant, ...c.apres].some(i => i.texte === "Livraison fictive"))), "la ligne de FOURMOND 101 n'apparaît pas");
  verifier(ap.fins.length === 1 && ap.fins[0].chantier === "FOURMOND 001" && ap.fins[0].avant.statut === "inconnu" && /^dernier jour posé/.test(ap.fins[0].avant.titre), `fin : jamais de date pour le planning actuel (${ap.fins[0]?.avant.titre} → ${ap.fins[0]?.apres.titre})`);
  verifier(ap.non_planifiees.every(n => n.raison && n.raison_code), "toute tâche non planifiée garde sa raison");
  const vide = construireApercuPlanningActuelV1({ resultat, lundi: "2026-09-28", chantierIds: ["CH-F102"], capaciteBase: capaciteBasePlanningPourDate });
  verifier(vide.chantiers_sans_travail.length === 1 && vide.chantiers_sans_travail[0].chantier === "FOURMOND 102", "chantier sans travail restant : dit explicitement, pas un bandeau vide");
  const global = construireApercuPlanningActuelV1({ resultat, lundi: "2026-09-28", chantierIds: [], capaciteBase: capaciteBasePlanningPourDate });
  verifier(global.fins.some(f => f.chantier === "CHANTIER FICTIF A") && global.fins.some(f => f.chantier === "FOURMOND 101"), "périmètre vide = tous les chantiers");
  exemple("Aperçu FOURMOND 001, semaine du 28/09", [
    `Planning actuel, Steven lun. 28/09 : ${steven.cellules[0].avant.map(i => `${i.texte} ${i.duree} h`).join(", ") || "rien"}`,
    `Proposition du moteur, Steven lun. 28/09 : ${steven.cellules[0].apres.map(i => `${i.texte} ${i.duree} h`).join(", ") || "rien"}`,
    ...ap.fins.map(f => `fin ${f.chantier} : ${f.avant.titre} → ${f.apres.titre}`),
    `résumé : ${ap.resume.deplacees} déplacée(s), ${ap.nouvelles.length} nouvellement placée(s), ${ap.resume.non_planifiees} non planifiée(s)`,
  ]);
});

await bloc("14. « recalcule les plannings » et « quand finit FOURMOND 001 ? » → aperçu", async () => {
  modele.scenario = [
    fin({ type: "apercu", message: "Voici le planning proposé pour tous les chantiers, semaine du 28/09.", outils_appeles: [],
      perimetre: { chantier_ids: [], date_debut: "2026-09-28", date_fin: "2026-10-02" } }),
  ];
  const r1 = await appeler({ entree: { question: "recalcule les plannings" } });
  verifier(r1.statusCode === 200 && r1.body.resultat.type === "apercu" && r1.body.resultat.perimetre.chantier_ids.length === 0, `« recalcule les plannings » → aperçu tous chantiers (${JSON.stringify(r1.body?.erreur)})`);
  verifier(C.validerPerimetreApercuV1(r1.body.resultat.perimetre, { chantiers, aujourdhui: AUJOURDHUI }).perimetre.tous === true, "périmètre vide = tous les chantiers");

  modele.scenario = [
    outil("t1", "chercher_chantier", { texte: "FOURMOND 001" }),
    (p) => fin({ type: "apercu", message: "Voici le planning proposé pour FOURMOND 001 : la fin prévue s'affiche dans l'aperçu.", outils_appeles: ["chercher_chantier"],
      perimetre: { chantier_ids: dernierResultatOutil(p).chantiers.map(c => c.id), date_debut: "2026-09-28", date_fin: "2026-10-02" } }),
  ];
  const r2 = await appeler({ entree: { question: "quand finit FOURMOND 001 ?" } });
  verifier(r2.statusCode === 200 && r2.body.resultat.type === "apercu" && r2.body.resultat.perimetre.chantier_ids.join() === "CH-F001", `« quand finit FOURMOND 001 ? » → aperçu (${JSON.stringify(r2.body?.erreur)})`);
  verifier(!/\d{1,2}\/\d{2}/.test(r2.body.resultat.message), "aucune date de fin inventée dans le message");
});

await bloc("15. Question financière → information d'une phrase ; mode d'emploi refusé", async () => {
  const phrase = "Je m'occupe seulement du planning : essayez « Planning de la semaine prochaine pour FOURMOND 001 ».";
  modele.scenario = [fin({ type: "information", message: phrase, outils_appeles: [] })];
  const r = await appeler({ entree: { question: "Quelle est la marge de FOURMOND 001 ?" } });
  verifier(r.statusCode === 200 && r.body.resultat.type === "information", `information acceptée (${JSON.stringify(r.body?.erreur)})`);
  verifier((r.body.resultat.message.match(/[.!?](?=\s|$)/g) || []).length === 1, "une seule phrase, avec un exemple de demande");
  const modeEmploi = Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1} : voici comment fonctionne l'assistant et ce qu'il sait faire.`).join("\n");
  const refus = await S({ type: "information", message: modeEmploi, outils_appeles: [] });
  verifier(Array.isArray(refus) && refus.some(e => /trop long/.test(e)), `réponse de 12 lignes refusée (${JSON.stringify(refus)})`);
});

await bloc("16. Refus des aperçus invalides (validerSortie)", async () => {
  const base = { type: "apercu", message: "Voici le planning proposé.", outils_appeles: [] };
  const cas = [
    [{ ...base, perimetre: { chantier_ids: ["CH-INEXISTANT"], date_debut: "2026-09-28", date_fin: "2026-10-02" } }, /Aucun chantier ne porte l'identifiant CH-INEXISTANT/],
    [{ ...base, perimetre: { chantier_ids: ["CH-FINI"], date_debut: "2026-09-28", date_fin: "2026-10-02" } }, /terminé/],
    [{ ...base, perimetre: { chantier_ids: [], date_debut: "2026-09-21", date_fin: "2026-09-25" } }, /avant aujourd'hui/],
    [{ ...base, perimetre: { chantier_ids: [], date_debut: "2026-09-28", date_fin: "2026-12-31" } }, /dépasse le calendrier/],
    [{ ...base, perimetre: { chantier_ids: [], date_debut: "2026-10-02", date_fin: "2026-09-28" } }, /fin est avant/],
    [{ ...base, perimetre: { chantier_ids: [], date_debut: "2026-02-31", date_fin: "2026-10-02" } }, /illisible/],
    [{ ...base, perimetre: { chantier_ids: "CH-F001", date_debut: "2026-09-28", date_fin: "2026-10-02" } }, /doit être une liste/],
    [{ ...base }, /périmètre de l'aperçu/],
    [{ type: "information", message: "ok", outils_appeles: [], perimetre: { chantier_ids: [] } }, /"perimetre" n'est permis que pour un aperçu/],
    [{ ...base, perimetre: { chantier_ids: [], date_debut: "2026-09-28", date_fin: "2026-10-02" }, consigne: { nature: "absence" } }, /"consigne" n'est permis/],
    [{ type: "question", message: "Lequel ?", outils_appeles: [], choix: Array.from({ length: 7 }, (_, i) => ({ libelle: `Choix ${i}` })) }, /entre 2 et 6 choix/],
  ];
  for (const [sortie, attendu] of cas) {
    const r = await S(sortie);
    verifier(Array.isArray(r) && r.some(e => attendu.test(e)), `refus attendu ${attendu} → ${JSON.stringify(r)}`);
  }
  const long = C.validerPerimetreApercuV1({ chantier_ids: [], date_debut: "2026-09-28", date_fin: "2026-11-20" }, { chantiers, aujourdhui: AUJOURDHUI, joursCalendrier: 120 });
  verifier(!long.ok && long.erreurs.some(e => e.code === "periode_trop_longue"), "période de plus de 6 semaines refusée");
  // Pipeline complet : un chantier inventé deux fois → refus clair après UNE relance.
  const invente = fin({ ...base, perimetre: { chantier_ids: ["CH-FANTOME"], date_debut: "2026-09-28", date_fin: "2026-10-02" } });
  modele.scenario = [invente, invente];
  const r = await appeler({ entree: { question: "Planning de la semaine prochaine pour Fantôme" } });
  verifier(r.statusCode === 502 && r.body.erreur.code === "sortie_invalide" && /aperçu refusé par le contrôle serveur : Aucun chantier/.test(r.body.erreur.message), `refus clair (${r.statusCode} ${r.body?.erreur?.message})`);
});

await bloc("17. Écran : bouton rapide, clic = demande complétée, aperçu sans écriture ni bouton Appliquer", () => {
  const ecran = lire("src/Renovation/AssistantPlanning.jsx");
  const apercuJsx = lire("src/Renovation/AssistantPlanningApercu.jsx");
  const donnees = lire("src/Renovation/assistantPlanningDonnees.js");
  verifier(/libelle: "Planning de la semaine prochaine"/.test(ecran) && /libelle: "Déclarer une absence"/.test(ecran) && /libelle: "Affecter quelqu'un"/.test(ecran) && /libelle: "Intervention figée"/.test(ecran), "bouton rapide « Planning de la semaine prochaine » à côté des trois autres");
  verifier(ecran.includes("onClick={() => envoyer(c.demande || c.libelle)}"), "un clic sur un choix renvoie la demande complétée");
  verifier(ecran.includes("Le moteur planifie tous les chantiers ensemble (équipes partagées) ; seul le périmètre demandé est affiché."), "ligne visible : le moteur planifie tout, seul le périmètre est affiché");
  verifier(/res\.type === "apercu"[\s\S]{0,200}lancerApercu\(res\.perimetre\)/.test(ecran), "sur « apercu », le moteur est lancé dans le navigateur");
  verifier(apercuJsx.includes('avant: "Planning actuel", apres: "Proposition du moteur"'), "libellés « Planning actuel » / « Proposition du moteur »");
  const fonction = /export async function apercuSansConsigne[\s\S]*?\r?\n}\r?\n/.exec(donnees)?.[0] || "";
  verifier(fonction && !/\.(insert|update|upsert|delete)\s*\(|enregistrerConsigne/.test(fonction), "apercuSansConsigne : aucune écriture");
  verifier(apercuJsx.includes("Application au planning : étape 3") && !/>\s*Appliquer/.test(ecran + apercuJsx), "toujours pas de bouton Appliquer");
});

console.log(blocs.join("\n"));
console.log("\n" + exemples.join("\n\n"));
console.log(`\n${ok} contrôles OK, ${echecs.length} en échec.`);
if (echecs.length) process.exit(1);
