// Vérification « Préparer le chantier » (parcours guidé par logement), tranche 1 : moteur de découpage par
// pièce et par mur (données fictives uniquement).
import assert from "node:assert/strict";
import {
  tacheCommencee, granulariteParDefaut, resteAPlacer, prorata, totauxOuvrage,
  decouperOuvrage, compterIdsNecessaires, placerDansUnePiece, placerToutLeLogement,
  apercuDecoupage, etatOuvrage, compteurPlaces, marquerOuvragePlace, retirerOuvragePlace,
  majPreparation, etapeReprise, preparationDuPhasage, piecesRetirees, remplacerOuvrage,
  PIECES_RAPIDES,
} from "../src/Renovation/preparationChantierV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const geler = (o) => { Object.freeze(o); Object.values(o).forEach(v => v && typeof v === "object" && geler(v)); return o; };

// Données fictives : un logement, trois pièces.
const pieces = [{ id: "sej", nom: "Séjour / cuisine" }, { id: "ch", nom: "Chambre" }, { id: "sde", nom: "Salle d'eau" }];

// ── Tâche commencée ──
ok(!tacheCommencee({ id: "a", avancement: 0 }), "tâche neuve : pas commencée");
ok(tacheCommencee({ id: "a", avancement: 5 }), "commencée : avancement > 0");
ok(tacheCommencee({ id: "a", quantite_terminee: { rapport_id: "r1", le: "2026-10-01" } }), "commencée : quantité terminée marquée");
ok(!tacheCommencee({ id: "a", quantite_terminee: null }), "quantité terminée vide : pas commencée");
ok(tacheCommencee({ id: "a", heures_reelles: 2 }), "commencée : heures réelles sur la tâche (ancien format)");
ok(tacheCommencee({ id: "a", heures_reelles: [0, 1.5] }), "commencée : heures réelles au format tableau");
ok(tacheCommencee({ id: "a" }, { a: 3 }), "commencée : heures pointées passées en paramètre (objet)");
ok(tacheCommencee({ id: "a" }, new Map([["a", 1]])), "commencée : heures pointées passées en paramètre (Map)");
ok(tacheCommencee({ id: "a" }, { a: [{ heures: 2, tache_id: "a" }] }), "commencée : index des pointages par tâche");
ok(!tacheCommencee({ id: "a" }, { b: 4 }), "pointages d'une autre tâche : pas commencée");

// ── Granularité par défaut ──
eq(["Bandes placo", "Deuxième PASSE d'enduit", "Ponçage", "Peinture murs", "Impression", "Pose ossature métallique doublage", "Pose plaques BA13"].map(n => granulariteParDefaut({ nom: n })),
  ["piece", "piece", "piece", "piece", "piece", "mur", "mur"], "granularité : finitions par pièce, le reste par mur (casse et accents ignorés)");
eq(granulariteParDefaut({ nom: "Pose", nom_perso: "Enduit de lissage" }), "piece", "granularité : le libellé personnalisé compte aussi");

// ── Reste à placer ──
eq(resteAPlacer({ quantite: 42, unite: "m²" }, [{ quantite: 10 }, { quantite: "8" }, { quantite: "18,5" }]), { total: 42, place: 36.5, reste: 5.5, unite: "m²" }, "reste à placer");
eq(resteAPlacer({ quantite: null }, [{ quantite: 3 }]).reste, null, "sans quantité au devis : reste inconnu, jamais 0");

// ── Arrondi ──
eq(prorata(10, [1, 1, 1]), [3.33, 3.33, 3.34], "10 h sur 3 parts égales : la dernière absorbe l'arrondi");
eq(prorata(7, [10, 30]), [1.75, 5.25], "prorata des quantités");

