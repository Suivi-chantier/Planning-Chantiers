// ─────────────────────────────────────────────────────────────────────────────
// diagrammeFinancier — Point 5 : séries mensuelles CUMULÉES d'un chantier
// (dépenses / recettes de facturation / valeur générée), volet RÉEL.
//
// Module de calcul PUR : aucune dépendance réseau, aucun React, aucune
// horloge. Toutes les données arrivent en argument, les I/O restent à
// l'appelant — même contrat que src/chantierFinance.mjs. Extension .mjs =
// parsable ESM par Node sans build (tests, crons /api) ; le front importe la
// façade src/Renovation/diagrammeFinancier.js.
//
// RÈGLE ABSOLUE : aucune formule financière n'est réécrite ici. Tout montant
// vient de chantierFinance (heuresParMois, sumCoutMO, totalLignes) ou du
// résultat de computeChantierFinance passé en argument (`finance`). Ce module
// ne fait que DATER et CUMULER. Les indicateurs de DashboardAnalyse.jsx sont
// interdits comme référence (formules considérées fausses par le métier).
//
// Conventions :
//  - clé de mois : "YYYY-MM" ; les séries sont triées du plus ancien au plus
//    récent (ordre d'un axe de temps), contrairement à heuresParMois ;
//  - les champs des États financiers (pctFacture, avancementReel, acompteMois)
//    sont des FRACTIONS 0-1 (0,82 = 82 %) — même tolérance de saisie que
//    parsePercent d'EtatsFinanciers.jsx : |n| > 1 ⇒ ÷ 100 ;
//  - une série sans donnée exploitable renvoie { renseigne: false, raison }
//    (convention renseigne:false de chantierFinance) — jamais un zéro ;
//  - la jointure États financiers ↔ chantier se fait PAR NOM (il n'y a pas de
//    chantier_id dans les États financiers) : l'échec d'appariement est
//    renvoyé explicitement (statut "non_apparie"), jamais traité comme zéro.
//
// Pièges couverts (audit Prompt 0 du 2026-08-04) :
//  - ids de période à suffixe ("2026-04-30-corrige" à côté de "2026-04-30") :
//    les ids sont opaques, l'ORDRE de avancement.periods fait foi (periods[0]
//    = la plus récente ; la corrigée est placée AVANT la brute). À mois égal,
//    on retient donc la période la plus haute dans le tableau. Les ids créés
//    par l'UI ("periode_<uuid>") ne sont pas datables : renvoyés à part.
//  - commande_lignes n'a pas de date métier : la date d'une dépense matériau
//    est commandes.date_doc (repli commandes.created_at, puis ligne.created_at
//    — pollué par la migration du 2026-06-17, signalé). Ligne non datable :
//    renvoyée à part, jamais mise à zéro.
//  - la reprise d'antériorité et le repli MO legacy (tâches sans pointage)
//    n'ont pas de date : isolés dans `sansDate`, posés par défaut au premier
//    mois de la série pour que le cumul final retombe AU CENTIME sur
//    brut.coutMOTotalChantier / brut.coutMatChantier (contrôle intégré).
// ─────────────────────────────────────────────────────────────────────────────
import {
  heuresParMois, sumCoutMO, totalLignes,
  tacheHeuresVendues, coutMatOuvrage, situationAFacturerVal,
} from "../chantierFinance.mjs";

// ── Utilitaires de parsing (tolérance identique à EtatsFinanciers.jsx) ──────
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export const labelMois = (mois) => {
  const m = /^(\d{4})-(\d{2})$/.exec(mois || "");
  return m ? `${MOIS_FR[parseInt(m[2], 10) - 1]} ${m[1]}` : String(mois || "");
};

// Nombre tolérant : virgule décimale, espaces, symbole €. null = non renseigné.
export const parseNombre = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[\s€]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Fraction 0-1 : même règle que parsePercent (EtatsFinanciers.jsx) et que la
// conversion défensive de BilanSemaine — une saisie 82 devient 0,82.
export const parseFraction = (v) => {
  const n = parseNombre(v);
  if (n == null) return null;
  return Math.abs(n) > 1 ? n / 100 : n;
};

// Normalisation de nom de chantier : STRICTEMENT identique à normNom de
// BilanSemaine.jsx / cron-snapshot-hebdo.js (l'appariement doit matcher les
// mêmes lignes que l'existant).
export const normNomChantier = (s) => (s || "").toString().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

// ── Périodes des États financiers → mois calendaires ────────────────────────

// Mois "YYYY-MM" d'une période { id, label }, ou null si non datable.
// L'id fait foi quand il commence par une date ISO (le suffixe "-corrige" est
// ignoré) ; sinon on tente le label "31/05/26". Un id "periode_<uuid>" sans
// label datable est non datable.
export function moisDePeriode(period) {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(period?.id || "");
  if (m) return `${m[1]}-${m[2]}`;
  const l = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(period?.label || "");
  if (l) {
    const annee = l[3].length === 2 ? `20${l[3]}` : l[3];
    const mois = String(parseInt(l[2], 10)).padStart(2, "0");
    return `${annee}-${mois}`;
  }
  return null;
}

