import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Appel d'une Edge Function AVEC la session de l'utilisateur.
 *
 * `supabase.functions.invoke` joint automatiquement le jeton de la session
 * courante : l'URL de la fonction n'est jamais écrite en dur, et aucun en-tête
 * d'autorisation n'est fabriqué à la main. C'est ce qui permet à une fonction
 * d'exiger un appelant authentifié au lieu d'être ouverte à tous.
 *
 * SANS SESSION, ON N'APPELLE PAS. Pas de repli anonyme : une analyse lancée
 * après expiration de la session doit dire « reconnectez-vous », pas partir
 * quand même et échouer plus loin de façon incompréhensible.
 *
 * Les erreurs sont normalisées en Error(message lisible) : `invoke` renvoie un
 * objet `error` dont le corps JSON de la fonction est parfois joint, et c'est
 * ce corps qui porte le message utile.
 *
 * @throws Error à la moindre anomalie — l'appelant garde ses try/catch actuels.
 */
export async function invoquerFonction(nom, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expirée : reconnectez-vous pour relancer l'opération.");

  const { data, error } = await supabase.functions.invoke(nom, { body });
  if (error) {
    let corps = null;
    try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps JSON */ }
    // La fonction peut renvoyer { error: "texte" } ou { error: { message } }.
    const message = corps?.error?.message
      || (typeof corps?.error === "string" ? corps.error : null)
      || error.message;
    throw new Error(message || "Erreur Edge Function");
  }
  if (data === null || data === undefined) throw new Error("Réponse vide de la fonction.");
  return data;
}

// Identifiant unique par onglet, utilisé pour étiqueter nos propres sauvegardes
// et filtrer les events Realtime venant d'autres collaborateurs.
export function getClientId() {
  try {
    let id = sessionStorage.getItem("collab_client_id");
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("collab_client_id", id);
    }
    return id;
  } catch {
    if (!globalThis.__collabClientId) {
      globalThis.__collabClientId = `c${Date.now()}${Math.random().toString(36).slice(2)}`;
    }
    return globalThis.__collabClientId;
  }
}

// Transforme une URL Supabase Storage publique en URL avec resize on-the-fly.
// Nécessite Image Transformations (plan Pro). Si l'URL n'est pas une URL Storage
// publique reconnue, elle est renvoyée telle quelle — appel safe sur toute URL.
export function photoTransform(url, { width, height, quality = 75, resize = "cover" } = {}) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("/storage/v1/object/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const params = new URLSearchParams();
  if (width)   params.set("width",   String(width));
  if (height)  params.set("height",  String(height));
  if (resize)  params.set("resize",  resize);
  if (quality) params.set("quality", String(quality));
  return `${base}?${params.toString()}`;
}
