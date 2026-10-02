// src/Invest/structurationProjection.mjs — Scénarios chiffrés, projection patrimoniale et tests de résistance (lot 3).
//
// Module pur : aucune base, aucune horloge (l'année de départ arrive en paramètre).
//
// CE QUE C'EST : un modèle annuel simple qui part des données saisies du dossier, y ajoute les opérations d'un
// scénario, et suit dans le temps la valeur des biens, les dettes (amorties mois par mois), les loyers, le
// cash-flow, les liquidités et le patrimoine net, dans trois cas (prudent, central, dégradé).
//
// CE QUE CE N'EST PAS :
//  • une prévision : les hypothèses ci-dessous sont des valeurs de départ choisies pour être raisonnables et
//    prudentes, pas des données de marché. Elles s'affichent et se modifient ;
//  • un calcul fiscal : tout est AVANT IMPÔT (la fiscalité arrive avec la comparaison des structures) ;
//  • un conseil : les résultats se discutent avec le client et se valident avec l'expert-comptable et le notaire.
//
// Limites connues, remontées dans `limites` à chaque projection :
//  • la dette de la résidence principale est amortie sur une durée résiduelle supposée (le dossier ne porte pas
//    sa mensualité) ; ses échéances ne sont pas décomptées une 2e fois : elles sont déjà dans les charges du foyer ;
//  • la valeur d'un bien acheté est le prix payé : les travaux ne l'augmentent pas (position prudente) ;
//  • un revenu professionnel suit une croissance unique ; pas de retraite, pas de changement de situation familiale.

import { num, analyserBien, analyserFlux, CATEGORIES_CHARGES } from "./structurationDonnees.mjs";
import { mensualitePret } from "./structurationDiagnostic.mjs";

const n0 = (v) => num(v) ?? 0;
const arr = (a) => (Array.isArray(a) ? a : []);

export const CAS = Object.freeze(["prudent", "central", "degrade"]);
export const LIBELLES_CAS = Object.freeze({ prudent: "Prudent", central: "Central", degrade: "Dégradé" });

export const HYPOTHESES_CAS_PAR_DEFAUT = Object.freeze({
  prudent: { appreciation: 1, loyers: 1, vacance: 8, charges: 2.5, revenus: 1, tauxDelta: 0.5, rendementFinancier: 1 },
  central: { appreciation: 2, loyers: 1.5, vacance: 5, charges: 2, revenus: 1.5, tauxDelta: 0, rendementFinancier: 2 },
  degrade: { appreciation: -1, loyers: 0, vacance: 12, charges: 3.5, revenus: 0, tauxDelta: 1.5, rendementFinancier: 0 },
});
export const LIBELLES_HYPOTHESES = Object.freeze({
  appreciation: "Valeur de l'immobilier (%/an)", loyers: "Évolution des loyers (%/an)", vacance: "Vacance locative (%)",
  charges: "Évolution des charges (%/an)", revenus: "Évolution des revenus professionnels (%/an)",
  tauxDelta: "Écart sur le taux des nouveaux crédits (points)", rendementFinancier: "Rendement du patrimoine financier (%/an)",
});
export const HYPOTHESES_GLOBALES_PAR_DEFAUT = Object.freeze({
  tauxCredit: 3.6, assuranceEmprunteur: 0.30, chargesOperationPct: 25, dureeResiduelleRP: 15, horizon: 20,
});

export function hypothesesDe(cas, surcharges = {}) {
  const base = HYPOTHESES_CAS_PAR_DEFAUT[cas] || HYPOTHESES_CAS_PAR_DEFAUT.central;
  const cle = surcharges.parCas?.[cas] || {};
  const h = { ...base };
  for (const k of Object.keys(base)) if (num(cle[k]) !== null) h[k] = num(cle[k]);
  const g = { ...HYPOTHESES_GLOBALES_PAR_DEFAUT };
  for (const k of Object.keys(g)) if (num(surcharges.globales?.[k]) !== null) g[k] = num(surcharges.globales[k]);
  return { ...h, ...g };
}

