#!/usr/bin/env node
// Vérifie l'espace « Justificatifs entreprise » de la fiche sécurité (tâche 9
// du projet docs/projets/fiche-securite-chantier.md) :
//   - statuts d'expiration : même règle que la vue
//     securite_justificatifs_expiration (contrôlée contre le SQL) ; la page
//     lit la vue, une ligne absente de la vue est « statut illisible » ;
//   - aptitudes médicales : jamais visibles d'un non-admin (ni ligne, ni
//     compte), ajout refusé, rangées dans securite-confidentiel ;
//   - rattachement automatique : un justificatif permanent VALIDE du même
//     type couvre un requis d'un point concerné (fiche, pastille, alertes,
//     mise à jour proposée : même fonction) ; jamais un confidentiel, un
//     archivé, un expiré, ni un type non rattachable ;
//   - contenu figé (format v2) : justificatifs rattachés avec leur origine,
//     dans l'empreinte ; PDF qui les liste « depuis l'espace entreprise » ;
//   - page enregistrée (access.js, menu, App) et branchements.
//   - tâche 9b : alertes « expire sous 30 jours » / « expiré » de l'espace
//     entreprise (S1 non confidentiels, S2 aptitudes, sans nom), envoyées
//     une seule fois. Le « Dossier de contrôle » : verif-securite-dossier-controle.mjs.
//
// Exemples issus des tests, données fictives : personnes, dates et documents
// sont inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-entreprise.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TYPES_JUSTIFICATIF_ENTREPRISE, TYPES_RATTACHABLES_ENTREPRISE, TYPE_JUSTIFICATIF_CONFIDENTIEL, POINTS_FICHE,
} from "../src/Renovation/securite/points.mjs";
import {
  etatExpiration, lignesJustificatifsEntreprise, comptesParEtat, preparerJustificatifEntreprise, typesProposesEntreprise,
  stockageJustificatifEntreprise, affectationPersonne, nomsPlanning, texteRattache, filtrerLignes, JOURS_EXPIRE_BIENTOT,
} from "../src/Renovation/securiteEntreprise.mjs";
import {
  justificatifsRequisManquants, justificatifsEntrepriseRattaches, justificatifsPourPastille, etatValidation, estEntrepriseRattachable,
} from "../src/Renovation/securiteValidation.mjs";
import { contenuVersion, serialisationCanonique, FORMAT_CONTENU_VERSION, FORMATS_CONTENU_LISIBLES } from "../src/Renovation/securiteVersion.mjs";
import { modelePdfFiche, htmlFicheSecuritePdf } from "../src/Renovation/securitePdf.mjs";
import {
  nbRequisExpires, entreesAlertesSecurite, alertesEspaceEntreprise, aptitudesBientotExpirees, calculerPlanSecurite, cleObjetAlerte,
  LIEN_ESPACE_ENTREPRISE, ALERTES_NOTIFIEES,
} from "../src/Renovation/securiteAlertesPush.mjs";
import { propositionsMiseAJour, partieRisques } from "../src/Renovation/securiteAccueil.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

let n = 0;
async function test(nom, fn) { await fn(); n++; console.log("ok -", nom); }

// ─── Exemples issus des tests, données fictives ──────────────────────────────
const AUJ = "2026-11-25";
const ent = (id, type_code, extra = {}) => ({
  id, portee: "entreprise", chantier_id: null, operation_id: null, point: null, type_code,
  fichier_path: `securite/entreprise/${type_code}/${id}.pdf`, fichier_nom: `${id}.pdf`, date_document: "2026-01-10",
  expire_le: null, personne: null, entreprise_nom: "Profero", confidentiel: false, archive_le: null, ...extra,
});
const chant = (id, point, type_code, extra = {}) => ({
  id, portee: "chantier", chantier_id: "ch-fictif", point, type_code, fichier_path: "x", fichier_nom: `${id}.pdf`,
  date_document: "2026-11-01", expire_le: null, archive_le: null, confidentiel: false, ...extra,
});
const HAB_OK = ent("e-hab", "habilitation_electrique", { personne: "Léa Fictive", expire_le: "2028-03-01" });
const HAB_EXP = ent("e-hab-exp", "habilitation_electrique", { personne: "Marc Fictif", expire_le: "2026-10-01" });
const APT = ent("e-apt", "aptitude_medicale", { personne: "Léa Fictive", expire_le: "2027-01-01", confidentiel: true });
const DUERP = ent("e-duerp", "duerp", { date_document: "2026-02-01" });
const KBIS = ent("e-kbis", "kbis");
const reponses = (extra = {}) => ({ p4: { statut: "non_concerne" }, p6: { statut: "concerne" }, p9: { statut: "non_concerne" }, p10: { statut: "non_concerne" }, ...extra });

