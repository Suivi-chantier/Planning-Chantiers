import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import {
  LIMITES, ROLES_AUTORISES,
  extraireJeton, validerCorps, verifierProfil, verifierTailleAnnoncee,
} from "./validation.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// analyse-commande
// Lecture d'un bon de livraison / ticket / bon de commande par Anthropic.
//
// CETTE FONCTION ÉTAIT OUVERTE. Déployée avec verify_jwt = false et SANS aucun
// contrôle interne, n'importe qui connaissant son URL pouvait faire analyser un
// document par claude-opus-4-8 aux frais de l'entreprise. Deux verrous la
// ferment désormais :
//   1. la passerelle Supabase — verify_jwt = true, déclaré dans config.toml ;
//   2. ce fichier — jeton réellement validé, profil métier relu en base, rôle
//      vérifié. Le verrou 2 ne suppose jamais que le verrou 1 a fonctionné.
//
// L'ORDRE EST LA SÉCURITÉ, et il n'est pas négociable :
//   1. OPTIONS                      → CORS
//   2. méthode ≠ POST               → 405
//   3. en-tête Authorization absent
//      ou mal formé                 → 401
//   4. jeton validé auprès de Supabase (auth.getUser)
//   5. profil relu dans `utilisateurs`
//   6. profil inactif               → 403
//   7. rôle hors admin/conducteur/comptable → 403
//   8. SEULEMENT ICI : lecture et validation du corps
//   9. SEULEMENT ICI : appel à Anthropic
// Aucun document n'est donc lu, décodé ni transmis avant que l'appelant soit
// authentifié ET autorisé.
//
// D'OÙ VIENT L'AUTORISATION : de la base, jamais du navigateur. Le client
// Supabase est BORNÉ AU JETON de l'appelant (clé publique + son Authorization) ;
// la RLS `utilisateurs_select` (auth.email() = email OR is_admin()) lui laisse
// lire sa propre ligne, et rien d'autre. Aucun client privilégié n'est
// construit ici : le service_role n'a rien à faire dans une fonction qui ne
// fait que lire un rôle. Ni `user_metadata`, ni un rôle transmis dans le corps
// ne sont consultés — ce sont deux sources que l'appelant contrôle.
//
// CE QUI N'A PAS CHANGÉ, volontairement : le modèle, max_tokens, le prompt
// métier et le format de la réponse rendue au navigateur.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

// Refus : un code stable pour le client, un message lisible, et RIEN d'autre.
// Jamais de jeton, de clé, d'extrait de document, d'identité ni de détail de
// configuration — un message d'erreur ne doit rien apprendre à un attaquant.
const refus = (r: { status: number; code: string; message: string }) =>
  json({ error: { code: r.code, message: r.message } }, r.status)

