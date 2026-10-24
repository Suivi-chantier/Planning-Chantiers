// Vérification CR-2 : pièces du chantier dans le phasage (données fictives).
import assert from "node:assert/strict";
import {
  piecesDuPhasage, ajouterPiece, renommerPiece, deplacerPiece, supprimerPiece,
  rattacherTaches, detacherPiece, grouperParPiece, filtrerParPiece, repartirHeures,
  dupliquerTacheParPieces, SANS_PIECE,
} from "../src/Renovation/piecesPhasageV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const somme = (l, k) => Math.round(l.reduce((s, x) => s + (Number(x[k]) || 0), 0) * 100) / 100;

// Liste des pièces
let P = [];
P = ajouterPiece(P, "Salle de bain", "sdb");
P = ajouterPiece(P, " Chambre 1 ", "ch1");
P = ajouterPiece(P, "Séjour", "sej");
P = ajouterPiece(P, "salle de bain", "doublon");
eq(P.map(p => p.nom), ["Salle de bain", "Chambre 1", "Séjour"], "pièces : ajout, espaces retirés, doublon de nom refusé");
eq(deplacerPiece(P, "sej", -1).map(p => p.id), ["sdb", "sej", "ch1"], "pièces : réordonner");
eq(deplacerPiece(P, "sdb", -1).map(p => p.id), ["sdb", "ch1", "sej"], "pièces : la première ne monte pas plus haut");
eq(renommerPiece(P, "ch1", "Chambre parentale")[1].nom, "Chambre parentale", "pièces : renommer");
eq(supprimerPiece(P, "ch1").map(p => p.id), ["sdb", "sej"], "pièces : supprimer");
eq(piecesDuPhasage({ pieces: [{ id: "a", nom: "A" }, { id: "", nom: "x" }, { id: "a", nom: "B" }, null] }), [{ id: "a", nom: "A" }], "pièces : lecture propre du phasage");
eq(piecesDuPhasage(undefined), [], "pièces : phasage sans pièce");

// Rattachement de plusieurs tâches, filtre, regroupement
const ouvrages = [
  { id: "o1", taches: [{ id: "t1", nom: "Cloison" }, { id: "t2", nom: "Bandes" }] },
  { id: "o2", taches: [{ id: "t3", nom: "Peinture" }] },
];
let O = rattacherTaches(ouvrages, ["t1", "t3"], "sdb");
eq(O.flatMap(o => o.taches.map(t => t.piece_id ?? null)), ["sdb", null, "sdb"], "rattacher plusieurs tâches d'ouvrages différents");
ok(O[0] !== ouvrages[0] && ouvrages[0].taches[0].piece_id === undefined, "rattacher : les ouvrages d'origine ne sont pas modifiés");
const toutes = O.flatMap(o => o.taches);
eq(filtrerParPiece(toutes, "sdb", P).map(t => t.id), ["t1", "t3"], "filtre : une pièce");
eq(filtrerParPiece(toutes, SANS_PIECE, P).map(t => t.id), ["t2"], "filtre : sans pièce");
eq(filtrerParPiece(toutes, "", P).length, 3, "filtre : toutes");
eq(grouperParPiece(toutes, P).map(g => [g.nom, g.taches.length]), [["Salle de bain", 2], ["Sans pièce", 1]], "regroupement : ordre des pièces puis « Sans pièce », groupes vides masqués");
O = detacherPiece(O, "sdb");
eq(O.flatMap(o => o.taches.map(t => t.piece_id ?? null)), [null, null, null], "pièce supprimée : les tâches sont détachées");
eq(grouperParPiece([{ id: "x", piece_id: "inconnue" }], P)[0].nom, "Sans pièce", "pièce inconnue : comptée sans pièce");

// Répartition des heures
eq(repartirHeures(10, 3), [3.33, 3.33, 3.34], "répartition égale : la dernière part absorbe l'arrondi");
eq(somme(repartirHeures(7.5, 4).map(h => ({ h })), "h"), 7.5, "répartition égale : la somme vaut le total");
eq(repartirHeures(5, 0), [], "répartition : aucune part");

// Duplication par pièce : total conservé
const tache = { id: "t1", nom: "Cloison", heures_estimees: 12, heures_vendues: 10, ratio: 40, avancement: 30, heures_reelles: 4, ouvriers: ["Davy"], piece_id: null };
const parts = [{ piece_id: "sdb", heures: 3 }, { piece_id: "ch1", heures: 5 }, { piece_id: "sej", heures: 4 }];
const res = dupliquerTacheParPieces(tache, parts, ["n1", "n2"]);
ok(res.ok, "duplication acceptée quand la répartition tombe juste");
eq(res.taches.map(t => t.id), ["t1", "n1", "n2"], "duplication : la première pièce garde la tâche d'origine, les autres sont des copies");
eq(res.taches.map(t => t.piece_id), ["sdb", "ch1", "sej"], "duplication : une pièce par tâche");
eq(somme(res.taches, "heures_estimees"), 12, "duplication : le total des heures estimées est conservé");
eq(somme(res.taches, "heures_vendues"), 10, "duplication : le total des heures vendues est conservé (dérive inchangée)");
eq(somme(res.taches, "ratio"), 40, "duplication : le total des ratios est conservé");
eq(res.taches.map(t => t.heures_vendues), [2.5, 4.17, 3.33], "duplication : heures vendues réparties comme les heures estimées");
eq([res.taches[0].avancement, res.taches[1].avancement, res.taches[2].avancement], [30, 0, 0], "duplication : l'origine garde son avancement, les copies partent à 0 %");
ok(res.taches[0].heures_reelles === 4 && !("heures_reelles" in res.taches[1]), "duplication : les heures pointées restent sur l'origine");
eq(tache.heures_estimees, 12, "duplication : la tâche d'entrée n'est pas modifiée");
const faux = dupliquerTacheParPieces(tache, [{ piece_id: "sdb", heures: 6 }, { piece_id: "ch1", heures: 5 }], ["n1"]);
ok(!faux.ok && /doit être égale/.test(faux.erreur), "duplication refusée si la répartition ne tombe pas juste");
ok(!dupliquerTacheParPieces(tache, [{ piece_id: "sdb", heures: 12 }], []).ok, "duplication refusée avec une seule pièce");
const sansVendues = dupliquerTacheParPieces({ id: "t9", heures_estimees: 2 }, [{ piece_id: "a", heures: 1 }, { piece_id: "b", heures: 1 }], ["c"]);
ok(sansVendues.ok && !("heures_vendues" in sansVendues.taches[1]), "duplication : pas d'heures vendues inventées");

console.log(`verif-pieces-phasage : ${nbOk} contrôles OK (données fictives)`);
