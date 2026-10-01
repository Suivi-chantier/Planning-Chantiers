// src/Portail/portailVue.mjs — logique PURE de l'espace client (aucun accès Supabase,
// aucune horloge). Les données arrivent en paramètre : voir PortailClient.jsx.
// Tout le vocabulaire est celui du CLIENT : pas de « balle », pas de « bloquée ».

export const POPULATION_CLIENT = "client_invest";

const ETAPES = Object.freeze([
  ["signature", "Signature de la mission"], ["collecte", "Collecte de vos informations"],
  ["documents", "Vos documents"], ["analyse", "Analyse de votre situation"],
  ["strategie", "Stratégie d'investissement"], ["recherche", "Recherche de biens"],
  ["opportunites", "Opportunités"], ["financement", "Financement"],
  ["structuration", "Structuration"], ["acquisition", "Acquisition"], ["suivi", "Suivi"],
]);
const ORDRE = Object.freeze(Object.fromEntries(ETAPES.map(([cle], i) => [cle, i])));
const LIBELLE = Object.freeze(Object.fromEntries(ETAPES));

/** Libellé client d'une étape ; une clé inconnue reste lisible (jamais vide). */
export const libelleEtape = (cle) => LIBELLE[cle] ?? (cle ? String(cle).replace(/_/g, " ") : "Étape");

const STATUT_ETAPE = Object.freeze({
  a_venir: ["À venir", "neutre"], en_cours: ["En cours", "actif"], en_attente: ["En attente", "attente"],
  bloquee: ["En attente", "attente"], terminee: ["Terminée", "fait"], non_applicable: ["Sans objet", "neutre"],
});
/** [libellé, ton] ; un statut inconnu s'affiche tel quel, jamais comme « terminé ». */
export const statutEtape = (s) => STATUT_ETAPE[s] ?? [s ? String(s) : "—", "neutre"];

export const LETTRE = Object.freeze({ a_emettre: "En préparation", envoyee: "Envoyée", signee: "Signée" });
export const STATUT_DOSSIER = Object.freeze({ ouvert: "Ouvert", actif: "En cours", suspendu: "Suspendu", clos: "Terminé", abandonne: "Arrêté" });

/** Claim posée par le hook d'accès dans le jeton ; null si le jeton est illisible. */
export function populationDuJeton(accessToken) {
  try {
    const charge = String(accessToken || "").split(".")[1];
    if (!charge) return null;
    const b64 = charge.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes))?.profero_population ?? null;
  } catch { return null; }
}

export function bonjour(client) {
  const nom = String(client?.prenom || "").trim() || String(client?.nom || "").trim();
  return nom ? `Bonjour ${nom}` : "Bonjour";
}

export function etapesTriees(etapes = []) {
  return [...etapes].sort((a, b) => (ORDRE[a.etape] ?? 99) - (ORDRE[b.etape] ?? 99)).map((e) => {
    const [libelle, ton] = statutEtape(e.statut);
    return { id: e.id, cle: e.etape, titre: libelleEtape(e.etape), statut: libelle, ton, debut: e.date_debut ?? null, fin: e.date_fin ?? null };
  });
}

/**
 * Tâches : « non_concerne » (sans objet pour le client) est écartée, c'est le seul filtre.
 * À faire d'abord (échéance croissante, sans échéance en dernier), puis terminées.
 */
export function tachesClient(taches = [], aujourdhui) {
  const garde = taches.filter((t) => t.status !== "non_concerne");
  const vue = (t) => ({ id: t.id, titre: t.action_title || "Tâche", etape: t.step_label || null, echeance: t.due_date ?? null,
    faite: t.status === "fait", enRetard: t.status !== "fait" && !!t.due_date && !!aujourdhui && String(t.due_date) < aujourdhui });
  const parDate = (a, b) => String(a.echeance || "9999").localeCompare(String(b.echeance || "9999"));
  const v = garde.map(vue);
  return { aFaire: v.filter((t) => !t.faite).sort(parDate), terminees: v.filter((t) => t.faite).sort((a, b) => parDate(b, a)) };
}

/**
 * Chargement d'une section : une ERREUR n'est jamais présentée comme « vide ».
 * `reponse` = { data, error } tel que rendu par supabase-js.
 */
export function etatSection(reponse) {
  if (!reponse || reponse.error) return { etat: "erreur", lignes: [] };
  const lignes = Array.isArray(reponse.data) ? reponse.data : [];
  return { etat: lignes.length ? "ok" : "vide", lignes };
}

export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
