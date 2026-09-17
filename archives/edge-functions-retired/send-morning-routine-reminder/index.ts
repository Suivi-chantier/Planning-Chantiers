// PROFERO INVEST — Edge Function V4.1
// Nom de fonction : send-morning-routine-reminder
// Chemin : supabase/functions/send-morning-routine-reminder/index.ts
// Déploiement conseillé : supabase functions deploy send-morning-routine-reminder --no-verify-jwt

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parisParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method === "GET") {
    return jsonResponse({ ok: true, function: "send-morning-routine-reminder", version: "v4.1", paris: parisParts() });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée" }, 405);
  }

  try {
    const body = await readBody(req);
    const source = body.source || "manual";
    const nowParis = parisParts(new Date());
    const routineDate = body.date || nowParis.date;
    const isManual = source === "manual" || source === "manual_test" || body.force === true;

    const cronSecret = Deno.env.get("MORNING_ROUTINE_CRON_SECRET") || "";
    const incomingCronSecret = req.headers.get("x-cron-secret") || body.cron_secret || "";

    if (!isManual && cronSecret && incomingCronSecret !== cronSecret) {
      return jsonResponse({ error: "Secret cron invalide" }, 401);
    }

    if (!isManual && nowParis.hour !== 8) {
      return jsonResponse({ skipped: true, reason: "not_8h_paris", paris: nowParis });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const to = body.to || Deno.env.get("MORNING_ROUTINE_TO") || "matthieu.fumoleau@groupe-profero.com";
    const webhookUrl =
      Deno.env.get("MORNING_ROUTINE_MAIL_WEBHOOK_URL") ||
      Deno.env.get("MAIL_WEBHOOK_URL") ||
      Deno.env.get("MAIL_AGENDA_WEBAPP_URL") ||
      "";

    if (!supabaseUrl) return jsonResponse({ error: "Secret SUPABASE_URL manquant" }, 500);
    if (!serviceRole) return jsonResponse({ error: "Secret SUPABASE_SERVICE_ROLE_KEY manquant" }, 500);
    if (!webhookUrl) return jsonResponse({ error: "Secret MORNING_ROUTINE_MAIL_WEBHOOK_URL manquant" }, 500);

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: existingError } = await supabase
      .from("invest_morning_routine_reminders")
      .select("id,status,sent_at")
      .eq("routine_date", routineDate)
      .eq("recipient", to)
      .maybeSingle();

    if (existingError && existingError.code !== "PGRST116") {
      return jsonResponse({ error: `Lecture reminder impossible : ${existingError.message}` }, 500);
    }

    if (existing?.sent_at && !body.force) {
      return jsonResponse({ skipped: true, reason: "already_sent", existing });
    }

    const subject = `Morning Routine Profero Invest — ${routineDate}`;
    const text = [
      "Bonjour Matthieu,",
      "",
      "Rappel : lance ta Morning Routine Profero Invest.",
      "",
      "Cadre à suivre :",
      "1. Vue globale",
      "2. Collaborateurs",
      "3. Prospects",
      "4. Clients actifs",
      "5. Biens identifiés",
      "6. Synthèse du jour",
      "",
      "Objectif : aucune urgence sans décision, aucun client/prospect critique sans prochaine action datée.",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#0D2E5C;line-height:1.5">
        <h2>Morning Routine Profero Invest</h2>
        <p>Bonjour Matthieu,</p>
        <p>Rappel : lance ta <strong>Morning Routine</strong>.</p>
        <ol>
          <li>Vue globale</li>
          <li>Collaborateurs</li>
          <li>Prospects</li>
          <li>Clients actifs</li>
          <li>Biens identifiés</li>
          <li>Synthèse du jour</li>
        </ol>
        <p><strong>Règle :</strong> aucune urgence sans décision, aucun client/prospect critique sans prochaine action datée.</p>
      </div>
    `;

    const mailRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sendMail",
        source: "morning_routine_reminder",
        to,
        subject,
        body: text,
        text,
        html,
        htmlBody: html,
      }),
    });

    const responseText = await mailRes.text();
    if (!mailRes.ok) {
      return jsonResponse({ error: `Webhook mail erreur ${mailRes.status}`, response: responseText }, 502);
    }

    const { error: upsertError } = await supabase.from("invest_morning_routine_reminders").upsert({
      routine_date: routineDate,
      recipient: to,
      sent_at: new Date().toISOString(),
      status: "sent",
      response: { webhook_status: mailRes.status, response: responseText, source },
    }, { onConflict: "routine_date,recipient" });

    if (upsertError) return jsonResponse({ error: `Sauvegarde reminder impossible : ${upsertError.message}` }, 500);

    return jsonResponse({ ok: true, sent: 1, to, routineDate, source });
  } catch (e) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
