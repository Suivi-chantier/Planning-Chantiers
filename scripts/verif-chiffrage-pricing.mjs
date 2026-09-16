#!/usr/bin/env node
// Vérifie le module de calcul du chiffrage (src/Renovation/chiffragePricing.mjs).
//   node scripts/verif-chiffrage-pricing.mjs
// Formule v2 : prix = matériaux × coefficient + coût direct × coefficient +
// cadence × taux horaire de VENTE sélectionné. Cas couverts : utilitaires de
// marge/coefficient (toujours exposés), arrondis, ouvrage complet, matériau
// sans prix, coût horaire chargé absent (marge seulement), cadence absente,
// taux horaire absent / inconnu / désactivé, ouvrage main-d'œuvre seule,
// occurrences multiples d'un même bibliotheque_id, zones différentes, snapshot
// figé (bibliothèque ET taux modifiés ensuite), taux global pondéré, COUV-001,
// ancien projet `logements`, duplication avec zones et snapshots.
import assert from "node:assert/strict";

const p = await import(new URL("../src/Renovation/chiffragePricing.mjs", import.meta.url).href);

const MATERIAUX = [
  { id: "m1", nom: "Plaque BA13", unite: "U", prix_unitaire: 6.5 },
  { id: "m2", nom: "Rail R48", unite: "ml", prix_unitaire: 2.2 },
  { id: "m3", nom: "Laine de verre", unite: "m²", prix_unitaire: null },   // sans prix
];
const COUT_H = 40;   // coût horaire CHARGÉ (planning_config.taux_mo_previsionnel) : marge seulement
// Taux horaires de VENTE (table taux_horaires_vente)
const TAUX = [
  { id: "t1", libelle: "Taux standard", taux_ht: 80, est_defaut: true, actif: true },
  { id: "t2", libelle: "Chef d'équipe", taux_ht: 95, est_defaut: false, actif: true },
  { id: "t3", libelle: "Ancien taux", taux_ht: 65, est_defaut: false, actif: false },
];
// Coefficients de VENTE (table coefficients_vente) : prix matériaux = coût × coefficient de l'ouvrage
const COEFS = [
  { id: "c150", libelle: "Coefficient standard", valeur: 1.5, est_defaut: true, actif: true },
  { id: "c135", libelle: "Coefficient réduit", valeur: 1.35, est_defaut: false, actif: true },
  { id: "c2", libelle: "Coefficient renforcé", valeur: 2, est_defaut: false, actif: true },
  { id: "c0", libelle: "Ancien coefficient", valeur: 1.2, est_defaut: false, actif: false },
];
const CTX = { materiaux: MATERIAUX, coutHoraire: COUT_H, tauxHoraires: TAUX, coefficientsVente: COEFS };

assert.equal(p.CALCUL_VERSION, 2, "la nouvelle formule porte la version 2");

// ── 1 & 2 : utilitaires de marge (toujours exposés, marge dérivée) ──────────
assert.equal(p.prixVenteDepuisMarge(1000, 30), 1428.57, "1 000 € à 30 % ⇒ 1 428,57 €");
assert.equal(p.margeEuros(1428.57, 1000), 428.57);
assert.equal(p.tauxMargeReel(1428.57, 1000), 30);
assert.equal(p.prixVenteDepuisMarge("1000", "30"), 1428.57, "chaînes tolérées");

// ── 3 : marge 0 % ───────────────────────────────────────────────────────────
assert.equal(p.prixVenteDepuisMarge(1000, 0), 1000);
assert.equal(p.tauxMargeReel(1000, 1000), 0);
assert.equal(p.validerTauxMarge(0).valide, true);

// ── 4 : marge 100 % (et plus) rejetée, sans NaN/Infinity ────────────────────
assert.equal(p.prixVenteDepuisMarge(1000, 100), null);
assert.equal(p.validerTauxMarge(100).valide, false);
assert.match(p.validerTauxMarge(100).erreur, /100/);
assert.equal(p.prixVenteDepuisMarge(1000, 150), null);
assert.equal(p.prixVenteDepuisMarge(1000, -5), null);
assert.equal(p.prixVenteDepuisMarge(1000, null), null);
assert.equal(p.prixVenteDepuisMarge(1000, "abc"), null);
assert.equal(p.tauxMargeReel(0, 100), null, "prix nul ⇒ pas de division par zéro");
for (const v of [p.prixVenteDepuisMarge(1000, 100), p.tauxMargeReel(0, 0), p.arrondirMontant("x")]) {
  assert.ok(v === null || Number.isFinite(v));
}

