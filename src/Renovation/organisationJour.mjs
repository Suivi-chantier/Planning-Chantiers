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

// ─── Barre du bas (téléphone) ────────────────────────────────────────────────

/**
 * Vrai si l'organisation du jour change réellement l'ordre du menu : un jour
 * configuré, hors mode « ordre habituel aujourd'hui », avec au moins une page
 * de `devant` autorisée.
 * @param {string[]} pagesAutorisees identifiants autorisés
 */
export function ordreDuJourActif(pagesAutorisees, navOrder, dateIso) {
  const org = organisationAppliquee(navOrder, dateIso);
  if (!org) return false;
  const autorisees = new Set(Array.isArray(pagesAutorisees) ? pagesAutorisees : []);
  return org.devant.some((id) => autorisees.has(id));
}

/**
 * Ordre des pages de la barre du bas (téléphone : 4 premiers raccourcis +
 * « Plus »). Historiquement, cette barre ignore l'ordre personnalisé
 * (glisser-déposer) et suit son propre ordre par défaut : on le garde tel quel
 * tant qu'aucune organisation du jour n'est active (règle 1 : rien ne change
 * sans organisation). Quand l'organisation du jour est active, la barre prend
 * exactement l'ordre de la barre latérale (ordreDesPages).
 * @param {string[]} pagesBas    pages autorisées, dans l'ordre par défaut de la barre du bas
 * @param {string[]} pagesMenu   mêmes pages, dans l'ordre par défaut de la barre latérale
 */
export function ordreBarreDuBas(pagesBas, pagesMenu, navOrder, dateIso) {
  const bas = Array.isArray(pagesBas) ? pagesBas : [];
  if (!ordreDuJourActif(pagesMenu, navOrder, dateIso)) return bas.slice();
  return ordreDesPages(pagesMenu, navOrder, dateIso);
}

// ─── Page d'arrivée à l'ouverture et bouton « Ordre habituel aujourd'hui » ───

/**
 * Page à ouvrir au démarrage de l'application (règle 5), ou null pour garder
 * le comportement actuel. La décision n'est prise qu'une fois par ouverture
 * (`dejaDecide`), et jamais si une page a été demandée explicitement (lien
 * « ?page=… » ou « #page » d'une notification ou d'un favori :
 * `demandeExplicite`) ni si l'utilisateur a déjà navigué (`dejaNavigue`).
 * @param {{ pagesAutorisees: string[], navOrder: any, dateIso: string,
 *           dejaDecide?: boolean, demandeExplicite?: boolean, dejaNavigue?: boolean }} p
 */
export function pageAOuvrirAuDemarrage({ pagesAutorisees, navOrder, dateIso, dejaDecide = false, demandeExplicite = false, dejaNavigue = false } = {}) {
  if (dejaDecide || demandeExplicite || dejaNavigue) return null;
  return pageDArrivee(pagesAutorisees, navOrder, dateIso);
}

/** Libellés du bouton de la règle 7. */
export const LIBELLE_ORDRE_HABITUEL = "Ordre habituel aujourd'hui";
export const LIBELLE_RETOUR_ORGANISATION = "Revenir à l'organisation du jour";

/**
 * État du bouton « Ordre habituel aujourd'hui » (règle 7) :
 *   null — bouton masqué (week-end, jour non configuré, sans organisation) ;
 *   { actif, libelle } — `actif` vrai si le mode est déjà en place ce jour-là
 *   (le bouton propose alors de revenir à l'organisation du jour).
 */
export function boutonOrdreHabituel(navOrder, dateIso) {
  if (!organisationDuJour(navOrder, dateIso)) return null;
  const actif = ordreHabituelActif(navOrder, dateIso);
  return { actif, libelle: actif ? LIBELLE_RETOUR_ORGANISATION : LIBELLE_ORDRE_HABITUEL };
}

/**
 * Nouvelle valeur de `nav_order` après un clic sur ce bouton : active le mode
 * pour la date donnée, ou le désactive s'il l'est déjà. Sans bouton (aucune
 * organisation ce jour-là), la valeur est rendue telle quelle.
 */
export function basculerOrdreHabituel(navOrder, dateIso) {
  const b = boutonOrdreHabituel(navOrder, dateIso);
  if (!b) return navOrder ?? null;
  return b.actif ? desactiverOrdreHabituel(navOrder) : activerOrdreHabituel(navOrder, dateIso);
}

