// api/_ia/taches/facture_client.js — Lecture d'une facture CLIENT importée sur
// un chantier (montant, numéro, date, mentions), pour la facturation par
// échéancier (bloc « Facturation client » de la fiche chantier).
//
// CE QUE CETTE TÂCHE FAIT, ET CE QU'ELLE NE FAIT PAS
// ──────────────────────────────────────────────────
// Elle LIT le document, point. Elle ne décide JAMAIS à quelle échéance la
// facture se rattache : ce rapprochement est déterministe et explicable, il
// vit dans src/Renovation/facturationClient.mjs (rapprocherFacture) et son
// résultat reste modifiable à la main avant enregistrement. Un modèle ne
// coche pas une ligne d'argent.
//
// LE DOCUMENT NE TRANSITE PAS PAR L'ENTRÉE. Le front envoie le CHEMIN du
// fichier dans le bucket privé "chantier-documents" (le PDF y est déjà, il
// doit de toute façon rester attaché à la facture) ; la tâche le télécharge
// ici avec la clé service_role. Deux raisons : api/ai.js journalise `entree`
// telle quelle dans ia_jobs — y mettre un PDF en base64 y écrirait plusieurs
// mégaoctets par appel — et le fichier n'a ainsi pas à faire l'aller-retour
// par le navigateur une seconde fois.

const { createClient } = require("@supabase/supabase-js");

const BUCKET = "chantier-documents";
const MAX_OCTETS = 12 * 1024 * 1024; // au-delà, on refuse plutôt que d'exploser le coût

const TYPES_IMAGE = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Type MIME déduit de l'extension quand le stockage ne le donne pas.
function typeDepuisChemin(chemin) {
  const ext = String(chemin || "").toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return null;
}

