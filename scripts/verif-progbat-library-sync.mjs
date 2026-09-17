#!/usr/bin/env node
import assert from "node:assert/strict";
import { construirePlanSynchronisation, construirePayloadStructure, trouverFamilleCible, trouverTva, donneesPourHash, restreindrePlan, etatOuvragePourSync, listerFamillesOuvrages, resoudreFamilleParId, listerJobsHoraires, resoudreJobHoraire, construireCompositionCadence, compositionVide, blocageComposition } from "../src/Renovation/progbatLibrarySync.mjs";

const structures = [
  { id: 501, code: "D-001", label: "D-001 : Dépose" },
];
const familles = [{ id: 10, label: "Électricité", structureFamily: true }, { id: 11, label: "Démolition", structureFamily: true }, { id: 12, label: "Matériaux", structureFamily: false }];
const unites = [{ id: 1, code: "m²" }, { id: 2, code: "U" }];
const taxes = [{ id: 5, rate: 10, label: "10 %" }];
const jobs = [
  { id: 70, label: "Main-d'œuvre", type: 2, unitCode: "H", active: true },
  { id: 71, label: "Forfait pose", type: 2, unitCode: "U" },     // pas horaire
  { id: 72, label: "Placo", type: 1, unitCode: "H" },            // pas un job de MO
  { id: 73, label: "Ancienne MO", type: 2, unitCode: "H", active: false },
];
const base = {
  profero: { id: "p1", code: "D-001", libelle_court: "Dépose", unite: "m2" },
  prix: { cout_total_ht: 100, prix_vente_ht: 150, heures_main_oeuvre: 2.5 }, synchronisable: true, blocages: [],
};

// ─── Famille de destination : une famille EXISTANTE, désignée par son id ────
assert.deepEqual(listerFamillesOuvrages(familles), [
  { id: 11, label: "Démolition" }, { id: 10, label: "Électricité" },
], "seules les familles d'ouvrages sont proposées, triées par nom");

const choisie = resoudreFamilleParId(familles, 10);
assert.equal(choisie.ok, true);
assert.equal(choisie.id, 10);
assert.equal(choisie.libelle, "Électricité", "le nom est relu depuis ProGBat, jamais réinventé");
assert.equal(choisie.erreur, null);

// Aucun choix : la création est refusée, mais on sait quoi proposer.
const sansChoix = resoudreFamilleParId(familles, null);
assert.equal(sansChoix.ok, false);
assert.match(sansChoix.erreur, /Choisir la famille/);
assert.equal(sansChoix.disponibles.length, 2);

// Famille disparue entre l'aperçu et la confirmation.
assert.match(resoudreFamilleParId(familles, 999).erreur, /introuvable/);
// Famille qui n'accepte pas les ouvrages : refusée, jamais « activée » ici.
assert.match(resoudreFamilleParId(familles, 12).erreur, /n'est pas une famille d'ouvrages/);

// Le repli par NOM reste testé (aucun écran ne l'utilise aujourd'hui).
assert.equal(trouverFamilleCible(familles, "Électricité").id, 10);
assert.match(trouverFamilleCible(familles, "Plâtrerie").erreur, /introuvable/);
assert.match(trouverFamilleCible(familles, "Matériaux").erreur, /n'est pas une famille d'ouvrages/);
assert.match(trouverFamilleCible([{ id: 1, label: "Sol" }, { id: 2, label: "sol" }], "Sol").erreur, /Plusieurs/);

// La cause exacte remonte jusqu'aux exclusions du plan, pas un message générique.
assert.deepEqual(
  construirePayloadStructure(base, { familleId: null, unites, taxe: taxes[0], familleErreur: sansChoix.erreur }).erreurs,
  [sansChoix.erreur],
);
assert.equal(trouverTva(taxes, 10).id, 5);
assert.equal(trouverTva([{ id: 6, rate: .1 }], 10).id, 6);

