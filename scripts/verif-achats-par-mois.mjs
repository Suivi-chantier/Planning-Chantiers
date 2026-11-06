#!/usr/bin/env node
// Vérifie le module « Achats par mois de commande » (src/Renovation/achatsParMois.mjs).
// Aucun réseau, aucune base : DONNÉES FICTIVES, construites pour reproduire les
// situations du cahier (Rexel récapitulatif, Partedis, Zolpan, frais de pied de
// facture, avoir, facture directe, bon de commande remplacé par son BL…).
//   node scripts/verif-achats-par-mois.mjs
import assert from "node:assert/strict";
import { regrouperAchatsParMois, listerAchats, repartirCentimes, A_AFFECTER } from "../src/Renovation/achatsParMois.mjs";

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const r2 = (n) => Math.round(n * 100) / 100;
const mois = (res, m) => res.find(g => g.mois === m);
const fourn = (g, nom) => g?.parFournisseur.find(f => f.nom === nom);

// ─── FIXTURES (données fictives) ─────────────────────────────────────────────
const FOURNISSEURS = [
  { id: "f-rexel", nom: "REXEL", type_facturation: "recapitulative" },
  { id: "f-partedis", nom: "Partedis", type_facturation: "recapitulative" },
  { id: "f-zolpan", nom: "ZOLPAN", type_facturation: "par_livraison" },
  { id: "f-lm", nom: "LEROY MERLIN", type_facturation: null },
];
let n = 0;
const commandes = [], lignes = [];
const cmd = (o, ls) => {
  const id = o.id || `c${++n}`;
  commandes.push({ source: "mobile", statut_facturation: "en_attente_facture", facture_id: null, remplace_par_id: null, doc_type: "bl", ...o, id });
  (ls || [[o.montant_ht, "CH-A"]]).forEach(([p, ch]) => lignes.push({ commande_id: id, prix_total: p, chantier_id: ch }));
  return id;
};

