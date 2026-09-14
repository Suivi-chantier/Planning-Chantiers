#!/usr/bin/env node
// Vérifie le module de rapprochement ProGBat (src/Renovation/progbatInventaire.mjs)
// et la fraîcheur des copies embarquées dans l'Edge Function.
//   node scripts/verif-progbat-inventaire.mjs
import assert from "node:assert/strict";

const inv = await import(new URL("../src/Renovation/progbatInventaire.mjs", import.meta.url).href);
const sync = await import(new URL("./sync-progbat-edge-lib.mjs", import.meta.url).href);

// ── Normalisations ──────────────────────────────────────────────────────────
assert.equal(inv.normaliserCode(" d-001 "), "D-001");
assert.equal(inv.normaliserCode("D 001"), "D001", "les espaces sont retirés, pas remplacés");
assert.equal(inv.normaliserCode("e-002.3"), "E-002.3");
assert.equal(inv.normaliserCode("D_001"), "D001", "seuls lettres, chiffres, tirets et points sont conservés");
assert.notEqual(inv.normaliserCode("D-001"), inv.normaliserCode("D001"), "la structure du code n'est pas réécrite");
assert.equal(inv.normaliserLibelle("  Démolition   de cloisons. "), "demolition de cloisons");
assert.equal(inv.normaliserLibelle("DÉPOSE : "), "depose");

// ── Jeu de données ──────────────────────────────────────────────────────────
const MATERIAUX = [
  { id: "m1", nom: "Plaque BA13", unite: "U", prix_unitaire: 6.5 },
  { id: "m2", nom: "Sans prix", unite: "U", prix_unitaire: null },
];
const base = (extra) => ({
  unite: "m2", cadence: 1, coef_vente: 1.5, main_oeuvre_seule: false,
  materiaux_liens: [{ materiau_id: "m1", quantite: 2 }], progbat_id: null, ...extra,
});
const OUVRAGES = [
  base({ id: "p1", libelle: "D-001 : Dépose de tapisserie", progbat_id: "501" }),          // 1. déjà lié
  base({ id: "p2", libelle: "D-002 : Démolition de cloisons" }),                             // 2. code unique
  base({ id: "p3", libelle: "D-003 : Carottage de dalle" }),                                 // 3. ambigu (2 structures D-003)
  base({ id: "p4", libelle: "P-010 : Peinture plafond deux couches" }),                       // 4. libellé identique, code différent
  base({ id: "p5", libelle: "E-001 : Prise de courant" }),                                    // 5. nouveau, complet
  base({ id: "p6", libelle: "E-002 : Interrupteur", cadence: null, coef_vente: null, unite: "" }), // 5. nouveau, bloqué
  base({ id: "p7", libelle: "Pose de plinthes", progbat_id: "999" }),                         // sans code, progbat_id perdu
  base({ id: "p8", libelle: "M-001 : Main-d'œuvre seule", materiaux_liens: [], main_oeuvre_seule: true }),
  base({ id: "p9", libelle: "M-002 : Matériau sans prix", materiaux_liens: [{ materiau_id: "m2", quantite: 1 }] }),
];
const STRUCTURES = [
  { id: 501, code: "X-999", label: "Ancien libellé", unitCode: "m2", saleNetUnitPrice: 10, active: true },
  { id: 502, code: "d-002", label: "Démolition cloisons", unitCode: "m2", saleNetUnitPrice: 20 },
  { id: 503, code: "D-003", label: "Carottage A", unitCode: "U" },
  { id: 504, code: "D-003", label: "Carottage B", unitCode: "U" },
  { id: 505, code: "PEI-4", label: "Peinture plafond deux couches", unitCode: "m2" },
  { id: 506, code: "Z-001", label: "Structure ProGBat orpheline", unitCode: "U" },
];
const TAXES = [{ id: 1, rate: 20, label: "20 %", saleDefault: true }, { id: 2, rate: 10, label: "10 %" }];
const UNITES = [{ id: 1, code: "m2" }, { id: 2, code: "U" }, { id: 3, code: "ml" }];

const res = inv.rapprocherBibliotheque({ ouvrages: OUVRAGES, structures: STRUCTURES, materiaux: MATERIAUX, coutHoraire: 40, tvaDefaut: 20, taxes: TAXES, unites: UNITES });
const par = Object.fromEntries(res.rapprochements.map((r) => [r.profero.id, r]));

