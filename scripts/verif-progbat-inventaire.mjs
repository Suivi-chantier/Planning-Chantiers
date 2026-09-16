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

// ── Nettoyage HTML des descriptifs ProGBat ──────────────────────────────────
assert.equal(inv.nettoyerHtml("E-008&nbsp;: <div>Fourniture et pose</div>"), "E-008 : Fourniture et pose");
assert.equal(inv.nettoyerHtml("<p>Ligne 1</p><p>Ligne&nbsp;2</p>"), "Ligne 1 Ligne 2");
assert.equal(inv.nettoyerHtml("A &amp; B &lt;C&gt; &quot;D&quot; &#233;t&eacute; &#x20AC;"), "A & B <C> \"D\" été €");
assert.equal(inv.nettoyerHtml("  plusieurs \n\t espaces  "), "plusieurs espaces");
assert.equal(inv.nettoyerHtml(null), "");
assert.equal(inv.nettoyerHtml("<br/>E-021 :<br>Tableau"), "E-021 : Tableau");
assert.equal(inv.texteDescriptif({ description: "<p>x</p>", longDescription: "y" }), "<p>x</p>", "champ descriptif le plus court d'abord");
assert.equal(inv.texteDescriptif({ descriptif: "z" }), "z");
assert.equal(inv.texteDescriptif({ label: "pas de descriptif" }), "");

// ── Détection du code MÉTIER : descriptif → libellé → champ API (si vrai code) ─
const det = inv.detecterCodeProgbat;
const TECH = "DISJONCTEURBRANCHEMENT-1PN-60AFIXE-500MA-DIFFINST";
const disj = det({ id: 9001, code: TECH, label: "Disjoncteur de branchement 1P+N 60A", description: "E-008&nbsp;: <div>Fourniture et pose d'un disjoncteur de branchement</div>" });
assert.equal(disj.code, "E-008", "cas signalé : code métier lu en tête du descriptif");
assert.equal(disj.source, "descriptif");
assert.equal(disj.code_api, TECH, "le champ technique est conservé séparément");
assert.equal(disj.descriptif, "E-008 : Fourniture et pose d'un disjoncteur de branchement", "descriptif nettoyé (entités, balises)");
assert.equal(disj.label, "Disjoncteur de branchement 1P+N 60A");
assert.ok(!/[<>]|&nbsp;/.test(disj.descriptif + disj.label), "aucun HTML ne sort du module");

for (const c of ["E-008", "E-021", "EG-001", "EG-002", "E-0010", "E-004.2"]) {
  const r = det({ id: 1, code: "TECHNIQUE-GENERE-DEPUIS-LE-LIBELLE-123", label: "Libellé humain", description: `${c}&nbsp;: <div>Descriptif ${c}</div>` });
  assert.equal(r.code, c, `code métier ${c} reconnu dans le descriptif`);
  assert.equal(r.source, "descriptif");
  const r2 = det({ id: 2, code: "", label: `<div>${c} : Libellé</div>` });
  assert.equal(r2.code, c, `code métier ${c} reconnu dans un libellé HTML`);
  assert.equal(r2.source, "libelle");
}

// Le champ technique concaténé n'est JAMAIS un code métier
assert.deepEqual(det({ id: 3, code: TECH, label: "Disjoncteur de branchement" }).code, null);
assert.equal(det({ id: 3, code: TECH, label: "Disjoncteur de branchement" }).source, null);
assert.equal(det({ id: 4, code: "TECHNIQUE-XYZ-123", label: "Libellé", description: "Sans code" }).code, null);
// Champ API accepté seulement s'il est à lui seul un code au format central, et après descriptif/libellé
assert.deepEqual([det({ id: 5, code: "D 001", label: "Décollage" }).code, det({ id: 5, code: "D 001", label: "Décollage" }).source], ["D-001", "champ"]);
assert.deepEqual([det({ id: 6, code: "d-002", label: "Démolition cloisons" }).code, det({ id: 6, code: "d-002", label: "Démolition cloisons" }).source], ["D-002", "champ"]);
assert.equal(det({ id: 7, code: "d 001", label: "Décollage" }).code, null, "« d 001 » n'est pas un code (règle du parseur central)");
assert.equal(det({ id: 8, code: "STR12", label: "D-002 : Démolition" }).code, "D-002", "le libellé prime sur le champ API");
assert.equal(det({ id: 8, code: "STR12", label: "D-002 : Démolition" }).source, "libelle");
assert.equal(det({ id: 9, code: "E-009", label: "Libellé", description: "E-008 : Descriptif" }).code, "E-008", "le descriptif prime sur le champ API");
// Repli : segment délimité, et faux positifs refusés
assert.equal(det({ id: 10, code: "", label: "Reprise de couverture [COUV-001]" }).code, "COUV-001");
assert.equal(det({ id: 11, code: "", label: "Peinture - P-021.2 - deux couches" }).code, "P-021.2");
assert.equal(det({ id: 12, code: "", label: "Pose 3 prises" }).code, null, "« Pose 3 » n'est pas un code");
assert.equal(det({ id: 13, code: "", label: "Bac 3" }).code, null);

