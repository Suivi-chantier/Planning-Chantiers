#!/usr/bin/env node
// Vérifie la logique serveur PURE de l'Edge Function progbat-library-cadences
// (progbatCadencesServeur.mjs) avec des doublures : jamais l'API ProGBat réelle,
// jamais Supabase. Chaque appel ProGBat et chaque écriture Supabase sont
// enregistrés pour prouver : GET uniquement, aucune écriture pendant l'analyse,
// plan côté serveur, cadences du navigateur ignorées, hash, concurrence.
import assert from "node:assert/strict";
import { traiterRequeteCadences, idsCompositionsALire, executerEnPool, resumerImport, nettoyerMessage } from "../src/Renovation/progbatCadencesServeur.mjs";
import { hacherPlanCadences, construirePlanCadences, STATUTS } from "../src/Renovation/progbatCadences.mjs";

const ADMIN = { id: "u-admin", email: "admin@profero.test", role: "admin", actif: true };
const MO = (q) => ({ componentId: 20, componentType: 2, componentCode: "MO - INVESTISSEUR", quantity: q, unitCode: "H", staffTime: 0 });
const JOBS = [{ id: 20, type: 2, unitCode: "H", label: "Main d'œuvre" }, { id: 31, type: 2, unitCode: "U" }];
const STRUCTURES = [{ id: 416, unitCode: "m²" }, { id: 361, unitCode: "m²" }, { id: 656, unitCode: "U" }];
const OUVRAGES = [
  { id: "11111111-1111-4111-8111-111111111111", libelle: "D-001 : Tapisserie", unite: "m2", cadence: 0.2, progbat_id: "416" },   // → 0.1 à importer
  { id: "22222222-2222-4222-8222-222222222222", libelle: "D-002 : Cloisons", unite: "m2", cadence: 0.16, progbat_id: "361" },   // identique
  { id: "33333333-3333-4333-8333-333333333333", libelle: "D-008 : Carottage", unite: "U", cadence: 1.5, progbat_id: "656" },    // → 1.6 à importer
  { id: "44444444-4444-4444-8444-444444444444", libelle: "COUV-001 : Couverture", unite: "m2", cadence: null, progbat_id: null }, // non lié
];
const COMPOS = { 416: [MO(0.1)], 361: [MO(0.16)], 656: [MO(1.6)] };

/** Doublure ProGBat : journalise chaque appel ; `pannes` permet de simuler 401/403/404/429/5xx/timeout. */
function faireProgbat({ jeton = true, pannes = {}, listeStructures = STRUCTURES, listeJobs = JOBS, compos = COMPOS } = {}) {
  const appels = [];
  return {
    appels,
    jetonPresent: jeton,
    async listerStructures() { appels.push("GET /company/library/structures"); if (pannes.structures) return { ok: false, ...pannes.structures }; return { ok: true, items: listeStructures }; },
    async listerJobs() { appels.push("GET /company/jobs"); if (pannes.jobs) return { ok: false, ...pannes.jobs }; return { ok: true, items: listeJobs }; },
    async lireComposition(id) {
      appels.push(`GET /company/structures/${id}/composition?exploded=true`);
      const p = pannes.compositions?.[id] || pannes.toutesCompositions;
      if (p) return { ok: false, ...p };
      return { ok: true, data: compos[id] };
    },
  };
}

