// ─── TEMPLATE CHRONOLOGIQUE GLOBALE ──────────────────────────────────────────
// Ordre des corps d'état de l'entreprise, commun à tous les chantiers. Sert à
// PRÉ-GÉNÉRER la vue Chronologique d'un phasage 100 % vierge (aucun groupe,
// aucune tâche affectée) et à trier le bloc « Non planifiées » du Gantt.
// C'est une initialisation, PAS une synchro : une fois les groupes instanciés,
// l'utilisateur reste maître, rien n'est réappliqué automatiquement.
//
// `ordre` avance de 10 en 10 pour pouvoir intercaler un corps d'état sans
// renuméroter. `motsCles` : fragments normalisés (minuscules, sans accents)
// cherchés dans le label du lot — première correspondance (par ordre
// croissant) gagne. Les groupes sans mots-clés (appareillages) sont créés
// vides quand leur groupe « Passage réseau » reçoit des tâches : les tâches
// d'appareillage s'y déplacent ensuite à la main.

// ── Natures de jalons (Point 2 b) ────────────────────────────────────────────
// Deux natures cohabitent dans meta.chrono_jalons :
//  - "repere"   : jalon manuel historique (livraison, réception…). Un jalon
//                 SANS champ type est un repère — RÉTROCOMPATIBILITÉ STRICTE,
//                 aucune migration : les jalons existants ne sont jamais
//                 réécrits, l'absence de type vaut repère.
//  - "controle" : jalon de contrôle de fin de groupe, créé automatiquement
//                 (un par groupe, en dernière position). Non renommable, non
//                 datable, non supprimable à la main, non déplaçable — il
//                 suit son groupe. Obligatoire mais NON bloquant.
export const JALON_TYPE_REPERE = "repere";
export const JALON_TYPE_CONTROLE = "controle";
export const jalonType = (j) => (j?.type === JALON_TYPE_CONTROLE ? JALON_TYPE_CONTROLE : JALON_TYPE_REPERE);
export const estJalonControle = (j) => jalonType(j) === JALON_TYPE_CONTROLE;

// Jalon de contrôle d'un groupe : non daté (il vit dans l'ordre du groupe,
// pas dans le calendrier — le Gantt et « Prochain jalon » ne le voient pas),
// ordre très haut par convention ; l'invariant « toujours en dernier » est de
// toute façon imposé par le tri des entrées de groupe (entriesOfGroup).
export const buildJalonControle = (groupe, ridFn) => ({
  id: ridFn(),
  nom: `Contrôle — ${groupe?.nom || "Groupe"}`,
  date: null,
  groupe_id: groupe.id,
  ordre: 1e9,
  type: JALON_TYPE_CONTROLE,
});

// Complète une liste de jalons : ajoute le jalon de contrôle MANQUANT de
// chaque groupe (rattrapage / semis). N'enlève rien, ne modifie rien.
// Renvoie le nouveau tableau, ou null si rien ne manque (aucune écriture).
export function completerJalonsControle(groupes, jalons, ridFn) {
  const list = Array.isArray(jalons) ? jalons : [];
  const manquants = (Array.isArray(groupes) ? groupes : []).filter(g =>
    g && g.id && !list.some(j => (j.groupe_id ?? null) === g.id && estJalonControle(j))
  );
  if (!manquants.length) return null;
  return [...list, ...manquants.map(g => buildJalonControle(g, ridFn))];
}

