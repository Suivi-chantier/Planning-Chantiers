// Vérification du moteur d'alertes (chantier 09).
//
// Ce module ne détecte RIEN de nouveau : il TRIE. Le constat qui l'a rendu
// nécessaire (relevé 2026-W38, mesuré en base) : les 25 chantiers sur 25
// portent un warning, tous en gravité « alerte ». Quand tout est en alerte,
// plus rien ne l'est.
//
// Les blocs vérifient donc surtout ce que le moteur REFUSE de faire :
//   – refaire la détection des dérives au lieu d'appeler pointsAttentionV1 ;
//   – calculer un montant de correction des frais généraux ;
//   – remonter en critique un chantier terminé, sur lequel plus aucune
//     décision n'est possible ;
//   – traiter un impact inconnu comme un zéro.
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alertesV1, etatAlertesV1, alertesDuNiveauV1, estExcluV1, codesWarningsV1, fiabiliteV1,
  libelleMotifAlerteV1,
  ALERTES_VERSION, NIVEAUX_ALERTE,
  NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO,
  MOTIF_MARGE_TERMINAISON_NEGATIVE, MOTIF_TERMINE_EN_PERTE,
  CODE_FG_NON_REGLE, CODE_DERIVE_LOT, CODE_OUVRAGES_SANS_PRIX, CODE_MARGE_SOUS_SEUIL_PRIME,
  MESSAGE_MARGE_SURESTIMEE,
  ETAT_RELEVE_ABSENT, ETAT_AUCUNE_DERIVE, ETAT_DERIVES,
} from "../src/Renovation/alertesV1.mjs";
import {
  MOTIF_CONSOMMATION_SANS_AVANCEMENT, MOTIF_PERTE_DE_MARGE,
  SEUILS_POINTS_ATTENTION_V1, pointsAttentionV1,
} from "../src/Renovation/pointsAttentionV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const lire = async f => readFile(resolve(here, f), "utf8");
const source = await lire("../src/Renovation/alertesV1.mjs");
const facade = await lire("../src/Renovation/alertesV1.js");
const ecran = await lire("../src/Renovation/PageAlertes.jsx");
// Le CODE seul : sans les lignes `//` NI les blocs /** ... */. L'en-tête et
// les JSDoc documentent volontairement le contexte (« DÉPOT », les seuils
// délégués, les frais généraux) et ne doivent pas déclencher les gardes.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── Fixtures (toutes inventées) ─────────────────────────────────────────────
const w = (code, lotId) => ({ code, gravite: "alerte", message: `fixture ${code}`, lotId });

const snap = (id, o = {}) => ({
  chantier_id: id,
  chantier_nom: o.nom || `Chantier ${id}`,
  week_id: o.week || "2026-W38",
  date_snapshot: o.date || "2026-09-18",
  avancement: o.avancement,
  heures_reelles: o.heures,
  marge: o.marge,
  marge_terminaison: o.margeTerminaison,
  warnings: o.warnings || [],
});

/** Deux semaines pour un chantier : la précédente et la courante. */
function paire(id, avant, apres) {
  return {
    precedent: snap(id, { ...avant, week: "2026-W37", date: "2026-09-11" }),
    courant: snap(id, { ...apres, week: "2026-W38", date: "2026-09-18" }),
  };
}

const lancer = (paires, exclusions) => alertesV1({
  snapshotsCourants: paires.map(p => p.courant),
  snapshotsPrecedents: paires.map(p => p.precedent),
  exclusions,
});

const parNom = (r, nom) => r.alertes.find(a => a.nom === nom);

