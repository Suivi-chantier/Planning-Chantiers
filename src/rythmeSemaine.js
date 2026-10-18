// ─── RYTHME DE SEMAINE ───────────────────────────────────────────────────────
// Depuis le lundi 19/10/2026 (semaine 43), TOUTES les semaines font 4 jours :
//   lundi → jeudi 7h30–12h / 12h45–18h = 9h45, vendredi repos      = 39 h
// Les périodes précédentes restent servies telles quelles (historique) :
//   - du 05/10 au 18/10/2026, alternance selon la parité du NUMÉRO DE SEMAINE
//     ISO, journées 7h30–12h / 12h45–17h (8h45) :
//       semaine IMPAIRE → 4 jours = 35 h ; semaine PAIRE → 5 jours = 43 h
//       (vendredi 8 h, fin 16h15) ;
//   - du 24/08 au 04/10/2026, premier rythme alterné, 39 h dans les deux cas :
//       impaire 10/10/10/9/repos, paire 8/8/8/8/7 ;
//   - avant le 24/08/2026, anciens barèmes (cible CR 10/10/10/9/9, capacité
//     planning 9/9/9/8/8) pour ne pas réécrire l'historique.
// Ce module est LA source unique des heures par jour : cible des comptes
// rendus ouvriers (RapportMobile), capacité du planning (Planning, CellModal)
// et barème de repli du bilan (BilanSemaine). Ajuster ici si le rythme change.

const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

export const RYTHME_DATE_DEBUT = "2026-08-24"; // lundi de la semaine ISO 35 (impaire → 4 jours)
export const HORAIRES_DATE_DEBUT = "2026-10-05"; // lundi de la semaine ISO 41 : horaires 35 h / 43 h
export const QUATRE_JOURS_DATE_DEBUT = "2026-10-19"; // lundi de la semaine ISO 43 : 4 jours chaque semaine, 39 h

// Heures TRAVAILLÉES par jour (cible des comptes rendus : tâches + trajets
// + heures indirectes). 0 = jour non travaillé. 9.75 = 9h45 (7h30–12h + 12h45–18h).
export const PROFIL_SEMAINE = { Lundi: 9.75, Mardi: 9.75, Mercredi: 9.75, Jeudi: 9.75, Vendredi: 0 }; // toutes les semaines : 39 h

// Horaires affichés (Admin) — les heures ci-dessus en découlent.
export const HORAIRES_JOUR = "7h30–12h / 12h45–18h";

// Alternance 35 h / 43 h (05/10 → 18/10/2026), journées 7h30–12h / 12h45–17h.
const PROFIL_4J_35H = { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 0 };
const PROFIL_5J_43H = { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 8 };

// Premier rythme alterné (24/08 → 04/10/2026), 39 h dans les deux cas.
const PROFIL_4J_39H = { Lundi: 10, Mardi: 10, Mercredi: 10, Jeudi: 9, Vendredi: 0 };
const PROFIL_5J_39H = { Lundi: 8,  Mardi: 8,  Mercredi: 8,  Jeudi: 8, Vendredi: 7 };

// Barèmes HISTORIQUES (avant le 24/08/2026).
export const PROFIL_LEGACY   = { Lundi: 10, Mardi: 10, Mercredi: 10, Jeudi: 9, Vendredi: 9 }; // cible CR (48 h)
const CAPACITE_LEGACY        = { Lundi: 9,  Mardi: 9,  Mercredi: 9,  Jeudi: 8, Vendredi: 8 }; // planning (43 h)

// ─── SEMAINE ISO-8601 ────────────────────────────────────────────────────────
// Numéro de semaine ISO (celui des calendriers français) : la semaine 1 est
// celle qui contient le premier jeudi de l'année. Renvoie { year, week } où
// year est l'année ISO (peut différer de l'année civile fin décembre / début
// janvier). Accepte un objet Date ou une chaîne "AAAA-MM-JJ".
export function getISOWeek(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(String(dateInput) + "T12:00:00");
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // jeudi de la semaine courante
  const year = t.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const jeudi1 = new Date(year, 0, 4 + 3 - ((jan4.getDay() + 6) % 7)); // jeudi de la semaine 1
  const week = 1 + Math.round((t - jeudi1) / (7 * 86400000));
  return { year, week };
}

// Lundi (objet Date, minuit locale) de la semaine ISO demandée.
export function mondayOfWeek(year, week) {
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  return mon;
}

// Nombre de semaines ISO dans l'année (52 ou 53) — pour la navigation
// semaine précédente / suivante sans sauter la semaine 53.
export function semainesDansAnnee(year) {
  return getISOWeek(new Date(year, 11, 28)).week; // le 28/12 est toujours dans la dernière semaine ISO
}

