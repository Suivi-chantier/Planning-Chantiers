#!/usr/bin/env node
// Vérifie les multi-ouvrages du chiffrage : calculs (chiffragePricing.mjs),
// règles (multiOuvrages.mjs), payload ProGBat (progbatQuotePayload.mjs) et
// logique serveur (progbatQuoteServeur.mjs) avec des DOUBLURES.
// Données fictives : aucun appel réseau, aucune base.
//   node scripts/verif-multi-ouvrages.mjs
import assert from "node:assert/strict";

const imp = (p) => import(new URL(p, import.meta.url).href);
const pricing = await imp("../src/Renovation/chiffragePricing.mjs");
const mo = await imp("../src/Renovation/multiOuvrages.mjs");
const gen = await imp("../src/Renovation/progbatQuotePayload.mjs");
const srv = await imp("../src/Renovation/progbatQuoteServeur.mjs");
const genLib = await imp("../supabase/functions/progbat-quote/lib/progbatQuotePayload.mjs");
const moLib = await imp("../supabase/functions/progbat-quote/lib/multiOuvrages.mjs");

const { totauxDevis, grouperParLotZone, prixMultiOuvrage, verifierPreparationDevis } = pricing;
let nbControles = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); nbControles++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbControles++; };

// ── Jeu de données (fictif) ─────────────────────────────────────────────────
const PID = "33082fd2-62e8-4709-a581-34b8c9e7cbeb";
const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }, { id: 706, rate: 20, label: "20 %", saleDefault: false }];
const MAINTENANT = new Date("2026-10-21T10:00:00Z");
const LOTS = ["Démolition", "Plomberie sanitaire", "Électricité", "Finitions générales"];
const projet = () => ({
  id: PID, client_nom: "Dupont", client_prenom: "Marie", client_societe: "",
  client_adresse: "12 rue des Lilas", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "5 avenue du Parc", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "Appartement 101", type_logement: "T2",
  devis_objet: "Rénovation complète", devis_validite: "2026-12-31", tva_pct: 10,
  progbat_client_id: null, progbat_devis_id: null,
});
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const ligne = (o = {}) => ({
  id: uid(), projet_id: PID, bibliotheque_id: "b-receveur", category: "Plomberie sanitaire", zone: "Salle de bains",
  code_ouvrage: "PL-010", item: "PL-010 : Receveur de douche 90x90", quantite: "1", unite: "U", prix_unitaire: 480, tva_pct: 10,
  cout_materiaux_unitaire: 200, cout_main_oeuvre_unitaire: 110, cout_direct_unitaire: 0, cout_total_unitaire: 310,
  calcul_version: "2@2026-10-01T00:00:00Z", ordre: 0, created_at: "2026-10-01T00:00:00Z", multi_ouvrage_id: null, ...o,
});
// Liaisons ACTUELLES Profero → ProGBat (identifiants fictifs)
const LIAISONS = { "b-receveur": { progbat_id: 801, existe: true }, "b-faience": { progbat_id: 802, existe: true }, "b-vasque": { progbat_id: 803, existe: true }, "b-prise": { progbat_id: 804, existe: true } };

const MULTI_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const receveur = ligne({ id: "l-receveur", ordre: 1 });
const faience = ligne({ id: "l-faience", bibliotheque_id: "b-faience", category: "Finitions générales", code_ouvrage: "FG-020", item: "FG-020 : Faïence murale", quantite: "12.5", unite: "m²", prix_unitaire: 62.4, cout_total_unitaire: 41, cout_materiaux_unitaire: 20, cout_main_oeuvre_unitaire: 21, ordre: 0 });
const vasque = ligne({ id: "l-vasque", bibliotheque_id: "b-vasque", code_ouvrage: "PL-030", item: "PL-030 : Meuble vasque 80 cm", quantite: "1", prix_unitaire: 655.55, cout_total_unitaire: 420, ordre: 2 });
const prise = ligne({ id: "l-prise", bibliotheque_id: "b-prise", category: "Électricité", zone: "Séjour", code_ouvrage: "E-002", item: "E-002 : Prise double", quantite: "3", prix_unitaire: 45.1, cout_total_unitaire: 30 });
const lignesSans = () => [receveur, faience, vasque, prise].map(l => ({ ...l, multi_ouvrage_id: null }));
const multi = (o = {}) => ({ id: MULTI_ID, projet_id: PID, libelle_commercial: "Fourniture et mise en place d'une salle de bain type", lot_affichage: "Plomberie sanitaire", zone: "Salle de bains", principal_ligne_id: "l-receveur", ajustement_ht: 0, ordre: 0, ...o });
const lignesAvec = (ids = ["l-receveur", "l-faience", "l-vasque"], mid = MULTI_ID) => lignesSans().map(l => ids.includes(l.id) ? { ...l, multi_ouvrage_id: mid } : l);

