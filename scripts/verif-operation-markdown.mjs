#!/usr/bin/env node
// Vérifie le générateur Markdown « opération complète » destiné à ChatGPT
// (src/Renovation/operationMarkdown.mjs). Aucun réseau, aucune base : le module
// est PUR, il est alimenté par des modèles d'export écrits en dur.
//   node scripts/verif-operation-markdown.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const M = await chargerModuleSource("../src/Renovation/operationMarkdown.mjs", import.meta.url);
const {
  construireMarkdownOperation, nomFichierMarkdownOperation, assainirNomFichier,
  txt, cellule, bloc, nombre, euros, heures, pourcent, dateFR, dateHeureFR,
  sansHtml, yamlValeur, tableau, construireTableau, listeDefinitions, donneesEtape,
  ND, AUCUNE,
} = M;

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ─── FIXTURES ────────────────────────────────────────────────────────────────

const OP = {
  id: "op_1", nom: "Fourmond", reference: null,
  adresse: { valeur: "12 rue des Lilas", origine: "operation", liste: [] },
  couleur: "#84cc16", statuts: { en_cours: 1, termine: 1 },
};
const AGG = {
  nbChantiers: 2, nbAvecPhasage: 2,
  vendu: 120000, moReel: 30000, mat: 20000, fg: 5000, marge: 65000, margePct: 54.2,
  moPrev: 28000, matPrev: 19000, fgPrev: 4800, margePrev: 68200, margePrevPct: 56.8,
  hVendues: 900, hReelles: 820, avancement: 62,
};
const BRUT = {
  prixHTChantier: 80000, heuresVenduesChantier: 600, heuresReellesChantier: 500,
  heuresReellesTotalChantier: 540, coutMOChantier: 18000, coutMOTotalChantier: 20000,
  coutMatChantier: 12000, commandesPrevChantier: 11000, moPrevChantier: 15000, tauxMOPrevEff: 25,
  fgTauxHoraire: 6, fgChantier: 3240, margeChantier: 44760, margePctChantier: 55.95,
  fgPrevChantier: 3600, deboursePrevChantier: 29600, margePrevChantier: 50400, margePrevPctChantier: 63,
  avancementChantier: 65, montantDevis: 80000, ecartVendu: 0,
  heuresRestantes: 120, resteAFaireEuros: 28000, margeATerminaison: 41000,
  situationAFacturer: null, resteACommander: 900,
  trajetHeures: 25, indirectHeures: 15,
};

// Une tâche pleine de pièges : barre verticale, HTML, retours à la ligne,
// accents, apostrophe typographique.
const TACHE_PIEGE = {
  id: "t1", nom: "Pose cloison | BA13 <b>hydro</b>\nRDC & 1er étage — côté « cour »",
  ouvrageLibelle: "Cloisons", ouvrageRef: "CLO-048 (#1)", ordre: 1, phaseId: "g1", phaseNom: "Ossature",
  ratio: 35, heuresEstimees: 12, heuresVendues: 14, heuresReelles: 11.5,
  avancement: 50, etat: "En cours", datePrevue: "2026-10-03",
  ouvriers: ["Kev", "Margaux"], dependances: ["Démolition"],
};
// Tâche dont TOUTES les colonnes secondaires sont vides : elle sert à vérifier
// que ces colonnes disparaissent au lieu de répéter « Non renseigné ».
const TACHE_NUE = {
  id: "t2", nom: "Repli de chantier", ouvrageRef: "#2", ordre: 2, phaseId: "g2",
  phaseNom: "Peinture", ratio: null, heuresEstimees: null, heuresVendues: null,
  heuresReelles: null, avancement: 0, etat: "À faire", datePrevue: null,
  ouvriers: null, dependances: null,
};

