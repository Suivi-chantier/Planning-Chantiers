// Vérification CR-3 : nouveau parcours du compte rendu ouvrier (données fictives).
// Exemple issu des tests, données fictives : chantier « C1 », tâches t1…t4.
import assert from "node:assert/strict";
import {
  parcoursActif, PARCOURS_ACTIF_PAR_DEFAUT, REPERES, repereDeLigne, repereProposable, appliquerRepere, repereAttendu,
  etatAttenduCeSoir, phraseAttendue, lignesCommePrevu, estLignePrevue,
  minutesJourneeTaches, appliquerRaccourci, resteIci,
  dureesDepuisFrise, appliquerFrise, prevuesNonChoisies, appliquerNonFaite,
  MOTIFS_CREATION, ligneTacheCreee, declarationsParTache, phraseCollegue, confirmerCollegue, contesterCollegue,
  serialiserLigneV3, messageRetour,
} from "../src/Renovation/compteRenduV3.mjs";
import {
  appliquerChoix, serialiserLigneV2, etatEnvoi, minutesDe, finaliserLignesV2, preremplirDurees,
} from "../src/Renovation/compteRenduV2.mjs";
import {
  construireArbre, rechercher, parPiece, tachesVisibles, etatTache, basculerSelection, SANS_LOT,
} from "../src/Renovation/phasageMobileV1.mjs";
import { creationParDefaut } from "../src/Renovation/lignesValidation.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };

const C1 = { id: "C1", nom: "Chantier fictif", couleur: "#ccc" };
const ligne = (planifie, tache_id, heures_prevues) => preremplirDurees([{
  chantier_id: "C1", chantier_nom: "Chantier fictif", chantier_couleur: "#ccc",
  planifie, tache_id, phase_id: null, statut: null, remarque: "", pourTout: true,
  ...(heures_prevues ? { heures_prevues } : {}),
}])[0];
const infos = {
  t1: { id: "t1", avancement: 40, heures_estimees: 10 },
  t2: { id: "t2", avancement: 0, heures_estimees: 8 },
  t3: { id: "t3", avancement: 80, heures_estimees: 20 },
};

// ── Réglage Admin ───────────────────────────────────────────────────────────
eq(parcoursActif(null), PARCOURS_ACTIF_PAR_DEFAUT, "réglage absent → valeur par défaut");
eq(PARCOURS_ACTIF_PAR_DEFAUT, true, "parcours activé pour tous par défaut (pas de déploiement progressif)");
eq(parcoursActif(null, true), true, "réglage absent → défaut passé");
eq(parcoursActif({ actif: false }, true), false, "interrupteur Admin : retour à l'écran actuel");
eq(parcoursActif({ actif: true }), true, "interrupteur Admin : nouveau parcours");

// ── État attendu ce soir ────────────────────────────────────────────────────
eq(etatAttenduCeSoir({ prevue: null, info: infos.t1 }).etat, "inconnu", "ligne sans tâche du phasage : état inconnu (jamais deviné)");
let a = etatAttenduCeSoir({ prevue: { heures_jour: 4, heures_apres: 4 }, info: infos.t1 });
eq([a.etat, a.avancement], ["en_cours", 70], "encore planifiée après : en cours, 40 + 60 × 4/8 = 70 %");
eq(etatAttenduCeSoir({ prevue: { heures_jour: 8, heures_apres: 0 }, info: infos.t2 }).etat, "termine", "dernier jour planifié, heures suffisantes : terminée ce soir");
a = etatAttenduCeSoir({ prevue: { heures_jour: 1, heures_apres: 0 }, info: infos.t3 });
eq([a.etat, a.avancement], ["en_cours", 85], "dernier jour mais 1 h pour 4 h restantes : en cours (planning pas prolongé)");
eq(etatAttenduCeSoir({ prevue: { heures_jour: 2, heures_apres: 0 }, info: { avancement: 10 } }).etat, "termine", "heures estimées inconnues : le dernier jour fait foi");
eq(phraseAttendue({ etat: "termine" }), "terminée ce soir", "phrase : terminée ce soir");
eq(phraseAttendue({ etat: "inconnu" }), "à toi de dire où elle en est", "phrase : état inconnu dit clairement");