// ── 1. Sans multi-ouvrage : résultats strictement identiques à avant ────────
{
  const L = lignesSans();
  const avant = totauxDevis(L, { tvaPctDefaut: 10 });
  const apres = totauxDevis(L, { tvaPctDefaut: 10, multiOuvrages: [] });
  eq(apres, avant, "totaux identiques avec une liste vide de multi-ouvrages");
  eq(avant.nbMultiOuvrages, 0); eq(avant.ajustementsHT, 0);
  const g1 = grouperParLotZone(L, LOTS), g2 = grouperParLotZone(L, LOTS, { multiOuvrages: [] });
  eq(g2, g1, "regroupement identique");
  ok(g1.every(g => g.zones.every(z => Array.isArray(z.multis) && z.multis.length === 0)), "aucun bloc multi");
  // Venteur HT = Σ q × pu (480 + 12,5×62,4 + 655,55 + 3×45,1)
  eq(avant.venteHT, pricing.arrondirMontant(480 + 780 + 655.55 + 135.3));
  // Payload ProGBat inchangé : hash du devis = hash du payload seul
  const r = gen.construirePayloadDevisProGBat({ projet: projet(), lignes: L, lotsOrdre: LOTS, taxes: TAXES, liaisons: LIAISONS, aujourdHui: MAINTENANT });
  const r2 = gen.construirePayloadDevisProGBat({ projet: projet(), lignes: L, lotsOrdre: LOTS, taxes: TAXES, liaisons: LIAISONS, multiOuvrages: [], structuresMulti: {}, aujourdHui: MAINTENANT });
  eq(r2.payload, r.payload, "payload identique");
  eq(await gen.hacherDevis(r.payload, {}), await gen.hacherPayload(r.payload), "hash identique sans multi-ouvrage");
}

