import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
