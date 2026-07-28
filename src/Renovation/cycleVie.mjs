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

export const CV_NATURES = ["auto", "document", "coche"];

export const CYCLE_VIE_PHASES = [
  {
    id: "cv_devis", ordre: 1, nom: "Devis", couleur: "#5b9cf6",
    etapes: [
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

// ── Phase Travaux : entrées dérivées des groupes du chantier ────────────────
// chronoGroupes = phasage.plan_travaux.meta.chrono_groupes ({ id, nom,
// couleur, ordre, groupe_type_id? }). Une entrée par groupe, dans leur ordre,
// de nature "auto" (le témoin « contrôlé » sera fourni par le Point 2 b).
export function etapesTravauxDepuisGroupes(chronoGroupes) {
  const groupes = Array.isArray(chronoGroupes) ? chronoGroupes.filter(g => g && g.id) : [];
  return groupes
    .slice()
    .sort((a, b) => {
      const oa = Number.isFinite(parseFloat(a.ordre)) ? parseFloat(a.ordre) : 1e9;
      const ob = Number.isFinite(parseFloat(b.ordre)) ? parseFloat(b.ordre) : 1e9;
      return oa - ob;
    })
    .map(g => ({
      id: `groupe_${g.id}`,
      nom: g.nom || "Groupe",
      nature: "auto",
      signal: "groupe_controle",
      phaseId: "cv_travaux",
      groupeId: g.id,
      couleur: g.couleur || null,
      hint: "Groupe d'exécution : terminé quand ses tâches sont à 100 %, validé quand son jalon de contrôle est réalisé (Point 2 b).",
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
