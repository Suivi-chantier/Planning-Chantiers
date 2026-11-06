// Préparer le chantier — chargement EN LECTURE SEULE des phasages des autres
// logements de la même opération (étape « Point de départ »).
// Aucune écriture ici : la copie vers le logement cible passe uniquement par
// les fonctions d'écriture de Phasage V2 (saveMeta), via PreparationChantier.
// Lecture de la table phasages : policy bureau_all (comptes non ouvriers),
// la même que Phasage V2. Un chantier qui porte plusieurs phasages : on
// retient le même que Phasage V2 (choisirPhasage).
import { supabase } from "../supabase";
import { choisirPhasage } from "./phasageRegistre.mjs";

// logements : [{ id, nom }] → [{ chantier_id, nom, meta, ouvrages }]
export async function chargerLogementsSources(logements) {
  const L = (logements || []).filter(l => l && l.id);
  if (!L.length) return { ok: true, sources: [] };
  const { data, error } = await supabase.from("phasages")
    .select("*")
    .in("chantier_id", L.map(l => l.id));
  if (error) return { ok: false, erreur: error.message, sources: [] };
  const sources = L.map(l => {
    const p = choisirPhasage((data || []).filter(x => x.chantier_id === l.id));
    if (!p) return null;
    return { chantier_id: l.id, nom: l.nom || l.id, meta: p.plan_travaux?.meta || {}, ouvrages: Array.isArray(p.ouvrages) ? p.ouvrages : [] };
  }).filter(Boolean);
  return { ok: true, sources };
}
