// api/_ia/taches/ping.js — tâche de test du socle IA (Chantier 0, étape 3).
//
// Ne produit aucune valeur métier : elle sert à valider la chaîne complète
// auth → autorisation → appel modèle → validation de sortie → ia_jobs.
// C'est aussi le modèle à copier pour toute future tâche (cf. contrat
// documenté en tête de api/_ia/registre.js).

module.exports = {
  id: "ping",
  libelle: "Ping — test du socle IA",

  // Admin uniquement : permet aussi de vérifier le refus "non_autorise"
  // avec un compte d'un autre rôle. À élargir si besoin.
  roles: ["admin"],

  modele: "claude-opus-5",
  max_tokens: 2048,
  cout_max_eur: 0.05,
  sensible: false,

  // Entrée : { message?: string } — tout est optionnel.
  schema_entree(entree) {
    if (entree === undefined || entree === null) return true;
    if (typeof entree !== "object" || Array.isArray(entree)) return "l'entrée doit être un objet";
    if (entree.message !== undefined && typeof entree.message !== "string") {
      return "message doit être une chaîne";
    }
    return true;
  },

  construire_prompt(entree) {
    const message = (entree && entree.message) || "ping";
    return {
      system:
        "Tu es la tâche de test du socle IA d'une application de gestion de chantiers. " +
        "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans markdown, " +
        'de la forme exacte : {"pong": true, "echo": "<le message reçu, répété tel quel>"}',
      messages: [{ role: "user", content: `Message : ${message}` }],
    };
  },

  // Sortie attendue (après JSON.parse par la route) : { pong: true, echo: string }
  schema_sortie(resultat) {
    const erreurs = [];
    if (!resultat || typeof resultat !== "object") return ["la sortie doit être un objet JSON"];
    if (resultat.pong !== true) erreurs.push('le champ "pong" doit valoir true');
    if (typeof resultat.echo !== "string") erreurs.push('le champ "echo" doit être une chaîne');
    return erreurs.length ? erreurs : true;
  },
};
