// ─────────────────────────────────────────────────────────────────────────────
// send-push — envoi des notifications sur téléphone (Web Push, clés VAPID) et
// écriture dans la boîte de réception (table notifications).
// Projet docs/projets/notifications-push.md, tâches 1 et 2.
//
// POST { mode: "test" } avec le jeton d'un collaborateur bureau
//   → notification de test sur tous SES appareils, écrite aussi dans SA boîte.
//     Fonctionne même interrupteur général coupé et en plage de silence
//     (c'est un test demandé à la main).
//
// POST { mode: "serveur", type, titre, texte, lien, cle_regroupement?, simulation? }
//   Réservé au serveur : en-tête « Authorization: Bearer <clé service role> »
//   (même clé que le dispatcher Vercel, SUPABASE_SERVICE_ROLE_KEY ; aucun
//   nouveau secret). Relit les réglages (planning_config.notifications_push) à
//   chaque appel, puis le moteur pur _partage/notificationsPushV1.mjs décide :
//   destinataires par rôle (jamais « ouvrier »), préférences, plage de silence
//   et report, regroupement (une notification par utilisateur, type et clé :
//   rejouer le même appel ne crée aucun doublon). Interrupteur général coupé ou
//   type désactivé → rien n'est envoyé ni écrit.
//   `simulation: true` → aucun envoi, aucune écriture : renvoie qui aurait
//   reçu quoi (calculé même interrupteur coupé, avec `bloque_par`).
//   Champ facultatif `groupe: { type, titre, texte, lien, ensemble: { titre,
//   texte, lien } }` (tâche 4, point du soir C1 + C2) : les deux types sont
//   planifiés et écrits en boîte chacun sous son type, mais une personne qui
//   reçoit les deux n'a qu'UN push (contenu `ensemble`). Voir
//   _partage/pushGroupeV1.mjs.
//
// POST { mode: "reportes" } — même secret serveur. Envoie les push reportés
//   dont l'heure est venue (job ?job=push_reportes du dispatcher), après avoir
//   revérifié interrupteur, type, préférence et plage de silence.
//
// Clés VAPID absentes : la notification est quand même écrite en boîte, avec
// push_statut « serveur_non_configure » (une impossibilité reste visible).
// Après chaque envoi : réponse 404 / 410 du service push → la ligne
// d'abonnement est supprimée ; succès → last_used_at mis à jour ; autre erreur
// → ligne gardée, échec signalé (pushRegles.suiteReponseService).
//
// GET : auto-contrôle sans envoi ni secret — vérifie que la bibliothèque
// charge et chiffre (clés jetables générées à la volée) et dit si les clés
// VAPID du serveur sont configurées. Sert au contrôle après déploiement.
//
// Bibliothèque : npm:web-push (chiffrement aes128gcm + signature VAPID).
// Secrets : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// « Verify JWT » activé (supabase/config.toml).
// ─────────────────────────────────────────────────────────────────────────────

import webpush from "npm:web-push@3.6.7"
import { createECDH, randomBytes } from "node:crypto"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  clientServeur, corsHeaders, estAppelServeur, identifierAppelant, json, lireClesVapid,
} from "../_partage/pushServeur.ts"
import {
  chargeUtileTest, resumerEnvoi, suiteReponseService, validerDemandeSendPush,
} from "../_partage/pushRegles.mjs"
import {
  CLE_REGLAGES, TYPE_TEST, chargeUtile, decisionRattrapage, normaliserReglages, planifierEnvoi,
  planifierTest, preferenceActive, statutApresEnvoi, validerContenu,
} from "../_partage/notificationsPushV1.mjs"
import { lireUtilisateurs } from "../_partage/utilisateursPush.ts"
import { envoisParPersonne, simulationParPersonne, validerGroupe } from "../_partage/pushGroupeV1.mjs"

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

const iso = (ms: number | null | undefined) => (typeof ms === "number" ? new Date(ms).toISOString() : null)

