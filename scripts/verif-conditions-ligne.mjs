// Vérifie les CONDITIONS DE VENTE D'UNE LIGNE de chiffrage (coefficient et/ou
// taux horaire propres à un seul ouvrage sélectionné) :
// ordre de priorité (dérogation de ligne > condition globale > ouvrage),
// indépendance des deux paramètres, calcul et arrondis, sélecteurs et
// provenance affichée, badge de dérogation, options désactivées, prix saisis
// manuellement, lignes v1, interaction avec les conditions globales, nouvelles
// lignes et duplication, compatibilité ProGBat.
//   node scripts/verif-conditions-ligne.mjs
import assert from "node:assert/strict";
import {
  calculerOuvrage, creerSnapshotOuvrage, appliquerActualisation, totauxDevis,
  resoudreParametreVente, lireModesLigne, normaliserModeLigne,
  MODE_LIGNE_HERITAGE, MODE_LIGNE_OUVRAGE, MODE_LIGNE_SPECIFIQUE,
  SOURCE_OUVRAGE, SOURCE_GLOBAL, SOURCE_LIGNE, MODES_LIGNE_DEFAUT,
} from "../src/Renovation/chiffragePricing.mjs";
import {
  CONDITIONS_DEFAUT, lireConditionsProjet, recalculerLigneConditions, simulerConditions,
  resoudreValeursLigne, decrireConditionsLigne, optionsConditionLigne,
  valeurSelecteur, lireValeurSelecteur, libelleSource, ligneAPrixManuel, ligneEstV1,
  resumerSimulationLigne, messageErreurRpc, VALEUR_HERITAGE, VALEUR_OUVRAGE, PREFIXE_SPECIFIQUE,
} from "../src/Renovation/conditionsChiffrage.mjs";
import { construirePayloadDevisProGBat, auditerPayload, hacherPayload, CLES_INTERDITES, CLES_PAYLOAD_AUTORISEES } from "../src/Renovation/progbatQuotePayload.mjs";

// ─── Jeu de données ──────────────────────────────────────────────────────────
const TAUX = [
  { id: "t-std", libelle: "Taux standard", taux_ht: 80, actif: true, est_defaut: true },
  { id: "t-70", libelle: "Taux client privilégié", taux_ht: 70, actif: true, est_defaut: false },
  { id: "t-90", libelle: "Taux spécifique", taux_ht: 90, actif: true, est_defaut: false },
  { id: "t-off", libelle: "Taux ancien", taux_ht: 60, actif: false, est_defaut: false },
];
const COEFS = [
  { id: "c-std", libelle: "Coefficient standard", valeur: 1.5, actif: true, est_defaut: true },
  { id: "c-13", libelle: "Coefficient client privilégié", valeur: 1.3, actif: true, est_defaut: false },
  { id: "c-18", libelle: "Coefficient renforcé", valeur: 1.8, actif: true, est_defaut: false },
  { id: "c-off", libelle: "Coefficient ancien", valeur: 1.9, actif: false, est_defaut: false },
];
const MATS = [{ id: "m1", nom: "Placo", unite: "m²", prix_unitaire: 10 }];
// Ouvrage : 10 € matériaux / u, cadence 2 h, coût direct 0
//   prix ouvrage       = 10 × 1,5 + 2 × 80 = 175   (coût : 10 + 2 × 40 = 90)
//   prix global        = 10 × 1,3 + 2 × 70 = 153
const OUVRAGE = { id: "o1", libelle: "PLA-001 Cloison", unite: "m²", cadence: 2, materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_horaire_vente_id: "t-std", coefficient_vente_id: "c-std", cout_direct_unitaire: 0 };
const CTX = { materiaux: MATS, coutHoraire: 40, tauxHoraires: TAUX, coefficientsVente: COEFS };
const DATE = new Date("2026-09-16T10:00:00.000Z");

const projetOuvrage = { id: "p1", statut: "chiffrage", mode_coefficient: "ouvrage", mode_taux_horaire: "ouvrage", conditions_version: 0 };
const projetGlobal = { ...projetOuvrage, mode_coefficient: "global", coefficient_global_id: "c-13", coefficient_global_valeur: 1.3, coefficient_global_libelle: "Coefficient client privilégié",
  mode_taux_horaire: "global", taux_horaire_global_id: "t-70", taux_horaire_global_valeur: 70, taux_horaire_global_libelle: "Taux client privilégié", conditions_version: 2 };
const condGlobal = lireConditionsProjet(projetGlobal);
const condAucune = lireConditionsProjet(projetOuvrage);

const modes = (mc, mt) => ({ coefficient: mc, tauxHoraire: mt });
const heritage = { mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null };
const ouvrageMode = { mode: MODE_LIGNE_OUVRAGE, id: null, valeur: null, libelle: null };
const specCoef18 = { mode: MODE_LIGNE_SPECIFIQUE, id: "c-18", valeur: 1.8, libelle: "Coefficient renforcé" };
const specTaux90 = { mode: MODE_LIGNE_SPECIFIQUE, id: "t-90", valeur: 90, libelle: "Taux spécifique" };