// ── Jeu de données de rapprochement ─────────────────────────────────────────
const MATERIAUX = [
  { id: "m1", nom: "Plaque BA13", unite: "U", prix_unitaire: 6.5 },
  { id: "m2", nom: "Sans prix", unite: "U", prix_unitaire: null },
];
// Taux horaires de VENTE (taux_horaires_vente) : le prix MO = cadence × taux de l'ouvrage
const TAUX_H = [
  { id: "t1", libelle: "Taux standard", taux_ht: 80, est_defaut: true, actif: true },
  { id: "t2", libelle: "Chef d'équipe", taux_ht: 95, est_defaut: false, actif: true },
];
const base = (extra) => ({
  unite: "m2", cadence: 1, coef_vente: 1.5, main_oeuvre_seule: false, taux_horaire_vente_id: "t1",
  materiaux_liens: [{ materiau_id: "m1", quantite: 2 }], progbat_id: null, ...extra,
});
const OUVRAGES = [
  base({ id: "p1", libelle: "D-001 : Dépose de tapisserie", progbat_id: "501" }),          // 1. déjà lié
  base({ id: "p2", libelle: "D-002 : Démolition de cloisons" }),                             // 2. code unique (champ API valide)
  base({ id: "p3", libelle: "D-003 : Carottage de dalle" }),                                 // 3. ambigu (champ + descriptif)
  base({ id: "p4", libelle: "P-010 : Peinture plafond deux couches" }),                       // 4. libellé identique via descriptif
  base({ id: "p5", libelle: "E-001 : Prise de courant" }),                                    // 5. nouveau, complet
  base({ id: "p6", libelle: "E-002 : Interrupteur", cadence: null, coef_vente: null, unite: "" }), // 5. nouveau, bloqué
  base({ id: "p7", libelle: "Pose de plinthes", progbat_id: "999" }),                         // sans code, progbat_id perdu
  base({ id: "p8", libelle: "M-001 : Main-d'œuvre seule", materiaux_liens: [], main_oeuvre_seule: true }),
  base({ id: "p9", libelle: "M-002 : Matériau sans prix", materiaux_liens: [{ materiau_id: "m2", quantite: 1 }] }),
  base({ id: "p10", libelle: "E-008 : Fourniture et pose d'un disjoncteur de branchement" }), // 2. code lu dans le descriptif HTML
];
const STRUCTURES = [
  { id: 501, code: "X-999", label: "Ancien libellé", unitCode: "m2", saleNetUnitPrice: 10, active: true },
  { id: 502, code: "d-002", label: "Démolition cloisons", unitCode: "m2", saleNetUnitPrice: 20 },
  { id: 503, code: "D-003", label: "Carottage A", unitCode: "U" },
  { id: 504, code: "CAROTTAGE-B", label: "Carottage B", description: "<p>D-003 : Carottage B</p>", unitCode: "U" },
  { id: 505, code: "PEINTURE-PLAFOND", label: "Peinture", description: "<div>Peinture plafond deux couches</div>", unitCode: "m2" },
  { id: 506, code: "Z-001", label: "Structure ProGBat orpheline", unitCode: "U" },
  { id: 507, code: TECH, label: "Disjoncteur de branchement 1P+N 60A", description: "E-008&nbsp;: <div>Fourniture et pose d'un disjoncteur de branchement</div>", unitCode: "U", saleNetUnitPrice: 250 },
];
const TAXES = [{ id: 1, rate: 20, label: "20 %", saleDefault: true }, { id: 2, rate: 10, label: "10 %" }];
const UNITES = [{ id: 1, code: "m2" }, { id: 2, code: "U" }, { id: 3, code: "ml" }];

const res = inv.rapprocherBibliotheque({ ouvrages: OUVRAGES, structures: STRUCTURES, materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20, taxes: TAXES, unites: UNITES });
const par = Object.fromEntries(res.rapprochements.map((r) => [r.profero.id, r]));

