import test from "node:test";
import assert from "node:assert/strict";
import { normaliserNumero, rapprocherFacture, verifierTotalFacture, statutLiaisonBl, appliquerRegleMontantBl,
  normaliserCommandeRexel, cleCommande, estNumeroCommande } from "../src/Renovation/rapprochementFactures.mjs";

test("normalisation conservative et configurable", () => {
  assert.equal(normaliserNumero(" 000383104 "), "383104");
  assert.equal(normaliserNumero("4900-000917429"), "4900-000917429");
  assert.equal(normaliserNumero("383104 / 4900", { retirerAgence: true }), "383104");
  assert.equal(normaliserNumero("CL-4900-619330811-02"), "CL-4900-619330811-02");
});
test("ne rapproche jamais deux fournisseurs distincts", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30",
    livraisons: [{ bl_numero: "000383104", montant_ht: 100 }],
    documents: [{ id: "a", fournisseur_id: "partedis", doc_numero: "383104", montant_ht: 100, statut_facturation: "en_attente_facture" }] });
  assert.equal(r.rapprochements[0].document, null);
});
test("appariement strict, montant divergent signalé", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30",
    livraisons: [{ bl_numero: "000383104", montant_ht: 100.12 }],
    documents: [{ id: "a", fournisseur_id: "rexel", doc_numero: "383104", montant_ht: 100, statut_facturation: "en_attente_facture" }] });
  assert.equal(r.rapprochements[0].document.id, "a");
  assert.equal(r.rapprochements[0].conforme, false);
  assert.equal(r.rapprochements[0].ecartCentimes, 12);
});
test("montant seul = proposition humaine, pas de lien automatique", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30",
    livraisons: [{ bl_numero: "999", date_livraison: "2026-09-22", montant_ht: 50 }],
    documents: [{ id: "a", fournisseur_id: "rexel", doc_numero: "888", date_doc: "2026-09-23", montant_ht: 50, statut_facturation: "en_attente_facture" }] });
  assert.equal(r.rapprochements[0].document, null);
  assert.equal(r.rapprochements[0].confirmationRequise, true);
});
test("frais séparés inclus dans contrôle total", () => {
  const r = verifierTotalFacture({ livraisons: [{ montant_ht: 100 }], frais: [{ montant_ht: 1.34 }], total_ht: 101.34 });
  assert.equal(r.conforme, true);
});

test("numéros en collision : aucune attribution arbitraire", () => {
  const r = rapprocherFacture({ fournisseurId: "R", dateFacture: "2026-09-30",
    livraisons: [{ bl_numero: "000123", montant_ht: 50 }],
    documents: ["a","b"].map(id => ({ id, fournisseur_id: "R", doc_numero: "123", montant_ht: 50, statut_facturation: "en_attente_facture" })) });
  assert.equal(r.rapprochements[0].document, null);
  assert.equal(r.rapprochements[0].propositions.length, 2);
});

test("Rexel: un bon couvre deux livraisons, proposition sans liaison", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30",
    livraisons: [{ bl_numero: "A", montant_ht: 423.67 }, { bl_numero: "B", montant_ht: 54.78 }],
    documents: [{ id: "po", fournisseur_id: "rexel", doc_numero: "C", montant_ht: 478.45, statut_facturation: "en_attente_facture" }] });
  assert.equal(r.rapprochements[0].document, null);
  assert.equal(r.rapprochements[1].propositions[0].mode, "regroupement");
});

test("Rexel : CL-<agence>- côté facture et « / <agence> » côté base donnent le même numéro", () => {
  const regles = { prefixes: ["CL-4900-", "CL-4903-"], retirerAgence: true };
  assert.equal(normaliserNumero("CL-4900-619330811-02", regles), "619330811-02");
  assert.equal(normaliserNumero("619330811-02 / 4900", regles), "619330811-02");
  assert.equal(normaliserNumero("CL-4901-619330811-02", { retirerAgence: true }), "619330811-02");
  assert.equal(normaliserNumero("619330811-02/4901", { retirerAgence: true }), "619330811-02");
  assert.equal(normaliserNumero("383104 / 4900", regles), "383104");
  // Sans la règle, rien n'est retiré ; un numéro qui n'a pas la forme attendue reste intact.
  assert.equal(normaliserNumero("619330811-02 / 4900"), "619330811-02/4900");
  assert.equal(normaliserNumero("4900-000917429", regles), "4900-000917429");
  assert.equal(normaliserNumero("CL-ABCD-12", regles), "CL-ABCD-12");
});

