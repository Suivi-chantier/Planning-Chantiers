// Vérification CR-6 (partie 6C) : lignes du PLANNING liées au PHASAGE.
//
// EXEMPLE ISSU DES TESTS, DONNÉES FICTIVES : chantier « C1 », tâches t1…t9,
// pièce « Salle de bain », lots fictifs. Aucune donnée de production, aucun
// accès à la base. Tout passe par le VRAI code :
//   src/Renovation/liaisonPlanningV1.mjs  (proposition, lignes libres,
//                                          compteur, poser le lien)
//   src/Renovation/compteRenduV3.mjs      (côté ouvrier, partie 6A)
//   src/Renovation/phasageMobileV1.mjs    (arbre du phasage sur téléphone)
// et lit le code des écrans pour les chemins de création des lignes.
//
//   node scripts/verif-cr6-planning-lie.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tachesPourLiaison, propositionsLiaison, tachesPourLiaisonDepuisPhasage, propositionsPourLigne,
  natureLibre, estLigneLibre, etatLiaisonLigne, lignesDeCellule, tauxLiaisonPlanning, lignesALier,
  lierLignePlanning, lierLigneDansCellule, marquerHorsPhasage, marquerLigneDansCellule,
  EXPLICATION_TAUX_LIAISON, MARQUE_HORS_PHASAGE,
} from "../src/Renovation/liaisonPlanningV1.mjs";
import * as V3 from "../src/Renovation/compteRenduV3.mjs";
import { construireArbre } from "../src/Renovation/phasageMobileV1.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const lire = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── Données fictives : le même phasage, vu par le bureau et par le téléphone ─
const LOTS = [
  { id: "plomb", label: "Plomberie", couleur: "#06b6d4" },
  { id: "elec", label: "Électricité", couleur: "#eab308" },
  { id: "murs", label: "Murs cloison doublages", couleur: "#6366f1" },
];
const PIECES = [{ id: "sdb", nom: "Salle de bain" }];
const OUVRAGES = [
  { id: "o1", libelle: "Chauffe-eau 40 L", lot_id: "plomb", taches: [
    { id: "t6", nom: "Passages alimentations PER chauffe-eau", avancement: 100 },
    { id: "t7", nom: "Raccordement PER", avancement: 75, piece_id: "sdb" },
    { id: "t9", nom: "Raccordement PVC", avancement: 100 },
  ] },
  { id: "o2", libelle: "Installation électrique", libelle_perso: "Électricité T2", lot_id: "elec", taches: [
    { id: "t8", nom: "Pose tableau + GTL", avancement: 0 },
    { id: "t2", nom: "Plaquage SDB", nom_perso: "Plaquage salle de bain", avancement: 0 },
  ] },
  { id: "o3", libelle: "Cloison SAD", lot_id: "murs", taches: [
    { id: "t1", nom: "Bandes et 1ère passe cloison", avancement: 40 },
    { id: "t3", nom: "2ème passe cloison", avancement: 0 },
  ] },
];
// Bureau : phasage brut (table phasages) ; téléphone : réponse de ouvrier_mes_phases.
const candidatesBureau = tachesPourLiaisonDepuisPhasage({ ouvrages: OUVRAGES, pieces: PIECES, lots: LOTS });
const PAYLOAD_OUVRIER = { lots: LOTS, pieces: PIECES, phases: [
  { id: "g1", ouvrages: [OUVRAGES[0], { ...OUVRAGES[2], taches: [OUVRAGES[2].taches[0]] }] },
  { id: "g2", ouvrages: [OUVRAGES[1], { ...OUVRAGES[2], taches: [OUVRAGES[2].taches[1]] }] },
] };
const candidatesOuvrier = V3.tachesPourLiaison(construireArbre(PAYLOAD_OUVRIER));

