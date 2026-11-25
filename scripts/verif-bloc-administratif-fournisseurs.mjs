#!/usr/bin/env node
// Vérifie le bloc du jour « Administratif fournisseurs » (projet
// docs/projets/organisation-par-jour.md, tâche 9) et les extractions faites
// pour lui :
//
//   1. calcul de la page Encours fournisseurs (encoursFournisseursPageV1.mjs) :
//      échéance selon le mode, commandes « migration » et liées à un BL
//      exclues, payé comptant, facturé prioritaire sur le saisi, date
//      d'échéance saisie sur la facture, cartes du mois en cours ;
//   2. historique de la page Rapprochement factures
//      (historiqueRapprochementV1.mjs) : statuts affichés, filtre « À
//      rapprocher », plus anciennes d'abord ;
//   3. états du bloc (règle 10) : chargement, erreur PAR PARTIE, aucune
//      facture à rapprocher, aucun encours à payer — jamais 0 € quand la
//      lecture a échoué ;
//   4. statique : la page Encours, la page Rapprochement et le bloc utilisent
//      les mêmes lectures et les mêmes fonctions ; modules purs ; registre
//      branché ; encoursFournisseursV1.mjs (mail et notification F2) non
//      utilisé par la page ni par le bloc.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-administratif-fournisseurs.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as P from "../src/Renovation/encoursFournisseursPageV1.mjs";
import * as H from "../src/Renovation/historiqueRapprochementV1.mjs";
import * as B from "../src/Renovation/administratifFournisseursV1.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const FOURNISSEURS = [
  { id: "f-comptant", nom: "Négoce Fictif", mode_paiement: "comptant" },
  { id: "f-30j", nom: "Visserie Fictive", mode_paiement: "30j" },
  { id: "f-fdm", nom: "Électricité Fictive", mode_paiement: "echeance" },
  { id: "f-sans", nom: "Peinture Fictive", mode_paiement: null },
];
const cmd = (id, fournisseur_id, fournisseur_nom, montant_ht, date_doc, extra = {}) => ({
  id, fournisseur_id, fournisseur_nom, doc_type: "bl", doc_numero: "N-" + id, montant_ht, date_doc,
  created_at: "2026-11-01T08:00:00+00:00", statut_facturation: "en_attente_facture", source: "mobile", lignes: [], ...extra,
});
const COMMANDES = [
  cmd("c1", "f-fdm", "Électricité Fictive", 100, "2026-09-15"),              // +31 j = 16/10 -> fin de mois 31/10
  cmd("c2", "f-fdm", "Électricité Fictive", 50, "2026-08-31"),               // +31 j = 01/10 -> 31/10
  cmd("c3", "f-30j", "Visserie Fictive", 40, "2026-10-20"),                  // +30 j = 19/11
  cmd("c4", "f-comptant", "Négoce Fictif", 30, "2026-11-05", { statut_facturation: "facture" }), // payé, novembre
  cmd("c5", "f-comptant", "Négoce Fictif", 20, "2026-11-10"),                // comptant non payé : novembre
  cmd("c6", "f-fdm", "Électricité Fictive", 999, "2026-10-01", { source: "migration" }), // ancienne saisie : exclue
  cmd("c7", "f-30j", "Visserie Fictive", 70, "2026-10-25"),                  // liée à un BL de facture : exclue
  cmd("c8", "f-sans", "Peinture Fictive", null, "2026-11-02", { lignes: [{ prix_total: 12.5 }, { prix_total: "7.5" }, { prix_total: null }] }), // montant = lignes
  cmd("c9", "f-sans", "Peinture Fictive", 0, "2026-11-02"),                  // montant nul : ignoré
  cmd("c10", null, "electricite fictive", 10, "2026-10-14"),                 // mode trouvé par le nom normalisé
  cmd("c11", "f-30j", "Visserie Fictive", 15, null, { created_at: "2026-10-18T09:00:00+00:00" }), // date = création
  cmd("c12", "f-fdm", "Électricité Fictive", 300, "2026-10-10"),             // +31 j = 10/11 -> 30/11 : novembre
];
const FACTURES = [
  { id: "fa1", numero: "F-1", fournisseur_id: "f-30j", fournisseur_nom: "Visserie Fictive", montant_ht: 60, date_facture: "2026-10-20", date_echeance: null, created_at: "2026-10-21T00:00:00Z", statut: "a_rapprocher" },
  { id: "fa2", numero: "F-2", fournisseur_id: "f-fdm", fournisseur_nom: "Électricité Fictive", montant_ht: 500, date_facture: "2026-10-01", date_echeance: "2026-12-15", created_at: "2026-10-02T00:00:00Z", statut: "a_rapprocher" },
];
const BL = [{ facture_id: "fa1", commande_id: "c7", bl_numero: "BL-7", montant_ht: 70, statut: "rapproche" }];
const DONNEES = { fournisseurs: FOURNISSEURS, commandes: COMMANDES, factures: FACTURES, facturesBl: BL };

