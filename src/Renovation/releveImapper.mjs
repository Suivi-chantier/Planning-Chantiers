// ─────────────────────────────────────────────────────────────────────────────
// releveImapper — import d'un relevé iMapper (DXF « plan éditable » + PDF
// « pour les devis ») en une couche sémantique `plans.data.releve` : pièces,
// murs, photos rattachées aux murs, points bruts, scanners, alertes ; et calcul
// des métrés par pièce.
//
// Module PUR : aucun réseau, aucun React, aucune horloge (la date d'import
// arrive en paramètre). Le navigateur lit les fichiers (releveImapperImport.js),
// ce module ne reçoit que du texte, des octets et des listes de mots.
// Couvert par scripts/verif-releve-imapper.mjs.
//
// RÈGLES :
//  • Les dimensions viennent TOUJOURS de la géométrie du DXF, jamais d'ailleurs.
//    Les PDF ne servent qu'à reconnaître la pièce et à rattacher les photos.
//  • Une impossibilité reste visible : tant que les ouvertures ne sont pas
//    relevées (`releve.ouvertures === null`), plinthes et murs nets valent
//    null avec leur raison — jamais le périmètre ou les murs bruts déguisés.
//  • Repère : celui de l'éditeur (Y inversé, comme parseDXF de Plans.jsx), en
//    mètres. Tout ce qui est importé subit la même inversion.
// ─────────────────────────────────────────────────────────────────────────────

export const VERSION_RELEVE = 1;
export const HSP_DEFAUT = 2.5;
export const HAUTEURS_DEFAUT = { porte: 2.04, porte_fenetre: 2.15, fenetre: 1.45, baie: 2.2, placard: 2.04 };
export const MSG_DXF_SANS_PIECES = "Lancez le plan automatique sur iMapper avant d'exporter.";

// Tolérances de rapprochement PDF ↔ pièce (spécification, étape 6).
const TOL_AIRE_M2 = 0.02;
const TOL_LONGUEUR_MM = 5;

// ── Types de pièce : liste fermée + couleur pastel (lisible en impression) ──
export const TYPES_PIECE = [
  { id: "sejour",        label: "Séjour",        couleur: "#dbe7f5" },
  { id: "chambre",       label: "Chambre",       couleur: "#f5e1cc" },
  { id: "cuisine",       label: "Cuisine",       couleur: "#e1eedb" },
  { id: "salle_de_bain", label: "Salle de bain", couleur: "#d6ebee" },
  { id: "salle_d_eau",   label: "Salle d'eau",   couleur: "#d9ecee" },
  { id: "wc",            label: "WC",            couleur: "#e3eef5" },
  { id: "entree",        label: "Entrée",        couleur: "#f1e8d0" },
  { id: "degagement",    label: "Dégagement",    couleur: "#ecebe6" },
  { id: "buanderie",     label: "Buanderie",     couleur: "#e6e0f2" },
  { id: "cellier",       label: "Cellier",       couleur: "#ebe4d8" },
  { id: "autre",         label: "Autre",         couleur: "#eceff3" },
];
const TYPE_PAR_ID = Object.fromEntries(TYPES_PIECE.map((t) => [t.id, t]));
export const couleurPiece = (type) => (TYPE_PAR_ID[type] || TYPE_PAR_ID.autre).couleur;

// iMapper tronque le nom de la pièce à 5 caractères dans le nom du calque.
// « Salle » peut être une salle de bain ou une salle d'eau : on retient
// « Salle d'eau » (cas le plus courant en rénovation), corrigeable.
const NOMS_TRONQUES = {
  salon: ["Salon", "sejour"], sejou: ["Séjour", "sejour"], sejour: ["Séjour", "sejour"],
  chamb: ["Chambre", "chambre"], buand: ["Buanderie", "buanderie"],
  salle: ["Salle d'eau", "salle_d_eau"], bain: ["Salle de bain", "salle_de_bain"],
  sdb: ["Salle de bain", "salle_de_bain"], sde: ["Salle d'eau", "salle_d_eau"],
  cuisi: ["Cuisine", "cuisine"], entre: ["Entrée", "entree"],
  wc: ["WC", "wc"], toile: ["WC", "wc"],
  degag: ["Dégagement", "degagement"], coulo: ["Dégagement", "degagement"],
  palie: ["Dégagement", "degagement"], hall: ["Entrée", "entree"],
  celli: ["Cellier", "cellier"], cave: ["Cellier", "cellier"],
  burea: ["Bureau", "autre"], dress: ["Dressing", "autre"], garag: ["Garage", "autre"],
};
const sansAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// Nom tronqué → { nom, type, connu }. Un nom inconnu reste tel quel.
export function traduireNomPiece(brut) {
  const cle = sansAccents(brut).toLowerCase().replace(/[^a-z]/g, "");
  const t = NOMS_TRONQUES[cle];
  if (t) return { nom: t[0], type: t[1], connu: true };
  return { nom: String(brut || "").trim() || "Pièce", type: "autre", connu: false };
}

