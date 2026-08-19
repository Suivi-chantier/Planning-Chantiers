// ─────────────────────────────────────────────────────────────────────────────
// chantierFinance — SOURCE DE VÉRITÉ des calculs financiers et d'avancement
// d'un chantier. Formules reprises À L'IDENTIQUE de PhasageV2.jsx (étape 0b,
// cf. public/inventaire-calculs-phasagev2.md). Si un chiffre affiché change à
// cause d'un refactor, c'est un bug du refactor, pas une correction.
//
// RÈGLES DU MODULE :
//  • Fonctions PURES : aucun appel réseau, aucun React, aucun accès à
//    window/localStorage/horloge. Toutes les données arrivent en argument.
//  • Importable depuis le front Vite (via la façade src/chantierFinance.js)
//    ET depuis les crons CommonJS de /api via `await import(".../chantierFinance.mjs")`
//    — l'extension .mjs force le parsing ESM côté Node sans toucher package.json.
//  • Aucune dépendance npm.
//
// Chaque indicateur du retour est un objet « Donnee » :
//   { cle, label, sousLabel, valeur, valeurTexte, format, formule,
//     calculDetaille, ventilation, titre, sousTitre, vide, totalLabel,
//     totalTexte, source, fraicheur, warnings, renseigne }
//   - formule : rédigée en français lisible par un conducteur de travaux.
//   - calculDetaille : la formule avec les nombres réels substitués.
//   - ventilation : lignes { main, sub, right, rightColor } — même forme que
//     les modales kpiDetail de PhasageV2, affichables sans transformation.
//   - renseigne: false = donnée d'entrée absente (≠ un vrai zéro calculé).
// ─────────────────────────────────────────────────────────────────────────────

// ── Constantes métier ────────────────────────────────────────────────────────
// Taux MO prévisionnel de repli si le réglage Admin est vide (= constants.js).
export const TAUX_MO_PREV_DEFAUT = 25;
// Dérive d'un lot : (heures réelles / vendues) ÷ (avancement/100) au-delà → alerte.
export const SEUIL_RATIO_DERIVE = 1.15;
// Écart entre la somme des ouvrages et le montant du devis renseigné.
export const SEUIL_ECART_VENDU_PCT = 1;    // en % du devis
export const SEUIL_ECART_VENDU_EUR = 500;  // en €
// Seuil « marge fragile » (orange) en % du vendu.
export const SEUIL_MARGE_PCT_ORANGE = 15;

// ── Formatage (identique à PhasageV2 : fmtEur/eur = arrondi €, fmtH = h) ─────
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const fmtH = (n) => (parseFloat(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
export const eur  = (n) => `${Math.round(parseFloat(n) || 0).toLocaleString("fr-FR")} €`;

// ── Agrégations du registre de pointage ──────────────────────────────────────
// Versions canoniques des helpers de src/pointages.js (indexPointagesParTache,
// sumLibreEtIndirect, sumHeures, sumCoutMO). pointages.js ne peut pas être
// importé ici (il tire supabase/import.meta.env, incompatible cron Node pur) ;
// à l'étape 1, pointages.js ré-exportera ces versions pour supprimer le doublon.

// Indexe les pointages "tâche" (productifs, non-indirects, avec tache_id) par tache_id.
export function indexPointagesParTache(points) {
  const m = {};
  (points || []).forEach(p => {
    if (p.type_pointage === "indirect") return;
    if (!p.tache_id) return; // tâche libre : pas d'imputation au plan
    const k = String(p.tache_id);
    if (!m[k]) m[k] = [];
    m[k].push(p);
  });
  return m;
}

// Heures + coût des pointages hors tâches du plan : "libres" (tache_id null,
// type tache) et "indirects" (trajet compris).
export function sumLibreEtIndirect(points) {
  let heuresLibre = 0, coutLibre = 0, heuresIndirect = 0, coutIndirect = 0;
  (points || []).forEach(p => {
    const h = parseFloat(p.heures) || 0;
    const c = h * (parseFloat(p.taux_horaire) || 0);
    if (p.type_pointage === "indirect") { heuresIndirect += h; coutIndirect += c; }
    else if (!p.tache_id) { heuresLibre += h; coutLibre += c; }
  });
  return { heuresLibre, coutLibre, heuresIndirect, coutIndirect };
}

export function sumHeures(pts) {
  return (pts || []).reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
}

export function sumCoutMO(pts) {
  return (pts || []).reduce(
    (s, p) => s + ((parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0)),
    0,
  );
}

// ── Tâche ────────────────────────────────────────────────────────────────────
// `ppt` = index { tache_id: [pointages] } produit par indexPointagesParTache.

export const tachePointages = (t, ppt) => (ppt && ppt[String(t?.id)]) || [];

// Heures réelles d'une tâche : somme des pointages du registre si présents,
// sinon repli legacy sur t.heures_reelles (gère le format tableau de la v1).
export function tacheHeuresReelles(t, ppt) {
  const pts = tachePointages(t, ppt);
  if (pts.length > 0) return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
  if (Array.isArray(t.heures_reelles)) {
    return t.heures_reelles.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }
  return parseFloat(t.heures_reelles) || 0;
}

export const tacheHeuresVendues = (t) => parseFloat(t?.heures_vendues) || 0;

// Coût MO d'une tâche : registre (heures × taux figé par ouvrier) si présent.
// Repli legacy PhasageV2 : heures_reelles × taux pour CHAQUE ouvrier assigné
// (somme sur tous — c'est la version PhasageV2 qui fait foi, PAS le repli
// ouvriers[0] de pointages.js/coutMOEff).
export function coutMOTache(t, ppt, tauxHoraires) {
  const pts = tachePointages(t, ppt);
  if (pts.length > 0) {
    return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0), 0);
  }
  const hr = tacheHeuresReelles(t, ppt);
  if (hr === 0) return 0;
  const ouvs = Array.isArray(t.ouvriers) ? t.ouvriers.filter(Boolean) : [];
  if (ouvs.length === 0) return 0;
  return ouvs.reduce((s, nom) => s + hr * (parseFloat(tauxHoraires?.[nom]) || 0), 0);
}

// Ventilation du registre d'une tâche par ouvrier : { ouvrier, heures, cout, taux }.
export function tachePointagesParOuvrier(t, ppt) {
  const m = {};
  tachePointages(t, ppt).forEach(p => {
    const nom = p.ouvrier || "?";
    const h = parseFloat(p.heures) || 0;
    const taux = parseFloat(p.taux_horaire) || 0;
    if (!m[nom]) m[nom] = { ouvrier: nom, heures: 0, cout: 0, taux };
    m[nom].heures += h;
    m[nom].cout += h * taux;
    m[nom].taux = taux; // dernier taux figé connu (identique en pratique)
  });
  return Object.values(m).sort((a, b) => b.heures - a.heures);
}

// ── Ouvrage ──────────────────────────────────────────────────────────────────

export const prixHTOuvrage       = (o) => parseFloat(o?.prix_ht) || 0;
export const coutMatOuvrage      = (o) => parseFloat(o?.cout_materiaux) || 0; // prévu (bibliothèque)
export const heuresVenduesOuvrage = (o) => parseFloat(o?.heures_devis) || 0;
export const heuresReellesOuvrage = (o, ppt) =>
  (o?.taches || []).reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0);
export const coutMOOuvrage = (o, ppt, tauxHoraires) =>
  (o?.taches || []).reduce((s, t) => s + coutMOTache(t, ppt, tauxHoraires), 0);

// Avancement d'un ouvrage : moyenne des avancements de ses tâches, pondérée
// par heures_estimees (moyenne simple si aucune heure estimée), ARRONDIE.
// L'arrondi intermédiaire est volontaire : il se propage aux lots/chantier
// exactement comme dans PhasageV2.
export function avancementOuvrage(ouvrage) {
  const taches = ouvrage?.taches || [];
  if (taches.length === 0) return 0;
  const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHE > 0) {
    return Math.round(
      taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0), 0) / totalHE
    );
  }
  return Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length);
}

