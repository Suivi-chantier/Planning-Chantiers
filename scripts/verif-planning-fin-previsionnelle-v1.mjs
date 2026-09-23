// Vérification du module pur « fin prévisionnelle par chantier » (Chantier 07).
//
// L'enjeu n'est pas seulement de calculer une date : c'est de NE JAMAIS
// annoncer une fin qui n'en est pas une. Chaque scénario ci-dessous vérifie
// que l'incertitude reste visible quand le moteur n'a pas tout placé.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  finPrevisionnelleParChantierV1,
  libelleFinPrevisionnelleV1,
  PLANNING_FIN_PREVISIONNELLE_VERSION,
} from "../src/Renovation/planningFinPrevisionnelleV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/planningFinPrevisionnelleV1.mjs"), "utf8");

// 0. Le module doit rester pur : aucun accès base, aucune écriture, aucune horloge.
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "la fin prévisionnelle doit rester pure");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/.test(source), false, "la fin prévisionnelle ne doit rien persister");
assert.equal(/new Date\s*\(|Date\.now\s*\(/.test(source), false, "la fin prévisionnelle ne doit dépendre d'aucune horloge");

const alloc = (chantierId, date, heures = 7, tacheId = `T-${chantierId}-${date}`) => ({
  allocation_uid: `A-${chantierId}-${date}-${tacheId}`,
  chantier_id: chantierId, date, heures_mo: heures, tache_id: tacheId, travail_id: tacheId,
});
const nonPlanifie = (chantierId, travailId, heures) => ({
  travail_id: travailId, tache_id: travailId, chantier_id: chantierId,
  heures_mo_restantes: heures, raison: "horizon_insuffisant",
});
const parId = (out, id) => out.chantiers.find(c => c.chantier_id === id);

// ── 1. Chantier entièrement planifié : la fin est la date la PLUS TARDIVE. ──
{
  const out = finPrevisionnelleParChantierV1({
    allocations_proposees: [
      alloc("C1", "2026-10-05"),
      alloc("C1", "2026-11-12"),
      alloc("C1", "2026-10-20"),
    ],
    non_planifies: [],
  });
  const c1 = parId(out, "C1");
  assert.equal(c1.complet, true);
  assert.equal(c1.fin_prevue, "2026-11-12");
  assert.equal(c1.derniere_date_allouee, "2026-11-12");
  assert.equal(c1.premiere_date_allouee, "2026-10-05");
  assert.equal(c1.nb_allocations, 3);
  assert.equal(c1.heures_mo_allouees, 21);
  assert.equal(c1.heures_non_planifiees, 0);
  assert.equal(c1.nb_travaux_non_planifies, 0);

  const lib = libelleFinPrevisionnelleV1(c1, d => d.split("-").reverse().join("/"));
  assert.equal(lib.statut, "complet");
  assert.equal(lib.titre, "Fin prévue le 12/11/2026");
}

// ── 2. Chantier PARTIELLEMENT planifié : complet=false, JAMAIS de date sèche. ──
{
  const out = finPrevisionnelleParChantierV1({
    allocations_proposees: [alloc("C2", "2026-10-01"), alloc("C2", "2026-10-30")],
    non_planifies: [nonPlanifie("C2", "TR-9", 14.5), nonPlanifie("C2", "TR-10", 3.5)],
  });
  const c2 = parId(out, "C2");
  assert.equal(c2.complet, false);
  // L'invariant : aucune date n'est publiée comme fin.
  assert.equal(c2.fin_prevue, null);
  // Mais la dernière date allouée reste disponible comme MINIMUM explicite.
  assert.equal(c2.derniere_date_allouee, "2026-10-30");
  assert.equal(c2.heures_non_planifiees, 18);
  assert.equal(c2.nb_travaux_non_planifies, 2);

  const lib = libelleFinPrevisionnelleV1(c2, d => d.split("-").reverse().join("/"));
  assert.equal(lib.statut, "au_dela_horizon");
  assert.equal(lib.titre, "Au-delà de l'horizon");
  assert.match(lib.detail, /pas avant le 30\/10\/2026/);
  assert.match(lib.detail, /18 h/);
  assert.match(lib.detail, /2 travaux/);
  // Le libellé ne doit jamais présenter la date comme une fin.
  assert.equal(/Fin prévue/.test(lib.titre + lib.detail), false);
}

// ── 3. Chantier SANS aucune allocation : pas de date inventée. ──
{
  const out = finPrevisionnelleParChantierV1({
    allocations_proposees: [alloc("C1", "2026-10-05")],
    non_planifies: [nonPlanifie("C3", "TR-1", 40)],
  });
  const c3 = parId(out, "C3");
  assert.equal(c3.complet, false);
  assert.equal(c3.fin_prevue, null);
  assert.equal(c3.derniere_date_allouee, null);
  assert.equal(c3.nb_allocations, 0);
  assert.equal(c3.heures_non_planifiees, 40);

  const lib = libelleFinPrevisionnelleV1(c3);
  assert.equal(lib.statut, "au_dela_horizon");
  assert.match(lib.detail, /aucun créneau trouvé dans l'horizon/);
  assert.match(lib.detail, /1 travail\b/); // singulier
  // Aucune date, même partielle, ne doit apparaître.
  assert.equal(/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\//.test(lib.detail), false);

  // Cas défensif : une ligne « complète » mais sans aucune allocation reste « — ».
  const vide = libelleFinPrevisionnelleV1({ complet: true, fin_prevue: null, derniere_date_allouee: null });
  assert.equal(vide.titre, "—");
}

// ── 4. Plusieurs chantiers mélangés, dates dans le désordre, tri d'affichage. ──
{
  const out = finPrevisionnelleParChantierV1({
    allocations_proposees: [
      alloc("CB", "2026-12-01"), alloc("CA", "2026-11-03"), alloc("CB", "2026-09-15"),
      alloc("CC", "2026-10-02"), alloc("CA", "2026-09-01"), alloc("CD", "2026-11-20"),
    ],
    non_planifies: [nonPlanifie("CC", "TR-4", 8), nonPlanifie("CE", "TR-5", 12)],
  });
  // Complets d'abord, par fin croissante ; incomplets regroupés à la fin.
  assert.deepEqual(out.chantiers.map(c => c.chantier_id), ["CA", "CD", "CB", "CC", "CE"]);
  assert.deepEqual(out.chantiers.map(c => c.complet), [true, true, true, false, false]);
  assert.equal(parId(out, "CA").fin_prevue, "2026-11-03");
  assert.equal(parId(out, "CB").fin_prevue, "2026-12-01");
  assert.equal(parId(out, "CC").fin_prevue, null);
  assert.equal(parId(out, "CC").derniere_date_allouee, "2026-10-02");
  assert.deepEqual(out.resume, {
    chantiers: 5, complets: 3, incomplets: 2, sans_allocation: 1, heures_non_planifiees: 20,
  });
  // Déterminisme strict à entrées identiques.
  const bis = finPrevisionnelleParChantierV1({
    allocations_proposees: [
      alloc("CB", "2026-12-01"), alloc("CA", "2026-11-03"), alloc("CB", "2026-09-15"),
      alloc("CC", "2026-10-02"), alloc("CA", "2026-09-01"), alloc("CD", "2026-11-20"),
    ],
    non_planifies: [nonPlanifie("CC", "TR-4", 8), nonPlanifie("CE", "TR-5", 12)],
  });
  assert.deepEqual(bis, out);
}

// ── 5. Résultat vide ou malformé : rien ne casse, rien n'est inventé. ──
for (const entree of [undefined, null, 0, "", "planning", [], {}, { allocations_proposees: null, non_planifies: "x" }]) {
  const out = finPrevisionnelleParChantierV1(entree);
  assert.deepEqual(out.chantiers, []);
  assert.equal(out.resume.chantiers, 0);
  assert.equal(out.version, PLANNING_FIN_PREVISIONNELLE_VERSION);
}
{
  // Lignes individuelles corrompues : ignorées sans faire tomber le calcul.
  const out = finPrevisionnelleParChantierV1({
    allocations_proposees: [
      null, 42, "bruit",
      { chantier_id: "", date: "2026-10-01" },          // chantier vide → ignoré
      { chantier_id: "CX", date: "pas-une-date", heures_mo: 5 },
      { chantier_id: "CX", date: null, heures_mo: "abc" },
      { chantier_id: "CX", date: "2026-10-07T08:00:00Z", heures_mo: 6 }, // horodatage toléré
    ],
    non_planifies: [null, "bruit", { chantier_id: "CX", heures_mo_restantes: -5 }],
  });
  const cx = parId(out, "CX");
  assert.equal(out.chantiers.length, 1);
  assert.equal(cx.nb_allocations, 3);
  assert.equal(cx.heures_mo_allouees, 11); // 5 + 0 (abc) + 6
  assert.equal(cx.derniere_date_allouee, "2026-10-07"); // seule date lisible
  assert.equal(cx.complet, false);
  assert.equal(cx.heures_non_planifiees, 0); // heures négatives ramenées à 0, jamais soustraites
  assert.equal(libelleFinPrevisionnelleV1(null).titre, "—");
}

// ── 6. Le résultat imbriqué sous `proposition` (forme des simulations) marche. ──
{
  const out = finPrevisionnelleParChantierV1({
    proposition: {
      allocations_proposees: [alloc("CP", "2026-10-09")],
      non_planifies: [],
    },
  });
  assert.equal(parId(out, "CP").fin_prevue, "2026-10-09");
}

// ── 7. Aucun effet de bord : l'entrée n'est pas modifiée. ──
{
  const entree = {
    allocations_proposees: [alloc("CS", "2026-10-09")],
    non_planifies: [nonPlanifie("CS", "TR-1", 4)],
  };
  const copie = structuredClone(entree);
  finPrevisionnelleParChantierV1(entree);
  assert.deepEqual(entree, copie, "le calcul ne doit jamais muter le résultat du moteur");
}

console.log("OK — planning fin prévisionnelle V1 : 7 scénarios");
