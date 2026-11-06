// supabase/functions/_partage/pushRegles.mjs
//
// Décisions PURES des Edge Functions de notifications push (push-abonnement,
// send-push). Aucun accès Supabase, aucune horloge, aucun effet de bord :
// index.ts fournit l'appelant, son profil et ses données, ce module tranche.
// Importé tel quel par Deno (index.ts) et par Node
// (scripts/verif-notifications-push.mjs).
//
// Règle 1 du projet : le rôle « ouvrier » ne reçoit aucune notification push
// et ne peut pas s'abonner. Tout est refusé par défaut : seul un utilisateur
// Auth réel, collaborateur actif (même règle que la policy
// profero_collaborateurs_seulement), avec un rôle bureau, passe.

export const ROLE_EXCLU = "ouvrier";

/** Extrait le jeton d'un en-tête Authorization « Bearer … », sinon null. */
export function extraireJeton(entete) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(entete || ""));
  return m ? m[1] : null;
}

/** Un rôle peut-il recevoir des notifications push ? (jamais l'ouvrier) */
export function roleRecoitPush(role) {
  const r = String(role || "").trim().toLowerCase();
  return r !== "" && r !== ROLE_EXCLU;
}

/**
 * Tranche sur l'appelant.
 * @param {{ appelant: {id?: string}|null, profil: {role?: string, actif?: boolean}|null, collaborateurActif: boolean }} p
 * @returns {{ autorise: true } | { autorise: false, statut: 401|403, erreur: string }}
 */
export function decisionAppelantPush({ appelant, profil, collaborateurActif } = {}) {
  if (!appelant || typeof appelant.id !== "string" || !appelant.id) {
    return { autorise: false, statut: 401, erreur: "Non authentifié." };
  }
  if (collaborateurActif !== true || !profil || profil.actif === false) {
    return { autorise: false, statut: 403, erreur: "Réservé aux collaborateurs actifs." };
  }
  if (!roleRecoitPush(profil.role)) {
    return { autorise: false, statut: 403, erreur: "Les notifications sur téléphone ne concernent pas ce rôle." };
  }
  return { autorise: true };
}

/**
 * Clés VAPID lues dans les secrets du serveur. Une clé manquante rend
 * l'impossibilité visible (503), jamais un envoi muet.
 * @param {{ publique?: string, privee?: string, sujet?: string }} env
 */
export function clesVapid({ publique, privee, sujet } = {}) {
  const p = String(publique || "").trim();
  const k = String(privee || "").trim();
  const s = String(sujet || "").trim();
  const manquantes = [];
  if (!p) manquantes.push("VAPID_PUBLIC_KEY");
  if (!k) manquantes.push("VAPID_PRIVATE_KEY");
  if (!s) manquantes.push("VAPID_SUBJECT");
  if (manquantes.length) {
    return {
      ok: false,
      statut: 503,
      code: "serveur_non_configure",
      erreur: "Clés de notification non configurées sur le serveur.",
      manquantes,
    };
  }
  return { ok: true, publique: p, privee: k, sujet: s };
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Valide un abonnement envoyé par le navigateur (PushSubscription.toJSON()).
 * @returns {{ ok: true, endpoint: string, p256dh: string, auth: string } | { ok: false, statut: 400, erreur: string }}
 */
export function validerAbonnement(corps) {
  const sub = corps?.subscription ?? corps;
  const endpoint = String(sub?.endpoint || "").trim();
  const p256dh = String(sub?.keys?.p256dh || "").trim();
  const auth = String(sub?.keys?.auth || "").trim();
  if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 2000) {
    return { ok: false, statut: 400, erreur: "Adresse d'abonnement invalide." };
  }
  if (!B64URL.test(p256dh) || p256dh.length < 40 || p256dh.length > 200) {
    return { ok: false, statut: 400, erreur: "Clé d'abonnement invalide." };
  }
  if (!B64URL.test(auth) || auth.length < 8 || auth.length > 100) {
    return { ok: false, statut: 400, erreur: "Clé d'abonnement invalide." };
  }
  return { ok: true, endpoint, p256dh, auth };
}

/** Libellé lisible de l'appareil, d'après le user-agent. */
export function libelleAppareil(userAgent) {
  const ua = String(userAgent || "");
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Téléphone Android" : "Tablette Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Ordinateur Windows";
  if (/Linux/i.test(ua)) return "Ordinateur Linux";
  return "Appareil";
}

/**
 * Que faire de la ligne d'abonnement après la réponse du service push ?
 * 404 / 410 : l'abonnement n'existe plus (désinstallation, permission retirée)
 * → on supprime. Succès (2xx) → on note la date d'utilisation. Autre erreur
 * (429, 5xx, réseau…) → on garde la ligne sans y toucher : l'échec est
 * signalé à l'appelant, l'appareil n'est pas perdu pour autant.
 * @param {number|null|undefined} statut
 * @returns {"supprimer"|"marquer_utilise"|"garder"}
 */
export function suiteReponseService(statut) {
  if (statut === 404 || statut === 410) return "supprimer";
  if (typeof statut === "number" && statut >= 200 && statut < 300) return "marquer_utilise";
  return "garder";
}

/** Contenu de la notification de test (aucune donnée métier). */
export function chargeUtileTest() {
  return {
    title: "Profero — notification de test",
    body: "Les notifications fonctionnent sur cet appareil. Touchez pour ouvrir l'application.",
    url: "/",
    tag: "profero-test",
    icon: "/pwa-192.png",
  };
}

/**
 * Modes acceptés par send-push.
 *  - "test"     : l'utilisateur connecté s'envoie un test sur tous SES appareils
 *                 (fonctionne même quand l'interrupteur général est coupé et
 *                 pendant la plage de silence). Écrit aussi dans sa boîte.
 *  - "serveur"  : envoi automatique d'un type du catalogue (destinataires par
 *                 rôle, préférences, plage de silence, boîte de réception).
 *                 Réservé à un appel serveur muni de la clé service role.
 *                 `simulation: true` : aucun envoi, aucune écriture.
 *  - "reportes" : rattrapage des push reportés dont l'heure est venue
 *                 (job ?job=push_reportes du dispatcher). Même secret.
 */
export const MODES_SEND_PUSH = Object.freeze(["test", "serveur", "reportes"]);
export const MODES_SERVEUR = Object.freeze(["serveur", "reportes"]);

export function validerDemandeSendPush(corps) {
  const mode = String(corps?.mode || "test");
  if (!MODES_SEND_PUSH.includes(mode)) {
    return { ok: false, statut: 400, erreur: "Mode d'envoi inconnu." };
  }
  return { ok: true, mode, serveur: MODES_SERVEUR.includes(mode) };
}

/**
 * Le jeton présenté est-il la clé serveur (service role) ? Comparaison sans
 * sortie anticipée. Clé absente du serveur → toujours faux (fermé par défaut).
 */
export function estCleServeur(jeton, cleServeur) {
  const a = String(jeton || "");
  const b = String(cleServeur || "");
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i));
  return diff === 0;
}

/**
 * Résumé lisible d'un envoi à plusieurs appareils.
 * @param {Array<{suite: string, ok: boolean}>} resultats
 */
export function resumerEnvoi(resultats) {
  const liste = Array.isArray(resultats) ? resultats : [];
  const envoyes = liste.filter((r) => r.ok).length;
  const supprimes = liste.filter((r) => r.suite === "supprimer").length;
  const echecs = liste.filter((r) => !r.ok && r.suite !== "supprimer").length;
  return { appareils: liste.length, envoyes, supprimes, echecs };
}
