#!/usr/bin/env node
// Vérifie les règles PURES de l'import des cadences ProGBat (progbatCadences.mjs)
// et leurs effets sur les calculs Profero (chiffragePricing.mjs). Aucun réseau.
import assert from "node:assert/strict";
import {
  jobsHorairesValides, extraireCadence, comparerCadences, construirePlanCadences,
  donneesPourHashCadences, hacherPlanCadences, itemsPourPlan, controlerAppelant,
  progbatIdValide, cleUniteOuvrage, formatCadence, texteConfirmation,
  STATUTS, STATUTS_ANOMALIES, STATUTS_LABELS, METHODE_EXTRACTION, ROLES_AUTORISES,
} from "../src/Renovation/progbatCadences.mjs";
import { calculerOuvrage, creerSnapshotOuvrage, differencesSnapshot, appliquerActualisation } from "../src/Renovation/chiffragePricing.mjs";

// ─── Jobs horaires (données réelles du diagnostic du 16/09/2026) ─────────────
const JOBS = [
  { id: 4, type: 2, unitCode: "H", label: "Gérant" },
  { id: 5, type: 2, unitCode: "H", label: "Électricien" },
  { id: 7, type: 2, unitCode: "H", label: "Ouvrier d'exécution" },
  { id: 20, type: 2, unitCode: "H", label: "Main d'œuvre", code: "MO - INVESTISSEUR" },
  { id: 31, type: 2, unitCode: "U", label: "main d'œuvre investisseur" },   // unité U → ignoré
  { id: 524, type: 1, unitCode: "U", label: "Porte de douche" },             // produit mal classé → ignoré
  { id: "x", type: 2, unitCode: "H" },                                        // id invalide
];
const jh = jobsHorairesValides(JOBS);
assert.deepEqual([...jh.ids].sort((a, b) => a - b), [4, 5, 7, 20]);
assert.equal(jh.ignores.length, 3);
assert.ok(jh.ignores.some((x) => x.id === 31 && /U/.test(x.raison)));
assert.ok(jh.ignores.some((x) => x.id === 524 && /type/.test(x.raison)));

const ctx = { jobsHoraires: jh.ids, structureIds: new Set([416, 361, 352, 900]) };
const MO = (q, extra = {}) => ({ componentId: 20, componentType: 2, componentCode: "MO - INVESTISSEUR", label: "Main d'oeuvre", quantity: q, unitCode: "H", staffTime: 0, ...extra });
const MAT = (id, q, unit = "m²") => ({ componentId: id, componentType: 1, quantity: q, unitCode: unit });

// 10-11. Cadence extraite d'une composition (cas réels 416, 361, 352)
assert.deepEqual(extraireCadence([MAT(415, 1), MO(0.1)], ctx).cadence, 0.1, "416 : 0,10 H/m²");
assert.equal(extraireCadence([MO(0.16)], ctx).cadence, 0.16, "361 : 0,16 H/m²");
const s352 = extraireCadence([{ componentId: 353, componentType: 1, componentCode: "Carburant GNR", quantity: 10.024, unitCode: "L" }, MO(5)], ctx);
assert.equal(s352.ok, true); assert.equal(s352.cadence, 5, "352 : 5 H/m² (le carburant n'est pas compté)");
assert.equal(s352.composants.filter((c) => c.retenu).length, 1);

// 12. Plusieurs composants de main-d'œuvre → somme
const multi = extraireCadence([MO(1.5), { ...MO(0.75), componentId: 5, componentCode: "ELEC" }, MAT(1, 2)], ctx);
assert.equal(multi.ok, true); assert.equal(multi.cadence, 2.25); assert.equal(multi.nb_composants_mo, 2);

// 14. Absence de double comptage : un seul tableau (exploded) est sommé, jamais full + exploded
assert.equal(extraireCadence([MO(0.1)], ctx).cadence, 0.1);
assert.equal(extraireCadence([MO(0.1), MO(0.1)], ctx).cadence, 0.2, "deux lignes distinctes = deux temps distincts (pas de dédoublonnage arbitraire)");

