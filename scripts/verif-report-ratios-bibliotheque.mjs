#!/usr/bin/env node
// Vérification du report des ratios de la bibliothèque sur les chantiers
// (src/Renovation/reportRatiosBibliotheque.mjs). Données fictives.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  reporterSurOuvrage, reporterSurPhasage, nomComparable,
  ajouterCorrectionRatios, correctionRatiosPeriode, MAX_CORRECTIONS,
} from "../src/Renovation/reportRatiosBibliotheque.mjs";
import { avancementChantier } from "../src/chantierFinance.mjs";

const fige = (x) => JSON.parse(JSON.stringify(x));

// ── Ouvrage de bibliothèque fictif (V2 : étapes identifiées) ────────────────
const biblio = {
  id: "bib-1",
  libelle: "Cloison fictive",
  cadence: 2,
  sous_taches: [
    { id: "st-oss", nom: "Ossature", ratio: 20 },
    { id: "st-pla", nom: "Plaques", ratio: 30 },
    { id: "st-ban", nom: "Bandes", ratio: 50 },
  ],
};

const ouvrageChantier = () => ({
  id: "o1", libelle: "Cloison fictive", bibliotheque_id: "bib-1",
  quantite: 10, prix_ht: 1000, heures_devis: 30, heures_estimees: 20,
  taches: [
    { id: "t1", source_sous_tache_id: "st-oss", nom: "Ossature", ratio: 50, avancement: 100, heures_estimees: 10, heures_vendues: 15, heures_reelles: 7 },
    { id: "t2", source_sous_tache_id: "st-pla", nom: "Plaques",  ratio: 30, avancement: 100, heures_estimees: 6,  heures_vendues: 9 },
    { id: "t3", source_sous_tache_id: "st-ban", nom: "Bandes",   ratio: 20, avancement: 0,   heures_estimees: 4,  heures_vendues: 6 },
  ],
});

// 1. Répartition corrigée : % et heures alignés sur la bibliothèque,
//    avancement saisi, prix et heures réelles intacts.
{
  const o = ouvrageChantier();
  const avant = fige(o);
  const r = reporterSurOuvrage(o, biblio);
  assert.equal(r.modifie, true);
  assert.deepEqual(o, avant, "l'entrée n'est jamais modifiée en place");
  assert.equal(r.ouvrage.heures_estimees, 20, "cadence 2 × quantité 10");
  assert.deepEqual(r.ouvrage.taches.map(t => t.ratio), [20, 30, 50]);
  assert.deepEqual(r.ouvrage.taches.map(t => t.heures_estimees), [4, 6, 10]);
  assert.deepEqual(r.ouvrage.taches.map(t => t.heures_vendues), [6, 9, 15]);
  assert.equal(r.ouvrage.taches.reduce((s, t) => s + t.heures_vendues, 0), 30, "le total vendu ne bouge pas");
  assert.deepEqual(r.ouvrage.taches.map(t => t.avancement), [100, 100, 0]);
  assert.equal(r.ouvrage.taches[0].heures_reelles, 7);
  assert.equal(r.ouvrage.prix_ht, 1000);
  assert.equal(r.ouvrage.heures_devis, 30);
  assert.equal(r.realignees, 2, "Plaques avait déjà le bon % : rien à réaligner");
  assert.deepEqual(r.nonReconnues, []);
}

// 2. L'avancement suit la nouvelle répartition (80 % → 50 %).
{
  const ph = [ouvrageChantier()];
  const r = reporterSurPhasage(ph, biblio);
  assert.equal(r.avancementAvant, 80);
  assert.equal(r.avancementApres, 50);
  assert.equal(r.ouvragesConcernes, 1);
  assert.equal(avancementChantier(r.ouvrages), 50, "même formule que chantierFinance");
}

