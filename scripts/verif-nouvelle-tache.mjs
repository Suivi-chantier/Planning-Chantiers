#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Vérification — « Nouvelle tâche » proposée par l'ouvrier (étape 3b,
// livraison 2 : le parcours). Données FICTIVES de test.
//
//   1. Écran ouvrier : liste des ouvrages, recherche, ce qui manque (photo
//      obligatoire pour une demande du client), ligne produite.
//   2. Envoi : format de la ligne (origine « nouvelle » + proposition),
//      tache_id / phase_id vides, contrôle de la journée.
//   3. Brouillon relu par l'ancien formulaire : tâche libre + texte.
//   4. Validation : création dans l'ouvrage proposé, changement d'ouvrage,
//      Divers, rattachement à une tâche existante, « ne pas créer »,
//      identifiant stable (validation relancée = pas de doublon), découpage.
//   5. Pointages IDENTIQUES à ceux d'une tâche libre rattachée aujourd'hui.
//   6. Conflit de révision : la VRAIE fonction serveur
//      (sql/202609_phasages_revision_verrou_optimiste.sql) dans PGlite.
//   7. Ancien formulaire et rapports existants inchangés.
//
//   node scripts/verif-nouvelle-tache.mjs
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  ORIGINE_NOUVELLE, DIVERS_HORS_DEVIS, ouvragesProposables, rechercherOuvrages, problemesNouvelleTache,
  ligneNouvelleTache, modifierNouvelleTache, saisieDepuisLigne, texteProposition, serialiserLigneV2,
  problemesLigne, etatEnvoi, carteRetirable, brouillonV2VersV1, appliquerChoix, changerMinutes, majPhotosApres,
} from "../src/Renovation/compteRenduV2.mjs";
import { serialiserLigneV1 } from "../src/Renovation/compteRenduEnvoi.mjs";
import {
  lignesDepuisRapport, taskLinesPourPointages, decouperLigne, idTacheProposee, propositionACreer,
  appliquerCreationsProposees, enregistrerCreationsProposees, tacheCreeeEnValidation, ajouterTacheDansOuvrage,
  creationParDefaut, trouverTache, ligneBasculee,
} from "../src/Renovation/lignesValidation.mjs";
import { buildPointagesRapport } from "../src/pointagesRapport.mjs";
import { construireMesPhases, texteAjoutee } from "../src/Renovation/mesPhasesV1.mjs";

let nbOk = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); nbOk++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };
let n = 0;
const genId = () => `g${++n}`;

// ── Phasage fictif ──────────────────────────────────────────────────────────
const PAYLOAD = {
  modele: "v2", prenom: "Paul", phases: [
    { id: "g1", nom: "Cloisons", ordre: 1, ouvrages: [
      { id: "o1", libelle: "Doublage des murs périphériques en plaque de plâtre BA13 sur ossature", code: "DBL-01", taches: [{ id: "t1", nom: "Ossature" }] },
      { id: "o2", libelle: "Électricité", code: null, taches: [{ id: "t2", nom: "Saignées" }] },
    ] },
    { id: "g2", nom: "Finitions", ordre: 2, ouvrages: [
      { id: "o1", libelle: "Doublage des murs périphériques en plaque de plâtre BA13 sur ossature", code: "DBL-01", taches: [{ id: "t3", nom: "Bandes" }] },
    ] },
    { id: "_a_organiser", nom: "À organiser", synthetique: true, ouvrages: [
      { id: "o3", libelle: "Carrelage sol", code: "CAR-02", taches: [] },
    ] },
  ],
};
const PHASES = construireMesPhases(PAYLOAD).phases;

// ── 1. Écran ouvrier ────────────────────────────────────────────────────────
const liste = ouvragesProposables(PHASES);
eq(liste.map(o => o.id), ["o1", "o2", "o3", null], "un ouvrage par id, « Divers / hors devis » (à créer) en dernier");
eq(liste[0].phases, ["Cloisons", "Finitions"], "ouvrage sur deux phases : les deux noms");
eq(liste[2].phases, [], "« À organiser » n'est pas une phase affichée");
eq([liste[3].libelle, liste[3].divers], [DIVERS_HORS_DEVIS, true], "Divers absent : entrée sans id");
const avecDivers = ouvragesProposables([{ id: "g", nom: "P", ouvrages: [
  { id: "d", libelle: "  divers / HORS devis ", taches: [] }, { id: "x", libelle: "Plomberie", taches: [] }] }]);
