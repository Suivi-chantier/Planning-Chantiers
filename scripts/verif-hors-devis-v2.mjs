// Vérification de l'étape 4 (refonte) : tâches hors devis — réaffecter (A),
// intégrer (B) ou arbitrer (C).
//
// Exemple issu des tests, données fictives : chantiers, ouvrages, tâches,
// heures, taux et prix sont inventés pour le calcul.
//
//   - cas A réaffecté : pas de nouvelle tâche, pas de double production ;
//   - cas B avec 1 h normale et 3 h réelles : le poids reste 1 h, les heures
//     prévues de l'ouvrage ne bougent pas, la dérive reste visible ;
//   - cas C passé en avenant avec une date dans une semaine déjà exportée :
//     ligne « Rectifications » ;
//   - cas C passé en geste commercial : coût sans production, total affiché ;
//   - rappel d'arbitrage au-delà de 3 semaines ;
//   - tâche souvent ajoutée proposée dans la bibliothèque ;
//   - en plus : tâches probables, heures normales de la bibliothèque, motif
//     proposé automatiquement, création depuis la validation.
//
//   node scripts/verif-hors-devis-v2.mjs
import assert from "node:assert/strict";
import {
  tachesProbablesV2, heuresNormalesProposeesV2, champsCasV2, reaffecterCasAV2, integrerCasBV2,
  aArbitrerV2, gesteCommercialV2, rattacherAvenantV2, marquerNonFactureV2, syntheseHorsDevisChantierV2,
  decisionsHorsDevisV2, gestesCommerciauxPeriodeV2, tachesSouventAjouteesV2, ajouterEtapeModeleV2,
  proposerMotifV2, motifTacheV2, estTacheHorsDevisV2, ressemblanceNomsV2, MOTIF_NON_RENSEIGNE,
} from "../src/Renovation/horsDevisV2.mjs";
import {
  productionPeriode, avancementOuvrageExact, heuresReellesComparablesOuvrage, heuresVenduesOuvrage,
} from "../src/chantierFinance.mjs";
import { tacheCreeeEnValidation, appliquerCreationsProposees } from "../src/Renovation/lignesValidation.mjs";
import { rectificationsV3 } from "../src/Renovation/bilanArchiveV3.mjs";
import { indexerRelevesV3 } from "../src/Renovation/bilanPeriodeV3.mjs";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const egal = (a, b, msg) => { assert.deepEqual(a, b, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(a != null && Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`); nb++; };

// ── Phasage fictif ───────────────────────────────────────────────────────────
const phasage = () => [
  { id: "o-cloison", libelle: "Cloisons placo chambre", lot_id: "cloisons", prix_ht: 2000, heures_devis: 20, quantite: 10, bibliotheque_id: "b-cloison",
    taches: [
      { id: "t-rail", nom: "Pose des rails", heures_estimees: 8, avancement: 100 },
      { id: "t-plaque", nom: "Plaquage des plaques", heures_estimees: 12, avancement: 50 },
    ] },
  { id: "o-peinture", libelle: "Peinture séjour", lot_id: "peinture", prix_ht: 1000, heures_devis: 10, quantite: 30,
    taches: [{ id: "t-peint", nom: "Deux couches de peinture", heures_estimees: 10, avancement: 0 }] },
  { id: "o-divers", libelle: "Divers / hors devis", lot_id: null, prix_ht: null, heures_devis: null,
    taches: [
      { id: "t-hd-plaq", nom: "plaquage chambre", heures_estimees: null, avancement: 100, _cree_depuis_validation: true },
      { id: "t-hd-niche", nom: "Création d'une niche salle de bain", heures_estimees: null, avancement: 100, _cree_depuis_validation: true },
      { id: "t-hd-net", nom: "Nettoyage du chantier", heures_estimees: null, avancement: 0 },
    ] },
];
const BIBLIO = [{ id: "b-cloison", libelle: "Cloison placo", unite: "m²", cadence: 2, sous_taches: [
  { nom: "Pose des rails", ratio: 40 }, { nom: "Plaquage", ratio: 50 }, { nom: "Bandes", ratio: 10 },
] }];

// ── Cas A : réaffectation ───────────────────────────────────────────────────
{
  const ouv = phasage();
  const probables = tachesProbablesV2({ nom: "plaquage chambre", ouvrages: ouv, lotId: "cloisons", tachesPrevuesJour: ["t-plaque"] });
  egal(probables[0].tache_id, "t-plaque", "A : la tâche prévue ce jour-là au nom proche arrive en tête");
  ok(probables[0].raisons.includes("prévue ce jour-là") && probables[0].raisons.includes("même lot"), "A : raisons affichées");
  ok(!probables.some(p => p.tache_id.startsWith("t-hd")), "A : les tâches hors devis ne sont jamais proposées");

  const avant = productionPeriode({ ouvrages: ouv });
  const r = reaffecterCasAV2(ouv, "t-hd-plaq", "t-plaque");
  egal(r.pointages, { de: "t-hd-plaq", vers: "t-plaque", ouvrageVers: "o-cloison" }, "A : pointages à réaffecter");
  const nbAvant = ouv.reduce((s, o) => s + o.taches.length, 0);
  const nbApres = r.ouvrages.reduce((s, o) => s + o.taches.length, 0);
  egal(nbApres, nbAvant - 1, "A : aucune tâche créée, la tâche hors devis disparaît");
  const apres = productionPeriode({ ouvrages: r.ouvrages });
  proche(apres.valeur, avant.valeur, "A : production inchangée (pas de double production)");
  ok(r.ouvrages.find(o => o.id === "o-cloison").taches.length === 2, "A : l'ouvrage cible garde ses tâches");
  egal(reaffecterCasAV2(ouv, "t-hd-plaq", "t-hd-plaq").erreur, "cible_introuvable", "A : pas de réaffectation sur elle-même");
}

// ── Cas B : 1 h normale, 3 h réelles ────────────────────────────────────────
{
  const ouv = phasage();
  const pointages = [
    { tache_id: "t-rail", heures: 8, taux_horaire: 30, date: "2026-10-12" },
    { tache_id: "t-plaque", heures: 6, taux_horaire: 30, date: "2026-10-13" },
    { tache_id: "t-hd-niche", heures: 3, taux_horaire: 30, date: "2026-10-14" },
  ];
  const ppt = {};
  pointages.forEach(p => { (ppt[p.tache_id] = ppt[p.tache_id] || []).push(p); });
  const oAvant = ouv.find(o => o.id === "o-cloison");
  const r = integrerCasBV2(ouv, "t-hd-niche", "o-cloison", { heuresNormales: 1, date: "2026-10-20", auteur: "Conducteur fictif" });
  const o = r.ouvrages.find(x => x.id === "o-cloison");
  const t = o.taches.find(x => x.id === "t-hd-niche");
  egal(t.heures_estimees, 1, "B : le poids est l'heure NORMALE (1 h), pas les 3 h réelles");
  ok(t.ajoutee_en_cours === true && t.ajoutee_le === "2026-10-20" && t.ajoutee_par === "Conducteur fictif", "B : marquée « ajoutée en cours de chantier », datée, avec auteur");
  ok(t.hors_devis === false && motifTacheV2(t) === "imprevu", "B : comptée dans l'ouvrage, motif imprévu");
  egal(heuresVenduesOuvrage(o), heuresVenduesOuvrage(oAvant), "B : heures prévues de l'ouvrage inchangées");
  proche(avancementOuvrageExact(o), (8 * 100 + 12 * 50 + 1 * 100) / 21, "B : avancement pondéré par 1 h normale");
  proche(heuresReellesComparablesOuvrage(o, ppt), 17, "B : les 3 h réelles comptent dans les heures comparées (dérive visible)");
  ok(!r.ouvrages.find(x => x.id === "o-divers").taches.some(x => x.id === "t-hd-niche"), "B : la tâche a quitté « Divers »");
  egal(integrerCasBV2(ouv, "t-hd-niche", "o-cloison", { heuresNormales: 0 }).erreur, "heures_normales", "B : heures normales obligatoires");
  egal(integrerCasBV2(ouv, "t-hd-niche", "o-divers", { heuresNormales: 1 }).erreur, "ouvrage_divers", "B : jamais dans « Divers »");

  const hn = heuresNormalesProposeesV2({ nom: "Plaquage salle de bain", ouvrage: oAvant, bibliotheque: BIBLIO });
  egal(hn.heures, 10, "B : bibliothèque = 2 h/m² × 10 × 50 %");
  egal(heuresNormalesProposeesV2({ nom: "Carottage mur porteur", ouvrage: oAvant, bibliotheque: BIBLIO }), null, "B : sans étape ressemblante, rien n'est proposé");
}

// ── Cas C : avenant dans une semaine déjà exportée → Rectifications ────────
{
  // Semaine exportée : du 12/10 (départ) au 16/10 (fin). La tâche « niche »
  // (hors devis, à arbitrer) a été déclarée terminée le 14/10.
  let ouv = aArbitrerV2(phasage(), "t-hd-niche", { date: "2026-10-14", auteur: "Conducteur fictif" }).ouvrages;
  const journal = [
    { tache_id: "t-hd-niche", avancement_avant: 0, avancement_apres: 100, date_realisation: "2026-10-14", created_at: "2026-10-14T18:00:00Z", source: "validation_cr", chantier_id: "C1" },
  ];
  const prodAvant = productionPeriode({ ouvrages: ouv, journal, du: "2026-10-12", au: "2026-10-16" });
  // Avenant signé le 22/10 : ouvrage chiffré 600 €.
  ouv = [...ouv, { id: "o-avenant", libelle: "Avenant 1 : niche salle de bain", lot_id: "cloisons", prix_ht: 600, heures_devis: 2, taches: [] }];
  const r = rattacherAvenantV2(ouv, "t-hd-niche", "o-avenant", { date: "2026-10-22", auteur: "Conducteur fictif", joursDeclares: ["2026-10-13", "2026-10-14"] });
  egal(r.dernierJourDeclare, "2026-10-14", "C→avenant : date de réalisation = dernier jour déclaré");
  egal(r.recalculerDepuis, "2026-10-13", "C→avenant : relevés recalculés depuis le premier jour déclaré");
  const t = r.ouvrages.find(o => o.id === "o-avenant").taches[0];
  ok(t.hors_devis === false && t.arbitrage.statut === "avenant" && t.arbitrage.ouvrage_avenant_id === "o-avenant", "C→avenant : rattachée, statut avenant");
  const prodApres = productionPeriode({ ouvrages: r.ouvrages, journal, du: "2026-10-12", au: "2026-10-16" });
  proche(prodApres.valeur - prodAvant.valeur, 600, "C→avenant : 600 € produits dans la semaine du 14/10");
  // Bilan figé de cette semaine, puis relevés recalculés après le rattachement.
  const archive = { periode_cle: "S:2026-W42", periode_libelle: "Semaine 42", periode_fin: "2026-10-18", date_depart: "2026-10-12", date_fin: "2026-10-16",
    exporte_le: "2026-10-17T08:00:00Z", chiffres: { chantiers: [{ chantierId: "C1", nom: "Chantier fictif", margePeriode: 100 }] } };
  const releves = indexerRelevesV3([
    { chantier_id: "C1", date_releve: "2026-10-12", marge_avancement: 1000 },
    { chantier_id: "C1", date_releve: "2026-10-16", marge_avancement: 1700 },
  ]);
  const rect = rectificationsV3({ archives: [archive], releves, periode: { debut: "2026-10-26", fin: "2026-11-01" } });
  egal(rect.length, 1, "C→avenant : une ligne « Rectifications »");
  proche(rect[0].montant, 600, "C→avenant : rectification de 600 € sur la semaine exportée");
  egal(rattacherAvenantV2(ouv, "t-hd-niche", "o-peinture-inconnu").erreur, "ouvrage_introuvable", "C→avenant : ouvrage inconnu refusé");
  const sansPrix = [...phasage(), { id: "o-av0", libelle: "Avenant vide", prix_ht: 0, taches: [] }];
  egal(rattacherAvenantV2(sansPrix, "t-hd-niche", "o-av0").erreur, "avenant_sans_prix", "C→avenant : un avenant sans prix est refusé");
}

// ── Cas C : geste commercial ────────────────────────────────────────────────
{
  const ouv = gesteCommercialV2(phasage(), "t-hd-niche", { date: "2026-10-20", auteur: "Conducteur fictif" }).ouvrages;
  const t = ouv.find(o => o.id === "o-divers").taches.find(x => x.id === "t-hd-niche");
  ok(t.hors_devis === true && t.arbitrage.statut === "geste_commercial", "geste : reste hors devis, statut geste commercial");
  const prod = productionPeriode({ ouvrages: ouv });
  proche(prod.valeur, productionPeriode({ ouvrages: phasage() }).valeur, "geste : aucune production");
  const pointages = [
    { tache_id: "t-hd-niche", heures: 4, taux_horaire: 30, date: "2026-10-14" },
    { tache_id: "t-hd-niche", heures: 2, taux_horaire: 30, date: "2026-10-21" },
  ];
  const s = syntheseHorsDevisChantierV2({ ouvrages: ouv, pointages, tauxFG: 10, aujourdHui: "2026-10-24" });
  egal(s.gestesCommerciaux, { nb: 1, heures: 6, cout: 240 }, "geste : total du chantier = 6 h, 6 × (30 + 10) = 240 €");
  const g = gestesCommerciauxPeriodeV2({ ouvragesParChantier: [{ chantierId: "C1", ouvrages: ouv }], pointages, periode: { debut: "2026-10-19", fin: "2026-10-25" }, tauxFG: 10 });
  egal({ heures: g.heures, cout: g.cout }, { heures: 2, cout: 80 }, "geste : total de la période (bandeau détaillé)");
  const nf = marquerNonFactureV2([{ id: "o-x", prix_ht: 0, taches: [] }], "o-x");
  ok(nf.ouvrages[0].non_facture === true, "ouvrage à prix 0 marqué « non facturé »");
  egal(marquerNonFactureV2([{ id: "o-y", prix_ht: 500, taches: [] }], "o-y").erreur, "ouvrage_avec_prix", "un ouvrage avec un prix ne peut pas être « non facturé »");
}

// ── Rappel d'arbitrage au-delà de 3 semaines ───────────────────────────────
{
  let ouv = aArbitrerV2(phasage(), "t-hd-niche", { date: "2026-09-25", auteur: "Conducteur fictif" }).ouvrages;
  ouv = aArbitrerV2(ouv, "t-hd-plaq", { date: "2026-10-20", auteur: "Conducteur fictif" }).ouvrages;
  const pointages = [
    { tache_id: "t-hd-niche", heures: 8, taux_horaire: 30, date: "2026-09-25" },
    { tache_id: "t-hd-plaq", heures: 4, taux_horaire: 30, date: "2026-10-20" },
  ];
  const s = syntheseHorsDevisChantierV2({ ouvrages: ouv, pointages, tauxFG: 15, aujourdHui: "2026-10-24" });
  egal(s.aArbitrer, { nb: 2, heures: 12, cout: 540 }, "arbitrage : 2 tâches, 12 h, 12 × 45 = 540 €");
  egal(s.rappels, 1, "rappel : seule la tâche à arbitrer depuis le 25/09 (> 3 semaines)");
  ok(s.taches.find(t => t.tache_id === "t-hd-niche").rappel && !s.taches.find(t => t.tache_id === "t-hd-plaq").rappel, "rappel : par tâche");
  const d = decisionsHorsDevisV2({ chantiers: [{ chantierId: "C1", nom: "KATHLEEN fictif", synthese: s }] });
  egal(d.length, 1, "décisions : une décision par chantier");
  ok(d[0].titre.startsWith("KATHLEEN fictif : 2 tâches hors devis à arbitrer, 12 h, environ 540 €"), `décisions : titre en clair (${d[0].titre})`);
  ok(d[0].rappel && /depuis plus de 3 semaines/.test(d[0].detail), "décisions : rappel au-delà de 3 semaines");
  const s5 = syntheseHorsDevisChantierV2({ ouvrages: ouv, pointages, tauxFG: 15, aujourdHui: "2026-10-24", semainesRappel: 5 });
  egal(s5.rappels, 0, "rappel : seuil réglable (5 semaines → aucun rappel)");
  egal(decisionsHorsDevisV2({ chantiers: [{ chantierId: "C2", nom: "Sans hors devis", synthese: syntheseHorsDevisChantierV2({ ouvrages: [], aujourdHui: "2026-10-24" }) }] }).length, 0,
    "décisions : rien quand aucune tâche n'est à arbitrer");
}

// ── Tâche souvent ajoutée proposée dans la bibliothèque ────────────────────
{
  const ajout = (id, nom) => ({ id, nom, ajoutee_en_cours: true, heures_estimees: 1, avancement: 0 });
  const phasages = [
    { chantier_id: "C1", ouvrages: [{ id: "a", bibliotheque_id: "b-cloison", taches: [ajout("x1", "Renfort pour meuble vasque")] }] },
    { chantier_id: "C2", ouvrages: [{ id: "b", bibliotheque_id: "b-cloison", taches: [ajout("x2", "Renforts meuble vasque"), ajout("x3", "Plaquage")] }] },
    { chantier_id: "C3", ouvrages: [{ id: "c", bibliotheque_id: "b-cloison", taches: [ajout("x4", "Trappe de visite")] }] },
    { chantier_id: "REPRIS", ouvrages: [{ id: "d", bibliotheque_id: "b-cloison", taches: [ajout("x5", "Trappe de visite")] }] },
  ];
  const m = tachesSouventAjouteesV2({ phasages, exclus: ["REPRIS"], bibliotheque: BIBLIO });
  const l = m.get("b-cloison") || [];
  egal(l.map(x => [x.nom, x.nbChantiers]), [["Renfort pour meuble vasque", 2]], "bibliothèque : ajoutée sur 2 chantiers → proposée ; chantier repris exclu ; déjà au modèle → non proposée");
  const etapes = ajouterEtapeModeleV2(BIBLIO[0].sous_taches, "Renfort pour meuble vasque");
  egal(etapes.length, 4, "bibliothèque : l'étape est ajoutée au modèle");
  egal(etapes[3].ratio, 0, "bibliothèque : ratio 0 % (la répartition existante ne bouge pas)");
  egal(ajouterEtapeModeleV2(etapes, "Renfort pour meuble vasque").length, 4, "bibliothèque : pas d'ajout en double");
}

// ── Motif proposé automatiquement (reprise du passé) ───────────────────────
{
  const ouv = phasage();
  const div = ouv.find(o => o.id === "o-divers");
  const p = id => proposerMotifV2({ tache: div.taches.find(t => t.id === id), ouvrage: div, ouvrages: ouv });
  egal(p("t-hd-plaq").cas, "A", "motif : « plaquage chambre » ressemble à une tâche existante → A");
  egal(p("t-hd-niche").cas, "C", "motif : travail sans tâche ressemblante, hors ouvrage vendu → C");
  egal(p("t-hd-net").cas, null, "motif : nettoyage = tâche standard, ni A, ni B, ni C");
  egal(motifTacheV2({}), MOTIF_NON_RENSEIGNE, "motif : une tâche existante est « non renseignée »");
  ok(estTacheHorsDevisV2(div.taches[0], div) && !estTacheHorsDevisV2(ouv[0].taches[0], ouv[0]), "hors devis : Divers oui, tâche du devis non");
  ok(ressemblanceNomsV2("Plaquage chambre", "plaquage des plaques chambre") >= 0.6, "ressemblance : mots proches");
}

// ── Création depuis la validation (cas B et C) ─────────────────────────────
{
  const tB = tacheCreeeEnValidation({ id: "n1", nom: "Niche", cas: "B", heuresNormales: 1.5, date: "2026-10-20", auteur: "Conducteur fictif", ouvrier: "Ouvrier fictif", rapportId: "r1" });
  ok(tB.ajoutee_en_cours === true && tB.heures_estimees === 1.5 && tB.hors_devis === false && tB.motif_hd === "imprevu", "validation B : tâche ajoutée en cours, 1,5 h normales");
  const tC = tacheCreeeEnValidation({ id: "n2", nom: "Étagère client", cas: "C", date: "2026-10-20", auteur: "Conducteur fictif" });
  ok(tC.hors_devis === true && tC.arbitrage.statut === "a_arbitrer" && tC.arbitrage.le === "2026-10-20", "validation C : hors devis, à arbitrer");
  const tSans = tacheCreeeEnValidation({ id: "n3", nom: "Ancienne création", nature: "imprevu", hors_devis: true });
  ok(tSans.hors_devis === true && tSans.motif_hd === undefined && tSans.ajoutee_en_cours === undefined, "validation sans cas : comportement d'avant inchangé");
  const lignes = [{ rowId: "o0", origineIdx: 0, planifie: "Niche", proposition: { ouvrage_id: "o-cloison" },
    creation: { nom: "Niche", ouvrage_id: "o-cloison", cas: "B", heures_normales: "" } }];
  const res = appliquerCreationsProposees({ ouvrages: phasage(), lignes, rapport: { id: "r1", ouvrier: "Ouvrier fictif", date_rapport: "20/10/2026" }, genId: () => "g", auteur: "Conducteur fictif" });
  egal(res.erreurs.map(e => e.code), ["heures_normales"], "validation B : heures normales manquantes → validation refusée");
  lignes[0].creation.heures_normales = "2";
  const res2 = appliquerCreationsProposees({ ouvrages: phasage(), lignes, rapport: { id: "r1", ouvrier: "Ouvrier fictif", date_rapport: "20/10/2026" }, genId: () => "g", auteur: "Conducteur fictif" });
  const cree = res2.ouvrages.find(o => o.id === "o-cloison").taches.find(t => t.id === "nt-r1-0");
  ok(cree && cree.heures_estimees === 2 && cree.ajoutee_le === "2026-10-20" && cree.ajoutee_par === "Conducteur fictif", "validation B : créée dans l'ouvrage, datée du jour du rapport");
  const lignesC = [{ rowId: "o0", origineIdx: 0, planifie: "Étagère", proposition: {}, creation: { nom: "Étagère", ouvrage_id: "o-cloison", cas: "C" } }];
  const res3 = appliquerCreationsProposees({ ouvrages: phasage(), lignes: lignesC, rapport: { id: "r2", date_rapport: "21/10/2026" }, genId: () => "g", auteur: "Conducteur fictif" });
  ok(res3.ouvrages.find(o => o.id === "o-divers").taches.some(t => t.id === "nt-r2-0" && t.arbitrage?.statut === "a_arbitrer"),
    "validation C : toujours rangée dans « Divers / hors devis », à arbitrer");
}

console.log(`verif-hors-devis-v2 : ${nb} contrôles OK (données fictives)`);
