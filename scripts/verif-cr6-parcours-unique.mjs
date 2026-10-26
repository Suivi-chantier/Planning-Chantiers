// Vérification CR-6 (partie 6A) : PARCOURS UNIQUE du compte rendu ouvrier.
//
// EXEMPLE ISSU DES TESTS, DONNÉES FICTIVES : chantier « C1 » (« Chantier
// fictif »), tâches t1…t9, ouvriers « Paul » et « Davy ». Aucune donnée de
// production, aucun accès à la base. Tout passe par le VRAI code :
//   src/Renovation/compteRenduV3.mjs   (parcours unique)
//   src/Renovation/compteRenduV2.mjs   (règles d'envoi communes)
//   src/Renovation/dicteeCrV1.mjs      (dictée : états sûrs préremplis)
//   src/Renovation/validationJourneeV1.mjs, lignesValidation.mjs,
//   src/pointagesRapport.mjs, qualiteComptesRendusV1.mjs (lecteurs existants)
//
//   node scripts/verif-cr6-parcours-unique.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V3 from "../src/Renovation/compteRenduV3.mjs";
import {
  etatAttenduCeSoir, estLignePrevue, phrasePrevu, prevuMemorise, appliquerPasCommence, libellePasCommence,
  finaliserParcours, ajouterChoixPhasage, reprendreBrouillonParcours, tachesPourLiaison, propositionsLiaison,
  lierLigneATache, creerTacheDepuisLigne, appliquerRepere, declarationsParTache, confirmerCollegue,
  serialiserLigneV3, parcoursActif,
} from "../src/Renovation/compteRenduV3.mjs";
import {
  preremplirDurees, etatEnvoi, problemesLigne, resumeManques, choixDeLigne, minutesDe, appliquerChoix,
  finaliserLignesV2, LIBELLES_PROBLEMES,
} from "../src/Renovation/compteRenduV2.mjs";
import { construireArbre } from "../src/Renovation/phasageMobileV1.mjs";
import { appliquerPropositions, propositionsCertaines } from "../src/Renovation/dicteeCrV1.mjs";
import { classerRapport, ecartsRapport } from "../src/Renovation/validationJourneeV1.mjs";
import { lignesDepuisRapport, taskLinesPourPointages } from "../src/Renovation/lignesValidation.mjs";
import { buildPointagesRapport } from "../src/pointagesRapport.mjs";
import { faitsComptesRendus } from "../src/Renovation/qualiteComptesRendusV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── Données fictives ────────────────────────────────────────────────────────
const C1 = { id: "C1", nom: "Chantier fictif", couleur: "#ccc" };
// Une ligne telle que le planning la charge (heures préremplies avec la durée prévue).
const ligne = (planifie, tache_id, heures_prevues) => preremplirDurees([{
  chantier_id: "C1", chantier_nom: "Chantier fictif", chantier_couleur: "#ccc",
  planifie, tache_id, phase_id: null, statut: null, remarque: "", pourTout: true,
  ...(heures_prevues ? { heures_prevues } : {}),
}])[0];
const INFOS = {
  t1: { id: "t1", avancement: 40, heures_estimees: 10 },
  t2: { id: "t2", avancement: 0, heures_estimees: 8 },
  t3: { id: "t3", avancement: 60, heures_estimees: 6 },
};
const journee = { trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 8 };
const envoi = (taches, parcours = true) => etatEnvoi({ taches, ...journee, infosParTache: INFOS, parcours });

