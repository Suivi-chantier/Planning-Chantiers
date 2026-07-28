// scripts/verif-chantier-finance-fixtures.mjs — Banc de test étape 0b
//
// Trois chantiers synthétiques couvrant toutes les branches des formules
// (pointages + repli legacy, format tableau v1, extras, reprise, lots,
// orphelins, prix_total à 0, taux par défaut, chantier vide), avec des
// VALEURS ATTENDUES CALCULÉES À LA MAIN — indépendantes du module ET de la
// transcription de référence. On vérifie les trois voies deux à deux :
//   attendu (main) ≡ référence (transcription PhasageV2) ≡ module.
//
// Usage : node scripts/verif-chantier-finance-fixtures.mjs

import { computeChantierFinance } from "../src/chantierFinance.mjs";
import { referencePhasageV2 } from "./verif-chantier-finance.mjs";

const LOTS = [
  { id: "electricite", label: "Électricité", couleur: "#eab308" },
  { id: "plomberie",   label: "Plomberie",   couleur: "#06b6d4" },
];

// ─── Fixture A : pointages + repli legacy + extras + reprise + orphelin ──────
const A = {
  phasage: {
    chantier_id: "FIXA", chantier_nom: "Fixture A",
    prix_vendu: null,
    plan_travaux: { meta: {
      reprise_heures: 10, reprise_taux: 28,        // reprise = 280 €
      fg_taux_horaire: 3,
      marge_vendue_cible: 20, seuil_prime: 15, prime: 500,
      prix_vendu: 15600,                           // devis → écart = −600 €
    } },
    ouvrages: [
      { id: "o1", libelle: "Tableau élec", lot_id: "electricite", prix_ht: 10000, heures_devis: 100, cout_materiaux: 2000,
        taches: [
          { id: "t1", nom: "Câblage",  heures_estimees: 60, avancement: 50,  heures_reelles: 10, ouvriers: ["Marc"] },        // pointé : 12 h / 340 €
          { id: "t2", nom: "Finition", heures_estimees: 40, avancement: 100, heures_reelles: 5,  ouvriers: ["Marc", "Ali"] }, // legacy : 5 h / 5×30+5×25 = 275 €
        ] },
      { id: "o2", libelle: "Salle d'eau", lot_id: "plomberie", prix_ht: 5000, heures_devis: 50, cout_materiaux: 0,
        taches: [
          { id: "t3", nom: "Pose", avancement: 30, heures_reelles: [2, 3], ouvriers: [] },                                    // v1 tableau : 5 h / 0 € (aucun ouvrier)
        ] },
      { id: "o3", libelle: "Divers", lot_id: "inconnu", prix_ht: 0, heures_devis: 0, taches: [] },                            // orphelin, sans prix
    ],
  },
  pointages: [
    { tache_id: "t1", type_pointage: "tache",    heures: 8, taux_horaire: 30, ouvrier: "Marc", date: "2026-07-20" },
    { tache_id: "t1", type_pointage: "tache",    heures: 4, taux_horaire: 25, ouvrier: "Ali",  date: "2026-07-21" },
    { tache_id: null, type_pointage: "tache",    heures: 3, taux_horaire: 30, ouvrier: "Marc", date: "2026-07-19" }, // libre 90 €
    { tache_id: null, type_pointage: "indirect", heures: 2, taux_horaire: 25, ouvrier: "Ali",  date: "2026-07-18", motif_indirect: "Trajet (quote-part)" }, // 50 €
    { tache_id: null, type_pointage: "indirect", heures: 1, taux_horaire: 30, ouvrier: "Marc", date: "2026-07-17", motif_indirect: "Intempéries" },         // 30 €
  ],
  commandeLignes: [
    { id: "l1", libelle: "Placo",  prix_total: 1000 },
    { id: "l2", libelle: "Visserie", prix_total: 0, prix_unitaire: 10, quantite: 5 }, // repli PU×qté = 50
    { id: "l3", libelle: "Colle",  prix_total: null, prix_unitaire: 20, quantite: 2 }, // 40
  ],
  tauxHoraires: { Marc: 30, Ali: 25 },
  tauxMOPrev: 20,
  lots: LOTS,
};
const attenduA = {
  prixHTChantier: 15000,
  heuresVenduesChantier: 150,
  heuresReellesChantier: 22,            // 12 (t1) + 5 (t2) + 5 (t3)
  heuresReellesTotalChantier: 38,       // 22 + 3 libres + 3 indirects + 10 reprise
  coutMOChantier: 615,                  // 340 + 275 + 0
  coutMOTotalChantier: 1065,            // 615 + 90 + 80 + 280
  coutMatChantier: 1090,                // 1000 + 50 + 40
  commandesPrevChantier: 2000,
  moPrevChantier: 3000,                 // 150 × 20
  tauxMOPrevEff: 20,
  fgTauxHoraire: 3,
  fgChantier: 114,                      // 3 × 38
  margeChantier: 12731,                 // 15000 − 1065 − 1090 − 114
  margePctChantier: 12731 / 15000 * 100,
  avancementChantier: 57,               // (70×10000 + 30×5000) / 15000 = 56,67 → 57
  trajetHeures: 2, trajetCout: 50,
  indirectHeures: 1, indirectCout: 30,
  repriseHeures: 10, repriseCout: 280,
  lots: {
    electricite: { nbOuvrages: 1, heuresVendues: 100, heuresReelles: 17, avancement: 70, ratioDerive: (17 / 100) / 0.70 },
    plomberie:   { nbOuvrages: 1, heuresVendues: 50,  heuresReelles: 5,  avancement: 30, ratioDerive: (5 / 50) / 0.30 },
    _orphans:    { nbOuvrages: 1, heuresVendues: 0,   heuresReelles: 0,  avancement: 0,  ratioDerive: null },
  },
  ecartVendu: -600,
  warningsCodes: ["ouvrages_sans_prix", "ecart_vendu"], // FG réglé, marge >> seuil prime, pas de dérive > 1,15
  dernierPointage: "2026-07-21",
};

