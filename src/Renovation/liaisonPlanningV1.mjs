// ─────────────────────────────────────────────────────────────────────────────
// Lien entre une ligne du PLANNING et une tâche du PHASAGE (CR-6, partie 6C).
//
// Module PUR (façade liaisonPlanningV1.js) : aucun accès Supabase, aucune
// horloge, aucun effet de bord. Les données arrivent en paramètre.
//
// Une ligne du planning (planning_cells.taches[]) est liée quand elle porte un
// `tache_id`. Seule la saisie à la main dans la case du planning (« + Ajouter
// une tâche ») crée des lignes sans lien : le phasage (« Envoyer au
// planning »), « Planifier depuis le phasage », « Planifier une opération » et
// le moteur posent tous le lien (diagnostic 6C sur les vraies données).
//
// MÊME SERVICE des deux côtés : la proposition de tâche pour une ligne non liée
// est la MÊME fonction pour l'ouvrier (compte rendu, partie 6A — réexportée par
// compteRenduV3.mjs) et pour le bureau (planning) : propositionsLiaison.
//
// MÊME CHIFFRE : le compteur « X % des lignes de la semaine liées au phasage »
// est calculé ici (tauxLiaisonPlanning), pour la page du planning comme pour
// la page « Qualité des comptes rendus » (6E). Même fonction, même explication
// (EXPLICATION_TAUX_LIAISON).
// ─────────────────────────────────────────────────────────────────────────────
import { ressemblanceNomsV2 } from "./horsDevisV2.mjs";
import { construireArbre } from "./phasageMobileV1.mjs";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const net = (v) => String(v ?? "").trim();
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// ── Proposition de tâche (déplacée telle quelle depuis compteRenduV3, 6A) ───
// Score (0..1), du plus au moins important :
//   - ressemblance des noms (ressemblanceNomsV2, la même que la proposition du
//     cas A des tâches hors devis), nom personnalisé ou nom du devis : 45 % ;
//   - part des mots de la ligne retrouvés dans le nom de la tâche : 20 % ;
//   - part des mots retrouvés dans l'ouvrage, le lot ou la pièce : 10 % ;
//   - tâche pas encore terminée : 25 % (une ligne du planning porte sur du
//     travail à faire ; les terminées sont masquées dans le phasage).
// Les mots d'action du planning (« terminer », « finir », « continuer »…) ne
// comptent pas. Proposée seulement si les noms se ressemblent vraiment.
const MOTS_ACTION = new Set(["terminer", "termine", "terminee", "finir", "fini", "finie", "continuer", "commencer",
  "suite", "fin", "faire", "les", "des", "une", "pour", "avec", "dans", "sur", "aux", "par", "est"]);
const normLiaison = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const motsLiaison = (s) => normLiaison(s).split(" ").filter(m => m.length >= 3 && !MOTS_ACTION.has(m));
const motsProches = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
function couverture(mots, cible) {
  if (!mots.length) return 0;
  const b = motsLiaison(cible);
  return mots.filter(m => b.some(x => motsProches(m, x))).length / mots.length;
}

// Tâches du phasage à plat avec leur lot et leur pièce (arbre de phasageMobileV1).
export function tachesPourLiaison(arbre) {
  const pieces = new Map((arbre?.pieces || []).map(p => [p.id, p.nom]));
  return (arbre?.lots || []).flatMap(l => (l.ouvrages || []).flatMap(o => (o.taches || []).map(x => ({
    id: String(x.id), nom: net(x.nomAffiche) || net(x.nom), nomDevis: net(x.nomDevis) || net(x.nom),
    ouvrage: net(o.libelle), ouvrageDevis: net(o.libelleDevis), lot: net(l.label), piece: pieces.get(x.pieceId) || null,
    etat: x.etat || null, avancement: x.avancement ?? null, tache: x,
  }))));
}