// ── Statuts, dans l'ordre des règles ────────────────────────────────────────
assert.equal(par.p1.statut, "deja_lie");
assert.equal(par.p1.correspondance.id, 501, "le progbat_id prime sur le code");
assert.equal(par.p2.statut, "correspondance_code_a_confirmer");
assert.equal(par.p2.correspondance.id, 502, "code comparé après normalisation (d-002 = D-002)");
assert.equal(par.p2.correspondance.source_code, "champ");
assert.equal(par.p2.correspondance.code_commun, "D-002");
assert.equal(par.p2.correspondance.label, "Démolition cloisons", "libellé ProGBat conservé");
assert.equal(par.p3.statut, "ambigu");
assert.deepEqual(par.p3.candidats.map((c) => c.id).sort(), [503, 504], "tous les candidats sont renvoyés (champ + descriptif)");
assert.equal(par.p3.candidats.find((c) => c.id === 504).source_code, "descriptif");
assert.equal(par.p3.candidats.find((c) => c.id === 504).code_api, "CAROTTAGE-B", "code technique conservé en secondaire");
assert.equal(par.p4.statut, "correspondance_libelle_a_examiner", "libellé identique lu dans le descriptif nettoyé");
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

// Cas signalé : E-008 face au champ technique DISJONCTEURBRANCHEMENT-… → correspondance de CODE
assert.equal(par.p10.statut, "correspondance_code_a_confirmer");
assert.equal(par.p10.correspondance.id, 507, "identifiant numérique ProGBat");
assert.equal(par.p10.correspondance.code, "E-008", "code métier détecté, pas le code technique");
assert.equal(par.p10.correspondance.source_code, "descriptif");
assert.equal(par.p10.correspondance.code_api, TECH);
assert.equal(par.p10.correspondance.label, "Disjoncteur de branchement 1P+N 60A");
assert.equal(par.p10.correspondance.descriptif, "E-008 : Fourniture et pose d'un disjoncteur de branchement");
assert.ok(!/<|&nbsp;/.test(JSON.stringify(res)), "aucun HTML brut dans la réponse");

// ── Prix repris de la source unique (coût 2×6,5 + 1×40 = 53 ; ×1,5 = 79,5) ─
assert.equal(par.p5.prix.cout_total_ht, 53);                       // 13 matériaux + 1 h × 40 € (coût chargé)
assert.equal(par.p5.prix.prix_materiaux_ht, 19.5);                  // 13 × 1,5 (coefficient sur les matériaux seuls)
assert.equal(par.p5.prix.prix_main_oeuvre_ht, 80);                  // 1 h × 80 €/h (taux de vente sélectionné)
assert.equal(par.p5.prix.prix_vente_ht, 99.5, "prix synchronisé = matériaux × coef + cadence × taux");
assert.equal(par.p5.prix.taux_horaire_vente, 80);
assert.equal(par.p5.prix.taux_horaire_vente_id, "t1");
assert.equal(par.p5.prix.taux_marge_pct, 46.73);                    // (99,5 − 53) / 99,5

// ── ProGBat non liés, compteurs, sources ───────────────────────────────────
assert.deepEqual(res.progbat_non_lies.map((s) => s.id), [506], "seule la structure orpheline est signalée");
assert.equal(res.progbat_non_lies[0].statut, "progbat_non_lie");
assert.equal(res.compteurs.deja_lie, 1);
assert.equal(res.compteurs.correspondance_code_a_confirmer, 2);
assert.equal(res.compteurs.ambigu, 1);
assert.equal(res.compteurs.correspondance_libelle_a_examiner, 1);
assert.equal(res.compteurs.nouveau_a_creer, 5);
assert.equal(res.compteurs.progbat_non_lie, 1);
assert.equal(res.nb_ouvrages_profero, 10);
assert.equal(res.nb_structures_progbat, 7);
assert.equal(res.ambiguites.length, 1);
assert.equal(res.bloques.length, 3);
assert.equal(res.nb_synchronisables, 7);
assert.deepEqual(res.sources_codes, { descriptif: 2, libelle: 0, champ: 4, aucun: 1 });

