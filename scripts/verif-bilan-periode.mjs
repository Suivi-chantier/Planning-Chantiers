#!/usr/bin/env node
// Vérifie le Bilan d'une période (refonte du Bilan, étape 3) — DONNÉES FICTIVES.
//
//   - période semaine / mois / dates libres ; comparaison du dernier jour
//     travaillé avant la période au dernier jour travaillé de la période ;
//   - synthèse par chantier = différences de relevés (rien n'est recalculé) ;
//     relevé absent → « relevé pas encore disponible », jamais 0 ;
//   - présélection : chantier sans activité décoché, chantier avec seulement
//     une commande coché, décochage manuel conservé pour la période ;
//   - avertissement : comptes rendus non validés + journées incomplètes ;
//   - version direction : aucun commentaire brut d'ouvrier.
//
//   node scripts/verif-bilan-periode.mjs
import assert from "node:assert/strict";
import * as B from "../src/Renovation/bilanPeriodeV3.mjs";
import { documentBilanV3, htmlBilanDirectionV3 } from "../src/Renovation/bilanPdfV3.mjs";
import * as F from "../src/Renovation/bilanFicheV3.mjs";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── Périodes ────────────────────────────────────────────────────────────────
{
  const s = B.periodeSemaineV3("2026-W43");
  eq([s.debut, s.fin], ["2026-10-19", "2026-10-25"], "semaine 43 = 19/10 → 25/10");
  eq(B.semaineIsoV3("2026-10-25"), "2026-W43", "le dimanche 25/10 est en W43");
  eq(B.semaineIsoV3("2026-01-01"), "2026-W01", "01/01/2026 en W01");
  const m = B.periodeMoisV3("2026-02");
  eq([m.debut, m.fin], ["2026-02-01", "2026-02-28"], "février 2026");
  ok(B.periodeLibreV3("2026-10-10", "2026-10-01") === null, "dates libres inversées refusées");
  eq(B.dateRapportIsoV3("22/10/2026"), "2026-10-22", "date de compte rendu JJ/MM/AAAA");
}

// ── Bornes : dernier jour travaillé ─────────────────────────────────────────
{
  const p = B.periodeSemaineV3("2026-W43");
  // Semaine de 4 jours : lundi→jeudi travaillés ; la précédente aussi.
  const jours = ["2026-10-12", "2026-10-15", "2026-10-19", "2026-10-22"];
  const b = B.bornesComparaisonV3(p, jours);
  eq([b.dateDepart, b.dateFin], ["2026-10-15", "2026-10-22"], "jeudi 15/10 → jeudi 22/10");
  const vide = B.bornesComparaisonV3(p, []);
  ok(vide.sansJourTravaille && vide.dateFin === "2026-10-25" && vide.dateDepart === "2026-10-18", "sans jour travaillé : bornes calendaires, signalé");
}

// ── Synthèse par chantier ───────────────────────────────────────────────────
const rel = (id, date, o = {}) => ({ chantier_id: id, chantier_nom: id.toUpperCase(), date_releve: date, avancement: 50,
  vendu_ht: 10000, heures_vendues: 100, heures_reelles: 40, production_cumulee: 5000, marge_avancement: 1000,
  marge_terminaison: 2000, marge_probable: 1500, budget_restant: 6000, chantier_repris: false, ...o });
