// Vérifie les CONDITIONS DE VENTE D'UN CHIFFRAGE (coefficient / taux global) :
// lecture des conditions figées, quatre combinaisons de modes, nouvelles lignes
// (origine + appliqué figés), recalcul ciblé des lignes existantes depuis leurs
// seules données figées, retour aux paramètres de chaque ouvrage, lignes non
// recalculables signalées, simulation (totaux / marges), verrous, affichage, et
// compatibilité ProGBat (prix figé uniquement, hash, clés interdites).
//   node scripts/verif-conditions-chiffrage.mjs
import assert from "node:assert/strict";
import {
  calculerOuvrage, creerSnapshotOuvrage, differencesSnapshot, appliquerActualisation, totauxDevis, CALCUL_VERSION,
} from "../src/Renovation/chiffragePricing.mjs";
import {
  CONDITIONS_DEFAUT, MODE_GLOBAL, MODE_OUVRAGE, SOURCE_GLOBAL, SOURCE_OUVRAGE,
  lireConditionsProjet, conditionsActives, chiffrageModifiable, recalculerLigneConditions, simulerConditions,
  origineLigne, decrireConditionsLigne, valeurPlusRecente, libelleCondition, resumerSimulation,
} from "../src/Renovation/conditionsChiffrage.mjs";
import { construirePayloadDevisProGBat, auditerPayload, hacherPayload, CLES_INTERDITES } from "../src/Renovation/progbatQuotePayload.mjs";

// ─── Jeu de données ──────────────────────────────────────────────────────────
const TAUX = [
  { id: "t-std", libelle: "Taux standard", taux_ht: 80, actif: true, est_defaut: true },
  { id: "t-70", libelle: "Taux négocié", taux_ht: 70, actif: true, est_defaut: false },
  { id: "t-off", libelle: "Taux ancien", taux_ht: 60, actif: false, est_defaut: false },
];
const COEFS = [
  { id: "c-std", libelle: "Coefficient standard", valeur: 1.5, actif: true, est_defaut: true },
  { id: "c-13", libelle: "Coefficient client", valeur: 1.3, actif: true, est_defaut: false },
  { id: "c-off", libelle: "Coefficient ancien", valeur: 1.8, actif: false, est_defaut: false },
];
const MATS = [{ id: "m1", nom: "Placo", unite: "m²", prix_unitaire: 10 }];
// Ouvrage : 10 € matériaux, cadence 2 h, coût direct 0 → prix std = 10×1,5 + 2×80 = 175
const OUVRAGE = { id: "o1", libelle: "PLA-001 Cloison", unite: "m²", cadence: 2, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_horaire_vente_id: "t-std", coefficient_vente_id: "c-std", cout_direct_unitaire: 0 };
const CTX = { materiaux: MATS, coutHoraire: 40, tauxHoraires: TAUX, coefficientsVente: COEFS };

const projetOuvrage = { id: "p1", statut: "chiffrage", mode_coefficient: "ouvrage", mode_taux_horaire: "ouvrage", conditions_version: 0 };
const projetGlobal = { ...projetOuvrage, mode_coefficient: "global", coefficient_global_id: "c-13", coefficient_global_valeur: 1.3, coefficient_global_libelle: "Coefficient client",
  mode_taux_horaire: "global", taux_horaire_global_id: "t-70", taux_horaire_global_valeur: 70, taux_horaire_global_libelle: "Taux négocié", conditions_version: 2 };
const condGlobal = lireConditionsProjet(projetGlobal);
const condCoefSeul = { coefficient: condGlobal.coefficient, tauxHoraire: CONDITIONS_DEFAUT.tauxHoraire };
const condTauxSeul = { coefficient: CONDITIONS_DEFAUT.coefficient, tauxHoraire: condGlobal.tauxHoraire };

