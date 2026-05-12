// api/send-email.js — Vercel serverless function
// Proxy vers Resend pour ne pas exposer la clé API côté client.
//
// Variables d'environnement requises (à configurer dans Vercel) :
//   RESEND_KEY        — clé API Resend (server-side, SANS préfixe VITE_)
//   RESEND_FROM       — adresse expéditeur, défaut "Profero Planning <onboarding@resend.dev>"
//                       ⚠ Tant qu'aucun domaine n'est vérifié dans Resend, l'expéditeur
//                       reste onboarding@resend.dev et les destinataires sont limités à
//                       l'email du propriétaire du compte Resend.

module.exports = async function handler(req, res) {
  // CORS basique pour appels depuis le frontend déployé
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.RESEND_KEY;
  if (!key) return res.status(500).json({ error: "RESEND_KEY non configuré côté serveur" });

  const { to, cc, subject, html, from, attachments } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: "Champs requis : to, subject, html" });
  }

  const recipients = Array.isArray(to) ? to : [to];
  const sender = from || process.env.RESEND_FROM || "Profero Planning <onboarding@resend.dev>";

  const payload = { from: sender, to: recipients, subject, html };
  if (cc && (Array.isArray(cc) ? cc.length > 0 : cc.trim?.())) {
    payload.cc = Array.isArray(cc) ? cc : [cc];
  }
  // Pièces jointes : Resend attend [{ filename, content }] où content = base64 string
  if (Array.isArray(attachments) && attachments.length > 0) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.content,
    }));
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.message || "Erreur Resend", details: data });
    }
    return res.status(200).json({ ok: true, id: data?.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
