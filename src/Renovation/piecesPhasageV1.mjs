// ─────────────────────────────────────────────────────────────────────────────
// Pièces du chantier dans le phasage (prompt CR-2).
// Module PUR (façade piecesPhasageV1.js) : aucun accès Supabase, aucune
// horloge, aucun effet de bord — les identifiants neufs arrivent en paramètre.
//
// Stockage (aucune migration) :
//   phasage.plan_travaux.meta.pieces = [{ id, nom }]   (l'ordre du tableau est
//                                                       l'ordre d'affichage)
//   tâche.piece_id                                     (facultatif)
// Une tâche sans pièce reste valable partout : la pièce sert à lire et filtrer
// le phasage (et, au CR-3, à naviguer par pièce sur le téléphone).
// ─────────────────────────────────────────────────────────────────────────────

const net = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const liste = (v) => (Array.isArray(v) ? v : []);
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export const SANS_PIECE = "__sans_piece__";

// Liste propre : ids et noms non vides, sans doublon d'id.
export function piecesDuPhasage(meta) {
  const vus = new Set();
  return liste(meta?.pieces)
    .filter(p => p && net(p.id) && net(p.nom) && !vus.has(net(p.id)) && vus.add(net(p.id)))
    .map(p => ({ id: net(p.id), nom: net(p.nom) }));
}

export function ajouterPiece(pieces, nom, id) {
  const n = net(nom);
  if (!n || !net(id)) return liste(pieces);
  if (liste(pieces).some(p => net(p.nom).toLowerCase() === n.toLowerCase())) return liste(pieces);
  return [...liste(pieces), { id: net(id), nom: n }];
}
export function renommerPiece(pieces, id, nom) {
  const n = net(nom);
  if (!n) return liste(pieces);
  return liste(pieces).map(p => (p.id === id ? { ...p, nom: n } : p));
}
// Déplace d'un cran (delta = -1 vers le haut, +1 vers le bas).
export function deplacerPiece(pieces, id, delta) {
  const l = [...liste(pieces)];
  const i = l.findIndex(p => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= l.length) return l;
  [l[i], l[j]] = [l[j], l[i]];
  return l;
}
export function supprimerPiece(pieces, id) {
  return liste(pieces).filter(p => p.id !== id);
}

// Rattache (ou détache, pieceId null) un ensemble de tâches, dans tous les
// ouvrages : renvoie les ouvrages modifiés (les autres sont rendus tels quels).
export function rattacherTaches(ouvrages, tacheIds, pieceId) {
  const ids = new Set(liste(tacheIds).map(String));
  return liste(ouvrages).map(o => {
    if (!liste(o?.taches).some(t => ids.has(String(t.id)))) return o;
    return { ...o, taches: o.taches.map(t => (ids.has(String(t.id)) ? { ...t, piece_id: pieceId || null } : t)) };
  });
}
// Retire une pièce supprimée de toutes les tâches qui la portaient.
export function detacherPiece(ouvrages, pieceId) {
  return liste(ouvrages).map(o => (liste(o?.taches).some(t => t.piece_id === pieceId)
    ? { ...o, taches: o.taches.map(t => (t.piece_id === pieceId ? { ...t, piece_id: null } : t)) }
    : o));
}

// Regroupement pour l'affichage : pièces dans l'ordre de la liste, puis
// « Sans pièce » ; une pièce inconnue (supprimée) compte comme « sans pièce ».
export function grouperParPiece(taches, pieces) {
  const connues = new Map(liste(pieces).map(p => [p.id, p]));
  const groupes = liste(pieces).map(p => ({ id: p.id, nom: p.nom, taches: [] }));
  const sans = { id: SANS_PIECE, nom: "Sans pièce", taches: [] };
  liste(taches).forEach(t => {
    const g = t?.piece_id && connues.has(t.piece_id) ? groupes.find(x => x.id === t.piece_id) : sans;
    g.taches.push(t);
  });
  return [...groupes, sans].filter(g => g.taches.length > 0);
}
export function filtrerParPiece(taches, pieceId, pieces) {
  if (!pieceId) return liste(taches);
  const connues = new Set(liste(pieces).map(p => p.id));
  return liste(taches).filter(t => (pieceId === SANS_PIECE
    ? !(t?.piece_id && connues.has(t.piece_id))
    : t?.piece_id === pieceId));
}

// Répartition d'un total d'heures sur n parts : égale, au centième, le
// reste (arrondis) sur la dernière part — la somme vaut toujours le total.
export function repartirHeures(total, n) {
  const T = r2(num(total));
  if (!(n > 0)) return [];
  const base = Math.floor((T / n) * 100) / 100;
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] = r2(T - base * (n - 1));
  return parts;
}

// Duplication d'une tâche pour plusieurs pièces.
//   parts : [{ piece_id, heures }] — la PREMIÈRE part reste la tâche d'origine
//           (même id, son avancement et ses heures pointées), les suivantes
//           sont des copies neuves (avancement 0) ;
//   nouveauxIds : un id neuf par copie.
// Le total des heures estimées est conservé (refus sinon) ; heures vendues et
// ratio sont répartis dans les mêmes proportions, pour que les heures prévues
// de l'ouvrage — donc la dérive — ne bougent pas.
export function dupliquerTacheParPieces(tache, parts, nouveauxIds = []) {
  const P = liste(parts);
  if (P.length < 2) return { ok: false, erreur: "Choisis au moins deux pièces." };
  if (nouveauxIds.length < P.length - 1) return { ok: false, erreur: "Identifiants manquants." };
  const total = r2(num(tache?.heures_estimees));
  const somme = r2(P.reduce((s, p) => s + num(p.heures), 0));
  if (Math.abs(somme - total) > 0.001) {
    return { ok: false, erreur: `La répartition (${somme} h) doit être égale aux heures estimées de la tâche (${total} h).` };
  }
  const poids = P.map(p => (total > 0 ? num(p.heures) / total : 1 / P.length));
  const repartir = (v) => {
    if (v == null || v === "") return P.map(() => v);
    const V = num(v);
    const out = poids.map(w => r2(V * w));
    out[out.length - 1] = r2(V - out.slice(0, -1).reduce((s, x) => s + x, 0));
    return out;
  };
  const vendues = repartir(tache?.heures_vendues);
  const ratios = repartir(tache?.ratio);
  const taches = P.map((p, i) => {
    const base = i === 0
      ? { ...tache }
      : { ...tache, id: nouveauxIds[i - 1], avancement: 0, heures_reelles: undefined, quantite_terminee: undefined, ouvriers: liste(tache?.ouvriers) };
    const t = { ...base, piece_id: p.piece_id || null, heures_estimees: r2(num(p.heures)) };
    if (tache?.heures_vendues != null && tache?.heures_vendues !== "") t.heures_vendues = vendues[i];
    if (tache?.ratio != null && tache?.ratio !== "") t.ratio = ratios[i];
    Object.keys(t).forEach(k => t[k] === undefined && delete t[k]);
    return t;
  });
  return { ok: true, taches };
}