// ── 0. Pureté, façade, constantes ───────────────────────────────────────────
{
  assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "le moteur doit rester pur");
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "aucun accès base");
  assert.equal(/new Date\s*\(|Date\.now\s*\(/.test(code), false, "aucune horloge");
  assert.equal(/toLocaleString|Intl\./.test(code), false, "pas d'ICU : libellés déterministes");
  assert.match(facade, /export \* from "\.\/alertesV1\.mjs";/, "la façade .js doit ré-exporter le .mjs");
  assert.equal(ALERTES_VERSION, "v1");
  assert.deepEqual([...NIVEAUX_ALERTE], ["critique", "a_surveiller", "info"]);
  // Entrées absentes ou malformées : rien ne casse, rien ne s'invente.
  assert.deepEqual(alertesV1().alertes, []);
  assert.deepEqual(alertesV1({ snapshotsCourants: null, snapshotsPrecedents: "bruit" }).alertes, []);
  assert.deepEqual(alertesV1({ snapshotsCourants: [null, 42, {}] }).alertes, []);
}

// ── 1. La détection des dérives est APPELÉE, jamais réécrite ────────────────
{
  // Garde structurelle : le module doit importer pointsAttentionV1 et NE PAS
  // redéfinir ses seuils. Deux détections parallèles finiraient par diverger,
  // et l'application afficherait deux vérités du même chantier.
  assert.match(code, /import\s*\{[\s\S]*?pointsAttentionV1[\s\S]*?\}\s*from\s*"\.\/pointsAttentionV1\.mjs"/,
    "le moteur doit importer pointsAttentionV1");
  assert.match(code, /pointsAttentionV1\(\{/, "…et l'appeler réellement");
  // Aucun seuil de dérive recopié ici : ni les noms, ni les valeurs.
  for (const cle of Object.keys(SEUILS_POINTS_ATTENTION_V1)) {
    assert.equal(code.includes(cle), false, `le seuil « ${cle} » ne doit pas être redéfini dans alertesV1`);
  }
  assert.equal(/SEUILS_POINTS_ATTENTION|avancementStableMaxPts|heuresAjouteesMin|margePerdueMin/.test(code), false,
    "aucun seuil de pointsAttentionV1 ne doit apparaître dans le moteur d'alertes");
  // Les motifs de dérive sont IMPORTÉS, pas réécrits en chaînes littérales.
  assert.equal(/["']consommation_sans_avancement["']|["']perte_de_marge["']/.test(code), false,
    "les motifs de dérive doivent venir de pointsAttentionV1, pas être recopiés");

  // Et fonctionnellement : un résultat déjà calculé est réutilisé tel quel.
  const p = paire("C1", { avancement: 50, heures: 100, marge: 10000, margeTerminaison: 5000 },
                         { avancement: 50, heures: 130, marge: 8000, margeTerminaison: 4000 });
  const pa = pointsAttentionV1({ snapshotsCourants: [p.courant], snapshotsPrecedents: [p.precedent] });
  const avecPA = alertesV1({ snapshotsCourants: [p.courant], snapshotsPrecedents: [p.precedent], pointsAttention: pa });
  const sansPA = alertesV1({ snapshotsCourants: [p.courant], snapshotsPrecedents: [p.precedent] });
  assert.deepEqual(avecPA.alertes, sansPA.alertes, "fournir le résultat ou le laisser calculer doit donner la même chose");
}

// ── 2. Niveau CRITIQUE ──────────────────────────────────────────────────────
{
  // (a) marge à terminaison < 0 ET avancement < 100.
  const a = paire("C1", { avancement: 38, heures: 100, marge: -1000, margeTerminaison: -1000 },
                         { avancement: 39, heures: 105, marge: -1200, margeTerminaison: -39188.41 });
  const r1 = lancer([a]);
  const al = parNom(r1, "Chantier C1");
  assert.equal(al.niveau, NIVEAU_CRITIQUE);
  assert.ok(al.motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE));
  assert.equal(al.impactEuros, 39188.41, "l'impact est le montant en jeu");
  assert.match(al.explication, /encore évitable/);

  // (b) perte de marge >= 500 €/semaine, détectée par pointsAttentionV1.
  const b = paire("C2", { avancement: 60, heures: 100, marge: 5000, margeTerminaison: 5000 },
                         { avancement: 68, heures: 140, marge: 3000, margeTerminaison: 1940.91 });
  const r2 = lancer([b]);
  const al2 = parNom(r2, "Chantier C2");
  assert.equal(al2.niveau, NIVEAU_CRITIQUE);
  assert.ok(al2.motifs.includes(MOTIF_PERTE_DE_MARGE), "le motif vient de pointsAttentionV1");
  assert.equal(al2.impactEuros, 2000, "impact = la marge perdue sur la semaine");

  // Une marge à terminaison négative SANS avancement connu n'est pas critique :
  // on ne peut pas affirmer que le chantier n'est pas terminé.
  const c = paire("C3", { avancement: 50, heures: 10, marge: 100, margeTerminaison: 100 },
                         { avancement: null, heures: 12, marge: -50, margeTerminaison: -500 });
  const al3 = parNom(lancer([c]), "Chantier C3");
  assert.ok(!al3 || al3.niveau !== NIVEAU_CRITIQUE, "un avancement inconnu n'autorise pas le niveau critique");
}

// ── 3. Niveau À SURVEILLER ──────────────────────────────────────────────────
{
  // consommation sans avancement, sans aucun motif critique.
  const p = paire("C1", { avancement: 56, heures: 31.26, marge: 24797, margeTerminaison: 23039 },
                         { avancement: 56, heures: 39.16, marge: 24527, margeTerminaison: 22798 });
  const al = parNom(lancer([p]), "Chantier C1");
  assert.equal(al.niveau, NIVEAU_A_SURVEILLER);
  assert.ok(al.motifs.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT));
  assert.ok(!al.motifs.includes(MOTIF_PERTE_DE_MARGE));
  assert.ok(!al.motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE));
  // La marge à terminaison est POSITIVE : rien de chiffrable à annoncer.
  assert.equal(al.impactEuros, null, "impact inconnu, et surtout pas 0");

  // Le même chantier, s'il porte AUSSI un motif critique, bascule en critique.
  const q = paire("C2", { avancement: 56, heures: 31, marge: 5000, margeTerminaison: 1000 },
                         { avancement: 56, heures: 39, marge: 4000, margeTerminaison: -800 });
  const al2 = parNom(lancer([q]), "Chantier C2");
  assert.equal(al2.niveau, NIVEAU_CRITIQUE, "un motif critique l'emporte sur « à surveiller »");
  assert.ok(al2.motifs.includes(MOTIF_CONSOMMATION_SANS_AVANCEMENT), "…sans perdre l'autre motif");
}

// ── 4. Niveau INFO ──────────────────────────────────────────────────────────
{
  // Les warnings de fond, sans dérive ni marge négative.
  const p = paire("C1", { avancement: 40, heures: 10, marge: 9000, margeTerminaison: 9000 },
                         { avancement: 45, heures: 11, marge: 9000, margeTerminaison: 9000,
                           warnings: [w(CODE_OUVRAGES_SANS_PRIX), w(CODE_DERIVE_LOT, "plomberie"), w(CODE_MARGE_SOUS_SEUIL_PRIME)] });
  const al = parNom(lancer([p]), "Chantier C1");
  assert.equal(al.niveau, NIVEAU_INFO);
  assert.deepEqual(al.motifs, [CODE_OUVRAGES_SANS_PRIX, CODE_DERIVE_LOT, CODE_MARGE_SOUS_SEUIL_PRIME]);
  assert.equal(al.impactEuros, null);

  // Un chantier sans AUCUN motif ne produit pas de carte.
  const vide = paire("C2", { avancement: 10, heures: 1, marge: 100, margeTerminaison: 100 },
                            { avancement: 20, heures: 2, marge: 100, margeTerminaison: 100 });
  assert.equal(parNom(lancer([vide]), "Chantier C2"), undefined, "rien à dire = pas de carte");
}

// ── 5. Chantier à 100 % en perte => INFO, pas critique ──────────────────────
{
  // Le résultat est ACQUIS : aucune décision ne le changera plus. Le faire
  // clignoter en rouge chaque semaine noierait les chantiers sur lesquels on
  // peut encore agir — c'est précisément le défaut qu'on corrige.
  const p = paire("ARTHUR", { nom: "ARTHUR - R+2", avancement: 100, heures: 717, marge: -2606.31, margeTerminaison: -2606.31 },
                             { nom: "ARTHUR - R+2", avancement: 100, heures: 717.05, marge: -2606.31, margeTerminaison: -2606.31,
                               warnings: [w(CODE_OUVRAGES_SANS_PRIX)] });
  const al = parNom(lancer([p]), "ARTHUR - R+2");
  assert.equal(al.niveau, NIVEAU_INFO, "terminé en perte : le fait est acquis");
  assert.notEqual(al.niveau, NIVEAU_CRITIQUE);
  assert.ok(al.motifs.includes(MOTIF_TERMINE_EN_PERTE));
  assert.ok(!al.motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE), "le motif critique ne doit pas être posé");
  // Le montant reste affiché : c'est une information, pas une urgence.
  assert.equal(al.impactEuros, 2606.31);
  assert.match(al.explication, /plus rien à piloter/);

  // À 99 %, le même chantier redevient critique : il reste une marge d'action.
  const q = paire("X", { avancement: 98, heures: 700, marge: -2000, margeTerminaison: -2000 },
                        { avancement: 99, heures: 717, marge: -2606, margeTerminaison: -2606 });
  assert.equal(parNom(lancer([q]), "Chantier X").niveau, NIVEAU_CRITIQUE);
}

