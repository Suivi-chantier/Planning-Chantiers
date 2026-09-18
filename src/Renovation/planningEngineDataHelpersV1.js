// ─── HELPERS DONNÉES — PLANNING ENGINE V1 ────────────────────────────────────
// Fonctions pures utilisées par la couche de lecture Supabase du moteur.
// Aucun accès réseau, aucun state, aucune dépendance à l'UI.

const txt = v => String(v ?? "").trim();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function dateISOValideV1(value) {
  const s = txt(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function ajouterJoursISOv1(dateISO, jours) {
  const iso = dateISOValideV1(dateISO);
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Math.trunc(num(jours, 0)));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function finHorizonPlanningV1(startDate, horizonDays = 42) {
  const debut = dateISOValideV1(startDate);
  if (!debut) throw new Error("startDate ISO requis");
  const jours = Math.max(1, Math.min(366, Math.round(num(horizonDays, 42))));
  return ajouterJoursISOv1(debut, jours - 1);
}

export function semaineISOv1(dateISO) {
  const iso = dateISOValideV1(dateISO);
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  // Algorithme ISO-8601 : jeudi détermine l'année de semaine.
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((utc - jan1) / 86400000) + 1) / 7);
  return { year, week, week_id: `${year}-W${String(week).padStart(2, "0")}` };
}

export function semainesPourHorizonV1(startDate, horizonDays = 42) {
  const debut = dateISOValideV1(startDate);
  if (!debut) throw new Error("startDate ISO requis");
  const fin = finHorizonPlanningV1(debut, horizonDays);
  const ids = new Set();
  let cur = debut;
  while (cur <= fin) {
    const s = semaineISOv1(cur);
    if (s?.week_id) ids.add(s.week_id);
    cur = ajouterJoursISOv1(cur, 1);
  }
  return [...ids];
}

export function parserConfigMoteurV1(rows = []) {
  const byKey = new Map((Array.isArray(rows) ? rows : [])
    .filter(r => txt(r?.key))
    .map(r => [txt(r.key), r.value]));

  const asItems = (key) => {
    const value = byKey.get(key);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    return [];
  };

  // `chantiers` est historiquement stocké comme tableau direct ; groupes_types
  // et equipes utilisent généralement { items: [...] }. On tolère les deux
  // formes afin que le moteur n'impose pas une migration de configuration.
  return {
    chantiers: asItems("chantiers"),
    groupesTypes: asItems("groupes_types"),
    equipes: asItems("equipes"),
  };
}

export function metaHorizonMoteurV1(startDate, horizonDays = 42) {
  const debut = dateISOValideV1(startDate);
  if (!debut) throw new Error("startDate ISO requis");
  const jours = Math.max(1, Math.min(366, Math.round(num(horizonDays, 42))));
  return {
    start_date: debut,
    end_date: finHorizonPlanningV1(debut, jours),
    horizon_days: jours,
    week_ids: semainesPourHorizonV1(debut, jours),
  };
}
