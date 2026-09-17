// ─────────────────────────────────────────────────────────────────────────────
// analyse-commande — RÈGLES D'AUTORISATION ET DE VALIDATION, PURES.
//
// Aucun réseau, aucune base, aucune horloge : ce module décide, index.ts
// exécute. C'est ce qui permet de vérifier dans Node, avec des doublures, que
// AUCUNE voie de refus n'atteint Anthropic (scripts/verif-analyse-commande.mjs).
//
// POURQUOI CES RÈGLES EXISTENT
// ────────────────────────────
// La fonction était déployée avec verify_jwt = false ET sans le moindre
// contrôle interne : n'importe qui connaissant l'URL pouvait faire analyser un
// document par claude-opus-4-8, facturé sur la clé Anthropic de l'entreprise.
// La passerelle (verify_jwt = true) est désormais le premier verrou ; ce qui
// suit est le second, et il ne fait confiance à rien de ce que le navigateur
// raconte.
//
// L'ORDRE EST LA SÉCURITÉ. Le corps n'est lu qu'après l'autorisation, et
// Anthropic n'est appelé qu'après la validation du corps. Un document n'est
// donc jamais décodé, ni transmis, pour un appelant non autorisé.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rôles autorisés à lancer une analyse.
 *
 * Miroir exact de src/access.js pour les deux écrans concernés :
 *   commandes    → admin, conducteur, comptable
 *   capture-cmd  → admin, conducteur
 * La fonction ne sait pas lequel des deux écrans appelle : elle retient donc
 * l'union. `ouvrier`, `commercial` et `agent_edl` en sont exclus.
 *
 * Le rôle vient TOUJOURS de la table `utilisateurs`, jamais du corps de la
 * requête ni de user_metadata — deux sources que l'appelant contrôle.
 */
export const ROLES_AUTORISES = Object.freeze(["admin", "conducteur", "comptable"]);

/**
 * Limites, toutes déduites de ce que le frontend produit RÉELLEMENT et de ce
 * qu'Anthropic accepte — jamais d'un chiffre arbitraire qui casserait les
 * documents qui passent aujourd'hui.
 *
 *   elements      40  → pdfToImages.js plafonne un PDF à MAX_PAGES = 15 pages.
 *                       40 laisse la place à deux PDF longs plus quelques
 *                       photos (la capture mobile accepte plusieurs fichiers),
 *                       tout en écartant l'abus à 100 images.
 *   par élément   10 Mo → une page rendue à TARGET_MAX_PX = 1560 px en PNG pèse
 *                       typiquement 0,2 à 2 Mo ; 10 Mo couvre aussi le repli
 *                       « PDF brut » quand pdf.js échoue.
 *   total         30 Mo → l'API Messages d'Anthropic plafonne la requête à
 *                       32 Mo : au-delà l'appel échouerait de toute façon, on
 *                       refuse donc avant de payer le transfert.
 *   corps         45 Mo → 30 Mo de binaire font ~40 Mo en base64, plus
 *                       l'enveloppe JSON. Sert au refus PRÉCOCE sur
 *                       Content-Length, qui n'est qu'un indice : la taille
 *                       réelle est recontrôlée après décodage.
 */
export const LIMITES = Object.freeze({
  elements: 40,
  octetsParElement: 10 * 1024 * 1024,
  octetsTotal: 30 * 1024 * 1024,
  octetsCorps: 45 * 1024 * 1024,
});

/**
 * Types acceptés — strictement ceux que les deux écrans produisent et
 * qu'Anthropic sait lire.
 *   image/png         pdfFileToImages() rend chaque page en PNG
 *   image/jpeg        photo d'appareil, accept="image/*"
 *   image/webp, gif   autres formats couverts par accept="image/*"
 *   application/pdf   repli quand le rendu pdf.js échoue
 * Tout le reste est refusé : un type inconnu n'a aucune raison d'atteindre
 * l'API, et l'accepter reviendrait à relayer n'importe quel binaire.
 */
export const TYPES_AUTORISES = Object.freeze([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
]);

/** Taille du binaire une fois le base64 décodé, sans le décoder. */
export function tailleDecodee(base64) {
  const n = base64.length;
  if (n === 0) return 0;
  let padding = 0;
  if (base64[n - 1] === "=") padding++;
  if (base64[n - 2] === "=") padding++;
  return Math.floor(n / 4) * 3 - padding;
}

// Base64 standard, éventuellement padé. On ne décode pas pour vérifier : sur
// 30 Mo ce serait payer deux fois. Le format suffit à écarter une chaîne vide,
// tronquée ou remplie de caractères interdits.
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function estBase64Valide(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length < 8) return false;          // aucun document utile ne tient là-dedans
  if (s.length % 4 !== 0) return false;
  return RE_BASE64.test(s);
}

const refus = (status, code, message) => ({ ok: false, status, code, message });

/**
 * Refus PRÉCOCE sur Content-Length, avant même de lire le corps.
 * L'en-tête est un indice fourni par l'appelant : il permet d'économiser la
 * lecture quand il est honnête, mais ne remplace jamais le contrôle réel.
 *
 * Le type de retour est annoté explicitement : sans cela le `ok` est inféré
 * `boolean` et non `true | false`, et `deno check` ne sait plus discriminer
 * l'union côté index.ts.
 *
 * @returns {{ ok: true }
 *   | { ok: false, status: number, code: string, message: string }}
 */