// ─── Fixture B : legacy pur (aucun pointage), taux MO par défaut ─────────────
const B = {
  phasage: {
    chantier_id: "FIXB", chantier_nom: "Fixture B",
    plan_travaux: { meta: {} },
    ouvrages: [
      { id: "o1", libelle: "Rénov pièce", lot_id: "ancien_lot_disparu", prix_ht: 8000, heures_devis: 80,
        taches: [
          { id: "t1", nom: "Peinture", avancement: 40, heures_reelles: "12.5", ouvriers: ["Marc"] }, // 12,5 × 30 = 375 €
          { id: "t2", nom: "Sol",      avancement: 0,  heures_reelles: null,   ouvriers: ["Ali"] },  // 0
        ] },
    ],
  },
  pointages: [],
  commandeLignes: [],
  tauxHoraires: { Marc: 30, Ali: 25 },
  tauxMOPrev: 0, // non réglé → défaut 25
  lots: LOTS,
};
const attenduB = {
  prixHTChantier: 8000,
  heuresVenduesChantier: 80,
  heuresReellesChantier: 12.5,
  heuresReellesTotalChantier: 12.5,
  coutMOChantier: 375,
  coutMOTotalChantier: 375,
  coutMatChantier: 0,
  commandesPrevChantier: 0,
  moPrevChantier: 2000,                 // 80 × 25 (défaut)
  tauxMOPrevEff: 25,
  fgTauxHoraire: 0,
  fgChantier: 0,
  margeChantier: 7625,
  margePctChantier: 7625 / 8000 * 100,
  avancementChantier: 20,               // pas d'heures estimées → moyenne simple (40+0)/2
  trajetHeures: 0, trajetCout: 0,
  indirectHeures: 0, indirectCout: 0,
  repriseHeures: 0, repriseCout: 0,
  lots: {
    electricite: { nbOuvrages: 0, heuresVendues: 0, heuresReelles: 0, avancement: 0, ratioDerive: null },
    plomberie:   { nbOuvrages: 0, heuresVendues: 0, heuresReelles: 0, avancement: 0, ratioDerive: null },
    _orphans:    { nbOuvrages: 1, heuresVendues: 80, heuresReelles: 12.5, avancement: 20, ratioDerive: (12.5 / 80) / 0.20 },
  },
  ecartVendu: null,
  warningsCodes: ["fg_non_regle"],
  dernierPointage: null,
};

