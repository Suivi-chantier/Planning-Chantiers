// Vérification du module pur « Points d'attention » (Chantier 07, Bilan Semaine).
//
// Le module signale les chantiers qui CONSOMMENT sans AVANCER. Les scénarios
// ci-dessous vérifient surtout qu'il ne signale rien à tort : les trois
// conditions doivent être réunies, une donnée manquante interdit la
// comparaison, et aucun chiffre n'est recalculé — tout vient des colonnes du
// snapshot hebdomadaire.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pointsAttentionV1,
  libellePointAttentionV1,
  formaterEurosV1,
  formaterHeuresV1,
  POINTS_ATTENTION_VERSION,
  SEUILS_POINTS_ATTENTION_V1,
  etatPointsAttentionV1,
  releveExploitableV1,
  ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES,
  libelleMotifsV1,
  MOTIF_CONSOMMATION_SANS_AVANCEMENT, MOTIF_PERTE_DE_MARGE,
} from "../src/Renovation/pointsAttentionV1.mjs";
import {
  dedoublonnerSnapshotsV1, preparerSemainesAttentionV1, auditDoublonsSnapshotsV1,
} from "../src/Renovation/pointsAttentionDonneesV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/pointsAttentionV1.mjs"), "utf8");
const facade = await readFile(resolve(here, "../src/Renovation/pointsAttentionV1.js"), "utf8");
// Le CODE seul, sans les lignes de commentaire : l'en-tête documente
// volontairement d'où viennent les chiffres (colonnes du snapshot,
// computeChantierFinance côté cron) et ne doit pas déclencher les gardes.
const code = source.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── 0. Pureté + façade ──────────────────────────────────────────────────────
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "les points d'attention doivent rester purs");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "les points d'attention ne doivent rien lire ni persister en base");
assert.equal(/new Date\s*\(|Date\.now\s*\(|Date\.UTC\s*\(/.test(code), false, "les points d'attention ne doivent dépendre d'aucune horloge");
// Même chiffre = même service : aucune formule financière refaite ici. Le
// module lit les colonnes du snapshot, il ne les reconstruit pas.
assert.equal(/vendu_ht|mo_reel|mat_reel|marge_pct|computeChantierFinance/.test(code), false, "aucun recalcul financier parallèle : les chiffres viennent des colonnes du snapshot");
// Les seules colonnes financières touchées sont celles que le cron a écrites.
assert.deepEqual(
  [...new Set(code.match(/\b(?:avancement|heures_reelles|marge|chantier_id|chantier_nom|date_snapshot)\b/g) || [])].sort(),
  ["avancement", "chantier_id", "chantier_nom", "date_snapshot", "heures_reelles", "marge"]
);
assert.match(facade, /export \* from "\.\/pointsAttentionV1\.mjs";/, "la façade .js doit ré-exporter le .mjs");
assert.equal(POINTS_ATTENTION_VERSION, "v1");
assert.deepEqual({ ...SEUILS_POINTS_ATTENTION_V1 }, {
  avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50, margePerdueGraveMinEuros: 500,
});

const snap = (chantierId, { nom, avancement, heures, marge, date } = {}) => ({
  chantier_id: chantierId,
  chantier_nom: nom ?? `Chantier ${chantierId}`,
  week_id: "2026-W38",
  date_snapshot: date ?? "2026-09-18",
  avancement, heures_reelles: heures, marge,
});
// Cas de référence : le chantier dérive nettement (retenu par défaut).
const avant = (id, o = {}) => snap(id, { avancement: 97, heures: 120, marge: -1166, date: "2026-09-11", ...o });
const apres = (id, o = {}) => snap(id, { avancement: 97, heures: 150, marge: -2283, date: "2026-09-18", ...o });
const lignesDe = (courants, precedents, seuils) =>
  pointsAttentionV1({ snapshotsCourants: courants, snapshotsPrecedents: precedents, seuils }).lignes;
// Le fixture de référence perd 1 117 € : le motif « perte_de_marge » (seuil 500 €)
// le retiendrait quoi qu'il arrive. Pour tester le motif 1 EN ISOLATION, on met
// le second hors de portée — sinon ces blocs ne mesurent plus ce qu'ils annoncent.
const SANS_MOTIF_2 = { margePerdueGraveMinEuros: 1e9 };
const motif1Seul = (courants, precedents, seuils) =>
  lignesDe(courants, precedents, { ...SANS_MOTIF_2, ...(seuils || {}) });

// ── 1. Le cas nominal : les trois conditions réunies. ───────────────────────
{
  const out = pointsAttentionV1({
    snapshotsCourants: [apres("C1", { nom: "TOM & CAMILLE R+2" })],
    snapshotsPrecedents: [avant("C1", { nom: "TOM & CAMILLE R+2" })],
  });
  assert.equal(out.version, "v1");
  assert.deepEqual(out.seuils, { avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50, margePerdueGraveMinEuros: 500 });
  assert.equal(out.lignes.length, 1);
  const l = out.lignes[0];
  assert.equal(l.chantier_id, "C1");
  assert.equal(l.nom, "TOM & CAMILLE R+2");
  assert.equal(l.avancement, 97);
  assert.equal(l.avancementDelta, 0);
  assert.equal(l.heuresAjoutees, 30);
  assert.equal(l.margeAvant, -1166);
  assert.equal(l.margeApres, -2283);
  assert.equal(l.margePerdue, 1117);
  assert.match(l.explication, /n'a pas bougé/);
  assert.match(l.explication, /30 h/);
  assert.match(l.explication, /1 117 €/);

  // Déterminisme strict à entrées identiques.
  assert.deepEqual(pointsAttentionV1({
    snapshotsCourants: [apres("C1", { nom: "TOM & CAMILLE R+2" })],
    snapshotsPrecedents: [avant("C1", { nom: "TOM & CAMILLE R+2" })],
  }), out);
}

// ── 2. Condition 1 isolée : l'avancement stable. ────────────────────────────
{
  // Le chantier a réellement avancé (+5 pts) : ce n'est plus une dérive.
  assert.equal(motif1Seul([apres("C1", { avancement: 102 })], [avant("C1")]).length, 0);
  // Exactement au seuil (+1 pt) : retenu (la condition est un <=).
  assert.equal(motif1Seul([apres("C1", { avancement: 98 })], [avant("C1")]).length, 1);
  // Juste au-delà (+1,5 pt) : écarté.
  assert.equal(motif1Seul([apres("C1", { avancement: 98.5 })], [avant("C1")]).length, 0);
  // Une RÉGRESSION d'avancement compte aussi : la valeur absolue est testée.
  assert.equal(motif1Seul([apres("C1", { avancement: 96 })], [avant("C1")]).length, 1);
  assert.equal(motif1Seul([apres("C1", { avancement: 90 })], [avant("C1")]).length, 0);
  // Seuil desserré : le +5 pts repasse.
  assert.equal(motif1Seul([apres("C1", { avancement: 102 })], [avant("C1")], { avancementStableMaxPts: 5 }).length, 1);
}

// ── 3. Condition 2 isolée : les heures ajoutées. ────────────────────────────
{
  // Aucune heure ajoutée : rien ne s'est passé, rien à signaler.
  assert.equal(motif1Seul([apres("C1", { heures: 120 })], [avant("C1")]).length, 0);
  // Sous le seuil (+1 h).
  assert.equal(motif1Seul([apres("C1", { heures: 121 })], [avant("C1")]).length, 0);
  // Exactement au seuil (+2 h) : retenu.
  assert.equal(motif1Seul([apres("C1", { heures: 122 })], [avant("C1")]).length, 1);
  // Des heures RETIRÉES (correction de pointage) ne déclenchent rien.
  assert.equal(motif1Seul([apres("C1", { heures: 100 })], [avant("C1")]).length, 0);
  // Seuil resserré.
  assert.equal(motif1Seul([apres("C1", { heures: 122 })], [avant("C1")], { heuresAjouteesMin: 10 }).length, 0);
}

// ── 4. Condition 3 isolée : la marge perdue. ────────────────────────────────
{
  // Marge stable : pas de point d'attention, même avec des heures ajoutées.
  assert.equal(lignesDe([apres("C1", { marge: -1166 })], [avant("C1")]).length, 0);
  // Sous le seuil (49 € perdus).
  assert.equal(lignesDe([apres("C1", { marge: -1215 })], [avant("C1")]).length, 0);
  // Exactement au seuil (50 € perdus) : retenu.
  assert.equal(lignesDe([apres("C1", { marge: -1216 })], [avant("C1")]).length, 1);
  // La marge PROGRESSE : jamais signalé.
  assert.equal(lignesDe([apres("C1", { marge: 500 })], [avant("C1")]).length, 0);
  // Fonctionne aussi sur des marges positives qui reculent.
  assert.equal(lignesDe(
    [apres("C1", { marge: 800 })], [avant("C1", { marge: 3000 })]
  )[0].margePerdue, 2200);
  // Seuil resserré.
  assert.equal(lignesDe([apres("C1", { marge: -1216 })], [avant("C1")], { margePerdueMinEuros: 1000 }).length, 0);
}

// ── 5. Le tri : marge perdue décroissante. ──────────────────────────────────
{
  const out = lignesDe(
    [
      apres("PETIT", { marge: -1366 }),   // 200 € perdus
      apres("GROS", { marge: -6166 }),    // 5 000 € perdus
      apres("MOYEN", { marge: -2166 }),   // 1 000 € perdus
      apres("EGAL_B", { marge: -2166 }),  // 1 000 € perdus aussi
      apres("EGAL_A", { marge: -2166 }),
    ],
    [avant("PETIT"), avant("GROS"), avant("MOYEN"), avant("EGAL_B"), avant("EGAL_A")]
  );
  assert.deepEqual(out.map(l => l.chantier_id), ["GROS", "EGAL_A", "EGAL_B", "MOYEN", "PETIT"]);
  assert.deepEqual(out.map(l => l.margePerdue), [5000, 1000, 1000, 1000, 200]);
}

// ── 6. Chantier nouveau, absent de la semaine N-1 : ignoré. ─────────────────
{
  const out = lignesDe(
    [apres("C1"), apres("NOUVEAU")],
    [avant("C1")] // NOUVEAU n'existait pas la semaine dernière
  );
  assert.deepEqual(out.map(l => l.chantier_id), ["C1"], "sans point de départ, aucune dérive n'est démontrable");
  // Un chantier présent en N-1 mais disparu en N n'invente pas de ligne non plus.
  assert.deepEqual(lignesDe([apres("C1")], [avant("C1"), avant("DISPARU")]).map(l => l.chantier_id), ["C1"]);
}

// ── 7. Valeurs null / indisponibles : le chantier est écarté, jamais compté 0. ──
{
  for (const champ of ["avancement", "heures", "marge"]) {
    assert.equal(lignesDe([apres("C1", { [champ]: null })], [avant("C1")]).length, 0, `null sur ${champ} (semaine N)`);
    assert.equal(lignesDe([apres("C1")], [avant("C1", { [champ]: null })]).length, 0, `null sur ${champ} (semaine N-1)`);
  }
  // undefined, chaîne vide et valeur non numérique sont traités pareil.
  assert.equal(lignesDe([apres("C1", { marge: undefined })], [avant("C1")]).length, 0);
  assert.equal(lignesDe([apres("C1", { marge: "" })], [avant("C1")]).length, 0);
  assert.equal(lignesDe([apres("C1", { heures: "beaucoup" })], [avant("C1")]).length, 0);
  // Une marge à 0 est une VRAIE valeur, pas une donnée manquante.
  assert.equal(lignesDe([apres("C1", { marge: 0 })], [avant("C1", { marge: 500 })]).length, 1);
  // Les valeurs numériques en texte (numeric Postgres via PostgREST) passent.
  assert.equal(lignesDe(
    [apres("C1", { avancement: "97", heures: "150", marge: "-2283" })],
    [avant("C1", { avancement: "97", heures: "120", marge: "-1166" })]
  )[0].margePerdue, 1117);
}

// ── 8. Entrées vides ou malformées : rien ne casse, rien n'est inventé. ─────
{
  for (const entree of [undefined, null, 0, "", "bruit", {}, []]) {
    const out = pointsAttentionV1({ snapshotsCourants: entree, snapshotsPrecedents: entree });
    assert.deepEqual(out.lignes, []);
    assert.equal(out.version, "v1");
  }
  assert.deepEqual(pointsAttentionV1().lignes, []);
  assert.deepEqual(pointsAttentionV1({}).lignes, []);
  // Lignes individuelles corrompues : ignorées sans faire tomber le calcul.
  const out = lignesDe(
    [null, 42, "bruit", { chantier_id: "" }, apres("C1")],
    [null, "bruit", avant("C1")]
  );
  assert.deepEqual(out.map(l => l.chantier_id), ["C1"]);
  // Des seuils absurdes retombent sur les valeurs par défaut.
  const seuilsCasses = pointsAttentionV1({
    snapshotsCourants: [apres("C1")], snapshotsPrecedents: [avant("C1")],
    seuils: { avancementStableMaxPts: null, heuresAjouteesMin: "abc", margePerdueMinEuros: undefined },
  });
  assert.deepEqual(seuilsCasses.seuils, { avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50, margePerdueGraveMinEuros: 500 });
  assert.equal(seuilsCasses.lignes.length, 1);
}

// ── 9. Le libellé affiché à l'écran et dans le PDF. ────────────────────────
{
  const [l] = lignesDe([apres("C1", { nom: "TOM & CAMILLE R+2" })], [avant("C1", { nom: "TOM & CAMILLE R+2" })]);
  assert.equal(
    libellePointAttentionV1(l),
    "TOM & CAMILLE R+2 — 97 % d'avancement inchangé, +30 h consommées, marge en baisse de 1 117 € (−1 166 € → −2 283 €)."
  );
  // Avancement qui bouge un peu : le libellé le dit au lieu de « inchangé ».
  const [bouge] = lignesDe([apres("C2", { nom: "VILLA NORD", avancement: 98 })], [avant("C2", { nom: "VILLA NORD" })]);
  assert.match(libellePointAttentionV1(bouge), /^VILLA NORD — 98 % d'avancement \(\+1 pt seulement\), \+30 h consommées/);
  // Entrée absente : pas d'exception, pas de phrase inventée.
  assert.equal(libellePointAttentionV1(null), "—");
  assert.equal(libellePointAttentionV1("bruit"), "—");
  // Formatage : séparateur de milliers stable, vrai signe moins, virgule décimale.
  assert.equal(formaterEurosV1(1117), "1 117 €");
  assert.equal(formaterEurosV1(-1166), "−1 166 €");
  assert.equal(formaterEurosV1(1234567), "1 234 567 €");
  assert.equal(formaterEurosV1(null), "—");
  assert.equal(formaterHeuresV1(30), "30 h");
  assert.equal(formaterHeuresV1(7.5), "7,5 h");
  assert.equal(formaterHeuresV1(null), "—");
}

// ── 10. Plusieurs snapshots la même semaine : le plus récent fait foi. ──────
{
  // Le cron peut avoir tourné deux fois dans la semaine (unicité par jour).
  const out = lignesDe(
    [
      snap("C1", { avancement: 97, heures: 130, marge: -1500, date: "2026-09-16" }), // mercredi
      snap("C1", { avancement: 97, heures: 150, marge: -2283, date: "2026-09-18" }), // vendredi
    ],
    [avant("C1")]
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].heuresAjoutees, 30, "l'état de fin de semaine fait foi");
  assert.equal(out[0].margePerdue, 1117);
}

// ── 11. Aucun effet de bord : les entrées ne sont pas modifiées. ────────────
{
  const courants = [apres("C1")];
  const precedents = [avant("C1")];
  const copieC = structuredClone(courants);
  const copieP = structuredClone(precedents);
  pointsAttentionV1({ snapshotsCourants: courants, snapshotsPrecedents: precedents });
  assert.deepEqual(courants, copieC, "les snapshots de la semaine N ne doivent jamais être mutés");
  assert.deepEqual(precedents, copieP, "les snapshots de la semaine N-1 ne doivent jamais être mutés");
  // Les seuils par défaut sont gelés : personne ne peut les modifier à distance.
  assert.throws(() => { "use strict"; SEUILS_POINTS_ATTENTION_V1.heuresAjouteesMin = 99; });
}

// ── 12. Relevé ABSENT ≠ aucune dérive : les trois états doivent différer. ────
// Le cron d'alimentation tourne le vendredi en fin de journée : avant ça, la
// semaine en cours n'a AUCUNE ligne. Un écran qui afficherait « aucune dérive »
// à ce moment-là mentirait — il ne sait pas encore.
{
  // (c) Pas de relevé pour la semaine affichée.
  const sansReleve = pointsAttentionV1({ snapshotsCourants: [], snapshotsPrecedents: [avant("C1")] });
  // (a) Relevé présent, rien à signaler.
  const aucuneDerive = pointsAttentionV1({
    snapshotsCourants: [apres("C1", { marge: -1166 })], snapshotsPrecedents: [avant("C1")],
  });
  // (b) Relevé présent, dérives détectées.
  const avecDerives = pointsAttentionV1({ snapshotsCourants: [apres("C1")], snapshotsPrecedents: [avant("C1")] });

  // Les deux premiers ont une liste VIDE : c'est précisément le piège.
  assert.deepEqual(sansReleve.lignes, []);
  assert.deepEqual(aucuneDerive.lignes, []);
  assert.equal(avecDerives.lignes.length, 1);

  // Les drapeaux, eux, les distinguent.
  assert.equal(sansReleve.releveDisponible, false);
  assert.equal(sansReleve.comparaisonPossible, false);
  assert.equal(aucuneDerive.releveDisponible, true);
  assert.equal(aucuneDerive.comparaisonPossible, true);
  assert.equal(avecDerives.releveDisponible, true);

  const etats = [
    etatPointsAttentionV1(sansReleve),
    etatPointsAttentionV1(aucuneDerive),
    etatPointsAttentionV1(avecDerives),
  ];
  assert.deepEqual(etats.map(e => e.statut), [ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES]);
  // Ton NEUTRE quand on ne sait pas : surtout pas le vert du « tout va bien ».
  assert.deepEqual(etats.map(e => e.ton), ["neutre", "ok", "alerte"]);
  assert.match(etats[0].message, /pas encore disponible pour cette semaine/);
  assert.match(etats[0].message, /vendredi en fin de journée/);
  assert.match(etats[0].message, /Aucune comparaison possible/);
  assert.match(etats[1].message, /^Aucun point d'attention détecté cette semaine\.$/);
  assert.match(etats[2].message, /consomme des heures sans avancer/);

  // LE test qui compte : les trois sorties doivent être deux à deux DIFFÉRENTES.
  for (let i = 0; i < etats.length; i++) {
    for (let j = i + 1; j < etats.length; j++) {
      assert.notDeepEqual(etats[i], etats[j], `les états ${i} et ${j} se ressemblent`);
      assert.notEqual(etats[i].message, etats[j].message, `messages ${i} et ${j} identiques`);
      assert.notEqual(etats[i].statut, etats[j].statut);
    }
  }
}

// ── 13. Relevé de la semaine PRÉCÉDENTE absent : autre manque, autre message. ──
{
  const sansPrecedent = pointsAttentionV1({ snapshotsCourants: [apres("C1")], snapshotsPrecedents: [] });
  assert.equal(sansPrecedent.releveDisponible, true);
  assert.equal(sansPrecedent.relevePrecedentDisponible, false);
  assert.equal(sansPrecedent.comparaisonPossible, false);
  const etat = etatPointsAttentionV1(sansPrecedent);
  assert.equal(etat.statut, ETAT_RELEVE_ABSENT);
  assert.equal(etat.ton, "neutre");
  assert.match(etat.message, /semaine précédente indisponible/);
  // Message distinct de celui de la semaine courante manquante.
  const autre = etatPointsAttentionV1(pointsAttentionV1({ snapshotsCourants: [], snapshotsPrecedents: [avant("C1")] }));
  assert.notEqual(etat.message, autre.message);

  // Le détecteur de relevé ne se laisse pas abuser par du bruit.
  assert.equal(releveExploitableV1([]), false);
  assert.equal(releveExploitableV1(null), false);
  assert.equal(releveExploitableV1("bruit"), false);
  assert.equal(releveExploitableV1([null, "x", { chantier_id: "" }]), false);
  assert.equal(releveExploitableV1([{ chantier_id: "C1" }]), true);

  // Un résultat sans drapeau (objet construit à la main) ne doit pas être lu
  // comme « relevé absent » : seul un false explicite compte.
  assert.equal(etatPointsAttentionV1({ lignes: [] }).statut, ETAT_AUCUNE_DERIVE);
  assert.equal(etatPointsAttentionV1(null).statut, ETAT_AUCUNE_DERIVE);
}

// ── 14. Le SECOND motif : « ça avance, mais ça coûte plus cher que vendu ». ──
// La règle d'origine exigeait un avancement stable : elle ratait exactement les
// chantiers qui progressent en brûlant de la marge. Sur la base en 2026-W38,
// c'était 4 050 € de perte hebdomadaire invisibles dans le PDF.
{
  // (i) Un chantier qui AVANCE et perd beaucoup : attrapé par le nouveau motif.
  const avance = lignesDe(
    [snap("R1", { nom: "TOM & CAMILLE R+1", avancement: 97, heures: 173, marge: 1673 })],
    [snap("R1", { nom: "TOM & CAMILLE R+1", avancement: 88, heures: 120, marge: 3694, date: "2026-09-11" })]
  );
  assert.equal(avance.length, 1, "un chantier qui avance en perdant 2 021 € doit remonter");
  assert.deepEqual(avance[0].motifs, [MOTIF_PERTE_DE_MARGE]);
  assert.equal(avance[0].avancementDelta, 9);
  assert.equal(avance[0].heuresAjoutees, 53);
  assert.equal(avance[0].margePerdue, 2021);
  // Le libellé doit EXPLIQUER : le « mais » porte tout le sens.
  assert.equal(
    libellePointAttentionV1(avance[0]),
    "TOM & CAMILLE R+1 — avancement +9 pts mais 53 h consommées, marge en baisse de 2 021 € (3 694 € → 1 673 €)."
  );
  assert.match(libellePointAttentionV1(avance[0]), / mais /);
  assert.equal(libelleMotifsV1(avance[0]), "perte de marge");
  assert.match(avance[0].explication, /coûté nettement plus cher/);

  // (ii) Un chantier STABLE qui perd PEU : ancien motif seulement.
  const stable = lignesDe([apres("C1", { marge: -1366 })], [avant("C1")]); // 200 € perdus
  assert.equal(stable.length, 1);
  assert.deepEqual(stable[0].motifs, [MOTIF_CONSOMMATION_SANS_AVANCEMENT]);
  assert.equal(stable[0].margePerdue, 200);
  assert.equal(libelleMotifsV1(stable[0]), "consommation sans avancement");
  // Phrase de référence inchangée par l'ajout du second motif.
  assert.match(libellePointAttentionV1(stable[0]), /^Chantier C1 — 97 % d'avancement inchangé, \+30 h consommées, marge en baisse de 200 €/);

  // (iii) Un chantier qui déclenche LES DEUX : une seule ligne, deux motifs.
  const lesDeux = lignesDe([apres("C1", { nom: "TOM & CAMILLE R+2" })], [avant("C1", { nom: "TOM & CAMILLE R+2" })]);
  assert.equal(lesDeux.length, 1, "un chantier ne doit jamais apparaître deux fois");
  assert.deepEqual(lesDeux[0].motifs, [MOTIF_CONSOMMATION_SANS_AVANCEMENT, MOTIF_PERTE_DE_MARGE]);
  assert.equal(libelleMotifsV1(lesDeux[0]), "consommation sans avancement + perte de marge");
  // La phrase de référence reste EXACTEMENT celle d'origine : les motifs sont
  // des étiquettes à côté, ils n'allongent pas le texte.
  assert.equal(
    libellePointAttentionV1(lesDeux[0]),
    "TOM & CAMILLE R+2 — 97 % d'avancement inchangé, +30 h consommées, marge en baisse de 1 117 € (−1 166 € → −2 283 €)."
  );

  // (iv) LE SEUIL MORD : 499 € perdus avec un avancement qui bouge => rien.
  const juste = lignesDe(
    [snap("X", { avancement: 97, heures: 173, marge: 1 })],
    [snap("X", { avancement: 88, heures: 120, marge: 500, date: "2026-09-11" })]
  );
  assert.deepEqual(juste, [], "499 € ne doivent pas déclencher le motif perte_de_marge");
  // Exactement 500 € : retenu.
  const pile = lignesDe(
    [snap("X", { avancement: 97, heures: 173, marge: 0 })],
    [snap("X", { avancement: 88, heures: 120, marge: 500, date: "2026-09-11" })]
  );
  assert.equal(pile.length, 1);
  assert.deepEqual(pile[0].motifs, [MOTIF_PERTE_DE_MARGE]);

  // (v) Le tri reste la marge perdue décroissante, motifs mélangés.
  const melange = lignesDe(
    [apres("PETIT", { marge: -1366 }), snap("GROS", { avancement: 97, heures: 173, marge: 1673 })],
    [avant("PETIT"), snap("GROS", { avancement: 88, heures: 120, marge: 3694, date: "2026-09-11" })]
  );
  assert.deepEqual(melange.map(l => l.chantier_id), ["GROS", "PETIT"]);
  assert.deepEqual(melange.map(l => l.margePerdue), [2021, 200]);

  // (vi) Le seuil est paramétrable, comme les autres.
  assert.equal(lignesDe(
    [snap("X", { avancement: 97, heures: 173, marge: 1 })],
    [snap("X", { avancement: 88, heures: 120, marge: 500, date: "2026-09-11" })],
    { margePerdueGraveMinEuros: 100 }
  ).length, 1);
  assert.equal(libelleMotifsV1({}), "");
  assert.equal(libelleMotifsV1(null), "");
}

// ── 15. Doublons de relevé : une seule ligne retenue, la plus récente. ────
// Le cron a tourné DEUX FOIS en 2026-W31 : 36 lignes pour 19 chantiers, soit
// 17 doublons (seule semaine concernée sur les 20). Le suivi remontant huit
// semaines pour les cumuls, et huit semaines avant W38 tombant précisément sur
// W31, un rapprochement naïf y produirait une ligne en double ou une valeur
// arbitraire. Fixture calquée sur le cas réel de TOM & CAMILLE R+1.
{
  const brut = [
    { chantier_id: "R1", chantier_nom: "TOM & CAMILLE R+1", week_id: "2026-W31",
      date_snapshot: "2026-07-31", created_at: "2026-07-31T17:02:00Z",
      avancement: 58, heures_reelles: 300, marge: 11856 },
    { chantier_id: "R1", chantier_nom: "TOM & CAMILLE R+1", week_id: "2026-W31",
      date_snapshot: "2026-07-31", created_at: "2026-07-31T19:14:00Z",  // seconde exécution
      avancement: 42, heures_reelles: 320, marge: 13781 },
    { chantier_id: "C2", chantier_nom: "AUTRE", week_id: "2026-W31",
      date_snapshot: "2026-07-31", created_at: "2026-07-31T17:02:00Z",
      avancement: 50, heures_reelles: 100, marge: 900 },
  ];

  const propre = dedoublonnerSnapshotsV1(brut);
  assert.equal(propre.length, 2, "un seul relevé par chantier et par semaine");
  const r1 = propre.find(l => l.chantier_id === "R1");
  assert.equal(r1.created_at, "2026-07-31T19:14:00Z", "la ligne la plus récemment écrite fait foi");
  assert.equal(r1.marge, 13781);
  assert.equal(r1.avancement, 42);
  // L'ordre d'arrivée ne change pas le résultat.
  const inverse = dedoublonnerSnapshotsV1([brut[1], brut[0], brut[2]]);
  assert.equal(inverse.find(l => l.chantier_id === "R1").created_at, "2026-07-31T19:14:00Z");

  // LE point qui compte : le total des points d'attention ne double pas.
  const semaineSuivante = [
    { chantier_id: "R1", chantier_nom: "TOM & CAMILLE R+1", week_id: "2026-W32",
      date_snapshot: "2026-08-07", created_at: "2026-08-07T17:02:00Z",
      avancement: 42, heures_reelles: 350, marge: 11000 },
  ];
  const avecDoublons = pointsAttentionV1({
    snapshotsCourants: semaineSuivante, snapshotsPrecedents: brut,
  });
  const dedoublonne = pointsAttentionV1({
    snapshotsCourants: preparerSemainesAttentionV1({ lignes: semaineSuivante, weekIds: ["2026-W32"] })[0],
    snapshotsPrecedents: preparerSemainesAttentionV1({ lignes: brut, weekIds: ["2026-W31"] })[0],
  });
  assert.equal(dedoublonne.lignes.length, 1, "un chantier, une ligne");
  assert.equal(dedoublonne.lignes.filter(l => l.chantier_id === "R1").length, 1,
    "le doublon de relevé ne doit jamais produire deux points d'attention");
  assert.equal(dedoublonne.lignes[0].margePerdue, 2781, "13 781 → 11 000, ligne la plus récente");
  assert.equal(avecDoublons.lignes.length, dedoublonne.lignes.length,
    "même nombre de lignes : le total ne double pas");

  // Découpage par semaine, dans l'ordre demandé.
  const semaines = preparerSemainesAttentionV1({
    lignes: [...brut, ...semaineSuivante], weekIds: ["2026-W32", "2026-W31"],
  });
  assert.equal(semaines.length, 2);
  assert.deepEqual(semaines[0].map(l => l.chantier_id), ["R1"]);
  assert.deepEqual(semaines[1].map(l => l.chantier_id).sort(), ["C2", "R1"]);
  // Une semaine sans relevé rend un tableau vide, pas une absence : c'est ce qui
  // permet ensuite de dire « relevé pas encore disponible ».
  assert.deepEqual(preparerSemainesAttentionV1({ lignes: brut, weekIds: ["2026-W39"] }), [[]]);

  // Les doublons écartés sont comptés, pas masqués.
  const audit = auditDoublonsSnapshotsV1(brut);
  assert.equal(audit.total, 1);
  assert.deepEqual(audit.parSemaine, [{ week_id: "2026-W31", doublons: 1 }]);
  assert.equal(auditDoublonsSnapshotsV1(semaineSuivante).total, 0);

  // Entrées malformées et lignes sans created_at.
  assert.deepEqual(dedoublonnerSnapshotsV1(null), []);
  assert.deepEqual(dedoublonnerSnapshotsV1([null, 42, "bruit", { chantier_id: "" }]), []);
  const sansHorodatage = dedoublonnerSnapshotsV1([
    { chantier_id: "X", week_id: "W", date_snapshot: "2026-07-24", marge: 1 },
    { chantier_id: "X", week_id: "W", date_snapshot: "2026-07-31", marge: 2 },
  ]);
  assert.equal(sansHorodatage.length, 1);
  assert.equal(sansHorodatage[0].marge, 2, "sans created_at, date_snapshot départage");
  const horodateeGagne = dedoublonnerSnapshotsV1([
    { chantier_id: "X", week_id: "W", marge: 1 },
    { chantier_id: "X", week_id: "W", created_at: "2026-07-31T19:00:00Z", marge: 2 },
  ]);
  assert.equal(horodateeGagne[0].marge, 2, "une ligne horodatée l'emporte sur une ligne qui ne l'est pas");
  // Déterminisme strict.
  assert.deepEqual(dedoublonnerSnapshotsV1(brut), dedoublonnerSnapshotsV1(brut));
}

console.log("OK — points d'attention V1 : 15 blocs de vérification");