// ── Géométrie ───────────────────────────────────────────────────────────────
export function airePolygone(P) {
  let a = 0;
  for (let k = 0; k < P.length; k++) {
    const [x1, y1] = P[k], [x2, y2] = P[(k + 1) % P.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
export const longueursCotes = (P) => P.map((p, k) => {
  const q = P[(k + 1) % P.length];
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
});
export const perimetrePolygone = (P) => longueursCotes(P).reduce((a, b) => a + b, 0);

export function pointDansPoly(pt, P) {
  let dedans = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    const [xi, yi] = P[a], [xj, yj] = P[b];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function distancePointSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export function distancePointPolygone(p, P) {
  if (pointDansPoly(p, P)) return 0;
  let d = Infinity;
  for (let k = 0; k < P.length; k++) d = Math.min(d, distancePointSegment(p, P[k], P[(k + 1) % P.length]));
  return d;
}

// Point d'ancrage de l'étiquette : centre de gravité de la surface s'il tombe
// dans la pièce, sinon la position du scanner (toujours dedans par construction).
export function ancrePiece(piece, scanners = {}) {
  const P = piece.polygone || [];
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < P.length; k++) {
    const [x1, y1] = P[k], [x2, y2] = P[(k + 1) % P.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) > 1e-9) {
    const c = [cx / (3 * a), cy / (3 * a)];
    if (pointDansPoly(c, P)) return c;
  }
  const s = scanners[piece.scan];
  if (s && pointDansPoly(s, P)) return s;
  return P.length ? [P.reduce((t, p) => t + p[0], 0) / P.length, P.reduce((t, p) => t + p[1], 0) / P.length] : [0, 0];
}

// Cotes intérieures : chaque côté d'au moins 0,30 m, en centimètres.
export const COTE_MIN_M = 0.3;
export function cotesInterieures(piece) {
  const P = piece.polygone || [];
  return longueursCotes(P)
    .map((l, k) => ({ mur: k, a: P[k], b: P[(k + 1) % P.length], longueur: l, texte: String(Math.round(l * 100)) }))
    .filter((c) => c.longueur >= COTE_MIN_M);
}

// ── Lecture DXF (R12 POLYLINE + VERTEX, LWPOLYLINE, POINT, TEXT) ───────────
// Lecteur par paires « code de groupe / valeur ». Conserve le nom de calque.
export function lireDXF(texte) {
  const lignes = String(texte || "").split(/\r?\n/);
  const paires = [];
  for (let i = 0; i + 1 < lignes.length; i += 2) paires.push([lignes[i].trim(), lignes[i + 1]]);
  let unites = null;
  const iUnites = paires.findIndex((p) => p[0] === "9" && p[1].trim() === "$INSUNITS");
  if (iUnites >= 0 && paires[iUnites + 1]) unites = parseInt(paires[iUnites + 1][1], 10);

  let i = paires.findIndex((p) => p[0] === "2" && p[1].trim() === "ENTITIES");
  const entites = [];
  if (i < 0) return { unites, polylignes: [], points: [], textes: [] };
  let cur = null;
  for (i++; i < paires.length; i++) {
    const [code, val] = paires[i];
    if (code === "0") {
      if (val.trim() === "ENDSEC") break;
      cur = { type: val.trim(), calque: "", codes: [] };
      entites.push(cur);
    } else if (cur) {
      if (code === "8") cur.calque = val.trim();
      cur.codes.push([code, val]);
    }
  }
  const num = (e, c) => { const v = e.codes.find((x) => x[0] === c); return v ? parseFloat(v[1]) : null; };
  const polylignes = [], points = [], textes = [];
  let pl = null;
  for (const e of entites) {
    if (e.type === "POLYLINE") {
      pl = { calque: e.calque, fermee: ((parseInt(e.codes.find((x) => x[0] === "70")?.[1], 10) || 0) & 1) === 1, sommets: [] };
      polylignes.push(pl);
    } else if (e.type === "VERTEX") {
      const x = num(e, "10"), y = num(e, "20");
      if (pl && x != null && y != null) pl.sommets.push([x, y]);
    } else if (e.type === "SEQEND") {
      pl = null;
    } else if (e.type === "LWPOLYLINE") {
      const s = [];
      for (const [c, v] of e.codes) {
        if (c === "10") s.push([parseFloat(v), null]);
        else if (c === "20" && s.length) s[s.length - 1][1] = parseFloat(v);
      }
      polylignes.push({
        calque: e.calque,
        fermee: ((parseInt(e.codes.find((x) => x[0] === "70")?.[1], 10) || 0) & 1) === 1,
        sommets: s.filter((p) => p[1] != null),
      });
    } else if (e.type === "POINT") {
      const x = num(e, "10"), y = num(e, "20");
      if (x != null && y != null) points.push({ calque: e.calque, x, y });
    } else if (e.type === "TEXT") {
      const t = e.codes.find((x) => x[0] === "1");
      textes.push({ calque: e.calque, x: num(e, "10"), y: num(e, "20"), texte: t ? t[1] : "" });
    }
  }
  return { unites, polylignes, points, textes };
}

// Calque de scan : V-SURV-PTS-Scan_<projet>_<scan>_<nom> (ou V-SURV-ORIG-…).
const RE_SCAN = /^V-SURV-(PTS|ORIG)-Scan_([^_]+)_([^_]+)_(.*)$/;
export function lireCalqueScan(calque) {
  const m = RE_SCAN.exec(String(calque || ""));
  return m ? { genre: m[1], projet: m[2], scan: m[3], nom: m[4] } : null;
}

const r4 = (v) => Math.round(v * 10000) / 10000;   // 0,1 mm : pièces et murs
const r3 = (v) => Math.round(v * 1000) / 1000;     // 1 mm : points bruts
const fr = (n, d = 2) => n.toFixed(d).replace(".", ",");

// DXF → squelette du relevé (sans PDF ni photos).
// Retourne { ok:true, releve } ou { ok:false, erreur }.
export function releveDepuisDXF(texte, { maintenant = null } = {}) {
  const dxf = lireDXF(texte);
  const brutes = dxf.polylignes.filter((p) => p.calque === "A-AREA-ONE-POLYLINE" && p.sommets.length >= 3);
  if (!brutes.length) return { ok: false, erreur: MSG_DXF_SANS_PIECES };
  // Unités : iMapper exporte en mètres ($INSUNITS = 6). Autre chose = refus,
  // plutôt qu'un plan à la mauvaise échelle présenté comme juste.
  if (dxf.unites != null && dxf.unites !== 6 && dxf.unites !== 0) {
    return { ok: false, erreur: `Le DXF n'est pas en mètres (unité ${dxf.unites}). Réexportez « pour AutoCAD (plan éditable) » depuis iMapper.` };
  }
  const murs = dxf.polylignes.filter((p) => p.calque === "A-WALL" && p.sommets.length >= 3);

  // Points bruts et position des scanners, par numéro de scan.
  const pointsParScan = {}, scanners = {}, nomsScan = {};
  let projet = null;
  for (const p of dxf.points) {
    const c = lireCalqueScan(p.calque);
    if (!c) continue;
    projet = projet || c.projet;
    nomsScan[c.scan] = c.nom;
    if (c.genre === "PTS") (pointsParScan[c.scan] ||= []).push([p.x, p.y]);
    else scanners[c.scan] = [p.x, p.y];
  }

  // Inversion de Y sur TOUT ce qui est importé (même règle que parseDXF).
  let maxY = -Infinity;
  const toutY = (P) => P.forEach((q) => { if (q[1] > maxY) maxY = q[1]; });
  brutes.forEach((p) => toutY(p.sommets));
  murs.forEach((p) => toutY(p.sommets));
  Object.values(pointsParScan).forEach(toutY);
  toutY(Object.values(scanners));
  if (!isFinite(maxY)) maxY = 0;
  const inv = (q, arr = r4) => [arr(q[0]), arr(maxY - q[1])];

  const polysPieces = brutes.map((p) => p.sommets.map((q) => inv(q)));
  const scannersInv = Object.fromEntries(Object.entries(scanners).map(([k, q]) => [k, inv(q)]));
  const alertes = [];

  // Nommage : le scanner situé dans la pièce.
  const scansUtilises = new Set();
  const pieces = polysPieces.map((P, k) => {
    const dedans = Object.keys(scannersInv).filter((s) => pointDansPoly(scannersInv[s], P));
    const id = `p${k + 1}`;
    let nom = `Pièce ${k + 1}`, type = "autre", scan = null, nomSource = null;
    if (!dedans.length) {
      alertes.push({ code: "piece_sans_scan", piece: id, texte: `${nom} : aucun scanner à l'intérieur, nom à saisir.` });
    } else {
      scan = dedans[0];
      dedans.forEach((s) => scansUtilises.add(s));
      nomSource = nomsScan[scan] || "";
      const t = traduireNomPiece(nomSource);
      nom = t.nom; type = t.type;
      if (!t.connu) alertes.push({ code: "nom_inconnu", piece: id, texte: `Nom de pièce « ${nomSource} » non reconnu : à corriger.` });
      if (dedans.length > 1) {
        alertes.push({ code: "piece_plusieurs_scans", piece: id,
          texte: `${nom} : ${dedans.length} scanners dans la même pièce (scans ${dedans.join(", ")}), le nom du scan ${scan} est retenu.` });
      }
    }
    return {
      id, nom, nom_source: nomSource, type, scan,
      polygone: P,
      hsp: HSP_DEFAUT, hsp_statut: "defaut",
      pdf: null, photos: [], observations: [],
      statut: "a_valider",
    };
  });

  // Deux scans du même nom (« Chambre », « Chambre ») : on numérote.
  const parNom = {};
  pieces.forEach((p) => (parNom[p.nom] ||= []).push(p));
  Object.values(parNom).forEach((grp) => { if (grp.length > 1) grp.forEach((p, i) => { p.nom = `${p.nom} ${i + 1}`; }); });

  // Scanners hors de toute pièce : alerte « scan isolé », ignorés pour la suite.
  const points = {}, scannersGardes = {};
  for (const s of Object.keys({ ...pointsParScan, ...scanners })) {
    if (scannersInv[s] && !scansUtilises.has(s)) {
      const d = Math.min(...polysPieces.map((P) => distancePointPolygone(scannersInv[s], P)));
      alertes.push({
        code: "scan_isole", scan: s,
        texte: `Scan « ${s} ${traduireNomPiece(nomsScan[s]).nom} » isolé à ${fr(d, 0)} m du logement : ignoré. À supprimer ou recaler sur iMapper.`,
      });
      continue;
    }
    if (pointsParScan[s]) points[s] = pointsParScan[s].map((q) => inv(q, r3));
    if (scannersInv[s]) scannersGardes[s] = scannersInv[s];
  }

  return {
    ok: true,
    releve: {
      version: VERSION_RELEVE,
      source: { outil: "imapper", projet, importe_le: maintenant, fichiers: [] },
      pieces,
      murs: murs.map((p) => ({ polygone: p.sommets.map((q) => inv(q)) })),
      // null = pas encore relevées (lot 2) — à distinguer de [] (aucune ouverture).
      ouvertures: null,
      points,
      scanners: scannersGardes,
      alertes,
    },
  };
}

// ── PDF « pour les devis » ─────────────────────────────────────────────────
// Entrée : les mots de chaque page tels que pdf.js les donne
// ({ str, x, y } — x/y = transform[4]/[5]). Sortie :
// { piece_num, aire_m2, perimetre_mm, murs:[{ photo, type, longueur_mm, angle }] }.
const nombreFr = (s) => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));

export function lirePdfImapper(page1 = [], page2 = []) {
  const texte1 = page1.map((m) => m.str).join(" ").replace(/\s+/g, " ");
  const mAire = /Aire\s*:\s*([\d.,]+)\s*m/.exec(texte1);
  const mPer = /P[ée]rim[èe]tre\s*:\s*([\d\s.,]+?)\s*mm/.exec(texte1);
  const mNum = /Pi[èe]ce\s*#\s*(\d+)/.exec(texte1);

  // Page 2 : regroupement par ligne (même ordonnée à 2 pt près).
  const lignes = [];
  page2.filter((m) => String(m.str).trim()).forEach((m) => {
    let l = lignes.find((x) => Math.abs(x.y - m.y) <= 2);
    if (!l) { l = { y: m.y, mots: [] }; lignes.push(l); }
    l.mots.push(m);
  });
  lignes.sort((a, b) => b.y - a.y);   // de haut en bas
  const murs = [];
  for (const l of lignes) {
    const mots = l.mots.sort((a, b) => a.x - b.x).map((m) => String(m.str).trim());
    const iLong = mots.findIndex((s) => /^\d[\d\s]*mm$/.test(s));
    if (iLong < 0 || mots.some((s) => /Total|P[ée]rim[èe]tre/.test(s))) continue;
    const longueur_mm = nombreFr(mots[iLong].replace("mm", ""));
    const avant = mots.slice(0, iLong);
    const photo = avant.length && /^\d+$/.test(avant[0]) ? parseInt(avant[0], 10) : null;
    const type = avant.filter((s) => !/^\d+$/.test(s)).join(" ") || null;
    const ang = mots.slice(iLong + 1).find((s) => /°$/.test(s));
    murs.push({ photo, type, longueur_mm, angle: ang ? nombreFr(ang.replace("°", "")) : null });
  }
  return {
    piece_num: mNum ? parseInt(mNum[1], 10) : null,
    aire_m2: mAire ? nombreFr(mAire[1]) : null,
    perimetre_mm: mPer ? nombreFr(mPer[1]) : null,
    murs,
  };
}

// Images JPEG d'un PDF jsPDF, lues directement dans le fichier (aucune
// recompression) : objets /Subtype /Image /Filter /DCTDecode. On ne garde
// que les photos au format portrait 3:4 d'au moins 800 px (écarte le logo),
// dans l'ordre où la page les dessine (« /Ix Do ») — à défaut, l'ordre du
// fichier. Retourne [{ largeur, hauteur, octets: Uint8Array }].
export function extraireJpegsPdf(octets) {
  const u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let s = "";
  const PAS = 0x8000;
  for (let i = 0; i < u8.length; i += PAS) s += String.fromCharCode.apply(null, u8.subarray(i, i + PAS));

  const objets = new Map();
  const reObj = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = reObj.exec(s))) {
    const dico = m[2];
    if (!/\/Subtype\s*\/Image/.test(dico) || !/\/DCTDecode/.test(dico)) continue;
    const debut = reObj.lastIndex;
    const lg = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dico);
    let fin = lg && !lg[2] ? debut + parseInt(lg[1], 10) : s.indexOf("endstream", debut);
    if (fin < debut) continue;
    const largeur = parseInt(/\/Width\s+(\d+)/.exec(dico)?.[1], 10) || 0;
    const hauteur = parseInt(/\/Height\s+(\d+)/.exec(dico)?.[1], 10) || 0;
    objets.set(m[1], { largeur, hauteur, octets: u8.slice(debut, fin) });
  }

  // Ordre de dessin : ressources « /I1 40 0 R » + appels « /I1 Do ».
  const ressources = {};
  const reRes = /\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g;
  const blocXO = /\/XObject\s*<<([\s\S]*?)>>/.exec(s);
  if (blocXO) { let r; while ((r = reRes.exec(blocXO[1]))) ressources[r[1]] = r[2]; }
  const ordre = [];
  const reDo = /\/([A-Za-z0-9_.-]+)\s+Do\b/g;
  let d;
  while ((d = reDo.exec(s))) {
    const num = ressources[d[1]];
    if (num && objets.has(num) && !ordre.includes(num)) ordre.push(num);
  }
  const nums = ordre.length ? ordre : [...objets.keys()];
  return nums.map((n) => objets.get(n))
    .filter((im) => im.hauteur >= 800 && Math.min(im.largeur, im.hauteur) >= 600
      && Math.abs(im.largeur / im.hauteur - 3 / 4) < 0.02);
}