// ── 1. Même service que le compte rendu de l'ouvrier (6A) ───────────────────
ok(V3.propositionsLiaison === propositionsLiaison, "la proposition du compte rendu (6A) EST la fonction du planning (même service)");
ok(V3.tachesPourLiaison === tachesPourLiaison, "même liste de tâches candidates des deux côtés");
const resume = (cs) => cs.map(x => [x.id, x.nom, x.nomDevis, x.ouvrage, x.lot, x.piece, x.etat]).sort((a, b) => a[0].localeCompare(b[0]));
eq(resume(candidatesBureau), resume(candidatesOuvrier), "phasage brut (bureau) et phasage du téléphone donnent les mêmes candidates");
for (const texte of ["Terminer les alimentations PER", "Terminer la pose du tableau+ GTL", "2ème passe SDB", "Raccordement PVC", "RDV ENEDIS"]) {
  const b = propositionsLiaison({ texte, taches: candidatesBureau }).map(p => [p.id, p.score, p.raisons]);
  const o = propositionsLiaison({ texte, taches: candidatesOuvrier }).map(p => [p.id, p.score, p.raisons]);
  eq(b, o, `« ${texte} » : même proposition au planning et dans le compte rendu`);
}

// ── 2. Ligne de planning non liée → proposition la plus probable ────────────
const L = (text, extra = {}) => ({ id: `id-${text}`, allocation_uid: `uid-${text}`, text, duree: 2, ouvriers: ["Paul"], ...extra });
const caseC1 = { chantier_id: "C1", jour: "Mardi", taches: [L("Terminer les alimentations PER"), L("Pose tableau", { tache_id: "t8" }), L("RDV ENEDIS")] };
const p = propositionsPourLigne({ ligne: caseC1.taches[0], candidates: candidatesBureau, tachesDeLaCase: caseC1.taches });
eq([p[0].id, p[0].nom, p[0].lot, p[0].ouvrage, p[0].piece], ["t7", "Raccordement PER", "Plomberie", "Chauffe-eau 40 L", "Salle de bain"],
  "« Terminer les alimentations PER » → « Raccordement PER » (Plomberie › Chauffe-eau 40 L › Salle de bain)");
eq(p[0].id, propositionsLiaison({ texte: "Terminer les alimentations PER", taches: candidatesOuvrier, exclure: ["t8"] })[0].id,
  "même tête de liste que le compte rendu de l'ouvrier");
eq(propositionsPourLigne({ ligne: L("Pose du tableau GTL"), candidates: candidatesBureau, tachesDeLaCase: caseC1.taches }).map(x => x.id).includes("t8"), false,
  "une tâche déjà dans la case n'est jamais proposée (comme une tâche déjà dans la journée)");
eq(propositionsPourLigne({ ligne: L("Plaquage salle de bain"), candidates: candidatesBureau })[0].id, "t2", "le nom personnalisé est reconnu");
eq(propositionsPourLigne({ ligne: L("Plaquage SDB"), candidates: candidatesBureau })[0].id, "t2", "le libellé du devis aussi");

// ── 3. Rien de proposé si aucun nom ne ressemble ────────────────────────────
eq(propositionsPourLigne({ ligne: L("RDV ENEDIS"), candidates: candidatesBureau }), [], "« RDV ENEDIS » : aucune proposition inventée");
eq(propositionsPourLigne({ ligne: L("Mise en place d'un frigo top"), candidates: candidatesBureau }), [], "« frigo top » : rien qui ressemble, rien de proposé");
eq(propositionsPourLigne({ ligne: L("Terminer"), candidates: candidatesBureau }), [], "un mot d'action seul ne propose rien");
eq(propositionsPourLigne({ ligne: L("Raccordement PER"), candidates: [] }), [], "sans phasage : aucune proposition");
eq(propositionsPourLigne({ ligne: L("Raccordement PVC"), candidates: candidatesBureau })[0].id, "t9", "une tâche terminée reste proposable si son nom est identique");
// Proposition pendant la saisie d'une nouvelle ligne (création manuelle).
eq(propositionsPourLigne({ ligne: { text: "" }, candidates: candidatesBureau }), [], "ligne en cours de saisie, encore vide : rien");
eq(propositionsPourLigne({ ligne: { text: "2ème passe" }, candidates: candidatesBureau })[0].id, "t3", "ligne tapée à la création : la proposition apparaît dès que le nom ressemble");

