import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")

    // Accepte soit { images: [{ base64, mediaType }] } (BL multi-pages),
    // soit l'ancien { imageBase64, mediaType } (une seule image).
    const images = Array.isArray(body.images) && body.images.length
      ? body.images
      : (body.imageBase64 ? [{ base64: body.imageBase64, mediaType: body.mediaType }] : [])

    const mkBlock = (img) => (img.mediaType === "application/pdf")
      ? { type: "document", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
      : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
    const contentBlocks = images.map(mkBlock)

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
quantité telle qu'affichée.`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})
