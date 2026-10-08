// ─── RYTHME DE SEMAINE 4 JOURS / 5 JOURS ─────────────────────────────────────
// À partir du lundi 24/08/2026 (rentrée), l'entreprise alterne une semaine sur
// deux, selon la parité du NUMÉRO DE SEMAINE ISO (celui des calendriers).
// Depuis le lundi 05/10/2026 (semaine 41), horaires 7h30–12h / 12h45–17h :
//   - semaine IMPAIRE → 4 jours : lun→jeu 8h45, ven repos            = 35 h
//   - semaine PAIRE   → 5 jours : lun→jeu 8h45, ven 8h (fin 16h15)   = 43 h
// Du 24/08 au 04/10/2026, le premier rythme (39 h dans les deux cas) reste
// servi : impaire 10/10/10/9/repos, paire 8/8/8/8/7.
// Avant le 24/08/2026, les anciens barèmes restent servis (cible CR 10/10/10/9/9,
// capacité planning 9/9/9/8/8) pour ne pas réécrire l'historique.
// Ce module est LA source unique des heures par jour : cible des comptes
// rendus ouvriers (RapportMobile), capacité du planning (Planning, CellModal)
// et barème de repli du bilan (BilanSemaine). Ajuster ici si le rythme change.

const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

export const RYTHME_DATE_DEBUT = "2026-08-24"; // lundi de la semaine ISO 35 (impaire → 4 jours)
export const HORAIRES_DATE_DEBUT = "2026-10-05"; // lundi de la semaine ISO 41 : horaires 35 h / 43 h

// Heures TRAVAILLÉES par jour (cible des comptes rendus : tâches + trajets
// + heures indirectes). 0 = jour non travaillé. 8.75 = 8h45 (7h30–12h + 12h45–17h).
export const PROFIL_4J = { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 0 }; // semaines impaires : 35 h
export const PROFIL_5J = { Lundi: 8.75, Mardi: 8.75, Mercredi: 8.75, Jeudi: 8.75, Vendredi: 8 }; // semaines paires : 43 h (vendredi fin 16h15)

// Horaires affichés (Admin) — les heures ci-dessus en découlent.
export const HORAIRES_JOUR = "7h30–12h / 12h45–17h";
export const HORAIRES_VENDREDI_5J = "7h30–12h / 12h45–16h15";

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

// Le rythme alterné s'applique-t-il à cette semaine ? (lundi >= date de début)
export function rythmeActif(year, week) {
  const iso = lundiISO(year, week);
  return iso !== "" && iso >= RYTHME_DATE_DEBUT;
}

// Heures TRAVAILLÉES par jour pour une semaine donnée : { Lundi: h, …, Vendredi: h }.
// Rythme actif → profil selon la parité ISO (horaires 35 h / 43 h depuis le
// 05/10/2026, 39 h / 39 h avant). Avant la rentrée → `legacy`
// (l'ancienne config Admin heures_par_jour, si fournie), sinon PROFIL_LEGACY.
export function profilSemaine(year, week, legacy) {
  if (rythmeActif(year, week)) {
    const nouveaux = lundiISO(year, week) >= HORAIRES_DATE_DEBUT;
    if (week % 2 === 0) return nouveaux ? { ...PROFIL_5J } : { ...PROFIL_5J_39H };
    return nouveaux ? { ...PROFIL_4J } : { ...PROFIL_4J_39H };
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
  return week % 2 === 0 ? "Semaine de 5 jours" : "Semaine de 4 jours";
}