export const CHRONO_TEMPLATE = [
  { ordre: 10,  nom: "Démolition",                          couleur: "#e15a5a", motsCles: ["demol", "depose", "curage"] },
  { ordre: 20,  nom: "Menuiserie extérieure / Couverture",  couleur: "#8b5cf6", motsCles: ["menuiserie ext", "fenetre", "couverture", "toiture", "velux"] },
  { ordre: 30,  nom: "Passage réseau plomberie",            couleur: "#3b82f6", motsCles: ["plomberie", "sanitaire", "evacuation"] },
  { ordre: 40,  nom: "Ossature / Menuiserie intérieure",    couleur: "#d97706", motsCles: ["ossature", "menuiserie int", "cloison", "porte"] },
  { ordre: 50,  nom: "Passage réseau élec",                 couleur: "#f5c400", motsCles: ["elec", "electricite"] },
  { ordre: 60,  nom: "Isolation / Placo / Bandes",          couleur: "#10b981", motsCles: ["isolation", "placo", "platrerie", "bande", "faux plafond"] },
  { ordre: 70,  nom: "Appareillage électrique",             couleur: "#eab308", motsCles: [] },
  { ordre: 80,  nom: "Peinture",                            couleur: "#ec4899", motsCles: ["peinture", "enduit", "revetement mural"] },
  { ordre: 90,  nom: "Sols",                                couleur: "#14b8a6", motsCles: ["sol", "carrelage", "parquet", "chape", "ragreage", "faience"] },
  { ordre: 100, nom: "Appareillage plomberie",              couleur: "#0ea5e9", motsCles: [] },
  { ordre: 110, nom: "Cuisine",                             couleur: "#f97316", motsCles: ["cuisine"] },
  { ordre: 120, nom: "Nettoyage / Levée de réserves",       couleur: "#94a3b8", motsCles: ["nettoyage", "reception", "reserve"] },
];

// Groupes créés vides (prêts à recevoir) quand leur groupe « Passage réseau »
// reçoit des tâches. Clé et valeur = `nom` dans CHRONO_TEMPLATE.
const GROUPES_COMPAGNONS = {
  "Passage réseau élec": "Appareillage électrique",
  "Passage réseau plomberie": "Appareillage plomberie",
};

// Normalisation d'un label de lot : minuscules, sans accents.
const norm = (s) => (s || "").toString().toLowerCase()
  .normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Premier groupe de la template (par ordre croissant) dont un mot-clé est
// contenu dans le label du lot. null si aucun ne matche (→ « À classer »,
// signal qu'il faut enrichir les motsCles de la template).
export function matchGroupeTemplate(lotLabel) {
  const lbl = norm(lotLabel);
  if (!lbl) return null;
  return CHRONO_TEMPLATE.find(g => g.motsCles.some(mc => lbl.includes(mc))) || null;
}

// Construit l'initialisation chrono d'un phasage vierge à partir de la
// template : les groupes à instancier (uniquement ceux qui reçoivent au moins
// une tâche + leurs groupes compagnons vides) et les affectations de tâches
// au format applyChrono ({ [tacheId]: { groupe_id, ordre } }).
// L'ordre des tâches dans un groupe = ordre des lots, puis ordre des ouvrages
// dans le lot, puis ordre des tâches dans l'ouvrage.
// `rid` : générateur d'id (celui de l'appelant). Retourne null si aucune
// tâche ne matche (rien à instancier).
export function buildChronoInit(ouvrages, lots, rid) {
  const tachesParNom = new Map();   // nom de groupe template → [tacheId] ordonnés
  (lots || []).forEach(lot => {
    const tpl = matchGroupeTemplate(lot.label);
    if (!tpl) return;
    (ouvrages || []).filter(o => o.lot_id === lot.id).forEach(o => {
      (o.taches || []).forEach(t => {
        if (!tachesParNom.has(tpl.nom)) tachesParNom.set(tpl.nom, []);
        tachesParNom.get(tpl.nom).push(t.id);
      });
    });
  });
  if (tachesParNom.size === 0) return null;

  const nomsRetenus = new Set(tachesParNom.keys());
  Object.entries(GROUPES_COMPAGNONS).forEach(([reseau, appareillage]) => {
    if (nomsRetenus.has(reseau)) nomsRetenus.add(appareillage);
  });

  const groupes = CHRONO_TEMPLATE
    .filter(g => nomsRetenus.has(g.nom))
    .map(g => ({ id: rid(), nom: g.nom, couleur: g.couleur, ordre: g.ordre }));

  const assignments = {};
  groupes.forEach(g => {
    (tachesParNom.get(g.nom) || []).forEach((tacheId, i) => {
      assignments[tacheId] = { groupe_id: g.id, ordre: i };
    });
  });
  return { groupes, assignments };
}

