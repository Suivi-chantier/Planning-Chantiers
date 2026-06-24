import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// ─────────────────────────────────────────────────────────────────────────────
// list-team-calendar-events
// Lit les événements Google Agenda de plusieurs membres de l'équipe et les
// renvoie fusionnés, pour affichage dans le tableau de bord.
//
// Authentification : on réutilise le MÊME compte d'automatisation que la fonction
// d'écriture (create-mission-calendar-event) — og@groupe-profero.com — via son
// refresh_token OAuth. On échange le refresh_token contre un access_token, puis
// on interroge l'API Calendar pour chaque agenda.
//
// ⚠️ Chaque agenda lu doit être PARTAGÉ avec og@groupe-profero.com
//    (droit « Voir tous les détails de l'événement » au minimum).
//    Sinon Google renvoie 404 pour ce calendrier — il apparaîtra dans `errors`.
//
// Secrets Supabase attendus (mettre les MÊMES valeurs que la fonction d'écriture) :
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN
// (des alias sans le préfixe OAUTH_ sont aussi acceptés, voir getSecret)
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

// Récupère un secret en testant plusieurs noms possibles (tolérant à la
// convention utilisée par la fonction d'écriture déjà déployée).
const getSecret = (...names: string[]) => {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  return ""
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  // Réutilise un token encore valide (marge de 60 s) pour limiter les appels.
  if (cachedToken && cachedToken.expiresAt - 60_000 > tsNow()) return cachedToken.value

  const clientId = getSecret("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID")
  const clientSecret = getSecret("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET")
  const refreshToken = getSecret("GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN")

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Secrets Google manquants. Configurez GOOGLE_OAUTH_CLIENT_ID, " +
      "GOOGLE_OAUTH_CLIENT_SECRET et GOOGLE_OAUTH_REFRESH_TOKEN dans Supabase " +
      "(mêmes valeurs que la fonction create-mission-calendar-event).",
    )
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })

  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(`Échec rafraîchissement token Google : ${data.error || res.status} ${data.error_description || ""}`.trim())
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: tsNow() + (Number(data.expires_in) || 3600) * 1000,
  }
  return cachedToken.value
}

const tsNow = () => Date.now()

async function fetchCalendar(email: string, token: string, timeMin: string, timeMax: string, maxResults: number) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  })
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(email)}/events?${params.toString()}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const e = await res.json()
      detail = e?.error?.message || detail
    } catch { /* ignore */ }
    return { ok: false as const, email, error: detail, status: res.status }
  }

  const data = await res.json()
  const events = (data.items || [])
    .filter((it: any) => it.status !== "cancelled")
    .map((it: any) => {
      const allDay = !it.start?.dateTime
      return {
        calendarEmail: email,
        id: it.id,
        summary: it.summary || "(Sans titre)",
        location: it.location || "",
        allDay,
        start: it.start?.dateTime || it.start?.date || null,
        end: it.end?.dateTime || it.end?.date || null,
        htmlLink: it.htmlLink || "",
      }
    })
  return { ok: true as const, email, events }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const emails: string[] = Array.isArray(body.emails)
      ? Array.from(new Set(body.emails.map((e: string) => String(e || "").trim().toLowerCase()).filter(Boolean)))
      : []
    if (!emails.length) return json({ error: "Aucun email d'agenda fourni." }, 400)

    const timeMin = String(body.timeMin || "")
    const timeMax = String(body.timeMax || "")
    if (!timeMin || !timeMax) return json({ error: "timeMin et timeMax sont requis (ISO 8601)." }, 400)
    const maxResults = Math.min(Math.max(Number(body.maxPerCalendar) || 50, 1), 250)

    const token = await getAccessToken()

    const results = await Promise.all(
      emails.map((email) => fetchCalendar(email, token, timeMin, timeMax, maxResults)),
    )

    const events = results.flatMap((r) => (r.ok ? r.events : []))
    const errors = results
      .filter((r) => !r.ok)
      .map((r: any) => ({ email: r.email, error: r.error, status: r.status }))

    return json({ ok: true, events, errors })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
