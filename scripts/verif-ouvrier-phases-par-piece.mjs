#!/usr/bin/env node
// Vérifie la vue « Par pièce » de l'onglet « Phases » de l'espace ouvrier
// (module pur mesPhasesV1.mjs : phasesParPiece, detailsTache, pièces lues par
// construireMesPhases).
//
// DONNÉES : toutes FICTIVES, écrites ici, au format renvoyé par la fonction
// serveur ouvrier_mes_phases (migration 20261106120000). Aucune donnée de
// production.
//
// Contrôles :
//   1. pièces dans l'ordre du conducteur, puis « Tout le logement », puis
//      « Sans pièce » (pièce retirée comprise) ; aucune tâche cachée ; pièce
//      sans tâche non listée ;
//   2. consignes et photos de la pièce lues comme dans le compte rendu
//      (textes vides écartés) ;
//   3. détails de personnalisation : nom personnalisé, pièce, mur, m²
//      (unité de l'ouvrage), ouvrage dans la vue par pièce ;
//   4. « Mes tâches » : seulement les tâches où l'ouvrier est affecté ;
//   5. mêmes tâches, mêmes heures que la vue par phase (aucun recalcul) ;
//   6. RPC d'avant la migration (sans pièces ni mur) : rien de vide ajouté.
//
//   node scripts/verif-ouvrier-phases-par-piece.mjs
import assert from "node:assert/strict";
import { construireMesPhases, phasesParPiece, detailsTache } from "../src/Renovation/mesPhasesV1.mjs";

let nbOk = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };
const ok = (c, msg) => { assert.ok(c, msg); nbOk++; };

const tache = (id, o) => ({
  id, nom: `Tâche ${id}`, nom_perso: "", piece_id: "", mur: "", avancement: 0,
  heures_vendues: 2, heures_validees: 0, heures_en_attente: 0, mes_heures: 0,
  ouvriers: [], est_mienne: false, ...o,
});

const payload = {
  chantier_id: "ch1", chantier_nom: "Chantier Test", modele: "v2", prenom: "Paul",
  pieces: [
    { id: "p2", nom: "Chambre", consigne: "  Protéger le parquet  ", consignes_murs: [{ mur: "Mur extérieur", texte: "Gaine à garder" }, { mur: "Vide", texte: "  " }], photos: ["preparation/ch1/p2/a.jpg", "", "preparation/ch1/p2/a.jpg"] },
    { id: "p1", nom: "Séjour" },
    { id: "p3", nom: "WC" }, // aucune tâche → non listée
  ],
  ouvrages_logement: ["o2"],
  phases: [
    { id: "g1", nom: "Gros œuvre", ordre: 1, couleur: "#f00", ouvrages: [
      { id: "o1", libelle: "Doublage", libelle_perso: "Doublage murs", unite: "m2", quantite: 50, heures_vendues_ouvrage: 6, ouvrage_complet: true, taches: [
        tache("t1", { nom: "Pose ossature", nom_perso: "Pose ossature — Chambre, Mur extérieur", piece_id: "p2", mur: "Mur extérieur", quantite_part: 16, est_mienne: true, ouvriers: ["Paul"] }),
        tache("t2", { nom: "Pose ossature", piece_id: "p1", mur: "Mur côté rue", quantite_part: "14.5" }),
        tache("t3", { nom: "Bandes", piece_id: "p_retiree" }),
      ] },
    ] },
    { id: "g2", nom: "Finitions", ordre: 2, couleur: "#0f0", ouvrages: [
      { id: "o2", libelle: "Nettoyage", unite: "", taches: [tache("t4", { nom: "Nettoyage fin de chantier", est_mienne: true, ouvriers: ["Paul"] })] },
      { id: "o3", libelle: "Divers", unite: "u", taches: [tache("t5", { nom: "Évacuation", piece_id: "p1", quantite_part: 3 })] },
    ] },
  ],
};

const r = construireMesPhases(payload);
const groupes = phasesParPiece(r, "tout");