// ── 4. Lignes « libres » : reconnues, jamais signalées, jamais comptées ─────
const libres = ["Congé Paul", "Visite médicale Selman 8h50", "Absent", "Arrêt maladie", "Trajet retour", "Passage au dépôt", "Journée de formation", "RTT"];
for (const t of libres) ok(estLigneLibre({ text: t }), `« ${t} » est une ligne libre`);
const pasLibres = ["Dépose / repose de la fenêtre chambre", "Pose des plinthes dépôt", "Nettoyage avant réception", "RDV ENEDIS",
  "Formation de pente", "Évacuation des déchets", "Approvisionnement baie vitrée", "Déplacement du tableau électrique"];
for (const t of pasLibres) ok(!estLigneLibre({ text: t }), `« ${t} » reste à lier (existe comme tâche dans des phasages réels)`);
eq(natureLibre({ text: "Visite médicale Vince" }), { code: "absence", label: "absence", marquee: false }, "nature d'une ligne libre lue dans son texte");
eq(natureLibre({ text: "Livraison cuisine", [MARQUE_HORS_PHASAGE]: true }), { code: "marquee", label: "pas une tâche du chantier", marquee: true }, "ligne marquée « pas une tâche du chantier »");
eq([etatLiaisonLigne({ text: "Congé", tache_id: "t1" }), etatLiaisonLigne({ text: "Congé" }), etatLiaisonLigne({ text: "Bandes" }), etatLiaisonLigne({ text: "  " })],
  ["liee", "libre", "a_lier", "vide"], "liée l'emporte ; libre ; à lier ; vide");
const semaineALier = [caseC1, { chantier_id: "C1", jour: "Lundi", taches: [L("Congé Paul"), L("Livraison", { hors_phasage: true }), L("Bandes chambre")] }];
eq(lignesALier(semaineALier, { jours: ["Lundi", "Mardi"] }).map(i => [i.jour, i.text]), [["Lundi", "Bandes chambre"], ["Mardi", "Terminer les alimentations PER"], ["Mardi", "RDV ENEDIS"]],
  "liste des lignes à lier : ni libres, ni marquées, ni liées ; dans l'ordre des jours");
eq(lignesALier(semaineALier, { jours: ["Lundi", "Mardi"] })[1].exclure, ["t8"], "chaque ligne connaît les tâches déjà dans sa case");

// ── 5. Le compteur « X % des lignes de la semaine liées au phasage » ────────
const liee = (t, id) => L(t, { tache_id: id });
let tx = tauxLiaisonPlanning([
  { chantier_id: "C1", jour: "Lundi", taches: [liee("a", "t1"), liee("b", "t2"), L("c")] },
  { chantier_id: "C2", jour: "Mardi", taches: [liee("d", "t3"), L("Congé Paul"), { text: "" }] },
]);
eq([tx.liees, tx.aLier, tx.comptees, tx.libres, tx.pourcent, tx.libelle], [3, 1, 4, 1, 75, "75 % des lignes de la semaine liées au phasage"],
  "cas normal : 3 liées sur 4 → 75 % ; la ligne de congé et la ligne vide ne comptent pas");
