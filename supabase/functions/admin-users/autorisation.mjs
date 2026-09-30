// supabase/functions/admin-users/autorisation.mjs
//
// Décisions PURES de la fonction admin-users : qui peut appeler, quelles
// demandes sont recevables. Aucun accès Supabase, aucune horloge, aucun effet
// de bord — index.ts fournit l'appelant et son profil, ce module tranche.
// Importé tel quel par Deno (index.ts) et par Node (scripts/verif-admin-users.mjs).
//
// Règle : tout est refusé par défaut. Seul un utilisateur Auth réel, dont la
// ligne `utilisateurs` porte role = "admin" et n'est pas désactivée, passe.
// La clé publique de l'application (anon) est un JWT valide pour la passerelle
// Supabase (« Verify JWT ») mais ne correspond à aucun utilisateur : refusée.

export const ACTIONS_AUTORISEES = Object.freeze(["invite", "reset_password"]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAINE_LOCAL = "@profero.local";

/** Extrait le jeton d'un en-tête Authorization « Bearer … », sinon null. */
export function extraireJeton(entete) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(entete || ""));
  return m ? m[1] : null;
}

/**
 * Tranche sur l'appelant.
 * @param {{ appelant: {email?: string}|null, profil: {role?: string, actif?: boolean}|null }} p
 * @returns {{ autorise: true } | { autorise: false, statut: 401|403, erreur: string }}
 */
export function decisionAppelant({ appelant, profil } = {}) {
  if (!appelant || typeof appelant.email !== "string" || !appelant.email.trim()) {
    return { autorise: false, statut: 401, erreur: "Non authentifié." };
  }
  if (!profil || profil.role !== "admin" || profil.actif === false) {
    return { autorise: false, statut: 403, erreur: "Action réservée aux administrateurs." };
  }
  return { autorise: true };
}

/**
 * Valide le corps de la demande.
 * @returns {{ ok: true, action: string, email: string } | { ok: false, statut: 400, erreur: string }}
 */
export function validerDemande(corps) {
  const action = String(corps?.action || "");
  if (!ACTIONS_AUTORISEES.includes(action)) {
    return { ok: false, statut: 400, erreur: "Action inconnue." };
  }
  const email = String(corps?.email || "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, statut: 400, erreur: "Adresse email invalide." };
  }
  // Les comptes sans email (identifiant@profero.local) passent par
  // admin-users-local : ni invitation ni lien de réinitialisation possibles.
  if (email.endsWith(DOMAINE_LOCAL)) {
    return { ok: false, statut: 400, erreur: "Compte sans email : utiliser la création ou le mot de passe direct." };
  }
  return { ok: true, action, email };
}
