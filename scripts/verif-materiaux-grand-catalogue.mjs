// Vérification : bibliothèque matériaux « grand catalogue ».
//
// Le cas qui l'a provoquée (28/09/2026) : après l'import SIDER, la table
// materiaux_bibliotheque compte 23 101 articles. L'API Supabase n'en renvoie
// jamais plus de 1 000 par requête, SANS erreur : les écrans Commandes et
// Bibliothèque d'ouvrages (triés par nom) ne voyaient plus que 8 des 289
// articles réellement utilisés, et le catalogue des ouvriers s'arrêtait aux
// premiers noms de l'alphabet.
//
// Ce script vérifie les règles pures (materiauxCatalogueV1.mjs) et qu'AUCUN
// écran ne relit plus la table d'un seul coup.
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tranchesLecture, assemblerTranches, filtreRecherche, ordreBibliotheque,
  filtrerListeChoix, categoriesDistinctes, libelleResultatsPlafonnes,
  COLONNES_RECHERCHE_CATALOGUE, TAILLE_TRANCHE, PLAFOND_LISTE_CHOIX,
  TAILLE_PAGE_BIBLIOTHEQUE, MATERIAUX_CATALOGUE_VERSION,
} from "../src/Renovation/materiauxCatalogueV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const racine = resolve(here, "..");
const lire = f => readFile(resolve(racine, f), "utf8");

// 1. Tranches : couvrent tout, sans trou ni chevauchement, jamais > 1 000.
{
  assert.equal(TAILLE_TRANCHE, 1000, "plafond de l'API Supabase");
  assert.deepEqual(tranchesLecture(0), []);
  assert.deepEqual(tranchesLecture(1000), [[0, 999]]);
  assert.deepEqual(tranchesLecture(1001), [[0, 999], [1000, 1000]]);
  const t = tranchesLecture(23101);
  assert.equal(t.length, 24);
  assert.deepEqual(t.at(-1), [23000, 23100]);
  for (let i = 1; i < t.length; i++) assert.equal(t[i][0], t[i - 1][1] + 1, "tranches contiguës");
  for (const [a, b] of t) assert.ok(b - a + 1 <= TAILLE_TRANCHE);
  assert.deepEqual(tranchesLecture(null), [], "total inconnu : on ne devine pas");
}

// 2. Assemblage : une tranche en erreur ⇒ pas de liste partielle.
{
  const ok = assemblerTranches([{ data: [{ id: 1 }, { id: 2 }] }, { data: [{ id: 2 }, { id: 3 }] }]);
  assert.deepEqual(ok.data.map(x => x.id), [1, 2, 3], "doublon entre tranches écarté");
  const ko = assemblerTranches([{ data: [{ id: 1 }] }, { data: null, error: { message: "timeout" } }]);
  assert.equal(ko.data, null);
  assert.equal(ko.error.message, "timeout");
  assert.equal(assemblerTranches([null]).data, null, "tranche absente = erreur");
}

// 3. Filtre de recherche envoyé à la base.
{
  assert.equal(filtreRecherche(""), null);
  assert.equal(filtreRecherche("   "), null);
  assert.equal(filtreRecherche("robinet"),
    'nom.ilike."*robinet*",reference.ilike."*robinet*",fournisseur.ilike."*robinet*"');
  // Virgule, parenthèse, point : entre guillemets, ils ne cassent pas la requête.
  assert.match(filtreRecherche("tête 18x150, (inox)"), /^nom\.ilike\."\*tête 18x150, \(inox\)\*",/);
  // Guillemet et antislash échappés ; jokers de l'utilisateur neutralisés.
  assert.equal(filtreRecherche('a"b').split(",")[0], 'nom.ilike."*a\\"b*"');
  assert.equal(filtreRecherche("50%"), filtreRecherche("50"));
  assert.equal(filtreRecherche("***"), null);
  assert.deepEqual(COLONNES_RECHERCHE_CATALOGUE, ["nom", "reference", "categorie"],
    "le catalogue des ouvriers n'expose pas le fournisseur");
  assert.doesNotMatch(filtreRecherche("x", COLONNES_RECHERCHE_CATALOGUE), /fournisseur/);
}