// ── Statuts, dans l'ordre des règles ────────────────────────────────────────
assert.equal(par.p1.statut, "deja_lie");
assert.equal(par.p1.correspondance.id, 501, "le progbat_id prime sur le code");
assert.equal(par.p2.statut, "correspondance_code_a_confirmer");
assert.equal(par.p2.correspondance.id, 502, "code comparé après normalisation (d-002 = D-002)");
assert.equal(par.p3.statut, "ambigu");
assert.deepEqual(par.p3.candidats.map((c) => c.id).sort(), [503, 504], "tous les candidats sont renvoyés");
assert.equal(par.p4.statut, "correspondance_libelle_a_examiner");
assert.equal(par.p4.correspondance, null, "un libellé identique n'est jamais une correspondance certaine");
assert.equal(par.p4.candidats[0].id, 505);
assert.equal(par.p5.statut, "nouveau_a_creer");
assert.equal(par.p5.synchronisable, true);
assert.equal(par.p5.pret_a_creer, true);
assert.equal(par.p6.statut, "nouveau_a_creer");
assert.equal(par.p6.synchronisable, false);
assert.equal(par.p6.pret_a_creer, false, "un ouvrage incomplet n'est jamais prêt à créer");
assert.ok(par.p6.blocages.some((b) => /Cadence/.test(b)));
assert.ok(par.p6.blocages.some((b) => /Coefficient/.test(b)));
assert.ok(par.p6.blocages.some((b) => /Unité absente/.test(b)));
assert.equal(par.p7.statut, "nouveau_a_creer");
assert.ok(par.p7.blocages.some((b) => /Code d'ouvrage absent/.test(b)));
assert.ok(par.p7.notes.some((n) => /introuvable/.test(n)), "progbat_id perdu signalé sans bloquer les autres règles");
assert.equal(par.p8.synchronisable, true, "main-d'œuvre seule sans matériau est complet");
assert.equal(par.p9.synchronisable, false);
assert.ok(par.p9.blocages.some((b) => /sans prix/.test(b)));

// ── Prix repris de la source unique (coût 2×6,5 + 1×40 = 53 ; ×1,5 = 79,5) ─
assert.equal(par.p5.prix.cout_total_ht, 53);
assert.equal(par.p5.prix.prix_vente_ht, 79.5);
assert.equal(par.p5.prix.taux_marge_pct, 33.33);

// ── ProGBat non liés & compteurs ───────────────────────────────────────────
assert.deepEqual(res.progbat_non_lies.map((s) => s.id), [506], "seule la structure orpheline est signalée");
assert.equal(res.progbat_non_lies[0].statut, "progbat_non_lie");
assert.equal(res.compteurs.deja_lie, 1);
assert.equal(res.compteurs.correspondance_code_a_confirmer, 1);
assert.equal(res.compteurs.ambigu, 1);
assert.equal(res.compteurs.correspondance_libelle_a_examiner, 1);
assert.equal(res.compteurs.nouveau_a_creer, 5);
assert.equal(res.compteurs.progbat_non_lie, 1);
assert.equal(res.nb_ouvrages_profero, 9);
assert.equal(res.nb_structures_progbat, 6);
assert.equal(res.ambiguites.length, 1);
assert.equal(res.bloques.length, 3);
assert.equal(res.nb_synchronisables, 6);

// ── TVA et unité : règles de complétude ────────────────────────────────────
const sansTva = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tvaDefaut: null });
assert.ok(sansTva.blocages.some((b) => /TVA/.test(b)), "sans TVA par défaut ⇒ bloqué");
const tvaInconnue = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tvaDefaut: 5.5, tauxTvaProgbat: TAXES });
assert.ok(tvaInconnue.synchronisable && tvaInconnue.avertissements.some((a) => /TVA 5.5/.test(a)), "TVA absente de ProGBat = avertissement, pas blocage");
const tvaFraction = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tvaDefaut: 20, tauxTvaProgbat: [{ rate: 0.2 }] });
assert.equal(tvaFraction.avertissements.length, 0, "taux exprimé en fraction (0,2) reconnu");
const uniteInconnue = inv.verifierCompletude(base({ id: "x", libelle: "T-001 : Test", unite: "forfait" }), { materiaux: MATERIAUX, coutHoraire: 40, tvaDefaut: 20, unitesProgbat: UNITES });
assert.ok(uniteInconnue.avertissements.some((a) => /Unité « forfait » inconnue/.test(a)));
const sansCoutH = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: null, tvaDefaut: 20 });
assert.ok(sansCoutH.blocages.some((b) => /Coût horaire/.test(b)));

// ── Motifs de blocage agrégés ──────────────────────────────────────────────
const motifs = inv.motifsBlocage(res.rapprochements);
assert.ok(motifs.length >= 3 && motifs[0].nb >= motifs[motifs.length - 1].nb);

// ── Copies embarquées dans l'Edge Function ─────────────────────────────────
const divergents = sync.verifierCopies();
assert.deepEqual(divergents, [], "copies lib/ de l'Edge Function à régénérer : node scripts/sync-progbat-edge-lib.mjs");

console.log("verif-progbat-inventaire : OK (6 statuts, complétude, TVA/unités, copies Edge à jour)");
