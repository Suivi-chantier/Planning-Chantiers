#!/usr/bin/env node
// Vérifie la fiche chantier de la version DÉTAILLÉE du Bilan (choix de Loris
// du 26/10/2026) — DONNÉES FICTIVES (exemple issu des tests : chantiers,
// lots, prix, heures et commandes inventés pour le calcul).
//
//   - « du devis au probable » : marge devis + postes = marge à terminaison,
//     marge à terminaison + dérives = marge probable, EXACTEMENT, sur des
//     relevés produits par le vrai calcul (ligneReleve) ;
//   - aucun matériau prévu : la marge devis est dite non comparable ;
//   - lots utiles seulement : lot non commencé masqué, ligne « À venir » ;
//     lot terminé sans coefficient ; « Sans lot » en heures seulement, même
//     chiffre que l'encadré ;
//   - matériaux par lot (enveloppe, commandé, imputé, en avance, reste,
//     dépassement), commandes sans lot, et refus d'un détail qui contredit
//     les totaux du relevé ;
//   - cascade conditionnelle (projet « Bilan détaillé », étape 6) : cascade
//     seulement si la marge probable baisse de plus du seuil ou si la pastille
//     est rouge ; sinon « Marge probable stable (−X €) / (+X €), écart signé » ou « en hausse » ;
//     évolution inconnue → cascade (jamais un « stable » inventé) ;
//   - méthode de calcul (étape 7) : absente par défaut, présente sur demande ;
//     version direction inchangée (même HTML qu'avant la tâche 3).
//
//   node scripts/verif-bilan-fiche-detaillee.mjs
import assert from "node:assert/strict";
import { cascadeMargeDevisReleve, materiauxParLot, METHODE_CALCUL } from "../src/chantierFinance.mjs";
import { ligneReleve } from "../src/Renovation/releveJournalier.mjs";
import * as F from "../src/Renovation/bilanFicheV3.mjs";
import { documentBilanV3 } from "../src/Renovation/bilanPdfV3.mjs";
import * as B from "../src/Renovation/bilanPeriodeV3.mjs";
import { createHash } from "node:crypto";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nb++; };
const proche = (a, b, msg, tol = 0.01) => { assert.ok(a != null && b != null && Math.abs(a - b) < tol, `${msg} : ${a} ≠ ${b}`); nb++; };

const LOTS = [{ id: "cloisons", label: "Cloisons" }, { id: "peinture", label: "Peinture" }, { id: "sol", label: "Sol" },
  { id: "elec", label: "Électricité" }, { id: "plomb", label: "Plomberie" }];
const FG = [{ depuis: "2026-01-01", taux: 10 }];
const ouvrage = (id, lot, { prix = 10000, heures = 100, av = 0, mat = 0, estimees = null } = {}) => ({
  id, libelle: `Ouvrage ${id}`, lot_id: lot, prix_ht: prix, heures_devis: heures, cout_materiaux: mat,
  taches: [{ id: `t-${id}`, nom: `Tâche ${id}`, avancement: av, heures_estimees: estimees ?? heures, heures_vendues: heures }],
});
const pointage = (tache, heures, { date = "2026-10-20", taux = 30, type = "tache" } = {}) =>
  ({ tache_id: tache, heures, taux_horaire: taux, date, type_pointage: type, ouvrier: "Ouvrier fictif" });
