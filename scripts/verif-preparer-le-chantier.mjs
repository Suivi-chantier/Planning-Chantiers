// Vérification « Préparer le chantier » (parcours guidé par logement), tranche 1 : moteur de découpage par
// pièce et par mur (données fictives uniquement).
import assert from "node:assert/strict";
import {
  tacheCommencee, granulariteParDefaut, resteAPlacer, prorata, totauxOuvrage,
  decouperOuvrage, compterIdsNecessaires, placerDansUnePiece, placerToutLeLogement,
  apercuDecoupage, etatOuvrage, compteurPlaces, marquerOuvragePlace, retirerOuvragePlace,
  majPreparation, etapeReprise, preparationDuPhasage, piecesRetirees, remplacerOuvrage,
  PIECES_RAPIDES, ouvrageDejaDecoupe, repartitionActuelle, mettreLeResteDans, apercuPlacement, ouvrageSuivant,
  consignesDePiece, poserConsigne, poserConsigneMur, retirerConsigneMur, ajouterPhoto, retirerPhoto,
  piecesPourEnregistrement, mursDeLaPiece, nbTachesParPiece, controleFinal, marquerPreparationTerminee,
} from "../src/Renovation/preparationChantierV1.mjs";
import { piecesDuPhasage, ajouterPiece, renommerPiece, deplacerPiece, supprimerPiece } from "../src/Renovation/piecesPhasageV1.mjs";
import {
  OPTIONS_DEFAUT, basculerOption, logementsSources, correspondanceOuvrages, granularitesReprises, lignesSource,
  lignesEnProportion, copierPieces, compterPiecesACreer, copierPreparation, resumeSource, propositionPourOuvrage,
  retirerProposition, preparationApresCopie, libelleNormalise,
} from "../src/Renovation/preparationCopieV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const r2s = (L) => Math.round(L.reduce((s, l) => s + l.quantite, 0) * 100) / 100;
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

// ── Tranche 1b : étape « Où se fait chaque ouvrage » ──
// Ouvrage déjà découpé : reconnu, « Placé », répartition actuelle lisible.
ok(!ouvrageDejaDecoupe(doublage), "ouvrage neuf : pas encore découpé");
ok(!ouvrageDejaDecoupe({ taches: [{ id: "a", nom_perso: "Libellé saisi à la main" }] }), "un simple libellé personnalisé ne vaut pas découpage");
ok(ouvrageDejaDecoupe(res.ouvrage), "ouvrage découpé reconnu (parts avec m² / mur)");
eq(etatOuvrage(res.ouvrage, { preparation: {} }), "place", "ouvrage déjà découpé : Placé même hors de la liste des placés");
eq(repartitionActuelle(res.ouvrage, pieces), [
  { piece: "Séjour / cuisine", mur: "Mur côté rue", quantite: 14 },
  { piece: "Séjour / cuisine", mur: "Mur côté palier", quantite: 14 },
  { piece: "Chambre", mur: "", quantite: 14 },
], "répartition actuelle lue sur la tâche la plus finement découpée");
eq(repartitionActuelle(doublage, pieces), [], "pas de répartition actuelle sur un ouvrage neuf");

// « Mettre le reste dans… »
eq(mettreLeResteDans(doublage, lignes.slice(0, 2), "ch"), [...lignes.slice(0, 2), { piece_id: "ch", mur: "", quantite: 14 }], "reste mis dans une nouvelle ligne de la pièce");
eq(mettreLeResteDans(doublage, [{ piece_id: "ch", mur: "", quantite: "10,5" }], "ch"), [{ piece_id: "ch", mur: "", quantite: 42 }], "reste ajouté à la ligne sans mur existante");
eq(mettreLeResteDans(doublage, lignes, "ch"), lignes, "reste nul : rien ne change");
eq(mettreLeResteDans({ quantite: null }, [], "ch"), [], "reste inconnu : rien ne change");

// Aperçu des deux autres modes
const apUne = apercuPlacement(doublage, "piece", { pieces, pieceId: "sde" });
eq(apUne.taches.map(t => [t.piece, t.dejaCommencee]), [["Salle d'eau", false], ["Salle d'eau", false], ["", true]], "aperçu une seule pièce : pièce affichée, tâche commencée signalée");
ok(!apercuPlacement(doublage, "piece", { pieces }).ok, "aperçu une seule pièce : refus sans pièce choisie");
eq(apercuPlacement(doublage, "logement", { pieces }).taches.length, 3, "aperçu tout le logement : tâches inchangées");
eq(apercuPlacement(doublage, "plusieurs", { pieces, lignes }).taches.length, 6, "aperçu plusieurs pièces : même résultat que le découpage");

