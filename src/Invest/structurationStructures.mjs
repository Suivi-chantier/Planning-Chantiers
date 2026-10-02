// src/Invest/structurationStructures.mjs — Comparaison de la détention d'UNE acquisition selon la structure (lot 4).
//
// Quatre structures : nom propre en location nue, nom propre en meublé non professionnel (LMNP), SCI à l'IR,
// SCI à l'IS. Pour chacune, sur un horizon donné : fiscalité à l'entrée, fiscalité annuelle, trésorerie réellement
// disponible, fiscalité de sortie, complexité et coûts. La transmission (donation de parts, démembrement) n'est
// PAS calculée : elle est signalée comme sujet à valider avec le notaire.
//
// Module pur : aucune base, aucune horloge.
//
// ESTIMATION, PAS UN CONSEIL : ce module applique des règles simplifiées (voir REGLES) à un foyer décrit par sa seule
// tranche marginale d'imposition. Il ne calcule pas le quotient familial, la surtaxe sur les plus-values élevées,
// l'IFI, les dispositifs particuliers (Pinel, Denormandie, Malraux, monuments historiques), la CFE ni la TVA.
// Un résultat ne désigne jamais « la meilleure structure » : il met les chiffres côte à côte pour en discuter
// avec l'expert-comptable et le notaire, qui valident.
//
// Règles retenues et leur statut (vérifié le 02/10/2026 sur des sources en ligne, pas sur les textes officiels,
// sauf mention) :
//  confirmées : barème IR 2026 (par la TMI saisie) ; prélèvements sociaux 17,2 % sur revenus fonciers, meublés
//    et plus-values immobilières ; PFU 31,4 % (12,8 + 18,6) sur dividendes ; IS 15 % jusqu'à 42 500 € puis 25 % ;
//    plus-value de SCI à l'IS sur valeur nette comptable, sans abattement de durée ; plus-value des particuliers
//    19 % + 17,2 % avec abattements (IR : 6 %/an de la 6e à la 21e année, 4 % la 22e ; PS : 1,65 %/an de la 6e à la
//    21e, 1,60 % la 22e, 9 %/an de la 23e à la 30e) ; micro-BIC 50 % jusqu'à 77 700 € ; réintégration des
//    amortissements LMNP au réel dans la plus-value (cessions depuis le 15/02/2025) ;
//  confirmées par la vérification fournie par Matthieu (impots.gouv.fr, Bofip, service-public.fr) : micro-foncier
//    30 % jusqu'à 15 000 € ; déficit foncier imputable sur le revenu global jusqu'à 10 700 €/an (hors intérêts,
//    le reste reportable 10 ans) ; LMP au-delà de 23 000 € de recettes ET plus que les autres revenus
//    professionnels du foyer ; donation 100 000 € par parent et par enfant tous les 15 ans.
//  NON retenue : la décote de 15 à 25 % sur les parts de SCI n'est pas un taux légal, elle se justifie au cas par
//    cas (illiquidité, minorité, statuts) : elle n'est donc pas modélisée.
//  hypothèses de modélisation (modifiables, à faire valider) : frais d'acquisition 7,5 %, terrain 15 % non
//    amortissable, amortissement linéaire sur 30 ans (les composants réels amortissent plus vite), pas de forfait
//    travaux de 15 % sur la plus-value, frais annuels de comptabilité.

import { num } from "./structurationDonnees.mjs";
import { mensualitePret } from "./structurationDiagnostic.mjs";
import { amortirAnnee, hypothesesDe } from "./structurationProjection.mjs";

const n0 = (v) => num(v) ?? 0;

export const REGLES = Object.freeze({
  prelevementsSociaux: 17.2,
  pfu: 31.4,
  isTauxReduit: 15, isSeuilTauxReduit: 42500, isTauxNormal: 25,
  plusValueIR: 19, plusValuePS: 17.2,
  microFoncierPlafond: 15000, microFoncierAbattement: 30,
  microBICPlafond: 77700, microBICAbattement: 50,
  deficitFoncierPlafond: 10700,
  lmpSeuilRecettes: 23000,
});

export const HYPOTHESES_STRUCTURES_PAR_DEFAUT = Object.freeze({
  horizon: 10, tmi: "", fraisAcquisitionPct: 7.5, terrainPct: 15, dureeAmortissement: 30,
  fraisCreationSociete: 1500, comptabiliteSciIR: 600, comptabiliteLmnpReel: 600, comptabiliteSciIS: 1500,
});

export const STRUCTURES = Object.freeze([
  { cle: "nom_propre_nu", libelle: "Nom propre — location nue" },
  { cle: "lmnp", libelle: "Nom propre — meublé non professionnel (LMNP)" },
  { cle: "sci_ir", libelle: "SCI à l'IR" },
  { cle: "sci_is", libelle: "SCI à l'IS" },
]);