// Ligne v2 figée telle qu'elle existe en base (paramètres de l'ouvrage)
const snapOuvrage = creerSnapshotOuvrage(OUVRAGE, calculerOuvrage(OUVRAGE, CTX), { zone: "Cuisine", quantite: "2", date: DATE });
const ligneV2 = { id: "l1", projet_id: "p1", category: "Plaquiste", ...snapOuvrage };

// ─── 1. Ordre de priorité ────────────────────────────────────────────────────
{
  // 1 · dérogation de ligne prioritaire sur la condition globale
  const r = resoudreValeursLigne(ligneV2, condGlobal, modes(specCoef18, heritage));
  assert.equal(r.coefficient.valeur, 1.8); assert.equal(r.coefficient.source, SOURCE_LIGNE);
  // 2 · global prioritaire sur l'ouvrage en mode héritage
  assert.equal(r.tauxHoraire.valeur, 70); assert.equal(r.tauxHoraire.source, SOURCE_GLOBAL);
  const h = resoudreValeursLigne(ligneV2, condGlobal, modes(heritage, heritage));
  assert.equal(h.coefficient.valeur, 1.3); assert.equal(h.coefficient.source, SOURCE_GLOBAL);
  // 3 · mode ouvrage prioritaire sur le global
  const o = resoudreValeursLigne(ligneV2, condGlobal, modes(ouvrageMode, ouvrageMode));
  assert.equal(o.coefficient.valeur, 1.5); assert.equal(o.coefficient.source, SOURCE_OUVRAGE);
  assert.equal(o.tauxHoraire.valeur, 80); assert.equal(o.tauxHoraire.source, SOURCE_OUVRAGE);
  // Héritage SANS condition globale ⇒ paramètre de l'ouvrage
  const sansGlobal = resoudreValeursLigne(ligneV2, condAucune, modes(heritage, heritage));
  assert.equal(sansGlobal.coefficient.valeur, 1.5); assert.equal(sansGlobal.coefficient.source, SOURCE_OUVRAGE);
  assert.equal(sansGlobal.tauxHoraire.valeur, 80); assert.equal(sansGlobal.tauxHoraire.source, SOURCE_OUVRAGE);
  // 4 · les deux paramètres sont indépendants
  const mix = resoudreValeursLigne(ligneV2, condGlobal, modes(specCoef18, ouvrageMode));
  assert.equal(mix.coefficient.valeur, 1.8); assert.equal(mix.tauxHoraire.valeur, 80);
  // Résolveur brut (source unique, miroir de conditions_ligne_resoudre en SQL)
  assert.equal(resoudreParametreVente({ mode: "inconnu" }).mode, MODE_LIGNE_HERITAGE, "mode inconnu ⇒ héritage");
  assert.equal(resoudreParametreVente({ mode: MODE_LIGNE_SPECIFIQUE, specifique: { id: "x", valeur: 0 } }).valide, false, "valeur nulle ⇒ jamais utilisée");
  assert.equal(resoudreParametreVente({ mode: MODE_LIGNE_HERITAGE, globale: { id: "g", valeur: -1 }, origine: { id: "o", valeur: 2 } }).valeur, 2, "global négatif ignoré");
  assert.equal(normaliserModeLigne(null), MODE_LIGNE_HERITAGE);
}

