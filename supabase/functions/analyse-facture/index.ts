import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4"
import {
  extraireJeton, validerCorps, verifierProfil, verifierTailleAnnoncee,
} from "./validation.mjs"

// ─────────────────────────────────────────────────────────────────────────────
// analyse-facture
// Lecture d'une facture fournisseur (éventuellement multipages) par Anthropic,
// pour l'écran « Rapprochement factures ».
//
// CETTE FONCTION N'AVAIT AUCUN CONTRÔLE INTERNE jusqu'au 25/11/2026. La
// passerelle Supabase exigeait un jeton (verify_jwt = true), mais la clé
// publique « anon », lisible dans le navigateur, en est un : n'importe qui la
// possédant pouvait faire lire un document par le modèle aux frais de
// l'entreprise. Elle suit désormais les mêmes verrous que analyse-commande.
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
// la RLS `utilisateurs_select` lui laisse lire sa propre ligne, et rien
// d'autre. Aucun client privilégié n'est construit ici. Ni `user_metadata`, ni
// un rôle transmis dans le corps ne sont consultés.
//
// CE QUI N'A PAS CHANGÉ, volontairement : le modèle, max_tokens, le prompt et
// le format de la réponse rendue au navigateur en cas de succès.
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

// Où lire les références d'un BL selon le fournisseur. « Votre commande » chez
// Rexel est la référence DU CLIENT (souvent un nom de chantier), jamais un
// numéro de commande fournisseur.
const REGLES_REFERENCES = `Références d'un BL :
- date_livraison : date d'expédition ou de livraison du BL (Rexel : « expédié le »).
- commande_numero : numéro de commande DU FOURNISSEUR (Rexel : « Notre Réf », Partedis : « Cde No », Zolpan : « N° Cde »).
- reference_client : référence donnée PAR LE CLIENT (Rexel : « Votre commande » suivi de « Chantier n° », Partedis : « V/ref client », Zolpan : « Réf. de cde client »).
- « Votre commande : FOURMOND » est une référence client, jamais un numéro de commande.`

