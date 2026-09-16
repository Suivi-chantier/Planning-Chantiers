// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatYards.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// LECTURE DES CHANTIERS ProGBat (« yards ») — règles pures.
//
// Ce module ne parle à personne : il ne connaît ni fetch, ni jeton, ni Supabase.
// Il sait seulement (1) quel jeton choisir, (2) comment enchaîner les pages
// d'une liste, (3) quels champs ont le droit de sortir, (4) comment rapprocher
// un yard de son affaire pour en tirer le CODE AFFICHÉ. L'Edge Function
// progbat-yards-list branche le réseau dessus ; les tests branchent des
// doublures et vérifient EXACTEMENT les mêmes règles.
//
// LE CODE AFFICHÉ PAR ProGBat
// ───────────────────────────
// L'écran « Chantiers » de ProGBat montre une colonne « Code » :
//   #80 TROTTIER - T3 - RDC
//   #82 TROTTIER - T3 - R+1
//   #83 TROTTIER - T2 - R+2
//   #103 TROTTIER ENEDIS
// et une colonne « Code interne » qui vaut #80, #82, #83, #103 — c'est-à-dire
// le `businessId` du yard (le yard « #83 TROTTIER - T2 - R+2 » a l'id 86).
//
// Cette chaîne est STOCKÉE, pas calculée : « #103 TROTTIER ENEDIS » ne suit pas
// le même motif que « #83 TROTTIER - T2 - R+2 », donc aucune règle de
// composition ne la produit. Elle est lue telle quelle dans le champ `code` de
// l'affaire (GET /company/business), rapprochée par yard.businessId — le champ
// yard.publicYardNumber, seul autre candidat du schéma yard, est vide sur les
// données réelles. On ne la RECONSTRUIT jamais : un code recomposé serait faux
// dès la première exception de format, et l'utilisateur ne retrouverait pas son
// chantier.
//
// L'identifiant technique reste `id` : c'est lui, et lui seul, que portent les
// factures (bill.yardId) et que stocke chantier_progbat_yards. `businessId` ne
// sert qu'à la jointure et ne sort pas.
//
// Extension .mjs = parsable ESM par Node sans build (tests) et copiable dans
// le dossier lib/ d'une Edge Function (node scripts/sync-progbat-edge-lib.mjs).
// ─────────────────────────────────────────────────────────────────────────────

// Taille de page demandée à ProGBat. 100 est la valeur déjà utilisée par le
// diagnostic sur cette même ressource.
export const PAGE_SIZE = 100;

// Garde-fou de boucle. 110 chantiers aujourd'hui : 40 pages (4 000 éléments)
// laissent une marge très large, tout en garantissant qu'une API qui
// renverrait éternellement des pages pleines finisse par s'arrêter.
export const MAX_PAGES = 40;

// LISTE BLANCHE DE SORTIE. Le schéma ProGBat d'un yard contient aussi
// businessId, managerId, startDate, endDate, meetingDay, meetingTime,
// holdbackDuration, viewingDate, color — et le payload réel peut contenir
// davantage. On RECONSTRUIT l'objet à partir de ces quatre champs, on ne filtre
// pas : un champ ajouté demain par ProGBat ne peut pas fuiter par omission.
export const CHAMPS_YARD = Object.freeze(["id", "code", "label", "publicYardNumber"]);

// LISTE BLANCHE DE L'AFFAIRE. /company/business renvoie aussi thirdId, address,
// postcode, city, country, object, managerId, status… : rien de tout cela ne
// doit atteindre le navigateur. On ne garde que l'identifiant (pour la
// jointure) et le code (pour l'affichage).
export const CHAMPS_AFFAIRE = Object.freeze(["id", "code"]);

// Identifiant ProGBat exploitable : entier strictement positif.
// Même règle que progbatLiaison.mjs — 0, null, "" et "abc" ne sont pas des
// identifiants. Un yard sans id n'est pas rattachable : il est écarté.
const idProgbat = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
};

const texteOuNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Projette un yard brut sur sa forme INTERNE (liste blanche + businessId, qui
 * sert à la jointure et ne sort pas). Renvoie null si l'id est inexploitable.
 */
export function projeterYard(brut) {
  const id = idProgbat(brut?.id);
  if (id === null) return null;
  return {
    id,
    businessId: idProgbat(brut?.businessId),
    label: texteOuNull(brut?.label),
    publicYardNumber: texteOuNull(brut?.publicYardNumber),
  };
}

/**
 * Projette une affaire brute sur { id, code }. Le code est pris TEL QUEL —
 * espaces de bord en moins — et vaut null s'il est vide : un code absent doit
 * se voir comme absent, pas se remplacer par un numéro inventé.
 */
export function projeterAffaire(brut) {
  const id = idProgbat(brut?.id);
  if (id === null) return null;
  return { id, code: texteOuNull(brut?.code) };
}

