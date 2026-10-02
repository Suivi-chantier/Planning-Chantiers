// src/Invest/dossiers/calculAcquisition.mjs — logique PURE de l'onglet Acquisition d'une mission.
// Aucun accès Supabase ; la date du jour arrive en paramètre. Le stade d'une acquisition se DÉDUIT de ses dates
// (jamais stocké). Une donnée absente rend le résultat « non évaluable » (null), jamais zéro.
export const MAX_ACQUISITIONS = 6;
export const MAX_CONDITIONS = 15;
export const STADES = Object.freeze({
  recherche: "Offre à formuler", offre_acceptee: "Offre acceptée", sous_compromis: "Sous compromis", acte_signe: "Acte signé",
  en_travaux: "En travaux", prete_louer: "Prête à louer", en_location: "En location", abandonnee: "Abandonnée",
});
export const JALONS = Object.freeze([
  ["offre_acceptee_le", "Offre acceptée"], ["compromis_signe_le", "Compromis signé"], ["signature_prevue_le", "Signature de l'acte prévue"],
  ["acte_signe_le", "Acte signé"], ["cles_remises_le", "Remise des clés"], ["travaux_debut_le", "Début des travaux"],
  ["travaux_fin_le", "Fin des travaux"], ["mise_location_le", "Mise en location"],
]);
const DELAI_RETRACTATION_JOURS = 10;

const nombre = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const ajouterJours = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Stade déduit des dates, du plus avancé au moins avancé. */
export function stadeAcquisition(a = {}) {
  if (date(a.abandon_le)) return "abandonnee";
  if (date(a.mise_location_le)) return "en_location";
  if (date(a.travaux_fin_le)) return "prete_louer";
  if (date(a.travaux_debut_le)) return "en_travaux";
  if (date(a.acte_signe_le)) return "acte_signe";
  if (date(a.compromis_signe_le)) return "sous_compromis";
  if (date(a.offre_acceptee_le)) return "offre_acceptee";
  return "recherche";
}

/** Conditions suspensives : levées, en attente, en retard (échéance passée sans levée) ou proches (≤ 7 jours). */
export function etatConditions(conditions = [], aujourdhui) {
  const liste = (Array.isArray(conditions) ? conditions : []).filter((c) => c && String(c.libelle || "").trim());
  const res = { total: liste.length, levees: 0, enAttente: 0, enRetard: [], proches: [], toutesLevees: liste.length > 0 };
  for (const c of liste) {
    if (date(c.levee_le)) { res.levees += 1; continue; }
    res.toutesLevees = false; res.enAttente += 1;
    const e = date(c.echeance);
    if (!e) continue;
    const j = joursEntre(aujourdhui, e);
    if (j < 0) res.enRetard.push({ libelle: c.libelle, echeance: e, jours: -j });
    else if (j <= 7) res.proches.push({ libelle: c.libelle, echeance: e, jours: j });
  }
  return res;
}

/** Alertes d'une acquisition en cours (ni abandonnée ni déjà en acte pour les conditions). */
export function alertesAcquisition(a = {}, aujourdhui) {
  const stade = stadeAcquisition(a), al = [];
  if (stade === "abandonnee" || stade === "en_location") return al;
  if (stade === "sous_compromis") {
    const c = etatConditions(a.conditions_suspensives, aujourdhui);
    for (const x of c.enRetard) al.push({ niveau: "rouge", texte: `Condition suspensive « ${x.libelle} » : échéance dépassée de ${x.jours} jour${x.jours > 1 ? "s" : ""}` });
    for (const x of c.proches) al.push({ niveau: "orange", texte: `Condition suspensive « ${x.libelle} » : échéance ${x.jours === 0 ? "aujourd'hui" : `dans ${x.jours} jour${x.jours > 1 ? "s" : ""}`}` });
    const sig = date(a.signature_prevue_le);
    if (sig) {
      const j = joursEntre(aujourdhui, sig);
      if (j < 0) al.push({ niveau: "rouge", texte: `Signature de l'acte prévue le ${sig.split("-").reverse().join("/")} : dépassée de ${-j} jour${-j > 1 ? "s" : ""}, acte non signé` });
      else if (j <= 14) al.push({ niveau: "orange", texte: `Signature de l'acte dans ${j} jour${j > 1 ? "s" : ""}` });
    }
  }
  if (stade === "acte_signe" && !date(a.travaux_debut_le) && nombre(a.budget_travaux) !== null && nombre(a.budget_travaux) > 0) al.push({ niveau: "info", texte: "Travaux budgétés mais pas encore démarrés" });
  return al;
}

