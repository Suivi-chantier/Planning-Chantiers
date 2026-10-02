// src/Invest/structurationDiagnostic.mjs — Diagnostic automatique d'un dossier de structuration (lot 2).
//
// Module pur : les données du dossier arrivent en paramètre. Il produit
//   1. la situation chiffrée (patrimoine brut, dettes, net, composition, flux, endettement) ;
//   2. forces, faiblesses, risques et opportunités, chacun avec le chiffre qui le justifie ;
//   3. la capacité d'emprunt EN TRAJECTOIRE : immédiate, puis après chaque opération envisagée.
//
// Honnêteté des chiffres :
//  • tout est avant impôt et indicatif ; les seuils sont des repères de lecture (affichés avec leur valeur),
//    pas des règles de décision. Le plafond d'endettement de 35 % est la norme bancaire usuelle (HCSF), modifiable ;
//  • une donnée manquante n'est jamais un zéro : l'indicateur vaut `null`, et la règle qui en dépend ne se déclenche pas ;
//  • même composition du patrimoine brut que l'écran existant (biens locatifs + résidence principale +
//    patrimoine financier). La résidence secondaire et le patrimoine professionnel n'y sont pas ajoutés : s'ils sont
//    saisis, le diagnostic le signale au lieu de les ajouter en silence.

import { num, analyserBien, analyserFlux, analyserDettes } from "./structurationDonnees.mjs";

const n0 = (v) => num(v) ?? 0;
const arr = (a) => (Array.isArray(a) ? a : []);

export const HYPOTHESES_PAR_DEFAUT = Object.freeze({
  plafondEndettement: 35,     // % des revenus retenus (norme bancaire usuelle)
  tauxCredit: 3.6,            // % — à ajuster à la date de l'étude
  dureeCredit: 20,            // années
  assuranceEmprunteur: 0.30,  // % annuel du capital emprunté
  loyersRetenusBanque: 70,    // % des loyers pris en compte par la banque
  moisReserve: 6,             // réserve de sécurité visée, en mois de dépenses
  concentrationImmobilier: 70,// % du patrimoine brut au-delà duquel on signale une concentration
});

/** Mensualité d'un prêt amortissable (capital, taux annuel en %, durée en années). */
export function mensualitePret(capital, tauxAn, annees) {
  const P = num(capital), t = num(tauxAn), d = num(annees);
  if (P === null || d === null || d <= 0) return null;
  if (!t) return P / (d * 12);
  const r = t / 100 / 12, n = d * 12;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}
/** Capital empruntable pour une mensualité donnée (inverse de la précédente). */
export function capitalPourMensualite(mensualite, tauxAn, annees) {
  const M = num(mensualite), t = num(tauxAn), d = num(annees);
  if (M === null || M <= 0 || d === null || d <= 0) return 0;
  if (!t) return M * d * 12;
  const r = t / 100 / 12, n = d * 12;
  return (M * (1 - Math.pow(1 + r, -n))) / r;
}

const LIQUIDES = ["liquidites"];

