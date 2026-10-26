// src/Renovation/avancementIncoherentV1.mjs — écart « avancement incohérent »
// à la validation des comptes rendus (CR-6, cahier §2). Module PUR : aucune
// lecture de base, aucune horloge ; les données arrivent en paramètre.
// Façade front : avancementIncoherentV1.js. La page « Qualité des comptes
// rendus » (CR-6E) réutilise ecartsAvancementIncoherentRapport pour compter
// ces écarts par ouvrier : même fonction, même texte.
//
// Trois cas, sur une tâche d'un compte rendu (écart ORANGE) :
//   1. avancement déclaré nettement en avance sur les heures :
//      (heures avant + heures du jour) ÷ (heures prévues × avancement déclaré)
//      < ratioHeuresMin (0,5), pour une tâche d'au moins heuresPrevuesMin (2 h)
//      prévues, et seulement si la déclaration FAIT avancer la tâche (un
//      avancement inchangé n'est pas reproché au compte rendu du jour) ;
//   2. l'avancement gagne au moins gainSansHeuresPts (25) points alors que
//      personne n'a pointé d'heure sur la tâche ce jour-là ;
//   3. une tâche terminée (avancement du phasage à 100 % la veille, d'après le
//      journal d'avancement) est déclarée « en cours » — désactivable.
//      « Pas commencé / pas avancé aujourd'hui » (statut non_faite) ne
//      déclenche PAS ce cas : il laisse l'avancement inchangé, il ne dit pas
//      que la tâche est moins avancée.
//
// Définitions (les mêmes que la barre de budget du détail, CR-5) :
//   heures avant   : pointages de la tâche datés AVANT le jour du compte rendu
//                    (registre des pointages, type « tâche ») ;
//   heures du jour : heures déclarées sur la tâche ce jour-là par TOUTES les
//                    personnes (tous les comptes rendus du jour) ;
//   heures prévues : heures prévues de la tâche dans le phasage ;
//   avancement déclaré : Terminée = 100 ; En cours = le pourcentage déclaré ;
//                    tâche suivie en quantité = l'avancement calculé depuis la
//                    quantité posée (fourni par l'appelant).
// Une donnée manquante (null) : le cas qui en a besoin ne se déclenche pas.
// Une tâche bloquée n'est pas contrôlée ici (déjà « à arbitrer », rouge).

import { tacheHeuresVendues, etatTachesALaDate } from "../chantierFinance.mjs";
import { lignesDepuisRapport, suiviPourValidation, quantiteEffective, apresValidation } from "./lignesValidation.mjs";
import { quantiteValide } from "./suiviQuantite.mjs";

const nombre = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const net = (s) => String(s ?? "").trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const r2 = (x) => Math.round(x * 100) / 100;
const fmtH = (h) => {
  const v = r2(h);
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
};
const pct = (a) => `${Math.round(a)} %`;
const etatTexte = (a) => (a >= 100 ? "terminée" : pct(a));

// ── Réglages (Admin → Taux horaires → « Validation des comptes rendus ») ────
// planning_config, clé CLE_CONFIG_AVANCEMENT_INCOHERENT. Réglage jamais
// enregistré ou illisible = valeurs par défaut.
export const CLE_CONFIG_AVANCEMENT_INCOHERENT = "seuils_avancement_incoherent";
export const SEUILS_AVANCEMENT_INCOHERENT_DEFAUT = Object.freeze({
  ratioHeuresMin: 0.5,       // cas 1 : heures consommées ÷ heures « méritées » en dessous de
  heuresPrevuesMin: 2,       // cas 1 : seulement pour une tâche d'au moins N h prévues
  gainSansHeuresPts: 25,     // cas 2 : gain d'avancement (points) sans heure ce jour-là
  retourTermineeActif: true, // cas 3 : tâche terminée déclarée en cours
});

