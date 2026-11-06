// api/_cron/cron-push-materiaux.js — Notification C3 « Commandes à passer ».
//
// Projet docs/projets/notifications-push.md, tâche 10 (remplace le calcul de
// la tâche 5, sur décision de Loris : « On modifiera cette notif »).
//
// CE QUE FAIT LE JOB : chaque jour ouvré vers 8h05 (Paris), il relit les
// phasages (saisie PAR OUVRAGE), les lignes de commande, la bibliothèque
// matériaux et les chantiers, et calcule la liste de la page « Commandes à
// passer » avec EXACTEMENT le code de la page
// (src/Renovation/commandesAPasserV1.mjs, module pur partagé avec l'écran).
// Il envoie AU PLUS UNE notification C3 par jour (règle 5), « N commandes à
// passer », avec la liste « ouvrage / matériau · chantier », un lien vers la
// page (/?page=planning-commandes) et la clé de regroupement C3-<date>.
//
// RÈGLE 2 — UN CHANGEMENT D'ÉTAT, PAS UN ÉTAT QUI DURE : une commande qui reste
// à passer plusieurs jours n'est notifiée qu'une fois. Table
// public.notifications_etat (type C3, cle_objet « <phasage>|<ouvrage>|<matériau>[#n] »,
// même modèle que F1, cron-factures-a-emettre.js) :
//   - seules les commandes non encore inscrites entrent dans la notification ;
//   - elles ne sont inscrites qu'APRÈS une écriture réussie en boîte de
//     réception (send-push → ecrites_en_boite > 0). Interrupteur général coupé,
//     type C3 désactivé, aucun destinataire ou notification du jour déjà
//     écrite : rien n'est inscrit, elles partiront au prochain passage utile ;
//   - PAS de premier passage silencieux : une commande à passer est une action
//     à faire. Le premier envoi après activation les liste toutes, regroupées
//     en UNE notification (même décision que pour F1).
//
// Une lecture en échec renvoie une erreur, jamais une liste vide.
//
// `?job=push_materiaux&simulation=1` : send-push en simulation (qui recevrait
// quoi), aucun envoi, aucune écriture, notifications_etat non touchée.
// `&date=AAAA-MM-JJ` (simulation seulement) ne change que la clé de
// regroupement : la liste « Commandes à passer » ne dépend pas du jour.
//
// Appelé par le dispatcher (`?job=push_materiaux`), lui-même appelé par
// .github/workflows/cron-push-materiaux.yml. Deux créneaux (été / hiver) :
// avant 8h Paris, le passage ne fait rien (« avant_8h »).
//
// Le mail récap du vendredi (cron-recap-commandes.js) reste INCHANGÉ : il
// garde son calcul par phase (materiauxACommanderV1.mjs, règle 8).

const { appelerSendPush } = require("./cron-push-reportes.js");

const HEURE_ENVOI = 8; // heure de Paris à partir de laquelle on envoie
const TABLE_ETAT = "notifications_etat";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _modules = null;
async function modules() {
  if (!_modules) {
    const [C, T, A] = await Promise.all([
      import("../../src/Renovation/commandesAPasserV1.mjs"),
      import("../../src/Renovation/chantiersTables.mjs"),
      import("../../src/Renovation/chantierActif.mjs"),
    ]);
    _modules = { C, T, A };
  }
  return _modules;
}

function estSimulation(req) {
  return ["1", "true", "oui"].includes(String(req?.query?.simulation || "").trim().toLowerCase());
}

// Lecture complète par tranches de 1 000 (Supabase tronque sans le dire).
async function lireTout(supabase, table, colonnes, filtre = (q) => q, tri = "id") {
  const lignes = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await filtre(supabase.from(table).select(colonnes)).order(tri).range(debut, debut + 999);
    if (error) throw new Error(`Lecture ${table} impossible : ${error.message}`);
    lignes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return lignes;
}

/**
 * Lit les données et calcule la liste de la page (aucune écriture).
 * Mêmes lectures que la page : phasages (ouvrages), lignes de commande, chantiers
 * (filtrés comme App.jsx : non archivés, en exploitation, terminés inclus),
 * articles de la bibliothèque, lots « achats terminés » (ordre des chantiers,
 * par reste à commander). Seule différence assumée : la liste des lots
 * (planning_config « lots_travaux », lue côté écran par loadLots de
 * src/constants.js, non importable ici) n'est pas lue. Elle ne change pas
 * QUELS articles sont à commander, seulement le libellé du lot et donc l'ordre
 * des ouvrages d'un même chantier (ici : par libellé).
 */
