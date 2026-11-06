// ─────────────────────────────────────────────────────────────────────────────
// notifications-boite — la boîte de réception et les préférences de
// l'utilisateur connecté. Projet docs/projets/notifications-push.md, tâche 2
// (les écrans viennent en tâche 3).
//
//   GET                       → { notifications: [...50 dernières], non_lues }
//   GET  ?vue=compteur        → { non_lues }
//   GET  ?vue=preferences     → { preferences: { C1: true, … }, catalogue }
//   POST { action: "marquer_lu", id }      → marque UNE notification comme lue
//   POST { action: "tout_marquer_lu" }     → marque toutes les siennes
//   POST { action: "preferences", types: { C1: false, … } } → enregistre
//
// Accès : les tables notifications et notifications_preferences n'ont aucune
// policy d'ouverture (journal du projet, 06/11/2026). Cette fonction (service
// role) identifie l'appelant exactement comme push-abonnement — utilisateur
// réel, collaborateur actif, rôle bureau, jamais « ouvrier » — puis ne lit et
// n'écrit QUE ses lignes (filtre user_id = son identifiant sur chaque requête).
// « Verify JWT » activé (supabase/config.toml).
// ─────────────────────────────────────────────────────────────────────────────

import { corsHeaders, identifierAppelant, json } from "../_partage/pushServeur.ts"
import { CATALOGUE, preferenceActive, validerPreferences } from "../_partage/notificationsPushV1.mjs"

const COLONNES = "id, type, titre, texte, lien, created_at, lu_le, push_statut, push_prevu_le, push_envoye_le"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405)

  try {
    const qui = await identifierAppelant(req)
    if (!qui.ok) return qui.reponse
    const { admin, userId } = qui

    const compterNonLues = async () => {
      const { count, error } = await admin.from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).is("lu_le", null)
      if (error) throw new Error("Lecture de la boîte de réception impossible.")
      return count ?? 0
    }

    if (req.method === "GET") {
      const vue = new URL(req.url).searchParams.get("vue") || "liste"
      if (vue === "compteur") return json({ non_lues: await compterNonLues() })
      if (vue === "preferences") {
        const { data, error } = await admin.from("notifications_preferences")
          .select("types").eq("user_id", userId).maybeSingle()
        if (error) return json({ error: "Lecture des préférences impossible." }, 500)
        const preferences: Record<string, boolean> = {}
        for (const t of CATALOGUE) preferences[t.code] = preferenceActive(data?.types, t.code)
        return json({ preferences, catalogue: CATALOGUE.map(({ code, libelle, push }) => ({ code, libelle, push })) })
      }
      if (vue !== "liste") return json({ error: "Vue inconnue." }, 400)
      const { data, error } = await admin.from("notifications").select(COLONNES)
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
      if (error) return json({ error: "Lecture de la boîte de réception impossible." }, 500)
      return json({ notifications: data ?? [], non_lues: await compterNonLues() })
    }

    // POST
    const corps = await req.json().catch(() => ({}))
    const action = String(corps?.action || "")
    const maintenant = new Date().toISOString()

    if (action === "marquer_lu") {
      const id = String(corps?.id || "")
      if (!UUID.test(id)) return json({ error: "Identifiant de notification invalide." }, 400)
      const { error, count } = await admin.from("notifications")
        .update({ lu_le: maintenant }, { count: "exact" })
        .eq("id", id).eq("user_id", userId).is("lu_le", null)
      if (error) return json({ error: "Mise à jour impossible." }, 500)
      return json({ ok: true, marquees: count ?? 0, non_lues: await compterNonLues() })
    }

    if (action === "tout_marquer_lu") {
      const { error, count } = await admin.from("notifications")
        .update({ lu_le: maintenant }, { count: "exact" })
        .eq("user_id", userId).is("lu_le", null)
      if (error) return json({ error: "Mise à jour impossible." }, 500)
      return json({ ok: true, marquees: count ?? 0, non_lues: 0 })
    }

    if (action === "preferences") {
      const v = validerPreferences(corps)
      if (!v.ok) return json({ error: v.erreur }, 400)
      const { data: actuel, error: errLecture } = await admin.from("notifications_preferences")
        .select("types").eq("user_id", userId).maybeSingle()
      if (errLecture) return json({ error: "Lecture des préférences impossible." }, 500)
      const types = { ...(actuel?.types ?? {}), ...v.types }
      const { error } = await admin.from("notifications_preferences")
        .upsert({ user_id: userId, types, updated_at: maintenant }, { onConflict: "user_id" })
      if (error) return json({ error: "Enregistrement des préférences impossible." }, 500)
      const preferences: Record<string, boolean> = {}
      for (const t of CATALOGUE) preferences[t.code] = preferenceActive(types, t.code)
      return json({ ok: true, preferences })
    }

    return json({ error: "Action inconnue." }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
