// ─── IMPORT DES CADENCES PROGBAT : LOGIQUE SERVEUR PURE ──────────────────────
// Cœur de l'Edge Function `progbat-library-cadences` (actions analyser /
// confirmer / status), écrit SANS dépendance Deno ni Supabase : tout accès
// externe est injecté (`depot` = base Supabase, `progbat` = API ProGBat). Testé
// dans Node avec des doublures (scripts/verif-progbat-cadences-serveur.mjs).
// Copié dans supabase/functions/progbat-library-cadences/lib/ par
// scripts/sync-progbat-edge-lib.mjs (ne pas éditer la copie).
//
// Principe de sécurité
//   • analyser  : GET ProGBat uniquement (structures, jobs, compositions), AUCUNE
//                 écriture métier ; le plan est enregistré côté serveur
//                 (progbat_cadence_import_plans) avec son hash SHA-256.
//   • confirmer : le navigateur n'envoie que { action, planId, planHash, confirmed }.
//                 Toute cadence, liste ou identifiant d'ouvrage reçu du navigateur
//                 est IGNORÉ. Le serveur recharge le plan, vérifie hash / statut /
//                 validité puis délègue l'écriture à la fonction SQL
//                 progbat_cadences_appliquer (transaction unique, verrou, revalidation
//                 de chaque cadence et liaison, audit) : tout ou rien.
//   • status    : dernier import appliqué — aucune lecture ProGBat.
//
// Interface `depot` (async) :
//   chargerOuvrages()                → [{ id, libelle, unite, cadence, progbat_id }]
//   enregistrerPlan(ligne)           → { ok: true, id } | { ok: false, erreur }
//   chargerPlan(planId)              → ligne progbat_cadence_import_plans | null
//   appliquerPlan({ planId, planHash, userId, userEmail })
//                                    → { ok: true, run_id, nb_modifies } | { ok: false, code, message }
//   enregistrerEchec({ planId, planHash, userId, userEmail, code, message }) → { ok }
//   dernierImport()                  → ligne progbat_cadence_import_runs (statut applied) | null
// Interface `progbat` :
//   jetonPresent                     → false si PROGBAT_PRIVATE_ACCESS_TOKEN manque
//   listerStructures()               → { ok: true, items } | { ok: false, status, message }
//   listerJobs()                     → { ok: true, items } | { ok: false, status, message }
//   lireComposition(progbatId)       → { ok: true, data } | { ok: false, status, message }
//                                      (GET /company/structures/{id}/composition?exploded=true)

import {
  construirePlanCadences, hacherPlanCadences, itemsPourPlan, controlerAppelant,
  progbatIdValide, STATUTS, VALIDITE_PLAN_MS, METHODE_EXTRACTION,
} from "./progbatCadences.mjs";

export const ACTIONS = Object.freeze(["analyser", "confirmer", "status"]);
export const CONCURRENCE_MAX = 4;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_HASH = /^[0-9a-f]{64}$/i;
const str = (v) => String(v ?? "").trim();

/** Nettoyage des messages renvoyés : court, sans séquence ressemblant à un jeton. */
export function nettoyerMessage(raw) {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/bearer\s+\S+/gi, "[masqué]").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim();
  return s.slice(0, 200);
}

/** Résumé NON sensible d'un import appliqué. */
export function resumerImport(run) {
  if (!run) return null;
  return {
    id: run.id ?? null,
    statut: run.statut ?? null,
    plan_hash: run.plan_hash ?? null,
    nb_modifies: run.nb_modifies ?? 0,
    started_at: run.started_at ?? null,
    finished_at: run.finished_at ?? null,
    created_by_email: run.created_by_email ?? null,
    message: run.error_message ? nettoyerMessage(run.error_message) : null,
  };
}

/** Exécute `fn` sur chaque élément avec au plus `limite` appels simultanés (ordre indifférent). */
export async function executerEnPool(items, fn, limite = CONCURRENCE_MAX) {
  const file = [...items];
  const resultats = new Map();
  const worker = async () => {
    while (file.length) {
      const it = file.shift();
      resultats.set(it, await fn(it));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, file.length || 1)) }, worker));
  return resultats;
}

