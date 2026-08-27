#!/usr/bin/env node
// Migration additive du référentiel Ouvrages_V2 vers Planning Model V1.
//
// SÉCURITÉ : DRY-RUN PAR DÉFAUT. Aucune écriture sans `--apply`.
// Cette première migration ne devine PAS les groupes d'exécution : elle ajoute
// uniquement les identités stables, le code ouvrage et les valeurs par défaut
// de dépendance. Les groupe_type_id sont ensuite enrichis/validés séparément.
//
// Usage :
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-planning-model-v1.mjs
//   ... node scripts/migrate-planning-model-v1.mjs --apply

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function loadPlanningModel() {
  const url = new URL("../src/Renovation/planningModelV1.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(dataUrl);
}

const APPLY = process.argv.includes("--apply");
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  process.exit(2);
}

const {
  estOuvrageV2,
  normaliserOuvrageV2,
  maturiteOuvrageV2,
  PLANNING_MODEL_VERSION,
} = await loadPlanningModel();

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("bibliotheque_ratios")
  .select("id,identifiant,libelle,unite,sous_taches,cadence,materiaux_liens,updated_at")
  .order("updated_at", { ascending: true });
if (error) throw error;

const ouvrages = (data || []).filter(estOuvrageV2);
const rapport = {
  model_version: PLANNING_MODEL_VERSION,
  mode: APPLY ? "APPLY" : "DRY_RUN",
  ouvrages_v2: ouvrages.length,
  modifies: 0,
  sous_taches: 0,
  ids_a_ajouter: 0,
  groupes_manquants: 0,
  taches_vides: 0,
  ratios_invalides: 0,
  planifiables_apres_etape: 0,
  details: [],
};

for (const original of ouvrages) {
  const before = Array.isArray(original.sous_taches) ? original.sous_taches : [];
  const idsAvant = before.filter(st => st?.id).length;
  const normalise = normaliserOuvrageV2(original, { assignIds: true });
  const sts = normalise.sous_taches || [];
  const maturite = maturiteOuvrageV2(normalise);

  rapport.sous_taches += sts.length;
  rapport.ids_a_ajouter += Math.max(0, sts.length - idsAvant);
  rapport.groupes_manquants += sts.filter(st => !st.groupe_type_id).length;
  rapport.taches_vides += sts.filter(st => !String(st.nom || "").trim()).length;
  if (maturite.erreurs.some(e => e.startsWith("Somme des ratios"))) rapport.ratios_invalides++;
  if (maturite.planifiable) rapport.planifiables_apres_etape++;

  const changed = JSON.stringify({
    code_ouvrage: original.code_ouvrage || null,
    planning_model_version: original.planning_model_version || null,
    sous_taches: before,
  }) !== JSON.stringify({
    code_ouvrage: normalise.code_ouvrage || null,
    planning_model_version: normalise.planning_model_version || null,
    sous_taches: sts,
  });

  if (changed) {
    rapport.modifies++;
    rapport.details.push({
      id: original.id,
      code: normalise.code_ouvrage,
      libelle: original.libelle,
      sous_taches: sts.length,
      ids_ajoutes: Math.max(0, sts.length - idsAvant),
      groupes_manquants: sts.filter(st => !st.groupe_type_id).length,
      erreurs: maturite.erreurs,
      warnings: maturite.warnings,
    });
  }

  if (APPLY && changed) {
    // IMPORTANT : bibliotheque_ratios n'a pas de colonnes code_ouvrage / version.
    // Ces métadonnées sont donc stockées dans chaque sous-tâche et le code est
    // toujours redétectable depuis le libellé. On n'altère pas le schéma SQL ici.
    // La migration additive persistée porte uniquement sur `sous_taches`.
    const { error: updateError } = await supabase
      .from("bibliotheque_ratios")
      .update({ sous_taches: sts })
      .eq("id", original.id);
    if (updateError) throw new Error(`${original.id}: ${updateError.message}`);
  }
}

console.log(JSON.stringify(rapport, null, 2));
if (!APPLY) {
  console.log("\nDRY-RUN uniquement : aucune donnée n'a été modifiée. Relire le rapport avant --apply.");
} else {
  console.log("\nMigration IDs/métadonnées de sous-tâches appliquée. Les groupe_type_id restent à valider séparément.");
}