/** Envoie une notification de la boîte à tous les appareils de son destinataire, puis note le résultat. */
async function pousserNotification(
  admin: SupabaseClient,
  notif: { id: string; type: string; titre: string; texte: string; lien: string },
  appareils: Abonnement[],
): Promise<{ statut: string; resultats: Resultat[] }> {
  const resultats = await envoyerAuxAppareils(admin, appareils, chargeUtile(notif))
  const statut = statutApresEnvoi(resultats)
  await admin.from("notifications").update({
    push_statut: statut,
    push_envoye_le: statut === "envoye" ? new Date().toISOString() : null,
  }).eq("id", notif.id)
  return { statut, resultats }
}

async function lireReglages(admin: SupabaseClient) {
  const { data, error } = await admin.from("planning_config").select("value").eq("key", CLE_REGLAGES).maybeSingle()
  if (error) throw new Error("Lecture des réglages de notification impossible.")
  return normaliserReglages(data?.value ?? null)
}

async function lireAppareils(admin: SupabaseClient, ids: string[]) {
  const parUtilisateur: Record<string, Abonnement[]> = {}
  if (!ids.length) return parUtilisateur
  const { data, error } = await admin.from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, appareil").in("user_id", ids)
  if (error) throw new Error("Lecture des abonnements impossible.")
  for (const a of data ?? []) (parUtilisateur[a.user_id] ??= []).push(a as Abonnement)
  return parUtilisateur
}

async function lirePreferences(admin: SupabaseClient, ids: string[]) {
  const prefs: Record<string, Record<string, boolean>> = {}
  if (!ids.length) return prefs
  const { data, error } = await admin.from("notifications_preferences").select("user_id, types").in("user_id", ids)
  if (error) throw new Error("Lecture des préférences impossible.")
  for (const p of data ?? []) prefs[p.user_id] = p.types ?? {}
  return prefs
}

// lireUtilisateurs : _partage/utilisateursPush.ts (même lecture que
// notifications-pilotage, pour les appareils par rôle).

/** Envoie UN push (contenu `notif`) aux appareils d'une personne, puis note le résultat sur toutes ses lignes `ids`. */
async function pousserEnvoiGroupe(
  admin: SupabaseClient,
  ids: string[],
  notif: { type: string; titre: string; texte: string; lien: string },
  appareils: Abonnement[],
): Promise<string> {
  const resultats = await envoyerAuxAppareils(admin, appareils, chargeUtile(notif))
  const statut = statutApresEnvoi(resultats)
  await admin.from("notifications").update({
    push_statut: statut,
    push_envoye_le: statut === "envoye" ? new Date().toISOString() : null,
  }).in("id", ids)
  return statut
}

