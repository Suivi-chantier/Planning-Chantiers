import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { decisionAppelant, extraireJeton, validerDemande } from "./autorisation.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// admin-users
// Invitation d'un utilisateur par email et lien de réinitialisation du mot de
// passe, depuis les écrans Admin (Invest et Rénovation).
//
// Actions (POST JSON, réservé aux utilisateurs role=admin actifs) :
//   { action: "invite", email }          → invitation Supabase Auth
//   { action: "reset_password", email }  → lien de réinitialisation
//
// Jusqu'à la version 15 (déployée hors dépôt), la fonction ne vérifiait pas
// l'appelant : la clé publique suffisait pour inviter n'importe quelle adresse
// (contournement de disable_signup) ou supprimer n'importe quel compte.
// L'action « delete », qu'aucun écran n'utilisait, est retirée.
// Les décisions d'accès vivent dans autorisation.mjs (testé par
// scripts/verif-admin-users.mjs).
//
// Secrets : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectés
// automatiquement par Supabase. Absents → 500, jamais d'ouverture.
//
// Déploiement :
//   npx supabase functions deploy admin-users --project-ref <ref-projet>
// (« Verify JWT » activé, voir supabase/config.toml)
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const cle = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !cle) return json({ error: "Configuration serveur incomplète." }, 500)

  const admin = createClient(url, cle, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // ── Authentification de l'appelant : admin actif uniquement ──────────────
    const jwt = extraireJeton(req.headers.get("Authorization"))
    if (!jwt) return json({ error: "Non authentifié." }, 401)
    const { data: { user: appelant }, error: appelantErr } = await admin.auth.getUser(jwt)

    let profil = null
    if (!appelantErr && appelant?.email) {
      const { data } = await admin
        .from("utilisateurs")
        .select("role, actif")
        .eq("email", appelant.email.toLowerCase())
        .maybeSingle()
      profil = data
    }
    const decision = decisionAppelant({ appelant: appelantErr ? null : appelant, profil })
    if (!decision.autorise) return json({ error: decision.erreur }, decision.statut)

    // ── Demande ───────────────────────────────────────────────────────────────
    const demande = validerDemande(await req.json().catch(() => ({})))
    if (!demande.ok) return json({ error: demande.erreur }, demande.statut)

    if (demande.action === "invite") {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(demande.email)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, user_id: data.user?.id })
    }

    if (demande.action === "reset_password") {
      const { error } = await admin.auth.admin.generateLink({ type: "recovery", email: demande.email })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: "Action inconnue." }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