// ── 6. Plusieurs motifs = UNE SEULE carte ───────────────────────────────────
{
  const p = paire("C1", { nom: "TOM & CAMILLE R+2", avancement: 97, heures: 637, marge: -1166, margeTerminaison: -1382 },
                         { nom: "TOM & CAMILLE R+2", avancement: 97, heures: 667.31, marge: -2283.22, margeTerminaison: -2488.92,
                           warnings: [w(CODE_OUVRAGES_SANS_PRIX), w(CODE_MARGE_SOUS_SEUIL_PRIME), w(CODE_DERIVE_LOT, "murs_cloison"), w(CODE_DERIVE_LOT, "plomberie")] });
  const r = lancer([p]);
  assert.equal(r.alertes.length, 1, "un chantier = une carte, quels que soient ses motifs");
  const al = r.alertes[0];
  assert.ok(al.motifs.length >= 4, "…mais tous ses motifs sont portés par cette carte");
  assert.ok(al.motifs.includes(MOTIF_MARGE_TERMINAISON_NEGATIVE));
  assert.ok(al.motifs.includes(MOTIF_PERTE_DE_MARGE));
  assert.ok(al.motifs.includes(CODE_OUVRAGES_SANS_PRIX));
  // derive_lot présent deux fois en entrée n'apparaît qu'une fois en motif.
  assert.equal(al.motifs.filter(m => m === CODE_DERIVE_LOT).length, 1, "motifs dédoublonnés");
  assert.equal(al.niveau, NIVEAU_CRITIQUE);
  // L'impact retenu est le plus élevé des montants connus.
  assert.equal(al.impactEuros, 2488.92);
}

