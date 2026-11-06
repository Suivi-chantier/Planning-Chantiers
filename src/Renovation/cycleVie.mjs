// ─────────────────────────────────────────────────────────────────────────────
// CYCLE DE VIE du chantier — référentiel des 5 phases (Refonte Opérations,
// lot 3 : docs/projets/refonte-operations.md) et helpers purs. AUCUN affichage
// ici : la frise de la fiche chantier, la synthèse de la page Opération,
// l'export d'opération et la tâche des relances consomment ce module.
//
//   1. Étude → 2. Contrat → 3. Préparation → 4. Travaux → 5. Réception
//
// Le lot 3 a remplacé les 6 phases d'origine (Devis … Garanties/SAV). Les
// états déjà validés de l'ancien cycle sont REPRIS À LA LECTURE (module
// cycleVieReprise.mjs) : rien n'est réécrit en base.
//
// ⚠️ VOCABULAIRE — à ne JAMAIS confondre :
//  - Les « phases » du cycle de vie (ce fichier, ids préfixés cv_) sont au
//    niveau CHANTIER. Elles n'utilisent PAS le mécanisme du Phasage V1
//    (plan_travaux[phase_id]), qui reste intouchable.
//  - Les « groupes » (meta.chrono_groupes) sont les étapes d'exécution des
//    travaux, contenues dans la phase cv_travaux (une entrée par groupe).
//
// Natures de validation par étape :
//  - "auto"     : déduite d'une donnée déjà présente (champ `signal`).
//                 Jamais cochée à la main, toujours expliquée (raison).
//  - "document" : validée par l'import d'un fichier (devis, PV…), avec
//                 d'éventuels champs (date de signature, de réception).
//  - "coche"    : validée manuellement.
// Options d'étape :
//  - agenda   : bouton « Créer l'événement Google Agenda » (module agendaGoogle)
//  - progbat  : bouton « Ouvrir dans ProGBat » (module progbatLiens) — "devis",
//               "facture_acompte", "facture_solde"
//  - partagee : étape partagée entre les chantiers d'une même opération
//               (« Autorisation reçue ») — calcul à la lecture, aucune copie
//  - relance  : "devis" | "acompte" — l'étape affiche les relances e-mail
//               (module relancesCycleVie)
//  - accept   : types de fichiers proposés à l'import
// Le champ `hint` est l'indice de validation en clair, affiché tel quel.
//
// RÈGLE TRANSVERSE : toute étape peut porter des pièces jointes en preuve.
//
// Extension .mjs = parsable ESM par Node sans build (tests, crons) ; le front
// importe la façade src/Renovation/cycleVie.js.
// ─────────────────────────────────────────────────────────────────────────────

import { dernierControleGroupe } from "./controles.mjs";
import {
  etatsEtapesRepris, phaseDeclareeReprise, etatsAnciens, nomAncienneEtape,
  CORRESPONDANCE_ANCIENNES_PHASES,
} from "./cycleVieReprise.mjs";
import {
  etatFactureProgbat, referenceAnnulationProgbat, grouperReglements, ETAT as ETAT_FACTURE,
} from "./facturesProgbatAffichage.mjs";

export const CV_NATURES = ["auto", "document", "coche"];

