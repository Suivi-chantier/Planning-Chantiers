// ─────────────────────────────────────────────────────────────────────────────
// EXPORT PDF D'UN PLAN — planche A4 PAYSAGE, VECTORIELLE, À L'ÉCHELLE.
//
// Avant : l'export « PDF » était une capture du canvas écran (PNG) collée dans
// une page — flou à l'impression, sans échelle, sans cadre ni cartouche.
// Ici le dessin est rejoué dans un ENREGISTREUR SVG (même moteur de rendu que
// l'écran : planRendu.dessinerScene + planDessin.drawLibSym, donc aucun risque
// de divergence) : le PDF obtenu est vectoriel — traits nets à tout zoom,
// fichier léger, texte sélectionnable.
//
// La planche est composée comme un plan de chantier :
//   • cadre au trait, dessin CENTRÉ et cadré à une ÉCHELLE NORMALISÉE
//     (1:20 … 1:200…) pour qu'une mesure à la règle sur le papier soit juste ;
//   • colonne de légende à droite : les symboles réellement posés sur le plan ;
//   • cartouche en pied : logo, nom du plan, chantier, échelle + réglet
//     graphique, date, surface, mention de vérification sur site.
// ─────────────────────────────────────────────────────────────────────────────
import { cadreDessin, calerVueEchelle, dessinerScene, LEGENDE_ROWS } from "./planRendu";
import { drawLibSym, calcSurface } from "./planDessin";

const OR = "#FFC200"; // jaune marque Profero
const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── Géométrie de la planche (millimètres) ───────────────────────────────────
const FEUILLE_W = 297, FEUILLE_H = 210;   // A4 paysage
const MARGE     = 7;                      // blanc de pince autour du cadre
const BORD      = 0.4;                    // épaisseur du filet du cadre
const CADRE_W   = FEUILLE_W - MARGE * 2;
const CADRE_H   = FEUILLE_H - MARGE * 2;
const CARTOUCHE_H = 26;
const LEGENDE_W   = 46;
const PX_MM       = 4;                    // px logiques du dessin par mm papier

// Échelles normalisées, de la plus fine à la plus large.
const ECHELLES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 2000, 5000];

// ═══════════════════════════════════════════════════════════════════════════
// ENREGISTREUR SVG — sous-ensemble de l'API Canvas 2D utilisé par le moteur
// de rendu des plans (planRendu + planDessin). Chaque opération de dessin est
// émise comme un élément SVG portant la transformation courante ; les tracés
// sont accumulés en données de chemin dans le repère local.
// ═══════════════════════════════════════════════════════════════════════════
const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mul = (m, n) => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
const estIdentite = (m) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
const n2 = (v) => (Math.round((v || 0) * 100) / 100).toString();

// Couleur canvas → { couleur, opacite } exploitable en attributs SVG
// (rgba(...) est accepté par les navigateurs, mais la paire fill/fill-opacity
// reste la forme la plus sûre à l'impression et dans les PDF produits).
function couleurSVG(v) {
  const s = (v == null ? "#000" : String(v)).trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (m) {
    const hex = "#" + [m[1], m[2], m[3]]
      .map(x => Math.max(0, Math.min(255, Math.round(parseFloat(x)))).toString(16).padStart(2, "0")).join("");
    return { couleur: hex, opacite: m[4] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(m[4]))) };
  }
  const h8 = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (h8) return { couleur: "#" + h8[1], opacite: parseInt(h8[2], 16) / 255 };
  return { couleur: s, opacite: 1 };
}

// "bold 12px sans-serif" → attributs de police SVG
function policeSVG(font) {
  const m = /^\s*(?:(italic|oblique)\s+)?(?:(bold|bolder|lighter|[1-9]00)\s+)?([\d.]+)px\s+(.+?)\s*$/.exec(font || "");
  if (!m) return { taille: 12, graisse: "normal", famille: "sans-serif", italique: false };
  return { taille: parseFloat(m[3]), graisse: m[2] || "normal", famille: m[4], italique: !!m[1] };
}