eq(avecDivers.map(o => [o.id, o.divers]), [["x", false], ["d", true]], "Divers existant : le vrai ouvrage, en dernier, pas de doublon");
eq(rechercherOuvrages(liste, "car-02").map(o => o.id), ["o3"], "recherche par code");
eq(rechercherOuvrages(liste, "electricite").map(o => o.id), ["o2"], "recherche sans accents");
eq(rechercherOuvrages(liste, "finitions").map(o => o.id), ["o1"], "recherche par phase");

eq(problemesNouvelleTache({}), ["ouvrage", "nom", "nature"], "écran vide : ouvrage, nom, nature manquent");
const base = { ouvrage: liste[1], nom: "Prise en plus dans la cuisine", nature: "imprevu", photos: [] };
eq(problemesNouvelleTache(base), [], "imprévu : aucune photo exigée");
eq(problemesNouvelleTache({ ...base, nature: "demande_client" }), ["photo"], "demande du client sans photo : bloqué");
eq(problemesNouvelleTache({ ...base, nature: "demande_client", photos: ["https://x/p.jpg"] }), [], "demande du client avec photo : ok");
eq(problemesNouvelleTache({ ...base, nature: "inconnue" }), ["nature"], "nature hors liste refusée");
eq(problemesNouvelleTache({ ...base, nom: "   " }), ["nom"], "nom vide refusé");

// ── 2. Ligne produite et envoi ──────────────────────────────────────────────
const chantier = { id: "ch1", nom: "Chantier test", couleur: "#123456" };
const saisieClient = { ouvrage: liste[0], nom: " Niche murale ", nature: "demande_client", demandeur: " Mme Test ", photos: ["https://x/1.jpg"] };
const ligne = ligneNouvelleTache(saisieClient, chantier);
eq([ligne.tache_id, ligne.phase_id, ligne.planifie, ligne.origine, ligne.statut], [null, null, "Niche murale", ORIGINE_NOUVELLE, null], "carte : sans tâche, nom nettoyé, origine nouvelle");
eq(ligne.proposition, { ouvrage_id: "o1", ouvrage_libelle: liste[0].libelle, nature: "demande_client", demandeur: "Mme Test" }, "proposition complète");
eq(ligneNouvelleTache({ ...base, ouvrage: liste[3], demandeur: "" }, chantier).proposition,
  { ouvrage_id: null, ouvrage_libelle: DIVERS_HORS_DEVIS, nature: "imprevu" }, "Divers à créer : ouvrage_id vide, pas de demandeur vide");
ok(carteRetirable(ligne), "la carte peut être retirée avant l'envoi");

// Terminé : photo « après » jointe (étape 4), en plus de la photo de la demande.
const remplie = majPhotosApres(changerMinutes(appliquerChoix(ligne, "termine"), 90), ["https://x/apres.jpg"]);
eq(problemesLigne(remplie, {}), [], "carte remplie (terminé, 1 h 30, photo) : complète");
eq(problemesLigne({ ...remplie, photos: [] }, {}), ["photo", "photo_apres"], "toutes les photos retirées de la carte : demande du client ET photo « après » redeviennent bloquantes");
eq(problemesLigne({ ...remplie, photos: [], proposition: { ...remplie.proposition, nature: "reprise" } }, {}), ["photo_apres"], "reprise sans aucune photo : seule la photo « après » (Terminé) manque");
const envoi = etatEnvoi({ taches: [{ ...remplie, photos: [] }], trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 1.5 });
eq([envoi.peutEnvoyer, envoi.phrase], [false, "Complète 1 tâche pour envoyer"], "envoi bloqué tant que la photo manque");
ok(etatEnvoi({ taches: [remplie], trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 1.5 }).peutEnvoyer, "avec la photo : envoi possible");
// Pas de jauge ni de motif de dépassement : aucune tâche du phasage derrière.
eq(problemesLigne(changerMinutes(remplie, 600), { t1: { heures_vendues: 1, heures_validees: 5, avancement: 10 } }), [], "jamais de motif de dépassement demandé");