// ═══ 1. Calcul de la page Encours ═══════════════════════════════════════════
test("1. échéance selon le mode du fournisseur (comptant, 30 j, 30 j fin de mois)", () => {
  assert.equal(P.echeanceISO("2026-07-01", "echeance"), "2026-08-31", "exemple de la page : 01/07 -> 31/08");
  assert.equal(P.echeanceISO("2026-08-31", "echeance"), "2026-10-31");
  assert.equal(P.echeanceISO("2026-10-20", "30j"), "2026-11-19");
  assert.equal(P.echeanceISO("2026-10-20", "comptant"), "2026-10-20");
  assert.equal(P.echeanceISO("2026-10-20", ""), "2026-10-20");
  assert.equal(P.echeanceISO("", "30j"), "");
  assert.equal(P.echeanceISO(null, "30j"), "");
  assert.equal(P.echeanceISO("pas une date", "30j"), "pas une date");
});

test("2. éléments : migration et commandes liées à un BL exclues, montant des lignes, date de création, nom normalisé", () => {
  const it = P.itemsEncoursFournisseurs(DONNEES);
  const ids = it.filter((x) => x.kind === "cmd").map((x) => x.doc.numero);
  assert.ok(!ids.includes("N-c6"), "ancienne saisie (migration) exclue");
  assert.ok(!ids.includes("N-c7"), "commande déjà liée à un BL de facture exclue");
  assert.ok(!ids.includes("N-c9"), "montant nul ignoré");
  const c8 = it.find((x) => x.doc.numero === "N-c8");
  assert.equal(c8.montant, 20, "montant = somme des lignes quand montant_ht est vide");
  assert.equal(it.find((x) => x.doc.numero === "N-c11").mois, "2026-11", "sans date du document : date de création (18/10 + 30 j)");
  assert.equal(it.find((x) => x.doc.numero === "N-c10").mois, "2026-11", "mode trouvé par le nom normalisé (fin de mois)");
  assert.equal(it.find((x) => x.doc.numero === "N-c4").mois, "2026-11", "payé : mois du document");
  assert.equal(it.find((x) => x.doc.numero === "N-c4").paye, true);
  const fa2 = it.find((x) => x.kind === "fact" && x.doc.numero === "F-2");
  assert.equal(fa2.mois, "2026-12", "date d'échéance saisie sur la facture prioritaire");
  assert.deepEqual(it.find((x) => x.doc.numero === "F-1").doc.bls.map((b) => b.bl_numero), ["BL-7"]);
  assert.deepEqual(P.itemsEncoursFournisseurs({}), []);
  assert.deepEqual(P.itemsEncoursFournisseurs(), []);
});

test("3. regroupement par mois : facturé prioritaire sur le saisi, payé à part, mois décroissants", () => {
  const { moisMap, moisList } = P.regrouperEncoursParMois(P.itemsEncoursFournisseurs(DONNEES));
  assert.deepEqual(moisList.map((g) => g.mois), ["2026-12", "2026-11", "2026-10"]);
  const nov = moisMap.get("2026-11");
  const visserie = nov.parFourn.get("Visserie Fictive");
  assert.equal(visserie.saisi, 55, "c3 + c11");
  assert.equal(visserie.facture, 60, "fa1 : 20/10 + 30 j = 19/11");
  assert.equal(P.aPayerOf(visserie), 60, "à payer = la facture si on en a une");
  assert.equal(P.aPayerOf(nov.parFourn.get("Négoce Fictif")), 20, "sans facture : le saisi");
  assert.equal(nov.parFourn.get("Négoce Fictif").paye, 30);
  // Novembre : Visserie 60 + Négoce 20 + Peinture 20 + Électricité 300 + « electricite fictive » 10 = 410 ; payé 30.
  assert.equal(nov.aPayer, 410);
  assert.equal(nov.paye, 30);
  assert.equal(nov.total, 440);
  assert.equal(moisMap.get("2026-10").aPayer, 150, "c1 + c2 en octobre (c10 : 14/10 + 31 j -> fin novembre)");
  assert.deepEqual(P.fournisseursTriesDuMois(nov).map((f) => f.nom), ["Électricité Fictive", "Visserie Fictive", "Négoce Fictif", "Peinture Fictive", "electricite fictive"], "plus gros à payer d'abord, ordre d'arrivée à égalité");
  assert.deepEqual(P.fournisseursTriesDuMois(undefined), []);
});

