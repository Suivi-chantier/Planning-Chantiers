// src/Invest/dossiers/dossierVue.mjs — Ce qu'affiche la carte « Dossier Invest »
// de la fiche client (Chantier 1.1, Tranche 2a).
//
// Module PUR : reçoit les lignes déjà lues (dossiers, étapes, événements,
// anomalies de invest_controle_dossiers, tâches, utilisateurs) et rend un
// modèle d'affichage. Aucune écriture, aucune horloge implicite.
// Façade front : ./dossierVue.js.

import { ETAPES_PARCOURS, CLES_ETAPES, STATUTS_ETAPE, BALLES, STATUTS_DOSSIER, STATUTS_DOSSIER_NON_CLOS,
  STATUTS_LETTRE_MISSION, etapeCourante, suggestionsDepuisActions } from "./parcours.mjs";

export const A_CLASSER = "__a_classer";
const STATUTS_TACHE_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);

/** Dossier à afficher : le dossier non clos, sinon le plus récent des dossiers clos. */
export function choisirDossier(dossiers = [], idChoisi = null) {
  if (idChoisi) {
    const d = dossiers.find((x) => x.id === idChoisi);
    if (d) return d;
  }
  const ouvert = dossiers.find((d) => STATUTS_DOSSIER_NON_CLOS.includes(d.statut));
  if (ouvert) return ouvert;
  return [...dossiers].sort((a, b) =>
    String(b.date_cloture ?? b.created_at ?? "").localeCompare(String(a.date_cloture ?? a.created_at ?? "")))[0] ?? null;
}

/** Autres dossiers du client, pour le sélecteur (le choisi en premier). */
export function listeDossiers(dossiers = [], choisi = null) {
  return [...dossiers]
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .map((d) => ({
      id: d.id,
      libelle: `${d.reference} · ${d.libelle}`,
      statut: STATUTS_DOSSIER[d.statut] ?? d.statut,
      clos: !STATUTS_DOSSIER_NON_CLOS.includes(d.statut),
      choisi: choisi?.id === d.id,
    }));
}

const nomUtilisateur = (utilisateurs, id) => (id ? utilisateurs.find((u) => u.id === id)?.nom ?? "collaborateur inconnu" : null);

/** Libellé de la balle : « Profero (Matthieu Fumoleau) », « Notaire (Étude X) », « Client ». */
export function libelleBalle(etape, utilisateurs = []) {
  if (!etape?.balle) return null;
  const qui = etape.balle === "profero" ? nomUtilisateur(utilisateurs, etape.balle_utilisateur_id) : etape.balle_tiers_libelle;
  return `${BALLES[etape.balle] ?? etape.balle}${qui ? ` (${qui})` : ""}`;
}

/** Échéance lisible, jamais vide sans le dire. */
export function libelleEcheance(echeance, aujourdhui) {
  if (!echeance) return { texte: "aucune", depassee: false };
  const e = String(echeance).slice(0, 10);
  return { texte: e.split("-").reverse().join("/"), depassee: !!aujourdhui && e < aujourdhui };
}

/** Ruban des 11 étapes (portée dossier), dans l'ordre du parcours. */
export function ruban(etapes = [], utilisateurs = []) {
  return ETAPES_PARCOURS.map((ref) => {
    const e = etapes.find((x) => x.etape === ref.cle && !x.operation_id);
    return {
      cle: ref.cle, numero: ref.numero, libelle: ref.libelle,
      present: !!e, id: e?.id ?? null,
      statut: e?.statut ?? null, statutLibelle: e ? STATUTS_ETAPE[e.statut] : "Étape absente",
      active: !!e && ["en_cours", "en_attente", "bloquee"].includes(e.statut),
      aConfirmer: e?.reprise_a_confirmer === true,
      balle: e ? libelleBalle(e, utilisateurs) : null,
    };
  });
}

