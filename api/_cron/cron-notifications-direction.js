// api/_cron/cron-notifications-direction.js — Notifications D2, D3 et D4
// (projet docs/projets/notifications-push.md, tâche 8). F2 (encours du
// vendredi) est envoyée par le job du mail lui-même : api/cron-encours-fournisseurs.js.
//
// D2 « Nouveau chantier signé » (?job=nouveaux_chantiers, jours ouvrés vers
//   8h45 Paris, .github/workflows/cron-push-nouveaux-chantiers.yml) :
//   1. relit chantiers, cycle de vie (chantier_cycle_vie) et phasages (ancien
//      cycle repris), et l'état déjà vu (notifications_etat, type D2) ;
//   2. liste les chantiers dont l'étape « Devis signé » est validée, avec la
//      même lecture que la fiche chantier (notificationsDirectionV1) ;
//   3. notifie, en UNE notification, ceux qui n'étaient pas encore vus ;
//   4. enregistre ce qu'il a vu.
//   PREMIER PASSAGE (aucune ligne D2) : tout est enregistré, RIEN n'est envoyé.
//   Comme pour les alertes (tâche 6), l'état stocké = ce qui a été VU : il est
//   enregistré même interrupteur coupé, pour que l'activation ne déverse pas
//   l'arriéré. Seules exceptions (les nouveaux restent non vus et partiront
//   au passage suivant) : send-push en erreur, ou notification D2 du jour
//   déjà écrite (relance le même jour).
//
// D3 « Synthèse de la semaine » (?job=synthese_semaine, lundi vers 8h30
//   Paris, .github/workflows/cron-push-synthese-semaine.yml) : bandeau du Bilan
//   semaine de la semaine écoulée, calculé par les fonctions de l'écran
//   (bilanPeriodeV3) sur les relevés journaliers. Les relevés du dimanche sont
//   écrits la veille au soir (cron-releves-journaliers, 23h45 Paris). Relevé
//   absent → la notification le dit (« relevé pas encore disponible »).
//   Une seule notification par semaine (clé D3-<semaine>).
//
// D4 « Écart du contrôle du journal d'avancement » : appelée par
//   cron-journal-avancement.js après le contrôle de nuit, seulement quand
//   l'écart est ≠ 0. Type « boîte seule » du catalogue : send-push l'écrit dans
//   la boîte des admins (push_statut « boite_seule ») et n'envoie aucun push.
//
// `&simulation=1` : n'écrit ni n'envoie rien ; renvoie ce qui serait notifié
// et les destinataires (send-push en simulation).
// `&pas_avant=8` (créneaux planifiés) : appel ignoré avant 8h Paris (deux
// créneaux UTC pour couvrir l'heure d'été et d'hiver).
// Aucune fonction Vercel ajoutée : tout passe par le dispatcher.

const { appelerSendPush } = require("./cron-push-reportes.js");

const TABLE_ETAT = "notifications_etat";
const TABLE_RELEVES = "chantier_releves_journaliers";
// Colonnes légères du Bilan (BilanPeriode.jsx, COLONNES_LEGERES) : production,
// marge de la période et heures se lisent dans ces colonnes.
const COLONNES_RELEVES = "chantier_id, chantier_nom, date_releve, avancement, vendu_ht, heures_vendues, heures_reelles, "
  + "production_cumulee, marge_avancement, marge_terminaison, marge_probable, budget_restant, materiaux_en_avance, "
  + "heures_sans_lot, pct_sans_lot, chantier_repris, statut_completude, cr_manquants";