test("4. cartes du mois en cours (libellés, mois absent = 0 lu, pas une erreur)", () => {
  const { moisMap } = P.regrouperEncoursParMois(P.itemsEncoursFournisseurs(DONNEES));
  assert.deepEqual(P.chiffresMoisCourant(moisMap, "2026-11"), { cle: "2026-11", libelle: "novembre 2026", aPayer: 410, paye: 30 });
  assert.deepEqual(P.chiffresMoisCourant(moisMap, "2027-03"), { cle: "2027-03", libelle: "mars 2027", aPayer: 0, paye: 0 });
  assert.equal(P.cleMoisCourant(new Date(2026, 10, 25, 10, 0)), "2026-11");
  assert.equal(P.moisLabel("2026-11"), "novembre 2026");
  assert.equal(P.moisLabel(""), "Sans date");
  assert.equal(P.eur(1234.5).replace(/\s/g, " "), "1 234,50");
  assert.equal(P.EXPLICATION_ENCOURS, "Montants regroupés par mois d'échéance de paiement (selon le mode de chaque fournisseur)");
});

// ═══ 2. Historique du Rapprochement ═════════════════════════════════════════
const FACT_H = [ // déjà triées par création décroissante, comme la lecture
  { id: "h1", fournisseur_nom: "Visserie Fictive", numero: "F-10", date_facture: "2026-11-12", montant_ht: 1234.4, statut: "a_rapprocher", created_at: "2026-11-13T00:00:00Z" },
  { id: "h2", fournisseur_nom: "Électricité Fictive", numero: "F-11", date_facture: "2026-11-01", montant_ht: 80, statut: "rapprochee", created_at: "2026-11-02T00:00:00Z" },
  { id: "h3", fournisseur_nom: "", numero: "", date_facture: null, montant_ht: null, statut: "a_rapprocher", created_at: "2026-10-05T09:00:00Z" },
  { id: "h4", fournisseur_nom: "Négoce Fictif", numero: "F-12", date_facture: "2026-09-30", montant_ht: 45.6, statut: "archivee", created_at: "2026-10-01T00:00:00Z" },
  { id: "h5", fournisseur_nom: "Peinture Fictive", numero: "A-1", date_facture: "2026-09-20", montant_ht: -50, statut: "a_rapprocher", type_document: "avoir", created_at: "2026-09-21T00:00:00Z" },
  { id: "h6", fournisseur_nom: "Négoce Fictif", numero: "F-13", date_facture: "2026-08-02", montant_ht: 10, statut: null, created_at: "2026-08-03T00:00:00Z" },
  { id: "h7", fournisseur_nom: "Négoce Fictif", numero: "F-14", date_facture: "2026-11-20", montant_ht: 99, statut: "a_rapprocher", created_at: "2026-11-21T00:00:00Z" },
  { id: "h8", fournisseur_nom: "Visserie Fictive", numero: "F-15", date_facture: "2026-07-14", montant_ht: 5, statut: "a_rapprocher", created_at: "2026-07-15T00:00:00Z" },
];