// 13. Composition imbriquée : une sous-structure non développée rend la cadence ambiguë
const imbrique = extraireCadence([MO(1), { componentId: 900, componentType: 3, quantity: 1, unitCode: "U" }], ctx);
assert.equal(imbrique.ok, false); assert.equal(imbrique.statut, STATUTS.composition_ambigue);
const imbriqueParId = extraireCadence([MO(1), { componentId: 361, componentType: 1, quantity: 1, unitCode: "m²" }], ctx);
assert.equal(imbriqueParId.statut, STATUTS.composition_ambigue, "composant dont l'id est une structure connue → non développé");
assert.equal(extraireCadence([MO(1), { componentId: 77, componentType: 9, quantity: 1 }], ctx).statut, STATUTS.composition_ambigue, "type inconnu");

// 15. Cadence absente (aucun job horaire)
const absente = extraireCadence([MAT(415, 1)], ctx);
assert.equal(absente.statut, STATUTS.cadence_absente); assert.equal(absente.cadence, null);
assert.equal(extraireCadence([], ctx).statut, STATUTS.cadence_absente);

// 16. Cadence nulle
assert.equal(extraireCadence([MO(0)], ctx).statut, STATUTS.cadence_nulle);
// 17. Cadence négative
assert.equal(extraireCadence([MO(-2)], ctx).statut, STATUTS.cadence_negative);
// Une quantité nulle/négative à côté d'une positive : ambigu (jamais une somme partielle)
assert.equal(extraireCadence([MO(1), MO(-1)], ctx).statut, STATUTS.composition_ambigue);
assert.equal(extraireCadence([MO(1), MO("abc")], ctx).statut, STATUTS.composition_ambigue);

// 18. Unité non convertible : job horaire exprimé en jours / U
assert.equal(extraireCadence([MO(1, { unitCode: "J" })], ctx).statut, STATUTS.unite_non_convertible);
assert.equal(extraireCadence([MO(1, { unitCode: "U" })], ctx).statut, STATUTS.unite_non_convertible);
assert.equal(extraireCadence([MO(1, { unitCode: " h " })], ctx).cadence, 1, "« h » minuscule accepté comme H");

// 19. Cadence ambiguë : type 2 hors des jobs horaires (job 31 en U, id 524 produit, id inconnu)
assert.equal(extraireCadence([{ componentId: 31, componentType: 2, quantity: 1, unitCode: "H" }], ctx).statut, STATUTS.composition_ambigue);
assert.equal(extraireCadence([{ componentId: 524, componentType: 2, quantity: 1, unitCode: "H" }], ctx).statut, STATUTS.composition_ambigue);
assert.equal(extraireCadence([{ componentId: 999, componentType: 2, componentCode: "Main d'oeuvre", label: "MO", quantity: 3, unitCode: "H" }], ctx).statut, STATUTS.composition_ambigue, "le libellé « Main d'oeuvre » ne suffit jamais");
// job horaire porté par un composant d'un autre type → ambigu
assert.equal(extraireCadence([{ componentId: 20, componentType: 1, quantity: 1, unitCode: "H" }], ctx).statut, STATUTS.composition_ambigue);
// composant non-MO en heures : ignoré avec avertissement (pas une cadence)
const loc = extraireCadence([MO(2), { componentId: 800, componentType: 4, quantity: 3, unitCode: "H" }], ctx);
assert.equal(loc.cadence, 2); assert.equal(loc.avertissements.length, 1);
// Interdits : staffTime, prix — jamais lus
assert.equal(extraireCadence([MO(0.1, { staffTime: 99, purchaseNetUnitPrice: 1000, saleNetUnitPrice: 2000 })], ctx).cadence, 0.1);
// Réponse non tabulaire
assert.equal(extraireCadence({ message: "oops" }, ctx).statut, STATUTS.erreur_lecture);

