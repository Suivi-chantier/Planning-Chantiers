// api/_ia/renovation/outils.js — Les quatre outils en lecture seule de la V1.
//
// Contrat d'un outil (identique au Copilote Invest) :
//   nom          identifiant stable, exposé au modèle
//   description  ce que le modèle lit pour décider s'il l'appelle
//   schema       JSON Schema des paramètres, neutre vis-à-vis du fournisseur
//   executer(params, ctx) → objet structuré
//   ctx.sb       adaptateur Supabase en LECTURE SEULE (donnees.js) — fourni par
//                le serveur, jamais par le modèle.
//
// AUCUN CALCUL ICI. Chaque chiffre vient d'un module existant (voir
// moteurs.js) : ce fichier charge, appelle, et met en forme. Il ne somme pas,
// ne multiplie pas, ne divise pas. Le seul traitement numérique est
// l'arrondi au centime pour l'affichage — le même que celui du relevé
// journalier. Le script de vérification le contrôle statiquement.
//
// UNE ABSENCE RESTE UNE ABSENCE. Une valeur inconnue est transmise à null,
// accompagnée d'une phrase qui dit pourquoi. Un relevé absent n'est jamais
// présenté comme « aucune alerte ».

const { fetchAll, chargerDonneesFinance } = require("../../_partage/donneesFinanceChantiers");
const { moteurs } = require("./moteurs");

// Chantiers jamais affichés dans les alertes. MÊME LISTE que
// CHANTIERS_EXCLUS de src/Renovation/PageAlertes.jsx (DÉPOT est le stock
// interne, pas un chantier). Le fichier JSX ne pouvant pas être importé côté
// serveur, l'égalité des deux listes est vérifiée par
// scripts/verif-renovation-copilot-v1.mjs.
const CHANTIERS_EXCLUS_ALERTES = ["DÉPOT"];

// Relevés JOURNALIERS (refonte du Bilan, étape 3 — option A de Loris du
// 24/10/2026 : les relevés du vendredi ne sont plus écrits). Mêmes colonnes
// que la page Alertes (COLONNES_RELEVES_ALERTES_V2 de pointsAttentionDonneesV1),
// qui portent aussi tout ce dont l'historique d'une alerte a besoin.
const TABLE_RELEVES = "chantier_releves_journaliers";
// Fenêtre de lecture : du dimanche de la semaine de comparaison moins 27 jours
// (un chantier à l'arrêt garde son dernier relevé) au dimanche de la semaine
// du relevé — exactement la fenêtre de la page Alertes.
const JOURS_AVANT_COMPARAISON = -27;

// Mêmes colonnes que les États financiers pour la colonne « Facturé ProGBat ».
const COLONNES_SITUATIONS =
  "chantier_id, date_facture, progbat_situation_number, progbat_achievement, progbat_deal_net_total";

const NB_RELEVES_HISTORIQUE = 8;
const MAX_RESULTATS_RECHERCHE = 30;

const str = (v) => (v == null ? "" : String(v).trim());
const arrondi = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
};
const normaliser = (v) =>
  str(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ");

// ─────────────────────────────────────────────────────────────────────────────
// Semaines de relevé
// ─────────────────────────────────────────────────────────────────────────────

// Semaine ISO qui précède `weekId`, nommée avec les helpers du Bilan Semaine.
// Sert à désigner la semaine de comparaison ; elle peut ne pas avoir de relevé,
// et c'est alors alertesV1 qui le dit (relevé précédent indisponible).
function semainePrecedente(weekId, semaines) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(str(weekId));
  if (!m) return null;
  const annee = Number(m[1]);
  const numero = Number(m[2]);
  if (numero > 1) return `${annee}-W${String(numero - 1).padStart(2, "0")}`;
  // Semaine 1 : la précédente est la 53 de l'année d'avant si elle existe.
  const lundi = semaines.lundiSemaineISOv1(weekId);
  const cible = semaines.ajouterJoursV1(lundi, -7);
  const w53 = `${annee - 1}-W53`;
  return semaines.lundiSemaineISOv1(w53) === cible ? w53 : `${annee - 1}-W52`;
}