// ── Repères ─────────────────────────────────────────────────────────────────
eq(REPERES.map(r => r.avancement), [25, 50, 75, 100], "repères mappés sur 25/50/75/100");
eq(repereProposable("commence", 40), false, "repère sous l'avancement actuel : non proposé");
eq(repereProposable("termine", 90), true, "Terminé toujours proposé");
let t = appliquerRepere(ligne("Bandes", "t1", 4), "moitie", { avancementActuel: 40 });
eq([t.statut, t.avancement, repereDeLigne(t)], ["en_cours", "50", "moitie"], "repère « à moitié » = En cours 50 %");
eq(appliquerRepere(ligne("Bandes", "t1", 4), "commence", { avancementActuel: 40 }).statut, null, "repère refusé sous l'avancement actuel");
eq(repereAttendu(70, 40), "presque_fini", "attendu 70 % → repère le plus proche (presque fini)");
eq(repereAttendu(90, 80), null, "déjà au-delà de presque fini : aucun repère");

// ── 1. « Comme prévu » = mêmes lignes qu'une saisie manuelle équivalente ────
const prevues = [ligne("Bandes chambre", "t1", 4), ligne("Plaquage SDB", "t2", 4), ligne("Ligne sans tâche", null, 1)];
const attendus = {
  0: etatAttenduCeSoir({ prevue: { heures_jour: 4, heures_apres: 4 }, info: infos.t1 }),
  1: etatAttenduCeSoir({ prevue: { heures_jour: 8, heures_apres: 0 }, info: infos.t2 }),
  2: etatAttenduCeSoir({ prevue: null }),
};
const commePrevu = lignesCommePrevu(prevues, attendus, infos);
const manuel = [
  { ...appliquerChoix(prevues[0], "en_cours", { avancementActuel: 40 }), avancement: "75" },
  appliquerChoix(prevues[1], "termine", { avancementActuel: 0 }),
  prevues[2],
];
eq(commePrevu.map(serialiserLigneV3), manuel.map(serialiserLigneV2), "comme prévu : lignes identiques à la saisie manuelle (repères 25/50/75)");
eq(commePrevu.map(minutesDe), [240, 240, 60], "comme prévu : durées prévues gardées");
eq(commePrevu[2].statut, null, "comme prévu : ligne sans tâche reste à compléter");
ok(estLignePrevue(prevues[0]) && !estLignePrevue({ ...prevues[0], origine: "phasage" }), "ligne prévue = venue du planning");

// ── 2. « Le reste ici » et raccourcis ───────────────────────────────────────
const journee = { cibleHeures: 9, trajetMinutes: 30, indirectesHeures: 0.5 };
eq(minutesJourneeTaches(journee), 480, "journée de tâches = 9 h − 30 min de trajet − 30 min indirectes");
t = appliquerRaccourci(ligne("X", "t1"), "2h");
eq(minutesDe(t), 120, "raccourci 2 h");
eq(minutesDe(appliquerRaccourci(t, "journee", { minutesJournee: 480 })), 480, "raccourci Journée");
let jour = [{ ...appliquerChoix(ligne("A", "t1"), "en_cours"), heures_reelles: "4", avancement: "50" }, { ...appliquerChoix(ligne("B", "t2"), "termine"), heures_reelles: "2" }];
let env = etatEnvoi({ taches: jour, trajetMatin: "15", trajetSoir: "15", heuresIndirectes: [], cibleHeures: 9 });
eq(env.resteMin, 150, "reste de la journée : 2 h 30");
jour = jour.map((x, i) => (i === 1 ? resteIci(x, env.resteMin) : x));
eq(minutesDe(jour[1]), 270, "« le reste ici » : 2 h + 2 h 30 sur la tâche");
env = etatEnvoi({ taches: jour, trajetMatin: "15", trajetSoir: "15", heuresIndirectes: [], cibleHeures: 9 });
ok(env.exact && env.peutEnvoyer, "après « le reste ici » : total exact, envoi possible");
eq(minutesDe(resteIci({ ...jour[0] }, -600)), 0, "« le reste ici » négatif : jamais sous 0");

