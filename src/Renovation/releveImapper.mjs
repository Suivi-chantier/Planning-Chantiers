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

// iMapper tronque le nom de la pièce dans le nom du calque (5 caractères sur
// le relevé de référence, 6 sur d'autres projets : « Chamb », « chambr »,
// « Couloi », « SdB_t3 »). On reconnaît donc un DÉBUT de mot : le préfixe le
// plus long de la table gagne. « Salle » seul peut être une salle de bain ou
// une salle d'eau : on retient « Salle d'eau » (cas le plus courant), corrigeable.
const NOMS_TRONQUES = {
  salon: ["Salon", "sejour"], sejou: ["Séjour", "sejour"], studi: ["Studio", "sejour"],
  sallea: ["Salle à manger", "sejour"], salledeb: ["Salle de bain", "salle_de_bain"],
  chamb: ["Chambre", "chambre"], buand: ["Buanderie", "buanderie"],
  salle: ["Salle d'eau", "salle_d_eau"], bain: ["Salle de bain", "salle_de_bain"],
  sdb: ["Salle de bain", "salle_de_bain"], sde: ["Salle d'eau", "salle_d_eau"],
  cuisi: ["Cuisine", "cuisine"], entre: ["Entrée", "entree"],
  wc: ["WC", "wc"], toile: ["WC", "wc"],
  degag: ["Dégagement", "degagement"], coulo: ["Couloir", "degagement"],
  palie: ["Palier", "degagement"], hall: ["Entrée", "entree"],
  celli: ["Cellier", "cellier"], cave: ["Cave", "cellier"],
  burea: ["Bureau", "autre"], dress: ["Dressing", "autre"], garag: ["Garage", "autre"],
};
const PREFIXES = Object.keys(NOMS_TRONQUES).sort((a, b) => b.length - a.length);
const sansAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// Nom tronqué → { nom, type, connu }. Un nom inconnu reste tel quel (tirets
// bas remplacés par des espaces : « Pente_ » → « Pente »), à corriger.
export function traduireNomPiece(brut) {
  const cle = sansAccents(brut).toLowerCase().replace(/[^a-z]/g, "");
  const k = cle && PREFIXES.find((p) => cle.startsWith(p));
  if (k) { const t = NOMS_TRONQUES[k]; return { nom: t[0], type: t[1], connu: true }; }
  const propre = String(brut || "").replace(/_+/g, " ").trim();
  return { nom: propre || "Pièce", type: "autre", connu: false };
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

// ── Plusieurs versions du plan dans un même DXF ────────────────────────────
// Quand le plan automatique a été lancé plusieurs fois sur un projet iMapper,
// l'export DXF contient TOUTES les séries de pièces, superposées (cas réel :
// 17 pièces + 12 pièces, une même pièce présente deux fois). Les pièces d'une
// série se suivent dans le fichier ; une pièce qui recouvre une pièce déjà vue
// de la série en cours ouvre donc une nouvelle série. Aucune n'est choisie en
// silence : l'appelant fait choisir l'utilisateur (voir releveDepuisDXF).
function recouvrement(P, Q) {
  const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let dedans = 0, commun = 0;
  const N = 12;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const pt = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
    if (!pointDansPoly(pt, P)) continue;
    dedans++;
    if (pointDansPoly(pt, Q)) commun++;
  }
  return dedans ? commun / dedans : 0;
}
export const SEUIL_RECOUVREMENT = 0.3;
export function versionsDuPlan(polygones) {
  const blocs = [];
  let cur = [];
  polygones.forEach((P, i) => {
    const conflit = cur.some((j) => Math.max(recouvrement(P, polygones[j]), recouvrement(polygones[j], P)) > SEUIL_RECOUVREMENT);
    if (conflit) { blocs.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) blocs.push(cur);
  return blocs;
}

// Part des sommets de pièces posés sur le BORD d'un mur du DXF (± 1 cm) : les
// murs exportés ne correspondent qu'à UNE des versions du plan. Un sommet
// tombé dans l'épaisseur d'un mur n'est pas « posé dessus ».
function distanceAuBord(p, P) {
  let d = Infinity;
  for (let k = 0; k < P.length; k++) d = Math.min(d, distancePointSegment(p, P[k], P[(k + 1) % P.length]));
  return d;
}
function partSurMurs(polys, murs) {
  const sommets = polys.flat();
  if (!sommets.length || !murs.length) return 0;
  return sommets.filter((q) => murs.some((m) => distanceAuBord(q, m) < 0.01)).length / sommets.length;
}

// DXF → squelette du relevé (sans PDF ni photos).
// Retourne { ok:true, releve, autresPolygones } ou { ok:false, erreur },
// ou — DXF à plusieurs versions sans `version` choisie — { ok:false,
// choix:"version", versions:[{ index, nb, aire, noms, part_murs }] }.
// `version` : numéro (1, 2…) de la série de pièces à importer.
export function releveDepuisDXF(texte, { maintenant = null, version = null } = {}) {
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

  const tousPolys = brutes.map((p) => p.sommets.map((q) => inv(q)));
  const scannersInv = Object.fromEntries(Object.entries(scanners).map(([k, q]) => [k, inv(q)]));
  const mursInv = murs.map((p) => p.sommets.map((q) => inv(q)));
  const alertes = [];

  // Versions du plan : choix obligatoire s'il y en a plusieurs.
  const blocs = versionsDuPlan(tousPolys);
  const versions = blocs.map((idx, i) => {
    const polys = idx.map((k) => tousPolys[k]);
    const noms = [...new Set(polys.flatMap((P) => Object.keys(scannersInv)
      .filter((sc) => pointDansPoly(scannersInv[sc], P))
      .map((sc) => traduireNomPiece(nomsScan[sc]).nom)))];
    return {
      index: i + 1, nb: idx.length,
      aire: polys.reduce((t, P) => t + airePolygone(P), 0),
      noms, part_murs: partSurMurs(polys, mursInv),
    };
  });
  if (blocs.length > 1 && version == null) return { ok: false, choix: "version", versions };
  const iVersion = blocs.length > 1 ? Number(version) - 1 : 0;
  if (!blocs[iVersion]) return { ok: false, erreur: `Version ${version} absente du DXF (${blocs.length} version(s)).` };
  const polysPieces = blocs[iVersion].map((k) => tousPolys[k]);
  const autresPolygones = blocs.filter((_, i) => i !== iVersion).flat().map((k) => tousPolys[k]);
  if (blocs.length > 1) {
    const v = versions[iVersion];
    alertes.push({ code: "plusieurs_versions",
      texte: `Le DXF contenait ${blocs.length} versions du plan superposées (plan automatique lancé plusieurs fois sur iMapper). Version ${v.index} importée : ${v.nb} pièces, ${Math.round(v.part_murs * 100)} % des contours posés sur les murs du fichier. Supprimez les anciennes versions sur iMapper avant le prochain export.` });
  }

  // Nommage : le scanner situé dans la pièce.
  const scansUtilises = new Set();
  const inconnus = {};
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
      if (!t.connu) (inconnus[nomSource] ||= []).push(id);
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

  // Noms non reconnus : une alerte par nom (pas une par pièce).
  Object.entries(inconnus).forEach(([src, ids]) => alertes.push({ code: "nom_inconnu", pieces: ids,
    texte: `Nom de pièce « ${src} » non reconnu (${ids.length} pièce${ids.length > 1 ? "s" : ""}) : type « autre », à corriger.` }));

  // Deux scans du même nom (« Chambre », « Chambre ») : on numérote.
  const parNom = {};
  pieces.forEach((p) => (parNom[p.nom] ||= []).push(p));
  Object.values(parNom).forEach((grp) => { if (grp.length > 1) grp.forEach((p, i) => { p.nom = `${p.nom} ${i + 1}`; }); });

  // Scanners hors de toute pièce : alerte « scan isolé », ignorés pour la suite.
  // Un scan dont la pièce n'existe que dans une autre version est signalé à part.
  const points = {}, scannersGardes = {};
  for (const s of Object.keys({ ...pointsParScan, ...scanners })) {
    if (scannersInv[s] && !scansUtilises.has(s) && autresPolygones.some((P) => pointDansPoly(scannersInv[s], P))) {
      alertes.push({ code: "scan_hors_version", scan: s,
        texte: `Scan « ${s} ${traduireNomPiece(nomsScan[s]).nom} » : sa pièce n'existe que dans une autre version du plan, elle n'est pas importée.` });
      if (pointsParScan[s]) points[s] = pointsParScan[s].map((q) => inv(q, r3));
      continue;
    }
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
      murs: mursInv.map((polygone) => ({ polygone })),
      // null = pas encore relevées (lot 2) — à distinguer de [] (aucune ouverture).
      ouvertures: null,
      points,
      scanners: scannersGardes,
      alertes,
    },
    autresPolygones,
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

// ── Photos des PDF (jsPDF) lues directement dans le fichier ────────────────
// Objets /Subtype /Image /Filter /DCTDecode : les octets JPEG d'origine, sans
// recompression. On ne garde que les photos portrait 3:4 d'au moins 800 px
// (écarte le logo). Les objets sont parcourus en sautant les flux binaires
// (longueur /Length), pour ne jamais lire un mot-clé au milieu d'une image.
function texteBinaire(u8) {
  let s = "";
  const PAS = 0x8000;
  for (let i = 0; i < u8.length; i += PAS) s += String.fromCharCode.apply(null, u8.subarray(i, i + PAS));
  return s;
}
function lireObjetsPdf(s) {
  const objets = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const deb = re.lastIndex;
    const iFin = s.indexOf("endobj", deb);
    const iFlux = s.indexOf("stream", deb);
    if (iFlux >= 0 && (iFin < 0 || iFlux < iFin)) {
      const dico = s.slice(deb, iFlux);
      let d0 = iFlux + 6;
      if (s[d0] === "\r") d0++;
      if (s[d0] === "\n") d0++;
      const lg = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dico);
      const fin = lg && !lg[2] ? d0 + parseInt(lg[1], 10) : s.indexOf("endstream", d0);
      objets.set(m[1], { dico, debut: d0, fin });
      if (fin > re.lastIndex) re.lastIndex = fin;
    } else {
      objets.set(m[1], { dico: s.slice(deb, iFin < 0 ? deb : iFin) });
      if (iFin > re.lastIndex) re.lastIndex = iFin;
    }
  }
  return objets;
}
const estPhoto = (im) => im.hauteur >= 800 && Math.min(im.largeur, im.hauteur) >= 600
  && Math.abs(im.largeur / im.hauteur - 3 / 4) < 0.02;
const refs = (txt) => [...String(txt || "").matchAll(/(\d+)\s+0\s+R/g)].map((r) => r[1]);

// Photos de CHAQUE page, dans l'ordre où la page les dessine (« /Ix Do ») :
// [[{ largeur, hauteur, octets }], …] — une entrée par page. null si la
// structure n'est pas lisible ainsi (flux de page compressés…).
export function extraireJpegsParPage(octets) {
  const u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  const s = texteBinaire(u8);
  const objets = lireObjetsPdf(s);
  const images = new Map();
  objets.forEach((o, num) => {
    if (o.debut == null || !/\/Subtype\s*\/Image/.test(o.dico) || !/\/DCTDecode/.test(o.dico)) return;
    const largeur = parseInt(/\/Width\s+(\d+)/.exec(o.dico)?.[1], 10) || 0;
    const hauteur = parseInt(/\/Height\s+(\d+)/.exec(o.dico)?.[1], 10) || 0;
    images.set(num, { largeur, hauteur, octets: u8.slice(o.debut, o.fin) });
  });
  // Arbre des pages : /Type /Pages → /Kids, dans l'ordre.
  const racine = [...objets.entries()].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.dico) && !/\/Parent\b/.test(o.dico));
  if (!racine) return null;
  const pages = [];
  const parcourir = (num, prof = 0) => {
    const o = objets.get(num);
    if (!o || prof > 20) return;
    if (/\/Type\s*\/Pages\b/.test(o.dico)) {
      refs(/\/Kids\s*\[([^\]]*)\]/.exec(o.dico)?.[1]).forEach((k) => parcourir(k, prof + 1));
    } else if (/\/Type\s*\/Page\b/.test(o.dico)) pages.push(o);
  };
  parcourir(racine[0]);
  if (!pages.length) return null;
  const xobjets = (page) => {
    let res = /\/Resources\s+(\d+)\s+0\s+R/.exec(page.dico);
    const dicoRes = res ? (objets.get(res[1])?.dico || "") : page.dico;
    let xo = /\/XObject\s*<<([\s\S]*?)>>/.exec(dicoRes)?.[1];
    if (xo == null) { const r = /\/XObject\s+(\d+)\s+0\s+R/.exec(dicoRes); xo = r ? objets.get(r[1])?.dico : ""; }
    return Object.fromEntries([...String(xo || "").matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g)].map((r) => [r[1], r[2]]));
  };
  const resultat = [];
  for (const page of pages) {
    const noms = xobjets(page);
    const contenus = /\/Contents\s*\[([^\]]*)\]/.exec(page.dico)?.[1] ?? /\/Contents\s+(\d+\s+0\s+R)/.exec(page.dico)?.[1];
    const flux = refs(contenus).map((n) => objets.get(n)).filter((o) => o && o.debut != null);
    if (flux.some((o) => /\/Filter/.test(o.dico))) return null;   // flux compressé : non lisible ici
    const liste = [];
    flux.forEach((o) => {
      for (const d of s.slice(o.debut, o.fin).matchAll(/\/([A-Za-z0-9_.-]+)\s+Do\b/g)) {
        const im = images.get(noms[d[1]]);
        if (im && estPhoto(im)) liste.push(im);
      }
    });
    resultat.push(liste);
  }
  return resultat;
}

