// Vérification de l'étape 1B (refonte du Bilan semaine) : nature des coûts
// et reste à commander par ENVELOPPE de lot.
//
// Exemple issu des tests, données fictives : chantier, lots, montants et
// fournisseurs sont inventés pour le calcul.
//
//   node scripts/verif-enveloppes-lots.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resteACommanderEnveloppes, computeChantierFinance, coutsParNature, natureLigne,
  NATURES_COUT, METHODE_CALCUL, LOT_SANS_LOT,
} from "../src/chantierFinance.mjs";
import { lignesChantierSansLot, messageLotObligatoire, natureSaisie } from "../src/Renovation/saisieLotNature.mjs";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (rel) => readFileSync(resolve(racine, rel), "utf8");
let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(Math.abs(a - b) < 0.005, `${msg} : ${a} ≠ ${b}`); nb++; };

const LOTS = [{ id: "plomberie", label: "Plomberie" }, { id: "electricite", label: "Électricité" }, { id: "peinture", label: "Peinture" }];
const ouvrages = [
  { id: "o1", lot_id: "plomberie",   prix_ht: 6000, cout_materiaux: 1500, heures_devis: 20, taches: [{ id: "t1", avancement: 50, heures_estimees: 20 }] },
  { id: "o2", lot_id: "plomberie",   prix_ht: 2000, cout_materiaux: 500,  heures_devis: 10, taches: [{ id: "t2", avancement: 0, heures_estimees: 10 }] },
  { id: "o3", lot_id: "electricite", prix_ht: 4000, cout_materiaux: 800,  heures_devis: 15, taches: [{ id: "t3", avancement: 0, heures_estimees: 15 }] },
  { id: "o4", lot_id: "peinture",    prix_ht: 3000, cout_materiaux: 600,  heures_devis: 12, taches: [{ id: "t4", avancement: 0, heures_estimees: 12 }] },
];
const ligne = (prix_total, lot_id, extra = {}) => ({ id: `l${Math.random()}`, prix_total, lot_id, ...extra });

// ── 1. Cas de base : enveloppes, commandes matériaux par lot ────────────────
{
  const r = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [
    ligne(1200, "plomberie"),                                   // plomberie : 2 000 − 1 200 = 800
    ligne(300, "electricite"),                                  // électricité : 800 − 300 = 500
    ligne(5000, "plomberie", { nature: "sous_traitance" }),     // ne consomme pas l'enveloppe
    ligne(400, "peinture", { nature: "location" }),             // idem
  ] });
  const lot = (id) => r.lots.find(l => l.lotId === id);
  proche(lot("plomberie").enveloppe, 2000, "enveloppe = Σ coûts matériaux prévus du lot");
  proche(lot("plomberie").commandes, 1200, "seules les lignes « materiaux » consomment l'enveloppe");
  proche(lot("plomberie").reste, 800, "reste du lot");
  proche(lot("electricite").reste, 500, "reste électricité");
  proche(lot("peinture").reste, 600, "peinture : rien de commandé en matériaux");
  proche(r.reste, 1900, "reste total = somme des restes de lot");
  ok(r.warnings.length === 0, "aucun avertissement");
  ok(r.lots.map(l => l.lotId).join() === "plomberie,electricite,peinture", "lots dans l'ordre de la configuration");
}

// ── 2. Une commande SANS LOT : déduite du total, avertissement chiffré ──────
{
  const r = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [
    ligne(1200, "plomberie"), ligne(250, null), ligne(100, ""),
  ] });
  proche(r.resteLots, 800 + 800 + 600, "les lots ne savent rien de la commande sans lot");
  proche(r.commandesSansLot, 350, "commandes sans lot");
  proche(r.reste, 2200 - 350, "déduites du reste total");
  const w = r.warnings.find(x => x.code === "commandes_sans_lot");
  ok(w && /2 lignes de matériaux sans lot \(350 €\)/.test(w.message.replace(/\s/g, " ")), `avertissement chiffré : ${w?.message}`);
  // Plancher : plus de commandes sans lot que de reste → 0, jamais négatif.
  const plancher = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [ligne(99999, null)] });
  ok(plancher.reste === 0, "plancher 0");
  proche(plancher.deductionSansLot, 3400, "déduction limitée au reste disponible");
  // Un avoir sans lot (montant négatif) ne fait pas remonter le reste.
  const avoir = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [ligne(-500, null)] });
  proche(avoir.reste, 3400, "avoir sans lot : reste inchangé");
}

// ── 3. Un lot « achats terminés » : reste 0, réversible ─────────────────────
{
  const achats = [{ chantier_id: "C", lot_id: "peinture", termine_le: "2026-10-20T10:00:00Z", termine_par: "Conducteur A" }];
  const r = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [], achatsTermines: achats });
  const p = r.lots.find(l => l.lotId === "peinture");
  ok(p.reste === 0, "lot terminé : reste à 0 malgré 600 € d'enveloppe");
  ok(p.achatsTermines.par === "Conducteur A" && p.achatsTermines.le.startsWith("2026-10-20"), "date et auteur restitués");
  proche(r.reste, 2000 + 800, "les autres lots inchangés");
  const rouvert = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [], achatsTermines: [] });
  proche(rouvert.reste, 3400, "démarqué : l'enveloppe revient");
}

