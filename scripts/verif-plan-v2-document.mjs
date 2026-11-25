// Vérification du DOCUMENT d'un plan du nouvel éditeur (projet
// docs/projets/editeur-plans.md, tâche 3) : ce qui est enregistré dans
// plans_v2.data, et les requêtes qui le lisent et l'écrivent.
//   • le relevé de départ est copié, jamais modifié (règle 1) ;
//   • l'existant est figé : rouvrir un plan ne relance pas le redressement
//     (règle 4) ;
//   • un point à valider n'entre dans le plan que sur action (règle 8) ;
//   • un document illisible donne une erreur, jamais un plan vide (règle 13) ;
//   • enregistrer n'écrase pas une version plus récente ; aucune écriture
//     dans l'ancienne table des plans.
//
// Jeux de test — exemples issus des tests, données fictives :
//  • le relevé de référence ANONYMISÉ de scripts/fixtures/ (6 pièces), le même
//    que scripts/verif-releve-imapper.mjs ; aucun relevé réel n'est versionné ;
//  • un faux client de base, écrit ici : aucune base n'est contactée.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemblerReleve, lirePdfImapper, calculerMetres, texteMetre, VERSION_RELEVE } from "../src/Renovation/releveImapper.mjs";
import { construireModeleExistant, VERSION_MODELE_PLAN, TOLERANCES_MURS } from "../src/Renovation/planV2/planV2Modele.mjs";
import {
  redresserReleve, appliquerPointRedressement, bilanDeplacement, mesurerEcart, TOLERANCES_REDRESSEMENT, VERSION_REDRESSEMENT,
} from "../src/Renovation/planV2/planV2Redressement.mjs";
import {
  creerDocumentPlan, verifierDocumentPlan, ouvrirDocumentPlan, existantDuDocument, accepterPoint, refuserPoint, rouvrirPoint,
  mesurerEffetPoint, remplacerExistant, resumerDocumentPlan, FORMAT_DOCUMENT_PLAN, VERSION_DOCUMENT_PLAN, MESURES_BRUTES,
} from "../src/Renovation/planV2/planV2Document.mjs";
import { creerAccesPlans, COLONNES_PLAN } from "../src/Renovation/planV2/planV2DonneesRequetes.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);
const taille = (v) => JSON.stringify(v).length;
const geler = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(geler); } return o; };
const copie = (v) => JSON.parse(JSON.stringify(v));
// La base (jsonb) rend les clés d'un objet dans SON ordre (longueur, puis
// alphabétique), pas dans celui de l'écriture : rien ne doit en dépendre.
const commeLaBase = (v) => (Array.isArray(v) ? v.map(commeLaBase)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, commeLaBase(v[k])]))
  : v);

// ── Relevé de référence anonymisé (scripts/fixtures) ───────────────────────
const dxfTexte = fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference.dxf"), "latin1");
const pdfJson = JSON.parse(fs.readFileSync(path.join(ici, "fixtures/releve-imapper-reference-pdf.json"), "utf8"));
const pdfs = pdfJson.pdfs.map((p) => ({ nom: p.nom, lecture: lirePdfImapper(p.page1, p.page2), nbPhotos: p.nbPhotos }));
const REF = () => assemblerReleve({ dxfTexte, pdfs, maintenant: "2026-10-15T10:00:00Z" }).releve;
const SOURCE = { type: "ancien_plan", plan_id: "00000000-0000-4000-8000-000000000001", plan_nom: "Plan fictif", plan_modifie_le: "2026-11-01T08:00:00Z" };
const QUAND = "2026-11-25T09:00:00.000Z";
const creer = (releve = REF(), plus = {}) => {
  const r = creerDocumentPlan({ releve, source: SOURCE, maintenant: QUAND, ...plus });
  assert.equal(r.ok, true, r.erreur);
  return r.document;
};
// Un refus est toujours explicite, et ne rend jamais de quoi dessiner un plan.
const refus = (r, code) => {
  assert.equal(r.ok, false, `refus attendu (${code})`);
  assert.equal(r.code, code);
  assert.ok(typeof r.erreur === "string" && r.erreur.length > 20, "phrase affichable");
  for (const k of ["document", "existant", "modele", "metres", "plans", "plan", "releve"]) assert.ok(!(k in r), `un refus ne rend pas « ${k} »`);
};

test("création : le relevé reçu n'est pas modifié, il est copié en entier, et le document s'enregistre tel quel", () => {
  const R = REF(), avant = JSON.stringify(R);
  geler(R);                                   // toute écriture dans le relevé lèverait une erreur
  const D = creer(R);
  assert.equal(JSON.stringify(R), avant, "relevé d'entrée intact");
  assert.deepEqual(D.releve_brut, R, "le relevé d'origine est dans le document, à l'identique");
  assert.notEqual(D.releve_brut, R, "c'est une copie, pas le même objet");
  assert.notEqual(D.releve_brut.pieces[0].polygone, R.pieces[0].polygone, "copie profonde");
  assert.deepEqual(JSON.parse(JSON.stringify(D)), D, "aller-retour JSON identique");
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(D))), JSON.stringify(D));
  assert.deepEqual([D.format, D.version, D.cree_le, D.existant.fige_le], [FORMAT_DOCUMENT_PLAN, VERSION_DOCUMENT_PLAN, QUAND, QUAND]);
  assert.deepEqual(D.source, SOURCE);
  assert.deepEqual(D.algorithmes, { releve: VERSION_RELEVE, redressement: VERSION_REDRESSEMENT, modele: VERSION_MODELE_PLAN }, "versions des algorithmes notées");
  assert.deepEqual(D.tolerances, { redressement: { ...TOLERANCES_REDRESSEMENT }, murs: { ...TOLERANCES_MURS } }, "tolérances utilisées notées");
  assert.deepEqual([D.projet, D.equipements, D.notes, D.traits, D.reglages], [{ modifications: [] }, [], [], [], { cotes: {} }], "emplacements du projet prévus, vides");
  // Deux créations identiques : rien ne dépend de l'heure ni d'un tirage.
  assert.equal(JSON.stringify(creer(REF())), JSON.stringify(D));
});

