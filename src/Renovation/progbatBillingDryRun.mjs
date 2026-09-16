// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC DE PRÉ-SYNCHRONISATION ProGBat — logique serveur PURE.
//
// Ce module calcule EXACTEMENT ce que la future synchronisation des factures et
// des règlements créerait ou modifierait. Il n'écrit rien, nulle part : ni dans
// Supabase, ni dans ProGBat. C'est un COMPTAGE, pas une écriture différée.
//
// Comme progbatQuoteServeur.mjs, il n'a aucune dépendance Deno ni Supabase :
// tout accès externe est injecté (`depot` = lectures Supabase, `progbat` =
// GET sur l'API). Il est donc testé dans Node avec des doublures
// (scripts/verif-progbat-billing-dry-run.mjs) sans jamais toucher l'API réelle.
// Copié dans supabase/functions/progbat-billing-dry-run/lib/ par
// scripts/sync-progbat-edge-lib.mjs (ne pas éditer la copie).
//
// LES RÈGLES NE SONT PAS ICI. Elles vivent déjà ailleurs et sont réutilisées
// telles quelles, jamais réécrites :
//   • progbatFacturation.mjs → normaliserFactureProgbat, fusionnerFactureProgbat,
//                              normaliserReglementProgbat ;
//   • progbatLiaison.mjs     → resoudreChantierDepuisFacture (yard prioritaire,
//                              devis en repli, yard_non_rattache, conflit) ;
//   • progbatYards.mjs       → choisirJeton, parcourirListe (pagination).
// Ce module ORCHESTRE : il enchaîne les pages, croise les deux sources, range
// chaque facture et chaque règlement dans une catégorie, et borne la sortie.
//
// CE QUI SORT, ET CE QUI NE SORT JAMAIS
// ─────────────────────────────────────
// Les exemples sont RECONSTRUITS champ par champ (exempleFacture /
// exempleReglement) à partir d'une liste blanche : un champ ajouté demain par
// ProGBat ne peut pas fuiter par omission. Ni client, ni adresse, ni e-mail, ni
// téléphone, ni content[], ni thirdId, ni bankAccountId, ni libellé bancaire,
// ni IBAN, ni paymentNumber, ni jeton, ni payload brut. Les objets bruts
// restent à l'intérieur de ce module, le temps de les classer.
//
// « INCHANGÉE » ET L'HEURE DU DIAGNOSTIC
// ──────────────────────────────────────
// progbat_synced_at change à chaque lecture : le comparer transformerait TOUTES
// les lignes en « mise à jour » et rendrait le diagnostic inutile. La
// comparaison porte donc sur une liste blanche de champs MÉTIER
// (CHAMPS_COMPARES_FACTURE / CHAMPS_COMPARES_REGLEMENT) dont les champs
// techniques volatils sont exclus par construction.
//
// PAGINATION INCOMPLÈTE : DEUX POIDS, DEUX MESURES — et c'est voulu
// ──────────────────────────────────────────────────────────────────
//   • factures incomplètes (erreur de page ou garde atteinte) → ERREUR. Sans la
//     liste complète des factures, un règlement se croirait orphelin et le
//     diagnostic mentirait ;
//   • transactions incomplètes → résultat RENDU, mais marqué incomplet, et
//     reconciliation_absence_autorisee = false : aucune annulation n'est
//     proposée, parce qu'« absent de la liste » ne veut plus rien dire.
// Dans les deux cas, rien n'est jamais présenté comme complet quand il ne l'est
// pas. L'arrêt de la pagination ne dépend JAMAIS de Content-Range.
// ─────────────────────────────────────────────────────────────────────────────

import {
  idProgbat,
  montantOuNull,
  normaliserFactureProgbat,
  fusionnerFactureProgbat,
  normaliserReglementProgbat,
  REFUS,
} from "./progbatFacturation.mjs";
import { RESOLUTION, SOURCE, resoudreChantierDepuisFacture } from "./progbatLiaison.mjs";
import { MAX_PAGES, PAGE_SIZE, parcourirListe } from "./progbatYards.mjs";

export { MAX_PAGES, PAGE_SIZE };

/** Exemples rendus par catégorie. Les COMPTAGES, eux, restent complets. */
export const MAX_EXEMPLES = 20;

// Tris déjà éprouvés sur les données réelles par progbat-test-connection : on
// ne les invente pas ici. Une reprise SANS tri n'est autorisée que sur 400/422
// (« requête invalide ») — jamais sur 401/403/429/500, qui ne parlent pas de tri.
export const TRI_FACTURES = '{"documentDate":-1}';
export const TRI_TRANSACTIONS = '{"date":-1}';

