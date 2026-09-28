// Bibliothèque matériaux « grand catalogue » : règles pures de lecture.
//
// Depuis l'import SIDER (28/09/2026), materiaux_bibliotheque compte plus de
// 23 000 articles. L'API Supabase ne renvoie JAMAIS plus de 1 000 lignes par
// requête, et elle le fait sans erreur : un écran qui lit « toute la table »
// d'un coup n'en voit qu'une partie, sans le savoir. Ce module décrit :
//   – le découpage en tranches d'une lecture complète ;
//   – le filtre de recherche envoyé à la base (page Bibliothèque matériaux) ;
//   – le tri côté base, fidèle aux tris qu'offrait l'écran ;
//   – le plafond d'affichage des listes de choix.
//
// Module pur : aucune base, aucune horloge. Façade : materiauxCatalogueV1.js.

export const MATERIAUX_CATALOGUE_VERSION = "v1";

// Plafond de l'API (PostgREST max-rows). Une tranche ne doit pas le dépasser.
export const TAILLE_TRANCHE = 1000;

// Nombre de résultats montrés par une liste de choix avant « affinez ».
export const PLAFOND_LISTE_CHOIX = 50;

// Articles par page sur l'écran Bibliothèque matériaux.
export const TAILLE_PAGE_BIBLIOTHEQUE = 100;

/**
 * Tranches [debut, fin] (bornes incluses, comme .range()) couvrant `total` lignes.
 * total inconnu (null) ⇒ [] : l'appelant doit d'abord compter.
 */
export function tranchesLecture(total, taille = TAILLE_TRANCHE) {
  if (!Number.isInteger(total) || total < 0) return [];
  if (!Number.isInteger(taille) || taille < 1) throw new Error("taille de tranche invalide");
  const out = [];
  for (let debut = 0; debut < total; debut += taille) {
    out.push([debut, Math.min(debut + taille, total) - 1]);
  }
  return out;
}

/**
 * Assemble les tranches lues. Une seule tranche en erreur ⇒ lecture refusée
 * en bloc : une liste partielle ne doit jamais passer pour la bibliothèque.
 * Les doublons d'id (ligne déplacée entre deux tranches) sont écartés.
 */
export function assemblerTranches(resultats) {
  const liste = [];
  const vus = new Set();
  for (const r of resultats || []) {
    if (!r || r.error) {
      return { data: null, error: r?.error || new Error("tranche manquante") };
    }
    for (const ligne of r.data || []) {
      const k = String(ligne?.id);
      if (vus.has(k)) continue;
      vus.add(k);
      liste.push(ligne);
    }
  }
  return { data: liste, error: null };
}

/**
 * Filtre `or` PostgREST cherchant `texte` dans le nom, la référence et le
 * fournisseur. Les valeurs sont entre guillemets : une virgule, une
 * parenthèse ou un point dans la saisie ne cassent pas la requête.
 * Saisie vide ⇒ null (pas de filtre).
 */
export function filtreRecherche(texte, colonnes = ["nom", "reference", "fournisseur"]) {
  const brut = String(texte ?? "").trim();
  if (!brut) return null;
  // * est le joker PostgREST ; " et \ sont échappés dans la valeur citée.
  const sur = brut.replace(/[*%]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
  if (!sur) return null;
  const motif = `"*${sur}*"`;
  return colonnes.map(c => `${c}.ilike.${motif}`).join(",");
}

// Le catalogue des ouvriers (RPC catalogue_materiaux_demande) n'expose pas le
// fournisseur : on y cherche dans le nom, la référence et la catégorie, comme
// le faisaient les deux écrans terrain.
export const COLONNES_RECHERCHE_CATALOGUE = ["nom", "reference", "categorie"];

/** Catégories distinctes, triées, sans vide. */
export function categoriesDistinctes(lignes) {
  return Array.from(new Set((lignes || []).map(l => l?.categorie).filter(c => c && String(c).trim()))).sort((a, b) => a.localeCompare(b));
}

/** « 50 affichés sur 1 234 » — ou null quand tout est affiché. */
export function libelleResultatsPlafonnes(affiches, total) {
  if (!Number.isInteger(total) || total <= affiches) return null;
  return `${affiches} affichés sur ${total.toLocaleString("fr-FR")} — précisez la recherche`;
}

/**
 * Tri côté base pour l'écran Bibliothèque matériaux. Reprend les tris de
 * l'écran : l'ancien tri « prix » comptait un prix vide comme 0, donc en tête
 * en croissant et en fin en décroissant. L'id départage toujours, pour que les
 * pages ne se chevauchent pas.
 * @returns Array<[colonne, { ascending, nullsFirst }]>
 */
export function ordreBibliotheque(tri, vue = "liste") {
  const base = {
    "az":          [["nom", { ascending: true }]],
    "za":          [["nom", { ascending: false }]],
    "prix-asc":    [["prix_unitaire", { ascending: true, nullsFirst: true }], ["nom", { ascending: true }]],
    "prix-desc":   [["prix_unitaire", { ascending: false, nullsFirst: false }], ["nom", { ascending: true }]],
    "fournisseur": [["fournisseur", { ascending: true, nullsFirst: false }], ["nom", { ascending: true }]],
  }[tri] || [["nom", { ascending: true }]];
  // Vue groupée : les articles d'une même catégorie doivent se suivre.
  const groupe = vue === "groupe" ? [["categorie", { ascending: true, nullsFirst: false }]] : [];
  return [...groupe, ...base, ["id", { ascending: true }]];
}

/**
 * Filtre d'une liste de choix en mémoire, plafonné. Renvoie les articles à
 * afficher et le nombre total de correspondances, pour dire « 50 sur 1 234 ».
 * Sans saisie, rien n'est listé tant que le catalogue dépasse le plafond :
 * dérouler 23 000 lignes bloquerait l'écran.
 */
export function filtrerListeChoix(materiaux, texte, plafond = PLAFOND_LISTE_CHOIX) {
  const liste = Array.isArray(materiaux) ? materiaux : [];
  const q = String(texte ?? "").trim().toLowerCase();
  if (!q && liste.length > plafond) return { visibles: [], total: liste.length, saisieRequise: true };
  const correspond = !q ? liste : liste.filter(m =>
    m?.nom?.toLowerCase().includes(q) ||
    m?.reference?.toLowerCase().includes(q) ||
    m?.fournisseur?.toLowerCase().includes(q));
  return { visibles: correspond.slice(0, plafond), total: correspond.length, saisieRequise: false };
}
