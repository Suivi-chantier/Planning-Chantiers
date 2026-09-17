// ─────────────────────────────────────────────────────────────────────────────
// suggestionsMateriaux — règles pures du formulaire « Suggérer un matériau »
// de la préparation ouvrière.
//
// Fonctions PURES : aucun réseau, aucun React. Elles valident la saisie AVANT
// l'appel, pour que l'ouvrier ait un message immédiat — mais elles ne sont
// jamais la sécurité : la RPC ouvrier_suggerer_materiau revalide tout côté
// serveur (source, unité, appartenance de l'ouvrage, auteur, statut, date).
//
// ⚠ AUCUNE DONNÉE FINANCIÈRE : une suggestion porte un besoin, jamais un
//   prix. Rien ici ne manipule de montant.
// ─────────────────────────────────────────────────────────────────────────────

// Même borne que la contrainte SQL sugg_precision_bornee.
export const PRECISION_MAX = 500;
// Même borne haute que la contrainte SQL sugg_quantite_positive : elle écarte
// Infinity et les saisies aberrantes.
export const QUANTITE_MAX = 1000000000;

// Nombre exploitable, ou null. Accepte la virgule ou le point. Ne renvoie
// JAMAIS NaN ni Infinity — l'appelant n'a donc aucun moyen d'en afficher un.
export function normaliserNombre(valeur) {
  if (valeur === null || valeur === undefined || typeof valeur === "boolean") return null;
  const brut = String(valeur).trim().replace(",", ".");
  if (brut === "") return null;
  if (!/^-?\d*\.?\d*$/.test(brut) || !/\d/.test(brut)) return null;
  const n = parseFloat(brut);
  return Number.isFinite(n) ? n : null;
}

// Quantité TOTALE nécessaire pour le chantier. Strictement positive.
export function validerQuantite(valeur) {
  const n = normaliserNombre(valeur);
  if (n === null) return { ok: false, erreur: "Indique une quantité, en chiffres." };
  if (n <= 0) return { ok: false, erreur: "La quantité doit être supérieure à zéro." };
  if (n > QUANTITE_MAX) return { ok: false, erreur: "Cette quantité est trop élevée." };
  return { ok: true, valeur: n };
}

// Source du matériau : la bibliothèque OU une saisie libre, jamais les deux,
// jamais aucune — exactement la contrainte sugg_source_exclusive.
// `materiau` = l'objet choisi dans la recherche (ou null).
export function validerChoixMateriau({ materiau = null, designation = "", unite = "" } = {}) {
  const d = String(designation || "").trim();
  const u = String(unite || "").trim();
  const aMateriau = !!(materiau && materiau.id);
  if (aMateriau && d) {
    return { ok: false, erreur: "Choisis soit un matériau de la bibliothèque, soit une saisie libre." };
  }
  if (aMateriau) {
    // L'unité vient de la bibliothèque : le serveur la relit de toute façon.
    return { ok: true, mode: "bibliotheque", materiau_id: materiau.id, unite: materiau.unite || "U" };
  }
  if (!d) {
    return { ok: false, erreur: "Choisis un matériau ou saisis une désignation." };
  }
  if (!u) {
    return { ok: false, erreur: "Indique l'unité (sac, m², U…)." };
  }
  return { ok: true, mode: "libre", designation_libre: d, unite: u };
}

// Regroupe les suggestions renvoyées par la RPC sous l'identifiant d'ouvrage.
// L'ordre reçu est conservé à l'intérieur de chaque groupe.
export function grouperParOuvrage(suggestions) {
  const parOuvrage = {};
  (Array.isArray(suggestions) ? suggestions : []).forEach(s => {
    if (!s || !s.ouvrage_id) return;
    const cle = String(s.ouvrage_id);
    (parOuvrage[cle] = parOuvrage[cle] || []).push(s);
  });
  return parOuvrage;
}

const memeTexte = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Doublon EXACT déjà en attente sur cet ouvrage — même matériau, ou même
// désignation libre à la casse et aux espaces près. Aucune ressemblance
// approximative n'est cherchée : deux textes proches restent deux demandes.
// Contrôle de confort : la RPC et deux index partiels tranchent pour de bon.
export function doublonLocal(suggestionsOuvrage, { materiau = null, designation = "" } = {}) {
  const liste = Array.isArray(suggestionsOuvrage) ? suggestionsOuvrage : [];
  const d = String(designation || "").trim();
  return liste.some(s => {
    if (!s || s.statut !== "en_attente") return false;
    if (materiau && materiau.id && materiau.nom) return memeTexte(s.designation, materiau.nom);
    if (d) return memeTexte(s.designation, d);
    return false;
  });
}

// Garde anti-réponse obsolète : une recherche lente ne doit jamais écraser le
// résultat d'une frappe plus récente.
export function reponseObsolete(sequenceRecue, sequenceCourante) {
  return Number(sequenceRecue) !== Number(sequenceCourante);
}
