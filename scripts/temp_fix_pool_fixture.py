from pathlib import Path
p = Path("scripts/verif-planning-engine-adapter-v1.mjs")
s = p.read_text(encoding="utf-8")
old = '''  const out = base({ phasages: [phasage({ taches: [task("T1", { groupe_type_id: "gt_peinture" })] })], groupesTypes: [\n    { id: "gt_reseau_elec", ordre: 70 }, { id: "gt_peinture", ordre: 90 },\n  ] });'''
new = '''  const out = base({ phasages: [phasage({ taches: [task("T1", { groupe_type_id: "gt_peinture" })] })], groupesTypes: [\n    { id: "gt_reseau_elec", ordre: 70, equipe_id: "EQ1" }, { id: "gt_peinture", ordre: 90, equipe_id: "EQ1" },\n  ] });'''
if old not in s:
    raise SystemExit("fixture groupe direct introuvable")
p.write_text(s.replace(old, new, 1), encoding="utf-8")
