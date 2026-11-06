// api/_cron/cron-point-conducteurs.js — Point du soir des conducteurs (18h30).
//
// Projet docs/projets/notifications-push.md, tâche 4 (types C1 et C2).
// Chaque jour ouvré à 18h30 (Paris), UNE notification qui résume :
//   - C1 : les comptes rendus reçus aujourd'hui et les ouvriers attendus qui
//     n'en ont pas rendu. « Attendus » = même règle que le mail de rappel
//     (cron-rappel-rapport.js), désormais dans le module partagé
//     src/Renovation/ouvriersAttendusV1.mjs ;
//   - C2 : les demandes de matériel des ouvriers en attente (table besoins,
//     statut « en_attente »), regroupées par envoi comme l'écran
//     « Planning commandes ».
// Le contenu vient du module pur src/Renovation/pointConducteursV1.mjs.
//
// UN SEUL PUSH PAR PERSONNE, ET C1 / C2 COUPABLES SÉPARÉMENT : quand les deux
// parties ont quelque chose à dire, send-push reçoit un envoi GROUPÉ (champ
// `groupe`, voir supabase/functions/_partage/pushGroupeV1.mjs). Chaque type
// est planifié avec ses propres rôles, son interrupteur et la préférence de
// chacun, et écrit dans la boîte sous son propre type ; seul le push est réuni.
// Clé de regroupement : C1-<date Paris> pour les deux types.
//
// Rien à signaler (aucun CR, aucun ouvrier attendu, aucune demande) : aucun
// envoi. Des ouvriers attendus sans aucun CR reçu : envoi (« aucun CR reçu,
// N manquants ») — une absence ne passe jamais pour « tout va bien ».
// Week-end : rien. Jours fériés : aucune règle, comme le mail de rappel (un
// jour sans tâche planifiée n'attend personne).
//
// Une lecture de la base qui échoue est une ERREUR, jamais une liste vide.
//
// `?job=point_conducteurs&pas_avant=18:30` (créneau planifié) : ignoré avant
//   18h30 Paris — deux créneaux UTC (été / hiver), voir
//   .github/workflows/cron-point-conducteurs.yml. Un point déjà écrit en boîte
//   aujourd'hui (clé C1-<date>) n'est pas renvoyé par le second créneau.
// `&simulation=1` : send-push en simulation (aucun envoi, aucune écriture) ;
//   `&date=AAAA-MM-JJ` n'est accepté qu'en simulation.
//
// Appelé par le dispatcher (?job=point_conducteurs). Aucune fonction Vercel
// ajoutée. Le mail de rappel des ouvriers n'est pas touché (règle 1).

const { appelerSendPush } = require("./cron-push-reportes.js");

let _modules = null;
async function modules() {
  if (!_modules) {
    const [attendus, point, push] = await Promise.all([
      import("../../src/Renovation/ouvriersAttendusV1.mjs"),
      import("../../src/Renovation/pointConducteursV1.mjs"),
      import("../../supabase/functions/_partage/notificationsPushV1.mjs"),
    ]);
    _modules = { attendus, point, push };
  }
  return _modules;
}

const estSimulation = (req) =>
  ["1", "true", "oui"].includes(String(req?.query?.simulation || "").trim().toLowerCase());