const ecrite = serialiserLigneV2(remplie);
eq([ecrite.tache_id, ecrite.phase_id, ecrite.origine, ecrite.heures_reelles, ecrite.statut, ecrite.photos],
  [null, null, ORIGINE_NOUVELLE, 1.5, "faite", ["https://x/1.jpg", "https://x/apres.jpg"]], "ligne envoyée : tache_id et phase_id vides");
eq(ecrite.proposition, ligne.proposition, "proposition envoyée telle quelle");
const { origine: _o, proposition: _p, photos_apres: _pa, ...socle } = ecrite;
eq(socle, serialiserLigneV1(remplie), "en dehors de origine, proposition et photos_apres : exactement le format historique");

const modifiee = modifierNouvelleTache(remplie, { ...saisieClient, ouvrage: liste[2], nature: "oubli_phasage", nom: "Niche" });
eq([modifiee.statut, modifiee.heures_reelles, modifiee.planifie, modifiee.proposition.ouvrage_id, modifiee.proposition.nature],
  [remplie.statut, remplie.heures_reelles, "Niche", "o3", "oubli_phasage"], "« Modifier » garde temps et statut, change ouvrage et nature");
const relue = saisieDepuisLigne(ligne, liste);
eq([relue.ouvrage.id, relue.nom, relue.nature, relue.demandeur, relue.photos], ["o1", "Niche murale", "demande_client", "Mme Test", ["https://x/1.jpg"]], "« Modifier » rouvre l'écran prérempli");
eq(saisieDepuisLigne(ligneNouvelleTache({ ...base, ouvrage: liste[3] }, chantier), liste).ouvrage.id, null, "Divers à créer retrouvé");

// ── 3. Brouillon relu par l'ancien formulaire ───────────────────────────────
const [v1] = brouillonV2VersV1([{ ...remplie, remarque: "côté fenêtre" }]);
ok(v1.libre === true && !("proposition" in v1) && !("origine" in v1), "ancien formulaire : tâche libre, champs v2 retirés");
eq(v1.remarque, "Nouvelle tâche dans « " + liste[0].libelle + " » — Demande du client (demandée par Mme Test) — côté fenêtre",
  "l'ouvrage, la nature et le demandeur passent dans la remarque, rien n'est perdu");
eq([v1.chantier_id, v1.planifie, v1.photos], ["ch1", "Niche murale", ["https://x/1.jpg", "https://x/apres.jpg"]], "chantier, nom et photos gardés");
eq(texteProposition({ ouvrage_libelle: "", nature: null }), `Nouvelle tâche dans « ${DIVERS_HORS_DEVIS} »`, "texte sans nature");

// ── 4. Validation ───────────────────────────────────────────────────────────
const RAPPORT = {
  id: "r-1", ouvrier: "Paul", chantier_id: "ch1",
  taches: [
    { planifie: "Ossature", tache_id: "t1", phase_id: null, statut: "faite", heures_reelles: 2, avancement: 100, photos: [], remarque: "" },
    ecrite,
    serialiserLigneV2(changerMinutes(appliquerChoix(ligneNouvelleTache({ ...base, ouvrage: liste[3] }, chantier), "en_cours"), 60)),
  ],
};
RAPPORT.taches[2].avancement = 40;
const lignes = lignesDepuisRapport(RAPPORT);
ok(!("proposition" in lignes[0]) && !("creation" in lignes[0]), "ligne du planning : aucun champ ajouté");
eq(lignes[1].creation, { nom: "Niche murale", ouvrage_id: "o1", nature: "demande_client", hors_devis: true }, "demande du client : confirmée par défaut, hors devis coché");
eq(lignes[2].creation, { nom: "Prise en plus dans la cuisine", ouvrage_id: null, nature: "imprevu", hors_devis: true }, "imprévu dans Divers : hors devis coché");
eq(creationParDefaut({ planifie: "x", proposition: { nature: "reprise" } }).hors_devis, false, "reprise : hors devis décoché");
eq(creationParDefaut({ planifie: "x", proposition: { nature: "oubli_phasage" } }).hors_devis, false, "oubli du phasage : hors devis décoché");
ok(propositionACreer(lignes[1]) && !propositionACreer(lignes[0]), "seules les propositions sont à créer");