export function normaliserSeuilsAvancementIncoherent(valeur) {
  const v = valeur && typeof valeur === "object" ? valeur : {};
  const d = SEUILS_AVANCEMENT_INCOHERENT_DEFAUT;
  const pos = (x, def) => { const n = nombre(x); return n != null && n >= 0 ? n : def; };
  return {
    ratioHeuresMin: pos(v.ratioHeuresMin, d.ratioHeuresMin),
    heuresPrevuesMin: pos(v.heuresPrevuesMin, d.heuresPrevuesMin),
    gainSansHeuresPts: pos(v.gainSansHeuresPts, d.gainSansHeuresPts),
    retourTermineeActif: typeof v.retourTermineeActif === "boolean" ? v.retourTermineeActif : d.retourTermineeActif,
  };
}

// ── Une tâche ───────────────────────────────────────────────────────────────
// Avancement déclaré d'une déclaration { statut, avancement } : Terminée = 100,
// En cours = le pourcentage (null s'il n'est pas dit), autre état = null.
export function avancementDeclare(declaration) {
  if (!declaration || declaration.bloque) return null;
  if (declaration.statut === "faite") return 100;
  if (declaration.statut === "en_cours") {
    const a = nombre(declaration.avancement);
    return a == null ? null : Math.max(0, Math.min(100, a));
  }
  return null;
}

// Écart d'une tâche, ou null. Une tâche donne AU PLUS un écart (les cas qui
// se déclenchent sont listés dans `cas` et leurs textes réunis).
//   t = {
//     nom,
//     statut, bloque,                 // déclaration du jour
//     avancementDeclare,              // null = non dit (voir avancementDeclare)
//     avancementAvant,                // phasage la veille ; null = inconnu
//     heuresAvant, heuresJour,        // null = inconnu
//     heuresPrevues,                  // null ou 0 = inconnu
//   }
export function ecartAvancementIncoherent(t, seuils = SEUILS_AVANCEMENT_INCOHERENT_DEFAUT) {
  if (!t || t.bloque) return null;
  const s = normaliserSeuilsAvancementIncoherent(seuils);
  const nom = net(t.nom) || "(sans nom)";
  const decl = nombre(t.avancementDeclare);
  const avant = nombre(t.avancementAvant);
  const hAvant = nombre(t.heuresAvant);
  const hJour = nombre(t.heuresJour);
  const prevues = nombre(t.heuresPrevues);
  const cas = [];
  const textes = [];

  // Cas 1 — avancement en avance sur les heures.
  if (decl != null && decl > 0 && hAvant != null && hJour != null && prevues != null && prevues > 0
      && prevues >= s.heuresPrevuesMin && (avant == null || decl > avant)) {
    const consommees = hAvant + hJour;
    const ratio = consommees / (prevues * decl / 100);
    if (ratio < s.ratioHeuresMin) {
      cas.push(1);
      textes.push(`« ${nom} » déclarée ${decl >= 100 ? "terminée" : `à ${pct(decl)}`} avec ${fmtH(consommees)} h pour ${fmtH(prevues)} h prévues`);
    }
  }

  // Cas 2 — gain d'avancement sans aucune heure ce jour-là.
  if (decl != null && avant != null && hJour != null && hJour <= 0) {
    const gain = decl - avant;
    if (gain > 0 && gain >= s.gainSansHeuresPts) {
      cas.push(2);
      textes.push(`« ${nom} » passe de ${pct(avant)} à ${etatTexte(decl)} (+${Math.round(gain)} points) sans aucune heure pointée dessus ce jour-là`);
    }
  }

  // Cas 3 — tâche terminée qui revient « en cours ».
  if (s.retourTermineeActif && avant != null && avant >= 100 && t.statut === "en_cours" && !(decl != null && decl >= 100)) {
    cas.push(3);
    textes.push(`« ${nom} » était terminée et revient « en cours${decl != null ? ` ${pct(decl)}` : ""} »`);
  }

  if (cas.length === 0) return null;
  return { niveau: "orange", code: "avancement_incoherent", cas, texte: textes.join(" ; ") };
}