// 1. Ordre et rangement
eq(groupes.map(g => g.nom), ["Chambre", "Séjour", "Tout le logement", "Sans pièce"], "ordre du conducteur, puis Tout le logement, puis Sans pièce ; WC sans tâche non listée");
eq(groupes.map(g => g.taches.map(t => t.id)), [["t1"], ["t2", "t5"], ["t4"], ["t3"]], "chaque tâche rangée au bon endroit (pièce retirée → Sans pièce)");
const toutesPhase = r.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).map(t => t.id).sort();
eq(groupes.flatMap(g => g.taches.map(t => t.id)).sort(), toutesPhase, "aucune tâche cachée : mêmes tâches que la vue par phase");

// 2. Consignes et photos
const chambre = groupes[0];
eq(chambre.consigne, "Protéger le parquet", "consigne nettoyée");
eq(chambre.consignes_murs, [{ mur: "Mur extérieur", texte: "Gaine à garder" }], "consigne de mur vide écartée");
eq(chambre.photos, ["preparation/ch1/p2/a.jpg"], "photos : chemins vides et doublons écartés");
eq([groupes[2].consigne, groupes[2].consignes_murs, groupes[2].photos], [null, [], []], "Tout le logement : aucune consigne inventée");

// 3. Détails de personnalisation
const t1 = chambre.taches[0];
eq(t1.nom, "Pose ossature — Chambre, Mur extérieur", "nom personnalisé affiché");
eq(t1.nom_devis, "Pose ossature", "nom du devis gardé à côté");
eq(detailsTache(t1), "Chambre · Mur extérieur · 16 m2", "vue par phase : pièce · mur · quantité (unité de l'ouvrage)");
eq(detailsTache(t1, { vuePiece: true }), "Doublage murs · Mur extérieur · 16 m2", "vue par pièce : ouvrage (libellé personnalisé) à la place de la pièce");
const t2 = groupes[1].taches[0];
eq(detailsTache(t2), "Séjour · Mur côté rue · 14,5 m2", "quantité texte acceptée, virgule française");
const t5 = groupes[1].taches[1];
eq(detailsTache(t5), "Séjour · 3 u", "sans mur : pièce · quantité");
const t4 = groupes[2].taches[0];
eq(detailsTache(t4), "", "rien de personnalisé : aucune ligne");
eq(detailsTache(groupes[3].taches[0]), "", "pièce retirée : pas de nom de pièce inventé");

// 4. Mes tâches
eq(phasesParPiece(r, "miennes").map(g => [g.nom, g.taches.map(t => t.id)]), [["Chambre", ["t1"]], ["Tout le logement", ["t4"]]], "Mes tâches : seulement celles où Paul est affecté");

// 5. Mêmes heures
const parId = new Map(r.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).map(t => [t.id, t]));
ok(groupes.every(g => g.taches.every(t => t === parId.get(t.id))), "vue par pièce : les mêmes objets tâche (heures, pastilles) que la vue par phase");

// 6. Ancienne réponse du serveur (sans pièces, sans mur)
const ancien = JSON.parse(JSON.stringify(payload));
delete ancien.pieces; delete ancien.ouvrages_logement;
ancien.phases.forEach(p => p.ouvrages.forEach(o => o.taches.forEach(t => { delete t.mur; delete t.quantite_part; delete t.piece_id; })));
const ra = construireMesPhases(ancien);
eq(ra.pieces, [], "sans pièces : liste vide (la bascule « Par pièce » n'apparaît pas)");
eq(phasesParPiece(ra, "tout").map(g => g.nom), ["Sans pièce"], "sans pièces : tout dans « Sans pièce », rien de caché");
ok(ra.phases.flatMap(p => p.ouvrages.flatMap(o => o.taches)).every(t => detailsTache(t) === ""), "sans champs : aucune ligne de détail vide");
eq(construireMesPhases(null).pieces, [], "payload absent : pas de pièces");
eq(phasesParPiece(construireMesPhases({ acces_refuse: true })), [], "accès refusé : rien");

console.log(`verif-ouvrier-phases-par-piece : ${nbOk} contrôles OK (données fictives)`);
