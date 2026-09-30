// src/Invest/dossiers/pilotage.mjs — Pilotage opérationnel à partir du Dossier
// Invest (Chantier 1.1, Tranche 2b).
//
// Source de vérité unique du CRM, du tableau de bord, de la Morning Routine et
// du mail du matin : dossier non clos, ses étapes (toutes les étapes actives,
// étape principale = etapeCourante()), balle, prochaine action, échéance,
// blocage, tâches rattachées au dossier.
//
// N'utilise JAMAIS invest_clients.etape / etape_num / prochaine_action /
// date_prochaine_action : ces colonnes sont historiques.
// La prochaine action et l'échéance d'une étape terminée ou non applicable
// sont conservées en base comme historique, mais ne sont jamais lues ici comme
// une action actuelle : seules les étapes actives comptent.
//
// Module PUR : données en paramètre, date du jour en paramètre, aucun accès
// Supabase. Façade front : ./pilotage.js.

import { ETAPES_PARCOURS, STATUTS_ETAPE, BALLES, STATUTS_DOSSIER, STATUTS_DOSSIER_NON_CLOS, etapeCourante } from "./parcours.mjs";

export const STATUTS_ETAPE_ACTIFS = Object.freeze(["en_cours", "en_attente", "bloquee"]);
const TACHE_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);
const JOURS_ECHEANCE_PROCHE = 7;
export const JOURS_SANS_EVOLUTION = 21;

const jour = (v) => (v ? String(v).slice(0, 10) : null);
const ajouterJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const dateFr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const ordreEtape = (cle) => ETAPES_PARCOURS.find((e) => e.cle === cle)?.numero ?? 99;

/** Qui a la balle, en clair : « Profero (Matthieu Fumoleau) », « Banque (Crédit X) », « Client ». */
function balleDe(e, utilisateurs) {
  if (!e?.balle) return { type: null, libelle: "personne", nom: null };
  const nom = e.balle === "profero"
    ? (utilisateurs.find((u) => u.id === e.balle_utilisateur_id)?.nom ?? null)
    : (e.balle_tiers_libelle || null);
  return { type: e.balle, libelle: `${BALLES[e.balle] ?? e.balle}${nom ? ` (${nom})` : ""}`, nom };
}

function vueEtape(e, utilisateurs, aujourdhui) {
  const ech = jour(e.echeance);
  const active = STATUTS_ETAPE_ACTIFS.includes(e.statut);
  return {
    id: e.id, etape: e.etape, numero: ordreEtape(e.etape),
    libelle: ETAPES_PARCOURS.find((r) => r.cle === e.etape)?.libelle ?? e.etape,
    statut: e.statut, statutLibelle: STATUTS_ETAPE[e.statut] ?? e.statut, active,
    balle: balleDe(e, utilisateurs),
    // Étape inactive : prochaine action et échéance = historique, jamais « à faire ».
    prochaineAction: active ? (String(e.prochaine_action || "").trim() || null) : null,
    echeance: active ? ech : null,
    echeanceDepassee: active && !!ech && ech < aujourdhui,
    echeanceAujourdhui: active && !!ech && ech === aujourdhui,
    echeanceProche: active && !!ech && ech > aujourdhui && ech <= ajouterJours(aujourdhui, JOURS_ECHEANCE_PROCHE),
    blocage: e.statut === "bloquee" ? { motif: e.blocage_motif || null, depuis: jour(e.bloquee_depuis) } : null,
    aConfirmer: e.reprise_a_confirmer === true,
    modifieLe: e.updated_at || null,
  };
}

/**
 * Pilotage d'un dossier non clos.
 * @returns objet de pilotage, ou null si le dossier est clos/abandonné/absent.
 */
