// ─────────────────────────────────────────────────────────────────────────────
// planV2Document — nouvel éditeur de plans : le DOCUMENT d'un plan, c'est-à-dire
// ce qui est enregistré dans la colonne `data` de la table plans_v2
// (docs/projets/editeur-plans.md, règles 1, 4, 5 et 8).
//
// Module PUR : aucun réseau, aucune horloge (la date arrive en paramètre),
// aucun effet de bord. Rien de ce qui est reçu n'est modifié : chaque fonction
// renvoie un nouveau document. Couvert par scripts/verif-plan-v2-document.mjs.
//
// CE QUE LE DOCUMENT GARANTIT
//   • Le relevé de départ est COPIÉ (règle 1) : `releve_brut` est une copie
//     profonde, jamais retouchée ensuite. C'est l'origine depuis laquelle tout
//     déplacement se mesure.
//   • L'existant est FIGÉ (règle 4) : le relevé redressé est ENREGISTRÉ. Ouvrir
//     un plan ne relance jamais le redressement ; si l'algorithme évolue, un
//     plan déjà créé garde son existant au millimètre. Le document note la
//     version des algorithmes et les tolérances qui l'ont produit.
//   • Un point à valider n'entre dans le plan que sur action (règle 8) : il est
//     enregistré avec son état (a_valider / accepte / refuse). L'accepter
//     applique SA correction enregistrée, rien d'autre.
//   • Les mesures brutes (points de mesure, scanners), qui pèsent l'essentiel
//     d'un relevé et que le redressement ne touche pas, ne sont stockées
//     qu'UNE fois, dans `releve_brut` ; l'existant les reprend à la lecture.
//   • Un document illisible, incomplet ou d'une version inconnue donne une
//     erreur explicite — jamais un plan vide.
//
// FORME DU DOCUMENT (version 1)
//   { format: "plan_v2", version: 1,
//     cree_le,                                  // date reçue à la création
//     source: { type: "ancien_plan", plan_id, plan_nom, plan_modifie_le }
//           | { type: "import_imapper" },
//     algorithmes: { releve, redressement, modele },   // versions à la création
//     tolerances: { redressement: { … }, murs: { … } },
//     releve_brut: { … },                       // copie du relevé, intacte
//     existant: { fige_le,
//                 releve: { … },                // relevé redressé, SANS les mesures brutes
//                 mesures_reprises: ["points", "scanners"] },   // lues dans releve_brut
//     redressement: {
//       corrections: [ … ], directions: [ … ], bilan: { … },   // à la création
//       points: [{ …point de redresserReleve, etat, decide_le,
//                  effet: { deplacement_m, rotation_deg } }] },  // effet : si accepté
//     projet: { modifications: [] },            // tâches suivantes — vides ici
//     equipements: [], notes: [], traits: [],
//     reglages: { cotes: {} } }                 // cotes masquées ou déplacées (scène)
//
// Toutes les fonctions renvoient { ok: true, … } ou { ok: false, code, erreur }
// (même habitude que releveDepuisDXF) ; `erreur` est une phrase affichable.
// ─────────────────────────────────────────────────────────────────────────────
import { calculerMetres, VERSION_RELEVE } from "../releveImapper.mjs";
import { construireModeleExistant, VERSION_MODELE_PLAN, TOLERANCES_MURS } from "./planV2Modele.mjs";
import {
  redresserReleve, appliquerPointRedressement, bilanDeplacement, mesurerEcart,
  TOLERANCES_REDRESSEMENT, VERSION_REDRESSEMENT,
} from "./planV2Redressement.mjs";

export const FORMAT_DOCUMENT_PLAN = "plan_v2";
export const VERSION_DOCUMENT_PLAN = 1;
export const ETATS_POINT = ["a_valider", "accepte", "refuse"];
export const SOURCES_PLAN = ["ancien_plan", "import_imapper"];
// Parties d'un relevé que le redressement ne touche jamais : stockées une fois.
export const MESURES_BRUTES = ["points", "scanners"];