// ─── 2. Recalcul : 5 à 8 (combinaisons) et 9 à 15 (calcul) ───────────────────
{
  // 5 · coefficient spécifique avec taux hérité (global) : 10×1,8 + 2×70 = 158
  const a = recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(specCoef18, heritage) });
  assert.equal(a.ok, true);
  assert.equal(a.patch.prix_unitaire, 158);
  assert.equal(a.patch.coef_vente, 1.8); assert.equal(a.patch.taux_horaire_vente, 70);
  assert.equal(a.patch.coefficient_source, SOURCE_LIGNE); assert.equal(a.patch.taux_horaire_source, SOURCE_GLOBAL);
  assert.equal(a.patch.mode_coefficient_ligne, MODE_LIGNE_SPECIFIQUE);
  assert.equal(a.patch.coefficient_ligne_id, "c-18"); assert.equal(a.patch.coefficient_ligne_valeur, 1.8);
  assert.equal(a.patch.mode_taux_horaire_ligne, MODE_LIGNE_HERITAGE);
  assert.equal(a.patch.taux_horaire_ligne_id, null); assert.equal(a.patch.taux_horaire_ligne_valeur, null, "aucune seconde source de vérité hors mode spécifique");
  // 9 · le coefficient n'agit QUE sur matériaux (+ coût direct)
  assert.equal(a.patch.calcul_detail.prix_materiaux_unitaire, 18);
  assert.equal(a.patch.calcul_detail.prix_direct_unitaire, 0);
  // 10 · le taux n'agit QUE sur la main-d'œuvre
  assert.equal(a.patch.calcul_detail.prix_main_oeuvre_unitaire, 140);

  // 6 · taux spécifique avec coefficient hérité : 10×1,3 + 2×90 = 193
  const b = recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(heritage, specTaux90) });
  assert.equal(b.patch.prix_unitaire, 193);
  assert.equal(b.patch.coef_vente, 1.3); assert.equal(b.patch.taux_horaire_vente, 90);
  assert.equal(b.patch.taux_horaire_source, SOURCE_LIGNE); assert.equal(b.patch.coefficient_source, SOURCE_GLOBAL);

  // 7 · deux paramètres spécifiques : 10×1,8 + 2×90 = 198
  const c = recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(specCoef18, specTaux90) });
  assert.equal(c.patch.prix_unitaire, 198);
  assert.equal(c.patch.coefficient_source, SOURCE_LIGNE); assert.equal(c.patch.taux_horaire_source, SOURCE_LIGNE);

  // Mode ouvrage malgré le global : 10×1,5 + 2×80 = 175
  const d = recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(ouvrageMode, ouvrageMode) });
  assert.equal(d.patch.prix_unitaire, 175);
  assert.equal(d.patch.coefficient_source, SOURCE_OUVRAGE); assert.equal(d.patch.taux_horaire_source, SOURCE_OUVRAGE);
  assert.equal(d.patch.mode_coefficient_ligne, MODE_LIGNE_OUVRAGE);

  // 8 · retour individuel à l'héritage (coefficient seul) : 10×1,3 + 2×90 = 193
  const ligneDeuxSpec = { ...ligneV2, ...c.patch };
  const retour = recalculerLigneConditions(ligneDeuxSpec, condGlobal, { date: DATE, modes: modes(heritage, lireModesLigne(ligneDeuxSpec).tauxHoraire) });
  assert.equal(retour.patch.prix_unitaire, 193);
  assert.equal(retour.patch.mode_coefficient_ligne, MODE_LIGNE_HERITAGE);
  assert.equal(retour.patch.mode_taux_horaire_ligne, MODE_LIGNE_SPECIFIQUE, "l'autre paramètre garde sa dérogation");
  // Retour complet à l'héritage : on retrouve exactement le prix des conditions globales
  const retour2 = recalculerLigneConditions(ligneDeuxSpec, condGlobal, { date: DATE, modes: modes(heritage, heritage) });
  assert.equal(retour2.patch.prix_unitaire, 153);
  // Et « utiliser le paramètre de l'ouvrage » depuis une dérogation
  const versOuvrage = recalculerLigneConditions(ligneDeuxSpec, condGlobal, { date: DATE, modes: modes(ouvrageMode, ouvrageMode) });
  assert.equal(versOuvrage.patch.prix_unitaire, 175, "l'origine figée permet toujours le retour à l'ouvrage");

  // 11 · prix unitaire recalculé, 12 · marge recalculée
  assert.equal(c.patch.taux_marge_pct, Math.round((198 - 90) / 198 * 10000) / 100);
  // 13 · les données figées de la ligne sont utilisées (coûts inchangés)
  assert.equal(c.patch.calcul_detail.heures_unitaires, 2);
  assert.equal(ligneV2.cout_materiaux_unitaire, 10);
  ["cout_materiaux_unitaire", "cout_main_oeuvre_unitaire", "cout_direct_unitaire", "cout_total_unitaire", "quantite", "unite", "zone"].forEach(champ => {
    assert.equal(champ in c.patch, false, `${champ} n'est jamais réécrit par un changement de conditions`);
  });
  // 14 · aucune donnée de bibliothèque actualisée silencieusement : l'ouvrage a
  // changé en base, la ligne garde ses coûts et sa cadence figés.
  const ouvrageModifie = { ...OUVRAGE, cadence: 5, coefficient_vente_id: "c-18" };
  const apresBiblio = recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(heritage, heritage) });
  assert.equal(apresBiblio.patch.calcul_detail.heures_unitaires, 2, "cadence figée, pas celle de la bibliothèque");
  assert.equal(calculerOuvrage(ouvrageModifie, CTX).prixVenteUnitaire, 10 * 1.8 + 5 * 80, "la bibliothèque, elle, a bien changé");
  // 15 · arrondis monétaires au centime (coût 3,333 € × 1,3 = 4,33)
  const ligneArrondi = { ...ligneV2, cout_materiaux_unitaire: 3.333, cout_total_unitaire: 50 };
  const arr = recalculerLigneConditions(ligneArrondi, condGlobal, { date: DATE, modes: modes(heritage, heritage) });
  assert.equal(arr.patch.calcul_detail.prix_materiaux_unitaire, 4.33);
  assert.equal(arr.patch.prix_unitaire, 4.33 + 140);
}