// 4. Tri côté base : fidèle à l'ancien tri de l'écran, id pour départager.
{
  const cols = (t, v) => ordreBibliotheque(t, v).map(([c]) => c);
  assert.deepEqual(cols("az"), ["nom", "id"]);
  assert.equal(ordreBibliotheque("za")[0][1].ascending, false);
  // Ancien tri « prix » : prix vide compté 0 ⇒ en tête en croissant, en fin en décroissant.
  assert.equal(ordreBibliotheque("prix-asc")[0][1].nullsFirst, true);
  assert.equal(ordreBibliotheque("prix-desc")[0][1].nullsFirst, false);
  // Ancien tri fournisseur : sans fournisseur en dernier.
  assert.equal(ordreBibliotheque("fournisseur")[0][1].nullsFirst, false);
  assert.deepEqual(cols("az", "groupe"), ["categorie", "nom", "id"], "vue groupée : catégories contiguës");
  assert.deepEqual(cols("inconnu"), ["nom", "id"]);
  for (const t of ["az", "za", "prix-asc", "prix-desc", "fournisseur"]) assert.equal(cols(t).at(-1), "id");
  assert.equal(TAILLE_PAGE_BIBLIOTHEQUE, 100);
}

// 5. Listes de choix plafonnées.
{
  const cat = Array.from({ length: 23101 }, (_, i) => ({ id: i, nom: `ART ${i}`, reference: String(900000 + i), fournisseur: i % 2 ? "SIDER" : "REXEL" }));
  const vide = filtrerListeChoix(cat, "");
  assert.equal(vide.saisieRequise, true, "sans saisie, on ne déroule pas 23 101 lignes");
  assert.equal(vide.visibles.length, 0);
  assert.equal(vide.total, 23101);
  const r = filtrerListeChoix(cat, "sider");
  assert.equal(r.visibles.length, PLAFOND_LISTE_CHOIX);
  assert.equal(r.total, 11550);
  assert.equal(filtrerListeChoix(cat, "900042").visibles[0].id, 42, "recherche par référence");
  const petit = filtrerListeChoix(cat.slice(0, 10), "");
  assert.equal(petit.saisieRequise, false, "petite bibliothèque : tout est listé");
  assert.equal(petit.visibles.length, 10);
  assert.equal(filtrerListeChoix(null, "x").total, 0);
}

// 6. Catégories et libellé « N affichés sur M ».
{
  assert.deepEqual(categoriesDistinctes([{ categorie: "Plomberie" }, { categorie: "" }, { categorie: null }, { categorie: "Outillage" }, { categorie: "Plomberie" }]),
    ["Outillage", "Plomberie"]);
  assert.equal(libelleResultatsPlafonnes(50, 50), null);
  assert.equal(libelleResultatsPlafonnes(12, null), null, "total inconnu : pas de faux compteur");
  assert.match(libelleResultatsPlafonnes(50, 12260), /^50 affichés sur 12.260 — précisez la recherche$/);
}

