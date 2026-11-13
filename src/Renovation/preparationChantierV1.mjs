// ─────────────────────────────────────────────────────────────────────────────
// Préparer le chantier (parcours guidé par logement) — moteur de la tranche 1.
// Module PUR (façade preparationChantierV1.js) : aucun accès Supabase, aucune
// horloge, aucun effet de bord. Les identifiants neufs, l'horodatage et
// l'utilisateur arrivent en paramètre.
//
// Stockage (aucune migration, tout dans le JSON du phasage) :
//   plan_travaux.meta.pieces            = [{ id, nom }]        (piecesPhasageV1)
//   plan_travaux.meta.preparation       = { etape, maj_le, par, ouvrages_places: [id] }
//   tâche.piece_id / .mur / .quantite_part / .nom_perso       (au découpage)
//
// Règles (fichier projet docs/projets/preparer-le-chantier.md) :
//   - une tâche commencée (avancement > 0, quantite_terminee présent, heures
//     pointées) n'est JAMAIS modifiée : elle est rendue telle quelle et
//     signalée « déjà commencée, non découpée » ;
//   - le découpage passe par dupliquerTacheParPieces (piecesPhasageV1) ;
//   - pour chaque ouvrage, la somme des heures estimées, des heures vendues et
//     des ratios est identique avant / après, au centième (refus sinon) ;
//   - on ne touche jamais à `nom` : le libellé lisible passe par `nom_perso`.
// ─────────────────────────────────────────────────────────────────────────────
import { dupliquerTacheParPieces, rattacherTaches } from "./piecesPhasageV1.mjs";
import { nomAffiche } from "./phasageMobileV1.mjs";
import { tacheHeuresReelles, sumHeures } from "../chantierFinance.mjs";

const net = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const liste = (v) => (Array.isArray(v) ? v : []);
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const sansAccent = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const present = (v) => v != null && v !== "" && v !== false;

// ── Étapes du parcours ──────────────────────────────────────────────────────
export const ETAPES = [
  { id: "depart", label: "Point de départ" },
  { id: "pieces", label: "Les pièces" },
  { id: "repartition", label: "Où se fait chaque ouvrage" },
  { id: "consignes", label: "Consignes & plans" },
];
export const ETAPE_PAR_DEFAUT = "pieces";

// Pièces proposées en ajout rapide (ordre de la maquette validée).
export const PIECES_RAPIDES = ["Entrée", "Séjour / cuisine", "Chambre", "Chambre 2", "Salle d'eau", "WC", "Dégagement", "Placard", "Cellier"];

// Préparation propre lue dans meta (champs inconnus conservés).
export function preparationDuPhasage(meta) {
  const p = meta?.preparation && typeof meta.preparation === "object" ? meta.preparation : {};
  return { ...p, ouvrages_places: [...new Set(liste(p.ouvrages_places).map(String))] };
}

// Étape à rouvrir : celle enregistrée si elle fait partie des étapes
// disponibles, sinon la première disponible (ou « Les pièces »).
export function etapeReprise(meta, disponibles = ETAPES.map(e => e.id)) {
  const e = net(meta?.preparation?.etape);
  if (e && disponibles.includes(e)) return e;
  return disponibles.includes(ETAPE_PAR_DEFAUT) ? ETAPE_PAR_DEFAUT : (disponibles[0] || ETAPE_PAR_DEFAUT);
}

// Nouvelle valeur de meta.preparation à l'enregistrement : étape, horodatage
// et auteur fournis par l'appelant ; le reste (ouvrages placés…) conservé.
export function majPreparation(preparation, { etape, maj_le, par } = {}) {
  const p = preparation && typeof preparation === "object" ? preparation : {};
  return { ...p, etape: net(etape) || ETAPE_PAR_DEFAUT, maj_le: maj_le ?? null, par: par ?? null };
}

