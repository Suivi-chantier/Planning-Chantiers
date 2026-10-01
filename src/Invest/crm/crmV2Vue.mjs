// src/Invest/crm/crmV2Vue.mjs — CRM V2 et fiche Client V2 (Chantier V2-01).
//
// Construit ce qu'affichent les trois vues du CRM (À traiter, Clients,
// Actions & planning) et la page Client (missions, à faire, synthèse
// patrimoniale, historique).
//
// AUCUNE règle nouvelle de pilotage : chaque mission est lue par
// pilotage.mjs (étapes actives, étape à agir, balle, échéance, blocage), la
// synthèse patrimoniale par situationPatrimoniale.mjs (2c). Ce module ne fait
// que regrouper, trier et libeller.
//
// Une mission = un Dossier Invest. Le modèle V2 admet plusieurs missions
// ouvertes par client : tout est calculé par mission, jamais « une par client ».
// Module PUR : données en paramètre, date du jour en paramètre.

import { ETAPES_PARCOURS, TYPES_MISSION, STATUTS_DOSSIER, STATUTS_DOSSIER_NON_CLOS } from "../dossiers/parcours.mjs";
import { pilotageDossier, actionDuJour } from "../dossiers/pilotage.mjs";
import { calculerSituation, SECTIONS as SECTIONS_2C } from "../dossiers/situationPatrimoniale.mjs";

export const VUES_CRM = Object.freeze([
  { cle: "a_traiter", libelle: "À traiter" },
  { cle: "clients", libelle: "Clients" },
  { cle: "planning", libelle: "Actions & planning" },
]);

export const ONGLETS_CLIENT = Object.freeze([
  { cle: "ensemble", libelle: "Vue d'ensemble" },
  { cle: "missions", libelle: "Missions" },
  { cle: "patrimoine", libelle: "Patrimoine" },
  { cle: "operations", libelle: "Opérations" },
  { cle: "documents", libelle: "Documents" },
  { cle: "historique", libelle: "Historique" },
]);

/**
 * Offres commerciales. Lecture du type de mission existant, sans nouvelle
 * donnée : accompagnement à l'acquisition = Offre 2, audit patrimonial = Offre 3.
 * Les autres types gardent leur libellé et n'ont pas encore de jalons.
 */
export const OFFRES = Object.freeze({
  accompagnement_acquisition: { code: "offre2", court: "Offre 2", libelle: "Accompagnement à l'investissement" },
  audit_patrimonial: { code: "offre3", court: "Offre 3", libelle: "Accompagnement patrimonial global" },
});

/** Jalons visibles par offre : simple lecture des 11 étapes internes. */
export const JALONS_OFFRE = Object.freeze({
  offre2: [
    { libelle: "Projet", etapes: ["signature", "collecte", "analyse", "strategie"] },
    { libelle: "Documents", etapes: ["documents"] },
    { libelle: "Recherche", etapes: ["recherche"] },
    { libelle: "Opportunités", etapes: ["opportunites"] },
    { libelle: "Financement", etapes: ["financement"] },
    { libelle: "Acquisition", etapes: ["structuration", "acquisition", "suivi"] },
  ],
  offre3: [
    { libelle: "Collecte", etapes: ["signature", "collecte", "documents"] },
    { libelle: "Analyse", etapes: ["analyse"] },
    { libelle: "Stratégie", etapes: ["strategie"] },
  ],
});

const TACHE_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);
const TYPES_CONTACT = new Set(["appel", "rendez-vous", "relance"]);
const LIBELLES_NOTE = Object.freeze({ appel: "Appel", "rendez-vous": "Rendez-vous", relance: "Relance", commentaire: "Note", document: "Document", autre: "Note" });
const jour = (v) => (v ? String(v).slice(0, 10) : null);
const ajouterJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const libelleEtape = (cle) => ETAPES_PARCOURS.find((e) => e.cle === cle)?.libelle ?? null;
const enCours = (d) => STATUTS_DOSSIER_NON_CLOS.includes(d?.statut);

export const nomClient = (c) => [c?.prenom, c?.nom].filter(Boolean).join(" ").trim() || "Client sans nom";

export function offreDe(typeMission) {
  const o = OFFRES[typeMission];
  if (o) return { ...o, type: typeMission };
  return { code: null, court: null, libelle: TYPES_MISSION[typeMission] ?? "Type de mission non précisé", type: typeMission ?? null };
}

/** Jalon visible de l'étape principale selon l'offre ; à défaut, le libellé de l'étape. */
export function jalonDe(typeMission, cleEtape) {
  if (!cleEtape) return null;
  const jalons = JALONS_OFFRE[OFFRES[typeMission]?.code] || [];
  return jalons.find((j) => j.etapes.includes(cleEtape))?.libelle ?? libelleEtape(cleEtape);
}