// ── Groupes chrono (vue chrono / cycle de vie chantier) ─────────────────────
// Synthèse d'un groupe d'exécution : tâches rattachées via chrono_groupe_id.
// Avancement pondéré par heures_vendues — MÊME convention que groupStats de la
// vue chrono (PhasageV2) ; elle diffère volontairement d'avancementOuvrage
// (pondéré heures_estimees) : ne pas « harmoniser ».
// `termine` = toutes les tâches du groupe à 100 % (définition du cycle de vie).
export function statsGroupeChrono(groupeId, ouvrages) {
  const taches = (ouvrages || [])
    .flatMap(o => o?.taches || [])
    .filter(t => t?.chrono_groupe_id === groupeId);
  let wsum = 0, wtot = 0, ssum = 0;
  taches.forEach(t => {
    const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
    const h = parseFloat(t.heures_vendues) || 0;
    ssum += av;
    if (h > 0) { wsum += av * h; wtot += h; }
  });
  const avancement = wtot > 0
    ? Math.round(wsum / wtot)
    : (taches.length ? Math.round(ssum / taches.length) : 0);
  const termine = taches.length > 0 && taches.every(t => (parseInt(t.avancement) || 0) >= 100);
  return { count: taches.length, avancement, termine };
}

// ── Lots ─────────────────────────────────────────────────────────────────────
// Le pseudo-lot "_orphans" agrège les ouvrages sans lot_id reconnu.

export function ouvragesDuLot(ouvrages, lots, lotId) {
  const list = ouvrages || [];
  return lotId === "_orphans"
    ? list.filter(o => !o.lot_id || !(lots || []).some(l => l.id === o.lot_id))
    : list.filter(o => o.lot_id === lotId);
}

// Avancement d'un lot : moyenne des avancements (déjà arrondis) de ses
// ouvrages, pondérée par prix_ht (moyenne simple si aucun prix), arrondie.
export function avancementLot(ouvrages, lots, lotId) {
  const lotOuvrages = ouvragesDuLot(ouvrages, lots, lotId);
  if (lotOuvrages.length === 0) return 0;
  const totalPrix = lotOuvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  if (totalPrix > 0) {
    return Math.round(
      lotOuvrages.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
    );
  }
  return Math.round(lotOuvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / lotOuvrages.length);
}

// Avancement global du chantier : tous ouvrages confondus, pondéré prix_ht.
export function avancementChantier(ouvrages) {
  const list = ouvrages || [];
  if (list.length === 0) return 0;
  const totalPrix = list.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  if (totalPrix > 0) {
    return Math.round(
      list.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
    );
  }
  return Math.round(list.reduce((s, o) => s + avancementOuvrage(o), 0) / list.length);
}

// ── Détails d'avancement (textes explicatifs, repris tels quels) ─────────────
const fmt1 = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

export function avancementOuvrageDetail(ouvrage) {
  const taches = ouvrage?.taches || [];
  if (taches.length === 0) return "Aucune tâche";
  const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHE > 0) {
    const lines = taches.map((t, i) => {
      const av = parseFloat(t.avancement) || 0;
      const h  = parseFloat(t.heures_estimees) || 0;
      const faites = (av / 100) * h;
      return `  ${i + 1}. "${t.nom || "(sans nom)"}" : ${av}% × ${fmt1(h)}h = ${fmt1(faites)}h`;
    });
    const heuresFaites = taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) / 100) * (parseFloat(t.heures_estimees) || 0), 0);
    return `Calcul pondéré par heures estimées :\n${lines.join("\n")}\n\nHeures faites = ${fmt1(heuresFaites)}h\nTotal heures = ${fmt1(totalHE)}h\n→ ${fmt1(heuresFaites)} / ${fmt1(totalHE)} = ${(heuresFaites / totalHE * 100).toFixed(2)} %`;
  }
  const moy = taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length;
  return `Aucune heure estimée — moyenne simple :\n${taches.map((t, i) => `  ${i + 1}. "${t.nom || "(sans nom)"}" : ${parseFloat(t.avancement) || 0}%`).join("\n")}\n\n→ Moyenne = ${moy.toFixed(2)} %`;
}

export function avancementLotDetail(ouvrages, lots, lotId) {
  const lotOuvrages = ouvragesDuLot(ouvrages, lots, lotId);
  if (lotOuvrages.length === 0) return "Aucun ouvrage dans ce lot";
  const totalPrix = lotOuvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  if (totalPrix > 0) {
    const lines = lotOuvrages.map((o, i) => {
      const a = avancementOuvrage(o);
      const p = parseFloat(o.prix_ht) || 0;
      const accompli = (a / 100) * p;
      return `  ${i + 1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${a}% × ${p.toLocaleString("fr-FR")} € = ${accompli.toLocaleString("fr-FR")} €`;
    });
    const eurosAccomplis = lotOuvrages.reduce((s, o) => s + (avancementOuvrage(o) / 100) * (parseFloat(o.prix_ht) || 0), 0);
    return `Calcul pondéré par prix HT :\n${lines.join("\n")}\n\n€ accomplis = ${eurosAccomplis.toLocaleString("fr-FR")} €\nTotal prix HT = ${totalPrix.toLocaleString("fr-FR")} €\n→ ${eurosAccomplis.toLocaleString("fr-FR")} / ${totalPrix.toLocaleString("fr-FR")} = ${(eurosAccomplis / totalPrix * 100).toFixed(2)} %`;
  }
  const moy = lotOuvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / lotOuvrages.length;
  return `Aucun prix HT renseigné — moyenne simple :\n${lotOuvrages.map((o, i) => `  ${i + 1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${avancementOuvrage(o)}%`).join("\n")}\n\n→ Moyenne = ${moy.toFixed(2)} %`;
}

export function avancementChantierDetail(ouvrages) {
  const list = ouvrages || [];
  if (list.length === 0) return "Aucun ouvrage";
  const totalPrix = list.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
  if (totalPrix > 0) {
    const lines = list.map((o, i) => {
      const a = avancementOuvrage(o);
      const p = parseFloat(o.prix_ht) || 0;
      const accompli = (a / 100) * p;
      return `  ${i + 1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${a}% × ${p.toLocaleString("fr-FR")} € = ${accompli.toLocaleString("fr-FR")} €`;
    });
    const eurosAccomplis = list.reduce((s, o) => s + (avancementOuvrage(o) / 100) * (parseFloat(o.prix_ht) || 0), 0);
    return `Calcul pondéré par prix HT :\n${lines.join("\n")}\n\n€ accomplis = ${eurosAccomplis.toLocaleString("fr-FR")} €\nTotal prix HT = ${totalPrix.toLocaleString("fr-FR")} €\n→ ${eurosAccomplis.toLocaleString("fr-FR")} / ${totalPrix.toLocaleString("fr-FR")} = ${(eurosAccomplis / totalPrix * 100).toFixed(2)} %`;
  }
  return "Aucun prix HT renseigné — moyenne simple des % des ouvrages";
}

export function avancementTacheDetail(t) {
  const av = parseFloat(t?.avancement) || 0;
  const h  = parseFloat(t?.heures_estimees);
  if (h != null && !isNaN(h)) {
    const faites = (av / 100) * h;
    return `Avancement saisi : ${av} %\nHeures estimées : ${fmt1(h)}h\nHeures faites : ${av}% × ${fmt1(h)}h = ${fmt1(faites)}h`;
  }
  return `Avancement saisi : ${av} %\n(Pas d'heures estimées)`;
}

// ── Situation à facturer (formule partagée) ──────────────────────────────────
// LA formule de la situation : (avancement % − % facturé) × vendu HT.
// `avancementPct` en 0-100, `pctFacture` en FRACTION 0-1 (États financiers),
// null si le % facturé est indisponible ou le vendu nul — jamais un faux zéro.
// Exportée pour être RÉUTILISÉE (diagramme financier : recettes prévues =
// même formule appliquée à l'avancement prévu), jamais réécrite ailleurs.
export function situationAFacturerVal(avancementPct, pctFacture, prixHT) {
  return (pctFacture != null && Number.isFinite(parseFloat(pctFacture)) && prixHT > 0)
    ? (avancementPct - parseFloat(pctFacture) * 100) / 100 * prixHT
    : null;
}

// ── Lignes de commande ───────────────────────────────────────────────────────
// Total réel d'un jeu de lignes : prix_total sinon PU × quantité (un prix_total
// à 0 explicite retombe sur PU × quantité — comportement historique conservé).
export function totalLignes(lignes) {
  return (lignes || []).reduce(
    (s, l) => s + (parseFloat(l.prix_total) || ((parseFloat(l.prix_unitaire) || 0) * (parseFloat(l.quantite) || 0)) || 0), 0);
}

// ── Seuils de couleur (règle métier partagée ; l'UI applique les couleurs) ───
// Dérive heures réelles vs estimées : vert ≤ 1, orange ≤ 1,2, rouge au-delà.
export function couleurDerive(reelles, estimees) {
  if (!estimees || estimees <= 0) return null;
  const ratio = reelles / estimees;
  if (ratio <= 1)   return "#22c55e";
  if (ratio <= 1.2) return "#f5a623";
  return "#e15a5a";
}
// Rouge quand les heures réelles dépassent les heures vendues.
export function couleurDepassement(reelles, vendues) {
  return (vendues > 0 && reelles > vendues) ? "#e15a5a" : null;
}
// Marge : rouge < 0, orange < 15 % du vendu, vert sinon.
export function couleurMarge(marge, margePct) {
  return marge < 0 ? "#e15a5a" : margePct < SEUIL_MARGE_PCT_ORANGE ? "#f5a623" : "#22c55e";
}

// ── Stats trajets / indirect (incluses dans le coût MO total) ────────────────
export function statsTrajet(pointages) {
  let heures = 0, cout = 0;
  (pointages || []).forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (!/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    heures += h; cout += h * (parseFloat(p.taux_horaire) || 0);
  });
  return { heures, cout };
}

