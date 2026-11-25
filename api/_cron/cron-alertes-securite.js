// api/_cron/cron-alertes-securite.js — Alertes de la fiche sécurité chantier
// dans la boîte de réception (projet docs/projets/fiche-securite-chantier.md,
// tâche 7b ; accord de François du 25/11/2026).
//
// CE QUE FAIT LE JOB : chaque jour ouvré à 7h35 Paris (job pg_cron
// « profero_push_alertes_securite », migration
// *_securite_alertes_notifications.sql), il relit chantiers, fiches sécurité,
// phasages et justificatifs, appelle les MÊMES fonctions que l'appli
// (alertesSecurite() de securiteCycleVie.mjs, via securiteAlertesPush.mjs) et
// envoie AU PLUS une notification par type et par jour :
//   - S1 « Alertes fiche sécurité chantier » (admin + conducteur par défaut) :
//     fiche à créer (chantier planifié), fiche non validée à 7 jours ou moins
//     de la première date prévue du phasage, justificatif requis expiré sur un
//     chantier en cours, fiche à mettre à jour ;
//   - S2 « Aptitude médicale expirée » (administrateurs seulement, rôles
//     imposés ; jamais de nom dans la notification).
//
// UNE FOIS PAR ALERTE (même modèle que F1) : table public.notifications_etat
// (type S1, cle_objet « <alerte>:<chantier> » ; type S2,
// « aptitude:<justificatif> »). Une alerte n'est inscrite qu'APRÈS une
// écriture réussie en boîte (send-push → ecrites_en_boite > 0) : interrupteur
// coupé, type désactivé ou notification du jour déjà écrite → rien d'inscrit,
// l'alerte repartira au prochain passage utile. Une alerte qui n'est plus
// vraie (fiche créée, validée, justificatif remplacé…) est retirée de
// notifications_etat : si elle revient, elle sera de nouveau notifiée.
//
// Écritures : la boîte de réception (par send-push, mode « serveur ») et
// notifications_etat, rien d'autre. Aucun droit nouveau pour l'appli : les
// deux tables restent fermées au navigateur.
//
// `?job=alertes_securite&simulation=1` : liste ce qui serait envoyé, sans rien
// envoyer ni écrire (send-push n'est pas appelé, notifications_etat intacte).
// `&pas_avant=7` (créneau planifié) : appel ignoré avant 7h Paris.

const { appelerSendPush } = require("./cron-push-reportes.js");

const TABLE_ETAT = "notifications_etat";

let _module = null;
async function module_() {
  if (!_module) _module = await import("../../src/Renovation/securiteAlertesPush.mjs");
  return _module;
}

async function lireTout(supabase, table, colonnes, filtre = (q) => q) {
  const lignes = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await filtre(supabase.from(table).select(colonnes)).range(debut, debut + 999);
    if (error) throw new Error(`${table} : ${error.message}`);
    lignes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return lignes;
}

/** Lit les données et calcule le plan (aucune écriture). */
async function calculerPlan(supabase, dateParis) {
  const M = await module_();
  const [chantiers, fiches, phasages, justificatifs, etatsStockes] = await Promise.all([
    lireTout(supabase, "chantiers", "id, nom, statut, archive_le"),
    lireTout(supabase, "securite_fiches", "id, chantier_id, version, statut, reponses, validee_le, validee_par, forcage_le, forcage_par"),
    lireTout(supabase, "phasages", "chantier_id, ouvrages"),
    // Même lecture que la pastille du panneau (justificatifs actifs) ; les
    // aptitudes médicales (confidentielles) ne servent qu'au compte S2.
    lireTout(supabase, "securite_justificatifs", "id, portee, chantier_id, point, type_code, personne, expire_le, archive_le, confidentiel, date_document, created_at",
      (q) => q.is("archive_le", null)),
    lireTout(supabase, TABLE_ETAT, "type, cle_objet", (q) => q.in("type", M.TYPES_PUSH_SECURITE)),
  ]);
  const plan = M.calculerPlanSecurite({ chantiers, fiches, phasages, justificatifs, etatsStockes, dateParis });
  return { M, plan };
}

