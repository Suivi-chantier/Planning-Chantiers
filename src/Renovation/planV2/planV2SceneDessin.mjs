// ─────────────────────────────────────────────────────────────────────────────
// planV2SceneDessin — nouvel éditeur de plans : la scène (planV2Scene.mjs, en
// mètres) mise en page pour UNE ÉCHELLE, et rendue en formes simples.
//
// Module PUR : aucun DOM, aucune police installée, aucune horloge. Couvert par
// scripts/verif-plan-v2-scene.mjs.
//
// dessinerScene(scene, options) → le « dessin » :
//   { largeur, hauteur, fond,              // unités de sortie (y vers le bas)
//     projection: { x0, y1, marge, unites_par_metre },   // voir versDessin / versPlan
//     formes: [ … ],                       // dans l'ordre de dessin
//     etiquettes: [{ id, tient, … }],      // une par pièce
//     cotes: [{ id, visible, raison, … }], // affichées ou non À CETTE ÉCHELLE
//     zones_toucher: [ … ] }               // petits objets : au moins 44 px écran
// Les formes sont ce que la sortie SVG (planV2SceneSvg.mjs) écrit et ce que le
// composant de l'éditeur dessinera : aucune géométrie à refaire ailleurs.
//   { calque, element, type, role, interactif, forme, … }
//   forme "polygone" { points }            "ligne" { a, b }
//         "arc" { de, vers, rayon, sens }  "cercle" { cx, cy, rayon }
//         "rect" { cx, cy, largeur, hauteur, angle, rayon }
//         "texte" { x, y, texte, taille, gras, angle }   // centré sur (x, y)
//   style : remplissage, trait, epaisseur, tirets, opacite, couleur (texte).
// `element` est l'identifiant de l'élément de scène (donc de l'objet métier).
//
// OPTIONS
//   unitesParMetre   échelle : unités de sortie pour 1 m (défaut 50). À
//                    l'écran, l'unité est le pixel ; à l'impression au 1/50 en
//                    millimètres, 1 m = 20 unités.
//   facteurTailles   multiplie toutes les tailles de texte et de trait (défaut
//                    1 = pixels d'écran ; 0,2646 pour des millimètres).
//   tailles, couleurs  surcharges de TAILLES_DESSIN et COULEURS_PLAN
//   mesurerTexte     (texte, taille, { gras }) → largeur ; estimation à défaut
//   pxEcranParUnite  zoom d'affichage (défaut 1) : sert aux zones de toucher
//   titre            texte discret sous le plan
//   zonesToucher     true : les zones de toucher sont aussi rendues en formes
// ─────────────────────────────────────────────────────────────────────────────
import { placerEtiquette, placerCotes, mesurerTexteDefaut, boitesSeCroisent, angleLisible } from "./planV2SceneTextes.mjs";

export * from "./planV2SceneTextes.mjs";

// Règle 12 du cahier : existant en noir ou gris, à démolir en jaune, à créer
// en rouge. Règle 8 : l'orange est réservé à ce qui est « à valider ».
export const COULEURS_PLAN = Object.freeze({
  fond: "#ffffff",
  existant: "#2f3540", a_demolir: "#f2c200", a_creer: "#d92d20",
  a_valider: "#ea580c",
  menuiserie: "#111827", texte: "#1f2937", cote: "#4b5563", limite: "#8a94a3", discret: "#6b7280",
  fondEtiquette: "rgba(255,255,255,0.92)",
});

// Tailles en unités de sortie pour facteurTailles = 1 (pixels d'écran).
export const TAILLES_DESSIN = Object.freeze({
  marge: 28,
  etiquetteNom: 13, etiquetteSurface: 11.5, etiquetteMin: 8.5, etiquetteMarge: 3,
  cote: 9.5, coteEcart: 2.75, coteMarge: 3,
  pastille: 8.5, pastilleDecalage: 26,
  traitMur: 0.5, traitOuverture: 1.1, traitFin: 0.7, traitInconnu: 1.6, traitLimite: 0.9,
  tirets: [5, 3.5], pointilles: [2, 2.5],
  traitAValider: 1.8, tiretsAValider: [5, 3],
  repere: 8.5, repereTexte: 9.5, repereDecalage: 24, repereRetrait: 2.5, traitRepere: 1.8,
  titre: 10.5, interligne: 1.6,
});

// Règle 10 : zone à toucher d'au moins 44 px à l'écran.
export const TOUCHER_MIN_PX = 44;