// ── 7. DÉPOT (et toute exclusion) n'apparaît jamais ─────────────────────────
{
  const dep = paire("dépot-1", { nom: "DÉPOT", avancement: 0, heures: 15, marge: -655, margeTerminaison: -655 },
                                { nom: "DÉPOT", avancement: 0, heures: 20.95, marge: -770.48, margeTerminaison: -770.48,
                                  warnings: [w(CODE_FG_NON_REGLE)] });
  const autre = paire("C1", { avancement: 40, heures: 10, marge: 500, margeTerminaison: 500 },
                             { avancement: 45, heures: 11, marge: 500, margeTerminaison: 500, warnings: [w(CODE_OUVRAGES_SANS_PRIX)] });

  // Sans exclusion, DÉPOT remonterait en critique (marge < 0, avancement < 100).
  const sans = lancer([dep, autre]);
  assert.ok(parNom(sans, "DÉPOT"), "sans exclusion, DÉPOT apparaîtrait — d'où la liste");
  assert.equal(parNom(sans, "DÉPOT").niveau, NIVEAU_CRITIQUE);

  // Avec exclusion : absent, et signalé comme écarté.
  const avec = lancer([dep, autre], ["DÉPOT"]);
  assert.equal(parNom(avec, "DÉPOT"), undefined, "DÉPOT ne doit jamais apparaître");
  assert.deepEqual(avec.exclus, ["DÉPOT"], "ce qui est écarté doit rester visible");
  assert.equal(avec.alertes.length, 1);

  // La comparaison ignore casse et accents : « depot », « Dépôt », « DEPOT ».
  for (const variante of ["depot", "Dépôt", "DEPOT", "  dépot  "]) {
    assert.equal(parNom(lancer([dep, autre], [variante]), "DÉPOT"), undefined, `exclusion insensible : ${variante}`);
  }
  // L'exclusion marche aussi par identifiant.
  assert.equal(parNom(lancer([dep, autre], ["dépot-1"]), "DÉPOT"), undefined);
  // Aucun nom de chantier écrit en dur dans la logique du module.
  assert.equal(/D[EÉ]POT/i.test(code), false, "la liste d'exclusion est un paramètre, pas une règle du module");
  // Liste vide ou absente : rien n'est exclu.
  assert.ok(parNom(lancer([dep, autre], []), "DÉPOT"));
  assert.ok(parNom(lancer([dep, autre], null), "DÉPOT"));
  assert.equal(estExcluV1(null, ["X"]), false);
}

