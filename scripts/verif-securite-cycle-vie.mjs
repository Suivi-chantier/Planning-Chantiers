#!/usr/bin/env node
// Vérifie la fiche sécurité dans le cycle de vie du chantier (tâche 7 du
// projet docs/projets/fiche-securite-chantier.md) :
//   - étape « Fiche sécurité validée » (fiche_securite) et ses états ;
//   - décision de changement de statut : blocage du passage « En cours » sans
//     fiche validée, forçage réservé aux administrateurs, verrouillage au
//     passage « Terminé », pas de blocage rétroactif ;
//   - écritures préparées (forçage, verrouillage) et leur ordre ;
//   - alertes préparées pour la table notifications ;
//   - branchement de la fiche chantier, du panneau de l'opération et de la
//     couche données (lecture statique des fichiers).
//
// Exemples issus des tests, données fictives : chantiers, fiches, noms et
// dates sont inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-cycle-vie.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ETAPE_FICHE_SECURITE, EVENEMENT_FICHE_SECURITE, MOTIF_FORCAGE_MIN,
  etatFicheSecurite, etatEtapePourEcriture, etapeADesynchroniser, evaluerEtapeFicheSecurite,
  decisionChangementStatut, validerMotifForcage, preparerForcage, preparerVerrouillage, verrouillageEnAttente,
  alerteChantierEnCours, alertesSecurite, ajouterJours,
} from "../src/Renovation/securiteCycleVie.mjs";
import { CYCLE_VIE_PHASES, getEtape, evaluerEtape, etatsCycleVie } from "../src/Renovation/cycleVie.mjs";
import { EVENEMENT_JOURNAL, motifDepuisJournal } from "../src/Renovation/securiteVersion.mjs";
import { STATUTS_CHOIX_MANUEL } from "../src/Renovation/statutsChantier.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// exemple issu des tests, données fictives
const ch = (statut, o = {}) => ({ id: "chantier-fictif", nom: "LOGEMENT FICTIF", statut, ...o });
const fiche = (o = {}) => ({ id: "f-fictive", chantier_id: "chantier-fictif", version: 1, statut: "brouillon", validee_le: null, validee_par: null, forcage_le: null, forcage_motif: null, forcage_par: null, ...o });
const LE = "2026-11-25T09:00:00.000Z";

test("1. étape « Fiche sécurité validée » dans la phase Préparation, automatique, avant la finalisation", () => {
  const prepa = CYCLE_VIE_PHASES.find((p) => p.id === "cv_preparation").etapes.map((e) => e.id);
  assert.ok(prepa.includes(ETAPE_FICHE_SECURITE));
  assert.equal(prepa.indexOf(ETAPE_FICHE_SECURITE), prepa.indexOf("preparation_finalisee") - 1);
  const e = getEtape(ETAPE_FICHE_SECURITE);
  assert.equal(e.nature, "auto", "jamais cochée à la main");
  assert.equal(e.signal, "fiche_securite");
  assert.equal(EVENEMENT_FICHE_SECURITE, EVENEMENT_JOURNAL, "même événement que la validation / mise à jour");
});

test("2. états de la fiche : à créer / brouillon / validée / à mettre à jour / verrouillée ; illisible jamais « à créer »", () => {
  assert.equal(etatFicheSecurite({ fiche: null }).code, "a_creer");
  assert.equal(etatFicheSecurite({ fiche: fiche() }).code, "brouillon");
  const v = etatFicheSecurite({ fiche: fiche({ statut: "validee", version: 2, validee_le: LE, validee_par: "Conducteur fictif" }) });
  assert.equal(v.code, "validee"); assert.equal(v.fait, true); assert.match(v.raison, /v2 validée le 25\/11\/2026 par Conducteur fictif/);
  assert.equal(etatFicheSecurite({ fiche: fiche({ statut: "a_mettre_a_jour" }) }).fait, false);
  assert.equal(etatFicheSecurite({ fiche: fiche({ statut: "verrouillee", validee_le: LE }) }).fait, true, "verrouillée après validation");
  const vb = etatFicheSecurite({ fiche: fiche({ statut: "verrouillee" }) });
  assert.equal(vb.fait, false); assert.match(vb.raison, /sans avoir été validée/);
  for (const lecture of ["erreur", "chargement"]) {
    const e = etatFicheSecurite({ fiche: null, lecture });
    assert.notEqual(e.code, "a_creer", lecture); assert.equal(e.fait, false);
  }
  assert.equal(etatFicheSecurite({ fiche: fiche({ statut: "bizarre" }) }).code, "inconnu");
  const f = etatFicheSecurite({ fiche: fiche({ forcage_le: LE, forcage_motif: "Urgence fictive", forcage_par: "Admin fictif" }) });
  assert.equal(f.forcee, true); assert.match(f.raison, /Démarrage forcé par Admin fictif le 25\/11\/2026/);
  assert.equal(etatFicheSecurite({ fiche: { statut: "brouillon", version: 1, demarrage_force: true } }).forcee, true, "vue securite_fiches_etat");
});

