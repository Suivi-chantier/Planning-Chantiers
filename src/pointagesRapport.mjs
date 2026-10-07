// ─────────────────────────────────────────────────────────────────────────────
// Construction des pointages d'un rapport — module PUR (aucun accès Supabase).
// Déplacé tel quel depuis src/pointages.js (qui le réexporte) pour que les
// scripts de vérification Node exécutent le VRAI code de la validation et de
// l'outil Admin de ré-génération, sans charger le client Supabase.
// ─────────────────────────────────────────────────────────────────────────────

// ── Construction des lignes de pointages d'un rapport ─────────────────────
//
// Source unique de vérité pour transformer un rapport validé en écritures
// `pointages`. Utilisée à la validation (Validation.jsx) ET par l'outil de
// ré-génération (Admin → Pointages), pour éviter toute divergence de logique.
//
// Règles encapsulées :
//  1. FUSION des tâches doublons — plusieurs lignes du même rapport pointant la
//     même tâche du plan (même `phase_id::tache_id`) sont additionnées. Sinon
//     deux pointages partageraient (rapport_id, tache_id, ouvrier, date) et
//     violeraient l'index unique `uniq_pointages_rapport_tache` : l'INSERT du
//     lot entier échouerait (23505) → rapport « validé » mais sans aucune heure.
//     Les tâches libres (tache_id null) ne sont pas couvertes par l'index → on
//     les garde distinctes.
//  2. Trajet réparti en CENTIMES exacts (plus grand reste) entre les chantiers
//     du jour, PONDÉRÉ par le temps passé sur chaque chantier — un chantier à 0h
//     ne porte aucun trajet ; deux chantiers à 5h partagent le trajet moitié-
//     moitié. La somme des quote-parts = exactement le trajet total du jour
//     (fini les journées à 9,99 / 10,01 h dues à l'arrondi numeric(6,2)).
//  3. QUANTITÉS POSÉES (tâche suivie en quantité) : une ligne qui porte
//     quantite_validee (>= 0) transmet quantite_declaree / quantite_validee /
//     quantite_unite ; deux lignes fusionnées additionnent leurs quantités.
//     Une ligne sans quantité ne reçoit AUCUN de ces champs : les pointages
//     des tâches suivies en % sont strictement inchangés.
//
// Renvoie le tableau des lignes prêtes pour `insert`.
export function buildPointagesRapport({
  chantier_id, ouvrier, dateISO, taux = 0, phasage_id = null, rapport_id, valide_par = null,
  taskLines = [],       // [{ tache_id, phase_id, heures, avancement_declare, quantite_declaree?, quantite_validee?, quantite_unite? }]
  indirectLines = [],   // [{ motif, heures }]
  trajetMinTotal = 0,   // minutes de trajet total du jour (posé identiquement sur chaque rapport)
  nbChantiersDuJour = 1,
  rangRapport = 0,      // index de CE rapport dans le tri stable des rapports du même jour
  heuresParRapportDuJour = null, // [h0, h1, …] heures travaillées de chaque rapport du jour (tri stable) → pondération du trajet. À défaut : parts égales.
}) {
  const base = { chantier_id, phasage_id, ouvrier, date: dateISO, taux_horaire: taux, rapport_id, valide_par };

  // 1) Tâches — fusion des doublons par (phase_id::tache_id). Tâches libres à part.
  const fusion = new Map();
  const libres = [];
  (taskLines || []).forEach(li => {
    const h = parseFloat(li.heures) || 0;
    if (h <= 0) return;
    const av = li.avancement_declare != null && li.avancement_declare !== "" ? parseInt(li.avancement_declare) : null;
    const entry = { tache_id: li.tache_id || null, phase_id: li.phase_id || null, h, av };
    const qv = qte(li.quantite_validee);
    if (entry.tache_id && qv != null) {
      entry.q = { declaree: qte(li.quantite_declaree), validee: qv, unite: li.quantite_unite || null };
    }
    if (!entry.tache_id) { libres.push(entry); return; }
    const key = `${entry.phase_id || ""}::${entry.tache_id}`;
    const cur = fusion.get(key);
    if (cur) {
      cur.h += h;
      if (av != null) cur.av = cur.av == null ? av : Math.max(cur.av, av);
      if (entry.q) {
        cur.q = cur.q
          ? {
              declaree: cur.q.declaree == null && entry.q.declaree == null ? null : cent((cur.q.declaree || 0) + (entry.q.declaree || 0)),
              validee: cent(cur.q.validee + entry.q.validee),
              unite: cur.q.unite || entry.q.unite,
            }
          : entry.q;
      }
    } else {
      fusion.set(key, entry);
    }
  });
  const mkTache = (e) => ({
    ...base, phase_id: e.phase_id, tache_id: e.tache_id,
    heures: e.h, avancement_declare: e.av, type_pointage: "tache",
    ...(e.q ? { quantite_declaree: e.q.declaree, quantite_validee: e.q.validee, quantite_unite: e.q.unite } : {}),
  });
  const lignesTaches = [...[...fusion.values()].map(mkTache), ...libres.map(mkTache)];

  // 2) Heures indirectes saisies (motif + heures).
  const lignesIndirectes = (indirectLines || [])
    .filter(li => (parseFloat(li.heures) || 0) > 0 && (li.motif || "").trim())
    .map(li => ({
      ...base, phase_id: null, tache_id: null,
      heures: parseFloat(li.heures), avancement_declare: null,
      type_pointage: "indirect", motif_indirect: li.motif.trim(),
    }));

  // 3) Trajet — quote-part exacte en centimes, PONDÉRÉE par le temps passé sur
  //    chaque chantier du jour (plus grand reste). Un rapport à 0h ne porte
  //    aucun trajet ; à défaut d'infos horaires on retombe sur des parts égales.
  const nb = Math.max(1, nbChantiersDuJour);
  const heuresJour = Array.isArray(heuresParRapportDuJour) && heuresParRapportDuJour.length
    ? heuresParRapportDuJour
    : Array(nb).fill(1); // pas d'infos → parts égales (comportement historique)
  const centsParRapport = repartTrajetCents(trajetMinTotal, heuresJour);
  const trajetH = (centsParRapport[rangRapport] || 0) / 100;
  const lignesTrajet = trajetH > 0 ? [{
    ...base, phase_id: null, tache_id: null,
    heures: trajetH, avancement_declare: null,
    type_pointage: "indirect", motif_indirect: nb > 1 ? "Trajet (quote-part)" : "Trajet",
  }] : [];

  return [...lignesTaches, ...lignesIndirectes, ...lignesTrajet];
}

