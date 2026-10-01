// PROFERO INVEST — SOURCING
// Edge Function : sourcing-analyse-url
// Objectif : tenter une capture simple des métadonnées publiques d'une URL d'annonce.
// Important : cette fonction ne contourne pas les protections, n'utilise pas de proxy,
// pas de captcha bypass, pas de rotation d'IP. Si la source refuse l'accès, elle retourne
// un statut bloqué/partiel pour permettre une saisie manuelle dans l'application.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function decodeHtml(value: string) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function getMeta(html: string, key: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${key}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${key}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return "";
}

function getTitle(html: string) {
  const ogTitle = getMeta(html, "og:title");
  if (ogTitle) return ogTitle.replace(/\s*[-|]\s*leboncoin\s*$/i, "").trim();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return stripTags(titleMatch[1]).replace(/\s*[-|]\s*leboncoin\s*$/i, "").trim();

  return "";
}

function numberFromText(value: string) {
  const clean = String(value || "").replace(/\s/g, "").replace(/,/g, ".");
  const match = clean.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function extractPrice(html: string, text: string) {
  const jsonPatterns = [
    /"price"\s*:\s*"?(\d{2,9})"?/i,
    /"priceSpecification"[\s\S]{0,300}?"price"\s*:\s*"?(\d{2,9})"?/i,
    /"amount"\s*:\s*"?(\d{2,9})"?/i,
  ];

  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }

  const eurMatch = text.match(/(\d[\d\s]{3,})\s*€/i);
  if (eurMatch?.[1]) return Number(eurMatch[1].replace(/\s/g, ""));

  return null;
}

function extractSurface(text: string) {
  const match = text.match(/(\d+(?:[,.]\d+)?)\s*(?:m²|m2|m 2)\b/i);
  return match?.[1] ? numberFromText(match[1]) : null;
}

function extractRooms(text: string) {
  const match = text.match(/(\d+)\s*pi[eè]ces?/i);
  return match?.[1] ? Number(match[1]) : null;
}

function extractPostalCode(text: string) {
  const match = text.match(/\b(\d{5})\b/);
  return match?.[1] || "";
}

function inferPropertyType(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("immeuble")) return "Immeuble";
  if (lower.includes("maison")) return "Maison";
  if (lower.includes("appartement") || lower.includes("studio") || lower.includes("t2") || lower.includes("t3")) return "Appartement";
  if (lower.includes("local commercial")) return "Local commercial";
  return "";
}

function extractJsonLd(html: string) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const objects: unknown[] = [];

  for (const script of scripts) {
    const raw = script?.[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(decodeHtml(raw));
      if (Array.isArray(parsed)) objects.push(...parsed);
      else objects.push(parsed);
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }

  return objects;
}

function findJsonValue(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findJsonValue(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }

  for (const value of Object.values(record)) {
    const found = findJsonValue(value, keys);
    if (found !== undefined) return found;
  }

  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Méthode non autorisée." }, 405);
  }

  let url = "";

  try {
    const body = await req.json();
    url = String(body?.url || "").trim();
  } catch {
    return jsonResponse({ ok: false, message: "Body JSON invalide." }, 400);
  }

  if (!url || !url.startsWith("http")) {
    return jsonResponse({ ok: false, message: "URL manquante ou invalide." }, 400);
  }

  if (!url.includes("leboncoin.fr")) {
    return jsonResponse({ ok: false, message: "Seules les URLs Leboncoin sont acceptées pour cette capture." }, 400);
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
    });

    if (!response.ok) {
      return jsonResponse({
        ok: false,
        blocked: response.status === 403 || response.status === 429,
        status: response.status,
        message: `La source a refusé la capture directe HTTP ${response.status}. Complète l'annonce manuellement ou colle les informations dans Profero.`,
        data: {},
      });
    }

    const html = await response.text();
    const title = getTitle(html);
    const description = getMeta(html, "og:description") || getMeta(html, "description");
    const image = getMeta(html, "og:image");
    const allText = stripTags(`${title} ${description} ${html.slice(0, 150000)}`);
    const jsonLd = extractJsonLd(html);

    const jsonPrice = findJsonValue(jsonLd, ["price", "amount"]);
    const jsonImage = findJsonValue(jsonLd, ["image"]);
    const jsonDescription = findJsonValue(jsonLd, ["description"]);
    const jsonName = findJsonValue(jsonLd, ["name"]);

    const data = {
      titre: String(jsonName || title || "").trim(),
      description: String(jsonDescription || description || "").trim(),
      url_photo: Array.isArray(jsonImage) ? String(jsonImage[0] || image || "") : String(jsonImage || image || ""),
      prix: jsonPrice ? Number(String(jsonPrice).replace(/\s/g, "")) : extractPrice(html, allText),
      surface_m2: extractSurface(allText),
      nb_pieces: extractRooms(allText),
      code_postal: extractPostalCode(allText),
      type_bien: inferPropertyType(allText),
      vendeur_type: "inconnu",
    };

    const hasUsefulData = Boolean(data.titre || data.description || data.url_photo || data.prix || data.surface_m2);

    return jsonResponse({
      ok: hasUsefulData,
      message: hasUsefulData
        ? "Capture URL terminée. Certaines données peuvent nécessiter une vérification manuelle."
        : "La page a été lue mais aucune donnée exploitable n'a été détectée.",
      data,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error instanceof Error ? error.message : "Erreur inconnue pendant la capture URL.",
      data: {},
    }, 200);
  }
});