test("3. évaluation de l'étape : fiche lue d'abord, sinon dernier état enregistré, sinon « non chargé »", () => {
  const e = getEtape(ETAPE_FICHE_SECURITE);
  assert.equal(evaluerEtape(e, { ficheSecurite: { fiche: fiche({ statut: "validee", validee_le: LE }), lecture: "ok" } }).fait, true);
  const enreg = { fait: true, date: LE, auteur: "x", fiche: { statut: "validee", version: 3, forcee: false } };
  const { etats } = etatsCycleVie({ lignes: [{ chantier_id: "c", etape_id: ETAPE_FICHE_SECURITE, etat: enreg }] });
  const r = evaluerEtape(e, { etatsEtapes: etats });
  assert.equal(r.fait, true); assert.match(r.raison, /Dernier état enregistré : fiche validée v3/);
  // Lecture en échec : on montre le dernier état connu, en disant que la fiche n'a pas été relue.
  const r2 = evaluerEtape(e, { etatsEtapes: etats, ficheSecurite: { fiche: null, lecture: "erreur" } });
  assert.equal(r2.fait, true); assert.match(r2.raison, /n'a pas pu être relue/);
  // La fiche lue l'emporte sur l'état enregistré.
  assert.equal(evaluerEtape(e, { etatsEtapes: etats, ficheSecurite: { fiche: fiche(), lecture: "ok" } }).fait, false);
  const r3 = evaluerEtape(e, {});
  assert.equal(r3.fait, false); assert.match(r3.raison, /non chargé/);
  assert.equal(evaluerEtapeFicheSecurite({ etatEnregistre: { fait: true } }).fait, true, "ancien état sans détail");
});

test("4. état enregistré dans chantier_cycle_vie : seulement les états connus, rangé sous « fiche » (pas « donnees »)", () => {
  const a = etatEtapePourEcriture({ fiche: fiche({ statut: "validee", validee_le: LE, version: 2 }), auteur: "Conducteur fictif", le: LE });
  assert.deepEqual(a, { fait: true, date: LE, auteur: "Conducteur fictif", fiche: { statut: "validee", version: 2, forcee: false } });
  assert.ok(!("donnees" in a), "l'export d'opération ne l'affiche pas comme champ saisi");
  assert.deepEqual(etatEtapePourEcriture({ fiche: null }).fiche, { statut: "a_creer", version: null, forcee: false });
  assert.equal(etatEtapePourEcriture({ fiche: null, lecture: "erreur" }), null, "illisible : rien à écrire");
  assert.equal(etatEtapePourEcriture({ fiche: fiche({ statut: "bizarre" }) }), null);
  assert.equal(etapeADesynchroniser(a, a), false);
  assert.equal(etapeADesynchroniser({ ...a, fiche: { ...a.fiche, statut: "brouillon" } }, a), true);
  assert.equal(etapeADesynchroniser(null, a), true);
  assert.equal(etapeADesynchroniser(a, null), false);
});

test("5. passage « En cours » : libre avec une fiche validée, bloqué sinon ; forçage pour l'admin seulement", () => {
  const ok = decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: "en_cours", fiche: fiche({ statut: "validee", validee_le: LE }) });
  assert.equal(ok.action, "libre");
  for (const [f, attendu] of [[null, /pas encore de fiche/], [fiche(), /brouillon/], [fiche({ statut: "a_mettre_a_jour" }), /à mettre à jour/], [fiche({ statut: "verrouillee", validee_le: LE }), /verrouillée/]]) {
    const d = decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: "en_cours", fiche: f, estAdmin: false });
    assert.equal(d.action, "bloque"); assert.match(d.raison, attendu); assert.equal(d.forcagePossible, false, "non-admin : pas de forçage");
    assert.equal(decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: "en_cours", fiche: f, estAdmin: true }).forcagePossible, true);
  }
  assert.equal(decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: "en_cours", fiche: null, estAdmin: true }).creerFiche, true);
  assert.equal(decisionChangementStatut({ chantier: ch("termine"), nouveauStatut: "en_cours", fiche: fiche({ statut: "verrouillee" }), estAdmin: true }).forcageSurFiche, false);
  // Depuis n'importe quel statut (à l'étude, en pause, sans statut) : même règle.
  for (const s of ["a_l_etude", "en_pause", null, "termine"]) {
    assert.equal(decisionChangementStatut({ chantier: ch(s), nouveauStatut: "en_cours", fiche: null }).action, "bloque", String(s));
  }
  // Fiche illisible : bloqué, sans forçage (on ne force pas sur ce qu'on n'a pas lu).
  for (const lecture of ["erreur", "chargement"]) {
    const d = decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: "en_cours", fiche: null, lecture, estAdmin: true });
    assert.equal(d.action, "bloque"); assert.equal(d.forcagePossible, false);
  }
});