await test("1. statut d'expiration : même règle que la vue (expiré, sous 30 jours, valide), contrôlée contre le SQL", () => {
  assert.equal(etatExpiration("2026-11-24", AUJ), "expire");
  assert.equal(etatExpiration("2026-11-25", AUJ), "expire_bientot", "expire aujourd'hui : pas encore expiré (strictement avant)");
  assert.equal(etatExpiration("2026-12-24", AUJ), "expire_bientot", "J+29");
  assert.equal(etatExpiration("2026-12-25", AUJ), "valide", "J+30 : current_date + 30 n'est pas « < »");
  assert.equal(etatExpiration("2027-03-01", AUJ), "valide");
  assert.equal(etatExpiration(null, AUJ), "sans_expiration");
  assert.equal(etatExpiration("2026-13-45", AUJ), "inconnu", "date impossible : jamais « valide »");
  assert.equal(etatExpiration("2026-12-31", "2026-12-15"), "expire_bientot", "passage d'année");
  assert.equal(JOURS_EXPIRE_BIENTOT, 30);
  const dir = join(racine, "supabase/migrations");
  const sql = readFileSync(join(dir, readdirSync(dir).find((x) => /_securite_fiches_chantier\.sql$/.test(x))), "utf8");
  const vue = sql.slice(sql.indexOf("create view public.securite_justificatifs_expiration"));
  assert.match(vue, /when expire_le < current_date then 'expire'/);
  assert.match(vue, /when expire_le < current_date \+ 30 then 'expire_bientot'/);
  assert.match(vue, /else 'valide'/);
  assert.match(vue, /where archive_le is null and expire_le is not null/, "la vue écarte les lignes sans expiration → « sans date d'expiration »");
});

await test("2. page : statut lu dans la vue, tri par expiration la plus proche, vue illisible = « statut illisible »", () => {
  const liste = [HAB_OK, HAB_EXP, DUERP, KBIS, ent("e-ss4", "formation_ss4", { personne: "Léa Fictive", expire_le: "2026-12-10" }), ent("e-arch", "duerp", { archive_le: "2026-11-01T00:00:00Z" })];
  const etats = { "e-hab": "valide", "e-hab-exp": "expire", "e-ss4": "expire_bientot" };
  const l = lignesJustificatifsEntreprise({ justificatifs: liste, etats, estAdmin: false });
  assert.deepEqual(l.map((x) => x.justificatif.id), ["e-hab-exp", "e-ss4", "e-hab", "e-duerp", "e-kbis"], "expirés d'abord, sans date à la fin, archivés absents");
  assert.deepEqual(l.map((x) => x.etat), ["expire", "expire_bientot", "valide", "sans_expiration", "sans_expiration"]);
  assert.equal(l[1].libelleEtat, "expire sous 30 jours");
  const sansVue = lignesJustificatifsEntreprise({ justificatifs: liste, etats: null, estAdmin: false });
  assert.deepEqual(sansVue.map((x) => x.etat), ["inconnu", "inconnu", "inconnu", "sans_expiration", "sans_expiration"], "jamais « valide » sans la vue");
  assert.equal(lignesJustificatifsEntreprise({ justificatifs: null, etats, estAdmin: true }), null, "table illisible : pas de liste vide");
  assert.deepEqual(filtrerLignes(l, { personne: "Léa Fictive" }).map((x) => x.justificatif.id), ["e-ss4", "e-hab"]);
  assert.deepEqual(filtrerLignes(l, { type: "duerp" }).map((x) => x.justificatif.id), ["e-duerp"]);
});

