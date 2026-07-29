// ─────────────────────────────────────────────────────────────────────────────
// QCD — Qualité / Coût / Délai d'un chantier (Point 2a, pilotage).
//
// Module de calcul PUR : aucune dépendance, aucun accès DB, aucune horloge,
// aucun effet de bord. Extension .mjs = parsable ESM par Node sans build
// (tests, crons /api via `await import()`), comme src/chantierFinance.mjs.
// Le front importe la façade src/Renovation/qcd.js.
//
// ⚠️ Les formules d'indicateurs de DashboardAnalyse.jsx (avSt, mrSt, ratioMO,
// calcAvancementTheorique…) sont considérées FAUSSES par le métier : ce module
// les redéfinit à neuf et ne doit JAMAIS les importer ni les recopier.
//
// Conventions :
//  - avancement en FRACTION 0→1 (l'appli manipule des entiers 0-100 :
//    diviser par 100 avant d'appeler, ou passer par qcdDepuisFinance) ;
//  - null = indéterminé — jamais 0, jamais NaN, jamais Infinity ;
//  - statut ∈ { "vert", "orange", "rouge", "gris" } ;
//  - chaque sommet renvoie { statut, valeur, valeurFormatee, explication }.
// ─────────────────────────────────────────────────────────────────────────────
import {
  statsReservesChantier,
  SEUIL_RESERVE_ANCIENNE_JOURS, SEUIL_RESERVE_ANCIENNE_CONTROLES,
} from "./controles.mjs";

// ── Statuts et seuils (constantes exportées, faciles à recalibrer) ──────────
export const QCD_VERT = "vert";
export const QCD_ORANGE = "orange";
export const QCD_ROUGE = "rouge";
export const QCD_GRIS = "gris";

// Délai : indice = heures réelles / (heures vendues × avancement).
export const SEUIL_DELAI_ORANGE = 1.10; // en dessous : vert
export const SEUIL_DELAI_ROUGE = 1.30;  // au-dessus : rouge (entre les deux : orange)
export const SEUIL_DELAI_AVANCEMENT_MIN = 0.15; // en dessous : "démarrage", indice instable

// Coût : ratio = coût réel / budget total prévu (non proraté par l'avancement).
export const SEUIL_COUT_ORANGE = 0.90; // en dessous : vert
export const SEUIL_COUT_ROUGE = 1.00;  // au-dessus : rouge (entre les deux : orange)

// Gravité croissante, pour prendre "le pire" de plusieurs statuts.
const GRAVITE = { [QCD_VERT]: 0, [QCD_ORANGE]: 1, [QCD_ROUGE]: 2 };

// ── Petits utilitaires (robustesse données manquantes) ──────────────────────
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const fmtNombre = (v, dec = 0) =>
  Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: dec });

const fmtHeures = (v) => `${fmtNombre(v, 1)} h`;
const fmtEuros = (v) => `${fmtNombre(v, 0)} €`;
const fmtPct = (v) => `${fmtNombre(v * 100, 0)} %`;
const fmtIndice = (v) => fmtNombre(v, 2);

