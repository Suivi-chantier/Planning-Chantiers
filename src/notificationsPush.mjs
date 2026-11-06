// src/notificationsPush.mjs — décisions pures des notifications sur téléphone.
//
// Projet docs/projets/notifications-push.md, tâche 1. Module PUR : aucun accès
// Supabase, aucune horloge, aucun effet de bord. Le composant
// ProfilNotifications.jsx lit les capacités du navigateur et l'état du serveur,
// puis demande ici quel état afficher. Testé par
// scripts/verif-notifications-push.mjs. Façade front : notificationsPush.js.
//
// Règle 9 du projet (« une impossibilité doit rester visible ») : chaque cas a
// son état distinct. Un état inconnu (vérification en cours, serveur
// injoignable) n'a JAMAIS l'apparence de « activées » : seul l'état
// `activees` porte le ton « ok », et il exige à la fois la permission du
// navigateur, un abonnement sur l'appareil ET la confirmation du serveur.

export const ROLE_SANS_NOTIFICATION = "ouvrier";

/** Le bloc « Notifications sur ce téléphone » concerne-t-il ce rôle ? (jamais l'ouvrier) */
export function roleConcerne(role) {
  const r = String(role || "").trim().toLowerCase();
  return r !== "" && r !== ROLE_SANS_NOTIFICATION;
}

/** Ce que la personne recevra, selon son rôle (catalogue C1–D4 du projet). */
export function phraseRole(role) {
  switch (String(role || "").trim().toLowerCase()) {
    case "conducteur":
      return "Vous recevrez le point du soir (18h30) sur les comptes rendus reçus et manquants, les demandes de matériel des ouvriers, les matériaux à commander, les chantiers qui passent en alerte et les nouveaux chantiers signés.";
    case "comptable":
      return "Vous recevrez les factures de situation à émettre et l'encours fournisseurs du vendredi.";
    case "admin":
      return "Vous recevrez ce qui touche la rentabilité (marge à terminaison qui devient négative), les nouveaux chantiers signés et la synthèse de la semaine.";
    default:
      return "Aucun envoi automatique n'est prévu pour votre rôle pour l'instant. Vous pouvez déjà activer les notifications sur ce téléphone : les réglages pourront vous en adresser plus tard.";
  }
}

/** iPhone / iPad (y compris iPadOS qui se présente comme un Mac tactile). */
export function estAppareilIOS({ userAgent, maxTouchPoints } = {}) {
  const ua = String(userAgent || "");
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && Number(maxTouchPoints) > 1;
}

export function estAndroid({ userAgent } = {}) {
  return /Android/i.test(String(userAgent || ""));
}

/** Marche à suivre pour réautoriser les notifications, selon l'appareil. */
export function marcheASuivreRefus({ ios, android } = {}) {
  if (ios) return "Sur iPhone : ouvrez Réglages › Notifications › Profero Planning, puis activez « Autoriser les notifications ». Revenez ensuite ici.";
  if (android) return "Sur Android : appui long sur l'icône Profero Planning › Infos sur l'application › Notifications, puis activez-les. Dans Chrome sans installation : menu ⋮ › Paramètres › Paramètres des sites › Notifications. Revenez ensuite ici.";
  return "Dans le navigateur : cliquez sur le cadenas à gauche de l'adresse › Notifications › Autoriser, puis rechargez la page.";
}

/**
 * Clé publique VAPID à utiliser pour s'abonner.
 * La variable Vercel VITE_VAPID_PUBLIC_KEY est lue d'abord ; si elle est
 * absente, on prend celle que donne le serveur (elle est publique). Si les deux
 * existent mais diffèrent, c'est celle du serveur qui l'emporte : c'est elle
 * qui correspond à la clé privée qui signe les envois.
 * @returns {{ cle: string|null, source: "env"|"serveur"|null, incoherence: boolean }}
 */
export function choisirClePublique({ cleEnv, cleServeur } = {}) {
  const e = String(cleEnv || "").trim();
  const s = String(cleServeur || "").trim();
  if (e && s && e !== s) return { cle: s, source: "serveur", incoherence: true };
  if (e) return { cle: e, source: "env", incoherence: false };
  if (s) return { cle: s, source: "serveur", incoherence: false };
  return { cle: null, source: null, incoherence: false };
}