await test("3. aptitudes médicales : jamais vues d'un non-admin (ni ligne, ni compte), vues de l'admin", () => {
  const liste = [HAB_OK, APT, { ...APT, id: "e-apt-2", confidentiel: false }];
  const etats = { "e-hab": "valide", "e-apt": "valide", "e-apt-2": "valide" };
  const nonAdmin = lignesJustificatifsEntreprise({ justificatifs: liste, etats, estAdmin: false });
  assert.deepEqual(nonAdmin.map((x) => x.justificatif.id), ["e-hab"], "aucune aptitude, même mal marquée");
  assert.equal(comptesParEtat(nonAdmin).valide, 1, "les comptes ne trahissent pas l'aptitude");
  const admin = lignesJustificatifsEntreprise({ justificatifs: liste, etats, estAdmin: true });
  assert.equal(admin.length, 3);
  assert.ok(!typesProposesEntreprise(false).includes(TYPE_JUSTIFICATIF_CONFIDENTIEL));
  assert.ok(typesProposesEntreprise(true).includes(TYPE_JUSTIFICATIF_CONFIDENTIEL));
  const form = { type_code: "aptitude_medicale", personne: "Léa Fictive", date_document: "2026-11-01", expire_le: "2028-11-01" };
  assert.match(preparerJustificatifEntreprise({ form, aFichier: true, estAdmin: false }).erreurs.join(), /réservées aux administrateurs/);
  const ok = preparerJustificatifEntreprise({ form, aFichier: true, estAdmin: true });
  assert.ok(ok.ok && ok.confidentiel && ok.ligne.confidentiel === true && ok.ligne.portee === "entreprise" && ok.ligne.point === null);
  assert.deepEqual(stockageJustificatifEntreprise("aptitude_medicale"), { bucket: "securite-confidentiel", dossier: "entreprise/aptitude_medicale" });
  assert.deepEqual(stockageJustificatifEntreprise("habilitation_electrique"), { bucket: "chantier-documents", dossier: "securite/entreprise/habilitation_electrique" });
  assert.throws(() => stockageJustificatifEntreprise("../x"), /inconnu/);
});

await test("4. ajout : contrôles du formulaire (personne pour un document nominatif, dates, fichier)", () => {
  const p = (form, aFichier = true) => preparerJustificatifEntreprise({ form, aFichier, estAdmin: false });
  assert.match(p({ type_code: "habilitation_electrique" }).erreurs.join(), /personne concernée/);
  assert.match(p({ type_code: "duerp" }, false).erreurs.join(), /fichier/);
  assert.match(p({ type_code: "duerp", date_document: "2026-11-10", expire_le: "2026-11-01" }).erreurs.join(), /avant la date du document/);
  assert.match(p({ type_code: "photo" }).erreurs.join(), /non prévu/);
  const ok = p({ type_code: "duerp", date_document: "2026-11-10", entreprise_nom: " Profero " });
  assert.deepEqual(ok.ligne, { portee: "entreprise", chantier_id: null, operation_id: null, point: null, type_code: "duerp", date_document: "2026-11-10", expire_le: null, personne: null, entreprise_nom: "Profero", confidentiel: false });
  for (const t of TYPES_RATTACHABLES_ENTREPRISE) {
    assert.ok(TYPES_JUSTIFICATIF_ENTREPRISE.includes(t), t);
    assert.notEqual(t, TYPE_JUSTIFICATIF_CONFIDENTIEL);
    assert.ok(POINTS_FICHE.some((p) => p.justificatifs.some((j) => j.type_code === t)), `${t} attendu sur au moins un point`);
  }
});

await test("5. rattachement automatique : habilitation permanente valide → point 6 satisfait ; expirée, archivée, confidentielle, non rattachable : non", () => {
  const req = (je, rep = reponses()) => justificatifsRequisManquants({ reponses: rep, justificatifs: [chant("c10", 10, "fiche_remise_epi")], justificatifsEntreprise: je, aujourdhui: AUJ });
  assert.deepEqual(req([]).map((m) => [m.numero, m.raison]), [[6, "absent"]]);
  assert.deepEqual(req([HAB_OK]), [], "couvert par l'espace entreprise");
  assert.deepEqual(req([HAB_EXP]).map((m) => [m.numero, m.raison]), [[6, "expire"]], "expirée : requis expiré, pas « absent »");
  assert.deepEqual(req([{ ...HAB_OK, archive_le: "2026-11-01T00:00:00Z" }]).map((m) => m.raison), ["absent"], "archivée");
  assert.deepEqual(req([{ ...HAB_OK, confidentiel: true }]).map((m) => m.raison), ["absent"], "jamais un confidentiel");
  assert.deepEqual(req([{ ...HAB_OK, portee: "chantier" }]).map((m) => m.raison), ["absent"], "seulement la portée entreprise");
  assert.deepEqual(req([HAB_OK], reponses({ p6: { statut: "non_concerne" } })), [], "point non concerné : rien d'attendu");
  assert.equal(req(null), null, "espace entreprise illisible : on ne sait pas (jamais « satisfait »)");
  // Consigne de travail isolé (point 9) : couverte par une consigne permanente.
  const r9 = reponses({ p6: { statut: "non_concerne" }, p9: { statut: "concerne" } });
  assert.equal(req([], r9).length, 1);
  assert.deepEqual(req([ent("e-iso", "consigne_travail_isole")], r9), []);
  // Fiche de remise des EPI (point 10) : pas rattachable, reste au chantier.
  assert.equal(estEntrepriseRattachable(ent("e-epi", "fiche_remise_epi"), "fiche_remise_epi"), false);
  assert.equal(estEntrepriseRattachable(KBIS, "kbis"), false, "Kbis : concerne les entreprises intervenantes, pas rattaché");
});