// mode (facultatif, tranche 2a) : "logement" note l'ouvrage dans
// ouvrages_logement (choix « Tout le logement », lu par le contrôle final) ;
// un autre mode l'en retire. Sans mode, ouvrages_logement n'est pas touché.
export function marquerOuvragePlace(preparation, ouvrageId, mode) {
  const p = preparationDuPhasage({ preparation });
  const id = String(ouvrageId);
  const out = p.ouvrages_places.includes(id) ? p : { ...p, ouvrages_places: [...p.ouvrages_places, id] };
  if (mode == null) return out;
  const logement = ouvragesLogement(p).filter(x => x !== id);
  return { ...out, ouvrages_logement: mode === "logement" ? [...logement, id] : logement };
}
export function retirerOuvragePlace(preparation, ouvrageId) {
  const p = preparationDuPhasage({ preparation });
  const out = { ...p, ouvrages_places: p.ouvrages_places.filter(x => x !== String(ouvrageId)) };
  if (Array.isArray(p.ouvrages_logement)) out.ouvrages_logement = ouvragesLogement(p).filter(x => x !== String(ouvrageId));
  return out;
}
const ouvragesLogement = (p) => [...new Set(liste(p?.ouvrages_logement).map(String))];

// ── Tâche commencée ─────────────────────────────────────────────────────────
// heuresPointeesParTache (facultatif) : { tache_id: heures } ou Map, ou
// l'index { tache_id: [pointages] } de chantierFinance.indexPointagesParTache.
// Sans registre, repli sur t.heures_reelles (même lecture que chantierFinance).
export function heuresPointeesTache(t, heuresPointeesParTache) {
  const k = String(t?.id ?? "");
  const v = heuresPointeesParTache instanceof Map ? heuresPointeesParTache.get(k) : heuresPointeesParTache?.[k];
  const registre = Array.isArray(v) ? sumHeures(v) : num(v);
  return Math.max(registre, tacheHeuresReelles(t || {}, null));
}
export function tacheCommencee(t, heuresPointeesParTache) {
  if (!t) return false;
  if (num(t.avancement) > 0) return true;
  if (present(t.quantite_terminee)) return true;
  return heuresPointeesTache(t, heuresPointeesParTache) > 0;
}

// ── Granularité par défaut d'une tâche ──────────────────────────────────────
// « par pièce » pour les finitions qui se font pièce par pièce, sinon « par mur ».
export const GRANULARITE_PIECE = "piece";
export const GRANULARITE_MUR = "mur";
const MOTS_PAR_PIECE = /(^|[^a-z])(bande|passe|enduit|poncage|peinture|impression)/;
export function granulariteParDefaut(t) {
  return MOTS_PAR_PIECE.test(sansAccent(`${t?.nom_perso ?? ""} ${t?.nom ?? ""}`)) ? GRANULARITE_PIECE : GRANULARITE_MUR;
}
const granulariteDe = (t, granularites) => {
  const g = granularites instanceof Map ? granularites.get(String(t.id)) : granularites?.[String(t.id)];
  return g === GRANULARITE_PIECE || g === GRANULARITE_MUR ? g : granulariteParDefaut(t);
};

// ── Totaux d'un ouvrage (garantie de conservation) ──────────────────────────
export function totauxOuvrage(ouvrage) {
  const t = liste(ouvrage?.taches);
  const s = (k) => r2(t.reduce((a, x) => a + num(x?.[k]), 0));
  return { heures_estimees: s("heures_estimees"), heures_vendues: s("heures_vendues"), ratio: s("ratio") };
}
const memesTotaux = (a, b) => ["heures_estimees", "heures_vendues", "ratio"].every(k => Math.abs(a[k] - b[k]) < 0.005);

// ── État d'un ouvrage et compteur ───────────────────────────────────────────
//   place          : marqué placé dans meta.preparation.ouvrages_places ;
//   deja_commence  : toutes ses tâches sont commencées (rien à découper) ;
//   en_cours       : ouvert à l'écran, ou une partie de ses tâches a déjà une pièce ;
//   a_placer       : le reste.
export const ETATS_OUVRAGE = { a_placer: "À placer", en_cours: "En cours", place: "Placé", deja_commence: "Déjà commencé" };

// Ouvrage déjà découpé par un passage précédent : au moins une tâche porte
// une part de quantité (quantite_part) ou un mur. Il est considéré « Placé »
// et n'est jamais redécoupé part par part (les parts ont déjà leurs heures).
// Un simple libellé personnalisé (nom_perso) ne suffit pas : il peut avoir
// été saisi à la main dans Phasage V2.
export function ouvrageDejaDecoupe(ouvrage) {
  return liste(ouvrage?.taches).some(t => present(t?.quantite_part) || net(t?.mur));
}

