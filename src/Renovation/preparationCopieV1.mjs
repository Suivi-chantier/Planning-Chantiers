// ─────────────────────────────────────────────────────────────────────────────
// Préparer le chantier — tranche 3 : copie depuis un autre logement de la même
// opération (étape « Point de départ »).
// Module PUR (façade preparationCopieV1.js) : aucun accès Supabase, aucune
// horloge, aucun effet de bord. Les phasages source, les identifiants neufs et
// la date arrivent en paramètre.
//
// Ce que fait la copie (fichier projet docs/projets/preparer-le-chantier.md) :
//   - pièces copiées avec de NOUVEAUX identifiants (une pièce du même nom déjà
//     présente dans le logement cible est réutilisée) ;
//   - consignes (pièce et murs) copiées si cochées ; photos seulement si
//     cochées (mêmes chemins dans le bucket « photos », mêmes fichiers) ;
//   - la répartition n'est JAMAIS appliquée ici : elle devient une
//     PROPOSITION par ouvrage, rangée dans meta.preparation.propositions, que
//     le conducteur vérifie et valide ouvrage par ouvrage à l'étape « Où se
//     fait chaque ouvrage » (même chemin que la saisie à la main, donc
//     decouperOuvrage → dupliquerTacheParPieces, totaux conservés) ;
//   - aucune tâche n'est modifiée par la copie : ni avancement, ni heures
//     pointées, ni heures réelles, ni quantité terminée, ni ouvriers ne
//     peuvent donc être copiés.
//
// Format d'une proposition (clé = id de l'ouvrage CIBLE) :
//   { mode: "plusieurs", lignes: [{ piece_id, mur, quantite }], granularites: { tache_id: "piece"|"mur" }, source }
//   { mode: "piece", pieceId, source }
//   { mode: "logement", source }
//   source = { chantier_id, ouvrage_id, correspondance: "bibliotheque" | "libelle" }
// ─────────────────────────────────────────────────────────────────────────────
import { prorata, ouvrageDejaDecoupe, preparationDuPhasage, tacheCommencee, GRANULARITE_MUR, GRANULARITE_PIECE } from "./preparationChantierV1.mjs";
import { piecesDuPhasage } from "./piecesPhasageV1.mjs";

const net = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const liste = (v) => (Array.isArray(v) ? v : []);
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const present = (v) => v != null && v !== "" && v !== false;
// Libellé normalisé : espaces regroupés, casse ignorée.
export const libelleNormalise = (s) => net(s).toLowerCase();

// ── Options de copie ────────────────────────────────────────────────────────
// Photos décochées par défaut (un plan est propre à chaque logement).
export const OPTIONS_DEFAUT = { pieces: true, repartition: true, consignes: true, photos: false };
// Dépendances : répartition, consignes et photos visent des pièces → les
// cocher coche les pièces ; décocher les pièces décoche tout le reste.
export function basculerOption(options, cle, valeur) {
  const o = { ...OPTIONS_DEFAUT, ...(options || {}), [cle]: !!valeur };
  if (cle === "pieces" && !valeur) { o.repartition = false; o.consignes = false; o.photos = false; }
  if (cle !== "pieces" && valeur) o.pieces = true;
  return o;
}

// ── Logements proposés ──────────────────────────────────────────────────────
// sources : [{ chantier_id, nom, meta, ouvrages }] (logements de la même
// opération, hors logement cible). Retenus : préparation terminée
// (meta.preparation.terminee). Si AUCUN n'a ce repère (préparations faites
// avant la tranche 2a), repli : des pièces ET au moins un ouvrage placé
// (ouvrages_places non vide ou un ouvrage déjà découpé).
export function preparationFaite(source) {
  return preparationDuPhasage(source?.meta).terminee === true;
}
export function preparationPartielle(source) {
  if (!piecesDuPhasage(source?.meta).length) return false;
  if (preparationDuPhasage(source?.meta).ouvrages_places.length) return true;
  return liste(source?.ouvrages).some(o => ouvrageDejaDecoupe(o));
}
export function logementsSources(sources) {
  const L = liste(sources).filter(s => s && s.chantier_id);
  const faits = L.filter(preparationFaite);
  if (faits.length) return { critere: "terminee", logements: faits };
  return { critere: "partielle", logements: L.filter(preparationPartielle) };
}