// Ouvrage suivant
const suite = [{ id: "a", taches: [{ id: "a1" }] }, { id: "b", taches: [{ id: "b1", avancement: 50 }] }, { id: "c", taches: [{ id: "c1" }] }, { id: "d", taches: [{ id: "d1" }] }];
eq(ouvrageSuivant(suite, "a", { preparation: { ouvrages_places: ["a", "c"] } })?.id, "d", "suivant : on saute les commencés et les placés");
eq(ouvrageSuivant(suite, "d", { preparation: { ouvrages_places: ["d"] } })?.id, "a", "suivant : on repart du début");
eq(ouvrageSuivant(suite, "d", { preparation: { ouvrages_places: ["a", "c", "d"] } }), null, "suivant : tout est placé");

// ── Tranche 2a : étape « Consignes & plans » ──
// Pièces fictives avec consignes et photos (chemins fictifs du bucket « photos »).
let pc = geler([{ id: "sej", nom: "Séjour / cuisine" }, { id: "ch", nom: "Chambre" }, { id: "sde", nom: "Salle d'eau" }]);
pc = poserConsigne(pc, "sde", "  Plaques hydro sur tous les murs ");
pc = poserConsigneMur(pc, "sej", "Mur côté rue", "Gaine électrique existante à conserver");
pc = poserConsigneMur(pc, "sej", "mur côté RUE ", "Gaine à conserver");
pc = poserConsigneMur(pc, "sej", "Mur côté palier", "   ");
pc = ajouterPhoto(pc, "sej", "preparation/chantier-fictif/sej/1_a.jpg");
pc = ajouterPhoto(pc, "sej", "preparation/chantier-fictif/sej/1_a.jpg");
pc = ajouterPhoto(pc, "sej", "preparation/chantier-fictif/sej/2_b.jpg");
pc = ajouterPhoto(pc, "ch", "preparation/chantier-fictif/ch/3_c.jpg");
eq(consignesDePiece(pc[0]).consignes_murs, [{ mur: "Mur côté rue", texte: "Gaine à conserver" }, { mur: "Mur côté palier", texte: "   " }], "consigne de mur : même mur (casse, espaces) modifié, pas dupliqué");
eq(consignesDePiece(pc[0]).photos, ["preparation/chantier-fictif/sej/1_a.jpg", "preparation/chantier-fictif/sej/2_b.jpg"], "photo : ajoutée une seule fois");
eq(pc[2].consigne, "  Plaques hydro sur tous les murs ", "consigne gardée telle quelle pendant la saisie");
eq(consignesDePiece({ id: "x", nom: "X" }), { consigne: "", consignes_murs: [], photos: [] }, "pièce sans consigne : lecture vide");
const aEcrire = piecesPourEnregistrement(pc);
eq(aEcrire, [
  { id: "sej", nom: "Séjour / cuisine", consignes_murs: [{ mur: "Mur côté rue", texte: "Gaine à conserver" }], photos: ["preparation/chantier-fictif/sej/1_a.jpg", "preparation/chantier-fictif/sej/2_b.jpg"] },
  { id: "ch", nom: "Chambre", photos: ["preparation/chantier-fictif/ch/3_c.jpg"] },
  { id: "sde", nom: "Salle d'eau", consigne: "Plaques hydro sur tous les murs" },
], "enregistrement : textes nettoyés, mur sans texte retiré, pièce sans consigne réduite à { id, nom }");
eq(piecesPourEnregistrement([{ id: "a", nom: "A", autre: 7, consigne: "", photos: [] }]), [{ id: "a", nom: "A", autre: 7 }], "enregistrement : champs inconnus conservés, champs vides supprimés");
eq(retirerConsigneMur(aEcrire, "sej", "MUR CÔTÉ RUE")[0].consignes_murs, [], "consigne de mur retirée");
eq(retirerPhoto(aEcrire, "sej", "preparation/chantier-fictif/sej/1_a.jpg")[0].photos, ["preparation/chantier-fictif/sej/2_b.jpg"], "photo retirée de la pièce");
eq(ajouterPhoto(aEcrire, "inconnue", "x.jpg"), aEcrire, "photo sur une pièce inconnue : rien ne change");
eq(poserConsigneMur(aEcrire, "sej", "  ", "texte"), aEcrire, "consigne de mur sans nom de mur : refusée");
geler(aEcrire);