const estObjet = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const echec = (code, erreur) => ({ ok: false, code, erreur });
// Copie profonde = ce qui sera enregistré (JSON), sans lien avec l'original.
const copier = (v) => JSON.parse(JSON.stringify(v));
const aDesPieces = (r) => estObjet(r) && Array.isArray(r.pieces);

// Existant → { releve (sans les mesures brutes), mesures_reprises }. Toute
// mesure brute du relevé d'origine est reprise de lui à la lecture. Refus
// (null) si l'existant en porte une DIFFÉRENTE : elle serait perdue.
function alleger(releve, brut) {
  const allege = { ...releve }, reprises = [];
  for (const k of MESURES_BRUTES) {
    if (!(k in brut)) continue;               // absente de l'origine : elle reste dans l'existant
    if (k in releve) {
      if (releve[k] !== brut[k] && JSON.stringify(releve[k]) !== JSON.stringify(brut[k])) return null;
      delete allege[k];
    }
    reprises.push(k);
  }
  return { releve: allege, mesures_reprises: reprises };
}

// Le relevé de l'existant tel qu'il a été figé, mesures brutes comprises.
// Aucun calcul : c'est une lecture du document.
export function existantDuDocument(document) {
  const releve = { ...document.existant.releve };
  for (const k of document.existant.mesures_reprises || []) if (k in document.releve_brut) releve[k] = document.releve_brut[k];
  return releve;
}

function lireSource(source) {
  if (!estObjet(source) || !SOURCES_PLAN.includes(source.type)) return null;
  if (source.type === "import_imapper") return { type: "import_imapper" };
  if (source.plan_id == null || String(source.plan_id).trim() === "") return null;
  return {
    type: "ancien_plan", plan_id: String(source.plan_id),
    plan_nom: source.plan_nom ?? null, plan_modifie_le: source.plan_modifie_le ?? null,
  };
}

// Relevé → document d'un nouveau plan (forme en tête de fichier).
//   releve      relevé iMapper (ancien plan ou import) — copié, jamais modifié
//   source      d'où vient le relevé (voir SOURCES_PLAN)
//   maintenant  date ISO, fournie par l'appelant
//   tolerances  { redressement: { … }, murs: { … } } — surcharges facultatives
export function creerDocumentPlan({ releve, source, maintenant = null, tolerances = {} } = {}) {
  if (!aDesPieces(releve)) return echec("releve_illisible", "Ce relevé est illisible : le plan n'a pas été créé.");
  if (!releve.pieces.some((p) => (p?.polygone || []).length >= 3)) {
    return echec("releve_sans_piece", "Ce relevé ne contient aucune pièce : le plan n'a pas été créé.");
  }
  const origine = lireSource(source);
  if (!origine) return echec("source_inconnue", "L'origine du relevé (ancien plan ou import iMapper) n'est pas indiquée : le plan n'a pas été créé.");
  const brut = copier(releve);
  const tolMurs = { ...TOLERANCES_MURS, ...(tolerances.murs || {}) };
  const X = redresserReleve(brut, { tolerances: tolerances.redressement || {}, tolerancesMurs: tolMurs });
  const document = {
    format: FORMAT_DOCUMENT_PLAN, version: VERSION_DOCUMENT_PLAN,
    cree_le: maintenant,
    source: origine,
    algorithmes: { releve: VERSION_RELEVE, redressement: VERSION_REDRESSEMENT, modele: VERSION_MODELE_PLAN },
    tolerances: { redressement: X.tolerances, murs: tolMurs },
    releve_brut: brut,
    existant: { fige_le: maintenant, ...alleger(X.releve, brut) },
    redressement: {
      corrections: X.corrections, directions: X.directions, bilan: X.bilan,
      points: X.points_a_valider.map((p) => ({ ...p, etat: "a_valider", decide_le: null, effet: null })),
    },
    projet: { modifications: [] },
    equipements: [], notes: [], traits: [],
    reglages: { cotes: {} },
  };
  // Le relevé redressé partage avec le brut ses parties inchangées : la copie
  // finale les sépare, le document est un arbre JSON sans aucun lien interne.
  return { ok: true, document: copier(document) };
}