/** Abattements pour durée de détention (particuliers, plus-value immobilière). */
export function abattementsDuree(annees) {
  const n = Math.max(0, Math.floor(annees));
  let ir = 0, ps = 0;
  for (let a = 6; a <= n; a++) {
    if (a <= 21) { ir += 6; ps += 1.65; }
    else if (a === 22) { ir += 4; ps += 1.6; }
    else if (a <= 30) { ps += 9; }
  }
  return { ir: Math.min(100, ir), ps: Math.min(100, ps) };
}

/** Impôt sur les sociétés d'une année : 15 % jusqu'à 42 500 €, 25 % au-delà. */
export function impotSocietes(resultat) {
  if (!(resultat > 0)) return 0;
  const bas = Math.min(resultat, REGLES.isSeuilTauxReduit);
  return bas * REGLES.isTauxReduit / 100 + (resultat - bas) * REGLES.isTauxNormal / 100;
}

/** Tranche marginale saisie dans le dossier (« 30 % » → 30). */
export function lireTmi(valeur) {
  const m = String(valeur ?? "").match(/(\d+(?:[.,]\d+)?)/);
  const t = m ? Number(m[1].replace(",", ".")) : null;
  return t !== null && t >= 0 && t <= 45 ? t : null;
}

function plusValueParticulier({ vente, coutAcquisition, annees, amortissementsReintegres = 0 }) {
  const brute = vente - coutAcquisition + amortissementsReintegres;
  if (brute <= 0) return { brute, impot: 0, detail: "Pas de plus-value imposable." };
  const ab = abattementsDuree(annees);
  const baseIR = brute * (1 - ab.ir / 100), basePS = brute * (1 - ab.ps / 100);
  const impot = baseIR * REGLES.plusValueIR / 100 + basePS * REGLES.plusValuePS / 100;
  return { brute, impot, baseIR, basePS, abattementIR: ab.ir, abattementPS: ab.ps, surtaxePossible: baseIR > 50000,
    detail: `Plus-value brute ${Math.round(brute)} €, abattements ${ab.ir} % (IR) et ${ab.ps.toFixed(2)} % (PS).` };
}

/**
 * Simule UNE structure année par année.
 * Renvoie le détail annuel, les totaux et les avertissements.
 */