test("Rexel : le BL CL-4900-… est apparié par numéro au bon « … / 4900 »", () => {
  const regles = { prefixes: ["CL-4900-", "CL-4903-"], retirerAgence: true };
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-11-27", regles,
    livraisons: [{ bl_numero: "CL-4900-619330811-02", montant_ht: 182.83 }],
    documents: [{ id: "a", fournisseur_id: "rexel", doc_numero: "619330811-02 / 4900", montant_ht: 182.83, date_doc: "2026-11-10", statut_facturation: "en_attente_facture" }] });
  assert.equal(r.rapprochements[0].document.id, "a");
  assert.equal(r.rapprochements[0].mode, "numero");
  assert.equal(r.rapprochements[0].conforme, true);
});

test("statut d'une liaison : uniquement les montants, quel que soit le mode", () => {
  for (const mode of ["numero", "montant", "numero_ambigu", "commande"]) {
    assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 33.66, commandeMontant: 33.66, mode_rapprochement: mode }), "rapproche");
    assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 33.66, commandeMontant: 34.66, mode_rapprochement: mode }), "ecart");
  }
  assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 10.04, commandeMontant: 10 }, undefined, 0.05), "rapproche");
  assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 10.06, commandeMontant: 10 }, undefined, 0.05), "ecart");
  assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 10.5, commandeMontant: 10 }, undefined, 1), "rapproche");
  assert.equal(statutLiaisonBl({ commande_id: null, montant_ht: 10 }), "manquant");
  // Montant inconnu : jamais présenté comme conforme.
  assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: null, commandeMontant: 10 }), "ecart");
  assert.equal(statutLiaisonBl({ commande_id: "c", montant_ht: 10, commandeMontant: null }), "ecart");
});

test("regroupement : les BL liés au même bon sont comparés ensemble", () => {
  const a = { commande_id: "c", montant_ht: 60, commandeMontant: 100, mode_rapprochement: "regroupement" };
  const b = { commande_id: "c", montant_ht: 40, commandeMontant: 100, mode_rapprochement: "regroupement" };
  assert.equal(statutLiaisonBl(a, [a, b]), "rapproche");
  assert.equal(statutLiaisonBl(a, [a]), "ecart");
});

test("Partedis (montant_bl = total_ht_facture) : port, énergie, éco-taxe dans le BL ; frais de facturation à part", () => {
  const regles = { retirerClient: true, montant_bl: "total_ht_facture" };
  // Exemple sur données fictives reprenant les montants des factures Partedis d'octobre.
  const a = appliquerRegleMontantBl({ regles, totalHt: 52.61,
    bls: [{ bl_numero: "12211060", montant_ht: 42.61 }],
    frais: [{ libelle: "Participation frais de port", montant_ht: 10 }] });
  assert.equal(a.applique, true);
  assert.equal(a.bls[0].montant_ht, 52.61);
  assert.deepEqual(a.frais, []);
  const b = appliquerRegleMontantBl({ regles, totalHt: 30,
    bls: [{ bl_numero: "1", montant_ht: 20 }],
    frais: [{ libelle: "Energ.", montant_ht: 1.5 }, { libelle: "Frais facturation", montant_ht: 4.2 }, { libelle: "Part. frais port", montant_ht: 4.3 }] });
  assert.equal(b.bls[0].montant_ht, 25.8);
  assert.deepEqual(b.frais.map(f => f.libelle), ["Frais facturation"]);
  const v = verifierTotalFacture({ livraisons: b.bls, frais: b.frais, total_ht: 30 });
  assert.equal(v.conforme, true);
});

test("règle montant_bl : sans effet par défaut (Rexel), ni sur plusieurs BL, ni sans total", () => {
  const bls = [{ montant_ht: 10 }]; const frais = [{ libelle: "Port", montant_ht: 2 }];
  assert.equal(appliquerRegleMontantBl({ regles: {}, bls, frais, totalHt: 12 }).applique, false);
  assert.equal(appliquerRegleMontantBl({ regles: { montant_bl: "sous_total_bl" }, bls, frais, totalHt: 12 }).bls[0].montant_ht, 10);
  const deux = appliquerRegleMontantBl({ regles: { montant_bl: "total_ht_facture" }, bls: [{ montant_ht: 5 }, { montant_ht: 5 }], frais, totalHt: 12 });
  assert.equal(deux.applique, false); assert.equal(deux.frais.length, 1);
  assert.equal(appliquerRegleMontantBl({ regles: { montant_bl: "total_ht_facture" }, bls, frais, totalHt: null }).applique, false);
});

