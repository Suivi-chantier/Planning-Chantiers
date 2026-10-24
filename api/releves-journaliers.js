// api/releves-journaliers.js — Relevés journaliers des chantiers (refonte du
// Bilan semaine, étape 1D).
//
// Deux usages, une seule fonction (plan Hobby : 12 fonctions au plus) :
//   1. Recalcul après une écriture — appelé par l'application (JWT Supabase
//      d'un collaborateur actif, pas un ouvrier) après une validation de
//      compte rendu, une correction ou une modification d'avancement :
//        POST { chantierId, date? }  → relevé du jour touché + relevés
//        suivants déjà enregistrés (cascade), jusqu'à aujourd'hui.
//   2. Rattrapage de nuit — appelé par GitHub Actions (CRON_SECRET) :
//        ?mode=nuit → chaque chantier qui a bougé dans la journée.
//      Idempotent (upsert sur chantier_id + date_releve).
//
// Aucune formule ici : voir api/_partage/relevesJournaliers.js, puis
// src/Renovation/releveJournalier.mjs et src/chantierFinance.mjs.

const { createClient } = require("@supabase/supabase-js");
const { jetonBearer, estSecretServeur } = require("./_lib/autorisationServeur");
const { recalculerApresEcriture, rattrapageDeNuit } = require("./_partage/relevesJournaliers");

module.exports = async function handler(req, res) {
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ error: "Variables d'environnement Supabase manquantes côté serveur" });
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // ── Autorisation : secret serveur (cron) OU collaborateur actif ──
  const jeton = jetonBearer(req);
  const estCron = estSecretServeur(jeton);
  if (!estCron) {
    if (!jeton) return res.status(401).json({ error: "Jeton d'authentification manquant" });
    const { data: authData, error: authErr } = await supabase.auth.getUser(jeton);
    if (authErr || !authData?.user?.email) return res.status(401).json({ error: "Jeton invalide ou expiré" });
    const { data: profil } = await supabase.from("utilisateurs")
      .select("role, actif").eq("email", authData.user.email).maybeSingle();
    if (!profil || profil.actif === false) return res.status(403).json({ error: "Compte inactif ou inconnu" });
    if (profil.role === "ouvrier") return res.status(403).json({ error: "Réservé au bureau" });
  }

  const corps = (req.body && typeof req.body === "object") ? req.body : {};
  const mode = String(req.query?.mode || corps.mode || "");
  try {
    const rj = await import("../src/Renovation/releveJournalier.mjs");
    if (mode === "nuit") {
      if (!estCron) return res.status(403).json({ error: "Rattrapage de nuit : réservé au cron" });
      return res.status(200).json(await rattrapageDeNuit(supabase, rj));
    }
    const chantierId = String(corps.chantierId || "").trim();
    if (!chantierId) return res.status(400).json({ error: "chantierId manquant" });
    const r = await recalculerApresEcriture(supabase, rj, { chantierId, date: corps.date || null });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error("releves-journaliers :", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