export function situation(data) {
  const c = data?.collecte || {};
  const lots = arr(c.patrimoine?.lots);
  const immoLocatif = lots.reduce((s, l) => s + n0(l.valeur), 0);
  const rp = n0(c.patrimoine?.rp_valeur);
  const fin = c.patrimoine_financier || {};
  const liquidites = LIQUIDES.reduce((s, k) => s + n0(fin[k]), 0);
  const financierHorsLiquidites = Object.entries(fin).filter(([k]) => !LIQUIDES.includes(k)).reduce((s, [, v]) => s + n0(v), 0);
  const brut = immoLocatif + rp + liquidites + financierHorsLiquidites;
  const autres = analyserDettes(c.dettes);
  const crdLots = lots.reduce((s, l) => s + n0(l.crd), 0);
  const crdRp = n0(c.patrimoine?.rp_crd);
  const dettes = crdLots + crdRp + autres.capitalRestant;
  const flux = analyserFlux(c);
  const mensualitesBiens = lots.reduce((s, l) => s + n0(l.mensualite), 0);
  const mensualitesTotal = num(c.financement?.mensualites_total) ?? (mensualitesBiens + autres.mensualites);
  const part = (v) => (brut > 0 ? v / brut : null);
  const nonCompte = [];
  if (n0(c.patrimoine?.residence_secondaire_valeur)) nonCompte.push("résidence secondaire");
  if (n0(c.patrimoine?.patrimoine_professionnel)) nonCompte.push("patrimoine professionnel");
  const revenusAn = flux.revenusRecurrentsMois * 12;
  return {
    patrimoineBrut: brut, dettes, patrimoineNet: brut - dettes,
    liquidites,
    composition: { immobilier: immoLocatif + rp, financier: financierHorsLiquidites, liquidites, partImmobilier: part(immoLocatif + rp), partFinancier: part(financierHorsLiquidites), partLiquidites: part(liquidites) },
    repartitionDettes: [
      { libelle: "Immobilier locatif", montant: crdLots },
      { libelle: "Résidence principale", montant: crdRp },
      { libelle: "Autres dettes", montant: autres.capitalRestant },
    ].filter((x) => x.montant > 0),
    revenusAnnuelsRecurrents: revenusAn,
    epargneAnnuelle: flux.epargneReelle === null ? null : flux.epargneReelle * 12,
    capaciteEpargneTheorique: flux.capaciteEpargneTheorique,
    cashflowImmobilierMois: flux.cashflowBiensMois,
    biensIncomplets: flux.biensIncomplets,
    mensualitesTotal,
    chargesFoyerMois: flux.chargesFoyerMois,
    tmi: String(c.profil?.tmi || "").trim() || null,
    nonCompte,
    revenusMensuels: flux.revenusRecurrentsMois,
    loyersMensuels: lots.reduce((s, l) => s + n0(l.loyer_mois), 0),
  };
}

/** Revenus tels que la banque les lit : revenus du foyer + part des loyers. */
export function revenusBancaires(data, h = HYPOTHESES_PAR_DEFAUT) {
  const s = situation(data);
  return s.revenusMensuels + s.loyersMensuels * (h.loyersRetenusBanque / 100);
}

/**
 * Capacité d'emprunt en trajectoire. `operations` : { libelle, prix, apport, taux, duree, loyer_mois }.
 * Chaque opération réduit la capacité restante (nouvelle mensualité) et l'augmente d'une part de son loyer.
 */
export function trajectoireCapacite(data, operations = [], hypotheses = {}) {
  const h = { ...HYPOTHESES_PAR_DEFAUT, ...hypotheses };
  const s = situation(data);
  const plafond = h.plafondEndettement / 100;
  const etapes = [];
  let revenus = revenusBancaires(data, h);
  let mensualites = s.mensualitesTotal;
  const etat = (libelle, extra = {}) => {
    const taux = revenus > 0 ? mensualites / revenus : null;
    const marge = revenus > 0 ? Math.max(0, plafond * revenus - mensualites) : null;
    etapes.push({
      libelle, revenusRetenus: revenus, mensualitesTotal: mensualites, tauxEndettement: taux,
      mensualiteDisponible: marge,
      capitalEmpruntable: marge === null ? null : capitalPourMensualite(marge, h.tauxCredit, h.dureeCredit),
      lecture: taux === null ? "non calculable" : taux > plafond ? "au-dessus du plafond" : taux > plafond * 0.9 ? "limite" : "dans la norme",
      ...extra,
    });
  };
  etat("Aujourd'hui");
  arr(operations).forEach((op, i) => {
    const prix = num(op.prix), apport = n0(op.apport);
    if (prix === null) { etat(`Après l'opération ${i + 1}`, { incomplete: true, motif: "prix manquant" }); return; }
    const capital = Math.max(0, prix - apport);
    const m = mensualitePret(capital, num(op.taux) ?? h.tauxCredit, num(op.duree) ?? h.dureeCredit);
    const assurance = (capital * (h.assuranceEmprunteur / 100)) / 12;
    mensualites += (m ?? 0) + assurance;
    revenus += n0(op.loyer_mois) * (h.loyersRetenusBanque / 100);
    etat(`Après l'opération ${i + 1}${op.libelle ? ` — ${op.libelle}` : ""}`, { mensualiteOperation: (m ?? 0) + assurance, capitalEmprunte: capital });
  });
  return { hypotheses: h, etapes };
}

