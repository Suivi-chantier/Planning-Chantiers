#!/usr/bin/env node
// Vérifie le pré-remplissage de la fiche de préparation sécurité (tâche 6 du
// projet docs/projets/fiche-securite-chantier.md) :
//   - chaque règle de la spécification (points 1 à 12) ;
//   - règle d'inconnu : donnée manquante = « à compléter » avec la raison,
//     jamais « non concerné » ;
//   - conversion semaine + jour du planning → date (semaine 53, changement
//     d'année) ;
//   - ordre des risques proposés au point 3 ;
//   - divergences avec la fiche enregistrée ;
//   - « Appliquer la proposition » n'enlève jamais une saisie ;
//   - module pur, façade, branchement de l'écran et de la couche données.
//
// Exemples issus des tests, données fictives : chantiers, ouvrages, noms et
// dates sont inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-preremplissage.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POINTS_FICHE, DECLENCHEURS_PRE_REMPLISSAGE as D } from "../src/Renovation/securite/points.mjs";
import { parseCodeOuvrage } from "../src/Renovation/codeOuvrage.mjs";
import {
  proposerPreRemplissage, divergencesPreRemplissage, appliquerProposition, estampillerProposition, propositionDejaAppliquee,
  dateDepuisSemaineJour, nbSemainesIso, ouvrageDeclenche, aidesManutention, texteAidesManutention, texteJoursIsoles,
} from "../src/Renovation/securitePreRemplissage.mjs";
import { formulaireFiche, contenuAEnregistrer } from "../src/Renovation/securiteFiche.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ─── Exemples issus des tests, données fictives ──────────────────────────────
const LOTS = [
  { id: "demolition", label: "Démolition" }, { id: "maconnerie", label: "Maçonnerie" },
  { id: "electricite", label: "Électricité" }, { id: "murs_cloison", label: "Murs cloison" },
  { id: "plomberie", label: "Plomberie" }, { id: "lot_1783409027948", label: "Plafond" },
];
const BAT = { date_permis_construire: "1985-03-01", etage: 2, ascenseur_utilisable: false, reperage_amiante_statut: "a_demander" };
const RESS = { liste: [
  { nom: "Ouvrier A", nom_planning: "Ouvrier A", kind: "personne" },
  { nom: "Ouvrier B", nom_planning: "Ouvrier B", kind: "personne" },
  { nom: "Sous-traitant X", nom_planning: "Presta X", kind: "prestataire" },
], erreur: null };
const ouv = (lot_id, libelle, dates = []) => ({ lot_id, libelle, taches: dates.map((d) => ({ date_prevue: d })) });
const cel = (week_id, jour, ouvriers) => ({ week_id, jour, ouvriers });
const base = (surcharges = {}) => ({
  batiment: { ligne: BAT, erreur: null },
  phasage: { ouvrages: [
    ouv("demolition", "D-016 : Dépose de WC (fictif)", ["2026-12-09", "2026-12-08"]),
    ouv("murs_cloison", "MU-002 : Cloison fictive"),
    ouv("lot_1783409027948", "PL-002 : Faux-plafond fictif"),
    ouv("electricite", "E-001 : Installation fictive"),
  ], erreur: null },
  planning: { cellules: [
    cel("2026-W50", "Lundi", ["Ouvrier A", "Ouvrier B"]),
    cel("2026-W50", "Mardi", ["Ouvrier A"]),
    cel("2026-W51", "Jeudi", ["Presta X"]),
  ], erreur: null },
  planningOperation: { cellules: [cel("2026-W50", "Mardi", ["Ouvrier B"])], erreur: null },
  ressources: RESS,
  commandes: { lignes: [], erreur: null },
  lots: LOTS,
  fiche: { intervenants: [], donnees_base: {}, reponses: {} },
  ...surcharges,
});
const P = (s) => proposerPreRemplissage(base(s)).points;