// Seuils des alertes réglés dans Admin (planning_config.seuils_marges) —
// absents : les défauts du module, comme la page Alertes.
async function lireSeuilsMarges(sb, m) {
  const { data, error } = await sb.from("planning_config").select("value")
    .eq("key", m.finance.CLE_CONFIG_SEUILS_MARGES).maybeSingle();
  if (error) throw new Error(`planning_config : ${error.message}`);
  return (data && data.value) || null;
}

// Charge les relevés journaliers de la semaine du dernier relevé et de la
// semaine qui la précède, puis appelle le moteur d'alertes — exactement la
// chaîne de la page Alertes : preparerSemainesRelevesJournaliersV2 →
// alertesMargesV2 → alertesV1 → etatAlertesV1.
async function calculerAlertes(sb) {
  const m = await moteurs();
  const { data: derniers, error } = await sb
    .from(TABLE_RELEVES)
    .select("week_id, date_releve")
    .order("date_releve", { ascending: false })
    .limit(1);
  if (error) throw new Error(`${TABLE_RELEVES} : ${error.message}`);

  const semaine = str(derniers && derniers[0] && derniers[0].week_id) || null;
  const precedente = semaine ? semainePrecedente(semaine, m.semaines) : null;
  const weekIds = [semaine, precedente].filter(Boolean);

  let lignes = [];
  if (weekIds.length) {
    const fin = m.donneesAttention.dimancheSemaineISOV2(semaine);
    const debut = m.semaines.ajouterJoursV1(
      m.donneesAttention.dimancheSemaineISOV2(weekIds[weekIds.length - 1]), JOURS_AVANT_COMPARAISON);
    lignes = await fetchAll(sb, TABLE_RELEVES, m.donneesAttention.COLONNES_RELEVES_ALERTES_V2,
      (q) => q.gte("date_releve", debut).lte("date_releve", fin).order("date_releve", { ascending: true }));
  }
  const [courants, precedents] = m.donneesAttention.preparerSemainesRelevesJournaliersV2({ lignes, weekIds });

  // Détection : alertes des marges (étape 2), avec les seuils d'Admin.
  const pointsAttention = m.alertesMarges.alertesMargesV2({
    snapshotsCourants: courants || [], snapshotsPrecedents: precedents || [],
    seuils: await lireSeuilsMarges(sb, m),
  });
  const resultat = m.alertes.alertesV1({
    snapshotsCourants: courants || [],
    snapshotsPrecedents: precedents || [],
    pointsAttention,
    exclusions: CHANTIERS_EXCLUS_ALERTES,
  });
  const etat = m.alertes.etatAlertesV1(resultat);

  // Date du relevé : la plus récente des lignes retenues de la semaine.
  let dateReleve = null;
  for (const l of courants || []) {
    const d = str(l.date_releve).slice(0, 10);
    if (d && (!dateReleve || d > dateReleve)) dateReleve = d;
  }

  return { m, resultat, etat, semaine, precedente, dateReleve, courants: courants || [] };
}

function exposerAlerte(a, m) {
  return {
    chantier_id: a.chantierId,
    nom: a.nom,
    niveau: a.niveau,
    motifs: a.motifs.map((code) => ({ code, libelle: m.alertes.libelleMotifAlerteV1(code) })),
    impact_euros: a.impactEuros,             // null = inconnu, jamais 0
    avancement_pct: a.avancement,
    marge_a_terminaison: a.margeTerminaison,
    marge_perdue_semaine: a.margePerdue,
    fiabilite: a.fiabilite ? a.fiabilite.message : null,
    explication: a.explication,
  };
}