test("existant figé : c'est le relevé redressé, enregistré ; les points à valider aussi, avec leur état", () => {
  const R = REF(), X = redresserReleve(R), D = creer(R);
  assert.ok(X.corrections.length > 0 && X.points_a_valider.length > 0, "le relevé de référence a des corrections et des points à valider");
  assert.deepEqual(existantDuDocument(D), X.releve, "existant du document = relevé redressé");
  assert.notDeepEqual(existantDuDocument(D).pieces, D.releve_brut.pieces, "l'existant n'est pas le relevé brut");
  assert.deepEqual(D.redressement.corrections, X.corrections);
  assert.deepEqual(D.redressement.bilan, X.bilan);
  assert.deepEqual(D.redressement.points.map(({ etat, decide_le, effet, ...p }) => p), X.points_a_valider, "points à valider enregistrés en entier (correction comprise)");
  assert.ok(D.redressement.points.every((p) => p.etat === "a_valider" && p.decide_le === null));
});

test("ouvrir un plan ne relance pas le redressement : l'existant lu est exactement celui enregistré", () => {
  // Simulation d'un plan figé par une AUTRE version de l'algorithme : son
  // existant n'est pas celui que le redressement actuel produirait.
  const D = copie(creer());
  D.algorithmes.redressement = VERSION_REDRESSEMENT + 1;
  D.existant.releve.pieces[0].polygone[0] = [D.existant.releve.pieces[0].polygone[0][0] + 0.05, D.existant.releve.pieces[0].polygone[0][1] - 0.03];
  D.existant.releve.pieces[1].nom = "Pièce renommée";
  const attendu = copie(D.existant.releve);
  const O = ouvrirDocumentPlan(geler(D));
  assert.equal(O.ok, true, O.erreur);
  const { points, scanners, ...lu } = O.existant;
  assert.deepEqual(lu, attendu, "existant lu = existant enregistré, au chiffre près");
  assert.notDeepEqual(O.existant.pieces[0].polygone, redresserReleve(D.releve_brut).releve.pieces[0].polygone, "ce n'est pas un recalcul");
  assert.deepEqual(O.avertissements.map((a) => a.code), ["redressement_version"], "le changement de version est dit, pas appliqué");
  assert.deepEqual(O.metres, calculerMetres(O.existant), "métrés calculés sur l'existant enregistré");
  // Sans changement de version : aucun avertissement.
  assert.deepEqual(ouvrirDocumentPlan(creer()).avertissements, []);
  // Tolérances choisies à la création : notées, et réutilisées à l'ouverture.
  const large = creer(REF(), { tolerances: { redressement: { deplacementMax: 0.002 }, murs: { recouvrementMin: 1.5 } } });
  assert.equal(large.tolerances.redressement.deplacementMax, 0.002);
  assert.equal(large.tolerances.murs.recouvrementMin, 1.5);
  assert.deepEqual(existantDuDocument(large), redresserReleve(REF(), { tolerances: { deplacementMax: 0.002 }, tolerancesMurs: { recouvrementMin: 1.5 } }).releve);
  assert.notDeepEqual(existantDuDocument(large), existantDuDocument(creer()), "d'autres tolérances donnent un autre existant");
  const ML = ouvrirDocumentPlan(large).modele;
  assert.deepEqual(ML.tolerances, large.tolerances.murs, "modèle ouvert avec les tolérances enregistrées");
  assert.deepEqual(ML, construireModeleExistant(existantDuDocument(large), { tolerances: { recouvrementMin: 1.5 } }));
  assert.notDeepEqual(ML.existant.murs, construireModeleExistant(existantDuDocument(large)).existant.murs, "et pas avec celles par défaut");
});

test("ouvrir : relevé brut, existant, modèle, métrés de l'existant, points à valider", () => {
  const R = REF(), X = redresserReleve(R), D = creer(R), avant = JSON.stringify(D);
  const O = ouvrirDocumentPlan(geler(D));
  assert.equal(JSON.stringify(D), avant, "document non modifié par l'ouverture");
  assert.deepEqual(O.releve_brut, R);
  assert.deepEqual(O.existant, X.releve);
  assert.deepEqual(O.modele, construireModeleExistant(X.releve), "modèle = construireModeleExistant(existant)");
  assert.deepEqual(O.metres, calculerMetres(X.releve), "métrés = calculerMetres(relevé redressé)");
  const textes = (m) => [...m.pieces, m.total].flatMap((l) => ["sol", "perimetre", "plafond", "murs_bruts", "plinthes", "murs_nets"].map((k) => texteMetre(l[k], l.approx?.[k], l.raison)));
  assert.deepEqual(textes(O.metres), textes(calculerMetres(X.releve)), "mêmes métrés affichés");
  assert.deepEqual(O.points_a_valider.map((p) => p.cle), X.points_a_valider.map((p) => p.cle));
  assert.equal(O.points.length, X.points_a_valider.length);
  assert.deepEqual(O.ecart_origine, bilanDeplacement(R, X.releve), "écart cumulé depuis le relevé d'origine");
  assert.deepEqual(ouvrirDocumentPlan(D), O, "deux ouvertures identiques");
});