export function pilotageDossier({ dossier, etapes = [], taches = [], utilisateurs = [], aujourdhui }) {
  if (!dossier || !STATUTS_DOSSIER_NON_CLOS.includes(dossier.statut)) return null;
  const siennes = etapes.filter((e) => e.dossier_id === dossier.id && !e.operation_id);
  const vues = siennes.map((e) => vueEtape(e, utilisateurs, aujourdhui));
  const courante = etapeCourante(siennes);
  const principale = courante ? vues.find((v) => v.etape === courante.etape) ?? null : null;
  const actives = vues.filter((v) => v.active).sort((a, b) => a.numero - b.numero);
  const tachesDossier = taches.filter((t) => t.dossier_id === dossier.id);
  const ouvertes = tachesDossier.filter((t) => TACHE_OUVERTE.has(t.status));
  const enRetard = ouvertes.filter((t) => jour(t.due_date) && jour(t.due_date) < aujourdhui)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const derniere = siennes.map((e) => e.updated_at).filter(Boolean).sort().pop() ?? null;
  const echeances = actives.map((a) => a.echeance).filter(Boolean).sort();
  const conseiller = utilisateurs.find((u) => u.id === dossier.conseiller_id)?.nom ?? null;
  return {
    dossierId: dossier.id, clientId: dossier.client_id, reference: dossier.reference, libelle: dossier.libelle,
    statut: dossier.statut, statutLibelle: STATUTS_DOSSIER[dossier.statut] ?? dossier.statut,
    conseillerId: dossier.conseiller_id ?? null, conseiller,
    principale, actives,
    aConfirmer: vues.filter((v) => v.aConfirmer).length,
    tachesOuvertes: ouvertes.length,
    tachesEnRetard: enRetard.map((t) => ({ id: t.id, titre: t.action_title || "Tâche", dueDate: jour(t.due_date), etape: t.etape || null })),
    prochaineEcheance: echeances[0] ?? null,
    derniereEvolution: jour(derniere),
    joursSansEvolution: derniere ? joursEntre(jour(derniere), aujourdhui) : null,
  };
}

/** Pilotage par client : Map client_id → pilotage du dossier non clos (au plus un par client). */
export function indexerPilotage({ dossiers = [], etapes = [], taches = [], utilisateurs = [], aujourdhui }) {
  const map = new Map();
  for (const d of dossiers) {
    const p = pilotageDossier({ dossier: d, etapes, taches, utilisateurs, aujourdhui });
    if (p) map.set(d.client_id, p);
  }
  return map;
}

/**
 * Une ligne lisible : étape principale · balle · prochaine action · échéance,
 * p. ex. « Acquisition · balle Notaire (Étude X) · Relancer le notaire · 31/10/2026 ».
 * Si l'action à mener porte sur une AUTRE étape active, elle est nommée :
 * « Analyse · balle Client · Collecte : Relancer le client · 31/10/2026 ».
 */
export function resumePilotage(p) {
  if (!p) return "Aucun Dossier Invest en cours";
  const e = p.principale;
  if (!e) return `${p.reference} · aucune étape active`;
  const a = etapeAAgir(p);
  const autre = a && a.id !== e.id && a.prochaineAction;
  return [e.libelle + (e.statut !== "en_cours" ? ` (${e.statutLibelle.toLowerCase()})` : ""),
    `balle ${e.balle.libelle}`,
    autre ? `${a.libelle} : ${a.prochaineAction}` : (e.prochaineAction || "sans prochaine action"),
    (autre ? a.echeance : e.echeance) ? dateFr(autre ? a.echeance : e.echeance) : null].filter(Boolean).join(" · ");
}

/**
 * Étape sur laquelle agir en premier (plusieurs étapes peuvent être actives) :
 * échéance dépassée, puis blocage, puis balle Profero avec une prochaine action
 * (échéance la plus proche d'abord), sinon l'étape principale.
 */
