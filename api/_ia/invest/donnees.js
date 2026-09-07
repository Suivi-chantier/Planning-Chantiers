// api/_ia/invest/donnees.js — Couche d'accès aux données du Copilote Invest.
//
// C'est le SEUL endroit du Copilote qui parle à Supabase. Deux raisons.
//
// 1) LE MODÈLE NE CHOISIT JAMAIS UNE TABLE. Aucun outil n'accepte de nom de
//    table, de colonne, de clause SQL ni d'ordre de tri en paramètre : ces
//    noms sont écrits en dur dans le code des outils. Le modèle ne fournit que
//    des valeurs, dans des schémas typés et bornés.
//
// 2) LE PÉRIMÈTRE EST VÉRIFIABLE, PAS DÉCLARATIF. La liste blanche ci-dessous
//    est en dur. Toute table hors de cette liste lève une exception — y compris
//    une table Profero Rénovation, qui ne peut donc pas être atteinte par
//    accident ni par une future modification distraite.
//
// ⚠ invest_prospects est EXPLICITEMENT INTERDITE en V1. Elle reste la seule
//   table Invest ouverte en lecture et en écriture anonymes, faute d'avoir
//   identifié l'API Fluidify externe qui l'alimente (statut FLUIDIFY : NO-GO).
//   Tant que sa sécurité n'est pas réglée, aucune de ses données ne doit
//   transiter par un modèle. invest_prospect_actions l'accompagne : elle est
//   sécurisée depuis le chantier 1D, mais elle ne porte que des données de
//   prospects et aucun outil de la V1 n'en a besoin. Choix conservateur,
//   assumé, et relâchable le jour où vous le déciderez.
//
// La clé service_role est utilisée ici, côté serveur uniquement. Elle
// contourne la RLS : c'est nécessaire, parce que la RLS ne sait pas distinguer
// les rôles Invest, et cela impose que portee.js soit la porte unique. Un
// outil dont la page n'est pas accordée au rôle n'est même pas exposé au
// modèle — un outil invisible ne peut pas être appelé par erreur.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tables que le Copilote peut lire. Rien d'autre n'existe pour lui.
const TABLES_AUTORISEES = new Set([
  "invest_clients",
  "invest_biens",
  "invest_notes",
  "invest_propositions",
  "invest_mission_actions",
  "invest_action_notifications",
  "invest_planning",
  "invest_morning_routine_items",
  "invest_suivi_financier",
  "invest_structuration_patrimoniale",
  "invest_urbanisme_dossiers",
  "invest_etats_des_lieux",
  "invest_drive_links",
  "sourcing_annonces",
  "sourcing_criteres",
  "sourcing_logs",
]);

// Interdites nommément, pour que le refus soit explicite plutôt que déduit de
// l'absence dans la liste blanche. Le message d'erreur doit apprendre quelque
// chose à qui le lit.
const TABLES_INTERDITES = new Map([
  ["invest_prospects",
   "hors périmètre du Copilote V1 : table encore exposée en anon, API Fluidify externe non identifiée (FLUIDIFY : NO-GO)"],
  ["invest_prospect_actions",
   "hors périmètre du Copilote V1 : données de prospects, aucun outil V1 n'en a besoin"],
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

// Point d'entrée unique. `table` est toujours une constante du code d'un
// outil, jamais une valeur venue du modèle — mais on vérifie quand même :
// c'est ce contrôle qui rend la règle de périmètre testable.
function table(nom) {
  if (TABLES_INTERDITES.has(nom)) {
    throw new Error(`Table interdite au Copilote : ${nom} — ${TABLES_INTERDITES.get(nom)}`);
  }
  if (!TABLES_AUTORISEES.has(nom)) {
    throw new Error(
      `Table hors périmètre du Copilote : ${nom}. ` +
      "Seules les tables invest_* et sourcing_* de la liste blanche sont accessibles ; " +
      "aucune table Profero Rénovation ne l'est."
    );
  }
  return client().from(nom);
}

// Plafond de lignes commun à tous les outils. Le modèle peut demander moins,
// jamais plus : une réponse de mille lignes ne sert personne et coûte cher.
function borner(limite, defaut, max) {
  const n = Number(limite);
  if (!Number.isFinite(n) || n <= 0) return defaut;
  return Math.min(Math.floor(n), max);
}

// Accès nommé et étroit à la matrice d'accès Invest.
//
// planning_config n'est PAS dans la liste blanche ci-dessus, et ce n'est pas
// un oubli : c'est une table partagée avec Profero Rénovation, où 31 des 35
// clés lui appartiennent. Aucun outil ne doit pouvoir la lire. Mais portee.js
// a besoin d'UNE clé pour rejouer canAccess(), et il vaut mieux une porte
// nommée, en lecture seule et sur une clé unique, qu'un client Supabase brut
// exporté dans la nature.
async function lireMatriceAcces() {
  const { data, error } = await client()
    .from("planning_config")
    .select("value")
    .eq("key", "access_pages_invest")
    .maybeSingle();
  if (error) {
    console.warn(`[copilote] access_pages_invest illisible : ${error.message}`);
    return null;
  }
  return (data && data.value) || null;
}

module.exports = {
  table,
  borner,
  lireMatriceAcces,
  TABLES_AUTORISEES,
  TABLES_INTERDITES,
};
