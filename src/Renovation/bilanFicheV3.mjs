// ─────────────────────────────────────────────────────────────────────────────
// Fiche chantier de la version DÉTAILLÉE du Bilan (refonte, étape 3.4).
//
//   - en tête (26/10/2026) : « du devis au probable » — marge devis, ce qui
//     mène à la marge à terminaison, puis la dérive des lots jusqu'à la marge
//     probable ; dessous le constat à date et la période ;
//   - tableau des lots : lu dans le relevé de fin de période (colonne lots),
//     lots utiles seulement (les autres en « À venir »), ligne « sans lot »
//     en heures seulement, mise en évidence au-delà du seuil (10 % par défaut) ;
//   - matériaux : totaux du relevé (commandés, imputés, en avance, reste à
//     commander, ventilation par nature) + détail par lot (enveloppe,
//     commandé, imputé, en avance, reste, dépassement) ;
//   - tâches résumées par lot (« Murs cloisons : 6 terminées, 2 en cours »),
//     puis le détail : tâches dont l'avancement a bougé sur la période (journal
//     d'avancement daté), état au dernier jour travaillé ;
//   - présences : « Davy 4 j · Selman 4 j · Kev 2 j » (jours pointés) ;
//   - photos et commentaires : UNIQUEMENT ceux que le conducteur a choisis ;
//   - synthèse : la version RELUE par le conducteur (jamais le texte brut de
//     l'IA s'il n'a pas été relu).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────
import { libelleOuvrage, nomTache } from "./libellesPhasageV1.mjs";
import { METHODE_CALCUL, NATURES_COUT, cascadeMargeDevisReleve, materiauxParLot, etatTachesALaDate, dateImputationLigne } from "../chantierFinance.mjs";
import { dateRapportIsoV3 } from "./bilanPeriodeV3.mjs";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const jour = v => str(v).slice(0, 10);

export const LIBELLES_PROVENANCE_FICHE = Object.freeze({
  constatee: "dérive constatée", historique: "dérive historique", neutralisee: "neutralisée", aucune: "aucune",
});

const fmt1 = v => String(Math.round(v * 10) / 10).replace(".", ",");

/**
 * Lignes de lots de la fiche, depuis la colonne `lots` du relevé (choix de
 * Loris du 26/10/2026 : lots UTILES seulement) :
 *   - affichés : lots commencés (heures ou avancement), ou qui pèsent sur la
 *     marge probable (écart probable d'au moins 1 €) ;
 *   - les autres : une ligne « À venir : Sol 25 h · Plafond 36 h » ;
 *   - « Sans lot » : les heures seulement, LE MÊME chiffre que l'encadré
 *     (heures_sans_lot du relevé : heures libres, indirectes hors trajets,
 *     ouvrages sans lot) — ni avancement ni coefficient ; les heures prévues
 *     seulement si des ouvrages sans lot en prévoient ;
 *   - lot terminé : « terminé » au lieu du coefficient.
 */
export function lotsFicheV3(releveFin, { seuilSansLotPct = 10 } = {}) {
  const tous = listeSure(releveFin?.lots).map(l => {
    const sansLot = l.id === "_orphans";
    const avEx = num(l.avancementExact) ?? num(l.avancement);
    const termine = !sansLot && avEx != null && avEx >= 100;
    return {
      id: l.id, label: sansLot ? "Sans lot" : l.label, sansLot, termine,
      heuresReelles: num(l.heuresReelles), heuresVendues: num(l.heuresVendues),
      avancement: num(l.avancement), avancementExact: num(l.avancementExact),
      ecartHeures: num(l.ecartHeures), ecartEuros: num(l.ecartEuros),
      heuresRestantesPrevues: num(l.heuresRestantesPrevues), heuresRestantesProbables: num(l.heuresRestantesProbables),
      ecartProbableEuros: num(l.ecartProbableEuros),
      provenance: termine ? "terminé" : l.provenanceCoefficient
        ? `×${String(Math.round(num(l.coefficient) * 100) / 100).replace(".", ",")} · ${LIBELLES_PROVENANCE_FICHE[l.provenanceCoefficient] || l.provenanceCoefficient}`
        : "",
    };
  });
  const hSansLot = num(releveFin?.heures_sans_lot);
  const pct = num(releveFin?.pct_sans_lot);
  const pese = l => Math.abs(l.ecartProbableEuros || 0) >= 1;
  const commence = l => (l.heuresReelles || 0) > 0 || (l.avancementExact ?? l.avancement ?? 0) > 0;
  const lots = [], aVenir = [];
  for (const l of tous) {
    if (l.sansLot) continue;
    if (commence(l) || pese(l)) lots.push(l);
    else aVenir.push(`${l.label} ${fmt1(l.heuresRestantesPrevues ?? l.heuresVendues ?? 0)} h`);
  }
  const orph = tous.find(l => l.sansLot) || null;
  const hvSansLot = orph && (orph.heuresVendues || 0) > 0 ? orph.heuresVendues : null;
  if ((hSansLot || 0) > 0 || hvSansLot != null) {
    lots.push({ id: "_orphans", label: "Sans lot", sansLot: true, heuresReelles: hSansLot ?? 0, heuresVendues: hvSansLot });
  }
  const sansLotAlerte = pct != null && pct > seuilSansLotPct
    ? `${fmt1(pct)} % des heures sont « sans lot » (${fmt1(hSansLot || 0)} h) : au-delà de ${seuilSansLotPct} %, les causes des dérives sont masquées.`
    : null;
  return { lots, aVenir: aVenir.length ? `À venir : ${aVenir.join(" · ")}` : null, sansLotAlerte };
}

