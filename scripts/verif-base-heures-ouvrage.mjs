#!/usr/bin/env node
// Vérification : UNE base d'heures, l'ouvrage (décisions de Loris du
// 29/10/2026) — chantierFinance (heures prévues des tâches, avancement des
// ouvrages et des lots, reprises), répartition en % toujours à 100 %
// (repartitionPourcentagesV1) et heures prévues saisies à la main jamais
// écrasées par la bibliothèque (reportRatiosBibliotheque).
// Exemples issus des tests, données fictives.
import assert from "node:assert/strict";
import {
  baseHeuresOuvrage, heuresPrevuesTache, heuresRestantesOuvrage, avancementOuvrage, avancementOuvrageExact,
  avancementLot, avancementLotExact, avancementChantier, productionCumulee, heuresReellesComparablesOuvrage,
  tacheReprise, indexPointagesParTache,
} from "../src/chantierFinance.mjs";
import {
  etatRepartition, verifierRepartition, ajusterDerniere, repartirEcart, appliquerRepartition,
  retirerTacheRepartition, lignesRepartition, ouvragesHorsCent,
} from "../src/Renovation/repartitionPourcentagesV1.mjs";
import { reporterSurOuvrage, mentionHeuresPrevues } from "../src/Renovation/reportRatiosBibliotheque.mjs";