test("5. statuts de l'historique : exactement ceux de la page", () => {
  const recu = (statut, paye) => ({ kind: "recu", statut, paye });
  assert.deepEqual(H.statutHistorique(recu("facture30j", true)), { label: "Facture 30j · payée", ton: "success" });
  assert.deepEqual(H.statutHistorique(recu("facture30j", false)), { label: "Facture 30j", ton: "info" });
  assert.deepEqual(H.statutHistorique(recu("comptant", true)), { label: "Payé comptant", ton: "success" });
  assert.deepEqual(H.statutHistorique({ kind: "facture", statut: "rapprochee" }), { label: "Rapprochée", ton: "success" });
  assert.deepEqual(H.statutHistorique({ kind: "facture", statut: "archivee" }), { label: "Archivée", ton: "info" });
  assert.deepEqual(H.statutHistorique({ kind: "facture", statut: "a_rapprocher" }), { label: "À rapprocher", ton: "warning" });
  assert.deepEqual(H.statutHistorique({ kind: "facture", statut: null }), { label: "À rapprocher", ton: "warning" }, "statut vide : « À rapprocher », comme la page");
  assert.equal(H.estARapprocher(recu("comptant", false)), false, "un reçu n'est jamais à rapprocher");
});

test("6. historique : factures + reçus (30j / comptant), tri par date décroissante", () => {
  const hist = H.construireHistoriqueRapprochement({
    fournisseurs: [{ id: "f-30j", mode_paiement: "30j" }, { id: "f-c", mode_paiement: "comptant" }],
    factures: FACT_H.slice(0, 2),
    commandes: [
      { id: "r1", fournisseur_id: "f-30j", fournisseur_nom: "Visserie Fictive", doc_numero: "T-1", montant_ht: 12, date_doc: "2026-11-15", statut_facturation: "en_attente_facture" },
      { id: "r2", fournisseur_id: "f-c", fournisseur_nom: "Négoce Fictif", doc_numero: null, montant_ht: 8, date_doc: null, created_at: "2026-11-05T10:00:00Z", statut_facturation: "facture" },
    ],
  });
  assert.deepEqual(hist.map((x) => x.key), ["c_r1", "f_h1", "c_r2", "f_h2"]);
  assert.equal(hist[0].statut, "facture30j");
  assert.equal(hist[2].statut, "comptant");
  assert.equal(hist[2].paye, true);
  assert.equal(hist[2].dateISO, "2026-11-05");
  assert.deepEqual(H.idsFournisseurs30j([{ id: "a", mode_paiement: "30j" }, { id: "b" }]), ["a"]);
  assert.deepEqual(H.idsFournisseurs30j(null), []);
});

test("7. factures à rapprocher : filtre de la page, plus anciennes d'abord", () => {
  const l = H.facturesARapprocherV1(H.construireHistoriqueRapprochement({ factures: FACT_H }));
  assert.deepEqual(l.map((x) => x.id), ["h8", "h6", "h5", "h3", "h1", "h7"], "rapprochée et archivée exclues ; avoir et statut vide inclus comme sur la page");
  assert.equal(l.find((x) => x.id === "h3").dateISO, "2026-10-05", "sans date : date de création");
  assert.equal(H.fmtEur(1234.4).replace(/\s/g, " "), "1 234");
  assert.deepEqual(H.facturesARapprocherV1([]), []);
});

