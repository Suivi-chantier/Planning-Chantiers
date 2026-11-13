// supabase/functions/_partage/utilisateursPush.ts
//
// Lecture des utilisateurs de l'application, rattachés à leur compte de
// connexion (rapprochement par e-mail : utilisateurs.id ≠ identifiant de
// connexion). Partagée par send-push (destinataires) et notifications-pilotage
// (appareils par rôle), pour qu'un même chiffre vienne de la même lecture.
// Client service role uniquement (jamais le navigateur).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export type UtilisateurPush = {
  email: string | null
  nom: string | null
  role: string
  actif: boolean
  branches: string[] | null
  auth_id: string | null
}

export async function lireUtilisateurs(admin: SupabaseClient): Promise<UtilisateurPush[]> {
  const { data, error } = await admin.from("utilisateurs").select("email, nom, role, actif, branches")
  if (error) throw new Error("Lecture des utilisateurs impossible.")
  const comptes = new Map<string, string>()
  for (let page = 1; page <= 20; page++) {
    const { data: lot, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (e) throw new Error("Lecture des comptes de connexion impossible.")
    for (const u of lot.users) if (u.email) comptes.set(u.email.toLowerCase(), u.id)
    if (lot.users.length < 1000) break
  }
  return (data ?? []).map((u) => ({
    ...u,
    auth_id: u.email ? comptes.get(String(u.email).toLowerCase()) ?? null : null,
  })) as UtilisateurPush[]
}
