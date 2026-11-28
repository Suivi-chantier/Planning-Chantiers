// Données fictives inspirées des factures Rexel / Partedis : aucun appel à la base.
import test from "node:test";
import assert from "node:assert/strict";
import { diviserLigne, lireQuantite, preparerLignesBl, proposerChantiers, noteReferenceClient, memeNumeroBl, squelette } from "../src/Renovation/saisieBlFacture.mjs";

const CHANTIERS = [
  { id: "f001", nom: "FOURMOND 001" }, { id: "f101", nom: "FOURMOND 101" },
  { id: "f102", nom: "FOURMOND 102" }, { id: "fcom", nom: "FOURMOND COMMUNS" },
  { id: "kath", nom: "Kathleen BILLAUD — Faux plafond entrée" },
  { id: "mont1", nom: "MONTILLERS APPT 1 (T3)" }, { id: "mont2", nom: "MONTILLERS APPT 2 (T2)" },
  { id: "tb101", nom: "TOURBOUTON 101" }, { id: "maud", nom: "MAUDUIT" },
  { id: "pc", nom: "Parties communes — Communs" }, { id: "dep", nom: "DÉPOT" },
];

test("lignes du BL : éco-participation comprise, somme = sous-total", () => {
  const r = preparerLignesBl([
    { reference: "ATL425424", libelle: "SOLIUS NEO H 1000W BLC", quantite: 6, unite: "U", prix_unitaire: 115, prix_total: 690 },
    { reference: "ES1408", libelle: "Éco-participation", quantite: 6, prix_unitaire: 1.75, prix_total: 10.5 },
    { reference: "ATL425427", libelle: "SOLIUS NEO H 2000W BLC", quantite: 3, unite: "U", prix_unitaire: 165, prix_total: 495 },
    { reference: "ES1408", libelle: "Éco-participation", quantite: 3, prix_unitaire: 1.75, prix_total: "5,25" },
  ], 1200.75);
  assert.equal(r.lignes.length, 4);
  assert.equal(r.sommeHt, 1200.75);
  assert.equal(r.ecartHt, 0);
  assert.equal(r.conforme, true);
});

test("lignes du BL : somme différente ou ligne sans montant = non conforme", () => {
  assert.equal(preparerLignesBl([{ libelle: "A", prix_total: 100 }], 120).conforme, false);
  assert.equal(preparerLignesBl([{ libelle: "A", prix_total: 100 }], 120).ecartHt, -20);
  assert.equal(preparerLignesBl([{ libelle: "A", prix_total: null }, { libelle: "B", prix_total: 120 }], 120).conforme, false);
  assert.equal(preparerLignesBl([], 120).conforme, false);
  const inconnu = preparerLignesBl([{ libelle: "A", prix_total: 100 }], null);
  assert.equal(inconnu.conforme, false);
  assert.equal(inconnu.montantInconnu, true);
  assert.equal(preparerLignesBl([{ libelle: "A", prix_total: 100.04 }], 100).conforme, true);
});

test("squelettes : fautes de frappe courantes", () => {
  assert.equal(squelette("KATHLEEN"), squelette("Kateline"));
  assert.equal(squelette("KATELEEN"), squelette("kathleen"));
  assert.equal(squelette("MONTILLIERS"), squelette("Montillers"));
  assert.equal(squelette("MONTILLER"), squelette("MONTILLERS"));
});

test("chantier proposé : un seul candidat → proposé", () => {
  assert.deepEqual(proposerChantiers("KATELEEN", CHANTIERS), { propose: "kath", candidats: ["kath"] });
  assert.deepEqual(proposerChantiers("Kateline", CHANTIERS), { propose: "kath", candidats: ["kath"] });
  assert.deepEqual(proposerChantiers("TOUR BOUTON", CHANTIERS), { propose: "tb101", candidats: ["tb101"] });
  assert.deepEqual(proposerChantiers("mauduit", CHANTIERS), { propose: "maud", candidats: ["maud"] });
});

