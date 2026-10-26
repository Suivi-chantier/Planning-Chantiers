// ─────────────────────────────────────────────────────────────────────────────
// Bilan d'une PÉRIODE (refonte du Bilan, étape 3 — 24/10/2026).
//
// Le Bilan s'appuie sur les RELEVÉS JOURNALIERS (chantier_releves_journaliers,
// étape 1D), plus sur les photos du vendredi. Une période (semaine par
// défaut, mois, ou dates libres) se compare du DERNIER JOUR TRAVAILLÉ avant la
// période au DERNIER JOUR TRAVAILLÉ de la période (jour travaillé = au moins
// une heure pointée dans l'entreprise ce jour-là).
//
// MÊME CHIFFRE = MÊME SERVICE : tous les montants sont LUS dans les colonnes
// des relevés (écrites par releveJournalier.mjs depuis chantierFinance) ; la
// valeur d'une période est la différence de deux relevés. Rien n'est recalculé
// ici. Une donnée absente (null) reste absente : jamais 0.
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

import { margePrevueDevisReleve, eurParHeureDevis, normaliserSeuilsMarges } from "../chantierFinance.mjs";
import { MOTIF_LOT_EN_DERIVE, MOTIF_HEURES_SANS_LOT, MOTIF_DEPASSEMENT_ENVELOPPE } from "./pointsAttentionV1.mjs";

export const BILAN_PERIODE_VERSION = "v3";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const diff = (a, b) => (a == null || b == null ? null : round2(a - b));
const jour = v => str(v).slice(0, 10);
// date_rapport est saisie « JJ/MM/AAAA » (texte) ; on accepte aussi l'ISO.
export const dateRapportIsoV3 = v => {
  const s = str(v);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
};