export function statsIndirectHorsTrajet(pointages) {
  let heures = 0, cout = 0;
  (pointages || []).forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    heures += h; cout += h * (parseFloat(p.taux_horaire) || 0);
  });
  return { heures, cout };
}

// Heures passées, ventilées PAR MOIS puis PAR OUVRIER. Toutes les heures
// pointées comptent (tâches + trajets + indirect). Triée du mois le plus
// récent au plus ancien : [{ mois:"2026-07", label:"juillet 2026", heures,
// cout, ouvriers:[{ nom, heures, cout }] }]. (Le « mois en cours » dépend de
// l'horloge : il reste côté UI.)
export function heuresParMois(pointages) {
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const parMois = {};
  (pointages || []).forEach(p => {
    const d = (p.date || "").slice(0, 7); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(d)) return;
    const h = parseFloat(p.heures) || 0;
    const c = h * (parseFloat(p.taux_horaire) || 0);
    const nom = (p.ouvrier || "—").trim() || "—";
    const m = (parMois[d] ||= { mois: d, heures: 0, cout: 0, ouvriers: {} });
    m.heures += h; m.cout += c;
    const o = (m.ouvriers[nom] ||= { nom, heures: 0, cout: 0 });
    o.heures += h; o.cout += c;
  });
  return Object.values(parMois)
    .map(m => ({
      ...m,
      label: (() => { const [y, mo] = m.mois.split("-"); return `${MOIS[parseInt(mo, 10) - 1]} ${y}`; })(),
      ouvriers: Object.values(m.ouvriers).sort((a, b) => b.heures - a.heures),
    }))
    .sort((a, b) => b.mois.localeCompare(a.mois));
}

// ─────────────────────────────────────────────────────────────────────────────
// MÉTHODE DE CALCUL — formules et sources en français, pour un conducteur de
// travaux. C'est LE registre utilisé par computeChantierFinance (champ
// `formule` des Donnee) ET par l'annexe « Méthode de calcul » du PDF / de
// l'aide : un texte, un seul endroit, jamais rédigé en dur dans l'UI.
// ─────────────────────────────────────────────────────────────────────────────
export const METHODE_CALCUL = [
  { cle: "venduHT", label: "Vendu HT",
    formule: "Somme des prix de vente HT des ouvrages du phasage",
    source: "Ouvrages du phasage (Phasage V2)" },
  { cle: "ecartVendu", label: "Écart de vendu",
    formule: "Somme des prix HT des ouvrages − montant du devis renseigné",
    source: "Ouvrages du phasage vs montant de devis saisi" },
  { cle: "heuresVendues", label: "Heures vendues",
    formule: "Somme des heures vendues au devis (heures_devis) des ouvrages",
    source: "Ouvrages du phasage (Phasage V2)" },
  { cle: "heuresReelles", label: "Heures totales",
    formule: "Heures pointées sur les tâches + heures libres + trajets et heures indirectes + reprise d'antériorité",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "moPrev", label: "MO prév.",
    formule: "Heures vendues × taux de main d'œuvre prévisionnel (réglage Admin)",
    source: "Ouvrages du phasage × taux Admin" },
  { cle: "matPrev", label: "Commandes prév.",
    formule: "Somme des coûts matériaux estimés des ouvrages (matériaux liés de la bibliothèque)",
    source: "Bibliothèque de matériaux (cout_materiaux des ouvrages)" },
  { cle: "margePrev", label: "Marge prév.",
    formule: "Vendu HT − déboursé prévisionnel (MO prévisionnelle + commandes prévisionnelles) − frais généraux prévisionnels (taux horaire FG × heures vendues)",
    source: "Ouvrages du phasage, taux Admin, bibliothèque de matériaux, Suivi direction" },
  { cle: "moReel", label: "Coût MO",
    formule: "Heures pointées × taux horaire de chaque ouvrier (taux figé au pointage) + heures libres + trajets et heures indirectes + reprise d'antériorité",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "matReel", label: "Matériaux",
    formule: "Somme des lignes de commande passées pour le chantier",
    source: "Lignes de commande du chantier" },
  { cle: "fg", label: "Frais généraux",
    formule: "Taux horaire de frais généraux (Suivi direction) × heures réelles totales du chantier",
    source: "Suivi direction (fg_taux_horaire) × registre de pointage" },
  { cle: "marge", label: "Marge nette",
    formule: "Vendu HT − coût main d'œuvre − matériaux − frais généraux",
    source: "Ouvrages du phasage, registre de pointage, lignes de commande, Suivi direction" },
  { cle: "margePct", label: "Marge %",
    formule: "Marge nette ÷ vendu HT × 100",
    source: "Dérivé de la marge nette" },
  { cle: "avancement", label: "Avancement",
    formule: "Moyenne des avancements des ouvrages, pondérée par leur prix de vente (chaque ouvrage : moyenne de ses tâches pondérée par les heures estimées)",
    source: "Avancements des tâches saisis / déclarés en fin de journée" },
  { cle: "trajets", label: "Trajets",
    formule: "Heures de trajet pointées × taux horaire de l'ouvrier (déjà comptées dans le coût MO)",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "indirect", label: "Heures indirectes",
    formule: "Heures indirectes pointées (hors trajet) × taux horaire de l'ouvrier (déjà comptées dans le coût MO)",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "reprise", label: "Reprise d'antériorité",
    formule: "Heures consommées avant l'application × taux moyen saisi (Suivi direction)",
    source: "Suivi direction (reprise_heures × reprise_taux)" },
  { cle: "ratioDerive", label: "Dérive d'un lot",
    formule: "(heures réelles ÷ heures vendues) ÷ (avancement ÷ 100) — à 1,00 le lot est dans le devis, au-delà de 1,15 il dérive ; indéterminé si les heures vendues ou l'avancement sont à zéro",
    source: "Ouvrages du lot + registre de pointage" },
  // ── Projections (étape 6) : où on va, pas seulement où on en est ──
  { cle: "resteAFaire", label: "Reste à faire", projection: true,
    formule: "Heures : somme des heures estimées restantes des tâches non terminées (heures estimées × part non faite). Euros : vendu HT × part du chantier restant à produire",
    source: "Tâches des ouvrages (heures estimées + avancement)" },
  { cle: "margeATerminaison", label: "Marge à terminaison", projection: true,
    formule: "Vendu HT − (coût MO réel + heures restantes × taux MO prévisionnel) − (matériaux réels + reste à commander) − frais généraux projetés (taux × heures totales projetées)",
    source: "Registre de pointage, tâches restantes, lignes de commande, bibliothèque de matériaux, Suivi direction" },
  { cle: "situationAFacturer", label: "Situation à facturer", projection: true,
    formule: "(avancement % − % facturé) × vendu HT — si l'avancement dépasse le facturé, une situation est à émettre",
    source: "Avancement du chantier + % facturé des États financiers (CA à provisionner)" },
  { cle: "resteACommander", label: "Reste à commander", projection: true,
    formule: "Somme des matériaux prévus (bibliothèque) sans ligne de commande ni marquage « commandé » — même règle que la page Commandes à passer",
    source: "Matériaux liés des ouvrages vs lignes de commande" },
];
const FORMULE = Object.fromEntries(METHODE_CALCUL.map(m => [m.cle, m.formule]));

