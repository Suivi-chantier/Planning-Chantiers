// ─────────────────────────────────────────────────────────────────────────────
// agendaGoogle — LE fabricant de liens « Créer l'événement Google Agenda ».
//
// Module PUR (aucune horloge, aucun réseau). Façade front : agendaGoogle.js.
// Utilisé par le Planning hebdo (bouton de chaque cellule) et par les étapes
// « visite » du cycle de vie du chantier (Refonte Opérations, lot 3) : un seul
// mécanisme, un lien Google Agenda pré-rempli que l'utilisateur ouvre et
// enregistre lui-même (rien n'est créé sans lui).
// ─────────────────────────────────────────────────────────────────────────────

export const GOOGLE_AGENDA_BASE = "https://calendar.google.com/calendar/render";
export const FUSEAU_PARIS = "Europe/Paris";

const pad = (n) => String(n).padStart(2, "0");

/** Date locale (objet Date) → « AAAAMMJJ ». */
export function dateGoogle(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * Lien d'ouverture d'un événement pré-rempli.
 *   titre    : texte de l'événement (obligatoire)
 *   debut/fin: « AAAAMMJJTHHMMSS » (heure locale, voir fuseau) ; facultatifs —
 *              sans dates, Google propose le créneau à choisir
 *   details  : description (texte, retours à la ligne permis)
 *   lieu     : adresse (Google la propose sur la carte)
 *   invites  : adresses e-mail à inviter
 */
export function lienGoogleAgenda({ titre, debut = null, fin = null, details = "", lieu = "", invites = [], fuseau = FUSEAU_PARIS } = {}) {
  const params = new URLSearchParams({ action: "TEMPLATE", text: String(titre || "").trim() || "Rendez-vous" });
  if (debut && fin) params.set("dates", `${debut}/${fin}`);
  if (details) params.set("details", String(details));
  if (lieu && String(lieu).trim()) params.set("location", String(lieu).trim());
  if (fuseau) params.set("ctz", fuseau);
  const emails = (Array.isArray(invites) ? invites : []).map((e) => String(e || "").trim()).filter(Boolean);
  if (emails.length) params.append("add", emails.join(","));
  return `${GOOGLE_AGENDA_BASE}?${params.toString()}`;
}

/**
 * Adresse d'un chantier pour le lieu de l'événement, dans l'ordre :
 * adresse géolocalisée de la fiche chantier, adresse du chiffrage rattaché
 * (adresse, code postal, ville), adresse de l'opération. → { lieu, source }
 * source = null quand aucune adresse n'est connue (l'appelant le dit).
 */
export function adresseChantierAgenda({ adresseFiche = "", projet = null, operation = null } = {}) {
  const t = (v) => String(v ?? "").trim();
  if (t(adresseFiche)) return { lieu: t(adresseFiche), source: "fiche" };
  if (projet) {
    const lieu = [t(projet.chantier_adresse) || t(projet.adresse_bien), [t(projet.chantier_code_postal), t(projet.chantier_ville)].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ");
    if (lieu) return { lieu, source: "chiffrage" };
  }
  if (operation && t(operation.adresse)) return { lieu: t(operation.adresse), source: "operation" };
  return { lieu: "", source: null };
}