// ── Correspondance des ouvrages ─────────────────────────────────────────────
// Pour chaque ouvrage cible : d'abord par bibliotheque_id, puis à défaut par
// libellé identique (normalisé). Une correspondance n'est retenue que si elle
// est UNIQUE dans les deux sens (un seul candidat source, et ce candidat ne
// correspond qu'à cet ouvrage cible). Sinon : pas de correspondance (« À
// placer »), avec la raison "ambigu" (plusieurs candidats) ou "aucune".
// Renvoie [{ cible_id, source_id|null, par: "bibliotheque"|"libelle"|null, raison? }].
export function correspondanceOuvrages(ouvragesSource, ouvragesCible) {
  const S = liste(ouvragesSource), C = liste(ouvragesCible);
  const pris = new Set();
  const res = new Map();
  const passe = (cle, par) => {
    const parCle = (L) => {
      const m = new Map();
      L.forEach(o => { const k = cle(o); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
      return m;
    };
    const libresS = S.filter(o => !pris.has(String(o.id)));
    const libresC = C.filter(o => !res.has(String(o.id)) || res.get(String(o.id)).source_id == null);
    const mS = parCle(libresS), mC = parCle(libresC);
    libresC.forEach(o => {
      const k = cle(o);
      if (!k) return;
      const cands = mS.get(k) || [];
      if (cands.length === 1 && (mC.get(k) || []).length === 1) {
        res.set(String(o.id), { cible_id: o.id, source_id: cands[0].id, par });
        pris.add(String(cands[0].id));
      } else if (cands.length >= 1 && !res.has(String(o.id))) {
        res.set(String(o.id), { cible_id: o.id, source_id: null, par: null, raison: "ambigu" });
      }
    });
  };
  passe(o => net(o?.bibliotheque_id), "bibliotheque");
  passe(o => libelleNormalise(o?.libelle), "libelle");
  return C.map(o => res.get(String(o.id)) || { cible_id: o.id, source_id: null, par: null, raison: "aucune" });
}

// ── Correspondance des tâches (granularité) ─────────────────────────────────
// Les tâches source d'un ouvrage découpé sont regroupées par nom de
// bibliothèque (`nom`). Une tâche cible trouve son groupe par `nom`, puis à
// défaut par libellé (nom_perso sans le suffixe « — pièce », casse et espaces
// ignorés). Deux tâches cible de même clé → ambigu → pas de correspondance
// (granularité par défaut). Granularité reprise : « par mur » si une part du
// groupe porte un mur, sinon « par pièce ».
const libelleTache = (t) => libelleNormalise(String(net(t?.nom_perso) || net(t?.nom)).split(" — ")[0]);
export function granularitesReprises(ouvrageSource, ouvrageCible) {
  const groupes = (cle) => {
    const m = new Map();
    liste(ouvrageSource?.taches).forEach(t => { const k = cle(t); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    return m;
  };
  const parNom = groupes(t => net(t?.nom));
  const parLib = groupes(libelleTache);
  const compte = (cle) => {
    const m = new Map();
    liste(ouvrageCible?.taches).forEach(t => { const k = cle(t); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const nbNom = compte(t => net(t?.nom)), nbLib = compte(libelleTache);
  const out = {};
  liste(ouvrageCible?.taches).forEach(t => {
    let g = null;
    const kn = net(t?.nom), kl = libelleTache(t);
    if (kn && nbNom.get(kn) === 1 && parNom.has(kn)) g = parNom.get(kn);
    else if (kl && nbLib.get(kl) === 1 && parLib.has(kl)) g = parLib.get(kl);
    if (!g) return;
    out[String(t.id)] = g.some(x => net(x?.mur)) ? GRANULARITE_MUR : GRANULARITE_PIECE;
  });
  return out;
}

// ── Répartition source et proportion ────────────────────────────────────────
// Lignes { piece_id, mur, quantite } d'un ouvrage source déjà découpé : lues
// sur la tâche la plus finement découpée (même lecture que repartitionActuelle).
export function lignesSource(ouvrage) {
  const groupes = new Map();
  liste(ouvrage?.taches).forEach(t => {
    if (!present(t?.quantite_part)) return;
    const k = net(t.nom);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(t);
  });
  let meilleur = [];
  groupes.forEach(g => { if (g.length > meilleur.length) meilleur = g; });
  return meilleur.map(t => ({ piece_id: net(t.piece_id), mur: net(t.mur), quantite: r2(num(t.quantite_part)) }));
}

// Lignes ramenées à la quantité cible, EN PROPORTION : arrondi au centième,
// la dernière ligne absorbe l'écart, somme = quantité cible. null si la
// quantité cible est absente (pas de répartition par m² possible) ou si la
// source n'a pas de quantité.
export function lignesEnProportion(lignes, quantiteCible) {
  const L = liste(lignes).filter(l => num(l?.quantite) > 0);
  const Qt = num(quantiteCible);
  if (!(Qt > 0) || !L.length) return null;
  const q = prorata(Qt, L.map(l => l.quantite));
  return L.map((l, i) => ({ piece_id: l.piece_id, mur: net(l.mur), quantite: q[i] })).filter(l => l.quantite > 0);
}

// ── Pièces ──────────────────────────────────────────────────────────────────
// Copie des pièces source dans le logement cible.
//   nouveauxIds : identifiants neufs, consommés dans l'ordre (un par pièce
//                 source qui n'existe pas déjà dans la cible) ;
//   options     : { consignes, photos }.
// Une pièce cible de même nom (casse et espaces ignorés) est réutilisée : elle
// garde ses consignes / photos et ne reçoit celles de la source que si elle
// n'en a pas. Renvoie { pieces, correspondance: { ancien_id: nouvel_id } }.
const memeNom = (a, b) => libelleNormalise(a) === libelleNormalise(b);
export function copierPieces(piecesSource, piecesCible, nouveauxIds, { consignes = true, photos = false } = {}) {
  const src = piecesDuPhasage({ pieces: piecesSource });
  const out = piecesDuPhasage({ pieces: piecesCible }).map(p => ({ ...p }));
  const ids = [...liste(nouveauxIds)];
  const correspondance = {};
  const extras = (p) => {
    const e = {};
    if (consignes) {
      if (net(p.consigne)) e.consigne = String(p.consigne);
      const murs = liste(p.consignes_murs).filter(c => net(c?.mur) && net(c?.texte)).map(c => ({ mur: net(c.mur), texte: String(c.texte) }));
      if (murs.length) e.consignes_murs = murs;
    }
    if (photos) {
      const ph = [...new Set(liste(p.photos).map(net).filter(Boolean))];
      if (ph.length) e.photos = ph;
    }
    return e;
  };
  for (const p of src) {
    const existante = out.find(x => memeNom(x.nom, p.nom));
    const e = extras(p);
    if (existante) {
      correspondance[p.id] = existante.id;
      if (e.consigne && !net(existante.consigne)) existante.consigne = e.consigne;
      if (e.consignes_murs && !liste(existante.consignes_murs).length) existante.consignes_murs = e.consignes_murs;
      if (e.photos && !liste(existante.photos).length) existante.photos = e.photos;
      continue;
    }
    const id = net(ids.shift());
    if (!id) return { ok: false, erreur: "Identifiants manquants." };
    if (out.some(x => x.id === id)) return { ok: false, erreur: "Identifiant déjà utilisé." };
    correspondance[p.id] = id;
    out.push({ id, nom: p.nom, ...e });
  }
  return { ok: true, pieces: out, correspondance };
}
// Nombre d'identifiants neufs nécessaires pour copierPieces.
export function compterPiecesACreer(piecesSource, piecesCible) {
  const cible = piecesDuPhasage({ pieces: piecesCible });
  return piecesDuPhasage({ pieces: piecesSource }).filter(p => !cible.some(x => memeNom(x.nom, p.nom))).length;
}

// ── Proposition pour un ouvrage ─────────────────────────────────────────────
// Lue sur l'ouvrage source, traduite pour l'ouvrage cible (pièces
// renommées par la table de correspondance). null si rien à proposer,
// avec la raison dans { raison }.
function propositionPour(oS, oC, { prepSource, correspondance }) {
  const map = (id) => correspondance[net(id)] || null;
  const places = new Set(prepSource.ouvrages_places);
  const logement = new Set(liste(prepSource.ouvrages_logement).map(String));
  if (ouvrageDejaDecoupe(oS)) {
    const L = lignesSource(oS);
    if (!L.length) return { raison: "source_sans_repartition" };
    if (L.some(l => !map(l.piece_id))) return { raison: "piece_source_inconnue" };
    const prop = lignesEnProportion(L.map(l => ({ ...l, piece_id: map(l.piece_id) })), oC?.quantite);
    if (!prop) return { raison: "quantite_cible_absente" };
    return { mode: "plusieurs", lignes: prop, granularites: granularitesReprises(oS, oC) };
  }
  if (places.has(String(oS.id)) && logement.has(String(oS.id))) return { mode: "logement" };
  // « Une seule pièce » : toutes les tâches de la source dans une même pièce
  // connue (l'état d'avancement de la source n'a pas d'importance ici, et les
  // heures pointées passées en paramètre sont celles du logement CIBLE).
  const taches = liste(oS.taches);
  const ids = [...new Set(taches.map(t => net(t.piece_id)))];
  if (taches.length && ids.length === 1 && ids[0] && map(ids[0])) return { mode: "piece", pieceId: map(ids[0]) };
  return { raison: "source_non_placee" };
}

// ── Copie complète ──────────────────────────────────────────────────────────
// source : { chantier_id, nom, meta, ouvrages } ; cible : { meta, ouvrages }.
// options : { pieces, repartition, consignes, photos } ; nouveauxIds : ids de pièces neufs.
// Renvoie {
//   ok, pieces (liste complète à écrire dans meta.pieces), correspondancePieces,
//   propositions ({ ouvrageCibleId: proposition }), ouvrages: [{ cible_id, source_id, par, proposition|null, raison }],
//   resume: { pieces, propositions, sansCorrespondance, ambigus, parBibliotheque, parLibelle }
// }
// Aucune tâche cible n'est modifiée : les ouvrages ne font pas partie du résultat.
// Ouvrage cible ignoré (raison) : déjà découpé, déjà placé, ou toutes ses tâches commencées.
export function copierPreparation(source, cible, { options = OPTIONS_DEFAUT, nouveauxIds = [], heuresPointees } = {}) {
  const opt = basculerOption(options, "pieces", options?.pieces !== false);
  const prepCible = preparationDuPhasage(cible?.meta);
  const piecesCible = piecesDuPhasage(cible?.meta);
  if (!opt.pieces) {
    return { ok: true, pieces: piecesCible, correspondancePieces: {}, propositions: {}, ouvrages: [], resume: { pieces: 0, propositions: 0, sansCorrespondance: 0, ambigus: 0, parBibliotheque: 0, parLibelle: 0 } };
  }
  const cp = copierPieces(piecesDuPhasage(source?.meta), piecesCible, nouveauxIds, { consignes: opt.consignes, photos: opt.photos });
  if (!cp.ok) return cp;
  const prepSource = preparationDuPhasage(source?.meta);
  const corr = correspondanceOuvrages(source?.ouvrages, cible?.ouvrages);
  const parId = new Map(liste(source?.ouvrages).map(o => [String(o.id), o]));
  const propositions = {};
  const ouvrages = liste(cible?.ouvrages).map((oC, i) => {
    const c = corr[i];
    const base = { cible_id: oC.id, source_id: c.source_id, par: c.par, proposition: null, raison: c.raison || null };
    if (!opt.repartition || c.source_id == null) return base;
    if (ouvrageDejaDecoupe(oC)) return { ...base, raison: "cible_deja_decoupee" };
    if (prepCible.ouvrages_places.includes(String(oC.id))) return { ...base, raison: "cible_deja_placee" };
    const taches = liste(oC.taches);
    if (taches.length && taches.every(t => tacheCommencee(t, heuresPointees))) return { ...base, raison: "cible_commencee" };
    const p = propositionPour(parId.get(String(c.source_id)), oC, { prepSource, correspondance: cp.correspondance });
    if (!p || p.raison) return { ...base, raison: p?.raison || "rien" };
    const prop = { ...p, source: { chantier_id: source?.chantier_id ?? null, ouvrage_id: c.source_id, correspondance: c.par } };
    propositions[String(oC.id)] = prop;
    return { ...base, proposition: prop };
  });
  const resume = {
    pieces: cp.pieces.length,
    propositions: Object.keys(propositions).length,
    parBibliotheque: corr.filter(c => c.par === "bibliotheque").length,
    parLibelle: corr.filter(c => c.par === "libelle").length,
    ambigus: corr.filter(c => c.raison === "ambigu").length,
    sansCorrespondance: corr.filter(c => c.source_id == null).length,
  };
  return { ok: true, pieces: cp.pieces, correspondancePieces: cp.correspondance, propositions, ouvrages, resume };
}

// Résumé d'un logement source pour sa carte (« N pièces · N ouvrages
// répartis · N consignes », « ouvrages identiques au devis : N sur M »).
export function resumeSource(source, ouvragesCible) {
  const pieces = piecesDuPhasage(source?.meta);
  const prep = preparationDuPhasage(source?.meta);
  const repartis = liste(source?.ouvrages).filter(o => prep.ouvrages_places.includes(String(o.id)) || ouvrageDejaDecoupe(o)).length;
  const consignes = pieces.reduce((s, p) => s + (net(p.consigne) ? 1 : 0) + liste(p.consignes_murs).filter(c => net(c?.texte)).length, 0);
  const photos = pieces.reduce((s, p) => s + liste(p.photos).filter(net).length, 0);
  const corr = correspondanceOuvrages(source?.ouvrages, ouvragesCible);
  return { pieces: pieces.length, repartis, consignes, photos, identiques: corr.filter(c => c.source_id != null).length, totalCible: liste(ouvragesCible).length };
}

// ── Propositions dans meta.preparation ──────────────────────────────────────
export function propositionsDe(preparation) {
  const p = preparation?.propositions;
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}
// Proposition utilisable pour un ouvrage : toutes ses pièces existent encore.
export function propositionPourOuvrage(preparation, ouvrageId, pieces) {
  const p = propositionsDe(preparation)[String(ouvrageId)];
  if (!p || typeof p !== "object") return null;
  const connues = new Set(liste(pieces).map(x => String(x.id)));
  if (p.mode === "plusieurs") {
    const L = liste(p.lignes);
    if (!L.length || L.some(l => !connues.has(String(l?.piece_id)))) return null;
    return p;
  }
  if (p.mode === "piece") return connues.has(String(p.pieceId)) ? p : null;
  if (p.mode === "logement") return p;
  return null;
}
// Retire la proposition d'un ouvrage (après sa validation), le reste conservé.
export function retirerProposition(preparation, ouvrageId) {
  const props = { ...propositionsDe(preparation) };
  if (!(String(ouvrageId) in props)) return preparation;
  delete props[String(ouvrageId)];
  return { ...preparation, propositions: props };
}
// Préparation après la copie : propositions et trace de la copie ajoutées
// (étape, date et auteur ajoutés ensuite par l'écran via majPreparation).
export function preparationApresCopie(preparation, copie, { source, options, le } = {}) {
  const p = preparationDuPhasage({ preparation });
  return {
    ...p,
    propositions: { ...propositionsDe(p), ...(copie?.propositions || {}) },
    copie: { depuis: source?.chantier_id ?? null, nom: source?.nom ?? null, options: { ...options }, le: le ?? null },
  };
}
