// Vérification de CR-6, partie 6D : outils de classement en masse.
//
// Exemple issu des tests, données fictives : chantiers, ouvrages, tâches,
// heures, lignes de commande, fournisseurs et lots sont inventés.
//
// Tâches hors devis anciennes (horsDevisV2.mjs) :
//   - rien n'est appliqué sans sélection ;
//   - seules les lignes cochées sont appliquées ;
//   - « Appliquer » = mêmes résultats que le classement unitaire (A :
//     pointages déplacés, pas de double production ; B sans heures normales
//     refusé ; C à arbitrer) ;
//   - « Tout laisser en l'état » sur un chantier repris : plus proposées,
//     heures et coûts inchangés ; refusé sur un chantier non repris ;
//   - propositions expliquées, avec niveau de confiance et chemin lot › ouvrage.
// Lignes de commande sans lot (lotsCommandesV1.mjs) :
//   - lot proposé par ouvrage / matériau / bon / libellé / fournisseur /
//     historique, avec explication ;
//   - aucune proposition inventée ;
//   - lot modifié à la main respecté ; rien sans sélection ; recalcul des
//     relevés par chantier depuis la plus ancienne date d'achat changée.
//
//   node scripts/verif-cr6-classement-masse.mjs
import assert from "node:assert/strict";
import {
  propositionsClassementMasseV2, planClassementMasseV2, refusLigneMasseV2, texteConfirmationMasseV2,
  laisserToutEnEtatV2, laisserEnEtatV2, reprendreClassementV2, syntheseHorsDevisChantierV2, estAClasserV2,
  reaffecterCasAV2, integrerCasBV2, aArbitrerV2, gesteCommercialV2, texteHorsDevisV2, couvertureNomsV2,
} from "../src/Renovation/horsDevisV2.mjs";
import {
  propositionsLotsSansLotV1, planAffectationLotsV1, texteConfirmationLotsV1, proposerLotLigneV1, indexerLignesAvecLotV1,
} from "../src/Renovation/lotsCommandesV1.mjs";
import { productionPeriode, resteACommanderEnveloppes, materiauxImputesALAvancement } from "../src/chantierFinance.mjs";