// Arrondi : demi-centime vers le haut, 2 décimales
assert.equal(p.arrondirMontant(1.005), 1.01);
assert.equal(p.arrondirMontant(2.675), 2.68);
assert.equal(p.arrondirMontant(-1.005), -1.01);
assert.equal(p.arrondirMontant(1428.5714285), 1428.57);
assert.equal(p.arrondirMontant(0.1 + 0.2), 0.3, "erreur binaire nettoyée");

// ── Coefficient (matériaux) et taux horaire (main-d'œuvre) ──────────────────
assert.equal(p.prixVenteDepuisCoefficient(32.16, 1.5), 48.24);
assert.equal(p.tauxMargeDepuisCoefficient(1.5), 33.33);
assert.equal(p.coefficientDepuisTauxMarge(50), 2);
assert.equal(p.validerCoefficient(0.8).valide, false, "coef < 1 refusé (vente à perte)");
assert.equal(p.prixMateriauxUnitaire(100, 1.35), 135, "matériaux : 100 × 1,35");
assert.equal(p.prixMateriauxUnitaire(100, 0.5), null);
assert.equal(p.prixMainOeuvreUnitaire(2.5, 80), 200, "MO : 2,5 h × 80 €/h");
assert.equal(p.prixMainOeuvreUnitaire(0.33, 80), 26.4);
assert.equal(p.prixMainOeuvreUnitaire(1.005, 80), 80.4);
assert.equal(p.prixMainOeuvreUnitaire("2,5", "80"), 200, "chaînes fr tolérées");
assert.equal(p.prixMainOeuvreUnitaire(null, 80), null);
assert.equal(p.prixMainOeuvreUnitaire(2.5, 0), null);
assert.equal(p.prixMainOeuvreUnitaire(2.5, -80), null);
for (const t of [null, "", "abc", 0, -1]) assert.equal(p.validerTauxHoraire(t).valide, false, `taux ${String(t)} refusé`);
assert.equal(p.validerTauxHoraire(80).valeur, 80);
assert.equal(p.validerTauxHoraire("85,5").valeur, 85.5);

// Résolution du taux d'un ouvrage
assert.equal(p.resoudreTauxHoraire({ taux_horaire_vente_id: "t1" }, { tauxHoraires: TAUX }).valeur, 80);
assert.equal(p.resoudreTauxHoraire({ taux_horaire_vente_id: "t3" }, { tauxHoraires: TAUX }).valide, true, "taux désactivé : conservé");
assert.match(p.resoudreTauxHoraire({ taux_horaire_vente_id: "t3" }, { tauxHoraires: TAUX }).avertissement, /désactivé/);
assert.equal(p.resoudreTauxHoraire({ taux_horaire_vente_id: "zz" }, { tauxHoraires: TAUX }).valide, false);
assert.match(p.resoudreTauxHoraire({ taux_horaire_vente_id: "zz" }, { tauxHoraires: TAUX }).erreur, /introuvable/);
assert.match(p.resoudreTauxHoraire({ taux_horaire_vente_id: null }, { tauxHoraires: TAUX }).erreur, /non sélectionné/);
assert.equal(p.resoudreTauxHoraire({ taux_horaire_vente_id: "t1", taux_horaire_vente: { id: "t1", libelle: "Joint", taux_ht: 80 } }, {}).valeur, 80, "objet joint accepté");
assert.equal(p.resoudreTauxHoraire({ taux_horaire_vente_id: "t9" }, { tauxHoraires: [{ id: "t9", libelle: "Nul", taux_ht: 0, actif: true }] }).valide, false, "taux 0 invalide");

// ── Exemple de référence de la spécification ────────────────────────────────
// Coût matériaux 100 €, coefficient 1,35, cadence 2,5 h, taux 80 €/h ⇒ 135 + 200 = 335 €
const REF = { id: "b-ref", libelle: "T-001 : Référence", unite: "U", cadence: 2.5, coefficient_vente_id: "c135", taux_horaire_vente_id: "t1", materiaux_liens: [{ materiau_id: "m100", quantite: 1 }] };
const calcRef = p.calculerOuvrage(REF, { ...CTX, materiaux: [{ id: "m100", nom: "Kit", unite: "U", prix_unitaire: 100 }] });
assert.equal(calcRef.prixMateriauxUnitaire, 135);
assert.equal(calcRef.prixMainOeuvreUnitaire, 200);
assert.equal(calcRef.prixVenteUnitaire, 335);
assert.equal(calcRef.coutTotalUnitaire, 200);   // 100 + 2,5 × 40
assert.equal(calcRef.complet, true);