test("1. configuration : règle « concerné si » sur les 12 points, codes déclencheurs lisibles", () => {
  assert.equal(POINTS_FICHE.length, 12);
  POINTS_FICHE.forEach((p) => assert.ok(typeof p.concerneSi === "string" && p.concerneSi.length > 20, `point ${p.numero}`));
  for (const regle of [D.chuteHauteur, D.poussieres, D.deposeSanitaires]) {
    for (const c of regle.codes) assert.ok(/^[A-Z]+$/.test(c) || parseCodeOuvrage(c), `code lisible : ${c}`);
  }
  assert.equal(D.lotDemolition, "demolition");
  assert.equal(D.lotElectricite, "electricite");
  assert.deepEqual([...D.poussieres.lots], ["demolition", "maconnerie", "murs_cloison"]);
  // Aucun code d'ouvrage écrit en dur dans le module de calcul.
  const mod = sansCommentaires(lire("src/Renovation/securitePreRemplissage.mjs"));
  assert.ok(!/"(PL|COUV|D-0\d\d|ME-0\d\d|S-00\d)"/.test(mod), "codes seulement dans points.mjs");
});

test("2. semaine + jour du planning → date (semaine 53, changement d'année, refus)", () => {
  assert.equal(dateDepuisSemaineJour("2026-W50", "Lundi"), "2026-12-07");
  assert.equal(dateDepuisSemaineJour("2026-W50", "vendredi"), "2026-12-11", "jour sans majuscule");
  assert.equal(dateDepuisSemaineJour("2026-W53", "Jeudi"), "2026-12-31", "2026 a 53 semaines");
  assert.equal(dateDepuisSemaineJour("2026-W01", "Lundi"), "2025-12-29", "la semaine 1 commence en 2025");
  assert.equal(dateDepuisSemaineJour("2020-W53", "Vendredi"), "2021-01-01");
  assert.equal(dateDepuisSemaineJour("2026-W42", "Mardi"), "2026-10-13");
  assert.equal(nbSemainesIso(2026), 53);
  assert.equal(nbSemainesIso(2027), 52);
  assert.equal(dateDepuisSemaineJour("2027-W53", "Lundi"), null, "2027 n'a que 52 semaines");
  assert.equal(dateDepuisSemaineJour("2026-W00", "Lundi"), null);
  assert.equal(dateDepuisSemaineJour("2026-W50", "Lundy"), null);
  assert.equal(dateDepuisSemaineJour("", "Lundi"), null);
});

test("3. règle d'inconnu : aucune source → jamais « non concerné », raisons explicites", () => {
  const r = proposerPreRemplissage({ lots: LOTS });
  r.liste.forEach((p) => assert.notEqual(p.statut_propose, "non_concerne", `point ${p.numero} : ${p.raison_proposition}`));
  const e = proposerPreRemplissage({
    batiment: { ligne: null, erreur: "réseau" }, phasage: { ouvrages: null, erreur: "délai dépassé" },
    planning: { cellules: null, erreur: "refus" }, ressources: { liste: null, erreur: "refus" }, commandes: { lignes: null, erreur: "refus" }, lots: LOTS,
  }).points;
  for (const k of ["p4", "p5", "p7", "p8", "p9", "p12"]) assert.equal(e[k].statut_propose, "a_completer", k);
  assert.match(e.p4.raison_proposition, /Date du permis inconnue/);
  assert.match(e.p5.raison_proposition, /Phasage illisible \(délai dépassé\)/);
  assert.match(e.p9.raison_proposition, /Planning illisible/);
  assert.match(texteAidesManutention(e.p8.valeurs.aides), /commandes illisibles/);
  const sans = P({ phasage: { ouvrages: null, erreur: null } });
  assert.equal(sans.p5.statut_propose, "a_completer");
  assert.match(sans.p5.raison_proposition, /Pas de phasage pour ce chantier/);
  assert.equal(sans.p7.statut_propose, "a_completer");
  const vide = P({ phasage: { ouvrages: [], erreur: null } });
  assert.match(vide.p5.raison_proposition, /Phasage sans ouvrage/);
  assert.equal(vide.p2.applicable, false, "rien à appliquer au point 2 sans phasage");
  assert.equal(sans.p5.applicable, false, "une proposition « à compléter » n'a rien à appliquer");
});