// ── Rapprochement PDF ↔ pièce : même aire (± 0,02 m²) et même périmètre (± 5 mm)
// pdfs : [{ nom, lecture: lirePdfImapper(...) }]. Retourne { affectations:
// Map(indexPdf → idPiece), alertes }.
export function rapprocherPdfs(pieces, pdfs) {
  const alertes = [];
  const candidats = pdfs.map((pdf) => pieces.filter((p) => {
    const l = pdf.lecture || {};
    if (l.aire_m2 == null || l.perimetre_mm == null) return false;
    return Math.abs(airePolygone(p.polygone) - l.aire_m2) <= TOL_AIRE_M2 + 0.005
      && Math.abs(perimetrePolygone(p.polygone) * 1000 - l.perimetre_mm) <= TOL_LONGUEUR_MM;
  }).map((p) => p.id));
  const affectations = new Map();
  const vise = {};
  candidats.forEach((c, i) => { if (c.length === 1) (vise[c[0]] ||= []).push(i); });
  pdfs.forEach((pdf, i) => {
    const c = candidats[i];
    if (!c.length) {
      const l = pdf.lecture || {};
      alertes.push({ code: "pdf_sans_piece", pdf: pdf.nom,
        texte: `PDF « ${pdf.nom} » (aire ${l.aire_m2 != null ? fr(l.aire_m2) : "?"} m², périmètre ${l.perimetre_mm ?? "?"} mm) : aucune pièce du plan ne correspond. Rapprochement manuel.` });
    } else if (c.length > 1) {
      alertes.push({ code: "pdf_ambigu", pdf: pdf.nom,
        texte: `PDF « ${pdf.nom} » : plusieurs pièces possibles. Rapprochement manuel.` });
    } else if (vise[c[0]].length > 1) {
      alertes.push({ code: "pdf_ambigu", pdf: pdf.nom,
        texte: `PDF « ${pdf.nom} » : une autre pièce du relevé vise la même pièce. Rapprochement manuel.` });
    } else {
      affectations.set(i, c[0]);
    }
  });
  pieces.forEach((p) => {
    if (![...affectations.values()].includes(p.id)) {
      alertes.push({ code: "piece_sans_pdf", piece: p.id, texte: `${p.nom} : aucun PDF iMapper rapproché, pas de photo.` });
    }
  });
  return { affectations, alertes };
}

