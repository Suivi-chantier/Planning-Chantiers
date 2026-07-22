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