/** Identifiants ProGBat dont la composition doit être lue : liés, valides, uniques, présents dans ProGBat. */
export function idsCompositionsALire(ouvrages = [], structures = []) {
  const structIds = new Set((structures || []).map((s) => progbatIdValide(s?.id)).filter((x) => x != null));
  const compte = new Map();
  for (const o of ouvrages || []) {
    const id = progbatIdValide(o?.progbat_id);
    if (id == null) continue;
    compte.set(id, (compte.get(id) || 0) + 1);
  }
  return [...compte.entries()].filter(([id, n]) => n === 1 && structIds.has(id)).map(([id]) => id).sort((a, b) => a - b);
}

async function actionStatus({ depot }) {
  const dernier = await depot.dernierImport();
  return { http: 200, body: { ok: true, action: "status", dernier_import: resumerImport(dernier), source_verite: "profero" }, journal: { action: "status" } };
}

async function actionAnalyser({ appelant, depot, progbat, maintenant }) {
  if (!progbat?.jetonPresent) {
    return { http: 500, body: { ok: false, code: "secret_absent", error: "Secret PROGBAT_PRIVATE_ACCESS_TOKEN non configuré dans Supabase." }, journal: { action: "analyser", code: "secret_absent" } };
  }
  const ouvrages = await depot.chargerOuvrages();
  const [structures, jobs] = await Promise.all([progbat.listerStructures(), progbat.listerJobs()]);
  if (!structures?.ok) {
    return { http: 200, body: { ok: false, code: "progbat_indisponible", etape: "structures", progbat_status: structures?.status ?? 0, error: nettoyerMessage(structures?.message) || "Lecture des structures ProGBat impossible.", aucune_ecriture: true }, journal: { action: "analyser", etape: "structures", http_progbat: structures?.status ?? 0 } };
  }
  if (!jobs?.ok) {
    return { http: 200, body: { ok: false, code: "progbat_indisponible", etape: "jobs", progbat_status: jobs?.status ?? 0, error: nettoyerMessage(jobs?.message) || "Lecture des jobs ProGBat impossible.", aucune_ecriture: true }, journal: { action: "analyser", etape: "jobs", http_progbat: jobs?.status ?? 0 } };
  }
  const ids = idsCompositionsALire(ouvrages, structures.items);
  const compositions = await executerEnPool(ids, async (id) => {
    const r = await progbat.lireComposition(id);
    return r?.ok ? { ok: true, data: r.data } : { ok: false, status: r?.status ?? 0, message: nettoyerMessage(r?.message) || "Lecture impossible" };
  });
  // Une interruption globale (401/403/429 sur toutes les lectures) rend l'analyse inutilisable.
  const echecs = [...compositions.values()].filter((c) => !c.ok);
  if (ids.length > 0 && echecs.length === ids.length) {
    const premier = echecs[0];
    return { http: 200, body: { ok: false, code: "progbat_indisponible", etape: "compositions", progbat_status: premier.status, error: premier.message, aucune_ecriture: true }, journal: { action: "analyser", etape: "compositions", http_progbat: premier.status } };
  }
  const preparedAt = (maintenant || new Date()).toISOString();
  const plan = construirePlanCadences({ ouvrages, structures: structures.items, compositions, jobs: jobs.items, preparedAt });
  const planHash = await hacherPlanCadences(plan);
  const enregistrement = await depot.enregistrerPlan({
    plan_hash: planHash,
    statut: "prepared",
    prepared_by: appelant.id ?? null,
    prepared_by_email: appelant.email,
    prepared_at: preparedAt,
    methode: plan.methode,
    nb_a_importer: plan.synthese.a_importer,
    compteurs: plan.compteurs,
    synthese: plan.synthese,
    items: itemsPourPlan(plan),
  });
  if (!enregistrement?.ok) {
    return { http: 500, body: { ok: false, code: "plan_non_enregistre", error: "Le plan d'import n'a pas pu être enregistré côté serveur.", aucune_ecriture: true }, journal: { action: "analyser", code: "plan_non_enregistre" } };
  }
  const dernier = await depot.dernierImport();
  return {
    http: 200,
    body: {
      ok: true,
      action: "analyser",
      lecture_seule: true,
      aucune_ecriture: true,
      aucune_ecriture_progbat: true,
      planId: enregistrement.id,
      planHash,
      valide_jusqua: new Date(new Date(preparedAt).getTime() + VALIDITE_PLAN_MS).toISOString(),
      plan,
      progbat: { nb_structures: structures.items.length, nb_jobs: jobs.items.length, nb_compositions_lues: ids.length - echecs.length, nb_compositions_en_erreur: echecs.length },
      dernier_import: resumerImport(dernier),
    },
    journal: { action: "analyser", ouvrages: ouvrages.length, compositions: ids.length, erreurs: echecs.length, a_importer: plan.synthese.a_importer, planId: enregistrement.id },
  };
}