// ── Découpage d'un doublage ──
const doublage = geler({
  id: "o1", libelle: "Doublage de mur", quantite: 42, unite: "m²",
  taches: [
    { id: "t1", nom: "Pose ossature métallique doublage", heures_estimees: 10, heures_vendues: 9, ratio: 40, avancement: 0 },
    { id: "t2", nom: "Bandes et enduit", nom_perso: "Bandes doublage", heures_estimees: 6, heures_vendues: 5, ratio: 25, avancement: 0 },
    { id: "t3", nom: "Pose plaques", heures_estimees: 8, heures_vendues: 7, ratio: 35, avancement: 20, ouvriers: ["Ouvrier fictif"] },
  ],
});
const lignes = [
  { piece_id: "sej", mur: "Mur côté rue", quantite: 14 },
  { piece_id: "sej", mur: "Mur côté palier", quantite: 14 },
  { piece_id: "ch", mur: "", quantite: 14 },
];
const opts = { pieces };
eq(compterIdsNecessaires(doublage, lignes, opts), 3, "ids : 2 pour l'ossature (3 murs), 1 pour les bandes (2 pièces), 0 pour la tâche commencée");
const res = decouperOuvrage(doublage, lignes, { ...opts, nouveauxIds: ["n1", "n2", "n3"] });
ok(res.ok, "découpage accepté quand tout est placé");
eq(totauxOuvrage(res.ouvrage), totauxOuvrage(doublage), "conservation : heures estimées, vendues et ratios identiques au centième");
eq(totauxOuvrage(res.ouvrage), { heures_estimees: 24, heures_vendues: 21, ratio: 100 }, "totaux de l'ouvrage fictif");
const T = res.ouvrage.taches;
eq(T.map(t => t.id), ["t1", "n1", "n2", "t2", "n3", "t3"], "ordre : les parts remplacent la tâche à sa place");
eq(T.slice(0, 3).map(t => t.heures_estimees), [3.33, 3.33, 3.34], "ossature : 10 h sur 3 murs égaux");
eq(T.slice(0, 3).map(t => [t.piece_id, t.mur ?? null, t.quantite_part]), [["sej", "Mur côté rue", 14], ["sej", "Mur côté palier", 14], ["ch", null, 14]], "par mur : une part par mur");
eq(T.slice(0, 3).map(t => t.nom_perso), [
  "Pose ossature métallique doublage — Séjour / cuisine, Mur côté rue",
  "Pose ossature métallique doublage — Séjour / cuisine, Mur côté palier",
  "Pose ossature métallique doublage — Chambre",
], "libellé lisible : nom — pièce, mur");
ok(T.every(t => doublage.taches.some(o => o.nom === t.nom)), "on ne touche jamais au nom (lien bibliothèque)");
eq(T.slice(3, 5).map(t => [t.piece_id, t.quantite_part, t.heures_estimees, "mur" in t]), [["sej", 28, 4], ["ch", 14, 2]].map(x => [...x, false]), "fusion par pièce : les deux murs du séjour en une seule tâche, sans mur");
eq(T.slice(3, 5).map(t => t.nom_perso), ["Bandes doublage — Séjour / cuisine", "Bandes doublage — Chambre"], "libellé à partir du libellé personnalisé d'origine");
eq(T[5], doublage.taches[2], "tâche commencée rendue telle quelle");
eq(res.nonDecoupees, [{ id: "t3", nom: "Pose plaques" }], "tâche commencée signalée « déjà commencée, non découpée »");
eq([T[0].avancement, T[1].avancement], [0, 0], "parts neuves à 0 %");
eq(doublage.taches.length, 3, "l'ouvrage d'entrée n'est pas modifié");