test("6. pas de blocage rétroactif : un chantier déjà en cours le reste, et ses autres changements ne sont pas bloqués", () => {
  assert.equal(decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "en_cours", fiche: null }).action, "libre");
  assert.equal(decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "en_pause", fiche: null }).action, "libre");
  assert.equal(decisionChangementStatut({ chantier: ch("en_cours"), ancienStatut: "en_cours", nouveauStatut: "planifie", fiche: null }).action, "libre");
  assert.match(alerteChantierEnCours({ chantier: ch("en_cours"), fiche: null }), /déjà en cours sans fiche sécurité validée/);
  assert.match(alerteChantierEnCours({ chantier: ch("en_cours"), fiche: fiche({ forcage_le: LE }) }), /démarrage forcé/);
  assert.equal(alerteChantierEnCours({ chantier: ch("en_cours"), fiche: fiche({ statut: "validee", validee_le: LE }) }), null);
  assert.equal(alerteChantierEnCours({ chantier: ch("planifie"), fiche: null }), null);
  assert.equal(alerteChantierEnCours({ chantier: ch("en_cours"), fiche: null, lecture: "erreur" }), null, "illisible : la pastille le dit déjà");
  // Tous les statuts du menu sont traités par la règle (aucun ne la contourne).
  for (const s of STATUTS_CHOIX_MANUEL) assert.ok(["libre", "bloque", "verrouiller"].includes(decisionChangementStatut({ chantier: ch("planifie"), nouveauStatut: s, fiche: fiche() }).action), s);
});

test("7. passage « Terminé » : verrouillage d'une fiche existante ; rien sans fiche ; illisible signalé", () => {
  const d = decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "termine", fiche: fiche({ statut: "validee", validee_le: LE }) });
  assert.equal(d.action, "verrouiller");
  assert.equal(decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "termine", fiche: null }).action, "libre", "pas de fiche créée pour un chantier terminé");
  assert.equal(decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "termine", fiche: fiche({ statut: "verrouillee" }) }).action, "libre");
  const i = decisionChangementStatut({ chantier: ch("en_cours"), nouveauStatut: "termine", fiche: null, lecture: "erreur" });
  assert.equal(i.action, "libre"); assert.equal(i.verrouillageInconnu, true);
  const p = preparerVerrouillage({ chantier: ch("termine"), fiche: fiche({ statut: "validee", validee_le: LE, version: 2 }), auteur: "Conducteur fictif" });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fichePatch, { statut: "verrouillee", maj_par: "Conducteur fictif" });
  assert.deepEqual(p.conditionFiche, { id: "f-fictive", statut: "validee", version: 2 });
  assert.equal(p.journal.evenement, "fiche_securite"); assert.equal(p.journal.nouveau_statut, "verrouillee");
  assert.match(p.journal.detail, /v2 verrouillée : chantier terminé$/);
  assert.match(preparerVerrouillage({ chantier: ch("termine"), fiche: fiche() }).journal.detail, /jamais validée/);
  assert.equal(preparerVerrouillage({ chantier: ch("termine"), fiche: fiche({ statut: "verrouillee" }) }).ok, false);
  assert.equal(verrouillageEnAttente({ chantier: ch("termine"), fiche: fiche() }), true);
  assert.equal(verrouillageEnAttente({ chantier: ch("termine"), fiche: fiche({ statut: "verrouillee" }) }), false);
  assert.equal(verrouillageEnAttente({ chantier: ch("termine"), fiche: null }), false);
  assert.equal(verrouillageEnAttente({ chantier: ch("en_cours"), fiche: fiche() }), false);
});