// ─── 3. Sélecteurs, provenance et badge (interface) ──────────────────────────
{
  // 16 · sélecteur présent pour chaque paramètre, avec héritage + ouvrage + référentiel
  const sel = optionsConditionLigne({ type: "coefficient", referentiel: COEFS, ligne: ligneV2, conditions: condGlobal });
  const textes = sel.options.map(o => o.texte);
  assert.equal(textes[0], "Hériter du chiffrage — 1,30");
  assert.equal(textes[1], "Utiliser le coefficient de l'ouvrage — 1,50");
  assert.ok(textes.includes("Coefficient standard — 1,50"));
  assert.ok(textes.includes("Coefficient client privilégié — 1,30"));
  assert.ok(textes.includes("Coefficient renforcé — 1,80"));
  // 20 · une option désactivée n'est jamais proposable en nouvelle sélection
  assert.equal(textes.some(t => /Coefficient ancien/.test(t)), false);
  assert.equal(sel.valeurCourante, VALEUR_HERITAGE);
  // 17 · valeur effective et provenance affichées
  assert.equal(sel.applique.valeur, 1.3); assert.equal(sel.applique.source, SOURCE_GLOBAL);
  assert.equal(sel.texteApplique, "Coefficient appliqué : 1,30");
  assert.equal(sel.texteOrigine, "Origine : condition globale du chiffrage");
  // Sans condition globale : l'héritage annonce le paramètre de l'ouvrage
  const selSansGlobal = optionsConditionLigne({ type: "coefficient", referentiel: COEFS, ligne: ligneV2, conditions: condAucune });
  assert.equal(selSansGlobal.options[0].texte, "Hériter du chiffrage — coefficient ouvrage 1,50");
  assert.equal(selSansGlobal.texteOrigine, "Origine : paramètre de l'ouvrage");
  // Taux : mêmes règles, valeurs en € HT/h
  const selT = optionsConditionLigne({ type: "taux", referentiel: TAUX, ligne: ligneV2, conditions: condGlobal });
  assert.equal(selT.options[0].texte, "Hériter du chiffrage — 70,00 € HT/h");
  assert.equal(selT.options[1].texte, "Utiliser le taux horaire de l'ouvrage — 80,00 € HT/h");
  assert.ok(selT.options.map(o => o.texte).includes("Taux spécifique — 90,00 € HT/h"));

  // 19 · une valeur désactivée DÉJÀ utilisée par la ligne reste visible, avec mention
  const ligneOff = { ...ligneV2, mode_coefficient_ligne: MODE_LIGNE_SPECIFIQUE, coefficient_ligne_id: "c-off", coefficient_ligne_valeur: 1.9, coefficient_ligne_libelle: "Coefficient ancien" };
  const selOff = optionsConditionLigne({ type: "coefficient", referentiel: COEFS, ligne: ligneOff, conditions: condGlobal });
  const opOff = selOff.options.find(o => o.id === "c-off");
  assert.ok(opOff, "l'option désactivée utilisée reste visible");
  assert.match(opOff.texte, /Coefficient ancien — 1,90 \(Désactivé\)/);
  assert.equal(opOff.selectionnable, false, "mais impossible à choisir de nouveau");
  assert.equal(selOff.valeurCourante, `${PREFIXE_SPECIFIQUE}c-off`);
  assert.equal(selOff.applique.valeur, 1.9, "la valeur FIGÉE sur la ligne reste utilisée");
  // Option supprimée des Réglages : signalée comme telle, valeur figée conservée
  const selSupp = optionsConditionLigne({ type: "coefficient", referentiel: COEFS.filter(c => c.id !== "c-off"), ligne: ligneOff, conditions: condGlobal });
  assert.match(selSupp.options.find(o => o.id === "c-off").texte, /Supprimé des Réglages/);

  // Aller-retour valeur de <select>
  assert.equal(valeurSelecteur(MODE_LIGNE_SPECIFIQUE, "c-18"), `${PREFIXE_SPECIFIQUE}c-18`);
  assert.deepEqual(lireValeurSelecteur(`${PREFIXE_SPECIFIQUE}c-18`), { mode: MODE_LIGNE_SPECIFIQUE, id: "c-18" });
  assert.deepEqual(lireValeurSelecteur(VALEUR_OUVRAGE), { mode: MODE_LIGNE_OUVRAGE, id: null });
  assert.deepEqual(lireValeurSelecteur("n'importe quoi"), { mode: MODE_LIGNE_HERITAGE, id: null });

  // 18 · badge de dérogation + provenance sur la ligne
  const ligneSpec = { ...ligneV2, ...recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(specCoef18, heritage) }).patch };
  const desc = decrireConditionsLigne(ligneSpec);
  assert.equal(desc.derogation, true); assert.equal(desc.badge, "Conditions spécifiques");
  assert.ok(desc.lignes.includes("Coefficient appliqué : 1,80"));
  assert.ok(desc.lignes.includes("Origine : dérogation propre à cette ligne"));
  assert.ok(desc.lignes.includes("Coefficient de l'ouvrage : 1,50"));
  assert.ok(desc.lignes.includes("Taux horaire appliqué : 70,00 € HT/h"));
  assert.ok(desc.lignes.includes("Origine : condition globale du chiffrage"));
  // Une ligne sans dérogation n'a pas de badge
  assert.equal(decrireConditionsLigne(ligneV2).badge, null);
  assert.equal(decrireConditionsLigne({ ...ligneV2, mode_coefficient_ligne: MODE_LIGNE_OUVRAGE }).badge, "Conditions spécifiques", "le mode ouvrage est aussi une dérogation");
  assert.equal(libelleSource(SOURCE_LIGNE), "dérogation propre à cette ligne");
  assert.equal(libelleSource(SOURCE_GLOBAL), "condition globale du chiffrage");
  assert.equal(libelleSource(SOURCE_OUVRAGE), "paramètre de l'ouvrage");

  // 21 · aperçu avant application : résumé d'une simulation RPC
  const r = resumerSimulationLigne({
    ligne_id: "l1", item: "Cloison", quantite: "2", possible: true, change: true, prix_manuel: false, conversion_v1: false,
    confirmations_requises: [], version_attendue: 3, hash_ligne: "abc",
    avant: { mode_coefficient: "heritage", coefficient: 1.3, coefficient_source: "global_chiffrage", mode_taux: "heritage", taux: 70, taux_source: "global_chiffrage", prix_unitaire: "153.00", taux_marge_pct: "41.18", marge_unitaire: "63.00", total_ht: "306.00" },
    apres: { mode_coefficient: "specifique", coefficient: 1.8, coefficient_source: "ligne", mode_taux: "heritage", taux: 70, taux_source: "global_chiffrage", prix_unitaire: "158.00", taux_marge_pct: "43.04", marge_unitaire: "68.00", total_ht: "316.00" },
    avertissements: [],
  });
  assert.equal(r.avant.prix, 153); assert.equal(r.apres.prix, 158);
  assert.equal(r.avant.coefficient, 1.3); assert.equal(r.apres.coefficient, 1.8);
  assert.equal(r.avant.taux, 70); assert.equal(r.apres.taux, 70);
  assert.equal(r.avant.marge, 63); assert.equal(r.apres.marge, 68);
  assert.equal(r.version, 3); assert.equal(r.hash, "abc");
  // 22 · annulation sans écriture : la simulation ne touche jamais la ligne source
  assert.equal(ligneV2.prix_unitaire, 175); assert.equal(ligneV2.coef_vente, 1.5);
  assert.equal(ligneV2.mode_coefficient_ligne, MODE_LIGNE_HERITAGE);
  // Message d'erreur de RPC lisible
  assert.match(messageErreurRpc({ message: 'permission denied for table x' }), /Droits insuffisants/);
  assert.match(messageErreurRpc({ message: 'erreur : Cette ligne appartient à un autre chiffrage' }), /^Cette ligne appartient/);
}

