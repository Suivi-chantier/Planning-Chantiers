// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatQuoteServeur.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── PROGBAT — CRÉATION D'UN DEVIS BROUILLON : LOGIQUE SERVEUR PURE ──────────
// Cœur de l'Edge Function `progbat-quote` (actions prepare / create / status),
// écrit SANS dépendance Deno ni Supabase : tout accès externe est injecté
// (`depot` = base Supabase, `progbat` = API ProGBat). Il est donc testé dans
// Node avec des doublures (scripts/verif-progbat-quote-serveur.mjs) sans jamais
// toucher l'API réelle. Copié dans supabase/functions/progbat-quote/lib/ par
// scripts/sync-progbat-edge-lib.mjs (ne pas éditer la copie).
//
// Principe de sécurité : le navigateur n'envoie que { action, projectId,
// expectedPayloadHash, confirmed }. Le serveur recharge le projet et ses lignes,
// RECONSTRUIT le payload avec le générateur partagé (progbatQuotePayload.mjs),
// relit les taux de TVA ProGBat, refait tous les contrôles, compare le hash à
// celui de l'aperçu confirmé, et ne crée le brouillon que si tout est valide.
//
// Anti-doublon : une ligne progbat_quote_exports est RÉSERVÉE (statut creating)
// avant le POST ; l'index unique partiel (project_id, statut ∈ creating/created/
// uncertain) refuse toute seconde réservation concurrente. Après le POST :
//   • 2xx avec `id`      → created (+ profero_projets.progbat_devis_id)
//   • 2xx sans `id`      → uncertain (le devis existe peut-être)
//   • délai / réseau     → uncertain (on ne sait pas si ProGBat a créé le devis)
//   • 4xx / 5xx          → failed (la réservation n'est plus bloquante)
//   • 2xx mais enregistrement local en échec → uncertain, jamais de relance auto.
//
// Interface `depot` (toutes les fonctions sont async) :
//   chargerProjet(projectId) → ligne profero_projets | null
//   chargerLignes(projectId) → lignes profero_ouvrages_selectionnes
//   chargerLotsOrdre()       → libellés de lots dans l'ordre du chiffrage
//   dernierExport(projectId) → dernière ligne progbat_quote_exports | null
//   reserverExport(ligne)    → { ok: true, id } | { ok: false, conflit: true } | { ok: false, erreur }
//   majExport(id, patch)     → { ok: true } | { ok: false, erreur }
//   majProjetDevis(projectId, { progbat_devis_id, progbat_sync_at }) → { ok } | { ok: false, erreur }
// Interface `progbat` :
//   lireTaux()          → { ok: true, taux: [{ id, rate, label, saleDefault }] } | { ok: false, status, message }
//   creerDevis(payload) → { ok: true, status, data } | { ok: false, status, message, timeout?, reseau? }

import { construirePayloadDevisProGBat, hacherPayload } from "./progbatQuotePayload.mjs";

export const ACTIONS = Object.freeze(["prepare", "create", "status"]);
export const STATUTS_EXPORT = Object.freeze(["preparing", "creating", "created", "failed", "uncertain"]);
/** Statuts qui interdisent toute nouvelle création pour le logement. */
export const STATUTS_BLOQUANTS = Object.freeze(["creating", "created", "uncertain"]);
/** Une réservation `creating` plus ancienne que ce délai est considérée incertaine (fonction interrompue). */
export const DELAI_CREATING_INCERTAIN_MS = 10 * 60 * 1000;
export const ENDPOINT_POST_DEVIS = "POST /v2/company/quotes";

// Libellés des lots par défaut (src/constants.js → LOTS_DEFAUT) : repli quand
// planning_config.lots_travaux est vide, pour reproduire l'ordre de la page.
export const LOTS_DEFAUT_LABELS = Object.freeze([
  "Démolition", "Maçonnerie", "Électricité", "Plomberie sanitaire",
  "Murs cloison doublages", "Menuiserie", "Ouvertures", "Finitions générales",
]);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => String(v ?? "").trim();

/** Nettoyage des messages renvoyés : court, sans séquence ressemblant à un jeton. */
export function nettoyerMessage(raw) {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim();
  return s.slice(0, 200);
}

/**
 * Ordre des lots tel que la page Chiffrage le calcule :
 * lots de travaux (planning_config.lots_travaux ou défaut) puis anciennes catégories.
 */
export function composerLotsOrdre(lotsTravauxItems, categoriesNoms) {
  const items = Array.isArray(lotsTravauxItems) && lotsTravauxItems.length > 0 ? lotsTravauxItems : null;
  const lots = items
    ? items.map((l, i) => str(l?.label) || `Lot ${i + 1}`)
    : [...LOTS_DEFAUT_LABELS];
  const cats = (Array.isArray(categoriesNoms) ? categoriesNoms : []).map(str).filter(Boolean);
  return [...lots, ...cats];
}

