// ─── ASSISTANT PLANNING — ACCÈS AUX DONNÉES (navigateur) ────────────────────
// Le SEUL fichier de l'assistant planning qui parle à Supabase et à /api/ai.
// Les règles vivent dans les modules purs (assistantPlanningConsigneV1.mjs,
// assistantPlanningApercuV1.mjs) ; l'écran (AssistantPlanning.jsx) ne fait
// qu'afficher.
//
// Écritures : UNIQUEMENT une ligne de planning_resource_events ou de
// planning_constraints, créée avec le compte de l'administrateur connecté
// (RLS), source = 'assistant', après son clic « Enregistrer et recalculer » ;
// et la suppression de CETTE ligne (« Annuler cette consigne »). Rien d'autre :
// ni le planning (planning_cells), ni les phasages. L'application au planning
// est l'étape 3.

import { supabase } from "../supabase";
import { simulerPlanningGlobalV1 } from "./planningEngineDataV1.js";
import { parserConfigMoteurV1 } from "./planningEngineDataHelpersV1.js";
import { normaliserEquipeLegacy, normaliserNomRessource } from "./planningResourceModelV1.js";
import { capaciteBasePlanningPourDate } from "./planningResourceCapacityV1.js";
import {
  NATURES_CONSIGNE, SOURCE_ASSISTANT, TABLE_CONTRAINTES, TABLE_EVENEMENTS, VIA_ASSISTANT,
  ajouterJoursV1, celluleDuJourV1, consignesAssistantV1, fenetreSimulationConsigneV1,
  interventionsDuJourV1, validerConsigneV1,
} from "./assistantPlanningConsigneV1.js";

export const TACHE_IA = "renovation_planning_consigne";

const MESSAGES_ERREUR = {
  non_authentifie: "Votre session a expiré. Reconnectez-vous pour utiliser l'assistant.",
  quota_depasse: "Le plafond d'utilisation de l'IA est atteint. Réessayez plus tard.",
  tache_inconnue: "L'assistant planning n'est pas encore déployé sur ce serveur.",
  entree_invalide: "Consigne mal formée. Reformulez-la.",
  modele_indisponible: "L'assistant est momentanément indisponible. L'application reste utilisable normalement.",
  erreur_interne: "Une erreur est survenue côté serveur.",
};

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Mêmes règles que le panneau Simulation : aujourd'hui reste hors recalcul.
export function aujourdhuiISO() { return iso(new Date()); }
export function prochainJourPlanifiable() {
  let d = ajouterJoursV1(aujourdhuiISO(), 1);
  for (let i = 0; i < 14; i++) {
    if (capaciteBasePlanningPourDate(d) > 0) return d;
    d = ajouterJoursV1(d, 1);
  }
  return d;
}

async function verifier(res, libelle) {
  const r = await res;
  if (r.error) throw new Error(`${libelle} : ${r.error.message}`);
  return r.data || [];
}

/** Traduction d'une phrase par la tâche serveur (jamais d'écriture côté serveur). */
export async function traduireConsigne({ question, historique = [], contexte = {} }) {
  const { data: session } = await supabase.auth.getSession();
  const jeton = session?.session?.access_token;
  if (!jeton) return { ok: false, message: MESSAGES_ERREUR.non_authentifie };
  let r, corps;
  try {
    r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ tache: TACHE_IA, entree: { question, historique }, contexte: { branche: "renovation", ...contexte } }),
    });
    corps = await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, message: `Appel impossible : ${e.message}` };
  }
  if (!r.ok || !corps || corps.ok !== true) {
    const code = corps?.erreur?.code;
    if (code === "sortie_invalide") {
      return { ok: false, refus: true, message: `Proposition refusée par le contrôle serveur. ${corps?.erreur?.message || ""}`.trim() };
    }
    return { ok: false, message: (code && MESSAGES_ERREUR[code]) || corps?.erreur?.message || `Erreur ${r.status}` };
  }
  return { ok: true, resultat: corps.resultat || {}, jobId: corps.job_id || null };
}

/** Référentiel lu avec le compte de l'administrateur, pour valider AVANT d'écrire. */
export async function chargerReferentiel(consigne = {}) {
  const chantierId = String(consigne?.chantier_id || "").trim() || null;
  const [config, ressources, contraintes, evenements] = await Promise.all([
    verifier(supabase.from("planning_config").select("key,value").in("key", ["chantiers", "groupes_types", "equipes"]), "Configuration"),
    verifier(supabase.from("planning_resources").select("id,nom,nom_planning,kind,actif"), "Ressources"),
    verifier(supabase.from("planning_constraints").select("id,type,scope,chantier_id,groupe_type_id,tache_id,allocation_id,label,source,actif,created_at").eq("actif", true), "Consignes"),
    verifier(supabase.from("planning_resource_events").select("id,resource_id,type,date_debut,date_fin,toute_journee,heures_indisponibles,source,actif,created_at").eq("actif", true), "Absences"),
  ]);
  const cfg = parserConfigMoteurV1(config);
  const phasages = chantierId
    ? await verifier(supabase.from("phasages").select("chantier_id,ouvrages,plan_travaux").eq("chantier_id", chantierId), "Phasage")
    : [];
  let interventions = [];
  if (consigne?.nature === NATURES_CONSIGNE.INTERVENTION_VERROUILLEE && consigne?.date) {
    const cible = celluleDuJourV1(consigne.date);
    if (cible) {
      const cellules = await verifier(supabase.from("planning_cells").select("chantier_id,week_id,jour,ouvriers,taches").eq("week_id", cible.week_id).eq("jour", cible.jour), "Planning");
      interventions = interventionsDuJourV1({ cellules, date: consigne.date, verrous: contraintes.filter(k => k.type === "allocation_lock") });
    }
  }
  return { ressources, chantiers: cfg.chantiers, groupesTypes: cfg.groupesTypes, equipes: cfg.equipes, phasages, interventions, evenements, contraintes };
}