test("les mesures brutes ne sont stockées qu'une fois : taille du document raisonnable", () => {
  const R = REF(), D = creer(R), mesures = taille(R.points) + taille(R.scanners);
  assert.ok(mesures > 0.6 * taille(R), "les mesures brutes pèsent l'essentiel du relevé");
  for (const k of MESURES_BRUTES) assert.ok(!(k in D.existant.releve), `« ${k} » absent de l'existant enregistré`);
  assert.deepEqual(D.existant.mesures_reprises, MESURES_BRUTES);
  const unScan = JSON.stringify(Object.values(R.points)[0]);
  assert.ok(unScan.length > 1000, "un scan porte des centaines de points");
  assert.equal(JSON.stringify(D).split(unScan).length - 1, 1, "les points de mesure n'apparaissent qu'une fois dans le document");
  // L'existant garde la pleine précision du redressement (ses nombres sont
  // plus longs que ceux du relevé) : il reste petit devant les mesures brutes.
  assert.ok(taille(D.existant) < 0.5 * mesures, `existant de ${taille(D.existant)} caractères, mesures brutes ${mesures}`);
  assert.ok(taille(D) < 1.5 * taille(R), `document de ${taille(D)} caractères pour un relevé de ${taille(R)}`);
  // À la lecture, l'existant les retrouve, identiques à celles du relevé d'origine.
  const O = ouvrirDocumentPlan(D);
  assert.deepEqual([O.existant.points, O.existant.scanners], [R.points, R.scanners]);
  assert.deepEqual(O.existant, redresserReleve(R).releve);
  // Relevé sans mesures : rien n'est inventé.
  const sans = REF(); delete sans.points; delete sans.scanners;
  const D2 = creer(sans);
  assert.deepEqual(D2.existant.mesures_reprises, []);
  assert.ok(!("points" in ouvrirDocumentPlan(D2).existant));
});

test("la base range les clés dans son ordre : le plan relu est le même", () => {
  const D = creer(), relu = commeLaBase(D);
  assert.notEqual(JSON.stringify(relu), JSON.stringify(D), "l'ordre des clés a bien changé");
  assert.deepEqual(relu, D);
  const A = ouvrirDocumentPlan(D), B = ouvrirDocumentPlan(relu);
  assert.deepEqual([B.existant, B.modele, B.metres, B.points_a_valider, B.ecart_origine], [A.existant, A.modele, A.metres, A.points_a_valider, A.ecart_origine]);
  // Le texte JSON (ce que renvoie certaines lectures) est accepté aussi.
  assert.deepEqual(ouvrirDocumentPlan(JSON.stringify(D)).metres, A.metres);
});

test("accepter un point : sa correction est appliquée à l'existant, et rien d'autre ne bouge", () => {
  const D = creer(), avant = JSON.stringify(D);
  geler(D);
  const point = D.redressement.points.find((p) => p.applicable);
  const existant = existantDuDocument(D);
  const prevu = mesurerEffetPoint(D, point.cle);
  assert.deepEqual([prevu.ok, prevu.applicable, prevu.casse], [true, true, false]);
  assert.ok(Math.abs(prevu.deplacement_m - point.deplacement_m) < 1e-5, "à la création, l'effet mesuré est l'ampleur annoncée");
  const r = accepterPoint(D, point.cle, { maintenant: "2026-11-25T10:00:00.000Z" });
  assert.equal(r.ok, true, r.erreur);
  assert.equal(JSON.stringify(D), avant, "document d'entrée non modifié");
  const N = r.document;
  assert.deepEqual(existantDuDocument(N), appliquerPointRedressement(existant, point), "existant = correction du point appliquée");
  assert.deepEqual(N.releve_brut, D.releve_brut, "relevé d'origine intact");
  const p = N.redressement.points.find((x) => x.cle === point.cle);
  assert.deepEqual([p.etat, p.decide_le], ["accepte", "2026-11-25T10:00:00.000Z"]);
  assert.ok(p.effet.deplacement_m > 0 && Math.abs(p.effet.deplacement_m - prevu.deplacement_m) < 1e-12, "effet réel noté sur le point");
  assert.deepEqual(N.redressement.points.filter((x) => x.cle !== point.cle), D.redressement.points.filter((x) => x.cle !== point.cle), "les autres points ne changent pas");
  assert.deepEqual([N.redressement.corrections, N.redressement.bilan, N.tolerances, N.algorithmes], [D.redressement.corrections, D.redressement.bilan, D.tolerances, D.algorithmes]);
  assert.deepEqual(JSON.parse(JSON.stringify(N)), N, "le nouveau document s'enregistre tel quel");
  // À l'ouverture : un point de moins à valider, métrés recalculés sur le nouvel existant,
  // et l'écart cumulé se mesure toujours depuis le relevé d'origine.
  const O = ouvrirDocumentPlan(N), O0 = ouvrirDocumentPlan(D);
  assert.equal(O.points_a_valider.length, O0.points_a_valider.length - 1);
  assert.deepEqual(O.metres, calculerMetres(existantDuDocument(N)));
  assert.notDeepEqual(O.metres.total, O0.metres.total, "accepter un point change les métrés (question 5 : oui)");
  assert.deepEqual(O.ecart_origine, bilanDeplacement(D.releve_brut, existantDuDocument(N)));
  assert.ok(O.ecart_origine.deplacement_max_m >= O0.ecart_origine.deplacement_max_m);
  // Un point déjà traité ne se rejoue pas.
  refus(accepterPoint(N, point.cle), "point_deja_traite");
  refus(refuserPoint(N, point.cle), "point_deja_traite");
  refus(rouvrirPoint(N, point.cle), "point_non_refuse");
  refus(accepterPoint(D, "redressement:inconnu"), "point_introuvable");
});

