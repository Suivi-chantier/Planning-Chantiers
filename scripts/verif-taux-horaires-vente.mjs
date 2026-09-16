#!/usr/bin/env node
// Vérifie les règles pures des taux horaires de vente
// (src/Renovation/tauxHorairesVente.mjs) et leur prise en compte par le
// chiffrage et le devis ProGBat (prix figé jamais recalculé).
//   node scripts/verif-taux-horaires-vente.mjs
// Les garanties BASE (unicité du défaut, triggers, RLS) sont vérifiées par
// scripts/verif-taux-horaires-vente.sql (à exécuter dans Supabase, se rétracte).
import assert from "node:assert/strict";

const t = await import(new URL("../src/Renovation/tauxHorairesVente.mjs", import.meta.url).href);
const p = await import(new URL("../src/Renovation/chiffragePricing.mjs", import.meta.url).href);
const q = await import(new URL("../src/Renovation/progbatQuotePayload.mjs", import.meta.url).href);

const STANDARD = { id: "t1", libelle: "Taux standard", taux_ht: 80, est_defaut: true, actif: true };
const CHEF     = { id: "t2", libelle: "Chef d'équipe", taux_ht: 95, est_defaut: false, actif: true };
const SOUS_T   = { id: "t3", libelle: "Sous-traitance", taux_ht: 65, est_defaut: false, actif: false };
const LISTE = [CHEF, SOUS_T, STANDARD];

// ── 1. Taux standard : 80,00 € HT/h ─────────────────────────────────────────
assert.deepEqual(t.TAUX_STANDARD, { libelle: "Taux standard", taux_ht: 80 });
assert.equal(t.formaterTauxHT(80), "80,00 € HT/h");
assert.equal(t.formaterTauxHT(95.5), "95,50 € HT/h");
assert.equal(t.formaterTauxHT(null), "—");
assert.equal(t.libelleTaux(STANDARD), "Taux standard — 80,00 € HT/h");
assert.equal(t.libelleTaux(CHEF), "Chef d'équipe — 95,00 € HT/h");
assert.equal(t.libelleTaux(SOUS_T), "Sous-traitance — 65,00 € HT/h (désactivé)");
assert.equal(t.libelleTaux(SOUS_T, { mentionInactif: false }), "Sous-traitance — 65,00 € HT/h");
assert.equal(t.expliquerPrixMainOeuvre(2.5, 80), "2,50 h × 80,00 €/h = 200,00 € HT");
assert.equal(t.expliquerPrixMainOeuvre(0.33, 80), "0,33 h × 80,00 €/h = 26,40 € HT");
assert.equal(t.expliquerPrixMainOeuvre(null, 80), null);

// ── 2. Lecture de la liste : défaut, actifs, tri ─────────────────────────────
assert.equal(t.tauxParDefaut(LISTE).id, "t1");
assert.equal(t.tauxParDefaut([]), null);
assert.equal(t.tauxParDefaut([{ ...STANDARD, actif: false }]), null, "un défaut désactivé n'est pas un défaut utilisable");
assert.deepEqual(t.tauxActifs(LISTE).map(x => x.id), ["t1", "t2"], "défaut d'abord, puis libellé ; inactifs exclus");
assert.deepEqual([...LISTE].sort(t.comparerTaux).map(x => x.id), ["t1", "t2", "t3"]);
const diag = t.diagnostiquerListe(LISTE);
assert.equal(diag.ok, true);
assert.equal(diag.nbActifs, 2);
assert.equal(t.diagnostiquerListe([]).ok, false);
assert.ok(t.diagnostiquerListe([CHEF]).problemes.some(m => /Aucun taux horaire par défaut/.test(m)));
assert.ok(t.diagnostiquerListe([STANDARD, { ...CHEF, est_defaut: true }]).problemes.some(m => /Plusieurs taux horaires par défaut/.test(m)));