// Consignes et photos conservées par tous les chemins qui réécrivent meta.pieces.
const metaRelu = { pieces: aEcrire, autre_champ: 1 };
const relues = piecesDuPhasage(metaRelu);
eq(relues, aEcrire, "relecture du phasage (piecesDuPhasage) : consignes et photos conservées");
eq(renommerPiece(relues, "sej", "Séjour")[0], { ...aEcrire[0], nom: "Séjour" }, "renommer : consignes et photos conservées");
eq(deplacerPiece(relues, "sde", -1).map(p => p.id), ["sej", "sde", "ch"], "déplacer : ordre changé");
eq(deplacerPiece(relues, "sde", -1)[1], aEcrire[2], "déplacer : consigne conservée");
const avecNouvelle = ajouterPiece(relues, "WC", "wc");
eq(avecNouvelle.slice(0, 3), aEcrire, "ajouter une pièce : les autres gardent consignes et photos");
eq(supprimerPiece(relues, "ch"), [aEcrire[0], aEcrire[2]], "retirer une pièce : les autres gardent consignes et photos");
// Panneau « Pièces » de Phasage V2 (PiecesPhasage.jsx) : mêmes opérations écrites en ligne.
const panneauRenomme = relues.map(x => (x.id === "ch" ? { ...x, nom: "Chambre 1" } : x));
eq(panneauRenomme[1].photos, aEcrire[1].photos, "panneau Pièces (renommer) : photos conservées");
eq([...relues, { id: "n", nom: "Cellier" }].slice(0, 3), aEcrire, "panneau Pièces (ajouter) : consignes conservées");
// Aller-retour comme saveMeta de Phasage V2 (meta relue puis fusionnée avec le patch), puis rechargement.
const saveMeta = (meta, patch) => ({ ...meta, ...patch });
const apresParcours = saveMeta(metaRelu, { pieces: piecesPourEnregistrement(renommerPiece(relues, "ch", "Chambre parents")), preparation: majPreparation({}, { etape: "consignes", maj_le: "2026-11-06T10:00:00Z", par: "Conducteur fictif" }) });
const apresPanneau = saveMeta(apresParcours, { pieces: ajouterPiece(piecesDuPhasage(apresParcours), "Placard", "pl") });
eq(piecesDuPhasage(apresPanneau).slice(0, 3).map(p => [p.consigne ?? null, p.consignes_murs?.length ?? 0, p.photos?.length ?? 0]),
  [[null, 1, 2], [null, 0, 1], ["Plaques hydro sur tous les murs", 0, 0]], "rechargement après parcours puis panneau Pièces : consignes et photos toujours là");
eq(apresPanneau.autre_champ, 1, "les autres champs de meta sont conservés");
eq(etapeReprise(apresPanneau, ["pieces", "repartition", "consignes"]), "consignes", "reprise à l'étape « Consignes & plans »");
eq(marquerPreparationTerminee({ etape: "consignes", ouvrages_places: ["o1"] }), { etape: "consignes", ouvrages_places: ["o1"], terminee: true }, "terminer la préparation : le reste conservé");

// Murs proposés et nombre de tâches par pièce.
const ouvsC = geler([
  { id: "oa", libelle: "Doublage", taches: [
    { id: "a1", nom: "Ossature", piece_id: "sej", mur: "Mur côté rue" },
    { id: "a2", nom: "Ossature", piece_id: "sej", mur: "mur côté rue" },
    { id: "a3", nom: "Ossature", piece_id: "sej", mur: "Mur côté palier" },
    { id: "a4", nom: "Bandes", piece_id: "ch" },
  ] },
]);
eq(mursDeLaPiece(ouvsC, { id: "sej", consignes_murs: [{ mur: "Mur fenêtre", texte: "x" }] }), ["Mur côté rue", "Mur côté palier", "Mur fenêtre"], "murs proposés : ceux des tâches, puis ceux des consignes, sans doublon");
eq(mursDeLaPiece(ouvsC, { id: "sde" }), [], "pièce sans tâche ni mur : aucun mur proposé");
eq(nbTachesParPiece(ouvsC, pieces), { sej: 3, ch: 1, sde: 0 }, "nombre de tâches par pièce");