const CHANTIER = {
  id: "fourmond-rdc", nom: "FOURMOND RDC", couleur: "#84cc16",
  statutId: "en_cours", statutLabel: "En cours", adresse: "12 rue des Lilas — RDC",
  equipes: ["Second œuvre", "Externe"],
  equipesDetail: [
    { nom: "Second œuvre", externe: false, responsables: ["Davy"], membres: ["Kev"] },
    { nom: "Externe", externe: true, responsables: null, membres: null },
  ],
  finance: BRUT,
  alertes: [{ gravite: "alerte", message: "Lot Placo : dérive d'heures ×1,30." }],
  lots: [{ id: "murs_cloison", label: "Murs & cloisons", nbOuvrages: 3, heuresVendues: 200, heuresReelles: 230, avancement: 70, ratioDerive: 1.64 }],
  phasage: { id: "ph1", updatedAt: "2026-09-17T13:40:00.000Z", montantDevis: 80000, fgTauxHoraire: 6, margeCible: 45, repriseHeures: 0, repriseTaux: 0 },
  ouvrages: [{
    id: "o1", code: "CLO-048", numero: "#1", reference: "CLO-048 (#1)",
    libelle: "Cloisons", libelleDevis: "Cloison 48 + isolation",
    lotId: "murs_cloison", lotLabel: "Murs & cloisons", quantite: 45.5, unite: "m²",
    prixHT: 6800, coutMateriaux: 1400, heuresDevis: 60, heuresEstimees: 58,
    heuresReelles: 51, coutMOReel: 1900, avancement: 65, bibliothequeRef: "cloison_48_standard_isol",
    cadence: 0.8, cadenceUnite: "m²", coefficientVente: 1.35, tauxHoraireVente: 52,
    taches: [TACHE_PIEGE],
  }, {
    id: "o2", code: null, numero: "#2", reference: "#2", libelle: "Divers",
    libelleDevis: null, lotLabel: null, quantite: null, unite: null,
    prixHT: null, coutMateriaux: null, heuresDevis: null, heuresEstimees: null,
    heuresReelles: null, coutMOReel: null, avancement: 0, bibliothequeRef: null,
    taches: [TACHE_NUE],
  }],
  nbTaches: 2, nbTachesDatees: 1,
  phases: [{
    id: "g1", nom: "Ossature", ordre: 50, groupeTypeNom: "Ossature placo",
    equipeNom: "Second œuvre", equipeExterne: false,
    nbTaches: 1, nbTachesDatees: 1, heuresEstimees: 12, heuresVendues: 14, avancement: 50,
    termine: false, debut: "2026-10-03", fin: "2026-10-03", ouvriers: ["Kev", "Margaux"],
    controle: { date: "2026-10-10", auteur: "Loris", nbTaches: 4, nbConformes: 3 },
    taches: [TACHE_PIEGE],
  }, {
    id: "g2", nom: "Peinture", ordre: 80, groupeTypeNom: null,
    equipeNom: "Externe", equipeExterne: true,
    nbTaches: 1, nbTachesDatees: 0, heuresEstimees: 0, heuresVendues: 0, avancement: 0,
    termine: false, debut: null, fin: null, ouvriers: null, controle: null,
    taches: [TACHE_NUE],
  }],
  tachesHorsPhase: [],
  jalons: [{ nom: "Contrôle — Ossature", type: "controle", groupeNom: "Ossature", date: null }],
  planning: { debut: "2026-10-03", fin: "2026-11-20" },
  planningCells: [{ semaine: "2026-W41", jour: "Lundi", planifie: "Cloisons RDC", reel: null, ouvriers: ["Kev"] }],
  previsionnel: { blocs: [{ titre: "Octobre 2026", lignes: ["Ossature", "Réseaux"] }], note: "Dates prévisionnelles.", livraison: "Nov. 2026" },
  materiaux: [{
    ouvrageLibelle: "Cloisons", nom: "Plaque BA13 hydro", reference: "BA13-H", fournisseur: "Point P",
    unite: "m²", quantiteParUnite: 1.05, quantiteTotale: 47.775, quantiteCommandee: 40,
    commandeLe: null, statut: "Commandé (ligne trouvée)",
  }],
  suggestionsMateriaux: [],
  rapports: [{
    date: "17/09/2026", ouvrier: "Venceslas", statut: "en_attente", validePar: null,
    heures: 7, trajetMin: 40, nbPhotos: 2, remarque: "Accès livraison bloqué le matin.\n\nRepris l'après-midi.",
    taches: [{ libelle: "Mise en place du compteur d'eau", statut: "faite", avancement: 100, heures: 2, remarque: null }],
  }],
  visites: [{
    date: "2026-09-10", intervenant: "Loris", meteo: "Pluie", statut: "terminee",
    note: "RAS hors réserve plinthes.", nbLots: 2,
    observations: [{ ouvrage: "Cloisons", nom: "Bandes", statut: "non_conforme", commentaire: "Reprise | ponçage" }],
  }],
  commandes: [{
    date: "2026-09-12", fournisseur: "Point P", document: "BL-4412", libelle: "Plaque BA13 hydro",
    reference: "BA13-H", quantite: 40, unite: "m²", prixUnitaire: 12.5, prixTotal: 500,
    ouvrageLibelle: "Cloisons", lotLabel: "Murs & cloisons", statut: "Complète",
  }],
  totalCommandes: 500,
  besoins: [{ article: "Vis 25", quantite: 3, unite: "boîte", demandeur: "Kev", priorite: "urgent", statut: "en_attente", date: "2026-09-15", notes: null }],
  controles: [{ groupeNom: "Ossature", date: "2026-10-10", auteur: "Loris", nbTaches: 4, nbConformes: 3 }],
  reserves: [{ groupeNom: "Ossature", tacheNom: "Bandes", statut: "Ouverte", commentaire: "Ponçage à reprendre", auteur: "Loris", date: "2026-10-10", leveeLe: null, leveePar: null, ouverte: true }],
  cycleVie: {
    phaseLabel: "Travaux (déclarée par Loris)",
    etapes: [
      { id: "metres", nom: "Métrés", phaseNom: "Devis", hint: "Coche manuelle.", fait: true, date: "2026-05-02", auteur: "Loris", donnees: null, nbPiecesJointes: 0 },
      // Données typées : le document doit écrire « Montant : 20 210,62 € »,
      // jamais « montant : 20210.62 ».
      { id: "acompte_encaisse", nom: "Acompte encaissé", phaseNom: "Contrat", hint: "", fait: true, date: "2026-05-30", auteur: "Loris",
        donnees: [{ cle: "montant", label: "Montant", valeur: 20210.62, type: "montant" },
                  { cle: "date", label: "Date d'encaissement", valeur: "2026-05-30", type: "date" }], nbPiecesJointes: 0 },
      { id: "devis_signe", nom: "Devis signé", phaseNom: "Contrat", hint: "Importer le devis signé.", fait: false, date: null, auteur: null, donnees: null, nbPiecesJointes: 1 },
    ],
    prochaine: { nom: "Devis signé", phaseNom: "Contrat", hint: "Importer le devis signé." },
  },
  documents: [{ nom: "Devis-signe.pdf", categorie: "Cycle de vie — Devis signé", type: "application/pdf", date: "2026-05-20T10:00:00.000Z", auteur: "Loris" }],
  notes: [{ source: "Note de chantier", contenu: "Clé sous le paillasson.\nCode portail 1234A.", date: "2026-09-01T08:00:00.000Z" }],
  todos: [{ texte: "Relancer le plaquiste", assignes: ["Loris"], echeance: "2026-09-25", priorite: "haute", statut: "À faire", note: null, fait: false }],
  echeances: [
    { ...TACHE_PIEGE, enRetard: true, sansDate: false, proche: false, motif: "En retard" },
    { ...TACHE_NUE, enRetard: false, sansDate: true, proche: false, motif: "Sans date" },
  ],
  nbTachesAVenirHorsEcheances: 3,
  ouvriersHeures: [{ nom: "Kev", heures: 120, cout: 2400, taux: 20 }],
  heuresParMois: [{ label: "septembre 2026", heures: 120, cout: 2400, ouvriers: ["Kev 120 h"] }],
  avancementHistorique: [{ date: "2026-09-14", avancement: 60, tachesTerminees: 8, tachesTotal: 20 }],
  // Facturation : une facture ProGBat en TTC dont le montant est CONNU, et une
  // seconde dont le montant est absent — le total ne doit donc pas être présenté
  // comme complet, et surtout jamais valoir zéro.
  facturation: {
    nb: 3,
    lignes: [
      {
        numero: "F-260067", date: "2026-05-28", libelle: "Facture d'acompte", source: "ProGBat",
        nature: "Acompte", base: "TTC", montant: 22231.68, montantConnu: true,
        regle: 0, reste: 22231.68, etat: "Non réglée", anomalie: false,
        dateEncaissement: null, documentAnnulation: false,
      },
      {
        numero: "F-260071", date: "2026-06-30", libelle: null, source: "ProGBat",
        nature: "Facture", base: "TTC", montant: null, montantConnu: false,
        regle: 0, reste: null, etat: "Montant inconnu", anomalie: true,
        dateEncaissement: null, documentAnnulation: false,
      },
      {
        numero: "M-001", date: "2026-07-15", libelle: "Situation 1", source: "Saisie manuelle",
        nature: null, base: "HT", montant: 12000, montantConnu: true,
        regle: null, reste: null, etat: "Émise", anomalie: false,
        dateEncaissement: null, documentAnnulation: false,
      },
    ],
    progbat: { nb: 2, totalTTC: 22231.68, totalRegle: 0, reste: 22231.68, sansMontant: 1, anomalies: 1 },
    manuel: { nb: 1, nbConnues: 1, sansMontant: 0, totalHT: 12000 },
  },
  chiffrage: {
    reference: "Réno RDC — LOT A",
    modeCoefficient: "global", coefficientGlobal: "1.35 — Coefficient standard",
    modeTauxHoraire: "specifique", tauxHoraireGlobal: "52 — Taux 2026",
    lignes: [{
      code: "CLO-048", libelle: "Cloison 48", zone: "Séjour", quantite: 45.5, unite: "m²",
      prixUnitaire: 149.45, coefficient: 1.5, coefficientSource: "specifique",
      tauxHoraire: 58, tauxHoraireSource: "ouvrage", projet: "LOT A",
    }],
  },
  client: null,
};

