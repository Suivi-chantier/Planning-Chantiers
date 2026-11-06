// ─────────────────────────────────────────────────────────────────────────────
// push-abonnement — abonnements aux notifications sur téléphone (push PWA).
// Projet docs/projets/notifications-push.md, tâche 1.
//
//   GET    → { configure, cle_publique } : la clé VAPID PUBLIQUE (publique par
//            nature, sert au navigateur à s'abonner). Si `?endpoint=` est fourni
//            par un collaborateur bureau identifié, ajoute
//            `appareil_enregistre` (cet appareil est-il connu du serveur ?).
//            Clés absentes des secrets → 503 « Clés de notification non
//            configurées sur le serveur » : jamais un faux « activé ».
//   POST   { subscription } → enregistre ou actualise l'abonnement de
//            l'utilisateur connecté (une ligne par appareil, clé = endpoint).
//   DELETE { endpoint }     → supprime SON abonnement pour cet appareil.
//
// Accès : la table push_subscriptions n'a aucune policy d'ouverture ; seule
// cette fonction (service role) y écrit, après avoir identifié l'appelant :
// utilisateur réel, collaborateur actif, rôle bureau (jamais « ouvrier »).
// Elle ne touche qu'aux lignes de l'appelant (user_id = son identifiant).
//
// Secrets : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (Edge Functions
// › Secrets). SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY sont
// injectés par Supabase. « Verify JWT » activé (supabase/config.toml).
// ─────────────────────────────────────────────────────────────────────────────

import { corsHeaders, identifierAppelant, json, lireClesVapid } from "../_partage/pushServeur.ts"
import { libelleAppareil, validerAbonnement } from "../_partage/pushRegles.mjs"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    if (req.method === "GET") {
      const cles = lireClesVapid()
      if (!cles.ok) {
        return json({ configure: false, code: cles.code, error: cles.erreur }, cles.statut)
      }
      const endpoint = new URL(req.url).searchParams.get("endpoint")
      if (!endpoint) return json({ configure: true, cle_publique: cles.publique })

      const qui = await identifierAppelant(req)
      if (!qui.ok) return qui.reponse
      const { data, error } = await qui.admin
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", qui.userId)
        .eq("endpoint", endpoint)
        .maybeSingle()
      if (error) return json({ error: "Lecture des abonnements impossible." }, 500)
      return json({ configure: true, cle_publique: cles.publique, appareil_enregistre: !!data })
    }

    if (req.method === "POST") {
      const qui = await identifierAppelant(req)
      if (!qui.ok) return qui.reponse
      const cles = lireClesVapid()
      if (!cles.ok) return json({ configure: false, code: cles.code, error: cles.erreur }, cles.statut)

      const sub = validerAbonnement(await req.json().catch(() => ({})))
      if (!sub.ok) return json({ error: sub.erreur }, sub.statut)

      const userAgent = (req.headers.get("user-agent") || "").slice(0, 400)
      const { error } = await qui.admin
        .from("push_subscriptions")
        .upsert({
          user_id: qui.userId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          appareil: libelleAppareil(userAgent),
          user_agent: userAgent || null,
        }, { onConflict: "endpoint" })
      if (error) return json({ error: "Enregistrement de l'abonnement impossible." }, 500)
      return json({ ok: true, appareil: libelleAppareil(userAgent) })
    }

    if (req.method === "DELETE") {
      const qui = await identifierAppelant(req)
      if (!qui.ok) return qui.reponse
      const corps = await req.json().catch(() => ({}))
      const endpoint = String(corps?.endpoint || "").trim()
      if (!endpoint) return json({ error: "Adresse d'abonnement manquante." }, 400)
      const { error, count } = await qui.admin
        .from("push_subscriptions")
        .delete({ count: "exact" })
        .eq("user_id", qui.userId)
        .eq("endpoint", endpoint)
      if (error) return json({ error: "Suppression de l'abonnement impossible." }, 500)
      return json({ ok: true, supprimes: count ?? 0 })
    }

    return json({ error: "Méthode non autorisée." }, 405)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