// 3. Cadence seule : heures recalculées, avancement inchangé.
{
  const o = ouvrageChantier();
  const biblioMemeRatios = { ...biblio, cadence: 3, sous_taches: [
    { id: "st-oss", nom: "Ossature", ratio: 50 },
    { id: "st-pla", nom: "Plaques", ratio: 30 },
    { id: "st-ban", nom: "Bandes", ratio: 20 },
  ] };
  const r = reporterSurPhasage([o], biblioMemeRatios);
  assert.equal(r.ouvrages[0].heures_estimees, 30);
  assert.deepEqual(r.ouvrages[0].taches.map(t => t.heures_estimees), [15, 9, 6]);
  assert.equal(r.avancementAvant, r.avancementApres);
}

// 4. Idempotence : un second report ne change rien.
{
  const r1 = reporterSurPhasage([ouvrageChantier()], biblio);
  const r2 = reporterSurPhasage(r1.ouvrages, biblio);
  assert.equal(r2.modifie, false);
  assert.equal(r2.ouvrages, r1.ouvrages, "aucune copie inutile");
}

// 5. Reconnaissance par nom (anciens ouvrages sans identifiant d'étape) :
//    casse, accents, espaces ignorés.
{
  assert.equal(nomComparable("  Réseau   ÉLEC "), "reseau elec");
  const o = { id: "o2", bibliotheque_id: "bib-2", quantite: 4, taches: [
    { id: "a", nom: "pose RÉSEAU", avancement: 0, heures_estimees: 1 },
    { id: "b", nom: "Raccordement", avancement: 0, heures_estimees: 1 },
  ] };
  const b = { id: "bib-2", cadence: 1, sous_taches: [
    { nom: "Pose réseau", ratio: 75 }, { nom: "raccordement", ratio: 25 },
  ] };
  const r = reporterSurOuvrage(o, b);
  assert.deepEqual(r.ouvrage.taches.map(t => t.heures_estimees), [3, 1]);
  assert.deepEqual(r.ouvrage.taches.map(t => t.ratio), [75, 25]);
}

// 6. Tâche non reconnue et tâche hors devis : laissées telles quelles ;
//    la non reconnue est renvoyée pour être affichée.
{
  const o = ouvrageChantier();
  o.taches.push({ id: "t4", nom: "Reprise fictive", avancement: 50, heures_estimees: 2, heures_vendues: 1 });
  o.taches.push({ id: "t5", nom: "Ossature", hors_devis: true, avancement: 0, heures_estimees: 3 });
  const r = reporterSurOuvrage(o, biblio);
  assert.deepEqual(r.ouvrage.taches[3], o.taches[3]);
  assert.deepEqual(r.ouvrage.taches[4], o.taches[4], "hors devis jamais touchée");
  assert.deepEqual(r.nonReconnues, ["Reprise fictive"]);
  assert.equal(r.realignees, 2, "Plaques avait déjà le bon % : rien à réaligner");
}

// 7. Noms en double : pas de devinette.
{
  const o = { id: "o3", bibliotheque_id: "bib-3", quantite: 1, taches: [
    { id: "x", nom: "Pose", avancement: 0, heures_estimees: 1 },
    { id: "y", nom: "Pose", avancement: 0, heures_estimees: 1 },
  ] };
  const b = { id: "bib-3", cadence: 10, sous_taches: [{ nom: "Pose", ratio: 100 }] };
  const r = reporterSurOuvrage(o, b);
  assert.deepEqual(r.nonReconnues, ["Pose", "Pose"]);
  assert.deepEqual(r.ouvrage.taches, o.taches);
}

// 8. Bibliothèque sans aucun % : la répartition du chantier est gardée,
//    seules les heures suivent la cadence.
{
  const o = ouvrageChantier();
  const b = { ...biblio, cadence: 4, sous_taches: biblio.sous_taches.map(({ ratio, ...st }) => st) };
  const r = reporterSurOuvrage(o, b);
  assert.deepEqual(r.ouvrage.taches.map(t => t.ratio), [50, 30, 20]);
  assert.deepEqual(r.ouvrage.taches.map(t => t.heures_estimees), [20, 12, 8]);
}

