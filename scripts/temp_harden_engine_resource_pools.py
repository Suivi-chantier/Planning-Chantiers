from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"Pattern not found in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new, 1), encoding="utf-8")

adapter = "src/Renovation/planningEngineAdapterV1.js"
replace_once(adapter,
'''    let preferred = [];
    let nonMappes = [];
    const eq = equipesNormalisees.get(txt(gt?.equipe_id)) || null;
    const prios = uniq(gt?.ouvriers_prio);
    if (prios.length) {
      const mapped = idsPourNoms(prios, parNom);
      preferred = mapped.ids;
      nonMappes = mapped.nonMappes;
    } else {
      preferred = uniq(eq?.resource_ids);
    }
    result.set(id, {
      groupe_type: gt,
      preferred_resource_ids: preferred,
      noms_non_mappes: nonMappes,
      equipe_externe: eq?.externe === true,
      equipe_id: eq?.id || null,
    });''',
'''    let preferred = [];
    let nonMappes = [];
    const eq = equipesNormalisees.get(txt(gt?.equipe_id)) || null;
    let candidates = uniq(eq?.resource_ids);
    const prios = uniq(gt?.ouvriers_prio);
    if (prios.length) {
      const mapped = idsPourNoms(prios, parNom);
      nonMappes = mapped.nonMappes;
      if (candidates.length) {
        const allowed = new Set(candidates);
        preferred = mapped.ids.filter(id => allowed.has(id));
      } else if (!eq) {
        // Groupe sans équipe explicite : des priorités mappées constituent le
        // seul pool déterministe disponible, plutôt qu'un fallback global.
        candidates = mapped.ids;
        preferred = mapped.ids;
      }
    } else {
      preferred = candidates;
    }
    result.set(id, {
      groupe_type: gt,
      candidate_resource_ids: candidates,
      preferred_resource_ids: preferred,
      noms_non_mappes: nonMappes,
      equipe_externe: eq?.externe === true,
      equipe_id: eq?.id || null,
    });''')

replace_once(adapter,
'''      // Le référentiel métier courant prime sur les affectations historiques
      // portées par le phasage. `tache.ouvriers` reste un fallback soft uniquement
      // lorsqu'aucune équipe/priorité de groupe n'est disponible.
      const preferredGroupe = uniq(prefGroupe?.preferred_resource_ids);
      const preferred = preferredGroupe.length ? preferredGroupe : mappingTache.ids;

      const regle = regleGroupe(groupe.groupe_type_id);''',
'''      const candidatesGroupe = uniq(prefGroupe?.candidate_resource_ids);
      if (groupe.groupe_type_id && !prefGroupe?.equipe_externe && candidatesGroupe.length === 0) {
        travauxExclus.push({
          travail_id: travailId,
          chantier_id: chantierId,
          tache_id: tacheId,
          type: "groupe_sans_pool_ressources",
          explication: "Le groupe métier est résolu mais aucun pool interne de ressources n'est configuré : le moteur refuse de choisir parmi tous les salariés.",
        });
        continue;
      }

      // Contrat V1 : le groupe métier définit un pool HARD. Les priorités du
      // groupe ne font qu'ordonner les membres de ce pool. Les anciens noms
      // `tache.ouvriers` ne peuvent jamais élargir un groupe actuel ; ils restent
      // le seul pool prudent uniquement pour une tâche legacy sans groupe, ou
      // l'override explicite d'un groupe externe.
      const candidates = prefGroupe?.equipe_externe
        ? mappingTache.ids
        : (groupe.groupe_type_id ? candidatesGroupe : mappingTache.ids);
      const preferredGroupe = uniq(prefGroupe?.preferred_resource_ids).filter(id => candidates.includes(id));
      const preferred = preferredGroupe.length ? preferredGroupe : candidates;

      const regle = regleGroupe(groupe.groupe_type_id);''')

replace_once(adapter,
'''        crew_size: Math.max(1, nomsTache.length || 1),
        candidate_resource_ids: [],
        preferred_resource_ids: preferred,''',
'''        crew_size: Math.max(1, nomsTache.length || 1),
        candidate_resource_ids: candidates,
        preferred_resource_ids: preferred,''')

