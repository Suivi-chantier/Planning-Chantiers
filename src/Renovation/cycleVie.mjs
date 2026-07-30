// ─────────────────────────────────────────────────────────────────────────────
// CYCLE DE VIE du chantier (Point 2a) — référentiel des 6 phases, du devis au
// SAV, et helpers purs. AUCUN affichage ici : la frise (Prompt 5) et la
// validation des étapes (Prompt 6) consomment ce module.
//
// ⚠️ VOCABULAIRE — à ne JAMAIS confondre :
//  - Les « phases » du cycle de vie (ce fichier, ids préfixés cv_) sont au
//    niveau PROJET : Devis → Contrat → Préparation → Travaux → Réception →
//    Garanties. Elles n'utilisent PAS le mécanisme du Phasage V1
//    (plan_travaux[phase_id]), qui reste intouchable.
//  - Les « groupes » (meta.chrono_groupes) sont les étapes d'exécution des
//    travaux, contenues dans la phase cv_travaux (une entrée par groupe).
//
// Trois natures de validation par étape :
//  - "auto"     : déduite d'une donnée déjà présente ou d'une date calculée
//                 (champ `signal` = identifiant machine du critère, champ
//                 `dependDe` = étape dont la donnée sert de référence).
//                 Jamais modifiable à la main, mais toujours explicable.
//  - "document" : validée par l'import d'un fichier (devis PDF, PV…).
//  - "coche"    : validée manuellement, avec d'éventuels champs à saisir
//                 (`champs`) ; `journal: true` = entrées multiples (SAV).
// Le champ `hint` est l'indice de déduction/validation en clair (l'équivalent
// des hints de CRM_CLIENT_TIMELINE_STEPS) : affiché tel quel dans l'UI.
//
// RÈGLE TRANSVERSE : toute étape, quelle que soit sa nature, peut porter une
// ou plusieurs pièces jointes en preuve (photo ou document).
//
// Extension .mjs = parsable ESM par Node sans build (tests, crons) ; le front
// importe la façade src/Renovation/cycleVie.js.
// ─────────────────────────────────────────────────────────────────────────────

import { dernierControleGroupe } from "./controles.mjs";

export const CV_NATURES = ["auto", "document", "coche"];