// ── 8. Drapeau de fiabilité, et AUCUN montant de correction ─────────────────
{
  const p = paire("C1", { avancement: 38, heures: 100, marge: -1000, margeTerminaison: -1000 },
                         { avancement: 39, heures: 105, marge: -1200, margeTerminaison: -39188,
                           warnings: [w(CODE_FG_NON_REGLE), w(CODE_OUVRAGES_SANS_PRIX)] });
  const al = parNom(lancer([p]), "Chantier C1");
  assert.ok(al.fiabilite, "le drapeau doit être posé");
  assert.equal(al.fiabilite.margeSurestimee, true);
  assert.equal(al.fiabilite.message, MESSAGE_MARGE_SURESTIMEE);
  assert.match(al.fiabilite.message, /Marge surestimée/);
  // fg_non_regle est À LA FOIS un motif (niveau info) et un drapeau. Les deux,
  // pas l'un ou l'autre : le motif rend le chantier VISIBLE, le drapeau
  // qualifie la marge de toutes ses autres alertes.
  assert.ok(al.motifs.includes(CODE_FG_NON_REGLE), "fg_non_regle doit aussi être un motif");
  // Sur un chantier qui a d'autres motifs, le niveau reste celui des autres :
  // une donnée manquante ne fait pas baisser une alerte critique.
  assert.equal(al.niveau, NIVEAU_CRITIQUE, "le motif « donnée manquante » ne rabaisse pas le niveau");
  assert.equal(libelleMotifAlerteV1(CODE_FG_NON_REGLE), "Donnée manquante : frais généraux non renseignés");

  // GARDE : aucun taux de frais généraux, aucun montant de correction.
  assert.equal(/tauxFg|TAUX_FG|fgEstime|margeCorrigee|correctionFg|margeReelleEstimee/.test(code), false,
    "le module ne doit calculer aucun montant de correction des frais généraux");
  assert.equal(/\bfg\s*\*|\*\s*0\.\d+\s*\/\/.*fg/i.test(code), false, "aucune multiplication par un taux supposé");
  assert.equal(fiabiliteV1(snap("X", { warnings: [] })), null);
  assert.equal(fiabiliteV1(null), null);
  // La structure du drapeau ne porte QUE le fait et la phrase.
  assert.deepEqual(Object.keys(al.fiabilite).sort(), ["margeSurestimee", "message"]);
}

// ── 8 bis. Un chantier dont fg_non_regle est le SEUL signal reste visible ───
{
  // Correction d'une règle fausse de la v1 : fg_non_regle n'était QUE le
  // drapeau, donc un chantier n'ayant que ce signal n'avait aucun motif, donc
  // aucune carte — et la donnée manquante devenait invisible. Mesuré en W38 :
  // 8 RUE SAINT BLAISE - ENEDIS et PASSAGE CÂBLE disparaîssaient ainsi.
  // Une impossibilité doit rester visible.
  const seul = paire("C1", { nom: "PASSAGE CÂBLE", avancement: 100, heures: 6.5, marge: 774, margeTerminaison: 774 },
                            { nom: "PASSAGE CÂBLE", avancement: 100, heures: 6.58, marge: 774.42, margeTerminaison: 774.42,
                              warnings: [w(CODE_FG_NON_REGLE)] });
  const r = lancer([seul]);
  const al = parNom(r, "PASSAGE CÂBLE");
  assert.ok(al, "le chantier doit apparaître, même sans autre signal");
  assert.equal(al.niveau, NIVEAU_INFO, "seul signal = niveau info");
  assert.deepEqual(al.motifs, [CODE_FG_NON_REGLE]);
  assert.equal(libelleMotifAlerteV1(al.motifs[0]), "Donnée manquante : frais généraux non renseignés");
  // Le drapeau est posé EN PLUS du motif, pas à la place.
  assert.ok(al.fiabilite, "le drapeau reste posé");
  assert.equal(al.fiabilite.message, MESSAGE_MARGE_SURESTIMEE);
  // Aucun montant n'est chiffré : on ignore de combien la marge est surestimée.
  assert.equal(al.impactEuros, null);

  // Les deux comptes coïncident désormais : tout chantier concerné est visible.
  assert.equal(r.margeSurestimee.length, 1);
  assert.equal(r.fiabiliteDouteuse, 1, "plus aucun chantier concerné ne reste sans carte");

  // Un chantier qui a fg_non_regle ET d'autres motifs garde le niveau des
  // autres, et porte les deux étiquettes.
  const mixte = paire("C2", { avancement: 38, heures: 100, marge: -1000, margeTerminaison: -1000 },
                             { avancement: 39, heures: 105, marge: -1200, margeTerminaison: -39188,
                               warnings: [w(CODE_FG_NON_REGLE), w(CODE_OUVRAGES_SANS_PRIX)] });
  const alMixte = parNom(lancer([mixte]), "Chantier C2");
  assert.equal(alMixte.niveau, NIVEAU_CRITIQUE);
  assert.ok(alMixte.motifs.includes(CODE_FG_NON_REGLE));
  assert.ok(alMixte.motifs.includes(CODE_OUVRAGES_SANS_PRIX));
  assert.ok(alMixte.fiabilite, "drapeau présent en plus du motif");

  // Sans fg_non_regle : ni motif, ni drapeau.
  const sans = paire("C3", { avancement: 40, heures: 10, marge: 500, margeTerminaison: 500 },
                            { avancement: 45, heures: 11, marge: 500, margeTerminaison: 500,
                              warnings: [w(CODE_DERIVE_LOT)] });
  const alSans = parNom(lancer([sans]), "Chantier C3");
  assert.equal(alSans.fiabilite, null);
  assert.equal(alSans.motifs.includes(CODE_FG_NON_REGLE), false);
}