// texte : la ligne du planning ; taches : tachesPourLiaison(arbre) ;
// exclure : tache_id déjà dans la journée (jamais proposées).
// → [{ id, nom, lot, ouvrage, piece, score, raisons, tache }] (meilleure d'abord)
export function propositionsLiaison({ texte, taches = [], exclure = [], max = 3 } = {}) {
  const propre = motsLiaison(texte).join(" ");
  const mots = motsLiaison(texte);
  if (!mots.length) return [];
  const exclus = new Set((exclure || []).map(String));
  return (taches || []).filter(x => x?.id && !exclus.has(String(x.id))).map(x => {
    const simNom = Math.max(ressemblanceNomsV2(propre, x.nom), ressemblanceNomsV2(propre, x.nomDevis || ""));
    const couvNom = couverture(mots, `${x.nom} ${x.nomDevis || ""}`);
    const couvCtx = couverture(mots, `${x.ouvrage || ""} ${x.ouvrageDevis || ""} ${x.lot || ""} ${x.piece || ""}`);
    const aFaire = x.etat !== "terminee" && num(x.avancement) < 100;
    const raisons = [];
    if (simNom >= 0.8) raisons.push("nom très proche"); else if (simNom >= 0.3 || couvNom >= 0.5) raisons.push("mots en commun");
    if (couvCtx > 0) raisons.push("même ouvrage, lot ou pièce");
    if (aFaire) raisons.push("pas encore terminée");
    return {
      id: x.id, nom: x.nom, lot: x.lot, ouvrage: x.ouvrage, piece: x.piece, tache: x.tache,
      score: r2(0.45 * simNom + 0.2 * couvNom + 0.1 * couvCtx + (aFaire ? 0.25 : 0)), simNom, couvNom, raisons,
    };
  }).filter(p => p.simNom >= 0.3 || p.couvNom >= 0.5)
    .sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, max)
    .map(({ simNom, couvNom, ...p }) => p);
}

// Côté bureau, le phasage arrive brut (table phasages : ouvrages, pièces de
// plan_travaux.meta, lots de l'Admin). On le passe par le MÊME arbre que le
// téléphone (construireArbre) pour obtenir exactement les mêmes candidates.
export function tachesPourLiaisonDepuisPhasage({ ouvrages = [], pieces = [], lots = [] } = {}, { lotsDefaut = [] } = {}) {
  const payload = {
    phases: [{ id: "_phasage", ouvrages: Array.isArray(ouvrages) ? ouvrages : [] }],
    pieces: Array.isArray(pieces) ? pieces : [],
    lots: Array.isArray(lots) ? lots : [],
  };
  return tachesPourLiaison(construireArbre(payload, { lotsDefaut }));
}

// ── Lignes « libres » : jamais une tâche du phasage ─────────────────────────
// Reconnues sur le TEXTE de la ligne (mots entiers, accents et casse ignorés),
// ou marquées à la main dans le planning (« Pas une tâche du chantier »,
// champ `hors_phasage: true` sur la ligne). Liste volontairement étroite : le
// ménage, l'évacuation, l'approvisionnement, un RDV ENEDIS ou une réunion de
// chantier existent comme tâches dans des phasages réels, ils restent donc à
// lier (ou à marquer à la main).
// Reconnues : absence (congé, maladie, visite médicale, RTT…), formation,
// trajet, passage au dépôt.
export const MARQUE_HORS_PHASAGE = "hors_phasage";
const FAMILLES_LIBRES = Object.freeze([
  { code: "absence", label: "absence",
    mots: ["conge", "conges", "absent", "absente", "absents", "absence", "absences", "maladie", "malade",
      "medecin", "medical", "medicale", "ferie", "rtt"],
    expressions: ["visite medicale", "arret maladie", "arret de travail", "jour off", "jour de repos"] },
  { code: "formation", label: "formation", mots: [], expressions: ["en formation", "formation securite", "journee de formation"] },
  { code: "trajet", label: "trajet", mots: ["trajet", "trajets"], expressions: [] },
  // « dépôt » seul ne suffit pas : des lignes réelles « Pose des plinthes dépôt »
  // sont du travail fait au dépôt (il existe même un chantier « DÉPOT »).
  { code: "depot", label: "passage au dépôt", mots: [],
    expressions: ["passage au depot", "passer au depot", "aller au depot", "retour au depot", "chargement au depot"] },
]);
export const FAMILLES_LIGNES_LIBRES = FAMILLES_LIBRES.map(f => f.label);
const normMots = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// → null (ligne à lier) | { code, label, marquee }
export function natureLibre(ligne) {
  if (ligne?.[MARQUE_HORS_PHASAGE] === true) return { code: "marquee", label: "pas une tâche du chantier", marquee: true };
  const texte = normMots(ligne?.text);
  if (!texte) return null;
  const mots = new Set(texte.split(" "));
  const borde = ` ${texte} `;
  for (const f of FAMILLES_LIBRES) {
    if (f.mots.some(m => mots.has(m)) || f.expressions.some(e => borde.includes(` ${e} `))) {
      return { code: f.code, label: f.label, marquee: false };
    }
  }
  return null;
}
export const estLigneLibre = (ligne) => natureLibre(ligne) !== null;

