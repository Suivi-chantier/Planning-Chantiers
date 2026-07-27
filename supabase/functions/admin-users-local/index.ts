import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// admin-users-local
// Gestion des comptes SANS adresse email : création par identifiant + mot de
// passe (email synthétique identifiant@profero.local), liaison d'un vrai email
// plus tard, et définition directe du mot de passe (pas d'email de reset
// possible pour ces comptes).
//
// Complète la fonction `admin-users` déjà déployée (invite / reset_password),
// qui reste inchangée.
//
// Actions (POST JSON, réservé aux utilisateurs role=admin actifs) :
//   { action: "create_local", identifiant, password }
//       → crée l'utilisateur Auth avec email identifiant@profero.local,
//         mot de passe fourni, email confirmé (aucun mail envoyé).
//   { action: "set_email", current_email, new_email }
//       → remplace l'email du compte Auth (confirmé, aucun mail envoyé)
//         ET met à jour la ligne `utilisateurs` correspondante.
//         Fonctionne aussi pour changer l'email d'un compte classique.
//   { action: "set_password", email, password }
//       → définit directement un nouveau mot de passe (compte local ou non).
//
// Secrets : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectés
// automatiquement par Supabase dans les Edge Functions — rien à configurer.
//
// Déploiement :
//   npx supabase login
//   npx supabase functions deploy admin-users-local --project-ref <ref-projet>
// (ou copier ce fichier dans Dashboard → Edge Functions → Deploy new function,
//  nom exact : admin-users-local, « Verify JWT » activé)
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_DOMAIN = "profero.local"
const IDENTIFIANT_REGEX = /^[a-z0-9][a-z0-9._-]{1,29}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Cherche un utilisateur Auth par email (l'API admin n'a pas de recherche
  // directe : on pagine — volumes faibles, quelques dizaines de comptes).
  const findAuthUserByEmail = async (email: string) => {
    const target = email.trim().toLowerCase()
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error("Lecture des comptes Auth impossible : " + error.message)
      const hit = data.users.find((u) => (u.email || "").toLowerCase() === target)
      if (hit) return hit
      if (data.users.length < 200) return null
    }
    return null
  }

  try {
    // ── Authentification de l'appelant : admin actif uniquement ──────────────
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ error: "Non authentifié." }, 401)
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller?.email) return json({ error: "Non authentifié." }, 401)

    const { data: profil } = await admin
      .from("utilisateurs")
      .select("role, actif")
      .eq("email", caller.email.toLowerCase())
      .maybeSingle()
    if (!profil || profil.role !== "admin" || profil.actif === false) {
      return json({ error: "Action réservée aux administrateurs." }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || "")

    // ── create_local : identifiant + mot de passe, sans email ────────────────
    if (action === "create_local") {
      const identifiant = String(body.identifiant || "").trim().toLowerCase()
      const password = String(body.password || "")
      if (!IDENTIFIANT_REGEX.test(identifiant)) {
        return json({ error: "Identifiant invalide : 2 à 30 caractères, lettres minuscules, chiffres, . _ - (doit commencer par une lettre ou un chiffre)." }, 400)
      }
      if (password.length < 8) {
        return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400)
      }
      const email = `${identifiant}@${LOCAL_DOMAIN}`
      const existing = await findAuthUserByEmail(email)
      if (existing) return json({ error: `L'identifiant « ${identifiant} » est déjà pris.` }, 409)

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) return json({ error: "Création du compte impossible : " + error.message }, 500)
      return json({ ok: true, email, user_id: data.user?.id })
    }

    // ── set_email : lier / remplacer l'email d'un compte ─────────────────────
    if (action === "set_email") {
      const currentEmail = String(body.current_email || "").trim().toLowerCase()
      const newEmail = String(body.new_email || "").trim().toLowerCase()
      if (!currentEmail) return json({ error: "current_email manquant." }, 400)
      if (!EMAIL_REGEX.test(newEmail)) return json({ error: "Nouvelle adresse email invalide." }, 400)
      if (newEmail.endsWith("@" + LOCAL_DOMAIN)) {
        return json({ error: `Le domaine ${LOCAL_DOMAIN} est réservé aux comptes sans email.` }, 400)
      }
      if (newEmail === currentEmail) return json({ error: "La nouvelle adresse est identique à l'actuelle." }, 400)

      // Refuser si l'email cible est déjà utilisé (Auth ou profil).
      const clash = await findAuthUserByEmail(newEmail)
      if (clash) return json({ error: `Un compte existe déjà avec l'adresse ${newEmail}.` }, 409)
      const { data: clashProfil } = await admin
        .from("utilisateurs").select("id").eq("email", newEmail).maybeSingle()
      if (clashProfil) return json({ error: `Un profil existe déjà avec l'adresse ${newEmail}.` }, 409)

      const target = await findAuthUserByEmail(currentEmail)
      if (!target) return json({ error: `Aucun compte Auth trouvé pour ${currentEmail}.` }, 404)

      const { error: updErr } = await admin.auth.admin.updateUserById(target.id, {
        email: newEmail,
        email_confirm: true,
      })
      if (updErr) return json({ error: "Mise à jour de l'email Auth impossible : " + updErr.message }, 500)

      // Le profil applicatif est relié par email : on le migre dans la foulée.
      const { error: dbErr } = await admin
        .from("utilisateurs").update({ email: newEmail }).eq("email", currentEmail)
      if (dbErr) {
        // Tentative de retour arrière pour ne pas orpheliner le profil.
        await admin.auth.admin.updateUserById(target.id, { email: currentEmail, email_confirm: true })
        return json({ error: "Mise à jour du profil impossible (annulée) : " + dbErr.message }, 500)
      }
      return json({ ok: true, email: newEmail })
    }

    // ── set_password : définir directement un mot de passe ───────────────────
    if (action === "set_password") {
      const email = String(body.email || "").trim().toLowerCase()
      const password = String(body.password || "")
      if (!email) return json({ error: "email manquant." }, 400)
      if (password.length < 8) {
        return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400)
      }
      const target = await findAuthUserByEmail(email)
      if (!target) return json({ error: `Aucun compte Auth trouvé pour ${email}.` }, 404)

      const { error } = await admin.auth.admin.updateUserById(target.id, { password })
      if (error) return json({ error: "Mise à jour du mot de passe impossible : " + error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: `Action inconnue : ${action}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
