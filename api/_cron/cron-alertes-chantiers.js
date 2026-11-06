// api/_cron/cron-alertes-chantiers.js — Notifications C4, C5 et D1 (projet
// docs/projets/notifications-push.md, tâche 6).
//
// CE QUE FAIT LE JOB, chaque jour ouvré vers 9h Paris :
//   1. il relit les relevés journaliers, les chantiers, les seuils des marges
//      et l'état déjà vu (public.notifications_etat, types C4 / C5 / D1) ;
//   2. il calcule les niveaux d'alerte avec la chaîne de la page Alertes
//      (src/Renovation/alertesEcranV1.mjs → alertesMargesV2 → alertesV1) :
//      mêmes semaines, même filtre « chantier actif », mêmes exclusions, mêmes
//      seuils. Aucune détection réécrite (règle 3) ;
//   3. il compare avec l'état stocké (src/Renovation/alertesChantiersPushV1.mjs)
//      et n'envoie que les AGGRAVATIONS (règle 2) : C4 « passe en critique »,
//      C5 « passe à surveiller », D1 « marge à terminaison devenue négative »,
//      au plus UNE notification par type et par passage (règle 5) ;
//   4. il enregistre ce qu'il a vu.
//
// PREMIER PASSAGE : aucune ligne C4 / C5 / D1 dans notifications_etat → l'état
// de tous les chantiers est enregistré, RIEN n'est envoyé, et la réponse le dit
// (« premier_passage: true »).
//
// INTERRUPTEUR GÉNÉRAL COUPÉ (ou type désactivé, aucun rôle coché) : send-push
// n'écrit rien et n'envoie rien. Le job enregistre QUAND MÊME ce qu'il a vu.
// Raison : l'état stocké = ce qui a été vu, pas ce qui a été envoyé. Ainsi le
// premier passage pose la référence dès la mise en ligne, et le jour où Loris
// active l'interrupteur, seuls les changements survenus APRÈS partent — pas
// l'arriéré des semaines où tout était coupé.
// Seules exceptions, où l'ancien état est GARDÉ pour que l'aggravation parte
// au passage suivant : send-push en erreur, ou notification du même type déjà
// écrite aujourd'hui (même clé de regroupement : relance manuelle le même jour).
//
// RELEVÉ PAS ENCORE DISPONIBLE : rien n'est écrit ni envoyé, la réponse le dit
// (jamais « aucune alerte »). Une lecture en échec lève une erreur.
//
// `?job=alertes_chantiers&simulation=1` : n'écrit ni n'envoie rien ; renvoie
// les niveaux, ce qui serait notifié et enregistré, et les destinataires (via
// send-push en simulation, qui n'écrit rien).
//
// Appelé par le dispatcher (?job=alertes_chantiers), créneau
// .github/workflows/cron-alertes-chantiers.yml. Aucune fonction Vercel ajoutée.

const { appelerSendPush } = require("./cron-push-reportes.js");

const TABLE_ETAT = "notifications_etat";
const TABLE_RELEVES = "chantier_releves_journaliers";
const PAQUET_IDS = 100;