// "vide" (ligne sans texte : jamais enregistrée) | "liee" | "libre" | "a_lier"
export function etatLiaisonLigne(ligne) {
  if (!net(ligne?.text)) return "vide";
  if (net(ligne?.tache_id)) return "liee";
  return estLigneLibre(ligne) ? "libre" : "a_lier";
}

// Lignes d'une case telles que le planning les affiche : les lignes
// structurées, ou à défaut l'ancien texte découpé ligne à ligne (même règle
// que l'affichage de la grille). Les lignes vides ne comptent pas.
export function lignesDeCellule(cellule) {
  const taches = Array.isArray(cellule?.taches) ? cellule.taches : [];
  const brutes = taches.length > 0
    ? taches
    : net(cellule?.planifie).split("\n").map(s => s.trim()).filter(Boolean).map(text => ({ text }));
  return brutes.filter(l => l && net(l.text));
}

// ── Le compteur « X % des lignes de la semaine liées au phasage » ───────────
// cellules : les lignes de planning_cells d'UNE semaine (toutes les cases,
// tous les chantiers) — [{ chantier_id, jour, taches, planifie }].
// Calcul : lignes liées ÷ (lignes liées + lignes à lier). Les lignes libres
// (absence, trajet, dépôt… ou marquées « pas une tâche du chantier ») ne
// comptent ni au numérateur ni au dénominateur.
// Semaine sans ligne à lier ni liée → pourcent null et « aucune ligne » :
// jamais 0 % ni 100 %. Arrondi à l'entier, sans jamais afficher 100 % tant
// qu'une ligne reste à lier, ni 0 % dès qu'une ligne est liée.
export const EXPLICATION_TAUX_LIAISON =
  "Part des lignes du planning de la semaine rattachées à une tâche du phasage. " +
  "Les lignes libres (absence, formation, trajet, passage au dépôt, ou marquées « pas une tâche du chantier ») ne sont pas comptées.";

export function tauxLiaisonPlanning(cellules = []) {
  let liees = 0, aLier = 0, libres = 0, marquees = 0;
  for (const c of Array.isArray(cellules) ? cellules : []) {
    for (const l of lignesDeCellule(c)) {
      const e = etatLiaisonLigne(l);
      if (e === "liee") liees++;
      else if (e === "a_lier") aLier++;
      else if (e === "libre") { libres++; if (l[MARQUE_HORS_PHASAGE] === true) marquees++; }
    }
  }
  const comptees = liees + aLier;
  let pourcent = null;
  if (comptees > 0) {
    pourcent = Math.round((100 * liees) / comptees);
    if (pourcent === 100 && aLier > 0) pourcent = 99;
    if (pourcent === 0 && liees > 0) pourcent = 1;
  }
  const lignes = comptees + libres;
  const libelle = comptees === 0
    ? (libres > 0 ? `aucune ligne à lier (${libres} ligne${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""})` : "aucune ligne")
    : `${pourcent} % des lignes de la semaine liées au phasage`;
  const detail = comptees === 0 ? null
    : `${liees} liée${liees > 1 ? "s" : ""} sur ${comptees}` +
      (aLier > 0 ? ` · ${aLier} à lier` : "") +
      (libres > 0 ? ` · ${libres} libre${libres > 1 ? "s" : ""} non comptée${libres > 1 ? "s" : ""}` : "");
  return { lignes, comptees, liees, aLier, libres, marquees, pourcent, libelle, detail, explication: EXPLICATION_TAUX_LIAISON };
}

