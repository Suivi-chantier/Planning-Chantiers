// src/Renovation/organisationJour.mjs — Organisation de la semaine par jour
// (projet docs/projets/organisation-par-jour.md, étape 1).
//
// Module pur : aucun accès Supabase, aucune horloge, aucun effet de bord.
// La date du jour (« AAAA-MM-JJ ») et la valeur de `utilisateurs.nav_order`
// arrivent en paramètre. Façade front : organisationJour.js.
//
// `nav_order` existe sous deux formats, tous deux acceptés :
//   - ancien format : une simple liste d'identifiants de pages (l'ordre
//     habituel réglé par glisser-déposer), ou null ;
//   - nouveau format : un objet
//       {
//         ordre: ["dashboard", "planning", ...],   // ordre habituel
//         jours: { lundi: { theme, accueil, devant, rendez_vous, blocs }, ... },
//         ordre_habituel_le: "AAAA-MM-JJ"          // bouton « Ordre habituel aujourd'hui »
//       }
// Un utilisateur sans organisation garde exactement le même contenu en base
// (liste simple ou null) : voir ecrireOrdre / reinitialiserOrdre.

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Jours qui peuvent porter une organisation (samedi et dimanche : jamais, règle 6). */
export const JOURS_ORGANISATION = Object.freeze(["lundi", "mardi", "mercredi", "jeudi", "vendredi"]);