/** Amortit un prêt sur 12 mois. Renvoie l'état fin d'année. */
export function amortirAnnee(pret) {
  let { crd } = pret, interets = 0, capital = 0, paye = 0;
  if (!(crd > 0) || !(pret.mensualite > 0)) return { crd: Math.max(0, crd), interets, capital, paye };
  const r = (pret.taux || 0) / 100 / 12;
  for (let m = 0; m < 12 && crd > 0; m++) {
    const i = crd * r;
    const p = Math.min(pret.mensualite, crd + i);
    const cap = p - i;
    interets += i; capital += cap; paye += p; crd -= cap;
  }
  return { crd: Math.max(0, crd), interets, capital, paye };
}

/**
 * Projette le patrimoine année après année.
 * @param data        dossier (data.collecte…)
 * @param options.operations  [{annee, libelle, prix, apport, travaux, taux, duree, loyer_mois, charges_pct}]
 * @param options.cas         "prudent" | "central" | "degrade"
 * @param options.anneeDepart première année projetée (ex. 2026)
 * @param options.surcharges  { parCas:{cas:{…}}, globales:{…} } hypothèses modifiées par l'utilisateur
 * @param options.chocs       { travauxPlus%, vacanceMois, loyersPct, valeurPct, chargesPct, perteRevenuMois }
 */
