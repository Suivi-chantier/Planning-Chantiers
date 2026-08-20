// src/Invest/annuaire.mjs — Rapprochement des noms de collaborateurs.
//
// Extension .mjs : parsable en ESM par Node sans passer par le build, pour que
// la veille quotidienne (api/_cron/cron-invest-echeances.js, en CommonJS)
// l'importe via `await import()`. Même convention que chantierFinance.mjs.
// Le front passe par _shared.jsx, qui réexporte.
//
// Pourquoi un module à part : la même règle d'appariement décide qui reçoit un
// e-mail côté serveur et qui apparaît dans les sélecteurs côté interface. Deux
// copies auraient divergé — c'est exactement la duplication qui a produit les
// trois valeurs de rendement divergentes du constat initial.
//
// Le problème résolu ici : les champs `responsable`, `conseiller_profero`,
// `commercial` et `auteur` contiennent un prénom saisi à la main (« Camille »),
// alors que la table `utilisateurs` porte un nom complet et un e-mail. Le
// format exact de `nom` n'est pas garanti, et un appariement raté ferait
// disparaître un destinataire en silence.

// Rôles extérieurs à l'équipe : pas de compte utilisateur, mais ils doivent
// rester proposés comme responsables d'une action.
export const ROLES_EXTERNES_INVEST = [
  "Client", "Courtier / Banque", "Notaire", "Agence", "Enedis", "Gestion locative", "Autre",
];

// Repli quand l'annuaire n'est pas encore chargé : un sélecteur ne doit jamais
// être vide, sinon on ne peut plus assigner personne.
export const COLLABORATEURS_FALLBACK = [
  "Matthieu", "Tom", "Quentin", "Camille", "Loris", "François", ...ROLES_EXTERNES_INVEST,
];

export function normaliserCleAnnuaire(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

// Construit l'index de rapprochement à partir des lignes de `utilisateurs`.
// Trois clés par personne, de la plus fiable à la plus permissive :
//   « camille landais »  nom complet normalisé
//   « camille »          premier mot du nom
//   « camille »          partie locale de l'e-mail, avant le point
export function indexerAnnuaire(utilisateurs = []) {
  const parCle = {};
  const personnes = [];
  const admins = [];

  for (const u of utilisateurs) {
    // Défense en profondeur : les appelants filtrent déjà sur `actif` dans la
    // requête, mais un oubli remettrait un ancien salarié dans les
    // destinataires d'e-mails. On refuse ici aussi, si le champ est présent.
    if (u && "actif" in u && u.actif === false) continue;

    const email = String(u?.email || "").trim();
    const nom = String(u?.nom || "").trim();
    if (!email && !nom) continue;

    const affichage = nom || email.split("@")[0];
    personnes.push({ nom: affichage, email, role: u?.role || "" });
    if (String(u?.role || "").toLowerCase() === "admin" && email) admins.push(email);

    const cleNom = normaliserCleAnnuaire(nom);
    const cleLocal = normaliserCleAnnuaire(email.split("@")[0]);
    const cles = [cleNom, cleNom.split(/\s+/)[0], cleLocal, cleLocal.split(".")[0]].filter(Boolean);

    for (const cle of cles) {
      // Premier arrivé gagne : une clé ambiguë (deux « Camille ») ne doit pas
      // changer de destinataire selon l'ordre de la requête.
      if (!parCle[cle] && email) parCle[cle] = { email, nom: affichage };
    }
  }
  return { parCle, personnes, admins };
}

export const ANNUAIRE_VIDE = { parCle: {}, personnes: [], admins: [] };

export function emailPourResponsable(annuaire, nomOuPrenom) {
  const cle = normaliserCleAnnuaire(nomOuPrenom);
  if (!cle) return "";
  const trouve = annuaire?.parCle?.[cle] || annuaire?.parCle?.[cle.split(/\s+/)[0]];
  return trouve?.email || "";
}

// Liste des responsables assignables : l'équipe active, puis les rôles
// extérieurs. Repli complet tant que l'annuaire n'est pas chargé.
export function responsablesInvest(annuaire) {
  const equipe = (annuaire?.personnes || []).map(p => p.nom).filter(Boolean);
  if (!equipe.length) return COLLABORATEURS_FALLBACK;
  return [...equipe, ...ROLES_EXTERNES_INVEST];
}

// Vrai quand `nom` désigne l'utilisateur connecté.
//
// Remplace les comparaisons littérales à la chaîne « Matthieu », qui
// encodaient la règle « on ne se notifie pas soi-même » dans un prénom : dès
// qu'un autre compte pilotait, ses propres dossiers passaient pour délégués et
// ses notifications partaient dans le vide.
export function estUtilisateurCourant(nom, profil) {
  if (!nom || !profil) return false;
  const cible = normaliserCleAnnuaire(nom);
  if (!cible) return false;
  const candidats = [
    profil.nom, profil.prenom, profil.email,
    String(profil.email || "").split("@")[0],
  ].map(normaliserCleAnnuaire).filter(Boolean);

  return candidats.some(c => c === cible || c.split(/[\s.]+/)[0] === cible);
}
