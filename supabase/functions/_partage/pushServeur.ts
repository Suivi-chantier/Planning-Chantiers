// supabase/functions/_partage/pushServeur.ts
//
// Partie serveur commune aux Edge Functions push-abonnement, send-push et
// notifications-boite :
// CORS, réponses JSON, identification de l'appelant. Les décisions elles-mêmes
// vivent dans pushRegles.mjs (pur, testé par scripts/verif-notifications-push.mjs).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { clesVapid, decisionAppelantPush, estCleServeur, extraireJeton } from "./pushRegles.mjs"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

/** Clés VAPID depuis les secrets des Edge Functions (jamais depuis le dépôt). */
export function lireClesVapid() {
  return clesVapid({
    publique: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    privee: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
    sujet: Deno.env.get("VAPID_SUBJECT") ?? "",
  })
}

type Identification =
  | { ok: true; admin: SupabaseClient; userId: string; role: string }
  | { ok: false; reponse: Response }

/**
 * Identifie l'appelant : utilisateur Auth réel (jeton), collaborateur actif
 * (même fonction que la policy profero_collaborateurs_seulement, appelée AVEC
 * le jeton de l'utilisateur), profil `utilisateurs` actif, rôle bureau.
 * Refus par défaut à la moindre anomalie.
 */
export async function identifierAppelant(req: Request): Promise<Identification> {
  const url = Deno.env.get("SUPABASE_URL")
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const cleAnon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !cleService || !cleAnon) {
    return { ok: false, reponse: json({ error: "Configuration serveur incomplète." }, 500) }
  }
  const admin = createClient(url, cleService, { auth: { autoRefreshToken: false, persistSession: false } })

  const jwt = extraireJeton(req.headers.get("Authorization"))
  if (!jwt) return { ok: false, reponse: json({ error: "Non authentifié." }, 401) }

  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
  const appelant = userErr ? null : user

  let profil = null
  let collaborateurActif = false
  if (appelant?.email) {
    const { data } = await admin
      .from("utilisateurs")
      .select("role, actif")
      .eq("email", appelant.email.toLowerCase())
      .maybeSingle()
    profil = data

    const commeUtilisateur = createClient(url, cleAnon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: estCollab, error: collabErr } = await commeUtilisateur.rpc("est_collaborateur_actif")
    collaborateurActif = !collabErr && estCollab === true
  }

  const decision = decisionAppelantPush({ appelant, profil, collaborateurActif })
  if (!decision.autorise) return { ok: false, reponse: json({ error: decision.erreur }, decision.statut) }
  return { ok: true, admin, userId: appelant!.id, role: String(profil!.role) }
}

/** Client service role (accès aux tables fermées au navigateur). */
export function clientServeur(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL")
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !cleService) return null
  return createClient(url, cleService, { auth: { autoRefreshToken: false, persistSession: false } })
}

/**
 * Appel de serveur à serveur (dispatcher Vercel) : le jeton « Bearer » doit
 * être la clé service role, déjà connue des deux côtés (Vercel :
 * SUPABASE_SERVICE_ROLE_KEY ; Supabase : injectée dans les Edge Functions).
 * Aucun nouveau secret. Clé absente du serveur → refus (fermé par défaut).
 */
export function estAppelServeur(req: Request): boolean {
  return estCleServeur(extraireJeton(req.headers.get("Authorization")), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")
}
