// src/Invest/dossiers/calculStrategie.mjs — logique PURE de l'onglet Stratégie d'une mission.
// Aucun accès Supabase, aucune horloge. Les indicateurs des scénarios se calculent à partir d'hypothèses
// saisies ; une donnée absente rend l'indicateur « non évaluable » (null), jamais zéro. La capacité du client
// vient de calculAnalyse.mjs (une seule source). Indicatif : hors fiscalité, assurance et vacance locative.
import { capitalEmpruntable } from "./calculAnalyse.mjs";

export const BLOCS = Object.freeze([
  ["objectifs", "Objectifs et contraintes"], ["point_depart", "Point de départ chiffré"], ["scenarios", "Scénarios comparés"],
  ["fiscal", "Cadre fiscal et juridique"], ["risques", "Risques et points d'attention"], ["feuille_route", "Feuille de route"], ["recommandation", "Recommandation"],
]);
export const BLOCS_PAR_DEFAUT = Object.freeze(["objectifs", "point_depart", "scenarios", "recommandation"]);
/** Blocs connus, sans doublon, dans l'ordre d'affichage. Une valeur inconnue est ignorée. */
export function normaliserBlocs(blocs) {
  const demandes = new Set(Array.isArray(blocs) ? blocs : []);
  return BLOCS.map(([cle]) => cle).filter((cle) => demandes.has(cle));
}

export const REGIMES = Object.freeze({
  nom_propre_micro_foncier: "Nom propre — micro-foncier", nom_propre_reel: "Nom propre — foncier réel", lmnp_micro: "LMNP — micro-BIC", lmnp_reel: "LMNP — réel",
  lmp: "LMP", sci_ir: "SCI à l'IR", sci_is: "SCI à l'IS", holding: "Holding / société d'investissement", demembrement: "Démembrement", autre: "Autre cadre",
});
export const NIVEAUX_RISQUE = Object.freeze({ faible: "Faible", moyen: "Moyen", eleve: "Élevé" });

/** Hypothèses d'un scénario : clé, libellé, unité, bornes [min, max] (null = sans borne haute). */
export const CHAMPS_SCENARIO = Object.freeze([
  ["prix", "Prix d'acquisition", "€", [0, null]], ["travaux", "Travaux", "€", [0, null]], ["frais", "Frais (notaire, agence)", "€", [0, null]],
  ["apport", "Apport", "€", [0, null]], ["tauxPct", "Taux du crédit", "%", [0, 15]], ["dureeAns", "Durée", "ans", [1, 30]],
  ["loyerMensuel", "Loyer mensuel", "€", [0, null]], ["chargesMensuelles", "Charges mensuelles (taxe foncière, copropriété, gestion…)", "€", [0, null]],
]);
export const MAX_SCENARIOS = 4;

const nombre = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const euro = (v) => Math.round(v);
const pct = (v) => Math.round(v * 10) / 10;

/** Mensualité d'un crédit à annuités constantes (hors assurance). Taux nul : capital / nombre de mois. */
export function mensualiteCredit(capital, tauxPct, dureeAns) {
  if (!(capital > 0)) return 0;
  const n = dureeAns * 12, t = tauxPct / 100 / 12;
  return t === 0 ? capital / n : (capital * t) / (1 - Math.pow(1 + t, -n));
}

/** Saisie du formulaire (texte) → hypothèses numériques ; les champs vides sont retirés. */
export function normaliserHypotheses(saisie = {}) {
  const out = {};
  for (const [cle] of CHAMPS_SCENARIO) { const n = nombre(saisie?.[cle]); if (n !== null) out[cle] = n; }
  return out;
}
/** Erreurs de saisie d'un scénario : intitulé obligatoire, nombres valides, bornes respectées. */
export function erreursScenario(s = {}) {
  const e = [];
  if (!String(s.libelle || "").trim()) e.push("Un scénario doit avoir un intitulé.");
  for (const [cle, libelle, , [min, max]] of CHAMPS_SCENARIO) {
    const brut = s.hypotheses?.[cle]; if (brut == null || brut === "") continue;
    const n = nombre(brut);
    if (n === null) e.push(`${libelle} : valeur non numérique.`);
    else if (n < min || (max !== null && n > max)) e.push(`${libelle} : ${max === null ? `à partir de ${min}` : `entre ${min} et ${max}`}.`);
  }
  return e;
}

