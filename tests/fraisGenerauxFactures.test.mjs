// Données fictives : aucun appel à la base.
import test from "node:test";
import assert from "node:assert/strict";
import { fraisGenerauxParMois } from "../src/Renovation/fraisGenerauxFactures.mjs";

test("frais généraux des factures : par mois, factures validées de l'année seulement", () => {
  const lignes = [
    { montant_ht: 4.2, libelle: "Frais facturation", facture: { numero: "9302109", date_facture: "2026-10-31", statut: "rapprochee", fournisseur_nom: "Partedis" } },
    { montant_ht: 3.1, libelle: "Frais facturation", facture: { numero: "A", date_facture: "2026-10-05", statut: "rapprochee" } },
    { montant_ht: 2, libelle: "x", facture: { numero: "B", date_facture: "2026-11-02", statut: "a_rapprocher" } },
    { montant_ht: 9, libelle: "x", facture: { numero: "C", date_facture: "2025-10-02", statut: "rapprochee" } },
    { montant_ht: 1, libelle: "x", facture: null },
  ];
  const r = fraisGenerauxParMois(lignes, 2026);
  assert.deepEqual(r.parMois, { "10": 7.3 });
  assert.equal(r.total, 7.3);
  assert.deepEqual(r.detail.map(d => d.numero), ["9302109", "A"]);
});

test("aucune ligne → total 0, rien par mois", () => {
  assert.deepEqual(fraisGenerauxParMois([], 2026), { parMois: {}, total: 0, detail: [] });
});
