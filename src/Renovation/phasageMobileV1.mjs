// ─────────────────────────────────────────────────────────────────────────────
// Phasage du chantier sur téléphone — compte rendu, parcours « pas comme
// prévu » (CR-3). Trois niveaux au plus : lot › ouvrage › tâche, ou pièce ›
// tâche.
//
// Module PUR (façade phasageMobileV1.js). Les données viennent de la fonction
// serveur ouvrier_mes_phases (phases › ouvrages › tâches, avec libelle_perso,
// nom_perso, lot_id, piece_id, pieces, lots) : rien n'est recalculé, l'état
// d'une tâche est lu dans son avancement.
//
// Métier de l'ouvrier en premier : les lots où il a une tâche prévue
// aujourd'hui, puis ceux où il a déjà travaillé ou est affecté (est_mienne,
// mes_heures), puis les autres, dans l'ordre des lots de l'Admin.
// ─────────────────────────────────────────────────────────────────────────────
const net = (v) => String(v ?? "").trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const norm = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

export const SANS_LOT = "_sans_lot";
export const SANS_PIECE = "_sans_piece";

export const nomAffiche = (t) => net(t?.nom_perso) || net(t?.nom) || "(sans nom)";
export const libelleAffiche = (o) => net(o?.libelle_perso) || net(o?.libelle) || "(sans nom)";

// pas_commencee | en_cours | terminee — lu dans l'avancement du phasage.
export function etatTache(t) {
  const av = num(t?.avancement);
  if (av >= 100) return "terminee";
  return av > 0 ? "en_cours" : "pas_commencee";
}

// payload : réponse de ouvrier_mes_phases ; lotsDefaut : liste de repli
// (constants.LOTS_DEFAUT) quand l'Admin n'en a pas enregistré ;
// tachesDuJourIds : tache_id prévues aujourd'hui pour l'ouvrier.
// → { lots: [{ id, label, couleur, prioritaire, ouvrages: [{ id, libelle, libelleDevis, taches }] }],
//     pieces: [{ id, nom }], taches: [toutes, à plat] }
export function construireArbre(payload, { lotsDefaut = [], tachesDuJourIds = [] } = {}) {
  const lotsRef = Array.isArray(payload?.lots) && payload.lots.length ? payload.lots : lotsDefaut;
  const ordreLot = new Map(lotsRef.map((l, i) => [net(l.id), i]));
  const duJour = new Set((tachesDuJourIds || []).map(String));
  const parOuvrage = new Map();
  (payload?.phases || []).forEach(ph => (ph.ouvrages || []).forEach(o => {
    const id = net(o.id) || `${ph.id}:${o.libelle}`;
    const e = parOuvrage.get(id) || {
      id, libelle: libelleAffiche(o), libelleDevis: net(o.libelle), lotId: net(o.lot_id) || SANS_LOT, taches: [],
    };
    (o.taches || []).forEach(t => {
      if (!t?.id || e.taches.some(x => x.id === String(t.id))) return;
      e.taches.push({
        ...t, id: String(t.id), nomAffiche: nomAffiche(t), nomDevis: net(t.nom),
        ouvrage_id: id, ouvrageLibelle: e.libelle, etat: etatTache(t),
        pieceId: net(t.piece_id) || null, duJour: duJour.has(String(t.id)),
      });
    });
    parOuvrage.set(id, e);
  }));
  const lots = new Map();
  parOuvrage.forEach(o => {
    const ref = lotsRef.find(l => net(l.id) === o.lotId);
    const lot = lots.get(o.lotId) || {
      id: o.lotId, label: ref ? net(ref.label) : "Autres travaux", couleur: ref?.couleur || "#94a3b8",
      ordre: ordreLot.has(o.lotId) ? ordreLot.get(o.lotId) : 9999, ouvrages: [],
    };
    lot.ouvrages.push(o);
    lots.set(o.lotId, lot);
  });
  const rang = (lot) => {
    const taches = lot.ouvrages.flatMap(o => o.taches);
    if (taches.some(t => t.duJour)) return 0;
    if (taches.some(t => t.est_mienne === true || num(t.mes_heures) > 0)) return 1;
    return 2;
  };
  const liste = [...lots.values()]
    .map(l => ({ ...l, prioritaire: rang(l) < 2, rang: rang(l) }))
    .sort((a, b) => a.rang - b.rang || a.ordre - b.ordre || a.label.localeCompare(b.label, "fr"));
  const pieces = (payload?.pieces || []).filter(p => net(p?.id) && net(p?.nom)).map(p => ({ id: net(p.id), nom: net(p.nom) }));
  return { lots: liste, pieces, taches: liste.flatMap(l => l.ouvrages.flatMap(o => o.taches)) };
}

// Tâches visibles : terminées masquées sauf demande.
export const tachesVisibles = (taches, { montrerTerminees = false } = {}) =>
  (taches || []).filter(t => montrerTerminees || t.etat !== "terminee");

// Compteurs d'un lot / d'un ouvrage (tâches à faire).
export function aFaire(taches) {
  return (taches || []).filter(t => t.etat !== "terminee").length;
}

// Recherche sur tout le phasage du chantier : nom affiché, nom du devis,
// ouvrage (accents et casse ignorés).
export function rechercher(arbre, texte, { montrerTerminees = false } = {}) {
  const q = norm(texte);
  if (!q) return [];
  const mots = q.split(" ").filter(Boolean);
  return tachesVisibles(arbre?.taches, { montrerTerminees })
    .filter(t => {
      const h = norm(`${t.nomAffiche} ${t.nomDevis} ${t.ouvrageLibelle}`);
      return mots.every(m => h.includes(m));
    });
}

// Navigation par pièce : [{ id, nom, taches }] dans l'ordre des pièces, puis
// « Sans pièce » s'il en reste.
export function parPiece(arbre, { montrerTerminees = false } = {}) {
  const taches = tachesVisibles(arbre?.taches, { montrerTerminees });
  const out = (arbre?.pieces || []).map(p => ({ id: p.id, nom: p.nom, taches: taches.filter(t => t.pieceId === p.id) }));
  const connues = new Set(out.map(p => p.id));
  const sans = taches.filter(t => !t.pieceId || !connues.has(t.pieceId));
  if (sans.length) out.push({ id: SANS_PIECE, nom: "Sans pièce", taches: sans });
  return out.filter(p => p.taches.length > 0);
}

// Sélection multiple : bascule d'une tâche.
export function basculerSelection(selection, id) {
  const s = new Set(selection || []);
  if (s.has(String(id))) s.delete(String(id)); else s.add(String(id));
  return [...s];
}
