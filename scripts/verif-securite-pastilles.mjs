#!/usr/bin/env node
// Vérifie le module pur des pastilles et du bloc « Bâtiment » de la fiche
// sécurité (tâche 2 du projet docs/projets/fiche-securite-chantier.md), et son
// branchement sur la page Opération (lecture statique des fichiers).
//
// Exemples issus des tests, données fictives : chantiers, fiches et dates sont
// inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-pastilles.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pastilleFicheSecurite, COULEURS_PASTILLE, NB_POINTS_FICHE,
  REPERAGE_AMIANTE_STATUTS, NON_RENSEIGNE, texteOuiNon, texteEtage, texteAvantDate,
  libelleReperageAmiante, formulaireBatiment, preparerEnregistrementBatiment,
} from "../src/Renovation/securitePastilles.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// exemple issu des tests, données fictives
const enCours = { id: "c1", nom: "LOGEMENT TEST", statut: "en_cours" };
const termine = { id: "c2", nom: "LOGEMENT TEST 2", statut: "termine" };
const fiche = (o) => ({ fiche_id: "f1", chantier_id: "c1", version: 1, statut: "brouillon", points_completes: 7, ...o });

test("1. pas de fiche, lecture réussie : gris « à créer »", () => {
  const p = pastilleFicheSecurite({ chantier: enCours, fiche: null, lecture: "ok" });
  assert.equal(p.code, "a_creer");
  assert.equal(p.libelle, "à créer");
  assert.equal(p.couleur, COULEURS_PASTILLE.gris);
  assert.equal(pastilleFicheSecurite({ chantier: { id: "c", statut: "a_l_etude" } }).code, "a_creer", "à l'étude : à créer");
  assert.equal(pastilleFicheSecurite({ chantier: { id: "c", statut: null } }).code, "a_creer", "sans statut : à créer");
});

test("2. lecture en erreur ou en cours : jamais « à créer » (impossibilité visible)", () => {
  for (const lecture of ["erreur", "chargement", "panne"]) {
    const p = pastilleFicheSecurite({ chantier: enCours, fiche: null, lecture });
    assert.notEqual(p.code, "a_creer", lecture);
    assert.notEqual(p.libelle, "à créer", lecture);
    assert.equal(p.ton, "pointille", `${lecture} : affichée en pointillés`);
  }
  assert.equal(pastilleFicheSecurite({ chantier: enCours, lecture: "erreur" }).libelle, "état illisible");
  // même avec une fiche transmise par erreur, une lecture en échec reste illisible
  assert.equal(pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ statut: "validee" }), lecture: "erreur" }).code, "illisible");
});

test("3. brouillon : orange « brouillon — n/12 »", () => {
  const p = pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ points_completes: 7 }) });
  assert.equal(p.libelle, `brouillon — 7/${NB_POINTS_FICHE}`);
  assert.equal(p.couleur, COULEURS_PASTILLE.orange);
  assert.equal(pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ points_completes: 0 }) }).libelle, "brouillon — 0/12", "0 reste 0");
  assert.equal(pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ points_completes: null }) }).libelle, "brouillon — ?/12", "compte inconnu : ?, jamais 0");
  assert.equal(pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ points_completes: "5" }) }).libelle, "brouillon — 5/12", "compte renvoyé en texte (bigint)");
});

test("4. validée : vert « validée vN » ; à mettre à jour : orange", () => {
  const p = pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ statut: "validee", version: 2, points_completes: 12 }) });
  assert.equal(p.libelle, "validée v2");
  assert.equal(p.couleur, COULEURS_PASTILLE.vert);
  const m = pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ statut: "a_mettre_a_jour", version: 2, points_completes: 11 }) });
  assert.equal(m.code, "a_mettre_a_jour");
  assert.equal(m.couleur, COULEURS_PASTILLE.orange);
  assert.match(m.libelle, /^à mettre à jour — 11\/12$/);
});

test("5. chantier terminé : « verrouillée » pour une fiche verrouillée, « pas de fiche » sinon (pas « à créer »)", () => {
  const v = pastilleFicheSecurite({ chantier: termine, fiche: fiche({ statut: "verrouillee", version: 3 }) });
  assert.equal(v.code, "verrouillee");
  assert.equal(v.libelle, "verrouillée v3");
  assert.equal(v.couleur, COULEURS_PASTILLE.verrou);
  const s = pastilleFicheSecurite({ chantier: termine, fiche: null });
  assert.equal(s.code, "sans_fiche_termine");
  assert.notEqual(s.libelle, "à créer");
  assert.equal(pastilleFicheSecurite({ chantier: { id: "p", statut: "perdu" } }).code, "sans_fiche_perdu");
  // verrouillée l'emporte même si des justificatifs ont expiré depuis
  assert.equal(pastilleFicheSecurite({ chantier: termine, fiche: fiche({ statut: "verrouillee" }), justificatifs: { expires: 2, manquants: 1 } }).code, "verrouillee");
});