function exposerEtat(etat) {
  return { statut: etat.statut, message: etat.message };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. chercher_chantier
// ─────────────────────────────────────────────────────────────────────────────

const chercher_chantier = {
  nom: "chercher_chantier",
  description:
    "Retrouve un chantier Rénovation par son nom (ou une partie du nom). Renvoie les chantiers " +
    "correspondants avec leur identifiant. À appeler AVANT etat_chantier ou expliquer_alerte dès " +
    "que l'utilisateur nomme un chantier. Si plusieurs chantiers correspondent, NE PAS en choisir " +
    "un : présenter la liste et demander lequel.",
  schema: {
    type: "object",
    properties: {
      texte: { type: "string", description: "Nom ou partie du nom du chantier, tel que l'utilisateur l'a écrit." },
    },
    required: ["texte"],
  },
  async executer(params, ctx) {
    const texte = str(params.texte);
    const cle = normaliser(texte);
    if (!cle) {
      return { type: "recherche_chantier", texte, nb: 0, chantiers: [], ambigu: false,
        consigne: "Aucun nom fourni : demander à l'utilisateur de quel chantier il parle." };
    }
    const { data, error } = await ctx.sb
      .from("planning_config").select("value").eq("key", "chantiers").maybeSingle();
    if (error) throw new Error(`planning_config/chantiers : ${error.message}`);
    const liste = Array.isArray(data && data.value) ? data.value : [];

    const trouves = liste
      .filter((c) => c && c.id != null)
      .filter((c) => normaliser(c.nom).includes(cle) || normaliser(c.id).includes(cle))
      .map((c) => ({ id: String(c.id), nom: str(c.nom) || String(c.id), statut: c.statut || null }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

    const nb = trouves.length;
    let consigne = null;
    if (nb === 0) consigne = "Aucun chantier ne correspond : le dire, sans proposer de chantier au hasard.";
    else if (nb > 1) consigne =
      `${nb} chantiers correspondent. Présenter la liste et DEMANDER à l'utilisateur lequel ; ` +
      "ne pas en choisir un, ne pas appeler etat_chantier ou expliquer_alerte avant sa réponse.";

    return {
      type: "recherche_chantier",
      texte,
      nb,
      ambigu: nb > 1,
      chantiers: trouves.slice(0, MAX_RESULTATS_RECHERCHE),
      tronque: nb > MAX_RESULTATS_RECHERCHE,
      consigne,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. etat_chantier
// ─────────────────────────────────────────────────────────────────────────────

const etat_chantier = {
  nom: "etat_chantier",
  description:
    "État financier et d'avancement d'UN chantier, calculé en direct par le module financier de " +
    "l'application (celui des relevés journaliers et de la fiche chantier) : avancement, vendu HT, " +
    "marge, marge à terminaison, heures prévues et réelles, reste à faire, situation à facturer, " +
    "facturé ProGBat. Renvoie aussi la date des données et les avertissements de fiabilité, à " +
    "reprendre dans la réponse. Nécessite l'identifiant exact renvoyé par chercher_chantier.",
  schema: {
    type: "object",
    properties: {
      chantier_id: { type: "string", description: "Identifiant exact du chantier (champ id de chercher_chantier)." },
    },
    required: ["chantier_id"],
  },
  async executer(params, ctx) {
    const chantierId = str(params.chantier_id);
    if (!chantierId) {
      return { type: "etat_chantier", trouve: false, message: "Identifiant de chantier manquant." };
    }
    const m = await moteurs();

    // MÊME chargement que le relevé journalier, restreint à ce chantier.
    const donnees = await chargerDonneesFinance(ctx.sb, { chantierId });
    const phasage = donnees.phasagesUniques.find((ph) => str(ph.chantier_id) === chantierId) || null;
    if (!phasage) {
      return {
        type: "etat_chantier",
        chantier_id: chantierId,
        trouve: false,
        message: "Aucun phasage enregistré pour ce chantier : son état financier ne peut pas être calculé.",
      };
    }

    // aujourdhui : taux de frais généraux du jour pour les projections.
    const fin = m.finance.computeChantierFinance(donnees.inputsPour(phasage, { aujourdhui: new Date().toISOString().slice(0, 10) }));
    const b = fin.brut;

    const situations = await fetchAll(ctx.sb, "chantier_factures_client", COLONNES_SITUATIONS,
      (q) => q.eq("chantier_id", chantierId).order("date_facture", { ascending: false }));
    const facture = m.donneesLiees.indexerSituations(situations).get(chantierId) || null;

    // Le drapeau de fiabilité vient du moteur d'alertes : même phrase que sur
    // la page Alertes, jamais de montant corrigé.
    const fiabilite = m.alertes.fiabiliteV1({ warnings: fin.warnings });

    const indisponibles = [];
    if (b.situationAFacturer == null) indisponibles.push("Situation à facturer : % facturé non disponible dans les États financiers.");
    if (!facture) indisponibles.push(`Facturé ProGBat : ${m.donneesLiees.infobulleFacture(null)}.`);
    else if (facture.pct == null) indisponibles.push("Facturé ProGBat : montant du marché absent, pourcentage non calculable.");
    if (b.resteACommander == null) indisponibles.push("Reste à commander : bibliothèque de matériaux indisponible.");

    return {
      type: "etat_chantier",
      trouve: true,
      chantier: { id: chantierId, nom: str(phasage.chantier_nom) || chantierId },
      date_donnees: {
        calcule_le: new Date().toISOString(),
        nature: "Calcul en direct à partir du phasage, des pointages et des commandes enregistrés.",
        dernier_pointage: fin.fraicheur.dernierPointage,
        nb_pointages: fin.fraicheur.nbPointages,
      },
      chiffres: {
        avancement_pct: b.avancementChantier,
        vendu_ht: arrondi(b.prixHTChantier),
        // Étape 2 : trois marges ; l'ancienne « marge nette » est le budget
        // restant (vendu − coûts engagés), qui n'est PAS une marge.
        marge_a_l_avancement: arrondi(b.margeAvancement),
        production_cumulee: arrondi(b.productionCumulee),
        materiaux_en_avance: arrondi(b.materiauxEnAvance),
        marge_a_terminaison: arrondi(b.margeATerminaison),
        marge_probable: arrondi(b.margeProbable),
        budget_restant: arrondi(b.margeChantier),
        chantier_repris: b.repris === true,
        heures_vendues: arrondi(b.heuresVenduesChantier),
        heures_reelles: arrondi(b.heuresReellesTotalChantier),
        reste_a_faire_heures: arrondi(b.heuresRestantes),
        reste_a_faire_euros: arrondi(b.resteAFaireEuros),
        reste_a_commander: arrondi(b.resteACommander),
        situation_a_facturer: arrondi(b.situationAFacturer),
        facture_progbat: facture
          ? {
              cumul_facture_euros: arrondi(facture.cumulEuros),
              montant_marche_euros: arrondi(facture.marcheEuros),
              pct_facture: arrondi(facture.pct),
              numero_situation: facture.numeroSituation,
              date_situation: facture.date,
            }
          : null,
      },
      avertissements: (fin.warnings || []).map((w) => ({ code: w.code, gravite: w.gravite, message: w.message })),
      fiabilite: fiabilite ? fiabilite.message : null,
      indisponibles,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. alertes
// ─────────────────────────────────────────────────────────────────────────────

const alertes = {
  nom: "alertes",
  description:
    "Les alertes du dernier relevé journalier (sa semaine comparée à la précédente), triées par le moteur de la page Alertes " +
    "(critique, à surveiller, information), dépôt exclu. Distingue trois états : relevé absent, " +
    "aucune alerte, alertes. Utiliser pour « quels chantiers sont en alerte ? », « par quoi " +
    "commencer cette semaine ? ».",
  schema: { type: "object", properties: {} },
  async executer(_params, ctx) {
    const { m, resultat, etat, semaine, precedente, dateReleve } = await calculerAlertes(ctx.sb);
    return {
      type: "alertes",
      semaine_releve: semaine,
      date_releve: dateReleve,
      semaine_comparaison: precedente,
      releve_comparaison_disponible: resultat.relevePrecedentDisponible === true,
      etat: exposerEtat(etat),
      totaux: resultat.totaux,
      alertes: resultat.alertes.map((a) => exposerAlerte(a, m)),
      marge_surestimee: resultat.margeSurestimee,
      exclus: resultat.exclus,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. expliquer_alerte
// ─────────────────────────────────────────────────────────────────────────────

const expliquer_alerte = {
  nom: "expliquer_alerte",
  description:
    "Explique pourquoi UN chantier est en alerte : ses motifs dans le moteur d'alertes (dernier " +
    "relevé) et l'historique de ses 8 dernières semaines (dernier relevé journalier de chaque semaine : " +
    "avancement, heures, budget restant, marges à l'avancement, à terminaison et probable). " +
    "Nécessite l'identifiant exact renvoyé par chercher_chantier.",
  schema: {
    type: "object",
    properties: {
      chantier_id: { type: "string", description: "Identifiant exact du chantier (champ id de chercher_chantier)." },
    },
    required: ["chantier_id"],
  },
  async executer(params, ctx) {
    const chantierId = str(params.chantier_id);
    if (!chantierId) {
      return { type: "explication_alerte", trouve: false, message: "Identifiant de chantier manquant." };
    }
    const { m, resultat, etat, semaine, dateReleve, courants } = await calculerAlertes(ctx.sb);

    const alerte = resultat.alertes.find((a) => a.chantierId === chantierId) || null;
    const snapCourant = courants.find((s) => str(s.chantier_id) === chantierId) || null;

    let raisonSansAlerte = null;
    if (!alerte) {
      if (etat.statut === m.alertes.ETAT_RELEVE_ABSENT) raisonSansAlerte = etat.message;
      else if (snapCourant && m.alertes.estExcluV1(snapCourant, CHANTIERS_EXCLUS_ALERTES)) {
        raisonSansAlerte = "Ce chantier est exclu des alertes (stock interne, pas un chantier).";
      } else if (!snapCourant) {
        raisonSansAlerte = `Ce chantier ne figure pas dans le relevé de la semaine ${semaine} : pas de relevé pour lui cette semaine-là (chantier jugé inactif par le relevé, ou pas encore relevé). Ce n'est pas « aucune alerte ».`;
      } else {
        raisonSansAlerte = `Aucune alerte pour ce chantier dans le relevé de la semaine ${semaine}.`;
      }
    }

    // Historique : les relevés journaliers du chantier, un par semaine (le
    // dernier relevé de la semaine, choisi par le module de données), pour
    // les 8 semaines les plus récentes qui ont un relevé.
    const lignes = await fetchAll(ctx.sb, TABLE_RELEVES, m.donneesAttention.COLONNES_RELEVES_ALERTES_V2,
      (q) => q.eq("chantier_id", chantierId).order("date_releve", { ascending: false }));
    const semainesChantier = [];
    for (const l of lignes) {
      const w = str(l.week_id);
      if (w && !semainesChantier.includes(w)) semainesChantier.push(w);
      if (semainesChantier.length === NB_RELEVES_HISTORIQUE) break;
    }
    const parSemaine = m.donneesAttention.preparerSemainesRelevesJournaliersV2({ lignes, weekIds: semainesChantier });

    const historique = semainesChantier.map((w, i) => {
      const l = (parSemaine[i] || [])[0] || {};
      return {
        semaine: w,
        date: str(l.date_releve).slice(0, 10) || null,
        journee: str(l.statut_completude) || null,
        avancement_pct: arrondi(l.avancement),
        heures_vendues: arrondi(l.heures_vendues),
        heures_reelles: arrondi(l.heures_reelles),
        budget_restant: arrondi(l.budget_restant),
        marge_a_l_avancement: arrondi(l.marge_avancement),
        marge_a_terminaison: arrondi(l.marge_terminaison),
        marge_probable: arrondi(l.marge_probable),
      };
    });

    const nom = (alerte && alerte.nom) || str(snapCourant && snapCourant.chantier_nom) ||
      str(lignes[0] && lignes[0].chantier_nom) || chantierId;

    return {
      type: "explication_alerte",
      trouve: true,
      chantier: { id: chantierId, nom },
      semaine_releve: semaine,
      date_releve: dateReleve,
      etat_releve: exposerEtat(etat),
      alerte: alerte ? exposerAlerte(alerte, m) : null,
      raison_sans_alerte: raisonSansAlerte,
      historique,
      historique_vide: historique.length === 0
        ? "Aucun relevé journalier enregistré pour ce chantier."
        : null,
    };
  },
};

const OUTILS = [chercher_chantier, etat_chantier, alertes, expliquer_alerte];

module.exports = {
  OUTILS,
  parNom: Object.fromEntries(OUTILS.map((o) => [o.nom, o])),
  CHANTIERS_EXCLUS_ALERTES,
  semainePrecedente,
};