test("8. forçage : admin, motif obligatoire, fiche créée en brouillon si absente, journal du chantier", () => {
  const base = { chantier: ch("planifie"), ancienStatut: "planifie", lecture: "ok", motif: "Démarrage urgent fictif", auteur: "Admin fictif", le: LE };
  assert.equal(validerMotifForcage("").ok, false);
  assert.equal(validerMotifForcage("a".repeat(MOTIF_FORCAGE_MIN - 1)).ok, false);
  assert.equal(validerMotifForcage("  Urgence  ").motif, "Urgence");
  assert.match(preparerForcage({ ...base, fiche: null, estAdmin: false }).erreurs.join(" "), /administrateur/);
  assert.match(preparerForcage({ ...base, fiche: null, estAdmin: true, motif: "abc" }).erreurs.join(" "), /trop court/);
  assert.match(preparerForcage({ ...base, fiche: null, estAdmin: true, lecture: "erreur" }).erreurs.join(" "), /illisible/);
  assert.match(preparerForcage({ ...base, fiche: fiche({ statut: "validee", validee_le: LE }), estAdmin: true }).erreurs.join(" "), /Aucun forçage nécessaire/);

  const sans = preparerForcage({ ...base, fiche: null, estAdmin: true });
  assert.equal(sans.ok, true);
  assert.deepEqual(sans.ficheInsert, { chantier_id: "chantier-fictif", cree_par: "Admin fictif", maj_par: "Admin fictif", forcage_motif: "Démarrage urgent fictif", forcage_par: "Admin fictif", forcage_le: LE });
  assert.equal(sans.ficheInsert.statut, undefined, "brouillon = valeur par défaut de la base");
  assert.deepEqual({ ...sans.journal, detail: undefined }, { chantier_id: "chantier-fictif", evenement: "fiche_securite", ancien_statut: "planifie", nouveau_statut: "en_cours", motif: "Démarrage urgent fictif", detail: undefined, auteur: "Admin fictif" });
  assert.match(sans.journal.detail, /^Démarrage forcé sans fiche sécurité validée — aucune fiche \(créée en brouillon\)$/);

  const avec = preparerForcage({ ...base, fiche: fiche({ version: 2 }), estAdmin: true });
  assert.deepEqual(avec.fichePatch, { forcage_motif: "Démarrage urgent fictif", forcage_par: "Admin fictif", forcage_le: LE, maj_par: "Admin fictif" });
  assert.deepEqual(avec.conditionFiche, { id: "f-fictive", statut: "brouillon", version: 2 });
  const verrou = preparerForcage({ ...base, chantier: ch("termine"), ancienStatut: "termine", fiche: fiche({ statut: "verrouillee" }), estAdmin: true });
  assert.equal(verrou.ok, true); assert.equal(verrou.fichePatch, undefined); assert.equal(verrou.ficheInsert, undefined);
  assert.match(verrou.journal.detail, /motif tracé ici seulement/);
  // Une entrée de forçage n'est jamais prise pour le motif d'une nouvelle version.
  assert.deepEqual(motifDepuisJournal([{ ...avec.journal, le: LE }], 2), { motif: null, trouve: false });
});

