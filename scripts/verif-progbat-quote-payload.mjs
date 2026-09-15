#!/usr/bin/env node
// Vérifie le module de génération du payload de devis ProGBat
// (src/Renovation/progbatQuotePayload.mjs). Aucun appel réseau.
//   node scripts/verif-progbat-quote-payload.mjs
import assert from "node:assert/strict";

const m = await import(new URL("../src/Renovation/progbatQuotePayload.mjs", import.meta.url).href);
const pricing = await import(new URL("../src/Renovation/chiffragePricing.mjs", import.meta.url).href);
const { construirePayloadDevisProGBat, auditerPayload, trouverTaxRateId, indexerTauxTva, arrondirQuantite, formaterDateISO, CLES_INTERDITES, resoudreElementId } = m;
// Liaisons ACTUELLES Profero → ProGBat (bibliotheque_ratios.progbat_id vérifié par l'API) : identifiants fictifs
const LIAISONS = { 42: { progbat_id: 777, existe: true }, 43: { progbat_id: 778, existe: true } };

// ── Jeu de données ──────────────────────────────────────────────────────────
// Identifiants ProGBat FICTIFS (les vrais viennent de GET /company/taxes à l'exécution)
const TAXES = [
  { id: 701, rate: 0, label: "0 %", saleDefault: false },
  { id: 702, rate: 2.1, label: "2,1 %", saleDefault: false },
  { id: 703, rate: 5.5, label: "5,5 %", saleDefault: false },
  { id: 704, rate: 8.5, label: "8,5 %", saleDefault: false },
  { id: 705, rate: 10, label: "10 %", saleDefault: true },
  { id: 706, rate: 20, label: "20 %", saleDefault: false },
];
const AUJOURDHUI = new Date("2026-09-14T10:00:00Z");

const projetParticulier = () => ({
  client_nom: "Dupont", client_prenom: "Marie", client_societe: "",
  client_adresse: "12 rue des Lilas", client_adresse_complement: "", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "5 avenue du Parc", chantier_adresse_complement: "Bât. B", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "Appartement 101", type_logement: "T2",
  devis_objet: "Rénovation complète", devis_validite: "2026-10-31", tva_pct: 10, devis_num_commande_client: "",
  progbat_client_id: null, progbat_devis_id: null,
});
const projetPro = () => ({
  ...projetParticulier(), client_societe: "SCI Les Lilas", client_nom: "Martin", client_prenom: "Paul", devis_num_commande_client: "BC-2026-042", tva_pct: 20,
});

let seq = 0;
const ligne = (o = {}) => ({
  id: `L${++seq}`, projet_id: "P1", bibliotheque_id: 42, category: "Sol", zone: "Séjour",
  code_ouvrage: "S-001", item: "S-001 : Sol lame PVC à clipser", quantite: "25", unite: "m²", prix_unitaire: 49.85, tva_pct: 10,
  cout_materiaux_unitaire: 20, cout_main_oeuvre_unitaire: 12.16, cout_direct_unitaire: 0, cout_total_unitaire: 32.16,
  coef_vente: 1.55, taux_marge_pct: 35.48, calcul_version: "1@2026-09-14T12:44:32.841Z",
  calcul_detail: { version: 1, complet: true }, ordre: 0, created_at: "2026-09-14T12:44:33Z", ...o,
});
const construire = (projet, lignes, extra = {}) => construirePayloadDevisProGBat({ projet, lignes, lotsOrdre: ["Démolition", "Murs cloison doublages", "Sol"], taxes: TAXES, liaisons: LIAISONS, aujourdHui: AUJOURDHUI, ...extra });
const codes = (r) => r.erreurs.map(e => e.code);
const elements = (payload) => payload.content.flatMap(l => l.content.flatMap(z => z.content));

// ── Utilitaires ─────────────────────────────────────────────────────────────
assert.equal(arrondirQuantite("2,6"), 2.6);
assert.equal(arrondirQuantite(0.1 + 0.2), 0.3, "flottant nettoyé");
assert.equal(arrondirQuantite(1.23456), 1.2346, "4 décimales au plus");
assert.equal(arrondirQuantite(""), null);
assert.equal(formaterDateISO("2026-10-31"), "2026-10-31");
assert.equal(formaterDateISO("2026-10-31T00:00:00.000Z"), "2026-10-31");
assert.equal(formaterDateISO("2026-02-30"), null, "date impossible refusée");
assert.equal(formaterDateISO("31/10/2026"), null);
assert.equal(formaterDateISO(null), null);