/**
 * Une mission en cours, lue par le moteur de pilotage.
 * Priorité (0 = plus urgent) : retard, blocage, aujourd'hui, à faire par
 * Profero, sans prochaine action, attente client, le reste.
 */
export function missionPilotee({ dossier, client = null, etapes = [], taches = [], utilisateurs = [], aujourdhui }) {
  const p = pilotageDossier({ dossier, etapes, taches, utilisateurs, aujourdhui });
  if (!p) return null;
  const ajd = actionDuJour(p);
  const e = ajd.etape;
  const tachesDuJour = taches.filter((t) => t.dossier_id === dossier.id && TACHE_OUVERTE.has(t.status) && jour(t.due_date) === aujourdhui).length;
  const retardEtape = p.actives.filter((a) => a.echeanceDepassee).map((a) => joursEntre(a.echeance, aujourdhui));
  const retardTache = p.tachesEnRetard.map((t) => joursEntre(t.dueDate, aujourdhui));
  const retardJours = Math.max(0, ...retardEtape, ...retardTache);
  const blocages = p.actives.filter((a) => a.blocage).map((a) => ({ etape: a.libelle, motif: a.blocage.motif }));
  const signaux = {
    enRetard: retardJours > 0,
    bloquee: blocages.length > 0,
    aujourdhui: p.actives.some((a) => a.echeanceAujourdhui) || tachesDuJour > 0,
    attenteClient: p.actives.some((a) => a.balle.type === "client" && !a.blocage),
    sansAction: !p.actives.some((a) => a.prochaineAction),
    aFaireProfero: p.actives.some((a) => a.balle.type === "profero" && a.prochaineAction),
  };
  const priorite = signaux.enRetard ? 0 : signaux.bloquee ? 1 : signaux.aujourdhui ? 2 : signaux.aFaireProfero ? 3 : signaux.sansAction ? 4 : signaux.attenteClient ? 5 : 6;
  return {
    dossierId: dossier.id, clientId: dossier.client_id, client: client ? nomClient(client) : "Client introuvable",
    reference: dossier.reference, libelle: dossier.libelle || null,
    offre: offreDe(dossier.type_mission), statut: dossier.statut, statutLibelle: STATUTS_DOSSIER[dossier.statut] ?? dossier.statut,
    ouverture: jour(dossier.date_ouverture),
    jalon: jalonDe(dossier.type_mission, p.principale?.etape) ?? "Aucune étape active",
    etapesActives: p.actives.map((a) => a.libelle),
    action: ajd.action, responsable: ajd.responsable, etape: e?.libelle ?? null,
    echeance: ajd.echeance, balle: e?.balle.libelle ?? null, balleType: e?.balle.type ?? null,
    retardJours, blocages, tachesEnRetard: p.tachesEnRetard.length,
    conseiller: p.conseiller, conseillerId: p.conseillerId,
    signaux, priorite, urgent: priorite <= 4,
  };
}

/** Toutes les missions en cours, de la plus urgente à la moins urgente. */
export function missionsAPiloter({ dossiers = [], clients = [], etapes = [], taches = [], utilisateurs = [], aujourdhui }) {
  const parId = new Map(clients.map((c) => [c.id, c]));
  return dossiers.filter(enCours)
    .map((d) => missionPilotee({ dossier: d, client: parId.get(d.client_id), etapes, taches, utilisateurs, aujourdhui }))
    .filter(Boolean)
    .sort((a, b) => a.priorite - b.priorite || b.retardJours - a.retardJours
      || String(a.echeance || "9999").localeCompare(String(b.echeance || "9999")) || a.client.localeCompare(b.client, "fr"));
}

/** Compteurs du haut de « À traiter » (une mission peut compter dans plusieurs). */
export function compteursATraiter(missions = []) {
  return {
    enRetard: missions.filter((m) => m.signaux.enRetard).length,
    bloquees: missions.filter((m) => m.signaux.bloquee).length,
    aujourdhui: missions.filter((m) => m.signaux.aujourdhui).length,
    attenteClient: missions.filter((m) => m.signaux.attenteClient).length,
  };
}

export const FILTRES_A_TRAITER = Object.freeze({
  enRetard: "En retard", bloquees: "Bloquées", aujourdhui: "À faire aujourd'hui", attenteClient: "En attente client",
});
const SIGNAL_FILTRE = { enRetard: "enRetard", bloquees: "bloquee", aujourdhui: "aujourdhui", attenteClient: "attenteClient" };
export function filtrerMissions(missions = [], filtre = null) {
  return filtre ? missions.filter((m) => m.signaux[SIGNAL_FILTRE[filtre]]) : missions;
}

