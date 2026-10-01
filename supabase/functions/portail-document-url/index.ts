// Edge Function : portail-document-url (Portail client Invest, étape 3).
// Délivre un lien de téléchargement de 60 secondes pour UN document que Profero a
// partagé explicitement avec le client connecté. Lecture seule.
//
// L'ORDRE EST LA SÉCURITÉ :
//   1. OPTIONS / méthode POST seulement
//   2. jeton Authorization présent et valide (auth.getUser)
//   3. l'identifiant du document est demandé À LA VUE portail_documents avec le
//      jeton de l'appelant : la vue ne renvoie que les documents PARTAGÉS de SON
//      client (dossier montré). Le droit n'est jamais déduit du corps de la requête.
//   4. SEULEMENT ICI le service_role lit le chemin et signe le lien. Le chemin
//      n'est jamais renvoyé : seulement un lien qui expire.
// Le service_role n'est jamais utilisé avant que l'étape 3 ait réussi.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TTL_SECONDES = 60;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corps: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ ok: false, error: "Connexion requise." }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const clePublique = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !clePublique || !cleService) return json({ ok: false, error: "Configuration serveur incomplète." }, 500);

  const sbUtilisateur = createClient(url, clePublique, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: eAuth } = await sbUtilisateur.auth.getUser(m[1]);
  if (eAuth || !u?.user) return json({ ok: false, error: "Connexion requise." }, 401);

  let documentId = "";
  try { documentId = String((await req.json())?.documentId || ""); } catch { /* corps invalide */ }
  if (!UUID.test(documentId)) return json({ ok: false, error: "Document invalide." }, 400);

  // 3. Droit : la vue ne montre que les documents partagés de CE client.
  const { data: visible, error: eVue } = await sbUtilisateur
    .from("portail_documents").select("id").eq("id", documentId).maybeSingle();
  if (eVue || !visible) return json({ ok: false, error: "Document introuvable." }, 404);

  // 4. Seulement maintenant : le chemin et la signature, côté serveur.
  const sbService = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: partage } = await sbService
    .from("invest_documents_partages").select("chemin, libelle").eq("id", documentId).eq("statut", "partage").maybeSingle();
  if (!partage?.chemin) return json({ ok: false, error: "Document introuvable." }, 404);

  const { data: signe, error: eSign } = await sbService.storage
    .from("invest-documents").createSignedUrl(partage.chemin, TTL_SECONDES, { download: partage.libelle || true });
  if (eSign || !signe?.signedUrl) return json({ ok: false, error: "Fichier indisponible." }, 404);

  return json({ ok: true, url: signe.signedUrl, expireDansSecondes: TTL_SECONDES });
});
