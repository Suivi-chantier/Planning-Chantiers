from pathlib import Path
p = Path("scripts/verif-planning-engine-adapter-v1.mjs")
s = p.read_text(encoding="utf-8")
old = '''  const out = base({ phasages:[old] });'''
new = '''  const out = base({
    phasages:[old],
    groupesTypes:[{ id:"gt_reseau_plomberie", ordre:50, equipe_id:"EQP", ouvriers_prio:[] }],
    equipes:[{ id:"EQP", nom:"Plomberie", responsable:"R1", membres:[], externe:false }],
  });'''
if old not in s:
    raise SystemExit("fixture inference certaine introuvable")
p.write_text(s.replace(old, new, 1), encoding="utf-8")
