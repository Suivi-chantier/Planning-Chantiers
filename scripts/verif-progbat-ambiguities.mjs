import assert from 'node:assert/strict';
import { rapprocherBibliotheque } from '../src/Renovation/progbatInventaire.mjs';
import { construirePlanSynchronisation, donneesPourHash } from '../src/Renovation/progbatLibrarySync.mjs';
const o = (id, libelle = 'E-001 : Prise', progbat_id = null) => ({ id, libelle, unite: 'U', progbat_id });
const structure = (id, extra = {}) => ({ id, code: 'E-001', label: 'Prise', unitCode: 'U', saleNetUnitPrice: 25, ...extra });
const inventory = (ouvrages, structures) => rapprocherBibliotheque({ ouvrages, structures });
const plan = (inventaire, selections = {}) => construirePlanSynchronisation({ inventaire, selections });
// Code dupliqué côté Profero : aucune liaison automatique, mais choix distinct possible.
const duplicate = inventory([o('a'), o('b', 'E-001 :')], [structure(10), structure(11)]);
assert.equal(duplicate.rapprochements[0].doublons_code_profero.length, 1);
assert.equal(plan(duplicate).actions.length, 0);
assert.equal(plan(duplicate, { a: 10, b: 11 }).actions.length, 2);
assert.equal(plan(duplicate, { a: 10, b: 10 }).actions.length, 0);
assert.equal(plan(duplicate, { a: 999 }).actions.length, 0);
assert.equal(plan(duplicate, { a: 10 }).actions[0].manuel, true);
// La cible déjà liée reste indisponible, y compris si le code du propriétaire diffère.
const occupied = inventory([o('a'), o('b', 'P-920 : Autre', '10')], [structure(10)]);
assert.equal(occupied.rapprochements.find(r => r.profero.id === 'a').correspondance.selectionnable, false);
assert.equal(plan(occupied, { a: 10 }).actions.length, 0);
// Une liaison partagée bloque aussi la modification de composition des deux fiches.
const shared = inventory([o('a', 'P-920 : A', '10'), o('b', 'P-930 : B', '10')], [structure(10)]);
assert.ok(shared.rapprochements.every(r => r.conflits_liaison.length && r.doublons_liaison_profero.length === 1));
assert.equal(plan(shared).actions.length, 0);
const missing = inventory([o('a', 'E-001 : Prise', '999')], [structure(10)]);
assert.equal(plan(missing).actions.length, 0);
// Une unité différente ne peut jamais être validée par un simple choix d'identifiant.
const units = inventory([o('a')], [structure(10), structure(11, { unitCode: 'm2' })]);
assert.equal(plan(units, { a: 11 }).actions.length, 0);
assert.equal(plan(units, { a: 10 }).actions.length, 1);
// Le descriptif complet et la provenance sont visibles, sans HTML ni troncature.
const description = 'E-001 : ' + 'Description détaillée '.repeat(25);
const detailed = inventory([o('a')], [structure(10, { description: `<p>${description}</p>` }), structure(11)]);
const candidate = detailed.rapprochements[0].candidats.find(c => c.id === 10);
assert.ok(candidate.descriptif.length > 200);
assert.equal(candidate.source_code, 'descriptif');
assert.equal(candidate.code_commun, 'E-001');
// Le choix entre deux candidats change l'empreinte d'aperçu.
assert.notDeepEqual(donneesPourHash(plan(units, { a: 10 })), donneesPourHash(plan(duplicate, { a: 11 })));
console.log('verif-progbat-ambiguities : OK (doublons, candidats occupés, choix explicites, unités, liens absents, empreinte)');