// ── Dates (chaînes AAAA-MM-JJ, calcul en UTC pour éviter l'heure d'été) ─────
const versDate = iso => new Date(`${iso}T00:00:00Z`);
const versIso = d => d.toISOString().slice(0, 10);
export function ajouterJoursV3(iso, n) {
  const d = versDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return versIso(d);
}
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
export const fmtJourV3 = iso => {
  if (!iso) return "";
  const d = versDate(iso);
  return `${JOURS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const fmtDateLongue = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

// ── Périodes ─────────────────────────────────────────────────────────────────
/** Lundi (AAAA-MM-JJ) de la semaine ISO « AAAA-Www ». */
export function lundiSemaineV3(weekId) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(str(weekId));
  if (!m) return null;
  const j4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const lundiS1 = new Date(j4);
  lundiS1.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() + 6) % 7));
  lundiS1.setUTCDate(lundiS1.getUTCDate() + (Number(m[2]) - 1) * 7);
  return versIso(lundiS1);
}
/** Semaine ISO « AAAA-Www » d'une date. */
export function semaineIsoV3(iso) {
  const d = versDate(iso);
  const jeudi = new Date(d);
  jeudi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const annee = jeudi.getUTCFullYear();
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const semaine = 1 + Math.round(((jeudi - j4) / 86400000 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7);
  return `${annee}-W${String(semaine).padStart(2, "0")}`;
}

export function periodeSemaineV3(weekId) {
  const debut = lundiSemaineV3(weekId);
  if (!debut) return null;
  const fin = ajouterJoursV3(debut, 6);
  const n = Number(/W(\d+)/.exec(weekId)[1]);
  return { type: "semaine", debut, fin, weekId, cle: `S:${weekId}`,
    libelle: `Semaine ${n} (${fmtDateLongue(debut).slice(0, 5)} → ${fmtDateLongue(fin)})` };
}
export function periodeMoisV3(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(str(mois));
  if (!m) return null;
  const debut = `${m[1]}-${m[2]}-01`;
  const d = versDate(debut);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  const fin = versIso(d);
  return { type: "mois", debut, fin, mois, cle: `M:${mois}`,
    libelle: `${MOIS[Number(m[2]) - 1].replace(/^./, c => c.toUpperCase())} ${m[1]}` };
}
export function periodeLibreV3(debut, fin) {
  const a = jour(debut), b = jour(fin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || a > b) return null;
  return { type: "libre", debut: a, fin: b, cle: `L:${a}_${b}`,
    libelle: `Du ${fmtDateLongue(a)} au ${fmtDateLongue(b)}` };
}

/**
 * Bornes de comparaison d'une période : dernier jour travaillé AVANT la
 * période (relevé de départ) et dernier jour travaillé DE la période (relevé de
 * fin). Sans jour travaillé : la veille de la période / le dernier jour de la
 * période (et `sansJourTravaille` le dit).
 * @param {object} periode   { debut, fin }
 * @param {string[]} joursTravailles  dates ayant au moins un pointage
 */
export function bornesComparaisonV3(periode, joursTravailles) {
  if (!periode) return null;
  const jours = [...new Set(listeSure(joursTravailles).map(jour).filter(Boolean))].sort();
  let fin = null, depart = null;
  for (const j of jours) {
    if (j < periode.debut) depart = j;
    else if (j <= periode.fin) fin = j;
  }
  return {
    dateDepart: depart || ajouterJoursV3(periode.debut, -1),
    dateFin: fin || periode.fin,
    departJourTravaille: !!depart,
    finJourTravaille: !!fin,
    sansJourTravaille: !fin,
  };
}

// ── Relevés ──────────────────────────────────────────────────────────────────
/** Map chantier_id → relevés triés par date croissante. */
export function indexerRelevesV3(lignes) {
  const m = new Map();
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const id = str(l.chantier_id), d = jour(l.date_releve);
    if (!id || !d) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(l);
  }
  m.forEach(liste => liste.sort((a, b) => jour(a.date_releve).localeCompare(jour(b.date_releve))));
  return m;
}
/** Relevé le plus récent au plus tard à `date` (ou null : jamais inventé). */
export function releveAuPlusTardV3(liste, date) {
  let retenu = null;
  for (const l of listeSure(liste)) { if (jour(l.date_releve) <= date) retenu = l; else break; }
  return retenu;
}

// ── Pastille de couleur et sa légende ────────────────────────────────────────
export const LEGENDE_PASTILLES_V3 = Object.freeze([
  { couleur: "rouge",  libelle: "Rouge", critere: "marge probable négative, ou en baisse au-delà du seuil d'alerte (500 € par défaut) sur la période" },
  { couleur: "orange", libelle: "Orange", critere: "marge de la période négative, ou une autre alerte (lot en dérive, heures sans lot, enveloppe matériaux dépassée…)" },
  { couleur: "vert",   libelle: "Vert", critere: "aucune des situations ci-dessus" },
  { couleur: "gris",   libelle: "Gris", critere: "relevé pas encore disponible : chiffres inconnus" },
]);
export const COULEURS_PASTILLES_V3 = Object.freeze({ rouge: "#e15a5a", orange: "#f59e0b", vert: "#22c55e", gris: "#9ca3af" });

function pastille({ margeProbable, evolutionMargeProbable, margePeriode, nbAutresAlertes, seuilBaisse, disponible }) {
  if (!disponible) return { couleur: "gris", raison: "relevé pas encore disponible" };
  if (margeProbable != null && margeProbable < 0) return { couleur: "rouge", raison: "marge probable négative" };
  if (evolutionMargeProbable != null && -evolutionMargeProbable > seuilBaisse) return { couleur: "rouge", raison: "marge probable en baisse" };
  if (margePeriode != null && margePeriode < 0) return { couleur: "orange", raison: "marge de la période négative" };
  if (nbAutresAlertes > 0) return { couleur: "orange", raison: "alerte à regarder" };
  return { couleur: "vert", raison: "" };
}

/**
 * Synthèse par chantier sur la période (même chiffres à l'écran, dans le PDF
 * et dans l'archive).
 * @param {object} args
 * @param {Map}    args.releves       indexerRelevesV3(lignes)
 * @param {Array}  args.chantiers     [{ id, nom }] chantiers à synthétiser
 * @param {object} args.bornes        bornesComparaisonV3(...)
 * @param {object} args.periode       { debut, fin }
 * @param {object} [args.alertesParChantier]  { [id]: [{ motif }] } (alertesMargesV2)
 * @param {number} [args.seuilBaisse=500]
 */
// Pourcentage d'un montant sur une base : « — » (null) si la base est nulle,
// négative ou inconnue — jamais 0 %.
export const pctSurV3 = (montant, base) => (montant == null || base == null || !(base > 0) ? null : round2(montant / base * 100));

// `baremeFG` : barème des frais généraux (planning_config.fg_taux_horaires),
// pour la marge prévue au devis — absent = taux par défaut, comme partout.
export function syntheseChantiersV3({ releves, chantiers, bornes, periode, alertesParChantier = {}, seuilBaisse = 500, baremeFG = null }) {
  const out = [];
  for (const c of listeSure(chantiers)) {
    const id = str(c.id);
    const liste = releves?.get(id) || [];
    const fin = releveAuPlusTardV3(liste, bornes.dateFin);
    const dep = releveAuPlusTardV3(liste, bornes.dateDepart);
    const v = (r, k) => num(r?.[k]);
    const avancement = v(fin, "avancement");
    const disponible = !!fin && avancement != null;
    const production = disponible ? diff(v(fin, "production_cumulee"), dep ? v(dep, "production_cumulee") : 0) : null;
    const margePeriode = disponible ? diff(v(fin, "marge_avancement"), dep ? v(dep, "marge_avancement") : 0) : null;
    const heuresPeriode = fin ? diff(v(fin, "heures_reelles"), dep ? v(dep, "heures_reelles") : 0) : null;
    const evolutionMargeProbable = dep ? diff(v(fin, "marge_probable"), v(dep, "marge_probable")) : null;
    const eurParHeure = production != null && heuresPeriode > 0 ? round2(production / heuresPeriode) : null;
    const alertes = listeSure(alertesParChantier[id]);
    const nbAutresAlertes = alertes.filter(a => a.motif !== "marge_probable_en_baisse").length;
    const repris = fin?.chantier_repris === true;

    // Mentions : démarrage (1re ou 2e semaine d'activité), réception / levée de
    // réserves (chantier à 100 % qui consomme encore), chantier repris.
    const mentions = [];
    const premier = liste.find(r => num(r.heures_reelles) > 0);
    if (premier && jour(premier.date_releve) >= ajouterJoursV3(periode.debut, -7) && jour(premier.date_releve) <= periode.fin) {
      mentions.push({ code: "demarrage", texte: "démarrage" });
    }
    if (avancement != null && avancement >= 100 && heuresPeriode > 0) {
      const reception = liste.find(r => num(r.avancement) >= 100);
      const hApres = reception ? diff(v(fin, "heures_reelles"), num(reception.heures_reelles)) : null;
      mentions.push({ code: "reception", texte: "réception / levée de réserves", heuresApresReception: hApres });
    }
    if (repris) mentions.push({ code: "repris", texte: "chantier repris" });

    // Devis → probable (choix de Loris du 26/10/2026) : marge prévue au devis
    // (même fonction que la « Marge prév. » du Phasage), marge probable, écart.
    const vendu = v(fin, "vendu_ht");
    const margeDevis = fin ? margePrevueDevisReleve(fin, baremeFG) : null;
    const margeProbable = disponible ? v(fin, "marge_probable") : null;
    // Ouvrages sans matériaux prévus (vieux chantiers) : la marge devis ne
    // compte aucun matériau, elle est trop belle. Le chiffre reste celui du
    // Phasage, mais il est signalé, sans écart calculé, et sort du total du
    // bandeau.
    const margeDevisSansMateriaux = margeDevis != null && vendu > 0 && num(fin?.mat_prev) === 0;
    const ecartDevis = margeProbable != null && margeDevis != null && !margeDevisSansMateriaux ? round2(margeProbable - margeDevis) : null;
    const repereDevis = eurParHeureDevis(vendu, v(fin, "heures_vendues"));

    out.push({
      chantierId: id, nom: str(c.nom) || str(fin?.chantier_nom) || id,
      disponible, repris,
      dateFinReleve: fin ? jour(fin.date_releve) : null,
      dateDepartReleve: dep ? jour(dep.date_releve) : null,
      avancement, avancementDepart: v(dep, "avancement"),
      vendu,
      production, margePeriode, heuresPeriode, eurParHeure,
      eurParHeureDevis: repereDevis == null ? null : round2(repereDevis),
      margeAvancement: disponible ? v(fin, "marge_avancement") : null,
      margeTerminaison: v(fin, "marge_terminaison"),
      margeProbable,
      margeProbablePct: pctSurV3(margeProbable, vendu),
      margeDevis: margeDevis == null ? null : round2(margeDevis),
      margeDevisPct: pctSurV3(margeDevis, vendu),
      margeDevisSansMateriaux,
      ecartDevis,
      evolutionMargeProbable,
      budgetRestant: v(fin, "budget_restant"),
      materiauxEnAvance: v(fin, "materiaux_en_avance"),
      heuresSansLot: v(fin, "heures_sans_lot"), pctSansLot: v(fin, "pct_sans_lot"),
      lots: listeSure(fin?.lots),
      alertes,
      mentions,
      pastille: pastille({ margeProbable: disponible ? v(fin, "marge_probable") : null, evolutionMargeProbable, margePeriode, nbAutresAlertes, seuilBaisse, disponible }),
    });
  }
  return out;
}

/** Bandeau du Bilan : totaux de la période sur les chantiers retenus. */
export function bandeauV3({ synthese, nbComptesRendusNonValides = 0 }) {
  const somme = k => {
    const vals = listeSure(synthese).map(s => s[k]).filter(x => x != null);
    return vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null;
  };
  const production = somme("production");
  const margePeriode = somme("margePeriode");
  const heuresValidees = somme("heuresPeriode");
  // Marge probable totale face à la marge devis totale : sur les seuls
  // chantiers où les deux sont connues (et leur vendu), pour comparer des
  // ensembles identiques ; sans les chantiers dont la marge devis ne compte
  // aucun matériau prévu.
  const comparables = listeSure(synthese).filter(s => s.margeProbable != null && s.margeDevis != null && s.vendu > 0 && !s.margeDevisSansMateriaux);
  const total = k => (comparables.length ? round2(comparables.reduce((a, s) => a + s[k], 0)) : null);
  const venduComparable = total("vendu");
  const margeProbableTotale = total("margeProbable");
  const margeDevisTotale = total("margeDevis");
  // Repère du devis global : Σ vendu ÷ Σ heures prévues des chantiers retenus.
  const avecRepere = listeSure(synthese).filter(s => s.eurParHeureDevis > 0 && s.vendu > 0);
  const heuresPrevuesTot = avecRepere.reduce((a, s) => a + s.vendu / s.eurParHeureDevis, 0);
  return {
    production,
    margePeriode,
    margePeriodePct: pctSurV3(margePeriode, production),
    evolutionMargeProbable: somme("evolutionMargeProbable"),
    margeProbableTotale, margeDevisTotale, venduComparable,
    margeProbableTotalePct: pctSurV3(margeProbableTotale, venduComparable),
    margeDevisTotalePct: pctSurV3(margeDevisTotale, venduComparable),
    nbChantiersComparables: comparables.length,
    nbChantiersHorsComparaison: listeSure(synthese).filter(s => s.disponible).length - comparables.length,
    heuresValidees,
    eurParHeure: production != null && heuresValidees > 0 ? round2(production / heuresValidees) : null,
    eurParHeureDevis: heuresPrevuesTot > 0 ? round2(avecRepere.reduce((a, s) => a + s.vendu, 0) / heuresPrevuesTot) : null,
    nbComptesRendusNonValides,
    nbIndisponibles: listeSure(synthese).filter(s => !s.disponible).length,
  };
}

// ── Alertes du PDF (choix de Loris du 26/10/2026) ───────────────────────────
// Version DIRECTION : au plus `max` points par chantier, triés par montant en
// jeu ; les constats qui reviennent chaque semaine passent dans la version
// détaillée : lot déjà terminé en dérive, heures sans lot, petits
// dépassements d'enveloppe (sous seuils.bilanDirectionEnveloppeMinEuros).
// Version DÉTAILLÉE : toutes les alertes, même tri. Les règles d'alerte
// (alertesMargesV2) ne changent pas : seulement ce que le PDF en montre.
export function alerteVersionDetailleeSeulementV3(a, seuils = null) {
  const s = normaliserSeuilsMarges(seuils);
  if (a?.motif === MOTIF_HEURES_SANS_LOT) return true;
  if (a?.motif === MOTIF_LOT_EN_DERIVE && num(a.avancementLot) != null && num(a.avancementLot) >= 100) return true;
  if (a?.motif === MOTIF_DEPASSEMENT_ENVELOPPE && !((num(a.euros) ?? 0) >= s.bilanDirectionEnveloppeMinEuros)) return true;
  return false;
}
export function alertesBilanV3(lignes, { version = "direction", seuils = null, max = 3 } = {}) {
  if (lignes == null) return null;
  const poids = a => Math.abs(num(a.impactMarge) ?? num(a.euros) ?? 0);
  return listeSure(lignes).map(l => {
    let items = listeSure(l.alertes)
      .filter(a => version !== "direction" || !alerteVersionDetailleeSeulementV3(a, seuils))
      .map(a => ({ motif: a.motif, probleme: str(a.probleme) || str(a.texte), heures: num(a.heures), impactMarge: num(a.impactMarge) }));
    items.sort((a, b) => poids(b) - poids(a));
    const total = items.length;
    if (version === "direction") items = items.slice(0, max);
    return { chantierId: str(l.chantier_id), nom: str(l.nom), items, nbMasques: total - items.length };
  }).filter(l => l.items.length > 0);
}

/** « 16 journées incomplètes sur 10 chantiers » (version direction). */
export function resumeJourneesIncompletesV3(avertissements) {
  const n = avertissements?.nbJoursIncomplets || 0;
  if (!n) return null;
  const nbCh = listeSure(avertissements.lignes).filter(l => listeSure(l.joursIncomplets).length).length;
  return `${n} journée${n > 1 ? "s" : ""} incomplète${n > 1 ? "s" : ""} sur ${nbCh} chantier${nbCh > 1 ? "s" : ""} (comptes rendus attendus manquants) : détail dans la version détaillée`;
}
/** Comptes rendus non validés (ligne d'avertissement, si > 0). */
export function resumeNonValidesV3(avertissements) {
  const n = avertissements?.nbNonValides || 0;
  if (!n) return null;
  const noms = listeSure(avertissements.lignes).filter(l => listeSure(l.nonValides).length).map(l => l.nom);
  return `${n} compte${n > 1 ? "s" : ""} rendu${n > 1 ? "s" : ""} non validé${n > 1 ? "s" : ""} (${noms.join(", ")}) : chiffres incomplets`;
}
/** « 23 chantiers en cours sans activité » (version direction). */
export function resumeSansActiviteV3(preselection) {
  const n = listeSure(preselection).filter(p => !p.actif).length;
  return n ? `${n} chantier${n > 1 ? "s" : ""} en cours sans activité sur la période` : null;
}

// ── Activité de la période et présélection des chantiers à exporter ─────────
/**
 * Activité par chantier sur [debut, fin] : heures pointées (validées), heures
 * déclarées dans des comptes rendus (validés ou non), avancements datés de la
 * période, commandes datées de la période.
 * @returns {Map<string, {heuresPointees, nbRapports, nbAvancements, nbCommandes, active, raisons}>}
 */
export function activiteChantiersV3({ periode, pointages = [], rapports = [], journal = [], commandes = [] }) {
  const m = new Map();
  const get = id => {
    if (!m.has(id)) m.set(id, { heuresPointees: 0, nbRapports: 0, nbAvancements: 0, nbCommandes: 0 });
    return m.get(id);
  };
  const dans = d => d && d >= periode.debut && d <= periode.fin;
  for (const p of listeSure(pointages)) {
    if (!dans(jour(p.date)) || !(num(p.heures) > 0)) continue;
    get(str(p.chantier_id)).heuresPointees += num(p.heures);
  }
  for (const r of listeSure(rapports)) if (dans(dateRapportIsoV3(r.date_rapport)) && str(r.chantier_id)) get(str(r.chantier_id)).nbRapports++;
  for (const j of listeSure(journal)) {
    if (!dans(jour(j.date_realisation)) || !str(j.chantier_id)) continue;
    if (["initial", "reconstitution"].includes(str(j.source))) continue;
    if (num(j.avancement_avant) === num(j.avancement_apres)) continue;
    get(str(j.chantier_id)).nbAvancements++;
  }
  for (const c of listeSure(commandes)) if (dans(jour(c.date)) && str(c.chantier_id)) get(str(c.chantier_id)).nbCommandes++;
  m.forEach(a => {
    a.heuresPointees = round2(a.heuresPointees);
    a.raisons = [
      a.heuresPointees > 0 || a.nbRapports > 0 ? "heures" : null,
      a.nbAvancements > 0 ? "avancement" : null,
      a.nbCommandes > 0 ? "commande" : null,
    ].filter(Boolean);
    a.active = a.raisons.length > 0;
  });
  return m;
}

export const MENTION_SANS_ACTIVITE = "aucune activité sur la période";

/**
 * Liste des chantiers en cours, avec la case cochée par défaut s'ils ont eu
 * de l'activité. `choix` = décochages / cochages manuels DE CETTE PÉRIODE
 * ({ [chantierId]: bool }) : ils priment sur la présélection ; la page les
 * oublie quand on change de période.
 */
export function preselectionChantiersV3({ chantiers, activite, choix = {} }) {
  return listeSure(chantiers).map(c => {
    const id = str(c.id);
    const a = activite?.get(id) || null;
    const actif = !!a?.active;
    const coche = Object.prototype.hasOwnProperty.call(choix, id) ? !!choix[id] : actif;
    return { chantierId: id, nom: str(c.nom) || id, actif, coche, manuel: Object.prototype.hasOwnProperty.call(choix, id),
      mention: actif ? null : MENTION_SANS_ACTIVITE, raisons: a?.raisons || [] };
  });
}

/** Ligne du PDF : « Chantiers en cours sans activité : A, B ». */
export function ligneSansActiviteV3(preselection) {
  const noms = listeSure(preselection).filter(p => !p.actif).map(p => p.nom);
  return noms.length ? `Chantiers en cours sans activité : ${noms.join(", ")}` : null;
}

/**
 * Avertissement avant l'export : comptes rendus soumis mais non validés et
 * journées incomplètes de la période, par chantier sélectionné.
 */
export function avertissementsExportV3({ periode, chantierIds, rapports = [], relevesLignes = [], noms = {} }) {
  const ids = new Set(listeSure(chantierIds).map(str));
  const dans = d => d && d >= periode.debut && d <= periode.fin;
  const parChantier = new Map();
  const get = id => {
    if (!parChantier.has(id)) parChantier.set(id, { chantierId: id, nom: noms[id] || id, nonValides: [], joursIncomplets: [] });
    return parChantier.get(id);
  };
  for (const r of listeSure(rapports)) {
    const id = str(r.chantier_id);
    if (!ids.has(id) || !dans(dateRapportIsoV3(r.date_rapport)) || str(r.statut) === "valide") continue;
    get(id).nonValides.push({ ouvrier: str(r.ouvrier), date: dateRapportIsoV3(r.date_rapport) });
  }
  for (const l of listeSure(relevesLignes)) {
    const id = str(l.chantier_id);
    if (!ids.has(id) || !dans(jour(l.date_releve)) || str(l.statut_completude) !== "incomplete") continue;
    get(id).joursIncomplets.push({ date: jour(l.date_releve), manquants: listeSure(l.cr_manquants) });
  }
  const lignes = [...parChantier.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const nbNonValides = lignes.reduce((s, l) => s + l.nonValides.length, 0);
  const avecNonValides = lignes.filter(l => l.nonValides.length);
  const nbJoursIncomplets = lignes.reduce((s, l) => s + l.joursIncomplets.length, 0);
  const textes = [];
  if (nbNonValides) {
    textes.push(`${nbNonValides} compte${nbNonValides > 1 ? "s" : ""} rendu${nbNonValides > 1 ? "s" : ""} non validé${nbNonValides > 1 ? "s" : ""} (${avecNonValides.map(l => l.nom).join(", ")}) : chiffres incomplets`);
  }
  if (nbJoursIncomplets) {
    const ch = lignes.filter(l => l.joursIncomplets.length);
    textes.push(`${nbJoursIncomplets} journée${nbJoursIncomplets > 1 ? "s" : ""} incomplète${nbJoursIncomplets > 1 ? "s" : ""} (${ch.map(l => `${l.nom} : ${l.joursIncomplets.map(j => fmtJourV3(j.date)).join(", ")}`).join(" ; ")})`);
  }
  return { lignes, nbNonValides, nbJoursIncomplets, textes };
}