export function etatOuvrage(ouvrage, { preparation, heuresPointees, enCoursId } = {}) {
  const places = preparationDuPhasage({ preparation }).ouvrages_places;
  if (places.includes(String(ouvrage?.id))) return "place";
  if (ouvrageDejaDecoupe(ouvrage)) return "place";
  const taches = liste(ouvrage?.taches);
  const libres = taches.filter(t => !tacheCommencee(t, heuresPointees));
  if (taches.length > 0 && libres.length === 0) return "deja_commence";
  if (enCoursId != null && String(enCoursId) === String(ouvrage?.id)) return "en_cours";
  if (libres.some(t => net(t.piece_id))) return "en_cours";
  return "a_placer";
}
// « X / N placés » : les ouvrages entièrement commencés ne comptent pas
// (il n'y a rien à y placer).
export function compteurPlaces(ouvrages, opts = {}) {
  const etats = liste(ouvrages).map(o => etatOuvrage(o, opts));
  const aTraiter = etats.filter(e => e !== "deja_commence");
  const places = aTraiter.filter(e => e === "place").length;
  return { places, total: aTraiter.length, dejaCommences: etats.length - aTraiter.length, libelle: `${places} / ${aTraiter.length} placés` };
}

// ── Reste à placer ──────────────────────────────────────────────────────────
// total null = l'ouvrage n'a pas de quantité au devis : le reste est inconnu,
// jamais affiché comme « 0 ».
export function resteAPlacer(ouvrage, lignes) {
  const total = num(ouvrage?.quantite) > 0 ? r2(num(ouvrage.quantite)) : null;
  const place = r2(liste(lignes).reduce((s, l) => s + Math.max(0, num(l?.quantite)), 0));
  return { total, place, reste: total == null ? null : r2(total - place), unite: net(ouvrage?.unite) };
}

// ── Découpage ───────────────────────────────────────────────────────────────
// Parts d'une tâche selon sa granularité. « mur » : une part par couple
// pièce + mur (lignes identiques fusionnées) ; « pièce » : une part par
// pièce, quantités additionnées, sans mur. Ordre : première apparition.
function partsPour(lignes, granularite) {
  const parts = [];
  const index = new Map();
  for (const l of lignes) {
    const mur = granularite === GRANULARITE_MUR ? net(l.mur) : "";
    const k = `${l.piece_id}\u0000${mur.toLowerCase()}`;
    if (!index.has(k)) { index.set(k, parts.length); parts.push({ piece_id: l.piece_id, mur, quantite: 0 }); }
    parts[index.get(k)].quantite += num(l.quantite);
  }
  return parts.map(p => ({ ...p, quantite: r2(p.quantite) }));
}
// Heures au prorata des quantités, au centième, la dernière part absorbe l'arrondi.
export function prorata(total, quantites) {
  const T = r2(num(total));
  const Q = quantites.reduce((s, q) => s + num(q), 0);
  if (!quantites.length) return [];
  const out = quantites.map(q => (Q > 0 ? r2(T * num(q) / Q) : 0));
  out[out.length - 1] = r2(T - out.slice(0, -1).reduce((s, x) => s + x, 0));
  return out;
}

function lignesPropres(lignes) {
  return liste(lignes)
    .map(l => ({ piece_id: net(l?.piece_id), mur: net(l?.mur), quantite: r2(num(l?.quantite)) }))
    .filter(l => l.piece_id && l.quantite > 0);
}
const nomPiece = (pieces, id) => net(liste(pieces).find(p => String(p.id) === String(id))?.nom);
const libellePart = (t, piece, mur) => `${nomAffiche(t)} — ${piece}${mur ? `, ${mur}` : ""}`;

// Nombre d'identifiants neufs nécessaires pour découper un ouvrage.
export function compterIdsNecessaires(ouvrage, lignes, { granularites, heuresPointees } = {}) {
  const L = lignesPropres(lignes);
  return liste(ouvrage?.taches).reduce((s, t) => (tacheCommencee(t, heuresPointees)
    ? s : s + Math.max(0, partsPour(L, granulariteDe(t, granularites)).length - 1)), 0);
}