const OUVRAGES = () => [
  { id: "o1", libelle: liste[0].libelle, heures_devis: 40, taches: [{ id: "t1", nom: "Ossature", heures_vendues: 10 }, { id: "t3", nom: "Bandes" }] },
  { id: "o2", libelle: "Électricité", heures_devis: 20, taches: [{ id: "t2", nom: "Saignées" }] },
  { id: "o3", libelle: "Carrelage sol", heures_devis: 12, taches: [] },
];
n = 0;
const res = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes, rapport: RAPPORT, genId });
eq([res.modifie, res.erreurs, res.creees.length, res.reprises.length], [true, [], 2, 0], "deux tâches créées, aucune erreur");
const idNiche = idTacheProposee("r-1", 1);
eq(idNiche, "nt-r-1-1", "identifiant dérivé du rapport et de la ligne");
const niche = trouverTache(res.ouvrages, idNiche);
eq(niche.ouvrage.id, "o1", "création DANS L'OUVRAGE PROPOSÉ");
eq(niche.tache, {
  id: idNiche, nom: "Niche murale", heures_estimees: null, heures_reelles: null, avancement: 0, ouvriers: ["Paul"],
  date_prevue: null, _cree_depuis_validation: true, nature: "demande_client", hors_devis: true, cree_par: "Paul", cree_depuis_rapport: "r-1",
}, "tâche créée : nom, nature, hors devis, auteur, rapport d'origine, sans heures vendues");
ok(!("heures_vendues" in niche.tache), "aucune heure vendue");
const divers = res.ouvrages.find(o => o.libelle === DIVERS_HORS_DEVIS);
eq([divers?.id, divers?.taches.map(t => t.id)], ["g1", ["nt-r-1-2"]], "Divers absent : créé avec la tâche (comme avant)");
eq(res.lignes.slice(1).map(l => [l.tache_id, l.phase_id, l.ouvrage_id]), [[idNiche, null, "o1"], ["nt-r-1-2", null, "g1"]], "lignes rattachées, phase vide");
eq(res.lignes[0], lignes[0], "la ligne du planning n'est pas touchée");
eq(OUVRAGES()[0].taches.length, 2, "aucune mutation des données d'entrée");
eq(res.ouvrages.slice(0, 3).map(o => o.heures_devis), [40, 20, 12], "heures vendues des ouvrages inchangées");

// Relance (pointages en échec, conducteur qui revalide, « Corriger » puis revalidation)
const relance = appliquerCreationsProposees({ ouvrages: res.ouvrages, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId });
eq([relance.modifie, relance.creees.length, relance.reprises.length], [false, 0, 2], "validation relancée : tâches RETROUVÉES, rien de recréé");
eq(relance.ouvrages, res.ouvrages, "phasage strictement identique");
eq(relance.lignes.map(l => l.tache_id), res.lignes.map(l => l.tache_id), "mêmes rattachements");
// Même si le conducteur a déplacé la tâche entre-temps : retrouvée là où elle est.
const deplacee = res.ouvrages.map(o => ({ ...o, taches: (o.taches || []).filter(t => t.id !== idNiche) }));
deplacee[2].taches = [...deplacee[2].taches, niche.tache];
eq(appliquerCreationsProposees({ ouvrages: deplacee, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId }).lignes[1].ouvrage_id, "o3", "tâche déplacée depuis : retrouvée dans son nouvel ouvrage");

// Changement d'ouvrage et de nature par le conducteur
const change = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, creation: { ...l.creation, ouvrage_id: "o3", nature: "oubli_phasage", hors_devis: false } } : l);
const resC = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: change, rapport: RAPPORT, genId });
const nicheC = trouverTache(resC.ouvrages, idNiche);
eq([nicheC.ouvrage.id, nicheC.tache.nature, nicheC.tache.hors_devis], ["o3", "oubli_phasage", false], "CHANGEMENT D'OUVRAGE et de nature respectés");
// Nom corrigé par le conducteur
const renom = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, creation: { ...l.creation, nom: "Niche murale salon" } } : l);
eq(trouverTache(appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: renom, rapport: RAPPORT, genId }).ouvrages, idNiche).tache.nom, "Niche murale salon", "nom corrigé par le conducteur");

