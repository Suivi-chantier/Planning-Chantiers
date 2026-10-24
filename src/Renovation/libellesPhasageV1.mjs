// ─────────────────────────────────────────────────────────────────────────────
// Libellés du phasage : libellé DEVIS et libellé PERSONNALISÉ (prompt CR-2).
// Module PUR (façade libellesPhasageV1.js) : aucun accès Supabase, aucune
// horloge, aucun effet de bord.
//
// Un ouvrage porte son libellé devis dans `libelle`, une tâche dans `nom`.
// Le nom personnalisé (plus lisible sur un téléphone : « Isolation cloison SDB »
// au lieu de « Isolation laine minérale de 45 cloison hydro ») est enregistré
// À CÔTÉ, jamais à la place : `libelle_perso` (ouvrage), `nom_perso` (tâche).
//
// Règle (inventaire complet dans le fichier projet, compte rendu CR-2) :
//   - tout ce qui sort vers le client ou vers ProGBat garde le libellé devis
//     → libelleOuvrageDevis / nomTacheDevis ;
//   - tout ce qui s'affiche dans l'application (ouvriers, validation, planning,
//     bilan, assistant IA) prend le libellé personnalisé s'il existe, sinon le
//     libellé devis → libelleOuvrage / nomTache ;
//   - une correspondance automatique de noms (validation, tâches hors devis,
//     recherche) compare LES DEUX → textesTache / textesOuvrage.
// ─────────────────────────────────────────────────────────────────────────────

const net = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

export const libelleOuvrageDevis = (o) => net(o?.libelle);
export const nomTacheDevis = (t) => net(t?.nom);

export const aLibellePerso = (o) => !!net(o?.libelle_perso) && net(o?.libelle_perso) !== libelleOuvrageDevis(o);
export const aNomPerso = (t) => !!net(t?.nom_perso) && net(t?.nom_perso) !== nomTacheDevis(t);

// Libellé affiché dans l'application.
export const libelleOuvrage = (o) => (aLibellePerso(o) ? net(o.libelle_perso) : libelleOuvrageDevis(o));
export const nomTache = (t) => (aNomPerso(t) ? net(t.nom_perso) : nomTacheDevis(t));

// Tous les textes d'une tâche / d'un ouvrage, pour une recherche ou une
// correspondance de noms (sans doublon, sans vide).
export const textesTache = (t) => [...new Set([nomTache(t), nomTacheDevis(t)].filter(Boolean))];
export const textesOuvrage = (o) => [...new Set([libelleOuvrage(o), libelleOuvrageDevis(o)].filter(Boolean))];

// Recherche simple (minuscules, sans accents) sur les deux libellés.
const plat = (s) => net(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const tacheCorrespond = (t, recherche) => {
  const q = plat(recherche);
  return !q || textesTache(t).some(x => plat(x).includes(q));
};
export const ouvrageCorrespond = (o, recherche) => {
  const q = plat(recherche);
  return !q || textesOuvrage(o).some(x => plat(x).includes(q));
};

// Patch à appliquer pour renommer : un nom vide ou identique au libellé devis
// RETIRE le nom personnalisé (null) ; le libellé devis n'est jamais touché.
export function patchLibelleOuvrage(o, valeur) {
  const v = net(valeur);
  return { libelle_perso: v && v !== libelleOuvrageDevis(o) ? v : null };
}
export function patchNomTache(t, valeur) {
  const v = net(valeur);
  return { nom_perso: v && v !== nomTacheDevis(t) ? v : null };
}
