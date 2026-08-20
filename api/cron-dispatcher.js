// api/cron-dispatcher.js — Routeur unique pour les 2 crons Vercel.
//
// Plan Hobby Vercel = max 2 cron jobs / projet. On consolide ici :
//   1) Vendredi matin (≈8h Paris)  → recap commandes (mail aux admin+conducteur)
//   2) Lun-Ven après-midi (~16h50) → rappel rapport ouvriers + To-do retard
//
// L'heure UTC du cron étant figée, le dispatcher détecte l'heure Paris pour
// router. Les deux fonctions métier sont importées depuis leurs handlers
// respectifs (qui restent appelables directement à des fins de test manuel).
//
// vercel.json :
//   { "path": "/api/cron-dispatcher", "schedule": "0 6 * * 5"   }  → Vendredi 8h Paris (été), 7h (hiver)
//   { "path": "/api/cron-dispatcher", "schedule": "50 14 * * 1-5" } → Lun-Ven 16h50 Paris (été), 15h50 (hiver)

const { createClient } = require("@supabase/supabase-js");
// Les deux handlers métier vivent dans api/_cron/ (dossier NON déployé en
// fonctions — plan Hobby Vercel = max 12 fonctions serverless) et ne sont
// joignables qu'à travers ce dispatcher.
const { runRappelRapport, parisNow, heureAttendue } = require("./_cron/cron-rappel-rapport.js");
const { runRecapCommandes }                          = require("./_cron/cron-recap-commandes.js");
const { runInvestEcheances }                         = require("./_cron/cron-invest-echeances.js");

module.exports = async function handler(req, res) {
  // Auth
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.authorization || "";
    if (got !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const t = parisNow();
  const supaUrl = process.env.VITE_SUPABASE_URL;
  // Clé service role en priorité : les crons lisent des tables protégées par RLS
  // (ex. rapports, sans policy anon SELECT). Fallback anon si non configurée.
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Routing : on tolère ±1h de drift (DST). Les deux fenêtres ne se chevauchent
  // jamais donc on peut router sans ambiguïté.
  //   – Matin (5h-11h Paris)  + Vendredi → recap commandes
  //   – Après-midi (13h-19h Paris) + Lun-Ven → rappel rapport
  const ranWith = [];
  const summary = {};

  // Branche 1 : recap commandes vendredi matin
  if (t.weekday === "Vendredi" && t.hour >= 5 && t.hour <= 11) {
    try {
      summary.recap_commandes = await runRecapCommandes(req, supabase, t);
      ranWith.push("recap_commandes");
    } catch (e) {
      console.error("dispatcher recap_commandes:", e);
      summary.recap_commandes = { error: e.message };
    }
  }

  // Branche 2 : rappel rapport (Lun-Ven après-midi)
  if (heureAttendue(t.weekday) !== null && t.hour >= 13 && t.hour <= 19) {
    try {
      summary.rappel_rapport = await runRappelRapport(req, supabase, t);
      ranWith.push("rappel_rapport");
    } catch (e) {
      console.error("dispatcher rappel_rapport:", e);
      summary.rappel_rapport = { error: e.message };
    }
  }

  // Branche 3 : veille des échéances Invest (Lun-Ven, tôt le matin).
  //
  // Invest n'avait aucune automatisation serveur : les dates max de dépôt
  // d'urbanisme, les actions en retard et les relances de biens n'étaient
  // portées à personne tant que quelqu'un n'ouvrait pas l'onglet.
  //
  // Créneau distinct de la branche 1 (récap commandes, vendredi 5h-11h) pour
  // que les deux ne se déclenchent pas sur le même appel : la veille tourne
  // avant 5h Paris, tous les jours ouvrés.
  if (heureAttendue(t.weekday) !== null && t.hour >= 3 && t.hour < 5) {
    try {
      // Pas d'envoyeur injecté : la veille utilise l'Edge Function d'Invest
      // (send-mission-email, Gmail), le même canal que le CRM. Resend ne sert
      // qu'aux crons Rénovation.
      summary.invest_echeances = await runInvestEcheances(req, supabase, t);
      ranWith.push("invest_echeances");
    } catch (e) {
      console.error("dispatcher invest_echeances:", e);
      summary.invest_echeances = { error: e.message };
    }
  }

  if (ranWith.length === 0) {
    return res.status(200).json({
      ok: true,
      skipped: "no_branch_matched",
      time: t,
      hint: "Le dispatcher est appelé en dehors des fenêtres horaires Paris configurées.",
    });
  }

  return res.status(200).json({ ok: true, ran: ranWith, ...summary });
};