test("6. aucun rouge inventé : sans `justificatifs`, jamais de pastille rouge", () => {
  for (const statut of ["brouillon", "validee", "a_mettre_a_jour", "verrouillee"]) {
    for (const chantier of [enCours, termine]) {
      const p = pastilleFicheSecurite({ chantier, fiche: fiche({ statut }) });
      assert.ok(!["expire", "justificatifs_manquants"].includes(p.code), `${statut} / ${chantier.statut}`);
      assert.notEqual(p.couleur, COULEURS_PASTILLE.rouge, `${statut} / ${chantier.statut}`);
    }
  }
});

test("7. prêt pour les tâches 3-4 : rouge « justificatifs manquants » / « expiré » quand fournis", () => {
  const m = pastilleFicheSecurite({ chantier: enCours, fiche: fiche(), justificatifs: { manquants: 2, expires: 0 } });
  assert.equal(m.code, "justificatifs_manquants");
  assert.equal(m.libelle, "justificatifs manquants");
  assert.equal(m.couleur, COULEURS_PASTILLE.rouge);
  const e = pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ statut: "validee" }), justificatifs: { manquants: 0, expires: 1 } });
  assert.equal(e.code, "expire");
  assert.equal(e.libelle, "expiré");
  assert.equal(pastilleFicheSecurite({ chantier: enCours, fiche: fiche(), justificatifs: { manquants: 0, expires: 0 } }).code, "brouillon");
});

test("8. statut de fiche inattendu : « état inconnu », pas un état inventé", () => {
  const p = pastilleFicheSecurite({ chantier: enCours, fiche: fiche({ statut: "bizarre" }) });
  assert.equal(p.code, "statut_inconnu");
  assert.equal(p.ton, "pointille");
});

test("9. bloc Bâtiment : une valeur inconnue s'affiche « non renseigné », jamais « non »", () => {
  assert.equal(NON_RENSEIGNE, "non renseigné");
  assert.equal(texteOuiNon(null), NON_RENSEIGNE);
  assert.equal(texteOuiNon(undefined), NON_RENSEIGNE);
  assert.equal(texteOuiNon(false), "non");
  assert.equal(texteOuiNon(true), "oui");
  assert.equal(texteEtage(null), NON_RENSEIGNE);
  assert.equal(texteEtage(0), "rez-de-chaussée");
  assert.equal(texteEtage(1), "1er étage");
  assert.equal(texteEtage(3), "3e étage");
  assert.equal(texteEtage(-1), "sous-sol 1");
  // avant 1997 / 1949 : valeur de la base ; sans date de permis, non renseigné
  assert.equal(texteAvantDate(null, null), NON_RENSEIGNE);
  assert.equal(texteAvantDate(false, null), NON_RENSEIGNE, "pas de date : jamais « non »");
  assert.equal(texteAvantDate(true, "1975-03-01"), "oui");
  assert.equal(texteAvantDate(false, "2001-03-01"), "non");
  assert.equal(libelleReperageAmiante(null), NON_RENSEIGNE);
  assert.match(libelleReperageAmiante("a_completer"), /^Non renseigné/);
  assert.match(libelleReperageAmiante("xyz"), /valeur inconnue/);
});

test("10. statuts du repérage amiante = valeurs du check en base (migration)", () => {
  const dossier = join(racine, "supabase/migrations");
  const f = readdirSync(dossier).filter((x) => /_securite_fiches_chantier\.sql$/.test(x));
  assert.equal(f.length, 1);
  const sql = readFileSync(join(dossier, f[0]), "utf8");
  const m = /reperage_amiante_statut[^;]*?check \(reperage_amiante_statut in \(([^)]*)\)\)/s.exec(sql);
  assert.ok(m, "check trouvé dans la migration");
  const enBase = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual(REPERAGE_AMIANTE_STATUTS.map((s) => s.id), enBase);
  assert.match(sql, /reperage_amiante_statut text not null default 'a_completer'/, "défaut a_completer = premier choix");
});