await test("6. liste rattachée : points concernés seulement, valides seulement, ordre stable ; DUERP au point 3", () => {
  const je = [HAB_OK, HAB_EXP, APT, DUERP, KBIS, ent("e-ss4", "formation_ss4", { personne: "Léa Fictive" })];
  const r = justificatifsEntrepriseRattaches({ reponses: reponses(), justificatifsEntreprise: je, aujourdhui: AUJ });
  assert.deepEqual(r.map((x) => [x.numero, x.justificatif.id]), [[3, "e-duerp"], [6, "e-hab"]], "SS4 absente : point 4 non concerné");
  const r4 = justificatifsEntrepriseRattaches({ reponses: reponses({ p4: { statut: "concerne" } }), justificatifsEntreprise: [...je].reverse(), aujourdhui: AUJ });
  assert.deepEqual(r4.map((x) => [x.numero, x.justificatif.id]), [[3, "e-duerp"], [4, "e-ss4"], [6, "e-hab"]], "aptitude jamais rattachée, ordre indépendant de la lecture");
  assert.equal(justificatifsEntrepriseRattaches({ reponses: reponses(), justificatifsEntreprise: null, aujourdhui: AUJ }), null);
});

await test("7. même règle partout : validation, pastille, mise à jour proposée, alertes S1", () => {
  const fiche = { id: "f1", chantier_id: "ch-fictif", version: 1, statut: "validee", reponses: reponses() };
  const jc = [chant("c10", 10, "fiche_remise_epi")];
  // Pastille
  assert.deepEqual(justificatifsPourPastille({ reponses: fiche.reponses, justificatifs: jc, aujourdhui: AUJ, justificatifsEntreprise: [HAB_OK] }), { manquants: 0, expires: 0 });
  assert.equal(justificatifsPourPastille({ reponses: fiche.reponses, justificatifs: jc, aujourdhui: AUJ, justificatifsEntreprise: [] }).manquants, 1);
  // Validation : le requis du point 6 n'apparaît pas dans les manquants.
  const e = etatValidation({ fiche: { ...fiche, statut: "brouillon" }, contexte: {}, justificatifs: jc, justificatifsEntreprise: [HAB_OK], signatures: [], empreinte: null, aujourdhui: AUJ });
  assert.ok(!e.justificatifsManquants.some((m) => m.numero === 6));
  const eIllisible = etatValidation({ fiche: { ...fiche, statut: "brouillon" }, contexte: {}, justificatifs: jc, justificatifsEntreprise: null, signatures: [], aujourdhui: AUJ });
  assert.ok(eIllisible.bloquants.some((b) => /espace entreprise illisibles/.test(b)));
  // Alertes S1 : habilitation de chantier expirée, mais permanente valide → pas d'alerte.
  const jcExp = [...jc, chant("c6", 6, "habilitation_electrique", { expire_le: "2026-10-01" })];
  assert.equal(nbRequisExpires({ reponses: fiche.reponses, justificatifs: jcExp, aujourdhui: AUJ }), 1);
  assert.equal(nbRequisExpires({ reponses: fiche.reponses, justificatifs: jcExp, aujourdhui: AUJ, justificatifsEntreprise: [HAB_OK] }), 0);
  assert.equal(nbRequisExpires({ reponses: fiche.reponses, justificatifs: jcExp, aujourdhui: AUJ, justificatifsEntreprise: [{ ...HAB_OK, confidentiel: true }] }), 1);
  const entrees = entreesAlertesSecurite({ chantiers: [{ id: "ch-fictif", statut: "en_cours" }], fiches: [fiche], justificatifs: [...jcExp, HAB_OK], aujourdhui: AUJ });
  assert.deepEqual(entrees.expires, {}, "le job lit toutes les portées : l'entreprise couvre le chantier");
  const entreesSans = entreesAlertesSecurite({ chantiers: [{ id: "ch-fictif", statut: "en_cours" }], fiches: [fiche], justificatifs: jcExp, aujourdhui: AUJ });
  assert.deepEqual(entreesSans.expires, { "ch-fictif": 1 });
  // Mise à jour proposée.
  const pm = (je) => propositionsMiseAJour({ fiche, sources: {}, lots: [], justificatifs: jcExp, justificatifsEntreprise: je, aujourdhui: AUJ });
  assert.ok(pm([]).raisons.some((r) => r.code === "justificatif"));
  assert.ok(!pm([HAB_OK]).raisons.some((r) => r.code === "justificatif"));
  assert.ok(pm(null).impossibles.some((m) => /justificatifs illisibles/.test(m)));
});