// ── Rattachement photo ↔ mur ───────────────────────────────────────────────
// Le tableau de la page 2 liste les murs dans l'ordre du tour de la pièce.
// On cherche le décalage (et le sens) qui fait coïncider TOUTE la suite des
// longueurs avec les côtés du polygone (± 5 mm chacun). Sur le relevé de
// référence, iMapper liste les côtés en sens inverse, en partant du dernier :
// c'est la convention retenue pour départager une pièce symétrique (rectangle).
// Si la suite n'a pas la même taille que le polygone, chaque ligne est
// rattachée au seul côté de même longueur, ou à aucun.
export function rattacherPhotosMurs(polygone, mursPdf) {
  const L = longueursCotes(polygone).map((l) => l * 1000);
  const n = L.length;
  const proche = (a, b) => Math.abs(a - b) <= TOL_LONGUEUR_MM;
  const lignes = mursPdf || [];
  let indices = null, mode = "aucun";

  if (lignes.length === n && n > 0) {
    const valides = [];
    for (const sens of [-1, 1]) {
      for (let o = 0; o < n; o++) {
        const idx = lignes.map((_, j) => (((o + sens * j) % n) + n) % n);
        if (idx.every((k, j) => proche(L[k], lignes[j].longueur_mm))) valides.push({ sens, o, idx });
      }
    }
    if (valides.length === 1) { indices = valides[0].idx; mode = "unique"; }
    else if (valides.length > 1) {
      const conv = valides.find((v) => v.sens === -1 && v.o === n - 1);
      if (conv) { indices = conv.idx; mode = "convention"; }
      else mode = "ambigu";
    }
  }
  if (!indices && mode !== "ambigu") {
    indices = lignes.map((l) => {
      const k = L.map((x, i) => (proche(x, l.longueur_mm) ? i : -1)).filter((i) => i >= 0);
      return k.length === 1 ? k[0] : null;
    });
    mode = "ligne_a_ligne";
  }
  const parPhoto = {};
  lignes.forEach((l, j) => { if (l.photo != null) parPhoto[l.photo] = indices ? indices[j] : null; });
  return { parPhoto, mode };
}