let _modules = null;
async function modules() {
  if (!_modules) {
    const [ecran, push, donnees, tables, finance] = await Promise.all([
      import("../../src/Renovation/alertesEcranV1.mjs"),
      import("../../src/Renovation/alertesChantiersPushV1.mjs"),
      import("../../src/Renovation/pointsAttentionDonneesV1.mjs"),
      import("../../src/Renovation/chantiersTables.mjs"),
      import("../../src/chantierFinance.mjs"),
    ]);
    _modules = { ecran, push, donnees, tables, finance };
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

async function lireConfig(supabase, cle) {
  const { data, error } = await supabase.from("planning_config").select("value").eq("key", cle).maybeSingle();
  if (error) throw new Error(`planning_config ${cle} : ${error.message}`);
  return data?.value ?? null;
}

// Même lecture que la page Alertes (src/Renovation/chargerRelevesAlertes.js) :
// index léger de la période, relevés retenus par la MÊME fonction que la
// préparation, puis colonnes complètes de ces seuls relevés.
async function lireRelevesRetenus(supabase, M, { debut, fin, weekIds }) {
  const index = await lireTout(supabase, TABLE_RELEVES, "id, chantier_id, date_releve",
    (q) => q.gte("date_releve", debut).lte("date_releve", fin)
      .order("date_releve", { ascending: true }).order("chantier_id", { ascending: true }));
  const ids = M.donnees.idsRelevesRetenusV2({ lignes: index, weekIds });
  const lignes = [];
  for (let i = 0; i < ids.length; i += PAQUET_IDS) {
    const { data, error } = await supabase.from(TABLE_RELEVES)
      .select(M.donnees.COLONNES_RELEVES_ALERTES_V2).in("id", ids.slice(i, i + PAQUET_IDS));
    if (error) throw new Error(`${TABLE_RELEVES} : ${error.message}`);
    lignes.push(...(data || []));
  }
  lignes.sort((x, y) => String(x.date_releve).localeCompare(String(y.date_releve))
    || String(x.chantier_id).localeCompare(String(y.chantier_id)));
  return lignes;
}

/**
 * Lit tout et calcule le plan, sans rien écrire.
 * @param {string} dateParis AAAA-MM-JJ
 */
async function calculerPlanAlertes(supabase, dateParis) {
  const M = await modules();
  const semaineCourante = M.ecran.semaineDeLaDateV1(dateParis);
  if (!semaineCourante) throw new Error(`Date de Paris illisible : ${dateParis}`);
  const semaines = M.ecran.semainesAlertesV1(semaineCourante);
  const periode = M.ecran.periodeRelevesAlertesV1(semaines);
  const [lignes, lignesChantiers, seuilsMarges, etatsStockes] = await Promise.all([
    lireRelevesRetenus(supabase, M, { ...periode, weekIds: semaines }),
    lireTout(supabase, "chantiers", "*"),
    lireConfig(supabase, M.finance.CLE_CONFIG_SEUILS_MARGES),
    lireTout(supabase, TABLE_ETAT, "type, cle_objet, etat", (q) => q.in("type", M.push.TYPES_ETAT_ALERTES)),
  ]);
  // Référentiel de l'écran : chantiers non archivés (chargerChantiers du front),
  // même transformation des lignes.
  const referentielChantiers = lignesChantiers
    .filter((l) => !l.archive_le)
    .map(M.tables.depuisLigneChantier)
    .filter(Boolean);
  const exclusions = M.ecran.CHANTIERS_EXCLUS_ALERTES_V1;
  const { resultat, courants } = M.ecran.calculerAlertesEcranV1({
    lignes, semaines, seuilsMarges, referentielChantiers, exclusions,
  });
  const etats = M.push.etatsChantiersV1({ resultat, courants, exclusions });
  const plan = M.push.planAlertesChantiersV1({ etats, etatsStockes, dateParis });
  return { M, semaines, periode, resultat, etats, plan };
}

const detailEtat = (e) => ({
  chantier: e.nom, chantier_id: e.chantierId, niveau: e.niveau,
  marge_terminaison: e.margeTerminaison == null ? "inconnue" : Math.round(e.margeTerminaison),
  marge: e.marge, avancement: e.avancement, releve_du: e.dateReleve,
});

const resumeNotification = (n) => ({
  type: n.type, titre: n.titre, texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement,
});

/**
 * t : parisNow() du dispatcher ({ hour, dateIso… }).
 * `&pas_avant=9` (posé par le créneau planifié) : appel ignoré avant 9h Paris.
 */
async function runAlertesChantiers(req, supabase, t) {
  const simulation = ["1", "true", "oui"].includes(String(req?.query?.simulation || "").toLowerCase());
  const pasAvant = parseInt(String(req?.query?.pas_avant ?? ""), 10);
  if (!simulation && Number.isFinite(pasAvant) && typeof t?.hour === "number" && t.hour < pasAvant) {
    return { ok: true, ignore: `Il est ${t.hour}h à Paris : passage réservé à ${pasAvant}h ou plus (l'autre créneau du jour s'en charge).` };
  }
  if (!t?.dateIso) throw new Error("Date de Paris inconnue : clé de regroupement impossible.");

  const { semaines, resultat, etats, plan } = await calculerPlanAlertes(supabase, t.dateIso);
  const base = {
    ok: true, simulation,
    semaines,
    releve_disponible: resultat.releveDisponible === true,
  };
  // Relevé absent : on ne sait pas. Rien n'est écrit (sinon tous les chantiers
  // passeraient « aucun » puis rechuteraient), rien n'est envoyé.
  if (resultat.releveDisponible !== true) {
    return { ...base, notifications: 0, etats_enregistres: 0,
      message: "Relevé pas encore disponible : aucun niveau calculé, rien d'écrit ni d'envoyé (ce n'est pas « aucune alerte »)." };
  }
  const resume = {
    ...base,
    premier_passage: plan.premierPassage,
    chantiers: plan.comptes.chantiers,
    niveaux: plan.comptes.niveaux,
    marges_a_terminaison: plan.comptes.marges,
    aggravations: {
      C4: plan.aggravations.C4.map((e) => e.nom),
      C5: plan.aggravations.C5.map((e) => e.nom),
      D1: plan.aggravations.D1.map((e) => e.nom),
    },
    ameliorations: plan.comptes.ameliorations,
    notifications: plan.notifications.length,
  };

  if (simulation) {
    const notifications = [];
    for (const n of plan.notifications) {
      let destinataires = null;
      try {
        const r = await appelerSendPush({ mode: "serveur", simulation: true, type: n.type, titre: n.titre,
          texte: n.texte, lien: n.lien, cle_regroupement: n.cle_regroupement });
        destinataires = r?.resume || null;
      } catch (e) {
        destinataires = { erreur: e.message };
      }
      notifications.push({ ...resumeNotification(n), destinataires });
    }
    return {
      ...resume,
      message: plan.premierPassage
        ? `Premier passage : 0 envoi, ${plan.ecritures.length} états seraient enregistrés.`
        : `${plan.notifications.length} notification(s) et ${plan.ecritures.length} état(s) à enregistrer.`,
      etats_a_enregistrer: plan.ecritures.length,
      detail_notifications: notifications,
      detail_chantiers: etats.map(detailEtat),
    };
  }

  // ── Envoi : UN appel send-push par type aggravé ────────────────────────
  const reportes = new Set(); // types dont l'ancien état est gardé
  const notifies = new Set(); // types réellement écrits en boîte
  const envois = [];
  for (const n of plan.notifications) {
    try {
      const r = await appelerSendPush({ mode: "serveur", type: n.type, titre: n.titre, texte: n.texte,
        lien: n.lien, cle_regroupement: n.cle_regroupement });
      const ecrites = r?.ecrites_en_boite || 0;
      const bloque = r?.resume?.bloque_par || null;
      if (ecrites > 0) notifies.add(n.type);
      else if (!bloque && (r?.resume?.doublons || 0) > 0) reportes.add(n.type);
      envois.push({ type: n.type, titre: n.titre, ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0,
        echecs: r?.echecs || 0, bloque_par: bloque, reporte: reportes.has(n.type) });
    } catch (e) {
      reportes.add(n.type);
      envois.push({ type: n.type, titre: n.titre, erreur: e.message, reporte: true });
    }
  }

  const aEcrire = plan.ecritures.filter((w) => !(w.notifiePar && reportes.has(w.notifiePar)));
  const maintenant = new Date().toISOString();
  const avecNotif = aEcrire.filter((w) => w.notifiePar && notifies.has(w.notifiePar))
    .map((w) => ({ type: w.type, cle_objet: w.cle_objet, etat: w.etat, maj_le: maintenant, notifie_le: maintenant }));
  const sansNotif = aEcrire.filter((w) => !(w.notifiePar && notifies.has(w.notifiePar)))
    .map((w) => ({ type: w.type, cle_objet: w.cle_objet, etat: w.etat, maj_le: maintenant }));
  const erreurs = envois.filter((e) => e.erreur).map((e) => `${e.type} : ${e.erreur}`);
  // Deux écritures homogènes (même colonnes par ligne) : notifie_le n'est posé
  // que sur les lignes réellement notifiées.
  for (const lot of [avecNotif, sansNotif]) {
    if (!lot.length) continue;
    const { error } = await supabase.from(TABLE_ETAT).upsert(lot, { onConflict: "type,cle_objet" });
    if (error) erreurs.push(`${TABLE_ETAT} : ${error.message}`);
  }
  return {
    ...resume,
    message: plan.premierPassage
      ? `Premier passage : 0 envoi, ${aEcrire.length} états enregistrés comme référence.`
      : undefined,
    envois,
    etats_enregistres: erreurs.some((e) => e.startsWith(TABLE_ETAT)) ? 0 : aEcrire.length,
    ...(erreurs.length ? { error: erreurs.join(" ; ") } : {}),
  };
}

module.exports = { runAlertesChantiers, calculerPlanAlertes };