// Photos d'un PDF d'UNE pièce, dans l'ordre de dessin. Repli (structure non
// lisible) : ordre des objets dans le fichier. Retourne [{ largeur, hauteur, octets }].
export function extraireJpegsPdf(octets) {
  const parPage = extraireJpegsParPage(octets);
  if (parPage) return [...new Set(parPage.flat())];
  const u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  const objets = lireObjetsPdf(texteBinaire(u8));
  const liste = [];
  objets.forEach((o) => {
    if (o.debut == null || !/\/Subtype\s*\/Image/.test(o.dico) || !/\/DCTDecode/.test(o.dico)) return;
    const im = {
      largeur: parseInt(/\/Width\s+(\d+)/.exec(o.dico)?.[1], 10) || 0,
      hauteur: parseInt(/\/Height\s+(\d+)/.exec(o.dico)?.[1], 10) || 0,
      octets: u8.slice(o.debut, o.fin),
    };
    if (estPhoto(im)) liste.push(im);
  });
  return liste;
}

// Un PDF « pour les devis » peut contenir UNE pièce (2 pages) ou TOUTES les
// pièces du projet en un seul fichier (pages de plans d'ensemble, puis 2 pages
// par pièce). Entrée : les mots de chaque page. Sortie : une entrée par pièce
// { page (index 0), lecture: lirePdfImapper(page, page suivante) }.
export function decouperPdfImapper(pagesMots) {
  const texte = (mots) => (mots || []).map((m) => m.str).join(" ");
  const pieces = [];
  pagesMots.forEach((mots, i) => {
    const t = texte(mots);
    if (!/Pi[èe]ce\s*#\s*\d+/.test(t) || !/Aire\s*:/.test(t)) return;
    const suivante = pagesMots[i + 1];
    const t2 = texte(suivante);
    const page2 = suivante && /\bMur\b/.test(t2) && !/Aire\s*:/.test(t2) ? suivante : [];
    pieces.push({ page: i, lecture: lirePdfImapper(mots, page2) });
  });
  return pieces;
}

// ── Rapprochement PDF ↔ pièce : même aire (± 0,02 m²) et même périmètre (± 5 mm)
// pdfs : [{ nom, lecture: lirePdfImapper(...) }] — une entrée par pièce du PDF.
// autresPolygones : pièces des AUTRES versions du plan (DXF à plusieurs
// versions) ; une pièce du PDF qui leur correspond est écartée sans alerte
// individuelle (une seule ligne de synthèse). Retourne { affectations:
// Map(indexPdf → idPiece), alertes }.
const correspond = (P, l) => l && l.aire_m2 != null && l.perimetre_mm != null
  && Math.abs(airePolygone(P) - l.aire_m2) <= TOL_AIRE_M2 + 0.005
  && Math.abs(perimetrePolygone(P) * 1000 - l.perimetre_mm) <= TOL_LONGUEUR_MM;

// Écart normalisé (1 = limite de tolérance) entre une pièce et une page PDF.
const ecartPdf = (P, l) => Math.max(
  Math.abs(airePolygone(P) - l.aire_m2) / (TOL_AIRE_M2 + 0.005),
  Math.abs(perimetrePolygone(P) * 1000 - l.perimetre_mm) / TOL_LONGUEUR_MM,
);
// Deux appariements plus proches que cet écart ne se départagent pas.
const EGALITE_ECART = 0.05;

export function rapprocherPdfs(pieces, pdfs, { autresPolygones = [] } = {}) {
  const alertes = [];
  // Toutes les pièces du DXF concourent, versions écartées comprises : une
  // pièce présente dans deux versions presque à l'identique (34,65 / 34,63 m²)
  // revient ainsi à la page PDF qui lui correspond le mieux, et l'autre page
  // part vers l'autre version au lieu de bloquer le rapprochement.
  const cibles = [
    ...pieces.map((p) => ({ id: p.id, P: p.polygone })),
    ...autresPolygones.map((P, k) => ({ id: null, autre: k, P })),
  ];
  const paires = [];
  pdfs.forEach((pdf, i) => cibles.forEach((c, j) => {
    if (correspond(c.P, pdf.lecture)) paires.push({ i, j, e: ecartPdf(c.P, pdf.lecture) });
  }));
  paires.sort((a, b) => a.e - b.e);
  const pdfPris = new Map(), ciblePrise = new Set(), ambigus = new Set();
  for (const p of paires) {
    if (pdfPris.has(p.i) || ciblePrise.has(p.j)) continue;
    // Égalité : même page pour deux pièces, ou deux pages pour une pièce.
    const rivale = paires.find((q) => q !== p && q.e - p.e < EGALITE_ECART
      && ((q.i === p.i && !ciblePrise.has(q.j)) || (q.j === p.j && !pdfPris.has(q.i))));
    if (rivale) { ambigus.add(p.i); if (rivale.i !== p.i) ambigus.add(rivale.i); continue; }
    pdfPris.set(p.i, p.j);
    ciblePrise.add(p.j);
  }
  const affectations = new Map();
  let autreVersion = 0;
  pdfs.forEach((pdf, i) => {
    const l = pdf.lecture || {};
    if (pdfPris.has(i)) {
      const c = cibles[pdfPris.get(i)];
      if (c.id) affectations.set(i, c.id); else autreVersion++;
    } else if (ambigus.has(i) || paires.some((p) => p.i === i)) {
      alertes.push({ code: "pdf_ambigu", pdf: pdf.nom,
        texte: `PDF « ${pdf.nom} » : plusieurs pièces possibles (même surface et même périmètre). Rapprochement manuel.` });
    } else {
      alertes.push({ code: "pdf_sans_piece", pdf: pdf.nom,
        texte: `PDF « ${pdf.nom} » (aire ${l.aire_m2 != null ? fr(l.aire_m2) : "?"} m², périmètre ${l.perimetre_mm ?? "?"} mm) : aucune pièce du plan ne correspond. Rapprochement manuel.` });
    }
  });
  if (autreVersion) {
    alertes.push({ code: "pdf_autre_version",
      texte: `${autreVersion} pièce(s) du PDF appartiennent à une autre version du plan : ignorées.` });
  }
  // Pièces sans PDF : une seule ligne (pas une alerte par pièce).
  const sans = pieces.filter((p) => ![...affectations.values()].includes(p.id));
  if (sans.length) {
    alertes.push({ code: "piece_sans_pdf", pieces: sans.map((p) => p.id),
      texte: !pdfs.length
        ? "Aucun PDF « pour les devis » fourni : pas de photos."
        : `${sans.length === pieces.length ? "Aucune pièce" : `${sans.length} pièce(s)`} sans PDF iMapper rapproché, donc sans photos${sans.length === pieces.length ? "" : ` : ${sans.map((p) => p.nom).join(", ")}`}.` });
  }
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
// DXF à plusieurs versions sans `version` : renvoie le choix à faire
// ({ ok:false, choix:"version", versions }), voir releveDepuisDXF.
export function assemblerReleve({ dxfTexte, pdfs = [], maintenant = null, version = null }) {
  const base = releveDepuisDXF(dxfTexte, { maintenant, version });
  if (!base.ok) return base;
  const releve = base.releve;
  const { affectations, alertes } = rapprocherPdfs(releve.pieces, pdfs, { autresPolygones: base.autresPolygones });
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
    // Une pièce sans scan (placard dessiné sur iMapper) n'a pas de photo : normal.
    if (piece.scan ? (pdf.nbPhotos || 0) !== 10 : (pdf.nbPhotos || 0) > 0 && pdf.nbPhotos !== 10) {
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
