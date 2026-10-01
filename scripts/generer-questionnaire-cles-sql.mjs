#!/usr/bin/env node
// Génère, à partir du catalogue src/Invest/dossiers/questionnaireDossier.mjs,
// la fonction SQL invest_questionnaire_cles(version) : liste des clés
// autorisées pour chaque version du questionnaire « Projet & situation ».
// Sortie déterministe (clés triées). Le bloc produit est recopié tel quel dans
// la migration ; scripts/verif-invest-dossiers-t1.mjs vérifie l'identité.
//   node scripts/generer-questionnaire-cles-sql.mjs
import { CLES_PAR_VERSION } from "../src/Invest/dossiers/questionnaireDossier.mjs";

export function sqlClesQuestionnaire() {
  const branches = Object.entries(CLES_PAR_VERSION)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([v, cles]) => `    when ${Number(v)} then array[\n${cles.map((k) => `      '${k}'`).join(",\n")}\n    ]::text[]`)
    .join("\n");
  return [
    "-- GÉNÉRÉ par scripts/generer-questionnaire-cles-sql.mjs depuis questionnaireDossier.mjs — ne pas modifier à la main.",
    "create or replace function public.invest_questionnaire_cles(p_version integer)",
    "returns text[] language sql immutable set search_path = '' as $$",
    "  select case p_version",
    branches,
    "    else null end;",
    "$$;",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(sqlClesQuestionnaire());