// Découpe un ouvrage à partir de lignes { piece_id, mur?, quantite }.
//   opts.pieces          : meta.pieces (noms des pièces, pièces connues) ;
//   opts.granularites    : { tache_id: "piece" | "mur" } (sinon défaut) ;
//   opts.heuresPointees  : voir tacheCommencee ;
//   opts.nouveauxIds     : ids neufs, consommés dans l'ordre (compterIdsNecessaires).
// Renvoie { ok, ouvrage, nonDecoupees: [{ id, nom }], creees: [ids], erreur? }.
// L'ouvrage d'entrée n'est jamais modifié.
export function decouperOuvrage(ouvrage, lignes, { pieces, granularites, heuresPointees, nouveauxIds = [] } = {}) {
  const L = lignesPropres(lignes);
  if (!L.length) return { ok: false, erreur: "Ajoute au moins une pièce avec une quantité." };
  const connues = new Set(liste(pieces).map(p => String(p.id)));
  const inconnue = L.find(l => !connues.has(l.piece_id));
  if (inconnue) return { ok: false, erreur: "Une ligne vise une pièce qui n'existe plus." };
  const r = resteAPlacer(ouvrage, L);
  if (r.total == null) return { ok: false, erreur: "L'ouvrage n'a pas de quantité au devis : choisis « Une seule pièce » ou « Tout le logement »." };
  if (Math.abs(r.reste) > 0.001) {
    return { ok: false, erreur: r.reste > 0 ? `Reste ${r.reste} ${r.unite} à placer.` : `${-r.reste} ${r.unite} de trop par rapport au devis.` };
  }

  const ids = [...liste(nouveauxIds)];
  const nonDecoupees = [];
  const creees = [];
  const taches = [];
  for (const t of liste(ouvrage?.taches)) {
    if (tacheCommencee(t, heuresPointees)) {
      nonDecoupees.push({ id: t.id, nom: nomAffiche(t) });
      taches.push(t);
      continue;
    }
    const parts = partsPour(L, granulariteDe(t, granularites));
    const heures = prorata(t.heures_estimees, parts.map(p => p.quantite));
    let resultat;
    if (parts.length === 1) {
      resultat = rattacherTaches([{ taches: [t] }], [t.id], parts[0].piece_id)[0].taches;
    } else {
      const besoin = parts.length - 1;
      if (ids.length < besoin) return { ok: false, erreur: "Identifiants manquants." };
      const res = dupliquerTacheParPieces(t, parts.map((p, i) => ({ piece_id: p.piece_id, heures: heures[i] })), ids.splice(0, besoin));
      if (!res.ok) return { ok: false, erreur: res.erreur };
      resultat = res.taches;
      // Tâche sans heures estimées (base d'heures de l'ouvrage en ratio) :
      // dupliquerTacheParPieces partage alors à parts égales ; on reporte le
      // partage au prorata des quantités, avec le même arrondi (total inchangé).
      if (!(num(t.heures_estimees) > 0)) {
        const q = parts.map(p => p.quantite);
        ["heures_vendues", "ratio"].forEach(k => {
          if (!present(t[k])) return;
          const v = prorata(t[k], q);
          resultat = resultat.map((x, i) => ({ ...x, [k]: v[i] }));
        });
      }
      creees.push(...resultat.slice(1).map(x => x.id));
    }
    resultat.forEach((x, i) => {
      const p = parts[i];
      const part = { ...x, quantite_part: p.quantite, nom_perso: libellePart(t, nomPiece(pieces, p.piece_id), p.mur) };
      if (p.mur) part.mur = p.mur; else delete part.mur;
      taches.push(part);
    });
  }
  const apres = { ...ouvrage, taches };
  if (!memesTotaux(totauxOuvrage(ouvrage), totauxOuvrage(apres))) {
    return { ok: false, erreur: "Le découpage changerait les heures de l'ouvrage : rien n'est modifié." };
  }
  return { ok: true, ouvrage: apres, nonDecoupees, creees };
}

// Mode « une seule pièce » : toutes les tâches non commencées sont rattachées
// à la pièce (aucune copie, heures inchangées).
export function placerDansUnePiece(ouvrage, pieceId, { pieces, heuresPointees } = {}) {
  const id = net(pieceId);
  if (!id || !liste(pieces).some(p => String(p.id) === id)) return { ok: false, erreur: "Choisis une pièce." };
  const nonDecoupees = [];
  const libres = [];
  liste(ouvrage?.taches).forEach(t => (tacheCommencee(t, heuresPointees)
    ? nonDecoupees.push({ id: t.id, nom: nomAffiche(t) })
    : libres.push(t.id)));
  const [apres] = rattacherTaches([ouvrage], libres, id);
  return { ok: true, ouvrage: apres, nonDecoupees, creees: [] };
}