// Contrôle final.
const ouvsF = geler([
  { id: "o1", libelle: "Doublage", taches: [{ id: "f1", nom: "Ossature", piece_id: "sej" }, { id: "f2", nom: "Bandes", nom_perso: "Bandes doublage", piece_id: "ch" }] },
  { id: "o2", libelle: "Nettoyage fin de chantier", taches: [{ id: "f3", nom: "Nettoyage" }, { id: "f4", nom: "Évacuation" }] },
  { id: "o3", libelle: "Plomberie", taches: [{ id: "f5", nom: "Alimentation" }, { id: "f6", nom: "Évacuation EU", piece_id: "piece-retiree" }] },
  { id: "o4", libelle: "Peinture", taches: [{ id: "f7", nom: "Peinture", piece_id: "sej" }, { id: "f8", nom: "Impression", avancement: 30 }] },
]);
const prepF = marquerOuvragePlace(marquerOuvragePlace(marquerOuvragePlace({}, "o1", "plusieurs"), "o2", "logement"), "o4", "piece");
eq(prepF.ouvrages_logement, ["o2"], "choix « Tout le logement » noté dans la préparation");
eq(marquerOuvragePlace(prepF, "o2", "piece").ouvrages_logement, [], "ouvrage revalidé dans une pièce : plus « tout le logement »");
eq(marquerOuvragePlace({ ouvrages_places: ["a"] }, "b"), { ouvrages_places: ["a", "b"] }, "sans mode : ancien comportement inchangé");
eq(retirerOuvragePlace(prepF, "o2").ouvrages_logement, [], "ouvrage retiré des placés : retiré aussi de « tout le logement »");
const cf = controleFinal(ouvsF, pieces, prepF);
eq(cf.etat, "a_completer", "contrôle final : des tâches sans pièce");
eq(cf.sansPiece.map(t => [t.nom, t.ouvrage]), [["Alimentation", "Plomberie"], ["Évacuation EU", "Plomberie"], ["Impression", "Peinture"]],
  "contrôle final : tâche sans pièce, tâche d'une pièce retirée, tâche commencée restée sans pièce dans un ouvrage réparti");
eq(cf.toutLeLogement.map(t => [t.nom, t.ouvrage]), [["Nettoyage", "Nettoyage fin de chantier"], ["Évacuation", "Nettoyage fin de chantier"]],
  "contrôle final : ouvrage « Tout le logement » listé à part, pas caché");
eq(cf.total, 8, "contrôle final : toutes les tâches comptées");
eq(controleFinal(ouvsF, pieces, {}).toutLeLogement, [], "ouvrage non placé : ses tâches sans pièce sont des oublis, pas « tout le logement »");
eq(controleFinal(ouvsF, pieces, {}).sansPiece.length, 5, "ouvrage non placé : tâches sans pièce toutes signalées");
eq(controleFinal([ouvsF[0], ouvsF[1]], pieces, prepF).etat, "logement", "contrôle final : aucun oubli, mais des tâches pour tout le logement");
eq(controleFinal([ouvsF[0]], pieces, prepF), { etat: "ok", total: 2, sansPiece: [], toutLeLogement: [] }, "contrôle final : toutes les tâches ont une pièce");
eq(controleFinal([], pieces, prepF).etat, "aucune_tache", "phasage sans tâche : rien à contrôler, jamais « tout va bien »");
eq(controleFinal([ouvsF[0]], [], prepF).sansPiece.length, 2, "aucune pièce définie : toutes les tâches sont sans pièce");
eq(controleFinal([ouvsF[1]], pieces, { ouvrages_places: ["o2"] }).sansPiece.length, 2, "ouvrage placé sans choix noté : jamais deviné « tout le logement »");
eq(controleFinal([{ id: "o5", libelle: "Électricité", taches: [{ id: "g1", nom: "Tableau", piece_id: "sej" }, { id: "g2", nom: "Mise en service" }] }], pieces, { ouvrages_places: ["o5"], ouvrages_logement: ["o5"] }),
  { etat: "logement", total: 2, sansPiece: [], toutLeLogement: [{ id: "g2", nom: "Mise en service", ouvrage: "Électricité", ouvrage_id: "o5" }] }, "tout le logement avec une tâche déjà rattachée : seule la tâche sans pièce est listée");


// ── Tranche 3 : copie depuis un autre logement (données fictives) ──
// Options et dépendances.
eq(OPTIONS_DEFAUT, { pieces: true, repartition: true, consignes: true, photos: false }, "options : photos décochées par défaut");
eq(basculerOption(OPTIONS_DEFAUT, "pieces", false), { pieces: false, repartition: false, consignes: false, photos: false }, "décocher les pièces décoche tout");
eq(basculerOption({ pieces: false, repartition: false, consignes: false, photos: false }, "consignes", true), { pieces: true, repartition: false, consignes: true, photos: false }, "cocher les consignes coche les pièces");
eq(basculerOption({ pieces: false, repartition: false, consignes: false, photos: false }, "repartition", true).pieces, true, "cocher la répartition coche les pièces");

