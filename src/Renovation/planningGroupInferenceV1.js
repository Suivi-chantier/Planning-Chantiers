// ─── INFÉRENCE GROUPES D'EXÉCUTION V1 ───────────────────────────────────────
// Affectation EXPLICABLE des sous-tâches Ouvrages_V2 vers les 13 groupes
// Profero. Aucune IA, aucune écriture Supabase : uniquement des règles métier
// versionnées. Le script de migration décide ensuite quelles confiances écrire.
//
// Priorités :
//   1. anomalie / exception connue ;
//   2. règle précise code + tâche ;
//   3. règle métier par libellé / lot ;
//   4. aucun résultat => revue humaine.
//
// `certain`  : peut être écrit automatiquement ;
// `probable` : proposition à relire, jamais écrite automatiquement en V1 ;
// `review`   : volontairement non classé.

export const GROUPES_EXECUTION_V1 = Object.freeze({
  DEMOLITION: "gt_demolition",
  MACONNERIE: "gt_1785154120513",
  MENUISERIE_EXT: "gt_menuiserie_ext",
  COUVERTURE: "gt_couverture_ext",
  RESEAU_PLOMBERIE: "gt_reseau_plomberie",
  OSSATURE_MENUISERIE_INT: "gt_ossature_placo",
  RESEAU_ELEC: "gt_reseau_elec",
  LAINE_PLACO_ENDUIT: "gt_laine_placo",
  PEINTURE: "gt_peinture",
  SOLS: "gt_sols",
  APPAREILLAGE_ELEC: "gt_appareillage_elec",
  APPAREILLAGE_PLOMBERIE: "gt_appareillage_plomberie",
  FINITION_GENERALE: "gt_finition_generale",
});

export const CONFIANCE_GROUPE_V1 = Object.freeze({
  CERTAIN: "certain",
  PROBABLE: "probable",
  REVIEW: "review",
  MANUAL: "manual",
});