// Refus
ok(!decouperOuvrage(doublage, lignes.slice(0, 2), { ...opts, nouveauxIds: ["a", "b", "c"] }).ok, "refus tant qu'il reste des m² à placer");
ok(/de trop/.test(decouperOuvrage(doublage, [...lignes, { piece_id: "sde", quantite: 1 }], { ...opts, nouveauxIds: ["a", "b", "c", "d", "e"] }).erreur), "refus si on place plus que le devis");
ok(/Identifiants/.test(decouperOuvrage(doublage, lignes, { ...opts, nouveauxIds: ["n1"] }).erreur), "refus si les ids neufs manquent");
ok(!decouperOuvrage(doublage, [{ piece_id: "inconnue", quantite: 42 }], { ...opts, nouveauxIds: [] }).ok, "refus : pièce inconnue");
ok(!decouperOuvrage({ ...doublage, quantite: null }, lignes, { ...opts, nouveauxIds: ["n1", "n2", "n3"] }).ok, "refus : ouvrage sans quantité au devis");

// Tâche commencée par des heures pointées seulement : jamais découpée
const parPointage = decouperOuvrage(doublage, lignes, { ...opts, heuresPointees: { t1: 1.5 }, nouveauxIds: ["n1"] });
ok(parPointage.ok && parPointage.ouvrage.taches[0] === doublage.taches[0], "heures pointées : la tâche reste telle quelle");
eq(parPointage.nonDecoupees.map(x => x.id), ["t1", "t3"], "heures pointées : signalée non découpée");

// Granularité modifiée tâche par tâche
const parPiece = decouperOuvrage(doublage, lignes, { ...opts, granularites: { t1: "piece" }, nouveauxIds: ["n1", "n2"] });
eq(parPiece.ouvrage.taches.slice(0, 2).map(t => [t.piece_id, t.quantite_part, t.heures_estimees]), [["sej", 28, 6.67], ["ch", 14, 3.33]], "granularité choisie : ossature par pièce");

// Une seule part : simple rattachement (aucune copie)
const unePart = decouperOuvrage(doublage, [{ piece_id: "sde", mur: "Mur douche", quantite: 42 }], { ...opts, nouveauxIds: [] });
ok(unePart.ok && unePart.creees.length === 0, "une seule part : aucune copie");
eq([unePart.ouvrage.taches[0].id, unePart.ouvrage.taches[0].piece_id, unePart.ouvrage.taches[0].heures_estimees, unePart.ouvrage.taches[0].nom_perso],
  ["t1", "sde", 10, "Pose ossature métallique doublage — Salle d'eau, Mur douche"], "une seule part : la tâche est rattachée, heures inchangées");

// Tâche sans heures estimées (base en ratio) : ratios au prorata des quantités
const enRatio = geler({ id: "o2", quantite: 30, taches: [{ id: "r1", nom: "Pose cloison", ratio: 60, heures_vendues: 12 }] });
const rr = decouperOuvrage(enRatio, [{ piece_id: "sej", quantite: 10 }, { piece_id: "ch", quantite: 20 }], { ...opts, nouveauxIds: ["x"] });
eq(rr.ouvrage.taches.map(t => [t.ratio, t.heures_vendues]), [[20, 4], [40, 8]], "base en ratio : ratios et heures vendues au prorata des m²");
eq(totauxOuvrage(rr.ouvrage), totauxOuvrage(enRatio), "base en ratio : totaux conservés");

// Arrondi sur trois pièces : 10 h, 10 vendues, ratio 100 sur 3 parts égales
const arr = decouperOuvrage({ id: "o3", quantite: 3, taches: [{ id: "a", nom: "Pose", heures_estimees: 10, heures_vendues: 10, ratio: 100 }] },
  [{ piece_id: "sej", quantite: 1 }, { piece_id: "ch", quantite: 1 }, { piece_id: "sde", quantite: 1 }], { ...opts, nouveauxIds: ["b", "c"] });
eq(arr.ouvrage.taches.map(t => t.heures_estimees), [3.33, 3.33, 3.34], "arrondi : 10 h sur 3 parts");
eq(totauxOuvrage(arr.ouvrage), { heures_estimees: 10, heures_vendues: 10, ratio: 100 }, "arrondi : les totaux tombent juste");