/** Convertit une clé base64url en octets (format attendu par PushManager.subscribe). */
export function base64UrlVersOctets(b64url) {
  const s = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const complet = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === "function" ? atob(complet) : Buffer.from(complet, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const AUCUNE_ACTION = Object.freeze({ activer: false, tester: false, desactiver: false });

function etat(code, ton, titre, detail, actions = AUCUNE_ACTION) {
  return { code, ton, titre, detail, actions: { ...AUCUNE_ACTION, ...actions } };
}

/**
 * État affiché dans le profil.
 *
 * @param {object} p
 * @param {string}  p.role
 * @param {boolean} p.apercuVercel        hôte de preview Vercel (service worker désinscrit par src/pwa.js)
 * @param {boolean} p.supporteServiceWorker
 * @param {boolean} p.supportePush        PushManager présent
 * @param {boolean} p.supporteNotification
 * @param {boolean} p.ios
 * @param {boolean} p.android
 * @param {boolean} p.standalone          app lancée depuis l'écran d'accueil
 * @param {boolean|null} p.serviceWorkerActif  null = pas encore vérifié
 * @param {"default"|"granted"|"denied"|null} p.permission
 * @param {"inconnu"|"configure"|"non_configure"|"injoignable"} p.serveur
 * @param {boolean|null} p.abonnementLocal     null = pas encore vérifié
 * @param {boolean|null} p.appareilEnregistre  null = pas encore vérifié / sans objet
 * @returns {{ code: string, ton: "ok"|"attention"|"erreur"|"neutre"|"attente", titre: string, detail: string, actions: {activer:boolean,tester:boolean,desactiver:boolean} }}
 */
export function etatNotifications(p = {}) {
  if (!roleConcerne(p.role)) {
    return etat("non_concerne", "neutre", "Non concerné", "Les notifications sur téléphone ne concernent pas ce rôle.");
  }
  if (p.apercuVercel) {
    return etat("apercu_vercel", "neutre", "Indisponible sur cet aperçu",
      "Vous êtes sur un aperçu de test (Vercel) : il n'a pas de service worker, donc pas de notifications. Ouvrez l'application habituelle pour les activer.");
  }
  if (p.ios && !p.standalone) {
    return etat("ios_installer", "attention", "Installez d'abord l'application",
      "Sur iPhone, installez d'abord l'application sur l'écran d'accueil (Partager › Sur l'écran d'accueil), iOS 16.4 minimum. Ouvrez-la ensuite depuis l'icône Profero et revenez ici.");
  }
  if (!p.supporteServiceWorker || !p.supportePush || !p.supporteNotification) {
    return etat("non_pris_en_charge", "erreur", "Non prises en charge par ce navigateur",
      p.ios
        ? "Cette version d'iOS ne permet pas les notifications d'une application web : il faut iOS 16.4 minimum, application ouverte depuis l'écran d'accueil."
        : "Ce navigateur ne permet pas de recevoir des notifications. Essayez avec Chrome, Edge, Firefox ou Safari à jour.");
  }
  if (p.permission === "denied") {
    return etat("refusees", "erreur", "Refusées sur cet appareil",
      `Les notifications ont été refusées pour Profero sur cet appareil. ${marcheASuivreRefus({ ios: p.ios, android: p.android })}`);
  }
  if (p.serviceWorkerActif === false) {
    return etat("sans_service_worker", "neutre", "Indisponible ici",
      "L'application n'a pas de service worker actif sur cette adresse (environnement de développement ou première ouverture). Rechargez la page ; si le message reste, ouvrez l'application habituelle.");
  }
  if (p.serveur === "non_configure") {
    return etat("serveur_non_configure", "attention", "Pas encore configurées sur le serveur",
      "Les notifications ne sont pas encore configurées sur le serveur. Rien n'est envoyé pour l'instant ; ce bloc fonctionnera dès que la configuration sera terminée.");
  }
  if (p.serveur === "injoignable") {
    return etat("serveur_injoignable", "attention", "État inconnu",
      "Le serveur de notifications ne répond pas : impossible de savoir si cet appareil est enregistré. Vérifiez la connexion puis réessayez.",
      p.abonnementLocal ? { desactiver: true } : {});
  }
  if (p.serviceWorkerActif == null || p.serveur !== "configure" || p.abonnementLocal == null) {
    return etat("verification", "attente", "Vérification en cours…", "Vérification de l'état des notifications sur cet appareil.");
  }
  if (p.abonnementLocal && p.permission === "granted") {
    if (p.appareilEnregistre === true) {
      return etat("activees", "ok", "Activées sur cet appareil",
        "Cet appareil recevra les notifications. Vous pouvez envoyer une notification de test pour vérifier.",
        { tester: true, desactiver: true });
    }
    if (p.appareilEnregistre == null) {
      return etat("verification", "attente", "Vérification en cours…", "Vérification de l'enregistrement de cet appareil auprès du serveur.");
    }
    return etat("a_reenregistrer", "attention", "À réactiver",
      "Cet appareil n'est plus enregistré auprès du serveur (abonnement expiré ou remplacé). Touchez « Activer les notifications » pour le réenregistrer.",
      { activer: true, desactiver: true });
  }
  return etat("non_activees", "neutre", "Pas encore activées sur cet appareil",
    "Touchez « Activer les notifications » : votre téléphone vous demandera l'autorisation.",
    { activer: true });
}
