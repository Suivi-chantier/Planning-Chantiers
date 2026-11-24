// src/Renovation/dateDuJour.js — Date du jour de l'appareil, « AAAA-MM-JJ »
// (projet docs/projets/organisation-par-jour.md).
//
// Seule source de la date du jour pour l'organisation de la semaine
// (navigation, page d'arrivée, tableau de bord). Ce n'est PAS un module pur :
// il lit l'horloge et l'adresse. Le calcul (jour de la semaine, ordre…) reste
// dans organisationJour.mjs, qui reçoit cette date en paramètre.
//
// Date simulée, pour tester un autre jour : ouvrir l'application avec
// « ?date_simulee=AAAA-MM-JJ » dans l'adresse. Elle est lue une fois, au
// chargement de l'application ; une valeur invalide est ignorée.
import { estDateIso } from "./organisationJour.js";

const PARAM_DATE_SIMULEE = "date_simulee";

const DATE_SIMULEE = (() => {
  try {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search || "").get(PARAM_DATE_SIMULEE);
    return estDateIso(v) ? v : null;
  } catch { return null; }
})();

const deux = (n) => String(n).padStart(2, "0");

/** Date du jour en heure locale de l'appareil (ou date simulée), « AAAA-MM-JJ ». */
export function dateDuJour() {
  if (DATE_SIMULEE) return DATE_SIMULEE;
  const d = new Date();
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Vrai si la date du jour est simulée par l'adresse (?date_simulee=…). */
export function dateSimuleeActive() {
  return DATE_SIMULEE !== null;
}