test("4. point 4 amiante : avant / après le 1er juillet 1997, date inconnue", () => {
  assert.equal(P().p4.statut_propose, "concerne");
  assert.match(P().p4.raison_proposition, /Permis du 01\/03\/1985, antérieur au 1er juillet 1997/);
  const apres = P({ batiment: { ligne: { ...BAT, date_permis_construire: "1997-07-01" }, erreur: null } }).p4;
  assert.equal(apres.statut_propose, "non_concerne");
  const inconnue = P({ batiment: { ligne: { ...BAT, date_permis_construire: null }, erreur: null } }).p4;
  assert.equal(inconnue.statut_propose, "a_completer");
  assert.match(inconnue.raison_proposition, /Date du permis de construire inconnue/);
  const jamais = P({ batiment: { ligne: null, erreur: null } }).p4;
  assert.match(jamais.raison_proposition, /jamais saisies/);
});

test("5. point 5 chute de hauteur : codes, lot Plafond, mots seulement sans code", () => {
  assert.equal(P().p5.statut_propose, "concerne");
  const r = D.chuteHauteur;
  assert.equal(ouvrageDeclenche(ouv("demolition", "D-14 : Dépose d'un faux-plafond"), r).detail, "D-14", "D-14 = D-014");
  assert.equal(ouvrageDeclenche(ouv("menuiserie", "ME-033 : Fenêtre PVC"), r).par, "code");
  assert.equal(ouvrageDeclenche(ouv("murs_cloison", "Faux-plafond SDB"), r).par, "mot", "ouvrage sans code : mot du libellé");
  assert.equal(ouvrageDeclenche(ouv("electricite", "E-006 : Point lumineux plafonnier, plafond"), r), null, "un code non listé fait foi, même si le libellé dit « plafond »");
  assert.equal(ouvrageDeclenche(ouv("murs_cloison", "Pose de plafonniers"), r), null, "« plafonnier » n'est pas « plafond »");
  assert.equal(ouvrageDeclenche(ouv("lot_1783409027948", "Ossature"), r).par, "lot");
  const sansHauteur = P({ phasage: { ouvrages: [ouv("plomberie", "P-001 : Chauffe-eau fictif"), ouv(null, "Divers / hors devis")], erreur: null } }).p5;
  assert.equal(sansHauteur.statut_propose, "non_concerne");
  assert.match(sansHauteur.raison_proposition, /parmi les 2 ouvrages du phasage/);
});

test("6. points 6 et 7 : électricité toujours concernée, poussières par lot ou carrelage / ponçage", () => {
  const p = P();
  assert.equal(p.p6.statut_propose, "concerne");
  assert.equal(p.p6.valeurs.habilitationExigee, true);
  assert.match(p.p6.raison_proposition, /habilitation électrique exigée/);
  const sansElec = P({ phasage: { ouvrages: [ouv("plomberie", "P-001 : Chauffe-eau")], erreur: null } }).p6;
  assert.equal(sansElec.statut_propose, "concerne");
  assert.equal(sansElec.valeurs.habilitationExigee, false);
  assert.equal(p.p7.statut_propose, "concerne");
  assert.deepEqual(p.p7.valeurs.lots, ["demolition", "murs_cloison"]);
  const carrelage = P({ phasage: { ouvrages: [ouv("lot_sol", "S-004 : Carrelage au sol"), ouv("plomberie", "Pose d'un carrelage mural")], erreur: null } }).p7;
  assert.equal(carrelage.statut_propose, "concerne");
  assert.equal(carrelage.valeurs.ouvrages.length, 2);
  const rien = P({ phasage: { ouvrages: [ouv("plomberie", "P-001 : Chauffe-eau")], erreur: null } }).p7;
  assert.equal(rien.statut_propose, "non_concerne");
});