// Résout les périodes en mois calendaires UNIQUES, triés du plus ancien au
// plus récent. À mois égal (cas "2026-04-30-corrige" + "2026-04-30"), la
// période la plus HAUTE dans avancement.periods gagne : c'est la convention
// de l'appli (insertion en tête, periods[0] fait foi ; la corrigée est placée
// avant la brute). Les périodes non datables sont renvoyées à part.
export function periodesMensuelles(avancement) {
  const periods = Array.isArray(avancement?.periods) ? avancement.periods : [];
  const parMois = new Map(); // mois → { mois, periodId, label } (1re occurrence = prioritaire)
  const nonDatables = [];
  periods.forEach((p) => {
    const mois = moisDePeriode(p);
    if (!mois) { nonDatables.push({ id: p?.id, label: p?.label }); return; }
    if (!parMois.has(mois)) parMois.set(mois, { mois, periodId: p.id, label: p.label });
  });
  return {
    mois: [...parMois.values()].sort((a, b) => a.mois.localeCompare(b.mois)),
    nonDatables,
  };
}

// ── Appariement États financiers ↔ chantier (par NOM) ───────────────────────

// Tous les noms portés par une ligne d'États financiers (le nom peut changer
// d'une période à l'autre — cas réel "CO-LIVING" → "CAP INVEST / CO-LIVING").
function nomsDeLigne(row) {
  const noms = new Set();
  const add = (v) => { const n = normNomChantier(v); if (n) noms.add(n); };
  add(row?.chantier);
  Object.values(row?.values || {}).forEach((v) => add(v?.chantier));
  return noms;
}

// Lignes d'États financiers appariées à un chantier. Une ligne = un lot/devis :
// un chantier peut matcher PLUSIEURS lignes (elles seront agrégées).
// statut : "apparie" | "non_apparie" | "aucun_etat" (pas d'États financiers).
export function apparierLignesEtats(avancement, chantierNom) {
  const rows = Array.isArray(avancement?.rows) ? avancement.rows : [];
  const cible = normNomChantier(chantierNom);
  if (rows.length === 0) {
    return { statut: "aucun_etat", nomNormalise: cible, lignes: [] };
  }
  if (!cible) return { statut: "non_apparie", nomNormalise: cible, lignes: [] };
  const lignes = rows.filter((r) => nomsDeLigne(r).has(cible));
  return {
    statut: lignes.length > 0 ? "apparie" : "non_apparie",
    nomNormalise: cible,
    lignes,
  };
}

// Rapprochement global (pour rendre la jointure par nom VISIBLE) : quelles
// lignes d'États financiers ne matchent aucun chantier connu, et quels
// chantiers n'ont aucune ligne. `chantiers` = [{ id?, nom }] (ou tout objet
// avec un champ nom / chantier_nom).
export function rapprochementEtatsChantiers(etatsFinanciers, chantiers) {
  const avancement = etatsFinanciers?.avancement;
  const rows = Array.isArray(avancement?.rows) ? avancement.rows : [];
  const refs = (chantiers || [])
    .map((c) => ({ id: c?.id ?? null, nom: c?.nom ?? c?.chantier_nom ?? "", norm: normNomChantier(c?.nom ?? c?.chantier_nom) }))
    .filter((c) => c.norm);
  const normsChantiers = new Set(refs.map((c) => c.norm));

  const lignesNonAppariees = rows
    .filter((r) => ![...nomsDeLigne(r)].some((n) => normsChantiers.has(n)))
    .map((r) => ({ id: r?.id, devis: r?.devis || null, nom: dernierNomLigne(r) }));

  const normsLignes = new Set(rows.flatMap((r) => [...nomsDeLigne(r)]));
  const chantiersSansLigne = refs
    .filter((c) => !normsLignes.has(c.norm))
    .map((c) => ({ id: c.id, nom: c.nom }));

  return { lignesNonAppariees, chantiersSansLigne, nbLignes: rows.length, nbChantiers: refs.length };
}

// Dernier nom lisible d'une ligne (pour l'affichage des non-appariés).
function dernierNomLigne(row) {
  const vals = Object.values(row?.values || {});
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i]?.chantier) return vals[i].chantier;
  }
  return row?.chantier || "(sans nom)";
}

// ── Séries États financiers : recettes réelles + valeur générée réelle ──────

