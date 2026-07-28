// scripts/verif-chantier-finance.mjs — Vérification étape 0b
//
// Charge chaque chantier réel depuis Supabase et compare, AU CENTIME :
//   • les valeurs du module src/chantierFinance.mjs
//   • une transcription VERBATIM des formules inline de PhasageV2.jsx
//     (copiées ligne à ligne ci-dessous, indépendantes du module)
//
// Usage :  node scripts/verif-chantier-finance.mjs [chantier_id]
//   sans argument : vérifie TOUS les phasages de la base.
//
// Lit VITE_SUPABASE_URL / VITE_SUPABASE_KEY dans .env (aucune dépendance
// autre que @supabase/supabase-js, déjà dans le projet).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeChantierFinance } from "../src/chantierFinance.mjs";

// ── .env ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// RÉFÉRENCE : transcription verbatim des formules de PhasageV2.jsx
// (ne PAS factoriser avec le module — c'est justement ce qu'on teste)
// ─────────────────────────────────────────────────────────────────────────────
const TAUX_MO_PREV_DEFAUT_REF = 25; // src/constants.js L147

function indexPointagesParTacheRef(points) { // src/pointages.js L82
  const m = {};
  (points || []).forEach(p => {
    if (p.type_pointage === "indirect") return;
    if (!p.tache_id) return;
    const k = String(p.tache_id);
    if (!m[k]) m[k] = [];
    m[k].push(p);
  });
  return m;
}

function sumLibreEtIndirectRef(points) { // src/pointages.js L121
  let heuresLibre = 0, coutLibre = 0, heuresIndirect = 0, coutIndirect = 0;
  (points || []).forEach(p => {
    const h = parseFloat(p.heures) || 0;
    const c = h * (parseFloat(p.taux_horaire) || 0);
    if (p.type_pointage === "indirect") { heuresIndirect += h; coutIndirect += c; }
    else if (!p.tache_id) { heuresLibre += h; coutLibre += c; }
  });
  return { heuresLibre, coutLibre, heuresIndirect, coutIndirect };
}

