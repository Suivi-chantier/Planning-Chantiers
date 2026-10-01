// src/Invest/dossiers/transitions.mjs — Gestes explicites sur une étape du
// Dossier Invest (Chantier 1.1, Tranche 2a).
//
// Module PUR : aucune dépendance Supabase, aucune horloge implicite (la date
// du jour est passée en paramètre), aucun effet de bord.
// La base applique les mêmes règles (supabase/migrations/…_invest_dossiers_tranche2a.sql) :
// ce module sert à n'afficher que les gestes possibles et à préparer la
// modification ; il ne remplace jamais le contrôle serveur.
//
// Règle absolue : rien ne fait avancer une étape sans geste d'un collaborateur.

import { STATUTS_AVEC_BALLE } from "./parcours.mjs";

export const BALLES_AVEC_COLLABORATEUR = Object.freeze(["profero"]);
export const BALLES_AVEC_TIERS = Object.freeze(["banque", "notaire", "tiers"]);

// Enchaînements de statut autorisés (identiques au contrôle serveur).
export const TRANSITIONS = Object.freeze({
  a_venir:        ["en_cours", "non_applicable"],
  en_cours:       ["en_attente", "bloquee", "terminee", "non_applicable"],
  en_attente:     ["en_cours", "bloquee", "terminee", "non_applicable"],
  bloquee:        ["en_cours", "en_attente"],
  terminee:       ["en_cours"],
  non_applicable: ["en_cours"],
});

export function transitionAutorisee(de, vers) {
  if (de === vers) return true;
  return (TRANSITIONS[de] ?? []).includes(vers);
}

/**
 * Catalogue des gestes. `depuis` : statuts où le geste est proposé.
 * `vers` : statut obtenu (absent = le statut ne change pas).
 * `exige` : saisies obligatoires.
 */
export const GESTES = Object.freeze([
  { cle: "demarrer",           libelle: "Démarrer",                depuis: ["a_venir"],                         vers: "en_cours",       exige: ["balle"] },
  { cle: "mettre_en_attente",  libelle: "Mettre en attente",       depuis: ["en_cours"],                        vers: "en_attente",     exige: ["balle"] },
  { cle: "reprendre",          libelle: "Reprendre",               depuis: ["en_attente"],                      vers: "en_cours",       exige: ["balle"] },
  { cle: "bloquer",            libelle: "Bloquer",                 depuis: ["en_cours", "en_attente"],          vers: "bloquee",        exige: ["balle", "motif"] },
  { cle: "debloquer",          libelle: "Débloquer",               depuis: ["bloquee"],                         vers: "en_cours",       exige: ["balle"] },
  { cle: "terminer",           libelle: "Terminer",                depuis: ["en_cours", "en_attente"],          vers: "terminee",       exige: [] },
  { cle: "non_applicable",     libelle: "Non applicable",          depuis: ["a_venir", "en_cours", "en_attente"], vers: "non_applicable", exige: ["motif"] },
  { cle: "rouvrir",            libelle: "Rouvrir",                 depuis: ["terminee", "non_applicable"],      vers: "en_cours",       exige: ["balle", "motif"] },
  { cle: "changer_balle",      libelle: "Changer la balle",        depuis: STATUTS_AVEC_BALLE,                  exige: ["balle"] },
  { cle: "prochaine_action",   libelle: "Prochaine action",        depuis: ["a_venir", "en_cours", "en_attente", "bloquee", "terminee", "non_applicable"], exige: [] },
  { cle: "echeance",           libelle: "Échéance",                depuis: ["a_venir", "en_cours", "en_attente", "bloquee", "terminee", "non_applicable"], exige: [] },
  { cle: "confirmer_reprise",  libelle: "Confirmer la reprise",    depuis: ["a_venir", "en_cours", "en_attente", "bloquee", "terminee", "non_applicable"], exige: [], seulementReprise: true },
]);

const parCle = Object.fromEntries(GESTES.map((g) => [g.cle, g]));

/** Gestes proposés pour une étape (dans l'ordre du catalogue). */
export function gestesDisponibles(etape) {
  if (!etape || etape.operation_id) return [];
  return GESTES.filter((g) => g.depuis.includes(etape.statut) && (!g.seulementReprise || etape.reprise_a_confirmer === true));
}