// Lecture tolérante d'un document : les emplacements facultatifs absents sont
// complétés (vides) ; ce qui est indispensable et manque donne une erreur.
// → { ok: true, document } (complété, l'entrée n'est pas modifiée) ou erreur.
export function verifierDocumentPlan(data) {
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
  if (!estObjet(d) || d.format !== FORMAT_DOCUMENT_PLAN) {
    return echec("document_illisible", "Ce plan est illisible : son contenu n'est pas un document du nouvel éditeur de plans. Rien n'est affiché plutôt qu'un plan vide.");
  }
  if (!Number.isInteger(d.version) || d.version < 1 || d.version > VERSION_DOCUMENT_PLAN) {
    return echec("version_inconnue", `Ce plan a été enregistré dans une version du document (${d.version}) que cette version de l'application ne sait pas lire (jusqu'à ${VERSION_DOCUMENT_PLAN}). Rechargez l'application ; le plan n'est ni affiché ni modifié.`);
  }
  const incomplet = (quoi) => echec("document_incomplet", `Ce plan est incomplet : ${quoi}. Rien n'est affiché plutôt qu'un plan vide.`);
  if (!aDesPieces(d.releve_brut)) return incomplet("le relevé d'origine manque");
  if (!estObjet(d.existant) || !aDesPieces(d.existant.releve)) return incomplet("l'existant figé manque");
  if (!estObjet(d.redressement) || !Array.isArray(d.redressement.points)) return incomplet("la liste des points à valider manque");
  if (d.redressement.points.some((p) => !estObjet(p) || typeof p.cle !== "string" || (p.etat != null && !ETATS_POINT.includes(p.etat)))) {
    return incomplet("un point à valider est dans un état inconnu");
  }
  const reprises = d.existant.mesures_reprises ?? [];
  if (!Array.isArray(reprises) || reprises.some((k) => !MESURES_BRUTES.includes(k))) return incomplet("les mesures reprises du relevé d'origine sont illisibles");
  const listes = { equipements: d.equipements ?? [], notes: d.notes ?? [], traits: d.traits ?? [], modifications: d.projet?.modifications ?? [] };
  for (const [nom, v] of Object.entries(listes)) if (!Array.isArray(v)) return incomplet(`la liste « ${nom} » est illisible`);
  if (d.reglages != null && !estObjet(d.reglages)) return incomplet("les réglages d'affichage sont illisibles");
  return {
    ok: true,
    document: {
      ...d,
      cree_le: d.cree_le ?? null,
      source: estObjet(d.source) ? d.source : { type: null },
      algorithmes: estObjet(d.algorithmes) ? d.algorithmes : {},
      tolerances: { redressement: d.tolerances?.redressement ?? {}, murs: d.tolerances?.murs ?? {} },
      existant: { ...d.existant, fige_le: d.existant.fige_le ?? null, mesures_reprises: reprises },
      redressement: {
        ...d.redressement,
        corrections: d.redressement.corrections ?? [], directions: d.redressement.directions ?? [], bilan: d.redressement.bilan ?? null,
        points: d.redressement.points.map((p) => (p.etat ? p : { ...p, etat: "a_valider", decide_le: null, effet: null })),
      },
      projet: { ...(d.projet || {}), modifications: listes.modifications },
      equipements: listes.equipements, notes: listes.notes, traits: listes.traits,
      reglages: { ...(d.reglages || {}), cotes: estObjet(d.reglages?.cotes) ? d.reglages.cotes : {} },
    },
  };
}