await test("8. contenu figé v2 : justificatifs rattachés avec leur origine, dans l'empreinte ; v1 toujours lisible", () => {
  const fiche = { id: "11111111-2222-3333-4444-555555555555", chantier_id: "ch-fictif", version: 1, reponses: reponses(), intervenants: [], donnees_base: {}, synthese_risques: ["a", "b"] };
  const base = { fiche, chantier: { id: "ch-fictif", nom: "CHANTIER FICTIF" }, operation: { id: "op", nom: "Op fictive", adresse: "1 rue Imaginaire" }, justificatifs: [] };
  const rattaches = justificatifsEntrepriseRattaches({ reponses: fiche.reponses, justificatifsEntreprise: [HAB_OK, DUERP, APT], aujourdhui: AUJ });
  const c = contenuVersion({ ...base, rattachesEntreprise: rattaches });
  assert.equal(c.format, "fiche-securite-v2");
  assert.equal(FORMAT_CONTENU_VERSION, "fiche-securite-v2");
  assert.deepEqual(c.justificatifs_entreprise.map((j) => [j.point, j.id, j.origine]), [[3, "e-duerp", "entreprise"], [6, "e-hab", "entreprise"]]);
  assert.ok(!("confidentiel" in c.justificatifs_entreprise[0]) && !("archive_le" in c.justificatifs_entreprise[0]));
  // Le confidentiel ne peut pas entrer, même passé par erreur.
  const force = contenuVersion({ ...base, rattachesEntreprise: [{ numero: 4, justificatif: APT }] });
  assert.deepEqual(force.justificatifs_entreprise, []);
  // Empreinte : change avec les rattachés, pas avec l'ordre de lecture.
  const h = (x) => sha(serialisationCanonique(x));
  assert.notEqual(h(c), h(contenuVersion(base)));
  assert.equal(h(c), h(contenuVersion({ ...base, rattachesEntreprise: [...rattaches].reverse() })));
  // Admin et non-admin : même liste lue (confidentiel filtré à la lecture), même empreinte.
  const rAdmin = justificatifsEntrepriseRattaches({ reponses: fiche.reponses, justificatifsEntreprise: [APT, DUERP, HAB_OK], aujourdhui: AUJ });
  assert.equal(h(contenuVersion({ ...base, rattachesEntreprise: rAdmin })), h(c));
  assert.throws(() => contenuVersion({ ...base, rattachesEntreprise: null }), /espace entreprise illisibles/);
  assert.deepEqual(FORMATS_CONTENU_LISIBLES, ["fiche-securite-v1", "fiche-securite-v2"]);
  assert.ok(partieRisques({ ...c, format: "fiche-securite-v1" }).ok, "accueil : une version v1 reste lisible");
  assert.ok(partieRisques(c).ok);
});