/** Contrôle de l'appelant : { http, error } si refusé, null si autorisé. */
export function controlerAppelant(appelant) {
  if (!appelant || !str(appelant.email)) return { http: 401, body: { ok: false, code: "non_authentifie", error: "Non authentifié." } };
  if (appelant.actif === false || appelant.role === "ouvrier" || !appelant.role) {
    return { http: 403, body: { ok: false, code: "acces_refuse", error: "Création de devis réservée aux utilisateurs du bureau." } };
  }
  return null;
}

/** Résumé NON sensible d'une ligne progbat_quote_exports. */
export function resumerExport(e, maintenant = new Date()) {
  if (!e) return null;
  let statut = e.statut;
  let incertainCarBloque = false;
  if (statut === "creating") {
    const debut = e.started_at ? new Date(e.started_at).getTime() : NaN;
    if (Number.isFinite(debut) && maintenant.getTime() - debut > DELAI_CREATING_INCERTAIN_MS) { statut = "uncertain"; incertainCarBloque = true; }
  }
  return {
    id: e.id ?? null,
    statut,
    statut_enregistre: e.statut,
    reservation_figee: incertainCarBloque,
    progbat_quote_id: e.progbat_quote_id ?? null,
    progbat_quote_code: e.progbat_quote_code ?? null,
    payload_hash: e.payload_hash ?? null,
    http_status: e.http_status ?? null,
    message: e.error_message ? nettoyerMessage(e.error_message) : null,
    started_at: e.started_at ?? null,
    finished_at: e.finished_at ?? null,
    created_by_email: e.created_by_email ?? null,
  };
}

/**
 * Devis déjà connu pour le logement (colonne projet ou export created/uncertain)
 * et motif éventuel interdisant une nouvelle création.
 */
export function evaluerBlocageCreation(projet, exportResume) {
  const devisProjet = str(projet?.progbat_devis_id);
  if (exportResume?.statut === "uncertain") {
    return { bloque: true, code: "etat_incertain", message: "Une tentative précédente est dans un état incertain : vérifier manuellement dans ProGBat si le devis existe avant toute nouvelle création." };
  }
  if (exportResume?.statut === "creating") {
    return { bloque: true, code: "creation_en_cours", message: "Une création est déjà en cours pour ce logement." };
  }
  if (exportResume?.statut === "created" || devisProjet) {
    return { bloque: true, code: "devis_deja_cree", message: `Un brouillon ProGBat existe déjà pour ce logement (id ${exportResume?.progbat_quote_id ?? devisProjet}). La mise à jour d'un brouillon n'est pas encore disponible.` };
  }
  return { bloque: false, code: null, message: null };
}

// ─── Reconstruction serveur ──────────────────────────────────────────────────
/**
 * Recharge tout depuis le dépôt, relit les taux ProGBat et reconstruit le
 * payload + hash avec le générateur partagé. Aucune écriture.
 */
