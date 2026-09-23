// ─────────────────────────────────────────────────────────────────────────────
// « La semaine qui vient » — proposition du moteur pour le Bilan Semaine
// (Chantier 07).
//
// Module de calcul PUR : aucune dépendance Supabase, aucune horloge, aucun
// effet de bord, aucune écriture. Extension .mjs = parsable ESM par Node sans
// build (scripts de vérification).
//
// Il ne calcule RIEN de neuf sur le planning : il découpe le résultat du
// moteur (`simulerPlanningGlobalV1`) sur les 7 jours qui suivent la semaine du
// bilan, et le réorganise en deux lectures utiles au conducteur :
//   - par chantier  : quels jours, combien d'heures, quelles personnes ;
//   - par personne  : sur quels chantiers, combien d'heures, quels jours.
// La liste des chantiers qui débordent de l'horizon vient telle quelle du
// module du 23/09 (`planningFinPrevisionnelleV1.mjs`) : on ne redéfinit pas
// l'invariant, on le réutilise.
//
// ⚠️ Proposition UNIQUEMENT. Rien ici n'est enregistré, rien ne pré-remplit la
// saisie libre du bilan : le moteur propose, l'humain complète et corrige.
//
// Conventions :
//  - dates ISO "YYYY-MM-DD", comparables par ordre alphabétique ;
//  - une entrée vide ou malformée ne casse rien : elle produit des listes vides ;
//  - arithmétique de dates en entiers (aucun objet Date) : déterminisme total,
//    aucun décalage de fuseau, aucune dépendance à l'heure de la machine.
// ─────────────────────────────────────────────────────────────────────────────
import { finPrevisionnelleParChantierV1 } from "./planningFinPrevisionnelleV1.mjs";

export const BILAN_SEMAINE_PROCHAINE_VERSION = "bilan_semaine_prochaine_v1";

// Nombre de jours de la fenêtre : la semaine entière qui suit celle du bilan.
export const JOURS_SEMAINE_PROCHAINE = 7;

const str = v => (v == null ? "" : String(v).trim());
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const listeSure = v => (Array.isArray(v) ? v : []);

const dateISO = v => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ── Arithmétique calendaire pure (algorithme « days from civil ») ────────────
// Convertit une date civile en numéro de jour depuis le 01/01/1970 et
// réciproquement. Aucun objet Date : le résultat ne dépend ni du fuseau de la
// machine ni de l'heure à laquelle on lance le calcul.
function jourDepuisCivil(y, m, d) {
  const an = y - (m <= 2 ? 1 : 0);
  const ere = Math.floor(an / 400);
  const anDansEre = an - ere * 400;
  const jourDansAn = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const jourDansEre = anDansEre * 365 + Math.floor(anDansEre / 4) - Math.floor(anDansEre / 100) + jourDansAn;
  return ere * 146097 + jourDansEre - 719468;
}

function civilDepuisJour(z) {
  const zz = z + 719468;
  const ere = Math.floor(zz / 146097);
  const jourDansEre = zz - ere * 146097;
  const anDansEre = Math.floor((jourDansEre - Math.floor(jourDansEre / 1460) + Math.floor(jourDansEre / 36524) - Math.floor(jourDansEre / 146096)) / 365);
  const an = anDansEre + ere * 400;
  const jourDansAn = jourDansEre - (365 * anDansEre + Math.floor(anDansEre / 4) - Math.floor(anDansEre / 100));
  const mp = Math.floor((5 * jourDansAn + 2) / 153);
  const d = jourDansAn - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: an + (m <= 2 ? 1 : 0), m, d };
}

const versISO = z => {
  const { y, m, d } = civilDepuisJour(z);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const depuisISO = iso => {
  const [y, m, d] = iso.split("-").map(Number);
  return jourDepuisCivil(y, m, d);
};

/** Ajoute n jours à une date ISO. Renvoie null si la date est illisible. */
export function ajouterJoursV1(iso, n) {
  const base = dateISO(iso);
  if (base == null) return null;
  return versISO(depuisISO(base) + Math.trunc(num(n)));
}

/**
 * Lundi de la semaine ISO `AAAA-Wnn`. Règle ISO-8601 : la semaine 1 est celle
 * qui contient le 4 janvier.
 */
export function lundiSemaineISOv1(weekId) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(str(weekId));
  if (!m) return null;
  const annee = Number(m[1]);
  const semaine = Number(m[2]);
  if (!(semaine >= 1 && semaine <= 53)) return null;
  const jan4 = jourDepuisCivil(annee, 1, 4);
  const jourSemaine = ((jan4 + 3) % 7 + 7) % 7 + 1; // 1 = lundi … 7 = dimanche
  const lundiSemaine1 = jan4 - (jourSemaine - 1);
  return versISO(lundiSemaine1 + (semaine - 1) * 7);
}

