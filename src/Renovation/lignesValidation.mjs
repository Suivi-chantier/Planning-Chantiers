// ─────────────────────────────────────────────────────────────────────────────
// Validation — lignes d'un rapport, en module PUR (façade lignesValidation.js).
//
// Sorti de Validation.jsx pour que scripts/verif-compte-rendu-v2.mjs exécute le
// VRAI chemin rapport → lignes de validation → pointages, et prouve qu'une
// même journée saisie dans l'ancien formulaire ou dans le v2 donne les mêmes
// pointages. Le mapping des champs historiques est repris À L'IDENTIQUE ; les
// champs du formulaire v2 (bloque, motif, motif_depassement, heures_prevues,
// depassement) sont simplement transportés pour l'affichage.
//
// NOUVELLE TÂCHE PROPOSÉE (origine "nouvelle") : la ligne arrive comme une
// ligne libre (tache_id vide) avec une `proposition` de l'ouvrier. Le
// conducteur confirme (par défaut), change l'ouvrage ou la nature, ou la
// rattache à une tâche existante. La tâche est créée AU MOMENT DE LA
// VALIDATION, avant les pointages, avec un identifiant DÉRIVÉ du rapport et
// de la ligne : une validation relancée retrouve la tâche au lieu d'en créer
// une seconde. Les pointages sont ensuite ceux d'une ligne libre rattachée.
// ─────────────────────────────────────────────────────────────────────────────
import { horsDevisParDefaut } from "./motifsCompteRendu.mjs";
import { ORIGINE_NOUVELLE, DIVERS_HORS_DEVIS, estOuvrageDivers, texteProposition } from "./compteRenduV2.mjs";

// Décision du conducteur sur une proposition, préremplie depuis l'ouvrier :
// ouvrage proposé (null = « Divers / hors devis »), nature, et « Hors devis »
// déduit de la nature (modifiable).
export function creationParDefaut(t) {
  const p = t?.proposition || {};
  return {
    nom: String(t?.planifie ?? "").trim(),
    ouvrage_id: p.ouvrage_id || null,
    nature: p.nature || null,
    hors_devis: horsDevisParDefaut(p.nature) === true,
  };
}

// rapport.taches[] → lignes éditables de la modale de validation.
export function lignesDepuisRapport(rapport) {
  return (rapport?.taches || []).map((t, i) => ({
    rowId: `o${i}`,
    origineIdx: i,
    _origine: true,
    tache_id: t.tache_id || null,
    phase_id: t.phase_id || null,
    planifie: t.planifie || "",
    heures: parseFloat(t.heures_reelles) || 0,
    heures_origine: parseFloat(t.heures_reelles) || 0,
    statut: t.statut || null,
    avancement_declare: t.avancement != null ? parseInt(t.avancement) : null,
    avancement_arbitre: t.avancement != null ? parseInt(t.avancement) : "",  // pré-rempli avec déclaré
    remarque: t.remarque || "",
    photos: t.photos || [],
    bascules: Array.isArray(t.bascules) ? t.bascules : [],
    bascule_depuis: t.bascule_depuis || null,
    _autoMatched: false,
    // ── Formulaire v2 (affichage seulement : n'entrent pas dans les pointages)
    bloque: t.bloque === true,
    motif: t.motif || null,
    motif_depassement: t.motif_depassement || null,
    heures_prevues: t.heures_prevues ?? null,
    depassement: t.depassement || null,
    // « phasage » : tâche ajoutée par l'ouvrier depuis le phasage (repère seul).
    origine: t.origine || null,
    // « nouvelle » : proposition de l'ouvrier (lecture seule) + décision du
    // conducteur (`creation`, null = ne rien créer). Absents sur toute autre
    // ligne : les lignes d'un rapport existant restent identiques.
    ...(estProposition(t) ? { proposition: { ...t.proposition }, creation: creationParDefaut(t) } : {}),
  }));
}

const estProposition = (t) => t?.origine === ORIGINE_NOUVELLE && !!t.proposition && !t.tache_id;

// ── Nouvelle tâche : création à la validation ───────────────────────────────
// Identifiant stable : même rapport + même ligne d'origine = même tâche.
export const idTacheProposee = (rapportId, origineIdx) => `nt-${rapportId}-${origineIdx}`;

// La ligne sera-t-elle créée à la validation ? (proposition confirmée, pas
// rattachée à une tâche existante)
export const propositionACreer = (li) => !!(li?.proposition && li.creation && !li.tache_id);

