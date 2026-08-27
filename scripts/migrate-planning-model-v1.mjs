#!/usr/bin/env node
// Migration additive du référentiel Ouvrages_V2 vers Planning Model V1.
//
// SÉCURITÉ : DRY-RUN PAR DÉFAUT. Aucune écriture sans `--apply`.
// - ajoute les identifiants stables et métadonnées de dépendance ;
// - conserve tout groupe déjà renseigné manuellement ;
// - écrit automatiquement uniquement les groupes d'exécution classés `certain` ;
// - laisse les `probable` et `review` à la validation humaine ;
// - sauvegarde chaque ligne modifiée dans `data_history` avant écriture.
//
// Usage :
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-planning-model-v1.mjs
//   ... node scripts/migrate-planning-model-v1.mjs --apply

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
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

const planning = await loadModule("../src/Renovation/planningModelV1.js");
const inference = await loadModule("../src/Renovation/planningGroupInferenceV1.js");
const {
  estOuvrageV2,
  normaliserOuvrageV2,
  maturiteOuvrageV2,
  PLANNING_MODEL_VERSION,
} = planning;
const { infererGroupeExecutionV1, CONFIANCE_GROUPE_V1 } = inference;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("bibliotheque_ratios")
  .select("*")
  .order("updated_at", { ascending: true });
if (error) throw error;

const ouvrages = (data || []).filter(estOuvrageV2);
const migrationTag = `planning-model-v1-${new Date().toISOString()}`;
const rapport = {
  model_version: PLANNING_MODEL_VERSION,
  mode: APPLY ? "APPLY" : "DRY_RUN",
  ouvrages_v2: ouvrages.length,
  ouvrages_modifies: 0,
  sous_taches: 0,
  ids_a_ajouter: 0,
  groupes_certains_a_ecrire: 0,
  groupes_probables: 0,
  groupes_a_revoir: 0,
  groupes_manquants_apres: 0,
  taches_vides: 0,
  ratios_invalides: 0,
  planifiables_apres_etape: 0,
  details: [],
};

for (const original of ouvrages) {
  const before = Array.isArray(original.sous_taches) ? original.sous_taches : [];
  const idsAvant = before.filter(st => st?.id).length;
  let normalise = normaliserOuvrageV2(original, { assignIds: true });
  const code = normalise.code_ouvrage;

  const decisions = [];
  normalise = {
    ...normalise,
    sous_taches: (normalise.sous_taches || []).map((st, idx) => {
      if (st.groupe_type_id) return st;
      const decision = infererGroupeExecutionV1({
        code,
        nom: st.nom,
        lotId: st.lotId,
        position: idx + 1,
      });
      decisions.push({ position: idx + 1, nom: st.nom, ...decision });
      if (decision.confiance === CONFIANCE_GROUPE_V1.CERTAIN && decision.groupe_type_id) {
        rapport.groupes_certains_a_ecrire++;
        return { ...st, groupe_type_id: decision.groupe_type_id };
      }
      if (decision.confiance === CONFIANCE_GROUPE_V1.PROBABLE) rapport.groupes_probables++;
      else rapport.groupes_a_revoir++;
      return st;
    }),
  };

  const sts = normalise.sous_taches || [];
  const maturite = maturiteOuvrageV2(normalise);
  rapport.sous_taches += sts.length;
  rapport.ids_a_ajouter += Math.max(0, sts.length - idsAvant);
  rapport.groupes_manquants_apres += sts.filter(st => !st.groupe_type_id).length;
  rapport.taches_vides += sts.filter(st => !String(st.nom || "").trim()).length;
  if (maturite.erreurs.some(e => e.startsWith("Somme des ratios"))) rapport.ratios_invalides++;
  if (maturite.planifiable) rapport.planifiables_apres_etape++;

  const changed = JSON.stringify(before) !== JSON.stringify(sts);
  if (!changed) continue;

  rapport.ouvrages_modifies++;
  rapport.details.push({
    id: original.id,
    code,
    libelle: original.libelle,
    sous_taches: sts.length,
    ids_ajoutes: Math.max(0, sts.length - idsAvant),
    groupes_manquants: sts.filter(st => !st.groupe_type_id).length,
    decisions_a_valider: decisions.filter(d => d.confiance !== CONFIANCE_GROUPE_V1.CERTAIN),
    erreurs: maturite.erreurs,
    warnings: maturite.warnings,
  });

  if (APPLY) {
    const { error: backupError } = await supabase.from("data_history").insert({
      table_name: "bibliotheque_ratios",
      row_id: String(original.id),
      op: "UPDATE",
      chantier_id: null,
      row_data: original,
      changed_by: migrationTag,
      prev_updated_at: original.updated_at || null,
    });
    if (backupError) throw new Error(`Sauvegarde ${original.id}: ${backupError.message}`);

    const { error: updateError } = await supabase
      .from("bibliotheque_ratios")
      .update({ sous_taches: sts })
      .eq("id", original.id);
    if (updateError) throw new Error(`Mise à jour ${original.id}: ${updateError.message}`);
  }
}

console.log(JSON.stringify(rapport, null, 2));
if (!APPLY) {
  console.log("\nDRY-RUN : aucune donnée modifiée. Seuls les groupes `certain` seraient écrits avec --apply.");
} else {
  console.log(`\nMigration appliquée. Sauvegardes data_history taguées ${migrationTag}.`);
}
