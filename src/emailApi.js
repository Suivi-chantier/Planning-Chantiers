// src/emailApi.js — Seul point d'appel de /api/send-email côté navigateur.
//
// La route n'accepte plus d'envoi anonyme, sauf le compte rendu public vers la
// liste blanche interne (voir api/_lib/autorisationEmail.js). Ce helper joint
// donc le JWT de la session Supabase quand il y en a une ; sans session (le
// formulaire public /rapport), l'appel part sans, et le serveur applique la
// règle du compte rendu.
//
// `source` n'autorise rien : c'est une étiquette de diagnostic, journalisée
// avec l'envoi, qui dit d'où il vient. Un appel qui arrive SANS étiquette vient
// d'un appareil resté sur un ancien bundle.
//
// Renvoie la Response telle quelle : les appelants gardent leur gestion
// d'erreur (res.ok, res.json()) inchangée.

import { supabase } from "./supabase";

export async function envoyerEmailApi(corps, { source } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (source) headers["X-Profero-Source"] = source;
  try {
    const { data } = await supabase.auth.getSession();
    const jeton = data?.session?.access_token;
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
  } catch { /* pas de session lisible : envoi anonyme, le serveur tranche */ }
  return fetch("/api/send-email", { method: "POST", headers, body: JSON.stringify(corps) });
}
