#!/usr/bin/env node
// Vérifie les colonnes INFORMATIVES ajoutées à l'onglet « Avancement chantier »
// des États financiers :
//   1. les règles pures de src/Renovation/avancementDonneesLiees.mjs ;
//   2. par analyse statique, que l'écran se contente de LIRE — pas d'écriture
//      dans les deux tables, pas de colonne hors périmètre, pas de `phasages`,
//      et surtout aucune contamination de la saisie du comptable.
//
// Aucun réseau, aucune base, aucune migration, aucun déploiement.
//   node scripts/verif-etats-financiers-donnees-liees.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const {
  SANS_DONNEE, donneesLieesLigne, formaterDateFr,
  indexerSituations, indexerSnapshots, infobulleFacture, infobulleTerrain,
} = await import(new URL("../src/Renovation/avancementDonneesLiees.mjs", import.meta.url).href);

const ECRAN = lire("src/Renovation/EtatsFinanciers.jsx");

// Fabriques courtes : seules les colonnes réellement lues sont présentes.
const snap = (o) => ({ chantier_id: "lamartine", week_id: "2026-W38", date_snapshot: "2026-09-18", avancement: 64, ...o });
const situ = (o) => ({ chantier_id: "lamartine", date_facture: "2026-09-10", progbat_situation_number: 3, progbat_achievement: 120000, progbat_deal_net_total: 200000, ...o });

// ═══════════════════════════════════════════════════════════════════════════
// 1. TERRAIN — dernier snapshot hebdomadaire
// ═══════════════════════════════════════════════════════════════════════════

test("terrain : l'avancement reste en pourcentage 0-100, jamais converti", () => {
  const i = indexerSnapshots([snap({ avancement: 64 })]);
  assert.equal(i.get("lamartine").pct, 64);
});

test("terrain : c'est le snapshot le plus récent qui gagne, quel que soit l'ordre reçu", () => {
  const ancien = snap({ date_snapshot: "2026-08-01", avancement: 20 });
  const recent = snap({ date_snapshot: "2026-09-18", avancement: 64 });
  assert.equal(indexerSnapshots([ancien, recent]).get("lamartine").pct, 64);
  assert.equal(indexerSnapshots([recent, ancien]).get("lamartine").pct, 64);
});

test("terrain : chaque chantier garde son propre dernier relevé", () => {
  const i = indexerSnapshots([
    snap({ chantier_id: "metois", date_snapshot: "2026-09-18", avancement: 10 }),
    snap({ chantier_id: "lamartine", date_snapshot: "2026-09-11", avancement: 64 }),
  ]);
  assert.equal(i.get("metois").pct, 10);
  assert.equal(i.get("lamartine").pct, 64);
  assert.equal(i.size, 2);
});

test("terrain : un avancement absent n'est jamais remplacé par un zéro inventé", () => {
  assert.equal(indexerSnapshots([snap({ avancement: null })]).size, 0);
  assert.equal(indexerSnapshots([snap({ avancement: "" })]).size, 0);
});

test("terrain : une ligne sans chantier_id est ignorée", () => {
  assert.equal(indexerSnapshots([snap({ chantier_id: null })]).size, 0);
  assert.equal(indexerSnapshots([snap({ chantier_id: "  " })]).size, 0);
});

test("terrain : une source vide ou absente ne casse rien", () => {
  for (const entree of [null, undefined, [], "pas un tableau"]) {
    assert.equal(indexerSnapshots(entree).size, 0);
  }
});