// ── Mode « serveur » : un type du catalogue, destinataires par rôle ─────────
async function modeServeur(admin: SupabaseClient, corps: unknown) {
  const contenu = validerContenu(corps)
  if (!contenu.ok) return json({ error: contenu.erreur }, contenu.statut)
  // Envoi groupé (ex. point du soir C1 + C2) : traité à part, voir _partage/pushGroupeV1.mjs.
  const g = validerGroupe(corps, contenu)
  if (!g.ok) return json({ error: g.erreur }, g.statut)
  if (g.groupe) return await modeServeurGroupe(admin, contenu as unknown as Contenu, g.groupe as Groupe)
  const maintenant = Date.now()
  const reglages = await lireReglages(admin)
  const utilisateurs = await lireUtilisateurs(admin)
  const ids = utilisateurs.map((u) => u.auth_id).filter(Boolean) as string[]
  const [appareils, preferences] = await Promise.all([lireAppareils(admin, ids), lirePreferences(admin, ids)])
  const cles = lireClesVapid()

  // Regroupement : qui a déjà cette notification (même type, même clé) ?
  const avant = planifierEnvoi({ reglages, type: contenu.type, cle: contenu.cle_regroupement ?? undefined,
    utilisateurs: [], maintenantMs: maintenant, vapidConfiguree: cles.ok })
  const { data: deja, error: errDeja } = await admin.from("notifications").select("user_id")
    .eq("type", contenu.type).eq("cle_regroupement", avant.cle)
  if (errDeja) throw new Error("Lecture de la boîte de réception impossible.")

  const nbAppareils: Record<string, number> = {}
  for (const [id, l] of Object.entries(appareils)) nbAppareils[id] = l.length
  const plan = planifierEnvoi({
    reglages, type: contenu.type, cle: avant.cle, utilisateurs, preferences, appareils: nbAppareils,
    dejaNotifies: (deja ?? []).map((d) => d.user_id), maintenantMs: maintenant,
    vapidConfiguree: cles.ok, simulation: contenu.simulation,
  })
  if (!plan.ok) return json({ error: plan.erreur }, 400)
  const resume = { ...plan.resume, prochain_creneau: iso(plan.resume.prochain_creneau), avertissements: reglages.avertissements }

  if (contenu.simulation) {
    return json({
      ok: true, simulation: true, resume,
      detail: plan.lignes.map((l) => ({ role: l.role, nom: l.nom, push_statut: l.push_statut, push_prevu_le: iso(l.push_prevu_le) })),
    })
  }
  if (!plan.lignes.length) return json({ ok: true, simulation: false, resume, envoyes: 0, echecs: 0 })

  // Écriture en boîte AVANT l'envoi. L'index unique (user_id, type,
  // cle_regroupement) garantit l'absence de doublon même si deux passages se
  // croisent : seules les lignes réellement créées sont envoyées.
  const { data: crees, error: errIns } = await admin.from("notifications").upsert(
    plan.lignes.map((l) => ({
      user_id: l.user_id, type: contenu.type, titre: contenu.titre, texte: contenu.texte, lien: contenu.lien,
      cle_regroupement: plan.cle, push_statut: l.push_statut, push_prevu_le: iso(l.push_prevu_le),
    })),
    { onConflict: "user_id,type,cle_regroupement", ignoreDuplicates: true },
  ).select("id, user_id, type, titre, texte, lien, push_statut")
  if (errIns) throw new Error("Écriture dans la boîte de réception impossible.")

  if (cles.ok) webpush.setVapidDetails(cles.sujet, cles.publique, cles.privee)
  let envoyes = 0, echecs = 0, ecrites = 0
  for (const n of crees ?? []) {
    ecrites++
    if (n.push_statut !== "a_envoyer" || !cles.ok) continue
    const { statut } = await pousserNotification(admin, n, appareils[n.user_id] ?? [])
    if (statut === "envoye") envoyes++; else echecs++
  }
  return json({
    ok: true, simulation: false, resume,
    ecrites_en_boite: ecrites, doublons_evites: plan.lignes.length - ecrites + resume.doublons, envoyes, echecs,
  })
}

// ── Mode « serveur » groupé : deux types, un seul push par personne ─────────
// Chaque type est planifié et écrit en boîte séparément (rôles, interrupteur
// du type, préférence de chacun, silence : moteur inchangé) ; seul le push
// est réuni par personne (pushGroupeV1.envoisParPersonne).
type Contenu = { type: string; titre: string; texte: string; lien: string; cle_regroupement: string | null; simulation: boolean }
type Groupe = { type: string; titre: string; texte: string; lien: string; ensemble: { titre: string; texte: string; lien: string } }

