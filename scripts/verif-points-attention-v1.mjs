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
} from "../src/Renovation/pointsAttentionV1.mjs";

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
  avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50,
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

// ── 1. Le cas nominal : les trois conditions réunies. ───────────────────────
{
  const out = pointsAttentionV1({
    snapshotsCourants: [apres("C1", { nom: "TOM & CAMILLE R+2" })],
    snapshotsPrecedents: [avant("C1", { nom: "TOM & CAMILLE R+2" })],
  });
  assert.equal(out.version, "v1");
  assert.deepEqual(out.seuils, { avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50 });
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
  assert.equal(lignesDe([apres("C1", { avancement: 102 })], [avant("C1")]).length, 0);
  // Exactement au seuil (+1 pt) : retenu (la condition est un <=).
  assert.equal(lignesDe([apres("C1", { avancement: 98 })], [avant("C1")]).length, 1);
  // Juste au-delà (+1,5 pt) : écarté.
  assert.equal(lignesDe([apres("C1", { avancement: 98.5 })], [avant("C1")]).length, 0);
  // Une RÉGRESSION d'avancement compte aussi : la valeur absolue est testée.
  assert.equal(lignesDe([apres("C1", { avancement: 96 })], [avant("C1")]).length, 1);
  assert.equal(lignesDe([apres("C1", { avancement: 90 })], [avant("C1")]).length, 0);
  // Seuil desserré : le +5 pts repasse.
  assert.equal(lignesDe([apres("C1", { avancement: 102 })], [avant("C1")], { avancementStableMaxPts: 5 }).length, 1);
}

// ── 3. Condition 2 isolée : les heures ajoutées. ────────────────────────────
{
  // Aucune heure ajoutée : rien ne s'est passé, rien à signaler.
  assert.equal(lignesDe([apres("C1", { heures: 120 })], [avant("C1")]).length, 0);
  // Sous le seuil (+1 h).
  assert.equal(lignesDe([apres("C1", { heures: 121 })], [avant("C1")]).length, 0);
  // Exactement au seuil (+2 h) : retenu.
  assert.equal(lignesDe([apres("C1", { heures: 122 })], [avant("C1")]).length, 1);
  // Des heures RETIRÉES (correction de pointage) ne déclenchent rien.
  assert.equal(lignesDe([apres("C1", { heures: 100 })], [avant("C1")]).length, 0);
  // Seuil resserré.
  assert.equal(lignesDe([apres("C1", { heures: 122 })], [avant("C1")], { heuresAjouteesMin: 10 }).length, 0);
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
  assert.deepEqual(seuilsCasses.seuils, { avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 50 });
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

console.log("OK — points d'attention V1 : 13 blocs de vérification");
