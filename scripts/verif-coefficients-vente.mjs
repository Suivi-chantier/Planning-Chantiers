#!/usr/bin/env node
// Vérifie les règles pures des coefficients de vente
// (src/Renovation/coefficientsVente.mjs + referentielVente.mjs) et leur prise en
// compte par le chiffrage et le devis ProGBat (prix figé jamais recalculé).
//   node scripts/verif-coefficients-vente.mjs
// Les garanties BASE (unicité du défaut, triggers, colonnes obsolètes figées,
// RLS) sont vérifiées par scripts/verif-coefficients-vente.sql (se rétracte).
import assert from "node:assert/strict";

const c = await import(new URL("../src/Renovation/coefficientsVente.mjs", import.meta.url).href);
const t = await import(new URL("../src/Renovation/tauxHorairesVente.mjs", import.meta.url).href);
const p = await import(new URL("../src/Renovation/chiffragePricing.mjs", import.meta.url).href);
const q = await import(new URL("../src/Renovation/progbatQuotePayload.mjs", import.meta.url).href);
const inv = await import(new URL("../src/Renovation/progbatInventaire.mjs", import.meta.url).href);

const STANDARD = { id: "c1", libelle: "Coefficient standard", valeur: 1.5, est_defaut: true, actif: true };
const REDUIT   = { id: "c2", libelle: "Coefficient réduit", valeur: 1.3, est_defaut: false, actif: true };
const RENFORCE = { id: "c3", libelle: "Coefficient renforcé", valeur: 1.8, est_defaut: false, actif: true };
const ANCIEN   = { id: "c4", libelle: "Ancien coefficient", valeur: 1.2, est_defaut: false, actif: false };
const LISTE = [REDUIT, ANCIEN, RENFORCE, STANDARD];
const TAUX = [{ id: "t1", libelle: "Taux standard", taux_ht: 80, est_defaut: true, actif: true }, { id: "t2", libelle: "Chef d'équipe", taux_ht: 95, est_defaut: false, actif: true }];

// ── 1 & 4. Coefficient standard : 1,50, formatage ──────────────────────────
assert.deepEqual(c.COEFFICIENT_STANDARD, { libelle: "Coefficient standard", valeur: 1.5 });
assert.equal(c.formaterCoefficient(1.5), "1,50");
assert.equal(c.formaterCoefficient(1.3), "1,30");
assert.equal(c.formaterCoefficient(1.675), "1,675");
assert.equal(c.formaterCoefficient(1.2345), "1,2345");
assert.equal(c.formaterCoefficient(null), "—");
assert.equal(c.libelleCoefficient(STANDARD), "Coefficient standard — 1,50");
assert.equal(c.libelleCoefficient(REDUIT), "Coefficient réduit — 1,30");
assert.equal(c.libelleCoefficient(RENFORCE), "Coefficient renforcé — 1,80");
assert.equal(c.libelleCoefficient(ANCIEN), "Ancien coefficient — 1,20 (désactivé)");
assert.equal(c.expliquerPrixMateriaux(100, 1.5), "100,00 € × 1,50 = 150,00 € HT");
assert.equal(c.expliquerPrixMateriaux(10.9, 1.35), "10,90 € × 1,35 = 14,72 € HT");
assert.equal(c.expliquerPrixMateriaux(null, 1.5), null);

// ── Lecture de la liste : défaut, actifs, tri, diagnostic ─────────────────
assert.equal(c.coefficientParDefaut(LISTE).id, "c1");
assert.equal(c.coefficientParDefaut([]), null);
assert.equal(c.coefficientParDefaut([{ ...STANDARD, actif: false }]), null);
assert.deepEqual(c.coefficientsActifs(LISTE).map(x => x.id), ["c1", "c2", "c3"], "défaut d'abord, puis libellé ; inactifs exclus");
assert.equal(c.diagnostiquerCoefficients(LISTE).ok, true);
assert.equal(c.diagnostiquerCoefficients([]).ok, false);
assert.ok(c.diagnostiquerCoefficients([REDUIT]).problemes.some(m => /Aucun coefficient par défaut/.test(m)));
// 5. deux défauts : incohérence détectée (la base la refuse par index unique)
assert.ok(c.diagnostiquerCoefficients([STANDARD, { ...REDUIT, est_defaut: true }]).problemes.some(m => /Plusieurs coefficients de vente par défaut/.test(m)));

