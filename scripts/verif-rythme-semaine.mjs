// Vérifie les horaires servis par src/rythmeSemaine.js (source unique des
// heures par jour) :
//   - depuis le lundi 05/10/2026 : 8h45/jour (7h30–12h + 12h45–17h),
//     semaine impaire 4 jours = 35 h, semaine paire 5 jours = 43 h
//     (vendredi 8 h, fin 16h15) ;
//   - du 24/08 au 04/10/2026 : premier rythme alterné, 39 h / 39 h ;
//   - avant le 24/08/2026 : ancien barème inchangé.
// Lancer : node --experimental-default-type=module scripts/verif-rythme-semaine.mjs
import assert from "node:assert/strict";
import {
  profilSemaine, capaciteJour, estJourNonTravaille, fmtHeures, getISOWeek,
  HORAIRES_DATE_DEBUT,
} from "../src/rythmeSemaine.js";

const total = p => Object.values(p).reduce((s, h) => s + h, 0);
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

// 1. Date d'effet = lundi de la semaine ISO 41 (impaire).
assert.deepEqual(getISOWeek(HORAIRES_DATE_DEBUT), { year: 2026, week: 41 });

// 2. Nouveaux horaires.
for (const [y, w] of [[2026, 41], [2026, 43], [2027, 1], [2027, 3]]) {
  const p = profilSemaine(y, w);
  assert.deepEqual(p, { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 0 }, `${y}-W${w}`);
  assert.equal(total(p), 35, `${y}-W${w} : 35 h`);
  assert.equal(estJourNonTravaille("Vendredi", y, w), true);
  assert.deepEqual(JOURS.map(j => capaciteJour(j, y, w)), [7.75, 7.75, 7.75, 7.75, 0]);
}
for (const [y, w] of [[2026, 42], [2026, 44], [2027, 2]]) {
  const p = profilSemaine(y, w);
  assert.deepEqual(p, { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 8 }, `${y}-W${w}`);
  assert.equal(total(p), 43, `${y}-W${w} : 43 h`);
  assert.deepEqual(JOURS.map(j => capaciteJour(j, y, w)), [7.75, 7.75, 7.75, 7.75, 7]);
}

// 3. Historique : premier rythme alterné (39 h) jusqu'au 04/10/2026.
assert.deepEqual(profilSemaine(2026, 39), { Lundi: 10, Mardi: 10, Mercredi: 10, Jeudi: 9, Vendredi: 0 });
assert.deepEqual(profilSemaine(2026, 40), { Lundi: 8, Mardi: 8, Mercredi: 8, Jeudi: 8, Vendredi: 7 });
assert.equal(total(profilSemaine(2026, 35)), 39);
assert.equal(total(profilSemaine(2026, 40)), 39);

// 4. Historique : avant le 24/08/2026, ancien barème (et config Admin si fournie).
assert.deepEqual(profilSemaine(2026, 34), { Lundi: 10, Mardi: 10, Mercredi: 10, Jeudi: 9, Vendredi: 9 });
assert.equal(profilSemaine(2026, 34, { Vendredi: "8" }).Vendredi, 8);
assert.equal(capaciteJour("Vendredi", 2026, 34), 8);

// 5. Affichage lisible.
assert.equal(fmtHeures(8.75), "8h45");
assert.equal(fmtHeures(8), "8h");
assert.equal(fmtHeures(7.75), "7h45");
assert.equal(fmtHeures(35), "35h");
assert.equal(fmtHeures(0.25), "0h15");

console.log("verif-rythme-semaine : OK (35 h / 43 h depuis le 05/10/2026, historique inchangé)");
