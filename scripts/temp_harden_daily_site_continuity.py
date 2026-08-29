from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Motif introuvable dans {path}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")


engine = "src/Renovation/planningEngineV1.js"
adapter = "src/Renovation/planningEngineAdapterV1.js"
engine_test = "scripts/verif-planning-engine-v1.mjs"
adapter_test = "scripts/verif-planning-engine-adapter-v1.mjs"

# ── Contrat moteur : chaque travail/allocation porte un site logique.
replace_once(engine,
'''    chantier_id: str(t.chantier_id) || null,\n    groupe_type_id: groupe,''',
'''    chantier_id: str(t.chantier_id) || null,\n    site_id: str(t.site_id || t.operation_id || t.chantier_id) || null,\n    groupe_type_id: groupe,''')

replace_once(engine,
'''    chantier_id: str(a.chantier_id) || null,\n    date: dateOnly(a.date),''',
'''    chantier_id: str(a.chantier_id) || null,\n    site_id: str(a.site_id || a.operation_id || a.chantier_id) || null,\n    date: dateOnly(a.date),''')

replace_once(engine,
'''function ajouterCharge(map, resourceId, date, heures, chantierId = null) {\n  const key = keyCharge(resourceId, date);\n  const prev = map.get(key) || { heures: 0, chantiers: new Set() };\n  prev.heures = round2(prev.heures + Math.max(0, num(heures, 0)));\n  if (chantierId) prev.chantiers.add(String(chantierId));\n  map.set(key, prev);\n}\n\nexport function construireChargeExistanteV1(allocations = []) {\n  const map = new Map();\n  (Array.isArray(allocations) ? allocations : [])\n    .map(normaliserAllocationExistanteV1)\n    .filter(a => a.date && a.duree > EPS)\n    .forEach(a => a.resource_ids.forEach(rid => ajouterCharge(map, rid, a.date, a.duree, a.chantier_id)));\n  return map;\n}''',
'''function ajouterCharge(map, resourceId, date, heures, chantierId = null, siteId = null) {\n  const key = keyCharge(resourceId, date);\n  const prev = map.get(key) || { heures: 0, chantiers: new Set(), sites: new Set() };\n  prev.heures = round2(prev.heures + Math.max(0, num(heures, 0)));\n  if (chantierId) prev.chantiers.add(String(chantierId));\n  const site = str(siteId || chantierId);\n  if (site) prev.sites.add(site);\n  map.set(key, prev);\n}\n\nexport function construireChargeExistanteV1(allocations = []) {\n  const map = new Map();\n  (Array.isArray(allocations) ? allocations : [])\n    .map(normaliserAllocationExistanteV1)\n    .filter(a => a.date && a.duree > EPS)\n    .forEach(a => a.resource_ids.forEach(rid => ajouterCharge(map, rid, a.date, a.duree, a.chantier_id, a.site_id)));\n  return map;\n}''')

replace_once(engine,
'''function chargePour(charge, resourceId, date) {\n  return charge.get(keyCharge(resourceId, date)) || { heures: 0, chantiers: new Set() };\n}''',
'''function chargePour(charge, resourceId, date) {\n  return charge.get(keyCharge(resourceId, date)) || { heures: 0, chantiers: new Set(), sites: new Set() };\n}''')

replace_once(engine,
'''  for (const r of allCandidates) {\n    const load = chargePour(charge, r.id, date);\n    const capacite = calculerCapaciteRessourcePourDate({''',
'''  for (const r of allCandidates) {\n    const load = chargePour(charge, r.id, date);\n    // Contrat chantier 04 : une ressource reste sur un seul site physique par\n    // journée. Deux logements/chantiers d'une même opération peuvent partager\n    // le même `site_id`; un changement de site est différé au prochain jour.\n    if (load.sites.size > 0 && !load.sites.has(travail.site_id)) continue;\n    const capacite = calculerCapaciteRessourcePourDate({''')

replace_once(engine,
'''    let score = capacite.capacite_disponible;\n    if (travail.preferred_resource_ids.includes(r.id)) score += 1000;\n    if (load.chantiers.has(travail.chantier_id)) score += 300;\n    else if (load.chantiers.size > 0) score -= 120;''',
'''    let score = capacite.capacite_disponible;\n    if (travail.preferred_resource_ids.includes(r.id)) score += 1000;\n    if (load.chantiers.has(travail.chantier_id)) score += 350;\n    else if (load.sites.has(travail.site_id)) score += 220;''')

