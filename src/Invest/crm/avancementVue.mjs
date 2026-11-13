// src/Invest/crm/avancementVue.mjs — Synthèse clients et Avancement des dossiers
// du CRM (refonte « tableau de pilotage », 13/11/2026).
//
// Module PUR : données en paramètre, date du jour en paramètre, aucun accès
// Supabase, aucune horloge. Façade front : ./avancementVue.js.
//
// AUCUNE règle de pilotage nouvelle : les signaux (retard, blocage, sans action)
// viennent de missionPilotee (crmV2Vue.mjs → pilotage.mjs), l'inactivité de
// pilotageDossier (seuil JOURS_SANS_EVOLUTION par défaut). Ce module regroupe,
// range et libelle. Une information absente reste « non renseignée » : elle ne
// devient jamais un résultat (invariant du projet).
//
// Un client peut avoir plusieurs dossiers ; chaque ligne de l'Avancement est UN
// dossier, chaque ligne de la Synthèse est UN client.

import { ETAPES_PARCOURS, STATUTS_ETAPE, STATUTS_DOSSIER, STATUTS_DOSSIER_NON_CLOS, etapeCourante } from "../dossiers/parcours.mjs";
import { pilotageDossier, JOURS_SANS_EVOLUTION } from "../dossiers/pilotage.mjs";
import { missionPilotee, derniersContacts, nomClient } from "./crmV2Vue.mjs";

export const SEUIL_INACTIVITE_DEFAUT = JOURS_SANS_EVOLUTION;
/** Numéro de la première étape de « réalisation » (Financement) : avant, le projet est en préparation ou en recherche. */
const NUMERO_PREMIERE_ETAPE_REALISATION = 8;