test("refuser un point : rien ne bouge ; il peut être remis à valider", () => {
  const D = geler(creer()), point = D.redressement.points[0];
  const r = refuserPoint(D, point.cle, { maintenant: "2026-11-25T11:00:00.000Z" });
  assert.equal(r.ok, true, r.erreur);
  assert.deepEqual(r.document.existant, D.existant, "existant inchangé");
  assert.deepEqual(r.document.releve_brut, D.releve_brut);
  assert.deepEqual(r.document.redressement.points.map((p) => p.etat), ["refuse", ...D.redressement.points.slice(1).map(() => "a_valider")]);
  assert.equal(ouvrirDocumentPlan(r.document).points_a_valider.length, D.redressement.points.length - 1, "un point refusé ne s'affiche plus à valider");
  assert.equal(ouvrirDocumentPlan(r.document).points.length, D.redressement.points.length, "mais il reste dans le document");
  refus(accepterPoint(r.document, point.cle), "point_deja_traite");
  const rouvert = rouvrirPoint(r.document, point.cle);
  assert.equal(rouvert.ok, true);
  assert.deepEqual(rouvert.document, verifierDocumentPlan(D).document, "remis à valider : le document d'avant le refus");
  refus(rouvrirPoint(D, point.cle), "point_non_refuse");
});

test("point sans correction automatique : il ne s'accepte pas, il se refuse", () => {
  const D = copie(creer());
  Object.assign(D.redressement.points[0], { applicable: false, correction: null, deplacement_m: null, rotation_deg: null });
  const cle = D.redressement.points[0].cle;
  refus(accepterPoint(D, cle), "point_non_applicable");
  assert.deepEqual(mesurerEffetPoint(D, cle), { ok: true, applicable: false, deplacement_m: null, rotation_deg: null, casse: false });
  assert.equal(refuserPoint(D, cle).ok, true);
});

test("accepter les points un par un : l'existant reste sain, le relevé d'origine intact, jamais de pièce déformée", () => {
  let D = creer();
  const brut = JSON.stringify(D.releve_brut), bilan = { acceptes: 0, refuses: 0 };
  for (const { cle, applicable } of D.redressement.points) {
    if (!applicable) continue;
    const avant = existantDuDocument(D);
    const r = accepterPoint(D, cle, { maintenant: QUAND });
    if (!r.ok) {
      // Devenu inapplicable après les corrections précédentes : dit, et rien n'a bougé.
      refus(r, "point_inapplicable");
      assert.equal(mesurerEffetPoint(D, cle).casse, true);
      bilan.refuses++;
      continue;
    }
    bilan.acceptes++;
    D = r.document;
    const apres = existantDuDocument(D);
    avant.pieces.forEach((p, i) => {
      const m = mesurerEcart(p.polygone, apres.pieces[i].polygone);
      assert.ok(!m.renverses.some(Boolean), `${cle} : aucun côté renversé`);
      apres.pieces[i].polygone.flat().forEach((v) => assert.ok(Number.isFinite(v), "coordonnées finies"));
    });
  }
  assert.ok(bilan.acceptes > 0, "au moins un point accepté");
  assert.equal(JSON.stringify(D.releve_brut), brut, "relevé d'origine intact après toutes les acceptations");
  const O = ouvrirDocumentPlan(D);
  assert.equal(O.ok, true, O.erreur);
  assert.equal(O.points.filter((p) => p.etat === "accepte").length, bilan.acceptes);
  assert.equal(O.modele.existant.pieces.length, D.releve_brut.pieces.length, "toutes les pièces sont encore là");
  assert.ok(O.ecart_origine.deplacement_max_m > TOLERANCES_REDRESSEMENT.deplacementMax, "l'écart cumulé depuis l'origine dépasse la tolérance : c'est l'utilisateur qui l'a décidé");
  console.log(`    ${bilan.acceptes} point(s) accepté(s), ${bilan.refuses} devenu(s) inapplicable(s) — exemple issu des tests, données fictives`);
});

