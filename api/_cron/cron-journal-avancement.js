// api/_cron/cron-journal-avancement.js — Contrôle nocturne du journal
// d'avancement daté (refonte du Bilan semaine, étape 1C).
//
// Toute écriture de l'avancement d'une tâche passe par la fonction
// d'enregistrement du journal (déclencheur sur phasages). Ce contrôle est le
// filet : il compare l'état actuel de chaque tâche à la dernière valeur écrite
// au journal, écrit une ligne « reconciliation » par écart et consigne le
// compteur (table avancement_journal_controles, affiché dans Réglages).
// Compteur ≠ 0 : un chemin d'écriture a échappé au journal — à corriger.
//
// Tout le calcul est en base (avancement_journal_reconcilier) : une seule
// transaction, idempotent (un second passage ne trouve plus d'écart).
// Appelé par cron-dispatcher.js (?job=journal_avancement), créneau GitHub
// .github/workflows/cron-journal-avancement.yml.
//
// Notification D4 (projet docs/projets/notifications-push.md, tâche 8) :
// quand le compteur d'écarts est ≠ 0, une notification est écrite dans la
// boîte des admins, SANS push (type « boîte seule » du catalogue). Écart nul :
// rien. Le contrôle lui-même ne change pas, et un échec de la notification ne
// le fait pas passer pour raté (clé « erreur » dans notification_d4).

const { notifierEcartJournal } = require("./cron-notifications-direction.js");

async function runJournalAvancement(req, supabase, t) {
  const { data, error } = await supabase.rpc("avancement_journal_reconcilier");
  if (error) throw new Error(`avancement_journal_reconcilier : ${error.message}`);
  const resultat = data || { ok: false, code: "reponse_vide" };
  const notification_d4 = await notifierEcartJournal(resultat, t);
  return { ...resultat, notification_d4 };
}

module.exports = { runJournalAvancement };