const texte = (v) => String(v ?? "").trim();

function balleDepuisSaisie(saisie, erreurs) {
  const balle = texte(saisie.balle);
  if (!balle) { erreurs.push("Indiquez qui a la balle."); return {}; }
  if (!["client", "profero", "banque", "notaire", "tiers"].includes(balle)) { erreurs.push("Balle inconnue."); return {}; }
  return {
    balle,
    balle_utilisateur_id: BALLES_AVEC_COLLABORATEUR.includes(balle) ? (texte(saisie.balle_utilisateur_id) || null) : null,
    balle_tiers_libelle: BALLES_AVEC_TIERS.includes(balle) ? (texte(saisie.balle_tiers_libelle) || null) : null,
  };
}

/** Ajoute un motif daté au commentaire existant (jamais d'écrasement). */
export function commentaireAvecMotif(ancien, libelleGeste, motif, dateIso) {
  const date = String(dateIso ?? "").slice(0, 10).split("-").reverse().join("/");
  const ligne = `${date} · ${libelleGeste} : ${texte(motif)}`;
  return texte(ancien) ? `${texte(ancien)}\n${ligne}` : ligne;
}

/**
 * Prépare la modification d'une étape pour un geste.
 * @param {object} etape      ligne invest_dossier_etapes actuelle
 * @param {string} cleGeste
 * @param {object} saisie     { balle, balle_utilisateur_id, balle_tiers_libelle, motif, prochaine_action, prochaine_action_id, echeance }
 * @param {string} aujourdhui date AAAA-MM-JJ (fournie par l'appelant)
 * @returns {{ patch: object|null, erreurs: string[] }}
 */
export function preparerGeste(etape, cleGeste, saisie = {}, aujourdhui = "") {
  const erreurs = [];
  const g = parCle[cleGeste];
  if (!g) return { patch: null, erreurs: ["Geste inconnu."] };
  if (!gestesDisponibles(etape).some((x) => x.cle === cleGeste)) {
    return { patch: null, erreurs: [`« ${g.libelle} » n'est pas possible depuis cet état.`] };
  }
  let patch = {};
  if (g.exige.includes("balle")) patch = { ...patch, ...balleDepuisSaisie(saisie, erreurs) };
  if (g.exige.includes("motif") && !texte(saisie.motif)) erreurs.push("Un motif est obligatoire.");

  switch (cleGeste) {
    case "demarrer":
    case "reprendre":
    case "mettre_en_attente":
    case "debloquer":
      patch.statut = g.vers;
      if (texte(saisie.prochaine_action)) patch.prochaine_action = texte(saisie.prochaine_action);
      if (texte(saisie.echeance)) patch.echeance = texte(saisie.echeance);
      if (texte(saisie.motif)) patch.commentaire = commentaireAvecMotif(etape.commentaire, g.libelle, saisie.motif, aujourdhui);
      break;
    case "bloquer":
      patch.statut = "bloquee";
      patch.blocage_motif = texte(saisie.motif);
      break;
    case "terminer":
      patch.statut = "terminee";
      if (texte(saisie.motif)) patch.commentaire = commentaireAvecMotif(etape.commentaire, g.libelle, saisie.motif, aujourdhui);
      break;
    case "non_applicable":
    case "rouvrir":
      patch.statut = g.vers;
      patch.commentaire = commentaireAvecMotif(etape.commentaire, g.libelle, saisie.motif, aujourdhui);
      break;
    case "changer_balle":
      break;
    case "prochaine_action":
      patch.prochaine_action = texte(saisie.prochaine_action) || null;
      patch.prochaine_action_id = texte(saisie.prochaine_action_id) || null;
      break;
    case "echeance":
      patch.echeance = texte(saisie.echeance) || null;
      if (patch.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(patch.echeance)) erreurs.push("Date d'échéance invalide.");
      break;
    case "confirmer_reprise":
      patch.reprise_a_confirmer = false;
      break;
    default:
      break;
  }
  if (patch.statut && !transitionAutorisee(etape.statut, patch.statut)) erreurs.push("Enchaînement de statut interdit.");
  return erreurs.length ? { patch: null, erreurs } : { patch, erreurs: [] };
}