/**
 * Fenêtre des 7 jours qui SUIVENT la semaine du bilan.
 * Accepte un week_id `AAAA-Wnn` ou directement le lundi de la semaine du bilan.
 *
 * @returns {{ debut:string, fin:string, jours:string[] }|null}
 */
export function fenetreSemaineProchaineV1(semaineDuBilan) {
  const lundiBilan = lundiSemaineISOv1(semaineDuBilan) || dateISO(semaineDuBilan);
  if (!lundiBilan) return null;
  const debut = ajouterJoursV1(lundiBilan, JOURS_SEMAINE_PROCHAINE);
  const jours = [];
  for (let i = 0; i < JOURS_SEMAINE_PROCHAINE; i++) jours.push(ajouterJoursV1(debut, i));
  return { debut, fin: jours[jours.length - 1], jours };
}

// Le moteur renvoie l'objet complet, mais une simulation l'imbrique sous
// `proposition`. On accepte les deux, comme le module de fin prévisionnelle.
function allocationsDe(resultat) {
  if (!resultat || typeof resultat !== "object") return [];
  if (Array.isArray(resultat.allocations_proposees)) return resultat.allocations_proposees;
  const p = resultat.proposition;
  return p && typeof p === "object" ? listeSure(p.allocations_proposees) : [];
}

/**
 * Découpe la proposition du moteur sur la semaine qui vient.
 *
 * @param {object} args
 * @param {object} args.resultatMoteur  résultat de simulerPlanningGlobalV1 (ou sa `proposition`)
 * @param {string} args.semaineDuBilan  week_id `AAAA-Wnn` ou lundi ISO de la semaine du bilan
 * @param {object} [args.fenetre]       fenêtre explicite { debut, fin } (prioritaire)
 */
