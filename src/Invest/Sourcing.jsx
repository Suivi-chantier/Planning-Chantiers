import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

const STATUS_LABELS = {
  nouveau: "Nouveau",
  a_analyser: "À analyser",
  interessant: "Intéressant",
  a_contacter: "À contacter",
  contacte: "Contacté",
  visite_a_prevoir: "Visite à prévoir",
  offre_envisageable: "Offre envisageable",
  transforme_en_bien: "Transformé en bien",
  non_retenu: "Non retenu",
  archive: "Archivé",
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

const SOURCE_LABELS = {
  leboncoin_direct: "Leboncoin",
  leboncoin_assiste: "Leboncoin",
  leboncoin_url: "Leboncoin",
  seloger_direct: "SeLoger",
  seloger_assiste: "SeLoger",
  seloger_url: "SeLoger",
  multi_sources: "Toutes sources",
  url_manual: "URL importée",
  manual: "Manuel",
  email_alert: "Alerte email",
  csv: "CSV",
};

const POSITIVE_KEYWORDS = [
  "immeuble",
  "à rénover",
  "a renover",
  "travaux",
  "fort potentiel",
  "division possible",
  "plusieurs logements",
  "plateau",
  "grenier",
  "combles",
  "dépendance",
  "dependance",
  "garage",
  "local commercial",
  "dpe f",
  "dpe g",
  "passoire énergétique",
  "passoire energetique",
  "investisseur",
  "rentabilité",
  "rentabilite",
  "colocation",
  "coliving",
  "déficit foncier",
  "deficit foncier",
  "ancien",
  "grande maison",
  "maison familiale",
];

const NEGATIVE_KEYWORDS = [
  "viager",
  "terrain seul",
  "mobil-home",
  "mobil home",
  "camping",
  "résidence services",
  "residence services",
  "procédure",
  "procedure",
  "occupé sans bail",
  "occupe sans bail",
  "servitude",
  "copropriété dégradée",
  "copropriete degradee",
  "bail commercial contraignant",
  "enchères",
  "encheres",
  "saisie",
];

const EMPTY_ANNONCE = {
  source: "manual",
  source_url: "",
  titre: "",
  description: "",
  prix: "",
  surface_m2: "",
  ville: "",
  code_postal: "",
  type_bien: "",
  nb_pieces: "",
  vendeur_type: "inconnu",
  url_photo: "",
};

const EMPTY_CRITERE = {
  nom: "",
  zones: "",
  types_biens: "",
  prix_min: "",
  prix_max: "",
  surface_min: "",
  surface_max: "",
  pieces_min: "",
  mots_cles_inclus: "",
  mots_cles_exclus: "",
  vendeur_type: "tous",
  source: "multi_sources",
  frequence: "quotidien",
  actif: true,
  score_min_alerte: 65,
};

function safeText(value) {
  return String(value || "").toLowerCase();
}

function fmtEur(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

function daysBetween(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((new Date() - d) / (1000 * 60 * 60 * 24)));
}

function parseTextList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToText(value) {
  if (!Array.isArray(value)) return "";
  return value.join(", ");
}

function getCategory(score) {
  const n = Number(score || 0);
  if (n >= 80) return "A+";
  if (n >= 65) return "A";
  if (n >= 50) return "B";
  if (n >= 35) return "C";
  return "D";
}

function getAgeBadge(annonce) {
  const days = daysBetween(annonce?.first_seen_property_at || annonce?.premiere_detection || annonce?.created_at);
  if (days === null) return { label: "—", bg: "rgba(148,163,184,0.14)", color: "#64748b" };
  if (days <= 7) return { label: "🟢 Bien frais", bg: "rgba(34,197,94,0.10)", color: "#15803d" };
  if (days <= 21) return { label: "🟡 Bien en marché", bg: "rgba(234,179,8,0.12)", color: "#a16207" };
  if (days <= 45) return { label: "🟠 Bien à surveiller", bg: "rgba(249,115,22,0.12)", color: "#c2410c" };
  return { label: "🔴 Négociation possible", bg: "rgba(239,68,68,0.12)", color: "#b91c1c" };
}

function getListingAgeBadge(annonce) {
  const days = daysBetween(annonce?.first_seen_listing_at || annonce?.premiere_detection || annonce?.created_at);
  if (days === null) return { label: "—", bg: "rgba(148,163,184,0.14)", color: "#64748b" };
  if (days <= 7) return { label: `${days} j`, bg: "rgba(34,197,94,0.10)", color: "#15803d" };
  if (days <= 21) return { label: `${days} j`, bg: "rgba(234,179,8,0.12)", color: "#a16207" };
  if (days <= 45) return { label: `${days} j`, bg: "rgba(249,115,22,0.12)", color: "#c2410c" };
  return { label: `${days} j`, bg: "rgba(239,68,68,0.12)", color: "#b91c1c" };
}

function getRelistBadge(annonce) {
  const relistCount = Number(annonce?.relist_count || 0);
  const confidence = Number(annonce?.matching_confidence || 0);
  if (relistCount > 0 && confidence >= 85) {
    return { label: `Remis en ligne · confiance ${confidence}%`, bg: "rgba(239,68,68,0.12)", color: "#b91c1c" };
  }
  if (confidence >= 70) {
    return { label: `Déjà vu possible · confiance ${confidence}%`, bg: "rgba(245,158,11,0.14)", color: "#b45309" };
  }
  return null;
}

function getCategoryStyle(category) {
  if (category === "A+") return { bg: "rgba(16,185,129,0.14)", color: "#047857" };
  if (category === "A") return { bg: "rgba(34,197,94,0.12)", color: "#15803d" };
  if (category === "B") return { bg: "rgba(59,130,246,0.12)", color: "#1d4ed8" };
  if (category === "C") return { bg: "rgba(245,158,11,0.14)", color: "#b45309" };
  return { bg: "rgba(148,163,184,0.14)", color: "#475569" };
}

function hasPriceDrop(annonce) {
  const history = Array.isArray(annonce?.prix_historique) ? annonce.prix_historique : [];
  if (history.length < 2) return false;
  const first = Number(history[0]?.prix || 0);
  const last = Number(history[history.length - 1]?.prix || 0);
  return first > 0 && last > 0 && last < first;
}

function getLogSearchUrl(log) {
  const details = log?.details || {};
  if (typeof details?.search_url === "string") return details.search_url;
  if (typeof details?.url === "string") return details.url;
  if (Array.isArray(details?.urls_recherche) && details.urls_recherche[0]?.url) return details.urls_recherche[0].url;
  return "";
}

function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getIdentityTokens(value, limit = 16) {
  const stop = new Set(["maison", "appartement", "vente", "immobilier", "annonce", "pieces", "piece", "m2", "avec", "pour", "dans", "sur", "une", "des", "les", "aux", "proche", "secteur"]);
  return normalizeIdentityText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !stop.has(token))
    .slice(0, limit);
}

function tokenSimilarity(a, b) {
  const A = new Set(getIdentityTokens(a, 28));
  const B = new Set(getIdentityTokens(b, 28));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const token of A) if (B.has(token)) common += 1;
  return common / Math.max(A.size, B.size);
}

function withinPercent(a, b, percent) {
  const na = Number(a || 0);
  const nb = Number(b || 0);
  if (!na || !nb) return false;
  return Math.abs(na - nb) / Math.max(na, nb) <= percent;
}

function getPhotoSignature(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.split("/").filter(Boolean);
    const last = path[path.length - 1] || "";
    return normalizeIdentityText(last.replace(/\.(jpg|jpeg|png|webp|avif)$/i, ""));
  } catch {
    const clean = raw.split("?")[0].split("#")[0];
    const last = clean.split("/").filter(Boolean).pop() || clean;
    return normalizeIdentityText(last.replace(/\.(jpg|jpeg|png|webp|avif)$/i, ""));
  }
}

function buildPropertyFingerprint(annonce = {}) {
  const ville = normalizeIdentityText(annonce.ville || annonce.code_postal || "zone");
  const type = normalizeIdentityText(annonce.type_bien || "bien");
  const surface = annonce.surface_m2 ? `${Math.round(Number(annonce.surface_m2) / 5) * 5}m2` : "surfacex";
  const pieces = annonce.nb_pieces ? `${Math.round(Number(annonce.nb_pieces))}p` : "piecesx";
  const tokens = getIdentityTokens(`${annonce.titre || ""} ${annonce.description || ""}`, 8).join("-");
  return [ville, type, surface, pieces, tokens].filter(Boolean).join("-").slice(0, 220);
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean)));
}

function comparePropertySimilarity(candidate = {}, existing = {}) {
  const notes = [];
  let score = 0;

  const sameExternal = candidate.external_id && existing.external_id && String(candidate.external_id) === String(existing.external_id);
  const sameUrl = candidate.source_url && existing.source_url && String(candidate.source_url) === String(existing.source_url);
  if (sameExternal || sameUrl) return { score: 100, notes: ["Même URL ou même identifiant source"] };

  const candidatePhoto = getPhotoSignature(candidate.url_photo) || candidate.photo_signature || "";
  const existingPhoto = getPhotoSignature(existing.url_photo) || existing.photo_signature || "";

  // Coefficient fort demandé : la photo pèse plus lourd que les autres signaux.
  // Même signature photo = signal quasi déterminant, sans être le seul critère.
  if (candidatePhoto && existingPhoto && candidatePhoto === existingPhoto) {
    score += 40;
    notes.push("Photo identique ou très proche (+40)");
  }

  const cityA = normalizeIdentityText(candidate.ville || candidate.code_postal);
  const cityB = normalizeIdentityText(existing.ville || existing.code_postal);
  if (cityA && cityB && cityA === cityB) {
    score += 20;
    notes.push("Ville / zone identique (+20)");
  } else if (candidate.code_postal && existing.code_postal && String(candidate.code_postal).slice(0, 2) === String(existing.code_postal).slice(0, 2)) {
    score += 10;
    notes.push("Même département (+10)");
  }

  if (withinPercent(candidate.surface_m2, existing.surface_m2, 0.05)) {
    score += 18;
    notes.push("Surface proche à ±5 % (+18)");
  } else if (withinPercent(candidate.surface_m2, existing.surface_m2, 0.1)) {
    score += 10;
    notes.push("Surface proche à ±10 % (+10)");
  }

  if (candidate.nb_pieces && existing.nb_pieces && Number(candidate.nb_pieces) === Number(existing.nb_pieces)) {
    score += 10;
    notes.push("Nombre de pièces identique (+10)");
  }

  if (withinPercent(candidate.prix, existing.prix, 0.1)) {
    score += 10;
    notes.push("Prix proche à ±10 % (+10)");
  }

  const titleSim = tokenSimilarity(candidate.titre, existing.titre);
  if (titleSim >= 0.55) {
    score += 10;
    notes.push("Titre similaire (+10)");
  } else if (titleSim >= 0.35) {
    score += 5;
    notes.push("Titre partiellement similaire (+5)");
  }

  const descSim = tokenSimilarity(candidate.description, existing.description);
  if (descSim >= 0.45) {
    score += 8;
    notes.push("Description similaire (+8)");
  }

  const typeA = normalizeIdentityText(candidate.type_bien);
  const typeB = normalizeIdentityText(existing.type_bien);
  if (typeA && typeB && typeA === typeB) {
    score += 5;
    notes.push("Typologie identique (+5)");
  }

  return { score: Math.min(100, Math.round(score)), notes };
}

function findBestPropertyMatch(candidate = {}, annonces = [], currentId = null) {
  let best = null;
  for (const existing of Array.isArray(annonces) ? annonces : []) {
    if (!existing?.id || existing.id === currentId) continue;
    const result = comparePropertySimilarity(candidate, existing);
    if (!best || result.score > best.confidence) {
      best = { annonce: existing, confidence: result.score, notes: result.notes };
    }
  }
  return best && best.confidence >= 70 ? best : null;
}