// Rexel : 3 BL d'octobre (dont un rapproché avec écart), 2 BL du 02/11 en attente.
const rexelBl1 = cmd({ fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", doc_numero: "380001 / 4900", date_doc: "2026-10-03", montant_ht: 100 }, [[60, "CH-A"], [40, "CH-B"]]);
const rexelBl2 = cmd({ fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", doc_numero: "380002 / 4900", date_doc: "2026-10-15", montant_ht: 200 });
const rexelBl3 = cmd({ fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", doc_numero: "380003 / 4900", date_doc: "2026-10-28", montant_ht: 50 }, [[30, "CH-B"], [20, null]]);
cmd({ fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", doc_numero: "385851 / 4900", date_doc: "2026-11-02", montant_ht: 443.34 });
cmd({ fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", doc_numero: "385852 / 4900", date_doc: "2026-11-02", montant_ht: 667.42 });
// Partedis : BL du 01/10, montant saisi ≠ somme des lignes (25,91 vs 25,58).
const partedisBl = cmd({ fournisseur_id: "f-partedis", fournisseur_nom: "Partedis", doc_numero: "12143020/ 571678", date_doc: "2026-10-01", montant_ht: 25.91 }, [[25.58, "CH-A"]]);
// Zolpan : BL du 19/10.
const zolpanBl = cmd({ fournisseur_id: "f-zolpan", fournisseur_nom: "ZOLPAN", doc_numero: "15805160", date_doc: "2026-10-19", montant_ht: 198.95 });
// Leroy Merlin : ticket payé comptant, sans montant_ht (somme des lignes).
cmd({ fournisseur_id: "f-lm", fournisseur_nom: "LEROY MERLIN", doc_type: "ticket", doc_numero: "T1", date_doc: "2026-10-20", montant_ht: null, statut_facturation: "facture" }, [[10, "CH-A"], [5.5, "CH-C"]]);
// Exclusions : saisie de migration ; bon de commande remplacé par son BL.
cmd({ fournisseur_id: "f-lm", fournisseur_nom: "LEROY MERLIN", doc_numero: "OLD", date_doc: "2026-10-05", montant_ht: 999, source: "migration" });
const blRemplacant = cmd({ fournisseur_id: "f-zolpan", fournisseur_nom: "ZOLPAN", doc_numero: "BL-77", date_doc: "2026-12-02", montant_ht: 300 });
cmd({ fournisseur_id: "f-zolpan", fournisseur_nom: "ZOLPAN", doc_type: "bon_commande", doc_numero: "BC-77", date_doc: "2026-11-25", montant_ht: 300, remplace_par_id: blRemplacant });
// Commande sans aucune ligne -> « À affecter ».
cmd({ fournisseur_id: "f-lm", fournisseur_nom: "LEROY MERLIN", doc_numero: "T2", date_doc: "2026-09-10", montant_ht: 12, statut_facturation: "facture" }, []);

const factures = [
  // Facture récapitulative Rexel d'octobre, datée du 31/10, échéance fin novembre.
  { id: "fa-rexel", fournisseur_id: "f-rexel", fournisseur_nom: "REXEL", numero: "961106792", date_facture: "2026-10-31", date_echeance: "2026-11-30", montant_ht: 0, frais_ht: 9.90, type_document: "facture", statut: "rapprochee" },
  { id: "fa-partedis", fournisseur_id: "f-partedis", fournisseur_nom: "Partedis", numero: "9302109", date_facture: "2026-10-31", montant_ht: 25.91, type_document: "facture", statut: "rapprochee" },
  { id: "fa-zolpan", fournisseur_id: "f-zolpan", fournisseur_nom: "ZOLPAN", numero: "Z-10", date_facture: "2026-10-31", montant_ht: 200.29, type_document: "facture", statut: "rapprochee" },
  { id: "fa-directe", fournisseur_id: "f-lm", fournisseur_nom: "LEROY MERLIN", numero: "D-1", date_facture: "2026-09-15", montant_ht: 80, type_document: "facture", statut: "a_rapprocher" },
  { id: "av-1", fournisseur_id: "f-zolpan", fournisseur_nom: "ZOLPAN", numero: "AV-1", date_facture: "2026-11-04", montant_ht: -30, type_document: "avoir", statut: "a_rapprocher" },
  { id: "fa-archivee", fournisseur_id: "f-lm", fournisseur_nom: "LEROY MERLIN", numero: "ARCH", date_facture: "2026-10-10", montant_ht: 5000, type_document: "facture", statut: "archivee" },
];
const factureBl = [
  { id: "b1", facture_id: "fa-rexel", commande_id: rexelBl1, bl_numero: "380001", montant_ht: 100, statut: "conforme" },
  { id: "b2", facture_id: "fa-rexel", commande_id: rexelBl2, bl_numero: "380002", montant_ht: 212.5, statut: "ecart" },
  // BL présent sur la facture mais jamais saisi chez nous.
  { id: "b3", facture_id: "fa-rexel", commande_id: null, bl_numero: "380099", montant_ht: 21.40, date_livraison: "2026-10-22", statut: "absent" },
  // BL de facture non relié mais déjà saisi (même numéro) : pas de double compte.
  { id: "b4", facture_id: "fa-rexel", commande_id: null, bl_numero: "0380003", montant_ht: 50, date_livraison: "2026-10-28", statut: "absent" },
  { id: "b5", facture_id: "fa-partedis", commande_id: partedisBl, bl_numero: "12143020", montant_ht: 25.91, statut: "conforme" },
  { id: "b6", facture_id: "fa-zolpan", commande_id: zolpanBl, bl_numero: "15805160", montant_ht: 198.95, statut: "conforme" },
];
const facturesFrais = [
  { id: "ff1", facture_id: "fa-zolpan", libelle: "FFVDF", montant_ht: 1.34, chantier_id: null },
];
const avoirs = [{ facture_id: "av-1", chantier_id: "CH-A", montant_ht: -20 }];

const DONNEES = { commandes, lignes, factureBl, facturesFrais, avoirs, factures, fournisseurs: FOURNISSEURS, moisCourant: "2026-11" };
const RES = regrouperAchatsParMois(DONNEES);
const OCT = mois(RES, "2026-10");
const NOV = mois(RES, "2026-11");

// ─── CAS ─────────────────────────────────────────────────────────────────────
test("Les BL Rexel d'octobre restent en octobre (pas au mois d'échéance de la facture)", () => {
  const rx = fourn(OCT, "REXEL");
  // 100 (facturé) + 212,50 (facturé, écart +12,50) + 50 (attente) + 21,40 (BL non saisi) + 9,90 frais
  assert.equal(r2(rx.achete), 393.80);
  assert.equal(r2(rx.facture), 343.80);
  assert.equal(r2(rx.enAttente), 50);
  assert.ok(!mois(RES, "2026-11").parFournisseur.some(f => f.docs.some(d => d.numero.startsWith("38000"))));
});

test("Frais de pied de facture au mois de la facture (frais_ht à défaut de facture_frais)", () => {
  const d = fourn(OCT, "REXEL").docs.find(x => x.kind === "frais");
  assert.equal(d.montant, 9.9);
  assert.equal(d.facture, true);
});

test("BL rapproché avec écart : montant facturé retenu, écart vs saisi affiché", () => {
  const d = fourn(OCT, "REXEL").docs.find(x => x.numero === "380002 / 4900");
  assert.equal(d.montant, 212.5);
  assert.equal(d.saisi, 200);
  assert.equal(d.ecart, 12.5);
  assert.equal(r2(fourn(OCT, "REXEL").ecart), 12.5);
});

test("BL de facture jamais saisi : compté une fois ; déjà saisi sous un autre format : pas de double compte", () => {
  const docs = fourn(OCT, "REXEL").docs;
  assert.equal(docs.filter(d => d.kind === "bl_non_saisi").length, 1);
  assert.equal(docs.find(d => d.kind === "bl_non_saisi").numero, "380099");
});

test("Rexel 385851 / 385852 du 02/11 -> novembre, en attente de facture", () => {
  const rx = fourn(NOV, "REXEL");
  const ds = rx.docs.filter(d => /^38585[12]/.test(d.numero));
  assert.equal(ds.length, 2);
  assert.ok(ds.every(d => !d.facture));
  assert.equal(r2(rx.enAttente), 1110.76);
});

test("Partedis BL 12143020 du 01/10 (facture du 31/10) -> octobre, facturé", () => {
  const d = fourn(OCT, "Partedis").docs.find(x => x.numero.startsWith("12143020"));
  assert.equal(d.date, "2026-10-01");
  assert.equal(d.facture, true);
  assert.equal(d.factureNumero, "9302109");
});

test("Zolpan BL 15805160 du 19/10 et frais FFVDF 1,34 € -> octobre", () => {
  const z = fourn(OCT, "ZOLPAN");
  assert.ok(z.docs.some(d => d.numero === "15805160"));
  assert.equal(z.docs.find(d => d.kind === "frais").montant, 1.34);
  assert.equal(r2(z.achete), 200.29);
});

test("Avoir en négatif au mois de l'avoir, ventilé puis reste « À affecter »", () => {
  const z = fourn(NOV, "ZOLPAN");
  assert.equal(z.docs.find(d => d.kind === "avoir").montant, -30);
  const aff = NOV.parChantier.find(c => c.chantierId === null);
  assert.equal(r2(aff.achete), -10);
});

test("Facture directe sans BL au mois de la facture ; facture archivée ignorée", () => {
  const sep = mois(RES, "2026-09");
  const lm = fourn(sep, "LEROY MERLIN");
  assert.ok(lm.docs.some(d => d.kind === "facture_directe" && d.montant === 80));
  assert.ok(!RES.some(g => g.parFournisseur.some(f => f.docs.some(d => d.numero === "ARCH"))));
});

test("Exclusions : migration ignorée ; bon de commande remplacé -> BL compté une fois, à la date du bon", () => {
  assert.ok(!RES.some(g => g.parFournisseur.some(f => f.docs.some(d => d.numero === "OLD" || d.numero === "BC-77"))));
  const d = fourn(NOV, "ZOLPAN").docs.find(x => x.numero === "BL-77");
  assert.equal(d.date, "2026-11-25");
  assert.ok(!mois(RES, "2026-12"));
});

test("Montant d'un ticket sans montant_ht = somme des lignes ; ticket comptant = facturé", () => {
  const d = fourn(OCT, "LEROY MERLIN").docs.find(x => x.numero === "T1");
  assert.equal(d.montant, 15.5);
  assert.equal(d.facture, true);
});

test("Somme des chantiers d'un mois = total du mois (« À affecter » inclus), pour chaque mois", () => {
  for (const g of RES) {
    const s = g.parChantier.reduce((t, c) => t + Math.round(c.achete * 100), 0);
    assert.equal(s, Math.round(g.achete * 100), g.mois);
    const sf = g.parFournisseur.reduce((t, f) => t + Math.round(f.achete * 100), 0);
    assert.equal(sf, Math.round(g.achete * 100), g.mois);
    assert.equal(Math.round((g.facture + g.enAttente) * 100), Math.round(g.achete * 100), g.mois);
  }
});

test("Montant saisi ≠ somme des lignes : répartition au prorata, sans centime perdu", () => {
  assert.deepEqual(repartirCentimes(2591, [2558]), [2591]);
  assert.deepEqual(repartirCentimes(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(repartirCentimes(-1000, [1, 1, 1]), [-334, -333, -333]);
  assert.equal(repartirCentimes(100, [0, 0]), null);
});

test("Ligne sans chantier et commande sans ligne -> « À affecter »", () => {
  assert.ok(OCT.parChantier.some(c => c.chantierId === null));
  assert.equal(OCT.parChantier.at(-1).chantierId, null); // toujours en dernier
  const sep = mois(RES, "2026-09");
  assert.equal(r2(sep.parChantier.find(c => c.chantierId === null).achete), 92); // 12 + facture directe 80
});

test("Signal « absent de la facture » : BL d'un mois clos, fournisseur récapitulatif, facture du mois saisie", () => {
  const d3 = fourn(OCT, "REXEL").docs.find(x => x.numero === "380003 / 4900");
  assert.equal(d3.absentFacture, true);
  assert.equal(fourn(OCT, "REXEL").absentFacture, true);
  // Novembre n'est pas clos : pas de signal.
  assert.ok(fourn(NOV, "REXEL").docs.every(d => !d.absentFacture));
  // Fournisseur « par livraison » : jamais de signal.
  const sans = listerAchats({ ...DONNEES, moisCourant: "2027-01" }).filter(a => a.fournisseur === "ZOLPAN");
  assert.ok(sans.every(a => !a.absentFacture));
});

test("Filtres : fournisseur, statut, chantier", () => {
  const f = regrouperAchatsParMois(DONNEES, { fournisseur: "REXEL" });
  assert.ok(f.every(g => g.parFournisseur.every(x => x.nom === "REXEL")));
  const att = regrouperAchatsParMois(DONNEES, { statut: "en_attente" });
  assert.ok(att.every(g => g.facture === 0));
  const fac = regrouperAchatsParMois(DONNEES, { statut: "facture" });
  assert.ok(fac.every(g => g.enAttente === 0));
  const chB = mois(regrouperAchatsParMois(DONNEES, { chantier: "CH-B" }), "2026-10");
  // BL1 : 40 % de 100 = 40 ; BL3 : 30/50 de 50 = 30
  assert.equal(r2(chB.achete), 70);
  assert.deepEqual(chB.parChantier.map(c => c.chantierId), ["CH-B"]);
  const aff = mois(regrouperAchatsParMois(DONNEES, { chantier: A_AFFECTER }), "2026-10");
  assert.ok(aff.parChantier.every(c => c.chantierId === null));
});

test("Mois triés du plus récent au plus ancien", () => {
  const ms = RES.map(g => g.mois);
  assert.deepEqual(ms, [...ms].sort().reverse());
});

test("Module pur : aucune dépendance Supabase ni horloge", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/Renovation/achatsParMois.mjs", import.meta.url), "utf8");
  assert.ok(!/supabase|new Date\(|Date\.now/.test(src));
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); }
}
console.log(`\n${ok}/${cas.length} cas OK (données fictives)`);
if (ok !== cas.length) process.exit(1);