await test("9. PDF : justificatifs de l'espace entreprise listés au point, « depuis l'espace entreprise, valable jusqu'au … »", () => {
  const fiche = { id: "11111111-2222-3333-4444-555555555555", chantier_id: "ch-fictif", version: 1, reponses: reponses(), intervenants: [], donnees_base: {}, synthese_risques: ["a", "b"] };
  const contenu = contenuVersion({
    fiche, chantier: { id: "ch-fictif", nom: "CHANTIER FICTIF" }, operation: { id: "op", nom: "Op", adresse: "x" },
    justificatifs: [chant("c6", 6, "recepisse_dict")],
    rattachesEntreprise: justificatifsEntrepriseRattaches({ reponses: fiche.reponses, justificatifsEntreprise: [HAB_OK], aujourdhui: AUJ }),
  });
  const r = modelePdfFiche({ contenu, brouillon: true, empreinte: "a".repeat(64), apercuLe: "2026-11-25T10:00:00Z" });
  assert.ok(r.ok, r.erreur);
  const html = htmlFicheSecuritePdf(r.modele);
  assert.match(html, /Habilitation électrique<\/b> — e-hab\.pdf · du 10\/01\/2026 · depuis l'espace entreprise, valable jusqu'au 01\/03\/2028 · Léa Fictive/);
  assert.match(html, /Récépissé de DICT/);
  assert.ok(html.indexOf("Récépissé de DICT") < html.indexOf("e-hab.pdf"), "chantier d'abord, entreprise ensuite");
  const v1 = modelePdfFiche({ contenu: { ...contenu, format: "fiche-securite-v1", justificatifs_entreprise: undefined }, brouillon: true, empreinte: "a".repeat(64) });
  assert.ok(v1.ok, "une version v1 (sans espace entreprise) produit toujours son PDF");
});

await test("10. mention d'affectation (habilitation) : au planning du chantier, pas retrouvé, inconnue", () => {
  const noms = nomsPlanning([{ ouvriers: ["Léa", "Steven"] }, { ouvriers: ["Steven", { nom: "Paul" }] }, { ouvriers: null }]);
  assert.deepEqual(noms.sort(), ["Léa", "Paul", "Steven"]);
  assert.equal(affectationPersonne("Lea Fictive", noms), "affecte", "accents et casse ignorés");
  assert.equal(affectationPersonne("Marc Fictif", noms), "non_retrouve");
  assert.equal(affectationPersonne("Léa Fictive", null), "inconnue", "planning illisible");
  assert.equal(affectationPersonne("", noms), "inconnue");
  assert.equal(nomsPlanning(null), null);
  const dateFr = (d) => d.split("-").reverse().join("/");
  assert.equal(texteRattache(HAB_OK, { affectation: "affecte", dateFr }), "depuis l'espace entreprise, valable jusqu'au 01/03/2028 · Léa Fictive (au planning de ce chantier)");
  assert.match(texteRattache(HAB_OK, { affectation: "non_retrouve", dateFr }), /pas retrouvé au planning de ce chantier : à vérifier/);
  assert.equal(texteRattache(DUERP, { affectation: "sans_objet", dateFr }), "depuis l'espace entreprise, sans date d'expiration");
});

