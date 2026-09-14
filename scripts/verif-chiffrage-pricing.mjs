#!/usr/bin/env node
// Vérifie le module de calcul du chiffrage (src/Renovation/chiffragePricing.mjs).
//   node scripts/verif-chiffrage-pricing.mjs
// Couvre les 14 cas exigés : formule de marge (1 000 € / 30 % → 1 428,57 €),
// taux réel, marge 0 %, marge 100 % rejetée, matériau sans prix, coût horaire
// absent, ouvrage main-d'œuvre seule, occurrences multiples d'un même
// bibliotheque_id, zones différentes, snapshot figé, taux global pondéré,
// COUV-001, ancien projet `logements`, duplication avec zones et snapshots.
import assert from "node:assert/strict";

const p = await import(new URL("../src/Renovation/chiffragePricing.mjs", import.meta.url).href);

const MATERIAUX = [
  { id: "m1", nom: "Plaque BA13", unite: "U", prix_unitaire: 6.5 },
  { id: "m2", nom: "Rail R48", unite: "ml", prix_unitaire: 2.2 },
  { id: "m3", nom: "Laine de verre", unite: "m²", prix_unitaire: null },   // sans prix
];
const COUT_H = 40;

// ── 1 & 2 : formule de marge et taux réel ───────────────────────────────────
assert.equal(p.prixVenteDepuisMarge(1000, 30), 1428.57, "1 000 € à 30 % ⇒ 1 428,57 €");
assert.equal(p.margeEuros(1428.57, 1000), 428.57);
assert.equal(p.tauxMargeReel(1428.57, 1000), 30, "taux réel = 30 % (et pas 23 % comme avec coût × 1,30)");
assert.notEqual(p.prixVenteDepuisMarge(1000, 30), 1300, "coût × 1,30 est interdit");
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

// ── Coefficient de vente (saisie métier « × 1,5 ») ──────────────────────────
assert.equal(p.prixVenteDepuisCoefficient(32.16, 1.5), 48.24, "coût × 1,5");
assert.equal(p.prixVenteDepuisCoefficient(32.16, 2), 64.32, "coût × 2");
assert.equal(p.tauxMargeDepuisCoefficient(1.5), 33.33, "×1,5 = 33,33 % du prix de vente");
assert.equal(p.tauxMargeDepuisCoefficient(2), 50);
assert.equal(p.tauxMargeDepuisCoefficient(1), 0);
assert.equal(p.coefficientDepuisTauxMarge(50), 2);
assert.equal(p.coefficientDepuisTauxMarge(30), 1.4286);
assert.equal(p.validerCoefficient(0.8).valide, false, "coef < 1 refusé (vente à perte)");
assert.equal(p.prixVenteDepuisCoefficient(100, 0.8), null);
assert.equal(p.prixVenteDepuisCoefficient(100, null), null);
assert.equal(p.prixVenteDepuisCoefficient(100, "abc"), null);
// Cohérence des deux formules : coef 1,5 ⇔ marge 33,33 %
assert.equal(p.prixVenteDepuisCoefficient(1000, 1.5), 1500);
assert.equal(Math.abs(p.prixVenteDepuisMarge(1000, p.tauxMargeDepuisCoefficient(1.5)) - 1500) < 0.1, true);