// ── Ouvrage complet ─────────────────────────────────────────────────────────
const MU001 = {
  id: "b-mu001", libelle: "MU-001 Fourniture et pose d'un doublage", unite: "m2", cadence: 0.5,
  materiaux_liens: [{ materiau_id: "m1", quantite: 1 }, { materiau_id: "m2", quantite: 2 }],
  coefficient_vente_id: "c135", taux_horaire_vente_id: "t1",
  coef_vente: 9.99, taux_marge_pct: 60,   // colonnes OBSOLÈTES : doivent être ignorées
};
const calc = p.calculerOuvrage(MU001, CTX);
assert.equal(calc.code, "MU-001");
assert.equal(calc.unite, "m²", "m2 normalisé en m²");
assert.equal(calc.coutMateriauxUnitaire, 10.9);   // 6,5 + 2 × 2,2
assert.equal(calc.coutMainOeuvreUnitaire, 20);    // 0,5 h × 40 € (coût chargé)
assert.equal(calc.coutTotalUnitaire, 30.9);
assert.equal(calc.prixMateriauxUnitaire, 14.72);  // 10,9 × 1,35 = 14,715 ⇒ 14,72
assert.equal(calc.prixMainOeuvreUnitaire, 40);    // 0,5 h × 80 €/h
assert.equal(calc.prixVenteUnitaire, 54.72);
assert.equal(calc.margeUnitaire, 23.82);
assert.equal(calc.tauxMargePct, 43.53, "marge dérivée (prix − coût) / prix");
assert.equal(calc.tauxMargeReel, 43.53);
assert.equal(calc.modePrix, "coefficient");
assert.equal(calc.coefVente, 1.35, "coefficient lu par la référence, jamais depuis coef_vente (obsolète)");
assert.equal(calc.coefficient.libelle, "Coefficient réduit");
assert.equal(calc.tauxHoraire.libelle, "Taux standard");
assert.equal(calc.mainOeuvre.tauxVente, 80);
assert.equal(calc.complet, true);
assert.deepEqual(calc.erreurs, []);

// Le coefficient ne touche PAS la main-d'œuvre : coef ×2 ⇒ seuls les matériaux doublent
const coef2 = p.calculerOuvrage({ ...MU001, coefficient_vente_id: "c2" }, CTX);
assert.equal(coef2.prixMateriauxUnitaire, 21.8);
assert.equal(coef2.prixMainOeuvreUnitaire, 40, "MO inchangée quand le coefficient change");
assert.equal(coef2.prixVenteUnitaire, 61.8);

// Recalcul immédiat : cadence, taux, coût matériaux, coefficient
assert.equal(p.calculerOuvrage({ ...MU001, cadence: 1 }, CTX).prixVenteUnitaire, 94.72, "cadence ×2 ⇒ MO 80");
assert.equal(p.calculerOuvrage({ ...MU001, taux_horaire_vente_id: "t2" }, CTX).prixVenteUnitaire, 62.22, "taux 95 ⇒ MO 47,5");
assert.equal(p.calculerOuvrage(MU001, { ...CTX, materiaux: [{ id: "m1", prix_unitaire: 13 }, { id: "m2", prix_unitaire: 2.2 }] }).prixMateriauxUnitaire, 23.49, "matériau plus cher ⇒ 17,4 × 1,35");
// Modification du taux dans la liste (80 → 85) : le calcul courant suit, sans toucher l'ouvrage
const TAUX85 = TAUX.map(t => t.id === "t1" ? { ...t, taux_ht: 85 } : t);
const calc85 = p.calculerOuvrage(MU001, { ...CTX, tauxHoraires: TAUX85 });
assert.equal(calc85.prixMainOeuvreUnitaire, 42.5);
assert.equal(calc85.prixVenteUnitaire, 57.22);