// ── 4. Dépassement d'enveloppe (€ et %) ─────────────────────────────────────
{
  const r = resteACommanderEnveloppes({ ouvrages, lots: LOTS, commandeLignes: [
    ligne(1000, "electricite"),            // 800 prévus → +200 € (+25 %)
    ligne(150, "menuiserie"),              // lot sans ouvrage : enveloppe 0
  ] });
  const el = r.lots.find(l => l.lotId === "electricite");
  ok(el.reste === 0, "lot dépassé : reste 0");
  proche(el.depassement.euros, 200, "dépassement en €");
  proche(el.depassement.pct, 25, "dépassement en %");
  const me = r.lots.find(l => l.lotId === "menuiserie");
  ok(me.depassement && me.depassement.pct === null, "enveloppe nulle : pourcentage non calculable (null, jamais 0)");
  ok(r.depassements.length === 2, "liste des dépassements pour une alerte future");
  ok(r.warnings.some(w => w.code === "depassement_enveloppe" && /\+25 %/.test(w.message)), "message de dépassement");
}

// ── 5. Ouvrages sans lot : enveloppe « Sans lot » ───────────────────────────
{
  const r = resteACommanderEnveloppes({ ouvrages: [{ cout_materiaux: 300 }], commandeLignes: [], lots: LOTS });
  ok(r.lots[0].lotId === LOT_SANS_LOT && r.lots[0].label === "Sans lot" && r.reste === 300, "ouvrage sans lot : son enveloppe compte");
}

// ── 6. Natures : coûts réels complets, ventilation, valeur par défaut ───────
{
  const lignes = [ligne(100, "a"), ligne(200, "a", { nature: "sous_traitance" }), ligne(50, "a", { nature: "dechets" }),
    ligne(30, "a", { nature: "location" }), ligne(20, "a", { nature: "autre" }), ligne(10, "a", { nature: "inconnue" })];
  const v = coutsParNature(lignes);
  ok(v.materiaux === 110 && v.sous_traitance === 200 && v.dechets === 50 && v.location === 30 && v.autre === 20, `ventilation : ${JSON.stringify(v)}`);
  ok(natureLigne({}) === "materiaux" && natureLigne({ nature: "xyz" }) === "materiaux", "nature absente ou inconnue → matériaux");
  ok(NATURES_COUT.map(n => n.id).join() === "materiaux,sous_traitance,location,dechets,autre", "les 5 natures");
}

// ── 7. Marge à terminaison : plus de double comptage ────────────────────────
// Une commande de plomberie saisie SANS lien avec le matériau prévu
// (materiau_id/ouvrage_id vides) : l'ancien calcul la comptait en matériaux
// réels ET gardait le matériau prévu « à commander ».
{
  const phasage = { ouvrages, plan_travaux: { meta: {} } };
  const commandeLignes = [
    ligne(1200, "plomberie", { libelle: "Tube cuivre (saisie libre)" }),
    ligne(5000, "plomberie", { nature: "sous_traitance" }),
  ];
  const fin = computeChantierFinance({ phasage, commandeLignes, lots: LOTS, tauxFG: [{ depuis: "2026-01-01", taux: 0 }] });
  const b = fin.brut;
  proche(b.coutMatChantier, 6200, "coûts réels : toutes les natures");
  proche(b.coutMatParNature.sous_traitance, 5000, "ventilation par nature renvoyée");
  proche(b.resteACommander, 800 + 800 + 600, "reste = enveloppes non consommées");
  const page = resteACommanderEnveloppes({ ouvrages, commandeLignes, lots: LOTS, achatsTermines: [] });
  proche(b.resteACommander, page.reste, "MÊME fonction que la page Commandes à passer");
  proche(b.margeATerminaison, b.prixHTChantier - (b.coutMOTotalChantier + b.heuresRestantes * b.tauxMOPrevEff) - (6200 + 2200) - b.fgProjete, "marge à terminaison = vendu − MO − (réel + reste) − FG");
  ok(fin.resteACommander.renseigne === true && fin.resteACommander.valeur === b.resteACommander, "toujours calculable (plus besoin de la bibliothèque)");
  ok(fin.resteACommander.ventilation.some(v => v.main === "Plomberie" && /enveloppe 2\s000 €/.test(v.sub.replace(/\s/g, " "))), "ventilation par lot");
  ok(/sous-traitance/.test(fin.matReel.sousTitre) && fin.matReel.parNature.length === 5, "la carte Matériaux montre la ventilation");
  // Lot « achats terminés » transmis au calcul principal.
  const finT = computeChantierFinance({ phasage, commandeLignes, lots: LOTS, achatsTermines: [{ lot_id: "peinture" }] });
  proche(finT.brut.resteACommander, 1600, "achats terminés pris en compte dans la marge à terminaison");
}