test("corriger l'existant à la main (hauteur, nom) : le relevé d'origine ne change pas, les mesures ne sont pas recopiées", () => {
  const D = geler(creer()), existant = existantDuDocument(D);
  const corrige = { ...existant, pieces: existant.pieces.map((p, i) => (i === 0 ? { ...p, hsp: 3.1, hsp_statut: "mesuree", nom: "Séjour corrigé" } : p)) };
  const r = remplacerExistant(D, corrige);
  assert.equal(r.ok, true, r.erreur);
  assert.deepEqual(existantDuDocument(r.document), corrige);
  assert.deepEqual(r.document.releve_brut, D.releve_brut);
  for (const k of MESURES_BRUTES) assert.ok(!(k in r.document.existant.releve));
  const m0 = ouvrirDocumentPlan(D).metres.pieces[0], m1 = ouvrirDocumentPlan(r.document).metres.pieces[0];
  assert.ok(m1.murs_bruts > m0.murs_bruts && m1.sol === m0.sol, "les métrés suivent l'existant corrigé");
  refus(remplacerExistant(D, { ...existant, points: { 1: [[0, 0]] } }), "mesures_modifiees");
  refus(remplacerExistant(D, null), "releve_illisible");
});

test("document illisible, incomplet ou d'une version inconnue : erreur explicite, jamais un plan vide", () => {
  const D = creer();
  const sans = (chemin) => { const c = copie(D); let o = c; chemin.slice(0, -1).forEach((k) => { o = o[k]; }); delete o[chemin[chemin.length - 1]]; return c; };
  const essais = [
    [null, "document_illisible"], [undefined, "document_illisible"], [{}, "document_illisible"], [[], "document_illisible"],
    ["ceci n'est pas du JSON", "document_illisible"], [42, "document_illisible"],
    // Contenu d'un plan de l'ancien éditeur : ce n'est pas un document du nouvel éditeur.
    [{ segments: [], symbols: [], viewport: { x: 0, y: 0, scale: 1 }, releve: REF() }, "document_illisible"],
    [{ ...D, format: "autre" }, "document_illisible"],
    [{ ...D, version: VERSION_DOCUMENT_PLAN + 1 }, "version_inconnue"], [{ ...D, version: 0 }, "version_inconnue"],
    [{ ...D, version: "1" }, "version_inconnue"], [sans(["version"]), "version_inconnue"],
    [sans(["releve_brut"]), "document_incomplet"], [{ ...D, releve_brut: { pieces: null } }, "document_incomplet"],
    [sans(["existant"]), "document_incomplet"], [sans(["existant", "releve"]), "document_incomplet"],
    [sans(["redressement"]), "document_incomplet"], [sans(["redressement", "points"]), "document_incomplet"],
    [{ ...D, redressement: { ...D.redressement, points: [{ ...D.redressement.points[0], etat: "peut-etre" }] } }, "document_incomplet"],
    [{ ...D, equipements: "aucun" }, "document_incomplet"], [{ ...D, projet: { modifications: {} } }, "document_incomplet"],
    [{ ...D, existant: { ...D.existant, mesures_reprises: ["pieces"] } }, "document_incomplet"],
  ];
  for (const [data, code] of essais) {
    for (const fn of [verifierDocumentPlan, ouvrirDocumentPlan, resumerDocumentPlan]) refus(fn(data), code);
    refus(accepterPoint(data, "x"), code);
  }
  // Document vérifié mais incalculable : dit aussi, au lieu d'un plan faux.
  refus(ouvrirDocumentPlan({ ...D, existant: { ...D.existant, releve: { ...D.existant.releve, pieces: [null] } } }), "document_incalculable");
});

test("lecture tolérante : les emplacements facultatifs absents sont complétés, rien d'autre n'est inventé", () => {
  const D = copie(creer());
  for (const k of ["projet", "equipements", "notes", "traits", "reglages", "tolerances", "algorithmes", "source", "cree_le"]) delete D[k];
  delete D.existant.fige_le;
  D.redressement.points.forEach((p) => { delete p.etat; delete p.decide_le; delete p.effet; });
  delete D.redressement.corrections;
  const O = ouvrirDocumentPlan(geler(D));
  assert.equal(O.ok, true, O.erreur);
  assert.deepEqual([O.document.projet, O.document.equipements, O.document.notes, O.document.traits, O.document.reglages], [{ modifications: [] }, [], [], [], { cotes: {} }]);
  assert.deepEqual(O.document.tolerances, { redressement: {}, murs: {} });
  assert.ok(O.points.every((p) => p.etat === "a_valider"), "un point sans état est à valider");
  assert.deepEqual(O.avertissements.map((a) => a.code), ["redressement_version"], "version du redressement non notée : dit");
  assert.deepEqual(O.existant, existantDuDocument(creer()), "l'existant, lui, est lu tel quel");
});

test("création refusée : relevé illisible ou sans pièce, origine non indiquée", () => {
  const R = REF();
  refus(creerDocumentPlan({ releve: null, source: SOURCE, maintenant: QUAND }), "releve_illisible");
  refus(creerDocumentPlan({ releve: { pieces: "?" }, source: SOURCE, maintenant: QUAND }), "releve_illisible");
  refus(creerDocumentPlan({ releve: { ...R, pieces: [] }, source: SOURCE, maintenant: QUAND }), "releve_sans_piece");
  refus(creerDocumentPlan({ releve: R, maintenant: QUAND }), "source_inconnue");
  refus(creerDocumentPlan({ releve: R, source: { type: "copie" }, maintenant: QUAND }), "source_inconnue");
  refus(creerDocumentPlan({ releve: R, source: { type: "ancien_plan" }, maintenant: QUAND }), "source_inconnue");
  refus(creerDocumentPlan(), "releve_illisible");
  assert.deepEqual(creer(R, { source: { type: "import_imapper", autre: 1 } }).source, { type: "import_imapper" });
});