// ── Assemblage : DXF + PDF lus → relevé complet (photos sans chemin) ───────
// pdfs : [{ nom, lecture, nbPhotos }]. Les photos portent `chemin: null`
// jusqu'à leur envoi dans le stockage privé (fait par l'appelant).
export function assemblerReleve({ dxfTexte, pdfs = [], maintenant = null }) {
  const base = releveDepuisDXF(dxfTexte, { maintenant });
  if (!base.ok) return base;
  const releve = base.releve;
  const { affectations, alertes } = rapprocherPdfs(releve.pieces, pdfs);
  releve.alertes.push(...alertes);

  affectations.forEach((pieceId, i) => {
    const pdf = pdfs[i];
    const piece = releve.pieces.find((p) => p.id === pieceId);
    const { parPhoto, mode } = rattacherPhotosMurs(piece.polygone, pdf.lecture.murs);
    piece.pdf = { nom: pdf.nom, piece_num: pdf.lecture.piece_num };
    piece.photos = Array.from({ length: pdf.nbPhotos || 0 }, (_, k) => ({
      num: k + 1, chemin: null, mur: parPhoto[k + 1] ?? null,
    }));
    if (mode === "ambigu") {
      releve.alertes.push({ code: "photos_murs_ambigu", piece: piece.id,
        texte: `${piece.nom} : pièce symétrique, les photos n'ont pas pu être rattachées à un mur précis.` });
    }
    if ((pdf.nbPhotos || 0) !== 10) {
      releve.alertes.push({ code: "photos_nombre", piece: piece.id,
        texte: `${piece.nom} : ${pdf.nbPhotos || 0} photo(s) trouvée(s) dans le PDF au lieu de 10.` });
    }
  });
  return { ok: true, releve };
}

