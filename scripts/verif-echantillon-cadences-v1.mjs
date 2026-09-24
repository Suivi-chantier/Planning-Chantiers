// Vérification du module pur « Échantillon de cadences » (chantier 08).
//
// Ce module a une mission NÉGATIVE : empêcher qu'un écart réel/vendu calculé
// sur deux ouvrages soit pris pour une mesure. Les blocs ci-dessous vérifient
// donc surtout ce qu'il REFUSE de dire — un ouvrage non terminé n'entre pas,
// des heures indirectes ne comptent pas, un échantillon insuffisant ne produit
// aucun écart (null, et non 0).
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES. Aucun chiffre
// ici ne provient de la base ; le décompte réel se fait par une lecture séparée.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  echantillonCadencesV1,
  ouvragesComparablesV1,
  ouvrageEntierementTermineV1,
  niveauEchantillonV1,
  indexEchantillonParBibliothequeV1,
  libelleEchantillonV1,
  libelleEcartEchantillonV1,
  formaterEcartPctV1,
  ECHANTILLON_CADENCES_VERSION,
  SEUILS_ECHANTILLON_CADENCES_V1,
  AVERTISSEMENT_INDICATIF,
  NIVEAU_INSUFFISANT, NIVEAU_INDICATIF, NIVEAU_FIABLE, NIVEAUX_ECHANTILLON,
} from "../src/Renovation/echantillonCadencesV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/echantillonCadencesV1.mjs"), "utf8");
const facade = await readFile(resolve(here, "../src/Renovation/echantillonCadencesV1.js"), "utf8");
// Le CODE seul, sans commentaires : l'en-tête documente volontairement d'où
// viennent les heures (table pointages, chantierFinance) et ne doit pas
// déclencher les gardes de pureté.
const code = source.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── Fixtures (toutes inventées) ─────────────────────────────────────────────
let seqTache = 0;
const tache = (avancement, heuresVendues, id) => ({
  id: id ?? `t${++seqTache}`,
  nom: "tâche fixture",
  avancement,
  heures_vendues: heuresVendues,
});

/** Un ouvrage terminé d'un type donné, avec ses tâches. */
const ouvrage = (bibliothequeId, taches, extra = {}) => ({
  id: `o${taches.map(t => t.id).join("-")}`,
  libelle: "ouvrage fixture",
  bibliotheque_id: bibliothequeId,
  taches,
  ...extra,
});

const phasage = (chantierId, ouvrages) => ({ chantier_id: chantierId, ouvrages });

const pointage = (chantierId, tacheId, heures, type = "tache") => ({
  chantier_id: chantierId, tache_id: tacheId, heures, type_pointage: type,
});

/** Un ouvrage terminé complet + ses pointages, en une ligne. */
function ouvrageTermine(chantierId, bibliothequeId, { vendues, reelles }) {
  const t = tache(100, vendues);
  return {
    ouvrage: ouvrage(bibliothequeId, [t]),
    pointages: [pointage(chantierId, t.id, reelles)],
  };
}

/** Assemble un jeu { phasages, pointages } depuis une liste [chantier, type, heures]. */
function jeu(lignes) {
  const parChantier = new Map();
  const pointages = [];
  lignes.forEach(([chantierId, bib, heures]) => {
    const { ouvrage: o, pointages: pts } = ouvrageTermine(chantierId, bib, heures);
    if (!parChantier.has(chantierId)) parChantier.set(chantierId, []);
    parChantier.get(chantierId).push(o);
    pointages.push(...pts);
  });
  return {
    phasages: [...parChantier.entries()].map(([c, ouvrages]) => phasage(c, ouvrages)),
    pointages,
  };
}

const h = (vendues, reelles) => ({ vendues, reelles });
const entree = (resultat, bib) => indexEchantillonParBibliothequeV1(resultat)[bib];