// Équipe habituelle d'un lot, avec la règle même de l'adaptateur du moteur :
// équipe du groupe type (responsable + membres), sinon priorités du groupe.
export function membresEquipeLotDepuis(referentiel) {
  const gts = new Map((referentiel.groupesTypes || []).map(g => [String(g.id), g]));
  const equipes = new Map((referentiel.equipes || []).map(e => [String(e.id), e]));
  const parNom = new Map((referentiel.ressources || []).map(r => [normaliserNomRessource(r.nom_planning || r.nom), String(r.id)]));
  return (gtId) => {
    const gt = gts.get(String(gtId));
    if (!gt) return null;
    const eq = equipes.get(String(gt.equipe_id || ""));
    if (eq) return normaliserEquipeLegacy(eq, referentiel.ressources || []).resource_ids;
    const prios = (gt.ouvriers_prio || []).map(n => parNom.get(normaliserNomRessource(n))).filter(Boolean);
    return prios.length ? prios : null;
  };
}

/** Validation navigateur complète (avec rythme de travail et équipe du lot). */
export function validerDansLeNavigateur(consigne, referentiel) {
  return validerConsigneV1(consigne, referentiel, {
    aujourdhui: aujourdhuiISO(),
    capaciteBase: capaciteBasePlanningPourDate,
    membresEquipeLot: membresEquipeLotDepuis(referentiel),
  });
}

/** Enregistre la consigne validée. Qui : compte connecté ; quand : created_at. */
export async function enregistrerConsigne({ table, ligne, texteOrigine, email }) {
  if (![TABLE_EVENEMENTS, TABLE_CONTRAINTES].includes(table)) throw new Error(`Table non autorisée : ${table}`);
  if (ligne?.source !== SOURCE_ASSISTANT) throw new Error("Une consigne de l'assistant porte toujours source = assistant.");
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id || null;
  const trace = { via: VIA_ASSISTANT, cree_par: email || auth?.user?.email || null, consigne_texte: String(texteOrigine || "").slice(0, 500) };
  const payload = table === TABLE_EVENEMENTS
    ? { ...ligne, details: { ...(ligne.details || {}), ...trace } }
    : { ...ligne, created_by: userId, config: { ...(ligne.config || {}), ...trace } };
  const { data, error } = await supabase.from(table).insert(payload).select("id,created_at").single();
  if (error) throw new Error(`Enregistrement impossible : ${error.message}`);
  return data;
}

/** Supprime UNE consigne créée par l'assistant (jamais une saisie manuelle). */
export async function annulerConsigne({ table, id }) {
  if (![TABLE_EVENEMENTS, TABLE_CONTRAINTES].includes(table)) throw new Error(`Table non autorisée : ${table}`);
  const { data, error } = await supabase.from(table).delete().eq("id", id).eq("source", SOURCE_ASSISTANT).select("id");
  if (error) throw new Error(`Annulation impossible : ${error.message}`);
  if (!data || data.length !== 1) throw new Error("Consigne introuvable (déjà annulée ?) : rien n'a été supprimé.");
  return true;
}

export async function chargerConsignesAssistant() {
  const ref = await chargerReferentiel({});
  return consignesAssistantV1({ contraintes: ref.contraintes, evenements: ref.evenements, ressources: ref.ressources, chantiers: ref.chantiers });
}

export function fenetrePourFiche(fiche) {
  return fenetreSimulationConsigneV1({
    periode: fiche?.periode || {},
    prochainJourPlanifiable: prochainJourPlanifiable(),
    demain: ajouterJoursV1(aujourdhuiISO(), 1),
  });
}

/** Le moteur existant, tel quel : même fonction que le panneau Simulation. */
export async function recalculer(fenetre) {
  return simulerPlanningGlobalV1({ startDate: fenetre.startDate, horizonDays: fenetre.horizonDays });
}

export async function chargerAbsences() {
  return verifier(supabase.from("planning_resource_events").select("id,resource_id,type,date_debut,date_fin,toute_journee,heures_indisponibles,actif").eq("actif", true), "Absences");
}

export { capaciteBasePlanningPourDate };