// ─── PROFILS D'HEURES ────────────────────────────────────────────────────────
// Lundi de la semaine au format "AAAA-MM-JJ" ("" si semaine invalide).
function lundiISO(year, week) {
  const mon = mondayOfWeek(year, week);
  if (isNaN(mon)) return "";
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

// Les barèmes de la rentrée s'appliquent-ils à cette semaine ? (lundi >= 24/08/2026)
export function rythmeActif(year, week) {
  const iso = lundiISO(year, week);
  return iso !== "" && iso >= RYTHME_DATE_DEBUT;
}

// La semaine est-elle au rythme 4 jours fixe (lundi >= 19/10/2026) ?
export function quatreJoursFixes(year, week) {
  const iso = lundiISO(year, week);
  return iso !== "" && iso >= QUATRE_JOURS_DATE_DEBUT;
}

// Heures TRAVAILLÉES par jour pour une semaine donnée : { Lundi: h, …, Vendredi: h }.
// Depuis le 19/10/2026 → 4 jours de 9h45 (39 h) chaque semaine. Du 24/08 au
// 18/10/2026 → profil selon la parité ISO (35 h / 43 h à partir du 05/10,
// 39 h / 39 h avant). Avant la rentrée → `legacy` (l'ancienne config Admin
// heures_par_jour, si fournie), sinon PROFIL_LEGACY.
export function profilSemaine(year, week, legacy) {
  if (quatreJoursFixes(year, week)) return { ...PROFIL_SEMAINE };
  if (rythmeActif(year, week)) {
    const horaires3543 = lundiISO(year, week) >= HORAIRES_DATE_DEBUT;
    if (week % 2 === 0) return horaires3543 ? { ...PROFIL_5J_43H } : { ...PROFIL_5J_39H };
    return horaires3543 ? { ...PROFIL_4J_35H } : { ...PROFIL_4J_39H };
  }
  const out = { ...PROFIL_LEGACY };
  if (legacy) JOURS_SEMAINE.forEach(j => {
    const v = parseFloat(legacy[j]);
    if (Number.isFinite(v)) out[j] = v;
  });
  return out;
}

// Capacité de PLANIFICATION du jour (heures de tâches posables dans le
// planning) : heures travaillées moins 1 h de trajets/indirects — même écart
// que l'ancien couple cible 10/9 ↔ capacité 9/8. 0 si jour non travaillé.
export function capaciteJour(jour, year, week) {
  if (!rythmeActif(year, week)) return CAPACITE_LEGACY[jour] ?? 9;
  const h = profilSemaine(year, week)[jour] ?? 0;
  return h > 0 ? h - 1 : 0;
}

// Heures TRAVAILLÉES attendues à une date "AAAA-MM-JJ", avant absences
// individuelles : exception de date Admin (planning_config.heures_par_jour
// .exceptions — férié, pont… 0 h valide) > profil de la semaine. 0 le week-end.
export function heuresJourEntreprise(dateISO, exceptions = null) {
  const iso = String(dateISO || "").slice(0, 10);
  const exc = parseFloat(exceptions?.[iso]);
  if (Number.isFinite(exc)) return exc;
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d)) return 0;
  const jour = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][d.getDay()];
  const { year, week } = getISOWeek(iso);
  return profilSemaine(year, week)[jour] ?? 0;
}

// Durée lisible : 8.75 → "8h45", 8 → "8h", 0 → "0h".
export function fmtHeures(h) {
  const min = Math.round((parseFloat(h) || 0) * 60);
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`;
}

export function estJourNonTravaille(jour, year, week) {
  return (profilSemaine(year, week)[jour] ?? 0) === 0;
}

// Libellé court du rythme de la semaine ("" avant la rentrée) — pour les
// badges d'en-tête (planning, bilan…).
export function libelleRythme(year, week) {
  if (!rythmeActif(year, week)) return "";
  if (quatreJoursFixes(year, week)) return "Semaine de 4 jours";
  return week % 2 === 0 ? "Semaine de 5 jours" : "Semaine de 4 jours";
}

// Explication du rythme de la semaine (infobulle du badge) ; "" avant la rentrée.
export function detailRythme(year, week) {
  if (!rythmeActif(year, week)) return "";
  if (quatreJoursFixes(year, week)) return `Toutes les semaines : lundi → jeudi, ${HORAIRES_JOUR} (9h45 par jour, 39 h), vendredi repos`;
  return "Rythme alterné : semaines impaires 4 jours (lun-jeu), semaines paires 5 jours";
}