// ── Tâche 2 : « Notre Réf » Rexel = n° de commande (exemples issus des tests,
// données fictives reprenant les n° du cahier, facture 960676175).
const REGLES_REXEL = { alias: ["REXEL France"], prefixes: ["CL-4900-", "CL-4903-"], retirerAgence: true };
const docRexel = (x) => ({ fournisseur_id: "rexel", statut_facturation: "en_attente_facture", date_doc: "2026-09-22", ...x });

test("n° de commande Rexel : toutes les écritures connues donnent la même clé", () => {
  // Formes vues sur la facture, l'extranet / accusé de réception et en base.
  for (const v of ["4900000917429", "4900-000917429", "000917429 / 4900", "917429/4900", " 4900 - 000917429 ",
    "Notre Réf: 4900000917429 du 22/09/2026", "4900000917429 du 22/09/2026"]) {
    assert.equal(normaliserCommandeRexel(v), "4900-917429", v);
  }
  assert.equal(normaliserCommandeRexel("000918754 / 4900"), "4900-918754");
  assert.equal(normaliserCommandeRexel("000247142 / 4903"), "4903-247142");
  // Autre agence ou autre commande : clés différentes.
  assert.notEqual(normaliserCommandeRexel("4903000917429"), normaliserCommandeRexel("4900000917429"));
  assert.notEqual(normaliserCommandeRexel("4900000917428"), normaliserCommandeRexel("4900000917429"));
  // Ce qui n'a pas la forme agence + n° n'est pas lu comme une commande Rexel.
  for (const v of ["FOURMOND", "TOUR BOUTON", "", null, "CL-4900-619330811-02", "619330811-02 / 4900", "490000091742"]) {
    assert.equal(normaliserCommandeRexel(v), null, String(v));
  }
});

test("« Votre commande » (référence client) n'est jamais un n° de commande", () => {
  for (const v of ["FOURMOND", "FOURMOND Chantier n° TLV", "TOUR BOUTON", "MONTILLERS T3", "KATHLEEN", "", null]) {
    assert.equal(estNumeroCommande(v), false, String(v));
    assert.equal(cleCommande(v, REGLES_REXEL), "", String(v));
  }
  for (const v of ["4900000917429", "000918754 / 4900", "18046692", "2283584033"]) assert.equal(estNumeroCommande(v), true, v);
  // Sans la règle d'agence (autre fournisseur), comparaison par n° normalisé.
  assert.equal(cleCommande("018046692"), "18046692");
  assert.equal(cleCommande("4900000917429", REGLES_REXEL), cleCommande("4900-000917429", REGLES_REXEL));
});

test("Rexel : BL 000383912 apparié via « Notre Réf » à la commande saisie 4900-000917429 (même montant)", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30", regles: REGLES_REXEL,
    livraisons: [{ bl_numero: "000383912", commande_numero: "4900000917429", reference_client: "TOUR BOUTON", date_livraison: "2026-09-22", montant_ht: 33.66 }],
    documents: [docRexel({ id: "cmd", doc_numero: "4900-000917429", montant_ht: 33.66 }),
      docRexel({ id: "autre", doc_numero: "384456 / 4900", montant_ht: 116.71 })] });
  const a = r.rapprochements[0];
  assert.equal(a.document.id, "cmd");
  assert.equal(a.mode, "commande");
  assert.equal(a.confirmationRequise, false);
  assert.equal(a.conforme, true);
  assert.equal(statutLiaisonBl({ commande_id: "cmd", montant_ht: 33.66, commandeMontant: 33.66, mode_rapprochement: a.mode }), "rapproche");
});

test("Rexel : même n° de commande comparé à numero_commande_fournisseur, toutes écritures", () => {
  for (const ncf of ["4900-000917429", "000917429 / 4900", "917429/4900", "4900000917429"]) {
    const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30", regles: REGLES_REXEL,
      livraisons: [{ bl_numero: "000383912", commande_numero: "4900000917429", montant_ht: 33.66 }],
      documents: [docRexel({ id: "a", doc_numero: "999999 / 4900", numero_commande_fournisseur: ncf, montant_ht: 33.66 })] });
    assert.equal(r.rapprochements[0].document?.id, "a", ncf);
    assert.equal(r.rapprochements[0].mode, "commande", ncf);
  }
});