// ═══ 3. États du bloc (règle 10) ═══════════════════════════════════════════
test("8. partie rapprochement : liste (5 plus anciennes, « et N autres »), vide, chargement, erreur", () => {
  const p = B.partieRapprochementV1({ factures: FACT_H });
  assert.equal(p.etat, "liste");
  assert.equal(p.nombre, 6);
  assert.equal(p.apercu.length, B.NB_FACTURES_APERCU);
  assert.equal(p.reste, 1);
  assert.deepEqual(p.apercu[0], { id: "h8", fournisseur: "Visserie Fictive", numero: "F-15", date: "14/07/2026", montant: "5 € HT" });
  assert.equal(p.apercu[3].fournisseur, "Fournisseur ?", "même repli que la page");
  assert.equal(p.apercu[3].montant, null, "montant absent : non affiché (pas 0 €)");
  assert.equal(p.apercu[3].numero, null);
  assert.equal(p.apercu[2].montant.replace(/\s/g, " "), "-50 € HT");
  const v = B.partieRapprochementV1({ factures: [FACT_H[1], FACT_H[3]] });
  assert.deepEqual([v.etat, v.message, v.nombre], ["vide", "Aucune facture à rapprocher.", 0]);
  assert.deepEqual([B.partieRapprochementV1({ factures: [] }).etat], ["vide"]);
  const c = B.partieRapprochementV1({ chargement: true });
  assert.deepEqual([c.etat, c.nombre], ["chargement", null]);
  assert.equal(B.partieRapprochementV1({}).etat, "chargement", "rien lu : jamais « aucune facture »");
  const e = B.partieRapprochementV1({ erreur: "lecture refusée", factures: [] });
  assert.equal(e.etat, "erreur");
  assert.equal(e.nombre, null, "erreur : nombre inconnu, pas 0");
  assert.match(e.message, /Factures à rapprocher illisibles pour le moment \(lecture refusée\)\. Le nombre de factures à rapprocher n'est pas connu\./);
});

test("9. partie encours : cartes de la page, fournisseurs du mois, mois suivants, vide, erreur", () => {
  const e = B.partieEncoursV1({ donnees: DONNEES, moisCourant: "2026-11" });
  assert.equal(e.etat, "liste");
  assert.deepEqual(e.tuiles.map((t) => [t.libelle, t.valeur.replace(/\s/g, " ")]), [["À payer · novembre 2026", "410,00 €"], ["Payé comptant · novembre 2026", "30,00 €"]]);
  assert.equal(e.explication, P.EXPLICATION_ENCOURS);
  assert.deepEqual(e.fournisseurs.map((f) => f.nom), ["Électricité Fictive", "Visserie Fictive", "Négoce Fictif", "Peinture Fictive", "electricite fictive"]);
  assert.equal(e.reste, 0);
  assert.deepEqual(e.suivants.map((m) => [m.libelle, m.aPayer.replace(/\s/g, " ")]), [["décembre 2026", "500,00 €"]]);
  assert.equal(e.message, null);
  // Mois sans rien mais échéances suivantes : message explicite, cartes à 0 lues.
  const oct = B.partieEncoursV1({ donnees: { ...DONNEES, commandes: COMMANDES.filter((c) => !["c1", "c2", "c10"].includes(c.id)) }, moisCourant: "2026-10" });
  assert.equal(oct.etat, "liste");
  assert.equal(oct.message, "Aucun encours à payer en octobre 2026.");
  // Rien du tout.
  const vide = B.partieEncoursV1({ donnees: { fournisseurs: FOURNISSEURS, commandes: [], factures: [], facturesBl: [] }, moisCourant: "2026-11" });
  assert.equal(vide.etat, "vide");
  assert.equal(vide.message, "Aucun encours à payer en novembre 2026 ni sur les mois suivants.");
  // Payé comptant seul : rien à payer, carte « payé » lue.
  const paye = B.partieEncoursV1({ donnees: { commandes: [COMMANDES[3]] }, moisCourant: "2026-11" });
  assert.equal(paye.etat, "vide");
  assert.equal(paye.tuiles[1].valeur.replace(/\s/g, " "), "30,00 €");
  // Erreur : aucun montant, aucun 0 €.
  const err = B.partieEncoursV1({ erreur: "lecture refusée", moisCourant: "2026-11" });
  assert.equal(err.etat, "erreur");
  assert.deepEqual([err.tuiles, err.fournisseurs, err.suivants, err.aPayer], [[], [], [], null]);
  assert.match(err.message, /Encours fournisseurs illisible pour le moment \(lecture refusée\)\. Le montant à payer n'est pas connu\./);
  assert.equal(B.partieEncoursV1({ moisCourant: "2026-11" }).etat, "chargement");
  // Plus de 5 fournisseurs : « et N autres ».
  const beaucoup = Array.from({ length: 7 }, (_, i) => cmd("x" + i, "f-comptant", `Fournisseur Fictif ${i}`, 10 + i, "2026-11-03"));
  const b = B.partieEncoursV1({ donnees: { commandes: beaucoup }, moisCourant: "2026-11" });
  assert.equal(b.fournisseurs.length, B.NB_FOURNISSEURS_APERCU);
  assert.equal(b.reste, 2);
  assert.equal(b.fournisseurs[0].nom, "Fournisseur Fictif 6", "ordre de la page : plus gros d'abord");
});

test("10. bloc : une partie illisible n'empêche pas l'autre ; métrique de l'en-tête", () => {
  const ok = B.etatBlocAdministratifFournisseursV1({ rapprochement: { factures: FACT_H }, encours: { donnees: DONNEES }, moisCourant: "2026-11" });
  assert.equal(ok.metrique.replace(/\s/g, " "), "410,00 € à payer ce mois");
  assert.equal(ok.libelleNombre, "6 factures");
  const errR = B.etatBlocAdministratifFournisseursV1({ rapprochement: { erreur: "x" }, encours: { donnees: DONNEES }, moisCourant: "2026-11" });
  assert.equal(errR.rapprochement.etat, "erreur");
  assert.equal(errR.encours.etat, "liste", "encours affiché malgré l'erreur du rapprochement");
  const errE = B.etatBlocAdministratifFournisseursV1({ rapprochement: { factures: FACT_H }, encours: { erreur: "x" }, moisCourant: "2026-11" });
  assert.equal(errE.rapprochement.etat, "liste", "rapprochement affiché malgré l'erreur de l'encours");
  assert.equal(errE.metrique, "encours illisible", "jamais 0 € dans l'en-tête");
  assert.equal(B.etatBlocAdministratifFournisseursV1({ moisCourant: "2026-11" }).metrique, "…");
  const rien = B.etatBlocAdministratifFournisseursV1({ rapprochement: { factures: [] }, encours: { donnees: {} }, moisCourant: "2026-11" });
  assert.equal(rien.metrique, "rien à payer");
  assert.equal(rien.libelleNombre, "aucune");
  assert.equal(B.dateCourteFR("2026-06-30"), "30/06/2026");
  assert.equal(B.dateCourteFR(""), null);
});

// ═══ 4. Statique ═══════════════════════════════════════════════════════════
test("11. page Encours : lectures et calcul extraits, aucun recalcul local, pas encoursFournisseursV1", () => {
  const page = sansCommentaires(lire("src/Renovation/PageEncoursFournisseurs.jsx"));
  assert.match(page, /import \{ chargerDonneesEncoursFournisseurs \} from "\.\/encoursFournisseursDonnees";/);
  assert.match(page, /from "\.\/encoursFournisseursPageV1\.js";/);
  assert.match(page, /const donnees = await chargerDonneesEncoursFournisseurs\(\);\s*const arr = itemsEncoursFournisseurs\(donnees\);/);
  assert.match(page, /const \{ moisMap, moisList \} = regrouperEncoursParMois\(filtered\);/);
  assert.match(page, /chiffresMoisCourant\(moisMap, cleMoisCourant\(new Date\(\)\)\)/);
  assert.match(page, /sousTitre: EXPLICATION_ENCOURS/);
  assert.ok(!/supabase/.test(page), "plus aucune lecture directe dans la page");
  assert.ok(!/function echeanceISO|const aPayerOf|const moisMap = new Map/.test(page), "aucun calcul resté dans la page");
  assert.ok(!/encoursFournisseursV1/.test(page), "la page n'utilise pas le calcul du mail (inchangé)");
  // Depuis la tâche 14, les requêtes vivent dans encoursFournisseursLecture.mjs
  // (partagées avec le mail du vendredi) ; encoursFournisseursDonnees.js les
  // appelle avec le client du navigateur. Mêmes contrôles, sur le nouveau fichier.
  assert.match(sansCommentaires(lire("src/Renovation/encoursFournisseursDonnees.js")),
    /import \{ supabase \} from "\.\.\/supabase";\s*import \{ lireDonneesEncoursFournisseurs \} from "\.\/encoursFournisseursLecture\.mjs";[\s\S]*return lireDonneesEncoursFournisseurs\(supabase\);/);
  const donnees = sansCommentaires(lire("src/Renovation/encoursFournisseursLecture.mjs"));
  assert.match(donnees, /from\("commandes"\)\s*\.select\("id, fournisseur_id, fournisseur_nom, doc_type, doc_numero, montant_ht, date_doc, created_at, statut_facturation, source, lignes:commande_lignes\(prix_total\)"\)\s*\.is\("facture_id", null\)\.limit\(5000\)/);
  assert.match(donnees, /from\("factures"\)\s*\.select\("id, numero, fournisseur_id, fournisseur_nom, montant_ht, date_facture, date_echeance, created_at, statut"\)\s*\.neq\("statut", "archivee"\)\.limit\(2000\)/);
  assert.match(donnees, /from\("facture_bl"\)\.select\("facture_id, commande_id, bl_numero, montant_ht, statut"\)\.limit\(10000\)/);
  assert.match(donnees, /from\("fournisseurs"\)\.select\("id, nom, mode_paiement"\)/);
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(donnees), "lecture seule");
});

test("12. page Rapprochement : lectures et statuts extraits, mêmes requêtes", () => {
  const page = sansCommentaires(lire("src/Renovation/RapprochementFactures.jsx"));
  assert.match(page, /const lectures = await chargerHistoriqueRapprochement\(\);\s*setHistorique\(construireHistoriqueRapprochement\(lectures\)\);/);
  assert.match(page, /const \{ label, ton \} = statutHistorique\(it\);\s*return \{ label, sem: SEMANTIC\[ton\] \};/);
  assert.ok(!/label: "À rapprocher"/.test(page), "le statut « À rapprocher » n'est plus défini dans la page");
  const donnees = sansCommentaires(lire("src/Renovation/rapprochementDonnees.js"));
  assert.match(donnees, /from\("factures"\)\s*\.select\("id, fournisseur_id, fournisseur_nom, numero, date_facture, periode, montant_ht, statut, type_document, facture_origine_id, photo_url, fichiers, created_at"\)\s*\.order\("created_at", \{ ascending: false \}\)\.limit\(1000\)/);
  assert.match(donnees, /cq\.or\(`statut_facturation\.eq\.facture,fournisseur_id\.in\.\(\$\{ids30j\.join\(","\)\}\)`\)/);
  assert.match(donnees, /lireFacturesHistorique\(\),\s*cq\.order\("created_at", \{ ascending: false \}\)\.limit\(1000\),/);
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(donnees), "lecture seule");
});

