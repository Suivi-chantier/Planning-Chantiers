// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/multiOuvrages.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── MULTI-OUVRAGES DU CHIFFRAGE — RÈGLES PURES ─────────────────────────────
// Un multi-ouvrage (profero_multi_ouvrages) regroupe plusieurs lignes d'une
// même zone d'un chiffrage en UNE ligne de devis : libellé commercial +
// « comprenant les ouvrages suivants » (libellé, quantité, unité, sans prix).
// Les lignes regroupées restent des lignes normales du chiffrage.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Le PRIX n'est pas calculé ici : prixMultiOuvrage (chiffragePricing.mjs) est
// la source unique. Ici : libellé du devis, contrôles, signature de la
// composition et comparaison avec une composition ProGBat relue.
// Testé par scripts/verif-multi-ouvrages.mjs. Façade front : multiOuvrages.js.

import { parseCodeOuvrage } from "./codeOuvrage.mjs";
import { num, normaliserUnite, lignesDuMulti, multiDeLigne, indexerMultiOuvrages, ZONE_DEFAUT } from "./chiffragePricing.mjs";

export const MIN_OUVRAGES_MULTI = 2;
export const UNITE_MULTI = "U";
export const QUANTITE_MULTI = 1;
export const PREFIXE_CODE_MULTI = "MULTI-";
export const INTRO_COMPOSITION = "comprenant les ouvrages suivants :";
export const DECIMALES_QUANTITE_COMPOSITION = 4;

const str = (v) => String(v ?? "").trim();
const zoneDe = (l) => str(l?.zone) || ZONE_DEFAUT;
const tvaDe = (l, tvaPctDefaut) => num(l?.tva_pct) ?? num(tvaPctDefaut);

/** Libellé d'une ligne SANS son code (« E-008 : Tableau… » → « Tableau… »). */
export function libelleCourtLigne(ligne = {}) {
  const p = parseCodeOuvrage(ligne.item);
  return (p?.reste ? str(p.reste) : str(ligne.item)) || str(ligne.code_ouvrage);
}

/** Quantité au format français, 4 décimales au plus : 12.5 → « 12,5 ». */
export function formaterQuantite(q) {
  const v = num(q);
  if (v == null) return "?";
  const f = 10 ** DECIMALES_QUANTITE_COMPOSITION;
  const arr = Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f;
  return String(arr).replace(".", ",");
}

/**
 * Libellé de la ligne de devis d'un multi-ouvrage (ProGBat ET PDF client) :
 *   {libellé commercial}
 *   comprenant les ouvrages suivants :
 *   - {libellé court} : {quantité} {unité}
 * Ordre : ouvrage principal, puis ordre d'affichage du devis.
 */
export function libelleDevisMulti(multi, lignes = []) {
  const enfants = lignesDuMulti(multi, lignes);
  const tete = str(multi?.libelle_commercial);
  if (!enfants.length) return tete;
  const items = enfants.map(l => `- ${libelleCourtLigne(l)} : ${formaterQuantite(l.quantite)} ${normaliserUnite(l.unite)}`);
  return [tete, INTRO_COMPOSITION, ...items].join("\n");
}

/**
 * Contrôles d'un chiffrage qui contient des multi-ouvrages.
 * @returns {Array<{ code, message, multi_id, bloquant }>} — bloquant = export impossible
 */
