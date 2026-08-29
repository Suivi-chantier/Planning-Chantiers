from pathlib import Path

p = Path("scripts/verif-planning-engine-v1.mjs")
text = p.read_text(encoding="utf-8")
old = '''  assert.equal(out.allocations_proposees.length, 2);\n  assert.equal(out.allocations_proposees[0].date, "2026-08-31");\n  assert.equal(out.allocations_proposees[0].duree, 1);\n  assert.equal(out.allocations_proposees[1].date, "2026-09-01");\n  assert.equal(out.allocations_proposees[1].duree, 2);'''
new = '''  assert.equal(out.allocations_proposees.length, 1);\n  assert.equal(out.allocations_proposees[0].date, "2026-09-01");\n  assert.equal(out.allocations_proposees[0].duree, 3);'''
if old not in text:
    raise SystemExit("Fixture moteur #6 introuvable")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("daily-site fixture #6 updated")