// Même code dans le champ ET le libellé d'une seule structure : pas d'ambiguïté artificielle
const doublon = inv.rapprocherBibliotheque({
  ouvrages: [base({ id: "q2", libelle: "D-001 : Décollage" })],
  structures: [{ id: 602, code: "D-001", label: "D-001 : Décollage", unitCode: "m2" }],
  materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20,
});
assert.equal(doublon.rapprochements[0].statut, "correspondance_code_a_confirmer");
assert.deepEqual(doublon.sources_codes, { descriptif: 0, libelle: 1, champ: 0, aucun: 0 });
// Deux structures portant E-021 dans leur descriptif → ambigu
const amb = inv.rapprocherBibliotheque({
  ouvrages: [base({ id: "q3", libelle: "E-021 : Tableau électrique" })],
  structures: [
    { id: 701, code: "TABLEAU-A", label: "Tableau A", description: "<p>E-021 : Tableau</p>" },
    { id: 702, code: "TABLEAU-B", label: "Tableau B", description: "E-021&nbsp;: Tableau bis" },
  ],
  materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20,
});
assert.equal(amb.rapprochements[0].statut, "ambigu");
assert.deepEqual(amb.rapprochements[0].candidats.map((c) => c.id), [701, 702]);

// ── TVA et unité : règles de complétude ────────────────────────────────────
const sansTva = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: null });
assert.ok(sansTva.blocages.some((b) => /TVA/.test(b)), "sans TVA par défaut ⇒ bloqué");
const tvaInconnue = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 5.5, tauxTvaProgbat: TAXES });
assert.ok(tvaInconnue.synchronisable && tvaInconnue.avertissements.some((a) => /TVA 5.5/.test(a)), "TVA absente de ProGBat = avertissement, pas blocage");
const tvaFraction = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20, tauxTvaProgbat: [{ rate: 0.2 }] });
assert.equal(tvaFraction.avertissements.length, 0, "taux exprimé en fraction (0,2) reconnu");
const uniteInconnue = inv.verifierCompletude(base({ id: "x", libelle: "T-001 : Test", unite: "forfait" }), { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20, unitesProgbat: UNITES });
assert.ok(uniteInconnue.avertissements.some((a) => /Unité « forfait » inconnue/.test(a)));
// Coût horaire CHARGÉ absent : le prix de vente ne dépend plus de lui ⇒ avertissement (marge), pas blocage
const sansCoutH = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: null, tauxHoraires: TAUX_H, tvaDefaut: 20 });
assert.equal(sansCoutH.synchronisable, true, sansCoutH.blocages.join(" | "));
assert.equal(sansCoutH.prix.prix_vente_ht, 99.5);
assert.equal(sansCoutH.prix.cout_total_ht, null);
assert.ok(sansCoutH.avertissements.some((a) => /Coût horaire/.test(a)));
// Taux horaire de VENTE absent, inconnu ou liste vide ⇒ bloquant
const sansTauxListe = inv.verifierCompletude(OUVRAGES[4], { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: [], tvaDefaut: 20 });
assert.equal(sansTauxListe.synchronisable, false);
assert.ok(sansTauxListe.blocages.some((b) => /Taux horaire/.test(b)), sansTauxListe.blocages.join(" | "));
const tauxInconnu = inv.verifierCompletude(base({ id: "x2", libelle: "T-002 : Test", taux_horaire_vente_id: "zz" }), { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20 });
assert.ok(tauxInconnu.blocages.some((b) => /introuvable/.test(b)));
const sansTauxOuvrage = inv.verifierCompletude(base({ id: "x3", libelle: "T-003 : Test", taux_horaire_vente_id: null }), { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20 });
assert.ok(sansTauxOuvrage.blocages.some((b) => /non sélectionné/.test(b)));
// Taux différent ⇒ prix différent, même ouvrage
const chef = inv.verifierCompletude(base({ id: "x4", libelle: "T-004 : Test", taux_horaire_vente_id: "t2" }), { materiaux: MATERIAUX, coutHoraire: 40, tauxHoraires: TAUX_H, tvaDefaut: 20 });
assert.equal(chef.prix.prix_vente_ht, 114.5);   // 19,5 + 1 × 95

// ── Motifs de blocage agrégés ──────────────────────────────────────────────
const motifs = inv.motifsBlocage(res.rapprochements);
assert.ok(motifs.length >= 3 && motifs[0].nb >= motifs[motifs.length - 1].nb);

// ── Copies embarquées dans l'Edge Function ─────────────────────────────────
const divergents = sync.verifierCopies();
assert.deepEqual(divergents, [], "copies lib/ de l'Edge Function à régénérer : node scripts/sync-progbat-edge-lib.mjs");

console.log("verif-progbat-inventaire : OK (6 statuts, code métier descriptif/libellé/champ, HTML nettoyé, complétude, copies Edge à jour)");