const commande = (montant, lot, { nature = "materiaux", date = "2026-10-15" } = {}) => ({ prix_total: montant, lot_id: lot, nature, created_at: `${date}T10:00:00Z` });
const releve = (ouvrages, { pointages = [], commandes = [] } = {}) => ligneReleve({
  inputs: { phasage: { chantier_id: "x", ouvrages, plan_travaux: { meta: {} } }, pointages, commandeLignes: commandes, lots: LOTS, tauxMOPrev: 20, tauxFG: FG },
  journal: [], dateISO: "2026-10-22", completude: { statut: "complete" },
});
const somme = l => l.reduce((s, p) => s + p.montant, 0);
const verifierCascade = (r, nom) => {
  const c = cascadeMargeDevisReleve(r, FG);
  ok(c.disponible && c.devisComparable, `${nom} : cascade disponible`);
  proche(c.devis + somme(c.versTerminaison), r.marge_terminaison, `${nom} : marge devis + postes = marge à terminaison`);
  proche(c.terminaison + somme(c.versProbable), r.marge_probable, `${nom} : marge à terminaison + dérives = marge probable`);
  return c;
};

// ── 1. Du devis au probable : la cascade tombe juste ────────────────────────
{
  // Lot avancé qui dérive (×2), heures libres sans lot, sous-traitance,
  // dépassement d'enveloppe, tâche réestimée, ouvrier payé plus que le taux prévisionnel.
  const ouvrages = [
    ouvrage("a", "cloisons", { av: 40, mat: 2000, heures: 100 }),
    ouvrage("b", "peinture", { av: 0, mat: 500, heures: 50, estimees: 70 }),
    ouvrage("c", "sol", { av: 0, mat: 800, heures: 30 }),
  ];
  const r = releve(ouvrages, {
    pointages: [pointage("t-a", 80, { taux: 32 }), { tache_id: null, heures: 6, taux_horaire: 25, date: "2026-10-21", type_pointage: "libre", ouvrier: "Ouvrier fictif" }],
    commandes: [commande(2600, "cloisons"), commande(900, "cloisons", { nature: "sous_traitance" }), commande(150, null)],
  });
  const c = verifierCascade(r, "chantier en dérive");
  const poste = cle => c.versTerminaison.find(p => p.cle === cle);
  ok(poste("heuresLots") && poste("heuresLots").heures > 0 && poste("heuresLots").montant < 0, "heures au-delà de l'avancement : perte");
  ok(poste("heuresHorsLots") && Math.abs(poste("heuresHorsLots").heures - 6) < 0.01, "6 h libres = heures hors des lots");
  ok(poste("resteReestime") && Math.abs(poste("resteReestime").heures - 20) < 0.01, "peinture réestimée de 50 h à 70 h : +20 h de reste à faire");
  proche(poste("autresCouts").montant, -900, "sous-traitance comptée à part");
  ok(poste("coutHoraireMO").montant < 0, "ouvrier à 32 €/h face à 20 €/h prévus : perte");
  ok(!c.versTerminaison.some(p => p.cle === "autres"), "aucun « autres écarts » quand tout est expliqué");
  ok(c.versProbable.length >= 1 && /Dérive Cloisons/.test(c.versProbable[0].libelle), "la dérive des cloisons est nommée");
}
{
  // Plus de 3 lots qui dérivent : les 3 plus lourds nommés, le reste regroupé, somme exacte.
  const ids = ["cloisons", "peinture", "sol", "elec", "plomb"];
  const ouvrages = ids.map((l, i) => ouvrage(`o${i}`, l, { av: 30, heures: 40 + 10 * i, mat: 300 }));
  const r = releve(ouvrages, { pointages: ouvrages.map((o, i) => pointage(o.taches[0].id, (40 + 10 * i) * 0.3 * (1.4 + 0.3 * i))) });
  const c = verifierCascade(r, "cinq lots en dérive");
  ok(c.versProbable.length === 4 && c.versProbable[3].libelle === "Dérive des autres lots", "3 lots nommés + « Dérive des autres lots »");
  ok(c.versProbable[0].montant <= c.versProbable[1].montant && c.versProbable[1].montant <= c.versProbable[2].montant, "lots triés du plus lourd au plus léger");
}
{
  // Chantier qui fait mieux que prévu : postes positifs, cascade juste.
  const r = releve([ouvrage("a", "cloisons", { av: 60, mat: 1000, heures: 100 })], { pointages: [pointage("t-a", 40, { taux: 18 })], commandes: [commande(900, "cloisons")] });
  const c = verifierCascade(r, "chantier en avance");
  ok(c.versTerminaison.find(p => p.cle === "heuresLots").montant > 0, "heures en deçà de l'avancement : gain");
}
{
  // Aucun matériau prévu : marge devis non comparable, pas de fausse cascade.
  const r = releve([ouvrage("a", "cloisons", { av: 50, mat: 0 })], { pointages: [pointage("t-a", 60)], commandes: [commande(3000, "cloisons")] });
  const c = cascadeMargeDevisReleve(r, FG);
  ok(c.disponible && c.devisComparable === false && /aucun matériau prévu/.test(c.raisonDevis), "sans matériaux prévus : marge devis non comparable");
  ok(c.versTerminaison === undefined, "aucun poste devis → terminaison affiché");
  proche(c.terminaison + somme(c.versProbable), r.marge_probable, "la seconde moitié reste juste");
  const html = documentBilanV3({ periode: { libelle: "S" }, bornes: {}, bandeau: {}, synthese: [], alertes: [],
    fiches: [{ nom: "Fictif", marges: { cascade: c, constat: {}, periode: {} }, lots: [], tachesParLot: [] }] }, { detaillee: true });
  ok(html.includes("Marge devis non comparable : aucun matériau prévu au phasage") && !html.includes("<td>Marge devis</td>"), "PDF : la fiche le dit, sans ligne « Marge devis »");
}
{
  ok(cascadeMargeDevisReleve(null).disponible === false, "relevé absent : indisponible, jamais 0");
  ok(cascadeMargeDevisReleve({ marge_terminaison: null, marge_probable: null }).disponible === false, "avancement inconnu : indisponible");
  ok(METHODE_CALCUL.some(m => m.cle === "cascadeDevisProbable") && F.methodeBilanV3().some(m => /Du devis au probable/.test(m.titre)), "formule dans la méthode de calcul et l'annexe du PDF");
}