// Nom de fichier d'une photo dans le stockage : ‹scan›_‹n°›.jpg.
export const nomFichierPhoto = (piece, num) => `${piece.scan || piece.id}_${String(num).padStart(2, "0")}.jpg`;

// Après envoi dans le stockage privé : reporte les chemins dans le relevé.
// chemins : { "‹idPièce›#‹n°›": chemin } ; fichiers : [{ nom, chemin }] (DXF
// et PDF d'origine). Seuls les CHEMINS sont enregistrés, jamais d'URL.
export function appliquerCheminsPhotos(releve, chemins = {}, fichiers = []) {
  if (!releve) return releve;
  return {
    ...releve,
    source: { ...(releve.source || {}), fichiers: [...((releve.source || {}).fichiers || []), ...fichiers] },
    pieces: (releve.pieces || []).map((p) => ({
      ...p,
      photos: (p.photos || []).map((ph) => {
        const c = chemins[`${p.id}#${ph.num}`];
        return c ? { ...ph, chemin: c } : ph;
      }),
    })),
  };
}

// ── Métrés par pièce ───────────────────────────────────────────────────────
// Options (décisions encore ouvertes, défauts = prototype du 15/10/2026) :
//   deduireAVerifier : les ouvertures « à vérifier » sont déduites (oui) ;
//   deduirePlacards  : les placards sont déduits des plinthes et des murs (non).
// Chaque valeur porte un drapeau `approx` quand elle dépend d'une hypothèse
// (hauteur par défaut, ouverture à vérifier) → affichée précédée de « ≈ ».
const TYPES_PLINTHE = new Set(["porte", "porte_fenetre", "baie"]);