export const CYCLE_VIE_PHASES = [
  {
    id: "cv_etude", ordre: 1, nom: "Étude", couleur: "#5b9cf6",
    etapes: [
      { id: "visite_chiffrage", nom: "Visite avant chiffrage + Imapper", nature: "coche",
        agenda: { titre: "Visite avant chiffrage + Imapper" },
        hint: "Case « Fait » une fois la visite faite et le relevé Imapper pris. Le bouton Google Agenda prépare le rendez-vous (nom du chantier et adresse pré-remplis)." },
      { id: "chiffrage_realise", nom: "Chiffrage réalisé", nature: "auto",
        signal: "chiffrage_existant",
        hint: "Validé automatiquement dès que le chantier a un chiffrage (phasage avec heures ou prix, ou chiffrage rattaché)." },
      { id: "devis_envoye", nom: "Devis envoyé", nature: "document", progbat: "devis",
        hint: "Se valide en important le devis envoyé au client. La date d'import sert de date d'envoi (point de départ des relances)." },
      { id: "relance_devis", nom: "Relance devis", nature: "auto", signal: "relance", relance: "devis",
        hint: "Automatique : e-mail au chargé d'affaires après le délai réglé (7 jours par défaut), puis chaque semaine jusqu'à la signature." },
    ],
  },
  {
    id: "cv_contrat", ordre: 2, nom: "Contrat", couleur: "#a78bfa",
    etapes: [
      { id: "devis_signe", nom: "Devis signé", nature: "document", progbat: "devis",
        champs: [{ id: "date", nom: "Date de signature", type: "date" }],
        hint: "Se valide en important le devis signé, avec sa date de signature. Le chantier « À l'étude » passe alors en « Planifié » et les relances devis s'arrêtent." },
      { id: "acompte_encaisse", nom: "Acompte encaissé", nature: "auto", signal: "acompte_encaisse", progbat: "facture_acompte",
        // Champs des anciennes coches manuelles (reprises) : affichage typé seulement.
        champs: [{ id: "montant", nom: "Montant (€)", type: "nombre" }, { id: "date", nom: "Date d'encaissement", type: "date" }],
        hint: "Automatique : validé quand la facture d'acompte est réglée (règlements ProGBat synchronisés, ou encaissement saisi dans le bloc Facturation)." },
      { id: "relance_acompte", nom: "Relance acompte", nature: "auto", signal: "relance", relance: "acompte",
        hint: "Automatique : e-mail au chargé d'affaires après le délai réglé suivant l'émission de la facture d'acompte, puis chaque semaine jusqu'à l'encaissement." },
      { id: "autorisation_recue", nom: "Autorisation reçue (DP ou autre)", nature: "coche", partagee: true,
        hint: "Case à cocher. Étape partagée : validée sur un chantier, elle vaut pour les autres chantiers de la même opération (sauf s'ils sont dé-partagés)." },
    ],
  },
  {
    id: "cv_preparation", ordre: 3, nom: "Préparation", couleur: "#f5a623",
    etapes: [
      { id: "visite_conducteur_ca", nom: "Visite conducteur + chargé d'affaires", nature: "coche",
        agenda: { titre: "Visite conducteur + chargé d'affaires" },
        hint: "Case « Fait » une fois la visite faite. Le bouton Google Agenda prépare le rendez-vous." },
      { id: "plans_techniques", nom: "Plans techniques", nature: "document",
        hint: "Se valide en important les plans techniques (visibles aussi des ouvriers dans leur espace)." },
      { id: "phasage_cree", nom: "Phasage créé", nature: "auto", signal: "phasage_materiaux",
        hint: "Automatique : validé quand le phasage existe ET contient les matériaux prévus (pas seulement des heures)." },
      { id: "planning_previsionnel", nom: "Planning prévisionnel", nature: "document", accept: ".pdf,application/pdf",
        hint: "Se valide en important le planning prévisionnel (PDF)." },
      { id: "visite_conducteur_chef", nom: "Visite conducteur + chef de chantier", nature: "coche",
        agenda: { titre: "Visite conducteur + chef de chantier" },
        hint: "Case « Fait » une fois la visite faite. Le bouton Google Agenda prépare le rendez-vous." },
      { id: "preparation_finalisee", nom: "Finalisation de la préparation", nature: "coche",
        hint: "Case à cocher quand la préparation est terminée." },
    ],
  },
  {
    // Phase DYNAMIQUE : une entrée par groupe du chantier, générée par
    // etapesTravauxDepuisGroupes(), validée par son contrôle de fin de groupe.
    id: "cv_travaux", ordre: 4, nom: "Travaux", couleur: "#FFC300", dynamique: true,
    etapes: [],
    hint: "Une entrée par groupe d'exécution (meta.chrono_groupes), dans leur ordre, chacune validée par son contrôle de fin de groupe.",
  },
  {
    id: "cv_reception", ordre: 5, nom: "Réception", couleur: "#22c55e",
    etapes: [
      { id: "pre_reception", nom: "Pré-réception interne", nature: "auto", signal: "groupes_controles",
        hint: "Automatique : validée quand tous les groupes d'exécution sont contrôlés." },
      { id: "reception_pv", nom: "Réception + PV", nature: "document",
        champs: [{ id: "date", nom: "Date de réception", type: "date" }],
        hint: "Se valide en important le PV de réception, avec la date de réception." },
      { id: "levee_reserves", nom: "Levée des réserves", nature: "coche",
        hint: "Case à cocher une fois toutes les réserves de réception levées. Les réserves de réception ne sont pas saisies dans l'application (seules les réserves des contrôles de groupe le sont) : la case reste manuelle." },
      { id: "facture_solde", nom: "Facture de solde", nature: "auto", signal: "facture_client", ligneId: "solde", progbat: "facture_solde",
        hint: "Automatique : validée quand la facture de solde est émise (échéance « solde » du bloc Facturation)." },
    ],
  },
];