// 20-22. Comparaison
assert.deepEqual(comparerCadences(1.5, 1.5), { identique: true, ecart: 0, ecart_pct: 0, important: false, nouvelle: false });
assert.equal(comparerCadences(0.1, 0.10001).identique, true, "tolérance 4 décimales");
const c = comparerCadences(1.5, 2.25);
assert.deepEqual(c, { identique: false, ecart: 0.75, ecart_pct: 50, important: false, nouvelle: false }, "+50 % exactement n'est pas > 50 %");
assert.equal(comparerCadences(1.5, 2.26).important, true, "> 50 %");
assert.equal(comparerCadences(1, 2).important, true, "× 2");
assert.equal(comparerCadences(2, 1).important, true, "÷ 2");
assert.equal(comparerCadences(1, 1.2).important, false);
assert.equal(comparerCadences(null, 0.5).nouvelle, true);
assert.equal(comparerCadences(0.5, null).ecart, null);

// Identifiants et unités
assert.equal(progbatIdValide("416"), 416); assert.equal(progbatIdValide(416), 416);
assert.equal(progbatIdValide("abc"), null); assert.equal(progbatIdValide("0"), null); assert.equal(progbatIdValide("-1"), null); assert.equal(progbatIdValide("4.5"), null);
assert.equal(cleUniteOuvrage("m²"), cleUniteOuvrage("m2")); assert.equal(cleUniteOuvrage(" U "), "u");

// ─── Plan complet (5-9, 20-22) ───────────────────────────────────────────────
const STRUCTURES = [
  { id: 416, unitCode: "m²", active: true }, { id: 361, unitCode: "m²", active: true }, { id: 352, unitCode: "m²", active: true },
  { id: 656, unitCode: "U", active: true }, { id: 300, unitCode: "U" }, { id: 700, unitCode: "U", active: false }, { id: 701, unitCode: "U" }, { id: 702, unitCode: "U" },
];
const OUVRAGES = [
  { id: "o1", libelle: "D-001 : Décollage tapisserie", unite: "m2", cadence: 0.2, progbat_id: "416" },        // 0.2 → 0.1 : ÷2 → écart important
  { id: "o2", libelle: "D-002 : Démolition cloisons", unite: "U", cadence: 0.5, progbat_id: "361" },         // unité U ≠ m² → unite_ouvrage_differente
  { id: "o3", libelle: "D-0062 : Percement", unite: "m2", cadence: 5, progbat_id: "352" },                   // identique
  { id: "o4", libelle: "D-008 : Carottage", unite: "U", cadence: 1.5, progbat_id: "656" },                   // 1.5 → 1.6 : à importer
  { id: "o5", libelle: "COUV-001 : Couverture", unite: "m2", cadence: null, progbat_id: null },              // non lié
  { id: "o6", libelle: "X-001 : Mauvais id", unite: "U", cadence: 1, progbat_id: "abc" },                    // invalide
  { id: "o7", libelle: "X-002 : Supprimé", unite: "U", cadence: 1, progbat_id: "9999" },                     // introuvable
  { id: "o8", libelle: "P-920 : Receveur", unite: "U", cadence: 6, progbat_id: "300" },                      // doublon
  { id: "o9", libelle: "P-920 : Receveur (copie)", unite: "U", cadence: null, progbat_id: "300" },           // doublon
  { id: "o10", libelle: "X-003 : Sans MO", unite: "U", cadence: 2, progbat_id: "700" },                      // cadence absente
  { id: "o11", libelle: "X-004 : Erreur", unite: "U", cadence: 2, progbat_id: "701" },                       // erreur lecture 500
  { id: "o12", libelle: "X-005 : Première cadence", unite: "U", cadence: null, progbat_id: "702" },          // null → 3 : à importer (nouvelle)
];
const COMPOSITIONS = new Map([
  [416, { ok: true, data: [MAT(415, 1), MO(0.1)] }],
  [361, { ok: true, data: [MO(0.16)] }],
  [352, { ok: true, data: [MAT(353, 10.024, "L"), MO(5)] }],
  [656, { ok: true, data: [MO(1.6)] }],
  [300, { ok: true, data: [MO(6)] }],
  [700, { ok: true, data: [MAT(1, 1)] }],
  [701, { ok: false, status: 500, message: "ProGBat indisponible (500)" }],
  [702, { ok: true, data: [MO(3)] }],
]);
const plan = construirePlanCadences({ ouvrages: OUVRAGES, structures: STRUCTURES, compositions: COMPOSITIONS, jobs: JOBS, preparedAt: "2026-09-16T14:30:00.000Z" });
const par = Object.fromEntries(plan.lignes.map((l) => [l.ouvrage_id, l]));
assert.equal(par.o1.statut, STATUTS.a_importer); assert.equal(par.o1.cadence_apres, 0.1); assert.equal(par.o1.ecart_important, true); assert.equal(par.o1.methode, METHODE_EXTRACTION);
assert.equal(par.o2.statut, STATUTS.unite_ouvrage_differente);
assert.equal(par.o3.statut, STATUTS.identique); assert.equal(par.o3.ecart, 0);
assert.equal(par.o4.statut, STATUTS.a_importer); assert.equal(par.o4.ecart, 0.1); assert.equal(par.o4.ecart_pct, 6.7); assert.equal(par.o4.ecart_important, false);
assert.equal(par.o5.statut, STATUTS.non_lie);
assert.equal(par.o6.statut, STATUTS.progbat_id_invalide);
assert.equal(par.o7.statut, STATUTS.structure_introuvable);
assert.equal(par.o8.statut, STATUTS.doublon_liaison); assert.equal(par.o9.statut, STATUTS.doublon_liaison);
assert.equal(par.o10.statut, STATUTS.cadence_absente);
assert.equal(par.o11.statut, STATUTS.erreur_lecture);
assert.equal(par.o12.statut, STATUTS.a_importer); assert.equal(par.o12.nouvelle_cadence, true); assert.equal(par.o12.ecart_important, false);
assert.ok(par.o1.avertissements.some((a) => /Écart important/.test(a)));
assert.deepEqual(plan.synthese, { analyses: 12, lies: 11, a_importer: 3, identiques: 1, non_exploitables: 7, non_lies: 1, ecarts_importants: 1, ecritures: 0 });
assert.equal(plan.lignes[0].code, "COUV-001", "tri par code métier");
assert.deepEqual(plan.garanties, { ecriture_pendant_analyse: false, ecriture_progbat: false, chiffrages_modifies: false });
assert.ok(STATUTS_ANOMALIES.every((s) => STATUTS_LABELS[s]));

