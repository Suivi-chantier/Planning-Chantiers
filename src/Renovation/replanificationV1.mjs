// ─────────────────────────────────────────────────────────────────────────────
// « À replanifier » — tâches déclarées « Pas commencé » / « Bloqué » (ou « Non
// faite » dans l'ancien formulaire) dans un compte rendu VALIDÉ, et restées
// sans suite. Module PUR (façade replanificationV1.js) : aucune horloge, la
// date du jour arrive en paramètre. Rien n'est déplacé : le planning SIGNALE,
// le conducteur décide.
//
// Pour chaque tâche du phasage, on garde son DERNIER signalement. Il est réglé
// (et disparaît de la liste) si :
//   · quelqu'un a déclaré des heures sur la tâche ce jour-là ou après, sur
//     une ligne qui n'est pas elle-même « Pas commencé » / « Bloqué » (un
//     collègue l'a faite, ou elle a avancé) ;
//   · la tâche est posée au planning à une date postérieure au signalement
//     ET pas encore passée (aujourd'hui ou plus tard) — elle est replanifiée ;
//   · le motif est « Fait par un collègue » ;
//   · la tâche est à 100 % dans le phasage (terminée depuis, quelle que soit
//     la façon : relevé réel du 14/10/2026, 27 signalements sur 40 l'étaient).
// ─────────────────────────────────────────────────────────────────────────────
import { libelleMotifStatut } from "./motifsCompteRendu.mjs";
import { isoDepuisDateRapport } from "./retoursTerrainV1.mjs";

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const texte = (v) => String(v ?? "").trim();
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

// { tache_id: avancement } des tâches d'ouvrages des phasages.
export function avancementsDesPhasages(phasages) {
  const m = {};
  (phasages || []).forEach(ph => (Array.isArray(ph?.ouvrages) ? ph.ouvrages : []).forEach(o =>
    (Array.isArray(o?.taches) ? o.taches : []).forEach(t => { if (t?.id != null) m[String(t.id)] = num(t.avancement); })));
  return m;
}

// « 2026-W41 » + « Lundi » → « 2026-10-05 » (ISO, calcul en UTC) ; null sinon.
export function dateDeCellule(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(texte(weekId));
  const i = JOURS.indexOf(jour);
  if (!m || i < 0) return null;
  const an = +m[1], sem = +m[2];
  const jan4 = new Date(Date.UTC(an, 0, 4));
  const lundi1 = new Date(jan4); lundi1.setUTCDate(4 - ((jan4.getUTCDay() || 7) - 1));
  const d = new Date(lundi1); d.setUTCDate(lundi1.getUTCDate() + (sem - 1) * 7 + i);
  return d.toISOString().slice(0, 10);
}

// « 2026-10-05 » → { weekId: « 2026-W41 », jour: « Lundi » } (semaine ISO).
export function celluleDeDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte(iso));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const jourIdx = (d.getUTCDay() || 7) - 1;
  const jeudi = new Date(d); jeudi.setUTCDate(d.getUTCDate() + 3 - jourIdx);
  const an = jeudi.getUTCFullYear();
  const jan4 = new Date(Date.UTC(an, 0, 4));
  const sem = 1 + Math.round(((jeudi - jan4) / 86400000 - 3 + ((jan4.getUTCDay() || 7) - 1)) / 7);
  return { weekId: `${an}-W${String(sem).padStart(2, "0")}`, jour: JOURS[jourIdx] };
}

