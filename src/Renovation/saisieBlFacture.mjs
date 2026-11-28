// Saisie d'un BL à partir de son détail lu sur une facture fournisseur, ou
// complément d'une commande « à détailler » à partir du PDF du BL.
// Module pur : aucune base, aucune horloge, aucun effet de bord.
import { normaliserNumero } from "./rapprochementFactures.mjs";

const centimes = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const euros = (c) => (c == null ? null : c / 100);

/**
 * Met au propre les lignes d'un BL lues par l'IA et contrôle leur somme.
 * - Une ligne sans libellé ni montant est ignorée.
 * - Σ lignes est comparée au montant du BL (tolérance du fournisseur).
 * Retour : { lignes, sommeHt, ecartHt, conforme, montantInconnu }
 *   conforme = false si une ligne n'a pas de montant ou si la somme diffère.
 */
// « 5 m² », « 6 », « 2,5 ML » → { quantite, unite } ; illisible → quantite null.
export function lireQuantite(v) {
  if (typeof v === "number") return { quantite: Number.isFinite(v) ? v : null, unite: "" };
  const m = /^\s*(-?\d[\d\s]*(?:[.,]\d+)?)\s*(.*)$/.exec(String(v ?? ""));
  if (!m) return { quantite: null, unite: "" };
  return { quantite: euros(centimes(m[1])), unite: m[2].trim() };
}

export function preparerLignesBl(lignesIa, montantBl, toleranceHt = 0.05) {
  const lignes = (Array.isArray(lignesIa) ? lignesIa : [])
    .map((l) => ({ l, q: lireQuantite(l?.quantite) }))
    .map(({ l, q }) => ({
      reference: String(l?.reference ?? "").trim(),
      libelle: String(l?.libelle ?? l?.designation ?? "").trim(),
      quantite: q.quantite,
      unite: String(l?.unite ?? "").trim() || q.unite || "U",
      prix_unitaire: euros(centimes(l?.prix_unitaire)),
      prix_total: euros(centimes(l?.prix_total)),
    }))
    .filter((l) => l.libelle || l.reference || l.prix_total != null);
  const totaux = lignes.map((l) => centimes(l.prix_total));
  const ligneSansMontant = totaux.some((t) => t == null);
  const somme = totaux.reduce((n, t) => n + (t || 0), 0);
  const cible = centimes(montantBl);
  const ecart = cible == null ? null : somme - cible;
  return {
    lignes,
    sommeHt: euros(somme),
    ecartHt: euros(ecart),
    montantInconnu: cible == null,
    conforme: lignes.length > 0 && !ligneSansMontant && ecart != null
      && Math.abs(ecart) <= (centimes(toleranceHt) ?? 5),
  };
}

// ── Proposition de chantier à partir de la référence client ─────────────────
// « FOURMOND », « KATELEEN », « MONTILLIERS », « TOUR BOUTON » : écrits à la
// main chez le fournisseur, avec des fautes. On compare des « squelettes » de
// consonnes (sans accents, voyelles, h, y, lettres doublées ni s final), ce qui
// rend Kathleen = Kateline = Kateleen, Montillers = Montilliers.

const MOTS_GENERIQUES = new Set([
  "appt", "appart", "appartement", "studio", "commun", "communs", "parties", "communes",
  "renovation", "rehabilitation", "chantier", "plancher", "ensemble", "enedis", "rue",
  "boulevard", "avenue", "passage", "cable", "faux", "plafond", "entree", "depot", "modifie",
  "sans", "peintures", "living", "la", "le", "les", "du", "de", "des", "et",
]);

const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const mots = (s) => sansAccents(s).split(/[^a-z0-9]+/).filter(Boolean);

export function squelette(mot) {
  return sansAccents(mot).replace(/[^a-z]/g, "")
    .replace(/[aeiouyh]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/s$/, "");
}

const significatif = (m) => m.length >= 4 && !/^\d/.test(m) && !MOTS_GENERIQUES.has(m) && !/^(t|r)\d/.test(m);

// Mots + paires de mots accolées (« tour bouton » → « tourbouton »).
function cles(texte, filtre) {
  const ms = mots(texte);
  const out = new Set();
  ms.forEach((m, i) => {
    if (filtre(m)) out.add(m);
    const suivant = ms[i + 1];
    const accolable = (x) => x && x.length >= 3 && !/^\d/.test(x) && !MOTS_GENERIQUES.has(x);
    if (accolable(m) && accolable(suivant)) out.add(m + suivant);
  });
  return [...out].map(squelette).filter((s) => s.length >= 3);
}

/**
 * @param referenceClient texte libre (« FOURMOND Chantier n° TLV »)
 * @param chantiers [{ id, nom }]
 * @returns { propose: id | null, candidats: [id] }
 *   propose n'est rempli que si UN SEUL chantier correspond : un nom partagé
 *   par plusieurs chantiers (FOURMOND 001 / 101 / 102…) reste un choix humain.
 */
export function proposerChantiers(referenceClient, chantiers = []) {
  const refs = cles(referenceClient, significatif);
  if (!refs.length) return { propose: null, candidats: [] };
  const candidats = chantiers.filter((ch) => {
    const cs = cles(ch?.nom, significatif);
    return cs.some((c) => refs.includes(c));
  }).map((ch) => ch.id);
  return { propose: candidats.length === 1 ? candidats[0] : null, candidats };
}

/** Note conservant la référence client (pas de colonne dédiée en base). */
export function noteReferenceClient(referenceClient, noteExistante = "") {
  const ref = String(referenceClient ?? "").trim();
  if (!ref) return noteExistante || null;
  const ligne = `Réf. client : ${ref}`;
  if (String(noteExistante || "").includes(ligne)) return noteExistante;
  return noteExistante ? `${noteExistante}\n${ligne}` : ligne;
}

/**
 * Numéros de BL comparés sans espaces, casse ni zéros de tête, et sans
 * l'agence Rexel : « CL-4900-619451058-01 » = « 619451058-01 / 4900 ».
 */
export function memeNumeroBl(a, b) {
  const n = (v) => normaliserNumero(v, { retirerAgence: true });
  return !!n(a) && n(a) === n(b);
}

/**
 * Divise une ligne en deux pour la répartir sur deux chantiers (même règle que
 * la saisie classique) : quantité arrondie au-dessus pour la 1re moitié,
 * montant au prorata, au centime près ; la somme des deux = la ligne d'origine.
 * La 2e moitié repart sans chantier ni lot.
 */
export function diviserLigne(l) {
  const q = l?.quantite == null || l.quantite === "" ? null : Number(String(l.quantite).replace(",", "."));
  const tot = centimes(l?.prix_total);
  if (q == null || !Number.isFinite(q) || q <= 0) {
    const t1 = tot == null ? null : Math.ceil(tot / 2);
    return [
      { ...l, prix_total: euros(t1) },
      { ...l, prix_total: tot == null ? null : euros(tot - t1), chantier_id: "", lot_id: "" },
    ];
  }
  const q1 = Math.ceil(q / 2);
  const q2 = q - q1;
  const t1 = tot == null ? null : Math.round(tot * q1 / q);
  return [
    { ...l, quantite: q1, prix_total: euros(t1) },
    { ...l, quantite: q2 || null, prix_total: tot == null ? null : euros(tot - t1), chantier_id: "", lot_id: "" },
  ];
}