/** Doublure Supabase : mémoire + journal des écritures ; la « RPC » revalide comme la fonction SQL. */
function faireDepot({ ouvrages = OUVRAGES, rpc } = {}) {
  const etat = { ouvrages: ouvrages.map((o) => ({ ...o })), plans: new Map(), runs: [], items: [], ecritures: [] };
  const depot = {
    etat,
    async chargerOuvrages() { return etat.ouvrages.map((o) => ({ ...o })); },
    async enregistrerPlan(ligne) { const id = `plan-${etat.plans.size + 1}`.padEnd(36, "0").replace(/^plan-(\d)0*$/, (m, d) => `0000000$-0000-4000-8000-00000000000${d}`.replace("$", d)); etat.plans.set(id, { id, ...ligne }); etat.ecritures.push(`INSERT plans ${id}`); return { ok: true, id }; },
    async chargerPlan(id) { return etat.plans.get(id) ? { ...etat.plans.get(id) } : null; },
    async appliquerPlan({ planId, planHash, userId, userEmail }) {
      etat.ecritures.push(`RPC progbat_cadences_appliquer ${planId}`);
      if (rpc) return rpc({ planId, planHash, userId, userEmail, etat });
      // Reproduction fidèle de la fonction SQL : tout ou rien.
      const plan = etat.plans.get(planId);
      if (!plan) return { ok: false, code: "P0001", message: "PLAN_INTROUVABLE" };
      if (plan.plan_hash !== planHash) return { ok: false, code: "P0001", message: "HASH_DIFFERENT" };
      if (plan.statut !== "prepared") return { ok: false, code: "P0001", message: `PLAN_DEJA_TRAITE:${plan.statut}` };
      const sauvegarde = etat.ouvrages.map((o) => ({ ...o }));
      const runId = `run-${etat.runs.length + 1}`;
      const nouveauxItems = [];
      let nb = 0;
      for (const it of plan.items.filter((i) => i.statut === "a_importer")) {
        const o = etat.ouvrages.find((x) => x.id === it.ouvrage_id);
        const echec = (msg) => { etat.ouvrages = sauvegarde; return { ok: false, code: "P0001", message: msg }; };
        if (!o) return echec(`OUVRAGE_INTROUVABLE:${it.ouvrage_id}`);
        if ((o.progbat_id ?? "") !== (it.progbat_id ?? "")) return echec(`LIAISON_MODIFIEE:${it.ouvrage_id}`);
        if ((o.cadence == null) !== (it.cadence_avant == null) || (o.cadence != null && Math.abs(o.cadence - it.cadence_avant) > 0.00005)) return echec(`CADENCE_MODIFIEE:${it.ouvrage_id}`);
        nouveauxItems.push({ run_id: runId, ouvrage_id: o.id, progbat_id: o.progbat_id, cadence_avant: o.cadence, cadence_apres: it.cadence_apres, methode: it.methode, statut: "applied", plan_hash: plan.plan_hash, created_by_email: userEmail });
        o.cadence = it.cadence_apres; o.cadence_source = "progbat_import"; o.cadence_import_run_id = runId; o.cadence_imported_at = "now";
        nb++;
      }
      etat.runs.push({ id: runId, plan_id: planId, plan_hash: planHash, statut: "applied", nb_modifies: nb, created_by_email: userEmail, started_at: "2026-09-16T14:30:00Z", finished_at: "2026-09-16T14:30:01Z" });
      etat.items.push(...nouveauxItems);
      plan.statut = "applied"; plan.run_id = runId;
      return { ok: true, run_id: runId, nb_modifies: nb };
    },
    async enregistrerEchec({ planId, code, message, userEmail }) {
      etat.ecritures.push(`INSERT runs failed ${planId}`);
      etat.runs.push({ id: `run-${etat.runs.length + 1}`, plan_id: planId, statut: "failed", error_code: code, error_message: message, created_by_email: userEmail });
      const p = etat.plans.get(planId); if (p && p.statut === "prepared") { p.statut = "rejected"; p.error_code = code; }
      return { ok: true };
    },
    async dernierImport() { return [...etat.runs].reverse().find((r) => r.statut === "applied") || null; },
  };
  return depot;
}

const analyser = (progbat, depot, appelant = ADMIN) => traiterRequeteCadences({ action: "analyser" }, { appelant, depot, progbat });
const confirmer = (req, depot, appelant = ADMIN, progbat = faireProgbat()) => traiterRequeteCadences({ action: "confirmer", ...req }, { appelant, depot, progbat });