export function verifierTailleAnnoncee(contentLength) {
  const n = Number(contentLength);
  if (!Number.isFinite(n) || n <= 0) return { ok: true };   // absent ou illisible : on contrôlera après lecture
  if (n > LIMITES.octetsCorps) {
    return refus(413, "CORPS_TROP_VOLUMINEUX", "Document trop volumineux : réduisez le nombre de pages ou la taille des images.");
  }
  return { ok: true };
}

/**
 * Valide le corps et n'en retient QUE ce qui sera transmis.
 *
 * Accepte les deux formes réellement envoyées :
 *   { images: [{ base64, mediaType }] }   les deux écrans aujourd'hui
 *   { imageBase64, mediaType }            forme historique, une seule image
 *
 * @returns { ok: true, images } | { ok: false, status, code, message }
 */
export function validerCorps(corps) {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) {
    return refus(400, "CORPS_INVALIDE", "Corps de requête invalide : un objet JSON est attendu.");
  }

  const brut = Array.isArray(corps.images) && corps.images.length
    ? corps.images
    : (corps.imageBase64 ? [{ base64: corps.imageBase64, mediaType: corps.mediaType }] : []);

  if (!brut.length) {
    return refus(400, "AUCUN_DOCUMENT", "Aucun document à analyser : envoyez au moins une image ou un PDF.");
  }
  if (brut.length > LIMITES.elements) {
    return refus(413, "TROP_DE_DOCUMENTS", `Trop de pages à analyser (${brut.length}) : ${LIMITES.elements} au maximum.`);
  }

  const images = [];
  let total = 0;

  for (let i = 0; i < brut.length; i++) {
    const item = brut[i];
    const rang = i + 1;
    if (!item || typeof item !== "object") {
      return refus(400, "ELEMENT_INVALIDE", `Page ${rang} : format inattendu.`);
    }
    const mediaType = typeof item.mediaType === "string" ? item.mediaType.trim().toLowerCase() : "";
    if (!TYPES_AUTORISES.includes(mediaType)) {
      return refus(400, "TYPE_NON_AUTORISE", `Page ${rang} : format non pris en charge. Formats acceptés : PNG, JPEG, GIF, WebP, PDF.`);
    }
    const base64 = typeof item.base64 === "string" ? item.base64.trim() : "";
    if (!estBase64Valide(base64)) {
      return refus(400, "BASE64_INVALIDE", `Page ${rang} : contenu illisible ou vide.`);
    }
    const taille = tailleDecodee(base64);
    if (taille > LIMITES.octetsParElement) {
      return refus(413, "ELEMENT_TROP_VOLUMINEUX", `Page ${rang} trop volumineuse (${Math.round(taille / 1024 / 1024)} Mo) : ${Math.round(LIMITES.octetsParElement / 1024 / 1024)} Mo au maximum par page.`);
    }
    total += taille;
    if (total > LIMITES.octetsTotal) {
      return refus(413, "TOTAL_TROP_VOLUMINEUX", `Documents trop volumineux au total : ${Math.round(LIMITES.octetsTotal / 1024 / 1024)} Mo au maximum.`);
    }
    // RECONSTRUIT, jamais recopié : un champ ajouté par l'appelant ne peut pas
    // se glisser dans ce qui part vers Anthropic.
    images.push({ base64, mediaType });
  }

  return { ok: true, images, octets: total };
}

/**
 * Le profil autorise-t-il l'analyse ?
 * @param profil ligne `utilisateurs` ({ role, actif }) ou null
 * @returns { ok: true, role } | { ok: false, status, code, message }
 */
export function verifierProfil(profil) {
  if (!profil) {
    return refus(403, "PROFIL_ABSENT", "Accès refusé : aucun profil utilisateur associé à ce compte.");
  }
  // `actif` est nullable en base : seul `false` refuse, une valeur absente
  // laisse le compte actif — c'est la règle déjà appliquée par les autres
  // fonctions (profil.actif === false).
  if (profil.actif === false) {
    return refus(403, "PROFIL_INACTIF", "Accès refusé : ce compte est désactivé.");
  }
  const role = typeof profil.role === "string" ? profil.role.trim().toLowerCase() : "";
  if (!ROLES_AUTORISES.includes(role)) {
    return refus(403, "ROLE_NON_AUTORISE", "Accès refusé : votre rôle ne permet pas l'analyse de documents d'achat.");
  }
  return { ok: true, role };
}

/**
 * L'en-tête Authorization porte-t-il un jeton exploitable ?
 * Ne valide PAS le jeton — c'est le travail du serveur d'authentification.
 * @returns { ok: true, jwt } | { ok: false, status, code, message }
 */
export function extraireJeton(enTete) {
  const v = typeof enTete === "string" ? enTete.trim() : "";
  if (!v) return refus(401, "AUTH_ABSENTE", "Authentification requise.");
  const m = /^Bearer\s+(\S+)$/i.exec(v);
  if (!m) return refus(401, "AUTH_MAL_FORMEE", "Authentification requise.");
  const jwt = m[1];
  // Un JWT a trois segments. Ce contrôle de forme évite un aller-retour réseau
  // pour une valeur qui ne peut pas être un jeton.
  if (jwt.split(".").length !== 3) return refus(401, "AUTH_MAL_FORMEE", "Authentification requise.");
  return { ok: true, jwt };
}
