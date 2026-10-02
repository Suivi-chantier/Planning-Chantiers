// src/Invest/dossiers/piecesMission.mjs — logique PURE de l'onglet Documents d'une mission.
// Aucun accès Supabase, aucune horloge : les données et la date du jour arrivent en paramètre.
// Les catégories et statuts correspondent à la table invest_dossier_pieces (migration 20261002100000).

export const GENRES = Object.freeze({ piece_client: "Pièces du client", document_profero: "Documents Profero" });

export const CATEGORIES_PIECES = Object.freeze([
  ["identite", "Identité et situation familiale"], ["revenus", "Revenus et activité"], ["engagements", "Crédits et engagements"],
  ["immobilier", "Patrimoine immobilier"], ["financier", "Patrimoine financier et retraite"], ["bancaire", "Épargne et étude bancaire"],
  ["structures", "Structures, fiscalité et transmission"], ["mission", "Mission et conformité"], ["autre", "Autres pièces"],
]);
export const CATEGORIES_DOCUMENTS = Object.freeze([
  ["lettre_mission", "Lettre de mission"], ["rapport_restitution", "Rapport de restitution"], ["compte_rendu", "Compte rendu"],
  ["analyse", "Analyse patrimoniale"], ["strategie", "Stratégie d'investissement"], ["autre", "Autre document"],
]);

export const STATUTS_PIECE = Object.freeze({ a_demander: "À demander", demandee: "Demandée", recue: "Reçue", validee: "Validée", sans_objet: "Sans objet" });
export const STATUTS_DOCUMENT = Object.freeze({ a_produire: "À produire", depose: "Déposé", remis_client: "Remis au client" });
export const statutsDe = (genre) => (genre === "document_profero" ? STATUTS_DOCUMENT : STATUTS_PIECE);
/** Libellé d'un statut ; un statut inconnu s'affiche tel quel (jamais comme « reçu »). */
export const libelleStatut = (genre, statut) => statutsDe(genre)[statut] ?? String(statut ?? "—");

const POSSEDEES = new Set(["recue", "validee"]);       // pièce en main
const OUVERTES = new Set(["a_demander", "demandee"]);  // pièce encore attendue

/**
 * Avancement des pièces du client. « Sans objet » sort du total. Aucune pièce attendue = pas de pourcentage
 * (jamais « 100 % » sur une liste vide).
 */
export function avancementPieces(pieces = []) {
  const attendues = pieces.filter((p) => p.genre === "piece_client" && p.statut !== "sans_objet");
  const recues = attendues.filter((p) => POSSEDEES.has(p.statut)).length;
  const manquantesObligatoires = attendues.filter((p) => p.obligatoire && OUVERTES.has(p.statut)).length;
  return { total: attendues.length, recues, manquantesObligatoires, pourcentage: attendues.length ? Math.round((recues / attendues.length) * 100) : null };
}

/** Pièces regroupées par catégorie, dans l'ordre des catégories ; obligatoires d'abord, puis ordre alphabétique. */
export function piecesParCategorie(pieces = []) {
  const ordre = Object.fromEntries(CATEGORIES_PIECES.map(([cle], i) => [cle, i]));
  const libelles = Object.fromEntries(CATEGORIES_PIECES);
  const groupes = new Map();
  for (const p of pieces.filter((x) => x.genre === "piece_client")) {
    if (!groupes.has(p.categorie)) groupes.set(p.categorie, []);
    groupes.get(p.categorie).push(p);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (ordre[a] ?? 99) - (ordre[b] ?? 99))
    .map(([cle, lignes]) => ({ cle, libelle: libelles[cle] ?? cle, pieces: [...lignes].sort((a, b) => (b.obligatoire - a.obligatoire) || a.libelle.localeCompare(b.libelle, "fr")) }));
}

/** Documents Profero : lettre de mission, puis rapport de restitution, puis le reste. */
export function documentsProfero(pieces = []) {
  const ordre = Object.fromEntries(CATEGORIES_DOCUMENTS.map(([cle], i) => [cle, i]));
  return pieces.filter((p) => p.genre === "document_profero")
    .sort((a, b) => (ordre[a.categorie] ?? 99) - (ordre[b.categorie] ?? 99) || a.libelle.localeCompare(b.libelle, "fr"));
}

/**
 * Champs à écrire quand on change le statut d'une pièce : la date correspondante est posée une fois,
 * jamais écrasée ; revenir en arrière n'efface pas une date déjà enregistrée.
 */
export function patchStatutPiece(piece, statut, aujourdhui, auteur = null) {
  const patch = { statut };
  if (statut === "demandee" && !piece.demande_le) patch.demande_le = aujourdhui;
  if (statut === "recue" && !piece.recu_le) patch.recu_le = aujourdhui;
  if (statut === "validee") {
    if (!piece.recu_le) patch.recu_le = aujourdhui;
    if (!piece.valide_le) { patch.valide_le = aujourdhui; patch.valide_par = auteur; }
  }
  return patch;
}

/** Statut après le dépôt d'un fichier : une pièce attendue devient « reçue », un document « déposé ». Le reste ne recule jamais. */
export function statutApresDepot(piece) {
  if (piece.genre === "document_profero") return piece.statut === "a_produire" ? "depose" : piece.statut;
  return OUVERTES.has(piece.statut) || piece.statut === "sans_objet" ? "recue" : piece.statut;
}

/** Statut quand on retire le fichier : la pièce redevient attendue, le document redevient à produire. */
export function statutApresRetraitFichier(piece) {
  if (piece.genre === "document_profero") return piece.statut === "depose" || piece.statut === "remis_client" ? "a_produire" : piece.statut;
  return piece.statut === "recue" || piece.statut === "validee" ? "demandee" : piece.statut;
}

const SANS_ACCENT = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Nom de fichier sûr pour le stockage (le nom d'origine reste dans nom_fichier). */
export function nomSur(brut) {
  const nom = String(brut).split(/[\\/]/).pop();   // jamais de dossier dans le nom
  const ext = (nom.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  const base = SANS_ACCENT(nom.replace(/\.[^.]+$/, "")).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "fichier";
  return ext ? `${base}.${ext.toLowerCase()}` : base;
}
/** Chemin de stockage : toujours dans le dossier de la mission (la base le refuse sinon). */
export function cheminFichier(clientId, dossierId, genre, nom, horodatage) {
  return `clients/${clientId}/mission/${dossierId}/${genre}/${horodatage}_${nomSur(nom)}`;
}

/** Rapport de restitution : lit la date de restitution déjà enregistrée sur la mission, sans jamais la déduire. */
export function etatRestitution(dossier, pieces = []) {
  const rapport = pieces.find((p) => p.genre === "document_profero" && p.categorie === "rapport_restitution");
  return {
    present: !!rapport, depose: !!rapport?.chemin,
    dateEnregistree: dossier?.restitution_le ? String(dossier.restitution_le).slice(0, 10) : null,
    // Proposer d'enregistrer la date : le rapport est déposé et aucune date n'existe encore.
    proposerDate: !!rapport?.chemin && !dossier?.restitution_le,
  };
}
