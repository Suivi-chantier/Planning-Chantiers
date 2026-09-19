// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/codeOuvrage.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── CODE D'OUVRAGE — détecteur unique ───────────────────────────────────────
// Un ouvrage codé porte son code en tête de libellé : « D-001 : Dépose… »,
// « COUV-001 : Reprise de couverture… », « MU-001 Fourniture et pose… »,
// « E-002.3 : Tableau… », « P-1000 Fourniture… », « e-001 prise » (import).
//
// Avant cette version, cinq expressions régulières divergentes coexistaient
// (import devis, bibliothèque, modèle planning, classement des lots, chiffrage)
// et la plupart plafonnaient à trois lettres : COUV-001 n'était pas reconnu
// partout. Ce module est LA source unique ; il est pur (aucun accès Supabase)
// et testé par scripts/verif-code-ouvrage.mjs.
//
// Règle d'acceptation (limite les faux positifs quand on élargit à 5 lettres) :
//   • préfixe : 1 à 5 lettres ;
//   • numéro : 1 à 5 chiffres, décimale optionnelle (« 002.3 ») ;
//   • séparateur : « - », « – », « . », « _ », espace, ou rien ;
//   • si le préfixe n'est pas ENTIÈREMENT en majuscules, un séparateur
//     explicite (« - », « – », « . ») est exigé. « Pose 3 prises » ou « Bac 3 »
//     ne sont donc pas des codes, alors que « e-001 prise » l'est (import Excel).
//
// Forme normalisée d'un code : PREFIXE-NUMERO, ex : « COUV-001 », « E-002.3 ».

export const CODE_OUVRAGE_MAX_LETTRES = 5;

const RE_CODE = /^([A-Za-z]{1,5})([\s\-–._]?)(\d{1,5}(?:\.\d+)?)(?![\d.])\s*([:\-–—]?)\s*([\s\S]*)$/;

const str = (v) => String(v ?? "").trim();

/**
 * Analyse un libellé et en extrait le code de tête.
 * @returns {null | { prefixe: string, numero: string, numeroValeur: number, code: string, reste: string, separateur: string }}
 *   prefixe      : lettres en MAJUSCULES (« COUV »)
 *   numero       : chiffres tels qu'écrits, zéros conservés (« 001 », « 002.3 »)
 *   numeroValeur : valeur numérique pour trier (1, 2.3)
 *   code         : forme normalisée « COUV-001 »
 *   reste        : libellé sans le code ni le séparateur « : » (jamais vide :
 *                  retombe sur le libellé complet si rien ne suit le code)
 */
export function parseCodeOuvrage(libelle) {
  const s = str(libelle);
  if (!s) return null;
  const m = s.match(RE_CODE);
  if (!m) return null;
  const [, lettres, sep, numero, , resteBrut] = m;
  const majuscules = lettres === lettres.toUpperCase();
  const separateurExplicite = sep === "-" || sep === "–" || sep === ".";
  if (!majuscules && !separateurExplicite) return null;
  const prefixe = lettres.toUpperCase();
  const reste = str(resteBrut) || s;
  return {
    prefixe,
    numero,
    numeroValeur: parseFloat(numero),
    code: `${prefixe}-${numero}`,
    reste,
    separateur: sep,
  };
}

/** Code normalisé (« COUV-001 ») ou null. */
export function codeOuvrage(libelle) {
  return parseCodeOuvrage(libelle)?.code ?? null;
}

/** Préfixe d'un code déjà normalisé OU d'un libellé : « COUV-001 » → « COUV ». */
export function prefixeCodeOuvrage(codeOuLibelle) {
  return parseCodeOuvrage(codeOuLibelle)?.prefixe ?? null;
}

/** Vrai si le libellé commence par un code reconnu. */
export function estLibelleCode(libelle) {
  return parseCodeOuvrage(libelle) !== null;
}

/**
 * Compare deux libellés/codes par (préfixe, numéro) — pour trier une liste
 * d'ouvrages codés. Les non codés passent en fin, par ordre alphabétique.
 */
export function comparerCodes(a, b) {
  const ca = parseCodeOuvrage(a), cb = parseCodeOuvrage(b);
  if (ca && cb) {
    if (ca.prefixe !== cb.prefixe) return ca.prefixe.localeCompare(cb.prefixe);
    if (ca.numeroValeur !== cb.numeroValeur) return ca.numeroValeur - cb.numeroValeur;
    return ca.code.localeCompare(cb.code);
  }
  if (ca) return -1;
  if (cb) return 1;
  return str(a).localeCompare(str(b));
}

/**
 * Retrouve le lot de travaux d'un libellé codé à partir du préfixe
 * (`lots` = planning_config.lots_travaux, chacun avec `code_prefixe`).
 * @returns {object|null} le lot, ou null si aucun lot ne porte ce préfixe.
 */
export function lotParCode(libelle, lots = []) {
  const p = prefixeCodeOuvrage(libelle);
  if (!p) return null;
  return (lots || []).find(l => str(l?.code_prefixe).toUpperCase() === p) || null;
}
