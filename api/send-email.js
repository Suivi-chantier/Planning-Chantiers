// api/send-email.js — Vercel serverless function
// Proxy vers Resend pour ne pas exposer la clé API côté client.
//
// Accès : interdit par défaut. Trois profils d'appelant seulement — serveur
// (CRON_SECRET), collaborateur (JWT + utilisateurs actif), compte rendu public
// vers la liste blanche interne. Règles et raisons : api/_lib/autorisationEmail.js.
//
// Variables d'environnement (Vercel, serveur uniquement) :
//   RESEND_KEY                — clé API Resend
//   RESEND_FROM               — expéditeur. Le `from` éventuellement fourni par
//                               l'appelant est IGNORÉ : l'expéditeur n'est
//                               jamais choisi par le client.
//   CRON_SECRET               — secret des appels serveur (crons)
//   SUPABASE_SERVICE_ROLE_KEY — vérification des JWT collaborateurs
//   EMAIL_AUTH_MODE           — "observer" : refus journalisés, non appliqués.
//                               Absente ou autre valeur : "strict".

const { createClient } = require("@supabase/supabase-js");
const {
  modeAutorisation, identifierAppelant, evaluerEnvoi, entreeJournal, ligneJournal,
} = require("./_lib/autorisationEmail");

const EXPEDITEUR_DEFAUT = "Profero Planning <onboarding@resend.dev>";

function dependancesParDefaut() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const cleService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let admin = null;
  const client = () => (admin ||= createClient(url, cleService, { auth: { persistSession: false } }));
  return {
    cronSecret: process.env.CRON_SECRET,
    jwtVerifiable: !!(url && cleService),
    verifierJeton: async (jwt) => {
      const { data, error } = await client().auth.getUser(jwt);
      return error || !data?.user ? null : { email: data.user.email };
    },
    // Même appariement que public.est_ouvrier() : égalité exacte sur l'email.
    chargerProfil: async (email) => {
      const { data, error } = await client()
        .from("utilisateurs").select("role, actif").eq("email", email).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    resendKey: process.env.RESEND_KEY,
    expediteur: process.env.RESEND_FROM || EXPEDITEUR_DEFAUT,
    mode: modeAutorisation(),
    fetch: (...args) => fetch(...args),
    // Console (journaux Vercel, 1 h sur Hobby) + table journal_envois_email
    // (sql/202609_journal_envois_email.sql), seule trace durable pour le bilan
    // d'observation. Table absente ou erreur : signalé en console, jamais
    // bloquant.
    journaliser: async (entree) => {
      console.log(JSON.stringify(entree));
      if (!url || !cleService) return;
      const { error } = await client().from("journal_envois_email").insert(ligneJournal(entree));
      if (error) console.warn("[send-email] journal non écrit :", error.message);
    },
  };
}

function creerHandler(surcharges = {}) {
  return async function handler(req, res) {
    const deps = { ...dependancesParDefaut(), ...surcharges };

    // Plus de CORS « * » : tous les appelants sont sur la même origine (front)
    // ou côté serveur (crons), et aucun des deux n'a besoin de CORS.
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!deps.resendKey) return res.status(500).json({ error: "RESEND_KEY non configuré côté serveur" });

    const corps = req.body || {};
    const { to, cc, subject, html, attachments } = corps;
    if (!to || !subject || !html) {
      return res.status(400).json({ error: "Champs requis : to, subject, html" });
    }

    const appelant = await identifierAppelant(req, deps);
    const decision = evaluerEnvoi(appelant, corps);
    // Attendu avant de répondre : une fonction Vercel peut être gelée dès la
    // réponse envoyée, et l'écriture en base serait perdue.
    const journal = async (extra) => {
      try { await deps.journaliser(entreeJournal({ mode: deps.mode, appelant, decision, corps, req, ...extra })); }
      catch { /* le journal ne doit jamais bloquer un envoi */ }
    };

    if (!decision.autorise && deps.mode === "strict") {
      await journal({ envoye: false });
      const status = appelant.type === "anonyme" || decision.raison === "jeton_invalide" ? 401 : 403;
      return res.status(status).json({ error: "Envoi non autorisé", raison: decision.raison });
    }

    const payload = { from: deps.expediteur, to: Array.isArray(to) ? to : [to], subject, html };
    if (cc && (Array.isArray(cc) ? cc.length > 0 : String(cc).trim())) {
      payload.cc = Array.isArray(cc) ? cc : [cc];
    }
    // Pièces jointes : Resend attend [{ filename, content }] où content = base64 string
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }

    try {
      const response = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${deps.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      await journal({ envoye: response.ok, statutResend: response.status });
      if (!response.ok) {
        return res.status(response.status).json({ error: data?.message || "Erreur Resend", details: data });
      }
      return res.status(200).json({ ok: true, id: data?.id });
    } catch (e) {
      await journal({ envoye: false, statutResend: "exception" });
      return res.status(500).json({ error: e.message || "Erreur inconnue" });
    }
  };
}

module.exports = creerHandler();
module.exports.creerHandler = creerHandler;