// ── 16, 17, 18. Liste déroulante de la fiche ouvrage ───────────────────────
assert.equal(c.coefficientSelectionne(LISTE, null), "c1", "création : 1,50 présélectionné");
assert.equal(c.coefficientSelectionne(LISTE, "c3"), "c3", "modification : coefficient enregistré");
assert.equal(c.coefficientSelectionne(LISTE, "c4"), "c4", "coefficient désactivé conservé");
assert.equal(c.coefficientSelectionne(LISTE, "zz"), "c1");
assert.deepEqual(c.optionsSelectCoefficients(LISTE, null).map(o => o.texte), ["Coefficient standard — 1,50", "Coefficient réduit — 1,30", "Coefficient renforcé — 1,80"], "seuls les actifs sont proposés");
const optsInactif = c.optionsSelectCoefficients(LISTE, "c4");
assert.deepEqual(optsInactif.map(o => o.id), ["c1", "c2", "c3", "c4"]);
assert.equal(optsInactif.find(o => o.id === "c4").desactive, true);
assert.match(optsInactif.find(o => o.id === "c4").texte, /désactivé/);
// Duplication : reprise du coefficient de la source s'il est actif, sinon défaut (logique de la page)
const reprise = (src) => { const s = LISTE.find(x => x.id === src); return s && s.actif !== false ? s.id : c.coefficientSelectionne(LISTE, null); };
assert.equal(reprise("c3"), "c3", "duplication : coefficient repris");
assert.equal(reprise("c4"), "c1", "duplication d'un ouvrage à coefficient désactivé : défaut");
// 13, 14, 15. Enregistrement : référence obligatoire, existante, active (sauf conservation)
assert.equal(c.validerCoefficientOuvrage(LISTE, "c2").valide, true);
assert.match(c.validerCoefficientOuvrage(LISTE, null).erreur, /obligatoire/);
assert.match(c.validerCoefficientOuvrage(LISTE, "zz").erreur, /inconnu/, "identifiant inexistant refusé");
assert.match(c.validerCoefficientOuvrage(LISTE, "c4").erreur, /désactivé/, "coefficient inactif refusé pour une nouvelle sélection");
assert.equal(c.validerCoefficientOuvrage(LISTE, "c4", "c4").valide, true, "coefficient inactif conservé s'il était déjà celui de l'ouvrage");

// ── 8, 9, 10, 12. Saisie d'un coefficient ──────────────────────────────────
assert.deepEqual(c.validerSaisieCoefficient({ libelle: "  Coefficient réduit 2 ", valeur: "1,25" }, LISTE).valeur, { libelle: "Coefficient réduit 2", valeur: 1.25 });
assert.equal(c.validerSaisieCoefficient({ libelle: "X", valeur: "1,675" }, LISTE).valeur.valeur, 1.675, "3 décimales acceptées");
assert.equal(c.validerSaisieCoefficient({ libelle: "", valeur: 1.5 }, LISTE).valide, false);
for (const v of [null, "", "abc", 0, -1.5, "-2"]) {
  const r = c.validerSaisieCoefficient({ libelle: "X", valeur: v }, LISTE);
  assert.equal(r.valide, false, `coefficient ${String(v)} refusé`);
  assert.ok(r.erreurs.some(e => /coefficient/i.test(e)));
}
assert.ok(c.validerSaisieCoefficient({ libelle: "coefficient STANDARD", valeur: 1.4 }, LISTE).erreurs.some(e => /existe déjà/.test(e)));
assert.equal(c.validerSaisieCoefficient({ libelle: "Coefficient standard", valeur: 1.6 }, LISTE, "c1").valide, true, "modification du coefficient lui-même : pas un doublon");

