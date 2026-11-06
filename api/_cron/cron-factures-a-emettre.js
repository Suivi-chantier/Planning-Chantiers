// api/_cron/cron-factures-a-emettre.js — Notification F1 « facture à émettre »
// côté serveur (projet docs/projets/notifications-push.md, tâche 7).
//
// CE QUE FAIT LE JOB : chaque jour ouvré vers 8h15 Paris, il relit chantiers,
// phasages, cycle de vie et factures, appelle la détection partagée avec la
// fiche chantier (src/Renovation/factureAEmettre.mjs, mêmes fonctions) et
// envoie AU PLUS UNE notification F1 par jour (règle 5 : regroupement),
// « N factures à émettre », qui liste les échéances nouvelles (chantier ·
// échéance · montant). send-push en mode « serveur », clé F1-<date Paris>.
//
// CE QU'IL NE FAIT PAS : il n'envoie PAS le mail et n'écrit PAS le drapeau
// facture_mail_<échéance> (phasages.plan_travaux.meta). Le mail « facture à
// émettre » reste envoyé par la fiche chantier, à son ouverture, exactement
// comme avant (règle 8). Si le job posait ce drapeau, la fiche n'enverrait
// plus le mail.
//
// EXACTEMENT UNE FOIS PAR ÉCHÉANCE :
//   - mail : inchangé, drapeau posé par la fiche après envoi réussi ;
//   - push : table public.notifications_etat (type F1, cle_objet
//     « <phasage>-<échéance> »). Une échéance inscrite n'est plus reprise.
//     Le job ne l'inscrit qu'APRÈS une écriture réussie en boîte de réception
//     (send-push → ecrites_en_boite > 0). Interrupteur général coupé, type F1
//     désactivé, ou notification du jour déjà écrite : rien n'est écrit,
//     donc rien n'est inscrit ; l'échéance partira au prochain passage utile.
//   - si la fiche a vu l'échéance la première (mail parti, drapeau posé après
//     la mise en service du F1), le job la reprend au passage suivant : le
//     navigateur ne peut pas appeler send-push en mode serveur.
//
// `?job=factures_a_emettre&simulation=1` : liste ce qui serait envoyé,
// échéance par échéance, et la notification du jour, sans rien envoyer ni
// écrire (send-push n'est pas appelé, notifications_etat n'est pas touchée).
//
// Appelé par le dispatcher (?job=factures_a_emettre), créneau
// .github/workflows/cron-factures-a-emettre.yml. Aucune fonction Vercel ajoutée.

const { appelerSendPush } = require("./cron-push-reportes.js");

const TABLE_ETAT = "notifications_etat";