// ── 8. Saisie : lot obligatoire dès qu'une ligne est rattachée à un chantier ─
{
  ok(lignesChantierSansLot([{ chantier_id: "C", lot_id: "" }, { chantier_id: "C", lot_id: "plomberie" }, { chantier_id: "", lot_id: "" }]).join() === "0",
    "seule la ligne de chantier sans lot est refusée");
  ok(lignesChantierSansLot([{ lot_id: "" }], () => "chantier-par-defaut").length === 1, "chantier par défaut de la saisie pris en compte");
  ok(/Une ligne/.test(messageLotObligatoire(1)) && /3 lignes/.test(messageLotObligatoire(3)), "messages");
  ok(natureSaisie("") === "materiaux" && natureSaisie("location") === "location", "nature par défaut : matériaux");
}

// ── 9. Méthode de calcul ────────────────────────────────────────────────────
{
  const m = METHODE_CALCUL.find(x => x.cle === "resteACommander");
  ok(/enveloppe/.test(m.formule) && /achats terminés/.test(m.formule) && /sans lot/.test(m.formule), "formule du reste à commander");
  ok(/toutes natures/.test(METHODE_CALCUL.find(x => x.cle === "matReel").formule), "formule des matériaux réels");
}

// ── 10. Gardes sur le code ──────────────────────────────────────────────────
{
  const page = lire("src/Renovation/PagePlanningCommandes.jsx");
  ok(/resteACommanderEnveloppes\(/.test(page), "la page Commandes à passer appelle la fonction du module");
  ok(/const totalACommander = enveloppes\.reste;/.test(page), "le montant affiché est celui de l'enveloppe");
  ok(/marquerAchatsTermines/.test(page) && /annulerAchatsTermines/.test(page), "bouton « achats terminés » réversible sur la page");
  ok(/marquerAchatsTermines/.test(lire("src/Renovation/PhasageV2.jsx")), "et dans le panneau du lot du phasage");
  // Toutes les lectures de lignes qui alimentent le calcul ont le lot et la nature.
  const lectures = {
    "src/Renovation/PhasageV2.jsx": 1, "src/Renovation/BilanSemaine.jsx": 1, "src/Renovation/PageOperations.jsx": 1,
    "src/Renovation/DiagrammeFinancierConsolide.jsx": 1, "src/Renovation/operationExportData.js": 1,
    "src/Renovation/PageChantiers.jsx": 1, "src/Renovation/PagePlanningCommandes.jsx": 1, "api/_partage/donneesFinanceChantiers.js": 1,
  };
  Object.keys(lectures).forEach(f => {
    const s = lire(f);
    ok(/lot_id, nature/.test(s), `${f} : lit lot_id et nature`);
    ok(/achats(Termines|_lots_termines|ParCh|ParChantier|Res)/.test(s) || /chargerAchatsTermines/.test(s), `${f} : transmet les lots « achats terminés »`);
  });
  // Plus de lecture d'un coup (tronquée à 1 000 lignes) là où on calcule.
  ["src/Renovation/PageChantiers.jsx", "src/Renovation/DiagrammeFinancierConsolide.jsx", "src/Renovation/PagePlanningCommandes.jsx", "src/Renovation/Commandes.jsx"]
    .forEach(f => ok(/lireToutParTranches\(/.test(lire(f)), `${f} : lecture par tranches`));
  // Saisie : les trois écrans contrôlent le lot.
  ["src/Renovation/CaptureCommandeMobile.jsx", "src/Renovation/Commandes.jsx"].forEach(f => {
    const s = lire(f);
    ok(/lignesChantierSansLot\(/.test(s) && /natureSaisie\(/.test(s), `${f} : lot obligatoire + nature`);
  });
  // Migration : colonne, contrainte, table, policies, historique.
  const mig = lire("supabase/migrations/20261024120000_nature_couts_achats_lots.sql");
  ok(/add column if not exists nature text not null default 'materiaux'/.test(mig), "colonne nature, défaut matériaux");
  ok(/check \(nature in \('materiaux', 'sous_traitance', 'location', 'dechets', 'autre'\)\)/.test(mig), "contrainte des 5 natures");
  ok(/create table if not exists public\.achats_lots_termines/.test(mig) && /unique \(chantier_id, lot_id\)/.test(mig), "table achats_lots_termines");
  ok(/profero_collaborateurs_seulement/.test(mig) && /not public\.est_ouvrier\(\)/.test(mig), "policies collaborateurs + bureau");
  ok(/trg_data_history/.test(mig), "démarquage historisé");
  // Module pur.
  ok(!/new Date\s*\(|Date\.now\s*\(/.test(lire("src/chantierFinance.mjs")), "module sans horloge");
  ok(!/supabase/.test(lire("src/Renovation/saisieLotNature.mjs")), "règles de saisie : module pur");
}

console.log(`verif-enveloppes-lots : ${nb} contrôles OK (données fictives)`);