serve(async (req) => {
  const t0 = Date.now()

  // ── 1. CORS ────────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // ── 2. Méthode ─────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return refus({ status: 405, code: "METHODE_NON_AUTORISEE", message: "Méthode non autorisée." })
  }

  try {
    // ── 3. En-tête Authorization ─────────────────────────────────────────
    const jeton = extraireJeton(req.headers.get("Authorization"))
    if (!jeton.ok) return refus(jeton)

    // ── 4. Le jeton est-il VRAIMENT valide ? ─────────────────────────────
    // Client borné au jeton de l'appelant : il ne peut rien faire de plus que
    // lui. La clé publique ne confère aucun privilège.
    const url = Deno.env.get("SUPABASE_URL") || ""
    const clePublique = Deno.env.get("SUPABASE_ANON_KEY") || ""
    if (!url || !clePublique) {
      console.error("[analyse-commande] configuration serveur incomplète")
      return refus({ status: 500, code: "CONFIG_SERVEUR", message: "Service momentanément indisponible." })
    }
    const client = createClient(url, clePublique, {
      global: { headers: { Authorization: `Bearer ${jeton.jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: erreurAuth } = await client.auth.getUser()
    if (erreurAuth || !user?.email) {
      console.warn(`[analyse-commande] refus 401 : jeton invalide (${Date.now() - t0} ms)`)
      return refus({ status: 401, code: "JETON_INVALIDE", message: "Authentification requise." })
    }

    // ── 5, 6, 7. Profil métier : actif, et rôle autorisé ─────────────────
    // La jointure se fait par e-mail : `utilisateurs` n'a pas de clé étrangère
    // vers auth.users (colonnes réelles : id, email, nom, role, actif, …).
    // C'est la convention déjà suivie par les autres Edge Functions.
    const { data: profil } = await client
      .from("utilisateurs")
      .select("role,actif")
      .eq("email", user.email.toLowerCase())
      .maybeSingle()

    const autorisation = verifierProfil(profil)
    if (!autorisation.ok) {
      // Le code du refus suffit à diagnostiquer : ni e-mail, ni identifiant.
      console.warn(`[analyse-commande] refus 403 : ${autorisation.code} (${Date.now() - t0} ms)`)
      return refus(autorisation)
    }

    // ── 8. Le corps, enfin ───────────────────────────────────────────────
    // Refus précoce sur la taille annoncée : elle évite de lire 50 Mo pour
    // rien. Ce n'est qu'un indice fourni par l'appelant — la taille réelle est
    // recontrôlée après décodage, dans validerCorps.
    const annonce = verifierTailleAnnoncee(req.headers.get("Content-Length"))
    if (!annonce.ok) {
      console.warn(`[analyse-commande] refus 413 : ${annonce.code} (rôle ${autorisation.role})`)
      return refus(annonce)
    }

    let corps: unknown = null
    try {
      corps = await req.json()
    } catch {
      return refus({ status: 400, code: "JSON_INVALIDE", message: "Corps de requête illisible : JSON attendu." })
    }

    const valide = validerCorps(corps)
    if (!valide.ok) {
      console.warn(`[analyse-commande] refus ${valide.status} : ${valide.code} (rôle ${autorisation.role})`)
      return refus(valide)
    }

    // ── 9. Anthropic, et pas avant ───────────────────────────────────────
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")
    if (!ANTHROPIC_KEY) {
      // Le client n'apprend ni le nom du secret ni sa nature.
      console.error("[analyse-commande] clé d'analyse absente de la configuration")
      return refus({ status: 500, code: "CONFIG_SERVEUR", message: "Service momentanément indisponible." })
    }

    const mkBlock = (img: { base64: string; mediaType: string }) => (img.mediaType === "application/pdf")
      ? { type: "document", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
      : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
    const contentBlocks = valide.images.map(mkBlock)

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Pour réduire le coût sur gros volume : remplacer par "claude-sonnet-4-6"
        model: "claude-opus-4-8",
        // Un gros BL (ex. 38 lignes sur 5 pages) génère un JSON > 3000 tokens :
        // la réponse était tronquée et le JSON.parse échouait. On monte le plafond.
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: [
            ...contentBlocks,
            {
              type: "text",
              text: `Tu es un assistant spécialisé dans l'analyse de documents d'achat BTP
(bons de livraison, tickets de comptoir, bons de commande).
ATTENTION : le document peut être réparti sur PLUSIEURS images/pages ci-dessus.
Considère-les comme UN SEUL document : un seul en-tête (fournisseur, numéro, date,
total) et UNE SEULE liste de lignes cumulant les articles de toutes les pages.
Extrais l'en-tête du document ET TOUTES les lignes de produits/matériaux.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans backticks.
Format :
{
  "fournisseur": "nom du fournisseur si détecté, sinon chaîne vide",
  "doc_type": "bl | ticket | bon_commande (le type du document ; 'bl' pour un bon de livraison, 'ticket' pour un ticket de caisse/comptoir, 'bon_commande' pour un bon de commande)",
  "doc_numero": "le numéro du document (n° de BL, ticket, bon de commande) ou null si introuvable",
  "date_doc": "date du document au format AAAA-MM-JJ, ou null",
  "montant_ht": nombre (total HT du document) ou null,
  "lignes": [
    {
      "designation": "nom exact du produit",
      "reference": "référence si présente, sinon chaîne vide",
      "quantite": "quantité ex: 10 ou 5 m²",
      "prix_unitaire": nombre ou null,
      "prix_total": nombre ou null
    }
  ]
}
Ne pas inclure totaux, TVA, frais de port dans les LIGNES (le total HT va dans montant_ht).
Prix en nombres décimaux. Cherche activement le numéro de document : il est souvent
en haut à droite, libellé "BL", "Bon de livraison", "Ticket", "N°", "Commande".

RÈGLE IMPORTANTE POUR LES BONS DE LIVRAISON (doc_type = "bl") :
Un BL a souvent trois colonnes de quantité : "Quantité commandée", "Quantité livrée"
et "Reste à livrer". Dans ce cas :
- N'INCLUS PAS dans "lignes" les articles dont la quantité LIVRÉE est 0 (montant H.T.
  vide) : ce sont des articles commandés mais pas encore livrés, ils figureront sur un
  futur BL. Ils doivent être totalement ignorés.
- Pour les lignes que tu gardes, le champ "quantite" doit être la quantité LIVRÉE
  (celle réellement reçue sur ce BL), pas la quantité commandée. Ex. livrée 4 / reste 2
  → quantite = 4.
Cette règle ne s'applique QUE s'il existe une colonne "Quantité livrée" distincte
(cas des BL). Pour un ticket ou un bon de commande sans cette colonne, prends la
quantité telle qu'affichée.

RÈGLE PRIX — TOUJOURS EN HT (hors taxes), JAMAIS EN TTC :
Les champs prix_unitaire, prix_total et montant_ht doivent TOUJOURS être hors taxes.
Attention : beaucoup de tickets/factures de magasin (ex. Leroy Merlin, Castorama,
Brico Dépôt) affichent leurs colonnes en TTC ("Prix unit. TTC", "Total TTC"). Dans
ce cas, n'utilise PAS ces montants TTC tels quels :
- Si la ligne indique un "Montant HT" (souvent dans le petit texte sous la
  désignation, avec le taux et le montant de TVA), utilise ce Montant HT comme
  prix_total de la ligne (c'est le total HT de la ligne, quantité comprise).
- Sinon, calcule le HT à partir du TTC et du taux de TVA de la ligne :
  HT = TTC / (1 + taux/100). Ex. 38,85 TTC à 20% -> 32,37 HT.
- prix_unitaire = prix_total (HT) / quantité.
Pour montant_ht, prends le "Total HT" du document (ex. "Total HT 166,48"), jamais
le "Total TTC". Ne renvoie jamais un montant TTC dans ces champs.

REMISE GLOBALE (remise fidélité, remise globale, avoir) :
Si le document applique une remise sur le TOTAL qui n'est PAS déjà déduite ligne
par ligne (ex. "remise fidélité" chez Leroy Merlin), tu dois la RÉPARTIR sur les
lignes pour refléter le montant réellement payé :
- Calcule d'abord le HT de chaque ligne (voir règle prix ci-dessus).
- Puis réduis proportionnellement chaque prix_total ET prix_unitaire pour que la
  SOMME des prix_total soit EXACTEMENT égale au Total HT APRÈS remise du document.
- montant_ht = ce Total HT APRÈS remise (le vrai montant payé HT), jamais le total
  avant remise.
Exemple : lignes = 184,98 € HT avant remise, Total HT après remise fidélité =
166,48 € → multiplie chaque ligne par 166,48 / 184,98 ≈ 0,9000, et montant_ht =
166,48. Ne crée PAS de ligne "remise" séparée : la remise est fondue dans les prix.`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    // Journal : de quoi diagnostiquer, rien de plus. Ni document, ni réponse
    // brute, ni identité, ni clé.
    console.log(`[analyse-commande] ok rôle=${autorisation.role} pages=${valide.images.length} anthropic=${response.status} (${Date.now() - t0} ms)`)
    // Format de réponse INCHANGÉ : le navigateur reçoit ce qu'Anthropic renvoie,
    // exactement comme avant.
    return json(data, 200)
  } catch (err) {
    // Le message d'exception peut contenir n'importe quoi : il ne sort pas.
    console.error(`[analyse-commande] erreur interne (${Date.now() - t0} ms)`)
    return refus({ status: 500, code: "ERREUR_INTERNE", message: "L'analyse a échoué. Réessayez." })
  }
})
