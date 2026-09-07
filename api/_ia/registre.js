// api/_ia/registre.js — registre des tâches IA (Chantier 0, Brique 1, § 3.4).
//
// Chaque fonctionnalité IA est un fichier déclaratif dans api/_ia/taches/.
// Ajouter une fonctionnalité = créer le fichier + l'ajouter à la liste
// ci-dessous. La route /api/ai n'a aucune connaissance des tâches
// individuelles : elle ne parle qu'au registre.
//
// Contrat d'une définition de tâche (module exporté par api/_ia/taches/x.js) :
//   id                 identifiant stable, ex. "extraction_bl"
//   libelle            nom lisible (logs, écran admin)
//   roles              rôles autorisés, ex. ["admin", "conducteur"]
//   modele             modèle Anthropic à utiliser, ex. "claude-haiku-4-5"
//   max_tokens         plafond de sortie du modèle (défaut 8192)
//   cout_max_eur       garde-fou de coût par appel (contrôlé après l'appel)
//   sensible           true → statut "en_attente_validation" au lieu de "succes"
//   schema_entree(e)   validation du payload reçu → true | "erreur" | [erreurs]
//   schema_sortie(s)   validation du résultat parsé → true | "erreur" | [erreurs]
//   construire_prompt(entree, contexte) → { system, messages }
//   parser_sortie(texte)   optionnel — défaut : JSON.parse, sinon { texte }
//   calculer_confiance(resultat)   optionnel → nombre 0..1

// Champs supplémentaires, apparus avec le Copilote Invest et disponibles pour
// toute tâche :
//   autoriser(profil)          → true, ou une chaîne expliquant le refus.
//                                Pour ce que le rôle seul ne dit pas — la
//                                branche, par exemple : `role` est unique et
//                                partagé par Rénovation et Invest.
//   construire_outils(profil)  → [{ nom, description, schema, executer }]
//                                La route boucle alors sur le tool use. La
//                                liste peut dépendre des droits de l'appelant :
//                                un outil non exposé ne peut pas être appelé.
const TACHES = [
  require("./taches/ping"),
  require("./taches/invest_copilot"),
];

module.exports = Object.fromEntries(TACHES.map((t) => [t.id, t]));
