// Vérifie l'affectation chrono d'une tâche ajoutée APRÈS le semis de la vue
// Chrono (cas « tâche remontée par un compte rendu »). Sans cette affectation
// la tâche n'a pas de groupe métier résolvable, donc pas de pool HARD, et le
// moteur de planification l'exclut en `contexte_affectation_insuffisant`.
//
// Invariants testés :
//   - la règle appliquée est EXACTEMENT celle du semis (groupe_type_id
//     explicite, sinon premier groupe type du lot, sinon rien) ;
//   - aucun groupe n'est jamais deviné : lot non rattaché => tâche « à classer » ;
//   - une tâche déjà classée n'est jamais reclassée par le rattrapage ;
//   - la tâche ajoutée se range EN FIN de groupe, sans bousculer l'existant ;
//   - le résultat est déterministe (mêmes entrées => mêmes sorties).
import assert from "node:assert/strict";
import {
  indexerGroupesChronoV1,
  groupeChronoPourTacheV1,
  prochainOrdreChronoV1,
  affectationChronoNouvelleTacheV1,
  rattraperAffectationsChronoV1,
  buildChronoInitFromGroupesTypes,
} from "../src/Renovation/chronoTemplate.js";

// Référentiel proche de la configuration réelle Profero.
const groupesTypes = [
  { id: "gt_demolition", nom: "Démolition", lot_id: "demolition", ordre: 10 },
  { id: "gt_ossature_placo", nom: "Ossatures placo & menuiseries intérieures", lot_id: "murs_cloison", ordre: 60 },
  { id: "gt_laine_placo", nom: "Laine / Placo / Enduit", lot_id: "murs_cloison", ordre: 80 },
  { id: "gt_peinture", nom: "Peinture", lot_id: "finitions_gen", ordre: 90 },
  { id: "gt_sols", nom: "Sols", lot_id: "finitions_gen", ordre: 100 },
];
const chronoGroupes = [
  { id: "g_demo", nom: "Démolition", ordre: 10, groupe_type_id: "gt_demolition" },
  { id: "g_oss", nom: "Ossatures placo & menuiseries intérieures", ordre: 60, groupe_type_id: "gt_ossature_placo" },
  { id: "g_laine", nom: "Laine / Placo / Enduit", ordre: 80, groupe_type_id: "gt_laine_placo" },
  { id: "g_peint", nom: "Peinture", ordre: 90, groupe_type_id: "gt_peinture" },
  { id: "g_sols", nom: "Sols", ordre: 100, groupe_type_id: "gt_sols" },
];
const index = indexerGroupesChronoV1(chronoGroupes, groupesTypes);

// 1. Un `groupe_type_id` explicite sur la tâche gagne toujours, même quand le
//    lot de l'ouvrage pointerait vers un autre groupe.
{
  const ouvrage = { id: "o1", lot_id: "murs_cloison" };
  const t = { id: "t1", groupe_type_id: "gt_peinture" };
  assert.equal(groupeChronoPourTacheV1(t, ouvrage, index).id, "g_peint");
}

// 2. Sans groupe explicite : premier groupe type du lot, par `ordre` croissant.
//    murs_cloison est servi par gt_ossature_placo (60) avant gt_laine_placo (80).
{
  const ouvrage = { id: "o1", lot_id: "murs_cloison" };
  assert.equal(groupeChronoPourTacheV1({ id: "t2" }, ouvrage, index).id, "g_oss");
}

// 3. Lot rattaché à AUCUN groupe type (lot personnalisé « Sol ») : rien n'est
//    deviné, la tâche reste « à classer ». C'est le comportement voulu.
{
  const ouvrage = { id: "o2", lot_id: "lot_1783405744817" };
  assert.equal(groupeChronoPourTacheV1({ id: "t3" }, ouvrage, index), null);
  assert.equal(affectationChronoNouvelleTacheV1({
    tache: { id: "t3" }, ouvrage, ouvrages: [ouvrage], chronoGroupes, groupesTypes,
  }), null);
}

// 4. Ouvrage sans lot du tout : idem, aucune affectation.
{
  const ouvrage = { id: "o3" };
  assert.equal(groupeChronoPourTacheV1({ id: "t4" }, ouvrage, index), null);
}

// 5. La tâche ajoutée se range EN FIN de groupe, jamais devant l'existant.
{
  const ouvrages = [{
    id: "o1", lot_id: "murs_cloison",
    taches: [
      { id: "a", chrono_groupe_id: "g_oss", chrono_ordre: 0 },
      { id: "b", chrono_groupe_id: "g_oss", chrono_ordre: 1 },
      { id: "c", chrono_groupe_id: "g_laine", chrono_ordre: 0 },
    ],
  }];
  assert.equal(prochainOrdreChronoV1(ouvrages, "g_oss"), 2);
  assert.equal(prochainOrdreChronoV1(ouvrages, "g_laine"), 1);
  assert.equal(prochainOrdreChronoV1(ouvrages, "g_peint"), 0);
  const aff = affectationChronoNouvelleTacheV1({
    tache: { id: "d" }, ouvrage: ouvrages[0], ouvrages, chronoGroupes, groupesTypes,
  });
  assert.deepEqual(aff, { chrono_groupe_id: "g_oss", chrono_ordre: 2 });
}

