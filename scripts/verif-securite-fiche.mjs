#!/usr/bin/env node
// Vérifie la fiche de préparation sécurité d'un chantier (tâche 3 du projet
// docs/projets/fiche-securite-chantier.md) :
//   - la configuration des 12 points (securite/points.mjs) ;
//   - le module pur securiteFiche.mjs : « n/12 » identique à la vue
//     securite_fiches_etat, normalisation des réponses, contrôle de structure ;
//   - le branchement de l'écran (lecture statique des fichiers).
//
// Exemples issus des tests, données fictives : fiches, noms et dates sont
// inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-fiche.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POINTS_FICHE, POINTS_CARTES, CLES_REPONSES, STATUTS_POINT, STATUTS_POINT_COMPLETE,
  LIBELLES_JUSTIFICATIFS, pointParNumero, pointParCle, libelleJustificatif,
} from "../src/Renovation/securite/points.mjs";
import {
  NB_POINTS_FICHE, compterPointsCompletes, etatDesPoints, validerStructureFiche, modeFiche, peutCreerFiche,
  formulaireFiche, contenuAEnregistrer, normaliserReponse, modifierPoint, libelleEnregistrement,
} from "../src/Renovation/securiteFiche.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

const migration = (() => {
  const dir = join(racine, "supabase/migrations");
  const f = readdirSync(dir).find((x) => /_securite_fiches_chantier\.sql$/.test(x));
  assert.ok(f, "migration securite_fiches_chantier introuvable");
  return readFileSync(join(dir, f), "utf8");
})();

// exemple issu des tests, données fictives
const vide = () => ({ id: "f1", chantier_id: "c1", version: 1, statut: "brouillon", donnees_base: {}, intervenants: [], reponses: {}, synthese_risques: [], updated_at: "2026-11-25T10:00:00.000000+00:00" });