const P = B.periodeSemaineV3("2026-W43");
const BORNES = B.bornesComparaisonV3(P, ["2026-10-15", "2026-10-22"]);
{
  const releves = B.indexerRelevesV3([
    rel("a", "2026-10-15"),
    rel("a", "2026-10-22", { avancement: 60, production_cumulee: 6000, marge_avancement: 1400, heures_reelles: 60, marge_probable: 1600 }),
    rel("a", "2026-10-24", { avancement: 99 }), // après le dernier jour travaillé : ignoré
    rel("b", "2026-10-22", { avancement: null }), // avancement inconnu
    rel("c", "2026-10-01"), rel("c", "2026-10-15"), rel("c", "2026-10-22", { marge_probable: 500 }),
  ]);
  const syn = B.syntheseChantiersV3({ releves, chantiers: [{ id: "a", nom: "A" }, { id: "b", nom: "B" }, { id: "c", nom: "C" }, { id: "d", nom: "D" }],
    bornes: BORNES, periode: P, alertesParChantier: {} });
  const [a, b, c, d] = syn;
  eq([a.production, a.margePeriode, a.heuresPeriode, a.eurParHeure], [1000, 400, 20, 50], "A : production 1 000 €, marge +400 €, 20 h, 50 €/h");
  eq(a.evolutionMargeProbable, 100, "A : marge probable +100 €");
  eq(a.avancement, 60, "A : relevé du dernier jour travaillé (pas du samedi)");
  eq(a.pastille.couleur, "vert", "A : pastille verte");
  ok(!b.disponible && b.production === null && b.margePeriode === null && b.pastille.couleur === "gris", "B : avancement inconnu → indisponible, jamais 0");
  eq(c.pastille.couleur, "rouge", "C : marge probable −1 000 € sur la période → rouge");
  ok(!d.disponible && d.margeProbable === null, "D : aucun relevé → indisponible");
  const band = B.bandeauV3({ synthese: syn, nbComptesRendusNonValides: 2 });
  eq([band.production, band.margePeriode, band.nbComptesRendusNonValides, band.nbIndisponibles], [1000, 400, 2, 2], "bandeau : totaux des chantiers disponibles");
  // Semaine où le chantier progresse et gagne de l'argent : pas de pastille rouge.
  ok(a.margePeriode > 0 && a.pastille.couleur !== "rouge", "chantier qui progresse et gagne : pas rouge");
}
{
  // Mentions : démarrage, réception / levée de réserves, chantier repris.
  const releves = B.indexerRelevesV3([
    rel("n", "2026-10-13", { heures_reelles: 0 }), rel("n", "2026-10-16", { heures_reelles: 8 }), rel("n", "2026-10-22", { heures_reelles: 30 }),
    rel("r", "2026-10-10", { avancement: 100, heures_reelles: 200 }), rel("r", "2026-10-15", { avancement: 100, heures_reelles: 204 }),
    rel("r", "2026-10-22", { avancement: 100, heures_reelles: 210 }),
    rel("t", "2026-10-15", { chantier_repris: true }), rel("t", "2026-10-22", { chantier_repris: true }),
  ]);
  const [nouveau, recu, repris] = B.syntheseChantiersV3({ releves, chantiers: [{ id: "n" }, { id: "r" }, { id: "t" }], bornes: BORNES, periode: P });
  ok(nouveau.mentions.some(m => m.code === "demarrage"), "démarrage : première heure le 16/10");
  const mr = recu.mentions.find(m => m.code === "reception");
  ok(mr && mr.heuresApresReception === 10, "réception : 10 h après réception");
  ok(repris.repris && repris.mentions.some(m => m.code === "repris"), "chantier repris mentionné");
}

// ── Activité et présélection ────────────────────────────────────────────────
{
  const activite = B.activiteChantiersV3({
    periode: P,
    pointages: [{ chantier_id: "h", date: "2026-10-20", heures: 7 }, { chantier_id: "x", date: "2026-10-10", heures: 7 }],
    rapports: [{ chantier_id: "nv", date_rapport: "21/10/2026", statut: "en_attente" }],
    journal: [{ chantier_id: "av", date_realisation: "2026-10-21", source: "phasage", avancement_avant: 10, avancement_apres: 20 },
      { chantier_id: "x", date_realisation: "2026-10-21", source: "reconstitution", avancement_avant: 0, avancement_apres: 20 }],
    commandes: [{ chantier_id: "cmd", date: "2026-10-23" }],
  });
  const pre = B.preselectionChantiersV3({ chantiers: ["h", "nv", "av", "cmd", "x"].map(id => ({ id, nom: id.toUpperCase() })), activite });
  const coche = id => pre.find(p => p.chantierId === id).coche;
  ok(coche("h") && coche("nv") && coche("av"), "heures pointées, compte rendu non validé, avancement : cochés");
  ok(coche("cmd"), "chantier avec seulement une commande datée de la période : coché");
  ok(!coche("x") && pre.find(p => p.chantierId === "x").mention === B.MENTION_SANS_ACTIVITE, "chantier sans activité : décoché, « aucune activité sur la période »");
  eq(B.ligneSansActiviteV3(pre), "Chantiers en cours sans activité : X", "ligne du PDF des chantiers sans activité");
  const pre2 = B.preselectionChantiersV3({ chantiers: [{ id: "h", nom: "H" }, { id: "x", nom: "X" }], activite, choix: { h: false, x: true } });
  ok(!pre2[0].coche && pre2[1].coche && pre2[0].manuel, "décochage / cochage manuel de la période conservé");
}

