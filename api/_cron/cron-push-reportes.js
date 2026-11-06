// api/_cron/cron-push-reportes.js — Rattrapage des notifications push reportées.
//
// Projet docs/projets/notifications-push.md, tâche 2. Une notification qui tombe
// dans la plage de silence (20h-7h, samedi-dimanche, heure de Paris) est écrite
// tout de suite dans la boîte de réception, et son push est REPORTÉ au premier
// créneau autorisé (push_prevu_le). Ce job demande à l'Edge Function send-push
// (mode « reportes ») d'envoyer ceux dont l'heure est venue. send-push revérifie
// tout avant d'envoyer : interrupteur général, type actif, préférence, silence.
//
// Appelé par le dispatcher (`?job=push_reportes`), lui-même appelé par
// .github/workflows/cron-push-reportes.yml les jours ouvrés vers 7h05 Paris.
// Rejouer le job ne renvoie rien deux fois : une notification envoyée quitte
// l'état « reporte ».
//
// `?job=push_simulation&type=D2` : simulation sans envoi ni écriture d'un type
// du catalogue sur les vrais utilisateurs (qui aurait reçu quoi, par rôle).
//
// Secret : la clé service role, déjà présente côté Vercel
// (SUPABASE_SERVICE_ROLE_KEY) et injectée côté Supabase dans les Edge
// Functions. Aucun nouveau secret. Absente → erreur explicite, jamais un appel
// muet avec la clé anon.

async function appelerSendPush(corps) {
  const url = process.env.VITE_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("VITE_SUPABASE_URL manquante côté Vercel.");
  if (!cle) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel : send-push refuse les envois serveur sans elle.");
  const rep = await fetch(`${url}/functions/v1/send-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}`, apikey: cle },
    body: JSON.stringify(corps),
  });
  let donnees = null;
  try { donnees = await rep.json(); } catch { /* corps non JSON */ }
  if (!rep.ok) {
    throw new Error(`send-push a répondu ${rep.status} : ${donnees?.error || "réponse illisible"}`);
  }
  return donnees;
}

async function runPushReportes() {
  return appelerSendPush({ mode: "reportes" });
}

async function runPushSimulation(req) {
  const type = String(req?.query?.type || "").trim().toUpperCase();
  if (!type) throw new Error("Préciser le type à simuler : ?job=push_simulation&type=D2");
  return appelerSendPush({
    mode: "serveur",
    simulation: true,
    type,
    titre: `Simulation ${type}`,
    texte: "Simulation sans envoi.",
    lien: "/",
  });
}

module.exports = { runPushReportes, runPushSimulation };