// ── 0. Pureté, façade, constantes ───────────────────────────────────────────
{
  assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "l'échantillon doit rester pur : aucun accès Supabase");
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "l'échantillon ne doit rien lire ni écrire en base");
  assert.equal(/new Date\s*\(|Date\.now\s*\(|Date\.UTC\s*\(/.test(code), false, "l'échantillon ne doit dépendre d'aucune horloge");
  assert.equal(/toLocaleString|Intl\./.test(code), false, "pas d'ICU : les libellés doivent être déterministes");
  // Le module ne doit JAMAIS écrire une cadence : il décrit un échantillon,
  // il ne corrige rien. La garde est volontairement large.
  assert.equal(/cadenceCorrigee|cadence_corrigee|nouvelleCadence|appliquerCadence/.test(code), false, "la v1 ne calcule aucune cadence corrigée");
  // Même chiffre = même service : le rapprochement pointage → tâche vient de
  // chantierFinance, il n'est pas réécrit ici.
  assert.match(code, /from "\.\.\/chantierFinance\.mjs"/, "le rapprochement doit être importé de chantierFinance");
  assert.match(facade, /export \* from "\.\/echantillonCadencesV1\.mjs";/, "la façade .js doit ré-exporter le .mjs");
  assert.equal(ECHANTILLON_CADENCES_VERSION, "v1");
  assert.deepEqual({ ...SEUILS_ECHANTILLON_CADENCES_V1 }, {
    ouvragesMinIndicatif: 3, ouvragesMinFiable: 5, chantiersMinFiable: 3,
  });
  assert.deepEqual([...NIVEAUX_ECHANTILLON], ["insuffisant", "indicatif", "fiable"]);
  // Entrées absentes ou malformées : rien ne casse, rien ne s'invente.
  assert.deepEqual(echantillonCadencesV1().parBibliotheque, []);
  assert.deepEqual(echantillonCadencesV1({ phasages: null, pointages: "bruit" }).parBibliotheque, []);
  assert.deepEqual(echantillonCadencesV1({ phasages: [null, 42, {}] }).parBibliotheque, []);
}

// ── 1. Un ouvrage NON TERMINÉ est exclu ─────────────────────────────────────
{
  // Deux tâches, une seule achevée : l'ouvrage n'est pas terminé.
  const t1 = tache(100, 10), t2 = tache(60, 10);
  const phasages = [phasage("C1", [ouvrage("BIB-A", [t1, t2])])];
  const pointages = [pointage("C1", t1.id, 12), pointage("C1", t2.id, 5)];
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [t1, t2])), false);
  assert.deepEqual(ouvragesComparablesV1(phasages, pointages), [], "un ouvrage dont une tâche n'est pas à 100 % n'entre pas dans l'échantillon");

  // 99 % n'est pas 100 %.
  const presque = tache(99, 10);
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [presque])), false);

  // Avancement ABSENT : inconnu, pas « en cours ». L'ouvrage est écarté, et
  // surtout il n'est pas compté comme terminé par défaut.
  const sansAvancement = { id: "tX", nom: "sans avancement", heures_vendues: 10 };
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [sansAvancement])), false, "un avancement manquant ne vaut pas terminé");
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [tache("illisible", 10)])), false);
  // Un ouvrage sans aucune tâche n'est pas « terminé à 100 % » par vacuité.
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [])), false);
  assert.equal(ouvrageEntierementTermineV1({ bibliotheque_id: "BIB-A" }), false);
  // Un ouvrage terminé, lui, entre bien : le test précédent ne passe pas par défaut.
  assert.equal(ouvrageEntierementTermineV1(ouvrage("BIB-A", [tache(100, 10)])), true);
}

// ── 2. Un ouvrage SANS bibliotheque_id est exclu ────────────────────────────
{
  const t = tache(100, 10);
  const sansRef = ouvrage(null, [t]);
  const phasages = [phasage("C1", [sansRef, { ...ouvrage("", [tache(100, 8)]) }])];
  const pointages = [pointage("C1", t.id, 12)];
  assert.deepEqual(ouvragesComparablesV1(phasages, pointages), [], "sans bibliotheque_id on ignore quel type d'ouvrage serait documenté");

  // Le même ouvrage, cette fois référencé, entre.
  const t2 = tache(100, 10);
  const retenus = ouvragesComparablesV1(
    [phasage("C1", [ouvrage("BIB-A", [t2])])],
    [pointage("C1", t2.id, 12)],
  );
  assert.equal(retenus.length, 1);
  assert.equal(retenus[0].bibliothequeId, "BIB-A");
}

