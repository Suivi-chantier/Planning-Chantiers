import test from "node:test";
import assert from "node:assert/strict";
import { normaliserNumero, rapprocherFacture, verifierTotalFacture } from "../src/Renovation/rapprochementFactures.mjs";

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
