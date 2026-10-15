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

// Point d'ancrage de l'étiquette : le point de la pièce le plus éloigné de
// ses murs (« pôle d'inaccessibilité »), et la distance à ces murs (m). Le
// centre de gravité, lui, tombe mal dans une pièce en L (cas réel : couloir
// en L dont le centre tombait sur la petite pièce voisine). Recherche sur
// grille puis affinage autour du meilleur point.
export function poleInaccessibilite(P) {
  if (!P || P.length < 3) return { point: [0, 0], rayon: 0 };
  const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = null, bestD = -1;
  for (let passe = 0; passe < 3; passe++) {
    const N = 16;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const pt = [x0 + (i / N) * (x1 - x0), y0 + (j / N) * (y1 - y0)];
      if (!pointDansPoly(pt, P)) continue;
      const d = distanceAuBord(pt, P);
      if (d > bestD) { bestD = d; best = pt; }
    }
    if (!best) break;
    const w = (x1 - x0) / 8, h = (y1 - y0) / 8;
    x0 = best[0] - w; x1 = best[0] + w; y0 = best[1] - h; y1 = best[1] + h;
  }
  if (!best) best = [xs.reduce((a, b) => a + b, 0) / P.length, ys.reduce((a, b) => a + b, 0) / P.length];
  return { point: best, rayon: Math.max(0, bestD) };
}
export function ancrePiece(piece) {
  return poleInaccessibilite(piece.polygone || []).point;
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
// detecter : lance la détection des ouvertures (étape 9 de l'import).
export function assemblerReleve({ dxfTexte, pdfs = [], maintenant = null, version = null, detecter = true }) {
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
  releve.alertes = releve.alertes.map((a, i) => ({ id: `a${i + 1}`, ...a }));
  if (detecter) releve.ouvertures = detecterOuvertures(releve);
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

// ── Détection des ouvertures (lot 2) ────────────────────────────────────────
// Une ouverture se repère comme un TROU dans les points relevés le long d'un
// mur. Algorithme de la spécification, validé sur le relevé de référence :
//  1. normale de chaque côté orientée vers l'intérieur de la pièce ;
//  2. côtés ≥ 0,30 m : points (tous scans) qui se projettent dans le côté à
//     moins de 4 cm de lui (une bande plus large capte la face opposée du mur
//     voisin et masque les portes) ;
//  3. cases de 5 cm, 4. suite de cases vides ≥ 55 cm = trou candidat ;
//  5. mur partagé (côté d'une autre pièce parallèle à < 5°, à < 40 cm, qui
//     recouvre le trou) : trou aussi de l'autre côté (recouvrement ≥ 50 %) →
//     porte entre les deux pièces, « détectée » ; sinon « à vérifier » ;
//  6. mur sans voisin → fenêtre « détectée » (des points au-delà du mur dans
//     l'axe du trou = une vitre, noté `indice_vitre`) ;
//  7. trou de plus de 1,60 m sur un mur partagé (mobilier qui masque) →
//     « à vérifier » ;
//  8. largeur t1 − t0 ; charnière en t0, ouverture vers la pièce du côté ;
//  9. épaisseur du mur : pas de 1 cm vers l'extérieur tant qu'on reste dans
//     un mur A-WALL (8 cm au minimum).
// La géométrie seule n'est jamais définitive : elle qualifie mal (porte
// palière ou placard pris pour une fenêtre), laisse des portes « à vérifier »
// et produit des faux candidats (mobilier, miroir) — c'est le rôle de
// l'analyse des photos (lot 3) et du conducteur de travaux.
export const DETECTION = {
  BANDE_M: 0.04, CASE_M: 0.05, TROU_MIN_M: 0.55, COTE_MIN_M: 0.3,
  ANGLE_MAX_DEG: 5, ECART_VOISIN_M: 0.4, RECOUVREMENT_MIN: 0.5, TROU_DOUTEUX_M: 1.6,
  EPAISSEUR_MIN_M: 0.08, EPAISSEUR_MAX_M: 1.0,
  // Un mur « bien relevé » porte au moins tant de points par mètre de partie
  // pleine (référence : 40 à 100 ; murs à peine scannés de Montillers : 0 à 7).
  POINTS_MIN_PAR_M: 15,
};
export const LARGEUR_OUVERTURE_DEFAUT = 0.83;
export const TYPES_OUVERTURE = [
  { id: "porte", label: "Porte", prefixe: "P" },
  { id: "porte_fenetre", label: "Porte-fenêtre", prefixe: "PF" },
  { id: "fenetre", label: "Fenêtre", prefixe: "F" },
  { id: "baie", label: "Baie (passage sans porte)", prefixe: "B" },
  { id: "placard", label: "Placard", prefixe: "PL" },
];
export const STATUTS_OUVERTURE = {
  detecte: "Détectée", confirme_photo: "Confirmée sur photo", a_verifier: "À vérifier", valide: "Validée",
};

// Côtés d'une pièce, avec direction unitaire u et normale n vers l'intérieur.
export function cotesPiece(piece) {
  const P = piece.polygone || [];
  return P.map((a, k) => {
    const b = P[(k + 1) % P.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n = [-u[1], u[0]];
    const m = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01];
    if (!pointDansPoly(m, P)) n = [-n[0], -n[1]];
    return { piece: piece.id, k, a, b, L, u, n };
  });
}

// Trous (cases vides ≥ 55 cm) le long d'un côté. Retourne [[t0, t1], …] en m.
function trousCote(c, points, D) {
  const nb = Math.max(1, Math.ceil(c.L / D.CASE_M));
  const occ = new Array(nb).fill(false);
  for (const q of points) {
    const dx = q[0] - c.a[0], dy = q[1] - c.a[1];
    const t = dx * c.u[0] + dy * c.u[1];
    if (t < 0 || t > c.L) continue;
    if (Math.abs(dx * c.n[0] + dy * c.n[1]) < D.BANDE_M) occ[Math.min(nb - 1, Math.floor(t / D.CASE_M))] = true;
  }
  const res = [];
  for (let i = 0; i < nb;) {
    if (occ[i]) { i++; continue; }
    let j = i;
    while (j < nb && !occ[j]) j++;
    const t0 = i * D.CASE_M, t1 = Math.min(c.L, j * D.CASE_M);
    if (t1 - t0 >= D.TROU_MIN_M - 1e-9) res.push([t0, t1]);
    i = j;
  }
  return res;
}

// Point du côté c à l'abscisse t ; abscisse sur le côté o d'un point.
const pointCote = (c, t) => [c.a[0] + c.u[0] * t, c.a[1] + c.u[1] * t];
const abscisse = (o, p) => (p[0] - o.a[0]) * o.u[0] + (p[1] - o.a[1]) * o.u[1];

// Épaisseur du mur derrière l'abscisse t du côté c (pas de 1 cm vers l'extérieur).
export function epaisseurMur(c, t, murs, D = DETECTION) {
  const p = pointCote(c, t);
  let e = 0;
  for (let s = 0.01; s <= D.EPAISSEUR_MAX_M; s += 0.01) {
    const q = [p[0] - c.n[0] * s, p[1] - c.n[1] * s];
    if (!murs.some((m) => pointDansPoly(q, m))) break;
    e = s;
  }
  return Math.max(D.EPAISSEUR_MIN_M, Math.round(e * 100) / 100);
}

// releve → [ouverture] (sans les toucher : nouvelle liste). Codes P1, F1…
// par pièce puis par côté. Statuts « detecte » ou « a_verifier ».
export function detecterOuvertures(releve, D = DETECTION) {
  const pieces = releve?.pieces || [];
  const points = Object.values(releve?.points || {}).flat();
  const murs = (releve?.murs || []).map((m) => m.polygone || []);
  const cotes = pieces.flatMap(cotesPiece);
  const trous = new Map(cotes.map((c) => [c, c.L >= D.COTE_MIN_M ? trousCote(c, points, D) : []]));
  const cosMax = Math.cos((D.ANGLE_MAX_DEG * Math.PI) / 180);

  // Côté voisin d'un trou : parallèle, proche, et qui recouvre le trou.
  const voisin = (c, t0, t1) => {
    let best = null;
    for (const o of cotes) {
      if (o.piece === c.piece) continue;
      if (Math.abs(o.u[0] * c.u[0] + o.u[1] * c.u[1]) < cosMax) continue;
      const ecart = Math.abs((o.a[0] - c.a[0]) * c.n[0] + (o.a[1] - c.a[1]) * c.n[1]);
      if (ecart > D.ECART_VOISIN_M) continue;
      let s0 = abscisse(o, pointCote(c, t0)), s1 = abscisse(o, pointCote(c, t1));
      if (s0 > s1) [s0, s1] = [s1, s0];
      if (s1 <= 0 || s0 >= o.L) continue;
      const rec = Math.max(0, ...trous.get(o).map(([u0, u1]) => Math.max(0, Math.min(u1, s1) - Math.max(u0, s0)) / (s1 - s0)));
      const couvert = (Math.min(s1, o.L) - Math.max(s0, 0)) / (s1 - s0);
      if (!best || couvert > best.couvert + 1e-9 || (Math.abs(couvert - best.couvert) < 1e-9 && rec > best.rec)) {
        best = { o, s0, s1, rec, couvert };
      }
    }
    return best;
  };

  const brutes = [];
  const dejaPris = new Set();   // trous déjà fusionnés dans une porte partagée
  for (const c of cotes) {
    for (const [t0, t1] of trous.get(c)) {
      const cle = `${c.piece}#${c.k}#${t0}`;
      if (dejaPris.has(cle)) continue;
      const v = voisin(c, t0, t1);
      const largeur = t1 - t0;
      const base = {
        piece: c.piece, mur: c.k, t0: r4(t0), t1: r4(t1),
        sens: { charniere: "t0", cote: "interieur" },
        hauteur: null, allege: null, origine: "detection",
        epaisseur: epaisseurMur(c, (t0 + t1) / 2, murs, D),
      };
      if (v) {
        const partage = v.rec >= D.RECOUVREMENT_MIN;
        if (partage) {
          // Le même passage vu de l'autre pièce : on ne le compte qu'une fois.
          for (const [u0, u1] of trous.get(v.o)) {
            const r = Math.max(0, Math.min(u1, v.s1) - Math.max(u0, v.s0)) / (v.s1 - v.s0);
            if (r >= D.RECOUVREMENT_MIN) dejaPris.add(`${v.o.piece}#${v.o.k}#${u0}`);
          }
        }
        const douteux = !partage || largeur > D.TROU_DOUTEUX_M;
        brutes.push({
          ...base, type: "porte", pieces_liees: [c.piece, v.o.piece],
          statut: douteux ? "a_verifier" : "detecte",
          raison: !partage ? "trou d'un seul côté du mur" : largeur > D.TROU_DOUTEUX_M ? "trou de plus de 1,60 m (mobilier ?)" : null,
        });
      } else {
        // Mur sans voisin : fenêtre. Des points au-delà du mur dans l'axe du
        // trou (à plus de l'épaisseur du mur) signalent une vitre.
        const e = base.epaisseur;
        const au_dela = points.some((q) => {
          const dx = q[0] - c.a[0], dy = q[1] - c.a[1];
          const t = dx * c.u[0] + dy * c.u[1];
          const d = -(dx * c.n[0] + dy * c.n[1]);
          return t > t0 && t < t1 && d > e + 0.05;
        });
        // Un trou n'est une fenêtre « détectée » que si le mur est bien relevé
        // ailleurs ET qu'une vitre est vue derrière. Sinon « à vérifier » :
        // sur un mur à peine scanné, le trou est un manque de mesure (cas réel :
        // 40 « fenêtres » pour 12 pièces sans cette règle), et sans point
        // derrière, rien ne distingue une fenêtre d'une porte palière, d'un
        // placard ou d'un meuble (relevé de référence).
        const pleins = c.L - trous.get(c).reduce((t, [u0, u1]) => t + (u1 - u0), 0);
        const nbPts = points.filter((q) => {
          const dx = q[0] - c.a[0], dy = q[1] - c.a[1];
          const t = dx * c.u[0] + dy * c.u[1];
          return t >= 0 && t <= c.L && Math.abs(dx * c.n[0] + dy * c.n[1]) < D.BANDE_M;
        }).length;
        const peuReleve = pleins < 0.15 * c.L || nbPts < D.POINTS_MIN_PAR_M * Math.max(pleins, 0.01);
        brutes.push({
          ...base, type: "fenetre", pieces_liees: [c.piece], indice_vitre: au_dela,
          statut: !peuReleve && au_dela ? "detecte" : "a_verifier",
          raison: peuReleve ? "mur à peine relevé : trou peut-être dû au scan" : !au_dela ? "aucun point derrière le mur : vitre non confirmée" : null,
        });
      }
    }
  }
  return numeroterOuvertures(brutes.map((o, i) => ({ id: `o${i + 1}`, ...o, masque: false })));
}

// Codes P1, F1, B1, PL1, PF1 : par type, dans l'ordre des ouvertures.
export function numeroterOuvertures(ouvertures) {
  const n = {};
  return ouvertures.map((o) => {
    const pre = (TYPES_OUVERTURE.find((t) => t.id === o.type) || TYPES_OUVERTURE[0]).prefixe;
    if (o.code && o.code_fixe) return o;
    n[pre] = (n[pre] || 0) + 1;
    return { ...o, code: `${pre}${n[pre]}` };
  });
}

// Prochain code libre d'un type (P4 si P1 à P3 existent) : ajouter ou
// requalifier une ouverture ne renumérote jamais les autres.
export function prochainCode(ouvertures, type) {
  const pre = (TYPES_OUVERTURE.find((t) => t.id === type) || TYPES_OUVERTURE[0]).prefixe;
  const re = new RegExp(`^${pre}(\\d+)$`);
  const max = Math.max(0, ...(ouvertures || []).map((o) => Number(re.exec(o.code || "")?.[1] || 0)));
  return `${pre}${max + 1}`;
}

// Géométrie d'une ouverture : extrémités sur la face intérieure, direction,
// normale vers la pièce du côté, épaisseur. null si la pièce ou le côté n'existe plus.
export function geometrieOuverture(releve, o) {
  if (o?.t0 == null || o?.t1 == null) return null;   // vue sur photo, pas encore placée
  const piece = (releve?.pieces || []).find((p) => p.id === o.piece);
  if (!piece) return null;
  const c = cotesPiece(piece)[o.mur];
  if (!c) return null;
  const t0 = Math.max(0, Math.min(c.L, o.t0)), t1 = Math.max(0, Math.min(c.L, o.t1));
  return { cote: c, p0: pointCote(c, t0), p1: pointCote(c, t1), u: c.u, n: c.n, epaisseur: o.epaisseur || DETECTION.EPAISSEUR_MIN_M, largeur: t1 - t0, L: c.L };
}

// Déplace une ouverture le long de son mur sans changer sa largeur (t bornés au côté).
export function glisserOuverture(releve, o, nouveauT0) {
  const g = geometrieOuverture(releve, o);
  if (!g) return o;
  const w = o.t1 - o.t0;
  const t0 = Math.max(0, Math.min(g.L - w, nouveauT0));
  return { ...o, t0: r4(t0), t1: r4(t0 + w) };
}

// Change la largeur en gardant le centre (bornée au côté, 10 cm minimum).
export function largeurOuverture(releve, o, largeur) {
  const g = geometrieOuverture(releve, o);
  if (!g || !(largeur > 0)) return o;
  const w = Math.max(0.1, Math.min(g.L, largeur));
  const centre = (o.t0 + o.t1) / 2;
  const t0 = Math.max(0, Math.min(g.L - w, centre - w / 2));
  return { ...o, t0: r4(t0), t1: r4(t0 + w) };
}

// Ouverture posée à la main sur le côté k d'une pièce, centrée sur t.
export function nouvelleOuverture(releve, pieceId, k, t, { largeur = LARGEUR_OUVERTURE_DEFAUT, type = "porte", id } = {}) {
  const piece = (releve?.pieces || []).find((p) => p.id === pieceId);
  const c = piece && cotesPiece(piece)[k];
  if (!c) return null;
  const w = Math.min(largeur, c.L);
  const t0 = Math.max(0, Math.min(c.L - w, t - w / 2));
  const murs = (releve.murs || []).map((m) => m.polygone || []);
  // Pièce de l'autre côté du mur, s'il y en a une.
  const milieu = pointCote(c, t0 + w / 2);
  const e = epaisseurMur(c, t0 + w / 2, murs);
  const derriere = [milieu[0] - c.n[0] * (e + 0.05), milieu[1] - c.n[1] * (e + 0.05)];
  const autre = (releve.pieces || []).find((p) => p.id !== pieceId && pointDansPoly(derriere, p.polygone));
  return {
    id, piece: pieceId, mur: k, t0: r4(t0), t1: r4(t0 + w), type,
    pieces_liees: autre ? [pieceId, autre.id] : [pieceId],
    sens: { charniere: "t0", cote: "interieur" }, hauteur: null, allege: null,
    origine: "manuel", statut: "a_verifier", epaisseur: e, masque: false, raison: "posée à la main",
  };
}

// Côté de pièce le plus proche d'un point (m) : { piece, k, t, distance }.
export function coteLePlusProche(releve, p) {
  let best = null;
  for (const piece of releve?.pieces || []) {
    for (const c of cotesPiece(piece)) {
      const t = Math.max(0, Math.min(c.L, abscisse(c, p)));
      const q = pointCote(c, t);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.distance) best = { piece: piece.id, k: c.k, t, distance: d };
    }
  }
  return best;
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
      if (o.t0 == null || o.t1 == null) {
        // Vue sur les photos mais pas encore placée : largeur inconnue, rien
        // n'est déduit — et la valeur le dit (« ≈ »).
        if (o.piece === p.id || (o.pieces_liees || []).includes(p.id)) {
          ligne.approx.murs_nets = true;
          if (TYPES_PLINTHE.has(o.type)) ligne.approx.plinthes = true;
        }
        return;
      }
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
// Chaque point porte sa cible (ce que « Corriger » ouvre) et ce que
// « Confirmer » / « Supprimer » veulent dire pour lui :
//   hauteur par défaut → confirmer la hauteur de toutes les pièces non mesurées ;
//   ouverture à vérifier → confirmer = « validée », supprimer = retirer ;
//   alerte d'import → confirmer = « vu », supprimer = retirer de la liste ;
//   ouvertures pas encore relevées → lancer la détection.
export function pointsAValider(releve) {
  if (!releve) return [];
  const liste = [];
  const defaut = (releve.pieces || []).filter((p) => p.hsp_statut !== "mesuree");
  if (defaut.length) {
    liste.push({
      cle: "hsp_defaut", code: "hsp_defaut", cible: { type: "piece", id: defaut[0].id },
      texte: `Hauteur sous plafond ${fr(HSP_DEFAUT)} m appliquée par défaut à ${defaut.length === (releve.pieces || []).length ? "toutes les pièces" : `${defaut.length} pièce(s)`} : elle n'est pas mesurée. Elle change toutes les surfaces de murs.`,
    });
  }
  if (releve.ouvertures === null) {
    liste.push({ cle: "ouvertures_non_relevees", code: "ouvertures_non_relevees", cible: null,
      texte: "Portes et fenêtres pas encore relevées : plinthes et murs nets ne sont pas calculés." });
  }
  const nomPiece = (id) => (releve.pieces || []).find((p) => p.id === id)?.nom || "?";
  (releve.ouvertures || []).filter((o) => !o.masque && o.statut === "a_verifier").forEach((o) => {
    const type = (TYPES_OUVERTURE.find((t) => t.id === o.type) || {}).label || o.type;
    if (o.t0 == null || o.t1 == null) {
      liste.push({
        cle: `ouverture#${o.id}`, code: "ouverture_a_placer", cible: { type: "ouverture", id: o.id },
        texte: `${o.code} — ${type} vue sur les photos de « ${nomPiece(o.piece)} », mur ${o.mur} : à placer sur le mur (position et largeur inconnues).`,
      });
      return;
    }
    liste.push({
      cle: `ouverture#${o.id}`, code: "ouverture_a_verifier", cible: { type: "ouverture", id: o.id },
      texte: `${o.code} — ${type} ≈ ${Math.round((o.t1 - o.t0) * 100)} cm, ${(o.pieces_liees || [o.piece]).map(nomPiece).join(" / ")}${o.raison ? ` : ${o.raison}` : ""}.`,
    });
  });
  (releve.alertes || []).forEach((a, i) => {
    if (a.vue) return;
    const piece = a.piece || (a.pieces || [])[0];
    liste.push({ ...a, cle: `alerte#${a.id || i}`, cible: piece ? { type: "piece", id: piece } : null });
  });
  return liste;
}

// Applique « Confirmer » ou « Supprimer » à un point à valider. Pur : renvoie
// un nouveau relevé (l'appelant l'inscrit dans l'historique).
export function traiterPointAValider(releve, point, action) {
  if (!releve || !point) return releve;
  if (point.code === "hsp_defaut" && action === "confirmer") {
    return { ...releve, pieces: releve.pieces.map((p) => (p.hsp_statut === "mesuree" ? p : { ...p, hsp_statut: "mesuree" })) };
  }
  if (point.code === "ouverture_a_verifier" || point.code === "ouverture_a_placer") {
    const id = point.cible.id;
    if (action === "confirmer") return { ...releve, ouvertures: releve.ouvertures.map((o) => (o.id === id ? { ...o, statut: "valide", raison: null } : o)) };
    if (action === "supprimer") return { ...releve, ouvertures: releve.ouvertures.filter((o) => o.id !== id) };
  }
  if (point.cle.startsWith("alerte#")) {
    const vise = (a, i) => `alerte#${a.id || i}` === point.cle;
    if (action === "confirmer") return { ...releve, alertes: releve.alertes.map((a, i) => (vise(a, i) ? { ...a, vue: true } : a)) };
    if (action === "supprimer") return { ...releve, alertes: releve.alertes.filter((a, i) => !vise(a, i)) };
  }
  return releve;
}

// Abscisse (m) d'un point projeté sur le côté k d'une pièce.
export function abscisseSurMur(releve, pieceId, k, p) {
  const piece = (releve?.pieces || []).find((x) => x.id === pieceId);
  const c = piece && cotesPiece(piece)[k];
  return c ? abscisse(c, p) : null;
}

// Ouverture sous un point (m), à `tol` m près : la plus proche, ou null.
export function ouvertureSousPoint(releve, p, tol) {
  let best = null;
  for (const o of releve?.ouvertures || []) {
    if (o.masque) continue;
    const g = geometrieOuverture(releve, o);
    if (!g) continue;
    // Milieu de l'épaisseur du mur, sur la largeur de l'ouverture.
    const a = [g.p0[0] - g.n[0] * g.epaisseur / 2, g.p0[1] - g.n[1] * g.epaisseur / 2];
    const b = [g.p1[0] - g.n[0] * g.epaisseur / 2, g.p1[1] - g.n[1] * g.epaisseur / 2];
    const d = distancePointSegment(p, a, b) - g.epaisseur / 2;
    if (d <= tol && (!best || d < best.d)) best = { o, d };
  }
  return best ? best.o : null;
}

// ── Lot 3 : analyse des photos par l'IA ────────────────────────────────────
// L'IA INTERPRÈTE (type d'ouverture, équipements, alertes) ; elle ne MESURE
// rien. Tout ce qu'elle renvoie est une proposition : elle requalifie, confirme
// ou écarte des ouvertures candidates, propose des observations — jamais une
// dimension (la tâche refuse toute réponse qui en contient).
export const PLAFOND_IA_RELEVE_EUR = 2.5;      // décision de l'équipe, 15/10/2026
export const ESTIMATION_IA_PIECE_EUR = 0.06;    // 10 photos réduites à 800 px, Sonnet
export const MUR_COURT_M = 1.2;                 // en dessous : une ouverture « nouvelle » occupe le mur

// Ce qu'on envoie au modèle pour une pièce : nom, murs (indice, longueur,
// photos rattachées), ouvertures candidates, chemins des photos (réduites si
// disponibles). Aucune image ni donnée client : l'entrée est journalisée.
export function contexteAnalysePhotos(releve, pieceId) {
  const piece = (releve?.pieces || []).find((p) => p.id === pieceId);
  if (!piece) return null;
  const photos = (piece.photos || []).filter((ph) => ph.chemin_ia || ph.chemin);
  const murs = longueursCotes(piece.polygone || []).map((l, k) => ({
    indice: k, longueur_cm: Math.round(l * 100),
    photos: photos.filter((ph) => ph.mur === k).map((ph) => ph.num),
  }));
  const ouvertures = (releve.ouvertures || [])
    .filter((o) => o.piece === pieceId || (o.pieces_liees || []).includes(pieceId))
    .filter((o) => o.t0 != null && o.t1 != null)
    .map((o) => ({
      ref: o.id, code: o.code, type: o.type, statut: o.statut,
      // Une ouverture portée par la pièce voisine est vue de l'autre côté du mur.
      mur: o.piece === pieceId ? o.mur : null,
      de_cm: Math.round(o.t0 * 100), a_cm: Math.round(o.t1 * 100),
      vers: (o.pieces_liees || []).filter((id) => id !== pieceId)
        .map((id) => releve.pieces.find((p) => p.id === id)?.nom).filter(Boolean),
      masquee: !!o.masque,
    }));
  return {
    piece_id: piece.id, nom: piece.nom, type: piece.type,
    murs, ouvertures,
    photos: photos.map((ph) => ({ num: ph.num, mur: ph.mur ?? null, chemin: ph.chemin_ia || ph.chemin })),
  };
}

// Intègre la réponse de l'IA pour une pièce. Pur : renvoie un nouveau relevé.
// Règles (spécification, § Analyse des photos) :
//   confirme → « confirmée sur photo » ; requalifie → nouveau type (nouveau
//   code), « confirmée sur photo » ; faux_positif → masquée mais conservée
//   (rétablissable) ; incertain → « à vérifier » ; nouvelle → ouverture
//   ajoutée « à vérifier » sur le mur indiqué : sur un mur de moins de 1,20 m
//   (ébrasement), elle occupe le mur moins 5 cm à chaque bout ; sinon sa
//   position reste inconnue (« à placer ») — jamais une largeur inventée.
// Une ouverture validée ou posée à la main par le conducteur de travaux garde
// son statut : le verdict de l'IA y est seulement noté.
// Les observations et alertes précédentes de l'IA pour cette pièce sont
// remplacées (relancer l'analyse ne les empile pas).
export function integrerAnalysePhotos(releve, pieceId, resultat, meta = {}) {
  const piece = (releve?.pieces || []).find((p) => p.id === pieceId);
  if (!piece || !resultat) return releve;
  const r = resultat;
  let ouvertures = [...(releve.ouvertures || [])];
  const ignorees = [];
  const protegee = (o) => o.statut === "valide" || o.origine === "manuel";
  const typeValide = (t) => TYPES_OUVERTURE.some((x) => x.id === t);
  const cotes = cotesPiece(piece);

  for (const v of r.ouvertures || []) {
    const note = { verdict: v.verdict, type: v.type ?? null, photos: v.photos || [], confiance: v.confiance ?? null, job_id: meta.job_id ?? null };
    if (v.verdict === "nouvelle") {
      const c = cotes[v.mur];
      if (!c || !typeValide(v.type)) { ignorees.push(v); continue; }
      const court = c.L < MUR_COURT_M;
      const id = `oia${pieceId}_${v.mur}_${ouvertures.length + 1}`;
      ouvertures.push({
        id, code: prochainCode(ouvertures, v.type), type: v.type,
        piece: pieceId, mur: v.mur,
        t0: court ? r4(Math.min(0.05, c.L / 4)) : null,
        t1: court ? r4(Math.max(c.L - 0.05, c.L * 3 / 4)) : null,
        position_inconnue: !court,
        pieces_liees: [pieceId], sens: { charniere: "t0", cote: "interieur" },
        hauteur: null, allege: null, origine: "ia", statut: "a_verifier", masque: false,
        epaisseur: DETECTION.EPAISSEUR_MIN_M,
        raison: court ? "vue sur les photos, occupe l'ébrasement (largeur à confirmer)" : "vue sur les photos : position à placer sur le mur",
        ia: note,
      });
      continue;
    }
    const i = ouvertures.findIndex((o) => o.id === v.ref);
    if (i < 0) { ignorees.push(v); continue; }
    const o = ouvertures[i];
    if (protegee(o)) { ouvertures[i] = { ...o, ia: note }; continue; }
    if (v.verdict === "confirme") {
      ouvertures[i] = { ...o, statut: "confirme_photo", raison: null, masque: false, ia: note };
    } else if (v.verdict === "requalifie" && typeValide(v.type)) {
      const autres = ouvertures.filter((x) => x.id !== o.id);
      ouvertures[i] = {
        ...o, type: v.type, code: v.type === o.type ? o.code : prochainCode(autres, v.type),
        statut: "confirme_photo", raison: null, masque: false, ia: note,
      };
    } else if (v.verdict === "faux_positif") {
      ouvertures[i] = { ...o, masque: true, masque_par: "ia", ia: note };
    } else if (v.verdict === "incertain") {
      ouvertures[i] = { ...o, statut: "a_verifier", raison: "photos : incertain", ia: note };
    } else {
      ignorees.push(v);
    }
  }

  // Observations proposées (à valider), équipements et revêtements compris.
  const observations = [
    ...(r.observations || []).map((t) => ({ texte: String(t), categorie: "general" })),
    ...(r.equipements || []).map((e) => ({ texte: `${e.type}${e.mur != null ? ` (mur ${e.mur})` : ""}`, categorie: "equipement", photos: e.photos || [] })),
    ...(r.revetements || []).map((e) => ({ texte: `${e.zone} : ${e.description}`, categorie: "revetement" })),
  ].map((o) => ({ ...o, statut: "propose", source: "ia" }));
  if (r.type_piece) observations.unshift({ texte: `Type de pièce proposé : ${String(r.type_piece).replace(/_/g, " ")}`, categorie: "type", statut: "propose", source: "ia" });

  const pieces = releve.pieces.map((p) => (p.id !== pieceId ? p : {
    ...p,
    observations: [...(p.observations || []).filter((ob) => ob.source !== "ia" || ob.statut === "valide"), ...observations],
    analyse_ia: {
      statut: "fait", job_id: meta.job_id ?? null, date: meta.date ?? null, cout_eur: meta.cout_eur ?? null,
      ignorees: ignorees.length,
    },
  }));
  const alertes = [
    ...(releve.alertes || []).filter((a) => !(a.code === "ia_alerte" && a.piece === pieceId)),
    ...(r.alertes || []).map((a, k) => ({
      id: `ia_${pieceId}_${k + 1}`, code: "ia_alerte", piece: pieceId, gravite: a.gravite || "moyenne",
      photos: a.photos || [], texte: `${piece.nom} : ${a.texte}`,
    })),
  ];
  return { ...releve, pieces, ouvertures, alertes, ia_cout_total: r4((releve.ia_cout_total || 0) + (Number(meta.cout_eur) || 0)) };
}

// Échec de l'analyse d'une pièce : noté sur la pièce, visible, rien d'autre ne change.
export function noterEchecAnalyse(releve, pieceId, message, meta = {}) {
  return {
    ...releve,
    pieces: releve.pieces.map((p) => (p.id !== pieceId ? p : {
      ...p, analyse_ia: { statut: "erreur", message: String(message || "échec"), date: meta.date ?? null, cout_eur: meta.cout_eur ?? null },
    })),
  };
}

// Chemins des photos réduites pour l'IA : { "‹idPièce›#‹n°›": chemin }.
export function appliquerCheminsIA(releve, chemins = {}) {
  if (!releve || !Object.keys(chemins).length) return releve;
  return {
    ...releve,
    pieces: releve.pieces.map((p) => ({
      ...p,
      photos: (p.photos || []).map((ph) => (chemins[`${p.id}#${ph.num}`] ? { ...ph, chemin_ia: chemins[`${p.id}#${ph.num}`] } : ph)),
    })),
  };
}

// Place une ouverture vue sur photo (« à placer ») au centre de son mur, à la
// largeur par défaut de son type — choix du conducteur de travaux, la largeur
// reste à mesurer (statut « à vérifier »).
export const LARGEURS_PAR_DEFAUT = { porte: 0.83, porte_fenetre: 1.2, fenetre: 1.2, baie: 1.2, placard: 0.8 };
export function placerOuverture(releve, o) {
  const piece = (releve?.pieces || []).find((p) => p.id === o.piece);
  const c = piece && cotesPiece(piece)[o.mur];
  if (!c) return o;
  const w = Math.min(LARGEURS_PAR_DEFAUT[o.type] || LARGEUR_OUVERTURE_DEFAUT, c.L);
  const t0 = (c.L - w) / 2;
  return { ...o, t0: r4(t0), t1: r4(t0 + w), position_inconnue: false, statut: "a_verifier", raison: "placée au centre du mur : position et largeur à mesurer" };
}

// Pièces à analyser (au moins une photo envoyée) et budget restant du relevé.
export function piecesAnalysables(releve) {
  return (releve?.pieces || []).filter((p) => (p.photos || []).some((ph) => ph.chemin));
}
export function budgetIARestant(releve, plafond = PLAFOND_IA_RELEVE_EUR) {
  return Math.max(0, plafond - (Number(releve?.ia_cout_total) || 0));
}

// ── Lot 4 : contenu du dossier PDF du relevé ───────────────────────────────
// Tout ce que le dossier imprime, préparé ici (pur, testé) ; la mise en page
// (releveDossierPdf.js) ne calcule rien. Règles :
//   • métrés = calculerMetres, mêmes chiffres et mêmes « ≈ » qu'à l'écran ;
//   • ouvertures écartées (masquées) absentes ; « à placer » signalées comme
//     telles, sans largeur ;
//   • observations : SEULEMENT celles validées par le bureau — une proposition
//     de l'IA ne sort pas sur papier comme un constat ;
//   • alertes non traitées : listées comme « à vérifier », jamais comme faits.
const ORDRE_PREFIXES = ["P", "PF", "B", "PL", "F"];
function rangCode(code) {
  const m = /^([A-Z]+)(\d+)$/.exec(code || "");
  if (!m) return [99, 0];
  const i = ORDRE_PREFIXES.indexOf(m[1]);
  return [i < 0 ? 98 : i, Number(m[2])];
}
export function syntheseDossier(releve) {
  if (!releve) return null;
  const m = calculerMetres(releve);
  const nomPiece = (id) => (releve.pieces || []).find((p) => p.id === id)?.nom || "?";
  const ouvertures = (releve.ouvertures || [])
    .filter((o) => !o.masque)
    .map((o) => ({
      id: o.id, code: o.code, type: o.type,
      type_label: (TYPES_OUVERTURE.find((t) => t.id === o.type) || {}).label || o.type,
      largeur_cm: o.t0 == null || o.t1 == null ? null : Math.round((o.t1 - o.t0) * 100),
      entre: (o.pieces_liees || [o.piece]).map(nomPiece).join(" / "),
      pieces: o.pieces_liees || [o.piece],
      statut: o.statut, statut_label: STATUTS_OUVERTURE[o.statut] || o.statut,
      a_verifier: o.statut === "a_verifier", a_placer: o.t0 == null || o.t1 == null,
      note: o.raison || null,
    }))
    .sort((a, b) => { const [x, y] = [rangCode(a.code), rangCode(b.code)]; return x[0] - y[0] || x[1] - y[1]; });
  const alertesDe = (id) => (releve.alertes || []).filter((a) => !a.vue && (a.piece === id || (a.pieces || []).includes(id)));
  const pieces = (releve.pieces || []).map((p) => ({
    id: p.id, nom: p.nom, type: p.type,
    hsp: p.hsp ?? HSP_DEFAUT, hsp_mesuree: p.hsp_statut === "mesuree",
    metres: m.pieces.find((l) => l.id === p.id),
    photos: (p.photos || []).filter((ph) => ph.chemin),
    observations: (p.observations || []).filter((ob) => ob.statut === "valide").map((ob) => ob.texte),
    alertes: alertesDe(p.id).map((a) => a.texte),
    ouvertures: ouvertures.filter((o) => o.pieces.includes(p.id)).map((o) => o.code),
  }));
  return {
    metres: m, ouvertures, pieces,
    points: pointsAValider(releve),
    nb_pieces: pieces.length, surface: m.total.sol,
    importe_le: releve.source?.importe_le || null,
  };
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
