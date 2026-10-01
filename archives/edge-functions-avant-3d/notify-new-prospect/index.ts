// supabase/functions/notify-new-prospect/index.ts
// Profero Invest — Notification automatique nouveau prospect
// Version diagnostic V12.3
//
// À déployer avec :
// supabase functions deploy notify-new-prospect --no-verify-jwt
//
// Secrets nécessaires :
// PROFERO_NOTIFY_TO=matthieu.fumoleau@groupe-profero.com
// PROFERO_NOTIFY_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function text(v: unknown): string {
  return String(v || "").trim();
}

function escapeHtml(v: unknown): string {
  return text(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eur(v: unknown): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

function prospectName(prospect: Record<string, unknown>): string {
  const full = `${text(prospect.prenom)} ${text(prospect.nom)}`.trim();
  return full || text(prospect.societe) || "Nouveau prospect";
}

function buildEmail(payload: Record<string, unknown>) {
  const prospect = (payload.prospect || {}) as Record<string, unknown>;
  const mode = text(payload.mode) || "création";
  const name = prospectName(prospect);
  const to =
    text(payload.to) ||
    Deno.env.get("PROFERO_NOTIFY_TO") ||
    "matthieu.fumoleau@groupe-profero.com";

  const subject = `Nouveau prospect Profero Invest — ${name}`;

  const rows = [
    ["Prospect", name],
    ["Société", text(prospect.societe) || "—"],
    ["Téléphone", text(prospect.telephone) || "—"],
    ["Email", text(prospect.email) || "—"],
    ["Source", text(prospect.source) || "—"],
    ["Responsable", text(prospect.responsable) || "—"],
    ["Objectif", text(prospect.objectif) || "—"],
    ["Budget", eur(prospect.budget_global)],
    ["Zone", text(prospect.zone_recherche) || "—"],
    ["Prochaine action", text(prospect.prochaine_action) || "—"],
    ["Date relance", fmtDate(prospect.date_prochaine_action)],
    ["RDV", fmtDate(prospect.date_rdv)],
    ["Honoraires estimés", eur(prospect.honoraires_estimes_ht)],
    ["Mode", mode],
  ];

  const htmlRows = rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;width:180px;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">
          ${escapeHtml(value)}
        </td>
      </tr>
    `)
    .join("");

  const comment = text(prospect.commentaire);

  const htmlBody = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f8fb;padding:24px;">
    <div style="max-width:720px;margin:0 auto;background:white;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="background:#0b1220;color:white;padding:20px 24px;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#c7a75b;font-weight:800;">Profero Invest</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">Nouveau prospect</h1>
        <div style="margin-top:6px;color:#cbd5e1;font-size:14px;">${escapeHtml(name)}</div>
      </div>
      <div style="padding:20px 24px;">
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${htmlRows}
        </table>
        ${
          comment
            ? `
          <div style="margin-top:18px;padding:14px;border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;">
            <div style="font-weight:800;color:#111827;margin-bottom:6px;">Note prospect</div>
            <div style="white-space:pre-line;color:#374151;line-height:1.5;">${escapeHtml(comment)}</div>
          </div>
        `
            : ""
        }
        <div style="margin-top:18px;color:#6b7280;font-size:12px;">
          Notification automatique générée depuis le CRM Prospection Profero Invest.
        </div>
      </div>
    </div>
  </div>`;

  const textBody =
    rows.map(([label, value]) => `${label} : ${value}`).join("\n") +
    (comment ? `\n\nNote :\n${comment}` : "");

  return { to, subject, htmlBody, textBody };
}

async function sendWithAppsScript(mail: ReturnType<typeof buildEmail>) {
  const url =
    Deno.env.get("PROFERO_NOTIFY_APPS_SCRIPT_URL") ||
    Deno.env.get("PROFERO_APPS_SCRIPT_MAIL_URL");

  if (!url) {
    return {
      ok: false,
      skipped: true,
      provider: "apps_script",
      message: "Secret PROFERO_NOTIFY_APPS_SCRIPT_URL manquant.",
    };
  }

  if (!url.includes("/exec")) {
    return {
      ok: false,
      provider: "apps_script",
      message: "L'URL Apps Script doit être l'URL de déploiement Web App qui se termine par /exec.",
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "notify_new_prospect",
      to: mail.to,
      subject: mail.subject,
      htmlBody: mail.htmlBody,
      textBody: mail.textBody,
    }),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      provider: "apps_script",
      status: res.status,
      message: `Apps Script error ${res.status}: ${bodyText}`,
    };
  }

  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }

  if (bodyJson && bodyJson.ok === false) {
    return {
      ok: false,
      provider: "apps_script",
      status: res.status,
      message: text(bodyJson.error) || text(bodyJson.message) || "Apps Script n'a pas confirmé l'envoi.",
      response: bodyJson,
    };
  }

  return {
    ok: true,
    provider: "apps_script",
    status: res.status,
    response: bodyJson || bodyText,
  };
}

async function sendWithResend(mail: ReturnType<typeof buildEmail>) {
  const apiKey = Deno.env.get("RESEND_API_KEY");

  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      provider: "resend",
      message: "RESEND_API_KEY non configuré.",
    };
  }

  const from = Deno.env.get("RESEND_FROM") || "Profero Invest <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.htmlBody,
      text: mail.textBody,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      ok: false,
      provider: "resend",
      status: res.status,
      message: `Resend error ${res.status}: ${JSON.stringify(body)}`,
      response: body,
    };
  }

  return {
    ok: true,
    provider: "resend",
    status: res.status,
    response: body,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Test direct depuis navigateur :
  // https://PROJECT_REF.functions.supabase.co/notify-new-prospect
  if (req.method === "GET") {
    return jsonResponse({
      ok: true,
      function: "notify-new-prospect",
      status: "reachable",
      has_apps_script_url: Boolean(Deno.env.get("PROFERO_NOTIFY_APPS_SCRIPT_URL")),
      has_notify_to: Boolean(Deno.env.get("PROFERO_NOTIFY_TO")),
      notify_to: Deno.env.get("PROFERO_NOTIFY_TO") || null,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const mail = buildEmail(payload || {});

    const appsScriptResult = await sendWithAppsScript(mail);
    if (appsScriptResult.ok) {
      return jsonResponse({
        ok: true,
        provider: "apps_script",
        to: mail.to,
        subject: mail.subject,
        detail: appsScriptResult,
      });
    }

    const resendResult = await sendWithResend(mail);
    if (resendResult.ok) {
      return jsonResponse({
        ok: true,
        provider: "resend",
        to: mail.to,
        subject: mail.subject,
        detail: resendResult,
      });
    }

    return jsonResponse({
      ok: false,
      error: "Aucun provider email n'a confirmé l'envoi.",
      apps_script: appsScriptResult,
      resend: resendResult,
      expected_secret: "PROFERO_NOTIFY_APPS_SCRIPT_URL",
    }, 200);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});