// ── 2. Lots utiles seulement ────────────────────────────────────────────────
{
  const releveFin = { heures_sans_lot: 40.4, pct_sans_lot: 18.4,
    lots: [
      { id: "cloisons", label: "Cloisons", heuresReelles: 50, heuresVendues: 60, avancementExact: 55, coefficient: 1.5, provenanceCoefficient: "constatee", ecartProbableEuros: 300 },
      { id: "sol", label: "Sol", heuresReelles: 0, heuresVendues: 25, avancementExact: 0, heuresRestantesPrevues: 25, coefficient: 1, provenanceCoefficient: "aucune", ecartProbableEuros: 0 },
      { id: "peinture", label: "Peinture", heuresReelles: 0, heuresVendues: 46, avancementExact: 0, heuresRestantesPrevues: 46, coefficient: 1.59, provenanceCoefficient: "historique", ecartProbableEuros: 900 },
      { id: "elec", label: "Électricité", heuresReelles: 30, heuresVendues: 20, avancementExact: 100, coefficient: 1.5, provenanceCoefficient: "constatee", ecartProbableEuros: 0 },
      { id: "_orphans", label: "Sans lot", heuresReelles: 38.9, heuresVendues: 0, avancementExact: 96.8, coefficient: 1, provenanceCoefficient: "aucune" },
    ] };
  const { lots, aVenir, sansLotAlerte } = F.lotsFicheV3(releveFin);
  ok(!lots.some(l => l.id === "sol") && aVenir === "À venir : Sol 25 h", "lot non commencé sans effet : masqué, dans « À venir »");
  ok(lots.some(l => l.id === "peinture"), "lot non commencé qui pèse sur la marge probable : affiché");
  ok(lots.find(l => l.id === "elec").provenance === "terminé", "lot terminé : « terminé » au lieu du coefficient");
  const sl = lots.find(l => l.sansLot);
  ok(sl.heuresReelles === 40.4 && /\(40,4 h\)/.test(sansLotAlerte), "« Sans lot » : même chiffre dans le tableau et l'encadré (40,4 h)");
  ok(sl.avancementExact === undefined && sl.provenance === undefined && sl.heuresVendues === null, "« Sans lot » : ni avancement, ni coefficient, ni heures prévues");
  const html = documentBilanV3({ periode: { libelle: "S" }, bornes: {}, bandeau: {}, synthese: [], alertes: [],
    fiches: [{ nom: "Fictif", lots, aVenir, sansLotAlerte, tachesParLot: [] }] }, { detaillee: true });
  ok(html.includes("À venir : Sol 25 h") && html.includes("heures seulement") && !html.includes("96,8"), "PDF : « À venir », sans lot en heures, sans avancement");
}

