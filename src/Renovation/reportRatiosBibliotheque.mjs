// src/Renovation/reportRatiosBibliotheque.mjs — report d'un ouvrage de la
// bibliothèque sur les chantiers qui l'utilisent.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// phasages et l'ouvrage arrivent en paramètre ; la date de la correction est
// fournie par l'appelant. Façade front : reportRatiosBibliotheque.js.
//
// POURQUOI
// --------
// À l'import du devis, la cadence (h/unité) et la répartition en % des étapes
// sont COPIÉES dans le phasage : une correction de la bibliothèque ne touchait
// donc jamais un chantier existant. Décision du 16/10/2026 : chaque
// enregistrement d'un ouvrage de la bibliothèque est reporté automatiquement
// sur TOUS les chantiers qui l'utilisent (terminés compris), et la
// bibliothèque l'emporte sur un ajustement fait à la main sur le chantier.
//
// RÈGLE DE REPORT (même règle que l'import du devis, PhasageV2.confirmImport)
// ---------------------------------------------------------------------------
// Pour chaque ouvrage du phasage lié à l'ouvrage (bibliotheque_id) :
//   • heures estimées de l'ouvrage = cadence × quantité (inchangées si la
//     cadence ou la quantité manque — on n'efface jamais une heure) ;
//   • chaque tâche RECONNUE (même étape de la bibliothèque : identifiant
//     source, à défaut même nom) reprend le % de la bibliothèque ;
//   • les heures estimées de l'ouvrage sont réparties entre les tâches
//     reconnues selon ces % — c'est ce poids qui fait l'avancement ;
//   • les heures VENDUES des tâches reconnues sont réparties selon les mêmes %,
//     leur TOTAL ne bouge pas (ce qui a été vendu au client reste vendu).
// Jamais touchés : avancement saisi, heures réelles, prix, heures vendues de
// l'ouvrage, quantités, tâches hors devis, tâches non reconnues (renvoyées
// pour être affichées : une tâche laissée telle quelle ne doit pas passer
// pour corrigée).

import { avancementChantier } from "../chantierFinance.mjs";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const arr2 = (n) => Number(n.toFixed(2));

