#!/usr/bin/env node
// Vérifie la normalisation des données d'opération en « modèle d'export »
// (src/Renovation/operationExportModele.mjs). Module PUR : les entrées sont des
// lignes de base écrites en dur, à la forme RÉELLE des tables Supabase.
//   node scripts/verif-operation-export-modele.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const {
  normaliserChantier, assemblerModele, agregerOperation,
  statutCommande, documentCommande, texteOuNull,
} =
  await chargerModuleSource("../src/Renovation/operationExportModele.mjs", import.meta.url);
const { construireMarkdownOperation } =
  await chargerModuleSource("../src/Renovation/operationMarkdown.mjs", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ─── FIXTURES : la forme exacte des lignes de la base ────────────────────────

// phasages.ouvrages[] et plan_travaux tels qu'ils existent en production.
const PHASAGE = {
  id: "ph-1",
  chantier_id: "c1",
  chantier_nom: "LOT A",
  updated_at: "2026-09-17T13:40:00.000Z",
  ouvrages: [
    {
      id: "o1", code_ouvrage: "CLO-048", libelle: "Cloisons 48", libelle_devis: "Cloison 48 + isolation",
      lot_id: "murs_cloison", quantite: "20", unite: "m²", prix_ht: 4000, cout_materiaux: 800,
      heures_devis: 40, heures_estimees: 38, bibliotheque_id: "bib-1", bibliotheque_ref: "cloison_48",
      materiaux_liens: [
        { materiau_id: "mat-1", quantite: "1,05" },
        { materiau_id: "mat-inconnu", quantite: 2, commande_le: "2026-09-01" },
      ],
      taches: [
        // Volontairement DANS LE DÉSORDRE : chrono_ordre doit primer.
        { id: "t2", nom: "Plaquage", chrono_groupe_id: "g1", chrono_ordre: 2, avancement: 0, heures_estimees: 8, heures_vendues: 9, ratio: 35, ouvriers: ["Kev"], date_prevue: "2026-10-06", predecesseurs: ["t1"] },
        { id: "t1", nom: "Ossature", chrono_groupe_id: "g1", chrono_ordre: 1, avancement: 100, heures_estimees: 6, heures_vendues: 7, ratio: 25, ouvriers: ["Kev", "Margaux"], date_prevue: "2026-10-03" },
        { id: "t3", nom: "Tâche orpheline", avancement: 50, heures_estimees: 3 },
      ],
    },
    {
      id: "o2", libelle: "", lot_id: "inconnu", quantite: null, prix_ht: 0, heures_devis: 0, taches: [],
    },
  ],
  plan_travaux: {
    meta: {
      // Donnés dans le désordre : `ordre` doit primer.
      chrono_groupes: [
        { id: "g2", nom: "Peinture", ordre: 80, couleur: "#ec4899", groupe_type_id: "gt_peinture" },
        { id: "g1", nom: "Ossature placo", ordre: 50, couleur: "#d97706", groupe_type_id: "gt_ossature" },
      ],
      chrono_jalons: [{ id: "j1", nom: "Contrôle — Ossature placo", type: "controle", ordre: 16, groupe_id: "g1", date: null }],
      cycle_vie_etapes: {
        metres: { fait: true, date: "2026-05-02T08:00:00.000Z", auteur: "Loris", donnees: {} },
        reponse_client: { fait: false, date: null, auteur: null, donnees: { reponse: "accepte" } },
        devis_signe: {
          pieces_jointes: [
            { path: "cycle-vie/ph-1/devis_signe/1757000000000_Devis.pdf", nom: "Devis signé.pdf", taille: 120000, type: "application/pdf", date: "2026-05-20T10:00:00.000Z", auteur: "Loris" },
          ],
        },
      },
      cycle_vie_phase_declaree: { phaseId: "cv_travaux", auteur: "Loris", date: "2026-08-01" },
      prix_vendu: 4000, fg_taux_horaire: 6, marge_vendue_cible: 45,
      reprise_heures: 10, reprise_taux: 22,
      previsionnel: {
        blocs: [{ id: "b1", type: "mois", titre: "Octobre 2026", lignes: ["Ossature", "Peinture"] }],
        note_bas: "Dates prévisionnelles.", livraison_mois: "Nov.", livraison_annee: "2026",
      },
    },
  },
};

const POINTAGES = [
  { chantier_id: "c1", tache_id: "t1", ouvrier: "Kev", date: "2026-10-03", heures: 6, taux_horaire: 20, type_pointage: "tache" },
  { chantier_id: "c1", tache_id: "t2", ouvrier: "Margaux", date: "2026-10-06", heures: 4, taux_horaire: 22, type_pointage: "tache" },
  { chantier_id: "c1", tache_id: null, ouvrier: "Kev", date: "2026-10-06", heures: 1, taux_horaire: 20, type_pointage: "indirect", motif_indirect: "Trajet" },
];

const FINANCE = {
  brut: { prixHTChantier: 4000, avancementChantier: 52, coutMOTotalChantier: 262, margeChantier: 1200, heuresVenduesChantier: 40, heuresReellesTotalChantier: 11 },
  lots: [
    { id: "murs_cloison", label: "Murs & cloisons", nbOuvrages: 1, heuresVendues: 16, heuresReelles: 10, avancement: 52, ratioDerive: 1.2, vide: false },
    { id: "peinture", label: "Peinture", nbOuvrages: 0, heuresVendues: 0, heuresReelles: 0, avancement: 0, ratioDerive: null, vide: true },
  ],
  warnings: [{ code: "derive_lot", gravite: "alerte", message: "Lot Murs & cloisons : dérive d'heures ×1,20." }],
};

const SOURCES = {
  rapports: [
    { chantier_id: "c1", ouvrier: "Kev", date_rapport: "03/10/2026", submitted_at: "2026-10-03T17:00:00.000Z", statut: "valide", valide_par: "Loris", taches: [{ planifie: "Ossature", statut: "faite", avancement: 100, heures_reelles: 6, photos: ["u1"] }], remarque: "RAS", photos_chantier: [], heures_indirectes: [] },
    { chantier_id: "c1", ouvrier: "Margaux", date_rapport: "06/10/2026", submitted_at: "2026-10-06T17:00:00.000Z", statut: "en_attente", valide_par: null, taches: [{ planifie: "Plaquage", statut: "en_cours", avancement: 30, heures_reelles: 4, photos: [] }], remarque: null, photos_chantier: ["u2"], heures_indirectes: [{ motif: "Trajet", heures: 1 }] },
  ],
  lignes: [
    { chantier_id: "c1", libelle: "Plaque BA13", reference: "BA13", quantite: 15, unite: "m²", prix_unitaire: 10, prix_total: 150, materiau_id: "mat-1", ouvrage_id: "o1", lot_id: "murs_cloison", created_at: "2026-09-12T09:00:00.000Z", commande: { doc_numero: "BL-1", numero_en_attente: false, date_doc: "2026-09-12", fournisseur_nom: "Point P", statut_completude: "complete", statut_facturation: "en_attente_facture" } },
  ],
  besoins: [{ chantier_id: "c1", article: "Vis", quantite: "3", unite: "boîte", ouvrier_demandeur: "Kev", priorite: "urgent", statut: "en_attente", notes: null, created_at: "2026-09-15T07:00:00.000Z", materiau_id: null }],
  controles: [{ chantier_id: "c1", groupe_id: "g1", groupe_nom: "Ossature placo", date_controle: "2026-10-10T09:00:00.000Z", auteur: "Loris", nb_taches: 2, nb_conformes: 1 }],
  reserves: [
    { chantier_id: "c1", groupe_id: "g1", tache_id: "t2", tache_nom: null, statut: "ouverte", commentaire: "Ponçage", auteur: "Loris", created_at: "2026-10-10T09:05:00.000Z", levee_le: null, levee_par: null },
    { chantier_id: "c1", groupe_id: "g1", tache_id: "t1", tache_nom: "Ossature", statut: "ouverte", commentaire: "Repris", auteur: "Loris", created_at: "2026-10-09T09:05:00.000Z", levee_le: "2026-10-11T09:00:00.000Z", levee_par: "Loris" },
  ],
  visites: [{ chantier_id: "c1", date: "2026-10-08", intervenant: "Loris", meteo: "Pluie", statut: "terminee", note_generale: "RAS", lots_audites: ["murs_cloison"], audit: { murs_cloison: [{ ouvrage_libelle: "Cloisons 48", nom: "Bandes", statut: "non_conforme", commentaire: "À reprendre" }, { ouvrage_libelle: "Cloisons 48", nom: "Ossature", statut: null, commentaire: "" }] }, checklist: [{ label: "EPI", statut: "ok", commentaire: "" }] }],
  notesChantier: [{ chantier_id: "c1", contenu: "Clé sous le paillasson.", updated_at: "2026-09-01T08:00:00.000Z" }],
  notesPlanning: [{ chantier_id: "c1", contenu: "   ", updated_at: "2026-09-01T08:00:00.000Z" }],
  plans: [{ chantier_id: "c1", name: "RDC.plan", created_at: "2026-06-01T08:00:00.000Z", updated_at: "2026-06-02T08:00:00.000Z" }],
  factures: [{ chantier_id: "c1", numero: "F-1", ligne_nom: "Acompte", date_facture: "2026-08-31", montant_ht: 1200, statut: "emise", date_encaissement: null, document_nom: "F-1.pdf", source: "manuel" }],
  cells: [
    { chantier_id: "c1", week_id: "2026-W41", jour: "Mardi", planifie: "Plaquage", reel: null, ouvriers: ["Kev"] },
    { chantier_id: "c1", week_id: "2026-W41", jour: "Lundi", planifie: "Ossature", reel: "fait", ouvriers: ["Kev"] },
    { chantier_id: "c1", week_id: "2026-W41", jour: "Mercredi", planifie: "", reel: "", ouvriers: [] },
  ],
  avancement: [{ chantier_id: "c1", avancement: 40, taches_terminees: 1, taches_total: 3, date_snapshot: "2026-10-04" }],
  suggestions: [{ chantier_id: "c1", designation_libre: "Colle carrelage", unite: "sac", quantite_totale: 4, precision_ouvrier: "gris", statut: "en_attente", cree_le: "2026-10-05T07:00:00.000Z", materiau_id: null }],
  todos: [
    { id: "x", texte: "Relancer le plaquiste", chantier_id: "c1", assignes: [{ email: "l@x.fr", nom: "Loris" }], date_limite: "2026-10-20", priorite: "haute", fait: false, note: null },
    { id: "y", texte: "Commander la peinture", chantier_id: "c1", assigne_email: "d@x.fr", assigne_nom: "Davy", date_limite: null, priorite: "normale", fait: true, note: "Fait le 02/10" },
  ],
  projets: [{
    projet: { id: "p1", client_nom: "Martin", client_prenom: "Léa", client_societe: null, client_email: "lea@x.fr", client_telephone: "0600000000", client_adresse: "3 rue A", client_code_postal: "49000", client_ville: "Angers", devis_objet: "Réno LOT A", logement_reference: "A1", mode_coefficient: "global", coefficient_global_valeur: 1.35, coefficient_global_libelle: "Standard", mode_taux_horaire: "global", taux_horaire_global_valeur: 52, taux_horaire_global_libelle: "Taux 2026" },
    lignes: [
      { projet_id: "p1", code_ouvrage: "CLO-048", item: "Cloison 48", zone: "Séjour", quantite: "20", unite: "m²", prix_unitaire: 200, coefficient_source: "specifique", coefficient_ligne_valeur: 1.5, coefficient_origine_valeur: 1.35, coef_vente: null, taux_horaire_source: "ouvrage", taux_horaire_ligne_valeur: null, taux_horaire_origine_valeur: 58, taux_horaire_vente: 52, ordre: 2 },
      { projet_id: "p1", code_ouvrage: "PEI-001", item: "Peinture", zone: null, quantite: "30", unite: "m²", prix_unitaire: 25, coefficient_source: "heritage", coefficient_ligne_valeur: null, coefficient_origine_valeur: 1.35, coef_vente: null, taux_horaire_source: "heritage", taux_horaire_ligne_valeur: null, taux_horaire_origine_valeur: 52, taux_horaire_vente: 52, ordre: 1 },
    ],
  }],
};

const CONTEXTE = {
  chantier: { id: "c1", nom: "LOT A", couleur: "#84cc16", statut: "en_cours", operation_id: "op_1" },
  phasage: PHASAGE,
  pointages: POINTAGES,
  finance: FINANCE,
  adresse: "12 rue des Lilas",
  statutLabel: "En cours",
  lots: [{ id: "murs_cloison", label: "Murs & cloisons" }, { id: "peinture", label: "Peinture" }],
  tauxHoraires: { Kev: 20, Margaux: 22 },
  materiauxById: { "mat-1": { id: "mat-1", nom: "Plaque BA13", reference: "BA13", unite: "m²", fournisseur: "Point P" } },
  ratiosById: { "bib-1": { id: "bib-1", identifiant: "cloison_48", unite: "m²", cadence: 0.8, coefficient_vente_valeur: 1.35, taux_horaire_vente_valeur: 52 } },
  equipeParGroupeType: {
    gt_ossature: {
      groupeTypeNom: "Ossature placo",
      equipe: { id: "eq_so", nom: "Second œuvre", externe: false, responsables: ["Davy"], membres: [{ ouvrier: "Kev" }] },
    },
    gt_peinture: {
      groupeTypeNom: "Peinture",
      equipe: { id: "eq_externe", nom: "Externe", externe: true, responsables: [], membres: [] },
    },
  },
  sources: SOURCES,
  aujourdhui: "2026-10-07",
};

const C = normaliserChantier(CONTEXTE);

// Chantier sans phasage ni aucune source : tout doit rester vide, jamais casser.
const VIDE = normaliserChantier({
  chantier: { id: "c2", nom: "LOT B", statut: "planifie" },
  phasage: null, pointages: [], finance: null, adresse: null, statutLabel: "Planifié",
  lots: [], tauxHoraires: {}, materiauxById: {}, ratiosById: {}, equipeParGroupeType: {},
  sources: {}, aujourdhui: "2026-10-07",
});

const MODELE = assemblerModele({
  op: { id: "op_1", nom: "Fourmond", adresse: "12 rue des Lilas", couleur: "#84cc16" },
  chantiers: [C, VIDE],
  agg: { nbChantiers: 2, nbAvecPhasage: 1, vendu: 4000, marge: 1200, avancement: 52 },
  statutsLabels: { en_cours: "En cours", planifie: "Planifié" },
  erreurs: [],
  maintenant: new Date("2026-10-07T08:00:00.000Z"),
});

// ─── OUVRAGES ET TÂCHES ──────────────────────────────────────────────────────

test("les ouvrages reprennent les champs du phasage sans en inventer", () => {
  assert.equal(C.ouvrages.length, 2);
  const o = C.ouvrages[0];
  assert.equal(o.code, "CLO-048");
  assert.equal(o.libelle, "Cloisons 48");
  assert.equal(o.libelleDevis, "Cloison 48 + isolation");
  assert.equal(o.lotLabel, "Murs & cloisons");
  assert.equal(o.quantite, 20, "la quantité texte « 20 » doit devenir un nombre");
  assert.equal(o.prixHT, 4000);
  assert.equal(o.heuresDevis, 40);
  // avancementOuvrage de chantierFinance : pondération par heures_estimees sur
  // TOUTES les tâches de l'ouvrage — (100×6 + 0×8 + 50×3) / 17 = 44.
  assert.equal(o.avancement, 44, "l'avancement doit venir du module de calcul, pas d'une règle locale");
});

test("un ouvrage sans libellé ni lot connu ne produit ni vide ni null d'affichage", () => {
  const o = C.ouvrages[1];
  assert.equal(o.libelle, "(sans libellé)");
  assert.equal(o.lotLabel, null, "un lot inconnu vaut null, pas son identifiant technique");
  assert.equal(o.quantite, null);
  assert.deepEqual(o.taches, []);
});

test("un champ structuré ne devient jamais « [object Object] »", () => {
  // Cas RÉEL : bibliotheque_ref est une chaîne pour les anciens ouvrages et un
  // objet { id, code_ouvrage, sous_taches… } depuis l'import ProGBat.
  const c = normaliserChantier({
    ...CONTEXTE,
    phasage: {
      ...PHASAGE,
      ouvrages: [{
        ...PHASAGE.ouvrages[0],
        code_ouvrage: null,
        bibliotheque_ref: { id: "1788c067", importe_le: "2026-08-29T19:29:41.897Z", code_ouvrage: "S-011", sous_taches: [{ id: "st_1" }] },
      }],
    },
  });
  assert.equal(JSON.stringify(c).includes("[object Object]"), false);
  assert.equal(c.ouvrages[0].code, "S-011", "le code porté par l'objet doit être récupéré");
  assert.equal(c.ouvrages[0].bibliothequeRef, "cloison_48", "repli sur l'identifiant de la fiche bibliothèque");
});

test("la cadence et les conditions de vente de la bibliothèque sont conservées", () => {
  const o = C.ouvrages[0];
  assert.equal(o.cadence, 0.8);
  assert.equal(o.cadenceUnite, "m²");
  assert.equal(o.coefficientVente, 1.35);
  assert.equal(o.tauxHoraireVente, 52);
});

test("les sous-tâches gardent l'ordre chronologique enregistré, pas l'ordre du tableau", () => {
  const noms = C.phases.find((p) => p.id === "g1").taches.map((t) => t.nom);
  assert.deepEqual(noms, ["Ossature", "Plaquage"]);
});

test("chaque tâche porte une référence courte vers son ouvrage", () => {
  // Les intitulés d'ouvrage font couramment 400 signes : les tableaux de
  // tâches renvoient au numéro de ligne du tableau des ouvrages.
  assert.equal(C.ouvrages[0].reference, "CLO-048 (#1)");
  assert.equal(C.ouvrages[1].reference, "#2", "sans code, la référence reste le numéro interne");
  assert.equal(C.phases[0].taches[0].ouvrageRef, "CLO-048 (#1)");
  assert.equal(C.materiaux[0].ouvrageRef, "CLO-048 (#1)");
});

test("une sous-tâche porte ratio, heures, état, date et ouvriers", () => {
  const t = C.phases[0].taches[0];
  assert.equal(t.ratio, 25);
  assert.equal(t.heuresEstimees, 6);
  assert.equal(t.heuresVendues, 7);
  assert.equal(t.heuresReelles, 6, "heures issues du registre de pointage");
  assert.equal(t.etat, "Terminée");
  assert.equal(t.datePrevue, "2026-10-03");
  assert.deepEqual(t.ouvriers, ["Kev", "Margaux"]);
});

test("les dépendances sont résolues en noms de tâches, pas en identifiants", () => {
  const plaquage = C.phases[0].taches[1];
  assert.deepEqual(plaquage.dependances, ["Ossature"]);
});

test("une tâche sans groupe reconnu part dans « hors phase », jamais à la poubelle", () => {
  assert.equal(C.tachesHorsPhase.length, 1);
  assert.equal(C.tachesHorsPhase[0].nom, "Tâche orpheline");
  assert.equal(C.nbTaches, 3, "aucune tâche ne doit disparaître");
});

// ─── PHASES ──────────────────────────────────────────────────────────────────

test("les phases suivent leur ordre enregistré", () => {
  assert.deepEqual(C.phases.map((p) => p.nom), ["Ossature placo", "Peinture"]);
  assert.deepEqual(C.phases.map((p) => p.ordre), [50, 80]);
});

test("une phase porte son équipe, ses bornes de dates et son dernier contrôle", () => {
  const p = C.phases[0];
  assert.equal(p.groupeTypeNom, "Ossature placo");
  assert.equal(p.equipeNom, "Second œuvre");
  assert.equal(p.equipeExterne, false);
  assert.equal(p.debut, "2026-10-03");
  assert.equal(p.fin, "2026-10-06");
  assert.equal(p.nbTaches, 2);
  assert.equal(p.termine, false);
  assert.equal(p.controle.nbConformes, 1);
  // Avancement pondéré par les heures vendues : (100×7 + 0×9) / 16 = 44.
  assert.equal(p.avancement, 44);
});

test("une phase vide reste visible avec des compteurs à zéro", () => {
  const p = C.phases[1];
  assert.equal(p.nbTaches, 0);
  assert.equal(p.avancement, 0);
  assert.equal(p.debut, null);
});

test("les bornes du chantier viennent des dates réellement saisies", () => {
  assert.deepEqual(C.planning, { debut: "2026-10-03", fin: "2026-10-06" });
  assert.deepEqual(VIDE.planning, { debut: null, fin: null });
});

// ─── MATÉRIAUX ───────────────────────────────────────────────────────────────

test("les matériaux liés sont résolus et leurs quantités calculées comme à l'écran", () => {
  assert.equal(C.materiaux.length, 2);
  const m = C.materiaux[0];
  assert.equal(m.nom, "Plaque BA13");
  assert.equal(m.fournisseur, "Point P");
  assert.equal(m.quantiteParUnite, 1.05, "« 1,05 » doit être lu comme 1,05");
  assert.equal(Math.round(m.quantiteTotale * 100) / 100, 21);
  assert.equal(m.quantiteCommandee, 15);
});

test("un matériau disparu de la bibliothèque est conservé et signalé", () => {
  const m = C.materiaux[1];
  assert.equal(m.nom, "Matériau introuvable en bibliothèque");
  assert.equal(m.statut, "Marqué commandé");
  assert.equal(m.quantiteCommandee, null, "aucune ligne de commande ne le concerne");
});

// ─── SOURCES ANNEXES ─────────────────────────────────────────────────────────

test("les comptes rendus sont triés du plus récent au plus ancien", () => {
  assert.deepEqual(C.rapports.map((r) => r.date), ["06/10/2026", "03/10/2026"]);
  assert.equal(C.rapports[0].heures, 5, "4 h de tâche + 1 h indirecte");
  assert.equal(C.rapports[0].nbPhotos, 1);
  assert.equal(C.rapports[1].nbPhotos, 1);
});

test("les commandes portent leur en-tête (fournisseur, document, statut)", () => {
  const l = C.commandes[0];
  assert.equal(l.fournisseur, "Point P");
  assert.equal(l.document, "BL-1");
  assert.equal(l.statut, "Complète");
  assert.equal(l.ouvrageRef, "CLO-048 (#1)", "la ligne pointe l'ouvrage par sa référence courte");
  assert.equal(C.totalCommandes, 150);
});

test("le statut et le numéro d'une commande suivent les règles de la page Commandes", () => {
  assert.equal(statutCommande({ statut_facturation: "facture" }), "Facturé");
  assert.equal(statutCommande({ statut_completude: "complete" }), "Complète");
  assert.equal(statutCommande({}), "À compléter");
  assert.equal(documentCommande({ numero_en_attente: true, doc_numero: null }), "numéro en attente");
  assert.equal(documentCommande(null), null);
});

test("les réserves distinguent ouvertes et levées, et retrouvent le nom de la tâche", () => {
  assert.equal(C.reserves.length, 2);
  const ouverte = C.reserves.find((r) => r.ouverte);
  assert.equal(ouverte.tacheNom, "Plaquage", "tache_nom absent → résolu depuis le phasage");
  assert.equal(ouverte.groupeNom, "Ossature placo");
  const levee = C.reserves.find((r) => !r.ouverte);
  assert.equal(levee.statut, "Levée");
});

test("les visites ne gardent que les observations réellement renseignées", () => {
  const v = C.visites[0];
  assert.equal(v.observations.length, 2, "1 point d'audit noté + 1 item de checklist");
  assert.ok(v.observations.some((o) => o.nom === "Bandes"));
  assert.ok(!v.observations.some((o) => o.nom === "Ossature"), "un point sans statut ni commentaire n'a rien à dire");
});

test("le planning hebdomadaire est trié par semaine puis par jour, cases vides écartées", () => {
  assert.deepEqual(C.planningCells.map((x) => x.jour), ["Lundi", "Mardi"]);
});

test("les notes vides ne créent pas de section fantôme", () => {
  assert.equal(C.notes.length, 1);
  assert.equal(C.notes[0].source, "Note de chantier");
});

test("les tâches partagées gardent leurs assignés, anciens champs compris", () => {
  assert.deepEqual(C.todos[0].assignes, ["Loris"]);
  assert.deepEqual(C.todos[1].assignes, ["Davy"]);
  assert.equal(C.todos[1].statut, "Terminée");
});

test("les échéances ne retiennent que ce qui appelle une décision", () => {
  // Export daté du 07/10 : « Plaquage » (prévue le 06/10, 0 %) est en retard,
  // « Tâche orpheline » (50 %, sans date) n'a aucun déclencheur. « Ossature »
  // est terminée à 100 % : elle n'appelle rien.
  assert.equal(C.echeances.length, 2);
  const retard = C.echeances.find((t) => t.enRetard);
  assert.equal(retard.nom, "Plaquage");
  assert.equal(retard.motif, "En retard");
  const sansDate = C.echeances.find((t) => t.sansDate);
  assert.equal(sansDate.nom, "Tâche orpheline");
  assert.equal(sansDate.motif, "Sans date");
  assert.ok(!C.echeances.some((t) => t.nom === "Ossature"), "une tâche terminée n'est pas une échéance");
});

test("une tâche planifiée au-delà de l'horizon sort des échéances mais reste comptée", () => {
  const loin = normaliserChantier({
    ...CONTEXTE,
    phasage: {
      ...PHASAGE,
      ouvrages: [{
        ...PHASAGE.ouvrages[0],
        taches: [{ id: "tz", nom: "Peinture finale", chrono_groupe_id: "g2", chrono_ordre: 1, avancement: 0, date_prevue: "2026-12-01" }],
      }],
    },
  });
  assert.equal(loin.echeances.length, 0, "au-delà de 14 jours, ce n'est pas une échéance");
  assert.equal(loin.nbTachesAVenirHorsEcheances, 1, "elle reste comptée et décrite dans le plan");
});

// ─── CYCLE DE VIE ET DOCUMENTS ───────────────────────────────────────────────

test("le cycle de vie reprend les étapes validées, leurs données typées et la phase déclarée", () => {
  const metres = C.cycleVie.etapes.find((e) => e.id === "metres");
  assert.equal(metres.fait, true);
  assert.equal(metres.auteur, "Loris");
  const reponse = C.cycleVie.etapes.find((e) => e.id === "reponse_client");
  // Les données sont TYPÉES (pas une chaîne « reponse : accepte ») : c'est ce
  // qui permet au générateur d'écrire un libellé métier et un format humain.
  assert.equal(reponse.donnees.length, 1);
  assert.equal(reponse.donnees[0].cle, "reponse");
  assert.equal(reponse.donnees[0].label, "Réponse");
  assert.equal(reponse.donnees[0].valeur, "accepte");
  assert.ok(C.cycleVie.phaseLabel.startsWith("Travaux"));
  assert.ok(C.cycleVie.prochaine, "la prochaine étape à faire doit être identifiée");
});

test("un montant saisi sur une étape est typé « montant », pas un nombre nu", () => {
  const c = normaliserChantier({
    ...CONTEXTE,
    phasage: {
      ...PHASAGE,
      plan_travaux: {
        meta: {
          ...PHASAGE.plan_travaux.meta,
          cycle_vie_etapes: {
            acompte_encaisse: { fait: true, date: "2026-05-30T09:00:00.000Z", auteur: "Loris",
              donnees: { montant: 20210.62, date: "2026-05-30" } },
          },
        },
      },
    },
  });
  const etape = c.cycleVie.etapes.find((e) => e.id === "acompte_encaisse");
  const montant = etape.donnees.find((d) => d.cle === "montant");
  assert.equal(montant.type, "montant");
  assert.equal(montant.label, "Montant", "le « (€) » du libellé est retiré, l'unité vient du format");
  assert.equal(montant.valeur, 20210.62);
  assert.equal(etape.donnees.find((d) => d.cle === "date").type, "date");
});

test("des pièces jointes on ne garde que les métadonnées — jamais le chemin", () => {
  const doc = C.documents.find((d) => d.nom === "Devis signé.pdf");
  assert.ok(doc, "la pièce jointe doit apparaître");
  assert.equal(doc.type, "application/pdf");
  assert.equal(doc.categorie, "Cycle de vie — Devis signé");
  const json = JSON.stringify(C);
  assert.ok(!json.includes("cycle-vie/ph-1"), "aucun chemin de stockage ne doit survivre");
  assert.ok(!json.includes("\"path\""), "aucune clé path ne doit survivre");
});

test("plans et factures complètent la liste des documents", () => {
  assert.ok(C.documents.some((d) => d.nom === "RDC.plan"));
  assert.ok(C.documents.some((d) => d.nom === "F-1.pdf"));
});

// ─── CHIFFRAGE ───────────────────────────────────────────────────────────────

test("le chiffrage rattaché conserve les dérogations de coefficient et de taux", () => {
  assert.equal(C.chiffrage.modeCoefficient, "global");
  assert.ok(C.chiffrage.coefficientGlobal.includes("1.35"));
  // Les lignes suivent leur ordre de devis, pas l'ordre du tableau reçu.
  assert.deepEqual(C.chiffrage.lignes.map((l) => l.code), ["PEI-001", "CLO-048"]);
  const derogee = C.chiffrage.lignes.find((l) => l.code === "CLO-048");
  assert.equal(derogee.coefficient, 1.5, "la valeur de la LIGNE prime sur l'héritage");
  assert.equal(derogee.coefficientSource, "specifique");
  assert.equal(derogee.tauxHoraire, 58, "taux propre à l'ouvrage");
  const heritee = C.chiffrage.lignes.find((l) => l.code === "PEI-001");
  assert.equal(heritee.coefficient, 1.35);
});

test("le client du chiffrage remonte dans les contacts de l'opération", () => {
  assert.equal(C.client.nom, "Léa Martin");
  assert.equal(C.client.adresse, "3 rue A 49000 Angers");
  assert.equal(MODELE.contacts.length, 1);
  assert.equal(MODELE.contacts[0].chantierNom, "LOT A");
});

// ─── CHANTIER SANS DONNÉES ───────────────────────────────────────────────────

test("un chantier sans phasage produit un modèle vide mais complet", () => {
  assert.equal(VIDE.finance, null);
  assert.equal(VIDE.phasage, null);
  assert.deepEqual(VIDE.ouvrages, []);
  assert.deepEqual(VIDE.phases, []);
  assert.deepEqual(VIDE.documents, []);
  assert.equal(VIDE.totalCommandes, 0);
  assert.equal(VIDE.cycleVie.etapes.length > 0, true, "les étapes du référentiel restent listées, à faire");
  assert.ok(VIDE.cycleVie.etapes.every((e) => e.fait === false));
});

// ─── AGRÉGATION D'OPÉRATION ──────────────────────────────────────────────────

test("le modèle d'opération agrège sans recalculer les chiffres des chantiers", () => {
  assert.equal(MODELE.operation.nom, "Fourmond");
  assert.deepEqual(MODELE.operation.statuts, { en_cours: 1, planifie: 1 });
  assert.deepEqual(MODELE.bornes, { debut: "2026-10-03", fin: "2026-10-06" });
  assert.equal(MODELE.agg.vendu, 4000, "l'agrégat est repris tel quel de l'écran");
  assert.equal(MODELE.totalCommandes, 150);
  assert.equal(MODELE.alertes.length, 1);
  assert.equal(MODELE.reservesOuvertes.length, 1, "seules les réserves non levées");
  assert.equal(MODELE.actions.length, 1, "seules les actions non terminées");
  assert.equal(MODELE.affectations[0].nom, "Kev");
  assert.equal(MODELE.affectations[0].heures, 7, "6 h de tâche + 1 h indirecte");
});

test("le modèle se laisse rédiger sans erreur et sans valeur technique parasite", () => {
  const md = construireMarkdownOperation(MODELE);
  assert.ok(md.includes("# Chantier 1 — LOT A"));
  assert.ok(md.includes("# Chantier 2 — LOT B"));
  assert.ok(md.includes("Devis signé.pdf"));
  assert.ok(!md.includes("cycle-vie/"));
  // « reference: null » est du YAML volontaire : c'est le corps du document qui
  // ne doit porter aucune valeur technique.
  const corps = md.slice(md.indexOf("\n---\n", 4) + 5);
  [/\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/].forEach((re) => {
    const ligne = corps.split("\n").find((l) => re.test(l));
    assert.equal(ligne, undefined, `le document contient ${re} : ${ligne}`);
  });
});

test("les statuts techniques sont traduits avec les libellés des écrans", () => {
  assert.equal(C.rapports[0].statut, "En attente de validation");
  assert.equal(C.rapports[1].statut, "Validé");
  assert.equal(C.besoins[0].statut, "En attente");
  assert.equal(C.besoins[0].priorite, "Urgent");
  assert.equal(C.visites[0].statut, "Terminée");
  assert.equal(C.facturation.lignes[0].etat, "Émise");
  assert.equal(C.suggestionsMateriaux[0].statut, "En attente");
});

test("un statut inconnu est rendu tel quel plutôt que masqué", () => {
  const c = normaliserChantier({
    ...CONTEXTE,
    sources: { ...SOURCES, besoins: [{ ...SOURCES.besoins[0], statut: "un_statut_inedit" }] },
  });
  assert.equal(c.besoins[0].statut, "un_statut_inedit");
});

test("texteOuNull ne laisse jamais passer une chaîne vide ou blanche", () => {
  assert.equal(texteOuNull("  "), null);
  assert.equal(texteOuNull(null), null);
  assert.equal(texteOuNull(0), "0");
  assert.equal(texteOuNull(" a "), "a");
});

// ─── CODE CANONIQUE DE L'OUVRAGE ─────────────────────────────────────────────

// Fabrique un chantier à un seul ouvrage, pour isoler la résolution du code.
const avecOuvrage = (ouvrage, extra = {}) => normaliserChantier({
  ...CONTEXTE,
  ...extra,
  phasage: { ...PHASAGE, ouvrages: [{ taches: [], ...ouvrage }] },
}).ouvrages[0];

test("le code explicite du phasage prime sur tout le reste", () => {
  const o = avecOuvrage({
    code_ouvrage: "MU-001",
    bibliotheque_ref: { code_ouvrage: "AUTRE-9" },
    libelle: "ZZ-999 : autre chose",
  });
  assert.equal(o.code, "MU-001");
  assert.equal(o.codeSource, "phasage");
});

test("le code est récupéré dans l'objet bibliotheque_ref quand le champ est vide", () => {
  const o = avecOuvrage({
    code_ouvrage: null,
    bibliotheque_ref: { id: "1788c067", code_ouvrage: "S-011", sous_taches: [{ id: "st_1" }] },
    libelle: "Sol souple",
  });
  assert.equal(o.code, "S-011");
  assert.equal(o.codeSource, "bibliotheque_ref");
});

test("le code est récupéré sur la fiche de bibliothèque en troisième recours", () => {
  const o = avecOuvrage({
    code_ouvrage: null, bibliotheque_id: "bib-code", libelle: "Doublage sans code",
  }, {
    ratiosById: { ...CONTEXTE.ratiosById, "bib-code": { id: "bib-code", libelle: "PL-003 : Faux-plafond", unite: "m²" } },
  });
  assert.equal(o.code, "PL-003");
  assert.equal(o.codeSource, "bibliotheque");
});

test("en dernier recours, le code est lu au début de l'intitulé", () => {
  // Cas RÉEL de Fourmond : les 57 ouvrages portent leur code en tête de
  // libellé et aucun champ code_ouvrage.
  const o = avecOuvrage({
    code_ouvrage: null,
    libelle: "MU-001 :Fourniture et pose d'un doublage de mur (2,5ml hauteur max)…",
  });
  assert.equal(o.code, "MU-001");
  assert.equal(o.codeSource, "intitule");
  assert.equal(o.reference, "MU-001 (#1)");
});

test("l'extraction depuis l'intitulé reconnaît les codes à décimale et à préfixe long", () => {
  assert.equal(avecOuvrage({ libelle: "P-021.2 :Salle de bain type" }).code, "P-021.2");
  assert.equal(avecOuvrage({ libelle: "COUV-001 : Reprise de couverture" }).code, "COUV-001");
  assert.equal(avecOuvrage({ libelle: "ME-003.2 :Porte intérieure" }).code, "ME-003.2");
});

test("l'extraction ne prend ni une dimension ni une référence produit pour un code", () => {
  ["Pose 3 prises de courant", "Bac 3", "70505960 plaque BA13",
    "2,5ml de plinthe", "Cloison 48 BA13 hydro"].forEach((libelle) => {
    const o = avecOuvrage({ code_ouvrage: null, libelle });
    assert.equal(o.code, null, `« ${libelle} » ne doit pas produire de code : ${o.code}`);
  });
});

test("un ouvrage sans aucun code garde son numéro interne comme référence", () => {
  const o = avecOuvrage({ code_ouvrage: null, libelle: "Divers et imprévus" });
  assert.equal(o.code, null);
  assert.equal(o.codeSource, null);
  assert.equal(o.reference, "#1");
});

// ─── FACTURATION ─────────────────────────────────────────────────────────────

// Factures telles qu'elles existent : une ProGBat (HT volontairement NULL,
// montant porté par montant_ttc) et une saisie à la main (HT renseigné).
const FACTURE_PROGBAT = {
  id: "f-pg", chantier_id: "c1", numero: "F-260067", ligne_nom: "Facture d'acompte",
  date_facture: "2026-05-28", montant_ht: null, montant_ttc: "22231.68", statut: "emise",
  source: "progbat", progbat_bill_id: 4412, progbat_type: "advance", progbat_net_total: "20210.62",
};
const FACTURE_SANS_MONTANT = {
  id: "f-vide", chantier_id: "c1", numero: "F-260071", date_facture: "2026-06-30",
  montant_ht: null, montant_ttc: null, statut: "emise", source: "progbat", progbat_bill_id: 4413,
};
const FACTURE_MANUELLE = {
  id: "f-man", chantier_id: "c1", numero: "M-001", ligne_nom: "Situation 1",
  date_facture: "2026-07-15", montant_ht: 12000, montant_ttc: null, statut: "emise", source: "manuel",
};
const facturationDe = (factures, reglements = []) => normaliserChantier({
  ...CONTEXTE, sources: { ...SOURCES, factures, reglements },
}).facturation;

test("une facture ProGBat est mesurée en TTC, jamais par progbat_net_total", () => {
  const f = facturationDe([FACTURE_PROGBAT]);
  const l = f.lignes[0];
  assert.equal(l.base, "TTC");
  assert.equal(l.montant, 22231.68);
  assert.equal(l.montantConnu, true);
  assert.equal(l.nature, "Acompte");
  // progbat_net_total ne décrit PAS le HT exigible (règle de FacturationChantier).
  assert.notEqual(l.montant, 20210.62);
});

test("une facture saisie à la main est mesurée en HT", () => {
  const l = facturationDe([FACTURE_MANUELLE]).lignes[0];
  assert.equal(l.base, "HT");
  assert.equal(l.montant, 12000);
  assert.equal(l.source, "Saisie manuelle");
});

test("un montant de facture absent reste null — jamais zéro", () => {
  const f = facturationDe([FACTURE_SANS_MONTANT]);
  assert.equal(f.lignes[0].montant, null);
  assert.equal(f.lignes[0].montantConnu, false);
  assert.notEqual(f.lignes[0].montant, 0);
});

test("le total exclut les factures sans montant et le dit", () => {
  const f = facturationDe([FACTURE_PROGBAT, FACTURE_SANS_MONTANT]);
  assert.equal(f.progbat.sansMontant, 1);
  assert.equal(Math.round(f.progbat.totalTTC * 100) / 100, 22231.68,
    "la facture sans montant ne doit pas être comptée pour 0");
  assert.equal(f.nb, 2);
});

test("HT et TTC sont totalisés séparément", () => {
  const f = facturationDe([FACTURE_PROGBAT, FACTURE_MANUELLE]);
  assert.equal(Math.round(f.progbat.totalTTC * 100) / 100, 22231.68);
  assert.equal(f.manuel.totalHT, 12000);
  assert.equal(f.manuel.sansMontant, 0);
});

test("les règlements alimentent l'état et le reste dû", () => {
  const f = facturationDe([FACTURE_PROGBAT], [
    { id: "r1", facture_id: "f-pg", date_reglement: "2026-06-10", montant: 10000, annule: false },
  ]);
  assert.equal(f.progbat.totalRegle, 10000);
  assert.equal(Math.round(f.progbat.reste * 100) / 100, 12231.68);
  assert.ok(/partiel/i.test(f.lignes[0].etat), f.lignes[0].etat);
});

// ─── ADRESSE DE L'OPÉRATION ──────────────────────────────────────────────────

const modeleAvec = (op, chantiersModele) => assemblerModele({
  op, chantiers: chantiersModele, agg: {}, statutsLabels: {}, erreurs: [], restrictions: [],
  maintenant: new Date("2026-10-07T08:00:00.000Z"),
});

test("l'adresse saisie sur l'opération est marquée comme telle", () => {
  const m = modeleAvec({ id: "op", nom: "X", adresse: "12 rue des Lilas" }, [C]);
  assert.equal(m.operation.adresse.origine, "operation");
  assert.equal(m.operation.adresse.valeur, "12 rue des Lilas");
});

test("une adresse unique partagée par les chantiers est marquée comme déduite", () => {
  const m = modeleAvec({ id: "op", nom: "X", adresse: "" },
    [{ ...C, adresse: "6 Square de l'Étrier" }, { ...VIDE, adresse: "6 Square de l'Étrier" }]);
  assert.equal(m.operation.adresse.origine, "chantiers");
  assert.equal(m.operation.adresse.valeur, "6 Square de l'Étrier");
});

test("des adresses différentes rendent l'opération multisite", () => {
  const m = modeleAvec({ id: "op", nom: "X", adresse: null },
    [{ ...C, adresse: "3 rue A" }, { ...VIDE, adresse: "7 rue B" }]);
  assert.equal(m.operation.adresse.origine, "multisite");
  assert.equal(m.operation.adresse.valeur, null);
  assert.deepEqual(m.operation.adresse.liste, ["3 rue A", "7 rue B"]);
});

test("aucune adresse nulle part reste une absence, pas une déduction", () => {
  const m = modeleAvec({ id: "op", nom: "X" }, [{ ...VIDE, adresse: null }]);
  assert.equal(m.operation.adresse.origine, "absente");
});

test("la référence d'opération n'est jamais l'identifiant technique", () => {
  const m = modeleAvec({ id: "op_1785760193820", nom: "Fourmond" }, [C]);
  assert.equal(m.operation.reference, null);
  assert.equal(m.operation.id, "op_1785760193820");
});

// ─── ÉQUIPES ─────────────────────────────────────────────────────────────────

test("la nature d'une équipe vient du référentiel, pas d'une supposition", () => {
  assert.deepEqual(C.equipes, ["Second œuvre", "Externe"]);
  const externe = C.equipesDetail.find((e) => e.nom === "Externe");
  assert.equal(externe.externe, true, "« Externe » est une équipe de prestataires");
  const interne = C.equipesDetail.find((e) => e.nom === "Second œuvre");
  assert.equal(interne.externe, false);
  assert.deepEqual(interne.responsables, ["Davy"]);
  assert.deepEqual(interne.membres, ["Kev"]);
  const m = modeleAvec({ id: "op", nom: "X" }, [C]);
  assert.equal(m.intervenants.find((e) => e.nom === "Externe").externe, true);
});

// ─── AGRÉGAT PARTAGÉ AVEC L'ÉCRAN ────────────────────────────────────────────

test("agregerOperation somme les scalaires bruts et pondère l'avancement par le vendu", () => {
  const fin = {
    a: { finance: { brut: { prixHTChantier: 100000, avancementChantier: 80, margeChantier: 20000, margePrevChantier: 25000, coutMOTotalChantier: 10, coutMatChantier: 10, fgChantier: 10, moPrevChantier: 1, commandesPrevChantier: 1, fgPrevChantier: 1, heuresVenduesChantier: 10, heuresReellesTotalChantier: 5 } } },
    b: { finance: { brut: { prixHTChantier: 20000, avancementChantier: 0, margeChantier: 5000, margePrevChantier: 5000, coutMOTotalChantier: 0, coutMatChantier: 0, fgChantier: 0, moPrevChantier: 0, commandesPrevChantier: 0, fgPrevChantier: 0, heuresVenduesChantier: 2, heuresReellesTotalChantier: 0 } } },
  };
  const t = agregerOperation(
    [{ id: "a", statut: "en_cours" }, { id: "b", statut: "planifie" }, { id: "c", statut: null }],
    fin, ["en_cours", "planifie"],
  );
  assert.equal(t.nbChantiers, 3);
  assert.equal(t.nbAvecPhasage, 2);
  assert.equal(t.vendu, 120000);
  // (80 × 100 000 + 0 × 20 000) / 120 000 = 66,67 → 67
  assert.equal(t.avancement, 67, "l'avancement est pondéré par le vendu, jamais moyenné");
  assert.deepEqual(t.statuts, { en_cours: 2, planifie: 1 },
    "un statut inconnu est rangé sous « en cours », comme à l'écran");
});

// ─── EXÉCUTION ───────────────────────────────────────────────────────────────

let ok = 0;
const echecs = [];
for (const [nom, fn] of cas) {
  try { fn(); ok += 1; console.log(`  ✓ ${nom}`); }
  catch (e) { echecs.push([nom, e]); console.log(`  ✗ ${nom}\n     ${e.message}`); }
}
console.log(`\n${ok}/${cas.length} vérifications passées.`);
if (echecs.length > 0) process.exit(1);