// ── 2. Totaux avec multi-ouvrage, avec et sans ajustement ───────────────────
{
  const L = lignesAvec();
  const p0 = prixMultiOuvrage(multi(), L);
  eq(p0.nbEnfants, 3);
  eq(p0.sousTotal, 1915.55, "480 + 780 + 655,55");
  eq(p0.prix, 1915.55);
  const t0 = totauxDevis(L, { tvaPctDefaut: 10, multiOuvrages: [multi()] });
  const tSans = totauxDevis(lignesSans(), { tvaPctDefaut: 10 });
  eq(t0.venteHT, tSans.venteHT, "regrouper sans ajustement ne change pas le total");
  eq(t0.coutTotal, tSans.coutTotal, "les coûts restent ceux des lignes");
  eq(t0.tva, tSans.tva);
  // Ajustement pour obtenir un prix rond : 1 915,55 → 1 900
  const m = multi({ ajustement_ht: -15.55 });
  const p1 = prixMultiOuvrage(m, L);
  eq(p1.prix, 1900);
  const t1 = totauxDevis(L, { tvaPctDefaut: 10, multiOuvrages: [m] });
  eq(t1.venteHT, pricing.arrondirMontant(tSans.venteHT - 15.55), "l'ajustement entre dans la vente HT");
  eq(t1.coutTotal, tSans.coutTotal, "l'ajustement ne touche aucun coût");
  eq(t1.marge, pricing.arrondirMontant(tSans.marge - 15.55), "l'ajustement se retrouve dans la marge");
  eq(t1.ajustementsHT, -15.55);
  eq(t1.nbMultiOuvrages, 1);
  // Regroupement : le bloc va sous son lot d'AFFICHAGE, les lignes n'apparaissent plus seules
  const g = grouperParLotZone(L, LOTS, { multiOuvrages: [m] });
  const plomberie = g.find(x => x.lot === "Plomberie sanitaire");
  const sdb = plomberie.zones.find(z => z.zone === "Salle de bains");
  eq(sdb.multis.length, 1);
  eq(sdb.lignes.length, 0, "lignes regroupées retirées de la zone");
  eq(sdb.multis[0].lignes.map(l => l.id), ["l-receveur", "l-faience", "l-vasque"], "principal en tête puis ordre d'affichage");
  ok(!g.some(x => x.lot === "Finitions générales"), "la faïence (lot Finitions) est rangée dans le bloc, pas dans son lot");
  eq(pricing.arrondirMontant(g.reduce((s, x) => s + x.total, 0)), t1.venteHT, "Σ lots = total HT (même chiffre)");
  // Multi-ouvrage vide : ne compte rien, ajustement compris
  const vide = multi({ id: "vide", ajustement_ht: 100 });
  const tv = totauxDevis(lignesSans(), { tvaPctDefaut: 10, multiOuvrages: [vide] });
  eq(tv.venteHT, tSans.venteHT, "multi-ouvrage vide : aucun montant");
  // Ligne qui cite un multi-ouvrage non chargé : signalée
  const tInconnu = totauxDevis(L, { tvaPctDefaut: 10 });
  eq(tInconnu.nbLignesMultiInconnu, 3);
  ok(verifierPreparationDevis(projet(), L, tInconnu).bloquants.some(b => /introuvable/.test(b)), "préparation bloquée si multi-ouvrages non chargés");
}

// ── 3. Libellé généré ───────────────────────────────────────────────────────
{
  const L = lignesAvec();
  eq(mo.libelleDevisMulti(multi(), L), [
    "Fourniture et mise en place d'une salle de bain type",
    "comprenant les ouvrages suivants :",
    "- Receveur de douche 90x90 : 1 U",
    "- Faïence murale : 12,5 m²",
    "- Meuble vasque 80 cm : 1 U",
  ].join("\n"), "libellé : principal puis ordre, sans code, quantité française");
  eq(mo.libelleCourtLigne({ item: "E-008 : Tableau électrique" }), "Tableau électrique");
  eq(mo.formaterQuantite("0.1"), "0,1");
  eq(mo.formaterQuantite(1.23456), "1,2346");
}