/** « 18:30 » ou « 18 » → minutes depuis minuit ; illisible → null. */
function lirePasAvant(valeur) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(valeur ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Lit les données du jour. Toute erreur de lecture est levée. */
async function lireDonnees(supabase, { dateIso, M }) {
  const jour = M.attendus.jourPlanning(dateIso);
  const weekId = M.attendus.semaineDuJour(dateIso);
  const dateFr = M.attendus.dateFrDepuisIso(dateIso);
  const [cellsQ, rapportsQ, besoinsQ, chantiersQ] = await Promise.all([
    supabase.from("planning_cells").select("ouvriers,taches,planifie,jour").eq("week_id", weekId).eq("jour", jour),
    supabase.from("rapports").select("ouvrier, chantier_id").eq("date_rapport", dateFr),
    supabase.from("besoins")
      .select("id, panier_id, chantier_id, article, quantite, ouvrier_demandeur, statut, created_at")
      .eq("statut", "en_attente").order("created_at", { ascending: true }),
    supabase.from("chantiers").select("id, nom"),
  ]);
  if (cellsQ.error) throw new Error(`Lecture du planning impossible : ${cellsQ.error.message}`);
  if (rapportsQ.error) throw new Error(`Lecture des comptes rendus impossible : ${rapportsQ.error.message}`);
  if (besoinsQ.error) throw new Error(`Lecture des demandes de matériel impossible : ${besoinsQ.error.message}`);
  if (chantiersQ.error) throw new Error(`Lecture des chantiers impossible : ${chantiersQ.error.message}`);
  return {
    weekId, jour, dateFr,
    cells: cellsQ.data || [], rapports: rapportsQ.data || [],
    besoins: besoinsQ.data || [], chantiers: chantiersQ.data || [],
  };
}

async function runPointConducteurs(req, supabase, t) {
  const simulation = estSimulation(req);
  let dateIso = t?.dateIso;
  const dateDemandee = String(req?.query?.date || "").trim();
  if (dateDemandee) {
    if (!simulation) throw new Error("Le paramètre date n'est accepté qu'en simulation (simulation=1).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDemandee)) throw new Error("Date attendue au format AAAA-MM-JJ.");
    dateIso = dateDemandee;
  }
  if (!dateIso) throw new Error("Date de Paris inconnue : clé de regroupement impossible.");

  // Deux créneaux GitHub (été / hiver) : celui qui tombe avant 18h30 Paris ne fait rien.
  const pasAvant = lirePasAvant(req?.query?.pas_avant);
  if (!simulation && pasAvant !== null && typeof t?.hour === "number" && t.hour * 60 + (t.minute || 0) < pasAvant) {
    return { ignore: `Il est ${t.hour}h${String(t.minute || 0).padStart(2, "0")} à Paris : passage réservé à ${req.query.pas_avant} ou plus (l'autre créneau du jour s'en charge).` };
  }

  const M = await modules();
  if (!M.attendus.jourPlanning(dateIso)) return { date: dateIso, skipped: "weekend", envoi: "aucun" };
  const cle = M.point.clePointDuSoir(dateIso);

  // Le second créneau du jour ne renvoie pas un point déjà parti (même si une
  // demande est arrivée entre-temps : une seule notification par soir).
  if (!simulation) {
    const { data: deja, error } = await supabase.from("notifications").select("id")
      .in("type", [M.point.TYPE_CR, M.point.TYPE_MATERIEL]).eq("cle_regroupement", cle).limit(1);
    if (error) throw new Error(`Lecture de la boîte de réception impossible : ${error.message}`);
    if (deja && deja.length) return { date: dateIso, cle_regroupement: cle, skipped: "deja_envoye_aujourdhui", envoi: "aucun" };
  }

  const d = await lireDonnees(supabase, { dateIso, M });
  let besoins = d.besoins;
  if (dateDemandee) {
    // Simulation d'un autre jour : les demandes encore en attente aujourd'hui
    // et déjà créées ce soir-là (l'historique des statuts n'est pas conservé).
    const [y, m, j] = dateIso.split("-").map(Number);
    const finJour = M.push.parisVersUtcMs(y, m, j + 1, 0, 0);
    besoins = besoins.filter((b) => !b.created_at || Date.parse(b.created_at) < finJour);
  }
  const attendus = M.attendus.ouvriersAttendus(d.cells);
  const point = M.point.pointDuSoir({
    dateIso, attendus, rapports: d.rapports, besoins, chantiers: d.chantiers, lienPage: M.push.lienPage,
  });

  const resume = {
    date: dateIso, semaine: d.weekId, jour: d.jour, cle_regroupement: cle, simulation,
    ouvriers_attendus: [...attendus].sort(),
    comptes_rendus: point?.comptesRendus ?? M.point.bilanComptesRendus({ attendus, rapports: d.rapports }),
    demandes_en_attente: point?.demandes?.length ?? 0,
  };
  if (!point) return { ...resume, envoi: "aucun", raison: "Rien à signaler : aucun ouvrier attendu, aucun compte rendu, aucune demande de matériel." };

  const corps = M.point.demandeSendPush(point, { simulation });
  const reponse = await appelerSendPush(corps);
  // Une version de send-push sans l'envoi groupé ignorerait la partie C2 sans
  // rien dire : on le signale au lieu de laisser croire que tout est parti.
  if (corps.groupe && reponse?.groupe !== true) {
    throw new Error("send-push n'a pas traité l'envoi groupé (C1 + C2) : redéployer send-push depuis le dépôt. La partie « demandes de matériel » n'est pas partie.");
  }
  return {
    ...resume,
    notification: {
      c1: point.c1, c2: point.c2, ensemble: point.ensemble,
      envoi: point.c1 && point.c2 ? "groupé (C1 + C2, un seul push par personne)" : `simple (${corps.type})`,
    },
    send_push: reponse,
  };
}

module.exports = { runPointConducteurs, lirePasAvant };