export function calculerMetres(releve, {
  hauteurs = HAUTEURS_DEFAUT, deduireAVerifier = true, deduirePlacards = false,
} = {}) {
  const ouvertures = releve?.ouvertures;
  const connues = Array.isArray(ouvertures);
  const pieces = (releve?.pieces || []).map((p) => {
    const sol = airePolygone(p.polygone || []);
    const perimetre = perimetrePolygone(p.polygone || []);
    const hsp = Number(p.hsp) > 0 ? Number(p.hsp) : HSP_DEFAUT;
    const hspApprox = p.hsp_statut !== "mesuree";
    const ligne = {
      id: p.id, nom: p.nom,
      sol, perimetre, plafond: sol,
      murs_bruts: perimetre * hsp,
      approx: { murs_bruts: hspApprox, plinthes: false, murs_nets: hspApprox },
      plinthes: null, murs_nets: null, raison: null,
    };
    if (!connues) { ligne.raison = "ouvertures_non_relevees"; return ligne; }
    let plinthes = perimetre, nets = ligne.murs_bruts;
    ouvertures.forEach((o) => {
      if (o.masque) return;
      if (o.piece !== p.id && !(o.pieces_liees || []).includes(p.id)) return;
      if (o.statut === "a_verifier" && !deduireAVerifier) return;
      if (o.type === "placard" && !deduirePlacards) return;
      const largeur = Math.max(0, (o.t1 ?? 0) - (o.t0 ?? 0));
      const hauteur = Number(o.hauteur) > 0 ? Number(o.hauteur) : (hauteurs[o.type] ?? hauteurs.porte);
      const aVerifier = o.statut === "a_verifier";
      if (TYPES_PLINTHE.has(o.type) || o.type === "placard") {
        plinthes -= largeur;
        if (aVerifier) ligne.approx.plinthes = true;
      }
      nets -= largeur * hauteur;
      if (aVerifier || !(Number(o.hauteur) > 0)) ligne.approx.murs_nets = true;
    });
    ligne.plinthes = plinthes;
    ligne.murs_nets = nets;
    return ligne;
  });
  const somme = (k) => (pieces.some((l) => l[k] == null) ? null : pieces.reduce((a, l) => a + l[k], 0));
  const total = {
    sol: somme("sol"), perimetre: somme("perimetre"), plafond: somme("plafond"),
    murs_bruts: somme("murs_bruts"), plinthes: somme("plinthes"), murs_nets: somme("murs_nets"),
    approx: {
      murs_bruts: pieces.some((l) => l.approx.murs_bruts),
      plinthes: pieces.some((l) => l.approx.plinthes),
      murs_nets: pieces.some((l) => l.approx.murs_nets),
    },
    raison: connues ? null : "ouvertures_non_relevees",
  };
  return { pieces, total, hauteurs, ouverturesConnues: connues };
}

