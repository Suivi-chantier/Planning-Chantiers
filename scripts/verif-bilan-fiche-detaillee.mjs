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
//     les totaux du relevé.
//
//   node scripts/verif-bilan-fiche-detaillee.mjs
import assert from "node:assert/strict";
import { cascadeMargeDevisReleve, materiauxParLot, METHODE_CALCUL } from "../src/chantierFinance.mjs";
import { ligneReleve } from "../src/Renovation/releveJournalier.mjs";
import * as F from "../src/Renovation/bilanFicheV3.mjs";
import { documentBilanV3 } from "../src/Renovation/bilanPdfV3.mjs";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
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
  ok(html.includes("Marge devis non comparable : aucun matériau prévu au phasage") && !html.includes(">Marge devis<"), "PDF : la fiche le dit, sans ligne « Marge devis »");
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

console.log(`verif-bilan-fiche-detaillee : ${nb} contrôles OK (données fictives)`);