/** Ligne « Maintenant » : étape courante, sa balle, prochaine action, échéance, blocage. */
export function maintenant(etapes = [], utilisateurs = [], aujourdhui = "") {
  const c = etapeCourante(etapes);
  const actives = etapes.filter((e) => !e.operation_id && ["en_cours", "en_attente", "bloquee"].includes(e.statut));
  if (!c) return { aucune: true, actives: [] };
  const e = etapes.find((x) => x.etape === c.etape && !x.operation_id);
  return {
    aucune: false,
    etape: c.etape, libelle: c.libelle, statut: c.statut, statutLibelle: STATUTS_ETAPE[c.statut],
    balle: libelleBalle(e, utilisateurs),
    prochaineAction: c.prochaine_action || null,
    echeance: libelleEcheance(c.echeance, aujourdhui),
    blocage: c.statut === "bloquee" ? { motif: e?.blocage_motif ?? null, depuis: e?.bloquee_depuis ?? null } : null,
    actives: actives.map((a) => ({ etape: a.etape, libelle: ETAPES_PARCOURS.find((r) => r.cle === a.etape)?.libelle ?? a.etape,
      statut: a.statut, balle: libelleBalle(a, utilisateurs) })),
  };
}

const LIBELLES_ANOMALIES = {
  client_actif_sans_dossier: "Client « Actif » sans dossier en cours : mettre à jour son statut ou démarrer une mission",
  prospect_converti_sans_dossier: "Prospect converti sans Dossier Invest",
  action_sans_dossier: "Tâche non rattachée à un dossier",
  action_etape_a_classer: "Tâche à classer dans une étape",
  dossier_parcours_incomplet: "Parcours incomplet",
  dossier_sans_conseiller: "Dossier sans conseiller",
  lettre_mission_statut_inconnu: "Lettre de mission : statut inconnu",
  lettre_mission_signee_sans_date: "Lettre de mission signée sans date",
  etapes_reprise_a_confirmer: "Étapes reprises à confirmer",
};

/** Anomalies du client et du dossier affiché, regroupées, en texte métier. */
export function anomalies(lignes = [], dossierId = null) {
  const pertinentes = lignes.filter((l) => !l.dossier_id || !dossierId || l.dossier_id === dossierId);
  const groupes = new Map();
  for (const l of pertinentes) {
    const g = groupes.get(l.anomalie) ?? { type: l.anomalie, libelle: LIBELLES_ANOMALIES[l.anomalie] ?? l.anomalie, nombre: 0, details: [] };
    g.nombre += 1;
    if (l.detail) g.details.push(l.detail);
    groupes.set(l.anomalie, g);
  }
  return [...groupes.values()];
}

/** Tâches du client regroupées par étape canonique (+ « à classer »). */
export function tachesParEtape(taches = [], dossierId = null) {
  const cles = [...CLES_ETAPES, A_CLASSER];
  const out = Object.fromEntries(cles.map((k) => [k, { ouvertes: [], faites: [], autres: [] }]));
  for (const t of taches) {
    if (dossierId && t.dossier_id && t.dossier_id !== dossierId) continue;
    const k = t.etape && CLES_ETAPES.includes(t.etape) ? t.etape : A_CLASSER;
    if (STATUTS_TACHE_OUVERTE.has(t.status)) out[k].ouvertes.push(t);
    else if (t.status === "fait") out[k].faites.push(t);
    else out[k].autres.push(t);
  }
  for (const k of cles) out[k].ouvertes.sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  return out;
}

/** Suggestions (jamais appliquées) pour le dossier affiché. */
export function suggestions(etapes = [], taches = [], dossierId = null) {
  return suggestionsDepuisActions(etapes, taches.filter((t) => !dossierId || t.dossier_id === dossierId));
}

// Numéro d'ordre technique (colonne bigint « ordre ») : comparé en entier exact.
const ordreDe = (e) => { try { return BigInt(String(e?.ordre ?? "")); } catch { return null; } };
const instant = (e) => { const t = Date.parse(e?.survenu_le ?? ""); return Number.isNaN(t) ? null : t; };
const microsecondes = (e) => Number(/\.(\d{1,6})/.exec(String(e?.survenu_le ?? ""))?.[1]?.padEnd(6, "0") ?? 0) % 1000;

