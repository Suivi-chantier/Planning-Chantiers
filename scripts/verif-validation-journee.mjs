// Vérification CR-5 : page de la journée de la Validation, arbitrage groupé,
// répartition d'une tâche regroupée, compteur, compte rendu manquant.
// Exemple issu des tests, données fictives : chantier « C1 », ouvriers
// « Ouvrier A » / « Ouvrier B » / « Ouvrier C », tâches t1…t5.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  etatLigne, etiquettesRapport, ecartsRapport, classerRapport, peutValiderDirect, grouperRapports,
  resumeJournee, manquantsDuChantier, joursEnRetard, tachesDeclareesDifferemment, poserArbitrage,
  appliquerArbitrages, repartirPartsEgales, repartirSelonDurees, ecartRepartition, repartitionJuste,
  ajusterQuartDHeure, proposerRepartition, lignesDepuisRepartition, rangTacheRegroupee, budgetTache,
  coutHoraireMoyen, heuresJourOuvrier, dateISO,
} from "../src/Renovation/validationJourneeV1.mjs";
import { lignesDepuisRapport, taskLinesPourPointages } from "../src/Renovation/lignesValidation.mjs";
import { comptesRendusAttendus } from "../src/Renovation/releveJournalier.mjs";
import { decoupesParOuvrierEtMois, faitsComptesRendus } from "../src/Renovation/qualiteComptesRendusV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const somme = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

// ── Données fictives ────────────────────────────────────────────────────────
const JOUR = "2026-10-21";
const rA = { id: "rA", ouvrier: "Ouvrier A", chantier_id: "C1", chantier_nom: "Chantier fictif", date_rapport: JOUR, statut: "en_attente",
  trajet_matin_min: 30, trajet_soir_min: 30,
  taches: [
    { tache_id: "t1", planifie: "Bandes salle de bain", statut: "en_cours", avancement: 50, heures_reelles: 4 },
    { tache_id: "t2", planifie: "Plaquage chambre", statut: "faite", avancement: 100, heures_reelles: 3 },
  ] };
const rB = { id: "rB", ouvrier: "Ouvrier B", chantier_id: "C1", chantier_nom: "Chantier fictif", date_rapport: JOUR, statut: "en_attente",
  trajet_matin_min: 30, trajet_soir_min: 30,
  taches: [
    { tache_id: "t1", planifie: "Bandes salle de bain", statut: "faite", avancement: 100, heures_reelles: 3 },
    { planifie: "Journée chantier", statut: "en_cours", heures_reelles: 4, remarque: "bandes sdb, placo séjour, nettoyage",
      proposition: { nom: "Journée chantier", motif_hd: "introuvable" }, origine: "nouvelle", photos: ["p1.jpg"] },
  ] };
const rC = { id: "rC", ouvrier: "Ouvrier C", chantier_id: "C2", chantier_nom: "Autre chantier fictif", date_rapport: JOUR, statut: "valide",
  trajet_matin_min: 0, trajet_soir_min: 0,
  taches: [{ tache_id: "t9", planifie: "Peinture", statut: "faite", avancement: 100, heures_reelles: 7 }] };
const ctxBase = { avancementParTache: { t1: 40, t2: 60 }, ouvriersPlanifies: ["Ouvrier A", "Ouvrier B", "Ouvrier C", "Ouvrier D"] };

// ── États et étiquettes ─────────────────────────────────────────────────────
eq(etatLigne({ statut: "en_cours", avancement: 50 }).texte, "en cours 50 %", "étiquette en cours avec pourcentage");
eq(etatLigne({ statut: "faite" }).code, "termine", "étiquette terminée");
eq(etatLigne({ statut: "en_cours", bloque: true }).code, "bloque", "bloquée prime");
eq(etiquettesRapport(rA).map(e => e.nom), ["Bandes salle de bain", "Plaquage chambre"], "étiquettes lisibles sans ouvrir");
eq(dateISO("21/10/2026"), JOUR, "date FR convertie");