// Texte d'une valeur de métré : « ≈ 49,68 », ou la raison de son absence.
export const TEXTE_RAISON = { ouvertures_non_relevees: "en attente des ouvertures" };
export function texteMetre(valeur, approx = false, raison = null) {
  if (valeur == null) return TEXTE_RAISON[raison] || "non calculable";
  return `${approx ? "≈ " : ""}${fr(valeur)}`;
}

// ── Points à valider : alertes de l'import + hypothèses en cours ────────────
export function pointsAValider(releve) {
  if (!releve) return [];
  const liste = [...(releve.alertes || [])];
  const defaut = (releve.pieces || []).filter((p) => p.hsp_statut !== "mesuree");
  if (defaut.length) {
    liste.unshift({
      code: "hsp_defaut",
      texte: `Hauteur sous plafond ${fr(HSP_DEFAUT)} m appliquée par défaut à ${defaut.length === (releve.pieces || []).length ? "toutes les pièces" : `${defaut.length} pièce(s)`} : elle n'est pas mesurée. Elle change toutes les surfaces de murs.`,
    });
  }
  if (releve.ouvertures === null) {
    liste.push({ code: "ouvertures_non_relevees",
      texte: "Portes et fenêtres pas encore relevées : plinthes et murs nets ne sont pas calculés." });
  }
  return liste;
}

// Emprise du relevé (pièces + murs), en mètres — null si vide.
export function emprisesReleve(releve) {
  const pts = [
    ...(releve?.pieces || []).flatMap((p) => p.polygone || []),
    ...(releve?.murs || []).flatMap((m) => m.polygone || []),
  ];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
