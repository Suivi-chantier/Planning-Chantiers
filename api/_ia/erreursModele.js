// api/_ia/erreursModele.js — Reconnaître la VRAIE cause d'un échec du modèle.
//
// Pourquoi ce module existe (constat en base, ia_jobs, 07 et 14/09/2026) :
// cinq appels du Copilote Invest ont échoué avec le message Anthropic
//   « Your credit balance is too low to access the Anthropic API »
// et la route les a tous rangés en `erreur_interne`. L'utilisateur voyait
// « Une erreur est survenue côté serveur » : rien qui lui dise que
// l'application fonctionne et que seul le compte IA est à recréditer.
//
// Le cas est reconnu sur le TEXTE du message, et seulement sur lui. Anthropic
// renvoie ce refus en 400 `invalid_request_error`, exactement comme une clé
// mal configurée ou un en-tête manquant (deux autres échecs relevés le
// 24/09/2026). Se fier au code HTTP ou au type d'erreur confondrait les trois.
//
// Générique : valable pour toute tâche (Invest, Rénovation, factures…).

const CODE_CREDIT_EPUISE = "credit_ia_epuise";
const MESSAGE_CREDIT_EPUISE =
  "Service IA indisponible : le crédit du compte IA est épuisé. Prévenez l'administrateur.";

// Formulations connues du refus pour solde insuffisant. Tolérant à la casse
// et aux espaces ; volontairement étroit pour ne rien capter d'autre.
const MOTIFS_CREDIT = [
  /credit\s+balance\s+is\s+too\s+low/i,
];

// Rassemble tous les textes qu'une erreur du SDK peut porter : le message,
// et le corps JSON de la réponse quand le SDK l'a décodé.
function textesDe(erreur) {
  if (erreur == null) return [];
  if (typeof erreur === "string") return [erreur];
  const textes = [];
  if (typeof erreur.message === "string") textes.push(erreur.message);
  const corps = erreur.error;
  if (corps && typeof corps === "object") {
    if (typeof corps.message === "string") textes.push(corps.message);
    if (corps.error && typeof corps.error.message === "string") textes.push(corps.error.message);
  }
  return textes;
}

function estCreditEpuise(erreur) {
  return textesDe(erreur).some((t) => MOTIFS_CREDIT.some((m) => m.test(t)));
}

module.exports = {
  CODE_CREDIT_EPUISE,
  MESSAGE_CREDIT_EPUISE,
  estCreditEpuise,
};