/** Dernier contact noté (appel, rendez-vous, relance) par client. */
export function derniersContacts(notes = []) {
  const map = new Map();
  for (const n of notes) {
    if (!TYPES_CONTACT.has(n.type)) continue;
    const d = jour(n.date || n.created_at);
    if (d && (!map.get(n.client_id) || d > map.get(n.client_id))) map.set(n.client_id, d);
  }
  return map;
}

/**
 * Portefeuille : une ligne par client.
 * `missions` = missionsAPiloter(...) ; `null` = pilotage illisible (jamais présenté comme « aucune mission »).
 */
export function portefeuille({ clients = [], dossiers = [], missions = [], notes = [] }) {
  const contacts = derniersContacts(notes);
  const inconnu = missions === null;
  return clients.map((c) => {
    const siennes = inconnu ? [] : missions.filter((m) => m.clientId === c.id);
    const terminees = dossiers.filter((d) => d.client_id === c.id && !enCours(d)).length;
    const premiere = siennes[0] || null;
    return {
      id: c.id, nom: nomClient(c), statutRelation: c.statut || "Non renseigné",
      conseiller: premiere?.conseiller || c.conseiller || null,
      telephone: c.telephone || null, email: c.email || null,
      missions: siennes.map((m) => ({ dossierId: m.dossierId, reference: m.reference, offre: m.offre.court || m.offre.libelle, jalon: m.jalon })),
      missionsTerminees: terminees,
      prochaineAction: inconnu ? "Avancement indisponible" : premiere ? premiere.action : null,
      echeance: premiere?.echeance ?? null,
      urgent: siennes.some((m) => m.priorite <= 1),
      dernierContact: contacts.get(c.id) ?? null,
      recherche: [c.nom, c.prenom, c.email, c.telephone, c.conseiller].filter(Boolean).join(" "),
    };
  }).sort((a, b) => (b.missions.length > 0) - (a.missions.length > 0) || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Actions & planning (invest_mission_actions, aucune autre source).
 * Filtres : { conseiller, dossierId ("sans" = hors mission), clientId }.
 */
export function planningActions({ taches = [], dossiers = [], clients = [], utilisateurs = [], aujourdhui, filtres = {} }) {
  const dossierParId = new Map(dossiers.map((d) => [d.id, d]));
  const clientParId = new Map(clients.map((c) => [c.id, c]));
  const nomUtilisateur = (id) => utilisateurs.find((u) => u.id === id)?.nom ?? null;
  const j7 = ajouterJours(aujourdhui, 7), j30 = ajouterJours(aujourdhui, 30);
  const items = taches.filter((t) => TACHE_OUVERTE.has(t.status)).map((t) => {
    const d = t.dossier_id ? dossierParId.get(t.dossier_id) : null;
    const c = clientParId.get(t.client_id);
    return {
      id: t.id, titre: t.action_title || "Action", echeance: jour(t.due_date),
      clientId: t.client_id, client: c ? nomClient(c) : "Client introuvable",
      dossierId: d?.id ?? null, mission: d ? d.reference : "Hors mission",
      etape: libelleEtape(t.etape) ?? "À classer", responsable: t.responsable || null,
      conseiller: (d && nomUtilisateur(d.conseiller_id)) || c?.conseiller || null,
    };
  }).filter((x) => (!filtres.conseiller || x.conseiller === filtres.conseiller)
    && (!filtres.clientId || x.clientId === filtres.clientId)
    && (!filtres.dossierId || (filtres.dossierId === "sans" ? !x.dossierId : x.dossierId === filtres.dossierId)));
  const parDate = (a, b) => String(a.echeance).localeCompare(String(b.echeance)) || a.client.localeCompare(b.client, "fr");
  const datees = items.filter((x) => x.echeance).sort(parDate);
  return {
    enRetard: datees.filter((x) => x.echeance < aujourdhui),
    aujourdhui: datees.filter((x) => x.echeance === aujourdhui),
    semaine: datees.filter((x) => x.echeance > aujourdhui && x.echeance <= j7),
    mois: datees.filter((x) => x.echeance > j7 && x.echeance <= j30),
    auDela: datees.filter((x) => x.echeance > j30).length,
    sansEcheance: items.filter((x) => !x.echeance).length,
    options: {
      conseillers: [...new Set(items.map((x) => x.conseiller).filter(Boolean))].sort(),
    },
  };
}

/** Historique relationnel : notes/appels du client + événements de ses missions, du plus récent au plus ancien. */
export function historiqueClient({ notes = [], evenements = [], dossiers = [] }) {
  const refs = new Map(dossiers.map((d) => [d.id, d.reference]));
  const n = notes.map((x) => ({ id: `n-${x.id}`, genre: "note", quand: x.date || x.created_at || null, type: LIBELLES_NOTE[x.type] ?? "Note",
    texte: x.contenu || "", auteur: x.auteur || null, mission: null, ordre: 0 }));
  const e = evenements.map((x) => ({ id: `e-${x.id}`, genre: "mission", quand: x.survenu_le || null, type: "Mission",
    texte: x.resume || "", auteur: x.auteur_libelle || null, mission: refs.get(x.dossier_id) ?? null, ordre: Number(x.ordre) || 0 }));
  return [...n, ...e].sort((a, b) => String(b.quand || "").localeCompare(String(a.quand || "")) || b.ordre - a.ordre);
}

/**
 * Nouvelle mission : la base n'accepte aujourd'hui qu'une mission en cours par
 * client. La règle n'est pas contournée : on l'explique.
 */
export function nouvelleMissionPossible(dossiers = []) {
  const ouverte = dossiers.find(enCours);
  if (!ouverte) return { possible: true, raison: null };
  return { possible: false, raison: `Une seule mission peut être en cours par client pour le moment : ${ouverte.reference} est en cours. `
    + "Plusieurs missions simultanées seront possibles après une évolution de la base prévue séparément." };
}

/** Modèle de la page Client. */
export function construireClient({ client, dossiers = [], etapes = [], taches = [], utilisateurs = [], collecte = {}, notes = [], evenements = [], aujourdhui }) {
  const siens = dossiers.filter((d) => d.client_id === client.id);
  const missions = missionsAPiloter({ dossiers: siens, clients: [client], etapes, taches, utilisateurs, aujourdhui });
  const terminees = siens.filter((d) => !enCours(d)).sort((a, b) => String(b.date_cloture || b.created_at || "").localeCompare(String(a.date_cloture || a.created_at || "")))
    .map((d) => ({ dossierId: d.id, reference: d.reference, libelle: d.libelle || null, offre: offreDe(d.type_mission), statutLibelle: STATUTS_DOSSIER[d.statut] ?? d.statut,
      conseiller: utilisateurs.find((u) => u.id === d.conseiller_id)?.nom ?? null,
      ouverture: jour(d.date_ouverture), cloture: jour(d.date_cloture), motif: d.motif_cloture || null }));
  const refs = new Map(siens.map((d) => [d.id, d.reference]));

  // À faire : l'action de chaque mission, puis les actions datées les plus pressantes.
  const actionsMissions = missions.map((m) => ({ id: `m-${m.dossierId}`, titre: m.action, mission: m.reference, dossierId: m.dossierId, etape: m.etape,
    responsable: m.responsable, echeance: m.echeance, enRetard: !!m.echeance && m.echeance < aujourdhui }));
  const autres = taches.filter((t) => t.client_id === client.id && TACHE_OUVERTE.has(t.status) && jour(t.due_date) && jour(t.due_date) <= ajouterJours(aujourdhui, 7))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .map((t) => ({ id: t.id, titre: t.action_title || "Action", mission: refs.get(t.dossier_id) ?? "Hors mission", dossierId: t.dossier_id || null,
      etape: libelleEtape(t.etape) ?? "À classer", responsable: t.responsable || null, echeance: jour(t.due_date), enRetard: jour(t.due_date) < aujourdhui }));
  const aFaire = [...actionsMissions, ...autres.filter((a) => !actionsMissions.some((m) => m.titre === a.titre && m.dossierId === a.dossierId))];

  const actifs = (rows = []) => rows.filter((r) => r && !r.archive_le);
  const lignes = Object.fromEntries(SECTIONS_2C.map((s) => [s.cle, actifs(collecte[s.table]).length]));
  const toutes = SECTIONS_2C.flatMap((s) => actifs(collecte[s.table]));
  const situation = calculerSituation({ postes: collecte.invest_postes_financiers, engagements: collecte.invest_engagements, actifsImmo: collecte.invest_actifs_patrimoniaux });

  const historique = historiqueClient({ notes, evenements, dossiers: siens });
  return {
    entete: { nom: nomClient(client), statutRelation: client.statut || "Non renseigné", conseiller: missions[0]?.conseiller || client.conseiller || null,
      telephone: client.telephone || null, email: client.email || null },
    missionsEnCours: missions,
    missionsTerminees: terminees,
    nouvelleMission: nouvelleMissionPossible(siens),
    aFaire: aFaire.slice(0, 5),
    aFaireTotal: aFaire.length,
    patrimoine: {
      vide: toutes.length === 0,
      lignes,
      verifiees: toutes.filter((r) => r.verification_statut === "verifiee").length,
      aCorriger: toutes.filter((r) => r.verification_statut === "a_corriger").length,
      total: toutes.length,
      revenusMensuels: situation.revenusMensuels,
      epargneDisponible: situation.epargneDisponible,
      patrimoineNetSimplifie: situation.patrimoineNetSimplifie,
      incomplet: Object.values(situation.incomplets || {}).some(Boolean),
    },
    activite: historique.slice(0, 5),
    historique,
  };
}