// Document → de quoi travailler. L'existant est LU, jamais recalculé ; le
// modèle (murs, ouvertures accrochées) et les métrés sont calculés sur lui,
// avec les tolérances enregistrées (réponse de Loris à la question 5 : les
// métrés suivent le plan redressé).
// → { ok, document, releve_brut, existant, modele, metres,
//     points,              // tous les points du redressement, avec leur état
//     points_a_valider,    // ceux qui restent à décider (pour la scène)
//     ecart_origine,       // déplacement cumulé de l'existant depuis le relevé d'origine
//     avertissements: [{ code, texte }] }
export function ouvrirDocumentPlan(data) {
  const v = verifierDocumentPlan(data);
  if (!v.ok) return v;
  const document = v.document, existant = existantDuDocument(document);
  let modele, metres;
  try {
    modele = construireModeleExistant(existant, { tolerances: document.tolerances.murs });
    metres = calculerMetres(existant);
  } catch (e) {
    return echec("document_incalculable", `Ce plan ne peut pas être calculé (${e?.message || e}). Rien n'est affiché plutôt qu'un plan faux.`);
  }
  const avertissements = [];
  const vr = document.algorithmes.redressement;
  if (vr !== VERSION_REDRESSEMENT) {
    avertissements.push({
      code: "redressement_version",
      texte: `L'existant de ce plan a été figé avec ${vr == null ? "une version non notée" : `la version ${vr}`} du redressement (version actuelle : ${VERSION_REDRESSEMENT}). Il est affiché tel qu'il a été enregistré, sans être recalculé.`,
    });
  }
  const points = document.redressement.points;
  return {
    ok: true, document, releve_brut: document.releve_brut, existant, modele, metres,
    points, points_a_valider: points.filter((p) => p.etat === "a_valider"),
    ecart_origine: bilanDeplacement(document.releve_brut, existant),
    avertissements,
  };
}

// Effet d'un déplacement de l'existant : plus grand déplacement d'un sommet,
// plus grande rotation d'un côté, et « casse » si une pièce serait déformée.
function mesurerEffet(avant, apres) {
  const r = { deplacement_m: 0, rotation_deg: 0, casse: false };
  for (const p of avant.pieces) {
    const q = apres.pieces.find((x) => x.id === p.id), P = p.polygone || [], Q = q?.polygone || [];
    if (P === Q) continue;
    if (Q.length !== P.length || Q.flat().some((c) => !Number.isFinite(c))) { r.casse = true; continue; }
    const m = mesurerEcart(P, Q);
    r.deplacement_m = Math.max(r.deplacement_m, ...m.deplacements);
    r.rotation_deg = Math.max(r.rotation_deg, ...m.rotations);
    r.casse = r.casse || m.renverses.some(Boolean);
  }
  return r;
}

function pointDuDocument(data, cle) {
  const v = verifierDocumentPlan(data);
  if (!v.ok) return v;
  const point = v.document.redressement.points.find((p) => p.cle === cle);
  if (!point) return echec("point_introuvable", "Ce point à valider n'existe pas dans ce plan.");
  return { ok: true, document: v.document, point };
}
const avecPoint = (document, cle, champs) => ({
  ...document,
  redressement: { ...document.redressement, points: document.redressement.points.map((p) => (p.cle === cle ? { ...p, ...champs } : p)) },
});

// Ce que ferait l'acceptation d'un point SUR L'EXISTANT ACTUEL (son ampleur
// enregistrée date de la création : elle change quand d'autres points ont été
// acceptés entre-temps). → { ok, applicable, deplacement_m, rotation_deg, casse }
export function mesurerEffetPoint(data, cle) {
  const x = pointDuDocument(data, cle);
  if (!x.ok) return x;
  if (!x.point.applicable || !x.point.correction) return { ok: true, applicable: false, deplacement_m: null, rotation_deg: null, casse: false };
  const existant = existantDuDocument(x.document);
  return { ok: true, applicable: true, ...mesurerEffet(existant, appliquerPointRedressement(existant, x.point)) };
}