// ── Couleurs : gris / orange / rouge ────────────────────────────────────────
const cA = classerRapport(rA, { ...ctxBase, heuresAttendues: 8, heuresJourOuvrier: heuresJourOuvrier([rA], "Ouvrier A") });
eq(cA.niveau, "comme_prevu", "7 h de tâches + 1 h de trajet = 8 h attendues : comme prévu (gris)");
eq(cA.badge, "Comme prévu", "badge comme prévu");
const cB = classerRapport(rB, ctxBase);
eq(cB.niveau, "arbitrer", "tâche créée par l'ouvrier : à arbitrer (rouge)");
ok(cB.ecarts.some(e => e.code === "tache_creee" && /pas trouvée dans la liste/.test(e.texte)), "motif de la tâche créée écrit en clair");
const rDep = { ...rA, id: "rDep", taches: [{ ...rA.taches[0], motif_depassement: "travail_plus_long", depassement: { tache_id: "t1", heures_vendues: 10, heures_avant: 9, heures_jour: 4 } }] };
const cDep = classerRapport(rDep, ctxBase);
eq(cDep.niveau, "ecarts", "dépassement : écart à regarder (orange)");
ok(/13 h pour 10 h prévues/.test(cDep.ecarts[0].texte), "dépassement chiffré en clair");
const rBloq = { ...rA, id: "rBloq", taches: [{ tache_id: "t3", planifie: "Faïence", statut: "en_cours", bloque: true, motif: "attente_materiel", remarque: "colle manquante", heures_reelles: 1 }] };
ok(/bloquée : attente de matériel — « colle manquante »/.test(classerRapport(rBloq, ctxBase).ecarts[0].texte), "tâche bloquée avec motif et remarque");
const rNonFaite = { ...rA, id: "rNF", taches: [...rA.taches, { tache_id: "t4", planifie: "Enduit", statut: "non_faite", motif: "manque_de_temps", heures_reelles: 0 }] };
ok(classerRapport(rNonFaite, ctxBase).ecarts.some(e => e.code === "prevue_non_faite" && /manque de temps/.test(e.texte)), "tâche prévue non faite avec motif");
ok(classerRapport({ ...rA, ouvrier: "Inconnu" }, ctxBase).ecarts.some(e => e.code === "non_planifie"), "ouvrier non planifié signalé");
ok(classerRapport(rA, { ...ctxBase, avancementParTache: { t2: 100 } }).ecarts.some(e => e.code === "deja_terminee"), "tâche déjà terminée pointée");
ok(classerRapport(rA, { ...ctxBase, heuresAttendues: 9, heuresJourOuvrier: 8 }).ecarts.some(e => e.code === "total" && /8 h déclarées pour 9 h attendues/.test(e.texte)), "total différent de l'attendu");

// ── « Valider » direct : seulement comme prévu sans anomalie ────────────────
ok(peutValiderDirect(rA, cA), "comme prévu, tout rattaché : bouton Valider direct");
ok(!peutValiderDirect(rB, cB), "à arbitrer : Ouvrir et valider");
ok(!peutValiderDirect(rA, cA, { suiviEnQuantite: (id) => id === "t1" }), "tâche suivie en quantité : Ouvrir et valider");
ok(!peutValiderDirect(rA, cA, { journeeCloturee: true }), "journée clôturée : pas de validation directe");
ok(!peutValiderDirect({ ...rA, statut: "valide" }, cA), "déjà validé : rien");

// ── Regroupement ────────────────────────────────────────────────────────────
eq(grouperRapports([rA, rB, rC]).map(g => g.titre), ["Autre chantier fictif", "Chantier fictif"], "regroupement par chantier");
eq(grouperRapports([rA, rB, rC], "ouvrier").map(g => g.cle), ["Ouvrier A", "Ouvrier B", "Ouvrier C"], "regroupement par ouvrier");

// ── Compte rendu attendu mais non envoyé (module des relevés, étape 1D) ─────
const cellules = [
  { week_id: "2026-W43", jour: "Mercredi", chantier_id: "C1", ouvriers: ["Ouvrier A", "Ouvrier B", "Ouvrier D"] },
  { week_id: "2026-W43", jour: "Mercredi", chantier_id: "C2", ouvriers: ["Ouvrier C"] },
];
const absences = { ok: true, ressources: [], evenements: [], exceptions: null };
const attendus = ["C1", "C2"].flatMap(ch => comptesRendusAttendus({ chantierId: ch, dateISO: JOUR, cellules, rapports: [rA, rB, rC], absences })
  .attendus.map(a => ({ ...a, chantier_id: ch, chantier_nom: ch === "C1" ? "Chantier fictif" : "Autre chantier fictif" })));