function classerErreurRpc(code, message) {
  const m = String(message || "");
  const c = String(code || "");
  if (/PLAN_INTROUVABLE/.test(m)) return { http: 404, code: "plan_introuvable", error: "Plan d'import introuvable : relancer l'analyse." };
  if (/HASH_DIFFERENT/.test(m)) return { http: 409, code: "hash_incorrect", error: "Le plan confirmé ne correspond pas au plan enregistré : relancer l'analyse." };
  if (/PLAN_DEJA_TRAITE/.test(m)) return { http: 409, code: "plan_deja_traite", error: "Ce plan a déjà été appliqué ou rejeté : relancer l'analyse." };
  if (/PLAN_EXPIRE/.test(m)) return { http: 409, code: "plan_expire", error: "Le plan d'import a expiré : relancer l'analyse." };
  if (/LIAISON_MODIFIEE/.test(m)) return { http: 409, code: "donnees_modifiees", error: "Une liaison ProGBat a changé depuis l'aperçu : aucune cadence modifiée, relancer l'analyse." };
  if (/CADENCE_MODIFIEE/.test(m)) return { http: 409, code: "donnees_modifiees", error: "Une cadence Profero a changé depuis l'aperçu : aucune cadence modifiée, relancer l'analyse." };
  if (/OUVRAGE_INTROUVABLE/.test(m)) return { http: 409, code: "donnees_modifiees", error: "Un ouvrage du plan n'existe plus : aucune cadence modifiée, relancer l'analyse." };
  if (/CADENCE_INVALIDE/.test(m)) return { http: 409, code: "plan_invalide", error: "Le plan contient une cadence invalide : aucune cadence modifiée." };
  if (/IMPORT_EN_COURS/.test(m) || c === "55P03") return { http: 409, code: "import_en_cours", error: "Un import est déjà en cours : patienter puis relancer l'analyse." };
  return { http: 500, code: "erreur_application", error: "L'import a échoué : aucune cadence n'a été modifiée (transaction annulée)." };
}