export function projeter(data, { operations = [], cas = "central", anneeDepart, surcharges = {}, chocs = {}, horizon } = {}) {
  const h = hypothesesDe(cas, surcharges);
  const H = Math.max(1, Math.min(30, Math.round(horizon ?? h.horizon)));
  const c = data?.collecte || {};
  const limites = ["Chiffres avant impôt, indicatifs : un modèle annuel simplifié, pas une prévision."];
  const alertes = [];

  // ── Départ : biens, résidence principale, dettes, foyer ────────────────────────────────────────
  const biens = arr(c.patrimoine?.lots).map((l, i) => {
    const a = analyserBien(l);
    const mensualite = num(l.mensualite);
    if ((num(l.crd) ?? 0) > 0 && !(mensualite > 0)) limites.push(`Bien ${l.adresse || i + 1} : dette sans mensualité, elle n'est pas amortie dans la projection.`);
    return {
      nom: l.adresse || `Bien ${i + 1}`, valeur: n0(l.valeur),
      loyerAn: n0(l.loyer_mois) * 12, vacance: n0(l.vacance_pct), chargesAn: a.chargesAnnuelles,
      pret: { crd: n0(l.crd), mensualite: mensualite ?? 0, taux: num(l.taux_pret) ?? h.tauxCredit },
    };
  });
  const rpValeur = n0(c.patrimoine?.rp_valeur);
  const rpCrd0 = n0(c.patrimoine?.rp_crd);
  const rpMensualite = rpCrd0 > 0 ? (mensualitePret(rpCrd0, h.tauxCredit, h.dureeResiduelleRP) ?? 0) : 0;
  if (rpCrd0 > 0) limites.push(`Dette de la résidence principale amortie sur ${h.dureeResiduelleRP} ans supposés (mensualité non saisie) ; ses échéances sont déjà dans les charges du foyer.`);
  let rp = { crd: rpCrd0, mensualite: rpMensualite, taux: h.tauxCredit };
  let autres = arr(c.dettes).map((d) => ({ crd: n0(d.capital_restant), mensualite: n0(d.mensualite), taux: num(d.taux) ?? h.tauxCredit }));

  const flux = analyserFlux(c);
  const chargesSaisies = CATEGORIES_CHARGES.some(([k]) => num(c.charges?.[k]) !== null);
  const revenusProAn = flux.revenusRecurrentsMois * 12;
  const chargesFoyerAn = flux.chargesFoyerMois * 12;
  if (!chargesSaisies) limites.push("Charges du foyer non saisies : l'épargne du foyer n'est pas projetée, seuls les flux des biens et des dettes le sont.");
  if (flux.biensIncomplets > 0) limites.push(`${flux.biensIncomplets} bien(s) sans données complètes : leurs flux sont projetés avec ce qui est saisi.`);

  const fin = c.patrimoine_financier || {};
  const liquidites0 = n0(fin.liquidites);
  const financier0 = Object.entries(fin).filter(([k]) => k !== "liquidites").reduce((s, [, v]) => s + n0(v), 0);

  const ops = arr(operations).filter((o) => num(o.prix) !== null).map((o) => ({
    nom: o.libelle || "Opération", debut: Math.max(1, Math.round((num(o.annee) ?? anneeDepart) - anneeDepart + 1)),
    prix: n0(o.prix), apport: n0(o.apport), travaux: n0(o.travaux), loyerAn: n0(o.loyer_mois) * 12,
    chargesPct: num(o.charges_pct) ?? h.chargesOperationPct,
    taux: (num(o.taux) ?? h.tauxCredit) + h.tauxDelta, duree: num(o.duree) ?? 20,
  }));
  if (arr(operations).some((o) => num(o.prix) === null)) limites.push("Une opération sans prix est ignorée.");

  // ── Boucle annuelle ───────────────────────────────────────────────────────────────────────────
  const annees = [];
  let liquidites = liquidites0, cumulCapital = 0;
  const choc = { travauxPlus: n0(chocs.travauxPlus), vacanceMois: n0(chocs.vacanceMois), loyersPct: n0(chocs.loyersPct), valeurPct: n0(chocs.valeurPct), chargesPct: n0(chocs.chargesPct), perteRevenuMois: n0(chocs.perteRevenuMois) };
  const etatOps = ops.map((o) => {
    const capital = Math.max(0, o.prix - o.apport);
    return { ...o, valeur: o.prix, loyerAn: o.loyerAn, charges: 0, pret: { crd: capital, mensualite: capital > 0 ? (mensualitePret(capital, o.taux, o.duree) ?? 0) : 0, taux: o.taux },
      assuranceAn: capital * (h.assuranceEmprunteur / 100), capital0: capital, actif: false };
  });

  annees.push({
    k: 0, annee: anneeDepart - 1, valeurImmobilier: biens.reduce((s, b) => s + b.valeur, 0) + rpValeur, financier: financier0, liquidites,
    dettes: biens.reduce((s, b) => s + b.pret.crd, 0) + rpCrd0 + autres.reduce((s, d) => s + d.crd, 0),
    loyersEncaisses: null, charges: null, mensualites: null, cashflow: null, capitalRembourse: 0,
  });
  annees[0].liquiditesPlusBas = annees[0].liquidites;
  annees[0].patrimoineNet = annees[0].valeurImmobilier + annees[0].financier + annees[0].liquidites - annees[0].dettes;

  const g = (pct, k) => Math.pow(1 + pct / 100, k);
  for (let k = 1; k <= H; k++) {
    let loyers = 0, charges = 0, mensualites = 0, capitalAnnee = 0, valeurImmo = 0, dettes = 0, sorties = 0;
    const vac = (lotVac) => Math.max(lotVac, h.vacance) / 100;
    for (const b of biens) {
      const brut = b.loyerAn * g(h.loyers, k) * (1 + choc.loyersPct / 100);
      const perteVacance = k === 1 ? b.loyerAn * (choc.vacanceMois / 12) : 0;
      loyers += brut * (1 - vac(b.vacance)) - perteVacance;
      charges += b.chargesAn * g(h.charges, k) * (1 + choc.chargesPct / 100);
      const am = amortirAnnee(b.pret); b.pret = { ...b.pret, crd: am.crd };
      mensualites += am.paye; capitalAnnee += am.capital; dettes += am.crd;
      valeurImmo += b.valeur * g(h.appreciation, k) * (k >= 1 ? 1 + choc.valeurPct / 100 : 1);
    }
    for (const o of etatOps) {
      if (k < o.debut) continue;
      if (k === o.debut) { o.actif = true; sorties += o.apport + o.travaux * (1 + choc.travauxPlus / 100); }
      const kk = k - o.debut + 1;
      const brut = o.loyerAn * g(h.loyers, kk) * (1 + choc.loyersPct / 100);
      const perteVacance = kk === 1 ? o.loyerAn * (choc.vacanceMois / 12) : 0;
      const encaisse = brut * (1 - vac(0)) - perteVacance;
      loyers += encaisse;
      charges += (o.loyerAn * (o.chargesPct / 100)) * g(h.charges, kk) * (1 + choc.chargesPct / 100);
      const vivant = o.pret.crd > 0;
      const am = amortirAnnee(o.pret); o.pret = { ...o.pret, crd: am.crd };
      mensualites += am.paye; capitalAnnee += am.capital; dettes += am.crd;
      if (vivant) charges += o.assuranceAn;
      valeurImmo += o.prix * g(h.appreciation, kk) * (1 + choc.valeurPct / 100);
    }
    const amRp = amortirAnnee(rp); rp = { ...rp, crd: amRp.crd }; capitalAnnee += amRp.capital; dettes += amRp.crd;
    valeurImmo += rpValeur * g(h.appreciation, k) * (1 + choc.valeurPct / 100);
    let paiementsAutres = 0;
    autres = autres.map((d) => { const am = amortirAnnee(d); paiementsAutres += am.paye; capitalAnnee += am.capital; dettes += am.crd; return { ...d, crd: am.crd }; });

    const cashflowBiens = loyers - charges - mensualites;
    let epargneFoyer = 0;
    if (chargesSaisies) {
      const revenus = revenusProAn * g(h.revenus, k) - (k === 1 ? revenusProAn * (choc.perteRevenuMois / 12) : 0);
      epargneFoyer = revenus - chargesFoyerAn * g(h.charges, k) * (1 + choc.chargesPct / 100);
    }
    // L'apport et les travaux se paient le jour de l'achat : la trésorerie doit les couvrir AVANT d'avoir encaissé
    // l'épargne de l'année. On retient donc le point le plus bas de l'année, pas seulement sa fin.
    const liquiditesDebut = liquidites;
    liquidites += epargneFoyer + cashflowBiens - paiementsAutres - sorties;
    cumulCapital += capitalAnnee;
    const financier = financier0 * g(h.rendementFinancier, k);
    const a = {
      k, annee: anneeDepart + k - 1, valeurImmobilier: valeurImmo, financier, liquidites, dettes,
      loyersEncaisses: loyers, charges, mensualites: mensualites + paiementsAutres, cashflow: cashflowBiens - paiementsAutres + epargneFoyer,
      cashflowBiens, capitalRembourse: cumulCapital,
      liquiditesPlusBas: sorties > 0 ? Math.min(liquidites, liquiditesDebut - sorties) : liquidites,
    };
    a.patrimoineNet = valeurImmo + financier + liquidites - dettes;
    annees.push(a);
  }
  const premiereNegative = annees.find((a) => a.liquiditesPlusBas < 0);
  if (premiereNegative) alertes.push(`Liquidités négatives dès ${premiereNegative.annee} : les apports et le cash-flow ne sont pas financés.`);
  const liquiditesMin = Math.min(...annees.map((a) => a.liquiditesPlusBas));
  return { cas, hypotheses: h, annees, alertes, limites: [...new Set(limites)], liquiditesMin, anneeInsuffisance: premiereNegative?.annee ?? null };
}

