// Vérifie src/Renovation/cibleJourneeOuvrier.mjs : la cible d'heures du compte
// rendu (et du garde-fou de validation) retire les absences saisies dans
// Réglages → Ressources. Données fictives.
// Lancer : node --experimental-default-type=module scripts/verif-cible-journee-ouvrier.mjs
import assert from "node:assert/strict";
import { cibleJourneeOuvrier, ressourceDeLOuvrier, indisponibilitesDuJour } from "../src/Renovation/cibleJourneeOuvrier.mjs";
import { calculerCapaciteRessource } from "../src/Renovation/planningResourceModelV1.js";

const R = "res-a";
const ev = (extra) => ({ id: "e" + Math.random(), resource_id: R, type: "absence", date_debut: "2026-10-08", date_fin: "2026-10-08", toute_journee: false, heures_indisponibles: null, actif: true, ...extra });

// 1. Sans absence : cible = heures du jour, aucune explication.
let c = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: [], resourceId: R, dateISO: "2026-10-08" });
assert.deepEqual([c.cible, c.retraitHeures, c.explication], [8.75, 0, null]);

// 2. Absence partielle 3,75 h : 8h45 → 5h.
c = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: [ev({ heures_indisponibles: "3.75", motif: "RDV" })], resourceId: R, dateISO: "2026-10-08" });
assert.equal(c.cible, 5);
assert.equal(c.retraitHeures, 3.75);
assert.equal(c.explication, "8h45 − 3h45 d'absence (RDV) = 5h attendues.");

// 3. Journée entière : 0 h, explication dédiée.
c = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: [ev({ toute_journee: true, motif: "Congé" })], resourceId: R, dateISO: "2026-10-08" });
assert.equal(c.cible, 0);
assert.equal(c.journeeEntiere, true);
assert.match(c.explication, /^Absence toute la journée \(Congé\)/);

// 4. Plus d'heures d'absence que de journée : jamais négatif.
c = cibleJourneeOuvrier({ heuresJour: 8, evenements: [ev({ heures_indisponibles: 5 }), ev({ type: "indisponibilite", heures_indisponibles: 4 })], resourceId: R, dateISO: "2026-10-08" });
assert.equal(c.cible, 0);

// 5. Ignorés : autre ouvrier, autre date, inactif, capacité exceptionnelle.
const ignores = [
  ev({ resource_id: "res-b", heures_indisponibles: 2 }),
  ev({ date_debut: "2026-10-09", date_fin: "2026-10-09", heures_indisponibles: 2 }),
  ev({ actif: false, heures_indisponibles: 2 }),
  ev({ type: "capacite_override", capacite_heures: 2 }),
];
c = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: ignores, resourceId: R, dateISO: "2026-10-08" });
assert.equal(c.cible, 8.75);

// 6. Période sur plusieurs jours couvre le jour du milieu.
assert.equal(indisponibilitesDuJour([ev({ date_debut: "2026-10-05", date_fin: "2026-10-09", toute_journee: true })], R, "2026-10-07").length, 1);

// 7. Jour déjà à 0 h (vendredi de semaine 4 jours, férié) : reste 0, pas d'explication.
c = cibleJourneeOuvrier({ heuresJour: 0, evenements: [ev({ toute_journee: true })], resourceId: R, dateISO: "2026-10-08" });
assert.deepEqual([c.cible, c.explication], [0, null]);

// 8. Ressource inconnue : aucune absence appliquée.
c = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: [ev({ heures_indisponibles: 2 })], resourceId: null, dateISO: "2026-10-08" });
assert.equal(c.cible, 8.75);

// 9. Fiche ressource : compte lié prioritaire, sinon prénom (accents/casse), homonymes refusés.
const ressources = [
  { id: "1", nom_planning: "Élodie", auth_user_id: null },
  { id: "2", nom_planning: "Paul", auth_user_id: "uid-paul" },
  { id: "3", nom_planning: "Sam", auth_user_id: null },
  { id: "4", nom_planning: "sam", auth_user_id: null },
];
assert.equal(ressourceDeLOuvrier(ressources, { prenom: "elodie" })?.id, "1");
assert.equal(ressourceDeLOuvrier(ressources, { authUserId: "uid-paul", prenom: "autre" })?.id, "2");
assert.equal(ressourceDeLOuvrier(ressources, { prenom: "Sam" }), null);
assert.equal(ressourceDeLOuvrier(ressources, { prenom: "" }), null);

// 10. Même règle que la capacité du planning : le retrait d'heures est identique.
for (const e of [ev({ heures_indisponibles: 3.75 }), ev({ toute_journee: true }), ev({ toute_journee: true, heures_indisponibles: 2 })]) {
  const cap = calculerCapaciteRessource({ resource: { id: R, kind: "personne", actif: true }, dateISO: "2026-10-08", capaciteBase: 8.75, evenements: [e] });
  const cib = cibleJourneeOuvrier({ heuresJour: 8.75, evenements: [e], resourceId: R, dateISO: "2026-10-08" });
  assert.equal(cib.cible, cap.capacite_apres_exceptions, JSON.stringify(e));
}

console.log("✓ verif-cible-journee-ouvrier : cible du compte rendu diminuée des absences (10 contrôles)");