test("11. formulaire : pré-rempli depuis la base, vide = non renseigné", () => {
  const vide = formulaireBatiment(null);
  assert.deepEqual(vide, { date_permis_construire: "", copropriete: "", etage: "", ascenseur_utilisable: "", reperage_amiante_statut: "a_completer", notes: "" });
  // exemple issu des tests, données fictives
  const f = formulaireBatiment({ date_permis_construire: "1965-05-12", copropriete: true, etage: 0, ascenseur_utilisable: false, reperage_amiante_statut: "demande", notes: "Clé chez le syndic" });
  assert.deepEqual(f, { date_permis_construire: "1965-05-12", copropriete: "oui", etage: "0", ascenseur_utilisable: "non", reperage_amiante_statut: "demande", notes: "Clé chez le syndic" });
});

test("12. enregistrement : contrôles, vide → null (jamais false), aller-retour fidèle", () => {
  const r = preparerEnregistrementBatiment("op1", formulaireBatiment(null));
  assert.ok(r.ok);
  assert.deepEqual(r.ligne, { operation_id: "op1", date_permis_construire: null, copropriete: null, etage: null, ascenseur_utilisable: null, reperage_amiante_statut: "a_completer", notes: null });
  const ligne = { date_permis_construire: "1965-05-12", copropriete: true, etage: 3, ascenseur_utilisable: false, reperage_amiante_statut: "recu_sans_amiante", notes: "x" };
  const r2 = preparerEnregistrementBatiment("op1", formulaireBatiment(ligne));
  assert.ok(r2.ok);
  assert.deepEqual(r2.ligne, { operation_id: "op1", ...ligne });
  assert.equal(preparerEnregistrementBatiment("op1", { ...formulaireBatiment(null), etage: "0" }).ligne.etage, 0, "rez-de-chaussée = 0, pas vide");
  for (const [champ, val] of [["etage", "2.5"], ["etage", "61"], ["etage", "-6"], ["date_permis_construire", "2026-02-30"], ["date_permis_construire", "12/05/1965"], ["reperage_amiante_statut", "inconnu"], ["copropriete", "peut-être"]]) {
    const e = preparerEnregistrementBatiment("op1", { ...formulaireBatiment(null), [champ]: val });
    assert.equal(e.ok, false, `${champ}=${val} refusé`);
  }
  assert.equal(preparerEnregistrementBatiment("", formulaireBatiment(null)).ok, false, "opération obligatoire");
});

test("13. module pur : aucun accès base, aucune horloge ; façade .js", () => {
  const src = lire("src/Renovation/securitePastilles.mjs").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/supabase|new Date\(\)|Date\.now|fetch\(|localStorage/.test(src), "pas d'accès externe ni d'horloge");
  assert.match(lire("src/Renovation/securitePastilles.js"), /export \* from "\.\/securitePastilles\.mjs";/);
});

test("14. page Opération : bouton « Fiche sécurité », panneau branché sur le module", () => {
  const page = lire("src/Renovation/PageOperations.jsx");
  assert.match(page, /import FicheSecuriteOperation from "\.\/FicheSecuriteOperation\.jsx";/);
  assert.match(page, /<Icon as=\{ShieldCheck\} size=\{15\}\/> Fiche sécurité/);
  assert.match(page, /<FicheSecuriteOperation [^>]*op=\{op\} chantiersOp=\{chantiersOp\}/);
  const panneau = lire("src/Renovation/FicheSecuriteOperation.jsx");
  assert.match(panneau, /pastilleFicheSecurite\(\{ chantier: c, fiche: etat\.parChantier\[c\.id\] \|\| null, lecture: etat\.lecture \}\)/);
  assert.match(panneau, /chantiersOp\.filter\(\(c\) => !estChantierArchive\(c\)\)/, "chantiers non archivés");
  assert.match(panneau, /preparerEnregistrementBatiment\(op\.id, form\)/);
  assert.match(panneau, /lecture\.erreur \?/, "bâtiment illisible : pas de formulaire");
  const donnees = lire("src/Renovation/securiteDonnees.js");
  assert.match(donnees, /from\("securite_fiches_etat"\)/);
  assert.match(donnees, /upsert\([^)]*\{ onConflict: "operation_id" \}\)/);
  assert.ok(!/\.delete\(/.test(donnees), "aucune suppression");
  // Pas de nouvelle page : rien d'ajouté dans src/access.js
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
});

console.log(`\n${n} vérifications « Fiche sécurité : pastilles et bâtiment » réussies.`);