eq(tx.detail, "3 liées sur 4 · 1 à lier · 1 libre non comptée", "le détail dit ce qui est compté");
eq(tx.explication, EXPLICATION_TAUX_LIAISON, "même explication partout (planning et page Qualité)");
tx = tauxLiaisonPlanning([]);
eq([tx.pourcent, tx.libelle, tx.comptees], [null, "aucune ligne", 0], "semaine sans aucune ligne : « aucune ligne », ni 0 % ni 100 %");
tx = tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", taches: [] }, { chantier_id: "C1", jour: "Mardi", planifie: "" }]);
eq([tx.pourcent, tx.libelle], [null, "aucune ligne"], "cases vides : « aucune ligne »");
tx = tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", taches: [L("Congé Paul"), L("Visite médicale"), L("Livraison", { hors_phasage: true })] }]);
eq([tx.pourcent, tx.libelle, tx.libres, tx.marquees], [null, "aucune ligne à lier (3 lignes libres)", 3, 1], "seulement des lignes libres : pas de pourcentage");
tx = tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", taches: [...Array.from({ length: 199 }, (_, i) => liee(`l${i}`, `t${i}`)), L("reste")] }]);
eq([tx.pourcent, tx.aLier], [99, 1], "199 liées sur 200 : 99 %, jamais 100 % tant qu'une ligne reste à lier");
tx = tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", taches: [liee("x", "t1"), ...Array.from({ length: 299 }, (_, i) => L(`l${i}`))] }]);
eq(tx.pourcent, 1, "1 liée sur 300 : 1 %, jamais 0 % dès qu'une ligne est liée");
tx = tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", taches: [liee("x", "t1")] }]);
eq([tx.pourcent, tx.libelle], [100, "100 % des lignes de la semaine liées au phasage"], "tout lié : 100 %");
eq(lignesDeCellule({ planifie: "Bandes\nPonçage\n", taches: [] }).map(l => l.text), ["Bandes", "Ponçage"], "ancien format (texte seul) : lignes comptées comme affichées");
eq(tauxLiaisonPlanning([{ chantier_id: "C1", jour: "Lundi", planifie: "Bandes\nPonçage", taches: [] }]).aLier, 2, "… et comptées à lier");

// ── 6. Accepter la proposition pose le bon lien, et rien d'autre ────────────
const avant = L("Terminer les alimentations PER", { externe: false, verrou: "x" });
const apres = lierLignePlanning(avant, p[0].id);
eq(apres, { ...avant, tache_id: "t7" }, "seul tache_id est ajouté : texte, durée, équipe, identifiants inchangés");
eq(lierLignePlanning(L("Livraison", { hors_phasage: true }), "t1"), { ...L("Livraison"), tache_id: "t1" }, "lier une ligne marquée retire la marque « pas une tâche »");
eq(lierLignePlanning(avant, ""), avant, "sans tâche choisie : rien ne change");
const casePlanning = [L("A"), L("Terminer les alimentations PER"), liee("C", "t8")];
let r = lierLigneDansCellule(casePlanning, { allocation_uid: "uid-Terminer les alimentations PER" }, "t7");
eq([r.trouve, r.taches[0], r.taches[1], r.taches[2]], [true, casePlanning[0], { ...casePlanning[1], tache_id: "t7" }, casePlanning[2]],
  "dans la case relue en base : seule CETTE ligne reçoit le lien, les autres sont identiques");
eq(lierLigneDansCellule(casePlanning, { allocation_uid: "uid-disparue" }, "t7"), { taches: casePlanning, trouve: false }, "ligne disparue entre-temps : rien n'est écrit");
eq(lierLigneDansCellule(casePlanning, { allocation_uid: "uid-C" }, "t1").trouve, false, "ligne déjà liée entre-temps : on n'écrase pas son lien");
eq(lierLigneDansCellule([{ id: "x1", text: "Bandes" }], { id: "x1" }, "t1").taches, [{ id: "x1", text: "Bandes", tache_id: "t1" }], "ligne sans identifiant d'allocation : retrouvée par son id");
eq(marquerHorsPhasage(L("Livraison")), { ...L("Livraison"), hors_phasage: true }, "« Pas une tâche du chantier » : seule la marque est ajoutée");
eq(marquerHorsPhasage(L("Livraison", { hors_phasage: true }), false), L("Livraison"), "… et s'annule");
r = marquerLigneDansCellule(casePlanning, { allocation_uid: "uid-A" }, true);
eq([r.trouve, r.taches[0].hors_phasage, r.taches[1], r.taches[2]], [true, true, casePlanning[1], casePlanning[2]], "marquer dans la case relue : seule cette ligne change");
eq(marquerLigneDansCellule(casePlanning, { allocation_uid: "uid-C" }, true).trouve, false, "une ligne liée ne se marque pas « pas une tâche »");