export function validerMultiOuvrages({ multiOuvrages = [], lignes = [], tvaPctDefaut = null } = {}) {
  const sortie = [];
  const index = indexerMultiOuvrages(multiOuvrages);
  index.forEach((m, id) => {
    const nom = str(m.libelle_commercial) || "Multi-ouvrage sans libellé";
    const ajouter = (code, message, bloquant = true) => sortie.push({ code, message: `« ${nom} » : ${message}`, multi_id: id, bloquant });
    const enfants = lignesDuMulti(m, lignes);
    if (!str(m.libelle_commercial)) ajouter("libelle_commercial_vide", "libellé commercial obligatoire");
    if (!str(m.lot_affichage)) ajouter("lot_affichage_absent", "lot d'affichage non choisi");
    if (enfants.length === 0) ajouter("multi_vide", "ne contient plus aucun ouvrage (le dissoudre ou y remettre des ouvrages)");
    else if (enfants.length < MIN_OUVRAGES_MULTI) ajouter("moins_de_deux", `ne contient plus qu'un ouvrage (${libelleCourtLigne(enfants[0])}) : en ajouter un ou dissoudre le multi-ouvrage`);
    const zone = str(m.zone) || ZONE_DEFAUT;
    enfants.filter(l => zoneDe(l) !== zone).forEach(l => ajouter("ligne_hors_zone", `l'ouvrage ${libelleCourtLigne(l)} est en zone « ${zoneDe(l)} », pas « ${zone} »`));
    const taux = [...new Set(enfants.map(l => tvaDe(l, tvaPctDefaut)).map(t => (t == null ? "?" : String(t))))];
    if (taux.length > 1) ajouter("tva_differentes", `les ouvrages regroupés n'ont pas le même taux de TVA (${taux.join(" % / ")} %) : une ligne de devis n'a qu'un taux`);
    if (enfants.length && str(m.principal_ligne_id) && !enfants.some(l => str(l.id) === str(m.principal_ligne_id))) {
      ajouter("principal_absent", "l'ouvrage principal n'en fait plus partie : le premier ouvrage est affiché en tête", false);
    }
    if (m.ajustement_ht != null && str(m.ajustement_ht) !== "" && num(m.ajustement_ht) == null) ajouter("ajustement_invalide", "ajustement HT invalide");
  });
  return sortie;
}

/**
 * Une sélection de lignes peut-elle former (ou rejoindre) un multi-ouvrage ?
 * @param ids          lignes sélectionnées
 * @param lignes       toutes les lignes du chiffrage
 * @param multiCible   multi-ouvrage existant à compléter (ajout), sinon null (création)
 * @returns {{ ok: boolean, erreurs: string[], zone: string|null, tva: number|null }}
 */
export function verifierRegroupement({ ids = [], lignes = [], multiCible = null, tvaPctDefaut = null } = {}) {
  const erreurs = [];
  const voulu = new Set((ids || []).map(str));
  const choisies = (lignes || []).filter(l => voulu.has(str(l.id)));
  if (choisies.length !== voulu.size) erreurs.push("Certains ouvrages sélectionnés n'existent plus dans ce chiffrage : recharger");
  const existants = multiCible ? lignesDuMulti(multiCible, lignes) : [];
  if (!multiCible && choisies.length < MIN_OUVRAGES_MULTI) erreurs.push(`Sélectionner au moins ${MIN_OUVRAGES_MULTI} ouvrages`);
  if (multiCible && choisies.length === 0) erreurs.push("Sélectionner au moins un ouvrage à ajouter");
  const deja = choisies.filter(l => multiDeLigne(l) != null);
  if (deja.length) erreurs.push(`Déjà dans un multi-ouvrage : ${deja.map(libelleCourtLigne).join(", ")}`);
  const zones = [...new Set([...choisies.map(zoneDe), ...(multiCible ? [str(multiCible.zone) || ZONE_DEFAUT] : [])])];
  if (zones.length > 1) erreurs.push(`Seuls les ouvrages d'une même zone se regroupent (zones sélectionnées : ${zones.join(", ")})`);
  const tvas = [...new Set([...choisies, ...existants].map(l => tvaDe(l, tvaPctDefaut)).map(t => (t == null ? "?" : String(t))))];
  if (tvas.length > 1) erreurs.push(`Taux de TVA différents (${tvas.join(" % / ")} %) : une ligne de devis n'a qu'un taux. Harmoniser la TVA avant de regrouper.`);
  return { ok: erreurs.length === 0, erreurs, zone: zones.length === 1 ? zones[0] : null, tva: tvas.length === 1 && tvas[0] !== "?" ? Number(tvas[0]) : null };
}

// ─── Composition ProGBat d'un multi-ouvrage ──────────────────────────────────
/** Quantité nettoyée à 4 décimales. */
function q4(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 10000) / 10000;
}

/**
 * Composition attendue : [{ componentId, quantity }] triée par componentId,
 * quantités du même ouvrage ProGBat additionnées (un ouvrage posé deux fois
 * dans la zone = un seul composant). `progbatIdDe(ligne)` rend l'identifiant
 * ProGBat ACTUEL de l'ouvrage de la ligne (entier) ou null.
 * @returns {{ ok, composants, manquants: lignes sans identifiant ProGBat, quantitesInvalides }}
 */