// ── 3. Les pointages INDIRECTS (et les 'tache' sans tache_id) sont exclus ───
{
  const t = tache(100, 10);
  const phasages = [phasage("C1", [ouvrage("BIB-A", [t])])];

  // Seulement de l'indirect sur ce chantier : aucune heure imputable à
  // l'ouvrage → heures réelles = 0 → l'ouvrage sort de l'échantillon.
  const indirectSeul = [
    { chantier_id: "C1", tache_id: null, heures: 40, type_pointage: "indirect" },
    { chantier_id: "C1", tache_id: t.id, heures: 40, type_pointage: "indirect" },
  ];
  assert.deepEqual(ouvragesComparablesV1(phasages, indirectSeul), [], "les heures indirectes ne se rattachent à aucun ouvrage");

  // Un pointage 'tache' SANS tache_id : les heures existent, mais on ne sait
  // pas sur quel ouvrage. Les imputer serait inventer.
  assert.deepEqual(ouvragesComparablesV1(phasages, [pointage("C1", null, 40)]), []);

  // Mélange : seules les 12 h de type 'tache' correctement rattachées comptent.
  const melange = [
    pointage("C1", t.id, 12),
    pointage("C1", t.id, 40, "indirect"),
    pointage("C1", null, 7),
    { chantier_id: "C1", tache_id: t.id, heures: 99, type_pointage: "autre_type_futur" },
  ];
  const retenus = ouvragesComparablesV1(phasages, melange);
  assert.equal(retenus.length, 1);
  assert.equal(retenus[0].heuresReelles, 12, "seuls les pointages type 'tache' rattachés à la tâche comptent");

  // Rapprochement par (chantier_id, tache_id) : un même tache_id sur un AUTRE
  // chantier ne doit pas venir gonfler les heures de celui-ci.
  const tPartage = tache(100, 10, "id-partage");
  const deuxChantiers = [
    phasage("C1", [ouvrage("BIB-A", [tPartage])]),
    phasage("C2", [ouvrage("BIB-A", [tPartage])]),
  ];
  const ptsDeuxChantiers = [pointage("C1", "id-partage", 12), pointage("C2", "id-partage", 30)];
  const parChantier = ouvragesComparablesV1(deuxChantiers, ptsDeuxChantiers);
  assert.deepEqual(parChantier.map(r => [r.chantierId, r.heuresReelles]), [["C1", 12], ["C2", 30]],
    "un tache_id n'est unique qu'à l'intérieur d'un chantier : le rapprochement porte sur le couple");
}

// ── 4. Les trois niveaux ────────────────────────────────────────────────────
{
  // insuffisant : 2 ouvrages.
  const petit = echantillonCadencesV1(jeu([
    ["C1", "BIB-A", h(10, 12)],
    ["C2", "BIB-A", h(10, 12)],
  ]));
  assert.equal(entree(petit, "BIB-A").niveau, NIVEAU_INSUFFISANT);
  assert.equal(entree(petit, "BIB-A").nOuvrages, 2);

  // indicatif : 3 ouvrages sur 3 chantiers (assez pour parler, pas pour agir).
  const moyen = echantillonCadencesV1(jeu([
    ["C1", "BIB-B", h(10, 12)],
    ["C2", "BIB-B", h(10, 12)],
    ["C3", "BIB-B", h(10, 12)],
  ]));
  assert.equal(entree(moyen, "BIB-B").niveau, NIVEAU_INDICATIF);
  assert.equal(entree(moyen, "BIB-B").nChantiers, 3);

  // fiable : 5 ouvrages ET 3 chantiers.
  const grand = echantillonCadencesV1(jeu([
    ["C1", "BIB-C", h(10, 11)],
    ["C1", "BIB-C", h(10, 11)],
    ["C2", "BIB-C", h(10, 11)],
    ["C2", "BIB-C", h(10, 11)],
    ["C3", "BIB-C", h(10, 11)],
  ]));
  assert.equal(entree(grand, "BIB-C").niveau, NIVEAU_FIABLE);
  assert.equal(entree(grand, "BIB-C").nOuvrages, 5);
  assert.equal(entree(grand, "BIB-C").nChantiers, 3);

  // La fonction de qualification, isolée, aux bornes exactes.
  assert.equal(niveauEchantillonV1(0, 0), NIVEAU_INSUFFISANT);
  assert.equal(niveauEchantillonV1(2, 2), NIVEAU_INSUFFISANT);
  assert.equal(niveauEchantillonV1(3, 3), NIVEAU_INDICATIF);
  assert.equal(niveauEchantillonV1(4, 9), NIVEAU_INDICATIF, "4 ouvrages ne suffisent pas, même sur 9 chantiers");
  assert.equal(niveauEchantillonV1(5, 3), NIVEAU_FIABLE);
  assert.equal(niveauEchantillonV1(50, 2), NIVEAU_INDICATIF, "50 ouvrages sur 2 chantiers restent indicatifs");
}