// ── 3. Matériaux par lot ────────────────────────────────────────────────────
{
  const ouvrages = [ouvrage("a", "cloisons", { av: 25, mat: 2000 }), ouvrage("b", "peinture", { av: 50, mat: 1000 })];
  const commandes = [commande(1500, "cloisons"), commande(1300, "peinture"), commande(200, null), commande(400, "sol"), commande(500, "cloisons", { nature: "location" })];
  const d = materiauxParLot({ ouvrages, commandeLignes: commandes, lots: LOTS });
  const l = id => d.lots.find(x => x.lotId === id);
  ok(l("cloisons").enveloppe === 2000 && l("cloisons").commandes === 1500 && l("cloisons").enAvance === 1000 && l("cloisons").impute === 500 && l("cloisons").reste === 500 && l("cloisons").depassement === null,
    "cloisons : enveloppe 2 000, commandé 1 500, imputé 500, en avance 1 000, reste 500");
  ok(Math.abs(l("peinture").depassement - 300) < 0.01 && l("peinture").reste === 0, "peinture : dépassement de 300 €");
  ok(l("sol").enveloppe === 0 && l("sol").depassement === 400, "commande sur un lot sans ouvrage : dépassement entier");
  ok(d.commandesSansLot === 200, "commandes sans lot à part");
  ok(!d.lots.some(x => x.commandes === 500), "location hors enveloppe matériaux");
  // Mêmes données que le relevé : détail montré ; totaux contredits : détail refusé.
  const r = releve(ouvrages, { commandes });
  const fiche = F.materiauxFicheV3(r, d);
  ok(Array.isArray(fiche.lots) && fiche.raisonLots === null && fiche.sansLot.commandes === 200, "détail cohérent avec le relevé : affiché");
  const faux = F.materiauxFicheV3({ ...r, reste_a_commander: (r.reste_a_commander || 0) + 50 }, d);
  ok(faux.lots === null && /ont changé depuis le calcul du relevé/.test(faux.raisonLots), "détail qui contredit le relevé : remplacé par la raison");
  ok(F.materiauxFicheV3(r).lots === null && /non chargé/.test(F.materiauxFicheV3(r).raisonLots), "détail non chargé : dit");
  const html = documentBilanV3({ periode: { libelle: "S" }, bornes: {}, bandeau: {}, synthese: [], alertes: [],
    fiches: [{ nom: "Fictif", lots: [], tachesParLot: [], materiaux: fiche }] }, { detaillee: true });
  ok(html.includes("Enveloppe") && html.includes("Commandes sans lot") && html.includes("+300"), "PDF : tableau des matériaux par lot avec dépassement");
  ok(!/— Matériaux/.test(html), "plus de répétition « — Matériaux X € »");
}
{
  // Le détail suit l'état des tâches À LA DATE du relevé et les commandes imputées ce jour-là au plus tard.
  const ouvrages = [ouvrage("a", "cloisons", { av: 100, mat: 2000 })];
  const journal = [{ tache_id: "t-a", avancement_avant: 0, avancement_apres: 50, date_realisation: "2026-10-20", created_at: "2026-10-20T18:00:00Z" },
    { tache_id: "t-a", avancement_avant: 50, avancement_apres: 100, date_realisation: "2026-10-23", created_at: "2026-10-23T18:00:00Z" }];
  const d = F.materiauxParLotALaDateV3({ ouvrages, journalComplet: journal, commandeLignes: [commande(1500, "cloisons"), commande(300, "cloisons", { date: "2026-10-24" })], lots: LOTS, dateFin: "2026-10-22" });
  const c = d.lots.find(x => x.lotId === "cloisons");
  ok(c.commandes === 1500 && Math.abs(c.enAvance - 500) < 0.01, "au 22/10 : tâche à 50 %, commande du 24/10 exclue → 500 € en avance");
  ok(F.materiauxParLotALaDateV3({ ouvrages, journalComplet: undefined, commandeLignes: [], dateFin: "2026-10-22" }) === undefined, "journal non chargé : pas de détail");
}

