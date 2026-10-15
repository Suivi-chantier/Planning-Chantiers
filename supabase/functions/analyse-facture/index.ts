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

    // Accepte { images: [{ base64, mediaType }] } (facture multi-pages) ou
    // l'ancien { imageBase64, mediaType }.
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
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            ...contentBlocks,
            {
              type: "text",
              text: `Tu extrais les données de factures fournisseurs BTP, éventuellement multipages.
Réponds uniquement par un objet JSON valide. N'invente jamais un numéro ou un montant.
Format attendu :
{
 "fournisseur": "nom ou chaîne vide",
 "numero": "numéro facture ou null",
 "date_facture": "AAAA-MM-JJ ou null",
 "periode": "AAAA-MM ou null",
 "date_echeance": "AAAA-MM-JJ ou null",
 "mode_reglement": "LCR/traite/virement/comptant ou null",
 "montant_ht": 0.0,
 "montant_tva": 0.0,
 "montant_ttc": 0.0,
 "bls": [
  {"bl_numero":"numéro BL ou null","commande_numero":"numéro de commande fournisseur ou null","date_livraison":"AAAA-MM-JJ ou null","montant_ht":0.0}
 ],
 "frais": [{"libelle":"libellé","montant_ht":0.0}],
 "incertitudes": ["motif éventuel"]
}
Les montants non lisibles sont null, jamais zéro par défaut.
Pour chaque BL, utiliser le sous-total imprimé s'il existe ; sinon additionner les montants totaux des lignes d'articles du BL, jamais prix unitaire × quantité.
Les prix par 100, conditionnements, remises en cascade et litres peuvent différer des documents d'achat.
Rapprocher visuellement les BL et numéros de commande qui apparaissent sur la même ligne.
Ne pas inventer un BL pour les factures directes ou les documents substitutifs.
Les contributions écologiques incluses dans une ligne d'article restent dans son total ; frais de facturation, énergie, PFA ou port hors articles vont dans frais.
Ne jamais compter deux fois une taxe ou un frais déjà inclus dans le HT.
Vérifier la somme des BL et frais contre le total HT ; si elle ne correspond pas, préciser l'incertitude.
Conserver tous les BL de toutes les pages, sans doublons.
`
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