// Mode « tout le logement » : rien ne change (l'appelant marque l'ouvrage placé).
export function placerToutLeLogement(ouvrage, { heuresPointees } = {}) {
  const nonDecoupees = liste(ouvrage?.taches).filter(t => tacheCommencee(t, heuresPointees)).map(t => ({ id: t.id, nom: nomAffiche(t) }));
  return { ok: true, ouvrage, nonDecoupees, creees: [] };
}

// Aperçu « ce que verront les ouvriers » : les tâches de l'ouvrage après
// découpage, calculées sans rien modifier (ids provisoires).
export function apercuDecoupage(ouvrage, lignes, opts = {}) {
  const n = compterIdsNecessaires(ouvrage, lignes, opts);
  const provisoires = Array.from({ length: n }, (_, i) => `__apercu_${i + 1}`);
  const res = decouperOuvrage(ouvrage, lignes, { ...opts, nouveauxIds: provisoires });
  if (!res.ok) return { ok: false, erreur: res.erreur, taches: [] };
  const commencees = new Set(res.nonDecoupees.map(x => String(x.id)));
  const nouvelles = new Set(res.creees.map(String));
  return {
    ok: true,
    nonDecoupees: res.nonDecoupees,
    taches: res.ouvrage.taches.map(t => ({
      nom: nomAffiche(t),
      piece: nomPiece(opts.pieces, t.piece_id),
      mur: net(t.mur),
      quantite_part: t.quantite_part ?? null,
      heures: r2(num(t.heures_estimees)),
      nouvelle: nouvelles.has(String(t.id)),
      dejaCommencee: commencees.has(String(t.id)),
    })),
  };
}

// Aperçu pour les deux autres modes, même forme que apercuDecoupage.
//   mode "piece"    : opts.pieceId (toutes les tâches non commencées dans la pièce) ;
//   mode "logement" : rien ne change.
export const MODES = { piece: "Une seule pièce", logement: "Tout le logement", plusieurs: "Plusieurs pièces / murs" };
export function apercuPlacement(ouvrage, mode, opts = {}) {
  if (mode === "plusieurs") return apercuDecoupage(ouvrage, opts.lignes, opts);
  const res = mode === "piece" ? placerDansUnePiece(ouvrage, opts.pieceId, opts) : placerToutLeLogement(ouvrage, opts);
  if (!res.ok) return { ok: false, erreur: res.erreur, taches: [] };
  const commencees = new Set(res.nonDecoupees.map(x => String(x.id)));
  return {
    ok: true,
    nonDecoupees: res.nonDecoupees,
    taches: liste(res.ouvrage?.taches).map(t => ({
      nom: nomAffiche(t),
      piece: mode === "piece" ? nomPiece(opts.pieces, t.piece_id) : "",
      mur: "",
      quantite_part: null,
      heures: r2(num(t.heures_estimees)),
      nouvelle: false,
      dejaCommencee: commencees.has(String(t.id)),
    })),
  };
}

// Répartition actuelle d'un ouvrage déjà découpé (lecture seule) : on lit
// les parts de la tâche la plus finement découpée (celle qui a le plus de
// parts, à nom de bibliothèque identique) → [{ piece, mur, quantite }].
export function repartitionActuelle(ouvrage, pieces) {
  const groupes = new Map();
  liste(ouvrage?.taches).forEach(t => {
    if (!present(t?.quantite_part)) return;
    const k = net(t.nom);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(t);
  });
  let meilleur = [];
  groupes.forEach(g => { if (g.length > meilleur.length) meilleur = g; });
  return meilleur.map(t => ({ piece: nomPiece(pieces, t.piece_id) || "Pièce retirée", mur: net(t.mur), quantite: r2(num(t.quantite_part)) }));
}

// Raccourci « Mettre le reste dans… » : ajoute le reste à placer à la ligne
// sans mur de cette pièce (ou crée la ligne). Rien si le reste est nul,
// négatif ou inconnu.
export function mettreLeResteDans(ouvrage, lignes, pieceId) {
  const L = liste(lignes);
  const { reste } = resteAPlacer(ouvrage, L);
  if (reste == null || reste <= 0 || !net(pieceId)) return L;
  const i = L.findIndex(l => String(l.piece_id) === String(pieceId) && !net(l.mur));
  if (i < 0) return [...L, { piece_id: String(pieceId), mur: "", quantite: reste }];
  return L.map((l, j) => (j === i ? { ...l, quantite: r2(num(l.quantite) + reste) } : l));
}

