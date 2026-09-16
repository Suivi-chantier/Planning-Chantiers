// ─────────────────────────────────────────────────────────────────────────────
// ÉCRAN « CHANTIERS ProGBat ASSOCIÉS » — règles pures.
//
// Ce module ne parle à personne : ni Supabase, ni React, ni réseau. Il répond à
// trois questions, et à rien d'autre :
//   1. comment nommer un chantier ProGBat qui n'a pas de libellé ;
//   2. quels rattachements appartiennent au chantier affiché ;
//   3. lesquels des ~110 chantiers ProGBat proposer, dans quel état.
//
// Pourquoi séparer ça du composant : ce sont exactement les règles qui, si
// elles se trompent, rattachent de l'argent au mauvais chantier. Elles doivent
// être vérifiables sans navigateur — scripts/verif-progbat-yards-ecran.mjs.
//
// Ce module ne rapproche JAMAIS un chantier ProGBat d'un chantier Profero par
// ressemblance de libellé : il ne lit les libellés que pour filtrer une
// recherche tapée à la main et pour trier.
// ─────────────────────────────────────────────────────────────────────────────

// DEUX NUMÉROS, À NE JAMAIS CONFONDRE :
//   businessId → le « Code » que ProGBat AFFICHE (#80). C'est par lui que
//                l'utilisateur reconnaît son chantier ; il n'a aucune valeur
//                technique ici.
//   id         → le yardId, porté par les factures et enregistré dans
//                chantier_progbat_yards.progbat_yard_id. Invisible dans
//                l'interface ProGBat.
// Sur un chantier réel : ProGBat montre « #80 TROTIER - T3 - RDC », l'API
// renvoie businessId 80, id 83, label « T3 - RDC ». Afficher « ProGBat n°83 »
// laissait croire que 83 était le code visible : d'où « Code ProGBat #80 » d'un
// côté et « yard n°83 » de l'autre, toujours nommés.

/** « Code ProGBat #80 » — ou null si le yard n'a pas de code affichable. */
export function codeAffiche(businessId) {
  const n = Number(businessId);
  return Number.isInteger(n) && n > 0 ? `Code ProGBat #${n}` : null;
}

/**
 * Libellé lisible d'un chantier ProGBat : le code visible puis le sous-libellé.
 * C'est aussi ce qui est ENREGISTRÉ dans progbat_yard_label, pour que le code
 * reste lisible même quand l'API ne répond plus.
 */
export function libelleYard(yard) {
  const morceaux = [codeAffiche(yard?.businessId), String(yard?.label ?? "").trim()].filter(Boolean);
  return morceaux.join(" · ") || "Chantier ProGBat sans libellé";
}

/** Option du select : « Code ProGBat #80 · T3 - RDC — yard n°83 ». */
export function optionYard(yard) {
  return `${libelleYard(yard)} — yard n°${yard?.id}`;
}

/**
 * Libellé d'un rattachement enregistré. Si le yard est retrouvé dans la liste
 * ProGBat, on montre son état ACTUEL (le code a pu changer chez ProGBat) ;
 * sinon on retombe sur le libellé figé au moment du rattachement.
 */
export function libelleLien(lien, yardConnu) {
  if (yardConnu) return libelleYard(yardConnu);
  return String(lien?.progbat_yard_label ?? "").trim() || "Chantier ProGBat sans libellé";
}

/**
 * Normalisation de recherche : sans casse, sans accents, et les séparateurs
 * ramenés à une espace. « T3 - RDC » se cherche alors aussi bien en tapant
 * « T3 RDC » ou « t3-rdc », et « #80 » en tapant « 80 » — personne ne retape
 * la ponctuation exacte d'un libellé ProGBat.
 */
export function normaliserRecherche(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Les identifiants viennent de deux mondes (bigint en base, number dans le
// JSON ProGBat) : toute comparaison passe par la même forme texte.
const cle = (v) => String(v ?? "");

const collateur = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Rattachements du chantier affiché, triés par libellé enregistré. Le tri se
 * fait sur ce qui est EN BASE : il ne doit pas changer selon que la liste
 * ProGBat a répondu ou non.
 */
export function rattachementsDuChantier(liens, chantierId) {
  return (liens || [])
    .filter((l) => cle(l?.chantier_id) === cle(chantierId))
    .slice()
    .sort((a, b) => collateur.compare(libelleLien(a, null), libelleLien(b, null)));
}

/** Map progbat_yard_id → chantier_id, pour les liens des AUTRES chantiers. */
export function yardsPrisAilleurs(liens, chantierId) {
  return new Map(
    (liens || [])
      .filter((l) => cle(l?.chantier_id) !== cle(chantierId))
      .map((l) => [cle(l?.progbat_yard_id), l?.chantier_id]),
  );
}

/**
 * Chantiers ProGBat proposables dans le select.
 *
 * - déjà rattaché AU CHANTIER AFFICHÉ → retiré (le proposer n'a aucun sens) ;
 * - déjà rattaché AILLEURS           → conservé, marqué `pris` (donc affiché
 *   désactivé) : c'est plus utile que de le faire disparaître, on comprend
 *   pourquoi il manque au lieu de le chercher ;
 * - recherche → filtre sur le CODE VISIBLE (businessId), le libellé, le yardId
 *   et le numéro public. Le code visible est celui que l'utilisateur a sous les
 *   yeux dans ProGBat : c'est par lui qu'il cherche, bien plus que par le
 *   yardId qu'il ne voit nulle part.
 */
export function yardsProposables({ yards = [], liens = [], chantierId, recherche = "" } = {}) {
  const dejaIci = new Set(rattachementsDuChantier(liens, chantierId).map((l) => cle(l?.progbat_yard_id)));
  const ailleurs = yardsPrisAilleurs(liens, chantierId);
  const q = normaliserRecherche(recherche);
  return yards
    .filter((y) => !dejaIci.has(cle(y?.id)))
    .filter((y) => !q || [y?.businessId, y?.label, y?.id, y?.publicYardNumber]
      .some((v) => normaliserRecherche(v).includes(q)))
    .map((y) => ({ ...y, pris: ailleurs.get(cle(y?.id)) || null }));
}

/**
 * Un rattachement enregistré est-il introuvable dans ProGBat aujourd'hui ?
 * La question n'a de sens que si la liste a pu être LUE : sans liste (erreur
 * réseau, chargement), on ne sait pas — et on ne prétend pas savoir.
 */
export function yardIntrouvable(lien, yards, listeLue) {
  if (!listeLue || !Array.isArray(yards) || yards.length === 0) return false;
  return !yards.some((y) => cle(y?.id) === cle(lien?.progbat_yard_id));
}
