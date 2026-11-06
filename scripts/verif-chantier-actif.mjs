// Vérifie la règle unique « chantier actif » et l'écriture ligne par ligne des
// chantiers (Refonte Opérations, lot 1). Aucun réseau, aucune base : données
// fictives construites ici, plus lecture des sources du dépôt.
//   node scripts/verif-chantier-actif.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUTS_CHANTIER, STATUTS_HORS_EXPLOITATION, estChantierActif, estChantierTermine,
  estChantierArchive, filtrerChantiersActifs, statutDuChantier,
} from "../src/Renovation/chantierActif.mjs";
import {
  calculerEcritures, depuisLigneChantier, depuisLigneOperation, versChampsChantier, trierLignes, memeValeur,
} from "../src/Renovation/chantiersTables.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ─── 1. Modules purs ────────────────────────────────────────────────────────
test("1. modules purs : ni Supabase, ni horloge ; façades .js présentes", () => {
  for (const f of ["src/Renovation/chantierActif.mjs", "src/Renovation/chantiersTables.mjs"]) {
    const s = lire(f);
    assert.ok(!/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(s), `${f} : aucun import Supabase`);
    assert.ok(!/Date\.now\s*\(|new Date\(\s*\)/.test(s), `${f} : aucune horloge`);
    assert.ok(!/\.from\s*\(\s*["']|\.rpc\s*\(/.test(s), `${f} : aucun accès base`);
  }
  assert.match(lire("src/Renovation/chantierActif.js"), /export \* from "\.\/chantierActif\.mjs"/);
  assert.match(lire("src/Renovation/chantiersTables.js"), /export \* from "\.\/chantiersTables\.mjs"/);
});

// ─── 2. La règle ────────────────────────────────────────────────────────────
test("2. statuts actuels : seul « terminé » sort des listes de chantiers en vie", () => {
  assert.deepEqual([...STATUTS_CHANTIER], ["planifie", "en_cours", "en_pause", "termine"]);
  assert.equal(estChantierActif({ id: "a" }), true, "sans statut = actif");
  assert.equal(estChantierActif({ id: "a", statut: "" }), true);
  assert.equal(estChantierActif({ id: "a", statut: "planifie" }), true);
  assert.equal(estChantierActif({ id: "a", statut: "en_cours" }), true);
  assert.equal(estChantierActif({ id: "a", statut: "en_pause" }), true);
  assert.equal(estChantierActif({ id: "a", statut: "termine" }), false);
  assert.equal(estChantierActif({ id: "a", statut: " termine " }), false, "espaces ignorés");
  assert.equal(estChantierTermine({ id: "a", statut: "termine" }), true);
  assert.equal(statutDuChantier({ statut: "  " }), null);
});

test("3. inclureTermines : les listes qui montraient les terminés les gardent", () => {
  assert.equal(estChantierActif({ id: "a", statut: "termine" }, { inclureTermines: true }), true);
  assert.equal(estChantierActif({ id: "a" }, { inclureTermines: true }), true);
});

test("4. archivé, sans identifiant, non-objet : jamais affiché", () => {
  assert.equal(estChantierArchive({ id: "a", archive_le: "2026-11-06T10:00:00Z" }), true);
  assert.equal(estChantierActif({ id: "a", archive_le: "2026-11-06T10:00:00Z" }, { inclureTermines: true }), false);
  assert.equal(estChantierActif({ id: "a", archive: true }, { inclureTermines: true }), false, "ancien drapeau archive");
  assert.equal(estChantierActif({ nom: "sans id" }, { inclureTermines: true }), false);
  assert.equal(estChantierActif({ id: "  " }), false);
  assert.equal(estChantierActif(null), false);
  assert.equal(estChantierActif("a"), false);
});

test("5. lot 1 : aucun statut hors exploitation (comportement visible inchangé)", () => {
  assert.deepEqual([...STATUTS_HORS_EXPLOITATION], []);
  const liste = [{ id: "a" }, { id: "b", statut: "termine" }, { id: "c", statut: "en_pause" }, { id: "d", archive_le: "x" }];
  assert.deepEqual(filtrerChantiersActifs(liste).map(c => c.id), ["a", "c"]);
  assert.deepEqual(filtrerChantiersActifs(liste, { inclureTermines: true }).map(c => c.id), ["a", "b", "c"]);
  assert.deepEqual(filtrerChantiersActifs(null), []);
});

// ─── 3. Écriture ligne par ligne ────────────────────────────────────────────
const ligne = (id, extra = {}) => ({ id, operation_id: `op_${id}`, nom: id.toUpperCase(), couleur: "#111111", statut: null, ordre: 0, donnees: {}, created_at: "2026-11-06T00:00:00Z", ...extra });
const connues = new Map([
  ["a", ligne("a", { ordre: 0 })],
  ["b", ligne("b", { ordre: 1, statut: "en_cours" })],
  ["c", ligne("c", { ordre: 2, donnees: { site_id: "S1" } })],
]);
const listeServeur = () => trierLignes([...connues.values()]).map(depuisLigneChantier);

test("6. aller-retour ligne → objet → champs sans perte (donnees conservées)", () => {
  const o = depuisLigneChantier(connues.get("c"));
  assert.deepEqual(o, { site_id: "S1", id: "c", nom: "C", couleur: "#111111", operation_id: "op_c" });
  assert.deepEqual(versChampsChantier(o).donnees, { site_id: "S1" });
  const op = depuisLigneOperation({ id: "o", nom: "Op", adresse: "", couleur: null, donnees: {}, creee_automatiquement: true });
  assert.equal(op.couleur, "#888888");
  assert.equal(op.creee_automatiquement, true);
});

test("7. rien de modifié : aucune écriture", () => {
  assert.deepEqual(calculerEcritures(connues, listeServeur()), { inserts: [], updates: [] });
});

test("8. statut d'UN chantier : une seule mise à jour, un seul champ", () => {
  const liste = listeServeur().map(c => c.id === "b" ? { ...c, statut: "termine" } : c);
  assert.deepEqual(calculerEcritures(connues, liste), { inserts: [], updates: [{ id: "b", patch: { statut: "termine" } }] });
});

test("9. liste locale en retard (chantier d'un collègue absent) : rien n'est écrasé ni déplacé", () => {
  const liste = listeServeur().filter(c => c.id !== "b").map(c => c.id === "a" ? { ...c, nom: "A2" } : c);
  assert.deepEqual(calculerEcritures(connues, liste), { inserts: [], updates: [{ id: "a", patch: { nom: "A2" } }] });
});

test("10. nouveau chantier sans opération : INSERT sans operation_id (la base lui en crée une)", () => {
  const liste = [...listeServeur(), { id: "n", nom: "NOUVEAU", couleur: "#222222" }];
  const { inserts, updates } = calculerEcritures(connues, liste);
  assert.equal(updates.length, 0);
  assert.equal(inserts.length, 1);
  assert.equal("operation_id" in inserts[0], false);
  assert.equal(inserts[0].ordre, 3, "placé après le dernier");
});

test("11. operation_id vidé : jamais envoyé (on ne détache pas un chantier)", () => {
  const liste = listeServeur().map(c => c.id === "a" ? { ...c, operation_id: "" } : c);
  assert.deepEqual(calculerEcritures(connues, liste), { inserts: [], updates: [] });
});

test("12. déplacement : seules les lignes dont le rang change sont réécrites", () => {
  const [a, b, c] = listeServeur();
  const { updates } = calculerEcritures(connues, [b, a, c]);
  assert.deepEqual(updates, [{ id: "b", patch: { ordre: 0 } }, { id: "a", patch: { ordre: 1 } }]);
});

test("13. champ inconnu ajouté : rangé dans donnees, comparaison profonde", () => {
  const liste = listeServeur().map(c => c.id === "c" ? { ...c, site_id: "S1", note: { x: [1, 2] } } : c);
  assert.deepEqual(calculerEcritures(connues, liste).updates, [{ id: "c", patch: { donnees: { site_id: "S1", note: { x: [1, 2] } } } }]);
  assert.equal(memeValeur({ a: 1, b: [1] }, { b: [1], a: 1 }), true);
});

test("14. opérations : même principe", () => {
  const ops = new Map([["o1", { id: "o1", nom: "Op 1", adresse: "", couleur: "#333333", ordre: 0, donnees: {} }]]);
  const r = calculerEcritures(ops, [{ id: "o1", nom: "Op 1", adresse: "1 rue X", couleur: "#333333" }, { id: "o2", nom: "Op 2" }], { type: "operation" });
  assert.deepEqual(r.updates, [{ id: "o1", patch: { adresse: "1 rue X" } }]);
  assert.equal(r.inserts.length, 1);
  assert.equal(r.inserts[0].couleur, "#888888");
});

// ─── 4. Sources : la règle n'est écrite qu'une fois ─────────────────────────
function fichiers(dir) {
  const out = [];
  for (const nom of readdirSync(join(racine, dir))) {
    const rel = join(dir, nom);
    if (statSync(join(racine, rel)).isDirectory()) out.push(...fichiers(rel));
    else if (/\.(m?js|jsx)$/.test(nom)) out.push(rel);
  }
  return out;
}
const sources = [...fichiers("src"), ...fichiers("api")]
  .filter(f => !/^src[\\/](Invest|Portail)[\\/]/.test(f))
  .map(f => relative(racine, join(racine, f)).replace(/\\/g, "/"));
const sansCommentaires = (s) => s.split("\n").filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n");

test("15. aucune page ne refiltre le statut « terminé » ou l'archivage à la main", () => {
  const exceptions = new Set(["src/Renovation/chantierActif.mjs"]);
  const motif = /statut\)?\s*[!=]==?\s*["']termine["']|["']termine["']\s*[!=]==?\s*[\w?.]*statut\b|!\s*\w+\.archive\b/;
  const fautifs = sources.filter(f => !exceptions.has(f) && motif.test(sansCommentaires(lire(f))));
  assert.deepEqual(fautifs, [], `filtre recopié : passer par estChantierActif() — ${fautifs.join(", ")}`);
});

test("16. les listes de chantiers du front lisent la table, pas le bloc planning_config", () => {
  // Restent sur la copie planning_config (tenue par la base) : le formulaire
  // de rapport, ouvert aussi sans connexion (clé anonyme), qui n'a aucun droit
  // sur les nouvelles tables — accès inchangé, ni plus ni moins.
  const exceptions = new Set(["src/Renovation/RapportMobile.jsx"]);
  const motif = /\.eq\(\s*["']key["']\s*,\s*["'](chantiers|operations)["']|\.in\(\s*["']key["']\s*,\s*\[[^\]]*["'](chantiers|operations)["']|\.key\s*===?\s*["'](chantiers|operations)["']/;
  const fautifs = sources.filter(f => f.startsWith("src/") && !exceptions.has(f) && motif.test(sansCommentaires(lire(f))));
  assert.deepEqual(fautifs, [], `lecture du bloc planning_config : ${fautifs.join(", ")}`);
});

test("17. App : les pages d'exploitation reçoivent la liste filtrée par la règle", () => {
  const app = lire("src/App.jsx");
  assert.match(app, /const chantiersExploitation=useMemo\(\(\)=>filtrerChantiersActifs\(chantiers,\{inclureTermines:true\}\),\[chantiers\]\)/);
  const brutes = [...app.matchAll(/<(\w+)[^>]*\bchantiers=\{chantiers\}/g)].map(m => m[1]).sort();
  assert.deepEqual(brutes, ["PageAdmin", "PageChantiers", "PageInfoClient", "PageOperations"],
    "seules la gestion (Chantiers, Opérations, Administration) et le Chiffrage reçoivent la liste complète");
  assert.match(app, /if\(key==="chantiers"\)\{\s*const r=await sauverChantiers\(value\)/, "saveConfig(\"chantiers\") écrit ligne par ligne");
  assert.match(app, /if\(key==="operations"\)\{await sauverOperations\(value\?\.items\);return;\}/);
});

test("18. pages qui filtraient déjà : elles appellent la règle", () => {
  const attendus = {
    "src/Renovation/Planning.jsx": /filtrerChantiersActifs\(chantiersAll\)/,
    "src/Renovation/BilanPeriode.jsx": /estChantierActif\(c\)/,
    "src/Renovation/PanneauAutreChose.jsx": /estChantierActif\(c\)/,
    "src/Renovation/OuvrierMesPhases.jsx": /estChantierActif\(c\)/,
    "src/Renovation/OuvrierChantiers.jsx": /filtrerChantiersActifs\(tous, \{ inclureTermines: true \}\)/,
    "src/Renovation/planningOperationV1.mjs": /estChantierActif\(c\)/,
    "src/Renovation/planningEngineAdapterV1.js": /estChantierActif\(chantier\)/,
    "src/Renovation/planningReplanningAdapterV1.js": /estChantierActif\(c\)/,
    "api/_partage/relevesJournaliers.js": /estChantierTermine\(c\)/,
    "api/_ia/renovation/outils.js": /estChantierActif\(c, \{ inclureTermines: true \}\)/,
  };
  for (const [f, re] of Object.entries(attendus)) assert.match(lire(f), re, f);
});

// ─── 5. Migration ───────────────────────────────────────────────────────────
test("19. migration : lien obligatoire, policy restrictive, aucune suppression", () => {
  const nom = readdirSync(join(racine, "supabase/migrations")).find(f => /_refonte_operations_lot1\.sql$/.test(f));
  assert.ok(nom, "migration du lot 1 versionnée");
  const sql = sansCommentaires(lire(`supabase/migrations/${nom}`).replace(/--[^\n]*/g, "")).toLowerCase();
  assert.match(sql, /operation_id\s+text\s+not null references public\.operations\(id\)/);
  for (const t of ["operations", "chantiers", "planning_config_sauvegarde_refonte"]) {
    assert.match(sql, new RegExp(`create policy profero_collaborateurs_seulement on public\\.${t}\\s+as restrictive`), `${t} : policy restrictive`);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} : RLS`);
  }
  assert.ok(!/\bdelete\s+from\b|\bdrop\s+(table|column)\b|\btruncate\b/.test(sql), "aucune suppression de donnée");
  assert.ok(!/security\s+definer/.test(sql), "aucune fonction SECURITY DEFINER");
  assert.ok(!/grant[^;]*\bdelete\b[^;]*public\.(operations|chantiers)/.test(sql), "pas de droit DELETE sur les nouvelles tables");
  assert.match(sql, /revoke all on public\.operations, public\.chantiers from anon, authenticated/);
  const retour = lire("sql/202611_refonte_operations_lot1_rollback.sql").replace(/--[^\n]*/g, "").toLowerCase();
  assert.ok(!/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/.test(retour), "retour arrière sans suppression");
});

console.log(`\n${n} vérifications « chantier actif » réussies.`);
