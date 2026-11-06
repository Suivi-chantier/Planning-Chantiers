// ─────────────────────────────────────────────────────────────────────────────
// chantiersDonnees — lecture et écriture des opérations et des chantiers dans
// leurs tables (Refonte Opérations, lot 1). SEUL endroit du front qui lit ou
// écrit public.chantiers / public.operations.
//
// Lecture : tables, triées comme l'ancien bloc. Repli en lecture seule sur le
// bloc planning_config (tenu à jour par la base, voir la migration
// 20261106045027) si les tables ne répondent pas : l'écran reste juste, et
// l'erreur est journalisée.
//
// Écriture : LIGNE PAR LIGNE. On compare la liste voulue au dernier état connu
// du serveur (calculerEcritures, module pur) et on n'envoie que ce qui change.
// Modifier un chantier ne réécrit plus les autres. Les écritures passent dans
// une file : deux enregistrements rapprochés partent dans l'ordre.
// Aucune suppression : « supprimer » = archiver (archive_le), récupérable.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "../supabase";
import { marquerEcritureConfig, estEchoConfigLocal } from "../configSync";
import {
  calculerEcritures, depuisLigneChantier, depuisLigneOperation, trierLignes,
} from "./chantiersTables.js";

// Lot 2 : client, chargé d'affaires et perte (colonnes facultatives).
const COLS_CHANTIER = "id, operation_id, nom, couleur, statut, ordre, donnees, archive_le, created_at, client_id, charge_affaires_id, charge_affaires_nom, perdu_le, perdu_par, perdu_motif, perdu_motif_detail";
const COLS_OPERATION = "id, nom, adresse, couleur, ordre, donnees, creee_automatiquement, archive_le, created_at, client_id, charge_affaires_id, charge_affaires_nom";
// Clés d'anti-écho (configSync) : nos propres écritures reviennent en temps
// réel quelques centaines de ms plus tard, on ne les réapplique pas.
export const CLE_ECHO_CHANTIERS = "table:chantiers";
export const CLE_ECHO_OPERATIONS = "table:operations";

// Dernier état connu du serveur (Map id → ligne), base du calcul des écritures.
const connues = { chantier: null, operation: null };

function memoriser(type, lignes) {
  const m = new Map();
  (lignes || []).forEach((l) => { if (l && l.id) m.set(l.id, l); });
  connues[type] = m;
}

async function lireLignes(type) {
  const table = type === "operation" ? "operations" : "chantiers";
  const cols = type === "operation" ? COLS_OPERATION : COLS_CHANTIER;
  const { data, error } = await supabase.from(table).select(cols);
  if (error) throw new Error(`${table} : ${error.message}`);
  const lignes = trierLignes(data || []);
  memoriser(type, lignes);
  return lignes;
}

async function lireRepliConfig(cle) {
  const { data } = await supabase.from("planning_config").select("value").eq("key", cle).maybeSingle();
  if (cle === "operations") return Array.isArray(data?.value?.items) ? data.value.items : [];
  return Array.isArray(data?.value) ? data.value : [];
}

/**
 * Chantiers (même forme que l'ancien bloc : { id, nom, couleur, statut?,
 * operation_id, …autres champs }), dans l'ordre d'affichage.
 * Les chantiers archivés ne sont renvoyés qu'avec inclureArchives.
 */
export async function chargerChantiers({ inclureArchives = false } = {}) {
  try {
    const lignes = await lireLignes("chantier");
    return lignes
      .filter((l) => inclureArchives || !l.archive_le)
      .map(depuisLigneChantier)
      .filter(Boolean);
  } catch (e) {
    console.error("chargerChantiers (repli sur la copie planning_config) :", e?.message || e);
    try { return await lireRepliConfig("chantiers"); } catch { return []; }
  }
}

/** Opérations ({ id, nom, adresse, couleur, creee_automatiquement? }), dans l'ordre. */
export async function chargerOperations({ inclureArchives = false } = {}) {
  try {
    const lignes = await lireLignes("operation");
    return lignes
      .filter((l) => inclureArchives || !l.archive_le)
      .map(depuisLigneOperation)
      .filter(Boolean);
  } catch (e) {
    console.error("chargerOperations (repli sur la copie planning_config) :", e?.message || e);
    try { return await lireRepliConfig("operations"); } catch { return []; }
  }
}