// Rattachement à une tâche existante (doublon) : rien n'est créé
const ratt = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, tache_id: "t3", ouvrage_id: "o1", planifie: "Bandes" } : l);
ok(!propositionACreer(ratt[1]), "ligne rattachée : plus à créer");
const resR = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: ratt, rapport: RAPPORT, genId });
eq([trouverTache(resR.ouvrages, idNiche), resR.lignes[1].tache_id, resR.creees.length], [null, "t3", 1], "RATTACHEMENT : la tâche existante est pointée, la proposée n'est pas créée");
// « Ne pas créer » : la ligne reste libre
const libre = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, creation: null } : l);
const resL = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: libre, rapport: RAPPORT, genId });
eq([resL.lignes[1].tache_id, trouverTache(resL.ouvrages, idNiche)], [null, null], "« ne pas créer » : ligne libre, rien créé");

// Ouvrage disparu : erreur visible, rien d'écrit
const disparu = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, creation: { ...l.creation, ouvrage_id: "o-supprime" } } : l);
const resD = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: disparu, rapport: RAPPORT, genId });
eq(resD.erreurs.map(e => e.code), ["ouvrage_introuvable"], "ouvrage proposé disparu : ERREUR, jamais de repli silencieux dans Divers");
const nomVide = lignesDepuisRapport(RAPPORT).map((l, i) => i === 1 ? { ...l, creation: { ...l.creation, nom: " " }, planifie: "" } : l);
eq(appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: nomVide, rapport: RAPPORT, genId }).erreurs.map(e => e.code), ["nom_vide"], "nom vidé : erreur");

// Divers déjà présent : la tâche y va, aucun second Divers
const avecD = [...OUVRAGES(), { id: "dv", libelle: "Divers / hors devis", taches: [{ id: "old" }] }];
const resDv = appliquerCreationsProposees({ ouvrages: avecD, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId });
eq([resDv.ouvrages.length, resDv.ouvrages[3].taches.map(t => t.id)], [4, ["old", "nt-r-1-2"]], "Divers existant réutilisé");

// Découpage d'une ligne proposée : une seule tâche, les deux moitiés y pointent
const [m1, m2] = decouperLigne(lignesDepuisRapport(RAPPORT)[1], "s1");
const resS = appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: [m1, m2], rapport: RAPPORT, genId });
eq([resS.creees.length, resS.reprises.length, resS.lignes.map(l => l.tache_id)], [1, 1, [idNiche, idNiche]], "ligne découpée : UNE tâche, deux moitiés rattachées");

// Bascule vers un autre chantier : la proposition ne suit pas, elle passe en texte
const basc = ligneBasculee({ ...lignesDepuisRapport(RAPPORT)[1], remarque: "côté fenêtre" }, { heures: 1, rapport: RAPPORT, valideur: "Bureau", le: "2026-10-06" });
ok(!("proposition" in basc) && !("origine" in basc) && basc.tache_id === null, "bascule : ligne libre sur le chantier cible");
eq(basc.remarque, `Nouvelle tâche dans « ${liste[0].libelle} » — Demande du client (demandée par Mme Test) — côté fenêtre`, "bascule : ouvrage et nature gardés en texte");
eq(ligneBasculee({ ...lignes[0], remarque: "r" }, { heures: 1, rapport: RAPPORT, valideur: "B", le: "x" }).remarque, "r", "bascule d'une ligne ordinaire : remarque inchangée");

// Fenêtre « + Créer nouvelle tâche » (ligne libre) : même fabrique
const tFen = tacheCreeeEnValidation({ id: "z", nom: " Seuil ", nature: null, hors_devis: false, ouvrier: "Paul", rapportId: "r-9" });
eq(tFen, { id: "z", nom: "Seuil", heures_estimees: null, heures_reelles: null, avancement: 0, ouvriers: ["Paul"], date_prevue: null,
  _cree_depuis_validation: true, hors_devis: false, cree_par: "Paul", cree_depuis_rapport: "r-9" }, "fenêtre : nature non renseignée, case décochée");
eq(ajouterTacheDansOuvrage(OUVRAGES(), "o2", tFen, genId).ouvrages[1].taches.map(t => t.id), ["t2", "z"], "fenêtre : dans l'ouvrage choisi");
eq(ajouterTacheDansOuvrage(OUVRAGES(), "zz", tFen, genId).erreur, "ouvrage_introuvable", "fenêtre : ouvrage disparu refusé");