export function trouverTache(ouvrages, tacheId) {
  for (const o of ouvrages || []) {
    const t = (o.taches || []).find(x => String(x.id) === String(tacheId));
    if (t) return { ouvrage: o, tache: t };
  }
  return null;
}

// Tâche créée depuis la Validation (proposition de l'ouvrier ou fenêtre
// « + Créer nouvelle tâche »). Jamais d'heures vendues : une tâche ajoutée
// en cours de chantier n'a pas été vendue.
export function tacheCreeeEnValidation({ id, nom, nature = null, hors_devis = null, ouvrier = null, rapportId = null }) {
  const t = {
    id, nom: String(nom ?? "").trim(),
    heures_estimees: null, heures_reelles: null, avancement: 0,
    ouvriers: ouvrier ? [ouvrier] : [],
    date_prevue: null, _cree_depuis_validation: true,
  };
  if (nature) t.nature = nature;
  if (hors_devis != null) t.hors_devis = hors_devis === true;
  if (ouvrier) t.cree_par = ouvrier;
  if (rapportId) t.cree_depuis_rapport = rapportId;
  return t;
}

// Ajoute une tâche dans l'ouvrage `ouvrageId`, ou (null) dans « Divers / hors
// devis », créé s'il n'existe pas — même règle qu'avant. Un ouvrage désigné
// mais absent du phasage est une ERREUR (jamais de repli silencieux).
// genId : fabrique d'identifiant (le module n'a pas de hasard).
export function ajouterTacheDansOuvrage(ouvrages, ouvrageId, tache, genId) {
  let next = (ouvrages || []).map(o => ({ ...o }));
  let cible = ouvrageId
    ? next.find(o => String(o.id) === String(ouvrageId))
    : next.find(o => estOuvrageDivers(o.libelle));
  if (ouvrageId && !cible) return { erreur: "ouvrage_introuvable" };
  if (!cible) {
    cible = { id: genId(), libelle: DIVERS_HORS_DEVIS, lot_id: null, heures_devis: null,
      quantite: null, unite: "U", prix_ht: null, cout_materiaux: null, taches: [] };
    next = [...next, cible];
  }
  cible.taches = [...(cible.taches || []), tache];
  return { ouvrages: next, ouvrage: cible };
}

// Crée (ou retrouve) les tâches de toutes les propositions confirmées d'un
// rapport, et rattache les lignes. Rend :
//   ouvrages  le phasage à enregistrer (inchangé si rien à créer)
//   lignes    les lignes rattachées (tache_id, ouvrage_id ; phase_id vide)
//   modifie   true si au moins une tâche a été ajoutée
//   erreurs   [{ rowId, code: "ouvrage_introuvable" | "nom_vide", planifie }]
//   creees / reprises : pour information
export function appliquerCreationsProposees({ ouvrages, lignes, rapport, genId }) {
  let courant = ouvrages || [];
  let modifie = false;
  const erreurs = [], creees = [], reprises = [];
  const sortie = (lignes || []).map(li => {
    if (!propositionACreer(li)) return li;
    const id = idTacheProposee(rapport.id, li.origineIdx);
    const deja = trouverTache(courant, id);
    if (deja) {
      reprises.push({ rowId: li.rowId, tache_id: id, ouvrage_id: deja.ouvrage.id });
      return { ...li, tache_id: id, phase_id: null, ouvrage_id: deja.ouvrage.id };
    }
    const nom = String(li.creation.nom ?? li.planifie ?? "").trim();
    if (!nom) { erreurs.push({ rowId: li.rowId, code: "nom_vide", planifie: li.planifie }); return li; }
    const tache = tacheCreeeEnValidation({
      id, nom, nature: li.creation.nature, hors_devis: li.creation.hors_devis,
      ouvrier: rapport.ouvrier || null, rapportId: rapport.id,
    });
    const r = ajouterTacheDansOuvrage(courant, li.creation.ouvrage_id, tache, genId);
    if (r.erreur) { erreurs.push({ rowId: li.rowId, code: r.erreur, planifie: li.planifie }); return li; }
    courant = r.ouvrages;
    modifie = true;
    creees.push({ rowId: li.rowId, tache_id: id, ouvrage_id: r.ouvrage.id });
    return { ...li, tache_id: id, phase_id: null, ouvrage_id: r.ouvrage.id, planifie: nom };
  });
  return { ouvrages: courant, lignes: sortie, modifie, erreurs, creees, reprises };
}