// ─── 1. Lecture des conditions figées ────────────────────────────────────────
{
  const c = lireConditionsProjet(projetOuvrage);
  assert.equal(c.coefficient.mode, MODE_OUVRAGE); assert.equal(c.tauxHoraire.mode, MODE_OUVRAGE);
  assert.equal(conditionsActives(c), false);
  assert.equal(lireConditionsProjet(null).coefficient.mode, MODE_OUVRAGE, "projet absent ⇒ mode ouvrage");
  assert.equal(condGlobal.coefficient.mode, MODE_GLOBAL); assert.equal(condGlobal.coefficient.valeur, 1.3); assert.equal(condGlobal.coefficient.id, "c-13");
  assert.equal(condGlobal.tauxHoraire.valeur, 70); assert.equal(conditionsActives(condGlobal), true);
  // Valeur figée sur le projet : la liste des Réglages ne compte pas
  const cModif = lireConditionsProjet({ ...projetGlobal, coefficient_global_valeur: 1.3 });
  assert.equal(cModif.coefficient.valeur, 1.3);
  // Mode global mais valeur absente ⇒ retombe en mode ouvrage (jamais inventée)
  assert.equal(lireConditionsProjet({ ...projetGlobal, coefficient_global_valeur: null }).coefficient.mode, MODE_OUVRAGE);
  assert.equal(libelleCondition(condGlobal.coefficient, "coefficient"), "Coefficient client — 1,30");
  assert.equal(libelleCondition(condGlobal.tauxHoraire, "taux"), "Taux négocié — 70,00 € HT/h");
  assert.equal(libelleCondition(CONDITIONS_DEFAUT.coefficient, "coefficient"), "Coefficient de chaque ouvrage");
}

