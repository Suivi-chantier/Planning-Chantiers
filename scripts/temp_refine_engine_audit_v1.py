from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if new in s:
        return
    if old not in s:
        raise SystemExit(f"Pattern not found in {path}: {old[:120]!r}")
    p.write_text(s.replace(old, new, 1))


# Adapter: inférence certaine V1 pour les anciens phasages.
replace_once(
    'src/Renovation/planningEngineAdapterV1.js',
    'import { regleGroupe } from "./planningRulesV1.js";\n',
    'import { regleGroupe } from "./planningRulesV1.js";\nimport { CONFIANCE_GROUPE_V1, infererGroupeExecutionV1 } from "./planningGroupInferenceV1.js";\n'
)
replace_once(
    'src/Renovation/planningEngineAdapterV1.js',
    '  let groupesTypesResolus = 0;\n  let groupesTypesManquants = 0;\n',
    '  let groupesTypesResolus = 0;\n  let groupesTypesInferes = 0;\n  let groupesTypesManquants = 0;\n'
)
replace_once(
    'src/Renovation/planningEngineAdapterV1.js',
    '''      const groupe = groupePourTache(tache, groupesParId, groupesTypesParId);\n      if (groupe.groupe_type_id) groupesTypesResolus++;\n      else groupesTypesManquants++;\n''',
    '''      let groupe = groupePourTache(tache, groupesParId, groupesTypesParId);\n      if (!groupe.groupe_type_id) {\n        const inference = infererGroupeExecutionV1({\n          code: ouvrage?.code_ouvrage || ouvrage?.code || ouvrage?.identifiant || null,\n          nom: tache?.nom,\n          lotId: ouvrage?.lot_id || ouvrage?.lotId || null,\n          position: tacheIndex + 1,\n        });\n        if (inference?.groupe_type_id && inference.confiance === CONFIANCE_GROUPE_V1.CERTAIN) {\n          groupe = {\n            ...groupe,\n            groupe_type_id: inference.groupe_type_id,\n            groupe_type: groupesTypesParId.get(inference.groupe_type_id) || null,\n            provenance: "inference_certaine",\n            inference,\n          };\n          groupesTypesInferes++;\n        }\n      }\n      if (groupe.groupe_type_id) groupesTypesResolus++;\n      else groupesTypesManquants++;\n'''
)
replace_once(
    'src/Renovation/planningEngineAdapterV1.js',
    '''      const preferred = mappingTache.ids.length\n        ? mappingTache.ids\n        : uniq(prefGroupe?.preferred_resource_ids);\n''',
    '''      // Le référentiel métier courant prime sur les affectations historiques\n      // portées par le phasage. `tache.ouvriers` reste un fallback soft uniquement\n      // lorsqu'aucune équipe/priorité de groupe n'est disponible.\n      const preferredGroupe = uniq(prefGroupe?.preferred_resource_ids);\n      const preferred = preferredGroupe.length ? preferredGroupe : mappingTache.ids;\n'''
)
replace_once(
    'src/Renovation/planningEngineAdapterV1.js',
    '    groupes_types_resolus: groupesTypesResolus,\n    groupes_types_non_resolus: groupesTypesManquants,\n',
    '    groupes_types_resolus: groupesTypesResolus,\n    groupes_types_inferes: groupesTypesInferes,\n    groupes_types_non_resolus: groupesTypesManquants,\n'
)