test("résumé pour la liste : pièces, surface des métrés, points restants", () => {
  const D = creer(), O = ouvrirDocumentPlan(D);
  const r = resumerDocumentPlan(D);
  assert.equal(r.ok, true, r.erreur);
  assert.deepEqual(r.resume, {
    version: VERSION_DOCUMENT_PLAN, source: "ancien_plan", pieces: D.releve_brut.pieces.length,
    surface_sol_m2: O.metres.total.sol, ouvertures: O.existant.ouvertures.length,
    points_a_valider: O.points_a_valider.length, points_acceptes: 0, points_refuses: 0,
  });
  assert.equal(texteMetre(r.resume.surface_sol_m2), texteMetre(O.metres.total.sol), "même chiffre, même service");
  const cles = D.redressement.points.filter((p) => p.applicable).map((p) => p.cle);
  const suite = refuserPoint(accepterPoint(D, cles[0]).document, cles[1]).document;
  const r2 = resumerDocumentPlan(suite).resume;
  assert.deepEqual([r2.points_a_valider, r2.points_acceptes, r2.points_refuses], [O.points_a_valider.length - 2, 1, 1]);
  // Ouvertures pas encore relevées : null, pas zéro.
  assert.equal(resumerDocumentPlan(creer({ ...REF(), ouvertures: null })).resume.ouvertures, null);
});

test("version du redressement : le résultat sur le relevé de référence ne change pas sans changer de numéro", () => {
  // Empreinte du relevé redressé (au micromètre), des corrections et des points.
  const X = redresserReleve(REF()), mic = (v) => (v == null ? v : Math.round(v * 1e6) / 1e6 + 0);
  const empreinte = crypto.createHash("sha256").update(JSON.stringify({
    pieces: X.releve.pieces.map((p) => [p.id, p.polygone.map((s) => s.map(mic))]),
    murs: X.releve.murs.map((m) => m.polygone.map((s) => s.map(mic))),
    ouvertures: X.releve.ouvertures.map((o) => [o.id, mic(o.t0), mic(o.t1)]),
    corrections: X.corrections.map((c) => c.cle),
    points: X.points_a_valider.map((p) => [p.cle, p.raison, p.applicable]),
  })).digest("hex");
  const FIGE = { 1: "70e60899b6c47325c6d6632140333ef6bc3c1838318b346329d2fcb323a1d6bf" };
  assert.ok(VERSION_REDRESSEMENT in FIGE, `VERSION_REDRESSEMENT = ${VERSION_REDRESSEMENT} : ajouter son empreinte ici (${empreinte})`);
  assert.equal(empreinte, FIGE[VERSION_REDRESSEMENT],
    "le redressement donne un autre résultat sur le relevé de référence : augmenter VERSION_REDRESSEMENT (planV2Redressement.mjs) et ajouter la nouvelle empreinte, pour que les plans déjà créés sachent que leur existant vient d'une version précédente");
});

// ── Requêtes : faux client de base (aucune base contactée) ─────────────────
// Chaque `.from(table)` est noté avec la suite de ses appels ; `repondre`
// décide de la réponse ({ data, error }) d'après cette suite.
function fauxClient(repondre) {
  const appels = [];
  return {
    appels,
    client: {
      from(table) {
        const appel = { table, ops: [] };
        appels.push(appel);
        const q = new Proxy({}, {
          get(_, nom) {
            if (nom === "then") return (res, rej) => Promise.resolve().then(() => repondre(appel)).then(res, rej);
            return (...args) => { appel.ops.push([nom, ...args]); return q; };
          },
        });
        return q;
      },
    },
  };
}
const noms = (appel) => appel.ops.map((o) => o[0]);
const arg = (appel, nom) => appel.ops.find((o) => o[0] === nom)?.slice(1);
const ECRITURES = ["insert", "update", "upsert", "delete", "rpc"];
const acces = (repondre) => { const f = fauxClient(repondre); return { ...f, A: creerAccesPlans({ client: f.client, auteur: async () => "bureau@test.fr" }) }; };

test("requêtes : la liste ne charge pas les documents ; une erreur remonte, sans liste vide à sa place", async () => {
  const lignes = [{ id: "p1", nom: "Plan fictif", updated_at: "2026-11-25T09:00:00+00:00" }];
  const ok = acces(() => ({ data: lignes, error: null }));
  assert.deepEqual(await ok.A.listerPlans({ chantierId: "CH-TEST" }), { ok: true, plans: lignes });
  assert.deepEqual([ok.appels[0].table, noms(ok.appels[0])], ["plans_v2", ["select", "order", "eq"]]);
  assert.deepEqual(arg(ok.appels[0], "select"), [COLONNES_PLAN]);
  assert.ok(!/\bdata\b|\*/.test(COLONNES_PLAN), "la liste ne demande pas la colonne data");
  assert.deepEqual(arg(ok.appels[0], "eq"), ["chantier_id", "CH-TEST"]);
  await ok.A.listerPlans();
  assert.deepEqual(noms(ok.appels[1]), ["select", "order"], "sans chantier : tous les plans");
  const ko = acces(() => ({ data: null, error: { message: "permission denied for table plans_v2", code: "42501" } }));
  for (const r of [await ko.A.listerPlans(), await ko.A.lirePlan("p1"), await ko.A.listerAnciensPlansAvecReleve(), await ko.A.lireReleveAncienPlan("a1"), await ko.A.supprimerPlan("p1")]) {
    refus(r, "base");
    assert.match(r.erreur, /permission denied/);
  }
  const panne = acces(() => { throw new Error("Failed to fetch"); });
  refus(await panne.A.listerPlans(), "reseau");
  refus(await acces(() => ({ data: null, error: null })).A.lirePlan("p1"), "introuvable");
});