// Étape 0 de la validation d'un rapport : crée les tâches proposées puis
// enregistre le phasage AVEC sa révision attendue, avant tout pointage.
//   sauvegarder : ({ phasageId, revision, ouvrages }) → { ok, code, revision }
//                 (sauvegarderPhasage de phasageEcriture, injecté : ce module
//                 ne parle pas au serveur).
// Rend { ok: true, lignes, phasage } (phasage à jour : ouvrages + révision),
// ou { ok: false, code } — code ∈ sans_ouvrages | erreurs (+ erreurs) |
// conflit | refuse | erreur. En cas d'échec, RIEN n'a été écrit.
export async function enregistrerCreationsProposees({ phasage, lignes, rapport, genId, sauvegarder }) {
  if (!(lignes || []).some(propositionACreer)) return { ok: true, lignes, phasage, ecrit: false };
  const ouvrages = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  if (!phasage || ouvrages.length === 0) return { ok: false, code: "sans_ouvrages" };
  const res = appliquerCreationsProposees({ ouvrages, lignes, rapport, genId });
  if (res.erreurs.length > 0) return { ok: false, code: "erreurs", erreurs: res.erreurs };
  if (!res.modifie) return { ok: true, lignes: res.lignes, phasage, ecrit: false };
  const r = await sauvegarder({ phasageId: phasage.id, revision: phasage.revision ?? 0, ouvrages: res.ouvrages });
  if (!r?.ok) return { ok: false, code: r?.code || "erreur" };
  return { ok: true, lignes: res.lignes, phasage: { ...phasage, ouvrages: res.ouvrages, revision: r.revision }, ecrit: true };
}

// Lignes de la modale → entrée « taskLines » de buildPointagesRapport.
export const taskLinesPourPointages = (lignes) => (lignes || []).map(li => ({
  tache_id: li.tache_id || null,
  phase_id: li.phase_id || null,
  heures: li.heures,
  avancement_declare: li.avancement_declare,
}));

// Le relevé « X h sur Y h vendues » enregistré à la saisie ne vaut que pour
// la tâche et les heures que l'ouvrier a déclarées. Dès que le conducteur
// réaffecte la ligne à une autre tâche, la découpe en deux ou change ses
// heures, il ne correspond plus : on ne l'affiche pas (jamais un dépassement
// faux). Le MOTIF choisi par l'ouvrier, lui, reste affiché.
export function depassementAffichable(ligne) {
  const d = ligne?.depassement;
  if (!d || !ligne.motif_depassement) return null;
  if (!ligne._origine) return null;                                   // moitié créée par un découpage
  if (String(d.tache_id ?? "") !== String(ligne.tache_id ?? "")) return null; // réaffectée
  if (Math.abs((parseFloat(ligne.heures) || 0) - (parseFloat(ligne.heures_origine) || 0)) > 0.001) return null;
  return d;
}

// Découpage d'une ligne en deux moitiés : le relevé de dépassement est retiré
// des deux (les heures ne sont plus celles déclarées) ; le motif est conservé.
export function decouperLigne(src, nouvelId) {
  const moitie = (parseFloat(src.heures) || 0) / 2;
  const nouvelle = { ...src, rowId: nouvelId, _origine: false, heures: moitie, depassement: null };
  const modif = { ...src, heures: moitie, depassement: null };
  return [modif, nouvelle];
}

// Ligne créée sur le rapport du chantier cible lors d'une bascule d'heures.
// Les champs du formulaire v2 suivent (statut choisi, motifs), sauf le relevé
// de dépassement, qui ne vaut plus sur un autre chantier.
export function ligneBasculee(ligne, { heures, rapport, valideur, le }) {
  return {
    planifie: ligne.planifie || "",
    tache_id: null, phase_id: null,           // à rattacher au plan du chantier cible à sa validation
    statut: ligne.statut || "non_faite",
    // Une nouvelle tâche proposée ne suit pas (son ouvrage est sur l'autre
    // chantier) : la proposition passe en texte dans la remarque.
    remarque: ligne.proposition
      ? [texteProposition(ligne.proposition), ligne.remarque].filter(Boolean).join(" — ")
      : ligne.remarque || "",
    heures_reelles: heures,
    avancement: ligne.avancement_declare != null ? ligne.avancement_declare : 0,
    photos: [],
    ...(ligne.bloque ? { bloque: true } : {}),
    ...(ligne.motif ? { motif: ligne.motif } : {}),
    ...(ligne.motif_depassement ? { motif_depassement: ligne.motif_depassement } : {}),
    bascule_depuis: {
      rapport_id: rapport.id, chantier_id: rapport.chantier_id,
      chantier_nom: rapport.chantier_nom || null, heures, par: valideur, le,
    },
  };
}
