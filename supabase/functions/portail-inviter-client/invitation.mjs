// supabase/functions/portail-inviter-client/invitation.mjs — logique PURE de l'invitation
// d'un client au portail (aucun réseau, aucune base, aucune horloge). Testée dans Node
// par scripts/verif-portail-invitation.mjs ; importée par index.ts.

const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const estUuid = (v) => UUID.test(String(v || ""));

/** Adresse du client utilisable pour une invitation, ou le motif du refus. */
export function adresseInvitable(brut) {
  const email = String(brut || "").trim().toLowerCase();
  if (!email) return { ok: false, motif: "Le client n'a pas d'adresse e-mail. Renseignez-la sur sa fiche." };
  if (!COURRIEL.test(email)) return { ok: false, motif: "L'adresse e-mail du client n'est pas valide." };
  if (email.endsWith("@profero.local")) return { ok: false, motif: "Cette adresse interne ne peut pas recevoir d'invitation." };
  return { ok: true, email };
}

/**
 * Que faire de ce compte de connexion ? Aucune adresse déjà utilisée n'est jamais « reprise ».
 *  - compte inexistant                                  -> creer
 *  - compte déjà lié à CE client                        -> renvoyer
 *  - compte lié à un AUTRE client                       -> refuser
 *  - compte existant, jamais connecté, sans lien        -> adopter (reste d'un essai interrompu)
 *  - tout autre compte existant (collaborateur, etc.)   -> refuser
 */
export function decisionCompte({ compte, lienExistant, clientId }) {
  if (!compte) return { action: "creer" };
  if (lienExistant) {
    return lienExistant.client_id === clientId
      ? { action: "renvoyer" }
      : { action: "refuser", motif: "Cette adresse est déjà utilisée par un autre client." };
  }
  if (!compte.last_sign_in_at) return { action: "adopter" };
  return { action: "refuser", motif: "Cette adresse correspond déjà à un compte existant. Utilisez une autre adresse." };
}

/** Lien envoyé au client : le portail valide lui-même le jeton (pas de redirection Supabase). */
export function lienPortail(site, tokenHash, type) {
  const base = String(site || "").replace(/\/+$/, "");
  const t = type === "recovery" ? "recovery" : "invite";
  return `${base}/espace-client?token_hash=${encodeURIComponent(tokenHash)}&type=${t}`;
}

const echapper = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Courriel en français. `lien` n'apparaît que dans le corps du message. */
export function construireCourriel({ prenom, nom, lien, renvoi }) {
  const appel = String(prenom || "").trim() || String(nom || "").trim();
  const bonjour = appel ? `Bonjour ${appel},` : "Bonjour,";
  const sujet = renvoi ? "Votre accès à l'espace client Profero Invest" : "Votre espace client Profero Invest";
  const intro = renvoi
    ? "Voici un nouveau lien pour accéder à votre espace client Profero Invest."
    : "Votre conseiller Profero Invest vous ouvre votre espace client : vous y suivrez l'avancement de votre accompagnement et retrouverez les documents qu'il partage avec vous.";
  const consigne = "Cliquez sur le bouton ci-dessous pour choisir votre mot de passe. Ce lien est à usage unique et valable peu de temps ; s'il a expiré, demandez simplement un nouvel envoi à votre conseiller.";
  const texte = [bonjour, "", intro, "", consigne, "", lien, "", "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.", "", "L'équipe Profero Invest"].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f7f1e5;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="background:#071426;color:#fff;padding:18px 22px;"><div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#d6a84c;font-weight:700;">Profero Invest</div><div style="font-size:20px;font-weight:800;margin-top:4px;">Votre espace client</div></div>
    <div style="padding:22px;line-height:1.55;font-size:15px;">
      <p style="margin:0 0 12px;">${echapper(bonjour)}</p>
      <p style="margin:0 0 12px;">${echapper(intro)}</p>
      <p style="margin:0 0 18px;">${echapper(consigne)}</p>
      <p style="margin:0 0 18px;"><a href="${echapper(lien)}" style="display:inline-block;background:#d6a84c;color:#071426;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:10px;">Choisir mon mot de passe</a></p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
    </div></div></div>`;
  return { sujet, texte, html };
}