// ── 9. Tri : niveau, puis impact décroissant, inconnu EN DERNIER ────────────
{
  const p = [
    paire("A", { avancement: 50, heures: 10, marge: 100, margeTerminaison: 100 },
                { avancement: 50, heures: 11, marge: 100, margeTerminaison: -500 }),   // critique, 500
    paire("B", { avancement: 50, heures: 10, marge: 100, margeTerminaison: 100 },
                { avancement: 50, heures: 11, marge: 100, margeTerminaison: -9000 }),  // critique, 9000
    paire("C", { avancement: 30, heures: 10, marge: 100, margeTerminaison: 100 },
                { avancement: 35, heures: 11, marge: 100, margeTerminaison: 100, warnings: [w(CODE_DERIVE_LOT)] }), // info
    paire("D", { avancement: 56, heures: 31, marge: 24797, margeTerminaison: 23039 },
                { avancement: 56, heures: 39, marge: 24527, margeTerminaison: 22798 }), // à surveiller, impact inconnu
  ];
  const r = lancer(p);
  assert.deepEqual(r.alertes.map(a => a.nom), ["Chantier B", "Chantier A", "Chantier D", "Chantier C"],
    "critique (9000 puis 500), puis à surveiller, puis info");
  assert.deepEqual(r.alertes.map(a => a.niveau), [NIVEAU_CRITIQUE, NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO]);

  // Un impact inconnu se range APRÈS les impacts chiffrés du même niveau, et
  // ne se comporte jamais comme un 0 (qui le placerait aussi en dernier par
  // hasard, mais le ferait afficher « 0 € »).
  const q = [
    paire("E", { avancement: 40, heures: 10, marge: 500, margeTerminaison: 500 },
                { avancement: 45, heures: 11, marge: 500, margeTerminaison: 500, warnings: [w(CODE_DERIVE_LOT)] }),      // info, inconnu
    paire("F", { avancement: 100, heures: 10, marge: -300, margeTerminaison: -300 },
                { avancement: 100, heures: 11, marge: -300, margeTerminaison: -300 }),                                   // info, 300
  ];
  const r2 = lancer(q);
  assert.deepEqual(r2.alertes.map(a => a.nom), ["Chantier F", "Chantier E"], "impact connu avant impact inconnu");
  assert.equal(r2.alertes[1].impactEuros, null);
  assert.notEqual(r2.alertes[1].impactEuros, 0, "null n'est pas 0 : un impact inconnu ne s'affiche pas « 0 € »");

  // Déterminisme strict.
  assert.deepEqual(lancer(p), lancer(p));
  // Les totaux correspondent au contenu.
  assert.equal(r.totaux.critique, alertesDuNiveauV1(r, NIVEAU_CRITIQUE).length);
  assert.equal(r.totaux.total, r.alertes.length);
}