// ── Index et helpers de navigation (purs) ────────────────────────────────────

// Toutes les étapes STATIQUES à plat, chacune enrichie de son phaseId.
export const CYCLE_VIE_ETAPES = CYCLE_VIE_PHASES.flatMap(
  ph => ph.etapes.map(e => ({ ...e, phaseId: ph.id }))
);
export const CYCLE_VIE_PHASE_IDS = CYCLE_VIE_PHASES.map(p => p.id);

export const getPhase = (phaseId) => CYCLE_VIE_PHASES.find(p => p.id === phaseId) || null;
export const getEtape = (etapeId) => CYCLE_VIE_ETAPES.find(e => e.id === etapeId) || null;
export const phaseDeEtape = (etapeId) => {
  const e = getEtape(etapeId);
  return e ? getPhase(e.phaseId) : null;
};
/** Nom affichable d'une étape, du nouveau cycle ou de l'ancien (pièces conservées). */
export const nomEtape = (etapeId) => getEtape(etapeId)?.nom || nomAncienneEtape(etapeId) || String(etapeId || "");

export const etapeSuivante = (etapeId) => {
  const i = CYCLE_VIE_ETAPES.findIndex(e => e.id === etapeId);
  return i >= 0 && i + 1 < CYCLE_VIE_ETAPES.length ? CYCLE_VIE_ETAPES[i + 1] : null;
};

export const phaseSuivante = (phaseId) => {
  const i = CYCLE_VIE_PHASES.findIndex(p => p.id === phaseId);
  return i >= 0 && i + 1 < CYCLE_VIE_PHASES.length ? CYCLE_VIE_PHASES[i + 1] : null;
};

// ── Témoin « groupe contrôlé » — REMPLI par le Point 2 (b), Prompt 5 ────────
// Un groupe est « terminé » quand ses tâches sont à 100 % ; il est « validé »
// quand son jalon de contrôle a été RÉALISÉ : au moins un contrôle enregistré
// pour ce groupe (table controles_groupe, lignes passées en argument — module
// pur, les appelants chargent). C'est LE seul témoin : la frise du cycle de
// vie et la règle de clôture de la phase Travaux le consomment tel quel.
export function controleGroupe(groupeId, controles) {
  const dernier = dernierControleGroupe(groupeId, controles);
  if (!dernier) return { controle: false, raison: "contrôle de fin de groupe à faire" };
  const dateLbl = String(dernier.date_controle || "").slice(0, 10);
  return {
    controle: true,
    raison: `contrôlé le ${dateLbl.split("-").reverse().join("/")}`,
    controleLe: dernier.date_controle || null,
  };
}

// Règle de clôture (Prompt 7 du 2 a) : la phase Travaux ne peut se terminer
// que lorsque TOUS les groupes du chantier sont contrôlés.
export function phaseTravauxTerminee(chronoGroupes, controles) {
  const groupes = Array.isArray(chronoGroupes) ? chronoGroupes.filter(g => g && g.id) : [];
  if (!groupes.length) return false;
  return groupes.every(g => controleGroupe(g.id, controles).controle);
}

// ── Phase Travaux : entrées dérivées des groupes du chantier ────────────────
// chronoGroupes = phasage.plan_travaux.meta.chrono_groupes ({ id, nom,
// couleur, ordre, groupe_type_id? }). Une entrée par groupe, dans leur ordre,
// de nature "auto" (témoin « contrôlé » fourni par controleGroupe).
// statsParGroupe (optionnel) = { [groupeId]: { avancement, termine, count } }
// — voir statsGroupeChrono de src/chantierFinance.mjs — pour afficher
// l'avancement de chaque groupe.
export function etapesTravauxDepuisGroupes(chronoGroupes, statsParGroupe = {}) {
  const groupes = Array.isArray(chronoGroupes) ? chronoGroupes.filter(g => g && g.id) : [];
  return groupes
    .slice()
    .sort((a, b) => {
      const oa = Number.isFinite(parseFloat(a.ordre)) ? parseFloat(a.ordre) : 1e9;
      const ob = Number.isFinite(parseFloat(b.ordre)) ? parseFloat(b.ordre) : 1e9;
      return oa - ob;
    })
    .map(g => {
      const stats = statsParGroupe?.[g.id] || null;
      return {
        id: `groupe_${g.id}`,
        nom: g.nom || "Groupe",
        nature: "auto",
        signal: "groupe_controle",
        phaseId: "cv_travaux",
        groupeId: g.id,
        couleur: g.couleur || null,
        avancement: stats ? stats.avancement : null,
        termine: stats ? !!stats.termine : false,
        nbTaches: stats ? stats.count : null,
        hint: "Groupe d'exécution : terminé quand ses tâches sont à 100 %, validé quand son jalon de contrôle est réalisé (Point 2 b).",
      };
    });
}