let _modules = null;
async function modules() {
  if (!_modules) {
    const [dir, tables, periode] = await Promise.all([
      import("../../src/Renovation/notificationsDirectionV1.mjs"),
      import("../../src/Renovation/chantiersTables.mjs"),
      import("../../src/Renovation/bilanPeriodeV3.mjs"),
    ]);
    _modules = { dir, tables, periode };
  }
  return _modules;
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

const estSimulation = (req) => ["1", "true", "oui"].includes(String(req?.query?.simulation || "").toLowerCase());

/** Créneau planifié avant l'heure : on laisse l'autre créneau du jour faire le passage. */
function ignorerAvantHeure(req, t, simulation) {
  const pasAvant = parseInt(String(req?.query?.pas_avant ?? ""), 10);
  if (!simulation && Number.isFinite(pasAvant) && typeof t?.hour === "number" && t.hour < pasAvant) {
    return { ok: true, ignore: `Il est ${t.hour}h à Paris : passage réservé à ${pasAvant}h ou plus (l'autre créneau du jour s'en charge).` };
  }
  return null;
}

async function destinatairesSimules(n) {
  try {
    const r = await appelerSendPush({ mode: "serveur", simulation: true, type: n.type, titre: n.titre,
      texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement });
    return r?.resume || null;
  } catch (e) {
    return { erreur: e.message };
  }
}

const resumeNotification = (n) => (n ? { type: n.type, titre: n.titre, texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement } : null);

// ─── D2 ─────────────────────────────────────────────────────────────────────

/** Lit tout et calcule le plan D2, sans rien écrire. */
async function calculerPlanD2(supabase, dateParis) {
  const M = await modules();
  const [chantiers, lignesCycleVie, phasages, etatsStockes] = await Promise.all([
    lireTout(supabase, "chantiers", "id, nom, statut, archive_le"),
    lireTout(supabase, "chantier_cycle_vie", "chantier_id, etape_id, etat"),
    lireTout(supabase, "phasages", "chantier_id, plan_travaux, updated_at"),
    lireTout(supabase, TABLE_ETAT, "type, cle_objet", (q) => q.eq("type", M.dir.TYPE_D2)),
  ]);
  const signes = M.dir.chantiersSignesV1({ chantiers, lignesCycleVie, phasages });
  const plan = M.dir.planD2V1({ signes, etatsStockes, dateParis });
  return { M, signes, plan };
}

async function runNouveauxChantiers(req, supabase, t) {
  const simulation = estSimulation(req);
  const ignore = ignorerAvantHeure(req, t, simulation);
  if (ignore) return ignore;
  if (!t?.dateIso) throw new Error("Date de Paris inconnue : clé de regroupement impossible.");
  const { signes, plan } = await calculerPlanD2(supabase, t.dateIso);
  const resume = {
    ok: true, simulation,
    premier_passage: plan.premierPassage,
    chantiers_signes: signes.length,
    nouveaux: plan.nouveaux.map((s) => s.nom),
    notifications: plan.notification ? 1 : 0,
  };
  if (simulation) {
    return {
      ...resume,
      message: plan.premierPassage
        ? `Premier passage : 0 envoi, ${plan.ecritures.length} états seraient enregistrés (dont la référence).`
        : `${plan.notification ? 1 : 0} notification, ${plan.ecritures.length} chantier(s) à enregistrer.`,
      etats_a_enregistrer: plan.ecritures.length,
      notification: resumeNotification(plan.notification),
      destinataires: plan.notification ? await destinatairesSimules(plan.notification) : null,
      detail_signes: signes,
    };
  }

  let envoi = null;
  let garder = false; // vrai : les nouveaux ne sont pas enregistrés (passage suivant)
  if (plan.notification) {
    const n = plan.notification;
    try {
      const r = await appelerSendPush({ mode: "serveur", type: n.type, titre: n.titre, texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement });
      const ecrites = r?.ecrites_en_boite || 0;
      const bloque = r?.resume?.bloque_par || null;
      if (!ecrites && !bloque && (r?.resume?.doublons || 0) > 0) garder = true;
      envoi = { ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0, bloque_par: bloque, reporte: garder };
    } catch (e) {
      garder = true;
      envoi = { erreur: e.message, reporte: true };
    }
  }
  const aEcrire = garder ? [] : plan.ecritures;
  const maintenant = new Date().toISOString();
  const erreurs = envoi?.erreur ? [`send-push : ${envoi.erreur}`] : [];
  if (aEcrire.length) {
    const { error } = await supabase.from(TABLE_ETAT).upsert(
      aEcrire.map((w) => ({ ...w, maj_le: maintenant, notifie_le: maintenant })),
      { onConflict: "type,cle_objet", ignoreDuplicates: true },
    );
    if (error) erreurs.push(`${TABLE_ETAT} : ${error.message}`);
  }
  return {
    ...resume,
    message: plan.premierPassage ? `Premier passage : 0 envoi, ${aEcrire.length} états enregistrés comme référence.` : undefined,
    envoi,
    etats_enregistres: erreurs.some((e) => e.startsWith(TABLE_ETAT)) ? 0 : aEcrire.length,
    ...(erreurs.length ? { error: erreurs.join(" ; ") } : {}),
  };
}

// ─── D3 ─────────────────────────────────────────────────────────────────────

/** Lit ce que lit l'écran du Bilan pour une semaine et calcule la synthèse. */
async function calculerSyntheseSemaine(supabase, weekId) {
  const M = await modules();
  const periode = M.periode.periodeSemaineV3(weekId);
  if (!periode) throw new Error(`Semaine illisible : ${weekId}`);
  const avant = M.periode.ajouterJoursV3(periode.debut, -21);
  const semaines = [];
  for (let d = periode.debut; d <= periode.fin; d = M.periode.ajouterJoursV3(d, 1)) {
    const s = M.periode.semaineIsoV3(d);
    if (!semaines.includes(s)) semaines.push(s);
  }
  const [lignesChantiers, releves, pointages, rapports, journal, lignesCommandes] = await Promise.all([
    lireTout(supabase, "chantiers", "*"),
    lireTout(supabase, TABLE_RELEVES, COLONNES_RELEVES, (q) => q.lte("date_releve", periode.fin).order("id")),
    lireTout(supabase, "pointages", "chantier_id, date, heures, ouvrier", (q) => q.gte("date", avant).lte("date", periode.fin).order("id")),
    lireTout(supabase, "rapports", "id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, semaine", (q) => q.in("semaine", semaines).order("id")),
    lireTout(supabase, "avancement_journal", "chantier_id, tache_id, ouvrage_id, source, avancement_avant, avancement_apres, date_realisation, created_at",
      (q) => q.gte("date_realisation", periode.debut).lte("date_realisation", periode.fin).order("id")),
    lireTout(supabase, "commande_lignes", "chantier_id, commandes!inner(date_doc)",
      (q) => q.gte("commandes.date_doc", periode.debut).lte("commandes.date_doc", periode.fin).order("id")),
  ]);
  // Liste des chantiers de l'écran : non archivés, même transformation.
  const chantiers = lignesChantiers.filter((l) => !l.archive_le).map(M.tables.depuisLigneChantier).filter(Boolean);
  const commandes = lignesCommandes.map((l) => ({ chantier_id: l.chantier_id, date: l.commandes?.date_doc }));
  const s = M.dir.syntheseSemaineD3V1({ weekId, chantiers, releves, pointages, rapports, journal, commandes });
  return { M, s };
}

async function runSyntheseSemaine(req, supabase, t) {
  const simulation = estSimulation(req);
  const ignore = ignorerAvantHeure(req, t, simulation);
  if (ignore) return ignore;
  const M = await modules();
  const demandee = String(req?.query?.semaine || "").trim();
  const weekId = demandee || M.dir.semaineEcouleeV1(t?.dateIso);
  if (!weekId) throw new Error("Date de Paris inconnue : semaine écoulée impossible à déterminer.");
  const { s } = await calculerSyntheseSemaine(supabase, weekId);
  const n = M.dir.contenuPushD3V1(s);
  const resume = {
    ok: true, simulation, semaine: weekId,
    releve_disponible: s.releveDisponible === true,
    dernier_jour_travaille: s.bornes?.dateFin || null,
    chantiers_retenus: s.retenus, chantiers_avec_releve: s.nbDisponibles,
    bandeau: s.bandeau ? {
      production: s.bandeau.production, marge_periode: s.bandeau.margePeriode,
      marge_periode_pct: s.bandeau.margePeriodePct, heures_validees: s.bandeau.heuresValidees,
    } : null,
    notification: resumeNotification(n),
  };
  if (simulation) return { ...resume, destinataires: await destinatairesSimules(n) };
  const r = await appelerSendPush({ mode: "serveur", type: n.type, titre: n.titre, texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement });
  return { ...resume, ecrites_en_boite: r?.ecrites_en_boite || 0, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0,
    bloque_par: r?.resume?.bloque_par || null, doublons: r?.resume?.doublons || 0 };
}

// ─── D4 ─────────────────────────────────────────────────────────────────────

/**
 * Après le contrôle de nuit : écart ≠ 0 → une notification D4 (boîte seule).
 * N'échoue jamais le contrôle lui-même : une erreur d'envoi est rendue dans
 * la réponse (clé « erreur », pas « error », pour ne pas faire passer le
 * contrôle pour raté).
 */
async function notifierEcartJournal(resultat, t, { simulation = false } = {}) {
  const M = await modules();
  const n = M.dir.contenuPushD4V1({ resultat, dateParis: t?.dateIso || "" });
  if (!n) return { notifications: 0, raison: "aucun écart : rien d'écrit" };
  if (simulation) return { notifications: 1, simulation: true, notification: resumeNotification(n), destinataires: await destinatairesSimules(n) };
  try {
    const r = await appelerSendPush({ mode: "serveur", type: n.type, titre: n.titre, texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement });
    return { notifications: 1, titre: n.titre, ecrites_en_boite: r?.ecrites_en_boite || 0, envoyes: r?.envoyes || 0,
      bloque_par: r?.resume?.bloque_par || null, boite_seule: r?.resume?.boite_seule || 0 };
  } catch (e) {
    return { notifications: 0, erreur: e.message };
  }
}

module.exports = { runNouveauxChantiers, runSyntheseSemaine, notifierEcartJournal, calculerPlanD2, calculerSyntheseSemaine };