test("9. alertes préparées : fiche à créer, non validée à J-7, justificatif expiré, à mettre à jour ; date inconnue visible", () => {
  assert.equal(ajouterJours("2026-12-28", 7), "2027-01-04");
  assert.equal(ajouterJours("pas une date", 7), null);
  const chantiers = [
    { id: "a", nom: "FICTIF A", statut: "planifie" },
    { id: "b", nom: "FICTIF B", statut: "planifie" },
    { id: "c", nom: "FICTIF C", statut: "planifie" },
    { id: "d", nom: "FICTIF D", statut: "en_cours" },
    { id: "e", nom: "FICTIF E", statut: "en_cours" },
    { id: "z", nom: "FICTIF ARCHIVÉ", statut: "planifie", archive_le: LE },
  ];
  const fiches = { b: fiche({ chantier_id: "b" }), c: fiche({ chantier_id: "c", statut: "validee", validee_le: LE }), e: fiche({ chantier_id: "e", statut: "a_mettre_a_jour" }) };
  const al = alertesSecurite({ chantiers, fiches, premieresDates: { b: "2026-12-01", c: "2026-11-27" }, expires: { d: 2 }, aujourdhui: "2026-11-25" });
  const types = al.map((x) => `${x.chantier_id}:${x.type}`);
  assert.deepEqual(types, ["a:fiche_a_creer", "a:date_inconnue", "b:fiche_non_validee_j7", "d:justificatif_expire", "e:fiche_a_mettre_a_jour"]);
  assert.match(al.find((x) => x.type === "fiche_non_validee_j7").texte, /01\/12\/2026 : fiche en brouillon v1/);
  for (const x of al) assert.ok(x.lien.startsWith("/?page=chantiers&chantier="), "lien accepté par notifications (commence par /)");
  assert.equal(new Set(al.filter((x) => x.cle).map((x) => x.cle)).size, al.filter((x) => x.cle).length, "une clé par alerte");
  assert.equal(alertesSecurite({ chantiers, premieresDates: { b: "2026-12-03" }, aujourdhui: "2026-11-25" }).some((x) => x.type === "fiche_non_validee_j7" && x.chantier_id === "b"), false, "à 8 jours : pas encore");
  assert.deepEqual(alertesSecurite({ chantiers, aujourdhui: "" }), [], "sans date du jour : rien (pas d'horloge dans le module)");
});

