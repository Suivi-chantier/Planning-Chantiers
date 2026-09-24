// api/_ia/renovation/donnees.js — Couche d'accès aux données de l'assistant
// Rénovation. C'est le SEUL endroit de l'assistant qui crée un client Supabase.
//
// LECTURE SEULE PAR CONSTRUCTION. L'adaptateur renvoyé par lectureSeule()
// n'expose qu'une méthode : from(table).select(...). Il n'y a pas d'insert,
// d'update, d'upsert, de delete ni de rpc à appeler, même par erreur : la
// méthode n'existe pas sur l'objet. Le script
// scripts/verif-renovation-copilot-v1.mjs vérifie en plus qu'aucun de ces mots
// n'apparaît dans api/_ia/renovation/.
//
// LE MODÈLE NE CHOISIT JAMAIS UNE TABLE. Les noms de tables sont écrits en dur
// dans les outils et dans le chargeur partagé ; la liste blanche ci-dessous
// rend la règle vérifiable : toute autre table lève une exception — y compris
// les tables Invest, qui ne peuvent donc pas être atteintes par accident.
//
// La clé service_role contourne la RLS : c'est pourquoi l'accès est d'abord
// filtré par la tâche (autoriser : administrateur ET branche Rénovation).

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tables que l'assistant peut lire. Rien d'autre n'existe pour lui.
const TABLES_AUTORISEES = new Set([
  // Chargement de chantierFinance (api/_partage/donneesFinanceChantiers.js)
  "phasages",
  "pointages",
  "commande_lignes",
  "materiaux_bibliotheque",
  // Réglages (taux, lots, états financiers) et liste des chantiers
  "planning_config",
  // Relevés hebdomadaires, lus par les alertes
  "chantier_snapshots_hebdo",
  // Situations ProGBat (colonne « Facturé ProGBat » des États financiers)
  "chantier_factures_client",
  // Assistant planning (étape 2) : listes réelles pour TRADUIRE une consigne.
  // Lecture seule, comme le reste : l'enregistrement se fait dans le
  // navigateur, avec le compte de l'administrateur, jamais ici.
  "planning_resources",
  "planning_cells",
  "planning_constraints",
  "planning_resource_events",
]);

let _client = null;

function client() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Variables d'environnement Supabase manquantes côté serveur");
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  }
  return _client;
}

function verifierTable(nom) {
  if (!TABLES_AUTORISEES.has(nom)) {
    throw new Error(
      `Table hors périmètre de l'assistant Rénovation : ${nom}. ` +
      "Seules les tables de la liste blanche de api/_ia/renovation/donnees.js sont lisibles."
    );
  }
}

/**
 * Enveloppe un client Supabase (réel ou factice de test) pour n'en garder que
 * la lecture sur les tables autorisées. Forme exposée : { from(t) → { select } }.
 */
function envelopperLecture(source) {
  return {
    from(nom) {
      verifierTable(nom);
      const requete = source.from(nom);
      return { select: (...args) => requete.select(...args) };
    },
  };
}

/** L'adaptateur de production : service_role, lecture seule, liste blanche. */
function lectureSeule() {
  return envelopperLecture(client());
}

module.exports = {
  lectureSeule,
  envelopperLecture,
  TABLES_AUTORISEES,
};
