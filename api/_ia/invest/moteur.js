// api/_ia/invest/moteur.js — Pont vers src/Invest/tableauBord.mjs.
//
// Pourquoi passer par le moteur du tableau de bord
// ────────────────────────────────────────────────
// « Quels dossiers sont bloqués ? », « quelles échéances sous 7 jours ? »,
// « quelles sont mes priorités ? » sont déjà répondues, en un seul endroit,
// par consolidateData(). Ce module produit des dossiers typés avec leurs
// alertes codées (no_next_action, late_action, blocked_*, stale_red…), leur
// catégorie (decision / watch / delegated) et leur responsable.
//
// Réécrire ces règles ici garantirait qu'elles divergent de l'écran. Le
// précédent est documenté dans le dépôt : le tableau de bord interrogeait
// autrefois huit noms de tables de prospects, dont sept n'existaient pas, et
// personne ne le voyait. On lit donc le moteur, on ne le réinvente pas.
//
// Extension .mjs : le module est en ESM et api/ est en CommonJS, d'où
// `await import()`. C'est exactement ce que fait déjà
// api/_cron/cron-invest-tableau-bord.js.
//
// ⚠ EXCLUSION DES PROSPECTS
// REQUETES_TABLEAU_BORD contient une requête sur invest_prospects. Elle est
// retirée ici, et consolidateData() reçoit `crmProspects: []`. Deux effets :
// aucune donnée de prospect n'atteint le modèle, et aucun dossier de type
// « prospect » n'apparaît dans les réponses. C'est la traduction en code de
// la règle invest_prospects = NO TOUCH pour la V1.
//
// La requête `routineRows` est également retirée : elle lit
// invest_morning_routine_items, réservée à la page dashboard, et ne sert qu'à
// la colonne « traité aujourd'hui » que la V1 n'expose pas.

const { table, lireNomsCollaborateurs } = require("./donnees");

// Clés de REQUETES_TABLEAU_BORD que le Copilote n'exécute pas.
// `utilisateurs` : remplacée par la porte étroite lireNomsCollaborateurs (id, nom).
const REQUETES_EXCLUES = new Set(["crmProspects", "routineRows", "utilisateurs"]);

let _moteur = null;
let _pilotage = null;

async function moteur() {
  if (!_moteur) {
    _moteur = await import("../../../src/Invest/tableauBord.mjs");
  }
  return _moteur;
}

// Moteur commun du Dossier Invest (Tranche 2b) : le Copilote ne recalcule
// aucune règle de pilotage, il lit celles de pilotage.mjs.
async function pilotage() {
  if (!_pilotage) {
    _pilotage = await import("../../../src/Invest/dossiers/pilotage.mjs");
  }
  return _pilotage;
}

// Adaptateur minimal : les requêtes de tableauBord.mjs appellent sb.from(...),
// on leur passe donc un objet qui expose `from` en le faisant passer par la
// liste blanche de donnees.js. Une requête qui viserait une table interdite
// lèverait ici, et non silencieusement plus loin.
const sbFiltre = { from: (nom) => table(nom) };

// Charge et consolide. `profil` sert au moteur à décider ce qui est « à moi »
// et ce qui est « délégué » : il vient du JWT, jamais du modèle.
async function chargerDossiers({ profil, jour = null }) {
  const m = await moteur();
  await pilotage(); // exposerDossier (synchrone) s'en sert
  const avertissements = [];

  const requetes = m.REQUETES_TABLEAU_BORD.filter((r) => !REQUETES_EXCLUES.has(r.cle));
  const jourEffectif = jour || m.todayIso();

  const resultats = await Promise.all(
    requetes.map(async (r) => {
      try {
        const { data, error } = await r.requete(sbFiltre, { jour: jourEffectif });
        if (error) {
          avertissements.push(`${r.label} : ${error.message}`);
          return [r.cle, r.inconnuSiErreur ? null : []];
        }
        const lignes = data || [];
        return [r.cle, r.apres ? r.apres(lignes) : lignes];
      } catch (e) {
        avertissements.push(`${r.label} : ${e.message}`);
        // Dossiers illisibles = avancement INCONNU (null), jamais « aucun dossier ».
        return [r.cle, r.inconnuSiErreur ? null : []];
      }
    })
  );

  const brut = Object.fromEntries(resultats);
  const noms = await lireNomsCollaborateurs().catch(() => null);
  if (noms === null) avertissements.push("annuaire : noms des collaborateurs illisibles");

  const consolide = m.consolidateData({
    clients: brut.clients || [],
    crmProspects: [],                    // ← exclusion invest_prospects
    biens: brut.biens || [],
    propositions: brut.propositions || [],
    planning: brut.planning || [],
    actions: brut.actions || [],
    // Tranche 2b-bis : Dossier Invest (null = illisible → « avancement indisponible »).
    dossiersInvest: brut.dossiersInvest ?? null,
    etapesInvest: brut.etapesInvest ?? null,
    utilisateurs: noms || [],
    jour: jourEffectif,
    profil,
    pilote: (profil && profil.nom) || "",
  });

  return { moteur: m, consolide, avertissements, jour: jourEffectif };
}