export async function chargerChantiersEtOperations() {
  const [chantiers, operations] = await Promise.all([chargerChantiers(), chargerOperations()]);
  return { chantiers, operations };
}

// ─── Écritures ───────────────────────────────────────────────────────────────
let file = Promise.resolve();
function enFile(tache) {
  const p = file.then(tache, tache);
  file = p.catch(() => {});
  return p;
}

function signalerEchec(message) {
  console.error(message);
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(`${message}\n\nLa modification n'a pas été enregistrée. Rechargez la page puis recommencez.`);
  }
}

async function executer(requete) {
  let res = await requete();
  if (res?.error) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await requete();
  }
  return res;
}

async function ecrire(type, liste) {
  const table = type === "operation" ? "operations" : "chantiers";
  const cleEcho = type === "operation" ? CLE_ECHO_OPERATIONS : CLE_ECHO_CHANTIERS;
  const cols = type === "operation" ? COLS_OPERATION : COLS_CHANTIER;
  if (!connues[type]) await lireLignes(type);
  const { inserts, updates } = calculerEcritures(connues[type], liste, { type });
  if (!inserts.length && !updates.length) return { ecritures: 0, inserts: 0 };

  marquerEcritureConfig(cleEcho);
  const erreurs = [];
  for (const ligne of inserts) {
    const res = await executer(() => supabase.from(table).insert(ligne).select(cols).single());
    if (res.error) erreurs.push(`${ligne.nom || ligne.id} : ${res.error.message}`);
    else connues[type].set(res.data.id, res.data);
  }
  for (const { id, patch } of updates) {
    const res = await executer(() => supabase.from(table).update(patch).eq("id", id).select(cols).single());
    if (res.error) erreurs.push(`${connues[type].get(id)?.nom || id} : ${res.error.message}`);
    else connues[type].set(res.data.id, res.data);
  }
  marquerEcritureConfig(cleEcho);
  if (erreurs.length) {
    signalerEchec(`Enregistrement ${type === "operation" ? "des opérations" : "des chantiers"} impossible — ${erreurs.join(" ; ")}`);
  }
  return { ecritures: inserts.length + updates.length, inserts: inserts.length, erreurs };
}

/**
 * Enregistre une liste de chantiers (même forme que l'ancien bloc) : seuls les
 * chantiers et les champs modifiés sont écrits. Un chantier absent de la
 * liste n'est jamais supprimé.
 */
export function sauverChantiers(liste) {
  return enFile(() => ecrire("chantier", liste));
}

/** Même principe pour les opérations ({ id, nom, adresse, couleur }). */
export function sauverOperations(liste) {
  return enFile(() => ecrire("operation", liste));
}

/** « Supprimer » un chantier : il est archivé (récupérable), jamais effacé. */
export function archiverChantier(id) {
  return enFile(async () => {
    marquerEcritureConfig(CLE_ECHO_CHANTIERS);
    const res = await supabase.from("chantiers").update({ archive_le: new Date().toISOString() })
      .eq("id", id).select(COLS_CHANTIER).single();
    marquerEcritureConfig(CLE_ECHO_CHANTIERS);
    if (res.error) { signalerEchec(`Suppression du chantier impossible : ${res.error.message}`); return false; }
    if (connues.chantier) connues.chantier.set(res.data.id, res.data);
    return true;
  });
}

/** « Supprimer » une opération : refusé si un chantier y est encore rattaché. */
export function archiverOperation(id) {
  return enFile(async () => {
    const { count, error: errCompte } = await supabase.from("chantiers")
      .select("id", { count: "exact", head: true }).eq("operation_id", id).is("archive_le", null);
    if (errCompte) { signalerEchec(`Suppression de l'opération impossible : ${errCompte.message}`); return false; }
    if (count > 0) { signalerEchec(`Suppression de l'opération impossible : ${count} chantier(s) y sont encore rattachés.`); return false; }
    marquerEcritureConfig(CLE_ECHO_OPERATIONS);
    const res = await supabase.from("operations").update({ archive_le: new Date().toISOString() })
      .eq("id", id).select(COLS_OPERATION).single();
    marquerEcritureConfig(CLE_ECHO_OPERATIONS);
    if (res.error) { signalerEchec(`Suppression de l'opération impossible : ${res.error.message}`); return false; }
    if (connues.operation) connues.operation.set(res.data.id, res.data);
    return true;
  });
}