// Coefficient introuvable / non sélectionné / liste vide ⇒ bloquant quand des matériaux existent
const coefInconnu = p.calculerOuvrage({ ...MU001, coefficient_vente_id: "zz" }, CTX);
assert.equal(coefInconnu.complet, false);
assert.ok(coefInconnu.erreurs.some(e => /introuvable/i.test(e)), coefInconnu.erreurs.join(" | "));
const sansCoef = p.calculerOuvrage({ ...MU001, coefficient_vente_id: null }, CTX);
assert.equal(sansCoef.complet, false);
assert.ok(sansCoef.erreurs.some(e => /coefficient de vente non sélectionné/i.test(e)));
assert.equal(p.calculerOuvrage(MU001, { ...CTX, coefficientsVente: [] }).complet, false);
// Les colonnes obsolètes ne sont JAMAIS un repli : coef_vente / taux_marge_pct seuls ⇒ bloquant
const obsolete = p.calculerOuvrage({ ...MU001, coefficient_vente_id: null, coef_vente: 1.5, taux_marge_pct: 30 }, CTX);
assert.equal(obsolete.complet, false, "coef_vente n'est plus une source de vérité");
// Coefficient désactivé déjà affecté ⇒ calculable, avec avertissement
const coefInactif = p.calculerOuvrage({ ...MU001, coefficient_vente_id: "c0" }, CTX);
assert.equal(coefInactif.complet, true, coefInactif.erreurs.join(" | "));
assert.equal(coefInactif.prixMateriauxUnitaire, 13.08);   // 10,9 × 1,2
assert.ok(coefInactif.avertissements.some(a => /désactivé/i.test(a)));
// Valeur de coefficient invalide dans la liste ⇒ bloquant
assert.equal(p.calculerOuvrage(MU001, { ...CTX, coefficientsVente: [{ id: "c135", libelle: "Nul", valeur: 0, actif: true }] }).complet, false);
assert.equal(p.calculerOuvrage(MU001, { ...CTX, coefficientsVente: [{ id: "c135", libelle: "Négatif", valeur: -1.5, actif: true }] }).complet, false);
// Résolution directe
assert.equal(p.resoudreCoefficientVente({ coefficient_vente_id: "c150" }, { coefficientsVente: COEFS }).valeur, 1.5);
assert.equal(p.resoudreCoefficientVente({ coefficient_vente_id: "c0" }, { coefficientsVente: COEFS }).actif, false);
assert.match(p.resoudreCoefficientVente({ coefficient_vente_id: null }, { coefficientsVente: COEFS }).erreur, /non sélectionné/);
for (const v of [null, "", "abc", 0, -1]) assert.equal(p.validerValeurCoefficient(v).valide, false, `coefficient ${String(v)} refusé`);
assert.equal(p.validerValeurCoefficient("1,675").valeur, 1.675, "4 décimales conservées");

// ── 5 : matériau sans prix ──────────────────────────────────────────────────
const sansPrix = p.calculerOuvrage({ ...MU001, materiaux_liens: [{ materiau_id: "m3", quantite: 1 }] }, CTX);
assert.equal(sansPrix.complet, false);
assert.equal(sansPrix.coutMateriauxUnitaire, null);
assert.equal(sansPrix.prixVenteUnitaire, null);
assert.ok(sansPrix.erreurs.some(e => /sans prix/i.test(e)), sansPrix.erreurs.join(" | "));
const inconnu = p.calculerOuvrage({ ...MU001, materiaux_liens: [{ materiau_id: "zz", quantite: 1 }] }, CTX);
assert.ok(inconnu.erreurs.some(e => /introuvable/i.test(e)));

// ── 6 : coût horaire CHARGÉ absent ⇒ prix calculable, marge non ─────────────
for (const ch of [null, 0, "", undefined, "abc"]) {
  const r = p.calculerOuvrage(MU001, { ...CTX, coutHoraire: ch });
  assert.equal(r.complet, true, `coût horaire ${String(ch)} : le prix ne dépend plus du coût chargé`);
  assert.equal(r.prixVenteUnitaire, 54.72);
  assert.equal(r.coutMainOeuvreUnitaire, null);
  assert.equal(r.coutTotalUnitaire, null);
  assert.equal(r.tauxMargePct, null);
  assert.ok(r.avertissements.some(a => /coût horaire/i.test(a)));
}
// Cadence absente ⇒ bloquant
const sansCadence = p.calculerOuvrage({ ...MU001, cadence: null }, CTX);
assert.ok(sansCadence.erreurs.some(e => /cadence/i.test(e)));
assert.equal(sansCadence.prixVenteUnitaire, null);
// Taux horaire de vente absent / inconnu / liste vide ⇒ bloquant
assert.equal(p.calculerOuvrage({ ...MU001, taux_horaire_vente_id: null }, CTX).complet, false);
assert.ok(p.calculerOuvrage({ ...MU001, taux_horaire_vente_id: null }, CTX).erreurs.some(e => /taux horaire/i.test(e)));
assert.equal(p.calculerOuvrage({ ...MU001, taux_horaire_vente_id: "zz" }, CTX).complet, false);
assert.equal(p.calculerOuvrage(MU001, { ...CTX, tauxHoraires: [] }).complet, false);
assert.equal(p.calculerOuvrage(MU001, { ...CTX, tauxHoraires: null }).complet, false);
// Taux désactivé déjà affecté ⇒ calculable, avec avertissement
const desactive = p.calculerOuvrage({ ...MU001, taux_horaire_vente_id: "t3" }, CTX);
assert.equal(desactive.complet, true, desactive.erreurs.join(" | "));
assert.equal(desactive.prixMainOeuvreUnitaire, 32.5);   // 0,5 × 65
assert.ok(desactive.avertissements.some(a => /désactivé/i.test(a)));
assert.equal(desactive.tauxHoraire.actif, false);