/** Fin indicative du délai de rétractation (10 jours après le compromis) : à confirmer avec le notaire. */
export function finRetractation(a = {}) {
  const c = date(a.compromis_signe_le);
  return c ? ajouterJours(c, DELAI_RETRACTATION_JOURS) : null;
}

/** Coût d'acquisition : prix signé + budget travaux. Non évaluable sans prix ; travaux absents signalés. */
export function coutAcquisition(a = {}) {
  const prix = nombre(a.prix_signe), travaux = nombre(a.budget_travaux);
  return { prix, travaux, travauxRenseignes: travaux !== null, total: prix === null ? null : prix + (travaux ?? 0) };
}

/** Synthèse de la mission : acquisitions par stade, en cours, réalisées, coût total des acquisitions réalisées. */
export function syntheseAcquisitions(acquisitions = []) {
  const parStade = Object.fromEntries(Object.keys(STADES).map((k) => [k, 0]));
  let coutRealise = 0, coutComplet = true, realisees = 0;
  for (const a of acquisitions) {
    const s = stadeAcquisition(a); parStade[s] += 1;
    if (["acte_signe", "en_travaux", "prete_louer", "en_location"].includes(s)) {
      realisees += 1; const c = coutAcquisition(a);
      if (c.total === null) coutComplet = false; else coutRealise += c.total;
    }
  }
  return { nombre: acquisitions.length, parStade, realisees, enCours: acquisitions.filter((a) => !["abandonnee", "en_location"].includes(stadeAcquisition(a))).length,
    coutRealise: realisees === 0 ? null : coutComplet ? coutRealise : null, coutRealiseComplet: coutComplet };
}

/** Mêmes règles que la base (contraintes de la migration) : messages avant l'envoi. */
export function erreursAcquisition(a = {}) {
  const e = [], d = (k) => date(a[k]);
  if (!String(a.libelle || "").trim()) e.push("Indiquez un libellé (adresse ou nom du bien).");
  for (const [k, l] of [["prix_signe", "Le prix signé"], ["budget_travaux", "Le budget travaux"]]) {
    if (a[k] !== "" && a[k] != null) { const n = nombre(a[k]); if (n === null || n < 0) e.push(`${l} doit être un montant positif.`); }
  }
  const apres = (x, y, msg) => { if (d(x) && d(y) && d(y) < d(x)) e.push(msg); };
  if (d("acte_signe_le") && !d("compromis_signe_le")) e.push("L'acte suppose un compromis signé.");
  if ((d("cles_remises_le") || d("travaux_debut_le") || d("mise_location_le")) && !d("acte_signe_le")) e.push("Clés, travaux et mise en location supposent l'acte signé.");
  if (d("travaux_fin_le") && !d("travaux_debut_le")) e.push("La fin des travaux suppose un début des travaux.");
  if (d("abandon_le") && d("acte_signe_le")) e.push("Une acquisition dont l'acte est signé ne peut pas être abandonnée.");
  apres("offre_acceptee_le", "compromis_signe_le", "Le compromis ne peut pas précéder l'offre acceptée.");
  apres("compromis_signe_le", "acte_signe_le", "L'acte ne peut pas précéder le compromis.");
  apres("acte_signe_le", "cles_remises_le", "Les clés ne peuvent pas être remises avant l'acte.");
  apres("acte_signe_le", "travaux_debut_le", "Les travaux ne peuvent pas commencer avant l'acte.");
  apres("travaux_debut_le", "travaux_fin_le", "La fin des travaux ne peut pas précéder leur début.");
  apres("acte_signe_le", "mise_location_le", "La mise en location ne peut pas précéder l'acte.");
  const cs = Array.isArray(a.conditions_suspensives) ? a.conditions_suspensives : [];
  if (cs.length > MAX_CONDITIONS) e.push(`${MAX_CONDITIONS} conditions suspensives au plus.`);
  cs.forEach((c, i) => { if (!String(c?.libelle || "").trim() && (c?.echeance || c?.levee_le)) e.push(`Condition ${i + 1} : indiquez l'intitulé.`); });
  return e;
}

/** Conditions prêtes à l'enregistrement : intitulé obligatoire, lignes vides retirées. */
export const nettoyerConditions = (cs = []) => cs.filter((c) => String(c?.libelle || "").trim())
  .map((c) => ({ libelle: String(c.libelle).trim(), echeance: date(c.echeance), levee_le: date(c.levee_le) }));
