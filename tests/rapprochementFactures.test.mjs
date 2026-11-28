import test from "node:test";
import assert from "node:assert/strict";
import { normaliserNumero, rapprocherFacture, verifierTotalFacture, statutLiaisonBl } from "../src/Renovation/rapprochementFactures.mjs";

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
