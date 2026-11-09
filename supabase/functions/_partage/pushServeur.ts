// supabase/functions/_partage/pushServeur.ts
//
// Partie serveur commune aux Edge Functions push-abonnement, send-push et
// notifications-boite :
// CORS, réponses JSON, identification de l'appelant. Les décisions elles-mêmes
// vivent dans pushRegles.mjs (pur, testé par scripts/verif-notifications-push.mjs).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  clesVapid, decisionAppelantPush, decisionCleServeur, extraireJeton, formeCle, lireDictionnaireCles,
} from "./pushRegles.mjs"

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

/** Résultats de la validation auprès de Supabase Auth, par empreinte du jeton. */
const cacheValidation = new Map<string, { ok: boolean; jusqua: number }>()
const DUREE_CACHE_OK_MS = 5 * 60 * 1000
const DUREE_CACHE_REFUS_MS = 30 * 1000

async function empreinte(jeton: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton))
  return Array.from(new Uint8Array(h), (o) => o.toString(16).padStart(2, "0")).join("")
}

/**
 * Dernier recours : seul un détenteur d'une clé secrète (ou service role) de
 * CE projet obtient 200 sur l'API d'administration d'Auth. Lecture d'une
 * seule fiche, sans rien en faire. Résultat gardé en mémoire quelques minutes.
 */
async function valideAupresDeSupabase(jeton: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL")
  if (!url) return false
  const cle = await empreinte(jeton)
  const maintenant = Date.now()
  const connu = cacheValidation.get(cle)
  if (connu && connu.jusqua > maintenant) return connu.ok
  let ok = false
  try {
    const rep = await fetch(`${url}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: jeton, Authorization: `Bearer ${jeton}` },
    })
    ok = rep.status === 200
    await rep.body?.cancel()
  } catch {
    ok = false
  }
  if (cacheValidation.size > 50) cacheValidation.clear()
  cacheValidation.set(cle, { ok, jusqua: maintenant + (ok ? DUREE_CACHE_OK_MS : DUREE_CACHE_REFUS_MS) })
  return ok
}

/**
 * Appel de serveur à serveur (dispatcher Vercel) : le jeton « Bearer » doit
 * être une clé secrète de CE projet Supabase. Aucun nouveau secret.
 *   1. égal à SUPABASE_SERVICE_ROLE_KEY (injectée dans les Edge Functions) ;
 *   2. ou à l'une des clés de SUPABASE_SECRET_KEYS ;
 *   3. sinon, s'il a la forme d'une clé secrète (JWT service_role, sb_secret_),
 *      validation auprès de Supabase Auth (pushRegles.decisionCleServeur).
 * Clé publique, jeton utilisateur, jeton vide → refus (fermé par défaut).
 */
export async function estAppelServeur(req: Request): Promise<boolean> {
  const jeton = extraireJeton(req.headers.get("Authorization"))
  const decision = decisionCleServeur({
    jeton,
    cleService: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    clesSecretes: lireDictionnaireCles(Deno.env.get("SUPABASE_SECRET_KEYS")),
    clesPubliques: [
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      ...lireDictionnaireCles(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")),
    ].filter(Boolean),
  })
  if (decision === "accepte") return true
  if (decision === "refuse" || !jeton) return false
  return await valideAupresDeSupabase(jeton)
}

/** Forme des clés serveur vues par la fonction (diagnostic, jamais de valeur). */
export function diagnosticClesServeur() {
  return {
    service_role: formeCle(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
    cles_secretes: lireDictionnaireCles(Deno.env.get("SUPABASE_SECRET_KEYS")).map(formeCle),
  }
}
