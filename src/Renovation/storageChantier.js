// ─────────────────────────────────────────────────────────────────────────────
// Documents de chantier — bucket Supabase PRIVÉ "chantier-documents".
// (Créé via sql/202607_bucket_chantier_documents.sql.)
//
// Contrairement au bucket public "photos" (images de terrain), ce bucket
// stocke des DOCUMENTS sensibles (devis, devis signé, plans, PV de réception,
// DOE, pièces jointes du cycle de vie) : l'accès passe par des URLs SIGNÉES,
// jamais par getPublicUrl. C'est le helper d'upload UNIQUE côté Rénovation
// pour les documents — ne pas dupliquer (le repo compte déjà 6 copies de
// l'upload photos, n'en ajoutons pas une 7ᵉ).
//
// Les métadonnées (nom, chemin, taille, type, date, auteur) sont stockées par
// l'appelant à côté de la donnée métier (ex. plan_travaux.meta.cycle_vie_etapes
// [etapeId].pieces_jointes) — on stocke le PATH, pas l'URL signée (périssable).
//
// JETON D'ACCÈS — les policies du bucket sont réservées au rôle "authenticated".
// Or le client storage résout le jeton de session au moment de la requête, et
// on a observé en production des envois partis en rôle "anon" (rejet RLS
// « new row violates row-level security policy ») alors que la session était
// valide au même instant côté PostgREST. On épingle donc l'en-tête
// Authorization nous-mêmes à partir de la session courante, avec un
// rafraîchissement + une seconde tentative si le serveur refuse quand même.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";

export const BUCKET_CHANTIER_DOCS = "chantier-documents";
const MAX_OCTETS = 50 * 1024 * 1024; // 50 Mo, comme invest-documents

// Types acceptés par défaut pour les inputs fichier (documents + photos).
export const ACCEPT_DOCS = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

const MSG_SESSION = "Session expirée : reconnectez-vous puis réessayez.";

// Dernier motif d'échec, pour que l'appelant affiche une vraie raison plutôt
// qu'un message générique ("le bucket n'existe pas") qui envoie sur une fausse
// piste. Remis à zéro au début de chaque opération.
let derniereErreur = "";
export const derniereErreurDocument = () => derniereErreur;

const safeName = (name) => String(name || "fichier")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .slice(-80);

// Jeton d'accès de la session courante (null si déconnecté). forcer=true passe
// par un rafraîchissement explicite — utilisé pour la 2ᵉ tentative.
async function jetonSession(forcer = false) {
  try {
    if (!forcer) {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) return data.session.access_token;
    }
    const { data } = await supabase.auth.refreshSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

// Erreur qui peut venir d'un jeton absent/périmé → une 2ᵉ tentative après
// rafraîchissement a des chances d'aboutir (le rejet RLS remonte en 400).
const erreurDeJeton = (error) => {
  const code = Number(error?.statusCode ?? error?.status ?? 0);
  const msg = String(error?.message || "").toLowerCase();
  return code === 400 || code === 401 || code === 403
    || msg.includes("row-level security") || msg.includes("unauthorized") || msg.includes("jwt");
};

// Upload → { path, nom, taille, type } ou null (l'appelant affiche l'erreur,
// via derniereErreurDocument() pour la raison exacte).
export async function uploadDocumentChantier(file, pathPrefix) {
  derniereErreur = "";
  if (!file || !pathPrefix) { derniereErreur = "Aucun fichier sélectionné."; return null; }
  if (file.size > MAX_OCTETS) {
    derniereErreur = "Fichier trop volumineux (maximum 50 Mo).";
    alert(derniereErreur);
    return null;
  }
  const path = `${pathPrefix}/${Date.now()}_${safeName(file.name)}`;
  const envoyer = (token) => supabase.storage.from(BUCKET_CHANTIER_DOCS)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });

  let token = await jetonSession();
  if (!token) { derniereErreur = MSG_SESSION; return null; }
  let { error } = await envoyer(token);
  if (error && erreurDeJeton(error)) {
    const frais = await jetonSession(true);
    if (!frais) { derniereErreur = MSG_SESSION; return null; }
    ({ error } = await envoyer(frais));
  }
  if (error) {
    console.error("upload document chantier:", error);
    derniereErreur = erreurDeJeton(error) ? MSG_SESSION : `Envoi refusé : ${error.message}`;
    return null;
  }
  return { path, nom: file.name, taille: file.size, type: file.type || "" };
}

// URL signée temporaire pour ouvrir/télécharger un document (bucket privé).
export async function urlDocumentChantier(path, expiresIn = 600) {
  derniereErreur = "";
  if (!path) { derniereErreur = "Document introuvable."; return null; }
  const signer = () => supabase.storage.from(BUCKET_CHANTIER_DOCS).createSignedUrl(path, expiresIn);

  let { data, error } = await signer();
  if (error && erreurDeJeton(error)) {
    const frais = await jetonSession(true);
    if (!frais) { derniereErreur = MSG_SESSION; return null; }
    ({ data, error } = await signer());
  }
  if (error) {
    console.error("URL signée document chantier:", error);
    derniereErreur = erreurDeJeton(error) ? MSG_SESSION : `Lecture refusée : ${error.message}`;
    return null;
  }
  return data?.signedUrl || null;
}

// Suppression best-effort (la métadonnée est retirée par l'appelant même si
// la suppression physique échoue).
export async function supprimerDocumentChantier(path) {
  if (!path) return false;
  let { error } = await supabase.storage.from(BUCKET_CHANTIER_DOCS).remove([path]);
  if (error && erreurDeJeton(error)) {
    const frais = await jetonSession(true);
    if (frais) ({ error } = await supabase.storage.from(BUCKET_CHANTIER_DOCS).remove([path]));
  }
  if (error) {
    console.warn("suppression document chantier:", error.message);
    return false;
  }
  return true;
}
