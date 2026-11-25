// ─────────────────────────────────────────────────────────────────────────────
// planV2Scene — nouvel éditeur de plans : la SCÈNE du plan, c'est-à-dire la
// liste de ce qu'il faut dessiner (docs/projets/editeur-plans.md, étape 1 :
// « pièces colorées par type avec leur nom et leur surface, murs pleins à leur
// épaisseur, ouvertures, cotes intérieures automatiques »).
//
// Module PUR : aucun réseau, aucune horloge, aucun effet de bord, aucun DOM.
// Tout arrive en paramètre et rien n'est modifié. Couvert par
// scripts/verif-plan-v2-scene.mjs.
//
// UNE SEULE DESCRIPTION, DEUX SORTIES. La scène est en MÈTRES, dans le repère
// du relevé (y vers le haut), sans aucune taille d'écran. planV2SceneDessin.mjs
// la met en page pour une échelle donnée (textes, cotes affichées ou non, zones
// de toucher) et rend des formes simples ; planV2SceneSvg.mjs écrit ces formes
// en SVG, et le composant React de l'éditeur dessinera les MÊMES formes : la
// géométrie n'existe qu'ici.
//
// CE QUE LA SCÈNE NE CALCULE PAS. La surface affichée dans une pièce vient des
// métrés reçus en paramètre (calculerMetres) et se formate avec texteMetre :
// même chiffre, même service. La scène ne sait pas sur quel relevé ces métrés
// ont été calculés. Les cotes sont celles de cotesInterieures.
//
// construireScene({ releve, modele, metres, points_a_valider, reglages })
//   releve            relevé (redressé) ; modele = construireModeleExistant(releve)
//   metres            calculerMetres(…) — peut manquer : « non calculable »
//   points_a_valider  ceux de redresserReleve (ou toute liste { cle, cotes })
//   reglages          { cotes: { ‹id de cote›: { masquee, decalage: [dx, dy] } },   // m
//                       tolerancesMurs }      // surcharge de TOLERANCES_SCENE_MURS
// → { version, unite: "m", emprise: { x0, y0, x1, y1 }, calques: [nom…],
//     elements: [ … ],            // dans l'ordre de dessin (calque par calque)
//     indications: [{ code, texte }],   // ce que le plan ne peut pas montrer
//     hors_plan: [{ cle, texte }],      // points à valider sans côté à désigner
//     bilan: { … } }
//
// ÉLÉMENTS — chacun porte { id, type, calque, objet: { type, id }, etat,
// corps_etat } ; `objet` désigne l'objet métier (pièce, mur, ouverture…).
//   piece     { polygone, type_piece, couleur, nom, surface: { texte, connue },
//               ancre: [x, y], rayon }          // étiquette : nom + surface
//   mur       { type_mur, polygone, epaisseur }                // bande pleine
//   jonction  { murs: [idMur, idMur], polygone, source }       // angle, T, croix
//   mur_trait { genre: "epaisseur_inconnue" | "limite", a, b, raison }
//   ouverture { rendu: "menuiserie" | "a_valider" | "a_placer", type_ouverture,
//               statut, code, mur, piece, cote, … } — voir elementOuverture
//   cote      { piece, cote, a, b, n, longueur, texte, masquee, decalage,
//               doublon }                       // doublon : id de la cote jumelle
//   point_a_valider { cle, code, nature, numero, texte, segments: [{ piece,
//               cote, a, b, n }], ancre: { segment, point, n } }   // le plus long
// Calques prévus mais vides ici : equipements, traits, notes, projet.
// ─────────────────────────────────────────────────────────────────────────────
import {
  couleurPiece, poleInaccessibilite, cotesInterieures, cotesPiece, geometrieOuverture, texteMetre,
} from "../releveImapper.mjs";
import { CORPS_ETAT_MURS } from "./planV2Murs.mjs";
import { geometrieMurs } from "./planV2SceneMurs.mjs";

export * from "./planV2SceneMurs.mjs";

export const VERSION_SCENE = 1;
// Ordre de dessin, du fond vers le dessus.
export const CALQUES_SCENE = ["pieces", "murs", "ouvertures", "equipements", "traits", "projet", "cotes", "etiquettes", "notes", "a_valider"];