// Chantier « vide » : aucun phasage, aucune source annexe.
const CHANTIER_VIDE = {
  id: "fourmond-r1", nom: "FOURMOND R+1", couleur: null,
  statutId: "planifie", statutLabel: "Planifié", adresse: null,
  equipes: null, equipesDetail: [], finance: null, alertes: [], lots: [], phasage: null,
  ouvrages: [], nbTaches: 0, nbTachesDatees: 0, phases: [], tachesHorsPhase: [],
  jalons: [], planning: { debut: null, fin: null }, planningCells: [], previsionnel: null,
  materiaux: [], suggestionsMateriaux: [], rapports: [], visites: [], commandes: [],
  totalCommandes: 0, besoins: [], controles: [], reserves: [],
  cycleVie: { phaseLabel: null, etapes: [], prochaine: null },
  documents: [], notes: [], todos: [], echeances: [], ouvriersHeures: [],
  heuresParMois: [], avancementHistorique: [], nbTachesAVenirHorsEcheances: 0,
  facturation: { nb: 0, lignes: [], progbat: null, manuel: null },
  chiffrage: null, client: null,
};

const MODELE = {
  genere: { le: "2026-09-18T07:30:00.000Z", leFr: "18 septembre 2026 à 09:30", erreurs: [], restrictions: [] },
  operation: OP,
  statutsLabels: { en_cours: "En cours", termine: "Terminé", planifie: "Planifié", en_pause: "En pause" },
  agg: AGG,
  bornes: { debut: "2026-10-03", fin: "2026-11-20" },
  contacts: [],
  intervenants: [
    { nom: "Second œuvre", responsables: ["Davy"], membres: ["Kev"], externe: false, chantiers: ["FOURMOND RDC"] },
    { nom: "Externe", responsables: null, membres: null, externe: true, chantiers: ["FOURMOND RDC"] },
  ],
  affectations: [{ nom: "Kev", heures: 120, cout: 2400, chantiers: ["FOURMOND RDC"] }],
  consignes: [{ chantierNom: "FOURMOND RDC", source: "Note de chantier", contenu: "Clé sous le paillasson." }],
  commandes: [{ ...CHANTIER.commandes[0], chantierNom: "FOURMOND RDC" }],
  totalCommandes: 500,
  besoins: [{ ...CHANTIER.besoins[0], chantierNom: "FOURMOND RDC" }],
  alertes: [{ ...CHANTIER.alertes[0], chantierNom: "FOURMOND RDC" }],
  reservesOuvertes: [{ ...CHANTIER.reserves[0], chantierNom: "FOURMOND RDC" }],
  actions: [{ ...CHANTIER.todos[0], chantierNom: "FOURMOND RDC" }],
  documents: [{ ...CHANTIER.documents[0], chantierNom: "FOURMOND RDC" }],
  observationsOperation: null,
  chantiers: [CHANTIER, CHANTIER_VIDE],
};