// ─── 1-3. Appelant ───────────────────────────────────────────────────────────
{
  const p = faireProgbat(); const d = faireDepot();
  assert.equal((await traiterRequeteCadences({ action: "analyser" }, { appelant: null, depot: d, progbat: p })).http, 401, "non authentifié");
  assert.equal((await analyser(p, d, { ...ADMIN, role: "ouvrier" })).http, 403, "ouvrier refusé");
  assert.equal((await analyser(p, d, { ...ADMIN, role: "comptable" })).http, 403, "rôle non autorisé refusé");
  assert.equal((await analyser(p, d, { ...ADMIN, actif: false })).http, 403, "inactif refusé");
  assert.equal(p.appels.length, 0, "aucun appel ProGBat pour un appelant refusé");
  assert.equal(d.etat.ecritures.length, 0);
  assert.equal((await traiterRequeteCadences({ action: "supprimer" }, { appelant: ADMIN, depot: d, progbat: p })).body.code, "action_inconnue");
}
// 4. Secret absent
{
  const p = faireProgbat({ jeton: false }); const d = faireDepot();
  const r = await analyser(p, d);
  assert.equal(r.http, 500); assert.equal(r.body.code, "secret_absent"); assert.equal(p.appels.length, 0);
}
// 23-24. Erreurs 401 / 403 / 404 / 429 / 5xx / délai / réseau
{
  for (const status of [401, 403, 429, 500, 503]) {
    const p = faireProgbat({ pannes: { structures: { status, message: `HTTP ${status}` } } }); const d = faireDepot();
    const r = await analyser(p, d);
    assert.equal(r.http, 200); assert.equal(r.body.ok, false); assert.equal(r.body.progbat_status, status); assert.equal(r.body.etape, "structures"); assert.equal(r.body.aucune_ecriture, true);
    assert.equal(d.etat.plans.size, 0, `aucun plan enregistré sur HTTP ${status}`);
  }
  const pj = faireProgbat({ pannes: { jobs: { status: 403, message: "scope" } } });
  assert.equal((await analyser(pj, faireDepot())).body.etape, "jobs");
  // délai / réseau (status 0) sur toutes les compositions → analyse inutilisable
  const pt = faireProgbat({ pannes: { toutesCompositions: { status: 0, message: "ProGBat n'a pas répondu en 15 s (délai dépassé)." } } }); const dt = faireDepot();
  const rt = await analyser(pt, dt);
  assert.equal(rt.body.ok, false); assert.equal(rt.body.etape, "compositions"); assert.equal(rt.body.progbat_status, 0); assert.equal(dt.etat.plans.size, 0);
  // 404 sur UNE composition → structure_introuvable pour cet ouvrage, les autres continuent ; 500 isolé → erreur_lecture
  const pu = faireProgbat({ pannes: { compositions: { 416: { status: 404, message: "introuvable" }, 656: { status: 500, message: "Bearer abcdefghijklmnopqrstuvwxyz0123456789 indisponible" } } } }); const du = faireDepot();
  const ru = await analyser(pu, du);
  assert.equal(ru.body.ok, true);
  const parId = Object.fromEntries(ru.body.plan.lignes.map((l) => [l.ouvrage_id, l]));
  assert.equal(parId[OUVRAGES[0].id].statut, STATUTS.structure_introuvable);
  assert.equal(parId[OUVRAGES[2].id].statut, STATUTS.erreur_lecture);
  assert.ok(!JSON.stringify(ru.body).includes("abcdefghijklmnopqrstuvwxyz0123456789"), "43. aucune fuite d'une séquence ressemblant à un jeton");
  assert.equal(parId[OUVRAGES[1].id].statut, STATUTS.identique);
}