function buildIdentityPayload(candidate = {}, annonces = [], now = new Date().toISOString(), currentId = null) {
  const match = findBestPropertyMatch(candidate, annonces, currentId);
  const photoSignature = getPhotoSignature(candidate.url_photo);
  const fingerprint = buildPropertyFingerprint(candidate);

  if (!match) {
    return {
      property_fingerprint: fingerprint,
      photo_signature: photoSignature || null,
      first_seen_property_at: candidate.first_seen_property_at || candidate.premiere_detection || now,
      first_seen_listing_at: candidate.first_seen_listing_at || candidate.premiere_detection || now,
      last_seen_at: now,
      relist_count: Number(candidate.relist_count || 0),
      previous_urls: uniqueStrings(candidate.previous_urls || []),
      matching_confidence: 0,
      possible_duplicate_of: null,
      similarity_notes: [],
    };
  }

  const existing = match.annonce;
  const previousUrls = uniqueStrings([
    ...(existing.previous_urls || []),
    existing.source_url,
    ...(candidate.previous_urls || []),
  ].filter((url) => url && url !== candidate.source_url));

  const sureRelist = match.confidence >= 85;

  return {
    property_fingerprint: fingerprint,
    photo_signature: photoSignature || null,
    first_seen_property_at: existing.first_seen_property_at || existing.premiere_detection || existing.created_at || now,
    first_seen_listing_at: candidate.first_seen_listing_at || candidate.premiere_detection || now,
    last_seen_at: now,
    relist_count: sureRelist ? Number(existing.relist_count || 0) + 1 : Number(candidate.relist_count || 0),
    previous_urls: previousUrls,
    matching_confidence: match.confidence,
    possible_duplicate_of: existing.id,
    similarity_notes: match.notes || [],
  };
}

function isRelistedAnnonce(annonce) {
  return Number(annonce?.relist_count || 0) > 0 || Number(annonce?.matching_confidence || 0) >= 85;
}


function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueByUrl(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function detectSourceFromUrl(url) {
  const raw = String(url || "").toLowerCase();
  if (raw.includes("leboncoin.fr")) return "leboncoin_url";
  if (raw.includes("seloger.com")) return "seloger_url";
  return "url_manual";
}

function getSourceLabel(source) {
  return SOURCE_LABELS[source] || source || "—";
}

function shouldGenerateLeboncoin(critere) {
  const source = String(critere?.source || "multi_sources");
  return ["multi_sources", "leboncoin_direct", "leboncoin_assiste", "leboncoin_url", "url_manual", "manual"].includes(source);
}

function shouldGenerateSeloger(critere) {
  const source = String(critere?.source || "multi_sources");
  return ["multi_sources", "seloger_direct", "seloger_assiste", "seloger_url"].includes(source);
}

function leboncoinLocationParam(zone) {
  const z = normalizeSearchText(zone);
  const map = {
    "angers": "Angers_49000",
    "avrille": "Avrillé_49240",
    "trelaze": "Trélazé_49800",
    "les ponts-de-ce": "Les Ponts-de-Cé_49130",
    "les ponts de ce": "Les Ponts-de-Cé_49130",
    "beaucouze": "Beaucouzé_49070",
    "bouchemaine": "Bouchemaine_49080",
    "saumur": "Saumur_49400",
    "cholet": "Cholet_49300",
    "saint-barthelemy-danjou": "Saint-Barthélemy-d'Anjou_49124",
    "saint barthelemy danjou": "Saint-Barthélemy-d'Anjou_49124",
    "saint-barthelemy-d anjou": "Saint-Barthélemy-d'Anjou_49124",
    "maine-et-loire": "Maine-et-Loire_49",
    "maine et loire": "Maine-et-Loire_49",
  };
  return map[z] || "";
}

function cleanLeboncoinKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPrioritySearchKeywords(critere) {
  const types = Array.isArray(critere?.types_biens) ? critere.types_biens : [];
  const included = Array.isArray(critere?.mots_cles_inclus) ? critere.mots_cles_inclus : [];
  const raw = [...types, ...included]
    .map(cleanLeboncoinKeyword)
    .filter(Boolean);

  const preferred = [
    "immeuble",
    "maison à rénover",
    "maison a renover",
    "travaux",
    "division possible",
    "plusieurs logements",
    "local commercial",
    "plateau",
    "dpe f",
    "dpe g",
  ];

  const selected = [];
  for (const wanted of preferred) {
    const found = raw.find((item) => normalizeSearchText(item).includes(normalizeSearchText(wanted)) || normalizeSearchText(wanted).includes(normalizeSearchText(item)));
    if (found && !selected.some((x) => normalizeSearchText(x) === normalizeSearchText(found))) selected.push(found);
  }
  for (const item of raw) {
    if (selected.length >= 5) break;
    if (!selected.some((x) => normalizeSearchText(x) === normalizeSearchText(item))) selected.push(item);
  }
  return selected.slice(0, 5);
}

function buildLeboncoinSearchUrl({ zone, keyword, critere, large = false }) {
  const params = new URLSearchParams();
  params.set("category", "9");

  const location = leboncoinLocationParam(zone);
  if (location) params.set("locations", location);

  const textParts = [];
  if (!large && keyword) textParts.push(cleanLeboncoinKeyword(keyword));
  if (!location && zone) textParts.push(cleanLeboncoinKeyword(zone));

  const text = textParts.join(" ").trim();
  if (text) params.set("text", text);

  const prixMin = critere?.prix_min ? Math.round(Number(critere.prix_min)) : "";
  const prixMax = critere?.prix_max ? Math.round(Number(critere.prix_max)) : "";
  if (prixMin || prixMax) params.set("price", `${prixMin}-${prixMax}`);

  const surfaceMin = critere?.surface_min ? Math.round(Number(critere.surface_min)) : "";
  const surfaceMax = critere?.surface_max ? Math.round(Number(critere.surface_max)) : "";
  if (surfaceMin || surfaceMax) params.set("square", `${surfaceMin}-${surfaceMax}`);

  if (critere?.pieces_min) params.set("rooms", `${Math.round(Number(critere.pieces_min))}-max`);

  if (critere?.vendeur_type === "particulier") params.set("owner_type", "private");
  if (critere?.vendeur_type === "pro") params.set("owner_type", "pro");

  return `https://www.leboncoin.fr/recherche?${params.toString()}`;
}

function generateLeboncoinSearchesForCritere(critere) {
  const zonesRaw = Array.isArray(critere?.zones) ? critere.zones : [];
  const zones = zonesRaw.length ? zonesRaw : [""];
  const keywords = getPrioritySearchKeywords(critere);
  const searches = [];

  for (const zone of zones.slice(0, 8)) {
    searches.push({
      critere_id: critere.id,
      nom: critere.nom,
      zone: zone || "Zone non renseignée",
      type: "large",
      label: `${critere.nom} — ${zone || "France"} — recherche large`,
      url: buildLeboncoinSearchUrl({ zone, keyword: "", critere, large: true }),
    });

    for (const keyword of keywords.slice(0, 4)) {
      searches.push({
        critere_id: critere.id,
        nom: critere.nom,
        zone: zone || "Zone non renseignée",
        keyword,
        type: "mot_cle",
        label: `${critere.nom} — ${zone || "France"} — ${keyword}`,
        url: buildLeboncoinSearchUrl({ zone, keyword, critere, large: false }),
      });
    }
  }

  return uniqueByUrl(searches).slice(0, 40);
}

function generateLeboncoinSearches(criteres = [], critereId = null) {
  const active = (Array.isArray(criteres) ? criteres : [])
    .filter((critere) => critere?.actif !== false)
    .filter((critere) => !critereId || critere.id === critereId);

  return uniqueByUrl(active.flatMap((critere) => generateLeboncoinSearchesForCritere(critere))).slice(0, 120);
}

function selogerLocationSlug(zone) {
  const z = normalizeSearchText(zone);

  // SeLoger n'utilise pas un simple slug régional/départemental.
  // Les URLs de recherche valides contiennent un identifiant géographique SeLoger
  // du type ad08fr18537 pour Angers ou ad06fr50 pour le Maine-et-Loire.
  const map = {
    "angers": "pays-de-la-loire/angers-49000/ad08fr18537",
    "49000": "pays-de-la-loire/angers-49000/ad08fr18537",
    "49100": "pays-de-la-loire/angers-49000/ad08fr18537",

    "avrille": "pays-de-la-loire/avrille-49240/ad08fr18545",
    "avrillé": "pays-de-la-loire/avrille-49240/ad08fr18545",
    "49240": "pays-de-la-loire/avrille-49240/ad08fr18545",

    "trelaze": "pays-de-la-loire/trelaze-49800/ad08fr18888",
    "trélazé": "pays-de-la-loire/trelaze-49800/ad08fr18888",
    "49800": "pays-de-la-loire/trelaze-49800/ad08fr18888",

    "les ponts-de-ce": "pays-de-la-loire/les-ponts-de-ce-49130/ad08fr18782",
    "les ponts de ce": "pays-de-la-loire/les-ponts-de-ce-49130/ad08fr18782",
    "les ponts-de-cé": "pays-de-la-loire/les-ponts-de-ce-49130/ad08fr18782",
    "les ponts de cé": "pays-de-la-loire/les-ponts-de-ce-49130/ad08fr18782",
    "49130": "pays-de-la-loire/les-ponts-de-ce-49130/ad08fr18782",

    "beaucouze": "pays-de-la-loire/beaucouze-49070/ad08fr18550",
    "beaucouzé": "pays-de-la-loire/beaucouze-49070/ad08fr18550",
    "49070": "pays-de-la-loire/beaucouze-49070/ad08fr18550",

    "bouchemaine": "pays-de-la-loire/bouchemaine-49080/ad08fr18568",
    "49080": "pays-de-la-loire/bouchemaine-49080/ad08fr18568",

    "saumur": "pays-de-la-loire/saumur-49400/ad08fr18863",
    "49400": "pays-de-la-loire/saumur-49400/ad08fr18863",

    "cholet": "pays-de-la-loire/cholet-49300/ad08fr18635",
    "49300": "pays-de-la-loire/cholet-49300/ad08fr18635",

    "saint-barthelemy-danjou": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",
    "saint barthelemy danjou": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",
    "saint-barthelemy-d anjou": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",
    "saint-barthelemy-d'anjou": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",
    "saint barthélemy d anjou": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",
    "49124": "pays-de-la-loire/saint-barthelemy-d-anjou-49124/ad08fr18802",

    "maine-et-loire": "pays-de-la-loire/maine-et-loire-49/ad06fr50",
    "maine et loire": "pays-de-la-loire/maine-et-loire-49/ad06fr50",
    "maine-et-loire 49": "pays-de-la-loire/maine-et-loire-49/ad06fr50",
    "49": "pays-de-la-loire/maine-et-loire-49/ad06fr50",
  };

  return map[z] || "france/ad02fr1";
}

function getSelogerPropertySegments(critere) {
  const types = (Array.isArray(critere?.types_biens) ? critere.types_biens : [])
    .map(normalizeSearchText)
    .join(" ");

  const segments = [];

  if (types.includes("immeuble")) segments.push({ segment: "immeuble", label: "immeuble" });
  if (types.includes("maison")) segments.push({ segment: "maison", label: "maison" });
  if (types.includes("appartement")) segments.push({ segment: "appartement", label: "appartement" });

  if (!segments.length) segments.push({ segment: "immobilier", label: "immobilier" });

  // On évite les doublons en conservant l'ordre métier : immeuble > maison > appartement > immobilier.
  const seen = new Set();
  return segments.filter((item) => {
    if (seen.has(item.segment)) return false;
    seen.add(item.segment);
    return true;
  });
}

function buildSelogerSearchUrl({ zone, critere, propertySegment = "immobilier" }) {
  const location = selogerLocationSlug(zone);
  const property = propertySegment || "immobilier";
  const base = `https://www.seloger.com/recherche/achat/${property}/${location}`;

  // IMPORTANT : les filtres SeLoger sont principalement pilotés par l'interface
  // et les URLs publiques fiables sont surtout structurées par transaction / type / localité.
  // On garde donc une URL canonique qui ouvre des annonces, puis l'utilisateur affine dans SeLoger.
  return base;
}

function generateSelogerSearchesForCritere(critere) {
  const zonesRaw = Array.isArray(critere?.zones) ? critere.zones : [];
  const zones = zonesRaw.length ? zonesRaw : ["Maine-et-Loire"];
  const propertySegments = getSelogerPropertySegments(critere);
  const searches = [];

  for (const zone of zones.slice(0, 8)) {
    for (const property of propertySegments) {
      searches.push({
        critere_id: critere.id,
        nom: critere.nom,
        portal: "seloger",
        source: "seloger_assiste",
        zone: zone || "Maine-et-Loire",
        type: "canonique",
        property_segment: property.segment,
        label: `${critere.nom} — SeLoger — ${zone || "Maine-et-Loire"} — ${property.label}`,
        url: buildSelogerSearchUrl({ zone, critere, propertySegment: property.segment }),
      });
    }
  }

  return uniqueByUrl(searches).slice(0, 40);
}

function generatePortalSearches(criteres = [], critereId = null) {
  const active = (Array.isArray(criteres) ? criteres : [])
    .filter((critere) => critere?.actif !== false)
    .filter((critere) => !critereId || critere.id === critereId);

  const all = [];
  for (const critere of active) {
    if (shouldGenerateLeboncoin(critere)) {
      all.push(...generateLeboncoinSearchesForCritere(critere).map((item) => ({ ...item, portal: "leboncoin", source: "leboncoin_assiste", label: item.label?.includes("Leboncoin") ? item.label : `${item.label} · Leboncoin` })));
    }
    if (shouldGenerateSeloger(critere)) {
      all.push(...generateSelogerSearchesForCritere(critere));
    }
  }

  return uniqueByUrl(all).slice(0, 160);
}


function extractUrlsFromText(value) {
  const matches = String(value || "").match(/https?:\/\/[^\s,;]+/g) || [];
  return Array.from(new Set(matches.map((url) => url.trim()).filter(Boolean)));
}

function getExternalIdFromUrl(url) {
  const raw = String(url || "");
  const match = raw.match(/(?:\/|=)(\d{7,})(?:[.?/&]|$)/);
  return match ? match[1] : raw;
}

function getTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastUseful = [...parts].reverse().find((part) => !/^\d+/.test(part) && part !== "ventes_immobilieres" && part !== "recherche");
    if (!lastUseful) return "Annonce importée Leboncoin";
    return decodeURIComponent(lastUseful)
      .replace(/[-_]+/g, " ")
      .replace(/\.htm.*$/i, "")
      .trim()
      .replace(/^./, (c) => c.toUpperCase()) || "Annonce importée Leboncoin";
  } catch {
    return "Annonce importée Leboncoin";
  }
}