// Passage du plan (m, y vers le haut) au dessin (unités, y vers le bas), et retour.
export const versDessin = (pr, p) => [pr.marge + (p[0] - pr.x0) * pr.unites_par_metre, pr.marge + (pr.y1 - p[1]) * pr.unites_par_metre];
export const versPlan = (pr, q) => [pr.x0 + (q[0] - pr.marge) / pr.unites_par_metre, pr.y1 - (q[1] - pr.marge) / pr.unites_par_metre];

const DEG = 180 / Math.PI;

export function dessinerScene(scene, options = {}) {
  const u = options.unitesParMetre > 0 ? options.unitesParMetre : 50;
  const k = options.facteurTailles > 0 ? options.facteurTailles : 1;
  const T = Object.fromEntries(Object.entries({ ...TAILLES_DESSIN, ...(options.tailles || {}) })
    .map(([nom, v]) => [nom, Array.isArray(v) ? v.map((x) => x * k) : v * k]));
  const C = { ...COULEURS_PLAN, ...(options.couleurs || {}) };
  const mesurer = options.mesurerTexte || mesurerTexteDefaut;
  const toucherMin = TOUCHER_MIN_PX / (options.pxEcranParUnite > 0 ? options.pxEcranParUnite : 1);
  const E = scene?.emprise || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const pr = { x0: E.x0, y1: E.y1, marge: T.marge, unites_par_metre: u };
  const S = (p) => versDessin(pr, p);
  const V = (v) => [v[0], -v[1]];                             // direction : y s'inverse
  const elements = scene?.elements || [];
  const pied = [options.titre, ...(scene?.indications || []).map((i) => i.texte)].filter(Boolean);
  const largeur = 2 * T.marge + (E.x1 - E.x0) * u;
  const hauteurPlan = 2 * T.marge + (E.y1 - E.y0) * u;
  const hauteur = hauteurPlan + pied.length * T.titre * T.interligne;

  const calques = new Map([...(scene?.calques || []), "toucher", "pied"].map((c) => [c, []]));
  const forme = (calque, el, role, f, interactif = false) => calques.get(calque).push({
    calque, element: el ? el.id : null, type: el ? el.type : null, role, interactif, ...f,
  });
  const ligne = (a, b, style) => ({ forme: "ligne", a: S(a), b: S(b), ...style });
  const occupees = [], zones = [];

  // 1. Pièces : un seul polygone par pièce, c'est LA zone à toucher de la pièce.
  const sols = new Map();
  for (const e of elements.filter((x) => x.type === "piece")) {
    const points = e.polygone.map(S);
    sols.set(e.objet.id, points);
    forme("pieces", e, "sol", { forme: "polygone", points, remplissage: e.couleur }, true);
  }

  // 2. Murs. Le contour, de la couleur du mur, ferme les joints d'un pixel
  //    entre deux éléments voisins.
  for (const e of elements) {
    if (e.type === "mur" || e.type === "jonction") {
      const couleur = C[e.etat] || C.existant;
      forme("murs", e, e.type, { forme: "polygone", points: e.polygone.map(S), remplissage: couleur, trait: couleur, epaisseur: T.traitMur }, e.type === "mur");
    } else if (e.type === "mur_trait") {
      // Épaisseur inconnue : un trait interrompu sur la face, jamais une bande.
      const inconnue = e.genre === "epaisseur_inconnue";
      forme("murs", e, inconnue ? "mur_epaisseur_inconnue" : "limite", ligne(e.a, e.b, inconnue
        ? { trait: C[e.etat] || C.existant, epaisseur: T.traitInconnu, tirets: T.tirets }
        : { trait: C.limite, epaisseur: T.traitLimite, tirets: T.pointilles }), inconnue);
    }
  }

  // 3. Étiquettes des pièces (avant les pastilles et les cotes, qui les évitent).
  const etiquettes = [];
  for (const e of elements.filter((x) => x.type === "piece")) {
    const pose = placerEtiquette(sols.get(e.objet.id), S(e.ancre), e.nom, e.surface.texte, T, mesurer);
    etiquettes.push({ id: e.id, tient: pose.tient, x: pose.x, y: pose.y, angle: pose.angle * DEG, boite: pose.boite });
    occupees.push(pose.boite);
    const b = pose.boite, co = Math.cos(pose.angle), si = Math.sin(pose.angle);
    if (!pose.tient) forme("etiquettes", e, "fond_etiquette", { forme: "rect", cx: b.cx, cy: b.cy, largeur: 2 * b.dl, hauteur: 2 * b.dh, angle: pose.angle * DEG, rayon: T.etiquetteMarge, remplissage: C.fondEtiquette });
    for (const l of pose.lignes) {
      forme("etiquettes", e, l.gras && pose.lignes.length > 1 ? "nom" : pose.lignes.length > 1 ? "surface" : "nom_surface", {
        forme: "texte", x: pose.x - l.dy * si, y: pose.y + l.dy * co, texte: l.texte, taille: l.taille, gras: l.gras, angle: pose.angle * DEG, couleur: C.texte,
      });
    }
  }

  // 4. Ouvertures.
  const ouvertures = elements.filter((x) => x.type === "ouverture");
  // Pastille de code : au milieu du segment [a, b], côté pièce ; glissée le
  // long du segment si elle tombe sur un texte déjà posé.
  const libre = (boites) => boites.find((x) => !occupees.some((o) => boitesSeCroisent(x, o))) || boites[0];
  const lelong = (a, b, n, recul, dl, dh) => [0.5, 0.35, 0.65, 0.2, 0.8].map((t) => ({
    cx: a[0] + (b[0] - a[0]) * t + n[0] * recul, cy: a[1] + (b[1] - a[1]) * t + n[1] * recul, dl, dh, angle: 0,
  }));
  const pastille = (e, a, b, texte, couleur, tirets) => {
    const w = mesurer(texte, T.pastille, { gras: true }) + T.pastille * 0.9, h = T.pastille * 1.55;
    const boite = libre(lelong(S(a), S(b), V(e.n), T.pastilleDecalage, w / 2, h / 2)), centre = [boite.cx, boite.cy];
    forme("ouvertures", e, "pastille", { forme: "rect", cx: centre[0], cy: centre[1], largeur: w, hauteur: h, angle: 0, rayon: h * 0.28, remplissage: C.fond, trait: couleur, epaisseur: T.traitFin, tirets });
    forme("ouvertures", e, "code", { forme: "texte", x: centre[0], y: centre[1], texte, taille: T.pastille, gras: true, angle: 0, couleur });
    occupees.push(boite);
    return centre;
  };
  const zoneRect = (e) => {
    const c = S(e.toucher.centre), d = V(e.toucher.u);
    zones.push({ element: e.id, forme: "rect", cx: c[0], cy: c[1], largeur: Math.max(2 * e.toucher.demi_longueur * u, toucherMin), hauteur: Math.max(2 * e.toucher.demi_epaisseur * u, toucherMin), angle: Math.atan2(d[1], d[0]) * DEG });
  };
  for (const e of ouvertures.filter((x) => x.rendu === "menuiserie")) {
    forme("ouvertures", e, "baie", { forme: "polygone", points: e.baie.map(S), remplissage: C.fond, trait: C.fond, epaisseur: T.traitMur }, true);
  }
  for (const e of ouvertures) {
    if (e.rendu === "menuiserie") {
      const plein = { trait: C.menuiserie, epaisseur: T.traitOuverture };
      for (const [a, b] of [...e.symbole.tableaux, ...e.symbole.lignes]) forme("ouvertures", e, "menuiserie", ligne(a, b, plein));
      for (const [a, b] of e.symbole.pointilles) forme("ouvertures", e, "menuiserie", ligne(a, b, { ...plein, tirets: T.pointilles }));
      if (e.symbole.vantail) {
        const { centre, rayon, debut, fin } = e.symbole.arc, c = S(centre), d = S(debut), f = S(fin);
        forme("ouvertures", e, "vantail", ligne(e.symbole.vantail[0], e.symbole.vantail[1], plein));
        // Sens de l'arc : celui qui va de « ouvert » à « fermé » par le plus court.
        const sens = (d[0] - c[0]) * (f[1] - c[1]) - (d[1] - c[1]) * (f[0] - c[0]) > 0 ? 1 : 0;
        forme("ouvertures", e, "debattement", { forme: "arc", de: d, vers: f, rayon: rayon * u, sens, trait: C.menuiserie, epaisseur: T.traitFin, tirets: T.pointilles });
      }
      if (e.code) pastille(e, e.p0, e.p1, e.code, C.menuiserie, null);
      if (e.symbole.arc) {
        // Le débattement de la porte est une zone prise : les cotes l'évitent.
        const P = [e.symbole.arc.centre, e.symbole.arc.debut, e.symbole.arc.fin].map(S), xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
        occupees.push({ cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, dl: (Math.max(...xs) - Math.min(...xs)) / 2, dh: (Math.max(...ys) - Math.min(...ys)) / 2, angle: 0 });
      }
      zoneRect(e);
    } else if (e.rendu === "a_valider") {
      // « À vérifier » : pas une menuiserie. Un trait orange interrompu dans
      // l'épaisseur du mur, fermé par deux petits traits, et le mur reste plein.
      const orange = { trait: C.a_valider, epaisseur: T.traitAValider };
      forme("ouvertures", e, "a_valider", ligne(e.marque[0], e.marque[1], { ...orange, tirets: T.tiretsAValider }));
      for (const [a, b] of e.bouts) forme("ouvertures", e, "a_valider", ligne(a, b, orange));
      zoneRect(e);
    } else if (e.rendu === "a_placer") {
      // Vue sur photo, position inconnue : une pastille orange « ? » au milieu du côté.
      const c = pastille(e, e.segment[0], e.segment[1], e.code ? `${e.code} ?` : "?", C.a_valider, T.pointilles);
      zones.push({ element: e.id, forme: "cercle", cx: c[0], cy: c[1], rayon: toucherMin / 2 });
    }
  }

  // 5. Points à valider : trait orange le long des côtés désignés (juste à
  //    l'intérieur de la pièce) et pastille numérotée, glissée le long du côté
  //    si elle tombe sur un texte.
  const points = elements.filter((x) => x.type === "point_a_valider");
  for (const e of points) {
    for (const s of e.segments) {
      const n = V(s.n), a = S(s.a), b = S(s.b), dec = (q) => [q[0] + n[0] * T.repereRetrait, q[1] + n[1] * T.repereRetrait];
      forme("a_valider", e, "cote_a_valider", { forme: "ligne", a: dec(a), b: dec(b), trait: C.a_valider, epaisseur: T.traitRepere });
    }
  }
  for (const e of points) {
    const s = e.segments[e.ancre.segment], a = S(s.a), b = S(s.b), n = V(s.n);
    const boite = libre(lelong(a, b, n, T.repereDecalage, T.repere, T.repere));
    occupees.push(boite);
    forme("a_valider", e, "repere", { forme: "cercle", cx: boite.cx, cy: boite.cy, rayon: T.repere, remplissage: C.fond, trait: C.a_valider, epaisseur: T.traitOuverture }, true);
    forme("a_valider", e, "numero", { forme: "texte", x: boite.cx, y: boite.cy, texte: String(e.numero), taille: T.repereTexte, gras: true, angle: 0, couleur: C.a_valider });
    zones.push({ element: e.id, forme: "cercle", cx: boite.cx, cy: boite.cy, rayon: Math.max(T.repere, toucherMin / 2) });
  }

  // 6. Cotes intérieures.
  const cotes = placerCotes(elements.filter((x) => x.type === "cote").map((e) => ({
    id: e.id, a: S(e.a), b: S(e.b), n: V(e.n), texte: e.texte, longueur: e.longueur, masquee: e.masquee, doublon: e.doublon,
    decalage: e.decalage ? [e.decalage[0] * u, -e.decalage[1] * u] : null, polygone: sols.get(e.piece),
  })), occupees, T, mesurer);
  const parId = new Map(elements.map((e) => [e.id, e]));
  for (const c of cotes) {
    if (c.visible) forme("cotes", parId.get(c.id), "cote", { forme: "texte", x: c.x, y: c.y, texte: c.texte, taille: T.cote, gras: false, angle: angleLisible(c.angle) * DEG, couleur: C.cote });
  }

  // 7. Zones de toucher (règle 10) et pied de plan (titre, indications).
  if (options.zonesToucher) {
    for (const z of zones) forme("toucher", parId.get(z.element), "zone_toucher", { ...z, remplissage: "transparent" }, true);
  }
  pied.forEach((texte, i) => forme("pied", null, i === 0 && options.titre ? "titre" : "indication", {
    forme: "texte", x: T.marge, y: hauteurPlan + (i + 0.3) * T.titre * T.interligne, texte, taille: T.titre, gras: false, angle: 0, couleur: C.discret, ancrage: "debut",
  }));

  return {
    largeur, hauteur, fond: C.fond, projection: pr,
    formes: [...calques.values()].flat(),
    etiquettes,
    cotes: cotes.map(({ boite, ...c }) => (c.visible ? { ...c, angle: c.angle * DEG } : c)),
    zones_toucher: zones,
  };
}