// ── 7 : ouvrage volontairement sans matériau ────────────────────────────────
const depose = { id: "b-d001", libelle: "D-001 : Décollage tapisserie", unite: "m2", cadence: 0.2, materiaux_liens: [], taux_horaire_vente_id: "t1" };
const nonConfirme = p.calculerOuvrage(depose, CTX);
assert.equal(nonConfirme.complet, false, "sans confirmation ⇒ alerte « aucun matériau »");
assert.ok(nonConfirme.erreurs.some(e => /aucun matériau/i.test(e)));
const confirme = p.calculerOuvrage({ ...depose, main_oeuvre_seule: true }, CTX);
assert.equal(confirme.complet, true, confirme.erreurs.join(" | "));
assert.equal(confirme.coutMateriauxUnitaire, 0);
assert.equal(confirme.coutTotalUnitaire, 8);          // 0,2 × 40
assert.equal(confirme.prixMateriauxUnitaire, 0);
assert.equal(confirme.prixVenteUnitaire, 16);         // 0,2 h × 80 €/h — aucun coefficient requis
assert.equal(confirme.modePrix, "sans_materiaux");
// Coût direct complémentaire : traitement CONSERVÉ (il reçoit le coefficient, comme avant)
const avecDirect = p.calculerOuvrage({ ...depose, main_oeuvre_seule: true, cout_direct_unitaire: 2, coefficient_vente_id: "c150" }, CTX);
assert.equal(avecDirect.coutTotalUnitaire, 10);
assert.equal(avecDirect.prixDirectUnitaire, 3);       // 2 × 1,5
assert.equal(avecDirect.prixVenteUnitaire, 19);       // 0 + 3 + 16
const directSansCoef = p.calculerOuvrage({ ...depose, main_oeuvre_seule: true, cout_direct_unitaire: 2, coefficient_vente_id: null }, CTX);
assert.equal(directSansCoef.complet, false, "coût direct sans coefficient ⇒ bloquant (comme avant)");

// ── 8 & 9 : plusieurs occurrences du même bibliotheque_id, zones différentes ─
const D0 = new Date("2026-09-15T10:00:00Z");
const snapCuisine = p.creerSnapshotOuvrage(MU001, calc, { zone: "Cuisine", tvaPct: 10, quantite: "12", date: D0 });
const snapSdb     = p.creerSnapshotOuvrage(MU001, calc, { zone: "Salle de bains", tvaPct: 10, quantite: "6", date: D0 });
const snapDefaut  = p.creerSnapshotOuvrage(MU001, calc, { quantite: "1" });
assert.equal(snapCuisine.bibliotheque_id, "b-mu001");
assert.equal(snapSdb.bibliotheque_id, "b-mu001");
assert.equal(snapCuisine.zone, "Cuisine");
assert.equal(snapSdb.zone, "Salle de bains");
assert.equal(snapDefaut.zone, p.ZONE_DEFAUT, "zone par défaut = Logement entier");
assert.equal(snapCuisine.code_ouvrage, "MU-001");
assert.equal(snapCuisine.prix_unitaire, 54.72);
assert.equal(snapCuisine.taux_marge_pct, 43.53);
assert.equal(snapCuisine.coef_vente, 1.35, "VALEUR du coefficient figée");
assert.equal(snapCuisine.coefficient_vente_id, "c135", "identifiant du coefficient figé");
assert.equal(snapCuisine.calcul_detail.coefficient_vente_libelle, "Coefficient réduit");
assert.equal(snapCuisine.calcul_detail.coefficient_vente, 1.35);
assert.equal(snapCuisine.taux_horaire_vente_id, "t1", "identifiant du taux figé");
assert.equal(snapCuisine.taux_horaire_vente, 80, "VALEUR du taux figée");
assert.equal(snapCuisine.calcul_version, "2@2026-09-15T10:00:00.000Z");
assert.equal(snapCuisine.calcul_detail.cout_horaire, 40);
assert.equal(snapCuisine.calcul_detail.heures_unitaires, 0.5);
assert.equal(snapCuisine.calcul_detail.taux_horaire_vente, 80);
assert.equal(snapCuisine.calcul_detail.taux_horaire_vente_libelle, "Taux standard");
assert.equal(snapCuisine.calcul_detail.prix_main_oeuvre_unitaire, 40);
assert.equal(snapCuisine.calcul_detail.prix_materiaux_unitaire, 14.72);
assert.equal(snapCuisine.calcul_detail.formule, p.FORMULE_PRIX);
assert.equal(snapCuisine.calcul_detail.materiaux.length, 2);