const payload = construirePayloadStructure(base, { familleId: 10, unites, taxe: taxes[0] });
assert.equal(payload.ok, true);
assert.deepEqual(payload.payload, {
  code: "D-001", label: "D-001 : Dépose", unitCode: "m²", families: [10],
  purchaseNetUnitPrice: 100, edge: 50, saleNetUnitPrice: 150, taxRate: 10,
  active: true, fixedPrice: true, technicalCom: "D-001 : Dépose",
});
assert.equal(construirePayloadStructure(base, { familleId: null, unites, taxe: taxes[0] }).ok, false);
assert.equal(construirePayloadStructure(base, { familleId: 10, unites: [], taxe: taxes[0] }).ok, false);

const inventaire = { rapprochements: [
  { ...base, statut: "correspondance_code_a_confirmer", correspondance: { id: 501, label: "Dépose existante" } },
  { ...base, profero: { ...base.profero, id: "p2", code: "E-001", libelle_court: "Prise" }, statut: "nouveau_a_creer" },
  { ...base, profero: { ...base.profero, id: "p3", code: "E-002" }, statut: "ambigu", synchronisable: true },
  { ...base, profero: { ...base.profero, id: "p4", code: "E-003" }, statut: "nouveau_a_creer", synchronisable: false, blocages: ["Prix absent"] },
  { ...base, profero: { ...base.profero, id: "p5", code: "E-004", progbat_id: "777" }, statut: "deja_lie" },
] };
const plan = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: 10, familleId: 10, jobs, jobId: 70 });
assert.deepEqual(plan.compteurs, { a_lier: 1, a_creer: 1, a_composer: 0, exclus: 2, total: 2 });
assert.equal(plan.actions[0].type, "link");
assert.equal(plan.actions[1].type, "create");
assert.deepEqual(plan.actions[1].payload.families, [10]);
assert.deepEqual(plan.garanties, {
  modifie_existants_progbat: false, supprime_progbat: false, cree_elements: false,
  ecrase_composition: false, recalcule_prix_progbat: false,
});
assert.equal(donneesPourHash(plan).actions.length, 2);

// Aucune famille choisie : les LIAISONS (qui ne créent rien) passent quand
// même, seules les CRÉATIONS sont écartées.
const sansFamille = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: 10, jobs, jobId: 70 });
assert.equal(sansFamille.compteurs.a_lier, 1, "les liaisons restent possibles sans famille choisie");
assert.equal(sansFamille.compteurs.a_creer, 0, "aucune création sans famille choisie");
assert.ok(sansFamille.exclus.some((x) => x.raisons.includes(sansFamille.famille.erreur)), "l'exclusion porte la cause exacte");
assert.match(sansFamille.famille.erreur, /Choisir la famille/);
assert.equal(sansFamille.famille.disponibles.length, 2, "l'écran reçoit les familles proposables");

// La famille choisie est celle qui part dans le payload.
assert.deepEqual(
  construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: 10, familleId: 11, jobs, jobId: 70 })
    .actions.find((a) => a.type === "create").payload.families,
  [11],
);

const sansTva = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: null, familleId: 10, jobs, jobId: 70 });
assert.equal(sansTva.compteurs.a_lier, 1);
assert.equal(sansTva.compteurs.a_creer, 0);

// ─── Main-d'œuvre : la cadence Profero part avec l'ouvrage ──────────────────
assert.deepEqual(listerJobsHoraires(jobs), [{ id: 70, label: "Main-d'œuvre", code: "" }],
  "seuls les jobs horaires actifs (type 2, unité H) sont proposés");