/** Noms des jours, dans l'ordre de getUTCDay() (0 = dimanche). */
const NOMS_JOURS = Object.freeze(["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]);

/** Catalogue des blocs du tableau de bord du jour (seuls identifiants acceptés). */
export const CATALOGUE_BLOCS = Object.freeze([
  "bilan_semaine_passee",
  "commandes_a_saisir",
  "chantiers_a_venir",
  "administratif_fournisseurs",
  "tournee_chantiers",
  "planning_semaine_suivante",
  "materiaux_a_commander",
]);

/** Clé de `nav_order` qui porte la date du mode « Ordre habituel aujourd'hui ». */
export const CLE_ORDRE_HABITUEL = "ordre_habituel_le";

const deepFreeze = (o) => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

/**
 * Modèle « Conducteur de travaux » (organisation de Loris, tableau du fichier
 * projet). Proposé dans l'écran « Mon organisation » ; jamais écrit tout seul
 * en base. Constante figée : utiliser copieModeleConducteurTravaux() pour
 * obtenir une copie modifiable.
 */
export const MODELE_CONDUCTEUR_TRAVAUX = deepFreeze({
  lundi: {
    theme: "Bilan, réunion et commandes",
    accueil: "bilan-semaine",
    devant: ["bilan-semaine", "commandes", "capture-cmd"],
    rendez_vous: [{ heure: null, libelle: "Réunion sur la semaine passée" }],
    blocs: ["bilan_semaine_passee", "commandes_a_saisir"],
  },
  mardi: {
    theme: "Chantiers à venir",
    accueil: "operations",
    devant: ["operations", "phasage-v2", "planning-commandes"],
    rendez_vous: [],
    blocs: ["chantiers_a_venir"],
  },
  mercredi: {
    theme: "Application, plans et administratif",
    accueil: "plans",
    devant: ["plans", "rapprochement", "encours-fournisseurs"],
    rendez_vous: [{ heure: "09:30", libelle: "Réunion appli et IA avec Matthieu" }],
    blocs: ["administratif_fournisseurs"],
  },
  jeudi: {
    theme: "Tournée des chantiers et anticipation",
    accueil: "alertes",
    devant: ["alertes", "retours-terrain", "phasage-v2", "planning"],
    rendez_vous: [],
    blocs: ["tournee_chantiers"],
  },
  vendredi: {
    theme: "Planning et commandes S+1",
    accueil: "planning",
    devant: ["planning", "planning-commandes", "commandes"],
    rendez_vous: [],
    blocs: ["planning_semaine_suivante", "materiaux_a_commander"],
  },
});

/** Copie modifiable du modèle « Conducteur de travaux » (objet `jours`). */
export function copieModeleConducteurTravaux() {
  return JSON.parse(JSON.stringify(MODELE_CONDUCTEUR_TRAVAUX));
}

// ─── Outils internes ─────────────────────────────────────────────────────────

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const texteOuNull = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const listeIdsUniques = (v) => {
  if (!Array.isArray(v)) return [];
  const vus = new Set();
  const res = [];
  for (const id of v) {
    if (typeof id !== "string" || id === "" || vus.has(id)) continue;
    vus.add(id);
    res.push(id);
  }
  return res;
};
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Vrai si `v` est une date « AAAA-MM-JJ » qui existe au calendrier. */
export function estDateIso(v) {
  if (typeof v !== "string") return false;
  const m = RE_DATE.exec(v);
  if (!m) return false;
  const a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]);
  if (mo < 1 || mo > 12 || j < 1) return false;
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

/** Normalise la configuration d'un jour ; null si l'entrée n'est pas un objet. */
function normaliserJour(brut) {
  if (!estObjet(brut)) return null;
  const rendez_vous = [];
  if (Array.isArray(brut.rendez_vous)) {
    for (const rdv of brut.rendez_vous) {
      if (!estObjet(rdv)) continue;
      const libelle = texteOuNull(rdv.libelle);
      if (!libelle) continue;
      const heure = typeof rdv.heure === "string" && RE_HEURE.test(rdv.heure.trim()) ? rdv.heure.trim() : null;
      rendez_vous.push({ heure, libelle });
    }
  }
  return {
    theme: texteOuNull(brut.theme),
    accueil: texteOuNull(brut.accueil),
    devant: listeIdsUniques(brut.devant),
    rendez_vous,
    blocs: listeIdsUniques(brut.blocs).filter((b) => CATALOGUE_BLOCS.includes(b)),
  };
}

// ─── Lecture de nav_order ────────────────────────────────────────────────────

/**
 * Lit `nav_order` sous ses deux formats et renvoie une forme normalisée :
 *   {
 *     ordre: string[] | null,       // ordre habituel (null = ordre par défaut)
 *     jours: { lundi?: {...}, ... }, // seulement lundi…vendredi valides
 *     ordreHabituelLe: string | null,
 *     aOrganisation: boolean,       // au moins un jour configuré
 *   }
 * Tout ce qui est invalide (texte, nombre, objet sans `jours`, `ordre` qui
 * n'est pas une liste, jour inconnu…) est toléré et ignoré, sans erreur.
 */
export function lireNavOrder(navOrder) {
  if (Array.isArray(navOrder)) {
    return { ordre: navOrder.filter((id) => typeof id === "string"), jours: {}, ordreHabituelLe: null, aOrganisation: false };
  }
  if (!estObjet(navOrder)) {
    return { ordre: null, jours: {}, ordreHabituelLe: null, aOrganisation: false };
  }
  const ordre = Array.isArray(navOrder.ordre) ? navOrder.ordre.filter((id) => typeof id === "string") : null;
  const jours = {};
  if (estObjet(navOrder.jours)) {
    for (const j of JOURS_ORGANISATION) {
      const conf = normaliserJour(navOrder.jours[j]);
      if (conf) jours[j] = conf;
    }
  }
  const ordreHabituelLe = estDateIso(navOrder[CLE_ORDRE_HABITUEL]) ? navOrder[CLE_ORDRE_HABITUEL] : null;
  return { ordre, jours, ordreHabituelLe, aOrganisation: Object.keys(jours).length > 0 };
}

// ─── Écriture de nav_order ───────────────────────────────────────────────────

/**
 * Nouvelle valeur de `nav_order` après un glisser-déposer : remplace l'ordre
 * habituel sans effacer `jours` (ni le mode « ordre habituel aujourd'hui », ni
 * les autres clés de l'objet).
 * Sans organisation (null, ancienne liste, objet sans jour configuré), renvoie
 * la liste simple : le contenu en base reste exactement celui d'aujourd'hui.
 */
export function ecrireOrdre(navOrder, nouvelOrdre) {
  const ordre = Array.isArray(nouvelOrdre) ? nouvelOrdre.filter((id) => typeof id === "string") : null;
  if (!lireNavOrder(navOrder).aOrganisation) return ordre;
  return { ...navOrder, ordre };
}

/**
 * Nouvelle valeur de `nav_order` après « Réinitialiser l'ordre » : sans
 * organisation, null (comportement actuel) ; avec organisation, l'objet sans
 * `ordre` (les jours sont conservés).
 */
export function reinitialiserOrdre(navOrder) {
  if (!lireNavOrder(navOrder).aOrganisation) return null;
  const { ordre: _ignore, ...reste } = navOrder;
  return reste;
}

/**
 * Active le mode « Ordre habituel aujourd'hui » (règle 7) pour la date donnée.
 * Il expire tout seul le lendemain (la date stockée ne correspond plus).
 * Sans organisation, il n'y a rien à neutraliser : la valeur est rendue telle
 * quelle, pour ne rien changer en base.
 */
export function activerOrdreHabituel(navOrder, dateIso) {
  if (!estDateIso(dateIso)) return navOrder ?? null;
  if (!lireNavOrder(navOrder).aOrganisation) return navOrder ?? null;
  return { ...navOrder, [CLE_ORDRE_HABITUEL]: dateIso };
}

/** Désactive le mode « Ordre habituel aujourd'hui » (retour à l'organisation du jour). */
export function desactiverOrdreHabituel(navOrder) {
  if (!estObjet(navOrder) || !(CLE_ORDRE_HABITUEL in navOrder)) return navOrder ?? null;
  const { [CLE_ORDRE_HABITUEL]: _ignore, ...reste } = navOrder;
  if (!lireNavOrder(reste).aOrganisation) return lireNavOrder(reste).ordre;
  return reste;
}

// ─── Jour et organisation du jour ────────────────────────────────────────────

/**
 * Jour de la semaine d'une date « AAAA-MM-JJ » : "lundi" … "dimanche", ou
 * null si la date est invalide. Calculé sur la chaîne (en UTC), jamais en
 * heure locale : aucun décalage de fuseau possible.
 */
export function jourDeLaSemaine(dateIso) {
  if (!estDateIso(dateIso)) return null;
  const [a, m, j] = dateIso.split("-").map(Number);
  return NOMS_JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()];
}

