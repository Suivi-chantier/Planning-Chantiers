// src/Renovation/reglagesMarges.js — réglages de la marge probable et des
// alertes (étape 2 de la refonte des marges), lus UNE fois pour toute
// l'application : seuils Admin (planning_config.seuils_marges) et dérives
// historiques par type de lot (planning_config.derives_historiques_lots,
// calculées chaque nuit sur les chantiers terminés). Toutes les pages qui
// appellent computeChantierFinance les passent : la marge probable affichée
// est la même partout.
import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { CLE_CONFIG_SEUILS_MARGES, CLE_CONFIG_DERIVES_HISTORIQUES } from "../chantierFinance";

let promesse = null;
let valeur = { seuilsMarges: null, derivesHistoriques: null, derivesCalculeesLe: null, charge: false };
const abonnes = new Set();

export function chargerReglagesMarges({ forcer = false } = {}) {
  if (promesse && !forcer) return promesse;
  promesse = supabase.from("planning_config").select("key,value")
    .in("key", [CLE_CONFIG_SEUILS_MARGES, CLE_CONFIG_DERIVES_HISTORIQUES])
    .then(({ data, error }) => {
      if (error) console.warn("reglagesMarges :", error.message);
      const parCle = Object.fromEntries((data || []).map(r => [r.key, r.value]));
      const hist = parCle[CLE_CONFIG_DERIVES_HISTORIQUES] || null;
      valeur = {
        seuilsMarges: parCle[CLE_CONFIG_SEUILS_MARGES] || null,
        derivesHistoriques: hist?.lots || null,
        derivesCalculeesLe: hist?.calcule_le || null,
        derivesDetail: hist,
        charge: true,
      };
      abonnes.forEach(f => f(valeur));
      return valeur;
    });
  return promesse;
}

// Hook : { seuilsMarges, derivesHistoriques, charge } — se met à jour quand
// un réglage est enregistré (chargerReglagesMarges({ forcer: true })).
export function useReglagesMarges() {
  const [v, setV] = useState(valeur);
  useEffect(() => {
    abonnes.add(setV);
    chargerReglagesMarges().then(setV);
    return () => { abonnes.delete(setV); };
  }, []);
  return v;
}