/**
 * Indicateurs d'un scénario. `contexte` = { mensualiteMax, epargneDisponible } (issus de l'analyse) :
 * compatibilités calculées seulement si la donnée existe, sinon null (« non évaluable »).
 */
export function indicateursScenario(hypotheses = {}, contexte = {}) {
  const h = normaliserHypotheses(hypotheses);
  if (h.prix === undefined || h.prix <= 0) return { evaluable: false, raison: "Prix d'acquisition non renseigné." };
  const cout = h.prix + (h.travaux ?? 0) + (h.frais ?? 0);
  const apport = h.apport ?? 0, emprunt = Math.max(0, cout - apport);
  const financementConnu = emprunt === 0 || (h.tauxPct !== undefined && h.dureeAns !== undefined);
  const mensualite = financementConnu ? mensualiteCredit(emprunt, h.tauxPct ?? 0, h.dureeAns ?? 1) : null;
  const loyer = h.loyerMensuel ?? null, charges = h.chargesMensuelles ?? null;
  const cashflow = loyer !== null && charges !== null && mensualite !== null ? loyer - charges - mensualite : null;
  const { mensualiteMax = null, epargneDisponible = null } = contexte;
  return {
    evaluable: true, cout: euro(cout), apport: euro(apport), apportRenseigne: h.apport !== undefined, emprunt: euro(emprunt),
    mensualite: mensualite === null ? null : euro(mensualite),
    rendementBrutPct: loyer !== null ? pct(((loyer * 12) / cout) * 100) : null,
    rendementNetPct: loyer !== null && charges !== null ? pct((((loyer - charges) * 12) / cout) * 100) : null,
    cashflowMensuel: cashflow === null ? null : euro(cashflow),
    effortEpargneMensuel: cashflow === null ? null : cashflow < 0 ? euro(-cashflow) : 0,
    compatibleCapacite: mensualite === null || mensualiteMax === null ? null : euro(mensualite) <= mensualiteMax,
    apportDisponible: epargneDisponible === null || h.apport === undefined ? null : apport <= epargneDisponible,
  };
}

/** Lignes de risques / feuille de route : les lignes entièrement vides sont ignorées, le reste est nettoyé. */
export function nettoyerRisques(lignes = []) {
  return (Array.isArray(lignes) ? lignes : []).map((l) => ({ libelle: String(l?.libelle || "").trim(), niveau: NIVEAUX_RISQUE[l?.niveau] ? l.niveau : "moyen", mesure: String(l?.mesure || "").trim() }))
    .filter((l) => l.libelle || l.mesure);
}
export function nettoyerFeuilleRoute(lignes = []) {
  return (Array.isArray(lignes) ? lignes : []).map((l) => ({ etape: String(l?.etape || "").trim(), echeance: /^\d{4}-\d{2}-\d{2}$/.test(String(l?.echeance || "")) ? l.echeance : "", responsable: String(l?.responsable || "").trim() }))
    .filter((l) => l.etape || l.responsable || l.echeance);
}

/** Chiffres figés à la validation : capacité du client, budget, scénario recommandé. */
export function chiffresPourValidation({ analyse, scenarios = [], indicateurs = {} } = {}) {
  const rec = scenarios.find((s) => s.recommande);
  const ind = rec ? indicateurs[rec.id] : null;
  return {
    capaciteAchat: analyse?.capacite?.calculable ? analyse.capacite.capaciteAchat : null,
    budget: analyse?.budget?.renseigne ? analyse.budget.valeur : null,
    nbScenarios: scenarios.length,
    recommande: rec ? { id: rec.id, libelle: rec.libelle, mensualite: ind?.mensualite ?? null, cashflowMensuel: ind?.cashflowMensuel ?? null, rendementNetPct: ind?.rendementNetPct ?? null } : null,
  };
}
/** Écarts entre les chiffres figés et ceux d'aujourd'hui (liste vide = rien n'a bougé). */
export function ecartsDepuisValidation(figes, courant) {
  if (!figes) return [];
  const e = [];
  if ((figes.capaciteAchat ?? null) !== (courant.capaciteAchat ?? null)) e.push("capacité d'achat indicative");
  if ((figes.budget ?? null) !== (courant.budget ?? null)) e.push("budget");
  if ((figes.nbScenarios ?? 0) !== (courant.nbScenarios ?? 0)) e.push("nombre de scénarios");
  if (JSON.stringify(figes.recommande ?? null) !== JSON.stringify(courant.recommande ?? null)) e.push("scénario recommandé");
  return e;
}
export { capitalEmpruntable };