test("7. point 2 : lots distincts, date de dépose = plus petite date prévue, dépose non datée", () => {
  const p = P().p2;
  assert.deepEqual(p.valeurs.lots, ["demolition", "electricite", "murs_cloison", "lot_1783409027948"], "ordre de la liste des lots");
  assert.equal(p.valeurs.date_depose_sanitaires, "2026-12-08");
  assert.match(p.raison_proposition, /dépose des sanitaires le 08\/12\/2026/);
  const sansDate = P({ phasage: { ouvrages: [ouv("demolition", "Dépose d'un WC au sol fictif")], erreur: null } }).p2;
  assert.equal(sansDate.valeurs.date_depose_sanitaires, null);
  assert.equal(sansDate.valeurs.deposeSansDate, true);
  assert.match(sansDate.raison_proposition, /aucune tâche datée/);
  // Mots « dépose » + WC seulement dans le lot démolition ou sans lot.
  const r = D.deposeSanitaires;
  assert.ok(ouvrageDeclenche(ouv(null, "Dépose lavabo fictif"), r, { exigeDepose: true }));
  assert.equal(ouvrageDeclenche(ouv("plomberie", "Dépose lavabo fictif"), r, { exigeDepose: true }), null);
  assert.equal(ouvrageDeclenche(ouv("demolition", "Pose d'un WC"), r, { exigeDepose: true }), null, "pose ≠ dépose");
  assert.ok(ouvrageDeclenche(ouv("demolition", "D-004 : Dépose totale de la salle de bain"), r, { exigeDepose: true }));
  assert.equal(ouvrageDeclenche(ouv("demolition", "D-005 : Dépose cuisine"), r, { exigeDepose: true }), null);
});

test("8. point 8 : étage sans ascenseur, rez-de-chaussée, inconnu ; quantités en aide", () => {
  assert.equal(P().p8.statut_propose, "concerne");
  const b = (x) => P({ batiment: { ligne: { ...BAT, ...x }, erreur: null } }).p8;
  assert.equal(b({ ascenseur_utilisable: true }).statut_propose, "non_concerne");
  assert.equal(b({ etage: 0 }).statut_propose, "non_concerne");
  assert.equal(b({ etage: null }).statut_propose, "a_completer");
  assert.equal(b({ ascenseur_utilisable: null }).statut_propose, "a_completer");
  const a = aidesManutention({ lignes: [
    { libelle: "PLQ PLATRE BA13 fictive", quantite: "10", unite: "U" },
    { libelle: "ODACE PLAQUE 2 POSTES", quantite: 11, unite: "U" },
    { libelle: "MORTIER SAC 25 KG", quantite: 4, unite: "U" },
    { libelle: "COLLE 25KG", quantite: 2, unite: "U" },
    { libelle: "JOINT 2KG", quantite: 1, unite: "U" },
    { libelle: "Fenêtre PVC fictive", quantite: null, unite: "U" },
  ], erreur: null });
  assert.deepEqual(a.categories.plaques.parUnite, [{ unite: "U", quantite: 10 }], "plaque d'interrupteur écartée");
  assert.deepEqual(a.categories.sacs.parUnite, [{ unite: "U", quantite: 6 }], "2 kg écarté, 25 kg compté");
  assert.equal(a.categories.menuiseries.sansQuantite, 1, "quantité absente : signalée, pas comptée 0");
  assert.match(texteAidesManutention(a), /menuiseries 1 ligne sans quantité/);
});