// ── TVA → taxRateId ─────────────────────────────────────────────────────────
assert.equal(trouverTaxRateId(10, TAXES).id, 705, "10 % → id ProGBat, pas la valeur du taux");
assert.equal(trouverTaxRateId("5,5", TAXES).id, 703);
assert.equal(trouverTaxRateId(20, TAXES).id, 706);
assert.equal(trouverTaxRateId(7, TAXES).id, null, "TVA inconnue → null");
assert.match(trouverTaxRateId(7, TAXES).erreur, /7 %/);
assert.equal(trouverTaxRateId(null, TAXES).erreur, "TVA absente");
const idx = indexerTauxTva([...TAXES, { id: 999, rate: 10 }, { id: null, rate: 3 }, { id: 1, rate: "abc" }]);
assert.deepEqual(idx.doublons, [10]);
assert.equal(idx.invalides, 2);
assert.equal(idx.parTaux.get(10).id, 705, "premier taux conservé en cas de doublon");
assert.equal(trouverTaxRateId(10, [{ id: "705", rate: "10" }]).id, 705, "id et taux textuels acceptés");

// ── 1 lot, 1 zone, 1 ouvrage — client particulier ───────────────────────────
{
  const r = construire(projetParticulier(), [ligne()]);
  assert.deepEqual(codes(r), [], "aucune erreur attendue : " + JSON.stringify(r.erreurs));
  assert.equal(r.valide, true);
  const p = r.payload;
  assert.equal(p.clientName, "Dupont Marie");
  assert.equal("clientBusinessName" in p, false, "particulier : pas de raison sociale");
  assert.equal("thirdId" in p, false);
  assert.equal(p.clientAddress, "12 rue des Lilas");
  assert.equal(p.clientPostcode, "49000");
  assert.equal(p.clientCity, "Angers");
  assert.equal(p.clientCountry, "France");
  assert.equal("clientAddress2" in p, false, "complément vide omis");
  assert.equal("businessId" in p, false);
  assert.equal("yardId" in p, false);
  assert.equal(p.businessLabel, "Dupont Marie — Appartement 101");
  assert.equal(p.yardLabel, "Appartement 101 (T2)");
  assert.equal(p.businessAddress, "5 avenue du Parc");
  assert.equal(p.businessAddress2, "Bât. B");
  assert.equal(p.businessPostcode, "49100");
  assert.equal(p.businessCity, "Angers");
  assert.equal(p.businessCountry, "France");
  assert.equal(p.object, "Rénovation complète");
  assert.equal(p.validityDate, "2026-10-31");
  assert.equal(p.defaultTaxRateId, 705);
  assert.equal("clientOrderNumber" in p, false, "n° de commande vide omis");
  assert.equal(p.content.length, 1);
  assert.equal(p.content[0].lineType, "title");
  assert.equal(p.content[0].label, "LOT Sol");
  assert.equal(p.content[0].content[0].lineType, "title");
  assert.equal(p.content[0].content[0].label, "ZONE Séjour");
  const el = p.content[0].content[0].content[0];
  assert.deepEqual(el, { lineType: "element", elementId: 777, label: "S-001 — Sol lame PVC à clipser", quantity: 25, unit: "m²", netUnitPrice: 49.85, taxRateId: 705 }, "elementId + label + quantity + unit + netUnitPrice + taxRateId transmis ensemble");
  assert.deepEqual(r.compteurs, { lots: 1, zones: 1, lignes: 1, lignes_sans_snapshot: 0, lies: 1 });
  assert.equal(r.apercu[0].zones[0].lignes[0].progbat_id, 777);
  assert.equal(r.apercu[0].zones[0].lignes[0].lie, true);
  assert.deepEqual(r.liaisons, { 42: { progbat_id: 777, existe: true }, 43: { progbat_id: 778, existe: true } });
  assert.equal(r.totaux.ht, 1246.25);
  assert.equal(r.totaux.ht_profero, 1246.25);
  assert.equal(r.totaux.ecart_ht, 0);
  assert.equal(r.totaux.tva, 124.63);
  assert.equal(r.totaux.ttc, 1370.88);
  assert.equal(r.entete.client.type, "particulier");
  assert.deepEqual(auditerPayload(p), []);
}