// Logements source fictifs.
const piecesA = [
  { id: "a-sej", nom: "Séjour / cuisine", consigne: "Protéger le parquet", consignes_murs: [{ mur: "Mur côté rue", texte: "Gaine à conserver" }], photos: ["preparation/logement-a/a-sej/1.jpg"] },
  { id: "a-ch", nom: "Chambre" },
  { id: "a-sde", nom: "Salle d'eau", consigne: "Plaques hydro" },
];
// Source : doublage déjà découpé (50 m²), avec avancement / heures / ouvriers sur ses tâches
// (ils ne doivent JAMAIS passer dans la cible).
const doublageA = decouperOuvrage(
  { id: "oa-dbl", bibliotheque_id: "bib-dbl", libelle: "Doublage de mur", quantite: 50, unite: "m²", taches: [
    { id: "ta1", nom: "Pose ossature doublage", heures_estimees: 10, heures_vendues: 10, ratio: 40 },
    { id: "ta2", nom: "Bandes et 1ère passe doublage", heures_estimees: 5, heures_vendues: 5, ratio: 20 },
  ] },
  [{ piece_id: "a-sej", mur: "Mur côté rue", quantite: 14 }, { piece_id: "a-sej", mur: "Mur côté palier", quantite: 12 }, { piece_id: "a-ch", mur: "Mur extérieur", quantite: 16 }, { piece_id: "a-sde", mur: "Mur extérieur", quantite: 8 }],
  { pieces: piecesA, nouveauxIds: ["ta1b", "ta1c", "ta1d", "ta2b", "ta2c"] },
).ouvrage;
ok(doublageA && doublageA.taches.length === 7, "source fictive : doublage découpé en 7 tâches");
const doublageASale = { ...doublageA, taches: doublageA.taches.map(t => ({ ...t, avancement: 60, heures_reelles: 3, quantite_terminee: { le: "2026-11-01" }, ouvriers: ["Ouvrier fictif"] })) };
const sourceA = geler({
  chantier_id: "logement-a", nom: "LOGEMENT A (fictif)",
  meta: { pieces: piecesA, preparation: { etape: "consignes", ouvrages_places: ["oa-dbl", "oa-wc", "oa-net"], ouvrages_logement: ["oa-net"], terminee: true } },
  ouvrages: [
    doublageASale,
    { id: "oa-wc", bibliotheque_id: "bib-wc", libelle: "WC suspendu", quantite: 1, taches: [{ id: "w1", nom: "Pose WC", piece_id: "a-sde", heures_estimees: 3, avancement: 100, ouvriers: ["Ouvrier fictif"] }] },
    { id: "oa-net", bibliotheque_id: "bib-net", libelle: "Nettoyage fin de chantier", quantite: 1, taches: [{ id: "n1", nom: "Nettoyage", heures_estimees: 2 }] },
    { id: "oa-dou", bibliotheque_id: "bib-dou-A", libelle: "Receveur de douche  80 x 80", quantite: 1, taches: [{ id: "d1", nom: "Pose receveur", piece_id: "a-sde", heures_estimees: 2 }] },
    { id: "oa-pt1", bibliotheque_id: "bib-porte", libelle: "Porte intérieure", quantite: 1, taches: [] },
    { id: "oa-pt2", bibliotheque_id: "bib-porte", libelle: "Porte intérieure", quantite: 1, taches: [] },
    { id: "oa-elec", bibliotheque_id: "bib-elec-t2", libelle: "Électricité T2", quantite: 1, taches: [] },
  ],
});
const sourceB = { chantier_id: "logement-b", nom: "LOGEMENT B (fictif)", meta: { pieces: [{ id: "b1", nom: "Entrée" }], preparation: { ouvrages_places: ["x"] } }, ouvrages: [] };
const sourceVide = { chantier_id: "logement-c", nom: "LOGEMENT C (fictif)", meta: {}, ouvrages: [] };
eq(logementsSources([sourceA, sourceB, sourceVide]).logements.map(s => s.chantier_id), ["logement-a"], "logements proposés : préparation terminée");
eq(logementsSources([sourceB, sourceVide]), { critere: "partielle", logements: [sourceB] }, "aucune préparation terminée : repli sur pièces + ouvrage placé");
eq(logementsSources([sourceVide]).logements, [], "logement sans préparation : jamais proposé");

