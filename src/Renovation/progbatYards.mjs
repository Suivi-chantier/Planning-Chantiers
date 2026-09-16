// ─────────────────────────────────────────────────────────────────────────────
// LECTURE DES CHANTIERS ProGBat (« yards ») — règles pures.
//
// Ce module ne parle à personne : il ne connaît ni fetch, ni jeton, ni Supabase.
// Il sait seulement (1) quel jeton choisir, (2) comment enchaîner les pages
// d'une liste, (3) quels champs d'un yard ont le droit de sortir. L'Edge
// Function progbat-yards-list branche le réseau dessus ; les tests branchent
// des doublures et vérifient EXACTEMENT les mêmes règles.
//
// La différence avec le parcours du diagnostic (progbat-test-connection) est
// volontaire : là-bas on s'arrêtait dès que les quelques yardId cherchés
// étaient trouvés, parce qu'on vérifiait une hypothèse. Ici on construit la
// liste de rattachement d'un écran : elle doit être COMPLÈTE, donc on pagine
// jusqu'à la vraie fin.
//
// Extension .mjs = parsable ESM par Node sans build (tests) et copiable dans
// le dossier lib/ d'une Edge Function (node scripts/sync-progbat-edge-lib.mjs).
// ─────────────────────────────────────────────────────────────────────────────

// Taille de page demandée à ProGBat. 100 est la valeur déjà utilisée par le
// diagnostic sur cette même ressource.
export const PAGE_SIZE = 100;

// Garde-fou de boucle. 110 chantiers aujourd'hui : 40 pages (4 000 yards)
// laissent une marge très large, tout en garantissant qu'une API qui
// renverrait éternellement des pages pleines finisse par s'arrêter.
export const MAX_PAGES = 40;

// LISTE BLANCHE. Le schéma ProGBat d'un yard contient aussi managerId,
// startDate, endDate, meetingDay, meetingTime, holdbackDuration, viewingDate,
// color — et le payload réel peut contenir davantage. On RECONSTRUIT l'objet à
// partir de ces quatre champs, on ne filtre pas : un champ ajouté demain par
// ProGBat ne peut pas fuiter par omission.
//
// businessId en fait partie depuis le 16/09/2026, et ce n'est pas un détail :
// c'est le numéro que ProGBat AFFICHE dans sa colonne « Code ». Sur un chantier
// réel, l'écran ProGBat montre « #80 TROTIER - T3 - RDC » alors que l'API
// renvoie businessId = 80, id = 83, label = "T3 - RDC". Sans businessId, un
// utilisateur qui cherche « TROTIER » ou « 80 » ne trouve rien — il ne peut pas
// deviner le 83.
//
// businessId sert UNIQUEMENT à reconnaître et retrouver un chantier à l'écran.
// L'identifiant technique reste `id` : c'est lui, et lui seul, que portent les
// factures (bill.yardId) et que stocke chantier_progbat_yards.
export const CHAMPS_YARD = Object.freeze(["id", "businessId", "label", "publicYardNumber"]);

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

/** Projette un yard brut sur la liste blanche. Renvoie null si l'id est inexploitable. */
export function projeterYard(brut) {
  const id = idProgbat(brut?.id);
  if (id === null) return null;
  return {
    // businessId suit la même règle que id — entier strictement positif, sinon
    // null. Un yard sans code affichable reste parfaitement rattachable : seul
    // `id` est indispensable.
    id,
    businessId: idProgbat(brut?.businessId),
    label: texteOuNull(brut?.label),
    publicYardNumber: texteOuNull(brut?.publicYardNumber),
  };
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

// Tri final : par libellé (alphabétique français, insensible à la casse et aux
// accents), puis par id pour que deux yards homonymes gardent un ordre stable.
// Les yards sans libellé passent en fin de liste plutôt qu'en tête.
const collateur = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
export function trierYards(yards) {
  return [...yards].sort((a, b) => {
    if (a.label && !b.label) return -1;
    if (!a.label && b.label) return 1;
    const parLabel = a.label && b.label ? collateur.compare(a.label, b.label) : 0;
    return parLabel !== 0 ? parLabel : a.id - b.id;
  });
}

/**
 * Parcourt la liste paginée des chantiers ProGBat jusqu'à sa fin réelle.
 *
 * @param lirePage async ({ limit, offset }) → { ok: true, data: [...] }
 *                                          |  { ok: false, status, message }
 * @returns { ok, yards, pages, complet, garde_atteinte, status?, message? }
 *
 * Règles d'arrêt, dans cet ordre :
 *   - erreur de page          → on s'arrête et on la remonte (pas de liste partielle
 *                               présentée comme complète) ;
 *   - page plus courte que PAGE_SIZE → fin réelle de la liste ;
 *   - MAX_PAGES atteint       → garde, signalée par garde_atteinte.
 * L'arrêt ne dépend JAMAIS de Content-Range : cet en-tête n'est pas garanti sur
 * /company/yards, et une liste tronquée en silence serait pire qu'une erreur.
 */
export async function parcourirYards(lirePage, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  // Map par id : ProGBat peut renvoyer deux fois le même yard si la liste bouge
  // entre deux pages. Le dernier vu gagne, et le nombre reste juste.
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
        message: r?.message || "Lecture des chantiers ProGBat impossible.",
        yards: trierYards([...parId.values()]),
        pages,
        complet: false,
        garde_atteinte: false,
      };
    }
    const lot = Array.isArray(r.data) ? r.data : [];
    for (const brut of lot) {
      const y = projeterYard(brut);
      if (y) parId.set(y.id, y);
    }
    if (lot.length < pageSize) { finDeListe = true; break; }
  }

  return {
    ok: true,
    yards: trierYards([...parId.values()]),
    pages,
    complet: finDeListe,
    garde_atteinte: !finDeListe && pages >= maxPages,
  };
}