// ── 3. Liste déroulante de la fiche ouvrage ─────────────────────────────────
// Création : présélection du taux actif par défaut
assert.equal(t.tauxSelectionne(LISTE, null), "t1");
// Modification : le taux enregistré prime, même désactivé (affiché « (désactivé) »)
assert.equal(t.tauxSelectionne(LISTE, "t2"), "t2");
assert.equal(t.tauxSelectionne(LISTE, "t3"), "t3");
assert.equal(t.tauxSelectionne(LISTE, "zz"), "t1", "identifiant inconnu ⇒ défaut proposé");
assert.deepEqual(t.optionsSelectTaux(LISTE, null).map(o => o.texte), ["Taux standard — 80,00 € HT/h", "Chef d'équipe — 95,00 € HT/h"], "seuls les actifs sont proposés");
const optsInactif = t.optionsSelectTaux(LISTE, "t3");
assert.deepEqual(optsInactif.map(o => o.id), ["t1", "t2", "t3"], "le taux désactivé de l'ouvrage reste visible");
assert.equal(optsInactif.find(o => o.id === "t3").desactive, true);
assert.match(optsInactif.find(o => o.id === "t3").texte, /désactivé/);
assert.deepEqual(t.optionsSelectTaux(LISTE, "t2").map(o => o.id), ["t1", "t2"], "un autre inactif n'apparaît jamais");

// Enregistrement : référence stable obligatoire, existante, active (sauf conservation)
assert.equal(t.validerTauxOuvrage(LISTE, "t2").valide, true);
assert.equal(t.validerTauxOuvrage(LISTE, null).valide, false);
assert.match(t.validerTauxOuvrage(LISTE, "").erreur, /obligatoire/);
assert.match(t.validerTauxOuvrage(LISTE, "zz").erreur, /inconnu/, "identifiant inexistant refusé");
assert.match(t.validerTauxOuvrage(LISTE, "t3").erreur, /désactivé/, "taux inactif refusé pour un changement");
assert.equal(t.validerTauxOuvrage(LISTE, "t3", "t3").valide, true, "taux inactif conservé si c'était déjà celui de l'ouvrage");

// ── 4 & 5. Saisie d'un taux (ajout / modification) ─────────────────────────
assert.deepEqual(t.validerSaisieTaux({ libelle: "  Chef de chantier ", taux_ht: "92,5" }, LISTE).valeur, { libelle: "Chef de chantier", taux_ht: 92.5 });
assert.equal(t.validerSaisieTaux({ libelle: "", taux_ht: 80 }, LISTE).valide, false);
assert.ok(t.validerSaisieTaux({ libelle: "   ", taux_ht: 80 }, LISTE).erreurs.some(e => /libellé/i.test(e)));
for (const v of [null, "", "abc", 0, -5, "-80"]) {
  const r = t.validerSaisieTaux({ libelle: "X", taux_ht: v }, LISTE);
  assert.equal(r.valide, false, `taux ${String(v)} refusé`);
  assert.ok(r.erreurs.some(e => /taux/i.test(e)));
}
assert.ok(t.validerSaisieTaux({ libelle: "taux STANDARD", taux_ht: 70 }, LISTE).erreurs.some(e => /existe déjà/.test(e)), "libellé en doublon refusé");
assert.equal(t.validerSaisieTaux({ libelle: "Taux standard", taux_ht: 85 }, LISTE, "t1").valide, true, "modification du taux lui-même : pas un doublon");
assert.equal(t.validerSaisieTaux({ libelle: "X", taux_ht: 80.004 }, LISTE).valeur.taux_ht, 80, "arrondi au centime");