// Logement cible fictif (vierge) : doublage 35 m².
const cibleOuvrages = geler([
  { id: "oc-dbl", bibliotheque_id: "bib-dbl", libelle: "DOUBLAGE de mur (autre libellé)", quantite: 35, unite: "m²", taches: [
    { id: "tc1", nom: "Pose ossature doublage", heures_estimees: 7, heures_vendues: 7, ratio: 40 },
    { id: "tc2", nom: "Bandes et 1ère passe doublage", heures_estimees: 3.5, heures_vendues: 3.5, ratio: 20 },
    { id: "tc3", nom: "Tâche ajoutée à la main", heures_estimees: 1, heures_vendues: 1, ratio: 5 },
  ] },
  { id: "oc-wc", bibliotheque_id: "bib-wc", libelle: "WC suspendu", quantite: 1, taches: [{ id: "cw1", nom: "Pose WC", heures_estimees: 3 }] },
  { id: "oc-net", bibliotheque_id: "bib-net", libelle: "Nettoyage fin de chantier", quantite: 1, taches: [{ id: "cn1", nom: "Nettoyage", heures_estimees: 2 }] },
  { id: "oc-dou", bibliotheque_id: "bib-dou-C", libelle: "receveur de douche 80 x 80 ", quantite: 1, taches: [{ id: "cd1", nom: "Pose receveur", heures_estimees: 2 }] },
  { id: "oc-pt", bibliotheque_id: "bib-porte", libelle: "Porte intérieure", quantite: 1, taches: [] },
  { id: "oc-elec", bibliotheque_id: "bib-elec-t1", libelle: "Électricité T1", quantite: 1, taches: [] },
  { id: "oc-dbl2", bibliotheque_id: "bib-autre", libelle: "Isolation sans quantité", quantite: null, taches: [] },
]);

// Correspondance des ouvrages.
eq(libelleNormalise("  Receveur de douche  80 x 80 "), "receveur de douche 80 x 80", "libellé normalisé : espaces et casse");
const corr = correspondanceOuvrages(sourceA.ouvrages, cibleOuvrages);
eq(corr.map(c => [c.cible_id, c.source_id, c.par, c.raison || null]), [
  ["oc-dbl", "oa-dbl", "bibliotheque", null],
  ["oc-wc", "oa-wc", "bibliotheque", null],
  ["oc-net", "oa-net", "bibliotheque", null],
  ["oc-dou", "oa-dou", "libelle", null],
  ["oc-pt", null, null, "ambigu"],
  ["oc-elec", null, null, "aucune"],
  ["oc-dbl2", null, null, "aucune"],
], "correspondance : par bibliotheque_id, puis par libellé ; deux candidats → ambigu, pas de correspondance");
eq(correspondanceOuvrages([{ id: "s", bibliotheque_id: "b" }], [{ id: "c1", bibliotheque_id: "b" }, { id: "c2", bibliotheque_id: "b" }]).map(c => c.source_id), [null, null], "deux ouvrages cible pour une source : ambigu des deux côtés");

// Correspondance des tâches et granularité.
eq(granularitesReprises(doublageA, cibleOuvrages[0]), { tc1: "mur", tc2: "piece" }, "granularité reprise : par mur / par pièce ; tâche sans équivalent → défaut");
eq(granularitesReprises({ taches: [{ id: "x", nom: "Autre nom", nom_perso: "Ponçage — Chambre", quantite_part: 3 }] }, { taches: [{ id: "y", nom: "Ponçage" }] }), { y: "piece" }, "tâche retrouvée par libellé (sans le suffixe de pièce)");
eq(granularitesReprises(doublageA, { taches: [{ id: "y1", nom: "Pose ossature doublage" }, { id: "y2", nom: "Pose ossature doublage" }] }), {}, "deux tâches cible de même nom : ambigu, pas de reprise");

// Répartition en proportion.
eq(lignesSource(doublageA).map(l => [l.piece_id, l.mur, l.quantite]), [["a-sej", "Mur côté rue", 14], ["a-sej", "Mur côté palier", 12], ["a-ch", "Mur extérieur", 16], ["a-sde", "Mur extérieur", 8]], "répartition source lue sur la tâche la plus découpée");
const prop35 = lignesEnProportion(lignesSource(doublageA), 35);
eq(prop35.map(l => l.quantite), [9.8, 8.4, 11.2, 5.6], "proportion 50 → 35 m²");
eq(lignesEnProportion([{ piece_id: "p", quantite: 1 }, { piece_id: "q", quantite: 1 }, { piece_id: "r", quantite: 1 }], 10).map(l => l.quantite), [3.33, 3.33, 3.34], "proportion : arrondi au centième, la dernière ligne absorbe l'écart");
eq(r2s(lignesEnProportion([{ piece_id: "p", quantite: 7 }, { piece_id: "q", quantite: 13 }], 17.3)), 17.3, "proportion : somme = quantité cible");
eq(lignesEnProportion(lignesSource(doublageA), null), null, "quantité cible absente : pas de répartition par m²");