// Semaines (« YYYY-Wnn ») couvrant [debutISO, finISO] — pour lire le planning.
export function semainesEntre(debutISO, finISO) {
  const out = [];
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte(debutISO)), m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte(finISO));
  if (!m1 || !m2) return out;
  const d = new Date(Date.UTC(+m1[1], +m1[2] - 1, +m1[3]));
  const fin = new Date(Date.UTC(+m2[1], +m2[2] - 1, +m2[3]));
  while (d <= fin) {
    const c = celluleDeDate(d.toISOString().slice(0, 10));
    if (c && !out.includes(c.weekId)) out.push(c.weekId);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// rapports : tous les comptes rendus lus sur la période (validés ou non : les
//            heures déclarées comptent comme suite donnée ; seuls les VALIDÉS
//            créent un signalement) ;
// cellules : lignes planning_cells { week_id, jour, chantier_id, taches[] }
//            des chantiers concernés, du plus ancien signalement à l'avenir ;
// aujourdhuiISO : la date du jour ;
// depuisISO / jusquaISO : ne retenir que les signalements de cette période
//   (la semaine affichée au planning) ; les heures déclarées APRÈS, et le
//   planning à venir, comptent toujours pour savoir si c'est réglé ;
// avancements : { tache_id: % } lu dans les phasages (avancementsDesPhasages).
export function tachesAReplanifier({ rapports = [], cellules = [], aujourdhuiISO, depuisISO = null, jusquaISO = null, avancements = {} }) {
  const derniereActivite = new Map();   // tache_id → date ISO max avec heures > 0
  const signalements = new Map();       // tache_id → signalement le plus récent
  (rapports || []).forEach(r => {
    const date = isoDepuisDateRapport(r?.date_rapport);
    if (!date) return;
    (Array.isArray(r.taches) ? r.taches : []).forEach(l => {
      if (!l?.tache_id) return;
      const k = String(l.tache_id);
      const signal = l.bloque === true || l.statut === "non_faite";
      // Une suite donnée = des heures sur une ligne qui n'est PAS elle-même un
      // signalement (« Bloqué » avec des heures reste à replanifier).
      if (!signal && num(l.heures_reelles) > 0) {
        const prec = derniereActivite.get(k);
        if (!prec || date > prec) derniereActivite.set(k, date);
      }
      if (!signal || r.statut !== "valide" || (depuisISO && date < depuisISO) || (jusquaISO && date > jusquaISO)) return;
      const cur = signalements.get(k);
      if (cur && cur.date > date) return;
      const ouvriers = cur && cur.date === date ? [...new Set([...cur.ouvriers, texte(r.ouvrier)].filter(Boolean))] : [texte(r.ouvrier)].filter(Boolean);
      const motifs = cur && cur.date === date ? cur.motifs : [];
      if (l.motif) motifs.push({ code: l.motif, label: libelleMotifStatut(l.motif), precision: texte(l.remarque) });
      else if (texte(l.remarque)) motifs.push({ code: null, label: null, precision: texte(l.remarque) });
      signalements.set(k, {
        tache_id: k, date, chantier_id: r.chantier_id || null, chantier_nom: texte(r.chantier_nom) || texte(r.chantier_id),
        tache: texte(l.planifie) || "(sans nom)", bloque: (cur && cur.date === date && cur.bloque) || l.bloque === true,
        ouvriers, motifs,
      });
    });
  });

  // Dates où chaque tâche est posée au planning.
  const datesPlanifiees = new Map();
  (cellules || []).forEach(c => {
    const d = dateDeCellule(c?.week_id, c?.jour);
    if (!d) return;
    (Array.isArray(c.taches) ? c.taches : []).forEach(t => {
      if (!t?.tache_id) return;
      const k = String(t.tache_id);
      if (!datesPlanifiees.has(k)) datesPlanifiees.set(k, []);
      datesPlanifiees.get(k).push(d);
    });
  });

  const out = [];
  signalements.forEach(s => {
    if (s.motifs.some(m => m.code === "fait_par_collegue")) return;
    if (num(avancements?.[s.tache_id]) >= 100) return;
    const activite = derniereActivite.get(s.tache_id);
    if (activite && activite >= s.date) return;
    const replanifiee = (datesPlanifiees.get(s.tache_id) || []).some(d => d > s.date && d >= aujourdhuiISO);
    if (replanifiee) return;
    const cellule = celluleDeDate(s.date);
    out.push({
      ...s,
      statut_label: s.bloque ? "Bloqué" : "Pas commencé",
      weekId: cellule?.weekId || null, jour: cellule?.jour || null,
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.chantier_nom.localeCompare(b.chantier_nom));
}