export function etapeAAgir(p) {
  if (!p) return null;
  const parEcheance = (a, b) => String(a.echeance || "9999").localeCompare(String(b.echeance || "9999")) || a.numero - b.numero;
  return [...p.actives].filter((a) => a.echeanceDepassee).sort(parEcheance)[0]
    || p.actives.find((a) => a.blocage)
    || [...p.actives].filter((a) => a.balle.type === "profero" && a.prochaineAction).sort(parEcheance)[0]
    || p.principale
    || null;
}

/**
 * Qui doit agir, quoi, avant quand — sur l'étape à agir (etapeAAgir).
 * Balle Profero : le collaborateur qui a la balle (à défaut le conseiller).
 * Balle client/banque/notaire/tiers : le conseiller, qui suit l'attente.
 * L'échéance est TOUJOURS celle de cette même étape.
 */
export function actionDuJour(p) {
  if (!p) return { responsable: null, action: null, echeance: null, etape: null };
  const e = etapeAAgir(p);
  const suit = e?.balle.type === "profero" ? (e.balle.nom || p.conseiller) : p.conseiller;
  const action = e?.prochaineAction
    || (e && e.balle.type && e.balle.type !== "profero" ? `Suivre l'attente : ${e.balle.libelle} (${e.libelle})` : null)
    || (e ? `Définir la prochaine action (${e.libelle})` : "Démarrer l'étape suivante du dossier");
  return { responsable: suit || null, action, echeance: e?.echeance ?? null, etape: e };
}

const alerte = (code, label, level, due_date = "") => ({ code, label, level, due_date: due_date || "", source: "dossier_invest" });

/**
 * Alertes de pilotage, par ordre de priorité métier :
 * échéance dépassée, blocage, tâche en retard, échéance du jour, balle Profero
 * avec action à faire, dossier sans prochaine action, échéance proche,
 * attente d'un tiers, dossier sans évolution.
 */
export function alertesPilotage(p) {
  if (!p) return [];
  const out = [];
  for (const a of p.actives.filter((x) => x.echeanceDepassee)) out.push(alerte(`echeance_depassee_${a.etape}`, `Échéance dépassée : ${a.libelle} (${dateFr(a.echeance)})`, "danger", a.echeance));
  for (const a of p.actives.filter((x) => x.blocage)) out.push(alerte(`bloquee_${a.etape}`, `Bloquée : ${a.libelle}${a.blocage.motif ? ` — ${a.blocage.motif}` : ""}`, "danger", a.blocage.depuis));
  for (const t of p.tachesEnRetard) out.push(alerte(`tache_retard_${t.id}`, `Tâche en retard : ${t.titre}`, "danger", t.dueDate));
  for (const a of p.actives.filter((x) => x.echeanceAujourdhui)) out.push(alerte(`echeance_jour_${a.etape}`, `Échéance aujourd'hui : ${a.libelle}`, "danger", a.echeance));
  for (const a of p.actives.filter((x) => x.balle.type === "profero" && x.prochaineAction && !x.echeanceDepassee && !x.blocage)) {
    out.push(alerte(`a_faire_${a.etape}`, `À faire par ${a.balle.nom || "Profero"} : ${a.prochaineAction} (${a.libelle})`, "warning", a.echeance));
  }
  if (!p.actives.length) out.push(alerte("aucune_etape_active", `${p.reference} : aucune étape active`, "warning"));
  else if (!p.actives.some((a) => a.prochaineAction)) {
    const profero = p.actives.some((a) => a.balle.type === "profero");
    out.push(alerte("sans_prochaine_action", profero ? "Sans prochaine action alors que Profero a la balle" : "Sans prochaine action", profero ? "danger" : "warning"));
  }
  for (const a of p.actives.filter((x) => x.echeanceProche)) out.push(alerte(`echeance_proche_${a.etape}`, `Échéance ${a.libelle} le ${dateFr(a.echeance)}`, "warning", a.echeance));
  for (const a of p.actives.filter((x) => x.balle.type && x.balle.type !== "profero" && !x.blocage && !x.echeanceDepassee)) {
    out.push(alerte(`attente_${a.etape}`, `En attente : ${a.balle.libelle} (${a.libelle})`, "info", a.echeance));
  }
  if (p.joursSansEvolution !== null && p.joursSansEvolution >= JOURS_SANS_EVOLUTION) {
    out.push(alerte("sans_evolution", `Aucune évolution du dossier depuis ${p.joursSansEvolution} jours`, "warning"));
  }
  return out;
}

