// api/_ia/invest/portee.js — Qui a le droit d'appeler quel outil.
//
// Pourquoi ce module est indispensable
// ────────────────────────────────────
// La RLS Invest, même après le chantier de sécurisation, ne distingue pas les
// rôles au niveau où le Copilote en a besoin : elle s'appuie sur
// invest_peut_voir(), qui lit planning_config.access_pages_invest. Et le
// Copilote interroge Supabase avec la clé service_role, qui CONTOURNE la RLS.
//
// Sans ce module, un commercial obtiendrait donc le suivi financier en
// langage naturel. C'est exactement l'avertissement du socle IA
// (public/chantier-0-socle-technique-ia.md § 6.4) : « la matrice ROLE_PAGES du
// front ne s'applique pas au serveur ».
//
// On rejoue donc canAccess() (src/access.js) côté serveur, dans le même ordre
// de résolution, à partir de la même source d'autorité : la clé
// access_pages_invest. Pas une copie de la matrice — la matrice elle-même.
//
// Deux filtres, pas un
// ────────────────────
// 1. Un outil dont la page n'est pas accordée au rôle n'est PAS EXPOSÉ au
//    modèle. Un outil invisible ne peut pas être halluciné ni appelé.
// 2. Les outils retirent en plus les colonnes sensibles. Le premier filtre
//    empêche la question ; le second protège si le premier est mal configuré.

const { lireMatriceAcces } = require("./donnees");

// Rôles qui gardent la main si la matrice est absente ou illisible. Sans ce
// repli, une clé de configuration effacée verrouillerait tout le monde — y
// compris l'administrateur qui doit la réparer. Même logique que la fonction
// SQL invest_peut_voir().
const ROLES_DE_REPLI = ["admin", "super_admin"];

function normaliserRole(v) {
  return String(v || "").trim().replace(/\s+/g, "_").toLowerCase();
}

// Reproduit canAccess(rolePages, role, page) : clé exacte, puis clé
// normalisée (ce qui couvre les variantes historiques « Admin »,
// « Super Admin », « Commercial »…), puis repli.
function peutVoir(matrice, role, page) {
  if (!role) return false;
  if (!matrice) return ROLES_DE_REPLI.includes(normaliserRole(role));

  const direct = matrice[role];
  if (Array.isArray(direct)) return direct.includes(page);

  const norm = normaliserRole(role);
  const parNorm = matrice[norm];
  if (Array.isArray(parNorm)) return parNorm.includes(page);

  return ROLES_DE_REPLI.includes(norm);
}

// Construit la portée d'un appel : le profil vient du JWT résolu par
// api/ai.js, jamais d'un paramètre fourni par le modèle.
//
// `branches` : son type exact n'a jamais pu être relevé (la table utilisateurs
// est protégée par la RLS et aucun dump n'était disponible). On applique la
// même comparaison tolérante que src/constants.js normalizeBranches(), qui
// accepte un tableau, une chaîne JSON et un littéral Postgres « {a,b} ».
function estBrancheInvest(branches) {
  if (Array.isArray(branches)) return branches.map(normaliserRole).includes("invest");
  const jetons = String(branches ?? "")
    .split(/[^a-zA-Z0-9_]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return jetons.includes("invest");
}

async function construirePortee(profil) {
  const role = profil && profil.role ? String(profil.role) : null;
  const membre = estBrancheInvest(profil && profil.branches);
  // Matrice chargée une fois par appel HTTP, jamais mise en cache entre deux
  // invocations : une modification d'accès depuis l'écran Admin doit prendre
  // effet immédiatement.
  const matrice = membre ? await lireMatriceAcces() : null;

  return {
    role,
    email: (profil && profil.email) || null,
    nom: (profil && profil.nom) || "",
    membreInvest: membre,
    // `page` est toujours une constante déclarée par un outil.
    peut: (page) => membre && peutVoir(matrice, role, page),
  };
}

module.exports = {
  construirePortee,
  estBrancheInvest,
  normaliserRole,
  ROLES_DE_REPLI,
};