const MD = construireMarkdownOperation(MODELE);

// Un document dont TOUTES les sources sont vides (opération sans chantier).
const MD_VIDE = construireMarkdownOperation({
  genere: { le: "2026-09-18T07:30:00.000Z", leFr: "18 septembre 2026 à 09:30", erreurs: [] },
  operation: { id: "op_2", nom: "Opération sans chantier" },
  agg: {}, chantiers: [],
});

// ─── FORMATAGE ───────────────────────────────────────────────────────────────

test("txt n'écrit jamais null, undefined, NaN ni [object Object]", () => {
  [null, undefined, "", "   ", NaN, {}, { a: 1 }].forEach((v) => {
    assert.equal(txt(v), ND, `valeur ${JSON.stringify(v)}`);
  });
  assert.equal(txt(0), "0");
  assert.equal(txt(false), "Non");
  assert.equal(txt(true), "Oui");
  assert.equal(txt(["a", "", null, "b"]), "a, b");
  assert.equal(txt([]), ND);
});

test("sansHtml retire les balises et décode les entités dans le bon ordre", () => {
  assert.equal(sansHtml("<b>Gras</b> &amp; co"), "Gras & co");
  assert.equal(sansHtml("a&amp;lt;b"), "a&lt;b"); // &amp; traité en dernier
  assert.equal(sansHtml("l&#39;ouvrage"), "l'ouvrage");
  assert.ok(!sansHtml("a b​c").includes(" "));
  assert.equal(sansHtml("Ligne 1<br>Ligne 2"), "Ligne 1\nLigne 2");
});

test("cellule échappe les barres verticales et écrase les retours à la ligne", () => {
  const c = cellule("Pose | cloison\nsuite");
  assert.ok(c.includes("\\|"), c);
  assert.ok(!c.includes("\n"), c);
  assert.ok(!/(^|[^\\])\|/.test(c), `barre non échappée : ${c}`);
});

test("cellule borne la longueur sans couper au milieu d'un tableau", () => {
  const c = cellule("x".repeat(500), { max: 50 });
  assert.equal(c.length, 50);
  assert.ok(c.endsWith("…"));
});

test("les nombres, montants, heures et pourcentages sont formatés en français", () => {
  assert.equal(nombre(null), ND);
  assert.equal(nombre(0), "0");
  assert.ok(nombre(1234.5).includes("234"));
  assert.equal(euros(undefined), ND);
  assert.ok(euros(1500).includes("€"));
  assert.ok(heures(12.5).endsWith(" h"));
  assert.equal(pourcent(null), ND);
  assert.equal(pourcent(65), "65 %");
  assert.equal(pourcent(55.95, { decimales: 1 }), "56 %");
  assert.equal(nombre("12,5"), "12,5");
});

test("les dates ISO ne glissent pas d'un jour et les dates déjà françaises passent", () => {
  assert.equal(dateFR("2026-01-01"), "01/01/2026");
  assert.equal(dateFR("2026-12-31T23:30:00.000Z"), "31/12/2026");
  assert.equal(dateFR("17/09/2026"), "17/09/2026");
  assert.equal(dateFR(null), ND);
  assert.equal(dateFR(""), ND);
  assert.equal(dateHeureFR("2026-05-20T10:05:00.000Z"), "20/05/2026 à 10:05");
  assert.equal(dateHeureFR("2026-05-20"), "20/05/2026");
});

test("bloc conserve les paragraphes et rend une chaîne vide quand il n'y a rien", () => {
  assert.equal(bloc(null), "");
  assert.equal(bloc("   "), "");
  assert.equal(bloc("a\n\nb"), "a\n\nb");
});

test("yamlValeur protège guillemets, antislashs et retours à la ligne", () => {
  assert.equal(yamlValeur('Îlot "Saint-Serge"'), '"Îlot \\"Saint-Serge\\""');
  assert.equal(yamlValeur("a\\b"), '"a\\\\b"');
  assert.equal(yamlValeur("a\nb"), '"a b"');
  assert.equal(yamlValeur(null), '""');
});

test("tableau rend « Aucune information enregistrée. » plutôt qu'un tableau vide", () => {
  assert.deepEqual(tableau([{ t: "A" }], []), [AUCUNE]);
  const t = tableau([{ t: "A" }, { t: "B", a: "r" }], [["1", "2"]]);
  assert.equal(t.length, 3);
  assert.ok(t[1].includes("---:"));
});

// ─── NOM DE FICHIER ──────────────────────────────────────────────────────────

test("le nom de fichier suit le gabarit demandé", () => {
  assert.equal(nomFichierMarkdownOperation("Fourmond", "2026-09-18"),
    "Fourmond_operation-complete_2026-09-18.md");
});