await test("11. page enregistrée : access.js (admin + conducteur par défaut), menus, App ; auto-grant admin toujours en place", () => {
  const acc = lire("src/access.js");
  const pages = acc.slice(acc.indexOf("export const PAGES_RENOVATION"), acc.indexOf("export const PAGES_INVEST"));
  assert.match(pages, /\{ id: "justificatifs-entreprise", label: "Justificatifs entreprise" \}/);
  const bloc = acc.match(/export const ROLE_PAGES_DEFAULT_RENOVATION = \{([\s\S]*?)\n\};/)[1];
  const roles = {};
  for (const m of bloc.matchAll(/(\w+): \[([\s\S]*?)\]/g)) roles[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const avec = Object.keys(roles).filter((r) => roles[r].includes("justificatifs-entreprise")).sort();
  assert.deepEqual(avec, ["admin", "conducteur"], "seulement admin et conducteur (accord de François du 25/11)");
  assert.match(acc, /const adminMissing = adminDefault\.filter\(\(p\) => !adminSaved\.includes\(p\)\);/, "auto-grant admin en fin de loadAccessConfig");
  const nav = lire("src/Renovation/Navigation.jsx");
  const repli = nav.match(/const ROLE_PAGES = \{([\s\S]*?)\n\};/)[1];
  for (const m of repli.matchAll(/(\w+): \[([\s\S]*?)\]/g)) {
    assert.equal(m[2].includes('"justificatifs-entreprise"'), ["admin", "conducteur"].includes(m[1]), `repli du menu ${m[1]}`);
  }
  for (const liste of ["ALL_NAV_ITEMS", "allNav"]) {
    assert.match(nav.match(new RegExp(`const ${liste} = \\[([\\s\\S]*?)\\n\\];`))[1], /id:"justificatifs-entreprise"/, liste);
  }
  const app = lire("src/App.jsx");
  assert.match(app, /p==="justificatifs-entreprise" && \(canAccess\(role,"justificatifs-entreprise"\) \? <PageJustificatifsEntreprise T=\{T\} branch=\{branch\} profil=\{profil\}\/> : <AccesRefuse/);
});

await test("12. branchements : la fiche lit l'espace entreprise sans confidentiel, la page lit la vue, modules purs", () => {
  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  const fn = donnees.slice(donnees.indexOf("export async function chargerJustificatifsEntrepriseFiche"), donnees.indexOf("export async function ajouterJustificatif("));
  assert.match(fn, /\.eq\("portee", "entreprise"\)\.eq\("confidentiel", false\)\.is\("archive_le", null\)/, "même liste pour admin et non-admin (même empreinte)");
  assert.match(donnees, /justificatifsEntrepriseRattaches\(\{ reponses: f\.ligne\.reponses, justificatifsEntreprise: je\.liste, aujourdhui \}\)/, "contenu figé relu en base avant signature et validation");
  assert.match(donnees, /from\("securite_justificatifs_expiration"\)\.select\("id, etat"\)/, "la page lit la vue (elle fait foi)");
  assert.match(donnees, /justificatifsPourPastille\(\{ reponses: l\.reponses, justificatifs: justifs, aujourdhui, justificatifsEntreprise: je\.liste \}\)/, "pastille : même règle");
  assert.equal((donnees.match(/lireContenuAFiger\(\{ chantier, op, clientLibelle, clientErreur, aujourdhui \}\)/g) || []).length, 2, "signature et validation à la même date");
  const ecran = lire("src/Renovation/FicheSecuriteChantier.jsx");
  assert.equal((ecran.match(/rattachesEntreprise: rattachesEnregistres\(\)/g) || []).length, 2, "empreinte affichée et aperçu PDF");
  assert.match(ecran, /justificatifsEntreprise: justifsEnt\.charge \? justifsEnt\.liste : null/);
  const page = lire("src/Renovation/PageJustificatifsEntreprise.jsx");
  assert.match(page, /const estAdmin = profil\?\.role === "admin"/);
  assert.match(page, /lignesJustificatifsEntreprise\(\{ justificatifs: donnees\.liste, etats: donnees\.etats, estAdmin \}\)/);
  assert.ok(!/\.delete\(|\.remove\(/.test(page), "retrait = archivage");
  for (const f of ["src/Renovation/securiteEntreprise.mjs", "src/Renovation/securiteValidation.mjs"]) {
    const src = sansCommentaires(lire(f));
    assert.ok(!/supabase|new Date\(\)|Date\.now\(\)/.test(src), `${f} : module pur`);
  }
  assert.match(lire("src/Renovation/securiteEntreprise.js"), /export \* from "\.\/securiteEntreprise\.mjs"/);
  const stockage = sansCommentaires(lire("src/Renovation/storageChantier.js"));
  const conf = stockage.slice(stockage.indexOf("export async function deposerDocumentConfidentiel"));
  assert.match(conf, /upsert: false/, "jamais de remplacement dans le bucket confidentiel");
  assert.ok(!/\.remove\(/.test(conf), "aucune suppression dans le bucket confidentiel");
});

await test("13. journal des MAJ : entrée de la tâche 9 en langage métier", () => {
  const j = lire("src/Renovation/journalMaj.js");
  assert.match(j, /id: "justificatifs-entreprise", label: "Justificatifs entreprise"/);
});


await test("14. alertes 30 jours (tâche 9b) : S1 pour les justificatifs non confidentiels, même règle que la vue", () => {
  const liste = [
    ent("b1", "habilitation_electrique", { personne: "Léa Fictive", expire_le: "2026-12-24" }), // J+29
    ent("b2", "formation_ss4", { expire_le: "2026-12-25" }),                                   // J+30 : valide
    ent("b3", "duerp", { expire_le: "2026-11-24" }),                                            // expiré
    ent("b4", "duerp", { expire_le: "2026-11-30", archive_le: "2026-11-20T00:00:00Z" }),        // archivé
    ent("b5", "kbis"),                                                                          // sans expiration
    APT, { ...APT, id: "b6", expire_le: "2026-12-01" },                                         // confidentiels : jamais en S1
    chant("c1", 6, "habilitation_electrique", { expire_le: "2026-12-01" }),                     // portée chantier : pas ici
  ];
  const a = alertesEspaceEntreprise({ justificatifs: liste, aujourdhui: AUJ });
  assert.deepEqual(a.map(cleObjetAlerte), ["justificatif_entreprise_30j:b1", "justificatif_entreprise_expire:b3"]);
  assert.equal(a[0].lien, LIEN_ESPACE_ENTREPRISE);
  assert.match(a[0].texte, /Habilitation électrique — Léa Fictive : expire le 24\/12\/2026/);
  assert.ok(ALERTES_NOTIFIEES.includes("justificatif_entreprise_30j") && ALERTES_NOTIFIEES.includes("justificatif_entreprise_expire"));
  assert.deepEqual(alertesEspaceEntreprise({ justificatifs: liste, aujourdhui: "" }), [], "sans date : rien");
  // S2 : aptitude sous 30 jours (b6), pas celle à 2027 (APT).
  assert.deepEqual(aptitudesBientotExpirees({ justificatifs: liste, aujourdhui: AUJ }).map((j) => j.id), ["b6"]);
});

await test("15. plan : une seule fois tant que c'est vrai ; à l'expiration, « sous 30 jours » est oublié et « expiré » part ; S2 sans nom", () => {
  const base = { chantiers: [], fiches: [], phasages: [], dateParis: AUJ };
  const justifs = [ent("b1", "habilitation_electrique", { personne: "Léa Fictive", expire_le: "2026-12-24" }), { ...APT, id: "b6", expire_le: "2026-12-01" }];
  const p1 = calculerPlanSecurite({ ...base, justificatifs: justifs, etatsStockes: [] });
  assert.deepEqual(p1.alertes, [], "alertes des chantiers inchangées");
  assert.deepEqual(p1.s1.aInscrire, ["justificatif_entreprise_30j:b1"]);
  assert.equal(p1.s1.contenu.titre, "Justificatif de l'entreprise : expire sous 30 jours — Habilitation électrique — Léa Fictive");
  assert.equal(p1.s1.contenu.lien, LIEN_ESPACE_ENTREPRISE);
  assert.deepEqual(p1.s2.aInscrire, ["aptitude_30j:b6"]);
  assert.equal(p1.s2.contenu.titre, "1 aptitude médicale expire sous 30 jours");
  assert.ok(!/Léa|Fictive/.test(JSON.stringify(p1.s2.contenu)), "S2 : jamais de nom");
  const stockes = [...p1.s1.aInscrire.map((c) => ({ type: "S1", cle_objet: c })), ...p1.s2.aInscrire.map((c) => ({ type: "S2", cle_objet: c }))];
  const p2 = calculerPlanSecurite({ ...base, justificatifs: justifs, etatsStockes: stockes, dateParis: "2026-11-26" });
  assert.equal(p2.s1.contenu, null); assert.equal(p2.s2.contenu, null); assert.deepEqual(p2.aOublier, []);
  const p3 = calculerPlanSecurite({ ...base, justificatifs: justifs, etatsStockes: stockes, dateParis: "2026-12-26" });
  assert.deepEqual(p3.s1.aInscrire, ["justificatif_entreprise_expire:b1"]);
  assert.deepEqual(p3.s2.aInscrire, ["aptitude:b6"]);
  assert.deepEqual(p3.aOublier.map((x) => `${x.type} ${x.cle_objet}`).sort(), ["S1 justificatif_entreprise_30j:b1", "S2 aptitude_30j:b6"]);
  // Document renouvelé puis l'ancien retiré : plus rien, l'état est oublié.
  const p4 = calculerPlanSecurite({ ...base, justificatifs: [{ ...justifs[0], archive_le: "2026-12-01T00:00:00Z" }], etatsStockes: [{ type: "S1", cle_objet: "justificatif_entreprise_30j:b1" }] });
  assert.equal(p4.s1.contenu, null);
  assert.deepEqual(p4.aOublier, [{ type: "S1", cle_objet: "justificatif_entreprise_30j:b1" }]);
  // Le job lit la personne (texte de l'alerte) et ne recopie aucun seuil.
  const job = lire("api/_cron/cron-alertes-securite.js");
  assert.match(job, /"id, portee, chantier_id, point, type_code, personne, expire_le, archive_le, confidentiel, date_document, created_at"/);
});

console.log(`\n${n} vérifications « Fiche sécurité : justificatifs entreprise » réussies (exemples issus des tests, données fictives).`);
