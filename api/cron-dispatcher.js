// api/cron-dispatcher.js — Routeur unique des tâches planifiées.
//
// Plan Vercel Hobby = 12 fonctions serverless maximum, et les crons Vercel
// natifs sont désactivés sur ce plan depuis fin 2024. Les créneaux vivent donc
// dans GitHub Actions (.github/workflows/) ou, pour les notifications sur
// téléphone, dans pg_cron (Supabase) ; tous appellent cette unique fonction ;
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
//   Tous les jours 21h30 UTC → contrôle du journal d'avancement (?job=)
//   Lun-Ven 06h15 UTC      → relances devis / acompte         (?job=)
//
// Notifications sur téléphone : créneaux tenus par la BASE, pas par GitHub.
// Les « schedule » GitHub de ces 7 tâches ne partaient pas, ou avec des heures
// de retard (constat du 09/11/2026). Depuis, pg_cron + pg_net (Supabase)
// appellent `?job=` à la minute près, avec le CRON_SECRET lu dans Supabase
// Vault (nom `cron_secret`) — supabase/migrations/20261109134233_cron_notifications_push.sql.
// Chaque job pg_cron est planifié sur les deux heures UTC possibles (été /
// hiver) et ne fait rien si l'heure de Paris n'est pas la bonne : un seul
// appel par jour, à l'heure de Paris, été comme hiver. Le `pas_avant` reste
// passé en seconde garde. Les workflows GitHub du même nom ne servent plus
// qu'au lancement à la main (simulation par défaut).
//   Lun-Ven 7h05 Paris   → push reportés        (?job=push_reportes)
//   Lun-Ven 8h05 Paris   → C3 commandes à passer (?job=push_materiaux ; le job
//                          ignore lui-même tout appel avant 8h Paris)
//   Lun-Ven 8h15 Paris   → F1 facture à émettre (?job=factures_a_emettre&pas_avant=8)
//   Lundi   8h30 Paris   → D3 synthèse de la semaine (?job=synthese_semaine&pas_avant=8)
//   Lun-Ven 8h45 Paris   → D2 nouveau chantier signé (?job=nouveaux_chantiers&pas_avant=8)
//   Lun-Ven 9h05 Paris   → C4 / C5 / D1 alertes chantiers (?job=alertes_chantiers&pas_avant=9)
//   Lun-Ven 18h30 Paris  → C1 + C2 point du soir des conducteurs
//                          (?job=point_conducteurs&pas_avant=18:30)