// ─── 2. Quatre combinaisons sur une NOUVELLE ligne ───────────────────────────
{
  const sans = calculerOuvrage(OUVRAGE, CTX);
  assert.equal(sans.prixVenteUnitaire, 175);
  assert.equal(sans.conditions.coefficient.source, SOURCE_OUVRAGE); assert.equal(sans.conditions.tauxHoraire.source, SOURCE_OUVRAGE);

  const a = calculerOuvrage(OUVRAGE, { ...CTX, conditions: CONDITIONS_DEFAUT });           // ouvrage / ouvrage
  assert.equal(a.prixVenteUnitaire, 175);
  const b = calculerOuvrage(OUVRAGE, { ...CTX, conditions: condCoefSeul });                // global / ouvrage
  assert.equal(b.prixVenteUnitaire, 10 * 1.3 + 2 * 80);   // 173
  assert.equal(b.coefVente, 1.3); assert.equal(b.tauxHoraire.valeur, 80);
  assert.equal(b.conditions.coefficient.source, SOURCE_GLOBAL); assert.equal(b.conditions.tauxHoraire.source, SOURCE_OUVRAGE);
  const c = calculerOuvrage(OUVRAGE, { ...CTX, conditions: condTauxSeul });                // ouvrage / global
  assert.equal(c.prixVenteUnitaire, 10 * 1.5 + 2 * 70);   // 155
  assert.equal(c.coefVente, 1.5); assert.equal(c.tauxHoraire.valeur, 70);
  const d = calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal });                  // global / global
  assert.equal(d.prixVenteUnitaire, 10 * 1.3 + 2 * 70);   // 153
  assert.equal(d.prixMateriauxUnitaire, 13); assert.equal(d.prixMainOeuvreUnitaire, 140);
  // Origine figée (paramètres de l'ouvrage) conservée même en global
  assert.equal(d.conditions.coefficient.origine.id, "c-std"); assert.equal(d.conditions.coefficient.origine.valeur, 1.5); assert.equal(d.conditions.coefficient.origine.libelle, "Coefficient standard");
  assert.equal(d.conditions.tauxHoraire.origine.id, "t-std"); assert.equal(d.conditions.tauxHoraire.origine.valeur, 80);
  assert.equal(d.conditions.coefficient.globalId, "c-13"); assert.equal(d.conditions.tauxHoraire.globalId, "t-70");
  // Coût / marge : coûts inchangés, marge recalculée
  assert.equal(d.coutTotalUnitaire, sans.coutTotalUnitaire);
  assert.ok(d.tauxMargePct < sans.tauxMargePct);
  // Global sur un ouvrage dont le taux d'origine est introuvable : prix calculable, origine null + avertissement
  const orphelin = calculerOuvrage({ ...OUVRAGE, taux_horaire_vente_id: "t-inconnu" }, { ...CTX, conditions: condGlobal });
  assert.equal(orphelin.prixVenteUnitaire, 153); assert.equal(orphelin.conditions.tauxHoraire.origine.valeur, null);
  assert.ok(orphelin.avertissements.some(x => /retour aux paramètres de l'ouvrage impossible/.test(x)));
  // Sans global, le même ouvrage est bloquant (inchangé)
  assert.equal(calculerOuvrage({ ...OUVRAGE, taux_horaire_vente_id: "t-inconnu" }, CTX).prixVenteUnitaire, null);
  // Le coût direct garde le coefficient appliqué (comportement historique)
  const cd = calculerOuvrage({ ...OUVRAGE, cout_direct_unitaire: 10 }, { ...CTX, conditions: condCoefSeul });
  assert.equal(cd.prixDirectUnitaire, 13); assert.equal(cd.prixVenteUnitaire, 13 + 13 + 160);
}

// ─── 3. Snapshot d'une nouvelle ligne : origine ET appliqué figés ─────────────
const DATE = new Date("2026-09-16T10:00:00.000Z");
const snapGlobal = creerSnapshotOuvrage(OUVRAGE, calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal }), { zone: "Cuisine", quantite: "2", tvaPct: 10, date: DATE });
const snapOuvrage = creerSnapshotOuvrage(OUVRAGE, calculerOuvrage(OUVRAGE, CTX), { zone: "Cuisine", quantite: "2", tvaPct: 10, date: DATE });
{
  assert.equal(snapGlobal.prix_unitaire, 153);
  assert.equal(snapGlobal.coef_vente, 1.3, "coef_vente = appliqué");
  assert.equal(snapGlobal.coefficient_vente_id, "c-std", "coefficient_vente_id = origine");
  assert.equal(snapGlobal.coefficient_source, SOURCE_GLOBAL); assert.equal(snapGlobal.coefficient_global_id, "c-13");
  assert.equal(snapGlobal.coefficient_origine_valeur, 1.5); assert.equal(snapGlobal.coefficient_origine_libelle, "Coefficient standard");
  assert.equal(snapGlobal.taux_horaire_vente, 70); assert.equal(snapGlobal.taux_horaire_vente_id, "t-std");
  assert.equal(snapGlobal.taux_horaire_source, SOURCE_GLOBAL); assert.equal(snapGlobal.taux_horaire_global_id, "t-70");
  assert.equal(snapGlobal.taux_horaire_origine_valeur, 80); assert.equal(snapGlobal.taux_horaire_origine_libelle, "Taux standard");
  assert.equal(snapGlobal.calcul_detail.coefficient_applique.source, SOURCE_GLOBAL); assert.equal(snapGlobal.calcul_detail.coefficient_applique.valeur, 1.3);
  assert.equal(snapGlobal.calcul_detail.coefficient_origine.valeur, 1.5); assert.equal(snapGlobal.calcul_detail.taux_origine.valeur, 80);
  assert.equal(snapGlobal.calcul_detail.taux_applique.libelle, "Taux négocié");
  assert.equal(snapGlobal.calcul_version, `${CALCUL_VERSION}@${DATE.toISOString()}`);
  // Coûts identiques entre les deux snapshots : seuls les prix bougent
  ["cout_materiaux_unitaire", "cout_main_oeuvre_unitaire", "cout_direct_unitaire", "cout_total_unitaire", "unite", "quantite", "zone"].forEach(k => assert.deepEqual(snapGlobal[k], snapOuvrage[k], k));
  assert.equal(snapOuvrage.coefficient_source, SOURCE_OUVRAGE); assert.equal(snapOuvrage.coefficient_global_id, null); assert.equal(snapOuvrage.coef_vente, 1.5);
  assert.equal(snapOuvrage.coefficient_origine_valeur, 1.5); assert.equal(snapOuvrage.taux_horaire_origine_valeur, 80);
  // Actualisation depuis la bibliothèque AVEC les conditions : pas de fausse différence
  assert.deepEqual(differencesSnapshot({ id: "l1", ...snapGlobal }, OUVRAGE, calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal })), []);
  // …et SANS les conditions, la différence apparaît (le coef appliqué 1,3 vs 1,5) — l'appelant doit passer les conditions
  assert.ok(differencesSnapshot({ id: "l1", ...snapGlobal }, OUVRAGE, calculerOuvrage(OUVRAGE, CTX)).some(x => x.champ === "coef_vente"));
  const patch = appliquerActualisation({ id: "l1", ...snapGlobal }, OUVRAGE, calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal }), { date: DATE });
  assert.equal(patch.prix_unitaire, 153); assert.equal(patch.coefficient_source, SOURCE_GLOBAL); assert.equal("quantite" in patch, false);
}