const lignes = [
  { id: "l1", category: "Murs cloison doublages", ...snapCuisine },
  { id: "l2", category: "Murs cloison doublages", ...snapSdb },
  { id: "l3", category: "Murs cloison doublages", ...p.creerSnapshotOuvrage(MU001, calc, { zone: "Chambre 1", tvaPct: 10, quantite: "10" }) },
];
assert.equal(lignes.filter(l => l.bibliotheque_id === "b-mu001").length, 3, "trois occurrences coexistent");
const groupes = p.grouperParLotZone(lignes, ["Démolition", "Murs cloison doublages"]);
assert.equal(groupes.length, 1);
assert.deepEqual(groupes[0].zones.map(z => z.zone), ["Cuisine", "Chambre 1", "Salle de bains"], "zones dans l'ordre des suggestions");
assert.equal(groupes[0].zones.find(z => z.zone === "Cuisine").total, 656.64);   // 12 × 54,72
assert.equal(groupes[0].total, p.arrondirMontant(656.64 + 328.32 + 547.2));
const apresSuppr = lignes.filter(l => l.id !== "l2");
assert.equal(apresSuppr.length, 2);
assert.ok(apresSuppr.every(l => l.bibliotheque_id === "b-mu001"));

// ── 10 : la bibliothèque ou le TAUX change, le snapshot ne bouge pas ────────
const MU001v2 = { ...MU001, coefficient_vente_id: "c150" };
const calcV2 = p.calculerOuvrage(MU001v2, CTX);
assert.equal(calcV2.prixVenteUnitaire, 56.35);   // 16,35 + 40
assert.equal(snapCuisine.coef_vente, 1.35, "l'ancienne ligne reste à ×1,35");
assert.equal(snapCuisine.prix_unitaire, 54.72);
const nouvelleLigne = p.creerSnapshotOuvrage(MU001v2, calcV2, { zone: "WC", quantite: "1" });
assert.equal(nouvelleLigne.coef_vente, 1.5, "les nouvelles lignes utilisent ×1,5");
assert.equal(nouvelleLigne.coefficient_vente_id, "c150");
// La VALEUR du coefficient partagé change dans Réglages (1,35 → 1,40) : snapshot intact, actualisation explicite possible
const COEFS140 = COEFS.map(c => c.id === "c135" ? { ...c, valeur: 1.4 } : c);
const calc140 = p.calculerOuvrage(MU001, { ...CTX, coefficientsVente: COEFS140 });
assert.equal(calc140.prixMateriauxUnitaire, 15.26);   // 10,9 × 1,4
assert.equal(snapCuisine.coef_vente, 1.35, "snapshot intact après modification du coefficient partagé");
assert.equal(snapCuisine.prix_unitaire, 54.72);
const diffsCoef = p.differencesSnapshot(snapCuisine, MU001, calc140);
assert.deepEqual(diffsCoef.map(d => d.champ).sort(), ["coef_vente", "prix_unitaire", "taux_marge_pct"]);
assert.equal(diffsCoef.find(d => d.champ === "coef_vente").apres, 1.4);
const actualiseeCoef = p.appliquerActualisation({ ...snapCuisine, id: "l1" }, MU001, calc140);
assert.equal(actualiseeCoef.coef_vente, 1.4);
assert.equal(actualiseeCoef.prix_unitaire, 55.26);   // 15,26 + 40
const diffs = p.differencesSnapshot(snapCuisine, MU001v2, calcV2);
assert.deepEqual(diffs.map(d => d.champ).sort(), ["coef_vente", "prix_unitaire", "taux_marge_pct"]);
assert.deepEqual(p.differencesSnapshot(snapCuisine, MU001, calc), [], "aucune différence si rien n'a changé");
// Le taux passe de 80 à 85 €/h dans Réglages : la ligne figée garde 80 et 54,72 ; l'actualisation explicite le signale
assert.equal(snapCuisine.taux_horaire_vente, 80);
const diffsTaux = p.differencesSnapshot(snapCuisine, MU001, calc85);
assert.deepEqual(diffsTaux.map(d => d.champ).sort(), ["prix_unitaire", "taux_horaire_vente", "taux_marge_pct"]);
assert.equal(diffsTaux.find(d => d.champ === "taux_horaire_vente").avant, 80);
assert.equal(diffsTaux.find(d => d.champ === "taux_horaire_vente").apres, 85);
// Ancienne ligne v1 (sans colonne taux_horaire_vente ni coef_vente) : pas de fausse différence sur ces champs
const ligneV1 = { item: calc.libelle, unite: "m²", cout_materiaux_unitaire: 10.9, cout_main_oeuvre_unitaire: 20, cout_direct_unitaire: 0, cout_total_unitaire: 30.9, taux_marge_pct: 43.53, prix_unitaire: 54.72, calcul_version: "1@2026-09-14T10:00:00.000Z" };
assert.deepEqual(p.differencesSnapshot(ligneV1, MU001, calc), []);
const actualisee = p.appliquerActualisation({ ...snapCuisine, id: "l1", zone: "Cuisine", quantite: "12", tva_pct: 10 }, MU001, calc85);
assert.equal(actualisee.taux_horaire_vente, 85);
assert.equal(actualisee.prix_unitaire, 57.22);
assert.equal("zone" in actualisee, false, "l'actualisation ne réécrit ni la zone, ni la quantité, ni la TVA");
assert.equal("quantite" in actualisee, false);
assert.equal("tva_pct" in actualisee, false);

