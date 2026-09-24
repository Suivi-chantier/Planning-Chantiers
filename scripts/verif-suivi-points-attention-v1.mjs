// Vérification du module pur « suivi des points d'attention » (Chantier 07).
//
// Le module dit à la hiérarchie ce qui est NOUVEAU, ce qui TRAÎNE et ce qui s'est
// ARRÊTÉ — jamais « résolu » : l'argent perdu ne revient pas. Les scénarios ci-dessous vérifient surtout qu'il n'étiquette rien
// qu'il ne puisse prouver : sans une troisième semaine de snapshots, aucune
// étiquette n'est produite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  suiviPointsAttentionV1,
  libelleSuiviV1,
  SUIVI_POINTS_ATTENTION_VERSION,
  STATUT_NOUVEAU, STATUT_PERSISTANT, STATUT_DERIVE_ARRETEE,
  libelleDerivesArreteesV1,
} from "../src/Renovation/suiviPointsAttentionV1.mjs";
import {
  pointsAttentionV1, etatPointsAttentionV1,
  ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES,
} from "../src/Renovation/pointsAttentionV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/suiviPointsAttentionV1.mjs"), "utf8");
const facade = await readFile(resolve(here, "../src/Renovation/suiviPointsAttentionV1.js"), "utf8");
// Le CODE seul : ni commentaires de bloc (JSDoc), ni commentaires de ligne.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── 1. Pureté, façade, et réutilisation de la détection existante. ──────────
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(code), false, "le suivi doit rester pur");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "le suivi ne doit rien lire ni persister en base");
assert.equal(/new Date\s*\(|Date\.now\s*\(|Date\.UTC\s*\(/.test(code), false, "le suivi ne doit dépendre d'aucune horloge");
// La détection n'est pas réimplémentée : elle est appelée.
assert.match(code, /import \{ pointsAttentionV1, releveExploitableV1, formaterEurosV1 \} from "\.\/pointsAttentionV1\.mjs";/);
// Le détecteur de relevé est PARTAGé, pas recopié : une seule définition de
// « une semaine est relevée » dans tout le projet.
assert.equal(/const semaineExploitable/.test(code), false, "pas de copie locale du détecteur de relevé");
// La détection reste entièrement déléguée : le suivi appelle pointsAttentionV1
// (en boucle sur les couples de semaines consécutives) et ne redéfinit aucune règle.
assert.ok((code.match(/pointsAttentionV1\s*\(/g) || []).length >= 2, "le suivi doit appeler pointsAttentionV1, pas réimplémenter la détection");
assert.equal(/avancementStableMaxPts|heuresAjouteesMin|margePerdueMinEuros|margePerdueGraveMinEuros/.test(code), false, "aucun seuil redéfini dans le suivi");
// Garde sur les COLONNES, pas sur les mots français : les phrases affichées
// contiennent légitimement « marge ». Le suivi ne lit aucune colonne de
// snapshot, il ne manipule que les lignes déjà produites par pointsAttentionV1.
assert.equal(/heures_reelles|chantier_snapshots_hebdo|\.avancement\b/.test(code), false, "le suivi ne doit toucher aucune colonne de snapshot");
assert.match(facade, /export \* from "\.\/suiviPointsAttentionV1\.mjs";/);
assert.equal(SUIVI_POINTS_ATTENTION_VERSION, "v1");

const snap = (chantierId, { nom, avancement, heures, marge, date } = {}) => ({
  chantier_id: chantierId,
  chantier_nom: nom ?? `Chantier ${chantierId}`,
  date_snapshot: date ?? "2026-09-18",
  avancement, heures_reelles: heures, marge,
});
// Trois états d'un même chantier. « derive » = consomme sans avancer entre les
// deux semaines qui l'encadrent ; « sain » = avance normalement.
const S2 = (id, o = {}) => snap(id, { avancement: 97, heures: 90, marge: 0, date: "2026-09-04", ...o });
const S1 = (id, o = {}) => snap(id, { avancement: 97, heures: 120, marge: -1166, date: "2026-09-11", ...o });
const S0 = (id, o = {}) => snap(id, { avancement: 97, heures: 150, marge: -2283, date: "2026-09-18", ...o });
// Variante « pas de dérive » : mêmes heures, même marge que la semaine d'avant.
const stable = (base) => (id, o = {}) => base(id, { heures: 90, marge: 0, ...o });

const suivi = (n, n1, n2, seuils) =>
  suiviPointsAttentionV1({ snapshotsN: n, snapshotsN1: n1, snapshotsN2: n2, seuils });
const parId = (liste, id) => liste.find(l => l.chantier_id === id);

// ── 2. Persistant : dérive en N ET en N-1. ─────────────────────────────────
{
  const out = suivi([S0("C1")], [S1("C1")], [S2("C1")]);
  assert.equal(out.suiviDisponible, true);
  assert.equal(out.actifs.length, 1);
  const l = out.actifs[0];
  assert.equal(l.statut, STATUT_PERSISTANT);
  assert.equal(l.semainesConsecutives, 2);
  assert.equal(libelleSuiviV1(l), "2e semaine consécutive");
  assert.deepEqual(out.resolus, []);
  // Les chiffres de la ligne restent ceux de pointsAttentionV1, intacts.
  const brut = pointsAttentionV1({ snapshotsCourants: [S0("C1")], snapshotsPrecedents: [S1("C1")] }).lignes[0];
  assert.equal(l.margePerdue, brut.margePerdue);
  assert.equal(l.explication, brut.explication);
}

// ── 3. Nouveau : dérive en N, pas en N-1. ──────────────────────────────────
{
  // En N-1 le chantier était stable (mêmes heures et même marge qu'en N-2).
  const out = suivi([S0("C1")], [stable(S1)("C1")], [S2("C1")]);
  assert.equal(out.suiviDisponible, true);
  const l = out.actifs[0];
  assert.equal(l.statut, STATUT_NOUVEAU);
  assert.equal(l.semainesConsecutives, 1);
  assert.equal(libelleSuiviV1(l), "nouveau cette semaine");
  assert.deepEqual(out.resolus, []);
}

// ── 4. Dérive arrêtée : signée en N-1, plus en N. ──────────────────────────────────
{
  // C1 dérivait entre N-2 et N-1 ; entre N-1 et N il ne bouge plus.
  const out = suivi(
    [snap("C1", { avancement: 97, heures: 120, marge: -1166, date: "2026-09-18" })],
    [S1("C1")],
    [S2("C1")]
  );
  assert.deepEqual(out.actifs, []);
  assert.equal(out.resolus.length, 1);
  const r = out.resolus[0];
  assert.equal(r.chantier_id, "C1");
  assert.equal(r.statut, STATUT_DERIVE_ARRETEE);
  // Dernière marge perdue connue = celle mesurée en N-1.
  assert.equal(r.margePerdueDerniere, 1166);
  assert.equal(r.margePerdue, 1166);
  assert.equal(libelleSuiviV1(r), "ne dérive plus cette semaine");
}

// ── 5. Moins de 3 semaines : aucune étiquette, et le module le dit. ────────
{
  for (const n2 of [undefined, null, [], "bruit", [null, { chantier_id: "" }]]) {
    const out = suivi([S0("C1")], [S1("C1")], n2);
    assert.equal(out.suiviDisponible, false, `N-2 = ${JSON.stringify(n2)}`);
    assert.deepEqual(out.resolus, []);
    assert.equal(out.actifs.length, 1, "les points d'attention restent affichés");
    // Aucun statut : l'écran ne peut pas étiqueter « nouveau » à tort.
    assert.equal("statut" in out.actifs[0], false);
    assert.equal("semainesConsecutives" in out.actifs[0], false);
    assert.equal(libelleSuiviV1(out.actifs[0]), null, "pas d'étiquette sans preuve");
  }
  // N-1 vide : rien à comparer non plus, et aucun point d'attention détectable.
  const sansN1 = suivi([S0("C1")], [], [S2("C1")]);
  assert.equal(sansN1.suiviDisponible, false);
  assert.deepEqual(sansN1.actifs, []);
  assert.deepEqual(sansN1.resolus, []);
}

// ── 6. Chantier apparu puis disparu, et chantier jamais vu. ───────────────
{
  // APPARU : absent de N-2, dérive en N-1, puis disparaît des snapshots en N.
  // Il doit ressortir en « dérive arrêtée », pas être oublié.
  const out = suivi(
    [S0("PERSIST")],                      // APPARU n'est plus snapshoté en N
    [S1("PERSIST"), S1("APPARU")],
    [S2("PERSIST")]                       // APPARU absent de N-2
  );
  // APPARU n'a pas de point de départ en N-2 → pas détecté en N-1 → rien à signaler.
  assert.deepEqual(out.resolus.map(l => l.chantier_id), [],
    "sans comparaison possible en N-1, on n'invente pas une résolution");
  assert.deepEqual(out.actifs.map(l => l.chantier_id), ["PERSIST"]);
  assert.equal(out.actifs[0].statut, STATUT_PERSISTANT);

  // Même chantier, mais cette fois présent en N-2 : la dérive de N-1 est
  // mesurable, sa disparition en N est donc une vraie résolution.
  const out2 = suivi(
    [S0("PERSIST")],
    [S1("PERSIST"), S1("APPARU")],
    [S2("PERSIST"), S2("APPARU")]
  );
  assert.deepEqual(out2.resolus.map(l => l.chantier_id), ["APPARU"]);
}

// ── 7. Le tri de pointsAttentionV1 est conservé tel quel. ─────────────────
{
  const n  = [S0("PETIT", { marge: -1366 }), S0("GROS", { marge: -6166 }), S0("MOYEN", { marge: -2166 })];
  const n1 = [S1("PETIT"), S1("GROS"), S1("MOYEN")];
  const n2 = [S2("PETIT"), S2("GROS"), S2("MOYEN")];
  const out = suivi(n, n1, n2);
  const attendu = pointsAttentionV1({ snapshotsCourants: n, snapshotsPrecedents: n1 }).lignes.map(l => l.chantier_id);
  assert.deepEqual(out.actifs.map(l => l.chantier_id), attendu, "l'ordre marge perdue décroissante est conservé");
  assert.deepEqual(out.actifs.map(l => l.chantier_id), ["GROS", "MOYEN", "PETIT"]);
  // Les résolus sont eux aussi rendus dans l'ordre de la détection N-1.
  const avecResolus = suivi(
    [S0("GROS", { marge: -6166 })],
    [S1("PETIT"), S1("GROS"), S1("MOYEN")],
    [S2("PETIT"), S2("GROS"), S2("MOYEN")]
  );
  assert.deepEqual(avecResolus.resolus.map(l => l.chantier_id), ["MOYEN", "PETIT"]);
}

// ── 8. Seuils transmis aux DEUX détections, et déterminisme. ──────────────
{
  const n = [S0("C1")], n1 = [S1("C1")], n2 = [S2("C1")];
  // Les DEUX motifs doivent être desserrés : sinon « perte_de_marge » (500 €)
  // retiendrait le chantier tout seul, et le bloc ne testerait plus rien.
  const serre = suivi(n, n1, n2, { margePerdueMinEuros: 5000, margePerdueGraveMinEuros: 5000 });
  assert.deepEqual(serre.actifs, []);
  assert.deepEqual(serre.resolus, [], "les seuils s'appliquent aussi à la détection N-1");
  assert.deepEqual(serre.seuils, { avancementStableMaxPts: 1, heuresAjouteesMin: 2, margePerdueMinEuros: 5000, margePerdueGraveMinEuros: 5000 });
  // Déterminisme strict à entrées identiques.
  assert.deepEqual(suivi(n, n1, n2), suivi(n, n1, n2));
}

// ── 9. Entrées vides ou malformées, et libellé défensif. ─────────────────
{
  assert.deepEqual(suiviPointsAttentionV1().actifs, []);
  assert.deepEqual(suiviPointsAttentionV1({}).resolus, []);
  assert.equal(suiviPointsAttentionV1().suiviDisponible, false);
  for (const entree of [undefined, null, 0, "", "bruit", {}, []]) {
    const out = suivi(entree, entree, entree);
    assert.deepEqual(out.actifs, []);
    assert.deepEqual(out.resolus, []);
    assert.equal(out.version, "v1");
  }
  assert.equal(libelleSuiviV1(null), null);
  assert.equal(libelleSuiviV1("bruit"), null);
  assert.equal(libelleSuiviV1({}), null);
  assert.equal(libelleSuiviV1({ statut: "inconnu" }), null);
  // Un compteur absurde retombe sur la seule valeur prouvable.
  assert.equal(libelleSuiviV1({ statut: STATUT_PERSISTANT, semainesConsecutives: null }), "2e semaine consécutive");
  assert.equal(libelleSuiviV1({ statut: STATUT_PERSISTANT, semainesConsecutives: 4 }), "4e semaine consécutive");
}

// ── 10. Aucun effet de bord sur les snapshots reçus. ──────────────────────
{
  const n = [S0("C1")], n1 = [S1("C1")], n2 = [S2("C1")];
  const copies = [structuredClone(n), structuredClone(n1), structuredClone(n2)];
  suivi(n, n1, n2);
  assert.deepEqual([n, n1, n2], copies, "les snapshots ne doivent jamais être mutés");
}

// ── 11. Le suivi reporte les drapeaux de relevé : trois états distincts. ────
// Sans relevé pour la semaine affichée, `actifs: []` ne veut pas dire « aucune
// dérive » — l'écran doit pouvoir le dire autrement.
{
  // (c) Aucun relevé pour la semaine du bilan (cron du vendredi soir pas encore passé).
  const sansReleve = suivi([], [S1("C1")], [S2("C1")]);
  // (a) Relevé présent, plus aucune dérive.
  const aucuneDerive = suivi(
    [snap("C1", { avancement: 97, heures: 120, marge: -1166, date: "2026-09-18" })],
    [S1("C1")], [S2("C1")]
  );
  // (b) Relevé présent, dérive en cours.
  const avecDerives = suivi([S0("C1")], [S1("C1")], [S2("C1")]);

  // Les deux premiers ont `actifs` vide : c'est le piège à ne pas reproduire.
  assert.deepEqual(sansReleve.actifs, []);
  assert.deepEqual(aucuneDerive.actifs, []);
  assert.equal(avecDerives.actifs.length, 1);

  assert.equal(sansReleve.releveDisponible, false);
  assert.equal(sansReleve.comparaisonPossible, false);
  assert.equal(aucuneDerive.releveDisponible, true);
  assert.equal(avecDerives.releveDisponible, true);
  // Le report existe aussi quand le suivi n'est pas disponible (moins de 3 semaines).
  const courtSansReleve = suivi([], [S1("C1")], []);
  assert.equal(courtSansReleve.suiviDisponible, false);
  assert.equal(courtSansReleve.releveDisponible, false);

  const etats = [
    etatPointsAttentionV1({ ...sansReleve, lignes: sansReleve.actifs }),
    etatPointsAttentionV1({ ...aucuneDerive, lignes: aucuneDerive.actifs }),
    etatPointsAttentionV1({ ...avecDerives, lignes: avecDerives.actifs }),
  ];
  assert.deepEqual(etats.map(e => e.statut), [ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES]);
  // Les trois sorties doivent être deux à deux différentes.
  for (let i = 0; i < etats.length; i++) {
    for (let j = i + 1; j < etats.length; j++) {
      assert.notDeepEqual(etats[i], etats[j], `les états ${i} et ${j} se ressemblent`);
      assert.notEqual(etats[i].message, etats[j].message);
    }
  }
}

// ── 12. Cumul réel : 4 semaines consécutives, 10 183 €. ────────────────
// Série relevée en base pour TOM & CAMILLE R+1, avec le seuil de 500 € :
//   W35 −1 237 € · W36 −2 573 € · W37 −4 352 € · W38 −2 021 €
//   marge 11 856 € (W34) → 1 673 € (W38), soit 10 183 € sur 4 semaines.
// Le chantier PROGRESSE tout du long : seul le motif perte_de_marge le retient,
// et il est donc ACTIF en W38 — pas un cas de « dérive arrêtée ».
{
  const r1 = (marge, heures, avancement, date) => snap("R1", {
    nom: "TOM & CAMILLE R+1", avancement, heures, marge, date,
  });
  const W38 = [r1(1673,  210, 97, "2026-09-18")];
  const W37 = [r1(3694,  180, 88, "2026-09-11")];
  const W36 = [r1(8046,  150, 76, "2026-09-04")];
  const W35 = [r1(10619, 120, 68, "2026-08-28")];
  const W34 = [r1(11856,  90, 60, "2026-08-21")];
  const W33 = [r1(11856,  60, 52, "2026-08-14")]; // aucune perte : la série s'arrête là

  const out = suiviPointsAttentionV1({
    snapshotsN: W38, snapshotsN1: W37, snapshotsN2: W36, historiqueAnterieur: [W35, W34, W33],
  });
  assert.equal(out.actifs.length, 1, "R+1 est encore en dérive en W38");
  assert.deepEqual(out.resolus, [], "il n'est PAS un cas de dérive arrêtée");
  const a = out.actifs[0];
  assert.deepEqual(a.motifs, ["perte_de_marge"], "il progresse : seul le second motif le retient");
  assert.equal(a.margePerdue, 2021, "perte de la seule semaine W38");
  assert.equal(a.cumulSemaines, 4);
  assert.equal(a.cumulMargePerdue, 10183, "1 237 + 2 573 + 4 352 + 2 021");
  assert.equal(a.cumulComplet, true, "la série s'arrête avant le bord de l'historique");
  // Le cumul égale exactement la marge disparue sur la période.
  assert.equal(a.cumulMargePerdue, 11856 - 1673);

  // Sans assez d'historique, on ne peut prouver que ce qu'on voit : « au moins ».
  // Trois semaines seulement : deux comparaisons possibles, donc 2 021 + 4 352.
  const court = suiviPointsAttentionV1({ snapshotsN: W38, snapshotsN1: W37, snapshotsN2: W36 });
  assert.equal(court.actifs[0].cumulSemaines, 2);
  assert.equal(court.actifs[0].cumulMargePerdue, 6373);
  assert.equal(court.actifs[0].cumulComplet, false, "la série touche le bord : le total est un minimum");
}

// ── 13. « Arrêtée », jamais « résolue » — et le cumul déjà perdu. ─────────
// Un chantier qui sort de la liste n'a rien récupéré. Écrire « résolu » dans un
// document transmis à la hiérarchie dirait le contraire de la réalité.
{
  const b = (marge, heures, avancement, date) => snap("BR", {
    nom: "BRIOLLAY", avancement, heures, marge, date,
  });
  // Dérive sur W36 et W37, puis stabilisation en W38.
  const W38 = [b(5000, 240, 70, "2026-09-18")];  // marge identique à W37 : plus de perte
  const W37 = [b(5000, 220, 67, "2026-09-11")];
  const W36 = [b(6026, 190, 64, "2026-09-04")];
  const W35 = [b(7000, 160, 61, "2026-08-28")];
  const W34 = [b(7000, 130, 58, "2026-08-21")];  // aucune perte avant

  const out = suiviPointsAttentionV1({
    snapshotsN: W38, snapshotsN1: W37, snapshotsN2: W36, historiqueAnterieur: [W35, W34],
  });
  assert.deepEqual(out.actifs, [], "la dérive s'est arrêtée cette semaine");
  assert.equal(out.resolus.length, 1);
  const r = out.resolus[0];
  assert.equal(r.statut, STATUT_DERIVE_ARRETEE);
  assert.equal(r.statut.includes("resolu"), false, "le statut interne ne dit pas « résolu »");
  assert.equal(r.margePerdueDerniere, 1026, "dernière semaine signée (W37)");
  assert.equal(r.cumulMargePerdue, 2000, "1 026 + 974");
  assert.equal(r.cumulSemaines, 2);
  assert.equal(r.cumulComplet, true);

  const phrase = libelleDerivesArreteesV1(out.resolus);
  assert.match(phrase, /La dérive signalée la semaine dernière s'est arrêtée/);
  assert.match(phrase, /la marge perdue n'est pas récupérée/);
  assert.match(phrase, /BRIOLLAY — 2 000 € perdus sur 2 semaines signées/);
  // Le mot interdit, sous toutes ses formes.
  assert.equal(/résolu|resolu/i.test(phrase), false, "le mot « résolu » est proscrit");

  // Historique tronqué : la série touche le bord, on dit « au moins ».
  const court = suiviPointsAttentionV1({ snapshotsN: W38, snapshotsN1: W37, snapshotsN2: W36 });
  assert.equal(court.resolus[0].cumulSemaines, 1);
  assert.equal(court.resolus[0].cumulComplet, false);
  assert.match(libelleDerivesArreteesV1(court.resolus), /au moins 1 026 € perdus sur 1 semaine signée/);

  // Liste vide : aucune phrase, donc aucune rubrique à afficher.
  assert.equal(libelleDerivesArreteesV1([]), "");
  assert.equal(libelleDerivesArreteesV1(null), "");
  assert.equal(libelleDerivesArreteesV1("bruit"), "");
}

console.log("OK — suivi points d'attention V1 : 13 blocs de vérification");