const jour = (v) => (v ? String(v).slice(0, 10) : null);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const enCours = (d) => STATUTS_DOSSIER_NON_CLOS.includes(d?.statut);
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Dernière ligne non vide d'un commentaire (les gestes ajoutent des lignes datées, sans jamais écraser). */
export function derniereLigne(texte) {
  const lignes = String(texte ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lignes.length ? lignes[lignes.length - 1] : null;
}

// ── États d'une cellule d'étape ─────────────────────────────────────────────
export const ETATS_CELLULE = Object.freeze({
  terminee:       { cle: "terminee",       libelle: "Terminée",        ton: "vert" },
  en_cours:       { cle: "en_cours",       libelle: "En cours",        ton: "bleu" },
  en_attente:     { cle: "en_attente",     libelle: "En attente",      ton: "violet" },
  bloquee:        { cle: "bloquee",        libelle: "Bloquée",         ton: "rouge" },
  a_venir:        { cle: "a_venir",        libelle: "Non commencée",   ton: "gris" },
  non_applicable: { cle: "non_applicable", libelle: "Non applicable",  ton: "gris" },
  // La ligne d'étape n'existe pas (dossier historique incomplet) : ce n'est ni « non commencée » ni « terminée ».
  absente:        { cle: "absente",        libelle: "Non renseignée",  ton: "gris" },
});

export const STATUTS_PROJET = Object.freeze({
  preparation: "En préparation",
  recherche: "En recherche",
  realisation: "En cours de réalisation",
  suspendu: "Suspendu",
  termine: "Terminé",
  abandonne: "Abandonné",
});

/**
 * Statut du PROJET (vocabulaire du CRM) lu depuis le statut du dossier et son étape courante.
 * ouvert → En préparation · actif → En recherche avant « Financement », En cours de réalisation à partir de
 * « Financement » · suspendu → Suspendu · clos → Terminé · abandonné → Abandonné.
 */
export function statutProjet(dossier, etapes = []) {
  const s = dossier?.statut;
  if (s === "clos") return { cle: "termine", libelle: STATUTS_PROJET.termine };
  if (s === "abandonne") return { cle: "abandonne", libelle: STATUTS_PROJET.abandonne };
  if (s === "suspendu") return { cle: "suspendu", libelle: STATUTS_PROJET.suspendu };
  if (s === "ouvert") return { cle: "preparation", libelle: STATUTS_PROJET.preparation };
  const c = etapeCourante(etapes.filter((e) => e.dossier_id === dossier?.id));
  const n = c ? ETAPES_PARCOURS.find((e) => e.cle === c.etape)?.numero ?? null : null;
  return n !== null && n >= NUMERO_PREMIERE_ETAPE_REALISATION
    ? { cle: "realisation", libelle: STATUTS_PROJET.realisation }
    : { cle: "recherche", libelle: STATUTS_PROJET.recherche };
}

/** Besoin du client : budget, objectif, secteur. Tout est facultatif (dossiers historiques incomplets). */
export function besoinClient(client = {}) {
  const s = client.strategie_data && typeof client.strategie_data === "object" ? client.strategie_data : {};
  return {
    budget: num(s.budget_max) ?? num(client.budget),
    objectif: String(s.objectif || "").trim() || null,
    secteur: String(s.zones || "").trim() || null,
    apport: num(s.apport),
  };
}

function cellule(etapeRef, ligne, courante, utilisateurs) {
  if (!ligne) {
    return { etape: etapeRef.cle, numero: etapeRef.numero, libelle: etapeRef.libelle, id: null, etat: ETATS_CELLULE.absente, statut: null,
      dateDebut: null, dateFin: null, commentaire: null, dernierCommentaire: null, balle: null, echeance: null, blocage: null,
      modifieLe: null, modifiePar: null, actuelle: false, aConfirmer: false };
  }
  return {
    etape: etapeRef.cle, numero: etapeRef.numero, libelle: etapeRef.libelle, id: ligne.id,
    etat: ETATS_CELLULE[ligne.statut] ?? ETATS_CELLULE.absente, statut: ligne.statut,
    dateDebut: jour(ligne.date_debut), dateFin: jour(ligne.date_fin),
    commentaire: ligne.commentaire || null, dernierCommentaire: derniereLigne(ligne.commentaire),
    balle: ligne.balle ?? null, echeance: jour(ligne.echeance),
    blocage: ligne.statut === "bloquee" ? (ligne.blocage_motif || "motif non renseigné") : null,
    modifieLe: ligne.updated_at || null,
    modifiePar: utilisateurs.find((u) => u.id === ligne.modifie_par_id)?.nom ?? null,
    actuelle: courante?.etape === etapeRef.cle,
    aConfirmer: ligne.reprise_a_confirmer === true,
  };
}

/**
 * Avancement : une ligne par dossier, les 11 étapes dans l'ordre du parcours.
 * `dossiers` : tous les dossiers (en cours ET clos) ; `seuilInactivite` : jours sans évolution.
 */
export function lignesAvancement({ dossiers = [], clients = [], etapes = [], taches = [], utilisateurs = [], aujourdhui, seuilInactivite = SEUIL_INACTIVITE_DEFAUT }) {
  const clientParId = new Map(clients.map((c) => [c.id, c]));
  return dossiers.map((d) => {
    const client = clientParId.get(d.client_id) ?? null;
    const siennes = etapes.filter((e) => e.dossier_id === d.id && !e.operation_id);
    const courante = etapeCourante(siennes);
    const cellules = ETAPES_PARCOURS.map((ref) => cellule(ref, siennes.find((e) => e.etape === ref.cle), courante, utilisateurs));
    const applicables = cellules.filter((c) => c.statut && c.statut !== "non_applicable");
    const terminees = applicables.filter((c) => c.statut === "terminee").length;
    const vivant = enCours(d);
    const mission = vivant ? missionPilotee({ dossier: d, client, etapes, taches, utilisateurs, aujourdhui }) : null;
    const pilotage = vivant ? pilotageDossier({ dossier: d, etapes, taches, utilisateurs, aujourdhui }) : null;
    const commentaires = cellules.filter((c) => c.dernierCommentaire && c.modifieLe).sort((a, b) => String(b.modifieLe).localeCompare(String(a.modifieLe)));
    const joursSansEvolution = pilotage?.joursSansEvolution ?? null;
    const projet = statutProjet(d, etapes);
    return {
      dossierId: d.id, clientId: d.client_id, client: client ? nomClient(client) : "Client introuvable",
      reference: d.reference, libelle: d.libelle || null, enCours: vivant,
      statutProjet: projet, statutDossier: STATUTS_DOSSIER[d.statut] ?? d.statut,
      besoin: besoinClient(client ?? {}),
      conseiller: pilotage?.conseiller ?? utilisateurs.find((u) => u.id === d.conseiller_id)?.nom ?? client?.conseiller ?? null,
      cellules, terminees, applicables: applicables.length,
      progressionPct: applicables.length ? Math.round((terminees / applicables.length) * 100) : null,
      etapeActuelle: courante ? { cle: courante.etape, numero: ETAPES_PARCOURS.find((e) => e.cle === courante.etape)?.numero, libelle: courante.libelle, statut: courante.statut } : null,
      blocages: cellules.filter((c) => c.etat.cle === "bloquee").map((c) => ({ etape: c.libelle, motif: c.blocage })),
      action: mission?.action ?? null, echeance: mission?.echeance ?? null, responsable: mission?.responsable ?? null,
      dernierCommentaire: commentaires[0] ? { texte: commentaires[0].dernierCommentaire, etape: commentaires[0].libelle, quand: jour(commentaires[0].modifieLe) } : null,
      joursSansEvolution,
      signaux: {
        enRetard: !!mission?.signaux.enRetard,
        bloquee: !!mission?.signaux.bloquee,
        sansAction: !!mission?.signaux.sansAction,
        inactif: joursSansEvolution !== null && joursSansEvolution >= seuilInactivite && !mission?.signaux.enRetard,
      },
      recherche: [client?.nom, client?.prenom, d.reference, d.libelle].filter(Boolean).join(" "),
    };
  }).sort((a, b) => (b.enCours - a.enCours) || a.client.localeCompare(b.client, "fr") || String(a.reference).localeCompare(String(b.reference)));
}

export const FILTRES_ALERTE = Object.freeze({ retard: "En retard", bloque: "Bloqués", sans_action: "Sans prochaine action", inactif: "Sans activité récente" });
const SIGNAL_ALERTE = { retard: "enRetard", bloque: "bloquee", sans_action: "sansAction", inactif: "inactif" };

/** Filtres combinables de l'Avancement. `etape` = clé de l'étape actuelle ; budgetMin/budgetMax en euros. */
export function filtrerAvancement(lignes = [], { q = "", conseiller = "", statutProjet: sp = "", etape = "", budgetMin = null, budgetMax = null, alerte = "", enCoursSeulement = false } = {}) {
  const t = norm(q).trim();
  return lignes.filter((l) => (!t || norm(l.recherche).includes(t))
    && (!conseiller || l.conseiller === conseiller)
    && (!sp || l.statutProjet.cle === sp)
    && (!etape || l.etapeActuelle?.cle === etape)
    && (budgetMin == null || (l.besoin.budget !== null && l.besoin.budget >= budgetMin))
    && (budgetMax == null || (l.besoin.budget !== null && l.besoin.budget <= budgetMax))
    && (!alerte || l.signaux[SIGNAL_ALERTE[alerte]])
    && (!enCoursSeulement || l.enCours));
}

// ── Synthèse : une ligne par client ─────────────────────────────────────────
const STATUTS_CLIENT_ATTENTE = new Set(["en attente", "en pause"]);

/** Dernier commentaire / échange d'un client : le plus récent entre ses notes et les commentaires d'étapes de ses dossiers. */
function dernierCommentaireClient(clientId, notes, lignes) {
  const candidats = [];
  for (const n of notes) {
    if (n.client_id !== clientId || !String(n.contenu || "").trim()) continue;
    candidats.push({ texte: String(n.contenu).trim().split("\n")[0], quand: jour(n.date || n.created_at), source: n.type || "note", auteur: n.auteur || null });
  }
  for (const l of lignes) {
    if (l.dernierCommentaire) candidats.push({ texte: l.dernierCommentaire.texte, quand: l.dernierCommentaire.quand, source: `Étape ${l.dernierCommentaire.etape}`, auteur: null });
  }
  return candidats.sort((a, b) => String(b.quand || "").localeCompare(String(a.quand || "")))[0] ?? null;
}

/**
 * Synthèse clients. `lignes` = lignesAvancement(...) du même jeu de données (une seule lecture, un seul calcul).
 * `missions` n'est pas relu : la prochaine action vient des lignes d'Avancement (même source).
 */
export function syntheseClients({ clients = [], lignes = [], notes = [], aujourdhui, seuilInactivite = SEUIL_INACTIVITE_DEFAUT, pilotageLisible = true }) {
  const contacts = derniersContacts(notes);
  return clients.map((c) => {
    const siens = lignes.filter((l) => l.clientId === c.id);
    const ouverts = siens.filter((l) => l.enCours);
    const termines = siens.filter((l) => l.statutProjet.cle === "termine");
    const besoin = besoinClient(c);
    // Projet le plus urgent d'abord : retard, blocage, sans action, puis le plus avancé.
    const rang = (l) => (l.signaux.enRetard ? 0 : l.signaux.bloquee ? 1 : l.signaux.sansAction ? 2 : 3);
    const principal = [...ouverts].sort((a, b) => rang(a) - rang(b) || (b.etapeActuelle?.numero ?? 0) - (a.etapeActuelle?.numero ?? 0))[0] ?? null;
    const dernierEchange = contacts.get(c.id) ?? null;
    const evolutions = ouverts.map((l) => l.joursSansEvolution).filter((n) => n !== null);
    const joursDepuisEchange = dernierEchange ? joursEntre(dernierEchange, aujourdhui) : null;
    const activite = [joursDepuisEchange, ...evolutions].filter((n) => n !== null);
    const joursSansActivite = activite.length ? Math.min(...activite) : null;
    const statutClient = c.statut || "Non renseigné";
    const recherche = ouverts.some((l) => l.statutProjet.cle === "recherche") ? "En recherche"
      : ouverts.some((l) => l.statutProjet.cle === "realisation") ? "Projet en réalisation"
      : ouverts.some((l) => l.statutProjet.cle === "preparation") ? "En préparation"
      : ouverts.some((l) => l.statutProjet.cle === "suspendu") ? "Suspendu"
      : termines.length ? "Aucun projet en cours" : "Aucun projet";
    const actif = norm(statutClient) === "actif";
    return {
      id: c.id, nom: nomClient(c), statutClient, email: c.email || null, telephone: c.telephone || null,
      conseiller: principal?.conseiller || c.conseiller || null,
      ...besoin,
      statutRecherche: recherche,
      projets: siens.map((l) => ({ dossierId: l.dossierId, reference: l.reference, libelle: l.libelle, statutProjet: l.statutProjet, enCours: l.enCours,
        etape: l.etapeActuelle, terminees: l.terminees, applicables: l.applicables, budget: l.besoin.budget })),
      nbProjetsEnCours: ouverts.length, nbProjetsTermines: termines.length,
      etapeActuelle: principal?.etapeActuelle ?? null,
      dernierEchange, joursSansActivite,
      dernierCommentaire: dernierCommentaireClient(c.id, notes, siens),
      // Prochaine action : celle du projet le plus urgent. Pilotage illisible ≠ « aucune action ».
      prochaineAction: !pilotageLisible ? null : principal?.action ?? null,
      echeance: !pilotageLisible ? null : principal?.echeance ?? null,
      actionIndisponible: !pilotageLisible,
      signaux: {
        enRetard: ouverts.some((l) => l.signaux.enRetard),
        bloquee: ouverts.some((l) => l.signaux.bloquee),
        sansAction: pilotageLisible && (ouverts.some((l) => l.signaux.sansAction) || (actif && ouverts.length === 0 && termines.length === 0)),
        inactif: ouverts.length > 0 && joursSansActivite !== null && joursSansActivite >= seuilInactivite,
        // Client dont tous les projets sont terminés : prêt à lancer un nouvel investissement.
        pretNouvelInvestissement: ouverts.length === 0 && termines.length > 0 && !STATUTS_CLIENT_ATTENTE.has(norm(statutClient)) && norm(statutClient) !== "inactif",
        attente: STATUTS_CLIENT_ATTENTE.has(norm(statutClient)) || ouverts.some((l) => l.statutProjet.cle === "suspendu"),
      },
      recherchePlein: [c.nom, c.prenom, c.email, c.telephone, c.conseiller, besoin.secteur].filter(Boolean).join(" "),
    };
  }).sort((a, b) => (b.nbProjetsEnCours > 0) - (a.nbProjetsEnCours > 0) || a.nom.localeCompare(b.nom, "fr"));
}

export const KPI_SYNTHESE = Object.freeze([
  { cle: "tous", libelle: "Clients" },
  { cle: "actifs", libelle: "Actifs" },
  { cle: "recherche", libelle: "En recherche" },
  { cle: "attente", libelle: "En attente / pause" },
  { cle: "termines", libelle: "Dossiers terminés" },
  { cle: "retard", libelle: "Actions en retard" },
]);

const KPI_TEST = {
  tous: () => true,
  actifs: (l) => norm(l.statutClient) === "actif",
  recherche: (l) => l.projets.some((p) => p.enCours && p.statutProjet.cle === "recherche"),
  attente: (l) => l.signaux.attente,
  termines: (l) => l.nbProjetsTermines > 0,
  retard: (l) => l.signaux.enRetard,
};

/** Compteurs du bandeau : calculés sur le jeu de lignes donné (les mêmes lignes que le tableau, avant le filtre kpi). */
export function compteursSynthese(lignes = []) {
  return Object.fromEntries(KPI_SYNTHESE.map((k) => [k.cle, lignes.filter(KPI_TEST[k.cle]).length]));
}

export const ALERTES_SYNTHESE = Object.freeze({ ...FILTRES_ALERTE, pret: "Prêts pour un nouvel investissement" });
const ALERTE_SYNTHESE_TEST = {
  retard: (l) => l.signaux.enRetard, bloque: (l) => l.signaux.bloquee, sans_action: (l) => l.signaux.sansAction,
  inactif: (l) => l.signaux.inactif, pret: (l) => l.signaux.pretNouvelInvestissement,
};

/** Filtres combinables de la Synthèse (le filtre `kpi` est celui du bandeau cliquable). */
export function filtrerSynthese(lignes = [], { q = "", conseiller = "", statutClient = "", etape = "", budgetMin = null, budgetMax = null, recherche = "", alerte = "", kpi = "tous" } = {}) {
  const t = norm(q).trim();
  return lignes.filter((l) => (!t || norm(l.recherchePlein).includes(t))
    && (!conseiller || l.conseiller === conseiller)
    && (!statutClient || l.statutClient === statutClient)
    && (!etape || l.etapeActuelle?.cle === etape)
    && (budgetMin == null || (l.budget !== null && l.budget >= budgetMin))
    && (budgetMax == null || (l.budget !== null && l.budget <= budgetMax))
    && (recherche !== "active" || l.projets.some((p) => p.enCours && p.statutProjet.cle === "recherche"))
    && (recherche !== "non_active" || !l.projets.some((p) => p.enCours && p.statutProjet.cle === "recherche"))
    && (!alerte || ALERTE_SYNTHESE_TEST[alerte]?.(l))
    && (KPI_TEST[kpi] ?? KPI_TEST.tous)(l));
}

/** Une ligne demande-t-elle de l'attention ? (retard, blocage, sans action, inactivité) — pour le repère visuel. */
export function attentionRequise(signaux = {}) {
  const motifs = [];
  if (signaux.enRetard) motifs.push({ code: "retard", libelle: "Action en retard", ton: "rouge" });
  if (signaux.bloquee) motifs.push({ code: "bloquee", libelle: "Étape bloquée", ton: "rouge" });
  if (signaux.sansAction) motifs.push({ code: "sans_action", libelle: "Aucune prochaine action", ton: "orange" });
  if (signaux.inactif) motifs.push({ code: "inactif", libelle: "Sans activité récente", ton: "orange" });
  return motifs;
}

export { STATUTS_ETAPE };