// Hash : ne dépend que des lignes à importer (ouvrage, progbat_id, avant, après)
const h = donneesPourHashCadences(plan);
assert.deepEqual(h.items.map((i) => i.ouvrage_id), ["o1", "o12", "o4"]);
const hash1 = await hacherPlanCadences(plan);
assert.match(hash1, /^[0-9a-f]{64}$/);
const plan2 = construirePlanCadences({ ouvrages: OUVRAGES, structures: STRUCTURES, compositions: COMPOSITIONS, jobs: JOBS, preparedAt: "2026-09-16T15:00:00.000Z" });
assert.equal(await hacherPlanCadences(plan2), hash1, "même contenu ⇒ même hash (la date n'entre pas)");
const planModif = construirePlanCadences({ ouvrages: OUVRAGES.map((o) => o.id === "o4" ? { ...o, cadence: 1.7 } : o), structures: STRUCTURES, compositions: COMPOSITIONS, jobs: JOBS });
assert.notEqual(await hacherPlanCadences(planModif), hash1, "cadence Profero modifiée ⇒ hash différent");
const planLiaison = construirePlanCadences({ ouvrages: OUVRAGES.map((o) => o.id === "o4" ? { ...o, progbat_id: "702" } : o), structures: STRUCTURES, compositions: COMPOSITIONS, jobs: JOBS });
assert.notEqual(await hacherPlanCadences(planLiaison), hash1, "liaison modifiée ⇒ hash différent");
const items = itemsPourPlan(plan);
assert.equal(items.length, 12); assert.ok(items.every((i) => !("composants" in i)));
assert.equal(items.filter((i) => i.statut === "a_importer").length, 3);