test("le nom de fichier est compatible Windows", () => {
  assert.equal(assainirNomFichier('Chalonnes / 7 rue "Thiers" ?'), "Chalonnes-7-rue-Thiers");
  assert.equal(assainirNomFichier("Opération Été 2026"), "Operation-Ete-2026");
  assert.equal(assainirNomFichier("   "), "operation");
  assert.equal(assainirNomFichier("CON"), "_CON");
  assert.ok(assainirNomFichier("x".repeat(200)).length <= 60);
  assert.ok(!/[<>:"/\\|?*]/.test(assainirNomFichier('a<b>c:d"e/f\\g|h?i*j')));
  assert.equal(nomFichierMarkdownOperation(null, "pas une date"), "operation_operation-complete.md");
});

// ─── STRUCTURE DU DOCUMENT ───────────────────────────────────────────────────

test("le frontmatter YAML est présent, complet et bien formé", () => {
  assert.ok(MD.startsWith("---\n"), "le fichier doit commencer par le frontmatter");
  const fin = MD.indexOf("\n---\n", 4);
  assert.ok(fin > 0, "le frontmatter doit être refermé");
  const fm = MD.slice(4, fin);
  ["type: operation_profero", "version_export: 1", 'operation_id: "op_1"',
    "reference: null",
    'nom: "Fourmond"', "nombre_chantiers: 2", "export_complet: true",
    'application: "Profero"'].forEach((l) => assert.ok(fm.includes(l), `manque : ${l}`));
  assert.ok(!fm.includes('reference: "op_1"'), "l'identifiant technique ne doit pas servir de référence métier");
});

test("les onze sections de l'opération apparaissent dans l'ordre", () => {
  const titres = [
    "## 1. Synthèse de l'opération",
    "## 2. Informations générales",
    "## 3. Client, contacts et intervenants",
    "## 4. Contraintes, accès et consignes",
    "## 5. Liste des chantiers",
    "## 6. Planning général de l'opération",
    "## 7. Équipes et affectations",
    "## 8. Approvisionnements et commandes transversales",
    "## 9. Avancement général",
    "## 10. Points de vigilance, problèmes et décisions",
    "## 11. Documents disponibles",
  ];
  let pos = -1;
  titres.forEach((t) => {
    const p = MD.indexOf(t);
    assert.ok(p > pos, `« ${t} » manquant ou hors ordre`);
    pos = p;
  });
  assert.ok(MD.indexOf("# Détail des chantiers") > pos);
});

test("chaque chantier a sa fiche, dans l'ordre reçu, avec toutes ses sous-sections", () => {
  const p1 = MD.indexOf("# Chantier 1 — FOURMOND RDC");
  const p2 = MD.indexOf("# Chantier 2 — FOURMOND R+1");
  assert.ok(p1 > 0 && p2 > p1, "les deux fiches doivent exister dans l'ordre");
  [
    "## Informations générales", "## Devis, lots et ouvrages",
    "## Sous-tâches des ouvrages (récapitulatif)",
    "## Matériaux prévisionnels", "## Plan de travaux et tâches", "## Planning prévisionnel",
    "## Équipes et affectations", "## Avancement réel", "## Comptes rendus chantier",
    "## Visites et observations", "## Commandes et approvisionnements",
    "## Problèmes, blocages et décisions", "## Actions restantes et prochaines échéances",
    "## Données budgétaires", "## Documents disponibles",
  ].forEach((t) => {
    assert.ok(MD.slice(p1, p2).includes(t), `section « ${t} » absente de la fiche du chantier 1`);
  });
});

test("l'en-tête annonce un instantané daté", () => {
  assert.ok(MD.includes("# Opération — Fourmond"));
  assert.ok(MD.includes("instantané des informations enregistrées au 18 septembre 2026 à 09:30"));
});

// ─── CONTENU ─────────────────────────────────────────────────────────────────

test("le tableau récapitulatif des chantiers porte les colonnes demandées", () => {
  const ligne = MD.split("\n").find((l) => l.startsWith("| Chantier | Référence | Adresse | Statut |"));
  assert.ok(ligne, "en-tête du tableau récapitulatif introuvable");
  assert.ok(MD.includes("| FOURMOND RDC | fourmond-rdc | 12 rue des Lilas — RDC | En cours | 65 % |"));
});

test("les chiffres financiers du modèle sont restitués sans être recalculés", () => {
  // Le document normalise les espaces fins insécables du formatage fr-FR en
  // espaces ordinaires (règle de sansHtml : aucun caractère invisible dans un
  // fichier texte) — la comparaison se fait donc sur la même normalisation.
  const norme = (s) => String(s).replace(/[\u00a0\u202f]/g, " ");
  const doc = norme(MD);
  assert.ok(doc.includes(norme(euros(BRUT.margeChantier))), "marge du chantier absente");
  assert.ok(doc.includes(norme(euros(AGG.vendu))), "vendu de l'opération absent");
  assert.ok(doc.includes(norme(euros(BRUT.coutMOTotalChantier))));
  assert.ok(!/[\u00a0\u202f]/.test(MD), "aucun espace insécable ne doit subsister");
});

test("les personnalisations d'ouvrage (coefficient, taux horaire) sont conservées", () => {
  assert.ok(MD.includes("Conditions de vente du chiffrage rattaché"));
  assert.ok(MD.includes("specifique"), "la source du coefficient de la ligne doit apparaître");
  assert.ok(MD.includes("58 €/h"), "le taux horaire propre à l'ouvrage doit apparaître");
});

test("l'ordre du plan de travaux est celui du modèle, pas un ordre alphabétique", () => {
  assert.ok(MD.includes("### Phase 1 — Ossature"));
  assert.ok(MD.includes("**Ordre enregistré** : 50"));
});

test("les caractères spéciaux d'une saisie ne cassent aucun tableau", () => {
  // La tâche piège contient « | », du HTML, un retour à la ligne et des
  // accents ; elle apparaît dans plusieurs tableaux de largeurs différentes.
  const lignesTache = MD.split("\n").filter((l) => l.includes("Pose cloison"));
  assert.ok(lignesTache.length >= 2, "la tâche piège doit apparaître dans plusieurs tableaux");
  lignesTache.forEach((l) => {
    assert.ok(!l.includes("<b>"), `HTML non retiré : ${l}`);
    assert.ok(l.includes("\\|"), `la barre saisie doit être échappée : ${l}`);
    assert.ok(l.includes("1er étage — côté « cour »"), `accents perdus : ${l}`);
    assert.ok(!/\n/.test(l));
  });
  // La cohérence du nombre de colonnes est vérifiée sur TOUT le document par
  // la vérification suivante.
});

test("chaque ligne de tableau a bien le nombre de colonnes de son en-tête", () => {
  const compte = (l) => (l.match(/(^|[^\\])\|/g) || []).length;
  const lignes = MD.split("\n");
  let attendu = null;
  lignes.forEach((l, i) => {
    if (!l.startsWith("|")) { attendu = null; return; }
    if (/^\|[-: |]+\|$/.test(l)) return; // ligne de séparation
    if (attendu === null) { attendu = compte(l); return; }
    assert.equal(compte(l), attendu, `ligne ${i + 1} : ${l}`);
  });
});

test("les sections sans données disent « Aucune information enregistrée. »", () => {
  const p2 = MD.indexOf("# Chantier 2 — FOURMOND R+1");
  const fiche2 = MD.slice(p2);
  assert.ok(fiche2.includes(AUCUNE), "la fiche d'un chantier vide doit le dire");
  assert.ok(fiche2.includes("aucun chiffre n'est calculable")
    || fiche2.includes("aucune donnée budgétaire n'est calculable"));
});

test("une opération sans chantier produit un document valide", () => {
  assert.ok(MD_VIDE.includes("nombre_chantiers: 0"));
  assert.ok(MD_VIDE.includes("Aucun chantier n'est rattaché à cette opération."));
  assert.ok(MD_VIDE.includes("## 11. Documents disponibles"));
  assert.ok(!MD_VIDE.includes("# Chantier 1"));
});

test("les valeurs manquantes s'écrivent « Non renseigné », jamais null/undefined", () => {
  assert.ok(MD.includes(ND));
  // « reference: null » est du YAML volontaire dans le frontmatter (aucune
  // référence métier n'existe) : c'est le CORPS du document qui ne doit porter
  // aucune de ces valeurs techniques.
  const corps = MD.slice(MD.indexOf("\n---\n", 4) + 5);
  [/\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/].forEach((re) => {
    const ligne = corps.split("\n").find((l) => re.test(l));
    assert.equal(ligne, undefined, `le document contient ${re} : ${ligne}`);
  });
});

test("aucune URL, aucun jeton, aucun chemin de stockage ne fuit", () => {
  [/https?:\/\//i, /supabase/i, /token/i, /signedUrl/i, /eyJ[A-Za-z0-9_-]{10}/, /cycle-vie\//]
    .forEach((re) => {
      const ligne = MD.split("\n").find((l) => re.test(l));
      assert.equal(ligne, undefined, `motif ${re} trouvé : ${ligne}`);
    });
  // Les documents n'apparaissent que par leur nom.
  assert.ok(MD.includes("Devis-signe.pdf"));
  assert.ok(MD.includes("doivent être ajoutés séparément"));
});

test("les comptes rendus vont du plus récent au plus ancien, sans image encodée", () => {
  assert.ok(MD.includes("### 17/09/2026 — Venceslas"));
  assert.ok(MD.includes("2 (non incluses dans cet export)"));
  assert.ok(!MD.includes("base64"));
});

test("un export incomplet est signalé dans le frontmatter ET dans le corps", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    genere: { ...MODELE.genere, erreurs: ["comptes rendus : permission denied"] },
  });
  assert.ok(md.includes("export_complet: false"));
  assert.ok(md.includes("**Export incomplet.**"));
  assert.ok(md.includes("comptes rendus : permission denied"));
});