test("Rexel : même n° de commande mais montant différent → proposition, pas d'appariement", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30", regles: REGLES_REXEL,
    livraisons: [{ bl_numero: "000383912", commande_numero: "4900000917429", date_livraison: "2026-09-22", montant_ht: 33.66 }],
    documents: [docRexel({ id: "cmd", doc_numero: "4900-000917429", montant_ht: 40.12 })] });
  const a = r.rapprochements[0];
  assert.equal(a.document, null);
  assert.equal(a.confirmationRequise, true);
  assert.deepEqual(a.propositions.map(p => [p.document.id, p.mode]), [["cmd", "commande"]]);
});

test("Rexel : autre agence ou autre commande → pas d'appariement par n° de commande", () => {
  for (const doc_numero of ["4903-000917429", "4900-000917428"]) {
    const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30", regles: REGLES_REXEL,
      livraisons: [{ bl_numero: "000383912", commande_numero: "4900000917429", date_livraison: "2026-09-22", montant_ht: 33.66 }],
      documents: [docRexel({ id: "x", doc_numero, montant_ht: 33.66 })] });
    assert.equal(r.rapprochements[0].document, null, doc_numero);
    // Seule la proposition par montant (confirmation humaine) subsiste.
    assert.deepEqual(r.rapprochements[0].propositions.map(p => p.mode), ["montant"], doc_numero);
  }
});

test("« Votre commande FOURMOND » rangé par erreur en n° de commande : jamais d'appariement par commande", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-10-31", regles: REGLES_REXEL,
    livraisons: [{ bl_numero: "CL-4900-619451058-01", commande_numero: "FOURMOND", date_livraison: "2026-10-23", montant_ht: 1200.75 }],
    documents: [docRexel({ id: "f", doc_numero: "FOURMOND", numero_commande_fournisseur: "FOURMOND", date_doc: "2026-10-01", montant_ht: 1200.75 })] });
  assert.equal(r.rapprochements[0].document, null);
  assert.ok(!r.rapprochements[0].propositions.some(p => p.mode === "commande"));
});

test("le n° de BL reste prioritaire sur le n° de commande", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-09-30", regles: REGLES_REXEL,
    livraisons: [{ bl_numero: "000383448", commande_numero: "4900000915728", montant_ht: 423.67 }],
    documents: [docRexel({ id: "bc", doc_numero: "4900-000915728", montant_ht: 423.67 }),
      docRexel({ id: "bl", doc_numero: "383448 / 4900", montant_ht: 423.67 })] });
  assert.equal(r.rapprochements[0].document.id, "bl");
  assert.equal(r.rapprochements[0].mode, "numero");
});

// ── Würth (tâche 3) — exemples issus des tests, données fictives reprenant les
// n° du cahier : facture 4336131218 du 29/10/2026, 61,08 € HT, « Commande
// 2283584033 », « Livraison/Date 8173115263/ 29.10.2026 ».
const REGLES_WURTH = { alias: ["Würth France", "WURTH PROXI SHOP"], numero_facture_d_abord: true };
const docWurth = (x) => ({ fournisseur_id: "wurth", statut_facturation: "en_attente_facture", date_doc: "2026-10-29", ...x });
const factureWurth = (bl = {}) => ({ fournisseurId: "wurth", dateFacture: "2026-10-29", regles: REGLES_WURTH,
  livraisons: [{ bl_numero: null, numero_livraison: "8173115263", commande_numero: "2283584033",
    facture_numero: "4336131218", date_livraison: "2026-10-29", montant_ht: 61.08, ...bl }] });

test("Würth : ticket comptoir 4336131218 (même n° que la facture) trouvé via le n° de facture", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "ticket", doc_type: "ticket", doc_numero: "4336131218", montant_ht: 61.08 }),
    docWurth({ id: "autre", doc_type: "ticket", doc_numero: "4336038499", date_doc: "2026-10-19", montant_ht: 163.26 })] });
  const a = r.rapprochements[0];
  assert.equal(a.document.id, "ticket");
  assert.equal(a.mode, "numero_facture");
  assert.equal(a.confirmationRequise, false);
  assert.equal(a.conforme, true);
  assert.equal(a.ecartCentimes, 0);
});

test("Würth : ticket saisi avec le n° de livraison 8173115263 trouvé (bl_numero absent → numero_livraison)", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "liv", doc_type: "ticket", doc_numero: "8173115263", montant_ht: 61.08 })] });
  assert.equal(r.rapprochements[0].document.id, "liv");
  assert.equal(r.rapprochements[0].mode, "numero");
  assert.equal(r.rapprochements[0].conforme, true);
});

test("Würth : achat saisi avec le n° de commande 2283584033 trouvé si même montant", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "cde", doc_type: "bl", doc_numero: "BL-COMPTOIR", numero_commande_fournisseur: "2283584033", montant_ht: 61.08 })] });
  assert.equal(r.rapprochements[0].document.id, "cde");
  assert.equal(r.rapprochements[0].mode, "commande");
});

