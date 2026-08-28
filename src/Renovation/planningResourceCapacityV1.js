import { capaciteJour, getISOWeek } from "../rythmeSemaine";
import { calculerCapaciteRessource } from "./planningResourceModelV1";

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export function jourPlanningDepuisDate(dateISO) {
  const d = new Date(`${String(dateISO || "").slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return JOURS[d.getDay()] || null;
}

export function capaciteBasePlanningPourDate(dateISO) {
  const jour = jourPlanningDepuisDate(dateISO);
  if (!jour || jour === "Samedi" || jour === "Dimanche") return 0;
  const { year, week } = getISOWeek(String(dateISO).slice(0, 10));
  return capaciteJour(jour, year, week);
}

// Point d'entrée du futur moteur : la capacité hebdomadaire reste entièrement
// dans rythmeSemaine ; le modèle Ressources ne fait qu'appliquer les exceptions
// et retrancher les allocations déjà posées.
export function calculerCapaciteRessourcePourDate({
  resource,
  dateISO,
  evenements = [],
  heuresDejaAllouees = 0,
} = {}) {
  const capaciteBase = capaciteBasePlanningPourDate(dateISO);
  return calculerCapaciteRessource({
    resource,
    dateISO,
    capaciteBase,
    evenements,
    heuresDejaAllouees,
  });
}