/** Où atterrit une facture, une fois tout appliqué. */
export const CATEGORIES_FACTURE = Object.freeze([
  "brouillon_ignore",        // validated ≠ 1
  "normalisation_refusee",   // normaliserFactureProgbat a refusé (hors brouillon)
  "non_resolue",             // aucun chantier : rien ne peut être créé (chantier_id est NOT NULL)
  "fusion_refusee",          // la ligne locale est manuelle, ou porte un autre bill.id
  "creation",
  "mise_a_jour",
  "inchangee",
]);

/** D'où vient (ou ne vient pas) le chantier. Axe distinct de la catégorie. */
export const CATEGORIES_RESOLUTION = Object.freeze([
  "resolution_yard",
  "resolution_devis_secours",
  "yard_non_rattache",
  "devis_non_rattache",      // quote absent / devis inconnu / logement non rattaché
  "conflit",
]);

export const CATEGORIES_REGLEMENT = Object.freeze([
  "transaction_inactive_ou_inconnue", // canceled ≠ 0 ou checked ≠ 1
  "lettrage_ignore",                  // docType ≠ "bill", id ou montant illisible
  "facture_introuvable",
  "creation",
  "mise_a_jour",
  "inchange",
  "annulation_proposee",              // absent de l'ensemble actif distant, et pas encore annulé
  "deja_annule",                      // absent lui aussi, mais DÉJÀ annule = true : aucune écriture
]);

// ── Listes blanches de SORTIE ───────────────────────────────────────────────
export const CHAMPS_EXEMPLE_FACTURE = Object.freeze([
  "progbat_bill_id", "code", "yard_id", "quote_id", "chantier_id",
  "type", "date", "montant_ttc", "categorie", "resolution", "motif",
]);
export const CHAMPS_EXEMPLE_REGLEMENT = Object.freeze([
  "progbat_transaction_id", "progbat_bill_id", "facture_id",
  "date", "montant", "canceled", "checked", "categorie", "motif",
]);

// ── Champs COMPARÉS pour décider « inchangée » ──────────────────────────────
// progbat_synced_at n'y est pas : c'est l'heure du diagnostic, pas une donnée.
// created_at / updated_at / id non plus : ils appartiennent à la base.
export const CHAMPS_VOLATILS_FACTURE = Object.freeze(["progbat_synced_at"]);
export const CHAMPS_COMPARES_FACTURE = Object.freeze([
  "source", "chantier_id", "statut", "numero", "date_facture",
  "montant_ttc", "montant_ht", "montant_tva",
  "progbat_bill_id", "progbat_bill_code", "progbat_quote_id", "progbat_yard_id",
  "progbat_business_id", "progbat_type", "progbat_situation_number", "progbat_status",
  "progbat_validated", "progbat_revision_number", "progbat_document_date", "progbat_due_date",
  "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
  "progbat_achievement", "progbat_previous_achievement", "progbat_net_total",
  "progbat_taxes", "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance",
  "progbat_to_be_paid", "progbat_ati_deductions", "progbat_tax_details",
  "progbat_deductions", "progbat_dgd",
  "ligne_id", "ligne_nom", "rapprochement", "raison", "ligne_id_verrouille",
]);

// `annule` EST comparé, et c'est important. Personne ne peut le poser à la
// main : chantier_factures_reglements est en LECTURE SEULE pour le rôle
// `authenticated` (aucune policy d'écriture, cf. sql/202609_facturation_progbat.sql),
// donc `annule` est un état de réconciliation posé par le serveur, jamais une
// décision saisie dans le navigateur. Conséquence directe : si une transaction
// ProGBat redevient active (canceled = 0, checked = 1), une ligne locale restée
// annule = true doit ressortir en MISE À JOUR pour revenir à annule = false —
// l'exclure de la comparaison laisserait un règlement réel éteint en base.
export const CHAMPS_COMPARES_REGLEMENT = Object.freeze([
  "source", "progbat_transaction_id", "progbat_doc_type",
  "date_reglement", "montant", "mode", "progbat_canceled", "annule",
]);