/** Vrai si le mode « Ordre habituel aujourd'hui » est actif à cette date. */
export function ordreHabituelActif(navOrder, dateIso) {
  const { ordreHabituelLe } = lireNavOrder(navOrder);
  return ordreHabituelLe !== null && ordreHabituelLe === dateIso;
}

/**
 * Organisation configurée pour la date donnée :
 *   { jour, theme, accueil, devant, rendez_vous, blocs }
 * ou null (samedi, dimanche, date invalide, jour non configuré).
 * Reste lisible même en mode « ordre habituel aujourd'hui » : le bandeau du
 * jour continue d'afficher thème et rendez-vous (règle 7).
 */
export function organisationDuJour(navOrder, dateIso) {
  const jour = jourDeLaSemaine(dateIso);
  if (!jour || !JOURS_ORGANISATION.includes(jour)) return null;
  const conf = lireNavOrder(navOrder).jours[jour];
  return conf ? { jour, ...conf } : null;
}

/** Organisation à appliquer à la navigation et au tableau de bord (null si mode « ordre habituel »). */
function organisationAppliquee(navOrder, dateIso) {
  if (ordreHabituelActif(navOrder, dateIso)) return null;
  return organisationDuJour(navOrder, dateIso);
}

// ─── Ordre des pages ─────────────────────────────────────────────────────────