// ── Stockage ────────────────────────────────────────────────────────────────
// Nouveau cycle (lot 3) : table chantier_cycle_vie, une ligne par chantier et
// par étape — { fait, date, auteur, donnees, pieces_jointes, departage }.
// Ancien cycle : phasages.plan_travaux.meta (clés ci-dessous), relu et repris
// par cycleVieReprise.mjs, jamais réécrit.
export const CV_META_PHASE_DECLAREE = "cycle_vie_phase_declaree";
export const CV_META_ETAPES = "cycle_vie_etapes";

/** Ancien état brut du phasage (lecture tolérante), sans reprise. */
export function lireEtatsEtapes(meta) {
  return etatsAnciens(meta);
}

/**
 * États du NOUVEAU cycle pour un chantier : lignes de la table d'abord, sinon
 * reprise de l'ancien état du phasage (voir cycleVieReprise.mjs).
 * → { etats, nonReprises }
 */
export function etatsCycleVie({ meta = null, lignes = [] } = {}) {
  return etatsEtapesRepris({ meta, lignes });
}

/** Phase déclarée à la main (table, sinon ancienne déclaration traduite). */
export function phaseDeclareeCycleVie({ meta = null, lignes = [] } = {}) {
  return phaseDeclareeReprise({ meta, lignes, phasesValides: CYCLE_VIE_PHASE_IDS });
}

/** Compatibilité : phase déclarée de l'ancien stockage, traduite. */
export function lirePhaseDeclaree(meta) {
  const brut = meta && typeof meta === "object" ? meta[CV_META_PHASE_DECLAREE] : null;
  if (!brut || typeof brut !== "object") return null;
  const id = CORRESPONDANCE_ANCIENNES_PHASES[brut.phaseId] || brut.phaseId;
  if (!getPhase(id)) return null;
  return {
    phaseId: id,
    auteur: typeof brut.auteur === "string" ? brut.auteur : "",
    date: typeof brut.date === "string" ? brut.date : "",
  };
}