const norm = (s) => String(s ?? "")
  .toLowerCase()
  .normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .replace(/[’']/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const has = (s, ...parts) => parts.some(p => s.includes(norm(p)));
const begins = (s, ...parts) => parts.some(p => s.startsWith(norm(p)));

function result(groupe_type_id, confiance, regle, raison) {
  return { groupe_type_id, confiance, regle, raison };
}
function review(regle, raison) {
  return result(null, CONFIANCE_GROUPE_V1.REVIEW, regle, raison);
}

export function prefixeCodeOuvrage(code) {
  const m = String(code ?? "").trim().toUpperCase().match(/^([A-Z]{1,3})-/);
  return m?.[1] || null;
}

// `position` est 1-based, comme l'affichage Bibliothèque et les rapports.
export function infererGroupeExecutionV1({ code, nom, lotId, position = null } = {}) {
  const G = GROUPES_EXECUTION_V1;
  const C = CONFIANCE_GROUPE_V1;
  const c = String(code ?? "").trim().toUpperCase();
  const pfx = prefixeCodeOuvrage(c);
  const n = norm(nom);
  const lot = norm(lotId);
  const pos = Number(position) || null;

  if (!n) return review("task-empty", "Sous-tâche sans libellé : classification impossible.");

  // ── Anomalies connues ────────────────────────────────────────────────────
  if (c === "D-003.1" && pos === 2) {
    return review(
      "known-anomaly-d003-1",
      "D-003.1 parle d'une gaine VMC mais cette sous-tâche est un raccordement d'évacuation hérité d'une copie : corriger l'ouvrage avant classement."
    );
  }
  if (c === "MU-006") {
    return review("known-anomaly-mu006", "MU-006 contient actuellement une sous-tâche vide/incomplète et doit être corrigé avant planification.");
  }

  // ── Démolition / préparation ─────────────────────────────────────────────
  if (pfx === "D") {
    if (c === "D-003" && pos === 2) {
      return result(G.RESEAU_PLOMBERIE, C.CERTAIN, "d003-network-connection", "Le raccordement de l'évacuation générale appartient au réseau plomberie.");
    }
    if (c === "D-003.1" && pos === 1) {
      return result(G.DEMOLITION, C.CERTAIN, "d003-1-core-drill", "Le carottage préparatoire reste une opération de démolition/préparation.");
    }
    return result(G.DEMOLITION, C.CERTAIN, "demolition-code", "Les ouvrages codés D sont des opérations de démolition/préparation, sauf exception explicitement versionnée.");
  }

  // ── Sols ─────────────────────────────────────────────────────────────────
  if (pfx === "S") {
    return result(G.SOLS, C.CERTAIN, "floor-code", "Les sous-tâches des ouvrages S appartiennent au groupe Sols.");
  }

  // ── Maçonnerie ───────────────────────────────────────────────────────────
  if (pfx === "MA" || lot === "maconnerie") {
    return result(G.MACONNERIE, C.CERTAIN, "masonry-code-or-lot", "Ouvrage/tâche rattaché au lot Maçonnerie.");
  }

  // ── Plafonds / placo ─────────────────────────────────────────────────────
  if (pfx === "PL") {
    if (has(n, "ossature", "fourrure", "rail", "montant")) {
      return result(G.OSSATURE_MENUISERIE_INT, C.CERTAIN, "ceiling-frame", "L'ossature du faux plafond appartient à la phase ossatures.");
    }
    return result(G.LAINE_PLACO_ENDUIT, C.CERTAIN, "ceiling-closure-finish", "Plaquage, bandes et passes de faux plafond appartiennent à Laine / Placo / Enduit.");
  }

  // ── Murs / cloisons / peinture ───────────────────────────────────────────
  if (pfx === "MU" || lot === "murs cloison") {
    if (has(n, "peinture", "poncage avant peinture", "protection complete avant peinture", "couche d impression", "debachage")) {
      return result(G.PEINTURE, C.CERTAIN, "paint-operation", "Cette tâche fait partie de la séquence peinture, même si l'ouvrage commercial est codé MU.");
    }
    if (c === "MU-021" && has(n, "passe d enduit de finition")) {
      return result(G.PEINTURE, C.CERTAIN, "mu021-paint-prep", "Dans MU-021, la reprise/enduit de finition est une préparation de la prestation peinture.");
    }
    if (has(n, "ossature", "rail", "montant")) {
      return result(G.OSSATURE_MENUISERIE_INT, C.CERTAIN, "placo-frame", "Ossature métallique avant fermeture des cloisons/doublages.");
    }
    if (has(n, "isolation", "laine", "plaquage", "ba13", "bande", "1ere passe", "2eme passe", "passe de finition", "placo colle", "encollage", "map", "collage des plaques")) {
      return result(G.LAINE_PLACO_ENDUIT, C.CERTAIN, "placo-insulation-finish", "Isolation, plaques, bandes et enduits appartiennent à Laine / Placo / Enduit.");
    }
    return review("mu-unmatched", "Tâche murs/cloisons non reconnue par une règle suffisamment précise.");
  }

  // ── Menuiseries ──────────────────────────────────────────────────────────
  if (pfx === "ME" || lot === "menuiserie") {
    // Bloc-porte coupe-feu : usage historique partagé. On propose sans écrire.
    if (c === "ME-001") {
      if (has(n, "serrure", "poignee", "accessoire")) {
        return result(G.FINITION_GENERALE, C.PROBABLE, "me001-hardware", "Les accessoires finaux du bloc-porte coupe-feu sont proposés en Finition générale ; cas à valider.");
      }
      return result(G.MENUISERIE_EXT, C.PROBABLE, "me001-fire-door", "Le bloc-porte coupe-feu a majoritairement été traité en menuiserie extérieure, mais l'usage historique est partagé.");
    }

    // Portes intérieures codées ME-002/003/003.2.
    if (["ME-002", "ME-003", "ME-003.2"].includes(c)) {
      if (has(n, "serrure", "poignee", "accessoire")) {
        return result(G.FINITION_GENERALE, C.CERTAIN, "interior-door-hardware", "Serrure, poignée et accessoires sont une finition finale de porte intérieure.");
      }
      return result(G.OSSATURE_MENUISERIE_INT, C.CERTAIN, "interior-door-block", "Mise en place, réglage et finition de pose du bloc-porte intérieur dans la phase ossatures/menuiseries intérieures.");
    }

    // Fenêtres, baies et portes-fenêtres V2.
    if (has(n, "fenetre", "baie vitree", "porte fenetre", "bande resiliente", "mousse pu", "ouvrant")) {
      return result(G.MENUISERIE_EXT, C.CERTAIN, "external-joinery-task", "Pose, étanchéité et réglages d'une menuiserie extérieure.");
    }
    return result(G.OSSATURE_MENUISERIE_INT, C.PROBABLE, "joinery-default", "Tâche de menuiserie non identifiée comme extérieure : proposition menuiserie intérieure à valider.");
  }

  // ── Électricité ──────────────────────────────────────────────────────────
  if (["E", "EG"].includes(pfx) || (lot === "electricite" && !["P", "PC"].includes(pfx))) {
    // VMC : séparation volontaire rough-in / fit-off.
    if (c === "E-021") {
      if (has(n, "pose de la vmc", "passage des gaines", "passages des gaines", "fixation")) {
        return result(G.RESEAU_ELEC, C.CERTAIN, "vmc-rough", "Caisson/fixation et gaines VMC font partie du passage de réseau.");
      }
      if (has(n, "raccordement electrique", "pose des bouches", "bouche vmc")) {
        return result(G.APPAREILLAGE_ELEC, C.CERTAIN, "vmc-fitoff", "Raccordement final et bouches VMC sont classés en appareillage électrique.");
      }
    }

    // E-006/E-007 : exemple métier verrouillé.
    if (["E-006", "E-007"].includes(c)) {
      if (has(n, "passage alimentation")) {
        return result(G.RESEAU_ELEC, C.CERTAIN, "lighting-feed", "Le passage d'alimentation du point lumineux appartient au réseau électrique.");
      }
      if (has(n, "pose et raccordement")) {
        return result(G.APPAREILLAGE_ELEC, C.CERTAIN, "lighting-fitoff", "La pose/raccordement du luminaire est une intervention d'appareillage final.");
      }
    }

    // Infrastructure / rough-in : règle métier prioritaire sur l'historique.
    if (has(n,
      "reperage", "plans elec", "passage des cables", "passages de cables", "passage cable",
      "gaine", "saignee", "gtl", "pose du tableau", "pose tableau", "piquet de terre",
      "mise a la terre", "goulotte", "depose de l ancienne installation", "depose de l ancien appareillage"
    )) {
      return result(G.RESEAU_ELEC, C.CERTAIN, "electrical-rough", "Repérage, câbles/gaines, terre, GTL et tableau font partie du passage réseau électrique.");
    }

    // Boîtes d'encastrement : décision V1 issue du fonctionnement actuel.
    if (has(n, "boite d encastrement", "boites d encastrement")) {
      return result(G.APPAREILLAGE_ELEC, C.CERTAIN, "flush-boxes-v1", "En V1 Profero, les boîtes d'encastrement sont conservées dans Appareillage élec.");
    }

    if (has(n, "appareillage", "radiateur", "seche serviette", "mise en service", "essai", "plafonnier", "applique", "luminaire")) {
      return result(G.APPAREILLAGE_ELEC, C.CERTAIN, "electrical-fitoff", "Équipement final, chauffage électrique ou mise en service finale.");
    }

    // Disjoncteur 500 mA / bloc de commande : infrastructure électrique, mais
    // séquence précise encore à confirmer dans le fonctionnement Profero.
    if (c === "E-008") {
      return result(G.RESEAU_ELEC, C.PROBABLE, "e008-main-breaker", "Disjoncteur général et bloc de commande proposés en réseau électrique ; à valider avant écriture automatique.");
    }
    return review("electrical-unmatched", "Tâche électrique non reconnue par une règle suffisamment précise.");
  }

  // ── Plomberie / sanitaire / cuisine ──────────────────────────────────────
  if (["P", "PC"].includes(pfx) || lot === "plomberie") {
    // Exceptions de réseaux généraux.
    if (c === "P-032") {
      return result(G.RESEAU_PLOMBERIE, C.CERTAIN, "general-drain", "Pose/raccordement de l'évacuation générale : réseau plomberie.");
    }
    if (c === "P-031") {
      return result(G.RESEAU_PLOMBERIE, C.CERTAIN, "water-meter", "Compteur divisionnaire et raccordement sur eau froide générale : réseau plomberie.");
    }
    if (["P-001", "P-800"].includes(c) && has(n, "raccordement electrique", "groupe secu")) {
      return result(G.APPAREILLAGE_PLOMBERIE, C.CERTAIN, "water-heater-final-connection", "Le raccordement électrique + groupe de sécurité reste dans la séquence d'appareillage du chauffe-eau.");
    }

    if (begins(n, "passage alimentation", "passages alimentation", "passages alimentations", "passage evacuation", "passages evacuation")
        || has(n, "nourrice", "controle essais reseaux avant fermeture", "controle reseaux avant fermeture")) {
      return result(G.RESEAU_PLOMBERIE, C.CERTAIN, "plumbing-rough", "Alimentations, évacuations, nourrices et contrôle avant fermeture appartiennent au réseau plomberie.");
    }

    // Cuisine : le macro-groupe reste volontairement Appareillage plomberie.
    if (pfx === "PC" || has(n, "cuisine", "evier", "plaque", "four", "hotte")) {
      return result(G.APPAREILLAGE_PLOMBERIE, C.CERTAIN, "kitchen-fitoff", "Chez Profero, montage/équipements/finitions cuisine restent dans Appareillage plomberie.");
    }

    if (has(n,
      "receveur", "wc", "vasque", "mitigeur", "dumawall", "etancheite", "colonne de douche",
      "paroi de douche", "paroie de douche", "silicone", "chauffe eau", "mise en eau",
      "essais finaux", "raccordement alimentation", "raccordement evacuation", "pose meuble"
    )) {
      return result(G.APPAREILLAGE_PLOMBERIE, C.CERTAIN, "plumbing-fitoff", "Pose/raccordement final d'un équipement sanitaire, salle de bain ou chauffe-eau.");
    }

    return review("plumbing-unmatched", "Tâche plomberie non reconnue par une règle suffisamment précise.");
  }

  // ── Fallback lot finitions ───────────────────────────────────────────────
  if (lot === "finitions gen" || lot === "finitions_gen") {
    return result(G.FINITION_GENERALE, C.PROBABLE, "finishing-lot", "Lot Finitions générales sans règle plus spécifique : proposition Finition générale.");
  }

  return review("no-rule", "Aucune règle V1 ne permet de classer cette sous-tâche avec suffisamment de confiance.");
}