test("le document est du texte UTF-8 lisible, sans triple saut de ligne", () => {
  assert.ok(MD.includes("é") && MD.includes("œ") === MD.includes("œ"));
  assert.ok(!MD.includes("\n\n\n"), "pas plus d'une ligne vide consécutive");
  assert.ok(MD.endsWith("\n"));
  assert.ok(!/\r/.test(MD));
});

test("appelé sans modèle, le générateur ne jette pas", () => {
  const vide = construireMarkdownOperation();
  assert.ok(vide.includes("type: operation_profero"));
  assert.ok(vide.includes("nombre_chantiers: 0"));
});

// ─── ANTI-BRUIT : COLONNES ET CHAMPS VIDES ───────────────────────────────────

test("une colonne entièrement vide est retirée du tableau", () => {
  const r = construireTableau(
    [{ t: "Tâche" }, { t: "Dépendances" }],
    [["Ossature", ND], ["Plaquage", ND]],
  );
  assert.ok(!r.lignes[0].includes("Dépendances"), r.lignes[0]);
  assert.deepEqual(r.colonnesRetirees, ["Dépendances"]);
  assert.equal(r.lignes.length, 4, "en-tête + séparateur + 2 lignes");
});

test("une colonne qui porte au moins une valeur est conservée", () => {
  const r = construireTableau(
    [{ t: "Tâche" }, { t: "Dépendances" }],
    [["Ossature", ND], ["Plaquage", "Ossature"]],
  );
  assert.ok(r.lignes[0].includes("Dépendances"));
  assert.deepEqual(r.colonnesRetirees, []);
});