// ── Client professionnel + n° de commande + TVA 20 % ────────────────────────
{
  const r = construire(projetPro(), [ligne({ tva_pct: 20 })]);
  assert.deepEqual(codes(r), []);
  assert.equal(r.payload.clientBusinessName, "SCI Les Lilas");
  assert.equal(r.payload.clientName, "Martin Paul", "contact transmis en clientName");
  assert.equal(r.payload.clientOrderNumber, "BC-2026-042");
  assert.equal(r.payload.defaultTaxRateId, 706);
  assert.equal(elements(r.payload)[0].taxRateId, 706);
  assert.equal(r.payload.businessLabel, "SCI Les Lilas (Martin Paul) — Appartement 101");
  assert.equal(r.entete.client.type, "professionnel");
}

// ── Client ProGBat existant : thirdId seul, aucune coordonnée transmise ──────
{
  const r = construire({ ...projetParticulier(), progbat_client_id: "1234" }, [ligne()]);
  assert.deepEqual(codes(r), []);
  assert.equal(r.payload.thirdId, 1234);
  ["clientName", "clientBusinessName", "clientAddress", "clientPostcode", "clientCity", "clientCountry"].forEach(k => assert.equal(k in r.payload, false, k + " ne doit pas être transmis avec thirdId"));
  assert.ok(r.avertissements.some(a => /thirdId 1234/.test(a)));
  const r2 = construire({ ...projetParticulier(), progbat_client_id: "abc" }, [ligne()]);
  assert.ok(codes(r2).includes("client_progbat_invalide"));
}

// ── Affaire / chantier ProGBat existants : businessId / yardId, pas de libellés ─
{
  const r = construire({ ...projetParticulier(), progbat_business_id: 55, progbat_yard_id: "66" }, [ligne()]);
  assert.deepEqual(codes(r), []);
  assert.equal(r.payload.businessId, 55);
  assert.equal(r.payload.yardId, 66);
  ["businessLabel", "yardLabel", "businessAddress", "businessPostcode", "businessCity", "businessCountry"].forEach(k => assert.equal(k in r.payload, false, k));
}

// ── Plusieurs lots, plusieurs zones dans un lot, ordre du chiffrage ──────────
{
  const lignes = [
    ligne({ category: "Sol", zone: "Séjour", ordre: 1, code_ouvrage: "S-002", item: "S-002 : Plinthes", quantite: 10, prix_unitaire: 8 }),
    ligne({ category: "Sol", zone: "Séjour", ordre: 0 }),
    ligne({ category: "Sol", zone: "Cuisine", code_ouvrage: "S-003", item: "S-003 : Carrelage", quantite: 12, prix_unitaire: 60 }),
    ligne({ category: "Démolition", zone: "Logement entier", code_ouvrage: "D-001", item: "D-001 : Dépose cuisine", quantite: 1, unite: "U", prix_unitaire: 350 }),
    ligne({ category: "Murs cloison doublages", zone: "Chambre 1", code_ouvrage: "MU-001", item: "MU-001 Doublage BA13", quantite: 46, prix_unitaire: 74.28 }),
  ];
  const r = construire(projetParticulier(), lignes);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.payload.content.map(l => l.label), ["LOT Démolition", "LOT Murs cloison doublages", "LOT Sol"], "ordre des lots = ordre du chiffrage");
  const sol = r.payload.content[2];
  assert.deepEqual(sol.content.map(z => z.label), ["ZONE Séjour", "ZONE Cuisine"], "zones dans l'ordre des zones suggérées");
  assert.deepEqual(sol.content[0].content.map(e => e.label), ["S-001 — Sol lame PVC à clipser", "S-002 — Plinthes"], "ordre enregistré (champ ordre) respecté");
  assert.deepEqual(r.compteurs, { lots: 3, zones: 4, lignes: 5, lignes_sans_snapshot: 0, lies: 5 });
  assert.ok(elements(r.payload).every(e => e.elementId === 777), "elementId présent sur chaque ligne");
  const attendu = pricing.totauxDevis(lignes, { tvaPctDefaut: 10 }).venteHT;
  assert.equal(r.totaux.ht, attendu, "total payload = total Profero");
  assert.equal(r.totaux.ht, 1246.25 + 80 + 720 + 350 + 3416.88);
}