/** Valeurs d'une projection à des échéances données (5, 10, 20 ans). */
export function jalons(projection, echeances = [5, 10, 20]) {
  return echeances.map((e) => {
    const a = projection.annees[e];
    return a ? { ans: e, ...a } : { ans: e, indisponible: true };
  });
}

/** Compare « actuel » (sans opération) et les scénarios, dans un cas, à un horizon. */
export function comparerScenarios(data, scenarios, { cas = "central", horizon = 10, anneeDepart, surcharges = {} } = {}) {
  const colonnes = [{ id: "actuel", nom: "Situation actuelle", operations: [] }, ...arr(scenarios).map((s) => ({ id: s.id, nom: s.nom || "Scénario", operations: arr(s.operations) }))];
  return colonnes.map((col) => {
    const p = projeter(data, { operations: col.operations, cas, anneeDepart, surcharges, horizon: Math.max(horizon, 1) });
    const a = p.annees[horizon];
    const effortMax = Math.max(0, ...p.annees.slice(1, horizon + 1).map((x) => -x.cashflow));
    return {
      id: col.id, nom: col.nom, nbOperations: col.operations.length,
      patrimoineNet: a.patrimoineNet, dettes: a.dettes, capitalRembourse: a.capitalRembourse,
      cashflowAnnuel: a.cashflow, liquidites: a.liquidites, loyers: a.loyersEncaisses,
      effortEpargneMax: effortMax, liquiditesMin: p.liquiditesMin, anneeInsuffisance: p.anneeInsuffisance,
      alertes: p.alertes, limites: p.limites,
    };
  });
}