// ── Modes « une seule pièce » et « tout le logement » ──
const une = placerDansUnePiece(doublage, "ch", opts);
eq(une.ouvrage.taches.map(t => t.piece_id ?? null), ["ch", "ch", null], "une seule pièce : les tâches non commencées sont rattachées");
eq(totauxOuvrage(une.ouvrage), totauxOuvrage(doublage), "une seule pièce : totaux inchangés");
ok(!placerDansUnePiece(doublage, "x", opts).ok, "une seule pièce : pièce inconnue refusée");
const tout = placerToutLeLogement(doublage);
ok(tout.ok && tout.ouvrage === doublage, "tout le logement : rien ne change");

// ── Aperçu ──
const ap = apercuDecoupage(doublage, lignes, opts);
eq(ap.taches.length, 6, "aperçu : six tâches à l'écran des ouvriers");
eq(ap.taches.filter(t => t.nouvelle).length, 3, "aperçu : trois tâches nouvelles");
eq(ap.taches[5].dejaCommencee, true, "aperçu : la tâche commencée est signalée");
eq(doublage.taches.length, 3, "aperçu : rien n'est modifié");
ok(!apercuDecoupage(doublage, lignes.slice(0, 1), opts).ok, "aperçu : refus affiché tant que le reste n'est pas à 0");

// ── États et compteur ──
let prep = marquerOuvragePlace({ etape: "repartition" }, "o1");
prep = marquerOuvragePlace(prep, "o1");
eq(prep.ouvrages_places, ["o1"], "ouvrage placé une seule fois");
eq(retirerOuvragePlace(prep, "o1").ouvrages_places, [], "ouvrage retiré des placés");
const ouvs = [
  doublage,
  { id: "o4", taches: [{ id: "z", avancement: 100 }] },
  { id: "o5", taches: [{ id: "y" }] },
  { id: "o6", taches: [{ id: "w", piece_id: "ch" }, { id: "v" }] },
];
eq(ouvs.map(o => etatOuvrage(o, { preparation: prep, enCoursId: "o5" })), ["place", "deja_commence", "en_cours", "en_cours"], "états : placé, déjà commencé, en cours");
eq(etatOuvrage(ouvs[2], { preparation: prep }), "a_placer", "état : à placer");
eq(compteurPlaces(ouvs, { preparation: prep }).libelle, "1 / 3 placés", "compteur : les ouvrages entièrement commencés ne comptent pas");

// ── Enregistrer et quitter / reprise ──
const p2 = majPreparation(prep, { etape: "pieces", maj_le: "2026-11-06T10:00:00.000Z", par: "Conducteur fictif" });
eq(p2, { etape: "pieces", ouvrages_places: ["o1"], maj_le: "2026-11-06T10:00:00.000Z", par: "Conducteur fictif" }, "enregistrement : étape, date et auteur, ouvrages placés conservés");
eq(etapeReprise({ preparation: p2 }), "pieces", "reprise à l'étape enregistrée");
eq(etapeReprise({ preparation: { etape: "consignes" } }, ["pieces"]), "pieces", "reprise : étape pas encore disponible → Les pièces");
eq(etapeReprise({}), "pieces", "première ouverture : Les pièces");
eq(preparationDuPhasage({}).ouvrages_places, [], "préparation absente : aucun ouvrage placé");
eq(piecesRetirees(pieces, pieces.slice(1)), ["sej"], "pièces retirées repérées pour détacher leurs tâches");
eq(remplacerOuvrage([{ id: "o1" }, { id: "o9" }], { id: "o1", x: 1 }), [{ id: "o1", x: 1 }, { id: "o9" }], "remplacement d'un ouvrage dans la liste");
eq(PIECES_RAPIDES.length, 9, "ajout rapide : neuf pièces proposées");

console.log(`verif-preparation-chantier : ${nbOk} contrôles OK (données fictives)`);