/**
 * Bloc matériaux de la fiche (null si le relevé ne les a pas). Les totaux sont
 * ceux du relevé ; le détail par lot vient de materiauxParLot (les deux
 * fonctions de la marge) sur les données arrêtées à la date du relevé, et
 * n'est montré que s'il retombe sur les totaux du relevé (à 1 € près) — sinon
 * la fiche dit pourquoi il manque : jamais un détail qui contredit les totaux.
 * `detail` : résultat de materiauxParLotALaDateV3 (undefined = non chargé).
 */
export function materiauxFicheV3(releveFin, detail = undefined) {
  if (!releveFin) return null;
  const parNature = releveFin.couts_par_nature && typeof releveFin.couts_par_nature === "object"
    ? NATURES_COUT.map(n => ({ nature: n.id, libelle: n.label, montant: num(releveFin.couts_par_nature[n.id]) }))
      .filter(x => x.montant != null && Math.abs(x.montant) > 0.5)
    : [];
  const enAvance = num(releveFin.materiaux_en_avance), reste = num(releveFin.reste_a_commander);
  let lots = null, raisonLots = null, sansLot = null;
  if (detail === undefined) raisonLots = "détail par lot non chargé";
  else if (detail == null) raisonLots = "détail par lot indisponible : avancement inconnu à cette date";
  else if ((enAvance != null && Math.abs(detail.enAvance - enAvance) > 1) || (reste != null && Math.abs(detail.reste - reste) > 1)) {
    raisonLots = "détail par lot indisponible : les commandes ou le phasage ont changé depuis le calcul du relevé (les totaux ci-dessus sont ceux du relevé)";
  } else {
    lots = detail.lots;
    sansLot = detail.commandesSansLot > 0.5 ? { commandes: detail.commandesSansLot, deduction: detail.deductionSansLot } : null;
  }
  return {
    commandes: num(releveFin.mat_reel), imputes: num(releveFin.materiaux_imputes),
    enAvance, resteACommander: reste,
    parNature, parNatureDisponible: !!releveFin.couts_par_nature,
    lots, sansLot, raisonLots,
  };
}

/**
 * Détail des matériaux par lot à la date du relevé de fin : état des tâches à
 * cette date (journal d'avancement COMPLET du chantier), lignes de commande
 * imputées au plus tard ce jour-là (même règle que les relevés). undefined si
 * les données ne sont pas chargées.
 */
export function materiauxParLotALaDateV3({ ouvrages, journalComplet, commandeLignes, achatsTermines = [], lots = [], dateFin }) {
  if (!Array.isArray(journalComplet) || !Array.isArray(commandeLignes)) return undefined;
  const etat = etatTachesALaDate(journalComplet, dateFin);
  const lignes = commandeLignes.filter(l => { const d = dateImputationLigne(l); return d == null || d <= dateFin; });
  return materiauxParLot({ ouvrages: listeSure(ouvrages), commandeLignes: lignes, lots, achatsTermines, etat });
}

