import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const looksLikeEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());


// ── Garde d'accès (sécurité 3d, 01/10/2026) ─────────────────────────────────
// Avant : verify_jwt seul. La clé publique « anon » est un jeton valide, donc la
// fonction était appelable par n'importe qui. Désormais : jeton d'un vrai
// utilisateur ET collaborateur actif (même règle que la RLS : est_collaborateur_actif).
// Le client est borné au jeton de l'appelant ; aucun service_role ici.
// Copie volontairement locale (pas de dossier partagé) : chaque fonction se déploie seule.
import { createClient as createClientGarde } from "https://esm.sh/@supabase/supabase-js@2";

async function exigerCollaborateur(req: Request, entetes: Record<string, string>): Promise<Response | null> {
  const refuser = (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ ok: false, error: message, code }), {
      status,
      headers: { ...entetes, "Content-Type": "application/json" },
    });
  const authorization = req.headers.get("Authorization") || "";
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (!m) return refuser(401, "non_authentifie", "Connexion requise.");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const clePublique = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !clePublique) return refuser(500, "configuration", "Configuration serveur incomplète.");
  const sb = createClientGarde(url, clePublique, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error } = await sb.auth.getUser(m[1]);
  if (error || !u?.user) return refuser(401, "non_authentifie", "Connexion requise.");
  const { data: ok, error: e2 } = await sb.rpc("est_collaborateur_actif");
  if (e2 || ok !== true) return refuser(403, "acces_refuse", "Accès réservé aux collaborateurs.");
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Méthode non autorisée" }, 405);

  const refus = await exigerCollaborateur(req, corsHeaders);
  if (refus) return refus;

  let actionId: string | null = null;

  try {
    const body = await req.json();
    const {
      actionId: incomingActionId,
      clientId,
      to,
      subject,
      body: emailBody,
      htmlBody,
      responsable,
      clientName,
      senderEmail,
      fromEmail,
    } = body || {};

    actionId = incomingActionId ? String(incomingActionId) : null;

    if (!actionId) return jsonResponse({ error: "actionId manquant" }, 400);
    if (!looksLikeEmail(to)) return jsonResponse({ error: "Email destinataire invalide" }, 400);
    if (!subject) return jsonResponse({ error: "Sujet email manquant" }, 400);
    if (!emailBody && !htmlBody) return jsonResponse({ error: "Corps email manquant" }, 400);

    const appsScriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_WEBAPP_URL") || "";
    const appsScriptSecret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";

    if (!appsScriptUrl || !appsScriptSecret) {
      throw new Error(
        "Variables Apps Script absentes. Configure GOOGLE_APPS_SCRIPT_WEBAPP_URL et GOOGLE_APPS_SCRIPT_SECRET dans les secrets Supabase de l'Edge Function send-mission-email.",
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

    // Expéditeur imposé côté serveur : ni senderEmail ni fromEmail du corps ne sont
    // plus crus (le front envoie toujours og@groupe-profero.com).
    const sentFrom = "og@groupe-profero.com";

    const appsPayload = {
      secret: appsScriptSecret,
      mode: "email",
      to: String(to),
      subject: String(subject),
      body: String(emailBody || ""),
      htmlBody: htmlBody ? String(htmlBody) : "",
      responsable: responsable || "",
      client: clientName || "",
      source: "profero-invest",
      sourceEmail: sentFrom,
      senderEmail: sentFrom,
      actionId,
      clientId: clientId ? String(clientId) : "",
    };

    const appsRes = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(appsPayload),
      redirect: "follow",
    });

    const rawText = await appsRes.text();
    let appsJson: Record<string, unknown> = {};
    try {
      appsJson = rawText ? JSON.parse(rawText) : {};
    } catch {
      appsJson = { ok: false, error: rawText || "Réponse Apps Script illisible" };
    }

    if (!appsRes.ok || appsJson.ok === false) {
      const msg = String(appsJson.error || appsJson.message || `Erreur Apps Script HTTP ${appsRes.status}`);
      if (supabase) {
        await supabase.from("invest_mission_actions").update({
          notification_status: "erreur_envoi",
          notification_error: msg,
          updated_at: new Date().toISOString(),
        }).eq("id", actionId);
      }
      return jsonResponse({ error: msg, appsScript: appsJson }, 400);
    }

    const sentAt = new Date().toISOString();
    const patch = {
      notification_status: "envoyee",
      notification_sent_at: sentAt,
      notification_error: null,
      gmail_message_id: appsJson.messageId ? String(appsJson.messageId) : null,
      updated_at: sentAt,
    };

    if (supabase) await supabase.from("invest_mission_actions").update(patch).eq("id", actionId);

    return jsonResponse({
      ok: true,
      sentAt,
      gmailMessageId: patch.gmail_message_id,
      sentFrom,
      appsScript: appsJson,
    });
  } catch (error) {
    const msg = error?.message || "Erreur envoi email via Apps Script";

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (actionId && supabaseUrl && serviceRole) {
        const supabase = createClient(supabaseUrl, serviceRole);
        await supabase.from("invest_mission_actions").update({
          notification_status: "erreur_envoi",
          notification_error: msg,
          updated_at: new Date().toISOString(),
        }).eq("id", actionId);
      }
    } catch {
      // Ne bloque pas la réponse principale si la mise à jour Supabase échoue.
    }

    return jsonResponse({ error: msg }, 500);
  }
});