# Diff: compteurs stricts + fin chantier inconnue si proposition incomplète.
replace_once(
    'src/Renovation/planningEngineDiffV1.js',
    'export function diffForecastPropositionV1({ forecast = [], proposition = [] } = {}) {\n',
    'export function diffForecastPropositionV1({ forecast = [], proposition = [], nonPlanifies = [] } = {}) {\n'
)
replace_once(
    'src/Renovation/planningEngineDiffV1.js',
    '''  const chantierIds = uniq(changements.map(c => c.chantier_id)).sort();\n  const parChantier = chantierIds.map(chantierId => {\n''',
    '''  const nonPlanifiesParChantier = new Map();\n  for (const np of Array.isArray(nonPlanifies) ? nonPlanifies : []) {\n    const cid = txt(np?.chantier_id);\n    if (!cid) continue;\n    nonPlanifiesParChantier.set(cid, (nonPlanifiesParChantier.get(cid) || 0) + 1);\n  }\n  const chantierIds = uniq([...changements.map(c => c.chantier_id), ...nonPlanifiesParChantier.keys()]).sort();\n  const parChantier = chantierIds.map(chantierId => {\n'''
)
replace_once(
    'src/Renovation/planningEngineDiffV1.js',
    '''    const finCourante = currentEnds.at(-1) || null;\n    const finProposee = proposedEnds.at(-1) || null;\n    return {\n      chantier_id: chantierId,\n      taches: cc.length,\n      taches_modifiees: cc.filter(c => c.statut === "modifié").length,\n      nouvelles: cc.filter(c => c.statut === "nouveau").length,\n      non_replanifiees: cc.filter(c => c.statut === "non_replanifié").length,\n      fin_courante: finCourante,\n      fin_proposee: finProposee,\n      decalage_fin_jours: dateDiffDays(finProposee, finCourante),\n    };\n''',
    '''    const finCourante = currentEnds.at(-1) || null;\n    const finProposeePartielle = proposedEnds.at(-1) || null;\n    const tachesNonPlanifiees = nonPlanifiesParChantier.get(chantierId) || 0;\n    const propositionComplete = tachesNonPlanifiees === 0;\n    return {\n      chantier_id: chantierId,\n      taches: cc.length,\n      taches_modifiees: cc.filter(c => c.statut === "modifié").length,\n      nouvelles: cc.filter(c => c.statut === "nouveau").length,\n      non_replanifiees: cc.filter(c => c.statut === "non_replanifié").length,\n      taches_non_planifiees: tachesNonPlanifiees,\n      proposition_complete: propositionComplete,\n      fin_courante: finCourante,\n      fin_proposee: propositionComplete ? finProposeePartielle : null,\n      fin_proposee_partielle: finProposeePartielle,\n      decalage_fin_jours: propositionComplete ? dateDiffDays(finProposeePartielle, finCourante) : null,\n    };\n'''
)
replace_once(
    'src/Renovation/planningEngineDiffV1.js',
    '''      ressources_changees: changements.filter(c => c.details.includes("ressources")).length,\n      fractionnement_change: changements.filter(c => c.details.includes("fractionnement")).length,\n''',
    '''      ressources_changees: changements.filter(c => c.statut === "modifié" && c.details.includes("ressources")).length,\n      fractionnement_change: changements.filter(c => c.statut === "modifié" && c.details.includes("fractionnement")).length,\n      chantiers_incomplets: parChantier.filter(c => !c.proposition_complete).length,\n'''
)

# Data: transmettre les non-planifiés au diff.
replace_once(
    'src/Renovation/planningEngineDataV1.js',
    '''  const diff = diffForecastPropositionV1({\n    forecast: prepared.preparation.forecastCourant.allocations_recalculables,\n    proposition: proposition.allocations_proposees,\n  });\n''',
    '''  const diff = diffForecastPropositionV1({\n    forecast: prepared.preparation.forecastCourant.allocations_recalculables,\n    proposition: proposition.allocations_proposees,\n    nonPlanifies: proposition.non_planifies,\n  });\n'''
)