// 7. Plus aucune lecture « toute la table d'un coup » dans l'application.
{
  const fichiers = [];
  const parcourir = async dir => {
    for (const e of await readdir(resolve(racine, dir), { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await parcourir(p);
      else if (/\.(jsx?|mjs|ts)$/.test(e.name)) fichiers.push(p);
    }
  };
  await parcourir("src");
  await parcourir("supabase/functions");
  // Une lecture de materiaux_bibliotheque sans .range / .eq / .in / .single
  // sur la même chaîne est une lecture complète plafonnée à 1 000.
  const lecturesCompletes = [];
  for (const f of fichiers) {
    const src = await lire(f);
    const re = /from\(\s*["']materiaux_bibliotheque["']\s*\)([\s\S]{0,400}?)(;|\n\s*\n|\)\s*,\s*\n)/g;
    let m;
    while ((m = re.exec(src))) {
      const chaine = m[1];
      if (!/\.select\(/.test(chaine)) continue;               // insert / update / delete
      if (/\.(range|eq|in|single|maybeSingle)\(|head:\s*true/.test(chaine)) continue;
      lecturesCompletes.push(`${f.replace(/\\/g, "/")} : ${chaine.trim().slice(0, 80)}`);
    }
  }
  // Exceptions connues, une par une — toute nouvelle lecture complète échoue.
  const EXCEPTIONS = new Set([
    // Requête construite sur plusieurs lignes, bornée plus bas par
    // q.range(debut, debut + TAILLE_PAGE_BIBLIOTHEQUE - 1) (vérifié ci-dessous).
    'src/Renovation/PageBibliothequeMateriaux.jsx : .select("*", { count: "exact" })',
    // Mode « remplacement » de l'import Sheets : volontairement NON modifié le
    // 28/09/2026 (il touche à une suppression en masse, décision laissée à
    // Loris). Il ne relit que 1 000 articles : il supprime MOINS que prévu,
    // jamais plus.
    'src/Renovation/PageBibliothequeMateriaux.jsx : .select("id, nom")',
  ]);
  assert.deepEqual(lecturesCompletes.filter(l => !EXCEPTIONS.has(l)), [], "lecture complète de la bibliothèque sans tranches");

  const ecrans = {
    "src/Renovation/BilanSemaine.jsx": /chargerTousLesMateriaux\("id, prix_unitaire"\)/,
    "src/Renovation/Commandes.jsx": /chargerTousLesMateriaux\(/,
    "src/Renovation/Bibliotheque.jsx": /chargerTousLesMateriaux\(/,
    "src/Renovation/PhasageV2.jsx": /chargerTousLesMateriaux\(/,
    "src/Renovation/PageInfoClient.jsx": /chargerTousLesMateriaux\(/,
    "src/Renovation/PagePlanningCommandes.jsx": /chargerTousLesMateriaux\(/,
    "src/Renovation/operationExportData.js": /chargerTousLesMateriaux\(/,
    "src/Renovation/OuvrierCommande.jsx": /useCatalogueDemande\(/,
    "src/Renovation/BesoinCommandeDrawer.jsx": /useCatalogueDemande\(/,
    "supabase/functions/progbat-library-sync/index.ts": /lireTousMateriaux\(admin/,
    "supabase/functions/progbat-library-inventory/index.ts": /lireTousMateriaux\(admin/,
  };
  for (const [f, motif] of Object.entries(ecrans)) assert.match(await lire(f), motif, f);

  // Les écrans terrain ne lisent JAMAIS la table (prix, fournisseurs).
  for (const f of ["src/Renovation/OuvrierCommande.jsx", "src/Renovation/BesoinCommandeDrawer.jsx", "src/Renovation/useCatalogueDemande.js"]) {
    assert.doesNotMatch(await lire(f), /from\(\s*["']materiaux_bibliotheque/, `${f} : jamais la table en direct`);
  }
  // Le Bilan semaine dit « indisponible » plutôt que de calculer sur une bibliothèque vide.
  assert.match(await lire("src/Renovation/BilanSemaine.jsx"), /let materiauxById = null;\s*\n\s*if \(!matQ\.error\)/);
  // Plus de <select> listant toute la bibliothèque dans le Phasage.
  assert.doesNotMatch(await lire("src/Renovation/PhasageV2.jsx"), /materiauxBiblio\.map\(m => <option/);
  // Page Bibliothèque matériaux : page de 100 lue par la base.
  const page = await lire("src/Renovation/PageBibliothequeMateriaux.jsx");
  assert.match(page, /q\.range\(debut, debut \+ TAILLE_PAGE_BIBLIOTHEQUE - 1\)/);
  assert.match(page, /select\("\*", \{ count: "exact" \}\)/);
}

// 8. Pureté du module + façade.
{
  const src = await lire("src/Renovation/materiauxCatalogueV1.mjs");
  assert.doesNotMatch(src, /supabase|Date\.now|new Date|fetch\(|localStorage|sessionStorage/);
  assert.match(await lire("src/Renovation/materiauxCatalogueV1.js"), /export \* from "\.\/materiauxCatalogueV1\.mjs"/);
  assert.equal(MATERIAUX_CATALOGUE_VERSION, "v1");
}

// 9. Migration de la règle d'accès (appliquée le 28/09/2026 sous
//    20260928191112) : même règle, évaluée une fois.
{
  const sql = await lire("supabase/migrations/20260928191112_materiaux_bibliotheque_rls_initplan.sql");
  const code = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /drop policy if exists materiaux_bibliotheque_bureau on public\.materiaux_bibliotheque;/);
  assert.match(code, /create policy materiaux_bibliotheque_bureau on public\.materiaux_bibliotheque\s+for all to authenticated/,
    "même portée que la règle d'origine : toutes les opérations, utilisateurs connectés");
  assert.equal((code.match(/\(select public\.mon_role\(\)\) is not null/g) || []).length, 2, "using + with check");
  assert.equal((code.match(/not \(select public\.est_ouvrier\(\)\)/g) || []).length, 2);
  assert.equal((code.match(/^\s*(drop|create|alter|grant|revoke)\b/gim) || []).length, 2, "aucun autre changement");
}

// 10. Photo introuvable (≈ 3 articles SIDER sur 4 : réponse 404) ⇒ repli
//     visible, jamais une case vide ni une image cassée.
{
  const composant = await lire("src/Renovation/ImageOuRepli.jsx");
  assert.match(composant, /onError=\{\(\) => setIntrouvable\(true\)\}/);
  assert.match(composant, /if \(!src \|\| introuvable\) return repli;/);
  for (const f of ["src/Renovation/PageBibliothequeMateriaux.jsx", "src/Renovation/OuvrierCommande.jsx", "src/Renovation/BesoinCommandeDrawer.jsx"]) {
    const src = await lire(f);
    assert.match(src, /<ImageOuRepli/, `${f} : photo avec repli`);
    assert.doesNotMatch(src, /style\.display = "none"/, `${f} : plus d'image masquée en silence`);
  }
}

console.log("verif-materiaux-grand-catalogue : OK");