let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const egal = (a, b, msg) => { assert.deepEqual(a, b, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(a != null && Math.abs(a - b) < 0.01, `${msg} : ${a} ≠ ${b}`); nb++; };

// ═════════════════════════════ TÂCHES HORS DEVIS ═════════════════════════════
// Exemple issu des tests, données fictives.
const LOTS = [{ id: "cloisons", label: "Cloisons" }, { id: "peinture", label: "Peinture" }, { id: "plomberie", label: "Plomberie" }];
const phasage = () => [
  { id: "o-cloison", libelle: "Cloisons placo chambre", lot_id: "cloisons", prix_ht: 2000, heures_devis: 20, quantite: 10, bibliotheque_id: "b-cloison",
    taches: [
      { id: "t-rail", nom: "Pose des rails", heures_estimees: 8, avancement: 100 },
      { id: "t-bandes", nom: "Bandes chambre", heures_estimees: 12, avancement: 50 },
    ] },
  { id: "o-peinture", libelle: "Peinture séjour", lot_id: "peinture", prix_ht: 1000, heures_devis: 10, quantite: 30,
    taches: [{ id: "t-peint", nom: "Deux couches de peinture", heures_estimees: 10, avancement: 0 },
      { id: "t-hd-vendu", nom: "Retouche plafond séjour", hors_devis: true, avancement: 0 }] },
  { id: "o-divers", libelle: "Divers / hors devis", lot_id: null, prix_ht: null,
    taches: [
      { id: "t-hd-bandes", nom: "Bandes chambre", avancement: 100 },
      { id: "t-hd-niche", nom: "Création d'une niche salle de bain", avancement: 100 },
      { id: "t-hd-net", nom: "Nettoyage du chantier", avancement: 0 },
      { id: "t-hd-miroir", nom: "Pose des rails miroir", avancement: 100 },
      { id: "t-hd-client", nom: "Bloquer accès cave", nature: "demande_client", avancement: 100 },
      { id: "t-hd-geste", nom: "Petit service", hors_devis: true, motif_hd: "demande_client",
        arbitrage: { statut: "geste_commercial", le: "2026-10-01", par: "Conducteur fictif" } },
    ] },
];
const POINTAGES = [
  { tache_id: "t-rail", heures: 8, taux_horaire: 30, date: "2026-10-05" },
  { tache_id: "t-hd-bandes", heures: 3, taux_horaire: 30, date: "2026-10-08" },
  { tache_id: "t-hd-bandes", heures: 2, taux_horaire: 30, date: "2026-10-06" },
  { tache_id: "t-hd-niche", heures: 4, taux_horaire: 30, date: "2026-10-09" },
  { tache_id: "t-hd-net", heures: 1, taux_horaire: 30, date: "2026-10-09" },
  { tache_id: "t-hd-vendu", heures: 2, taux_horaire: 30, date: "2026-10-07" },
  { tache_id: "t-hd-geste", heures: 1, taux_horaire: 30, date: "2026-10-02" },
];
const BIBLIO = [];
const CTX = { date: "2026-10-26", auteur: "Conducteur fictif" };
const prop = (ouvrages = phasage()) => propositionsClassementMasseV2({ ouvrages, pointages: POINTAGES, tauxFG: 10, aujourdHui: "2026-10-26", lots: LOTS, bibliotheque: BIBLIO });
const ligne = (r, id) => r.lignes.find(l => l.tache_id === id);

// ── Propositions expliquées ─────────────────────────────────────────────────
{
  const r = prop();
  egal(r.lignes.map(l => l.tache_id).sort(), ["t-hd-bandes", "t-hd-client", "t-hd-miroir", "t-hd-net", "t-hd-niche", "t-hd-vendu"],
    "à classer : toutes les tâches hors devis sauf celle déjà arbitrée (geste commercial)");
  const a = ligne(r, "t-hd-bandes");
  ok(a.cas === "A" && a.cible.tache_id === "t-bandes", "A proposé vers la tâche existante au même nom");
  egal(a.cible.chemin, "Cloisons › Cloisons placo chambre", "A : chemin lot › ouvrage de la tâche proposée");
  egal(a.confiance, "eleve", "A : nom identique, seule tâche aussi proche → confiance élevée");
  ok(/ressemble à « Bandes chambre » \(Cloisons › Cloisons placo chambre\)/.test(a.explication), `A : explication (${a.explication})`);
  proche(a.heures, 5, "A : heures pointées de la tâche (2 + 3)");
  egal(a.premierJour, "2026-10-06", "A : premier jour déclaré");
  const m = ligne(r, "t-hd-miroir");
  ok(m.cas === "A" && m.confiance === "faible" && /« miroir » ne s'y retrouve pas/.test(m.explication),
    `A douteux : un mot manque → confiance faible, dit (${m.explication})`);
  egal(couvertureNomsV2("Pose des rails miroir", "Pose des rails"), 0.67, "couverture des mots : 2 sur 3");
  const c = ligne(r, "t-hd-niche");
  ok(c.cas === "C" && c.confiance === "faible" && /aucune tâche ressemblante/.test(c.explication), "C par défaut : à examiner, confiance faible");
  const cc = ligne(r, "t-hd-client");
  ok(cc.cas === "C" && cc.confiance === "eleve", "C déclaré (nature demande du client) : confiance élevée");
  const s = ligne(r, "t-hd-net");
  ok(s.standard && s.cas === null && s.choix === "laisser" && s.confiance === "moyen", "tâche standard : proposée « laisser en l'état »");
  const b = ligne(r, "t-hd-vendu");
  ok(b.cas === "B" && b.ouvrageB.id === "o-peinture" && b.confiance === "moyen", "B : déjà rangée dans un ouvrage vendu");
  ok(!b.applicable && /heures normales/.test(b.nonApplicable), "B sans heures normales proposées : non applicable, et dit pourquoi");
}

// ── Rien sans sélection ─────────────────────────────────────────────────────
{
  const ouv = phasage();
  const p = planClassementMasseV2({ ouvrages: ouv, selection: [], ...CTX });
  ok(p.etapes.length === 0 && p.ouvrages === ouv, "aucune sélection : aucune étape, phasage identique (même objet)");
  egal(p.compte, { A: 0, B: 0, C: 0, laisser: 0 }, "aucune sélection : rien compté");
  egal(texteConfirmationMasseV2(p.compte), "Aucune tâche sélectionnée", "aucune sélection : rien à confirmer");
}

// ── Seules les lignes cochées, mêmes résultats que l'unitaire ──────────────
{
  const ouv = phasage();
  const selection = [
    { tache_id: "t-hd-bandes", choix: "A", cible_id: "t-bandes", premierJour: "2026-10-06" },
    { tache_id: "t-hd-niche", choix: "C" },
    { tache_id: "t-hd-client", choix: "C" },
  ];
  const p = planClassementMasseV2({ ouvrages: ouv, selection, ...CTX });
  egal(p.compte, { A: 1, B: 0, C: 2, laisser: 0 }, "3 cochées : 1 A, 2 C");
  egal(texteConfirmationMasseV2(p.compte), "3 tâches : 1 A, 2 C — Appliquer", "récapitulatif avant écriture");
  // Même code que le classement unitaire, enchaîné
  const u1 = reaffecterCasAV2(ouv, "t-hd-bandes", "t-bandes");
  const u2 = aArbitrerV2(u1.ouvrages, "t-hd-niche", CTX);
  const u3 = aArbitrerV2(u2.ouvrages, "t-hd-client", CTX);
  egal(p.ouvrages, u3.ouvrages, "Appliquer = classement unitaire tâche par tâche (même phasage final)");
  egal(p.etapes[0].pointages, u1.pointages, "A : pointages déplacés comme en unitaire ({ de, vers })");
  egal(p.etapes[0].pointages, { de: "t-hd-bandes", vers: "t-bandes", ouvrageVers: "o-cloison" }, "A : de la tâche hors devis vers la tâche existante");
  proche(productionPeriode({ ouvrages: p.ouvrages }).valeur, productionPeriode({ ouvrages: ouv }).valeur, "A : production inchangée (pas de double production)");
  ok(!p.ouvrages.some(o => o.taches.some(t => t.id === "t-hd-bandes")), "A : la tâche hors devis quitte le phasage, aucune tâche créée");
  const niche = p.ouvrages.find(o => o.id === "o-divers").taches.find(t => t.id === "t-hd-niche");
  ok(niche.hors_devis === true && niche.arbitrage.statut === "a_arbitrer" && niche.arbitrage.par === "Conducteur fictif", "C : à arbitrer, daté, avec auteur");
  // Les tâches non cochées ne bougent pas
  const avantNet = ouv.find(o => o.id === "o-divers").taches.find(t => t.id === "t-hd-net");
  const apresNet = p.ouvrages.find(o => o.id === "o-divers").taches.find(t => t.id === "t-hd-net");
  egal(apresNet, avantNet, "non cochée : tâche standard inchangée");
  egal(p.ouvrages.find(o => o.id === "o-divers").taches.find(t => t.id === "t-hd-miroir"), ouv.find(o => o.id === "o-divers").taches.find(t => t.id === "t-hd-miroir"), "non cochée : A douteux inchangé");
  egal(p.recalculerDepuis, "2026-10-06", "relevé à recalculer depuis le premier jour déclaré de la tâche réaffectée");
  ok(p.etapes[1].recalculerDepuis === null, "C : pas de recalcul (comme en unitaire)");
}

// ── B : heures normales requises comme en unitaire ─────────────────────────
{
  const ouv = phasage();
  egal(refusLigneMasseV2(ouv, "t-hd-vendu", { choix: "B", ouvrage_id: "o-peinture", heures_normales: "" }),
    "heures normales manquantes : indiquez-les (comme pour « Classer »)", "B sans heures normales : refusé, et dit");
  const p = planClassementMasseV2({ ouvrages: ouv, ...CTX, selection: [
    { tache_id: "t-hd-vendu", choix: "B", ouvrage_id: "o-peinture", heures_normales: "" },
    { tache_id: "t-hd-niche", choix: "B", ouvrage_id: "o-cloison", heures_normales: 1.5, premierJour: "2026-10-09" },
  ] });
  egal(p.refusees.map(x => x.tache_id), ["t-hd-vendu"], "B sans heures : ligne écartée, les autres passent");
  egal(p.compte.B, 1, "B avec heures : appliqué");
  const u = integrerCasBV2(ouv, "t-hd-niche", "o-cloison", { heuresNormales: 1.5, ...CTX });
  egal(p.ouvrages, u.ouvrages, "B = intégration unitaire (ajoutée en cours, heures normales 1,5 h)");
  egal(refusLigneMasseV2(ouv, "t-hd-niche", { choix: "B", ouvrage_id: "o-divers", heures_normales: 2 }), "ouvrage vendu à choisir", "B vers « Divers » refusé");
  egal(refusLigneMasseV2(ouv, "t-hd-niche", { choix: "A", cible_id: null }), "tâche existante à choisir", "A sans tâche choisie refusé");
  egal(refusLigneMasseV2(ouv, "t-hd-niche", { choix: "A", cible_id: "t-hd-niche" }), "tâche existante à choisir", "A sur elle-même refusé");
}

// ── Laisser en l'état / Tout laisser en l'état (chantier repris) ───────────
{
  const ouv = phasage();
  egal(laisserToutEnEtatV2(ouv, { repris: null, ...CTX }).erreur, "chantier_non_repris", "« Tout laisser en l'état » refusé si le chantier n'est pas repris");
  const avant = syntheseHorsDevisChantierV2({ ouvrages: ouv, pointages: POINTAGES, tauxFG: 10, aujourdHui: "2026-10-26" });
  const r = laisserToutEnEtatV2(ouv, { repris: { le: "2026-09-01", par: "Loris (fictif)" }, ...CTX });
  egal(r.nb, 6, "chantier repris : les 6 tâches à classer sont laissées d'un clic");
  egal(prop(r.ouvrages).lignes.length, 0, "plus aucune tâche proposée au classement");
  const apres = syntheseHorsDevisChantierV2({ ouvrages: r.ouvrages, pointages: POINTAGES, tauxFG: 10, aujourdHui: "2026-10-26" });
  const somme = s => s.taches.reduce((x, t) => ({ h: x.h + t.heures, c: x.c + t.cout }), { h: 0, c: 0 });
  egal(somme(apres), somme(avant), "heures et coûts des tâches hors devis inchangés");
  egal(apres.parMotif.non_renseigne.nb, 0, "plus comptées « non classées »");
  egal(apres.aClasser.nb, 0, "plus comptées « à classer »");
  egal(apres.laissees, { nb: 6, heures: 12, cout: 480 }, "comptées « laissées en l'état » : 6 tâches, 12 h, 12 × 40 = 480 €");
  egal(apres.gestesCommerciaux, avant.gestesCommerciaux, "le geste commercial déjà arbitré n'est pas touché");
  proche(productionPeriode({ ouvrages: r.ouvrages }).valeur, productionPeriode({ ouvrages: ouv }).valeur, "production inchangée");
  const t = r.ouvrages.find(o => o.id === "o-divers").taches.find(x => x.id === "t-hd-niche");
  egal(t.laissee_en_etat, { le: "2026-10-26", par: "Conducteur fictif", raison: "chantier_repris" }, "marque datée, avec auteur et raison, dans la tâche");
  const sans = ({ laissee_en_etat, ...reste }) => reste;
  egal(sans(t), ouv.find(o => o.id === "o-divers").taches.find(x => x.id === "t-hd-niche"), "rien d'autre ne change dans la tâche");
  ok(/laissées en l'état 6 · 12 h/.test(texteHorsDevisV2(apres)), "fiche chantier : « laissées en l'état » affiché");
  // Une tâche créée après la décision reste à classer
  const plus = r.ouvrages.map(o => (o.id === "o-divers" ? { ...o, taches: [...o.taches, { id: "t-hd-new", nom: "Reprise enduit couloir neuf" }] } : o));
  egal(prop(plus).lignes.map(l => l.tache_id), ["t-hd-new"], "une tâche hors devis ajoutée après la décision reste proposée");
  // Réversible
  const repris = reprendreClassementV2(r.ouvrages);
  egal(prop(repris.ouvrages).lignes.length, 6, "« Reprendre le classement » : les tâches sont de nouveau proposées");
  // Laissée puis classée : n'est plus « laissée »
  const cl = gesteCommercialV2(r.ouvrages, "t-hd-niche", CTX).ouvrages;
  const s2 = syntheseHorsDevisChantierV2({ ouvrages: cl, pointages: POINTAGES, tauxFG: 10, aujourdHui: "2026-10-26" });
  ok(s2.laissees.nb === 5 && !s2.taches.find(x => x.tache_id === "t-hd-niche").laissee, "une tâche laissée puis classée n'est plus comptée « laissée »");
  // Ligne « laisser » (tâche standard) dans la sélection
  const p = planClassementMasseV2({ ouvrages: ouv, selection: [{ tache_id: "t-hd-net", choix: "laisser" }], ...CTX });
  ok(p.compte.laisser === 1 && !estAClasserV2(p.ouvrages.find(o => o.id === "o-divers").taches.find(x => x.id === "t-hd-net"), { libelle: "Divers / hors devis" }),
    "tâche standard laissée en l'état : n'est plus à classer");
  egal(laisserEnEtatV2(ouv, ["inconnue"], CTX).erreur, "tache_introuvable", "laisser une tâche inconnue : refusé");
}

// ═══════════════════════════ COMMANDES SANS LOT ══════════════════════════════
// Exemple issu des tests, données fictives.
const LOTS_C = [{ id: "plomberie", label: "Plomberie" }, { id: "electricite", label: "Électricité" }, { id: "cloisons", label: "Cloisons" }];
const PHASAGES = {
  ch1: [
    { id: "o-sdb", libelle: "Salle de bain", lot_id: "plomberie", cout_materiaux: 500, avancement: 0, taches: [],
      materiaux_liens: [{ materiau_id: "m-prevu" }] },
    { id: "o-elec", libelle: "Tableau électrique", lot_id: "electricite", cout_materiaux: 300, avancement: 0, taches: [] },
  ],
  ch2: [{ id: "o2", libelle: "Cloison", lot_id: "cloisons", cout_materiaux: 200, taches: [] }],
};
const L = (id, o) => ({ id, chantier_id: "ch1", lot_id: null, prix_total: 10, created_at: "2026-10-10T08:00:00Z", ...o });
const LIGNES = [
  // Lignes avec lot (historique)
  ...Array.from({ length: 12 }, (_, i) => L(`hist-tube-${i}`, { chantier_id: "ch2", lot_id: "plomberie", materiau_id: "m-tube", libelle: "Tube PER 16", fournisseur_nom: "Plombier SA" })),
  L("ch1-cable-1", { lot_id: "electricite", materiau_id: "m-cable", libelle: "Câble 3G1,5", fournisseur_nom: "ElecPro" }),
  L("ch1-cable-2", { lot_id: "electricite", materiau_id: "m-cable", libelle: "Câble 3G1,5", fournisseur_nom: "ElecPro" }),
  L("bon-a-1", { lot_id: "plomberie", commande_id: "bon-A", libelle: "Raccord laiton", fournisseur_nom: "Négoce" }),
  L("bon-a-2", { lot_id: "plomberie", commande_id: "bon-A", libelle: "Coude cuivre", fournisseur_nom: "Négoce" }),
  ...Array.from({ length: 3 }, (_, i) => L(`hist-colle-${i}`, { chantier_id: "ch2", lot_id: "cloisons", libelle: "Colle carreaux de plâtre", fournisseur_nom: `Divers ${i}` })),
  ...Array.from({ length: 4 }, (_, i) => L(`hist-four-${i}`, { lot_id: "electricite", libelle: `Article ${i}`, fournisseur_nom: "ElecPro" })),
  // Lignes sans lot à proposer
  L("x-ouvrage", { ouvrage_id: "o-sdb", libelle: "Mitigeur" }),
  L("x-prevu", { materiau_id: "m-prevu", libelle: "Receveur" }),
  L("x-cable", { materiau_id: "m-cable", libelle: "Couronne câble", prix_total: 40 }),
  L("x-tube", { materiau_id: "m-tube", libelle: "Tube", prix_total: 20, created_at: "2026-09-02T08:00:00Z" }),
  L("x-bon", { commande_id: "bon-A", libelle: "éco-contribution", prix_total: 0.05 }),
  L("x-libelle", { libelle: "Colle carreaux de plâtre", fournisseur_nom: "Inconnu" }),
  L("x-fournisseur", { libelle: "Gaine ICTA", fournisseur_nom: "ElecPro" }),
  L("x-rien", { chantier_id: "ch3", libelle: "Stationnement", prix_total: 75 }),
  L("x-manuel", { libelle: "Stationnement", chantier_id: "ch3", prix_total: 15 }),
  // Pas « sans lot » : pas de chantier
  L("x-sans-chantier", { chantier_id: null, libelle: "Stock dépôt" }),
];
{
  const r = propositionsLotsSansLotV1({ lignes: LIGNES, phasages: PHASAGES, lots: LOTS_C });
  const p = id => r.lignes.find(l => l.id === id)?.proposition;
  egal(r.lignes.map(l => l.id), ["x-ouvrage", "x-prevu", "x-cable", "x-tube", "x-bon", "x-libelle", "x-fournisseur", "x-rien", "x-manuel"],
    "liste : lignes rattachées à un chantier sans lot (même règle que la saisie), pas les lignes sans chantier");
  ok(p("x-ouvrage").lotId === "plomberie" && p("x-ouvrage").confiance === "eleve" && /ouvrage « Salle de bain » du lot Plomberie/.test(p("x-ouvrage").explication),
    `par l'ouvrage rattaché : élevée (${p("x-ouvrage").explication})`);
  ok(p("x-prevu").lotId === "plomberie" && p("x-prevu").confiance === "eleve" && /matériau prévu dans l'ouvrage « Salle de bain »/i.test(p("x-prevu").explication),
    "par le matériau prévu dans le phasage : élevée");
  ok(p("x-cable").lotId === "electricite" && p("x-cable").confiance === "eleve" && /même matériau que 2 commandes de ce chantier, lot Électricité/i.test(p("x-cable").explication),
    `par le même matériau sur ce chantier : élevée (${p("x-cable").explication})`);
  ok(p("x-tube").lotId === "plomberie" && /^Même matériau que 12 commandes du lot Plomberie \(autres chantiers\)/.test(p("x-tube").explication),
    `par le matériau ailleurs : « même matériau que 12 commandes du lot Plomberie » (${p("x-tube").explication})`);
  egal(p("x-tube").confiance, "moyen", "matériau ailleurs, avis net : moyenne");
  ok(p("x-bon").lotId === "plomberie" && p("x-bon").confiance === "moyen" && /les 2 autres lignes de ce bon/i.test(p("x-bon").explication),
    `par le même bon de commande : moyenne (${p("x-bon").explication})`);
  ok(p("x-libelle").lotId === "cloisons" && /même libellé que 3 commandes du lot Cloisons/i.test(p("x-libelle").explication),
    `par le libellé (${p("x-libelle").explication})`);
  egal(p("x-libelle").confiance, "faible", "libellé identique mais lot absent du phasage du chantier : confiance baissée d'un cran (moyenne → faible)");
  ok(/aucun ouvrage du lot Cloisons dans le phasage/.test(p("x-libelle").explication), "lot absent du phasage : dit");
  ok(p("x-fournisseur").lotId === "electricite" && p("x-fournisseur").confiance === "faible" && /ElecPro : 6 commandes sur 6 de ce chantier/.test(p("x-fournisseur").explication),
    `par le fournisseur : faible (${p("x-fournisseur").explication})`);
  ok(p("x-rien").lotId === null && p("x-rien").confiance === "aucune", "aucun indice : aucune proposition (pas de lot inventé)");
  ok(/chantier sans phasage/.test(p("x-rien").explication), "aucun indice : dit pourquoi");
  egal(r.resume.aucune, { nb: 2, montant: 90 }, "résumé : sans proposition, nombre et montant");
  egal(r.resume.total.nb, 9, "résumé : 9 lignes sans lot");

  // Historique du chantier
  const hist = [...Array.from({ length: 5 }, (_, i) => L(`h${i}`, { chantier_id: "ch9", lot_id: "plomberie", libelle: `Pièce ${i}` })),
    L("h-x", { chantier_id: "ch9", libelle: "Divers xyz" })];
  const ph = propositionsLotsSansLotV1({ lignes: hist, phasages: { ch9: [{ id: "o", lot_id: "plomberie", taches: [] }] }, lots: LOTS_C }).lignes[0].proposition;
  ok(ph.lotId === "plomberie" && ph.confiance === "faible" && /100 % des commandes de ce chantier \(5 sur 5\)/.test(ph.explication), `par l'historique du chantier : faible (${ph.explication})`);

  // Contradiction : un autre indice au moins « moyen » désigne un autre lot
  const contra = [...LIGNES, L("y", { materiau_id: "m-cable", commande_id: "bon-A", libelle: "Câble" })];
  const ix = indexerLignesAvecLotV1({ lignes: contra, lots: LOTS_C });
  const py = proposerLotLigneV1(contra[contra.length - 1], { index: ix, ouvrages: PHASAGES.ch1, lots: LOTS_C });
  ok(py.lotId === "electricite" && py.confiance === "moyen" && /mais les 2 autres lignes de ce bon/.test(py.explication),
    `indices contradictoires : confiance baissée et contradiction dite (${py.explication})`);

  // Plan d'écriture
  const vide = planAffectationLotsV1({ propositions: r.lignes, selection: [], lots: LOTS_C });
  ok(vide.updates.length === 0 && vide.recalculs.length === 0, "rien sans sélection : aucune écriture, aucun recalcul");
  egal(texteConfirmationLotsV1(vide, LOTS_C), "Aucune ligne sélectionnée", "rien sans sélection : rien à confirmer");
  const plan = planAffectationLotsV1({ propositions: r.lignes, lots: LOTS_C, selection: [
    { id: "x-cable", lot_id: "electricite" },
    { id: "x-tube", lot_id: "plomberie" },
    { id: "x-manuel", lot_id: "cloisons" },     // lot choisi à la main (aucune proposition)
    { id: "x-bon", lot_id: "electricite" },     // proposition (plomberie) remplacée à la main
    { id: "x-rien", lot_id: "" },               // cochée sans lot
  ] });
  egal(plan.updates.map(u => [u.id, u.lot_id]), [["x-cable", "electricite"], ["x-tube", "plomberie"], ["x-manuel", "cloisons"], ["x-bon", "electricite"]],
    "seules les lignes cochées, chacune avec le lot de la sélection");
  egal(plan.updates.filter(u => u.manuel).map(u => u.id), ["x-manuel", "x-bon"], "lot modifié à la main : respecté (et signalé)");
  egal(plan.refusees, [{ id: "x-rien", raison: "lot à choisir" }], "cochée sans lot : refusée, et dit");
  ok(!plan.updates.some(u => ["x-ouvrage", "x-prevu", "x-libelle"].includes(u.id)), "non cochées : non écrites");
  egal(plan.recalculs, [{ chantierId: "ch1", date: "2026-09-02" }, { chantierId: "ch3", date: "2026-10-10" }],
    "relevés à recalculer : un par chantier, depuis la plus ancienne date d'achat changée");
  egal(texteConfirmationLotsV1(plan, LOTS_C), "4 lignes : 2 Électricité, 1 Plomberie, 1 Cloisons — Appliquer", "récapitulatif avant écriture");
  egal(planAffectationLotsV1({ propositions: r.lignes, lots: LOTS_C, selection: [{ id: "hist-tube-0", lot_id: "plomberie" }] }).refusees[0].raison,
    "ligne qui n'est plus « sans lot » (rechargez la page)", "ligne déjà rattachée : non réécrite");
  egal(planAffectationLotsV1({ propositions: r.lignes, lots: LOTS_C, selection: [{ id: "x-cable", lot_id: "lot-supprime" }] }).refusees[0].raison,
    "lot inconnu", "lot inconnu : refusé");

  // Conséquence d'un lot posé : reste à commander par lot et matériaux imputés
  const ouvr = PHASAGES.ch1;
  const lignesCh1 = LIGNES.filter(l => l.chantier_id === "ch1");
  const avantR = resteACommanderEnveloppes({ ouvrages: ouvr, commandeLignes: lignesCh1, lots: LOTS_C });
  const apresLignes = lignesCh1.map(l => (l.id === "x-cable" ? { ...l, lot_id: "electricite" } : l));
  const apresR = resteACommanderEnveloppes({ ouvrages: ouvr, commandeLignes: apresLignes, lots: LOTS_C });
  const elec = x => x.lots.find(l => l.lotId === "electricite");
  proche(elec(apresR).commandes - elec(avantR).commandes, 40, "lot posé : les 40 € passent dans les commandes du lot Électricité");
  proche(avantR.commandesSansLot - apresR.commandesSansLot, 40, "lot posé : 40 € de moins « sans lot »");
  const imp = l => materiauxImputesALAvancement({ ouvrages: ouvr, commandeLignes: l, lots: LOTS_C });
  ok(imp(apresLignes).enAvance >= imp(lignesCh1).enAvance, "lot posé : un achat dans l'enveloppe d'un lot peu avancé peut passer « en avance » (imputé plus tard)");
}

console.log(`verif-cr6-classement-masse : ${nb} contrôles OK (exemple issu des tests, données fictives)`);