// ─────────────────────────────────────────────────────────────────────────────
// DÉLAI — « est-ce qu'on brûle les heures plus vite qu'on avance ? »
//   indice = heures_reelles / (heures_vendues × avancement)
// Exemple métier : 100 h vendues, 20 % d'avancement, 80 h consommées
//   → 80 / (100 × 0,20) = 4 → très en dépassement (rouge).
// ─────────────────────────────────────────────────────────────────────────────
export function calculDelai({ heuresReelles, heuresVendues, avancement } = {}) {
  const hv = toNum(heuresVendues);
  const av = toNum(avancement);
  const hr = toNum(heuresReelles) ?? 0; // pas de pointage = 0 h consommée (donnée réelle, pas manquante)

  if (hv == null || hv <= 0) {
    return {
      statut: QCD_GRIS, demarrage: false, valeur: null, valeurFormatee: "—",
      heuresReelles: hr, heuresAttendues: null,
      explication: "Heures vendues absentes ou à zéro : indice non calculable.",
    };
  }
  if (av == null || av < 0) {
    return {
      statut: QCD_GRIS, demarrage: false, valeur: null, valeurFormatee: "—",
      heuresReelles: hr, heuresAttendues: null,
      explication: "Avancement du chantier inconnu : indice non calculable.",
    };
  }

  const avc = Math.min(1, av); // fraction 0→1
  const heuresAttendues = hv * avc;
  const indice = heuresAttendues > 0 ? hr / heuresAttendues : null;

  // Phase de démarrage : l'indice est instable, statut neutre sans alerte.
  if (avc < SEUIL_DELAI_AVANCEMENT_MIN) {
    return {
      statut: QCD_GRIS, demarrage: true, valeur: indice,
      valeurFormatee: indice != null ? fmtIndice(indice) : "—",
      heuresReelles: hr, heuresAttendues,
      explication: `Trop tôt pour juger : ${fmtPct(avc)} d'avancement (indice instable sous ${fmtPct(SEUIL_DELAI_AVANCEMENT_MIN)}).`,
    };
  }

  const statut = indice < SEUIL_DELAI_ORANGE ? QCD_VERT
    : indice <= SEUIL_DELAI_ROUGE ? QCD_ORANGE
    : QCD_ROUGE;

  return {
    statut, demarrage: false, valeur: indice, valeurFormatee: fmtIndice(indice),
    heuresReelles: hr, heuresAttendues,
    explication: `${fmtHeures(hr)} consommées pour ${fmtHeures(heuresAttendues)} attendues à ${fmtPct(avc)} d'avancement.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COÛT — « a-t-on mangé le budget ? » (budget TOTAL prévu, non proraté)
//   ratio_MO        = coût MO réel        / coût MO prévu
//   ratio_materiaux = coût matériaux réel / coût matériaux prévu
//   statut          = le PIRE des deux (un ratio non évaluable est ignoré ;
//                     gris seulement si aucun des deux n'est évaluable).
// ─────────────────────────────────────────────────────────────────────────────
function ratioCout(libelle, reelBrut, prevuBrut) {
  const prevu = toNum(prevuBrut);
  const reel = toNum(reelBrut) ?? 0;
  if (prevu == null || prevu <= 0) {
    return {
      libelle, statut: QCD_GRIS, ratio: null, ratioFormate: "—", reel, prevu: null,
      explication: `${libelle} : budget prévu absent ou à zéro, ratio non évaluable.`,
    };
  }
  const ratio = reel / prevu;
  const statut = ratio < SEUIL_COUT_ORANGE ? QCD_VERT
    : ratio <= SEUIL_COUT_ROUGE ? QCD_ORANGE
    : QCD_ROUGE;
  return {
    libelle, statut, ratio, ratioFormate: fmtPct(ratio), reel, prevu,
    explication: `${libelle} : ${fmtEuros(reel)} réels / ${fmtEuros(prevu)} prévus (${fmtPct(ratio)} du budget).`,
  };
}

export function calculCout({ coutMOReel, coutMOPrevu, coutMateriauxReel, coutMateriauxPrevu } = {}) {
  const mo = ratioCout("Main d'œuvre", coutMOReel, coutMOPrevu);
  const materiaux = ratioCout("Matériaux", coutMateriauxReel, coutMateriauxPrevu);

  const evaluables = [mo, materiaux].filter((r) => r.statut !== QCD_GRIS);
  if (evaluables.length === 0) {
    return {
      statut: QCD_GRIS, valeur: null, valeurFormatee: "—", mo, materiaux,
      explication: "Aucun budget prévu (MO ni matériaux) : coût non évaluable.",
    };
  }

  const pire = evaluables.reduce((a, b) => (GRAVITE[b.statut] > GRAVITE[a.statut] ? b : a));
  const nonEvaluable = [mo, materiaux].find((r) => r.statut === QCD_GRIS);
  const explication = [mo, materiaux].map((r) => r.explication).join(" ")
    + (nonEvaluable ? "" : ` Statut retenu : le pire des deux (${pire.libelle.toLowerCase()}).`);

  return { statut: pire.statut, valeur: pire.ratio, valeurFormatee: pire.ratioFormate, mo, materiaux, explication };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUALITÉ — REMPLIE par le Point 2 (b) : contrôles de fin de groupe.
// LE seul point de calcul de la Qualité (tout consommateur — bandeau, frise,
// PDF — passe par cette fonction). Module pur : les lignes des tables
// controles_groupe et reserves sont passées en argument par l'appelant.
//
//  ⚪ gris   : aucun groupe contrôlé → message incitatif (volontaire : le gris
//              pousse à faire le contrôle).
//  🟢 vert   : aucune réserve ouverte sur les groupes contrôlés.
//  🟠 orange : réserves ouvertes « fraîches » (statut reserve).
//  🔴 rouge  : au moins un NOK ouvert, OU réserve ANCIENNE non levée (elle
//              traîne d'un contrôle à l'autre, ou dépasse le seuil en jours
//              — le signal le plus fort), OU conformité faible (pondération :
//              une réserve sur 50 tâches ne bascule pas le chantier au rouge,
//              mais 20 % de tâches signalées, si).
// ─────────────────────────────────────────────────────────────────────────────
export const SEUIL_QUALITE_CONFORMITE_ROUGE = 0.8; // < 80 % de tâches conformes → rouge

export function calculQualite({ reserves = null, controles = null, todayISO = "" } = {}) {
  const stats = statsReservesChantier(reserves, controles, todayISO);

  if (!stats.nbGroupesControles) {
    return {
      statut: QCD_GRIS, valeur: null, valeurFormatee: "—", stats,
      explication: "Ce chantier n'a pas encore été contrôlé — réalisez les contrôles de fin de groupe.",
    };
  }

  const ancienne = (stats.plusAncienneJours != null && stats.plusAncienneJours >= SEUIL_RESERVE_ANCIENNE_JOURS)
    || stats.maxControlesDepuis >= SEUIL_RESERVE_ANCIENNE_CONTROLES;
  const conformiteFaible = stats.tauxConformite != null && stats.tauxConformite < SEUIL_QUALITE_CONFORMITE_ROUGE;

  const statut = (stats.nbNok > 0 || (stats.reservesOuvertes > 0 && ancienne) || conformiteFaible) ? QCD_ROUGE
    : stats.reservesOuvertes > 0 ? QCD_ORANGE
    : QCD_VERT;

  const s = (n) => (n > 1 ? "s" : "");
  const explication = [
    `${stats.nbGroupesControles} groupe${s(stats.nbGroupesControles)} contrôlé${s(stats.nbGroupesControles)}`,
    stats.tauxConformite != null ? `conformité ${fmtPct(stats.tauxConformite)}` : null,
    stats.reservesOuvertes > 0
      ? `${stats.reservesOuvertes} réserve${s(stats.reservesOuvertes)} ouverte${s(stats.reservesOuvertes)}`
      : "aucune réserve ouverte",
    stats.nbNok > 0 ? `${stats.nbNok} NOK` : null,
    stats.reservesOuvertes > 0 && stats.plusAncienneJours != null
      ? `la plus ancienne depuis ${stats.plusAncienneJours} jour${s(stats.plusAncienneJours)}${stats.maxControlesDepuis >= 1 ? ` et ${stats.maxControlesDepuis} contrôle${s(stats.maxControlesDepuis)} sans levée` : ""}`
      : null,
  ].filter(Boolean).join(" · ") + ".";

  return {
    statut,
    valeur: stats.tauxConformite,
    valeurFormatee: stats.tauxConformite != null ? fmtPct(stats.tauxConformite) : "—",
    explication, stats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue d'ensemble : les trois sommets à partir des données brutes du chantier.
// ─────────────────────────────────────────────────────────────────────────────
export function computeQCD(donnees = {}) {
  return {
    delai: calculDelai(donnees),
    cout: calculCout(donnees),
    qualite: calculQualite(donnees), // lit reserves / controles / todayISO
  };
}

// Adaptateur depuis le `brut` de computeChantierFinance (src/chantierFinance.mjs).
// Choix documentés :
//  - heures réelles = heuresReellesTotalChantier (tâches + libres + indirect +
//    reprise) : « somme des heures pointées du chantier », cohérent avec le
//    coût MO réel affiché sur la fiche (coutMOTotalChantier) ;
//  - avancement : entier 0-100 dans l'appli → converti en fraction ici ;
//  - MO prévu = moPrevChantier (heures vendues × taux MO prévisionnel) ;
//  - matériaux prévu = commandesPrevChantier (Σ ouvrages[].cout_materiaux).
// qualiteCtx (Point 2 b) : { reserves, controles, todayISO } — les lignes des
// tables reserves / controles_groupe du chantier, pour le sommet Qualité.
export function qcdDepuisFinance(brut, qualiteCtx = {}) {
  if (!brut) return computeQCD({ ...qualiteCtx });
  const avancement100 = toNum(brut.avancementChantier);
  return computeQCD({
    heuresReelles: brut.heuresReellesTotalChantier,
    heuresVendues: brut.heuresVenduesChantier,
    avancement: avancement100 != null ? avancement100 / 100 : null,
    coutMOReel: brut.coutMOTotalChantier,
    coutMOPrevu: brut.moPrevChantier,
    coutMateriauxReel: brut.coutMatChantier,
    coutMateriauxPrevu: brut.commandesPrevChantier,
    ...qualiteCtx,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTION MANUELLE des sommets (override).
// Le jugement du conducteur prime, comme dans la frise CRM : l'override se
// SUPERPOSE à la valeur automatique (qui reste calculée et affichée à côté),
// il ne l'altère jamais. Stockage dans phasages.plan_travaux.meta, en CLÉS
// PLATES (le saveMeta du repo fait un merge shallow au niveau meta : une clé
// par sommet évite d'écraser les overrides voisins).
// ─────────────────────────────────────────────────────────────────────────────
export const QCD_OVERRIDE_KEYS = {
  qualite: "qcd_override_qualite",
  cout: "qcd_override_cout",
  delai: "qcd_override_delai",
};

// Seuls les trois statuts « réels » sont forçables (pas le gris).
export const QCD_STATUTS_FORCABLES = [QCD_VERT, QCD_ORANGE, QCD_ROUGE];

// Lit et valide les overrides depuis meta (tolérant aux données absentes ou
// corrompues). Renvoie { qualite, cout, delai } — chaque entrée est
// { statut, commentaire, auteur, date } ou null.
export function lireOverridesQCD(meta) {
  const out = { qualite: null, cout: null, delai: null };
  if (!meta || typeof meta !== "object") return out;
  for (const [axe, key] of Object.entries(QCD_OVERRIDE_KEYS)) {
    const o = meta[key];
    if (o && typeof o === "object" && QCD_STATUTS_FORCABLES.includes(o.statut)) {
      out[axe] = {
        statut: o.statut,
        commentaire: typeof o.commentaire === "string" ? o.commentaire : "",
        auteur: typeof o.auteur === "string" ? o.auteur : "",
        date: typeof o.date === "string" ? o.date : "",
      };
    }
  }
  return out;
}

// Construit l'objet à stocker pour forcer un sommet. Renvoie null si le statut
// n'est pas forçable ou si le commentaire (obligatoire) est vide. La date est
// fournie par l'appelant : module pur, pas d'horloge ici.
export function construireOverrideQCD({ statut, commentaire, auteur, date } = {}) {
  if (!QCD_STATUTS_FORCABLES.includes(statut)) return null;
  const com = String(commentaire || "").trim();
  if (!com) return null;
  return { statut, commentaire: com, auteur: String(auteur || "").trim(), date: String(date || "") };
}

// ── Méthode de calcul en clair (infobulles / panneau de détail du bandeau).
// Règle du repo : un texte, un seul endroit, jamais rédigé en dur dans l'UI.
export const QCD_METHODE = {
  delai: {
    titre: "Délai",
    formule: "heures réelles ÷ (heures vendues × avancement)",
    description:
      "Compare les heures pointées (validées) aux heures qu'on devrait avoir consommées au rythme du devis, "
      + "à l'avancement réel du chantier. À 1,00 on est dans le devis ; "
      + `vert < ${fmtIndice(SEUIL_DELAI_ORANGE)}, orange jusqu'à ${fmtIndice(SEUIL_DELAI_ROUGE)}, rouge au-delà. `
      + `Neutre (démarrage) sous ${fmtPct(SEUIL_DELAI_AVANCEMENT_MIN)} d'avancement : l'indice est instable.`,
  },
  cout: {
    titre: "Coût",
    formule: "pire de (coût MO réel ÷ MO prévu) et (matériaux réels ÷ matériaux prévus)",
    description:
      "Compare chaque famille de coût au budget TOTAL prévu (pas proraté par l'avancement : c'est un signal plafond, "
      + "complémentaire du Délai). "
      + `Vert < ${fmtPct(SEUIL_COUT_ORANGE)}, orange jusqu'à ${fmtPct(SEUIL_COUT_ROUGE)}, rouge au-delà (budget dépassé). `
      + "Non évaluable si le budget prévu est absent ou à zéro.",
  },
  qualite: {
    titre: "Qualité",
    formule: "contrôles de fin de groupe (réserves ouvertes, NOK, ancienneté, conformité)",
    description:
      "Alimentée par les contrôles de fin de groupe : vert sans réserve ouverte, orange sur réserves fraîches, "
      + `rouge sur NOK ouvert, réserve ancienne (≥ ${SEUIL_RESERVE_ANCIENNE_JOURS} j ou non levée malgré un contrôle suivant) `
      + `ou conformité < ${fmtPct(SEUIL_QUALITE_CONFORMITE_ROUGE)}. Gris tant qu'aucun groupe n'est contrôlé.`,
  },
};
