// ─────────────────────────────────────────────────────────────────────────────
// Fiche chantier de la version DÉTAILLÉE du Bilan (refonte, étape 3.4).
//
//   - tableau des lots : lu dans le relevé de fin de période (colonne lots),
//     ligne « sans lot » mise en évidence au-delà du seuil (10 % par défaut) ;
//   - matériaux : commandés, imputés, en avance, reste à commander, ventilation
//     par nature des coûts — lus dans le relevé (même service) ;
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
import { METHODE_CALCUL, NATURES_COUT } from "../chantierFinance.mjs";
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

/** Lignes de lots de la fiche, depuis la colonne `lots` du relevé. */
export function lotsFicheV3(releveFin, { seuilSansLotPct = 10 } = {}) {
  const lots = listeSure(releveFin?.lots).map(l => ({
    id: l.id, label: l.id === "_orphans" ? "Sans lot" : l.label, sansLot: l.id === "_orphans",
    heuresReelles: num(l.heuresReelles), heuresVendues: num(l.heuresVendues),
    avancement: num(l.avancement), avancementExact: num(l.avancementExact),
    ecartHeures: num(l.ecartHeures), ecartEuros: num(l.ecartEuros),
    heuresRestantesPrevues: num(l.heuresRestantesPrevues), heuresRestantesProbables: num(l.heuresRestantesProbables),
    provenance: l.provenanceCoefficient
      ? `×${String(Math.round(num(l.coefficient) * 100) / 100).replace(".", ",")} · ${LIBELLES_PROVENANCE_FICHE[l.provenanceCoefficient] || l.provenanceCoefficient}`
      : "",
  }));
  const pct = num(releveFin?.pct_sans_lot);
  const hSansLot = num(releveFin?.heures_sans_lot);
  const sansLotAlerte = pct != null && pct > seuilSansLotPct
    ? `${String(Math.round(pct * 10) / 10).replace(".", ",")} % des heures sont « sans lot » (${String(Math.round((hSansLot || 0) * 10) / 10).replace(".", ",")} h) : au-delà de ${seuilSansLotPct} %, les causes des dérives sont masquées.`
    : null;
  return { lots, sansLotAlerte };
}

/** Bloc matériaux de la fiche (null si le relevé ne les a pas). */
export function materiauxFicheV3(releveFin) {
  if (!releveFin) return null;
  const parNature = releveFin.couts_par_nature && typeof releveFin.couts_par_nature === "object"
    ? NATURES_COUT.map(n => ({ nature: n.id, libelle: n.label, montant: num(releveFin.couts_par_nature[n.id]) }))
      .filter(x => x.montant != null && Math.abs(x.montant) > 0.5)
    : [];
  return {
    commandes: num(releveFin.mat_reel), imputes: num(releveFin.materiaux_imputes),
    enAvance: num(releveFin.materiaux_en_avance), resteACommander: num(releveFin.reste_a_commander),
    parNature, parNatureDisponible: !!releveFin.couts_par_nature,
  };
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
      tacheInfo.set(str(t.id), { nom: str(t.nom_terrain) || str(t.nom) || str(t.label) || str(o.libelle) || "Tâche", lot: str(o.lot_id) || "_orphans" });
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
  const garder = ["venduHT", "heuresVendues", "heuresReelles", "margeAvancement", "margeATerminaison", "margeProbable", "budgetRestant", "materiauxEnAvance", "deriveLotHeuresEuros", "heuresSansLot"];
  const finance = METHODE_CALCUL.filter(m => garder.includes(m.cle)).map(m => ({ titre: m.label, texte: m.formule }));
  return [
    { titre: "Période et comparaison", texte: "Le Bilan compare deux relevés journaliers : celui du dernier jour travaillé avant la période et celui du dernier jour travaillé de la période (jour travaillé = au moins une heure pointée dans l'entreprise). Une donnée inconnue à ces dates reste « pas encore disponible », jamais 0." },
    { titre: "Production de la période", texte: "Production cumulée (Σ prix HT des ouvrages × avancement exact, sans arrondi) au relevé de fin − production cumulée au relevé de départ." },
    { titre: "Marge de la période", texte: "Marge à l'avancement au relevé de fin − marge à l'avancement au relevé de départ : les périodes s'additionnent exactement à la marge cumulée." },
    { titre: "€ produits par heure", texte: "Production de la période ÷ heures validées de la période." },
    { titre: "Pastilles", texte: "Rouge : marge probable négative ou en baisse au-delà du seuil d'alerte. Orange : marge de la période négative ou autre alerte. Vert : aucune de ces situations. Gris : relevé pas encore disponible." },
    ...finance,
  ];
}

/** Assemble la fiche d'un chantier pour le PDF détaillé. */
export function ficheChantierV3({ synthese, releveFin, ouvrages, journal, pointages, periode, bornes,
  photosChoisies = [], commentairesCoches = [], syntheseRelue = "", seuilSansLotPct = 10 }) {
  const { lots, sansLotAlerte } = lotsFicheV3(releveFin, { seuilSansLotPct });
  const lotsLabels = Object.fromEntries(lots.map(l => [l.id, l.label]));
  return {
    chantierId: synthese.chantierId, nom: synthese.nom,
    synthese: str(syntheseRelue) || null,
    presences: presencesV3({ pointages, chantierId: synthese.chantierId, debut: periode.debut, fin: periode.fin }),
    lots, sansLotAlerte,
    materiaux: materiauxFicheV3(releveFin),
    tachesParLot: tachesParLotV3({ ouvrages, journal, dateDepart: bornes.dateDepart, dateFin: bornes.dateFin, lotsLabels }),
    photos: listeSure(photosChoisies).slice(0, 2),
    commentaires: listeSure(commentairesCoches).map(c => ({ ouvrier: c.ouvrier, texte: c.texte })),
  };
}