// ── 6 & 7. Désactivation / réactivation / défaut ────────────────────────────
assert.equal(t.peutDesactiver(CHEF, LISTE).ok, true);
assert.equal(t.peutDesactiver(STANDARD, LISTE).ok, false, "le taux par défaut ne se désactive pas");
assert.match(t.peutDesactiver(STANDARD, LISTE).raison, /par défaut/);
assert.equal(t.peutDesactiver(CHEF, [CHEF]).ok, false, "dernier taux actif");
assert.match(t.peutDesactiver(CHEF, [CHEF, SOUS_T]).raison, /au moins un taux horaire actif/);
assert.equal(t.peutDesactiver(SOUS_T, LISTE).ok, false, "déjà désactivé");
assert.equal(t.peutReactiver(SOUS_T).ok, true);
assert.equal(t.peutReactiver(CHEF).ok, false);
assert.equal(t.peutDefinirDefaut(CHEF).ok, true);
assert.equal(t.peutDefinirDefaut(STANDARD).ok, false, "déjà par défaut");
assert.equal(t.peutDefinirDefaut(SOUS_T).ok, false, "un taux désactivé ne peut pas devenir le défaut");
// Deux taux par défaut : impossible (diagnostic) ; la base le refuse par index unique
assert.equal(t.diagnostiquerListe([STANDARD, { ...CHEF, est_defaut: true }]).ok, false);

// ── Avertissement avant modification d'une valeur ──────────────────────────
assert.equal(t.avertissementModificationTaux(STANDARD, 80), null, "valeur inchangée ⇒ pas d'avertissement");
assert.equal(t.avertissementModificationTaux(STANDARD, "80,00"), null);
const av = t.avertissementModificationTaux(STANDARD, 85, { nbOuvrages: 105 });
assert.match(av, /80,00 € HT\/h → 85,00 € HT\/h/);
assert.match(av, /^Ce taux horaire est utilisé par 105 ouvrages\.\n\n/);
assert.match(av, /recalculera leur prix de vente pour les futurs chiffrages/);
assert.match(av, /devis déjà figés ne seront pas modifiés/);