// ─── Fixture C : chantier vide ───────────────────────────────────────────────
const C = {
  phasage: { chantier_id: "FIXC", chantier_nom: "Fixture C", plan_travaux: {}, ouvrages: [] },
  pointages: [], commandeLignes: [], tauxHoraires: {}, tauxMOPrev: 20, lots: LOTS,
};
const attenduC = {
  prixHTChantier: 0, heuresVenduesChantier: 0, heuresReellesChantier: 0,
  heuresReellesTotalChantier: 0, coutMOChantier: 0, coutMOTotalChantier: 0,
  coutMatChantier: 0, commandesPrevChantier: 0, moPrevChantier: 0, tauxMOPrevEff: 20,
  fgTauxHoraire: 0, fgChantier: 0, margeChantier: 0, margePctChantier: 0,
  avancementChantier: 0,
  trajetHeures: 0, trajetCout: 0, indirectHeures: 0, indirectCout: 0,
  repriseHeures: 0, repriseCout: 0,
  lots: {
    electricite: { nbOuvrages: 0, heuresVendues: 0, heuresReelles: 0, avancement: 0, ratioDerive: null },
    plomberie:   { nbOuvrages: 0, heuresVendues: 0, heuresReelles: 0, avancement: 0, ratioDerive: null },
  },
  ecartVendu: null,
  warningsCodes: ["fg_non_regle"],
  dernierPointage: null,
};

// ─── Assertions ──────────────────────────────────────────────────────────────
const EPS = 0.005;
let erreurs = 0;
const ko = (msg) => { erreurs++; console.log(`  ÉCART  ${msg}`); };
// toLocaleString("fr-FR") sépare les milliers par une espace fine insécable
// (U+202F) : on normalise toutes les espaces avant de comparer les chaînes.
const normEspaces = (s) => String(s).replace(/[\s  ]+/g, " ");
const eq = (label, attendu, obtenu) => {
  const ok = (attendu == null && obtenu == null) ||
    (typeof attendu === "number" && typeof obtenu === "number" && Math.abs(attendu - obtenu) <= EPS) ||
    attendu === obtenu ||
    (typeof attendu === "string" && typeof obtenu === "string" && normEspaces(attendu) === normEspaces(obtenu));
  if (!ok) ko(`${label} : attendu=${attendu} obtenu=${obtenu}`);
};

function verifier(nom, fixture, attendu) {
  console.log(`— ${nom}`);
  const ref = referencePhasageV2(fixture);
  const mod = computeChantierFinance(fixture);
  const b = mod.brut;

  const scalaires = [
    "prixHTChantier", "heuresVenduesChantier", "heuresReellesChantier",
    "heuresReellesTotalChantier", "coutMOChantier", "coutMOTotalChantier",
    "coutMatChantier", "commandesPrevChantier", "moPrevChantier", "tauxMOPrevEff",
    "fgTauxHoraire", "fgChantier", "margeChantier", "margePctChantier",
    "avancementChantier", "trajetHeures", "trajetCout", "indirectHeures",
    "indirectCout", "repriseHeures", "repriseCout",
  ];
  for (const k of scalaires) {
    eq(`${k} (main → référence)`, attendu[k], ref[k]);
    eq(`${k} (main → module)`,    attendu[k], b[k]);
  }
  eq("ecartVendu (module)", attendu.ecartVendu, b.ecartVendu);
  eq("dernierPointage (module)", attendu.dernierPointage, mod.fraicheur.dernierPointage);

  for (const [lotId, exp] of Object.entries(attendu.lots)) {
    const lm = mod.lots.find(l => l.id === lotId);
    if (!lm) { ko(`lot ${lotId} absent du module`); continue; }
    eq(`lot ${lotId}.nbOuvrages`, exp.nbOuvrages, lm.nbOuvrages);
    eq(`lot ${lotId}.heuresVendues`, exp.heuresVendues, lm.heuresVendues);
    eq(`lot ${lotId}.heuresReelles`, exp.heuresReelles, lm.heuresReelles);
    eq(`lot ${lotId}.avancement`, exp.avancement, lm.avancement);
    eq(`lot ${lotId}.ratioDerive`, exp.ratioDerive, lm.ratioDerive);
    // et contre la référence (lots configurés seulement)
    const lr = ref.lots.find(l => l.id === lotId);
    if (lr) {
      eq(`lot ${lotId}.avancement (référence)`, exp.avancement, lr.avancement);
      eq(`lot ${lotId}.heuresReelles (référence)`, exp.heuresReelles, lr.heuresReelles);
    }
  }

  const codes = mod.warnings.map(w => w.code).sort();
  const expCodes = [...attendu.warningsCodes].sort();
  if (JSON.stringify(codes) !== JSON.stringify(expCodes)) {
    ko(`warnings : attendu=[${expCodes}] obtenu=[${codes}]`);
  }
  // Chaque Donnee doit porter formule + calculDetaille non vides.
  for (const cle of ["venduHT", "moPrev", "matPrev", "moReel", "matReel", "fg", "marge", "heuresVendues", "heuresReelles", "avancement"]) {
    const d = mod[cle];
    if (!d || !d.formule || !d.calculDetaille) ko(`Donnee ${cle} : formule/calculDetaille manquant`);
    if (d && typeof d.renseigne !== "boolean") ko(`Donnee ${cle} : renseigne manquant`);
  }
}

