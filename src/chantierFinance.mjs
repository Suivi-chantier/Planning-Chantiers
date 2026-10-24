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

// ── Frais généraux : UN barème daté pour toute l'entreprise (24/10/2026) ────
// Réglage Admin, stocké dans planning_config sous la clé CLE_CONFIG_TAUX_FG :
// [{ depuis: "AAAA-MM-JJ", taux: €/h }, …]. Il remplace le champ par phasage
// plan_travaux.meta.fg_taux_horaire, qui n'est plus lu nulle part.
//   - une heure pointée coûte le taux en vigueur à SA date ;
//   - une heure sans date (reprise d'antériorité, heures anciennes saisies
//     sur la tâche) coûte le taux le plus ancien ;
//   - une heure à venir (projection) coûte le taux en vigueur aujourd'hui.
// Barème absent ou vide → TAUX_FG_DEFAUT : il y a toujours un taux.
export const CLE_CONFIG_TAUX_FG = "fg_taux_horaires";
export const TAUX_FG_DEFAUT = Object.freeze([Object.freeze({ depuis: "2026-01-01", taux: 17.44 })]);
const RE_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Barème propre, trié du plus ancien au plus récent ; une date en double
// garde la dernière saisie. Entrées sans date valide ou taux négatif ignorées.
export function normaliserBaremeFG(liste) {
  const parDate = new Map();
  (Array.isArray(liste) ? liste : []).forEach(e => {
    const depuis = String(e?.depuis ?? "").slice(0, 10);
    const taux = parseFloat(String(e?.taux ?? "").replace(",", "."));
    if (!RE_DATE_ISO.test(depuis) || !Number.isFinite(taux) || taux < 0) return;
    parDate.set(depuis, { depuis, taux });
  });
  const bareme = [...parDate.values()].sort((a, b) => a.depuis.localeCompare(b.depuis));
  return bareme.length > 0 ? bareme : TAUX_FG_DEFAUT.map(e => ({ ...e }));
}

// Ajout d'un taux daté (réglage Admin) : les taux existants sont CONSERVÉS ;
// une date déjà présente voit son taux remplacé. Rend { bareme } ou { erreur }.
export function ajouterTauxFG(liste, { depuis, taux } = {}) {
  const d = String(depuis ?? "").slice(0, 10);
  const t = parseFloat(String(taux ?? "").replace(",", "."));
  if (!RE_DATE_ISO.test(d)) return { erreur: "Indique la date à partir de laquelle ce taux s'applique." };
  if (!Number.isFinite(t) || t < 0) return { erreur: "Indique un taux en €/h (0 ou plus)." };
  return { bareme: normaliserBaremeFG([...normaliserBaremeFG(liste), { depuis: d, taux: Math.round(t * 100) / 100 }]) };
}

// Taux en vigueur à une date : dernière entrée dont « depuis » ≤ date. Date
// absente ou antérieure au barème → taux le plus ancien.
export function tauxFGALaDate(bareme, date) {
  const b = Array.isArray(bareme) && bareme.length > 0 ? bareme : normaliserBaremeFG(bareme);
  const d = date ? String(date).slice(0, 10) : null;
  let taux = b[0].taux;
  if (d) b.forEach(e => { if (e.depuis <= d) taux = e.taux; });
  return taux;
}

// Frais généraux d'un jeu de pointages : Σ heures × taux à la date du pointage.
// `tauxVus` (Set, optionnel) collecte les taux utilisés pour les libellés.
export function fgDePointages(points, bareme, tauxVus = null) {
  return (points || []).reduce((s, p) => {
    const taux = tauxFGALaDate(bareme, p?.date);
    if (tauxVus) tauxVus.add(taux);
    return s + (parseFloat(p?.heures) || 0) * taux;
  }, 0);
}

const fmtTauxFG = (taux) => `${(parseFloat(taux) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €/h`;
// « 17,44 €/h » si un seul taux a servi, sinon « taux en vigueur à chaque date ».
const texteTauxFG = (tauxVus) => {
  const l = [...(tauxVus || [])];
  return l.length === 1 ? fmtTauxFG(l[0]) : "taux en vigueur à la date de chaque heure";
};

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

// ── Tâches HORS DEVIS (ajout du 06/10/2026) ─────────────────────────────────
// Une tâche marquée hors_devis: true (travail non vendu : demande du client,
// imprévu… — cochée par le conducteur) :
//   - garde ses heures dans TOUS les coûts (main-d'œuvre réelle, frais
//     généraux, marge) : c'est un coût réel ;
//   - n'est PAS comparée aux heures vendues : ni ratio de dérive, ni
//     dépassement, ni couleur — ses heures s'affichent à part (« + X h hors
//     devis ») ;
//   - n'entre pas dans l'avancement de son ouvrage ni de sa phase (travail non
//     vendu) — sauf si TOUTES les tâches de l'ouvrage / de la phase le sont.
// Seul le champ EXPLICITE compte. Une tâche sans ce champ — c'est le cas de
// toutes les tâches existantes, y compris celles de « Divers / hors devis » —
// garde exactement le calcul d'avant.
// ⚠ Les helpers historiques (heuresReellesOuvrage…) restent INCHANGÉS : ils
// alimentent aussi les coûts (frais généraux). Les comparaisons au vendu
// passent par les helpers « comparables » ci-dessous.
export const tacheHorsDevis = (t) => t?.hors_devis === true;
const tachesComparables = (taches) => (taches || []).filter(t => !tacheHorsDevis(t));
// Tâches qui portent l'avancement : les comparables, ou toutes si l'ensemble
// est hors devis (sinon un ouvrage 100 % hors devis n'aurait plus d'avancement).
const tachesAvancement = (taches) => {
  const list = taches || [];
  const comp = tachesComparables(list);
  return comp.length > 0 ? comp : list;
};
export const heuresReellesComparablesOuvrage = (o, ppt) =>
  tachesComparables(o?.taches).reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0);
export const heuresHorsDevisOuvrage = (o, ppt) =>
  (o?.taches || []).filter(tacheHorsDevis).reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0);
export const heuresHorsDevisOuvrages = (ouvrages, ppt) =>
  (ouvrages || []).reduce((s, o) => s + heuresHorsDevisOuvrage(o, ppt), 0);

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
  const taches = tachesAvancement(ouvrage?.taches);
  if (taches.length === 0) return 0;
  const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHE > 0) {
    return Math.round(
      taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0), 0) / totalHE
    );
  }
  return Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length);
}

// Avancement EXACT d'un ouvrage (0-100, NON arrondi) : même pondération que
// avancementOuvrage (heures estimées, sinon moyenne simple ; tâches hors devis
// exclues sauf si toutes le sont), sans l'arrondi d'affichage. Sert à la
// production en euros : un ouvrage à 0,4 % produit 0,4 % de son prix.
// `etat` (optionnel) : Map tache_id → avancement à une date (etatTachesALaDate) ;
// une tâche absente de la carte garde son avancement actuel. Une valeur
// inconnue (null) rend l'avancement de l'ouvrage inconnu (null), jamais 0.
export function avancementOuvrageExact(ouvrage, etat = null) {
  const taches = tachesAvancement(ouvrage?.taches);
  if (taches.length === 0) return 0;
  const val = (t) => {
    if (etat && etat.has(String(t.id))) return etat.get(String(t.id));
    return Math.max(0, Math.min(100, parseFloat(t.avancement) || 0));
  };
  const vals = taches.map(val);
  if (vals.some(v => v == null)) return null;
  const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
  if (totalHE > 0) {
    return taches.reduce((s, t, i) => s + vals[i] * (parseFloat(t.heures_estimees) || 0), 0) / totalHE;
  }
  return vals.reduce((s, v) => s + v, 0) / taches.length;
}

// ── Journal d'avancement daté (étape 1C) ────────────────────────────────────
// Une ligne = un changement d'avancement d'une tâche :
//   { tache_id, avancement_avant, avancement_apres, date_realisation, created_at, … }
// État d'une tâche à la date D (fin de journée) :
//   - la valeur « après » de la ligne la plus récemment ÉCRITE parmi celles
//     datées ≤ D (un compte rendu de mardi validé jeudi compte mardi, et une
//     écriture plus récente l'emporte sur une plus ancienne) ;
//   - sinon (rien avant D) : la valeur « avant » de la première ligne écrite
//     après D — inconnue (null) si cette ligne ne la connaît pas (ligne
//     initiale, début de l'historique) ;
//   - aucune ligne du tout : la tâche n'a jamais changé, absente de la carte
//     (avancementOuvrageExact prend alors son avancement actuel).
// `date` null = aujourd'hui (dernière valeur écrite). Les tâches retirées du
// phasage sont ignorées : c'est la composition ACTUELLE qui compte.
const dateJ = (d) => (d ? String(d).slice(0, 10) : null);
const numJ = (v) => (v == null || v === "" ? null : Math.max(0, Math.min(100, parseFloat(v))));
export function etatTachesALaDate(journal, date = null) {
  const parTache = new Map();
  (journal || []).forEach(l => {
    if (l?.tache_id == null) return;
    const k = String(l.tache_id);
    if (!parTache.has(k)) parTache.set(k, []);
    parTache.get(k).push(l);
  });
  const D = dateJ(date);
  const ecrit = (l) => String(l.created_at || "");
  const etat = new Map();
  parTache.forEach((lignes, k) => {
    const avant = lignes.filter(l => D == null || dateJ(l.date_realisation) <= D);
    if (avant.length > 0) {
      const derniere = avant.reduce((a, b) => (ecrit(b) >= ecrit(a) ? b : a));
      etat.set(k, numJ(derniere.avancement_apres));
      return;
    }
    const premiere = lignes.reduce((a, b) => (ecrit(b) < ecrit(a) ? b : a));
    etat.set(k, numJ(premiere.avancement_avant));
  });
  return etat;
}

// Première date connue du journal d'un chantier (pour dire d'où part la
// connaissance de l'avancement), ou null.
export function debutJournal(journal) {
  return (journal || []).reduce((m, l) => {
    const d = dateJ(l?.date_realisation);
    return d && (!m || d < m) ? d : m;
  }, null);
}

// PRODUCTION d'une période (du, au] = Σ ouvrage par ouvrage de
// prix_ht × (avancement exact à « au » − avancement exact à « du ») ÷ 100,
// sans arrondi. du null = début du chantier (0 %) ; au null = aujourd'hui
// (avancement actuel des tâches). Ajouter un ouvrage ne change pas la
// production passée des autres : chacun est compté avec son propre prix.
// Rend { valeur, parOuvrage, inconnus, raison } — valeur null si l'avancement
// d'un ouvrage valorisé est inconnu à l'une des deux dates (raison dite).
export function productionPeriode({ ouvrages = [], journal = [], du = null, au = null } = {}) {
  const etatFin = au == null ? null : etatTachesALaDate(journal, au);
  const etatDebut = du == null ? null : etatTachesALaDate(journal, du);
  const parOuvrage = [];
  const inconnus = [];
  let valeur = 0;
  (ouvrages || []).forEach(o => {
    const prix = prixHTOuvrage(o);
    const avFin = avancementOuvrageExact(o, etatFin);
    const avDebut = du == null ? 0 : avancementOuvrageExact(o, etatDebut);
    if (avFin == null || avDebut == null) {
      if (prix > 0) inconnus.push({ id: o.id, libelle: o.libelle || "(sans libellé)", date: avDebut == null ? du : au });
      return;
    }
    const production = prix * (avFin - avDebut) / 100;
    valeur += production;
    if (prix > 0 && Math.abs(avFin - avDebut) > 1e-9) {
      parOuvrage.push({ id: o.id, libelle: o.libelle || "(sans libellé)", prix, avDebut, avFin, production });
    }
  });
  const debut = debutJournal(journal);
  const raison = inconnus.length === 0 ? null
    : `Avancement inconnu au ${String(inconnus[0].date).split("-").reverse().join("/")} pour ${inconnus.length} ouvrage${inconnus.length > 1 ? "s" : ""}`
      + (debut ? ` : le journal d'avancement de ce chantier commence le ${debut.split("-").reverse().join("/")}.` : ".");
  return { valeur: inconnus.length === 0 ? valeur : null, parOuvrage, inconnus, raison };
}

// ── Groupes chrono (vue chrono / cycle de vie chantier) ─────────────────────
// Synthèse d'un groupe d'exécution : tâches rattachées via chrono_groupe_id.
// Avancement pondéré par heures_vendues — MÊME convention que groupStats de la
// vue chrono (PhasageV2) ; elle diffère volontairement d'avancementOuvrage
// (pondéré heures_estimees) : ne pas « harmoniser ».
// `termine` = toutes les tâches du groupe à 100 % (définition du cycle de vie).
export function statsGroupeChrono(groupeId, ouvrages) {
  const toutes = (ouvrages || [])
    .flatMap(o => o?.taches || [])
    .filter(t => t?.chrono_groupe_id === groupeId);
  return statsTachesChrono(toutes);
}