replace_once(engine,
'''        const switchedResources = crew.selected\n          .filter(x => {\n            const load = chargePour(charge, x.resource.id, date);\n            return load.chantiers.size > 0 && !load.chantiers.has(t.chantier_id);\n          })\n          .map(x => x.resource.id);''',
'''        const switchedResources = crew.selected\n          .filter(x => {\n            const load = chargePour(charge, x.resource.id, date);\n            return load.sites.size > 0 && !load.sites.has(t.site_id);\n          })\n          .map(x => x.resource.id);''')

replace_once(engine,
'''          chantier_id: t.chantier_id,\n          groupe_type_id: t.groupe_type_id,''',
'''          chantier_id: t.chantier_id,\n          site_id: t.site_id,\n          groupe_type_id: t.groupe_type_id,''')

replace_once(engine,
'''            contraintes_appliquees: candidate.dateEval.applied_constraint_ids,\n            violations: candidate.dateEval.violations,''',
'''            contraintes_appliquees: candidate.dateEval.applied_constraint_ids,\n            violations: candidate.dateEval.violations,\n            site_id: t.site_id,''')

replace_once(engine,
'''        resourceIds.forEach(rid => ajouterCharge(charge, rid, date, elapsed, t.chantier_id));''',
'''        resourceIds.forEach(rid => ajouterCharge(charge, rid, date, elapsed, t.chantier_id, t.site_id));''')

replace_once(engine,
'''            explication: "Ressource déjà utilisée sur un autre chantier le même jour ; autorisé faute de meilleure option mais signalé comme préférence dégradée.",''',
'''            explication: "Anomalie de continuité : une ressource sélectionnée appartenait déjà à un autre site le même jour.",''')

replace_once(engine,
'''      moteur_deterministe_a_entrees_identiques: true,\n    },''',
'''      moteur_deterministe_a_entrees_identiques: true,\n      un_seul_site_par_ressource_et_par_jour: true,\n    },''')

# ── Adaptateur : site explicite > opération > chantier.
replace_once(adapter,
'''  const chantierMap = new Map((Array.isArray(chantiers) ? chantiers : [])\n    .filter(c => txt(c?.id))\n    .map(c => [txt(c.id), c]));\n  const configChantiersDisponible = chantierMap.size > 0;''',
'''  const chantierMap = new Map((Array.isArray(chantiers) ? chantiers : [])\n    .filter(c => txt(c?.id))\n    .map(c => [txt(c.id), c]));\n  const siteIdPourChantier = (chantierId) => {\n    const cid = txt(chantierId);\n    const chantier = chantierMap.get(cid);\n    return txt(chantier?.site_id) || txt(chantier?.operation_id) || cid || null;\n  };\n  const configChantiersDisponible = chantierMap.size > 0;''')

replace_once(adapter,
'''    const chantier = chantierMap.get(chantierId);\n    if (configChantiersDisponible && !chantier) {''',
'''    const chantier = chantierMap.get(chantierId);\n    const siteId = siteIdPourChantier(chantierId);\n    if (configChantiersDisponible && !chantier) {''')

replace_once(adapter,
'''        chantier_id: chantierId,\n        groupe_type_id: groupe.groupe_type_id,''',
'''        chantier_id: chantierId,\n        site_id: siteId,\n        groupe_type_id: groupe.groupe_type_id,''')

replace_once(adapter,
'''          phasage_id: txt(ph?.id) || null,\n          ouvrage_id: txt(ouvrage?.id) || null,''',
'''          phasage_id: txt(ph?.id) || null,\n          site_id: siteId,\n          ouvrage_id: txt(ouvrage?.id) || null,''')

replace_once(adapter,
'''      chantier_id: a.chantier_id,\n      date: a.date,''',
'''      chantier_id: a.chantier_id,\n      site_id: siteIdPourChantier(a.chantier_id),\n      date: a.date,''')

replace_once(adapter,
'''      groupes_externes_sans_override_exclus: true,\n      formule_restant_mo:''',
'''      groupes_externes_sans_override_exclus: true,\n      continuite_site_journaliere: "site_id explicite, sinon operation_id, sinon chantier_id",\n      formule_restant_mo:''')