// Nom comparable : casse, accents et espaces multiples ignorés.
export function nomComparable(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Répartit `total` selon `poids` (même cascade que PhasageV2.repartirHeures :
// poids donnés → poids de repli → parts égales). Valeurs exactes, 2 décimales.
function repartir(total, poids, poidsRepli) {
  let p = poids;
  let somme = p.reduce((s, x) => s + x, 0);
  if (somme <= 0 && poidsRepli) { p = poidsRepli; somme = p.reduce((s, x) => s + x, 0); }
  if (somme <= 0) { p = p.map(() => 1); somme = p.length; }
  // Au centime près, la SOMME des parts vaut exactement le total (méthode du
  // plus fort reste). Sans cela, la somme arrondie dérive d'un centième, et un
  // second report du même ouvrage redistribue autrement : le chantier est
  // réécrit pour rien à chaque enregistrement (vu le 16/10/2026, 7,36 → 7,37 h).
  const cible = Math.round(total * 100);
  const bruts = p.map(x => cible * x / somme);
  const parts = bruts.map(v => Math.floor(v + 1e-9));
  const reste = cible - parts.reduce((s, x) => s + x, 0);
  bruts
    .map((v, i) => ({ i, f: v - parts[i] }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .slice(0, Math.max(0, reste))
    .forEach(({ i }) => { parts[i] += 1; });
  return parts.map(c => c / 100);
}

// Associe chaque tâche de l'ouvrage du chantier à une étape de la bibliothèque.
// Une étape ne peut servir qu'à une tâche : deux tâches de même nom (tâche
// dupliquée sur le chantier) ou deux étapes de même nom (ambiguïté côté
// bibliothèque) ne sont pas devinées — elles restent « non reconnues ».
function associerTaches(taches, sousTaches) {
  const parId = new Map();
  sousTaches.forEach(st => { if (st?.id != null && st.id !== "") parId.set(String(st.id), st); });
  const parNom = new Map();
  const nomsDoublons = new Set();
  sousTaches.forEach(st => {
    const k = nomComparable(st?.nom);
    if (!k) return;
    if (parNom.has(k)) nomsDoublons.add(k); else parNom.set(k, st);
  });

  const prises = new Set();
  const lien = taches.map(() => null);
  // 1er passage : identifiant source (ouvrages V2) — sans ambiguïté possible.
  taches.forEach((t, i) => {
    const sid = t?.source_sous_tache_id;
    if (sid == null || sid === "") return;
    const st = parId.get(String(sid));
    if (st && !prises.has(st)) { lien[i] = st; prises.add(st); }
  });
  // 2e passage : nom, seulement s'il est unique des deux côtés.
  const compteNomsTaches = new Map();
  taches.forEach((t, i) => {
    if (lien[i]) return;
    const k = nomComparable(t?.nom);
    compteNomsTaches.set(k, (compteNomsTaches.get(k) || 0) + 1);
  });
  taches.forEach((t, i) => {
    if (lien[i]) return;
    const k = nomComparable(t?.nom);
    if (!k || nomsDoublons.has(k) || compteNomsTaches.get(k) > 1) return;
    const st = parNom.get(k);
    if (st && !prises.has(st)) { lien[i] = st; prises.add(st); }
  });
  return lien;
}

// Report sur UN ouvrage du phasage. Renvoie { ouvrage, modifie, realignees,
// nonReconnues: [noms] }.
export function reporterSurOuvrage(ouvrage, ouvrageBiblio) {
  const taches = Array.isArray(ouvrage?.taches) ? ouvrage.taches : [];
  const sousTaches = Array.isArray(ouvrageBiblio?.sous_taches) ? ouvrageBiblio.sous_taches : [];

  // Heures estimées de l'ouvrage : cadence × quantité, sinon inchangées.
  const cadence = num(ouvrageBiblio?.cadence);
  const quantite = num(ouvrage?.quantite);
  const heuresOuvrage = cadence != null && cadence > 0 && quantite != null && quantite > 0
    ? arr2(cadence * quantite)
    : num(ouvrage?.heures_estimees);

  // Les tâches hors devis ne sont jamais concernées (travail non vendu).
  const candidates = taches.map((t, i) => ({ t, i })).filter(({ t }) => t?.hors_devis !== true);
  const liens = associerTaches(candidates.map(c => c.t), sousTaches);
  const reconnues = candidates.filter((_, k) => liens[k]);
  const stDe = new Map();
  candidates.forEach((c, k) => { if (liens[k]) stDe.set(c.i, liens[k]); });
  const nonReconnues = candidates.filter((_, k) => !liens[k]).map(c => c.t?.nom || "(sans nom)");

  // % : la bibliothèque l'emporte. Si AUCUNE étape n'a de %, la bibliothèque
  // n'exprime pas de répartition : on garde celle du chantier.
  const biblioARatios = sousTaches.some(st => (num(st?.ratio) || 0) > 0);
  const ratioDe = (c) => biblioARatios ? (num(stDe.get(c.i)?.ratio) || 0) : (num(c.t.ratio) || 0);
  const poids = reconnues.map(ratioDe);

  const nouvelles = taches.slice();
  if (reconnues.length > 0) {
    // Heures estimées : total de l'ouvrage (ou, faute de total, celui que
    // portent déjà les tâches reconnues), réparti selon les %.
    const sommeEstimees = reconnues.reduce((s, c) => s + (num(c.t.heures_estimees) || 0), 0);
    const totalEstimees = heuresOuvrage != null ? heuresOuvrage : (sommeEstimees > 0 ? sommeEstimees : null);
    const estimees = totalEstimees == null ? null
      : repartir(totalEstimees, poids, reconnues.map(c => num(c.t.heures_estimees) || 0));

    // Heures vendues : on redistribue le total déjà porté par les tâches
    // reconnues ; si aucune n'en porte, les heures vendues de l'ouvrage.
    const ontVendues = reconnues.some(c => c.t.heures_vendues != null);
    const totalVendues = ontVendues
      ? reconnues.reduce((s, c) => s + (num(c.t.heures_vendues) || 0), 0)
      : num(ouvrage?.heures_devis);
    const vendues = totalVendues == null ? null
      : repartir(totalVendues, poids, reconnues.map(c => num(c.t.heures_vendues) || 0));

    reconnues.forEach((c, k) => {
      const patch = {};
      if (biblioARatios) patch.ratio = poids[k];
      if (estimees) patch.heures_estimees = estimees[k];
      if (vendues) patch.heures_vendues = vendues[k];
      nouvelles[c.i] = { ...c.t, ...patch };
    });
  }

  const ouvrageNouveau = {
    ...ouvrage,
    ...(heuresOuvrage != null ? { heures_estimees: heuresOuvrage } : {}),
    taches: nouvelles,
  };
  const modifie = JSON.stringify(ouvrageNouveau) !== JSON.stringify(ouvrage);
  const realignees = reconnues.filter(c => JSON.stringify(nouvelles[c.i]) !== JSON.stringify(c.t)).length;
  return { ouvrage: modifie ? ouvrageNouveau : ouvrage, modifie, realignees, nonReconnues };
}

// Report sur un phasage entier (tableau `ouvrages`). Renvoie les ouvrages
// mis à jour, l'avancement global avant / après (formule de chantierFinance,
// la même que partout dans l'application) et le détail à afficher.
export function reporterSurPhasage(ouvrages, ouvrageBiblio) {
  const liste = Array.isArray(ouvrages) ? ouvrages : [];
  const idBiblio = ouvrageBiblio?.id == null ? null : String(ouvrageBiblio.id);
  let concernes = 0, realignees = 0, modifie = false;
  const nonReconnues = [];
  const nouveaux = liste.map(o => {
    if (idBiblio == null || o?.bibliotheque_id == null || String(o.bibliotheque_id) !== idBiblio) return o;
    concernes += 1;
    const r = reporterSurOuvrage(o, ouvrageBiblio);
    if (r.modifie) modifie = true;
    realignees += r.realignees;
    r.nonReconnues.forEach(nom => nonReconnues.push({ ouvrage: o.libelle || "(sans libellé)", tache: nom }));
    return r.ouvrage;
  });
  return {
    ouvrages: modifie ? nouveaux : liste,
    modifie,
    ouvragesConcernes: concernes,
    tachesRealignees: realignees,
    nonReconnues,
    avancementAvant: avancementChantier(liste),
    avancementApres: avancementChantier(modifie ? nouveaux : liste),
  };
}

// ── Journal des corrections (Bilan Semaine) ─────────────────────────────────
// Un report qui change l'avancement global d'un chantier est noté dans
// plan_travaux.meta.corrections_ratios. Le Bilan Semaine le sort de la
// progression de la semaine : un point d'avancement gagné par correction de
// ratios n'est pas du travail fait, ni de la marge générée.

export const MAX_CORRECTIONS = 300;

// `entree` : { le (ISO), date ("AAAA-MM-JJ", heure de Paris), bibliotheque_id,
// libelle, avant, apres }. Renvoie un NOUVEAU plan_travaux.
export function ajouterCorrectionRatios(planTravaux, entree) {
  const plan = planTravaux && typeof planTravaux === "object" ? planTravaux : {};
  const meta = plan.meta && typeof plan.meta === "object" ? plan.meta : {};
  const existantes = Array.isArray(meta.corrections_ratios) ? meta.corrections_ratios : [];
  const corrections = [...existantes, entree].slice(-MAX_CORRECTIONS);
  return { ...plan, meta: { ...meta, corrections_ratios: corrections } };
}

// Points d'avancement dus aux corrections de ratios entre deux relevés :
// corrections datées APRÈS `apres` (date du relevé de départ, exclue — le
// relevé du vendredi soir inclut déjà une correction faite dans la journée)
// et au plus tard `jusqua` (incluse ; null = jusqu'à maintenant).
// `apres` null (chantier sans relevé de départ) : toutes les corrections
// jusqu'à `jusqua`. Renvoie { points, nb }.
export function correctionRatiosPeriode(planTravaux, { apres = null, jusqua = null } = {}) {
  const liste = planTravaux?.meta?.corrections_ratios;
  if (!Array.isArray(liste)) return { points: 0, nb: 0 };
  let points = 0, nb = 0;
  liste.forEach(c => {
    const d = typeof c?.date === "string" ? c.date : null;
    if (!d) return;
    if (apres && d <= apres) return;
    if (jusqua && d > jusqua) return;
    const delta = (num(c.apres) ?? 0) - (num(c.avant) ?? 0);
    if (delta === 0) return;
    points += delta;
    nb += 1;
  });
  return { points, nb };
}