// ── Même ouvrage dans deux zones : deux occurrences, jamais fusionnées ───────
{
  const lignes = [
    ligne({ zone: "Séjour", quantite: 25 }),
    ligne({ zone: "Chambre 1", quantite: 12.5 }),
    ligne({ zone: "Chambre 1", quantite: 3 }),   // même ouvrage, même zone : toujours pas fusionné
  ];
  const r = construire(projetParticulier(), lignes);
  assert.deepEqual(codes(r), []);
  const zones = r.payload.content[0].content;
  assert.deepEqual(zones.map(z => z.label), ["ZONE Séjour", "ZONE Chambre 1"]);
  assert.equal(zones[0].content.length, 1);
  assert.equal(zones[1].content.length, 2, "deux occurrences distinctes dans la même zone");
  assert.deepEqual(zones[1].content.map(e => e.quantity), [12.5, 3]);
  assert.equal(r.compteurs.lignes, 3);
  assert.equal(r.totaux.ht, pricing.arrondirMontant((25 + 12.5 + 3) * 49.85));
}

// ── Quantité décimale, prix décimal et arrondi explicite ────────────────────
{
  const r = construire(projetParticulier(), [ligne({ quantite: "2,6", prix_unitaire: 108.33 })]);
  assert.deepEqual(codes(r), []);
  const el = elements(r.payload)[0];
  assert.equal(el.quantity, 2.6);
  assert.equal(el.netUnitPrice, 108.33);
  assert.equal(r.totaux.ht, 281.66, "2,6 × 108,33 = 281,658 → 281,66");
  assert.equal(r.totaux.ht, pricing.totauxDevis([ligne({ quantite: "2,6", prix_unitaire: 108.33 })], { tvaPctDefaut: 10 }).venteHT);
}
{
  // Prix figé à 3 décimales (ancienne saisie manuelle) : arrondi à 2 décimales signalé ;
  // le total Profero (calculé sur le prix brut) diverge ⇒ bloquant, jamais masqué.
  const r = construire(projetParticulier(), [ligne({ quantite: 100, prix_unitaire: 10.005 })]);
  assert.equal(elements(r.payload)[0].netUnitPrice, 10.01, "demi-centime vers le haut");
  assert.ok(r.avertissements.some(a => /arrondi à 2 décimales/.test(a)));
  assert.equal(r.totaux.ht, 1001);
  assert.equal(r.totaux.ht_profero, 1000.5);
  assert.ok(codes(r).includes("total_different"), "écart de total détecté");
  assert.equal(r.valide, false);
}
{
  // Somme brute puis arrondi unique = méthode Profero ; la somme des lignes arrondies peut différer d'un centime → avertissement
  const lignes = [ligne({ quantite: 1.5, prix_unitaire: 0.03 }), ligne({ zone: "Cuisine", quantite: 1.5, prix_unitaire: 0.03 })];
  const r = construire(projetParticulier(), lignes);
  assert.equal(r.totaux.ht, 0.09, "0,045 + 0,045 = 0,09");
  assert.equal(r.totaux.ht_lignes_arrondies, 0.1, "0,05 + 0,05 arrondis ligne à ligne");
  assert.ok(r.avertissements.some(a => /arrondies une à une/.test(a)));
  assert.ok(!codes(r).includes("total_different"), "le total Profero est bien respecté");
}

// ── TVA inconnue / TVA absente / taux non chargés ───────────────────────────
{
  const r = construire(projetParticulier(), [ligne({ tva_pct: 7 })]);
  assert.ok(codes(r).includes("tva_sans_correspondance"));
  assert.equal("taxRateId" in elements(r.payload)[0], false, "aucun taxRateId inventé");
  assert.equal(r.valide, false);
}
{
  const r = construire({ ...projetParticulier(), tva_pct: null }, [ligne({ tva_pct: null })]);
  assert.ok(codes(r).includes("tva_projet_absente"));
  assert.ok(codes(r).includes("tva_absente"));
  assert.equal("defaultTaxRateId" in r.payload, false);
}
{
  const r = construire(projetParticulier(), [ligne({ tva_pct: null })]);   // TVA de la ligne absente → celle du projet (10 %)
  assert.deepEqual(codes(r), []);
  assert.equal(elements(r.payload)[0].taxRateId, 705);
}
{
  const r = construire(projetParticulier(), [ligne()], { taxes: null });
  assert.ok(codes(r).includes("taux_tva_non_charges"));
  assert.equal(r.valide, false);
  const r2 = construire(projetParticulier(), [ligne()], { taxes: [] });
  assert.ok(codes(r2).includes("taux_tva_vides"));
}