export function referencePhasageV2({ phasage, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots }) {
  const ouvrages = phasage?.ouvrages || [];                       // PhasageV2 L599
  const pointagesParTache = indexPointagesParTacheRef(pointages); // L577

  const tachePointages = (t) => pointagesParTache[String(t.id)] || []; // L865
  const tacheHeuresReelles = (t) => {                             // L866
    const pts = tachePointages(t);
    if (pts.length > 0) return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
    if (Array.isArray(t.heures_reelles)) {
      return t.heures_reelles.reduce((s, v) => s + (parseFloat(v) || 0), 0);
    }
    return parseFloat(t.heures_reelles) || 0;
  };
  const heuresReellesOuvrage = (o) => (o.taches || []).reduce((s, t) => s + tacheHeuresReelles(t), 0); // L886
  const heuresVenduesOuvrage = (o) => parseFloat(o.heures_devis) || 0;                                 // L887

  const coutMOTache = (t) => {                                    // L901
    const pts = tachePointages(t);
    if (pts.length > 0) {
      return pts.reduce((s, p) => s + (parseFloat(p.heures) || 0) * (parseFloat(p.taux_horaire) || 0), 0);
    }
    const hr = tacheHeuresReelles(t);
    if (hr === 0) return 0;
    const ouvs = Array.isArray(t.ouvriers) ? t.ouvriers.filter(Boolean) : [];
    if (ouvs.length === 0) return 0;
    return ouvs.reduce((s, nom) => s + hr * (parseFloat(tauxHoraires?.[nom]) || 0), 0);
  };
  const coutMOOuvrage  = (o) => (o.taches || []).reduce((s, t) => s + coutMOTache(t), 0); // L928
  const coutMOChantier = ouvrages.reduce((s, o) => s + coutMOOuvrage(o), 0);              // L930

  const prixHTOuvrage  = (o) => parseFloat(o.prix_ht) || 0;                               // L933
  const prixHTChantier = ouvrages.reduce((s, o) => s + prixHTOuvrage(o), 0);              // L935

  const coutMatOuvrage = (o) => parseFloat(o.cout_materiaux) || 0;                        // L939
  const totalLignes = (lignes) => lignes.reduce(                                          // L941
    (s, l) => s + (parseFloat(l.prix_total) || ((parseFloat(l.prix_unitaire) || 0) * (parseFloat(l.quantite) || 0)) || 0), 0);
  const coutMatChantier = totalLignes(commandeLignes);                                    // L946

  const heuresVenduesChantier = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);  // L949
  const heuresReellesChantier = ouvrages.reduce((s, o) => s + (o.taches || []).reduce((ss, t) => ss + tacheHeuresReelles(t), 0), 0); // L950

  const extras = sumLibreEtIndirectRef(pointages);                                        // L954
  const repriseHeures = parseFloat(phasage?.plan_travaux?.meta?.reprise_heures) || 0;     // L960
  const repriseTaux   = parseFloat(phasage?.plan_travaux?.meta?.reprise_taux)   || 0;     // L961
  const repriseCout   = repriseHeures * repriseTaux;                                      // L962

  const coutMOTotalChantier =                                                             // L975
    coutMOChantier + extras.coutLibre + extras.coutIndirect + repriseCout;
  const heuresReellesTotalChantier =                                                      // L977
    heuresReellesChantier + extras.heuresLibre + extras.heuresIndirect + repriseHeures;

  let trajetHeures = 0, trajetCout = 0;                                                   // L982
  pointages.forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (!/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    trajetHeures += h; trajetCout += h * (parseFloat(p.taux_horaire) || 0);
  });
  let indirectHeures = 0, indirectCout = 0;                                               // L993
  pointages.forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    indirectHeures += h; indirectCout += h * (parseFloat(p.taux_horaire) || 0);
  });

  const tauxMOPrevEff = tauxMOPrev > 0 ? tauxMOPrev : TAUX_MO_PREV_DEFAUT_REF;            // L1045
  const moPrevChantier = heuresVenduesChantier * tauxMOPrevEff;                           // L1046
  const commandesPrevChantier = ouvrages.reduce((s, o) => s + coutMatOuvrage(o), 0);      // L1051
  const fgTauxHoraire = (() => {                                                          // L1056
    const v = parseFloat(phasage?.plan_travaux?.meta?.fg_taux_horaire);
    return Number.isFinite(v) ? v : 0;
  })();
  const fgChantier = fgTauxHoraire * heuresReellesTotalChantier;                          // L1060
  const margeChantier  = prixHTChantier - coutMOTotalChantier - coutMatChantier - fgChantier; // L1062
  const margePctChantier = prixHTChantier > 0 ? (margeChantier / prixHTChantier) * 100 : 0;   // L1063

  const avancementOuvrage = (ouvrage) => {                                                // L1413
    const taches = ouvrage.taches || [];
    if (taches.length === 0) return 0;
    const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
    if (totalHE > 0) {
      return Math.round(
        taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0), 0) / totalHE
      );
    }
    return Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length);
  };
  const ouvragesDuLot = (lotId) => lotId === "_orphans"                                   // L1476
    ? ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id))
    : ouvrages.filter(o => o.lot_id === lotId);
  const avancementLot = (lotId) => {                                                      // L1479
    const lotOuvrages = ouvragesDuLot(lotId);
    if (lotOuvrages.length === 0) return 0;
    const totalPrix = lotOuvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      return Math.round(
        lotOuvrages.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
      );
    }
    return Math.round(lotOuvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / lotOuvrages.length);
  };
  const avancementChantier = (() => {                                                     // L1493
    if (ouvrages.length === 0) return 0;
    const totalPrix = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      return Math.round(
        ouvrages.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
      );
    }
    return Math.round(ouvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / ouvrages.length);
  })();

  const lotsRef = lots.map(l => {
    const lo = ouvragesDuLot(l.id);
    return {
      id: l.id,
      nbOuvrages: lo.length,
      heuresVendues: lo.reduce((s, o) => s + heuresVenduesOuvrage(o), 0),  // L889
      heuresReelles: lo.reduce((s, o) => s + heuresReellesOuvrage(o), 0),  // L888
      avancement: lo.length > 0 ? avancementLot(l.id) : 0,                 // L2633
    };
  });

  return {
    prixHTChantier, heuresVenduesChantier, heuresReellesChantier, heuresReellesTotalChantier,
    coutMOChantier, coutMOTotalChantier, coutMatChantier, commandesPrevChantier,
    moPrevChantier, tauxMOPrevEff, fgTauxHoraire, fgChantier, margeChantier, margePctChantier,
    avancementChantier, trajetHeures, trajetCout, indirectHeures, indirectCout,
    extras, repriseHeures, repriseCout, lots: lotsRef,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparaison
// ─────────────────────────────────────────────────────────────────────────────
const EPS = 0.005; // au centime

function comparer(chantierId, nom, ref, mod) {
  const b = mod.brut;
  const checks = [
    ["Vendu HT",            ref.prixHTChantier,            b.prixHTChantier],
    ["Heures vendues",      ref.heuresVenduesChantier,     b.heuresVenduesChantier],
    ["Heures réelles (tâches)", ref.heuresReellesChantier, b.heuresReellesChantier],
    ["Heures réelles TOTAL", ref.heuresReellesTotalChantier, b.heuresReellesTotalChantier],
    ["Coût MO (tâches)",    ref.coutMOChantier,            b.coutMOChantier],
    ["Coût MO TOTAL",       ref.coutMOTotalChantier,       b.coutMOTotalChantier],
    ["Matériaux réel",      ref.coutMatChantier,           b.coutMatChantier],
    ["Commandes prév.",     ref.commandesPrevChantier,     b.commandesPrevChantier],
    ["MO prév.",            ref.moPrevChantier,            b.moPrevChantier],
    ["Taux MO prév. eff.",  ref.tauxMOPrevEff,             b.tauxMOPrevEff],
    ["FG taux horaire",     ref.fgTauxHoraire,             b.fgTauxHoraire],
    ["Frais généraux",      ref.fgChantier,                b.fgChantier],
    ["Marge nette",         ref.margeChantier,             b.margeChantier],
    ["Marge %",             ref.margePctChantier,          b.margePctChantier],
    ["Avancement",          ref.avancementChantier,        b.avancementChantier],
    ["Trajets heures",      ref.trajetHeures,              b.trajetHeures],
    ["Trajets coût",        ref.trajetCout,                b.trajetCout],
    ["Indirect heures",     ref.indirectHeures,            b.indirectHeures],
    ["Indirect coût",       ref.indirectCout,              b.indirectCout],
    ["Reprise heures",      ref.repriseHeures,             b.repriseHeures],
    ["Reprise coût",        ref.repriseCout,               b.repriseCout],
  ];
  // Lots (le module ajoute "_orphans" en plus — on compare les lots configurés)
  ref.lots.forEach(lr => {
    const lm = mod.lots.find(l => l.id === lr.id);
    checks.push(
      [`Lot ${lr.id} · hV`, lr.heuresVendues, lm?.heuresVendues],
      [`Lot ${lr.id} · hR`, lr.heuresReelles, lm?.heuresReelles],
      [`Lot ${lr.id} · av`, lr.avancement,    lm?.avancement],
      [`Lot ${lr.id} · nb`, lr.nbOuvrages,    lm?.nbOuvrages],
    );
  });

  const ecarts = checks.filter(([, a, c]) => !(Math.abs((a ?? NaN) - (c ?? NaN)) <= EPS || (a == null && c == null)));
  const fmt = (v) => v == null ? "null" : (Math.round(v * 100) / 100).toLocaleString("fr-FR");
  if (ecarts.length === 0) {
    console.log(`  OK  ${nom || chantierId} — ${checks.length} valeurs identiques (marge ${fmt(ref.margeChantier)} €, avancement ${ref.avancementChantier}%)`);
    return true;
  }
  console.log(`  ÉCART  ${nom || chantierId} :`);
  for (const [label, a, c] of ecarts) {
    console.log(`     ${label.padEnd(26)} référence=${fmt(a).padStart(14)}  module=${fmt(c).padStart(14)}`);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const filtreId = process.argv[2] || null;
  const env = lireEnv();
  // La clé anonyme ne passe pas la RLS (bureau_all → authenticated) : il faut
  // SUPABASE_SERVICE_ROLE_KEY (dans ID.env, jamais commitée) pour lire les
  // chantiers réels depuis un poste local.
  const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_KEY;
  const supabase = createClient(env.VITE_SUPABASE_URL, supaKey, { auth: { persistSession: false } });

  const [cfgTaux, cfgTauxMO, cfgLots] = await Promise.all([
    supabase.from("planning_config").select("value").eq("key", "taux_horaires").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
  ]);
  const tauxHoraires = cfgTaux.data?.value || {};
  const tauxMOPrev = parseFloat(cfgTauxMO.data?.value) || 0;
  const itemsLots = cfgLots.data?.value?.items;
  const LOTS_DEFAUT = [ // src/constants.js L476 (repli si pas de config)
    { id: "demolition", label: "Démolition", couleur: "#e05c5c", code_prefixe: "D" },
    { id: "maconnerie", label: "Maçonnerie", couleur: "#a8a29e", code_prefixe: "M" },
    { id: "electricite", label: "Électricité", couleur: "#eab308", code_prefixe: "E" },
    { id: "plomberie", label: "Plomberie sanitaire", couleur: "#06b6d4", code_prefixe: "P" },
    { id: "murs_cloison", label: "Murs cloison doublages", couleur: "#6366f1", code_prefixe: "MC" },
    { id: "menuiserie", label: "Menuiserie", couleur: "#b45309", code_prefixe: "ME" },
    { id: "ouvertures", label: "Ouvertures", couleur: "#8b5cf6", code_prefixe: "O" },
    { id: "finitions_gen", label: "Finitions générales", couleur: "#a78bfa", code_prefixe: "FG" },
  ];
  const lots = Array.isArray(itemsLots) && itemsLots.length > 0
    ? itemsLots.map((l, i) => ({
        id: l.id || `lot_${i}`, label: l.label || `Lot ${i + 1}`,
        couleur: l.couleur || l.color || "#888888", code_prefixe: l.code_prefixe || "",
      }))
    : LOTS_DEFAUT;

  let q = supabase.from("phasages").select("*");
  if (filtreId) q = q.eq("chantier_id", filtreId);
  const { data: phasages, error } = await q;
  if (error) { console.error("Chargement phasages :", error.message); process.exit(1); }

  console.log(`Vérification module vs référence PhasageV2 — ${phasages.length} phasage(s), taux MO prév. = ${tauxMOPrev || "(défaut)"}\n`);

  let ok = 0, ko = 0, testes = 0;
  const stats = { avecPointages: 0, legacySansPointage: 0, avecReprise: 0 };

  for (const ph of phasages) {
    const [pts, cl] = await Promise.all([
      supabase.from("pointages").select("*").eq("chantier_id", ph.chantier_id),
      supabase.from("commande_lignes")
        .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, commande:commandes(statut_completude, statut_facturation, fournisseur_nom, doc_numero)")
        .eq("chantier_id", ph.chantier_id),
    ]);
    const pointages = pts.data || [];
    const commandeLignes = cl.data || [];
    const inputs = { phasage: ph, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots };

    const ref = referencePhasageV2(inputs);
    const mod = computeChantierFinance(inputs);
    testes++;
    if (pointages.length > 0) stats.avecPointages++;
    else if ((ph.ouvrages || []).length > 0) stats.legacySansPointage++;
    if (ref.repriseHeures > 0) stats.avecReprise++;

    if (comparer(ph.chantier_id, ph.chantier_nom, ref, mod)) ok++; else ko++;
  }

  console.log(`\nRésultat : ${ok}/${testes} identiques au centime, ${ko} écart(s).`);
  console.log(`Couverture : ${stats.avecPointages} avec pointages, ${stats.legacySansPointage} legacy sans pointage, ${stats.avecReprise} avec reprise d'heures.`);
  process.exit(ko > 0 ? 1 : 0);
}

// N'exécute la comparaison que lancé directement (le banc de test fixtures
// importe referencePhasageV2 sans déclencher les requêtes réseau).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