// ── Un compte rendu ─────────────────────────────────────────────────────────
// Déclarations d'un compte rendu regroupées par tâche du phasage (plusieurs
// lignes sur la même tâche : heures additionnées ; Terminée l'emporte sur En
// cours, qui l'emporte sur Pas commencé ; avancement le plus haut ; bloquée si
// une ligne l'est). Les lignes sans tâche du phasage sont ignorées.
export function declarationsParTache(rapport) {
  const m = new Map();
  const rang = { faite: 3, en_cours: 2, non_faite: 1 };
  arr(rapport?.taches).forEach(t => {
    if (!t?.tache_id) return;
    const k = String(t.tache_id);
    const nom = net(t?.proposition?.nom) || net(t.planifie) || "(sans nom)";
    const a = nombre(t.avancement);
    const cur = m.get(k);
    if (!cur) {
      m.set(k, { tache_id: k, nom, statut: t.statut || null, bloque: t.bloque === true, avancement: a, heures: nombre(t.heures_reelles) || 0 });
      return;
    }
    cur.heures += nombre(t.heures_reelles) || 0;
    cur.bloque = cur.bloque || t.bloque === true;
    if ((rang[t.statut] || 0) > (rang[cur.statut] || 0)) cur.statut = t.statut;
    if (a != null && (cur.avancement == null || a > cur.avancement)) cur.avancement = a;
  });
  return m;
}

// Heures du jour par tâche, toutes personnes : somme des heures déclarées sur
// chaque tâche dans les comptes rendus du jour (passer TOUS ceux du jour).
export function heuresJourParTache(rapportsDuJour) {
  const out = {};
  arr(rapportsDuJour).forEach(r => arr(r?.taches).forEach(t => {
    if (!t?.tache_id) return;
    const k = String(t.tache_id);
    out[k] = r2((out[k] || 0) + (nombre(t.heures_reelles) || 0));
  }));
  return out;
}

// Écarts « avancement incohérent » d'un compte rendu.
//   ctx = {
//     seuils,                          // planning_config (défauts sinon)
//     donneesParTache: { [tache_id]: { heuresAvant, heuresPrevues, avancementAvant } },
//     heuresJourParTache: { [tache_id]: heures } — voir heuresJourParTache
//                                       (null = inconnu : cas 1 et 2 muets),
//     avancementDeclareParTache: { [tache_id]: % } — tâches suivies en quantité :
//                                       avancement calculé depuis la quantité
//   }
// Tâche absente de donneesParTache : données inconnues, rien ne se déclenche.
export function ecartsAvancementIncoherentRapport(rapport, ctx = {}) {
  const donnees = ctx.donneesParTache || {};
  const hJour = ctx.heuresJourParTache;
  const forces = ctx.avancementDeclareParTache || {};
  const out = [];
  declarationsParTache(rapport).forEach((d, k) => {
    const x = donnees[k];
    if (!x) return;
    const decl = forces[k] != null && d.statut !== "non_faite" && !d.bloque ? nombre(forces[k]) : avancementDeclare(d);
    const e = ecartAvancementIncoherent({
      nom: d.nom, statut: d.statut, bloque: d.bloque, avancementDeclare: decl,
      avancementAvant: x.avancementAvant, heuresAvant: x.heuresAvant, heuresPrevues: x.heuresPrevues,
      heuresJour: hJour == null ? null : (hJour[k] ?? 0),
    }, ctx.seuils);
    if (e) out.push({ ...e, tache_id: k });
  });
  return out;
}

// ── Assemblage des données (le même pour la Validation et la page Qualité) ──
// Veille d'une date ISO (calcul sur la date reçue, aucune horloge).
export function veilleDe(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 1));
  return d.toISOString().slice(0, 10);
}
const estPointageTache = (p) => !p?.type_pointage || p.type_pointage === "tache";
const avantLe = (p, date) => !p?.date || String(p.date).slice(0, 10) < date;