async function modeServeurGroupe(admin: SupabaseClient, contenu: Contenu, groupe: Groupe) {
  const maintenant = Date.now()
  const reglages = await lireReglages(admin)
  const utilisateurs = await lireUtilisateurs(admin)
  const ids = utilisateurs.map((u) => u.auth_id).filter(Boolean) as string[]
  const [appareils, preferences] = await Promise.all([lireAppareils(admin, ids), lirePreferences(admin, ids)])
  const cles = lireClesVapid()
  const cle = contenu.cle_regroupement as string
  const nbAppareils: Record<string, number> = {}
  for (const [id, l] of Object.entries(appareils)) nbAppareils[id] = l.length

  const parties = [
    { type: contenu.type, titre: contenu.titre, texte: contenu.texte, lien: contenu.lien },
    { type: groupe.type, titre: groupe.titre, texte: groupe.texte, lien: groupe.lien },
  ]
  const plans = []
  for (const p of parties) {
    const { data: deja, error: errDeja } = await admin.from("notifications").select("user_id")
      .eq("type", p.type).eq("cle_regroupement", cle)
    if (errDeja) throw new Error("Lecture de la boîte de réception impossible.")
    const plan = planifierEnvoi({
      reglages, type: p.type, cle, utilisateurs, preferences, appareils: nbAppareils,
      dejaNotifies: (deja ?? []).map((d) => d.user_id), maintenantMs: maintenant,
      vapidConfiguree: cles.ok, simulation: contenu.simulation,
    })
    if (!plan.ok) return json({ error: plan.erreur }, 400)
    plans.push({ partie: p, plan })
  }
  const resumes = plans.map(({ plan }) => ({
    ...plan.resume, prochain_creneau: iso(plan.resume.prochain_creneau), avertissements: reglages.avertissements,
  }))

  if (contenu.simulation) {
    return json({
      ok: true, simulation: true, groupe: true, resume: resumes[0], resume_groupe: resumes[1],
      par_personne: simulationParPersonne({
        lignesPrincipal: plans[0].plan.lignes, lignesGroupe: plans[1].plan.lignes,
        typePrincipal: contenu.type, typeGroupe: groupe.type,
      }),
    })
  }

  // Écriture en boîte AVANT l'envoi, chaque type sous son propre type et son
  // propre texte. Index unique (user_id, type, cle_regroupement) : aucun doublon.
  const crees: Array<{ id: string; user_id: string; type: string; titre: string; texte: string; lien: string; push_statut: string }> = []
  for (const { partie, plan } of plans) {
    if (!plan.lignes.length) continue
    const { data, error } = await admin.from("notifications").upsert(
      plan.lignes.map((l) => ({
        user_id: l.user_id, type: partie.type, titre: partie.titre, texte: partie.texte, lien: partie.lien,
        cle_regroupement: cle, push_statut: l.push_statut, push_prevu_le: iso(l.push_prevu_le),
      })),
      { onConflict: "user_id,type,cle_regroupement", ignoreDuplicates: true },
    ).select("id, user_id, type, titre, texte, lien, push_statut")
    if (error) throw new Error("Écriture dans la boîte de réception impossible.")
    crees.push(...(data ?? []))
  }

  let envoyes = 0, echecs = 0
  if (cles.ok && crees.length) {
    webpush.setVapidDetails(cles.sujet, cles.publique, cles.privee)
    for (const e of envoisParPersonne({ lignes: crees, typePrincipal: contenu.type, ensemble: groupe.ensemble })) {
      const statut = await pousserEnvoiGroupe(admin, e.ids, e.notif, appareils[e.user_id] ?? [])
      if (statut === "envoye") envoyes++; else echecs++
    }
  }
  return json({
    ok: true, simulation: false, groupe: true, resume: resumes[0], resume_groupe: resumes[1],
    ecrites_en_boite: crees.length, envoyes, echecs,
  })
}