let _module = null;
async function module_() {
  if (!_module) _module = await import("../../src/Renovation/factureAEmettre.mjs");
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

async function lireConfig(supabase, cle) {
  const { data, error } = await supabase.from("planning_config").select("value").eq("key", cle).maybeSingle();
  if (error) throw new Error(`planning_config ${cle} : ${error.message}`);
  return data?.value ?? null;
}

// Ids des phases, comme loadPhases() de src/constants.js : réglage Admin →
// Phases s'il existe, sinon les phases par défaut (undefined → défaut du module).
function idsPhases(valeur) {
  const items = valeur?.items;
  if (Array.isArray(items) && items.length > 0) return items.map((p, i) => p.id || `phase_${i}`);
  return undefined;
}

/** Lit les données et calcule le plan (aucune écriture). */
async function calculerPlan(supabase) {
  const M = await module_();
  const [chantiers, phasages, lignesCycleVie, factures, etat, cfgEcheancier, cfgPhases] = await Promise.all([
    lireTout(supabase, "chantiers", "*"),
    lireTout(supabase, "phasages", "*"),
    lireTout(supabase, "chantier_cycle_vie", "chantier_id, etape_id, etat, maj_par, updated_at"),
    // source='manuel', comme la fiche : l'échéancier raisonne en HT, une
    // facture ProGBat (montant_ht NULL) n'entre pas dans ce calcul.
    lireTout(supabase, "chantier_factures_client", "*", (q) => q.eq("source", "manuel")),
    lireTout(supabase, TABLE_ETAT, "cle_objet", (q) => q.eq("type", "F1")),
    lireConfig(supabase, "echeancier_facturation"),
    lireConfig(supabase, "phases_travaux"),
  ]);
  // Même règle que la fiche : lignes du réglage Admin si présentes, sinon défaut.
  const lignesDefaut = Array.isArray(cfgEcheancier?.lignes) && cfgEcheancier.lignes.length > 0 ? cfgEcheancier.lignes : undefined;
  const plan = M.planFacturesAEmettre({
    chantiers, phasages, lignesCycleVie, factures,
    echeancierDefaut: lignesDefaut, phaseIds: idsPhases(cfgPhases),
    dejaNotifiees: etat.map((e) => e.cle_objet),
  });
  return { M, plan };
}

function ligneResume(p) {
  return {
    chantier: p.chantierNom,
    echeance: p.ligne.nom,
    pct: p.ligne.pct,
    montant_ht: Math.round(p.montant || 0),
    declencheur: p.ligne.declencheurLibelle,
    mail_deja_parti_le: p.drapeauMail,
    dans_la_notification: p.pousser ? "oui" : "non",
    raison: p.raison,
    cle_objet: p.cleObjet,
  };
}

/**
 * t : parisNow() du dispatcher ({ hour, dateIso… }).
 * `&pas_avant=8` (posé par le créneau planifié) : appel ignoré avant 8h Paris.
 * C'est ce qui fait tomber le passage à 8h15 Paris en hiver comme en été avec
 * deux créneaux UTC (voir .github/workflows/cron-factures-a-emettre.yml).
 */
async function runFacturesAEmettre(req, supabase, t) {
  const simulation = ["1", "true", "oui"].includes(String(req?.query?.simulation || "").toLowerCase());
  const pasAvant = parseInt(String(req?.query?.pas_avant ?? ""), 10);
  if (!simulation && Number.isFinite(pasAvant) && typeof t?.hour === "number" && t.hour < pasAvant) {
    return { ok: true, ignore: `Il est ${t.hour}h à Paris : passage réservé à ${pasAvant}h ou plus (l'autre créneau du jour s'en charge).` };
  }
  if (!t?.dateIso) throw new Error("Date de Paris inconnue : clé de regroupement impossible.");
  const { M, plan } = await calculerPlan(supabase);
  const aNotifier = plan.filter((p) => p.pousser);
  const contenu = M.contenuPushRegroupeF1({ lignes: aNotifier, dateParis: t.dateIso });
  const resultat = {
    ok: true, simulation,
    echeances_pretes: plan.length,
    echeances_a_notifier: aNotifier.length,
    notifications: contenu ? 1 : 0,
    mise_en_service_f1: M.F1_MISE_EN_SERVICE,
  };
  if (simulation) return { ...resultat, notification: contenu, detail: plan.map(ligneResume) };
  if (!contenu) return { ...resultat, inscrites: 0 };

  // UN appel send-push pour toute la journée.
  const r = await appelerSendPush({ mode: "serveur", type: "F1", ...contenu });
  const ecrites = r?.ecrites_en_boite || 0;
  if (ecrites <= 0) {
    // Interrupteur coupé, type désactivé, aucun destinataire ou notification du
    // jour déjà écrite : rien n'a été notifié, rien n'est inscrit.
    return { ...resultat, ecrites_en_boite: 0, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0, inscrites: 0,
      raison: "Rien d'écrit en boîte de réception : aucune échéance marquée comme notifiée." };
  }
  const maintenant = new Date().toISOString();
  const { error } = await supabase.from(TABLE_ETAT).upsert(
    aNotifier.map((p) => ({ type: "F1", cle_objet: p.cleObjet, etat: "notifiee", notifie_le: maintenant, maj_le: maintenant })),
    { onConflict: "type,cle_objet", ignoreDuplicates: true },
  );
  return {
    ...resultat, ecrites_en_boite: ecrites, envoyes: r?.envoyes || 0, echecs: r?.echecs || 0,
    inscrites: error ? 0 : aNotifier.length,
    ...(error ? { error: `${TABLE_ETAT} : ${error.message} (notification écrite, échéances non inscrites : elles seront reprises dans la notification d'un prochain jour)` } : {}),
  };
}

module.exports = { runFacturesAEmettre, calculerPlan };
