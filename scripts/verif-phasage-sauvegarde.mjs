#!/usr/bin/env node
// Vérifie la file d'auto-save en verrouillage optimiste de PhasageV2
// (src/Renovation/phasageSauvegarde.mjs). Fonctions pures : aucun réseau.
//   node scripts/verif-phasage-sauvegarde.mjs
import assert from "node:assert/strict";

const {
  etatInitial, avecRevision, planifier, demarrer, succes, conflit, echec,
  apresRechargement, aDesChangementsNonEnregistres, estSuspendu,
} = await import(new URL("../src/Renovation/phasageSauvegarde.mjs", import.meta.url).href);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const charge = (rev = 5) => avecRevision(etatInitial(), rev);

test("1. une seule sauvegarde active à la fois", () => {
  let e = planifier(charge(5), { ouvrages: ["a"] });
  const premier = demarrer(e);
  assert.ok(premier.lot, "la première part");
  e = premier.etat;
  // Une deuxième frappe pendant la requête ne lance PAS un second envoi.
  e = planifier(e, { ouvrages: ["a", "b"] });
  const second = demarrer(e);
  assert.equal(second.lot, null, "aucune écriture concurrente depuis le même éditeur");
  assert.ok(second.etat.attente, "le changement reste en attente");
});

test("2. regroupement des changements pendant une requête", () => {
  let e = planifier(charge(5), { ouvrages: ["v1"] });
  const p = demarrer(e); e = p.etat;
  e = planifier(e, { ouvrages: ["v2"] });
  e = planifier(e, { plan_travaux: { meta: 1 } });
  e = planifier(e, { ouvrages: ["v3"] });
  assert.deepEqual(e.attente, { ouvrages: ["v3"], plan_travaux: { meta: 1 } },
    "les changements fusionnent, le plus récent gagne par champ");
  e = succes(e, p.seq, 6);
  const suivant = demarrer(e);
  assert.deepEqual(suivant.lot, { ouvrages: ["v3"], plan_travaux: { meta: 1 } },
    "un seul envoi pour tout ce qui s'est accumulé");
});

test("3. la révision est mise à jour après un succès", () => {
  let e = planifier(charge(5), { ouvrages: ["a"] });
  const p = demarrer(e); e = p.etat;
  assert.equal(e.revision, 5, "inchangée tant que la réponse n'est pas là");
  e = succes(e, p.seq, 6);
  assert.equal(e.revision, 6);
  assert.equal(e.enVol, null);
  assert.equal(e.conflit, false);
  assert.equal(aDesChangementsNonEnregistres(e), false);
});

test("4. une réponse obsolète est ignorée", () => {
  let e = planifier(charge(5), { ouvrages: ["a"] });
  const p1 = demarrer(e); e = succes(p1.etat, p1.seq, 6);
  e = planifier(e, { ouvrages: ["b"] });
  const p2 = demarrer(e); e = p2.etat;
  // La réponse de la PREMIÈRE requête arrive en retard : elle ne doit ni
  // reculer la révision, ni vider la requête en cours.
  const apres = succes(e, p1.seq, 99);
  assert.equal(apres.revision, 6, "la révision ne recule pas");
  assert.ok(apres.enVol, "la requête en cours n'est pas effacée");
  // Idem pour un conflit périmé.
  const apres2 = conflit(e, p1.seq, 42);
  assert.equal(apres2.conflit, false, "un conflit périmé ne met pas en pause");
});

test("5. un conflit met l'auto-save en pause", () => {
  let e = planifier(charge(5), { ouvrages: ["local"] });
  const p = demarrer(e); e = p.etat;
  e = conflit(e, p.seq, 7);
  assert.equal(e.conflit, true);
  assert.equal(estSuspendu(e), true);
  assert.equal(e.revision, 7, "la révision réelle est mémorisée");
  assert.equal(e.enVol, null);
  assert.equal(aDesChangementsNonEnregistres(e), true, "sortie à protéger");
});

test("6. aucune relance automatique après un conflit", () => {
  let e = planifier(charge(5), { ouvrages: ["local"] });
  const p = demarrer(e); e = conflit(p.etat, p.seq, 7);
  // Le lot refusé n'est pas remis en file : on ne réécrit jamais par-dessus.
  assert.equal(e.attente, null, "le lot refusé est abandonné");
  assert.equal(demarrer(e).lot, null, "plus aucun envoi");
  // Et les frappes suivantes ne relancent rien non plus.
  e = planifier(e, { ouvrages: ["encore"] });
  assert.equal(e.attente, null, "les modifications ne sont plus mises en file");
  assert.equal(demarrer(e).lot, null);
  assert.equal(estSuspendu(e), true);
});

test("7. reprise après rechargement de la version récente", () => {
  let e = planifier(charge(5), { ouvrages: ["local"] });
  const p = demarrer(e); e = conflit(p.etat, p.seq, 7);
  e = apresRechargement(e, 7);
  assert.equal(e.conflit, false, "l'auto-save repart");
  assert.equal(e.revision, 7);
  assert.equal(e.attente, null, "l'état local a été remplacé, rien ne traîne");
  assert.equal(aDesChangementsNonEnregistres(e), false);
  // Le compteur de séquence ne repart pas à zéro : une réponse en retard de
  // l'ancienne requête resterait ignorée.
  assert.ok(e.seq >= p.seq, "le compteur ne recule pas");
  e = planifier(e, { ouvrages: ["neuf"] });
  assert.ok(demarrer(e).lot, "une nouvelle sauvegarde peut partir");
});

test("8. avertissement de sortie si une modification n'est pas enregistrée", () => {
  assert.equal(aDesChangementsNonEnregistres(charge(5)), false, "rien à signaler");
  assert.equal(aDesChangementsNonEnregistres(planifier(charge(5), { ouvrages: [] })), true,
    "changement en attente");
  const p = demarrer(planifier(charge(5), { ouvrages: [] }));
  assert.equal(aDesChangementsNonEnregistres(p.etat), true, "requête en vol");
  assert.equal(aDesChangementsNonEnregistres(conflit(p.etat, p.seq, 9)), true, "conflit");
});

test("bonus — on n'écrit jamais sans révision connue", () => {
  const e = planifier(etatInitial(), { ouvrages: ["a"] });   // révision null
  assert.equal(demarrer(e).lot, null, "pas de sauvegarde tant que le phasage n'est pas chargé");
  assert.ok(e.attente, "mais le changement est conservé");
  const charge2 = demarrer(avecRevision(e, 3));
  assert.ok(charge2.lot, "il part dès que la révision est connue");
});

test("bonus — un échec technique n'est pas un conflit", () => {
  let e = planifier(charge(5), { ouvrages: ["v1"] });
  const p = demarrer(e); e = p.etat;
  e = planifier(e, { ouvrages: ["v2"] });   // frappe pendant la requête
  e = echec(e, p.seq);
  assert.equal(e.conflit, false, "pas de pause : c'est un problème de réseau");
  assert.deepEqual(e.attente, { ouvrages: ["v2"] }, "le plus récent prime sur le lot rejoué");
  assert.ok(demarrer(e).lot, "une nouvelle tentative est permise");
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-phasage-sauvegarde : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