// ── 10. Les trois états, repris du chantier 07 ──────────────────────────────
{
  // (a) Relevé absent : ton NEUTRE, jamais vert. Le message est celui
  //     d'etatPointsAttentionV1 — délégué, pas dupliqué.
  const absent = alertesV1({ snapshotsCourants: [], snapshotsPrecedents: [] });
  const eAbsent = etatAlertesV1(absent);
  assert.equal(eAbsent.statut, ETAT_RELEVE_ABSENT);
  assert.equal(eAbsent.ton, "neutre", "un relevé manquant n'est pas une bonne nouvelle");
  assert.notEqual(eAbsent.ton, "ok");
  assert.match(eAbsent.message, /pas encore disponible|indisponible/);

  // (b) Relevé présent, aucune alerte.
  const p = paire("C1", { avancement: 40, heures: 10, marge: 500, margeTerminaison: 500 },
                         { avancement: 50, heures: 11, marge: 500, margeTerminaison: 500 });
  const rien = lancer([p]);
  const eRien = etatAlertesV1(rien);
  assert.equal(eRien.statut, ETAT_AUCUNE_DERIVE);
  assert.equal(eRien.ton, "ok");
  assert.equal(eRien.nb, 0);

  // (c) Des alertes.
  const q = paire("C2", { avancement: 50, heures: 10, marge: 100, margeTerminaison: 100 },
                         { avancement: 50, heures: 11, marge: 100, margeTerminaison: -9000 });
  const avec = lancer([q]);
  const eAvec = etatAlertesV1(avec);
  assert.equal(eAvec.statut, ETAT_DERIVES);
  assert.equal(eAvec.ton, "alerte");
  assert.match(eAvec.message, /à traiter en priorité/);

  // Des alertes, mais aucune critique : le ton redescend — il n'y a rien à
  // traiter en urgence, et le dire en rouge serait le bruit qu'on combat.
  const info = paire("C3", { avancement: 30, heures: 10, marge: 100, margeTerminaison: 100 },
                            { avancement: 35, heures: 11, marge: 100, margeTerminaison: 100, warnings: [w(CODE_DERIVE_LOT)] });
  const eInfo = etatAlertesV1(lancer([info]));
  assert.equal(eInfo.statut, ETAT_DERIVES);
  assert.equal(eInfo.ton, "neutre");
  assert.match(eInfo.message, /Aucun chantier critique/);
  // Le mécanisme d'état est DÉLÉGUÉ : le module ne réécrit pas les messages
  // du relevé absent.
  assert.match(code, /etatPointsAttentionV1\(\{/, "l'état « relevé absent » doit être délégué");
}

// ── 11. L'écran est bien PROVISOIRE et sans logique ─────────────────────────
{
  assert.match(ecran, /AFFICHAGE PROVISOIRE/, "le commentaire d'en-tête est exigé");
  assert.match(ecran, /ne pas mettre de logique ici/);
  assert.match(ecran, /le futur dashboard réutilisera alertesV1/);
  // Aucune écriture, aucune notification depuis l'écran.
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(ecran), false,
    "la page ne doit rien écrire");
  assert.equal(/Notification|sendMail|notify|marquer_comme_lu|marquerCommeLu/.test(ecran), false,
    "ni notification, ni e-mail, ni « marquer comme lu »");
  // La pastille ne compte QUE les critiques.
  assert.match(ecran, /critiques\.length > 0 && \(/, "pastille conditionnée au nombre de critiques");
  assert.equal(/aSurveiller\.length[^)]*\}\s*<\/span>/.test(ecran), false, "pas de pastille pour « à surveiller »");
  // « Info » repliée par défaut.
  assert.match(ecran, /useState\(false\);?\s*(\/\/[^\n]*)?\n?/, "infoOuvert doit démarrer fermé");
  assert.match(ecran, /const \[infoOuvert, setInfoOuvert\] = useState\(false\)/);
  // Le niveau, le tri et les libellés viennent du module.
  assert.match(ecran, /libelleMotifAlerteV1\(m\)/, "les libellés viennent du module");
  assert.equal(/niveau ===\s*["']critique["']\s*\?[^]*?:\s*["']a_surveiller["']/.test(ecran), false,
    "l'écran ne doit pas recalculer un niveau");
}

console.log("OK — moteur d'alertes V1 : 13 blocs de vérification");