export const TEXTES_INDICATION = {
  ouvertures_non_relevees: "Ouvertures non relevées : les portes et fenêtres ne sont pas encore sur ce plan.",
  elements_non_dessines: "Des équipements, notes, traits ou modifications du projet existent mais ne sont pas encore dessinés.",
};

const milieu = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const plus = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const vec = (v) => [v[0] + 0, v[1] + 0];                      // + 0 : jamais de « −0 » (la scène s'enregistre en JSON)

// Ouverture du relevé → élément de scène.
//   rendu "menuiserie" : ouverture détectée, confirmée ou validée, placée. On
//     dessine le trou dans le mur (`baie`) et son symbole (`symbole`) ;
//   rendu "a_valider"  : ouverture « à vérifier », placée. PAS une menuiserie :
//     un repère orange dans l'épaisseur du mur (`marque`, `bouts`), sans trou ;
//   rendu "a_placer"   : vue sur photo, position inconnue : un repère orange au
//     milieu de son côté de pièce (`repere`, `n` vers l'intérieur de la pièce).
// L'épaisseur du trou est celle du mur du modèle qui porte l'ouverture ; à
// défaut, celle notée sur l'ouverture (`epaisseur_source` le dit).
function elementOuverture(releve, o, mo, mur, minces = []) {
  const base = {
    id: `ouverture:${o.id}`, type: "ouverture", calque: "ouvertures", objet: { type: "ouverture", id: o.id },
    etat: mo?.etat || "existant", corps_etat: mo?.corps_etat ?? CORPS_ETAT_MURS,
    type_ouverture: o.type, statut: o.statut ?? null, code: o.code || null,
    mur: mo?.mur ?? null, piece: o.piece, cote: o.mur,
  };
  const g = geometrieOuverture(releve, o);
  if (!g || !(g.largeur > 0)) {
    const piece = (releve?.pieces || []).find((p) => p.id === o.piece);
    const c = piece && cotesPiece(piece)[o.mur];
    if (!c) return null;
    return { ...base, rendu: "a_placer", repere: milieu(c.a, c.b), u: vec(c.u), n: vec(c.n), segment: [c.a, c.b] };
  }
  const connue = mur?.epaisseur > 0;
  const e = connue ? mur.epaisseur : g.epaisseur;
  const ext = (p, d) => plus(p, g.n, -d);
  const geo = {
    p0: g.p0, p1: g.p1, u: vec(g.u), n: vec(g.n), largeur: g.largeur, epaisseur: e, epaisseur_source: connue ? "mur" : "ouverture",
    baie: [g.p0, g.p1, ext(g.p1, e), ext(g.p0, e)],
    toucher: { centre: ext(milieu(g.p0, g.p1), e / 2), u: vec(g.u), demi_longueur: g.largeur / 2, demi_epaisseur: e / 2 },
  };
  if (o.statut === "a_verifier") {
    // Le repère court au milieu du mur le plus MINCE que l'ouverture touche :
    // il reste dans la matière même quand elle est à cheval sur plusieurs murs.
    const m = Math.min(e, ...minces);
    return { ...base, rendu: "a_valider", ...geo, marque: [ext(g.p0, m / 2), ext(g.p1, m / 2)], bouts: [[g.p0, ext(g.p0, m)], [g.p1, ext(g.p1, m)]] };
  }
  const symbole = { tableaux: [[g.p0, ext(g.p0, e)], [g.p1, ext(g.p1, e)]], lignes: [], pointilles: [], vantail: null, arc: null };
  if (o.type === "fenetre" || o.type === "porte_fenetre") symbole.lignes = [0, e / 2, e].map((d) => [ext(g.p0, d), ext(g.p1, d)]);
  if (o.type === "baie") symbole.pointilles = [0, e].map((d) => [ext(g.p0, d), ext(g.p1, d)]);
  if (o.type === "porte" || o.type === "placard" || o.type === "porte_fenetre") {
    // Le vantail tourne sur la face du mur du côté où il s'ouvre.
    const dedans = (o.sens?.cote || "interieur") === "interieur";
    const face = (p) => (dedans ? p : ext(p, e));
    const t1 = o.sens?.charniere === "t1";
    const gond = face(t1 ? g.p1 : g.p0), ferme = face(t1 ? g.p0 : g.p1);
    const ouvert = plus(gond, g.n, dedans ? g.largeur : -g.largeur);
    symbole.vantail = [gond, ouvert];
    symbole.arc = { centre: gond, rayon: g.largeur, debut: ouvert, fin: ferme };
  }
  return { ...base, rendu: "menuiserie", sens: o.sens ? { charniere: o.sens.charniere ?? null, cote: o.sens.cote ?? null } : null, ...geo, symbole };
}