// Ventilations de la fixture A : mêmes lignes que les modales kpiDetail.
function verifierVentilationsA() {
  console.log("— Fixture A · ventilations kpiDetail");
  const mod = computeChantierFinance(A);
  // vendu : 2 ouvrages valorisés, tri décroissant
  eq("vendu.rows.length", 2, mod.venduHT.ventilation.length);
  eq("vendu.rows[0].main", "Tableau élec", mod.venduHT.ventilation[0]?.main);
  eq("vendu.rows[0].right", "10 000 €", mod.venduHT.ventilation[0]?.right);
  eq("vendu.rows[0].sub", "Électricité", mod.venduHT.ventilation[0]?.sub);
  // heures : 2 ouvrages + ligne extras (6 h hors tâche)
  eq("heures.rows.length", 3, mod.heuresReelles.ventilation.length);
  eq("heures.extras.right", "6h / —", mod.heuresReelles.ventilation[2]?.right);
  eq("heures.total", "38h / 150h", mod.heuresReelles.totalTexte);
  // mo : Marc, Ali, reste legacy 275, trajets 50, indirect 30, libres 90
  const moMains = mod.moReel.ventilation.map(r => r.main);
  eq("mo.rows", JSON.stringify(["Marc", "Ali", "Heures sans pointage nominatif", "Trajets", "Heures indirectes", "Heures libres"]), JSON.stringify(moMains));
  eq("mo.rows[2].right", "275 €", mod.moReel.ventilation[2]?.right);
  // fg : 2 ouvrages avec heures + extras
  eq("fg.rows.length", 3, mod.fg.ventilation.length);
  eq("fg.rows[0].right", "51 €", mod.fg.ventilation[0]?.right); // 17 h × 3 €/h
  // marge : 4 postes
  eq("marge.rows.length", 4, mod.marge.ventilation.length);
  eq("marge.rows[0].right", "+ 15 000 €", mod.marge.ventilation[0]?.right);
  eq("marge.rows[1].right", "− 1 065 €", mod.marge.ventilation[1]?.right);
  // renseigne
  eq("fg.renseigne (A, taux réglé)", true, mod.fg.renseigne);
  const modB = computeChantierFinance(B);
  eq("fg.renseigne (B, taux absent)", false, modB.fg.renseigne);
  eq("fg.valeur (B) — 0 faute de réglage", 0, modB.fg.valeur);
  eq("ecartVendu.renseigne (B, pas de devis)", false, modB.ecartVendu.renseigne);
}

verifier("Fixture A (pointages + legacy + extras + reprise)", A, attenduA);
verifier("Fixture B (legacy sans pointage, taux défaut)", B, attenduB);
verifier("Fixture C (chantier vide)", C, attenduC);
verifierVentilationsA();

if (erreurs === 0) {
  console.log("\nOK — toutes les valeurs attendues (calculées à la main), la référence PhasageV2 et le module coïncident.");
  process.exit(0);
} else {
  console.log(`\n${erreurs} écart(s).`);
  process.exit(1);
}
