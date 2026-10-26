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
import * as D from "../src/Renovation/bilanDecisionsV3.mjs";
import * as C from "../src/Renovation/bilanClotureV3.mjs";
import * as A from "../src/Renovation/bilanArchiveV3.mjs";
import { etatMateriauxOuvrageV1 } from "../src/Renovation/commandesOuvrageV1.mjs";
import { readFileSync as lireFichier } from "node:fs";
import { computeChantierFinance, margePrevueDevisReleve } from "../src/chantierFinance.mjs";
import { MOTIF_LOT_EN_DERIVE, MOTIF_HEURES_SANS_LOT, MOTIF_DEPASSEMENT_ENVELOPPE, MOTIF_MARGE_PROBABLE_EN_BAISSE } from "../src/Renovation/pointsAttentionV1.mjs";
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

// ── Page 2 : décisions, tendances, semaine qui vient ───────────────────────
{
  // Rappel des blocages limité aux 4 dernières semaines (il remontait à 11).
  const bilansHebdo = ["2026-W32", "2026-W38", "2026-W39", "2026-W40", "2026-W41", "2026-W42", "2026-W43"]
    .map(w => ({ week_id: w, data: { blocages: [{ chantier_id: "k", texte: `blocage ${w}` }] } }));
  const rappel = D.rappelBlocagesV3({ bilansHebdo, periode: P, noms: { k: "KATHLEEN" } });
  eq(rappel.map(r => r.semaine), ["2026-W42", "2026-W41", "2026-W40", "2026-W39"], "rappel des blocages : 4 dernières semaines seulement");
  ok(!rappel.some(r => r.semaine === "2026-W43"), "la semaine du bilan n'est pas un rappel");
}
{
  // Tâche en cours depuis 3 semaines + compte rendu qui mentionne une attente.
  const r = (semaine, date, statut, remarque = "") => ({ chantier_id: "k", ouvrier: "Davy", semaine, date_rapport: date, remarque,
    taches: [{ planifie: "Bandes SDB", statut }] });
  const sugg = D.suggestionsDecisionsV3({ periode: P, noms: { k: "KATHLEEN" }, rapports: [
    r("2026-W41", "08/10/2026", "en_cours"), r("2026-W42", "15/10/2026", "en_cours"), r("2026-W43", "21/10/2026", "en_cours", "On attend le carottage"),
  ] });
  ok(sugg.some(x => x.type === "tache_en_cours" && /en cours depuis 3 semaines/.test(x.titre)), "tâche en cours depuis 3 semaines proposée");
  ok(sugg.some(x => x.type === "attente" && /carottage/.test(x.detail)), "compte rendu « en attente » proposé");
  const deux = D.suggestionsDecisionsV3({ periode: P, rapports: [r("2026-W42", "15/10/2026", "en_cours"), r("2026-W43", "21/10/2026", "en_cours")] });
  ok(!deux.some(x => x.type === "tache_en_cours"), "2 semaines seulement : pas de proposition");
}
{
  // Tendances par lot : chantier repris exclu, lot sous 25 % exclu (sauf chantier terminé).
  const lot = (id, av, hr, ha, ee) => ({ id, label: id === "elec" ? "Électricité" : "Peinture", avancementExact: av, heuresReelles: hr, heuresAttendues: ha, ecartHeures: hr - ha, ecartEuros: ee });
  const t = D.tendancesParLotV3({
    statuts: { fin: "termine" },
    releves: [
      { chantier_id: "a", chantier_nom: "A", lots: [lot("elec", 50, 30, 20, 400), lot("peinture", 10, 50, 10, 1600)] },
      { chantier_id: "fin", chantier_nom: "FIN", lots: [lot("elec", 100, 50, 40, 300), lot("peinture", 20, 12, 10, 80)] },
      { chantier_id: "tom", chantier_nom: "TOM & CAMILLE", chantier_repris: true, lots: [lot("elec", 80, 500, 10, 9000)] },
      { chantier_id: "arthur", chantier_nom: "ARTHUR RDC", lots: [lot("elec", 90, 900, 10, 9000)] },
    ],
    exclus: ["ARTHUR RDC"],
  });
  const elec = t.lignes.find(l => l.id === "elec");
  ok(elec.nbChantiers === 2 && elec.derive === 1.33, "électricité : (30 + 50) ÷ (20 + 40), 2 chantiers");
  ok(t.reprisExclus.includes("TOM & CAMILLE"), "chantier repris exclu des tendances");
  eq(t.lignes.find(l => l.id === "peinture").nbChantiers, 1, "peinture à 10 % d'un chantier en cours exclue, chantier terminé gardé");
  ok(/Électricité/.test(t.phrase), "le lot qui dérive le plus est signalé");
}
{
  ok(/n'a pas pu être calculée/.test(D.semaineQuiVientV3({ erreur: "délai dépassé" }).indisponible), "semaine qui vient : erreur visible, jamais une section vide");
  const sq = D.semaineQuiVientV3({ decoupe: { par_chantier: [{ chantier_id: "k", resource_ids: ["r1", "r2"], jours: ["2026-10-26", "2026-10-27"], heures_mo: 31.5, taches: ["t1"] }],
    chantiers_au_dela_horizon: [] }, nomChantier: () => "KATHLEEN", nomRessource: id => ({ r1: "Davy", r2: "Kev" }[id]) });
  eq(sq.lignes[0], { titre: "KATHLEEN", detail: "Davy, Kev · 2 jours · 32 h · 1 tâche prévue" }, "semaine qui vient : équipe prévue par chantier");
}

// ── Bilan de clôture ───────────────────────────────────────────────────────
{
  const releveFin = { avancement: 100, vendu_ht: 20000, heures_vendues: 100, heures_reelles: 130, mo_reel: 5200, mat_reel: 6000, mat_prev: 5500,
    fg: 2267, marge_avancement: 6533, lots: [{ id: "murs", label: "Murs cloisons", heuresVendues: 60, heuresReelles: 90, ecartHeures: 30, ecartEuros: 1500 }] };
  const ouvrages = [
    { id: "o1", libelle: "Cloison 72/48", lot_id: "murs", quantite: 30, unite: "m²", heures_estimees: 60, bibliotheque_id: "b1", taches: [{ id: "t1" }, { id: "t2" }] },
    { id: "o2", libelle: "Doublage", lot_id: "murs", quantite: 10, unite: "m²", heures_estimees: 10, bibliotheque_id: "b2", taches: [{ id: "t3" }] },
  ];
  const pointages = [{ tache_id: "t1", heures: 50 }, { tache_id: "t2", heures: 40 }, { tache_id: "t3", heures: 10.5 }];
  const b = C.bilanClotureV3({ releveFin, ouvrages, pointages });
  ok(b.applicable && b.totaux.margeFinale === 6533 && b.totaux.margeFinalePct === 32.67, "clôture : marge finale lue dans le relevé");
  const o1 = b.ouvrages.find(o => o.id === "o1");
  ok(o1.heuresReelles === 90 && o1.cadencePrevue === 2 && o1.cadenceConstatee === 3, "clôture : cadence prévue 2 h/m² → constatée 3 h/m²");
  eq(b.propositions.map(x => x.bibliothequeId), ["b1"], "proposition de cadence seulement au-delà de 15 % d'écart (doublage +5 % non proposé)");
  ok(!C.bilanClotureV3({ releveFin: { ...releveFin, chantier_repris: true }, ouvrages, pointages }).applicable, "pas de bilan de clôture pour un chantier repris");
  ok(!C.bilanClotureV3({ releveFin: { ...releveFin, avancement: 95 }, ouvrages, pointages }).applicable, "pas de bilan de clôture avant 100 %");
}

// ── Bilans figés et rectifications ─────────────────────────────────────────
{
  const W42 = B.periodeSemaineV3("2026-W42");
  const bornes42 = { dateDepart: "2026-10-08", dateFin: "2026-10-15" };
  // Bilan W42 exporté le 16/10 : marge de la période de A = +400 €.
  const relAvant = B.indexerRelevesV3([rel("a", "2026-10-08", { marge_avancement: 1000 }), rel("a", "2026-10-15", { marge_avancement: 1400 })]);
  const syn42 = B.syntheseChantiersV3({ releves: relAvant, chantiers: [{ id: "a", nom: "A" }], bornes: bornes42, periode: W42 });
  const ligne = A.ligneArchiveV3({ periode: W42, bornes: bornes42, synthese: syn42, version: "direction", documentHtml: "<p>doc</p>", prevuSemaineSuivante: { a: 30 } });
  eq(ligne.chiffres.chantiers[0].margePeriode, 400, "archive : marge de la période figée");
  ok(ligne.date_depart === "2026-10-08" && ligne.date_fin === "2026-10-15" && ligne.version === "direction", "archive : bornes et version");
  const archives = [{ ...ligne, exporte_le: "2026-10-16T17:00:00Z" }];
  // Après l'export, un compte rendu du 14/10 est validé le 19/10 : le relevé du 15/10 est recalculé.
  const relApres = B.indexerRelevesV3([rel("a", "2026-10-08", { marge_avancement: 1000 }), rel("a", "2026-10-15", { marge_avancement: 1250 })]);
  const r = A.rectificationsV3({ archives, releves: relApres, periode: P,
    pointages: [{ chantier_id: "a", date: "2026-10-14", created_at: "2026-10-19T08:00:00Z" }] });
  ok(r.length === 1 && r[0].montant === -150 && r[0].periode === W42.libelle, "donnée rétrodatée : rectification de −150 € sur la semaine 42");
  ok(/heures validées ou saisies après l'export/.test(r[0].cause), "cause de la rectification");
  ok(A.rectificationsV3({ archives, releves: relAvant, periode: P }).length === 0, "rien n'a changé : aucune rectification");
  // Un nouvel export de la même période fait foi.
  const reexport = [...archives, { ...ligne, chiffres: { chantiers: [{ ...ligne.chiffres.chantiers[0], margePeriode: 250 }] }, exporte_le: "2026-10-20T08:00:00Z" }];
  ok(A.rectificationsV3({ archives: reexport, releves: relApres, periode: P }).length === 0, "le dernier export de la période fait foi");
  // La période courante n'est jamais « rectifiée ».
  ok(A.rectificationsV3({ archives, releves: relApres, periode: W42 }).length === 0, "pas de rectification de la période en cours");
  const html = documentBilanV3({ periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: [], rectifications: r });
  ok(/Rectifications/.test(html) && /−150/.test(html), "ligne « Rectifications » dans le PDF");
  // Prévu / réalisé : 30 h prévues par le bilan W42 pour W43.
  const syn43 = [{ chantierId: "a", nom: "A", heuresPeriode: 26 }];
  const pr = A.prevuRealiseV3({ archives, periode: P, synthese: syn43 });
  ok(pr.disponible && pr.lignes[0].heuresPrevues === 30 && pr.lignes[0].ecart === -4, "prévu / réalisé : 30 h prévues, 26 h réalisées");
  ok(!A.prevuRealiseV3({ archives: [], periode: P, synthese: syn43 }).disponible, "sans bilan précédent : prévu indisponible, signalé");
}

// ── Semaine qui vient : commandes à passer et livraisons attendues ─────────
{
  // Ouvrage fictif : m1 déjà commandé (ligne saisie), m2 marqué « commandé le »
  // sans réception, m3 à commander, m9 inconnu de la bibliothèque.
  const ouv = (id, date, liens) => ({ id, libelle: `Ouvrage ${id}`, taches: [{ date_prevue: date }, { date_prevue: "2026-12-01" }], materiaux_liens: liens });
  const o1 = ouv("o1", "2026-10-28", [{ materiau_id: "m1" }, { materiau_id: "m2", commande_le: "2026-10-20" }, { materiau_id: "m3" }, { materiau_id: "m9" }]);
  const lignes = [{ chantier_id: "a", ouvrage_id: "o1", materiau_id: "m1" }];
  const connus = id => ["m1", "m2", "m3", "m4"].includes(String(id));
  const e1 = etatMateriauxOuvrageV1({ ouvrage: o1, chantierId: "a", lignesCmd: lignes, estConnu: connus });
  eq([e1.liens.length, e1.aCommander.map(x => x.materiau_id), e1.marques.map(x => x.materiau_id), e1.dateBesoin],
    [3, ["m3"], ["m2"], "2026-10-28"], "règle d'un ouvrage : à commander, marqué commandé, date de besoin");
  // Même règle dans la page « Commandes à passer » (même chiffre = même service).
  const pageCmd = lireFichier(new URL("../src/Renovation/PagePlanningCommandes.jsx", import.meta.url), "utf8");
  ok(pageCmd.includes("etatMateriauxOuvrageV1(") && !/const matCommandes = new Set/.test(pageCmd), "Commandes à passer utilise la même règle");
  const o2 = ouv("o2", "2026-11-20", [{ materiau_id: "m4" }]); // besoin après la semaine qui vient
  const FEN = { debut: "2026-10-26", fin: "2026-11-01" };
  const cmd = D.commandesSemaineQuiVientV3({ phasages: [{ chantier_id: "a", ouvrages: [o1, o2] }, { chantier_id: "b", ouvrages: [ouv("o3", "2026-10-15", [{ materiau_id: "m4" }])] }],
    lignesCmd: lignes, fenetre: FEN, estConnu: connus });
  eq(cmd.get("a"), { aCommander: { articles: 1, ouvrages: ["Ouvrage o1"] }, attendus: { articles: 1, ouvrages: ["Ouvrage o1"] } }, "chantier a : 1 article à commander, 1 livraison attendue ; besoin après la fenêtre ignoré");
  ok(cmd.get("b").aCommander.articles === 1, "besoin déjà passé et toujours pas commandé : compté");
  const decoupe = { fenetre: FEN, par_chantier: [{ chantier_id: "a", resource_ids: ["r1"], jours: ["2026-10-26"], heures_mo: 8, taches: [] }], chantiers_au_dela_horizon: [] };
  const sqv = D.semaineQuiVientV3({ decoupe, commandes: cmd });
  ok(sqv.lignes[0].detail.includes("à commander : 1 article (Ouvrage o1)") && /livraison attendue : 1 article commandé, réception non saisie/.test(sqv.lignes[0].detail), "semaine qui vient : commandes du chantier prévu");
  ok(sqv.lignes.some(l => l.titre === "b" && /pas d'équipe prévue/.test(l.detail)), "chantier sans équipe mais avec une commande à passer : listé");
  ok(D.semaineQuiVientV3({ decoupe }).lignes.some(l => /lecture en cours/.test(l.detail)), "commandes pas encore lues : dit comme tel");
  ok(D.semaineQuiVientV3({ decoupe, erreurCommandes: "réseau" }).lignes.some(l => /indisponibles : réseau/.test(l.detail)), "commandes illisibles : dit comme tel, jamais « rien à commander »");
}

// ── Fin prévisionnelle et glissement depuis le bilan précédent ─────────────
{
  const P43 = { cle: "S:2026-W43", libelle: "Semaine 43", debut: "2026-10-19", fin: "2026-10-25" };
  const syn = [{ chantierId: "a", nom: "A" }, { chantierId: "b", nom: "B" }, { chantierId: "c", nom: "C" }, { chantierId: "d", nom: "D" }];
  const fins = new Map([["a", { fin_prevue: "2026-11-13", complet: true }], ["b", { fin_prevue: null, complet: false }],
    ["c", { fin_prevue: "2026-11-20", complet: true }], ["d", { fin_prevue: "2026-12-04", complet: true }]]);
  ok(!A.finsPrevuesV3({ archives: [], periode: P43, synthese: syn, fins: null }).disponible, "planning pas encore calculé : indisponible, signalé");
  const sans = A.finsPrevuesV3({ archives: [], periode: P43, synthese: syn, fins });
  ok(sans.lignes.every(l => l.glissementJours === null && l.texteGlissement === "pas de bilan précédent"), "sans bilan précédent : « pas de bilan précédent », jamais 0 jour");
  ok(sans.lignes[1].finPrevue === null && /au-delà de l'horizon/.test(sans.lignes[1].texteFin), "fin au-delà de l'horizon : jamais une date");
  const ligne42 = A.ligneArchiveV3({ periode: { cle: "S:2026-W42", libelle: "Semaine 42", debut: "2026-10-12", fin: "2026-10-18" },
    bornes: { dateDepart: "2026-10-09", dateFin: "2026-10-16" }, synthese: syn, version: "direction",
    finsPrevues: new Map([["a", { fin_prevue: "2026-11-10", complet: true }], ["b", { fin_prevue: "2026-11-01", complet: true }], ["d", { fin_prevue: "2026-12-04", complet: true }]]) });
  eq(ligne42.chiffres.chantiers.map(c => [c.finCalculee, c.finPrevue, c.finAuDelaHorizon]),
    [[true, "2026-11-10", false], [true, "2026-11-01", false], [true, null, null], [true, "2026-12-04", false]], "l'archive garde la fin prévue de chaque chantier");
  ok(A.ligneArchiveV3({ periode: P43, bornes: {}, synthese: syn, version: "direction" }).chiffres.chantiers[0].finCalculee === false, "export avant le calcul du planning : fin « non calculée », pas null déguisé");
  const avec = A.finsPrevuesV3({ archives: [{ ...ligne42, exporte_le: "2026-10-17T10:00:00Z" }], periode: P43, synthese: syn, fins });
  const parId = Object.fromEntries(avec.lignes.map(l => [l.chantierId, l]));
  ok(parId.a.glissementJours === 3 && parId.a.texteGlissement.includes("+3 j depuis le bilan « Semaine 42 » (10/11/2026)"), "glissement de +3 jours");
  ok(parId.b.glissementJours === null && parId.b.texteGlissement.includes("01/11/2026"), "passé au-delà de l'horizon : pas de nombre de jours inventé");
  ok(parId.c.glissementJours === null && /pas de fin au bilan/.test(parId.c.texteGlissement), "pas de fin au bilan précédent : dit comme tel");
  ok(parId.d.glissementJours === 0 && /inchangée/.test(parId.d.texteGlissement), "même date : inchangée (0 jour connu)");
  const html = documentBilanV3({ periode: P43, bornes: {}, bandeau: {}, synthese: [], alertes: [], finsPrevues: avec });
  ok(/Fin prévisionnelle/.test(html) && html.includes("+3 j"), "fin prévisionnelle et glissement dans le PDF");
}

// ── PDF direction retravaillé (choix de Loris du 26/10/2026) ────────────────
// Exemple issu des tests, données fictives.
{
  // Marge prévue au devis = marge à terminaison à 0 % d'avancement (sans tâche ajoutée).
  const FG = [{ depuis: "2026-01-01", taux: 10 }];
  const ouv = (id, lot, prix, heures, mat) => ({ id, libelle: id, lot_id: lot, prix_ht: prix, heures_devis: heures, cout_materiaux: mat,
    taches: [{ id: `t-${id}`, nom: id, avancement: 0, heures_estimees: heures, heures_vendues: heures }] });
  const f = computeChantierFinance({ phasage: { ouvrages: [ouv("o1", "l1", 10000, 100, 2000), ouv("o2", "l2", 6000, 40, 500)], plan_travaux: { meta: {} } },
    lots: [{ id: "l1", label: "L1" }, { id: "l2", label: "L2" }], tauxMOPrev: 20, tauxFG: FG, aujourdhui: "2026-10-24" });
  // 16 000 − 140 h × 20 − 2 500 − 140 h × 10 = 9 300
  ok(Math.abs(f.brut.margePrevChantier - 9300) < 0.01, `marge devis : ${f.brut.margePrevChantier}`);
  ok(Math.abs(f.brut.margePrevChantier - f.brut.margeATerminaison) < 0.01, "marge devis = marge à terminaison à 0 % d'avancement");
  const releve = { vendu_ht: f.brut.prixHTChantier, mo_prev: f.brut.moPrevChantier, mat_prev: f.brut.commandesPrevChantier,
    heures_vendues: f.brut.heuresVenduesChantier, date_releve: "2026-10-24" };
  ok(Math.abs(margePrevueDevisReleve(releve, FG) - f.brut.margePrevChantier) < 0.01, "même fonction depuis les colonnes du relevé");
  eq(margePrevueDevisReleve({ ...releve, mo_prev: null }, FG), null, "colonne manquante : marge devis inconnue, jamais 0");
}
{
  // % avec un vendu nul : « — », jamais 0 %.
  eq(B.pctSurV3(500, 0), null, "pourcentage sur un vendu nul : inconnu");
  eq(B.pctSurV3(500, null), null, "pourcentage sur un vendu inconnu : inconnu");
  eq(B.pctSurV3(2500, 10000), 25, "pourcentage du vendu");
  const releves = B.indexerRelevesV3([rel("z", "2026-10-15", { vendu_ht: 0, mo_prev: 0, mat_prev: 0, heures_vendues: 0 }),
    rel("z", "2026-10-22", { vendu_ht: 0, mo_prev: 0, mat_prev: 0, heures_vendues: 0 })]);
  const syn = B.syntheseChantiersV3({ releves, chantiers: [{ id: "z", nom: "Z" }], bornes: BORNES, periode: P });
  ok(syn[0].margeDevisPct === null && syn[0].margeProbablePct === null && syn[0].eurParHeureDevis === null, "vendu nul : pourcentages et repère inconnus");
  const html = documentBilanV3({ periode: P, bornes: BORNES, bandeau: B.bandeauV3({ synthese: syn }), synthese: syn, alertes: [] });
  ok(!/>0\s%</.test(html) && html.includes("—"), "vendu nul : « — » dans le PDF, jamais 0 %");
  const r2 = B.indexerRelevesV3([rel("a", "2026-10-15", { mo_prev: 2000, mat_prev: 1000, heures_vendues: 100 }),
    rel("a", "2026-10-22", { mo_prev: 2000, mat_prev: 1000, heures_vendues: 100, marge_probable: 1500 })]);
  const s2 = B.syntheseChantiersV3({ releves: r2, chantiers: [{ id: "a", nom: "A" }], bornes: BORNES, periode: P, baremeFG: [{ depuis: "2026-01-01", taux: 10 }] });
  // 10 000 − 2 000 − 1 000 − 100 h × 10 = 6 000 ; probable 1 500 → écart −4 500.
  ok(s2[0].margeDevis === 6000 && s2[0].margeDevisPct === 60 && s2[0].ecartDevis === -4500 && s2[0].eurParHeureDevis === 100, "marge devis, % du vendu, écart, repère du devis");
  // Chantier sans matériaux prévus : marge devis signalée, sans écart, hors total du bandeau.
  const r3 = B.indexerRelevesV3([rel("v", "2026-10-15", { mo_prev: 2000, mat_prev: 0, heures_vendues: 100 }),
    rel("v", "2026-10-22", { mo_prev: 2000, mat_prev: 0, heures_vendues: 100 })]);
  const s3 = B.syntheseChantiersV3({ releves: r3, chantiers: [{ id: "v", nom: "V" }], bornes: BORNES, periode: P });
  ok(s3[0].margeDevisSansMateriaux === true && s3[0].ecartDevis === null, "sans matériaux prévus : signalé, écart inconnu");
  const band = B.bandeauV3({ synthese: [...s2, ...s3] });
  ok(band.nbChantiersComparables === 1 && band.nbChantiersHorsComparaison === 1 && band.margeDevisTotale === 6000, "bandeau : chantier sans matériaux prévus hors total");
  ok(documentBilanV3({ periode: P, bornes: BORNES, bandeau: band, synthese: s3, alertes: [] }).includes("sans matériaux prévus"), "PDF : « sans matériaux prévus »");
}
{
  // Alertes : lot terminé en dérive absent de la direction, présent en détaillée ;
  // au plus 3 points par chantier, triés par montant.
  const a = (motif, impactMarge, extra = {}) => ({ motif, texte: `texte ${motif}`, probleme: `pb ${motif} ${impactMarge}`, impactMarge, heures: 5, ...extra });
  const lignes = [{ chantier_id: "c", nom: "C", alertes: [
    a(MOTIF_LOT_EN_DERIVE, -100, { avancementLot: 40 }),
    a(MOTIF_LOT_EN_DERIVE, -900, { avancementLot: 100 }),
    a(MOTIF_MARGE_PROBABLE_EN_BAISSE, -3000),
    a(MOTIF_HEURES_SANS_LOT, null),
    a(MOTIF_DEPASSEMENT_ENVELOPPE, -200, { euros: 200 }),
    a(MOTIF_DEPASSEMENT_ENVELOPPE, -800, { euros: 800 }),
    a(MOTIF_LOT_EN_DERIVE, -400, { avancementLot: 60 }),
  ] }];
  const dir = B.alertesBilanV3(lignes, { version: "direction" });
  eq(dir[0].items.map(i => i.impactMarge), [-3000, -800, -400], "direction : 3 points au plus, triés par montant");
  ok(dir[0].nbMasques === 1, "direction : le 4e point est compté, pas affiché");
  ok(!dir[0].items.some(i => i.motif === MOTIF_HEURES_SANS_LOT), "direction : heures sans lot en version détaillée");
  const det = B.alertesBilanV3(lignes, { version: "detaillee" });
  ok(det[0].items.length === 7 && det[0].items.some(i => i.impactMarge === -900), "détaillée : toutes les alertes, lot terminé compris");
  const htmlDir = documentBilanV3({ periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: lignes }, { detaillee: false });
  const htmlDet = documentBilanV3({ periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: lignes }, { detaillee: true });
  ok(!htmlDir.includes("pb lot_en_derive -900") && htmlDet.includes("pb lot_en_derive -900"), "lot terminé en dérive : absent de la direction, présent en détaillée");
  ok(!htmlDir.includes("pb depassement_enveloppe -200"), "petit dépassement d'enveloppe : version détaillée seulement");
  ok((htmlDet.match(/la dérive des lots est masquée/g) || []).length <= 1 && !htmlDir.includes("la dérive des lots est masquée"), "phrase des heures sans lot : une fois au plus");
  const w = B.alertesBilanV3([{ chantier_id: "d", nom: "D", alertes: [a(MOTIF_LOT_EN_DERIVE, -50, { avancementLot: 100 })] }], { version: "direction" });
  eq(w, [], "chantier dont tous les points sont des constats : absent de la direction");
}
{
  // Allègements : journées incomplètes et chantiers sans activité résumés en direction.
  const av = { nbNonValides: 0, nbJoursIncomplets: 3, lignes: [
    { nom: "A", nonValides: [], joursIncomplets: [{ date: "2026-10-20" }, { date: "2026-10-21" }] },
    { nom: "B", nonValides: [], joursIncomplets: [{ date: "2026-10-20" }] }],
    textes: ["3 journées incomplètes (A : lun. 20/10, mar. 21/10 ; B : lun. 20/10)"] };
  ok(/^3 journées incomplètes sur 2 chantiers/.test(B.resumeJourneesIncompletesV3(av)), "journées incomplètes : une ligne courte");
  eq(B.resumeSansActiviteV3([{ actif: false }, { actif: false }, { actif: true }]), "2 chantiers en cours sans activité sur la période", "sans activité : leur nombre");
  const d = { periode: P, bornes: BORNES, bandeau: {}, synthese: [], alertes: [], avertissements: av,
    ligneSansActivite: "Chantiers en cours sans activité : X, Y", resumeSansActivite: "2 chantiers en cours sans activité sur la période" };
  const dir = documentBilanV3(d, { detaillee: false });
  const det = documentBilanV3(d, { detaillee: true });
  ok(dir.includes("2 chantiers en cours sans activité") && !dir.includes("X, Y") && det.includes("X, Y"), "liste des chantiers sans activité : version détaillée seulement");
  ok(!dir.includes("mar. 21/10") && det.includes("mar. 21/10"), "détail des journées incomplètes : version détaillée seulement");
}

console.log(`verif-bilan-periode : ${n} contrôles OK (données fictives)`);
