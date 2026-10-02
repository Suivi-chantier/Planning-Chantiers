// src/Invest/dossiers/calculAnalyse.mjs — calculs PURS de l'onglet Analyse d'une mission.
// Aucun accès Supabase, aucune horloge. Les chiffres viennent de la Situation patrimoniale (2c) et du
// Projet (2d) de la mission, déjà calculés : rien n'est recalculé en parallèle (« même chiffre = même service »).
// La capacité d'investissement est INDICATIVE : elle dépend d'hypothèses modifiables et ignore frais de
// notaire, garanties et revenus locatifs futurs.

export const HYPOTHESES_DEFAUT = Object.freeze({ tauxPct: 3.8, dureeAns: 25, endettementMaxPct: 35 });
export const BORNES = Object.freeze({ tauxPct: [0, 15], dureeAns: [5, 30], endettementMaxPct: [10, 50] });
export const LIBELLES_HYPOTHESES = Object.freeze({ tauxPct: "Taux du crédit (%)", dureeAns: "Durée (ans)", endettementMaxPct: "Endettement maximal (%)" });

const nombre = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const euro = (v) => Math.round(v);

/** Hypothèses saisies (texte ou nombre) : { valides, erreurs }. Une valeur absente prend la valeur par défaut. */
export function validerHypotheses(saisie = {}) {
  const valides = {}, erreurs = [];
  for (const cle of Object.keys(BORNES)) {
    const brut = saisie?.[cle];
    if (brut == null || brut === "") { valides[cle] = HYPOTHESES_DEFAUT[cle]; continue; }
    const n = nombre(brut), [min, max] = BORNES[cle];
    if (n === null) { erreurs.push(`${LIBELLES_HYPOTHESES[cle]} : valeur non numérique.`); valides[cle] = HYPOTHESES_DEFAUT[cle]; }
    else if (n < min || n > max) { erreurs.push(`${LIBELLES_HYPOTHESES[cle]} : entre ${min} et ${max}.`); valides[cle] = HYPOTHESES_DEFAUT[cle]; }
    else valides[cle] = n;
  }
  return { valides, erreurs };
}

/** Capital qu'une mensualité permet d'emprunter (annuités constantes). Taux nul : mensualité × nombre de mois. */
export function capitalEmpruntable(mensualite, tauxPct, dureeAns) {
  const n = dureeAns * 12, t = tauxPct / 100 / 12;
  if (!(mensualite > 0)) return 0;
  return t === 0 ? mensualite * n : (mensualite * (1 - Math.pow(1 + t, -n))) / t;
}

/**
 * Analyse chiffrée d'une mission. `situation` = fiche.situation (calculerSituation), `projet` = fiche.projet.
 * Une donnée absente rend le résultat « non évaluable » ; elle n'est jamais présentée comme zéro.
 */
export function calculerAnalyse({ situation = {}, projet = {}, hypotheses = {} } = {}) {
  const h = validerHypotheses(hypotheses).valides;
  const revenus = nombre(situation.revenusMensuels) ?? 0, charges = nombre(situation.chargesMensuelles) ?? 0;
  const credits = (nombre(situation.mensualitesCredits) ?? 0) + (nombre(situation.assuranceCredits) ?? 0);
  const inc = situation.incomplets || {};
  const avertissements = [];
  if (inc.revenusBaseNonPrecisee > 0) avertissements.push(`${inc.revenusBaseNonPrecisee} revenu(x) sans base précisée (net avant ou après impôt) : le taux d'endettement est à confirmer.`);
  if (inc.creditsSansMensualite > 0) avertissements.push(`${inc.creditsSansMensualite} crédit(s) sans mensualité : les mensualités sont sous-estimées.`);
  if (inc.creditsSansCrd > 0) avertissements.push(`${inc.creditsSansCrd} crédit(s) sans capital restant dû : le patrimoine net est incomplet.`);
  if (inc.actifsSansValeur > 0) avertissements.push(`${inc.actifsSansValeur} bien(s) sans valeur estimée : le patrimoine est incomplet.`);

  const revenusConnus = revenus > 0;
  const base = {
    hypotheses: h, avertissements,
    revenus: euro(revenus), charges: euro(charges), creditsEnCours: euro(credits),
    resteMensuel: revenusConnus ? euro(revenus - charges - credits) : null,
    tauxEndettementPct: revenusConnus ? Math.round((credits / revenus) * 1000) / 10 : null,
    epargneDisponible: nombre(situation.epargneDisponible), patrimoineNet: nombre(situation.patrimoineNetSimplifie),
  };
  if (!revenusConnus) {
    return { ...base, capacite: { calculable: false, raison: "Revenus non renseignés dans la Situation patrimoniale : capacité non évaluable." }, budget: { renseigne: false, verdict: "non_evaluable" } };
  }
  const mensualiteMax = Math.max(0, (revenus * h.endettementMaxPct) / 100 - credits);
  const capital = capitalEmpruntable(mensualiteMax, h.tauxPct, h.dureeAns);
  const apport = nombre(projet.apport), budget = nombre(projet.budget);
  const capaciteAchat = capital + (apport ?? 0);
  const capacite = { calculable: true, mensualiteMax: euro(mensualiteMax), capitalEmpruntable: euro(capital), apport: apport === null ? null : euro(apport), capaciteAchat: euro(capaciteAchat) };
  if (budget === null || budget <= 0) return { ...base, capacite, budget: { renseigne: false, verdict: "non_evaluable" } };
  const ecart = euro(capaciteAchat - budget);
  return { ...base, capacite, budget: { renseigne: true, valeur: euro(budget), ecart, verdict: ecart >= 0 ? "compatible" : "au_dessus" } };
}

export const LIBELLES_VERDICT = Object.freeze({ compatible: "Budget compatible avec la capacité indicative", au_dessus: "Budget au-dessus de la capacité indicative", non_evaluable: "Budget non évaluable" });

/** Chiffres figés à la validation de l'analyse. */
export function chiffresPourValidation(a) {
  return { revenus: a.revenus, charges: a.charges, creditsEnCours: a.creditsEnCours, capaciteAchat: a.capacite.calculable ? a.capacite.capaciteAchat : null,
    budget: a.budget.renseigne ? a.budget.valeur : null, hypotheses: a.hypotheses };
}
/** Écarts entre les chiffres figés et ceux d'aujourd'hui (liste vide = rien n'a bougé). */
export function ecartsDepuisValidation(figes, courant) {
  if (!figes) return [];
  const actuels = chiffresPourValidation(courant), noms = { revenus: "revenus", charges: "charges", creditsEnCours: "crédits en cours", capaciteAchat: "capacité d'achat indicative", budget: "budget" };
  return Object.entries(noms).filter(([cle]) => (figes[cle] ?? null) !== (actuels[cle] ?? null)).map(([, libelle]) => libelle);
}
