// ─────────────────────────────────────────────────────────────────────────────
// planV2Modele — nouvel éditeur de plans : modèle d'objets métier de
// l'EXISTANT, construit à partir d'un relevé iMapper (docs/projets/
// editeur-plans.md, règles 4 et 5).
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord. Le relevé
// arrive en paramètre, il n'est jamais modifié ni recopié : le modèle désigne
// les pièces et les ouvertures du relevé par leur IDENTIFIANT (nom, type,
// polygone, hauteur, photos, statut… restent lus dans le relevé, et les métrés
// restent ceux de calculerMetres(releve)). Les murs, eux, sont calculés
// (planV2Murs.mjs). Couvert par scripts/verif-plan-v2-modele.mjs.
//
// FORME DU DOCUMENT (construireModeleExistant)
//   { version: 1,
//     source: { version_releve, outil, projet },
//     tolerances: { … },                    // celles du calcul (voir planV2Murs)
//     existant: {                           // figé : recalculable du relevé seul
//       pieces: [{ id, etat: "existant", corps_etat: null,
//                  cotes: [{ cote, longueur, murs: [idMur…] }] }],
//       murs:   [ … ],                      // forme décrite dans planV2Murs.mjs
//       ouvertures: null | [{ id, etat, corps_etat, mur, face, piece, cote,
//                             position: "connue" | "inconnue",
//                             t0, t1,       // abscisses sur le côté de la pièce
//                             s0, s1,       // abscisses le long de la face du mur
//                             deborde, murs_touches: [idMur…] }],
//           // null = ouvertures pas encore relevées (≠ [] : aucune ouverture)
//       ouvertures_non_rattachees: [{ id, raison, texte }],
//       voisinages_ecartes: [ … ] },        // vis-à-vis non retenus comme murs
//     // Emplacements des tâches suivantes — vides ici, rien n'y est calculé :
//     equipements: [], notes: [], traits: [],
//     projet: { modifications: [] } }       // le projet se pose sur l'existant
//
// Chaque élément porte un `etat` (existant / a_demolir / a_creer) et un
// `corps_etat` ; ici tout est « existant ».
// ─────────────────────────────────────────────────────────────────────────────
import { cotesPiece } from "../releveImapper.mjs";
import { calculerMurs, tronconsCote, TOLERANCES_MURS, CORPS_ETAT_MURS } from "./planV2Murs.mjs";

export * from "./planV2Murs.mjs";

export const VERSION_MODELE_PLAN = 1;

// Pourquoi une ouverture du relevé n'a pas pu être accrochée à un mur.
export const RAISONS_NON_RATTACHEE = {
  piece_introuvable: "sa pièce n'existe plus dans le relevé",
  cote_introuvable: "le côté de pièce qu'elle désigne n'existe pas",
  position_inconnue: "vue sur photo mais pas encore placée, et son côté de pièce porte plusieurs murs",
  hors_cote: "elle tombe en dehors de son côté de pièce",
};

const arr = (v) => Math.round(v * 10000) / 10000;
// Chevauchement minimal (m) pour qu'une ouverture « touche » un tronçon.
const CHEVAUCHEMENT_MIN_M = 0.01;

// Accroche chaque ouverture du relevé au mur calculé qui porte son côté.
// Retourne { ouvertures, non_rattachees } ; `ouvertures` vaut null si le
// relevé n'a pas encore d'ouvertures (null ≠ []). Aucune n'est perdue :
// toute ouverture du relevé est dans l'une des deux listes.
export function rattacherOuvertures(releve, murs) {
  if (!Array.isArray(releve?.ouvertures)) return { ouvertures: null, non_rattachees: [] };
  const ouvertures = [], non = [];
  const refus = (o, raison, detail = "") => non.push({
    id: o.id, raison, texte: `${o.code || o.id} : ${RAISONS_NON_RATTACHEE[raison]}${detail}.`,
  });
  for (const o of releve.ouvertures) {
    const piece = (releve.pieces || []).find((p) => p.id === o.piece);
    if (!piece) { refus(o, "piece_introuvable"); continue; }
    const c = cotesPiece(piece)[o.mur];
    if (!c) { refus(o, "cote_introuvable"); continue; }
    const troncons = tronconsCote(murs, piece.id, c.k);
    const base = { id: o.id, etat: "existant", corps_etat: CORPS_ETAT_MURS, piece: piece.id, cote: c.k };
    if (o.t0 == null || o.t1 == null) {
      if (troncons.length !== 1) { refus(o, "position_inconnue", ` (${troncons.length} murs)`); continue; }
      ouvertures.push({ ...base, mur: troncons[0].mur, face: troncons[0].face, position: "inconnue",
        t0: null, t1: null, s0: null, s1: null, deborde: false, murs_touches: [troncons[0].mur] });
      continue;
    }
    // Entièrement en dehors du côté : rien à accrocher, on le dit.
    const brut0 = Math.min(o.t0, o.t1), brut1 = Math.max(o.t0, o.t1);
    const dedans = Math.min(brut1, c.L) - Math.max(brut0, 0);
    if (!(dedans >= 0) || (brut1 > brut0 && dedans < 1e-6)) { refus(o, "hors_cote"); continue; }
    // Mêmes bornes que geometrieOuverture : l'ouverture est ramenée dans son côté.
    const t0 = Math.max(0, brut0), t1 = Math.min(c.L, brut1);
    const touches = troncons
      .map((tr) => ({ tr, commun: Math.min(t1, tr.t1) - Math.max(t0, tr.t0) }))
      .filter((x) => x.commun >= Math.min(CHEVAUCHEMENT_MIN_M, (t1 - t0) / 2));
    if (!touches.length) { refus(o, "hors_cote"); continue; }
    const principal = touches.reduce((a, b) => (b.commun > a.commun + 1e-9 ? b : a)).tr;
    ouvertures.push({
      ...base, mur: principal.mur, face: principal.face, position: "connue",
      t0: arr(t0), t1: arr(t1), s0: arr(t0 - principal.t0), s1: arr(t1 - principal.t0),
      deborde: touches.length > 1, murs_touches: touches.map((x) => x.tr.mur),
    });
  }
  return { ouvertures, non_rattachees: non };
}