export const CYCLE_VIE_PHASES = [
  {
    id: "cv_devis", ordre: 1, nom: "Devis", couleur: "#5b9cf6",
    etapes: [
      { id: "metres", nom: "Métrés", nature: "coche",
        hint: "Coche manuelle une fois les métrés relevés sur site (joindre le relevé en preuve si besoin)." },
      { id: "chiffrage_realise", nom: "Chiffrage réalisé", nature: "auto",
        signal: "chiffrage_existant",
        hint: "Validé automatiquement dès que le chantier a un phasage chiffré (ouvrages avec heures ou prix)." },
      { id: "devis_envoye", nom: "Devis envoyé", nature: "document",
        hint: "Se valide en important le devis PDF envoyé au client." },
      { id: "reponse_client", nom: "Réponse client", nature: "coche",
        champs: [{ id: "reponse", nom: "Réponse", type: "choix", options: ["accepte", "en_attente", "refuse"] }],
        hint: "Coche manuelle : accepté / en attente / refusé." },
    ],
  },
  {
    id: "cv_contrat", ordre: 2, nom: "Contrat", couleur: "#a78bfa",
    etapes: [
      { id: "devis_signe", nom: "Devis signé", nature: "document",
        champs: [{ id: "date", nom: "Date de signature", type: "date" }],
        hint: "Se valide en important le devis signé. La date saisie à l'import sert de date de signature." },
      { id: "acompte_encaisse", nom: "Acompte encaissé", nature: "coche",
        champs: [{ id: "montant", nom: "Montant (€)", type: "nombre" }, { id: "date", nom: "Date d'encaissement", type: "date" }],
        hint: "Coche manuelle, avec montant et date d'encaissement." },
      { id: "retractation_purgee", nom: "Délai de rétractation purgé", nature: "auto",
        signal: "signature_plus_14j", dependDe: "devis_signe",
        hint: "Validé automatiquement 14 jours après la date de signature (étape « Devis signé »)." },
    ],
  },
  {
    id: "cv_preparation", ordre: 3, nom: "Préparation", couleur: "#f5a623",
    etapes: [
      { id: "plans_execution", nom: "Plans d'exécution", nature: "document",
        hint: "Joindre les plans d'exécution (ou le document exporté du module Plans)." },
      { id: "commandes_appros", nom: "Commandes & approvisionnements", nature: "coche",
        hint: "Coche manuelle quand les commandes clés sont passées (voir les commandes du chantier)." },
      { id: "equipes_affectees", nom: "Équipes affectées", nature: "auto",
        signal: "equipes_sur_groupes",
        hint: "Validé automatiquement quand chaque groupe d'exécution a ses ouvriers affectés ou est marqué externe (Point 1)." },
      { id: "installation_chantier", nom: "Installation de chantier", nature: "coche",
        hint: "Coche manuelle une fois le chantier installé." },
    ],
  },
  {
    // Phase DYNAMIQUE : pas d'étapes statiques — une entrée par groupe du
    // chantier, générée par etapesTravauxDepuisGroupes(). Chaque groupe sera
    // clôturé par son jalon de contrôle (Point 2 b) ; la phase ne se termine
    // que quand TOUS les groupes sont contrôlés.
    id: "cv_travaux", ordre: 4, nom: "Travaux", couleur: "#FFC300", dynamique: true,
    etapes: [],
    hint: "Une entrée par groupe d'exécution (meta.chrono_groupes), dans leur ordre, chacune clôturée par son jalon de contrôle (Point 2 b).",
  },
  {
    id: "cv_reception", ordre: 5, nom: "Réception", couleur: "#22c55e",
    etapes: [
      { id: "visite_reception", nom: "Visite de réception", nature: "document",
        champs: [{ id: "date", nom: "Date de réception", type: "date" }],
        hint: "Se valide en important le PV de réception. La date saisie à l'import sert de date de réception." },
      { id: "levee_reserves", nom: "Levée des réserves", nature: "coche",
        hint: "Coche manuelle une fois toutes les réserves de réception levées." },
      { id: "remise_cles_doe", nom: "Remise des clés & DOE", nature: "document",
        hint: "Joindre le DOE et/ou l'attestation de remise des clés." },
    ],
  },
  {
    id: "cv_garanties", ordre: 6, nom: "Garanties / SAV", couleur: "#94a3b8",
    etapes: [
      { id: "parfait_achevement", nom: "Parfait achèvement (1 an)", nature: "auto",
        signal: "reception_plus_1an", dependDe: "visite_reception",
        hint: "Validé automatiquement 1 an après la date de réception (étape « Visite de réception »)." },
      { id: "interventions_sav", nom: "Interventions SAV", nature: "coche", journal: true,
        hint: "Journal des interventions SAV : entrées multiples, l'étape ne se « termine » pas." },
      { id: "fin_garantie", nom: "Fin de garantie", nature: "coche",
        champs: [{ id: "date", nom: "Date de fin de garantie", type: "date" }],
        hint: "Repère de date : saisir la date de fin des garanties." },
    ],
  },
];

// ── Index et helpers de navigation (purs) ────────────────────────────────────

// Toutes les étapes STATIQUES à plat, chacune enrichie de son phaseId.
// La phase cv_travaux (dynamique) n'y contribue rien : ses entrées dépendent
// du chantier, voir etapesTravauxDepuisGroupes().
export const CYCLE_VIE_ETAPES = CYCLE_VIE_PHASES.flatMap(
  ph => ph.etapes.map(e => ({ ...e, phaseId: ph.id }))
);

export const getPhase = (phaseId) => CYCLE_VIE_PHASES.find(p => p.id === phaseId) || null;
export const getEtape = (etapeId) => CYCLE_VIE_ETAPES.find(e => e.id === etapeId) || null;
export const phaseDeEtape = (etapeId) => {
  const e = getEtape(etapeId);
  return e ? getPhase(e.phaseId) : null;
};

// Étape statique suivante, toutes phases confondues (la phase Travaux,
// dynamique, est « sautée » : installation_chantier → visite_reception).
// null si l'étape est inconnue ou la dernière.
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