test("requêtes : créer un plan — chantier obligatoire, document lisible, résumé écrit avec le document", async () => {
  const D = creer();
  const f = acces((appel) => ({ data: { id: "p1", ...arg(appel, "insert")[0], data: undefined }, error: null }));
  refus(await f.A.creerPlan({ chantierId: "", nom: "Plan", document: D }), "chantier_absent");
  refus(await f.A.creerPlan({ chantierId: "  ", nom: "Plan", document: D }), "chantier_absent");
  refus(await f.A.creerPlan({ chantierId: "CH-TEST", nom: " ", document: D }), "nom_absent");
  refus(await f.A.creerPlan({ chantierId: "CH-TEST", nom: "Plan", document: {} }), "document_illisible");
  assert.equal(f.appels.length, 0, "aucun refus n'a touché la base");
  const r = await f.A.creerPlan({ chantierId: " CH-TEST ", nom: " Plan fictif ", logement: "Appt 1", document: D });
  assert.equal(r.ok, true, r.erreur);
  assert.deepEqual([f.appels[0].table, noms(f.appels[0])], ["plans_v2", ["insert", "select", "single"]]);
  assert.deepEqual(arg(f.appels[0], "insert")[0], {
    chantier_id: "CH-TEST", nom: "Plan fictif", logement: "Appt 1", data: D, resume: resumerDocumentPlan(D).resume,
    origine_plan_id: SOURCE.plan_id, cree_par: "bureau@test.fr", modifie_par: "bureau@test.fr",
  });
  const imp = acces(() => ({ data: {}, error: null }));
  await imp.A.creerPlan({ chantierId: "CH-TEST", nom: "Plan", document: creer(REF(), { source: { type: "import_imapper" } }) });
  assert.equal(arg(imp.appels[0], "insert")[0].origine_plan_id, null, "import direct : pas d'ancien plan d'origine");
  const inconnu = acces(() => ({ data: null, error: { code: "23503", message: "violates foreign key constraint" } }));
  refus(await inconnu.A.creerPlan({ chantierId: "CH-ABSENT", nom: "Plan", document: D }), "chantier_inconnu");
});