// ── 6, 7, 11. Désactivation / réactivation / défaut ────────────────────────
assert.equal(c.peutDesactiverCoefficient(REDUIT, LISTE).ok, true);
assert.equal(c.peutDesactiverCoefficient(STANDARD, LISTE).ok, false, "le coefficient par défaut ne se désactive pas sans remplacement");
assert.match(c.peutDesactiverCoefficient(STANDARD, LISTE).raison, /par défaut/);
assert.equal(c.peutDesactiverCoefficient(REDUIT, [REDUIT, ANCIEN]).ok, false, "dernier coefficient actif");
assert.equal(c.peutReactiverCoefficient(ANCIEN).ok, true);
assert.equal(c.peutReactiverCoefficient(REDUIT).ok, false);
assert.equal(c.peutDefinirCoefficientDefaut(REDUIT).ok, true);
assert.equal(c.peutDefinirCoefficientDefaut(STANDARD).ok, false);
assert.equal(c.peutDefinirCoefficientDefaut(ANCIEN).ok, false, "un coefficient désactivé ne peut pas devenir le défaut");

// ── Avertissement (nombre réel d'ouvrages) ─────────────────────────────────
assert.equal(c.avertissementModificationCoefficient(STANDARD, 1.5), null, "valeur inchangée ⇒ pas d'avertissement");
assert.equal(c.avertissementModificationCoefficient(STANDARD, "1,50"), null);
const av = c.avertissementModificationCoefficient(STANDARD, 1.6, { nbOuvrages: 105 });
assert.match(av, /^Ce coefficient est utilisé par 105 ouvrages\.\n\n/);
assert.match(av, /1,50 → 1,60/);
assert.match(av, /recalculera leur prix de vente pour les futurs chiffrages\. Les lignes et devis déjà figés ne seront pas modifiés\./);

