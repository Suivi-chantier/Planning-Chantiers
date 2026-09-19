// ─────────────────────────────────────────────────────────────────────────────
// suggestionsConducteur — règles pures du traitement des suggestions par le
// bureau : conversion des quantités, matériau déjà lié, libellés et filtres.
//
// Fonctions PURES : aucun réseau, aucun React. Elles servent l'écran de
// validation ; la sécurité et la décision finale restent aux RPC
// conducteur_accepter_suggestion_materiau / _refuser_, qui refont TOUS ces
// contrôles sur l'état le plus récent de la base.
//
// ⚠ AUCUNE DONNÉE FINANCIÈRE : une suggestion porte un besoin de matière,
//   jamais un prix. Rien ici ne manipule de montant.
// ─────────────────────────────────────────────────────────────────────────────
// Extension explicite : ce module est importé par Vite ET par Node (script de
// vérification), et Node n'ajoute pas l'extension tout seul.
import { normaliserNombre } from "./suggestionsMateriaux.mjs";

export { normaliserNombre };
// Même borne haute que les contraintes SQL.
export const QUANTITE_MAX = 1000000000;
// Décimales conservées au préremplissage. Assez fin pour des ratios courants
// (0,0625 = 1/16) sans écrire un flottant illisible. La perte éventuelle n'est
// JAMAIS masquée : l'écran réaffiche le total obtenu à partir de la valeur
// réellement saisie, au conducteur de voir l'écart.
export const DECIMALES_PREREMPLISSAGE = 4;

export const LIBELLES_STATUT = {
  en_attente: "En attente",
  acceptee:   "Acceptée",
  refusee:    "Refusée",
};

export const FILTRES = [
  { cle: "en_attente", label: "En attente" },
  { cle: "acceptee",   label: "Acceptées" },
  { cle: "refusee",    label: "Refusées" },
];

export const ACTIONS_EXISTANT = {
  ajouter:   "Ajouter la quantité suggérée à l'existant",
  remplacer: "Remplacer la quantité prévue",
};

// La quantité d'ouvrage permet-elle une division ? Il faut un nombre fini et
// STRICTEMENT positif : zéro et les valeurs absentes interdisent le calcul.
export function quantiteOuvrageUtilisable(q) {
  const n = normaliserNombre(q);
  return n !== null && n > 0;
}

// Quantité PAR UNITÉ d'ouvrage = quantité totale demandée ÷ quantité
// d'ouvrage. Renvoie null si la division n'a pas de sens — l'écran exige
// alors une saisie manuelle et bloque l'acceptation.
export function quantiteParUnite(totalDemande, quantiteOuvrage) {
  const t = normaliserNombre(totalDemande);
  const q = normaliserNombre(quantiteOuvrage);
  if (t === null || q === null || q <= 0) return null;
  const r = t / q;
  return Number.isFinite(r) ? r : null;
}

// Valeur proposée dans le champ : le quotient, arrondi pour rester lisible.
export function preremplissageParUnite(totalDemande, quantiteOuvrage) {
  const r = quantiteParUnite(totalDemande, quantiteOuvrage);
  if (r === null) return null;
  const f = 10 ** DECIMALES_PREREMPLISSAGE;
  return Math.round(r * f) / f;
}

// Total réellement obtenu avec la quantité par unité SAISIE. Sert à montrer
// l'écart quand l'arrondi ne retombe pas sur la demande d'origine.
export function totalDepuisParUnite(parUnite, quantiteOuvrage) {
  const p = normaliserNombre(parUnite);
  const q = normaliserNombre(quantiteOuvrage);
  if (p === null || q === null || q <= 0) return null;
  const r = p * q;
  return Number.isFinite(r) ? r : null;
}

// Quantité acceptable : finie, strictement positive, sous la borne SQL.
export function validerQuantitePositive(valeur) {
  const n = normaliserNombre(valeur);
  if (n === null) return { ok: false, erreur: "Indique une quantité, en chiffres." };
  if (n <= 0) return { ok: false, erreur: "La quantité doit être supérieure à zéro." };
  if (n > QUANTITE_MAX) return { ok: false, erreur: "Cette quantité est trop élevée." };
  return { ok: true, valeur: n };
}

// Le matériau est-il DÉJÀ prévu sur l'ouvrage ? Renvoie sa quantité par unité
// actuelle, ou null s'il n'y est pas.
export function lienExistant(ouvrage, materiauId) {
  if (!materiauId) return null;
  const liens = Array.isArray(ouvrage?.materiaux_liens) ? ouvrage.materiaux_liens : [];
  const trouve = liens.find(l => l && String(l.materiau_id) === String(materiauId));
  if (!trouve) return null;
  return { quantite: normaliserNombre(trouve.quantite) };
}

// Résultat final d'une acceptation, tel qu'il sera écrit. `existant` = null
// quand le matériau n'est pas encore lié.
//   - pas de lien existant : la quantité saisie fait foi ;
//   - lien existant : une action EXPLICITE est obligatoire, sans valeur par
//     défaut — c'est ce qui empêche d'écraser ou de doubler sans le vouloir.
export function resultatAcceptation({ existant = null, action = null, quantiteParUnite: q } = {}) {
  const v = validerQuantitePositive(q);
  if (!v.ok) return { ok: false, erreur: v.erreur };
  if (!existant) return { ok: true, finale: v.valeur, mode: "nouveau" };
  const a = String(action || "").trim().toLowerCase();
  if (a !== "ajouter" && a !== "remplacer") {
    return { ok: false, erreur: "Choisis d'ajouter la quantité ou de remplacer celle déjà prévue.", actionRequise: true };
  }
  const base = normaliserNombre(existant.quantite) ?? 0;
  const finale = a === "ajouter" ? base + v.valeur : v.valeur;
  if (!Number.isFinite(finale) || finale <= 0 || finale > QUANTITE_MAX) {
    return { ok: false, erreur: "Le résultat n'est pas une quantité exploitable." };
  }
  return { ok: true, finale, mode: a };
}

// Filtre valide, avec repli sur « en attente ».
export function filtreValide(cle) {
  return FILTRES.some(f => f.cle === cle) ? cle : "en_attente";
}

// Une suggestion déjà traitée ne propose plus d'action.
export function estTraitable(suggestion) {
  return suggestion?.statut === "en_attente";
}