export const CHOCS = Object.freeze([
  { cle: "travaux", libelle: "Travaux +20 %", chocs: { travauxPlus: 20 } },
  { cle: "vacance", libelle: "3 mois de vacance sur tous les biens (1re année)", chocs: { vacanceMois: 3 } },
  { cle: "loyers", libelle: "Loyers −10 %", chocs: { loyersPct: -10 } },
  { cle: "valeur", libelle: "Valeur de l'immobilier −10 %", chocs: { valeurPct: -10 } },
  { cle: "charges", libelle: "Charges et taxe foncière +20 %", chocs: { chargesPct: 20 } },
  { cle: "revenu", libelle: "Perte d'un revenu pendant 6 mois (1re année)", chocs: { perteRevenuMois: 6 } },
  { cle: "cumul", libelle: "Cumul : vacance, loyers −10 %, charges +20 %, travaux +20 %", chocs: { travauxPlus: 20, vacanceMois: 3, loyersPct: -10, chargesPct: 20 } },
]);

/**
 * Tests de résistance : la stratégie tient-elle si les hypothèses ne se réalisent pas ?
 * Réponse concrète : la trésorerie reste-t-elle positive sur les 5 premières années, et quel est le pire cash-flow ?
 */
export function testsResistance(data, { operations = [], anneeDepart, surcharges = {}, cas = "central", horizonTest = 5 } = {}) {
  const base = projeter(data, { operations, cas, anneeDepart, surcharges, horizon: horizonTest });
  const lecture = (p) => {
    const fenetre = p.annees.slice(1, horizonTest + 1);
    const min = Math.min(...fenetre.map((a) => a.liquiditesPlusBas));
    const neg = fenetre.find((a) => a.liquiditesPlusBas < 0);
    return {
      liquiditesMin: min, anneeInsuffisance: neg?.annee ?? null,
      pireCashflow: Math.min(...fenetre.map((a) => a.cashflow)),
      patrimoineNetFin: fenetre[fenetre.length - 1].patrimoineNet,
      tient: !neg,
    };
  };
  const ref = lecture(base);
  return {
    reference: ref,
    chocs: CHOCS.map((c) => {
      const p = projeter(data, { operations, cas, anneeDepart, surcharges, chocs: c.chocs, horizon: horizonTest });
      const l = lecture(p);
      return { ...c, ...l, ecartLiquiditesMin: l.liquiditesMin - ref.liquiditesMin, ecartPatrimoineNet: l.patrimoineNetFin - ref.patrimoineNetFin };
    }),
  };
}

/** Une opération est exploitable si elle a au moins un prix et une année. */
export function operationComplete(o = {}) {
  return num(o.prix) !== null && num(o.annee) !== null;
}