// ── 1. Aucun état prérempli d'après le planning (même attendu « terminée ») ─
const attenduT2 = etatAttenduCeSoir({ prevue: { heures_jour: 8, heures_apres: 0 }, info: INFOS.t2 });
eq(attenduT2.etat, "termine", "planning : t2 attendue « terminée ce soir » (dernier jour planifié)");
const chargees = [ligne("Plaquage SDB", "t2", 8)];
eq([chargees[0].statut, choixDeLigne(chargees[0]), minutesDe(chargees[0])], [null, null, 480], "ligne chargée : heures préremplies (8 h), état NON prérempli");
eq(phrasePrevu(attenduT2), "prévu : terminée ce soir", "le prévu est seulement affiché en petit, comme repère");
eq(phrasePrevu(etatAttenduCeSoir({ prevue: null })), null, "prévu inconnu (ligne sans tâche) : aucun repère inventé");
const finT2 = finaliserParcours(chargees, { attendus: { 0: attenduT2 }, infosParTache: INFOS });
eq([finT2[0].statut, choixDeLigne(finT2[0])], [null, null], "même à l'envoi, l'état attendu n'est jamais appliqué à une tâche avec des heures");
ok(!("lignesCommePrevu" in V3) && !("prevuesNonChoisies" in V3) && !("appliquerNonFaite" in V3), "« Journée comme prévu » et « pas faites » : fonctions supprimées du module");
const RM = lire("../src/Renovation/RapportMobile.jsx");
const PC = lire("../src/Renovation/ParcoursCompteRendu.jsx");
ok(!/Journée comme prévu|Ça ne s'est pas passé comme prévu|Pourquoi pas faites/.test(RM + PC), "écran : plus de boutons « comme prévu / pas comme prévu », plus d'écran « Pourquoi pas faites ? »");
ok(!/AccueilJournee|EcranNonFaites|lignesCommePrevu|appliquerNonFaite|prevuesNonChoisies/.test(RM + PC), "écran : plus aucun appel au code supprimé");

// ── 2. Envoi impossible tant qu'une tâche avec des heures n'a pas d'état ───
let jour = [ligne("Bandes chambre", "t1", 4), ligne("Plaquage SDB", "t2", 4)];
let e = envoi(jour);
ok(e.exact, "total exact (4 h + 4 h préremplies = 8 h)");
ok(!e.peutEnvoyer, "aucun état choisi : envoi bloqué");
eq(e.lignesIncompletes.map(l => [l.idx, l.problemes]), [[0, ["etat"]], [1, ["etat"]]], "les deux tâches avec des heures demandent un état");
jour = [appliquerRepere(jour[0], "moitie", { avancementActuel: 40 }), jour[1]];
e = envoi(jour);
ok(!e.peutEnvoyer, "une seule tâche sans état : toujours bloqué");
eq(e.phrase, "Complète « Plaquage SDB » pour envoyer", "message clair qui dit quelle tâche");
eq(resumeManques(e, jour).map(m => [m.nom, m.texte]), [["Plaquage SDB", LIBELLES_PROBLEMES.etat]], "liste « il reste à faire » : la tâche et ce qui lui manque");
jour = [jour[0], appliquerRepere(jour[1], "termine", { avancementActuel: 0 })];
ok(envoi(jour).peutEnvoyer, "chaque tâche avec des heures a son état, total exact : envoi possible");
ok(!envoi([{ ...jour[0], heures_reelles: "3" }, jour[1]]).peutEnvoyer, "total pas exact (7 h sur 8) : envoi bloqué");

// ── 3. « Pas commencé » sans motif, avancement inchangé ─────────────────────
let pc = appliquerPasCommence(ligne("Bandes chambre", "t1", 4), { avancementActuel: 40 });
eq([pc.statut, minutesDe(pc), pc.avancement, pc.motif], ["non_faite", 0, "40", null], "Pas commencé : non_faite, 0 h, avancement du phasage (40 %) inchangé, aucun motif");
eq(problemesLigne(pc, INFOS, { parcours: true }), [], "parcours unique : aucun motif demandé");
eq(problemesLigne(pc, INFOS), ["motif"], "interrupteur éteint (formulaire v2) : le motif reste demandé, comme avant");
const bloquee = { ...appliquerChoix(ligne("Bandes chambre", "t1", 4), "bloque", { avancementActuel: 40 }), motif: "attente_materiel" };
eq(problemesLigne({ ...bloquee, motif: null }, INFOS, { parcours: true }), ["motif"], "« Bloqué » garde son motif obligatoire");
eq(appliquerPasCommence(bloquee, { avancementActuel: 40 }).motif, null, "de Bloqué à Pas commencé : le motif de blocage ne suit pas");
eq([libellePasCommence(40), libellePasCommence(0), libellePasCommence(null)], ["Pas avancé aujourd'hui", "Pas commencé", "Pas commencé"], "tâche déjà avancée : le bouton s'écrit « Pas avancé aujourd'hui »");
const sPC = serialiserLigneV3(finaliserLignesV2([pc], INFOS)[0]);
eq([sPC.statut, sPC.heures_reelles, sPC.avancement, "motif" in sPC], ["non_faite", 0, 40, false], "ligne envoyée : non_faite, 0 h, avancement 40, sans motif");

// ── 4. Tâche prévue sans heures et sans état → « pas commencé » ─────────────
const sansRien = { ...ligne("Enduit couloir", "t3", 2), heures_reelles: "" };
eq(problemesLigne(sansRien, INFOS, { parcours: true }), [], "prévue sans heures ni état : ne bloque pas l'envoi");
eq(problemesLigne(sansRien, INFOS), ["statut"], "formulaire v2 : elle demandait un statut (inchangé)");
jour = [{ ...appliquerRepere(ligne("Bandes chambre", "t1", 8), "termine", { avancementActuel: 40 }) }, sansRien];
ok(envoi(jour).peutEnvoyer, "8 h placées sur Bandes, Enduit laissée vide : envoi possible");
const finVide = finaliserParcours(jour, { attendus: {}, infosParTache: INFOS });
eq([finVide[1].statut, minutesDe(finVide[1]), finVide[1].avancement, finVide[1].motif], ["non_faite", 0, "60", null], "elle part comme « pas commencé » : 0 h, avancement 60 % inchangé, sans motif");
eq(finVide[0].statut, "faite", "les autres lignes ne bougent pas");
const ajouteeVide = { chantier_id: "C1", planifie: "Ajoutée", tache_id: "t9", statut: null, heures_reelles: "", origine: "phasage" };
eq(problemesLigne(ajouteeVide, INFOS, { parcours: true }), ["etat"], "une tâche AJOUTÉE par l'ouvrier garde son état obligatoire");
const rNF = { ouvrier: "Paul", taches: finVide.map(serialiserLigneV3) };
const ecNF = ecartsRapport(rNF).filter(x => x.code === "prevue_non_faite");
eq(ecNF.map(x => [x.niveau, x.texte]), [["orange", "« Enduit couloir » prévue, pas faite"]], "validation : « prévue, pas faite » en orange, sans motif");

// ── 5. « J'ai fait autre chose » ajoute sans effacer ────────────────────────
const avant = [appliquerRepere(ligne("Bandes chambre", "t1", 4), "moitie", { avancementActuel: 40 }), { ...ligne("Plaquage SDB", "t2", 4), remarque: "angle à reprendre", photos: ["p1.jpg"] }];
const copie = JSON.parse(JSON.stringify(avant));
const apres = ajouterChoixPhasage(avant, [
  { id: "t5", nom: "Joints carrelage", nomAffiche: "Joints SDB", avancement: 20 },
  { id: "t2", nom: "Plaquage SDB", nomAffiche: "Plaquage SDB", avancement: 0 },
], C1);
eq(apres.length, 3, "une tâche ajoutée ; celle déjà dans la journée n'est pas doublée");
eq(apres.slice(0, 2), copie, "les lignes déjà là sont intactes (état, heures, remarque, photos)");
eq([apres[2].tache_id, apres[2].planifie, apres[2].origine, apres[2].statut, apres[2].avancement], ["t5", "Joints SDB", "phasage", null, "20"], "la tâche ajoutée arrive avec son nom personnalisé, sans état");
ok(/ajouterChoixPhasage\(arr, choix, chantier\)/.test(RM), "écran : « J'ai fait autre chose » passe par l'ajout sans effacement");

// ── 6. Ligne du planning non liée → proposition la plus probable en tête ───
const PAYLOAD = {
  lots: [{ id: "plomb", label: "Plomberie" }, { id: "elec", label: "Électricité" }],
  pieces: [{ id: "sdb", nom: "Salle de bain" }],
  phases: [{ id: "g1", ouvrages: [
    { id: "o1", libelle: "Chauffe-eau 40 L", lot_id: "plomb", taches: [
      { id: "t6", nom: "Passages alimentations PER chauffe-eau", avancement: 100 },
      { id: "t7", nom: "Raccordement PER", avancement: 75, piece_id: "sdb" },
    ] },
    { id: "o2", libelle: "Installation électrique", lot_id: "elec", taches: [
      { id: "t8", nom: "Pose tableau + GTL", avancement: 0 },
      { id: "t2", nom: "Plaquage SDB", avancement: 0 },
    ] },
  ] }],
};
const candidates = tachesPourLiaison(construireArbre(PAYLOAD));
let props = propositionsLiaison({ texte: "Terminer les alimentations PER", taches: candidates });
eq(props[0].id, "t7", "« Terminer les alimentations PER » → en tête « Raccordement PER » (pas encore terminée)");
eq([props[0].nom, props[0].lot, props[0].ouvrage, props[0].piece], ["Raccordement PER", "Plomberie", "Chauffe-eau 40 L", "Salle de bain"], "la proposition dit le nom, le lot, l'ouvrage (et la pièce)");
ok(props.some(p => p.id === "t6") && !props.some(p => p.id === "t8"), "les autres tâches qui ressemblent suivent ; une tâche sans rapport n'est pas proposée");
eq(propositionsLiaison({ texte: "Terminer la pose du tableau+ GTL", taches: candidates })[0].id, "t8", "« Terminer la pose du tableau+ GTL » → « Pose tableau + GTL »");
eq(propositionsLiaison({ texte: "Plaquage SDB", taches: candidates, exclure: ["t2"] }).map(p => p.id), [], "une tâche déjà dans la journée n'est jamais proposée");
eq(propositionsLiaison({ texte: "RDV ENEDIS", taches: candidates }), [], "rien qui ressemble : aucune proposition inventée");
const nonLiee = { ...ligne("Terminer les alimentations PER", null, 3), photos: ["avant.jpg"], remarque: "fuite repérée" };
ok(estLignePrevue(nonLiee) && !nonLiee.tache_id, "ligne du planning non liée");
const liee = lierLigneATache(nonLiee, props[0].tache, { proposee: true });
eq([liee.tache_id, liee.planifie, minutesDe(liee), liee.photos, liee.remarque, liee.statut], ["t7", "Raccordement PER", 180, ["avant.jpg"], "fuite repérée", null], "rattachée : la ligne garde ses heures (3 h), photos et remarque ; l'état reste à dire");
ok(estLignePrevue(liee), "elle reste une tâche prévue");
eq(serialiserLigneV3({ ...appliquerRepere(liee, "termine", { avancementActuel: 75 }) }).liaison, { texte_planning: "Terminer les alimentations PER", proposee: true }, "le texte du planning est gardé à côté");
const creee = creerTacheDepuisLigne(nonLiee, { nom: "Reprise alimentation PER", ouvrage: { id: "o1", libelle: "Chauffe-eau 40 L" }, motif: "imprevu" }, C1);
const sCreee = serialiserLigneV3({ ...appliquerRepere(creee, "termine", { avancementActuel: 0 }) });
eq([sCreee.origine, sCreee.proposition.motif_hd, sCreee.heures_reelles, sCreee.photos, sCreee.remarque], ["nouvelle", "imprevu", 3, ["avant.jpg"], "fuite repérée"], "ou tâche créée avec son motif : heures, photos et remarque gardées");

// ── 7. « Oui » au collègue = état choisi ────────────────────────────────────
const decl = declarationsParTache([{ ouvrier: "Davy", tache_id: "t1", statut: "faite", avancement: "100" }]);
const sansEtat = ligne("Bandes chambre", "t1", 8);
eq(problemesLigne(sansEtat, INFOS, { parcours: true }), ["etat"], "avant de répondre : état à choisir");
const oui = confirmerCollegue(sansEtat, decl.t1[0], { avancementActuel: 40 });
eq([choixDeLigne(oui), oui.collegue.accord], ["termine", true], "« Oui, d'accord » : l'état de Davy (terminée) est choisi");
eq(problemesLigne(oui, INFOS, { parcours: true }), [], "plus rien à choisir sur cette tâche");
ok(envoi([oui]).peutEnvoyer, "envoi possible avec le seul « Oui »");

// ── 8. Dictée : les états sûrs sont remplis, l'ouvrier relit ───────────────
const sortie = { ambigu: false, remarque: "", materiel: [], taches: [
  { tache_id: "t1", etat: "termine", minutes: null, certitude: "sure" },
  { tache_id: "t2", etat: "moitie", minutes: null, certitude: "incertaine" },
] };
const dicte = appliquerPropositions([ligne("Bandes chambre", "t1", 4), ligne("Plaquage SDB", "t2", 4)], propositionsCertaines(sortie), { infosParTache: INFOS });
eq([choixDeLigne(dicte.taches[0]), choixDeLigne(dicte.taches[1])], ["termine", null], "dictée : l'état sûr est rempli, l'incertain reste à choisir");
ok(!envoi(dicte.taches).peutEnvoyer, "l'ouvrier doit encore dire l'état de l'autre tâche avant d'envoyer");

// ── 9. Un brouillon de l'ancien parcours s'ouvre sans perte ─────────────────
const vieux = {
  version: "v2", saisieDebut: "2026-10-25T15:00:00.000Z",
  parcours: { ecran: "non_faites", branche: "autre", choisies: [0] },
  taches: [
    { ...appliquerRepere(ligne("Bandes chambre", "t1", 4), "presque_fini", { avancementActuel: 40 }), photos: ["a.jpg"], photos_apres: [], remarque: "ok" },
    { ...appliquerChoix(ligne("Plaquage SDB", "t2", 4), "pas_commence", { avancementActuel: 0 }), motif: "manque_de_temps" },
    { ...ligne("Enduit couloir", "t3", 2) },
    { chantier_id: "C1", planifie: "Reprise angle", tache_id: null, origine: "nouvelle", proposition: { ouvrage_id: null, ouvrage_libelle: "Divers / hors devis", nature: "imprevu", motif_hd: "imprevu" }, statut: "faite", heures_reelles: "1", avancement: "100", photos: [] },
  ],
};
const repris = reprendreBrouillonParcours(JSON.parse(JSON.stringify(vieux)));
eq(repris.ecran, "detail", "ancien parcours (écran « pas faites ») : s'ouvre sur la liste");
eq(repris.taches, vieux.taches, "lignes, heures, états, motifs, photos, remarques, tâche créée : tout est gardé");
eq(choixDeLigne(repris.taches[0]), "en_cours", "un état déjà choisi reste choisi");
const v2Sans = { version: "v2", taches: [{ ...ligne("Bandes chambre", "t1", 4), statut: "faite", avancement: "100" }] };
eq(reprendreBrouillonParcours(v2Sans), { taches: v2Sans.taches, ecran: "detail" }, "brouillon du formulaire v2 sans parcours : s'ouvre sans perte");
ok(/setEcran\(reprendreBrouillonParcours\(\{ taches: tachesBrouillon \}\)\.ecran\)/.test(RM), "écran : la reprise d'un brouillon passe par reprendreBrouillonParcours");
eq(parcoursActif({ actif: false }), false, "interrupteur éteint : retour au formulaire v2 d'avant");
ok(/const parcoursOn = estV2 && parcoursActif\(parcoursCfg\)/.test(RM), "le parcours unique ne s'applique que si l'interrupteur est allumé");

// ── 10. Le prévu est mémorisé sur la ligne, sans changer aucun lecteur ─────
const attendus = {
  0: etatAttenduCeSoir({ prevue: { heures_jour: 4, heures_apres: 4 }, info: INFOS.t1 }),   // en cours, 70 %
  1: attenduT2,                                                                          // terminée
  2: etatAttenduCeSoir({ prevue: null }),                                                // inconnu
};
eq(prevuMemorise(attendus[0]), { etat: "en_cours", avancement: 70, repere: "presque_fini" }, "format : { etat, avancement, repere }");
const jourFinal = [
  appliquerRepere(ligne("Bandes chambre", "t1", 3), "moitie", { avancementActuel: 40 }),
  appliquerRepere(ligne("Plaquage SDB", "t2", 3), "termine", { avancementActuel: 0 }),
  appliquerRepere(ligne("Ligne sans tâche", null, 1), "commence", {}),
  { ...appliquerRepere({ chantier_id: "C1", planifie: "Joints SDB", tache_id: "t5", origine: "phasage", heures_reelles: "1", avancement: "20" }, "moitie", { avancementActuel: 20 }) },
];
const envoyees = finaliserLignesV2(finaliserParcours(jourFinal, { attendus, infosParTache: INFOS }), INFOS).map(serialiserLigneV3);
eq(envoyees.map(l => l.prevu), [
  { etat: "en_cours", avancement: 70, repere: "presque_fini" },
  { etat: "termine", avancement: 100, repere: "termine" },
  { etat: "inconnu", avancement: null, repere: null },
  undefined,
], "chaque ligne prévue mémorise le prévu affiché ; une tâche ajoutée n'en a pas");
eq([envoyees[0].statut, envoyees[0].avancement, envoyees[1].statut], ["en_cours", 50, "faite"], "l'état envoyé est celui de l'ouvrier, pas le prévu");
const sansPrevu = envoyees.map(({ prevu, ...reste }) => reste);
const rapport = (taches) => ({ id: "r1", chantier_id: "C1", ouvrier: "Paul", date_rapport: "26/10/2026", taches, heures_indirectes: [], trajet_matin_min: 0, trajet_soir_min: 0 });
eq(lignesDepuisRapport(rapport(envoyees)), lignesDepuisRapport(rapport(sansPrevu)), "validation : mêmes lignes avec ou sans le prévu mémorisé");
eq(classerRapport(rapport(envoyees)), classerRapport(rapport(sansPrevu)), "validation : mêmes écarts et même couleur");
const pointages = (r) => buildPointagesRapport({ chantier_id: "C1", ouvrier: "Paul", dateISO: "2026-10-26", taux: 30, rapport_id: "r1", taskLines: taskLinesPourPointages(lignesDepuisRapport(r)) });
eq(pointages(rapport(envoyees)), pointages(rapport(sansPrevu)), "pointages (donc Bilan) : identiques");
eq(faitsComptesRendus({ rapports: [rapport(envoyees)] }), faitsComptesRendus({ rapports: [rapport(sansPrevu)] }), "suivi qualité : faits identiques");

console.log(`verif-cr6-parcours-unique : ${nbOk} contrôles OK (exemple issu des tests, données fictives)`);