# ── Fixture moteur : un changement de site est désormais interdit par défaut.
p = Path(engine_test)
text = p.read_text(encoding="utf-8")
pattern = re.compile(r'// 15\. Changement de chantier.*?(?=// 16\.)', re.S)
replacement = '''// 15. Une ressource déjà engagée sur un autre site ne saute pas de chantier pour remplir sa journée.\n{\n  const out = run({\n    travaux: [task("T4", 1, { chantier_id: "chantier-A", site_id: "SITE-A", candidate_resource_ids: ["R1"] })],\n    allocationsExistantes: [{\n      allocation_uid: "OTHER", chantier_id: "chantier-B", site_id: "SITE-B", tache_id: "OLD",\n      date: "2026-08-31", duree: 1, resource_ids: ["R1"],\n    }],\n    horizonDays: 2,\n  });\n  assert.equal(out.allocations_proposees.length, 1);\n  assert.equal(out.allocations_proposees[0].date, "2026-09-01");\n  assert.equal(out.warnings.some(w => w.type === "changement_chantier_meme_jour"), false);\n}\n\n'''
text, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit("Fixture moteur #15 introuvable")
text = text.replace('console.log("✓ Planning Engine V1 — 20 scénarios métier validés");\n', '', 1)
text += '''\n\n// 22. Deux chantiers d'un même site/opération peuvent être enchaînés le même jour.\n{\n  const out = run({\n    travaux: [task("SITE-SAME", 2, { chantier_id:"chantier-B", site_id:"OP-X", candidate_resource_ids:["R1"] })],\n    allocationsExistantes: [{\n      allocation_uid:"SAME", chantier_id:"chantier-A", site_id:"OP-X", tache_id:"OLD",\n      date:"2026-08-31", duree:1, resource_ids:["R1"],\n    }],\n    horizonDays:1,\n  });\n  assert.equal(out.allocations_proposees.length, 1);\n  assert.equal(out.allocations_proposees[0].date, "2026-08-31");\n  assert.equal(out.allocations_proposees[0].site_id, "OP-X");\n}\n\n// 23. Le fallback sans site explicite reste déterministe sur chantier_id.\n{\n  const out = run({\n    travaux:[task("FALLBACK", 1, { chantier_id:"chantier-A", candidate_resource_ids:["R1"] })],\n    horizonDays:1,\n  });\n  assert.equal(out.allocations_proposees[0].site_id, "chantier-A");\n}\n\nconsole.log("✓ Planning Engine V1 — 23 scénarios métier validés");\n'''
p.write_text(text, encoding="utf-8")

# ── Fixture adaptateur : operation_id devient le site logique des tâches et locks.
p = Path(adapter_test)
text = p.read_text(encoding="utf-8")
text = text.replace('console.log("✓ Planning Engine Adapter V1 — 19 scénarios métier validés");\n', '', 1)
text += '''\n\n// 22. L'opération regroupe plusieurs chantiers sur un même site logique pour le moteur.\n{\n  const out = base({\n    chantiers:[{ id:"C1", nom:"Logement", statut:"en_cours", operation_id:"OP-CHANTIER" }],\n    cellules:[cell({ uid:"LOCK-SITE", duree:1 })],\n    contraintes:[{ id:"LOCK-SITE-C", type:"allocation_lock", scope:"allocation", allocation_id:"LOCK-SITE", chantier_id:"C1", hard:true, actif:true }],\n  });\n  assert.equal(out.engineInput.travaux[0].site_id, "OP-CHANTIER");\n  assert.equal(out.engineInput.allocationsExistantes[0].site_id, "OP-CHANTIER");\n}\n\n// 23. Un site_id explicite peut corriger un chantier legacy sans operation_id.\n{\n  const out = base({\n    chantiers:[{ id:"C1", nom:"Logement", statut:"en_cours", operation_id:"OP-OLD", site_id:"SITE-EXPLICITE" }],\n  });\n  assert.equal(out.engineInput.travaux[0].site_id, "SITE-EXPLICITE");\n}\n\nconsole.log("✓ Planning Engine Adapter V1 — 23 scénarios métier validés");\n'''
p.write_text(text, encoding="utf-8")

print("daily-site continuity hardening applied")
