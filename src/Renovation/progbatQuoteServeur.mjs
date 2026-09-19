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
//   • 2xx avec `id`      → created (+ profero_projets.progbat_devis_id), puis GET de vérification facultatif
//   • 2xx sans `id`      → uncertain (le devis existe peut-être)
//   • délai / réseau / 5xx → uncertain (le POST est parti : on ne sait pas si ProGBat a créé le devis)
//   • 400 / 401 / 403 / 404 / 409 / 422 / 429 → failed (refus certain, la réservation n'est plus bloquante)
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
//   chargerLiaisons(bibliothequeIds) → [{ id, progbat_id }] lignes ACTUELLES de bibliotheque_ratios
//                              (source de vérité de l'elementId : jamais le snapshot, jamais le navigateur)
// Interface `progbat` :
//   verifierStructures(ids)   → { ok: true, existants: number[], introuvables: number[] } | { ok: false, status, message }
//                              (GET /company/library/structures/{id} par identifiant : 200 = existe, 404 = supprimée)
//   jetonPresent        → false si PROGBAT_PRIVATE_ACCESS_TOKEN manque (aucune opération n'est alors tentée)
//   lireTaux()          → { ok: true, taux: [{ id, rate, label, saleDefault }] } | { ok: false, status, message }
//   creerDevis(payload) → { ok: true, status, data } | { ok: false, status, message, timeout?, reseau? }
//   lireDevis(quoteId)  → (facultatif) GET /company/quotes/{quoteId} après un POST réussi : { ok, status, data } —
//                         un échec de cette lecture ne provoque JAMAIS un second POST.
//
// Clé du logement : dans Profero un projet (profero_projets) = un logement
// (logement_reference / type_logement ; un ancien projet multi-logements est
// refusé par le générateur). La clé d'unicité est donc project_id ; la référence
// du logement reçue du navigateur (`logementReference`) est comparée à celle du
// projet rechargé et figée dans la réservation pour l'audit.

import { construirePayloadDevisProGBat, hacherPayload } from "./progbatQuotePayload.mjs";

export const ACTIONS = Object.freeze(["prepare", "create", "status", "verifier_existant"]);
// « absent » : ProGBat a confirmé par un 404 que le devis n'existe plus (supprimé
// chez eux). Hors de l'index d'unicité : une nouvelle création redevient possible.
export const STATUTS_EXPORT = Object.freeze(["preparing", "creating", "created", "failed", "uncertain", "absent"]);
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
  s = s.replace(/bearer\s+\S+/gi, "[masqué]").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim();
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

// ─── Liaisons Profero → ProGBat (côté serveur) ───────────────────────────────
const entierPositif = (v) => {
  const n = Number.isInteger(v) ? v : (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null);
  return n != null && n > 0 ? n : null;
};

/**
 * Recharge les liaisons ACTUELLES des ouvrages Profero du devis et vérifie par
 * l'API ProGBat que chaque structure existe encore. Rien n'est écrit.
 * @returns {{ ok: true, liaisons: object, ids: number[] } | { ok: false, body }}
 */
export async function resoudreLiaisons(lignes, { depot, progbat }) {
  const bibIds = [...new Set((lignes || []).map((l) => (l?.bibliotheque_id != null ? String(l.bibliotheque_id) : "")).filter(Boolean))];
  const rows = bibIds.length ? await depot.chargerLiaisons(bibIds) : [];
  const liaisons = {};
  bibIds.forEach((id) => { liaisons[id] = { progbat_id: null, existe: null }; });
  (rows || []).forEach((r) => {
    if (r?.id == null) return;
    const pid = entierPositif(r.progbat_id);
    liaisons[String(r.id)] = { progbat_id: pid ?? (str(r.progbat_id) || null), existe: null };
  });
  const ids = [...new Set(Object.values(liaisons).map((l) => entierPositif(l.progbat_id)).filter((n) => n != null))];
  if (ids.length && typeof progbat.verifierStructures === "function") {
    const v = await progbat.verifierStructures(ids);
    if (!v.ok) {
      return { ok: false, body: { ok: false, code: "structures_non_verifiables", etape: "structures", progbat_status: v.status ?? null, error: (nettoyerMessage(v.message) || "Vérification des ouvrages ProGBat impossible.") + " Aucune création tant que les liaisons ne sont pas confirmées.", aucune_ecriture: true } };
    }
    const existants = new Set((v.existants || []).map(Number));
    Object.values(liaisons).forEach((l) => { const n = entierPositif(l.progbat_id); if (n != null) l.existe = existants.has(n); });
  }
  return { ok: true, liaisons, ids };
}