// Affichage après validation (onglet Phases et panneau)
eq(texteAjoutee({ cree_par: "Paul", nature: "demande_client" }), "Ajoutée par Paul · Demande du client", "« Ajoutée par … · nature »");
eq(texteAjoutee({ cree_par: "Paul" }), "Ajoutée par Paul", "sans nature");
eq(texteAjoutee({ nom: "Ossature" }), "", "tâche du devis : rien");

// ── 5. Pointages identiques à une tâche libre rattachée aujourd'hui ─────────
// Même journée saisie (a) en nouvelle tâche proposée, créée à la validation,
// (b) en texte libre, rattachée par le conducteur via « + Créer nouvelle
// tâche » à une tâche de même id. Les pointages doivent être identiques.
const pointages = (lignesV) => buildPointagesRapport({
  chantier_id: "ch1", ouvrier: "Paul", dateISO: "2026-10-06", taux: 30, phasage_id: "ph1", rapport_id: "r-1", valide_par: "Bureau",
  taskLines: taskLinesPourPointages(lignesV), indirectLines: [{ motif: "Rangement", heures: 0.5 }],
  trajetMinTotal: 50, nbChantiersDuJour: 1, rangRapport: 0, heuresParRapportDuJour: [4],
});
const rapportLibre = { ...RAPPORT, taches: RAPPORT.taches.map(t => {
  if (t.origine !== ORIGINE_NOUVELLE) return t;
  const { origine, proposition, ...l } = t; return { ...l, origine: "libre" };
}) };
const lignesLibres = lignesDepuisRapport(rapportLibre).map((l, i) => i === 0 ? l
  : { ...l, tache_id: res.lignes[i].tache_id, phase_id: null, ouvrage_id: res.lignes[i].ouvrage_id });
eq(pointages(res.lignes), pointages(lignesLibres), "POINTAGES IDENTIQUES à une ligne libre rattachée");
eq(pointages(res.lignes).filter(p => p.tache_id).map(p => [p.tache_id, p.heures, p.phase_id]),
  [["t1", 2, null], [idNiche, 1.5, null], ["nt-r-1-2", 1, null]], "chaque nouvelle tâche reçoit ses heures, phase vide");

// ── 6. Conflit de révision : vraie fonction serveur dans PGlite ─────────────
const racine = fileURLToPath(new URL("..", import.meta.url));
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
  create extension if not exists plpgsql;
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.email() returns text language sql stable as $$ select 'conducteur@test.fr'::text $$;
  create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create table public.utilisateurs (email text, role text, actif boolean);
  insert into public.utilisateurs values ('conducteur@test.fr', 'conducteur', true);
  create table public.phasages (id uuid primary key, chantier_id text, ouvrages jsonb, plan_travaux jsonb, updated_at timestamptz);