tests = "scripts/verif-planning-engine-adapter-v1.mjs"
replace_once(tests,
'''// 9. Les ouvriers portés par la tâche sont des préférences, jamais une contrainte hard implicite.
{
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    phasages: [phasage({ taches: [task("T1", { ouvriers: ["R2"] })] })],
    equipes: [], groupesTypes: [{ id: "gt_reseau_elec", ordre: 70 }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids, ["RID2"]);
  assert.deepEqual(t.candidate_resource_ids, []);
  assert.equal(t.crew_size, 1);
}

// 10. Sans affectation tâche, l'équipe du groupe n'est qu'une préférence ; la taille d'équipe n'est pas inventée.
{
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    groupesTypes: [{ id: "gt_reseau_elec", ordre: 70, equipe_id: "EQ1", ouvriers_prio: [] }],
    equipes: [{ id: "EQ1", nom: "Élec", responsable: "R1", membres: [{ ouvrier: "R2" }], externe: false }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids.sort(), ["RID1", "RID2"]);
  assert.equal(t.crew_size, 1);
}''',
'''// 9. Legacy sans groupe : les ouvriers explicites deviennent le pool hard prudent.
{
  const old = phasage({ taches: [task("T1", { chrono_groupe_id: "G_INCONNU", ouvriers: ["R2"] })], groupes: [] });
  old.ouvrages[0].code_ouvrage = null;
  old.ouvrages[0].lot_id = null;
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    phasages: [old],
    equipes: [], groupesTypes: [],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids, ["RID2"]);
  assert.deepEqual(t.candidate_resource_ids, ["RID2"]);
  assert.equal(t.crew_size, 1);
}

// 10. Avec un groupe actuel, l'équipe constitue le pool HARD ; la taille d'équipe n'est pas inventée.
{
  const out = base({
    ressources: [res("RID1", "R1"), res("RID2", "R2")],
    groupesTypes: [{ id: "gt_reseau_elec", ordre: 70, equipe_id: "EQ1", ouvriers_prio: [] }],
    equipes: [{ id: "EQ1", nom: "Élec", responsable: "R1", membres: [{ ouvrier: "R2" }], externe: false }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.candidate_resource_ids.sort(), ["RID1", "RID2"]);
  assert.deepEqual(t.preferred_resource_ids.sort(), ["RID1", "RID2"]);
  assert.equal(t.crew_size, 1);
}''')

replace_once(tests,
'''  assert.ok(travail);
  assert.deepEqual(travail.preferred_resource_ids, ["RID1"]);
  assert.equal(override.travaux_exclus.some(t => t.tache_id === "DEMO"), false);
}''',
'''  assert.ok(travail);
  assert.deepEqual(travail.candidate_resource_ids, ["RID1"]);
  assert.deepEqual(travail.preferred_resource_ids, ["RID1"]);
  assert.equal(override.travaux_exclus.some(t => t.tache_id === "DEMO"), false);
}''')

with Path(tests).open("a", encoding="utf-8") as f:
    f.write('''\n// 20. Un ancien ouvrier hors de l'équipe actuelle ne peut plus élargir le pool du groupe.\n{\n  const out = base({\n    ressources: [res("R1", "R1"), res("R2", "R2"), res("OLD", "Loris")],\n    phasages: [phasage({ taches: [task("STALE", { ouvriers:["Loris"] })] })],\n    groupesTypes: [{ id:"gt_reseau_elec", ordre:70, equipe_id:"EQ1", ouvriers_prio:[] }],\n    equipes: [{ id:"EQ1", nom:"Élec", responsable:"R1", membres:[{ ouvrier:"R2" }], externe:false }],\n  });\n  const t = out.engineInput.travaux.find(x => x.tache_id === "STALE");\n  assert.deepEqual(t.candidate_resource_ids.sort(), ["R1", "R2"]);\n  assert.equal(t.candidate_resource_ids.includes("OLD"), false);\n  assert.equal(t.crew_size, 1);\n}\n\n// 21. ouvriers_prio ordonne le pool mais ne le réduit pas.\n{\n  const out = base({\n    ressources: [res("R1", "R1"), res("R2", "R2")],\n    groupesTypes: [{ id:"gt_reseau_elec", ordre:70, equipe_id:"EQ1", ouvriers_prio:["R2"] }],\n    equipes: [{ id:"EQ1", nom:"Élec", responsable:"R1", membres:[{ ouvrier:"R2" }], externe:false }],\n  });\n  const t = out.engineInput.travaux[0];\n  assert.deepEqual(t.candidate_resource_ids.sort(), ["R1", "R2"]);\n  assert.deepEqual(t.preferred_resource_ids, ["R2"]);\n}\n''')

engine_tests = "scripts/verif-planning-engine-v1.mjs"
with Path(engine_tests).open("a", encoding="utf-8") as f:
    f.write('''\n// 21. candidate_resource_ids est un pool hard : une ressource hors pool n'est jamais choisie, même préférée.\n{\n  const out = run({\n    travaux: [task("POOL", 2, { candidate_resource_ids:["R2"], preferred_resource_ids:["R1"] })],\n    ressources: [res("R1"), res("R2")],\n  });\n  assert.deepEqual(out.allocations_proposees[0].resource_ids, ["R2"]);\n}\n''')
