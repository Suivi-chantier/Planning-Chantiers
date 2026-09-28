// api/_ia/renovation/portee.js — Qui a le droit d'utiliser l'assistant Rénovation.
//
// Décision de Loris (24/09/2026) : en version 1, les ADMINISTRATEURS de la
// branche Rénovation, et eux seuls.
//
// Pourquoi deux contrôles et pas un : le champ `utilisateurs.role` est UNIQUE
// et partagé par les deux branches. Un « admin » peut n'appartenir qu'à la
// branche Invest ; seul `branches` dit à quelle application un compte a accès
// (voir le commentaire du select de profil dans api/ai.js).
//
// Lecture de `branches` : même règle que normalizeBranches() de
// src/constants.js, que le front applique pour ouvrir ou non la branche
// Rénovation — un tableau, une chaîne JSON ou un littéral Postgres « {a,b} »,
// et une valeur ABSENTE OU VIDE vaut ["renovation"]. Refuser ici un compte que
// le front laisse entrer dans Rénovation créerait deux vérités.

function normaliserRole(v) {
  return String(v || "").trim().replace(/\s+/g, "_").toLowerCase();
}

function branchesDe(v) {
  if (Array.isArray(v)) return v.length ? v : ["renovation"];
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr) && arr.length) return arr;
      } catch { /* format inattendu → lecture tolérante ci-dessous */ }
    }
    const parts = s.replace(/[{}[\]"']/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length) return parts;
  }
  return ["renovation"];
}

function estBrancheRenovation(branches) {
  return branchesDe(branches).map(normaliserRole).includes("renovation");
}

/** true, ou une phrase qui dit pourquoi le refus. */
function autoriserRenovation(profil) {
  if (!profil || typeof profil !== "object") return "Profil utilisateur introuvable.";
  if (!estBrancheRenovation(profil.branches)) {
    return "Ce compte n'a pas accès à la branche Profero Rénovation.";
  }
  if (normaliserRole(profil.role) !== "admin") {
    return `L'assistant Rénovation est réservé aux administrateurs en version 1 (rôle de ce compte : « ${profil.role || "aucun"} »).`;
  }
  return true;
}

module.exports = {
  autoriserRenovation,
  estBrancheRenovation,
  normaliserRole,
};