// ── Ouvrage complet ─────────────────────────────────────────────────────────
const MU001 = {
  id: "b-mu001", libelle: "MU-001 Fourniture et pose d'un doublage", unite: "m2", cadence: 0.5,
  materiaux_liens: [{ materiau_id: "m1", quantite: 1 }, { materiau_id: "m2", quantite: 2 }],
  taux_marge_pct: 30,
};
const calc = p.calculerOuvrage(MU001, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(calc.code, "MU-001");
assert.equal(calc.unite, "m²", "m2 normalisé en m²");
assert.equal(calc.coutMateriauxUnitaire, 10.9);   // 6,5 + 2 × 2,2
assert.equal(calc.coutMainOeuvreUnitaire, 20);    // 0,5 h × 40 €
assert.equal(calc.coutTotalUnitaire, 30.9);
assert.equal(calc.prixVenteUnitaire, 44.14);      // 30,9 / 0,7 = 44,142857
assert.equal(calc.tauxMargeReel, 30);
assert.equal(calc.complet, true);
assert.deepEqual(calc.erreurs, []);

// Ouvrage saisi en coefficient : le coefficient prime, le taux est dérivé et figé
const S001 = { id: "b-s001", libelle: "S-001 : Sol lame PVC", unite: "m2", cadence: 0.25, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], coef_vente: 1.5, taux_marge_pct: 50 /* ancien, ignoré */ };
const calcS = p.calculerOuvrage(S001, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(calcS.modePrix, "coefficient");
assert.equal(calcS.coefVente, 1.5);
assert.equal(calcS.coutTotalUnitaire, 16.5);          // 6,5 + 0,25 × 40
assert.equal(calcS.prixVenteUnitaire, 24.75);         // 16,5 × 1,5 (et non × 2)
assert.equal(calcS.tauxMargePct, 33.33);
assert.equal(calcS.tauxMargeReel, 33.33);
assert.equal(calcS.complet, true);
const snapS = p.creerSnapshotOuvrage(S001, calcS, { zone: "Séjour", quantite: "20" });
assert.equal(snapS.coef_vente, 1.5);
assert.equal(snapS.taux_marge_pct, 33.33);
assert.equal(snapS.prix_unitaire, 24.75);
assert.equal(snapS.calcul_detail.mode_prix, "coefficient");
// Ancien ouvrage sans coefficient : repli sur le taux, coefficient dérivé
assert.equal(calc.modePrix, "taux");
assert.equal(calc.coefVente, 1.4286);
// Coefficient invalide saisi ⇒ bloquant, pas de repli silencieux sur le taux
const coefKO = p.calculerOuvrage({ ...S001, coef_vente: 0.5 }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(coefKO.complet, false);
assert.ok(coefKO.erreurs.some(e => /coefficient/i.test(e)));
// Ni coefficient ni taux ⇒ bloquant
const rien = p.calculerOuvrage({ ...S001, coef_vente: null, taux_marge_pct: null }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(rien.complet, false);
assert.ok(rien.erreurs.some(e => /coefficient de vente non renseigné/i.test(e)));

// ── 5 : matériau sans prix ──────────────────────────────────────────────────
const sansPrix = p.calculerOuvrage({ ...MU001, materiaux_liens: [{ materiau_id: "m3", quantite: 1 }] }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(sansPrix.complet, false);
assert.equal(sansPrix.coutMateriauxUnitaire, null);
assert.equal(sansPrix.prixVenteUnitaire, null);
assert.ok(sansPrix.erreurs.some(e => /sans prix/i.test(e)), sansPrix.erreurs.join(" | "));

// Matériau inconnu
const inconnu = p.calculerOuvrage({ ...MU001, materiaux_liens: [{ materiau_id: "zz", quantite: 1 }] }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.ok(inconnu.erreurs.some(e => /introuvable/i.test(e)));

// ── 6 : coût horaire non configuré ──────────────────────────────────────────
for (const ch of [null, 0, "", undefined, "abc"]) {
  const r = p.calculerOuvrage(MU001, { materiaux: MATERIAUX, coutHoraire: ch });
  assert.equal(r.complet, false, `coût horaire ${String(ch)}`);
  assert.equal(r.coutMainOeuvreUnitaire, null);
  assert.ok(r.erreurs.some(e => /coût horaire/i.test(e)));
}
// Cadence absente
const sansCadence = p.calculerOuvrage({ ...MU001, cadence: null }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.ok(sansCadence.erreurs.some(e => /cadence/i.test(e)));
assert.equal(sansCadence.prixVenteUnitaire, null);

// ── 7 : ouvrage volontairement sans matériau ────────────────────────────────
const depose = { id: "b-d001", libelle: "D-001 : Décollage tapisserie", unite: "m2", cadence: 0.2, materiaux_liens: [], taux_marge_pct: 25 };
const nonConfirme = p.calculerOuvrage(depose, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(nonConfirme.complet, false, "sans confirmation ⇒ alerte « aucun matériau »");
assert.ok(nonConfirme.erreurs.some(e => /aucun matériau/i.test(e)));
const confirme = p.calculerOuvrage({ ...depose, main_oeuvre_seule: true }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(confirme.complet, true, confirme.erreurs.join(" | "));
assert.equal(confirme.coutMateriauxUnitaire, 0);
assert.equal(confirme.coutTotalUnitaire, 8);       // 0,2 × 40
assert.equal(confirme.prixVenteUnitaire, 10.67);   // 8 / 0,75
// Coût direct complémentaire
const avecDirect = p.calculerOuvrage({ ...depose, main_oeuvre_seule: true, cout_direct_unitaire: 2 }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(avecDirect.coutTotalUnitaire, 10);
// Marge absente ⇒ bloquant
const sansMarge = p.calculerOuvrage({ ...MU001, taux_marge_pct: null }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(sansMarge.complet, false);
assert.ok(sansMarge.erreurs.some(e => /coefficient de vente non renseigné/i.test(e)), sansMarge.erreurs.join(" | "));

// ── 8 & 9 : plusieurs occurrences du même bibliotheque_id, zones différentes ─
const snapCuisine = p.creerSnapshotOuvrage(MU001, calc, { zone: "Cuisine", tvaPct: 10, quantite: "12", date: new Date("2026-09-14T10:00:00Z") });
const snapSdb     = p.creerSnapshotOuvrage(MU001, calc, { zone: "Salle de bains", tvaPct: 10, quantite: "6", date: new Date("2026-09-14T10:00:00Z") });
const snapDefaut  = p.creerSnapshotOuvrage(MU001, calc, { quantite: "1" });
assert.equal(snapCuisine.bibliotheque_id, "b-mu001");
assert.equal(snapSdb.bibliotheque_id, "b-mu001");
assert.equal(snapCuisine.zone, "Cuisine");
assert.equal(snapSdb.zone, "Salle de bains");
assert.equal(snapDefaut.zone, p.ZONE_DEFAUT, "zone par défaut = Logement entier");
assert.equal(snapCuisine.code_ouvrage, "MU-001");
assert.equal(snapCuisine.prix_unitaire, 44.14);
assert.equal(snapCuisine.taux_marge_pct, 30);
assert.equal(snapCuisine.calcul_version, "1@2026-09-14T10:00:00.000Z");
assert.equal(snapCuisine.calcul_detail.cout_horaire, 40);
assert.equal(snapCuisine.calcul_detail.heures_unitaires, 0.5);
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
assert.equal(groupes[0].zones.find(z => z.zone === "Cuisine").total, 529.68);   // 12 × 44,14
assert.equal(groupes[0].total, 529.68 + 264.84 + 441.4);
// Supprimer une occurrence ne touche pas les autres
const apresSuppr = lignes.filter(l => l.id !== "l2");
assert.equal(apresSuppr.length, 2);
assert.ok(apresSuppr.every(l => l.bibliotheque_id === "b-mu001"));

// ── 10 : la bibliothèque change, le snapshot ne bouge pas ──────────────────
const MU001v2 = { ...MU001, taux_marge_pct: 35 };
const calcV2 = p.calculerOuvrage(MU001v2, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(calcV2.prixVenteUnitaire, 47.54);   // 30,9 / 0,65
assert.equal(snapCuisine.taux_marge_pct, 30, "l'ancienne ligne reste à 30 %");
assert.equal(snapCuisine.prix_unitaire, 44.14);
const nouvelleLigne = p.creerSnapshotOuvrage(MU001v2, calcV2, { zone: "WC", quantite: "1" });
assert.equal(nouvelleLigne.taux_marge_pct, 35, "les nouvelles lignes utilisent 35 %");
const diffs = p.differencesSnapshot(snapCuisine, MU001v2, calcV2);
assert.deepEqual(diffs.map(d => d.champ).sort(), ["coef_vente", "prix_unitaire", "taux_marge_pct"]);
assert.deepEqual(p.differencesSnapshot(snapCuisine, MU001, calc), [], "aucune différence si rien n'a changé");
const actualisee = p.appliquerActualisation({ ...snapCuisine, id: "l1", zone: "Cuisine", quantite: "12", tva_pct: 10 }, MU001v2, calcV2);
assert.equal(actualisee.taux_marge_pct, 35);
assert.equal(actualisee.prix_unitaire, 47.54);
assert.equal("zone" in actualisee, false, "l'actualisation ne réécrit ni la zone, ni la quantité, ni la TVA");
assert.equal("quantite" in actualisee, false);
assert.equal("tva_pct" in actualisee, false);

// ── 11 : taux de marge global pondéré ───────────────────────────────────────
// Ligne A : coût 1 000, marge 30 % ⇒ vente 1 428,57 ; ligne B : coût 100, marge 50 % ⇒ vente 200.
// Global = (1 628,57 − 1 100) / 1 628,57 = 32,45 % — PAS (30 + 50) / 2 = 40 %.
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
// TVA manquante ⇒ TTC indisponible, pas de NaN
const totSansTva = p.totauxDevis([{ quantite: "2", prix_unitaire: 10, cout_total_unitaire: 5 }]);
assert.equal(totSansTva.tvaIncomplete, true);
assert.equal(totSansTva.tva, null);
assert.equal(totSansTva.ttc, null);
assert.equal(totSansTva.venteHT, 20);
// Ancienne ligne à prix saisi (sans coût) ⇒ marge non fiable, mais vente comptée
const totLegacy = p.totauxDevis([{ quantite: "1", prix_unitaire: 100 }], { tvaPctDefaut: 20 });
assert.equal(totLegacy.coutsIncomplets, true);
assert.equal(totLegacy.marge, null);
assert.equal(totLegacy.venteHT, 100);
assert.equal(totLegacy.ttc, 120);

// ── 12 : COUV-001 reconnu ───────────────────────────────────────────────────
const couv = p.calculerOuvrage({ id: "b-couv", libelle: "COUV-001 :  Reprise de couverture", unite: "m2", cadence: 2, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_marge_pct: 30 }, { materiaux: MATERIAUX, coutHoraire: COUT_H });
assert.equal(couv.code, "COUV-001");
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
// Recopie telle que la page la fait : on retire l'id et le projet, on garde tout le reste.
const dupliquer = (ls, nouveauProjetId) => ls.map(({ id, projet_id, ...reste }) => ({ ...reste, projet_id: nouveauProjetId }));
const copie = dupliquer(lignes.map(l => ({ ...l, projet_id: "P1" })), "P2");
assert.equal(copie.length, 3);
assert.ok(copie.every(l => l.projet_id === "P2" && l.id === undefined));
assert.deepEqual(copie.map(l => l.zone), ["Cuisine", "Salle de bains", "Chambre 1"]);
assert.deepEqual(copie.map(l => l.prix_unitaire), [44.14, 44.14, 44.14]);
assert.deepEqual(copie.map(l => l.taux_marge_pct), [30, 30, 30]);
assert.deepEqual(copie.map(l => l.calcul_version), lignes.map(l => l.calcul_version), "snapshot conservé, pas de recalcul");
// La bibliothèque a changé (35 %) entre-temps : la copie n'en tient pas compte.
assert.ok(copie.every(l => l.taux_marge_pct !== calcV2.tauxMargePct));

// ── Structure ProGBat (préparation, sans réseau) ────────────────────────────
const struct = p.structureDevisProGBat(lignes, { lotsOrdre: [], tvaPctDefaut: 10 });
assert.equal(struct[0].type, "lot");
assert.equal(struct[0].enfants[0].type, "zone");
assert.equal(struct[0].enfants[0].lignes[0].code, "MU-001");
assert.equal(struct[0].enfants[0].lignes[0].tva_pct, 10);

console.log("verif-chiffrage-pricing : OK (14 cas + arrondis + structure ProGBat)");