# UI: warnings agrégés + blocs opérationnels + chantiers incomplets explicites.
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '''  const warnings = [\n    ...(result?.warnings_adaptateur || []).map(x => ({ ...x, origine:"Données" })),\n    ...(result?.travaux_exclus || []).map(x => ({ ...x, origine:"Exclusion" })),\n    ...(p?.warnings || []).map(x => ({ ...x, origine:"Moteur" })),\n    ...(p?.non_planifies || []).map(x => ({ ...x, origine:"Non planifié", explication:x.raison })),\n  ];\n''',
    '''  const warnings = useMemo(() => {\n    const bruts = [\n      ...(result?.warnings_adaptateur || []).map(x => ({ ...x, origine:"Données" })),\n      ...(result?.travaux_exclus || []).map(x => ({ ...x, origine:"Exclusion" })),\n      ...(result?.proposition?.warnings || []).map(x => ({ ...x, origine:"Moteur" })),\n      ...(result?.proposition?.non_planifies || []).map(x => ({ ...x, origine:"Non planifié", explication:x.raison })),\n    ];\n    const groupes = new Map();\n    for (const w of bruts) {\n      const key = [w.origine, w.chantier_id || "", w.type || "", w.explication || w.raison || ""].join("|");\n      const prev = groupes.get(key);\n      if (prev) prev.count += 1;\n      else groupes.set(key, { ...w, count:1 });\n    }\n    return [...groupes.values()].sort((a,b) =>\n      `${a.origine}|${a.chantier_id || ""}|${a.type || ""}`.localeCompare(`${b.origine}|${b.chantier_id || ""}|${b.type || ""}`)\n    );\n  }, [result]);\n'''
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '  const allocations = (p?.allocations_proposees || []).slice(0, 80);\n',
    '''  const blocsOperationnels = useMemo(() => {\n    const groupes = new Map();\n    for (const x of result?.proposition?.allocations_proposees || []) {\n      const resources = [...(x.resource_ids || [])].sort();\n      const key = [x.date || "", x.chantier_id || "", x.groupe_type_id || "", resources.join(",")].join("|");\n      const prev = groupes.get(key);\n      if (!prev) {\n        groupes.set(key, { ...x, allocation_uid:`bloc_${key}`, resource_ids:resources, duree:Number(x.duree || 0), heures_mo:Number(x.heures_mo || 0), taches:[x.texte || "Tâche"], nb_taches:1 });\n      } else {\n        prev.duree += Number(x.duree || 0);\n        prev.heures_mo += Number(x.heures_mo || 0);\n        prev.nb_taches += 1;\n        prev.taches.push(x.texte || "Tâche");\n      }\n    }\n    return [...groupes.values()].map(b => ({\n      ...b,\n      duree: Math.round((b.duree + Number.EPSILON) * 100) / 100,\n      heures_mo: Math.round((b.heures_mo + Number.EPSILON) * 100) / 100,\n      texte: b.nb_taches > 1 ? `${b.nb_taches} tâches · ${b.taches.slice(0,2).join(" + ")}${b.nb_taches > 2 ? "…" : ""}` : b.taches[0],\n      detail_taches: b.taches.join(" • "),\n    })).sort((a,b) => `${a.date}|${a.chantier_id}|${a.resource_ids.join(",")}|${a.groupe_type_id || ""}`.localeCompare(`${b.date}|${b.chantier_id}|${b.resource_ids.join(",")}|${b.groupe_type_id || ""}`));\n  }, [result]);\n  const allocations = blocsOperationnels.slice(0, 80);\n'''
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '''              <Stat T={T} icon={ArrowRight} label="Tâches modifiées" value={diff?.resume?.modifiees ?? 0} sub={`${diff?.resume?.inchangees ?? 0} inchangées · ${diff?.resume?.nouvelles ?? 0} nouvelles`} color="#f59e0b"/>\n''',
    '''              <Stat T={T} icon={ArrowRight} label="Tâches modifiées" value={diff?.resume?.modifiees ?? 0} sub={`${diff?.resume?.inchangees ?? 0} inchangées · ${diff?.resume?.nouvelles ?? 0} nouvelles · ${diff?.resume?.non_replanifiees ?? 0} non replanifiées`} color="#f59e0b"/>\n'''
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '''                  const delta = c.decalage_fin_jours;\n                  const col = delta > 0 ? "#ef4444" : delta < 0 ? "#22c55e" : T.textMuted;\n                  return <div key={c.chantier_id} style={{ display:"grid", gridTemplateColumns:"minmax(150px,1fr) 110px 24px 110px 95px", gap:8, alignItems:"center", padding:"9px 11px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:12 }}>\n                    <strong style={{ color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{nomsChantiers.get(c.chantier_id) || c.chantier_id}</strong>\n                    <span style={{ color:T.textSub, textAlign:"right" }}>{fmtDate(c.fin_courante)}</span><Icon as={ArrowRight} size={13} color={T.textMuted}/><span style={{ color:T.textSub }}>{fmtDate(c.fin_proposee)}</span>\n                    <span style={{ color:col, fontWeight:850, textAlign:"right" }}>{delta == null ? "nouveau" : delta === 0 ? "stable" : `${delta > 0 ? "+" : ""}${delta} j`}</span>\n                  </div>;\n''',
    '''                  const delta = c.decalage_fin_jours;\n                  const incomplete = c.proposition_complete === false;\n                  const col = incomplete ? "#f59e0b" : delta > 0 ? "#ef4444" : delta < 0 ? "#22c55e" : T.textMuted;\n                  return <div key={c.chantier_id} style={{ display:"grid", gridTemplateColumns:"minmax(150px,1fr) 110px 24px 135px 105px", gap:8, alignItems:"center", padding:"9px 11px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:12 }}>\n                    <strong style={{ color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{nomsChantiers.get(c.chantier_id) || c.chantier_id}</strong>\n                    <span style={{ color:T.textSub, textAlign:"right" }}>{fmtDate(c.fin_courante)}</span><Icon as={ArrowRight} size={13} color={T.textMuted}/><span style={{ color:incomplete ? "#f59e0b" : T.textSub }}>{incomplete ? `incomplet (${c.taches_non_planifiees})` : fmtDate(c.fin_proposee)}</span>\n                    <span style={{ color:col, fontWeight:850, textAlign:"right" }}>{incomplete ? "à compléter" : delta == null ? "nouveau" : delta === 0 ? "stable" : `${delta > 0 ? "+" : ""}${delta} j`}</span>\n                  </div>;\n'''
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '                  <span style={{ color:T.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={x.texte}>{x.texte}</span>\n',
    '                  <span style={{ color:T.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={x.detail_taches || x.texte}>{x.texte}</span>\n'
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '''              {(p?.allocations_proposees?.length || 0) > allocations.length && <div style={{ padding:"8px 10px", borderTop:`1px solid ${T.border}`, fontSize:11, color:T.textMuted }}>+ {(p.allocations_proposees.length - allocations.length)} autres créneaux dans le calcul</div>}\n''',
    '''              {blocsOperationnels.length > allocations.length && <div style={{ padding:"8px 10px", borderTop:`1px solid ${T.border}`, fontSize:11, color:T.textMuted }}>+ {blocsOperationnels.length - allocations.length} autres blocs opérationnels · {p?.allocations_proposees?.length || 0} allocations détaillées au total</div>}\n'''
)
replace_once(
    'src/Renovation/PlanningEngineSimulationPanel.jsx',
    '''                  <div style={{ minWidth:0 }}><div style={{ fontSize:10, fontWeight:850, letterSpacing:.8, textTransform:"uppercase", color:T.textMuted }}>{w.origine}{w.chantier_id ? ` · ${nomsChantiers.get(w.chantier_id) || w.chantier_id}` : ""}</div><div style={{ marginTop:2, fontSize:11.5, lineHeight:1.4, color:T.textSub }}>{w.explication || w.raison || w.type}</div></div>\n''',
    '''                  <div style={{ minWidth:0 }}><div style={{ fontSize:10, fontWeight:850, letterSpacing:.8, textTransform:"uppercase", color:T.textMuted }}>{w.origine}{w.chantier_id ? ` · ${nomsChantiers.get(w.chantier_id) || w.chantier_id}` : ""}{w.count > 1 ? ` · ×${w.count}` : ""}</div><div style={{ marginTop:2, fontSize:11.5, lineHeight:1.4, color:T.textSub }}>{w.explication || w.raison || w.type}</div></div>\n'''
)