// releve → modèle de l'existant (forme en tête de fichier).
// `options.tolerances` : surcharge de TOLERANCES_MURS.
export function construireModeleExistant(releve, { tolerances = {} } = {}) {
  const T = { ...TOLERANCES_MURS, ...tolerances };
  const { murs, cotes, voisinages_ecartes } = calculerMurs(releve, T);
  const { ouvertures, non_rattachees } = rattacherOuvertures(releve, murs);
  const parId = new Map(murs.map((m) => [m.id, m]));
  (ouvertures || []).forEach((o) => parId.get(o.mur).ouvertures.push(o.id));
  const pieces = (releve?.pieces || []).map((p) => ({
    id: p.id, etat: "existant", corps_etat: null,
    cotes: cotes.filter((c) => c.piece === p.id).map((c) => ({ cote: c.cote, longueur: c.longueur, murs: c.murs })),
  }));
  return {
    version: VERSION_MODELE_PLAN,
    source: {
      version_releve: releve?.version ?? null,
      outil: releve?.source?.outil ?? null,
      projet: releve?.source?.projet ?? null,
    },
    tolerances: { ...T },
    existant: { pieces, murs, ouvertures, ouvertures_non_rattachees: non_rattachees, voisinages_ecartes },
    equipements: [], notes: [], traits: [],
    projet: { modifications: [] },
  };
}

// Murs qui bordent une pièce, dans l'ordre de son contour.
export function mursDePiece(modele, pieceId) {
  const piece = (modele?.existant?.pieces || []).find((p) => p.id === pieceId);
  if (!piece) return [];
  const parId = new Map(modele.existant.murs.map((m) => [m.id, m]));
  return [...new Set(piece.cotes.flatMap((c) => c.murs))].map((id) => parId.get(id));
}

// Chiffres de synthèse du modèle (comptes rendus, vérifications).
// Les épaisseurs sont comptées par centimètre arrondi ; une épaisseur inconnue
// est comptée à part, jamais rangée dans une valeur.
export function bilanModele(modele) {
  const E = modele?.existant || { pieces: [], murs: [], ouvertures: null, ouvertures_non_rattachees: [] };
  const murs = E.murs || [];
  const de = (type) => murs.filter((m) => m.type === type);
  const epaisseurs = {};
  murs.filter((m) => m.epaisseur != null && m.type !== "limite")
    .forEach((m) => { const k = String(Math.round(m.epaisseur * 100)); epaisseurs[k] = (epaisseurs[k] || 0) + 1; });
  const raisons = {};
  (E.ouvertures_non_rattachees || []).forEach((o) => { raisons[o.raison] = (raisons[o.raison] || 0) + 1; });
  const inconnues = {};
  de("peripherique").filter((m) => m.epaisseur == null)
    .forEach((m) => { inconnues[m.epaisseur_raison] = (inconnues[m.epaisseur_raison] || 0) + 1; });
  const releves = E.ouvertures === null ? null : E.ouvertures.length + (E.ouvertures_non_rattachees || []).length;
  return {
    pieces: (E.pieces || []).length,
    cotes: (E.pieces || []).reduce((t, p) => t + p.cotes.length, 0),
    murs: {
      total: murs.length,
      partages: de("partage").length,
      limites: de("limite").length,
      peripheriques: de("peripherique").length,
      raccords: de("raccord").length,
      peripheriques_epaisseur_inconnue: de("peripherique").filter((m) => m.epaisseur == null).length,
      peripheriques_piece_derriere: de("peripherique").filter((m) => m.piece_derriere).length,
      pieces_superposees: murs.filter((m) => m.epaisseur_raison === "pieces_superposees").length,
      raisons_epaisseur_inconnue: inconnues,
    },
    epaisseurs_cm: epaisseurs,
    ouvertures: {
      releve: releves,
      rattachees: E.ouvertures === null ? null : E.ouvertures.length,
      non_rattachees: E.ouvertures === null ? null : (E.ouvertures_non_rattachees || []).length,
      raisons,
    },
  };
}