// ── 32. Erreurs Supabase : jamais silencieuses ─────────────────────────────
assert.match(c.messageErreurCoefficients({ code: "42501", message: "new row violates row-level security policy" }), /réservée aux administrateurs/);
assert.match(c.messageErreurCoefficients({ code: "23505", message: 'duplicate key value violates unique constraint "coefficients_vente_un_seul_defaut_uidx"' }), /déjà un coefficient par défaut/);
assert.match(c.messageErreurCoefficients({ code: "23505", message: 'duplicate key value violates unique constraint "coefficients_vente_libelle_uidx"' }), /déjà ce libellé/);
assert.match(c.messageErreurCoefficients({ code: "23514", message: 'violates check constraint "coefficients_vente_valeur_check"' }), /supérieur à zéro/);
assert.match(c.messageErreurCoefficients({ code: "P0001", message: "Le coefficient par défaut ne peut pas être désactivé : définir d'abord un autre coefficient actif par défaut." }), /ne peut pas être désactivé/);
assert.match(c.messageErreurCoefficients({ code: "P0001", message: "Colonnes obsolètes : coef_vente et taux_marge_pct ne sont plus modifiables, utiliser coefficient_vente_id." }), /Colonnes obsolètes/);
assert.match(c.messageErreurCoefficients({ message: "TypeError: Failed to fetch" }), /Rien n'a été enregistré/);
assert.equal(c.messageErreurCoefficients(null), null);
// Le référentiel des taux partage la même fabrique et garde ses messages
assert.match(t.messageErreurSupabase({ code: "23514", message: 'violates check constraint "taux_horaires_vente_taux_ht_check"' }), /taux HT\/h/);

// ── 19 → 24. Calcul : coefficient sur les matériaux, taux sur la MO ────────
const MAT = [{ id: "m1", nom: "Kit", unite: "U", prix_unitaire: 100 }];
const CTX = { materiaux: MAT, coutHoraire: 40.62, tauxHoraires: TAUX, coefficientsVente: LISTE };
const ouvrage = { id: "o1", libelle: "T-001 : Référence", unite: "U", cadence: 2.5, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_horaire_vente_id: "t1", coefficient_vente_id: c.coefficientSelectionne(LISTE, null) };
assert.equal(ouvrage.coefficient_vente_id, "c1", "création : coefficient par défaut");
const k1 = p.calculerOuvrage(ouvrage, CTX);
assert.equal(k1.prixMateriauxUnitaire, 150, "100 × 1,50");
assert.equal(k1.prixMainOeuvreUnitaire, 200, "2,5 × 80");
assert.equal(k1.prixVenteUnitaire, 350, "exemple de la spécification");
assert.equal(k1.coefficient.libelle, "Coefficient standard");
assert.equal(k1.complet, true);
// 18/19. Changement de coefficient ⇒ recalcul immédiat, MO inchangée
const k2 = p.calculerOuvrage({ ...ouvrage, coefficient_vente_id: "c3" }, CTX);
assert.equal(k2.prixMateriauxUnitaire, 180);
assert.equal(k2.prixMainOeuvreUnitaire, 200, "le coefficient n'affecte pas la main-d'œuvre");
assert.equal(k2.prixVenteUnitaire, 380);
// 22/23. Changement de taux ⇒ MO seule change ; coefficient × taux combinés
const k3 = p.calculerOuvrage({ ...ouvrage, taux_horaire_vente_id: "t2" }, CTX);
assert.equal(k3.prixMateriauxUnitaire, 150, "le taux n'affecte pas les matériaux");
assert.equal(k3.prixMainOeuvreUnitaire, 237.5);
assert.equal(k3.prixVenteUnitaire, 387.5);
const k4 = p.calculerOuvrage({ ...ouvrage, coefficient_vente_id: "c2", taux_horaire_vente_id: "t2" }, CTX);
assert.equal(k4.prixVenteUnitaire, 367.5);   // 130 + 237,5
// Recalcul sur cadence et coût matériaux
assert.equal(p.calculerOuvrage({ ...ouvrage, cadence: 3 }, CTX).prixVenteUnitaire, 390);
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, materiaux: [{ id: "m1", prix_unitaire: 120 }] }).prixMateriauxUnitaire, 180);
// 21. Coût direct complémentaire : traitement CONSERVÉ (reçoit le coefficient sélectionné)
const kd = p.calculerOuvrage({ ...ouvrage, cout_direct_unitaire: 10 }, CTX);
assert.equal(kd.prixDirectUnitaire, 15, "10 × 1,50 : comportement v2 conservé");
assert.equal(kd.prixVenteUnitaire, 365);
assert.equal(p.calculerOuvrage({ ...ouvrage, cout_direct_unitaire: 10, coefficient_vente_id: "c3" }, CTX).prixDirectUnitaire, 18, "le coût direct suit le coefficient sélectionné");
// 15. Coefficient désactivé conservé : calculable + avertissement
const ki = p.calculerOuvrage({ ...ouvrage, coefficient_vente_id: "c4" }, CTX);
assert.equal(ki.complet, true);
assert.equal(ki.prixMateriauxUnitaire, 120);
assert.ok(ki.avertissements.some(a => /désactivé/.test(a)));
// 13. Identifiant inexistant ⇒ refus ; colonne obsolète coef_vente ignorée
assert.equal(p.calculerOuvrage({ ...ouvrage, coefficient_vente_id: "nope" }, CTX).complet, false);
assert.equal(p.calculerOuvrage({ ...ouvrage, coef_vente: 9, coefficient_vente_id: "c1" }, CTX).prixMateriauxUnitaire, 150, "coef_vente (obsolète) jamais lu");
// 24. Arrondis : 10,9 × 1,35 = 14,715 ⇒ 14,72 ; 33,33 × 1,5 = 49,995 ⇒ 50,00 ; 0,1 × 1,3 = 0,13 sans résidu binaire
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, materiaux: [{ id: "m1", prix_unitaire: 10.9 }], coefficientsVente: [{ ...STANDARD, valeur: 1.35 }] }).prixMateriauxUnitaire, 14.72);
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, materiaux: [{ id: "m1", prix_unitaire: 33.33 }] }).prixMateriauxUnitaire, 50);
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, materiaux: [{ id: "m1", prix_unitaire: 0.1 }], coefficientsVente: [{ ...STANDARD, valeur: 1.3 }] }).prixMateriauxUnitaire, 0.13);
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, coefficientsVente: [{ ...STANDARD, valeur: 1.675 }] }).prixMateriauxUnitaire, 167.5);