/**
 * Temps réel : `rappel({ chantiers?, operations? })` après chaque modification
 * faite par quelqu'un d'autre (nos propres écritures sont ignorées pendant
 * 3 s, comme pour planning_config). Renvoie la fonction de désabonnement.
 */
export function abonnerChantiersOperations(rappel, nomCanal = "chantiers-operations") {
  const minuteries = {};
  const recharger = (type) => {
    clearTimeout(minuteries[type]);
    minuteries[type] = setTimeout(async () => {
      if (type === "chantier") rappel({ chantiers: await chargerChantiers() });
      else rappel({ operations: await chargerOperations() });
    }, 300);
  };
  const canal = supabase.channel(nomCanal)
    .on("postgres_changes", { event: "*", schema: "public", table: "chantiers" }, () => {
      if (estEchoConfigLocal(CLE_ECHO_CHANTIERS)) return;
      recharger("chantier");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "operations" }, () => {
      if (estEchoConfigLocal(CLE_ECHO_OPERATIONS)) return;
      recharger("operation");
    })
    .subscribe();
  return () => {
    Object.values(minuteries).forEach(clearTimeout);
    supabase.removeChannel(canal);
  };
}

// ─── Lot 2 : journal des statuts commerciaux ─────────────────────────────────
/**
 * Ajoute une entrée au journal (marqué perdu, perte annulée, bascule à la
 * signature). L'entrée est préparée par statutsChantier.mjs. Le journal ne se
 * modifie ni ne s'efface. Renvoie { ok, erreur }.
 */
export async function journaliserStatut(entree) {
  const { error } = await supabase.from("chantiers_statut_journal").insert(entree);
  if (error) console.error("journaliserStatut :", error.message);
  return { ok: !error, erreur: error?.message || null };
}

/** Historique des statuts commerciaux d'un chantier (plus récent d'abord). */
export async function chargerJournalStatut(chantierId) {
  const { data, error } = await supabase.from("chantiers_statut_journal")
    .select("id, evenement, ancien_statut, nouveau_statut, motif, detail, auteur, le")
    .eq("chantier_id", chantierId).order("le", { ascending: false });
  return { lignes: data || [], erreur: error?.message || null };
}

// ─── Lot 2 : client / chargé d'affaires d'une opération, création ───────────
const CHAMPS_COMMERCIAUX_OPERATION = ["client_id", "charge_affaires_id", "charge_affaires_nom"];

/**
 * Modifie UNIQUEMENT le client et/ou le chargé d'affaires d'une opération
 * (jamais ses autres champs : un objet partiel ne peut rien effacer).
 */
export function modifierOperationCommercial(id, patch) {
  const propre = {};
  CHAMPS_COMMERCIAUX_OPERATION.forEach((k) => { if (k in (patch || {})) propre[k] = patch[k] || null; });
  if (!Object.keys(propre).length) return Promise.resolve({ ok: true });
  return enFile(async () => {
    marquerEcritureConfig(CLE_ECHO_OPERATIONS);
    const res = await supabase.from("operations").update(propre).eq("id", id).select(COLS_OPERATION).single();
    marquerEcritureConfig(CLE_ECHO_OPERATIONS);
    if (res.error) { signalerEchec(`Enregistrement de l'opération impossible : ${res.error.message}`); return { ok: false, erreur: res.error.message }; }
    if (connues.operation) connues.operation.set(res.data.id, res.data);
    return { ok: true, operation: depuisLigneOperation(res.data) };
  });
}

/** Crée une opération (parcours de chiffrage). → { ok, operation } */
export async function creerOperation(objet) {
  const r = await sauverOperations([objet]);
  if (r?.erreurs?.length) return { ok: false, erreur: r.erreurs.join(" ; ") };
  const ligne = connues.operation?.get(objet.id);
  return { ok: !!ligne, operation: ligne ? depuisLigneOperation(ligne) : null, erreur: ligne ? null : "Opération non créée" };
}