// Lignes à lier d'une semaine, dans l'ordre des jours puis des cases.
// → [{ chantier_id, jour, index, allocation_uid, text, ligne, exclure }]
//   exclure : tache_id déjà présents dans la même case (jamais proposés).
export function lignesALier(cellules = [], { jours = null } = {}) {
  const ordre = Array.isArray(jours) ? jours : [];
  const rang = (j) => { const i = ordre.indexOf(j); return i < 0 ? 99 : i; };
  const out = [];
  for (const c of Array.isArray(cellules) ? cellules : []) {
    const lignes = lignesDeCellule(c);
    const exclure = lignes.map(l => net(l.tache_id)).filter(Boolean);
    lignes.forEach((l, index) => {
      if (etatLiaisonLigne(l) !== "a_lier") return;
      out.push({ chantier_id: c.chantier_id, jour: c.jour, index, allocation_uid: net(l.allocation_uid) || null,
        text: net(l.text), ligne: l, exclure });
    });
  }
  return out.sort((a, b) => rang(a.jour) - rang(b.jour));
}

// Proposition pour une ligne d'une case : même fonction que l'ouvrier, avec
// les tâches déjà dans la case exclues (comme les tâches déjà dans la journée).
export function propositionsPourLigne({ ligne, candidates = [], tachesDeLaCase = [], max = 3 } = {}) {
  const exclure = (tachesDeLaCase || []).map(l => net(l?.tache_id)).filter(Boolean);
  return propositionsLiaison({ texte: ligne?.text, taches: candidates, exclure, max });
}

// ── Accepter / choisir : poser le lien, et rien d'autre ─────────────────────
// La ligne garde son texte, sa durée, ses ouvriers, son identifiant ; elle
// reçoit seulement `tache_id` (et perd la marque « pas une tâche du chantier »
// si elle l'avait : on vient de dire le contraire).
export function lierLignePlanning(ligne, tacheId) {
  const id = net(tacheId);
  if (!id) return ligne;
  const { [MARQUE_HORS_PHASAGE]: _marque, ...reste } = ligne || {};
  return { ...reste, tache_id: id };
}

// Même chose dans le tableau d'une case relu en base, la ligne étant
// retrouvée par son allocation_uid (sinon par son id) : si elle n'y est plus,
// ou si elle a été liée entre-temps, rien n'est écrit (trouve: false).
export function lierLigneDansCellule(taches, { allocation_uid = null, id = null } = {}, tacheId) {
  const liste = Array.isArray(taches) ? taches : [];
  const i = liste.findIndex(l => (allocation_uid && net(l?.allocation_uid) === net(allocation_uid))
    || (!allocation_uid && id && net(l?.id) === net(id)));
  if (i < 0 || net(liste[i]?.tache_id) || !net(tacheId)) return { taches: liste, trouve: false };
  return { taches: liste.map((l, k) => (k === i ? lierLignePlanning(l, tacheId) : l)), trouve: true };
}

// « Pas une tâche du chantier » (ou l'annuler) : seule la marque change.
export function marquerHorsPhasage(ligne, oui = true) {
  const { [MARQUE_HORS_PHASAGE]: _marque, ...reste } = ligne || {};
  return oui ? { ...reste, [MARQUE_HORS_PHASAGE]: true } : reste;
}

// Même chose dans le tableau d'une case relu en base (panneau de la semaine) :
// si la ligne n'y est plus, ou a été liée / marquée entre-temps, rien n'est
// écrit (trouve: false).
export function marquerLigneDansCellule(taches, { allocation_uid = null, id = null } = {}, oui = true) {
  const liste = Array.isArray(taches) ? taches : [];
  const i = liste.findIndex(l => (allocation_uid && net(l?.allocation_uid) === net(allocation_uid))
    || (!allocation_uid && id && net(l?.id) === net(id)));
  if (i < 0 || net(liste[i]?.tache_id) || (liste[i]?.[MARQUE_HORS_PHASAGE] === true) === !!oui) return { taches: liste, trouve: false };
  return { taches: liste.map((l, k) => (k === i ? marquerHorsPhasage(l, oui) : l)), trouve: true };
}