/** Index businessId → code affiché, construit à partir des affaires lues. */
export function indexerCodesAffaires(affaires) {
  const parId = new Map();
  for (const a of affaires || []) {
    const p = projeterAffaire(a);
    if (p) parId.set(p.id, p.code);
  }
  return parId;
}

// Tri d'affichage : sur le CODE, puisque c'est ce que l'écran montre. Les
// chantiers sans code passent en fin de liste plutôt qu'en tête, et deux
// homonymes gardent un ordre stable grâce à l'id.
const collateur = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const comparer = (a, b, cle) => {
  const va = a[cle];
  const vb = b[cle];
  if (va && !vb) return -1;
  if (!va && vb) return 1;
  const parTexte = va && vb ? collateur.compare(va, vb) : 0;
  return parTexte !== 0 ? parTexte : a.id - b.id;
};

/** Tri des yards par libellé (forme interne, avant jointure). */
export function trierYards(yards) {
  return [...yards].sort((a, b) => comparer(a, b, "label"));
}

/**
 * Réponse finale : un yard projeté sur CHAMPS_YARD, son code venant de son
 * affaire. Aucune recomposition — si l'affaire est inconnue ou sans code, le
 * code vaut null et l'écran retombe sur le libellé, en le disant.
 */
export function composerYards(yards, affaires) {
  const codes = indexerCodesAffaires(affaires);
  return (yards || [])
    .map((y) => ({
      id: y.id,
      code: y.businessId === null ? null : (codes.get(y.businessId) ?? null),
      label: y.label ?? null,
      publicYardNumber: y.publicYardNumber ?? null,
    }))
    .sort((a, b) => comparer(a, b, "code"));
}

/**
 * Choix du jeton ProGBat.
 * Le jeton DÉDIÉ à la facturation porte bills.read + transactions.read +
 * business.read : c'est lui qui doit servir. Le jeton historique n'est un repli
 * que si le secret dédié est ABSENT — jamais parce que le dédié a échoué :
 * réessayer avec un autre jeton après un 403 masquerait le scope manquant au
 * lieu de le signaler.
 */
export function choisirJeton({ billing = "", legacy = "" } = {}) {
  const b = String(billing || "").trim();
  const l = String(legacy || "").trim();
  if (b) return { token: b, source: "billing" };
  if (l) return { token: l, source: "legacy" };
  return { token: "", source: null };
}

/**
 * Parcourt une liste paginée ProGBat jusqu'à sa fin réelle.
 *
 * @param lirePage async ({ limit, offset }) → { ok: true, data: [...] }
 *                                          |  { ok: false, status, message }
 * @param projeter (brut) → objet projeté, ou null pour écarter l'élément
 * @returns { ok, elements, pages, complet, garde_atteinte, status?, message? }
 *
 * Règles d'arrêt, dans cet ordre :
 *   - erreur de page          → on s'arrête et on la remonte (pas de liste partielle
 *                               présentée comme complète) ;
 *   - page plus courte que PAGE_SIZE → fin réelle de la liste ;
 *   - MAX_PAGES atteint       → garde, signalée par garde_atteinte.
 * L'arrêt ne dépend JAMAIS de Content-Range : cet en-tête n'est pas garanti sur
 * ces ressources, et une liste tronquée en silence serait pire qu'une erreur.
 */
export async function parcourirListe(lirePage, { projeter, pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  // Map par id : ProGBat peut renvoyer deux fois le même élément si la liste
  // bouge entre deux pages. Le dernier vu gagne, et le nombre reste juste.
  const parId = new Map();
  let pages = 0;
  let finDeListe = false;

  while (pages < maxPages) {
    const r = await lirePage({ limit: pageSize, offset: pages * pageSize });
    pages++;
    if (!r?.ok) {
      return {
        ok: false,
        status: r?.status ?? 0,
        message: r?.message || "Lecture de la liste ProGBat impossible.",
        elements: [...parId.values()],
        pages,
        complet: false,
        garde_atteinte: false,
      };
    }
    const lot = Array.isArray(r.data) ? r.data : [];
    for (const brut of lot) {
      const p = projeter(brut);
      if (p) parId.set(p.id, p);
    }
    if (lot.length < pageSize) { finDeListe = true; break; }
  }

  return {
    ok: true,
    elements: [...parId.values()],
    pages,
    complet: finDeListe,
    garde_atteinte: !finDeListe && pages >= maxPages,
  };
}

/** Parcours de GET /company/yards. Même contrat, `yards` en sortie. */
export async function parcourirYards(lirePage, options = {}) {
  const r = await parcourirListe(lirePage, { ...options, projeter: projeterYard });
  return { ...r, yards: trierYards(r.elements) };
}

/** Parcours de GET /company/business. Même contrat, `affaires` en sortie. */
export async function parcourirAffaires(lirePage, options = {}) {
  const r = await parcourirListe(lirePage, { ...options, projeter: projeterAffaire });
  return { ...r, affaires: r.elements };
}