const resumeType = (x) => ({ actuelles: x.actuelles, nouvelles: x.nouvelles.length, notification: x.contenu ? 1 : 0 });

async function envoyerEtInscrire(supabase, type, bloc) {
  if (!bloc.contenu) return { ecrites_en_boite: 0, inscrites: 0 };
  const r = await appelerSendPush({ mode: "serveur", ...bloc.contenu });
  const ecrites = r?.ecrites_en_boite || 0;
  if (ecrites <= 0) {
    return { ecrites_en_boite: 0, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0, inscrites: 0,
      raison: "Rien d'écrit en boîte de réception : aucune alerte marquée comme notifiée." };
  }
  const maintenant = new Date().toISOString();
  const { error } = await supabase.from(TABLE_ETAT).upsert(
    bloc.aInscrire.map((cle_objet) => ({ type, cle_objet, etat: "notifiee", notifie_le: maintenant, maj_le: maintenant })),
    { onConflict: "type,cle_objet", ignoreDuplicates: true },
  );
  return {
    ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0,
    inscrites: error ? 0 : bloc.aInscrire.length,
    ...(error ? { error: `${TABLE_ETAT} : ${error.message} (notification écrite, alertes non inscrites : elles seront reprises un prochain jour)` } : {}),
  };
}

/** t : parisNow() du dispatcher ({ hour, dateIso… }). */
async function runAlertesSecurite(req, supabase, t) {
  const simulation = ["1", "true", "oui"].includes(String(req?.query?.simulation || "").toLowerCase());
  const pasAvant = parseInt(String(req?.query?.pas_avant ?? ""), 10);
  if (!simulation && Number.isFinite(pasAvant) && typeof t?.hour === "number" && t.hour < pasAvant) {
    return { ok: true, ignore: `Il est ${t.hour}h à Paris : passage réservé à ${pasAvant}h ou plus (l'autre créneau du jour s'en charge).` };
  }
  if (!t?.dateIso) throw new Error("Date de Paris inconnue : alertes à 7 jours impossibles à calculer.");
  const { M, plan } = await calculerPlan(supabase, t.dateIso);
  const resultat = {
    ok: true, simulation, date: t.dateIso,
    [M.TYPE_PUSH_SECURITE]: resumeType(plan.s1),
    [M.TYPE_PUSH_APTITUDES]: resumeType(plan.s2),
    dates_inconnues: plan.datesInconnues.length,
    a_oublier: plan.aOublier.length,
  };
  if (simulation) {
    return { ...resultat,
      notifications: [plan.s1.contenu, plan.s2.contenu].filter(Boolean),
      detail: plan.s1.nouvelles.map((a) => ({ type: a.type, chantier_id: a.chantier_id, texte: a.texte })),
      chantiers_sans_date: plan.datesInconnues };
  }

  // Alertes résolues : retirées, pour pouvoir réalerter si elles reviennent.
  let oubliees = 0;
  for (const type of M.TYPES_PUSH_SECURITE) {
    const cles = plan.aOublier.filter((x) => x.type === type).map((x) => x.cle_objet);
    if (!cles.length) continue;
    const { error } = await supabase.from(TABLE_ETAT).delete().eq("type", type).in("cle_objet", cles);
    if (error) resultat[`erreur_oubli_${type}`] = `${TABLE_ETAT} : ${error.message}`;
    else oubliees += cles.length;
  }
  resultat.oubliees = oubliees;

  for (const [type, bloc] of [[M.TYPE_PUSH_SECURITE, plan.s1], [M.TYPE_PUSH_APTITUDES, plan.s2]]) {
    try {
      resultat[type] = { ...resultat[type], ...(await envoyerEtInscrire(supabase, type, bloc)) };
    } catch (e) {
      resultat[type] = { ...resultat[type], error: e.message };
    }
  }
  return resultat;
}

module.exports = { runAlertesSecurite, calculerPlan };
