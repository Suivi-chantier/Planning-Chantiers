// ─────────────────────────────────────────────────────────────────────────────
// ÉCRAN « CHANTIERS ProGBat ASSOCIÉS » — règles pures.
//
// Ce module ne parle à personne : ni Supabase, ni React, ni réseau. Il répond à
// trois questions, et à rien d'autre :
//   1. comment nommer un chantier ProGBat à l'écran ;
//   2. quels rattachements appartiennent au chantier affiché ;
//   3. lesquels des ~110 chantiers ProGBat proposer, dans quel état.
//
// Pourquoi séparer ça du composant : ce sont exactement les règles qui, si
// elles se trompent, rattachent de l'argent au mauvais chantier. Elles doivent
// être vérifiables sans navigateur — scripts/verif-progbat-yards-ecran.mjs.
//
// LE NOM D'UN CHANTIER ProGBat, C'EST SON CODE — TEL QUEL
// ──────────────────────────────────────────────────────
// L'écran ProGBat affiche « #83 TROTTIER - T2 - R+2 » ; l'API donne à ce même
// chantier l'id 86 et le libellé « T2 - R+2 ». Le code vient du champ `code` de
// l'affaire (voir progbatYards.mjs) et il est repris ICI SANS RIEN Y AJOUTER :
// pas de préfixe, pas de numéro accolé, pas de recomposition. « #103 TROTTIER
// ENEDIS » ne suit pas le même motif que « #83 TROTTIER - T2 - R+2 » : toute
// règle de composition serait fausse quelque part.
//
// L'identifiant technique (86) n'est PAS un nom : les factures le portent, mais
// il n'apparaît nulle part dans ProGBat. Il reste en information secondaire, et
// ne sert de repli que lorsque le code manque.
//
// Ce module ne rapproche JAMAIS un chantier ProGBat d'un chantier Profero par
// ressemblance : il ne lit ces textes que pour filtrer une recherche tapée à la
// main et pour trier.
// ─────────────────────────────────────────────────────────────────────────────

const texte = (v) => String(v ?? "").trim();

/**
 * Nom affiché d'un chantier ProGBat : son code EXACT.
 * Sans code (affaire inconnue, code vide, API des affaires en échec), repli
 * lisible : « T2 - R+2 — chantier ProGBat n°86 ».
 */
export function libelleYard(yard) {
  const code = texte(yard?.code);
  if (code) return code;
  const label = texte(yard?.label);
  return label
    ? `${label} — chantier ProGBat n°${yard?.id}`
    : `Chantier ProGBat n°${yard?.id}`;
}

/** Option du select : le code exact, sans rien y accoler. */
export function optionYard(yard) {
  return libelleYard(yard);
}

/**
 * Nom d'un rattachement enregistré. Si le chantier est retrouvé dans la liste
 * ProGBat, on montre son état ACTUEL (le code a pu être corrigé chez ProGBat) ;
 * sinon on retombe sur le libellé figé au moment du rattachement — c'est pour
 * cela qu'on y enregistre le code, et non le seul sous-libellé.
 */
export function libelleLien(lien, yardConnu) {
  if (yardConnu) return libelleYard(yardConnu);
  const fige = texte(lien?.progbat_yard_label);
  return fige || `Chantier ProGBat n°${lien?.progbat_yard_id}`;
}

/**
 * Normalisation de recherche : sans casse, sans accents, et les séparateurs
 * ramenés à une espace. « T2 - R+2 » se cherche alors en tapant « T2 R+2 »,
 * « t2-r2 » ou « R+2 », et « #83 » en tapant « 83 » — personne ne retape la
 * ponctuation exacte d'un code ProGBat.
 */
export function normaliserRecherche(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Forme compacte : la m\u00eame, s\u00e9parateurs supprim\u00e9s. \u00ab T2 R2 \u00bb tap\u00e9 d'une traite
// doit retrouver \u00ab T2 - R+2 \u00bb, alors que l'espace tap\u00e9e ne correspond \u00e0 aucune
// espace du code. Chercher dans les deux formes co\u00fbte deux comparaisons et
// \u00e9vite \u00ab aucun r\u00e9sultat \u00bb sur une frappe parfaitement raisonnable.
const compacter = (s) => s.replace(/ /g, "");

/** Le texte `valeur` r\u00e9pond-il \u00e0 la recherche d\u00e9j\u00e0 normalis\u00e9e `q` ? */
export function correspond(valeur, q) {
  if (!q) return true;
  const n = normaliserRecherche(valeur);
  return n.includes(q) || compacter(n).includes(compacter(q));
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
 * - recherche → filtre sur le CODE affiché, le libellé, l'identifiant technique
 *   et le numéro public. Le code d'abord : c'est ce que l'utilisateur a sous
 *   les yeux dans ProGBat.
 */
export function yardsProposables({ yards = [], liens = [], chantierId, recherche = "" } = {}) {
  const dejaIci = new Set(rattachementsDuChantier(liens, chantierId).map((l) => cle(l?.progbat_yard_id)));
  const ailleurs = yardsPrisAilleurs(liens, chantierId);
  const q = normaliserRecherche(recherche);
  return yards
    .filter((y) => !dejaIci.has(cle(y?.id)))
    .filter((y) => !q || [y?.code, y?.label, y?.id, y?.publicYardNumber]
      .some((v) => correspond(v, q)))
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