// ── Factures de situation (phase Travaux) ───────────────────────────────────
// Jalons de facturation intermédiaire indexés sur l'AVANCEMENT du chantier :
// à chaque seuil franchi, la facture de situation correspondante devient
// « à émettre » (prete: true) — signalée, jamais bloquante. Étapes de nature
// "coche" : validées à l'émission (montant + date), la facture peut être
// jointe en preuve et envoyée par email depuis la frise comme toute pièce.
// L'état vit dans meta.cycle_vie_etapes sous les ids situation_<seuil>.
// Les seuils sont RÉGLABLES dans Admin → Taux horaires (planning_config,
// clé "situations_seuils", forme { seuils: [25, 50, …] }) ; défaut ci-dessous.
export const SEUILS_SITUATIONS = [25, 50, 75, 100];

// Nettoie une liste de seuils (nombres entiers 1-100, uniques, croissants).
export function normaliserSeuilsSituations(seuils) {
  const liste = (Array.isArray(seuils) ? seuils : [])
    .map(s => Math.round(parseFloat(s) || 0))
    .filter(s => s >= 1 && s <= 100);
  const uniques = [...new Set(liste)].sort((a, b) => a - b);
  return uniques.length ? uniques : [...SEUILS_SITUATIONS];
}

export function etapesSituationsTravaux(avancement, seuils = SEUILS_SITUATIONS) {
  const avNum = parseFloat(avancement);
  const av = Number.isFinite(avNum) ? Math.max(0, Math.min(100, avNum)) : null;
  return normaliserSeuilsSituations(seuils).map(seuil => ({
    id: `situation_${seuil}`,
    nom: `Facture de situation — ${seuil} %`,
    nature: "coche",
    phaseId: "cv_travaux",
    seuil,
    prete: av != null && av >= seuil, // seuil franchi et pas encore émise → à émettre
    champs: [
      { id: "montant", nom: "Montant (€ HT)", type: "nombre" },
      { id: "date", nom: "Date d'émission", type: "date" },
    ],
    hint: av != null && av >= seuil
      ? `Avancement ${Math.round(av)} % — facture de situation à émettre.`
      : `À émettre quand l'avancement atteint ${seuil} %${av != null ? ` (actuel : ${Math.round(av)} %)` : ""}.`,
  }));
}

// ── Stockage dans phasages.plan_travaux.meta (Prompts 5 et 6) ───────────────
// Clés réservées — PLATES au niveau meta, comme les overrides QCD :
//  - CV_META_PHASE_DECLAREE : phase déclarée à la main, PRIORITAIRE sur la
//    phase déduite (modèle frise CRM). Forme : { phaseId, auteur, date } | null.
//  - CV_META_ETAPES : état des étapes. Forme : { [etapeId]: etatEtape } avec
//    etatEtape = {
//      fait: bool, date: ISO, auteur: string,
//      donnees: { ...champs saisis (montant, date, reponse…) },
//      pieces_jointes: [{ nom, url, taille, type, date, auteur }],
//      journal: [{ date, texte, auteur }],   // étapes journal (SAV)
//    }
// ⚠️ Toute écriture passe par un saveMeta read-before-write (cf. PhasageV2) ;
// comme CV_META_ETAPES est UNE clé meta, l'écrivain doit merger l'état des
// étapes à partir du plan_travaux FRAIS relu, jamais du state local.
export const CV_META_PHASE_DECLAREE = "cycle_vie_phase_declaree";
export const CV_META_ETAPES = "cycle_vie_etapes";

// Lecture tolérante de l'état des étapes depuis meta (jamais null, jamais
// autre chose qu'un objet par étape).
export function lireEtatsEtapes(meta) {
  const brut = meta && typeof meta === "object" ? meta[CV_META_ETAPES] : null;
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return {};
  const out = {};
  for (const [etapeId, etat] of Object.entries(brut)) {
    if (etat && typeof etat === "object" && !Array.isArray(etat)) out[etapeId] = etat;
  }
  return out;
}