// ── 4. Signature : indépendante de l'ordre et du libellé ────────────────────
{
  const a = await mo.signatureComposition([{ componentId: 802, quantity: 12.5 }, { componentId: 801, quantity: 1 }]);
  const b = await mo.signatureComposition([{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12.5 }]);
  eq(a, b, "ordre indifférent");
  ok(/^[0-9a-f]{64}$/.test(a));
  ok(a !== await mo.signatureComposition([{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12 }]), "quantité différente = autre signature");
  const progbatIdDe = (l) => LIAISONS[l.bibliotheque_id]?.progbat_id ?? null;
  const L = lignesAvec();
  const c1 = mo.compositionAttendue(mo.libelleCourtLigne && pricing.lignesDuMulti(multi(), L), progbatIdDe);
  const c2 = mo.compositionAttendue(pricing.lignesDuMulti(multi({ libelle_commercial: "Autre libellé", principal_ligne_id: "l-vasque" }), L), progbatIdDe);
  eq(await mo.signatureComposition(c1.composants), await mo.signatureComposition(c2.composants), "libellé commercial et principal sans effet");
  // Même ouvrage posé deux fois dans la zone : quantités additionnées
  const double = mo.compositionAttendue([{ bibliotheque_id: "b-faience", quantite: "2" }, { bibliotheque_id: "b-faience", quantite: "3.5" }], progbatIdDe);
  eq(double.composants, [{ componentId: 802, quantity: 5.5 }]);
  eq(mo.codeStructureMulti("3f2a9c10ffff"), "MULTI-3F2A9C10");
  eq(mo.premierCodeLibre("3f2a9c10ffff", ["MULTI-3F2A9C10", "multi-3f2a9c10-2"]), "MULTI-3F2A9C10-3");
  ok(mo.codeDeLaSignature("MULTI-3F2A9C10-2", "3f2a9c10aa") && !mo.codeDeLaSignature("MULTI-3F2A9C1", "3f2a9c10aa"));
  // Comparaison d'une composition relue
  const att = [{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12.5 }];
  ok(mo.comparerComposition(att, [{ componentId: 802, quantity: 12.5 }, { componentId: 801, quantity: 1 }]).identique, "identique");
  const gen1 = mo.comparerComposition(att, [{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12.5 }, { componentId: 1, label: "Fournitures", quantity: 1 }]);
  ok(!gen1.identique && gen1.enTrop.length === 1, "composant générique « Fournitures » détecté");
  ok(!mo.comparerComposition(att, [{ componentId: 801, quantity: 2 }, { componentId: 802, quantity: 12.5 }]).identique, "quantité modifiée à la main détectée");
}

// ── 5. Payload : une ligne par multi-ouvrage, bon lot / zone, enfants absents ─
const STRUCT_ID = 9001;
const planReutilise = { [MULTI_ID]: { multi_id: MULTI_ID, action: "reutiliser", structure_id: STRUCT_ID, code: "MULTI-ABCDEF12", libelle: "Fourniture et mise en place d'une salle de bain type", signature: "abcdef12", composition: [{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12.5 }, { componentId: 803, quantity: 1 }] } };
const construire = (L, multis, structures, extra = {}) => gen.construirePayloadDevisProGBat({ projet: projet(), lignes: L, lotsOrdre: LOTS, taxes: TAXES, liaisons: LIAISONS, multiOuvrages: multis, structuresMulti: structures, aujourdHui: MAINTENANT, ...extra });
const elements = (p) => p.content.flatMap(l => l.content.flatMap(z => z.content.map(e => ({ lot: l.label, zone: z.label, ...e }))));
{
  const m = multi({ ajustement_ht: -15.55 });
  const L = lignesAvec();
  const r = construire(L, [m], planReutilise);
  eq(r.erreurs, [], "aucune erreur : " + JSON.stringify(r.erreurs));
  ok(r.valide);
  const els = elements(r.payload);
  eq(els.length, 2, "1 ligne multi + 1 prise : les 3 ouvrages regroupés ne partent pas seuls");
  const lm = els.find(e => e.elementId === STRUCT_ID);
  eq(lm.lot, "LOT Plomberie sanitaire"); eq(lm.zone, "ZONE Salle de bains");
  eq(lm.quantity, 1); eq(lm.unit, "U"); eq(lm.netUnitPrice, 1900); eq(lm.taxRateId, 705);
  eq(lm.label, mo.libelleDevisMulti(m, L));
  ok(!els.some(e => [801, 802, 803].includes(e.elementId)), "enfants absents du payload");
  eq(r.totaux.ht, r.totaux.ht_profero, "total payload = total Profero au centime");
  eq(r.compteurs.multi_ouvrages, 1); eq(r.compteurs.ouvrages_regroupes, 3);
  // Aucune donnée interne : ni coût, ni marge, ni ajustement en tant que tel
  eq(gen.auditerPayload(r.payload, { elementIdsAutorises: [801, 802, 803, 804, STRUCT_ID] }), [], "audit conforme, elementId MULTI accepté");
  const json = JSON.stringify(r.payload);
  ok(!/ajustement|cout_|marge|15[.,]55|1915[.,]55|"sousTotal"/i.test(json), "aucune trace d'ajustement, de sous-total, de coût ou de marge");
  ok(!json.includes("multi_ouvrage_id") && !json.includes("progbat_signature"));
  // Audit : un elementId MULTI inconnu est refusé
  ok(gen.auditerPayload(r.payload, { elementIdsAutorises: [801, 802, 803, 804] }).some(e => e.code === "element_id_inconnu"), "elementId hors liste refusé");
  // Ouvrage MULTI à créer : pas d'elementId à l'aperçu, mais payload valide et plan dans le hash
  const planCreer = { [MULTI_ID]: { ...planReutilise[MULTI_ID], action: "creer", structure_id: null, famille_id: 55 } };
  const rc = construire(L, [m], planCreer);
  eq(rc.erreurs, [], "à créer : valide à l'aperçu");
  eq(rc.multi_en_attente.length, 1);
  ok(!("elementId" in elements(rc.payload).find(e => e.unit === "U" && e.quantity === 1 && e.label.startsWith("Fourniture"))));
  ok(await gen.hacherDevis(rc.payload, planCreer) !== await gen.hacherDevis(rc.payload, { [MULTI_ID]: { ...planCreer[MULTI_ID], code: "MULTI-AUTRE" } }), "le code de l'ouvrage à créer est couvert par le hash");
  ok(await gen.hacherDevis(rc.payload, planCreer) !== await gen.hacherDevis(rc.payload, { [MULTI_ID]: { ...planCreer[MULTI_ID], composition: [{ componentId: 801, quantity: 2 }] } }), "la composition est couverte par le hash");
  // Après création : elementId posé, payload identique au confirmé hors elementId
  const rf = construire(L, [m], { [MULTI_ID]: { ...planCreer[MULTI_ID], structure_id: 9100 } });
  ok(rf.valide && rf.multi_en_attente.length === 0);
  eq(gen.serialiserCanonique(gen.retirerElementIds(rf.payload, rc.multi_en_attente)), gen.serialiserCanonique(rc.payload), "seul l'elementId change");
}