// Ouvrage suivant à ouvrir après une validation : le premier après le
// courant (en boucle) qui reste à traiter (ni placé, ni entièrement commencé).
// null quand tout est placé.
export function ouvrageSuivant(ouvrages, courantId, opts = {}) {
  const L = liste(ouvrages);
  const i = L.findIndex(o => String(o.id) === String(courantId));
  for (let k = 1; k <= L.length; k++) {
    const o = L[(i + k + L.length) % L.length];
    if (String(o.id) === String(courantId)) continue;
    const e = etatOuvrage(o, { ...opts, enCoursId: null });
    if (e === "a_placer" || e === "en_cours") return o;
  }
  return null;
}

// Remplace un ouvrage dans la liste (après découpage / placement).
export function remplacerOuvrage(ouvrages, ouvrage) {
  return liste(ouvrages).map(o => (String(o.id) === String(ouvrage?.id) ? ouvrage : o));
}

// Pièces retirées entre deux listes (pour détacher leurs tâches à l'enregistrement).
export function piecesRetirees(avant, apres) {
  const gardees = new Set(liste(apres).map(p => String(p.id)));
  return liste(avant).filter(p => !gardees.has(String(p.id))).map(p => String(p.id));
}

// ── Tranche 2a : étape « Consignes & plans » ────────────────────────────────
// Stockage dans chaque pièce de meta.pieces (les autres champs — id, nom… —
// sont toujours conservés) :
//   consigne        texte facultatif ;
//   consignes_murs  [{ mur, texte }] ;
//   photos          chemins dans le bucket Storage « photos ».
// Les fonctions ci-dessous rendent une NOUVELLE liste de pièces ; la liste
// d'entrée n'est jamais modifiée. Pendant la saisie, le texte est gardé tel
// quel (espaces compris) ; piecesPourEnregistrement le nettoie à l'écriture.
const memeMur = (a, b) => net(a).toLowerCase() === net(b).toLowerCase();
const majPiece = (pieces, pieceId, f) => liste(pieces).map(p => (String(p?.id) === String(pieceId) ? f(p) : p));

// Lecture propre des consignes d'une pièce.
export function consignesDePiece(piece) {
  const murs = [];
  liste(piece?.consignes_murs).forEach(c => {
    const mur = net(c?.mur);
    if (!mur || murs.some(m => memeMur(m.mur, mur))) return;
    murs.push({ mur, texte: String(c?.texte ?? "") });
  });
  const photos = [...new Set(liste(piece?.photos).map(x => net(x)).filter(Boolean))];
  return { consigne: String(piece?.consigne ?? ""), consignes_murs: murs, photos };
}

export function poserConsigne(pieces, pieceId, texte) {
  return majPiece(pieces, pieceId, p => ({ ...p, consigne: String(texte ?? "") }));
}

// Ajoute ou modifie la consigne d'un mur (mur reconnu sans tenir compte de
// la casse ni des espaces).
export function poserConsigneMur(pieces, pieceId, mur, texte) {
  const m = net(mur);
  if (!m) return liste(pieces);
  return majPiece(pieces, pieceId, p => {
    const murs = liste(p.consignes_murs);
    const i = murs.findIndex(c => memeMur(c?.mur, m));
    const next = i < 0
      ? [...murs, { mur: m, texte: String(texte ?? "") }]
      : murs.map((c, j) => (j === i ? { ...c, texte: String(texte ?? "") } : c));
    return { ...p, consignes_murs: next };
  });
}
export function retirerConsigneMur(pieces, pieceId, mur) {
  return majPiece(pieces, pieceId, p => ({ ...p, consignes_murs: liste(p.consignes_murs).filter(c => !memeMur(c?.mur, mur)) }));
}

export function ajouterPhoto(pieces, pieceId, chemin) {
  const c = net(chemin);
  if (!c) return liste(pieces);
  return majPiece(pieces, pieceId, p => (liste(p.photos).includes(c) ? p : { ...p, photos: [...liste(p.photos), c] }));
}
export function retirerPhoto(pieces, pieceId, chemin) {
  return majPiece(pieces, pieceId, p => ({ ...p, photos: liste(p.photos).filter(x => x !== chemin) }));
}