// ─── 4. Recalcul d'une ligne EXISTANTE depuis ses seules données figées ───────
const ligneV2 = { id: "l1", item: "Cloison", zone: "Cuisine", ...snapOuvrage };   // ligne v2 antérieure aux conditions (source = null)
delete ligneV2.coefficient_source; delete ligneV2.taux_horaire_source; delete ligneV2.coefficient_origine_valeur; delete ligneV2.taux_horaire_origine_valeur;
{
  const orig = origineLigne(ligneV2);
  assert.equal(orig.coefficient.valeur, 1.5); assert.equal(orig.coefficient.id, "c-std"); assert.equal(orig.tauxHoraire.valeur, 80); assert.equal(orig.tauxHoraire.libelle, "Taux standard");

  // Ligne modifiée à la main : coût matériaux figé 20 (≠ bibliothèque 10) et cadence figée 3 h — seules ces valeurs comptent
  const figee = { ...ligneV2, cout_materiaux_unitaire: 20, cout_total_unitaire: 20 + 3 * 40, calcul_detail: { ...ligneV2.calcul_detail, heures_unitaires: 3 }, prix_unitaire: 20 * 1.5 + 3 * 80 };
  const r = recalculerLigneConditions(figee, condGlobal, { date: DATE });
  assert.equal(r.ok, true);
  assert.equal(r.patch.prix_unitaire, 20 * 1.3 + 3 * 70);   // 236 : données FIGÉES, pas la bibliothèque
  assert.equal(r.patch.coef_vente, 1.3); assert.equal(r.patch.taux_horaire_vente, 70);
  assert.equal(r.patch.coefficient_source, SOURCE_GLOBAL); assert.equal(r.patch.taux_horaire_source, SOURCE_GLOBAL);
  assert.equal(r.patch.coefficient_origine_valeur, 1.5); assert.equal(r.patch.taux_horaire_origine_valeur, 80);
  assert.equal(r.patch.coefficient_global_id, "c-13"); assert.equal(r.patch.taux_horaire_global_id, "t-70");
  assert.equal(r.patch.calcul_detail.prix_materiaux_unitaire, 26); assert.equal(r.patch.calcul_detail.prix_main_oeuvre_unitaire, 210);
  assert.equal(r.patch.calcul_detail.heures_unitaires, 3, "cadence figée conservée");
  assert.equal(r.patch.taux_marge_pct, Math.round((236 - 140) / 236 * 10000) / 100);
  // Rien d'autre dans le patch : coûts, quantités, unité, zone jamais touchés
  ["cout_materiaux_unitaire", "cout_main_oeuvre_unitaire", "cout_direct_unitaire", "cout_total_unitaire", "quantite", "unite", "zone", "item", "bibliotheque_id"].forEach(k => assert.equal(k in r.patch, false, `${k} absent du patch`));
  assert.equal(r.patch.calcul_version.startsWith("2@"), true);

  // Coefficient seul : le taux reste celui de l'ouvrage (origine)
  const rc = recalculerLigneConditions(figee, condCoefSeul, { date: DATE });
  assert.equal(rc.patch.prix_unitaire, 26 + 240); assert.equal(rc.patch.taux_horaire_source, SOURCE_OUVRAGE); assert.equal(rc.patch.taux_horaire_vente, 80);
  // Taux seul
  const rt = recalculerLigneConditions(figee, condTauxSeul, { date: DATE });
  assert.equal(rt.patch.prix_unitaire, 30 + 210); assert.equal(rt.patch.coefficient_source, SOURCE_OUVRAGE); assert.equal(rt.patch.coef_vente, 1.5);

  // RETOUR aux paramètres de chaque ouvrage : depuis la ligne recalculée en global, on retrouve EXACTEMENT l'origine figée
  const enGlobal = { ...figee, ...r.patch };
  const retour = recalculerLigneConditions(enGlobal, CONDITIONS_DEFAUT, { date: DATE });
  assert.equal(retour.ok, true);
  assert.equal(retour.patch.prix_unitaire, figee.prix_unitaire);   // 270
  assert.equal(retour.patch.coef_vente, 1.5); assert.equal(retour.patch.taux_horaire_vente, 80);
  assert.equal(retour.patch.coefficient_source, SOURCE_OUVRAGE); assert.equal(retour.patch.coefficient_global_id, null); assert.equal(retour.patch.taux_horaire_global_id, null);
  assert.equal(retour.patch.coefficient_origine_valeur, 1.5, "origine conservée après retour");
  // Une ligne recalculée en global dont l'origine manque : retour refusé, rien d'inventé
  const sansOrigine = { ...enGlobal, coefficient_origine_valeur: null, calcul_detail: { ...enGlobal.calcul_detail, coefficient_origine: { id: null, valeur: null, libelle: null }, coefficient_vente_libelle: null } };
  const rr = recalculerLigneConditions(sansOrigine, CONDITIONS_DEFAUT);
  assert.equal(rr.ok, false); assert.match(rr.raison, /coefficient d'origine de l'ouvrage absent/);
  // …mais reste recalculable en global coefficient (l'origine n'est pas requise)
  assert.equal(recalculerLigneConditions(sansOrigine, condCoefSeul).ok, true);

  // Lignes NON recalculables : v1 (ancienne formule), incomplète, prix saisi
  const v1 = { ...figee, calcul_version: "1@2026-01-01T00:00:00.000Z", calcul_detail: { version: 1, coef_vente: 1.55 } };
  const rv1 = recalculerLigneConditions(v1, condGlobal);
  assert.equal(rv1.ok, false); assert.match(rv1.raison, /ancienne formule \(v1\)/);
  const incomplete = { ...figee, calcul_detail: { ...figee.calcul_detail, heures_unitaires: null } };
  assert.match(recalculerLigneConditions(incomplete, condGlobal).raison, /incomplète/);
  const saisie = { id: "l9", item: "Ancien", quantite: "1", prix_unitaire: 100 };
  const rs = recalculerLigneConditions(saisie, condGlobal);
  assert.equal(rs.ok, false); assert.equal(rs.horsPerimetre, true);
  // Valeur de condition invalide ⇒ jamais appliquée (retombe sur l'origine)
  const invalide = recalculerLigneConditions(figee, { coefficient: { mode: MODE_GLOBAL, id: "x", valeur: 0 }, tauxHoraire: CONDITIONS_DEFAUT.tauxHoraire });
  assert.equal(invalide.patch.coef_vente, 1.5); assert.equal(invalide.patch.coefficient_source, SOURCE_OUVRAGE);
}

