// ─────────────────────────────────────────────────────────────────────────────
// Tâches hors devis : réaffecter, intégrer ou arbitrer (refonte, étape 4).
//
// Une tâche hors devis correspond à l'un de ces trois cas :
//   A. « introuvable »    la tâche existait dans le phasage, l'ouvrier ne l'a
//                         pas trouvée → on RÉAFFECTE ses heures à la tâche
//                         existante, sans créer de tâche ;
//   B. « imprevu »        travail imprévu, mais compris dans un ouvrage vendu →
//                         la tâche est ajoutée à l'ouvrage, marquée « ajoutée
//                         en cours de chantier », avec ses heures NORMALES
//                         comme poids (pas les heures réellement passées) ; les
//                         heures prévues de l'ouvrage (heures_devis) ne changent
//                         pas : la dérive reste visible ;
//   C. « demande_client » travail non vendu → « à arbitrer », puis avenant
//                         (rattachée à un ouvrage d'avenant chiffré : elle
//                         produit) ou geste commercial (un coût sans production).
// Les tâches existantes n'ont pas de motif : « non renseigné ».
//
// Tout est stocké DANS la tâche du phasage (phasages.ouvrages[].taches[]) :
//   motif_hd          "introuvable" | "imprevu" | "demande_client"
//   ajoutee_en_cours  true (cas B) + ajoutee_le (AAAA-MM-JJ) + ajoutee_par
//   arbitrage         { statut: "a_arbitrer" | "avenant" | "geste_commercial",
//                       le: AAAA-MM-JJ, par, ouvrage_avenant_id? }   (cas C)
//   hors_devis        true pour C tant qu'elle n'est pas rattachée à un avenant
//                     (règle existante : coût réel, pas d'avancement, pas
//                     comparée aux heures prévues) ; false pour B.
// Un ouvrage peut porter non_facture: true (prix 0, ne produit rien).
//
// Module PUR : aucune dépendance Supabase, aucune horloge (dates en
// paramètre), aucun effet de bord. Façade : horsDevisV2.js.
// ─────────────────────────────────────────────────────────────────────────────

export const DIVERS_HORS_DEVIS_V2 = "Divers / hors devis";

export const MOTIFS_HORS_DEVIS = Object.freeze([
  { code: "introuvable",    cas: "A", label: "Tâche existante non trouvée", question: "Je ne l'ai pas trouvée",
    explication: "La tâche existait dans le phasage : les heures y sont réaffectées, aucune tâche n'est créée." },
  { code: "imprevu",        cas: "B", label: "Imprévu dans un ouvrage vendu", question: "Travail imprévu",
    explication: "Compris dans un ouvrage vendu : la tâche est ajoutée à l'ouvrage avec ses heures normales ; les heures prévues de l'ouvrage ne changent pas." },
  { code: "demande_client", cas: "C", label: "Travail non vendu", question: "Demande du client",
    explication: "Non vendu : à arbitrer, puis avenant (facturé) ou geste commercial (offert)." },
]);
export const MOTIF_NON_RENSEIGNE = "non_renseigne";

export const STATUTS_ARBITRAGE = Object.freeze([
  { code: "a_arbitrer",       label: "À arbitrer" },
  { code: "avenant",          label: "Avenant" },
  { code: "geste_commercial", label: "Geste commercial" },
]);

export const SEMAINES_RAPPEL_ARBITRAGE = 3;

import { libelleOuvrage, nomTache, nomTacheDevis } from "./libellesPhasageV1.mjs";

const str = v => (v == null ? "" : String(v).trim());
const liste = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const jour = d => (d ? String(d).slice(0, 10) : null);

export const libelleMotifHD = code =>
  MOTIFS_HORS_DEVIS.find(m => m.code === code)?.label || "Motif non renseigné";
export const casDuMotif = code => MOTIFS_HORS_DEVIS.find(m => m.code === code)?.cas || null;
export const motifDuCas = cas => MOTIFS_HORS_DEVIS.find(m => m.cas === cas)?.code || null;
export const libelleArbitrage = code =>
  STATUTS_ARBITRAGE.find(s => s.code === code)?.label || null;

export const estOuvrageDiversV2 = o => str(o?.libelle).toLowerCase() === DIVERS_HORS_DEVIS_V2.toLowerCase();

// Motif enregistré d'une tâche (« non_renseigne » si absent ou inconnu).
export function motifTacheV2(t) {
  const m = str(t?.motif_hd);
  return MOTIFS_HORS_DEVIS.some(x => x.code === m) ? m : MOTIF_NON_RENSEIGNE;
}
export const statutArbitrageV2 = t => {
  const s = str(t?.arbitrage?.statut);
  return STATUTS_ARBITRAGE.some(x => x.code === s) ? s : null;
};

// Une tâche relève-t-elle du traitement hors devis ? (cochée hors devis, rangée
// dans « Divers / hors devis », ou déjà classée A / B / C)
export function estTacheHorsDevisV2(tache, ouvrage) {
  if (!tache) return false;
  return tache.hors_devis === true || estOuvrageDiversV2(ouvrage)
    || motifTacheV2(tache) !== MOTIF_NON_RENSEIGNE || tache.ajoutee_en_cours === true || !!statutArbitrageV2(tache);
}

