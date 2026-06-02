// ─── PARSING D'UN DEVIS EXCEL (Phasage v2) ────────────────────────────────────
// Le devis attendu a une structure type BTP :
//   • Des en-têtes de lot (ex : "LOT 2 - ÉLECTRICITÉ", "Électricité", etc.)
//   • Sous chaque en-tête, des lignes d'ouvrages avec libellé + heures +
//     quantité + prix HT (colonnes auto-détectées via les en-têtes).
//
// La fonction `parseDevisExcel` renvoie une liste d'items prêts à être importés,
// chacun avec son lot_id détecté + un éventuel match dans la bibliothèque
// d'ouvrages (pour pré-remplir les tâches via biblio.sous_taches).

import * as XLSX from "xlsx";

export const normalise = (str) =>
  (str || "").toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export const toNum = (val) => {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const cleaned = String(val).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};

// Similarité 0..1 entre deux libellés (ratio Jaccard sur mots significatifs,
// avec bonus pour inclusion totale).
export function scoreSim(a, b) {
  const na = normalise(a), nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wA = new Set(na.split(" ").filter(w => w.length > 2));
  const wB = new Set(nb.split(" ").filter(w => w.length > 2));
  if (wA.size === 0 || wB.size === 0) return 0;
  const inter = [...wA].filter(w => wB.has(w)).length;
  const union = new Set([...wA, ...wB]).size;
  return union > 0 ? inter / union : 0;
}

// Détecte si une rangée Excel correspond à un en-tête de lot.
// On concatène tout le texte de la rangée puis on cherche un label de lot
// (insensible à la casse / accents). Renvoie l'id du lot ou null.
export function detectLot(rowCells, lots) {
  const joined = rowCells.map(c => String(c)).join(" ").trim();
  if (!joined) return null;
  const n = normalise(joined);
  // Best match : on prend le lot dont le label apparaît le plus complètement
  let best = null, bestScore = 0;
  for (const lot of lots) {
    const lotN = normalise(lot.label);
    if (!lotN) continue;
    let s = 0;
    if (n === lotN) s = 1;
    else if (n.includes(lotN)) s = 0.9;
    else s = scoreSim(joined, lot.label);
    if (s > bestScore) { bestScore = s; best = lot; }
  }
  return bestScore >= 0.8 ? best.id : null;
}

// Match d'un libellé d'ouvrage contre la bibliothèque. Renvoie le meilleur
// candidat au-dessus d'un seuil de 0.4 (assez permissif).
export function matchBiblio(libelle, bibliotheque = []) {
  let best = null, bestScore = 0;
  for (const b of bibliotheque) {
    const s = scoreSim(libelle, b.libelle);
    if (s > bestScore) { bestScore = s; best = b; }
  }
  return bestScore >= 0.4 ? { match: best, score: bestScore } : { match: null, score: 0 };
}

// Heuristique pour distinguer une rangée de titre/note (à ignorer) d'une
// rangée d'ouvrage : on demande qu'au moins UNE colonne numérique soit
// renseignée (heures, quantité ou prix). Sinon c'est probablement un titre
// de chapitre ou un commentaire.
function hasNumericData(heures, quantite, prix) {
  return heures != null || quantite != null || prix != null;
}

export async function parseDevisExcel(file, lots = [], bibliotheque = []) {
  const buffer = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // ── Détection de la ligne d'en-tête (1re ligne avec ≥ 2 cellules non vides)
  let hIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (rows[i].filter(c => String(c).trim().length > 0).length >= 2) { hIdx = i; break; }
  }
  const hRow = rows[hIdx] || [];

  // ── Détection des colonnes (libellé / heures / quantité / prix HT)
  let colL = -1, colH = -1, colQ = -1, colP = -1;
  hRow.forEach((cell, i) => {
    const c = normalise(String(cell));
    if (!c) return;
    if (colL === -1 && (
      c.includes("libelle") || c.includes("designation") ||
      c.includes("description") || c.includes("ouvrage") ||
      c.includes("poste") || c.includes("travaux") ||
      c.includes("prestation") || c.includes("article") ||
      c.includes("intitule")
    )) colL = i;
    if (colH === -1 && (
      c.includes("heure") || c.includes("h mo") ||
      c === "mo" || c === "h" || c === "mh" ||
      c.includes("main") || c.includes("temps") ||
      c.includes("duree") || c.includes("mano")
    )) colH = i;
    if (colQ === -1 && (
      c.includes("quantite") || c === "qte" || c === "q" || c === "qt" ||
      c.includes("nombre") || c.includes("surface") ||
      c.includes("volume") || c === "u"
    )) colQ = i;
    if (colP === -1 && (
      c.includes("prix ht") || c.includes("prix h") ||
      c.includes("montant ht") || c.includes("montant h") ||
      c.includes("total ht") || c.includes("montant") ||
      c === "ht" || c === "total"
    )) colP = i;
  });
  // Fallback : si pas de colonne libellé détectée, on prend la première
  if (colL === -1) colL = 0;

  // ── Parcours des lignes de données
  let currentLotId = null;
  const items = [];
  let unknownLotHeaders = []; // pour aide au debug
  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    // Ligne vide → on saute
    if (row.every(c => String(c).trim() === "")) continue;

    // 1) Tentative de détection d'un en-tête de lot.
    //    On le tente seulement si la rangée a peu de cellules remplies
    //    (typique des en-têtes : juste le titre) OU si aucune cellule
    //    numérique n'est présente.
    const heures   = colH >= 0 ? toNum(row[colH]) : null;
    const quantite = colQ >= 0 ? toNum(row[colQ]) : null;
    const prix_ht  = colP >= 0 ? toNum(row[colP]) : null;
    const isLikelyHeader = !hasNumericData(heures, quantite, prix_ht);

    if (isLikelyHeader) {
      const lotId = detectLot(row, lots);
      if (lotId) { currentLotId = lotId; continue; }
      // Pas un lot connu — on essaie de mémoriser au cas où
      const text = row.map(c => String(c)).join(" ").trim();
      if (text && /lot|chapitre|partie/i.test(text)) unknownLotHeaders.push(text);
      continue;
    }

    // 2) Sinon c'est une ligne d'ouvrage
    const libelle = String(row[colL] || "").trim();
    if (!libelle || libelle.length < 3) continue;

    const bm = matchBiblio(libelle, bibliotheque);
    items.push({
      _key: `imp_${i}`,
      libelle,
      lot_id: currentLotId,
      heures,
      quantite,
      prix_ht,
      unite: bm.match?.unite || "U",
      match: bm.match,
      score: bm.score,
      selectionne: true,
    });
  }

  return { items, unknownLotHeaders };
}