test("Würth : ticket absent → BL manquant, sans écart fantôme", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "juillet", doc_type: "bl", doc_numero: "8160735781", date_doc: "2026-07-13", montant_ht: 22.24 }),
    docWurth({ id: "autre", doc_type: "ticket", doc_numero: "4336038499", date_doc: "2026-10-19", montant_ht: 163.26 })] });
  const a = r.rapprochements[0];
  assert.equal(a.document, null);
  assert.equal(a.conforme, false);
  assert.equal(a.ecartCentimes, undefined);
  assert.deepEqual(a.propositions, []);
  assert.equal(statutLiaisonBl({ commande_id: null, montant_ht: 61.08 }), "manquant");
});

test("Würth : même n° de facture mais montant différent → proposition, jamais un écart automatique", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "ticket", doc_type: "ticket", doc_numero: "4336131218", montant_ht: 59.10 })] });
  const a = r.rapprochements[0];
  assert.equal(a.document, null);
  assert.equal(a.confirmationRequise, true);
  assert.deepEqual(a.propositions.map(p => [p.document.id, p.mode]), [["ticket", "numero_facture"]]);
});

test("Würth : n° de facture d'abord, puis n° de livraison si le ticket ne correspond pas en montant", () => {
  const r = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "ticket", doc_type: "ticket", doc_numero: "4336131218", montant_ht: 59.10 }),
    docWurth({ id: "bl", doc_type: "bl", doc_numero: "8173115263", montant_ht: 61.08 })] });
  assert.equal(r.rapprochements[0].document.id, "bl");
  assert.equal(r.rapprochements[0].mode, "numero");
  // Würth : n° de facture prioritaire quand les deux conviennent.
  const r2 = rapprocherFacture({ ...factureWurth(), documents: [
    docWurth({ id: "bl", doc_type: "bl", doc_numero: "8173115263", montant_ht: 61.08 }),
    docWurth({ id: "ticket", doc_type: "ticket", doc_numero: "4336131218", montant_ht: 61.08 })] });
  assert.equal(r2.rapprochements[0].document.id, "ticket");
  assert.equal(r2.rapprochements[0].mode, "numero_facture");
});

test("Rexel inchangé avec le n° de facture transmis : le n° de BL reste prioritaire", () => {
  const r = rapprocherFacture({ fournisseurId: "rexel", dateFacture: "2026-10-31", regles: REGLES_REXEL,
    livraisons: [{ bl_numero: "CL-4900-619330811-02", facture_numero: "961106792", montant_ht: 120.5 },
      { bl_numero: "000383104", facture_numero: "961106792", montant_ht: 100.12 }],
    documents: [docRexel({ id: "fact", doc_numero: "961106792", montant_ht: 120.5 }),
      docRexel({ id: "cl", doc_numero: "619330811-02 / 4900", montant_ht: 120.5 }),
      docRexel({ id: "bl", doc_numero: "383104 / 4900", montant_ht: 100 })] });
  assert.deepEqual(r.rapprochements.map(x => [x.document?.id, x.mode]), [["cl", "numero"], ["bl", "numero"]]);
  // Le BL exact lie même si le montant diffère (écart signalé).
  assert.equal(r.rapprochements[1].ecartCentimes, 12);
});

test("n° de facture en dernier recours (Rexel, Partedis) : montant égal exigé", () => {
  const base = { fournisseurId: "partedis", dateFacture: "2026-10-31", regles: { montant_bl: "total_ht_facture", retirerClient: true } };
  const doc = (montant_ht) => ({ id: "f", fournisseur_id: "partedis", statut_facturation: "en_attente_facture", date_doc: "2026-10-20", doc_numero: "9302111/571678", montant_ht });
  const ok = rapprocherFacture({ ...base, livraisons: [{ bl_numero: "12196097/ 571678", facture_numero: "9302111", montant_ht: 52.61 }], documents: [doc(52.61)] });
  assert.equal(ok.rapprochements[0].document.id, "f");
  assert.equal(ok.rapprochements[0].mode, "numero_facture");
  const ko = rapprocherFacture({ ...base, livraisons: [{ bl_numero: "12196097/ 571678", facture_numero: "9302111", montant_ht: 52.61 }], documents: [doc(48)] });
  assert.equal(ko.rapprochements[0].document, null);
  assert.deepEqual(ko.rapprochements[0].propositions.map(p => p.mode), ["numero_facture"]);
});