export async function reconstruireDevis({ projectId, depot, progbat, maintenant = new Date() }) {
  const projet = await depot.chargerProjet(projectId);
  if (!projet) return { http: 404, body: { ok: false, code: "projet_introuvable", error: "Projet introuvable." } };
  const [lignes, lotsOrdre, dernier] = await Promise.all([
    depot.chargerLignes(projectId),
    depot.chargerLotsOrdre(),
    depot.dernierExport(projectId),
  ]);
  const taux = await progbat.lireTaux();
  if (!taux.ok) {
    return { http: 200, body: { ok: false, code: "taux_tva_indisponibles", etape: "taux", progbat_status: taux.status ?? null, error: nettoyerMessage(taux.message) || "Lecture des taux de TVA ProGBat impossible.", aucune_ecriture: true } };
  }
  const resultat = construirePayloadDevisProGBat({ projet, lignes: lignes || [], lotsOrdre, taxes: taux.taux, aujourdHui: maintenant });
  const payloadHash = await hacherPayload(resultat.payload);
  const exportResume = resumerExport(dernier, maintenant);
  const blocage = evaluerBlocageCreation(projet, exportResume);
  const hashEnvoye = exportResume?.statut === "created" ? exportResume.payload_hash : null;
  return {
    http: 200,
    projet, lignes, lotsOrdre, resultat, payloadHash, exportResume, blocage,
    base: {
      projectId,
      valide: resultat.valide,
      apercu: resultat.apercu,
      erreurs: resultat.erreurs,
      avertissements: resultat.avertissements,
      totaux: resultat.totaux,
      compteurs: resultat.compteurs,
      entete: resultat.entete,
      payloadHash,
      taux: taux.taux.map((t) => ({ id: t.id, rate: t.rate, label: t.label ?? "", saleDefault: t.saleDefault === true })),
      export_precedent: exportResume,
      devis_existant: (exportResume?.statut === "created" || str(projet.progbat_devis_id))
        ? { progbat_quote_id: exportResume?.progbat_quote_id ?? str(projet.progbat_devis_id) ?? null, progbat_quote_code: exportResume?.progbat_quote_code ?? null, cree_le: exportResume?.finished_at ?? projet.progbat_sync_at ?? null, payload_hash: hashEnvoye }
        : null,
      chiffrage_modifie_depuis: hashEnvoye ? hashEnvoye !== payloadHash : false,
      peut_creer: resultat.valide && !blocage.bloque,
      motif_blocage: blocage.bloque ? { code: blocage.code, message: blocage.message } : null,
    },
  };
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────
/**
 * Traite une requête { action, projectId, expectedPayloadHash, confirmed }.
 * @returns {Promise<{ http: number, body: object, journal?: object }>}
 *   `journal` : champs autorisés pour les logs (jamais de payload ni de secret).
 */
export async function traiterRequeteDevis(requete = {}, { appelant, depot, progbat, maintenant = new Date() } = {}) {
  const refus = controlerAppelant(appelant);
  if (refus) return refus;

  const action = str(requete.action);
  if (!ACTIONS.includes(action)) return { http: 400, body: { ok: false, code: "action_invalide", error: "Action inconnue (prepare, create ou status attendu)." } };
  const projectId = str(requete.projectId);
  if (!RE_UUID.test(projectId)) return { http: 400, body: { ok: false, code: "project_id_invalide", error: "projectId manquant ou invalide." } };

  // ── status : aucune lecture ProGBat, aucune écriture ────────────────────
  if (action === "status") {
    const projet = await depot.chargerProjet(projectId);
    if (!projet) return { http: 404, body: { ok: false, code: "projet_introuvable", error: "Projet introuvable." } };
    const exportResume = resumerExport(await depot.dernierExport(projectId), maintenant);
    const blocage = evaluerBlocageCreation(projet, exportResume);
    return {
      http: 200,
      body: {
        ok: true, action, aucune_ecriture: true, projectId,
        export_precedent: exportResume,
        devis_existant: (exportResume?.statut === "created" || str(projet.progbat_devis_id))
          ? { progbat_quote_id: exportResume?.progbat_quote_id ?? str(projet.progbat_devis_id), progbat_quote_code: exportResume?.progbat_quote_code ?? null, cree_le: exportResume?.finished_at ?? projet.progbat_sync_at ?? null, payload_hash: exportResume?.payload_hash ?? null }
          : null,
        motif_blocage: blocage.bloque ? { code: blocage.code, message: blocage.message } : null,
      },
      journal: { action, projectId, statut: exportResume?.statut ?? "aucun" },
    };
  }

  // ── prepare / create : reconstruction complète côté serveur ─────────────
  const rec = await reconstruireDevis({ projectId, depot, progbat, maintenant });
  if (!rec.base) return rec;   // 404 ou taux indisponibles

  if (action === "prepare") {
    return { http: 200, body: { ok: true, action, aucune_ecriture: true, ...rec.base }, journal: { action, projectId, valide: rec.resultat.valide, nb_erreurs: rec.resultat.erreurs.length } };
  }

  // ── create ──────────────────────────────────────────────────────────────
  const refuser = (http, code, error, extra = {}) => ({
    http, body: { ok: false, action, code, error, aucune_ecriture: true, payloadHash: rec.payloadHash, ...extra },
    journal: { action, projectId, refus: code },
  });
  if (requete.confirmed !== true) return refuser(400, "confirmation_requise", "Confirmation explicite requise (confirmed: true).");
  if (rec.blocage.bloque) return refuser(409, rec.blocage.code, rec.blocage.message, { export_precedent: rec.exportResume, devis_existant: rec.base.devis_existant });
  if (!rec.resultat.valide) return refuser(409, "payload_invalide", `Payload invalide : ${rec.resultat.erreurs.length} point(s) bloquant(s).`, { erreurs: rec.resultat.erreurs, avertissements: rec.resultat.avertissements });
  if (str(requete.expectedPayloadHash) !== rec.payloadHash) {
    return refuser(409, "hash_different", "Le projet ou ses lignes ont changé depuis l'aperçu : relancer l'aperçu puis confirmer à nouveau.");
  }

  // Réservation AVANT l'appel ProGBat : l'index unique refuse une seconde réservation.
  const reservation = await depot.reserverExport({
    project_id: projectId,
    payload_hash: rec.payloadHash,
    statut: "creating",
    created_by: appelant.id ?? null,
    created_by_email: str(appelant.email) || null,
    started_at: maintenant.toISOString(),
  });
  if (!reservation.ok) {
    if (reservation.conflit) return refuser(409, "creation_en_cours", "Une création est déjà en cours ou déjà réalisée pour ce logement.");
    return { http: 500, body: { ok: false, action, code: "reservation_impossible", error: "Réservation de la création impossible : " + (nettoyerMessage(reservation.erreur) || "erreur base de données"), aucune_ecriture: true }, journal: { action, projectId, refus: "reservation_impossible" } };
  }
  const exportId = reservation.id;
  const t0 = Date.now();
  const finir = async (patch) => {
    const r = await depot.majExport(exportId, { ...patch, finished_at: new Date().toISOString() });
    return r?.ok !== false;
  };

  // ── POST officiel ───────────────────────────────────────────────────────
  const rep = await progbat.creerDevis(rec.resultat.payload);
  const duree_ms = Date.now() - t0;

  if (!rep.ok) {
    if (rep.timeout || rep.reseau) {
      const message = nettoyerMessage(rep.message) || "Réponse ProGBat inconnue (délai dépassé ou réseau).";
      await finir({ statut: "uncertain", http_status: rep.status ?? 0, error_message: message });
      return {
        http: 200,
        body: { ok: false, action, statut: "uncertain", code: "etat_incertain", error: `${message} Impossible de savoir si le brouillon a été créé : vérifier manuellement dans ProGBat avant toute nouvelle tentative.`, export_id: exportId, payloadHash: rec.payloadHash, verification_manuelle: true },
        journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status ?? 0, statut: "uncertain", duree_ms },
      };
    }
    const message = nettoyerMessage(rep.message) || `ProGBat a refusé la création (HTTP ${rep.status}).`;
    await finir({ statut: "failed", http_status: rep.status ?? null, error_message: message });
    return {
      http: 200,
      body: { ok: false, action, statut: "failed", code: "progbat_refus", progbat_status: rep.status ?? null, error: message, export_id: exportId, payloadHash: rec.payloadHash },
      journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status ?? null, statut: "failed", duree_ms },
    };
  }

  // Succès HTTP : format officiel QuoteResponse { id (integer), code (string), … }
  const data = rep.data && typeof rep.data === "object" ? rep.data : {};
  const quoteId = Number.isInteger(data.id) ? data.id : (typeof data.id === "string" && /^\d+$/.test(data.id) ? Number(data.id) : null);
  const quoteCode = typeof data.code === "string" ? data.code.slice(0, 80) : null;
  if (quoteId == null) {
    await finir({ statut: "uncertain", http_status: rep.status, error_message: "Réponse ProGBat sans identifiant de devis" });
    return {
      http: 200,
      body: { ok: false, action, statut: "uncertain", code: "identifiant_absent", error: "ProGBat a répondu sans identifiant de devis : le brouillon a peut-être été créé. Vérifier manuellement dans ProGBat avant toute nouvelle tentative.", export_id: exportId, progbat_status: rep.status, payloadHash: rec.payloadHash, verification_manuelle: true },
      journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status, statut: "uncertain", duree_ms },
    };
  }

  const okExport = await finir({ statut: "created", http_status: rep.status, progbat_quote_id: quoteId, progbat_quote_code: quoteCode, error_message: null });
  const majProjet = await depot.majProjetDevis(projectId, { progbat_devis_id: String(quoteId), progbat_sync_at: new Date().toISOString() });
  if (!okExport || majProjet?.ok === false) {
    // Le devis EXISTE dans ProGBat (id connu) mais le suivi local est incomplet : jamais de relance automatique.
    await depot.majExport(exportId, { statut: "uncertain", progbat_quote_id: quoteId, progbat_quote_code: quoteCode, http_status: rep.status, error_message: `Brouillon créé (id ${quoteId}) mais enregistrement local incomplet` }).catch?.(() => null);
    return {
      http: 200,
      body: { ok: false, action, statut: "uncertain", code: "enregistrement_local_incomplet", progbat_quote_id: quoteId, progbat_quote_code: quoteCode, error: `Le brouillon ProGBat a été créé (id ${quoteId}) mais son enregistrement dans Profero a échoué : vérifier ProGBat et signaler l'incident. Aucune nouvelle création ne sera tentée automatiquement.`, export_id: exportId, payloadHash: rec.payloadHash, verification_manuelle: true },
      journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status, progbat_quote_id: quoteId, statut: "uncertain", duree_ms },
    };
  }

  return {
    http: 200,
    body: {
      ok: true, action, statut: "created", message: "Brouillon créé dans ProGBat.",
      progbat_quote_id: quoteId, progbat_quote_code: quoteCode, progbat_status: rep.status,
      payloadHash: rec.payloadHash, export_id: exportId, compteurs: rec.resultat.compteurs, totaux: rec.resultat.totaux,
    },
    journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status, progbat_quote_id: quoteId, statut: "created", duree_ms },
  };
}