// ─── 5. Simulation : totaux, marges, lignes ignorées ─────────────────────────
{
  const l1 = { ...ligneV2, id: "l1", quantite: "2" };                                          // 2 × 175 = 350, coût 2 × 90
  const l2 = { ...ligneV2, id: "l2", quantite: "1", zone: "Salon" };                          // 175
  const v1 = { ...ligneV2, id: "l3", quantite: "1", prix_unitaire: 49.85, calcul_version: "1@x", calcul_detail: { version: 1 } };
  const saisie = { id: "l4", item: "Ancien", quantite: "3", prix_unitaire: 100 };            // 300, coût inconnu
  const sim = simulerConditions([l1, l2, v1, saisie], condGlobal, { date: DATE });
  assert.equal(sim.nbLignesRecalculees, 2); assert.equal(sim.nbLignesIgnorees, 1); assert.equal(sim.nbLignesSansSnapshot, 1);
  assert.equal(sim.totalHTAvant, 350 + 175 + 49.85 + 300);
  assert.equal(sim.totalHTApres, 2 * 153 + 153 + 49.85 + 300);
  assert.equal(sim.ecartHT, Math.round((sim.totalHTApres - sim.totalHTAvant) * 100) / 100);
  assert.equal(sim.margeConnue, false, "une ligne sans coût ⇒ marge non calculable");
  assert.match(sim.ignorees[0].raison, /v1/);
  // Sans la ligne à prix saisi : marge connue avant / après
  const sim2 = simulerConditions([l1, l2], condGlobal, { date: DATE });
  assert.equal(sim2.margeConnue, true);
  assert.equal(sim2.margeAvant, 3 * (175 - 90)); assert.equal(sim2.margeApres, 3 * (153 - 90));
  assert.equal(sim2.margeAvantPct, Math.round(255 / 525 * 10000) / 100);
  // Simulation neutre (mêmes conditions) ⇒ aucun écart
  const neutre = simulerConditions([l1, l2], CONDITIONS_DEFAUT, { date: DATE });
  assert.equal(neutre.ecartHT, 0); assert.equal(neutre.nbLignesRecalculees, 2);
  // La simulation ne modifie pas les lignes d'entrée
  assert.equal(l1.prix_unitaire, 175); assert.equal(l1.coef_vente, 1.5);
  // totauxDevis lit prix_unitaire figé : cohérent avec la simulation
  const apres = [l1, l2].map(l => ({ ...l, ...recalculerLigneConditions(l, condGlobal).patch }));
  assert.equal(totauxDevis(apres, { tvaPctDefaut: 10 }).venteHT, 3 * 153);
  // Résumé d'un résultat RPC
  const res = resumerSimulation({ nb_lignes_recalculees: 2, nb_lignes_ignorees: 1, nb_lignes_sans_snapshot: 0, total_ht_avant: "525.00", total_ht_apres: "459.00", ecart_ht: "-66.00", marge_avant: "255.00", marge_apres: "189.00", marge_avant_pct: "48.57", marge_apres_pct: "41.18", version_attendue: 2, hash_lignes: "abc", avertissements: ["x"], lignes_ignorees: [{ id: 1 }], avant: {}, apres: {} });
  assert.equal(res.totalApres, 459); assert.equal(res.version, 2); assert.equal(res.hash, "abc"); assert.equal(res.ignorees.length, 1);
}