test("terrain : les numeric de Supabase arrivent en texte et sont bien lus", () => {
  assert.equal(indexerSnapshots([snap({ avancement: "64.5" })]).get("lamartine").pct, 64.5);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FACTURÉ PROGBAT — dernière situation de travaux
// ═══════════════════════════════════════════════════════════════════════════

test("facturé : achievement est un CUMUL EN EUROS, rendu tel quel", () => {
  const f = indexerSituations([situ({ progbat_achievement: 120000 })]).get("lamartine");
  assert.equal(f.cumulEuros, 120000);
});

test("facturé : le pourcentage est déduit du montant du marché", () => {
  const f = indexerSituations([situ({ progbat_achievement: 120000, progbat_deal_net_total: 200000 })]).get("lamartine");
  assert.equal(f.pct, 60);
});

test("facturé : marché absent ou nul → pourcentage null, jamais une division hasardeuse", () => {
  for (const marche of [null, 0, ""]) {
    const f = indexerSituations([situ({ progbat_deal_net_total: marche })]).get("lamartine");
    assert.equal(f.pct, null, `marché ${JSON.stringify(marche)}`);
    assert.equal(f.cumulEuros, 120000, "le cumul en euros reste affichable");
  }
});

test("facturé : à date égale, c'est le numéro de situation le plus haut qui gagne", () => {
  const s2 = situ({ progbat_situation_number: 2, progbat_achievement: 80000 });
  const s5 = situ({ progbat_situation_number: 5, progbat_achievement: 150000 });
  assert.equal(indexerSituations([s2, s5]).get("lamartine").cumulEuros, 150000);
  assert.equal(indexerSituations([s5, s2]).get("lamartine").cumulEuros, 150000);
});

test("facturé : une date plus récente l'emporte sur un numéro plus haut", () => {
  const vieuxMaisHaut = situ({ date_facture: "2026-05-01", progbat_situation_number: 9, progbat_achievement: 10 });
  const recent = situ({ date_facture: "2026-09-10", progbat_situation_number: 1, progbat_achievement: 999 });
  assert.equal(indexerSituations([vieuxMaisHaut, recent]).get("lamartine").cumulEuros, 999);
});

test("facturé : un cumul absent n'affiche rien plutôt qu'un faux zéro", () => {
  assert.equal(indexerSituations([situ({ progbat_achievement: null })]).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LIGNE DE LA GRILLE — une ligne non reliée reste vide
// ═══════════════════════════════════════════════════════════════════════════

const IDX_SNAP = indexerSnapshots([snap({})]);
const IDX_SITU = indexerSituations([situ({})]);

test("ligne : sans chantier_id, aucune donnée liée — aucun rapprochement par nom", () => {
  for (const id of ["", null, undefined, "   "]) {
    const r = donneesLieesLigne(id, IDX_SNAP, IDX_SITU);
    assert.equal(r.terrain, null);
    assert.equal(r.facture, null);
  }
});

test("ligne : un chantier inconnu des deux sources n'invente rien", () => {
  const r = donneesLieesLigne("chantier-jamais-vu", IDX_SNAP, IDX_SITU);
  assert.equal(r.terrain, null);
  assert.equal(r.facture, null);
});

test("ligne : une source peut manquer sans emporter l'autre", () => {
  const r = donneesLieesLigne("lamartine", IDX_SNAP, new Map());
  assert.equal(r.terrain.pct, 64);
  assert.equal(r.facture, null);
});

test("ligne : des index absents ne font pas planter l'écran", () => {
  const r = donneesLieesLigne("lamartine", undefined, null);
  assert.equal(r.terrain, null);
  assert.equal(r.facture, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. AFFICHAGE
// ═══════════════════════════════════════════════════════════════════════════

test("affichage : la date est lisible en français", () => {
  assert.equal(formaterDateFr("2026-09-18"), "18/09/2026");
  assert.equal(formaterDateFr(null), "");
  assert.equal(formaterDateFr("date bizarre"), "date bizarre");
});

test("affichage : les infobulles disent d'où vient le chiffre", () => {
  assert.match(infobulleTerrain(IDX_SNAP.get("lamartine")), /18\/09\/2026/);
  assert.match(infobulleTerrain(IDX_SNAP.get("lamartine")), /2026-W38/);
  assert.match(infobulleFacture(IDX_SITU.get("lamartine")), /n° 3/);
  assert.match(infobulleFacture(IDX_SITU.get("lamartine")), /10\/09\/2026/);
});

test("affichage : sans donnée, l'infobulle l'explique au lieu de rester muette", () => {
  assert.match(infobulleTerrain(null), /Aucun relev/);
  assert.match(infobulleFacture(null), /Aucune situation/);
  assert.equal(SANS_DONNEE, "—");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ÉCRAN — lecture seule, et rien de plus
// ═══════════════════════════════════════════════════════════════════════════

test("écran : les deux tables ne sont lues qu'une fois chacune", () => {
  for (const table of ["chantier_snapshots_hebdo", "chantier_factures_client"]) {
    const n = (ECRAN.match(new RegExp(`from\\("${table}"\\)`, "g")) || []).length;
    assert.equal(n, 1, `${table} doit être lue exactement une fois (trouvé ${n})`);
  }
});

test("écran : aucune écriture dans les deux tables", () => {
  for (const table of ["chantier_snapshots_hebdo", "chantier_factures_client"]) {
    const suite = ECRAN.slice(ECRAN.indexOf(`from("${table}")`)).slice(0, 400);
    for (const verbe of ["insert", "upsert", "update", "delete"]) {
      assert.ok(!new RegExp(`\\.${verbe}\\(`).test(suite),
        `« ${verbe} » ne doit pas suivre la lecture de ${table}`);
    }
  }
});

test("écran : seules les colonnes du périmètre sont demandées", () => {
  assert.match(ECRAN, /\.select\("chantier_id, week_id, date_snapshot, avancement"\)/);
  assert.match(ECRAN, /\.select\("chantier_id, date_facture, progbat_situation_number, progbat_achievement, progbat_deal_net_total"\)/);
  // Hors périmètre : peu fiables, explicitement écartées.
  assert.ok(!/select\("[^"]*situation_a_facturer/.test(ECRAN), "situation_a_facturer ne doit pas être lue");
  assert.ok(!/select\("[^"]*\bmarge\b/.test(ECRAN), "marge ne doit pas être lue");
});

test("écran : la table phasages n'est jamais chargée ici (ouvrages ~473 ko)", () => {
  assert.ok(!/from\("phasages"\)/.test(ECRAN));
});

test("écran : le lien est porté par la LIGNE, pas par la période", () => {
  assert.match(ECRAN, /updateRow\(row\.id, "chantier_id", chantierId\)/);
  // updateValue écrit dans values[periodId] : il ne doit jamais toucher au lien.
  assert.ok(!/updateValue\([^)]*"chantier_id"/.test(ECRAN));
  // Et le lien survit à un rechargement.
  assert.match(ECRAN, /chantier_id: row\.chantier_id \?\? ""/);
});

test("écran : les colonnes informatives ne nourrissent jamais la saisie", () => {
  // avancementReel et pctFacture ne doivent être alimentés que par l'humain.
  for (const champ of ["avancementReel", "pctFacture"]) {
    const ecritures = ECRAN.match(new RegExp(`updateValue\\([^)]*"${champ}"[^)]*\\)`, "g")) || [];
    assert.ok(ecritures.length > 0, `la saisie de « ${champ} » doit exister`);
    for (const e of ecritures) {
      assert.match(e, /e\.target\.value/, `« ${champ} » ne doit être écrit que par une frappe : ${e}`);
    }
  }
  // Rien de calculé à partir de terrain/facture ne retourne dans la grille.
  assert.ok(!/updateValue\([^)]*terrain/.test(ECRAN));
  assert.ok(!/updateValue\([^)]*facture\./.test(ECRAN));
});

test("écran : les cellules informatives sont en lecture seule, pas des champs", () => {
  const debut = ECRAN.indexOf("function DonneeLieeCell");
  assert.ok(debut > 0, "DonneeLieeCell doit exister");
  const corps = ECRAN.slice(debut, ECRAN.indexOf("\nfunction ", debut + 10));
  assert.ok(!/<input|onChange/.test(corps), "la cellule informative ne doit rien laisser saisir");
});

test("écran : le sélecteur propose toujours de ne relier à rien", () => {
  const debut = ECRAN.indexOf("function ChantierLieSelect");
  assert.ok(debut > 0, "ChantierLieSelect doit exister");
  const corps = ECRAN.slice(debut, ECRAN.indexOf("\nfunction ", debut + 10));
  assert.match(corps, /<option value="">/, "une option vide doit exister");
});

test("écran : les deux composants sont déclarés au niveau du module", () => {
  // Sinon ils seraient recréés à chaque rendu — cf. verif-composants-internes.
  for (const nom of ["ChantierLieSelect", "DonneeLieeCell"]) {
    assert.match(ECRAN, new RegExp(`^function ${nom}\\(`, "m"), `${nom} doit être déclaré au niveau du module`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-etats-financiers-donnees-liees : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