// ── Zone absente : libellé d'aperçu + blocage ───────────────────────────────
{
  const r = construire(projetParticulier(), [ligne({ zone: "" }), ligne({ zone: "   " })]);
  assert.ok(codes(r).includes("zone_absente"));
  assert.equal(r.valide, false);
  assert.equal(r.apercu[0].zones[0].zone, m.LIBELLE_ZONE_MANQUANTE);
  assert.equal(r.apercu[0].zones[0].zone_manquante, true);
  assert.equal(r.payload.content[0].content[0].label, "ZONE Zone non renseignée");
}
// ── Lot absent ──────────────────────────────────────────────────────────────
{
  const r = construire(projetParticulier(), [ligne({ category: null })]);
  assert.ok(codes(r).includes("lot_absent"));
  assert.equal(r.apercu[0].lot_manquant, true);
}

// ── Snapshot absent : ancienne ligne incompatible, jamais recalculée ────────
{
  const ancienne = { id: "OLD1", projet_id: "P1", category: "Plomberie", zone: "Salle de bains", item: "WC suspendu", quantite: "1", unite: "U", prix_unitaire: 450, calcul_version: null, calcul_detail: null };
  const r = construire(projetParticulier(), [ligne(), ancienne]);
  assert.ok(codes(r).includes("snapshot_absent"));
  assert.ok(codes(r).includes("code_absent"), "ancien ouvrage sans code");
  assert.ok(codes(r).includes("ouvrage_sans_identifiant"), "ancienne ligne sans bibliotheque_id : impossible à lier");
  assert.equal(r.compteurs.lignes_sans_snapshot, 1);
  assert.equal(r.valide, false);
  const el = elements(r.payload).find(e => /WC suspendu/.test(e.label));
  assert.equal(el.netUnitPrice, 450, "valeur figée reprise telle quelle, pas recalculée");
}
// ── Ancien ouvrage incomplet : snapshot présent mais prix / unité absents ────
{
  const r = construire(projetParticulier(), [ligne({ prix_unitaire: null, unite: "", quantite: "0" })]);
  const c = codes(r);
  assert.ok(c.includes("prix_invalide"));
  assert.ok(c.includes("unite_absente"));
  assert.ok(c.includes("quantite_invalide"));
  assert.equal(r.valide, false);
  const r2 = construire(projetParticulier(), [ligne({ quantite: -3 })]);
  assert.ok(codes(r2).includes("quantite_invalide"));
  const r3 = construire(projetParticulier(), [ligne({ prix_unitaire: -1 })]);
  assert.ok(codes(r3).includes("prix_invalide"));
  const r4 = construire(projetParticulier(), [ligne({ code_ouvrage: "", item: "" })]);
  assert.ok(codes(r4).includes("code_absent") && codes(r4).includes("libelle_absent"));
}

// ── Contrôles bloquants d'en-tête ───────────────────────────────────────────
{
  const r = construire({ ...projetParticulier(), client_nom: "", client_prenom: "", client_societe: "", client_adresse: "", client_code_postal: "", client_ville: "", logement_reference: "", chantier_adresse: "", adresse_bien: "", devis_objet: "", devis_validite: "" }, [ligne()]);
  const c = codes(r);
  ["client_absent", "client_adresse_absente", "client_code_postal_absent", "client_ville_absente", "logement_reference_absente", "chantier_adresse_absente", "objet_absent", "validite_absente"].forEach(k => assert.ok(c.includes(k), k + " attendu"));
  assert.equal(r.valide, false);
  assert.ok(r.payload, "le payload reste inspectable même invalide");
}
{
  const r = construire({ ...projetParticulier(), chantier_adresse: "", adresse_bien: "3 rue Haute Angers" }, [ligne()]);
  assert.ok(!codes(r).includes("chantier_adresse_absente"), "repli sur adresse_bien accepté");
  assert.equal(r.payload.businessAddress, "3 rue Haute Angers");
  assert.ok(r.avertissements.some(a => /adresse du bien/.test(a)));
}
{
  const r = construire({ ...projetParticulier(), devis_validite: "2026-01-01" }, [ligne()]);
  assert.deepEqual(codes(r), []);
  assert.ok(r.avertissements.some(a => /dépassée/.test(a)));
  const r2 = construire({ ...projetParticulier(), logements: ["T2", "T3"], logement_reference: "" }, [ligne()]);
  assert.ok(codes(r2).includes("logement_multiple"));
}
{
  const r = construire(projetParticulier(), []);
  assert.ok(codes(r).includes("aucune_ligne"));
}

