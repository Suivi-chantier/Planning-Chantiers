// api/_cron/cron-push-materiaux.js — Notification C3 « Matériaux à commander ».
//
// Projet docs/projets/notifications-push.md, tâche 5. Chaque jour ouvré vers 8h
// (Paris), calcule les matériaux prévisionnels dont la date butoir est
// aujourd'hui, avec EXACTEMENT le calcul du mail récap du vendredi
// (src/Renovation/materiauxACommanderV1.mjs, module pur partagé), puis demande
// à l'Edge Function send-push (mode « serveur ») UNE notification regroupée :
//   type C3, « N matériaux à commander aujourd'hui », lien vers l'écran
//   « Commandes à passer », cle_regroupement = C3-<date>.
// send-push décide du reste : interrupteur général (livré coupé : rien ne part
// tant que Loris ne l'active pas), type actif, rôles cochés (jamais ouvrier),
// préférences, plage de silence. Rejouer le job le même jour ne crée aucun
// doublon (même clé de regroupement).
//
// Liste vide → aucun envoi.
// `?job=push_materiaux&simulation=1` → send-push en simulation (aucun envoi,
//   aucune écriture) ; `&date=AAAA-MM-JJ` permet alors de simuler un autre jour.
//
// Appelé par le dispatcher (`?job=push_materiaux`), lui-même appelé par
// .github/workflows/cron-push-materiaux.yml. Deux créneaux (été / hiver) :
// avant 8h Paris, le passage ne fait rien (« avant_8h »).
//
// Le mail récap du vendredi (cron-recap-commandes.js) reste inchangé : le push
// s'ajoute, il ne remplace rien (règle 8 du cahier).

const { appelerSendPush } = require("./cron-push-reportes.js");

const HEURE_ENVOI = 8; // heure de Paris à partir de laquelle on envoie

let _module = null;
async function moduleMateriaux() {
  if (!_module) _module = await import("../../src/Renovation/materiauxACommanderV1.mjs");
  return _module;
}

function estSimulation(req) {
  return ["1", "true", "oui"].includes(String(req?.query?.simulation || "").trim().toLowerCase());
}

async function runPushMateriaux(req, supabase, t) {
  const simulation = estSimulation(req);
  let dateIso = t.dateIso;
  const dateDemandee = String(req?.query?.date || "").trim();
  if (dateDemandee) {
    if (!simulation) throw new Error("Le paramètre date n'est accepté qu'en simulation (simulation=1).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDemandee)) throw new Error("Date attendue au format AAAA-MM-JJ.");
    dateIso = dateDemandee;
  }

  // Deux créneaux GitHub (été / hiver) : celui qui tombe avant 8h Paris ne fait rien.
  if (!simulation && t.hour < HEURE_ENVOI) {
    return { skipped: "avant_8h", date: dateIso, heure_paris: `${t.hour}h${String(t.minute).padStart(2, "0")}` };
  }

  // Mêmes lectures que le récap du vendredi.
  const [phasagesQ, cfgQ] = await Promise.all([
    supabase.from("phasages").select("id, chantier_id, chantier_nom, plan_travaux"),
    supabase.from("planning_config").select("key,value").in("key", ["chantiers", "phases_travaux"]),
  ]);
  // Une lecture en échec n'est pas une liste vide : on le dit.
  if (phasagesQ.error) throw new Error(`Lecture des phasages impossible : ${phasagesQ.error.message}`);
  if (cfgQ.error) throw new Error(`Lecture de la configuration impossible : ${cfgQ.error.message}`);

  const cfg = {}; (cfgQ.data || []).forEach(r => { cfg[r.key] = r.value; });
  const chantiers = Array.isArray(cfg.chantiers) ? cfg.chantiers : [];
  const phases = (cfg.phases_travaux && Array.isArray(cfg.phases_travaux.items)) ? cfg.phases_travaux.items : [];

  const { materiauxACommander, notificationMateriauxACommander } = await moduleMateriaux();
  const commandesPrevues = materiauxACommander({ phasages: phasagesQ.data || [], chantiers, phases, dateIso });
  const notif = notificationMateriauxACommander({ commandesPrevues, dateIso });

  const liste = {
    date: dateIso,
    phases: commandesPrevues.length,
    materiaux: commandesPrevues.reduce((s, p) => s + p.materiaux.length, 0),
    detail: commandesPrevues.map(p => ({ chantier: p.chantierNom, phase: p.phaseLabel, materiaux: p.materiaux.length, total_ht: p.totalHt })),
  };

  if (!notif) {
    // Liste vide : aucun envoi, même en simulation (rien ne partirait).
    return { ...liste, envoi: "aucun", raison: "Aucun matériau prévisionnel à commander ce jour.", simulation };
  }

  const reponse = await appelerSendPush({ mode: "serveur", ...notif, simulation });
  return { ...liste, simulation, notification: notif, send_push: reponse };
}

module.exports = { runPushMateriaux, HEURE_ENVOI };
