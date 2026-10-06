// ─────────────────────────────────────────────────────────────────────────────
// Motifs du compte rendu (formulaire bêta « cr_v2 ») — LISTE UNIQUE.
//
// Lue par le formulaire ouvrier, la Validation, l'e-mail du compte rendu et
// tous les écrans qui affichent l'explication d'une tâche. Module pur : aucune
// dépendance, façade front motifsCompteRendu.js.
//
// ⚠️ LES CODES SONT STABLES : ils sont écrits dans rapports.taches[] et
// serviront aux statistiques. On peut corriger un LIBELLÉ, jamais renommer ou
// réutiliser un code. Un code retiré doit rester dans la liste (marqué
// `retire: true`) pour que les anciens rapports gardent leur libellé.
// ─────────────────────────────────────────────────────────────────────────────

// « Qu'est-ce qui bloque ? » (Bloqué) / « Pourquoi pas commencé ? » (Pas commencé)
export const MOTIFS_STATUT = Object.freeze([
  { code: "attente_materiel", label: "Attente de matériel" },
  { code: "autre_corps_etat", label: "Autre corps d'état pas passé" },
  { code: "acces_impossible", label: "Accès impossible" },
  { code: "info_manquante",   label: "Information manquante" },
  { code: "decision_client",  label: "Décision du client attendue" },
  { code: "manque_de_temps",  label: "Manque de temps" },
  { code: "priorite_changee", label: "Priorité changée" },
  { code: "autre",            label: "Autre" },
]);

// « X h sur Y h vendues : pourquoi ? »
export const MOTIFS_DEPASSEMENT = Object.freeze([
  { code: "imprevu",           label: "Imprévu découvert" },
  { code: "demande_client",    label: "Demande du client" },
  { code: "support_degrade",   label: "Support dégradé" },
  { code: "reprise",           label: "Reprise / correction" },
  { code: "devis_sous_estime", label: "Devis sous-estimé" },
  { code: "autre",             label: "Autre" },
]);

export const CODE_MOTIF_AUTRE = "autre";

const trouver = (liste, code) => (code ? liste.find(m => m.code === code) : null);

// Libellé d'un code ; un code inconnu reste VISIBLE (jamais effacé en silence).
export function libelleMotifStatut(code) {
  if (!code) return null;
  return trouver(MOTIFS_STATUT, code)?.label || `Motif « ${code} »`;
}
export function libelleMotifDepassement(code) {
  if (!code) return null;
  return trouver(MOTIFS_DEPASSEMENT, code)?.label || `Motif « ${code} »`;
}

// Explication d'une ligne de compte rendu, telle que les écrans l'affichent à
// la place de la remarque :
//   - ligne de l'ancien formulaire (pas de motif) → la remarque, inchangée ;
//   - ligne v2 avec motif → « Libellé du motif — précision ».
// Le motif de DÉPASSEMENT n'y figure pas : il qualifie les heures, pas le
// statut, et s'affiche à part (voir explicationDepassement).
export function explicationLigne(ligne) {
  const remarque = String(ligne?.remarque ?? "").trim();
  const motif = libelleMotifStatut(ligne?.motif);
  if (!motif) return remarque;
  return remarque ? `${motif} — ${remarque}` : motif;
}

// « Dépassement : Imprévu découvert » — vide si la ligne n'en porte pas.
export function explicationDepassement(ligne) {
  const l = libelleMotifDepassement(ligne?.motif_depassement);
  return l ? `Dépassement : ${l}` : "";
}

// Tout ce que l'ouvrier a expliqué, sur une ligne (e-mail, exports).
export function explicationComplete(ligne) {
  return [explicationLigne(ligne), explicationDepassement(ligne)].filter(Boolean).join(" · ");
}

// Statut tel que l'ouvrier l'a CHOISI dans le formulaire v2. Les valeurs
// stockées restent celles de l'ancien formulaire (faite / en_cours /
// non_faite) ; « Bloqué » se lit dans le drapeau `bloque`.
export function libelleStatutChoisi(ligne) {
  if (ligne?.bloque) return "Bloqué";
  if (ligne?.statut === "faite") return "Terminé";
  if (ligne?.statut === "en_cours") return "En cours";
  if (ligne?.statut === "non_faite") return "Pas commencé";
  return null;
}