// ── Ressemblance des noms ───────────────────────────────────────────────────
const MOTS_VIDES = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "aux", "par", "est", "fait", "faire"]);
const normaliser = s => str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const motsDe = s => normaliser(s).split(" ").filter(w => w.length > 2 && !MOTS_VIDES.has(w));
const proches = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
// Mots significatifs d'un nom (mêmes règles que la ressemblance) — exportés
// pour indexer de grandes listes avant d'appeler ressemblanceNomsV2 (CR-6D).
export const motsNomV2 = s => motsDe(s);
export const nomNormaliseV2 = s => normaliser(s);
// Part (0..1) des mots significatifs de `a` retrouvés dans `b` : 1 quand le nom
// `b` couvre tout le nom `a` (« Mise en place d'un miroir » / « Mise en place
// du WC » : 2 mots sur 3 — « miroir » manque).
export function couvertureNomsV2(a, b) {
  const wa = motsDe(a), wb = motsDe(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  return round2(wa.filter(x => wb.some(y => proches(x, y))).length / wa.length);
}
// Score 0..1 : part des mots de `a` retrouvés (au moins par leurs 4 premières
// lettres) dans `b`, pondérée dans les deux sens (Dice).
export function ressemblanceNomsV2(a, b) {
  const na = normaliser(a), nb = normaliser(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = motsDe(a), wb = motsDe(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const communsA = wa.filter(x => wb.some(y => proches(x, y))).length;
  const communsB = wb.filter(y => wa.some(x => proches(x, y))).length;
  return round2((communsA + communsB) / (wa.length + wb.length));
}

// Tâches « standard » (nettoyage, réception, SAV, approvisionnement,
// déchetterie, reprises) : ni A, ni B, ni C.
const DEBUTS_STANDARD = ["nettoy", "menage", "rangement", "ranger", "aspir", "dechet", "decheterie", "evacu", "encombrant",
  "appro", "livraison", "reception", "sav", "reprise", "reserve", "chargement", "dechargement", "courses"];
export function estTacheStandardV2(nom) {
  return motsDe(nom).concat(normaliser(nom).split(" ")).some(m => DEBUTS_STANDARD.some(d => m.startsWith(d)));
}

// ── Cas A : tâches les plus probables pour une ligne ────────────────────────
/**
 * Propose les tâches existantes auxquelles réaffecter une ligne hors devis.
 * Même chantier ; pas les tâches hors devis ni « Divers ». Score : mots
 * proches (60 %), tâche prévue ce jour-là (25 %), même lot (15 %).
 * @param {object} p
 * @param {string} p.nom                  ce que l'ouvrier a écrit
 * @param {Array}  p.ouvrages             phasage du chantier
 * @param {string} [p.lotId]              lot de la tâche hors devis, s'il est connu
 * @param {string[]} [p.tachesPrevuesJour] ids des tâches prévues ce jour-là
 * @param {string[]} [p.exclure]           ids à ne pas proposer (la tâche elle-même)
 * @returns {Array<{tache_id, nom, ouvrage_id, ouvrage, score, raisons}>}
 */
export function tachesProbablesV2({ nom, ouvrages, lotId = null, tachesPrevuesJour = [], exclure = [], max = 5 } = {}) {
  const prevues = new Set(liste(tachesPrevuesJour).map(String));
  const exclus = new Set(liste(exclure).map(String));
  const out = [];
  for (const o of liste(ouvrages)) {
    if (estOuvrageDiversV2(o)) continue;
    for (const t of liste(o.taches)) {
      if (!t?.id || exclus.has(String(t.id)) || t.hors_devis === true) continue;
      const sim = Math.max(ressemblanceNomsV2(nom, nomTache(t)), ressemblanceNomsV2(nom, nomTacheDevis(t)));
      const prevue = prevues.has(String(t.id));
      const memeLot = !!lotId && str(o.lot_id) === str(lotId);
      const score = round2(sim * 0.6 + (prevue ? 0.25 : 0) + (memeLot ? 0.15 : 0));
      if (sim < 0.3 && !prevue) continue;
      const raisons = [];
      if (sim >= 0.3) raisons.push(sim >= 0.8 ? "nom très proche" : "mots en commun");
      if (prevue) raisons.push("prévue ce jour-là");
      if (memeLot) raisons.push("même lot");
      out.push({ tache_id: t.id, nom: nomTache(t), ouvrage_id: o.id, ouvrage: libelleOuvrage(o), avancement: num(t.avancement) ?? 0, score, raisons });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr")).slice(0, max);
}

// ── Cas B : heures normales proposées par la bibliothèque ──────────────────
/**
 * Heures NORMALES d'un travail ajouté dans un ouvrage : la cadence de la
 * bibliothèque de l'ouvrage (h / unité) × sa quantité × le % de l'étape dont
 * le nom ressemble le plus au travail. Sans correspondance sûre : null (le
 * conducteur saisit une estimation).
 * @param {object} p
 * @param {string} p.nom
 * @param {object} p.ouvrage        ouvrage du phasage ({ bibliotheque_id, quantite })
 * @param {Array}  p.bibliotheque   [{ id, cadence, sous_taches: [{ nom, ratio }] }]
 */
export function heuresNormalesProposeesV2({ nom, ouvrage, bibliotheque = [] } = {}) {
  const ref = liste(bibliotheque).find(b => str(b.id) && str(b.id) === str(ouvrage?.bibliotheque_id));
  const cadence = num(ref?.cadence), quantite = num(ouvrage?.quantite);
  if (!ref || !(cadence > 0) || !(quantite > 0)) return null;
  let best = null;
  for (const st of liste(ref.sous_taches)) {
    const s = ressemblanceNomsV2(nom, st?.nom);
    if (!best || s > best.score) best = { st, score: s };
  }
  if (!best || best.score < 0.5) return null;
  const ratio = num(best.st.ratio);
  if (!(ratio > 0)) return null;
  const heures = round2(cadence * quantite * ratio / 100);
  return { heures, source: "bibliotheque", etape: str(best.st.nom),
    detail: `${cadence} h/${str(ref.unite) || "u"} × ${quantite} × ${ratio} % (« ${str(best.st.nom)} »)` };
}

// ── Création et classement des tâches ──────────────────────────────────────
/**
 * Champs posés sur une tâche selon le cas choisi.
 *   B : ajoutée en cours de chantier, heures estimées = heures normales,
 *       comptée dans l'ouvrage (pas hors devis) ;
 *   C : hors devis, à arbitrer.
 * @returns {object} patch (null = retirer le champ) ou { erreur }
 */
export function champsCasV2({ cas, heuresNormales = null, date = null, auteur = null } = {}) {
  if (cas === "B") {
    const h = num(heuresNormales);
    if (!(h > 0)) return { erreur: "heures_normales" };
    return { motif_hd: "imprevu", ajoutee_en_cours: true, ajoutee_le: jour(date), ajoutee_par: str(auteur) || null,
      heures_estimees: round2(h), hors_devis: false, arbitrage: null };
  }
  if (cas === "C") {
    return { motif_hd: "demande_client", hors_devis: true, ajoutee_en_cours: null, ajoutee_le: null, ajoutee_par: null,
      arbitrage: { statut: "a_arbitrer", le: jour(date), par: str(auteur) || null } };
  }
  if (cas === "A") return { motif_hd: "introuvable" };
  return { erreur: "cas_inconnu" };
}

export function appliquerPatchV2(t, patch) {
  const next = { ...t };
  Object.entries(patch || {}).forEach(([k, v]) => { if (v === null || v === undefined) delete next[k]; else next[k] = v; });
  return next;
}

const trouver = (ouvrages, tacheId) => {
  for (const o of liste(ouvrages)) {
    const t = liste(o.taches).find(x => String(x.id) === String(tacheId));
    if (t) return { ouvrage: o, tache: t };
  }
  return null;
};

/**
 * Déplace une tâche (même identifiant : ses pointages et son journal la
 * suivent) vers un autre ouvrage, en lui appliquant un patch.
 * @returns {{ ouvrages } | { erreur }}
 */
export function deplacerTacheV2(ouvrages, tacheId, versOuvrageId, patch = {}) {
  const src = trouver(ouvrages, tacheId);
  if (!src) return { erreur: "tache_introuvable" };
  if (!liste(ouvrages).some(o => String(o.id) === String(versOuvrageId))) return { erreur: "ouvrage_introuvable" };
  const tache = appliquerPatchV2(src.tache, patch);
  return {
    ouvrages: liste(ouvrages).map(o => {
      let taches = liste(o.taches).filter(t => String(t.id) !== String(tacheId));
      if (String(o.id) === String(versOuvrageId)) taches = [...taches, tache];
      return { ...o, taches };
    }),
  };
}

const patcherTache = (ouvrages, tacheId, patch) => {
  if (!trouver(ouvrages, tacheId)) return { erreur: "tache_introuvable" };
  return { ouvrages: liste(ouvrages).map(o => ({ ...o,
    taches: liste(o.taches).map(t => (String(t.id) === String(tacheId) ? appliquerPatchV2(t, patch) : t)) })) };
};

/**
 * Cas A depuis le phasage : la tâche hors devis disparaît, ses heures vont à
 * la tâche existante. Rend le phasage SANS la tâche et la réaffectation des
 * pointages à faire en base ({ de, vers }). Aucune production n'est créée ni
 * dupliquée : la tâche retirée n'avait pas de prix, la cible garde le sien.
 */
export function reaffecterCasAV2(ouvrages, tacheId, versTacheId) {
  const src = trouver(ouvrages, tacheId);
  const cible = trouver(ouvrages, versTacheId);
  if (!src) return { erreur: "tache_introuvable" };
  if (!cible || String(versTacheId) === String(tacheId)) return { erreur: "cible_introuvable" };
  return {
    ouvrages: liste(ouvrages).map(o => ({ ...o, taches: liste(o.taches).filter(t => String(t.id) !== String(tacheId)) })),
    pointages: { de: String(tacheId), vers: String(versTacheId), ouvrageVers: cible.ouvrage.id },
  };
}

/** Cas B depuis le phasage : la tâche rejoint un ouvrage vendu, heures normales. */
export function integrerCasBV2(ouvrages, tacheId, ouvrageId, { heuresNormales, date, auteur } = {}) {
  const champs = champsCasV2({ cas: "B", heuresNormales, date, auteur });
  if (champs.erreur) return champs;
  const cible = liste(ouvrages).find(o => String(o.id) === String(ouvrageId));
  if (!cible) return { erreur: "ouvrage_introuvable" };
  if (estOuvrageDiversV2(cible)) return { erreur: "ouvrage_divers" };
  return deplacerTacheV2(ouvrages, tacheId, ouvrageId, champs);
}

/** Cas C : la tâche reste où elle est (« Divers / hors devis »), à arbitrer. */
export function aArbitrerV2(ouvrages, tacheId, { date, auteur } = {}) {
  return patcherTache(ouvrages, tacheId, champsCasV2({ cas: "C", date, auteur }));
}

/** Cas C → geste commercial : la tâche reste un coût sans production. */
export function gesteCommercialV2(ouvrages, tacheId, { date, auteur } = {}) {
  return patcherTache(ouvrages, tacheId, { motif_hd: "demande_client", hors_devis: true,
    arbitrage: { statut: "geste_commercial", le: jour(date), par: str(auteur) || null } });
}

/**
 * Cas C → avenant : quand l'avenant est signé et l'ouvrage créé avec son prix,
 * la tâche y est rattachée et produit. Son avancement ne change pas : il
 * reste daté dans le journal par les jours où la tâche a été déclarée, et le
 * relevé est recalculé à partir du premier de ces jours (`recalculerDepuis`)
 * — dans une période déjà exportée, l'écart sort en « Rectifications ».
 * @param {string[]} joursDeclares  dates des pointages de la tâche
 */
export function rattacherAvenantV2(ouvrages, tacheId, ouvrageAvenantId, { date, auteur, joursDeclares = [] } = {}) {
  const cible = liste(ouvrages).find(o => String(o.id) === String(ouvrageAvenantId));
  if (!cible) return { erreur: "ouvrage_introuvable" };
  if (estOuvrageDiversV2(cible)) return { erreur: "ouvrage_divers" };
  if (!(num(cible.prix_ht) > 0)) return { erreur: "avenant_sans_prix" };
  const r = deplacerTacheV2(ouvrages, tacheId, ouvrageAvenantId, { motif_hd: "demande_client", hors_devis: false,
    arbitrage: { statut: "avenant", le: jour(date), par: str(auteur) || null, ouvrage_avenant_id: String(ouvrageAvenantId) } });
  if (r.erreur) return r;
  const jours = liste(joursDeclares).map(jour).filter(Boolean).sort();
  return { ...r, dernierJourDeclare: jours.length ? jours[jours.length - 1] : null, recalculerDepuis: jours[0] || jour(date) };
}

/** Ouvrage « non facturé » : seulement un ouvrage à prix nul (il ne produit rien). */
export function marquerNonFactureV2(ouvrages, ouvrageId, valeur = true) {
  const o = liste(ouvrages).find(x => String(x.id) === String(ouvrageId));
  if (!o) return { erreur: "ouvrage_introuvable" };
  if (valeur && (num(o.prix_ht) || 0) !== 0) return { erreur: "ouvrage_avec_prix" };
  return { ouvrages: liste(ouvrages).map(x => (String(x.id) === String(ouvrageId)
    ? appliquerPatchV2(x, { non_facture: valeur ? true : null }) : x)) };
}

// ── « Ce travail est-il facturé au client ? » ──────────────────────────────
export const REPONSES_FACTURATION = Object.freeze([
  { code: "dans_devis", label: "Oui, il est dans le devis",          cas: ["A", "B"], aide: "Réaffectez à la tâche existante (A) ou ajoutez-la à son ouvrage (B)." },
  { code: "avenant",    label: "Oui, par un avenant",               cas: ["C"], arbitrage: "avenant", aide: "Rattachez-la à l'ouvrage d'avenant chiffré." },
  { code: "offert",     label: "Non, c'est offert au client",       cas: ["C"], arbitrage: "geste_commercial", aide: "Geste commercial : un coût sans production." },
  { code: "a_decider",  label: "Pas encore décidé",                 cas: ["C"], arbitrage: "a_arbitrer", aide: "Elle reste « à arbitrer » et remonte dans les décisions du Bilan." },
]);

// ── Proposition automatique du motif (reprise du passé) ────────────────────
/**
 * Motif proposé pour une tâche hors devis existante.
 * @returns {{ motif: string|null, cas: string|null, raison: string, cible?: object }}
 */
export function proposerMotifV2({ tache, ouvrage, ouvrages }) {
  const m = motifTacheV2(tache);
  if (m !== MOTIF_NON_RENSEIGNE) return { motif: m, cas: casDuMotif(m), raison: "motif déjà enregistré" };
  if (str(tache?.nature) === "demande_client") return { motif: "demande_client", cas: "C", raison: "nature « demande du client »" };
  if (estTacheStandardV2(tache?.nom)) return { motif: null, cas: null, raison: "tâche standard (nettoyage, approvisionnement, SAV…) : à garder telle quelle" };
  const [best] = tachesProbablesV2({ nom: tache?.nom, ouvrages, exclure: [tache?.id], max: 1 });
  if (best && best.score >= 0.45) {
    return { motif: "introuvable", cas: "A", raison: `ressemble à « ${best.nom} » (${best.ouvrage})`, cible: best };
  }
  if (!estOuvrageDiversV2(ouvrage)) return { motif: "imprevu", cas: "B", raison: "déjà rangée dans un ouvrage vendu" };
  if (["imprevu", "oubli_phasage"].includes(str(tache?.nature))) return { motif: "imprevu", cas: "B", raison: `nature « ${str(tache.nature)} » : ouvrage à choisir` };
  return { motif: "demande_client", cas: "C", raison: "aucune tâche ressemblante dans le phasage : à examiner (non vendu par défaut)" };
}

// ── Synthèse par chantier (fiche chantier, Bilan) ───────────────────────────
const tauxFGDe = (tauxFG, date) => (typeof tauxFG === "function" ? (num(tauxFG(date)) || 0) : (num(tauxFG) || 0));
const semainesEntre = (a, b) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * 86400000);

/**
 * Heures et coût (MO + frais généraux) des tâches hors devis d'un chantier.
 * @param {object} p
 * @param {Array}  p.ouvrages
 * @param {Array}  p.pointages   { tache_id, date, heures, taux_horaire }
 * @param {number|Function} p.tauxFG  taux de frais généraux (ou fonction date → taux)
 * @param {string} p.aujourdHui  AAAA-MM-JJ
 * @param {number} [p.semainesRappel=3]
 */
export function syntheseHorsDevisChantierV2({ ouvrages, pointages = [], tauxFG = 0, aujourdHui, semainesRappel = SEMAINES_RAPPEL_ARBITRAGE } = {}) {
  const parTache = new Map();
  for (const p of liste(pointages)) {
    const id = str(p.tache_id);
    if (!id) continue;
    const h = num(p.heures) || 0;
    const e = parTache.get(id) || { heures: 0, mo: 0, fg: 0, jours: [] };
    e.heures += h;
    e.mo += h * (num(p.taux_horaire) || 0);
    e.fg += h * tauxFGDe(tauxFG, jour(p.date));
    if (jour(p.date)) e.jours.push(jour(p.date));
    parTache.set(id, e);
  }
  const taches = [];
  for (const o of liste(ouvrages)) {
    for (const t of liste(o.taches)) {
      if (!estTacheHorsDevisV2(t, o)) continue;
      const e = parTache.get(str(t.id)) || { heures: 0, mo: 0, fg: 0, jours: [] };
      const jours = [...e.jours].sort();
      const statut = statutArbitrageV2(t);
      const depuis = statut === "a_arbitrer" ? (jour(t.arbitrage?.le) || jours[0] || null) : null;
      const rappel = !!(depuis && aujourdHui && semainesEntre(depuis, aujourdHui) > semainesRappel);
      taches.push({
        tache_id: t.id, nom: nomTache(t), ouvrage_id: o.id, ouvrage: libelleOuvrage(o),
        motif: motifTacheV2(t), cas: casDuMotif(motifTacheV2(t)), arbitrage: statut,
        ajouteeEnCours: t.ajoutee_en_cours === true, horsDevis: t.hors_devis === true,
        heures: round2(e.heures), cout: round2(e.mo + e.fg), coutMO: round2(e.mo), coutFG: round2(e.fg),
        premierJour: jours[0] || null, dernierJour: jours[jours.length - 1] || null, aArbitrerDepuis: depuis, rappel,
        // CR-6D : « laissée en l'état » (plus proposée au classement, plus
        // comptée « non classée » ; heures et coût inchangés). Une tâche
        // classée ensuite (arbitrée, intégrée) n'est plus « laissée ».
        laissee: (!statut && t.ajoutee_en_cours !== true) ? laisseeEnEtatV2(t) : null, aClasser: estAClasserV2(t, o),
        proposition: proposerMotifV2({ tache: t, ouvrage: o, ouvrages }),
      });
    }
  }
  const total = (f) => {
    const l = taches.filter(f);
    return { nb: l.length, heures: round2(l.reduce((s, x) => s + x.heures, 0)), cout: round2(l.reduce((s, x) => s + x.cout, 0)) };
  };
  return {
    taches,
    parMotif: {
      introuvable: total(x => x.motif === "introuvable"),          // A non encore réaffectées
      imprevu: total(x => x.motif === "imprevu"),                  // B
      demande_client: total(x => x.motif === "demande_client"),    // C (tous statuts)
      non_renseigne: total(x => x.motif === MOTIF_NON_RENSEIGNE && !x.laissee),
    },
    laissees: total(x => !!x.laissee),
    aClasser: total(x => x.aClasser),
    aArbitrer: total(x => x.arbitrage === "a_arbitrer"),
    gestesCommerciaux: total(x => x.arbitrage === "geste_commercial"),
    avenants: total(x => x.arbitrage === "avenant"),
    rappels: taches.filter(x => x.rappel).length,
  };
}

const fmtH = h => `${String(round2(h)).replace(".", ",")} h`;
const fmtEur = e => `${Math.round(e).toLocaleString("fr-FR").replace(/ /g, " ")} €`;

/**
 * Décisions attendues du Bilan : les tâches « à arbitrer », par chantier.
 * @param {Array} chantiers  [{ chantierId, nom, synthese }] (syntheseHorsDevisChantierV2)
 */
export function decisionsHorsDevisV2({ chantiers = [], semainesRappel = SEMAINES_RAPPEL_ARBITRAGE } = {}) {
  const out = [];
  for (const c of liste(chantiers)) {
    const a = c?.synthese?.aArbitrer;
    if (!a || a.nb === 0) continue;
    const rappels = c.synthese.rappels || 0;
    out.push({
      id: `horsdevis:${str(c.chantierId)}`, type: "hors_devis", chantierId: str(c.chantierId), nom: str(c.nom),
      titre: `${str(c.nom)} : ${a.nb} tâche${a.nb > 1 ? "s" : ""} hors devis à arbitrer, ${fmtH(a.heures)}, environ ${fmtEur(a.cout)} — avenant ou offert ?`,
      detail: [
        c.synthese.taches.filter(t => t.arbitrage === "a_arbitrer").map(t => `« ${t.nom} » (${fmtH(t.heures)})`).join(", "),
        rappels > 0 ? `Rappel : ${rappels} non arbitrée${rappels > 1 ? "s" : ""} depuis plus de ${semainesRappel} semaines.` : null,
      ].filter(Boolean).join(" · "),
      heures: a.heures, cout: a.cout, rappel: rappels > 0,
    });
  }
  return out.sort((x, y) => (y.rappel - x.rappel) || x.nom.localeCompare(y.nom, "fr"));
}

/**
 * Gestes commerciaux d'une période (bandeau de la version détaillée) : heures
 * pointées dans la période sur des tâches passées en geste commercial, et
 * leur coût (MO + frais généraux).
 * @param {Array} ouvragesParChantier  [{ chantierId, ouvrages }]
 */
export function gestesCommerciauxPeriodeV2({ ouvragesParChantier = [], pointages = [], periode, tauxFG = 0 } = {}) {
  const gestes = new Set();
  for (const c of liste(ouvragesParChantier)) {
    for (const o of liste(c.ouvrages)) for (const t of liste(o.taches)) if (statutArbitrageV2(t) === "geste_commercial") gestes.add(str(t.id));
  }
  let heures = 0, cout = 0;
  for (const p of liste(pointages)) {
    const d = jour(p.date);
    if (!gestes.has(str(p.tache_id)) || !d || d < periode.debut || d > periode.fin) continue;
    const h = num(p.heures) || 0;
    heures += h;
    cout += h * ((num(p.taux_horaire) || 0) + tauxFGDe(tauxFG, d));
  }
  return { heures: round2(heures), cout: round2(cout), nbTaches: gestes.size };
}

// ── Bibliothèque : tâches souvent ajoutées ─────────────────────────────────
/**
 * Tâches « ajoutées en cours de chantier » (cas B), comptées par modèle
 * d'ouvrage de la bibliothèque. Proposées au modèle quand elles reviennent sur
 * au moins `minChantiers` chantiers (chantiers repris exclus) et que le modèle
 * n'a pas déjà une étape au nom proche.
 * @param {Array} phasages     [{ chantier_id, ouvrages }]
 * @param {string[]} exclus    chantier_id des chantiers repris
 * @param {Array} bibliotheque [{ id, libelle, sous_taches }]
 * @returns {Map<string, Array<{ nom, nbChantiers, chantiers, nbTaches }>>}  par bibliotheque_id
 */
export function tachesSouventAjouteesV2({ phasages = [], exclus = [], bibliotheque = [], minChantiers = 2 } = {}) {
  const ex = new Set(liste(exclus).map(String));
  const parModele = new Map();
  for (const ph of liste(phasages)) {
    const cid = str(ph.chantier_id);
    if (!cid || ex.has(cid)) continue;
    for (const o of liste(ph.ouvrages)) {
      const bid = str(o.bibliotheque_id);
      if (!bid) continue;
      for (const t of liste(o.taches)) {
        if (t?.ajoutee_en_cours !== true || !str(t.nom)) continue;
        if (!parModele.has(bid)) parModele.set(bid, []);
        const groupes = parModele.get(bid);
        let g = groupes.find(x => ressemblanceNomsV2(x.nom, t.nom) >= 0.8);
        if (!g) { g = { nom: str(t.nom), chantiers: new Set(), nbTaches: 0 }; groupes.push(g); }
        g.chantiers.add(cid);
        g.nbTaches += 1;
      }
    }
  }
  const out = new Map();
  parModele.forEach((groupes, bid) => {
    const modele = liste(bibliotheque).find(b => str(b.id) === bid);
    const etapes = liste(modele?.sous_taches).map(s => str(s?.nom));
    const retenus = groupes
      .filter(g => g.chantiers.size >= minChantiers && !etapes.some(e => ressemblanceNomsV2(e, g.nom) >= 0.8))
      .map(g => ({ nom: g.nom, nbChantiers: g.chantiers.size, chantiers: [...g.chantiers].sort(), nbTaches: g.nbTaches }))
      .sort((a, b) => b.nbChantiers - a.nbChantiers || a.nom.localeCompare(b.nom, "fr"));
    if (retenus.length) out.set(bid, retenus);
  });
  return out;
}

/** Ajoute une étape au modèle de bibliothèque (ratio 0 % : la répartition existante ne bouge pas). */
export function ajouterEtapeModeleV2(sousTaches, nom, phaseId = null) {
  const l = liste(sousTaches);
  if (!str(nom) || l.some(s => ressemblanceNomsV2(s?.nom, nom) >= 0.8)) return l;
  return [...l, { nom: str(nom), ratio: 0, ...(phaseId ? { phaseId } : {}) }];
}

// ── Textes courts (fiche chantier, PDF) ─────────────────────────────────────
const morceau = (libelle, v, avecCout = false) =>
  (v && v.nb > 0 ? `${libelle} ${v.nb} · ${fmtH(v.heures)}${avecCout ? ` (${fmtEur(v.cout)})` : ""}` : null);

/** « Hors devis : A non réaffectées 1 · 3 h ; B 2 · 5 h ; … » — null s'il n'y a rien. */
export function texteHorsDevisV2(synthese) {
  if (!synthese) return null;
  const p = synthese.parMotif || {};
  const parts = [
    morceau("A non encore réaffectées", p.introuvable),
    morceau("B ajoutées en cours de chantier", p.imprevu),
    morceau("C à arbitrer", synthese.aArbitrer, true),
    morceau("gestes commerciaux", synthese.gestesCommerciaux, true),
    morceau("avenants", synthese.avenants),
    morceau("non classées", p.non_renseigne),
    morceau("laissées en l'état", synthese.laissees),
  ].filter(Boolean);
  return parts.length ? `Hors devis : ${parts.join(" ; ")}` : null;
}

/** Bandeau de la version détaillée : gestes commerciaux de la période. */
export function texteGestesPeriodeV2(g) {
  if (!g) return null;
  return g.heures > 0 ? `${fmtH(g.heures)}, ${fmtEur(g.cout)} (coût sans production)` : "aucun sur la période";
}

// ── Classement en masse des tâches hors devis anciennes (CR-6, partie 6D) ──
// Même service que le classement unitaire du phasage (« Classer ») : la
// proposition est proposerMotifV2 (+ tachesProbablesV2 pour la cible du cas
// A), et « Appliquer la sélection » enchaîne EXACTEMENT les fonctions du
// classement unitaire (reaffecterCasAV2, integrerCasBV2, aArbitrerV2), une
// tâche après l'autre — pas de second circuit.
//
// « Laisser en l'état » : une marque datée avec auteur DANS la tâche
//   laissee_en_etat = { le: AAAA-MM-JJ, par, raison: "chantier_repris" | "standard" }
// Rien d'autre ne change (hors_devis, motif, ouvrage, heures, pointages) : la
// tâche garde ses heures et son coût, ne produit toujours rien, mais n'est
// plus proposée au classement ni comptée « non classée ». Réversible
// (reprendreClassementV2). Choisi sur la tâche plutôt que sur le chantier :
// une tâche hors devis créée APRÈS la décision reste à classer, et la marque
// suit la tâche si elle est déplacée.

export const NIVEAUX_CONFIANCE = Object.freeze([
  { code: "eleve",  label: "Élevée" },
  { code: "moyen",  label: "Moyenne" },
  { code: "faible", label: "Faible" },
  { code: "aucune", label: "Aucune proposition" },
]);
export const libelleConfiance = code => NIVEAUX_CONFIANCE.find(n => n.code === code)?.label || "Aucune proposition";

export const CHOIX_MASSE_V2 = Object.freeze([
  { code: "A",       label: "A · réaffecter à la tâche existante" },
  { code: "B",       label: "B · imprévu dans un ouvrage vendu" },
  { code: "C",       label: "C · à arbitrer" },
  { code: "laisser", label: "Laisser en l'état" },
]);

export function laisseeEnEtatV2(t) {
  const m = t?.laissee_en_etat;
  return m && typeof m === "object" ? { le: m.le || null, par: m.par || null, raison: m.raison || null } : null;
}

// Tâche encore « à classer » : hors devis, ni laissée en l'état, ni arbitrée
// (à arbitrer / avenant / geste), ni déjà intégrée (B).
export function estAClasserV2(tache, ouvrage) {
  return estTacheHorsDevisV2(tache, ouvrage) && !laisseeEnEtatV2(tache) && !statutArbitrageV2(tache) && tache.ajoutee_en_cours !== true;
}

const ouvrageDe = (ouvrages, tacheId) => trouver(ouvrages, tacheId)?.ouvrage || null;
export function cheminOuvrageV2(o, lots = []) {
  const lot = liste(lots).find(l => str(l?.id) && str(l.id) === str(o?.lot_id));
  const lib = str(libelleOuvrage(o)) || "(sans libellé)";
  return `${lot ? str(lot.label) : "Sans lot"} › ${lib.length > 70 ? `${lib.slice(0, 67).trim()}…` : lib}`;
}

/**
 * Lignes du classement en masse d'un chantier : chaque tâche à classer avec le
 * cas proposé, l'explication, le niveau de confiance et, pour A, la tâche
 * proposée (chemin lot › ouvrage). Niveaux :
 *   élevée  : cas A au nom quasi identique (ressemblance ≥ 0,9) qui couvre
 *             tous les mots de la tâche, sans seconde tâche aussi proche ;
 *             cas B / C déjà déclaré (motif enregistré, nature « demande du
 *             client ») ;
 *   moyenne : cas A dont la tâche proposée reprend tous les mots de la tâche
 *             hors devis, sans seconde tâche aussi proche ; tâche standard
 *             (nettoyage, approvisionnement…) ; tâche déjà rangée dans un
 *             ouvrage vendu (B) ;
 *   faible  : cas A où un mot manque (« Mise en place d'un miroir » →
 *             « Mise en place du WC ») ou deux tâches ressemblent autant ; C
 *             par défaut (aucune tâche ressemblante : « à examiner ») ; B
 *             d'après la seule nature « imprévu » (ouvrage à choisir).
 * @returns {{ lignes: Array, synthese: object }}
 */
export function propositionsClassementMasseV2({ ouvrages, pointages = [], tauxFG = 0, aujourdHui = null, lots = [], bibliotheque = [] } = {}) {
  const synthese = syntheseHorsDevisChantierV2({ ouvrages, pointages, tauxFG, aujourdHui });
  const lignes = [];
  for (const x of synthese.taches) {
    if (!x.aClasser) continue;
    const src = trouver(ouvrages, x.tache_id);
    const t = src.tache, o = src.ouvrage;
    const p = x.proposition || {};
    const candidats = tachesProbablesV2({ nom: t.nom, ouvrages, exclure: [t.id], max: 5 })
      .map(c => ({ ...c, chemin: cheminOuvrageV2(ouvrageDe(ouvrages, c.tache_id), lots), ressemblance: round2(Math.min(1, c.score / 0.6)),
        couverture: couvertureNomsV2(t.nom, c.nom) }));
    const cas = p.cas || null;
    const motifDeclare = p.raison === "motif déjà enregistré";
    let confiance = "faible", explication = p.raison || "", cible = null, ouvrageB = null, heuresNormales = null, applicable = true, nonApplicable = null;
    if (cas === "A") {
      cible = (p.cible && candidats.find(c => String(c.tache_id) === String(p.cible.tache_id))) || candidats[0] || null;
      if (!cible) {
        applicable = false; nonApplicable = "aucune tâche existante ressemblante : choisissez-la avec « Classer »";
        explication = `${motifDeclare ? "Déclarée « tâche existante non trouvée »" : explication}, mais aucune tâche ressemblante dans le phasage`;
        confiance = "faible";
      } else {
        const second = candidats.find(c => String(c.tache_id) !== String(cible.tache_id));
        const unique = !second || second.ressemblance < cible.ressemblance - 0.1;
        const complet = cible.couverture >= 1;
        confiance = !unique || !complet ? "faible" : cible.ressemblance >= 0.9 ? "eleve" : "moyen";
        const manque = complet ? null : motsNomV2(t.nom).filter(w => !motsNomV2(cible.nom).some(y => proches(w, y)));
        explication = `${motifDeclare ? "Déclarée « tâche existante non trouvée » ; " : ""}ressemble à « ${cible.nom} » (${cible.chemin})`
          + `${manque && manque.length ? ` — attention : « ${manque.join(" ")} » ne s'y retrouve pas` : ""}`
          + `${!unique && second ? ` — attention : « ${second.nom} » ressemble autant` : ""}`;
      }
    } else if (cas === "B") {
      ouvrageB = estOuvrageDiversV2(o) ? null : { id: o.id, chemin: cheminOuvrageV2(o, lots) };
      heuresNormales = ouvrageB ? heuresNormalesProposeesV2({ nom: t.nom, ouvrage: o, bibliotheque }) : null;
      confiance = motifDeclare ? "eleve" : (ouvrageB ? "moyen" : "faible");
      explication = ouvrageB
        ? `${motifDeclare ? "Déclarée « imprévu » ; d" : "D"}éjà rangée dans l'ouvrage vendu ${ouvrageB.chemin}`
        : (motifDeclare ? "Déclarée « imprévu » : ouvrage à choisir" : explication);
      if (!ouvrageB) { applicable = false; nonApplicable = "ouvrage vendu à choisir"; }
      else if (!heuresNormales) { applicable = false; nonApplicable = "heures normales à indiquer (aucune étape ressemblante dans la bibliothèque)"; }
    } else if (cas === "C") {
      confiance = motifDeclare || str(t.nature) === "demande_client" ? "eleve" : "faible";
      if (motifDeclare) explication = "Déclarée « demande du client » : à arbitrer";
    } else {
      confiance = "moyen";
    }
    lignes.push({
      tache_id: x.tache_id, nom: x.nom, ouvrage_id: x.ouvrage_id, ouvrage: x.ouvrage, chemin: cheminOuvrageV2(o, lots),
      heures: x.heures, cout: x.cout, premierJour: x.premierJour,
      cas, standard: !cas, choix: cas || "laisser", confiance, explication,
      cible, candidats, ouvrageB, heuresNormales, applicable, nonApplicable,
    });
  }
  return { lignes, synthese };
}

/**
 * Une ligne (avec le choix du conducteur) peut-elle être appliquée ?
 * @param {object} c  { choix, cible_id, ouvrage_id, heures_normales }
 * @returns {string|null}  raison du refus, null si applicable
 */
export function refusLigneMasseV2(ouvrages, tacheId, c = {}) {
  if (!trouver(ouvrages, tacheId)) return "tâche introuvable dans le phasage (rechargez la page)";
  if (c.choix === "A") return trouver(ouvrages, c.cible_id) && String(c.cible_id) !== String(tacheId) ? null : "tâche existante à choisir";
  if (c.choix === "B") {
    const o = liste(ouvrages).find(x => String(x.id) === String(c.ouvrage_id));
    if (!o || estOuvrageDiversV2(o)) return "ouvrage vendu à choisir";
    return num(c.heures_normales) > 0 ? null : "heures normales manquantes : indiquez-les (comme pour « Classer »)";
  }
  if (c.choix === "C" || c.choix === "laisser") return null;
  return "cas à choisir";
}

/** Marque « laissée en l'état » sur des tâches (rien d'autre ne change). */
export function laisserEnEtatV2(ouvrages, tacheIds, { date, auteur, raison = "standard" } = {}) {
  const ids = new Set(liste(tacheIds).map(String));
  if ([...ids].some(id => !trouver(ouvrages, id))) return { erreur: "tache_introuvable" };
  const marque = { le: jour(date), par: str(auteur) || null, raison };
  return { ouvrages: liste(ouvrages).map(o => ({ ...o,
    taches: liste(o.taches).map(t => (ids.has(String(t.id)) ? { ...t, laissee_en_etat: marque } : t)) })) };
}

/**
 * « Tout laisser en l'état » (chantier repris) : toutes les tâches encore à
 * classer reçoivent la marque, d'un clic. Refusé si le chantier n'est pas
 * marqué « repris ».
 * @param {object|null} repris  chantierRepris(phasage) ({ le, par }) ou null
 */
export function laisserToutEnEtatV2(ouvrages, { repris, date, auteur } = {}) {
  if (!repris) return { erreur: "chantier_non_repris" };
  const ids = [];
  for (const o of liste(ouvrages)) for (const t of liste(o.taches)) if (estAClasserV2(t, o)) ids.push(String(t.id));
  if (ids.length === 0) return { ouvrages, nb: 0 };
  const r = laisserEnEtatV2(ouvrages, ids, { date, auteur, raison: "chantier_repris" });
  return r.erreur ? r : { ...r, nb: ids.length };
}

/** Retire la marque « laissée en l'état » (toutes les tâches, ou celles listées). */
export function reprendreClassementV2(ouvrages, tacheIds = null) {
  const ids = tacheIds ? new Set(liste(tacheIds).map(String)) : null;
  return { ouvrages: liste(ouvrages).map(o => ({ ...o,
    taches: liste(o.taches).map(t => ((!ids || ids.has(String(t.id))) && t.laissee_en_etat ? appliquerPatchV2(t, { laissee_en_etat: null }) : t)) })) };
}

/**
 * Plan d'application de la sélection : SEULES les lignes cochées, dans
 * l'ordre, chacune par la fonction du classement unitaire, sur le phasage
 * issu de la précédente. Une ligne refusée (cible absente, heures normales
 * manquantes…) est écartée et dite ; les autres passent.
 * @param {Array} selection  [{ tache_id, choix, cible_id?, ouvrage_id?, heures_normales?, premierJour? }]
 * @returns {{ etapes: Array<{ tache_id, choix, ouvrages, pointages, recalculerDepuis }>, refusees: Array<{ tache_id, choix, raison }>,
 *             ouvrages, recalculerDepuis: string|null, compte: { A, B, C, laisser } }}
 */
export function planClassementMasseV2({ ouvrages, selection = [], date = null, auteur = null } = {}) {
  let courant = ouvrages;
  const etapes = [], refusees = [];
  const compte = { A: 0, B: 0, C: 0, laisser: 0 };
  for (const s of liste(selection)) {
    const raison = refusLigneMasseV2(courant, s.tache_id, s);
    if (raison) { refusees.push({ tache_id: s.tache_id, choix: s.choix || null, raison }); continue; }
    let r;
    if (s.choix === "A") r = reaffecterCasAV2(courant, s.tache_id, s.cible_id);
    else if (s.choix === "B") r = integrerCasBV2(courant, s.tache_id, s.ouvrage_id, { heuresNormales: s.heures_normales, date, auteur });
    else if (s.choix === "C") r = aArbitrerV2(courant, s.tache_id, { date, auteur });
    else r = laisserEnEtatV2(courant, [s.tache_id], { date, auteur, raison: "standard" });
    if (r.erreur) { refusees.push({ tache_id: s.tache_id, choix: s.choix, raison: r.erreur }); continue; }
    courant = r.ouvrages;
    compte[s.choix] += 1;
    etapes.push({ tache_id: s.tache_id, choix: s.choix, ouvrages: courant, pointages: r.pointages || null,
      recalculerDepuis: (s.choix === "A" || s.choix === "B") ? (jour(s.premierJour) || null) : null });
  }
  const dates = etapes.map(e => e.recalculerDepuis).filter(Boolean).sort();
  return { etapes, refusees, ouvrages: courant, recalculerDepuis: dates[0] || null, compte };
}

/** « 12 tâches : 3 A, 9 C — Appliquer » (récapitulatif avant écriture). */
export function texteConfirmationMasseV2(compte = {}) {
  const parts = [["A", "A"], ["B", "B"], ["C", "C"], ["laisser", "laissée(s) en l'état"]]
    .filter(([k]) => (compte[k] || 0) > 0).map(([k, l]) => `${compte[k]} ${l}`);
  const n = ["A", "B", "C", "laisser"].reduce((s, k) => s + (compte[k] || 0), 0);
  return n === 0 ? "Aucune tâche sélectionnée" : `${n} tâche${n > 1 ? "s" : ""} : ${parts.join(", ")} — Appliquer`;
}
