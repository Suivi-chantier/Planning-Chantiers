// scripts/verif-diagramme-financier.mjs — Vérification Point 5 / Prompt 1
//
// Charge chaque chantier réel depuis Supabase, calcule les 3 séries mensuelles
// RÉELLES (src/Renovation/diagrammeFinancier.mjs) et vérifie AU CENTIME que le
// cumul des dépenses au dernier mois retombe sur les totaux de
// src/chantierFinance.mjs (coût MO total + matériaux). Affiche aussi le statut
// d'appariement États financiers (jointure par nom) et les séries obtenues.
//
// Usage :  node scripts/verif-diagramme-financier.mjs [chantier_id]
//   sans argument : vérifie TOUS les phasages de la base.
//
// Lit VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dans .env / ID.env
// (même patron que scripts/verif-chantier-finance.mjs).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeChantierFinance } from "../src/chantierFinance.mjs";
import { seriesReellesChantier, rapprochementEtatsChantiers } from "../src/Renovation/diagrammeFinancier.mjs";

function lireEnv() {
  const env = {};
  for (const f of ["../.env", "../ID.env"]) {
    try {
      for (const line of readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* fichier absent : on continue */ }
  }
  return env;
}

const eur = (n) => `${(Math.round((n ?? 0) * 100) / 100).toLocaleString("fr-FR")} €`;

async function main() {
  const filtreId = process.argv[2] || null;
  const env = lireEnv();
  const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_KEY;
  const supabase = createClient(env.VITE_SUPABASE_URL, supaKey, { auth: { persistSession: false } });

  const [cfgTaux, cfgTauxMO, cfgLots, cfgEtats] = await Promise.all([
    supabase.from("planning_config").select("value").eq("key", "taux_horaires").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "etats_financiers").maybeSingle(),
  ]);
  const tauxHoraires = cfgTaux.data?.value || {};
  const tauxMOPrev = parseFloat(cfgTauxMO.data?.value) || 0;
  const lots = Array.isArray(cfgLots.data?.value?.items) ? cfgLots.data.value.items : [];
  const etatsFinanciers = cfgEtats.data?.value || null;

  let q = supabase.from("phasages").select("*");
  if (filtreId) q = q.eq("chantier_id", filtreId);
  const { data: phasages, error } = await q;
  if (error) { console.error("Chargement phasages :", error.message); process.exit(1); }

  console.log(`Vérification séries réelles (Point 5 / Prompt 1) — ${phasages.length} phasage(s)\n`);

  let ok = 0, ko = 0;
  const stats = { apparies: 0, nonApparies: 0, avecDepensesDatees: 0, sansDepense: 0 };

  for (const ph of phasages) {
    const [pts, cl] = await Promise.all([
      supabase.from("pointages").select("*").eq("chantier_id", ph.chantier_id),
      supabase.from("commande_lignes")
        .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, created_at, commande:commandes(date_doc, created_at, fournisseur_nom)")
        .eq("chantier_id", ph.chantier_id),
    ]);
    const pointages = pts.data || [];
    const commandeLignes = cl.data || [];
    const finance = computeChantierFinance({ phasage: ph, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots });
    const series = seriesReellesChantier({
      finance, pointages, commandeLignes, etatsFinanciers,
      chantierNom: ph.chantier_nom || ph.chantier_id,
    });

    const nom = ph.chantier_nom || ph.chantier_id;
    const dep = series.depenses;

    if (series.appariement.statut === "apparie") stats.apparies++;
    else if (series.appariement.statut === "non_apparie") stats.nonApparies++;

    if (!dep.renseigne) {
      stats.sansDepense++;
      console.log(`  —   ${nom} : dépenses non renseignées (${dep.raison})` +
        ` · États financiers : ${series.appariement.statut}`);
      continue;
    }
    stats.avecDepensesDatees++;

    const c = dep.controle;
    const dernier = dep.points[dep.points.length - 1];
    const statut = c.ok ? "OK " : "ÉCART";
    if (c.ok) ok++; else ko++;

    const rec = series.recettes.renseigne
      ? `${series.recettes.points.length} mois, dernier ${eur(series.recettes.points.at(-1).cumul)}`
      : "non renseignées";
    const val = series.valeurGeneree.renseigne
      ? `${series.valeurGeneree.points.length} mois, dernier ${eur(series.valeurGeneree.points.at(-1).cumul)}`
      : "non renseignée";

    console.log(`  ${statut} ${nom}`);
    console.log(`        dépenses : ${dep.points.length} mois (${dep.points[0].mois} → ${dernier.mois}), cumul ${eur(dernier.cumul)}`);
    console.log(`        contrôle : MO série ${eur(c.moSerie)} vs module ${eur(c.moModule)} (écart ${c.ecartMO.toFixed(4)}) · mat série ${eur(c.matSerie)} vs module ${eur(c.matModule)} (écart ${c.ecartMat.toFixed(4)})`);
    const sd = dep.sansDate;
    const totalSD = sd.reprise + sd.moLegacy + sd.pointagesNonDates + sd.materiauxNonDates;
    if (totalSD > 0.005) {
      console.log(`        sans date (posé au 1er mois) : reprise ${eur(sd.reprise)} · MO legacy ${eur(sd.moLegacy)} · pointages non datés ${eur(sd.pointagesNonDates)} · matériaux ${eur(sd.materiauxNonDates)}`);
    }
    console.log(`        états financiers : ${series.appariement.statut} (${series.appariement.lignes.length} ligne(s)) · recettes : ${rec} · valeur générée : ${val}`);
    if (!c.ok) {
      console.log(`        ⚠️  ÉCART AU CENTIME — à investiguer.`);
    }
  }

  // Rapprochement global : lignes d'États financiers orphelines.
  const rapp = rapprochementEtatsChantiers(etatsFinanciers, phasages.map(p => ({ id: p.chantier_id, nom: p.chantier_nom })));
  console.log(`\nRapprochement États financiers ↔ phasages : ${rapp.nbLignes} ligne(s) d'états, ${rapp.nbChantiers} chantier(s).`);
  if (rapp.lignesNonAppariees.length > 0) {
    console.log(`  Lignes d'États financiers sans chantier correspondant (${rapp.lignesNonAppariees.length}) :`);
    rapp.lignesNonAppariees.forEach(l => console.log(`    - ${l.nom}${l.devis ? ` (${l.devis})` : ""}`));
  }
  if (rapp.chantiersSansLigne.length > 0) {
    console.log(`  Chantiers sans ligne d'États financiers (${rapp.chantiersSansLigne.length}) :`);
    rapp.chantiersSansLigne.forEach(c => console.log(`    - ${c.nom || c.id}`));
  }

  console.log(`\nRésultat : ${ok} chantier(s) cohérent(s) au centime, ${ko} écart(s).`);
  console.log(`Couverture : ${stats.avecDepensesDatees} avec dépenses datées, ${stats.sansDepense} sans dépense, ${stats.apparies} apparié(s) aux États financiers, ${stats.nonApparies} non apparié(s).`);
  process.exit(ko > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
