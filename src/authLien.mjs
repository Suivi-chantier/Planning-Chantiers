// src/authLien.mjs — Liens d'authentification Supabase (invitation, réinitialisation).
//
// Le problème résolu
// ──────────────────
// Un lien d'invitation ou de réinitialisation ramène sur l'application avec la
// session dans le fragment d'URL : #access_token=…&type=invite (ou recovery).
// supabase-js (flow implicite) lit ce fragment dès sa création, enregistre la
// session, puis EFFACE le fragment AVANT de prévenir l'application. App.jsx
// cherchait `type=invite` dans l'URL : il ne le trouvait jamais, et l'invité
// entrait dans l'application sans avoir défini de mot de passe. Le lien de
// réinitialisation (événement PASSWORD_RECOVERY) n'était pas traité du tout.
//
// D'où ce module : le fragment est relevé AVANT createClient (src/supabase.js
// l'appelle en premier), puis App.jsx décide avec la session réelle.
//
// Règle de sécurité
// ─────────────────
// La présence de `type=invite` / `type=recovery` dans une URL ne suffit
// JAMAIS. L'écran de mot de passe n'est proposé que si la session active est
// celle que le lien vient de délivrer : même access_token que dans le
// fragment. Un lien expiré, rejoué ou forgé n'ouvre pas de session (Supabase
// le refuse) — et supabase-js conserve alors la session existante : sans ce
// contrôle, un administrateur déjà connecté se verrait proposer de changer SON
// mot de passe. Supabase reste l'autorité : c'est lui qui valide le lien, et
// updateUser({ password }) exige une session valide.
//
// Le jeton relevé reste en mémoire du module (jamais stocké, jamais journalisé)
// et n'est plus comparé une fois le lien traité.

const TYPES_LIEN = ["invite", "recovery"];

// Lit le fragment d'une URL. Pur : testable sans navigateur.
export function lireLienAuth(href) {
  try {
    const url = new URL(href);
    const brut = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const p = new URLSearchParams(brut);
    const type = p.get("type");
    return {
      type: TYPES_LIEN.includes(type) ? type : null,
      jeton: p.get("access_token") || null,
      erreur: p.get("error_code") || p.get("error") || null,
    };
  } catch {
    return { type: null, jeton: null, erreur: null };
  }
}

// La session est-elle celle délivrée par le lien ?
export function sessionIssueDuLien(lien, session) {
  return !!(lien && lien.type && lien.jeton && session && session.access_token === lien.jeton);
}

// Décision unique, partagée par le démarrage et les événements d'auth.
// → "invite" | "recovery" : proposer PageCreerMotDePasse ; null sinon.
export function modeMotDePasse(lien, session, evenement = null) {
  if (!lien || lien.traite) return null;
  if (!sessionIssueDuLien(lien, session)) return null;
  // PASSWORD_RECOVERY n'est émis par supabase-js que pour un lien de
  // réinitialisation : il confirme le type sans le remplacer.
  if (evenement === "PASSWORD_RECOVERY") return "recovery";
  return lien.type;
}

// ─── État du lien de la page courante ────────────────────────────────────────
let lienInitial = { type: null, jeton: null, erreur: null, traite: false };

// Appelé par src/supabase.js AVANT createClient.
export function capturerLienAuth(href = (typeof window !== "undefined" ? window.location.href : "")) {
  lienInitial = { ...lireLienAuth(href), traite: false };
  return lienInitial;
}

export function lienAuthInitial() { return lienInitial; }

// Une fois le mot de passe défini (ou l'écran quitté) : le lien ne déclenche
// plus rien, et le jeton relevé est oublié.
export function consommerLienAuth() {
  lienInitial = { type: null, jeton: null, erreur: lienInitial.erreur, traite: true };
}