/**
 * Ordre habituel des pages : reproduction exacte de l'algorithme historique
 * de la barre latérale (Navigation.jsx, Sidebar) — sans ordre, les pages
 * autorisées dans leur ordre par défaut ; sinon les identifiants connus
 * d'abord dans l'ordre choisi (doublons ignorés), puis les pages autorisées
 * pas encore classées, à la fin.
 * @param {string[]} pagesAutorisees identifiants, dans l'ordre par défaut
 * @param {string[]|null} ordre
 */
export function ordreHabituel(pagesAutorisees, ordre) {
  const pages = Array.isArray(pagesAutorisees) ? pagesAutorisees : [];
  if (!ordre) return pages.slice();
  const connues = new Set(pages);
  const vus = new Set();
  const res = [];
  ordre.forEach((id) => {
    if (connues.has(id) && !vus.has(id)) { res.push(id); vus.add(id); }
  });
  pages.forEach((id) => { if (!vus.has(id)) res.push(id); });
  return res;
}

/**
 * Ordre des pages du menu pour la date donnée.
 * Ordre habituel, puis, si une organisation s'applique ce jour-là, les pages
 * de `devant` (autorisées seulement, sans doublon, inconnues ignorées)
 * remontent en tête dans l'ordre indiqué ; toutes les autres gardent l'ordre
 * habituel. Aucune page ne disparaît (règle 4).
 * @param {string[]} pagesAutorisees identifiants, dans l'ordre par défaut
 */
export function ordreDesPages(pagesAutorisees, navOrder, dateIso) {
  const habituel = ordreHabituel(pagesAutorisees, lireNavOrder(navOrder).ordre);
  const org = organisationAppliquee(navOrder, dateIso);
  if (!org || org.devant.length === 0) return habituel;
  const autorisees = new Set(habituel);
  const tete = org.devant.filter((id) => autorisees.has(id));
  const enTete = new Set(tete);
  return [...tete, ...habituel.filter((id) => !enTete.has(id))];
}

/**
 * Page d'arrivée à l'ouverture de l'application (règle 5) : `accueil` du jour
 * s'il est autorisé, sinon null (= comportement actuel). Null aussi le week-end,
 * sans organisation, et en mode « ordre habituel aujourd'hui ».
 */
export function pageDArrivee(pagesAutorisees, navOrder, dateIso) {
  const org = organisationAppliquee(navOrder, dateIso);
  if (!org || !org.accueil) return null;
  return Array.isArray(pagesAutorisees) && pagesAutorisees.includes(org.accueil) ? org.accueil : null;
}

/**
 * Blocs du tableau de bord du jour, dans l'ordre de la configuration
 * (identifiants du catalogue uniquement, sans doublon). Liste vide le
 * week-end, sans organisation, et en mode « ordre habituel aujourd'hui ».
 */
export function blocsDuJour(navOrder, dateIso) {
  const org = organisationAppliquee(navOrder, dateIso);
  return org ? org.blocs.slice() : [];
}

/**
 * Tout l'état du jour en un appel (pour la navigation et le tableau de bord) :
 *   { jour, organisation, ordreHabituel, pages, accueil, blocs }
 * `organisation` reste renseignée en mode « ordre habituel » (bandeau).
 */
export function etatDuJour(pagesAutorisees, navOrder, dateIso) {
  return {
    jour: jourDeLaSemaine(dateIso),
    organisation: organisationDuJour(navOrder, dateIso),
    ordreHabituel: ordreHabituelActif(navOrder, dateIso),
    pages: ordreDesPages(pagesAutorisees, navOrder, dateIso),
    accueil: pageDArrivee(pagesAutorisees, navOrder, dateIso),
    blocs: blocsDuJour(navOrder, dateIso),
  };
}