// 6. Rattrapage : seules les tâches SANS groupe sont affectées, jamais les autres.
{
  const ouvrages = [{
    id: "o1", lot_id: "murs_cloison",
    taches: [
      { id: "deja", chrono_groupe_id: "g_laine", chrono_ordre: 0 },
      { id: "orph1" },
      { id: "orph2" },
    ],
  }, {
    id: "o2", lot_id: "lot_1783405744817",
    taches: [{ id: "horslot" }],
  }];
  const out = rattraperAffectationsChronoV1({ ouvrages, chronoGroupes, groupesTypes });
  assert.equal(Object.keys(out).length, 2, "seules les 2 tâches orphelines classables sont affectées");
  assert.equal(out.deja, undefined, "une tâche déjà classée n'est jamais reclassée");
  assert.equal(out.horslot, undefined, "un lot non rattaché ne produit jamais d'affectation");
  assert.deepEqual(out.orph1, { groupe_id: "g_oss", ordre: 0 });
  assert.deepEqual(out.orph2, { groupe_id: "g_oss", ordre: 1 }, "ordres consécutifs, pas de collision");
}

// 7. Le rattrapage repart du maximum existant du groupe : pas de collision
//    d'ordre avec les tâches déjà séquencées.
{
  const ouvrages = [{
    id: "o1", lot_id: "murs_cloison",
    taches: [
      { id: "a", chrono_groupe_id: "g_oss", chrono_ordre: 7 },
      { id: "orph" },
    ],
  }];
  const out = rattraperAffectationsChronoV1({ ouvrages, chronoGroupes, groupesTypes });
  assert.deepEqual(out.orph, { groupe_id: "g_oss", ordre: 8 });
}

// 8. Groupe hérité SANS `groupe_type_id` : adoption par homonymie de nom,
//    comme le mode « ajouter » de l'écran Phasage. Les phasages anciens
//    (semés par `buildChronoInit`) restent donc traités.
{
  const legacy = [{ id: "g_legacy", nom: "Peinture", ordre: 90 }];
  const idx = indexerGroupesChronoV1(legacy, groupesTypes);
  const ouvrage = { id: "o1", lot_id: "finitions_gen" };
  assert.equal(groupeChronoPourTacheV1({ id: "t" }, ouvrage, idx).id, "g_legacy");
}

// 9. Cohérence avec le semis : pour un phasage vierge, rattraper produit les
//    MÊMES groupes que `buildChronoInitFromGroupesTypes`. La règle est unique.
{
  const ouvrages = [
    { id: "o1", lot_id: "murs_cloison", taches: [{ id: "t1" }, { id: "t2" }] },
    { id: "o2", lot_id: "demolition", taches: [{ id: "t3" }] },
    { id: "o3", lot_id: "finitions_gen", taches: [{ id: "t4", groupe_type_id: "gt_sols" }] },
  ];
  let n = 0;
  const rid = () => `g${++n}`;
  const semis = buildChronoInitFromGroupesTypes(ouvrages, groupesTypes, rid);
  const groupesSemes = semis.groupes;
  const parId = new Map(groupesSemes.map(g => [g.id, g]));
  const rattrap = rattraperAffectationsChronoV1({
    ouvrages, chronoGroupes: groupesSemes, groupesTypes,
  });
  for (const tacheId of ["t1", "t2", "t3", "t4"]) {
    const typeSemis = parId.get(semis.assignments[tacheId].groupe_id).groupe_type_id;
    const typeRattrap = parId.get(rattrap[tacheId].groupe_id).groupe_type_id;
    assert.equal(typeRattrap, typeSemis, `${tacheId} : même groupe type qu'au semis`);
  }
}

// 10. Déterminisme : deux exécutions sur les mêmes entrées donnent le même
//     résultat, à la clé près.
{
  const ouvrages = [{
    id: "o1", lot_id: "murs_cloison",
    taches: [{ id: "x" }, { id: "y" }, { id: "z" }],
  }];
  const a = rattraperAffectationsChronoV1({ ouvrages, chronoGroupes, groupesTypes });
  const b = rattraperAffectationsChronoV1({ ouvrages, chronoGroupes, groupesTypes });
  assert.deepEqual(a, b);
}

// 11. Entrées vides / malformées : aucune exception, aucune affectation.
{
  assert.deepEqual(rattraperAffectationsChronoV1({}), {});
  assert.deepEqual(rattraperAffectationsChronoV1({ ouvrages: null, chronoGroupes: null, groupesTypes: null }), {});
  assert.equal(affectationChronoNouvelleTacheV1(), null);
  assert.equal(prochainOrdreChronoV1(null, null), 0);
  assert.deepEqual(rattraperAffectationsChronoV1({
    ouvrages: [{ id: "o", lot_id: "murs_cloison", taches: [{ nom: "sans id" }] }],
    chronoGroupes, groupesTypes,
  }), {}, "une tâche sans id n'est jamais affectée");
}

console.log("verif-phasage-chrono-affectation-v1 : OK (11 blocs)");