// ─── Reconstruction serveur ──────────────────────────────────────────────────
/**
 * Recharge tout depuis le dépôt, relit les taux ProGBat, résout et vérifie les
 * liaisons (elementId) et reconstruit le payload + hash avec le générateur
 * partagé. Aucune écriture.
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
  const liaisonsRes = await resoudreLiaisons(lignes, { depot, progbat });
  if (!liaisonsRes.ok) return { http: 200, body: liaisonsRes.body };
  const resultat = construirePayloadDevisProGBat({ projet, lignes: lignes || [], lotsOrdre, taxes: taux.taux, liaisons: liaisonsRes.liaisons, aujourdHui: maintenant });
  const payloadHash = await hacherPayload(resultat.payload);
  const exportResume = resumerExport(dernier, maintenant);
  const blocage = evaluerBlocageCreation(projet, exportResume);
  const hashEnvoye = exportResume?.statut === "created" ? exportResume.payload_hash : null;
  return {
    http: 200,
    projet, lignes, lotsOrdre, resultat, payloadHash, exportResume, blocage,
    base: {
      projectId,
      logement_reference: str(projet.logement_reference) || null,
      valide: resultat.valide,
      apercu: resultat.apercu,
      erreurs: resultat.erreurs,
      avertissements: resultat.avertissements,
      totaux: resultat.totaux,
      compteurs: resultat.compteurs,
      entete: resultat.entete,
      liaisons: resultat.liaisons,
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
  if (progbat?.jetonPresent === false) {
    return { http: 500, body: { ok: false, code: "secret_absent", error: "Secret ProGBat non configuré côté serveur : aucune opération n'est possible." }, journal: { action: str(requete.action), refus: "secret_absent" } };
  }

  const action = str(requete.action);
  const logementReference = str(requete.logementReference);
  if (!ACTIONS.includes(action)) return { http: 400, body: { ok: false, code: "action_invalide", error: "Action inconnue (prepare, create, status ou verifier_existant attendu)." } };
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

  // ── verifier_existant ───────────────────────────────────────────────────
  // Le brouillon a-t-il été supprimé dans ProGBat ? Le verrou anti-doublon
  // n'est levé que sur un 404 de ProGBat : jamais sur la seule affirmation de
  // l'utilisateur, et jamais sur une erreur de lecture (réseau, 401, 5xx…).
  if (action === "verifier_existant") {
    const projet = await depot.chargerProjet(projectId);
    if (!projet) return { http: 404, body: { ok: false, code: "projet_introuvable", error: "Projet introuvable." } };
    const brut = await depot.dernierExport(projectId);
    const exportResume = resumerExport(brut, maintenant);
    const quoteId = Number(exportResume?.progbat_quote_id ?? str(projet.progbat_devis_id));
    if (!Number.isInteger(quoteId) || quoteId <= 0) {
      return {
        http: 200,
        body: { ok: true, action, libere: false, code: "aucun_devis", message: "Aucun brouillon ProGBat n'est enregistré pour ce logement.", aucune_ecriture: true },
        journal: { action, projectId, resultat: "aucun_devis" },
      };
    }
    if (typeof progbat?.lireDevis !== "function") {
      return { http: 200, body: { ok: false, action, code: "lecture_indisponible", error: "Lecture des devis ProGBat indisponible.", aucune_ecriture: true } };
    }
    const lu = await progbat.lireDevis(quoteId);
    if (lu?.ok) {
      return {
        http: 200,
        body: { ok: true, action, libere: false, existe: true, progbat_quote_id: quoteId, message: `Le brouillon ${quoteId} existe toujours dans ProGBat : le verrou est maintenu.`, aucune_ecriture: true },
        journal: { action, projectId, quoteId, resultat: "existe" },
      };
    }
    if (Number(lu?.status) !== 404) {
      return {
        http: 200,
        body: { ok: false, action, code: "verification_impossible", progbat_status: lu?.status ?? 0, error: `Impossible de vérifier le brouillon ${quoteId} dans ProGBat${lu?.message ? ` : ${nettoyerMessage(lu.message)}` : ""}. Rien n'a été modifié.`, aucune_ecriture: true },
        journal: { action, projectId, quoteId, resultat: "verification_impossible", http_progbat: lu?.status ?? 0 },
      };
    }
    // 404 confirmé : on libère.
    const horodatage = maintenant.toISOString();
    if (brut?.id) {
      const maj = await depot.majExport(brut.id, {
        statut: "absent", http_status: 404, finished_at: horodatage,
        error_message: "Devis supprimé dans ProGBat (404 confirmé par lecture)",
      });
      if (!maj?.ok) {
        return { http: 200, body: { ok: false, action, code: "liberation_incomplete", error: "ProGBat confirme la suppression, mais le suivi Profero n'a pas pu être mis à jour. Réessayer.", aucune_ecriture: false } };
      }
    }
    const majProjet = await depot.majProjetDevis(projectId, { progbat_devis_id: null, progbat_sync_at: null });
    if (!majProjet?.ok) {
      return { http: 200, body: { ok: false, action, code: "liberation_incomplete", error: "ProGBat confirme la suppression, mais le logement garde la trace du brouillon. Réessayer.", aucune_ecriture: false } };
    }
    return {
      http: 200,
      body: { ok: true, action, libere: true, progbat_quote_id: quoteId, message: `ProGBat confirme que le brouillon ${quoteId} n'existe plus : une nouvelle création est de nouveau possible.`, aucune_ecriture: false },
      journal: { action, projectId, quoteId, resultat: "libere" },
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
  if (logementReference && logementReference !== str(rec.projet.logement_reference)) {
    return refuser(409, "logement_different", `Le logement confirmé (${logementReference}) ne correspond pas à celui du projet (${str(rec.projet.logement_reference) || "sans référence"}) : relancer l'aperçu.`);
  }
  if (str(requete.expectedPayloadHash) !== rec.payloadHash) {
    return refuser(409, "hash_different", "Le projet ou ses lignes ont changé depuis l'aperçu : relancer l'aperçu puis confirmer à nouveau.");
  }

  // Réservation AVANT l'appel ProGBat : l'index unique refuse une seconde réservation.
  const reservation = await depot.reserverExport({
    project_id: projectId,
    payload_hash: rec.payloadHash,
    logement_reference: str(rec.projet.logement_reference) || null,
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
    const cinqCents = Number.isInteger(rep.status) && rep.status >= 500;
    if (rep.timeout || rep.reseau || cinqCents) {
      // Le POST est parti : un délai, une coupure ou une erreur serveur ProGBat ne disent pas si le devis a été créé.
      const message = nettoyerMessage(rep.message) || (cinqCents ? `ProGBat indisponible (${rep.status}) après envoi du POST.` : "Réponse ProGBat inconnue (délai dépassé ou réseau).");
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

  // Vérification facultative par le GET officiel : confirme la présence du brouillon.
  // Quel que soit son résultat, le statut reste `created` et AUCUN second POST n'est émis.
  let verification = null;
  if (typeof progbat.lireDevis === "function") {
    try {
      const v = await progbat.lireDevis(quoteId);
      const idLu = v?.ok ? (Number.isInteger(v.data?.id) ? v.data.id : Number(v.data?.id)) : null;
      verification = { ok: v?.ok === true, status: v?.status ?? null, id_confirme: v?.ok === true && idLu === quoteId };
    } catch {
      verification = { ok: false, status: null, id_confirme: false };
    }
    try {
      await depot.majExport(exportId, { verified_at: verification.id_confirme ? new Date().toISOString() : null, verification_http_status: verification.status });
    } catch { /* la vérification est informative : le devis est créé */ }
  }
  const finished_at = new Date().toISOString();

  return {
    http: 200,
    body: {
      ok: true, action, statut: "created", message: "Devis brouillon ProGBat créé.",
      progbat_quote_id: quoteId, progbat_quote_code: quoteCode, progbat_status: rep.status,
      created_by_email: str(appelant.email) || null, finished_at,
      verification,
      payloadHash: rec.payloadHash, export_id: exportId, compteurs: rec.resultat.compteurs, totaux: rec.resultat.totaux,
    },
    journal: { action, projectId, endpoint: ENDPOINT_POST_DEVIS, http_status: rep.status, progbat_quote_id: quoteId, statut: "created", verification: verification ? (verification.id_confirme ? "confirmee" : `non_confirmee_${verification.status ?? "erreur"}`) : "non_tentee", duree_ms },
  };
}