async function telechargerDocument(chemin) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration Supabase absente côté serveur");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.storage.from(BUCKET).download(chemin);
  if (error || !data) throw new Error(`Document introuvable dans le stockage : ${error?.message || chemin}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length > MAX_OCTETS) {
    throw new Error(`Document trop volumineux pour la lecture automatique (${Math.round(buffer.length / 1024 / 1024)} Mo, maximum ${MAX_OCTETS / 1024 / 1024} Mo)`);
  }
  const type = data.type && data.type !== "application/octet-stream"
    ? data.type
    : (typeDepuisChemin(chemin) || "application/pdf");
  return { base64: buffer.toString("base64"), type };
}

const CONSIGNE = `Tu lis une FACTURE ÉMISE PAR UNE ENTREPRISE DE RÉNOVATION À SON CLIENT
(ce n'est pas une facture fournisseur : le client est le particulier ou le
maître d'ouvrage destinataire des travaux).

Relève UNIQUEMENT ce qui est écrit sur le document. N'invente rien, ne calcule
aucun total absent, ne déduis aucun pourcentage qui n'est pas imprimé.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans markdown :
{
  "numero": "numéro de la facture tel qu'imprimé, ou null",
  "date_facture": "date d'émission au format AAAA-MM-JJ, ou null",
  "client": "nom du client facturé, ou null",
  "libelle": "libellé principal de la prestation facturée (une ligne), ou null",
  "montant_ht": nombre (total HT) ou null,
  "montant_tva": nombre (total TVA) ou null,
  "montant_ttc": nombre (total TTC) ou null,
  "nature": "acompte" | "demarrage" | "situation" | "solde" | "autre",
  "situation_numero": nombre (numéro de situation si le document en porte un) ou null,
  "pourcentage_annonce": nombre (pourcentage du marché imprimé sur la facture, ex. 20 pour "20 %") ou null,
  "retenue_garantie": nombre (montant de retenue de garantie si mentionné) ou null,
  "avoir": true si le document est un AVOIR (facture négative), sinon false,
  "lisibilite": "bonne" | "moyenne" | "mauvaise"
}

Règles pour "nature" :
- "acompte"   : le document parle d'acompte, d'arrhes ou de paiement à la commande/signature.
- "demarrage" : facture de démarrage, d'ouverture de chantier, de lancement des travaux.
- "situation" : facture de situation / d'avancement / intermédiaire (renseigne alors situation_numero si un numéro figure).
- "solde"     : facture de solde, de clôture, finale, dernière situation, décompte définitif.
- "autre"     : rien de tout cela n'est écrit — n'essaie pas de deviner d'après le montant.

Les montants sont des nombres décimaux, sans symbole ni séparateur de milliers
(ex. 12450.75). Si le total HT n'est pas imprimé mais que le TTC et le taux de
TVA le sont, laisse montant_ht à null : c'est l'application qui décidera.`;

module.exports = {
  id: "facture_client",
  libelle: "Lecture d'une facture client (facturation par échéancier)",

  // Rôles bureau : la facturation est tenue par l'admin, le comptable, le
  // conducteur ou le commercial selon les agences. Les ouvriers n'y ont pas
  // accès (et la RLS de chantier_factures_client le leur refuse de toute façon).
  roles: ["admin", "comptable", "conducteur", "commercial"],

  modele: "claude-sonnet-5",
  max_tokens: 1500,
  cout_max_eur: 0.12,
  sensible: false,

  // Entrée : { document_path } — le chemin du PDF/image déjà déposé dans le
  // bucket privé "chantier-documents". Rien d'autre n'est nécessaire : le
  // rapprochement avec l'échéancier se fait côté application.
  schema_entree(entree) {
    if (!entree || typeof entree !== "object" || Array.isArray(entree)) return "l'entrée doit être un objet";
    if (typeof entree.document_path !== "string" || !entree.document_path.trim()) {
      return "document_path doit être le chemin du document dans le stockage";
    }
    if (entree.document_path.includes("..")) return "document_path invalide";
    return true;
  },

  async construire_prompt(entree) {
    const doc = await telechargerDocument(entree.document_path.trim());
    const bloc = TYPES_IMAGE.includes(doc.type)
      ? { type: "image", source: { type: "base64", media_type: doc.type, data: doc.base64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } };

    return {
      system: "Tu es un assistant de saisie comptable. Tu relèves des informations sur des documents, " +
        "tu ne les interprètes pas et tu ne complètes jamais ce qui manque.",
      messages: [{ role: "user", content: [bloc, { type: "text", text: CONSIGNE }] }],
    };
  },

  schema_sortie(resultat) {
    if (!resultat || typeof resultat !== "object" || Array.isArray(resultat)) {
      return ["la sortie doit être un objet JSON"];
    }
    const erreurs = [];
    const nombreOuNull = (cle) => {
      const v = resultat[cle];
      if (v === null || v === undefined) return;
      if (typeof v !== "number" || !Number.isFinite(v)) erreurs.push(`${cle} doit être un nombre ou null`);
    };
    ["montant_ht", "montant_tva", "montant_ttc", "situation_numero", "pourcentage_annonce", "retenue_garantie"].forEach(nombreOuNull);
    const natures = ["acompte", "demarrage", "situation", "solde", "autre"];
    if (resultat.nature !== undefined && resultat.nature !== null && !natures.includes(resultat.nature)) {
      erreurs.push(`nature doit valoir ${natures.join(", ")}`);
    }
    if (resultat.date_facture != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(resultat.date_facture))) {
      erreurs.push("date_facture doit être au format AAAA-MM-JJ ou null");
    }
    return erreurs.length ? erreurs : true;
  },

  // Confiance de la LECTURE (pas du rattachement) : un document dont le
  // montant HT ou la date manque mérite une relecture humaine appuyée.
  calculer_confiance(resultat) {
    let c = 0.4;
    if (typeof resultat?.montant_ht === "number") c += 0.3;
    if (resultat?.date_facture) c += 0.1;
    if (resultat?.numero) c += 0.1;
    if (resultat?.nature && resultat.nature !== "autre") c += 0.1;
    if (resultat?.lisibilite === "mauvaise") c -= 0.3;
    return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
  },
};