async function calculerListe(supabase) {
  const { C, T, A } = await modules();
  const [phasages, lignesCmd, lignesChantiers, achats] = await Promise.all([
    lireTout(supabase, "phasages", "id, chantier_id, chantier_nom, ouvrages"),
    lireTout(supabase, "commande_lignes", "id, quantite, prix_unitaire, prix_total, materiau_id, lot_id, nature, ouvrage_id, chantier_id"),
    lireTout(supabase, "chantiers", "id, operation_id, nom, couleur, statut, ordre, donnees, archive_le, created_at"),
    lireTout(supabase, "achats_lots_termines", "id, chantier_id, lot_id, termine_le, termine_par"),
  ]);
  // Index { chantier_id: [lignes] } (comme achatsTerminesParChantier de la page).
  const achatsParCh = {};
  achats.forEach((a) => { (achatsParCh[a.chantier_id] ||= []).push(a); });
  const chantiers = A.filtrerChantiersActifs(
    T.trierLignes(lignesChantiers).filter((l) => !l.archive_le).map(T.depuisLigneChantier).filter(Boolean),
    { inclureTermines: true });

  // Bibliothèque : seulement les articles cités par un ouvrage (plus de 12 000
  // articles en base). Un identifiant qui n'est pas un uuid ne peut pas y être.
  const ids = new Set();
  for (const p of phasages) {
    for (const o of Array.isArray(p.ouvrages) ? p.ouvrages : []) {
      for (const ml of Array.isArray(o?.materiaux_liens) ? o.materiaux_liens : []) {
        if (ml && ml.materiau_id != null && RE_UUID.test(String(ml.materiau_id))) ids.add(String(ml.materiau_id));
      }
    }
  }
  const listeIds = [...ids];
  const materiaux = [];
  for (let i = 0; i < listeIds.length; i += 150) {
    const lot = listeIds.slice(i, i + 150);
    const { data, error } = await supabase.from("materiaux_bibliotheque")
      .select("id, nom, unite, prix_unitaire, fournisseur, fournisseur_id").in("id", lot);
    if (error) throw new Error(`Lecture materiaux_bibliotheque impossible : ${error.message}`);
    materiaux.push(...(data || []));
  }

  const modele = C.modeleCommandesAPasser({
    phasages, chantiers, matById: C.indexMateriaux(materiaux), lotById: {},
    lignesCmd, lots: [], achatsParCh,
  });
  return { C, lignes: C.lignesACommander(modele) };
}

async function runPushMateriaux(req, supabase, t) {
  const simulation = estSimulation(req);
  let dateIso = t?.dateIso;
  const dateDemandee = String(req?.query?.date || "").trim();
  if (dateDemandee) {
    if (!simulation) throw new Error("Le paramètre date n'est accepté qu'en simulation (simulation=1).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDemandee)) throw new Error("Date attendue au format AAAA-MM-JJ.");
    dateIso = dateDemandee;
  }
  if (!dateIso) throw new Error("Date de Paris inconnue : clé de regroupement impossible.");

  // Deux créneaux GitHub (été / hiver) : celui qui tombe avant 8h Paris ne fait rien.
  if (!simulation && t.hour < HEURE_ENVOI) {
    return { skipped: "avant_8h", date: dateIso, heure_paris: `${t.hour}h${String(t.minute).padStart(2, "0")}` };
  }

  const { C, lignes } = await calculerListe(supabase);
  // Plus de 1 000 commandes possibles une fois notifiées : lecture par tranches.
  const etat = await lireTout(supabase, TABLE_ETAT, "cle_objet", (q) => q.eq("type", "C3"), "cle_objet");
  const nouvelles = C.commandesNouvellementAPasser({ lignes, dejaNotifiees: (etat || []).map((e) => e.cle_objet) });
  const notif = C.notificationCommandesAPasser({ nouvelles, dateIso });

  const resume = {
    date: dateIso,
    simulation,
    commandes_a_passer: lignes.length,
    deja_notifiees: lignes.length - nouvelles.length,
    nouvelles: nouvelles.length,
    notifications: notif ? 1 : 0,
  };
  if (!notif) {
    return { ...resume, envoi: "aucun", raison: "Aucune commande nouvellement à passer.", inscrites: 0 };
  }
  if (simulation) {
    const reponse = await appelerSendPush({ mode: "serveur", ...notif, simulation: true });
    return { ...resume, notification: notif, send_push: reponse,
      detail: nouvelles.map((l) => ({ chantier: l.chantierNom, ouvrage: l.ouvrageLibelle, materiau: l.libelle, cle_objet: l.cleObjet })) };
  }

  // UN appel send-push pour toute la journée.
  const r = await appelerSendPush({ mode: "serveur", ...notif, simulation: false });
  const ecrites = r?.ecrites_en_boite || 0;
  if (ecrites <= 0) {
    return { ...resume, notification: notif, ecrites_en_boite: 0, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0, inscrites: 0,
      raison: "Rien d'écrit en boîte de réception : aucune commande marquée comme notifiée." };
  }
  const maintenant = new Date().toISOString();
  const { error } = await supabase.from(TABLE_ETAT).upsert(
    nouvelles.map((l) => ({ type: "C3", cle_objet: l.cleObjet, etat: "notifiee", notifie_le: maintenant, maj_le: maintenant })),
    { onConflict: "type,cle_objet", ignoreDuplicates: true },
  );
  return {
    ...resume, notification: notif, ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0,
    inscrites: error ? 0 : nouvelles.length,
    ...(error ? { error: `${TABLE_ETAT} : ${error.message} (notification écrite, commandes non inscrites : elles seront reprises dans la notification d'un prochain jour)` } : {}),
  };
}

module.exports = { runPushMateriaux, calculerListe, HEURE_ENVOI };