// Mesure de texte : un canvas hors écran partagé, avec la MÊME police que
// celle demandée — les fonds d'étiquettes calculés par le moteur de rendu
// gardent ainsi la bonne largeur en SVG.
let canvasMesure = null;
function mesurer(font, texte) {
  if (!canvasMesure && typeof document !== "undefined") {
    canvasMesure = document.createElement("canvas").getContext("2d");
  }
  if (!canvasMesure) return { width: (texte || "").length * 6 };
  canvasMesure.font = font;
  return { width: canvasMesure.measureText(texte || "").width };
}

export function contexteSVG() {
  const out = [];
  let etat = { ctm: I, fill: "#000", stroke: "#000", lineWidth: 1, font: "10px sans-serif", textAlign: "start", dash: null };
  const pile = [];
  let d = "";          // chemin en cours, déjà exprimé dans le repère du SVG
  let vide = true;

  const tr = (m) => estIdentite(m) ? "" : ` transform="matrix(${n2(m.a)},${n2(m.b)},${n2(m.c)},${n2(m.d)},${n2(m.e)},${n2(m.f)})"`;

  // Comme un vrai canvas, la transformation est APPLIQUÉE AUX POINTS au moment
  // où la commande de tracé est émise (et non au chemin entier à la peinture) :
  // un chemin peut être commencé sous une transformation puis complété sous une
  // autre — c'est exactement ce que fait l'étiquette de cote de dessinerScene,
  // qui enchaîne un roundRect sans beginPath après un translate/rotate.
  const P = (x, y) => {
    const m = etat.ctm;
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  };
  const ech = () => Math.hypot(etat.ctm.a, etat.ctm.b) || 1;  // facteur d'échelle (1 ici)
  const angDeg = () => Math.atan2(etat.ctm.b, etat.ctm.a) * 180 / Math.PI;
  const pousse = (cmd, x, y) => { const [px, py] = P(x, y); d += cmd + n2(px) + " " + n2(py); vide = false; };

  // Arc canvas → commande A du SVG (sens horaire = sweep 1, l'axe Y pointant
  // vers le bas). Un tour complet est scindé en deux demi-arcs.
  const arcVers = (x, y, rx, ry, a0, a1, ccw, rot) => {
    const r = rot || 0;
    let delta = ccw ? a0 - a1 : a1 - a0;
    while (delta < 0) delta += Math.PI * 2;
    const sweep = ccw ? 0 : 1;
    const pt = (a) => {
      const ca = Math.cos(a), sa = Math.sin(a), cr = Math.cos(r), sr = Math.sin(r);
      return P(x + rx * ca * cr - ry * sa * sr, y + rx * ca * sr + ry * sa * cr);
    };
    const k = ech();
    const RX = n2(rx * k), RY = n2(ry * k), ROT = n2(r * 180 / Math.PI + angDeg());
    const [sx, sy] = pt(a0);
    d += (vide ? "M" : "L") + n2(sx) + " " + n2(sy);
    vide = false;
    if (delta >= Math.PI * 2 - 1e-6) {
      const [mx, my] = pt(a0 + (ccw ? -Math.PI : Math.PI));
      d += "A" + RX + " " + RY + " " + ROT + " 0 " + sweep + " " + n2(mx) + " " + n2(my);
      d += "A" + RX + " " + RY + " " + ROT + " 0 " + sweep + " " + n2(sx) + " " + n2(sy);
    } else {
      const [ex, ey] = pt(ccw ? a0 - delta : a0 + delta);
      d += "A" + RX + " " + RY + " " + ROT + " " + (delta > Math.PI ? 1 : 0) + " " + sweep + " " + n2(ex) + " " + n2(ey);
    }
  };

  const ctx = {
    // ── état graphique ──
    save() { pile.push({ ...etat }); },
    restore() { if (pile.length) etat = pile.pop(); },
    translate(x, y) { etat.ctm = mul(etat.ctm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    rotate(a) {
      const co = Math.cos(a), si = Math.sin(a);
      etat.ctm = mul(etat.ctm, { a: co, b: si, c: -si, d: co, e: 0, f: 0 });
    },
    setTransform(a, b, c, dd, e, f) { etat.ctm = { a, b, c, d: dd, e, f }; },
    setLineDash(arr) { etat.dash = arr && arr.length ? arr.join(" ") : null; },
    get fillStyle() { return etat.fill; },        set fillStyle(v) { etat.fill = v; },
    get strokeStyle() { return etat.stroke; },    set strokeStyle(v) { etat.stroke = v; },
    get lineWidth() { return etat.lineWidth; },   set lineWidth(v) { etat.lineWidth = v; },
    get font() { return etat.font; },             set font(v) { etat.font = v; },
    get textAlign() { return etat.textAlign; },   set textAlign(v) { etat.textAlign = v; },
    get shadowBlur() { return 0; },               set shadowBlur(_v) { /* sans objet en vectoriel */ },
    get shadowColor() { return "transparent"; },  set shadowColor(_v) { /* idem */ },

    // ── construction de chemin ──
    beginPath() { d = ""; vide = true; },
    closePath() { if (!vide) d += "Z"; },
    moveTo(x, y) { pousse("M", x, y); },
    lineTo(x, y) { pousse(vide ? "M" : "L", x, y); },
    rect(x, y, w, h) {
      pousse("M", x, y); pousse("L", x + w, y); pousse("L", x + w, y + h); pousse("L", x, y + h);
      d += "Z";
    },
    roundRect(x, y, w, h, r) {
      const rr = Math.max(0, Math.min(Array.isArray(r) ? r[0] : (r || 0), Math.abs(w) / 2, Math.abs(h) / 2));
      const R = n2(rr * ech()), ROT = n2(angDeg());
      const arcVersPt = (px, py) => { const [ax, ay] = P(px, py); d += "A" + R + " " + R + " " + ROT + " 0 1 " + n2(ax) + " " + n2(ay); };
      pousse("M", x + rr, y);
      pousse("L", x + w - rr, y);  arcVersPt(x + w, y + rr);
      pousse("L", x + w, y + h - rr); arcVersPt(x + w - rr, y + h);
      pousse("L", x + rr, y + h);  arcVersPt(x, y + h - rr);
      pousse("L", x, y + rr);      arcVersPt(x + rr, y);
      d += "Z";
    },
    arc(x, y, r, a0, a1, ccw) { arcVers(x, y, r, r, a0, a1, !!ccw, 0); },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { arcVers(x, y, rx, ry, a0, a1, !!ccw, rot); },

    // ── peinture ──
    fill() {
      if (!d) return;
      const c = couleurSVG(etat.fill);
      out.push(`<path d="${d}" fill="${c.couleur}"${c.opacite < 1 ? ` fill-opacity="${n2(c.opacite)}"` : ""}/>`);
    },
    stroke() {
      if (!d) return;
      const c = couleurSVG(etat.stroke);
      out.push(`<path d="${d}" fill="none" stroke="${c.couleur}" stroke-width="${n2(etat.lineWidth * ech())}"`
        + `${c.opacite < 1 ? ` stroke-opacity="${n2(c.opacite)}"` : ""}`
        + `${etat.dash ? ` stroke-dasharray="${etat.dash}"` : ""}/>`);
    },
    fillRect(x, y, w, h) {
      const c = couleurSVG(etat.fill);
      out.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${c.couleur}"`
        + `${c.opacite < 1 ? ` fill-opacity="${n2(c.opacite)}"` : ""}${tr(etat.ctm)}/>`);
    },
    strokeRect(x, y, w, h) {
      const c = couleurSVG(etat.stroke);
      out.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="none" stroke="${c.couleur}"`
        + ` stroke-width="${n2(etat.lineWidth)}"${etat.dash ? ` stroke-dasharray="${etat.dash}"` : ""}${tr(etat.ctm)}/>`);
    },
    clearRect() { /* le fond de la planche est peint par la feuille */ },
    fillText(texte, x, y) {
      const t = (texte == null ? "" : String(texte));
      if (!t) return;
      const p = policeSVG(etat.font);
      const c = couleurSVG(etat.fill);
      const ancre = etat.textAlign === "center" ? "middle"
        : (etat.textAlign === "right" || etat.textAlign === "end") ? "end" : "start";
      out.push(`<text x="${n2(x)}" y="${n2(y)}" font-family="${esc(p.famille)}" font-size="${n2(p.taille)}"`
        + `${p.graisse !== "normal" ? ` font-weight="${p.graisse}"` : ""}${p.italique ? ` font-style="italic"` : ""}`
        + ` text-anchor="${ancre}" fill="${c.couleur}"${c.opacite < 1 ? ` fill-opacity="${n2(c.opacite)}"` : ""}`
        + ` xml:space="preserve"${tr(etat.ctm)}>${esc(t)}</text>`);
    },
    measureText(t) { return mesurer(etat.font, t); },

    // ── sortie ──
    corpsSVG() { return out.join(""); },
  };
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉCHELLE
// ═══════════════════════════════════════════════════════════════════════════
// Emprise du dessin une fois la rotation de plan appliquée (la rotation se
// fait autour du centre, l'encombrement papier change donc).
function emprisePapier(cadre, rotationDeg) {
  const r = ((parseFloat(rotationDeg) || 0) * Math.PI) / 180;
  const co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r));
  return { w: cadre.w * co + cadre.h * si, h: cadre.w * si + cadre.h * co };
}

// Plus petit dénominateur normalisé qui fait tenir le dessin dans la zone
// (marge de 6 % tout autour pour les cotes et symboles qui débordent).
// Retourne null si même 1:5000 ne suffit pas — la planche passe alors en
// cadrage libre, « hors échelle ».
export function choisirEchelle(cadre, rotationDeg, zoneWmm, zoneHmm) {
  const e = emprisePapier(cadre, rotationDeg);
  const dispoW = zoneWmm * 0.94, dispoH = zoneHmm * 0.94;
  for (const den of ECHELLES) {
    const mmParM = 1000 / den;
    if (e.w * mmParM <= dispoW && e.h * mmParM <= dispoH) return den;
  }
  return null;
}

// Réglet graphique : pas rond (0,1 m → 100 m) donnant une barre de 4 segments
// d'au moins 22 mm sur le papier.
function regletHTML(den) {
  const mmParM = 1000 / den;
  const pas = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find(u => u * 4 * mmParM >= 22) || 100;
  const segMM = pas * mmParM;
  const fmt = (v) => (v % 1 === 0 ? String(v) : String(v).replace(".", ","));
  const cases = [0, 1, 2, 3].map(i =>
    `<span style="display:inline-block;width:${segMM}mm;height:1.6mm;background:${i % 2 ? "#fff" : "#1a1f2e"};`
    + `border:0.25mm solid #1a1f2e;margin-left:${i ? "-0.25mm" : "0"};"></span>`).join("");
  const grads = [0, 2, 4].map(i =>
    `<span style="position:absolute;left:${i * segMM}mm;transform:translateX(-50%);font-size:5pt;color:#5a6172;">${fmt(i * pas)}</span>`).join("");
  return `<div style="margin-top:1.2mm;">
      <div style="font-size:0;line-height:0;white-space:nowrap;">${cases}</div>
      <div style="position:relative;height:2.6mm;width:${segMM * 4}mm;margin-top:0.6mm;">${grads}
        <span style="position:absolute;left:${segMM * 4 + 2}mm;font-size:5pt;color:#5a6172;">m</span>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LÉGENDE — uniquement les symboles RÉELLEMENT posés sur le plan
// ═══════════════════════════════════════════════════════════════════════════
const TOUTES_LIGNES = [...LEGENDE_ROWS.elec, ...LEGENDE_ROWS.plomb, ...LEGENDE_ROWS.chauff];

function legendeUtilisee(d) {
  const vues = new Map();
  (d?.symbols || []).forEach(sym => {
    if (sym.deleted || !sym.libSym || !sym.symType) return;
    if (sym.symType.startsWith("legende_")) return;  // tableau de légende déjà dessiné
    const cle = `${sym.symType}|${sym.label || ""}`;
    if (vues.has(cle)) { vues.get(cle).nb++; return; }
    const ref = TOUTES_LIGNES.find(r => r.symType === sym.symType && r.label === (sym.label || ""))
             || TOUTES_LIGNES.find(r => r.symType === sym.symType);
    vues.set(cle, {
      symType: sym.symType,
      label: sym.label || ref?.label || "",
      nom: ref?.name || sym.label || sym.symType,
      couleur: sym.color || ref?.color || "#1a1f2e",
      nb: 1,
    });
  });
  return [...vues.values()].sort((a, b) => a.nom.localeCompare(b.nom));
}

// Pictogramme vectoriel d'une ligne de légende (même tracé qu'à l'écran).
function vignetteSVG(symType, couleur, cote = 22) {
  const ctx = contexteSVG();
  ctx.translate(cote / 2, cote / 2);
  drawLibSym(ctx, symType, "", couleur, cote * 0.8, true);
  return `<svg viewBox="0 0 ${cote} ${cote}" width="5mm" height="5mm" style="display:block;">${ctx.corpsSVG()}</svg>`;
}

function colonneLegendeHTML(lignes) {
  if (!lignes.length) return "";
  // 5,4 mm par ligne : au-delà de ce que la colonne peut tenir, on tronque
  // plutôt que de déborder sur le dessin.
  const max = Math.max(1, Math.floor((CADRE_H - CARTOUCHE_H - 12) / 5.4));
  const visibles = lignes.slice(0, max);
  const reste = lignes.length - visibles.length;
  return `<div class="legende">
    <div class="legende-titre">Légende</div>
    ${visibles.map(l => `<div class="legende-ligne">
      <span class="legende-sym">${vignetteSVG(l.symType, l.couleur)}</span>
      <span class="legende-nom">${esc(l.nom)}</span>
      <span class="legende-nb">${l.nb}</span>
    </div>`).join("")}
    ${reste > 0 ? `<div class="legende-reste">+ ${reste} autre${reste > 1 ? "s" : ""} symbole${reste > 1 ? "s" : ""}</div>` : ""}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLANCHE A4 PAYSAGE
// ═══════════════════════════════════════════════════════════════════════════
//   data        : contenu du plan (plans.data)
//   nom         : nom du plan ; chantier : logement / chantier rattaché
//   logoUrl     : URL absolue du logo Profero
//   calques     : { segments, surfaces, cotes, symbols } — reprend l'affichage écran
//   coteFont    : taille du texte des cotes réglée dans l'éditeur
//   avecLegende : colonne de légende à droite (si des symboles sont posés)
export function buildPlanchePlanHTML({
  data, nom = "Plan", chantier = "", logoUrl = "", calques = null, coteFont = 12, avecLegende = true,
}) {
  const lignesLegende = avecLegende ? legendeUtilisee(data) : [];
  const legendeVisible = lignesLegende.length > 0;

  // Un tableau de légende posé DANS le plan (symbole legende_*) fait double
  // emploi avec la colonne, et son gabarit fixe déborde du cadre à petite
  // échelle : quand la colonne est là, il sort du dessin — cadrage compris.
  const dessine = legendeVisible
    ? { ...data, symbols: (data?.symbols || []).filter(s => !String(s.symType || "").startsWith("legende_")) }
    : data;
  const cadre = cadreDessin(dessine);

  const zoneW = CADRE_W - BORD * 2 - (legendeVisible ? LEGENDE_W + BORD : 0);
  const zoneH = CADRE_H - BORD * 2 - CARTOUCHE_H - BORD;
  const W = Math.round(zoneW * PX_MM), H = Math.round(zoneH * PX_MM);

  // Échelle normalisée si le dessin y tient, cadrage libre sinon.
  const den = cadre ? choisirEchelle(cadre, dessine?.planRotation, zoneW, zoneH) : null;
  const vp = !cadre ? null
    : den ? calerVueEchelle(cadre, W, H, (1000 / den) * PX_MM)
          : calerVueEchelle(cadre, W, H, Math.min(W / (cadre.w * 1.15), H / (cadre.h * 1.15)));

  const ctx = contexteSVG();
  if (vp) dessinerScene(ctx, dessine, W, H, vp, { calques, coteFont });
  const dessin = `<svg viewBox="0 0 ${W} ${H}" width="${zoneW}mm" height="${zoneH}mm"
    preserveAspectRatio="xMidYMid meet" style="display:block;" shape-rendering="geometricPrecision">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>${ctx.corpsSVG()}</svg>`;

  // Chiffres du cartouche
  const surfaces = (data?.surfaces || []).filter(s => !s.deleted && (s.points || []).length >= 3);
  const surfTot = surfaces.reduce((a, s) => a + calcSurface(s.points), 0);
  const nbSym = (data?.symbols || []).filter(s => !s.deleted && !String(s.symType || "").startsWith("legende_")).length;
  const nbCotes = (data?.cotes || []).filter(c => !c.deleted).length;
  const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const infos = [
    ["Date", date],
    surfTot > 0 ? ["Surface", `${surfTot.toFixed(1).replace(".", ",")} m²`] : null,
    ["Repères", `${nbSym} symb. · ${nbCotes} cotes`],
  ].filter(Boolean);

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>${esc(nom)}${chantier ? ` — ${esc(chantier)}` : ""}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#6b7280;}
  body{font-family:'Barlow',Arial,Helvetica,sans-serif;color:#1a1f2e;}
  .bc{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;}

  .feuille{width:${FEUILLE_W}mm;height:${FEUILLE_H}mm;background:#fff;margin:6mm auto;
    padding:${MARGE}mm;position:relative;box-shadow:0 2mm 6mm rgba(0,0,0,.35);}
  .cadre{width:100%;height:100%;border:${BORD}mm solid #1a1f2e;display:flex;flex-direction:column;overflow:hidden;}
  .haut{flex:1;display:flex;min-height:0;}
  .dessin{flex:1;min-width:0;overflow:hidden;background:#fff;}

  /* ── Colonne de légende ── */
  .legende{width:${LEGENDE_W}mm;flex:0 0 ${LEGENDE_W}mm;border-left:${BORD}mm solid #1a1f2e;padding:2mm 2.2mm;background:#fcfcfa;}
  .legende-titre{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:8pt;font-weight:800;
    letter-spacing:1.4pt;text-transform:uppercase;color:#1a1f2e;border-bottom:0.3mm solid ${OR};padding-bottom:0.8mm;margin-bottom:1.4mm;}
  .legende-ligne{display:flex;align-items:center;gap:1.4mm;height:5.4mm;border-bottom:0.15mm solid #ececec;}
  .legende-sym{flex:0 0 5mm;}
  .legende-nom{flex:1;min-width:0;font-size:6pt;color:#2a2f3a;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .legende-nb{flex:0 0 auto;font-size:5.5pt;font-weight:700;color:#8a90a0;}
  .legende-reste{margin-top:1.2mm;font-size:5.5pt;font-style:italic;color:#9aa0ab;}

  /* ── Cartouche ── */
  .cartouche{height:${CARTOUCHE_H}mm;flex:0 0 ${CARTOUCHE_H}mm;border-top:${BORD}mm solid #1a1f2e;display:flex;background:#fff;}
  .cell{padding:2mm 3mm;display:flex;flex-direction:column;justify-content:center;border-left:0.25mm solid #d4d7de;min-width:0;}
  .cell:first-child{border-left:0;}
  .cell-lab{font-size:5.5pt;font-weight:700;letter-spacing:1.3pt;text-transform:uppercase;color:#9aa0ab;}
  .c-logo{flex:0 0 42mm;align-items:flex-start;gap:1.6mm;background:#12151c;}
  .c-logo img{height:8mm;object-fit:contain;display:block;}
  .c-logo .sous{font-size:5.5pt;font-weight:700;letter-spacing:1.6pt;text-transform:uppercase;color:${OR};}
  .c-titre{flex:1;}
  .c-titre .nom{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:17pt;font-weight:800;
    line-height:1.05;letter-spacing:.4pt;color:#12151c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .c-titre .ch{font-size:8pt;font-weight:600;color:#5a6172;margin-top:0.4mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .c-titre .note{font-size:5.5pt;font-style:italic;color:#9aa0ab;margin-top:0.9mm;}
  .c-ech{flex:0 0 58mm;}
  .c-ech .val{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:15pt;font-weight:800;color:#12151c;line-height:1;}
  .c-info{flex:0 0 44mm;gap:0.7mm;}
  .c-info .l{display:flex;justify-content:space-between;align-items:baseline;gap:2mm;}
  .c-info .k{font-size:5.5pt;font-weight:700;letter-spacing:1pt;text-transform:uppercase;color:#9aa0ab;}
  .c-info .v{font-size:8pt;font-weight:700;color:#12151c;white-space:nowrap;}

  @page{size:A4 landscape;margin:0;}
  @media print{
    html,body{background:#fff;}
    .feuille{margin:0;box-shadow:none;}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  }
</style></head><body>
<div class="feuille"><div class="cadre">

  <div class="haut">
    <div class="dessin">${dessin}</div>
    ${legendeVisible ? colonneLegendeHTML(lignesLegende) : ""}
  </div>

  <div class="cartouche">
    <div class="cell c-logo">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="Profero"/>` : `<div class="bc" style="color:#fff;font-size:14pt;font-weight:800;">PROFERO</div>`}
      <div class="sous">Plan de chantier</div>
    </div>
    <div class="cell c-titre">
      <div class="nom bc">${esc(nom)}</div>
      ${chantier ? `<div class="ch">${esc(chantier)}</div>` : ""}
      <div class="note">Cotes en mètres — à vérifier sur site avant exécution.</div>
    </div>
    <div class="cell c-ech">
      <div class="cell-lab">Échelle</div>
      <div class="val">${den ? `1:${den}` : "Hors échelle"}</div>
      ${den ? regletHTML(den) : `<div style="font-size:5.5pt;color:#9aa0ab;margin-top:1mm;">Dessin trop grand pour une échelle normalisée en A4.</div>`}
    </div>
    <div class="cell c-info">
      ${infos.map(([k, v]) => `<div class="l"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
    </div>
  </div>

</div></div>
</body></html>`;
}

// ── Ouverture de la fenêtre d'impression. À appeler DANS le geste du clic
//    (sinon le navigateur bloque la fenêtre comme popup). ────────────────────
export function imprimerPlanA4(opts) {
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return false; }
  const html = buildPlanchePlanHTML(opts);
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = `${opts.nom || "Plan"}${opts.chantier ? ` - ${opts.chantier}` : ""}`;
  // Attendre les polices (Barlow) : sinon le cartouche s'imprime en repli.
  const go = () => setTimeout(() => { w.focus(); w.print(); }, 250);
  w.onload = () => { (w.document.fonts?.ready || Promise.resolve()).then(go, go); };
  return true;
}