// Données de chaque tâche du phasage (V2, ouvrages) pour le jour `date` :
//   heuresAvant     : Σ heures des pointages « tâche » datés avant `date`
//                     (pointagesAvant null = registre illisible → inconnu) ;
//   heuresPrevues   : heures prévues de la tâche (tacheHeuresVendues, comme
//                     la barre de budget) ; 0 → inconnu ;
//   avancementAvant : avancement à la fin de la veille d'après le journal
//                     d'avancement (etatTachesALaDate) ; tâche jamais modifiée
//                     → son avancement actuel ; journal illisible ou valeur
//                     inconnue (avant le début du journal) → inconnu.
//   ouvrages        : phasage.ouvrages du chantier
//   pointagesAvant  : [{ tache_id, heures, type_pointage, date? }] ou null
//   journal         : lignes d'avancement_journal du chantier ou null
// Tâche suivie en quantité avec un registre illisible : laissée de côté
// (son avancement déclaré ne peut pas être calculé).
export function donneesTachesIncoherence({ ouvrages = [], pointagesAvant = null, journal = null, date } = {}) {
  const veille = veilleDe(date);
  const etat = journal && veille ? etatTachesALaDate(journal, veille) : null;
  const heures = new Map();
  if (pointagesAvant) arr(pointagesAvant).forEach(p => {
    if (p?.tache_id == null || !estPointageTache(p) || !avantLe(p, date)) return;
    const k = String(p.tache_id);
    heures.set(k, (heures.get(k) || 0) + (nombre(p.heures) || 0));
  });
  const out = {};
  arr(ouvrages).forEach(o => arr(o?.taches).forEach(t => {
    if (t?.id == null) return;
    const k = String(t.id);
    if (!pointagesAvant && suiviPourValidation(ouvrages, k, 0)) return;
    const prev = tacheHeuresVendues(t);
    out[k] = {
      heuresAvant: pointagesAvant ? r2(heures.get(k) || 0) : null,
      heuresPrevues: prev > 0 ? prev : null,
      avancementAvant: !etat ? null : etat.has(k) ? etat.get(k) : (nombre(t.avancement) ?? 0),
    };
  }));
  return out;
}

// Avancement déclaré des tâches suivies en quantité d'un compte rendu :
// cumul validé avant `date` (+ point de départ) + quantités déclarées ce jour,
// par la règle de la Validation (suiviPourValidation → apresValidation).
// pointagesAvant : [{ tache_id, quantite_validee, date? }] (null → {}).
export function avancementsQuantiteRapport({ rapport, ouvrages = [], pointagesAvant = null, date } = {}) {
  if (!pointagesAvant) return {};
  const sommes = {};
  arr(pointagesAvant).forEach(p => {
    if (p?.tache_id == null || !avantLe(p, date)) return;
    const q = nombre(p.quantite_validee);
    if (q == null) return;
    const k = String(p.tache_id);
    sommes[k] = (sommes[k] || 0) + q;
  });
  const parTache = new Map();
  lignesDepuisRapport(rapport).forEach(li => {
    if (!li.tache_id || li.bloque) return;
    const k = String(li.tache_id);
    const s = suiviPourValidation(ouvrages, k, sommes[k] || 0);
    if (!s) return;
    const d = quantiteEffective(li, s);
    if (!d) return;
    const cur = parTache.get(k) || { s, validee: 0, terminee: false };
    cur.validee += quantiteValide(d.validee);
    cur.terminee = cur.terminee || !!d.terminee;
    parTache.set(k, cur);
  });
  const out = {};
  parTache.forEach((x, k) => { out[k] = apresValidation(x.s, x.validee, x.terminee).avancement; });
  return out;
}