// ── 5. En « insuffisant », ecartPct vaut null — PAS 0 ───────────────────────
{
  // Écart réel énorme (+50 %) mais un seul ouvrage : on ne le montre pas.
  const resultat = echantillonCadencesV1(jeu([["C1", "BIB-A", h(10, 15)]]));
  const e = entree(resultat, "BIB-A");
  assert.equal(e.niveau, NIVEAU_INSUFFISANT);
  assert.equal(e.ecartPct, null, "un écart sur un seul ouvrage n'est pas une information");
  assert.notEqual(e.ecartPct, 0, "null ≠ 0 : 0 se lirait « cadence juste », ce qui serait faux");
  // Les heures, elles, restent visibles : c'est un décompte, pas une mesure.
  assert.equal(e.heuresVendues, 10);
  assert.equal(e.heuresReelles, 15);
  // Et aucune phrase d'écart n'est produite.
  assert.equal(libelleEcartEchantillonV1(e), null);

  // Dès « indicatif », l'écart apparaît — accompagné de son avertissement.
  const troisOuvrages = echantillonCadencesV1(jeu([
    ["C1", "BIB-A", h(10, 15)],
    ["C2", "BIB-A", h(10, 15)],
    ["C3", "BIB-A", h(10, 15)],
  ]));
  const e3 = entree(troisOuvrages, "BIB-A");
  assert.equal(e3.ecartPct, 50, "(45 réelles − 30 vendues) / 30 = +50 %");
  assert.match(libelleEcartEchantillonV1(e3), /ne pas corriger la cadence sur cette base/);

  // Un écart NÉGATIF (réel sous le vendu) est traité pareil, sans valeur absolue.
  const sousVendu = echantillonCadencesV1(jeu([
    ["C1", "BIB-D", h(10, 8)], ["C2", "BIB-D", h(10, 8)], ["C3", "BIB-D", h(10, 8)],
  ]));
  assert.equal(entree(sousVendu, "BIB-D").ecartPct, -20);
  assert.equal(formaterEcartPctV1(-20), "−20 %");
  assert.equal(formaterEcartPctV1(12.5), "+12,5 %");
  assert.equal(formaterEcartPctV1(null), "—");
}

// ── 6. 5 ouvrages sur 2 chantiers => INDICATIF, pas fiable ──────────────────
{
  // Le piège exact : le compte d'ouvrages est atteint, la diversité non.
  // Cinq ouvrages du même type sur deux chantiers mesurent surtout ces deux
  // chantiers-là — même équipe, même bâtiment.
  const resultat = echantillonCadencesV1(jeu([
    ["C1", "BIB-E", h(10, 13)],
    ["C1", "BIB-E", h(10, 13)],
    ["C1", "BIB-E", h(10, 13)],
    ["C2", "BIB-E", h(10, 13)],
    ["C2", "BIB-E", h(10, 13)],
  ]));
  const e = entree(resultat, "BIB-E");
  assert.equal(e.nOuvrages, 5);
  assert.equal(e.nChantiers, 2);
  assert.equal(e.niveau, NIVEAU_INDICATIF, "5 ouvrages sur 2 chantiers : le seuil de chantiers n'est pas atteint");
  assert.notEqual(e.niveau, NIVEAU_FIABLE);
  // L'écart s'affiche, mais l'avertissement reste collé au chiffre.
  assert.equal(e.ecartPct, 30);
  assert.match(libelleEcartEchantillonV1(e), new RegExp(AVERTISSEMENT_INDICATIF));
  // Le même jeu réparti sur 3 chantiers, lui, devient fiable — et là seulement
  // la phrase d'écart perd son avertissement.
  const reparti = echantillonCadencesV1(jeu([
    ["C1", "BIB-E", h(10, 13)], ["C1", "BIB-E", h(10, 13)], ["C2", "BIB-E", h(10, 13)],
    ["C2", "BIB-E", h(10, 13)], ["C3", "BIB-E", h(10, 13)],
  ]));
  const eF = entree(reparti, "BIB-E");
  assert.equal(eF.niveau, NIVEAU_FIABLE);
  assert.doesNotMatch(libelleEcartEchantillonV1(eF), new RegExp(AVERTISSEMENT_INDICATIF));
}