# Fixtures adaptateur.
p = Path('scripts/verif-planning-engine-adapter-v1.mjs')
s = p.read_text()
if '19 scénarios métier validés' not in s:
    marker = 'console.log("✓ Planning Engine Adapter V1 — 17 scénarios métier validés");'
    if marker not in s:
        raise SystemExit('Adapter test marker not found')
    extra = r'''

// 18. Un ancien phasage sans chrono_groupes récupère un groupe seulement si l'inférence V1 est certaine.
{
  const old = phasage({ taches: [task("LEG-INF", { nom:"Passage alimentation PER WC", chrono_groupe_id:null, ouvriers:[] })], groupes: [] });
  old.ouvrages[0].code_ouvrage = null;
  old.ouvrages[0].lot_id = "plomberie";
  const out = base({ phasages:[old] });
  const t = out.engineInput.travaux.find(x => x.tache_id === "LEG-INF");
  assert.ok(t);
  assert.equal(t.groupe_type_id, "gt_reseau_plomberie");
  assert.equal(t.provenance.groupe_type, "inference_certaine");
  assert.equal(out.audit.groupes_types_inferes, 1);
}

// 19. Le référentiel groupe courant prime sur des ouvriers historiques devenus obsolètes.
{
  const ressources = [res("L", "Loris"), res("S", "Selman"), res("V", "Venceslas"), res("ST", "Steven"), res("M", "Mohamed")];
  const out = base({
    ressources,
    phasages:[phasage({ taches:[task("PLUMB", { ouvriers:["Loris","Selman"] })], groupes:[{ id:"G1", ordre:50, groupe_type_id:"gt_reseau_plomberie" }] })],
    groupesTypes:[{ id:"gt_reseau_plomberie", ordre:50, equipe_id:"EQP", ouvriers_prio:[] }],
    equipes:[{ id:"EQP", nom:"Plomberie", responsable:"Venceslas", membres:[{ouvrier:"Steven"},{ouvrier:"Mohamed"}], externe:false }],
  });
  const t = out.engineInput.travaux[0];
  assert.deepEqual(t.preferred_resource_ids.sort(), ["M","ST","V"]);
  assert.equal(t.crew_size, 2);
}
'''
    p.write_text(s.replace(marker, extra + '\nconsole.log("✓ Planning Engine Adapter V1 — 19 scénarios métier validés");'))