function consigneBlCible(bl: string): string {
  return `Tu lis une facture fournisseur BTP, éventuellement multipages.
Extrais UNIQUEMENT le bon de livraison n° ${bl} (ignore tous les autres BL).
Réponds uniquement par un objet JSON valide. N'invente jamais un numéro ou un montant.
Format attendu :
{
 "bl_numero": "numéro du BL tel qu'imprimé",
 "date_bl": "AAAA-MM-JJ ou null",
 "commande_numero": "numéro de commande fournisseur ou null",
 "reference_client": "référence client ou null",
 "montant_ht": 0.0,
 "lignes": [
  {"reference":"référence article ou chaîne vide","libelle":"désignation","quantite":0.0,"unite":"U","prix_unitaire":0.0,"prix_total":0.0}
 ],
 "incertitudes": ["motif éventuel"]
}
${REGLES_REFERENCES}
- date_bl : date d'expédition ou de livraison de CE BL.
- montant_ht : sous-total HT imprimé pour ce BL ; à défaut, somme des totaux de ses lignes.
- Une ligne par article. prix_total = montant total HT imprimé de la ligne, jamais recalculé.
- Éco-participations (DEEE, ES1408…) : une ligne séparée « Éco-participation » avec sa référence, placée juste après l'article concerné.
- Participation énergie propre à ce BL (ex. Partedis « Énergie ») : une ligne séparée « Participation énergie », comprise dans montant_ht.
- La somme des prix_total doit égaler montant_ht ; sinon, explique l'écart dans incertitudes.
- Les montants non lisibles sont null, jamais zéro par défaut.
- Si ce BL n'apparaît pas sur la facture : "lignes": [] et une incertitude « BL introuvable ».`
}

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
      console.error("[analyse-facture] configuration serveur incomplète")
      return refus({ status: 500, code: "CONFIG_SERVEUR", message: "Service momentanément indisponible." })
    }
    const client = createClient(url, clePublique, {
      global: { headers: { Authorization: `Bearer ${jeton.jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: erreurAuth } = await client.auth.getUser()
    if (erreurAuth || !user?.email) {
      console.warn(`[analyse-facture] refus 401 : jeton invalide (${Date.now() - t0} ms)`)
      return refus({ status: 401, code: "JETON_INVALIDE", message: "Authentification requise." })
    }

    // ── 5, 6, 7. Profil métier : actif, et rôle autorisé ─────────────────
    // La jointure se fait par e-mail : `utilisateurs` n'a pas de clé étrangère
    // vers auth.users. C'est la convention des autres Edge Functions.
    const { data: profil } = await client
      .from("utilisateurs")
      .select("role,actif")
      .eq("email", user.email.toLowerCase())
      .maybeSingle()

    const autorisation = verifierProfil(profil)
    if (!autorisation.ok) {
      // Le code du refus suffit à diagnostiquer : ni e-mail, ni identifiant.
      console.warn(`[analyse-facture] refus 403 : ${autorisation.code} (${Date.now() - t0} ms)`)
      return refus(autorisation)
    }

    // ── 8. Le corps, enfin ───────────────────────────────────────────────
    // Refus précoce sur la taille annoncée ; la taille réelle est recontrôlée
    // après décodage, dans validerCorps.
    const annonce = verifierTailleAnnoncee(req.headers.get("Content-Length"))
    if (!annonce.ok) {
      console.warn(`[analyse-facture] refus 413 : ${annonce.code} (rôle ${autorisation.role})`)
      return refus(annonce)
    }

    let corps: unknown = null
    try {
      corps = await req.json()
    } catch {
      return refus({ status: 400, code: "JSON_INVALIDE", message: "Corps de requête illisible : JSON attendu." })
    }

    // Accepte { images: [{ base64, mediaType }] } (facture multi-pages) ou
    // l'ancien { imageBase64, mediaType }.
    const valide = validerCorps(corps)
    if (!valide.ok) {
      console.warn(`[analyse-facture] refus ${valide.status} : ${valide.code} (rôle ${autorisation.role})`)
      return refus(valide)
    }

    // ── 9. Anthropic, et pas avant ───────────────────────────────────────
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")
    if (!ANTHROPIC_KEY) {
      // Le client n'apprend ni le nom du secret ni sa nature.
      console.error("[analyse-facture] clé d'analyse absente de la configuration")
      return refus({ status: 500, code: "CONFIG_SERVEUR", message: "Service momentanément indisponible." })
    }

    const mkBlock = (img: { base64: string; mediaType: string }) => (img.mediaType === "application/pdf")
      ? { type: "document", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
      : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
    const contentBlocks = valide.images.map(mkBlock)

    // Mode ciblé (bouton « Saisir ce BL depuis la facture ») : même document,
    // mais on ne demande QUE le détail d'un BL. Le numéro est nettoyé ici :
    // seuls lettres, chiffres, espaces et / . - _ passent, 60 caractères au plus.
    const blCibleBrut = (corps as { bl_cible?: unknown })?.bl_cible
    const blCible = typeof blCibleBrut === "string"
      ? blCibleBrut.replace(/[^A-Za-z0-9 /._-]/g, "").trim().slice(0, 60)
      : ""

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Pour réduire le coût sur gros volume : remplacer par "claude-sonnet-5-5"
        model: "claude-opus-5-5",
        // Sur ce modèle la réflexion est toujours active et compte dans ce
        // plafond : 8000 pouvait tronquer une facture à nombreux BL.
        max_tokens: 16000,
        // Niveau de réflexion : c'est lui qui règle durée et coût de l'appel.
        output_config: { effort: "medium" },
        messages: [{
          role: "user",
          content: [
            ...contentBlocks,
            {
              type: "text",
              text: blCible ? consigneBlCible(blCible) : `Tu extrais les données de factures fournisseurs BTP, éventuellement multipages.
Réponds uniquement par un objet JSON valide. N'invente jamais un numéro ou un montant.
Format attendu :
{
 "fournisseur": "nom ou chaîne vide",
 "tva_fournisseur": "n° de TVA intracommunautaire du fournisseur ou null",
 "numero": "numéro facture ou null",
 "date_facture": "AAAA-MM-JJ ou null",
 "periode": "AAAA-MM ou null",
 "date_echeance": "AAAA-MM-JJ ou null",
 "mode_reglement": "LCR/traite/virement/comptant ou null",
 "montant_ht": 0.0,
 "montant_tva": 0.0,
 "montant_ttc": 0.0,
 "bls": [
  {"bl_numero":"numéro BL ou null","commande_numero":"numéro de commande fournisseur ou null","date_livraison":"AAAA-MM-JJ ou null","reference_client":"référence client ou null","montant_ht":0.0}
 ],
 "frais": [{"libelle":"libellé","montant_ht":0.0}],
 "incertitudes": ["motif éventuel"]
}
Les montants non lisibles sont null, jamais zéro par défaut.
tva_fournisseur : n° de TVA intracommunautaire DU FOURNISSEUR qui émet la facture (ex. « FR » + 11 caractères), recopié sans espaces. Jamais celui du client : FR52921024584 est notre propre n° (Profero, le client) et ne doit jamais être renvoyé ; s'il est le seul lisible, renvoyer null.
Pour chaque BL, utiliser le sous-total imprimé s'il existe ; sinon additionner les montants totaux des lignes d'articles du BL, jamais prix unitaire × quantité.
Les prix par 100, conditionnements, remises en cascade et litres peuvent différer des documents d'achat.
Rapprocher visuellement les BL et numéros de commande qui apparaissent sur la même ligne.
Ne pas inventer un BL pour les factures directes ou les documents substitutifs.
Les contributions écologiques incluses dans une ligne d'article restent dans son total.
Une participation énergie (ou contribution) calculée sur un BL et imprimée dans le bloc de ce BL (ex. Partedis : « sous-total articles » puis « Énergie ») fait partie du montant_ht de ce BL : montant_ht du BL = sous-total articles + cette participation, car le BL du fournisseur l'inclut. S'il n'y a qu'un seul BL sur la facture, sa participation énergie lui est rattachée.
Seuls les frais globaux de la facture, hors de tout BL (frais de facturation, PFA, port facturé à part, énergie globale non détaillée par BL alors que la facture compte plusieurs BL), vont dans frais.
Ne jamais compter deux fois une taxe ou un frais déjà inclus dans le HT.
Vérifier la somme des BL et frais contre le total HT ; si elle ne correspond pas, préciser l'incertitude.
Conserver tous les BL de toutes les pages, sans doublons.
${REGLES_REFERENCES}
`
            }
          ]
        }]
      })
    })

    const data = await response.json()

    // Refus d'Anthropic (ex. PDF « exotique » généré par Ghostscript → 400) :
    // ne plus le maquiller en succès. Le navigateur reçoit un 502 avec un code
    // stable et le motif d'Anthropic (type + message, tronqué) — jamais le
    // document ni la clé. DOCUMENT_REFUSE permet au navigateur de réessayer
    // avec les pages converties en images.
    if (!response.ok) {
      const motifType = String(data?.error?.type || "erreur").slice(0, 60)
      const motifTexte = String(data?.error?.message || "réponse inattendue").slice(0, 300)
      console.warn(`[analyse-facture] refus anthropic=${response.status} type=${motifType} rôle=${autorisation.role} pages=${valide.images.length} cible=${blCible ? "bl" : "facture"} (${Date.now() - t0} ms)`)
      return refus({
        status: 502,
        code: response.status === 400 ? "DOCUMENT_REFUSE" : "ANALYSE_INDISPONIBLE",
        message: `Le document n'a pas pu être lu par l'IA : ${motifType} — ${motifTexte}`,
      })
    }
    // Journal : de quoi diagnostiquer, rien de plus. Ni document, ni réponse
    // brute, ni identité, ni clé.
    console.log(`[analyse-facture] ok rôle=${autorisation.role} pages=${valide.images.length} cible=${blCible ? "bl" : "facture"} anthropic=${response.status} (${Date.now() - t0} ms)`)
    // Format de réponse INCHANGÉ : le navigateur reçoit ce qu'Anthropic renvoie,
    // exactement comme avant.
    return json(data, 200)
  } catch (_err) {
    // Le message d'exception peut contenir n'importe quoi : il ne sort pas.
    console.error(`[analyse-facture] erreur interne (${Date.now() - t0} ms)`)
    return refus({ status: 500, code: "ERREUR_INTERNE", message: "L'analyse a échoué. Réessayez." })
  }
})