// ── 25 → 28. Snapshots : valeur figée, anciens intacts, actualisation volontaire ──
const D0 = new Date("2026-09-16T10:00:00Z");
const snap = p.creerSnapshotOuvrage(ouvrage, k1, { zone: "Séjour", tvaPct: 10, quantite: "4", date: D0 });
assert.equal(snap.coef_vente, 1.5, "VALEUR figée dans la colonne existante coef_vente");
assert.equal(snap.coefficient_vente_id, "c1", "identifiant figé");
assert.equal(snap.calcul_detail.coefficient_vente_libelle, "Coefficient standard");
assert.equal(snap.calcul_detail.coefficient_vente, 1.5);
assert.equal(snap.calcul_detail.prix_materiaux_unitaire, 150);
assert.equal(snap.prix_unitaire, 350);
// Le coefficient standard passe à 1,60 dans Réglages
const LISTE160 = LISTE.map(x => x.id === "c1" ? { ...x, valeur: 1.6, libelle: "Coefficient standard (renommé)" } : x);
const k160 = p.calculerOuvrage(ouvrage, { ...CTX, coefficientsVente: LISTE160 });
assert.equal(k160.prixVenteUnitaire, 360);
assert.equal(snap.coef_vente, 1.5, "snapshot intact : valeur");
assert.equal(snap.prix_unitaire, 350, "snapshot intact : prix");
assert.equal(snap.calcul_detail.coefficient_vente_libelle, "Coefficient standard", "snapshot intact : libellé figé malgré le renommage");
const diffs = p.differencesSnapshot(snap, ouvrage, k160);
assert.deepEqual(diffs.map(d => d.champ).sort(), ["coef_vente", "prix_unitaire", "taux_marge_pct"]);
assert.equal(diffs.find(d => d.champ === "prix_unitaire").apres, 360);
const actualisee = p.appliquerActualisation({ ...snap, id: "L1", zone: "Séjour", quantite: "4", tva_pct: 10 }, ouvrage, k160);
assert.equal(actualisee.coef_vente, 1.6, "actualisation volontaire : nouvelle valeur figée");
assert.equal(actualisee.prix_unitaire, 360);
assert.equal("zone" in actualisee, false);
// Le coefficient est désactivé ou l'ouvrage change de coefficient : le snapshot reste explicable
const snapDesactive = { ...snap, calcul_detail: { ...snap.calcul_detail } };
const LISTE_C1_OFF = LISTE.map(x => x.id === "c1" ? { ...x, actif: false } : x);
assert.equal(p.calculerOuvrage(ouvrage, { ...CTX, coefficientsVente: LISTE_C1_OFF }).complet, true, "l'ouvrage garde son coefficient désactivé");
assert.equal(snapDesactive.calcul_detail.coefficient_vente, 1.5);
assert.equal(c.expliquerPrixMateriaux(snapDesactive.cout_materiaux_unitaire, snapDesactive.coef_vente), "100,00 € × 1,50 = 150,00 € HT", "explicable depuis les seules valeurs figées");
// Ancienne ligne v1 (coefficient global 1,55 sur le coût total) : jamais réécrite, totaux inchangés
const ligneV1 = { id: "L0", bibliotheque_id: "o1", category: "Sol", zone: "Séjour", code_ouvrage: "S-001", item: "S-001 : Sol", quantite: "25", unite: "m²", prix_unitaire: 49.85, tva_pct: 10, cout_total_unitaire: 32.16, coef_vente: 1.55, taux_marge_pct: 35.48, calcul_version: "1@2026-09-14T17:43:21.289Z", calcul_detail: { version: 1, coef_vente: 1.55, mode_prix: "coefficient" } };
assert.equal(p.totalLigneHT(ligneV1), 1246.25);
assert.equal(p.totauxDevis([ligneV1, { ...snap, id: "L1", category: "Sol" }], { tvaPctDefaut: 10 }).venteHT, 1246.25 + 1400, "ancienne ligne et nouvelle ligne cohabitent sans recalcul");