// ─── Écran « Mon organisation » (profil, étape 3) ────────────────────────────

/** Libellés métier des blocs du tableau de bord (écran « Mon organisation »). */
export const LIBELLES_BLOCS = Object.freeze({
  bilan_semaine_passee: "Bilan de la semaine passée",
  commandes_a_saisir: "Commandes à saisir",
  chantiers_a_venir: "Chantiers à venir",
  administratif_fournisseurs: "Administratif fournisseurs",
  tournee_chantiers: "Tournée des chantiers",
  planning_semaine_suivante: "Planning de la semaine suivante",
  materiaux_a_commander: "Matériaux à commander",
});

/** Vrai si la configuration d'un jour (déjà normalisée) ne contient rien. */
function jourVide(conf) {
  return !conf || (!conf.theme && !conf.accueil && conf.devant.length === 0
    && conf.rendez_vous.length === 0 && conf.blocs.length === 0);
}

/**
 * Normalise l'objet `jours` saisi dans l'écran : seulement lundi…vendredi,
 * textes rognés, heures « HH:MM » ou null, rendez-vous sans libellé retirés,
 * doublons et blocs hors catalogue retirés. Un jour laissé vide n'est pas
 * gardé (pas d'organisation ce jour-là).
 */
export function normaliserJours(jours) {
  const res = {};
  if (!estObjet(jours)) return res;
  for (const j of JOURS_ORGANISATION) {
    const conf = normaliserJour(jours[j]);
    if (!jourVide(conf)) res[j] = conf;
  }
  return res;
}

/**
 * Retire l'organisation de la semaine et revient exactement au comportement
 * d'avant : l'ordre habituel seul (liste simple, comme le glisser-déposer
 * l'enregistre sans organisation), ou null s'il n'y en avait pas. Le mode
 * « Ordre habituel aujourd'hui » disparaît avec l'organisation.
 */
export function supprimerOrganisation(navOrder) {
  return lireNavOrder(navOrder).ordre ?? null;
}

/**
 * Nouvelle valeur de `nav_order` après « Enregistrer » dans l'écran « Mon
 * organisation » : l'objet { ordre, jours } en conservant l'ordre habituel
 * (liste ou `ordre` de l'objet), le mode « Ordre habituel aujourd'hui » et
 * les autres clés existantes. Si aucun jour n'est rempli, c'est une
 * suppression (supprimerOrganisation).
 */
export function ecrireJours(navOrder, jours) {
  const propres = normaliserJours(jours);
  if (Object.keys(propres).length === 0) return supprimerOrganisation(navOrder);
  const base = estObjet(navOrder) ? { ...navOrder } : {};
  const { ordre } = lireNavOrder(navOrder);
  if (ordre) base.ordre = ordre; else delete base.ordre;
  return { ...base, jours: propres };
}

/**
 * Garde, pour chaque jour, seulement les pages autorisées pour le rôle
 * (règle 2 : une page non autorisée est ignorée sans erreur, mais l'écran le
 * signale). Renvoie { jours, retirees: [{ jour, champ: "accueil"|"devant", id }] }.
 * Les jours, thèmes, rendez-vous et blocs sont gardés tels quels.
 * @param {object} jours
 * @param {string[]} pagesAutorisees
 */
export function filtrerPagesAutorisees(jours, pagesAutorisees) {
  const autorisees = new Set(Array.isArray(pagesAutorisees) ? pagesAutorisees : []);
  const res = {};
  const retirees = [];
  if (!estObjet(jours)) return { jours: res, retirees };
  for (const j of JOURS_ORGANISATION) {
    const conf = jours[j];
    if (!estObjet(conf)) continue;
    const copie = JSON.parse(JSON.stringify(conf));
    if (typeof copie.accueil === "string" && copie.accueil !== "" && !autorisees.has(copie.accueil)) {
      retirees.push({ jour: j, champ: "accueil", id: copie.accueil });
      copie.accueil = null;
    }
    if (Array.isArray(copie.devant)) {
      copie.devant = copie.devant.filter((id) => {
        if (autorisees.has(id)) return true;
        retirees.push({ jour: j, champ: "devant", id });
        return false;
      });
    }
    res[j] = copie;
  }
  return { jours: res, retirees };
}