eq(manquantsDuChantier(attendus, "C1").map(a => a.ouvrier), ["Ouvrier D"], "Ouvrier D planifié sur C1 sans compte rendu : affiché manquant");
eq(manquantsDuChantier(attendus, "C2"), [], "C2 : rien de manquant");
const resume = resumeJournee({ rapports: [rA, rB, rC], classements: { rA: cA, rB: cB }, attendus });
eq([resume.aValider, resume.dontEcarts, resume.valides], [2, 1, 1], "résumé : 2 à valider dont 1 avec écarts, 1 validé");
eq(resume.nonEnvoyes.map(n => `${n.ouvrier} · ${n.chantier_nom}`), ["Ouvrier D · Chantier fictif"], "non envoyés : qui et sur quel chantier");
eq(resume.heuresValidees, 7, "heures validées");
eq(resume.heuresAttendues, null, "heures attendues inconnues pour un ouvrier : pas de total inventé");
eq(Math.round(resume.progression * 100), 25, "progression : 1 validé sur 4 comptes rendus attendus ou reçus");
eq(joursEnRetard([{ date_rapport: "19/10/2026" }, { date_rapport: "2026-10-19" }, { date_rapport: "2026-10-20" }, { date_rapport: JOUR }], JOUR),
  [{ date: "2026-10-20", nb: 1 }, { date: "2026-10-19", nb: 2 }], "jours précédents avec comptes rendus à valider");

// ── Tâche faite à plusieurs : arbitrage appliqué aux deux ───────────────────
const diff = tachesDeclareesDifferemment([rA, rB]);
eq(diff.map(d => d.tache_id), ["t1"], "t1 déclarée en cours 50 % par A et terminée par B");
eq(diff[0].phrase, "Ouvrier A : en cours 50 % · Ouvrier B : terminée", "encart lisible");
eq(tachesDeclareesDifferemment([rA, { ...rB, taches: [{ ...rB.taches[0], statut: "en_cours", avancement: 50 }] }]), [], "même état : pas d'encart");
const arbitrages = poserArbitrage({}, "C1", "t1", 80);
const lA = appliquerArbitrages(lignesDepuisRapport(rA), arbitrages.C1);
const lB = appliquerArbitrages(lignesDepuisRapport(rB), arbitrages.C1);
eq(lA.find(l => l.tache_id === "t1").avancement_arbitre, 80, "arbitrage appliqué au compte rendu de A");
eq(lB.find(l => l.tache_id === "t1").avancement_arbitre, 80, "arbitrage appliqué au compte rendu de B");
eq(lA.find(l => l.tache_id === "t2").avancement_arbitre, 100, "les autres tâches gardent leur déclaré");
eq(lB.find(l => l.tache_id === "t1").avancement_declare, 100, "le déclaré de l'ouvrier reste intact");
eq(poserArbitrage({}, "C1", "t1", 140).C1.t1, 100, "avancement retenu borné à 100");