function cleanCapturedAnnonceFields(raw = {}, fallbackTitle = "Annonce importée Leboncoin") {
  const out = {};

  const setText = (field, value) => {
    const clean = String(value || "").trim();
    if (clean) out[field] = clean;
  };

  const setNumber = (field, value) => {
    const n = parseNumber(value);
    if (n !== null) out[field] = n;
  };

  setText("titre", raw.titre || raw.title || fallbackTitle);
  setText("description", raw.description);
  setText("ville", raw.ville || raw.city);
  setText("code_postal", raw.code_postal || raw.postal_code);
  setText("adresse", raw.adresse || raw.address);
  setText("type_bien", raw.type_bien || raw.property_type);
  setText("dpe", raw.dpe);
  setText("ges", raw.ges);
  setText("vendeur_type", raw.vendeur_type || raw.seller_type);
  setText("url_photo", raw.url_photo || raw.image || raw.photo);

  setNumber("prix", raw.prix || raw.price);
  setNumber("surface_m2", raw.surface_m2 || raw.surface);
  setNumber("nb_pieces", raw.nb_pieces || raw.rooms);
  setNumber("nb_chambres", raw.nb_chambres || raw.bedrooms);

  return out;
}

function computeSourcingAnalysis(annonce) {
  const text = `${safeText(annonce?.titre)} ${safeText(annonce?.description)}`;

  const detectedPositive = POSITIVE_KEYWORDS.filter((keyword) =>
    text.includes(keyword.toLowerCase())
  );
  const detectedNegative = NEGATIVE_KEYWORDS.filter((keyword) =>
    text.includes(keyword.toLowerCase())
  );

  const prix = Number(annonce?.prix || 0);
  const surface = Number(annonce?.surface_m2 || 0);
  const prixM2 = prix > 0 && surface > 0 ? prix / surface : null;

  let score = 0;
  const pointsForts = [];
  const pointsFaibles = [];

  if (prixM2 && prixM2 < 1400) {
    score += 25;
    pointsForts.push("Prix au m² potentiellement très intéressant");
  } else if (prixM2 && prixM2 < 2000) {
    score += 18;
    pointsForts.push("Prix au m² intéressant à vérifier avec le marché local");
  } else if (prixM2 && prixM2 < 2500) {
    score += 10;
  } else {
    pointsFaibles.push("Prix au m² à vérifier");
  }

  const ville = safeText(annonce?.ville);
  if (
    ville.includes("angers") ||
    ville.includes("avrillé") ||
    ville.includes("avrille") ||
    ville.includes("trélazé") ||
    ville.includes("trelaze") ||
    ville.includes("ponts-de-cé") ||
    ville.includes("ponts de ce") ||
    ville.includes("maine-et-loire")
  ) {
    score += 15;
    pointsForts.push("Localisation cohérente avec la zone Profero Invest");
  } else if (ville) {
    score += 7;
  }

  const travauxKeywords = ["travaux", "à rénover", "a renover", "rénovation", "renovation", "ancien", "rafraîchir", "rafraichir"];
  if (travauxKeywords.some((keyword) => text.includes(keyword))) {
    score += 15;
    pointsForts.push("Présence de travaux ou rénovation permettant une création de valeur");
  }

  const divisionKeywords = ["division", "divisible", "plusieurs logements", "immeuble", "plateau", "combles", "grenier", "dépendance", "dependance"];
  if (divisionKeywords.some((keyword) => text.includes(keyword))) {
    score += 15;
    pointsForts.push("Potentiel de division ou de création de lots à étudier");
  } else if (surface >= 120) {
    score += 8;
    pointsForts.push("Surface importante pouvant permettre une réflexion de division");
  }

  if (
    text.includes("rentabilité") ||
    text.includes("rentabilite") ||
    text.includes("investisseur") ||
    text.includes("colocation") ||
    text.includes("coliving") ||
    text.includes("vendu loué") ||
    text.includes("vendu loue")
  ) {
    score += 15;
    pointsForts.push("Annonce orientée investisseur ou potentiel locatif");
  } else if (surface >= 80) {
    score += 7;
  }

  if (
    text.includes("immeuble") ||
    text.includes("local commercial") ||
    text.includes("plusieurs logements") ||
    text.includes("fort potentiel")
  ) {
    score += 10;
    pointsForts.push("Typologie rare ou recherchée");
  }

  const propertyAge = daysBetween(annonce?.first_seen_property_at || annonce?.premiere_detection || annonce?.created_at);
  if (propertyAge !== null && propertyAge >= 45) {
    score += 8;
    pointsForts.push(`Bien déjà exposé depuis ${propertyAge} jours : potentiel de négociation à vérifier`);
  } else if (propertyAge !== null && propertyAge >= 22) {
    score += 4;
    pointsForts.push(`Bien déjà en marché depuis ${propertyAge} jours`);
  }

  if (isRelistedAnnonce(annonce)) {
    score += 6;
    pointsForts.push("Annonce probablement remise en ligne : signal de négociation ou de difficulté à vendre");
  }

  if (Number(annonce?.matching_confidence || 0) >= 70 && Number(annonce?.matching_confidence || 0) < 85) {
    pointsFaibles.push(`Doublon possible à vérifier manuellement : similarité ${Math.round(Number(annonce.matching_confidence))}%`);
  }

  if (detectedNegative.length > 0) {
    const malus = Math.min(20, detectedNegative.length * 8);
    score -= malus;
    pointsFaibles.push(`Points de vigilance détectés : ${detectedNegative.join(", ")}`);
  }

  if (!prix) pointsFaibles.push("Prix absent ou non renseigné");
  if (!surface) pointsFaibles.push("Surface absente ou non renseignée");
  if (!annonce?.description) pointsFaibles.push("Description insuffisante");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const categorie = getCategory(score);

  return {
    score_opportunite: score,
    categorie,
    mots_cles_detectes: detectedPositive,
    points_forts: pointsForts.length ? pointsForts : ["Bien à analyser manuellement"],
    points_faibles: pointsFaibles.length ? pointsFaibles : ["Aucun point bloquant détecté automatiquement"],
    commentaire_analyse:
      score >= 65
        ? "Bien intéressant pour Profero Invest. À qualifier rapidement : état technique, divisibilité, règlement d’urbanisme, potentiel locatif, ancienneté réelle et marge de négociation."
        : "Bien à surveiller ou à analyser manuellement avant décision.",
  };
}

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getStyles(T) {
  const border = T?.border || "rgba(148,163,184,0.25)";
  const card = T?.card || "#ffffff";
  const text = T?.text || "#0f172a";
  const textSub = T?.textSub || "#64748b";
  const accent = T?.accent || "#b8892f";
  const accentBg = T?.accentBg || "rgba(184,137,47,0.14)";
  const inputBg = T?.inputBg || "rgba(148,163,184,0.08)";

  const cardStyle = {
    border: `1px solid ${border}`,
    background: card,
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 8px 30px rgba(15,23,42,0.06)",
  };

  const inputStyle = {
    width: "100%",
    border: `1px solid ${border}`,
    background: card,
    color: text,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    outline: "none",
  };

  const buttonPrimary = {
    border: "none",
    borderRadius: 999,
    padding: "10px 16px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 900,
    background: text,
    color: card,
  };

  const buttonSecondary = {
    border: "none",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 850,
    background: inputBg,
    color: textSub,
  };

  return { border, card, text, textSub, accent, accentBg, inputBg, cardStyle, inputStyle, buttonPrimary, buttonSecondary };
}

function Pill({ children, bg, color }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "5px 10px",
      fontSize: 12,
      fontWeight: 850,
      background: bg || "rgba(148,163,184,0.14)",
      color: color || "#475569",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, T }) {
  const S = getStyles(T);
  return (
    <div style={S.cardStyle}>
      <div style={{ fontSize: 13, color: S.textSub }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: S.text }}>{value}</div>
    </div>
  );
}