// Pièces : nouveaux identifiants, consignes, photos.
eq(compterPiecesACreer(piecesA, []), 3, "trois pièces à créer");
const cp1 = copierPieces(piecesA, [], ["n1", "n2", "n3"]);
eq(cp1.pieces.map(p => p.id), ["n1", "n2", "n3"], "pièces copiées avec de nouveaux identifiants");
eq(cp1.correspondance, { "a-sej": "n1", "a-ch": "n2", "a-sde": "n3" }, "table de correspondance ancien id → nouvel id");
ok(cp1.pieces.every(p => !("photos" in p)), "photos non copiées par défaut");
eq(cp1.pieces[0].consignes_murs, [{ mur: "Mur côté rue", texte: "Gaine à conserver" }], "consignes par mur copiées");
eq(copierPieces(piecesA, [], ["n1", "n2", "n3"], { photos: true }).pieces[0].photos, ["preparation/logement-a/a-sej/1.jpg"], "photos copiées seulement si cochées (mêmes chemins)");
ok(copierPieces(piecesA, [], ["n1", "n2", "n3"], { consignes: false }).pieces.every(p => !p.consigne && !p.consignes_murs), "consignes décochées : non copiées");
const cp2 = copierPieces(piecesA, [{ id: "deja", nom: "chambre", consigne: "Consigne locale" }], ["m1", "m2"]);
eq([cp2.pieces.map(p => p.id), cp2.correspondance["a-ch"], cp2.pieces[0].consigne], [["deja", "m1", "m2"], "deja", "Consigne locale"], "pièce de même nom déjà là : réutilisée, sa consigne gardée");
ok(!copierPieces(piecesA, [], ["n1"]).ok, "identifiants manquants : refus");

// Copie complète.
const cibleMeta = geler({ pieces: [], preparation: { etape: "depart" } });
const copie = copierPreparation(sourceA, { meta: cibleMeta, ouvrages: cibleOuvrages }, { options: OPTIONS_DEFAUT, nouveauxIds: ["p1", "p2", "p3"] });
ok(copie.ok, "copie acceptée");
eq(Object.keys(copie.propositions).sort(), ["oc-dbl", "oc-dou", "oc-net", "oc-wc"], "propositions pour les ouvrages qui ont une correspondance");
eq(copie.propositions["oc-dbl"].lignes, [
  { piece_id: "p1", mur: "Mur côté rue", quantite: 9.8 }, { piece_id: "p1", mur: "Mur côté palier", quantite: 8.4 },
  { piece_id: "p2", mur: "Mur extérieur", quantite: 11.2 }, { piece_id: "p3", mur: "Mur extérieur", quantite: 5.6 },
], "proposition doublage : nouvelles pièces, m² en proportion");
eq([copie.propositions["oc-wc"].mode, copie.propositions["oc-wc"].pieceId], ["piece", "p3"], "proposition « une seule pièce » (tâche source commencée ignorée pour le mode, rien d'autre copié)");
eq(copie.propositions["oc-net"].mode, "logement", "proposition « tout le logement »");
eq(copie.propositions["oc-dou"].source, { chantier_id: "logement-a", ouvrage_id: "oa-dou", correspondance: "libelle" }, "proposition : origine notée");
eq(copie.resume, { pieces: 3, propositions: 4, parBibliotheque: 3, parLibelle: 1, ambigus: 1, sansCorrespondance: 3 }, "résumé de la copie");
const json = JSON.stringify({ pieces: copie.pieces, propositions: copie.propositions });
ok(!/avancement|heures_reelles|heures_estimees|heures_vendues|quantite_terminee|ouvriers|Ouvrier fictif/.test(json), "aucune copie d'avancement, d'heures, de quantité terminée ni d'ouvriers");
ok(!("ouvrages" in copie) || Array.isArray(copie.ouvrages) && copie.ouvrages.every(o => !("taches" in o)), "la copie ne renvoie aucune tâche : les ouvrages cible ne sont pas modifiés");
eq(copierPreparation(sourceA, { meta: cibleMeta, ouvrages: cibleOuvrages }, { options: { ...OPTIONS_DEFAUT, repartition: false }, nouveauxIds: ["p1", "p2", "p3"] }).propositions, {}, "répartition décochée : aucune proposition");
eq(copierPreparation(sourceA, { meta: cibleMeta, ouvrages: cibleOuvrages }, { options: { pieces: false }, nouveauxIds: [] }).pieces, [], "pièces décochées : rien n'est copié");