// ── elementId sur chaque élément, profondeur 2, aucune donnée interne ───────
{
  const lignes = [ligne(), ligne({ zone: "Cuisine", category: "Démolition", code_ouvrage: "D-001", item: "D-001 : Dépose", quantite: 1, unite: "U", prix_unitaire: 100 })];
  const r = construire(projetParticulier(), lignes);
  const json = JSON.stringify(r.payload);
  assert.equal(elements(r.payload).filter(e => e.elementId === 777).length, 2, "elementId sur chaque élément");
  assert.ok(!json.includes("elementType"), "elementType jamais envoyé");
  CLES_INTERDITES.forEach(k => assert.ok(!json.includes(`"${k}"`), `clé interdite absente : ${k}`));
  assert.ok(!/cout|marge|coef|bibliotheque|progbat_/i.test(json), "aucun coût, marge, coefficient ni liaison dans le JSON");
  assert.ok(!json.includes("32.16"), "coût total unitaire absent du payload");
  assert.ok(!json.includes("1.55"), "coefficient de vente absent du payload");
  // profondeur : lot (titre) → zone (titre) → element, jamais plus
  r.payload.content.forEach(lot => {
    assert.equal(lot.lineType, "title");
    lot.content.forEach(zone => {
      assert.equal(zone.lineType, "title");
      zone.content.forEach(el => { assert.equal(el.lineType, "element"); assert.equal("content" in el, false); });
    });
  });
  assert.deepEqual(auditerPayload(r.payload), []);
}
// ── L'audit détecte ce que la construction interdit ─────────────────────────
{
  const bon = construire(projetParticulier(), [ligne()]).payload;
  const surTitre = JSON.parse(JSON.stringify(bon));
  surTitre.content[0].elementId = 777;
  assert.ok(auditerPayload(surTitre).some(e => e.code === "element_id_hors_element"), "elementId interdit sur un titre");
  const surZone = JSON.parse(JSON.stringify(bon));
  surZone.content[0].content[0].elementId = 777;
  assert.ok(auditerPayload(surZone).some(e => e.code === "element_id_hors_element"), "elementId interdit sur une zone");
  const sansId = JSON.parse(JSON.stringify(bon));
  delete sansId.content[0].content[0].content[0].elementId;
  assert.ok(auditerPayload(sansId).some(e => e.code === "element_id_absent"), "élément sans elementId refusé");
  const idTexte = JSON.parse(JSON.stringify(bon));
  idTexte.content[0].content[0].content[0].elementId = "777";
  assert.ok(auditerPayload(idTexte).some(e => e.code === "element_id_absent"), "elementId doit être un entier");
  const idNegatif = JSON.parse(JSON.stringify(bon));
  idNegatif.content[0].content[0].content[0].elementId = -3;
  assert.ok(auditerPayload(idNegatif).some(e => e.code === "element_id_absent"), "elementId doit être positif");
  const idInconnu = JSON.parse(JSON.stringify(bon));
  idInconnu.content[0].content[0].content[0].elementId = 12;
  assert.ok(auditerPayload(idInconnu, { elementIdsAutorises: [777] }).some(e => e.code === "element_id_inconnu"), "elementId ≠ progbat_id actuel refusé");
  assert.deepEqual(auditerPayload(bon, { elementIdsAutorises: new Set([777]) }), []);
  const avecType = JSON.parse(JSON.stringify(bon));
  avecType.content[0].content[0].content[0].elementType = 3;
  assert.ok(auditerPayload(avecType).some(e => e.code === "cle_interdite"), "elementType interdit");
  const tropProfond = JSON.parse(JSON.stringify(bon));
  tropProfond.content[0].content[0].content = [{ lineType: "title", label: "Sous-zone", content: tropProfond.content[0].content[0].content }];
  assert.ok(auditerPayload(tropProfond).some(e => e.code === "profondeur_titres"), "3 niveaux de titres refusés");
  const cleInconnue = { ...bon, marge: 12 };
  assert.ok(auditerPayload(cleInconnue).some(e => e.code === "cle_interdite"));
  const horsOpenApi = { ...bon, foo: 1 };
  assert.ok(auditerPayload(horsOpenApi).some(e => e.code === "cle_inconnue"));
  const nonEntier = { ...bon, defaultTaxRateId: "705" };
  assert.ok(auditerPayload(nonEntier).some(e => e.code === "entier_attendu"));
}