// ── 6. Blocages ─────────────────────────────────────────────────────────────
{
  const codes = (r) => r.erreurs.map(e => e.code);
  // TVA différentes
  const Ltva = lignesAvec().map(l => l.id === "l-faience" ? { ...l, tva_pct: 20 } : l);
  const rt = construire(Ltva, [multi()], planReutilise);
  ok(!rt.valide && codes(rt).includes("tva_differentes"), "TVA différentes bloquantes");
  ok(!mo.verifierRegroupement({ ids: ["l-receveur", "l-faience"], lignes: Ltva, tvaPctDefaut: 10 }).ok, "regroupement refusé si TVA différentes");
  // Ouvrage regroupé sans progbat_id : bloquant, message qui nomme l'ouvrage
  const sansLien = { ...LIAISONS, "b-vasque": { progbat_id: null, existe: null } };
  const rl = construire(lignesAvec(), [multi()], {}, { liaisons: sansLien });
  ok(!rl.valide && rl.erreurs.some(e => e.code === "ouvrage_non_lie" && /Meuble vasque|PL-030/.test(e.message)), "ouvrage sans progbat_id nommé : " + JSON.stringify(rl.erreurs.map(e => e.message)));
  // Ligne déjà dans un multi-ouvrage : ne peut pas en rejoindre un autre
  const Lgr = lignesAvec();
  const v = mo.verifierRegroupement({ ids: ["l-receveur", "l-prise"], lignes: Lgr, tvaPctDefaut: 10 });
  ok(!v.ok && v.erreurs.some(e => /Déjà dans un multi-ouvrage/.test(e)), "ligne déjà regroupée refusée");
  ok(v.erreurs.some(e => /même zone/.test(e)), "zones différentes refusées");
  // Moins de 2 ouvrages
  const L1 = lignesAvec(["l-receveur"]);
  const r1 = construire(L1, [multi()], {});
  ok(!r1.valide && codes(r1).includes("moins_de_deux"), "multi-ouvrage à 1 ouvrage bloquant");
  ok(!mo.verifierRegroupement({ ids: ["l-receveur"], lignes: lignesSans(), tvaPctDefaut: 10 }).ok, "création à 1 ouvrage refusée");
  ok(mo.verifierRegroupement({ ids: ["l-receveur", "l-vasque"], lignes: lignesSans(), tvaPctDefaut: 10 }).ok, "création à 2 ouvrages acceptée");
  ok(mo.verifierRegroupement({ ids: ["l-vasque"], lignes: lignesAvec(["l-receveur", "l-faience"]), multiCible: multi(), tvaPctDefaut: 10 }).ok, "ajout d'un ouvrage à un multi existant");
  ok(verifierPreparationDevis(projet(), L1, null, { multiOuvrages: [multi()], controlesMulti: mo.validerMultiOuvrages({ multiOuvrages: [multi()], lignes: L1, tvaPctDefaut: 10 }) }).bloquants.some(b => /un ouvrage/.test(b)), "préparation : moins de 2 signalé");
  // Ligne passée dans une autre zone
  const Lz = lignesAvec().map(l => l.id === "l-vasque" ? { ...l, zone: "WC" } : l);
  ok(mo.validerMultiOuvrages({ multiOuvrages: [multi()], lignes: Lz }).some(c => c.code === "ligne_hors_zone"), "ligne hors zone signalée");
  // Multi-ouvrages non chargés alors que des lignes y sont rattachées
  const rn = gen.construirePayloadDevisProGBat({ projet: projet(), lignes: lignesAvec(), lotsOrdre: LOTS, taxes: TAXES, liaisons: LIAISONS, aujourdHui: MAINTENANT });
  ok(!rn.valide && codes(rn).includes("multi_ouvrages_non_charges"));
  // Ajustement qui rendrait le prix négatif
  const rneg = construire(lignesAvec(), [multi({ ajustement_ht: -5000 })], planReutilise);
  ok(!rneg.valide && rneg.erreurs.some(e => /négatif/.test(e.message)));
}