# Fixtures diff.
p = Path('scripts/verif-planning-engine-diff-v1.mjs')
s = p.read_text()
if '9 scénarios métier validés' not in s:
    s = s.replace('''  assert.equal(d.resume.nouvelles, 1);\n  assert.equal(d.changements[0].statut, "nouveau");\n''', '''  assert.equal(d.resume.nouvelles, 1);\n  assert.equal(d.changements[0].statut, "nouveau");\n  assert.equal(d.resume.ressources_changees, 0);\n  assert.equal(d.resume.fractionnement_change, 0);\n''', 1)
    s = s.replace('''  assert.equal(d.resume.non_replanifiees, 1);\n  assert.equal(d.changements[0].statut, "non_replanifié");\n''', '''  assert.equal(d.resume.non_replanifiees, 1);\n  assert.equal(d.changements[0].statut, "non_replanifié");\n  assert.equal(d.resume.ressources_changees, 0);\n''', 1)
    marker = 'console.log("✓ Planning Engine Diff V1 — 8 scénarios métier validés");'
    if marker not in s:
        raise SystemExit('Diff test marker not found')
    extra = r'''

// 9. Une proposition chantier incomplète ne prétend jamais fournir une nouvelle date de fin.
{
  const forecast = [cur("A", "2026-09-05", 2, ["R1"], { tache_id:"T1" })];
  const proposition = [prop("P", "2026-09-02", 2, ["R1"], { travail_id:"C1::T1", tache_id:"T1" })];
  const d = diffForecastPropositionV1({ forecast, proposition, nonPlanifies:[{ chantier_id:"C1", tache_id:"T2" }] });
  const c = d.par_chantier[0];
  assert.equal(c.proposition_complete, false);
  assert.equal(c.taches_non_planifiees, 1);
  assert.equal(c.fin_proposee, null);
  assert.equal(c.fin_proposee_partielle, "2026-09-02");
  assert.equal(c.decalage_fin_jours, null);
  assert.equal(d.resume.chantiers_incomplets, 1);
}
'''
    p.write_text(s.replace(marker, extra + '\nconsole.log("✓ Planning Engine Diff V1 — 9 scénarios métier validés");'))