/**
 * Tri canonique du journal : survenu_le décroissant, puis ordre décroissant.
 * Deux événements peuvent avoir la même heure ; leur numéro d'ordre, unique,
 * les départage toujours. L'heure est comparée à la microseconde.
 */
export function comparerEvenements(a, b) {
  const ta = instant(a), tb = instant(b);
  if (ta !== tb) return (tb ?? -Infinity) - (ta ?? -Infinity);
  const ua = microsecondes(a), ub = microsecondes(b);
  if (ua !== ub) return ub - ua;
  const oa = ordreDe(a), ob = ordreDe(b);
  if (oa !== ob) return oa === null ? 1 : ob === null ? -1 : (ob > oa ? 1 : -1);
  return 0;
}

/** Journal : du plus récent au plus ancien (tri canonique) ; filtré par étape si demandé. */
export function journal(evenements = [], etapeId = null) {
  return [...evenements]
    .filter((e) => !etapeId || e.etape_id === etapeId)
    .sort(comparerEvenements)
    .map((e) => ({ id: e.id, ordre: e.ordre == null ? null : String(e.ordre), quand: e.survenu_le, type: e.type,
      resume: e.resume, auteur: e.auteur_libelle, auteurType: e.auteur_type }));
}

/** En-tête : référence, libellé, statut, conseiller, lettre de mission. */
export function entete(dossier, utilisateurs = []) {
  if (!dossier) return null;
  const date = dossier.lettre_mission_signee_le ? String(dossier.lettre_mission_signee_le).slice(0, 10).split("-").reverse().join("/") : null;
  const lettre = STATUTS_LETTRE_MISSION[dossier.lettre_mission_statut] ?? dossier.lettre_mission_statut;
  return {
    reference: dossier.reference, libelle: dossier.libelle,
    statut: dossier.statut, statutLibelle: STATUTS_DOSSIER[dossier.statut] ?? dossier.statut,
    clos: !STATUTS_DOSSIER_NON_CLOS.includes(dossier.statut),
    motifCloture: dossier.motif_cloture ?? null,
    conseiller: nomUtilisateur(utilisateurs, dossier.conseiller_id) ?? "aucun",
    lettre: dossier.lettre_mission_statut === "signee" ? `${lettre} ${date ? `le ${date}` : "(date inconnue)"}` : lettre,
    lettreAnomalie: dossier.lettre_mission_statut === "inconnu" || (dossier.lettre_mission_statut === "signee" && !date),
  };
}

/**
 * Statut du client (invest_clients.statut) incohérent avec ses dossiers :
 * signalé, jamais corrigé automatiquement (arbitrage 7).
 * « Actif sans dossier en cours » est déjà signalé par invest_controle_dossiers.
 */
export function incoherenceStatutClient(client, dossiers = []) {
  const statut = String(client?.statut ?? "").trim();
  const enCours = dossiers.find((d) => STATUTS_DOSSIER_NON_CLOS.includes(d.statut));
  if (enCours && statut && statut.toLowerCase() !== "actif") {
    return `Statut client « ${statut} » alors que le dossier ${enCours.reference} est en cours : à vérifier (rien n'est corrigé automatiquement).`;
  }
  return null;
}

/**
 * Colonnes d'une tâche libre créée depuis la fiche : dossier et étape
 * explicites. Les anciennes colonnes step_* reçoivent l'étape canonique.
 */
export function champsNouvelleTache(dossierId, cleEtape) {
  const ref = ETAPES_PARCOURS.find((e) => e.cle === cleEtape);
  if (!dossierId) throw new Error("Démarrez d'abord une mission : une nouvelle tâche appartient à un dossier en cours.");
  if (!ref) throw new Error("Choisissez l'étape de la tâche.");
  return { dossier_id: dossierId, etape: ref.cle, step_key: ref.cle, step_label: ref.libelle, step_index: ref.numero };
}