export function construireScene({ releve, modele, metres = null, points_a_valider = [], reglages = {} } = {}) {
  const pieces = (releve?.pieces || []).filter((p) => (p.polygone || []).length >= 3);
  const E = modele?.existant || {};
  const mursModele = E.murs || [];
  const murParId = new Map(mursModele.map((m) => [m.id, m]));
  const elements = [], indications = [], hors_plan = [];
  const base = (id, type, calque, objet, etat = "existant", corps_etat = null) => ({ id, type, calque, objet, etat, corps_etat });

  // 1. Pièces : sol coloré, nom, surface (texte fourni par les métrés).
  const lignes = new Map((metres?.pieces || []).map((l) => [l.id, l]));
  for (const p of pieces) {
    const l = lignes.get(p.id), connue = l?.sol != null;
    const pole = poleInaccessibilite(p.polygone);
    const mp = (E.pieces || []).find((x) => x.id === p.id);
    elements.push({
      ...base(`piece:${p.id}`, "piece", "pieces", { type: "piece", id: p.id }, mp?.etat || "existant", mp?.corps_etat ?? null),
      polygone: p.polygone, type_piece: p.type ?? null, couleur: couleurPiece(p.type), nom: p.nom || "",
      surface: { texte: connue ? `${texteMetre(l.sol, l.approx?.sol)} m²` : texteMetre(null, false, l?.raison), connue },
      ancre: pole.point, rayon: pole.rayon,
    });
  }

  // 2. Murs pleins, jonctions, traits (épaisseur inconnue, limites).
  const G = geometrieMurs(releve, modele, reglages.tolerancesMurs);
  for (const b of G.murs) {
    const m = murParId.get(b.mur);
    elements.push({ ...base(m.id, "mur", "murs", { type: "mur", id: m.id }, m.etat, m.corps_etat), type_mur: m.type, polygone: b.polygone, epaisseur: m.epaisseur });
  }
  for (const j of G.jonctions) {
    elements.push({ ...base(j.id, "jonction", "murs", { type: "jonction", id: j.id }, "existant", CORPS_ETAT_MURS), murs: j.murs, polygone: j.polygone, source: j.source });
  }
  for (const t of G.traits) {
    const m = murParId.get(t.mur);
    elements.push({ ...base(m.id, "mur_trait", "murs", { type: "mur", id: m.id }, m.etat, m.corps_etat), type_mur: m.type, genre: t.genre, a: t.a, b: t.b, raison: t.raison });
  }

  // 3. Ouvertures. `null` = pas encore relevées : rien à dessiner, et on le dit.
  const sansRepere = [];
  if (!Array.isArray(releve?.ouvertures)) {
    indications.push({ code: "ouvertures_non_relevees", texte: TEXTES_INDICATION.ouvertures_non_relevees });
  } else {
    const parId = new Map((E.ouvertures || []).map((o) => [o.id, o]));
    for (const o of releve.ouvertures) {
      if (o.masque) continue;
      const mo = parId.get(o.id) || null;
      const minces = (mo?.murs_touches || []).map((id) => murParId.get(id)?.epaisseur).filter((e) => e > 0);
      const el = elementOuverture(releve, o, mo, mo ? murParId.get(mo.mur) : null, minces);
      if (el) elements.push(el); else sansRepere.push(o.id);
    }
  }

  // 4. Cotes intérieures automatiques (règle 9) : une par côté d'au moins
  //    30 cm, identifiant stable « cote:‹pièce›:‹côté› ». `reglages.cotes`
  //    permet de masquer ou de déplacer une cote sans la recalculer.
  for (const p of pieces) {
    const C = cotesPiece(p);
    for (const c of cotesInterieures(p)) {
      const id = `cote:${p.id}:${c.mur}`, r = reglages.cotes?.[id] || {};
      elements.push({
        ...base(id, "cote", "cotes", { type: "piece", id: p.id }, null),
        piece: p.id, cote: c.mur, a: c.a, b: c.b, n: vec(C[c.mur].n), longueur: c.longueur, texte: c.texte,
        masquee: r.masquee === true, decalage: Array.isArray(r.decalage) ? [r.decalage[0], r.decalage[1]] : null, doublon: null,
      });
    }
  }

  // Les deux faces d'une cloison qui avance dans UNE pièce (refend, poteau)
  // donnent deux fois la même cote : la seconde est marquée `doublon`.
  const cotes = new Map(elements.filter((e) => e.type === "cote").map((e) => [e.id, e]));
  for (const m of mursModele) {
    if (m.type !== "partage" || m.pieces.length !== 1 || m.faces.length !== 2) continue;
    const [c0, c1] = m.faces.map((f) => cotes.get(`cote:${f.piece}:${f.cote}`));
    if (!c0 || !c1 || c0 === c1 || c0.texte !== c1.texte) continue;
    if (m.faces.every((f, i) => f.t1 - f.t0 >= 0.9 * [c0, c1][i].longueur)) c1.doublon = c0.id;
  }

  // 5. Points à valider : repères orange sur les côtés qu'ils désignent.
  let numero = 0;
  for (const pv of points_a_valider || []) {
    const segments = (pv.cotes || []).map((x) => {
      const piece = pieces.find((p) => p.id === x.piece);
      const c = piece && cotesPiece(piece)[x.cote];
      return c ? { piece: x.piece, cote: x.cote, a: c.a, b: c.b, n: vec(c.n), L: c.L } : null;
    }).filter(Boolean);
    if (!segments.length) { hors_plan.push({ cle: pv.cle, texte: pv.texte || "" }); continue; }
    const long = segments.reduce((x, y) => (y.L > x.L + 1e-9 ? y : x));
    elements.push({
      ...base(`point:${pv.cle}`, "point_a_valider", "a_valider", { type: "point_a_valider", id: pv.cle }, null),
      cle: pv.cle, code: pv.code ?? null, nature: pv.nature ?? null, numero: ++numero, texte: pv.texte || "",
      segments: segments.map(({ L, ...s }) => s), ancre: { segment: segments.indexOf(long), point: milieu(long.a, long.b), n: long.n },
    });
  }

  // 6. Emplacements des tâches suivantes : rien n'est dessiné, et on le dit
  //    si le modèle en contient (une impossibilité reste visible).
  const reste = (modele?.equipements || []).length + (modele?.notes || []).length + (modele?.traits || []).length + (modele?.projet?.modifications || []).length;
  if (reste) indications.push({ code: "elements_non_dessines", texte: TEXTES_INDICATION.elements_non_dessines });

  const ordre = new Map(CALQUES_SCENE.map((c, i) => [c, i]));
  elements.sort((x, y) => ordre.get(x.calque) - ordre.get(y.calque));

  const pts = elements.flatMap((e) => e.polygone || (e.a ? [e.a, e.b] : []));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const emprise = pts.length
    ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    : { x0: 0, y0: 0, x1: 0, y1: 0 };

  const de = (type, f = () => true) => elements.filter((e) => e.type === type && f(e)).length;
  const dessines = new Set(elements.filter((e) => e.type === "mur" || e.type === "mur_trait").map((e) => e.id));
  return {
    version: VERSION_SCENE, unite: "m", emprise, calques: [...CALQUES_SCENE], elements, indications, hors_plan,
    bilan: {
      pieces: de("piece"),
      murs: de("mur"), jonctions: de("jonction"),
      murs_epaisseur_inconnue: de("mur_trait", (e) => e.genre === "epaisseur_inconnue"),
      limites: de("mur_trait", (e) => e.genre === "limite"),
      // Murs du modèle sans rien à dessiner, avec leur raison (raccords).
      murs_sans_element: mursModele.filter((m) => !dessines.has(m.id)).map((m) => ({ mur: m.id, raison: (G.sans_element.find((s) => s.mur === m.id) || {}).raison || "non_dessine" })),
      jonctions_ecartees: G.jonctions_ecartees,
      ouvertures: Array.isArray(releve?.ouvertures) ? {
        menuiseries: de("ouverture", (e) => e.rendu === "menuiserie"),
        a_valider: de("ouverture", (e) => e.rendu === "a_valider"),
        a_placer: de("ouverture", (e) => e.rendu === "a_placer"),
        sans_repere: sansRepere,
      } : null,
      cotes: de("cote"), cotes_masquees: de("cote", (e) => e.masquee),
      points_a_valider: de("point_a_valider"), points_hors_plan: hors_plan.length,
    },
  };
}