export function compositionAttendue(enfants = [], progbatIdDe) {
  const parId = new Map();
  const manquants = [];
  const quantitesInvalides = [];
  (enfants || []).forEach(l => {
    const id = progbatIdDe ? progbatIdDe(l) : null;
    const q = q4(l?.quantite);
    if (!(Number.isInteger(id) && id > 0)) { manquants.push(l); return; }
    if (q == null || q <= 0) { quantitesInvalides.push(l); return; }
    parId.set(id, q4((parId.get(id) ?? 0) + q));
  });
  const composants = [...parId.entries()].sort((a, b) => a[0] - b[0]).map(([componentId, quantity]) => ({ componentId, quantity }));
  return { ok: manquants.length === 0 && quantitesInvalides.length === 0 && composants.length > 0, composants, manquants, quantitesInvalides };
}

/**
 * Texte canonique signé : indépendant de l'ordre des lignes et du libellé
 * commercial (seule la composition compte).
 */
export function canoniqueComposition(composants = []) {
  const tri = [...(composants || [])]
    .map(c => ({ componentId: Number(c.componentId), quantity: q4(c.quantity) }))
    .sort((a, b) => a.componentId - b.componentId || a.quantity - b.quantity);
  return "multi-v1|" + tri.map(c => `${c.componentId}:${c.quantity}`).join(";");
}

/** Signature SHA-256 (hex) de la composition — Web Crypto (navigateur, Deno, Node ≥ 20). */
export async function signatureComposition(composants = []) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto indisponible : signature impossible");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canoniqueComposition(composants)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Code de l'ouvrage ProGBat : « MULTI-3F2A9C10 », puis « -2 », « -3 »… si le code est déjà pris. */
export function codeStructureMulti(signature, rang = 1) {
  const base = `${PREFIXE_CODE_MULTI}${str(signature).slice(0, 8).toUpperCase()}`;
  return rang > 1 ? `${base}-${rang}` : base;
}

/** Premier code libre parmi base, base-2, base-3… (codes déjà présents dans ProGBat). */
export function premierCodeLibre(signature, codesExistants = []) {
  const pris = new Set((codesExistants || []).map(c => str(c).toUpperCase()));
  for (let rang = 1; rang < 1000; rang++) {
    const c = codeStructureMulti(signature, rang);
    if (!pris.has(c.toUpperCase())) return c;
  }
  return null;
}

/** Ce code appartient-il à la famille de codes de cette signature (base ou base-N) ? */
export function codeDeLaSignature(code, signature) {
  const base = codeStructureMulti(signature).toUpperCase();
  const c = str(code).toUpperCase();
  return c === base || new RegExp(`^${base}-\\d+$`).test(c);
}

/**
 * Compare la composition attendue à celle relue dans ProGBat
 * (GET /company/structures/{id}/composition). Identique = mêmes composants,
 * mêmes quantités, et RIEN d'autre (ni « Fournitures » ni « Main d'œuvre »
 * génériques ajoutées par ProGBat, ni modification manuelle).
 */
export function comparerComposition(attendus = [], lus = []) {
  const att = new Map((attendus || []).map(c => [Number(c.componentId), q4(c.quantity)]));
  const lu = new Map();
  const enTrop = [];
  (Array.isArray(lus) ? lus : []).forEach(c => {
    const id = Number(c?.componentId);
    if (!Number.isInteger(id) || !att.has(id) || lu.has(id)) { enTrop.push({ componentId: c?.componentId ?? null, label: str(c?.label), quantity: num(c?.quantity) }); return; }
    lu.set(id, q4(c?.quantity));
  });
  const manquants = [...att.keys()].filter(id => !lu.has(id));
  const differents = [...att.entries()].filter(([id, q]) => lu.has(id) && Math.abs((lu.get(id) ?? 0) - q) > 1e-6).map(([id, q]) => ({ componentId: id, attendu: q, lu: lu.get(id) }));
  return { identique: enTrop.length === 0 && manquants.length === 0 && differents.length === 0, enTrop, manquants, differents };
}