export function bilanSemaineProchaineV1({ resultatMoteur, semaineDuBilan, fenetre } = {}) {
  const fen = normaliserFenetre(fenetre) || fenetreSemaineProchaineV1(semaineDuBilan);
  const toutes = allocationsDe(resultatMoteur);

  // La fin prévisionnelle est calculée sur TOUT l'horizon, pas sur la fenêtre :
  // un chantier peut déborder bien au-delà des 7 jours affichés.
  const fin = finPrevisionnelleParChantierV1(resultatMoteur);
  const chantiersAuDelaHorizon = fin.chantiers.filter(c => !c.complet);

  const vide = {
    version: BILAN_SEMAINE_PROCHAINE_VERSION,
    fenetre: fen,
    par_chantier: [],
    par_personne: [],
    chantiers_au_dela_horizon: chantiersAuDelaHorizon,
    resume: {
      chantiers: 0, personnes: 0, heures_mo: 0, allocations_retenues: 0,
      allocations_hors_fenetre: 0, jours_couverts: 0,
      chantiers_au_dela_horizon: chantiersAuDelaHorizon.length,
    },
  };
  if (!fen) return { ...vide, fenetre: null };

  const chantiers = new Map();
  const personnes = new Map();
  let retenues = 0;
  let horsFenetre = 0;

  for (const a of toutes) {
    if (!a || typeof a !== "object") continue;
    const date = dateISO(a.date);
    // Hors des 7 jours : l'allocation existe mais ne concerne pas cette section.
    if (!date || date < fen.debut || date > fen.fin) { if (date) horsFenetre += 1; continue; }
    const chantierId = str(a.chantier_id);
    if (!chantierId) continue; // une allocation sans chantier n'appartient à personne
    retenues += 1;

    const ressources = listeSure(a.resource_ids).map(str).filter(Boolean);
    const heuresMO = num(a.heures_mo);
    // heures_mo = durée × nombre de personnes. Pour une personne, ce qui compte
    // est la durée passée sur place, pas la MO cumulée de l'équipe.
    const heuresParPersonne = Number.isFinite(Number(a.duree)) && Number(a.duree) > 0
      ? num(a.duree)
      : (ressources.length ? heuresMO / ressources.length : heuresMO);

    const ch = entreeChantier(chantiers, chantierId);
    ch.nb_allocations += 1;
    ch.heures_mo += heuresMO;
    ch.jours.add(date);
    ressources.forEach(r => ch.resource_ids.add(r));
    const texte = str(a.texte);
    if (texte) ch.taches.add(texte);

    for (const rid of ressources) {
      const pe = entreePersonne(personnes, rid);
      pe.heures_mo += heuresParPersonne;
      pe.jours.add(date);
      const parChantier = pe.chantiers.get(chantierId) || { chantier_id: chantierId, heures_mo: 0, jours: new Set() };
      parChantier.heures_mo += heuresParPersonne;
      parChantier.jours.add(date);
      pe.chantiers.set(chantierId, parChantier);
      // Deux chantiers différents le même jour pour la même personne : c'est le
      // signal opérationnel que le conducteur veut voir tout de suite.
      const duJour = pe.parJour.get(date) || new Set();
      duJour.add(chantierId);
      pe.parJour.set(date, duJour);
    }
  }

  const parChantier = [...chantiers.values()].map(c => ({
    chantier_id: c.chantier_id,
    jours: [...c.jours].sort(),
    premier_jour: [...c.jours].sort()[0] || null,
    nb_allocations: c.nb_allocations,
    heures_mo: round2(c.heures_mo),
    resource_ids: [...c.resource_ids].sort(),
    taches: [...c.taches],
  })).sort((a, b) =>
    (a.premier_jour === b.premier_jour ? 0 : a.premier_jour < b.premier_jour ? -1 : 1)
    || a.chantier_id.localeCompare(b.chantier_id)
  );

  const parPersonne = [...personnes.values()].map(p => {
    const multi = [...p.parJour.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([date, ids]) => ({ date, chantier_ids: [...ids].sort() }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      resource_id: p.resource_id,
      heures_mo: round2(p.heures_mo),
      jours: [...p.jours].sort(),
      chantiers: [...p.chantiers.values()]
        .map(c => ({ chantier_id: c.chantier_id, heures_mo: round2(c.heures_mo), jours: [...c.jours].sort() }))
        .sort((a, b) => b.heures_mo - a.heures_mo || a.chantier_id.localeCompare(b.chantier_id)),
      nb_chantiers: p.chantiers.size,
      multi_chantiers_meme_jour: multi,
    };
  }).sort((a, b) => b.heures_mo - a.heures_mo || a.resource_id.localeCompare(b.resource_id));

  const joursCouverts = new Set();
  parChantier.forEach(c => c.jours.forEach(j => joursCouverts.add(j)));

  return {
    version: BILAN_SEMAINE_PROCHAINE_VERSION,
    fenetre: fen,
    par_chantier: parChantier,
    par_personne: parPersonne,
    chantiers_au_dela_horizon: chantiersAuDelaHorizon,
    resume: {
      chantiers: parChantier.length,
      personnes: parPersonne.length,
      heures_mo: round2(parChantier.reduce((s, c) => s + c.heures_mo, 0)),
      allocations_retenues: retenues,
      allocations_hors_fenetre: horsFenetre,
      jours_couverts: joursCouverts.size,
      chantiers_au_dela_horizon: chantiersAuDelaHorizon.length,
    },
  };
}

function normaliserFenetre(fenetre) {
  if (!fenetre || typeof fenetre !== "object") return null;
  const debut = dateISO(fenetre.debut);
  if (!debut) return null;
  const jours = [];
  for (let i = 0; i < JOURS_SEMAINE_PROCHAINE; i++) jours.push(ajouterJoursV1(debut, i));
  const fin = dateISO(fenetre.fin) || jours[jours.length - 1];
  return { debut, fin, jours: jours.filter(j => j <= fin) };
}

function entreeChantier(map, chantierId) {
  let e = map.get(chantierId);
  if (!e) {
    e = { chantier_id: chantierId, nb_allocations: 0, heures_mo: 0, jours: new Set(), resource_ids: new Set(), taches: new Set() };
    map.set(chantierId, e);
  }
  return e;
}

function entreePersonne(map, resourceId) {
  let e = map.get(resourceId);
  if (!e) {
    e = { resource_id: resourceId, heures_mo: 0, jours: new Set(), chantiers: new Map(), parJour: new Map() };
    map.set(resourceId, e);
  }
  return e;
}