// ─── INITIALISATION DEPUIS LES GROUPES TYPES (référentiel Admin) ─────────────
// Version pilotée par le référentiel « groupes types » (planning_config/
// groupes_types, éditable dans l'Admin). Elle instancie TOUS les groupes types
// et affecte d'abord une tâche à son `groupe_type_id` explicite quand celui-ci
// existe (nouveaux ouvrages V2). Si ce champ est absent, on conserve le fallback
// historique : premier groupe type rattaché au lot de l'ouvrage. Ainsi les
// anciens phasages restent compatibles, tandis qu'un ouvrage V2 peut répartir
// ses sous-tâches entre Réseaux et Appareillage dès l'import.
export function buildChronoInitFromGroupesTypes(ouvrages, groupesTypes, rid) {
  const gts = [...(groupesTypes || [])].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  if (gts.length === 0) return null;
  const groupes = gts.map(gt => ({
    id: rid(), nom: gt.nom, couleur: gt.couleur, ordre: gt.ordre ?? 0, groupe_type_id: gt.id,
  }));
  const groupeParType = new Map(); // groupe_type_id → groupe concret du chantier
  gts.forEach((gt, i) => groupeParType.set(String(gt.id), groupes[i]));
  const groupeParLot = new Map(); // lot_id → premier groupe instancié (fallback historique)
  gts.forEach((gt, i) => { if (gt.lot_id && !groupeParLot.has(gt.lot_id)) groupeParLot.set(gt.lot_id, groupes[i]); });

  const compteurs = new Map();
  const assignments = {};
  (ouvrages || []).forEach(o => {
    (o.taches || []).forEach(t => {
      const explicite = t?.groupe_type_id ? groupeParType.get(String(t.groupe_type_id)) : null;
      const g = explicite || groupeParLot.get(o.lot_id);
      if (!g) return;
      const n = compteurs.get(g.id) || 0;
      assignments[t.id] = { groupe_id: g.id, ordre: n };
      compteurs.set(g.id, n + 1);
    });
  });
  return { groupes, assignments };
}

// Tri « chrono métier » d'une liste de lignes { lot, ouvrage, tache } (bloc
// « Non planifiées » du Gantt) : ordre du groupe Chrono de la tâche, puis
// chrono_ordre dans le groupe ; les tâches sans groupe en fin de liste,
// triées par lot puis ouvrage. Trie EN PLACE et retourne la liste.
export function sortByChrono(rows, groupes) {
  const ordreById = new Map((groupes || []).map(g => [g.id, g.ordre ?? 0]));
  const gOrd = (t) => ordreById.has(t.chrono_groupe_id) ? ordreById.get(t.chrono_groupe_id) : Infinity;
  rows.sort((a, b) => {
    const ga = gOrd(a.tache), gb = gOrd(b.tache);
    if (ga !== gb) return ga - gb;
    if (ga !== Infinity) return (a.tache.chrono_ordre ?? 1e9) - (b.tache.chrono_ordre ?? 1e9);
    if ((a.lot?.id || "") !== (b.lot?.id || "")) return (a.lot?.label || "").localeCompare(b.lot?.label || "");
    return (a.ouvrage.libelle || "").localeCompare(b.ouvrage.libelle || "");
  });
  return rows;
}

// ─── AFFECTATION CHRONO D'UNE TÂCHE AJOUTÉE EN COURS DE CHANTIER ────────────
// `buildChronoInitFromGroupesTypes` n'est jouée qu'AU SEMIS de la vue Chrono.
// Une tâche ajoutée après coup — typiquement remontée par un compte rendu
// d'ouvrier — naissait donc sans `chrono_groupe_id`, restait « à classer », et
// devenait invisible au moteur de planification : l'adaptateur ne pouvait plus
// résoudre son groupe métier, donc son pool HARD de ressources.
//
// Les fonctions ci-dessous rejouent EXACTEMENT la règle du semis pour une
// tâche isolée. Aucune règle métier nouvelle, aucune heuristique :
//   1. `groupe_type_id` explicite de la tâche → groupe concret correspondant ;
//   2. sinon, premier groupe concret rattaché au `lot_id` de l'ouvrage
//      (les groupes types sont parcourus par `ordre` croissant, comme au semis) ;
//   3. sinon `null` — la tâche reste « à classer ». On ne devine JAMAIS un
//      groupe : une impossibilité doit rester visible.
//
// Un groupe concret est rattaché à son groupe type par `groupe_type_id`, ou à
// défaut par homonymie de nom (même règle d'adoption que le mode « ajouter »
// de l'écran Phasage, pour les phasages hérités de `buildChronoInit`).

