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
    const { imageBase64, mediaType } = await req.json()
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")

    const isPdf = mediaType === "application/pdf"
    const contentBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: mediaType, data: imageBase64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } }

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
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text: `Tu es un assistant spécialisé dans l'analyse de documents d'achat BTP
(bons de livraison, tickets de comptoir, bons de commande).
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
en haut à droite, libellé "BL", "Bon de livraison", "Ticket", "N°", "Commande".`
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