test("une colonne marquée `garder` reste même totalement vide", () => {
  const r = construireTableau(
    [{ t: "Tâche" }, { t: "Date prévue", garder: true }],
    [["Ossature", ND]],
  );
  assert.ok(r.lignes[0].includes("Date prévue"));
  assert.deepEqual(r.colonnesRetirees, []);
});

test("une ligne entièrement vide n'est pas écrite", () => {
  const r = construireTableau([{ t: "A" }, { t: "B" }], [["x", "y"], [ND, ND]]);
  assert.equal(r.lignes.length, 3, "une seule ligne de données doit survivre");
});

test("un champ secondaire absent ne produit pas de ligne, un champ gardé oui", () => {
  const l = listeDefinitions([
    ["Nom", "Cloisons"],
    ["Marge cible", null],
    ["Adresse", null, { garder: true }],
  ]);
  assert.equal(l.length, 2);
  assert.ok(l.some((x) => x.includes("Cloisons")));
  assert.ok(l.some((x) => x.includes("Adresse") && x.includes(ND)));
  assert.ok(!l.some((x) => x.includes("Marge cible")));
});

test("le document signale les colonnes retirées au lieu de les remplir de vide", () => {
  const nd = MD.split(ND).length - 1;
  const lignesTableau = MD.split("\n").filter((l) => l.startsWith("|")).length;
  assert.ok(nd < lignesTableau, `« ${ND} » apparaît ${nd} fois pour ${lignesTableau} lignes de tableau`);
  assert.ok(MD.includes("Colonnes sans aucune valeur"), "les colonnes retirées doivent être signalées");
});

// ─── RÉFÉRENCES D'OUVRAGE ────────────────────────────────────────────────────

test("les références d'ouvrage s'écrivent CODE (#n), ou #n sans code", () => {
  assert.ok(MD.includes("CLO-048 (#1)"), "la référence codée doit apparaître");
  assert.ok(MD.includes("| #2 |"), "un ouvrage sans code garde son numéro interne");
});

// ─── MARGES ──────────────────────────────────────────────────────────────────

test("la marge à date est nommée « provisoire » et passe après la marge au devis", () => {
  assert.ok(MD.includes("Marge provisoire sur coûts enregistrés"));
  assert.ok(!MD.includes("Marge nette à date"), "l'ancien intitulé trompeur ne doit plus exister");
  const devis = MD.indexOf("Marge prévisionnelle au devis");
  const provisoire = MD.indexOf("Marge provisoire sur coûts enregistrés");
  assert.ok(devis > 0 && provisoire > devis, "la marge au devis vient en premier");
});

test("un avancement faible déclenche la mise en garde sur la marge provisoire", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    agg: { ...AGG, avancement: 0, marge: 105544, margePct: 95.9 },
  });
  assert.ok(md.includes("l'avancement n'est que de 0 %"));
  assert.ok(md.includes("marge prévisionnelle au devis** qui fait foi"));
});

test("un avancement significatif n'affiche pas la mise en garde", () => {
  const md = construireMarkdownOperation({ ...MODELE, agg: { ...AGG, avancement: 62 } });
  assert.ok(!md.includes("l'avancement n'est que de"));
});

// ─── ADRESSE ─────────────────────────────────────────────────────────────────

test("une adresse déduite des chantiers est annoncée comme déduite", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    operation: { ...OP, adresse: { valeur: "6 Square de l'Étrier", origine: "chantiers", liste: ["6 Square de l'Étrier"] } },
  });
  assert.ok(md.includes("Adresse principale déduite des chantiers"));
  assert.ok(md.includes("6 Square de l'Étrier"));
  assert.ok(md.includes("L'opération elle-même n'a pas d'adresse enregistrée"));
  assert.ok(!md.includes("**Adresse principale** :"), "elle ne doit pas passer pour une saisie");
});

test("une opération multisite liste les adresses de ses chantiers", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    operation: { ...OP, adresse: { valeur: null, origine: "multisite", liste: ["3 rue A", "7 rue B"] } },
  });
  assert.ok(md.includes("opération multisite"));
  assert.ok(md.includes("3 rue A") && md.includes("7 rue B"));
});

// ─── FACTURATION ─────────────────────────────────────────────────────────────

test("un montant de facture inconnu n'est jamais rendu par zéro", () => {
  const bloc = MD.slice(MD.indexOf("### Facturation client"));
  const entete = bloc.split("\n").find((l) => l.startsWith("| Numéro |"));
  const colonnes = entete.split("|").map((x) => x.trim());
  const iMontant = colonnes.indexOf("Montant");
  assert.ok(iMontant > 0, "la colonne Montant doit exister");

  const ligne = bloc.split("\n").find((l) => l.includes("F-260071"));
  assert.ok(ligne, "la facture sans montant doit être listée, pas masquée");
  const montant = ligne.split("|").map((x) => x.trim())[iMontant];
  assert.equal(montant, ND, `un montant inconnu s'écrit « ${ND} », jamais 0 € : ${ligne}`);

  // La facture dont le montant EST connu le montre, centimes compris.
  const connue = bloc.split("\n").find((l) => l.includes("F-260067"));
  assert.ok(connue.split("|").map((x) => x.trim())[iMontant].includes("22 231,68")
    || connue.split("|").map((x) => x.trim())[iMontant].includes("22\u00a0231,68"), connue);
});

test("le total de facturation dit qu'il ne porte que sur les montants connus", () => {
  assert.ok(MD.includes("total des montants connus"));
  assert.ok(MD.includes("Un montant inconnu n'est pas"));
  assert.ok(!MD.includes("Total facturé HT : **0 €**"), "l'ancien total faux ne doit plus exister");
});