function simuler(cle, ctx, regime) {
  const { op, hyp, H, tmi, loyerMeubleAn } = ctx;
  const capital = Math.max(0, op.prix - op.apport);
  const mens = capital > 0 ? (mensualitePret(capital, op.taux, op.duree) ?? 0) : 0;
  let pret = { crd: capital, mensualite: mens, taux: op.taux };
  const assuranceAn = capital * (hyp.assuranceEmprunteur / 100);
  const coutAcq = op.prix + op.prix * hyp.fraisAcquisitionPct / 100 + op.travaux;
  const baseAmortissable = (op.prix * (1 - hyp.terrainPct / 100)) + op.travaux;
  const amortAn = baseAmortissable / hyp.dureeAmortissement;
  const fraisStructure = { nom_propre_nu: 0, lmnp: regime === "reel" ? hyp.comptabiliteLmnpReel : 0, sci_ir: hyp.comptabiliteSciIR, sci_is: hyp.comptabiliteSciIS }[cle];
  const annees = [];
  let reportDeficit = 0, reportAmort = 0, amortCumul = 0, cumulCashApresImpot = 0, cumulImpot = 0;
  const alertes = [];
  for (let k = 1; k <= H; k++) {
    const brut = (cle === "lmnp" ? loyerMeubleAn : op.loyerAn) * Math.pow(1 + hyp.loyers / 100, k - 1);
    const recettes = brut * (1 - hyp.vacance / 100);
    const chargesExploit = op.loyerAn * (op.chargesPct / 100) * Math.pow(1 + hyp.charges / 100, k - 1);
    const am = amortirAnnee(pret); pret = { ...pret, crd: am.crd };
    const assurance = am.crd > 0 || am.capital > 0 ? assuranceAn : 0;
    const frais = fraisStructure;
    const cashAvantImpot = recettes - chargesExploit - assurance - frais - am.paye;
    let impot = 0, resultatFiscal = 0, note = "";
    if (cle === "nom_propre_nu" || cle === "sci_ir") {
      if (regime === "micro") {
        resultatFiscal = recettes * (1 - REGLES.microFoncierAbattement / 100);
        impot = resultatFiscal * (tmi + REGLES.prelevementsSociaux) / 100;
      } else {
        const deductibles = chargesExploit + assurance + frais + am.interets;
        let res = recettes - deductibles;
        if (res < 0) {
          const deficit = -res;
          const partInterets = Math.min(deficit, am.interets);
          const imputable = Math.min(REGLES.deficitFoncierPlafond, Math.max(0, deficit - partInterets));
          reportDeficit += deficit - imputable;
          impot = imputable > 0 ? -imputable * tmi / 100 : 0; // économie d'impôt sur le revenu global
          res = 0; note = "Déficit foncier";
        } else {
          const utilise = Math.min(res, reportDeficit); res -= utilise; reportDeficit -= utilise;
          impot = res * (tmi + REGLES.prelevementsSociaux) / 100;
        }
        resultatFiscal = res;
      }
    } else if (cle === "lmnp") {
      if (regime === "micro") {
        resultatFiscal = recettes * (1 - REGLES.microBICAbattement / 100);
      } else {
        const avantAmort = recettes - chargesExploit - assurance - frais - am.interets;
        const dispo = amortAn + reportAmort;
        const utilise = Math.max(0, Math.min(dispo, avantAmort));
        reportAmort = dispo - utilise; amortCumul += utilise;
        resultatFiscal = Math.max(0, avantAmort - utilise);
        if (avantAmort < 0) note = "Déficit meublé reportable (non modélisé)";
      }
      impot = resultatFiscal * (tmi + REGLES.prelevementsSociaux) / 100;
    } else if (cle === "sci_is") {
      const amortUtilise = amortAn; amortCumul += amortUtilise;
      let res = recettes - chargesExploit - assurance - frais - am.interets - amortUtilise;
      if (res < 0) { reportDeficit += -res; res = 0; }
      else { const u = Math.min(res, reportDeficit); res -= u; reportDeficit -= u; }
      resultatFiscal = res; impot = impotSocietes(res);
    }
    const cashApres = cashAvantImpot - impot;
    cumulCashApresImpot += cashApres; cumulImpot += impot;
    annees.push({ k, recettes, charges: chargesExploit + assurance + frais, interets: am.interets, capitalRembourse: am.capital, mensualites: am.paye,
      resultatFiscal, impot, cashAvantImpot, cashApresImpot: cashApres, crd: am.crd, note });
  }
  // Sortie
  const vente = op.prix * Math.pow(1 + hyp.appreciation / 100, H);
  const crdFin = annees[annees.length - 1].crd;
  let sortie;
  if (cle === "sci_is") {
    const vnc = coutAcq - amortCumul;
    const pv = vente - vnc;
    const isSortie = Math.max(0, pv) * REGLES.isTauxNormal / 100;
    const netSociete = vente - crdFin - isSortie;
    const aDistribuer = Math.max(0, netSociete + cumulCashApresImpot - ctx.apportTotal);
    const pfu = aDistribuer * REGLES.pfu / 100;
    sortie = { vente, plusValue: pv, impotSortie: isSortie + pfu, impotSociete: isSortie, impotDistribution: pfu,
      detail: `Plus-value de société sur valeur nette comptable (${Math.round(vnc)} €), puis impôt de distribution estimé à ${REGLES.pfu} % sur ${Math.round(aDistribuer)} € (double imposition).` };
  } else {
    const reint = cle === "lmnp" && regime === "reel" ? amortCumul : 0;
    const pv = plusValueParticulier({ vente, coutAcquisition: coutAcq, annees: H, amortissementsReintegres: reint });
    sortie = { vente, plusValue: pv.brute, impotSortie: pv.impot, detail: pv.detail + (reint ? ` Amortissements réintégrés : ${Math.round(reint)} €.` : "") };
    if (pv.surtaxePossible) alertes.push("Plus-value élevée : une surtaxe peut s'ajouter (non calculée).");
  }
  const gainNet = cumulCashApresImpot + (vente - crdFin) - ctx.apportTotal - sortie.impotSortie;
  return {
    cle, regime, annees, sortie,
    entree: { frais: op.prix * hyp.fraisAcquisitionPct / 100 + (cle === "sci_ir" || cle === "sci_is" ? hyp.fraisCreationSociete : 0), apport: op.apport },
    annuel: { impotMoyen: cumulImpot / H, cashApresImpotMoyen: cumulCashApresImpot / H, impotAnnee1: annees[0].impot },
    tresorerie: { cumulCashApresImpot, crdFin },
    gainNet, alertes,
  };
}

const COMPLEXITE = Object.freeze({
  nom_propre_nu: { niveau: "Simple", texte: "Déclaration de revenus fonciers (2044) ou micro-foncier ; aucune comptabilité." },
  lmnp: { niveau: "Intermédiaire", texte: "Micro-BIC simple, ou liasse fiscale et comptabilité d'amortissements au réel (expert-comptable conseillé)." },
  sci_ir: { niveau: "Intermédiaire", texte: "Création des statuts, assemblée annuelle, déclaration 2072 ; fiscalité identique à la détention directe, avec des avantages de gestion et de transmission à étudier avec le notaire." },
  sci_is: { niveau: "Avancée", texte: "Comptabilité d'engagement, bilan et liasse annuels, IS ; sortie de la trésorerie par dividendes (double imposition)." },
});