// ── Mode « reportes » : rattrapage des push reportés dont l'heure est venue ──
async function modeReportes(admin: SupabaseClient) {
  const maintenant = Date.now()
  const { data: dus, error } = await admin.from("notifications")
    .select("id, user_id, type, titre, texte, lien")
    .eq("push_statut", "reporte").lte("push_prevu_le", new Date(maintenant).toISOString())
    .order("push_prevu_le", { ascending: true }).limit(500)
  if (error) throw new Error("Lecture des notifications reportées impossible.")
  if (!dus?.length) return json({ ok: true, dues: 0, envoyes: 0, echecs: 0, autres: {} })

  const reglages = await lireReglages(admin)
  const ids = [...new Set(dus.map((n) => n.user_id))]
  const [appareils, preferences] = await Promise.all([lireAppareils(admin, ids), lirePreferences(admin, ids)])
  const cles = lireClesVapid()
  if (cles.ok) webpush.setVapidDetails(cles.sujet, cles.publique, cles.privee)

  let envoyes = 0, echecs = 0
  const autres: Record<string, number> = {}
  for (const n of dus) {
    const d = decisionRattrapage({
      reglages, type: n.type, prefActive: preferenceActive(preferences[n.user_id], n.type),
      nbAppareils: (appareils[n.user_id] ?? []).length, vapidConfiguree: cles.ok, maintenantMs: maintenant,
    })
    if (d.push_statut === "a_envoyer") {
      const { statut } = await pousserNotification(admin, n, appareils[n.user_id] ?? [])
      if (statut === "envoye") envoyes++; else echecs++
      continue
    }
    await admin.from("notifications").update({ push_statut: d.push_statut, push_prevu_le: iso(d.push_prevu_le) })
      .eq("id", n.id).eq("push_statut", "reporte")
    autres[d.push_statut] = (autres[d.push_statut] ?? 0) + 1
  }
  return json({ ok: true, dues: dus.length, envoyes, echecs, autres, configure: cles.ok })
}

// ── Mode « test » : l'utilisateur connecté, ses propres appareils ───────────
async function modeTest(req: Request) {
  const qui = await identifierAppelant(req)
  if (!qui.ok) return qui.reponse

  const cles = lireClesVapid()
  const { data: abonnements, error } = await qui.admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, appareil")
    .eq("user_id", qui.userId)
  if (error) return json({ error: "Lecture des abonnements impossible." }, 500)

  // Le test est écrit dans la boîte de l'appelant dans tous les cas, avec son
  // statut réel (serveur non configuré, aucun appareil…).
  const charge = chargeUtileTest()
  const plan = planifierTest({ nbAppareils: abonnements?.length ?? 0, vapidConfiguree: cles.ok })
  const { data: notif, error: errIns } = await qui.admin.from("notifications").insert({
    user_id: qui.userId, type: TYPE_TEST, titre: charge.title, texte: charge.body, lien: charge.url,
    cle_regroupement: null, push_statut: plan.push_statut,
  }).select("id").single()
  if (errIns) console.warn("send-push : écriture du test en boîte impossible", errIns.message)

  if (!cles.ok) return json({ configure: false, code: cles.code, error: cles.erreur, ecrit_en_boite: !errIns }, cles.statut)
  if (!abonnements?.length) {
    return json({ ok: false, code: "aucun_appareil", error: "Aucun appareil enregistré : activez d'abord les notifications.", ecrit_en_boite: !errIns }, 409)
  }
  webpush.setVapidDetails(cles.sujet, cles.publique, cles.privee)
  const resultats = await envoyerAuxAppareils(qui.admin, abonnements as Abonnement[], charge)
  const resume = resumerEnvoi(resultats)
  if (notif?.id) {
    const statut = statutApresEnvoi(resultats)
    await qui.admin.from("notifications").update({
      push_statut: statut, push_envoye_le: statut === "envoye" ? new Date().toISOString() : null,
    }).eq("id", notif.id)
  }
  return json({
    ok: resume.envoyes > 0,
    ...resume,
    ecrit_en_boite: !errIns,
    details: resultats.map(({ appareil, ok, statut, suite }) => ({ appareil, ok, statut, suite })),
  })
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
    const corps = await req.json().catch(() => ({}))
    const demande = validerDemandeSendPush(corps)
    if (!demande.ok) return json({ error: demande.erreur }, demande.statut)

    if (demande.serveur) {
      // Secret serveur vérifié AVANT toute lecture.
      if (!estAppelServeur(req)) return json({ error: "Réservé aux appels du serveur." }, 401)
      const admin = clientServeur()
      if (!admin) return json({ error: "Configuration serveur incomplète." }, 500)
      return demande.mode === "reportes" ? await modeReportes(admin) : await modeServeur(admin, corps)
    }
    return await modeTest(req)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