// Construit les deux séries cumulées issues des États financiers d'un
// chantier, mois par mois (fins de mois des États financiers) :
//   recettes (facturation) : Σ lignes pctFacture × montantHT ;
//   valeur générée         : Σ lignes avancementReel × montantHT.
// Les valeurs des États financiers sont des états CUMULÉS : un mois sans
// saisie pour une ligne reporte la dernière valeur connue (la courbe reste
// plate, elle ne retombe pas à zéro).
//
// L'ACOMPTE n'est PAS intégré à la recette : acompteMois est une fraction
// reportée de mois en mois qu'aucun code de l'appli ne consomme, et rien ne
// prouve que pctFacture ne l'inclut pas déjà (l'additionner risquerait un
// double compte). Il est renvoyé À PART dans `acompte`, avec un warning —
// à intégrer quand le métier aura confirmé sa signification.
export function seriesEtatsFinanciers({ etatsFinanciers, chantierNom } = {}) {
  const avancement = etatsFinanciers?.avancement;
  const appariement = apparierLignesEtats(avancement, chantierNom);
  const { mois: moisList, nonDatables } = periodesMensuelles(avancement);

  const nonRenseigne = (raison) => ({ renseigne: false, raison, points: [] });
  const commun = { appariement, periodesNonDatables: nonDatables };

  if (appariement.statut !== "apparie") {
    const raison = appariement.statut === "aucun_etat"
      ? "Aucun État financier saisi dans l'application."
      : `Aucune ligne des États financiers ne correspond au chantier « ${chantierNom || "?"} » (jointure par nom).`;
    return { ...commun, recettes: nonRenseigne(raison), valeurGeneree: nonRenseigne(raison), acompte: null };
  }
  if (moisList.length === 0) {
    const raison = "Les périodes des États financiers ne sont pas datables (identifiants sans date).";
    return { ...commun, recettes: nonRenseigne(raison), valeurGeneree: nonRenseigne(raison), acompte: null };
  }

  // État reporté par ligne (les valeurs sont des cumuls : report du dernier connu).
  const etats = appariement.lignes.map(() => ({
    montantHT: null, pctFacture: null, avancementReel: null, acompteMois: null,
  }));

  const pointsRecettes = [];
  const pointsValeur = [];
  moisList.forEach(({ mois, periodId, label }) => {
    appariement.lignes.forEach((row, i) => {
      const v = row?.values?.[periodId];
      if (!v) return;
      const e = etats[i];
      const mHT = parseNombre(v.montantHT);
      const pct = parseFraction(v.pctFacture);
      const av = parseFraction(v.avancementReel);
      const ac = parseFraction(v.acompteMois);
      if (mHT != null) e.montantHT = mHT;
      if (pct != null) e.pctFacture = pct;
      if (av != null) e.avancementReel = av;
      if (ac != null) e.acompteMois = ac;
    });
    let recette = null, valeur = null, nbLignesMois = 0;
    etats.forEach((e) => {
      if (e.montantHT == null) return;
      nbLignesMois++;
      if (e.pctFacture != null) recette = (recette ?? 0) + e.pctFacture * e.montantHT;
      if (e.avancementReel != null) valeur = (valeur ?? 0) + e.avancementReel * e.montantHT;
    });
    if (recette != null) pointsRecettes.push({ mois, label: labelMois(mois), periodLabel: label, cumul: recette, nbLignes: nbLignesMois });
    if (valeur != null) pointsValeur.push({ mois, label: labelMois(mois), periodLabel: label, cumul: valeur, nbLignes: nbLignesMois });
  });

  // Acompte : dernier état connu, valorisé — INFORMATIF (voir en-tête).
  let acompte = null;
  const fracAcomptes = etats.filter((e) => e.acompteMois != null && e.montantHT != null);
  if (fracAcomptes.length > 0) {
    acompte = {
      montant: fracAcomptes.reduce((s, e) => s + e.acompteMois * e.montantHT, 0),
      lignes: fracAcomptes.map((e) => ({ fraction: e.acompteMois, montantHT: e.montantHT })),
      integreALaRecette: false,
    };
  }

  const serie = (points, quoi) => points.length > 0
    ? { renseigne: true, points, nbLignes: appariement.lignes.length }
    : { renseigne: false, raison: `Lignes appariées mais aucun ${quoi} exploitable dans les États financiers.`, points: [] };

  return {
    ...commun,
    recettes: serie(pointsRecettes, "% facturé"),
    valeurGeneree: serie(pointsValeur, "avancement réel"),
    acompte,
  };
}

// ── Série des dépenses réelles (MO + matériaux, datées) ─────────────────────

// Date métier d'une ligne de commande : date du document (ticket / bon de
// commande / BL), repli sur la date de création de la commande, puis de la
// ligne (les created_at des lignes migrées portent tous la date de la
// migration du 2026-06-17 — la source utilisée est signalée).
export function dateLigneCommande(l) {
  const doc = (l?.commande?.date_doc || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(doc)) return { date: doc, source: "date_doc" };
  const cca = (l?.commande?.created_at || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cca)) return { date: cca, source: "commande_created_at" };
  const lca = (l?.created_at || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(lca)) return { date: lca, source: "ligne_created_at" };
  return { date: null, source: "sans_date" };
}