// ─────────────────────────────────────────────────────────────────────────────
// LECTURES SUPABASE — cinq SELECT, colonnes nommées, et rien d'autre
// ─────────────────────────────────────────────────────────────────────────────
// Les colonnes de chantier_factures_client sont celles que la fusion compare :
// ni extraction (sortie brute du modèle), ni document_path, ni commentaire.
export const COLONNES_FACTURE = [
  "id", "chantier_id", "source", "statut", "numero", "date_facture",
  "montant_ht", "montant_tva", "montant_ttc",
  "ligne_id", "ligne_nom", "rapprochement", "raison", "ligne_id_verrouille",
  "ligne_id_modifie_par", "ligne_id_modifie_le",
  "progbat_bill_id", "progbat_bill_code", "progbat_quote_id", "progbat_yard_id",
  "progbat_business_id", "progbat_type", "progbat_situation_number", "progbat_status",
  "progbat_validated", "progbat_revision_number", "progbat_document_date", "progbat_due_date",
  "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
  "progbat_achievement", "progbat_previous_achievement", "progbat_net_total",
  "progbat_taxes", "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance",
  "progbat_to_be_paid", "progbat_ati_deductions", "progbat_tax_details",
  "progbat_deductions", "progbat_dgd", "progbat_synced_at",
].join(",");

export const COLONNES_REGLEMENT =
  "id,facture_id,source,progbat_transaction_id,progbat_doc_type,progbat_canceled,date_reglement,montant,mode,annule";

// QUELS EXPORTS DE DEVIS SERVENT AU REPLI — exactement la règle de
// public.progbat_devis_exportables() (sql/202609_chantier_projets.sql) :
//     statut = 'created' AND progbat_quote_id is not null AND progbat_quote_id > 0
// « created » est le SEUL statut qui atteste qu'un devis existe vraiment dans
// ProGBat. 'uncertain' veut dire « on ne sait pas » (2xx sans id, délai, 5xx),
// 'failed' que rien n'a été créé, 'preparing' et 'creating' qu'on n'en est pas
// là. Une ligne de ces statuts peut malgré tout porter un progbat_quote_id
// résiduel : la retenir ferait rattacher une facture au logement d'un devis qui
// n'existe pas. Le filtre est posé dans la REQUÊTE, ce qui garde la sélection
// minimale (project_id, progbat_quote_id) : le statut sert à filtrer, il ne
// remonte jamais — ni dans le module, ni dans la réponse.
export const STATUT_EXPORT_RETENU = "created";
export const QUOTE_ID_MINIMUM = 1;

/** Table et colonnes de chacune des cinq lectures. Aucune écriture n'existe. */
export const LECTURES = Object.freeze({
  yards: Object.freeze({ table: "chantier_progbat_yards", colonnes: "progbat_yard_id,chantier_id" }),
  exports: Object.freeze({ table: "progbat_quote_exports", colonnes: "project_id,progbat_quote_id" }),
  liaisons: Object.freeze({ table: "chantier_projets", colonnes: "projet_id,chantier_id" }),
  factures: Object.freeze({ table: "chantier_factures_client", colonnes: COLONNES_FACTURE }),
  reglements: Object.freeze({ table: "chantier_factures_reglements", colonnes: COLONNES_REGLEMENT }),
});

/**
 * Le dépôt de LECTURE, construit sur un client de type Supabase.
 *
 * Il vit ici plutôt que dans l'Edge Function pour deux raisons : les colonnes
 * et les filtres sont des RÈGLES (surtout celui des exports de devis), et une
 * fonction pure se teste avec un client doublé — ce que le harnais fait, en
 * observant table, colonnes et filtres réellement demandés.
 *
 * @param client  objet exposant from(table).select(colonnes) puis .eq / .gt /
 *                .not, awaitable en { data, error }. AUCUN verbe d'écriture
 *                n'est appelé : pas d'insert, d'update, d'upsert, de delete ni
 *                de rpc.
 */
export function creerDepotLecture(client) {
  const lire = async (table, colonnes, filtrer = null) => {
    const base = client.from(table).select(colonnes);
    const { data, error } = await (filtrer ? filtrer(base) : base);
    if (error) throw new Error(`${table} : ${error.message}`);
    return data ?? [];
  };
  return {
    chargerYards: () => lire(LECTURES.yards.table, LECTURES.yards.colonnes),
    chargerExports: () => lire(LECTURES.exports.table, LECTURES.exports.colonnes, (q) =>
      q.eq("statut", STATUT_EXPORT_RETENU)
        .not("progbat_quote_id", "is", null)
        .gte("progbat_quote_id", QUOTE_ID_MINIMUM)),
    chargerLiaisons: () => lire(LECTURES.liaisons.table, LECTURES.liaisons.colonnes),
    chargerFactures: () => lire(LECTURES.factures.table, LECTURES.factures.colonnes, (q) =>
      q.eq("source", "progbat")),
    chargerReglements: () => lire(LECTURES.reglements.table, LECTURES.reglements.colonnes, (q) =>
      q.eq("source", "progbat")),
  };
}

// ── Petits formateurs d'AFFICHAGE (aucune règle métier ici) ─────────────────
const texteCourt = (v, max = 80) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};
const jourSeul = (v) => {
  const s = texteCourt(v, 40);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
};