test("1. 12 points dans l'ordre du PDF v2, sections et clés", () => {
  assert.equal(POINTS_FICHE.length, 12);
  assert.equal(NB_POINTS_FICHE, 12);
  POINTS_FICHE.forEach((p, i) => {
    assert.equal(p.numero, i + 1);
    assert.equal(p.cle, `p${i + 1}`);
    assert.ok(p.titre && typeof p.titre === "string");
    assert.ok("concerneSi" in p, `point ${p.numero} : emplacement concerneSi`);
    // Tâche 6 : énoncé de la règle de proposition (calcul : securitePreRemplissage.mjs).
    assert.ok(typeof p.concerneSi === "string" && p.concerneSi.length > 0, `point ${p.numero} : règle « concerné si » énoncée`);
  });
  assert.deepEqual(POINTS_FICHE.slice(0, 3).map((p) => p.section), ["intervenants", "donnees_base", "synthese"]);
  assert.deepEqual(POINTS_CARTES.map((p) => p.numero), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(CLES_REPONSES, ["p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]);
  assert.deepEqual(POINTS_FICHE.map((p) => p.titre.split(" ")[0]),
    ["Intervenants", "Données", "Synthèse", "Amiante", "Chute", "Électricité", "Poussières", "Manutention", "Travail", "Équipements", "Sanitaires", "Coordination"]);
  assert.equal(pointParNumero(5).cle, "p5");
  assert.equal(pointParCle("p12").numero, 12);
  assert.equal(pointParCle("zz"), null);
});

test("2. cases : codes uniques et stables, exemple de la spécification présent (point 5)", () => {
  for (const p of POINTS_CARTES) {
    assert.ok(p.cases.length >= 3, `point ${p.numero} : au moins 3 cases`);
    const codes = p.cases.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length, `point ${p.numero} : codes uniques`);
    codes.forEach((c) => assert.match(c, /^[a-z][a-z0-9_]*$/, `code ${c}`));
    p.cases.forEach((c) => assert.ok(c.libelle.trim().length > 3));
  }
  const p5 = pointParCle("p5").cases.map((c) => c.code);
  for (const c of ["zones_listees", "tremies_protegees", "echafaudage_verifie"]) assert.ok(p5.includes(c), c);
});

test("3. justificatifs attendus : uniquement des type_code acceptés par la base, tous libellés", () => {
  const m = /type_code\s+text not null check \(type_code in \(([\s\S]*?)\)\)/.exec(migration);
  assert.ok(m, "check type_code lu dans la migration");
  const enBase = [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  assert.equal(enBase.length, 24);
  assert.deepEqual(Object.keys(LIBELLES_JUSTIFICATIFS).sort(), [...enBase].sort(), "un libellé par type de la base");
  for (const p of POINTS_FICHE) {
    for (const j of p.justificatifs) {
      assert.ok(enBase.includes(j.type_code), `point ${p.numero} : ${j.type_code} inconnu de la base`);
      assert.equal(typeof j.requis, "boolean");
    }
  }
  assert.ok(pointParCle("p4").justificatifs.some((j) => j.type_code === "reperage_amiante" && j.requis));
  assert.match(libelleJustificatif("xyz"), /type inconnu/);
});

test("4. le « n/12 » a la même définition que la vue securite_fiches_etat", () => {
  // La définition lue dans la migration : si elle change, ce test le signale.
  const sql = migration.replace(/\s+/g, " ");
  assert.match(sql, /select count\(\*\) from jsonb_each\(f\.reponses\) r where r\.value->>'statut' in \('concerne','non_concerne'\)\)/);
  assert.match(sql, /\+ \(case when f\.donnees_base <> '\{\}'::jsonb then 1 else 0 end\)/);
  assert.match(sql, /\+ \(case when f\.intervenants <> '\[\]'::jsonb then 1 else 0 end\)/);
  assert.match(sql, /\+ \(case when f\.synthese_risques <> '\[\]'::jsonb then 1 else 0 end\) as points_completes/);
  assert.deepEqual([...STATUTS_POINT_COMPLETE], ["concerne", "non_concerne"]);
  // Mêmes résultats que PostgreSQL sur ces 4 échantillons (requête de lecture
  // sur des valeurs littérales, sans aucune fiche, faite le 25/11/2026 :
  // 0, 5, 4, 3). Exemples issus des tests, données fictives.
  const E = [
    { donnees_base: {}, intervenants: [], reponses: {}, synthese_risques: [] },
    { donnees_base: { lots: ["demolition"] }, intervenants: [{ type: "responsable", nom: "X" }], reponses: { p4: { statut: "concerne" }, p5: { statut: "non_concerne" }, p6: { statut: "a_completer" } }, synthese_risques: ["a"] },
    { donnees_base: { x: null }, intervenants: [{}], reponses: { p4: { statut: "concerne" }, zz: { statut: "concerne" }, p7: "concerne", p8: [1], p9: { statut: 1 } }, synthese_risques: [] },
    { donnees_base: [], intervenants: {}, reponses: { p4: { statut: "CONCERNE" } }, synthese_risques: {} },
  ];
  assert.deepEqual(E.map(compterPointsCompletes), [0, 5, 4, 3]);
  // Incalculable : jamais 0 par défaut.
  assert.equal(compterPointsCompletes(null), null);
  assert.equal(compterPointsCompletes({ donnees_base: {}, intervenants: [], synthese_risques: [] }), null, "colonne absente");
  assert.equal(compterPointsCompletes({ ...vide(), reponses: [] }), null, "reponses non objet : la vue échouerait");
  // Fiche complète : 12/12.
  const pleine = { ...vide(), donnees_base: { lots: ["a"] }, intervenants: [{ type: "responsable", nom: "R" }], synthese_risques: ["x"],
    reponses: Object.fromEntries(CLES_REPONSES.map((k, i) => [k, { statut: i % 2 ? "concerne" : "non_concerne" }])) };
  assert.equal(compterPointsCompletes(pleine), 12);
  assert.ok(etatDesPoints(pleine).every((p) => p.complete));
  assert.deepEqual(etatDesPoints(vide()).map((p) => p.complete), Array(12).fill(false));
});

test("5. normalisation : une fiche vide reste vide en base (0/12), rien d'inconnu n'est perdu", () => {
  const form = formulaireFiche(vide(), () => "id-test");
  const r = contenuAEnregistrer(form);
  assert.ok(r.ok);
  assert.deepEqual(r.contenu, { intervenants: [], donnees_base: {}, reponses: {}, synthese_risques: [] });
  assert.equal(compterPointsCompletes(r.contenu), 0);

  // Champs remplis d'espaces, ligne d'entreprise vide, synthèse vide : toujours 0/12.
  const blanc = { ...form, responsable: { nom: "  ", telephone: "" }, entreprises: [{ id: "e1", nom: " ", activite: "", contact: "", telephone: "" }],
    donnees: { ...form.donnees, acces: "   ", lots: [] }, synthese: ["", "  ", ""] };
  const rb = contenuAEnregistrer(blanc);
  assert.ok(rb.ok);
  assert.equal(compterPointsCompletes(rb.contenu), 0, "des cases vides ne complètent aucun point");

  // Données inconnues conservées telles quelles.
  const ligne = { ...vide(),
    donnees_base: { lots: ["demolition", "inconnu_x"], futur: 1 },
    intervenants: [{ type: "responsable", nom: "Responsable test" }, { type: "entreprise", id: "e9", nom: "ENTREPRISE TEST" }, { type: "visiteur", nom: "V" }],
    reponses: { p5: { statut: "concerne", statut_propose: "concerne", raison_proposition: "Lot test", cases: { zones_listees: true, tremies_protegees: false, ancienne_case: true }, mesures: " PIRL ", maj_par: "A", maj_le: "2026-11-25T10:00:00Z" }, zz: { statut: "concerne" } },
    synthese_risques: ["Chute de hauteur", { texte: "forme future" }],
  };
  const r2 = contenuAEnregistrer(formulaireFiche(ligne));
  assert.ok(r2.ok);
  assert.deepEqual(r2.contenu.donnees_base, { futur: 1, lots: ["demolition", "inconnu_x"] });
  assert.deepEqual(r2.contenu.intervenants, [{ type: "responsable", nom: "Responsable test" }, { type: "entreprise", id: "e9", nom: "ENTREPRISE TEST" }, { type: "visiteur", nom: "V" }]);
  assert.deepEqual(r2.contenu.reponses.p5, { statut: "concerne", statut_propose: "concerne", raison_proposition: "Lot test", cases: { zones_listees: true, ancienne_case: true }, mesures: "PIRL", maj_par: "A", maj_le: "2026-11-25T10:00:00Z" });
  assert.deepEqual(r2.contenu.reponses.zz, { statut: "concerne" }, "clé inconnue conservée");
  assert.deepEqual(r2.contenu.synthese_risques, ["Chute de hauteur", { texte: "forme future" }]);
  // Idempotent : relire ce qu'on a écrit redonne la même chose.
  const r3 = contenuAEnregistrer(formulaireFiche({ ...vide(), ...r2.contenu }));
  assert.deepEqual(r3.contenu, r2.contenu);

  // Point remis à « à compléter » sans rien d'autre : retiré des réponses.
  assert.equal(normaliserReponse({ statut: "a_completer", cases: { a: false }, mesures: " " }), null);
  assert.deepEqual(normaliserReponse({ statut: "non_concerne" }), { statut: "non_concerne" });
});

test("6. point 2 : dates et effectif contrôlés, case « occupé » vide ≠ non", () => {
  const f = formulaireFiche(vide());
  const ok = contenuAEnregistrer({ ...f, donnees: { ...f.donnees, date_debut: "2026-12-07", date_fin: "2027-02-12", date_depose_sanitaires: "2026-12-09", effectif_max: "4", site_occupe: "non" } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.contenu.donnees_base, { date_debut: "2026-12-07", date_fin: "2027-02-12", date_depose_sanitaires: "2026-12-09", effectif_max: 4, site_occupe: false });
  assert.equal(contenuAEnregistrer({ ...f, donnees: { ...f.donnees, site_occupe: "" } }).contenu.donnees_base.site_occupe, undefined, "vide = non renseigné, jamais false");
  const ko = contenuAEnregistrer({ ...f, donnees: { ...f.donnees, date_debut: "2026-02-30", effectif_max: "2,5" } });
  assert.equal(ko.ok, false);
  assert.equal(ko.erreurs.length, 2);
  const inverse = contenuAEnregistrer({ ...f, donnees: { ...f.donnees, date_debut: "2027-01-10", date_fin: "2026-12-01" } });
  assert.ok(inverse.ok && inverse.avertissements.some((a) => /avant la date de début/.test(a)));
});

test("7. modifierPoint : nouvel objet, daté et signé ; statut inconnu refusé", () => {
  const f = formulaireFiche(vide());
  const g = modifierPoint(f, "p6", { statut: "concerne" }, { auteur: "Auteur test", maintenant: "2026-11-25T11:00:00Z" });
  assert.deepEqual(f.reponses, {}, "formulaire d'origine inchangé");
  assert.equal(g.reponses.p6.statut, "concerne");
  assert.equal(g.reponses.p6.maj_par, "Auteur test");
  const h = modifierPoint(g, "p6", { case: { code: "consignation", coche: true } });
  const i = modifierPoint(h, "p6", { case: { code: "consignation", coche: false } });
  assert.deepEqual(h.reponses.p6.cases, { consignation: true });
  assert.deepEqual(i.reponses.p6.cases, {});
  assert.throws(() => modifierPoint(f, "p6", { statut: "oui" }));
  assert.throws(() => modifierPoint(f, "p3", { statut: "concerne" }), "le point 3 n'est pas une carte");
  assert.equal(compterPointsCompletes(contenuAEnregistrer(g).contenu), 1);
});

test("8. structure inattendue : lecture seule (rien n'est écrasé) ; avertissements sinon", () => {
  assert.equal(validerStructureFiche(vide()).bloquantes.length, 0);
  for (const casse of [{ reponses: [] }, { intervenants: {} }, { donnees_base: [] }, { synthese_risques: "x" },
    { reponses: { p4: "concerne" } }, { reponses: { p4: { statut: "oui" } } }, { reponses: { p4: { cases: [] } } }, { donnees_base: { lots: "a" } }]) {
    const l = { ...vide(), ...casse };
    assert.ok(validerStructureFiche(l).bloquantes.length > 0, JSON.stringify(casse));
    assert.equal(modeFiche(l).modifiable, false, JSON.stringify(casse));
  }
  const av = validerStructureFiche({ ...vide(), reponses: { zz: {}, p5: { cases: { ancienne_case: true } } }, synthese_risques: ["a", "b", "c", "d"] });
  assert.equal(av.bloquantes.length, 0);
  assert.equal(av.avertissements.length, 3);
  assert.equal(modeFiche(vide()).modifiable, true);
});

test("9. seule une fiche brouillon est modifiable", () => {
  for (const statut of ["validee", "a_mettre_a_jour", "verrouillee", "autre", null]) {
    const m = modeFiche({ ...vide(), statut });
    assert.equal(m.modifiable, false, String(statut));
    assert.ok(m.raison.length > 0);
  }
  assert.match(modeFiche({ ...vide(), statut: "verrouillee" }).raison, /verrouillée/);
});

test("10. « Créer la fiche » : seulement quand la pastille dit « à créer »", () => {
  const c = (statut) => ({ id: "c1", nom: "LOGEMENT TEST", statut });
  assert.equal(peutCreerFiche({ chantier: c("en_cours"), fiche: null, lecture: "ok" }), true);
  assert.equal(peutCreerFiche({ chantier: c("planifie") }), true);
  assert.equal(peutCreerFiche({ chantier: c("termine") }), false, "chantier terminé");
  assert.equal(peutCreerFiche({ chantier: c("perdu") }), false, "affaire perdue");
  assert.equal(peutCreerFiche({ chantier: c("en_cours"), lecture: "erreur" }), false, "état illisible");
  assert.equal(peutCreerFiche({ chantier: c("en_cours"), lecture: "chargement" }), false);
  assert.equal(peutCreerFiche({ chantier: c("en_cours"), fiche: { statut: "brouillon", version: 1, points_completes: 0 } }), false, "fiche existante");
});

test("11. indicateur : « enregistré » seulement après une écriture réussie", () => {
  assert.equal(libelleEnregistrement("enregistre").texte, "enregistré");
  assert.equal(libelleEnregistrement("enregistrement").texte, "enregistrement…");
  assert.equal(libelleEnregistrement("erreur").texte, "erreur, non enregistré");
  for (const e of ["en_attente", "enregistrement", "erreur", "lecture_seule", undefined]) assert.notEqual(libelleEnregistrement(e).texte, "enregistré", String(e));
});

test("12. modules purs, façades et branchement de l'écran", () => {
  for (const f of ["src/Renovation/securiteFiche.mjs", "src/Renovation/securite/points.mjs"]) {
    const src = sansCommentaires(lire(f));
    assert.ok(!/supabase|new Date\(\)|Date\.now|Math\.random|fetch\(|localStorage|window\./.test(src), `${f} : module pur`);
  }
  assert.match(lire("src/Renovation/securiteFiche.js"), /export \* from "\.\/securiteFiche\.mjs";/);
  assert.match(lire("src/Renovation/securite/points.js"), /export \* from "\.\/points\.mjs";/);

  const ecran = lire("src/Renovation/FicheSecuriteChantier.jsx");
  assert.match(ecran, /compterPointsCompletes\(contenuCompte\)/, "n/12 par le module (même calcul que la vue)");
  assert.match(ecran, /contenuAEnregistrer\(formRef\.current\)/);
  assert.match(ecran, /enregistrerFiche\(baseRef\.current\.id, prep\.contenu, \{ updatedAt: baseRef\.current\.updated_at, auteur \}\)/);
  assert.match(ecran, /modeFiche\(lecture\.ligne\)/);
  assert.match(ecran, /setTimeout\([\s\S]*ANTI_REBOND_MS\)/, "anti-rebond");
  // Tâche 4 : les fichiers passent par la couche données, jamais directement par l'écran.
  assert.ok(!/storage\.from/i.test(sansCommentaires(ecran)), "pas d'accès direct au stockage depuis l'écran");

  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  assert.match(donnees, /\.update\(\{ \.\.\.contenu, maj_par: auteur \|\| null \}\)\s*\.eq\("id", ficheId\)\.eq\("statut", "brouillon"\)/, "écriture seulement en brouillon");
  assert.match(donnees, /q\.eq\("updated_at", updatedAt\)/, "pas d'écrasement d'une modification faite ailleurs");
  assert.ok(!/\.delete\(/.test(donnees), "aucune suppression");

  const panneau = lire("src/Renovation/FicheSecuriteOperation.jsx");
  assert.match(panneau, /peutCreerFiche\(\{ chantier: c, fiche: etat\.parChantier\[c\.id\] \|\| null, lecture: etat\.lecture \}\)/);
  assert.match(panneau, /<FicheSecuriteChantier /);
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
  assert.ok(STATUTS_POINT.length === 3);
});

console.log(`\n${n} vérifications de la fiche sécurité : tout passe.`);