function Field({ label, children, T }) {
  const S = getStyles(T);
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block",
        marginBottom: 6,
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: 0.7,
        textTransform: "uppercase",
        color: S.textSub,
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function Sourcing({ profil, T }) {
  const S = getStyles(T);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [annonces, setAnnonces] = useState([]);
  const [criteres, setCriteres] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterStatut, setFilterStatut] = useState("tous");
  const [filterSearch, setFilterSearch] = useState("");
  const [newAnnonce, setNewAnnonce] = useState(EMPTY_ANNONCE);
  const [savingCritere, setSavingCritere] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collecteMessage, setCollecteMessage] = useState("");
  const [collecteUrls, setCollecteUrls] = useState([]);
  const [importUrlsText, setImportUrlsText] = useState("");
  const [importingUrls, setImportingUrls] = useState(false);
  const [capturingId, setCapturingId] = useState(null);
  const [editingAnnonce, setEditingAnnonce] = useState(null);
  const [editingAnnonceForm, setEditingAnnonceForm] = useState(null);
  const [editingAnnonceRawText, setEditingAnnonceRawText] = useState("");
  const [savingEditingAnnonce, setSavingEditingAnnonce] = useState(false);
  const [editingCritereId, setEditingCritereId] = useState(null);
  const [critereForm, setCritereForm] = useState(EMPTY_CRITERE);

  async function loadData() {
    setLoading(true);

    const [annoncesRes, criteresRes, logsRes] = await Promise.all([
      supabase
        .from("sourcing_annonces")
        .select("*")
        .eq("is_archived", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("sourcing_criteres")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("sourcing_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (annoncesRes.error) console.error("Erreur chargement sourcing_annonces", annoncesRes.error);
    if (criteresRes.error) console.error("Erreur chargement sourcing_criteres", criteresRes.error);
    if (logsRes.error) console.error("Erreur chargement sourcing_logs", logsRes.error);

    setAnnonces(annoncesRes.data || []);
    setCriteres(criteresRes.data || []);
    setLogs(logsRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const total = annonces.length;
    const hot = annonces.filter((a) => ["A+", "A"].includes(a.categorie)).length;
    const drops = annonces.filter((a) => hasPriceDrop(a)).length;
    const toContact = annonces.filter((a) => a.statut === "a_contacter").length;
    const old = annonces.filter((a) => {
      const d = daysBetween(a.first_seen_property_at || a.premiere_detection || a.created_at);
      return d !== null && d >= 45;
    }).length;
    const top = [...annonces]
      .sort((a, b) => Number(b.score_opportunite || 0) - Number(a.score_opportunite || 0))
      .slice(0, 10);
    return { total, hot, drops, toContact, old, top };
  }, [annonces]);

  const filteredAnnonces = useMemo(() => {
    const search = safeText(filterSearch);
    return annonces.filter((a) => {
      if (filterStatut !== "tous" && a.statut !== filterStatut) return false;
      if (!search) return true;
      const haystack = safeText(`${a.titre || ""} ${a.description || ""} ${a.ville || ""} ${a.code_postal || ""}`);
      return haystack.includes(search);
    });
  }, [annonces, filterSearch, filterStatut]);

  function updateAnnonceField(field, value) {
    setNewAnnonce((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreateAnnonce(e) {
    e.preventDefault();
    if (!String(newAnnonce.titre || "").trim()) {
      alert("Merci d’indiquer au minimum un titre.");
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      ...newAnnonce,
      source: newAnnonce.source_url ? detectSourceFromUrl(newAnnonce.source_url) : (newAnnonce.source || "manual"),
      prix: parseNumber(newAnnonce.prix),
      surface_m2: parseNumber(newAnnonce.surface_m2),
      nb_pieces: parseNumber(newAnnonce.nb_pieces),
      premiere_detection: now,
      derniere_detection: now,
      prix_historique: newAnnonce.prix ? [{ date: now, prix: Number(newAnnonce.prix) }] : [],
      statut: "nouveau",
      is_archived: false,
    };

    const identity = buildIdentityPayload(payload, annonces, now);
    const finalPayload = { ...payload, ...identity };
    const analysis = computeSourcingAnalysis(finalPayload);
    const { error } = await supabase.from("sourcing_annonces").insert({ ...finalPayload, ...analysis });

    if (error) {
      console.error(error);
      alert("Erreur lors de la création de l’annonce.");
      setSaving(false);
      return;
    }

    setNewAnnonce(EMPTY_ANNONCE);
    setSaving(false);
    await loadData();
    setActiveTab("annonces");
  }

  async function handleUpdateStatut(annonce, statut) {
    const { error } = await supabase
      .from("sourcing_annonces")
      .update({ statut })
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de la mise à jour du statut.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === annonce.id ? { ...a, statut } : a)));
  }

  async function handleAnalyseAnnonce(annonce) {
    const now = new Date().toISOString();
    const identity = buildIdentityPayload(annonce, annonces, now, annonce.id);
    const enriched = { ...annonce, ...identity };
    const analysis = computeSourcingAnalysis(enriched);
    const nextStatut = annonce.statut === "nouveau" ? "a_analyser" : annonce.statut;

    const { error } = await supabase
      .from("sourcing_annonces")
      .update({ ...identity, ...analysis, statut: nextStatut })
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de l’analyse automatique.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === annonce.id ? { ...a, ...identity, ...analysis, statut: nextStatut } : a)));
    alert(`Analyse terminée : score ${analysis.score_opportunite}/100 — catégorie ${analysis.categorie}${identity.matching_confidence >= 70 ? `\nSimilarité bien existant : ${identity.matching_confidence}%` : ""}`);
  }

  async function captureAnnonceFromUrl(url) {
    const fallbackTitle = getTitleFromUrl(url);

    try {
      const { data, error } = await supabase.functions.invoke("sourcing-analyse-url", {
        body: { url },
      });

      if (error) {
        console.error("Erreur Edge Function sourcing-analyse-url", error);
        return {
          ok: false,
          message: error?.message || "La fonction de capture URL n’est pas disponible.",
          fields: { titre: fallbackTitle },
        };
      }

      if (!data?.ok) {
        return {
          ok: false,
          message: data?.message || "La capture automatique n’a pas récupéré de données exploitables.",
          fields: { titre: fallbackTitle },
        };
      }

      const fields = cleanCapturedAnnonceFields(data.data || {}, fallbackTitle);
      return {
        ok: true,
        message: data?.message || "Capture URL terminée.",
        fields,
      };
    } catch (err) {
      console.error("Capture URL impossible", err);
      return {
        ok: false,
        message: err?.message || "Capture URL impossible.",
        fields: { titre: fallbackTitle },
      };
    }
  }

  async function handleCaptureUrlAnnonce(annonce) {
    if (!annonce?.source_url) {
      alert("Cette annonce n’a pas d’URL source à capturer.");
      return;
    }

    setCapturingId(annonce.id);

    const capture = await captureAnnonceFromUrl(annonce.source_url);
    const now = new Date().toISOString();
    const merged = {
      ...annonce,
      ...capture.fields,
      derniere_detection: now,
    };
    const identity = buildIdentityPayload(merged, annonces, now, annonce.id);
    const enriched = { ...merged, ...identity };
    const analysis = computeSourcingAnalysis(enriched);

    const updatePayload = {
      ...capture.fields,
      ...identity,
      ...analysis,
      derniere_detection: now,
    };

    if (updatePayload.prix) {
      const currentHistory = Array.isArray(annonce.prix_historique) ? annonce.prix_historique : [];
      const lastPrice = Number(currentHistory[currentHistory.length - 1]?.prix || 0);
      if (Number(updatePayload.prix) > 0 && Number(updatePayload.prix) !== lastPrice) {
        updatePayload.prix_historique = [...currentHistory, { date: now, prix: Number(updatePayload.prix) }];
      }
    }

    const { error } = await supabase
      .from("sourcing_annonces")
      .update(updatePayload)
      .eq("id", annonce.id);

    setCapturingId(null);

    if (error) {
      console.error(error);
      alert("Erreur lors de la mise à jour après capture URL.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === annonce.id ? { ...a, ...updatePayload } : a)));

    alert(
      capture.ok
        ? `Capture URL terminée. Score mis à jour : ${analysis.score_opportunite}/100 — catégorie ${analysis.categorie}`
        : `Capture URL partielle : ${capture.message}

L’annonce reste modifiable manuellement.`
    );
  }

  function startEditAnnonce(annonce) {
    setEditingAnnonce(annonce);
    setEditingAnnonceRawText("");
    setEditingAnnonceForm({
      titre: annonce?.titre || "",
      source_url: annonce?.source_url || "",
      description: annonce?.description || "",
      prix: annonce?.prix ?? "",
      surface_m2: annonce?.surface_m2 ?? "",
      ville: annonce?.ville || "",
      code_postal: annonce?.code_postal || "",
      adresse: annonce?.adresse || "",
      type_bien: annonce?.type_bien || "",
      nb_pieces: annonce?.nb_pieces ?? "",
      nb_chambres: annonce?.nb_chambres ?? "",
      dpe: annonce?.dpe || "",
      ges: annonce?.ges || "",
      vendeur_type: annonce?.vendeur_type || "inconnu",
      url_photo: annonce?.url_photo || "",
      notes: annonce?.notes || "",
    });
  }

  function closeEditAnnonce() {
    setEditingAnnonce(null);
    setEditingAnnonceForm(null);
    setEditingAnnonceRawText("");
  }

  function updateEditingAnnonceField(field, value) {
    setEditingAnnonceForm((prev) => ({ ...(prev || {}), [field]: value }));
  }

  function parseAnnonceText(rawText) {
    const raw = String(rawText || "");
    const normalized = raw.replace(/\s+/g, " ").trim();
    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const fields = {};

    const priceMatch = normalized.match(/([0-9][0-9\s.]{3,})\s*€/);
    if (priceMatch) fields.prix = priceMatch[1].replace(/[\s.]/g, "");

    const surfaceMatch = normalized.match(/([0-9]{1,4})\s*(?:m2|m²|m\u00b2)/i);
    if (surfaceMatch) fields.surface_m2 = surfaceMatch[1];

    const piecesMatch = normalized.match(/([0-9]{1,2})\s*pi[eè]ces?/i);
    if (piecesMatch) fields.nb_pieces = piecesMatch[1];

    const chambresMatch = normalized.match(/([0-9]{1,2})\s*chambres?/i);
    if (chambresMatch) fields.nb_chambres = chambresMatch[1];

    const dpeMatch = normalized.match(/DPE\s*[:\-]?\s*([A-G])/i) || normalized.match(/classe énergie\s*[:\-]?\s*([A-G])/i);
    if (dpeMatch) fields.dpe = dpeMatch[1].toUpperCase();

    const gesMatch = normalized.match(/GES\s*[:\-]?\s*([A-G])/i) || normalized.match(/classe climat\s*[:\-]?\s*([A-G])/i);
    if (gesMatch) fields.ges = gesMatch[1].toUpperCase();

    const cpVilleMatch = normalized.match(/\b(49\d{3})\b\s+([A-Za-zÀ-ÿ'\-\s]{2,40})/);
    if (cpVilleMatch) {
      fields.code_postal = cpVilleMatch[1];
      fields.ville = cpVilleMatch[2].trim().split(/\s{2,}/)[0];
    }

    if (!fields.titre && lines.length > 0) {
      const titleLine = lines.find((line) => !line.includes("€") && !/leboncoin/i.test(line) && line.length > 8) || lines[0];
      fields.titre = titleLine.slice(0, 180);
    }

    if (raw.length > 30) {
      fields.description = raw.slice(0, 6000);
    }

    return fields;
  }

  function applyRawAnnonceText() {
    const fields = parseAnnonceText(editingAnnonceRawText);
    setEditingAnnonceForm((prev) => ({ ...(prev || {}), ...fields }));
  }

  async function handleSaveEditingAnnonce() {
    if (!editingAnnonce?.id || !editingAnnonceForm) return;

    setSavingEditingAnnonce(true);

    const now = new Date().toISOString();
    const payload = {
      titre: editingAnnonceForm.titre || "Annonce importée Leboncoin",
      source_url: editingAnnonceForm.source_url || null,
      description: editingAnnonceForm.description || null,
      prix: parseNumber(editingAnnonceForm.prix),
      surface_m2: parseNumber(editingAnnonceForm.surface_m2),
      ville: editingAnnonceForm.ville || null,
      code_postal: editingAnnonceForm.code_postal || null,
      adresse: editingAnnonceForm.adresse || null,
      type_bien: editingAnnonceForm.type_bien || null,
      nb_pieces: parseNumber(editingAnnonceForm.nb_pieces),
      nb_chambres: parseNumber(editingAnnonceForm.nb_chambres),
      dpe: editingAnnonceForm.dpe || null,
      ges: editingAnnonceForm.ges || null,
      vendeur_type: editingAnnonceForm.vendeur_type || "inconnu",
      url_photo: editingAnnonceForm.url_photo || null,
      notes: editingAnnonceForm.notes || null,
      derniere_detection: now,
    };

    const merged = { ...editingAnnonce, ...payload };
    const identity = buildIdentityPayload(merged, annonces, now, editingAnnonce.id);
    const enriched = { ...merged, ...identity };
    const analysis = computeSourcingAnalysis(enriched);
    const updatePayload = { ...payload, ...identity, ...analysis };

    if (payload.prix) {
      const currentHistory = Array.isArray(editingAnnonce.prix_historique) ? editingAnnonce.prix_historique : [];
      const lastPrice = Number(currentHistory[currentHistory.length - 1]?.prix || 0);
      if (Number(payload.prix) > 0 && Number(payload.prix) !== lastPrice) {
        updatePayload.prix_historique = [...currentHistory, { date: now, prix: Number(payload.prix) }];
      }
    }

    const { error } = await supabase
      .from("sourcing_annonces")
      .update(updatePayload)
      .eq("id", editingAnnonce.id);

    setSavingEditingAnnonce(false);

    if (error) {
      console.error(error);
      alert("Erreur lors de l’enregistrement de l’annonce.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === editingAnnonce.id ? { ...a, ...updatePayload } : a)));
    closeEditAnnonce();
    alert(`Annonce enregistrée et analysée : score ${analysis.score_opportunite}/100 — catégorie ${analysis.categorie}`);
  }

  async function handleArchiveAnnonce(annonce) {
    const ok = window.confirm("Archiver cette annonce ?");
    if (!ok) return;

    const { error } = await supabase
      .from("sourcing_annonces")
      .update({ is_archived: true, statut: "archive" })
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de l’archivage.");
      return;
    }

    setAnnonces((prev) => prev.filter((a) => a.id !== annonce.id));
  }

  function updateCritereField(field, value) {
    setCritereForm((prev) => ({ ...prev, [field]: value }));
  }

  function resetCritereForm() {
    setEditingCritereId(null);
    setCritereForm(EMPTY_CRITERE);
  }

  function startEditCritere(critere) {
    setEditingCritereId(critere.id);
    setCritereForm({
      nom: critere.nom || "",
      zones: listToText(critere.zones),
      types_biens: listToText(critere.types_biens),
      prix_min: critere.prix_min ?? "",
      prix_max: critere.prix_max ?? "",
      surface_min: critere.surface_min ?? "",
      surface_max: critere.surface_max ?? "",
      pieces_min: critere.pieces_min ?? "",
      mots_cles_inclus: listToText(critere.mots_cles_inclus),
      mots_cles_exclus: listToText(critere.mots_cles_exclus),
      vendeur_type: critere.vendeur_type || "tous",
      source: critere.source || "leboncoin_direct",
      frequence: critere.frequence || "quotidien",
      actif: critere.actif !== false,
      score_min_alerte: critere.score_min_alerte ?? 65,
    });
  }

  async function handleSaveCritere(e) {
    e.preventDefault();

    if (!String(critereForm.nom || "").trim()) {
      alert("Merci d’indiquer un nom de critère.");
      return;
    }

    setSavingCritere(true);

    const payload = {
      nom: String(critereForm.nom || "").trim(),
      zones: parseTextList(critereForm.zones),
      types_biens: parseTextList(critereForm.types_biens),
      prix_min: parseNumber(critereForm.prix_min),
      prix_max: parseNumber(critereForm.prix_max),
      surface_min: parseNumber(critereForm.surface_min),
      surface_max: parseNumber(critereForm.surface_max),
      pieces_min: parseNumber(critereForm.pieces_min),
      mots_cles_inclus: parseTextList(critereForm.mots_cles_inclus),
      mots_cles_exclus: parseTextList(critereForm.mots_cles_exclus),
      vendeur_type: critereForm.vendeur_type || "tous",
      source: critereForm.source || "leboncoin_direct",
      frequence: critereForm.frequence || "quotidien",
      actif: !!critereForm.actif,
      score_min_alerte: parseNumber(critereForm.score_min_alerte) || 65,
    };

    const result = editingCritereId
      ? await supabase.from("sourcing_criteres").update(payload).eq("id", editingCritereId)
      : await supabase.from("sourcing_criteres").insert(payload);

    if (result.error) {
      console.error(result.error);
      alert("Erreur lors de l’enregistrement du critère.");
      setSavingCritere(false);
      return;
    }

    setSavingCritere(false);
    resetCritereForm();
    await loadData();
  }

  async function handleToggleCritere(critere) {
    const { error } = await supabase
      .from("sourcing_criteres")
      .update({ actif: !critere.actif })
      .eq("id", critere.id);

    if (error) {
      console.error(error);
      alert("Erreur lors du changement de statut du critère.");
      return;
    }

    setCriteres((prev) => prev.map((c) => c.id === critere.id ? { ...c, actif: !critere.actif } : c));
  }

  async function handleDeleteCritere(critere) {
    const ok = window.confirm(`Supprimer le critère « ${critere.nom} » ?`);
    if (!ok) return;

    const { error } = await supabase
      .from("sourcing_criteres")
      .delete()
      .eq("id", critere.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de la suppression du critère.");
      return;
    }

    if (editingCritereId === critere.id) resetCritereForm();
    setCriteres((prev) => prev.filter((c) => c.id !== critere.id));
  }

  async function handleRunCollecte(critereId = null) {
    if (collecting) return;

    setCollecting(true);
    setCollecteUrls([]);
    setCollecteMessage(critereId ? "Génération des recherches du critère..." : "Génération des recherches portails...");

    const urls = generatePortalSearches(criteres, critereId);
    setCollecteUrls(urls);
    setCollecteMessage(`${urls.length} recherche(s) générée(s) sur les portails. Ouvre les liens, repère les annonces intéressantes, puis importe leurs URLs dans Profero.`);
    setActiveTab("recherches");
    setCollecting(false);

    await supabase.from("sourcing_logs").insert({
      source: "multi_sources",
      statut: "generated",
      nb_detectees: urls.length,
      nb_nouvelles: 0,
      nb_mises_a_jour: 0,
      nb_doublons: 0,
      nb_erreurs: 0,
      message: `${urls.length} recherche(s) portails générée(s) depuis Profero.`,
      details: { mode: "generation_locale", urls_recherche: urls },
    });

    await loadData();
  }

  async function handleImportUrls(e) {
    e.preventDefault();

    const urls = extractUrlsFromText(importUrlsText).filter((url) => {
      const low = String(url || "").toLowerCase();
      return low.includes("leboncoin.fr") || low.includes("seloger.com");
    });

    if (urls.length === 0) {
      alert("Colle au moins une URL Leboncoin ou SeLoger valide.");
      return;
    }

    setImportingUrls(true);

    const existingRes = await supabase
      .from("sourcing_annonces")
      .select("source_url")
      .in("source_url", urls);

    if (existingRes.error) {
      console.error(existingRes.error);
      alert("Erreur lors de la vérification des doublons.");
      setImportingUrls(false);
      return;
    }

    const existingUrls = new Set((existingRes.data || []).map((item) => item.source_url));
    const urlsToInsert = urls.filter((url) => !existingUrls.has(url));

    if (urlsToInsert.length === 0) {
      await supabase.from("sourcing_logs").insert({
        source: "url_manual",
        statut: "duplicate",
        ended_at: new Date().toISOString(),
        nb_detectees: urls.length,
        nb_nouvelles: 0,
        nb_doublons: urls.length,
        message: "Toutes les URLs collées existent déjà dans le sourcing.",
        details: { urls },
      });
      setImportingUrls(false);
      setImportUrlsText("");
      await loadData();
      alert("Ces annonces sont déjà présentes dans le sourcing.");
      return;
    }

    const now = new Date().toISOString();
    const payloads = [];
    let nbCaptureOk = 0;

    for (const url of urlsToInsert) {
      const capture = await captureAnnonceFromUrl(url);
      if (capture.ok) nbCaptureOk += 1;

      const base = {
        source: detectSourceFromUrl(url),
        source_url: url,
        external_id: getExternalIdFromUrl(url),
        titre: getTitleFromUrl(url),
        description: `Annonce importée depuis une URL ${getSourceLabel(detectSourceFromUrl(url))}. Compléter les informations après ouverture de l’annonce.`,
        prix: null,
        surface_m2: null,
        ville: "",
        code_postal: "",
        type_bien: "",
        nb_pieces: null,
        vendeur_type: "inconnu",
        url_photo: "",
        premiere_detection: now,
        derniere_detection: now,
        prix_historique: [],
        statut: "a_analyser",
        is_archived: false,
      };

      const merged = {
        ...base,
        ...capture.fields,
      };

      if (merged.prix) merged.prix_historique = [{ date: now, prix: Number(merged.prix) }];

      const identity = buildIdentityPayload(merged, [...annonces, ...payloads], now);
      const finalPayload = { ...merged, ...identity };

      payloads.push({
        ...finalPayload,
        ...computeSourcingAnalysis(finalPayload),
      });
    }

    const insertRes = await supabase.from("sourcing_annonces").insert(payloads);

    if (insertRes.error) {
      console.error(insertRes.error);
      alert("Erreur lors de l’import des URLs.");
      setImportingUrls(false);
      return;
    }

    await supabase.from("sourcing_logs").insert({
      source: "url_manual",
      statut: "success",
      ended_at: now,
      nb_detectees: urls.length,
      nb_nouvelles: urlsToInsert.length,
      nb_doublons: urls.length - urlsToInsert.length,
      message: `${urlsToInsert.length} URL(s) importée(s) manuellement dans le sourcing. Capture automatique réussie pour ${nbCaptureOk} annonce(s).`,
      details: { urls, imported: urlsToInsert, nb_capture_ok: nbCaptureOk },
    });

    setImportingUrls(false);
    setImportUrlsText("");
    await loadData();
    setActiveTab("annonces");
  }

  const preview = useMemo(() => computeSourcingAnalysis({
    ...newAnnonce,
    prix: Number(newAnnonce.prix || 0),
    surface_m2: Number(newAnnonce.surface_m2 || 0),
  }), [newAnnonce]);

  const tabs = [
    { id: "dashboard", label: "Vue d’ensemble", subtitle: "Pilotage" },
    { id: "annonces", label: "Opportunités", subtitle: "Qualification" },
    { id: "recherches", label: "Recherches portails", subtitle: "Leboncoin & SeLoger" },
    { id: "import", label: "Importer des annonces", subtitle: "URLs & saisie" },
    { id: "parametres", label: "Paramètres & logs", subtitle: "Critères" },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto", color: S.text }}>
      <div style={S.cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, color: S.accent }}>
            Profero Invest
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: 0.2, color: S.text }}>
            Sourcing
          </h1>
          <p style={{ margin: 0, maxWidth: 920, fontSize: 14, lineHeight: 1.6, color: S.textSub }}>
            Radar d’opportunités immobilières destiné à détecter, analyser et qualifier les annonces intéressantes avant leur transformation en fiche bien dans le Stock de biens.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 14, marginTop: 18 }}>
        <StatCard T={T} label="Annonces détectées" value={stats.total} />
        <StatCard T={T} label="Opportunités A / A+" value={stats.hot} />
        <StatCard T={T} label="Baisses de prix" value={stats.drops} />
        <StatCard T={T} label="À contacter" value={stats.toContact} />
        <StatCard T={T} label="+45 jours" value={stats.old} />
      </div>

      <div style={{ ...S.cardStyle, marginTop: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 16, borderBottom: `1px solid ${S.border}` }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  border: `1px solid ${active ? S.accent : S.border}`,
                  borderRadius: 16,
                  padding: "10px 14px",
                  cursor: "pointer",
                  minWidth: 170,
                  textAlign: "left",
                  background: active ? S.accentBg : S.inputBg,
                  color: active ? S.accent : S.textSub,
                  transition: "all .15s ease",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 950, color: active ? S.accent : S.text }}>
                  {tab.label}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, fontWeight: 750, color: S.textSub }}>
                  {tab.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          {loading ? (
            <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none", color: S.textSub }}>
              Chargement du module Sourcing...
            </div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <DashboardTab T={T} stats={stats} setActiveTab={setActiveTab} onRunCollecte={handleRunCollecte} collecting={collecting} collecteMessage={collecteMessage} collecteUrls={collecteUrls} />
              )}

              {activeTab === "annonces" && (
                <AnnoncesTab
                  T={T}
                  annonces={filteredAnnonces}
                  filterStatut={filterStatut}
                  setFilterStatut={setFilterStatut}
                  filterSearch={filterSearch}
                  setFilterSearch={setFilterSearch}
                  onUpdateStatut={handleUpdateStatut}
                  onAnalyse={handleAnalyseAnnonce}
                  onArchive={handleArchiveAnnonce}
                  onCaptureUrl={handleCaptureUrlAnnonce}
                  onEditAnnonce={startEditAnnonce}
                  capturingId={capturingId}
                  editingAnnonce={editingAnnonce}
                  editingAnnonceForm={editingAnnonceForm}
                  editingAnnonceRawText={editingAnnonceRawText}
                  setEditingAnnonceRawText={setEditingAnnonceRawText}
                  updateEditingAnnonceField={updateEditingAnnonceField}
                  applyRawAnnonceText={applyRawAnnonceText}
                  onSaveEditingAnnonce={handleSaveEditingAnnonce}
                  onCloseEditingAnnonce={closeEditAnnonce}
                  savingEditingAnnonce={savingEditingAnnonce}
                />
              )}

              {activeTab === "recherches" && (
                <RecherchesTab
                  T={T}
                  criteres={criteres}
                  collecteMessage={collecteMessage}
                  collecteUrls={collecteUrls}
                  onRunCollecte={handleRunCollecte}
                  collecting={collecting}
                />
              )}

              {activeTab === "import" && (
                <AnalyseTab
                  T={T}
                  newAnnonce={newAnnonce}
                  updateAnnonceField={updateAnnonceField}
                  preview={preview}
                  saving={saving}
                  onSubmit={handleCreateAnnonce}
                  importUrlsText={importUrlsText}
                  setImportUrlsText={setImportUrlsText}
                  importingUrls={importingUrls}
                  onImportUrls={handleImportUrls}
                />
              )}

              {activeTab === "parametres" && (
                <ParametresLogsTab
                  T={T}
                  criteres={criteres}
                  critereForm={critereForm}
                  editingCritereId={editingCritereId}
                  savingCritere={savingCritere}
                  updateCritereField={updateCritereField}
                  onSubmit={handleSaveCritere}
                  onReset={resetCritereForm}
                  onEdit={startEditCritere}
                  onToggle={handleToggleCritere}
                  onDelete={handleDeleteCritere}
                  onRunCollecte={handleRunCollecte}
                  collecting={collecting}
                  logs={logs}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardTab({ T, stats, setActiveTab, onRunCollecte, collecting, collecteMessage, collecteUrls = [] }) {
  const S = getStyles(T);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Vue d’ensemble du sourcing</h2>
        <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: S.textSub }}>
          Cette page affiche les annonces détectées, les biens chauds, les baisses de prix et les opportunités à contacter.
        </p>
        {collecteMessage ? (
          <div style={{ marginTop: 12, border: `1px solid ${S.border}`, borderRadius: 14, padding: "10px 12px", fontSize: 13, fontWeight: 800, color: S.accent, background: S.accentBg }}>
            {collecteMessage}
          </div>
        ) : null}

        {Array.isArray(collecteUrls) && collecteUrls.length > 0 ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.6, color: S.textSub }}>
              Recherches portails générées
            </div>
            {collecteUrls.map((item, index) => (
              <div key={`${item.critere_id || index}-${item.url}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: `1px solid ${S.border}`, borderRadius: 14, padding: "10px 12px", background: S.cardBg }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Pill bg={S.accentBg} color={S.accent}>{item.portal === "seloger" ? "SeLoger" : "Leboncoin"}</Pill><span style={{ fontSize: 13, fontWeight: 900, color: S.text }}>{item.label || item.nom || `Recherche ${index + 1}`}</span></div>
                  <div style={{ marginTop: 2, fontSize: 12, color: S.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 760 }}>{item.url}</div>
                </div>
                <a href={item.url} target="_blank" rel="noreferrer" style={{ ...S.buttonPrimary, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Ouvrir
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>Top opportunités</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setActiveTab("annonces")} style={S.buttonSecondary}>
              Voir toutes les annonces
            </button>
            <button type="button" onClick={() => onRunCollecte(null)} disabled={collecting} style={{ ...S.buttonPrimary, opacity: collecting ? 0.55 : 1 }}>
              {collecting ? "Génération..." : "Générer les recherches"}
            </button>
          </div>
        </div>

        {stats.top.length === 0 ? (
          <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>
            Aucune annonce pour le moment. Ajoute une première annonce dans l’onglet “Importer des annonces”.
          </div>
        ) : (
          <SimpleTable T={T}>
            <thead>
              <tr>
                <Th T={T}>Bien</Th>
                <Th T={T}>Source</Th>
                <Th T={T}>Ville</Th>
                <Th T={T}>Prix</Th>
                <Th T={T}>Score</Th>
                <Th T={T}>Catégorie</Th>
                <Th T={T}>Statut</Th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((a) => {
                const catStyle = getCategoryStyle(a.categorie);
                return (
                  <tr key={a.id}>
                    <Td T={T} strong>{a.titre || "Sans titre"}</Td>
                    <Td T={T}><Pill bg={S.inputBg} color={S.text}>{getSourceLabel(a.source)}</Pill></Td>
                    <Td T={T}>{a.ville || "—"}</Td>
                    <Td T={T}>{fmtEur(a.prix)}</Td>
                    <Td T={T} strong>{fmtNumber(a.score_opportunite)}/100</Td>
                    <Td T={T}><Pill bg={catStyle.bg} color={catStyle.color}>{a.categorie || "D"}</Pill></Td>
                    <Td T={T}>{STATUS_LABELS[a.statut] || a.statut || "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </SimpleTable>
        )}
      </div>
    </div>
  );
}

function AnnoncesTab({
  T,
  annonces,
  filterStatut,
  setFilterStatut,
  filterSearch,
  setFilterSearch,
  onUpdateStatut,
  onAnalyse,
  onArchive,
  onCaptureUrl,
  onEditAnnonce,
  capturingId,
  editingAnnonce,
  editingAnnonceForm,
  editingAnnonceRawText,
  setEditingAnnonceRawText,
  updateEditingAnnonceField,
  applyRawAnnonceText,
  onSaveEditingAnnonce,
  onCloseEditingAnnonce,
  savingEditingAnnonce,
}) {
  const S = getStyles(T);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Opportunités à qualifier</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: S.textSub }}>Tous les biens repérés, scorés et priorisés avant transformation en fiche bien.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Rechercher ville, titre..." style={{ ...S.inputStyle, width: 230 }} />
          <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)} style={{ ...S.inputStyle, width: 210 }}>
            <option value="tous">Tous les statuts</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {editingAnnonce && editingAnnonceForm ? (
        <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: S.text }}>Compléter l’annonce</h3>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: S.textSub }}>
                La capture directe Leboncoin peut être bloquée. Copie le texte visible de l’annonce, colle-le ci-dessous, puis clique sur “Extraire”. Tu peux aussi compléter les champs à la main.
              </p>
            </div>
            <button type="button" onClick={onCloseEditingAnnonce} style={S.buttonSecondary}>Fermer</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field T={T} label="Texte copié depuis Leboncoin">
                <textarea value={editingAnnonceRawText} onChange={(e) => setEditingAnnonceRawText(e.target.value)} style={{ ...S.inputStyle, minHeight: 150, resize: "vertical" }} placeholder="Colle ici le titre, prix, surface, ville et description copiés depuis l’annonce..." />
              </Field>
              <button type="button" onClick={applyRawAnnonceText} style={{ ...S.buttonPrimary, alignSelf: "flex-start" }}>Extraire depuis le texte</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field T={T} label="Titre"><input value={editingAnnonceForm.titre || ""} onChange={(e) => updateEditingAnnonceField("titre", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="URL source"><input value={editingAnnonceForm.source_url || ""} onChange={(e) => updateEditingAnnonceField("source_url", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Prix"><input type="number" value={editingAnnonceForm.prix || ""} onChange={(e) => updateEditingAnnonceField("prix", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Surface m²"><input type="number" value={editingAnnonceForm.surface_m2 || ""} onChange={(e) => updateEditingAnnonceField("surface_m2", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Ville"><input value={editingAnnonceForm.ville || ""} onChange={(e) => updateEditingAnnonceField("ville", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Code postal"><input value={editingAnnonceForm.code_postal || ""} onChange={(e) => updateEditingAnnonceField("code_postal", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Type de bien"><input value={editingAnnonceForm.type_bien || ""} onChange={(e) => updateEditingAnnonceField("type_bien", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Pièces"><input type="number" value={editingAnnonceForm.nb_pieces || ""} onChange={(e) => updateEditingAnnonceField("nb_pieces", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Chambres"><input type="number" value={editingAnnonceForm.nb_chambres || ""} onChange={(e) => updateEditingAnnonceField("nb_chambres", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="DPE"><input value={editingAnnonceForm.dpe || ""} onChange={(e) => updateEditingAnnonceField("dpe", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="URL photo"><input value={editingAnnonceForm.url_photo || ""} onChange={(e) => updateEditingAnnonceField("url_photo", e.target.value)} style={S.inputStyle} /></Field>
              <Field T={T} label="Vendeur"><select value={editingAnnonceForm.vendeur_type || "inconnu"} onChange={(e) => updateEditingAnnonceField("vendeur_type", e.target.value)} style={S.inputStyle}><option value="inconnu">Inconnu</option><option value="particulier">Particulier</option><option value="pro">Professionnel</option></select></Field>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <Field T={T} label="Description"><textarea value={editingAnnonceForm.description || ""} onChange={(e) => updateEditingAnnonceField("description", e.target.value)} style={{ ...S.inputStyle, minHeight: 110, resize: "vertical" }} /></Field>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" onClick={onCloseEditingAnnonce} style={S.buttonSecondary}>Annuler</button>
            <button type="button" onClick={onSaveEditingAnnonce} disabled={savingEditingAnnonce} style={{ ...S.buttonPrimary, opacity: savingEditingAnnonce ? 0.55 : 1 }}>
              {savingEditingAnnonce ? "Enregistrement..." : "Enregistrer + analyser"}
            </button>
          </div>
        </div>
      ) : null}

      {annonces.length === 0 ? (
        <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>
          Aucune annonce ne correspond aux filtres.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${S.border}`, borderRadius: 18 }}>
          <table style={{ width: "100%", minWidth: 1540, borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: S.inputBg }}>
              <tr>
                <Th T={T}>Bien</Th>
                <Th T={T}>Source</Th>
                <Th T={T}>Ville</Th>
                <Th T={T}>Prix</Th>
                <Th T={T}>Surface</Th>
                <Th T={T}>Prix/m²</Th>
                <Th T={T}>Score</Th>
                <Th T={T}>Catégorie</Th>
                <Th T={T}>Annonce</Th>
                <Th T={T}>Bien réel</Th>
                <Th T={T}>Statut</Th>
                <Th T={T}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {annonces.map((a) => {
                const listingBadge = getListingAgeBadge(a);
                const propertyBadge = getAgeBadge(a);
                const relistBadge = getRelistBadge(a);
                const catStyle = getCategoryStyle(a.categorie);
                return (
                  <tr key={a.id} style={{ borderTop: `1px solid ${S.border}`, verticalAlign: "top" }}>
                    <Td T={T}>
                      <div style={{ display: "flex", gap: 14 }}>
                        <div style={{ width: 220, height: 150, borderRadius: 16, overflow: "hidden", background: S.inputBg, flexShrink: 0, border: `1px solid ${S.border}` }}>
                          {a.url_photo ? <img src={a.url_photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
                            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: S.textSub }}>Photo</div>
                          )}
                        </div>
                        <div>
                          <div style={{ maxWidth: 380, fontWeight: 900, color: S.text, lineHeight: 1.25 }}>{a.titre || "Sans titre"}</div>
                          {a.source_url && (
                            <a href={a.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 4, fontSize: 12, fontWeight: 850, color: S.accent, textDecoration: "none" }}>
                              Voir annonce
                            </a>
                          )}
                          {hasPriceDrop(a) && <div style={{ marginTop: 5, fontSize: 12, fontWeight: 900, color: "#b91c1c" }}>Baisse de prix détectée</div>}
                          {relistBadge ? <div style={{ marginTop: 6 }}><Pill bg={relistBadge.bg} color={relistBadge.color}>{relistBadge.label}</Pill></div> : null}
                        </div>
                      </div>
                    </Td>
                    <Td T={T}><Pill bg={S.inputBg} color={S.text}>{getSourceLabel(a.source)}</Pill></Td>
                    <Td T={T}>{a.ville || "—"}{a.code_postal ? <div style={{ fontSize: 11, color: S.textSub }}>{a.code_postal}</div> : null}</Td>
                    <Td T={T} strong>{fmtEur(a.prix)}</Td>
                    <Td T={T}>{fmtNumber(a.surface_m2)} m²</Td>
                    <Td T={T}>{fmtEur(a.prix_m2)}</Td>
                    <Td T={T} strong>{fmtNumber(a.score_opportunite)}/100</Td>
                    <Td T={T}><Pill bg={catStyle.bg} color={catStyle.color}>{a.categorie || "D"}</Pill></Td>
                    <Td T={T}><Pill bg={listingBadge.bg} color={listingBadge.color}>{listingBadge.label}</Pill></Td>
                    <Td T={T}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <Pill bg={propertyBadge.bg} color={propertyBadge.color}>{propertyBadge.label}</Pill>
                        {relistBadge ? <Pill bg={relistBadge.bg} color={relistBadge.color}>{relistBadge.label}</Pill> : null}
                      </div>
                    </Td>
                    <Td T={T}>
                      <select value={a.statut || "nouveau"} onChange={(e) => onUpdateStatut(a, e.target.value)} style={{ ...S.inputStyle, width: 160 }}>
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </Td>
                    <Td T={T}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        <button type="button" onClick={() => onEditAnnonce(a)} style={{ ...S.buttonSecondary, color: S.text, background: S.inputBg }}>Compléter</button>
                        {a.source_url ? (
                          <button
                            type="button"
                            onClick={() => onCaptureUrl(a)}
                            disabled={capturingId === a.id}
                            style={{ ...S.buttonSecondary, color: "#1d4ed8", background: "rgba(59,130,246,0.12)", opacity: capturingId === a.id ? 0.55 : 1 }}
                          >
                            {capturingId === a.id ? "Capture..." : "Capturer URL (si possible)"}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => onAnalyse(a)} style={{ ...S.buttonSecondary, color: S.accent, background: S.accentBg }}>Analyser</button>
                        <button type="button" onClick={() => alert("Prochaine étape : création automatique d’une fiche bien dans Stock de biens.")} style={S.buttonPrimary}>Créer fiche bien</button>
                        <button type="button" onClick={() => onArchive(a)} style={{ ...S.buttonSecondary, color: "#b91c1c", background: "rgba(239,68,68,0.10)" }}>Archiver</button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecherchesTab({ T, criteres, collecteMessage, collecteUrls = [], onRunCollecte, collecting }) {
  const S = getStyles(T);
  const activeCriteres = (Array.isArray(criteres) ? criteres : []).filter((c) => c.actif !== false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 18, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Recherches portails</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55, color: S.textSub }}>
            Génère les recherches Leboncoin et SeLoger depuis Profero à partir des critères actifs. La recherche large évite de trop filtrer, puis les variantes par mots-clés permettent de cibler les opportunités.
          </p>
          <button type="button" onClick={() => onRunCollecte(null)} disabled={collecting} style={{ ...S.buttonPrimary, marginTop: 14, opacity: collecting ? 0.55 : 1 }}>
            {collecting ? "Génération..." : "Générer les recherches"}
          </button>
          {collecteMessage ? (
            <div style={{ marginTop: 12, border: `1px solid ${S.border}`, borderRadius: 14, padding: "10px 12px", fontSize: 13, fontWeight: 800, color: S.accent, background: S.accentBg }}>
              {collecteMessage}
            </div>
          ) : null}
        </div>

        <div style={S.cardStyle}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>Critères actifs</h3>
          <p style={{ margin: "6px 0 14px", fontSize: 13, color: S.textSub }}>
            Ces profils servent à générer les recherches. Les réglages complets sont dans “Paramètres & logs”.
          </p>
          {activeCriteres.length === 0 ? (
            <div style={{ color: S.textSub, fontSize: 13 }}>Aucun critère actif pour le moment.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeCriteres.map((c) => (
                <div key={c.id} style={{ border: `1px solid ${S.border}`, borderRadius: 14, padding: 12, background: S.inputBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: S.text }}>{c.nom}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: S.textSub }}>
                        {getSourceLabel(c.source)} · {fmtEur(c.prix_min)} à {fmtEur(c.prix_max)} · {fmtNumber(c.surface_min)} à {fmtNumber(c.surface_max)} m²
                      </div>
                    </div>
                    <button type="button" onClick={() => onRunCollecte(c.id)} disabled={collecting} style={{ ...S.buttonSecondary, background: S.accentBg, color: S.accent, opacity: collecting ? 0.55 : 1 }}>
                      Collecter
                    </button>
                  </div>
                  {Array.isArray(c.zones) && c.zones.length > 0 && <TagList title="Zones" values={c.zones.slice(0, 6)} T={T} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={S.cardStyle}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>Liens générés</h3>
        <p style={{ margin: "6px 0 14px", fontSize: 13, lineHeight: 1.55, color: S.textSub }}>
          Ouvre les recherches une par une. Commence par les recherches larges, puis utilise les variantes par mots-clés. Ensuite, colle les URLs Leboncoin ou SeLoger intéressantes dans l’onglet “Importer des annonces”.
        </p>

        {Array.isArray(collecteUrls) && collecteUrls.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {collecteUrls.map((item, index) => (
              <div key={`${item.critere_id || index}-${item.url}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: `1px solid ${S.border}`, borderRadius: 14, padding: "11px 12px", background: S.inputBg }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Pill bg={S.accentBg} color={S.accent}>{item.portal === "seloger" ? "SeLoger" : "Leboncoin"}</Pill><span style={{ fontSize: 13, fontWeight: 900, color: S.text }}>{item.label || item.nom || `Recherche ${index + 1}`}</span></div>
                  <div style={{ marginTop: 3, fontSize: 12, color: S.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 620 }}>{item.url}</div>
                </div>
                <a href={item.url} target="_blank" rel="noreferrer" style={{ ...S.buttonPrimary, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Ouvrir
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>
            Aucune recherche générée sur cette session. Clique sur “Générer les recherches”.
          </div>
        )}
      </div>
    </div>
  );
}

function ParametresLogsTab(props) {
  const { T, logs } = props;
  const S = getStyles(T);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Paramètres & logs</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55, color: S.textSub }}>
          Regroupe la création des critères de recherche et l’historique technique des collectes/imports.
        </p>
      </div>

      <CriteresTab {...props} />
      <LogsTab T={T} logs={logs} />
    </div>
  );
}

function CriteresTab({
  T,
  criteres,
  critereForm,
  editingCritereId,
  savingCritere,
  updateCritereField,
  onSubmit,
  onReset,
  onEdit,
  onToggle,
  onDelete,
  onRunCollecte,
  collecting,
}) {
  const S = getStyles(T);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 18, alignItems: "start" }}>
      <form onSubmit={onSubmit} style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>
              {editingCritereId ? "Modifier un critère" : "Créer un critère"}
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: S.textSub }}>
              Les valeurs multiples se saisissent avec des virgules : zones, types de biens et mots-clés.
            </p>
          </div>

          {editingCritereId && (
            <button type="button" onClick={onReset} style={S.buttonSecondary}>
              Nouveau
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Nom du profil" T={T}>
            <input value={critereForm.nom} onChange={(e) => updateCritereField("nom", e.target.value)} style={S.inputStyle} placeholder="Immeubles Angers" />
          </Field>

          <Field label="Zones" T={T}>
            <input value={critereForm.zones} onChange={(e) => updateCritereField("zones", e.target.value)} style={S.inputStyle} placeholder="Angers, Avrillé, Trélazé, Maine-et-Loire" />
          </Field>

          <Field label="Types de biens" T={T}>
            <input value={critereForm.types_biens} onChange={(e) => updateCritereField("types_biens", e.target.value)} style={S.inputStyle} placeholder="immeuble, maison, appartement" />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <Field label="Prix minimum" T={T}>
              <input type="number" value={critereForm.prix_min} onChange={(e) => updateCritereField("prix_min", e.target.value)} style={S.inputStyle} placeholder="50000" />
            </Field>
            <Field label="Prix maximum" T={T}>
              <input type="number" value={critereForm.prix_max} onChange={(e) => updateCritereField("prix_max", e.target.value)} style={S.inputStyle} placeholder="500000" />
            </Field>
            <Field label="Surface minimum" T={T}>
              <input type="number" value={critereForm.surface_min} onChange={(e) => updateCritereField("surface_min", e.target.value)} style={S.inputStyle} placeholder="80" />
            </Field>
            <Field label="Surface maximum" T={T}>
              <input type="number" value={critereForm.surface_max} onChange={(e) => updateCritereField("surface_max", e.target.value)} style={S.inputStyle} placeholder="500" />
            </Field>
            <Field label="Pièces minimum" T={T}>
              <input type="number" value={critereForm.pieces_min} onChange={(e) => updateCritereField("pieces_min", e.target.value)} style={S.inputStyle} placeholder="4" />
            </Field>
            <Field label="Score minimum alerte" T={T}>
              <input type="number" value={critereForm.score_min_alerte} onChange={(e) => updateCritereField("score_min_alerte", e.target.value)} style={S.inputStyle} placeholder="65" />
            </Field>
          </div>

          <Field label="Mots-clés inclus" T={T}>
            <textarea value={critereForm.mots_cles_inclus} onChange={(e) => updateCritereField("mots_cles_inclus", e.target.value)} style={{ ...S.inputStyle, minHeight: 76, resize: "vertical" }} placeholder="travaux, à rénover, immeuble, division possible" />
          </Field>

          <Field label="Mots-clés exclus" T={T}>
            <textarea value={critereForm.mots_cles_exclus} onChange={(e) => updateCritereField("mots_cles_exclus", e.target.value)} style={{ ...S.inputStyle, minHeight: 70, resize: "vertical" }} placeholder="viager, terrain seul, mobil-home" />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <Field label="Vendeur" T={T}>
              <select value={critereForm.vendeur_type} onChange={(e) => updateCritereField("vendeur_type", e.target.value)} style={S.inputStyle}>
                <option value="tous">Tous</option>
                <option value="particulier">Particulier</option>
                <option value="pro">Professionnel</option>
              </select>
            </Field>
            <Field label="Source" T={T}>
              <select value={critereForm.source} onChange={(e) => updateCritereField("source", e.target.value)} style={S.inputStyle}>
                <option value="multi_sources">Toutes sources</option>
                <option value="leboncoin_direct">Leboncoin</option>
                <option value="seloger_direct">SeLoger</option>
                <option value="manual">Manuel</option>
                <option value="email_alert">Alerte email</option>
                <option value="csv">CSV</option>
              </select>
            </Field>
            <Field label="Fréquence" T={T}>
              <select value={critereForm.frequence} onChange={(e) => updateCritereField("frequence", e.target.value)} style={S.inputStyle}>
                <option value="quotidien">Quotidien</option>
                <option value="matin_soir">Matin et soir</option>
                <option value="hebdomadaire">Hebdomadaire</option>
                <option value="manuel">Manuel</option>
              </select>
            </Field>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${S.border}`, background: S.card, borderRadius: 12, padding: "10px 12px", color: S.text, fontSize: 13, fontWeight: 800 }}>
            <input type="checkbox" checked={!!critereForm.actif} onChange={(e) => updateCritereField("actif", e.target.checked)} />
            Critère actif
          </label>

          <button type="submit" disabled={savingCritere} style={{ ...S.buttonPrimary, opacity: savingCritere ? 0.55 : 1 }}>
            {savingCritere ? "Enregistrement..." : editingCritereId ? "Enregistrer les modifications" : "Créer le critère"}
          </button>
        </div>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Critères existants</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: S.textSub }}>
            Ces profils serviront ensuite à lancer la collecte automatique des annonces et à analyser les biens détectés.
          </p>
        </div>

        {criteres.length === 0 ? (
          <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>Aucun critère trouvé.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {criteres.map((c) => (
              <div key={c.id} style={S.cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>{c.nom}</h3>
                    <p style={{ margin: "5px 0 0", fontSize: 13, color: S.textSub }}>Source : {getSourceLabel(c.source)} · Fréquence : {c.frequence || "—"}</p>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => onToggle(c)} style={{ ...S.buttonSecondary, background: c.actif ? "rgba(34,197,94,0.12)" : S.inputBg, color: c.actif ? "#15803d" : S.textSub }}>
                      {c.actif ? "Actif" : "Inactif"}
                    </button>
                    <button type="button" onClick={() => onRunCollecte(c.id)} disabled={collecting || c.actif === false} style={{ ...S.buttonSecondary, background: S.accentBg, color: S.accent, opacity: (collecting || c.actif === false) ? 0.55 : 1 }}>
                      {collecting ? "Collecte..." : "Collecter"}
                    </button>
                    <button type="button" onClick={() => onEdit(c)} style={{ ...S.buttonSecondary, background: "rgba(59,130,246,0.12)", color: "#1d4ed8" }}>
                      Modifier
                    </button>
                    <button type="button" onClick={() => onDelete(c)} style={{ ...S.buttonSecondary, background: "rgba(239,68,68,0.12)", color: "#b91c1c" }}>
                      Supprimer
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 16, fontSize: 13, color: S.textSub }}>
                  <div>Prix : {fmtEur(c.prix_min)} à {fmtEur(c.prix_max)}</div>
                  <div>Surface : {fmtNumber(c.surface_min)} à {fmtNumber(c.surface_max)} m²</div>
                  <div>Pièces min : {fmtNumber(c.pieces_min)}</div>
                  <div>Score alerte : {fmtNumber(c.score_min_alerte)}/100</div>
                </div>

                {Array.isArray(c.zones) && c.zones.length > 0 && <TagList title="Zones" values={c.zones} T={T} />}
                {Array.isArray(c.types_biens) && c.types_biens.length > 0 && <TagList title="Types de biens" values={c.types_biens} T={T} />}
                {Array.isArray(c.mots_cles_inclus) && c.mots_cles_inclus.length > 0 && <TagList title="Mots-clés inclus" values={c.mots_cles_inclus} T={T} />}
                {Array.isArray(c.mots_cles_exclus) && c.mots_cles_exclus.length > 0 && <TagList title="Mots-clés exclus" values={c.mots_cles_exclus} T={T} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyseTab({ T, newAnnonce, updateAnnonceField, preview, saving, onSubmit, importUrlsText, setImportUrlsText, importingUrls, onImportUrls }) {
  const S = getStyles(T);
  const catStyle = getCategoryStyle(preview.categorie);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <form onSubmit={onSubmit} style={S.cardStyle}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Ajouter une annonce manuellement</h2>
        <p style={{ margin: "6px 0 18px", fontSize: 13, color: S.textSub }}>
          Complète les informations essentielles d’une annonce repérée pour obtenir immédiatement un score d’opportunité.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <Field label="Titre" T={T}><input value={newAnnonce.titre} onChange={(e) => updateAnnonceField("titre", e.target.value)} style={S.inputStyle} placeholder="Maison à rénover avec dépendance" /></Field>
          <Field label="Lien source" T={T}><input value={newAnnonce.source_url} onChange={(e) => updateAnnonceField("source_url", e.target.value)} style={S.inputStyle} placeholder="https://www.leboncoin.fr/... ou https://www.seloger.com/..." /></Field>
          <Field label="Prix" T={T}><input type="number" value={newAnnonce.prix} onChange={(e) => updateAnnonceField("prix", e.target.value)} style={S.inputStyle} placeholder="180000" /></Field>
          <Field label="Surface m²" T={T}><input type="number" value={newAnnonce.surface_m2} onChange={(e) => updateAnnonceField("surface_m2", e.target.value)} style={S.inputStyle} placeholder="150" /></Field>
          <Field label="Ville" T={T}><input value={newAnnonce.ville} onChange={(e) => updateAnnonceField("ville", e.target.value)} style={S.inputStyle} placeholder="Angers" /></Field>
          <Field label="Code postal" T={T}><input value={newAnnonce.code_postal} onChange={(e) => updateAnnonceField("code_postal", e.target.value)} style={S.inputStyle} placeholder="49000" /></Field>
          <Field label="Type de bien" T={T}><input value={newAnnonce.type_bien} onChange={(e) => updateAnnonceField("type_bien", e.target.value)} style={S.inputStyle} placeholder="Maison / Immeuble / Appartement" /></Field>
          <Field label="Nombre de pièces" T={T}><input type="number" value={newAnnonce.nb_pieces} onChange={(e) => updateAnnonceField("nb_pieces", e.target.value)} style={S.inputStyle} placeholder="6" /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="URL photo principale" T={T}><input value={newAnnonce.url_photo} onChange={(e) => updateAnnonceField("url_photo", e.target.value)} style={S.inputStyle} placeholder="https://..." /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Description" T={T}>
            <textarea value={newAnnonce.description} onChange={(e) => updateAnnonceField("description", e.target.value)} style={{ ...S.inputStyle, minHeight: 140, resize: "vertical" }} placeholder="Description de l’annonce..." />
          </Field>
        </div>

        <button type="submit" disabled={saving} style={{ ...S.buttonPrimary, marginTop: 16, opacity: saving ? 0.55 : 1 }}>
          {saving ? "Enregistrement..." : "Ajouter et analyser"}
        </button>
      </form>

      <form onSubmit={onImportUrls} style={S.cardStyle}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Importer des URLs d’annonces</h2>
        <p style={{ margin: "6px 0 14px", fontSize: 13, lineHeight: 1.6, color: S.textSub }}>
          Colle une ou plusieurs URLs Leboncoin ou SeLoger repérées depuis les recherches assistées. L’application crée les lignes dans le sourcing et les marque “À analyser”.
        </p>

        <Field label="URLs d’annonces" T={T}>
          <textarea
            value={importUrlsText}
            onChange={(e) => setImportUrlsText(e.target.value)}
            style={{ ...S.inputStyle, minHeight: 115, resize: "vertical" }}
            placeholder={"https://www.leboncoin.fr/ad/ventes_immobilieres/...\nhttps://www.leboncoin.fr/ad/ventes_immobilieres/..."}
          />
        </Field>

        <button type="submit" disabled={importingUrls} style={{ ...S.buttonPrimary, marginTop: 14, opacity: importingUrls ? 0.55 : 1 }}>
          {importingUrls ? "Import en cours..." : "Importer les URLs"}
        </button>
      </form>
      </div>

      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Aperçu analyse automatique</h3>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 44, fontWeight: 950, color: S.text }}>{preview.score_opportunite}</div>
          <div>
            <div style={{ fontSize: 13, color: S.textSub }}>Score opportunité</div>
            <div style={{ marginTop: 5 }}><Pill bg={catStyle.bg} color={catStyle.color}>Catégorie {preview.categorie}</Pill></div>
          </div>
        </div>

        <AnalysisBlock T={T} title="Mots-clés détectés" items={preview.mots_cles_detectes} empty="Aucun mot-clé détecté" />
        <AnalysisBlock T={T} title="Points forts" items={preview.points_forts} />
        <AnalysisBlock T={T} title="Points faibles" items={preview.points_faibles} />
      </div>
    </div>
  );
}

function LogsTab({ T, logs }) {
  const S = getStyles(T);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Historique et logs</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: S.textSub }}>Cette zone affiche les générations de recherches portails, les imports et les tentatives de collecte.</p>
      </div>
      {logs.length === 0 ? (
        <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>Aucun log pour le moment.</div>
      ) : (
        <SimpleTable T={T}>
          <thead>
            <tr>
              <Th T={T}>Date</Th>
              <Th T={T}>Source</Th>
              <Th T={T}>Statut</Th>
              <Th T={T}>Détectées</Th>
              <Th T={T}>Nouvelles</Th>
              <Th T={T}>Message</Th>
              <Th T={T}>Action</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const searchUrl = getLogSearchUrl(log);
              return (
                <tr key={log.id}>
                  <Td T={T}>{log.created_at ? new Date(log.created_at).toLocaleString("fr-FR") : "—"}</Td>
                  <Td T={T}>{log.source || "—"}</Td>
                  <Td T={T} strong>{log.statut || "—"}</Td>
                  <Td T={T}>{log.nb_detectees || 0}</Td>
                  <Td T={T}>{log.nb_nouvelles || 0}</Td>
                  <Td T={T}>{log.message || "—"}</Td>
                  <Td T={T}>
                    {searchUrl ? (
                      <a href={searchUrl} target="_blank" rel="noreferrer" style={{ color: S.accent, fontWeight: 900, textDecoration: "none", whiteSpace: "nowrap" }}>
                        Ouvrir recherche
                      </a>
                    ) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function SimpleTable({ T, children }) {
  const S = getStyles(T);
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${S.border}`, borderRadius: 18 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        {children}
      </table>
    </div>
  );
}

function Th({ T, children }) {
  const S = getStyles(T);
  return (
    <th style={{
      padding: "12px 14px",
      textAlign: "left",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      color: S.textSub,
      background: S.inputBg,
      whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function Td({ T, children, strong = false }) {
  const S = getStyles(T);
  return (
    <td style={{
      padding: "12px 14px",
      borderTop: `1px solid ${S.border}`,
      color: strong ? S.text : S.textSub,
      fontWeight: strong ? 850 : 500,
      verticalAlign: "top",
    }}>
      {children}
    </td>
  );
}

function TagList({ title, values, T }) {
  const S = getStyles(T);
  const safeValues = Array.isArray(values) ? values : [];
  if (safeValues.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ marginBottom: 7, fontSize: 11, fontWeight: 900, letterSpacing: 0.7, textTransform: "uppercase", color: S.textSub }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {safeValues.map((value) => <Pill key={value} bg={S.inputBg} color={S.textSub}>{value}</Pill>)}
      </div>
    </div>
  );
}

function AnalysisBlock({ T, title, items, empty = "Aucun élément" }) {
  const S = getStyles(T);
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div style={{ marginTop: 18 }}>
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: S.text }}>{title}</h4>
      {safeItems.length === 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: S.textSub }}>{empty}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {safeItems.map((item, index) => (
            <div key={`${item}-${index}`} style={{ border: `1px solid ${S.border}`, background: S.card, borderRadius: 12, padding: "9px 11px", fontSize: 13, color: S.textSub }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