// Série mensuelle CUMULÉE des dépenses réelles. `finance` = résultat de
// computeChantierFinance (le module ne recalcule RIEN : il date et cumule, et
// vérifie que le cumul final retombe au centime sur les totaux du module).
//
//  - MO datée : heuresParMois(pointages) — pointages tâche + libres +
//    indirects, au taux figé de chaque ligne ;
//  - matériaux datés : chaque ligne au mois de sa date (cf. dateLigneCommande),
//    montant par la MÊME formule que le module (totalLignes sur la ligne) ;
//  - sansDate : reprise d'antériorité (meta, pas de date), repli MO legacy
//    (tâches sans pointage : coût via ouvriers assignés), pointages à date
//    invalide, lignes non datables. Posé au premier mois de la série si
//    placerSansDateAuPremierMois (défaut) — sinon laissé hors courbe — mais
//    toujours détaillé dans le retour.
export function serieDepensesReelles({
  finance, pointages = [], commandeLignes = [],
  placerSansDateAuPremierMois = true,
} = {}) {
  const brut = finance?.brut;
  if (!brut) {
    return { renseigne: false, raison: "Résultat de computeChantierFinance manquant (paramètre finance).", points: [] };
  }

  // MO par mois (formule du module, réutilisée telle quelle).
  const moParMois = new Map(heuresParMois(pointages).map((m) => [m.mois, m.cout]));
  const moDate = [...moParMois.values()].reduce((s, c) => s + c, 0);
  const moTousPointages = sumCoutMO(pointages);
  const sansDate = {
    // Reprise d'antériorité : heures consommées avant l'appli (aucune date).
    reprise: brut.repriseCout || 0,
    // Repli legacy : coût MO total − reprise − Σ pointages = tâches sans
    // pointage costées via heures_reelles × taux des ouvriers assignés.
    moLegacy: brut.coutMOTotalChantier - (brut.repriseCout || 0) - moTousPointages,
    // Pointages dont la date ne parse pas (exclus de heuresParMois).
    pointagesNonDates: moTousPointages - moDate,
    materiauxNonDates: 0,
    lignesNonDatees: [],
  };

  // Matériaux par mois — montant ligne à ligne par totalLignes (module).
  const matParMois = new Map();
  const sourcesDates = { date_doc: 0, commande_created_at: 0, ligne_created_at: 0, sans_date: 0 };
  (commandeLignes || []).forEach((l) => {
    const montant = totalLignes([l]);
    const { date, source } = dateLigneCommande(l);
    sourcesDates[source]++;
    if (!date) {
      sansDate.materiauxNonDates += montant;
      sansDate.lignesNonDatees.push({ id: l?.id, libelle: l?.libelle || l?.reference || "(sans libellé)", montant });
      return;
    }
    const mois = date.slice(0, 7);
    matParMois.set(mois, (matParMois.get(mois) || 0) + montant);
  });

  const totalSansDateMO = sansDate.reprise + sansDate.moLegacy + sansDate.pointagesNonDates;

  // Union des mois, ordre chronologique.
  const moisTries = [...new Set([...moParMois.keys(), ...matParMois.keys()])].sort();
  if (moisTries.length === 0) {
    const totalHorsDate = totalSansDateMO + sansDate.materiauxNonDates;
    return {
      renseigne: false,
      raison: totalHorsDate > 0.005
        ? "Des dépenses existent mais aucune n'est datable (reprise, legacy ou lignes sans date)."
        : "Aucun pointage ni ligne de commande.",
      points: [], sansDate, sourcesDates,
      controle: controleDepenses({ brut, cumulMO: 0, cumulMat: 0, sansDate, inclus: false }),
    };
  }

  let cumulMO = 0, cumulMat = 0;
  const points = moisTries.map((mois, idx) => {
    let mo = moParMois.get(mois) || 0;
    let materiaux = matParMois.get(mois) || 0;
    if (placerSansDateAuPremierMois && idx === 0) {
      mo += totalSansDateMO;
      materiaux += sansDate.materiauxNonDates;
    }
    cumulMO += mo; cumulMat += materiaux;
    return {
      mois, label: labelMois(mois),
      mo, materiaux, depense: mo + materiaux,
      cumulMO, cumulMat, cumul: cumulMO + cumulMat,
      inclutSansDate: placerSansDateAuPremierMois && idx === 0 &&
        (totalSansDateMO + sansDate.materiauxNonDates) > 0.005,
    };
  });

  return {
    renseigne: true,
    points, sansDate, sourcesDates,
    sansDatePlaceAuPremierMois: placerSansDateAuPremierMois,
    controle: controleDepenses({ brut, cumulMO, cumulMat, sansDate, inclus: placerSansDateAuPremierMois }),
  };
}

// Contrôle de cohérence AU CENTIME : la série (+ le hors-date si pas déjà
// inclus) doit retomber exactement sur les totaux de chantierFinance.
function controleDepenses({ brut, cumulMO, cumulMat, sansDate, inclus }) {
  const totalSerieMO = cumulMO + (inclus ? 0 : sansDate.reprise + sansDate.moLegacy + sansDate.pointagesNonDates);
  const totalSerieMat = cumulMat + (inclus ? 0 : sansDate.materiauxNonDates);
  const ecartMO = totalSerieMO - brut.coutMOTotalChantier;
  const ecartMat = totalSerieMat - brut.coutMatChantier;
  const EPS = 0.005; // au centime
  return {
    moSerie: totalSerieMO, moModule: brut.coutMOTotalChantier, ecartMO,
    matSerie: totalSerieMat, matModule: brut.coutMatChantier, ecartMat,
    ok: Math.abs(ecartMO) <= EPS && Math.abs(ecartMat) <= EPS,
  };
}

// ── Point d'entrée : les 3 séries RÉELLES d'un chantier ─────────────────────