/**
 * Tâches de la période par lot : celles dont l'avancement a été modifié entre
 * dateDepart (exclu) et dateFin (inclus), avec leur état à dateFin.
 * @param {object} args
 * @param {Array}  args.ouvrages  ouvrages du phasage ({ id, lot_id, libelle, taches:[{id, nom}] })
 * @param {Array}  args.journal   lignes d'avancement_journal du chantier
 * @param {object} args.lotsLabels { [lot_id]: label }
 */
export function tachesParLotV3({ ouvrages, journal, dateDepart, dateFin, lotsLabels = {} }) {
  const tacheInfo = new Map();
  for (const o of listeSure(ouvrages)) {
    for (const t of listeSure(o.taches)) {
      tacheInfo.set(str(t.id), { nom: str(nomTache(t)) || str(t.label) || str(libelleOuvrage(o)) || "Tâche", lot: str(o.lot_id) || "_orphans" });
    }
  }
  const etatFin = new Map();
  const lignes = listeSure(journal)
    .filter(j => str(j.tache_id) && jour(j.date_realisation) && str(j.source) !== "initial")
    .sort((a, b) => jour(a.date_realisation).localeCompare(jour(b.date_realisation)) || str(a.created_at).localeCompare(str(b.created_at)));
  const touchees = new Set();
  for (const j of lignes) {
    const d = jour(j.date_realisation);
    if (d > dateFin) continue;
    etatFin.set(str(j.tache_id), num(j.avancement_apres));
    if (d > dateDepart && num(j.avancement_avant) !== num(j.avancement_apres)) touchees.add(str(j.tache_id));
  }
  const parLot = new Map();
  for (const id of touchees) {
    const info = tacheInfo.get(id) || { nom: "Tâche supprimée du phasage", lot: "_orphans" };
    const av = etatFin.get(id);
    const etat = av == null ? "inconnu" : av >= 100 ? "terminée" : av <= 0 ? "remise à zéro" : `en cours ${Math.round(av)} %`;
    if (!parLot.has(info.lot)) parLot.set(info.lot, []);
    parLot.get(info.lot).push({ nom: info.nom, etat, terminee: av >= 100 });
  }
  return [...parLot.entries()].map(([lot, taches]) => {
    const nbT = taches.filter(t => t.terminee).length, nbC = taches.length - nbT;
    const resume = [nbT ? `${nbT} terminée${nbT > 1 ? "s" : ""}` : null, nbC ? `${nbC} en cours` : null].filter(Boolean).join(", ");
    return { lot: lot === "_orphans" ? "Sans lot" : (lotsLabels[lot] || lot), resume, taches: taches.sort((a, b) => a.nom.localeCompare(b.nom, "fr")) };
  }).sort((a, b) => a.lot.localeCompare(b.lot, "fr"));
}

/** « Davy 4 j · Selman 4 j » : jours distincts pointés par ouvrier sur la période. */
export function presencesV3({ pointages, chantierId, debut, fin }) {
  const m = new Map();
  for (const p of listeSure(pointages)) {
    const d = jour(p.date);
    if (str(p.chantier_id) !== chantierId || d < debut || d > fin || !(num(p.heures) > 0) || !str(p.ouvrier)) continue;
    if (!m.has(str(p.ouvrier))) m.set(str(p.ouvrier), new Set());
    m.get(str(p.ouvrier)).add(d);
  }
  return [...m.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], "fr"))
    .map(([o, s]) => `${o} ${s.size} j`).join(" · ") || null;
}

/** Photos et commentaires des comptes rendus de la période, PROPOSÉS au conducteur. */
export function matiereComptesRendusV3({ rapports, chantierId, debut, fin }) {
  const photos = [], commentaires = [];
  for (const r of listeSure(rapports)) {
    const d = dateRapportIsoV3(r.date_rapport);
    if (str(r.chantier_id) !== chantierId || d < debut || d > fin) continue;
    const ouvrier = str(r.ouvrier);
    listeSure(r.photos_chantier).forEach(u => str(u) && photos.push({ url: str(u), ouvrier, date: d }));
    if (str(r.remarque)) commentaires.push({ id: `${r.id}:r`, ouvrier, date: d, texte: str(r.remarque) });
    listeSure(r.taches).forEach((t, i) => {
      listeSure(t.photos).forEach(u => { const url = typeof u === "string" ? u : u?.url; if (str(url)) photos.push({ url: str(url), ouvrier, date: d }); });
      if (str(t.remarque)) commentaires.push({ id: `${r.id}:${i}`, ouvrier, date: d, texte: str(t.remarque), tache: str(t.planifie) });
    });
  }
  return { photos, commentaires };
}