const jobOk = resoudreJobHoraire(jobs, 70);
assert.equal(jobOk.ok, true);
assert.equal(jobOk.libelle, "Main-d'œuvre");
assert.match(resoudreJobHoraire(jobs, null).erreur, /Choisir la main-d'œuvre/);
assert.match(resoudreJobHoraire(jobs, 999).erreur, /introuvable/);
assert.match(resoudreJobHoraire(jobs, 71).erreur, /n'est pas une main-d'œuvre horaire/);

const compo = construireCompositionCadence({ cadence: 2.5, job: jobOk });
assert.equal(compo.ok, true);
assert.deepEqual(compo.payload, {
  components: [{ componentId: 70, quantity: 2.5 }],
  updatePrice: false,
}, "updatePrice reste faux : ProGBat ne recalcule jamais le prix Profero");
assert.equal(compo.heures, 2.5);
assert.match(construireCompositionCadence({ cadence: 0, job: jobOk }).erreurs[0], /Cadence/);
assert.match(construireCompositionCadence({ cadence: null, job: jobOk }).erreurs[0], /Cadence/);
assert.equal(construireCompositionCadence({ cadence: 2, job: resoudreJobHoraire(jobs, null) }).ok, false);

assert.equal(compositionVide([]), true);
assert.equal(compositionVide([{ componentId: 1 }]), false);
assert.equal(compositionVide(null), false, "composition non lue : jamais considérée comme vide");
assert.equal(compositionVide(undefined), false);

// Sans main-d'œuvre choisie, la création est REFUSÉE : ProGBat inventerait
// sinon un temps depuis le prix (cause du décalage constaté sur le 1er devis).
const sansJob = construirePlanSynchronisation({ inventaire, familles, unites, taxes, tvaDefaut: 10, familleId: 10 });
assert.equal(sansJob.compteurs.a_creer, 0);
assert.ok(sansJob.exclus.some((x) => x.raisons.some((r) => /main-d'œuvre/i.test(r))));

// Ouvrage déjà lié : la cadence n'est proposée QUE si la composition est vide.
const contexte = { inventaire, familles, unites, taxes, tvaDefaut: 10, familleId: 10, jobs, jobId: 70 };
const avecVide = construirePlanSynchronisation({ ...contexte, compositions: new Map([["p5", { ok: true, items: [] }]]) });
const poseCadence = avecVide.actions.find((a) => a.type === "composition");
assert.ok(poseCadence, "composition vide → la cadence peut être posée");
assert.equal(poseCadence.ouvrageId, "p5");
assert.equal(poseCadence.progbatId, 777);
assert.deepEqual(poseCadence.composition.payload.components, [{ componentId: 70, quantity: 2.5 }]);
assert.equal(avecVide.compteurs.a_composer, 1);

const avecCompo = construirePlanSynchronisation({ ...contexte, compositions: new Map([["p5", { ok: true, items: [{ componentId: 9, quantity: 1 }] }]]) });
assert.equal(avecCompo.compteurs.a_composer, 0, "une composition existante n'est JAMAIS remplacée");
assert.equal(avecCompo.actions.some((a) => a.ouvrageId === "p5"), false);

const nonLue = construirePlanSynchronisation({ ...contexte, compositions: new Map() });
assert.equal(nonLue.compteurs.a_composer, 0, "composition non lue : rien n'est proposé");
assert.equal(nonLue.exclus.some((x) => x.ouvrageId === "p5"), false, "hors périmètre, l'ouvrage n'est même pas mentionné");

// L'empreinte couvre la cadence : confirmer une création, c'est confirmer son temps.
const h = donneesPourHash(construirePlanSynchronisation(contexte));
const hAutreJob = donneesPourHash(construirePlanSynchronisation({ ...contexte, jobId: 70, jobs: [{ id: 70, label: "MO", type: 2, unitCode: "H" }] }));
assert.deepEqual(h.actions.find((a) => a.type === "create").composition, { components: [{ componentId: 70, quantity: 2.5 }], updatePrice: false });
assert.equal(hAutreJob.actions.length, h.actions.length);
assert.deepEqual(construirePlanSynchronisation(contexte).garanties, {
  modifie_existants_progbat: false, supprime_progbat: false, cree_elements: false,
  ecrase_composition: false, recalcule_prix_progbat: false,
});

// Une lecture RATÉE de composition n'est jamais présentée comme « non vide » :
// c'était le défaut constaté sur l'ouvrage ProGBat #891.
assert.equal(blocageComposition({ ok: true, items: [] }), null);
assert.match(blocageComposition(null), /non lue/);
assert.match(blocageComposition({ ok: false, status: 403, message: "ProGBat a répondu HTTP 403." }), /illisible/);
assert.match(blocageComposition({ ok: false, status: 403, message: "ProGBat a répondu HTTP 403." }), /403/);
assert.match(blocageComposition({ ok: true, items: null }), /inattendue/);
assert.match(blocageComposition({ ok: true, items: [{ componentId: 1 }] }), /n'est pas vide \(1 composant/);

const lectureRatee = construirePlanSynchronisation({ ...contexte, compositions: new Map([["p5", { ok: false, status: 403, message: "ProGBat a répondu HTTP 403." }]]) });
assert.equal(lectureRatee.compteurs.a_composer, 0);
assert.ok(lectureRatee.exclus.some((x) => x.ouvrageId === "p5" && x.raisons.some((r) => /illisible/.test(r))),
  "la vraie cause remonte à l'écran, avec son code HTTP");

// ─── Périmètre restreint (envoi d'un ouvrage depuis sa fiche) ───────────────
assert.equal(restreindrePlan(plan, []), plan, "sans périmètre, le plan est rendu tel quel");
assert.equal(restreindrePlan(plan, null), plan);

const unSeul = restreindrePlan(plan, ["p2"]);
assert.deepEqual(unSeul.compteurs, { a_lier: 0, a_creer: 1, a_composer: 0, exclus: 0, total: 1 });
assert.equal(unSeul.actions[0].ouvrageId, "p2");
assert.deepEqual(unSeul.hors_plan, [], "p2 est bien dans le plan");
assert.deepEqual(unSeul.perimetre, { ouvrageIds: ["p2"] });
assert.deepEqual(unSeul.garanties, plan.garanties, "les garanties suivent le plan restreint");

const bloque = restreindrePlan(plan, ["p4"]);
assert.deepEqual(bloque.compteurs, { a_lier: 0, a_creer: 0, a_composer: 0, exclus: 1, total: 0 });
assert.deepEqual(bloque.exclus[0].raisons, ["Prix absent"]);

const dejaLie = restreindrePlan(plan, ["p5"]);
assert.equal(dejaLie.compteurs.total, 0, "un ouvrage déjà lié n'a aucune action");
assert.deepEqual(dejaLie.hors_plan, ["p5"], "ni action ni exclusion : signalé hors plan");

const inconnu = restreindrePlan(plan, ["zz"]);
assert.deepEqual(inconnu.hors_plan, ["zz"]);
assert.equal(inconnu.compteurs.total, 0);

// L'empreinte dépend du périmètre : un aperçu d'un ouvrage ne peut pas
// confirmer une synchronisation globale, même à actions identiques.
assert.notDeepEqual(donneesPourHash(unSeul), donneesPourHash(plan));
assert.deepEqual(donneesPourHash(restreindrePlan(plan, ["p2", "p1"])).perimetre, ["p1", "p2"], "périmètre trié, ordre d'appel sans effet");
assert.equal(donneesPourHash(plan).perimetre, null);

const etat = etatOuvragePourSync(inventaire, "p4");
assert.equal(etat.statut, "nouveau_a_creer");
assert.equal(etat.synchronisable, false);
assert.deepEqual(etat.blocages, ["Prix absent"]);
assert.equal(etatOuvragePourSync(inventaire, "p1").progbatId, 501, "code identique : l'id candidat est rendu");
assert.equal(etatOuvragePourSync(inventaire, "zz"), null);

console.log("verif-progbat-library-sync : OK (liaison, création, famille existante choisie, unité, TVA, exclusions, garanties, périmètre par ouvrage, diagnostic de famille, cadence envoyée)");