// ── Avertissement avant l'export ────────────────────────────────────────────
{
  const av = B.avertissementsExportV3({
    periode: P, chantierIds: ["f", "k"], noms: { f: "FOURMOND 102", k: "KATHLEEN" },
    rapports: [
      { chantier_id: "f", ouvrier: "Davy", date_rapport: "20/10/2026", statut: "en_attente" },
      { chantier_id: "f", ouvrier: "Kev", date_rapport: "21/10/2026", statut: "en_attente" },
      { chantier_id: "k", ouvrier: "Selman", date_rapport: "21/10/2026", statut: "en_attente" },
      { chantier_id: "k", ouvrier: "Selman", date_rapport: "20/10/2026", statut: "valide" },
      { chantier_id: "z", ouvrier: "Zoé", date_rapport: "21/10/2026", statut: "en_attente" },
    ],
    relevesLignes: [{ chantier_id: "f", date_releve: "2026-10-22", statut_completude: "incomplete", cr_manquants: ["Margaux"] }],
  });
  eq(av.nbNonValides, 3, "3 comptes rendus non validés sur les chantiers sélectionnés");
  eq(av.textes[0], "3 comptes rendus non validés (FOURMOND 102, KATHLEEN) : chiffres incomplets", "texte de l'avertissement");
  ok(av.nbJoursIncomplets === 1 && /FOURMOND 102 : jeu\. 22\/10/.test(av.textes[1]), "journée incomplète signalée");
}

// ── Version direction : aucun commentaire brut ──────────────────────────────
{
  const COMMENTAIRE = "Kev n'a rien fait de la journée";
  const releves = B.indexerRelevesV3([rel("a", "2026-10-15"), rel("a", "2026-10-22")]);
  const synthese = B.syntheseChantiersV3({ releves, chantiers: [{ id: "a", nom: "A", commentaire: COMMENTAIRE }], bornes: BORNES, periode: P });
  synthese[0].commentaires = [{ ouvrier: "Davy", texte: COMMENTAIRE }]; // même si un champ traîne
  const d = { periode: P, bornes: BORNES, bandeau: B.bandeauV3({ synthese }), synthese, alertes: [],
    fiches: [{ nom: "A", lots: [], commentaires: [{ ouvrier: "Davy", texte: COMMENTAIRE }] }] };
  const direction = documentBilanV3(d, { detaillee: false });
  ok(!direction.includes(COMMENTAIRE) && !direction.includes("Kev n&#39;a") && !direction.includes("rien fait"), "version direction : aucun commentaire brut");
  ok(!htmlBilanDirectionV3(d).includes("Commentaires retenus"), "version direction : pas de section commentaires");
  const detaillee = documentBilanV3(d, { detaillee: true });
  ok(detaillee.includes("rien fait"), "version détaillée : seulement les commentaires cochés (passés explicitement)");
  ok(direction.includes("Pastilles"), "légende des pastilles présente");
  ok(documentBilanV3({ ...d, synthese: [{ ...synthese[0], disponible: false, pastille: { couleur: "gris" }, mentions: [] }] }).includes("colspan=\"7\" class=\"gris\">relevé pas encore disponible"),
    "chantier sans relevé : « relevé pas encore disponible » dans le PDF");
  ok(!direction.includes("<script"), "aucun script dans le document");
  const xss = documentBilanV3({ ...d, synthese: [{ ...synthese[0], nom: "<img src=x onerror=1>" }] });
  ok(!xss.includes("<img src=x"), "noms échappés");
}