// Cible commencée / déjà découpée / déjà placée : pas de proposition.
const cibleCommencee = cibleOuvrages.map(o => (o.id === "oc-wc" ? { ...o, taches: [{ ...o.taches[0], avancement: 10 }] } : o));
eq(copierPreparation(sourceA, { meta: cibleMeta, ouvrages: cibleCommencee }, { nouveauxIds: ["p1", "p2", "p3"] }).ouvrages.find(o => o.cible_id === "oc-wc").raison, "cible_commencee", "ouvrage cible entièrement commencé : intouché");
const dejaDecoupee = cibleOuvrages.map(o => (o.id === "oc-dbl" ? { ...o, taches: [{ ...o.taches[0], quantite_part: 35 }] } : o));
eq(copierPreparation(sourceA, { meta: cibleMeta, ouvrages: dejaDecoupee }, { nouveauxIds: ["p1", "p2", "p3"] }).propositions["oc-dbl"], undefined, "ouvrage cible déjà découpé : jamais redécoupé");
eq(copierPreparation(sourceA, { meta: { preparation: { ouvrages_places: ["oc-net"] } }, ouvrages: cibleOuvrages }, { nouveauxIds: ["p1", "p2", "p3"] }).propositions["oc-net"], undefined, "ouvrage cible déjà placé : pas de proposition");

// Proposition stockée dans meta.preparation, puis validation par le chemin de la tâche 2.
const prepCopie = preparationApresCopie(cibleMeta.preparation, copie, { source: sourceA, options: OPTIONS_DEFAUT, le: "2026-11-06T12:00:00Z" });
eq(prepCopie.copie, { depuis: "logement-a", nom: "LOGEMENT A (fictif)", options: OPTIONS_DEFAUT, le: "2026-11-06T12:00:00Z" }, "trace de la copie dans la préparation");
eq(prepCopie.ouvrages_places, [], "la copie ne marque aucun ouvrage « placé »");
const pDbl = propositionPourOuvrage(prepCopie, "oc-dbl", copie.pieces);
ok(pDbl && pDbl.mode === "plusieurs", "proposition relue pour l'étape 3");
eq(propositionPourOuvrage(prepCopie, "oc-dbl", copie.pieces.slice(0, 1)), null, "proposition ignorée si une de ses pièces a été retirée");
eq(propositionPourOuvrage(prepCopie, "oc-elec", copie.pieces), null, "ouvrage sans correspondance : aucune proposition (À placer)");
const valide = decouperOuvrage(cibleOuvrages[0], pDbl.lignes, { pieces: copie.pieces, granularites: pDbl.granularites,
  nouveauxIds: Array.from({ length: compterIdsNecessaires(cibleOuvrages[0], pDbl.lignes, { granularites: pDbl.granularites }) }, (_, i) => `v${i}`) });
ok(valide.ok, "validation de la proposition (decouperOuvrage → dupliquerTacheParPieces)");
eq(totauxOuvrage(valide.ouvrage), totauxOuvrage(cibleOuvrages[0]), "copie puis validation : heures estimées, vendues et ratios identiques avant / après");
eq(totauxOuvrage(valide.ouvrage), { heures_estimees: 11.5, heures_vendues: 11.5, ratio: 65 }, "totaux de l'ouvrage cible fictif");
eq(valide.ouvrage.taches.filter(t => t.nom === "Pose ossature doublage").map(t => t.quantite_part), [9.8, 8.4, 11.2, 5.6], "ossature : une part par mur, m² proposés");
eq(valide.ouvrage.taches.filter(t => t.nom === "Bandes et 1ère passe doublage").map(t => t.quantite_part), [18.2, 11.2, 5.6], "bandes : par pièce, comme la source");
ok(valide.ouvrage.taches.every(t => !t.avancement && !(t.ouvriers || []).length && !t.heures_reelles && !t.quantite_terminee), "tâches validées : ni avancement, ni heures réelles, ni ouvriers venus de la source");
const apresValid = retirerProposition(marquerOuvragePlace(prepCopie, "oc-dbl", "plusieurs"), "oc-dbl");
eq([apresValid.ouvrages_places, "oc-dbl" in apresValid.propositions, Object.keys(apresValid.propositions).length], [["oc-dbl"], false, 3], "validation : ouvrage placé, sa proposition consommée, les autres gardées");

// Résumé d'une carte.
eq(resumeSource(sourceA, cibleOuvrages), { pieces: 3, repartis: 3, consignes: 3, photos: 1, identiques: 4, totalCible: 7 }, "carte du logement source");

console.log(`verif-preparer-le-chantier : ${nbOk} contrôles OK (données fictives)`);
