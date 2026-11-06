// api/_cron/cron-factures-a-emettre.js — Notification F1 « facture à émettre »
// côté serveur (projet docs/projets/notifications-push.md, tâche 7).
//
// CE QUE FAIT LE JOB : chaque jour ouvré vers 8h15 Paris, il relit chantiers,
// phasages, cycle de vie et factures, appelle la détection partagée avec la
// fiche chantier (src/Renovation/factureAEmettre.mjs, mêmes fonctions) et
// envoie le PUSH F1 pour chaque échéance prête qui le mérite (voir
// decisionPushF1 dans le module), via l'Edge Function send-push en mode
// « serveur », clé de regroupement F1-<phasage>-<échéance>.
//
// CE QU'IL NE FAIT PAS : il n'envoie PAS le mail et n'écrit PAS le drapeau
// facture_mail_<échéance> (phasages.plan_travaux.meta). Le mail « facture à
// émettre » reste envoyé par la fiche chantier, à son ouverture, exactement
// comme avant (règle 8 : les mails continuent comme aujourd'hui). Si le job
// posait ce drapeau, la fiche n'enverrait plus le mail.
//
// EXACTEMENT UNE FOIS :
//   - mail : inchangé, drapeau posé par la fiche après envoi réussi ;
//   - push : send-push écrit d'abord la notification en boîte, avec un index
//     unique (personne, type, clé de regroupement) ; seules les lignes
//     réellement créées partent en push. Rejouer le job, ou deux passages
//     qui se croisent, ne renvoient rien. Si la fiche a vu l'échéance la
//     première (mail parti, drapeau posé après la mise en service du F1), le
//     job envoie le push au passage suivant : le navigateur ne peut pas
//     appeler send-push en mode serveur (secret serveur exigé).
//   - interrupteur général coupé (livré coupé) ou type F1 désactivé :
//     send-push n'écrit et n'envoie rien ; l'échéance sera poussée une fois,
//     au premier passage après activation, si elle est toujours à émettre.
//
// `?job=factures_a_emettre&simulation=1` : liste ce qui serait envoyé,
// échéance par échéance, sans rien envoyer ni écrire (send-push n'est pas
// appelé).
//
// Appelé par le dispatcher (?job=factures_a_emettre), créneau
// .github/workflows/cron-factures-a-emettre.yml. Aucune fonction Vercel ajoutée.

const { appelerSendPush } = require("./cron-push-reportes.js");

const PLAFOND_PAR_PASSAGE = 30; // garde-fou : au-delà, le reste part au passage suivant

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
  const [chantiers, phasages, lignesCycleVie, factures, cfgEcheancier, cfgPhases] = await Promise.all([
    lireTout(supabase, "chantiers", "*"),
    lireTout(supabase, "phasages", "*"),
    lireTout(supabase, "chantier_cycle_vie", "chantier_id, etape_id, etat, maj_par, updated_at"),
    // source='manuel', comme la fiche : l'échéancier raisonne en HT, une
    // facture ProGBat (montant_ht NULL) n'entre pas dans ce calcul.
    lireTout(supabase, "chantier_factures_client", "*", (q) => q.eq("source", "manuel")),
    lireConfig(supabase, "echeancier_facturation"),
    lireConfig(supabase, "phases_travaux"),
  ]);
  // Même règle que la fiche : lignes du réglage Admin si présentes, sinon défaut.
  const lignesDefaut = Array.isArray(cfgEcheancier?.lignes) && cfgEcheancier.lignes.length > 0 ? cfgEcheancier.lignes : undefined;
  const plan = M.planFacturesAEmettre({
    chantiers, phasages, lignesCycleVie, factures,
    echeancierDefaut: lignesDefaut, phaseIds: idsPhases(cfgPhases),
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
    push: p.pousser ? "oui" : "non",
    raison: p.raison,
    cle: p.cle,
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
  const { M, plan } = await calculerPlan(supabase);
  const aPousser = plan.filter((p) => p.pousser);
  const resultat = {
    ok: true, simulation,
    echeances_pretes: plan.length,
    a_pousser: aPousser.length,
    mise_en_service_f1: M.F1_MISE_EN_SERVICE,
  };
  if (simulation) return { ...resultat, detail: plan.map(ligneResume) };

  let appels = 0, ecrites = 0, envoyes = 0, echecs = 0, reportees = 0;
  const erreurs = [];
  for (const p of aPousser) {
    if (appels >= PLAFOND_PAR_PASSAGE) { reportees++; continue; }
    appels++;
    const contenu = M.contenuPushF1({ chantierId: p.chantierId, chantierNom: p.chantierNom, ligne: p.ligne });
    try {
      const r = await appelerSendPush({ mode: "serveur", type: "F1", ...contenu, cle_regroupement: p.cle });
      ecrites += r?.ecrites_en_boite || 0;
      envoyes += r?.envoyes || 0;
      echecs += r?.echecs || 0;
    } catch (e) {
      erreurs.push(`${p.cle} : ${e.message}`);
    }
  }
  // Une erreur d'appel remonte dans le résumé (le créneau GitHub la signale).
  return {
    ...resultat, appels, ecrites_en_boite: ecrites, envoyes, echecs, reportees,
    ...(erreurs.length ? { error: erreurs.slice(0, 5).join(" | ") } : {}),
  };
}

module.exports = { runFacturesAEmettre, calculerPlan, PLAFOND_PAR_PASSAGE };