// Accepte un point à valider : SA correction enregistrée est appliquée à
// l'existant (appliquerPointRedressement), et rien d'autre — le redressement
// n'est pas relancé. Le relevé d'origine ne change pas.
export function accepterPoint(data, cle, { maintenant = null } = {}) {
  const x = pointDuDocument(data, cle);
  if (!x.ok) return x;
  const { document, point } = x;
  if (point.etat !== "a_valider") return echec("point_deja_traite", `Ce point a déjà été ${point.etat === "accepte" ? "accepté" : "refusé"}.`);
  if (!point.applicable || !point.correction) return echec("point_non_applicable", "Ce point n'a pas de correction automatique : il se corrige à la main.");
  const existant = existantDuDocument(document), apres = appliquerPointRedressement(existant, point);
  const effet = mesurerEffet(existant, apres);
  if (effet.casse) return echec("point_inapplicable", "Cette correction ne peut plus être appliquée sans déformer une pièce (d'autres corrections ont été acceptées depuis) : rien n'a été déplacé.");
  const allege = alleger(apres, document.releve_brut);
  if (!allege) return echec("mesures_modifiees", "Les mesures brutes du relevé ont changé : rien n'a été enregistré.");
  return {
    ok: true, effet,
    document: avecPoint({ ...document, existant: { ...document.existant, ...allege } }, cle, {
      etat: "accepte", decide_le: maintenant, effet: { deplacement_m: effet.deplacement_m, rotation_deg: effet.rotation_deg },
    }),
  };
}

// Refuse un point à valider : rien n'est déplacé, le point quitte la liste.
export function refuserPoint(data, cle, { maintenant = null } = {}) {
  const x = pointDuDocument(data, cle);
  if (!x.ok) return x;
  if (x.point.etat !== "a_valider") return echec("point_deja_traite", `Ce point a déjà été ${x.point.etat === "accepte" ? "accepté" : "refusé"}.`);
  return { ok: true, document: avecPoint(x.document, cle, { etat: "refuse", decide_le: maintenant, effet: null }) };
}

// Remet « à valider » un point refusé. Un point accepté a déplacé l'existant :
// il ne se rouvre pas ici (c'est l'annulation de l'éditeur qui y revient).
export function rouvrirPoint(data, cle) {
  const x = pointDuDocument(data, cle);
  if (!x.ok) return x;
  if (x.point.etat !== "refuse") {
    return echec("point_non_refuse", x.point.etat === "accepte" ? "Ce point a été accepté : l'existant a déjà été déplacé." : "Ce point est déjà à valider.");
  }
  return { ok: true, document: avecPoint(x.document, cle, { etat: "a_valider", decide_le: null, effet: null }) };
}

// Remplace le relevé de l'existant par une version corrigée À LA MAIN (nom ou
// type d'une pièce, hauteur sous plafond, ouverture validée…). Les mesures
// brutes ne sont pas recopiées ; le relevé d'origine ne change pas.
export function remplacerExistant(data, releve) {
  const v = verifierDocumentPlan(data);
  if (!v.ok) return v;
  if (!aDesPieces(releve)) return echec("releve_illisible", "Ce relevé est illisible : l'existant n'a pas été modifié.");
  const allege = alleger(releve, v.document.releve_brut);
  if (!allege) return echec("mesures_modifiees", "Les mesures brutes du relevé ont changé : l'existant n'a pas été modifié.");
  return { ok: true, document: { ...v.document, existant: { ...v.document.existant, ...allege } } };
}

// Chiffres d'un plan pour la liste (colonne `resume` de plans_v2), calculés
// par les mêmes services que l'écran : calculerMetres sur l'existant.
// `surface_sol_m2` garde toute sa précision : l'écran l'écrit avec texteMetre.
export function resumerDocumentPlan(data) {
  const v = verifierDocumentPlan(data);
  if (!v.ok) return v;
  const document = v.document, existant = existantDuDocument(document);
  let metres;
  try { metres = calculerMetres(existant); }
  catch (e) { return echec("document_incalculable", `Ce plan ne peut pas être calculé (${e?.message || e}).`); }
  const points = document.redressement.points;
  return {
    ok: true,
    resume: {
      version: document.version,
      source: document.source.type ?? null,
      pieces: existant.pieces.length,
      surface_sol_m2: metres.total.sol,
      // null = ouvertures pas encore relevées (≠ 0 : aucune ouverture).
      ouvertures: Array.isArray(existant.ouvertures) ? existant.ouvertures.length : null,
      points_a_valider: points.filter((p) => p.etat === "a_valider").length,
      points_acceptes: points.filter((p) => p.etat === "accepte").length,
      points_refuses: points.filter((p) => p.etat === "refuse").length,
    },
  };
}