/** Annexe « Méthode de calcul » du Bilan (mêmes formules que le module finance). */
export function methodeBilanV3() {
  const garder = ["venduHT", "heuresVendues", "heuresReelles", "margePrev", "margeAvancement", "margeATerminaison", "margeProbable", "cascadeDevisProbable", "eurParHeureDevis", "budgetRestant", "materiauxEnAvance", "deriveLotHeuresEuros", "heuresSansLot"];
  const finance = METHODE_CALCUL.filter(m => garder.includes(m.cle)).map(m => ({ titre: m.label, texte: m.formule }));
  return [
    { titre: "Période et comparaison", texte: "Le Bilan compare deux relevés journaliers : celui du dernier jour travaillé avant la période et celui du dernier jour travaillé de la période (jour travaillé = au moins une heure pointée dans l'entreprise). Une donnée inconnue à ces dates reste « pas encore disponible », jamais 0." },
    { titre: "Production de la période", texte: "Production cumulée (Σ prix HT des ouvrages × avancement exact, sans arrondi) au relevé de fin − production cumulée au relevé de départ." },
    { titre: "Marge de la période", texte: "Marge à l'avancement au relevé de fin − marge à l'avancement au relevé de départ : les périodes s'additionnent exactement à la marge cumulée." },
    { titre: "Écart à la marge devis", texte: "Marge probable − marge prévue au devis : ce que le chantier perd (ou gagne) par rapport à ce que le devis laissait espérer. Le bandeau compare les totaux sur les chantiers où les deux marges sont connues ; les pourcentages sont rapportés au vendu HT (« — » si le vendu est nul)." },
    { titre: "Pastilles", texte: "Rouge : marge probable négative ou en baisse au-delà du seuil d'alerte. Orange : marge de la période négative ou autre alerte. Vert : aucune de ces situations. Gris : relevé pas encore disponible." },
    ...finance,
  ];
}

/** Assemble la fiche d'un chantier pour le PDF détaillé. */
// En tête de fiche (choix de Loris du 26/10/2026) : « du devis au probable »
// (cascadeMargeDevisReleve, lue dans le relevé de fin), puis le constat à date
// et la période, lus dans la synthèse du Bilan (mêmes chiffres que la page 1).
export function margesFicheV3(synthese, releveFin, baremeFG = null) {
  return {
    cascade: cascadeMargeDevisReleve(releveFin, baremeFG),
    constat: { margeAvancement: synthese?.margeAvancement ?? null, materiauxEnAvance: synthese?.materiauxEnAvance ?? null },
    periode: { production: synthese?.production ?? null, margePeriode: synthese?.margePeriode ?? null },
  };
}

export function ficheChantierV3({ synthese, releveFin, ouvrages, journal, pointages, periode, bornes,
  photosChoisies = [], commentairesCoches = [], syntheseRelue = "", seuilSansLotPct = 10,
  baremeFG = null, journalComplet = undefined, commandeLignes = undefined, achatsTermines = [], lotsConfig = [] }) {
  const { lots, aVenir, sansLotAlerte } = lotsFicheV3(releveFin, { seuilSansLotPct });
  const lotsLabels = Object.fromEntries(listeSure(releveFin?.lots).map(l => [l.id, l.label]));
  const detailMat = materiauxParLotALaDateV3({ ouvrages, journalComplet, commandeLignes, achatsTermines, lots: lotsConfig, dateFin: bornes.dateFin });
  return {
    chantierId: synthese.chantierId, nom: synthese.nom,
    synthese: str(syntheseRelue) || null,
    presences: presencesV3({ pointages, chantierId: synthese.chantierId, debut: periode.debut, fin: periode.fin }),
    marges: margesFicheV3(synthese, releveFin, baremeFG),
    lots, aVenir, sansLotAlerte,
    materiaux: materiauxFicheV3(releveFin, detailMat),
    tachesParLot: tachesParLotV3({ ouvrages, journal, dateDepart: bornes.dateDepart, dateFin: bornes.dateFin, lotsLabels }),
    photos: listeSure(photosChoisies).slice(0, 2),
    commentaires: listeSure(commentairesCoches).map(c => ({ ouvrier: c.ouvrier, texte: c.texte })),
  };
}