// ─── Tableau de bord du jour (étape 4, tâche 5) ──────────────────────────────

/** Noms des mois, pour le libellé de date du bandeau. */
const NOMS_MOIS = Object.freeze(["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"]);

/** « Lundi 23 novembre » pour « 2026-11-23 » (null si la date est invalide). */
export function libelleDateDuJour(dateIso) {
  const jour = jourDeLaSemaine(dateIso);
  if (!jour) return null;
  const [, m, j] = dateIso.split("-").map(Number);
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} ${j} ${NOMS_MOIS[m - 1]}`;
}

/**
 * Rendez-vous du jour dans l'ordre d'affichage du bandeau : d'abord ceux qui
 * ont une heure, du plus tôt au plus tard (à heure égale, ordre saisi) ; puis
 * ceux sans heure, à la fin, dans l'ordre saisi. Choix : une heure précise est
 * une contrainte de la journée, elle passe devant ; un rendez-vous sans heure
 * (« après le bilan ») se cale dans la journée selon ce que l'utilisateur a
 * écrit, et l'ordre saisi est le seul repère dont on dispose.
 * Entrées invalides (sans libellé) retirées ; heure invalide = sans heure.
 * @param {{heure?: string|null, libelle: string}[]} rendezVous
 */
export function trierRendezVous(rendezVous) {
  const propres = normaliserJour({ rendez_vous: rendezVous })?.rendez_vous || [];
  const avecHeure = propres.map((r, i) => ({ r, i })).filter(({ r }) => r.heure)
    .sort((a, b) => (a.r.heure < b.r.heure ? -1 : a.r.heure > b.r.heure ? 1 : a.i - b.i))
    .map(({ r }) => r);
  return [...avecHeure, ...propres.filter((r) => !r.heure)];
}

/**
 * Pages ouvertes par le lien de chaque bloc (colonne « Lien » du catalogue).
 * `chantiers_a_venir` : la fiche chantier s'ouvre depuis Opérations (la liste
 * Chantiers n'est plus dans le menu) ; chaque chantier du bloc ouvre en plus
 * sa fiche (tâche 8, BlocChantiersAVenir).
 */
export const LIENS_BLOCS = deepFreeze({
  bilan_semaine_passee: ["bilan-semaine"],
  commandes_a_saisir: ["planning-commandes"],
  chantiers_a_venir: ["operations"],
  administratif_fournisseurs: ["rapprochement", "encours-fournisseurs"],
  tournee_chantiers: ["alertes", "retours-terrain"],
  planning_semaine_suivante: ["planning"],
  materiaux_a_commander: ["planning-commandes"],
});

/**
 * Liens d'un bloc, limités aux pages autorisées pour le rôle (règle 2 : une
 * page non autorisée n'est jamais proposée). Bloc inconnu : aucun lien.
 * @param {string} bloc
 * @param {(id: string) => boolean} estAutorisee
 */
export function liensDuBloc(bloc, estAutorisee) {
  const liens = Object.prototype.hasOwnProperty.call(LIENS_BLOCS, bloc) ? LIENS_BLOCS[bloc] : [];
  return typeof estAutorisee === "function" ? liens.filter((id) => estAutorisee(id)) : [];
}

/**
 * État du bandeau du tableau de bord, ou null s'il ne s'affiche pas
 * (week-end, jour non configuré, sans organisation : tableau de bord
 * strictement identique à avant, règle 1).
 *   { jour, libelleDate, theme, rendezVous, ordreHabituel, bouton, blocs }
 * En mode « ordre habituel aujourd'hui », le bandeau reste (règle 7) mais
 * `blocs` est vide : le tableau de bord reprend sa forme standard.
 */
export function bandeauDuJour(navOrder, dateIso) {
  const org = organisationDuJour(navOrder, dateIso);
  if (!org) return null;
  return {
    jour: org.jour,
    libelleDate: libelleDateDuJour(dateIso),
    theme: org.theme,
    rendezVous: trierRendezVous(org.rendez_vous),
    ordreHabituel: ordreHabituelActif(navOrder, dateIso),
    bouton: boutonOrdreHabituel(navOrder, dateIso),
    blocs: blocsDuJour(navOrder, dateIso),
  };
}
