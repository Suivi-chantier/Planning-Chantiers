// ─────────────────────────────────────────────────────────────────────────────
// send-push — envoi des notifications sur téléphone (Web Push, clés VAPID).
// Projet docs/projets/notifications-push.md.
//
// Tâche 1 (ici) : mode « test » seulement.
//   POST { mode: "test" } avec le jeton d'un collaborateur bureau
//   → envoie la notification de test à tous SES appareils enregistrés,
//     même quand l'interrupteur général (tâche 2) est coupé.
//
// Tâche 2 (à venir, refusé ici avec 501) : mode « serveur ».
//   Appel serveur muni d'un secret (en-tête dédié), destinataires par rôle
//   (jamais « ouvrier »), interrupteur général, préférences, plage de silence
//   et report, écriture dans la boîte de réception. La boucle d'envoi
//   `envoyerAuxAppareils` ci-dessous est celle que le mode serveur réutilisera.
//
// Après chaque envoi : réponse 404 / 410 du service push → la ligne
// d'abonnement est supprimée ; succès → last_used_at mis à jour ; autre erreur
// → ligne gardée, échec signalé (pushRegles.suiteReponseService).
//
// GET : auto-contrôle sans envoi ni secret — vérifie que la bibliothèque
// charge et chiffre (clés jetables générées à la volée) et dit si les clés
// VAPID du serveur sont configurées. Sert au contrôle après déploiement.
//
// Bibliothèque : npm:web-push (chiffrement aes128gcm + signature VAPID).
// Secrets : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. Absents → 503.
// « Verify JWT » activé (supabase/config.toml).
// ─────────────────────────────────────────────────────────────────────────────

import webpush from "npm:web-push@3.6.7"
import { createECDH, randomBytes } from "node:crypto"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, identifierAppelant, json, lireClesVapid } from "../_partage/pushServeur.ts"
import {
  chargeUtileTest, resumerEnvoi, suiteReponseService, validerDemandeSendPush,
} from "../_partage/pushRegles.mjs"

type Abonnement = { id: string; endpoint: string; p256dh: string; auth: string; appareil: string | null }
type Resultat = { id: string; appareil: string | null; ok: boolean; statut: number | null; suite: string }

async function envoyerAuxAppareils(
  admin: SupabaseClient,
  abonnements: Abonnement[],
  charge: Record<string, unknown>,
): Promise<Resultat[]> {
  const corps = JSON.stringify(charge)
  const resultats: Resultat[] = []
  for (const a of abonnements) {
    let statut: number | null = null
    try {
      const rep = await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        corps,
        { TTL: 60 * 60 * 12, urgency: "normal" },
      )
      statut = rep?.statusCode ?? 201
    } catch (err) {
      statut = typeof (err as { statusCode?: number })?.statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : null
      console.warn("send-push : échec d'envoi", a.appareil, statut, (err as Error)?.message)
    }
    const suite = suiteReponseService(statut)
    if (suite === "supprimer") {
      await admin.from("push_subscriptions").delete().eq("id", a.id)
    } else if (suite === "marquer_utilise") {
      await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", a.id)
    }
    resultats.push({ id: a.id, appareil: a.appareil, ok: suite === "marquer_utilise", statut, suite })
  }
  return resultats
}

/** Chiffre un message pour un abonnement fictif, avec des clés jetables. Aucun envoi. */
function autoControleChiffrement(): { ok: boolean; erreur?: string } {
  try {
    const vapid = webpush.generateVAPIDKeys()
    const ecdh = createECDH("prime256v1")
    ecdh.generateKeys()
    const details = webpush.generateRequestDetails(
      {
        endpoint: "https://exemple.invalid/push/autocontrole",
        keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
      },
      "autocontrole",
      { vapidDetails: { subject: "mailto:autocontrole@exemple.invalid", publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
    )
    const ok = !!details?.body && String(details?.headers?.Authorization || "").startsWith("vapid ")
    return ok ? { ok } : { ok, erreur: "Requête chiffrée incomplète." }
  } catch (err) {
    return { ok: false, erreur: (err as Error).message }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method === "GET") {
    const chiffrement = autoControleChiffrement()
    const cles = lireClesVapid()
    return json({
      bibliotheque: "web-push 3.6.7",
      chiffrement_ok: chiffrement.ok,
      ...(chiffrement.erreur ? { chiffrement_erreur: chiffrement.erreur } : {}),
      configure: cles.ok,
      ...(cles.ok ? {} : { manquantes: cles.manquantes }),
    }, chiffrement.ok ? 200 : 500)
  }
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405)

  try {
    const demande = validerDemandeSendPush(await req.json().catch(() => ({})))
    if (!demande.ok) return json({ error: demande.erreur }, demande.statut)

    // ── Mode « test » : l'utilisateur connecté, ses propres appareils ───────
    const qui = await identifierAppelant(req)
    if (!qui.ok) return qui.reponse

    const cles = lireClesVapid()
    if (!cles.ok) return json({ configure: false, code: cles.code, error: cles.erreur }, cles.statut)
    webpush.setVapidDetails(cles.sujet, cles.publique, cles.privee)

    const { data: abonnements, error } = await qui.admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, appareil")
      .eq("user_id", qui.userId)
    if (error) return json({ error: "Lecture des abonnements impossible." }, 500)
    if (!abonnements?.length) {
      return json({ ok: false, code: "aucun_appareil", error: "Aucun appareil enregistré : activez d'abord les notifications." }, 409)
    }

    const resultats = await envoyerAuxAppareils(qui.admin, abonnements as Abonnement[], chargeUtileTest())
    const resume = resumerEnvoi(resultats)
    return json({
      ok: resume.envoyes > 0,
      ...resume,
      details: resultats.map(({ appareil, ok, statut, suite }) => ({ appareil, ok, statut, suite })),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