test("chantier proposé : plusieurs chantiers du même nom → choix humain", () => {
  const r = proposerChantiers("FOURMOND Chantier n° TLV", CHANTIERS);
  assert.equal(r.propose, null);
  assert.deepEqual(r.candidats, ["f001", "f101", "f102", "fcom"]);
  assert.deepEqual(proposerChantiers("MONTILLIERS", CHANTIERS).candidats, ["mont1", "mont2"]);
});

test("chantier proposé : rien de fiable → aucun", () => {
  assert.deepEqual(proposerChantiers("", CHANTIERS), { propose: null, candidats: [] });
  assert.deepEqual(proposerChantiers("Chantier n° TLV", CHANTIERS), { propose: null, candidats: [] });
  assert.deepEqual(proposerChantiers("PARTIES COMMUNES", CHANTIERS), { propose: null, candidats: [] });
  assert.deepEqual(proposerChantiers("DEPOT", CHANTIERS), { propose: null, candidats: [] });
});

test("référence client conservée en note, sans doublon", () => {
  assert.equal(noteReferenceClient("FOURMOND — Chantier n° TLV"), "Réf. client : FOURMOND — Chantier n° TLV");
  assert.equal(noteReferenceClient("X", "Note"), "Note\nRéf. client : X");
  assert.equal(noteReferenceClient("X", "Note\nRéf. client : X"), "Note\nRéf. client : X");
  assert.equal(noteReferenceClient("", "Note"), "Note");
  assert.equal(noteReferenceClient(null), null);
});

test("numéro de BL lu = numéro de la commande", () => {
  assert.equal(memeNumeroBl("CL-4900-619451058-01", "cl-4900-619451058-01 "), true);
  assert.equal(memeNumeroBl("000383912", "383912"), true);
  assert.equal(memeNumeroBl("CL-4900-619451058-01", "CL-4900-619451058-02"), false);
  assert.equal(memeNumeroBl("", ""), false);
  // Rexel : même BL écrit à la façon de la facture et à la façon du BL.
  assert.equal(memeNumeroBl("619451058-01 / 4900", "CL-4900-619451058-01"), true);
  assert.equal(memeNumeroBl("619451058-02 / 4900", "CL-4900-619451058-01"), false);
});

test("quantités lues sur un BL (texte libre)", () => {
  assert.deepEqual(lireQuantite("5 m²"), { quantite: 5, unite: "m²" });
  assert.deepEqual(lireQuantite("2,5 ML"), { quantite: 2.5, unite: "ML" });
  assert.deepEqual(lireQuantite(6), { quantite: 6, unite: "" });
  assert.deepEqual(lireQuantite("?"), { quantite: null, unite: "" });
  const r = preparerLignesBl([{ designation: "Plaque", quantite: "10 m²", prix_total: 50 }], 50);
  assert.equal(r.lignes[0].libelle, "Plaque");
  assert.equal(r.lignes[0].quantite, 10);
  assert.equal(r.lignes[0].unite, "m²");
});

test("diviser une ligne : deux moitiés dont la somme = la ligne", () => {
  const [a, b] = diviserLigne({ libelle: "SOLIUS", quantite: 3, prix_total: 495, chantier_id: "f001", lot_id: "elec" });
  assert.equal(a.quantite, 2); assert.equal(b.quantite, 1);
  assert.equal(a.prix_total, 330); assert.equal(b.prix_total, 165);
  assert.equal(a.chantier_id, "f001"); assert.equal(b.chantier_id, ""); assert.equal(b.lot_id, "");
  const [c, d] = diviserLigne({ quantite: 3, prix_total: 5.25 });
  assert.equal(Math.round((c.prix_total + d.prix_total) * 100), 525);
  const [e, f] = diviserLigne({ quantite: null, prix_total: 10.01 });
  assert.equal(Math.round((e.prix_total + f.prix_total) * 100), 1001);
});