// ─── Doublons de liaison réels de production (ProGBat 300 → 2× P-920, 312 → 2× P-1101) ──
// Aucune composition n'est même lue pour un identifiant partagé, et aucun des deux
// ouvrages n'est importable : la cadence renseignée n'est jamais écrasée, la vide jamais remplie.
{
  const ouvragesDoublons = [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", libelle: "P-920 : Receveur", unite: "U", cadence: 6, progbat_id: "300" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", libelle: "P-920 : Receveur (copie)", unite: "U", cadence: null, progbat_id: "300" },
    { id: "bbbbbbbb-0000-4000-8000-000000000001", libelle: "P-1101 : Cuisine", unite: "U", cadence: null, progbat_id: "312" },
    { id: "bbbbbbbb-0000-4000-8000-000000000002", libelle: "P-1101 : Cuisine (copie)", unite: "U", cadence: 10, progbat_id: "312" },
    { id: "cccccccc-0000-4000-8000-000000000001", libelle: "D-001 : Tapisserie", unite: "m2", cadence: 0.2, progbat_id: "416" },
  ];
  const p = faireProgbat({ listeStructures: [...STRUCTURES, { id: 300, unitCode: "U" }, { id: 312, unitCode: "U" }] });
  const d = faireDepot({ ouvrages: ouvragesDoublons });
  const a = await analyser(p, d);
  const parId = Object.fromEntries(a.body.plan.lignes.map((l) => [l.ouvrage_id, l]));
  for (const id of ouvragesDoublons.slice(0, 4).map((o) => o.id)) {
    assert.equal(parId[id].statut, STATUTS.doublon_liaison, `${id} : doublon signalé, jamais importé`);
    assert.equal(parId[id].cadence_apres, null);
  }
  assert.equal(a.body.plan.synthese.a_importer, 1, "seul l'ouvrage à liaison unique est importable");
  assert.ok(!p.appels.some((x) => x.includes("/300/") || x.includes("/312/")), "aucune composition lue pour un identifiant partagé");
  const r = await confirmer({ planId: a.body.planId, planHash: a.body.planHash, confirmed: true }, d);
  assert.equal(r.body.nb_modifies, 1);
  assert.equal(d.etat.ouvrages[0].cadence, 6, "cadence renseignée du doublon intacte");
  assert.equal(d.etat.ouvrages[1].cadence, null, "cadence vide du doublon non remplie");
  assert.equal(d.etat.ouvrages[3].cadence, 10);
  assert.equal(d.etat.ouvrages[4].cadence, 0.1);
}

// ─── 25-26. Analyse : GET uniquement, aucune écriture métier, plan côté serveur ─
const progbat = faireProgbat();
const depot = faireDepot();
const analyse = await analyser(progbat, depot);
assert.equal(analyse.http, 200); assert.equal(analyse.body.ok, true);
assert.ok(progbat.appels.every((a) => a.startsWith("GET ")), "42. uniquement des GET vers ProGBat");
assert.deepEqual(idsCompositionsALire(OUVRAGES, STRUCTURES), [361, 416, 656]);
assert.equal(progbat.appels.filter((a) => a.includes("/composition?exploded=true")).length, 3, "une seule représentation (exploded) par structure");
assert.deepEqual(depot.etat.ecritures, [`INSERT plans ${analyse.body.planId}`], "seule écriture : le plan figé côté serveur");
assert.deepEqual(depot.etat.ouvrages, OUVRAGES, "25. aucune cadence modifiée pendant l'analyse");
assert.equal(analyse.body.plan.synthese.a_importer, 2); assert.equal(analyse.body.plan.synthese.identiques, 1); assert.equal(analyse.body.plan.synthese.non_lies, 1);
assert.equal(analyse.body.plan.synthese.ecritures, 0);
assert.match(analyse.body.planHash, /^[0-9a-f]{64}$/);
const planStocke = depot.etat.plans.get(analyse.body.planId);
assert.equal(planStocke.plan_hash, analyse.body.planHash); assert.equal(planStocke.prepared_by_email, ADMIN.email); assert.equal(planStocke.statut, "prepared");
assert.equal(planStocke.items.filter((i) => i.statut === "a_importer").length, 2);
assert.equal(analyse.body.dernier_import, null);