// ── 7. Seuils paramétrables ─────────────────────────────────────────────────
{
  const lignes = [
    ["C1", "BIB-F", h(10, 12)],
    ["C2", "BIB-F", h(10, 12)],
  ];
  // Par défaut : 2 ouvrages = insuffisant.
  assert.equal(entree(echantillonCadencesV1(jeu(lignes)), "BIB-F").niveau, NIVEAU_INSUFFISANT);

  // Seuils abaissés : le même échantillon devient fiable. Le module n'a aucune
  // constante en dur dans sa logique.
  const permissif = echantillonCadencesV1({
    ...jeu(lignes),
    seuils: { ouvragesMinIndicatif: 1, ouvragesMinFiable: 2, chantiersMinFiable: 2 },
  });
  assert.equal(entree(permissif, "BIB-F").niveau, NIVEAU_FIABLE);
  assert.equal(entree(permissif, "BIB-F").ecartPct, 20, "l'écart apparaît dès que le niveau n'est plus insuffisant");

  // Seuils durcis : même un gros échantillon redescend.
  const exigeant = echantillonCadencesV1({
    ...jeu([
      ["C1", "BIB-G", h(10, 12)], ["C2", "BIB-G", h(10, 12)], ["C3", "BIB-G", h(10, 12)],
      ["C4", "BIB-G", h(10, 12)], ["C5", "BIB-G", h(10, 12)], ["C6", "BIB-G", h(10, 12)],
    ]),
    seuils: { ouvragesMinFiable: 20, chantiersMinFiable: 10 },
  });
  assert.equal(entree(exigeant, "BIB-G").niveau, NIVEAU_INDICATIF);
  // Un seuil partiel complète les défauts, il ne les remplace pas.
  assert.deepEqual(
    { ...echantillonCadencesV1({ seuils: { ouvragesMinFiable: 20 } }).seuils },
    { ouvragesMinIndicatif: 3, ouvragesMinFiable: 20, chantiersMinFiable: 3 },
  );
  // Les seuils par défaut restent intacts après un appel paramétré.
  assert.deepEqual({ ...SEUILS_ECHANTILLON_CADENCES_V1 }, {
    ouvragesMinIndicatif: 3, ouvragesMinFiable: 5, chantiersMinFiable: 3,
  });
}

// ── 8. Agrégation, totaux, libellés et déterminisme ─────────────────────────
{
  const donnees = jeu([
    ["C1", "BIB-A", h(10, 12)],                                   // 1 ouvrage
    ["C1", "BIB-B", h(10, 12)], ["C2", "BIB-B", h(20, 20)], ["C3", "BIB-B", h(10, 10)], // 3 ouvrages / 3 chantiers
    ["C1", "BIB-C", h(10, 11)], ["C1", "BIB-C", h(10, 11)], ["C2", "BIB-C", h(10, 11)],
    ["C2", "BIB-C", h(10, 11)], ["C3", "BIB-C", h(10, 11)],       // 5 ouvrages / 3 chantiers
  ]);
  const r = echantillonCadencesV1(donnees);

  assert.deepEqual(r.totaux, {
    nTypes: 3, nOuvragesRetenus: 9, insuffisant: 1, indicatif: 1, fiable: 1,
  });
  // Tri : le plus gros échantillon d'abord.
  assert.deepEqual(r.parBibliotheque.map(e => e.bibliothequeId), ["BIB-C", "BIB-B", "BIB-A"]);

  // Les heures s'additionnent sur l'ensemble du type, pas par ouvrage.
  const b = entree(r, "BIB-B");
  assert.equal(b.heuresVendues, 40);
  assert.equal(b.heuresReelles, 42);
  assert.equal(b.ecartPct, 5);

  // Libellés : accords du pluriel, et distinction entre « rien » et « vide ».
  assert.equal(libelleEchantillonV1(entree(r, "BIB-A")), "Échantillon : 1 ouvrage terminé sur 1 chantier — insuffisant");
  assert.equal(libelleEchantillonV1(b), "Échantillon : 3 ouvrages terminés sur 3 chantiers — indicatif");
  assert.equal(libelleEchantillonV1(entree(r, "BIB-C")), "Échantillon : 5 ouvrages terminés sur 3 chantiers — fiable");
  // Un type de bibliothèque sans aucun ouvrage terminé n'est pas « 0 ouvrage
  // sur 0 chantier » : il n'a pas d'échantillon du tout, et le dit ainsi.
  assert.equal(entree(r, "BIB-INCONNU"), undefined);
  assert.equal(libelleEchantillonV1(undefined), "Échantillon : aucun ouvrage terminé comparable");
  assert.equal(libelleEcartEchantillonV1(undefined), null);

  // Déterminisme strict : deux appels, exactement le même objet.
  assert.deepEqual(echantillonCadencesV1(donnees), echantillonCadencesV1(donnees));
}

console.log("OK — échantillon de cadences V1 : 9 blocs de vérification");