const { createClient } = require("@supabase/supabase-js");
const { verifierAppelServeur } = require("./_lib/autorisationServeur");
// Les handlers métier vivent dans api/_cron/ (dossier NON déployé en fonctions)
// et ne sont joignables qu'à travers ce dispatcher.
const { runRappelRapport, parisNow, heureAttendue, envoyerMail } = require("./_cron/cron-rappel-rapport.js");
const { runRecapCommandes }    = require("./_cron/cron-recap-commandes.js");
const { runInvestEcheances }   = require("./_cron/cron-invest-echeances.js");
const { runInvestTableauBord } = require("./_cron/cron-invest-tableau-bord.js");
const { runJournalAvancement } = require("./_cron/cron-journal-avancement.js");
const { runRelancesCycleVie }  = require("./_cron/cron-relances-cycle-vie.js");
const { runPushReportes, runPushSimulation } = require("./_cron/cron-push-reportes.js");
const { runFacturesAEmettre } = require("./_cron/cron-factures-a-emettre.js");
const { runPushMateriaux }     = require("./_cron/cron-push-materiaux.js");
const { runPointConducteurs }  = require("./_cron/cron-point-conducteurs.js");
const { runAlertesChantiers }  = require("./_cron/cron-alertes-chantiers.js");
const { runNouveauxChantiers, runSyntheseSemaine } = require("./_cron/cron-notifications-direction.js");

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
  // Contrôle nocturne du journal d'avancement daté (refonte du Bilan, 1C) :
  // compte les écarts entre l'état des tâches et le journal. Par `?job=` seulement.
  journal_avancement: {
    fenetre: null,
    // Écart ≠ 0 : notification D4 dans la boîte des admins, sans push.
    run: (req, supabase, t) => runJournalAvancement(req, supabase, t),
  },
  // Relances e-mail du cycle de vie (Refonte Opérations, lot 3) : devis non
  // signé, facture d'acompte non réglée. Par `?job=` seulement. Interrupteur
  // dans Réglages → Relances, ÉTEINT par défaut : éteint, rien ne part.
  relances_cycle_vie: {
    fenetre: null,
    run: (req, supabase, t) => runRelancesCycleVie(req, supabase, t, envoyerMail),
  },
  // Notifications sur téléphone (projet notifications-push) : envoie les push
  // reportés par la plage de silence dont l'heure est venue. Par `?job=`
  // seulement ; passe par l'Edge Function send-push (mode « reportes »).
  push_reportes: {
    fenetre: null,
    run: () => runPushReportes(),
  },
  // Simulation sans envoi ni écriture d'un type de notification sur les vrais
  // utilisateurs : `?job=push_simulation&type=D2`. Par `?job=` seulement.
  push_simulation: {
    fenetre: null,
    run: (req) => runPushSimulation(req),
  },
  // Push F1 « facture à émettre » (projet notifications-push, tâche 7) : même
  // détection que la fiche chantier (factureAEmettre.mjs). N'envoie QUE le
  // push ; le mail reste envoyé par la fiche, comme avant. Par `?job=`
  // seulement ; `&simulation=1` liste sans rien envoyer ni écrire.
  factures_a_emettre: {
    fenetre: null,
    run: (req, supabase, t) => runFacturesAEmettre(req, supabase, t),
  },
  // Notification C3 « Commandes à passer » : même liste que la page (tâche 10),
  // seules les commandes nouvellement à passer, une notification regroupée par
  // jour ; rien de nouveau = aucun envoi. `&simulation=1` : sans envoi. Par `?job=` seulement.
  push_materiaux: {
    fenetre: null,
    run: (req, supabase, t) => runPushMateriaux(req, supabase, t),
  },
  // Point du soir des conducteurs à 18h30 (C1 comptes rendus + C2 demandes de
  // matériel), une seule notification par personne. Même règle « ouvriers
  // attendus » que le rappel du compte rendu. `&simulation=1` : sans envoi ni
  // écriture ; `&date=` en simulation seulement. Par `?job=` seulement.
  point_conducteurs: {
    fenetre: null,
    run: (req, supabase, t) => runPointConducteurs(req, supabase, t),
  },
  // Notifications C4 / C5 / D1 (projet notifications-push, tâche 6) : niveaux
  // d'alerte recalculés avec la chaîne de la page Alertes (alertesEcranV1),
  // comparés à l'état déjà vu (notifications_etat) ; seules les AGGRAVATIONS
  // partent, une notification par type et par passage. Premier passage :
  // référence enregistrée, rien d'envoyé. `&simulation=1` : sans écriture ni
  // envoi. Par `?job=` seulement.
  alertes_chantiers: {
    fenetre: null,
    run: (req, supabase, t) => runAlertesChantiers(req, supabase, t),
  },
  // Notification D2 « nouveau chantier signé » (projet notifications-push,
  // tâche 8) : étape « Devis signé » validée, une notification regroupée par
  // passage, chaque chantier une seule fois (notifications_etat). Premier
  // passage : référence enregistrée, rien d'envoyé. `&simulation=1` : sans
  // écriture ni envoi. Par `?job=` seulement.
  nouveaux_chantiers: {
    fenetre: null,
    run: (req, supabase, t) => runNouveauxChantiers(req, supabase, t),
  },
  // Notification D3 « synthèse de la semaine » (tâche 8) : bandeau du Bilan
  // semaine de la semaine écoulée, mêmes fonctions que l'écran. Relevé absent :
  // la notification le dit. `&simulation=1` (et `&semaine=AAAA-Www`) : sans
  // envoi. Par `?job=` seulement.
  synthese_semaine: {
    fenetre: null,
    run: (req, supabase, t) => runSyntheseSemaine(req, supabase, t),
  },
};

module.exports = async function handler(req, res) {
  // Auth — fermée par défaut : sans CRON_SECRET configuré, la route refuse
  // (500) au lieu de s'ouvrir. Voir api/_lib/autorisationServeur.js.
  const acces = verifierAppelServeur(req);
  if (!acces.ok) return res.status(acces.status).json({ error: acces.error });

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