/**
 * Compare les structures pour une acquisition.
 * @param data  dossier (pour la TMI et les autres revenus)
 * @param operation { prix, apport, travaux, taux, duree, loyer_mois, loyer_meuble_mois, charges_pct }
 */
export function comparerStructures(data, operation, { surcharges = {}, parametres = {} } = {}) {
  const hyp0 = hypothesesDe("central", surcharges);
  const p = { ...HYPOTHESES_STRUCTURES_PAR_DEFAUT };
  for (const k of Object.keys(p)) if (parametres[k] !== undefined && parametres[k] !== "" && (typeof p[k] === "string" || num(parametres[k]) !== null)) p[k] = typeof p[k] === "string" ? parametres[k] : num(parametres[k]);
  const hyp = { ...hyp0, ...p };
  const manquants = [];
  const prix = num(operation?.prix);
  if (prix === null) manquants.push("prix de l'acquisition");
  if (num(operation?.loyer_mois) === null) manquants.push("loyer attendu");
  const tmi = lireTmi(p.tmi !== "" ? p.tmi : data?.collecte?.profil?.tmi);
  if (tmi === null) manquants.push("tranche marginale d'imposition (TMI) du foyer");
  if (manquants.length) return { manquants, structures: [], avertissements: [] };

  const op = {
    prix, apport: n0(operation.apport), travaux: n0(operation.travaux), taux: (num(operation.taux) ?? hyp.tauxCredit) + 0,
    duree: num(operation.duree) ?? 20, loyerAn: n0(operation.loyer_mois) * 12,
    chargesPct: num(operation.charges_pct) ?? hyp.chargesOperationPct,
  };
  const H = Math.max(3, Math.min(30, Math.round(hyp.horizon)));
  const loyerMeubleAn = (num(operation.loyer_meuble_mois) ?? n0(operation.loyer_mois)) * 12;
  // L'apport saisi inclut les frais d'acquisition (même convention que les scénarios chiffrés).
  const ctx = { op, hyp, H, tmi, loyerMeubleAn, apportTotal: op.apport };
  const avertissements = [
    "Estimation avant décisions : règles simplifiées, foyer décrit par sa seule TMI. À valider par l'expert-comptable.",
    "Transmission (donation de parts, démembrement) non calculée : sujet à valider avec le notaire.",
    "Quotient familial, surtaxe sur plus-values élevées, IFI, dispositifs particuliers, CFE et TVA ne sont pas modélisés.",
  ];
  if (op.apport < op.prix * hyp.fraisAcquisitionPct / 100) avertissements.push("L'apport saisi est inférieur aux frais d'acquisition supposés : le financement des frais n'est pas modélisé.");

  const profilPro = (n0(data?.collecte?.profil?.revenus_nets_mois) + n0(data?.collecte?.profil?.revenus_conjoint_mois)) * 12;
  const recettesMeuble = loyerMeubleAn * (1 - hyp.vacance / 100);
  const choisir = (cle, regimes) => {
    const essais = regimes.map((r) => simuler(cle, ctx, r));
    return essais.reduce((a, b) => (b.gainNet > a.gainNet ? b : a));
  };
  const structures = STRUCTURES.map((s) => {
    let res;
    if (s.cle === "nom_propre_nu" || s.cle === "sci_ir") {
      const regimes = ["reel"]; if (op.loyerAn * (1 - hyp.vacance / 100) <= REGLES.microFoncierPlafond && s.cle === "nom_propre_nu") regimes.push("micro");
      res = choisir(s.cle, regimes);
    } else if (s.cle === "lmnp") {
      const regimes = ["reel"]; if (recettesMeuble <= REGLES.microBICPlafond) regimes.push("micro");
      res = choisir(s.cle, regimes);
    } else res = simuler(s.cle, ctx, "is");
    const alertes = [...res.alertes];
    if (s.cle === "lmnp" && recettesMeuble > REGLES.lmpSeuilRecettes && recettesMeuble > profilPro) alertes.push("Recettes meublées supérieures à 23 000 € et aux autres revenus professionnels : bascule en loueur meublé professionnel (LMP) possible, régime différent à étudier.");
    return { ...s, ...res, alertes, complexite: COMPLEXITE[s.cle],
      libelleRegime: { micro: s.cle === "lmnp" ? "micro-BIC" : "micro-foncier", reel: "régime réel", is: "impôt sur les sociétés" }[res.regime] };
  });
  return { manquants: [], structures, avertissements, horizon: H, tmi, hypotheses: hyp };
}