/** Message court, sans séquence pouvant ressembler à un jeton. */
export function nettoyerMotif(raw) {
  return String(typeof raw === "string" ? raw : "")
    .replace(/bearer\s+\S+/gi, "[masqué]")
    .replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Entier STRICT : 3 et "3" oui ; 3.5, true, "" et "trois" non.
 * Sert aux drapeaux ProGBat (canceled / checked), où « à peu près 0 » n'existe
 * pas : tout ce qui n'est pas exactement l'entier attendu est « inconnu ».
 */
export const entierStrict = (v) => {
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

/** Valeurs distinctes observées, avec leurs occurrences. Rien n'est interprété. */
export function valeursDistinctes(valeurs) {
  const map = new Map();
  for (const v of valeurs) {
    const cle = v === null || v === undefined ? "(absent)" : typeof v + ":" + String(v);
    const e = map.get(cle);
    if (e) e.occurrences++;
    else map.set(cle, { valeur: v === undefined ? null : v, occurrences: 1 });
  }
  return [...map.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Égalité TOLÉRANTE au transport : PostgREST rend un numeric en chaîne
 * ("925.15"), la lecture ProGBat un nombre (925.15). Les comparer en strict
 * ferait apparaître des « mises à jour » qui n'en sont pas.
 *   • null et undefined sont la même absence ;
 *   • deux nombres se comparent au demi-centime ;
 *   • objets et tableaux se comparent sérialisés ;
 *   • le reste se compare en texte.
 */
export function memeValeur(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  const sa = String(a).trim();
  const sb = String(b).trim();
  const na = Number(sa);
  const nb = Number(sb);
  if (sa !== "" && sb !== "" && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005;
  return sa === sb;
}

/** Champs qui diffèrent réellement entre la ligne en base et celle proposée. */
export function champsModifies(existante, proposee, champs) {
  const diff = [];
  for (const c of champs) {
    if (!memeValeur(existante?.[c], proposee?.[c])) diff.push(c);
  }
  return diff;
}

// ── Journal : comptages COMPLETS, exemples BORNÉS ───────────────────────────
export function creerJournal(categories, max = MAX_EXEMPLES) {
  const compte = Object.fromEntries(categories.map((c) => [c, 0]));
  const exemples = Object.fromEntries(categories.map((c) => [c, []]));
  return {
    categories: compte,
    exemples,
    ajouter(categorie, exemple) {
      compte[categorie] = (compte[categorie] || 0) + 1;
      const liste = exemples[categorie] || (exemples[categorie] = []);
      // Le comptage continue ; seuls les exemples s'arrêtent à MAX_EXEMPLES.
      if (liste.length < max) liste.push(exemple);
    },
  };
}

// ── Exemples : RECONSTRUITS, jamais filtrés ─────────────────────────────────
export function exempleFacture(brut, { chantier_id = null, categorie, resolution = null, motif = null, montant_ttc } = {}) {
  return {
    progbat_bill_id: idProgbat(brut?.id),
    code: texteCourt(brut?.code, 60),
    yard_id: idProgbat(brut?.yardId),
    quote_id: idProgbat(brut?.quoteId),
    chantier_id: chantier_id ?? null,
    type: texteCourt(brut?.type, 40),
    date: jourSeul(brut?.documentDate),
    montant_ttc: montant_ttc === undefined ? montantOuNull(brut?.toBePaid) : montant_ttc,
    categorie,
    resolution,
    motif: motif === null || motif === undefined ? null : nettoyerMotif(motif),
  };
}

export function exempleReglement({ transaction, progbat_bill_id = null, facture_id = null, montant = null, categorie, motif = null, date } = {}) {
  return {
    progbat_transaction_id: idProgbat(transaction?.id),
    progbat_bill_id: progbat_bill_id ?? null,
    facture_id: facture_id ?? null,
    date: date === undefined ? jourSeul(transaction?.date) : date,
    montant,
    // Bruts, tels que ProGBat les envoie : leur sémantique n'est pas établie,
    // on les RAPPORTE au lieu de les traduire.
    canceled: transaction?.canceled === undefined ? null : transaction.canceled,
    checked: transaction?.checked === undefined ? null : transaction.checked,
    categorie,
    motif: motif === null || motif === undefined ? null : nettoyerMotif(motif),
  };
}

/**
 * Une transaction est ACTIVE si, et seulement si, canceled vaut exactement 0 ET
 * checked exactement 1 — les deux seules valeurs observées sur les 50/50
 * transactions réelles. Tout autre couple est EXCLU des règlements actifs et
 * rapporté tel quel : on ne déduit pas que canceled = 1 signifie « annulé ».
 */
export function transactionActive(transaction) {
  const canceled = entierStrict(transaction?.canceled);
  const checked = entierStrict(transaction?.checked);
  const actif = canceled === 0 && checked === 1;
  return {
    actif,
    canceled,
    checked,
    raison: actif
      ? null
      : `Transaction hors périmètre actif : canceled = ${transaction?.canceled ?? "absent"}, checked = ${transaction?.checked ?? "absent"} (attendu 0 et 1).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LECTURE PAGINÉE D'UNE RESSOURCE ProGBat
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param lirePage async ({ limit, offset, tri }) → { ok: true, data: [...] }
 *                                               |  { ok: false, status, message }
 * @returns { ok, elements: [{ id, brut }], pages, complet, garde_atteinte,
 *            nombre_recu, doublons, tri_applique, tri_refuse, status?, message? }
 *
 * La mécanique d'arrêt (page courte = fin, erreur = arrêt, MAX_PAGES = garde,
 * déduplication par id) est celle de parcourirListe : une seule implémentation
 * pour toutes les listes ProGBat. Ce qui s'ajoute ici : UNE reprise sans tri,
 * et seulement si ProGBat a répondu 400 ou 422.
 */
export async function lireRessourceProgbat(lirePage, { tri = null, pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  let triActif = Boolean(tri);
  let triRefuse = false;
  let recus = 0;

  const appeler = async ({ limit, offset }) => {
    if (triActif) {
      const r = await lirePage({ limit, offset, tri });
      // 401/403/429/500 ne parlent pas de tri : on remonte l'erreur telle quelle.
      if (r?.ok || (r?.status !== 400 && r?.status !== 422)) return r;
      triActif = false;
      triRefuse = true;
    }
    return lirePage({ limit, offset, tri: null });
  };

  // Un élément sans id exploitable est CONSERVÉ (il doit apparaître en
  // « normalisation refusée », pas disparaître) sous une clé unique qui ne peut
  // en écraser aucun autre.
  const projeter = (brut) => {
    recus++;
    const id = idProgbat(brut?.id);
    return { id: id === null ? `sans-id-${recus}` : id, brut };
  };

  const r = await parcourirListe(appeler, { projeter, pageSize, maxPages });
  return {
    ...r,
    nombre_recu: recus,
    doublons: Math.max(0, recus - r.elements.length),
    tri_applique: triActif,
    tri_refuse: triRefuse,
  };
}

/** Bloc de pagination rendu dans la réponse. Aucun corps brut, aucun en-tête. */
export const resumePagination = (r) => ({
  ok: r.ok === true,
  pages: r.pages,
  complet: r.ok === true && r.complet === true,
  garde_atteinte: r.garde_atteinte === true,
  nombre_recu: r.nombre_recu,
  nombre_distinct: r.elements.length,
  doublons: r.doublons,
  tri_applique: r.tri_applique,
  tri_refuse: r.tri_refuse,
  erreur: r.ok === true ? null : nettoyerMotif(r.message),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ANALYSE DES FACTURES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param elements   [{ id, brut }] sortis de lireRessourceProgbat
 * @param contexte   { yards, exports, liaisons } pour progbatLiaison
 * @param existantes lignes chantier_factures_client source='progbat'
 * @param synchroniseLe horodatage injecté (jamais lu d'une horloge ici)
 * @returns { recues, journal, resolution, parBillId }
 *
 * parBillId : bill.id → { facture_id | null, chantier_id, action }. C'est le
 * pont vers les règlements : une transaction peut lettrer une facture DÉJÀ en
 * base (facture_id connu) ou une facture que ce diagnostic propose de créer
 * (facture_id null, action "creation").
 */
export function analyserFactures({ elements = [], contexte = {}, existantes = [], synchroniseLe = null } = {}) {
  const journal = creerJournal(CATEGORIES_FACTURE);
  const resolution = Object.fromEntries(CATEGORIES_RESOLUTION.map((c) => [c, 0]));
  const parBillId = new Map();

  const dejaEnBase = new Map();
  for (const f of existantes || []) {
    const bid = idProgbat(f?.progbat_bill_id);
    if (bid !== null) dejaEnBase.set(bid, f);
  }

  for (const { brut } of elements) {
    // ── a. Brouillon ou facture illisible ────────────────────────────────
    const norm = normaliserFactureProgbat(brut, { synchroniseLe });
    if (!norm.ok) {
      const categorie = norm.motif === REFUS.BROUILLON ? "brouillon_ignore" : "normalisation_refusee";
      journal.ajouter(categorie, exempleFacture(brut, { categorie, motif: norm.raison }));
      continue;
    }

    // ── b. Quel chantier ? (yard prioritaire, devis en repli) ────────────
    const res = resoudreChantierDepuisFacture(brut, contexte);
    let cleResolution;
    if (res.statut === RESOLUTION.RESOLU) {
      cleResolution = res.source === SOURCE.YARD ? "resolution_yard" : "resolution_devis_secours";
    } else if (res.statut === RESOLUTION.YARD_NON_RATTACHE) {
      cleResolution = "yard_non_rattache";
    } else if (res.statut === RESOLUTION.CONFLIT) {
      cleResolution = "conflit";
    } else {
      cleResolution = "devis_non_rattache";
    }
    resolution[cleResolution]++;

    if (!res.resolu) {
      // chantier_id est NOT NULL : sans chantier, rien ne peut être créé.
      journal.ajouter("non_resolue", exempleFacture(brut, {
        categorie: "non_resolue",
        resolution: cleResolution,
        motif: res.raison,
        montant_ttc: norm.ligne.montant_ttc,
      }));
      continue;
    }

    // ── c. Ce que la synchronisation ferait ──────────────────────────────
    const billId = idProgbat(brut?.id);
    const existante = dejaEnBase.get(billId) ?? null;
    const fusion = fusionnerFactureProgbat(existante, { ...norm.ligne, chantier_id: res.chantier_id });
    if (!fusion.ok) {
      journal.ajouter("fusion_refusee", exempleFacture(brut, {
        categorie: "fusion_refusee",
        chantier_id: res.chantier_id,
        resolution: cleResolution,
        motif: fusion.raison,
        montant_ttc: norm.ligne.montant_ttc,
      }));
      continue;
    }

    let categorie;
    let motif;
    if (fusion.creation) {
      categorie = "creation";
      motif = `Facture absente du registre : création proposée sur « ${res.chantier_id} ».`;
    } else {
      const diff = champsModifies(existante, fusion.ligne, CHAMPS_COMPARES_FACTURE);
      if (diff.length === 0) {
        categorie = "inchangee";
        motif = "Déjà à jour (progbat_synced_at ignoré).";
      } else {
        categorie = "mise_a_jour";
        motif = `Champs modifiés : ${diff.join(", ")}.`;
      }
    }

    parBillId.set(billId, {
      facture_id: existante?.id ?? null,
      chantier_id: res.chantier_id,
      action: categorie,
    });
    journal.ajouter(categorie, exempleFacture(brut, {
      categorie,
      chantier_id: res.chantier_id,
      resolution: cleResolution,
      motif,
      montant_ttc: fusion.ligne.montant_ttc,
    }));
  }

  return { recues: elements.length, journal, resolution, parBillId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ANALYSE DES RÈGLEMENTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param elements      [{ id, brut }] transactions
 * @param parBillId     sortie d'analyserFactures
 * @param existants     lignes chantier_factures_reglements source='progbat'
 * @param paginationComplete  true seulement si TOUTES les transactions ont été lues
 * @returns { journal, transactions_recues, transactions_actives, lettrages_retenus,
 *            reglements_locaux, reconciliation_absence_autorisee, valeurs }
 *
 * Une absence (ligne locale qu'aucune transaction active ne porte plus) n'est
 * proposée à l'annulation QUE si la pagination est complète. Sinon « absent »
 * ne veut rien dire, et proposer d'annuler un règlement réel serait le pire
 * résultat possible d'un diagnostic.
 */
export function analyserReglements({ elements = [], parBillId = new Map(), existants = [], paginationComplete = false } = {}) {
  const journal = creerJournal(CATEGORIES_REGLEMENT);
  const canceledObserves = [];
  const checkedObserves = [];
  const docTypesObserves = [];
  let actives = 0;
  let retenus = 0;

  // Paire (transaction, facture) : une transaction peut régler deux factures,
  // et l'unicité en base porte sur la paire.
  const clePaire = (transactionId, factureId) => `${transactionId}|${factureId}`;
  const locauxParPaire = new Map();
  for (const r of existants || []) {
    const tid = idProgbat(r?.progbat_transaction_id);
    if (tid === null || !r?.facture_id) continue;
    locauxParPaire.set(clePaire(tid, String(r.facture_id)), r);
  }
  const pairesVues = new Set();

  for (const { brut } of elements) {
    canceledObserves.push(brut?.canceled ?? null);
    checkedObserves.push(brut?.checked ?? null);

    const etat = transactionActive(brut);
    if (!etat.actif) {
      journal.ajouter("transaction_inactive_ou_inconnue", exempleReglement({
        transaction: brut, categorie: "transaction_inactive_ou_inconnue", motif: etat.raison,
      }));
      continue;
    }
    actives++;

    const lettrages = Array.isArray(brut?.checking) ? brut.checking : [];
    for (const checking of lettrages) {
      docTypesObserves.push(checking?.docType ?? null);
      const norm = normaliserReglementProgbat(brut, checking);
      if (!norm.ok) {
        journal.ajouter("lettrage_ignore", exempleReglement({
          transaction: brut,
          progbat_bill_id: norm.motif === REFUS.DOC_TYPE ? null : idProgbat(checking?.docId),
          montant: montantOuNull(checking?.amount),
          categorie: "lettrage_ignore",
          motif: norm.raison,
        }));
        continue;
      }
      retenus++;

      const billId = norm.progbat_bill_id;
      const cible = parBillId.get(billId) ?? null;
      const commun = {
        transaction: brut,
        progbat_bill_id: billId,
        montant: norm.ligne.montant,
        date: norm.ligne.date_reglement,
      };

      if (!cible) {
        journal.ajouter("facture_introuvable", exempleReglement({
          ...commun, categorie: "facture_introuvable",
          motif: `Aucune facture retenue ne porte le bill.id n° ${billId} : règlement non rattachable.`,
        }));
        continue;
      }

      if (cible.facture_id === null) {
        journal.ajouter("creation", exempleReglement({
          ...commun, categorie: "creation",
          motif: `Règlement à créer sur la facture n° ${billId}, elle-même proposée à la création.`,
        }));
        continue;
      }

      const cle = clePaire(norm.ligne.progbat_transaction_id, String(cible.facture_id));
      pairesVues.add(cle);
      const local = locauxParPaire.get(cle) ?? null;
      if (!local) {
        journal.ajouter("creation", exempleReglement({
          ...commun, facture_id: cible.facture_id, categorie: "creation",
          motif: "Règlement absent du registre : création proposée.",
        }));
        continue;
      }
      const diff = champsModifies(local, norm.ligne, CHAMPS_COMPARES_REGLEMENT);
      journal.ajouter(diff.length === 0 ? "inchange" : "mise_a_jour", exempleReglement({
        ...commun, facture_id: cible.facture_id,
        categorie: diff.length === 0 ? "inchange" : "mise_a_jour",
        motif: diff.length === 0 ? "Déjà à jour." : `Champs modifiés : ${diff.join(", ")}.`,
      }));
    }
  }

  // ── Absences : uniquement sur une lecture COMPLÈTE ─────────────────────
  // Une ligne locale que plus aucune transaction active ne porte relève de deux
  // cas, et les SÉPARER est ce qui fait converger le diagnostic :
  //   • pas encore annulée  → annulation_proposee, une vraie écriture à venir ;
  //   • déjà annule = true  → deja_annule, RIEN à écrire : la ligne est dans
  //     l'état attendu. Les confondre ferait reproposer indéfiniment une
  //     annulation déjà faite, et le diagnostic n'atteindrait jamais « rien à
  //     faire » — exactement le travers évité côté factures en ignorant
  //     progbat_synced_at.
  // Une pagination incomplète ne produit NI l'une NI l'autre : « absent » n'y
  // veut rien dire.
  if (paginationComplete) {
    for (const [cle, local] of locauxParPaire) {
      if (pairesVues.has(cle)) continue;
      const dejaAnnule = local.annule === true;
      journal.ajouter(dejaAnnule ? "deja_annule" : "annulation_proposee", exempleReglement({
        transaction: { id: local.progbat_transaction_id },
        progbat_bill_id: null,
        facture_id: local.facture_id ?? null,
        montant: montantOuNull(local.montant),
        date: local.date_reglement ?? null,
        categorie: dejaAnnule ? "deja_annule" : "annulation_proposee",
        motif: dejaAnnule
          ? "Règlement déjà annulé en base et toujours absent des transactions actives de ProGBat : rien à faire."
          : "Règlement présent en base mais absent des transactions actives de ProGBat : annulation à confirmer (rien n'est modifié ici).",
      }));
    }
  }

  return {
    journal,
    transactions_recues: elements.length,
    transactions_actives: actives,
    lettrages_retenus: retenus,
    reglements_locaux: locauxParPaire.size,
    reconciliation_absence_autorisee: paginationComplete === true,
    valeurs: {
      transactions_canceled: valeursDistinctes(canceledObserves),
      transactions_checked: valeursDistinctes(checkedObserves),
      checking_doc_type: valeursDistinctes(docTypesObserves),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DIAGNOSTIC COMPLET
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Interface `progbat` (un seul verbe, GET) :
 *   lirePage({ ressource, limit, offset, tri })
 *     → { ok: true, data: [...] } | { ok: false, status, message }
 *
 * Interface `depot` (toutes async, toutes en SELECT — AUCUNE écriture), telle
 * que creerDepotLecture() la construit :
 *   chargerYards()      → [{ progbat_yard_id, chantier_id }]
 *   chargerExports()    → [{ project_id, progbat_quote_id }] — devis RÉELLEMENT
 *                         créés uniquement (statut 'created', identifiant > 0)
 *   chargerLiaisons()   → [{ projet_id, chantier_id }]
 *   chargerFactures()   → lignes chantier_factures_client source='progbat'
 *   chargerReglements() → lignes chantier_factures_reglements source='progbat'
 * Chacune renvoie un tableau, ou lève : l'appelant traduit l'exception en 500.
 *
 * @returns { ok: true, rapport } | { ok: false, status, erreur }
 */
// Les casts ci-dessous ne changent RIEN à l'exécution : ils décrivent les deux
// interfaces injectées et l'horodatage (une chaîne ISO côté Edge Function) pour
// que `deno check` accepte l'appel depuis index.ts.
export async function executerDryRun({
  depot = /** @type {any} */ (null),
  progbat = /** @type {any} */ (null),
  maintenant = /** @type {string | null} */ (null),
  debutMs = 0,
  finMs = 0,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
} = {}) {
  // ── a. Factures : sans liste complète, pas de diagnostic ────────────────
  const factures = await lireRessourceProgbat(
    ({ limit, offset, tri }) => progbat.lirePage({ ressource: "bills", limit, offset, tri }),
    { tri: TRI_FACTURES, pageSize, maxPages },
  );
  if (!factures.ok) {
    return { ok: false, status: factures.status || 0, erreur: nettoyerMotif(factures.message) };
  }
  if (factures.garde_atteinte) {
    return {
      ok: false,
      status: 0,
      erreur: `Liste des factures ProGBat trop longue (garde de ${maxPages} pages atteinte) : lecture interrompue, aucun diagnostic ne peut être présenté comme complet.`,
    };
  }

  // ── b. Transactions : une lecture partielle est DITE, pas cachée ────────
  const transactions = await lireRessourceProgbat(
    ({ limit, offset, tri }) => progbat.lirePage({ ressource: "transactions", limit, offset, tri }),
    { tri: TRI_TRANSACTIONS, pageSize, maxPages },
  );
  const transactionsCompletes = transactions.ok === true && transactions.complet === true && transactions.garde_atteinte !== true;

  // ── c. Base : cinq lectures, rien d'autre ───────────────────────────────
  const [yards, exports, liaisons, facturesLocales, reglementsLocaux] = await Promise.all([
    depot.chargerYards(),
    depot.chargerExports(),
    depot.chargerLiaisons(),
    depot.chargerFactures(),
    depot.chargerReglements(),
  ]);

  // ── d. Analyse ──────────────────────────────────────────────────────────
  const anaF = analyserFactures({
    elements: factures.elements,
    contexte: { yards, exports, liaisons },
    existantes: facturesLocales,
    synchroniseLe: maintenant,
  });
  const anaR = analyserReglements({
    elements: transactions.elements,
    parBillId: anaF.parBillId,
    existants: reglementsLocaux,
    paginationComplete: transactionsCompletes,
  });

  return {
    ok: true,
    rapport: {
      dry_run: true,
      // Ce diagnostic n'écrit RIEN. Le dire dans la réponse plutôt que dans un
      // commentaire : c'est vérifiable par l'appelant et par les tests.
      ecritures: { supabase: 0, progbat: 0 },
      genere_le: maintenant,
      duree_ms: Math.max(0, finMs - debutMs),
      pagination: {
        bills: resumePagination(factures),
        transactions: resumePagination(transactions),
      },
      valeurs_distinctes: {
        factures_validated: valeursDistinctes(factures.elements.map((e) => e.brut?.validated ?? null)),
        ...anaR.valeurs,
      },
      reconciliation_absence_autorisee: anaR.reconciliation_absence_autorisee,
      factures: {
        recues: anaF.recues,
        deja_en_base: (facturesLocales || []).length,
        categories: anaF.journal.categories,
        resolution: anaF.resolution,
        exemples: anaF.journal.exemples,
      },
      reglements: {
        transactions_recues: anaR.transactions_recues,
        transactions_actives: anaR.transactions_actives,
        lettrages_retenus: anaR.lettrages_retenus,
        reglements_locaux: anaR.reglements_locaux,
        categories: anaR.journal.categories,
        exemples: anaR.journal.exemples,
      },
    },
  };
}