let nb = 0;
const ok = (c, m) => { assert.ok(c, m); nb += 1; };
const proche = (a, b, m, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${m} (obtenu ${a}, attendu ${b})`);

// ── 1. Ratios à 106 % ramenés à 100 % (cas réel de l'installation électrique,
//       chiffres fictifs) : l'ouvrage de 49 h ne devient pas 55,9 h. ─────────
const elec = () => ({
  id: "e1", lot_id: "elec", prix_ht: 8000, heures_devis: 49,
  taches: [
    { id: "a", nom: "Dépose", ratio: 10, heures_estimees: 5.16, avancement: 100 },
    { id: "b", nom: "Passage câbles", ratio: 40, heures_estimees: 20.63, avancement: 100 },
    { id: "c", nom: "Tableau", ratio: 20, heures_estimees: 10.31, avancement: 0 },
    { id: "d", nom: "Radiateurs", ratio: 8, heures_estimees: 3.92, avancement: 0 },
    { id: "e", nom: "Appareillage", ratio: 28, heures_estimees: 14.0, avancement: 100 },
  ],
});
{
  const o = elec();
  const base = baseHeuresOuvrage(o);
  ok(base.active && base.heures === 49 && base.sommeRatios === 106, "base active : 49 h, Σ ratios 106");
  const total = o.taches.reduce((s, t) => s + heuresPrevuesTache(t, o, base), 0);
  proche(total, 49, "les tâches se partagent exactement les 49 h de l'ouvrage");
  proche(heuresPrevuesTache(o.taches[1], o, base), 49 * 40 / 106, "tâche à 40 % : 49 × 40 ÷ 106");
  // Avancement : (10 + 40 + 28) / 106 des heures faites.
  proche(avancementOuvrageExact(o), 100 * 78 / 106, "avancement exact = part des % faits, ramenée à 100");
  proche(heuresRestantesOuvrage(o), 49 * 28 / 106, "restant prévu = part non faite des 49 h");
}

// ── 2. Heures des tâches différentes de l'ouvrage (peinture : tâches à 56,9 h
//       pour un ouvrage de 38,6 h, ratios à 77,5 %) : la base reste 38,6 h. ──
{
  const o = { id: "p", lot_id: "murs", prix_ht: 4500, heures_devis: 38.6, taches: [
    { id: "p1", ratio: 30, heures_estimees: 25, avancement: 100 },
    { id: "p2", ratio: 47.5, heures_estimees: 31.9, avancement: 0 },
  ] };
  proche(heuresRestantesOuvrage(o), 38.6 * 47.5 / 77.5, "restant = 38,6 h × part non faite (et non 31,9 h)");
  proche(avancementOuvrageExact(o), 100 * 30 / 77.5, "avancement sur les % ramenés à 100");
}

// ── 3. Ancien ouvrage sans % : calcul d'avant inchangé (heures estimées). ──
{
  const o = { id: "v", heures_devis: 10, taches: [
    { id: "v1", heures_estimees: 6, avancement: 100 }, { id: "v2", heures_estimees: 2, avancement: 0 },
  ] };
  ok(!baseHeuresOuvrage(o).active, "sans aucun % : base inactive");
  proche(avancementOuvrageExact(o), 75, "pondération par heures estimées conservée");
  ok(!etatRepartition(o).applicable, "rien à signaler pour un ouvrage sans %");
}

// ── 4. Avancement d'un LOT pondéré par les heures prévues (plus par le prix).
{
  const lots = [{ id: "L", label: "Lot" }];
  const ouvs = [
    { id: "o1", lot_id: "L", prix_ht: 9000, heures_devis: 10, taches: [{ id: "x", ratio: 100, avancement: 100 }] },
    { id: "o2", lot_id: "L", prix_ht: 1000, heures_devis: 30, taches: [{ id: "y", ratio: 100, avancement: 0 }] },
  ];
  proche(avancementLotExact(ouvs, lots, "L"), 25, "lot : 10 h faites sur 40 h prévues = 25 % (au prix : 90 %)");
  ok(avancementLot(ouvs, lots, "L") === 25, "avancement de lot arrondi : même pondération");
  ok(avancementChantier(ouvs) === 90, "chantier : toujours la part du vendu réalisée (prix)");
  // Repli prix quand aucun ouvrage du lot n'a d'heures prévues.
  const sansH = ouvs.map(o => ({ ...o, heures_devis: null, taches: o.taches.map(t => ({ ...t, ratio: null })) }));
  proche(avancementLotExact(sansH, lots, "L"), 90, "sans heures prévues : repli sur le prix");
}

// ── 5. Tâche de REPRISE : hors de l'avancement, heures réelles comptées. ──
{
  const o = elec();
  o.taches.push({ id: "r", nom: "Réparation mauvais trou", nature: "reprise", heures_estimees: 1.5, avancement: 100 });
  ok(tacheReprise(o.taches[5]), "nature « reprise » reconnue");
  proche(avancementOuvrageExact(o), 100 * 78 / 106, "la reprise ne fait pas avancer l'ouvrage");
  const ppt = indexPointagesParTache([{ tache_id: "r", heures: 1.5, taux_horaire: 20 }, { tache_id: "a", heures: 6, taux_horaire: 20 }]);
  proche(heuresReellesComparablesOuvrage(o, ppt), 7.5, "ses heures réelles restent comparées (dérive)");
  ok(!lignesRepartition(o).some(l => l.id === "r"), "hors de la répartition en %");
  // Une reprise devinée d'après le nom seul : NON (nature explicite seulement).
  ok(!tacheReprise({ nom: "Reprise d'enduit" }), "aucune reprise devinée d'après le nom");
}

// ── 6. Tâche « ajoutée en cours de chantier » (cas B) : poids = heures
//       normales, en plus de la base de l'ouvrage. ────────────────────────
{
  const o = { id: "b", heures_devis: 10, prix_ht: 1000, taches: [
    { id: "t1", ratio: 100, avancement: 0 },
    { id: "tb", ajoutee_en_cours: true, motif_hd: "imprevu", heures_estimees: 2, avancement: 100 },
  ] };
  proche(heuresPrevuesTache(o.taches[1], o), 2, "cas B : ses heures normales");
  proche(avancementOuvrageExact(o), 100 * 2 / 12, "poids 2 h sur 12 h (10 h de base + 2 h)");
  ok(etatRepartition(o).ok, "le cas B est hors du total des %");
}

// ── 7. Production inchangée quand les heures estimées suivaient déjà les %. ──
{
  const o = { id: "q", heures_devis: 20, prix_ht: 2000, taches: [
    { id: "q1", ratio: 25, heures_estimees: 5, avancement: 100 },
    { id: "q2", ratio: 75, heures_estimees: 15, avancement: 40 },
  ] };
  proche(productionCumulee([o]), 2000 * (25 + 0.4 * 75) / 100, "production = prix × avancement, inchangée");
}

// ── 8. Répartition en % : enregistrement refusé si ≠ 100 %, corrections. ──
{
  const o = elec();
  const e = etatRepartition(o);
  ok(e.applicable && !e.ok && e.total === 106, "106 % signalé");
  const refus = appliquerRepartition(o, lignesRepartition(o));
  ok(!refus.ok && /100 %/.test(refus.raison), "enregistrement refusé tant que le total n'est pas 100 %");
  const ajustee = ajusterDerniere(lignesRepartition(o));
  ok(verifierRepartition(ajustee).ok && ajustee[4].ratio === 22, "ajuster la dernière tâche : 28 → 22 %");
  const repartie = repartirEcart(lignesRepartition(o));
  ok(verifierRepartition(repartie).ok, "répartir l'écart : total exactement 100");
  proche(repartie.reduce((s, l) => s + l.ratio, 0), 100, "somme au centième près", 1e-9);
  const r = appliquerRepartition(o, ajustee);
  ok(r.ok, "répartition à 100 % enregistrée");
  proche(r.ouvrage.taches.reduce((s, t) => s + t.heures_vendues, 0), 49, "heures prévues des tâches = 49 h exactement");
  ok(r.ouvrage.taches[1].heures_estimees === r.ouvrage.taches[1].heures_vendues, "heures estimées alignées (planning)");
  ok(ouvragesHorsCent([o, r.ouvrage]).length === 1, "seul l'ouvrage à 106 % est listé");
  // Dernière tâche qui passerait sous 0 : on répartit l'écart à la place.
  const neg = ajusterDerniere([{ id: 1, ratio: 90 }, { id: 2, ratio: 20 }, { id: 3, ratio: 5 }]);
  ok(verifierRepartition(neg).ok && neg.every(l => l.ratio > 0), "pas de % négatif : écart réparti");
}

// ── 9. Supprimer une tâche de la répartition rééquilibre à 100 %. ────────
{
  const o = appliquerRepartition(elec(), ajusterDerniere(lignesRepartition(elec()))).ouvrage;
  const sans = retirerTacheRepartition(o, "c");
  ok(!sans.taches.some(t => t.id === "c"), "tâche supprimée");
  ok(etatRepartition(sans).ok, "les autres % retombent à 100");
  proche(sans.taches.reduce((s, t) => s + t.heures_vendues, 0), 49, "les 49 h restent réparties");
}

// ── 10. Heures prévues saisies à la main : jamais écrasées par le report. ──
{
  const biblio = { id: "bib", cadence: 2, sous_taches: [{ id: "s1", nom: "A", ratio: 40 }, { id: "s2", nom: "B", ratio: 60 }] };
  const o = { id: "m", bibliotheque_id: "bib", quantite: 10, heures_devis: 30, heures_devis_origine: 25, heures_prevues_source: "manuel",
    taches: [{ id: "x", source_sous_tache_id: "s1", nom: "A", ratio: 50, heures_vendues: 15 }, { id: "y", source_sous_tache_id: "s2", nom: "B", ratio: 50, heures_vendues: 15 }] };
  const r = reporterSurOuvrage(o, biblio);
  ok(r.ouvrage.heures_devis === 30 && r.ouvrage.heures_prevues_source === "manuel", "30 h saisies à la main conservées (cadence × quantité = 20 h ignorée)");
  ok(r.ouvrage.taches[0].ratio === 40 && r.ouvrage.taches[1].ratio === 60, "les % de la bibliothèque sont repris");
  ok(r.ouvrage.taches[0].heures_vendues === 12 && r.ouvrage.taches[1].heures_vendues === 18, "les 30 h saisies sont réparties selon ces %");
  ok(mentionHeuresPrevues(r.ouvrage) === "saisi à la main · devis : 25 h", "provenance affichée : saisie à la main");
  const sansManuel = reporterSurOuvrage({ ...o, heures_prevues_source: "bibliotheque" }, biblio);
  ok(sansManuel.ouvrage.heures_devis === 20, "source bibliothèque : cadence × quantité reportée");
  ok(mentionHeuresPrevues(sansManuel.ouvrage) === "cadence bibliothèque · devis : 25 h", "provenance affichée : bibliothèque");
}

console.log(`verif-base-heures-ouvrage : ${nb} contrôles OK (données fictives)`);