// ── Répartition : parts égales, selon les durées, et total juste ────────────
eq(repartirPartsEgales(7, 3), [2.5, 2.25, 2.25], "7 h en 3 parts égales au quart d'heure");
eq(somme(repartirPartsEgales(7, 3)), 7, "parts égales : la somme tombe juste");
eq(repartirPartsEgales(6.5, 4), [1.75, 1.75, 1.5, 1.5], "6,5 h en 4");
eq(somme(repartirPartsEgales(1.1, 2)), 1.1, "reste de moins de 15 min sur la première ligne : somme juste");
eq(repartirSelonDurees(8, [2, 6]), [2, 6], "selon les durées prévues 2 h / 6 h");
eq(repartirSelonDurees(7, [1, 1, 2]), [1.75, 1.75, 3.5], "proportionnel aux durées");
eq(repartirSelonDurees(4, [0, 0]), [2, 2], "aucune durée connue : parts égales");
eq(somme(repartirSelonDurees(7.75, [3, 5, 1])), 7.75, "selon les durées : somme juste");
const partsOk = [{ tache_id: "t1", heures: 2 }, { tache_id: "t3", heures: 1.5 }, { tache_id: "t5", heures: 0.5 }];
ok(repartitionJuste(partsOk, 4), "4 h réparties 2 + 1,5 + 0,5 : juste, « Valider la répartition » actif");
eq(ecartRepartition([{ tache_id: "t1", heures: 2 }, { tache_id: "t3", heures: 1.5 }], 4), -30, "il manque 30 min");
ok(!repartitionJuste([{ tache_id: "t1", heures: 2 }, { tache_id: "t3", heures: 1.5 }], 4), "total différent : bouton inactif");
ok(!repartitionJuste([{ tache_id: "t1", heures: 2 }, { tache_id: null, heures: 2 }], 4), "ligne sans tâche choisie : bouton inactif");
ok(!repartitionJuste([{ tache_id: "t1", heures: 4 }, { tache_id: "t3", heures: 0 }], 4), "ligne à 0 h : à retirer d'abord");
eq(ajusterQuartDHeure(2, +1), 2.25, "+15 min");
eq(ajusterQuartDHeure(0, -1), 0, "-15 min ne descend pas sous 0");

// Proposition expliquée à partir du texte dicté et du planning du jour.
const tachesPlan = [
  { id: "t1", nom: "Bandes salle de bain", groupe: "Cloisons", heures_prevues: 6 },
  { id: "t2", nom: "Plaquage chambre", groupe: "Cloisons", heures_prevues: 8 },
  { id: "t3", nom: "Plaquage séjour", groupe: "Cloisons", heures_prevues: 8 },
  { id: "t4", nom: "Faïence cuisine", groupe: "Faïence", heures_prevues: 5 },
  { id: "t5", nom: "Nettoyage et rangement", groupe: "Divers", heures_prevues: 0 },
];
const prop = proposerRepartition({ texte: "J'ai fait les bandes de la salle de bain, le placo du séjour et un peu de nettoyage", tachesPlan, tachesPrevuesJour: ["t1"], heures: 4 });
eq(prop.map(p => p.tache_id), ["t1", "t5", "t3"], "proposition : prévue + mots du texte + tâche standard, la plus probable d'abord");
ok(/prévue au planning ce jour-là/.test(prop[0].raison) && /bandes/.test(prop[0].raison), "chaque proposition dit pourquoi");
ok(/tâche standard/.test(prop[1].raison), "tâche standard de nettoyage proposée parce que le texte en parle");
eq(somme(prop.map(p => p.heures)), 4, "la proposition tombe juste sur les heures déclarées");
eq(proposerRepartition({ texte: "rien à voir", tachesPlan, heures: 4 }), [], "texte sans rapport, rien de prévu : aucune proposition inventée");

// Lignes produites : pas de nouvelle tâche créée, heures conservées, photos.
const source = lignesDepuisRapport(rB)[1];
const parts = [
  { tache_id: "t1", nom: "Bandes salle de bain", heures: 2, etat: "terminee" },
  { tache_id: "t3", nom: "Plaquage séjour", heures: 1.5, etat: "en_cours", avancement: 30 },
  { tache_id: "t5", nom: "Nettoyage et rangement", heures: 0.5, etat: "en_cours", avancement: 10 },
];
const nouvelles = lignesDepuisRepartition(source, parts, { garderPhotosEtTexte: true, genId: (i) => `x${i}` });
eq(nouvelles.map(l => [l.rowId, l.tache_id, l.heures, l.statut, l.avancement_arbitre]),
  [[source.rowId, "t1", 2, "faite", 100], ["x1", "t3", 1.5, "en_cours", 30], ["x2", "t5", 0.5, "en_cours", 10]], "une ligne par tâche du phasage");
ok(nouvelles.every(l => !l.proposition && !l.creation), "la tâche regroupée n'est plus créée");
ok(nouvelles.every(l => l.photos.includes("p1.jpg") && /nettoyage/.test(l.remarque)), "photos et texte gardés sur chaque tâche (case cochée)");
ok(lignesDepuisRepartition(source, parts, { garderPhotosEtTexte: false }).every(l => l.photos.length === 0 && l.remarque === ""), "case décochée : rien recopié");
eq(somme(taskLinesPourPointages(nouvelles).map(l => l.heures)), 4, "pointages : les 4 h déclarées, ni plus ni moins");