// Confirmation
const txt = texteConfirmation(plan.synthese);
assert.ok(txt.includes("3 ouvrage(s) seront mis à jour.") && txt.includes("1 ouvrage(s) possèdent déjà la même cadence.") && txt.includes("8 ouvrage(s) ne seront pas modifiés"));
assert.ok(txt.includes("Aucune donnée ne sera modifiée dans ProGBat."));
assert.equal(formatCadence(2.5, "U"), "2,50 H/U"); assert.equal(formatCadence(null), "—");

// 1-3. Appelant
assert.equal(controlerAppelant(null).http, 401);
assert.equal(controlerAppelant({ email: "" }).http, 401);
assert.equal(controlerAppelant({ email: "a@b.fr", role: "ouvrier", actif: true }).http, 403);
assert.equal(controlerAppelant({ email: "a@b.fr", role: "commercial", actif: true }).http, 403);
assert.equal(controlerAppelant({ email: "a@b.fr", role: "admin", actif: false }).http, 403);
assert.equal(controlerAppelant({ email: "a@b.fr", role: "admin", actif: true }), null);
assert.deepEqual([...ROLES_AUTORISES], ["admin", "conducteur"]);

// ─── 40-41. Effets sur les calculs Profero après import ──────────────────────
const taux = [{ id: "t1", libelle: "Standard", taux_ht: 50, actif: true, est_defaut: true }];
const coefs = [{ id: "c1", libelle: "Standard", valeur: 1.5, actif: true, est_defaut: true }];
const mats = [{ id: "m1", nom: "Plâtre", unite: "m2", prix_unitaire: 10 }];
const avant = { id: "o1", libelle: "D-001 : Test", unite: "m2", cadence: 1.5, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_horaire_vente_id: "t1", coefficient_vente_id: "c1" };
const apres = { ...avant, cadence: 2.25, cadence_source: "progbat_import" };
const cAvant = calculerOuvrage(avant, { materiaux: mats, tauxHoraires: taux, coefficientsVente: coefs, coutHoraire: 30 });
const cApres = calculerOuvrage(apres, { materiaux: mats, tauxHoraires: taux, coefficientsVente: coefs, coutHoraire: 30 });
assert.equal(cAvant.prixMainOeuvreUnitaire, 75); assert.equal(cApres.prixMainOeuvreUnitaire, 112.5, "nouvelle ligne : prix MO = nouvelle cadence × taux");
assert.equal(cApres.prixVenteUnitaire, cAvant.prixVenteUnitaire + 37.5, "prix de vente calculé suit la nouvelle cadence");
assert.equal(cApres.mainOeuvre.montant, 67.5, "coût MO (marge) suit la nouvelle cadence");
// 39. Ligne figée AVANT l'import : snapshot inchangé tant qu'on n'actualise pas
const ligneFigee = { id: "l1", ...creerSnapshotOuvrage(avant, cAvant, { quantite: "2", tvaPct: 10, date: new Date("2026-09-01T00:00:00Z") }) };
assert.equal(ligneFigee.cout_main_oeuvre_unitaire, 45); assert.equal(ligneFigee.calcul_detail.heures_unitaires, 1.5);
const diffs = differencesSnapshot(ligneFigee, apres, cApres);
assert.ok(diffs.some((d) => d.champ === "cout_main_oeuvre_unitaire" && d.avant === 45 && d.apres === 67.5), "l'actualisation volontaire montre l'ancienne et la nouvelle valeur");
assert.ok(diffs.some((d) => d.champ === "prix_unitaire"));
// 41. Actualisation volontaire : la ligne reprend la nouvelle cadence
const patch = appliquerActualisation(ligneFigee, apres, cApres);
assert.equal(patch.calcul_detail.heures_unitaires, 2.25); assert.equal(patch.cout_main_oeuvre_unitaire, 67.5);
assert.ok(!("quantite" in patch) && !("zone" in patch) && !("tva_pct" in patch), "quantité, zone, TVA conservées");

console.log("verif-progbat-cadences : OK (jobs horaires, extraction réelle 416/361/352, multi-MO, imbriqué, absente/nulle/négative, unités, ambiguïtés, écarts, plan, hash, appelant, effets calculs, snapshot protégé, actualisation)");