test("13. bloc : mêmes lectures et fonctions que les pages ; modules purs ; registre", () => {
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocAdministratifFournisseurs.jsx"));
  assert.match(bloc, /import \{ lireFacturesHistorique \} from "\.\.\/rapprochementDonnees";/);
  assert.match(bloc, /import \{ chargerDonneesEncoursFournisseurs \} from "\.\.\/encoursFournisseursDonnees";/);
  assert.match(bloc, /cleMoisCourant\(new Date\(\)\)/, "même mois en cours que la page (horloge de l'appareil)");
  assert.match(bloc, /etatBlocAdministratifFournisseursV1\(/);
  assert.ok(!/supabase|encoursFournisseursV1\b/.test(bloc), "aucune lecture directe, pas le calcul du mail");
  const etat = sansCommentaires(lire("src/Renovation/administratifFournisseursV1.mjs"));
  assert.match(etat, /from "\.\/historiqueRapprochementV1\.mjs"/);
  assert.match(etat, /from "\.\/encoursFournisseursPageV1\.mjs"/);
  for (const f of ["encoursFournisseursPageV1", "historiqueRapprochementV1", "administratifFournisseursV1"]) {
    const src = sansCommentaires(lire(`src/Renovation/${f}.mjs`));
    assert.ok(!/supabase|Date\.now\(\)|new Date\(\)|localStorage|fetch\(/.test(src), `${f}.mjs : pur (ni base, ni horloge)`);
    assert.match(lire(`src/Renovation/${f}.js`), new RegExp(`export \\* from "\\./${f}\\.mjs";`), `${f} : façade .js`);
  }
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /administratif_fournisseurs:\s*\{[^\n]*Composant: BlocAdministratifFournisseurs \}/);
  assert.match(registre, /import BlocAdministratifFournisseurs from "\.\/BlocAdministratifFournisseurs";/);
  // Tâche 14 : le mail du vendredi / notification F2 utilisent désormais les
  // lectures et le calcul de la page (remplace le contrôle « le cron importe
  // encoursFournisseursV1.mjs », vrai jusqu'à la tâche 9).
  const cron = lire("api/cron-encours-fournisseurs.js");
  assert.match(cron, /import\("\.\.\/src\/Renovation\/encoursFournisseursLecture\.mjs"\)/);
  assert.match(cron, /import\("\.\.\/src\/Renovation\/encoursFournisseursMailV2\.mjs"\)/);
  assert.ok(!/encoursFournisseursV1/.test(sansCommentaires(cron)), "le cron n'appelle plus l'ancien calcul");
  assert.match(sansCommentaires(lire("src/Renovation/encoursFournisseursMailV2.mjs")), /from "\.\/encoursFournisseursPageV1\.mjs"/);
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Tableau de bord : le bloc « Administratif fournisseurs » affiche les factures à rapprocher et l'encours à payer"/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
