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
// Il choisit ensuite les articles à annoncer (commandesAPasserPushV1.mjs,
// décision de la direction, réponse « a ») :
//   - date de besoin dans les 7 prochains jours, aujourd'hui inclus (J à J+6,
//     jour de Paris) ; un article SANS date de besoin n'est jamais annoncé ;
//   - AU PLUS UNE notification C3 par jour (règle 5), « N commandes à passer
//     cette semaine », une ligne « jj/mm · ouvrage / matériau · chantier »
//     par article, lien /?page=planning-commandes, clé C3-<date>.
//
// RÈGLE 2 — UN CHANGEMENT D'ÉTAT, PAS UN ÉTAT QUI DURE : chaque article n'est
// annoncé qu'une fois. Table public.notifications_etat (type C3, cle_objet
// « <phasage>|<ouvrage>|<matériau>[#n] ») :
//   - un article annoncé est inscrit (etat « notifiee ») seulement APRÈS une
//     écriture réussie en boîte de réception (send-push → ecrites_en_boite > 0).
//     Interrupteur coupé, type désactivé, aucun destinataire : rien n'est
//     inscrit, il sera annoncé à un prochain passage tant qu'il reste dans
//     la fenêtre ;
//   - ARRIÉRÉ : au premier passage (pas de ligne « _reference »), tous les
//     articles déjà en retard (date de besoin < aujourd'hui) sont enregistrés
//     (etat « vu_sans_envoi ») SANS ENVOI, avec la ligne de référence. Ensuite,
//     un article qui arrive en retard sans avoir été annoncé est enregistré de
//     la même façon. Ces enregistrements sont faits même interrupteur coupé :
//     l'arriéré ne partira jamais. Les articles de la fenêtre partent, eux,
//     dès le premier passage.
//
// Une lecture ou une écriture d'état en échec renvoie une erreur, jamais une
// liste vide (dans ce cas, rien n'est envoyé).
//
// `?job=push_materiaux&simulation=1` : send-push en simulation (qui recevrait
// quoi), aucun envoi, aucune écriture, notifications_etat non touchée.
// `&date=AAAA-MM-JJ` (simulation seulement) simule un autre jour (fenêtre et
// clé de regroupement).
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
    const [C, P, T, A] = await Promise.all([
      import("../../src/Renovation/commandesAPasserV1.mjs"),
      import("../../src/Renovation/commandesAPasserPushV1.mjs"),
      import("../../src/Renovation/chantiersTables.mjs"),
      import("../../src/Renovation/chantierActif.mjs"),
    ]);
    _modules = { C, P, T, A };
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

  const { lignes } = await calculerListe(supabase);
  const { P } = await modules();
  // Plus de 1 000 articles possibles une fois enregistrés : lecture par tranches.
  const etat = await lireTout(supabase, TABLE_ETAT, "cle_objet", (q) => q.eq("type", "C3"), "cle_objet");
  const plan = P.planC3({ lignes, dejaVues: etat.map((e) => e.cle_objet), dateIso });
  const notif = P.notificationC3({ aNotifier: plan.aNotifier, dateIso });

  const resume = {
    date: dateIso,
    simulation,
    fenetre: { du: plan.debut, au: plan.fin },
    premier_passage: plan.premierPassage,
    commandes_a_passer: lignes.length,
    deja_vues: plan.dejaVues,
    sans_date_de_besoin: plan.sansDate,
    plus_tard: plan.plusTard,
    retard_enregistre_sans_envoi: plan.enregistrerSansEnvoi.length,
    a_annoncer: plan.aNotifier.length,
    notifications: notif ? 1 : 0,
  };
  const detail = () => plan.aNotifier.map((l) => ({ date_besoin: l.dateBesoin, chantier: l.chantierNom, ouvrage: l.ouvrageLibelle, materiau: l.libelle, cle_objet: l.cleObjet }));

  if (simulation) {
    const reponse = notif ? await appelerSendPush({ mode: "serveur", ...notif, simulation: true }) : null;
    return { ...resume, notification: notif, send_push: reponse, detail: detail() };
  }

  // 1. Arriéré (et ligne de référence au premier passage) : enregistré sans
  //    envoi, même interrupteur coupé. En cas d'échec, on s'arrête : rien n'est
  //    envoyé, le passage suivant recommencera.
  const maintenant = new Date().toISOString();
  const silencieuses = plan.enregistrerSansEnvoi.map((l) => ({ type: "C3", cle_objet: l.cleObjet, etat: "vu_sans_envoi", notifie_le: maintenant, maj_le: maintenant }));
  if (plan.premierPassage) silencieuses.push({ type: "C3", cle_objet: P.CLE_REFERENCE_C3, etat: "reference", notifie_le: maintenant, maj_le: maintenant });
  for (let i = 0; i < silencieuses.length; i += 500) {
    const { error } = await supabase.from(TABLE_ETAT).upsert(silencieuses.slice(i, i + 500), { onConflict: "type,cle_objet", ignoreDuplicates: true });
    if (error) throw new Error(`${TABLE_ETAT} : ${error.message} (arriéré non enregistré : aucun envoi)`);
  }
  const enregistrees = silencieuses.length;

  if (!notif) {
    return { ...resume, enregistrees_sans_envoi: enregistrees, envoi: "aucun", raison: "Aucun article à annoncer dans la fenêtre.", inscrites: 0 };
  }

  // 2. UN appel send-push pour toute la journée.
  const r = await appelerSendPush({ mode: "serveur", ...notif, simulation: false });
  const ecrites = r?.ecrites_en_boite || 0;
  if (ecrites <= 0) {
    return { ...resume, notification: notif, enregistrees_sans_envoi: enregistrees, ecrites_en_boite: 0, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0, inscrites: 0,
      raison: "Rien d'écrit en boîte de réception : aucun article de la fenêtre marqué comme annoncé." };
  }
  const { error } = await supabase.from(TABLE_ETAT).upsert(
    plan.aNotifier.map((l) => ({ type: "C3", cle_objet: l.cleObjet, etat: "notifiee", notifie_le: maintenant, maj_le: maintenant })),
    { onConflict: "type,cle_objet", ignoreDuplicates: true },
  );
  return {
    ...resume, notification: notif, enregistrees_sans_envoi: enregistrees, ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0,
    inscrites: error ? 0 : plan.aNotifier.length,
    ...(error ? { error: `${TABLE_ETAT} : ${error.message} (notification écrite, articles non inscrits : ils pourront être annoncés à nouveau)` } : {}),
  };
}

module.exports = { runPushMateriaux, calculerListe, HEURE_ENVOI };