/** Chiffres du suivi Invest (tableau de bord). */
export function syntheseDossiers(pilotages = []) {
  const liste = [...pilotages];
  const actives = liste.flatMap((p) => p.actives);
  const balles = {};
  for (const a of actives) { const k = a.balle.type || "personne"; balles[k] = (balles[k] || 0) + 1; }
  return {
    dossiers: liste.length,
    etapesActives: actives.length,
    dossiersPlusieursEtapes: liste.filter((p) => p.actives.length > 1).length,
    balles,
    bloques: liste.filter((p) => p.actives.some((a) => a.blocage)).length,
    prochainesActions: actives.filter((a) => a.prochaineAction).length,
    echeancesDepassees: actives.filter((a) => a.echeanceDepassee).length,
    echeancesProches: actives.filter((a) => a.echeanceProche || a.echeanceAujourdhui).length,
    tachesEnRetard: liste.reduce((s, p) => s + p.tachesEnRetard.length, 0),
    sansProchaineAction: liste.filter((p) => p.actives.length && !p.actives.some((a) => a.prochaineAction)).length,
    aConfirmer: liste.reduce((s, p) => s + p.aConfirmer, 0),
  };
}

/**
 * Projection d'un client pour les écrans de liste du CRM : les champs
 * d'avancement affichés viennent du Dossier Invest. Les valeurs historiques
 * restent disponibles dans `_historique`.
 * Un « Prospect » sans dossier garde sa relance historique (aucun dossier ne
 * peut encore la porter) ; un autre client sans dossier n'a pas d'action.
 */
export function projeterClient(client, p, { inconnu = false } = {}) {
  const historique = { etape: client.etape ?? null, prochaine_action: client.prochaine_action ?? null, date_prochaine_action: client.date_prochaine_action ?? null };
  if (p) {
    // Étape affichée = principale ; action et échéance = celles de l'étape où agir.
    const e = p.principale;
    const a = etapeAAgir(p);
    return { ...client, _historique: historique, _pilotage: p, _etapeAction: a,
      etape: e ? e.libelle : `${p.reference} · aucune étape active`,
      prochaine_action: a?.prochaineAction ? (a.id !== e?.id ? `${a.libelle} : ${a.prochaineAction}` : a.prochaineAction) : null,
      date_prochaine_action: a?.echeance ?? null };
  }
  const prospect = String(client.statut || "").trim().toLowerCase() === "prospect";
  return { ...client, _historique: historique, _pilotage: null, _pilotageInconnu: inconnu,
    // Dossiers non chargés : avancement inconnu, jamais présenté comme « sans dossier ».
    etape: inconnu ? "Avancement indisponible" : "Sans Dossier Invest en cours",
    prochaine_action: prospect ? historique.prochaine_action : null,
    date_prochaine_action: prospect ? historique.date_prochaine_action : null };
}

const normaliser = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Le dossier a-t-il une étape ACTIVE qui correspond à `motif` (clé, libellé ou
 * qui a la balle : « financement », « acquisition », « notaire », « banque »…) ?
 * Toutes les étapes actives comptent, pas seulement l'étape principale : un
 * dossier en Financement ET en Acquisition répond aux deux.
 */
export function correspondEtapeActive(p, motif) {
  const m = normaliser(motif);
  if (!p || !m) return false;
  return p.actives.some((a) => normaliser(`${a.etape} ${a.libelle} ${a.balle.libelle} ${a.balle.type || ""}`).includes(m));
}