// ── 29. Synchronisation ProGBat : prix COURANT de la bibliothèque ─────────
const compl = inv.verifierCompletude(ouvrage, { ...CTX, tvaDefaut: 20 });
assert.equal(compl.prix.prix_vente_ht, 350);
assert.equal(compl.prix.coefficient_vente_id, "c1");
const compl160 = inv.verifierCompletude(ouvrage, { ...CTX, coefficientsVente: LISTE160, tvaDefaut: 20 });
assert.equal(compl160.prix.prix_vente_ht, 360, "après modification du coefficient, la synchro volontaire utilise le prix courant");

// ── 30. Devis ProGBat : prix FIGÉ du chiffrage, jamais recalculé ──────────
const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }];
const projet = {
  client_nom: "Dupont", client_prenom: "Marie", client_societe: "", client_adresse: "12 rue des Lilas", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "5 avenue du Parc", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "Appartement 101", type_logement: "T2", devis_objet: "Rénovation", devis_validite: "2026-10-31", tva_pct: 10, devis_num_commande_client: "",
};
const lignesDevis = [ligneV1, { ...snap, id: "L1", projet_id: "P1", category: "Sol", created_at: "2026-09-16T10:00:01Z", ordre: 1 }];
const res = q.construirePayloadDevisProGBat({ projet, lignes: lignesDevis, lotsOrdre: ["Sol"], taxes: TAXES, liaisons: { o1: { progbat_id: 777, existe: true } }, aujourdHui: D0 });
assert.equal(res.erreurs.length, 0, res.erreurs.map(e => e.message).join(" | "));
const elems = res.payload.content.flatMap(l => l.content.flatMap(z => z.content));
assert.deepEqual(elems.map(e => e.netUnitPrice).sort((a, b) => a - b), [49.85, 350], "prix figés transmis tels quels");
assert.equal(res.totaux.ht, 1246.25 + 1400);
const json = JSON.stringify(res.payload);
for (const k of ["coefficient_vente_id", "coefficient_vente", "coef_vente", "taux_horaire_vente", "calcul_detail", "prix_materiaux_unitaire"]) {
  assert.ok(!json.includes(`"${k}"`), `« ${k} » ne sort jamais vers ProGBat`);
}
const res160 = q.construirePayloadDevisProGBat({ projet, lignes: lignesDevis, lotsOrdre: ["Sol"], taxes: TAXES, liaisons: { o1: { progbat_id: 777, existe: true } }, aujourdHui: D0 });
assert.equal(JSON.stringify(res160.payload), json, "le payload ne dépend ni de la bibliothèque ni des coefficients courants");
assert.ok(q.CLES_INTERDITES.includes("coefficient_vente_id") && q.CLES_INTERDITES.includes("coefficient_vente"));

console.log("verif-coefficients-vente : OK (règles de la liste, fiche ouvrage, saisie, désactivation/défaut, erreurs Supabase, coefficient × matériaux + coût direct, taux × MO, arrondis, snapshots figés, actualisation volontaire, ProGBat prix courant / prix figé)");
