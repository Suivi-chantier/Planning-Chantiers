// api/_lib/autorisationServeur.js — Appels de serveur à serveur (crons).
//
// Dossier api/_lib/ : préfixé « _ », donc NON déployé en fonction Vercel.
//
// Règle de sécurité du projet : une route est interdite par défaut. Les routes
// cron testaient `if (process.env.CRON_SECRET) { … }` : si la variable
// disparaissait (projet recréé, variable renommée, environnement Preview),
// la vérification sautait et la route devenait publique — une configuration
// absente transformait une route protégée en route ouverte. Ici, l'absence du
// secret FERME la route : un cron qui échoue bruyamment vaut mieux qu'une route
// sensible accessible à tous.

const crypto = require("crypto");

// Comparaison à temps constant : une égalité `===` s'arrête au premier
// caractère différent, et la durée de la réponse renseigne alors sur le
// préfixe correct du secret.
function egaliteConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Extrait le jeton d'un en-tête « Authorization: Bearer … », ou null.
function jetonBearer(req) {
  const brut = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(brut).trim());
  return m ? m[1].trim() : null;
}

// Vrai si `jeton` est le secret serveur. Faux si le secret n'est pas
// configuré — jamais « vrai par défaut ».
function estSecretServeur(jeton, secret = process.env.CRON_SECRET) {
  if (!secret || !jeton) return false;
  return egaliteConstante(jeton, secret);
}

// Garde des routes cron. Renvoie { ok:true } ou { ok:false, status, error }.
//   secret absent    → 500 : route fermée, et la cause est dite explicitement
//   secret incorrect → 401
function verifierAppelServeur(req, secret = process.env.CRON_SECRET) {
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET non configuré côté serveur : route fermée par défaut",
    };
  }
  if (!estSecretServeur(jetonBearer(req), secret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

// En-têtes d'un appel serveur vers une route du projet (ex. les crons vers
// /api/send-email). Sans CRON_SECRET, l'en-tête d'autorisation est omis : la
// route appelée refusera, et l'échec sera visible dans le résumé du cron.
function enTetesAppelServeur(source, secret = process.env.CRON_SECRET) {
  const h = { "Content-Type": "application/json" };
  if (source) h["X-Profero-Source"] = source;
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
}

module.exports = { egaliteConstante, jetonBearer, estSecretServeur, verifierAppelServeur, enTetesAppelServeur };
