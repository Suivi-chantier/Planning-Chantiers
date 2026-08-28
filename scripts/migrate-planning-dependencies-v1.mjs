#!/usr/bin/env node
// Migration des dépendances internes CERTAINES du Planning Model V1.
//
// DRY-RUN PAR DÉFAUT. Aucune écriture sans `--apply`.
// Les propositions viennent exclusivement de planningDependencyInferenceV1.js.
// Les ouvrages composites / review ne sont jamais modifiés automatiquement.
// Avant chaque UPDATE, la ligne complète est sauvegardée dans data_history.

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

const dep = await loadModule("../src/Renovation/planningDependencyInferenceV1.js");
const {
  proposerDependancesOuvrageV1,
  appliquerPropositionDependancesV1,
  CONFIANCE_DEPENDANCE_V1,
} = dep;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("bibliotheque_ratios")
  .select("*")
  .like("identifiant", "ouvrages_v2_%")
  .order("updated_at", { ascending: true });
if (error) throw error;

const tag = `planning-model-v1-safe-dependencies-${new Date().toISOString()}`;
const rapport = {
  mode: APPLY ? "APPLY" : "DRY_RUN",
  ouvrages_v2: data?.length || 0,
  ouvrages_couverts: 0,
  ouvrages_modifies: 0,
  dependances_certaines: 0,
  ouvrages_review: 0,
  details: [],
};

for (const original of data || []) {
  const proposition = proposerDependancesOuvrageV1(original);
  if (proposition.confiance !== CONFIANCE_DEPENDANCE_V1.CERTAIN || !proposition.applicable) {
    rapport.ouvrages_review++;
    continue;
  }

  rapport.ouvrages_couverts++;
  const apres = appliquerPropositionDependancesV1(original, proposition);
  const liens = (proposition.suggestions || []).reduce(
    (n, s) => n + (s.predecesseur_ids?.length || 0), 0
  );
  rapport.dependances_certaines += liens;

  const changed = JSON.stringify(original.sous_taches || []) !== JSON.stringify(apres.sous_taches || []);
  rapport.details.push({
    id: original.id,
    code: proposition.code,
    libelle: original.libelle,
    dependances: liens,
    changed,
  });
  if (!changed) continue;

  rapport.ouvrages_modifies++;
  if (!APPLY) continue;

  const { error: backupError } = await supabase.from("data_history").insert({
    table_name: "bibliotheque_ratios",
    row_id: String(original.id),
    op: "UPDATE",
    chantier_id: null,
    row_data: original,
    changed_by: tag,
    prev_updated_at: original.updated_at || null,
  });
  if (backupError) throw new Error(`Sauvegarde ${original.id}: ${backupError.message}`);

  const { error: updateError } = await supabase
    .from("bibliotheque_ratios")
    .update({ sous_taches: apres.sous_taches })
    .eq("id", original.id);
  if (updateError) throw new Error(`Mise à jour ${original.id}: ${updateError.message}`);
}

console.log(JSON.stringify(rapport, null, 2));
if (!APPLY) {
  console.log("\nDRY-RUN : aucune donnée modifiée. Seules les propositions `certain` seraient appliquées.");
} else {
  console.log(`\nMigration appliquée. Sauvegardes data_history taguées ${tag}.`);
}