test("10. module pur, façade, couche données dans l'ordre prévu", () => {
  const mod = sansCommentaires(lire("src/Renovation/securiteCycleVie.mjs"));
  assert.ok(!/supabase/i.test(mod), "aucun accès Supabase");
  assert.ok(!/Date\.now\(|new Date\(\)/.test(mod), "aucune horloge");
  assert.ok(!/from\s+"[^"]+\.js"/.test(mod), "n'importe que des .mjs");
  assert.match(lire("src/Renovation/securiteCycleVie.js"), /export \* from "\.\/securiteCycleVie\.mjs";/);

  const d = sansCommentaires(lire("src/Renovation/securiteCycleVieDonnees.js"));
  assert.ok(!/\.delete\(/.test(d), "aucune suppression");
  assert.ok(!/from\("notifications"\)/.test(d), "aucune écriture dans notifications depuis l'appli (aucun droit)");
  const forcer = d.slice(d.indexOf("export async function forcerDemarrage"), d.indexOf("export async function verrouillerFicheSecurite"));
  assert.ok(forcer.indexOf('from("securite_fiches").insert') < forcer.indexOf("journaliserStatut(prep.journal)"), "forçage : fiche puis journal");
  assert.match(forcer, /if \(!j\.ok\) return \{ ok: false/, "journal en échec : pas de passage en cours");
  assert.match(forcer, /\.eq\("id", c\.id\)\.eq\("statut", c\.statut\)\.eq\("version", c\.version\)/, "forçage seulement sur la fiche relue");
  const verrou = d.slice(d.indexOf("export async function verrouillerFicheSecurite"));
  assert.match(verrou, /\.eq\("id", c\.id\)\.eq\("statut", c\.statut\)\.eq\("version", c\.version\)/);
  assert.match(verrou, /NON verrouillée/, "un échec est dit, jamais présenté comme fait");
  assert.match(d, /ecrireEtapeCycleVie\(\{/, "étape écrite par le même service que les autres");
});

test("11. fiche chantier : le menu de statut passe par la règle, verrouillage après le statut, forçage avant", () => {
  const page = sansCommentaires(lire("src/Renovation/PageChantiers.jsx"));
  assert.match(page, /onClick=\{\(\) => changerStatutChantier\(s\)\}/, "menu « changer le statut »");
  assert.equal((page.match(/updateChantierStatut\(/g) || []).length, 2, "2 appels seulement (règle et forçage)");
  const changer = page.slice(page.indexOf("const changerStatutChantier = async"), page.indexOf("const forcerDemarrageChantier = async"));
  assert.match(changer, /await chargerFicheStatut\(selectedChantier\.id\)/, "fiche relue au moment du clic");
  assert.match(changer, /decisionChangementStatut\(\{/);
  assert.ok(changer.indexOf('if (d.action === "bloque")') < changer.indexOf("await updateChantierStatut("), "bloqué : aucun statut écrit");
  assert.ok(changer.indexOf("await updateChantierStatut(") < changer.indexOf("verrouillerFicheSecurite("), "statut PUIS verrouillage");
  assert.match(changer, /if \(!r\.ok\) \{[\s\S]{0,200}La fiche sécurité n'a pas été touchée/);
  const forcage = page.slice(page.indexOf("const forcerDemarrageChantier = async"), page.indexOf("const creerFicheSec = async"));
  assert.ok(forcage.indexOf("await forcerDemarrage(") < forcage.indexOf("await updateChantierStatut("), "fiche + journal PUIS statut");
  assert.match(forcage, /if \(!f\.ok\) return/);
  assert.match(page, /const estAdminSec = profil\?\.role === "admin";/, "admin = même règle que le reste de l'appli");
  assert.match(page, /ficheSecurite: \{ fiche: ficheSecSel\.ligne, lecture: ficheSecSel\.lecture \}/, "frise : état réel de la fiche");
  assert.match(page, /<BandeauFicheSecurite /);
  assert.match(page, /<ModaleDemarrageBloque /);
  assert.match(page, /<FicheSecuriteChantier T=\{T\} acc=\{acc\} op=\{operationSel\}/, "lien direct vers la fiche");
  assert.match(sansCommentaires(lire("src/App.jsx")), /const r=await sauverChantiers\(value\);[\s\S]{0,200}return r;/, "le résultat de l'enregistrement remonte");

  const modale = sansCommentaires(lire("src/Renovation/FicheSecuriteStatut.jsx"));
  assert.match(modale, /decision\.forcagePossible && estAdmin/, "bouton « Forcer le démarrage » réservé à l'admin");
  assert.match(modale, /validerMotifForcage\(motif\)/, "motif obligatoire");
  assert.match(modale, /Forcer le démarrage/);
  assert.match(modale, /chargerJournalStatut\(chantier\.id\)/, "historique du chantier visible");

  const panneau = sansCommentaires(lire("src/Renovation/FicheSecuriteOperation.jsx"));
  assert.match(panneau, /alerteChantierEnCours\(\{ chantier: c, fiche: etat\.parChantier\[c\.id\] \|\| null, lecture: etat\.lecture \}\)/);
  assert.match(panneau, /synchroniserEtapeFicheSecurite\(\{ chantierId: c\.id/);
  const ecran = sansCommentaires(lire("src/Renovation/FicheSecuriteChantier.jsx"));
  assert.equal((ecran.match(/synchroniserEtapeFicheSecurite\(\{ chantierId: chantier\.id, auteur \}\)/g) || []).length, 3, "après validation, après « Mettre à jour » et (tâche 8) après « Marquer « à mettre à jour » »");
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
});

test("12. reprise des chantiers déjà en cours : script préparé, non appliqué, uniquement des ajouts", () => {
  const sql = lire("sql/20261125_securite_fiches_reprise_en_cours.sql");
  assert.match(sql, /NE PAS APPLIQUER sans l'accord de François/);
  const code = sql.replace(/--.*$/gm, "").toLowerCase();
  assert.ok(!/\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b|\balter\b/.test(code), "rien n'est modifié ni supprimé");
  assert.match(code, /c\.statut = 'en_cours'/);
  assert.match(code, /c\.archive_le is null/);
  assert.match(code, /not exists \(select 1 from public\.securite_fiches/);
});

console.log(`\n${n} vérifications « Fiche sécurité : cycle de vie » réussies (exemples issus des tests, données fictives).`);