// ─── 4. Prix saisis manuellement et lignes v1 ────────────────────────────────
{
  // 23 · prix manuel détecté (aucun calcul figé)
  const manuelSansDonnees = { id: "m1", projet_id: "p1", item: "Ancien poste", quantite: "3", prix_unitaire: 450 };
  assert.equal(ligneAPrixManuel(manuelSansDonnees), true);
  assert.equal(ligneEstV1(manuelSansDonnees), false);
  // 24 · sans confirmation, la ligne reste hors périmètre (jamais convertie en douce)
  const sansConf = recalculerLigneConditions(manuelSansDonnees, condGlobal, { date: DATE });
  assert.equal(sansConf.ok, false); assert.equal(sansConf.horsPerimetre, true); assert.equal(sansConf.prixManuel, true);
  // 27 · données insuffisantes ⇒ bloqué avec l'explication de ce qui manque
  const avecConf = recalculerLigneConditions(manuelSansDonnees, condGlobal, { date: DATE, autoriserPrixManuel: true });
  assert.equal(avecConf.ok, false);
  assert.match(avecConf.raison, /prix saisi sans calcul figé/);
  assert.match(avecConf.manque, /cadence figée.*coût matériaux figé/);

  // 26 · prix manuel AVEC données figées : conversion explicite vers prix calculé
  const manuelComplet = { ...ligneV2, id: "m2", prix_unitaire: 450, calcul_version: null,
    calcul_detail: { heures_unitaires: 2 } };
  const conv = recalculerLigneConditions(manuelComplet, condGlobal, { date: DATE, autoriserPrixManuel: true, modes: modes(heritage, heritage) });
  assert.equal(conv.ok, true); assert.equal(conv.prixManuel, true);
  assert.equal(conv.prixAvant, 450);
  assert.equal(conv.patch.prix_unitaire, 153);
  // 25 · l'ancien prix est conservé dans l'audit du calcul figé
  assert.equal(conv.patch.calcul_detail.prix_manuel_remplace, 450);
  assert.equal(conv.patch.calcul_version.startsWith("2@"), true, "la ligne passe en prix calculé");

  // 28 · ligne v1 compatible : conversion explicite proposée
  const v1Complete = { ...ligneV2, id: "v1", calcul_version: "1@2026-09-14T12:44:32.841Z",
    cout_materiaux_unitaire: 22, cout_total_unitaire: 32.16, coef_vente: 1.55, prix_unitaire: 49.85,
    coefficient_vente_id: null, taux_horaire_vente_id: null, taux_horaire_vente: null,
    coefficient_origine_valeur: null, taux_horaire_origine_valeur: null, coefficient_source: null, taux_horaire_source: null,
    calcul_detail: { version: 1, heures_unitaires: 0.25 } };
  assert.equal(ligneEstV1(v1Complete), true);
  // 29a · sans autorisation explicite : jamais convertie
  const v1Refus = recalculerLigneConditions(v1Complete, condGlobal, { date: DATE });
  assert.equal(v1Refus.ok, false); assert.match(v1Refus.raison, /ancienne formule \(v1\)/);
  // 28 · avec un taux disponible (global) : conversion possible, 22×1,3 + 0,25×70 = 46,10
  const v1Conv = recalculerLigneConditions(v1Complete, condGlobal, { date: DATE, autoriserV1: true, modes: modes(heritage, heritage) });
  assert.equal(v1Conv.ok, true); assert.equal(v1Conv.conversionV1, true);
  assert.equal(v1Conv.patch.prix_unitaire, 22 * 1.3 + 0.25 * 70);
  assert.equal(v1Conv.patch.calcul_version.startsWith("2@"), true);
  // 29b · ligne v1 sans taux mobilisable (aucun global, aucun taux figé) ⇒ bloquée
  const v1SansTaux = recalculerLigneConditions(v1Complete, condAucune, { date: DATE, autoriserV1: true, modes: modes(heritage, heritage) });
  assert.equal(v1SansTaux.ok, false);
  assert.match(v1SansTaux.raison, /taux horaire d'origine de l'ouvrage absent/);
  // …mais un taux SPÉCIFIQUE débloque la ligne : 22×1,55 + 0,25×90 = 56,60
  const v1Spec = recalculerLigneConditions(v1Complete, condAucune, { date: DATE, autoriserV1: true, modes: modes(heritage, specTaux90) });
  assert.equal(v1Spec.ok, true);
  assert.equal(v1Spec.patch.prix_unitaire, 22 * 1.55 + 0.25 * 90);
  assert.equal(v1Spec.patch.coef_vente, 1.55, "le coefficient figé de la ligne v1 sert d'origine, jamais inventé");
  // Une ligne v1 sans cadence figée reste bloquée quoi qu'il arrive
  const v1SansCadence = { ...v1Complete, calcul_detail: { version: 1 } };
  assert.equal(recalculerLigneConditions(v1SansCadence, condGlobal, { date: DATE, autoriserV1: true }).ok, false);
}