test("9. point 9 : jours avec une seule personne (date calculée), couverts par un collègue Profero de l'opération", () => {
  const p = P().p9;
  assert.equal(p.statut_propose, "concerne");
  // Mardi 08/12 : Ouvrier A seul sur le logement, mais Ouvrier B (Profero) sur un autre logement de l'opération → couvert.
  assert.deepEqual(p.valeurs.jours.map((j) => [j.date, j.personne]), [["2026-12-17", "Presta X"]]);
  assert.deepEqual(p.valeurs.couverts.map((j) => [j.date, j.personne, j.collegues]), [["2026-12-08", "Ouvrier A", ["Ouvrier B"]]]);
  assert.match(p.raison_proposition, /^1 jour planifié avec une seule personne sur 3 \(17\/12\/2026 Presta X\)/);
  assert.match(p.raison_proposition, /1 autre jour seul sur le logement couvert par un collègue Profero sur un autre chantier de la même opération/);
  assert.equal(texteJoursIsoles(p.valeurs.jours), "Jours avec une seule personne : 17/12/2026 (Presta X).");
  // Tous les jours seuls couverts → non concerné, la raison le dit.
  const tousCouverts = P({ planningOperation: { cellules: [cel("2026-W50", "Mardi", ["Ouvrier B"]), cel("2026-W51", "Jeudi", ["Ouvrier A"])], erreur: null } }).p9;
  assert.equal(tousCouverts.statut_propose, "non_concerne");
  assert.equal(tousCouverts.raison_proposition, "2 jours avec une seule personne sur le logement, tous couverts par un collègue Profero sur un autre chantier de la même opération (3 jours planifiés).");
  assert.deepEqual(tousCouverts.valeurs.jours, []);
  // Un prestataire sur l'autre logement ne couvre pas : ce n'est pas un ouvrier Profero.
  const presta = P({ planningOperation: { cellules: [cel("2026-W50", "Mardi", ["Presta X"])], erreur: null } }).p9;
  assert.equal(presta.statut_propose, "concerne");
  assert.deepEqual(presta.valeurs.jours.map((j) => [j.date, j.autresSurOperation, j.collegues]), [["2026-12-08", ["Presta X"], []], ["2026-12-17", [], []]]);
  // Même semaine mais autre jour : ne couvre pas.
  const autreJour = P({ planningOperation: { cellules: [cel("2026-W50", "Mercredi", ["Ouvrier B"])], erreur: null } }).p9;
  assert.equal(autreJour.valeurs.jours.length, 2);
  // Un nom absent des ressources n'est pas compté comme collègue Profero.
  const inconnu = P({ planningOperation: { cellules: [cel("2026-W50", "Mardi", ["Inconnu Z"])], erreur: null } }).p9;
  assert.equal(inconnu.valeurs.couverts.length, 0);
  // Ressources illisibles : on ne peut pas reconnaître un collègue, l'impossibilité est dite.
  const sansRess = P({ ressources: { liste: null, erreur: "refus" } }).p9;
  assert.equal(sansRess.statut_propose, "concerne");
  assert.match(sansRess.raison_proposition, /collègues Profero non reconnus/);
  // Planning de l'opération illisible : jours seuls gardés, l'impossibilité est dite.
  const opIllisible = P({ planningOperation: { cellules: null, erreur: "refus" } }).p9;
  assert.equal(opIllisible.valeurs.jours.length, 2);
  assert.match(opIllisible.raison_proposition, /planning des autres chantiers de l'opération illisible/);
  const deux = P({ planning: { cellules: [cel("2026-W50", "Lundi", ["Ouvrier A", "Ouvrier B"]), cel("2026-W50", "Lundi", ["Ouvrier A"])], erreur: null } }).p9;
  assert.equal(deux.statut_propose, "non_concerne", "deux cases du même jour : les personnes s'additionnent");
  const aucun = P({ planning: { cellules: [cel("2026-W50", "Lundi", [])], erreur: null } }).p9;
  assert.equal(aucun.statut_propose, "a_completer");
  const illisible = P({ planning: { cellules: [cel("2026-W50", "Lundi", ["A", "B"]), cel("2026-W99", "Lundi", ["A"])], erreur: null } }).p9;
  assert.equal(illisible.statut_propose, "non_concerne");
  assert.match(illisible.raison_proposition, /1 case du planning illisible \(2026-W99 Lundi\)/);
});

test("10. points 1 et 12 : Profero + prestataires du planning, coordination", () => {
  const p = P();
  assert.deepEqual(p.p1.valeurs.entreprises.map((e) => e.nom), ["Profero", "Presta X"]);
  assert.deepEqual(p.p1.valeurs.personnes, ["Ouvrier A", "Ouvrier B"]);
  assert.match(p.p1.raison_proposition, /responsable à saisir à la main/);
  assert.equal(p.p12.statut_propose, "concerne");
  const seul = P({ planning: { cellules: [cel("2026-W50", "Lundi", ["Ouvrier A", "Ouvrier B"])], erreur: null } });
  assert.equal(seul.p12.statut_propose, "non_concerne");
  const inconnu = P({ ressources: { liste: null, erreur: "refus" } });
  assert.equal(inconnu.p12.statut_propose, "a_completer", "ressources illisibles : on ne sait pas s'il y a un prestataire");
  const fiche = P({ fiche: { intervenants: [{ type: "entreprise", nom: "Profero" }, { type: "entreprise", nom: "Plâtrier fictif" }], reponses: {}, donnees_base: {} } });
  assert.equal(fiche.p12.statut_propose, "concerne");
  assert.match(fiche.p12.raison_proposition, /au point 1 de la fiche/);
});

test("11. points 10 et 11 : EPI selon les points 4, 5, 7 et le lot démolition ; sanitaires après dépose", () => {
  const p = P();
  assert.deepEqual(p.p10.valeurs.epi, ["chaussures", "gants", "masque_ffp3", "auditives", "harnais"]);
  const protege = P({ fiche: { reponses: { p5: { statut: "concerne", cases: { pirl_prevues: true } } }, donnees_base: {}, intervenants: [] } }).p10;
  assert.ok(!protege.valeurs.epi.includes("harnais"), "protection collective cochée : pas de harnais");
  const nonP7 = P({ fiche: { reponses: { p7: { statut: "non_concerne" } }, donnees_base: {}, intervenants: [] } }).p10;
  assert.ok(!nonP7.valeurs.epi.includes("masque_ffp3"), "la réponse de la fiche prime sur la proposition");
  const amiante = P({ batiment: { ligne: { ...BAT, reperage_amiante_statut: "recu_amiante_present" }, erreur: null } }).p10;
  assert.ok(amiante.valeurs.epi.includes("combinaison"));
  assert.equal(p.p11.statut_propose, "concerne");
  assert.deepEqual(p.p11.valeurs.cases, ["solution_apres_depose"]);
  assert.match(p.p11.raison_proposition, /à partir de cette date/);
  const dateFiche = P({ fiche: { donnees_base: { date_depose_sanitaires: "2026-12-01" }, reponses: {}, intervenants: [] } }).p11;
  assert.equal(dateFiche.valeurs.date_depose, "2026-12-01", "date de la fiche prioritaire");
});

test("12. point 3 : ordre amiante présent, chute de hauteur, électricité, poussières", () => {
  const tete = (p) => p.p3.valeurs.risques.map((r) => r.split(" —")[0]);
  const amiante = P({ batiment: { ligne: { ...BAT, reperage_amiante_statut: "recu_amiante_present" }, erreur: null } });
  assert.deepEqual(tete(amiante), ["Amiante présent", "Chute de hauteur", "Électricité", "Poussières et silice"]);
  assert.deepEqual(tete(P()), ["Amiante possible (bâtiment d'avant le 1er juillet 1997)", "Chute de hauteur", "Électricité", "Poussières et silice"]);
  const simple = P({ batiment: { ligne: { ...BAT, date_permis_construire: "2005-01-01" }, erreur: null },
    phasage: { ouvrages: [ouv("plomberie", "P-001 : Chauffe-eau")], erreur: null } });
  assert.deepEqual(tete(simple), ["Électricité"]);
  const inconnu = P({ batiment: { ligne: null, erreur: null } });
  assert.match(inconnu.p3.raison_proposition, /point 4 à compléter : risque non évalué/);
});

test("13. divergences avec la fiche enregistrée", () => {
  const props = proposerPreRemplissage(base());
  const fiche = {
    intervenants: [{ type: "entreprise", nom: "Profero" }],
    donnees_base: { lots: ["electricite"], date_depose_sanitaires: "2026-12-15" },
    reponses: { p7: { statut: "non_concerne" }, p6: { statut: "concerne" }, p5: { statut: "non_concerne", statut_propose: "concerne" } },
  };
  const d = divergencesPreRemplissage({ propositions: props, fiche, lots: LOTS });
  const msg = d.map((x) => `${x.numero}:${x.message}`).join("\n");
  assert.match(msg, /^1:Le planning compte maintenant le prestataire « Presta X »/m);
  assert.match(msg, /^2:Le phasage contient maintenant le lot Démolition : absent du point 2 \(revoir aussi les points 7 et 10\)/m);
  assert.match(msg, /^2:Dépose des sanitaires : la fiche dit le 15\/12\/2026, le phasage le 08\/12\/2026/m);
  assert.match(msg, /^7:.*la proposition est maintenant « Concerné », la fiche dit « Non concerné » — revoir le point 7/m);
  assert.ok(!d.some((x) => x.numero === 5), "point 5 : proposition déjà vue et tranchée, pas d'alerte");
  assert.ok(!d.some((x) => x.numero === 6), "même statut : pas d'alerte");
  assert.deepEqual(divergencesPreRemplissage({ propositions: props, fiche: { reponses: {}, intervenants: [], donnees_base: {} } }), [], "fiche vide : rien à signaler");
  const inconnu = proposerPreRemplissage(base({ phasage: { ouvrages: null, erreur: "réseau" } }));
  assert.ok(!divergencesPreRemplissage({ propositions: inconnu, fiche, lots: LOTS }).some((x) => x.numero === 7), "proposition « à compléter » : pas une divergence");
});

test("14. « Appliquer la proposition » : sur clic, n'enlève jamais rien, garde la trace", () => {
  const props = proposerPreRemplissage(base()).points;
  const ligne = { id: "f", chantier_id: "c", version: 1, statut: "brouillon", updated_at: "x",
    intervenants: [{ type: "entreprise", id: "e1", nom: "Plâtrier fictif" }],
    donnees_base: { lots: ["plomberie"], date_depose_sanitaires: "2026-12-20" },
    reponses: { p10: { statut: "concerne", cases: { casque: true }, mesures: "Casque fourni" }, p5: { statut: "non_concerne" } },
    synthese_risques: ["Risque saisi à la main"] };
  const form = formulaireFiche(ligne, () => "id-fictif");
  const gel = JSON.stringify(form);
  const ids = ["n1", "n2"];
  const f1 = appliquerProposition(form, props.p1, { nouvelId: () => ids.shift() });
  assert.deepEqual(f1.entreprises.map((e) => e.nom), ["Plâtrier fictif", "Profero", "Presta X"]);
  const f2 = appliquerProposition(f1, props.p2, {});
  assert.deepEqual(f2.donnees.lots, ["plomberie", "demolition", "electricite", "murs_cloison", "lot_1783409027948"]);
  assert.equal(f2.donnees.date_depose_sanitaires, "2026-12-08", "date remplacée seulement par le clic");
  const f3 = appliquerProposition(f2, props.p10, { auteur: "Auteur fictif", maintenant: "2026-11-25T10:00:00Z" });
  assert.deepEqual(Object.keys(f3.reponses.p10.cases).sort(), ["auditives", "casque", "chaussures", "gants", "harnais", "masque_ffp3"]);
  assert.equal(f3.reponses.p10.mesures, "Casque fourni");
  assert.equal(f3.reponses.p10.statut_propose, "concerne");
  assert.match(f3.reponses.p10.raison_proposition, /chaussures et gants/);
  assert.equal(f3.reponses.p10.maj_par, "Auteur fictif");
  const f4 = appliquerProposition(f3, props.p5, {});
  assert.equal(f4.reponses.p5.statut, "concerne", "le clic applique le statut proposé");
  const f5 = appliquerProposition(f4, props.p9, {});
  const f6 = appliquerProposition(f5, props.p9, {});
  assert.equal(f6.reponses.p9.mesures, texteJoursIsoles(props.p9.valeurs.jours), "jours ajoutés une seule fois");
  assert.equal(f6.reponses.p9.cases.jours_identifies, true);
  const f7 = appliquerProposition(f6, props.p3, {});
  assert.equal(f7.synthese[0], "Risque saisi à la main", "une ligne saisie n'est jamais remplacée");
  assert.equal(f7.synthese.length, 3);
  assert.match(f7.synthese[1], /^Amiante possible/);
  assert.equal(JSON.stringify(form), gel, "le formulaire d'origine n'est pas modifié");
  // Proposition « à compléter » : rien n'est écrit.
  const inconnu = proposerPreRemplissage(base({ batiment: { ligne: null, erreur: null } })).points;
  assert.equal(appliquerProposition(form, inconnu.p4, {}), form);
  assert.equal(propositionDejaAppliquee(form, inconnu.p4), true);
  assert.equal(propositionDejaAppliquee(f7, props.p10), true);
  assert.equal(propositionDejaAppliquee(form, props.p10), false);
  // Estampille : trace de la proposition vue, statut inchangé ; enregistrée telle quelle.
  const e = estampillerProposition(form, "p5", props.p5);
  assert.equal(e.reponses.p5.statut, "non_concerne");
  assert.equal(e.reponses.p5.statut_propose, "concerne");
  const prep = contenuAEnregistrer(e);
  assert.ok(prep.ok);
  assert.equal(prep.contenu.reponses.p5.statut_propose, "concerne");
  assert.ok(!("p1" in prep.contenu.reponses) && !("p3" in prep.contenu.reponses), "rien n'est écrit dans reponses pour les points 1 à 3 (le « n/12 » compte toute clé)");
});

test("15. module pur, façade, écran et couche données branchés (lecture statique)", () => {
  const mod = sansCommentaires(lire("src/Renovation/securitePreRemplissage.mjs"));
  assert.ok(!/supabase|new Date\(\)|Date\.now|Math\.random|fetch\(|localStorage|window\./.test(mod), "module pur");
  assert.match(lire("src/Renovation/securitePreRemplissage.js"), /export \* from "\.\/securitePreRemplissage\.mjs";/);

  const ecran = sansCommentaires(lire("src/Renovation/FicheSecuriteChantier.jsx"));
  assert.match(ecran, /proposerPreRemplissage\(\{/);
  assert.match(ecran, /divergencesPreRemplissage\(\{ propositions: propositionsEnregistrees, fiche: ligneEnregistree/, "divergences avec la fiche ENREGISTRÉE");
  assert.match(ecran, /Appliquer la proposition/);
  assert.match(ecran, /onAppliquer=\{\(\) => prop && appliquer\(prop\)\}/, "application seulement sur clic");
  assert.match(ecran, /estampillerProposition\(g, p\.cle/);
  assert.match(ecran, /Pour information : les données du chantier ne correspondent plus/, "fiche validée : information seulement");

  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  // Section du pré-remplissage seulement : de toutesLesLignes jusqu'au bloc suivant
  // (tâche 8, qui écrit des signatures et n'appartient pas au pré-remplissage).
  const debutSection = donnees.indexOf("async function toutesLesLignes");
  const finSection = donnees.indexOf("export async function", donnees.indexOf("export async function chargerDonneesPreRemplissage") + 1);
  assert.ok(debutSection >= 0, "toutesLesLignes présente");
  const section = donnees.slice(debutSection, finSection > debutSection ? finSection : undefined);
  assert.ok(section.length > 100);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(section), "pré-remplissage : lecture seule");
  assert.match(section, /loadPhasagesPourLiaison\(\[id\]\)/, "phasage lu par le service existant");
  assert.match(section, /c\.source === "migration" \|\| c\.remplace_par_id/, "bons remplacés par leur BL écartés");
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
});

console.log(`\n${n} vérifications « Fiche sécurité : pré-remplissage » réussies (exemples issus des tests, données fictives).`);