test("HT et TTC ne sont jamais confondus dans les totaux", () => {
  const bloc = MD.slice(MD.indexOf("### Facturation client"));
  assert.ok(bloc.includes("TTC"), "les factures ProGBat se totalisent en TTC");
  assert.ok(bloc.includes("Factures saisies à la main"), "les factures manuelles ont leur propre total HT");
  assert.ok(/Factures saisies à la main.*HT\./.test(bloc));
});

test("un total entièrement inconnu est dit non calculable", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    chantiers: [{
      ...CHANTIER,
      facturation: {
        nb: 1,
        lignes: [{ ...CHANTIER.facturation.lignes[1] }],
        progbat: { nb: 1, totalTTC: 0, totalRegle: 0, reste: 0, sansMontant: 1, anomalies: 1 },
        manuel: null,
      },
    }],
  });
  assert.ok(md.includes("total non calculable"), "un total sans aucun montant connu doit être annoncé tel quel");
});

// ─── RÉPÉTITION DES TÂCHES ───────────────────────────────────────────────────

test("le détail d'une tâche n'est écrit qu'une fois, dans le plan de travaux", () => {
  const debut = MD.indexOf("## Sous-tâches des ouvrages (récapitulatif)");
  const fin = MD.indexOf("## Matériaux prévisionnels");
  const recap = MD.slice(debut, fin);
  assert.ok(recap.includes("Sous-tâches"), "le récapitulatif existe");
  assert.ok(!recap.includes("Pose cloison"), "le nom des tâches n'est pas répété dans le récapitulatif");
  assert.ok(recap.includes("Plan de travaux et"), "il renvoie à la liste canonique");
  const lignesDetail = MD.split("\n").filter((l) => l.includes("Pose cloison") && l.includes("35 %"));
  assert.equal(lignesDetail.length, 1, "une seule ligne de détail par tâche");
});

test("les ratios sont affichés avec leur unité de pourcentage", () => {
  const ligne = MD.split("\n").find((l) => l.includes("Pose cloison") && l.startsWith("|"));
  assert.ok(ligne.includes("35 %"), `le ratio doit porter son unité : ${ligne}`);
});

test("les actions restantes ne reprennent pas toutes les tâches à venir", () => {
  const bloc = MD.slice(MD.indexOf("### Tâches du plan qui appellent une décision"));
  assert.ok(bloc.includes("En retard"));
  assert.ok(bloc.includes("Sans date"));
  assert.ok(MD.includes("au-delà de 14 jours"), "le reste doit être renvoyé au plan de travaux");
});

// ─── DONNÉES DU CYCLE DE VIE ─────────────────────────────────────────────────

test("les données saisies sur une étape sont formatées, jamais brutes", () => {
  assert.ok(MD.includes("Montant : "), "le libellé métier doit apparaître");
  assert.ok(!MD.includes("montant : 20210.62"), "aucune paire clé-valeur brute");
  assert.ok(/Montant : 20.210,62 €/.test(MD), "le montant doit être formaté en euros");
});

test("donneesEtape formate dates, montants, nombres et booléens", () => {
  assert.equal(donneesEtape([{ label: "Date", valeur: "2026-05-30", type: "date" }]), "Date : 30/05/2026");
  assert.equal(donneesEtape([{ label: "Signé", valeur: true, type: "booleen" }]), "Signé : Oui");
  assert.equal(donneesEtape([]), null);
  assert.ok(donneesEtape([{ label: "Montant", valeur: 1500, type: "montant" }]).includes("€"));
  assert.equal(donneesEtape(["Réponse : accepté"]), "Réponse : accepté");
});

// ─── ÉQUIPES ─────────────────────────────────────────────────────────────────

test("une équipe de prestataires n'est pas annoncée comme interne", () => {
  const ligne = MD.split("\n").find((l) => l.startsWith("| Externe |"));
  assert.ok(ligne, "l'équipe Externe doit figurer dans les intervenants");
  assert.ok(ligne.includes("Prestataire externe"), ligne);
  assert.ok(!ligne.includes("Équipe interne"), ligne);
  const interne = MD.split("\n").find((l) => l.startsWith("| Second œuvre |"));
  assert.ok(interne.includes("Équipe interne"), interne);
});

// ─── RESTRICTION DE RÔLE ─────────────────────────────────────────────────────

test("une catégorie fermée au rôle rend le document partiel et le dit", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    genere: { ...MODELE.genere, restrictions: ["Matériaux signalés manquants — réservés aux conducteurs."] },
  });
  assert.ok(md.includes("export_complet: false"));
  assert.ok(md.includes("sections_non_accessibles: 1"));
  assert.ok(md.includes("certaines catégories ne sont pas accessibles"));
  assert.ok(md.includes("Ce n'est pas une panne"));
  assert.ok(md.includes("Matériaux signalés manquants — réservés aux conducteurs."));
});

test("panne et restriction sont distinguées dans le même document", () => {
  const md = construireMarkdownOperation({
    ...MODELE,
    genere: {
      ...MODELE.genere,
      erreurs: ["comptes rendus : timeout"],
      restrictions: ["Suggestions de matériaux — rôle insuffisant."],
    },
  });
  assert.ok(md.includes("sources_en_erreur: 1"));
  assert.ok(md.includes("sections_non_accessibles: 1"));
  assert.ok(md.includes("**Export incomplet.**"));
  assert.ok(md.includes("certaines catégories ne sont pas accessibles"));
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