const eur = (v) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`;
const pc = (v) => `${Math.round(v * 100)} %`;

/** Forces, faiblesses, risques, opportunités. Chaque ligne porte le chiffre qui la justifie. */
export function analyserSwot(data, hypotheses = {}) {
  const h = { ...HYPOTHESES_PAR_DEFAUT, ...hypotheses };
  const c = data?.collecte || {};
  const s = situation(data);
  const lots = arr(c.patrimoine?.lots);
  const out = { forces: [], faiblesses: [], risques: [], opportunites: [] };
  const add = (cat, titre, detail) => out[cat].push({ titre, detail });
  const rev = revenusBancaires(data, h);
  const taux = rev > 0 ? s.mensualitesTotal / rev : null;
  const depensesMois = s.chargesFoyerMois + s.mensualitesTotal;
  const moisReserve = depensesMois > 0 ? s.liquidites / depensesMois : null;

  if (taux !== null && taux <= h.plafondEndettement / 100 * 0.8) add("forces", "Endettement maîtrisé", `${pc(taux)} des revenus retenus, plafond usuel ${h.plafondEndettement} %.`);
  if (s.epargneAnnuelle !== null && s.revenusAnnuelsRecurrents > 0 && s.epargneAnnuelle / s.revenusAnnuelsRecurrents >= 0.15) add("forces", "Épargne régulière importante", `${eur(s.epargneAnnuelle)} par an, soit ${pc(s.epargneAnnuelle / s.revenusAnnuelsRecurrents)} des revenus.`);
  if (s.biensIncomplets === 0 && lots.length > 0 && s.cashflowImmobilierMois >= 0) add("forces", "Immobilier existant autofinancé", `Résultat des biens après mensualités : ${eur(s.cashflowImmobilierMois)} par mois (avant impôt).`);
  if (moisReserve !== null && moisReserve >= h.moisReserve) add("forces", "Réserve de sécurité solide", `${moisReserve.toFixed(1)} mois de dépenses en liquidités.`);

  const partImmo = s.composition.partImmobilier;
  if (partImmo !== null && partImmo * 100 > h.concentrationImmobilier) add("faiblesses", "Patrimoine concentré sur l'immobilier", `${pc(partImmo)} du patrimoine brut (repère : ${h.concentrationImmobilier} %).`);
  if (moisReserve !== null && moisReserve < 3) add("faiblesses", "Réserve de sécurité faible", `${moisReserve.toFixed(1)} mois de dépenses en liquidités (repère : ${h.moisReserve} mois).`);
  if (taux !== null && taux > h.plafondEndettement / 100) add("faiblesses", "Endettement au-dessus du plafond usuel", `${pc(taux)} contre ${h.plafondEndettement} %.`);
  if (s.biensIncomplets === 0 && lots.length > 0 && s.cashflowImmobilierMois < 0) add("faiblesses", "Immobilier existant déficitaire", `Résultat des biens après mensualités : ${eur(s.cashflowImmobilierMois)} par mois (avant impôt).`);
  const flux = analyserFlux(c);
  if (flux.ecart !== null && flux.ecart < 0) add("faiblesses", "Épargne réelle inférieure à la capacité théorique", `Écart de ${eur(flux.ecart)} par mois : des dépenses ne sont pas dans les charges saisies.`);

  lots.forEach((l, i) => {
    const b = analyserBien(l);
    const nom = l.adresse || `Bien ${i + 1}`;
    if (b.effortEpargneMois !== null && b.effortEpargneMois > 0) add("risques", `Effort d'épargne sur ${nom}`, `${eur(b.effortEpargneMois)} par mois à compléter chaque mois.`);
    if (/SCI IS/i.test(String(l.structure || "")) && b.plusValueLatente !== null && n0(l.valeur) > 0 && b.plusValueLatente / n0(l.valeur) > 0.2)
      add("risques", `Plus-value latente en SCI à l'IS : ${nom}`, `${eur(b.plusValueLatente)} de plus-value latente : la sortie ou la transformation peut coûter cher. À valider avec le notaire et l'expert-comptable.`);
  });
  const dividendes = n0(c.profil?.dividendes_an) / 12;
  if (s.revenusMensuels > 0 && dividendes / s.revenusMensuels > 0.5) add("risques", "Revenus très dépendants des dividendes", `${pc(dividendes / s.revenusMensuels)} des revenus récurrents viennent de dividendes variables.`);
  const couple = /mari|pacs/i.test(String(c.profil?.situation_familiale || ""));
  if (couple && !String(c.situation_familiale_detail?.assurance_vie_clause_beneficiaire || "").trim() && !String(c.situation_familiale_detail?.testament_donation || "").trim())
    add("risques", "Protection du conjoint non documentée", "Ni clause bénéficiaire ni donation entre époux ou testament renseignés. À valider avec le notaire.");
  if (!String(c.prevoyance?.prevoyance_deces || "").trim() && s.dettes > 0) add("risques", "Prévoyance décès non renseignée", `${eur(s.dettes)} de dettes : que devient le remboursement en cas de décès d'un emprunteur ?`);

  if (taux !== null && taux < h.plafondEndettement / 100) {
    const marge = Math.max(0, (h.plafondEndettement / 100) * rev - s.mensualitesTotal);
    if (marge > 0) add("opportunites", "Capacité bancaire encore disponible", `Environ ${eur(marge)} de mensualité supplémentaire, soit ${eur(capitalPourMensualite(marge, h.tauxCredit, h.dureeCredit))} empruntables à ${h.tauxCredit} % sur ${h.dureeCredit} ans (indicatif).`);
  }
  if (moisReserve !== null && moisReserve > h.moisReserve && depensesMois > 0) add("opportunites", "Liquidités mobilisables comme apport", `${eur(s.liquidites - h.moisReserve * depensesMois)} au-dessus de la réserve de ${h.moisReserve} mois.`);
  lots.forEach((l, i) => {
    const b = analyserBien(l);
    if (b.plusValueLatente !== null && n0(l.valeur) > 0 && b.plusValueLatente / n0(l.valeur) > 0.15 && !/SCI IS/i.test(String(l.structure || "")))
      add("opportunites", `Arbitrage possible : ${l.adresse || `Bien ${i + 1}`}`, `${eur(b.plusValueLatente)} de plus-value latente : à étudier (fiscalité de cession non calculée).`);
  });
  return out;
}

/** Texte de synthèse à recopier dans le diagnostic rédigé. */
export function texteSynthese(data, hypotheses = {}) {
  const s = situation(data);
  const sw = analyserSwot(data, hypotheses);
  const ligne = (titre, liste) => (liste.length ? `${titre} :\n${liste.map((x) => `- ${x.titre} — ${x.detail}`).join("\n")}` : "");
  return [
    `Patrimoine brut ${eur(s.patrimoineBrut)}, dettes ${eur(s.dettes)}, patrimoine net ${eur(s.patrimoineNet)}.`,
    ligne("Forces", sw.forces), ligne("Faiblesses", sw.faiblesses), ligne("Risques", sw.risques), ligne("Opportunités", sw.opportunites),
    "Chiffres avant impôt, indicatifs, calculés à partir des données saisies.",
  ].filter(Boolean).join("\n\n");
}