// ── 3. Frise horaire → durées ───────────────────────────────────────────────
const f = dureesDepuisFrise({
  arrivee: "07:30", depart: "16:45", pause: { debut: "12:00", fin: "12:45" },
  segments: [{ cle: 0, debut: "07:30" }, { cle: 1, debut: "10:00" }, { cle: 0, debut: "14:00" }],
});
eq(f.erreurs, [], "frise : aucune erreur");
eq(f.durees, { 0: 150 + 165, 1: 195 }, "frise : 7h30-10h = 2 h 30 ; 10h-14h moins la pause = 3 h 15 ; 14h-16h45 = 2 h 45");
eq(f.total, 510, "frise : total 8 h 30 (journée moins la pause)");
eq(appliquerFrise([ligne("A", "t1"), ligne("B", "t2")], f.durees).map(minutesDe), [315, 195], "frise : durées posées sur les lignes");
ok(dureesDepuisFrise({ arrivee: "08:00", depart: "17:00", segments: [{ cle: 0, debut: "10:00" }, { cle: 1, debut: "09:00" }] }).erreurs.length > 0, "frise : heures dans le désordre refusées");

// ── 4. Tâche créée avec chacun des 3 motifs ─────────────────────────────────
const ouvrage = { id: "o1", libelle: "Cloisons", code: null, phases: [], divers: false };
for (const m of MOTIFS_CREATION) {
  const l = ligneTacheCreee({ nom: "Reprise angle", ouvrage, motif: m.code, photos: m.code === "demande_client" ? ["p.jpg"] : [] }, C1);
  const s = serialiserLigneV3({ ...appliquerChoix(l, "termine"), heures_reelles: "1" });
  eq([s.origine, s.proposition.motif_hd, s.proposition.ouvrage_id, s.proposition.nature], ["nouvelle", m.code, "o1", m.nature], `tâche créée « ${m.label} » : motif ${m.code} et nature ${m.nature}`);
  const cas = creationParDefaut({ planifie: s.planifie, proposition: s.proposition }).cas;
  eq(cas, { introuvable: "A", imprevu: "B", demande_client: "C" }[m.code], `validation : cas ${cas} présélectionné pour ${m.code}`);
}
eq(creationParDefaut({ planifie: "x", proposition: { nature: "imprevu" } }).cas, undefined, "ancienne proposition sans motif : aucun cas présélectionné (inchangé)");

// ── 5. Tâche prévue non faite, avec motif ───────────────────────────────────
const choisies = [0];
const nonFaites = prevuesNonChoisies(prevues, choisies);
eq(nonFaites.map(x => x.idx), [1, 2], "pas comme prévu : les prévues non choisies");
t = appliquerNonFaite(prevues[1], "manque_de_temps", { avancementActuel: 0 });
const sNF = serialiserLigneV3(finaliserLignesV2([t])[0]);
eq([sNF.statut, sNF.motif, sNF.heures_reelles, sNF.avancement], ["non_faite", "manque_de_temps", 0, 0], "prévue non faite : Pas commencé + motif, 0 h, avancement du phasage");

// ── 6. Tâche déjà déclarée par un collègue ──────────────────────────────────
const decl = declarationsParTache([
  { ouvrier: "Davy", tache_id: "t1", statut: "en_cours", avancement: "50" },
  { ouvrier: "Davy", tache_id: "t1", statut: "faite", avancement: "100" },
  { ouvrier: "Kev", tache_id: "t2", statut: "non_faite" },
]);
eq(Object.keys(decl), ["t1"], "déclarations : « pas commencé » ignoré");
eq(decl.t1.length, 1, "déclarations : la dernière de chaque collègue");
eq(phraseCollegue(decl.t1[0], "Bandes SDB"), "Davy a déclaré : Bandes SDB terminée", "phrase du collègue");
t = confirmerCollegue(ligne("Bandes SDB", "t1", 3), decl.t1[0], { avancementActuel: 40 });
let s = serialiserLigneV3(t);
eq([s.statut, s.avancement, s.collegue], ["faite", 100, { ouvrier: "Davy", accord: true, etat: "termine" }], "collègue confirmé : même état, accord noté");
t = contesterCollegue(appliquerRepere(ligne("Bandes SDB", "t1", 3), "moitie", { avancementActuel: 40 }), decl.t1[0]);
s = serialiserLigneV3(t);
eq([s.statut, s.avancement, s.collegue.accord, s.collegue.etat], ["en_cours", 50, false, "termine"], "collègue contesté : son état à lui, désaccord signalé");
eq(serialiserLigneV3(ligne("X", "t1")).collegue, undefined, "sans collègue : aucun champ ajouté");