// ── 11 : taux de marge global pondéré ───────────────────────────────────────
const tot = p.totauxDevis([
  { quantite: "1", prix_unitaire: 1428.57, cout_total_unitaire: 1000, cout_materiaux_unitaire: 600, cout_main_oeuvre_unitaire: 400, cout_direct_unitaire: 0, taux_marge_pct: 30, tva_pct: 20 },
  { quantite: "1", prix_unitaire: 200, cout_total_unitaire: 100, cout_materiaux_unitaire: 0, cout_main_oeuvre_unitaire: 100, cout_direct_unitaire: 0, taux_marge_pct: 50, tva_pct: 20 },
], { tvaPctDefaut: 20, budgetClient: 1500 });
assert.equal(tot.venteHT, 1628.57);
assert.equal(tot.coutTotal, 1100);
assert.equal(tot.coutMateriaux, 600);
assert.equal(tot.coutMainOeuvre, 500);
assert.equal(tot.marge, 528.57);
assert.equal(tot.tauxMargeReel, 32.46);
assert.notEqual(tot.tauxMargeReel, 40);
assert.equal(tot.tva, 325.71);
assert.equal(tot.ttc, 1954.28);
assert.equal(tot.ecartBudget, 128.57);
assert.equal(tot.tvaIncomplete, false);
const totSansTva = p.totauxDevis([{ quantite: "2", prix_unitaire: 10, cout_total_unitaire: 5 }]);
assert.equal(totSansTva.tvaIncomplete, true);
assert.equal(totSansTva.tva, null);
assert.equal(totSansTva.ttc, null);
assert.equal(totSansTva.venteHT, 20);
const totLegacy = p.totauxDevis([{ quantite: "1", prix_unitaire: 100 }], { tvaPctDefaut: 20 });
assert.equal(totLegacy.coutsIncomplets, true);
assert.equal(totLegacy.marge, null);
assert.equal(totLegacy.venteHT, 100);
assert.equal(totLegacy.ttc, 120);

