// ─────────────────────────────────────────────────────────────────────────────
// notifications-pilotage — chiffres de suivi de l'onglet Réglages ›
// Notifications (administrateurs seulement). Projet
// docs/projets/notifications-push.md, tâche 3.
//
//   GET → {
//     par_type: { C1: { date, destinataires, push_envoyes, reportes } | null, … },
//               (dernier envoi de chaque type ; null = jamais envoyé)
//     appareils_par_role: { admin: { utilisateurs, avec_appareil }, … },
//   }
//
// Lecture seule : aucune écriture, aucun envoi. Le réglage lui-même
// (planning_config.notifications_push) est lu et écrit par l'écran, comme
// les autres réglages.
//
// Accès : les tables notifications et push_subscriptions sont fermées au
// navigateur (journal du projet, 06/11/2026). Cette fonction (service role)
// identifie l'appelant exactement comme notifications-boite — utilisateur
// réel, collaborateur actif, rôle bureau — puis exige le rôle « admin »
// AVANT toute lecture. Elle ne renvoie que des comptes, jamais de nom,
// d'adresse d'appareil ni de contenu de notification.
// « Verify JWT » activé (supabase/config.toml).
// ─────────────────────────────────────────────────────────────────────────────

import { corsHeaders, identifierAppelant, json } from "../_partage/pushServeur.ts"
import { lireUtilisateurs } from "../_partage/utilisateursPush.ts"
import { CODES_TYPES, appareilsParRole, resumeEnvoi } from "../_partage/notificationsPushV1.mjs"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET") return json({ error: "Méthode non autorisée." }, 405)

  try {
    const qui = await identifierAppelant(req)
    if (!qui.ok) return qui.reponse
    if (String(qui.role).trim().toLowerCase() !== "admin") {
      return json({ error: "Réservé aux administrateurs." }, 403)
    }
    const { admin } = qui

    // Dernier envoi de chaque type : la ligne la plus récente donne la clé de
    // regroupement, puis toutes les lignes de ce même envoi.
    const par_type: Record<string, unknown> = {}
    for (const code of CODES_TYPES) {
      const { data: dernier, error } = await admin.from("notifications")
        .select("cle_regroupement, created_at").eq("type", code)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      if (error) throw new Error("Lecture du suivi des envois impossible.")
      if (!dernier) { par_type[code] = null; continue }
      let requete = admin.from("notifications").select("user_id, created_at, push_statut").eq("type", code)
      requete = dernier.cle_regroupement == null
        ? requete.is("cle_regroupement", null).eq("created_at", dernier.created_at)
        : requete.eq("cle_regroupement", dernier.cle_regroupement)
      const { data: lignes, error: e2 } = await requete.limit(1000)
      if (e2) throw new Error("Lecture du suivi des envois impossible.")
      par_type[code] = resumeEnvoi(lignes ?? [])
    }

    const utilisateurs = await lireUtilisateurs(admin)
    const { data: abonnements, error: errAbo } = await admin.from("push_subscriptions").select("user_id")
    if (errAbo) throw new Error("Lecture des appareils impossible.")
    const idsAvecAppareil = [...new Set((abonnements ?? []).map((a) => a.user_id))]

    return json({
      par_type,
      appareils_par_role: appareilsParRole({ utilisateurs, idsAvecAppareil }),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