// ── 4. Cascade seulement pour les chantiers qui décrochent ; méthode en option ──
// Exemple issu des tests, données fictives : cinq chantiers inventés (BAISSE,
// NEGATIVE, STABLE, HAUSSE, INCONNU), seuil d'alerte 500 €.
{
  const N = " ";
  const A = F.affichageCascadeV3;
  // Règle, fonction pure (seuil en paramètre).
  ok(A({ evolutionMargeProbable: -800, couleurPastille: "vert", seuilBaisse: 500 }).afficherCascade, "baisse de 800 € > seuil 500 € : cascade");
  ok(A({ evolutionMargeProbable: 0, couleurPastille: "rouge", seuilBaisse: 500 }).afficherCascade, "pastille rouge sans baisse : cascade");
  const stable = A({ evolutionMargeProbable: -200, couleurPastille: "vert", seuilBaisse: 500 });
  ok(!stable.afficherCascade && stable.texte === `Marge probable stable (−200${N}€)`, "baisse de 200 € ≤ seuil : « Marge probable stable (−200 €) », écart signé");
  ok(A({ evolutionMargeProbable: -500, couleurPastille: "orange", seuilBaisse: 500 }).texte === `Marge probable stable (−500${N}€)`, "baisse égale au seuil : stable (même règle que la pastille)");
  ok(A({ evolutionMargeProbable: 350.4, couleurPastille: "vert", seuilBaisse: 500 }).texte === `Marge probable stable (+350${N}€)`, "petite hausse : stable (+350 €), arrondie à l'euro");
  ok(A({ evolutionMargeProbable: -216.6, couleurPastille: "vert", seuilBaisse: 500 }).texte === `Marge probable stable (−217${N}€)`, "petite baisse : « stable (−217 €) », signe moins typographique");
  ok(A({ evolutionMargeProbable: 0, couleurPastille: "vert", seuilBaisse: 500 }).texte === `Marge probable stable (0${N}€)`, "aucun écart : « stable (0 €) », sans signe");
  ok(A({ evolutionMargeProbable: 0.4, couleurPastille: "vert", seuilBaisse: 500 }).texte === `Marge probable stable (0${N}€)`, "écart de moins de 0,5 € : « 0 € », comme les euros signés du PDF");
  const hausse = A({ evolutionMargeProbable: 1800, couleurPastille: "vert", seuilBaisse: 500 });
  ok(!hausse.afficherCascade && hausse.texte === `Marge probable en hausse (+1${N}800${N}€)`, "hausse de plus du seuil : « en hausse », jamais « stable »");
  const inconnue = A({ evolutionMargeProbable: null, couleurPastille: "vert", seuilBaisse: 500 });
  ok(inconnue.afficherCascade && inconnue.texte === null, "évolution inconnue : cascade, aucun « stable » inventé");
  ok(A({ evolutionMargeProbable: -800, couleurPastille: "vert", seuilBaisse: 1000 }).texte === `Marge probable stable (−800${N}€)`, "le seuil vient du paramètre (1 000 €)");

  // De bout en bout : synthèse du Bilan → fiches → PDF détaillé.
  const P44 = B.periodeSemaineV3("2026-W44");
  const BOR = B.bornesComparaisonV3(P44, ["2026-10-22", "2026-10-29"]);
  const rel = (id, date, mp, o = {}) => ({ chantier_id: id, chantier_nom: id.toUpperCase(), date_releve: date, avancement: 50,
    vendu_ht: 10000, heures_vendues: 100, heures_reelles: 40, production_cumulee: 5000, marge_avancement: 1000,
    marge_terminaison: 2000, marge_probable: mp, budget_restant: 6000, mat_prev: 1000, mo_prev: 3000, chantier_repris: false, ...o });
  const releves = B.indexerRelevesV3([
    rel("baisse", "2026-10-22", 1500), rel("baisse", "2026-10-29", 700),       // −800 € : pastille rouge
    rel("negative", "2026-10-22", -1000), rel("negative", "2026-10-29", -1000), // aucune baisse, mais négative : rouge
    rel("stable", "2026-10-22", 1500), rel("stable", "2026-10-29", 1300),       // −200 €
    rel("hausse", "2026-10-22", 1500), rel("hausse", "2026-10-29", 2300),       // +800 €
    rel("inconnu", "2026-10-29", 1500),                                         // pas de relevé de départ
  ]);
  const chantiers = ["baisse", "negative", "stable", "hausse", "inconnu"].map(id => ({ id, nom: id.toUpperCase() }));
  const syn = B.syntheseChantiersV3({ releves, chantiers, bornes: BOR, periode: P44, seuilBaisse: 500 });
  eq(syn.map(s => [s.evolutionMargeProbable, s.pastille.couleur]), [[-800, "rouge"], [0, "rouge"], [-200, "vert"], [800, "vert"], [null, "vert"]],
    "jeu fictif : évolutions et pastilles attendues");
  // Relevé de fin produit par le vrai calcul, pour que la cascade soit un vrai tableau.
  const releveFin = releve([ouvrage("a", "cloisons", { av: 40, mat: 2000 })], { pointages: [pointage("t-a", 60)], commandes: [commande(1500, "cloisons")] });
  const fiches = syn.map(s => F.ficheChantierV3({ synthese: s, releveFin, ouvrages: [], journal: [], pointages: [], periode: P44, bornes: BOR, seuilBaisse: 500 }));
  const d = { periode: P44, bornes: BOR, bandeau: B.bandeauV3({ synthese: syn }), synthese: syn, alertes: [], fiches };
  const det = documentBilanV3(d, { detaillee: true });
  const fiche = nom => { const i = det.indexOf(`<h2>${nom}</h2>`); const j = det.indexOf(`<div class="fiche">`, i); return det.slice(i, j < 0 ? undefined : j); };
  const cascade = html => html.includes("<th>Du devis au probable</th>");
  ok(cascade(fiche("BAISSE")), "PDF (données fictives) : cascade pour la marge probable en baisse de 800 €");
  ok(cascade(fiche("NEGATIVE")), "PDF (données fictives) : cascade pour la pastille rouge sans baisse");
  ok(!cascade(fiche("STABLE")) && fiche("STABLE").includes(`Marge probable stable (−200${N}€)`), "PDF (données fictives) : « Marge probable stable (−200 €) » sans cascade");
  ok(!cascade(fiche("HAUSSE")) && fiche("HAUSSE").includes(`Marge probable en hausse (+800${N}€)`) && !fiche("HAUSSE").includes("stable"), "PDF (données fictives) : « en hausse (+800 €) » sans cascade");
  ok(cascade(fiche("INCONNU")) && !fiche("INCONNU").includes("Marge probable stable"), "PDF (données fictives) : évolution inconnue → cascade");
  ok(["BAISSE", "STABLE", "HAUSSE"].every(nom => fiche(nom).includes("Constat à date")), "PDF (données fictives) : le constat à date reste sur toutes les fiches");

  // Méthode de calcul : absente par défaut, présente quand elle est jointe.
  ok(!det.includes("Méthode de calcul"), "PDF détaillé (données fictives) : pas de méthode de calcul par défaut");
  const avecMethode = documentBilanV3({ ...d, methode: F.methodeBilanV3() }, { detaillee: true });
  ok(avecMethode.includes("<h2>Méthode de calcul</h2>") && avecMethode.includes("Du devis au probable") && avecMethode.startsWith(det.slice(0, det.indexOf(`<div class="pied">`)).trimEnd()),
    "PDF détaillé (données fictives) : méthode jointe en annexe, le reste identique");

  // Version direction : empreinte de son HTML sur ce jeu fictif. Relevée avant
  // la tâche 3 (HTML inchangé par les tâches 3 à 5), puis mise à jour le
  // 06/11/2026 pour un changement VOULU de la version direction (demande de
  // Loris) : colonne « Marge à terminaison » et total « à terminaison » dans
  // le bandeau. Toute autre modification de la version direction doit faire
  // échouer ce contrôle.
  const dir = documentBilanV3(d, { detaillee: false });
  ok(dir === documentBilanV3({ ...d, fiches: undefined }, { detaillee: false }) && dir === documentBilanV3({ ...d, methode: F.methodeBilanV3() }, { detaillee: false }),
    "PDF direction (données fictives) : ni fiches ni méthode");
  // Empreinte mise à jour le 06/11/2026 pour un 2e changement VOULU : l'habillage
  // des PDF du Bilan au design des documents Profero (héros, chiffres clés,
  // titres, tableaux, pied « Document interne »). Les chiffres et les textes
  // n'ont pas bougé (vérifié sur la semaine 2026-W44 réelle, avant / après).
  // 09/11/2026 : 3e changement VOULU (décision de François) — une semaine
  // s'arrête au vendredi ; seul le sous-titre « Comparaison du … au … » change
  // (ven. 23/10 → ven. 30/10, « fin de la semaine »), aucun chiffre.
  // 09/11/2026 : 4e changement VOULU (demande de François) — la marge à
  // terminaison de tous les chantiers a sa propre case dans le bandeau, juste
  // avant la marge probable (elle quitte la ligne grise de la marge probable).
  ok(dir.includes("Marge à terminaison, tous chantiers") && !dir.includes("à terminaison +"), "PDF direction (données fictives) : case « Marge à terminaison, tous chantiers »");
  eq(createHash("sha256").update(dir).digest("hex"), "17ff48af990b50d1223add02675fc9ea883c11b88447205651ee0b45a47cccb4",
    "PDF direction (données fictives) : HTML identique à celui attendu (design Profero du 06/11/2026)");

  // ── Design des documents Profero (06/11/2026) ──
  for (const [nom, html, surtitre] of [["direction", dir, "Bilan"], ["détaillé", det, "Bilan détaillé"]]) {
    const hero = html.slice(html.indexOf(`<div class="hero">`), html.indexOf(`<div class="bandeau">`));
    ok(html.indexOf(`<div class="hero">`) >= 0 && html.indexOf(`<div class="hero">`) < html.indexOf(`<div class="bandeau">`), `PDF ${nom} (données fictives) : héros en tête, avant les chiffres clés`);
    ok(hero.includes(`<div class="eb">${surtitre}</div>`) && hero.includes("<h1>Semaine 44</h1>"), `PDF ${nom} (données fictives) : surtitre « ${surtitre} » et période en titre`);
    ok(hero.includes(`<span class="pill">26/10 → 01/11/2026</span>`) && hero.includes(`<span class="pill">5 chantiers</span>`) && hero.includes("Comparaison du ven. 23/10 (fin de la semaine précédente) au ven. 30/10 (fin de la semaine)"),
      `PDF ${nom} (données fictives) : pastilles (dates, chantiers) et dates de comparaison`);
    ok(hero.includes(`<div class="hero-kpi">`) && hero.includes("Généré cette semaine"), `PDF ${nom} (données fictives) : bloc jaune « généré » dans le héros`);
    ok(!hero.includes("<img"), `PDF ${nom} (données fictives) : pas de logo sans URL (jamais d'image cassée)`);
    ok(/<div class="pied"><b>Profero — Rénovation &amp; réhabilitation<\/b><span>Document interne<\/span><\/div>\s*<\/div>$/.test(html), `PDF ${nom} (données fictives) : pied « Document interne » en fin de document`);
    ok(!/undefined|NaN|null/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), `PDF ${nom} (données fictives) : ni « undefined », ni « NaN », ni « null »`);
  }
  const avecLogo = documentBilanV3({ ...d, logoUrl: "https://x.test/logos/profero-reno-h.png?a=1&b=\"2" }, { detaillee: false });
  ok(avecLogo.includes(`<img class="logo" src="https://x.test/logos/profero-reno-h.png?a=1&amp;b=&quot;2" alt="Profero" crossorigin="anonymous">`), "PDF (données fictives) : logo dans le héros, URL échappée");
  const mois = documentBilanV3({ ...d, periode: B.periodeMoisV3("2026-10") }, { detaillee: true });
  ok(mois.includes("<h1>Octobre 2026</h1>") && mois.includes(`<span class="pill">01/10 → 31/10/2026</span>`) && mois.includes("Généré sur la période"), "PDF (données fictives) : héros d'un mois");
  // Couleurs du STYLE : uniquement la charte (charteDocProfero.mjs, skill
  // « profero-pdf ») et, porteuses d'information, l'ambre des pastilles
  // « mention » et le rouge des avertissements. Les pastilles d'état des
  // chantiers (rouge / orange / vert / gris) et les couleurs des montants
  // (positif vert, négatif rouge) sont écrites dans le HTML, pas dans le STYLE.
  const CHARTE = ["#1a1f2e", "#ffc200", "#5a6478", "#e4e8f2", "#eef1f7", "#f4f6fa", "#fff", "#ffffff", "#fff8dc", "#fafbfd",
    "#aeb6c8", "#e8ebf2", "#6b5200", "#9aa2b4", // héros, bloc jaune et pied de la charte
    "#161b28", "#232c42", "#2e2840", "#69582d", "#292a41", "#2c3e66", "#1c2334"]; // dégradé et halos du héros (charteDocProfero.mjs)
  const INFORMATION = ["#fef3c7", "#92400e", "#fde68a", "#fee2e2", "#991b1b"]; // mention (ambre), avertissement (rouge)
  for (const html of [dir, det]) {
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const hors = [...new Set((style.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map(c => c.toLowerCase()))].filter(c => !CHARTE.includes(c) && !INFORMATION.includes(c));
    eq(hors, [], "PDF (données fictives) : aucune couleur hors charte dans le STYLE du Bilan");
    const rgba = [...new Set(style.match(/rgba\([^)]*\)/g) || [])].filter(c => !/^rgba\((255,255,255|26,31,46|255,194,0),/.test(c.replace(/\s/g, "")));
    eq(rgba, [], "PDF (données fictives) : transparences uniquement en blanc, encre ou jaune de la charte");
    ok(!/box-shadow/.test(style), "PDF (données fictives) : aucune ombre portée");
    ok(!/rgba\([^)]*,\s*0\)|transparent/.test(style), "PDF (données fictives) : aucun dégradé vers le transparent");
  }
}

console.log(`verif-bilan-fiche-detaillee : ${nb} contrôles OK (données fictives)`);
