// api/cron-dispatcher.js — Routeur unique des tâches planifiées.
//
// Plan Vercel Hobby = 12 fonctions serverless maximum, et les crons Vercel
// natifs sont désactivés sur ce plan depuis fin 2024. Les créneaux vivent donc
// dans GitHub Actions (.github/workflows/), qui appelle cette unique fonction ;
// les handlers métier vivent dans api/_cron/, un dossier NON déployé en
// fonctions. Ajouter une tâche n'ajoute ainsi aucune fonction.
//
// Deux façons de router, dans cet ordre :
//
//   1. `?job=<nom>` — explicite. Le créneau dit ce qu'il veut, et c'est cela
//      qui tourne. C'est la façon à privilégier pour toute nouvelle tâche, et
//      le seul moyen de rejouer une tâche à la main hors de son créneau.
//
//   2. Fenêtre horaire Paris — historique. L'heure UTC d'un cron étant figée,
//      le dispatcher déduisait la tâche de l'heure et du jour Paris. Cela
//      fonctionne tant que les fenêtres ne se recouvrent pas, ce qui devient
//      faux dès qu'une tâche de plus veut le matin : la veille Invest occupe
//      3h-5h, le récap commandes 5h-11h le vendredi. Les créneaux existants
//      continuent d'utiliser ce mode, les nouveaux passent par `job`.
//
// Créneaux en place (.github/workflows/cron-dispatcher.yml et
// cron-invest-tableau-bord.yml) :
//   Vendredi 06h UTC       → récap commandes                (fenêtre)
//   Lun-Ven 14h50 UTC      → rappel rapport ouvriers        (fenêtre)
//   Lun-Ven 02h UTC        → veille échéances Invest        (fenêtre)
//   Lun-Ven 05h UTC        → tableau de bord Invest par mail (?job=)

const { createClient } = require("@supabase/supabase-js");
// Les handlers métier vivent dans api/_cron/ (dossier NON déployé en fonctions)
// et ne sont joignables qu'à travers ce dispatcher.
const { runRappelRapport, parisNow, heureAttendue, envoyerMail } = require("./_cron/cron-rappel-rapport.js");
const { runRecapCommandes }    = require("./_cron/cron-recap-commandes.js");
const { runInvestEcheances }   = require("./_cron/cron-invest-echeances.js");
const { runInvestTableauBord } = require("./_cron/cron-invest-tableau-bord.js");

// Une tâche = un nom, une fenêtre horaire Paris (ou null si elle ne s'appelle
// que par `?job=`), et la fonction à exécuter.
const TACHES = {
  // Récap commandes, vendredi matin.
  recap_commandes: {
    fenetre: (t) => t.weekday === "Vendredi" && t.hour >= 5 && t.hour <= 11,
    run: (req, supabase, t) => runRecapCommandes(req, supabase, t),
  },
  // Rappel du compte rendu aux ouvriers, en fin de journée travaillée.
  rappel_rapport: {
    fenetre: (t) => heureAttendue(t.weekday) !== null && t.hour >= 13 && t.hour <= 19,
    run: (req, supabase, t) => runRappelRapport(req, supabase, t),
  },
  // Veille des échéances Invest, avant l'aube.
  //
  // Invest n'avait aucune automatisation serveur : les dates max de dépôt
  // d'urbanisme, les actions en retard et les relances de biens n'étaient
  // portées à personne tant que quelqu'un n'ouvrait pas l'onglet.
  //
  // Même canal que les autres crons : /api/send-email (Resend). L'Edge
  // Function du CRM ne convient pas — elle exige un actionId, qu'une ligne
  // d'échéance issue de cinq tables différentes n'a pas.
  invest_echeances: {
    fenetre: (t) => heureAttendue(t.weekday) !== null && t.hour >= 3 && t.hour < 5,
    run: (req, supabase, t) => runInvestEcheances(req, supabase, t, envoyerMail),
  },
  // Le tableau de bord Invest, envoyé par mail avant la prise de poste.
  //
  // Appelée par `?job=` et non par fenêtre : 7h Paris tombe dans la fenêtre du
  // récap commandes le vendredi (5h-11h), et les deux partiraient ensemble.
  invest_tableau_bord: {
    fenetre: null,
    run: (req, supabase, t) => runInvestTableauBord(req, supabase, t, envoyerMail),
  },
};

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
  // (ex. rapports et tables Invest, sans policy anon SELECT). Fallback anon si
  // non configurée.
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Sélection des tâches à exécuter.
  const demande = String(req.query?.job || "").trim();
  let aLancer;
  if (demande) {
    if (!TACHES[demande]) {
      // Un nom inconnu est une erreur franche, pas un « rien à faire » : un
      // créneau mal orthographié resterait sinon silencieux pendant des mois.
      return res.status(400).json({
        error: `Tâche inconnue : « ${demande} »`,
        taches: Object.keys(TACHES),
      });
    }
    aLancer = [demande];
  } else {
    aLancer = Object.entries(TACHES)
      .filter(([, tache]) => tache.fenetre && tache.fenetre(t))
      .map(([nom]) => nom);
  }

  if (aLancer.length === 0) {
    return res.status(200).json({
      ok: true,
      skipped: "no_branch_matched",
      time: t,
      hint: "Appel hors des fenêtres horaires Paris configurées. Utiliser ?job=<nom> pour forcer une tâche.",
      taches: Object.keys(TACHES),
    });
  }

  const ranWith = [];
  const summary = {};
  for (const nom of aLancer) {
    try {
      summary[nom] = await TACHES[nom].run(req, supabase, t);
      ranWith.push(nom);
    } catch (e) {
      console.error(`dispatcher ${nom}:`, e);
      summary[nom] = { error: e.message };
    }
  }

  return res.status(200).json({ ok: true, ran: ranWith, requested: demande || null, ...summary });
};