// ── 7. Envoi impossible tant que le total n'est pas exact ───────────────────
const lignesOk = [{ ...appliquerRepere(ligne("A", "t1"), "moitie", { avancementActuel: 40 }), heures_reelles: "8" }];
ok(!etatEnvoi({ taches: lignesOk, trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 9 }).peutEnvoyer, "1 h manquante : envoi bloqué");
ok(!etatEnvoi({ taches: [{ ...lignesOk[0], heures_reelles: "9.25" }], trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 9 }).peutEnvoyer, "15 min de trop : envoi bloqué");
ok(etatEnvoi({ taches: [{ ...lignesOk[0], heures_reelles: "9" }], trajetMatin: "", trajetSoir: "", heuresIndirectes: [], cibleHeures: 9 }).peutEnvoyer, "total exact : envoi possible");

// ── Phasage sur téléphone ───────────────────────────────────────────────────
const payload = {
  lots: [{ id: "elec", label: "Électricité" }, { id: "mc", label: "Murs cloison" }],
  pieces: [{ id: "sdb", nom: "Salle de bain" }, { id: "ch", nom: "Chambre" }],
  phases: [
    { id: "g1", ouvrages: [
      { id: "o1", libelle: "Cloison 72/48 hydro", libelle_perso: "Cloisons SDB", lot_id: "mc", taches: [
        { id: "t1", nom: "Isolation laine 45", nom_perso: "Isolation", avancement: 40, piece_id: "sdb" },
        { id: "t2", nom: "Plaques", avancement: 100, piece_id: "sdb" },
      ] },
      { id: "o2", libelle: "Prises", lot_id: "elec", taches: [{ id: "t3", nom: "Boîtes", avancement: 0, est_mienne: false }] },
    ] },
    { id: "g2", ouvrages: [{ id: "o1", libelle: "Cloison 72/48 hydro", lot_id: "mc", taches: [{ id: "t4", nom: "Bandes", avancement: 0, piece_id: "ch" }] }] },
    { id: "g3", ouvrages: [{ id: "o9", libelle: "Divers", taches: [{ id: "t5", nom: "Nettoyage", avancement: 0 }] }] },
  ],
};
const arbre = construireArbre(payload, { tachesDuJourIds: ["t3"] });
eq(arbre.lots.map(l => l.id), ["elec", "mc", SANS_LOT], "lots : celui de la journée de l'ouvrier en premier, puis l'ordre de l'Admin");
eq(arbre.lots[1].ouvrages[0].taches.map(x => x.id), ["t1", "t2", "t4"], "un ouvrage réparti sur deux phases est regroupé");
eq(arbre.lots[1].ouvrages[0].libelle, "Cloisons SDB", "libellé personnalisé affiché");
eq(arbre.lots[1].ouvrages[0].libelleDevis, "Cloison 72/48 hydro", "libellé devis gardé à côté");
eq(tachesVisibles(arbre.taches).map(x => x.id), ["t3", "t1", "t4", "t5"], "tâches terminées masquées par défaut");
eq(tachesVisibles(arbre.taches, { montrerTerminees: true }).length, 5, "bouton pour afficher les terminées");
eq([etatTache({ avancement: 0 }), etatTache({ avancement: 30 }), etatTache({ avancement: 100 })], ["pas_commencee", "en_cours", "terminee"], "code couleur : pas commencée / en cours / terminée");
eq(rechercher(arbre, "isolation").map(x => x.id), ["t1"], "recherche sur le nom affiché");
eq(rechercher(arbre, "laine").map(x => x.id), ["t1"], "recherche aussi sur le nom du devis");
eq(parPiece(arbre).map(p => [p.id, p.taches.map(x => x.id)]), [["sdb", ["t1"]], ["ch", ["t4"]], ["_sans_piece", ["t3", "t5"]]], "navigation par pièce");
eq(basculerSelection(basculerSelection(["t1"], "t3"), "t1"), ["t3"], "sélection multiple");

// ── Retour après l'envoi ────────────────────────────────────────────────────
eq(messageRetour({ prenom: "Davy", taches: [appliquerChoix(ligne("Chambre 101", "t1"), "termine"), appliquerRepere(ligne("Bandes", "t2"), "moitie")] }),
  "Merci Davy ! Chambre 101 terminée, 1 en cours. Ton conducteur va valider ta journée.", "message de retour factuel");

console.log(`verif-compte-rendu-v3 : ${nbOk} contrôles OK (données fictives)`);
