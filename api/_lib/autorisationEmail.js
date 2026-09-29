// api/_lib/autorisationEmail.js — Qui a le droit d'envoyer quoi par
// /api/send-email.
//
// Dossier api/_lib/ : NON déployé en fonction Vercel.
//
// Pourquoi ce module
// ──────────────────
// /api/send-email était un relais ouvert : ni authentification, ni contrôle
// des destinataires, `from` libre, CORS « * ». N'importe qui pouvait envoyer
// n'importe quel mail sous l'identité Resend de Profero — l'outil idéal pour
// hameçonner les clients le jour où le portail leur écrira.
//
// La fermeture ne peut pas être un simple « JWT obligatoire » : le formulaire
// public /rapport (anonyme, lien envoyé chaque jour aux ouvriers) et tous les
// crons passent par cette route. D'où trois profils d'appelant, identifiés
// explicitement ; tout le reste est refusé.
//
//   serveur        Authorization: Bearer <CRON_SECRET>   → envoi libre
//   collaborateur  JWT Supabase + ligne `utilisateurs` active, rôle ≠ ouvrier
//                                                         → envoi libre
//   rapport        anonyme, ou ouvrier connecté          → compte rendu vers
//                  la liste blanche interne uniquement, sans pièce jointe
//
// Un compte Auth absent de `utilisateurs` (inscription sauvage) ou inactif est
// refusé : il n'a aucun droit par défaut.

const { jetonBearer, estSecretServeur } = require("./autorisationServeur");

// ─── Liste blanche du compte rendu public ────────────────────────────────────
// SEULE définition de la liste — ne pas la recopier ailleurs.
// Validée le 29/09/2026 : les deux destinataires réels de RapportMobile.jsx,
// plus matthieu.fumoleau@ (ajout demandé). RapportMobile n'envoie aujourd'hui
// qu'aux deux premières ; la troisième est autorisée, pas destinataire.
const DESTINATAIRES_RAPPORT = Object.freeze([
  "suivi.chantier@groupe-profero.com",
  "loris.bessonneau@groupe-profero.com",
  "matthieu.fumoleau@groupe-profero.com",
]);

// Le compte rendu a un sujet « CR <ouvrier> — <chantier> — <date> ».
const PREFIXE_SUJET_RAPPORT = "CR ";
// Un compte rendu fait quelques kilo-octets ; au-delà, ce n'en est pas un.
const HTML_MAX_RAPPORT = 200 * 1024;

// ─── Modes ───────────────────────────────────────────────────────────────────
// observer : aucune décision n'est appliquée, les refus sont seulement
//            journalisés (« aurait_refuse »). Phase de diagnostic.
// strict   : les refus sont appliqués.
// Variable absente ou inconnue → strict. Une configuration manquante ne doit
// jamais rouvrir la route.
function modeAutorisation(valeur = process.env.EMAIL_AUTH_MODE) {
  return String(valeur || "").trim().toLowerCase() === "observer" ? "observer" : "strict";
}

function listeAdresses(v) {
  if (v === undefined || v === null || v === "") return [];
  const brut = Array.isArray(v) ? v : [v];
  return brut.map(x => String(x || "").trim().toLowerCase()).filter(Boolean);
}

function domaine(adresse) {
  const i = adresse.lastIndexOf("@");
  return i >= 0 ? adresse.slice(i + 1) : "(invalide)";
}

// ─── Identification de l'appelant ────────────────────────────────────────────
// deps :
//   cronSecret                    secret serveur (process.env.CRON_SECRET)
//   verifierJeton(jwt)  → { email } | null      (auth.getUser, service_role)
//   chargerProfil(email) → { role, actif } | null  (table utilisateurs)
//   jwtVerifiable                 faux si la clé service_role manque
async function identifierAppelant(req, deps) {
  const jeton = jetonBearer(req);
  if (!jeton) return { type: "anonyme" };

  if (estSecretServeur(jeton, deps.cronSecret)) return { type: "serveur" };

  // Un Bearer qui n'est pas le secret serveur est lu comme un JWT Supabase.
  if (!deps.jwtVerifiable) return { type: "invalide", raison: "config_serveur_incomplete" };

  let utilisateur = null;
  try { utilisateur = await deps.verifierJeton(jeton); } catch { utilisateur = null; }
  if (!utilisateur || !utilisateur.email) return { type: "invalide", raison: "jeton_invalide" };

  const email = String(utilisateur.email).toLowerCase();
  let profil = null;
  try { profil = await deps.chargerProfil(utilisateur.email); } catch { profil = null; }
  if (!profil) return { type: "invalide", raison: "compte_hors_utilisateurs", email };
  if (!profil.actif) return { type: "invalide", raison: "compte_inactif", email };
  if (profil.role === "ouvrier") return { type: "ouvrier", email };
  return { type: "collaborateur", email, role: profil.role || null };
}