// Liste à écrire dans meta.pieces : textes nettoyés, consignes de mur vides
// retirées, champs vides supprimés (une pièce sans consigne reste { id, nom }),
// tous les autres champs conservés.
export function piecesPourEnregistrement(pieces) {
  return liste(pieces).map(p => {
    const { consigne, consignes_murs, photos } = consignesDePiece(p);
    const out = { ...p };
    delete out.consigne; delete out.consignes_murs; delete out.photos;
    const c = consigne.trim();
    if (c) out.consigne = c;
    const murs = consignes_murs.map(x => ({ mur: x.mur, texte: x.texte.trim() })).filter(x => x.texte);
    if (murs.length) out.consignes_murs = murs;
    if (photos.length) out.photos = photos;
    return out;
  });
}

// Murs proposés pour une pièce : ceux des tâches rattachées à la pièce
// (tache.mur), puis ceux qui ont déjà une consigne, sans doublon, dans
// l'ordre d'apparition.
export function mursDeLaPiece(ouvrages, piece) {
  const murs = [];
  const ajouter = (m) => { const x = net(m); if (x && !murs.some(y => memeMur(y, x))) murs.push(x); };
  liste(ouvrages).forEach(o => liste(o?.taches).forEach(t => { if (String(t?.piece_id ?? "") === String(piece?.id)) ajouter(t.mur); }));
  liste(piece?.consignes_murs).forEach(c => ajouter(c?.mur));
  return murs;
}

// Nombre de tâches rattachées à chaque pièce : { piece_id: n }.
export function nbTachesParPiece(ouvrages, pieces) {
  const n = Object.fromEntries(liste(pieces).map(p => [String(p.id), 0]));
  liste(ouvrages).forEach(o => liste(o?.taches).forEach(t => {
    const k = String(t?.piece_id ?? "");
    if (k in n) n[k] += 1;
  }));
  return n;
}

// Contrôle final « Toutes les tâches ont une pièce ».
// Une tâche a une pièce si son piece_id vise une pièce de la liste (une
// pièce retirée ne compte pas). Les tâches sans pièce sont rangées en deux
// listes, toutes deux affichées :
//   toutLeLogement : ouvrage placé avec le choix « Tout le logement »
//                    (preparation.ouvrages_logement) — c'est un choix du
//                    conducteur, pas une erreur ;
//   sansPiece      : toutes les autres (y compris une tâche déjà commencée
//                    restée sans pièce dans un ouvrage réparti, ou une tâche
//                    dont la pièce a été retirée). Un ouvrage placé sans que
//                    le choix soit noté n'est jamais deviné « tout le
//                    logement » : ses tâches restent signalées.
// etat : "aucune_tache" (phasage vide : rien à contrôler, jamais présenté
// comme « tout va bien »), "ok" (toutes ont une pièce), "logement" (pas
// d'oubli, mais des tâches pour tout le logement), "a_completer".
export function controleFinal(ouvrages, pieces, preparation) {
  const connues = new Set(liste(pieces).map(p => String(p.id)));
  const prep = preparationDuPhasage({ preparation });
  const places = new Set(prep.ouvrages_places);
  const logements = new Set(ouvragesLogement(prep));
  const aUnePiece = (t) => connues.has(String(t?.piece_id ?? ""));
  const sansPiece = [];
  const toutLeLogement = [];
  let total = 0;
  liste(ouvrages).forEach(o => {
    const taches = liste(o?.taches);
    total += taches.length;
    const logement = places.has(String(o?.id)) && logements.has(String(o?.id));
    taches.forEach(t => {
      if (aUnePiece(t)) return;
      const ligne = { id: t.id, nom: nomAffiche(t), ouvrage: net(o?.libelle || o?.code_ouvrage) || "Ouvrage sans nom", ouvrage_id: o?.id ?? null };
      (logement ? toutLeLogement : sansPiece).push(ligne);
    });
  });
  const etat = total === 0 ? "aucune_tache" : sansPiece.length ? "a_completer" : toutLeLogement.length ? "logement" : "ok";
  return { etat, total, sansPiece, toutLeLogement };
}

// « Terminer la préparation » : marque la préparation faite (utile à la
// copie depuis un autre logement), le reste conservé.
export function marquerPreparationTerminee(preparation) {
  return { ...preparationDuPhasage({ preparation }), terminee: true };
}