// Forme commune de restitution d'un dossier vers le modèle. On ne transmet
// JAMAIS `raw` : il contient la ligne entière de invest_clients ou
// invest_biens, avec ses jsonb (strategie_data, visite_data) qui feraient
// exploser le contexte sans rien apporter.
// Situation Dossier Invest d'un client, telle que le moteur 2b la calcule.
// Trois cas explicitement distincts : dossier en cours, aucun dossier en
// cours, avancement indisponible (données non chargées).
function exposerPilotage(p, P, { inconnu = false } = {}) {
  if (!p) {
    return inconnu
      ? { situation: "avancement_indisponible", libelle: "Avancement indisponible : Dossiers Invest non chargés" }
      : { situation: "aucun_dossier", libelle: "Aucun Dossier Invest en cours" };
  }
  const etape = (a) => a && ({
    etape: a.libelle, statut: a.statutLibelle, balle: a.balle.libelle,
    prochaine_action: a.prochaineAction, echeance: a.echeance,
    echeance_depassee: a.echeanceDepassee, blocage: a.blocage ? (a.blocage.motif || "bloquée") : null,
    a_confirmer: a.aConfirmer,
  });
  const ajd = P.actionDuJour(p);
  return {
    situation: "dossier_en_cours",
    libelle: P.resumePilotage(p),
    reference: p.reference,
    statut: p.statutLibelle,
    conseiller: p.conseiller,
    etape_principale: etape(p.principale),
    etapes_actives: p.actives.map(etape),
    etapes_a_confirmer: p.aConfirmer,
    action_du_jour: { qui: ajd.responsable, quoi: ajd.action, avant: ajd.echeance, etape: ajd.etape ? ajd.etape.libelle : null },
    taches_ouvertes: p.tachesOuvertes,
    taches_en_retard: p.tachesEnRetard.map((t) => ({ tache: t.titre, echeance: t.dueDate })),
    alertes: P.alertesPilotage(p).map((a) => ({ code: a.code, libelle: a.label, niveau: a.level, echeance: a.due_date || null })),
  };
}

// Pilotage Dossier Invest de clients précis (ou de tous si `clientIds` est
// null), pour les outils qui lisent invest_clients directement.
async function pilotagesClients(clientIds = null, { jour = null } = {}) {
  const P = await pilotage();
  const m = await moteur();
  const aujourdhui = jour || m.todayIso();
  const avertissements = [];
  let qd = table("invest_dossiers").select("id,client_id,reference,libelle,statut,conseiller_id").in("statut", ["ouvert", "actif", "suspendu"]);
  if (clientIds) qd = qd.in("client_id", clientIds);
  const { data: dossiers, error: eD } = clientIds && !clientIds.length ? { data: [], error: null } : await qd;
  if (eD) return { P, parClient: new Map(), inconnu: true, avertissements: [`dossiers Invest : ${eD.message}`] };
  const ids = (dossiers || []).map((d) => d.id);
  let etapes = [], taches = [];
  if (ids.length) {
    const { data: e, error: eE } = await table("invest_dossier_etapes")
      .select("id,dossier_id,operation_id,etape,statut,balle,balle_utilisateur_id,balle_tiers_libelle,prochaine_action,echeance,blocage_motif,bloquee_depuis,reprise_a_confirmer,updated_at")
      .in("dossier_id", ids).is("operation_id", null);
    if (eE) return { P, parClient: new Map(), inconnu: true, avertissements: [`étapes des dossiers : ${eE.message}`] };
    etapes = e || [];
    const { data: t, error: eT } = await table("invest_mission_actions")
      .select("id,client_id,dossier_id,etape,status,due_date,action_title,responsable").in("dossier_id", ids);
    if (eT) avertissements.push(`tâches des dossiers : ${eT.message}`);
    taches = t || [];
  }
  const noms = await lireNomsCollaborateurs().catch(() => null);
  if (noms === null) avertissements.push("annuaire : noms des collaborateurs illisibles");
  const parClient = P.indexerPilotage({ dossiers: dossiers || [], etapes, taches, utilisateurs: noms || [], aujourdhui });
  return { P, parClient, inconnu: false, avertissements };
}

function exposerDossier(d, m) {
  return {
    type: d.type,                                  // client | bien | team
    id: d.id || null,
    libelle: d.label || "",
    sous_titre: d.subtitle || "",
    etape: (d.meta && d.meta.step) || null,        // étape principale du Dossier Invest
    statut: (d.meta && d.meta.status) || null,
    urgence: d.level || "",                        // danger | warning | info | success
    categorie: d.category || "",                   // decision | watch | delegated
    prochaine_action: d.next_action || "",
    echeance: d.due_date || null,
    responsable: d.responsable || "",
    alerte_principale: d.primaryAlert || "",
    alertes: (d.alerts || []).map((a) => ({
      code: a.code, libelle: a.label, niveau: a.level, echeance: a.due_date || null,
    })),
    lien: lienDossier(d),
    // Tranche 2b-bis : état du Dossier Invest (clients uniquement).
    ...(d.type === "client" ? { dossier_invest: exposerPilotage(d.meta && d.meta.dossier, _pilotage,
      { inconnu: (d.alerts || []).some((a) => a.code === "avancement_inconnu") }) } : {}),
  };
}

// Le Copilote ne fabrique pas d'URL : Profero Invest n'a pas de routeur. Il
// renvoie les paramètres du mécanisme de liens profonds déjà en place dans
// PageInvest.jsx, que le front traduit en appel à naviguer().
function lienDossier(d) {
  if (!d || !d.id) return null;
  if (d.type === "client") return { libelle: "Ouvrir le dossier", params: { client_id: d.id } };
  if (d.type === "bien") return { libelle: "Ouvrir le bien", params: { invest_bien: d.id } };
  return null;
}

module.exports = {
  chargerDossiers,
  pilotagesClients,
  exposerPilotage,
  pilotage,
  exposerDossier,
  lienDossier,
  REQUETES_EXCLUES,
};