// ─── 6. Verrous, affichage, valeur plus récente ──────────────────────────────
{
  assert.equal(chiffrageModifiable(projetOuvrage).ok, true);
  const signe = chiffrageModifiable({ ...projetOuvrage, statut: "signe" });
  assert.equal(signe.ok, false); assert.match(signe.motif, /signé/);
  const devis = chiffrageModifiable({ ...projetOuvrage, progbat_devis_id: "453" });
  assert.equal(devis.ok, true); assert.ok(devis.avertissements.some(a => /brouillon ProGBat existe déjà.*ne sera pas actualisé/.test(a)));
  assert.ok(chiffrageModifiable({ ...projetOuvrage, statut: "devis_envoye" }).avertissements.length > 0);

  const desc = decrireConditionsLigne({ ...ligneV2, ...recalculerLigneConditions(ligneV2, condGlobal).patch });
  assert.equal(desc.global, true); assert.equal(desc.coefficient.source, SOURCE_GLOBAL); assert.equal(desc.coefficient.origine, 1.5);
  assert.ok(desc.lignes.some(x => x === "Coefficient appliqué : 1,30 — condition globale du chiffrage"));
  assert.ok(desc.lignes.some(x => x === "Coefficient d'origine : 1,50"));
  assert.ok(desc.lignes.some(x => /Taux horaire appliqué : 70,00 € HT\/h — condition globale/.test(x)));
  assert.match(desc.court, /× 1,30 · 70,00 €\/h · global/);
  const descO = decrireConditionsLigne(ligneV2);
  assert.equal(descO.global, false); assert.ok(descO.lignes.some(x => x === "Coefficient ouvrage : 1,50"));
  assert.equal(decrireConditionsLigne({ id: "x", prix_unitaire: 100 }).lignes.length, 0);

  // Valeur plus récente dans les Réglages : signalée, jamais appliquée automatiquement
  assert.equal(valeurPlusRecente(condGlobal.coefficient, COEFS, "valeur"), null);
  const plusRecent = valeurPlusRecente(condGlobal.coefficient, COEFS.map(c => c.id === "c-13" ? { ...c, valeur: 1.35 } : c), "valeur");
  assert.equal(plusRecent.type, "valeur"); assert.equal(plusRecent.actuelle, 1.35); assert.equal(plusRecent.figee, 1.3); assert.match(plusRecent.message, /1,35.*figé : 1,30/);
  const desactive = valeurPlusRecente(condGlobal.tauxHoraire, TAUX.map(t => t.id === "t-70" ? { ...t, actif: false } : t), "taux_ht");
  assert.equal(desactive.type, "desactive"); assert.match(desactive.message, /désactivée/);
  assert.equal(valeurPlusRecente(condGlobal.tauxHoraire, [], "taux_ht").type, "introuvable");
  assert.equal(valeurPlusRecente(CONDITIONS_DEFAUT.coefficient, COEFS, "valeur"), null);
}