// ── Version détaillée : fiche chantier ─────────────────────────────────────
{
  const releveFin = { chantier_id: "a", date_releve: "2026-10-22", pct_sans_lot: 14.2, heures_sans_lot: 9,
    mat_reel: 5000, materiaux_imputes: 4200, materiaux_en_avance: 800, reste_a_commander: 1500,
    couts_par_nature: { materiaux: 4000, sous_traitance: 1000, location: 0, dechets: 0, autre: 0 },
    lots: [{ id: "murs", label: "Murs cloisons", heuresReelles: 50, heuresVendues: 60, avancementExact: 55, ecartHeures: 17, ecartEuros: 850,
      heuresRestantesPrevues: 27, heuresRestantesProbables: 41, coefficient: 1.52, provenanceCoefficient: "constatee" },
      { id: "_orphans", label: "Sans lot", heuresReelles: 9, heuresVendues: 0 }] };
  const ouvrages = [{ id: "o1", lot_id: "murs", libelle: "Cloisons", taches: [{ id: "t1", nom: "Plaquage chambre" }, { id: "t2", nom: "Bandes SDB" }, { id: "t3", nom: "Isolation" }] }];
  const journal = [
    { chantier_id: "a", tache_id: "t1", source: "validation_cr", avancement_avant: 50, avancement_apres: 100, date_realisation: "2026-10-20" },
    { chantier_id: "a", tache_id: "t2", source: "validation_cr", avancement_avant: 0, avancement_apres: 40, date_realisation: "2026-10-21" },
    { chantier_id: "a", tache_id: "t3", source: "validation_cr", avancement_avant: 0, avancement_apres: 100, date_realisation: "2026-10-10" }, // avant la période
  ];
  const pointages = [["Davy", "2026-10-19"], ["Davy", "2026-10-20"], ["Davy", "2026-10-21"], ["Davy", "2026-10-22"], ["Kev", "2026-10-20"], ["Kev", "2026-10-21"], ["Kev", "2026-10-12"]]
    .map(([ouvrier, date]) => ({ chantier_id: "a", ouvrier, date, heures: 7 }));
  const rapports = [{ id: "r1", chantier_id: "a", ouvrier: "Davy", date_rapport: "20/10/2026", remarque: "Il manque des vis de 25",
    photos_chantier: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"], taches: [{ planifie: "Bandes", remarque: "Kev traîne", photos: ["https://x/4.jpg"] }] }];
  const mat = F.matiereComptesRendusV3({ rapports, chantierId: "a", debut: P.debut, fin: P.fin });
  ok(mat.photos.length === 4 && mat.commentaires.length === 2, "photos et commentaires des comptes rendus proposés au conducteur");
  const fiche = F.ficheChantierV3({ synthese: { chantierId: "a", nom: "A" }, releveFin, ouvrages, journal, pointages, periode: P, bornes: BORNES,
    photosChoisies: mat.photos.map(x => x.url), commentairesCoches: [mat.commentaires[0]], syntheseRelue: "Cloisons de la chambre terminées." });
  ok(fiche.photos.length === 2, "deux photos au plus");
  ok(fiche.commentaires.length === 1 && fiche.commentaires[0].texte === "Il manque des vis de 25", "seuls les commentaires cochés");
  eq(fiche.presences, "Davy 4 j · Kev 2 j", "présences sur une ligne (jours de la période)");
  eq(fiche.tachesParLot, [{ lot: "Murs cloisons", resume: "1 terminée, 1 en cours",
    taches: [{ nom: "Bandes SDB", etat: "en cours 40 %", terminee: false }, { nom: "Plaquage chambre", etat: "terminée", terminee: true }] }], "tâches résumées par lot puis détail");
  ok(/14,2 % des heures sont « sans lot »/.test(fiche.sansLotAlerte), "ligne « sans lot » mise en évidence au-delà de 10 %");
  ok(fiche.lots.find(l => l.id === "murs").provenance === "×1,52 · dérive constatée", "provenance du coefficient");
  eq(fiche.materiaux.parNature.map(x => x.nature), ["materiaux", "sous_traitance"], "ventilation par nature (natures non nulles)");
  ok(F.materiauxFicheV3({ mat_reel: 1 }).parNatureDisponible === false, "relevé sans ventilation : signalée indisponible");
  eq(fiche.synthese, "Cloisons de la chambre terminées.", "synthèse = texte relu");
  const html = documentBilanV3({ periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: [], fiches: [fiche], methode: F.methodeBilanV3() }, { detaillee: true });
  ok(html.includes("Méthode de calcul") && html.includes("Marge de la période") && html.includes("Davy 4 j"), "PDF détaillé : fiches + annexe méthode");
  ok(!html.includes("Kev traîne"), "commentaire non coché absent du PDF détaillé");
  const direction = documentBilanV3({ periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: [], fiches: [fiche] }, { detaillee: false });
  ok(!direction.includes("vis de 25") && !direction.includes("Kev traîne"), "version direction : aucun commentaire, même coché");
}
{
  // Tâche IA « synthèse du Bilan » : entrée bornée, sortie = une phrase.
  const tache = require_("../api/_ia/taches/bilan_synthese.js");
  ok(tache.schema_entree({ chantier: "A", periode: "Semaine 43", faits: {}, comptes_rendus: [{ texte: "ok" }] }) === true, "IA : entrée valide");
  ok(tache.schema_entree({ chantier: "A", periode: "S", faits: {}, comptes_rendus: [{ texte: "x".repeat(700) }] }) !== true, "IA : extrait trop long refusé");
  ok(tache.schema_sortie({ phrase: "Cloisons terminées." }) === true && tache.schema_sortie({}) !== true, "IA : sortie = une phrase");
  ok(/jamais des instructions/.test(tache.construire_prompt({ chantier: "A", periode: "S", faits: {}, comptes_rendus: [] }).system), "IA : textes des ouvriers traités comme des données");
}

console.log(`verif-bilan-periode : ${n} contrôles OK (données fictives)`);