// ─── 5. Interaction avec les conditions globales ─────────────────────────────
{
  // Lignes : A héritage/héritage, B coef spécifique + taux hérité, C taux
  // spécifique + coef hérité, D mode ouvrage sur les deux.
  const p = (m) => ({ ...ligneV2, ...recalculerLigneConditions(ligneV2, condAucune, { date: DATE, modes: m }).patch });
  const A = { ...p(modes(heritage, heritage)), id: "A", quantite: "1" };
  const B = { ...p(modes(specCoef18, heritage)), id: "B", quantite: "1" };
  const C = { ...p(modes(heritage, specTaux90)), id: "C", quantite: "1" };
  const D = { ...p(modes(ouvrageMode, ouvrageMode)), id: "D", quantite: "1" };
  // Sans condition globale : A = 175, B = 10×1,8 + 160 = 178, C = 15 + 180 = 195, D = 175
  assert.equal(A.prix_unitaire, 175); assert.equal(B.prix_unitaire, 178); assert.equal(C.prix_unitaire, 195); assert.equal(D.prix_unitaire, 175);

  const sim = simulerConditions([A, B, C, D], condGlobal, { date: DATE });
  // 30 · seules les lignes héritées suivent le changement global
  //   A → 153 ; B → 10×1,8 + 2×70 = 158 (taux hérité change) ; C → 13 + 180 = 193 ; D inchangée
  const parId = Object.fromEntries(sim.recalculees.map(l => [l.id, l.prixApres]));
  assert.equal(parId.A, 153); assert.equal(parId.B, 158); assert.equal(parId.C, 193);
  // 33 · mode ouvrage conservé : D n'est PAS présentée comme modifiée
  assert.equal("D" in parId, false, "la ligne forcée sur l'ouvrage ne change pas");
  assert.equal(sim.nbLignesInchangees, 1);
  // 31 · coefficient spécifique conservé, 32 · taux spécifique conservé
  assert.equal(sim.recalculees.find(l => l.id === "B").patch.coef_vente, 1.8);
  assert.equal(sim.recalculees.find(l => l.id === "B").patch.coefficient_source, SOURCE_LIGNE);
  assert.equal(sim.recalculees.find(l => l.id === "C").patch.taux_horaire_vente, 90);
  assert.equal(sim.recalculees.find(l => l.id === "C").patch.taux_horaire_source, SOURCE_LIGNE);
  // 34 · comptage exact
  assert.equal(sim.nbLignesRecalculees, 3);
  assert.equal(sim.nbCoefficientsSpecifiques, 1);
  assert.equal(sim.nbTauxSpecifiques, 1);
  assert.equal(sim.nbLignesModeOuvrage, 1);
  assert.equal(sim.totalHTApres, 153 + 158 + 193 + 175);
  // Un changement du coefficient global SEUL ne touche pas une ligne à coefficient spécifique
  const coefSeul = { coefficient: condGlobal.coefficient, tauxHoraire: CONDITIONS_DEFAUT.tauxHoraire };
  const simCoef = simulerConditions([B], coefSeul, { date: DATE });
  assert.equal(simCoef.nbLignesRecalculees, 0, "coefficient spécifique + taux ouvrage ⇒ rien ne bouge");
  // …mais un changement du taux global la recalcule bien (paramètres indépendants)
  const tauxSeul = { coefficient: CONDITIONS_DEFAUT.coefficient, tauxHoraire: condGlobal.tauxHoraire };
  const simTaux = simulerConditions([B], tauxSeul, { date: DATE });
  assert.equal(simTaux.nbLignesRecalculees, 1);
  assert.equal(simTaux.recalculees[0].prixApres, 158);
  // Les autres lignes ne sont jamais touchées par la simulation
  assert.equal(B.prix_unitaire, 178); assert.equal(D.prix_unitaire, 175);
  assert.equal(totauxDevis([A, B, C, D]).venteHT, 175 + 178 + 195 + 175);
}