// ── Erreurs Supabase : jamais silencieuses ─────────────────────────────────
assert.match(t.messageErreurSupabase({ code: "42501", message: "new row violates row-level security policy" }), /réservée aux administrateurs/);
assert.match(t.messageErreurSupabase({ code: "23505", message: 'duplicate key value violates unique constraint "taux_horaires_vente_un_seul_defaut_uidx"' }), /déjà un taux horaire par défaut/);
assert.match(t.messageErreurSupabase({ code: "23505", message: 'duplicate key value violates unique constraint "taux_horaires_vente_libelle_uidx"' }), /déjà ce libellé/);
assert.match(t.messageErreurSupabase({ code: "23514", message: 'violates check constraint "taux_horaires_vente_taux_ht_check"' }), /supérieur à zéro/);
assert.match(t.messageErreurSupabase({ code: "23514", message: 'violates check constraint "taux_horaires_vente_libelle_check"' }), /vide/);
assert.match(t.messageErreurSupabase({ code: "23503", message: "foreign key" }), /n'existe pas/);
assert.match(t.messageErreurSupabase({ code: "P0001", message: "Le taux par défaut ne peut pas être désactivé : définir d'abord un autre taux actif par défaut." }), /ne peut pas être désactivé/);
assert.match(t.messageErreurSupabase({ message: "TypeError: Failed to fetch" }), /Rien n'a été enregistré/);
assert.match(t.messageErreurSupabase({ message: "quelque chose" }, { action: "La désactivation" }), /^La désactivation a échoué : quelque chose/);
assert.equal(t.messageErreurSupabase(null), null);

// ── Chiffrage : présélection, modification, conservation, calcul ───────────
const MAT = [{ id: "m1", nom: "Kit", unite: "U", prix_unitaire: 100 }];
const COEFS = [{ id: "c1", libelle: "Coefficient test", valeur: 1.35, est_defaut: true, actif: true }];
const CTX = { materiaux: MAT, coutHoraire: 40.62, tauxHoraires: LISTE, coefficientsVente: COEFS };
const nouvelOuvrage = { id: "o1", libelle: "T-001 : Nouveau", unite: "U", cadence: 2.5, coefficient_vente_id: "c1", materiaux_liens: [{ materiau_id: "m1", quantite: 1 }], taux_horaire_vente_id: t.tauxSelectionne(LISTE, null) };
assert.equal(nouvelOuvrage.taux_horaire_vente_id, "t1", "création : taux par défaut présélectionné");
const c1 = p.calculerOuvrage(nouvelOuvrage, CTX);
assert.equal(c1.prixVenteUnitaire, 335, "100 × 1,35 + 2,5 × 80 = 335");
assert.equal(c1.prixMateriauxUnitaire, 135);
assert.equal(c1.prixMainOeuvreUnitaire, 200);
// Modification du taux de l'ouvrage (référence, pas valeur)
const c2 = p.calculerOuvrage({ ...nouvelOuvrage, taux_horaire_vente_id: "t2" }, CTX);
assert.equal(c2.prixMainOeuvreUnitaire, 237.5);   // 2,5 × 95
assert.equal(c2.prixVenteUnitaire, 372.5);
assert.equal(c2.prixMateriauxUnitaire, 135, "le coefficient ne touche que les matériaux");
// Taux désactivé conservé sur l'ouvrage : calculable + avertissement
const c3 = p.calculerOuvrage({ ...nouvelOuvrage, taux_horaire_vente_id: "t3" }, CTX);
assert.equal(c3.complet, true);
assert.equal(c3.prixMainOeuvreUnitaire, 162.5);
assert.ok(c3.avertissements.some(a => /désactivé/.test(a)));
// Identifiant inexistant / taux nul ⇒ refus
assert.equal(p.calculerOuvrage({ ...nouvelOuvrage, taux_horaire_vente_id: "nope" }, CTX).complet, false);
assert.equal(p.calculerOuvrage(nouvelOuvrage, { ...CTX, tauxHoraires: [{ ...STANDARD, taux_ht: 0 }] }).complet, false);
assert.equal(p.calculerOuvrage(nouvelOuvrage, { ...CTX, tauxHoraires: [{ ...STANDARD, taux_ht: -80 }] }).complet, false);
// Arrondis monétaires : 0,33 h × 80 = 26,40 ; 1,005 h × 80 = 80,40 ; 3 × 33,33 = 99,99 ; matériaux 10,9 × 1,35 = 14,72
assert.equal(p.calculerOuvrage({ ...nouvelOuvrage, cadence: 0.33, materiaux_liens: [], main_oeuvre_seule: true }, CTX).prixVenteUnitaire, 26.4);
assert.equal(p.calculerOuvrage({ ...nouvelOuvrage, cadence: 3 }, { ...CTX, tauxHoraires: [{ ...STANDARD, taux_ht: 33.33 }] }).prixMainOeuvreUnitaire, 99.99);
assert.equal(p.calculerOuvrage({ ...nouvelOuvrage, cadence: 0.1 }, { ...CTX, tauxHoraires: [{ ...STANDARD, taux_ht: 0.7 }] }).prixMainOeuvreUnitaire, 0.07, "0,1 × 0,7 = 0,07 sans résidu binaire");
assert.equal(p.calculerOuvrage({ ...nouvelOuvrage, cadence: 3 }, { ...CTX, tauxHoraires: [{ ...STANDARD, taux_ht: 1.1 }] }).prixMainOeuvreUnitaire, 3.3);

// ── Snapshots : anciens conservés, nouveaux au taux courant, ProGBat au prix figé ──
const D0 = new Date("2026-09-15T10:00:00Z");
const snap80 = p.creerSnapshotOuvrage(nouvelOuvrage, c1, { zone: "Séjour", tvaPct: 10, quantite: "4", date: D0 });
assert.equal(snap80.prix_unitaire, 335);
assert.equal(snap80.taux_horaire_vente, 80);
assert.equal(snap80.taux_horaire_vente_id, "t1");
// Le taux standard passe à 85 : le snapshot ne bouge pas, une nouvelle ligne suit
const LISTE85 = LISTE.map(x => x.id === "t1" ? { ...x, taux_ht: 85 } : x);
const c85 = p.calculerOuvrage(nouvelOuvrage, { ...CTX, tauxHoraires: LISTE85 });
assert.equal(c85.prixVenteUnitaire, 347.5);
assert.equal(snap80.prix_unitaire, 335, "ancien snapshot intact");
assert.equal(snap80.taux_horaire_vente, 80);
const snap85 = p.creerSnapshotOuvrage(nouvelOuvrage, c85, { zone: "Cuisine", quantite: "1", date: D0 });
assert.equal(snap85.taux_horaire_vente, 85);
assert.equal(snap85.prix_unitaire, 347.5);
// Ancienne ligne v1 (coût horaire 40,62, coefficient global) : jamais réécrite
const ligneV1 = { id: "L0", bibliotheque_id: "o1", category: "Sol", zone: "Séjour", code_ouvrage: "S-001", item: "S-001 : Sol", quantite: "25", unite: "m²", prix_unitaire: 49.85, tva_pct: 10, cout_total_unitaire: 32.16, coef_vente: 1.55, taux_marge_pct: 35.48, calcul_version: "1@2026-09-14T17:43:21.289Z", calcul_detail: { version: 1, cout_horaire: 40.62, heures_unitaires: 0.25 } };
assert.equal(p.totalLigneHT(ligneV1), 1246.25);
assert.equal(p.totauxDevis([ligneV1, { ...snap80, id: "L1", category: "Sol" }], { tvaPctDefaut: 10 }).venteHT, 1246.25 + 1340);

// Devis ProGBat : netUnitPrice = prix FIGÉ de la ligne, quel que soit le taux courant
const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }];
const projet = {
  client_nom: "Dupont", client_prenom: "Marie", client_societe: "", client_adresse: "12 rue des Lilas", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "5 avenue du Parc", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "Appartement 101", type_logement: "T2", devis_objet: "Rénovation", devis_validite: "2026-10-31", tva_pct: 10, devis_num_commande_client: "",
};
const lignesDevis = [
  { ...ligneV1 },
  { ...snap80, id: "L1", projet_id: "P1", category: "Sol", created_at: "2026-09-15T10:00:01Z", ordre: 1 },
];
const res = q.construirePayloadDevisProGBat({ projet, lignes: lignesDevis, lotsOrdre: ["Sol"], taxes: TAXES, liaisons: { o1: { progbat_id: 777, existe: true } }, aujourdHui: D0 });
assert.equal(res.erreurs.length, 0, res.erreurs.map(e => e.message).join(" | "));
const elems = res.payload.content.flatMap(l => l.content.flatMap(z => z.content));
assert.deepEqual(elems.map(e => e.netUnitPrice).sort((a, b) => a - b), [49.85, 335], "prix figés transmis tels quels");
assert.equal(res.totaux.ht, 1246.25 + 1340);
const json = JSON.stringify(res.payload);
for (const k of ["taux_horaire_vente", "taux_horaire_vente_id", "coef_vente", "cout_horaire", "calcul_detail", "prix_main_oeuvre_unitaire"]) {
  assert.ok(!json.includes(`"${k}"`), `« ${k} » ne sort jamais vers ProGBat`);
}
// Même payload si le taux courant change (85 €/h) : rien n'est recalculé
const res85 = q.construirePayloadDevisProGBat({ projet, lignes: lignesDevis, lotsOrdre: ["Sol"], taxes: TAXES, liaisons: { o1: { progbat_id: 777, existe: true } }, aujourdHui: D0 });
assert.equal(JSON.stringify(res85.payload), json, "le payload ne dépend pas de la bibliothèque ni des taux courants");

console.log("verif-taux-horaires-vente : OK (règles de la liste, fiche ouvrage, saisie, désactivation/défaut, erreurs Supabase, calcul cadence × taux, arrondis, snapshots figés, ProGBat au prix figé)");
