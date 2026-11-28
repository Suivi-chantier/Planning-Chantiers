// Noms de fournisseurs : rapprochement d'un nom lu (IA, saisie) avec le référentiel.
// Module pur : aucune base, aucune horloge.

// Normalise un nom de fournisseur (minuscules, sans accents ni ponctuation).
export function normFournisseur(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Trouve le fournisseur existant le plus proche d'un nom détecté (ex. IA).
// Gère les variantes "Rexel Angers" / "Rexel France" -> "Rexel" via préfixe/inclusion,
// et exige au moins 2 mots communs pour un match par similarité (évite de fusionner
// "Point P" et "Point Vert" sur le seul mot "Point"). Renvoie { fournisseur, score }.
// fournisseur = null si rien d'assez proche (score < 0.6) -> à créer.
// Autres noms sous lesquels un fournisseur facture (raison sociale ≠ enseigne,
// ex. ZOLPAN facture au nom de « Cromology Distribution Centre Ouest ») :
// fournisseurs.regles_numero.alias = ["CROMOLOGY", …].
export function nomsFournisseur(f) {
  const alias = Array.isArray(f?.regles_numero?.alias) ? f.regles_numero.alias : [];
  return [f?.nom, ...alias].filter(n => typeof n === "string" && n.trim());
}

function scoreNoms(a, b) {
  const aNs = a.replace(/ /g, "");
  const bNs = b.replace(/ /g, "");
  if (a === b) return 1;
  if (aNs.startsWith(bNs) || bNs.startsWith(aNs)) return 0.9;
  if (aNs.includes(bNs) || bNs.includes(aNs)) return 0.8;
  const aTok = new Set(a.split(" ").filter(w => w.length > 2));
  const bTok = new Set(b.split(" ").filter(w => w.length > 2));
  const shared = [...aTok].filter(t => bTok.has(t)).length;
  const denom = aTok.size + bTok.size;
  return (shared >= 2 && denom) ? (2 * shared) / denom : 0;
}

export function matchFournisseur(raw, fournisseurs) {
  const a = normFournisseur(raw);
  if (!a) return { fournisseur: null, score: 0 };
  let best = null, bestScore = 0;
  for (const f of (fournisseurs || [])) {
    for (const nom of nomsFournisseur(f)) {
      const b = normFournisseur(nom);
      if (!b) continue;
      const score = scoreNoms(a, b);
      if (score > bestScore) { bestScore = score; best = f; }
    }
  }
  return { fournisseur: bestScore >= 0.6 ? best : null, score: bestScore };
}


// N° de TVA intracommunautaire normalisé : majuscules, sans espaces ni
// ponctuation (« fr 26 309.304.616 » → « FR26309304616 »). "" si vide.
export function normTva(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Reconnaît le fournisseur d'une facture (cahier §4 P1) :
//   1. n° de TVA lu = fournisseurs.tva_intracom (égalité exacte après normalisation) ;
//   2. sinon nom / autres noms via matchFournisseur.
// Renvoie { fournisseur, par: "tva" | "nom" | null, score }.
// fournisseur = null : rien de reconnu, c'est à l'utilisateur de choisir —
// jamais de création automatique.
export function reconnaitreFournisseur({ tva, nom } = {}, fournisseurs) {
  const t = normTva(tva);
  if (t) {
    const parTva = (fournisseurs || []).filter(f => normTva(f?.tva_intracom) === t);
    if (parTva.length === 1) return { fournisseur: parTva[0], par: "tva", score: 1 };
  }
  const m = matchFournisseur(nom, fournisseurs);
  return m.fournisseur
    ? { fournisseur: m.fournisseur, par: "nom", score: m.score }
    : { fournisseur: null, par: null, score: m.score };
}