// Quantité >= 0 arrondie au centième ; null si absente.
function qte(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, cent(n)) : null;
}
function cent(n) { return Math.round(n * 100) / 100; }

// Outil de ré-génération (Admin → Pointages) : il repart de la déclaration
// des rapports. Les quantités VALIDÉES par le conducteur ne sont pas dans le
// rapport : on les reprend des pointages qu'on remplace, tâche par tâche,
// pour que le cumul des tâches suivies en quantité ne change pas.
export function reporterQuantites(lignes, anciens) {
  const parTache = new Map();
  (anciens || []).forEach(p => {
    if (!p?.tache_id || p.quantite_validee === null || p.quantite_validee === undefined) return;
    parTache.set(String(p.tache_id), {
      quantite_declaree: p.quantite_declaree ?? null, quantite_validee: p.quantite_validee, quantite_unite: p.quantite_unite ?? null,
    });
  });
  return (lignes || []).map(l => (l.tache_id && parTache.has(String(l.tache_id)) ? { ...l, ...parTache.get(String(l.tache_id)) } : l));
}

// Répartit le trajet total (minutes) entre les rapports d'un même jour, en
// CENTIMES d'heure, pondéré par le temps travaillé de chaque rapport.
// Renvoie un tableau de centimes aligné sur `heuresParRapport` (même ordre).
//   • poids = heures travaillées → un rapport à 0h reçoit 0 (trajet non compté).
//   • plus grand reste → la somme des centimes = exactement le trajet total.
//   • journée entière à 0h (cas dégénéré : trajet sans heures) → parts égales,
//     pour ne pas perdre le trajet.
export function repartTrajetCents(trajetMin, heuresParRapport) {
  const hrs = (heuresParRapport || []).map(h => Math.max(0, parseFloat(h) || 0));
  const n = hrs.length;
  const out = new Array(n).fill(0);
  const totalCents = Math.round(((parseInt(trajetMin) || 0) / 60) * 100);
  if (n === 0 || totalCents <= 0) return out;

  const totalH = hrs.reduce((s, h) => s + h, 0);
  const poids = totalH > 0 ? hrs : hrs.map(() => 1);
  const totalPoids = totalH > 0 ? totalH : n;

  const exact = poids.map(p => (totalCents * p) / totalPoids);
  const cents = exact.map(Math.floor);
  let reste = totalCents - cents.reduce((s, c) => s + c, 0);
  // Les centimes restants vont aux rapports dont la partie fractionnaire est la
  // plus grande (départage stable par index). Un rapport à poids nul a une
  // fraction nulle → il ne reçoit jamais de centime.
  const ordre = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < ordre.length && reste > 0; k++) {
    cents[ordre[k].i] += 1;
    reste -= 1;
  }
  return cents;
}

// Heures DÉCLARÉES d'un rapport hors trajet : tâches + heures indirectes saisies.
// Sert de poids à la répartition pondérée du trajet.
export function heuresDeclareesRapport(r) {
  return (r?.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0)
    + (r?.heures_indirectes || []).reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);
}

// Rang stable d'un rapport parmi les rapports du même ouvrier/jour (tri par id).
// Sert à la répartition déterministe du trajet, indépendante de l'ordre de
// validation.
export function rangRapportDuJour(rapport, rapportsMemeJour) {
  return [...(rapportsMemeJour || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .findIndex(r => r.id === rapport.id);
}