// ─── 7. ProGBat : prix figé uniquement, hash sensible aux conditions, clés interdites ──
{
  const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }, { id: 706, rate: 20, label: "20 %", saleDefault: false }];
  const LIAISONS = { 42: { progbat_id: 777, existe: true } };
  const projet = { client_nom: "Test", client_prenom: "A", client_adresse: "1 rue", client_code_postal: "49000", client_ville: "Angers", client_pays: "France", logement_reference: "Lot 12", tva_pct: 10, devis_objet: "Travaux", devis_validite: "2026-10-31" };
  const lignesAvant = [{ ...ligneV2, id: "l1", projet_id: "P1", bibliotheque_id: 42, quantite: "2", category: "Plaquiste", tva_pct: 10 }];
  const lignesApres = lignesAvant.map(l => ({ ...l, ...recalculerLigneConditions(l, condGlobal).patch }));
  const opts = { projet, lotsOrdre: ["Plaquiste"], taxes: TAXES, liaisons: LIAISONS, aujourdHui: DATE };
  const pA = construirePayloadDevisProGBat({ ...opts, lignes: lignesAvant });
  const pB = construirePayloadDevisProGBat({ ...opts, lignes: lignesApres });
  const jsonA = JSON.stringify(pA.payload), jsonB = JSON.stringify(pB.payload);
  assert.ok(/175/.test(jsonA) && !/153/.test(jsonA), "aperçu avant = prix figé 175");
  assert.ok(/153/.test(jsonB) && !/175/.test(jsonB), "aperçu après = nouveau prix figé 153");
  const [hA, hB] = await Promise.all([hacherPayload(pA.payload), hacherPayload(pB.payload)]);
  assert.notEqual(hA, hB, "le hash change ⇒ l'ancien aperçu est invalidé");
  // Même elementId (liaison ouvrage ProGBat inchangée) avant / après
  assert.ok(/"elementId":777/.test(jsonA) && /"elementId":777/.test(jsonB));
  // Aucun champ interne dans le payload
  assert.deepEqual(CLES_INTERDITES.filter(k => new RegExp(`"${k}"`).test(jsonB)), []);
  ["coefficient_source", "coefficient_origine_valeur", "coefficient_global_id", "taux_horaire_source", "taux_horaire_global_id", "mode_coefficient", "conditions_version"].forEach(k => assert.ok(CLES_INTERDITES.includes(k), `${k} interdit`));
  assert.equal(/global_chiffrage|Coefficient client|Taux négocié/.test(jsonB), false, "ni source ni libellé de condition transmis");
  assert.deepEqual(auditerPayload(pB.payload, { elementIdsAutorises: [777] }).filter(e => e.code === "cle_interdite"), []);
}

console.log("verif-conditions-chiffrage : OK (conditions figées, 4 combinaisons, snapshots origine/appliqué, recalcul depuis données figées, retour ouvrage, lignes non recalculables, simulation totaux/marges, verrous, affichage, ProGBat prix figé + hash)");