// ─────────────────────────────────────────────────────────────────────────────
// computeChantierFinance — le point d'entrée. Reçoit les données déjà chargées
// (les appelants font les I/O) et rend tous les indicateurs sous forme Donnee.
// ─────────────────────────────────────────────────────────────────────────────
export function computeChantierFinance({
  phasage,             // ligne de la table phasages (ouvrages, plan_travaux, ...)
  pointages = [],      // pointages du chantier (déjà chargés)
  commandeLignes = [], // lignes de commande du chantier
  tauxHoraires = {},   // map { nom_ouvrier: taux } (réglages Admin)
  tauxMOPrev = 0,      // taux MO prévisionnel global (réglages Admin)
  lots = [],           // config des lots (planning_config.lots_travaux)
  // ── Optionnels, pour les PROJECTIONS (étape 6) ──
  pctFacture = null,     // % facturé du chantier, fraction 0-1 (États financiers) — null = non disponible
  materiauxById = null,  // map { id: fiche } de materiaux_bibliotheque — null = reste à commander indisponible
} = {}) {
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const meta = phasage?.plan_travaux?.meta || {};
  const ppt = indexPointagesParTache(pointages);
  const lotLabelOf = (id) => (lots || []).find(l => l.id === id)?.label || null;

  // ── Briques de calcul (formules PhasageV2, inchangées) ──
  const prixHTChantier = ouvrages.reduce((s, o) => s + prixHTOuvrage(o), 0);
  const heuresVenduesChantier = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
  const heuresReellesChantier = ouvrages.reduce((s, o) => s + (o.taches || []).reduce((ss, t) => ss + tacheHeuresReelles(t, ppt), 0), 0);
  const coutMOChantier = ouvrages.reduce((s, o) => s + coutMOOuvrage(o, ppt, tauxHoraires), 0);
  const extras = sumLibreEtIndirect(pointages);
  const repriseHeures = parseFloat(meta.reprise_heures) || 0;
  const repriseTaux   = parseFloat(meta.reprise_taux)   || 0;
  const repriseCout   = repriseHeures * repriseTaux;
  const coutMOTotalChantier = coutMOChantier + extras.coutLibre + extras.coutIndirect + repriseCout;
  const heuresReellesTotalChantier = heuresReellesChantier + extras.heuresLibre + extras.heuresIndirect + repriseHeures;
  const coutMatChantier = totalLignes(commandeLignes);
  const commandesPrevChantier = ouvrages.reduce((s, o) => s + coutMatOuvrage(o), 0);
  const tauxMOPrevEff = tauxMOPrev > 0 ? tauxMOPrev : TAUX_MO_PREV_DEFAUT;
  const moPrevChantier = heuresVenduesChantier * tauxMOPrevEff;
  const fgTauxHoraire = (() => {
    const v = parseFloat(meta.fg_taux_horaire);
    return Number.isFinite(v) ? v : 0;
  })();
  const fgChantier = fgTauxHoraire * heuresReellesTotalChantier;
  const margeChantier  = prixHTChantier - coutMOTotalChantier - coutMatChantier - fgChantier;
  const margePctChantier = prixHTChantier > 0 ? (margeChantier / prixHTChantier) * 100 : 0;
  // Marge PRÉVISIONNELLE : le devis face à ce qu'on a prévu de dépenser —
  // déboursé prévisionnel (MO prév. + commandes prév.) et FG au taux horaire
  // appliqué aux heures VENDUES (pas encore pointées).
  const fgPrevChantier = fgTauxHoraire * heuresVenduesChantier;
  const deboursePrevChantier = moPrevChantier + commandesPrevChantier;
  const margePrevChantier = prixHTChantier - deboursePrevChantier - fgPrevChantier;
  const margePrevPctChantier = prixHTChantier > 0 ? (margePrevChantier / prixHTChantier) * 100 : 0;
  const avancementGlobal = avancementChantier(ouvrages);
  const trajet = statsTrajet(pointages);
  const indirectHT = statsIndirectHorsTrajet(pointages);
  const margeCible = parseFloat(meta.marge_vendue_cible) || 0;
  const seuilPrime = parseFloat(meta.seuil_prime)        || 0;
  const prime      = parseFloat(meta.prime)              || 0;

  // ── Fraîcheur : dernier pointage connu (le module ne lit pas l'horloge) ──
  const dernierPointage = (pointages || []).reduce((max, p) => {
    const d = (p.date || "").slice(0, 10);
    return d && (!max || d > max) ? d : max;
  }, null);
  const fraicheur = { dernierPointage, nbPointages: (pointages || []).length };

  // ── Écart de vendu : Σ ouvrages (base de calcul) vs montant du devis ──
  // renseigné (meta.prix_vendu, sinon colonne phasages.prix_vendu). Un écart
  // signale une donnée à corriger (avenant oublié, ouvrage non chiffré).
  const devisMeta = parseFloat(meta.prix_vendu);
  const devisCol  = parseFloat(phasage?.prix_vendu);
  const montantDevis = Number.isFinite(devisMeta) && devisMeta > 0 ? devisMeta
                     : Number.isFinite(devisCol)  && devisCol  > 0 ? devisCol
                     : null;
  const ecartVenduVal = montantDevis != null ? prixHTChantier - montantDevis : null;
  const ecartDepasse = montantDevis != null && (
    Math.abs(ecartVenduVal) > montantDevis * (SEUIL_ECART_VENDU_PCT / 100) ||
    Math.abs(ecartVenduVal) > SEUIL_ECART_VENDU_EUR
  );

  // ── Lots (config + pseudo-lot "Sans lot" si des ouvrages sont orphelins) ──
  const lotsEtOrphelins = [
    ...(lots || []),
    ...(ouvragesDuLot(ouvrages, lots, "_orphans").length > 0
      ? [{ id: "_orphans", label: "Sans lot", couleur: "#888888" }] : []),
  ];
  const lotsOut = lotsEtOrphelins.map(l => {
    const lo = ouvragesDuLot(ouvrages, lots, l.id);
    const hv = lo.reduce((s, o) => s + heuresVenduesOuvrage(o), 0);
    const hr = lo.reduce((s, o) => s + heuresReellesOuvrage(o, ppt), 0);
    const av = lo.length > 0 ? avancementLot(ouvrages, lots, l.id) : 0;
    // Ratio de dérive : (réelles/vendues) ÷ (avancement/100). 1,00 = dans le
    // devis. Indéterminé (null) si pas d'heures vendues ou avancement nul.
    const ratioDerive = (hv > 0 && av > 0) ? (hr / hv) / (av / 100) : null;
    return {
      id: l.id, label: l.label, couleur: l.couleur || null,
      nbOuvrages: lo.length,
      heuresVendues: hv, heuresReelles: hr,
      avancement: av, ratioDerive,
      vide: lo.length === 0,
    };
  });

  // ── PROJECTIONS (étape 6) : du constat au pilotage ──
  // Heures restantes estimées : tâches non terminées, heures_estimees × part
  // restante. Une tâche à 100 % ne compte plus, une tâche sans heures estimées
  // ne peut rien projeter.
  const heuresRestantes = ouvrages.reduce((s, o) => s + (o.taches || []).reduce((ss, t) => {
    const av = Math.max(0, Math.min(100, parseFloat(t.avancement) || 0));
    const he = parseFloat(t.heures_estimees) || 0;
    return ss + (av >= 100 ? 0 : he * (100 - av) / 100);
  }, 0), 0);
  // Reste à faire en euros : la part du vendu restant à produire.
  const resteAFaireEuros = prixHTChantier * Math.max(0, 100 - avancementGlobal) / 100;

  // Reste à commander : même règle que la page « Commandes à passer » —
  // matériaux prévus (bibliothèque) sans ligne de commande NI flag commande_le.
  let resteACommanderVal = null;
  if (materiauxById) {
    resteACommanderVal = 0;
    ouvrages.forEach(o => {
      const liens = (o.materiaux_liens || []).filter(ml => ml && ml.materiau_id != null);
      if (liens.length === 0) return;
      const lignesO = (commandeLignes || []).filter(l =>
        l.ouvrage_id === o.id ||
        (!l.ouvrage_id && l.materiau_id && liens.some(ml => String(ml.materiau_id) === String(l.materiau_id))));
      const matCmd = new Set(lignesO.map(l => l.materiau_id != null ? String(l.materiau_id) : null).filter(Boolean));
      liens.forEach(ml => {
        if (matCmd.has(String(ml.materiau_id)) || ml.commande_le) return;
        const mat = materiauxById[String(ml.materiau_id)];
        if (!mat) return;
        const q = ml.quantite != null ? ml.quantite : 1;
        resteACommanderVal += (parseFloat(mat.prix_unitaire) || 0) * (parseFloat(q) || 0);
      });
    });
  }

  // Marge à terminaison : ce qu'il restera une fois le chantier fini, si les
  // heures restantes coûtent le taux MO prévisionnel et si le reste à
  // commander est effectivement commandé.
  const fgProjete = fgTauxHoraire * (heuresReellesTotalChantier + heuresRestantes);
  const margeATerminaisonVal = prixHTChantier
    - (coutMOTotalChantier + heuresRestantes * tauxMOPrevEff)
    - (coutMatChantier + (resteACommanderVal ?? 0))
    - fgProjete;

  // Situation à facturer : avancement au-delà du % facturé (États financiers).
  const situationVal = situationAFacturerVal(avancementGlobal, pctFacture, prixHTChantier);

  // ── Warnings agrégés (niveau chantier) ──
  const warnings = [];
  if (fgTauxHoraire <= 0) {
    warnings.push({
      code: "fg_non_regle", gravite: "alerte",
      message: "Définis un taux horaire de frais généraux dans « Suivi direction » — sans lui, la marge est surestimée.",
    });
  }
  const ouvragesSansPrix = ouvrages.filter(o => prixHTOuvrage(o) <= 0).length;
  if (ouvragesSansPrix > 0 && ouvrages.length > 0) {
    warnings.push({
      code: "ouvrages_sans_prix", gravite: "alerte",
      message: `${ouvragesSansPrix} ouvrage${ouvragesSansPrix > 1 ? "s" : ""} sans prix de vente — le vendu HT et l'avancement pondéré sont faussés.`,
    });
  }
  if (ecartDepasse) {
    warnings.push({
      code: "ecart_vendu", gravite: "alerte",
      message: `La somme des ouvrages (${eur(prixHTChantier)}) s'écarte de ${eur(Math.abs(ecartVenduVal))} du montant du devis renseigné (${eur(montantDevis)}) — avenant oublié ou ouvrage non chiffré ?`,
    });
  }
  if (seuilPrime > 0 && prixHTChantier > 0 && margePctChantier < seuilPrime) {
    warnings.push({
      code: "marge_sous_seuil_prime", gravite: "alerte",
      message: `Marge à ${margePctChantier.toFixed(1)} % du vendu, sous le seuil de prime (${seuilPrime} %).`,
    });
  }
  lotsOut.forEach(l => {
    if (l.ratioDerive != null && l.ratioDerive > SEUIL_RATIO_DERIVE) {
      warnings.push({
        code: "derive_lot", gravite: "alerte", lotId: l.id,
        message: `Lot ${l.label} : dérive d'heures ×${l.ratioDerive.toFixed(2)} (réalisé ${fmtH(l.heuresReelles)}h / ${fmtH(l.heuresVendues)}h vendues pour ${l.avancement} % d'avancement).`,
      });
    }
  });
  if (situationVal != null && situationVal > 0) {
    warnings.push({
      code: "situation_a_facturer", gravite: "alerte",
      message: `L'avancement (${avancementGlobal} %) dépasse le facturé (${(parseFloat(pctFacture) * 100).toFixed(0)} %) : une situation de ${eur(situationVal)} est à émettre.`,
    });
  }

  // ── Ventilations (mêmes lignes que les modales kpiDetail de PhasageV2) ──

  // « vendu » : par ouvrage valorisé, tri décroissant.
  const venduRows = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id), value: prixHTOuvrage(o) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const venduVentilation = venduRows.map(r => ({ main: r.main, sub: r.sub, right: eur(r.value) }));

  // « heures » : réelles / vendues par ouvrage + ligne extras.
  const heuresRowsBase = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id),
      r: heuresReellesOuvrage(o, ppt), v: heuresVenduesOuvrage(o) }))
    .filter(r => r.r > 0 || r.v > 0)
    .sort((a, b) => b.v - a.v || b.r - a.r);
  const heuresVentilation = heuresRowsBase.map(r => ({
    main: r.main, sub: r.sub,
    right: `${fmtH(r.r)}h / ${fmtH(r.v)}h`,
    rightColor: couleurDepassement(r.r, r.v),
  }));
  const hExtra = extras.heuresIndirect + extras.heuresLibre;
  if (hExtra > 0.05) {
    heuresVentilation.push({ main: "Trajets + indirect + libres", sub: "hors tâche du plan", right: `${fmtH(hExtra)}h / —` });
  }

  // « mo » : par ouvrier au registre + reste legacy + trajets + indirect + libres.
  // (Comme dans PhasageV2, la reprise d'antériorité n'a pas de ligne propre
  // alors que le total l'inclut — comportement historique conservé.)
  const moParOuvrier = {};
  ouvrages.forEach(o => (o.taches || []).forEach(t => tachePointagesParOuvrier(t, ppt).forEach(p => {
    if (!moParOuvrier[p.ouvrier]) moParOuvrier[p.ouvrier] = { ouvrier: p.ouvrier, heures: 0, cout: 0, taux: p.taux };
    moParOuvrier[p.ouvrier].heures += p.heures;
    moParOuvrier[p.ouvrier].cout += p.cout;
    moParOuvrier[p.ouvrier].taux = p.taux;
  })));
  const moRowsOuvriers = Object.values(moParOuvrier).sort((a, b) => b.cout - a.cout);
  const moVentile = moRowsOuvriers.reduce((s, r) => s + r.cout, 0);
  const moReste = coutMOChantier - moVentile;
  const moVentilation = moRowsOuvriers.map(r => ({
    main: r.ouvrier,
    sub: `${fmtH(r.heures)}h × ${eur(r.taux)}/h`,
    right: eur(r.cout),
  }));
  if (moReste > 0.5) {
    moVentilation.push({ main: "Heures sans pointage nominatif", sub: "coût estimé via ouvriers assignés", right: eur(moReste) });
  }
  if (trajet.cout > 0) {
    moVentilation.push({ main: "Trajets", sub: `${fmtH(trajet.heures)}h · pointages indirects`, right: eur(trajet.cout) });
  }
  if (indirectHT.cout > 0) {
    moVentilation.push({ main: "Heures indirectes", sub: "intempéries, SAV, nettoyage…", right: eur(indirectHT.cout) });
  }
  if (extras.coutLibre > 0.5) {
    moVentilation.push({ main: "Heures libres", sub: "hors tâche du plan", right: eur(extras.coutLibre) });
  }

  // « fg » : par ouvrage (heures réelles × taux) + ligne extras.
  const fgVentilation = fgTauxHoraire > 0
    ? ouvrages
        .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id), hr: heuresReellesOuvrage(o, ppt) }))
        .filter(r => r.hr > 0)
        .sort((a, b) => b.hr - a.hr)
        .map(r => ({ main: r.main, sub: `${fmtH(r.hr)}h × ${fgTauxHoraire}€/h`, right: eur(r.hr * fgTauxHoraire) }))
    : [];
  if (fgTauxHoraire > 0 && hExtra > 0.05) {
    fgVentilation.push({ main: "Trajets + indirect + libres", sub: `${fmtH(hExtra)}h × ${fgTauxHoraire}€/h`, right: eur(hExtra * fgTauxHoraire) });
  }

  // « marge » : les 4 postes.
  const margeVentilation = [
    { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
    { main: "Coût main d'œuvre", sub: "tâches + trajets + indirect", right: `− ${eur(coutMOTotalChantier)}`, rightColor: "#e15a5a" },
    { main: "Matériaux", sub: "commandes du chantier", right: `− ${eur(coutMatChantier)}`, rightColor: "#e15a5a" },
    { main: "Frais généraux", sub: fgTauxHoraire > 0 ? `${fgTauxHoraire}€/h × heures réelles` : "non réglés", right: `− ${eur(fgChantier)}`, rightColor: "#e15a5a" },
  ];

  // « marge_prev » : vendu, déboursé prévisionnel (MO + matériaux), FG prévisionnels.
  const margePrevVentilation = [
    { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
    { main: "Déboursé prévisionnel", sub: `MO prév. ${eur(moPrevChantier)} + matériaux prév. ${eur(commandesPrevChantier)}`, right: `− ${eur(deboursePrevChantier)}`, rightColor: "#e15a5a" },
    { main: "Frais généraux prévisionnels", sub: fgTauxHoraire > 0 ? `${fgTauxHoraire}€/h × ${fmtH(heuresVenduesChantier)}h vendues` : "non réglés", right: `− ${eur(fgPrevChantier)}`, rightColor: "#e15a5a" },
  ];

  // « mo_prev » : par ouvrage, heures vendues × taux global.
  const moPrevVentilation = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id), hv: heuresVenduesOuvrage(o) }))
    .filter(r => r.hv > 0)
    .sort((a, b) => b.hv - a.hv)
    .map(r => ({ main: r.main, sub: `${fmtH(r.hv)}h × ${tauxMOPrevEff}€/h`, right: eur(r.hv * tauxMOPrevEff) }));

  // « commandes_prev » : par ouvrage, coût matériaux estimé.
  const matPrevRows = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id), value: coutMatOuvrage(o) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const matPrevVentilation = matPrevRows.map(r => ({ main: r.main, sub: r.sub, right: eur(r.value) }));

  // « trajet » : par ouvrier.
  const trajetParOuvrier = {};
  (pointages || []).forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (!/trajet/i.test(p.motif_indirect || "")) return;
    const nom = p.ouvrier || "?";
    const hh = parseFloat(p.heures) || 0;
    const taux = parseFloat(p.taux_horaire) || 0;
    if (!trajetParOuvrier[nom]) trajetParOuvrier[nom] = { ouvrier: nom, heures: 0, cout: 0, taux };
    trajetParOuvrier[nom].heures += hh; trajetParOuvrier[nom].cout += hh * taux; trajetParOuvrier[nom].taux = taux;
  });
  const trajetVentilation = Object.values(trajetParOuvrier)
    .sort((a, b) => b.cout - a.cout)
    .map(r => ({ main: r.ouvrier, sub: `${fmtH(r.heures)}h × ${eur(r.taux)}/h`, right: eur(r.cout) }));

  // « indirect » : par motif (hors trajet).
  const indirectParMotif = {};
  (pointages || []).forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (/trajet/i.test(p.motif_indirect || "")) return;
    const motif = (p.motif_indirect || "").trim() || "Autre";
    const hh = parseFloat(p.heures) || 0;
    const taux = parseFloat(p.taux_horaire) || 0;
    if (!indirectParMotif[motif]) indirectParMotif[motif] = { motif, heures: 0, cout: 0 };
    indirectParMotif[motif].heures += hh; indirectParMotif[motif].cout += hh * taux;
  });
  const indirectVentilation = Object.values(indirectParMotif)
    .sort((a, b) => b.cout - a.cout)
    .map(r => ({ main: r.motif, sub: `${fmtH(r.heures)}h`, right: eur(r.cout) }));

  // « matériaux réels » : par ligne de commande (tri décroissant).
  const matReelVentilation = (commandeLignes || [])
    .map(l => ({
      main: l.libelle || l.reference || "(sans libellé)",
      sub: l.commande?.fournisseur_nom || null,
      value: parseFloat(l.prix_total) || ((parseFloat(l.prix_unitaire) || 0) * (parseFloat(l.quantite) || 0)) || 0,
    }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map(r => ({ main: r.main, sub: r.sub, right: eur(r.value) }));

  // ── Construction des Donnee ──
  const D = (d) => ({
    sousLabel: null, valeurTexte: null, ventilation: [], titre: d.label,
    sousTitre: null, vide: null, totalLabel: null, totalTexte: null,
    source: null, fraicheur, warnings: [], renseigne: true, ...d,
  });

  const sourceOuvrages  = "Ouvrages du phasage (Phasage V2)";
  const sourceRegistre  = "Registre de pointage (validations de fin de journée)";
  const sourceCommandes = "Lignes de commande du chantier";

  const venduHT = D({
    cle: "venduHT", label: "Vendu HT", format: "euro",
    valeur: prixHTChantier, valeurTexte: eur(prixHTChantier),
    sousLabel: `${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""}`,
    formule: FORMULE.venduHT,
    calculDetaille: `${venduRows.length} ouvrage${venduRows.length > 1 ? "s" : ""} valorisé${venduRows.length > 1 ? "s" : ""} → ${eur(prixHTChantier)}`,
    ventilation: venduVentilation,
    titre: "Prix de vente HT",
    sousTitre: `${venduRows.length} ouvrage${venduRows.length > 1 ? "s" : ""} valorisé${venduRows.length > 1 ? "s" : ""}`,
    vide: "Aucun prix de vente saisi sur les ouvrages.",
    totalLabel: "Total vendu HT",
    source: sourceOuvrages,
    warnings: warnings.filter(w => w.code === "ouvrages_sans_prix" || w.code === "ecart_vendu"),
    renseigne: ouvrages.length > 0,
  });

  const ecartVendu = D({
    cle: "ecartVendu", label: "Écart de vendu", format: "euro",
    valeur: ecartVenduVal, valeurTexte: ecartVenduVal != null ? eur(ecartVenduVal) : "—",
    formule: FORMULE.ecartVendu,
    calculDetaille: montantDevis != null
      ? `${eur(prixHTChantier)} − ${eur(montantDevis)} = ${eur(ecartVenduVal)}`
      : "Aucun montant de devis renseigné (meta.prix_vendu ou colonne prix_vendu).",
    titre: "Écart de vendu",
    sousTitre: "Contrôle de cohérence, pas une marge",
    source: "Ouvrages du phasage vs montant de devis saisi",
    warnings: warnings.filter(w => w.code === "ecart_vendu"),
    renseigne: montantDevis != null,
  });

  const heuresVendues = D({
    cle: "heuresVendues", label: "Heures vendues", format: "heure",
    valeur: heuresVenduesChantier, valeurTexte: `${fmtH(heuresVenduesChantier)}h`,
    formule: FORMULE.heuresVendues,
    calculDetaille: `${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""} → ${fmtH(heuresVenduesChantier)}h vendues`,
    source: sourceOuvrages,
    renseigne: heuresVenduesChantier > 0 || ouvrages.length > 0,
  });

  const heuresReelles = D({
    cle: "heuresReelles", label: "Heures totales", format: "heure",
    valeur: heuresReellesTotalChantier,
    valeurTexte: `${heuresReellesTotalChantier.toFixed(0)}h / ${heuresVenduesChantier.toFixed(0)}h`,
    sousLabel: heuresVenduesChantier > 0
      ? `${Math.round((heuresReellesTotalChantier / heuresVenduesChantier) * 100)}% consommées`
      : "réelles / vendues",
    formule: FORMULE.heuresReelles,
    calculDetaille: `${fmtH(heuresReellesChantier)}h (tâches) + ${fmtH(extras.heuresLibre)}h (libres) + ${fmtH(extras.heuresIndirect)}h (trajets + indirect)${repriseHeures > 0 ? ` + ${fmtH(repriseHeures)}h (reprise)` : ""} = ${fmtH(heuresReellesTotalChantier)}h`,
    ventilation: heuresVentilation,
    titre: "Heures réelles / vendues",
    sousTitre: `${heuresReellesTotalChantier.toFixed(1)}h pointées sur ${heuresVenduesChantier.toFixed(0)}h vendues`,
    vide: "Aucune heure vendue ni pointée.",
    totalLabel: "Total réelles / vendues",
    totalTexte: `${fmtH(heuresReellesTotalChantier)}h / ${fmtH(heuresVenduesChantier)}h`,
    source: sourceRegistre,
    renseigne: true,
  });

  const moPrev = D({
    cle: "moPrev", label: "MO prév.", format: "euro",
    valeur: moPrevChantier, valeurTexte: eur(moPrevChantier),
    sousLabel: `${tauxMOPrevEff}€/h × ${heuresVenduesChantier.toFixed(0)}h vendues`,
    formule: FORMULE.moPrev,
    calculDetaille: `${fmtH(heuresVenduesChantier)}h × ${tauxMOPrevEff} €/h = ${eur(moPrevChantier)}`,
    ventilation: moPrevVentilation,
    titre: "Coût MO prévisionnel",
    sousTitre: `${tauxMOPrevEff}€/h × ${heuresVenduesChantier.toFixed(0)}h vendues`,
    vide: "Aucune heure vendue sur les ouvrages.",
    totalLabel: "Total MO prévisionnel",
    source: "Ouvrages du phasage × taux Admin" + (tauxMOPrev > 0 ? "" : ` (défaut ${TAUX_MO_PREV_DEFAUT} €/h)`),
    renseigne: heuresVenduesChantier > 0,
  });

  const matPrev = D({
    cle: "matPrev", label: "Commandes prév.", format: "euro",
    valeur: commandesPrevChantier, valeurTexte: eur(commandesPrevChantier),
    sousLabel: "Estimé · matériaux liés",
    formule: FORMULE.matPrev,
    calculDetaille: `${matPrevRows.length} ouvrage${matPrevRows.length > 1 ? "s" : ""} avec matériaux liés → ${eur(commandesPrevChantier)}`,
    ventilation: matPrevVentilation,
    titre: "Commandes prévisionnelles",
    sousTitre: `${matPrevRows.length} ouvrage${matPrevRows.length > 1 ? "s" : ""} avec matériaux liés`,
    vide: "Aucun matériau lié aux ouvrages (associe une fiche biblio pour estimer les commandes).",
    totalLabel: "Total commandes prév.",
    source: "Bibliothèque de matériaux (cout_materiaux des ouvrages)",
    renseigne: matPrevRows.length > 0,
  });

  const margePrev = D({
    cle: "margePrev", label: "Marge prév.", format: "euro",
    valeur: margePrevChantier,
    valeurTexte: `${margePrevChantier >= 0 ? "+" : ""}${eur(margePrevChantier)}`,
    sousLabel: prixHTChantier > 0 ? `${margePrevPctChantier.toFixed(1)}% du vendu` : "Vendu − déboursé prév. − FG prév.",
    formule: FORMULE.margePrev,
    calculDetaille: `${eur(prixHTChantier)} − ${eur(deboursePrevChantier)} (déboursé prév. : MO ${eur(moPrevChantier)} + matériaux ${eur(commandesPrevChantier)}) − ${eur(fgPrevChantier)} (FG prév.) = ${eur(margePrevChantier)}`,
    ventilation: margePrevVentilation,
    titre: "Marge prévisionnelle",
    sousTitre: prixHTChantier > 0
      ? `${margePrevPctChantier.toFixed(1)}% du vendu · au devis, avant le réel`
      : "Vendu − déboursé prévisionnel − FG prévisionnels",
    totalLabel: "Marge prévisionnelle",
    totalTexte: `${margePrevChantier >= 0 ? "+" : ""}${eur(margePrevChantier)}`,
    source: "Ouvrages du phasage, taux Admin, bibliothèque de matériaux, Suivi direction",
    warnings: warnings.filter(w => ["fg_non_regle", "ouvrages_sans_prix"].includes(w.code)),
    renseigne: prixHTChantier > 0,
  });

  const moReel = D({
    cle: "moReel", label: "Coût MO", format: "euro",
    valeur: coutMOTotalChantier, valeurTexte: eur(coutMOTotalChantier),
    sousLabel: "Tâches + trajets + indirect",
    formule: FORMULE.moReel,
    calculDetaille: `${eur(coutMOChantier)} (tâches) + ${eur(extras.coutLibre)} (libres) + ${eur(extras.coutIndirect)} (trajets + indirect)${repriseCout > 0 ? ` + ${eur(repriseCout)} (reprise)` : ""} = ${eur(coutMOTotalChantier)}`,
    ventilation: moVentilation,
    titre: "Coût main d'œuvre réel",
    sousTitre: moRowsOuvriers.length > 0
      ? `${moRowsOuvriers.length} ouvrier${moRowsOuvriers.length > 1 ? "s" : ""} au registre`
      : "depuis les heures réelles",
    vide: "Aucune heure réelle pointée pour l'instant.",
    totalLabel: "Total coût MO",
    source: sourceRegistre + (repriseCout > 0 ? " + reprise d'antériorité" : ""),
    renseigne: true,
  });

  const matReel = D({
    cle: "matReel", label: "Matériaux", format: "euro",
    valeur: coutMatChantier, valeurTexte: eur(coutMatChantier),
    sousLabel: `Voir les commandes (${(commandeLignes || []).length})`,
    formule: FORMULE.matReel,
    calculDetaille: `${(commandeLignes || []).length} ligne${(commandeLignes || []).length > 1 ? "s" : ""} de commande → ${eur(coutMatChantier)}`,
    ventilation: matReelVentilation,
    titre: "Matériaux (commandes)",
    sousTitre: `${(commandeLignes || []).length} ligne${(commandeLignes || []).length > 1 ? "s" : ""} de commande`,
    vide: "Aucune ligne de commande liée à ce chantier.",
    totalLabel: "Total matériaux",
    source: sourceCommandes,
    renseigne: true,
  });

  const fg = D({
    cle: "fg", label: "Frais généraux", format: "euro",
    valeur: fgChantier, valeurTexte: eur(fgChantier),
    sousLabel: fgTauxHoraire > 0
      ? `${fgTauxHoraire}€/h × ${heuresReellesTotalChantier.toFixed(0)}h réelles`
      : "0 — à régler",
    formule: FORMULE.fg,
    calculDetaille: fgTauxHoraire > 0
      ? `${fgTauxHoraire} €/h × ${fmtH(heuresReellesTotalChantier)}h réelles = ${eur(fgChantier)}`
      : "Taux horaire de frais généraux non réglé → 0 € (marge surestimée).",
    ventilation: fgVentilation,
    titre: "Frais généraux",
    sousTitre: fgTauxHoraire > 0
      ? `${fgTauxHoraire}€/h × ${heuresReellesTotalChantier.toFixed(0)}h réelles`
      : "Taux horaire non réglé (Suivi direction)",
    vide: fgTauxHoraire > 0
      ? "Aucune heure réelle pointée."
      : "Définis un taux horaire de frais généraux dans « Suivi direction » pour ventiler ce coût.",
    totalLabel: "Total frais généraux",
    source: "Suivi direction (fg_taux_horaire) × registre de pointage",
    warnings: warnings.filter(w => w.code === "fg_non_regle"),
    renseigne: fgTauxHoraire > 0,
  });

  const marge = D({
    cle: "marge", label: "Marge nette", format: "euro",
    valeur: margeChantier,
    valeurTexte: `${margeChantier >= 0 ? "+" : ""}${eur(margeChantier)}`,
    sousLabel: prixHTChantier > 0 ? `${margePctChantier.toFixed(1)}% du vendu` : null,
    formule: FORMULE.marge,
    calculDetaille: `${eur(prixHTChantier)} − ${eur(coutMOTotalChantier)} − ${eur(coutMatChantier)} − ${eur(fgChantier)} = ${eur(margeChantier)}`,
    ventilation: margeVentilation,
    titre: "Marge nette",
    sousTitre: prixHTChantier > 0 ? `${margePctChantier.toFixed(1)}% du vendu` : "Vendu − MO − Matériaux − FG",
    totalLabel: "Marge nette",
    totalTexte: `${margeChantier >= 0 ? "+" : ""}${eur(margeChantier)}`,
    source: "Ouvrages du phasage, registre de pointage, lignes de commande, Suivi direction",
    warnings: warnings.filter(w => ["fg_non_regle", "ouvrages_sans_prix", "marge_sous_seuil_prime"].includes(w.code)),
    renseigne: prixHTChantier > 0,
  });

  const margePct = D({
    cle: "margePct", label: "Marge %", format: "pourcent",
    valeur: margePctChantier,
    valeurTexte: `${margePctChantier.toFixed(1)}%`,
    formule: FORMULE.margePct,
    calculDetaille: prixHTChantier > 0
      ? `${eur(margeChantier)} ÷ ${eur(prixHTChantier)} × 100 = ${margePctChantier.toFixed(1)} %`
      : "Vendu HT à 0 → pourcentage non calculable.",
    source: "Dérivé de la marge nette",
    renseigne: prixHTChantier > 0,
  });

  const avancement = D({
    cle: "avancement", label: "Avancement", format: "pourcent",
    valeur: avancementGlobal, valeurTexte: `${avancementGlobal}%`,
    formule: FORMULE.avancement,
    calculDetaille: avancementChantierDetail(ouvrages),
    source: "Avancements des tâches saisis / déclarés en fin de journée",
    renseigne: ouvrages.length > 0,
  });

  const trajets = D({
    cle: "trajets", label: "Trajets", format: "euro",
    valeur: trajet.cout, valeurHeures: trajet.heures,
    valeurTexte: trajet.heures > 0 ? `${trajet.heures.toFixed(1)}h · ${eur(trajet.cout)}` : "—",
    sousLabel: "Inclus dans le coût MO",
    formule: FORMULE.trajets,
    calculDetaille: `${fmtH(trajet.heures)}h de trajet → ${eur(trajet.cout)}`,
    ventilation: trajetVentilation,
    titre: "Trajets",
    sousTitre: `${trajet.heures.toFixed(1)}h · ${trajetVentilation.length} ouvrier${trajetVentilation.length > 1 ? "s" : ""} · inclus dans le coût MO`,
    vide: "Aucun trajet pointé pour l'instant.",
    totalLabel: "Total trajets",
    source: sourceRegistre,
    renseigne: true,
  });

  const indirect = D({
    cle: "indirect", label: "Heures indirectes", format: "euro",
    valeur: indirectHT.cout, valeurHeures: indirectHT.heures,
    valeurTexte: indirectHT.heures > 0 ? `${indirectHT.heures.toFixed(1)}h · ${eur(indirectHT.cout)}` : "—",
    sousLabel: "Intempéries, SAV, nettoyage…",
    formule: FORMULE.indirect,
    calculDetaille: `${fmtH(indirectHT.heures)}h indirectes (hors trajet) → ${eur(indirectHT.cout)}`,
    ventilation: indirectVentilation,
    titre: "Heures indirectes",
    sousTitre: `${indirectHT.heures.toFixed(1)}h · hors trajet · incluses dans le coût MO`,
    vide: "Aucune heure indirecte (hors trajet) pointée.",
    totalLabel: "Total indirect (hors trajet)",
    source: sourceRegistre,
    renseigne: true,
  });

  const reprise = D({
    cle: "reprise", label: "Reprise d'antériorité", format: "euro",
    valeur: repriseCout, valeurHeures: repriseHeures,
    valeurTexte: repriseHeures > 0 ? `${fmtH(repriseHeures)}h · ${eur(repriseCout)}` : "—",
    formule: FORMULE.reprise,
    calculDetaille: repriseHeures > 0
      ? `${fmtH(repriseHeures)}h × ${fmtH(repriseTaux)} €/h = ${eur(repriseCout)}`
      : "Aucune reprise saisie.",
    source: "Suivi direction (reprise_heures × reprise_taux)",
    renseigne: repriseHeures > 0,
  });

  // ── Donnee des projections (visuellement distinctes des chiffres à date) ──
  const resteAFaire = D({
    cle: "resteAFaire", label: "Reste à faire", format: "euro", projection: true,
    valeur: resteAFaireEuros, valeurHeures: heuresRestantes,
    valeurTexte: `${fmtH(heuresRestantes)}h · ${eur(resteAFaireEuros)}`,
    sousLabel: "Projection · tâches non terminées",
    formule: FORMULE.resteAFaire,
    calculDetaille: `${fmtH(heuresRestantes)}h restantes estimées · ${eur(prixHTChantier)} × ${Math.max(0, 100 - avancementGlobal)} % restant = ${eur(resteAFaireEuros)}`,
    source: "Tâches des ouvrages (heures estimées + avancement)",
    renseigne: ouvrages.length > 0,
  });

  const margeATerminaison = D({
    cle: "margeATerminaison", label: "Marge à terminaison", format: "euro", projection: true,
    valeur: margeATerminaisonVal,
    valeurTexte: `${margeATerminaisonVal >= 0 ? "+" : ""}${eur(margeATerminaisonVal)}`,
    sousLabel: "Projection · si le restant coûte le prévu",
    formule: FORMULE.margeATerminaison,
    calculDetaille: `${eur(prixHTChantier)} − (${eur(coutMOTotalChantier)} + ${fmtH(heuresRestantes)}h × ${tauxMOPrevEff} €/h) − (${eur(coutMatChantier)} + ${eur(resteACommanderVal ?? 0)}) − ${eur(fgProjete)} (FG projetés) = ${eur(margeATerminaisonVal)}`,
    ventilation: [
      { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
      { main: "Coût MO réel", sub: "déjà pointé", right: `− ${eur(coutMOTotalChantier)}`, rightColor: "#e15a5a" },
      { main: "MO restante estimée", sub: `${fmtH(heuresRestantes)}h × ${tauxMOPrevEff} €/h`, right: `− ${eur(heuresRestantes * tauxMOPrevEff)}`, rightColor: "#e15a5a" },
      { main: "Matériaux réels", sub: "commandes passées", right: `− ${eur(coutMatChantier)}`, rightColor: "#e15a5a" },
      { main: "Reste à commander", sub: materiauxById ? "matériaux prévus non commandés" : "bibliothèque non chargée → 0", right: `− ${eur(resteACommanderVal ?? 0)}`, rightColor: "#e15a5a" },
      { main: "Frais généraux projetés", sub: fgTauxHoraire > 0 ? `${fgTauxHoraire}€/h × ${fmtH(heuresReellesTotalChantier + heuresRestantes)}h` : "non réglés", right: `− ${eur(fgProjete)}`, rightColor: "#e15a5a" },
    ],
    titre: "Marge à terminaison",
    sousTitre: "Projection : marge restante si les heures restantes coûtent le taux prévisionnel",
    totalLabel: "Marge à terminaison",
    totalTexte: `${margeATerminaisonVal >= 0 ? "+" : ""}${eur(margeATerminaisonVal)}`,
    source: "Registre de pointage, tâches restantes, commandes, bibliothèque, Suivi direction",
    warnings: warnings.filter(w => w.code === "fg_non_regle"),
    renseigne: prixHTChantier > 0,
  });

  const situationAFacturer = D({
    cle: "situationAFacturer", label: "Situation à facturer", format: "euro", projection: true,
    valeur: situationVal,
    valeurTexte: situationVal != null ? `${situationVal >= 0 ? "+" : ""}${eur(situationVal)}` : "—",
    sousLabel: pctFacture != null ? `facturé ${(parseFloat(pctFacture) * 100).toFixed(0)} % · avancement ${avancementGlobal} %` : "% facturé non disponible",
    formule: FORMULE.situationAFacturer,
    calculDetaille: situationVal != null
      ? `(${avancementGlobal} % − ${(parseFloat(pctFacture) * 100).toFixed(0)} %) × ${eur(prixHTChantier)} = ${eur(situationVal)}`
      : "Le % facturé de ce chantier n'est pas renseigné dans les États financiers.",
    titre: "Situation à facturer",
    sousTitre: "Projection : avancement au-delà du facturé",
    source: "Avancement + % facturé (États financiers, CA à provisionner)",
    warnings: warnings.filter(w => w.code === "situation_a_facturer"),
    renseigne: situationVal != null,
  });

  const resteACommander = D({
    cle: "resteACommander", label: "Reste à commander", format: "euro", projection: true,
    valeur: resteACommanderVal,
    valeurTexte: resteACommanderVal != null ? eur(resteACommanderVal) : "—",
    sousLabel: "Projection · matériaux prévus non commandés",
    formule: FORMULE.resteACommander,
    calculDetaille: resteACommanderVal != null
      ? `Matériaux liés non commandés → ${eur(resteACommanderVal)}`
      : "Bibliothèque de matériaux non chargée : reste à commander indisponible.",
    titre: "Reste à commander",
    sousTitre: "Même règle que la page Commandes à passer",
    source: "Matériaux liés des ouvrages vs lignes de commande",
    renseigne: resteACommanderVal != null,
  });

  return {
    venduHT, ecartVendu, moPrev, matPrev, margePrev, moReel, matReel, fg, marge, margePct,
    heuresVendues, heuresReelles, avancement, trajets, indirect, reprise,
    // Projections (étape 6) — à afficher distinctement des chiffres à date.
    resteAFaire, margeATerminaison, situationAFacturer, resteACommander,
    lots: lotsOut,
    meta: { margeCible, seuilPrime, prime },
    warnings,
    fraicheur,
    // Scalaires bruts (pratiques pour les tests et les snapshots) — mêmes
    // valeurs que les Donnee ci-dessus, sans habillage.
    brut: {
      prixHTChantier, heuresVenduesChantier, heuresReellesChantier,
      heuresReellesTotalChantier, coutMOChantier, coutMOTotalChantier,
      coutMatChantier, commandesPrevChantier, moPrevChantier, tauxMOPrevEff,
      fgTauxHoraire, fgChantier, margeChantier, margePctChantier,
      fgPrevChantier, deboursePrevChantier, margePrevChantier, margePrevPctChantier,
      avancementChantier: avancementGlobal,
      extras, repriseHeures, repriseTaux, repriseCout,
      trajetHeures: trajet.heures, trajetCout: trajet.cout,
      indirectHeures: indirectHT.heures, indirectCout: indirectHT.cout,
      montantDevis, ecartVendu: ecartVenduVal,
      heuresRestantes, resteAFaireEuros, fgProjete,
      margeATerminaison: margeATerminaisonVal,
      situationAFacturer: situationVal,
      resteACommander: resteACommanderVal,
    },
  };
}
