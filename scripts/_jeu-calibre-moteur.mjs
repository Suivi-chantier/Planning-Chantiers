// ─── JEU CALIBRÉ FICTIF POUR LE MOTEUR DE PLANNING ──────────────────────────
// Données FICTIVES de bout en bout (exemple issu des tests, données fictives).
// Générateur déterministe (graine fixe) calibré sur les VOLUMES réels relevés en
// base le 24/09/2026 (diagnostic chantier 10, question 2) : 42 phasages,
// 52 chantiers en configuration, ~2 730 tâches dont ~1 350 ouvertes,
// 14 ressources, 5 équipes, 13 groupes types, ~180 lignes de prévision dans
// l'horizon. Aucun nom de chantier, aucun chiffre ne vient de la base.
//
// Utilisé par scripts/verif-planning-moteur-consignes-v1.mjs pour mesurer le
// temps du moteur et comparer ses sorties avant / après optimisation.

import { capaciteBasePlanningPourDate } from "../src/Renovation/planningResourceCapacityV1.js";
import { getISOWeek } from "../src/rythmeSemaine.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const JEU_CALIBRE_DEBUT = "2026-09-28";

export function construireJeuCalibreMoteurV1({ graine = 20260924, startDate = JEU_CALIBRE_DEBUT, horizonDays = 42 } = {}) {
  const rnd = mulberry32(graine);
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  const ressources = Array.from({ length: 14 }, (_, i) => {
    const nom = `Ouvrier${String(i + 1).padStart(2, "0")}`;
    return { id: `RES-${String(i + 1).padStart(2, "0")}`, nom, nom_planning: nom, kind: "personne", actif: true, capacite_facteur: 1 };
  });
  const noms = ressources.map(r => r.nom_planning);
  // 5 équipes internes : 3 + 3 + 3 + 3 + 2 personnes.
  const tailles = [3, 3, 3, 3, 2];
  let k = 0;
  const equipes = tailles.map((n, i) => {
    const membres = noms.slice(k, k + n);
    k += n;
    return { id: `EQ-${i + 1}`, nom: `Équipe ${i + 1}`, responsable: membres[0], membres: membres.slice(1).map(ouvrier => ({ ouvrier })), externe: false };
  });
  const groupesTypes = Array.from({ length: 13 }, (_, i) => ({
    id: `GT-${String(i + 1).padStart(2, "0")}`,
    nom: `Lot ${i + 1}`,
    ordre: (i + 1) * 10,
    equipe_id: equipes[i % equipes.length].id,
    ouvriers_prio: [],
  }));

  const chantiers = Array.from({ length: 52 }, (_, i) => ({
    id: `CH-${String(i + 1).padStart(2, "0")}`,
    nom: `Chantier fictif ${i + 1}`,
    statut: i < 42 ? "en_cours" : "termine",
  }));

  const phasages = [];
  const tachesOuvertesParChantier = new Map();
  for (let p = 0; p < 42; p++) {
    const chantierId = chantiers[p].id;
    const nbGroupes = entre(4, 7);
    const gts = [...groupesTypes].sort(() => rnd() - 0.5).slice(0, nbGroupes).sort((a, b) => a.ordre - b.ordre);
    const chrono = gts.map((gt, gi) => ({ id: `CG-${p}-${gi}`, ordre: gt.ordre, groupe_type_id: gt.id }));
    const ouvrages = [];
    const nbOuvrages = 13;
    let ordre = 0;
    const ouvertes = [];
    // Avancement réaliste : les tâches sont terminées dans l'ordre chrono
    // jusqu'à un point d'avancement propre au chantier, ouvertes ensuite.
    const pointAvancement = 0.3 + rnd() * 0.4;
    for (let o = 0; o < nbOuvrages; o++) {
      const taches = [];
      const nbTaches = entre(4, 6);
      for (let t = 0; t < nbTaches; t++) {
        const g = chrono[Math.min(chrono.length - 1, Math.floor((o / nbOuvrages) * chrono.length))];
        const heures = entre(2, 40);
        const ouverte = (o + t / nbTaches) / nbOuvrages >= pointAvancement;
        const tache = {
          id: `T-${p}-${o}-${t}`,
          nom: `Tâche fictive ${o + 1}.${t + 1}`,
          heures_vendues: heures,
          heures_estimees: heures,
          avancement: ouverte ? pick([0, 0, 0, 25, 50]) : 100,
          chrono_groupe_id: g.id,
          chrono_ordre: ordre++,
          ouvriers: [],
        };
        // Environ 3 % des tâches portent des dépendances explicites vides (hors chaîne).
        if (rnd() < 0.03) tache.predecesseurs = [];
        taches.push(tache);
        if (ouverte) ouvertes.push({ tache, groupe_type_id: g.groupe_type_id });
      }
      ouvrages.push({ id: `O-${p}-${o}`, code_ouvrage: `E-${String(o + 1).padStart(3, "0")}`, taches });
    }
    tachesOuvertesParChantier.set(chantierId, ouvertes);
    phasages.push({
      id: `PH-${chantierId}`,
      chantier_id: chantierId,
      chantier_nom: chantiers[p].nom,
      revision: 1,
      updated_at: "2026-09-20T18:00:00Z",
      ouvrages,
      plan_travaux: { meta: { chrono_groupes: chrono } },
    });
  }

  // Prévisions courantes dans l'horizon : ~180 lignes sur 8 chantiers.
  const equipeParGt = new Map(groupesTypes.map(gt => [gt.id, equipes.find(e => e.id === gt.equipe_id)]));
  const joursOuvres = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(startDate, i);
    if (capaciteBasePlanningPourDate(d) > 0) joursOuvres.push(d);
  }
  const cellules = new Map();
  let uid = 0;
  const chantiersForecast = chantiers.slice(0, 8).map(c => c.id);
  const dejaPrevu = new Set();
  let guard = 0;
  while (uid < 184 && guard++ < 10000) {
    const chantierId = pick(chantiersForecast);
    const ouvertes = tachesOuvertesParChantier.get(chantierId) || [];
    if (!ouvertes.length) continue;
    const { tache, groupe_type_id } = pick(ouvertes);
    const date = pick(joursOuvres);
    const cle = `${chantierId}|${tache.id}|${date}`;
    if (dejaPrevu.has(cle)) continue;
    dejaPrevu.add(cle);
    const eq = equipeParGt.get(groupe_type_id);
    const ouvrier = pick([eq.responsable, ...eq.membres.map(m => m.ouvrier)]);
    const { year, week } = getISOWeek(date);
    const weekId = `${year}-W${String(week).padStart(2, "0")}`;
    const jour = JOURS[new Date(`${date}T12:00:00`).getDay()];
    const key = `${weekId}|${chantierId}|${jour}`;
    if (!cellules.has(key)) {
      cellules.set(key, { id: `CELL-${cellules.size + 1}`, week_id: weekId, chantier_id: chantierId, jour, planifie: true, reel: false, ouvriers: [], vehicules: [], taches: [] });
    }
    const cell = cellules.get(key);
    uid++;
    cell.taches.push({ allocation_uid: `AL-${uid}`, tache_id: tache.id, text: tache.nom, duree: entre(2, 7), ouvriers: [ouvrier] });
    if (!cell.ouvriers.includes(ouvrier)) cell.ouvriers.push(ouvrier);
  }

  const listeCellules = [...cellules.values()];
  return {
    phasages,
    chantiers,
    cellules: listeCellules,
    cellulesToutes: listeCellules,
    ressources,
    evenementsRessources: [
      { id: "EV-F1", resource_id: "RES-03", type: "absence", date_debut: addDays(startDate, 2), date_fin: addDays(startDate, 4), toute_journee: true, actif: true },
      { id: "EV-F2", resource_id: "RES-09", type: "indisponibilite", date_debut: addDays(startDate, 9), date_fin: addDays(startDate, 9), toute_journee: false, heures_indisponibles: 3, actif: true },
    ],
    contraintes: [],
    groupesTypes,
    equipes,
    startDate,
    horizonDays,
  };
}
