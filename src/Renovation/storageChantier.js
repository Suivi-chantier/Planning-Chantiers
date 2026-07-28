// ─────────────────────────────────────────────────────────────────────────────
// Documents de chantier — bucket Supabase PRIVÉ "chantier-documents".
// (À créer via sql/202607_bucket_chantier_documents.sql.)
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
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";

export const BUCKET_CHANTIER_DOCS = "chantier-documents";
const MAX_OCTETS = 50 * 1024 * 1024; // 50 Mo, comme invest-documents

// Types acceptés par défaut pour les inputs fichier (documents + photos).
export const ACCEPT_DOCS = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

const safeName = (name) => String(name || "fichier")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .slice(-80);

// Upload → { path, nom, taille, type } ou null (l'appelant affiche l'erreur).
export async function uploadDocumentChantier(file, pathPrefix) {
  if (!file || !pathPrefix) return null;
  if (file.size > MAX_OCTETS) {
    alert("Fichier trop volumineux (maximum 50 Mo).");
    return null;
  }
  const path = `${pathPrefix}/${Date.now()}_${safeName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET_CHANTIER_DOCS)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    console.error("upload document chantier:", error);
    return null;
  }
  return { path, nom: file.name, taille: file.size, type: file.type || "" };
}

// URL signée temporaire pour ouvrir/télécharger un document (bucket privé).
export async function urlDocumentChantier(path, expiresIn = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET_CHANTIER_DOCS)
    .createSignedUrl(path, expiresIn);
  if (error) {
    console.error("URL signée document chantier:", error);
    return null;
  }
  return data?.signedUrl || null;
}

// Suppression best-effort (la métadonnée est retirée par l'appelant même si
// la suppression physique échoue).
export async function supprimerDocumentChantier(path) {
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET_CHANTIER_DOCS).remove([path]);
  if (error) {
    console.warn("suppression document chantier:", error.message);
    return false;
  }
  return true;
}