// ── Compteur de tâches regroupées (suivi qualité CR-1) ──────────────────────
const rVal = (id, date, taches) => ({ id, ouvrier: "Ouvrier B", chantier_id: "C1", date_rapport: date, statut: "valide", taches });
const regroupe = (id, date) => rVal(id, date, [{ planifie: "Journée", heures_reelles: 6 }]);
const ptsDecoupe = (id) => [
  { rapport_id: id, tache_id: "t1", heures: 3, type_pointage: "tache" },
  { rapport_id: id, tache_id: "t3", heures: 3, type_pointage: "tache" },
];
const faits = faitsComptesRendus({
  rapports: [regroupe("o1", "2026-10-02"), regroupe("o2", "2026-10-09"), regroupe("s1", "2026-09-15")],
  pointages: [...ptsDecoupe("o1"), ...ptsDecoupe("o2"), ...ptsDecoupe("s1")],
});
const decoupes = decoupesParOuvrierEtMois(faits);
eq(rangTacheRegroupee(decoupes, "Ouvrier B", "2026-10").texte, "3e tâche regroupée de Ouvrier B ce mois-ci", "2 déjà découpées en octobre + celle-ci");
eq(rangTacheRegroupee(decoupes, "Ouvrier B", "2026-11").texte, "1re tâche regroupée de Ouvrier B ce mois-ci", "nouveau mois : 1re");
eq(rangTacheRegroupee({}, "Ouvrier A", "2026-10").n, 1, "aucun historique : 1re");

// ── Barre de budget ─────────────────────────────────────────────────────────
const b = budgetTache({ heuresAvant: 9, heuresJour: [{ ouvrier: "Ouvrier A", heures: 4 }, { ouvrier: "Ouvrier B", heures: 3 }], heuresPrevues: 12, coutHoraire: 30, tauxFG: 17.44 });
eq([b.avant, b.jour, b.total, b.prevues, b.depassement], [9, 7, 16, 12, 4], "9 h avant + 7 h du jour sur 12 h prévues : 4 h de trop");
eq(b.coutDepassement, 189.76, "4 h × (30 € + 17,44 €)");
ok(/dépassement 4 h ≈ 190 €/.test(b.texte), "dépassement en clair");
eq(budgetTache({ heuresAvant: 1, heuresJour: [], heuresPrevues: 12 }).depassement, 0, "dans le budget");
eq(budgetTache({ heuresAvant: 13, heuresPrevues: 12 }).coutDepassement, null, "coût inconnu : jamais 0 €");
eq(budgetTache({ heuresAvant: 3 }).depassement, null, "pas d'heures prévues : pas de dépassement inventé");
eq(coutHoraireMoyen([{ heures: 2, taux_horaire: 30 }, { heures: 6, taux_horaire: 34 }]), 33, "coût horaire moyen pondéré");
eq(coutHoraireMoyen([]), null, "aucun pointage : inconnu");

// ── Écran : présentation seulement, aucun message technique ───────────────
const V = readFileSync(new URL("../src/Renovation/Validation.jsx", import.meta.url), "utf8");
const VJ = readFileSync(new URL("../src/Renovation/ValidationJournee.jsx", import.meta.url), "utf8");
ok(!/exécute le SQL|Détail technique|SQL du P\d/.test(V), "aucun message technique à l'écran (ils vont aux journaux)");
ok(/<ValidationJournee/.test(V) && /validerRapport\(\{ rapport: r, lignes, indirectes \}\)/.test(V), "« Valider » direct = la même validation que la fenêtre");
ok(/comptesRendusAttendus\(/.test(V), "non envoyés : la règle des relevés journaliers (même chiffre = même service)");
ok(/Appliquer aux deux/.test(VJ) && /dashed/.test(VJ) && /Écarts seulement/.test(VJ), "encarts et filtre présents");
ok(!/Tout valider/i.test(VJ), "pas de « tout valider d'un clic »");

console.log(`verif-validation-journee : ${nbOk} contrôles OK (données fictives)`);