// ─── 27-29. Confirmation : cadences du navigateur ignorées, confirmation absente, hash incorrect ─
{
  const r = await confirmer({ planId: analyse.body.planId, planHash: analyse.body.planHash }, depot);
  assert.equal(r.http, 400); assert.equal(r.body.code, "confirmation_requise");
  const r2 = await confirmer({ planId: analyse.body.planId, planHash: "0".repeat(64), confirmed: true }, depot);
  assert.equal(r2.http, 409); assert.equal(r2.body.code, "hash_incorrect");
  const r3 = await confirmer({ planId: "pas-un-uuid", planHash: analyse.body.planHash, confirmed: true }, depot);
  assert.equal(r3.http, 400); assert.equal(r3.body.code, "plan_invalide");
  const r4 = await confirmer({ planId: "99999999-9999-4999-8999-999999999999", planHash: analyse.body.planHash, confirmed: true }, depot);
  assert.equal(r4.http, 404);
  assert.deepEqual(depot.etat.ouvrages, OUVRAGES, "rien d'écrit après ces refus");
  assert.equal(depot.etat.runs.length, 0, "les refus de forme ne créent pas d'exécution");
}
// 30. Cadence Profero modifiée après l'aperçu → refus, aucune écriture, plan rejeté
{
  const d = faireDepot(); const p = faireProgbat();
  const a = await analyser(p, d);
  d.etat.ouvrages[0].cadence = 0.25;               // modification concurrente dans la Bibliothèque
  const r = await confirmer({ planId: a.body.planId, planHash: a.body.planHash, confirmed: true }, d);
  assert.equal(r.http, 409); assert.equal(r.body.code, "donnees_modifiees"); assert.match(r.body.error, /cadence Profero a changé/);
  assert.equal(d.etat.ouvrages[2].cadence, 1.5, "33. rollback complet : la 2e cadence n'a pas été écrite non plus");
  assert.equal(d.etat.plans.get(a.body.planId).statut, "rejected");
  assert.equal(d.etat.runs.at(-1).statut, "failed");
}
// 31. Liaison progbat_id modifiée après l'aperçu
{
  const d = faireDepot(); const p = faireProgbat();
  const a = await analyser(p, d);
  d.etat.ouvrages[2].progbat_id = "999";
  const r = await confirmer({ planId: a.body.planId, planHash: a.body.planHash, confirmed: true }, d);
  assert.equal(r.body.code, "donnees_modifiees"); assert.match(r.body.error, /liaison ProGBat a changé/);
  assert.equal(d.etat.ouvrages[0].cadence, 0.2, "aucune mise à jour partielle");
}
// 27. Cadences injectées depuis le navigateur : ignorées
{
  const d = faireDepot(); const p = faireProgbat();
  const a = await analyser(p, d);
  const r = await confirmer({ planId: a.body.planId, planHash: a.body.planHash, confirmed: true, items: [{ ouvrage_id: OUVRAGES[1].id, cadence_apres: 99 }], cadences: { [OUVRAGES[0].id]: 42 }, plan: { lignes: [] } }, d);
  assert.equal(r.http, 200); assert.equal(r.body.ok, true); assert.equal(r.body.nb_modifies, 2);
  assert.equal(d.etat.ouvrages[0].cadence, 0.1, "valeur du plan serveur, pas 42");
  assert.equal(d.etat.ouvrages[1].cadence, 0.16, "ligne identique intacte, pas 99");
  assert.equal(d.etat.ouvrages[2].cadence, 1.6);
  assert.equal(d.etat.ouvrages[3].cadence, null, "ouvrage non lié intact");
  // 32. atomique : une seule RPC, pas d'UPDATE unitaire depuis l'Edge Function
  assert.deepEqual(d.etat.ecritures.filter((e) => !e.startsWith("INSERT plans")), [`RPC progbat_cadences_appliquer ${a.body.planId}`]);
  assert.equal(p.appels.filter((x) => !x.startsWith("GET ")).length, 0, "42. toujours aucune écriture ProGBat");
  // 36. historique complet
  assert.equal(d.etat.items.length, 2);
  const it = d.etat.items.find((i) => i.ouvrage_id === OUVRAGES[0].id);
  assert.deepEqual({ avant: it.cadence_avant, apres: it.cadence_apres, pid: it.progbat_id, statut: it.statut, hash: it.plan_hash, email: it.created_by_email }, { avant: 0.2, apres: 0.1, pid: "416", statut: "applied", hash: a.body.planHash, email: ADMIN.email });
  assert.match(it.methode, /Somme des jobs horaires/);
  // 38. métadonnées de provenance
  assert.equal(d.etat.ouvrages[0].cadence_source, "progbat_import"); assert.equal(d.etat.ouvrages[0].cadence_import_run_id, r.body.run_id);
  assert.equal(d.etat.ouvrages[1].cadence_source, undefined, "ligne identique : provenance non touchée");
  assert.equal(r.body.source_verite, "profero"); assert.equal(r.body.aucune_ecriture_progbat, true);
  // 34. Double-clic : même plan rejoué → refusé, rien de réécrit
  const bis = await confirmer({ planId: a.body.planId, planHash: a.body.planHash, confirmed: true }, d);
  assert.equal(bis.http, 409); assert.equal(bis.body.code, "plan_deja_traite");
  assert.equal(d.etat.items.length, 2, "aucune ligne d'audit supplémentaire");
  assert.equal(d.etat.runs.filter((x) => x.statut === "applied").length, 1);
  // status
  const st = await traiterRequeteCadences({ action: "status" }, { appelant: ADMIN, depot: d, progbat: p });
  assert.equal(st.body.dernier_import.nb_modifies, 2); assert.equal(st.body.dernier_import.created_by_email, ADMIN.email);
  assert.equal(p.appels.filter((x) => x.includes("composition")).length, 3, "status : aucune lecture ProGBat supplémentaire");
  // 44. Relance idempotente : 0 à modifier, aucune écriture
  const p2 = faireProgbat();
  const a2 = await analyser(p2, d);
  assert.equal(a2.body.plan.synthese.a_importer, 0); assert.equal(a2.body.plan.synthese.identiques, 3);
  const ecrituresAvant = d.etat.ecritures.length;
  const r2 = await confirmer({ planId: a2.body.planId, planHash: a2.body.planHash, confirmed: true }, d);
  assert.equal(r2.http, 200); assert.equal(r2.body.nb_modifies, 0); assert.equal(r2.body.aucune_ecriture, true);
  assert.equal(d.etat.ecritures.length, ecrituresAvant, "aucune RPC ni écriture pour un plan vide");
  assert.equal(d.etat.items.length, 2);
}
// 35. Deux imports concurrents (deux onglets / deux utilisateurs) : le second plan est refusé par la revalidation
{
  const d = faireDepot(); const p = faireProgbat();
  const a1 = await analyser(p, d);
  const a2 = await analyser(p, d, { ...ADMIN, id: "u-2", email: "conducteur@profero.test", role: "conducteur" });
  assert.equal(a1.body.planHash, a2.body.planHash, "même contenu, même hash, mais deux plans distincts");
  const r1 = await confirmer({ planId: a1.body.planId, planHash: a1.body.planHash, confirmed: true }, d);
  assert.equal(r1.body.ok, true);
  const r2 = await confirmer({ planId: a2.body.planId, planHash: a2.body.planHash, confirmed: true }, d, { ...ADMIN, id: "u-2", email: "conducteur@profero.test", role: "conducteur" });
  assert.equal(r2.http, 409); assert.equal(r2.body.code, "donnees_modifiees", "les cadences ont changé depuis l'aperçu du 2e onglet");
  assert.equal(d.etat.items.length, 2, "un seul import a écrit");
  assert.equal(d.etat.ouvrages[0].cadence, 0.1);
  // verrou SQL pris par un autre import strictement simultané
  const d3 = faireDepot({ rpc: () => ({ ok: false, code: "P0001", message: "IMPORT_EN_COURS" }) }); const p3 = faireProgbat();
  const a3 = await analyser(p3, d3);
  const r3 = await confirmer({ planId: a3.body.planId, planHash: a3.body.planHash, confirmed: true }, d3);
  assert.equal(r3.http, 409); assert.equal(r3.body.code, "import_en_cours");
  // plan expiré
  const d4 = faireDepot(); const p4 = faireProgbat();
  const a4 = await analyser(p4, d4);
  d4.etat.plans.get(a4.body.planId).prepared_at = "2026-09-16T10:00:00.000Z";
  const r4 = await traiterRequeteCadences({ action: "confirmer", planId: a4.body.planId, planHash: a4.body.planHash, confirmed: true }, { appelant: ADMIN, depot: d4, progbat: p4, maintenant: new Date("2026-09-16T11:00:00.000Z") });
  assert.equal(r4.body.code, "plan_expire");
  // erreur RPC inattendue → 500, aucune écriture, plan rejeté, message nettoyé
  const d5 = faireDepot({ rpc: () => ({ ok: false, code: "XX000", message: "boom Bearer abcdefghijklmnopqrstuvwxyz0123456789" }) }); const p5 = faireProgbat();
  const a5 = await analyser(p5, d5);
  const r5 = await confirmer({ planId: a5.body.planId, planHash: a5.body.planHash, confirmed: true }, d5);
  assert.equal(r5.http, 500); assert.equal(r5.body.code, "erreur_application"); assert.equal(r5.body.aucune_ecriture, true);
  assert.ok(!JSON.stringify(d5.etat.runs).includes("abcdefghijklmnopqrstuvwxyz0123456789"), "43. message d'échec nettoyé dans l'audit");
}
// Utilitaires
{
  const ordre = [];
  const res = await executerEnPool([1, 2, 3, 4, 5, 6], async (n) => { ordre.push(n); return n * 2; }, 4);
  assert.equal(res.get(6), 12); assert.equal(res.size, 6);
  assert.equal(nettoyerMessage("Bearer abcdefghijklmnopqrstuvwxyz0123456789 ko"), "[masqué] ko");
  assert.equal(resumerImport(null), null);
  assert.equal(resumerImport({ id: "r", statut: "applied", nb_modifies: 3, error_message: "erreur ".repeat(60) }).message.length, 200, "message d'audit tronqué à 200 caractères");
  assert.equal(resumerImport({ id: "r", statut: "applied", nb_modifies: 3, error_message: "x".repeat(300) }).message, "[masqué]", "une longue séquence continue est masquée avant d'être tronquée");
  // hash serveur = hash du module pur sur le même plan
  const plan = construirePlanCadences({ ouvrages: OUVRAGES, structures: STRUCTURES, compositions: new Map(Object.entries(COMPOS).map(([k, v]) => [Number(k), { ok: true, data: v }])), jobs: JOBS });
  assert.equal(await hacherPlanCadences(plan), analyse.body.planHash);
}

console.log("verif-progbat-cadences-serveur : OK (appelant, secret, erreurs 401/403/404/429/5xx/délai, analyse GET seule, plan serveur, confirmation, hash, cadences navigateur ignorées, modifications concurrentes, atomicité, double-clic, concurrence, audit, provenance, idempotence, aucune écriture ProGBat, aucune fuite)");