// ── 7. Serveur (doublures) : aperçu sans écriture, réutilisation, création ──
function creerDepot({ multis = [multi()], lignes = lignesAvec(), famille = { id: 55, label: "Multi-ouvrages" }, connus = [] } = {}) {
  const etat = { exports: [], appels: [], majMulti: [] };
  return {
    etat,
    async chargerProjet(id) { return id === PID ? projet() : null; },
    async chargerLignes() { return lignes.map(l => ({ ...l })); },
    async chargerLotsOrdre() { return LOTS; },
    async chargerMultiOuvrages() { return multis.map(m => ({ ...m })); },
    async chercherStructuresMulti() { etat.appels.push("chercherStructuresMulti"); return connus; },
    async lireFamilleMulti() { return famille; },
    async majMultiStructure(id, patch) { etat.majMulti.push({ id, ...patch }); return { ok: true }; },
    async chargerLiaisons(ids) { return ids.filter(i => LIAISONS[i]).map(i => ({ id: i, progbat_id: String(LIAISONS[i].progbat_id ?? "") })); },
    async dernierExport() { return etat.exports.at(-1) ?? null; },
    async reserverExport(l) { etat.appels.push("reserverExport"); const id = `exp-${etat.exports.length + 1}`; etat.exports.push({ id, ...l }); return { ok: true, id }; },
    async majExport(id, patch) { etat.appels.push(`majExport:${patch.statut ?? "?"}`); Object.assign(etat.exports.find(e => e.id === id) || {}, patch); return { ok: true }; },
    async majProjetDevis() { return { ok: true }; },
  };
}
function creerProgbat({ existants = [], compositions = {}, generiqueApresPut = false } = {}) {
  const journal = [];
  const compo = { ...compositions };
  return {
    journal, jetonPresent: true,
    async lireTaux() { return { ok: true, taux: TAXES }; },
    async verifierStructures(ids) { return { ok: true, existants: ids, introuvables: [] }; },
    async chercherStructuresParCode(base) { journal.push(`GET structures ${base}`); return { ok: true, structures: existants }; },
    async lireComposition(id) { journal.push(`GET composition ${id}`); return compo[id] ? { ok: true, status: 200, items: compo[id] } : { ok: false, status: 404, message: "absent" }; },
    async listerFamilles() { return { ok: true, familles: [{ id: 55, label: "Multi-ouvrages", structureFamily: true }] }; },
    async creerStructure(body) { journal.push({ post: body }); return { ok: true, status: 201, data: { id: 9100 } }; },
    async poserComposition(id, body) {
      journal.push({ put: id, body });
      compo[id] = [...body.components.map(c => ({ componentId: c.componentId, quantity: c.quantity })), ...(generiqueApresPut ? [{ componentId: 1, label: "Fournitures", quantity: 1 }] : [])];
      return { ok: true, status: 200 };
    },
    async creerDevis(payload) { journal.push({ devis: payload }); return { ok: true, status: 201, data: { id: 4242, code: "$000600" } }; },
    async lireDevis(id) { return { ok: true, status: 200, data: { id } }; },
  };
}
const BUREAU = { id: "u", email: "bureau@profero.local", role: "bureau", actif: true };
const appel = (action, depot, progbat, extra = {}) => srv.traiterRequeteDevis({ action, projectId: PID, ...extra }, { appelant: BUREAU, depot, progbat, maintenant: MAINTENANT });
const COMPO_ATTENDUE = [{ componentId: 801, quantity: 1 }, { componentId: 802, quantity: 12.5 }, { componentId: 803, quantity: 1 }];
{
  // Aperçu : aucune écriture, ouvrage à créer annoncé (code, libellé, composition)
  const depot = creerDepot(), pb = creerProgbat();
  const prep = await appel("prepare", depot, pb);
  ok(prep.body.ok && prep.body.valide, "aperçu valide : " + JSON.stringify(prep.body.erreurs));
  const plan = prep.body.structures_multi[MULTI_ID];
  eq(plan.action, "creer"); ok(/^MULTI-[0-9A-F]{8}$/.test(plan.code)); eq(plan.composition, COMPO_ATTENDUE);
  eq(depot.etat.appels.filter(a => a === "reserverExport").length, 0, "prepare : aucune réservation");
  ok(!pb.journal.some(j => j.post || j.put || j.devis), "prepare : aucune écriture ProGBat");
  // Parité navigateur : la reconstitution locale avec le plan du serveur donne le même hash
  const local = gen.construirePayloadDevisProGBat({ projet: projet(), lignes: lignesAvec(), lotsOrdre: LOTS, taxes: prep.body.taux, liaisons: prep.body.liaisons, multiOuvrages: prep.body.multi_ouvrages, structuresMulti: prep.body.structures_multi, aujourdHui: MAINTENANT });
  eq(await gen.hacherDevis(local.payload, prep.body.structures_multi), prep.body.payloadHash, "parité local / serveur");

  // Création : POST structure, PUT composition (print=false), relecture, puis devis
  const cree = await appel("create", depot, pb, { expectedPayloadHash: prep.body.payloadHash, confirmed: true });
  ok(cree.body.ok && cree.body.statut === "created", "devis créé : " + JSON.stringify(cree.body));
  const ordre = pb.journal.map(j => typeof j === "string" ? j : j.post ? "POST structure" : j.put ? "PUT composition" : j.devis ? "POST devis" : "?").filter(x => !x.startsWith("GET"));
  eq(ordre, ["POST structure", "PUT composition", "POST devis"]);
  const post = pb.journal.find(j => j.post).post;
  eq(post.families, [55]); eq(post.saleNetUnitPrice, 0); eq(post.unitCode, "U"); eq(post.code, plan.code);
  const put = pb.journal.find(j => j.put);
  ok(put.body.components.every(c => c.print === false) && put.body.updatePrice === false, "composants masqués sur le PDF, prix non recalculé");
  const envoye = pb.journal.find(j => j.devis).devis;
  const lm = elements(envoye).find(e => e.elementId === 9100);
  ok(lm && lm.quantity === 1 && lm.netUnitPrice === 1915.55, "ligne MULTI envoyée avec son elementId");
  eq(depot.etat.majMulti[0].progbat_structure_id, "9100", "ouvrage MULTI mémorisé");
}
{
  // Réutilisation : un ouvrage MULTI existant à composition identique n'est pas recréé
  const sig = await mo.signatureComposition(COMPO_ATTENDUE);
  const pb = creerProgbat({ existants: [{ id: 9001, code: mo.codeStructureMulti(sig) }], compositions: { 9001: COMPO_ATTENDUE } });
  const depot = creerDepot();
  const prep = await appel("prepare", depot, pb);
  eq(prep.body.structures_multi[MULTI_ID].action, "reutiliser");
  eq(prep.body.structures_multi[MULTI_ID].structure_id, 9001);
  const cree = await appel("create", depot, pb, { expectedPayloadHash: prep.body.payloadHash, confirmed: true });
  ok(cree.body.ok, JSON.stringify(cree.body));
  ok(!pb.journal.some(j => j.post || j.put), "aucune création, aucune modification de l'ouvrage existant");
}
{
  // Ouvrage MULTI modifié à la main dans ProGBat : jamais réutilisé ni modifié → nouveau code
  const sig = await mo.signatureComposition(COMPO_ATTENDUE);
  const base = mo.codeStructureMulti(sig);
  const pb = creerProgbat({ existants: [{ id: 9001, code: base }], compositions: { 9001: [...COMPO_ATTENDUE, { componentId: 999, quantity: 1 }] } });
  const prep = await appel("prepare", creerDepot(), pb);
  const plan = prep.body.structures_multi[MULTI_ID];
  eq(plan.action, "creer"); eq(plan.code, `${base}-2`, "code suivant, l'ancien ouvrage reste intact");
}
{
  // ProGBat ajoute des composants génériques après le PUT : aucun devis envoyé
  const depot = creerDepot(), pb = creerProgbat({ generiqueApresPut: true });
  const prep = await appel("prepare", depot, pb);
  const r = await appel("create", depot, pb, { expectedPayloadHash: prep.body.payloadHash, confirmed: true });
  ok(!r.body.ok && r.body.code === "multi_composition_non_conforme", JSON.stringify(r.body));
  ok(!pb.journal.some(j => j.devis), "aucun POST de devis");
  eq(depot.etat.exports.at(-1).statut, "failed", "nouvelle tentative possible");
}
{
  // Famille non choisie : création impossible, message clair, aucune écriture
  const pb = creerProgbat();
  const prep = await appel("prepare", creerDepot({ famille: null }), pb);
  ok(!prep.body.valide && prep.body.erreurs.some(e => /famille ProGBat/.test(e.message)), "famille absente bloquante");
  // Action familles_multi : lecture seule
  const f = await srv.traiterRequeteDevis({ action: "familles_multi" }, { appelant: BUREAU, depot: creerDepot(), progbat: pb, maintenant: MAINTENANT });
  ok(f.body.ok && f.body.familles.length === 1 && f.body.choix.existe === true);
}

// ── 8. Copies lib des Edge Functions = sources ──────────────────────────────
{
  const args = { projet: projet(), lignes: lignesAvec(), lotsOrdre: LOTS, taxes: TAXES, liaisons: LIAISONS, multiOuvrages: [multi()], structuresMulti: planReutilise, aujourdHui: MAINTENANT };
  eq(genLib.construirePayloadDevisProGBat(args).payload, gen.construirePayloadDevisProGBat(args).payload, "copie lib : même payload");
  eq(moLib.libelleDevisMulti(multi(), lignesAvec()), mo.libelleDevisMulti(multi(), lignesAvec()));
}

console.log(`verif-multi-ouvrages : ${nbControles} contrôles OK (données fictives)`);