// ── Cas réel anonymisé (Chiffrage v3, 14/09/2026) : 3 lignes sans prix ──────
{
  const reelles = [
    ligne({ category: "Maçonnerie", zone: "Logement entier", code_ouvrage: "MA-005", item: "MA-005 : Fourniture et mise en oeuvre de béton", quantite: "2.6", unite: "m²", prix_unitaire: null, tva_pct: 10 }),
    ligne({ category: "Murs cloison doublages", zone: "Logement entier", code_ouvrage: "MU-001", item: "MU-001 Fourniture et pose d'un doublage", quantite: "46", unite: "m²", prix_unitaire: null, tva_pct: 10 }),
    ligne({ category: "Murs cloison doublages", zone: "Logement entier", code_ouvrage: "MU-022", item: "MU-022 : Peinture finition C", quantite: "81", unite: "m²", prix_unitaire: null, tva_pct: 10, ordre: 1 }),
    ligne({ category: "Sol", zone: "Logement entier", code_ouvrage: "S-001", item: "S-001 : Sol lame PVC", quantite: "25", unite: "m²", prix_unitaire: "49.85", tva_pct: 10 }),
  ];
  const r = construire({ ...projetParticulier(), client_nom: "C.", logement_reference: "", devis_validite: null, client_adresse: "", client_code_postal: "", client_ville: "" }, reelles);
  assert.equal(r.valide, false);
  assert.equal(codes(r).filter(c => c === "prix_invalide").length, 3);
  assert.equal(r.totaux.ht, 1246.25, "seule la ligne chiffrée compte, comme dans Profero");
  assert.equal(r.totaux.ht_profero, 1246.25);
  assert.deepEqual(r.compteurs, { lots: 3, zones: 3, lignes: 4, lignes_sans_snapshot: 0, lies: 4 });
}

