// ─── RYTHME DE SEMAINE 4 JOURS / 5 JOURS ─────────────────────────────────────
// À partir du lundi 24/08/2026 (rentrée), l'entreprise alterne une semaine sur
// deux, selon la parité du NUMÉRO DE SEMAINE ISO (celui des calendriers) :
//   - semaine IMPAIRE → 4 jours : lun 10h, mar 10h, mer 10h, jeu 9h, ven repos
//   - semaine PAIRE   → 5 jours : lun 8h,  mar 8h,  mer 8h,  jeu 8h,  ven 7h
// Total identique dans les deux cas : 39 h travaillées.
// Avant cette date, les anciens barèmes restent servis (cible CR 10/10/10/9/9,
// capacité planning 9/9/9/8/8) pour ne pas réécrire l'historique.
// Ce module est LA source unique des heures par jour : cible des comptes
// rendus ouvriers (RapportMobile), capacité du planning (Planning, CellModal)
// et barème de repli du bilan (BilanSemaine). Ajuster ici si le rythme change.

const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

export const RYTHME_DATE_DEBUT = "2026-08-24"; // lundi de la semaine ISO 35 (impaire → 4 jours)

// Heures TRAVAILLÉES par jour (cible des comptes rendus : tâches + trajets
// + heures indirectes). 0 = jour non travaillé.
export const PROFIL_4J = { Lundi: 10, Mardi: 10, Mercredi: 10, Jeudi: 9, Vendredi: 0 }; // semaines impaires
export const PROFIL_5J = { Lundi: 8,  Mardi: 8,  Mercredi: 8,  Jeudi: 8, Vendredi: 7 }; // semaines paires

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
// Le rythme alterné s'applique-t-il à cette semaine ? (lundi >= date de début)
export function rythmeActif(year, week) {
  const mon = mondayOfWeek(year, week);
  if (isNaN(mon)) return false;
  const iso = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
  return iso >= RYTHME_DATE_DEBUT;
}

// Heures TRAVAILLÉES par jour pour une semaine donnée : { Lundi: h, …, Vendredi: h }.
// Rythme actif → profil selon la parité ISO. Avant la rentrée → `legacy`
// (l'ancienne config Admin heures_par_jour, si fournie), sinon PROFIL_LEGACY.
export function profilSemaine(year, week, legacy) {
  if (rythmeActif(year, week)) return week % 2 === 0 ? { ...PROFIL_5J } : { ...PROFIL_4J };
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

export function estJourNonTravaille(jour, year, week) {
  return (profilSemaine(year, week)[jour] ?? 0) === 0;
}

// Libellé court du rythme de la semaine ("" avant la rentrée) — pour les
// badges d'en-tête (planning, bilan…).
export function libelleRythme(year, week) {
  if (!rythmeActif(year, week)) return "";
  return week % 2 === 0 ? "Semaine de 5 jours" : "Semaine de 4 jours";
}