// Même synthèse sur une liste de tâches quelconque (ex. les tâches sans phase).
export function statsTachesChrono(toutes) {
  // Avancement et « terminé » : sans les tâches hors devis (travail non
  // vendu) ; count reste le nombre total de tâches du groupe.
  const taches = tachesAvancement(toutes);
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
  return { count: toutes.length, avancement, termine };
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
  const taches = tachesAvancement(ouvrage?.taches);
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

// ── Nature des coûts d'une ligne de commande (24/10/2026) ───────────────────
// commande_lignes.nature : toutes les natures restent dans les coûts réels du
// chantier ; seules les lignes « materiaux » consomment l'enveloppe matériaux.
// Une ligne sans nature (antérieure à la colonne, ou ajustement de facture
// ajouté par les chargeurs) compte en matériaux, la valeur par défaut.
export const NATURES_COUT = Object.freeze([
  Object.freeze({ id: "materiaux",      label: "Matériaux" }),
  Object.freeze({ id: "sous_traitance", label: "Sous-traitance" }),
  Object.freeze({ id: "location",       label: "Location de matériel" }),
  Object.freeze({ id: "dechets",        label: "Bennes / déchetterie" }),
  Object.freeze({ id: "autre",          label: "Autre" }),
]);
export const NATURE_DEFAUT = "materiaux";
const NATURE_IDS = new Set(NATURES_COUT.map(n => n.id));
export const natureLigne = (l) => (NATURE_IDS.has(l?.nature) ? l.nature : NATURE_DEFAUT);
export const libelleNature = (id) => NATURES_COUT.find(n => n.id === id)?.label || "Matériaux";

// Montants par nature : { materiaux, sous_traitance, location, dechets, autre }
// (toutes les clés présentes, 0 si aucune ligne).
export function coutsParNature(lignes) {
  const out = Object.fromEntries(NATURES_COUT.map(n => [n.id, 0]));
  (lignes || []).forEach(l => { out[natureLigne(l)] += totalLignes([l]); });
  return out;
}

// ── Reste à commander PAR ENVELOPPE de lot (24/10/2026) ─────────────────────
// Remplace le rapprochement matériau par matériau (materiau_id / ouvrage_id /
// commande_le), qui ne reconnaissait pas une commande saisie sans lien avec le
// matériau prévu et la comptait deux fois dans la marge à terminaison.
//   enveloppe d'un lot = Σ coûts matériaux prévus (cout_materiaux) de ses ouvrages
//   reste du lot       = max(0, enveloppe − commandes « materiaux » du lot),
//                        0 si le lot est marqué « achats terminés »
//   commandes matériaux SANS lot : déduites du reste total (plancher 0), avec
//   un avertissement chiffré — on ne sait pas quel lot elles couvrent.
// Un lot dont les commandes dépassent l'enveloppe porte son dépassement (€, %).
// `achatsTermines` : lignes de la table achats_lots_termines du chantier
// ({ lot_id, termine_le, termine_par }).
// C'est LA fonction de la page « Commandes à passer » ET de la marge à
// terminaison (via computeChantierFinance) : un seul calcul.
export const LOT_SANS_LOT = "_sans_lot";
export function resteACommanderEnveloppes({ ouvrages = [], commandeLignes = [], lots = [], achatsTermines = [] } = {}) {
  const labelLot = (id) => id === LOT_SANS_LOT ? "Sans lot" : ((lots || []).find(l => l.id === id)?.label || id);
  const parLot = new Map();
  const lot = (id) => {
    if (!parLot.has(id)) parLot.set(id, { lotId: id, label: labelLot(id), enveloppe: 0, nbOuvrages: 0, commandes: 0, nbLignes: 0 });
    return parLot.get(id);
  };
  (ouvrages || []).forEach(o => {
    const l = lot(o?.lot_id || LOT_SANS_LOT);
    l.enveloppe += coutMatOuvrage(o);
    l.nbOuvrages += 1;
  });
  let sansLot = 0, nbLignesSansLot = 0;
  (commandeLignes || []).forEach(li => {
    if (natureLigne(li) !== "materiaux") return;
    const m = totalLignes([li]);
    if (!li.lot_id) { sansLot += m; nbLignesSansLot += 1; return; }
    const l = lot(li.lot_id);
    l.commandes += m; l.nbLignes += 1;
  });
  const termines = new Map((achatsTermines || []).filter(a => a?.lot_id).map(a => [a.lot_id, a]));
  const ordre = (lots || []).map(l => l.id);
  const rang = (id) => { const i = ordre.indexOf(id); return id === LOT_SANS_LOT ? 1e9 : (i < 0 ? 1e8 : i); };
  const lotsOut = [...parLot.values()].sort((a, b) => rang(a.lotId) - rang(b.lotId) || a.label.localeCompare(b.label)).map(l => {
    const t = termines.get(l.lotId) || null;
    const ecart = l.commandes - l.enveloppe;
    return {
      ...l,
      achatsTermines: t ? { le: t.termine_le || null, par: t.termine_par || null } : null,
      reste: t ? 0 : Math.max(0, -ecart),
      depassement: ecart > 0.005
        ? { euros: ecart, pct: l.enveloppe > 0 ? (ecart / l.enveloppe) * 100 : null }
        : null,
    };
  });
  const resteLots = lotsOut.reduce((s, l) => s + l.reste, 0);
  // Une commande sans lot ne peut que RÉDUIRE le reste (un avoir sans lot ne
  // le fait pas remonter).
  const deduction = Math.min(resteLots, Math.max(0, sansLot));
  const reste = Math.max(0, resteLots - Math.max(0, sansLot));
  const warnings = [];
  if (sansLot > 0.5) {
    warnings.push({
      code: "commandes_sans_lot", gravite: "alerte",
      message: `${nbLignesSansLot} ligne${nbLignesSansLot > 1 ? "s" : ""} de matériaux sans lot (${eur(sansLot)}) : déduite${nbLignesSansLot > 1 ? "s" : ""} du reste à commander total (${eur(deduction)} retirés), sans savoir quel lot ${nbLignesSansLot > 1 ? "elles couvrent" : "elle couvre"}. Indique le lot sur ces lignes pour un reste juste par lot.`,
    });
  }
  lotsOut.filter(l => l.depassement).forEach(l => {
    warnings.push({
      code: "depassement_enveloppe", gravite: "alerte", lotId: l.lotId,
      message: `Lot ${l.label} : ${eur(l.commandes)} de matériaux commandés pour une enveloppe de ${eur(l.enveloppe)} (+${eur(l.depassement.euros)}${l.depassement.pct != null ? `, +${l.depassement.pct.toFixed(0)} %` : ", aucun matériau prévu"}).`,
    });
  });
  return {
    lots: lotsOut,
    enveloppe: lotsOut.reduce((s, l) => s + l.enveloppe, 0),
    commandesMateriaux: lotsOut.reduce((s, l) => s + l.commandes, 0) + sansLot,
    commandesSansLot: sansLot, nbLignesSansLot, deductionSansLot: deduction,
    resteLots, reste,
    depassements: lotsOut.filter(l => l.depassement).map(l => ({ lotId: l.lotId, label: l.label, ...l.depassement })),
    warnings,
  };
}

// ── LES TROIS MARGES (étape 2 de la refonte, 24/10/2026) ────────────────────
// Réglages Admin (planning_config, clé CLE_CONFIG_SEUILS_MARGES) : tous les
// seuils de la marge probable et des alertes. Valeur absente ou illisible →
// défaut ci-dessous.
export const CLE_CONFIG_SEUILS_MARGES = "seuils_marges";
export const SEUILS_MARGES_DEFAUT = Object.freeze({
  // Marge probable
  deriveSeuilAvancementPct: 25,  // dérive constatée appliquée à partir de cet avancement du lot
  derivePlafond: 5,              // coefficient maximal appliqué aux heures restantes
  historiqueMinChantiers: 2,     // dérive historique : au moins N chantiers terminés
  // Alertes (relevés journaliers)
  alerteBaisseMargeProbableEuros: 500,
  alerteDeriveLotRatio: 1.3,
  alerteDeriveLotAvancementPct: 25,
  alerteSansLotPct: 10,
  alerteProductionHeureFacteur: 2,
  alerteDepassementEnveloppeMinEuros: 100, // dépassement d'enveloppe signalé à partir de ce montant
  // « Consommation sans avancement » (règle conservée, production exacte)
  consoAvancementStablePts: 1,
  consoHeuresAjouteesMin: 2,
  consoMargePerdueMinEuros: 50,
});
export function normaliserSeuilsMarges(valeur) {
  const v = valeur && typeof valeur === "object" ? valeur : {};
  const out = {};
  Object.entries(SEUILS_MARGES_DEFAUT).forEach(([k, d]) => {
    const n = parseFloat(String(v[k] ?? "").replace(",", "."));
    out[k] = Number.isFinite(n) && n >= 0 ? n : d;
  });
  return out;
}

// Dérives historiques par type de lot : calculées chaque nuit (et au
// rattrapage) sur les chantiers TERMINÉS, rangées dans planning_config sous
// CLE_CONFIG_DERIVES_HISTORIQUES ; tout le monde lit cette valeur (un seul
// calcul, jamais refait par une page).
export const CLE_CONFIG_DERIVES_HISTORIQUES = "derives_historiques_lots";

// « Chantier repris » : démarré avant l'application, données d'origine non
// fiables (ex. TOM & CAMILLE). Case du phasage, datée, avec auteur :
// plan_travaux.meta.chantier_repris = { le, par }. Exclu des dérives
// historiques, des statistiques de cadences et des alertes ; ses chiffres
// restent affichés avec la mention « chantier repris ».
export function chantierRepris(phasage) {
  const r = phasage?.plan_travaux?.meta?.chantier_repris;
  return r && typeof r === "object" && r.actif !== false ? { le: r.le || null, par: r.par || null } : null;
}

// Neutralisation de la dérive d'un lot par le conducteur (coefficient ×1 dans
// la marge probable) : plan_travaux.meta.neutralisations_derive =
// { [lotId]: { commentaire, par, le } }. Sans commentaire, elle ne compte pas
// (le commentaire est obligatoire). Réversible : on retire l'entrée.
export function neutralisationsDerive(phasage) {
  const n = phasage?.plan_travaux?.meta?.neutralisations_derive;
  const out = {};
  if (n && typeof n === "object") {
    Object.entries(n).forEach(([lotId, e]) => {
      const commentaire = String(e?.commentaire || "").trim();
      if (commentaire) out[lotId] = { commentaire, par: e.par || null, le: e.le || null };
    });
  }
  return out;
}

// Avancement EXACT d'un lot (0-100, non arrondi) : moyenne des avancements
// exacts de ses ouvrages pondérée par leur prix (moyenne simple sans prix) —
// même pondération que avancementLot, sans les arrondis. `etat` : état des
// tâches à une date (etatTachesALaDate) ; null = aujourd'hui. null si inconnu.
export function avancementLotExact(ouvrages, lots, lotId, etat = null) {
  const lo = ouvragesDuLot(ouvrages, lots, lotId);
  if (lo.length === 0) return 0;
  const vals = lo.map(o => avancementOuvrageExact(o, etat));
  if (vals.some(v => v == null)) return null;
  const tp = lo.reduce((s, o) => s + prixHTOuvrage(o), 0);
  if (tp > 0) return lo.reduce((s, o, i) => s + vals[i] * prixHTOuvrage(o), 0) / tp;
  return vals.reduce((s, v) => s + v, 0) / lo.length;
}

// Production cumulée à une date (ou aujourd'hui) : Σ prix × avancement exact.
export function productionCumulee(ouvrages, etat = null) {
  let v = 0;
  for (const o of ouvrages || []) {
    const av = avancementOuvrageExact(o, etat);
    if (av == null) { if (prixHTOuvrage(o) > 0) return null; continue; }
    v += prixHTOuvrage(o) * av / 100;
  }
  return v;
}

// MATÉRIAUX IMPUTÉS À L'AVANCEMENT, lot par lot (enveloppe = Σ coûts
// matériaux prévus des ouvrages du lot, mêmes lots que le reste à commander) :
//   consommé théorique = Σ ouvrages du lot de leur enveloppe × leur avancement
//                        exact (= enveloppe × avancement du lot)
//   en avance          = min( max(0, commandés − consommé), enveloppe − consommé )
//   imputé             = commandés − en avance
// Un lot terminé impute tout ; un dépassement d'enveloppe est imputé tout de
// suite ; seul un achat anticipé DANS l'enveloppe est différé. Les commandes
// de matériaux sans lot et les autres natures (sous-traitance, location,
// déchets, autre) sont imputées directement. null si l'avancement d'un
// ouvrage est inconnu à la date (`etat`).
export function materiauxImputesALAvancement({ ouvrages = [], commandeLignes = [], lots = [], etat = null } = {}) {
  const labelLot = (id) => id === LOT_SANS_LOT ? "Sans lot" : ((lots || []).find(l => l.id === id)?.label || id);
  const parLot = new Map();
  const lot = (id) => {
    if (!parLot.has(id)) parLot.set(id, { lotId: id, label: labelLot(id), enveloppe: 0, consomme: 0, commandes: 0 });
    return parLot.get(id);
  };
  for (const o of ouvrages || []) {
    const env = coutMatOuvrage(o);
    const l = lot(o?.lot_id || LOT_SANS_LOT);
    l.enveloppe += env;
    if (env !== 0) {
      const av = avancementOuvrageExact(o, etat);
      if (av == null) return null;
      l.consomme += env * av / 100;
    }
  }
  let sansLot = 0, autresNatures = 0;
  (commandeLignes || []).forEach(li => {
    const m = totalLignes([li]);
    if (natureLigne(li) !== "materiaux") { autresNatures += m; return; }
    if (!li.lot_id) { sansLot += m; return; }
    lot(li.lot_id).commandes += m;
  });
  const lotsOut = [...parLot.values()].map(l => {
    const enAvance = Math.min(Math.max(0, l.commandes - l.consomme), Math.max(0, l.enveloppe - l.consomme));
    return { ...l, enAvance, impute: l.commandes - enAvance };
  });
  const enAvance = lotsOut.reduce((s, l) => s + l.enAvance, 0);
  const imputeLots = lotsOut.reduce((s, l) => s + l.impute, 0);
  return {
    lots: lotsOut, sansLot, autresNatures, enAvance,
    commandes: lotsOut.reduce((s, l) => s + l.commandes, 0) + sansLot + autresNatures,
    impute: imputeLots + sansLot + autresNatures,
  };
}

// Coefficient de la marge probable d'un lot et sa provenance :
//   neutralisee : le conducteur a neutralisé la dérive du lot → ×1 ;
//   constatee   : avancement exact ≥ seuil → dérive constatée, plafonnée ;
//   historique  : sous le seuil → dérive historique du même type de lot
//                 (chantiers terminés, hors chantiers repris, ≥ N chantiers) ;
//   aucune      : rien d'applicable → ×1.
export function coefficientMargeProbable({ lotId, avancementExact, ratioDerive, neutralisation = null, historique = null, seuils = SEUILS_MARGES_DEFAUT }) {
  const s = normaliserSeuilsMarges(seuils);
  if (neutralisation) return { coefficient: 1, provenance: "neutralisee" };
  if (avancementExact != null && avancementExact >= s.deriveSeuilAvancementPct && ratioDerive != null) {
    return { coefficient: Math.min(ratioDerive, s.derivePlafond), provenance: "constatee", plafonne: ratioDerive > s.derivePlafond };
  }
  const h = historique?.[lotId];
  if (h && Number.isFinite(h.coef) && (h.nbChantiers || 0) >= s.historiqueMinChantiers) {
    return { coefficient: Math.min(h.coef, s.derivePlafond), provenance: "historique", nbChantiers: h.nbChantiers };
  }
  return { coefficient: 1, provenance: "aucune" };
}
export const LIBELLES_PROVENANCE_COEF = Object.freeze({
  constatee: "dérive constatée du lot",
  historique: "dérive moyenne de ce lot sur les chantiers terminés",
  neutralisee: "dérive neutralisée par le conducteur",
  aucune: "pas de dérive applicable (×1)",
});

// DÉRIVES HISTORIQUES par type de lot. `chantiers` : [{ chantierId,
// chantierNom, repris, lots }] où `lots` sont les lots de computeChantierFinance
// d'un chantier TERMINÉ. Par lot : Σ heures réelles comparables ÷ Σ heures
// attendues (heures prévues × avancement exact), soit la moyenne des dérives
// pondérée par les heures. Lots sous le seuil d'avancement et chantiers repris
// exclus. Coefficient retenu seulement à partir de N chantiers (réglage).
// Un chantier avec une reprise d'antériorité (`repriseHeures` > 0 : heures
// consommées avant l'application, saisies en bloc sans lot) est exclu lui
// aussi : ses heures par lot sont incomplètes, sa dérive par lot serait fausse.
export function derivesHistoriquesParLot(chantiers = [], seuils = SEUILS_MARGES_DEFAUT) {
  const s = normaliserSeuilsMarges(seuils);
  const parLot = {};
  const exclusRepris = [];
  const exclusReprise = [];
  (chantiers || []).forEach(c => {
    if (c?.repris) { exclusRepris.push(c.chantierNom || c.chantierId); return; }
    if ((parseFloat(c?.repriseHeures) || 0) > 0) { exclusReprise.push(c.chantierNom || c.chantierId); return; }
    (c?.lots || []).forEach(l => {
      if (!l || l.id === "_orphans" || l.vide) return;
      const att = parseFloat(l.heuresAttendues) || 0;
      if (!(att > 0) || !((l.avancementExact ?? 0) >= s.deriveSeuilAvancementPct)) return;
      const e = (parLot[l.id] ||= { lotId: l.id, label: l.label, heuresReelles: 0, heuresAttendues: 0, chantiers: [] });
      e.heuresReelles += parseFloat(l.heuresReelles) || 0;
      e.heuresAttendues += att;
      e.chantiers.push(c.chantierNom || c.chantierId);
    });
  });
  const lots = {};
  Object.values(parLot).forEach(e => {
    lots[e.lotId] = { ...e, nbChantiers: e.chantiers.length, coef: e.heuresAttendues > 0 ? e.heuresReelles / e.heuresAttendues : null,
      retenu: e.chantiers.length >= s.historiqueMinChantiers };
  });
  return { lots, nbChantiers: (chantiers || []).length - exclusRepris.length - exclusReprise.length, exclusRepris, exclusReprise };
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
  { cle: "heuresVendues", label: "Heures prévues",
    formule: "Somme des heures prévues des ouvrages : cadence × quantité de la bibliothèque, réparties entre les tâches selon les % ; à défaut de cadence, heures du devis (signalé « prévu = devis »)",
    source: "Ouvrages du phasage (Phasage V2)" },
  { cle: "heuresReelles", label: "Heures totales",
    formule: "Heures pointées sur les tâches + heures libres + trajets et heures indirectes + reprise d'antériorité. Le % consommé compare aux heures prévues ces heures MOINS celles des tâches hors devis (travail non vendu), affichées à part ; le coût, lui, les compte toutes",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "moPrev", label: "MO prév.",
    formule: "Heures prévues × taux de main d'œuvre prévisionnel (réglage Admin)",
    source: "Ouvrages du phasage × taux Admin" },
  { cle: "matPrev", label: "Commandes prév.",
    formule: "Somme des coûts matériaux estimés des ouvrages (matériaux liés de la bibliothèque)",
    source: "Bibliothèque de matériaux (cout_materiaux des ouvrages)" },
  { cle: "margePrev", label: "Marge prév.",
    formule: "Vendu HT − déboursé prévisionnel (MO prévisionnelle + commandes prévisionnelles) − frais généraux prévisionnels (taux de frais généraux en vigueur aujourd'hui × heures prévues)",
    source: "Ouvrages du phasage, taux Admin, bibliothèque de matériaux, taux de frais généraux (Admin)" },
  { cle: "moReel", label: "Coût MO",
    formule: "Heures pointées × taux horaire de chaque ouvrier (taux figé au pointage) + heures libres + trajets et heures indirectes + reprise d'antériorité",
    source: "Registre de pointage (validations de fin de journée)" },
  { cle: "matReel", label: "Matériaux",
    formule: "Somme des lignes de commande passées pour le chantier, toutes natures comprises (matériaux, sous-traitance, location de matériel, bennes / déchetterie, autre), ventilées par nature",
    source: "Lignes de commande du chantier" },
  { cle: "fg", label: "Frais généraux",
    formule: "Chaque heure réelle du chantier × le taux de frais généraux en vigueur à la date de cette heure. Le taux est unique pour toute l'entreprise et daté (réglage Admin, 17,44 €/h depuis le 01/01/2026 par défaut) : un nouveau taux ne change pas les heures passées. Les heures sans date (reprise d'antériorité, heures anciennes) prennent le taux le plus ancien",
    source: "Taux de frais généraux datés (Admin) × registre de pointage" },
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
    formule: "(heures réelles ÷ heures prévues) ÷ (avancement ÷ 100) — à 1,00 le lot est dans le devis, au-delà de 1,15 il dérive ; indéterminé si les heures prévues ou l'avancement sont à zéro. Les tâches hors devis n'entrent ni dans les heures réelles comparées ni dans l'avancement",
    source: "Ouvrages du lot + registre de pointage" },
  // ── Projections (étape 6) : où on va, pas seulement où on en est ──
  { cle: "resteAFaire", label: "Reste à faire", projection: true,
    formule: "Heures : somme des heures estimées restantes des tâches non terminées (heures estimées × part non faite). Euros : vendu HT × part du chantier restant à produire",
    source: "Tâches des ouvrages (heures estimées + avancement)" },
  { cle: "margeATerminaison", label: "Marge à terminaison", projection: true,
    formule: "Vendu HT − (coût MO réel + heures restantes × taux MO prévisionnel) − (matériaux réels + reste à commander) − frais généraux projetés (frais généraux des heures déjà faites + heures restantes × taux de frais généraux en vigueur aujourd'hui)",
    source: "Registre de pointage, tâches restantes, lignes de commande, coûts matériaux prévus des ouvrages, taux de frais généraux (Admin)" },
  { cle: "situationAFacturer", label: "Situation à facturer", projection: true,
    formule: "(avancement % − % facturé) × vendu HT — si l'avancement dépasse le facturé, une situation est à émettre",
    source: "Avancement du chantier + % facturé des États financiers (CA à provisionner)" },
  { cle: "resteACommander", label: "Reste à commander", projection: true,
    formule: "Lot par lot : enveloppe matériaux (somme des coûts matériaux prévus des ouvrages du lot) − commandes de matériaux rattachées au lot, jamais moins de 0 ; 0 pour un lot marqué « achats terminés ». Les commandes de matériaux sans lot sont retirées du total (jamais moins de 0). Sous-traitance, location, bennes et autres coûts ne consomment pas l'enveloppe. Même calcul que la page Commandes à passer",
    source: "Coûts matériaux prévus des ouvrages vs lignes de commande (nature matériaux) + lots marqués « achats terminés »" },
  // ── Bilan semaine (13/10/2026) : marge RÉELLE, plus une part de la marge
  // à terminaison. Les coûts sont ceux réellement datés dans la période. ──
  { cle: "production", label: "Production d'une période",
    formule: "Somme, ouvrage par ouvrage, de son prix de vente × (avancement en fin de période − avancement en début de période), sans arrondi. L'avancement d'un ouvrage à une date vient du journal d'avancement daté : chaque tâche prend sa dernière valeur enregistrée à cette date (date de réalisation : jour du compte rendu, ou date choisie dans le phasage). Ajouter un ouvrage ne change pas la production passée des autres. Les tâches hors devis restent hors de l'avancement. Si l'avancement d'un ouvrage est inconnu à l'une des deux dates (avant le début du journal), la production est « non calculable », jamais 0",
    source: "Journal d'avancement daté (validations de fin de journée, phasage) + prix de vente des ouvrages" },
  { cle: "margeSemaine", label: "Marge de la période",
    formule: "Marge à l'avancement en fin de période − marge à l'avancement en début de période. Elle se lit comme : production de la période (ouvrage par ouvrage, prix de vente × avancement gagné, sans arrondi, d'après le journal d'avancement daté — un compte rendu compte au jour du rapport, pas au jour de sa validation) − main-d'œuvre et frais généraux des heures de la période − variation des matériaux imputés à l'avancement − autres coûts (sous-traitance, location, bennes) datés de la période. La marge de la semaine et la marge cumulée sont ainsi toujours cohérentes entre elles. Négative si la période a coûté plus qu'elle n'a produit",
    source: "Journal d'avancement daté, registre de pointage, lignes de commande, enveloppes matériaux des lots, taux de frais généraux (Admin)" },
  { cle: "margeCumulee", label: "Marge à l'avancement en fin de période",
    formule: "La marge à l'avancement calculée avec l'état du chantier en fin de période : production cumulée (prix de chaque ouvrage × son avancement exact à cette date) − coûts réels imputés jusqu'à cette date (main-d'œuvre, reprise d'antériorité comprise, frais généraux, matériaux imputés à l'avancement, autres coûts). Elle rattrape d'elle-même un avancement mal déclaré une semaine ou une commande saisie en retard",
    source: "Journal d'avancement daté, registre de pointage, lignes de commande, enveloppes matériaux des lots, taux de frais généraux (Admin)" },
  // ── Trois marges (étape 2 de la refonte, 24/10/2026) ──
  { cle: "margeAvancement", label: "Marge à l'avancement",
    formule: "Le constat, « où j'en suis » : production cumulée (prix de chaque ouvrage × son avancement exact, sans arrondi) − coûts réels imputés : main-d'œuvre (reprise d'antériorité comprise), frais généraux, sous-traitance / location / bennes / autres coûts, et matériaux imputés à l'avancement. Pour chaque lot, les matériaux consommés en théorie valent l'enveloppe matériaux du lot × son avancement ; la part commandée au-delà, dans la limite de l'enveloppe, est « en avance sur chantier » et n'est pas encore imputée ; un dépassement d'enveloppe est imputé tout de suite, un lot terminé impute tout. Les matériaux commandés sans lot sont imputés directement",
    source: "Avancement des tâches, prix des ouvrages, registre de pointage, lignes de commande, enveloppes matériaux des lots, taux de frais généraux (Admin)" },
  { cle: "materiauxEnAvance", label: "Matériaux en avance sur chantier",
    formule: "Lot par lot : min( commandes de matériaux du lot − enveloppe du lot × avancement, enveloppe × (1 − avancement) ), jamais moins de 0. Ce sont des achats anticipés dans la limite de l'enveloppe : ils seront imputés au fur et à mesure de l'avancement",
    source: "Lignes de commande (nature matériaux) + enveloppes matériaux des lots + avancement" },
  { cle: "margeProbable", label: "Marge probable", projection: true,
    formule: "« Si on continue au rythme actuel » : comme la marge à terminaison, mais les heures restantes de chaque lot sont multipliées par un coefficient : la dérive constatée du lot quand son avancement atteint le seuil réglé dans Admin (25 % par défaut), plafonnée (×5 par défaut) ; sous le seuil, la dérive moyenne de ce type de lot sur les chantiers terminés (pondérée par les heures, chantiers repris exclus, au moins 2 chantiers) ; à défaut ×1 ; ×1 aussi quand le conducteur a neutralisé la dérive du lot (avec un commentaire). Marge probable = marge à terminaison − Σ lots (heures restantes probables − heures restantes prévues) × (taux MO prévisionnel + taux de frais généraux en vigueur). Les heures « sans lot » restent dans les coûts réels, sans coefficient",
    source: "Marge à terminaison, dérives des lots, dérives historiques des chantiers terminés, réglages Admin" },
  { cle: "deriveLotHeuresEuros", label: "Dérive d'un lot en heures et en euros",
    formule: "Heures attendues à cet avancement = heures prévues du lot × avancement exact ; écart en heures = heures réelles comparables − heures attendues ; écart en euros = écart en heures × (coût horaire réel moyen de la main-d'œuvre du lot + taux de frais généraux en vigueur). Le ratio ×N (heures réelles ÷ heures attendues) reste affiché à côté",
    source: "Ouvrages du lot + registre de pointage + taux de frais généraux (Admin)" },
  { cle: "budgetRestant", label: "Budget restant",
    formule: "Vendu HT − coûts engagés à date (main-d'œuvre, matériaux et autres commandes, frais généraux). Ce n'est PAS une marge : c'est ce qu'il reste du prix de vente pour finir le chantier. Il baisse mécaniquement à chaque dépense, même sur un chantier qui gagne de l'argent (ancienne « marge nette »)",
    source: "Ouvrages du phasage, registre de pointage, lignes de commande, taux de frais généraux (Admin)" },
  { cle: "heuresSansLot", label: "Heures sans lot",
    formule: "Heures libres (sans tâche du phasage) + heures indirectes hors trajets (nettoyage, SAV, approvisionnement…) + heures des ouvrages rattachés à aucun lot, rapportées aux heures pointées hors trajets et hors reprise d'antériorité",
    source: "Registre de pointage" },
];
const FORMULE = Object.fromEntries(METHODE_CALCUL.map(m => [m.cle, m.formule]));
const signeEur = (n) => `${n >= 0 ? "+" : ""}${eur(n)}`;

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
  materiauxById = null,  // (plus lu depuis le 24/10/2026 : le reste à commander passe par les enveloppes de lot)
  achatsTermines = [],   // lots marqués « achats terminés » du chantier (table achats_lots_termines)
  // ── Frais généraux (24/10/2026) ──
  tauxFG = null,         // barème daté planning_config.fg_taux_horaires — absent = TAUX_FG_DEFAUT
  aujourdhui = null,     // "AAAA-MM-JJ" : date du taux des projections — absente = taux le plus récent
  // ── Trois marges (étape 2, 24/10/2026) ──
  seuilsMarges = null,       // planning_config.seuils_marges — absent = SEUILS_MARGES_DEFAUT
  derivesHistoriques = null, // planning_config.derives_historiques_lots (.lots) — absent = pas d'historique
} = {}) {
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const meta = phasage?.plan_travaux?.meta || {};
  const ppt = indexPointagesParTache(pointages);
  const baremeFG = normaliserBaremeFG(tauxFG);
  const tauxFGAncien = baremeFG[0].taux;
  const tauxFGActuel = aujourdhui ? tauxFGALaDate(baremeFG, aujourdhui) : baremeFG[baremeFG.length - 1].taux;
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
  // Heures des tâches hors devis : comptées dans le total et les coûts, mais
  // jamais comparées aux heures vendues (% consommées, couleur, indice de délai).
  const heuresHorsDevisChantier = heuresHorsDevisOuvrages(ouvrages, ppt);
  const heuresComparablesChantier = heuresReellesTotalChantier - heuresHorsDevisChantier;
  const coutMatChantier = totalLignes(commandeLignes);
  const commandesPrevChantier = ouvrages.reduce((s, o) => s + coutMatOuvrage(o), 0);
  const tauxMOPrevEff = tauxMOPrev > 0 ? tauxMOPrev : TAUX_MO_PREV_DEFAUT;
  const moPrevChantier = heuresVenduesChantier * tauxMOPrevEff;
  // Frais généraux : chaque heure au taux de SA date (barème Admin). Mêmes
  // heures que heuresReellesTotalChantier : tâches du plan (registre, sinon
  // heures anciennes de la tâche au taux le plus ancien), libres + indirects,
  // reprise d'antériorité au taux le plus ancien.
  const tauxFGVus = new Set();
  const fgTache = (t) => {
    const pts = tachePointages(t, ppt);
    if (pts.length > 0) return fgDePointages(pts, baremeFG, tauxFGVus);
    const h = tacheHeuresReelles(t, ppt);
    if (h > 0) tauxFGVus.add(tauxFGAncien);
    return h * tauxFGAncien;
  };
  const fgOuvrage = (o) => (o?.taches || []).reduce((s, t) => s + fgTache(t), 0);
  const ptsExtras = (pointages || []).filter(p => p.type_pointage === "indirect" || !p.tache_id);
  const tauxFGVusExtras = new Set();
  const fgExtras = fgDePointages(ptsExtras, baremeFG, tauxFGVusExtras);
  tauxFGVusExtras.forEach(t => tauxFGVus.add(t));
  if (repriseHeures > 0) tauxFGVus.add(tauxFGAncien);
  const fgChantier = ouvrages.reduce((s, o) => s + fgOuvrage(o), 0) + fgExtras + repriseHeures * tauxFGAncien;
  // Taux affiché : le taux du jour (c'est aussi celui des projections).
  const fgTauxHoraire = tauxFGActuel;
  const texteTauxReel = texteTauxFG(tauxFGVus.size > 0 ? tauxFGVus : [tauxFGActuel]);
  const margeChantier  = prixHTChantier - coutMOTotalChantier - coutMatChantier - fgChantier;
  const margePctChantier = prixHTChantier > 0 ? (margeChantier / prixHTChantier) * 100 : 0;
  // Marge PRÉVISIONNELLE : le devis face à ce qu'on a prévu de dépenser —
  // déboursé prévisionnel (MO prév. + commandes prév.) et FG au taux du jour
  // appliqué aux heures VENDUES (pas encore pointées).
  const fgPrevChantier = tauxFGActuel * heuresVenduesChantier;
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
  // Trois marges : réglages, neutralisations, historique (paramètres).
  const seuilsM = normaliserSeuilsMarges(seuilsMarges);
  const neutralisations = neutralisationsDerive(phasage);
  const repris = chantierRepris(phasage);
  const historiqueLots = derivesHistoriques?.lots || derivesHistoriques || null;
  const tauxHoraireProjete = tauxMOPrevEff + tauxFGActuel;
  const heuresRestantesTache = (t) => {
    const a = Math.max(0, Math.min(100, parseFloat(t.avancement) || 0));
    const he = parseFloat(t.heures_estimees) || 0;
    return a >= 100 ? 0 : he * (100 - a) / 100;
  };
  const lotsOut = lotsEtOrphelins.map(l => {
    const lo = ouvragesDuLot(ouvrages, lots, l.id);
    const hv = lo.reduce((s, o) => s + heuresVenduesOuvrage(o), 0);
    // Heures comparées au vendu : sans les tâches hors devis (à part).
    const hr = lo.reduce((s, o) => s + heuresReellesComparablesOuvrage(o, ppt), 0);
    const hhd = lo.reduce((s, o) => s + heuresHorsDevisOuvrage(o, ppt), 0);
    const av = lo.length > 0 ? avancementLot(ouvrages, lots, l.id) : 0;
    // Avancement EXACT (non arrondi) : base de la dérive et de la marge probable.
    const avEx = lo.length > 0 ? avancementLotExact(ouvrages, lots, l.id) : 0;
    // Ratio de dérive : (réelles/prévues) ÷ (avancement exact/100). 1,00 = dans
    // le devis. Indéterminé (null) si pas d'heures prévues ou avancement nul.
    // Affiché tel quel (avancement arrondi) ; la marge probable et les alertes
    // lisent ratioDeriveExact (avancement exact, sans arrondi).
    const ratioDerive = (hv > 0 && av > 0) ? (hr / hv) / (av / 100) : null;
    const ratioDeriveExact = (hv > 0 && avEx > 0) ? (hr / hv) / (avEx / 100) : null;
    // Dérive en heures et en euros : écart aux heures attendues à cet
    // avancement, valorisé au coût horaire MO réel moyen du lot + FG du jour.
    const heuresAttendues = hv * avEx / 100;
    const ecartHeures = hr - heuresAttendues;
    const hTous = lo.reduce((s, o) => s + heuresReellesOuvrage(o, ppt), 0);
    const coutMOLot = lo.reduce((s, o) => s + coutMOOuvrage(o, ppt, tauxHoraires), 0);
    const coutHoraireMO = hTous > 0 && coutMOLot > 0 ? coutMOLot / hTous : tauxMOPrevEff;
    const ecartEuros = ecartHeures * (coutHoraireMO + tauxFGActuel);
    // Marge probable : heures restantes × coefficient (et sa provenance).
    const heuresRestantesPrevues = lo.reduce((s, o) => s + (o.taches || []).reduce((ss, t) => ss + heuresRestantesTache(t), 0), 0);
    const neutr = neutralisations[l.id] || null;
    const coef = coefficientMargeProbable({ lotId: l.id, avancementExact: avEx, ratioDerive: ratioDeriveExact, neutralisation: neutr,
      historique: l.id === "_orphans" ? null : historiqueLots, seuils: seuilsM });
    const heuresRestantesProbables = heuresRestantesPrevues * coef.coefficient;
    return {
      id: l.id, label: l.label, couleur: l.couleur || null,
      nbOuvrages: lo.length,
      heuresVendues: hv, heuresReelles: hr,
      ...(hhd > 0 ? { heuresHorsDevis: hhd } : {}),
      avancement: av, avancementExact: avEx, ratioDerive, ratioDeriveExact,
      heuresAttendues, ecartHeures, ecartEuros, coutHoraireMO,
      heuresRestantesPrevues, heuresRestantesProbables,
      coefficient: coef.coefficient, provenanceCoefficient: coef.provenance,
      ...(coef.plafonne ? { coefficientPlafonne: true } : {}),
      ...(coef.nbChantiers ? { nbChantiersHistorique: coef.nbChantiers } : {}),
      neutralisation: neutr,
      ecartProbableEuros: (heuresRestantesProbables - heuresRestantesPrevues) * tauxHoraireProjete,
      vide: lo.length === 0,
    };
  });

  // ── Phases (groupes chrono du phasage) : heures vendues / réelles ──
  // Heures prises sur les TÂCHES (heures_vendues de la tâche), là où les lots
  // lisent les heures du devis de l'ouvrage : les deux peuvent différer, la
  // fiche Opération affiche l'écart. Hors devis : à part, jamais comparé.
  // Avancement : convention de la vue chrono (statsTachesChrono, pondéré
  // heures vendues). Dérive : même formule que les lots.
  // Les tâches sans phase (ou d'une phase supprimée) forment « Sans phase ».
  const groupesChrono = (Array.isArray(meta.chrono_groupes) ? meta.chrono_groupes : [])
    .filter(g => g && g.id != null)
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const oa = parseFloat(a.g.ordre), ob = parseFloat(b.g.ordre);
      return (Number.isFinite(oa) ? oa : 1e9) - (Number.isFinite(ob) ? ob : 1e9) || a.i - b.i;
    })
    .map(x => x.g);
  const idsPhases = new Set(groupesChrono.map(g => g.id));
  const toutesTaches = ouvrages.flatMap(o => o.taches || []);
  const synthesePhase = (taches) => {
    const comp = taches.filter(t => !tacheHorsDevis(t));
    const hv = comp.reduce((s, t) => s + tacheHeuresVendues(t), 0);
    const hr = comp.reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0);
    const hhd = taches.filter(tacheHorsDevis).reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0);
    const av = statsTachesChrono(taches).avancement;
    return {
      nbTaches: taches.length, heuresVendues: hv, heuresReelles: hr, heuresHorsDevis: hhd,
      avancement: av, ratioDerive: (hv > 0 && av > 0) ? (hr / hv) / (av / 100) : null,
    };
  };
  const phasesOut = groupesChrono.map((g, rang) => ({
    id: g.id, nom: (g.nom || "").trim() || "(sans nom)", groupeTypeId: g.groupe_type_id || null,
    rang, sansPhase: false,
    ...synthesePhase(toutesTaches.filter(t => t?.chrono_groupe_id === g.id)),
  }));
  const tachesSansPhase = toutesTaches.filter(t => !t?.chrono_groupe_id || !idsPhases.has(t.chrono_groupe_id));
  if (tachesSansPhase.length > 0) {
    phasesOut.push({ id: "_sans_phase", nom: "Sans phase (à organiser)", groupeTypeId: null,
      rang: phasesOut.length, sansPhase: true, ...synthesePhase(tachesSansPhase) });
  }
  // Dérive du chantier : même formule que les lots, sur les heures comparées
  // au vendu (tâches + trajets + indirect + libres + reprise, sans hors devis)
  // et l'avancement du chantier. Indéterminée (null) si vendu ou avancement nul.
  const deriveChantier = (heuresVenduesChantier > 0 && avancementGlobal > 0)
    ? (heuresComparablesChantier / heuresVenduesChantier) / (avancementGlobal / 100)
    : null;

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

  // Reste à commander : enveloppe matériaux par lot — LA fonction de la page
  // « Commandes à passer » (resteACommanderEnveloppes). Toujours calculable :
  // elle ne dépend plus de la bibliothèque (materiauxById n'est plus lu).
  const enveloppes = resteACommanderEnveloppes({ ouvrages, commandeLignes, lots, achatsTermines });
  const resteACommanderVal = enveloppes.reste;
  const coutMatParNature = coutsParNature(commandeLignes);

  // Marge à terminaison : ce qu'il restera une fois le chantier fini, si les
  // heures restantes coûtent le taux MO prévisionnel et si le reste à
  // commander est effectivement commandé.
  const fgProjete = fgChantier + tauxFGActuel * heuresRestantes;
  const margeATerminaisonVal = prixHTChantier
    - (coutMOTotalChantier + heuresRestantes * tauxMOPrevEff)
    - (coutMatChantier + (resteACommanderVal ?? 0))
    - fgProjete;

  // ── Les trois marges (étape 2) ──
  // Marge à l'avancement (le constat) : production cumulée exacte − coûts
  // réels imputés (MO + FG + autres natures + matériaux imputés à l'avancement).
  const productionCumuleeVal = productionCumulee(ouvrages);
  const matImputes = materiauxImputesALAvancement({ ouvrages, commandeLignes, lots });
  const coutsImputes = coutMOTotalChantier + fgChantier + matImputes.impute;
  const margeAvancementVal = productionCumuleeVal - coutsImputes;
  // Marge probable : marge à terminaison corrigée, lot par lot, des heures
  // restantes × (coefficient − 1) au taux projeté (MO prév. + FG du jour).
  const ecartProbableTotal = lotsOut.reduce((s, l) => s + l.ecartProbableEuros, 0);
  const margeProbableVal = margeATerminaisonVal - ecartProbableTotal;
  const heuresRestantesProbables = lotsOut.reduce((s, l) => s + l.heuresRestantesProbables, 0);
  // Budget restant (ancienne « marge nette ») : ce qu'il reste du prix de
  // vente une fois payés les coûts engagés — PAS une marge.
  const budgetRestantVal = prixHTChantier - coutMOTotalChantier - coutMatChantier - fgChantier;
  // Heures « sans lot » : pointées hors d'un lot (heures libres, indirectes
  // hors trajet, tâches d'ouvrages sans lot), rapportées aux heures pointées
  // hors trajets et hors reprise d'antériorité.
  const heuresOrphelines = ouvragesDuLot(ouvrages, lots, "_orphans").reduce((s, o) => s + heuresReellesOuvrage(o, ppt), 0);
  const heuresSansLot = extras.heuresLibre + Math.max(0, extras.heuresIndirect - trajet.heures) + heuresOrphelines;
  const heuresBaseSansLot = heuresReellesTotalChantier - trajet.heures - repriseHeures;
  const pctSansLot = heuresBaseSansLot > 0 ? (heuresSansLot / heuresBaseSansLot) * 100 : null;

  // Situation à facturer : avancement au-delà du % facturé (États financiers).
  const situationVal = situationAFacturerVal(avancementGlobal, pctFacture, prixHTChantier);

  // ── Warnings agrégés (niveau chantier) ──
  // (Plus d'avertissement « frais généraux non réglés » : le barème Admin
  // donne toujours un taux, TAUX_FG_DEFAUT à défaut.)
  const warnings = [];
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
  // Seuil de prime : comparé à la MARGE PROBABLE (la meilleure estimation de
  // la marge finale), plus au budget restant (étape 2).
  const margeProbablePct = prixHTChantier > 0 ? (margeProbableVal / prixHTChantier) * 100 : 0;
  if (seuilPrime > 0 && prixHTChantier > 0 && margeProbablePct < seuilPrime) {
    warnings.push({
      code: "marge_sous_seuil_prime", gravite: "alerte",
      message: `Marge probable à ${margeProbablePct.toFixed(1)} % du vendu, sous le seuil de prime (${seuilPrime} %).`,
    });
  }
  lotsOut.forEach(l => {
    if (l.ratioDerive != null && l.ratioDerive > SEUIL_RATIO_DERIVE) {
      warnings.push({
        code: "derive_lot", gravite: "alerte", lotId: l.id,
        message: `Lot ${l.label} : dérive d'heures ×${l.ratioDerive.toFixed(2)} (réalisé ${fmtH(l.heuresReelles)}h / ${fmtH(l.heuresVendues)}h prévues pour ${l.avancement} % d'avancement${l.heuresHorsDevis > 0 ? ` ; + ${fmtH(l.heuresHorsDevis)}h hors devis non comptées` : ""}).`,
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
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id), lotId: o.lot_id || null, value: prixHTOuvrage(o) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  // `lotId` et `valeur` ne s'affichent pas : ils permettent à la fiche
  // Opération d'additionner ces lignes sans refaire le calcul.
  const venduVentilation = venduRows.map(r => ({ main: r.main, sub: r.sub, right: eur(r.value), lotId: r.lotId, valeur: r.value }));

  // « heures » : réelles / vendues par ouvrage + ligne extras.
  const heuresRowsBase = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", sub: lotLabelOf(o.lot_id),
      r: heuresReellesComparablesOuvrage(o, ppt), v: heuresVenduesOuvrage(o), hd: heuresHorsDevisOuvrage(o, ppt) }))
    .filter(r => r.r > 0 || r.v > 0 || r.hd > 0)
    .sort((a, b) => b.v - a.v || b.r - a.r);
  const heuresVentilation = heuresRowsBase.map(r => ({
    main: r.main, sub: r.sub,
    // Les heures hors devis s'affichent à part, sans couleur de dépassement.
    right: `${fmtH(r.r)}h / ${fmtH(r.v)}h${r.hd > 0 ? ` + ${fmtH(r.hd)}h hors devis` : ""}`,
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
  // `cle`, `heures`, `taux` et `valeur` ne s'affichent pas : ils permettent à
  // la fiche Opération de regrouper ces lignes (par ouvrier) sans recalcul.
  const moVentilation = moRowsOuvriers.map(r => ({
    main: r.ouvrier,
    sub: `${fmtH(r.heures)}h × ${eur(r.taux)}/h`,
    right: eur(r.cout),
    cle: "ouvrier", heures: r.heures, taux: r.taux, valeur: r.cout,
  }));
  if (moReste > 0.5) {
    moVentilation.push({ main: "Heures sans pointage nominatif", sub: "coût estimé via ouvriers assignés", right: eur(moReste),
      cle: "sans_nominatif", heures: null, valeur: moReste });
  }
  if (trajet.cout > 0) {
    moVentilation.push({ main: "Trajets", sub: `${fmtH(trajet.heures)}h · pointages indirects`, right: eur(trajet.cout),
      cle: "trajets", heures: trajet.heures, valeur: trajet.cout });
  }
  if (indirectHT.cout > 0) {
    moVentilation.push({ main: "Heures indirectes", sub: "intempéries, SAV, nettoyage…", right: eur(indirectHT.cout),
      cle: "indirect", heures: indirectHT.heures, valeur: indirectHT.cout });
  }
  if (extras.coutLibre > 0.5) {
    moVentilation.push({ main: "Heures libres", sub: "hors tâche du plan", right: eur(extras.coutLibre),
      cle: "libres", heures: extras.heuresLibre, valeur: extras.coutLibre });
  }

  // « fg » : par ouvrage (heures réelles × taux de leur date) + extras + reprise.
  const fgVentilation = ouvrages
    .map(o => ({ main: o.libelle || "(sans libellé)", hr: heuresReellesOuvrage(o, ppt), fg: fgOuvrage(o) }))
    .filter(r => r.hr > 0)
    .sort((a, b) => b.hr - a.hr)
    .map(r => ({ main: r.main, sub: `${fmtH(r.hr)}h × ${texteTauxReel}`, right: eur(r.fg) }));
  if (hExtra > 0.05) {
    fgVentilation.push({ main: "Trajets + indirect + libres", sub: `${fmtH(hExtra)}h × ${texteTauxFG(tauxFGVusExtras)}`, right: eur(fgExtras) });
  }
  if (repriseHeures > 0) {
    fgVentilation.push({ main: "Reprise d'antériorité", sub: `${fmtH(repriseHeures)}h × ${fmtTauxFG(tauxFGAncien)} (taux le plus ancien)`, right: eur(repriseHeures * tauxFGAncien) });
  }

  // « marge » : les 4 postes.
  const margeVentilation = [
    { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
    { main: "Coût main d'œuvre", sub: "tâches + trajets + indirect", right: `− ${eur(coutMOTotalChantier)}`, rightColor: "#e15a5a" },
    { main: "Matériaux", sub: "commandes du chantier", right: `− ${eur(coutMatChantier)}`, rightColor: "#e15a5a" },
    { main: "Frais généraux", sub: `${texteTauxReel} × heures réelles`, right: `− ${eur(fgChantier)}`, rightColor: "#e15a5a" },
  ];

  // « marge_prev » : vendu, déboursé prévisionnel (MO + matériaux), FG prévisionnels.
  const margePrevVentilation = [
    { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
    { main: "Déboursé prévisionnel", sub: `MO prév. ${eur(moPrevChantier)} + matériaux prév. ${eur(commandesPrevChantier)}`, right: `− ${eur(deboursePrevChantier)}`, rightColor: "#e15a5a" },
    { main: "Frais généraux prévisionnels", sub: `${fmtTauxFG(tauxFGActuel)} × ${fmtH(heuresVenduesChantier)}h prévues`, right: `− ${eur(fgPrevChantier)}`, rightColor: "#e15a5a" },
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
      // La nature n'est rappelée que si ce n'est pas des matériaux.
      sub: [l.commande?.fournisseur_nom || null, natureLigne(l) !== "materiaux" ? libelleNature(natureLigne(l)) : null].filter(Boolean).join(" · ") || null,
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
    cle: "heuresVendues", label: "Heures prévues", format: "heure",
    valeur: heuresVenduesChantier, valeurTexte: `${fmtH(heuresVenduesChantier)}h`,
    formule: FORMULE.heuresVendues,
    calculDetaille: `${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""} → ${fmtH(heuresVenduesChantier)}h prévues`,
    source: sourceOuvrages,
    renseigne: heuresVenduesChantier > 0 || ouvrages.length > 0,
  });

  const heuresReelles = D({
    cle: "heuresReelles", label: "Heures totales", format: "heure",
    valeur: heuresReellesTotalChantier,
    valeurTexte: `${heuresReellesTotalChantier.toFixed(0)}h / ${heuresVenduesChantier.toFixed(0)}h`,
    sousLabel: (heuresVenduesChantier > 0
      ? `${Math.round((heuresComparablesChantier / heuresVenduesChantier) * 100)}% consommées`
      : "réelles / prévues")
      + (heuresHorsDevisChantier > 0 ? ` · dont ${fmtH(heuresHorsDevisChantier)}h hors devis` : ""),
    formule: FORMULE.heuresReelles,
    calculDetaille: `${fmtH(heuresReellesChantier)}h (tâches) + ${fmtH(extras.heuresLibre)}h (libres) + ${fmtH(extras.heuresIndirect)}h (trajets + indirect)${repriseHeures > 0 ? ` + ${fmtH(repriseHeures)}h (reprise)` : ""} = ${fmtH(heuresReellesTotalChantier)}h`
      + (heuresHorsDevisChantier > 0 ? `, dont ${fmtH(heuresHorsDevisChantier)}h hors devis (non comparées aux heures prévues : ${fmtH(heuresComparablesChantier)}h comparées)` : ""),
    ventilation: heuresVentilation,
    titre: "Heures réelles / prévues",
    sousTitre: `${heuresReellesTotalChantier.toFixed(1)}h pointées sur ${heuresVenduesChantier.toFixed(0)}h prévues`,
    vide: "Aucune heure prévue ni pointée.",
    totalLabel: "Total réelles / prévues",
    totalTexte: `${fmtH(heuresReellesTotalChantier)}h / ${fmtH(heuresVenduesChantier)}h`,
    source: sourceRegistre,
    renseigne: true,
  });

  const moPrev = D({
    cle: "moPrev", label: "MO prév.", format: "euro",
    valeur: moPrevChantier, valeurTexte: eur(moPrevChantier),
    sousLabel: `${tauxMOPrevEff}€/h × ${heuresVenduesChantier.toFixed(0)}h prévues`,
    formule: FORMULE.moPrev,
    calculDetaille: `${fmtH(heuresVenduesChantier)}h × ${tauxMOPrevEff} €/h = ${eur(moPrevChantier)}`,
    ventilation: moPrevVentilation,
    titre: "Coût MO prévisionnel",
    sousTitre: `${tauxMOPrevEff}€/h × ${heuresVenduesChantier.toFixed(0)}h prévues`,
    vide: "Aucune heure prévue sur les ouvrages.",
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
    source: "Ouvrages du phasage, taux Admin, bibliothèque de matériaux, taux de frais généraux (Admin)",
    warnings: warnings.filter(w => w.code === "ouvrages_sans_prix"),
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
    // Ventilation par nature (toutes les natures restent dans ce coût réel).
    parNature: NATURES_COUT.map(n => ({ nature: n.id, label: n.label, valeur: coutMatParNature[n.id] })),
    titre: "Matériaux (commandes)",
    sousTitre: [`${(commandeLignes || []).length} ligne${(commandeLignes || []).length > 1 ? "s" : ""} de commande`,
      ...NATURES_COUT.filter(n => n.id !== "materiaux" && Math.abs(coutMatParNature[n.id]) > 0.5).map(n => `dont ${n.label.toLowerCase()} ${eur(coutMatParNature[n.id])}`)].join(" · "),
    vide: "Aucune ligne de commande liée à ce chantier.",
    totalLabel: "Total matériaux",
    source: sourceCommandes,
    renseigne: true,
  });

  const fg = D({
    cle: "fg", label: "Frais généraux", format: "euro",
    valeur: fgChantier, valeurTexte: eur(fgChantier),
    sousLabel: `${texteTauxReel} × ${heuresReellesTotalChantier.toFixed(0)}h réelles`,
    formule: FORMULE.fg,
    calculDetaille: `${fmtH(heuresReellesTotalChantier)}h réelles × ${texteTauxReel} = ${eur(fgChantier)}`,
    ventilation: fgVentilation,
    titre: "Frais généraux",
    sousTitre: `${texteTauxReel} × ${heuresReellesTotalChantier.toFixed(0)}h réelles`,
    vide: "Aucune heure réelle pointée.",
    totalLabel: "Total frais généraux",
    source: "Taux de frais généraux datés (Admin) × registre de pointage",
    renseigne: true,
  });

  // Ancienne « marge nette » = BUDGET RESTANT (étape 2, 24/10/2026) : vendu −
  // coûts engagés. Ce n'est pas une marge (un chantier à 0 % affichait 99 %).
  // `marge` reste exporté sous ce nom pour les appelants, avec le libellé
  // « Budget restant » ; « Marge % » sur cette base a disparu.
  const marge = D({
    cle: "budgetRestant", label: "Budget restant", format: "euro",
    valeur: margeChantier,
    valeurTexte: signeEur(margeChantier),
    sousLabel: "Vendu − coûts engagés · ce n'est pas une marge",
    formule: FORMULE.budgetRestant,
    calculDetaille: `${eur(prixHTChantier)} − ${eur(coutMOTotalChantier)} − ${eur(coutMatChantier)} − ${eur(fgChantier)} = ${eur(margeChantier)}`,
    ventilation: margeVentilation,
    titre: "Budget restant",
    sousTitre: "Ce qu'il reste du prix de vente une fois payés les coûts engagés",
    totalLabel: "Budget restant",
    totalTexte: signeEur(margeChantier),
    source: "Ouvrages du phasage, registre de pointage, lignes de commande, taux de frais généraux (Admin)",
    warnings: warnings.filter(w => w.code === "ouvrages_sans_prix"),
    renseigne: prixHTChantier > 0,
  });
  // Part du vendu restant (plus présentée comme un % de marge).
  const margePct = D({
    cle: "budgetRestantPct", label: "Budget restant (% du vendu)", format: "pourcent",
    valeur: margePctChantier,
    valeurTexte: `${margePctChantier.toFixed(1)}%`,
    formule: FORMULE.budgetRestant,
    calculDetaille: prixHTChantier > 0
      ? `${eur(margeChantier)} ÷ ${eur(prixHTChantier)} × 100 = ${margePctChantier.toFixed(1)} %`
      : "Vendu HT à 0 → pourcentage non calculable.",
    source: "Dérivé du budget restant",
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
    calculDetaille: `${eur(prixHTChantier)} − (${eur(coutMOTotalChantier)} + ${fmtH(heuresRestantes)}h × ${tauxMOPrevEff} €/h) − (${eur(coutMatChantier)} + ${eur(resteACommanderVal)}) − ${eur(fgProjete)} (FG projetés) = ${eur(margeATerminaisonVal)}`,
    ventilation: [
      { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(prixHTChantier)}`, rightColor: "#22c55e" },
      { main: "Coût MO réel", sub: "déjà pointé", right: `− ${eur(coutMOTotalChantier)}`, rightColor: "#e15a5a" },
      { main: "MO restante estimée", sub: `${fmtH(heuresRestantes)}h × ${tauxMOPrevEff} €/h`, right: `− ${eur(heuresRestantes * tauxMOPrevEff)}`, rightColor: "#e15a5a" },
      { main: "Matériaux réels", sub: "commandes passées", right: `− ${eur(coutMatChantier)}`, rightColor: "#e15a5a" },
      { main: "Reste à commander", sub: "enveloppes matériaux des lots non consommées", right: `− ${eur(resteACommanderVal)}`, rightColor: "#e15a5a" },
      { main: "Frais généraux projetés", sub: `${eur(fgChantier)} déjà engagés + ${fmtH(heuresRestantes)}h restantes × ${fmtTauxFG(tauxFGActuel)}`, right: `− ${eur(fgProjete)}`, rightColor: "#e15a5a" },
    ],
    titre: "Marge à terminaison",
    sousTitre: "Projection : marge restante si les heures restantes coûtent le taux prévisionnel",
    totalLabel: "Marge à terminaison",
    totalTexte: `${margeATerminaisonVal >= 0 ? "+" : ""}${eur(margeATerminaisonVal)}`,
    source: "Registre de pointage, tâches restantes, commandes, enveloppes matériaux des lots, taux de frais généraux (Admin)",
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

  // Ventilation par lot : enveloppe, commandé, reste (ou « achats terminés »).
  const resteVentilation = enveloppes.lots
    .filter(l => l.enveloppe > 0.5 || l.commandes > 0.5)
    .map(l => ({
      main: l.label,
      sub: `enveloppe ${eur(l.enveloppe)} · commandé ${eur(l.commandes)}`
        + (l.achatsTermines ? " · achats terminés" : "")
        + (l.depassement ? ` · dépassement +${eur(l.depassement.euros)}${l.depassement.pct != null ? ` (+${l.depassement.pct.toFixed(0)} %)` : ""}` : ""),
      right: eur(l.reste),
      rightColor: l.depassement ? "#e15a5a" : null,
      lotId: l.lotId, valeur: l.reste,
    }));
  if (enveloppes.commandesSansLot > 0.5) {
    resteVentilation.push({ main: "Commandes de matériaux sans lot", sub: `${enveloppes.nbLignesSansLot} ligne${enveloppes.nbLignesSansLot > 1 ? "s" : ""} · ${eur(enveloppes.commandesSansLot)}`,
      right: `− ${eur(enveloppes.deductionSansLot)}`, rightColor: "#f5a623", lotId: null, valeur: 0 - enveloppes.deductionSansLot });
  }
  const resteACommander = D({
    cle: "resteACommander", label: "Reste à commander", format: "euro", projection: true,
    valeur: resteACommanderVal,
    valeurTexte: eur(resteACommanderVal),
    sousLabel: "Projection · enveloppes matériaux non consommées",
    formule: FORMULE.resteACommander,
    calculDetaille: `${eur(enveloppes.resteLots)} restant sur les enveloppes des lots`
      + (enveloppes.commandesSansLot > 0.5 ? ` − ${eur(enveloppes.deductionSansLot)} de commandes sans lot` : "")
      + ` = ${eur(resteACommanderVal)}`,
    ventilation: resteVentilation,
    enveloppes,
    titre: "Reste à commander",
    sousTitre: "Même calcul que la page Commandes à passer",
    vide: "Aucun coût matériaux prévu sur les ouvrages ni commande de matériaux.",
    totalLabel: "Reste à commander",
    source: "Coûts matériaux prévus des ouvrages vs lignes de commande (nature matériaux)",
    warnings: enveloppes.warnings,
    renseigne: true,
  });

  // ── Trois marges (étape 2) ──
  const fmtCoef = (c) => `×${(Math.round(c * 100) / 100).toLocaleString("fr-FR")}`;
  const reprisTexte = repris ? " · chantier repris" : "";
  const matImputesVentilation = matImputes.lots
    .filter(l => l.enveloppe > 0.5 || l.commandes > 0.5)
    .map(l => ({ main: l.label,
      sub: `commandé ${eur(l.commandes)} · enveloppe ${eur(l.enveloppe)} · consommé à l'avancement ${eur(l.consomme)}`
        + (l.enAvance > 0.5 ? ` · ${eur(l.enAvance)} en avance` : ""),
      right: eur(l.impute) }));
  if (matImputes.sansLot > 0.5) matImputesVentilation.push({ main: "Matériaux sans lot", sub: "imputés directement", right: eur(matImputes.sansLot) });
  if (Math.abs(matImputes.autresNatures) > 0.5) matImputesVentilation.push({ main: "Sous-traitance, location, bennes, autres", sub: "imputés directement", right: eur(matImputes.autresNatures) });

  const margeAvancement = D({
    cle: "margeAvancement", label: "Marge à l'avancement", format: "euro",
    valeur: margeAvancementVal,
    valeurTexte: signeEur(margeAvancementVal),
    sousLabel: (productionCumuleeVal > 0 ? `${(margeAvancementVal / productionCumuleeVal * 100).toFixed(1)} % de la production` : "Production − coûts imputés") + reprisTexte,
    formule: FORMULE.margeAvancement,
    calculDetaille: `${eur(productionCumuleeVal)} produits − ${eur(coutMOTotalChantier)} main-d'œuvre − ${eur(fgChantier)} frais généraux − ${eur(matImputes.impute)} matériaux et autres coûts imputés = ${signeEur(margeAvancementVal)}`
      + (matImputes.enAvance > 0.5 ? ` (${eur(matImputes.enAvance)} de matériaux en avance sur chantier non imputés)` : ""),
    ventilation: [
      { main: "Production", sub: "prix de chaque ouvrage × son avancement exact", right: `+ ${eur(productionCumuleeVal)}`, rightColor: "#22c55e" },
      { main: "Coût main d'œuvre", sub: "tâches + trajets + indirect", right: `− ${eur(coutMOTotalChantier)}`, rightColor: "#e15a5a" },
      { main: "Frais généraux", sub: `${texteTauxReel} × heures réelles`, right: `− ${eur(fgChantier)}`, rightColor: "#e15a5a" },
      { main: "Matériaux et autres coûts imputés", sub: matImputes.enAvance > 0.5 ? `${eur(matImputes.enAvance)} de matériaux en avance non imputés` : "à l'avancement de chaque lot", right: `− ${eur(matImputes.impute)}`, rightColor: "#e15a5a" },
      ...matImputesVentilation.map(r => ({ ...r, main: `↳ ${r.main}` })),
    ],
    titre: "Marge à l'avancement",
    sousTitre: "Le constat : ce que le travail fait a rapporté, moins ce qu'il a coûté",
    totalLabel: "Marge à l'avancement",
    totalTexte: signeEur(margeAvancementVal),
    source: "Avancement des tâches, prix des ouvrages, registre de pointage, lignes de commande, enveloppes matériaux des lots, taux de frais généraux (Admin)",
    warnings: repris ? [{ code: "chantier_repris", gravite: "info", message: "Chantier repris : démarré avant l'application, ses données d'origine ne sont pas fiables." }] : [],
    renseigne: prixHTChantier > 0,
  });
  const materiauxEnAvance = D({
    cle: "materiauxEnAvance", label: "Matériaux en avance sur chantier", format: "euro",
    valeur: matImputes.enAvance, valeurTexte: eur(matImputes.enAvance),
    sousLabel: "Achats anticipés, dans l'enveloppe du lot",
    formule: FORMULE.materiauxEnAvance,
    calculDetaille: `${eur(matImputes.commandes)} commandés − ${eur(matImputes.impute)} imputés = ${eur(matImputes.enAvance)} en avance`,
    ventilation: matImputesVentilation,
    titre: "Matériaux en avance sur chantier",
    vide: "Aucune commande.",
    source: "Lignes de commande + enveloppes matériaux des lots + avancement",
    renseigne: true,
  });
  const lotsAvecCoef = lotsOut.filter(l => !l.vide && l.heuresRestantesPrevues > 0.05);
  const margeProbable = D({
    cle: "margeProbable", label: "Marge probable", format: "euro", projection: true,
    valeur: margeProbableVal,
    valeurTexte: signeEur(margeProbableVal),
    sousLabel: `Projection · si on continue au rythme actuel${reprisTexte}`,
    formule: FORMULE.margeProbable,
    calculDetaille: `${signeEur(margeATerminaisonVal)} (marge à terminaison) − ${eur(ecartProbableTotal)} (heures restantes corrigées de la dérive : ${fmtH(heuresRestantes)} h prévues → ${fmtH(heuresRestantesProbables)} h probables × ${fmtTauxFG(tauxHoraireProjete)}) = ${signeEur(margeProbableVal)}`,
    ventilation: [
      { main: "Marge à terminaison", sub: "si le reste se passe comme le devis", right: signeEur(margeATerminaisonVal) },
      ...lotsAvecCoef.map(l => ({
        main: l.label,
        sub: `${fmtH(l.heuresRestantesPrevues)} h restantes ${fmtCoef(l.coefficient)} = ${fmtH(l.heuresRestantesProbables)} h · ${LIBELLES_PROVENANCE_COEF[l.provenanceCoefficient]}`
          + (l.neutralisation ? ` (« ${l.neutralisation.commentaire} »)` : ""),
        right: `${l.ecartProbableEuros > 0.5 ? "− " : l.ecartProbableEuros < -0.5 ? "+ " : ""}${eur(Math.abs(l.ecartProbableEuros))}`,
        rightColor: l.ecartProbableEuros > 0.5 ? "#e15a5a" : l.ecartProbableEuros < -0.5 ? "#22c55e" : null,
        lotId: l.id, valeur: l.ecartProbableEuros ? -l.ecartProbableEuros : 0,
      })),
    ],
    titre: "Marge probable",
    sousTitre: "Projection : marge à terminaison corrigée de la dérive de chaque lot",
    totalLabel: "Marge probable",
    totalTexte: signeEur(margeProbableVal),
    source: "Marge à terminaison + dérives des lots (constatées, historiques ou neutralisées) + réglages Admin",
    renseigne: prixHTChantier > 0,
  });
  const budgetRestant = marge;

  return {
    venduHT, ecartVendu, moPrev, matPrev, margePrev, moReel, matReel, fg, marge, margePct,
    heuresVendues, heuresReelles, avancement, trajets, indirect, reprise,
    // Trois marges (étape 2) + budget restant (ancienne « marge nette »).
    margeAvancement, materiauxEnAvance, margeProbable, budgetRestant,
    repris,
    // Projections (étape 6) — à afficher distinctement des chiffres à date.
    resteAFaire, margeATerminaison, situationAFacturer, resteACommander,
    lots: lotsOut,
    phases: phasesOut,
    meta: { margeCible, seuilPrime, prime },
    warnings,
    fraicheur,
    // Scalaires bruts (pratiques pour les tests et les snapshots) — mêmes
    // valeurs que les Donnee ci-dessus, sans habillage.
    brut: {
      prixHTChantier, heuresVenduesChantier, heuresReellesChantier,
      heuresReellesTotalChantier, coutMOChantier, coutMOTotalChantier,
      heuresHorsDevisChantier, heuresComparablesChantier,
      coutMatChantier, commandesPrevChantier, moPrevChantier, tauxMOPrevEff,
      // fgTauxHoraire = taux en vigueur aujourd'hui (celui des projections) ;
      // le barème complet reste dans fgBareme.
      fgTauxHoraire, fgBareme: baremeFG, fgChantier, margeChantier, margePctChantier,
      fgPrevChantier, deboursePrevChantier, margePrevChantier, margePrevPctChantier,
      avancementChantier: avancementGlobal,
      deriveChantier,
      extras, repriseHeures, repriseTaux, repriseCout,
      trajetHeures: trajet.heures, trajetCout: trajet.cout,
      indirectHeures: indirectHT.heures, indirectCout: indirectHT.cout,
      montantDevis, ecartVendu: ecartVenduVal,
      heuresRestantes, resteAFaireEuros, fgProjete,
      margeATerminaison: margeATerminaisonVal,
      situationAFacturer: situationVal,
      resteACommander: resteACommanderVal,
      coutMatParNature, enveloppesMateriaux: enveloppes,
      // Trois marges (étape 2)
      productionCumulee: productionCumuleeVal, materiauxImputes: matImputes.impute,
      materiauxEnAvance: matImputes.enAvance, materiauxImputesDetail: matImputes,
      coutsImputes, margeAvancement: margeAvancementVal,
      margeProbable: margeProbableVal, ecartProbableTotal, heuresRestantesProbables,
      budgetRestant: budgetRestantVal,
      heuresSansLot, pctSansLot, heuresBaseSansLot,
      repris: repris != null, seuilsMarges: seuilsM,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARGE DE LA PÉRIODE — Bilan semaine (13/10/2026, refondue le 24/10/2026).
//
//   marge de la période = marge à l'avancement en fin de période
//                       − marge à l'avancement en début de période
//
// (étape 2 de la refonte des marges) : la marge de la semaine et la marge
// cumulée sont ainsi toujours cohérentes entre elles — la somme des marges des
// semaines est la marge à l'avancement.
//
// La période va du relevé de début (EXCLU) au relevé de fin (INCLUS) :
//   - production : journal d'avancement daté (étape 1C, paramètre `journal`),
//     Σ ouvrage par ouvrage de prix × avancement exact gagné, sans arrondi —
//     c'est aussi le « Généré » du bilan ;
//   - main-d'œuvre et frais généraux : différence des cumuls, soit exactement
//     les heures pointées DATÉES de la période (taux figé, taux FG de leur date) ;
//   - matériaux : variation des matériaux IMPUTÉS À L'AVANCEMENT (un achat
//     anticipé dans l'enveloppe du lot ne pèse que quand le lot avance), plus
//     les autres natures (sous-traitance, location, bennes) datées de la
//     période (date du document fournisseur, sinon date de saisie).
// Sans journal (ancien appelant) : production = prix vendu × points gagnés
// entre les deux relevés, coûts datés de la période (méthode du 13/10/2026).
// Une marge qu'on ne peut pas calculer reste null avec sa raison — jamais 0.
// ─────────────────────────────────────────────────────────────────────────────

// Date d'imputation d'une ligne de commande (AAAA-MM-JJ) : date du document
// fournisseur (commandes.date_doc), à défaut date de saisie de la ligne.
export function dateImputationLigne(l) {
  const d = l?.date_doc || l?.commande?.date_doc || l?.created_at || null;
  return d ? String(d).slice(0, 10) : null;
}
const datePointage = (p) => (p?.date ? String(p.date).slice(0, 10) : null);
// Période (du, au] : du null = depuis le début, au null = sans limite.
const dansPeriode = (d, du, au) => d != null && (du == null || d > du) && (au == null || d <= au);
// Arrêt à une date : une donnée sans date reste comptée (on ne sait pas la
// dater ; elle se retrouve dans les deux cumuls d'une période et s'annule).
const avantFin = (d, au) => au == null || d == null || d <= au;
const dateFr = (iso) => String(iso).split("-").reverse().join("/");
const signe = (n) => `${n >= 0 ? "+" : ""}${eur(n)}`;

export function libellePeriodeMarge(du, au) {
  const debut = du ? `après le relevé du ${dateFr(du)}` : "depuis le début du chantier";
  const fin = au ? `jusqu'au relevé du ${dateFr(au)}` : "jusqu'à aujourd'hui";
  return `${debut}, ${fin}`;
}

// MARGE À L'AVANCEMENT À UNE DATE (fin de journée ; null = aujourd'hui) :
// production cumulée exacte − coûts réels imputés arrêtés à cette date.
// Rend { produit, mo, fg, materiaux (imputés + autres natures), enAvance,
// marge } ou null (avec `raison`) si l'avancement est inconnu à cette date.
export function margeAvancementALaDate({
  phasage, pointages = [], commandeLignes = [], tauxHoraires = {}, tauxMOPrev = 0, lots = [],
  tauxFG = null, journal = [], date = null,
} = {}) {
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const lignes = (commandeLignes || []).filter(l => avantFin(dateImputationLigne(l), date));
  const fin = computeChantierFinance({
    phasage,
    pointages: (pointages || []).filter(p => avantFin(datePointage(p), date)),
    commandeLignes: lignes,
    tauxHoraires, tauxMOPrev, lots, tauxFG,
  });
  const etat = date == null ? null : etatTachesALaDate(journal, date);
  const produit = productionCumulee(ouvrages, etat);
  const mat = materiauxImputesALAvancement({ ouvrages, commandeLignes: lignes, lots, etat });
  if (produit == null || mat == null) {
    const debut = debutJournal(journal);
    return { inconnu: true, raison: `Avancement inconnu au ${dateFr(date)}${debut ? ` : le journal d'avancement de ce chantier commence le ${dateFr(debut)}.` : "."}` };
  }
  const mo = fin.brut.coutMOTotalChantier;
  const fg = fin.brut.fgChantier;
  return { produit, mo, fg, materiaux: mat.impute, enAvance: mat.enAvance, commandes: mat.commandes, marge: produit - mo - fg - mat.impute };
}

export function margeReelleSemaine({
  phasage,             // ligne phasages (ouvrages, plan_travaux…)
  pointages = [],      // TOUS les pointages du chantier (filtrés ici par date)
  commandeLignes = [], // TOUTES les lignes du chantier, avec created_at et commande.date_doc
  tauxHoraires = {}, tauxMOPrev = 0, lots = [], // pour la marge à l'avancement
  tauxFG = null,          // barème daté des frais généraux (absent = TAUX_FG_DEFAUT)
  prixVendu = 0,          // prix vendu utilisé par le « Généré » du bilan
  avancementDebut = null, // % au relevé de début (0 pour un chantier nouveau)
  avancementFin = null,   // % au relevé de fin, ou actuel si la semaine est en cours ; null = inconnu
  du = null,              // date du relevé de début, EXCLUE (null = depuis le début)
  au = null,              // date du relevé de fin, INCLUSE (null = jusqu'à aujourd'hui)
  journal = null,         // lignes du journal d'avancement du chantier (étape 1C) ; fourni → marge à l'avancement
} = {}) {
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const baremeFG = normaliserBaremeFG(tauxFG);
  const vendu = parseFloat(prixVendu) || 0;

  // ── Heures et lignes de la période (affichage, et seule base sans journal) ──
  // Même périmètre que le coût MO total : pointages des tâches du plan,
  // pointages libres et indirects. Les heures d'une tâche supprimée du
  // phasage n'y sont pas — elles sont signalées, pas comptées.
  const idsTaches = new Set();
  ouvrages.forEach(o => (o.taches || []).forEach(t => { if (t?.id != null) idsTaches.add(String(t.id)); }));
  const compte = (p) => p.type_pointage === "indirect" || !p.tache_id || idsTaches.has(String(p.tache_id));
  const ptsPeriode = (pointages || []).filter(p => dansPeriode(datePointage(p), du, au));
  const ptsComptes = ptsPeriode.filter(compte);
  const heures = sumHeures(ptsComptes);
  const heuresHorsPlan = sumHeures(ptsPeriode.filter(p => !compte(p)));
  const lignesPeriode = (commandeLignes || []).filter(l => dansPeriode(dateImputationLigne(l), du, au));
  const tauxFGVus = new Set();
  const fgPeriodeDate = fgDePointages(ptsComptes, baremeFG, tauxFGVus);
  const texteTauxPeriode = texteTauxFG(tauxFGVus.size > 0 ? tauxFGVus : [tauxFGALaDate(baremeFG, au)]);

  const avDebut = avancementDebut == null ? NaN : parseFloat(avancementDebut);
  const avFin = avancementFin == null ? NaN : parseFloat(avancementFin);
  const avConnus = Number.isFinite(avDebut) && Number.isFinite(avFin);
  const points = avConnus ? avFin - avDebut : null;
  const modeJournal = Array.isArray(journal);
  const venduOuvrages = ouvrages.reduce((s, o) => s + prixHTOuvrage(o), 0);

  let produit = null, mo, fg, materiaux, raison = null, prodPeriode = null, cumul = null, enAvanceFin = null;
  if (modeJournal) {
    // ── Marge à l'avancement à la fin, puis au début de la période ──
    const base = { phasage, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots, tauxFG: baremeFG, journal };
    const aFin = margeAvancementALaDate({ ...base, date: au });
    const aDebut = du == null
      ? { produit: 0, mo: 0, fg: 0, materiaux: 0, enAvance: 0, marge: 0 }
      : margeAvancementALaDate({ ...base, date: du });
    prodPeriode = productionPeriode({ ouvrages, journal, du, au });
    // Coûts de la période : différence des cumuls (connue même si
    // l'avancement du début ne l'est pas — les coûts, eux, sont datés).
    const coutsA = (date) => {
      if (date === undefined) return { mo: 0, fg: 0 };
      const f = computeChantierFinance({
        phasage, tauxHoraires, tauxMOPrev, lots, tauxFG: baremeFG,
        pointages: (pointages || []).filter(p => avantFin(datePointage(p), date)),
        commandeLignes: [],
      });
      return { mo: f.brut.coutMOTotalChantier, fg: f.brut.fgChantier };
    };
    if (!aFin.inconnu && !aDebut.inconnu) {
      mo = aFin.mo - aDebut.mo; fg = aFin.fg - aDebut.fg; materiaux = aFin.materiaux - aDebut.materiaux;
    } else {
      const cf = coutsA(au), cd = du == null ? { mo: 0, fg: 0 } : coutsA(du);
      mo = cf.mo - cd.mo; fg = cf.fg - cd.fg; materiaux = totalLignes(lignesPeriode);
    }
    raison = !(venduOuvrages > 0) ? "Chantier sans prix de vente : la production ne peut pas être chiffrée."
      : aFin.inconnu ? aFin.raison
      : aDebut.inconnu ? aDebut.raison
      : null;
    if (raison == null) produit = aFin.produit - aDebut.produit;
    if (venduOuvrages > 0 && !aFin.inconnu) {
      cumul = { produit: aFin.produit, mo: aFin.mo, materiaux: aFin.materiaux, fg: aFin.fg, enAvance: aFin.enAvance, marge: aFin.marge };
      enAvanceFin = aFin.enAvance;
    }
  } else {
    // ── Ancienne méthode (sans journal) : coûts datés de la période ──
    mo = sumCoutMO(ptsComptes);
    fg = fgPeriodeDate;
    materiaux = totalLignes(lignesPeriode);
    raison = !avConnus
      ? "Relevé d'avancement de fin de semaine absent : la production de la semaine n'est pas connue."
      : !(vendu > 0) ? "Chantier sans prix de vente : la production ne peut pas être chiffrée." : null;
    if (raison == null) {
      produit = Math.round(vendu * points / 100);
      const f = computeChantierFinance({
        phasage, tauxHoraires, tauxMOPrev, lots, tauxFG: baremeFG,
        pointages: (pointages || []).filter(p => avantFin(datePointage(p), au)),
        commandeLignes: (commandeLignes || []).filter(l => avantFin(dateImputationLigne(l), au)),
      });
      const b = f.brut;
      const produitCumul = Math.round(vendu * avFin / 100);
      cumul = { produit: produitCumul, mo: b.coutMOTotalChantier, materiaux: b.coutMatChantier, fg: b.fgChantier,
        marge: produitCumul - b.coutMOTotalChantier - b.coutMatChantier - b.fgChantier };
    }
  }
  const calculable = raison == null;
  const couts = mo + materiaux + fg;
  const marge = calculable ? produit - couts : null;

  const warnings = [];
  if (heuresHorsPlan > 0.05) {
    warnings.push({
      code: "heures_hors_plan", gravite: "info",
      message: `${fmtH(heuresHorsPlan)} h pointées sur des tâches qui ne sont plus dans le phasage : non comptées.`,
    });
  }

  // ── Ventilation : les 4 postes, puis le détail des achats et des heures ──
  const periode = libellePeriodeMarge(du, au);
  const periodeTitre = periode.charAt(0).toUpperCase() + periode.slice(1);
  const ventilation = [
    { main: "Production", sub: modeJournal
        ? (prodPeriode.valeur != null
            ? `${prodPeriode.parOuvrage.length} ouvrage${prodPeriode.parOuvrage.length > 1 ? "s ont" : " a"} avancé · prix × avancement gagné, à la date de réalisation`
            : prodPeriode.raison)
        : avConnus
          ? `${avDebut} % → ${avFin} % (${points >= 0 ? "+" : ""}${points} pt${Math.abs(points) > 1 ? "s" : ""}) × ${eur(vendu)}`
          : "relevé de fin absent",
      right: produit != null ? signe(produit) : "—", rightColor: produit != null && produit < 0 ? "#e15a5a" : "#22c55e" },
    { main: "Main-d'œuvre", sub: `${fmtH(heures)} h pointées × taux de chaque ouvrier`, right: `− ${eur(mo)}`, rightColor: "#e15a5a" },
    { main: "Matériaux", sub: modeJournal
        ? `imputés à l'avancement des lots (+ sous-traitance, location, bennes datées de la période) · ${lignesPeriode.length} ligne${lignesPeriode.length > 1 ? "s" : ""} de commande datée${lignesPeriode.length > 1 ? "s" : ""} de la période`
        : `${lignesPeriode.length} ligne${lignesPeriode.length > 1 ? "s" : ""} de commande datée${lignesPeriode.length > 1 ? "s" : ""} de la période`,
      right: `${materiaux < 0 ? "+ " : "− "}${eur(Math.abs(materiaux))}`, rightColor: "#e15a5a" },
    { main: "Frais généraux", sub: `${fmtH(heures)} h × ${texteTauxPeriode}`, right: `− ${eur(fg)}`, rightColor: "#e15a5a" },
  ];
  // Détail de la production par ouvrage (journal daté).
  if (modeJournal && prodPeriode.valeur != null) {
    [...prodPeriode.parOuvrage].sort((a, b) => b.production - a.production).forEach(p => {
      ventilation.push({ main: `↳ ${p.libelle}`,
        sub: `${p.avDebut.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % → ${p.avFin.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % × ${eur(p.prix)}`,
        right: signe(p.production) });
    });
  }
  const achats = {};
  lignesPeriode.forEach(l => {
    const fournisseur = l?.commande?.fournisseur_nom || "Fournisseur non renseigné";
    const date = dateImputationLigne(l);
    const k = `${date}|${fournisseur}`;
    if (!achats[k]) achats[k] = { fournisseur, date, montant: 0 };
    achats[k].montant += totalLignes([l]);
  });
  Object.values(achats).sort((a, b) => b.montant - a.montant).forEach(a => {
    ventilation.push({ main: `↳ ${a.fournisseur}`, sub: `commande du ${dateFr(a.date)}${modeJournal ? " (imputée selon l'avancement du lot)" : ""}`, right: eur(a.montant) });
  });
  const parOuvrier = {};
  ptsComptes.forEach(p => {
    const nom = p.ouvrier || "?";
    if (!parOuvrier[nom]) parOuvrier[nom] = { nom, heures: 0, cout: 0 };
    parOuvrier[nom].heures += parseFloat(p.heures) || 0;
    parOuvrier[nom].cout += (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0);
  });
  Object.values(parOuvrier).sort((a, b) => b.cout - a.cout).forEach(o => {
    ventilation.push({ main: `↳ ${o.nom}`, sub: `${fmtH(o.heures)} h pointées`, right: `− ${eur(o.cout)}` });
  });

  const source = modeJournal
    ? "Journal d'avancement daté, registre de pointage, lignes de commande, enveloppes matériaux des lots, taux de frais généraux (Admin)"
    : "Relevés d'avancement hebdomadaires, registre de pointage, lignes de commande, taux de frais généraux (Admin)";
  const semaine = {
    cle: "margeSemaine", label: "Marge de la période", format: "euro",
    valeur: marge,
    valeurTexte: calculable ? signe(marge) : "non calculable",
    sousLabel: calculable ? periodeTitre : raison,
    formule: FORMULE.margeSemaine,
    calculDetaille: calculable
      ? `${eur(produit)} produits − ${eur(mo)} main-d'œuvre − ${eur(materiaux)} matériaux${modeJournal ? " imputés" : ""} − ${eur(fg)} frais généraux = ${signe(marge)}`
      : raison,
    ventilation,
    titre: "Marge de la période",
    sousTitre: periodeTitre,
    vide: null,
    totalLabel: "Marge de la période",
    totalTexte: calculable ? signe(marge) : "non calculable",
    // Non calculable : la raison passe en premier (c'est elle que l'infobulle montre).
    source, fraicheur: null, renseigne: calculable,
    warnings: calculable ? warnings : [{ code: "marge_non_calculable", gravite: "alerte", message: raison }, ...warnings],
  };
  const cumulee = cumul == null ? null : {
    cle: "margeCumulee", label: "Marge à l'avancement", format: "euro",
    valeur: cumul.marge,
    valeurTexte: signe(cumul.marge),
    sousLabel: au ? `Au relevé du ${dateFr(au)}` : "À ce jour",
    formule: FORMULE.margeCumulee,
    calculDetaille: `${eur(cumul.produit)} produits (${modeJournal ? "prix de chaque ouvrage × son avancement exact" : `${avFin} % × ${eur(vendu)}`}) − ${eur(cumul.mo)} main-d'œuvre − ${eur(cumul.materiaux)} matériaux${modeJournal ? " imputés" : ""} − ${eur(cumul.fg)} frais généraux = ${signe(cumul.marge)}`
      + (cumul.enAvance > 0.5 ? ` (${eur(cumul.enAvance)} de matériaux en avance sur chantier non imputés)` : ""),
    ventilation: [
      { main: "Production cumulée", sub: modeJournal ? "prix de chaque ouvrage × son avancement exact" : `${avFin} % × ${eur(vendu)}`, right: signe(cumul.produit), rightColor: "#22c55e" },
      { main: "Main-d'œuvre", sub: "tous les pointages + reprise d'antériorité", right: `− ${eur(cumul.mo)}`, rightColor: "#e15a5a" },
      { main: "Matériaux", sub: modeJournal ? "imputés à l'avancement des lots + autres coûts" : "toutes les commandes datées jusqu'à la fin de la période", right: `− ${eur(cumul.materiaux)}`, rightColor: "#e15a5a" },
      { main: "Frais généraux", sub: "heures totales × taux en vigueur à leur date", right: `− ${eur(cumul.fg)}`, rightColor: "#e15a5a" },
    ],
    titre: "Marge à l'avancement",
    sousTitre: au ? `Au relevé du ${dateFr(au)}` : "À ce jour",
    vide: null,
    totalLabel: "Marge à l'avancement",
    totalTexte: signe(cumul.marge),
    source, fraicheur: null, warnings: [], renseigne: true,
  };

  return {
    calculable, raison, du, au,
    avancementDebut: avConnus ? avDebut : null, avancementFin: avConnus ? avFin : null,
    points, prixVendu: vendu, produit,
    // Production détaillée (journal daté) : ouvrages qui ont avancé, ouvrages inconnus.
    production: prodPeriode, modeJournal,
    heures, mo, materiaux, fg, couts, marge,
    heuresHorsPlan, nbLignesMateriaux: lignesPeriode.length, materiauxEnAvanceFin: enAvanceFin,
    cumul, warnings, semaine, cumulee,
  };
}