// ── 7. Chemins de création des lignes du planning (lecture du code) ─────────
const CM = lire("../src/Renovation/CellModal.jsx");
const PV2 = lire("../src/Renovation/PhasageV2.jsx");
const APPLY = lire("../src/Renovation/planningReplanningApplyPlanV1.js");
const PL = lire("../src/Renovation/Planning.jsx");
const PANNEAU = lire("../src/Renovation/LiaisonLignePlanning.jsx");
ok(/const newT = \{[\s\S]{0,200}tache_id: t\.id,/.test(CM), "case du planning, « Planifier depuis le phasage » : la ligne porte le lien (inchangé)");
ok(/const newTask = \{ id: rid\(\), tache_id: tache\.id,/.test(PV2), "phasage, « Envoyer au planning » : la ligne porte le lien (inchangé)");
ok(/if \(!tacheId\) throw new Error\(`Allocation proposée \$\{uid\} sans tache_id`\)/.test(APPLY) && /tache_id: tacheId,/.test(APPLY),
  "moteur et « Planifier une opération » (même écriture) : jamais de ligne sans lien (inchangé)");
// Création à la main (« + Ajouter une tâche ») : seule source des lignes non liées → proposition sous la ligne.
ok(/x\.tache_id \|\| etatLiaisonLigne\(x\) === "a_lier"/.test(CM), "case du planning : le phasage est lu dès qu'une ligne n'est pas liée (proposition à la création)");
ok(/<PropositionLiaison T=\{T\} etat=\{etatPhasageLiaison\} proposition=\{prop\}/.test(CM)
  && /propositionsPourLigne\(\{ligne:tache,candidates:candidatesLiaison,tachesDeLaCase:draft\.taches\|\|\[\]\}\)/.test(CM),
  "case du planning : sous chaque ligne non liée (même en cours de saisie), la proposition de liaisonPlanningV1");
ok(/onLier=\{\(p\)=>lierLigne\(ref,p\.id\)\}/.test(CM) && /lierLignePlanning\(x, tacheId\)/.test(CM), "case du planning : « Lier » passe par lierLignePlanning (un clic)");
ok(/ligneALier\?\(\s*<button onClick=\{\(\)=>lierLigne\(/.test(CM), "case du planning : « Choisir dans le phasage » lie la ligne au lieu d'en ajouter une");
ok((CM.match(/lierLigne\(/g) || []).length === 2, "case du planning : « Lier » n'est appelé que depuis deux boutons (rien n'est lié sans clic)");
ok(/tauxLiaisonPlanning\(cellulesDepuisCarte\(cells\)\)/.test(PL) && /\{tauxLiaison\.libelle\}/.test(PL), "page du planning : compteur calculé par tauxLiaisonPlanning, libellé affiché tel quel");
ok(/etatLiaisonLigne\(tache\) === "a_lier"/.test(PL), "grille du planning : repère sur chaque ligne non liée");
ok(/lierLigneDansCellule\(taches, \{ allocation_uid: it\.allocation_uid, id: it\.ligne\?\.id \}, proposition\.id\)/.test(PANNEAU)
  && /\.select\("id, taches"\)/.test(PANNEAU) && /update\(\{ taches: res\.taches \}\)\.eq\("id", data\.id\)/.test(PANNEAU),
  "liste de la semaine : « Lier » relit la case en base et n'écrit que la colonne des lignes");
ok(/ecrit\.length === 0/.test(PANNEAU), "écriture refusée sans erreur (droits) : signalée, jamais présentée comme faite");
ok(/onLier=\{enCours \? null : \(p\) => lier\(it, p\)\}/.test(PANNEAU), "liste de la semaine : « Lier » seulement sur clic");

console.log(`verif-cr6-planning-lie : ${nbOk} contrôles OK (exemple issu des tests, données fictives)`);
