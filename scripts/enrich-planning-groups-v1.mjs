#!/usr/bin/env node
// Enrichissement des sous-tâches Ouvrages_V2 avec leur groupe d'exécution.
//
// SÉCURITÉ :
// - DRY-RUN par défaut ;
// - `--apply` écrit uniquement les classifications `certain` ;
// - une valeur groupe_type_id déjà présente n'est JAMAIS écrasée ;
// - les classifications `probable` / `review` restent dans le rapport ;
// - les IDs stables et valeurs de dépendance par défaut sont normalisés lors
//   de l'apply afin que l'ouvrage soit prêt pour la suite du Planning Model V1.
//
// Usage :
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/enrich-planning-groups-v1.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/enrich-planning-groups-v1.mjs --apply

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function importSource(relative) {
  const url = new URL(relative, import.meta.url);
  const source = await readFile(url, "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const APPLY = process.argv.includes("--apply");
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  process.exit(2);
}

const model = await importSource("../src/Renovation/planningModelV1.js");
const inference = await importSource("../src/Renovation/planningGroupInferenceV1.js");
const {
  estOuvrageV2, normaliserOuvrageV2, maturiteOuvrageV2,
  codeOuvrageDepuisLibelle, PLANNING_MODEL_VERSION,
} = model;
const { infererGroupeExecutionV1, CONFIANCE_GROUPE_V1 } = inference;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("bibliotheque_ratios")
  .select("id,identifiant,libelle,unite,sous_taches,cadence,materiaux_liens,updated_at")
  .order("libelle", { ascending: true });
if (error) throw error;

const ouvrages = (data || []).filter(estOuvrageV2);
const rapport = {
  planning_model_version: PLANNING_MODEL_VERSION,
  inference_version: 1,
  mode: APPLY ? "APPLY_CERTAIN_ONLY" : "DRY_RUN",
  ouvrages_v2: ouvrages.length,
  sous_taches: 0,
  deja_classees: 0,
  certaines: 0,
  probables: 0,
  a_revoir: 0,
  ouvrages_modifies: 0,
  ouvrages_planifiables_apres: 0,
  ids_ajoutes: 0,
  details_probables: [],
  details_revue: [],
  details_ecrits: [],
};

for (const original of ouvrages) {
  const code = codeOuvrageDepuisLibelle(original.libelle) || null;
  const before = Array.isArray(original.sous_taches) ? original.sous_taches : [];
  const idsAvant = before.filter(st => st?.id).length;
  const normalise = normaliserOuvrageV2(original, { assignIds: true });
  const next = (normalise.sous_taches || []).map((st, i) => {
    rapport.sous_taches++;
    if (st.groupe_type_id) {
      rapport.deja_classees++;
      return st;
    }

    const proposition = infererGroupeExecutionV1({
      code,
      nom: st.nom,
      lotId: st.lotId,
      position: i + 1,
    });
    const detail = {
      ouvrage_id: original.id,
      code,
      position: i + 1,
      nom: st.nom || "",
      lot_id: st.lotId || null,
      groupe_type_id: proposition.groupe_type_id,
      confiance: proposition.confiance,
      regle: proposition.regle,
      raison: proposition.raison,
    };

    if (proposition.confiance === CONFIANCE_GROUPE_V1.CERTAIN) {
      rapport.certaines++;
      if (APPLY && proposition.groupe_type_id) {
        rapport.details_ecrits.push(detail);
        return { ...st, groupe_type_id: proposition.groupe_type_id };
      }
      return st;
    }
    if (proposition.confiance === CONFIANCE_GROUPE_V1.PROBABLE) {
      rapport.probables++;
      rapport.details_probables.push(detail);
      return st;
    }
    rapport.a_revoir++;
    rapport.details_revue.push(detail);
    return st;
  });

  rapport.ids_ajoutes += Math.max(0, next.length - idsAvant);
  const enriched = { ...normalise, sous_taches: next };
  const changedPersisted = JSON.stringify(before) !== JSON.stringify(next);
  if (APPLY && changedPersisted) {
    const { error: updateError } = await supabase
      .from("bibliotheque_ratios")
      .update({ sous_taches: next })
      .eq("id", original.id);
    if (updateError) throw new Error(`${original.id}: ${updateError.message}`);
    rapport.ouvrages_modifies++;
  }

  if (maturiteOuvrageV2(enriched).planifiable) rapport.ouvrages_planifiables_apres++;
}

console.log(JSON.stringify(rapport, null, 2));
if (!APPLY) {
  console.log("\nDRY-RUN : aucune donnée modifiée. --apply écrira uniquement les affectations certaines et les IDs/métadonnées V1.");
} else {
  console.log("\nAPPLY terminé : seules les classifications certaines ont été écrites ; probables/review restent à valider.");
}