// `finance` = résultat de computeChantierFinance (l'appelant l'a déjà — le
// module ne rappelle pas computeChantierFinance et ne fait aucune I/O).
// `etatsFinanciers` = value de planning_config clé "etats_financiers".
// `chantierNom` = nom du chantier (chantiers.nom ou phasages.chantier_nom).
export function seriesReellesChantier({
  finance, pointages = [], commandeLignes = [],
  etatsFinanciers = null, chantierNom = "",
  placerSansDateAuPremierMois = true,
} = {}) {
  const depenses = serieDepensesReelles({ finance, pointages, commandeLignes, placerSansDateAuPremierMois });
  const etats = seriesEtatsFinanciers({ etatsFinanciers, chantierNom });

  const warnings = [];
  if (etats.appariement.statut === "non_apparie") {
    warnings.push({
      code: "etats_non_apparies", gravite: "alerte",
      message: `Aucune ligne des États financiers ne correspond à « ${chantierNom || "?"} » : recettes et valeur générée indisponibles (jointure par nom).`,
    });
  }
  if (etats.periodesNonDatables.length > 0) {
    warnings.push({
      code: "periodes_non_datables", gravite: "info",
      message: `${etats.periodesNonDatables.length} période(s) des États financiers sans date exploitable (onglet créé à la main ?) — ignorée(s).`,
    });
  }
  if (depenses.renseigne) {
    const sd = depenses.sansDate;
    const totalSD = sd.reprise + sd.moLegacy + sd.pointagesNonDates + sd.materiauxNonDates;
    if (totalSD > 0.005) {
      warnings.push({
        code: "depenses_sans_date", gravite: "info",
        message: `Dépenses non datables posées au premier mois : reprise d'antériorité, MO legacy sans pointage ou lignes sans date (détail dans depenses.sansDate).`,
      });
    }
    if (depenses.sourcesDates.commande_created_at + depenses.sourcesDates.ligne_created_at > 0) {
      warnings.push({
        code: "dates_commandes_approximatives", gravite: "info",
        message: `${depenses.sourcesDates.commande_created_at + depenses.sourcesDates.ligne_created_at} ligne(s) de commande datée(s) par date de saisie (date_doc absente) — mois potentiellement approximatif.`,
      });
    }
    if (!depenses.controle.ok) {
      warnings.push({
        code: "controle_depenses_ecart", gravite: "alerte",
        message: `Le cumul des dépenses de la série ne retombe pas sur le total de chantierFinance (écart MO ${depenses.controle.ecartMO.toFixed(2)} €, matériaux ${depenses.controle.ecartMat.toFixed(2)} €).`,
      });
    }
  }
  if (etats.acompte) {
    warnings.push({
      code: "acompte_non_integre", gravite: "info",
      message: "acompteMois des États financiers non intégré à la recette (signification métier à confirmer — risque de double compte avec pctFacture).",
    });
  }

  return {
    depenses,
    recettes: etats.recettes,
    valeurGeneree: etats.valeurGeneree,
    acompte: etats.acompte,
    appariement: etats.appariement,
    periodesNonDatables: etats.periodesNonDatables,
    warnings,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// SÉRIES PRÉVUES (Prompt 2) — le prévisionnel placé dans le temps par les
// date_prevue du planning. Toujours du calcul pur, ni affichage ni stockage
// (la référence FIGÉE arrive au Prompt 3 : elle enregistrera CES séries).
//
// Arbitrages actés (audit Prompt 0) :
//  - MO prévue datée par tâche = heures VENDUES (tache.heures_vendues) × taux
//    MO prévisionnel — pas les heures estimées — pour que le total boucle sur
//    moPrev du module (heures_devis × taux). L'écart de répartition
//    (heures_devis − Σ tache.heures_vendues) est isolé dans nonPlace.
//  - avancement PLANIFIÉ pondéré par heures vendues (comme les groupes chrono),
//    PAS la définition de l'avancement réel (heures_estimees puis prix_ht) :
//    les deux conventions coexistent déjà dans chantierFinance (ne pas
//    harmoniser).
//  - recettes prévues : acompte au mois de signature, puis chaque mois la
//    formule situationAFacturerVal de chantierFinance (RÉUTILISÉE, pas
//    réécrite) appliquée à l'avancement prévu — clampée à 0 (on n'émet pas de
//    facture négative, l'acompte reste acquis).
//  - les tâches sans date_prevue ne peuvent pas être placées : renvoyées à
//    part (elles rendent la référence incomplète — à savoir AVANT de figer).
// ═════════════════════════════════════════════════════════════════════════════

// Mois "YYYY-MM" d'une date "YYYY-MM-DD", ou null.
const moisDeDate = (d) => {
  const s = (d || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : null;
};

// Date de signature du chantier, depuis le cycle de vie (Point 2a) :
// meta.cycle_vie_etapes.devis_signe.donnees.date (date métier saisie),
// repli sur la date de validation de l'étape, puis sur l'acompte encaissé.
// null si rien — l'appelant placera l'acompte au premier mois et le signalera.
export function dateSignatureChantier(meta) {
  const etapes = meta?.cycle_vie_etapes || {};
  for (const id of ["devis_signe", "acompte_encaisse"]) {
    const e = etapes[id];
    if (!e) continue;
    const d = (e.donnees?.date || e.date || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { date: d, source: id };
  }
  return null;
}

// % d'acompte applicable au chantier (fraction 0-1), par priorité :
//  1. États financiers du chantier (acompteMois, moyenne pondérée par
//     montantHT des lignes appariées) — la donnée la plus proche du réel ;
//  2. surcharge par chantier : meta.acompte_pct (posée par l'UI au Prompt 3+) ;
//  3. réglage Admin : planning_config "acompte_pct_defaut" (passé en argument).
// Saisies tolérantes partout : 30 ou 0,3 → 0,30 (parseFraction).
export function resolutionAcomptePct({ etatsFinanciers, chantierNom, meta, acomptePctDefaut } = {}) {
  const app = apparierLignesEtats(etatsFinanciers?.avancement, chantierNom);
  if (app.statut === "apparie") {
    const { mois: moisList } = periodesMensuelles(etatsFinanciers.avancement);
    let somme = 0, poids = 0;
    app.lignes.forEach((row) => {
      let ac = null, mHT = null;
      moisList.forEach(({ periodId }) => { // dernier état connu, ordre chrono
        const v = row?.values?.[periodId];
        if (!v) return;
        const a = parseFraction(v.acompteMois);
        const m = parseNombre(v.montantHT);
        if (a != null) ac = a;
        if (m != null) mHT = m;
      });
      if (ac != null && mHT != null && mHT > 0) { somme += ac * mHT; poids += mHT; }
    });
    if (poids > 0) return { fraction: somme / poids, source: "etats_financiers" };
  }
  const surcharge = parseFraction(meta?.acompte_pct);
  if (surcharge != null) return { fraction: surcharge, source: "chantier" };
  const defaut = parseFraction(acomptePctDefaut);
  if (defaut != null) return { fraction: defaut, source: "admin" };
  return { fraction: null, source: null };
}

// Les 3 séries mensuelles PRÉVUES d'un chantier. `finance` = résultat de
// computeChantierFinance (les totaux prévus — moPrev, matPrev, vendu, taux —
// viennent de lui, jamais recalculés ici) ; `phasage` = la ligne phasages
// (tâches + date_prevue + meta cycle de vie).
export function seriesPrevuesChantier({
  finance, phasage, etatsFinanciers = null, chantierNom = "",
  acomptePctDefaut = null,
} = {}) {
  const brut = finance?.brut;
  if (!brut) {
    const raison = "Résultat de computeChantierFinance manquant (paramètre finance).";
    return {
      depenses: { renseigne: false, raison, points: [] },
      valeurGeneree: { renseigne: false, raison, points: [] },
      recettes: { renseigne: false, raison, points: [] },
      tachesNonDatees: [], warnings: [],
    };
  }
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const meta = phasage?.plan_travaux?.meta || {};
  const taux = brut.tauxMOPrevEff;
  const venduHT = brut.prixHTChantier;
  const totalHeuresVendues = brut.heuresVenduesChantier;

  // ── MO prévue datée + heures vendues placées (base de l'avancement prévu) ──
  const moParMois = new Map();  // mois → € MO prévue
  const hvParMois = new Map();  // mois → heures vendues
  const tachesNonDatees = [];   // heures vendues impossibles à placer
  let heuresReparties = 0;
  ouvrages.forEach((o) => (o.taches || []).forEach((t) => {
    const hv = tacheHeuresVendues(t);
    if (hv <= 0) return; // sans heures vendues : aucun poids dans la référence
    heuresReparties += hv;
    const mois = moisDeDate(t.date_prevue);
    if (!mois) {
      tachesNonDatees.push({
        ouvrage: o.libelle || "(sans libellé)", tache: t.nom || "(sans nom)",
        heures: hv, montant: hv * taux,
      });
      return;
    }
    moParMois.set(mois, (moParMois.get(mois) || 0) + hv * taux);
    hvParMois.set(mois, (hvParMois.get(mois) || 0) + hv);
  }));
  // Heures vendues au devis (heures_devis) jamais réparties sur les tâches :
  // pas plaçables non plus — comptées à part pour que le contrôle boucle.
  const heuresNonReparties = totalHeuresVendues - heuresReparties;
  const heuresNonDatees = tachesNonDatees.reduce((s, t) => s + t.heures, 0);

  // ── Matériaux prévus, placés au démarrage de l'ouvrage qui les consomme ────
  // (= plus petite date_prevue de ses tâches — même règle que la date de
  // besoin de la page Planning des commandes). Montant = cout_materiaux de
  // l'ouvrage, la valeur retenue par matPrev du module.
  const matParMois = new Map();
  const ouvragesMatNonDates = [];
  ouvrages.forEach((o) => {
    const montant = coutMatOuvrage(o);
    if (montant <= 0) return;
    const dates = (o.taches || []).map((t) => (t.date_prevue || "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const demarrage = dates.length > 0 ? dates.sort()[0] : null;
    const mois = demarrage ? demarrage.slice(0, 7) : null;
    if (!mois) {
      ouvragesMatNonDates.push({ ouvrage: o.libelle || "(sans libellé)", montant });
      return;
    }
    matParMois.set(mois, (matParMois.get(mois) || 0) + montant);
  });

  // ── Série des dépenses prévues (cumulées) ──────────────────────────────────
  const moisDepenses = [...new Set([...moParMois.keys(), ...matParMois.keys()])].sort();
  let cumulMO = 0, cumulMat = 0;
  const pointsDepenses = moisDepenses.map((mois) => {
    const mo = moParMois.get(mois) || 0;
    const materiaux = matParMois.get(mois) || 0;
    cumulMO += mo; cumulMat += materiaux;
    return { mois, label: labelMois(mois), mo, materiaux, depense: mo + materiaux, cumulMO, cumulMat, cumul: cumulMO + cumulMat };
  });
  const nonPlace = {
    tachesNonDatees,
    moTachesNonDatees: heuresNonDatees * taux,
    heuresNonReparties,
    moHeuresNonReparties: heuresNonReparties * taux,
    ouvragesMatNonDates,
    materiauxNonDates: ouvragesMatNonDates.reduce((s, o) => s + o.montant, 0),
  };
  // Contrôle : datée + non plaçable = totaux prévus du module, au centime.
  const EPS = 0.005;
  const ecartMO = (cumulMO + nonPlace.moTachesNonDatees + nonPlace.moHeuresNonReparties) - brut.moPrevChantier;
  const ecartMat = (cumulMat + nonPlace.materiauxNonDates) - brut.commandesPrevChantier;
  const controle = {
    moSerie: cumulMO, moNonPlace: nonPlace.moTachesNonDatees + nonPlace.moHeuresNonReparties,
    moModule: brut.moPrevChantier, ecartMO,
    matSerie: cumulMat, matNonPlace: nonPlace.materiauxNonDates,
    matModule: brut.commandesPrevChantier, ecartMat,
    ok: Math.abs(ecartMO) <= EPS && Math.abs(ecartMat) <= EPS,
  };
  const depenses = pointsDepenses.length > 0
    ? { renseigne: true, points: pointsDepenses, nonPlace, controle }
    : { renseigne: false, raison: "Aucune tâche datée (date_prevue) : le prévisionnel ne peut pas être placé dans le temps.", points: [], nonPlace, controle };

  // ── Valeur générée prévue = avancement planifié × vendu HT ─────────────────
  // Avancement planifié (fraction) = cumul des heures vendues datées ÷ total
  // des heures vendues du chantier (heuresVenduesChantier du module).
  const moisHV = [...hvParMois.keys()].sort();
  let cumulHV = 0;
  const pointsValeur = moisHV.map((mois) => {
    cumulHV += hvParMois.get(mois);
    const avancementPrevu = totalHeuresVendues > 0 ? cumulHV / totalHeuresVendues : 0;
    return { mois, label: labelMois(mois), heuresVendues: hvParMois.get(mois), cumulHeures: cumulHV, avancementPrevu, cumul: avancementPrevu * venduHT };
  });
  const valeurGeneree = (totalHeuresVendues > 0 && venduHT > 0 && pointsValeur.length > 0)
    ? { renseigne: true, points: pointsValeur, avancementPrevuFinal: pointsValeur[pointsValeur.length - 1].avancementPrevu }
    : { renseigne: false, raison: totalHeuresVendues <= 0 ? "Aucune heure vendue sur les ouvrages." : venduHT <= 0 ? "Aucun prix de vente sur les ouvrages." : "Aucune tâche datée.", points: [] };

  // ── Recettes prévues : acompte au mois de signature, puis situations ───────
  const acompte = resolutionAcomptePct({ etatsFinanciers, chantierNom, meta, acomptePctDefaut });
  const signature = dateSignatureChantier(meta);
  const montantAcompte = acompte.fraction != null && venduHT > 0 ? acompte.fraction * venduHT : null;

  let recettes;
  if (venduHT <= 0) {
    recettes = { renseigne: false, raison: "Aucun prix de vente sur les ouvrages.", points: [] };
  } else if (pointsValeur.length === 0 && montantAcompte == null) {
    recettes = { renseigne: false, raison: "Ni tâche datée ni % d'acompte : aucune recette prévisionnelle calculable.", points: [] };
  } else {
    const premierMois = moisHV[0] || null;
    const moisAcompte = signature ? signature.date.slice(0, 7) : premierMois;
    const acompteAuPremierMoisFauteDeSignature = !signature && montantAcompte != null;
    const moisRecettes = [...new Set([
      ...(montantAcompte != null && moisAcompte ? [moisAcompte] : []),
      ...moisHV,
    ])].sort();
    const avancementAuMois = new Map(pointsValeur.map((p) => [p.mois, p.avancementPrevu]));
    let cumulFacture = 0, dernierAvancement = 0;
    const pointsRecettes = moisRecettes.map((mois) => {
      const acompteDuMois = (montantAcompte != null && mois === moisAcompte) ? montantAcompte : 0;
      cumulFacture += acompteDuMois;
      if (avancementAuMois.has(mois)) dernierAvancement = avancementAuMois.get(mois);
      // LA formule du module (situationAFacturerVal), appliquée à l'avancement
      // PRÉVU, avec le cumul facturé prévu en guise de % facturé. Clampée à 0.
      const situation = Math.max(0, situationAFacturerVal(dernierAvancement * 100, cumulFacture / venduHT, venduHT) ?? 0);
      cumulFacture += situation;
      return { mois, label: labelMois(mois), acompte: acompteDuMois, situation, cumul: cumulFacture };
    });
    recettes = {
      renseigne: true, points: pointsRecettes,
      acompte: {
        fraction: acompte.fraction, montant: montantAcompte, source: acompte.source,
        mois: montantAcompte != null ? moisAcompte : null,
        dateSignature: signature?.date || null, sourceSignature: signature?.source || null,
        placeAuPremierMoisFauteDeSignature: acompteAuPremierMoisFauteDeSignature,
      },
    };
  }

  // ── Warnings ────────────────────────────────────────────────────────────────
  const warnings = [];
  if (tachesNonDatees.length > 0) {
    warnings.push({
      code: "taches_non_datees", gravite: "alerte",
      message: `${tachesNonDatees.length} tâche(s) avec heures vendues sans date_prevue (${Math.round(heuresNonDatees)} h, ${Math.round(nonPlace.moTachesNonDatees)} €) : la référence serait incomplète.`,
    });
  }
  if (Math.abs(heuresNonReparties) > 0.05) {
    warnings.push({
      code: "heures_non_reparties", gravite: "info",
      message: `${Math.round(heuresNonReparties)} h vendues au devis non réparties sur les tâches : non plaçables dans le temps (comptées à part).`,
    });
  }
  if (ouvragesMatNonDates.length > 0) {
    warnings.push({
      code: "materiaux_prevus_sans_date", gravite: "alerte",
      message: `${ouvragesMatNonDates.length} ouvrage(s) avec matériaux prévus mais aucune tâche datée (${Math.round(nonPlace.materiauxNonDates)} €) : démarrage non plaçable.`,
    });
  }
  if (recettes.renseigne && recettes.acompte?.montant == null) {
    warnings.push({
      code: "acompte_pct_absent", gravite: "info",
      message: "Aucun % d'acompte (États financiers, chantier ou réglage Admin) : recettes prévues sans acompte.",
    });
  }
  if (recettes.renseigne && recettes.acompte?.placeAuPremierMoisFauteDeSignature) {
    warnings.push({
      code: "signature_absente", gravite: "info",
      message: "Pas de date de signature (cycle de vie) : acompte placé au premier mois planifié.",
    });
  }
  if (!controle.ok) {
    warnings.push({
      code: "controle_prevu_ecart", gravite: "alerte",
      message: `Le prévisionnel placé ne retombe pas sur moPrev/matPrev du module (écart MO ${ecartMO.toFixed(2)} €, matériaux ${ecartMat.toFixed(2)} €).`,
    });
  }

  return { depenses, valeurGeneree, recettes, tachesNonDatees, warnings };
}

// ── Récapitulatif avant prise de référence (Prompt 3) ────────────────────────
// Ce que l'utilisateur doit voir AVANT de figer : montant total, période
// couverte, et surtout les TÂCHES NON DATÉES qui rendraient la référence
// incomplète. Calcul pur à partir du résultat de seriesPrevuesChantier et de
// computeChantierFinance — c'est aussi ce qui est stocké dans recap.
export function recapReference(prevues, finance) {
  const b = finance?.brut || {};
  const tousMois = [
    ...(prevues?.depenses?.points || []),
    ...(prevues?.valeurGeneree?.points || []),
    ...(prevues?.recettes?.points || []),
  ].map((p) => p.mois).sort();
  const dernierPointDep = prevues?.depenses?.points?.at(-1) || null;
  const nonPlace = prevues?.depenses?.nonPlace || {};
  const depensesNonPlacees = (nonPlace.moTachesNonDatees || 0)
    + (nonPlace.moHeuresNonReparties || 0) + (nonPlace.materiauxNonDates || 0);
  const tachesNonDatees = prevues?.tachesNonDatees || [];
  return {
    venduHT: b.prixHTChantier ?? null,
    moPrev: b.moPrevChantier ?? null,
    matPrev: b.commandesPrevChantier ?? null,
    depensesPrevuesPlacees: dernierPointDep?.cumul ?? 0,
    depensesNonPlacees,
    recettesFinales: prevues?.recettes?.points?.at(-1)?.cumul ?? null,
    valeurGenereeFinale: prevues?.valeurGeneree?.points?.at(-1)?.cumul ?? null,
    avancementPrevuFinal: prevues?.valeurGeneree?.avancementPrevuFinal ?? null,
    acompte: prevues?.recettes?.acompte || null,
    periode: tousMois.length > 0
      ? { debut: tousMois[0], fin: tousMois[tousMois.length - 1], nbMois: new Set(tousMois).size }
      : null,
    nbTachesNonDatees: tachesNonDatees.length,
    heuresNonDatees: tachesNonDatees.reduce((s, t) => s + (t.heures || 0), 0),
    tachesNonDatees,
    complete: tachesNonDatees.length === 0 && Math.abs(nonPlace.heuresNonReparties || 0) <= 0.05
      && (nonPlace.ouvragesMatNonDates || []).length === 0,
  };
}