// Lecture tolérante de la phase déclarée à la main (null si absente/invalide).
export function lirePhaseDeclaree(meta) {
  const brut = meta && typeof meta === "object" ? meta[CV_META_PHASE_DECLAREE] : null;
  if (!brut || typeof brut !== "object" || !getPhase(brut.phaseId)) return null;
  return {
    phaseId: brut.phaseId,
    auteur: typeof brut.auteur === "string" ? brut.auteur : "",
    date: typeof brut.date === "string" ? brut.date : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉVALUATION D'UNE ÉTAPE (fait / à faire) — pur.
// Contexte fourni par l'appelant (le module ne lit ni la DB ni l'horloge) :
//  - etatsEtapes      : lireEtatsEtapes(meta)
//  - chiffrage        : bool — le chantier a un phasage chiffré
//  - equipesAffectees : bool | null — chaque groupe a ses ouvriers (null =
//                       aucun groupe défini, indéterminé)
//  - todayISO         : "YYYY-MM-DD"
// Renvoie { fait, auto, raison } — la raison est toujours affichable telle
// quelle (POURQUOI c'est validé ou non, exigence des étapes auto).
// ─────────────────────────────────────────────────────────────────────────────
const addJours = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Date de référence portée par une étape validée : donnée saisie (champ date)
// en priorité, sinon date de validation.
const dateEtape = (etats, etapeId) => {
  const e = etats?.[etapeId];
  if (!e) return null;
  const d = e.donnees?.date || e.date;
  return typeof d === "string" && d.length >= 10 ? d.slice(0, 10) : null;
};

export function evaluerEtape(etape, ctx = {}) {
  const etats = ctx.etatsEtapes || {};
  const etat = etats[etape.id];

  if (etape.nature !== "auto") {
    const fait = !!etat?.fait;
    return {
      fait, auto: false,
      raison: fait
        ? `Validée${etat.date ? ` le ${String(etat.date).slice(0, 10)}` : ""}${etat.auteur ? ` par ${etat.auteur}` : ""}.`
        : etape.hint || "",
    };
  }

  switch (etape.signal) {
    case "chiffrage_existant": {
      const fait = !!ctx.chiffrage;
      return { fait, auto: true, raison: fait ? "Phasage chiffré présent pour ce chantier." : "Aucun phasage chiffré pour ce chantier." };
    }
    case "signature_plus_14j": {
      const ref = dateEtape(etats, "devis_signe");
      if (!ref) return { fait: false, auto: true, raison: "En attente du devis signé (date de signature inconnue)." };
      const limite = addJours(ref, 14);
      const fait = !!(limite && ctx.todayISO && String(ctx.todayISO) >= limite);
      return {
        fait, auto: true,
        raison: fait ? `Signature le ${ref} → délai purgé depuis le ${limite}.` : `Signature le ${ref} → délai purgé le ${limite}.`,
      };
    }
    case "equipes_sur_groupes": {
      if (ctx.equipesAffectees == null) return { fait: false, auto: true, raison: "Aucun groupe d'exécution défini (vue chrono du phasage)." };
      return {
        fait: !!ctx.equipesAffectees, auto: true,
        raison: ctx.equipesAffectees
          ? "Chaque groupe a ses ouvriers affectés (ou est marqué externe)."
          : "Des groupes n'ont pas encore d'ouvriers affectés.",
      };
    }
    case "reception_plus_1an": {
      const ref = dateEtape(etats, "visite_reception");
      if (!ref) return { fait: false, auto: true, raison: "En attente du PV de réception (date de réception inconnue)." };
      const limite = addJours(ref, 365);
      const fait = !!(limite && ctx.todayISO && String(ctx.todayISO) >= limite);
      return {
        fait, auto: true,
        raison: fait ? `Réception le ${ref} → parfait achèvement échu le ${limite}.` : `Réception le ${ref} → parfait achèvement jusqu'au ${limite}.`,
      };
    }
    case "groupe_controle": {
      // Témoin « contrôlé / non contrôlé » : source unique controleGroupe.
      // Les contrôles réels sont passés via ctx.controles (table
      // controles_groupe) ; l'avancement vient de l'entrée (statsGroupeChrono).
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
// POSITIONNEMENT DANS LE CYCLE — même mécanique que computeCRMClientTimeline
// (src/Invest/CRM.jsx) : la phase DÉDUITE est un maximum monotone (elle ne
// recule jamais toute seule), chaque signal empile une raison ; la phase
// DÉCLARÉE à la main est PRIORITAIRE (une rétrogradation manuelle tient, même
// si les signaux disent plus avancé — on l'affiche alors à côté).
// ─────────────────────────────────────────────────────────────────────────────
export function computeCycleVie({
  statutChantier = null,   // "planifie" | "en_cours" | "en_pause" | "termine"
  avancement = null,       // entier 0-100 (convention de l'appli)
  chiffrage = false,
  etatsEtapes = {},
  phaseDeclaree = null,    // lirePhaseDeclaree(meta)
  equipesAffectees = null,
  groupes = null,          // meta.chrono_groupes (règle de clôture Travaux)
  controles = null,        // lignes controles_groupe du chantier (témoins)
  todayISO = "",
} = {}) {
  const ctx = { etatsEtapes: etatsEtapes || {}, chiffrage, equipesAffectees, controles, todayISO };
  const autoReasons = [];
  let detected = 1;
  // Fait avancer la détection (jamais reculer). La raison est retenue si le
  // signal fait avancer OU corrobore le niveau atteint (plus parlant que le
  // strict « seulement si ça avance » du CRM : deux signaux au même niveau
  // valent mieux qu'un pour expliquer la position).
  const bump = (ordre, raison) => {
    if (ordre > detected) detected = ordre;
    if (raison && ordre === detected) autoReasons.push(raison);
  };

  // Étapes validées : une étape faite place le chantier au moins dans sa
  // phase ; une phase statique complète le place au moins dans la suivante.
  CYCLE_VIE_PHASES.forEach(ph => {
    if (ph.dynamique || !ph.etapes.length) return;
    const faits = ph.etapes.filter(e => evaluerEtape(e, ctx).fait).length;
    if (faits > 0) bump(ph.ordre, `Étape validée dans « ${ph.nom} »`);
    if (faits === ph.etapes.length) {
      const next = CYCLE_VIE_PHASES.find(p => p.ordre === ph.ordre + 1);
      if (next) bump(next.ordre, `Phase « ${ph.nom} » complète`);
    }
  });
  // Devis accepté → au moins Contrat.
  if ((etatsEtapes || {}).reponse_client?.donnees?.reponse === "accepte") bump(2, "Devis accepté par le client");
  // Statut du chantier (planning) et avancement des travaux.
  if (statutChantier === "en_cours" || statutChantier === "en_pause") bump(4, "Chantier en cours (statut)");
  if (statutChantier === "termine") bump(5, "Chantier marqué Terminé");
  const av = parseFloat(avancement);
  if (Number.isFinite(av) && av > 0) bump(4, `Travaux avancés à ${Math.round(av)} %`);
  if (Number.isFinite(av) && av >= 100) bump(5, "Travaux à 100 %");

  // Règle de clôture (Prompt 7) : tant que TOUS les groupes ne sont pas
  // contrôlés (témoin Point 2 b), la DÉDUCTION ne dépasse pas Travaux — même
  // à 100 % d'avancement ou statut Terminé. La phase déclarée à la main,
  // elle, reste prioritaire et peut passer outre (jugement du conducteur).
  const groupesList = Array.isArray(groupes) ? groupes.filter(g => g && g.id) : [];
  if (groupesList.length > 0 && detected > 4 && !phaseTravauxTerminee(groupesList, controles)) {
    const nbControles = groupesList.filter(g => controleGroupe(g.id, controles).controle).length;
    detected = 4;
    autoReasons.push(`Phase Travaux non clôturable : ${nbControles}/${groupesList.length} groupe(s) contrôlé(s)`);
  }

  detected = Math.max(1, Math.min(CYCLE_VIE_PHASES.length, detected));
  const declared = phaseDeclaree ? getPhase(phaseDeclaree.phaseId) : null;
  const declaredOrdre = declared ? declared.ordre : 0;

  // Arbitrage : le déclaré gagne toujours s'il existe (règle CRM V20.3).
  const ordre = declaredOrdre || detected;
  const phase = CYCLE_VIE_PHASES[ordre - 1];
  const detectedPhase = CYCLE_VIE_PHASES[detected - 1];
  const detectedAhead = declaredOrdre > 0 && detected > declaredOrdre;

  const reasons = [
    declared ? `Phase déclarée à la main : ${phase.nom}` : `Phase déduite : ${phase.nom}`,
    ...autoReasons.slice(-2), // les derniers bumps justifient la position finale
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
