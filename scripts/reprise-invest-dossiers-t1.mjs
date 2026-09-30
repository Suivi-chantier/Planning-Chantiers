#!/usr/bin/env node
// Reprise de l'existant en Dossiers Invest (Chantier 1.1, Tranche 1).
//
// Ce script NE SE CONNECTE À AUCUNE BASE. Il lit un export JSON, calcule le
// plan (src/Invest/dossiers/repriseDossiers.mjs) et écrit :
//   - <sortie>/rapport-reprise-t1.md   rapport à relire (cas ambigus compris) ;
//   - <sortie>/reprise-t1.sql          SQL rejouable, à appliquer SÉPARÉMENT,
//                                      après la migration 20260930190000.
//
//   node scripts/reprise-invest-dossiers-t1.mjs --requete        # affiche la requête d'export (lecture seule)
//   node scripts/reprise-invest-dossiers-t1.mjs --export export.json --sortie ./reprise
//
// L'export se produit en lecture seule, par exemple :
//   npx supabase db query --linked "$(node scripts/reprise-invest-dossiers-t1.mjs --requete)" > export.json
// (le fichier doit contenir l'objet { clients, actions, prospects, utilisateurs, dossiers }).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planifierReprise, rapportReprise, sqlReprise } from "../src/Invest/dossiers/repriseDossiers.mjs";

/** UUID déterministe (format v5, SHA-1) : rejouer la reprise donne les mêmes identifiants. */
export function uuidDepuis(texte) {
  const h = createHash("sha1").update(`profero-invest:${texte}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export const REQUETE_EXPORT = `select jsonb_build_object(
  'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'prenom', prenom, 'statut', statut,
     'etape', etape, 'date_signature', date_signature, 'conseiller', conseiller,
     'prochaine_action', prochaine_action, 'date_prochaine_action', date_prochaine_action)), '[]') from public.invest_clients),
  'actions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'step_key', step_key,
     'action_title', action_title, 'status', status, 'responsable', responsable, 'responsable_email', responsable_email,
     'dossier_id', dossier_id, 'etape', etape, 'responsable_id', responsable_id)), '[]') from public.invest_mission_actions),
  'prospects', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'converted_client_id', converted_client_id)), '[]')
     from public.invest_prospects where converted_client_id is not null),
  'utilisateurs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'email', email, 'actif', actif)), '[]')
     from public.utilisateurs),
  'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id)), '[]') from public.invest_dossiers)
) as export;`;

function lireExport(chemin) {
  const brut = JSON.parse(readFileSync(chemin, "utf8"));
  // Accepte l'objet nu, ou la sortie tabulaire d'un outil ([{ export: {...} }]).
  const obj = Array.isArray(brut) ? (brut[0]?.export ?? brut[0]) : (brut.export ?? brut);
  for (const cle of ["clients", "actions", "prospects", "utilisateurs"]) {
    if (!Array.isArray(obj?.[cle])) throw new Error(`Export incomplet : « ${cle} » manquant.`);
  }
  return { dossiers: [], ...obj };
}

const estPrincipal = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (estPrincipal) {
  const args = process.argv.slice(2);
  const val = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes("--requete")) {
    process.stdout.write(REQUETE_EXPORT + "\n");
  } else {
    const exportPath = val("--export");
    const sortie = val("--sortie");
    if (!exportPath || !sortie) {
      console.error("Usage : --requete | --export <fichier.json> --sortie <dossier>");
      process.exit(2);
    }
    const plan = planifierReprise(lireExport(exportPath), { uuidDepuis });
    mkdirSync(sortie, { recursive: true });
    writeFileSync(join(sortie, "rapport-reprise-t1.md"), rapportReprise(plan));
    writeFileSync(join(sortie, "reprise-t1.sql"), sqlReprise(plan));
    console.log(JSON.stringify(plan.stats, null, 2));
    console.log(`Écrit : ${join(sortie, "rapport-reprise-t1.md")} et ${join(sortie, "reprise-t1.sql")} (non appliqué).`);
  }
}