// 9. Cadence ou quantité absente : on n'efface jamais une heure.
{
  const o = { ...ouvrageChantier(), quantite: null };
  const r = reporterSurOuvrage(o, biblio);
  assert.equal(r.ouvrage.heures_estimees, 20);
  assert.deepEqual(r.ouvrage.taches.map(t => t.heures_estimees), [4, 6, 10]);
  const sansCadence = reporterSurOuvrage(ouvrageChantier(), { ...biblio, cadence: null });
  assert.equal(sansCadence.ouvrage.heures_estimees, 20);
}

// 10. Les autres ouvrages du phasage ne sont pas touchés.
{
  const autre = { id: "o9", bibliotheque_id: "bib-autre", taches: [{ id: "z", nom: "Ossature", ratio: 1, avancement: 10 }] };
  const sansLien = { id: "o8", taches: [] };
  const r = reporterSurPhasage([autre, ouvrageChantier(), sansLien], biblio);
  assert.equal(r.ouvrages[0], autre);
  assert.equal(r.ouvrages[2], sansLien);
  assert.equal(r.ouvragesConcernes, 1);
  const rien = reporterSurPhasage([autre], biblio);
  assert.equal(rien.ouvragesConcernes, 0);
  assert.equal(rien.modifie, false);
}

// 11. Journal des corrections : ajout sans écraser le reste du plan.
{
  const plan = { meta: { prix_vendu: 5000 }, lot_a: [{ id: "v1" }] };
  const p1 = ajouterCorrectionRatios(plan, { date: "2026-10-13", avant: 80, apres: 50 });
  const p2 = ajouterCorrectionRatios(p1, { date: "2026-10-16", avant: 50, apres: 53 });
  assert.equal(plan.meta.corrections_ratios, undefined, "pas de modification en place");
  assert.equal(p2.meta.prix_vendu, 5000);
  assert.deepEqual(p2.lot_a, [{ id: "v1" }]);
  assert.equal(p2.meta.corrections_ratios.length, 2);
  assert.equal(ajouterCorrectionRatios(null, { date: "2026-10-16" }).meta.corrections_ratios.length, 1);
  let gros = {};
  for (let i = 0; i < MAX_CORRECTIONS + 5; i++) gros = ajouterCorrectionRatios(gros, { date: "2026-10-16", avant: 0, apres: i });
  assert.equal(gros.meta.corrections_ratios.length, MAX_CORRECTIONS);

  // Bornes : relevé de départ EXCLU, fin INCLUSE.
  assert.deepEqual(correctionRatiosPeriode(p2, { apres: "2026-10-09", jusqua: null }), { points: -27, nb: 2 });
  assert.deepEqual(correctionRatiosPeriode(p2, { apres: "2026-10-13", jusqua: null }), { points: 3, nb: 1 });
  assert.deepEqual(correctionRatiosPeriode(p2, { apres: "2026-10-09", jusqua: "2026-10-13" }), { points: -30, nb: 1 });
  assert.deepEqual(correctionRatiosPeriode(p2, { apres: null, jusqua: null }), { points: -27, nb: 2 });
  assert.deepEqual(correctionRatiosPeriode({}, {}), { points: 0, nb: 0 });
  assert.deepEqual(correctionRatiosPeriode(undefined), { points: 0, nb: 0 });
}

// 12. Lecture des chantiers : le filtre jsonb doit partir en TEXTE JSON. Un
//     tableau JS devient `cs.{…}` (tableau Postgres) : « invalid input syntax
//     for type json », vu en ligne le 16/10/2026.
{
  const src = await readFile(new URL("../src/Renovation/reportRatiosChantiers.js", import.meta.url), "utf8");
  assert.match(src, /\.contains\("ouvrages", JSON\.stringify\(\[/);
  assert.doesNotMatch(src, /\.contains\("ouvrages", \[/);
}

console.log("verif-report-ratios-bibliotheque : OK");