test("requêtes : enregistrer n'écrase pas une version plus récente", async () => {
  const D = creer(), connu = "2026-11-25T09:00:00.123456+00:00", nouveau = "2026-11-25T09:05:00.654321+00:00";
  // 1. Personne n'a enregistré entre-temps : une ligne modifiée, nouvelle date rendue.
  const ok = acces(() => ({ data: [{ id: "p1", updated_at: nouveau }], error: null }));
  assert.deepEqual(await ok.A.enregistrerPlan({ id: "p1", document: D, updatedAtConnu: connu }), { ok: true, plan: { id: "p1", updated_at: nouveau } });
  assert.deepEqual([ok.appels[0].table, noms(ok.appels[0])], ["plans_v2", ["update", "eq", "eq", "select"]]);
  assert.deepEqual(ok.appels[0].ops.filter((o) => o[0] === "eq").map((o) => o.slice(1)), [["id", "p1"], ["updated_at", connu]], "l'écriture exige la date de la version ouverte");
  assert.deepEqual(arg(ok.appels[0], "update")[0], { data: D, resume: resumerDocumentPlan(D).resume, modifie_par: "bureau@test.fr" }, "document entier + résumé, la date est posée par la base");
  // 2. Quelqu'un a enregistré entre-temps : aucune ligne modifiée → conflit, avec qui et quand.
  const conflit = acces((appel) => (noms(appel)[0] === "update" ? { data: [], error: null } : { data: { id: "p1", updated_at: nouveau, modifie_par: "autre@test.fr" }, error: null }));
  const r = await conflit.A.enregistrerPlan({ id: "p1", document: D, updatedAtConnu: connu });
  assert.equal(r.ok, false);
  assert.equal(r.code, "conflit");
  assert.match(r.erreur, /modifié ailleurs.*autre@test\.fr.*n'a pas été enregistrée/);
  assert.deepEqual(r.serveur, { updated_at: nouveau, modifie_par: "autre@test.fr" });
  assert.deepEqual(conflit.appels.map((a) => noms(a)[0]), ["update", "select"], "une seule tentative d'écriture, puis une lecture pour expliquer");
  // 3. Le plan a disparu.
  const disparu = acces((appel) => (noms(appel)[0] === "update" ? { data: [], error: null } : { data: null, error: null }));
  refus(await disparu.A.enregistrerPlan({ id: "p1", document: D, updatedAtConnu: connu }), "introuvable");
  // 4. Sans la date de la version ouverte : refus, la base n'est pas contactée.
  const sans = acces(() => ({ data: [], error: null }));
  refus(await sans.A.enregistrerPlan({ id: "p1", document: D }), "version_ouverte_inconnue");
  refus(await sans.A.enregistrerPlan({ id: "p1", document: { format: "plan_v2", version: 99 }, updatedAtConnu: connu }), "version_inconnue");
  assert.equal(sans.appels.length, 0);
  // 5. Écrasement voulu (action explicite) : pas de comparaison de date.
  const force = acces(() => ({ data: [{ id: "p1", updated_at: nouveau }], error: null }));
  assert.equal((await force.A.enregistrerPlan({ id: "p1", document: D, forcer: true })).ok, true);
  assert.deepEqual(noms(force.appels[0]), ["update", "eq", "select"]);
});

test("requêtes : renommer, supprimer — et dire quand rien n'a été touché", async () => {
  const f = acces((appel) => ({ data: [{ id: "p1", ...(arg(appel, "update")?.[0] || {}) }], error: null }));
  assert.deepEqual((await f.A.renommerPlan({ id: "p1", nom: " Nouveau nom " })).plan, { id: "p1", nom: "Nouveau nom", modifie_par: "bureau@test.fr" });
  assert.deepEqual(arg(f.appels[0], "update")[0], { nom: "Nouveau nom", modifie_par: "bureau@test.fr" }, "le document n'est pas réécrit");
  assert.deepEqual((await f.A.renommerPlan({ id: "p1", logement: "RDC" })).plan.logement, "RDC");
  refus(await f.A.renommerPlan({ id: "p1", nom: "" }), "nom_absent");
  refus(await f.A.renommerPlan({ id: "p1" }), "rien_a_changer");
  assert.deepEqual(await f.A.supprimerPlan("p1"), { ok: true });
  assert.deepEqual([f.appels[2].table, noms(f.appels[2])], ["plans_v2", ["delete", "eq", "select"]]);
  const rien = acces(() => ({ data: [], error: null }));
  refus(await rien.A.renommerPlan({ id: "p1", nom: "X" }), "introuvable");
  refus(await rien.A.supprimerPlan("p1"), "introuvable");
});

test("requêtes : l'ancienne table n'est que lue — relevé seul, filtré par la base", async () => {
  const R = REF();
  const f = acces((appel) => {
    if (appel.table !== "plans") return { data: [{ id: "p1", updated_at: "x" }], error: null };
    return noms(appel).includes("maybeSingle")
      ? { data: { id: "a1", name: "Ancien plan fictif", chantier_id: "", updated_at: "2026-11-01T08:00:00+00:00", releve: R }, error: null }
      : { data: [{ id: "a1", name: "Ancien plan fictif", chantier_id: "", updated_at: "2026-11-01T08:00:00+00:00" }], error: null };
  });
  const liste = await f.A.listerAnciensPlansAvecReleve();
  assert.equal(liste.plans.length, 1);
  assert.deepEqual(arg(f.appels[0], "select"), ["id, name, chantier_id, updated_at"], "aucun contenu de plan chargé pour la liste");
  assert.deepEqual(arg(f.appels[0], "not"), ["data->releve->pieces", "is", null], "filtre fait par la base");
  const lu = await f.A.lireReleveAncienPlan("a1");
  assert.deepEqual(lu, { ok: true, ancien: { id: "a1", name: "Ancien plan fictif", chantier_id: "", updated_at: "2026-11-01T08:00:00+00:00" }, releve: R });
  assert.deepEqual(arg(f.appels[1], "select"), ["id, name, chantier_id, updated_at, releve:data->releve"], "le relevé seul, ni dessin ni miniature");
  // Parcours complet d'une copie, puis toutes les autres opérations : sur
  // l'ancienne table, il n'y a eu que des lectures.
  const D = creerDocumentPlan({ releve: lu.releve, source: { type: "ancien_plan", plan_id: lu.ancien.id, plan_nom: lu.ancien.name, plan_modifie_le: lu.ancien.updated_at }, maintenant: QUAND }).document;
  refus(await f.A.creerPlan({ chantierId: lu.ancien.chantier_id, nom: lu.ancien.name, document: D }), "chantier_absent");   // ancien plan sans chantier : il faut en choisir un
  await f.A.creerPlan({ chantierId: "CH-TEST", nom: lu.ancien.name, document: D });
  await f.A.enregistrerPlan({ id: "p1", document: D, updatedAtConnu: "x" });
  await f.A.renommerPlan({ id: "p1", nom: "Y" });
  await f.A.supprimerPlan("p1");
  await f.A.listerPlans();
  await f.A.lirePlan("p1");
  const anciens = f.appels.filter((a) => a.table === "plans");
  assert.equal(anciens.length, 2);
  for (const a of anciens) {
    assert.equal(noms(a)[0], "select");
    assert.ok(!noms(a).some((n) => ECRITURES.includes(n)), `aucune écriture dans l'ancienne table (${noms(a).join(", ")})`);
  }
  assert.deepEqual([...new Set(f.appels.map((a) => a.table))].sort(), ["plans", "plans_v2"], "aucune autre table");
  assert.ok(f.appels.filter((a) => a.table === "plans_v2").some((a) => noms(a).includes("insert")), "les écritures vont dans la nouvelle table");
  // Ancien plan sans relevé : dit, pas un relevé vide.
  const vide = acces(() => ({ data: { id: "a2", name: "Sans relevé", chantier_id: "CH-TEST", updated_at: "x", releve: null }, error: null }));
  refus(await vide.A.lireReleveAncienPlan("a2"), "sans_releve");
  refus(await acces(() => ({ data: null, error: null })).A.lireReleveAncienPlan("a3"), "introuvable");
});

let ok = 0;
for (const [nom, fn] of cas) {
  try { await fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${ok}/${cas.length} vérifications document du plan (nouvel éditeur)`);