// ─── 6. Nouvelle ligne, snapshot et duplication ──────────────────────────────
{
  // Une nouvelle ligne naît en héritage, sans dérogation, conditions globales appliquées
  const calc = calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal });
  const snap = creerSnapshotOuvrage(OUVRAGE, calc, { zone: "Séjour", quantite: "1", date: DATE });
  assert.equal(snap.mode_coefficient_ligne, MODE_LIGNE_HERITAGE);
  assert.equal(snap.mode_taux_horaire_ligne, MODE_LIGNE_HERITAGE);
  assert.equal(snap.coefficient_ligne_id, null); assert.equal(snap.taux_horaire_ligne_valeur, null);
  assert.equal(snap.prix_unitaire, 153);
  assert.equal(snap.coefficient_source, SOURCE_GLOBAL);
  assert.equal(snap.coefficient_origine_valeur, 1.5, "l'origine de l'ouvrage reste figée");
  assert.equal(snap.taux_horaire_origine_valeur, 80);

  // Une nouvelle ligne avec dérogation explicite fige la valeur choisie
  const calcSpec = calculerOuvrage(OUVRAGE, { ...CTX, conditions: condGlobal, modesLigne: modes(specCoef18, heritage) });
  const snapSpec = creerSnapshotOuvrage(OUVRAGE, calcSpec, { zone: "Séjour", quantite: "1", date: DATE });
  assert.equal(snapSpec.prix_unitaire, 158);
  assert.equal(snapSpec.mode_coefficient_ligne, MODE_LIGNE_SPECIFIQUE);
  assert.equal(snapSpec.coefficient_ligne_id, "c-18"); assert.equal(snapSpec.coefficient_ligne_valeur, 1.8);
  assert.equal(snapSpec.coefficient_source, SOURCE_LIGNE);
  assert.equal(snapSpec.coefficient_origine_valeur, 1.5);

  // Duplication d'une ligne (même ligne commerciale) : les dérogations suivent,
  // comme les prix figés — c'est le comportement de « Dupliquer pour un autre
  // logement », qui ne recalcule rien.
  const { id, projet_id, ...copie } = { ...ligneV2, ...recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(specCoef18, specTaux90) }).patch };
  assert.equal(copie.mode_coefficient_ligne, MODE_LIGNE_SPECIFIQUE);
  assert.equal(copie.coefficient_ligne_valeur, 1.8);
  assert.equal(copie.prix_unitaire, 198);

  // « Actualiser depuis la bibliothèque » conserve la dérogation de la ligne
  const ligneSpec = { ...ligneV2, ...recalculerLigneConditions(ligneV2, condGlobal, { date: DATE, modes: modes(specCoef18, heritage) }).patch };
  const ouvrageMaj = { ...OUVRAGE, cadence: 3 };
  const calcMaj = calculerOuvrage(ouvrageMaj, { ...CTX, conditions: condGlobal, modesLigne: lireModesLigne(ligneSpec) });
  const patchMaj = appliquerActualisation(ligneSpec, ouvrageMaj, calcMaj, { date: DATE });
  assert.equal(patchMaj.mode_coefficient_ligne, MODE_LIGNE_SPECIFIQUE);
  assert.equal(patchMaj.coefficient_ligne_valeur, 1.8);
  assert.equal(patchMaj.prix_unitaire, 10 * 1.8 + 3 * 70, "nouvelle cadence, dérogation conservée");

  // Modes par défaut si la ligne ne porte aucune colonne (lignes antérieures)
  assert.deepEqual(lireModesLigne({ id: "x" }), { coefficient: { mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null }, tauxHoraire: { mode: MODE_LIGNE_HERITAGE, id: null, valeur: null, libelle: null } });
  assert.equal(MODES_LIGNE_DEFAUT.coefficient.mode, MODE_LIGNE_HERITAGE);
  // Mode spécifique sans valeur exploitable ⇒ retombe en héritage (jamais inventé)
  assert.equal(lireModesLigne({ mode_coefficient_ligne: MODE_LIGNE_SPECIFIQUE, coefficient_ligne_valeur: null }).coefficient.mode, MODE_LIGNE_HERITAGE);
}