async function actionConfirmer({ requete, appelant, depot, maintenant }) {
  if (requete.confirmed !== true) {
    return { http: 400, body: { ok: false, code: "confirmation_requise", error: "Confirmation explicite requise." }, journal: { action: "confirmer", code: "confirmation_requise" } };
  }
  const planId = str(requete.planId);
  const planHash = str(requete.planHash).toLowerCase();
  if (!RE_UUID.test(planId) || !RE_HASH.test(planHash)) {
    return { http: 400, body: { ok: false, code: "plan_invalide", error: "Identifiant ou hash de plan invalide." }, journal: { action: "confirmer", code: "plan_invalide" } };
  }
  // Toute donnée métier envoyée par le navigateur (items, cadences, ouvrages…) est ignorée :
  // seules planId / planHash / confirmed sont lues.
  const plan = await depot.chargerPlan(planId);
  if (!plan) return { http: 404, body: { ok: false, code: "plan_introuvable", error: "Plan d'import introuvable : relancer l'analyse." }, journal: { action: "confirmer", code: "plan_introuvable" } };
  if (str(plan.plan_hash).toLowerCase() !== planHash) {
    return { http: 409, body: { ok: false, code: "hash_incorrect", error: "Le plan confirmé ne correspond pas au plan enregistré : relancer l'analyse." }, journal: { action: "confirmer", code: "hash_incorrect", planId } };
  }
  if (plan.statut !== "prepared") {
    return { http: 409, body: { ok: false, code: "plan_deja_traite", error: `Ce plan est déjà « ${plan.statut} » : relancer l'analyse.`, statut: plan.statut }, journal: { action: "confirmer", code: "plan_deja_traite", planId } };
  }
  const prepare = new Date(plan.prepared_at).getTime();
  const now = (maintenant || new Date()).getTime();
  if (!Number.isFinite(prepare) || now - prepare > VALIDITE_PLAN_MS) {
    return { http: 409, body: { ok: false, code: "plan_expire", error: "Le plan d'import a expiré (30 min) : relancer l'analyse." }, journal: { action: "confirmer", code: "plan_expire", planId } };
  }
  const nbAImporter = Array.isArray(plan.items) ? plan.items.filter((i) => i?.statut === STATUTS.a_importer).length : Number(plan.nb_a_importer) || 0;
  if (nbAImporter === 0) {
    // Relance idempotente : rien à écrire, aucune écriture inutile.
    return { http: 200, body: { ok: true, action: "confirmer", nb_modifies: 0, aucune_ecriture: true, message: "0 cadence à modifier : toutes les cadences importables sont déjà identiques." }, journal: { action: "confirmer", planId, nb_modifies: 0 } };
  }
  const res = await depot.appliquerPlan({ planId, planHash, userId: appelant.id ?? null, userEmail: appelant.email });
  if (res?.ok) {
    return {
      http: 200,
      body: { ok: true, action: "confirmer", planId, planHash, run_id: res.run_id, nb_modifies: res.nb_modifies, methode: METHODE_EXTRACTION, aucune_ecriture_progbat: true, source_verite: "profero", message: `${res.nb_modifies} cadence(s) importée(s). Profero est désormais la source de vérité pour les cadences.` },
      journal: { action: "confirmer", planId, run_id: res.run_id, nb_modifies: res.nb_modifies },
    };
  }
  const cl = classerErreurRpc(res?.code, res?.message);
  // L'échec est tracé dans une transaction séparée (le plan devient « rejected ») ; aucune cadence n'a été modifiée.
  if (typeof depot.enregistrerEchec === "function") {
    await depot.enregistrerEchec({ planId, planHash, userId: appelant.id ?? null, userEmail: appelant.email, code: cl.code, message: nettoyerMessage(res?.message) });
  }
  return { http: cl.http, body: { ok: false, code: cl.code, error: cl.error, aucune_ecriture: true }, journal: { action: "confirmer", planId, code: cl.code } };
}

/**
 * Point d'entrée unique.
 * @param requete  corps JSON reçu : { action, planId?, planHash?, confirmed? } — tout autre champ est ignoré
 * @param ctx      { appelant: { id, email, role, actif } | null, depot, progbat, maintenant? }
 * @returns {{ http: number, body: object, journal?: object }}
 */
export async function traiterRequeteCadences(requete = {}, { appelant, depot, progbat, maintenant = new Date() } = {}) {
  const refus = controlerAppelant(appelant);
  if (refus) return { ...refus, journal: { action: str(requete?.action) || "?", code: refus.body.code } };
  const action = str(requete?.action) || "analyser";
  if (!ACTIONS.includes(action)) return { http: 400, body: { ok: false, code: "action_inconnue", error: "Action inconnue." }, journal: { action, code: "action_inconnue" } };
  try {
    if (action === "status") return await actionStatus({ depot });
    if (action === "analyser") return await actionAnalyser({ appelant, depot, progbat, maintenant });
    return await actionConfirmer({ requete, appelant, depot, maintenant });
  } catch (e) {
    return { http: 500, body: { ok: false, code: "erreur_interne", error: "Erreur interne : " + nettoyerMessage(e?.message), aucune_ecriture: true }, journal: { action, code: "erreur_interne" } };
  }
}