const jj = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : "";
};
const jour = (v) => {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAUX — calculs purs à partir des données déjà chargées par l'appelant.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facture d'acompte du chantier et son règlement.
 *   factures   : lignes de chantier_factures_client du chantier (toutes sources)
 *   reglements : lignes de chantier_factures_reglements de ces factures
 * Choix de la facture, dans l'ordre :
 *   1. celle rattachée à l'échéance « acompte » (ligne_id) ;
 *   2. sinon la PREMIÈRE facture d'acompte ProGBat du chantier (type advance,
 *      montant positif, hors document d'annulation) — signalé dans la raison.
 * Réglée = encaissement saisi dans le bloc Facturation (statut « encaissee »)
 * OU règlements ProGBat couvrant le montant (etatFactureProgbat : réglée).
 * → { facture, emiseLe, encaisse, billId, quoteId, numero, raison, choix }
 *   facture = null → aucune facture d'acompte émise.
 */
export function etatAcompteChantier({ factures = [], reglements = [] } = {}) {
  const vivantes = (Array.isArray(factures) ? factures : []).filter(f => f
    && f.statut !== "annulee"
    && !referenceAnnulationProgbat(f).est_document_annulation);
  const parDate = (a, b) => String(a.date_facture || a.created_at || "").localeCompare(String(b.date_facture || b.created_at || ""));
  let facture = vivantes.filter(f => f.ligne_id === "acompte").sort(parDate)[0] || null;
  let choix = facture ? "echeance" : null;
  if (!facture) {
    facture = vivantes
      .filter(f => f.progbat_type === "advance" && (parseFloat(f.montant_ttc) || 0) > 0)
      .sort(parDate)[0] || null;
    if (facture) choix = "premiere_progbat";
  }
  if (!facture) {
    return { facture: null, emiseLe: null, encaisse: false, billId: null, quoteId: null, numero: null, choix: null,
      raison: "Aucune facture d'acompte émise pour ce chantier." };
  }
  const numero = facture.numero || facture.progbat_bill_code || null;
  const emiseLe = jour(facture.date_facture) || jour(facture.progbat_document_date) || jour(facture.created_at);
  const nomF = `Facture d'acompte${numero ? ` ${numero}` : ""}${emiseLe ? ` émise le ${jj(emiseLe)}` : ""}`;
  const precision = choix === "premiere_progbat" ? " (première facture d'acompte ProGBat du chantier, non rattachée à l'échéance « acompte »)" : "";
  let encaisse = false;
  let detail = "";
  if (facture.statut === "encaissee") {
    encaisse = true;
    detail = `encaissée${facture.date_encaissement ? ` le ${jj(facture.date_encaissement)}` : ""}`;
  } else if (facture.source !== "manuel" && facture.progbat_bill_id != null) {
    const regl = grouperReglements(reglements).get(String(facture.id)) || [];
    const e = etatFactureProgbat(facture, regl);
    encaisse = e.etat === ETAT_FACTURE.REGLEE || e.etat === ETAT_FACTURE.SUR_REGLEE;
    detail = e.libelle ? e.libelle.toLowerCase() : "état de règlement inconnu";
  } else {
    detail = "en attente d'encaissement";
  }
  return {
    facture, emiseLe, encaisse, numero, choix,
    billId: facture.progbat_bill_id ?? null,
    quoteId: facture.progbat_quote_id ?? null,
    raison: `${nomF}${precision} : ${detail}.`,
  };
}

/**
 * Le phasage contient-il les matériaux prévus ? (étape « Phasage créé »)
 * phasage = ligne phasages ({ ouvrages: [{ libelle, cout_materiaux,
 * materiaux_liens }] }) ou null.
 * → { fait, raison, nbOuvrages, nbAvecMateriaux }
 */
export function etatPhasageMateriaux(phasage) {
  if (!phasage) return { fait: false, raison: "Aucun phasage lié à ce chantier.", nbOuvrages: 0, nbAvecMateriaux: 0 };
  const ouvrages = Array.isArray(phasage.ouvrages) ? phasage.ouvrages.filter(Boolean) : [];
  if (!ouvrages.length) return { fait: false, raison: "Le phasage existe mais ne contient aucun ouvrage.", nbOuvrages: 0, nbAvecMateriaux: 0 };
  const aMateriaux = (o) => (Array.isArray(o.materiaux_liens) && o.materiaux_liens.length > 0) || (parseFloat(o.cout_materiaux) || 0) > 0;
  const avec = ouvrages.filter(aMateriaux).length;
  const sans = ouvrages.length - avec;
  if (avec === 0) {
    return { fait: false, nbOuvrages: ouvrages.length, nbAvecMateriaux: 0,
      raison: `Phasage incomplet : ${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""} avec des heures, mais aucun matériau prévu. Il manque les matériaux.` };
  }
  return { fait: true, nbOuvrages: ouvrages.length, nbAvecMateriaux: avec,
    raison: `Phasage avec matériaux prévus : ${avec}/${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""}${sans ? ` (${sans} sans matériau : main-d'œuvre seule ?)` : ""}.` };
}

/**
 * Étape partagée « Autorisation reçue » : validée sur un chantier, elle vaut
 * pour les autres chantiers de la même opération. Rien n'est recopié : le
 * calcul se fait à la lecture.
 *   chantierId   : chantier affiché
 *   etatPropre   : état de l'étape SUR CE chantier (ou null)
 *   autres       : [{ chantierId, chantierNom, etat }] — même étape sur les
 *                  AUTRES chantiers de l'opération
 * → { fait, via: { chantierId, chantierNom, date, auteur } | null,
 *     departage: bool, raison }
 * departage = true : ce chantier a refusé le partage (etat.departage) — il
 * ne reprend pas la validation des autres.
 */
export function autorisationPartagee({ chantierId, etatPropre = null, autres = [] } = {}) {
  if (etatPropre?.fait) {
    return { fait: true, via: null, departage: !!etatPropre.departage,
      raison: `Validée sur ce chantier${etatPropre.date ? ` le ${jj(etatPropre.date)}` : ""}${etatPropre.auteur ? ` par ${etatPropre.auteur}` : ""}.` };
  }
  if (etatPropre?.departage) {
    return { fait: false, via: null, departage: true,
      raison: "Dé-partagée : ce chantier attend sa propre autorisation (les validations des autres chantiers ne comptent pas)." };
  }
  const source = (Array.isArray(autres) ? autres : [])
    .filter(a => a && String(a.chantierId) !== String(chantierId) && a.etat?.fait === true)
    .sort((a, b) => String(a.etat.date || "").localeCompare(String(b.etat.date || "")))[0];
  if (source) {
    return {
      fait: true, departage: false,
      via: { chantierId: source.chantierId, chantierNom: source.chantierNom || source.chantierId, date: source.etat.date || null, auteur: source.etat.auteur || null },
      raison: `Validée via le chantier ${source.chantierNom || source.chantierId}${source.etat.date ? ` le ${jj(source.etat.date)}` : ""}.`,
    };
  }
  return { fait: false, via: null, departage: false, raison: "À cocher dès réception de l'autorisation (vaudra pour toute l'opération)." };
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉVALUATION D'UNE ÉTAPE (fait / à faire) — pur.
// Contexte fourni par l'appelant (le module ne lit ni la DB ni l'horloge) :
//  - etatsEtapes  : etatsCycleVie(…).etats
//  - chiffrage    : bool — le chantier a un chiffrage
//  - acompte      : etatAcompteChantier(…)
//  - phasage      : etatPhasageMateriaux(…)
//  - groupes      : meta.chrono_groupes ; controles : lignes controles_groupe
//  - facturation  : facturationParLigne(etatFacturation(…)) (signal facture_client)
//  - relances     : { devis: decisionRelance(…), acompte: decisionRelance(…) }
//  - autorisation : autorisationPartagee(…)
// Renvoie { fait, auto, raison } — la raison est toujours affichable telle
// quelle. Un contexte absent n'est JAMAIS présenté comme un résultat : la
// raison dit « non chargé » / « inconnu ».
// ─────────────────────────────────────────────────────────────────────────────
const validationManuelle = (etat, suffixe = "") =>
  `Validée${etat?.date ? ` le ${jj(etat.date)}` : ""}${etat?.auteur ? ` par ${etat.auteur}` : ""}${suffixe}.`;

export function evaluerEtape(etape, ctx = {}) {
  const etats = ctx.etatsEtapes || {};
  const etat = etats[etape.id];
  const reprise = etat?.reprise ? ` (reprise de l'ancienne étape « ${etat.reprise.nom} »)` : "";

  if (etape.nature !== "auto") {
    if (etape.partagee && ctx.autorisation) {
      return { fait: !!ctx.autorisation.fait, auto: false, raison: ctx.autorisation.raison, via: ctx.autorisation.via || null, departage: !!ctx.autorisation.departage };
    }
    const fait = !!etat?.fait;
    return { fait, auto: false, raison: fait ? validationManuelle(etat, reprise) : etape.hint || "" };
  }

  switch (etape.signal) {
    case "chiffrage_existant": {
      if (ctx.chiffrage == null) return { fait: false, auto: true, raison: "Chiffrage non chargé." };
      const fait = !!ctx.chiffrage;
      return { fait, auto: true, raison: fait ? "Chiffrage présent pour ce chantier." : "Aucun chiffrage pour ce chantier." };
    }
    case "acompte_encaisse": {
      // Une validation à la main de l'ANCIEN cycle (case « Acompte encaissé »)
      // reste valable : on ne retire pas une information saisie.
      if (ctx.acompte?.encaisse) return { fait: true, auto: true, raison: ctx.acompte.raison };
      if (etat?.fait) return { fait: true, auto: true, raison: validationManuelle(etat, `${reprise || ""} — coche manuelle conservée`) };
      if (!ctx.acompte) return { fait: false, auto: true, raison: "Facturation du chantier non chargée." };
      return { fait: false, auto: true, raison: ctx.acompte.raison };
    }
    case "relance": {
      const d = ctx.relances?.[etape.relance];
      if (!d) return { fait: false, auto: true, raison: "État des relances non chargé." };
      const compte = d.nbEnvoyees ? ` ${d.nbEnvoyees} relance${d.nbEnvoyees > 1 ? "s" : ""} envoyée${d.nbEnvoyees > 1 ? "s" : ""}, dernière le ${jj(d.derniereLe)}.` : "";
      return { fait: d.statut === "terminee", auto: true, raison: `${d.raison}${compte}`, relance: d };
    }
    case "phasage_materiaux": {
      if (!ctx.phasage) return { fait: false, auto: true, raison: "Phasage non chargé." };
      return { fait: !!ctx.phasage.fait, auto: true, raison: ctx.phasage.raison };
    }
    case "groupes_controles": {
      const groupes = Array.isArray(ctx.groupes) ? ctx.groupes.filter(g => g && g.id) : [];
      if (!groupes.length) return { fait: false, auto: true, raison: "Aucun groupe d'exécution défini (vue chrono du phasage) : pré-réception impossible à constater." };
      const n = groupes.filter(g => controleGroupe(g.id, ctx.controles).controle).length;
      return n === groupes.length
        ? { fait: true, auto: true, raison: `Tous les groupes sont contrôlés (${n}/${groupes.length}).` }
        : { fait: false, auto: true, raison: `${n}/${groupes.length} groupe(s) contrôlé(s).` };
    }
    case "facture_client": {
      // État d'une échéance de facturation (module facturationClient) : la
      // case est cochée dès que la facture est ÉMISE.
      const ligne = ctx.facturation ? ctx.facturation[etape.ligneId] : null;
      if (!ligne) {
        return { fait: false, auto: true, raison: ctx.facturation ? "Échéance absente de l'échéancier de ce chantier." : "Facturation du chantier non chargée." };
      }
      return { fait: ligne.statut === "emise" || ligne.statut === "encaissee", auto: true, raison: ligne.raison };
    }
    case "groupe_controle": {
      const ctrl = controleGroupe(etape.groupeId, ctx.controles);
      if (ctrl.controle) return { fait: true, auto: true, raison: `Groupe ${ctrl.raison}.` };
      const av = Number.isFinite(parseFloat(etape.avancement)) ? Math.round(parseFloat(etape.avancement)) : null;
      const etatTravaux = etape.termine ? "Tâches à 100 %"
        : etape.nbTaches === 0 ? "Aucune tâche rattachée"
        : av != null ? `Avancement ${av} %`
        : "Avancement inconnu";
      return { fait: false, auto: true, raison: `${etatTravaux} — ${ctrl.raison}.` };
    }
    default:
      return { fait: !!etat?.fait, auto: true, raison: etape.hint || "" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIONNEMENT DANS LE CYCLE — la phase DÉDUITE est un maximum monotone,
// chaque signal empile une raison ; la phase DÉCLARÉE à la main est
// PRIORITAIRE (la déduite reste affichée à côté).
// ─────────────────────────────────────────────────────────────────────────────
export function computeCycleVie({
  statutChantier = null,   // "a_l_etude" | "planifie" | "en_cours" | "en_pause" | "termine" | "perdu"
  avancement = null,       // entier 0-100
  ctx = null,              // contexte d'evaluerEtape (prioritaire)
  chiffrage = false,
  etatsEtapes = {},
  phaseDeclaree = null,    // phaseDeclareeCycleVie(…)
  groupes = null,          // meta.chrono_groupes (règle de clôture Travaux)
  controles = null,        // lignes controles_groupe du chantier
} = {}) {
  const c = ctx || { etatsEtapes: etatsEtapes || {}, chiffrage, groupes, controles };
  const autoReasons = [];
  let detected = 1;
  const bump = (ordre, raison) => {
    if (ordre > detected) detected = ordre;
    if (raison && ordre === detected) autoReasons.push(raison);
  };

  CYCLE_VIE_PHASES.forEach(ph => {
    if (ph.dynamique || !ph.etapes.length) return;
    const faits = ph.etapes.filter(e => evaluerEtape(e, c).fait).length;
    if (faits > 0) bump(ph.ordre, `Étape validée dans « ${ph.nom} »`);
    if (faits === ph.etapes.length) {
      const next = CYCLE_VIE_PHASES.find(p => p.ordre === ph.ordre + 1);
      if (next) bump(next.ordre, `Phase « ${ph.nom} » complète`);
    }
  });
  if ((c.etatsEtapes || {}).devis_signe?.fait) bump(2, "Devis signé");
  if (statutChantier === "en_cours" || statutChantier === "en_pause") bump(4, "Chantier en cours (statut)");
  if (statutChantier === "termine") bump(5, "Chantier marqué Terminé");
  const av = parseFloat(avancement);
  if (Number.isFinite(av) && av > 0) bump(4, `Travaux avancés à ${Math.round(av)} %`);
  if (Number.isFinite(av) && av >= 100) bump(5, "Travaux à 100 %");

  // Règle de clôture : tant que TOUS les groupes ne sont pas contrôlés, la
  // DÉDUCTION ne dépasse pas Travaux. La phase déclarée reste prioritaire.
  const groupesList = Array.isArray(c.groupes) ? c.groupes.filter(g => g && g.id) : [];
  if (groupesList.length > 0 && detected > 4 && !phaseTravauxTerminee(groupesList, c.controles)) {
    const nbControles = groupesList.filter(g => controleGroupe(g.id, c.controles).controle).length;
    detected = 4;
    autoReasons.push(`Phase Travaux non clôturable : ${nbControles}/${groupesList.length} groupe(s) contrôlé(s)`);
  }

  detected = Math.max(1, Math.min(CYCLE_VIE_PHASES.length, detected));
  const declared = phaseDeclaree ? getPhase(phaseDeclaree.phaseId) : null;
  const declaredOrdre = declared ? declared.ordre : 0;
  const ordre = declaredOrdre || detected;
  const phase = CYCLE_VIE_PHASES[ordre - 1];
  const detectedPhase = CYCLE_VIE_PHASES[detected - 1];
  const detectedAhead = declaredOrdre > 0 && detected > declaredOrdre;

  const reasons = [
    declared ? `Phase déclarée à la main : ${phase.nom}` : `Phase déduite : ${phase.nom}`,
    ...autoReasons.slice(-2),
  ];

  return {
    phaseId: phase.id, phase, ordre,
    declaredPhaseId: declared ? declared.id : null,
    declaredPar: phaseDeclaree?.auteur || "",
    declaredLe: phaseDeclaree?.date || "",
    detectedPhaseId: detectedPhase.id, detectedPhase, detectedOrdre: detected,
    verrouManuel: !!declared, detectedAhead,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSUMÉ D'UN CHANTIER ET SYNTHÈSE D'OPÉRATION (lecture seule).
// Uniquement à partir des étapes ENREGISTRÉES (table + reprise) et du partage
// de l'autorisation : aucune requête, aucun signal financier. Réutilisable par
// une mini-frise (lot 5) : `jalons` donne, dans l'ordre, chaque jalon et son état.
// ─────────────────────────────────────────────────────────────────────────────
export const JALONS_SYNTHESE = Object.freeze([
  Object.freeze({ id: "devis_envoye", libelle: "devis envoyés", court: "Envoyé" }),
  Object.freeze({ id: "devis_signe", libelle: "devis signés", court: "Signé" }),
  Object.freeze({ id: "autorisation_recue", libelle: "autorisations reçues", court: "Autorisation" }),
  Object.freeze({ id: "preparation_finalisee", libelle: "préparations finalisées", court: "Préparé" }),
  Object.freeze({ id: "reception_pv", libelle: "réceptionnés", court: "Réceptionné" }),
]);

/**
 * etats       : etatsCycleVie(…).etats du chantier
 * autorisation: autorisationPartagee(…) pour ce chantier (facultatif)
 * → { jalons: [{ id, court, fait, date }], dernier: jalon | null }
 */
export function resumeCycleVieChantier({ etats = {}, autorisation = null } = {}) {
  const jalons = JALONS_SYNTHESE.map(j => {
    if (j.id === "autorisation_recue" && autorisation) {
      return { id: j.id, court: j.court, fait: !!autorisation.fait, date: autorisation.via?.date || etats[j.id]?.date || null, via: autorisation.via || null };
    }
    const e = etats[j.id];
    return { id: j.id, court: j.court, fait: !!e?.fait, date: e?.donnees?.date || e?.date || null };
  });
  const faits = jalons.filter(j => j.fait);
  return { jalons, dernier: faits.length ? faits[faits.length - 1] : null };
}

/**
 * Synthèse d'une opération : « 3/5 devis signés », « 2/5 réceptionnés »…
 * chantiers : [{ id, nom, perdu, resume: resumeCycleVieChantier(…) }]
 * Les chantiers PERDUS sont exclus du dénominateur (et comptés à part).
 * → { total, perdus, lignes: [{ id, libelle, faits, total, texte }] }
 */
export function syntheseCycleVieOperation(chantiers = []) {
  const liste = (Array.isArray(chantiers) ? chantiers : []).filter(Boolean);
  const vivants = liste.filter(c => !c.perdu);
  const total = vivants.length;
  const lignes = JALONS_SYNTHESE.map(j => {
    const faits = vivants.filter(c => (c.resume?.jalons || []).some(x => x.id === j.id && x.fait)).length;
    return { id: j.id, libelle: j.libelle, faits, total, texte: `${faits}/${total} ${j.libelle}` };
  });
  return { total, perdus: liste.length - total, lignes };
}