// ── Liaison ProGBat : résolution de l'elementId ─────────────────────────────
{
  assert.deepEqual(resoudreElementId(ligne(), LIAISONS), { elementId: 777, code: null, message: null });
  assert.equal(resoudreElementId(ligne({ bibliotheque_id: null }), LIAISONS).code, "ouvrage_sans_identifiant");
  assert.equal(resoudreElementId(ligne({ bibliotheque_id: 99 }), LIAISONS).code, "ouvrage_non_lie", "ouvrage Profero sans progbat_id");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: null } }).code, "ouvrage_non_lie");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: "abc" } }).code, "progbat_id_invalide");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: 0 } }).code, "progbat_id_invalide");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: -5 } }).code, "progbat_id_invalide");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: 777, existe: false } }).code, "structure_introuvable", "structure supprimée dans ProGBat");
  assert.equal(resoudreElementId(ligne(), { 42: { progbat_id: "777", existe: true } }).elementId, 777, "progbat_id textuel (colonne text) accepté");
  assert.equal(resoudreElementId(ligne(), new Map([["42", { progbat_id: 777 }]])).elementId, 777, "Map acceptée ; existe non vérifié = accepté par le générateur (le serveur vérifie)");
}
// ── Règle bloquante : tous liés, sinon invalide, jamais de devis hybride ─────
{
  const r = construire(projetParticulier(), [ligne({ code_ouvrage: "MU-022", item: "MU-022 : Peinture", bibliotheque_id: 99 })]);
  assert.equal(r.valide, false);
  assert.ok(codes(r).includes("ouvrage_non_lie"));
  assert.ok(r.erreurs.some(e => e.message === "MU-022 — ouvrage non lié à la bibliothèque ProGBat"), "message clair par ligne");
  assert.equal(r.compteurs.lies, 0);
  assert.equal("elementId" in elements(r.payload)[0], false, "aucun elementId inventé");
  assert.equal(r.apercu[0].zones[0].lignes[0].lie, false);
}
{
  // hybride : un ouvrage lié + un non lié ⇒ invalide, avec le compteur explicite
  const r = construire(projetParticulier(), [ligne(), ligne({ zone: "Cuisine", bibliotheque_id: 99, code_ouvrage: "S-002", item: "S-002 : Plinthes" })]);
  assert.equal(r.valide, false);
  assert.ok(codes(r).includes("ouvrages_non_lies"));
  assert.ok(r.erreurs.some(e => /Ouvrages liés à la bibliothèque ProGBat : 1 \/ 2/.test(e.message)));
  assert.equal(r.compteurs.lies, 1);
}
{
  const r = construire(projetParticulier(), [ligne()], { liaisons: { 42: { progbat_id: "x1" } } });
  assert.ok(codes(r).includes("progbat_id_invalide")); assert.equal(r.valide, false);
  const r2 = construire(projetParticulier(), [ligne()], { liaisons: { 42: { progbat_id: 777, existe: false } } });
  assert.ok(codes(r2).includes("structure_introuvable")); assert.equal(r2.valide, false);
  assert.ok(r2.erreurs.some(e => /#777 introuvable/.test(e.message)));
  const r3 = construire(projetParticulier(), [ligne()], { liaisons: null });
  assert.ok(codes(r3).includes("liaisons_non_chargees")); assert.equal(r3.valide, false);
}
// ── Ancien identifiant dans le snapshot / injection : la liaison ACTUELLE seule compte ─
{
  // la ligne porte un vieux progbat_ligne_id et même un elementId : ignorés
  const r = construire(projetParticulier(), [ligne({ progbat_ligne_id: "999", elementId: 999, progbat_id: 999 })]);
  assert.equal(elements(r.payload)[0].elementId, 777, "elementId issu de la liaison actuelle, pas du snapshot");
  assert.ok(!JSON.stringify(r.payload).includes("999"));
  // liaison actuelle absente alors que le snapshot en porte une ⇒ bloqué
  const r2 = construire(projetParticulier(), [ligne({ progbat_ligne_id: "999", elementId: 999 })], { liaisons: { 42: { progbat_id: null } } });
  assert.equal(r2.valide, false); assert.ok(codes(r2).includes("ouvrage_non_lie"));
  assert.equal("elementId" in elements(r2.payload)[0], false);
}
// ── Prix, unité, TVA et libellé du snapshot conservés malgré la bibliothèque ─
{
  // la liaison peut porter le prix COURANT de la bibliothèque ProGBat : il n'est jamais utilisé
  const r = construire(projetParticulier(), [ligne({ prix_unitaire: 49.85, unite: "m²", tva_pct: 20, item: "S-001 : Libellé figé Profero" })], { liaisons: { 42: { progbat_id: 777, existe: true, prix_courant: 99.99, unite_courante: "ml", libelle_courant: "Libellé ProGBat" } } });
  const el = elements(r.payload)[0];
  assert.equal(el.netUnitPrice, 49.85, "prix du snapshot Profero transmis, pas le prix courant");
  assert.equal(el.unit, "m²", "unité du snapshot");
  assert.equal(el.taxRateId, 706, "TVA du snapshot (20 %) convertie");
  assert.equal(el.label, "S-001 — Libellé figé Profero", "libellé figé");
  assert.equal(el.elementId, 777);
  assert.deepEqual(Object.keys(el).sort(), ["elementId", "label", "lineType", "netUnitPrice", "quantity", "taxRateId", "unit"], "les six champs accompagnent toujours elementId");
  assert.ok(!JSON.stringify(r.payload).includes("99.99"));
}
// ── Le hash change quand un elementId change ────────────────────────────────
{
  const a = construire(projetParticulier(), [ligne()]);
  const b = construire(projetParticulier(), [ligne()], { liaisons: { 42: { progbat_id: 778, existe: true } } });
  assert.notDeepEqual(a.payload, b.payload);
  const [ha, hb] = await Promise.all([m.hacherPayload(a.payload), m.hacherPayload(b.payload)]);
  assert.notEqual(ha, hb, "un elementId différent ⇒ hash différent");
  const c = construire(projetParticulier(), [ligne()]);
  assert.equal(await m.hacherPayload(c.payload), ha, "même liaison ⇒ même hash");
}

console.log("verif-progbat-quote-payload : OK (elementId lié, règle tous-liés, prix figés prioritaires, hash)");