// Index { parType, parLot } des groupes CONCRETS du chantier.
export function indexerGroupesChronoV1(chronoGroupes, groupesTypes) {
  const groupes = Array.isArray(chronoGroupes) ? chronoGroupes : [];
  const gts = [...(groupesTypes || [])].sort((a, b) => (a?.ordre ?? 0) - (b?.ordre ?? 0));
  const parType = new Map(); // groupe_type_id → groupe concret
  const parLot = new Map();  // lot_id → premier groupe concret du lot
  for (const gt of gts) {
    const idGt = gt?.id == null ? "" : String(gt.id);
    if (!idGt) continue;
    const concret = groupes.find(g => g?.groupe_type_id != null && String(g.groupe_type_id) === idGt)
      || groupes.find(g => g?.groupe_type_id == null && norm(g?.nom).trim() === norm(gt?.nom).trim());
    if (!concret?.id) continue;
    if (!parType.has(idGt)) parType.set(idGt, concret);
    const lot = gt?.lot_id == null ? "" : String(gt.lot_id);
    if (lot && !parLot.has(lot)) parLot.set(lot, concret);
  }
  return { parType, parLot };
}

// Groupe concret visé par une tâche, ou null. Pur, sans effet de bord.
export function groupeChronoPourTacheV1(tache, ouvrage, index) {
  if (!index) return null;
  const idType = tache?.groupe_type_id == null ? "" : String(tache.groupe_type_id);
  if (idType) {
    const explicite = index.parType.get(idType);
    if (explicite) return explicite;
  }
  const lot = ouvrage?.lot_id == null ? "" : String(ouvrage.lot_id);
  if (!lot) return null;
  return index.parLot.get(lot) || null;
}

// Prochain `chrono_ordre` libre dans un groupe : la tâche ajoutée se range en
// fin de groupe, elle ne s'intercale jamais devant du travail déjà séquencé.
export function prochainOrdreChronoV1(ouvrages, groupeId) {
  if (!groupeId) return 0;
  let max = -1;
  for (const o of Array.isArray(ouvrages) ? ouvrages : []) {
    for (const t of Array.isArray(o?.taches) ? o.taches : []) {
      if (String(t?.chrono_groupe_id ?? "") !== String(groupeId)) continue;
      const n = Number(t?.chrono_ordre);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

// Affectation d'UNE tâche nouvellement créée : { chrono_groupe_id, chrono_ordre }
// à fusionner dans la tâche, ou null s'il n'y a pas de groupe déterministe.
export function affectationChronoNouvelleTacheV1({ tache, ouvrage, ouvrages, chronoGroupes, groupesTypes } = {}) {
  const index = indexerGroupesChronoV1(chronoGroupes, groupesTypes);
  const groupe = groupeChronoPourTacheV1(tache, ouvrage, index);
  if (!groupe?.id) return null;
  return { chrono_groupe_id: groupe.id, chrono_ordre: prochainOrdreChronoV1(ouvrages, groupe.id) };
}

// Rattrapage : affectations des tâches qui n'ont AUCUN `chrono_groupe_id`,
// au format `applyChrono` ({ [tacheId]: { groupe_id, ordre } }).
// Ne touche jamais une tâche déjà affectée. Déterministe : les tâches sont
// parcourues dans l'ordre des ouvrages puis des tâches, et les compteurs
// d'ordre repartent du maximum existant de chaque groupe.
export function rattraperAffectationsChronoV1({ ouvrages, chronoGroupes, groupesTypes } = {}) {
  const index = indexerGroupesChronoV1(chronoGroupes, groupesTypes);
  const compteurs = new Map();
  const assignments = {};
  for (const o of Array.isArray(ouvrages) ? ouvrages : []) {
    for (const t of Array.isArray(o?.taches) ? o.taches : []) {
      if (!t?.id) continue;
      if (t.chrono_groupe_id) continue;
      const groupe = groupeChronoPourTacheV1(t, o, index);
      if (!groupe?.id) continue;
      if (!compteurs.has(groupe.id)) compteurs.set(groupe.id, prochainOrdreChronoV1(ouvrages, groupe.id));
      const ordre = compteurs.get(groupe.id);
      assignments[t.id] = { groupe_id: groupe.id, ordre };
      compteurs.set(groupe.id, ordre + 1);
    }
  }
  return assignments;
}