// ── 12 : COUV-001 reconnu ───────────────────────────────────────────────────
const couv = p.calculerOuvrage({ id: "b-couv", libelle: "COUV-001 :  Reprise de couverture", unite: "m2", cadence: 2, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], coefficient_vente_id: "c2", taux_horaire_vente_id: "t1" }, CTX);
assert.equal(couv.code, "COUV-001");
assert.equal(couv.prixVenteUnitaire, 173);   // 6,5 × 2 + 2 × 80
assert.equal(p.creerSnapshotOuvrage({ id: "b-couv", libelle: "COUV-001 : Reprise" }, couv).code_ouvrage, "COUV-001");
const grpCouv = p.grouperParLotZone([{ category: "Couverture", item: "COUV-001 : Reprise", code_ouvrage: "COUV-001", quantite: "1", prix_unitaire: 10 }]);
assert.equal(grpCouv[0].lot, "Couverture");

// ── 13 : ancien projet utilisant encore `logements` ─────────────────────────
const unSeul = p.lireLogementProjet({ logements: ["T2"], logement_reference: "", type_logement: "" });
assert.equal(unSeul.type, "T2", "une seule valeur ⇒ repli");
assert.equal(unSeul.repli, true);
assert.equal(unSeul.aVerifier, false);
const plusieurs = p.lireLogementProjet({ logements: ["T2", "T3"], logement_reference: "", type_logement: "" });
assert.equal(plusieurs.aVerifier, true, "plusieurs valeurs ⇒ à vérifier, pas de découpage automatique");
assert.equal(plusieurs.type, "");
assert.match(plusieurs.message, /plusieurs logements/i);
const neuf = p.lireLogementProjet({ logements: ["T2", "T3"], logement_reference: "Appartement 101", type_logement: "T3" });
assert.equal(neuf.type, "T3", "les nouveaux champs priment");
assert.equal(neuf.aVerifier, true, "mais l'ancien tableau multi reste signalé");
const prep = p.verifierPreparationDevis({ client_nom: "Dupont", adresse_bien: "1 rue X", logements: ["T2", "T3"], tva_pct: 20 }, lignes);
assert.equal(prep.pret, false);
assert.ok(prep.bloquants.some(b => /multi-logements/i.test(b)));
const prepOk = p.verifierPreparationDevis({ client_nom: "Dupont", chantier_adresse: "1 rue X", chantier_code_postal: "49000", chantier_ville: "Angers", client_email: "a@b.fr", logement_reference: "Appartement 101", type_logement: "T2", tva_pct: 10, devis_objet: "Rénovation", devis_validite: "2026-12-31" }, lignes);
assert.equal(prepOk.pret, true, prepOk.bloquants.join(" | "));

// ── 14 : duplication d'un projet avec zones et snapshots conservés ──────────
const dupliquer = (ls, nouveauProjetId) => ls.map(({ id, projet_id, ...reste }) => ({ ...reste, projet_id: nouveauProjetId }));
const copie = dupliquer(lignes.map(l => ({ ...l, projet_id: "P1" })), "P2");
assert.equal(copie.length, 3);
assert.ok(copie.every(l => l.projet_id === "P2" && l.id === undefined));
assert.deepEqual(copie.map(l => l.zone), ["Cuisine", "Salle de bains", "Chambre 1"]);
assert.deepEqual(copie.map(l => l.prix_unitaire), [54.72, 54.72, 54.72]);
assert.deepEqual(copie.map(l => l.taux_horaire_vente), [80, 80, 80]);
assert.deepEqual(copie.map(l => l.calcul_version), lignes.map(l => l.calcul_version), "snapshot conservé, pas de recalcul");
assert.ok(copie.every(l => l.coef_vente !== calcV2.coefVente), "la bibliothèque a changé entre-temps : la copie n'en tient pas compte");

// ── Structure ProGBat (préparation, sans réseau) ────────────────────────────
const struct = p.structureDevisProGBat(lignes, { lotsOrdre: [], tvaPctDefaut: 10 });
assert.equal(struct[0].type, "lot");
assert.equal(struct[0].enfants[0].type, "zone");
assert.equal(struct[0].enfants[0].lignes[0].code, "MU-001");
assert.equal(struct[0].enfants[0].lignes[0].tva_pct, 10);
assert.equal(struct[0].enfants[0].lignes[0].prix_unitaire_ht, 54.72, "prix FIGÉ transmis, pas recalculé");

console.log("verif-chiffrage-pricing : OK (formule v2 matériaux × coefficient référencé + cadence × taux, 14 cas + arrondis + snapshots + structure ProGBat)");