`);
await db.exec(readFileSync(join(racine, "sql/202609_phasages_revision_verrou_optimiste.sql"), "utf8"));
const PH = "11111111-1111-1111-1111-111111111111";
await db.query(`insert into public.phasages (id, chantier_id, ouvrages, plan_travaux) values ($1, 'ch1', $2, '{}'::jsonb)`, [PH, JSON.stringify(OUVRAGES())]);
// Même traduction que sauvegarderPhasage (phasageEcriture.mjs).
const sauvegarder = async ({ phasageId, revision, ouvrages }) => {
  const { rows } = await db.query(`select public.conducteur_sauvegarder_phasage_v2($1, $2, $3, null) as v`, [phasageId, revision, JSON.stringify(ouvrages)]);
  const data = rows[0].v;
  if (!data) return { ok: false, code: "refuse" };
  if (data.ok === true) return { ok: true, code: "enregistre", revision: data.revision };
  return { ok: false, code: data.code === "conflit" ? "conflit" : "erreur", revision: data.revision };
};
const lire = async () => (await db.query(`select ouvrages, revision from public.phasages where id = $1`, [PH])).rows[0];
const charge = { id: PH, chantier_id: "ch1", ...(await lire()) };
eq(Number(charge.revision), 0, "phasage chargé en révision 0");
// Quelqu'un modifie le phasage (Phasage V2, autre validation) après le chargement.
await sauvegarder({ phasageId: PH, revision: 0, ouvrages: [...OUVRAGES(), { id: "o9", libelle: "Ajout bureau", taches: [] }] });
const conflit = await enregistrerCreationsProposees({ phasage: charge, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId, sauvegarder });
eq([conflit.ok, conflit.code], [false, "conflit"], "CONFLIT DE RÉVISION détecté par le serveur");
const apresConflit = await lire();
eq([trouverTache(apresConflit.ouvrages, idNiche), apresConflit.ouvrages.length, Number(apresConflit.revision)], [null, 4, 1], "conflit : rien écrit, la modification du bureau est intacte");
// Rechargement de la version récente puis nouvelle validation.
const recharge = { id: PH, chantier_id: "ch1", ...apresConflit };
const ok1 = await enregistrerCreationsProposees({ phasage: recharge, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId, sauvegarder });
eq([ok1.ok, ok1.ecrit, Number(ok1.phasage.revision)], [true, true, 2], "après rechargement : enregistré, révision suivante");
const enBase = await lire();
eq([trouverTache(enBase.ouvrages, idNiche)?.ouvrage.id, enBase.ouvrages.some(o => o.id === "o9")], ["o1", true], "tâche créée ET ajout du bureau conservé");
// Validation relancée sur le phasage à jour : aucune écriture, aucun doublon.
const ok2 = await enregistrerCreationsProposees({ phasage: { id: PH, ...enBase }, lignes: lignesDepuisRapport(RAPPORT), rapport: RAPPORT, genId, sauvegarder });
eq([ok2.ok, ok2.ecrit, Number((await lire()).revision)], [true, false, 2], "relance : rien réécrit (révision inchangée)");
eq((await lire()).ouvrages.flatMap(o => o.taches || []).filter(t => t.id === idNiche).length, 1, "une seule tâche en base");
// Pas de propositions : la fonction ne fait rien.
const rien = await enregistrerCreationsProposees({ phasage: null, lignes: [lignes[0]], rapport: RAPPORT, genId, sauvegarder });
eq([rien.ok, rien.ecrit], [true, false], "rapport sans proposition : aucun appel");
eq((await enregistrerCreationsProposees({ phasage: { id: PH, ouvrages: [] }, lignes, rapport: RAPPORT, genId, sauvegarder })).code, "sans_ouvrages", "chantier sans ouvrages : refus clair");

// ── 7. Ancien formulaire, rapports existants ────────────────────────────────
const ancien = { id: "r-v1", taches: [
  { planifie: "Ossature", tache_id: "t1", phase_id: null, statut: "faite", heures_reelles: 3, avancement: 100, photos: [], remarque: "" },
  { planifie: "Libre", tache_id: null, phase_id: null, statut: "en_cours", heures_reelles: 2, avancement: 20, photos: [], remarque: "x" },
] };
ok(lignesDepuisRapport(ancien).every(l => !("proposition" in l) && !("creation" in l)), "rapport existant : lignes identiques à avant");
eq(appliquerCreationsProposees({ ouvrages: OUVRAGES(), lignes: lignesDepuisRapport(ancien), rapport: ancien, genId }).modifie, false, "rapport existant : aucune création");
// Une ligne « nouvelle » sans proposition (donnée abîmée) reste une ligne libre.
ok(!("proposition" in lignesDepuisRapport({ id: "r", taches: [{ planifie: "x", origine: "nouvelle" }] })[0]), "origine sans proposition : ligne libre");
const sources = ["src/Renovation/RapportMobile.jsx", "src/Renovation/Validation.jsx"].map(f => readFileSync(join(racine, f), "utf8"));
ok(/onAjouterNouvelle=\{ajouterNouvelleTache\}/.test(sources[0]) && /estV2 && panneauAutreChose/.test(sources[0]), "écran Nouvelle tâche branché sur le seul formulaire v2");
ok(/if \(li\.proposition\) return li;/.test(sources[1]), "Validation : pas de rattachement automatique d'une proposition");
ok(/plan_travaux: plan, revision: resPlan\.revision/.test(sources[1]), "Validation V1 : la révision suit l'écriture (défaut corrigé)");

console.log(`verif-nouvelle-tache : ${nbOk} contrôles OK`);
