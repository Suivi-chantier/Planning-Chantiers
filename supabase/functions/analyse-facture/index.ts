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
        max_tokens: 3000,
        messages: [{
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text: `Tu es un assistant spécialisé dans l'analyse de factures fournisseur BTP.
Une facture mensuelle regroupe souvent PLUSIEURS bons de livraison (BL).
Ton rôle PRINCIPAL : repérer la LISTE DE TOUS LES NUMÉROS DE BL référencés sur la facture.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans backticks.
Format :
{
  "fournisseur": "nom du fournisseur si détecté, sinon chaîne vide",
  "numero": "numéro de la facture, ou null",
  "date_facture": "date de la facture au format AAAA-MM-JJ, ou null",
  "periode": "période de facturation au format AAAA-MM si identifiable, sinon null",
  "montant_ht": nombre (total HT de la facture) ou null,
  "bls": [
    {
      "bl_numero": "numéro du bon de livraison référencé",
      "montant_ht": nombre (montant HT de ce BL si indiqué) ou null
    }
  ]
}
Repère TOUS les numéros de bons de livraison : ils apparaissent souvent dans le
détail de la facture, libellés "BL", "Bon de livraison", "BL n°", "Réf. BL", ou
en début de ligne. N'invente aucun numéro : si aucun BL n'est listé, renvoie bls: [].
Prix en nombres décimaux.`
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
