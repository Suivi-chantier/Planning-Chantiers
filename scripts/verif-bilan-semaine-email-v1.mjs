// Vérification du module pur « résumé e-mail du Bilan Semaine » (Chantier 07).
//
// Ce module n'a qu'un seul droit : mettre en phrases ce qui est DÉJÀ affiché.
// Les blocs ci-dessous vérifient qu'il ne recalcule rien, qu'il n'omet jamais
// la rubrique des points d'attention, et qu'il n'invente pas une prévision qui
// n'a pas été demandée.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bilanSemaineEmailV1, BILAN_SEMAINE_EMAIL_VERSION } from "../src/Renovation/bilanSemaineEmailV1.mjs";
import { pointsAttentionV1, libellePointAttentionV1 } from "../src/Renovation/pointsAttentionV1.mjs";
import { suiviPointsAttentionV1, libelleSuiviV1 } from "../src/Renovation/suiviPointsAttentionV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/bilanSemaineEmailV1.mjs"), "utf8");
const facade = await readFile(resolve(here, "../src/Renovation/bilanSemaineEmailV1.js"), "utf8");
// Le CODE seul : ni commentaires de bloc (JSDoc), ni commentaires de ligne.
// L'en-tête documente volontairement ce que le module n'a pas le droit de
// faire, et ne doit pas déclencher les gardes ci-dessous.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── 1. Pureté, façade, aucun envoi. ────────────────────────────────────────
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(code), false, "le résumé e-mail doit rester pur");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "le résumé e-mail ne doit rien lire ni persister en base");
assert.equal(/new Date\s*\(|Date\.now\s*\(|Date\.UTC\s*\(/.test(code), false, "le résumé e-mail ne doit dépendre d'aucune horloge");
assert.equal(/fetch\s*\(|mailto:|nodemailer|smtp|sendMail/i.test(code), false, "le module produit un texte, il n'envoie rien");
assert.match(facade, /export \* from "\.\/bilanSemaineEmailV1\.mjs";/);
assert.equal(BILAN_SEMAINE_EMAIL_VERSION, "v1");

// ── 2. AUCUN RECALCUL — garde structurelle. ────────────────────────────────
// Le module n'a pas le droit de faire d'arithmétique sur des données métier,
// ni de refaire un arrondi : il réutilise les formateurs et les libellés
// déjà employés à l'écran et dans le PDF.
assert.equal(/Math\./.test(code), false, "aucun Math. : le module ne calcule pas");
assert.equal(/\.reduce\s*\(/.test(code), false, "aucun reduce : le module n'agrège pas");
assert.equal(/\.toFixed\s*\(|toLocaleString/.test(code), false, "aucun arrondi ni formatage maison : les formateurs partagés font foi");
assert.equal(/[^*\n]\*[^*\n/]|\s\/\s|[-+]=|\+\+|--/.test(code), false, "aucune opération arithmétique sur les données");
assert.equal(/vendu_ht|mo_reel|mat_reel|marge_pct|computeChantierFinance|heures_reelles/.test(code), false, "aucune colonne financière retouchée");
// Les chiffres et les phrases viennent des mêmes services que l'écran.
assert.match(code, /from "\.\/pointsAttentionV1\.mjs"/);
assert.match(code, /from "\.\/suiviPointsAttentionV1\.mjs"/);

const snap = (chantierId, { nom, avancement, heures, marge, date } = {}) => ({
  chantier_id: chantierId, chantier_nom: nom ?? `Chantier ${chantierId}`,
  date_snapshot: date ?? "2026-09-18", avancement, heures_reelles: heures, marge,
});
const S2 = (id, o = {}) => snap(id, { avancement: 97, heures: 90, marge: 0, date: "2026-09-04", ...o });
const S1 = (id, o = {}) => snap(id, { avancement: 97, heures: 120, marge: -1166, date: "2026-09-11", ...o });
const S0 = (id, o = {}) => snap(id, { avancement: 97, heures: 150, marge: -2283, date: "2026-09-18", ...o });

const periode = { weekId: "2026-W39", debut: "21/09/2026", fin: "27/09/2026" };
const indicateurs = { heures: 312, tachesFaites: 47, genereEuros: 18400, margeGenereeEuros: 4200, chantiers: 6 };
const points = pointsAttentionV1({
  snapshotsCourants: [S0("C1", { nom: "TOM & CAMILLE R+2" })],
  snapshotsPrecedents: [S1("C1", { nom: "TOM & CAMILLE R+2" })],
});
const suivi = suiviPointsAttentionV1({
  snapshotsN: [S0("C1", { nom: "TOM & CAMILLE R+2" })],
  snapshotsN1: [S1("C1", { nom: "TOM & CAMILLE R+2" })],
  snapshotsN2: [S2("C1", { nom: "TOM & CAMILLE R+2" })],
});

// ── 3. Cas nominal : l'objet porte la semaine et le nombre de points. ──────
{
  const { objet, corps } = bilanSemaineEmailV1({ periode, indicateursPortefeuille: indicateurs, pointsAttention: points, suivi });
  assert.equal(objet, "Bilan semaine 2026-W39 — 1 point d'attention");
  assert.match(corps, /^Bilan de la semaine 2026-W39 \(du 21\/09\/2026 au 27\/09\/2026\)\./);
  // Pluriel correct au-delà de un.
  const deux = bilanSemaineEmailV1({
    periode,
    pointsAttention: pointsAttentionV1({
      snapshotsCourants: [S0("C1"), S0("C2")], snapshotsPrecedents: [S1("C1"), S1("C2")],
    }),
  });
  assert.equal(deux.objet, "Bilan semaine 2026-W39 — 2 points d'attention");
}

// ── 4. Tous les chiffres affichés sont présents, à l'identique. ────────────
{
  const { corps } = bilanSemaineEmailV1({ periode, indicateursPortefeuille: indicateurs, pointsAttention: points, suivi });
  assert.match(corps, /- Heures : 312 h/);
  assert.match(corps, /- Tâches terminées : 47/);
  assert.match(corps, /- Valeur générée : 18 400 €/);
  assert.match(corps, /- Dont marge : 4 200 €/);
  assert.match(corps, /- Chantiers au bilan : 6/);
  // Un indicateur non transmis ne produit aucune ligne inventée.
  const partiel = bilanSemaineEmailV1({ periode, indicateursPortefeuille: { heures: 312 }, pointsAttention: points });
  assert.match(partiel.corps, /- Heures : 312 h/);
  assert.equal(/Dont marge|Valeur générée|Tâches terminées|Chantiers au bilan/.test(partiel.corps), false);
  // Aucun indicateur du tout : pas de titre orphelin.
  const aucun = bilanSemaineEmailV1({ periode, pointsAttention: points });
  assert.equal(/INDICATEURS/.test(aucun.corps), false);
}

// ── 5. Invariant 23 : la phrase du mail EST celle de l'écran. ─────────────
{
  const { corps } = bilanSemaineEmailV1({ periode, pointsAttention: points, suivi });
  const ligne = suivi.actifs[0];
  const phraseEcran = libellePointAttentionV1(ligne);
  const etiquette = libelleSuiviV1(ligne);
  // Caractère pour caractère : aucun réarrondi, aucune reformulation.
  assert.ok(corps.includes(`1. ${phraseEcran} (${etiquette})`), "la ligne du mail doit être la ligne de l'écran");
  assert.match(corps, /97 % d'avancement inchangé, \+30 h consommées, marge en baisse de 1 117 €/);
  assert.match(corps, /\(2e semaine consécutive\)/);
  // Sans suivi disponible : la phrase reste, l'étiquette disparaît.
  const sansSuivi = bilanSemaineEmailV1({
    periode, pointsAttention: points,
    suivi: suiviPointsAttentionV1({
      snapshotsN: [S0("C1", { nom: "TOM & CAMILLE R+2" })],
      snapshotsN1: [S1("C1", { nom: "TOM & CAMILLE R+2" })],
      snapshotsN2: [],
    }),
  });
  assert.ok(sansSuivi.corps.includes(`1. ${libellePointAttentionV1(points.lignes[0])}`));
  assert.equal(/semaine consécutive|nouveau cette semaine/.test(sansSuivi.corps), false);
}

// ── 6. Liste vide : la rubrique est présente et le DIT. ───────────────────
{
  const { objet, corps } = bilanSemaineEmailV1({ periode, indicateursPortefeuille: indicateurs, pointsAttention: { lignes: [] } });
  assert.equal(objet, "Bilan semaine 2026-W39 — aucun point d'attention");
  assert.match(corps, /POINTS D'ATTENTION \(0\)/, "la rubrique ne doit JAMAIS être omise");
  assert.match(corps, /Aucun point d'attention détecté cette semaine/);
  // Même sans aucune donnée du tout, la rubrique reste là.
  const vide = bilanSemaineEmailV1();
  assert.match(vide.corps, /POINTS D'ATTENTION \(0\)/);
  assert.match(vide.corps, /Aucun point d'attention détecté cette semaine/);
  assert.equal(vide.objet, "Bilan semaine semaine non précisée — aucun point d'attention");
}

// ── 7. Les résolus apparaissent, y compris quand plus rien ne dérive. ─────
{
  const suiviResolu = suiviPointsAttentionV1({
    snapshotsN: [snap("C1", { nom: "VILLA NORD", avancement: 97, heures: 120, marge: -1166 })],
    snapshotsN1: [S1("C1", { nom: "VILLA NORD" })],
    snapshotsN2: [S2("C1", { nom: "VILLA NORD" })],
  });
  const { corps } = bilanSemaineEmailV1({ periode, pointsAttention: { lignes: [] }, suivi: suiviResolu });
  assert.match(corps, /POINTS D'ATTENTION \(0\)/);
  assert.match(corps, /Résolu depuis la semaine dernière : VILLA NORD\./);
}

// ── 8. « La semaine qui vient » : absente tant qu'elle n'a pas été calculée. ──
{
  const sans = bilanSemaineEmailV1({ periode, pointsAttention: points });
  assert.equal(/LA SEMAINE QUI VIENT/.test(sans.corps), false, "pas de prévision non demandée");
  for (const valeur of [null, undefined, 0, "", "bruit"]) {
    assert.equal(/LA SEMAINE QUI VIENT/.test(bilanSemaineEmailV1({ periode, pointsAttention: points, semaineQuiVient: valeur }).corps), false);
  }

  const avec = bilanSemaineEmailV1({
    periode, pointsAttention: points,
    semaineQuiVient: {
      debut: "28/09/2026", fin: "04/10/2026",
      chantiers: [{ nom: "VILLA NORD", jours: ["lun. 28/09", "mar. 29/09"], heures_mo: 42, personnes: ["Jean", "Marc"] }],
      auDelaHorizon: [{ nom: "TOM & CAMILLE R+2", libelle: "Au-delà de l'horizon" }],
    },
  });
  assert.match(avec.corps, /LA SEMAINE QUI VIENT/);
  assert.match(avec.corps, /Proposition du moteur de planification, rien n'est appliqué\./,
    "le corps doit dire que c'est une proposition");
  assert.match(avec.corps, /Du 28\/09\/2026 au 04\/10\/2026\./);
  assert.match(avec.corps, /- VILLA NORD : 42 h — lun\. 28\/09, mar\. 29\/09/);
  assert.match(avec.corps, /avec Jean, Marc/);
  assert.match(avec.corps, /Chantiers dont le travail dépasse l'horizon étudié :/);
  assert.match(avec.corps, /- TOM & CAMILLE R\+2 : Au-delà de l'horizon/);
  // Calcul lancé mais rien à proposer : la rubrique le dit, sans inventer.
  const vide = bilanSemaineEmailV1({ periode, pointsAttention: points, semaineQuiVient: { debut: "28/09/2026", fin: "04/10/2026", chantiers: [], auDelaHorizon: [] } });
  assert.match(vide.corps, /Aucune intervention proposée sur cette période\./);
}

// ── 9. Blocages saisis, et ligne finale sur le PDF. ──────────────────────
{
  const { corps } = bilanSemaineEmailV1({
    periode, pointsAttention: points,
    blocages: [
      { chantier_nom: "VILLA NORD", texte: "En attente du carreleur" },
      { chantier_nom: "SANS TEXTE", texte: "   " },   // ignoré
      null, "bruit",
    ],
  });
  assert.match(corps, /BLOCAGES SIGNALÉS \(1\)/);
  assert.match(corps, /- VILLA NORD : En attente du carreleur/);
  assert.equal(/SANS TEXTE/.test(corps), false);
  // Aucun blocage : pas de rubrique vide (seuls les points d'attention sont obligatoires).
  assert.equal(/BLOCAGES SIGNALÉS/.test(bilanSemaineEmailV1({ periode, pointsAttention: points }).corps), false);
  // Toujours la même dernière ligne.
  assert.match(corps, /Le PDF détaillé du bilan est joint séparément\.$/);
  assert.match(bilanSemaineEmailV1().corps, /Le PDF détaillé du bilan est joint séparément\.$/);
}

// ── 10. Entrées malformées et absence d'effet de bord. ───────────────────
{
  for (const entree of [0, "", "bruit", [], 42]) {
    const out = bilanSemaineEmailV1({
      periode: entree, indicateursPortefeuille: entree, pointsAttention: entree,
      suivi: entree, blocages: entree, semaineQuiVient: entree,
    });
    assert.equal(typeof out.objet, "string");
    assert.equal(typeof out.corps, "string");
    assert.match(out.corps, /POINTS D'ATTENTION \(0\)/);
  }
  // Pas de ligne vide en trop ni d'espace final.
  const { corps } = bilanSemaineEmailV1({ periode, indicateursPortefeuille: indicateurs, pointsAttention: points, suivi });
  assert.equal(/\n{3,}/.test(corps), false, "pas de trou de trois lignes vides");
  assert.equal(corps, corps.trim());

  const entrees = { periode, indicateursPortefeuille: indicateurs, pointsAttention: points, suivi, blocages: [{ chantier_nom: "A", texte: "x" }] };
  const copie = structuredClone(entrees);
  bilanSemaineEmailV1(entrees);
  assert.deepEqual(entrees, copie, "le résumé ne doit jamais muter ce qu'on lui donne");
  // Déterminisme strict.
  assert.deepEqual(bilanSemaineEmailV1(entrees), bilanSemaineEmailV1(entrees));
}

console.log("OK — bilan semaine e-mail V1 : 10 blocs de vérification");