// ─── 7. ProGBat : prix figé, hash invalidé, aucun champ interne ──────────────
{
  const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }, { id: 706, rate: 20, label: "20 %", saleDefault: false }];
  const LIAISONS = { 42: { progbat_id: 777, existe: true } };
  const projet = { client_nom: "Test", client_prenom: "A", client_adresse: "1 rue", client_code_postal: "49000", client_ville: "Angers", client_pays: "France", logement_reference: "Lot 12", tva_pct: 10, devis_objet: "Travaux", devis_validite: "2026-10-31" };
  const avant = [{ ...ligneV2, id: "l1", projet_id: "P1", bibliotheque_id: 42, quantite: "2", category: "Plaquiste", tva_pct: 10 }];
  const apres = avant.map(l => ({ ...l, ...recalculerLigneConditions(l, condGlobal, { date: DATE, modes: modes(specCoef18, specTaux90) }).patch }));
  const opts = { projet, lotsOrdre: ["Plaquiste"], taxes: TAXES, liaisons: LIAISONS, aujourdHui: DATE };
  const pA = construirePayloadDevisProGBat({ ...opts, lignes: avant });
  const pB = construirePayloadDevisProGBat({ ...opts, lignes: apres });
  const jsonA = JSON.stringify(pA.payload), jsonB = JSON.stringify(pB.payload);
  // 49 · le payload utilise uniquement le PRIX FIGÉ de la ligne
  assert.ok(/175/.test(jsonA) && !/198/.test(jsonA), "aperçu avant = prix figé 175");
  assert.ok(/198/.test(jsonB) && !/175/.test(jsonB), "aperçu après = nouveau prix figé 198");
  // 50 · le hash de l'aperçu change ⇒ l'ancien aperçu local est invalidé
  const [hA, hB] = await Promise.all([hacherPayload(pA.payload), hacherPayload(pB.payload)]);
  assert.notEqual(hA, hB);
  // 51 · aucune donnée interne (modes, dérogations, coûts, marges) n'est transmise
  ["mode_coefficient_ligne", "coefficient_ligne_id", "coefficient_ligne_valeur", "coefficient_ligne_libelle",
   "mode_taux_horaire_ligne", "taux_horaire_ligne_id", "taux_horaire_ligne_valeur", "taux_horaire_ligne_libelle"].forEach(k => {
    assert.ok(CLES_INTERDITES.includes(k), `${k} doit être interdit dans le payload ProGBat`);
    assert.equal(new RegExp(`"${k}"`).test(jsonB), false, `${k} absent du payload`);
  });
  assert.deepEqual(CLES_INTERDITES.filter(k => new RegExp(`"${k}"`).test(jsonB)), []);
  assert.equal(/"ligne"|Coefficient renforcé|Taux spécifique/.test(jsonB), false, "ni source ni libellé de dérogation transmis");
  assert.deepEqual(auditerPayload(pB.payload, { elementIdsAutorises: [777] }).filter(e => e.code === "cle_interdite"), []);
  // 52 · aucune écriture réelle vers ProGBat : le payload n'est QUE construit en
  // mémoire (module pur, aucun appel réseau) et ne porte que des clés autorisées
  // par l'OpenAPI ; sa création n'envoie rien.
  const clesPayload = Object.keys(pB.payload);
  assert.deepEqual(clesPayload.filter(k => !CLES_PAYLOAD_AUTORISEES.includes(k)), [], "aucune clé hors OpenAPI");
  assert.equal(auditerPayload(pB.payload, { elementIdsAutorises: [777] }).some(e => e.bloquant), false, "aperçu valide, mais jamais envoyé ici");
}

console.log("verif-conditions-ligne : OK (priorité ligne > global > ouvrage, 3 modes indépendants, calcul et arrondis, sélecteurs et provenance, badge, options désactivées, prix manuels, lignes v1, conditions globales et comptage, nouvelles lignes / duplication / actualisation, ProGBat prix figé)");
