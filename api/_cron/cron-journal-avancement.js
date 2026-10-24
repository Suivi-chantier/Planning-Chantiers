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

async function runJournalAvancement(req, supabase) {
  const { data, error } = await supabase.rpc("avancement_journal_reconcilier");
  if (error) throw new Error(`avancement_journal_reconcilier : ${error.message}`);
  return data || { ok: false, code: "reponse_vide" };
}

module.exports = { runJournalAvancement };