// ─── Décision ────────────────────────────────────────────────────────────────
// Renvoie { autorise, profil, raison }. `profil` dit quelle règle s'applique ;
// `raison` n'est renseignée qu'en cas de refus.
function evaluerEnvoi(appelant, corps = {}) {
  if (appelant.type === "serveur" || appelant.type === "collaborateur") {
    return { autorise: true, profil: appelant.type, raison: null };
  }
  if (appelant.type === "invalide") {
    return { autorise: false, profil: "invalide", raison: appelant.raison };
  }

  // anonyme ou ouvrier : le compte rendu vers la liste blanche, rien d'autre.
  const a = listeAdresses(corps.to);
  const copies = [...listeAdresses(corps.cc), ...listeAdresses(corps.bcc)];
  const refus = (raison) => ({ autorise: false, profil: "rapport", raison });

  if (!a.length) return refus("aucun_destinataire");
  if (copies.length) return refus("copie_interdite");
  if (a.some(x => !DESTINATAIRES_RAPPORT.includes(x))) return refus("destinataire_hors_liste");
  if (Array.isArray(corps.attachments) && corps.attachments.length) return refus("piece_jointe_interdite");
  if (!String(corps.subject || "").startsWith(PREFIXE_SUJET_RAPPORT)) return refus("sujet_non_rapport");
  if (Buffer.byteLength(String(corps.html || ""), "utf8") > HTML_MAX_RAPPORT) return refus("contenu_trop_volumineux");
  return { autorise: true, profil: "rapport", raison: null };
}

// ─── Journal ─────────────────────────────────────────────────────────────────
// MÉTADONNÉES SEULEMENT. Jamais le sujet, le corps, ni les pièces jointes ;
// des destinataires, seulement leur nombre et leurs domaines. L'adresse de
// l'appelant est journalisée pour un collaborateur (c'est son identité, pas
// le contenu de son message), jamais pour un anonyme.
function entreeJournal({ mode, appelant, decision, corps = {}, req, envoye, statutResend }) {
  const destinataires = [
    ...listeAdresses(corps.to), ...listeAdresses(corps.cc), ...listeAdresses(corps.bcc),
  ];
  let origine = null;
  try {
    const ref = req?.headers?.referer || req?.headers?.referrer;
    if (ref) origine = new URL(ref).pathname;   // chemin seul, sans requête ni fragment
  } catch { origine = null; }

  return {
    evt: "send-email",
    t: new Date().toISOString(),
    mode,
    decision: decision.autorise ? "autorise" : (mode === "observer" ? "aurait_refuse" : "refuse"),
    raison: decision.raison,
    profil: decision.profil,
    appelant: appelant.type,
    appelant_email: appelant.type === "anonyme" ? null : (appelant.email || null),
    // Étiquette posée par les appelants à jour (src/emailApi.js, crons). Son
    // absence signale un appareil resté sur un ancien bundle : c'est ce que la
    // phase d'observation doit mesurer.
    source: String(req?.headers?.["x-profero-source"] || "").slice(0, 60) || null,
    origine,
    nb_destinataires: destinataires.length,
    domaines: [...new Set(destinataires.map(domaine))].sort(),
    pieces_jointes: Array.isArray(corps.attachments) ? corps.attachments.length : 0,
    envoye: !!envoye,
    statut_resend: statutResend ?? null,
  };
}

module.exports = {
  DESTINATAIRES_RAPPORT,
  PREFIXE_SUJET_RAPPORT,
  HTML_MAX_RAPPORT,
  modeAutorisation,
  identifierAppelant,
  evaluerEnvoi,
  entreeJournal,
};
